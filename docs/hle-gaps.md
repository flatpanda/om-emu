# HLE gaps: what a complete HLE of the OM-1 still needs

What the lab does not yet model for a complete high-level emulation (HLE) of the OM-1 (E143 v1.9), block by block,
and the plan to close it. HLE here means that the firmware's own code runs natively down to a seam where a device model
or a narrow, named stand-in answers, and that the seam sits where the firmware's code fixes the contract; behaviour
without firmware evidence stays an error, never a guess (ROADMAP intro). This document owns the per-block facts;
[ROADMAP.md](ROADMAP.md) owns the order of work across tracks and its status.

Addresses and tags as in [README.md](README.md): code addresses in disassembly notation, data addresses run-time;
**D** read from code or data, **X** executed in emu, **I** inference, **?** unknown. Code sizes are instruction counts
from the module map (section 2.2). Every effort figure is a rough estimate of focused work (I), not a commitment.

## 1. In brief

- **What runs natively:** the CPU and ISA, the CPU 0 kernel, interrupts at the idle point, the OSD and VSC display path,
  text, the GUI and menus, input from UI_IN up, the settings store, and the camera application (CA_MAIN and the HLS
  components).
- **What does not:** every block below the camera application that the user reaches through a shot, a recording, a
  card, a cable, a radio or the power lever. Each is a harness answer at the HLS or module level (S-RELSEQ, S-MODACK,
  S-TRAACK, S-CARD, S-SCENE, S-EXPOSE, S-LENS, S-CPU2, S-SCPU-MSG, H-POWER and others) or is not modelled at all. None
  of their tasks runs in a lab (X: a full S1 + S2 and a REC post no module request; the kernel lab's task-start guard
  refuses their entries, `emu/src/lab/kernel.mjs`), and their MMIO is lab-stub space that faults on first touch.
- **In code:** the lab executes 287,101 of the main block's 5,186,071 instructions (5.54%), about 6.1% of the code a
  camera runs in normal use (section 2.2). The largest unrun blocks are playback (613k instructions), AF / lens / IS
  (505k), still capture (421k), the AV codec back end (411k), the sensor / ISP / live view (321k) and the TAKE module
  with the HLS shooting sequence (301k).
- **Three gaps block almost everything:** no native TAKE module, so no firmware code below the HLS ever asks for focus,
  exposure, capture or a movie; only CPU 0 runs; interrupts are accepted only at the idle point and there is no
  machine-owned time model. Closing them is the precondition for every device seam below.
- **The plan** (section 6): static decodes and cheap CPU 0 wins first; then interrupts anywhere and time; CPUs 2, 3 and
  1; task-start infrastructure with the HLS bring-up; storage; TAKE native with its neighbours; then the blocks by
  user-visible gain. The recommended seams are module-level where the code is device-heavy: they cut off the three
  largest such units, FCS (372k), the imgpro library (about 275k) and the AV back end (416k). Most effort figures hold
  only at those seams, not for the native path below them.

## 2. Method

### 2.1 Top-down: block surveys

Eight block surveys (sensor / ISP / live view, still capture and recording, AF / lens / IS, movie and audio, CPUs 1-3,
SCPU / power / persistence, card / file system / USB / HDMI, wireless) each recorded:

- the firmware footprint: tasks and kernel objects from the firmware's object-name table (`0x6034d0d4`) and the four
  static task tables (kcb+124, cores spec §2), the module-queue targets of the API sender (shutter spec §2.2), the
  source-file strings and their code ranges, MMIO operands, and IRQ attach calls (`0x50053f76(irq, level, handler)`
  attaches on the calling core; `0x50053fcd` takes the core as a further argument);
- what emu does today, from play sessions that log the camera-application stand-ins;
- candidate seams, dependencies, a rough size, a first concrete step and the hardware evidence that would help.

A ninth survey compared the shutter mechanism across bodies instead of planning a seam (section 7).

### 2.2 Bottom-up: the module map and its coverage

`node emu/bin/fwmap.mjs` builds a static map of the main block and joins it with execution coverage (its subcommands
are documented in [emu/README.md](../emu/README.md)):

- **Discovery:** recursive descent from the roots (reset, the CPU 1-3 entries, the vector slots, the 311 static task
  entries and every direct call target), then `mov imm32` code pointers, then aligned words in data (vtables, handler
  and command tables). 76.9% of the executed instructions are found only through the pointers in data.
- **Modules:** a function joins the module whose `__FILE__` or class string it references, then by contiguity and call
  affinity; the rest forms unnamed `gap@<entry>` pieces (71.2% of the instructions).
- **Coverage:** the union of the instructions executed by emu's golden workload (`run.mjs all` and the checks).
- **Blocks:** every module carries exactly one block label; code with no static task reach is assigned to no core.

| Measure | Value |
|---|---|
| functions | 102,803 |
| modules | 2,629: 1,217 named (source file or class), 1,412 unnamed gap pieces |
| instructions in the map | 5,186,071 |
| executed (union of all runs) | 287,101 = 5.54% |
| functions entered | 8,810 (8.6%) |
| modules entered | 652 |

| Part of the map | Instructions | Executed | Executed share | Gap-relevant unexecuted |
|---|---|---|---|---|
| whole map | 5,186,071 | 287,101 | 5.54% | 3,622,018 |
| data decoded as code (about 58k; section 9 item 7) | about 58k | 0 | - | 0 |
| factory adjustment, debug shells, firmware update | 422,832 | 970 | 0.23% | 159 |
| normal-use code (the rest) | about 4.70M | about 286.1k | about 6.1% | 3.62M |

By core, from static task reachability through direct calls (vtables, dynamic tasks and cross-core calls are not
followed, so most code has no core):

| Reached from | Instructions | Executed | Share | Gap-relevant unexecuted |
|---|---|---|---|---|
| CPU 0 tasks only | 679,668 | 51,072 | 7.51% | 558,848 |
| CPU 0 and another core | 424,014 | 16,320 | 3.85% | 356,728 |
| CPU 1-3 tasks only | 441,542 | 1,780 | 0.40% | 434,341 |
| no static task reach | 3,640,847 | 217,929 | 5.99% | 2,272,101 |

Overlay segment 8 (CPU 1: AV and GPU) holds about 480k instructions with 42 executed, segment 9 (connectivity and
playback) about 427k with 24 executed (D).

### 2.3 What the numbers do not say

- "Gap-relevant unexecuted" counts the unrun instructions of modules reachable in normal use (not factory, debug or
  firmware update). It is an upper bound on the code a native path would still have to reach, not a work estimate.
- Virtual calls are not in the call graph, so the core split and fan-in miss most of the GUI and the HLS.
- Coverage understates the camera application: startTransition `0x50c2f2fd` and the Cmp_ShootingComponent constructor
  run under `control camapp 2` (shutter spec item 39, X), which the golden workload does not set.
- Effort figures are the surveys' own; where two surveys plan the same work (CPU 2 above all), section 6 says which
  estimate shrinks.

## 3. The blocks

Status codes: **N** native firmware down to a modelled device, **S** stood in above the block (the firmware below does
not run), **0** nothing. Code column: instructions keyed to the block / gap-relevant unexecuted (section 2.2).

### 3.1 Modelled blocks, for contrast

| Block | Status | Seam in use | Code (executed share) | What remains open (owner) |
|---|---|---|---|---|
| CPU, ISA, UDF | N (`check_isa`) | the CPU itself | - | acceptance anywhere (F03), strictness assumptions (ROADMAP phase 3) |
| Kernel (uITRON) | N on CPU 0 (`check_kernel`) | lab task, H-IRQGATE, K-OTHERCPU, K-BOOTSYNC, K-IPI | 48,897 (20.97%) | CPUs 1-3, native dispatch from boot (4.6) |
| Interrupts, timers, lab time | N at the idle point (M9) | intc `0x99200000`, 34-channel timer, lab clock | - | acceptance anywhere, time mode by default (ROADMAP phases 3, 4) |
| OSD engine, VSC, display flow | N to the device models (M2, M3, M7, M8) | `0x9BC00000`, `0x9BB80000`; A15 opt-in | 99,890 (26.78%) | DISP_SYNC `0x9c180000` (S-DISPSYNC), the CMM image, HDMI channel 0 (4.9), A5 / A7 / A15 need hardware |
| Text and resources | N (M4) | S-RES, Genifa | 28,861 (9.09%) | U items (text spec) |
| GUI and menu | N (M5, M6, M10B) | S-SEND, S-PROP | 621,898 (19.31%) | navigation rules observed, not decoded; the 53 screen classes of gap@0x510ef2bf (35k) are unnamed (?) |
| Inputs | N from UI_IN up (M10) | S-KEYBITS, H-EYESTATE, S-TPINT, S-TPREG, H-DIALSTEP | 43,895 (20.85%) | the raw-bit producers (4.7) |
| Settings store | N: the property store `0x503c4974..0x503db10c` and the LowAPI property unit gap@0x503edeea | S-SCPU-MSG, S-SETSAVE / S-FLASHSAVE or S-NVRAM | 50,515 (31.24%) | persistence by default (4.7) |
| Camera application (CA_MAIN, HLS) | N since 2026-10-15, in part: 99k gap-relevant instructions unrun | S-RELSEQ, S-MODACK, S-TRAACK, S-CARD below it | 320,057 (18.64%) | the HLS shooting sequence (196k, 4.1) and the playback components (310k, 4.8) are 1-2% run |

Of the application's executed instructions, at least 9,456 of 28,686 in one part of the map are C++ static
initialisers run at boot (D, X). The image buffer manager (8.5k at `0x50532df0..0x50537e85`, called from capture,
live view and playback) runs natively (X: 2,330 instructions) and has no owner block.

### 3.2 Blocks not adequately modelled

| Block | Today | HLE seam | Depends on | Code | Effort (I) | User-visible gain |
|---|---|---|---|---|---|---|
| **TAKE module and HLS shooting sequence** (4.1) | S: S-RELSEQ posts the CBS callbacks in an inferred order; S-TRAACK answers TRA 991 and the release TRAs with 0; S-MODACK acks TAKE_FUNC; S-TAKEFRAME; S-EXPOSE writes TAKE_EXPOSE's results | TAKE native, its neighbours answered at their own seams (lens, BC, sensor, shutter). Interim: TAKE as a black box at queues `0x5e` / `0x5a`, its results delivered as the capabilities' observer events (4.1.3) | the shooting component's native answers to TRA 990 / 991 (4.1.2); lens, BC_EXEC and the camera driver's requests 148 / 6 (TAKE_FUNC_CP's ready sequence, 4.1.1); CPU 2 for the movie and through commands; the sensor control plane; the shutter; task starts | 307,393 / 301,082: C TAKE about 100k, HLS sequence 196k | ?: no survey sized it; "TAKE reached, 1-2 weeks" (capture survey) leaves out the lens, BC and sensor answers it needs | the camera's own release sequence and timing in place of S-RELSEQ's guessed order; AE lock, drive modes, bracketing |
| **Shutter mechanism** (section 7) | 0: block `0x9b900000` (271 registers, IRQs 11 / 12 / 13) never touched; S-RELSEQ's START / END_EXPOSE stand in | not proposed by the survey. A register file with W1C status `+0x008..+0x010` and per-bit callbacks on IRQ 11 has the camera driver's shape, so the sensor's seam D (control plane plus event producer) fits (I) | sensor SSG timing (the EFS curtains are the sensor's reset / readout scan, I), TAKE, time model, the MEC_ADJUST layout | 20,942 / 20,942 (gap@0x50108fe0 19.6k plus cam_mec_ctrl); none run | ? | shutter sound timing, black-out, EFCS / ES modes from the firmware |
| **Sensor / ISP front end, live view** (4.2) | S: S-SCENE paints bank `0x0A` and calls TH with H-REQ; S-EXPOSE per input, no LV AE; 33 camera IRQs unwired | A: MVR_IMG's TH request builders (CPU 2); B: AE / AWB statistics at the callback table `0x629a7c64`; D (target): control plane plus HLE pixel and statistics producers | CPU 2, TAKE (the through commands 25 / 27 / 28 that TRA 991 reaches, 4.1.2), IRQs anywhere and time (VD-paced), shutter, DISP_SYNC | 327,531 / 320,730, plus about 25k of MVR's live-view part | 10-16 weeks (seam D open-ended) | the camera's live-view geometry per device, frame cadence, continuous metering, AWB, AE lock, LV modes, magnify |
| **EXP exposure module** (inside the sensor block, 4.2) | S: only the plan `take_expose_calculate` `0x50597e82` runs, under S-EXPOSE and H-AEINIT | native, fed by seam B's statistics | seam B, the TAKE_EXPOSE and EXP_MOVIE tasks | about 107k (EXP 96k plus TAKE_EXPOSE 13.6k), one MMIO reference: device-free | part of seam B (3-5 weeks) | continuous metering, AE / AF BV, flicker detection, face and spot AE |
| **Still capture, image processing, recording** (4.3) | S: S-RELSEQ, S-RECVIEW, S-CARD, S-TAKEFRAME; X: S2 posts no module request | C1 DRAM capture, C2 the imgpro_mdl API, C3 CIC, C4 storage (shared with 4.8), C5 the CPU 2 halves | TAKE, the sensor (C1), CPU 2, storage, the A53 for Handheld High Res (I) | 429,679 / 421,478, of which the imgpro library about 275k behind about 10 imgpro_mdl entries | 6-9 weeks | S2 writes a real JPEG / ORF with the firmware's EXIF and DCF name; the rec view shows the firmware's view image |
| **AF and lens** (4.4) | S: S-LENS (record values I), S-RELSEQ's END_FOCUS, S-AFOSD's fixed frame; X: no request reaches LENS, FCS, BC or TAKE_EXEC | lens: the serial device `0x9b980000` (IRQ 14) and the edge unit `0x9b883e40` (IRQ 60); AF: the module seam TAKE_FOCUS `0x5d` / FCS_EXEC `0x1b` | TakeReady (TAKE), task starts and the lens inits, sensor VD for LENS_SYNC, CPU 1 (FCS_IP, flag 0x92) and CPU 3 (MDET) for native FCS, IRQs anywhere, time | 510,248 / 504,870 with IS: FCS 372k (about 100k CPU-1-only), lens about 84k | lens 2-3 weeks; AF 2-3 weeks once TakeReady runs; native FCS months | the lens identified by the firmware, zoom and MF, the firmware's AF decision and frames |
| **Body IS (BC)** (4.4) | 0: no BC, no gyro, no IS state | the module seam BC_EXEC `0x09`; BC native only with a capture of the IS link | TAKE (TAKE_FUNC sends to BC_EXEC), the IS controller's serial channel (?) | 34-42k / about 34k (inside AF / lens / IS) | about 1 week at BC_EXEC | IS mode and indicator, IS EXIF |
| **Subject detection** (4.12) | 0 | ? (not surveyed as a block) | CPU 3, the detection engines, image buffers | 84,500 / 81,771 keyed; about 127k with the SDET and FACE units | ? | subject and face frames, C-AF tracking |
| **Movie and audio** (4.5) | S: S-RELSEQ's movie callbacks, S-CARD's movie time, S-CPU2's zero level snapshot, S-MODACK for AUD_EXEC | S3 TAKE_FUNC commands 30 / 31 / 68 / 69, S4 the mvr IF (CPU 2), S5 AUD_LEVEL_MONITOR, S6 a host AVM writing a MOV through the firmware's DFS calls, S7 AUD_EXEC | TAKE (commands 30 / 31 / 68 / 69 wait on CPU 2's MOV_COMMAND, SDET_EXEC and WB_MOV, 4.1.1), CPU 2 (MVR, audio level), sensor, storage, EXP_MOVIE / FCS_MOVIE | 134,137 / 124,319 | 10-15 weeks (stages A-C) | a playable .MOV on the card, the firmware's recording sequence, audio meters, beeps |
| **AV codec back end** (4.5) | 0 | none for HLE: seam S6 bypasses it | CPU 1; the codec engines; IRQs 303-306 | 416,471 / 411,438 (overlay segment 8, CPU 1) | ?: native needs register-level codec models, no documentation | native movie encode and playback below the HLS (I) |
| **CPUs 1-3 and inter-core** (4.6) | S: K-OTHERCPU, K-BOOTSYNC, K-IPI, no start barrier; S-CPU2 (one post), S-CPU3, S-DISPFRAME on CPU 0; any other doorbell is an error | run CPUs 1-3 natively on one bus; per-core `0x8000` page, INTC bank n to core n, `+0x808/+0x80c` IRQ 324, `+0x810/+0x814` IRQ 325, `+0x800/+0x804` ISC IRQ 323, ticks 139..141. A53: "off" or ISC node 4 | a machine refactor (per-core CPU state), a per-core kernel lab, flash reads for CPU 2's loader and CPU 3's boot jobs, ROADMAP phases 3-4 | 5,422 keyed; 441,542 reachable only from CPU 1-3 tasks (a lower bound) | 5-7 weeks for the cores | the histogram, a native DISP_FRAME, cross-core owners (AUD_MAIN, AVM) can start; three stand-ins and four kernel stand-ins retire |
| **SCPU, power, clock, on-board sensors, persistence** (4.7) | S: SCPU window as storage at 5 offsets, S-SCPU-MSG (4 wait sites), S-KEYBITS group 0, H-POWER, H-EYESTATE, S-SETSAVE / opt-in S-NVRAM; clock frozen; Level Adjust hangs | a request server at PER_SCPU_RECEIVE (type-3 id 2); SCPU event / port registers and IRQ 320; clock `0xe8 / 0xec` ticking with lab time; accelerometer at the PER_SIO transfer or the sample cache; S-NVRAM's NAND seam as the default | lab time; the UI_IN, ACC, SCPU and PER_SIO inits; CPU 3 for the store's boot load in a native boot | 64,446 / 56,954 | 4-5 weeks (steps 1-4), 7-9 with the power manager and NAND | a running clock, persistence by default, native power lever and power-down, Level Adjust, level gauge, rotation, eye sensor |
| **Card and file system** (4.8) | S: S-CARD; the DCF remain count runs and says "not mounted" (X) | a block device at the sdmem request `0x508b1cdc` with a host FAT32 / exFAT image; sd_mount's result beside it | task starts (EYEFI's init chain, FILECLBK, FILEFGND, DCFPROC_SUB), IRQs anywhere (completions are IRQ to flag) | 115,103 / 108,887 (17k of it self-test and debug) | 3-5 weeks | a card that fills, real files in DCIM, Card Formatting, both slots |
| **Playback** (4.8) | S: S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW | with the S-PLAY* stand-ins kept: a JPEG decoder at the codec seam; native: the HLS play components, PLAY_* / MOVP / MOVE, the AV back end for movies, CIC for RAW | storage, imgpro C2, CIC `0x9be80000`, the AV back end | 684,201 / 612,936 (HLS components 310k, GUI 80k+, segment-9 PLAY_* / MOVP / MOVE 113k): the largest block | 2-4 weeks on top of storage with S-PLAY* kept; native: a block of its own (?) | playback of real files, index, zoom, histogram, erase, protect |
| **HDMI and DisplayPort** (4.9) | 0: the DISPLAY OPEN polls the EDID state `0x62a3c8ec` 50 times and gives up (X) | TX byte registers at `0x99c07000`: HPD / RxSense byte 8 bits 3 / 4, DDC `0xa80..0xa83`, EDID at `0x99c07c00`, IRQ 239; then VSC channel 0 | IRQ 239 delivered while DISPLAY waits (phase 3), VSC channel 0 in the compositor | about 11k (3.3k plus the TX / DP driver's 7.7k) | 3-4 weeks (EDID / HPD about 1) | the HDMI output a TV shows |
| **USB** (4.10) | 0 on E143 | the event level first (EV_USB_CONNECTED 8, EV_USB_RXDETECT `0x040d00d2`, the select screen); later a DWC3-family device at `0x9a600000` (IRQ 223) | SCPU (PD, power source), ADC flag `0xbf`, the PC_* tasks, storage for MSC | 121,861 / 117,704 | 1-2 weeks events; 4-8 weeks data path | the USB select screen, charging state; later MSC, MTP, PTP |
| **PC connection over PTP (TPC)** (4.10) | 0 | ? (the bulk of the USB data path) | a USB or Wi-Fi transport, storage | about 52.6k / about 52k (21.4k of it filed under factory code) | ? | tethering, the PTP firmware-update path |
| **PictBridge / DPS / DPOF, XML parser** (4.10) | 0 | ? | USB | about 89k in parts: 13.4k HLS, 25.7k Cmp_PictBridge, 10.3k HFW print, 2.8k DPS transport, 9.4k DPS XML, 2.8k DPOF, 24.5k expat-like XML parser | ? | direct printing |
| **Wireless** (4.11) | 0: CPU 1 not emulated, no ISC model; the menus paint boot defaults | the ISC node-4 port boundary (a JS "A53 service"), at the dispatcher `0x50aa4c98` or as the mailbox device | CPU 1 native (blocking), the USTART chain, ISC init CREQs on all cores, card, imaging, SCPU (BLE wake) | 137,490 / 130,344: about 72k MN10300 application on CPU 1, about 25k CPU 0 HLS, FlashAir | 6-9 weeks after CPU 1 exists | live Wi-Fi / BT state, connection setup, a virtual smartphone over the firmware's own OI.Share API |
| **GPU and C3D** (4.12) | 0 | ? (which user feature drives it is ?) | CPU 1 | about 85k / about 84k | ? | ? |
| **Strobe and hot shoe** (4.12) | partly native: 562 instructions run (X); no device | ? (not surveyed) | ? | 33,625 / 31,493 (24 driver modules plus 17 HLS) | ? (shutter-sized) | flash control in normal shooting |
| **Image effects (ART)** | 0 | ? (not surveyed) | ? | 9,539 / 9,237 | ? | ? |

### 3.3 Code that is not a gap

- Factory adjustment (ADJ, ADJSLF, CAPI: about 184k), the debug shells (194k: the SDK `sdk api` shell, the HFW shell,
  the segment-10 debug-command overlay) and firmware update (FIRMUP_*: about 4k at `0x51034a0c..0x510376f1` plus an
  HLS part and a PTP path). The largest never-entered module, gap@0x5180cafc, is 89% factory code.
- BAS_MAIN and BAS_RCU_SRV: a BASIC interpreter and an RCU script server (test, not normal use).
- About 58k instructions of data decoded as code (section 9 item 7).
- Two blocks have no owner yet: `libc-util` (24,483 instructions, none run) and `boot-init` (8,616, 9.24% run).

## 4. Per block: footprint and first step

Each block lists its tasks, kernel objects, MMIO, interrupts and cores as far as the surveys read them, the seam detail,
and the first concrete step. Task ids are `cpu << 12 | index` (kernel spec §2.1).

### 4.1 TAKE module and the HLS shooting sequence

- **Tasks (CPU 0, D):** TAKE_MAIN 0x6b `0x503996c3`, TAKE_MAIN_CP 0x72 `0x5039a09e`, TAKE_FUNC 0x69 `0x502cd1ca`,
  TAKE_FUNC_CP 0x6a `0x502cd604`, TAKE_EXPOSE 0x67 `0x5059145d`, TAKE_FOCUS 0x68 `0x509a0ebe`, TAKE_PROXY 0x78
  `0x503a9880`, TAKE_POWER_MANAGER 0x83 `0x503a9241`, TAKE_MOV 0x70 `0x506e4326`.
- **Objects (D):** queues TAKE_EXEC 0x5a (API targets 6 / 11), TAKE_EXPOSE 0x5b, TAKE_FCS_POST 0x5c, TAKE_FOCUS 0x5d,
  TAKE_FUNC 0x5e (25), TAKE_FUNC_CP 0x5f, TAKE_FUNC_CP_APPEVENT 0x60, TAKE_FUNC_CP_POST 0x61, TAKE_FUNC_POST 0x62,
  TAKE_POST 0x63, TAKE_FUNC_IMDFUNC 0xa7, TAKE_MAIN_CP 0xb8, TAKE_PROXY_EXEC 0xc5, TAKE_POWER_MANAGER_EXEC 0xd7;
  flags TAKE_CAM_EVENT 0x42, TAKE_FUNC 0x44, TAKE_FUNC_CP 0x66, TAKE_DRAMCAP 0xb1 and others; semaphore TAKE_FUNC
  0x19 (names from the object-name table, queue ids from the halfwords at `0x60043270..0x60043288`). Debug dumps print
  `job.com`, `res_qname`, `pkt_addr` per job (a command, a reply queue and a parameter-packet pointer, 4.1.1).
- **No MMIO (D):** TAKE's code `0x50390000..0x503c2000` holds no device operands; it is software over the driver APIs.
  Inside it, a fixed-point arithmetic block `0x50390a90..0x5039724f` (11.8k) and `0x5039724f..0x503996c3` (4.1k) have
  no known role (?).
- **The HLS half:** CmpSqp_SequencePartsBase (101k, the largest named module), the shooting sequence's per-phase TRA
  dispatchers in gap@0x50c5c4ac and 209 OXF event classes in gap@0x50c7eeb2 (4.1.3). They run at 1.3% in the golden
  workload, mostly static initialisers.
- **What reaches it today (X):** at the start the application sends TAKE_FUNC command 0 asynchronously (`[6,
  0xf0010000, 0, param]`, the startShootingService API `0x5040e931`, shutter spec item 14) and the synchronous commands
  13 and 18; with the components on (`control camapp 2`) also 29 (seven times) and 22 (three times). S-MODACK answers
  them all; S1 and S2 send nothing downwards. The start's transactions (415, 598, 614, 990, 958, 1515, 955, 1001, 1061,
  992, 1503, 1045, 938, 974; with the components also 937, 1036, 942, 1065) are all answered 0 by S-TRAACK at the exec,
  so the shooting component that answers 990 and 991 (4.1.2) is never asked. TAKE publishes only the module events
  `0x04020215` and `0x040800f0`, so its results reach the HLS through the replies to its requests and the callbacks the
  capabilities register (I, shutter spec item 44; 4.1.3). The AF request lives in `CapTre_TakeReady` -> API
  `0x50417cd9`, which neither camapp mode reaches.
- **Seam:** TAKE native, its neighbours answered at their own seams. Inside the step: lens at its serial seam (or
  LENS_EXEC answered) and BC_EXEC answered; the sensor control plane far enough for TAKE's through start (TAKE_FUNC
  command 25, 4.1.1); the shutter at its control plane; the strobe can be planned beside the shutter.
- **First step:** the static decodes are done (4.1.1-4.1.3). Next, make the HLS component bring-up (`control camapp
  2`) the default of the coverage workload, so the HLS half of TAKE is measured before TAKE itself is attempted; then a
  probe that runs TAKE_FUNC and TAKE_FUNC_CP natively with a recording stand-in on each queue they send to (4.1.1's
  table), which gives the order and contents of their requests for a start, a through switch and a movie.

#### 4.1.1 TAKE_FUNC's command interface (D unless tagged)

- **Message:** 16 bytes `{+0 reply queue (0: none), +4 token or the sender's tid, +8 command, +12 parameter}`. The
  API sends it asynchronously through `0x503eb960` (target 25) or synchronously through `0x503ec094` (queue
  `(0x60043280)` = 0x5e, command in d1, reply queue made per call, menu spec). The loop `0x502cd1ca` receives with
  timeout -1 (`0x502ce641`), dispatches through `0x502cd230` and replies through `0x502ce619`: 12 bytes `{u16 status,
  token, parameter}` to the queue in +0 when it is not 0, the layout of DISPLAY's replies.
- **Dispatch:** commands 0..92 index the table `0x602f4868` (93 run-time pointers; disassembly address = pointer -
  `0x10021020`); a higher command answers `0x4b01`. A handler gets a0 = the message and a1 = the context `0x62a3f148`
  and returns the status. 37 commands share `0x5039a8e9` (answers `0x4b01`, not supported), 38 / 39 / 78 / 79 share
  `0x5039a8ef` (answers 0). While context bit 15 is set, `0x502cd2e0` puts every command except 74, 75, 80, 81, 83,
  84, 85 and 90 into a ring at `*(context + 248)` (`0x502cdfc4`) instead of running it; who replays the ring is ?.
- **TAKE_FUNC_CP:** commands 5, 6, 54, 68 and 69 (handler `0x502cd381`) are forwarded unchanged to TAKE_FUNC_CP (queue
  0x5f) with word 0 cleared, so TAKE_FUNC sends no reply. TAKE_FUNC_CP `0x502cd604` dispatches through a 32-slot hashed
  table `0x602f4a34` (`[command + 1, handler]`): commands 0, 1, 4, 5, 6, 25, 31, 33, 54, 68, 69, 81, 82, 85, 86, 87,
  88; 5 and 54 return to the loop without a reply.
- **Synchronous requests from TAKE_FUNC** go through `0x506d9854(queue, command, parameter)`: from any other task a
  synchronous send `0x5002e39d`; from TAKE_FUNC itself (tid `(0x60042df8)` = 0x69) an OlyQeWr with reply queue
  TAKE_FUNC_IMDFUNC (0xa7) and a 12-byte receive on 0xa7 with timeout -1 (`0x502ce86d`). Every row below that names a
  queue waits there for that task's reply.

| Command | Handler | Sender | What it does and waits for |
|---|---|---|---|
| 0 | `0x502cd32d` | async, the startShootingService API `0x5040e931` (API id `0x2000a`) | the parameter's two words: context byte +349 = both are 1; forwarded to TAKE_FUNC_CP command 0 |
| CP 0 | `0x502cd6c4` -> `0x502cd760` -> `0x502cd820` | TAKE_FUNC | a state at `0x62a3f394` stepped by the two words, then the ready sequence: a message to TAKE_POWER_MANAGER_EXEC (0xd7); the camera driver's request 148 through `0x502cd411` -> `0x502a4a46` (the driver's request switch, ids 5..152 in the hashed table `0x602c651c`), whose completion `0x502cd4d0` sets TAKE_CAM_EVENT (0x42) bit 1, waited for with OlyEvWt at `0x502cd49f` under the TAKE_FUNC semaphore 0x19 (OlySmWt / OlySmSi); then BC_EXEC (0x09) `{0x61, 2, 29 or 0, param}` and LENS_EXEC (0x2e) `{0x61, 1, 4 or 1, 12-byte buffer}` (pending bits `0x62a3f3b0` \|= 0x82 and 1), their replies received on TAKE_FUNC_CP_POST (0x61) at `0x502cdad2`; the driver's request 6 follows. This is shutter spec item 14's flag-66 wait |
| 13 / 14 | `0x506d7f03` / `0x5039a9fe` | sync, api_rec `0x5040ed39` (API `0x2000f`) at the start | exposure on / off: context bit 1; TAKE_EXPOSE (0x5b) commands 0 and `0x200` (13), `0x201` and 1 (14), under the context's mode bits |
| 18 / 19 | `0x5039aad4` / `0x5039ab4d` | sync, api_rec `0x5040e5a5` (API `0x20006`) at the start | focus on / off: context bit 3; 18 calls `0x506eab1f` (strings tfcs_imdfunc, TAKE_CONTINUE_END), TAKE_FOCUS (0x5d) command 2, then the mode computation `0x5039c864` -> `0x5039bb7e`; 19 sends TAKE_FOCUS command 1 |
| 22 | `0x5039ab86` | sync, api_rec `0x5041073d` | TAKE_FOCUS command 2 when context bit 15 is clear and the bits `0x28` / `0xa8` allow it, then `0x5039c864` |
| 25 | `0x506d7f55` | async, api_tft `0x504214fc` from `CapThr::start` `0x50bcc0d8` | the through start: settings reads, command 29's body (`0x5039bacd`, the entry a `call` uses), `0x506d83f9`; delays with OlyTaSS `0x5002c6e5` while through_s_wait (`0x62a3f2b4`) is set; TAKE_FUNC_CP command 25 (`0x506d99ce`) |
| 27 | `0x5039b17e` | async, api_tft `0x50422021` from CapThr's `Pause_Through` `0x50bd1299` | the through pause: through_pause (`0x62a3f2b6`) and through_p_wait (`0x62a3f2b5`) bytes, the mvr IF helper `0x506d961e(5, ...)`, asynchronous messages to TAKE_FUNC_CP (`0x502ce57b`) |
| 28 | `0x5039b468` | async, api_tft `0x504220fe` from CapThr's `Restart_Through` `0x50bd1330` | the through restart: through_start (`0x62a3f2b8`) = 1 at `0x5039b48c`, `0x506d961e(1, ...)`, a copied message to TAKE_FUNC_CP (`0x502ce5b7`), CPU 2's WB_MOV queue (0x2006) command 1 |
| 29 | `0x5039bac8` | sync, api_tft `0x5042404f` | a mode update: settings `0x1e71` and `0x8551`, the mode computation `0x5039bb7e`, `0x5039c6a3` |
| 30 | `0x5039d5a4` | async, api_movie `0x503f1a00` (API `0x5000c`) | movie start: TAKE_FOCUS `0xa03`, TAKE_EXPOSE `0xc00`, TAKE_FOCUS `0xa00`, the mode computation; CPU 2's SDET_EXEC (0x2005) command 4; the mvr IF helpers `0x506d961e(4, ...)` and `0x506d9659(4, ...)` (`0x5042dcbd` / `0x5042dd49`); CPU 2's MOV_COMMAND (0x2001) command 16 |
| 31 | `0x5039d91b` | async, api_movie `0x503f1af9` (API `0x5000d`) | movie stop: MOV_COMMAND command 26; a 16-byte message to MOV_COMMAND (`0x502ce5b7`); TAKE_FUNC_CP command 81; SDET_EXEC command 5; TAKE_FOCUS `0xa01`; TAKE_EXPOSE `0xc01`; a 12-byte receive on TAKE_FUNC_POST (0x62, `0x502ce67e`) |
| 68 / 69 | `0x502cd381` -> CP `0x503a85f0` / `0x503a860f` | async, api_movie `0x503f4b0e` / `0x503f4be7` (APIs `0x50041` / `0x50042`) | forwarded to TAKE_FUNC_CP, which sends CPU 2's WB_MOV queue (0x2006) command 7 (68, then `0x503a86ab(1)`) or 9 (69) synchronously |

The rows give each handler's requests in code order; several are conditional. The CPU 2 queue ids come from
`0x60043670..0x6004367e` (MOV_COMMAND 0x2001, SDET_EXEC 0x2005, WB_MOV 0x2006, from CPU 2's object-name table). No lab
runs a CPU 2 reader, so a native TAKE_FUNC would wait for ever at the first of these sends (I). The meaning of the
TAKE_EXPOSE / TAKE_FOCUS command words (`0xa0n`, `0xc0n`, `0x200`) and of the mvr IF helpers' kinds is ?; whether
TAKE_MOV (flag 0x95) is woken from commands 30 / 31 is ?.

#### 4.1.2 The TRA layer: TRA 485, who handles 991 and what answers 990 (D unless tagged)

- **The exec (`0x50af7cb9` / `0x50af7cbe`):** it asks the local handlers first (`0x50af8019` over the list of the
  transaction dispatcher `0x62afd244`, returned by `0x50af7ff4`; each handler object's vt[0](id, request, out)), then
  sends the request through the receiver substance (this->vt[9], vt[35], vt[41]), the remote path through which the
  State Mediator hands it to the active state's components (shutter spec item 43).
- **TRA 485 never happens:** the system-transaction handler `0x50af89f4` (slot 4 of the reception's vtable
  `0x60dffdd0`, OlyHfwReception.cpp) takes 428 (an EVFW observer registration, `0x50af8df9`), 429, 431, 440, 441, 443
  (`0x50b7e1d6`), 483, 484, 485 (adds the handler at request +28 to the local list, `0x50af7fa8`), 486 (removes it,
  `0x50af8069`) and 493. The request classes of 485 (vtable `0x60dcb54c`, isTypeOf `0x50ab7a18`) and 486
  (`0x60dcb594`) are never built: no word of the main block, code or data, holds either vtable (byte scan), and
  nothing calls their isTypeOf directly. So the local list stays empty on the camera as in the lab, every transaction
  takes the remote path, and no module registers 991's handler; the earlier reading "a module registers it through TRA
  485 (I: TAKE)" is withdrawn.
- **Who answers:** components consume transactions in hashed dispatchers keyed by id - base (`[id - base, case]`
  tables). Of the 145 dispatchers of that code shape in the main block, only two hold 990 and 991: the shooting
  component's, CmpSht_ShootingComponent_NEW `0x50d725f0` (table `0x60ef0354`, ids 414..1492), and the same table in
  Cmp_StillShootingComponentBase `0x50c7b9b8` (`0x60ea1aa8`); no code compares an id with 990 or 991 outside the two
  classes' own isTypeOf (`0x50ac147d`, `0x50ac14b0`). The running component is the `_NEW` one (X: `0x50d725f0` runs in
  a camapp 2 session, `0x50c7b9b8` does not).
- **990 (startShootingService):** case `0x50d72a2d` answers first, through Com_ResponserManager / Com_ResponserUnit
  (`0x50d7edc6` -> `0x50d7f017`, `0x50d7f197`, which build an evTraResProcessStartSuccess, id 425, `0x50ab6f71`; the
  evTraRes names and ids are at `0x60dd40bc`), then sets the component up (`0x50c78b35`, the media query api_media
  `0x503f0bd7`). Why the native run of shutter spec item 43 saw no answer is ?.
- **991 (the through image on / off):** the request's +32 is the switch (ctor `0x50ac1495`). Case `0x50d72eb5`
  answers the same way, then calls Cmp_ShootingComponentBase `0x50c7d457`, which for 1 starts the through capability
  CapThr_ThroughImage (`0x50bd0467(1, 1)`: its StartSync trigger `0x50bcfeb1`; `(1, 0)` would be Start `0x50bce2a3`)
  and for 0 stops it (`0x50bd04c9`, "Trigger Force stop"). CapThr reaches TAKE through api_tft: `CapThr::start`
  `0x50bcc0d8` -> `0x504214fc` = TAKE_FUNC command 25, `Pause_Through` -> command 27, `Restart_Through` -> command 28
  (4.1.1). Which of the capability's triggers a given switch ends in is its own state machine (I).
- **When 991 is sent (D, X):** `ctrlAutoThrough` `0x50abd373` builds it only in the shooting phases 100 / 101, only
  when `(0x6035e9d4)` is 1, and only when the switch changes the word `(0x6035e828)`: a switch to 1 needs it 1 and
  clears it, a switch to 0 needs it 0 and sets it (I: 1 while the through image is stopped). The start's
  `ctrlAutoThrough(1)` sends nothing (X, camapp 1 and 2: the word is not 1); the menu's open and close do (the golden
  workload runs the constructor, under S-THROUGH and S-TRAACK).
- **No through_start code at `0x5039f8df`:** `0x5039f7f5..0x5039fc93` is TAKE_FUNC's debug dump ("--take_func--",
  "job.com"), and `0x5039f893..0x5039f8df` print the context bytes through_s_wait `0x62a3f2b4`, through_p_wait
  `0x62a3f2b5`, through_pause `0x62a3f2b6`, through_ipause `0x62a3f2b7`, through_start `0x62a3f2b8`, cnt_thr_start
  `0x62a3f2b9`, take_mov_init `0x62a3f2ba`, start_up_flag `0x62a3f2bc`. through_start is written by command 28
  (`0x5039b48c`), `0x5039b9fc` and `0x506d83f9`; TAKE's through start is command 25 and its callees.

#### 4.1.3 How events reach the shooting sequence (D unless tagged)

- **gap@0x50c5c4ac is the sequence's per-phase dispatch.** CmpShc_ShootingSequenceBase's running state (4) handles an
  event in `0x50c591d4`: first `0x50c5b2d4` ("SeqState [%d] EventId [%d]") takes the event's id (vt[3]) and the phase
  of the sequence-parts controller at +2784 (`0x50cc60fa`, phases 101..122), and calls through the jump table
  `0x60e993a0` the phase's dispatcher, a pointer to member in `0x6036449c..0x6036453c` that the static initialiser
  `0x50c5c973` fills at boot (with `0x50c63dd9`, the module's 458 executed instructions). Phases 101..118 have 18
  hashed dispatchers (`0x50c5cc48` .. `0x50c635b9`, tables `0x60e994b0..0x60e9c0b0`, base 281..792 per phase), phases
  120..122 three small ones (ids 25, 793, 27 / 851), phase 119 none; an event no phase takes goes on to `0x50c5bade` and
  `0x50c5924f`. Each case calls a virtual method of the controller (CmpSqp_SequencePartsBase and its variants:
  ZeroLag, MultiExposure, HandheldHighRes, PictBkt, DigitalNDFilter, ...). Together they take 193 ids in 25..1516; 990,
  991 and the notification ids 1270..1431 are not among them.
- **Inbound: the 209 classes in gap@0x50c7eeb2** (ids 340..1489, one constructor each that stores the vtable and the id
  at +4) are built by Com_EvSenderManager `0x50d76ac8` (115 classes: the application's and the system's events, such as
  the key codes `0x0200xxxx`, mapped to sequence events) and by one observer class per capability notification, among
  them CmpSts_ObserverNotifyTakeReadyFinish 794, TakePictureDone 791, TakePictureComplete 790, TakePictureFail 804,
  TakeFree 788, TakePictureNr 843, RecordMedia 787, MountMediaDone 784, BufferFree 782, Trig1Release / ReleaseOff
  826 / 827, Trig2Release / ReleaseOff 824 / 828, MovieOn / MovieOff 829 / 900; CmpShc_ObserverNotifyThroughExecDone
  1123, AELockDone 1074, AFLockDone 1075, LensInitializeError 1076, ZoomUpdate 1167; CapTak_NotifyStopTakeReadyDone 793;
  CapAFL_Notify_OK / NG 781 / 780; CmpMov_NotifyRecReady 344, MovieStopped 341, BufferFull 342 (callers of each
  constructor in the module map). The observers are what the components register with the capabilities (CapTak_Take,
  CapAef, CapAFL, CmpMov's recorder), which call the modules through `api_*.c`; how a module's reply or callback
  reaches a capability's observer (the HLS executor's token routing, shutter spec item 14) is ?.
- **Outbound: the release notifications are the HLS's own.** The classes of shutter spec item 20's ids (gap@0x50af1ebd,
  98 constructors, ids 1270..1507) are built by the sequence parts and components, not by modules:
  CmpSqp_SequencePartsBase builds 1308 START_EXPOSE, 1319 START_READY, 1320, 1321 END_FOCUS (also CapAef_AEAFLock),
  1322, 1323 START_FOCUS, 1324 START_SHOOTING_PICTURE, 1325 UPDATE_SHOOTING_TIME, 1326, 1327, 1328, 1329 and most
  others; Cmp_StillShootingComponentBase 1316, 1389, 1392, 1507; CmpShc_ShootingSequenceBase 1301, 1312; CapTak_Take
  1291, 1313, 1314, 1358; CmpSts_RecordController 1286, 1413, 1428. S-RELSEQ therefore stands in for the sequence
  parts' notifications, and what makes the parts send them is the inbound events above (I).
- **What runs (X, a camapp 2 play session with S1, S2 and two REC presses, observers on the dispatchers and
  Com_EvSenderManager, coverage):** S1 and S2 reach Com_EvSenderManager (`0x02000100`, `0x02000101`, their releases
  `0x0201xxxx`) but no event reaches the sequence's state-4 handler; each REC press (`0x0200120a`) reaches it as event
  1080, which the phase-101 dispatcher takes (case `0x50c5d628`). Functions entered: the sequence base 67 of 311,
  CmpSqp_SequencePartsBase 128 of 3,205, gap@0x50c5c4ac 5 of 111 (phase 101 only), gap@0x50c7eeb2 7 of 838,
  gap@0x50af1ebd 22 of 438, CapTak_Take 20 of 145 (not TakeReady `0x50bc79e6` nor takePicture `0x50bc876a`), the
  shooting component's dispatcher `0x50d725f0` (event 502 three times, not 990 or 991); TAKE_FUNC's loop none. The
  release callbacks still come from S-RELSEQ; where Com_EvSenderManager sends S1 and S2 is ?.

### 4.2 Sensor, ISP front end and live view (with EXP)

- **Tasks (D):** CPU 0: TAKE_FUNC's through commands 25 / 27 / 28 and their context bytes `through_s_wait` ..
  `through_start` (`0x62a3f2b4..0x62a3f2b8`, 4.1.2; the through permit `0x501c40d0` called at `0x5039f578`, the frame
  display mode `0x500256d9` at `0x5039f622`); TAKE_EXPOSE (command handler `0x50596187` writes
  the AE result objects `0xc12a` / `0xc0ba` / `0xc0ca`); EXP_MOVIE 0x58 `0x50553697` (states THROUGH_START ..
  THROUGH_LV_END, CONT_LVAE, `[EXP] AF_BV_18x18`); ISEQ_MAIN 0x44, ISEQ_ASIC 0x81; USR_FAST_APP 0x55 `0x501e673b`;
  PER_CCD_TEMP_MAIN 0x14. CPU 2: EXP_MOVIE2 0x2009 / EXP_MOVIE3 0x200a (the EXP module, I), MVR_IMG1 0x2005, MVR_IMG2
  0x2007, MVR_IMG_POST 0x200b (`0x5045c590`), MVR_IMG_PRE / EXE / AFT, MVR_CALC, MVR_MAIN. CAM_MAIN 0x0b is a `retf`
  stub: the camera driver runs in its callers' tasks and in interrupt context (I).
- **The live-view request is built on CPU 2 (D):** the TH API's callers `0x50451fc7..0x5045539f` are reached only from
  MVR_IMG task code (`0x5045cb94`, `0x5045cee1`, `0x5045cf4d`, `0x5045d2c9`). The live view runs the sensor in its
  movie readout modes (`CAM_SENSOR_MODE_MOVIE_*`), sequenced by `cam_seq_movie.c` `0x50198945..0x5019c678` (I).
- **Front-end blocks (D):** the `cam rapinput` debug command lists 21 sub-blocks (AF, PRO1, PRO2, EMS1, EMS2, PROVDC,
  five VOB variants, AE1, AE2, AWB1-4, PFP_LV, PFP_AF1-3), each fed from one of 10 sources (SSG, CMD, RAP_1-3,
  VDC_1-4, BN). Where RAP, VDC, BN and CPI sit in the address map is ? (I: reached through base pointers).
- **MMIO and IRQs (D; level 2 unless noted; every handler reads a status register, writes it back and calls per-bit
  callbacks):**

  | Block | MMIO | IRQs |
  |---|---|---|
  | SSG1 (sync generator, I) | `0x9b000000` | 15, 16, 17, 18 |
  | SSG2 (I) | `0x9b080000` | 19-22 |
  | SLVS receiver (I) | `0x98280000` | 243-247 |
  | PRO1 / PRO2 (cam_prepro.c) | `0x9b300000..0x9b304fff` | 27-31 |
  | unnamed (code after cam_prepro) | `0x9b180000` | 24 |
  | AE1, AE2, AWB1-4 (cam_bright.c) | `0x9b380000..0x9b384fff` | 32-37; callback table `0x629a7c64` copied from `0x6022575c` |
  | AF contrast (cam_contrast.c) | `0x9b400000..0x9b401fff` | 38 |
  | PFP (I) | `0x9b480000` | 39 |
  | camera clocks / control | `0x9b500000` (gates `0x9b5008xx`) | 40 |
  | two DMA blocks (?) | `0x9b580000`, `0x9b600000` | 41, 42 |
  | EMS1 engine (I; role ?) | `0x9bd80000` | 276 (level 5) |
  | cam.c, unknown | RAM only | 26, 25 |
  | DISP_SYNC (display side) | `0x9c180000`, 18 code references | ? |

- **Seams:** A, MVR_IMG's TH request builders run on the lab CPU (the S-DISPFRAME pattern) in place of H-REQ: 1-2
  weeks. B, AE / AWB statistics at the driver's callback table with EXP's live-view loop native, fed from S-SCENE
  (retires S-EXPOSE and lets the 107k EXP module run): 3-5 weeks. D, control-plane device models (SSG frame clock and
  IRQs 15-22, SLVS status and IRQs 243-247, clock gates, W1C status, register files) until TAKE's through start
  completes: 4-8 weeks, open-ended. Seams C (the cam driver API) and E (today's module answers) replace firmware and
  are not targets.
- **First step:** TRA 991's path is read down to TAKE (4.1.2): the shooting component, CapThr_ThroughImage and
  TAKE_FUNC commands 25 / 27 / 28. Trace command 25 (`0x506d7f55`, the through start) to the MVR command MVR_IMG
  executes before `0x504340cd`; then run TAKE_FUNC and TAKE_FUNC_CP natively in a probe session with a recording stub
  over `0x9b000000..0x9b6fffff` and `0x98280000` (every access logged in order, reads 0, nothing kept). The log names
  the first device the live-view start needs and gives the register program per block.
- **Unknowns:** which hardware writes the YC through image into the live-view banks; the statistics' memory layout
  (readable in principle from EXP's and MVR's consumer code); the sensor's serial protocol and replies; the per-mode
  register meaning of gap@0x5017eeda (1,285 call edges, D).

### 4.3 Still capture, image processing and recording

- **Tasks (D):** CPU 0: ISEQ_MAIN 0x44 `0x5086516f`, ISEQ_ASIC 0x81, ISEQ_IMG_PROC 0x7d, ISEQ_IMG_COMP 0x7c,
  ISEQ_IMG_COMP2 0x80; IMG_PRECON 0x11 `0x50537e85`; REC_MAIN 0x1d `0x505396d1`, REC_IMAGE 0x1c `0x50541c45`, REC_FILE
  0x1b `0x5053f1a4`, REC_PREPRO 0x1e, REC_SOUND 0x1f, REC_PROGRESS 0x7b, REC_VIEW 0x64 `0x505529f7`, REC_EXT 0x6d;
  FILECLBK 0x0d, FILEFGND 0x0e. CPU 1: IMGPRO_MDL_WORK 0x1008 `0x504ad92e`; FILEISCAM 0x100f; DSP0..2 (Live ND).
  CPU 2: REC_MAIN_CPU2 0x2011, REC_VIEW_CPU2 0x2012, REC_PREPRO_STLNML 0x2019, REC_IMAGE_STLNML 0x201a (REC_IMAGE's
  entry: the image-making code is the same on both cores; which core makes a normal still is ?).
- **Objects (D):** queues REC_EXEC_MAIN 0x47 (targets 12 / 13 / 30), REC_EXEC_IMAGE 0x46, REC_EXEC_FILE 0x45,
  REC_EXEC_VIEW 0x4b, ISEQ_MAIN 0x9f, ISEQ_ASIC 0xd4, FILECLBK_UEXEC 0x1f; flags REC_MAIN 0xc7, REC_CAMPOST 0x85,
  ISEQ_CAMPOST 0x111, CIC_END0 0x11f, IMGPRO_MDL_CPU0 0x120 (and per-core CIC_END / IMGPRO_MDL flags). CPU 0 wakes the
  CPU 2 halves through flags 0x200e / 0x2014 and queues 0x2011 / 0x2014 (ids at `0x6004365a`, `0x60043666`,
  `0x60043694`, `0x6004369a`): each hand-off goes through cpu_conn as a doorbell to bank 2 (I, cores spec §5).
- **The pipeline in the firmware's words (D):** REC's trace table `0x506bdb88` names DRAM capture, precondition (WB),
  development through imgpro (main YCC, thumbnail, view), JPEG and ORF encode, header, file write, rec view. REC_MAIN
  runs a handler pointer taken from each job (`0x50539768..0x5053976d`; the job layout is ?).
- **MMIO and IRQs (D):** TAKE, REC, ISEQ and cam_still contain no MMIO. The imgpro library (`0x50480000..0x504f0000`,
  no file strings) uses `0x9c200000..0x9c26ffff` (about 370 operands), `0x9c400000`, `0x9c480000`, `0x9c500000`,
  `0x9c580000`, `0x9c600000`, `0x9c680000`, `0x9c080000`, `0x99901000`, `0x9bf80000`; IRQs 282, 283 (level 4), 288,
  289 (level 5), 290-292, 296-302 (level 4), each attached on CPUs 0..3 (`0x50053fcd` with a1 = 0..3,
  `0x5048c3ae..`). The CIC engine is `0x9be80000` (50 references, IRQ 280; callers `iseq_raw_edit_if_cic.c` and
  `play_cic_decode_raw`). The imgpro library is about 275k instructions, 162k of them straight-line parameter packing;
  a 164,928-byte high-entropy CMIO blob at `0x50797460` is loaded by `0x504adaeb`.
- **Seams (C, recommended; TAKE, ISEQ and REC native above them):** C1 still DRAM capture (`cam_seq_dram_capture.c`,
  `cam_still_drv.c`; completion through TAKE_DRAMCAP 0xb1, REC_CAMPOST 0x85 or ISEQ_CAMPOST 0x111, which one is ?);
  C2 the imgpro_mdl API (about 10-20 entry points such as `0x504841c4`, `0x504848ea`, `0x50491699`; source and
  destination descriptors dumped by name in the firmware's debug printers); C3 CIC (`CicCtrl` block, completion
  CIC_END0); C4 storage at the sdmem sector seam (4.8); C5 the CPU 2 halves, on a CPU 2 kernel or on the lab CPU when
  CPU 0 rings bank 2. REC_VIEW reaches the TH API (`0x5054c1ad`), which runs natively since M7. The pixel processing
  (demosaic, picture modes, NR, gradation) and the ORF compression have no firmware evidence at seam C: the developed
  image stays a declared host stand-in.
- **Breakdown (I):** TAKE reached with its neighbours stood in 1-2 weeks; REC / ISEQ native with C1-C3 stand-ins and
  their parameter blocks decoded 2-3 weeks; C5 on the lab CPU about 1 week; C4 with a FAT image 1-2 weeks; host
  development and JPEG encoder at C2 about 1 week.
- **First step (3-5 days, independent of the shutter):** a probe that starts REC_MAIN, REC_IMAGE, REC_FILE and
  REC_VIEW natively and posts one REC_EXEC_MAIN request as `api_rec.c` builds it (commands 26 / 21 / 18 / 16 at
  `0x5041058c`, `0x50410dbf`, `0x50410cf3`, `0x50414c7e`; header from `0x503e2216`), recording the first stop at each
  lower interface (DRAM capture, imgpro entry, CIC, file layer, CPU 2 doorbell). In parallel, decode the IMGPRO_CTRL_SRC
  / DST and CicCtrl dumps for the struct layouts.

### 4.4 AF, lens and body IS

- **Tasks (D):** CPU 0: LENS_MAIN 0x5c `0x502a5e37` (queue LENS_EXEC 0x2e, target 18), LENS_COMMAND 0x5b `0x50115a08`
  (queue 0x31, target 40), LENS_ASKDATA 0x5a `0x502a8193` (queue 0x2d), LENS_FLASH / LENS_FIRM_UP, ZOOM 0x6e (queue
  ZOOM_EXEC 0x7d, target 26), BC_MAIN 0x57 `0x5013e603` (queue BC_EXEC 0x09, target 34), BC_INDICATOR 0x91, TAKE_FOCUS
  0x68 (queue 0x5d; dispatch through a 64-bucket hash table built at run time at `0x60a54f00`), FCS_IP 0x6f / FCS_IP_SUB
  0x56 / FCS_IP_NOTIFICATION 0x92, FCS_MOVIE 0x59, MDET_CALC_FLAME_VECTOR 0x45. SERV_MAIN `0x509b229f` lies inside
  TAKE_FOCUS and sends SERV_S1 / S2 / F1 / F2 / WF / R1 / OLW messages (I: AF / TAKE). CPU 1: FCS_IP_2 0x100b,
  FCS_IP_2NDCPU_SUBTASK 0x100c, FCS_IMG_2NDCPU_MAIN 0x101e, FCS_IP_RANGING_SUB_TASK 0x1022. CPU 3: FCS_IMG_4THCPU_MAIN
  0x300c, MDET / FACE, DISP_FRAME 0x300d.
- **FCS (D):** FCS_EXEC 0x1b (target 27) has no reader found; the 36-name command vocabulary FCS_COM_* is a debug list
  at `0x61a794bf..`. FCS_IP on CPU 0 posts jobs to CPU 1 and waits on flag 0x92 (cores spec §5.2). The CPU 1 ranges
  `0x50912d23..0x50962d23` (about 100k) and `0x509b2edc..0x509b722d` (8.6k) have no role beyond phase detection and
  ranging (?).
- **MMIO and IRQs (D):**

  | Region | Operands | IRQ (level), handler | Role |
  |---|---|---|---|
  | `0x9b980000..0x9b98021c` | 121, at `0x502c0ea5..0x502c2193` | 14 (3), `0x502c12c0`, attach `0x502c0e79` | lens serial controller (I from the LENS_SSC strings); status `+0x08` W1C (I); clocks 5 and 17 via `0x50061c3a` |
  | `0x9b883e40..0x9b883e6c` | 12, at `0x50122331..0x501225b7` | 60 (3), `0x5012232e` | edge-interrupt unit beside pins 108..113; four event bits dispatched as (channel, edge); callbacks called from the lens sync layer `0x502c4e5f` |
  | `0x9bf00000..0x9bf0076c` | 24 in FCS `0x50957687..0x5095799e`, plus `0x5002563b` and `0x502c0e99/9f` | 281 (3), `0x5095798f` | a DMA-driven unit used by FCS, clocks 36 / 37 / 48 (function ?) |
  | `0x9b400000..0x9b401808` | 150 | 38 `0x501616f7` | contrast AF evaluation |
  | `0x9b480000` | 40 | 39 | PFP, the phase-detect pixel path (I) |

- **External chips:** the lens MCU over the serial device and the IRQ 60 edge lines (its firmware is not in the body
  `.BIN`); an IS controller with its own firmware and update path, reached through the generic PER_SIO driver
  (`0x5005f49f` from `0x50144f14`) and GPIO helpers in the `0x9b880000` pin block, on a SIO channel not decoded (?).
  The gyro sits on the IS side (I): the body sees offsets and zero tables, not raw samples. No E143 block holds the IS
  controller's firmware (`blk0e560000` is the SCPU's).
- **The BC driver (D):** BC_MAIN, BC_INDICATOR, the `bc_ssc` serial link, `bc_stab` / `stage` / `blc_sync`; 34-42k
  instructions in `0x5012d000..0x50152000`.
- **Seams:** the lens at its device (seam C: one external MCU, one serial device, the record layout already D, and
  S-LENS shows its consumers run natively); AF at the module seam TAKE_FOCUS / FCS_EXEC with a scene-driven result and
  the AF info block written as the module writes it; IS at BC_EXEC. Seam C advances only as far as the parsers make the
  expected answers readable; an unknown packet stops with an error. Native FCS (the AF data path) is LLE-scale work:
  it needs CPU 1, the sensor pipeline and the `0x9bf00000` unit.
- **First step:** decode the lens serial layer statically: the send / receive API around `0x502c0e79..0x502c2193` (the
  register roles, IRQ 14's status bits), the command-history record behind the debug table (`0x502c5f17..`) and the
  response parsers called from the lens init steps `0x50122cac..0x50122e1b`. Then allow LENS_MAIN, LENS_COMMAND and
  LENS_ASKDATA in a probe lab with `0x9b980000` as a logging device model that faults on the first unknown response,
  and record the init sequence's first command packet.

### 4.5 Movie, audio and the AV back end

- **Chain (D):** CA_MAIN RECORDING_MOVIE `0x51068e37` -> the shooting component's MOV_READY 113 / MOV_READY_FINISH 114
  / MOV_RECORDING 115 / MOV_END 117 -> CapMov_MovieRecorderSLR (`0x50bf1751..0x50bf1ad0`) -> `api_movie.c` (entries
  `0x503f1a00`, `0x503f1af9` send asynchronously to target 25 = TAKE_FUNC; command words 30 / 31, and 68 / 69 from
  `0x503f4b0e` / `0x503f4be7`, 4.1.1) -> TAKE_FUNC, TAKE_MOV, EXP_MOVIE (CPU 0) -> the mvr IF
  `0x5042d000..0x5044ffff` (CPU 2 flag ids 0x2003 / 0x2004 passed to MVR's helpers `0x5044ec1b` / `0x5044ec8e`:
  cpu_conn traffic, not sys_callrequest) -> MVR_*, EXP_MOVIE2/3, WB_MOV, SDET, AUD_LEVEL_MONITOR (CPU 2) -> AVM
  middleware `avm*.c` (`0x50527ee1..0x50532c8c`; AVM0 on CPU 0, AVM2 on CPU 2, AVM_CPUSW / AVM_FILE on CPU 1) -> AVPI
  codec and MP4 mux on CPU 1 (segment 8). No module-API target names a movie, MVR or EXP_MOVIE queue; TAKE_FUNC sends
  to CPU 2's MOV_COMMAND, SDET_EXEC and WB_MOV queues directly (4.1.1).
- **Tasks (D):** CPU 0: TAKE_MOV 0x70 (waits on flag 0x95 TAKE_MOV_TASK), EXP_MOVIE 0x58, FCS_MOVIE 0x59, AUD_MAIN 0x52
  `0x50a62a05` (starts AUD_WAKEUP 0x2017 and AUD_LEVEL_MONITOR 0x200e on CPU 2), AUD_COPY_DATA, AUD_LATE_RISER,
  AUD_WATCH_DOG, REC_SOUND, PLAY_SOUND, AVM_*_0. CPU 1: AVM_CPUSW, AVM_FILE, AVMDL_THREAD00..20, the AVPI VDE / VEN
  BACD tasks 0x1041..0x1050, MASTER_0, CORE_0..3, CABAC_0..3. CPU 2: MVR_MAIN 0x2002, MVR_MOVIE, MVR_IMG*, MVR_CALC,
  MVR_ENC, MVR_WIFI, MVR_RECVIEW, MVR_EXEC, EXP_MOVIE2/3, WB_MOV, SDET, AUD_LEVEL_MONITOR, AUD_WAKEUP, MOVP_AUDIO_SUB.
- **MMIO and IRQs:** audio `0x9bb00000..0x9bb003c0` (211 references, 192 stores; role ?) and `0x9b700000..0x9b70011c`
  (about 62; role ?), both only in the audio driver gap@0x50aa6fe0; pin `0x9b882f40`; the sound IC over PER_SIO channel
  14 (I), with register parameter lists by name (power-on, 48k / 96k, mic, limiter, wind cut, headphone and speaker
  volume). No audio IRQ attach was found among the 127 attach sites (?). The codec engines are three identical banks
  `0x99400000`, `0x99410000`, `0x99420000` (137 references each) and `0x99500000`, with IRQs 303-306 (level 5, CPU 1
  only, handlers in segment 8). `0x9a000000` is not a device (section 9 item 5).
- **The AV back end (D):** AVFW / AVPI plug-ins: the firmware's own MP4 / MOV muxer and demuxer, H.264 / HEVC encode
  and decode drivers, rate control, audio codecs, a TS multiplexer (12.4k, use ?), the StlCA_IF still codec (format ?).
- **Seams:** S3 + S4 + S5 + S6 + S7 recommended, S1 (today's callbacks) kept until S2 (the HLS observers'
  notifications) is understood. S6 is where a real file comes out: a host AVM writing a MOV (video from S-SCENE frames,
  LPCM, a tmcd track) through the firmware's own DFS calls, which the camera's own playback could open. The sound IC,
  the PCM blocks and the codec engines (S8-S10) are LLE and not targets.
- **Stages (I):** A, TAKE_FUNC's movie commands and TAKE_MOV's flag loop, S3 and the S2 callbacks, S5 + S7 so AUD_MAIN
  runs natively: 3-4 weeks after the item-43 work. B, a CPU 2 service model for MVR's cpu_conn traffic: 3-5 weeks
  (shrinks to its device parts once CPU 2 runs natively, section 6). C, S6: 4-6 weeks.
- **First step:** TAKE_FUNC's cases 30, 31, 68 and 69 are read (4.1.1): they wait on CPU 2's MOV_COMMAND, SDET_EXEC
  and WB_MOV queues and on the mvr IF helpers; whether they wake TAKE_MOV is ?. Next, the registration through which
  CapMov_MovieRecorderSLR gets its Notify* observers (the CmpMov_Notify* observer classes of 4.1.3); then check in a
  camapp 2 session whether anything below CA_MAIN calls `0x503f1a00` / `0x503f1af9` on REC.

### 4.6 CPUs 1-3, inter-core services and the A53

- **Placement (D, cores spec §1, §4):** CPU 1 (97 static tasks): Wi-Fi, BLE, PTP-IP, the A53's owner, the AV back end,
  DSP0-2, the AF second stage, C3D_EXE, FACE_BEAUTY. CPU 2 (37): the overlay loader, MVR, EXP_MOVIE2/3, WB_MOV, SDET,
  the REC halves, AUD_LEVEL_MONITOR, AUD_WAKEUP, OSD_DRAW_CPU2. CPU 3 (18): MDET, FACE, FCS_IMG_4THCPU_MAIN, DISP_FRAME,
  three boot jobs. The inter-core layer ships firmware function pointers and kernel object operations between cores;
  it is plumbing, not a service protocol, so answering it at the call seam means re-implementing every remote function.
- **Idle (D):** idle `0x500387eb` writes the core's "up" magic and calls OlyTaSE, which halts (`(0x8040) = 8`); the
  tick ISR `0x500387b9` puts a core to sleep on CPU 0's request. Idle CPUs 1-3 halt, they do not spin.
- **Mechanisms (D, direct-call scan):** sys_callrequest `0x50035afd` (74 sites); CREQ `0x50036120` (49 sites, 27 above
  `0x51400000` in CPU 1's network code: httpd / CGI, the external power / IO expander, BLE, debug); cpu_conn through the
  Oly* wrappers; the kernel kick (`+0x810`, IRQ 325); the ISC kick `0x50aa324b` (targets 0..3: `0x4000` to that core's
  bank `+0x800`; target 4, the A53: `0x4000` to the caller's own bank `+0x880`); ISC hardware semaphores `0x97000000`.
  The ISC receive IRQ is 323 (level 4, all cores, handler `0x50039c4d`): bank `+0x800` bit `0x4000`, acked at `+0x804`;
  IRQ 326 writes 1 to the own bank's `+0x81c` and spins (I: a stop request).
- **Boot jobs:** CPU 2's overlay loader needs flash reads (all segments are already in the lab image, so setting the
  segment bits `0xa32df1f4` and flags `0xa32df1ad/b6` after the per-segment hook `0x50024eda` is a D-backed shortcut);
  CPU 3 reads AJ (flash `0x400a0000` -> `0xa34fd280`, 0x20000 bytes) and runs MLS `0x5003e0a1` and pis `0x50040aeb`.
  The settings mirrors' boot load (`0x5000941f` -> `0x5003e0a1`) lies inside BOOT_CPU3's body `0x50009347..0x50009482`
  (D), so a native multi-core boot must keep S-NVRAM's restore consistent with CPU 3's job.
- **Shared IRQs:** the imgpro IRQs 282-283 and 288-302 are attached on all four cores (4.3); which core services them,
  and 307-309, 53 / 54 and 323-326, depends on the enable calls `0x50054012` / `0x5002ea93`, not scanned.
- **The A53 (D):** block `blk05a00000` holds an aarch64 Linux 4.14.222 image with a network userland (section 4.11).
  SYS_CA53_PWR_MNG (CPU 1, `0x5003c8f4`) powers the A53 on request, with a request / response queue and a "load arm
  linux from sd" string; which requests trigger it is ?. Seams: "A53 off", the firmware's own path where the network
  tasks report "not available", or the ISC endpoint at node 4. Never emulated.
- **Seam:** cores native on one bus, per-core state and devices (section 3.2's row); timing: boot polls have no
  timeouts and run-time rings are FIFO with a full check, so any fair interleave works (I), but timed waits on replies
  need the remote core to run within lab time; relative core speed becomes a named assumption.
- **Breakdown (I):** multi-core machine (per-core state and pages, per-core INTC delivery, kick and doorbell registers,
  ticks, a scheduler that skips halted cores, debugger core selection) 2-3 weeks; native four-core kernel boot 1-2
  weeks; S-CPU2 / S-CPU3 / S-DISPFRAME retired 1 week; the A53-off seam mapped 1 week.
- **First step:** a two-core lab: CPU 0 as today plus CPU 2 entered at its kernel body `0x50012826`, with per-core
  `0x8000` pages, bank 2 delivering IRQ 324 and tick 140, and the kernel-start barrier run natively for cores {0, 2}
  (the barrier wants 0xf, so CPUs 1 and 3 keep a stand-in bit); then start AUD_LEVEL_MONITOR `0x200e` on CPU 2 through
  the firmware's own OlyTaStCpu and serve the Super Control Panel's post `0x50aa9d4e` natively, replacing S-CPU2. The
  check: the same panel frame and reply, no `xcpu_problems`.

### 4.7 SCPU, power, clock, on-board sensors and persistence

- **Tasks (CPU 0, D):** PER_SCPU 0x7a `0x5005b424` (the request server: reads type-3 PER_SCPU_RECEIVE id 2, message
  type 11 to the framework `0x5004fed5` / `0x5004fe2e`; starts a 100-period software timer, purpose ?), PWR_MAIN 0x0a
  (queue PWR_EXEC 0x7c, target 28), PWR_STANDBY 0x9d, PER_IN 0x15, PER_EYE_SENSOR 0x41, PER_SLOPE 0x4e (level gauge),
  PER_ROTATE 0x3b, ACC_MAIN 0x79 / ACC_SENS_MAIN 0x84 / PER_ACC_PWRMGR_MAIN 0x8d (accelerometer, its sampler, a
  camera-down detector for power saving), PER_IOEXP 0x88 / PER_IOEXP_PBH 0x8c, FLASHMEM 0x85 / FLASH_PRM_EXEC_ASYNC
  0x86, PER_CCD_TEMP_MAIN 0x14.
- **SCPU window `0x98e00000` (D):** every register write is committed by writing `0x20041001` to `+0xf4` and polling
  for 0. `+0x00` reg0 (clock signature); `+0x08..+0x3c` 14 backed-up words; `+0x90` wake / reset cause; `+0x94`
  channel-done bits (IRQ 321 handler `0x5004e243`); `+0x98` event pending bits (IRQ 320 handler `0x5004e1fd`, up to 4
  callbacks); `+0x9c` 7 request bits (`+0x9c` = 127 ends the power-off sequence); `+0xa0..+0xb8` seven port
  registers, bit 31 each an input; `+0xbc..+0xd8` the two transfer channels A and B; `+0xe8 / +0xec` the clock
  (seconds since 1970 local time, 1/1024 s in bits 14..5). IRQs 320 and 321 (level 5) are attached by the SCPU init
  `0x5004dc55`, which the lab does not run.
- **The request API (D):** `0x5005cd17` sends a 28-byte request `{+0 u8 cmd, +4 s_size, +8 tx, +12 r_size, +16 rx,
  +20 completion function, +24 arg}` inside a 36-byte message to PER_SCPU_RECEIVE (timeout 5000); the completion sets
  the requester's flag. Commands with known formats: 0x01 / 0x81 clock set / get, 0x06 / 0x86 backup word write / read,
  0x02 / 0x82 GPIO extension pins, 0x07 / 0x88 port scan (reply bit 0 is UI_IN group-4 `0x0400`), 0x87 firmware-update
  state. 0x85 / 0x05, 0x80 and 0x04 are memory, version and system control by their names (I); 0x12 belongs to the
  power manager, format ?. Who calls `+20` and when the rx bytes land is in the PER_SCPU state machine, not read (?).
- **Inputs from the SCPU (D):** UI_IN's module init registers `0x5014e534` as an IRQ 320 callback; it reads the port
  byte (`0x5004df3f`) and pushes it as group 0's image: the power lever, the Fn lever and S1 are sampled by the SCPU.
- **Accelerometer (D):** ACC_SENS_MAIN reads register 0x0f of device channel 6 and wants 0x6a (I: the WHO_AM_I of ST's
  LSM6DSL / LSM6DSM family); the bus is SPI over PER_SIO (`[PER_ACC_SPI] per_sio_open_error`, ACC_SPI). Samples land in
  the cache `0x62963f60..0x62963f6c` and bump the counter `0x6034d9d4`. Level Adjust's loop `0x5004ad13..0x5004add7`
  waits for 12 counter changes through the pointer `(0x62963f58)`, which the unrun module init `0x50048cad..cf` sets;
  in the lab it reads low RAM 0 and never ends.
- **Flash (D):** NAND controller `0x98d01100..0x98d011c0`, `0x98d01800/04`, completion IRQ 237, 2048-byte pages;
  store mirrors M `0xa36fd280` and E `0xa377d280` saved by `0x5003f5dd`. The settings init chain `0x503dae30` (17 module
  inits) is called once from the boot chain at `0x501e9060`; the lab runs none of them.
- **Power-off (D calls, I meaning):** `0x50044d8e..0x50044de7` sends on a channel, arms channel A, tests the camera
  state, calls the IO expanders and ends with `0x5004dfd0` (`+0x9c` = 127). An HLE of the lever lets this run and ends
  the session at that write instead of H-POWER's immediate close.
- **Steps (I):** 1, a host server at PER_SCPU_RECEIVE for 0x01 / 0x81 / 0x06 / 0x86 with the clock ticking from lab
  time and S-NVRAM as the default: 4-6 days. 2, the event / port registers with IRQ 320 and UI_IN's registration:
  group-0 keys and the power lever natively, 3-5 days. 3, the accelerometer at the PER_SIO seam or the sample cache:
  Level Adjust, level gauge, rotation, 1-1.5 weeks. 4, the eye sensor (I2C plus GPIO interrupt) driving the native chain
  to `0x50050efd`: 1 week. 5, the power manager: 2+ weeks, gated by hardware numbers. 6, a NAND register model and
  store F: 1-2 weeks, only for a full boot.
- **First step:** read the PER_SCPU dispatch (`0x5004fe2e` and the code reached from `0x5005b490`) far enough to state
  who calls a request's `+20` and when the rx bytes are written; then replace S-SCPU-MSG with a host server on
  PER_SCPU_RECEIVE that answers the four D commands (writing rx, calling `+20`) and refuses every other command by name,
  with `+0xe8` ticking from lab time.

### 4.8 Card, file system and playback

- **Tasks (CPU 0, D):** DCFPROC_SUB 0x02 (queue 0x0d), FILECLBK 0x0d (queue FILECLBK_UEXEC 0x1f, targets 14 / 15 / 17 /
  23), FILEFGND 0x0e, EYEFI 0x40 `0x5088fc7e` (its entry calls the file system's bring-up before its loop, I), REC_FILE
  0x1b, MOVE_FILEREAD / WRITE, AVM_FILE_CPUSW; PLAY_MAIN 0x19, PLAY_LOAD 0x18, PLAY_IMAGE 0x17, PLAY_DECODE 0x76,
  PLAY_LOAD_DRAW 0x77, PLAY_SOUND 0x1a (queue PLAY_EXEC 0x3f, targets 3 / 21 / 31); ALBM_MAIN, a movie-clip album
  manager (about 14k). CPU 1: AVM_FILE 0x905c, FILEISCAM 0x100f.
- **The stack (D):** one contiguous run `0x50872000..0x508b4700`: DCF -> FAT / exFAT (`dosfat.c`, label `OM SYSTEM`,
  AU accounting) -> `fileif` (a POSIX-like API) / `filewrap` -> `logsec` -> the SD driver (`sd_mount`, `sdmem`,
  `sdmem_format`, `sdphy`). logsec calls the sdmem request entry `0x508b1cdc` from `0x508ac2cb` and `0x508ac9c7`.
- **SD hosts (D):** `0x5002539c(port)` returns the base from the table `0x6004773c`: port 0 `0x99000000`, port 1
  `0x9a300000`, the SD core at `+0x2000`. The image carries the full register name table (body `0x9f68b8`, 116
  entries; the PHY's at body `0x9f73fc`, 93 entries): DMA wrapper `+0x00..+0xac`, SD core `+0x2000..+0x21fc`, UHS-II
  `+0x2200..+0x22d4`, PHY `+0x6000..`, MDLL `+0x8600..`. The SD core's names follow the TMIO family (I). IRQs (level 3)
  225 / 227 / 228 for port 0 and 229 / 231 / 232 for port 1; 227 / 231 are switched at run time. A hardware SD-to-USB
  link serves mass storage.
- **Media events (D):** EV_MEDIA_MOUNT_REC 193, _PLAY 194, _END 195, EV_INSERT_EXT_MEDIA(_SLOT2); their sender is ?.
  The HLS mount-word setter `0x50aca6b1` takes kind 4 = SD (`0x60360bfc`), 1 = IN and 8 = SD2 (`0x60360c08`).
- **Seams:** B (recommended first), a block device at the sdmem request (request +0 u16 port, +2 u16 index, +26 u16
  command; commands 0, 1, 2, 10, 11 tested) with a host disk image, so logsec, FAT / exFAT, DCF, fileif, the file
  tasks and REC_FILE run natively; C, sd_mount's result beside it (the drive status's mount bit `0x1000` comes from the
  device state's bit 16, `0x508a83e7`; the lab's state is `0x8600`). A, the SD host registers with a card model, is
  the faithful later step (3-6 weeks, optional). Formatting (`sdmem_format.c`, dosfat) runs natively under B.
- **Playback:** with S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW kept, real files need a JPEG decoder at the codec seam (4.3's
  C2 `decode_jpeg`, `play_img.c`): 2-4 weeks on top of storage. A native path needs the HLS play components (310k),
  segment 9's PLAY_* / MOVP / MOVE, the AV back end for movies and the CIC engine for RAW: a block of its own.
- **First step:** in a probe session, let EYEFI's init chain (`0x508a49f9`, `0x50894d42`, `0x508ac195`, `0x50888c4a`,
  `0x508a533e`, `0x50877de4`) and FILECLBK, FILEFGND and DCFPROC_SUB start, with the SD ports' pages (`0x99000000`,
  `0x9a300000`, 64 KiB each) as a logging device that faults on the first read; record the mount path down to the first
  SD register access, and read `0x508b1cdc` with its logsec callers to fix the request / completion contract.

### 4.9 HDMI and DisplayPort

- **Driver (D):** inside the display code, `0x501d1381..0x501d6ad0` (about 7.7k, 6% run): init `0x501d15e8`, IRQ 239
  (level 5) handler `0x501d508a`, EDID read `0x501d3113`, EDID step `0x501d34b8`, state getter `0x501d30f6`. The
  driver's own task is DISPLAY_DP 0x8e (`0x501d1381`; a debug / ES test task by its strings, I), and DisplayPort has its
  own EDID reads. There is no HDMI task: the DISPLAY task runs the HDMI open.
- **Contract (D):** a byte-register file at `0x99c07000`, written through `0x501d5645` (byte-lane enable at
  `0x99c08000`). Hot plug: byte 8 bits 3 and 4 both 1 (I: HPD and receiver sense); interrupt status bytes 0x90 / 0x92 /
  0x9a. EDID: DDC bytes `0xa80` (segment), `0xa81` (offset), `0xa82` = 127, `0xa83` = 130, a wait on flag
  HDMI_DDC_WAIT 0x103 for 1000 ticks that IRQ 239 sets; the step reads 128 bytes at `0x99c07c00`, checks the header and
  the checksum, reads the extensions, then sets the state `0x62a3c8ec` = `0xF0`, which the DISPLAY OPEN polls. After
  EDID: the PLL / PHY registers at `0x99c08004..`, infoframes, the mode choice from the EDID, CEC registers by name
  and audio (HDMI_AUD_RESP 0xa2): semantics ?. Video goes out on VSC channel 0.
- **First step:** a DDC / EDID model with a standard EDID behind IRQ 239 (about 1 week). It needs IRQ 239 delivered
  while DISPLAY waits; if ROADMAP phase 3 is not in yet, this is its first test case. Polls past the EDID whose exit
  values have no firmware evidence are reported, not guessed.

### 4.10 USB, PTP and PictBridge

- **Tasks (D):** PC_EVENT 0x5d, PC_HOSTCOM 0x5e, PC_PCMRECLINK 0x5f, PC_PTP 0x60, PC_UAM 0x61, PC_USB 0x62 (queue 0x3c),
  PC_USBSRV 0x63, PC_PD_COM 0x7f (queue PC_PD_CMD_EXEC 0xcf; already runs 28 instructions, X), PC_CHECK_ALIVE,
  PC_HOST_ASYNC; PTP: PTPCOM 0x3c, PTPASYNC 0x3d, TPC 0x24, TPC_DATA 0x25, TPC_CAMC 0x04, TPC_LANG 0x3e,
  TPC_CAMC_FILEADD 0x71, TPC_STAMODE_MAIN 0x82; PictBridge: SAICAS and DPS_MAIN 0x0c (the DPS transport).
- **Device controller (D):** register-dump strings at `0x51026af8` name a Synopsys DWC_usb3x device core at
  `0x9a600000` (global registers `0x9a60c100..`, device `0x9a60c700..`, endpoint commands `0x9a60c800..`); glue
  `USBTOP_*` at `0x9a620000` and `0x9a610000`; IRQ 223 (level 5), handler `0x5102a9ad`, attached in PC_USB's init.
  Modes: storage, MTP, PTP, PC host SCSI; no UVC / UAC strings.
- **Events (D):** EV_USB_CONNECTED 8 / DISCONNECTED 9, EV_USB_RXDETECT 363 (code `0x040d00d2`), the USB select GUI;
  the power source and PD come from the SCPU (`usbSupplyType`, `POWERSOURCE_USBTYPEC`). Who posts EV_USB_CONNECTED,
  and the VBUS source (ADC flag `0xbf`, I), are ?.
- **Size of the data path:** mostly PTP (TPC, about 52.6k) and PictBridge with its XML parser (about 89k in parts), not
  mass storage. PTP is also used by Wi-Fi station mode: the Wi-Fi API calls `tpc_station_mode_get_param` (D), the
  hand-off from PTP-IP is ? (I: a shared PTP layer).
- **Seams:** the event level first (connect, disconnect, the select screen, charging state), then a class level (the
  PC_USB queue with a host-side PTP / MTP client), and only later the DWC3 device model with the SD-USB link for MSC.

### 4.11 Wireless

- **Three layers:** CPU 0 is a thin client (SSID and BLE name from the serial at `0x50a6c371` / `0x50a6c459`, state in
  CapWif_WifiRemoteTake, commands to CPU 1's Wi-Fi manager over cpu_conn, the CPU 0 tasks WIFI_REMOCON_THROUGH and
  TPC / PTPCOM). CPU 1 runs the comms application: 26 tasks in segment 9 (`0x517d3fe0..0x5196d7e0`), among them
  WIFI_MNGR 0x1005, the OI.Share HTTP CGI handlers, the BLE handlers 0x101d / 0x101f, PTP-IP 0x1019..0x101b, the
  movie-stream senders and FILEISCAM; none touches a radio. The Cortex-A53 runs Linux 4.14.222 (Buildroot 2021.02) with
  a Cypress / Infineon CYW43455 on SDIO and its Bluetooth half under Broadcom's BSA stack; lighttpd, hostapd, dhcpcd,
  dnsmasq, miniupnpd, mDNS and small `isc_*` daemons are the far end of every CPU 1 network task (D, the A53 squashfs
  at body `0x2f10fe0`).
- **The protocol surface (D):** `get_commandlist.cgi` returns the XML at body `0x18f9448` listing every CGI with its
  parameters (connect mode, camera mode, image list, thumbnails, EXIF, erase, remote release, live view, properties,
  time, GPS, movie stream, firmware update, MySet backup, camera log).
- **ISC (D):** node ids 0..3 are the MN cores, 4 the A53 (I); ports 0..47; per-port owners: 1 / 2 remote live view,
  3 / 4 BSD socket API, 5 / 6 / 8 FILEISCAM, 11..16 HTTPD CGI relay, 19 / 20 Wi-Fi requests, 21 Wi-Fi events, 24 UPnP,
  25 mDNS, 26 SYS_CA53_PWR_MNG, 27 the A53 start completion, 28 / 29 BLE, 30 / 31 IMGPRO_HHHR (not wireless), 47 / 49
  shell tests. The ring layout in the control blocks `0xa3251704 + 0xea8 * node` is ?.
- **Others (D):** Bluetooth classic is dead code (BTSTK, BTTIM, BTEVU, BTAPL, BT_CTRL, BTIAP, OBEX, OBEX_ACP are
  one-instruction stubs at `0x510175d7..0x510175ec`); FlashAir / iSDIO (SPC_MAIN, SPC_TIMER, 3.8k) and ICTLOG belong
  here; location comes from the phone (HTTP and BLE), the OM-1 has no GPS receiver of its own.
- **Seam:** the ISC node-4 port boundary: a JS "A53 service" answers CPU 1's ISC messages as the Linux daemons would,
  either by intercepting the ISC dispatcher `0x50aa4c98` (cheaper) or as the mailbox device (bank `+0x800/+0x804/+0x880
  /+0x888`, IRQ 323; needs the ring layout). The A53 start (`0x5003bd93`) needs the ISC init on all four cores, the
  power / reset registers as plain storage and a reply on port 27 (content ?).
- **Breakdown (I, after a CPU 1 core exists):** ISC protocol decode 1-2 weeks; mailbox or intercept plus the A53 boot
  handshake 1 week; the JS service for HTTP and remote shooting 2-3 weeks; RTP live view and movie stream 1-2 weeks; BLE
  1-2 weeks.
- **First step:** decode the ISC message formats per port from both ends without running anything: extract the A53
  squashfs, disassemble `isc_cgi`, `isc_socket`, `isc_olnet`, `isc_file`, `blebridge` and `iscdrv.ko`, and pair each
  with its CPU 1 call site. This also yields the ring layout.

### 4.12 Detection, GPU / C3D, strobe

- **Detection (D):** MDET_PDT_CPU3 / MDET_TRC_CPU3, FACE_MAIN / FACE_FD on CPU 3, FACE_BEAUTY on CPU 1, SDET on CPU 2,
  MDET_CALC_FLAME_VECTOR on CPU 0; devices `0x9be00000` (PDT / TRC), `0x99600000`, `0x99a00000`; IRQs 278 / 279 / 286 /
  287 attached on CPU 3 only (cores spec §1). A CPU 3 workload of its own size (about 127k with the SDET and FACE units
  filed under capture and movie); it feeds AF tracking and DISP_FRAME.
- **GPU and C3D (D):** one stack seen from both ends: C3D (gap@0x5101aef5) makes 108 call edges into the DMP "K3000"
  GPU driver core (gap@0x51767cd6), plus a 15.6k GPU tail of gap@0x51740e22. Tasks: C3D_EXE_BRIDGE and C3D on CPU 0,
  C3D_EXE and C3D_UPDATE on CPU 1. Devices `0x9bc80000` (30 references) and `0x9bd00000` (10) are referenced only from
  C3D; the GPU driver has no MMIO constant, so its base is computed or in a table (I). Callers: DISPLAY `0x501c2c74` and
  `api_play.c`. Which user feature drives it is ?.
- **Strobe (X, D):** 562 instructions run natively: the charge request `0x501af586`, `stb_external.c` `0x501ba32f` /
  `0x501ba47b`, the light exec `0x501c243b`, the register driver `0x501b3883`. Tasks STB_CHARGE 0x23 `0x501af7eb`,
  STB_EXTERNAL 0x65, STB_SEQ 0x66, STB_HANDLER_PROC 0x8b; `cam_strobe.c`, `stb_ext_microphone.c` (an accessory
  microphone through the hot-shoe code, I). The device `0x9b800000` has 71 references in the strobe code gap@0x501b385b;
  its role is ? (section 10). It is the uncovered block a user reaches in normal shooting.

## 5. Cross-cutting prerequisites

| Prerequisite | Blocks that need it | State today | Evidence |
|---|---|---|---|
| Interrupt acceptance at any instruction boundary, native delivery (F03, F27) | every device seam: HDMI (IRQ 239), SD (225-232), lens (14, 60), sensor (15-42, 243-247), SCPU (320, 321), ISC (323) | idle point only (H-IRQGATE) | ROADMAP phase 3; X: accepting anywhere moved 21 of 30 acceptances with identical output |
| A machine-owned time model, time mode by default (F06, F26) | sensor VD cadence, LENS_SYNC up to 240 fps, the lens command times, the SCPU clock, the accelerometer sampler, SD and DDC timeouts, cross-core timed waits | opt-in time mode; ticks lost inside display steps | ROADMAP phase 4, M9 follow-ups |
| More CPUs (per-core state, `0x8000` page, INTC banks, kicks, ticks) | live view, capture, movie, audio, AF, detection, wireless, histogram | CPU 0 only | 4.6 |
| Task starts and module inits from the boot chain (USTART2..5; init chains such as `0x503dae30`, `0x501ea63c..0x501ea78f`, EYEFI's) | every block | entries refused by the kernel lab's guard; inits skipped | every block's footprint (section 4) |
| TAKE and the HLS transactions (the shooting component's answers to TRA 990 / 991, the capabilities' observer events, TakeReady) | capture, AF, movie, live view, shutter, remote release | S-RELSEQ, S-TRAACK | shutter spec items 14, 16, 20, 43; 4.1.1-4.1.3 |
| Shared peripheral transports: PER_SIO `0x5005f25f` (25 callers: touch, eye, accelerometer, power IC, audio channel 14, BC `0x5005f49f`), IIC `0x5004ca40`, the pin / GPIO block `0x9b88xxxx` (lens edge IRQ 60, SD pins, touch, audio, the A53 UART probe), the clock-gate helper `0x50061c3a` (lens clocks 5 / 17, mechanism clocks 105 / 106) and the `0x9b5008xx` gates, PER_ADCONV | SCPU and sensors, lens, IS, audio, touch, shutter, sensor, USB (VBUS) | S-TPREG, S-IICWAIT, S-GPIO-TP per call site; the I2C map init `0x5005f0b2` not run | 4.4, 4.7, section 7 |
| A flash read model (NAND `0x98d01800`, IRQ 237) | CPU 2's overlay loader, CPU 3's AJ and MLS jobs, the store load, store F | S-NVRAM at the write call; no read model | 4.6, 4.7 |
| A probe mode for stub space: every access logged in order, reads 0, nothing kept, opt-in for reverse-engineering runs only | the first steps of the sensor, AF, storage and capture blocks | absent (the stub tables deny) | 4.2, 4.3, 4.4, 4.8 |
| One scene model for every data plane (YC for live view, Bayer for DRAM capture, AE / AWB / AF statistics, audio level) | sensor, capture, AF, movie | S-SCENE renders YC only | 4.2 seam D, 4.3 C1 |
| Cache and DMA coherence as a named assumption (FIDELITY 4.1) | SD sector buffers, ISC `dcache_clean_inv`, K-CFLUSH, cross-core rings | K-CFLUSH returns at once | 4.6, 4.8 |

Probes shift interrupt timing until phase 3 lands: observe hooks on `0x5002c151` / `0x5002e39d` made an S1 stop on an
unserviced bank-2 doorbell set from `0x5002d6be`, and without the hooks it does not (X; the cause is I, FIDELITY 2.2).

## 6. Recommended order

The order follows what each step unblocks: the keystones first, because each later block names them as its blocker.
[ROADMAP.md](ROADMAP.md) "HLE of E143" carries each step's status.

1. **Static decodes that every first step needs** (no emu change; days each; nothing waits on them):
   - the TRA layer: who handles TRA 991 and what answers TRA 990 (shutter spec item 43);
   - TAKE_FUNC's dispatcher `0x502cd1ca` (commands 13 / 18 at the start, movie 30 / 31 / 68 / 69);
   - the HLS TRA event dispatchers in gap@0x50c5c4ac;
   - the PER_SCPU dispatch `0x5004fe2e` (who calls a request's `+20`);
   - the sdmem request / completion contract `0x508b1cdc`;
   - the lens serial layer and parsers `0x502c0e79..`, `0x50122cac..`;
   - the ISC port formats from the A53 squashfs.
2. **Cheap CPU 0 wins with no keystone dependency:** the SCPU request server with a ticking clock and S-NVRAM as the
   default (4-6 days); the SCPU port registers and IRQ 320 for group-0 keys and the power lever (3-5 days); the
   accelerometer (Level Adjust); HDMI EDID / HPD (about 1 week, the first test case for step 3's interrupts). They
   retire named stand-ins and fix visible defects: the frozen clock, lost settings, a GUI hang, the abandoned HDMI open.
3. **Interrupt acceptance anywhere, then the machine-owned time model** (ROADMAP architecture phases 3 and 4). Every
   device seam completes by interrupt -> flag while a task waits (SD, DDC, lens, SSG / VD, SCPU channels, ISC), and the
   VD frame clock, the lens command times, the SCPU clock and the SD / DDC timeouts need time that devices own. Doing
   this before any IRQ-driven device model avoids building each device against H-IRQGATE.
4. **Multi-core: CPU 2 first, then CPU 3, then CPU 1.** CPU 2 is named by the live view (MVR_IMG), still capture
   (REC_*_CPU2, STLNML), movie (MVR, EXP_MOVIE2/3), audio (AUD_LEVEL_MONITOR, AUD_WAKEUP) and the histogram
   (OSD_DRAW_CPU2). CPU 3 is short at first (DISP_FRAME, its boot jobs including the settings-store load) and grows
   with detection (about 127k), on which AF tracking and DISP_FRAME depend. CPU 1 is the heaviest: the AV back end, the
   GPU driver, about 100k of FCS and the 72k wireless application, each also needing devices nobody models, which is
   why it comes last. A native core retires the per-service CPU 2 models the block estimates budget separately: sensor
   seam A, capture C5 and movie stage B shrink to their device parts.
5. **Task-start and module-init infrastructure:** let selected USTART steps and module inits run with recording stubs,
   one block at a time, so each block's first native run shows its first device access; with it, the HLS component
   bring-up (`control camapp 2`) as the default of the coverage workload, so the HLS half of TAKE (196k, 1.3% run) is
   measured before TAKE is attempted.
6. **Storage at the sdmem seam.** It needs steps 3 and 5 but not TAKE, and gives a real card, counts and Card
   Formatting. Capture, movie, playback, USB and wireless all write or read through it.
7. **TAKE native with its neighbours:** the lens at its serial seam (or LENS_EXEC answered) and BC_EXEC answered; the
   sensor control plane far enough for TAKE's through start (TAKE_FUNC command 25); the shutter at its control plane,
   with the strobe (shutter-sized, partly native) planned beside it. This is the step that makes S1 / S2 / REC reach the
   modules, and it retires S-RELSEQ.
8. **Then, by gain:** still capture C1-C3 (a real picture); live-view statistics, seam B (it also lets the 107k EXP
   module run); AF at TAKE_FOCUS / FCS_EXEC; movie (a host AVM writing a MOV) and audio; playback of real files (with
   S-PLAY* kept; native playback is a block of its own); USB events, then the USB data path (PTP and PictBridge more
   than MSC); the power manager; wireless after CPU 1; GPU / C3D once its feature is known; the other uncovered blocks.

What unblocks most: TAKE native is named as a blocker by capture, AF, movie and the live view; CPU 2 by the live view,
capture, movie, audio and the histogram; interrupts anywhere and time by every device seam; storage by capture, movie,
playback, USB and wireless.

Size caveats: the estimates hold at the recommended seams. TAKE (301k with the HLS sequence), AF / IS (505k), movie
with the AV back end (535k), playback (613k) and CPU 1 (about 0.4-0.7M instructions a native core would start
running) are all far larger on the native path, mostly behind devices nobody models (codec, GPU, imgpro units, PDT /
TRC).

## 7. The shutter across bodies

Shutter type and speed limits across the 13 ported or surveyed bodies, and E143's mechanism block. **P** marks a fact
from the bodies' published specifications, not checked in the firmware.

### 7.1 Speed tiers

One constant splits the bodies as the spec sheets do: a Tv clamp in the TAKE_EXPOSE code (APEX x 256). That it is the
mechanical limit is I, from the match with P on all 13 bodies.

| Body | P mechanical / electronic | Tv clamp (D) | Clamp site | Base constant |
|---|---|---|---|---|
| E143 OM-1, E146 OM-1 II, E147 OM-3 | 1/8000 / 1/32000 | `0x0d00` (Tv 13) | `0x50582727`, `0x50561dfe`, `0x50572099` | 1193 |
| E144 OM-5, E139 E-M1 III, E134 E-M1X, E125 E-M1 II, E137 E-M5 III | 1/8000 / 1/32000 | `0x0d00` | `0x5042e422`, `0x5042bd95`, `0x5044179d`, `0x5042fc08`, `0x50414467` | 1116 |
| E142 E-P7, E140 E-M10 IV, E130 E-M10 III, E133 E-PL9 | 1/4000 / 1/16000 | `0x0c00` (Tv 12) | `0x503f51a6`, `0x5040177e`; E130 `0x50404e62` and E133 `0x503f9903` placed by `xto` | 1280 |
| E145 TG-7 | 1/2000 (lens shutter) / ? | `0x0b00` (Tv 11) | `0x503f7bd9` (`xto`) | 1280 |

E143's clamp function `0x505826fb..0x505827b5` (one caller, `0x50582815`) computes `base + d3 - d1 - (0x62abc568)` and
clamps it to [`0x100`, `0x0d00`], clamps a second value the same way, and logs errlog `0x0e000015` (D). Which exposure
path it serves and why the base differs per body is ?. Not tier-separating (D): the GUI strings ("1/8000" ..
"1/64000" on every body); setting 1669's allowed lists (E143 `0x606169d8` ends at `0x0f00` = 1/32000, the 1/4000
bodies carry the same, E130 and E133 have extra lists ending at `0x0e00`); cam_expcal's Tv table (lookup `0x5016eaf2`,
table `0x6023d424`) ends at `0x0e00` on the OM-1 line and `0x0c00` on every other body, 1/8000 bodies included (meaning
?); E143 `0x5057d260` sets Tv 15 or 12 from a mode word (E143 and E146 only, meaning ?). No electronic-limit constant
per model was found (P only). No run-time unit identification was found (no ID read, no unit-type branch): the limit
is compiled per firmware (I). The units differ physically (P); in the firmware only by the Tv limit and possibly the
adjustment data (layout ?).

### 7.2 E143's mechanism block at `0x9b900000`

The OM-1 line (E143, E146, E147) is a generation change, not a tier change: a revised block with 271 registers and 408
references, identical on the three, three IRQs instead of one, and new sub-blocks SHQ, DCM, PICNT0/1 (D). The driver is
gap@0x50108fe0 (19.6k instructions, 404 references to the block) plus `cam_mec_ctrl`; none of it runs in the lab.

- **Clocks (D):** open `0x5010b937` (ref count `0x6296572c`): `0x50061c3a(0, 5, 1)`, `+0x000` = 0 (reset), clocks 105
  and 106 on, `+0x004` = 0; close `0x5010ba1e` reverses it (`+0x004` = `0x1ffff`, `+0x000` = 1). That 105 / 106 are
  CLKMECHA / CLKMECPWM (names in the clock dump) is I.
- **Interrupts (D):** `0x5010b901..0x5010b92d` attaches IRQs 11, 12, 13 (level 1), handlers `0x5010ba84`, `0x5010bd3b`,
  `0x5010bef1`; status `+0x008 / +0x00c / +0x010` (W1C), enable `+0x014 / +0x018 / +0x01c`; each status bit calls a
  registered callback (table `0x62965730..0x629658dc`, about 20 bits on IRQ 11). Motor start
  (`0x5010d498..0x5010d4f9`) clears and enables IRQ 11 bits `0x3818 / 0x3800` and sets DCM_EN; motor stop clears DCM_EN
  and PICNT1_EN and writes `0x110000` to `+0x1d8`. The motor and its position counters report on IRQ 11 (I).

| Offsets | Registers / references | Role |
|---|---|---|
| `0x000-0x02c` | 12 / 54 | common: reset, interrupt mask, status / enable; `0x020-0x028` twelve packed 5-bit fields (routing ?) |
| `0x040-0x0a4` | 26 / 31 | ? |
| `0x0c0-0x188` | 51 / 55 | DCM_EN = `0x0c0` (named by shell code `0x519d9167`, D); DC motor control, `0x0c4-0x168` a drive profile (I) |
| `0x1c0-0x208` | 19 / 41 | PICNT0_EN = `0x1c8`, PICNT1_EN = `0x1e0` (D); photo-interrupter pulse counters (I) |
| `0x240-0x270` | 11 / 15 | `0x258` a capture value read by the IRQ 11 handler on status bit 9 (D) |
| `0x2c0-0x310` | 17 / 24 | three channels of `0x1c`; magnets ? |
| `0x340-0x38c` | 20 / 22 | SHQ_EN = `0x340` (D); a sequencer queue (I) |
| `0x3c0-0x514` | 58 / 106 | four channels of `0x50`; PWM (I) |
| `0x540-0x634` | 57 / 60 | lsnc channels 1 / 2: polarity bits, 3 x 24-bit start counts, 12 x 24-bit repeat counts (writer `0x5010db22`, D); a VD / HD-synchronised pulse unit (I) |

- **Sequence objects (D):** 45 names at `0x6020dbb4`, identical on E143 / E146 / E147: SEQ_READY_A-D,
  MOTOR_OPEN_CHARGE_A-D, MOTOR_CLOSE_CHARGE_A-F, MOTOR_PWM_A, SHUTTER_MOTOR_ON / OFF / CLOSE_CHARGE_A, MAGNET_BOUND,
  MAGNET_DARK_BOUND, SHUTTER_MAGNET_* (ON, MG3_CHANGE, DARK_SET, START), SEQUENCE_NORMAL_SET_A/B, SEQ_EXPOSE_A-C,
  SEQ_CHARGE_A-E, SHUTTER_MOTOR_MAGNET, INITIAL_INIT_TYPE_COMMON_SEQ, INITIAL_INIT_TYPE2_A, SEQUENCE_READY_A-C,
  INITIAL_SHUTTER_READY, SEQ_POWER_ON / OFF; resources MOT_COM, MAG_COM, PCT_COM, EV_SEM, TM_SEM, TP_SEM, TZ_SEM. Shell
  hook names (motor_post, sensor_1_pre, sensor_2_pre, bound_end_pre, ready_expose_pre, aeaf_pre, shutter_post) and
  states (stb_sy, 2nd_st, shield, standby, mgon hold, mgon shield) suggest a charge motor, two position sensors, curtain
  bounce end, magnet hold and release (I).
- **The `mec` debug shell (D; strings `0x61a4d464..0x61a4dfd3`, code from `0x519d7300`):**

| Command | Arguments / output |
|---|---|
| `mec info` | Shutter Client, Damage Info (NORMAL / ERROR / DISABLE / DATA BROKEN); sections MEC SHUTTER / PCNT / EVENT / SEM / LOG; registers SHQ_EN, DCM_EN, PICNT0_EN, PICNT1_EN |
| `mec motor` | open, close, on, off, ready, openchg, closechg, initial, init_on, init_off |
| `mec shutter` | set [us] [0: Normal, 1: Dark]; darkset; set_efs; on; start [type] [Not Run Curtain] [ms]; stop; 1strun; 2ndrun; prmout; nop_cont; ncl_cont |
| `mec still` | [num] [expose_time us] |
| `mec lsnc` | start / prm_chg / abort / reset [ch1 / ch2 / both]; prm_chk; state_chk; pls_cnt_chk |
| `mec prmout` | MEC_CONTROL_PRM: MS_SHTCHGTIMER[0..1]; [sht_type] 0: EFS, 1: MECHA; [release_type] 0: HS, 1: NORMAL; [drive_continue_mode] 0: NORMAL, 1: HIGH |
| others | dbglog, mem, test, error, init, dmgclear, dmgset, adj, mirror, mecha |

- **Calibration:** factory-adjust strings in the image-quality QC code (`0x619626a8..`, D): UnitCodeBody,
  `_Normal` / `_EFS`, "AveNormal:%.4f AveEFS:%.4f DeltaEFS:%d", TMP_EFSADJ: an exposure-difference calibration between
  the electronic and the mechanical first curtain (I), with the same strings on every body. Kernel objects MEC_ADJUST
  and ADJ_MECA; the record layout is ?. No curtain-travel table was found. LIFE_TEST_MODE_DURABLE_SHUTTER = 230 is a
  durability test mode.

### 7.3 Curtain selection: EFS and MECHA

The shutter type is a mec-layer parameter on every body: `[sht_type] 0:EFS, 1:MECHA`, `Type(0->NML 1->Dark 2->EFS)`
(D). In the "Still Continue L" capture test (E143 `0x519e0716..0x519e0933`, D) flag bits `0x400` / `0x800` set each
curtain: first curtain `1ST=EFS` (code `0x20`) or `1ST=MECHA` (1), second `2ND=MECHA` (1) or `2ND=EFS` (`0x20`). So the
mechanical shutter is MECHA / MECHA, EFCS is EFS / MECHA and the full electronic shutter is EFS / EFS (I). The
electronic curtains are the sensor's reset and readout scan (SSG timing, 4.2); the lsnc VD / HD channels likely align
the mechanical curtain with the sensor scan (I). No mechanism register tied to full-electronic exposure was found.

### 7.4 The older block at `0x9ba00000`, both tiers

Every non-OM-1 body drives the shutter through `0x9ba00000`: 194 registers and 358 references on E144, E139, E134,
E125, E137, E142, E140, E133 (E130 the same plus one stray reference outside the driver) (D). The 334 ordered accesses
are identical on E144, E125 (1/8000) and E140, E130 (1/4000); E144 and E140 differ only in stack and register
allocation (D). So within a SoC generation the 1/8000 and 1/4000 bodies share the block, the driver and the interrupt:
no second driver, no serial link to a shutter IC, no model branch in that layer. One IRQ 2, level 1 (E144 attach
`0x500d07cd`, handler `0x500d0916`; E140 `0x500bdd99` / `0x500bdee2`); status `+0x00c` with about 20 callback bits; the
close path writes 1023 (a 10-bit mask) against E143's 17 bits (D). The old block's 57-register unit at `+0x254` is
programmed by the same code as E143's `+0x540` lsnc (same structure offsets and masks; E144 `0x500d1cc4`) (D). The TG-7
(E145) uses a 145-register subset, has no MOT_COM or MAGNET objects and has a lens_shutter module: its lens shutter runs
on the same IP (I).

Above the driver, the variation follows firmware generation, not tier (D): SHUTTER_MAGNET_MG3_CHANGE on E144, E139,
E134, E125, E137, E142, E140 (not E130, E133); about 16 HS-release / HS-continuous objects on E125 only; PCT_COM missing
on E142 and E140 only; shell words MS_AEAFEN, MS_BREAKWAIT, MS_CHG_MG_WAIT, MS_READY_PI_TYP, MS_CHARGE_PI_TYP on E134,
E125, E137, E130, E133, mg3chg on E134, E125, E130, E133, fready / nready / hopenchg on E125, E130, E133. Each group
mixes both tiers (I).

### 7.5 For the HLE, and open questions

The block is small in code (20.9k instructions) and large in behaviour and timing. No seam, size or first step was
proposed for it; seam D (control plane plus an event producer for the motor, counters and magnets) is an inference from
its register shape. Open:

1. Which exposure path the Tv clamp at `0x505826fb` belongs to; why the base is 1193 / 1116 / 1280.
2. Where the electronic-shutter maximum lives per body.
3. E143's sub-blocks `0x040`, `0x240`, `0x2c0` (three channels: magnets?), `0x3c0` (four channels: PWM?), the routing
   fields `0x020..0x028`; the older block's sub-blocks.
4. Whether E143's DC-motor block replaces or extends the older motor drive.
5. The MEC_ADJUST record layout and whether it holds curtain timing.

## 8. Hardware evidence and what it unblocks

None of these needs flashing.

| Evidence | Unblocks |
|---|---|
| A console log of the camera's debug UART (`0x98700018`, "AM shell = SIODBG"), if the board exposes it (?) | the highest-leverage single item: the per-core boot order (4.6); `per scpu trace / gettx / getst / ver` give every SCPU command and reply size (4.7); `cam rapinput` and the cam_debug register and KEEP dumps (4.2); `mec info / prmout` (section 7); `isc`, `sys_callrequest_info` (4.6, 4.11) |
| The A53 console on ARM_UART1 (`0x9a500600`, 115200) | wireless: daemon order, ISC errors, the A53 power policy |
| An HDMI clean-out capture on v1.9 with defaults reset, into a sink with a known EDID | live-view geometry, colour and cadence (sensor seam A), A15, the HDMI mode choice, the HDMI overlay layout |
| JPEG and ORF files, a .MOV, and an image of a card formatted in the camera | capture (EXIF, maker note, thumbnails, ORF compression), movie (atoms, tmcd, audio), storage (FAT or exFAT, label, AU alignment, DCF folder name) |
| A logic-analyser capture of the lens mount contacts (the serial link plus the IRQ 60 edge lines) | the lens seam: wire protocol, real lens data (ID, FuncFlag, MAG_CNG) |
| A capture of the IS unit's serial link | IS beyond BC_EXEC |
| Board photos (IMU, eye sensor, PMIC, sound IC) | the accelerometer register map, the eye sensor, the power manager, the sound IC |
| Battery AD readings against the battery indicator | the power manager's scales |
| USB descriptors and usbmon captures (MSC, MTP, PTP) | the USB data path |
| A Wi-Fi capture of an OM Image Share session; a BLE capture | the JS A53 service; BLE GATT |
| Timing: VD period per mode, shot-to-card, S2 to rec view, key latencies | the time model; completion times at the capture and storage seams |
| Photos or video of the rear screen: rec view, AF frames in S-AF / C-AF / tracking, the recording screen with audio meters, Connection Setup | checks for the capture, AF, movie and wireless displays |
| A dump of store F (flash `0x400a0000`, 128 KiB) | per-unit adjustment values, for a full boot |

## 9. Facts settled between the surveys

Corrections to earlier readings, each now owned here or by the document named.

1. **`0x99990000` is not MMIO** (D): 214 of its 215 operands are `0x9999999a`, the low word of a double (at
   `0x50128f0f`: d0:d1 = 0.2 passed to a soft-float routine); the remaining hit at `0x5188337a` is not a load or store.
   The IS state lives in the lens record and the BC module. Applied to the shutter spec §2.4, §2.5, §4.
2. **The 12 operands of `0x9b883000`** (`0x9b883e40..0x9b883e6c`) are the IRQ-60 edge unit the lens sync layer
   configures, not LENS_COMMAND; **the lens serial device is `0x9b980000`** (IRQ 14); **`0x9bf00000`** has 24 operands
   in FCS plus `0x5002563b` and `0x502c0e99/9f`, and its own IRQ 281. Applied to the shutter spec §2.4, §2.5.
3. **The histogram's cross-core send runs** (X): the synchronous send to queue `0x2013` (OSD_DRAW_CPU2 on CPU 2),
   command 1, logged from `0x51014a64`, follows each TRA 944 (getHistogramData) at idle, S1 and S2. S-MODACK answers
   every synchronous send whose receiver does not run with E_OK before cpu_conn is reached (D), so "no inter-core
   traffic at S1 / S2" was an artefact: the histogram is a CPU 2 consumer that is silently answered, by a blanket rule
   rather than a listed site. Applied to the shutter spec item 42.
4. **The settings mirrors' boot load runs on CPU 3, not CPU 1** (D): `0x5000941f` lies inside BOOT_CPU3's body (4.6).
5. **`0x9a000000` is not MMIO** (D): its 577 "references" are AVFW return codes `0x9a00CCNN`, e.g. `0x51672e7f` `mov
   0x9a000103,d0; bra` right after a log call in CAvfwComponent.cpp; top values `0x9a000101` (152), `0x9a000103` (69),
   `0x9a000108` (42). `0x9bf1000x` and `0x9c01000e` are probably codes of the same kind (I, not checked).
6. **`0x9c700000` needs no model** (D): all of its 674 references are LLF bus-arbiter and DRAM bus-measurement debug
   code in gap@0x50026fe0.
7. **Data decoded as code** (I from string overlaps, D for the sites): about 58k instructions (1.1% of the map), all
   unexecuted, among them `0x51a1b365` (16.6k, running into ASCII at `0x51a1e000`) and `0x50019198..0x5001a462` (about
   4.0k). Not firmware code; it leaves every coverage denominator.
8. **DISP_SYNC** (D): the 989 references of `0x9c180000` in `0x507f6000..0x507f9000` are 983 data words of a table at
   `0x507f6b0e..0x507f906b`; code has 18 operand references, all in gap@0x507f66d5. DISP_SYNC partly runs (X: 682
   instructions).
9. **The accelerometer bus is SPI over PER_SIO** (D strings `[PER_ACC_SPI] per_sio_open_error`, ACC_SPI); the same unit
   holds PER_ACC_PWRMGR_MAIN.
10. **IRQ 40 / `0x9b500000` and IRQ 24 / `0x9b180000`** were each attributed to two blocks; both pairs point at the
    same function (D): IRQ 40 in gap@0x501624b5 between cam_contrast.c and cam_cpm.c, IRQ 24 in gap@0x501904d8. The
    block names stay I.
11. **`0x9c080000`, `0x9c580000`, `0x9c680000`** (D): 13 / 15, 17 / 20 and 19 / 21 of their references sit in three
    identically shaped drivers at `0x5046d0a4..0x5046d78c` inside the WB_MOV (CPU 2) piece gap@0x5046a4e6, the rest in
    the imgpro API. The same register layout drives `0x99900000`, `0x9c600000`, `0x9bf80000`, `0x9c400000`,
    `0x9c500000`, `0x9c480000`, so one generic model may cover about nine regions (I).
12. **The SD host bases are `0x99000000` / `0x9a300000`** (D, the getter `0x5002539c` and table `0x6004773c`), the SD
    core at `+0x2000`.
13. **The ISC receive interrupt is IRQ 323** (D, 4.6). The lock helper at `0x50aa31d6`, which cores spec §6.1 counts
    as "audio code", is the ISC library's own lock (I, from the wrappers' calls).
14. **The A53 is powered on request** (D strings): SYS_CA53_PWR_MNG; which requests trigger it is ?.
15. **The USB controller's identity is D**: register-dump strings at `0x51026af8` name DWC3 registers at `0x9a600000`.
16. **HDMI is HDMI plus DisplayPort** (D, 4.9).
17. **Tasks no survey claimed** (D from task entries and strings): SERV_MAIN is AF / TAKE (I); SPC_MAIN / SPC_TIMER are
    FlashAir / iSDIO (wireless); BAS_MAIN / BAS_RCU_SRV are test code; SAICAS / DPS_MAIN are PictBridge; ALBM_MAIN is
    a movie-clip album manager (playback); C3D is a GPU path; ADJ / ADJSLF are factory code; HPROC_PROC,
    AUTOMATIC_DIMMER, STK_MONI_MAIN and PROCLOG sit in the SCPU, boot, kernel and debug areas; ICTLOG is wireless.
18. **`0x5039f8df` is not TAKE's through start** (D, 4.1.2): it lies in TAKE_FUNC's debug dump `0x5039f7f5`, which
    prints the context byte through_start `0x62a3f2b8` and its neighbours. TAKE's through start is TAKE_FUNC command 25
    (`0x506d7f55`); commands 27 / 28 pause and restart the through image. Applied to 4.2 and section 6.
19. **No module registers transaction handlers** (D, 4.1.2): the request classes of TRA 485 and 486 are never built, so
    the transaction dispatcher's local list stays empty; TRA 990 and 991 are answered by the shooting component. The
    release notifications of shutter spec item 20 are built by the HLS sequence parts, not by modules (4.1.3). Applied
    to the shutter spec items 14, 16, 20 and 43.

## 10. Open questions

The block-level unknowns are in section 4 and the shutter's in 7.5. Across blocks:

1. How a module's replies and callbacks reach the capabilities' observers (the HLS executor's token routing, 4.1.3),
   and why TRA 990 went unanswered in shutter spec item 43's native run although the shooting component answers it
   (4.1.2). Who handles TRA 991 and what answers TRA 990 is settled (section 9 item 19).
2. The DCF folder name: the capture code's strings name `100OLYMP` (body `0x6035ce`), the DCF layer's own strings
   (`0x9ed..0x9f8`) use `100OMSYS`; both exist (D, body `0x6035c5` / `0x6035ce` / `0x6035e9` and `0x9ef1c0` /
   `0x9f3226` / `0x9f8668`). Which one a camera writes stays open until a native REC_FILE run or a camera's card shows
   it.
3. The A53 path for Handheld High Res: the A53 also runs `hhhr` for IMGPRO_HHHR (ISC ports 30 / 31 at `0x50484f58`),
   so "A53 off" would leave that path unanswered (I from the names); whether the firmware powers the A53 for it by
   itself is ?.
4. CPU 1 task 0x105a (`0x5175b108`): cores spec §4 names it AVM_MP4; the module map files it with the GPU stack
   unnamed. Which is right is ?.
5. `0x9b800000`, referenced by the strobe code: one reading names it the built-in flash controller (I from
   STB_REG_FLS_FLASH1 / WC), but the OM-1 has no built-in flash (it ships with a clip-on unit); shared code for other
   bodies or the hot-shoe / clip-on interface (?).
6. The imgpro core `0x504ae692..0x5050a282` (161.8k): what each function computes, the CMIO blob's content, and which
   of the nine imgpro-family regions are DMA, resize or statistics engines.
7. The TS multiplexer's use, StlCA's still format, the user feature behind the GPU, why the SsMenuMain wizard states
   (11.2k) are never reached, and the normal-use role of `mcon_mode_setting_backup.c`.
8. Which core services each shared interrupt (282-283, 288-302, 307-309, 53 / 54, 323-326): the enable calls
   `0x50054012` / `0x5002ea93` decide it and are not scanned (static, no hardware needed).
