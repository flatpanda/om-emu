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
#define A_MEM_MN 0x63fe0000ULL       /* nodes 0..3 shared mem (A53 writes)  */
#define A_MEM_A  0x2a3fe0000ULL      /* node 4 shared mem (peer writes)     */
#define WLOCK 0x200
#define WSCC  0x80
#define WCB   0x400
#define WMEM  0x20000                /* 128 KiB per node                    */
/* shared backend-file layout (must match iscpeer.mjs FileMem) */
#define O_LOCK 0x00000
#define O_SCC  0x01000
#define O_CB   0x02000
#define O_MMN  0x10000
#define O_MA   0x30000
#define BACKEND_MIN (O_MA + WMEM)    /* 0x50000 */

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
    MemoryRegion lock, scc, cb, mem_mn, mem_a;
    MemoryRegion bank[4];
    BankCtx bctx[4];
    qemu_irq irq[4];
    uint32_t pending[4];
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
    alias(s, &s->mem_mn, be, "om-isc.mmn",  O_MMN,  WMEM,  A_MEM_MN);
    alias(s, &s->mem_a,  be, "om-isc.ma",   O_MA,   WMEM,  A_MEM_A);

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
