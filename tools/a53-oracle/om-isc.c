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
#define DOORBELL_VAL 0x4000

typedef struct OmIscState OmIscState;
typedef struct { OmIscState *s; int n; } BankCtx;

struct OmIscState {
    SysBusDevice parent_obj;
    HostMemoryBackend *memdev;
    CharFrontend chr;
    MemoryRegion lock, scc, cb, mem_mn, mem_a, uart;
    MemoryRegion bank[4];
    BankCtx bctx[4];
    qemu_irq irq[4];
    uint32_t pending[4];
};

/* mn_sio_uart console: the transmitter is always ready, so the guest writes the
 * byte without spinning. console_putchar (0xffffff8008293c00) gates the TX store
 * on status(+0x44) bit15 clear AND reg(+0x1c) != 0 (the loader normally seeds
 * +0x1c=1); so +0x44 reads 0 and +0x1c reads 1. TX byte at +0x18 -> stderr. */
#define UART_RDY 0x1c
static uint64_t uart_read(void *opaque, hwaddr off, unsigned size)
{
    return off == UART_RDY ? 1 : 0;
}

static void uart_write(void *opaque, hwaddr off, uint64_t val, unsigned size)
{
    if (off == UART_TX) {
        fputc((int)(val & 0xff), stderr);
        fflush(stderr);
    }
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
    if (off == OFF_A53) {             /* irqarm acks by writing pending back */
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
    qemu_chr_fe_set_handlers(&s->chr, om_isc_can_rx, om_isc_rx, NULL, NULL,
                             s, NULL, true);
}

static const Property om_isc_props[] = {
    DEFINE_PROP_LINK("memdev", OmIscState, memdev,
                     TYPE_MEMORY_BACKEND, HostMemoryBackend *),
    DEFINE_PROP_CHR("chardev", OmIscState, chr),
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
