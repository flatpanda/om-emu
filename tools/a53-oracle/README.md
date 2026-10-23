# A53 oracle

A development-only oracle for the OM-1 line's Cortex-A53 (`docs/a53-spec.md`): it
boots the camera's real A53 Linux on a patched QEMU inside the throwaway `om-emu`
VM, backs the custom ISC hardware windows with a small device, and brings the
Inter-System Communication (ISC) link **fully up live** -- `isc_start` succeeds,
and an external MN-side peer exchanges real messages both directions with the
A53's own daemons. **None of this ships in `emu/`** -- the emulator stays pure JS
and must not depend on QEMU. This is the cross-check that tells a future JS "A53
service" what its replies should be.

Live result (X, reproducible with `run-isc.sh`): the A53 sends its port-27
start-completion `{01 00 00 00}`; a port-26 kind-3 request is received by the
A53 over IRQ 14, which forks its survival child and replies on port 27 echoing
the requested size; and `hhhr` answers a port-30 request with a 112-byte reply
on port 31 to node 0. See `docs/a53-spec.md` 9.

Firmware and extracted filesystems are untrusted data: run them only inside the
VM, never on the macOS host. Nothing extracted is committed; re-derive it by
path/offset as below.

## What is here

| File | What it does |
|---|---|
| `qrun.sh` | boot the A53 `Image` + `rootfs.sqfs` on `qemu-system-aarch64 -M virt`, dump RAM |
| `qdts.mjs` | turn the camera DT (`nep1.dts`) into a virt variant (GIC/RAM/SPI fixups) |
| `mon.py` | tiny QEMU monitor client (used by `qrun.sh`) |
| `dmesg.mjs` | read the Linux 4.14 printk ring out of a RAM dump |
| `dis-daemons.sh` | disassemble `iscdrv.ko` + the ISC daemons and print each port's ISC calls |
| `iscports.mjs` | helper: list `ISC_*` calls with their node/port immediates |
| `iscpeer.mjs` | **the MN half of ISC outside QEMU**: control block + FIFOs + doorbell, with a `selftest` and a `live` mode |
| `om-isc.c` | the QEMU sysbus device: backs the ISC windows + irqcon banks, bridges doorbells |
| `om-isc-qemu.patch` | the board hook (`hw/arm/virt.c`) + `hw/misc/meson.build` line for the device |
| `build-qemu.sh` | fetch + patch + build the aarch64 QEMU with the device (into `$HOME/qemu-om`) |
| `run-isc.sh` | boot the A53 live and run the MN peer; capture the ISC traffic |

## Prerequisites (inside the VM only)

OrbStack Linux VM `om-emu` (Arch Linux ARM, aarch64). Already present:
`qemu-system-aarch64` 11.1.2 (for the static harness), `gdb`, `dtc`, `binutils`
(GNU `objdump`), `squashfs-tools`, `nodejs`, `python`, and the build deps
`base-devel`, `ninja`, `meson`, `glib2`, `pixman` (the patched build needs these;
install any missing with `sudo pacman -S --needed`). Host side: nothing is
installed or downloaded.

## Extract (outside git, into a fresh dir)

```
node emu/bin/fetch-fw.mjs                      # downloads the updater .BIN (untracked)
python3 -I tools/olyfw.py <E143.BIN> --dump    # the blk05a00000 0106 bundle
# walk the nested OE table, carve BL31 / nep1.dtb / Image / rootfs.sqfs:
#   BL31  block-file-offset 0x29807e0   DTB 0x2986fe0
#   Image 0x2989fe0                     squashfs 0x2f10fe0
# unsquashfs the rootfs; dtc -I dtb -O dts nep1.dtb > nep1.dts
```

Put `Image`, `rootfs.sqfs`, `nep1.dts` in one dir; `export IMG=<that dir>`.
`run-isc.sh` generates the virt DT from `nep1.dts` itself (via `qdts.mjs`).

## Reproduce

```
# build the patched QEMU with the om-isc device (into $HOME/qemu-om)
bash build-qemu.sh

# bring ISC up LIVE: boot the A53, run the MN peer, exchange messages.
# args are scripted MN->A53 sends, "afterMs:node:port:hex".
IMG=$IMG bash run-isc.sh 45 \
    16000:4:26:0300000040000000      # a port-26 kind-3 request, 0x40 bytes
#   -> [peer] RX node 1 port 27 [01 00 00 00]   the A53 start-complete
#   -> [peer] RX node 1 port 27 [40 00 00 00]   the kind-3 child's reply (size echo)

IMG=$IMG bash run-isc.sh 55 \
    14000:4:26:0100000000000000      \  # kind-1: the A53 runs /etc/init.d/wifi
    26000:4:30:000000...<48 hex 00>     # an hhhr job (count 0)
#   -> [peer] RX node 0 port 31 [...112 bytes...]   hhhr's reply to CPU 0

# the MN-side transport also self-checks with no QEMU at all:
node iscpeer.mjs selftest     # control-block magic + FIFO round-trip

# static side: the static harness (stock VM qemu) and the daemon decode
IMG=$IMG bash qrun.sh 25 && node dmesg.mjs /tmp/a53run/ram.bin | tail
ROOT=<extracted rootfs> bash dis-daemons.sh
```

On **stock** (unpatched) virt the custom windows have no backing, so `qrun.sh`
stops at `isc: isc_start failed -6` -- the measurement that motivates the device.

## The custom hardware windows (decoded for the device model)

All register facts are **D** from the A53's own aarch64 code at the address
shown (`iscdrv.ko` offsets, or kernel VAs against `vmlinux.elf`); doorbell/IRQ
numbers cross-check the MN side in `docs/hle-gaps.md` 4.11.1.

- **`mn_sio_uart` console** `0x9a500600` (D, `mn_sio_uart_serial_out`
  `0xffffff80082934e8`): TX byte at `membase+0x18`, status at `+0x44` bit 15 =
  "not ready". That is the whole model for console output; already reached on
  virt (phase a). The real block is `ntcj,mn-sio-1-uart`; the virt UART stood in
  for phases a/b.
- **`irqcon`** four MN INTC banks `0x99200000 / 0x99300000 / 0x99b00000 /
  0x99b80000` (D, `nep1.dts` `irqcon@99200000`, and the same four in iscdrv's
  `.rodata+0x110`). GIC parents SPI `0x1c0/0x1c2/0x1c4/0x1c6`. A53-side use
  (D, `irqam32_notify` `0xffffff800826fd98`, `irqam32_entry`
  `0xffffff800826fe28`): a *notify* writes `(1<<bit)` at `bank+0x800+(k-1)*8`;
  the *entry* reads the pending word at `bank+0x880+k*4`, acks by writing it
  back, then demuxes to the handlers registered by `irqarm_entry_handler`. The
  ISC receive handler is registered on virtual IRQ **14** (D, `isc_system_init`
  `iscdrv.ko+0xa80`: `irqarm_entry_handler(14, isc_receive_interrupt)`).
- **ISC doorbells** (D, `isc_send` `iscdrv.ko+0x1c48`, tail `0x1ea4..0x1f40`):
  to send to node `n`, write `0x4000` to `isc_driver+[24+8*n]` i.e. the bank for
  that node, `+0x800` for nodes 0..3 and `+0x880` for node 4. The bank order is
  the `.rodata+0x110` array above. So the A53 rings the MN by `0x4000` ->
  `bank(node)+0x800`; the MN rings the A53 by `0x4000` -> `bank0+0x880`
  (`0x99200880`), which must raise the A53's IRQ 14.
- **ISC hardware lock** `0x97000000`, `0x200` bytes (D, `isc_lock_init`
  `0xffffff8008583460` ioremaps `0x97000000` len `0x200`). Per-id byte at
  `lockbase + 64*id` (`id`=7 for the drv lock); `isc_send` takes it with an
  LL/SC exclusive byte (`ldaxrb`/`stlxrb`, `iscdrv.ko+0x1d24`). Model as normal
  (not device) memory so the exclusive monitor works.
- **SCCORE control** `0x97f00b80`, `0x80` bytes (D, `scc_init`
  `0xffffff80085833e4` ioremaps it). Plain storage for phase c.
- **ISC control block** `0x97f00c00`, `0x400` bytes, and **shared memory**
  128 KiB per node at `0x63fe0000` (nodes 0..3) / `0x2_a3fe0000` (node 4)
  (D, `iscdrv.ko` `.data`: `config_isc_cb_addr/size`, `config_isc_mem_addr[5]`,
  `config_isc_channel_nr=0x30`, `config_isc_drv_lock_id=7`). Layout and the FIFO
  format are in `iscpeer.mjs` and `docs/hle-gaps.md` 4.11.1.
- **`mn-mmc`** SDIO `0x9ac02000` (CYW43455): model as "no card / no SDIO
  device" so `isc_olnet`'s Wi-Fi bring-up fails cleanly (see `docs/a53-spec.md`
  6). Not needed for ISC itself.

Every window a device model does not implement should **log loudly** (an
unassigned-access abort, as virt already does -- see below), never silently
return 0.

## Why stock virt stops (X), and how the device fixes it

On **stock** virt with `-m 2G` the windows fall inside the machine RAM span, and
arm64 `__ioremap` refuses to map RAM, so `isc_lock_init` / `irqcon` / `isc_start`
all fail (`isc: isc_start failed -6`, `ENXIO`). The `om-isc` device + patch solve
every piece:

- **Backing at the true addresses.** `om-isc` aliases one shared
  `memory-backend-file` into system memory at `0x97000000` (lock, normal RAM so
  the LL/SC monitor works), `0x97f00b80` (scc), `0x97f00c00` (control block +
  FIFOs), `0x63fe0000` and `0x2_a3fe0000` (the bulk `alloc_mem` pool), all at
  *higher priority* than the machine RAM so they override it. `run-isc.sh` also
  passes `mem=0x5140000` so the kernel's own RAM stays the A53's real 81 MiB and
  these windows are not "RAM" to `__ioremap` (which then succeeds). The peer
  (`iscpeer.mjs live`) mmaps the same file and reads/writes the control block and
  FIFOs directly; its address->offset map matches the device's `O_*` layout.
- **The receive interrupt.** The A53's `isc_receive_wait` sleeps on the IRQ-14
  waitqueue with no timeout, so MN->A53 needs a real interrupt. `om-isc` models
  the four `irqcon` banks as MMIO; a byte from the peer on the chardev sets
  `bank0 +0x880` bit 14 (`0x4000`) and raises the bank's GIC SPI (level, lowered
  on the guest's ack). The board hook wires the banks to GIC SPIs
  `0x1c0/0x1c2/0x1c4/0x1c6`, which the A53's `irqcon` driver *requires*
  (`irqcon_postcore_init` hardcodes `irq-0x1c0 <= 7`, D at kernel
  `0xffffff8008583268`); virt's GIC is widened to `NUM_IRQS 512` in the patch so
  it can represent SPI `0x1c6`. `irqcon` then demuxes SPI `0x1c0` bit 14 to the
  handler registered by `isc_system_init` (`irqarm_entry_handler(14, ...)`), i.e.
  `isc_receive_interrupt`.
- **A53->MN** needs no guest interrupt: the A53 rings `bank(n)+0x800`, an MMIO
  write `om-isc` catches and forwards to the peer as one byte, after which the
  peer drains that node's FIFO.

The `om-isc` device logs any offset it does not model via `LOG_UNIMP` and reads 0.

### Measured live (X, `run-isc.sh`)

- `isc_start` succeeds (no `-6`); the A53 posts port-27 `{01 00 00 00}`.
- A port-26 kind-3 request is delivered over IRQ 14; the A53's survival child
  replies on port 27 echoing the requested malloc size (send `0x40` -> reply
  `{40 00 00 00}`), a full MN->A53->MN round-trip.
- `hhhr` answers a 48-byte port-30 request with a 112-byte reply on port 31 to
  node 0 (CPU 0) -- matching the static decode.
