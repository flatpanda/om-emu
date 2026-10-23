# A53 oracle

A development-only oracle for the OM-1 line's Cortex-A53 (`docs/a53-spec.md`): it
boots the camera's real A53 Linux on QEMU inside the throwaway `om-emu` VM and
drives the custom hardware windows far enough to bring the Inter-System
Communication (ISC) link up, so the per-port protocols can be read from the
A53's own daemons. **None of this ships in `emu/`** -- the emulator stays pure
JS and must not depend on QEMU. This is the cross-check that tells a future JS
"A53 service" what its replies should be.

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
| `iscpeer.mjs` | **the MN half of ISC outside QEMU**: control block + FIFOs + doorbell, with a `selftest` |

## Prerequisites (inside the VM only)

OrbStack Linux VM `om-emu` (Arch Linux ARM, aarch64). Already present:
`qemu-system-aarch64` 11.1.2, `gdb`, `dtc`, `binutils` (GNU `objdump`),
`squashfs-tools`, `nodejs`, `python`. Nothing extra was installed for this track;
a patched-QEMU build (see "Bringing ISC up") would add `base-devel`, `ninja`,
`glib2`, `pixman` via `pacman`. Host side: nothing is installed or downloaded.

## Extract (outside git, into a fresh dir)

```
node emu/bin/fetch-fw.mjs                      # downloads the updater .BIN (untracked)
python3 -I tools/olyfw.py <E143.BIN> --dump    # the blk05a00000 0106 bundle
# walk the nested OE table, carve BL31 / nep1.dtb / Image / rootfs.sqfs:
#   BL31  block-file-offset 0x29807e0   DTB 0x2986fe0
#   Image 0x2989fe0                     squashfs 0x2f10fe0
# unsquashfs the rootfs; dtc -I dtb -O dts nep1.dtb > nep1.dts
# node qdts.mjs nep1.dts virt-nep1.dts        # the virt DT for qrun.sh
```

Put `Image`, `rootfs.sqfs`, `virt-nep1.dts` in one dir; `export IMG=<that dir>`.

## Reproduce

```
# phases a/b: console + userspace (reached)
IMG=$IMG bash qrun.sh 25 && node dmesg.mjs /tmp/a53run/ram.bin | tail
#   -> full boot banner, /sbin/init, rcS, sccore/hhhr/dbgterm start

# phase c: ISC. On stock virt the custom windows have no backing, so:
node dmesg.mjs /tmp/a53run/ram.bin | grep isc
#   -> isc: isc_start failed -6        (measured, X)

# the MN-side transport, verified with no QEMU:
node iscpeer.mjs selftest              # control-block magic + FIFO round-trip
node iscpeer.mjs magic                 # the isc_start magic for this config

# read the port protocols from the daemons (inside the VM):
ROOT=<extracted rootfs> bash dis-daemons.sh
```

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

## Why phase c stops, measured (X)

Two runs, both proving the windows have no backing on stock virt:

- `-m 2G` (RAM region `0x40000000..0xC0000000`, covering the `0x97xxxxxx`
  windows): `isc: isc_start failed -6`. `-6` = `ENXIO` from the control-block
  `__ioremap` returning NULL (`iscdrv.ko+0x2288`/`+0x2298`): arm64 refuses to
  ioremap an address the machine presents as RAM.
- `-m 1024M` (RAM ends `0x80000000`, windows unassigned): the first access to an
  ISC window raises a *Synchronous External Abort* (`0x96000010`) -- unassigned
  MMIO on virt faults. (This run also aborts earlier in boot for an unrelated
  size reason, so the clean citation is the `-m 2G` stop.)

So `isc_start` cannot succeed on any stock-virt memory size: the control block,
lock, shared memory and doorbells must be *backed* and the doorbell must raise
IRQ 14. That is the device model's job.

## Bringing ISC up (the device model) and the wall

The data plane is solved and committed: `iscpeer.mjs` implements the MN half
(control-block magic + node count + FIFO offsets; `isc_send`/`isc_receive` FIFO
format; doorbell writes) and its `selftest` round-trips a port-26 request and a
port-27 start-complete through the exact encoding `iscdrv.ko` uses. The two ways
to give it a live A53 to talk to:

1. **memory-backend-file (no QEMU patch).** Back all guest RAM with
   `-object memory-backend-file,id=m,size=2G,mem-path=guestram.bin,share=on
   -machine memory-backend=m`, shrink the DT `memory` node so the kernel's RAM
   ends below a gap, and relocate the ISC windows into that gap (still inside the
   backing file, so ioremap succeeds *and* the bytes persist). `iscpeer.mjs` in
   `file` mode mmaps `guestram.bin` at `offset = addr - 0x40000000` and reads/
   writes the control block and FIFOs directly. Relocating means binary-patching
   the fixed addresses: `config_isc_cb_addr` / `config_isc_mem_addr[4]` in
   `iscdrv.ko`'s `.data`, and `isc_lock_init` / `scc_init` in the kernel `Image`;
   the four `irqcon` banks are DT-overridable. This gets the **control block and
   FIFOs exchanging both directions**.

2. **a small QEMU sysbus device (patch).** One device covering `0x97000000`
   (lock, as RAM with a working exclusive monitor), `0x97f00000` (scc + control
   block), the four `irqcon` banks, and `0x2_a3fe0000` (shared mem); a QMP/chardev
   bridge so `iscpeer.mjs` drives the FIFOs and, crucially, pulses GIC SPI
   `0x1c0` (-> IRQ 14) when the MN rings `bank0+0x880`. Build from the Arch
   `qemu-system-aarch64` PKGBUILD source inside the VM.

**The wall:** the MN->A53 doorbell is an *interrupt*. A plain shared file
(option 1) and the QEMU monitor cannot inject a GIC SPI, so the A53's
`isc_receive_wait` -- which sleeps on the IRQ-14 waitqueue -- never wakes, even
with the FIFO correctly filled. Raising IRQ 14 needs either the device (option 2)
or a gdb-scripted `$pc`-forced call into `isc_receive_interrupt` after each MN
write (hacky but possible with the existing gdb harness). A full live round-trip
was therefore not completed in this session; option 2 is the clean finish. The
protocol table below was read statically from the daemons, which does not need
the live loop.
