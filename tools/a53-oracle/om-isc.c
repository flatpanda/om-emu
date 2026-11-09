/*
 * om-isc: OM-1 Cortex-A53 Inter-System Communication windows (oracle only).
 *
 * A self-contained sysbus device that backs the camera's custom ISC hardware
 * windows so the real A53 Linux (iscdrv.ko) can bring ISC up on qemu virt, and
 * bridges the doorbells to an external MN-side peer (tools/a53-oracle/iscpeer.mjs)
 * over a chardev. Register facts are decoded in tools/a53-oracle/README.md and
 * docs/a53-spec.md 3; the transport is docs/hle-gaps.md 4.11.1.
 *
 * Instantiate on virt with:  -device om-isc,memdev=<id>,chardev=<id>
 * The 5 RAM windows alias one shared memory-backend-file (also mmap'd by the
 * peer); the 4 irqcon banks are MMIO. A53->MN doorbell (write 0x4000 to
 * bank(n)+0x800) is forwarded to the peer as one byte 'n'; a byte from the peer
 * sets bank0+0x880 pending and pulses IRQ line 0 (wired to the GIC by the board
 * hook in hw/arm/virt.c when enabled). Unmodelled offsets: LOG_UNIMP, read 0.
 *
 * This file is built into QEMU and, unlike the rest of this repository, is
 * licensed under the GNU General Public License, version 2 or (at your
 * option) any later version.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "qemu/osdep.h"
#include "qemu/log.h"
#include "qemu/module.h"
#include "hw/core/sysbus.h"
#include "hw/core/irq.h"
#include "hw/core/qdev-properties.h"
#include "hw/core/qdev-properties-system.h"
#include "system/hostmem.h"
#include "system/address-spaces.h"
#include "chardev/char-fe.h"
#include "qapi/error.h"
#include "qom/object.h"

#define TYPE_OM_ISC "om-isc"
OBJECT_DECLARE_SIMPLE_TYPE(OmIscState, OM_ISC)

/* Window physical bases (D, iscdrv.ko / kernel isc_lock_init, scc_init). */
#define A_LOCK   0x97000000ULL
#define A_SCC    0x97f00b80ULL
#define A_CB     0x97f00c00ULL
/* The mn_sio_uart console (ttyS0) at 0x9a500600: TX byte at +0x18, status word
 * at +0x44 bit15 = "not ready" (D, kernel mn_sio_uart_console_putchar
 * 0xffffff8008293c00 / serial_in/out). Without a model these MMIO writes land in
 * machine RAM and the guest console is lost; this region forwards each TX byte to
 * QEMU's stderr so the oracle can show the A53 boot/daemon log (dev aid only). */
#define A_UART   0x9a500600ULL
#define WUART    0x100
#define UART_TX  0x18
#define UART_ST  0x44
/* The MN view (0x63fe0000) and the A53 view (0x2_a3fe0000) are the SAME
 * physical shared memory: the A53 reaches an MN buffer through /dev/mem at
 * (addr & 0x3fffffff) | 0x2_80000000, so 0x63fe0000 -> 0x2_a3fe0000 (D,
 * isc_socket.dis 0x12b3c). Both windows must therefore alias ONE backing
 * region, or a buffer written on one side is invisible on the other. */
#define A_MEM_MN 0x63fe0000ULL       /* MN view of the shared pool          */
#define A_MEM_A  0x2a3fe0000ULL      /* A53 view of the SAME shared pool    */
#define WLOCK 0x200
#define WSCC  0x80
#define WCB   0x400
#define WMEM  0x20000                /* 128 KiB shared pool                 */
/* shared backend-file layout (must match iscpeer.mjs FileMem) */
#define O_LOCK 0x00000
#define O_SCC  0x01000
#define O_CB   0x02000
#define O_MEM  0x10000               /* one region, aliased by both views   */
#define BACKEND_MIN (O_MEM + WMEM)   /* 0x30000 */

/* irqcon banks (D, nep1.dts + iscdrv .rodata+0x110). */
static const hwaddr bank_base[4] = {
    0x99200000ULL, 0x99300000ULL, 0x99b00000ULL, 0x99b80000ULL,
};
#define BANK_SIZE 0x1000
#define OFF_NOTIFY 0x800             /* doorbell to node 0..3               */
#define OFF_A53    0x880             /* doorbell to node 4 / pending word   */
/* The A53's irqcon entry (kernel 0xffffff800826fe48) reads the pending word at
 * +0x880 and acknowledges by writing the bits it saw (low 16) to +0x884, a
 * write-1-to-clear register (D, the store at 0xffffff800826fef8), then calls the
 * handler of each set bit. Writing the word back to +0x880 is not what it does:
 * without this ack the level line never dropped and CPU 0 sat in the handler
 * (X: an RCU stall with CPU 0's PC at 0xffffff800826fef8). */
#define OFF_ACK    0x884
#define DOORBELL_VAL 0x4000

typedef struct OmIscState OmIscState;
typedef struct { OmIscState *s; int n; } BankCtx;

struct OmIscState {
    SysBusDevice parent_obj;
    HostMemoryBackend *memdev;
    CharFrontend chr;
    CharFrontend uchr;              /* optional ttyS0 RX source */
    uint32_t ureg[WUART / 4];
    uint8_t rxq[4096];
    uint32_t rxr, rxn;
    MemoryRegion lock, scc, cb, mem_mn, mem_a, uart;
    MemoryRegion bank[4];
    BankCtx bctx[4];
    qemu_irq irq[6];                /* 0..3 irqcon banks, 4 uart tx, 5 uart rx */
    uint32_t pending[4];
};

/* mn_sio_uart ttyS0 model (D, kernel mn_sio_uart driver 0xffffff80082934b0..
 * 0xffffff80082947bc, read from the Image at VA - 0xffffff8008080000):
 *   +0x08 RX data byte, +0x0c RX FIFO count (the IRQ handler 0x294448 reads
 *   +0x08 while +0x0c != 0), +0x50 line status (bits 0x4c = errors),
 *   +0x18 TX data, +0x1c TX FIFO free count (tx_chars 0x294138 writes at most
 *   that many bytes; the drain wait 0x293850 compares it with the port's
 *   fifosize, DT fifo-size 0x80), +0x44 bit15 = transmitter busy,
 *   +0x28 bit7 = TX interrupt enable (tx_chars sets it while its circular
 *   buffer still holds bytes and clears it when empty).
 * Model: the transmitter is always empty (+0x1c reads 0x80, +0x44 reads 0), so
 * the TX interrupt line is level (reg 0x28 & 0x80); RX bytes come from an
 * optional chardev and keep the RX line high while the FIFO is non-empty. The
 * driver requests both lines with one handler (startup 0x293e00). Before this,
 * +0x1c read 1 and no TX interrupt existed, so every tty write (userspace
 * stdout on the console) stalled after its first bytes (X: the console stopped
 * mid-line), which also blocked any daemon or script writing to the console.
 * Other offsets are plain storage (read-modify-write registers). */
#define UART_RXD  0x08
#define UART_RXN  0x0c
#define UART_TXF  0x1c
#define UART_IEN  0x28
#define UART_LSR  0x50
#define UART_FIFO 0x80
#define RXQ 4096
static void uart_update(OmIscState *s)
{
    qemu_set_irq(s->irq[4], (s->ureg[UART_IEN / 4] & 0x80) != 0);
    qemu_set_irq(s->irq[5], s->rxn != 0);
}

static uint64_t uart_read(void *opaque, hwaddr off, unsigned size)
{
    OmIscState *s = opaque;
    switch (off) {
    case UART_TXF: return UART_FIFO;
    case UART_ST:  return 0;
    case UART_LSR: return 0;
    case UART_RXN: return s->rxn;
    case UART_RXD: {
        uint8_t b = 0;
        if (s->rxn) {
            b = s->rxq[s->rxr];
            s->rxr = (s->rxr + 1) % RXQ;
            s->rxn--;
            uart_update(s);
            qemu_chr_fe_accept_input(&s->uchr);
        }
        return b;
    }
    default:
        return off < WUART ? s->ureg[off / 4] : 0;
    }
}

static void uart_write(void *opaque, hwaddr off, uint64_t val, unsigned size)
{
    OmIscState *s = opaque;
    if (off == UART_TX) {
        fputc((int)(val & 0xff), stderr);
        fflush(stderr);
        return;
    }
    if (off < WUART) {
        s->ureg[off / 4] = (uint32_t)val;
    }
    if (off == UART_IEN) {
        uart_update(s);
    }
}

static int uart_can_rx(void *opaque)
{
    OmIscState *s = opaque;
    return RXQ - s->rxn;
}

static void uart_rx(void *opaque, const uint8_t *buf, int size)
{
    OmIscState *s = opaque;
    for (int i = 0; i < size && s->rxn < RXQ; i++) {
        s->rxq[(s->rxr + s->rxn) % RXQ] = buf[i];
        s->rxn++;
    }
    uart_update(s);
}

static const MemoryRegionOps uart_ops = {
    .read = uart_read, .write = uart_write,
    .endianness = DEVICE_LITTLE_ENDIAN,
    .valid.min_access_size = 1, .valid.max_access_size = 4,
};

static uint64_t bank_read(void *opaque, hwaddr off, unsigned size)
{
    BankCtx *c = opaque;
    if (off == OFF_A53) {
        return c->s->pending[c->n];
    }
    if (off == OFF_NOTIFY) {
        return DOORBELL_VAL;          /* posting read-back after notify      */
    }
    if (off == OFF_ACK) {
        return 0;                     /* posting read-back after the ack     */
    }
    qemu_log_mask(LOG_UNIMP, "om-isc: bank%d read off 0x%x\n", c->n,
                  (unsigned)off);
    return 0;
}

static void bank_write(void *opaque, hwaddr off, uint64_t val, unsigned size)
{
    BankCtx *c = opaque;
    if (off == OFF_NOTIFY && (val & DOORBELL_VAL)) {
        uint8_t b = (uint8_t)c->n;    /* A53 -> MN node n */
        qemu_chr_fe_write_all(&c->s->chr, &b, 1);
        return;
    }
    if (off == OFF_ACK) {             /* write-1-to-clear ack (see OFF_ACK)   */
        c->s->pending[c->n] &= ~(uint32_t)val;
        if (c->s->pending[c->n] == 0) {
            qemu_set_irq(c->s->irq[c->n], 0);   /* level low once drained */
        }
        return;
    }
    qemu_log_mask(LOG_UNIMP, "om-isc: bank%d write off 0x%x val 0x%" PRIx64 "\n",
                  c->n, (unsigned)off, val);
}

static const MemoryRegionOps bank_ops = {
    .read = bank_read, .write = bank_write,
    .endianness = DEVICE_LITTLE_ENDIAN,
    .valid.min_access_size = 4, .valid.max_access_size = 4,
};

static int om_isc_can_rx(void *opaque) { return 1; }

static void om_isc_rx(void *opaque, const uint8_t *buf, int size)
{
    OmIscState *s = opaque;
    for (int i = 0; i < size; i++) {
        s->pending[0] |= DOORBELL_VAL;      /* bank0 +0x880 (D, isc_send tail) */
        qemu_set_irq(s->irq[0], 1);         /* level high; lowered on ack */
    }
}

static void alias(OmIscState *s, MemoryRegion *mr, MemoryRegion *be,
                  const char *name, hwaddr off, uint64_t len, hwaddr pa)
{
    memory_region_init_alias(mr, OBJECT(s), name, be, off, len);
    /* high priority: these windows sit inside the machine RAM span on virt but
     * the A53 kernel only uses the low 81 MiB, so overriding is safe. */
    memory_region_add_subregion_overlap(get_system_memory(), pa, mr, 10);
}

static void om_isc_realize(DeviceState *dev, Error **errp)
{
    OmIscState *s = OM_ISC(dev);
    SysBusDevice *sbd = SYS_BUS_DEVICE(dev);

    if (!s->memdev) {
        error_setg(errp, "om-isc: 'memdev' (a memory-backend) is required");
        return;
    }
    MemoryRegion *be = host_memory_backend_get_memory(s->memdev);
    if (memory_region_size(be) < BACKEND_MIN) {
        error_setg(errp, "om-isc: memdev too small, need >= 0x%x", BACKEND_MIN);
        return;
    }
    alias(s, &s->lock,   be, "om-isc.lock", O_LOCK, WLOCK, A_LOCK);
    alias(s, &s->scc,    be, "om-isc.scc",  O_SCC,  WSCC,  A_SCC);
    alias(s, &s->cb,     be, "om-isc.cb",   O_CB,   WCB,   A_CB);
    /* both views alias the one O_MEM region, so a write through either
     * physical window lands in the same bytes (D, see A_MEM_* above). */
    alias(s, &s->mem_mn, be, "om-isc.mem.mn", O_MEM, WMEM, A_MEM_MN);
    alias(s, &s->mem_a,  be, "om-isc.mem.a",  O_MEM, WMEM, A_MEM_A);

    /* mn_sio_uart console capture (overlay over machine RAM, dev aid). */
    memory_region_init_io(&s->uart, OBJECT(s), &uart_ops, s, "om-isc.uart", WUART);
    memory_region_add_subregion_overlap(get_system_memory(), A_UART, &s->uart, 10);

    for (int n = 0; n < 4; n++) {
        char nm[16];
        snprintf(nm, sizeof nm, "om-isc.bank%d", n);
        s->bctx[n].s = s;
        s->bctx[n].n = n;
        memory_region_init_io(&s->bank[n], OBJECT(s), &bank_ops, &s->bctx[n],
                              nm, BANK_SIZE);
        memory_region_add_subregion_overlap(get_system_memory(), bank_base[n],
                                            &s->bank[n], 10);
        sysbus_init_irq(sbd, &s->irq[n]);
    }
    sysbus_init_irq(sbd, &s->irq[4]);
    sysbus_init_irq(sbd, &s->irq[5]);
    qemu_chr_fe_set_handlers(&s->chr, om_isc_can_rx, om_isc_rx, NULL, NULL,
                             s, NULL, true);
    qemu_chr_fe_set_handlers(&s->uchr, uart_can_rx, uart_rx, NULL, NULL,
                             s, NULL, true);
}

static const Property om_isc_props[] = {
    DEFINE_PROP_LINK("memdev", OmIscState, memdev,
                     TYPE_MEMORY_BACKEND, HostMemoryBackend *),
    DEFINE_PROP_CHR("chardev", OmIscState, chr),
    DEFINE_PROP_CHR("uart", OmIscState, uchr),
};

static void om_isc_class_init(ObjectClass *oc, const void *data)
{
    DeviceClass *dc = DEVICE_CLASS(oc);
    dc->realize = om_isc_realize;
    device_class_set_props(dc, om_isc_props);
    set_bit(DEVICE_CATEGORY_MISC, dc->categories);
}

static const TypeInfo om_isc_info = {
    .name = TYPE_OM_ISC,
    .parent = TYPE_SYS_BUS_DEVICE,
    .instance_size = sizeof(OmIscState),
    .class_init = om_isc_class_init,
};

static void om_isc_register(void) { type_register_static(&om_isc_info); }
type_init(om_isc_register)
