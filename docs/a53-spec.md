# The OM-1's Cortex-A53: firmware, hardware and an LLE plan

What the OM-1 line's second processor is, what it runs, the hardware it sees, and what it would take to emulate it
low-level (LLE) by running its own kernel and userland instead of a JS stand-in. This is a reverse-engineering spec
like the others under `docs/`; nothing here is wired into `emu/` yet. The MN side's view of the A53 (how CPU 1 powers
it and talks to it over ISC) is in `docs/hle-gaps.md` §4.6, §4.11 and §4.11.1 and `docs/om1-cores-spec.md`; this
document is the A53 side.

Evidence tags (as in `docs/README.md`): **D** read from the firmware's code or data with the address shown; **X**
executed or measured by a named command; **I** inference; **?** unknown. Addresses in the main MN code block are
disassembly notation (body offset + `0x50000000`); addresses inside the A53 image are either Linux kernel virtual
addresses (`0xffffff8008......`) or A53 physical addresses (small, e.g. `0x40000`). "Block file offsets" are offsets
into the descrambled `blk05a00000.OE.0106` block, the same convention `analysis/` uses.

The firmware is untrusted data: everything here was read statically, or executed only inside the throwaway
`om-emu` QEMU VM, never on the host. The A53 image is not in the committed tree; re-derive it with
`node emu/bin/fetch-fw.mjs` and `python3 -I tools/olyfw.py <BIN> --dump`.

## 1. Which bodies have an A53, and what it does

**Bodies (D).** Only the OM-1 line carries a Cortex-A53: **E143** (OM-1), **E146** (OM-1 Mark II), **E147** (OM-3).
All three updater `.BIN`s carry block `blk05a00000` with flags `0x0106` (E143 len `0x891ffc0`, E146/E147 len
`0x88dffc0`), and inside it the same bundle: a BL31, a flattened device tree, an arm64 `Image`, and a squashfs root
(X, `tools/olyfw.py --dump` + `scratchpad/a53/tools/nest.mjs`; E147's 0106 was extracted to scratch and checksums,
correcting an earlier belief that E147's update lacked it). The three kernels are the same `Linux version 4.14.222`
built by `omds`, differing only in build date and the rootfs contents (X, `cmp3.mjs`). The main MN code block names
`SYS_CA53_PWR_MNG`, `TSK_CA53PWR_MNGR` and the "ARM Cortex-A53 start" strings in all three.

Bodies **E134/E137/E139/E140/E142/E144/E145** have no A53; they carry a **Cortex-A9** in the SoC running Linux
(3.10.108 on E134, 4.4.127 on the others; DT `panasonic,dc13`) with the **same** `isc_olnet` / `isc_socket` /
`lighttpd` / `hostapd` / BSA / `hhhr` userland. **E125/E130** carry an A9 running an ITRON-style networking image over a
2-node ISC; **E122** runs everything on the MN. See §8 for how the LLE plan generalises to the A9. (These A9 facts are
from a separate read-only survey, material in `scratchpad/net/`; not re-verified here except the E147 0106 correction.)

**Roles the A53 plays (D, from the rootfs userland and the ISC port map).** The A53 is the OM-1's network and
heavy-math coprocessor. The 32-bit ARM daemons (the rootfs is armhf userland on an arm64 kernel; `CONFIG_COMPAT=y`,
kernel prints "32-bit EL0 Support", X) are the far end of CPU 1's network tasks:

| A53 program | What it is | ISC endpoint (D, `iscports.mjs` over the daemons) |
|---|---|---|
| `sccore` | the A53-side power/survival manager, counterpart to `SYS_CA53_PWR_MNG`; runs `/etc/init.d/wifi start`; also a NEON freerun benchmark | recv port 26, send port 27 (the SYS_CA53_PWR_MNG / start-complete pair); also 14, 32 |
| `hhhr` | Handheld High Res compute: solves/multiplies matrices (strings "(MulMat) input/output matrix size error"), links libm (`sqrt`,`atan`) and uses NEON; mmaps `/dev/mem` for the image buffers | recv port 30, send node 0 port 31 (IMGPRO_HHHR) |
| `isc_socket` | BSD socket API bridge for the MN's network stack | recv port 3, send port 4 (16 sites) |
| `isc_olnet` | Wi-Fi manager: loads `mn-sdmmc.ko` + `bcmdhd.ko`, drives `wpa_supplicant`/`hostapd`/`dhcpcd`/`dnsmasq`, `wl` | recv port 20, send 19/21 |
| `isc_cgi` (fcgi) | OI.Share HTTP CGI relay under lighttpd (`.cgi`) | ports 11..16 |
| `isc_file` (fcgi) | file/media serving for the web UI (`.jpg/.orf/.mov/...` map to it) | recv port 6, send 5/8 |
| `wifi_remocon`/`wifi_upnp`/`wifi_mdns` | remote-control, UPnP, mDNS responders | 1/2, 24, 25 |
| `blebridge` + `bsa_server` | BLE via Broadcom BSA over `/dev/ttyS1` and `BCM4345C0...hcd` | send node 1 port 28, recv 28, send 29 |
| `dbgterm_server` | debug terminal relay | port 15 |
| `isc_test` | factory/shell test tool (ports 47/49) | 47, 49 |

So, answering the open questions: **HHHR is really computed on the A53** (D: `hhhr` does the matrix math in NEON on
image buffers it mmaps, keyed by ISC ports 30/31), not merely coordinated. **The network stack (Wi-Fi/BLE/HTTP/PTP-IP)
lives on the A53**: the radio is a Cypress/Infineon **CYW43455** on SDIO (`bcmdhd`), BT on its Broadcom BSA half over
`/dev/ttyS1`. **USB (dwc3) is NOT an A53 role**: `CONFIG_USB_SUPPORT is not set` in the A53 kernel (D), and both dwc3
nodes, though `okay` in the DT, have no driver here — USB/PTP/MTP/MSC stays on the MN (`docs/hle-gaps.md` §4.10). The DT
also lists Ethernet (`dwmac`, `disabled`) and nine serial/i2c/spi ports mostly `disabled`.

## 2. Hardware resources (from the DTB and the kernel)

Device tree `compatible = "ntcj,nep1"` (block file offset `0x2986fe0`, 11,724 bytes, D; `nep1.dts`). Kernel config is
embedded (`CONFIG_IKCONFIG`, recovered to `scratchpad/a53/img/kconfig.txt`, X).

- **CPUs:** 2× `arm,cortex-a53`, `enable-method = "psci"`; `CONFIG_NR_CPUS=2`, `CONFIG_SMP=y`. The kernel boots both
  (X: "smp: Brought up 1 node, 2 CPUs", "CPU: All CPU(s) started at EL2"). The MN check code (`0x5003bdab`) refuses to
  start it from any core but CPU 1 (D).
- **DRAM:** `memory@0x00040000 reg = <0x0 0x40000 0x0 0x5100000>` — A53 physical base `0x40000`, size `0x5100000`
  (~81 MiB) (D). The rootfs squashfs sits in RAM just above it at phys `0x5140000` (`slram=mtd0,0x05140000,+0x00ec0000`
  in the bootargs); the kernel maps it as `/dev/mtdblock0` (D, and X: "slram: Mapped ... Mounted root (squashfs)").
  This DRAM is a window the MN places the image into; the ISC shared memory lives at A53 phys `0x2_a3fe0000` vs the
  MN's `0x63fe0000` for nodes 0..3 (`docs/hle-gaps.md` §4.11.1), a `0x2_40000000` offset (D). The A53 has **no flash
  of its own** — root is RAM-resident squashfs, `init=/temproot` overlays a tmpfs on top (D, `temproot` + `inittab`).
- **How the image gets there (D, MN side `0x5003bcd9`..`0x5003c953`).** The MN "load arm linux" path reads five parts
  named in `C:\relbin\`: `mapinfo`, `bl31.bin`, `imgprod.dtb`, `zImage`, `rfs.squ`. In production they come from the
  0106 block, not SD: the bundle is a table of (loadaddr, len) entries — BL31 at load `0x458c0800`, DTB `0x48247000`,
  `Image` `0x4824a000`, squashfs `0x487d1000`, plus a second BL31 copy and a `mapinfo` record (block file offsets
  `0x29807e0`/`0x2986fe0`/`0x2989fe0`/`0x2f10fe0`/`0x3a5c7e0`, X `nest.mjs`). The MN's `res_read`-style copier
  (`0x501a921f`, with the flash/decompress helper `0x500022c2` → `0x5003f087`/`0x5003ef88`) stages them, then
  `0x5003bcd9` programs the reset/clock registers and `0x5003bd93` (`SYS_CA53_start`) releases the core. `mapinfo` is a
  small table of load parameters (D: words `0x1000`, `0x40000`, `0x80000`, `0x5140000` — the text offset `0x80000`,
  the DRAM base `0x40000`, and the squashfs base `0x5140000` are recognisable).
- **Reset / release and power (D, `0x5003bd93` and `0x5003bcd9`).** `SYS_CA53_start` writes `0x9880034c = 2` and
  `0x98800360 = 0x200000`, the same `0x988003xx` gates "CPU 2"/"CPU 3" use (`docs/om1-cores-spec.md` §4 item 4); then
  sets ISC "up" flags and calls `0x5003bcd9`, which pokes `0x98800438/400/3c0/394` and a run of `0x988003xx`/`0x988004xx`
  clock/reset bits and finally `0x50064057(2,1)`. Exact bit meanings are **?**. The UART select writes `0x9a500614`
  (`ARM_UART1`) to steer the ARM shell to one of SIODBG/IIC7/SD0..2.
- **EL3 / PSCI (D).** There is a real **ARM Trusted Firmware BL31** in the bundle: `v2.2(release)` built 2024-04-08,
  strings `BL31: %s`, `arm_arch_svc`, `std_svc`, `PSCIv1.1`; its reset head sets `SCTLR_EL3`/`VBAR_EL3`/`SCR_EL3`
  (X, `objdump` of `scratchpad/a53/img/bl31a.bin`). PSCI `method = "smc"` → BL31 at EL3. A second BL31 variant adds an
  lz4 decompressor (strings `SSC_DECMP START`, `lz4 decomp`, `ca53b_write32`). So the SMC/PSCI provider is firmware we
  possess, not the MN. At boot the kernel finds "PSCIv1.1 detected" and starts at EL2 (X on QEMU with a stub BL31).
- **Clocks (D, DT):** periclk 48 MHz, sioclk 96 MHz, padclk 100 MHz, clock_mac ~576 MHz, clock_ptp/micrel 50 MHz;
  fixed-clocks only. Timer is `arm,armv8-timer`.
- **Peripherals the kernel actually probes (X, QEMU boot log + builtin-module list):** GICv3, arch timer, PSCI, the MN
  UART (`ntcj,mn-sio-1-uart`: console `ttyS0`@`0x9a500600`, `ttyS1`@`0x98300000`), `mn-mmc`@`0x9ac02000`
  (`non-removable`, the SDIO to the CYW43455), slram/mtdblock, squashfs, overlayfs, the full IPv4/IPv6/netfilter stack,
  cfg80211, `i2c-mn`/`spi-mn` cores, evdev, framebuffer core. `iscdrv.ko`, `bcmdhd.ko` and `mn-sdmmc.ko` are
  out-of-tree modules loaded at runtime.

## 3. Device table with driver status

Addresses are A53 physical (from `nep1.dts`). "Driver" names the kernel symbol or module; "status" is what an LLE must
provide to reach each phase (§4).

| Device | Address(es) | Driver (D) | Kind | For LLE |
|---|---|---|---|---|
| GICv3 dist/redist | `0xa0080000` / `0xa00c0000` | `irq-gic-v3` (standard) | standard | model GICv3 (or reuse one); needed before any IRQ |
| arch timer | — (sysreg) | `arm_arch_timer` | standard | CNTP/CNTV sysregs + one PPI; needed for the scheduler |
| PSCI / EL3 | smc | ARM TF BL31 v2.2 (in bundle) | standard-ish | run BL31, or stub `CPU_ON`/`SYSTEM_OFF`/`PSCI_VERSION` |
| UART console | `0x9a500600` (ttyS0), `0x98300000` (ttyS1) | `mn_sio_uart` (builtin) | **custom** | TX reg at membase+`0x18`, status at `+0x44` bit15; see §5 |
| irqcon | `0x99200000`/`0x99300000`/`0x99b00000`/`0x99b80000` | `irqcon_postcore_init`, `irqam32_*` (builtin) | **custom** | the four MN INTC banks; A53 side of the IPI/doorbell |
| ISC hw lock | `0x97000000` (+`0x200`) | `isc_lock_init` → ioremap | **custom** | byte-per-id test-and-set lock array (`0x97000000+64*id`) |
| SCCORE ctrl | `0x97f00b80` (len `0x80`) | `scc_init` → ioremap | **custom** | part of the `0x97f00000` shared block |
| ISC control blk / FIFOs | `0x97f00c00` (1 KiB), shmem `0x2_a3fe0000` (128 KiB) | `iscdrv.ko` | **custom** | the transport (`docs/hle-gaps.md` §4.11.1) |
| SD/MMC (SDIO) | `0x9ac02000` etc. | `mn-sdmmc.ko` + `bcmdhd.ko` | **custom** | model enough that `isc_olnet` insmod succeeds, or stub |
| Wi-Fi radio | CYW43455 on SDIO | `bcmdhd` + firmware blobs | external | stub absent, or model for daemons to start (§6) |
| BT | `/dev/ttyS1` + BCM4345C0 hcd | BSA `bsa_server` | external | stub the UART; BSA will fail gracefully |
| dwc3 USB2/USB3 | `0x98f00000` / `0x9a600000` | none (`USB_SUPPORT` off) | absent here | leave unprobed; USB is MN-side |
| dwmac Ethernet | `0x98a00000` | `stmmac` | disabled | none |
| i2c/spi (9 ports) | `0x98xxxxxx` | `i2c-mn`/`spi-mn` | mostly disabled | none for phases a–c |

**Custom `mn_sio_uart` register model (D, kallsyms `mn_sio_uart_serial_in/out` at
`0xffffff80082934b0`/`..e8`).** `serial_out(port, off, val)`: membase `= *(port+0x10)`; for `off` in `[0x40,0x54]`
add a bank from `*(port+0x190)`; store word at `membase+off`; `dsb`. `console_putchar` polls status `off 0x44`
(`tst #0x8000`) then writes the byte to `off 0x18`. That is the whole model needed for console output: a word FIFO at
`+0x18` and a status word at `+0x44` whose bit 15 means "not ready". (Recovered via the kernel's own `kallsyms`, which
`scratchpad/a53/tools/kallsyms2.mjs` reconstructs — 18,181 symbols, base-relative, no separate `System.map` needed.)

**The custom ISC windows, decoded register by register (D).** These are the four windows phase (c) needs; each fact
is read from the A53's own aarch64 code (`iscdrv.ko` offsets, or kernel VAs against `vmlinux.elf`) and cross-checks the
MN side in `docs/hle-gaps.md` §4.11.1. The oracle models them; `tools/a53-oracle/README.md` holds the same table with
the reproduction.

- **`irqcon`** banks `0x99200000 / 0x99300000 / 0x99b00000 / 0x99b80000` (D, DT `irqcon@99200000`; same four in
  `iscdrv.ko` `.rodata+0x110`), GIC parents SPI `0x1c0/0x1c2/0x1c4/0x1c6`. A53-side model (D, `irqam32_notify`
  `0xffffff800826fd98`, `irqam32_notify_k` `..fe28`): a *notify* stores `(1<<bit)` at `bank+0x800+(k-1)*8`; the receive
  *entry* (`0xffffff800826fe48`) reads the pending word at `bank+0x880+j*8` (`j` = the SPI's low bit), acknowledges by
  writing the bits it saw (low 16) to `bank+0x884+j*8`, a write-1-to-clear register (the store at `0xffffff800826fef8`),
  then calls the handler registered by `irqarm_entry_handler` for each set bit. (An earlier reading here had the ack
  as a write back to `+0x880`; with that model the level line never dropped and CPU 0 stayed in the handler, X: an
  RCU stall with CPU 0's PC at `0xffffff800826fef8`.)
  The ISC receive handler sits on virtual IRQ **14** (D, `isc_system_init`
  `iscdrv.ko+0xa80`: `irqarm_entry_handler(14, isc_receive_interrupt)`) — this is the A53's counterpart to the MN's
  receive IRQ 323.
- **ISC doorbells** (D, `isc_send` `iscdrv.ko+0x1c48`, tail `0x1ea4..0x1f40`): to reach node `n`, write `0x4000` to
  `isc_driver+[24+8*n]` (the bank for node `n`), offset `+0x800` for nodes 0..3 and `+0x880` for node 4. So the A53
  rings an MN core by `0x4000 → bank(n)+0x800`, and the MN rings the A53 by `0x4000 → bank0+0x880` (`0x99200880`),
  which must raise A53 IRQ 14.
- **ISC hardware lock** `0x97000000` len `0x200` (D, `isc_lock_init` `0xffffff8008583460`): per-id byte at
  `lockbase + 64*id`, taken with an LL/SC exclusive byte (`ldaxrb`/`stlxrb`, `iscdrv.ko+0x1d24`) — so it must be
  *normal* memory, not device, for the monitor to work. **SCCORE control** `0x97f00b80` len `0x80` (D, `scc_init`
  `0xffffff80085833e4`) is plain storage for phase (c).
- **ISC control block** `0x97f00c00` len `0x400` and **shared memory** 128 KiB/node at `0x63fe0000` (0..3) /
  `0x2_a3fe0000` (4) (D, `iscdrv.ko` `.data`: `config_isc_cb_addr/size`, `config_isc_mem_addr[5]`,
  `config_isc_channel_nr=0x30`, `config_isc_drv_lock_id=7`). `isc_start` (`iscdrv.ko+0x2228`) ioremaps the block,
  checks `cb[0]` == `0x1000 | (config byte-sum & 0xff)`, reads `cb[2]` (node count) and the per-node u16 FIFO offsets
  at `cb+8`, sets its own (node-4) FIFO `state 0x1000→0x2000`, and drains. `cb+4` is the pool's **metadata size**,
  not the pool size: `isc_start` maps that many bytes of the pool for the allocator (`ioremap_cache`, `0x2314`) and
  passes it to `memblock_init` (`0x263c`), which keeps it `>> shift` as the first block `memblock_check` accepts
  (`0x3420`); with `0x20000` there every `ISC_attach_mem` failed `-1` (X). Each FIFO header's `+8` u32 is the page
  frame of that node's view of the pool: `isc_mem_paddr` (`0x2830`) adds it `<< 12` to `block << shift` for the
  attach's `vm_mmap` (`0x5bc`) (D); left 0, an attach mapped physical page `block` outside the pool (X).
  FIFO header and message format are in
  `docs/hle-gaps.md` §4.11.1 and implemented in `tools/a53-oracle/iscpeer.mjs`.

## 4. LLE feasibility: phases and the minimum device set

Measured on the `om-emu` QEMU VM by booting the real `Image` with the real DTB (with the GIC moved to virt's
addresses, the two out-of-range SPIs renumbered into virt's 64, and `mem=` capping RAM — oracle changes only; see §7).
These phases are the device budget for an in-emulator LLE, whatever engine runs it.

- **(a) Kernel console output.** Needs: a way to enter the kernel at EL2/EL1 with the DTB in `x0`, GICv3, the arch
  timer, and the `mn_sio_uart` console (§5). PSCI can be stubbed. **Reached (X):** on QEMU the kernel prints the full
  boot banner through `ttyS0`; with the stock virt GIC it even boots without any custom irqcon (it only warns
  "irqcon_init_map failed" and carries on). So console is cheap: UART + GIC + timer.
- **(b) Userspace init.** Additionally needs slram+squashfs (both standard, already in the kernel) and the second CPU
  (or `nosmp`). **Reached (X):** QEMU reaches `/sbin/init`, runs the rcS scripts, mounts the overlay, and starts
  `syslogd`/`klogd`/`haveged`/`network`/`sccore`/`hhhr`/`dbgterm_server`. The UART trace (`qgdb.sh`, a gdb breakpoint on
  the UART TX register) shows it all the way to "Starting OLYMPUS APP..." and "dbgterm server start!!".
- **(c) ISC up far enough to answer CPU 1.** Needs the custom devices: `irqcon` (so `iscdrv.ko` can hook its receive
  IRQ 323), the ISC hw-lock at `0x97000000`, the ISC control block at `0x97f00c00` with node-4's FIFO, and the
  doorbell at bank `+0x880`. On bare QEMU `iscdrv` cannot start (X: "isc: isc_start failed -6", `ENXIO`, because none
  of those windows exist and `scc_init`/`isc_lock_init`/`irqcon` all `ioremap`-fault), and `sccore`'s first
  `OlyISC_...` call errors. So phase (c) is exactly the work of modelling the four custom windows above plus the
  transport already decoded in `docs/hle-gaps.md` §4.11.1. Once node-4's FIFO and doorbell exist and the MN side (CPU 1,
  or a JS stand-in for it) drains/fills them, `iscdrv` would start and `sccore`/`isc_socket`/`isc_olnet` would get
  replies.
  **Phase (c) result: ISC is up, live (X, `tools/a53-oracle`).** On stock virt `isc_start` fails `-6` (`ENXIO`): with
  RAM covering the windows the control-block `__ioremap` returns NULL, because arm64 refuses to ioremap what the machine
  presents as RAM. A patched QEMU (`om-isc-qemu.patch` + `om-isc.c`, built by `build-qemu.sh`) fixes this: a small
  sysbus device backs the lock (`0x97000000`, as normal RAM so the LL/SC monitor works), scc (`0x97f00b80`), the control
  block + FIFOs (`0x97f00c00`) and the `alloc_mem` pool from a shared memory-backend-file at the true physical addresses
  (high priority over machine RAM; `mem=0x5140000` keeps the kernel's own RAM the real 81 MiB so the windows are not RAM
  and ioremap succeeds). The two pool views `0x63fe0000` (MN) and `0x2_a3fe0000` (A53) now alias **one** backing region,
  so a buffer written on one side is the bytes the other reads (required for the socket `/dev/mem` alias and the CGI pool
  buffers), and the peer writes a valid memblock pool header at the pool base so the A53's `ISC_alloc_mem`/`attach` succeed
  (§9.1, §10 item 6). The device also captures the `mn_sio_uart` console (`0x9a500600`, TX at `+0x18`) to QEMU's stderr,
  so the A53 boot/daemon log is visible. It models the four `irqcon` banks
  and, on an MN→A53 doorbell from the peer, sets `bank0+0x880` bit 14 and raises GIC SPI `0x1c0` — which the A53's
  `irqcon` driver hardwires (`irqcon_postcore_init` requires `irq-0x1c0 <= 7`, D at `0xffffff8008583268`), so virt's GIC
  is widened to 512 IRQs in the patch. `irqcon` then demuxes bit 14 to `isc_receive_interrupt`. The MN half runs outside
  QEMU as `iscpeer.mjs` (control-block magic `0x10f7`, node count, cb-relative FIFO offsets, `isc_send`/`isc_receive`
  FIFO format). **Measured:** `isc_start` succeeds; the A53 posts the port-27 start-complete `{01 00 00 00}`; a port-26
  kind-3 request is received over IRQ 14 and answered on port 27 with the requested size echoed back; `hhhr` answers
  a port-30 request with a 112-byte port-31 reply to node 0; and the A53's own `ISC_alloc_mem` now succeeds against the
  peer's pool (`dbgterm_server` takes the first free block). Since 2026-11-08 the socket and CGI daemons run end to
  end too (X, §9.1, §10 item 7): the console UART got its TX and RX interrupts (so the wifi script's output no longer
  stalls it, and the inittab's console shell takes commands), the irqcon ack moved to `+0x884` (§3), and the peer
  writes the control block's `+4` and each FIFO's `+8` as the A53 reads them (§3). Reproduce with `run-isc.sh`;
  details in `tools/a53-oracle/README.md`.

**Custom vs standard, restated.** Custom (registers must be modelled from the kernel's aarch64 code, done above for the
UART; `irqcon`, `isc_lock`, `scc`, `mn-mmc` remain): `ntcj,irqcon`, `ntcj,mn-sio-1-uart`, the ISC lock/control windows,
`ntcj,mn-mmc`. Standard (reuse a known model or stub): GICv3, arch timer, PSCI/SMCCC, squashfs, slram, dwc3 (not
probed). Wi-Fi/BT hardware: stub as absent for phases a–c; to make the Wi-Fi daemons progress you would model the SDIO
`mn-mmc` enough for `bcmdhd` probe to succeed or intercept at the `wl`/`wpa_supplicant` boundary (§6) — but none of
that is needed to satisfy CPU 1's ISC traffic, which is what the emulator cares about.

## 5. Engine options and a recommendation

The project is pure JS in a browser, so the honest comparison is an in-JS AArch64 interpreter versus an external
engine used only as an oracle.

- **An AArch64 interpreter in JS, inside the emulator.** Instruction subset required (D, from BL31 + kernel `head.S` +
  driver code read above): the A64 base integer/load-store/branch set; the system-register and barrier instructions
  (`MSR`/`MRS` on `SCTLR/VBAR/SCR/MDCR/CPTR/TCR/MAIR/TTBR*/SPSR/ELR`, `ISB`/`DSB`/`DMB`); exception levels EL3→EL1 and
  exception entry/return; **MMU stage-1** (4 KiB pages, 39-bit VA — `CONFIG_ARM64_VA_BITS_39`); the generic timer and
  GICv3 system-register CPU interface (`ICC_*`); and, because the daemons are 32-bit, an **AArch32 EL0** execution mode
  (the kernel confirms "32-bit EL0 Support"). Rough cost, honestly: A64 integer core + load/store + branches ~3–4
  weeks; sysregs + EL model + exceptions ~2–3 weeks; MMU stage-1 + TLB ~2 weeks; GICv3 sysreg interface + timer ~1–2
  weeks; AArch32 EL0 (a second decoder for the user ABI, plus the compat syscall layer the kernel already provides) is
  the big one, ~4–6 weeks and the main reason this is a large undertaking. NEON/FP (needed for `hhhr` and for
  `memcpy`) adds more. Total for "boots to a shell and answers ISC": on the order of a quarter of focused work, versus
  weeks for the HLE ISC-node-4 stand-in that `docs/hle-gaps.md` §4.11 already scopes.
- **An external engine (QEMU/Unicorn).** Already proven here as an oracle (§7): it boots the kernel to userspace in
  seconds. But it is a native dependency and cannot ship inside the pure-JS/browser emulator, so it can only ever be a
  development and cross-check tool, never part of `emu/`.

**Recommendation.** Do not build an A53 interpreter to satisfy the camera GUI. For the emulator's actual goal (running
the MN firmware far enough to reproduce the camera), the A53 only needs to *answer* CPU 1's ISC messages, so the
cheapest correct path is the **HLE ISC-node-4 service** already planned (`docs/hle-gaps.md` §4.11 "Seam"): a JS service
that replies on ports 26/27 (power), 30/31 (HHHR), 1/2, 3/4, 11..16, etc. Keep the real A53 image + QEMU as the oracle
that tells you what those replies should be. Treat a full in-JS AArch64 LLE as a separate, optional long-horizon track
(a "run the camera's own Linux in the browser" showcase), not a prerequisite for anything.

**Scheduling against the MN cores.** CPU 1 owns the A53 (D). The MN side today emulates **CPU 0 only** (`CPU 2`/`CPU 3`
and CPU 1 are stand-ins, `ARCHITECTURE.md` C02). So a *native* A53-answers-CPU-1 loop depends on first having an
emulated CPU 1 and the ISC transport on it — i.e. it sits behind the multi-core work (`docs/hle-gaps.md` §4.6) and the
ISC decode (§4.11.1). **But the A53 can be brought up standalone first**, independent of the MN: a lab loader places
`Image` + DTB (+ squashfs) exactly as the MN loader would (§2) and enters the kernel — which is precisely what the
QEMU harness here does. So an LLE spike (phase a/b) needs no MN emulation at all; only phase (c) needs the MN side (or
a JS stand-in for CPU 1's half of the ISC rings) to exchange messages.

## 6. Wi-Fi / BT hardware

The CYW43455 (SDIO) and its BT half (`/dev/ttyS1` + `BCM4345C0_003.001.025.0144.0266.hcd`) are external. For an LLE
that only needs ISC up (phase c), **stub them as absent**: leave `mn-mmc` returning "no card", and `isc_olnet` /
`blebridge` will report "not available" on their ISC ports — the same seam `docs/hle-gaps.md` §4.11 describes for the
MN side. To actually exercise the Wi-Fi daemons you would either model the SDIO controller enough for `bcmdhd` to
attach to a faked CYW43455 (large, firmware-blob territory) or intercept at the `wl`/`wpa_supplicant`/`hostapd`
boundary. Not worth it for the emulator's goals.

## 7. How the QEMU oracle was set up (reproducible)

Inside the `om-emu` VM (`orb -m om-emu bash -c '...'`; qemu-system-aarch64 11.1.2). Scripts in
`scratchpad/a53/tools/`. The DTB was patched for virt only (`qdts.mjs`): GICv3 moved to virt's `0x8000000`/`0x80a0000`,
the two SPIs above virt's 64-SPI range (`0x1c0..`, `0x15e`) renumbered into range, RAM rebased to virt's `0x40000000`
and `mem=0x5140000` added. Then `qemu-system-aarch64 -M virt,gic-version=3 -cpu cortex-a53 -smp 2 -kernel Image -dtb
... -device loader,file=rootfs.sqfs,addr=...`. QEMU's own PSCI/GIC/timer stand in for BL31 and the SoC. Console was
captured two ways: a RAM dump + `printk` ring reader (`dmesg.mjs`, finds the `__log_buf` via the recovered
`log_buf_addr_get`), and a live gdb breakpoint on the UART TX store (`qgdb.sh` + `uart.gdb`). A per-instruction exec
trace is available via `-d exec,nochain -accel tcg,one-insn-per-tb` for cross-checking a JS interpreter. **None of this
belongs in `emu/`** — it is an oracle only; the emulator stays pure JS.

## 8. The Cortex-A9 sibling design, and whether the LLE plan generalises

The non-OM-1 networked bodies (E134/E137/E139/E140/E142/E144/E145) use the same *architecture* with an ARMv7
Cortex-A9 in place of the A53 (D, from the `scratchpad/net/` survey; DTB `compatible = "panasonic,dc13"`,
`arm,cortex-a9-gic` at `0xa0001000`, `panasonic,l2-system-cache`, `panasonic,mn-sio` UART, `panasonic,mn-mmc`). The MN
boots it from the same `0106` block: on E144 the MN copies `res_read(0x800e, parts 2..6)` to `0xc0000000..` and
releases the A9 via `0x98800160`/`0x9880014c`/`0x98800140` (the A9 analogue of the A53's `0x988003xx` gates), and the
ISC runs with the A9 as node 3 of a 4-node mesh (node ids differ: A53 = node 4, A9 = node 3). The **userland is the
same** (`isc_olnet`/`isc_socket`/`lighttpd`/`hostapd`/BSA/`hhhr`), and the ISC transport is the same shared-FIFO design
(`docs/hle-gaps.md` §4.11.1), just with fewer nodes.

**Does the LLE plan generalise?** The *structure* does, the *engine* does not. The custom-device work (irqcon, MN UART,
MN-MMC, the ISC lock/control windows), the boot handoff (MN stages image + DTB and releases the core), the device-set
phasing (a: console, b: init, c: ISC up) and especially the **HLE ISC-node service recommendation** all carry over
unchanged — the camera-side ISC endpoints are the same program. What differs is the CPU: an A9 LLE needs an **ARMv7
(AArch32) interpreter with an MMU and a GICv1 (`cortex-a9-gic`) model**, not AArch64. Since the A53 userland is itself
32-bit ARM, a JS LLE that already implements AArch32 EL0 (§5) would share its instruction decoder with an A9 core; the
delta is the A9's EL1/privileged ARMv7 system registers, GICv1 and the older `panasonic,*` device variants. For the
emulator's purposes the same conclusion holds: model the ISC seam in JS and use QEMU (qemu-system-arm) as the oracle;
do not build the core unless a standalone "run the camera's Linux" goal justifies it. (E125/E130's A9 runs an
ITRON-style image over a 2-node ISC rather than Linux, and E122 has no coprocessor at all — out of scope here.)

## 9. ISC per-port protocols (D, from the daemon disassembly)

Read statically from the daemons in the extracted rootfs (`tools/a53-oracle/dis-daemons.sh`); this does not need the
live loop. `ISC_send_timeout(node, port, buf, len, timeout)` and `ISC_receive_wait(port, buf, len)` are the ARM
calling convention (r0..r3, 5th on the stack). Every daemon sends to **node 1** (CPU 1) except `hhhr`, which replies to
**node 0** (CPU 0) — confirming CPU 1 owns the A53 while HHHR results return to CPU 0. Bodies larger than the 128-byte
FIFO message move through `ISC_attach_mem` shared buffers (the message then carries a handle/size); those daemons are
tagged "+shmem".

| Daemon | recv port (len) | send port (node, len) | Payload (D) / behaviour |
|---|---|---|---|
| `sccore` | 26 (8) | 27 (node 1, 4) | **The SYS_CA53_PWR_MNG pair (live X).** Port-26 request is 8 bytes, byte0 = kind: `1` → `system("/etc/init.d/wifi start &")`; `2` → stop Wi-Fi, reply on 27; `3` → `fork` a prioritised survival child that mallocs `word@+4` bytes and replies on 27, then loops `memset`+`sleep(30)` (`iscdrv.ko+0x10e00`, D). At init `sccore` sends port-27 `{0x01,0,0,0}` = **start-complete** (the reply CPU 1 waits for) after spawning its 3 threads (`iscdrv.ko+0x10fc4`, D). Confirmed live: start-complete arrives, and a kind-3 request returns a port-27 reply echoing the requested size (X, `run-isc.sh`). Also port 14 (NEON freerun benchmark: recv a trigger, run NEON, send result) and port 32 (recv/echo "arm survival inquiry/reply" heartbeat). |
| `hhhr` | 30 (48) | 31 (node 0, 112) | HHHR compute (live X). Port-30 request 48 bytes (matrix sizes + buffer handle); mmaps `/dev/mem`, `ISC_dcache_clean_range` over the result, replies 112 bytes on port 31 to CPU 0 (`hhhr.dis 0x133a0`, D). Confirmed live: a 48-byte request returns a 112-byte port-31 reply to node 0 (X). |
| `isc_socket` | 3 (64) | 4 (node 1, 64) | BSD-socket bridge. Fixed 64-byte request/response records; 16 send sites = the 16 socket ops (socket/bind/connect/send/recv/…); bulk data through the MN's own buffers, mapped by `/dev/mem` (`isc_socket.dis 0x10e54/0x11220`, D). A TCP server round trip runs live (X, §9.1). |
| `isc_cgi` | 11 (16), 12, 13, 16 (32) | 11 (node 1, 16), 12, 13, 16 (node 1, 32) | OI.Share HTTP CGI relay, the client side: an HTTP request goes to the MN, the MN's reply comes back, through one `ISC_alloc_mem` buffer (`isc_cgi.dis 0x10ea8..0x11914`, D). A GET and a POST run live (X, §9.1). +shmem. |
| `isc_file` / `sd_reader` | 6 (?) | 5, 8 (node 1, ?) | FILEISCAM media serving; +shmem, `dcache_clean_inv_range` over the mapped file buffers (D). |
| `isc_olnet` | 20 (?) | 19, 21 (node 1, ?) | Wi-Fi manager; +shmem. Absent radio → see below. |
| `blebridge` | 28 (?) | 28, 29 (node 1, ?) | BLE bridge to BSA; absent BT → see below. |
| `wifi_remocon` / `wifi_upnp` / `wifi_mdns` | 1, 24, 25 | 1/2, 24, 25 | remote-control / UPnP / mDNS responders; +shmem for 24/25 (D). |
| `dbgterm_server` | 15 | 15 (node 1) | debug-terminal relay; +shmem (D). |
| `isc_test` | 47, 49 | 47, 49 (node 0/4) | factory shell test; the one daemon that also sends to node 4 (self/loopback) (D). |

**Without Wi-Fi / BT hardware (I, from the daemon code + §6).** `mn-mmc` returns "no card", so `isc_olnet` fails to
insmod `bcmdhd`/`mn-sdmmc`, `/etc/init.d/wifi` cannot bring an interface up, and `isc_olnet` answers its ISC ports with
a "not available" status rather than crashing; `blebridge`/`bsa_server` find no `/dev/ttyS1` BT and likewise report BLE
unavailable. `sccore`'s port-26 kind-1 "wifi start" still runs the init script (which then fails internally). HHHR and
the socket/CGI/file relays are **radio-independent** and would answer normally — they are the endpoints the emulator
actually needs. This matches the MN-side seam in `docs/hle-gaps.md` §4.11 (network tasks report "not available").

**Live, with the console captured (X, `run-isc.sh` + the oracle's `mn_sio_uart` model).** The A53 boots to userspace
and runs its boot daemons: `Starting OLYMPUS APP...`, then `sccore start!!` and `dbgterm server start!!` (S99oly starts
`dbgterm_server`, `sccore`, `hhhr`). `sccore` answers port 26 (kind-3 round-trips, §9), `hhhr` answers 30/31, and
`dbgterm_server`'s `ISC_alloc_mem` succeeds against the oracle's pool. A port-26 **kind-1** makes `sccore` run
`system("/etc/init.d/wifi start &")`, which starts `lighttpd` (with `isc_cgi` and `isc_file` as its FastCGI children),
`isc_socket`, `wifi_remocon`, `isc_olnet`, `wifi_upnp`, `wifi_mdns`, `bsa_server` and `blebridge` (X: `ps` on the
console shell; `lighttpd` listens on :80). Two oracle bugs had hidden this: the console's model had no TX interrupt
and read a TX-FIFO free count of 1 (the driver's `tx_chars` `0xffffff8008294138` writes at most `+0x1c` bytes, then
waits for the interrupt), so the first userspace write to the console blocked its writer, the wifi script included
(X: the console stopped mid-line); and `dbgterm_server`'s endless `OlyISC_attach_mem() err!![-1]` came from the
control block's `+4` (§3), not from a missing port-15 handshake as read before (X: none after the fix).

### 9.1 The 64-byte socket record and the CGI exchange (D, X)

Read from both ends: the A53 handlers (`isc_socket`/`isc_cgi`, armhf) and the MN CPU-1 code in the E143 main block
(disasm notation = body offset + `0x50000000`), then run live in the oracle (X, `run-isc.sh` with `iscpeer.mjs`'s
`scenario=socket` and `scenario=cgi`; the client inside the guest is the console shell's `wget`). The MN request/reply
helper is `0x517dd738` (socket) and the CGI loops are `0x517dc442` / `0x517dc636`; all bottom out in the ISC service
stubs `ISC_send_timeout` `0x5002bf41 -> 0x50aa2fe0` and `ISC_receive` `0x5002bf4f -> 0x50aa303c` (and `alloc`/`attach`
`0x5002bf77`/`0x5002bf81` for bulk data). The JS service that answers as the A53 does is S-A53ISC
(`emu/src/lab/a53isc.mjs`, not wired; its tests replay these exchanges).

**Socket record** (64 B, port 3 in, port 4 out to node 1). `+0` u32 op 1..16; `+4..+0xb` the MN's request id, echoed
(X); `+0xc` a byte the A53 sets to 1 in every reply: it copies each request into one of 12 slots and marks the slot busy
there (`0x10f64`, D; X), so the MN can ignore it; then per-op fields, the result written in place. The receive loop
(`0x10e48`) starts a thread per request, so replies can come out of order; with all 12 slots busy a request is dropped
with no reply (`0x10f1c`, D). Dispatch is the jump table at `0x1107c`; the handler names come from the strings
(`iscbsdapi_*`):

| op | call | request fields (D) | reply field | live | MN CPU-1 wrapper (D) |
|---|---|---|---|---|---|
| 1 | socket | `+0x10` domain, `+0x14` type, `+0x18` proto | `+0x1c` fd | X | `0x517dd8c9` |
| 2 | bind | `+0x10` fd, `+0x14` sockaddr[16], `+0x24` len | `+0x28` ret | X | `0x517dd8f9` (memcpy's the 16-B sockaddr) |
| 3 | connect | `+0x10` fd, `+0x14` sockaddr, `+0x24` len | `+0x28` ret | ? | (via the same helpers) |
| 4 | listen | `+0x10` fd, `+0x14` backlog | `+0x18` ret | X | `0x517dd935` |
| 5 | accept | `+0x10` fd, `+0x24` len in | `+0x14` peer sockaddr[16], `+0x24` len, `+0x28` fd | X | `0x517dd961` (copies addr back) |
| 6 | send | `+0x10` fd, `+0x14` MN buf addr, `+0x18` len, `+0x1c` flags | `+0x20` ret | X | `0x517dd9c0` |
| 7 | sendto | …+`+0x20` sockaddr, `+0x30` len | `+0x34` ret | ? | `0x517dd9f7` (memcpy's the sockaddr) |
| 8 | recv | `+0x10` fd, `+0x14` MN buf, `+0x18` len, `+0x1c` flags | `+0x20` ret | X | `0x517dda42` |
| 9 | recvfrom | `+0x10` fd, `+0x14` MN buf, `+0x18` len, a sockaddr from `+0x20` (not read in full) | `+0x34` ret | ? | |
| 10 | shutdown | `+0x10` fd, `+0x14` how | `+0x18` ret | ? | `0x517dda79` |
| 11 | close | `+0x10` fd | `+0x14` ret | X | `0x517ddaa5` |
| 12 | select | `+0x10` a 24-B ISC mem handle (nfds/fdsets/timeval block) | `+0x28` ret | ? | `0x517ddace` (allocs 4 KiB) |
| 13 | getsockopt | `+0x10` fd, `+0x14` level, `+0x18` name, `+0x1c` MN buf, `+0x20` len | `+0x24` ret | ? | |
| 14 | setsockopt | as 13 | `+0x24` ret | ? | |
| 15 | getsockerr | none ("NOT SUPPORTED") | `+0x10` the errno of the op's new thread | X (0) | |
| 16 | setsockerr | none ("NOT SUPPORTED") | nothing | X | |

`send` sends the whole length in chunks of at most 128 KiB and returns the length (`0x130d4`, D; X `0x44`). `recv`
**loops until the whole length has arrived** (`0x11c2c`, D): the result is the length, less at end of stream, or the
failing `recv`'s return; an HTTP request of unknown size therefore has to be read in small pieces (X: the oracle reads
it a byte at a time; a 512-byte `recv` waited for bytes that never came). For bulk data the A53 does **not** use the
memblock pool: it maps the MN buffer directly through `/dev/mem` at `(addr & 0x3fffffff) | 0x2_80000000`
(`isc_socket.dis 0x12b3c`), the alias of the pool the oracle backs as one region, so a buffer the MN names at
`0x63fe0000+X` is the bytes the A53 reads at `0x2_a3fe0000+X` (X: `recv` wrote the request into the MN's buffer, `send`
took the reply from it). Live (X): socket -> fd, bind 0.0.0.0:8099 -> 0, listen -> 0, accept -> a new fd and
127.0.0.1's address, recv -> the client's 82-byte GET, send -> 68, close -> 0 twice, getsockerr -> 0; the guest's
`wget` printed the MN's body.

**CGI exchange** (D: `isc_cgi` `0x10ea8..0x11914`, MN `0x517dc330..0x517dc7d1`; X: a GET and a POST through
`lighttpd`). `isc_cgi` is the client: per HTTP request (the FastCGI loop `0x11988`) it `ISC_alloc_mem`'s 16 KiB
(`0x10e30`), relays the request, relays the MN's reply to FastCGI's stdout and frees the buffer (`0x11914`):

| step | from | port, length | content |
|---|---|---|---|
| inquiry | A53 | 12, 32 | the 24-byte handle, `+0x18` 0 (`0x10ea8`) |
| accepted | MN | 16, 32 | the record back, `+0x18` 0 (MN `0x517dc3a3` attaches it to check; `isc_cgi` reads only `+0x18`) |
| request | A53 | 11, 16 | the handle's first 16 bytes, after the A53 wrote the info block into the buffer (`0x114c8`) |
| taken | MN | 13, 32 | `+4` 0 accepted (MN `0x517dc626`; `isc_cgi` `0x11538` fails the request otherwise) |
| reply chunk | MN | 12, 32 | the handle again, `+0x18` 0, once the MN wrote the chunk into the buffer (MN `0x517dc330`) |
| chunk ack | A53 | 16, 32 | the record after the A53's attach, `+0x18` 0 ok / 1 an error (`0x10ff4`); the MN reads only `+0x18` (`0x517dc389`) |
| chunk notice | MN | 11, 16 | the handle's first 16 bytes (MN `0x517dc718`) |
| chunk done | A53 | 13, 32 | `+0` 0, `+4` 0 ok / 1 a short FastCGI write (`0x11844`); the MN maps a nonzero `+4` to `-99` |

The last four repeat until the chunks' lengths reach the total. The **handle** is `libisyscomm`'s 24-byte
`ISC_alloc_mem` record (ioctl `0xc0185c11`; attach `0x5c13`): `+0` u16 block, `+4` u32 size; after an attach the kernel
fills `+8` u64 the buffer's physical address (`0x2_a3fe2000` for block 2, X) and `+0x10` the user address; before that
those bytes are whatever was on `isc_cgi`'s stack (X). The **info block** (`0x3444` bytes, `0x1119c`): `+0` 1 for a
first chunk (with the URI), 2 for a later one, `+4` content length, `+8` chunk length, `+0xc` method (1 GET, 2 POST),
`+0x10` URI length (at most `0x3ff`), `+0x14` URI (with the query), `+0x414` body (at most `0x3000` per chunk),
`+0x3414` REMOTE_ADDR[16], `+0x3424` a log name[32] from `isc_olnet`'s shared memory (empty here). X: a GET gave kind 1,
method 1, `/get_commandlist.cgi?a=1`, REMOTE_ADDR 127.0.0.1; a POST of 8 bytes gave kind 1, content and chunk length 8,
method 2, the body at `+0x414`. The **reply chunk** the MN writes into the same buffer (at most `0x3080` bytes; MN
`0x517dc636` clears that many, builds it and cleans the cache over it): `+4` u32 total length, `+8` u32 this chunk's
length, `+0xc` u32 a slot (MN: a value from `0x517f55eb` minus 1; `isc_cgi` stores it in its shared memory, `0x10c24`;
meaning ?), `+0x10` the data, which `isc_cgi` writes to FastCGI unchanged, so it starts with the CGI header lines (X:
lighttpd took `Content-Type: text/plain` and passed the rest to `wget`; the MN's own header formats are at `0x51900788`
and `0x5190d456`, D). A request body over one chunk and the MN's multi-chunk replies were not exercised live.

## 10. Open questions

1. The exact meaning of the `0x988003xx`/`0x988004xx` reset/clock/power bits `0x5003bcd9` programs before release (?).
2. ~~The port-27 start-complete reply~~ — **resolved (§9; confirmed live, X):** `sccore` sends `{0x01,0,0,0}` on port 27
   at init, and the oracle receives it. The port-26 request kinds 1/2/3 are decoded and kind 3 round-trips live (§9);
   which MN request code maps to A53 power-*off* vs the kinds above is still ? (the MN side `SYS_CA53_PWR_MNG`
   `0x5003c8f4` was not re-scanned here).
3. ~~Per-port payload formats~~ — **resolved (§9/§9.1, D; sccore + hhhr confirmed live, X):** message lengths and the
   sccore/hhhr bodies are decoded and round-trip live; the 64-byte socket record and 32-byte CGI record field layouts are
   now named (§9.1, D) and paired with the MN CPU-1 marshallers in the E143 block. The `isc_file`/`olnet`/`ble` record
   contents remain partly ? (lengths read, fields not fully named).
4. The precise `mapinfo` record layout and whether production ever takes the "from sd" path (the strings exist:
   `<arm load4>`, `<arm jtag sd0..2>`) (?).
5. ~~The control-block magic~~ — **resolved (X):** `0x10f7` (`0x1000 | (config byte-sum & 0xff)`), confirmed by
   `isc_start` succeeding live against `iscpeer.mjs`'s published control block.
6. ~~The `ISC_alloc_mem` pool~~ — **resolved (D + X):** the 128 KiB shared memory is a memblock allocator whose header +
   free-list must pre-exist at the pool base (shift/nblocks/head, a run-length doubly-linked list, three
   bitmaps: allocated, single-block runs and, read by attach and detach, attached (`memblock_init` `0x34f8`
   +24/+32/+40, D); decoded
   from `memblock_init`/`memblock_alloc`/`findrun` and the MN builder `0x50aa63c5`). `iscpeer.mjs` now writes it and the
   A53's own `ISC_alloc_mem` succeeds live (`dbgterm_server` takes block 1; before the fix every alloc/attach failed). The
   two shared-memory views are now one backing region, so the socket `/dev/mem` buffer alias and the CGI pool buffers are
   coherent across both sides.
7. ~~`isc_socket`/`isc_cgi` end to end~~ — **resolved (X, 2026-11-08; §9.1).** The stop was the oracle, three bugs deep:
   the console's model stalled every userspace write (no TX interrupt, a TX free count of 1), so the backgrounded wifi
   script blocked on its first line and never started the daemons; the irqcon ack was modelled at the wrong register, so
   CPU 0 stayed in the ISC handler and anything scheduled there starved (the replies that did come came from CPU 1, I);
   and the control block's `+4` and the FIFOs' `+8` were wrong (§3), so every `ISC_attach_mem` failed or mapped the
   wrong page. With those fixed, and the console's RX given an interrupt so the inittab's shell takes commands
   (`uartsh.mjs`), a TCP server round trip over ports 3/4 and a CGI GET and POST over 11/12/13/16 run end to end against
   an in-guest `wget`. Still not exercised: `connect`, `sendto`, `recvfrom`, `shutdown`, `select`, `get`/`setsockopt`, a
   CGI body over one chunk, a multi-chunk reply; the reply chunk's slot word (?).
