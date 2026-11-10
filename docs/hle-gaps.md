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
  S-TRAACK, S-CARD, S-SCENE, S-EXPOSE, S-LENS, S-CPU2, S-SCPUDEV, H-POWER and others) or is not modelled at all. None
  of their tasks runs in a lab (X: a full S1 + S2 and a REC post no module request; the kernel lab's task-start guard
  refuses their entries, `emu/src/lab/kernel.mjs`), and their MMIO is lab-stub space that faults on first touch. The
  exception is the lens on E143, E146 and E147, by default since 2026-10-29: its tasks, driver and serial driver run
  natively against a device model (4.4.2, 4.4.3).
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
| OSD engine, VSC, display flow | N to the device models (M2, M3, M7, M8) | `0x9BC00000`, `0x9BB80000`; A15 opt-in | 99,890 (26.78%) | DISP_SYNC `0x9c180000` (S-DISPSYNC), the CMM image, the GUI's planes on HDMI channel 0 (4.9; the channel itself runs and composes on E143), A5 / A7 / A15 need hardware |
| Text and resources | N (M4) | S-RES, Genifa | 28,861 (9.09%) | U items (text spec) |
| GUI and menu | N (M5, M6, M10B) | S-SEND, S-PROP | 621,898 (19.31%) | navigation rules observed, not decoded; the 53 screen classes of gap@0x510ef2bf (35k) are unnamed (?) |
| Inputs | N from UI_IN up (M10); group 0 from IRQ 320 up (4.7.2) | S-KEYBITS (groups 1..3), H-EYESTATE, S-TPINT, S-TPREG, H-DIALSTEP | 43,895 (20.85%) | the raw-bit producers (4.7) |
| Settings store | N: the property store `0x503c4974..0x503db10c` and the LowAPI property unit gap@0x503edeea | S-SCPUDEV, S-SETSAVE / S-FLASHSAVE or S-NVRAM; H-STOREINIT runs the store's module init (since 2026-10-30) | 50,515 (31.24%) | persistence by default (4.7) |
| Camera application (CA_MAIN, HLS) | N since 2026-10-15, in part: 99k gap-relevant instructions unrun | S-RELSEQ, S-MODACK, S-TRAACK, S-CARD below it | 320,057 (18.64%) | the HLS shooting sequence (196k, 4.1) and the playback components (310k, 4.8) are 1-2% run |

Of the application's executed instructions, at least 9,456 of 28,686 in one part of the map are C++ static
initialisers run at boot (D, X). The image buffer manager (8.5k at `0x50532df0..0x50537e85`, called from capture,
live view and playback) runs natively (X: 2,330 instructions) and has no owner block.

### 3.2 Blocks not adequately modelled

| Block | Today | HLE seam | Depends on | Code | Effort (I) | User-visible gain |
|---|---|---|---|---|---|---|
| **TAKE module and HLS shooting sequence** (4.1) | S: S-RELSEQ posts the CBS callbacks in an inferred order; S-TRAACK answers TRA 991 and the release TRAs with 0; S-MODACK acks TAKE_FUNC; S-TAKEFRAME; S-EXPOSE writes TAKE_EXPOSE's results | TAKE native, its neighbours answered at their own seams (lens, BC, sensor, shutter). Interim: TAKE as a black box at queues `0x5e` / `0x5a`, its results delivered as the capabilities' observer events (4.1.3) | the shooting component's native answers to TRA 990 / 991 (4.1.2); lens, BC_EXEC and the camera driver's requests 148 / 6 (TAKE_FUNC_CP's ready sequence, 4.1.1); CPU 2 for the movie and through commands; the sensor control plane; the shutter; task starts | 307,393 / 301,082: C TAKE about 100k, HLS sequence 196k | ?: no survey sized it; "TAKE reached, 1-2 weeks" (capture survey) leaves out the lens, BC and sensor answers it needs | the camera's own release sequence and timing in place of S-RELSEQ's guessed order; AE lock, drive modes, bracketing |
| **Shutter mechanism** (section 7) | 0: block `0x9b900000` (271 registers, IRQs 11 / 12 / 13) never touched; S-RELSEQ's START / END_EXPOSE stand in | not proposed by the survey. A register file with W1C status `+0x008..+0x010` and per-bit callbacks on IRQ 11 has the camera driver's shape, so the sensor's seam D (control plane plus event producer) fits (I) | sensor SSG timing (the EFS curtains are the sensor's reset / readout scan, I), TAKE, time model, the MEC_ADJUST layout | 20,942 / 20,942 (gap@0x50108fe0 19.6k plus cam_mec_ctrl); none run | ? | shutter sound timing (S-SHUTTERSND stands in, 7.5), black-out, EFCS / ES modes from the firmware |
| **Sensor / ISP front end, live view** (4.2) | S: S-SCENE paints bank `0x0A` and calls TH with H-REQ; S-EXPOSE per input, no LV AE; 33 camera IRQs unwired | A: MVR_IMG's TH request builders (CPU 2); B: AE / AWB statistics at the callback table `0x629a7c64`; D (target): control plane plus HLE pixel and statistics producers | CPU 2, TAKE (the through commands 25 / 27 / 28 that TRA 991 reaches, 4.1.2), IRQs anywhere and time (VD-paced), shutter, DISP_SYNC | 327,531 / 320,730, plus about 25k of MVR's live-view part | 10-16 weeks (seam D open-ended) | the camera's live-view geometry per device, frame cadence, continuous metering, AWB, AE lock, LV modes, magnify |
| **EXP exposure module** (inside the sensor block, 4.2) | S: only the plan `take_expose_calculate` `0x50597e82` runs, under S-EXPOSE and H-AEINIT | native, fed by seam B's statistics | seam B, the TAKE_EXPOSE and EXP_MOVIE tasks | about 107k (EXP 96k plus TAKE_EXPOSE 13.6k), one MMIO reference: device-free | part of seam B (3-5 weeks) | continuous metering, AE / AF BV, flicker detection, face and spot AE |
| **Still capture, image processing, recording** (4.3) | S: S-RELSEQ, S-RECVIEW, S-CARD, S-TAKEFRAME; X: S2 posts no module request | C1 DRAM capture, C2 the imgpro_mdl API, C3 CIC, C4 storage (shared with 4.8), C5 the CPU 2 halves | TAKE, the sensor (C1), CPU 2, storage, the A53 for Handheld High Res (I) | 429,869 / 421,668, of which the imgpro library about 275k behind about 10 imgpro_mdl entries | 6-9 weeks | S2 writes a real JPEG / ORF with the firmware's EXIF and DCF name; the rec view shows the firmware's view image |
| **AF and lens** (4.4) | S: S-LENS (record values I) on the other bodies and selectable on E143, where the lens runs natively down to its serial controller by default (S-LENSMCU, 4.4.2); S-RELSEQ's END_FOCUS, S-AFOSD's fixed frame; X: no request reaches FCS, BC or TAKE_EXEC | lens: the serial device `0x9b980000` (IRQ 14) and the edge unit `0x9b883e40` (IRQ 60); AF: the module seam TAKE_FOCUS `0x5d` / FCS_EXEC `0x1b` | TakeReady (TAKE), task starts and the lens inits, sensor VD for LENS_SYNC, CPU 1 (FCS_IP, flag 0x92) and CPU 3 (MDET) for native FCS, IRQs anywhere, time | 510,058 / 504,680 with IS: FCS 372k (about 100k CPU-1-only), lens about 84k | lens 2-3 weeks; AF 2-3 weeks once TakeReady runs; native FCS months | the lens identified by the firmware, zoom and MF, the firmware's AF decision and frames |
| **Body IS (BC)** (4.4) | 0: no BC, no gyro, no IS state | the module seam BC_EXEC `0x09`; BC native only with a capture of the IS link | TAKE (TAKE_FUNC sends to BC_EXEC), the IS controller's serial channel (?) | 34-42k / about 34k (inside AF / lens / IS) | about 1 week at BC_EXEC | IS mode and indicator, IS EXIF |
| **Subject detection** (4.12) | S: MDET_DL native with S-DML at single call sites since 2026-11-07, the scene's subjects and their parts as the engine's records, the frames drawn from MDET's own table (step C parts 1 to 3, several subjects and parts); the frame mode's subject bit S-TAKEFRAME's; S-SUBJECT's frames (step A) only on a body without MDET_DL | surveyed 2026-10-25 (`docs/om1-subject-spec.md`): S1 DISP_FRAME's inputs (MDET's frame table and UP_FACE), S2 MDET's results to FCS, S3 the DML engine `0x9c180000` (IRQ 285) | CPU 3, the DML, PDT / TRC and face engines, the `0x800f` model load, take_mov's YC frames, native FCS for S2 | 84,500 / 81,771 keyed; about 127k with the SDET and FACE units | S1 about 1 week; S3 4-6 weeks after CPU 3; a reproduced network months | subject and face frames, C-AF tracking |
| **Movie and audio** (4.5) | S: S-RELSEQ's movie callbacks, S-CARD's movie time, S-CPU2's zero level snapshot, S-MODACK for AUD_EXEC with `--audio off`; N with the audio hardware (`--audio auto`, the default on E143): AUD_MAIN and AUD_EXEC, the audio port's TX, IRQ 43 / 45, S-WM8946, UI_OUT and the AF beep's request from the GUI (S-AFLOCK), its sound from S-SOUNDRES's lab-made area (4.5) | S3 TAKE_FUNC commands 30 / 31 / 68 / 69, S4 the mvr IF (CPU 2), S5 AUD_LEVEL_MONITOR, S6 a host AVM writing a MOV through the firmware's DFS calls, S7 AUD_EXEC | TAKE (commands 30 / 31 / 68 / 69 wait on CPU 2's MOV_COMMAND, SDET_EXEC and WB_MOV, 4.1.1), CPU 2 (MVR, audio level), sensor, storage, EXP_MOVIE / FCS_MOVIE | 134,137 / 124,319 | 10-15 weeks (stages A-C) | a playable .MOV on the card, the firmware's recording sequence, audio meters; the AF beep plays since 2026-11-02 (the lab's sound, not the camera's) |
| **AV codec back end** (4.5) | 0 | none for HLE: seam S6 bypasses it | CPU 1; the codec engines; IRQs 303-306 | 416,471 / 411,438 (overlay segment 8, CPU 1) | ?: native needs register-level codec models, no documentation | native movie encode and playback below the HLS (I) |
| **CPUs 1-3 and inter-core** (4.6) | S: K-OTHERCPU, K-BOOTSYNC, K-IPI, no start barrier; S-CPU2 (one post), S-CPU3, S-DISPFRAME on CPU 0; any other doorbell is an error | run CPUs 1-3 natively on one bus; per-core `0x8000` page, INTC bank n to core n, `+0x808/+0x80c` IRQ 324, `+0x810/+0x814` IRQ 325, `+0x800/+0x804` ISC IRQ 323, ticks 139..141. A53: "off" or ISC node 4 | a machine refactor (per-core CPU state), a per-core kernel lab, flash reads for CPU 2's loader and CPU 3's boot jobs, ROADMAP phases 3-4 | 5,422 keyed; 441,542 reachable only from CPU 1-3 tasks (a lower bound) | 5-7 weeks for the cores | the histogram, a native DISP_FRAME, cross-core owners (AUD_MAIN, AVM) can start; three stand-ins and four kernel stand-ins retire |
| **SCPU, power, clock, on-board sensors, persistence** (4.7) | N: PER_SCPU, its start and its transactions, over the link to S-SCPUDEV, the sub-CPU's transport-level model (since 2026-10-23: `0x85`, `0x01`, `0x81`, `0x06`, `0x86`; 4.7.1; S-SIO2, H-SCPUSTART); S: the SCPU window's storage (`0x00`, `0x08..0x3c`), command word and its clock `0xe8 / 0xec` ticking with lab time; group 0 through the event and port words and IRQ 320 natively (since 2026-10-23, 4.7.2; H-SCPUIRQ, H-UIINPORT, H-SCPUPORT), H-POWER, H-EYESTATE, S-SETSAVE / S-NVRAM (the players' default since 2026-11-08); N: the ACC module init, ACC_MAIN, PER_SLOPE, the level gauge and Level Adjust with the accelerometer at its sample cache (since 2026-10-23, 4.7.3; H-ACCINIT, S-ACCREG, S-ACCSAMPLE, H-SLOPEINIT); PER_ROTATE with `--rotate on` (since 2026-11-08, 4.7.3; H-ROTINIT) | the accelerometer at the PER_SIO transfer and its data-ready pin (ACC_SENS_MAIN native); PER_ROTATE by default; S-NVRAM's NAND seam as the default | lab time; the UI_IN, SCPU and PER_SIO inits, the GIO init for the data-ready pin; CPU 3 for the store's boot load in a native boot | 64,446 / 56,954 | 4-5 weeks (steps 1-4), 7-9 with the power manager and NAND | a running clock, persistence by default, native power lever and power-down, rotation by default, eye sensor (Level Adjust, the level gauge and, with `--rotate on`, the orientation and the gauge's portrait layout in, 4.7.3) |
| **Card and file system** (4.8) | N on E143 since 2026-10-23 (4.8.2): the file system's bring-up, FILECLBK, FILEFGND, DCFPROC_SUB, sd_mount, sdmem, the format, dosfat, DCF and the shots / movie-time counts natively on an 8 GiB SDHC card at the SD command layer (S-SDCARD, S-SDHOST, S-FSNAND, S-ALBM, H-FILEINIT, H-FILECLBK); the picture's file at S2 through the file module (S-RECFILE; since 2026-11-08 REC_FILE's task natively from REC_IMAGE's packet with the firmware's own header on E143, E146 and E147, 4.8.10: H-RECFILE, S-RECIMAGE, S-EXIFPRM, S-JPEGENC); since 2026-10-24 (4.8.3) Card Formatting from the menu (S-MDACTRL) and the card's removal and insertion (S-MEDIA), the application's media control native; S: S-CARD's insertion requests, its HLS mount state and image list; the other bodies keep S-CARD's card with no file system | the SD host's registers and interrupts with a card model (seam A), the rule-found seam on the other bodies, REC_IMAGE and the image pipeline (the thumbnail, the shooting values in Exif) | the HLS media layer (which sends the insertion), REC_MAIN / REC_FILE (the picture's file), TAKE_MOV's movie take (the movie module's set-up, whose frame rate the movie time query reads: 0 before a take on the camera too), IRQs anywhere for the SD host | 115,103 / 108,887 (17k of it self-test and debug) | 1-2 weeks left: REC_FILE's DCF steps, both slots, exFAT, the other bodies | a card that fills, real files in DCIM, both slots |
| **Playback** (4.8) | S: S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW | with the S-PLAY* stand-ins kept: a JPEG decoder at the codec seam; native: the HLS play components, PLAY_* / MOVP / MOVE, the AV back end for movies, CIC for RAW | storage, imgpro C2, CIC `0x9be80000`, the AV back end | 684,201 / 612,936 (HLS components 310k, GUI 80k+, segment-9 PLAY_* / MOVP / MOVE 113k): the largest block | 2-4 weeks on top of storage with S-PLAY* kept; native: a block of its own (?) | playback of real files, index, zoom, histogram, erase, protect |
| **HDMI and DisplayPort** (4.9) | N with `--hdmi on` (since 2026-10-23, E143, E146, E147): a plug runs the hot-plug pin's IRQ 109, the HDMI init, two E-DDC reads with IRQ 239, the EDID's checks and parse and the connect report to UI_IN natively (H-GIOSLOTS, S-HDMISINK); off by default. On E143 since 2026-11-08 the application's TRA 588 is taken by S-OUTDEV, and CapIod's open, the transmitter's open (PHY, SCDC, update) and VSC channel 0 at 1080p59.94 run natively; channel 0 composes its window, nothing drawn on it; the unplug runs down to the disconnect report (A-HDMI-1) (X) | TX byte registers at `0x99c07000` (HPD / RxSense byte 8, DDC `0xa80..0xa83`, the buffer `0xc00`, IRQ 239, the open's words), the PHY words at `0x99c08000` and the GIO pin 77 (`0x9b881540`, IRQ 109), all modelled; VSC channel 0 | the application's notification of the open (CmpCst_Function's 494, the TRA reply), the GUI's planes on channel 0, the return to the TFT at an unplug | about 11k (3.3k plus the TX / DP driver's 7.7k) | 1 week left (the notification and the GUI's HDMI layout) | the HDMI output a TV shows |
| **USB** (4.10) | 0 on E143 | the event level first (EV_USB_CONNECTED 8, EV_USB_RXDETECT `0x040d00d2`, the select screen); later a DWC3-family device at `0x9a600000` (IRQ 223) | SCPU (PD, power source), ADC flag `0xbf`, the PC_* tasks, storage for MSC | 121,861 / 117,704 | 1-2 weeks events; 4-8 weeks data path | the USB select screen, charging state; later MSC, MTP, PTP |
| **PC connection over PTP (TPC)** (4.10) | 0 | ? (the bulk of the USB data path) | a USB or Wi-Fi transport, storage | about 52.6k / about 52k (21.4k of it filed under factory code) | ? | tethering, the PTP firmware-update path |
| **PictBridge / DPS / DPOF, XML parser** (4.10) | 0 | ? | USB | about 89k in parts: 13.4k HLS, 25.7k Cmp_PictBridge, 10.3k HFW print, 2.8k DPS transport, 9.4k DPS XML, 2.8k DPOF, 24.5k expat-like XML parser | ? | direct printing |
| **Wireless** (4.11) | 0: CPU 1 not emulated, no ISC model; the menus paint boot defaults | the ISC node-4 port boundary (a JS "A53 service"), at the ISC services behind the gate `0x50aa4c98` or as node 4's FIFO and doorbell (4.11.1) | CPU 1 native (blocking), the USTART chain, ISC init CREQs on all cores, card, imaging, SCPU (BLE wake) | 137,490 / 130,344: about 72k MN10300 application on CPU 1, about 25k CPU 0 HLS, FlashAir | 6-9 weeks after CPU 1 exists | live Wi-Fi / BT state, connection setup, a virtual smartphone over the firmware's own OI.Share API |
| **GPU and C3D** (4.12) | 0 | the colour-profile wheel screen: it configures the 32 bpp ARGB (`R8G8B8a8`) VSC IMG2 layer that the OpenVG renderer fills (E147, X; see 4.12) | CPU 1, a K3000 model, the EGL/OpenVG library | about 85k / about 84k | ? | the OM-3 colour wheel and its value polygon |
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
  so the shooting component that answers 990 and 991 (4.1.2) is never asked (with `control camapp 3` it is: 4.1.5).
  TAKE publishes only the module events
  `0x04020215` and `0x040800f0`, so its results reach the HLS through the replies to its requests and the callbacks the
  capabilities register (I, shutter spec item 44; 4.1.3). The AF request lives in `CapTre_TakeReady` -> API
  `0x50417cd9`, which neither camapp mode reaches.
- **Seam:** TAKE native, its neighbours answered at their own seams. Inside the step: lens at its serial seam (or
  LENS_EXEC answered) and BC_EXEC answered; the sensor control plane far enough for TAKE's through start (TAKE_FUNC
  command 25, 4.1.1); the shutter at its control plane; the strobe can be planned beside the shutter.
- **First step:** the static decodes are done (4.1.1-4.1.3). Next, make the HLS component bring-up (`control camapp
  2`) the default of the coverage workload, so the HLS half of TAKE is measured before TAKE itself is attempted
  (tried 2026-11-08, 4.1.5: with the transactions native the components answer them, and the menu then stops at the
  imgpro unit `0x9c600000` past udf07, so the default stays camapp 1); then a
  probe that runs TAKE_FUNC and TAKE_FUNC_CP natively with a recording stand-in on each queue they send to (4.1.1's
  table), which gives the order and contents of their requests for a start, a through switch and a movie. The probe
  runs since 2026-11-08 (4.1.4): the start's and a mode change's requests are recorded; the through switch and the
  movie do not reach TAKE_FUNC in the lab, and neither do S1 and S2.
  Under camapp 3 with the probe S1's take request reaches TAKE_MAIN natively since 2026-11-09 (X, 4.1.7).

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
- **The request is the exec's to consume (2026-10-29):** its senders allocate it (operator new) and do not delete it
  after the exec (getHistogramData `0x50ada615..0x50ada652`); the exec deletes it through its vt[1]
  after a local handler answered (`0x50af7d3a..41`) and when no receiver is there (`0x50af7dfd..04`), and on the remote
  path passes it to the substance's vt[41] (`0x50af7d7f..8b`) and does not touch it after. vt[1] is the event base's
  delete (`0x50d9a1ee`: the word `+8` non-zero, then vt[0] and operator delete). S-TRAACK, which answers the exec,
  deletes it the same way (4.4.2, the heap's growth).
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
  `0x503f0bd7`). Why the native run of shutter spec item 43 saw no answer is ?; in camapp 3 (4.1.5) 990 is answered 0
  natively (X), with the firmware's own 415 and 420 booting the components before it.
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
  parts' notifications, and what makes the parts send them is the inbound events above (I). 1366, which the
  reactive turns into CBS_START_THROUGH_IMAGE_PROCESS (its handler `0x50af4a63`), is built by CapThr_ThroughImage
  (`0x50bd2488`) and the sequence parts (`0x50c87ef1`, `0x50cacf6b`; the builder `0x50af2daf`, D); since 2026-11-02
  S-RELSEQ posts it with END_RECVIEW, on which alone ten bodies' GUIs leave the rec view's display
  (`docs/model-survey.md` finding 69).
- **What runs (X, a camapp 2 play session with S1, S2 and two REC presses, observers on the dispatchers and
  Com_EvSenderManager, coverage):** S1 and S2 reach Com_EvSenderManager (`0x02000100`, `0x02000101`, their releases
  `0x0201xxxx`) but no event reaches the sequence's state-4 handler; each REC press (`0x0200120a`) reaches it as event
  1080, which the phase-101 dispatcher takes (case `0x50c5d628`). Functions entered: the sequence base 67 of 311,
  CmpSqp_SequencePartsBase 128 of 3,205, gap@0x50c5c4ac 5 of 111 (phase 101 only), gap@0x50c7eeb2 7 of 838,
  gap@0x50af1ebd 22 of 438, CapTak_Take 20 of 145 (not TakeReady `0x50bc79e6` nor takePicture `0x50bc876a`), the
  shooting component's dispatcher `0x50d725f0` (event 502 three times, not 990 or 991); TAKE_FUNC's loop none. The
  release callbacks still come from S-RELSEQ; where Com_EvSenderManager sends S1 and S2 is ?.

#### 4.1.4 TAKE_FUNC natively: the probe, round 1 (2026-11-08; D unless tagged, addresses E143's)

TAKE_FUNC and TAKE_FUNC_CP run natively with `--take probe` (`emu/src/lab/take.mjs`; off by default, golden
unchanged), under camapp 1 and camapp 2, in place of S-MODACK's answers to TAKE_FUNC's queue. Every request they make
of a module or driver the lab does not run goes to a recording stand-in that records it and answers only where TAKE
waits; posts to TAKE's own queues, to LENS_EXEC (the native lens) and TAKE's replies to its requesters go natively and
are recorded too; anything else throws. `emu/test/test_take.mjs` pins the records below (X).

- **The bring-up (H-TAKEINIT):** USTART2's stage word `0xa32d6d58` set to 1 as USTART2 sets it after its stage 2_1
  (`0x5012abef` from `0x501e8eac`); TAKE_FUNC_CP's start polls it with 1 ms sleeps (`0x502cda22..0x502cda3f`; without
  it the start never ended, X). Then TAKE_FUNC's module init `0x502ccff8` (USTART's call at `0x50024c2d`) and act_tsk of
  tasks 105 and 106, as USTART starts them right after the init (`0x50024c3b`, `0x50024c54`).
- **The stand-ins:** S-TAKEREQ for the queues (synchronous: status 0; a reply queue of TAKE_FUNC_CP_POST:
  `{0, token, 0}` there after the step, which the start sequence clears from its pending bits,
  `0x502cdad7..0x502cdae3`), S-TAKECAM for the camera driver's request switch `0x502a4a46` (cam.c; its own init does
  not run: request 148's handler `0x502a4b74` found its pool `0x6299726c` empty and logged `0x0a103000`, X), S-TAKEUSF
  for the dust filter's gate-on `0x50064a69` ("USF GATE CONTROL", which drives the timer block `0x9b880000`). The texts
  are CAMAPP_STAND_INS'.

**The application's start (X, camapp 1; camapp 2 adds the last two rows).** The GUI reaches the shooting screen
(`0x0108`) as with S-MODACK.

| # | TAKE takes | TAKE asks, in order | Waits for | The stand-in's answer |
|---|---|---|---|---|
| 1 | TAKE_FUNC command 0 (async, reply queue 6, token `0xf0010000`) | TAKE_FUNC_CP command 0 (`0x502cd39b`, the message forwarded) | nothing | (native) |
| 2 | TAKE_FUNC_CP command 0 | camera driver request 148, argument 1 (`0x502cd948`) | flag TAKE_CAM_EVENT bit 1 under semaphore 0x19 (`0x502cd49f`) | S-TAKECAM: 0, then the completion `0x502cd4d0(0, request)` |
| | | BC_EXEC command 0, token 2, parameter `{byte, callback 0x502cdc0b}` (`0x502cd9a8`) | tokens 2 and `0x80` on TAKE_FUNC_CP_POST | S-TAKEREQ: `{0, 2, 0}` to 0x61, then `0x502cdc0b`, which posts token `0x80` (I: that BC calls it) |
| | | LENS_EXEC command 1, token 1 (`0x502cd9f2`) | token 1 on 0x61 | (native: LENS_MAIN replies) |
| | | camera driver request 6 (`0x502cda61`) | TAKE_CAM_EVENT bit 1 | S-TAKECAM, as for 148 |
| | | STB_EXTERNAL command 1, token 4, after a 10 ms sleep (`0x502cda87`; `0x502cdc33` from `0x502cda92`) | token 4 on 0x61 | S-TAKEREQ: `{0, 4, 0}` |
| | | the dust filter's gate on, record `{0x502cdc97, 0}` (`0x502cdb34`, once BC's and the lens's tokens are in, `0x502cdb07..0x502cdb34`) | flag TAKE_FUNC_CP bit 1 (`0x506d99ed`, the count `0x62a3f3c0` from `0x502cdc5d`) | S-TAKEUSF: `0x502cdc97(0, record)`, whose deferred call counts down to the flag |
| | | STB_EXTERNAL command 4, token 8 (`0x502cdc33` from `0x502cdb67`) | token 8 on 0x61 | S-TAKEREQ: `{0, 8, 0}` |
| | | the reply to the application: status 0 to queue 6, token `0xf0010000` (return `0x502cd75d`) | | (native) |
| 3 | TAKE_FUNC command 13 (sync, the application's reply queue `0x102`) | TAKE_EXPOSE command 0, synchronously (`0x506d9854`, return `0x506d7f32`) | its u16 status on 0xa7 | S-TAKEREQ: status 0 |
| 4 | TAKE_FUNC command 18 (sync) | TAKE_FOCUS command 0, no reply queue (`0x506ea965` from `0x506eab52`) | nothing | none |
| 5 | (camapp 2) TAKE_FUNC command 29 (sync, parameter `0x62a6b6d4`) | nothing | | |
| 6 | (camapp 2) TAKE_FUNC command 22 (sync) | TAKE_FOCUS command 2, synchronously (return `0x5039abbb`) | status on 0xa7 | S-TAKEREQ: status 0 |

Each synchronous command ends with TAKE_FUNC's reply to the requester's queue (status 0). Of the requests 4.1.1's table
lists for 13 and 18, the start made only these (X): 13 no TAKE_EXPOSE `0x200`, 18 no TAKE_FOCUS command 2 (its command
0 is `0x506eab1f`'s; command 2 came from 22's handler). TAKE_POWER_MANAGER_EXEC is not
asked: the start's branch `0x502cd84c..0x502cd881` skips its two messages (X; which of its three conditions, the byte
`0x62a3f2bc` or the settings 61633 and 7729, is not traced). LENS_EXEC's command 1 comes after H-LENSON's (4.4.2) and
LENS_MAIN takes it natively (X). With the probe the warning `0x39000903` (`0x504494ed`, a frame-rate code conversion),
logged about 12 times a second on the idle shooting screen under S-MODACK, is not logged (X; why is not traced).

**The other scenarios (X, both camapp modes):**
- **A mode change** (the dial P -> A, and A -> P, and to Movie): TAKE_FUNC command 22 three times, each TAKE_FOCUS
  command 2 synchronously (`0x5039abbb`), S-TAKEREQ's status 0; under camapp 2 the change to Movie also command 29
  three times, which asks nothing.
- **S1, S2, the rec view, MENU in and out, a live view, REC in Movie:** nothing reaches TAKE_FUNC, nor TAKE_EXEC
  (0x5a) under S-MODACK; what S1 and S2 send stays at S-TRAACK (TRA 944, 974 and 1045 at S1, 944 at S2, 963 and 1030
  at the releases), and MENU's open and close send TRA 991 among others. So TAKE_FUNC native does not by itself make
  S1 / S2 reach the modules.
- **The through start (command 25) is not reached:** its one sender is api_tft `0x504214fc` (callers `0x50b681f1`,
  `0x50b74758` and CapThr::start `0x50bcc18a`), and the shooting component that would start CapThr never gets TRA 991
  while S-TRAACK answers it at the exec (4.1.2). Of its requests only TAKE_FUNC_CP's part is read: CP command 25
  (`0x502cd6d8` -> `0x506d99ce`) makes the camera driver's request 5 when the byte `0x62a3f39a` is 1, which command 0
  sets at its end (`0x502cdbd8`, X: set in the probe); S-TAKECAM knows request 5 (D, not executed).
- **S-TAKEFRAME's request and S-TAKEMDET's are not on any path the lab reaches:** the frame-mode function
  `0x5039f583` (S-TAKEFRAME's; it calls the plane's setter `0x500256d9` at `0x5039f622`) is called from TAKE_FUNC's
  commands 26, 27, 59, 74, 75, 80 and 90 (`0x5039ad7d` .. `0x5039d48f`) and from `0x506d8a2d`; the live-view request
  `0x506d8dea` (S-TAKEMDET's subject bit, docs/om1-subject-spec.md 5.1) from commands 26, 59 and 90 and from
  `0x506d8a1e`. Those two calls lie in `0x506d83f9` (I: no return between its entry and them), which the through start
  calls (4.1.1) and command 75 too (`0x5039b9b3`). None of these commands arrives in any scenario above (X); the
  senders of 26, 59, 74, 75, 80 and 90 are not read (?).
- **The EXIF set still divides by zero:** called on a template copy after the probe's start (as round 9 tried, 4.8.10),
  it stops at `0x50398ca5` under both camapp modes (X), so the state it divides by is the take's (takepic's), not the
  start's. No end-to-end improvement (TAKE's frame mode in place of S-TAKEFRAME, its EXIF set in place of S-EXIFPRM)
  is possible from this probe without inventing a request.

**Each neighbour's reply (classification: (a) a native module the lab can start; (b) a modelled device or CPU 2; (c)
unknown):**

| Neighbour | Asked by | What TAKE needs back | Class |
|---|---|---|---|
| LENS_EXEC (LENS_MAIN) | CP 0 | `{status, token 1}` on 0x61 | (a), native since 2026-10-28 and answering in the probe (X) |
| TAKE_EXPOSE (task 0x67, `0x5059145d`) | 13 | the status of command 0 | (a), native since 2026-11-09 (H-TAKENBINIT): its command 0 asks nothing and it replies itself (X, 4.1.6) |
| TAKE_POWER_MANAGER_EXEC (task 0x83) | CP 0 when its branch runs | `{status, token 512 / 1024}` on 0x61 | (a), native since 2026-11-09 and not asked: every sender in TAKE_FUNC and TAKE_FUNC_CP waits for TAKE's start-up flag, which the lab never sets (X, D, 4.1.6); its own request goes to CPU 1 (b) |
| TAKE_FOCUS (task 0x68, `0x509a0ebe`) | 18, 22 | the status of command 2 | (c): over FCS (FCS_EXEC, FCS_IP on CPU 1); what commands 0 and 2 ask of FCS is not read |
| STB_EXTERNAL (the strobe module) | CP 0 | `{status, token 4}`, `{status, token 8}` on 0x61 | (b): task 0x65 (`0x501b7465`) answers command 1 once a transfer on PER_SIO channel 11 ends or its 13 s wait for it runs out, then a 64 ms timer, flash or no flash (D, X); run natively in the lab it answers only through that timeout, 13.1 s after the request, as PER_SIO's controller is not modelled (X, 4.1.6); stays at S-TAKEREQ |
| the camera driver cam.c (requests 148, 6; 5 for 25) | CP 0, CP 25 | the completion callback with status 0 | (b): the image sensor's control plane: cam.c's init (its pool, the sequence engine `0x5015107e` / `0x501528a6`) and what it drives (not read, ?) |
| BC_EXEC (BC) | CP 0 | `{status, token 2}` on 0x61 and the callback's token `0x80` | (b): the body IS controller's link (4.4: BC native only with a capture of that link) |
| the dust filter (USF) | CP 0 | the record's callback with status 0 | (b): its drive on the timer block `0x9b880000` and its completion, not modelled |
| MOV_COMMAND, SDET_EXEC, WB_MOV | movie and through commands (4.1.1) | not asked in the runs | (b): CPU 2 (S-CPU2) |

**The plan for TAKE native, by what it unblocks** (estimates in Claude wall-clock, I):
1. **S-RELSEQ's retirement.** Not TAKE_FUNC's neighbours: S1 / S2 reach no module with TAKE_FUNC native (X), so the
   release needs the shooting component to get its TRAs (S-TRAACK narrowed: TRA 990 / 991 and the release TRAs to
   CmpSht_ShootingComponent_NEW, in progress elsewhere), the sequence parts to send their take requests, and then
   TAKE_EXEC (0x5a: TAKE_MAIN 0x6b, TAKE_MAIN_CP 0x72) native under the same probe machinery. The probe's extension to
   TAKE_MAIN: about half a day once the requests arrive; its neighbours are unknown until it runs (?).
   Round 1 of this ran on 2026-11-09 (X, 4.1.7): S1's take request reaches TAKE_MAIN under camapp 3 and stops at
   TAKE_FOCUS's AF.
2. **EXIF shooting parameters (S-EXIFPRM)** follow from 1: takepic's record (`0x503bba70`, the EXIF set from
   `0x503bd48e`) is the take's, and the start does not fill the state the EXIF set divides by (X). A few hours after 1
   if takepic's own neighbours answer like the start's; otherwise unknown.
3. **The orientation tag** (PER_ROTATE's getter at takepic `0x503bcd51` writing record `+0x950c`) comes with 2: the
   getter is native with `--rotate on`; nothing extra once takepic runs (I).
4. **S-TAKEFRAME / S-TAKEMDET:** the through start (command 25, which needs TRA 991 at the component first) or one of
   the commands 26, 59, 74, 75, 80, 90 (above). Read their senders first (2-4 h); running them is then the probe's
   work plus the camera driver's request 5 (S-TAKECAM) and what else they ask (?).
5. **The neighbours themselves**, in the order the start needs them: TAKE_EXPOSE and TAKE_POWER_MANAGER started
   natively like H-TAKEINIT (a few hours each, if they stay device-free); the strobe's readers read (half a day, then
   unknown); the camera driver cam.c with its init (days at least: the sensor's control plane, 4.2); the dust filter
   (unknown: its timer channel and completion); BC (blocked on a capture of the IS link).

#### 4.1.5 The components answer the transactions (`control camapp 3`, 2026-11-08; X unless tagged)

- **What kept the components from answering was S-RPC, not the components (X, D).** With S-TRAACK out of the way the
  exec's remote path sends through the receiver substance's vt[41] (`0x50af8487`, the singleton at `(0x60360f40)`):
  started once (`0x50d9bf6c`, flag `0x100000`), it posts the request and waits for the answer in 1000-tick waits
  (`0x50af8537..65`). The menu lab's S-RPC answers that entry 0 without sending, so the exec returned the receiver's
  default `0xf0000001` (its +132, `0x50af832e`), in camapp 2 too: that is the "remote channel answers 0xf0000001" of
  4.1.2 and shutter spec item 43. S-RPC's other entry, the remote-call method `0x50ac734c`, is the RSB requests' send;
  the mode change's (OlyHfwOpeComRsbChangeMode, mode `0x10000`) goes through it and brings the camera base its 420.
- **The boot needs no S-BOOTDONE (X, D).** The application's HighLevel init builds the event 415 (vtable
  `0x60dca154`, `0x50ab2dda..e6`) and executes it as TRA 415 (`0x50ab2def`); it waits for the answer, so the OXF main
  thread (task 57) has to run before HL_INIT (started before it, the exec returns 0; started after it, as camapp 2
  does, the lab task waited with every task blocked). Camapp 3 (`control camapp 3`, `src/lab/camapp.mjs` TRAACK_KEPT)
  starts task 57 between HL_CREATE and HL_INIT, lifts S-RPC from both entries and has S-TRAACK hand every transaction
  to the exec: the camera base reaches its state 13 and the still category its state 11 from the firmware's own 415
  and 420. Who starts task 57 on the camera is ? (I: before HL_INIT, by this wait).
- **Which transactions now reach a component (X, `emu/test/test_camapp.mjs` traRoutingSession).** The start's, in
  order: 415, 598, 614, 990 (startShootingService), 958, 1515, 994 (eight times), 955, 1001, 1061 (twice), 992,
  1503 (twice), 1065, 1045, 938, 974, each answered 0 natively but 992 (`0xf0000058`, the components' own refusal; why
  is ?); the idle's 944 (getHistogramData) and S2's 1030, answered 0. S1 and S2 send no other transaction: the release
  still comes from S-RELSEQ's callbacks. On the way the components read module 9's state at `0x50c78bb4` (the
  shooting component's set-up after 990: state 2 starts CapThr, `0x50c78bc1`, D) and `0x50d78808` / `0x50d78815` (at
  the HDMI plug), and set it to 0 (`0x50ca4ae1`), after which the application reads it at `0x50abb044` too; these join
  S-TAKEOVER's readers in camapp 3 (CMP_MODULE9_READERS).
- **Classification for S-TRAACK (X).** (a) answered natively by a component in camapp 3: every transaction of the
  start, the idle, S1 and S2 above, the HDMI plug's 994, 974, 937, 955, 1036, 1046, 1002, 987 and 588 (the output
  switch, answered 0 by the component, which opens the HDMI device: SCDC write, VSC channel 0 at 1080p59.94; S-OUTDEV
  not used), and the menu's 974, 937, 958, 1515, 994, 955, 1036, 991 and 694, each answered 0 (593 too since the
  imgpro unit, 4.3.1);
  (b) none: no transaction alone needs what the lab lacks, the stop below comes after the menu's transactions and also
  with 991, 694 and 593 left to S-TRAACK (X); (c) none found. Playback's transactions (974, 937, 994, 1036, 1046, 1002,
  987, 691, 599, 553, 556, 553) and the return's (556, 990, 991, 1001, 1061, 994, 1045, 938, 974) are answered 0
  natively since the imgpro unit (X, 4.3.1). TRAACK_KEPT is therefore empty; S-TRAACK keeps answering
  everything in camapp 1 and 2.
- **What the native path needs that the lab lacks (X, D):**
  - *The VSC histogram.* The shooting component's display set-up starts the VSC's histogram on the TFT channel
    (`0x501e14a4`: INTEN1 bit 8, HIST1 = 1, after HISTAREA1 / 2 at `0x501e1396` / `0x501e13f6`, reached from
    `0x501d6ea6`). A composite of the TFT is then FEATURE_UNOBSERVED (A13: HIST1, HISTAREA1..3, HIST2 written), so
    traRoutingSession takes no frames. DISPLAY cmd 15 (`0x501d709f`), which the menu and the HDMI plug send while the
    histogram runs (`(0x62a3eaf8)` = 1), clears the histogram's flag (id at `0x6004303a`) and waits for it 50 ms
    (`0x501d70d1`); only the histogram's done callback `0x501d71e1` sets it (it also posts DISPLAY cmd 16 to the queue
    whose id is at `0x600432d4`). Inside S-DISPQ's run the wait cannot block: the run's task blocked, the lab task's
    settle returned inside the run and executed the caller's `0xff` (`0xa2100007`, fault 5), the menu's first stop.
    Until 2026-11-09 S-HISTWAIT ran the wait to its timeout (50 ms of lab clock, E_TMOUT); the unit is now modelled and
    the wait returns E_OK at the run's end (4.2.1).
  - *The CPU's udf07 (implemented 2026-11-09; the stop until then).* Past cmd 15's wait the menu ran into `udf07 d0,d1` at
    `0x5050a089` (fault 1), in task 57: the sequence (`0x50c591d4`, state 4) to CapThr_ThroughImage (`0x50bd61b2` ->
    `0x50bd5fe4`, the through image's bank), api_tft `0x504225c5` and the imgpro library (`0x5048ef28` .. `0x5048e190`
    -> `0x5050a086`). udf07 is now BSCH as the Panasonic MN103001 manual gives it, which the helper's three callers
    agree with (`docs/om1-udf-spec.md` row 14; the search order is the manual's alone). udf07 then runs twice, each
    with Dm `0xffffffff`, Dn 0 and result 31 (X, the callers' return addresses): for a per-CPU flag bit (the call at
    `0x5048e190`, bit 31) and, in the kind's handler (`0x5046daa2` -> `0x5048ba51`), for the request's id (the call at
    `0x5048ba86`; id `0x801f`, D).
  - *The imgpro unit `0x9c600000` (the stop until 2026-11-09's round 2, 4.3.1).* The request is kind 14 at its +16,
    built at `0x50490c89` when the image's halfword at +8 is 3074 (D): the fill, of the through image's bank (api_tft's
    `0x504223a4`, X), the kind `0x5048ee61` also builds for REC's header. Its issue `0x50493824` reaches the kind's
    driver through `0x5046d814` (the table at `0x6065a834`, whose entry 14 is the handler `0x5046daa2`, D) and
    `0x5046db04`: `0x5050a797` writes 1 to `0x9c600004` at `0x5050a7a9`, which the lab refused (lab-stub denied, fault
    2). Corrected: that write is the start's power-up (I), not the run's start, which is the go's `+0x00c` and `+0x018`
    (`0x5050a8ba`, 4.3.1); and PLAY with the passes' pictures issues two such fills, not one. The unit is modelled since
    (S-IMGPRO, with H-IMGPROINIT and S-STAGE9): the menu opens and closes and playback shows and returns (X); camapp 3's
    next stops and what keeps camapp 1 the default are in 4.3.1.
- **The "swap wait" of the HDMI round (X, corrected).** The 300,000 stub calls 4.9 reports at the HDMI open under
  camapp 2 were counted under the hook name "S-DISPFRAME (swap wait)", which is the OlyTaSS wrapper every sleep goes
  through (DISP_FRAME's swap sleeps are only some of them; the counts: the accelerometer task's 80 ms sleeps and the
  rest, X). Reproduced in camapp 3 without S-HISTWAIT: TRA 937 at the plug waits in the receiver's 1000-tick loop
  while the OXF main thread's DISPLAY cmd 15 waits on the histogram flag, so lab time ran on in one settle to the
  limit. DISP_FRAME's own wait is bounded (`0x5100df69`: at most 84 sleeps, then errlog `0x17004003`, D).
- **HDMI in camapp 3 (X, `--hdmi on`).** The plug's TRA 588 is the component's (answered 0); CapIod opens the HDMI
  device and the lab runs channel 0 at the format table's timing (`DisplayLab.hdmi_line`, as for S-OUTDEV's open). The
  channel composes its 1920 x 1080 window with no plane drawn (DMAEN 0, OSDCP2 unwritten; OSDFMT1 `0x111` written),
  as with S-OUTDEV; no transaction follows the plug, and what the GUI waits for to draw its HDMI layout is ?.
- **The heap (X).** Over passes of S1 and S2 in camapp 3 the OXF main thread's events (event 294, `0x60dcb42c`) do
  not stay (traRoutingSession), as in camapp 2 (4.4.2); the menu and playback passes run since the imgpro unit, but a
  pass of S1 and S2 after them leaves the next key untaken (4.3.1), so the heap workload's passes are not measured.

#### 4.1.6 TAKE's neighbours natively, round 2 (2026-11-09; D unless tagged, addresses E143's)

With `--take probe` TAKE_EXPOSE and TAKE_POWER_MANAGER now run natively too (H-TAKENBINIT, `emu/src/lab/take.mjs`), so
their queues no longer go to S-TAKEREQ; the strobe stays there. `emu/test/test_take.mjs` pins the records and the
neighbours' state below under camapp 1 and camapp 2 (X, 19 of 19 checks; golden unchanged, the probe is off by
default).

- **The bring-up (H-TAKENBINIT).** USTART2's stage `0x501e8e84` runs TAKE_EXPOSE's module init `0x50591220` (its call
  at `0x501e90bd`: its context from `0x62abd790` set, three 64-byte buffers from `0x50002fdc`) and EXP's init
  `0x50553649` (not run; H-AEINIT runs one of its steps), then starts TAKE_EXPOSE, task 103 (tid word `0x60042df4`,
  `0x501e90cb..0x501e90d8`), and later in the same stage TAKE_POWER_MANAGER, task 131 (`0x60042e2c`,
  `0x501e9364..0x501e936b`). TAKE_POWER_MANAGER's init `0x502ce4d4` is the second call of TAKE_FUNC's init
  (`0x502ccffd`), which H-TAKEINIT already runs: flag pattern `0x62a48760` = 3, its queues EXEC 0xd7 and POST 0xd8
  bound to bits 1 and 2 of the flag whose id is at `0x60043140` (`0x5002c285`), two 24-byte slots at `0x62a48764`.
  The lab runs TAKE_EXPOSE's init and act_tsk of both after H-TAKEINIT; both then wait (X): TAKE_EXPOSE on its queue
  0x5b without a time limit (`0x505914eb`), TAKE_POWER_MANAGER on the flag (`0x503a926f`).
- **TAKE_EXPOSE answers command 13's request itself (X).** TAKE_FUNC's synchronous request (`0x502ce86d`, reply queue
  TAKE_FUNC_IMDFUNC) reaches it; its command 0 (`0x50592215`, from the hashed table at run-time `0x606f1434`, 64
  slots `{command + 1, case}` for 33 commands 0..`0xd03`) sets its on byte `0x62abd78a` to 1 and `0x62abda5e` (a
  second command 0 would log `0x0e001f04`), asks nothing of any other module and replies status 0 to 0xa7
  (`0x50591717`). Row 3 of 4.1.4's start table therefore reads `TAKE_FUNC -> TAKE_EXPOSE 0 sync (native)`,
  `TAKE_EXPOSE -> reply` in place of S-TAKEREQ's status 0; the rest of the start, the live view, S1, S2, MENU and the
  mode change record as in 4.1.4 under both camapp modes (X). It is the only message TAKE_EXPOSE takes there (X,
  counted at its receive; its loop writes each message's command to `0x62abd788`, `0x505914f5`, 255 from its start,
  `0x50591497`, which the test pins at 0 after the scenarios). S-EXPOSE's plan for the default scene is the same with
  and without the two tasks (X: BV 1792, Tv 2052, Av 1276, Sv 1536; also at EV 16 and 6).
- **The AE result objects are not written natively, so S-EXPOSE is unchanged (X, D).** `0x50596187` is not one of
  TAKE_EXPOSE's command cases: it is the AE result writer (`0xc12a` from the result's +0, `0xc0ba` from +2, `0xc0ca`
  from +4, and `0xc57a`, `0xc2ea`, `0xc2da`, `0xc2ca`, `0xc4ba`, `0xcdca`, `0xcdda`, `0xcdb1`, through `0x5004188b`),
  called from five callbacks (`0x5059757f`, `0x5059781d`, `0x5059790f`, `0x5059794c`, `0x505979a5`) that the AE
  launchers `0x505964e7`, `0x505943cb` and `0x5059699d` put into the requests they build through `0x50596af0`: the
  first and the last hand theirs to EXP's `0x505536be`; `0x505943cb` builds the static request `0x62abda60`, which the
  builder links at +196 of the requests it builds (`0x50596c62`, under a condition not read). Every
  TAKE_EXPOSE command but 0, 1, `0x200`..`0x202` and `0x300` reaches a launcher (the firmware map's static callees;
  their conditions not read), and so do `0x50591973` (from TAKE_MAIN's `0x503ad611`), `0x50591c6b` (from
  `0x508eeb32`) and `0x50591d1a` (from `0x509af437`). Command 0 does not, and only command 0 arrives in the lab's
  scenarios (X); the probe observes the writer and it never runs (X). On the camera the callbacks come from EXP's
  computation over the sensor's statistics (I). 4.2 and S-EXPOSE's text call `0x50596187` TAKE_EXPOSE's command
  handler; it is the writer called back through EXP (D).
- **TAKE_POWER_MANAGER is asked nothing (X, D).** Every send to TAKE_POWER_MANAGER_EXEC from TAKE_FUNC and
  TAKE_FUNC_CP waits for TAKE's start-up flag, the byte `0x62a3f2bc` (start_up_flag, 4.1.2) = 1: the start's branch
  (`0x502cd84c`: `0x502cd3fa` returns the byte; X: 0 in both camapp modes, so it is the first of 4.1.4's three
  conditions that skips the branch), command 29's `0x5039c6a3` -> `0x506d8c72`, and TAKE_FUNC_CP command 1's stop
  sequence `0x503a0c18` (`0x503a0d53`, `0x503a0e22`). A fifth sender, `0x503a978c`, is reached only from `0x5039f735`,
  whose only static caller `0x50399cd3` is the function named "take" in two `{name, function}` tables (`0x502a2904`,
  `0x502a3ea4`; I: a debug shell's commands). The flag is
  set to 1 only by `0x503a05fb`, which also sends TAKE_FUNC command 29 and is api_rec's `0x50416123`, called by
  CmpSqp_SequencePartsBase `0x50c9d590`; neither camapp mode reaches it (X: the flag stays 0). What it would do (not
  executed): its handler `0x503a949f` takes the slot the request's parameter byte 0 names, calls the parameter's
  callback, and for byte 0 = 0 replies on its POST queue (`0x503a950d`), for 1 posts a 16-byte request to CPU 1's
  queue 0x1018 (`0x503a9525` through `0x502ce5b7`; CA53_POWER_MNG_REQ in CPU 1's object-name table, type 5 index 24,
  `docs/om1-cores-spec.md` 4). The start's first message (`{1, 0, 0}`, command 2, token 512) would take that path,
  that is ask CPU 1 to change the A53's power (I from the name); no lab runs CPU 1.
- **STB_EXTERNAL answers with no device only through its timeouts, so it stays at S-TAKEREQ (D, X).** Its task, 101
  (`0x501b7465`, tid word `0x60042df0`, started by the same stage at `0x501e8ff3`), is queue 0x57's one reader: it
  receives at `0x501b7594` (no time limit while its state `0x62a29ad4` is 0) and replies `{u16 status, token,
  parameter}` to word 0 after each command (`0x501b76ba..0x501b76fb`), status always 0 for commands 1 and 4. Of the
  places 4.1.4 named as the strobe's readers, `0x501b74a1` is this task's; `0x501aa18f` and `0x501b2735` (stb_debug.c)
  are senders, synchronous sends to 0x57 through the kernel's `0x5002e39d` (`0x501aa198`, `0x501b273a`). Command 1
  (TAKE's token 4) is processed while `0x62a29ade` is not 1 and `0x62a29ad6` is 0 (`0x501b6de5`; after each command 1
  `0x501b6f9c` sets the first to 1, a command 0 clears it, `0x501b6f8c`; `0x501b7b55` clears the second at the task's
  start): case 1 of `0x501b780e` writes a record at `0x62a296b4` whose first byte is 11 (`0x501b6be7`, its reader not
  read), then `0x501b82ab(0)` -> `0x501b833e` opens PER_SIO channel 11 and starts a transfer (`0x501bb0b8` ->
  `0x501b67fc` -> `0x501b6c54`: `0x5005f0f7(11, ...)`, up to five tries 10 ms apart while it is busy; the transfer
  `0x501b6ab9` not read), waits up to 13000 on the strobe flag's bit 2 (`0x501ba1ac` -> `0x501c18b6`, the flag id at
  `0x60042fee`), which the transfer's completion callback `0x501ba0bc` sets, and on a timeout logs `0x23000112` and
  `0x23000222` and goes on (`0x501ba1c8..0x501ba207`); then it starts a timer of 64 through the firmware's timer service
  (`0x501c1831` -> `0x5005899c`, `docs/om1-kernel-spec.md` 8; its handler `0x501ba277` sets bit 8) and waits for bit 8
  without limit. Nothing on the path asks whether a flash is on the shoe (`0x501b1e7e`, called first, is not read in
  detail). Run natively in an experiment (X, camapp 1, not committed: the task started with act_tsk after H-TAKENBINIT,
  queue 0x57 taken out of S-TAKEREQ): channel 11 opens (0) and the transfer starts with no error, but it never ends
  (PER_SIO's controller and its interrupt are not modelled on E143, `emu/src/lab/sio.mjs`); the wait runs out 13,001 ms
  of lab clock later with the two logs, the timer fires 64.9 ms after that, a second transfer start finds the channel
  busy five times and its failure path calls `0x501ba0bc` with status 1 (from `0x501b6959`), and the task replies to
  0x61 13.1 s after TAKE's request, the GUI waiting at `0x0102` until then. So the strobe answers with no flash and no
  device model, but only through a path the lab's missing controller decides; run natively it would put a 13 s stall and
  the strobe's error logs into TAKE's start, so it stays at S-TAKEREQ. Command 4 (token 8) is answered at once in the
  state command 1 leaves (`0x62a29ad4` = 1, `0x501b7872`; only state 2 processes it, `0x501b6e6c`). Whether the camera's
  controller ends the transfer with nothing on the shoe is ?.
- **Open.** TAKE_EXPOSE's other commands (`0x200` from 13 under its mode bits, 14's `0x201` and 1, the movie's
  `0xc00` / `0xc01`) and what they ask of EXP (`0x505536be` runs in TAKE_EXPOSE's task); TAKE_POWER_MANAGER needs the
  sequence parts' start-up call (`0x50c9d590`, its trigger not read) and then CPU 1; the strobe needs PER_SIO's
  controller on E143 (the end of channel 11's transfer). Of plan item 5 in 4.1.4, the first step is done; the strobe's
  step ends here with a negative result; the camera driver, the dust filter and BC are unchanged.

#### 4.1.7 The release route to TAKE_EXEC, round 1 (2026-11-09; D unless tagged, addresses E143's)

Under `control camapp 3` with `--take probe` (`emu/src/lab/take.mjs` round 2; off by default, golden unchanged) S1's
take request reaches TAKE_MAIN natively. `emu/test/test_take_release.mjs` pins the records below (X). S-RELSEQ stays in
every session, the probe's included.

- **S1 and S2 are not transactions (X).** Under camapp 3 the presses reach the shooting sequence as OXF events. The
  application's event task (`0x50abbfc0`) hands the key code to Com_EvSenderManager `0x50d76ac8`, and the sequence's
  state-4 handler `0x50c591d4` takes the event in phase 101 (dispatcher `0x50c5cc48`): S1 `0x02000100` -> 826
  (Trig1Release, case `0x50c5cc94`), S2 `0x02000101` -> 824 (Trig2Release), the releases `0x02010101` -> 828 and
  `0x02010100` -> 827 (under camapp 2 none reached the state-4 handler, 4.1.3). The shooting component's dispatcher
  `0x50d725f0` takes no transaction at S1 or S2. The exec gets getHistogramData (944) six times in S1's 600 ms (none
  in the idle second before), which also reaches the sequence as event 944; phase 101's dispatcher does not take it.
  With S-RELSEQ's callbacks S2 adds TRA 1030 (`0x50add4bf` in OlyHfwOpeShoot, the component's case `0x50d730e2`);
  with S-RELSEQ switched off for the trace it does not come. TRA 990 is the start's (4.1.5), 991 is not sent at S1 or
  S2.
- **The first stop: the sequence parts' S1 guard (D; X, camapp 3 without the probe).** Phase 101's case for 826 asks
  the sequence-parts controller (`*(this + 2784)`) vt[1306] (`0x50cc7f1a` -> vt[111], `0x50c8d4a4`). Its first test,
  `0x50bcdef7` (at `0x50c8d4b4`), passes only when the top byte of CapThr_ThroughImage's state word `0x60362b38`
  (getter `0x50bcccc9`) is 1. It returned 0, so the case took vt[1397] (`0x50cc7f29`) and the half press went no
  further: no CapTak_Take request and nothing to TAKE. The word reads `0x02010202`, its static value, and its setter
  `0x50bcecb8` (log "[CapThr](all)entryState[0x%08x]"; a byte scan finds only it and the getter naming the word) did
  not run over the start or the idle (X).
- **Why: S-TAKEOVER writes part of the boot take-over (D).** The boot take-over (API 70405, `0x50adffda`, reached from
  `0x501e6adb` -> `0x50ab2309`) sets, for its kind 0, module 9's state 1 and CapThr's word `0x02010202`
  (`0x50ae0004..0x50ae0015`); for kinds 1 and 2, module 9's state 2 and `0x01010202` (`0x50ae0044..0x50ae0055`).
  S-TAKEOVER writes module 9's state 2 alone. The rest of the kinds 1 and 2 path (`0x50ae005c..0x50ae007b`:
  `0x50414b05(1)`, `0x50ac6f6b`, `0x50abe5ce`, `0x50ac6f6b`, `0x50abe4ae(0)`) runs in neither S-TAKEOVER nor
  S-THRTAKEOVER; what it does is not read (?). So after TRA 990 the shooting component's set-up sees state 2 and calls
  CapThr's updateThroughImage (`0x50bd0949(0, 1)` at `0x50c78bc1`, X) instead of starting the through image
  (`0x50bd0467`, 4.1.2), while the guard sees a through image that is not running. Which kind the camera's boot
  takes is S-TAKEOVER's assumption (I).
- **S-THRTAKEOVER (probe, camapp 3).** The word is set to `0x01010202` through its setter before the application
  starts. The guard then passes twice (X: vt[1306]'s call and the case's own vt[111] at `0x50c5cce7`, after vt[110]),
  the case goes on to CapThr (`0x50bd5ff2(16, 1)`, `0x50bd6093`) and vt[1396], and the sequence moves to phase 102
  (X). CapTak_Take's
  Take_Start_Shoot_Ready (log `0x60e667ec`) then calls the take API `0x50417cd9` (API id `0x200dc`): control `0x20`
  at S1 (from `0x50bc7c8e`), `0x40` at S2 (from `0x50bc7b89`) (X).
- **The take API (D, X).** Control `0x20` is none of the API's own kinds (0, 2, 4, 64, 68), so it takes the default
  branch `0x50417f65`, and none of that branch's (16, 8, 128, 256, 512, 1024, 2048, which set the packet's word +8,
  and for 256 the command 6), so the packet's word +8 is 0 (`0x5041800d`) as for any control the API does not list:
  a packet from `0x503eb86c` and an asynchronous request to API target 6, TAKE_EXEC (`0x503eb960`), X:
  `{6, 0xf0050000, 0, packet}` (reply queue API_EVENT, command 0). Control `0x40`
  (`0x50417efd`) posts `{0, 0, 5, 0}` to TAKE_EXEC straight through OlyQeWr (`0x503ebe46`), with no reply queue;
  S-MODACK, which takes only the API sender's posts (`0x503eba07`), would not have seen it.
- **H-TAKEMAIN.** TAKE_MAIN's module init `0x50399619` is the boot stage `0x501e8e84`'s call at `0x501e8f7b`, after
  USTART2's stage word (`0x501e8eac`). It binds TAKE_EXEC (0x5a) and TAKE_POST (0x63) to its flag (`0x60042ffe`) bits
  2 and 4 (`0x5002c285`) and sets its context (state `0x62a3f018` 0, wait pattern `0x62a3f024` 7). The boot stage
  `0x501e94a5` starts TAKE_MAIN (`0x60042dfc`, 107), TAKE_MAIN_CP (`0x60042e0a`, 114) and TAKE_PROXY (`0x60042e16`,
  120) at `0x501e9bbf..0x501e9bdb`. The probe runs the init after H-TAKEINIT and starts the first two; TAKE_PROXY
  stays dormant (nothing asked it, X). TAKE_EXEC leaves S-MODACK. Both tasks wait at once (X); under camapp 1 and 2
  nothing reaches them and round 1's records are unchanged (X, `test_take.mjs`). The record has what TAKE_MAIN takes
  from its mailbox, TAKE_EXEC and TAKE_POST and what TAKE_MAIN_CP takes. S-TAKEREQ answers a request whose reply
  queue is TAKE_POST only where TAKE_MAIN's handler for its token was read (TAKE_FOCUS's `0x300` with token 1, below);
  any other throws.
- **TAKE_MAIN's loop (D).** `0x503996c3` waits on its flag with the pattern `0x62a3f024` and serves bit 1 (its
  mailbox, `0x502ce7c8`, posted through `0x502ce7b7` / `0x502ce703`), bit 2 (TAKE_EXEC, 16 bytes, keyed by the
  command) and bit 4 (TAKE_POST, 12 bytes `{u16 status, token, word}`, keyed by the token; the mailbox uses the same
  table). The keys index the state table `0x605bfbc8`: 20 bytes a state (id, name, entry, command table, reply
  table), tables of `[u16 key, handler]` ended by 0xffff. After each message it steps the state (`0x50399acf`).
  The 35 states are named Idle, RdyStart, RdyFcsRdy1..3, RdyTrig2Wait, RdyFastTrig2Wait, RdyFcsTake, RdyFcsAbort,
  RdyAbort, RdyEnd, Standby, StlRdy1, StlRdy2, StlTake, StlUhs, StlLiveTake, LvCompTake, LvCompEnd, StlEnd1, StlEnd2,
  ContAf, ContAfStop, ContWait, ContEnd, HsContTake, HsContWait, HsContRdy, HsContEndPre, HsContEnd, PixShiftSrEnd,
  DigitalNd, DigitalNdDarkRdy, DigitalNdEnd, PixShiftSrHandHeldEnd. A state's pending bits (`0x62a3f03c`) are set
  through `0x5039a192` and cleared through `0x5039a2bb`. TAKE_MAIN's synchronous request `0x5039a01c` goes through
  TAKE's `0x502ce86d` with reply queue TAKE_IMDFUNC (0xa8) from TAKE_MAIN itself, through the kernel's send from any
  other task. TAKE_MAIN_CP (`0x5039a09e`) calls the function object in a message whose command is 0 and replies.

**S1's take request in TAKE_MAIN (X; S-TAKEREQ answers as in round 1).**

| # | TAKE_MAIN takes | It asks, in order | Waits for | The answer |
|---|---|---|---|---|
| 1 | TAKE_EXEC command 0 (reply queue 6, token `0xf0050000`) in Idle (handler `0x503a1172`) | CPU 3's FACE_FD (queue `0x3002`) command 15, synchronously (from `0x50524a63`) | its status | S-TAKEREQ: 0 |
| | | TAKE_FUNC command 80 (handler `0x5039cf71`) synchronously (`0x5039a01c` from RdyFcsRdy1's entry `0x503c2961` at `0x503c2a32`) | TAKE_FUNC's reply on 0xa8 | native: status 0 |
| | | TAKE_FOCUS command `0x300`, reply queue TAKE_POST, token 1, parameter the record `0x62a4cea8` (`0x503c2ba1`) | token 1 on TAKE_POST | S-TAKEREQ: `{0, 1, 0}` there |
| 2 | TAKE_POST token 1 in RdyFcsRdy1 (handler `0x503c2e8d`, which clears pending bit 1) | TAKE_FUNC command 80 synchronously (`0x503c2eb7`) | its reply | native: status 0 |

Then TAKE_MAIN waits in RdyFcsRdy1 with the pending bits `0x5e` and the wait pattern `0x5` (mailbox and TAKE_POST:
TAKE_EXEC is not read, `0x5039983f`) through S2 and the releases, and nothing reaches its mailbox (X). RdyStart's
entry (`0x503c2742`) logged errlog `0x25001703` once (at `0x503c2803`, where `0x506d96df(1)`, a test of TAKE_FUNC's
context word `0x62a3f148`, decides); what it reports is not read (?). TAKE_FUNC's command 80 did not call the
frame-mode function `0x5039f583`, so S-TAKEFRAME's request is still not reached (X).

- **What RdyFcsRdy1 waits for (D).** Its entry fills the record it gives TAKE_FOCUS with four callbacks, each posting a
  token to TAKE_MAIN's mailbox through `0x502ce7b7`: +0 `0x503c2bac` (token 0), +0x0c `0x503c2bdd` (token 2), +0x14
  `0x503c2bbb` (token 3), +0x18 `0x503c2bcd` (token 5). The state's reply table clears bit `0x04` for token 0
  (`0x503c2bef`), `0x01` for 1, `0x40` for 2 (`0x503c2eeb`) and `0x02` for 3 (`0x503c2f03`, then `0x503a47d5`).
  Token 5 (`0x503c2c3a`) sends TAKE_EXPOSE (the queue at `0x6004327a`, 0x5b) command `0x400` with reply token 11,
  and token 11 (`0x503c2ce6`) clears `0x10`. The entry also registers two functions through `0x5039a5ad`, each run
  once by `0x5039a6e3` (at every state step, `0x50399acf`; 12 slots at `0x62a3f050`) when none of its masks shares a
  bit with the pending words `0x62a3f03c..0x62a3f048`: `0x503c2fbf` once bits `0x01` and `0x40` are clear
  (`0x503c2974`), which moves to RdyFcsRdy2 (`0x50399a89(3)`), and `0x503c2d08` once bits `0x04` and `0x10` are
  (`0x503c2989`), which clears bit `0x08` itself (`0x503c2dc4`) after calling the function at +4 of what token 0's
  message carried (`0x62a4cea4`, `0x503c2db3`), and then, unless the state's command 7 came (`0x62a4ce60`, set at
  `0x503c2f2c`; then state 8, RdyFcsAbort), asks BC_EXEC (`0x600431d6`, 9) command 53 synchronously (`0x503c2df8`)
  and, on conditions not read, the camera driver's request 144 (`0x503c2e21`). So after token 1 RdyFcsRdy2 needs
  token 2, and `0x503c2d08` tokens 0 and 5 (then 11); what waits for bit `0x02` (token 3) is not read (?).
  TAKE_FOCUS's command `0x300` is its case `0x509a107f` -> `0x509a54e1` (command table `0x60a64f00`); which of the
  callbacks it calls, and when, is not read (?). The probe answers none of them, since that would invent the AF's
  progress: the take-ready stops there (X).
- **S2 (X).** CapTak_Take's control `0x40` posts TAKE_EXEC command 5. TAKE_MAIN does not take it (TAKE_EXEC holds one
  message by TAKE's own count `0x502ce6ae`); RdyFcsRdy1's command table would take 5 (`0x503c2f5e`), as RdyTrig2Wait's
  would (`0x503c35e9`). No reply goes to the application for S1's request (X). S-RELSEQ's callbacks run beside the
  native path as before (X).
- **Also seen (X).** The start under camapp 3 with the probe gives TAKE_FUNC commands 0, 13 and 18, then 29 five
  times and 22 twice with reply queues, and one command 29 with no reply queue (parameter `0x62a3f2be`), which asks
  TAKE_POWER_MANAGER_EXEC command 0 synchronously twice (S-TAKEREQ); who sends that 29 is not read (?).

**What S-RELSEQ's retirement still needs (I unless tagged):**
1. The through image's take-over made whole in the default sessions: S-THRTAKEOVER beside S-TAKEOVER (with the rest
   of the kinds 1 and 2 path, `0x50ae005c..0x50ae007b`, ?), or the boot take-over `0x50adffda` itself. Both are every
   play session's, so golden would change; the default camapp mode is still 1, blocked by the imgpro unit `0x9c600000`
   (4.1.5; udf07 and the VSC histogram are in since 2026-11-09, 4.2.1).
2. TAKE_FOCUS's AF for command `0x300`: the record's callbacks (tokens 0, 2, 3, 5) with FCS and CPU 1 behind them
   (4.1.4, class (c)), and TAKE_EXPOSE's command `0x400` (token 11), whose reply's word 2 its handler frees (D), so
   S-TAKEREQ may not answer it with `{0, 11, 0}`. Bit `0x08` follows from tokens 0 and 11 (`0x503c2d08`, D).
3. CPU 3's FACE_FD command 15, answered 0 by S-TAKEREQ: what it asks of face detection (?).
4. TAKE_MAIN past RdyFcsRdy1: `0x503c2d08`'s BC_EXEC command 53 and camera driver request 144 (D), RdyFcsRdy2 and 3
   (reply tokens 3, 12..14 and 4, 15, D), RdyTrig2Wait (which takes S2's command 5), then the still states (StlRdy1
   .. StlEnd2) for the capture, each new neighbour recorded the same way. Then TAKE_MAIN's reply to the application,
   and the notifications that CapTak_Take's observers turn into sequence events (4.1.3), from which the sequence parts
   would post the callbacks S-RELSEQ posts now. None of these is reached (X).

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
  | EMS1 engine (motion and statistics, five areas; om1-subject-spec 2.4) | `0x9bd80000` | 276 (level 5) |
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

#### 4.2.1 The VSC histogram unit (`control camapp 3`, 2026-11-09; D unless tagged, addresses E143's)

- **Why.** Under `control camapp 3` the shooting component's DISPLAY cmd 13 and 14 start the VSC's histogram on the
  TFT channel (`0x501e14a4`: INTEN1 bit 8, HIST1 = 1; X), and the menu's DISPLAY cmd 15 (`0x501d709f`) waits up to
  50 ms for the flag (id at `0x6004303a`) only the run's done callback sets. The lab had no histogram unit, so
  S-HISTWAIT ran that wait to its timeout (4.1.5). The registers, set-up formulas and paths are in
  `docs/om1-vsc-spec.md` section 13.
- **The firmware's path.** Start: the start path `0x501d6bec` sets the run word `0x62a3eaf8`, programs HISTAREA1-3,
  HIST2 and HIST3 (`0x501e127f`), waits for them to latch (`0x501d6e17..a2`) and starts the run. End: the channel's
  ISR takes INTST1 & INTEN1 bit 8 (`0x501dec7d..e4`), posts the done callback `0x501d71e1` to task 16 (`0x501d6a03` ->
  `0x50053505`) and acks bit 8 (`0x501e14fc`). The callback clears the run word, posts DISPLAY cmd 16 to DISPLAY's own
  queue while `0x62a3eabe` is set (OlyQeWr at `0x501d7227`) and sets the flag. Cmd 16 (`0x501d7377`) reads the bins
  (`0x501d70e6` -> `0x501e150e`: n / 2 words at `+0x4000`, n = 128 here, X, each 16-bit bin clipped to the mirror
  HIST3[31:16]), replaces them with 0 and 64 in bin 5 when the written DMAEN bit 5 (IMG1) is clear and HIST2[17:16] is
  0, copies them into the ring `0x62a3cab8` (8 slots of 1024 bytes), posts `{0, 0x04020301, 0}` to queue 6 every
  `0x62a3eb08`-th end and starts the next run on the request's other area. Cmd 15 clears `0x62a3eabe`, so the next end
  posts nothing and no run follows, and waits for that end.
- **Which bins the firmware uses.** The set-up stores in HIST2[17:16] the index of the IMG plane whose DMA address is
  the one it is given, else 0 (`0x501e12e9..66`, D; that the unit counts that plane's pixels is I); the start path gives
  it no address (0), so every run's field is 0 (`0x501d6d3f`, `0x501d6dee..f7`, D) and which plane, if any, the unit
  then counts is ?. The lab shows no IMG plane under camapp 3 (DMAEN 7, X), and with IMG1 off and the field 0 the
  firmware discards the bins it read (`0x501d712d..54`). So no bin value the unit computes reaches a consumer in the
  lab, and none is computed: the model answers those reads 0 (A-VSCHIST-2) and refuses every other (HIST_UNMODELLED).
  What the unit counts, how values map to bins and what HIST3's scale does are ? (`docs/om1-vsc-spec.md` section 13).
- **The model (X, `emu/src/dev/vsc.mjs`).** A write of HIST1 bit 0 arms a one-shot run; A-VSCHIST-1: it measures the
  frame from the channel's next boundary and ends at the boundary after, setting INTST1 bit 8; the IRQ line carries
  bit 8 (`board.vsc.irq_mask` `0x103`; the ISR's branch is D, the line I). A-VSCHIST-2 as above. S-DISPQ runs the done
  callback's cmd 16 as it runs the display manager's requests (`dispq_accept`, `emu/src/lab/play.mjs`; under camapp 3
  only). In a display run lab time stands still, so the menu's cmd 15 wait gets S-HISTEND: the lab clock runs a frame
  at a time to the run's end (at most two), and the wait then runs natively: S-IRQFIRST takes the IRQ, the wait
  blocks, task 16 runs the done callback, the flag is set and the wait returns E_OK.
- **Result (X, `emu/test/test_camapp.mjs` traRoutingSession; `emu/test/test_dev.mjs` vscHistUnits for the device).**
  A run every 50.05 ms (three TFT frames), 40 runs over the start and 2 s of idle, each end's cmd 16 through S-DISPQ
  (39 or 40, the last end's may still be due) reading 64 bin words under A-VSCHIST-2, a queue-6 post every fourth
  end, no HIST_UNMODELLED; the idle's TRA 944, S1 and S2 as before (4.1.5), the OXF events not staying over two passes.
  The menu's cmd 15 wait returns E_OK at the run's end, at most two frames into the wait (1.9 ms after the key in a
  probe run; before: E_TMOUT after 50 ms), and so does the HDMI plug's (`--hdmi on`).
  **S-HISTWAIT is retired**; S-HISTEND moves only the lab clock, as the vsync wait's RUN_TO_FRAME does. What runs next
  (with udf07 in, 4.1.5): the menu stops at the imgpro unit's start `0x5050a7a9` (fault 2, 4.1.5). Default sessions
  do not start the histogram (camapp 1 and 2 leave HIST1 unwritten over the start, S1, S2, the menu and playback, X).
- **Open.** The TFT's composite stays FEATURE_UNOBSERVED once the histogram's registers are written (A13: whether
  they change the mixer output is ?); bins with an IMG plane on are refused, so a live view under camapp 3 would stop
  at its first end; the unit's real time per run (A-VSCHIST-1 sets only the lab's pace); the ring's reader (no literal
  of `0x62a3cab8` but the writer's, I: a computed address), what the application does with `0x04020301`, and what
  OSD_DRAW_CPU2 draws from the bins (4.6).

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

#### 4.3.1 The imgpro unit at 0x9c600000 (`control camapp 3`, 2026-11-09, round 2; D unless tagged, addresses E143's)

- **Why.** Past udf07, `control camapp 3` stopped at `0x5050a7a9`, a write to `0x9c600004` the lab refused (4.1.5): the
  menu's request to the image library's unit 7 at `0x9c600000`. The unit's driver, register map and request kinds are
  in `docs/om1-imgpro-spec.md`.
- **The unit (D; the spec's sections 1-4).** Kinds 13, 14, 16 and 17 (handler `0x5046daa2`) and 6 (`0x5046dc32`) drive
  it, each start (`0x5050a6dd`, `0x5050a73c`, `0x5050a797`, `0x5050a7f2`, `0x5050a85d`) from one call site. A start
  powers the unit up (`+0x004`, I) and writes the kind's parameters, the go `0x5050a8ba` enables IRQ 300 on the calling
  core and writes `+0x028`, `+0x020`, `+0x00c`, `+0x018`; the handler `0x5048bfe3` acknowledges `+0x020` and calls the
  request's callback (phase 12); the issue's wait (`0x50493617`, up to 1000 ms) then runs the end `0x5050a8e1` (X),
  which powers it down (`+0x000`, I). Kind 14 is the fill: mode 4 a linear range (`+0x084`, `+0x390`, `+0x384`), mode 5
  a rectangle of an image (`+0x084` the first row, `+0x0b8` the pitch, `+0x390` the column, `+0x394` the width and
  rows), the value `+0x398`. Kinds 13 (copies), 16 (mode 8, a result in `+0x3b0`), 17 (a scaler, I) and 6 are read only
  as far as their registers: kind 17 writes no `+0x380`, and kind 6's set-up `0x5050b328` also copies parameter blocks
  into `+0x10c..+0x368` and `+0x380..+0x3ac` through a base register (the spec's section 3).
- **The menu's request (X, D).** api_tft's `0x504223a4` fills the through image's bank with RGB 11, 11, 11 through
  `0x5048ef28` (BT.601 to Y 11, Cb and Cr 128) and `0x5048ef01` -> `0x50490c67` (format 3074: the word Y | Cb << 8 |
  Y << 16 | Cr << 24, `0x50490c89..a4`): kind 14, mode 5, the bank at bus `0x98d4d800` (a live-view range), 600 rows
  of 1800 bytes (900 pixels) at a pitch of 11136, the value `0x800b800b`.
- **What else the menu needed (X, D).** (1) The unit's interrupt: the library's init `0x5046d7ab` (USTART2's stage,
  `0x501e91d8`) does not run in the lab, so IRQ 300 was not attached and the go's enable wrote level 0 (attach is
  exclusive, `docs/om1-cores-spec.md` 4); the end was never taken and the wait ran out after 999.3 ms of lab time. (2)
  The image's stage 9: past the fill the OXF main thread's image player (CapImg_ImagePlayer `0x50bad41b` -> api_play
  `0x504067b9` -> the play buffer's `0x50a6c59b`, command `0x300`) sleeps in 2 ms steps until bit 8 of the stages'
  ready word is set (`0x50024de8(9)`), which the boot's per-segment step `0x50024eda` sets and the lab did not; module
  9 has no static constructors (`0x501e6102`). The menu stayed at ID_ST_MENU_ENTRY and later keys were not taken.
- **The model (X, `emu/src/dev/imgpro.mjs`; the spec's section 5).** S-IMGPRO: the register file with the driver's
  behaviour, IRQ 300 high while the end bit and the enable are set, and of the runs only kind 14's fills computed, from
  the words its set-up writes and only for that program (its mode's words and no other parameter word since the last
  start); how the unit reads them is I, the value as a little-endian word at 4-byte aligned addresses (I; a range off a
  4-byte boundary is refused unless the value's bytes are equal), on the bus's memory. Every other operation (kind 6's
  op 3 and kind 17 among them), kind 16's result and a start without its words are refused (a bus error). A-IMGPRO-1: a
  run ends 1 ms of lab time after its start. Under camapp 3 only, at the application's start: H-IMGPROINIT runs the
  init's IRQ attach `0x5048c3a0`, the id bitmap's clear `0x5048ba3a` and the unit's own init `0x5050a6b2` natively (not
  the rest of `0x50481211`, which inits the unit at `0x9c200000` and others, nor `0x5048d57f`), and S-STAGE9 sets stage
  9's bit (as S-BOOTSTAGE and H-AUDSTART set stages 1 and 6). Default sessions never write the unit (X: golden
  unchanged).
- **Result (X, `emu/test/test_camapp.mjs` traRoutingSession 19 of 19; `emu/test/test_imgpro.mjs` 31 of 31).** After
  three passes of S1 and S2: MENU's cmd 15 wait as in 4.2.1, the fill's run (the bank's first and last words `0b 80 0b
  80`), its end taken natively, the unit powered down again; the menu opens (ID_ST_MENU) and closes; PLAY shows
  playback's ID_ST_NO_PICTURE with two more fills of the same bank and PLAY returns; their transactions are the
  components' (4.1.5). Without shots the menu and playback passes repeat (X, twice).
- **Next stops (X).** (1) After the menu and playback passes a pass of S1 and S2 records its picture (the fourth), and
  then no key is taken: MENU's EV_PRESS_MENU_KEY reaches UI_IN, the step sets no GUI event and sends no transaction; the
  same after 5 s of idle, for OK and PLAY. A shot before any menu pass leaves the menu working; the one difference in
  the stand-ins' logs of the two shots is a request on queue 90 at S1 that S-MODACK acknowledges (`{6, 0xf00c0000, 0,
  ...}` to queue 6); what the application waits for is ?. (2) With pictures on the card PLAY shows ID_ST_NO_PICTURE, not
  the newest picture (camapp 1's S-PLAYSEQ / S-PLAYCOMP show it); why the play path decides so is ?. (3) In that
  playback, right fills the other bank (bus `0x9a43e000`, same size and value), and the session stops before any other
  key, within 50 ms of idle after that fill (X, 2026-11-10, each key held 100 ms with 800 ms of idle after it;
  corrected: not at a later left): the OXF main thread's display manager send (`0x503eba00`, timeout -1, D) waits on
  queue 6, full (tsnd_dtq with no timeout; X: task 57's stack holds the returns `0x503eba07` and `0x5002c1f8`).
- **REC and the album manager.** S-JPEGENC keeps REC's header fill (`0x5048ee61` from `0x5054c9d3`, kind 14 mode 4,
  41984 bytes of 0 at `0xab0bd800`): with the hook lifted under camapp 3 the fill ran natively, but rec_jpeg_exec runs
  in S-RECIMAGE's lab call, outside REC_IMAGE's task, and the request's wait blocked the lab task (X: "all tasks
  blocked", rerun 2026-11-10 at the first shot): a plain lab call does not move lab time when every task waits
  (`emu/src/lab/kernel.mjs`, no on_idle), so the unit's end, 1 ms of lab time on, never comes. It needs the call run
  where lab time moves (REC_IMAGE's own task, I, or a call whose idle runs the clock). S-ALBM is unchanged and not
  tried: the DCF numbering mount that would start ALBM_MAIN runs at the storage bring-up, before camapp 3's
  H-IMGPROINIT, and the movie module it asks next does not run (S-ALBM's text). Both texts now say so.
- **What still keeps camapp 1 the default.** The TFT's composite is refused once the components start the VSC
  histogram (A13, 4.2.1), so a camapp 3 session publishes no frames (I: every frame check and golden play scenario
  would fail on that alone); the keys lost after a menu pass and a shot (1 above); playback with pictures (2, 3
  above), which camapp 1's checks (camappSession's PLAY, right, left) need; S-JPEGENC and S-ALBM. The golden diffs a
  camapp 3 default would cause are not measured (I: every play session's instruction counts and stand-in lists change:
  H-IMGPROINIT and S-STAGE9 at the start, S-TRAACK gone; S-BOOTDONE and S-OUTDEV are not camapp 1's).
- **Open.** The unit's time per run (A-IMGPRO-1) and the value's phase off a 4-byte boundary; kinds 13, 16, 17 and 6;
  the meaning of the power, stop and control words (I); the three next stops above.

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
  | `0x9b980000..0x9b98021c` | 121, at `0x502c0ea5..0x502c2193` | 14 (3), `0x502c12c0`, attach `0x502c0e79` | lens serial controller (I from the LENS_SSC strings); status `+0x08` W1C; clocks 5 and 17 via `0x50061c3a` (4.4.1) |
  | `0x9b883e40..0x9b883e6c` | 12, at `0x50122331..0x501225b7` | 60 (3), `0x5012232e` | edge-interrupt unit beside pins 108..113; four event bits dispatched as (channel, edge); callbacks called from the lens sync layer `0x502c4e5f` |
  | `0x9bf00000..0x9bf0076c` | 24 in FCS `0x50957687..0x5095799e`, plus `0x5002563b` and `0x502c0e99/9f` | 281 (3), `0x5095798f` | a DMA-driven unit used by FCS, clocks 36 / 37 / 48 (function ?) |
  | `0x9b400000..0x9b401808` | 150 | 38 `0x501616f7` | contrast AF evaluation |
  | `0x9b480000` | 40 | 39 | PFP, the phase-detect pixel path (I) |

- **External chips:** the lens MCU over the serial device and the IRQ 60 edge lines (its firmware is not in the body
  `.BIN`); an IS controller with its own firmware and update path, reached through the generic PER_SIO driver
  (`0x5005f49f` from `0x50144f14`) and GPIO helpers in the `0x9b880000` pin block, on a SIO channel not decoded (?).
  The gyro sits on the IS side (I): the body sees offsets and zero tables, not raw samples. No E143 block holds the IS
  controller's firmware (`blk0e560000` is the SCPU's, `docs/om1-scpu-spec.md`).
- **The BC driver (D):** BC_MAIN, BC_INDICATOR, the `bc_ssc` serial link, `bc_stab` / `stage` / `blc_sync`; 34-42k
  instructions in `0x5012d000..0x50152000`.
- **Seams:** the lens at its device (seam C: one external MCU, one serial device, the record layout already D, and
  S-LENS shows its consumers run natively); AF at the module seam TAKE_FOCUS / FCS_EXEC with a scene-driven result and
  the AF info block written as the module writes it; IS at BC_EXEC. Seam C advances only as far as the parsers make the
  expected answers readable; an unknown packet stops with an error. Native FCS (the AF data path) is LLE-scale work:
  it needs CPU 1, the sensor pipeline and the `0x9bf00000` unit.
- **First step (done on E143, 4.4.2; the default since 2026-10-29):** the serial layer is read (4.4.1) with the table
  from a lens command id to its frame; LENS_MAIN, LENS_COMMAND and LENS_ASKDATA run with `0x9b980000` as a device
  model whose far end, S-LENSMCU, refuses the first frame it does not know; the camera application's touch path runs
  with it (4.4.2, the touch). E146 and E147 run it too, their default since 2026-10-29 (4.4.3). Next: the lens's own
  replies in place of S-LENSMCU's assumed values (which would also settle the lens-ready byte); the E144 family's lens
  driver, another lineage's (4.4.3, Open).

#### 4.4.1 The lens serial layer (D unless tagged)

- **Open and reset:** `0x502c0e4e` attaches IRQ 14 at level 3 (`0x50053f76(14, 3, 0x502c12c0)` at `0x502c0e79`),
  turns on clocks 5 and 17 (`0x50061c3a`), clears `0x9bf00000` and `0x9bf00068`, then `+0x000` = 0, `+0x204` = 1,
  `+0x004` = 0; the same three writes reset the controller before each command (`0x502c0ec2`, `0x502c112e`,
  `0x502c100a`). `0x502c0ec2` also packs five configuration nibbles into `+0x010`. The mount pins 153..158 and 180 are
  switched between two functions around a transfer (`0x502c1690`, `0x502c1736`, `0x502c1787`; pin helper
  `0x502c2ba6`; which function each mode is, ?).
- **The command packet (pointer `(0x6296d180)`, the active one also at `(0x6296d1a4)`):** `+4` the completion
  `fn(d0 = status bits)`, `+8 u16` a speed index (`0x502af75a` -> table `0x6296cd24`, its `+2` into `+0x030`), `+10` the
  class byte and `+11` the code byte (with `+12`, `+13` the four header bytes written little-endian to `+0x048`),
  `+14 u16` the data count (`+0x054`, 1 written as 0), `+16` / `+18 u16` timing values (`0x502c1c55`), `+20` 1 = send
  with interrupts masked, `+28` into `+0x03c`, `+29` a DMA count into `+0x018` with `+32` the DMA address into `+0x020`
  (bits 6 and up, `0x502c1a6d`) for the classes `0xb0`, `0x70`, `0xc0`, `0x80` and some `0xf0` / `0x90` codes, `+44`,
  `+52` a time stamp for command `0x70 0xc8`, `+56`. The class picks the mode word `+0x034` through the table
  `0x602f384c` (classes `0x60..0xf0`: 33, 14113, 1057, 33 or 81, 9761, or a function). Sends: `0x502c112e` (from
  `0x502c4c2f`) and `0x502c100a`; both set `+0x00c` (959, or 5055 for `0x70 0xc8`), load the header (`0x502c17d5`) and
  start with `+0x038` = 1. Register roles beyond these writes are ?.
- **IRQ 14 (`0x502c12c0`):** reads `+0x008`, writes the value back (W1C) and ORs it into `(0x6296d1a8)`. Bit 9 stops the
  transfer (`0x502c13ba`: `+0x018` = 0, `+0x038` = 0, `+0x004` = 17); bits 2 and 3 call one-shot callbacks
  (`(0x6296d18c)(0x6296d188)`, `(0x6296d19c)(0x6296d198)`); bits 10..13 with command `0x70 0xc8` store the microsecond
  timer (`0x502c2dce`) in `+52`; bits 0, 1, 4, 5 map to the error bits 1, 2, 4, 8 (`0x502c13ec`); bits 11, 12 with bit 7
  lead to `0x502c1ea7` for the DMA classes. The command completes when an error bit is set, or bit 7 is set and either
  bit 8 is set or no DMA is pending: `+0x008` = `0x3ff3`, then `0x502c1523` calls `+4` with the error bits, plus `0x40`
  for a class-`0xc0` command with `+44` = 0, and keeps the class and code in `0x6296d1b0` / `0x6296d1b1`.
- **The command history (`lens ssc log`, printer `0x502c5ede`):** 100 records of 20 bytes in `0x6296d834..0x6296e004`
  (read pointer `(0x6296e004)`, write pointer `(0x6296e008)`, count `(0x6296e00c)`): `{u32 command, u32 the previous
  end, u32 start, u32 status, u32 end}`, times from the microsecond timer `0x502c2dce`; the command word is 0 for
  "initial", 1 for "finalize" or the four bytes at the request's `+18..+21`, by the request's `+14` (1, 2, 0;
  `0x502c5d11`). The writer `0x502c5def` runs only with `(0x6296d830)` bit 2 set ("LENS_SSC_DEBUG_COMMAND"); after the
  first record whose status is neither 0 nor `0x6cf0` it keeps 39 more and stops. The last command, its execution and
  response times are kept in `0x6296e014..0x6296e024` ("LAST COMMAND INFO").
- **The init steps `0x50122abf..0x50122f2b`:** a chain of continuations; each posts a lens request through
  `0x502a8f4b` -> `0x502a8f54` with `+16` = 6, `+18` = 1, `+20 u16` the command id, `+22 u16` a sub-code and `+160` the
  next step (a run-time code address), or skips to a later step by a test. Ids in order: 91 (only when the lens
  version `0x502af742(0)` >= `0x130a` and the record's `+1096` bit 31 is set; otherwise the chain starts at 7), 7, 71
  (unless `0x502b0bce` finds the lens's four bytes at record `+1100` among the 13 `{u32 id, data}` entries of
  `0x60214d4c`, in which case it copies that entry's data into the record from `+9445` on), 76 (version >=
  `0x101a`), 77, 79 (record `+1096` bit 22), 80 with the sub-codes `0x1801`, `0x0c01`, `0x0301`, `0x0b02`, `0x1f01`
  (each behind a function-flag test `0x502af9ce(1, mask)` or a version >= `0x120a`), 85 (bit 25). The functions these
  steps call (`0x502af742`, `0x502afa2b..0x502afbac`, `0x502afe5a`) are predicates on the lens record `(0xa32caa8c)`
  that earlier replies filled, not response parsers. The table from a command id to its frame and the parsers that
  fill the record from the replies are read in 4.4.2.

#### 4.4.2 The lens on the mount natively (E143, the default since 2026-10-29; E146 and E147 in 4.4.3; D unless tagged)

E143's lens runs natively (opt-in from 2026-10-28, the default since 2026-10-29; `OM_EMU_LENS=stand-in`, a host's
`env.lens` 'stand-in' or the page's `?lens=stand-in` takes S-LENS instead): LENS_MAIN, LENS_COMMAND and LENS_ASKDATA,
the lens driver, its sync layer, LENS_SSC and IRQ 14, and the deferred calls the power and detect paths post. The seam
is the lens serial controller's registers (`emu/src/dev/lensssc.mjs`) with the lens's microcontroller at its far end
(S-LENSMCU, `emu/src/lab/lensmcu.mjs`); the lab's part is in `emu/src/lab/lens.mjs` (model facts `lens_native`,
`emu/src/fw/models.mjs`; the driver's addresses by the rule `lensDriver`, fact `lens_driver`, `emu/src/fw/facts.mjs`;
board facts `lens` and `dpc`, `emu/src/fw/board.mjs`). S-LENS stays selectable and the only lens on the bodies other
than E143, E146 and E147 (4.4.3).

- **The controller (`0x9b980000`, IRQ 14):** a frame engine. The driver writes the header to `+0x048` (class, code, two
  parameter bytes), the data count to `+0x044` with its bytes in the transmit FIFO `+0x05c..` (only for the modes 9761
  and 22561: `0x502c11e3..0x502c122b` loads them for exactly those frames and leaves the count in place for the
  others), the mode word to `+0x034` (7 for the initial frame, `0x502c10b8`; the class table `0x602f384c`'s 33, 81,
  1057, 9761, 14113, 22561, 37921), a DMA count and address to `+0x018` / `+0x020` (bits 2..28 the address >> 6,
  `0x502c1aac..0x502c1ac9`), and starts with `+0x038` = 1. The reply is taken from the receive FIFO `+0x0e4..`
  (`0x502c1f5e`) or memory, its length from `+0x040` (less one for the classes `0x8x` and `0xcx`, `0x502c1ea7`). The
  model ends a frame at once with status bits 7, 8 (a DMA count) and 11 (data) (A-LENSSSC-1, I: the handler's
  completion test `0x502c1390` and copy `0x502c144d`); `+0x01c` = 1 aborts a DMA and raises bit 9 (I: the abort
  `0x502c15a5` leaves the rest to the handler's bit-9 path `0x502c13ba`; X: without it a lens unlocked during a poll
  stays pending). Two units the lens path writes a few words of are storage: the FCS unit's `+0x000` / `+0x068`
  (`0x502c0e99`, `0x502c0e9f`) and the mechanism unit `0x9b900000`, which the attach powers (`0x502c86bb` ->
  `0x5010fd7a` -> `0x501090e9` -> `0x5010b937`, `0x5010b996`).
- **The detect pin and LLPSW:** pin 172 (GIO word `0x9b882c80`, bit 4) reads low with a lens on the mount (the poll
  `0x502c0b1f`, the power-on `0x502c0a8f` / `0x502c0ad4`). The lens power-on path `0x502c091e` powers the lens when
  `0x5014c015(0x121c)` answers 1, which UI_IN's LLPSW (group 1 byte 1 bit 4) gives released; its edge callback
  `0x502c09b1` (registered via `0x5014c420`, dispatched by UI_IN `0x5014c640`) detaches and re-attaches the lens (X:
  pressed, the data-valid and attach flags go to 0 and the aperture shows `-.-`; released, the whole start runs
  again). With the native lens the lab's idle image has LLPSW released.
- **Deferred calls (IRQs 53..58, trigger words `0x9b880044..`):** the posts `0x500503cf` / `0x500503d4` (IRQ 53),
  `0x5005043f` (54), `0x500504aa` (55), `0x500504d9` (56) put a call on a ring of 32 (`0x50050508`), enable the IRQ
  and write 1 to its word; the handlers (`0x50050539..`) run the ring; the init `0x50050279` runs before the kernel
  (boot `0x50000270`). A word written 1 holds its IRQ high until written 0 (A-DPC-1, I; `emu/src/dev/dpc.mjs`).
  Since 2026-10-29 a rule reads the init, the words and the IRQs on every body (`emu/src/fw/facts.mjs` deferredCalls:
  the E144 family's six words at `0x9b800030..0x9b800044` with IRQs 29..34, X), the E144 family's board has the
  triggers, and H-DPCINIT runs at every play bring-up without the native lens too (`emu/src/lab/play.mjs`); E132's
  start is the one that posts (`docs/model-survey.md` finding 21).
- **The lab's part:** H-DPCINIT (the deferred-call init), H-LENSINIT (the module init `0x502a5d10`, boot call
  `0x50024ab6`; USTART_L's cache load `0x502a6371`, `0x5002420e`; the task variables `0x502a5dff`, `0x50024222`; in that
  order, since the module init `0x50125747` clears the ready byte `0x6296d206` the load sets; then the three tasks),
  S-LENSNAND (flash area 6, the lens caches, 7 x 256 KiB from `0x416e0000`, table `0x602a4a24`: erased, writes kept
  for the session), H-LENSON (TAKE_FUNC's camera-on request to LENS_EXEC, `0x502cd9c7..0x502cd9f2`, posted with no
  reply queue). The start then runs in about 30 ms of lab time (X).
- **Requests to frames:** the request executor `0x502a945c` turns a job into a frame through the type table
  `0x602f2fdc` (type 3 `0x502b861d`, type 5 `0x502ba64e`, type 6 `0x502ba920`) and the sync layer `0x502c4c2f` sends
  it (`0x502c112e` / `0x502c100a`). Type 6 maps a command id to (class, code) through `0x602f33bc`: 0 `b0 f2`, 1 `d2 f6`,
  2 `d1 f8`, 3 `d1 f9`, 4 `d1 fa`, 5 `b0`/`b1 fe`, 6 `a0 f5`, 7 `c2 f3`, 9 `c0 f4`, 16 `d1 e1`, 17 `a0 e2`, 18 `d2 e6`,
  19 `d1 e8`, 20 `d1 e9`, 21 `a0 eb`, 22 `c0 ea`, 32 `d2 f0`, 33 / 36 `d2 f1`, 34 / 37 `81 f1`, 48 `d2 e0`, 64 `c3 f0`,
  65 `c1 f2`, 66 `c1 fc`, 67 / 68 `c2 f5`, 69 / 75 `c1 80`, 70 `c1 12`, 71 `c1 fe`, 72 `b1 ff`, 73 `b1 88`, 74 `b1 89`,
  76 `81 e4`, 77 `c1 01`, 78 `c1 20`, 79 `c1 d0`, 80 `c1 02`, 81 / 88 `c1 00`, 82 `a0 42`, 83 `81 10`, 84 / 90 `81 e3`,
  85 `c1 f7`, 86 `c2 f7`, 87 `c1 ff`, 89 `c1 2f`, 91 `c1 d6`, 96 `c2 e0`, 97 `c1 e2`, 98 `a0 80`, 99 `b1 09` (8 is
  built by code); `d1` / `d2` stand for `c1` / `c2` when the protocol version test `0x502af723` holds, else for a class
  the block mode picks (`0x502ac8b4`). The sub-code's two bytes are the header's parameters.
- **Replies to the record:** the parsers are dispatched by command id at `0x502bacaf`: 1 / 18 `0x502af357` (version,
  clock), 9 / 22 `0x502ac85f` (block mode), 3 / 20 `0x502af58d` (ID, serial, firmware version), 80 `0x502b1522`
  (function words), 64 `0x502affc2` (the characteristics: name, zoom steps, focal lengths, the zoom entries at record
  `+1164`), 7 `0x502acbd1`, 71 `0x502b0b7d` (skipped for the 13 lenses of `0x60214d4c`), 76 `0x502b114c` (table
  `0x60216758`), 77 `0x502b120a`, 78 `0x502b123e`, 79 `0x502b1359`, 89 `0x502b10a9`, 69 / 75 / 81 / 84 / 88 / 90
  `0x502b263d` (the state: status, zoom step, aperture). The field layouts are in `emu/src/lab/lensmcu.mjs`.
- **The start's frames (X):** the wake-up (header 0, mode 7), `b0 f2`, `c0 f6`, `c0 f4`, `a0 f5 [01 00]`, `c1 f9`,
  `c1 02`, `c3 f0 [00 01]` (1147 bytes), `c2 f3`, `c1 fe`, `81 e4`, `c1 01`, `c1 2f`, `60 f0` with 5 data bytes, then the
  state `c1 80 [00 06]` about every 100 ms. The record then holds the 12-40's ID, name, 8 zoom steps, 12..40 mm, status
  `0x8000`, the zoom step and the aperture, and the driver derives the 35 mm focal lengths 24, 80 and 50 mm
  (`0xa32d4bb0..b8`) natively; the zoom ring moves the step the state reports (X: 40 mm gives step 7 and 80 mm).
- **S-LENSMCU's values:** the 12-40's identity, name, focal lengths and apertures are S-LENS's (I); everything else is
  0 (A-LENSMCU-1), the protocol version 0x130a with no block mode (A-LENSMCU-2), one byte a zoom step in id 71's table
  (A-LENSMCU-3; with none, `c1 fe` with no data is logged as error `0x40`, `0x502c1558`, X). A frame it does not know
  stops the session with the frame named.
- **The touch (2026-10-29):** until then a touch on the shooting screen left the camera application forwarding no key
  (no `0xf001` for OK; MENU and the mode dial published no frame) with the native lens. The waiting task is the
  application's event task (entry `0x5108ba1b`, task 165 in the lab; X: its stack and a trace): it takes the touch
  events `0x03000072..78` (TOUCH, LONG TOUCH, RELEASE, TAP, SLIDE, DOUBLE TAP, FLICK, the kinds 1..7 of S-TOUCHMAP,
  `0x5108ba30`), posts each to the GUI as index 109 with its kind and position (`0x5108b827`), and waits forever on its
  reply queue (`0x5108bd42` -> `0x50b01d55`, timeout -1) for the GUI's answer `0x0400001f` (`0x5108bb97`), which is the
  GUI's event 35 through the CA caller `0x51084994` (PostEventToCA, return `0x5124f6ae`: input spec, S-CAFWD), with
  the GUI's result (55 for a touch on the shooting screen, X). S-CAFWD answered event 35 with 0 and passed nothing on,
  so the task never got its answer and forwarded no key after it. With S-LENS the task never forwards: it skips the
  forward while its touch inhibit mask `(0x603660b4)` is not 0 (`0x5104d642`, `0x5104ce64`: 259 entries of the mask
  table `0x612c4714`, {event, condition, set or clear, bits}), and the mask keeps bit 20 while the application's
  condition 30 is false (entries 185 and 186), which follows the lens's attach (X: false with S-LENS, whose record and
  flags do not turn it on, and with the native lens detached by LLPSW; true with the native lens attached, from its
  start's event). So S-TOUCHMAP and S-CAFWD stood in for a forward that S-LENS turned off; with the native lens the
  application forwards the touches itself and they do not apply (`emu/src/lab/play.mjs` app_touch: no lab post, the
  GUI's answers taken natively and recorded). X: a touch and then OK opens the Super Control Panel with the frames of
  S-LENS's session, S1 returns, the GUI's two answers per tap; the shooting screen's icons answer as on a camera: the
  wireless icon (90, 30) opens Wi-Fi Connection (GUI `0x0b02`), the touch-mode icon (35, 465) turns to its next mode,
  where with S-LENS's lab posts the screen stayed (the players' page check B6 now taps the touch-mode icon).
- **What changes against S-LENS (X, 2026-10-29):** the screens are S-LENS's but for what the application does with
  the lens module's state event `0x04060051` (published by `0x502a765c` through the ring), which S-LENS never sends:
  about 120 ms after the start's screen the application, now knowing the lens attached (condition 30), leaves the
  date prompt for the shooting screen (S-LENS keeps the prompt until S1) and shows the focal length, 25 mm, on it for
  a while (x 155..222, y 502..529 of the TFT; again after the menu and playback return to it); the +/- button opens
  SETVAL (GUI `0x0202`) where with S-LENS the shooting screen stays; touches go through the application (above). The
  settings, the exposure (shutter, aperture, ISO), the AF frame and every other screen are the same. The devices see
  the lens's start (14 frames in about 30 ms, IRQ 14 and the deferred calls' IRQs 53..58) and its state poll about
  every 100 ms; the ACC_MAIN cycle around the event takes 129 ms where the others take 81..102 (check_level L2 now
  measures from 500 ms after the start). Sessions without the camera
  application show the focal length 25 mm where S-LENS, which only runs with it, leaves `---`. Whether the camera
  leaves its date prompt on the lens's event is ? (on the camera the lens's start may finish before the prompt shows).
- **The lens-ready byte `0xa32d4b94`:** written 1 only by the state poll's completion (`0x502c38c7`: `0x502c3946`,
  `0x502c3a18`; also `0x502c3fa5`: `0x502c4033`, `0x502c40b1`), when the driver's predicates on the lens hold:
  `0x502c41ba` (`0x502afe5a`: the lens ID's byte 0 is 0 and byte 1 is not; then by the protocol version the function
  word 2's bit 5, `0x502afb5a`, and record `+119244` bit 5 clear) and `0x50126ec0` (function word 2's bits 4 and 5,
  `0x502afb4d`, `0x502afb5a`); else it writes 0 (`0x502c3608`, `0x502c41b1`). S-LENSMCU's ID (S-LENS's, `00 00 19 10
  00 00`) has byte 1 0 and its function words are 0 (A-LENSMCU-1), so the byte stays 0 natively (X: every poll takes
  the not-ready path). The 12-40's real ID bytes 0..1 and function words are ?, so S-LENSMCU does not invent them; the
  AF frame on S1 shows regardless (X). It is not the touch's cause (the touch hangs with S-LENS's 1 written back, X).
- **The heap's growth (fixed 2026-10-29, in S-TRAACK):** S-HEAP's live blocks grew by about 5 a second on the idle
  shooting screen with either lens (X: 73 blocks of 40 bytes in 15 s, natively and with S-LENS). The cause (D):
  OlyHfwOpeShoot::getHistogramData (`0x50ada57e`) builds a transaction on its stack (`0x50af7bed`), allocates a 40-byte
  request (TRA 944: operator new `0x50d9ba46` at `0x50ada615`, the constructor `0x50ac0be0`, vtable `0x60de1a98`) and
  hands it to the exec (`0x50af7cbe`), then destroys only the transaction (`0x50af7c19`); the exec consumes the request
  (4.1.2: it deletes it through its vt[1] where a local handler took it or no receiver is there, and hands it to the
  receiver on the remote path), which S-TRAACK, answering the exec with 0, skipped, so nothing freed it. S-TRAACK now
  deletes the request through its vt[1] natively before it returns 0, as the exec does (I: that the receiver deletes it
  once dispatched); vt[1] (`0x50d9a1ee`) frees an event only when its delete-after-consume word `+8` is set (else it
  keeps it, as the exec would), through vt[0] (the destructor, `0x50ac255c` for TRA 944) and operator delete
  (`0x50d9ba32` -> free `0x5000300e`). X: from 10 s to 25 s of idle no block allocated stays allocated, with the native
  lens and with S-LENS (S-TRAACK deleted the requests, about 5 a second; `emu/test/test_camapp.mjs` heapSession, whose
  check fails with the deletion taken out: 73 blocks); S-LENS's session keeps five blocks it allocates in its first 10
  s (68, 192, 968, 2536 and 6416 bytes, the same at 30 s). Other stand-ins that take an object: S-MEDIA hands its events
  to the reception's own synchronous slot, as the firmware's senders do (CapMed's 711 at `0x50bb8a23..30` deletes
  nothing after it), so they stay the firmware's.
- **A workload's blocks (2026-11-08):** a pass is S1 and S2 (a shot and its rec view), the menu opened and closed,
  playback shown and left and 2 s of idle (`emu/test/test_camapp.mjs` heapWorkloadSession). S-HEAP records each
  block's malloc caller and the task that allocated it (`heap_owner`, `src/lab/play.mjs`); an operator new
  (`0x50d9ba46`, `0x50d9ba1e`) leaves its own caller at sp + 8 (X). Before the fix below each pass left 34 of its
  allocations live and the live count grew by 33 (X, the default session); by kind, over passes 1 to 6:
  - **Kept by the lab, fixed: 6 of 192 bytes a pass**, the display manager's request buffers: a request slot
    (`0x62a605f0` + 56 x slot, 255 of them) gets a 192-byte buffer from malloc at `0x503eb91b` (2112 bytes at
    `0x503eb906` for the other kind), which the reply handler frees (`0x503ebae0`, free at `0x503ebb3f`, D) when the
    reply, id `0xf0000000 | slot << 16`, reaches the application's event task (task 164, entry `0x50abbf0c`) through
    queue 6 (its read at `0x503ebf63`; `0x503ea264` takes the replies, D). The DISPLAY loop sends that reply from
    S-DISPQ's run (`0x501c490c`, `0x501c496d`), and S-DISPQ recorded it and returned E_OK, on the assumption that no
    task reads queue 6; with the camera application running, task 164 reads it (X: 64 reads by the second pass). Now
    S-DISPQ's replies go to their queue after the step, each with a settle, from S-CAMAPP's pump (`src/lab/camapp.mjs`),
    as S-MODACK's do: no 192-byte block stays (X; the test's control, the replies recorded only, keeps 6 a pass).
    Delivered at S-DISPQ's own call instead, the reply readied task 164 inside the DISPLAY run, whose OlyQeRd stand-in
    then refused its read (X). That the camera's reply comes before the requester's next step is I.
  - **Kept by the firmware, bounded (X: flat over 6 passes):** the event task's parked replies, 16 bytes each
    (`0x50abc23c`, built at `0x50abc24b`: {id, parameter, the reply counter}), for a reply no listener takes; it frees
    one when 10 later replies have come (`0x50abc2e7..f4`, then `0x50abc33f`) and the oldest when the list is full
    (`0x50abc2a2`, D). X: 10 of them from the second pass on (ids `0xf007..0xf012`), two replaced a pass. Also three
    32-byte records from `0x50ab8bb5` (words 3, 11, 29; one replaced a pass, freed by tasks 16 and 165), one 16-byte
    object of vtable `0x615a3c28` (`0x5125bfeb`) and one 80-byte block through `0x50d9ba25`, each replaced a pass, and
    the first pass's one-offs (two of 7648 bytes, 6416, 2544, 1648, 976, 256 twice, 224 twice and smaller ones).
  - **Kept because a module does not run (X: 22 a pass, unbounded):** 21 events 294 (28 bytes, vtable `0x60ef3504`,
    built at `0x50d7e10b` in `0x50d7e0f4` and passed to the vt[1] of the object at its +20, `0x50d7e132..37`) and one
    32-byte event of vtable `0x60dcb42c` (operator new at `0x50ae1278`, its constructor `0x50ab79c2`, posted through
    `0x50b78bfe`), from tasks 165 and 168. They go to reactives of the OXF main thread, task 57 (entry `0x50ab2293`),
    which is dormant in the default session (X: DMT). With the HLS components (control camapp 2) it runs and frees
    them: every one goes, freed by task 57 through the event's delete (return addresses `0x50d9a1d9`, `0x50d9a218`,
    `0x50d9cb3b`, `0x50d9cc32`, X). In camapp 3 (4.1.5) they do not stay either over passes of S1 and S2 (X); its
    menu stops at the imgpro unit `0x9c600000`, so a full pass is not measured there.
  - **Kept behind S-RPC, open (X: 5 a pass, with and without the components):** the 72-byte request object (vtable
    `0x60de54e8`) `0x50ac722a` builds (operator new at `0x50ac723d`, its constructor `0x50ac7291` sets its own-delete
    word +20 to 1) and hands to its method `0x50ac734c`, which S-RPC answers 0 at its entry. The method's no-channel
    path (`0x50ac7381..98`) returns 0 too and deletes it through `0x50ac72e3` (operator delete when +20 is set); a
    send's failure completes it through `0x50ac7eba`, which sets +20 again, and deletes it (`0x50ac743c`). On the
    synchronous path the method clears +20 before it posts (`0x50ac73dd`) and keeps the object after its wait; the
    reply's handler (vt[2] `0x50ac744e`, reply 425) signals the waiter and sets +24, not +20. So no code of this class
    frees the object after a reply (D); whether the receiver does, by a route not read, is ?. S-RPC leaves it: freeing
    it would be the no-channel path's choice, which the lab cannot show the camera takes.
  - **Not a heap block, open:** the seventh pass ends in the lab's blocked-send guard, with or without the fix: at
    PLAY up task 165's request to queue 6 (`0x503eba00`) waits on a full queue while task 164's last receive was on
    queue 6 (X); why the queue fills is ?. The test runs five passes.
- **Open:** S-LENSMCU's assumed values (A-LENSMCU-1..3) and the lens's real replies (its flags, function words,
  tables, version, the ID's first bytes and the check byte's value) are ?. E146 and E147: 4.4.3. The E144 family and
  E118 have no `lens` board fact and no `lens_driver` fact: they keep S-LENS.

#### 4.4.3 The lens on E146 and E147 natively (2026-10-29; D unless tagged)

Since 2026-10-29 the native lens is E146's (OM-1 II) and E147's (OM-3) default too (`emu/src/fw/models.mjs`
`lens_native`), as on E143 (4.4.2), with S-LENS selectable the same way (`OM_EMU_LENS=stand-in`, `?lens=stand-in`).

- **The addresses, by a rule.** The lab's lens takes the driver's entry points, queue, flags and cache area from the
  body's fact `lens_driver`, which `emu/src/fw/facts.mjs` `lensDriver` reads at the port's places of E143's CPU 0 kcb,
  OlyTaSt, OlyQeRd and LENS_COMMAND's queue word (E143's values are `LENS_DRIVER_E143`, the hand values
  `models.mjs` gave before): LENS_MAIN and LENS_ASKDATA by the boot's starts that load their names after OlyTaSt, the
  module init by the call before them, LENS_COMMAND as the static task that runs to a receive on its queue, LENS_EXEC's
  queue as LENS_MAIN's first receive, the cache load and the task variables by USTART_L's two calls (the second's
  function ends right before LENS_MAIN's entry), the data-valid and attach flags by their four accessors before the
  record getter's first call, the lens-ready byte by its getter and clearer before the predicate the state poll's
  completion calls, and the lens caches' NAND by the flash area driver's table. The deferred-call init is fact
  `dpc`'s, the NAND read operation fact `storage`'s and LLPSW's bit the body's UI_IN tables' (`play.mjs` CONTROLS);
  TAKE_FUNC's camera-on command is 1 on all three (`mov 1,d0; mov d0,(24,sp)`: E143 `0x502cd9d1`, E146 `0x502e579d`,
  E147 `0x502f7063`, each before its post to the queue the rule reads). The rule reads:

  | | E143 | E146 | E147 |
  |---|---|---|---|
  | module init, cache load, task variables | `0x502a5d10`, `0x502a6371`, `0x502a5dff` | `0x502bcfa8`, `0x502bd609`, `0x502bd097` | `0x502ce868`, `0x502ceec9`, `0x502ce957` |
  | LENS_MAIN, LENS_COMMAND, LENS_ASKDATA | `0x502a5e37`, `0x50115a08`, `0x502a8193` | `0x502bd0cf`, `0x50115a08`, `0x502bf42b` | `0x502ce98f`, `0x5011f82d`, `0x502d0ceb` |
  | LENS_EXEC's queue word | `0x60043220` | `0x6004325e` | `0x600431d0` |
  | flags: data valid, attach, lens ready | `0xa32d4b98`, `0xa32d4b9a`, `0xa32d4b94` | E143's | `0xa32d3d30`, `0xa32d3d32`, `0xa32d3d2c` |
  | the lens caches' NAND | 7 x 256 KiB from `0x416e0000` | E143's | E143's |

  E146's and E147's are as read in their code (D: the boot's starts at E146 `0x50024b7e` / `0x50024b9d` and E147
  `0x50024afd` / `0x50024b1c`; the flags' accessors from E146 `0x50126ccb` and E147 `0x50130af0`; the ready byte's
  store E146 `0x502db176`, E147 `0x502eca36`; the area tables E146 `0x602b9f84`, E147 `0x602cb290`, E143's seven rows),
  and `emu/test/test_facts.mjs` checks the rule against them (LENS_DRIVER_FOUND) and the map's places of the flags and
  the queue word, which S-LENS and the camera application use, against the rule's (equal on both). 4.4.2's port gap
  was smaller than it read: E146's flags and E147's OlyQeWr lie at E143's addresses, which the port does not list, and
  only the task entries, which no lab literal named, had no place. The rule finds no `lens_driver` on the other 15
  bodies (X): on E144, E139, E134, E137 and E125 the boot starts LENS_ASKDATA but not LENS_MAIN in E143's shape, E142
  and E140 have no lens-ready byte of that shape, E133 and E130 no module init call before LENS_MAIN's start, the E118
  family no task-variables call before LENS_MAIN's entry, and the bodies with a built-in lens (E145, E129, E132) no
  start of LENS_ASKDATA so.
- **Where the drivers differ (X: a walk of each function from the map's place, instruction by instruction).** LENS_SSC
  (`0x502c0e4e..0x502c2193`: the open, the reset, the sends and IRQ 14's handler), the edge unit's handler and
  callbacks (`0x5012232e..0x501225c0`), the init chain (`0x50122abf..0x50122f2b`), the lens power-on and detect paths
  (`0x502c091e..0x502c0c00`) and type 6's frame switch (the table `0x602f33bc`'s 100 cases at the same offsets from the
  first, their code equal over 741 bytes) are E143's on both bodies but for the addresses of the driver's variables,
  the displacements of calls to moved callees, the debug log's line numbers (`mov 60,d0` -> 70 in the init chain's log
  calls, `mov 745,a0` -> 749 in a send's) and, in the send `0x502c112e`, the order of a `clr d2` and the stores after
  its trace call. The frames, command ids and classes, the controller's base `0x9b980000`, IRQ 14 at level 3, the edge
  unit at `0x9b883e40` and the deferred calls' words and IRQs 53..58 are E143's (the edge unit is not modelled: no
  frame of the start reaches it, as on E143). The built-in lens tables `0x60214d4c` and `0x60216758` differ in their
  pointer words only (a byte compare at the map's places). LLPSW is E147's own: bit 6 of group 1 byte 0 in its UI_IN
  tables (E143's and E146's bit 4 of byte 1); with E143's bit the lens never powered on (no frame in 1 s of the start),
  so the lab takes the bit from the body's tables.
- **What runs (X, 2026-10-29).** Each body's start sends E143's 15 frames (the wake-up, `b0 f2`, `c0 f6`, `c0 f4`, `a0
  f5`, `c1 f9`, `c1 02`, `c3 f0` with 1147 bytes, `c2 f3`, `c1 fe`, `81 e4`, `c1 01`, `c1 2f`, `60 f0`, then the state
  poll `c1 80`) and polls the state about every 100 ms. The driver's record holds the 12-40's ID, name, 8 zoom steps,
  12..40 mm, the zoom entries' focal lengths and apertures, status `0x8000` and the aperture wide open, equal to what
  S-LENS writes (read back in both modes after the start), and the driver derives the 35 mm focal lengths 24, 80 and 24
  mm (E147's words `0xa32d3d48..50`, which its derives store; E146's E143's); the zoom ring at 40 mm gives step 7 and 80
  mm; LLPSW pressed detaches the lens and released starts it again (`emu/test/test_lens.mjs`, a process per body, 13
  checks each). The exposure plan is S-LENS's. The screens are S-LENS's (frames at the start, S1, MENU, PLAY, INFO) but
  for the focal length: back on the shooting screen from the menu or playback the application shows "12mm" for about 3 s
  where S-LENS leaves `---` (x 157..222, y 502..529 of the TFT), as E143 shows 25 mm (4.4.2); the only other pixels that
  differed were the blinking ISO item's (`bin/modelcheck.mjs`'s note), caught in another phase. Both bodies' starts end
  at `0x102` with either lens, so E143's leaving of the date prompt on the lens's event does not show, and the lens
  stays at its first step (12 mm) until S-EXPOSE turns the ring on the shooting screen.
- **The touch:** E146 and E147 run with the touch driver off (`models.mjs` `touch: false`), so the application's touch
  forward of 4.4.2 is not reached on them, and the lab posts no touch with either lens.
- **An error log the native sessions met:** on the shooting screen both bodies log `0x39000903`, E143's expected movie
  time query log (its time code conversion finds the movie info's frame rate 0), about ten times a second with either
  lens (X); their conversion is E143's `0x5044949b` but for the log's line number (E146 `0x5043fa3d`, E147
  `0x5044de66`, X), so it is now expected on them too (`models.mjs` card_fs errlog; the lens session's error check
  found it).
- **Open:** the lens's real replies (4.4.2), as on E143; the E144 family's lens driver, another lineage (the shapes
  above are not its), which a reading of its own would bring to the native lens.

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
- **MMIO and IRQs (D unless tagged; 2026-11-02):** the audio driver gap@0x50aa6fe0 drives two devices and the sound IC.
  `0x9b700000..0x9b70011c` is the audio serial (I2S-like) port: double-buffered DMA from memory to the sound IC, TX and
  RX, IRQ 43 at level 3 (attached by `0x50aa9515`: `0x50053f76(43, 3, 0x60aca102 = 0x50aa90e2)`, with the interrupt
  enables +0x2c = 0xf and +0x50 = 0x38). `0x9bb00000..0x9bb003c0` is the SCA, a memory-to-memory sample converter and
  mixer (aud_seq_sca_open / exec), IRQ 45 at level 5 (handler `0x50aab51d`, attached at `0x50aab67e`); the driver uses
  it for a source and destination both 128-byte aligned (the converter table `0x6035e59c`) and to mix two players
  (`0x50aa7b73`), and it carries no PCM to the sound IC. Both IRQs go through the attach wrapper `0x50053f76` (X: both
  attached natively in a session with the audio hardware, `--audio auto` on E143); the earlier note here that no audio
  IRQ attach was found was wrong. The sound IC is a Wolfson WM8946 (the string "dev_ctrl_wm8946_sub_adj_calc_adcvol") on
  PER_SIO channel 14: exec_data `0x50a632c5` sends 4-byte frames {address, data} at 4 MHz, a read 2 bytes out and 2 in
  (bit 7 of the first set), chip select GPIO 139 / 140, with register parameter lists by name (power-on, 48k / 96k, mic,
  limiter, wind cut, headphone and speaker volume; executor `0x50a63ecc`, a shadow at `0xa33dcd6c`); the output volume
  is the codec's (output_vol_list `0x60dc5298`: registers 0x0a, 0x0b, 0x28, 0x29, 0x47). Pin `0x9b882f40` (0x4440 or
  0x33333 at the play start). The codec engines are three identical banks `0x99400000`, `0x99410000`, `0x99420000` (137
  references each) and `0x99500000`, with IRQs 303-306 (level 5, CPU 1 only, handlers in segment 8). `0x9a000000` is not
  a device (section 9 item 5).
- **Operation sounds: the AF beep from S1 to the page (E143, 2026-11-02; D unless tagged).** The leads came from
  azqeurio/om-c-firmware's "db firmware" 0.3.2, whose OM-1 1.9 tables address this image, each checked here. In the
  lab the whole chain below runs natively but for the stand-ins named at each step; X for each step is
  `emu/test/test_audio.mjs` afBeepSession (two half presses, the beep Off, S2) unless another test is named.
  1. *The request.* The GUI's SubAppMDLFocus::changedFocus `0x5105260c` (dispatched on CBS_END_FOCUS's GUI event
     `0x03000030`: the GUI's event rows {event, 1, 1, handler} at `0x512c955c` and on) plays through playAfSound
     `0x51052444` when getCondition (OlyHfwOpeShoot `0x50ad8b37`) answers isFocus 1, indicator 1 and no rec view
     (`0x5105268b..0x51052707`). playAfSound plays while the GUI's afSound flag `0x62b2e0c4` is 0 and settings id 18 is
     not (`0x5104e12d(18)`; the Setup item "8", menu mode 1037, writes 18 with its own value through the settings DB's
     write, X by the menu and by SET:1037), calls the sound singleton's play (`0x50b56569` -> object `0x62afee0c`,
     vtable `0x60e3881c`, slot 0 `0x50b569a4`, call entry `0x50b569a9`: d0 the sound id, d1 the volume, 0 plays nothing,
     a1, two stack words) with sound 0 and the setting's 60, and sets afSound. The facade calls
     OlyHfwOpeSndCtl::playTarget `0x50b758b4`, which refuses sound 0 ("NOT READY", `0x50b75962`) unless the shared take
     status's word 0 has one of the bits 2, 4, 8 or `0x1000000` (and word 1 has neither bit 0x4 nor bit `0x10000000`,
     `0x50b75939..48`), then api_sound.c `0x5041ee45`, which sends a 44-byte message of kind 2 to UI_OUT's queue `0x70`
     (the halfword `0x600432a4`) with no timeout (`0x5041f01d..0x5041f036` -> `0x503ebe46` -> OlyQeWr `0x5002c151`, so a
     full queue blocks the sender). In the lab S-AFLOCK writes what the shooting sequence, the take capability and the
     AF module would hold at the AF lock (the comment at `TAKE_STATUS_SET` in `emu/src/lab/camapp.mjs`): S1 sets the
     still sequence's READY bit 2 in the take status's word 0, END_FOCUS(OK) its READY_FINISH bit 4 (the sequence parts'
     READY and READY_FINISH entries call the setters of 2 and 4, `0x50cd926e`, `0x50cd92e4`) and isFocus `0x62af6e28`,
     and the AF module's state getter `0x509b06f6` answers indicator 1 (that its code 1 is S-AFOSD's in-focus code is
     I). *The re-arm:* the shooting reactive posts CBS_AF_LOCK (155) with 1 or 0 by its event's field
     (`0x50af4b73..0x50af4ba6`), which the application's callback switch (`0x5108226d`, case `0x510824af`) turns into
     GUI event `0x0300002c` (1) or `0x0300002d` (0); `0x0300002d`'s rows name clearAfSound `0x5105241b` and
     `0x5105254f`, which calls it, and clearAfSound clears afSound when `0x51069d6d` answers 0
     (`0x5105241e..0x51052429`; X: it does at S1 up). S-AFLOCK posts CBS_AF_LOCK(1) after END_FOCUS(OK) and
     CBS_AF_LOCK(0) at S1 up: so each half press in focus beeps once (X: without the 0 the second half press was
     silent); that the camera's sequence posts it at the lock and its release is I (the reactive's event is not traced
     to the AF module). A release's END_EXPOSE also clears the flag (its handler `0x51065dd7` calls initAfSound
     `0x510523ff`). Without S-AFLOCK, and with the beep Off, nothing is requested (X). No other input of the lab (menu
     navigation and dials, OK and the Super Control Panel, the arrows, a release, playback) reaches the facade's play or
     api_sound (X, the round's first probe); the menu cursor's Cursor_2CNL_Actuator `0x5116418e`, the facade's other GUI
     caller, was not entered. Before S-AFLOCK (X, a probe of S1 then S2) the singleton ran only at S2, twice from
     IOlyApiShooting (`0x51059373`, `0x51059919`, via `0x5108c19f`), which then asks +68 (isThroughSound); +4 stops.
     om-c's electronic shutter sound calls play from hooks on CapBuf_TakeBuff's calls of `0x50b8467c` (a buffer list
     append) and `0x50b87d56`, which S-RELSEQ's stand-in never reaches.
  2. *UI_OUT* (task 38, entry `0x5014f56c`; H-UIOUTSTART, MODELS `ui_out`: its init `0x5014f4e9`, which the boot
     calls after checkpoint "2_9" at `0x501e8f31`, then act_tsk; UI_OUT_EXEC `0x71` leaves S-MODACK's queues) takes the
     message on flag `0x57` pattern 0x2 and gives kind 2 to `0x5014f7e0`, which for op 0 (play): reads setting `0x5051`
     (`0x5014f880`; 0 in the lab, X) and, at 0, first releases a sound still held (`0x5014fbeb`: with the busy byte
     `(0xa32db0fc)` set, command_play_stop 0x46, command_play_end 0x49 and the player's close `0x50aa9795`); opens a
     player once (`0x50aa9715(0xa32db164, 300)`, busy 1); sends AUD_EXEC (queue 8, the halfword `0x600431d4`,
     synchronously through `0x5002e39d`) cmd 0x22 (volume); calls `0x50aa9969(kind)`; sizes the sound with res_size
     `0x501a976d(2, id)` and copies it with res_read `0x501a921f(2, id, 0xa4000000, size + 1024)` (to `0xb5a0b780`
     above 512 KiB), the descriptor's {pointer, size} to `0xa32db098` / `0xa32db09c` (om-c's hook replaces this lookup,
     `0x5014f927` / `0x5014f98a`); then cmd 0x41 with the usr_wave descriptor `0xa32db094` {+0 wav_mode, +4 io_adr, +8
     io_length, +12 play_count, +20 max_duration, +24 time_scale, +28 Channel, +30 BitsPerSample, +44 post_next_bank,
     +48 post_next_adr, +68 post_end, +72 cb_HRS, +76 cb_AIR: the names of aud_seq_play's log} and cmd 0x45. The
     descriptor's post_end (`0x5014fc6e`, set by the init at `0x5014f78d`) posts UI_OUT's flag and sets busy 2; on it
     UI_OUT's end handler `0x5014fb87` sends 0x49 and closes the player (busy 0). X: once per half press, the busy
     byte 0 after each.
  3. *The sound data* (resource type 2, RES_MODE_SOUND; H-RESINIT, S-RESNAND, S-SOUNDRES; the next bullet has the
     tables): the index at NAND `0x4e420000` is factory data that no update carries (D: no block of the `.BIN` loads
     there; the TG-7's update is the only one of the 33 that ships such an area, block flags 0x0103, X). With the
     audio hardware and no host image the lab serves S-SOUNDRES's lab-made area there (`emu/src/lab/soundres.mjs`): the
     TG-7's format, one entry, id 0, the AF confirmation, two 52 ms bursts of 2.7 kHz 24 ms apart at a quarter of full
     scale, 48 kHz 16-bit stereo, synthesized by the lab and named so in its INFO chunk. The TG-7's AF sound carries
     the INFO key IKEY "PRM_AUD_AFOK_VOL" (X), and the lab's beep the same key, because the driver plays a sound by its
     key (item 4). Ids 1..5, the background music the aud_debug command `0x51a1006f` reads, are left out (the index
     zero-padded after entry 0, as the TG-7's is, X); no lab input asks for them. What a listener hears at S1 is
     therefore the lab's beep, not the camera's: the OM-1's own sounds are not in the update.
  4. *The driver* (`--audio auto` or `on`, E143; `emu/src/lab/audiohw.mjs`, `emu/src/dev/audio.mjs`,
     `emu/src/lab/wm8946.mjs`). AUD_MAIN (task 0x52, entry `0x50a62a05`) runs as USTART2 starts it (`0x501e950b`;
     H-AUDSTART: act_tsk, its stage-6 wait answered by the stage bit), S-AUDCPU2 answers its CPU 2 starts of AUD_WAKEUP
     0x2017 and AUD_LEVEL_MONITOR 0x200e and posts AUD_WAKEUP's reply (`0x50035afd(0, 0x60a83d95, 0)`, flag 0xf9), and
     its driver init attaches IRQ 43 and 45 and starts AUD_COPY_DATA 0x51 and AUD_WATCH_DOG 0x07 itself; S-WM8946 serves
     the sound IC on PER_SIO channel 14 as a register file. AUD_EXEC's dispatch (tables `0x60dbebf0` / `0x60dbeaf0`)
     sends 0x41 / 0x45 / 0x46 / 0x49 to `0x50aac1e1`: aud_seq_play `0x50aac292` takes one of two play slots
     (`0x62af27e0`, 172 bytes each, their count `0x62af27d4`), parses the WAV (`0x50aac8ef`) and asks
     aud_ikey_to_wavetype_is_short_sound `0x50aaa824` for its IKEY: the driver's table `0x60dbf174` holds 18 {name,
     flag} pairs, PRM_AUD_SHUT1..3, CSHUT1..3, EFFECT1..3, EVENT1, ERASE1, SELF, AFOK, BGM, WARNING, START1, MOVRECS and
     ADJVOICE (each `PRM_AUD_<name>_VOL`), with flag 0 for CSHUT1..3, EVENT1, ERASE1, AFOK and MOVRECS; a sound whose
     key has flag 0 plays directly (`0x62af27d6` = 1, `0x50aacb0b..0x50aacb14`), any other (or none, flag 1) through the
     copy task. *The copy task's play* (X, `emu/test/test_audiohw.mjs`, a WAV without a key posted directly):
     command_play_start `0x50aac5a2` posts AUD_COPY_DATA cmd 1 and 0x80000002, the prefill of 8 periods of 768 bytes
     into the ring `0xa403b800`, each through the memcpy converter `0x50aa7439` (a source or destination off 128-byte
     alignment; the converter table `0x6035e50c`) and then the gain stage `0x50aa8a63` (0 dB at volume 100), the sound
     IC's list, the TX open `0x50aa8d9b` (the template `0x60dbf2b4` copied by `0x50aab154`), IRQ 43 with status bit 4
     and the TX-ready callback `0x50aad28a` (flag 0xed), the TX start, then IRQ 43 every 4 ms of lab time, each
     re-arming the finished slot (`0x50aa8ef3`) and posting AUD_COPY_DATA cmd 3, until the period callback `0x50aad2a0`
     disables TX at the sound's last period; the samples come out unchanged. `0x50aa7439` calls the flash library's
     memcpy at `0x50aa7445`, the call om-c redirects for its sounds (I, its notes): that memcpy, run-time `0x5000290a`
     (the lab's notation `0x3ffe18ea`, `emu/src/fw/place.mjs`), is the general copy of thousands of call sites, not an
     audio converter (om-c's notes name it as if it were). *The direct play* (the AF sound's): the ring set-up gives the
     TX object no ring (+32 = 0) and the port's slot A the WAV's data in place, slot B address 0 and length 0
     (`0x50aad250..0x50aad263`; the template `0x60dbf2d4`, chosen by the format record's +0 = 2 at `0x50aab1ba`, which
     writes +0x30 bits 3..6 = 0 where the copy task's writes 0x8, X), with no copy task, so no software gain stage. The
     one IRQ 43 at slot A's end runs the period callback once, which for 0x62af27d6 = 1 takes the end path at once
     (`0x50aad2f2..0x50aad408`: the post_end through `0x50aad55d` and the end flag `0x600431a6` bit 1 << player), and
     command_play_end (0x49) then waits for the TX done callback `0x50aad44b`'s bit 31 of that flag
     (`0x50aac833..0x50aac863`, no timeout), which only the ISR's stop calls: at a slot's interrupt with TX enable
     (+0x30 bit 2) clear (`0x50aa923c..0x50aa9265`). The driver's one TX disable, the period callback's stop
     (`0x50aad35d` -> `0x50aad6bc`: port command 4 through `0x50aa8d32`, the only call of `0x50aad6bc` in the driver's
     code), is not reached on this path: the callback takes it only for a play slot whose byte +133 is not negative
     (`blt` at `0x50aad31c`), and aud_seq_play sets that byte to -1 (`0x50aac47c`, its only store in the driver's code
     `0x50aa7000..0x50ab0000`). command_play_end skips the wait only while another play slot is counted
     (`0x50aac81d..0x50aac830`) or for a slot opened and never started (`0x50aac833..0x50aac838`: its state byte +12 is
     1, set at `0x50aac59b`; 2 at `0x50aac74e`, 3 at `0x50aac7e1`). So the lab's port ends TX itself at the
     empty slot B, clearing the enable (A-AUDIO-1: I, from that wait and that gate; X: every half press's post_end,
     command_play_end and close then run, and the port is idle). The other reading, that the real port raises an
     interrupt for the empty slot and stops on what the driver does then, is not excluded (?). The port's slot address
     registers hold the address >> 4 (the TX open `0x50aa9379` and the re-arm `0x50aa9652`), so a direct play's samples
     must start 16-byte aligned: the lab's beep's start at +144 (with them at +140 the port played 12 bytes of the
     header first, X). X: the beep's 6144 frames start 68 ms of lab time after S1 down (the GUI's changedFocus 50 ms,
     then UI_OUT, the play start and the TX open), one IRQ 43, no gain stage.
  5. *To the page.* The port's played slots go to the session's audio output (`emu/src/lab/audio.mjs`) as PCM events
     of source `native`, consecutive slots back to back at the lab time each started, and the pages play them with
     WebAudio through `GET /api/audio` (X: `emu/test/test_host.mjs` audio, the beep beside S-SHUTTERSND's clicks). The
     samples are the WAV's as the port fetched them: the codec's volume registers (output_vol_list `0x60dc5298`) are
     kept, not applied, so the page plays the beep at the lab's own level, not at the camera's volume (I: the volume
     is the codec's on this path).
  6. *Other sounds and the copy task's release.* A sound played through the copy task alone gets no post_end: the end
     flag and post_end come only from the period callback's end at the IRQ 43 of the sound's last period
     (`0x50aad3c4`), while its stop one period earlier (`0x50aad35d` -> `0x50aad6bc`, which clears TX enable) makes the
     ISR drop its TX object in that same interrupt (`0x50aa924a..0x50aa9250`), after which a bit-5 interrupt's re-arm
     returns at once (`0x50aa8efa`); a command_play_stop of such a sound then waits on that flag for good (`0x50aac7c7`;
     X: AUD_MAIN still waits after 3 s of lab time, `emu/test/test_audiohw.mjs`, which releases with 0x49 and the close
     itself). Which of the code's own alternatives avoids that on the camera is ?: another player keeping `0x62af27d5`
     above 0, the direct play's `0x62af27d6` = 1 (which does for the AF sound, item 4), the SCA mix, or setting
     `0x5051`. Without the release each cmd 0x41 takes a play slot and the third finds none (`0x50aac463`), and the
     port plays the stale ring on (X): the firmware's own behaviour for a caller that never releases. Not modelled:
     RX, the SCA (a 128-byte aligned source or two players stop the session), the 96 kHz / 24-bit template,
     AUD_WAKEUP's power-on list. No lab input asks for a sound through the copy task. Whether the OM-1 beeps on the
     self-timer, and who would ask, is ? (no self-timer play site found).
  7. *Open:* the OM-1's own sound area (its entries, which ids are which sounds, their keys and format, its extent; a
     NAND read from a camera would settle it); what `0x1000000` in the take status's word 0 is; when the camera's AF
     module raises the reactive's AF lock event; the port's real stop behaviour at an empty slot (I above).
- **The resource tables (since 2026-11-02; H-RESINIT, S-RESNAND: `emu/src/lab/resnand.mjs`, `emu/src/fw/nand.mjs`; D
  unless tagged):** the loader `0x501a8ca0` reads, each through `0x501a986a` (the source rounded down to 512, the
  destination up to 16; for mode 1 the generic NAND access `0x500022c2` with its read operation `0x10200`), the sound
  index at `0x4e420000` (1024 bytes, type 2), the images block's at `0x4e1e0000` (12288, type 3), the large-data block's
  at `0x458c0000` (1024, type `0x8000`), the sub-indexes the large-data index's first twelve entries name (their sizes
  from `0x602a49f4`, types `0x8001..0x800f` through the byte map `0x602a49e3`) and the resource block's at `0x41ec0000`
  (2048, types 0 and 1), and stores each buffer and the buffer + 32, past the block's own OE head
  (`0x501a8cd2..0x501a8de3`). An index is that head (res_version `0x501a971e` answers its `+0x10` << 16) and 16-byte
  entries `{address, size, 0, 0}` (res_size `0x501a976d`; res_read `0x501a921f`, type 2 at `0x501a9322`, the
  `0x8002..0x8005` of the lens data lookup `0x502ae5d9` at `0x501a9633`). The NAND holds each block of the update at its
  head's load address as head + descrambled body + tail (I; X: the tables' versions are the heads' `0x0100`, and the
  twelve sub-blocks begin with OE heads at their own addresses). The play bring-up runs the loader natively in
  USTART_L's place (its call `0x500241d8`), before H-LENSINIT's cache load (`0x5002420e`), where the host gives the NAND
  (`env.nand`: an extract of 3.4 MB, the heads, the indexes and the records of at most 64 KiB, pinned in MODELS
  `res_nand`, which provisioning writes to `unpacked/<code>/` for the node hosts and the browser keeps in its cache). X
  (E143, `emu/test/test_resnand.mjs`): 16 reads; res_size(0, 0) = `0xe2800`, (3, 0) = `0x2800`, (`0x8000`, 0) =
  `0x167fc00`; res_version `0x01000000`. The sound area is not in the update (factory data, I): S-RESNAND reads it
  erased unless the host gives an image (`env.soundArea`; the builder `soundArea()` makes one in the TG-7's format,
  `docs/firmware-container.md`), and keeps the firmware's writes and erases inside the flash access guard's window for
  it (`0x50000735`: `0x4e420000..0x4e460000`; the type-2 write `0x501a98c8` erases up to entry 1 with `0x10300` and
  writes with `0x10100` at `0x501a9a1e..0x501a9ab4`, X: run natively and read back). It serves any read up to the RAM
  log at `0x4e820000` from the area, erased past the window and the image (res_read of type 2 reads an entry's size +
  1024 bytes, `0x501a937d` / `0x501a9394`, past the last entry; X: a 2 s sound 1 read past the image's end, where the
  first version passed such a read down and stopped the session; the area's extent is I; an access across the area's
  start or that address is refused with its own message), and with the audio hardware and no host image the image is
  S-SOUNDRES's (the bullet above, item 3). Erased, res_size(2, 0) = `0xffffffff` and res_version(2) = `0xffff0000` (X),
  and USTART_L's own load of sound 0 (`0x5002433b` / `0x50024353`: res_read(2, 0, `0xa4000000`, res_size + 1024)), which
  the lab runs right after the loader (H-RESINIT's order: USTART_L runs it after the lens data cache load, res_read(11,
  0) and a wait until the byte `(0xa32df1c0)` is not 0, `0x50024323..0x50024336`, whose meaning is ?; the two touch
  different state), wraps its size to 1023: res_read sets its last entry (`0x501a934e`), takes its error path
  (`0x501a93d5`), logs `0x1f000003` and leaves the descriptor `{0, 0}` at `0xa32db188`, which a later load into
  `0xa4000000` answers without a read (`0x501a9333..47`) (D; X); with an image it leaves `{0xa4000000, size + 1024}`
  (X). A sound 0 whose load (its size + 1024 bytes) is larger than `0x3d000` bytes would run into the GUI's icons record
  at `0xa403d000` (X: a 2 s tone as sound 0 stopped the application's start), and one larger than `0x3b800` into the
  copy task's ring at `0xa403b800` (the bullet above, item 4), which ends at the icons record and which a sound played
  through the copy task overwrites (I: no lab input plays one). What changes in the lab: the lens data lookup reads its
  lens's record (type `0x8002`, 13824 bytes at `0x4709de00`) where it read 0 bytes at 0 (X), the erased area's one
  `0x1f000003` at the bring-up (gone where S-SOUNDRES's area is served), and nothing else a camera would show: X, the 26
  play scenarios' traces before and after H-RESINIT, H-UIOUTSTART and S-AFLOCK compared item by item (2026-11-02, the
  integration): the same screens and the same interrupt rows in the same order, each with its IRQs, levels and pcs, only
  the rows' instruction counts moved; the device summaries differ in two more VSC doorbell commands (the harness's
  steps) and, after S1 with S-AFLOCK, 6 to 10 fewer OSD engine commands (which drawing is not traced). Open: the OM-1's
  own sound area (its entries, which ids are which sounds, their format, its extent; a NAND read from a camera would
  settle it); E146 and E147 (their sound index at `0x4e3e0000`, X) are not given `res_nand` yet.
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
  tasks report "not available", or the ISC endpoint at node 4. Never emulated. The A53 side (its own kernel + userland,
  the boot handoff, the custom device set, and a phased LLE plan vs the HLE ISC-node service) is specified in
  `docs/a53-spec.md`, which also covers the A9 sibling in E144 and the other networked bodies.
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

#### 4.6.1 CPU 2 natively, round 1 (2026-11-09; D unless tagged, addresses E143's)

Behind `--cpu2 native` (E143, off by default; `emu/src/core/cores.mjs`, `emu/src/lab/cpu2.mjs`,
`emu/test/test_cpu2.mjs`) the machine has a second MN103 core. It runs CPU 2 from its entry through its kernel to its
idle loop at the play bring-up, then beside CPU 0 for the session, and its own AUD_LEVEL_MONITOR answers the Super
Control Panel's posts, so S-CPU2 is lifted in those sessions (X). A default session creates no second core: golden is
unchanged and a camapp session runs the same instructions in the same wall time within noise (X, the cost bullet).

- **CPU 2's code and loader.** CPU 2 runs from the run-time image CPU 0's reset head lays out (cores spec 3.1 step 2);
  no copy is made for it alone. Its entry is `0x50008f01`, whose run-time address CPU 0's reset head writes to
  `0x98d00144` (cores spec 3.1 step 4). Its overlay segments 1..10 are its own boot job: USTART_L2 `0x50024572` copies
  each one from the flash view (`0x50000020 + offset`) through the flash driver `0x500022c2` (`0x50024e6b`, which
  then sets bit n-1 of `(0xa32df1f8)`), sets the segment's byte flag and posts CREQ `0x50036120(0, 0x50024eda, n)` to
  CPU 0 (segment 8 to CPU 1, `0x5002480d`). The lab's image already holds every segment (I: the copies matter only to a
  cold boot).
- **Entry and reset state** (`0x50008f01..0x50008f78`): `and 0xf0ff,psw`; `(0x8070)` = 0x30, then 3; `(0x98100808)` =
  16; sp `0x500027fc`, in its local RAM; `jmp` to its run-time copy; the UART mark "2" (`0x50000426`); its IVARs and
  GxICR (`0x5000f068`); a spin while `(0xa3258360)` = 0; the 4 KiB window `0xa1a91000` -> `0x50002000`; the log mark
  "oIs"; bank 2 `+0x514` = 0x40 (IRQ 325's level register, 4 * 325: level 6); `0x50009288` -> `0x50011867`: sp
  `0x62ee947c + 0x200`, then the kernel body `0x50012826`. The first instruction clears the PSW's interrupt bits and
  every other register is written before it is read, so the reset values do not matter (I; A-CPU2RESET).
- **The machine (X).** Core switches swap the registers, the CPU's per-core fields, the interpreter's breakpoints and
  TB records and two pages: each core's own page `0x0000..0xffff` (the `0x8000` system registers, with `(0x8050)` = 2
  on CPU 2: A-COREPAGE, A-COREID) and CPU 2's local RAM at `0x50000000..0x5000ffff`, where CPU 0 keeps the flash view.
  Bank 2 presents to CPU 2 (IRQ 324 from its own pending bits, IRQ 325 from its own kick: A-KICK; CPU 2 takes its
  interrupts at any instruction: H-CPU2GATE). Inside CPU 0's runs CPU 2 takes a turn of up to 2,000 instructions after
  every 2,000 of CPU 0's; at CPU 0's idle point it runs until it sleeps (A-INTERLEAVE). A stop at a halt pc (after a
  store of 8 to `(0x8040)`, or the idle TCB's `bra` to itself) sleeps until bank 2 presents an interrupt CPU 2 admits;
  the interrupt's return to that pc goes on from it, and only a later arrival halts again. Review fixes (X): the
  return used to halt again at once, so the loop past a halt never ran again (a command 0x40002 written to CPU 2's slot
  of `0x97f000f0` stayed unserved over 20 ticks); and a write to a bank 2 level register did not recompute CPU 2's
  request (a level written after the pending bit left it low). `test_cpu2.mjs` pins both.
  An unknown device access, a kernel break or a task the lab does not list parks CPU 2, and the step that follows
  stops the session.
- **Stand-ins of the boot.** H-CPU2RELEASE: `(0xa3258360)` = 1 (CPU 0's reset head, `0x50000329`) and the tick magic
  `(0x97f00088)` = 0x77777777 (CPU 0's init task right after its tick init, `0x5002ccdc`; H-BOOTTIME runs that tick
  init, not the store: without it BOOT_CPU2 spun on `0x5003b654` for 5 million instructions, X). H-CPU2CACHE: the
  store to `0x98100808` is skipped (the bus window's device knows only `+0x58`: a bus error, X). H-CPU2UART: the mark
  "2" is skipped (no UART; `0x9870001c` is lab-stub space). K-BOOTSYNC2: CPU 2's part of the boot ring `0x50015a61`
  returns at once. K-STARTBITS: the kernel-start barrier `0x50012367` runs natively after the stand-in ORs 0xb (CPUs 0,
  1 and 3) into `(u16)0x97f00000`.
- **The boot (X).** After H-IPIINIT, CPU 2 reaches its idle loop in 35,788 instructions: its kernel builds its 37
  static tasks; the start `0x500119ab` dispatches BOOT_CPU2 `0x50008fbb`, which starts CPUCONN_CPU2, CPUCALL_CPU2,
  CONTEST_CPU2 and USTART_L2, sets its done byte `0x97f00096`, finds segment 1's bit set (`0x50024de8(1)` would sleep
  2 ticks at a time; S-BOOTSTAGE sets it) and calls `0x501ea881` -> `0x50038715` -> `0x500387eb`: the up magic
  `0xa3193684` (`0x5003b542(5)`), `chg_pri(0, 70)` and the command loop (Idle below).
- **First device accesses (X)**, in order: the us clock `0x98900284` (the log mark's time, `0x50002bfa`); bank 2
  `+0x514` = 0x40 (`0x50008f72`); the ISC lock byte `0x97000000` (masks 2, then 1: the kernel's locks `0x50017bcb` /
  `0x50017bd8`); bank 2 `+0x514` = 0 and `+0x884` = 1 (its INTC init `0x50008f7f`); bank 2 `+0x714`, IRQ 140 at level
  5 (its tick: timer channel 3, which H-BOOTTIME started); the tick's ack `(0x98900400)` = 4 (`0x500311ed`). No
  unknown device was reached (H-CPU2CACHE and H-CPU2UART aside).
- **The first cross-core call it makes (X):** USTART_L2 (task `0x2013`) copying segment 1 calls cpu_conn kind 8
  (twai_sem, through `0x5002d2e9`, return `0x5002d313`) on CPU 0's semaphore `0x81`, FLASH_CS1 in the name table, at lab
  time 206,191,650 ns; the doorbell is bank 0 `+0x808` = 1 (`0x5002d6dc`), which CPU 0's IRQ 324 handler acks at its
  idle point (`0x5002d851`). Only CPU 0's CPUCONN_CPU0 (`0x99`) serves the call, and the lab does not run it (its
  starter is CPU 0's init task), so USTART_L2 waits for good: segments 2..10 are not copied and none of its CREQs is
  made (X; I: the CPU 1 one for segment 8 would need CPU 1 as well).
- **The first cross-core call it takes (X):** at H-AUDSTART, AUD_MAIN's OlyTaStCpu of AUD_LEVEL_MONITOR `0x200e` runs
  natively (S-AUDCPU2 still answers AUD_WAKEUP `0x2017`): cpu_conn kind 9, bank 2 `+0x808` = 1 (`0x5002d6be`); CPU 2
  takes IRQ 324 and acks it (`0x5002daab`), CPUCONN_CPU2 wakes and its proxy for CPU 0 (`0x5002cf2d`) starts
  AUD_LEVEL_MONITOR `0x50aaa99e`; the result goes back on bank 0 `+0x808` = 2 (`0x5002d5d1`), CPU 0 acks it
  (`0x5002d888`) and AUD_MAIN wakes. No kick (`+0x810`) was written in the session (X).
- **Idle (D, X).** The command loop `0x5003883a..0x50038b32` reads only the CPU 1..3 command block
  `0x97f0009c..0x97f00113` (ten arrays of one word per CPU 1..3, `0x97f0009c + 0xc * k + 4 * (core - 1)`; the cores
  spec's `0x97f0019c` corrected); when the halt word `0x97f000fc[core - 1]` is set it stores 8 to `(0x8040)` every pass
  (`0x50038b04`). BOOT_CPU2's own `0x50038666` sets that word to 1 at its start (`0x50038701`: the `mov 1,d1` of the
  index computation is the value stored), so CPU 2 halts each pass; its first halt is at `0x50038b09` (X). Its tick IRQ
  140 wakes it about once per lab ms (X: 2,051 wakes in 2.15 s of lab time); the tick's return goes on through the loop,
  whose next pass finds the block unchanged, so H-CPU2POLL keeps CPU 2 asleep at the loop's head `0x5003883a` from then
  on (X). The commands, per word of the block: `0x9c` 0x10001 (ter_tsk of the id at `0xa8`, then `0x9c` = 0 and `0xb4` =
  1); `0xc0` 0x20001 (`0xcc` = 1, the tick ISR `0x500387b9`'s sleep request, which it acks with `0xd8` = 1) and 0x20002
  (`0xd8` = 1 at once), each clearing `0xc0`; `0xe4` the 0x3xxxx cases (0x30010 calls `0x5002f9df`, 0x30001..0x3000f a
  jump table), reset to 0x30000, the value the init writes; `0xf0` 0x40001 / 0x40002, which set / clear the halt word
  `0xfc` and clear `0xf0`; `0x108` written each pass, 0 when it halts, else 1. `test_cpu2.mjs` writes 0x40002, then
  0x40001, into CPU 2's slot of `0xf0` and checks both served (X). Who writes the commands on the camera is ? (no CPU 0
  store in a default session, X).
- **S-CPU2 natively (X for the posts and replies, D for the path between).** With CPU 2 running, the GUI's post
  (`0x50aa9d4e`, every ~210 ms while the panel is shown) is left to it: IRQ 324 bit 8 on bank 2, the drain of ring
  [2][0], `0x50aaa173`'s message 3 to AUD_LEVEL_MONITOR's queue, command 3 and its reply `0x50035afd(0, 0x60acbfb7, 0)`
  (return `0x50aaad66`, from task `0x200e`, X), which CPU 0 takes at its idle point. `test_cpu2.mjs` checks every
  post answered by that task, nothing left waiting, and the panel's frame and the 28 reply bytes at `0xa33da484` equal
  to a default session's S-CPU2 ones; its control `cpu2-no-audmon` (the task stood in) leaves the GUI waiting, which the
  step's check reports.
- **Cost (X).** A default camapp session (open, 2 s, S1, S2, 0.8 s) runs the same 196,968,866 instructions to the same
  lab time on master and the branch, in 8,110 and 8,027 ms (means of 3, alternated); `node emu/bin/test-pure.mjs` took
  76.9 / 82.8 / 96.1 s on master and 83.4 / 88.6 / 82.0 s on the branch (load average 8 to 10: noise, no trend). With
  `--cpu2 native` the session takes 8,176 ms against 7,840 ms without (+4%, means of 3, alternated); CPU 0 runs 4,983
  more instructions (its IRQ 324 handlers) and CPU 2 about 8 million, nearly all its 1 ms ticks. Re-measured after the
  review fixes (X; means of 3, alternated, load average 5 to 7): `emu/bin/playperf.mjs` 9,347 ms on master and 9,341 ms
  on the branch, with the same workload digest (`13fa8f7471592f8a`; the digest pinned in playperf is stale on master
  too); test-pure 81.8 s and 81.9 s; a session of open, 2 s, OK to the Super Control Panel and 2 s takes 7,944 ms with
  `--cpu2 native` against 7,749 ms without (+2.5%), CPU 2 running 8,010,523 instructions.
- **Open, in order (I; Claude wall-clock).** (1) CPU 0's CPUCONN_CPU0 and CPUCALL_CPU0 natively (`act_tsk(0x99)`,
  `act_tsk(0x9a)` as the init task does, with their proxies), so that USTART_L2 gets FLASH_CS1 and its CREQ runs
  `0x50024eda(n)` on CPU 0 (K-CFLUSH and the per-segment hooks `0x501e60xx`, devices unknown): 3-6 h, with segment 8's
  CREQ to the absent CPU 1 answered by a stand-in. (2) AUD_WAKEUP on CPU 2: its sound-IC list `0x50a62e27` reaches
  PER_SIO, whose S-WM8946 seam is CPU 0's hooks: 2-4 h. (3) TAKE's CPU 2 queues: start MVR_MAIN `0x2002`, WB_MOV
  `0x200f`, SDET `0x2010` through OlyTaStCpu as their starters would and record their first device accesses: 2-4 h,
  then the movie engine per task. (4) OSD_DRAW_CPU2 `0x2015` with the GUI's message `0x510149a2` (the histogram): 2-4 h.
  (5) Snapshots, the live debugger and traces with a second core are refused or untested: 1-2 h. (6) CPU 0's boot ring
  and kernel start natively (K-BOOTSYNC, K-STARTBITS) need CPU 0's reset path in the lab.

### 4.7 SCPU, power, clock, on-board sensors and persistence

- **Tasks (CPU 0, D):** PER_SCPU 0x7a `0x5005b424` (the request server: reads the data queue PER_SCPU_RECEIVE id 2
  and runs a table-driven state machine, `0x5004fe2e`; its 100 timer is the SCPU start watchdog, 4.7.1), PWR_MAIN 0x0a
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
  `0x5004dc55`, which the lab does not run. In the lab (`emu/src/dev/scpu.mjs`) the clock ticks with lab time since
  2026-10-23 (on the E143 board and on E139 and E134; the other E144-family bodies keep it still, 4.7.1's last
  bullet); `+0x00`, `+0x08..+0x3c` are storage and `+0xf4` the command word (settings spec section 3); on the E143
  board `+0x98` and `+0xa0..+0xb8` are modelled and drive IRQ 320, whose attach the lab makes in the init's place
  (4.7.2).
- **The request API (D, 4.7.1):** `0x5005cd17` sends a 28-byte request `{+0 u8 cmd, +4 s_size, +8 tx, +12 r_size,
  +16 rx, +20 completion, +24 arg}` inside a 36-byte message to PER_SCPU_RECEIVE (timeout 5000). PER_SCPU carries it
  to the SCPU over PER_SIO channel 2 and three pins, not through the window, writes the reply into rx and then calls
  the completion, which sets the requester's flag. The command set and the transaction are in 4.7.1; since 2026-10-23
  PER_SCPU runs natively in the lab against the sub-CPU's model (4.7.1, Built).
- **Inputs from the SCPU (D):** UI_IN's port init `0x5014e3ab` (called by its module init) registers `0x5014e534` as an
  IRQ 320 callback; it reads the port byte (`0x5004df3f`) and pushes it as group 0's image: the power lever, the Fn
  lever and S1 arrive through the window's port bits. Native in the lab since 2026-10-23 (4.7.2). The SCPU firmware has
  no key module (E139's has one), so whether those bits come from the sub-CPU or from the window block's own pins is ?
  (scpu spec 4.3).
- **The sub-CPU itself (scpu spec):** an STM32L4-class Cortex-M4F (I) running `blk0e560000` (E143 = E146, E147 its own
  build) under eForce uC3: SPI2 slave with DMA on the MN link, PB12 as the request input, PC3 as pin 102 and PC2 as the
  message line (D, scpu spec 3.1), the command table of 4.7.1 mapped to its handlers, battery packs on two UARTs,
  chargers and a USB PD controller on I2C, an RTC, and a debug console on LPUART1. It holds no accelerometer or
  eye-sensor code. The transport-level model the survey recommended before any LLE is built (S-SCPUDEV, 4.7.1; scpu
  spec 8 step 2). Apart from the lab, the image itself boots to its debug console on a pure-JS Cortex-M4 with STM32L4
  peripheral models (scpu spec 8 steps 3-5, 2026-10-28); connecting it in S-SCPUDEV's place is step 6, built
  2026-10-29: opt-in with `OM_EMU_SCPU=native` on E143 and E146 (`emu/src/lab/scpum4.mjs`, scpu spec 8 "Step 6,
  built"), the MN side (PER_SCPU, S-SIO2, the pins) unchanged, and the store-init session's frame log, transfers and
  pins from the first request on S-SCPUDEV's (X).
- **Accelerometer (D):** ACC_MAIN's probe reads register 0x0f of device channel 6 and wants 0x6a (I: the WHO_AM_I of
  ST's LSM6DSL / LSM6DSM family); the bus is SPI over PER_SIO (`[PER_ACC_SPI] per_sio_open_error`, ACC_SPI). Samples
  land in the cache `0x62963f60..0x62963f6c` and bump the counter `0x6034d9d4`. Level Adjust's loop
  `0x5004ad13..0x5004add7` waits for 12 counter changes through the pointer `(0x62963f58)`, which the module init
  `0x50048cad..cf` sets. Since 2026-10-23 the init, ACC_MAIN and PER_SLOPE run natively with the sensor stood in at
  the sample cache, and the level gauge and Level Adjust run (4.7.3).
- **The accelerometer's path (D unless tagged, read 2026-10-23 for step 3):** the module init `0x50048cad` clears
  `0x62963fb8`, runs `0x500493ac`, stores the counter's address `0x6034d9d4` into `(0x62963f58)` and the cache copy
  `0x50049201` (run time `0x6006a221`) into `(0x62963f5c)`, runs `0x5004aa9f` and `0x50048cec` and starts a task through
  OlyTaSt (`0x50048ce2`, id `(0x60042e18)`). ACC_MAIN (task 121, entry `0x50048ec2`) loops on OlyTaSS(80) and calls
  `(0x62963f5c)`, which copies the newest sample into the cache `0x62963f60..0x62963f6c` when the counter moved.
  ACC_SENS_MAIN (task 132, `0x50048f60`) starts a sample (`0x500490c7`: the channel opened for device 107 with the start
  `0x500490eb` as its callback) and waits for flag `(0x60043114)` with a 4000 timeout (`0x500491d5`, counting timeouts
  in `0x6034d9dc`). The start reads 14 bytes from register 0x20 into `0x62963fc8` (`0x5004ca40(6, 0x20, ..., 14)`,
  completion `0x5004910a`); the completion closes channel 6 (`0x5004cb4c` -> `0x5005f25f`), packs the bytes into seven
  halfwords (`0x62963fde`, `0x62963fe0..e4`, `0x62963fd6..da`), increments `0x6034d9d4` and sets the flag with iOlyEvSt
  (`0x500491cb`): it runs in interrupt context. The cache takes `0x62963fd6..da` and `0x62963fde`. I, by ST's register
  map: registers 0x20..0x2d are OUT_TEMP, the gyro's and the accelerometer's X, Y, Z, so the cache holds the
  accelerometer's three axes and the temperature. The register API: `0x5004c971(6, 107)` takes semaphore
  `(0x60042edc)`, opens the channel with `0x5005f0f7` (retrying every 16 ms while busy) and keeps 214 = 107 << 1 in
  `0x6296415c`; `0x5004cb57(6, register, buffer, count)` reads and `0x5004cb6d(6, register, value, count)` writes
  through `0x5004ca40` / `0x5004caba`, which frame `{0xd6, register}` then `{0xd7}` (`0x5004ca56..79`) for the transfer
  layer `0x5005384b` / `0x500538bf`, and wait on flag `(0x60043086)` (`0x5004cbf6`). I: that framing is an I2C register
  access to the 7-bit address 0x6b, the LSM6DSL's address with SA0 high, although the firmware's names say SPI. The
  probe `0x50048fd1` reads register 0x0f once and wants 0x6a, then writes 0x10 to register 0x10 and 1 to register
  0x0d (I, by ST's map: WHO_AM_I, CTRL1_XL 12.5 Hz, INT1_CTRL data-ready). How the gauge and Level Adjust use the
  cache (the axes, the scale, the calibration) is read in 4.7.3, with what is built.
- **Flash (D):** NAND controller `0x98d01100..0x98d011c0`, `0x98d01800/04`, completion IRQ 237, 2048-byte pages;
  store mirrors M `0xa36fd280` and E `0xa377d280` saved by `0x5003f5dd`. The settings init chain `0x503dae30` (17 module
  inits) is called once from the boot chain at `0x501e9060`; the lab runs only its fifth, the property store's own init
  `0x503ee2d6`, since 2026-10-30 (H-STOREINIT: without its pointers a mode change committed 0 into most settings,
  settings spec section 2.2).
- **Power-off (D calls, I meaning):** `0x50044d8e..0x50044de7` sends on a channel, arms channel A, tests the camera
  state, calls the IO expanders and ends with `0x5004dfd0` (`+0x9c` = 127). Native since 2026-10-29 on E143 (4.7.4):
  at the lever's off the lab runs the HFW's shutDown in the HLS component's place (S-SHUTDOWN), the sequence runs to
  that write, which ends the session (H-POWER), and PWR_MAIN runs natively from the bring-up (H-PWRSTART, S-IOEXP).
  Before, with the lever's off decoded natively (4.7.2) and the session left open, the GUI stayed in shooting with no
  write to `+0x9c` (X): the sequence's caller is the HLS camera-common component, not the power manager.
- **Steps (I):** 1, a host server for 0x01 / 0x81 / 0x06 / 0x86 with the clock ticking from lab time and S-NVRAM as the
  default: 4-6 days (done 2026-10-23 at the request API, then the same day PER_SCPU natively over the link to a
  transport-level model of the sub-CPU, 4.7.1; S-NVRAM the players' default since 2026-11-08, `docs/ROADMAP.md`). 2,
  the event /
  port registers with IRQ 320 and UI_IN's registration: group-0 keys and the power lever natively, 3-5 days (done
  2026-10-23 for the keys and the lever's code, 4.7.2; the power-off sequence waits for the power manager). 3, the
  accelerometer at the PER_SIO seam or the sample cache: Level Adjust, level gauge, rotation, 1-1.5 weeks (done
  2026-10-23 at the sample cache for Level Adjust and the gauge, 4.7.3; PER_ROTATE natively with `--rotate on` since
  2026-11-08, 4.7.3; the PER_SIO seam open). 4, the eye
  sensor (I2C plus GPIO interrupt) driving the native chain to `0x50050efd`: 1 week. 5, the power manager: 2+ weeks,
  gated by hardware numbers (started 2026-10-29, 4.7.4: PWR_MAIN natively with the IO expanders stood in, and the
  power-off natively from shutDown; open: the expanders' chips, the battery and its messages). 6, a NAND register
  model and store F: 1-2 weeks, only for a full boot.
- **First step: done** (2026-10-23). The PER_SCPU dispatch is read (4.7.1) and S-SCPU-MSG is replaced by S-SCPU, the
  request server of 4.7.1's last bullet: the four D commands answered (rx written, `+20` called), every other command
  refused by its name, and `+0xe8 / +0xec` ticking with lab time. Step 2 followed the same day (4.7.2): the event and
  port words with IRQ 320, UI_IN's group 0 natively, and step 3 at the sample cache (4.7.3): ACC_MAIN and PER_SLOPE
  natively, the level gauge following a tilt input and Level Adjust completing. S-SCPU then gave way to the link
  (4.7.1, Built): PER_SCPU runs natively against S-SCPUDEV. Next is step 4, the eye sensor.

#### 4.7.1 The PER_SCPU request server (D unless tagged)

- **Transport:** PER_SCPU does not send commands through the `0x98e00000` window. A transaction is a frame on PER_SIO
  channel 2 (configuration `0xa32c6efc`: channel byte 2, clock word 6,000,000; transfer descriptor `0xa32c6f0c`, started
  with `0x5005f4ae` / `0x5005f587`) between two pins: PER_SCPU drives pin 103 low to request (`0x5005b72d(103, 0)`) and
  the SCPU answers with edges on pin 102 (callbacks `0x5005c989`, `0x5005c9dc`); pin 107 resets the SCPU (pulsed at
  `0x5005b9ab`, and at the task start `0x5005cec5` with "SCPU RST!" when the cause halfword `(0xa32bff5e)` is 0, 10 or
  11). The pin roles are D on both ends (the sub-CPU's PC3 is pin 102, its PB12 pin 103, scpu spec 3.1). Frames are `[length, command, data]` with length = data bytes + 2 in both
  directions (tx built at `0x5005bf6f..0x5005bf8a`; rx read as one length byte, then length - 1 bytes, `0x5005ca2d`). A
  request with more than 10 tx bytes or more than 253 rx bytes is split into `0x0f`-framed chunks (states 11..18).
- **Task and message:** PER_SCPU receives from the data queue PER_SCPU_RECEIVE ("PER_CMDM_DTQR", id `(0x600431bc)` =
  2) with no timeout through `0x5005cb09`, which copies the message out of a pool of 256-byte slots (`0xa32c7418`, sizes
  at `0xa32c9418`, u16 mask `(0xa32c9498)`) and frees the slot; senders call `0x5005cb93` from a task (timed send,
  5000) or `0x5005cc21` from interrupt context (`0x50010e06`, isnd_dtq). A message is an 8-byte header `{u16 event,
  u16 0x7a, u16 0, u16 length}` and its payload. Only event 11 comes from outside the task: the request API's message,
  whose payload is the 28-byte request. The task's own callbacks post the others: 5 the IRQ 320 callback `0x5005c8d9`
  (event bit 3 pending while port bit 3 is low: the SCPU has a message), 6 and 8 pin-102 edges, 7 the SIO send's end
  (`0x5005cabf`), 9 and 10 the receive callback (length byte, then the rest), 12 the watchdog (`0x5005b818` ->
  `0x5005b833`).
- **State machine:** `0x5004fe2e` is a generic table machine. Object `0xa32c6c2c`: +1 state, +2 event count 13, +4
  column count 8, +8 configuration `0x6011b4b4` (pre / post hooks `0x5005b87d` / `0x5005b8bf`), +12 the event map
  `0x6011afd8` (events 5..12 -> columns 0..7, 0..4 invalid), +16 the current message. Table `0x6011aff4`: 19 states x 8
  columns of `{handler, next state}`, next 254 = the handler sets the state, 255 = invalid (`0x5005c8a9`, errlog
  `0x1900270b`). The loop `0x5005b45e` defers event 11 into the queue `0xa32c6f28` (`0x5004fed5`, dequeued by
  `0x5004ff52`) whenever the state is not 0 or 2. States: 0 started, 1 after an SCPU reset, 2 idle, 3 request line low,
  4..10 one short transaction, 11..14 a long write, 15..18 a long read.
- **One transaction:** event 11 in state 2 (`0x5005bc9d`) copies the message to `0xa32c6c74` (the request at
  `0xa32c6c7c`), drives pin 103 low and arms pin 102 (3). The edge (6) builds the tx frame and starts the send
  (`0x5005bdf1` -> `0x5005be25`, 4). The send's end (7) and an edge (8), in either order (states 5, 6), lead to
  `0x5005bfb8`: a command with bit 7 clear (a write) completes there; one with bit 7 set (a read) arms pin 102 (7). The
  edge (6) starts the receive (`0x5005c022`, 8, 9); at the frame's end (10) `0x5005c0f8` copies r_size bytes from rx
  frame + 2 to the request's rx when rx is not 0 (10); the last edge (8) leads to `0x5005c143` -> `0x5005c18b`.
- **Completion (`0x5005c18b`):** `0x5005b406` copies the request and calls `+20` with a0 = `+24` (`calls (a1)` at
  `0x5005b41f`); no status is passed. `+20` is a run-time code address (disassembly = value - `0x10021020`). Then pin
  103 goes high, SIO channel 2 is released (`0x5005f25f(2)`) and the port byte (`0x5004df3f`) decides the next step:
  bit 3 low sends a zeroed request as the poll frame `[2, 0x8f]` (`0x5005be81..0x5005bea0`), whose reply carries an SCPU
  message; bit 3 high takes the next queued request (3) or goes idle (2). So rx is written before the completion runs,
  the completion runs in PER_SCPU's task (its flag setters take OlyEvSt, not iOlyEvSt, by `0x50017b6a`), and a write
  completes once its frame is sent, with no reply frame.
- **Inbound messages:** a poll's reply is dispatched by its command byte (bit 7 clear) through the two-level table
  `0x6011af98` (`0x5005b355`; the handler gets a0 = `{u32 length - 2, data pointer}` at `0xa32c6c24`): `0x08` ->
  `0x5005d43e` (data bit 0 -> UI_IN group 4 `0x0400`, as the `0x88` reply), `0x11` / `0x12` / `0x13` -> `0x50045138` /
  `0x50045171` / `0x500451aa` (in the power-manager code gap@0x50039c16), `0x40` -> `0x5000441b`; any other logs
  `0x1900270c`. The poll starts from idle on event 5 (`0x5005bc2a`) and after every transaction while port bit 3 is low;
  every read's frame passes the dispatch, which skips bit-7 commands. The layouts from both ends (read 2026-10-25,
  scpu spec 3.4): `0x08` {PC13's level} from the sub-CPU's port scan, bit 0 the switch `0x0400` (D both ends); `0x12`
  {5}, the sub-CPU's answer to the MN's `0x12` {5} (flag `(0x6004314e)` bit `0x10000`, D); `0x13` {0, flag, u16, u16}
  and `0x11` {0, a, b, 1, ...} (8 or 57 bytes) from its power manager and battery task, byte 0 checked by the MN's
  handlers (D), the fields' meanings ?; `0x40` n bytes from its USB PD interface (layout ?).
- **Gating and failures:** the task's init sets a block flag `(0xa32c94f3)` = 1 and sends `0x85 {2, 0, 0}` as its first
  request (`0x5005cf0a`, no completion), whose completion step clears the flag (`0x5005c306`). While the flag is set
  every command but `0x85` is refused (`0x5005bd2a`: errlog `0x1900270e` or `0x1900270a`, the completion called, rx not
  written). `0x85` with tx[0] 1 or 3 drops every queued request without its completion (`0x5005c20d`). The init arms a
  100 timer and every state from 3 on a 1000 timer (`0x5005b8bf`, PER_MINTIMER `0x5005899c`; the unit is ?). A timeout
  in state 0 resets the SCPU (pin 107) and waits again (state 1); a second one, or one inside a transaction, calls every
  pending completion without rx, logs `0x19002708` and stops CPU 0 (`0x5005c896`: `0x5003cc5c(1)`, interrupts masked, a
  branch to itself).

| Command | tx / rx bytes | Sender (flag or semaphore) | Meaning (strings, object names) |
|---|---|---|---|
| `0x01` | 9: `{u16 year, month, day, hour, minute, second, u16 status}` / - | `0x5012c7d9` (SCTIME_SET_DATA_WAIT 0xf7) | set the SCPU's date ("per scpu settime yyyy mm dd hh mm ss"); the date struct is `{u16 year, u8 month, day, hour, minute, second, 1/100 s, u16 status}`, its +7 not sent |
| `0x81` | - / 9, the same layout | `0x5012c88d` (SCTIME_GET_DATA_WAIT 0xf8) | get the date; status 0 = valid (`0x5012b76f`) |
| `0x06` | 6: `{index, u32 value LE, byte}` / - | `0x5005a770` "ScpuBkupW" (PER_SCPU_BK_REG_WRITE_W.. 0xf5) | write a backed-up word; the only caller writes index 2, byte 0 (`0x5005a6e2`) |
| `0x86` | 2: `{index, byte}` / 4: u32 LE | `0x5005a809` "ScpuBkupR" (PER_SCPU_BK_REG_READ_WA.. 0xf6) | read it; the only caller reads index 2, byte 0 (`0x5005a6ef`) |
| `0x02` | 2 / - | `0x50052bc9` (no direct caller) | GPIO write `{port, value}` on the SCPU's logical pin table (D on the SCPU side, scpu spec 3.3, 4.1) |
| `0x82` | 1 / 1 | `0x50052ca7` (semaphore PER_GIO_EXT_R 0x6c) | GPIO read `{port}` -> level (D on the SCPU side); the power manager's start reads port 45, PC13 (4.7.4, X) |
| `0x04` | 4n + 5: `{u32 address, n, n words}` / - | `0x5005d07d` (PER_SCPU_MEMRW_WAIT 0xf1) | SCPU memory write ("per scpu wmem") |
| `0x84` | 5: `{u32 address, n}` / 4n | `0x5005d127` (0xf1) | SCPU memory read ("rmem") |
| `0x80` | - / 4: u32 | `0x5005d2e8` (PER_SCPU_GETVER_WAIT 0xf3) | the SCPU binary's creation time ("per scpu ver"; `0x5005d218` adds 32400 s and prints "SCPU Build: mm/dd hh:mm") |
| `0x85` | 3: `{mode, x, y}` / 3 at `0xa32c94e9` | PER_SCPU (mode 2); the power-off path `0x5005cdfd` from `0x50044ca8` (by the setting `0xa011`: 19 -> {1, 1}, 9 -> {3}, else {1, 0}, `0x5005ce1d..4d`; PER_SCPU_SYSCTRL_WAIT 0xf2, then pin 102 polled low, returns rx[2]); `0x5005cf4e` (4 or 5, no direct caller) | system control (D on the SCPU side, scpu spec 3.3-3.4): 2 = power on (steady), which the SCPU requires before any command but `0x85` and `0x02`; 1 = power off, to bkground with PC13 low, else pwr_save for x = 1 and standby otherwise; 3 = pwr_save; 4 = hibernation; 5 = back to steady; 1, 3, 4 also make the sub-CPU drop its messages and ignore requests until its own wake |
| `0x07` | - / - | `0x5005d464` | the SCPU firmware update: `0x510369f8` ("[scpu]Start !") transfers the image (`0x51036bd6`), sends `0x85 {2}`, `0x07`, then polls `0x87` |
| `0x87` | - / 1 | `0x5005d480` (PER_SCPU_GETFIRMUP_COMP 0xf4) | update state, polled while it reads 1 |
| `0x88` | - / 2 | `0x5005d36a` from UI_IN `0x5014bf91` (PER_SCPU_GET_PORT_SCAN_ 0xd7) | port scan: retried up to 5000 times while rx[1] is not 0 (errlog `0x19002710`), then rx[0] bit 0 -> UI_IN group 4 `0x0400`; the sub-CPU's reply is {result, busy}, result bit 0 PC13 and bit 1 PC5, and the read enables its report `0x08` (D, scpu spec 3.4) |
| `0x12`, `0x13`, `0x14` | short writes, batched | the power manager through `0x5004322c` (semaphore PWR_COMM_SCPU 0x68, flag PWR_COMM_SND_SCPU_WAIT 0xee; builders `0x500433f9`, `0x50043452`, `0x500435dc`, `0x50043a47`, `0x50043abd`) | SCPU handlers `0x801570b`, `0x801535f`, `0x8015345` (and `0x80150a5` for an `0x11` with no MN sender) in its power manager; formats ? but for `0x12 {5}`, the start's handshake, which the sub-CPU answers with its message `0x12 {5}` (4.7.4) |
| `0x40` | n / - | `0x5102b8f7` (semaphore PC_PD_COMMUNICATION 0x7c; "USB SCPU_CONN", "PCPDC" beside it) | USB power delivery (I) |

The flag and semaphore names are the object-name table's (D); the commands' meanings beyond the strings are I.

- **What a session sends (X, a play session with S1 and a menu open and close):** the store init's three requests (and,
  since 2026-10-25, H-UIINSCAN's `0x88`; since 2026-10-29 on E143 the power manager's start, `0x82 {45}`, `0x12 {5}`
  and the poll of the sub-CPU's answer, and at a power-off `0x85 {1, 0, 0}`, 4.7.4):
  `0x06 {2, value, 0}` (from `0x5012c547`), `0x01` with the reset date (`0x5012b78c`) and `0x86 {2, 0}` (`0x5012c70a`),
  whose waits on 0xf5, 0xf7 and 0xf6 run natively (settings spec section 4; X: they return E_OK, since 2026-10-23 after
  PER_SCPU's transactions with the sub-CPU's model, before that at once with S-SCPU). The `0x06` writes `0x8000021c` and the `0x86` reads it back (X). Backup word 2 holds the
  time-zone setting, packed by `0x5012c685..0x5012c700` with bit 31 = valid (the 12-byte record `0xa32d7270`; minute
  fields up to 780 per zone, `0x5012c5c8`; field meanings I), so a reply of 0 means no record. The clock setting
  (`0x5012b7a7`, called from api_system.c) writes both the window clock (`0x5005a587`) and the SCPU's date (`0x01`); at
  boot `0x5012b767` (called from `0x500248b4`, not run in the lab) reads `0x81` and with status 0 sets the window clock
  from it, else resets it to 1970 (I: the window counter does not keep time over power-off, the SCPU's date does).
- **The firmware's checks of a reply (D):** the date's status and range (2000..2099, `0x5012b9ab`), the `0x88` reply's
  rx[1] = 0, and after a window clock write that `+0xe8` reads back within 5 s of the value written (`0x5005a71f..2a`,
  else ten retries with errlog `0x19001005` and the signature cleared). The window clock: `+0xe8` counts seconds since
  1970 in local time and `+0xec` bits 14..5 the 1/1024 s phase (readers `0x5005a5c9..0x5005a5f0`, `0x5005a6bb`); a write
  sets `+0xe8` and, when its second argument is 1, `+0xec` = 0 (`0x5004e337..0x5004e359`), then commits with `+0xf4`.
- **Retired: S-SCPU** (2026-10-23, the same day): a request server hooked at the request API `0x5005cd17` that answered
  the four commands, wrote rx and called `+20` natively before the API returned; PER_SCPU, its start and its inbound
  path did not run. Its memory model (the date echoed with its status, a get before any set refused) gave way to the
  sub-CPU's handlers (below).
- **Built: the link (S-SCPUDEV, S-SIO2, H-SCPUSTART; 2026-10-23,** `emu/src/lab/scpudev.mjs`, `emu/src/lab/scpulink.mjs`,
  `emu/src/dev/linkpins.mjs`; scpu spec 3 and 8). PER_SCPU runs natively: the lab starts its static task where the
  store init's requests need it (H-SCPUSTART: act_tsk, as the boot chain's `0x50024072` does, after the GIO init's
  slot reset H-GIOSLOTS, which PER_SCPU's registration of pin 102 needs), and the sub-CPU is at the far end of the
  wires PER_SCPU uses:
  - **The pins (register level, `src/dev/linkpins.mjs`, board `scpu_link`):** pin words 102 / 103 / 107 at
    `0x9b881b80` / `0x9b881bc0` / `0x9b881cc0` (+0 the level in bit 4 and the output in bit 0, +4 / +8 storage) and pin
    102's dedicated GIO interrupt (slot 191: status `0x9b883060`, enable `0x9b8831a0`, type-0 bit 1, type-1 bit 2, IRQ
    119), D from the GIO driver's tables, the same on E146 and E147. PER_SCPU's mode call attaches IRQ 119 natively and
    the GIO handler `0x50052a44` calls its callbacks in interrupt context. A-LINKPINS-1 (I): type 0 is the high level and
    type 1 the low level, a status bit holds while its level does (the callbacks disable the interrupt first, and the
    sub-CPU raises and drops PC3 back to back, D).
  - **S-SIO2 (PER_SIO's channel API, the one channel PER_SCPU opens):** open `0x5005f0f7` (the callback called), the
    configuration `0x5005f4ae` (channel 2, clock 6,000,000, X), a transfer `0x5005f587` (descriptor {+0 channel, +1
    directions, +2 / +3 tx / rx count, +4 tx, +8 rx, +12 tx callback, +16 its argument, +20 rx callback}, D from
    `0x5005f619`) and close `0x5005f25f`. A transfer's bytes go to the sub-CPU at once and its answer into rx; the end is
    delivered at the next idle point in interrupt context, rx callback (a0 = the descriptor) then tx callback (a0 = its
    argument), as the driver's glue `0x5005f7e9` / `0x5005f831` calls them (D). PER_SIO's registers, its init
    `0x5005f464` and interrupt handlers are not modelled; another channel's calls run natively as before (the EVF
    panel's channel 0, into the lab stub), another kind of transfer on PER_SCPU's channel stops the session.
  - **The message line:** port 3 of the window is the sub-CPU's PC2 (board `scpu.events.message`), high while no
    message is posted; the lab's doorbell may not pull it low.
  - **S-SCPUDEV:** the sub-CPU's side from its code (scpu spec 3.2, 3.3): the 10-byte receive, the command manager's
    transitions, the power-on gate (a frame it refuses stops the session, as it stops the sub-CPU), the reply framing,
    long writes and reads; the handlers of `0x85` (reply `{mode, 0x85 or for mode 1 its second byte, 1}`, the gate
    opened at the release of `0x85 {2}`), `0x01` / `0x81` (backup register 1 and the RTC: status 0 sets the RTC, any
    other status clears register 1; a get answers 2019-01-01 status 10501 while register 1 is 0), `0x06` / `0x86`
    (register index + byte; the body's words are its fact `scpu.words`, others refused) and a body's quiet writes
    (`scpu.quiet`: E134's `0x21`). Every other command stops the session naming its handler. Since 2026-10-25 the
    inbound direction (scpu spec 3.4, D): a message posted to the model (`post(command, data)`) drops the message line
    when the manager is idle (else it waits in the queue, and the line drops at once while a transaction runs), the
    poll is answered with its frame and the release delivers it; `0x88` answers {the scan's result, not busy} from the
    model's levels of PC13 and PC5 (both low in the lab, a model choice: PC13 low keeps the switch `0x0400` at the
    idle image's state) and enables the report, so a later change of PC13 is posted as `0x08` {level}; `0x85`'s
    release drops the waiting messages, sets the power-off flag (modes 1, 3, 4), the gate (1 and 3 close it, 2 opens
    it) and the power state (steady, bkground, pwr_save, standby, hibernation, by the system-control task's table); a
    request after a power-off stops the session (the sub-CPU's wake is not read). I: the scan's result follows the
    levels at once (its 3-sample debounce is not timed) and the scan is never busy. Its RTC advances with lab time,
    from the host's clock read once at the session's start under S-NVRAM (since 2026-11-08; before, it followed the
    host's clock throughout), whose file keeps the RTC's offset and the backup registers
    (`clock_status` derived from register 1; a file without register 1 takes it from its `clock_status`). A-SCPUDEV-1
    (I): the sub-CPU acts at the MN's idle points, one action per step, in zero lab time; a transfer's end comes first
    (`src/lab/kernel.mjs` LabTask `idle_step`).
  - **What a session does (X, E143):** the task pulses pin 107 (its cause halfword is 0 in the lab), waits
    for pin 102 high, sends `0x85 {2, 0, 0}` (reply `[5, 0x85, 2, 0x85, 1]`; PER_SCPU's state 0 -> 3 .. 10 -> 2), then
    the store init's `0x06 {2, 0x8000021c, 0}`, `0x01` with the reset date (the 11-byte frame cut to 10: status 10501
    arrives as 5, which clears register 1 as 10501 would) and `0x86 {2, 0}` (reply `[6, 0x86, 0x8000021c]`), each as
    PER_SCPU's states 3 .. 10; the requesters' waits return E_OK, no errlog of PER_SCPU's or PER_SIO's, the task back at
    its queue. 26 level changes on the pins, 8 transfers, every edge taken as IRQ 119 at the idle point. E146 sends the
    same three; E147's store init sends `0x86 {2, 0}` only (answered 0: a blank camera), as every request the API posts
    reaches the sub-CPU as a frame in order (X, test_scpu.mjs).
  - **Bodies:** E143, E146, E147 (the same PER_SCPU, pins and GIO tables, D), and E139 and E134: their PER_SCPU is
    E143's (the same task loop, init, state machine and frame constants: 10-byte short frames, 253-byte chunks, the
    poll `0x8f`, the `0x85` gate, D) but for its pins, ready 77, request 76 and reset 57 (E139 `0x50051ed3..de`,
    `0x5005362a`; E134 `0x500528ac..b7`, `0x50053fad`), its reset causes (0 and 8) and its PER_SIO channel (5, 8 MHz,
    X). Their pins sit in the E144 family's GIO block (words `0x9b80092c`, `0x9b800b8c`, `0x9b800bac`) and pin 77 has a
    group slot (IRQ 40, status `0x9b801e4c`, enable `0x9b801f28`, bits 0x40 / 0x80, words shared with the group's
    other pins), D from their GIO tables (MODELS board `scpu_link`); their message line is port 3, window word `0x64`
    (their port byte readers, D; board `scpu.message`). The ports place PER_SCPU's task entry and the slot reset by
    hand (MODELS overrides, D). Their sub-CPUs run other firmware lineages (scpu spec 2) whose images carry the same
    command manager (its log strings, the master-monitor timer and the power-on gate's messages, D); their receive
    count, gate code and handlers are not read, so the model answers them as E143's sub-CPU (I). X: both store inits
    run over the link as E143's (`0x85 {2}`, `0x06` / `0x01` / `0x86` on index 2 (E139) or 23 (E134), and E134's
    quiet `0x21` at its dial init), the waits E_OK.
  - **H-UIINSCAN (2026-10-25, `src/lab/play.mjs`):** UI_IN's module init's port scan `0x5005d36a` runs natively at the
    play bring-up on E143, E146 and E147 (fact `scpu.port_scan`: their request and `0x08` handler are E143's instruction
    for instruction, D; E139 and E134 have no request of that shape, X): the `0x88` transaction over the link, rx[0]
    bit 0 into `0x5014d537(0x0400, 0)`, group 4 unchanged, no code (X, E143; checked at the bring-up).
  - **The inbound path in play (X, E143, test_scpu.mjs --session):** the model's `0x08` {0} drops port 3, IRQ 320's
    PER_SCPU callback posts event 5, PER_SCPU polls `[2, 0x8f]`, the reply `[4, 8, 0, 0]` reaches the dispatch and
    `0x5005d43e` calls the producer with (0x0400, 0): nothing decoded, no errlog. PC13 high then posts `0x08` {1}: the
    producer takes the switch to its other state and UI_IN decodes `0x0400` and passes it on; the application's filter
    of the code `0x02020400` reads module 9's state at `0x50abb01d` (the same test as the listed reader `0x50abb039`, D),
    where S-TAKEOVER's scope stops the session, and allowing it leads to a further module-9 reader at `0x50b7a2de` (X):
    what the camera does on the USB switch is past the lab's stand-ins, so no input sets PC13.
  - **Not covered:** the sources of the battery, power-manager and USB PD messages (the model posts only the port
    scan's `0x08`; `post` can send any), the sub-CPU's wake after a power-off and its own power events, the watchdog's
    and the reset's error paths (the sub-CPU always answers), every command but the six (eight since 2026-10-29: `0x82` of the scan's ports and `0x12 {5}`, 4.7.4), PER_SIO at the register
    level.
  - **The window clock** ticks with lab time on the E143 board (E143, E146, E147) and on E139 and E134 (their MODELS
    boards). The other E144-family bodies keep it still: E137's and E130's operating-time count (E137 `0x5004d531`)
    writes a NAND record once the counter advances, and their start then stops at the NAND controller (X). A nonzero
    write to `+0xec` is a bus error (A-SCPU-3).

#### 4.7.2 The event and port words, IRQ 320 and UI_IN's group 0 (D unless tagged)

- **The words:** `+0x98` holds an event bit per port. The IRQ 320 handler `0x5004e1fd` reads it, keeps the byte at
  `0xa32bff60`, writes the word back (no `+0xf4` commit) and calls every registered callback in order (count
  `0xa32bff5c`, table `0xa32bff4c`); the SCPU init writes 127 to it before its commit (`0x5004dd87..89`). I: a write
  clears the bits it has set (the handler's write-back would otherwise leave a level IRQ high, and 127 is all seven).
  `+0xa0 + 4k` (k = 0..6) is port k: the port byte reader `0x5004df3f` packs bit 31 of each into bit k of a byte; the
  port setter `0x5004e3fc` writes a configuration word built from an 11-byte record (bits 0, 1, 2, 4, 5, 6, 8..23 and
  24..31 from its bytes 9, 7, 5, 8, 6, 4, 2..3 and 10; its meaning is ?), which UI_IN's port init `0x5014e3ab` applies to
  the ports a table per board variant names (`(0x6034f958)` etc. by `(0xa32dab38)`, `0x5014e3ab..0x5014e4a1`), and the SCPU init writes `0xffee`, `0xffee`, `0xffee`, 7,
  14, 14, `0xffee` (`0x5004dd55..81`). The handler's callers read a callback's events as a copy: `0x5004dfb4` returns
  the kept byte and `0x5004dfbd` clears bits of it.
- **The registration:** `0x5004ded1(a0 callback)` takes the hardware lock `0x5003b31e(0x09050009, 255)` (errlog
  `0x19001001` when it fails) and adds the callback while fewer than 4 are registered (more are dropped silently).
  Four sites register one: UI_IN's port init (`0x5014e514`: `0x5014e534`), PER_SCPU's task start (`0x5005b6a4`:
  `0x5005c8d9`), and two modules' inits at `0x50055c8b` (`0x50055c9b`) and `0x50057bf2` (`0x50057c07`). The boot head
  runs the SCPU init (`0x5000023a`, beside the IPI init's call `0x5000032b`), which clears the table and attaches IRQ 320
  (`0x5004e1fd`) and 321 (`0x5004e243`, the channel-done word `+0x94`) at level 5 (`0x5004de8e..a9`).
- **The callbacks pair event bit k with port bit k:** UI_IN's `0x5014e534` acts on any event (below); PER_SCPU's on
  event bit 3 with port bit 3 low (the SCPU has a message, 4.7.1: it posts event 5 into PER_SCPU_RECEIVE from interrupt
  context); `0x50055c9b` on bit 5 with port 5 low and `0x50057c07` on bit 4 with port 4 low (their modules are ?). UI_IN's
  edge table `0x5014c4dc` (`0xa32dabac`, 100 bytes per index) matches an entry's event bit with its port bit too. So
  ports 3..5 are request lines from the SCPU, active low.
- **UI_IN's callback:** port byte and event byte; with any event bit set (and UI_IN's edge table, empty in the lab, run)
  it stores the byte at `0x62988828`, pushes it as a 1-byte group-0 record (`0x5014cb74(1, 0, ...)`) and sets UI_IN's
  flag with OlyEvSt or iOlyEvSt by `sns_ctx` (`0x5014e597..be`). Group 0's seven entries are the port's seven bits:
  power `0x000c`, Fn lever `0x1223`, S1 `0x0100`, three code-0 entries (the request lines, which UI_IN drops), `0x1229`
  (input spec section 2). UI_IN's start stage `0x5014bfc6` (via `0x5014b729`, boot call `0x50024b84`, the call after UI_IN's module init's
  `0x50024b7d`) first calls
  `0x5014e51e`, which sets group 0's old state `0xa32dade8` (and `0x62988828`) from the port byte: the levels at power-on
  decode no code.
- **The port scan:** `0x88` (`0x5005d36a`, 4.7.1's table) has two senders, UI_IN's module init (`0x5014bfb2`) and a
  record handler of UI_IN's ring processor (`0x5014c7da`, a record kind the lab never pushes). Since 2026-10-25 the
  lab runs the first in the init's place (H-UIINSCAN, 4.7.1) and S-SCPUDEV answers it: rx[0] bit 0 is the sub-CPU's
  PC13, which sets group 4's `0x0400` through the producer (scpu spec 3.4).
  `+0x9c` (request bits: `0x5004dffc` sets bit n, `0x5004e02c` reads one, seven calls each at `0x519d2153..0x519d221b`,
  ?; `0x5004dfd0` writes 127 at the end of the power-off, 4.7) is storage since 2026-10-29 (4.7.4); `+0x94` / IRQ 321
  (the transfer channels) have no user in the lab and stay bus errors.
- **Built (2026-10-23, `emu/src/dev/scpu.mjs`, `emu/src/lab/play.mjs`):** the device models `+0x98` (pending bits, a
  write clears, I) and the port words (bit 31 the level the lab sets, the other bits 0, A-SCPU-4; a write was a bus
  error until UI_IN's power-off wrote them, 2026-10-29: now it keeps the configuration word without an effect, 4.7.4),
  and drives IRQ 320 while a bit is pending; a level change of
  either direction sets the port's event bit (I: UI_IN decodes both edges of S1 and the levers from this one event).
  The lab sets the levels through a doorbell (`0x89a40000`, command 1). At bring-up, H-SCPUIRQ sets the idle levels
  (`0x3c`: S1 and the request lines high), writes 127 to `+0x98` as the init does and attaches IRQ 320 at level 5
  through the firmware's attach; H-UIINPORT registers UI_IN's callback through `0x5004ded1` (a later registration of
  another is refused; PER_SCPU registers its own natively at its start since 2026-10-23, before UI_IN's, and acts on
  port 3, the sub-CPU's message line, 4.7.1) and runs `0x5014e51e`; group 0's inputs then set the levels (H-SCPUPORT) and the CPU takes IRQ 320 at the idle
  point: handler, callback, push and flag run natively, and UI_IN decodes the change (X: S1 down and up post
  `0x02000100` / `0x02010100`, the Fn lever `0x02021223` both ways, the power lever `0x0202000c`). No interrupt
  delivery beyond the idle point is needed: a key arrives while the CPU idles. H-POWER still closes the session after
  the lever's code (4.7, power-off). Bodies: E143, E146 and E147 (`src/fw/models.mjs` scpu_port: their inits,
  registrations, callbacks, port readers and old-state inits match E143's instruction for instruction but for their
  addresses and E147's errlog line number, D; E147 keeps the count at `0xa32bff60`); the E144 family's event and port words sit in its compacted map's storage and are not modelled, so
  its bodies push group 0 with S-KEYBITS as before.

#### 4.7.3 The accelerometer's consumers: the level gauge, Level Adjust and PER_ROTATE (D unless tagged)

Read 2026-10-23 for step 3 from the module's own debug strings (`per_acc.c`), the gauge's API and HFW operation
(`OlyApiLevelCtrl`, `OlyHfwOpeLevel.cpp`) and the code between them; the double-precision helpers were identified by
running them on the lab CPU (X: `0x5002ac35` divides, `0x5002aeb3` multiplies, `0x5002a98f` adds, `0x5002a983`
subtracts, `0x5002aea3` negates, `0x50027943` is sqrt, `0x5002a8b7` / `0x5002a912` truncate to an integer,
`0x5002b1d5` / `0x5002b1df` convert one).

- **Two caches.** The cache copy `0x50049201` (ACC_MAIN, every 80 ms) puts the newest sample into the raw cache
  `0x62963f60..64` (accelerometer x, y, z in the sensor's axes, LSB) and `0x62963f6c` (temperature). The correction
  `0x500493dc` writes the corrected cache `0x62963f66..6a` (the debug print `0x50048b37`: "x raw ... temp_delta ...
  offset_delta ... correct"). Readers go through two accessors that also return the counter: `0x50049771` (raw: Level
  Adjust) and `0x50049795` (corrected: PER_SLOPE, PER_ROTATE `0x5005a17e`, the other ACC users). The copy compares the
  counter with `(0x6034d9e4)`, which nothing writes (no store to it in the image), so it copies whenever one sample has
  arrived and counts misses only before the first; after five misses it returns `0x8001` and ACC_MAIN logs errlog
  `0x46000202`.
- **The correction and its gate.** `0x5004b4a1` opens the gate only when data object `0x4e8a[0]` != 1000 and
  `0x4efa[29]` == 5031; closed, the corrected cache is the raw one. Open, per axis: corrected = raw + temp_delta +
  (ref[pose] - (offset[pose] - offset_temp_delta)), with temp_delta = (offset[pose].temp - temp) x a / 100000 when the
  axis's temperature calibration type is 0 (types and coefficients: `0x4efa` / `0x4f0a` / `0x4f1a` elements 24..26,
  loaded by `0x5004b431` into `0x6296405c`), ref the pose references below, offset the user pose table `0x62963f70`
  (`0x500494e7`: data objects `0x4eba` / `0x4eca` / `0x4eda` / `0x4eea`, x / y / z / temperature, index = pose) and
  pose `0x5005a175()`, PER_ROTATE's orientation `(0xa32c64f8)`. Temperature: `0x500497b9` = (raw / 256 + 25) x 10, in
  0.1 degC (256 LSB/degC is LSM6DSL's by ST's map, I).
- **Pose references.** `0x50048d14` (from the init) writes six vectors of three halfwords at `0x6034d9b0` from the
  axis order and polarity 1, -2, 3 (its abs() tests on constants; error string "ACC_ROTATE_AXIS_ORDER_POLARITY"): pose
  0 (0, -16384, 0), 1 (16384, 0, 0), 2 (0, 16384, 0), 3 (-16384, 0, 0), 4 (0, 0, 16384), 5 (0, 0, -16384). The same
  six are the factory pose table's image templates (data objects `0x4e7a` / `0x4e8a` / `0x4e9a`, x / y / z, store F;
  `0x4eaa`, temperature, 250 each). Pose 0 is "ACC_MODE_ORIENTATION_ROTATE_0" in Level Adjust (below): the level camera
  reads sensor y = -1 g, 16384 LSB being the firmware's 1 g.
- **Scale and axes.** `0x500497df` converts LSB to mg with the double 0.061 (`0x3faf3b645a1cac08`; ST's 0.061 mg/LSB
  at +-2 g, I). The remap `0x5005ff7d` gives body[i] = sign(t[i]) x sensor[|t[i]| - 1] with t = `(0x6034e170)` = 1,
  -2, 3 (image data): body x = sensor x, body y = -sensor y, body z = sensor z.
- **PER_SLOPE** (task 78, entry `0x5005fb9c`; its init `0x5005fb31` creates flag "PER_SLOPE", sets the state
  `(0x62965141)` = 1 and the offset `(0x62965162)` = property `0x8bca[0]` / 10, starts the task, names it
  "PER_SLOPE_TSK"). Idle (`(0x62965144)` != 1) it sets the state to 2 and waits on its flag; the GUI's startLevel
  (`0x504250e9` -> `0x5005f92d`: mode 0, active, flag set; `0x5005f94f` is mode 1) starts it and endLevel (`0x5042511c`
  -> `0x5005f970`) stops it; startLevel runs when the application starts (X). Active, every 20 ms: the corrected sample
  and the counter; when the counter moved, the orientation `0x5005a175()` (a change re-inits through `0x50048ea9`), the
  remap, mg, a stability test `0x5005fd06` (a two-sample ring of the mg of the axis the horizon is read from, x in
  orientations 0, 2, 4, 5 and y in 1 and 3; max - min > `(0x62965164)` = 50 is "unstable HI", > 25 "unstable LO") into
  the state, and per axis the angle `0x5005fe5d(mg)` into the doubles `0x62965148` (x), `0x62965150` (y), `0x62965158`
  (z); then, in mode 0, event `0x4125000` through the publish `0x50025088`. 500 passes (10 s) without a new sample set
  the state to 2. `0x5005fe5d` is asin in degrees by table: |mg| clamped to 1000; below 256 mg the index is 4 x |mg|,
  above it 1024 + (|mg| - 256) / 1.5, capped at 1535; the u16 table `0x6011bedc` holds 0.01 degree (index 4: 5, 1 mg ->
  0.05; index 1186: 2993, 499 mg -> 29.93; 1520: 9000), signed by the input, / 100 (X on the lab CPU: 999.4 mg ->
  86.86).
- **The gauge's getter** `0x5005f982(record)`: +10 the orientation; the horizon +2 = (short)(10 x roll) with roll =
  -angle_x in orientations 0, 2, 4, 5, angle_y in 1, -angle_y in 3, and, if Level Adjust has not adjusted
  (`0x5004a4c2(5)` returns `(0x62964080)` = 0) and the orientation is 0..3, minus `(0x62965162)`. The vertical +6 =
  (short)(10 x pitch) with pitch = -angle_z / 3 in orientations 0..3 (`0x5005fa2c..54`: divided by 3.0, times -1.0; why
  a third is not read), angle_y in 4 and 5. +4 and +8, the validities, are 1 unless the state is 2; a caller's +11 = 11
  clears them. `0x50425c2e` (through `0x5042514f`) copies it out for `OlyHfwOpeLevel::getSlope` `0x50b639d2` (called
  from OlyApiLevelCtrl's getSlope `0x50b461b8`), which ("roll[0] ... pitch[1] ... slope_state") returns the horizon
  (negated when `0x50ab651a(1, 0)` is 1, `0x50ab4057()` and property 678 is 1: a mirrored view, I), the vertical, the
  body (the orientation 0..5) and the reliability (both validities 1). The GUI reads it on each redraw of the shooting
  screen's level gauge (X: two getSlope calls per redraw, each through `0x5042514f` and `0x50425c2e`); the gauge draws
  its arc and bar green when level, lights the arc's segments by degree and puts an orange end mark past its range (X,
  pixels).
- **Level Adjust** (Setup page 6 row 3, panel 387, "Adjusts the 0 level to the current position", Reset / Adjust).
  `OlyHfwOpeLevel::calibration` `0x50b638c6` and `::reset` `0x50b63bac` call `0x503dbd59(1 or 2, rotate)` (api_adj.c),
  which calls per_slope_adj `0x5005fa9e`: Adjust -> `0x5004a4c2(1, 0x5005a175())`, Reset -> `0x5004a4c2(2, 11)`; a
  result of 0, 4 or 161 is success. In `0x5004a4c2`: op 0 "PER_ACC_ADJ_FACTORY_RESET" (the factory table), op 1
  "PER_ACC_ADJ_USER_RESET" (Adjust), op 2 "PER_ACC_ADJ_USER_CLEAR" (Reset: the user table = the factory table,
  `(0x62964080)` = 0), ops 3 and 4 the temperature calibration, op 5 returns `(0x62964080)`, op 6 the last statistics.
  Op 1 samples with `0x5004ad13`: a pool-2 heap block (`0x5000314c`), then until the raw counter has changed 12 times,
  every 20 ms (dly_tsk), one raw sample and the temperature; then per axis the sum, min, max and the standard deviation
  x 100 (`0x5004b30a`, `0x5004b379`) into `0x6296408a..b8`, the means to the caller, the block released
  (`0x50003156`). With pose 0 it writes all six user poses as factory[k] + (mean - factory[0]) (x, y, z and
  temperature, through the setter `0x5004188b` into store E); with a pose k > 0 only pose k = the mean; then it
  reloads the temperature parameters and sets `(0x62964080)` = 1. It does not check the mean against a tolerance (no
  such test in op 1). At boot `0x5004aa9f` sets `(0x62964080)` = 1 when any user pose differs from its factory pose in
  the two axes across gravity or in temperature. So a camera with factory data (the gate's `0x4efa[29]` = 5031) zeroes
  its gauge at the adjusted position; with the lab's blank factory data (the image templates, `0x4efa[29]` = 8192)
  the gate stays closed and Adjust changes the store and `(0x62964080)` only, not the gauge (D, X).
- **Built (2026-10-23, `emu/src/lab/acc.mjs`, `emu/src/lab/play.mjs`, `src/fw/models.mjs` acc and heap_pool), seam
  (b), the sample cache.** Seam (a) was not taken: the sampler ACC_SENS_MAIN is started per sample by the data-ready
  pin's callback (`0x500490a9`, registered by the device part `0x500493ac` through the pin layer `0x50051a29(129)`, a
  GIO pin whose init does not run) and reads through PER_SIO's transfer layer (`0x5005384b` / `0x500538bf`), which has
  no model; its completion sets a flag in interrupt context. H-ACCINIT runs the module init natively at the play
  bring-up, before the application starts, with the call of the device part stepped over (the init's other work, the
  references and the user, factory and temperature tables from the store, runs as on the camera), checks the two
  pointers it stores and lets ACC_MAIN (task 121) start. S-ACCREG answers the register API `0x5004c971` /
  `0x5004cb57` / `0x5004cb6d` / `0x5004cb4c` from a register file: WHO_AM_I `0x6a` (the value the probe wants, D) and
  the two set-up writes kept; any other access stops the session. ACC_MAIN then runs natively: the probe (X: open (6,
  107), read 0x0f -> 0x6a, write 0x10 = 0x10, write 0x0d = 1, close; `(0x62963fb8)` = 1; its last call
  `0x50051a7d(129)` enables the pin's GIO interrupt with five accesses to the words `0x9b883080` / `0x9b8831c0`, which
  the lab stub keeps), then its 80 ms cycle. S-ACCSAMPLE stands for the sensor, its pin, ACC_SENS_MAIN and the
  transfer: before each of ACC_MAIN's cache copies it stores one new sample as the completion `0x5004910a` does (the
  halfwords `0x62963fd6..da` and `0x62963fde`, the counter + 1, D), so the copy and the correction run natively
  (A-ACC-2: one sample per 80 ms cycle; the probe's CTRL1_XL 0x10 is 12.5 Hz by ST's map, I). H-ACCINIT then runs one
  cycle's copy and correction from the lab task, the samples a camera has before its GUI starts (without them
  PER_SLOPE's state is still 2 at the GUI's first gauge read and the gauge is drawn invalid, X). H-SLOPEINIT runs
  PER_SLOPE's init natively (task 78); the application's startLevel then runs it natively. The sample is the pose-0
  reference (0, -16384, 0) for the level camera, turned by the play input `{type: "tilt", roll, pitch}` (degrees):
  the body reading 16384 (-sin roll cos pitch, cos roll cos pitch, -sin pitch), mapped back through the axis table;
  temperature raw 0, 25.0 degC (A-ACC-1). Roll is what the getter reads back as the horizon, pitch three times its
  vertical; which way is positive physically has no camera evidence (A-ACC-3). Tilts stay within 45 degrees with y
  dominant (A-ACC-2): without `--rotate on` PER_ROTATE does not run, so the orientation `(0xa32c64f8)` stays 0
  (with it, below). S-HEAP also serves pool 2's
  block get and release (`heap_pool`): natively the get handed out the pool's first block `0x62424700`, which S-HEAP
  had already given out, and Level Adjust's statistics overwrote it (X: the session stopped in task 164 at
  `0x50ab2930`). A tilt step waits 250 ms (TILT_MS) and records the sample and the getter's reading (run natively).
- **Checked** (`emu/checks/check_level.mjs`, E143 in `checks/runs.json`, E146 in `bin/test.mjs`): L1 the probe's
  accesses, its success halfword and ACC_MAIN's wait; L2 12 or 13 counter moves in 1 s, the raw cache = the level
  sample, the corrected cache = the raw one; L3 the getter within 0.2 degree for five tilts and the gauge's pixels
  (the arc and the bar green when level, the arc not green rolled 5 degrees, the bar not green pitched 9); L4 Adjust
  at roll 2, pitch -3: the GUI back at its message receive on the shooting screen within 2 s and the store's user pose
  0 = that sample with 250. Negative controls (`--mutants`): acc-still (no sample) fails L2 and L4, tilt-ignored fails
  L3 and L4. Bodies: E143 and E146 (the init, ACC_MAIN, the probe, the completion, the copy, the correction, the
  register API and PER_SLOPE compare instruction for instruction with E143's but for addresses, D; E146's getter calls
  the adjust machine with a larger frame, and that machine has a seventh op). E147's ACC code differs (D: its probe
  wants WHO_AM_I 0x70 and its ACC_MAIN copies every 30 ms only while an enable halfword is 1), so it keeps the
  accelerometer off; the E144 and E118 families are not read. E147's survey (read 2026-11-08, D unless tagged; its
  addresses, E143's in brackets): the init `0x50049416` [`0x50048cad`] runs the same parts in the same order (the
  device part `0x50049b44` with the data-ready pin 129, the two pointers `0x6298d750` / `0x6298d754`, the store
  tables, the references with the axis order 1, -2, 3); the sampler ACC_SENS_MAIN `0x50049700`, its pin callback
  `0x50049849`, the 14-byte read from register 0x20 on channel 6 (`0x5004e26e`), the completion `0x500498aa` (bytes
  0..1 the temperature `0x6298d7d6`, 8..13 the accelerometer `0x6298d7ce..d2`), the correction `0x50049b74`, the
  conversion `0x50049f77` (0.061 mg per LSB), the remap `0x5005cb7c`, PER_SLOPE's init and task (`0x5005c730`,
  `0x5005c79b`) and PER_ROTATE's init, getter and task (`0x50056cf8`, `0x50056dc1`, `0x50056dea`) compare with E143's
  instruction for instruction but for absolute addresses; the gauge's getter `0x5005c57f` calls the adjust machine
  with E146's larger frame. What differs: the probe `0x50049771` wants WHO_AM_I 0x70 (I: ST's LSM6DSV family; E143's
  0x6a is the LSM6DSL's) and writes register 0x10 = 3 [0x10] (I: an output rate of 15 Hz on the LSM6DSV's map) and
  0x0d = 1 as E143; its success sets the halfword `0x6298d7b0` = 1, which is also ACC_MAIN's enable. ACC_MAIN
  `0x50049640` [`0x50048ec2`] probes once, then copies and corrects every 30 ms (`0x5002c6e5(30)`) [every 80 ms
  through OlyTaSS(80)] while `0x6298d7b0` is 1, else waits 50 ms; `0x50049616` / `0x50049621` set and clear it
  ("per_acc_start() ucAcc_state", "per_acc_stop()"), called from the debug commands `0x5004ac54` / `0x5004ac72` and
  from `0x5004ac90..0x5004aed4` ("Stop Acc Main Task"). Its copy `0x500499a1` (into `0x6298d758..5c` / `0x6298d764`)
  returns 0 also at its fifth miss, where E143's returns 0x8001, so ACC_MAIN's own count of failed copies and its
  errlog `0x46000202` are not reached (I). So E147 would need its WHO_AM_I and rate write in S-ACCREG and a 30 ms
  cadence in S-ACCSAMPLE (A-ACC-2's one sample per cycle); not built.
- **PER_ROTATE** (task 59, entry `0x5005a17e`, read 2026-11-08; its name "PER_ROTATE_TSK" and its debug command
  `0x5005a462`: init, start, end, get). The init `0x5005a08c` (the boot's call at `0x501e9c2b`, right after PER_SLOPE's
  init at `0x501e9c17`) stores data object `0x1f82[0]` (`0x500417da(8066)`) at `(0xa32c64f0)`, the state `(0x62965124)`
  = 0, the reported index `(0xa32c64f4)` = 0, three table indices `(0x62965128)` = 10, `(0x6296512c)` = 50,
  `(0x62965130)` = 60, the magnitude tolerance `(0x62965134)` = 400 and the orientation `(0xa32c64f8)` = 0, then calls
  the start `0x5005a0f7` (state 0 -> 1; state 2 -> 1 and its flag `(0x60042fda)` set, with iset in interrupt context)
  and starts and names the task. The end `0x5005a14a` sets the state to 2. The task, while the state is not 1, waits for
  its flag; else per pass: the corrected sample `0x50049795`, the remap `0x5005ff7d`, each axis to mg truncated
  (`0x500497df`, `0x5002a912`); the magnitude sqrt(x^2 + y^2 + z^2) (pow with 2.0 `0x500275f5`, sqrt `0x50027943`) must
  lie in 1000 +- 400 mg, else the pass changes nothing; h = sqrt(x^2 + y^2) and e = sqrt(1000^2 - h^2) (0 when h >=
  1000), z's share of 1 g (I: z the lens axis). The tables: T1 `0x6011a080`, 90 words 100, 102, ... 11459 (I: 100 tan(45
  + i/2 degrees)), T2 `0x6011a1e8`, 91 words 0, 17, ... 1000 (I: 1000 sin(i degrees)). If e > T2[50] = 766: e > T2[60] =
  866 sets orientation 4 (z > 0) or 5, else nothing changes. Else, |y| > |x|: 100|y| > T1[10] |x| (T1[10] = 119, I: tan
  50 degrees) sets 0 (y > 0) or 2, else nothing; |x| > |y|: 100|x| > 119 |y| sets 1 (x > 0) or 3; equal, nothing. So
  portrait comes past 50 degrees of roll and goes below 40, and the lens up or down comes past 60 degrees of pitch and
  goes below 50 (I, from the tables; X, below). The reported index: orientations 0..3 -> 1..4; 4 and 5 keep an index of
  2 or 4 and else report 1 (so upside down, 3, does not survive the lens pointing down). A changed index is stored and
  event `0x4020310` published (`0x50025088(0x4020310, 0)`); then a 100 delay (`0x5002c6e5(100)`). The getter
  `0x5005a155` returns 1 when `(0xa32c64f0)` is 1, else the halfword of the table `0x6034e164` {11, 1, 6, 3, 8} at the
  index: the debug command's ROTATE_DISABLE, ROTATE_0, ROTATE_90, ROTATE_180, ROTATE_270 (I: EXIF's orientation codes);
  the orientation itself is `0x5005a175()`. Its API: get `0x5041d376` (request `0x80001`), start `0x5041d3da`
  (`0x80003`) and end `0x5041d40e` (`0x80004`), the last two called only from the HLS's wrap `0x50abb6d8` /
  `0x50abb6e1`. The get API's callers: the HFW's `getCameraOrientation` (below), Level Adjust's calibration and reset,
  the play components (CmpPls_PlaySingleComponent, CmpPli_PlayIndexComponent, Cmp_PlayComponentBase,
  CapImg_ImagePlayer), the Wi-Fi remote take, Bluetooth and `0x501e7a22`. The getter's direct callers: takepic's
  `0x503bcd51` stores its code at `+0x950c` of its shooting record next to the gauge's record at `+0x181a`
  (`0x503bd0ee..0x503bd112`; I: the picture's orientation for its tags), four sites in the movie and face libraries
  (`0x5050d1f2..0x5051dd8c`), `0x5006000d` and `0x517fe243`. The orientation's readers: the correction's pose, PER_SLOPE
  (a change re-inits it), Level Adjust's `0x5005fa9e`, `0x5004a003`, `0x50989813`, `0x5100db44`. E146's init
  `0x5005bb0e` and task `0x5005bc00` compare with E143's instruction for instruction but for absolute addresses, with
  the same tables, words and getter table (`0x6034e2b8`); its publish is `0x50025153`.
- **Built (2026-11-08, `--rotate on`, `emu/src/lab/acc.mjs`, E143 and E146).** H-ROTINIT runs PER_ROTATE's init
  natively after PER_SLOPE's at the bring-up, which starts the task (59); off by default, because the task's passes
  change every E143 session's interrupt and stop records (X: golden's keys, shoot-tft and play-perf differ with it on).
  The data object `0x1f82` reads 0 on the lab's store (X). The tilt input then takes any attitude (roll within 180,
  pitch within 90 degrees: S-ACCSAMPLE's reading turned all the way round) and its step waits 500 ms (X: over 13 turns
  the orientation changed 40 to 160 ms after the input and the gauge's body 50 to 230 ms after it). What runs (X):
  the session starts with index 1 (EXIF 1, the bring-up's first pass); roll 48 and 42 hold the last orientation, 52
  turns it to 3 (EXIF 8) and -52 to 1 (EXIF 6), 38 back to 0, 180 to 2 (EXIF 3); pitch 55 holds, 65 turns it to 5,
  keeping index 4 from portrait and dropping 3 to 1; one event per index change. The application reacts natively: on
  each event the GUI calls the get API twice through the HFW's `getCameraOrientation` (`0x50ac518a`: 6 -> 1, 8 -> 3,
  else 0; from the GUI's `0x5104a755` through `0x50abeda7`), and the shooting screen's level gauge (INFO) is laid out
  for portrait: EXIF 8 its arc at the left and its bar at the bottom, EXIF 6 its arc at the right and its bar at the
  top, EXIF 3 as level (pixels); PER_SLOPE's getter then reads the roll from upright as its horizon (roll 95: 4.9
  degrees). The rest of the shooting screen does not turn. The picture's orientation is not reached: at a release in
  portrait no caller of the getter but the GUI's ran (TAKE answered by S-MODACK), and S-RECFILE's JPEG has no EXIF.
- **Checked** (`emu/checks/check_level.mjs --only R1,R2`, E143 and E146 in `bin/test.mjs`): R1 the transitions above
  with their events and the getter's body, refusals without `--rotate on` (50 degrees) and with it (181); R2 the
  gauge's portrait layouts by pixels. Negative control `--mutants --only R1,R2`: no-rotinit (the range without
  H-ROTINIT) fails both.
- **Toward the PER_SIO seam (tried 2026-11-08, not built; X unless tagged).** With the device part run natively in
  place of H-ACCINIT's step-over, `0x500519ce(129, 5)` attaches IRQ 127 (the GIO slot whose status and enable words
  are `0x9b883080` / `0x9b8831c0`, the ones the probe's enable writes), `0x50051a29(129)` registers the pin callback
  `0x500490a9` and `0x5004c903` makes the register API's objects; the session then runs on as before. With S-ACCREG
  also off and S-SIOIIC's channel map set on E143 (H-SIOMAP, the setter `0x5005f0b2`: channel 6 is controller index
  5), the probe's open runs natively into PER_SIO's channel open `0x5005f0f7(6, 1)` and the IIC configuration
  `0x5005373f`, whose lower configuration takes index 5's register words from the table `0x6011b614` (136 bytes an
  index, D) and stores 0 at `0x98500028` (`0x5005d7cf`), a page E143's lab stub denies, which stops the session. So
  the seam needs, in order: a model (or storage) of that controller block's configuration registers, the sensor as
  an S-SIOIIC device at address 0x6b (WHO_AM_I, the two set-up writes, the 14-byte read from register 0x20; I: with
  ST's auto-increment), the data-ready pin 129 as a GIO input on IRQ 127 (I: its level word at `0x9b882240`, pin
  word = `0x9b880000` + 64 x (pin + 8) by the link's pin 102 and the HDMI pin 77) raised at the sensor's rate on lab
  time and dropped by the read (I: ST's latched data-ready), and ACC_SENS_MAIN (task 132) allowed; the H-SIOMAP
  change of every E143 channel's index (the link's channel 2 among them) is untested.
- **Not modelled:** PER_ACC_PWRMGR_MAIN, the gyroscope words, the data-ready pin and ACC_SENS_MAIN, factory
  calibration data (store F) and the temperature compensation (calibration type 255 on the templates); the
  picture's orientation tag (TAKE and REC_FILE do not run); PER_ROTATE's start and end from the HLS (`0x50abb6d8`,
  not reached).

#### 4.7.4 The power manager and the power-off, natively (E143, E146, E147, 2026-10-29; D unless tagged)

Read and built 2026-10-29 (`emu/src/lab/power.mjs`; the addresses read from each body's firmware by
`emu/src/fw/facts.mjs` powerOff, fact `power.off`, with E143's evidence at POWER_OFF_E143 there; `emu/src/fw/models.mjs`
power_native names the bodies that run it). Before it, 4.7's power-off bullet: with the lever's off decoded natively
and the session left open, the GUI stayed in shooting with no write to `+0x9c` (X), and the power manager did not run.

- **Why PWR_MAIN did not run (X, D):** PWR_MAIN is task 10, entry `0x50043cdb`, created dormant from the static task
  table. The boot's task starter `0x50023eca` (called by the init task `0x5002cca5`) starts it: after PER_SCPU's start
  (`0x50024072`), the body IO expander's init `0x50055e10` (`0x50024095`, which starts PER_IOEXP, task 136), the PBH
  expander's `0x500540fc` (`0x5002409c`, PER_IOEXP_PBH, task 140) and `0x50059649` (`0x500240b0`), it runs the power
  manager's init `0x50044eb6` (`0x500240c4`) and starts the task through OlyTaSt (`0x500240cb..d2`, the id word
  `0x60042d3a`). The lab runs none of the starter, so all four tasks stayed dormant in every session (X).
- **What it waits for (D):** its loop waits (OlyEvWt `0x5002bdd8`, no timeout) on flag 11 (the word `0x60042f86`) for
  pattern 7: bit 2, the messages of its queue 10 (the word `0x600431d8`; each dispatched by `0x50043f55` over its
  event table, events 1..13), bit 4 (`0x50043f55(6, 0)`) and bit 1 (`0x50043e6d`). The init runs the start-up message
  `{0x100, 0x20}` through the task's own handler `0x5004408f` on its caller's task: a GIO read of the sub-CPU's port 45
  (`0x82 {0x2d}`: PC13), the power manager's handshake with the sub-CPU (`0x12 {5}`, which the sub-CPU answers with
  its own message `0x12 {5}`, scpu spec 3.4) and two writes of the PBH expander's GIO extension pins (X).
- **What it needed (X):** started alone, its init stops at the GIO read (S-SCPUDEV refused `0x82`) or, with the
  sub-CPU's own firmware, blocks in the PBH expander API's wait (`0x50055716`): the expanders' tasks do not run. They
  talk to their chips through PER_SIO's transfer layer (`0x5005373f`, `0x5005384b`, `0x500538bf`, the one the
  accelerometer's register API uses), the body's on channel 10 (its open at `0x50057dff`), and take a GIO interrupt
  (`0x500503d4`, `0x50054012`); their logs name PL061-like registers (`[IOEXP]IS`, `IBE`, `IEV`, `IE`, `RIS`, `MIS`,
  `DATA0..2`; the chips' identities are ?). A request posts a 36-byte message to the task's data queue (body
  `0x50056a85`, queue word `0x600431be`; PBH `0x50054ede`, `0x600431c0`) and its caller waits for bit 1 of the task's
  flag with a timeout (body `0x50056c93`, `0x60043170`, 1000; PBH `0x500550f4`, `0x60043180`, 1500); a timeout logs and
  stops the system through `0x5003cc5c(1)` and a branch to itself (`0x50056cde`, `0x5005513f`; X: the power-off did,
  before S-IOEXP). Built: **S-IOEXP** completes each posted request at the next idle point as the task would: the
  flag's bit 1 for a request without data, the callback with its argument for the GIO extension's write (`0x500541f3`:
  request 1 with `{+0 pins, +4 a byte, +8 the word, +16 callback, +20 argument}`, `0x50054237..5a`; I: that the task's
  completion calls it as the API's own direct path does while the PBH's state `0xa32c4915` is 5, `0x5005421d..33`); any
  other request stops the session. **H-PWRSTART** runs the init and starts PWR_MAIN at the play bring-up, after
  H-UIINSCAN; **S-SCPUDEV** answers `0x82` for the scan's two ports (its levels: PC13 0) and `0x12 {5}` with the
  message `0x12 {5}` (the sub-CPU's handlers `0x800cfef` and `0x801570b` -> `0x801534c`, D). X (E143): the start's
  frames are `0x82 {2d}` -> `[4, 0x82, 0, 0]`, `0x12 {5}` and the poll `[2, 0x8f]` -> `[4, 0x12, 5, 0]`, the same from the
  sub-CPU's own firmware (test_scpum4); PWR_MAIN then waits on its flag and sends nothing more in 5 s of lab time; the
  init takes 4 ms of lab time (its 1 ms sleeps), and golden's screens are unchanged but for two EVF sessions' compose
  headers, whose frame numbers move by one frame.
- **The power-off's path (D):** the lever's off is UI_IN's `0x0202000c` (EV_POWER_SW_OFF) to the application's queue 6;
  the HFW passes it on (OlyHfwSystemEventForwarding, OlyHfwOpeKeyCtl) to the HLS, whose camera-common component
  (CmpCCom_CameraCommonComponent, `0x50d034a8..0x50d05ef3`, never entered in the lab, camapp 2 included: X) would
  call the HFW's CameraCommon::shutDown. That is slot 2 of the object the getter `0x50afccd5` returns (vtable
  `0x60e02ea4`; `0x50afd2d7`, the id `0x10102` it logs, "CameraCommon::shutDown" in the name table `0x6035f100`); the
  shell's "sdk api shutdown mode reason" calls the same slot (`0x50b05169..79`, with API_SHUTDOWN_NORMAL 1, ..._EMERGENCY
  2 and the reasons BUTTON 1 .. EASY_TRANS 13 in its usage text). shutDown -> `0x50abe7e0` -> OlyHfwPower's startShutDown
  `0x50af654b` (its other caller is the factory reset's `0x50af96d2`; the sequence `0x50044ca8` below has four more
  callers, the firmware update's `0x51034f23` and three in code not read): it saves the settings (the flash save `0x503eee94` from `0x50af6a0e`), saves the RAM log (api
  `0xc0036` `0x50420fd4` -> `0x518f7381`: the callbacks of the table `0x60379ef0`, 50 ms, `0x50039def` writing 0x100 to
  `+0x800` of the four interrupt-controller banks, then a checksum of 2 MiB from `0x63ae0000` and their write to the
  NAND at `0x4e820000`) and runs api_system's power-off `0x5041fa85` -> `0x50044ca8`, which writes the window's wake
  word (`0x5004e50a`: `+0x90` = 0xffffffff), posts the power manager its message (`0x500454a0`, handled at once by
  `0x5004408f` with event 33, X), has UI_IN reconfigure the window's ports (`0x5014c7fe` -> `0x5004e3fc`), reaches the
  file module (queue 31, X), sends the IO expanders their power-off commands (setting `0xa011` 9: body 5 and PBH 4,
  else body 6 and PBH 5; `0x50044da8..0x50044ddd`), sends the sub-CPU `0x85` (`0x5005cdfd`: `{1, 1, 0}` for setting
  19, `{3}` for 9, else `{1, 0, 0}`) and polls pin 102 until it reads low (`0x5005ceaf..ba`, no idle point), and ends
  with `0x5004dfd0`: `+0x9c` = 127 and its commit (I: the power cut).
- **Built: S-SHUTDOWN, H-POWER, S-PWRLOG, H-SCPUPOLL.** At the lever's off (after the switch step, in which UI_IN decodes
  it natively) the lab calls shutDown(1, 1) through the object's vtable on the lab task in lab time, in place of the
  HLS component (that the lever's reason is BUTTON is I), and ends the session at `0x50044dee`, past the call of the
  last write; the settings' save is listed with S-FLASHSAVE's (with S-NVRAM it runs natively); the RAM log's NAND
  write is answered done, not kept (S-PWRLOG); at each poll of pin 102 the sub-CPU acts as at an idle point
  (H-SCPUPOLL, I). The devices: the window's `+0x90` and `+0x9c` are storage and a port write keeps its
  configuration word (A-SCPU-4), the interrupt controller's `+0x800` is storage (its meaning is ?). On the sub-CPU's
  side (D, scpu spec 3.4): `0x85 {1}` moves the system-control task out of steady, and every such transition stops
  the command manager's link first (`0x80134e0`: PB12's edge off; `0x8013498`: GIO port 35, PC3, low; from bkground's
  `0x801678c` while the state it reads is steady, pwr_save's `0x80167e2`, standby's `0x8016872` and hibernation's
  `0x8016810`), which S-SCPUDEV now does too. X (E143, `test_scpu.mjs --session`, `test_scpum4.mjs --session`, with
  S-LENS): the sequence runs from the call (lab 2.855 s) to its end at 2.956 s; the link carries `0x85 {1, 0, 0}` answered
  `[5, 0x85, 1, 0, 1]`; the MN finds pin 102 low at its first poll; the sub-CPU is in bkground (PC13 low); S-IOEXP
  took the PBH's GIO extension writes of pins `0x20000` and `0x80000` (word 1), the body's 6 and the PBH's 5; no
  errlog (with the native lens, E143's default since 2026-10-29 (4.4.2), the sequence makes two movie time queries,
  which log the card's `0x39000903`, a code the lab expects (`src/fw/models.mjs` card_fs errlog; X, what asks for
  them is not read)); the request word 127. The frames, the pins and the lab time of the end are the same with the sub-CPU's own
  firmware (`OM_EMU_SCPU=native`), whose system-control task drops PC3 0.7 ms of its time after the release
  (`0x80134ae`, X). The lever's on then starts a new session, as before.
- **The sub-CPU's own errors (SCPU track step 7):** with its own firmware the sub-CPU logs `[PBH IOEDRV] TX Error :
  AF[0x0004]` over and over and `[CHG]<d05> b[0] Nack Detect[0x0004]` from the start on: the PBH grip's IO expander and
  the charger do not acknowledge on its I2C buses (S-SCPUBOARD attaches nothing). Neither stops anything the MN sees in
  the start, the power manager's start or the power-off (X: the same frames as S-SCPUDEV's), so no battery, charger or
  PD model is demanded yet.
- **Not modelled:** what the HLS component does around shutDown (the GUI, the live view's end, the lens), the other
  shutdown reasons and modes (USB, battery, sleep, emergency), the expanders' chips and their pins' effects, the RAM
  log's content, the meanings of `+0x800`, `+0x90` and the port words' configuration, the power-on (the lever's on
  opens a new lab session; the boot is not run) and the sub-CPU's wake. The bodies but E143, E146 and E147 keep
  H-POWER's immediate close: the rule finds no start of PWR_MAIN on any other ported body (X), and their sub-CPU
  lineages differ (E139, E134) or they have no link (the rest).
- **E146 and E147 (2026-10-29):** the addresses are read by a rule, not ported from E143's: `powerOff` finds the boot
  starter's start of the task named "PWR_MAIN" (`call init; movhu (W),d0; exth d0; call OlyTaSt; mov NAME,a0`; the lab
  now starts the static task whose id W holds, where it named E143's entry), the window's last write `mov 127,d0; mov
  d0,(0x98e0009c)` and its one call right after another (the 0x85 sender, whose pin-102 loop gives the poll), the IO
  expanders' commands the sequence calls before that send (`mov imm8,d0; mov 0,a0; call post; call wait; ret`, the
  wait's flag word), the shell's "sdk api shutdown" (the getter and the slot of its `calls`, the trace id it logs, the
  function that opens with that id and is held in a vtable, mode and reason from its usage text), startShutDown's call
  of the flash save (the function that loads its trace) and the RAM log's NAND write (the one whose function sums the
  area but its last 64 bytes, `cmp size-64,Dn`; three other immediate NAND writes sum nothing). On E143 it reads
  POWER_OFF_E143 (test_facts); on E146 and E147 the values read by hand (test_facts POWER_SEQ_FOUND: E146 init
  `0x50045abd` with id word `0x60042d62`, shutDown `0x50b08199` of the getter `0x50b07b86`, end `0x500459f5`, poll
  `0x5005e931`, the expanders' posts `0x50058507` / `0x50056960` with flags `0x6004319e` / `0x600431ae`, the RAM log's
  write returning to `0x5190a069`; E147 init `0x500459f2` with `0x60042ce2`, shutDown `0x50b12b11` of `0x50b124fa`, end
  `0x5004592a`, poll `0x50059aa9`, the RAM log `0x519123af`); on the 15 other ported bodies it finds nothing (X). E147's
  sequence (`0x50045807`) sends no IO expander a command: it has none (X: their task names only in a name list no code
  loads), so S-IOEXP does not run there, and its power manager's start completes without one. X (`test_scpu.mjs
  --session` on each, S-LENS on E146 and E147, which have no native lens): the power manager's start sends E143's
  frames, `0x82 {2d}` -> `[4, 0x82, 0, 0]`, `0x12 {5}`, the poll `[2, 0x8f]` -> `[4, 0x12, 5, 0]`, and waits; the
  power-off runs from the call at lab 2.738 s to its end at 2.839 s (E147 2.837 s), the link carries `0x85 {1, 0, 0}`
  answered `[5, 0x85, 1, 0, 1]`, pin 102 is low at the first poll, the sub-CPU in bkground, the request word 127, no
  errlog the lab does not expect; S-IOEXP took on E146 E143's requests (the PBH's GIO extension writes of pins `0x20000`
  and `0x80000`, the body's 6, the PBH's 5), on E147 none. With the sub-CPU's own firmware on E146
  (`OM_EMU_SCPU=native`, `test_scpum4.mjs --session`) the frames, the pins and the lab time of the end equal
  S-SCPUDEV's. The lever's on then brings up a new session at the first one's screen (`power-on` on E146 and E147, their
  GUI state at the start). With the power manager started at their bring-up E146 and E147 pass modelcheck with the
  other ten bodies (X: an 8 GiB card, and a 64 GiB one with E144's expected failure).

#### 4.7.5 PER_SIO's serial controller and the TG-5's internal charger (E129, E132, 2026-10-29; D unless tagged)

The TG-5s' camera application start writes the internal charger's register 1 and reads it back over PER_SIO's channel
9, where the start had stopped (`docs/model-survey.md` finding 24). E132's addresses (E129's are the same code a few
bytes on; E143's places in brackets):

- **The layers.** PER_SIO's channel API opens and closes a channel (`0x500520ce` [`0x5005f0f7`], `0x5005221a`
  [`0x5005f25f`]); a channel's controller index comes from the channel map (`0x5005238c`: a byte per channel's
  halfword at the map the word `0xa2b1c84c` points to), and the channel state, its open flag at `+128`, is the
  index's (`0x5005213d..4d`), not the channel's. PER_SIO's IIC layer configures a channel and starts its transfers:
  `0x5004b96e` [`0x5005373f`] (completions registered by the request type's bits, the lower configuration
  `0x50050261`), the write `0x5004ba70` [`0x50053863`], the restart list `0x5004ba5c` [`0x5005384b`] and the write-read
  `0x5004bac8` [`0x500538bf`], each into the controller driver's transfer start `0x500506cb` [`0x5005dc03`] and, for
  the write-read first, its receive start `0x500509be` [`0x5005def6`], with a1 0 (ended by interrupt; 1 takes a polled
  loop, `0x50050821`). The driver's interrupt (`0x50051600..`) moves the bytes, restarts before each restart position,
  clears the index's restart list at the transfer's end (`0x5005171d`) and calls the completions through
  `0x50051814` [`0x5005ed65`] (d0 the index, d1 0 or 0xffff on an error, a0 the transfer table `0xa2b19ea8` or the
  receive table `0xa2b19ec8`, filled by `0x50051145` [`0x5005e6a5`]); the IIC layer's own completions
  (`0x5004bb3a`, `0x5004bb6f`) clear its busy words and call the user's callbacks.
- **The channel map was unset.** PER_SIO's channel init (`0x50052016` [`0x5005f03f`], from the boot at `0x50022205`)
  ends in the map's setter `0x50052089` [`0x5005f0b2`], which picks the running core's map from the board's table
  (`0x604aa830` / `0x604aa86c`). The lab does not run the boot, so on every body the word is 0 and each channel's
  index was a byte of low memory: the charger's transfer went to index 0 (`0x9a200000`, a lab-stub page), and channels
  shared an index's open flag (X: E132). On a TG-5 the map is channel 9 -> index 7 (registers `0x9a100000..`), 2 ->
  2 (`0x98500000..`) and 3 -> 3 (`0x98600000..`), the register table `0x604aa1a8` (132 bytes an index).
- **The charger.** Its init `0x5003fa04` (from the power task's start, H-PWRTASK) configures channel 9 at 400 kHz
  with the completion callbacks `0x5003fe46` / `0x5003fe5a`, which set the flag `(0x60421358)`. The request
  `0x5003fa92(code)` takes its type, register and value index from the code's nibbles, opens the channel, writes
  `[0x36, register, value]`, waits 3000 ms for the flag (its timeout logs `0x1d003003`), reads the register back with
  `[0x36, register]`, a restart and `[0x37]` and one byte, waits again (`0x1d003004`), closes, and compares the byte
  with the value (a mismatch to `0x5003fe6e(2)`); its type 2 reads a register without the write. The table
  `0x5003fb04..0x5003fb84` writes 8, 9 or 2 to register 0, 0xa2, 0x96, 0x94, 0x97, 0x95 or 0x93 to register 1 and 9
  to register 2. The start writes register 1 = 0xa2 and reads it back (X).
- **The seam (2026-10-29).** S-SIOIIC (`src/lab/sio.mjs`) serves the driver's two starts for the channels a body's
  devices sit on (`src/fw/models.mjs` sio_devices), and nothing below them runs: the transfer's bytes are split at its
  restart list into IIC segments handed to the device, and its end is delivered at the MN's next idle point
  (A-SIOIIC-1) in interrupt context as the interrupt delivers it: the restart list cleared, the transfer's then the
  receive's completion dispatched natively with status 0, the received bytes written first. The IIC layer, the
  channel API, the completions and the charger's request run natively. H-SIOMAP runs the map's setter at the bring-up;
  the controllers' register blocks the TG-5s' channels reach are lab-stub pages (`src/fw/models.mjs` board
  stub_pages), which the driver's configurations write. The driver's parts are read on every body by a rule
  (`src/fw/facts.mjs` sioDriver: the 15 expanded images but the E118 family's, X). S-CHARGER
  (`src/lab/charger.mjs`): address 0x1b, registers 0..2 keep what is written (I), a read of one not written stops the
  session (its reset value is ?). Why not the controller at its registers: its status bits and interrupt lines are not
  read (the driver polls `(96,regs)` bit 1 and `(56,regs)` bit 15, `0x50050885..`, `0x50050743..`), and the
  transfer start is the narrowest seam above which every layer the charger uses runs natively. S-SIO2 (4.7.1) keeps
  serving PER_SCPU's SPI channel on E143 at the channel API.
- **Then.** E129's start runs to the date and time setting `0x1103` (with the card's file system native; with S-CARD
  its free-cluster count divides by the absent volume's cluster size at `0x50546d48`, X) and `bin/modelcheck.mjs`
  passes; E132's start showed "Busy" (`0x10c`), the industrial TG-5's "Update folder Allocation" progress: its
  error-factor check asks isCategoryUpdate (`0x50be13b8`), true on its DISPLAY cmd 43's status 0, and
  updateCategoryInfo (`0x50710d83`) posts to CATEGORY_MAIN, a module task the lab does not run whose queue E143's
  target table has no counterpart of (`src/fw/models.mjs` E132 modack_queues: S-MODACK answers it and LOGGER_MAIN).
  Its date setting then has Set and no Cancel; setting the clock takes it to the shooting screen and modelcheck's path
  passes (X). The panel driver's 300,000 stub calls of the earlier trial were its open loop (`0x5015b540..5f`: the open,
  then a 1 ms sleep while it answers busy) on an index another channel held under the unset map (I: which channel
  held it is not read); with the map set it is not seen (X).
- **Open:** the controller at its registers (its status bits, its interrupt lines and the error status 0xffff path);
  the other bodies' unset channel map, E143's included, whose channels still share an index (no body but the TG-5s
  runs H-SIOMAP: their PER_SIO users are S-SIO2, S-IICWAIT and the panels' lab-stub pages); E144's charger over IIC
  channel 6 (S-INTCHA's return stub) as a second S-SIOIIC device; the charger's chip and its reset values; why
  LOGGER_MAIN's unanswered request fills the application's queue 6 once the clock is set (X, ?).
- **The E118 family's channels (2026-10-30, `docs/model-survey.md` finding 44).** Their blocks
  (`0x98200000`..`0x98600000`, five enabled) are lab-stub pages with one preset each: the transmit level word `+0x1c`
  reads the channel's FIFO depth (16, 64 for channel 4), an idle transmitter, so the driver's polled send, which waits
  for that value, returns (E118's EVF panel commands over channel 2); that the word counts free entries is I, and
  nothing is received.

### 4.8 Card, file system and playback

- **Tasks (CPU 0, D):** DCFPROC_SUB 0x02 (queue 0x0d), FILECLBK 0x0d (queue FILECLBK_UEXEC 0x1f, targets 14 / 15 / 17 /
  23), FILEFGND 0x0e, EYEFI 0x40 `0x5088fc7e` (a loop of 10 s sleeps, D; the file system's bring-up `0x5088fc8d` after
  it is the boot task's call, 4.8.2), REC_FILE
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
- **Media events (D):** EV_MEDIA_MOUNT_REC 193, _PLAY 194, _END 195, EV_INSERT_EXT_MEDIA(_SLOT2); their sender is the
  application's media control reactive, from the media manager's notification 711 (4.8.3).
  The HLS mount-word setter `0x50aca6b1` takes kind 4 = SD (`0x60360bfc`), 1 = IN and 8 = SD2 (`0x60360c08`).
- **Seams:** B (recommended first), a block device at the sdmem request (4.8.1) with a host disk image, so logsec, FAT /
  exFAT, DCF, fileif, the file tasks and REC_FILE run natively; C, sd_mount's result beside it (the drive status's mount
  bit `0x1000` comes from the device state's bit 16, `0x508a83e7`; the lab's state is `0x8600`). A, the SD host
  registers with a card model, is the faithful later step (3-6 weeks, optional). Formatting (`sdmem_format.c`, dosfat)
  runs natively under B.
- **INFO's still information (2026-11-02, `docs/model-survey.md` findings 80 and 81):** S-PLAYCOMP (E143, E146, E147,
  the E144 family) and S-PLAYSEQ (the E118 family) write the same record of the picture shown, in the build's
  converter's layout: the camera's clock at the capture (E143's read `0x5005a59e` at its place, run natively; each
  build's default with the status 10501 while the window clock counts from 1970), the JPEG's size, the release's
  exposure and the lens's focal length. S-PLAYCOMP had written 5184 x 3888 and the exposure alone. Not native: the
  components' and the play module's Exif read, which the lab's JPEG (no Exif) would not feed.
- **Playback:** with S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW kept, real files need a JPEG decoder at the codec seam (4.3's
  C2 `decode_jpeg`, `play_img.c`): 2-4 weeks on top of storage. A native path needs the HLS play components (310k),
  segment 9's PLAY_* / MOVP / MOVE, the AV back end for movies and the CIC engine for RAW: a block of its own.
- **First step:** done (2026-10-23, 4.8.2): the bring-up and the mount ran natively, with the seam one layer below the
  one recommended here (the SD command layer, not the sdmem request: sdmem's own card state, which the mount fills and
  the format and the transfers read, then needs no stand-in). Round 2 (2026-10-24, 4.8.3): Card Formatting from the
  menu and the card's removal and insertion at run time, with the HLS function component and media manager stood in
  at their seams. Round 3 (2026-10-25, 4.8.4): the seams read by a rule in every image that has them, and the card
  native on nine more bodies (E146, E147, E144, E139, E137, E142, E140, E125, E130). Round 4 (2026-10-28, run
  2026-10-29, 4.8.6): an SDXC card by its capacity and an independent exFAT reader; the firmware formats a blank 64
  or 128 GiB card exFAT and mounts it (X). Round 5 (2026-10-29, 4.8.6): the players and modelcheck read exFAT, the
  browser player takes a card size, the menu's format and the card out and in on E143 with an SDXC card, and nine
  more bodies with one (X). Round 6 (2026-10-29, 4.8.7): E144's stop with an SDXC card read to its cause (the
  firmware's own divide by 0), the HLS side on E146, and E134's card native once its lamps' module UI_OUT runs (X).
  Round 7 (2026-10-30, 4.8.8): the E118 family's forms of five seams read by the rule, and E122's card native;
  then E118's and E120's, with E118's card line through its sub-CPU and its movie record time stood in (4.8.8).
  Round 8 (2026-11-02, 4.8.9): REC_FILE's own DCF steps for S2's picture on the five bodies whose recorder the rule
  reads, so the DCF database counts it in the same session, and S-CARD's image list retired there.
  Round 9 (2026-11-08, 4.8.10): REC_FILE's task natively on E143 from the packet REC_IMAGE posts it, the file's header
  (Exif with the maker notes, XMP) by REC_IMAGE's own header maker, S-RECFILE retired there; the second slot surveyed.
  Then on E146 and E147 too, at the addresses and layouts a rule reads; the E144 family's REC surveyed (4.8.10).

#### 4.8.1 The sdmem request contract (D unless tagged)

- **Request (128 bytes; builders allocate it with `0x5000305e(128)`):** `+0 u16` drive (0, 1, 2 or 8 pass logsec's
  entry `0x508ac286`; any other completes with `0x1319` and errlog `0x10001101`), `+2 u16` slot (the port index from
  `0x508b0c7f`), `+4 u32` first sector, `+8 u32` sector count, `+12 u32` buffer, `+16 u32` flags (bit 2 picks 1 or 4
  for the work area's `+86`, meaning ?), `+26 u16` command, `+28` the caller's word (logsec: its ticket), `+32` the
  completion `fn(a0 = request, d0 = u16 status)`, `+36` / `+40` further callbacks (command 3; logsec sets `+36` =
  `0x508ac505`), `+60 u16` status, `+64..` sdmem's work area (`+106..+110` used by commands 4 / 5 when flags bit 2 is
  set, ?). Sectors are 512 bytes (`asl 9` at `0x508b2480`, `0x508b25d4`).
- **Entry `0x508b1cdc`:** command 10 (abort) sets `(0xa31fc684)[slot]` = 1 and goes straight to the executor. Every
  command but 0, 1, 2 and 11 takes the sdmem semaphore 0x7b (`(0x60042f4e)`) and checks the card state first
  (`0x508acbe0`, then `0x508b3acf` for UHS-II or `0x508b0c2a` for a legacy card), failing with `0x1301`, `0x1402` or
  `0x1416`. The executor `0x508b1de1` keeps one active request per slot (`0xa31fc64c + 4 * slot`) and queues up to four
  more (`0xa31fc654 + 24 * slot`; a fifth fails with `0x1314`), then dispatches commands 1..24 through the table
  `0x60a18c10` (`0x508b1f00`; command 0 directly, `0x508b21f6`).

| Command | Handler | What it does |
|---|---|---|
| 0 | `0x508b21f6` | a 128-byte job to the driver queue `0x508b37de` (its completion `0x508b2249`); the card bring-up (I) |
| 1 | `0x508b2b51` | clears the port's card info and completes with 0 |
| 2, 11, 14 | `0x508b2a56` with class 4, 5, `(flags & 0x30) \| 7` | ? |
| 3 | `0x508b2189` | checks ready (`0x140d`) and write protect (`0x1410`), then calls `+36` (or `+40`) |
| 4, 5, 6 | `0x508b2323` | the data transfer: count 0 completes with 0; not ready `0x1409`; 5 on a write-protected card `0x1410` (so 5 is a write, I; 4 a read, I; 6 ?); first + count beyond the capacity `0x1417`; else the work area and the driver job (`0x508b23d1`) |
| 7, 8 | `0x508b24dc` | a second transfer pair (8 sets a flag), ? |
| 9, 10, 24 | `0x508b2cdd`, `0x508b2eb4`, `0x508b2f4f` | ? (10 is the abort) |
| 18, 20 | `0x508b2169` | complete with 0 |
| 21 | `0x508b2175` | writes 80 to the card info's `+89`, completes with 0 |
| 12, 13, 15, 16, 17, 19, 22, 23 | - | complete with `0x1320` (not supported, I) |

- **Completion:** `0x508b1fbc(request, status)` stores the status in `+60` when that is still 0 and hands `+32` to
  `0x50894ddb(fn, request, status)`, which appends `{fn, arg, u16 status, u16 kind 2}` to a 32-entry ring at
  `0xa31fbfd4` (write index `0xa31fc156`) and sets flag 0x1f; the task FILEFGND 0x0e (`0x50894e37`) waits on that flag
  and calls `fn(a0 = request, d0 = status)` for each entry (`0x50894d77`). Then the slot is freed and each queued
  request is started, or failed with the same status. So every completion runs in FILEFGND's task, in order, never in
  the caller's or an interrupt's context. Below the request, the driver jobs and the SD host's IRQs (225 / 227 / 228)
  are not read (?).
- **Card info (per port, `0xa31fc4dc + 92 * port`; `0x508b2b99` returns it):** `+0 u32` capacity in sectors, `+8` bit 0
  write protect, `+12` a pointer to `+20`, `+88 u32` not 0 when the card is ready, `+89` the byte command 21 writes.
  Which job fills it, and the rest of its fields, are ?.
- **logsec's side:** synchronous callers (dosfat, the dcf* modules, logsec_sem, api_picfile) go through `0x508ac1dd`:
  a ticket from `0x508ac3ca`, `+32` = `0x508ac487` (stores the status and a done mark in the ticket and sets its flag),
  the request through `0x508ac286`, the wait `0x508ac5d9`, which returns the status.
- **What seam B must return (I):** for commands 4 and 5, count x 512 bytes copied between the image and `+12`, the
  status in `+60` and the completion through `0x50894ddb(+32, request, status)`, so FILEFGND keeps calling it; the range
  and write-protect checks as the table gives them; card info that the mount accepts. Which commands the mount sends,
  in which order, and what each must leave in the card info, is ? until the first step's probe has run.

#### 4.8.2 The card on E143, round 1 (2026-10-23; D unless tagged)

The file system runs natively on a card on E143 (`emu/src/lab/storage.mjs`, `emu/src/lab/sdcard.mjs`; every address
with its evidence in `emu/src/fw/facts.mjs` STORAGE_E143 and STORAGE_LIB since round 3, 4.8.4). The seam and what was
found on the way:

- **Bring-up:** the file system's bring-up is `0x5088fc8d`, the boot task 43's call (`0x5002417a` at `0x500242ab`), not
  EYEFI's (its entry `0x5088fc7e` only sleeps): queues and semaphores, FILEFGND through `0x50894d42`, logsec's init
  `0x508ac195` with the SD host's init `0x508acbed` (GPIO pins and power `0x508b0121`, IRQs 225 / 227 / 228 and 229 /
  231 / 232 attached, sdmem's and the PHY's state), the file layer `0x50888c4a`, whose `0x5088d075` reads the file
  system's NAND area (`0x500022c2(dst, 0x41a00000, 0x80000, 0x10200)`, the generic NAND access; `0x10100` writes), the
  card driver's detect states (`0x5087bc5e`, both drives 1) and DCFPROC_SUB (`0x5087cd68`). H-FILEINIT runs it in the
  play bring-up and H-FILECLBK starts FILECLBK (task 13), whose start is not traced (X).
- **FILECLBK's protocol:** a 16-byte message on queue 0x1f, `{reply queue (0: none), word, code, parameter}`; the code's
  class by `code & 0xffff0000` (0: by `code & 0xf0` through `0x60a10578`; `0x10000` fileif `0x50894eb3`; `0x20000`
  `0x5089504f`; `0x80000` / `0x100000` dcfif `0x50876792`); the reply `{u16 status, word, parameter}` to the reply
  queue. Class 1 (codes `0x10..0x1e`) carries sdmem requests (`0x13` command 2, the card mount); `0x50..0x58` dosfat's
  command `0x508812f2` (`0x51` op 0 the FAT mount `0x50882ebd`: sdmem command 2, then the MBR and the boot sector,
  `0xe08` on a card with no file system; `0x55` op 5 the format `0x508848ba`; the block's +4 op, +6 drive, +48 the
  error); `0x30..0x3a` dcfnum's dispatcher `0x50877ea8` (`0x31` op 0 the DCF numbering mount `0x5087825a`: the block's
  +42 next folder, +44 next file, and the DCF state word's bit 16, the drive status's mount bit `0x1000`); `0xf0` the
  DCF process `0x5087bce9` (`{u16 command, u16 drive}`: 1 card in, detect state 1 -> 2; 3 the lists, 2 -> 3); fileif
  `0x10000 + n` with a block `{result, arguments}`: 1 fopen(path, mode), 2 fclose, 3 fwrite(buffer, size, count,
  FILE), 12 mkdir (X), as the FlashAir configuration writer `0x5101efe0` uses them. Drive letters: `C` is drive 0, `D`
  drive 1 (`0x508a8149`, X).
- **The seam:** the SD command layer `0x508ad03c(command)`, below sdmem and sd_mount: the command's +24 code (index
  bits 0..5, bit 6 an application command, bits 8..10 the response type: 3 none, 4 R1 / R3 / R6 / R7, 5 R1b, 6 R2, 7 R3;
  bit 30 UHS-II), +28 argument, +32..+44 the response (an R2 as the host gives it: bits 127..8 in four words, bits
  39..8 first; sdmem_format `0x508b338e` reads the CSD's C_SIZE at `(w1 >> 8) & 0x3fffff`), +48 buffer, +52 count, +56
  block size, +74 status, +8 the completion (by `calls`, a0 the command, d0 the status; `0x1405` for no response). The
  layer completes at once for a busy port (`0x508ad065`), so S-SDCARD completes each command at once too. The driver's
  other job kinds (power, clock, bus width, the UHS-II PHY) run natively on the SD host's register pages, which keep
  what is written (S-SDHOST; the clock setter `0x508acf2b` polls SD_INFO2 bit 13, which reads set). The UHS-II path is
  tried first on port 0 (`0x508af03a`): its PHY link-up wait (`0x508b4011`) times out after about 120 ms of lab time
  and sd_mount falls back to the SD interface (X): CMD0, CMD8, ACMD41, CMD2, CMD3, CMD9, CMD7, CMD13, ACMD51, ACMD6,
  CMD6 (query and set), ACMD13, ACMD42, CMD16, then the transfers (CMD17 / 18 / 24 / 25; after a transfer the job asks the
  card's status with CMD13). Sector addresses are blocks on an SDHC card (the OCR's CCS).
- **The insertion** (S-CARD, I: the HLS media layer that sends it does not run): `0x51` (on a blank card `0xe08`, then
  `0x55` and `0x51` again), `0xf0` 1 and 3, `0x31`. The firmware formats an 8 GiB card as FAT32: an MBR with one
  partition (type `0x0c`) at LBA 8192, 64 sectors per cluster, 4122 reserved sectors, two FATs of 2035 sectors, FSInfo
  at 1, the backup boot sector at 6, the label `OM SYSTEM` (X, read back by `emu/refs/fat.mjs`); FSInfo's free count is
  the FAT's. Lab time: the UHS-II timeout and logsec's 740 ms wait before a mount's sdmem command 2 (`0x508ac1dd`, where
  the card switch's state reads `0x1506`) make about 2.5 s at a blank card's start.
- **The DCF numbering mount** starts the album manager (`0x508b67e8` -> `0x508beba7`, ALBM_MAIN), whose first request
  (`0x5048ee61`) allocates its id through `0x5050a086`, the only udf07 site (docs/om1-udf-spec.md row 14): S-ALBM returns
  from the album manager's init at once (its result is unused, `0x5087853a`).
- **The counts:** the remaining-shots query `0x50419164` and the movie time query `0x5042da58` run natively (S-CARD's
  answers retired on E143): 803 shots and 5:25 of 4K 60p on 8 GiB, fewer on 4 GiB (X). The movie time left comes from
  DCF remain (`0x5087da1b` -> `0x5045c4ac` stores it in the movie module's copy `0xa32ed404`); the query's time code
  converts the movie info's frame rate (`0xa32ed128` +720, which the movie module's set-up `0x5045c3fd` fills at a
  movie take, TAKE_MOV's take job: 0 before one, on the camera too, `docs/model-survey.md` finding 60) and logs
  `0x39000903` (`0x5044949b`), after the time left is computed.
- **The picture's file** (S-RECFILE, in place of REC_FILE): mkdir `C:\DCIM` and `C:\DCIM\100OMSYS`, fopen
  `P1010001.JPG` `wb`, fwrite, fclose through FILECLBK, the bytes a JPEG the lab encodes. Read back independently: the
  directory entry, its size and bytes, a baseline JPEG decoded by `emu/refs/jpeg.mjs` and macOS ImageIO (X); the next
  session's DCF numbering mount reports file 2 next and the firmware's own image count (type 1) counts it (X). REC_FILE
  would build its file through the DCF fnode API (`rec_media.c` `0x5054aa70` sends dosfat op 4, code `0x54`, over a
  REC file context with `pDcfFnode`): read and run in round 8 (4.8.9).
- **Card Formatting from the menu** (X, round 1): Setup, Card Formatting, card 1, Format Card, Yes showed "Busy"; the
  application's media control sends TRA 1511 (`0x50ac940d`, OlyHfwOpeMdaCtrl), which S-TRAACK answers. Round 2 (4.8.3)
  found the component that takes it and stands it in.
- **Open:** the other bodies (round 3, 4.8.4), the second slot, exFAT beyond E143's format and mount (4.8.6),
  REC_FILE natively (on E143, E146 and E147 since 2026-11-08, 4.8.10), the SD host at its registers with
  interrupts (seam A),
  playback of the files (a JPEG decoder at the codec seam); round 2's open points are in 4.8.3.

#### 4.8.3 The card on E143, round 2: the menu's format, removal and insertion (2026-10-24; D unless tagged)

Card Formatting from the menu reaches the card, and the card leaves the slot and comes back while the camera runs
(`emu/src/lab/media.mjs`; every address with its evidence in `emu/src/fw/models.mjs` E143 `storage.hls`, `card_out`,
`card_info`). The application's media control (OlyHfwOpeMdaCtrl) runs natively; the two HLS components it talks to do
not run in the lab (camapp 1 runs none; camapp 2's bring-up does not create them: X, neither reacted to the format or
to the card switch), and are stood in at their seams with the firmware's own event objects.

- **The HLS media layer (D):** the application sends its requests as transactions (TRA 1511, the media control's
  start, ctor `0x50ac052e`: +32 u8 the command, +34 u16 the media, +36 u16 the option; X: Format Card's Yes sends
  command 1, media 0) and receives the components' answers as events, all derived from class 696 (ctor `0x50ac89d0`):
  1513 progress and 1514 result (`0x50ac8d0d`: +28 the callback id, +32 the kind, +36 / +40), 697 (`0x50ac89f8`) and
  711, the media manager's mount notification (`0x50ac8c70`: +28 the media kind, +32 a flag, +36 a state). They come
  through OlyHfwReception (getter `0x50abc5a3`, singleton `0x6035f0fc`), whose receptors (+20; `0x50af8156`,
  `0x50af818b`) are asked in turn (isInterested, vt[3]). Its slot 1 (`0x50af89e5`) gens the event to the taking
  receptor's reactive (the receptor's vt[1], `0x50ac8eed`), which queues it for the reactive's OXF thread (+100: the
  OXF main thread HIGHLEVEL_MAIN, task 57, dormant in camapp 1, X); its slot 2 (`0x50af8c96`) calls the reactive's
  handleEvent (OMReactive vt[6], `0x50d9bd10`) at once, through the receptor's vt[2] (`0x50ac8f27`). The media
  control's receptor (vtable `0x60de6808`) takes the events of class 696 (X: three receptors in camapp 1; this one's
  reactive has vtable `0x60de8ffc` and is in its state 6), and the reactive's state 6 (`0x50acb4b9` -> `0x50acb53e`)
  posts the application's callbacks (`0x50ab8208` / `0x50ab8390`: 1513 as (CBC, 3, percent), 1514 as (CBC, kind,
  result)) and events (`0x50b7a392`).
- **The format (D):** TRA 1511 is taken by the HLS function component CmpCst_Function (CmpCst_Function.cpp):
  rcvReqFncMediaCtrlStart `0x50ceb3be` stores the command, media and option and the callback id (getMediaCtrlCBC
  `0x50cebeea`: 1 -> 16, 2 -> 56, 3 / 6 -> 54, 5 -> 55); cbMediaCtrlStart `0x50ceb49f` checks the media status and runs
  mediaCtrlStartExecSelect `0x50ceb784` through the table `0x60364a44` (24 bytes a command, filled at boot; X: command
  1's entries are executeMediaFormatStart `0x50ceb9b0`, getMediaProgress `0x50ceb96c` and executeMediaFormatEnd
  `0x50ceba28`). executeMediaFormatStart registers for the file module's progress event `0x04020011` and calls
  api_media's format `0x503f0820` (API `0xe0005`), which for media 0 or 1 posts FILECLBK `{reply queue (the halfword
  0x600431d0; X: 6), token, 0x34, block}` and returns the token (X: `0xf00a0000`). FILECLBK's `0x34` is dcfnum's op 4,
  the DCF format `0x5087860d`. The file module publishes `0x04020010` (the total) and `0x04020011` (the current step,
  every tenth, `0x5089029a`) and replies `{u16 status, token, block}` to the API queue (`0x508a4bd5`).
  rcvReqFncMediaCtrlStartComplete `0x50cec0ff` takes the reply: with status 0, for each slot whose media status
  (`0x503f0bd7`) has bit 0 clear and whose mount state is mounted it sets 15261 + slot to 1 (`0x50ab4f75`), sends 1513
  `{16, 3, 100, 0}` and 697 `{1, media}`, stores kind 72 and result 0, and starts a request (`0x50abf1b4`) whose
  completion, cbMediaCtrlResult `0x50ceb6c1`, sends 1514 `{16, 72, 0, 0}`; an error status ends in kinds 70, 71 or
  118. Each progress event sends 1513 `{16, 3, percent, 0}` (`0x50cebe6a`).
- **S-MDACTRL** does the component's part: at TRA 1511 command 1 (S-TRAACK still answers the exec) api_media's format
  natively, the progress notifications with the component's own percent, and at the reply the component's end as read
  above; before the result the DCF numbering mount again (I: the request the component starts after a format, whose
  class is not read; X: the firmware's next file is then 1, File Name Reset). The notifications go through the
  reception's slot 2: the component's own sends of 1513 / 1514 use slot 1, whose OXF thread does not run in camapp 1
  (I). Any other command, and an error status, stop the session.
- **What the format does (X):** after a picture, the menu's Yes formats the card in 1.6 to 3.5 s of lab time (eleven
  progress events). Read back independently (`emu/refs/fat.mjs`): a FAT32 volume `OM SYSTEM` with an empty root, the
  picture's file and DCIM gone, the free cluster count (FAT and FSInfo) the freshly formatted card's; the firmware's own
  image count 0 and its next file 1; the progress bar fills, and the application returns from Busy to the menu. The
  volume serial is 0 before and after (the firmware writes 0). After the format the menu draws the movie "Card Slot
  Settings" row enabled where it was grey (?).
- **The card switch (D):** the slots' card switches are UI_IN's codes `0x1506` and `0x1518` (port 1 byte 1 bits 0 and
  1; logsec waits 740 ms before a mount's sdmem command 2 when UI_IN's last code is the slot's, `0x508ac202`). The file
  layer registers a callback for both with UI_IN at its init (`0x50877e75`, `0x5014c420(code, 3, fn)`; the callback
  `0x5087ace0` -> `0x5087bb09` marks the slot's card as changed), and UI_IN publishes the change as the module event
  `0x02020000 | code`, which the HLS consumes (CapMed, the application's media control); the level getter is
  `0x5014c015(code)`. X: each toggle runs the file layer's callback and publishes `0x02021506`; with no HLS component
  nothing else follows. Level 0 is a card in the slot (I: the lab's start, whose card mounts, has 0).
- **The media manager (D):** CapMed_MediaManager / CapMed_MediaController (DevMed_MediaControl below them) send 711
  through the reception's slot 2: `{kind, flag, 0}` at a card's change (`0x50bb8a1b`), `{kind, 1, 2}` at the REC
  mount's end (notifyRecMountEnd `0x50bb8de9`), `{kind, 1, 4}` (`0x50bb8d55`) and `{kind, 1, 8}` at mountProcEnd
  (`0x50bb8c6c`); unmountPreprocess `0x50bb8292` sets the kind's mount state to 0 (`0x50bb8288`). The reactive's 711
  handler `0x50acaeb5` posts the application's 29 (with the switch's EV, `0x50424f9a(0x02021506)`) for a change with
  the flag 1, 30 for the flag 0, and 193 / 194 / 195 for the states 2 / 4 / 8 (X: 30 at a removal, 29 and 193 at an
  insertion).
- **The file module's side (D, X):** the DCF process's command 2 (FILECLBK `0xf0 {2, drive}`, `0x5087bd75`) is the card
  out: detect state 2, 3 or 4 -> 1 (X: the drive status loses `0x80`, `0x13780` -> `0x13700`). FILECLBK's sdmem class
  (codes `0x10..0x1e`, `0x50890114`, the table `0x60a105f8`; the block a 128-byte sdmem request through logsec's
  `0x508ac1dd`) maps `0x12` to sdmem command 1, which clears the port's card info. Without it a mount after a removal
  takes the old card info: X, CMD17, CMD13 four times and CMD0 unanswered by the card that came back (idle), and the
  FAT mount fails with `0x1405`; with it sd_mount initialises the card again natively (CMD0, CMD8, ACMD41, CMD2, CMD3,
  and on, with no UHS-II attempt this time). Which component sends `0x12` on a body is not read (I). Of FILECLBK's
  dosfat codes (`0x60a10554`), `0x51` is op 0 (the mount) and `0x52..0x58` ops 2..8 (`0x54` op 4, the REC file's chain
  write; `0x55` op 5, the format; `0x57` op 7, I: FAT_REMOUNT by the name list); dosfat's op 1 (FAT_UNMOUNT, I) has no
  code. The logsec class (`0x60..0x6b`, `0x60a10524`) maps `0x63` to op 10 (I: LOG_REMOUNT).
- **S-MEDIA** does the media manager's part, from the switch's event: out (level 1) the mount state 0 (the firmware's
  setter), the DCF card out, the sdmem card-info clear and 711 `{4, 0, 0}`; in (level 0) 711 `{4, 1, 0}`, S-CARD's
  insertion requests (4.8.2), the mount state 8, 711 `{4, 1, 2}` and `{4, 1, 8}` (I: which notifications the manager
  sends at a change, and in which order). The Player's input `{"type": "card", "action": "remove" | "insert"}` takes
  S-SDCARD's card out (it then answers no command, as an empty slot) or puts it back, and changes the switch through
  S-KEYBITS' bit, which UI_IN decodes natively. X: the shooting screen loses the card's count and movie time (no
  "No Card" text is drawn) and gets them back after the insertion (803 and 5:25, the same pixels); the insertion takes
  about 0.8 s of lab time (logsec's 740 ms wait after the card switch). While the card is out S-CARD keeps no picture
  and answers 0 images.
- **REC_FILE (goal 3, not attempted):** its media writer `0x5054aa70` sends dosfat op 4 (`0x54`, the chain write) over a
  DCF fnode; it runs in the recording modules, which the capture pipeline drives and which do not run, so S-RECFILE
  stays. (Round 8, 4.8.9: REC's steps read and sent by S-RECFILE, each run natively.)
- **Open:** the second slot (S-CARD sets both slots' mount state to 8 at the start, so the format sets slot 2's flag
  15262 too; slot 2's switch `0x1518` is not stood in); the HLS components' own runs (the function component and the
  media manager in camapp 2); the media control's other commands (2, 3, 5, 6: erase all, copy, unlock, ...); the SD
  host's card detect (seam A); a card the firmware cannot mount (unreadable; an SDXC card it formats and mounts,
  4.8.6); what the camera draws without a card ("No Card", the card icon).

#### 4.8.4 The card on more bodies, round 3 (2026-10-25; D unless tagged)

The seams of 4.8.2 are read from each image by a rule (`emu/src/fw/facts.mjs` fileSystem, fact `storage`; E143's
values STORAGE_E143, the library's message codes and block layouts STORAGE_LIB, the SD host's pages the board's
`sd`), and a body runs its card natively where its `emu/src/fw/models.mjs` entry says so (`card_fs`, each body that
does not with its reason). The storage stack is one library on all 18 images, the same instructions but for
addresses, register allocation and a few immediate forms (X, a byte scan per seam), so the rule finds each seam by
its code:

- **FILECLBK and the bring-up:** FILECLBK's loop opens `clr d0; mov d0,(busy); movhu (Q),d0; mov a2,a0; exth d0; mov
  16,d1` (one per image, X), its entry is the `movm [a2],(sp); add -20,sp` just before (nine images then set a byte,
  `mov 1,d0; movbu d0,(abs32)`, the others do not), and the bring-up ends right before that entry with `clr d0; mov
  d0,(busy); ret [],4` and opens with the creation of Q's queue (E143 `0x5088fc8d`, E146 `0x508a9a6d`, E144
  `0x50685108`, E134 `0x50659a4e`). The queue's id is the halfword Q of the static queue-id table: `0x1f` on the E143
  family, E145, E129 and E132, `0x22` on the others (X). The tasks the bring-up starts are its callees that end
  `movhu (W),d0; exth d0; call OlyTaSt; clr d0; ret`: FILEFGND and DCFPROC_SUB, and a third on E125, E133, E130, E129,
  E132 and the E118 family (ids `0x44`..`0x47`, which task is ?); the lab finds each by its static id (H-FILEINIT).
- **The NAND area:** the file layer's area read `movbu (flag),d1; mov d0,d2; cmp 0,d1; bne`, then the access called
  with a1 the area, d0 its size, d1 the read operation, then the flag set; its writer, the next function, adds the area
  (`add imm32,d2`) and calls the same access with its write operation. E143 family: the NAND access `0x500022c2`,
  `0x41a00000`, 512 KiB, `0x10200` / `0x10100`; the E144 family: its flash access (E144 `0x5003b76c`, the one
  S-SETSAVE's save writes through), 384 KiB (E144 at `0x406a0000`, E139, E134, E137, E125) or 256 KiB (the others),
  operations `0x102` (E125, E133, E130, E129, E132: `0x103`) and 0 (X; the immediates by a straight-line walk, D on
  E143 and E144). S-FSNAND keeps it, erased at the start.
- **The SD command layer** (`mov a0,a3; cmp 0,a3; bne; ret`, then the busy port's completion with `0x1403`), the
  **drive status** (`exthu d0; mov d0,a2; cmp 7,a2; ...`, the function holding cardDetect's card-present test; its
  entry after the return before it, E125's after a `clr d2`, `0x5061cb03`), the **album manager's init** (none found
  on E145, E129 and E132: there S-ALBM is not installed, ?), the file system's one **cache flush** call (the return
  K-CFLUSH answers; E143 `0x508881fa`, the flush the port's place of E143's `0x5004e68a` on all 15, X) and the **DCF
  names** (`100OMSYS` on the E143 family, E144 and E145, `100OLYMP` on the others; `P1010001JPG` on all, X).
- **The card's supply (S-SDPOWER):** the SD driver's power request builds `{_, device, 0 or 255, 1, 0}` and sends it
  synchronously (E144 `0x506a3fb5`, the send `0x5004fea9` to the queue of the halfword `0x60041854`, 65); the lab
  does not run its receiver (which task it is, a power manager by the request's use, is I), so the bring-up stopped
  there ("its receiver does not run in the lab"). S-SDPOWER answers that send 0, and only from the request. X: met on
  E144, E137, E142, E140 (device 9), E125 and E130 (33), once at the bring-up with 0; E143's, E146's, E147's and
  E139's requests return before their send (I: their check, E143 `0x508b088e`, gives non-zero). What 0 and 255
  select is ?.
- **The SD host's pages:** the same two port bases on the E144 family as on E143 (`0x99000000`, `0x9a300000`; E144's
  port table `0x607d0de8`, read by its SD driver, D), the card's pins and power in the GPIO page `0x9b802000` (E144
  `0x9b802064`, `0x506a3aec`; E143's `0x9b880000`), SD_INFO2 at `+0x203c` bit 13 polled as on E143 (E144
  `0x506a1871`, D).
- **Bodies (X: `emu/bin/modelcheck.mjs` with the card check, `emu/test/test_storage.mjs --session` on E146, E147, E144
  and E142):** native on E143, E146, E147, E148, E144, E139, E137, E142, E140, E125 and E130: the blank card formatted
  by the firmware (FAT32; label `OM SYSTEM` on the E143 family, E148 and E144, `NO NAME` on the others), mounted, the
  remaining shots from the card (803 on the OM-1 family's 8 GiB card, 826 on E148, E144, E139, E137, E142 and E140, 1607
  on E125, 2018 on E130), S2's file written and read back independently (`emu/refs/fat.mjs`: its directory entry and
  size), and the count probe's screen follows the query. E147's file system calls the SCPU clock's API at the bring-up
  before the clock's state field (`0x98e00000` bits 2..7) is 42, and the API logs `0x19001004` (expected in its
  `card_fs`; on E143 and E146 the field is 42 by then, X). S-SCENE's live view runs on the E143 family only (its banks
  are E143's), so an E144-family picture's file holds a black frame. Not native: E134 (on a native card S-RECFILE's
  first fopen never completes: FILECLBK blocks in a write with no timeout to UI_IN's request queue, `0x6004192e`, at
  `0x5010c35f`, which nothing reads in the lab, 53 writes in 10 s; E143's and E144's fopen make no such write; why
  E134's does is ?), E129 and E132 (their starts stop before the application, ROADMAP), the E118 family (no SD command
  layer of the rule's form; E122's start reaches the application since 2026-10-30, and its movie time then divided by
  the file system's volume object, which the file system's bring-up creates and the lab did not run,
  `docs/model-survey.md` finding 31; E122's card is native since 2026-10-30, 4.8.8). They keep S-CARD. E134's card is
  native since 2026-10-29 (4.8.7: the queue is UI_OUT's, the module of the camera's lamps, which its file layer asks for
  the card's access lamp; H-UIOUTSTART runs UI_OUT). E133's card is native since its start runs (2026-10-29: 2018 shots
  on the blank card, S2's file read back, X), and E145's (TG-7) since its start runs to the shooting screen (2026-10-29,
  `docs/model-survey.md` finding 22: the blank card formatted `OM SYSTEM`, mounted, 1362 shots and `0:37:22` from the 8
  GiB card, S2's file read back; X: `bin/modelcheck.mjs`, frames).
- **The movie time (goal 2, X: frames):** the E142 lineage's orange `0:00:00` is gone: E142 and E140 show `0:10:45`,
  E130 `0:37:22`, from the card (E142's DCF remain movie time `0x505fd798`, which returned 0 on S-CARD's card).
  The E144 family's (E144, E139, E137, E125) stays orange `0:00:00` beside the card's count: E144's DCF remain movie
  time (`0x50672715`) returns 0 for the movie item's arguments (drive 0, 8, 4, 1), where E142's returns 387000 for
  the same. Why is read in 4.8.5: the blank store's movie mode is UHD 4K at 60p, which these bodies' rate tables do
  not have. The OM-1 family's query answers the card's time after S1 (E146 5:25), 0 before it at the date prompt (X;
  why is ?).
- **Not done here:** the HLS side (S-MDACTRL, S-MEDIA: Card Formatting from the menu, the card out and in) stays
  E143's (`card_fs.hls`; E146's too since 4.8.7); on the other native bodies the media control's TRA 1511 is answered
  by S-TRAACK alone (I: the menu would stay at "Busy", as on E143 before round 2; not run) and the card input is
  refused. REC_FILE and the second slot were not attempted.

#### 4.8.5 The E144 family's movie time (2026-10-27; D unless tagged)

The orange `0:00:00` on E144, E139, E137 and E125 is the firmware's own answer for the settings the lab's blank store
holds, not a missing model: their default movie mode is UHD 4K at 60p, and their codec rate tables have no rate for 4K
at 60p or 50p. Nothing in the lab changes; the addresses are E144's.

- **The movie mode:** the movie settings are data objects indexed by a mode: settings id 696 is object `0xf021` element
  0, the mode (the id table `0x60514fec`); ids 697..704 and 848 are `0xf031[0..8]`, the resolution code; 705..712 and
  849 `0xf041`; 721..728 and 851 `0xf061`, the frame rate (the descriptors from `0x6050de50` allow 24, 25, 30, 50 and 60
  for 721, 722, 723 and 728, the ones read); 729..736 and 852 `0xf072`. The getters `0x5032a00d` (the mode),
  `0x5032a021` (the frame rate), `0x5032a036` (the size class: 1 for the codes 8 and 9, else `0xf041[mode]`) and
  `0x5032a069` (`0xf072`) read them. The blank store's defaults (the table `0x604d8f38`, which the blank-store fill
  `0x502bc906` sets through the property set `0x502d07d3`): id 696 = 1, `0xf031` = 6 8 6 6 6 3 4 9 6 and `0xf061` = 30
  60 60 60 60 30 30 30 60, so mode 1 is code 8 at 60p. X: the only writes to the mode's byte (`0x6240645b`) in a session
  are the object's zero fill and that fill's set of 1 (return `0x502bc919`). E139, E137 and E125 read the same mode,
  code and rate (X, their getters); E142's default mode is 7, code 8 at 30p (X); E143's is mode 1 at 60p too (X), which
  the OM-1 records.
- **The rate check:** the shooting screen's movie time is module `0x5000e`'s answer (`0x502d3fcf`), which calls the DCF
  remain movie time (`0x502d4030`) with the drive, the mode's resolution code (8 at the default, X) and 4, 1, every 200
  ms of lab time (X). Its count (`0x50672eb9`) takes the card's free space (`0x50673dd2`; X: `0x3f800` on the 8 GiB
  card, its unit not read) and the bitrate (`0x50674098` -> `0x5030f8f3`), which builds the movie's parameters (`0x5032553f`) and checks
  them (`0x503e09ae` -> `0x503e88ff`): the rate is the word of the table `0x6057559c` at size class x 80 + frame rate x
  16 + 4 x a third index (frame rates 60, 50, 30, 25, 24 -> 0..4; the third from the parameters' +6, 1, 2, 4, 8 -> 0..3,
  meaning ?). A zero word logs `0x3a040001` (source line 1942, `0x503e8ac3`) and returns `0xa003`; the bitrate then logs
  `0x39000105` (`0x5030f979`) and is 0, and so is the time left (X: both logs, on E144 and E139). E144's table has class
  1 (4K) at 30, 25 and 24 only, 100 Mb/s, in one column of the third index (D, read from the image); E142's default,
  code 8 at 30p, answers 387000 (X).
- **The time with a mode the table has (X, the mode set through the property set `0x502d07d3` after S1):** the same
  native path answers and the screen draws the time in white with the mode's icon, where the default draws no movie
  icon. On the 8 GiB card: mode 0 1331400 (`0:36:59`, the icon `FHD HS 60p`), mode 2 762000, mode 5 2913000, mode 6
  8748000, mode 8 793200; mode 7 (code 9 at 30p) 0, the default's screen (where in the chain it fails is ?). The unit is
  1/600 s (387000 is E142's `0:10:45`, 195000 E143's `5:25`). Code 8 at 30p (the count called with 8 in mode 7) answers
  387000, `0:10:45`, as on E142: 645 s at the table's 100 Mb/s is 8.06 GB, on a card of 8.59 GB (I: how the count turns free
  space and rate into time is not read).
- **Open:** whether a body leaves the factory with the blank store's mode 1 (?), and whether the camera's movie menu can
  select code 8 at 60p on these bodies (not read).

#### 4.8.6 An SDXC card and an exFAT reader, round 4 (2026-10-28; run 2026-10-29)

Written without running anything, then run in a later round (2026-10-29): what the firmware does with the card is X
from that run. What the SD and exFAT specifications say is from memory of them, not checked against the documents (I);
the firmware's code for a card above 32 GiB is not read (?).

- **The card (S-SDCARD, `emu/src/lab/sdcard.mjs`):** the capacity is the card's one parameter, and above 32 GiB the card
  is SDXC (`kind`); SDHC stays the default (8 GiB). By the SD Physical Layer specification (I) an SDXC card answers as
  an SDHC card does but for: CSD version 2.0's 22-bit C_SIZE past 32 GiB (64 GiB is C_SIZE 131071, 128 GiB 262143; the
  largest C_SIZE 0x3FFEFF, just under 2 TiB, is the model's limit), the SCR's SD_SECURITY 4 (version 3.xx; SDHC 3),
  and the larger AU its SD Status may report (the lab's choice: 16 MiB up to 128 GiB, 32 MiB above; SDHC keeps 4
  MiB). The OCR (CCS set), CID, CMD6's status and the command state machine are unchanged. The firmware reads C_SIZE
  with the 22-bit mask `(w1 >> 8) & 0x3fffff` (sdmem_format, 4.8.2, D), and the card info's capacity is a u32 of
  sectors (4.8.1, D), which holds 2^28 for 128 GiB; whether sd_mount or sdmem_format branch on the capacity or the
  SCR is not read (?). The store stays sparse (only the sectors written with something other than zeros), and CMD38
  now erases by the stored sectors when the range is the larger, so an erase of a whole 128 GiB card costs nothing.
- **The host's choice:** node's `OM_EMU_CARD_SIZE` (GiB: `64`, `64G`, `128GiB`; `cardSectors`) sizes a new card, in
  memory for the player's life or in `OM_EMU_CARD`'s file (`emu/host/card.mjs`, which refuses a saved card of another
  capacity rather than stand one for the other). The browser player has no size input yet (its card is the default).
- **The exFAT reader (`emu/refs/exfat.mjs`):** independent, written from Microsoft's exFAT specification (I), Worker-safe
  and importing only `refs/`: the boot sector's fields and rules (bytes 11..63 zero, 512-byte sectors, revision 1.x),
  the boot region's checksum (sectors 0..10 but VolumeFlags and PercentInUse, repeated over sector 11) and the backup
  region, the active FAT, the allocation bitmap, the up-case table with its checksum and its compressed runs, the
  volume label, entry sets with their set checksums and name hashes (over the name up-cased by the volume's own
  table), contiguous (NoFatChain) and FAT-chained files and directories, the valid data length, and a consistency
  check (every cluster in use allocated in the bitmap and taken once, no cluster allocated to nothing). A mismatch is
  an error, not a guess. It gives the surface `emu/refs/fat.mjs` gives its callers (type, label, spc, clusters, list,
  find, data, chain, freeClusters, fsInfo; list also takes a directory's entry, in both readers), and
  `emu/refs/volume.mjs` openVolume picks the reader by the boot sector, so a card of either kind reads the same way.
- **What the firmware does (X, E143, 2026-10-29):** dosfat carries both FAT and exFAT (4.8, D), and the firmware
  formats a blank SDXC card exFAT, as the SD File System Specification has it (I, as recalled). `emu/test/test_storage.mjs`
  storageSdxc (`--sdxc`; in `emu/bin/test.mjs` on E143) puts a blank 64 and a 128 GiB card in a player; on both:
  - the insertion: the mount fails with `0xe08` after 125 ms, the format succeeds after 905 ms and the mount after
    745 ms (lab times), drive status `0x00013780`;
  - the layout: an MBR partition of type 0x07 at sector 32768, ending 262,144 sectors (128 MiB) before the card's end
    (133,922,816 and 268,140,544 sectors long); exFAT revision 1.0 labelled "OM SYSTEM", 128 KiB clusters (523,008 and
    1,047,296 of them: the cluster heap ends where the partition does), one FAT of 16,384 sectors at +16384, the heap
    at +32768, the root at cluster 4, PercentInUse 255 (not available), volume serial `0x54210000`. The 128 GiB card
    (137 GB) keeps 128 KiB clusters, not the 256 KiB the recalled table gives above 128 GB;
  - `refs/exfat.mjs` reads the volume back and finds it consistent, its backup boot region equal to the main one,
    before and after S2, whose file is found with the JPEG's bytes;
  - the firmware counts from the card, with one picture on it: 6,456 remaining shots and 2,638 s of movie (43:58) on
    64 GiB, 12,929 and 5,287 s (1:28:07) on 128 GiB, about 8 and 16 times the 8 GiB card's 803 and 5:25 (4.8.2), so
    neither count saturates.

  The units (`storageUnits`, in `test-pure`) build an exFAT volume by hand and read it back, with each checksum, the
  name hash, a looping chain and the bitmap's mismatches caught, and check the SDXC registers and the sparse 128 GiB
  card.
- **Round 5 (2026-10-29; X unless tagged): the tooling, the HLS side and the other bodies.**
  - The tooling: `emu/web/cardfiles.mjs` (both players' Card panel) and `emu/bin/modelcheck.mjs` read the card through
    `emu/refs/volume.mjs`, so FAT and exFAT alike; the panel's free count is exFAT's allocation bitmap's (FAT32's
    FSInfo as before), its slot record gives the card's kind and capacity, and `GET /api/session` the size asked for
    (`card_size`, GiB or null). The browser player's start options take the size (`?card_size=GiB`, a Card menu of 8,
    64 and 128 GiB, as node's `OM_EMU_CARD_SIZE`); `modelcheck.mjs --card-size GiB` puts a blank card of that size in
    each native body's slot, and an exFAT volume must also pass `refs/exfat.mjs`'s consistency check. Checked by
    `test_web` (an exFAT volume listed and read, one with a broken boot checksum refused, the session's and the slot's
    fields) and webgate's page life cycle (the 64 GiB card picked with the menu in headless Chrome, its exFAT volume
    listed, Take out and Put in).
  - The HLS side on E143 with a 64 GiB card (`emu/test/test_storage.mjs` storageSdxc, the checks of the 8 GiB card's,
    4.8.3): Card Formatting from the menu after a picture formats the card exFAT again with the layout the insertion's
    format gave it (the partition at 32768, 128 KiB clusters, 523,008 of them, the root at cluster 4, the serial
    `0x54210000` again), finished within 1.9 s of lab time (the 8 GiB card's 1.6 to 3.5 s); read back, the volume is
    consistent and its backup boot region the main one's, the picture gone and the free count the fresh volume's; the
    firmware's image count is 0 and its next file 1, and the application leaves Busy for the menu. The card out and
    in: the drive unmounts and the screen loses the counts; back in, the firmware mounts the card again 876 ms after
    the insertion (logsec's 740 ms wait, 4.8.3, then the mount), without a format (the boot sector unchanged), 6,456
    remaining shots before and after. S-MDACTRL and S-MEDIA needed no change.
  - The other bodies with a blank 64 GiB card (`modelcheck.mjs --no-port --card-size 64`, the TFT and the EVF; the
    shots the query answers after S1, the card empty):

  | Body | File system | Partition | Label | Remaining shots | The path |
  |---|---|---|---|---|---|
  | E146, E147 | exFAT, 128 KiB clusters | MBR, at 32768 | `OM SYSTEM` | 6,456 | ok on the TFT and the EVF, S2's file read back |
  | E139, E137, E140 | exFAT, 128 KiB clusters | MBR, at 32768 | none | 6,618 | ok on the TFT and the EVF, S2's file read back |
  | E142 | exFAT, 128 KiB clusters | MBR, at 32768 | none | 6,618 | ok on the TFT (no EVF), S2's file read back |
  | E125, E130 | exFAT, 128 KiB clusters | MBR, at 32768 | none | 9999 | ok on the TFT and the EVF, S2's file read back |
  | E144 | exFAT, 128 KiB clusters | MBR, at 32768 | `OM SYSTEM` | - | stops at the camera application's start (below) |

    The 8 GiB card's counts were 803, 826, 1607 and 2018 (4.8.4); with 64 GiB the OM-1 family's and E143's 6,456 and
    the E142 lineage's 6,618 are about 8 times theirs, and E125's and E130's 9999 is where their counts stop (I: a
    cap; 8 x 1607 is past it). The E142 lineage and E125 / E130 label the exFAT volume with nothing, as their FAT32
    is `NO NAME` (4.8.4); the E143 family and E144 `OM SYSTEM`. E134 kept S-CARD and was not tried (since 4.8.7 it
    formats a 64 GiB card exFAT, no label, 6,618 shots, and runs on).
  - **E144 stops (X; the addresses E144's):** the format and the mount succeed (exFAT `OM SYSTEM` in an MBR
    partition at 32768, 128 KiB clusters, consistent), then the camera application's start ends in S-MODACK's reply
    with Fault 6 at `0x5032574f`, `divu d1,d3` with d1 = 0, in the function at `0x5032553f` that builds the movie's
    parameters (4.8.5). The divide is in a branch taken only for the drive's kind 3: after the parameters' check
    `0x5032d626` answers 0, `0x503301b8(drive)` answers 3 (that 3 is exFAT is I: a 32 GiB SDHC card, FAT32 at 8192
    with 32 KiB clusters, starts as the 8 GiB one does, and on the 8 GiB card the check answers `0xff12` after the rate
    check's `0xa003`, 4.8.5, and the function returns before the branch). The divisor is the size at sp+84 in 512-byte
    units rounded up, and that size is 0 (the movie mode getter answers 1, UHD 4K at 60p, with either card, X); why
    the check passes and the size is 0 with this card was ? here (read in 4.8.7). The hardware raises no fault there
    (`emu/FIDELITY-NOTES.md` 3.2): the quotient goes to a compare that keeps it or sets 0, so the camera would carry
    on with a value that is not known. The same stop with 128 GiB. `modelcheck.mjs` holds it in SDXC_XFAIL, strictly. E139 and E137 read the same 4K 60p default
    (4.8.5) and run on: whether their builds have the branch is not read (E144's instruction run is not in their images,
    but their register allocation may differ, ?).
- **Open:** E144 with an SDXC card (why its check passes with a size of 0; then a defined answer at that seam, a
  stand-in with its label, never a guessed value); the HLS side on the other bodies (4.8.4), so the menu's format and
  the card out and in stay E143's; the node player's size is an environment variable only (no command-line option);
  movie files on exFAT (none is written in the lab). The first two are read or done in 4.8.7.

#### 4.8.7 E144's divide, the HLS side on E146 and E134's card, round 6 (2026-10-29; D unless tagged)

- **E144 with an SDXC card: the firmware's own divide by 0 (addresses E144's).** The movie-parameter function
  `0x5032553f` builds two requests from the movie mode's getters (4.8.5: mode 1, code 8, 60 fps, size class 1) and
  asks two rate queries. The first, `0x5032d4f9(0, sp+72)` -> `0x503e099b` -> the rate table `0x503e88ff`, fills
  the request's sizes (+8, +12: sp+80, sp+84) only on success; for 4K at 60p the table has no word, so it answers
  `0xff12` and leaves them as the memset left them, 0 (X: the errlog `0x3a040001`, the stack). This build does not
  test that answer (the call at `0x503255ba` is followed by `mov sp,a2`). The second, `0x5032d626(0, sp+92)` ->
  `0x503e09ae`, first asks the drive's file system (`0x5068bbea` -> `0x506a0809`: for a mounted drive the volume's
  FAT width, 12 or 16 -> 1, 32 -> 2, 64 -> 3, else `0xffff`; X: 3 on the exFAT card), and for 3 answers from
  constants by frame rate without the rate table (60p: 7,169,663 and 429,600 at `0x503e0a99..0x503e0aa6`, X on the
  stack), so it returns 0 on an exFAT card where it returns `0xff12` on FAT32 (the rate table again). With 0 the
  function asks `0x503301b8` (the same file-system query, 3) and runs its exFAT branch, then divides by the first
  request's +12 in 512-byte units rounded up, 0, at `0x5032574f` (and at `0x50325779` on the branch where
  `0x503282bb` sets its byte; not reached in the lab). So the divide is the firmware's own result for the blank
  store's movie mode, which E144 cannot record, with an exFAT card. Checked the other way (X): with the mode's byte
  (`0x6240645b`) set to 0 (FHD 60p, which the table has) before the function, the divisor is 0x63b2 and the start,
  S1 and S2 (its file on the card) run.
- **How emu models it:** it does not. The manual gives DIVU by 0 V=1 and leaves Dn, MDR, N and Z undefined
  (`docs/mn10300-isa-spec.md` 4.6, 8 item 1), and here the quotient decides the compare after it (kept when above 0,
  else 0), which becomes the movie time: no value can be given without a guess, so the core keeps Fault 6
  (`emu/FIDELITY-NOTES.md` 3.2) and `bin/modelcheck.mjs` keeps E144 in SDXC_XFAIL with this reason. Whether a real
  E144 can hold mode 1 at 60p (the factory's store, a reset's defaults) is ? (4.8.5); with a mode the body records
  it runs on with an SDXC card (above).
- **Why E139, E137 and E125 run on (goal b):** their movie-parameter functions (E139 `0x50322361`, E137
  `0x50315c81`, E125 `0x50331ce3`, by the map) test the first rate query's answer and leave with `0x9d08` on any
  error (E139 `0x503223d8..0x503223eb`, E137 `0x50315cf8..0x50315d0b`, E125 `0x50331d34..0x50331d47`) before any
  divide, and have no exFAT branch before it (their unit is a fixed 8 MiB shift, `lsr 23`). E143's tests the answer
  too (`0x504487fe..0x5044883c`), and its table has 4K at 60p.
- **The HLS side on E146 (goal c; `src/fw/models.mjs` E146 card_fs.hls):** each function S-MDACTRL and S-MEDIA call,
  and the senders and the reactive whose ids and sizes they rely on, paired by the map and compared with E143's
  instruction for instruction, absolute addresses and source line numbers masked: identical but for three ids (the
  media control request TRA 1509, the progress 1511 and the result 1512; E143's 1511, 1513 and 1514) and the API's
  reply queue halfword (`0x6004320e`, read at `0x503ecb06`; the map's data pairing gave `0x60043200`). X:
  `emu/test/test_storage.mjs --session` on E146 runs E143's checks of the menu's format and of the card out and in
  (40 of 40, as E143), and `--sdxc` with a 64 GiB card (30 of 30): the menu's format exFAT again within 1,929 ms of
  lab time, the layout the insertion gave; out and in, the mount 962.6 ms after the insertion, 6,456 shots before
  and after. E147 was tried with its own addresses (the same comparison; its UI_IN level getter has 7 groups and
  other special codes) and not landed: Format Card's Yes did not reach S-MDACTRL, and the card input found a
  control row without a UI_IN code (`play.mjs` card_input); neither is read. E144's HLS function component is
  another build (no `CmpCst_Function.cpp`; getMediaCtrlCBC and getMediaProgress do not pair): not attempted.
- **E134's card (goal d; `docs/model-survey.md` finding 23):** the queue FILECLBK blocked on is UI_OUT's, the module of
  the camera's lamps, not UI_IN's: E134's file layer asks it for the card's access lamp around its accesses, and
  nothing ran UI_OUT. H-UIOUTSTART runs its init and starts its task at the play bring-up (MODELS `ui_out`); the
  card is native on E134 since (X: modelcheck with the 8 GiB card, 826 shots, and with a 64 GiB card, exFAT, 6,618
  shots; `test_storage.mjs --session`, 22 of 22, in `bin/test.mjs`). Its movie time is 0, as on the E144 family
  (4.8.5; X: mode 1 at 60, the logs `0x3a040001` and `0x39000105`).
- **Open:** the HLS side on E147 (the two failures above) and on the E144 family (its own function component); a
  real E144's movie mode at the factory; the hardware's DIVU by 0 (a capture would settle 3.2).

#### 4.8.8 The E118 family's card, round 7 (2026-10-30; D unless tagged, addresses E122's)

The PEN-F's camera application divided by 0 in its movie time (`0x5056f5c6`) because the file system's volume object
(`0x618c0ff0`), which the file layer's init creates, did not exist: the lab ran the file system's bring-up only on a
body whose card is native, and `src/fw/facts.mjs` fileSystem found none on the E118 family (`docs/model-survey.md`
findings 31, 41). The family runs the other bodies' storage library; the rule now reads its five seams of another form:

| Seam | E143's form | The E118 family's (E122) |
|---|---|---|
| SD command layer | `0x508ad03c`: `mov a0,a3`, a busy word per port, status +74, response +32 | `0x50581242`: `mov a0,a2`, one busy word, status +62, response +28; code, argument, buffer, count and size at the same places around the response (`command_fields`) |
| File layer's flash | the NAND area read `0x5088d075`, 512 KiB at `0x41a00000` | two records the drive status reads at `0x402a0000` through `0x500510c1` (op `0x103` read, 0 write): 47480 bytes rounded to 512, then 1024 (`[0x402a0000, 0xbe00]`) |
| Album manager's init | `0x508b67e8`, starting ALBM_MAIN once | `0x505885df`: TSK_ALBM_MAIN (task 90) and a synchronous command 1 on queue 201; found by its trace "[ALBM]init exec" |
| Drive status | `exthu d0; mov d0,a2; cmp 7,a2; ...` | `mov d0,d3; exthu d3; cmp 2,d3; cmp 1; cmp 0; cmp 7` (`0x5057e8e3`) |
| Cache flush's return | the object from `(12,sp)` (`0x508881fa`) | the object from `(0x618c0ff0)` (`0x5056f480`) |

- **The dosfat result:** E122's dosfat (`0x505691b4`) does not store its error in the request's block (E143's does at
  +48 when its caller's flag allows, `0x50881732..0x50881736`); FILECLBK replies with it (`0x50577e41`, `{u16 status,
  word, parameter}` to the message's reply queue, none for the lab's; a status of `0xfff0` puts the message back on
  FILECLBK's queue instead, E143 `0x508900ec`, E122 `0x50577e67`). The rule reads whether dosfat stores it
  (`storage.fat_error`, +48 on the other 15 bodies, null on the family); where it does not, the lab's mount and
  format requests carry a tag in their word and read the status from an observer at the reply (fact
  `storage.fileclbk.reply`), installed while the request is out.
- **The SD host:** one port at `0x99000000` (DMA wrapper, SD core +0x2000, PHY +0x6000), SD_INFO2 bit 13 polled at
  `0x5058108c` (`src/fw/board.mjs` E118 `sd`); no UHS-II attempt (X: the card's command log starts CMD0, CMD8, ACMD41).
- **E122 (X, `bin/modelcheck.mjs E122`):** the blank 8 GiB card mounts with `0xe08` after 275 ms of lab time, the
  firmware formats it FAT32 `NO NAME` at sector 8192 with 32 KiB clusters in 165 ms and mounts it, drive status
  `0x3780`; 1470 shots and `00:37:19` (FHD 60p) on the shooting screen; S2's file `C:\DCIM\100OLYMP\P1010001.JPG`
  read back by `refs/volume.mjs`. S-FSNAND logs the record's read, a write of 48128 bytes and the next record's read
  at the insertion. A blank 64 GiB card (`--card-size 64`): exFAT with no label at sector 32768, 128 KiB clusters,
  9999 shots (the cap of 4.8.6), S2's file read back, the path as with 8 GiB (X).
- **E118 and E120 (2026-10-30, `docs/model-survey.md` findings 50 to 52, addresses E118's):** E118's bring-up
  polled for good (1 ms sleeps, more than 2,000,000 stand-in calls) for the answer to its SD driver's switch of a card
  line, which it asks of the sub-CPU through its body control's request 42 (`0x5057e30c` -> `0x5015ee69`, out by a
  deferred call over the link the lab does not model), where E122 and E120 set a GIO pin. The rule reads the request
  (`storage.card_switch`) and S-SDSWITCH answers it at its send (its callback with status 0). The family's
  deferred-call triggers (four words from `0x9b8000f4`, IRQs 30..33) are read by deferredCalls and modelled since.
  Both cards mount as E122's (FAT32 `NO NAME`, DCF 100 / 1, X); E118's movie record time then divided by the movie
  info's frame rate (`0x50535c40`; E143's query logs `0x39000903` for the same rate). E118 passes
  `bin/modelcheck.mjs` on the TFT and the EVF: 2116 shots and `00:37:19` on the 8 GiB card, S2's file read back (X).
- **The movie recorder's frame rate (2026-10-31, `docs/model-survey.md` findings 59 and 60):** the rate is the movie
  module's set-up's, which runs at a movie take's start or a movie's playback and never at the start, on every body
  read: on the E118 family in MVR_MAIN's record sequence on CPU 2 (state 2 / event 2, TAKE_FUNC's command 30's MVR
  command 16; state 0 / event 8, PLAY_IMAGE's command 81), on E143 in TAKE_MOV's take job. Before the first take the
  rate is 0 on the camera too: E143's query logs `0x39000903` there, and E118's record time divides by 0, the MN103's
  DIVU by 0 (FIDELITY-NOTES 3.2), for which alone S-MOVRATE now stands in (the quotient taken as 0, the camera's ?;
  the record time and the query run natively, where S-MOVRATE returned the function's error before).
- **The playback's file number:** the family's OlyHfwOpePlyCom::getNumber sends the play module the synchronous
  request 5 (E122 `0x506aacfa`; E143 only with its mode word at 3, `0x50ace1db`) and reads +4 the index, +8 the file
  and +10 the folder from the response block; S-PLAYSEQ answers it from the image shown, so PLAY and INFO draw
  `100-0001` (X).
- **INFO's still information (2026-10-31, `docs/model-survey.md` findings 57 and 58):** the family's getStillInfo
  sends the play module the synchronous request 3 (E122 `0x506aae96`), which S-PLAYSEQ left unanswered: the
  converter read getNumber's leftovers from the shared response block (0x0, 0mm, `0001.00.00`). On the camera the HLS
  play component answers it from api_play_Get_StillInfo_ExifData (`0x502e16b2`), which reads the Exif tags of the
  image the play module loaded into its play buffer (`play_exif_search_tag`); neither runs in the lab, and S2's
  picture is S-RECFILE's JPEG without Exif. S-PLAYSEQ now answers request 3 from the picture's own record: the
  camera's clock at the capture (its read, since 2026-11-02 E143's `0x5005a59e` at its place, the RTC driver's get
  `0x50068dbc` that api_sctime_GET_REAL_TIME calls; before, the API by its name, fact `clock.real_time`, retired),
  the JPEG's size, the release's exposure and
  S-LENS's focal length, in the layout the build's converter reads (fact `play.still`); and the histogram request 7
  empty. INFO on E122 shows `2016.01.01 00:00` (its unset clock's default; E118's and E120's `2015.01.01`),
  `1620x1080` (the lab's frame), `125` and `25mm` (X).
- **Not done:** the HLS side (S-MDACTRL, S-MEDIA) is E143's and E146's only; the picture's Exif (the lab's JPEG has
  none) and the play module's own load of it.

#### 4.8.9 REC_FILE's DCF steps, round 8 (2026-11-02; D unless tagged, addresses E143's)

S-RECFILE wrote the picture through fileif (4.8.2), which the DCF database did not see until the next mount: the
firmware's image count stayed 0 after S2, and S-CARD kept its own image list and count for playback. REC_FILE's own
steps are now read and run, the lab handing over only what the capture pipeline would: the JPEG's bytes.

- **The recorder (D):** `0x519f9dd7` records a whole file from a buffer as the recording modules do (a REC context of
  92 bytes on its stack, the type at +78 / +80, the size at +52 and +64, the buffer at +68, the drive at +76); it takes
  three blocks (64, 100 and 116 bytes) and calls in turn the recorder's lock `0x5054a850`, the camera's clock read
  into a time record `0x5012b7cd` (the sub-CPU's RTC, `0x5005a59e`), then the steps below, each a FILECLBK request
  sent synchronously (`0x5002e39d`), and the unlock `0x5054a860`; on an error after the open, the fnode's cancel
  (`0x5054af1d`, code `0x36`, dcfnum op 6). rec_file.c's record functions call the same steps (`0x5053f591`,
  `0x505408b5`, `0x50540950`, `0x5053f875`, ...). By FILECLBK's dispatch (`0x5088fd8a`; X, traced):

| Step | REC's builder | Code | FILECLBK runs | The block |
|---|---|---|---|---|
| open | `0x5054a894` | `0x32` | dcfnum op 1 `0x50878ec8` | +2 drive, +4 the folder's 8.3 name with `xxx` for its number, +16 / +20 the FAT time stamp (`0x5012ba46` packs the time record); back: the fnode at +24 |
| reserve | `0x5054a9e3` -> `0x5087e21a` -> `0x5088883b` | `0xf1` | dosfat `0x508886d6` -> `0x50881ba5` | +4 3, +6 drive, +16 the size, +36 the mode (2, then 0 where none is found); back: the first cluster at +0 |
| write | `0x5054aa51` -> `0x5054aa70` | `0x54` | dosfat op 4 (`0x508812f2`), the chain write | +6 drive, +8 the cluster, +12 the sector in it, +16 the sectors, +20 the buffer, +28 the mode, +32 the cluster, +36 the bytes; back: +60 the last cluster, +64 its last sector |
| entry | `0x5054acea` | `0x66` | dosfile `0x50888c9f` | +4 4, +6 drive, +8 the folder's cluster (the dnode's +28), +16 the name (eight letters, the extension's word), +20 the mode, +24 the size, +32 / +36 the stamp, +40 the first cluster, +46 the attribute 0x20, +84.. the dnode's entry place (`0x50872238`) |
| register | `0x5054ae50` | `0x33` | dcfnum op 2 `0x5087979a` | the open's block; the fnode's +88 its DCF kind (rec's table `0x606e03ac` by type: 1 for a JPEG), +44 the first cluster, +48 the size |

- **The open (dcfnum op 1):** it takes the next DCF number (the per-drive state `0xa33af310` + 56 x drive: +4 the next
  folder, +6 the next file), finds the folder's dnode by its number (`0x508720de`) and makes the folder where it is
  new (`0x508793b9`, the directory on the card included: X, `C:\DCIM` and `C:\DCIM\100OMSYS` on a blank card), takes
  a pending fnode (`0x50879ebf`) and names it `0x5087a253`: the file letter of the state's +10 (`P`), the stamp's
  month in hex, its day in two digits and the number in four (X: `PB020001` for a stamp of 2026-11-02; `P1010001`
  for the lab's unset clock, 2022-01-01 00:00:00 with status 10501, as E143's sub-CPU answers it); the extension is
  REC's to set (fnode +20, `0x5054a9b8`, the table `0x606e0384` by type: `JPG` for a JPEG).
- **The registration (dcfnum op 2):** a database fnode from the pool (`0x50874a36`) takes the pending one's 96 bytes
  (`0x50879f39`); the counts add 1 under its kind (`0x50874b48`: the table `0xa33aa5b4`, 52 bytes a slot, +0 the total
  and +4 + 4 x type, which the media API's image count reads through `0x502d1799`); the folder's dnode keeps the
  file's cluster, size, kind and flags in one of three records (+60, +76, +92, by its count at +26; `0x50879af5`);
  the next file follows; folder x 10000 + file goes to `0x5089c2d8` with 4 and the drive (what that does is not
  read).
- **The lab's part (S-RECFILE, `src/lab/storage.mjs` record()):** where the rule reads the build's recorder (fact
  `recorder`, `src/fw/facts.mjs`: E143, E146, E147, E144 and E148; none on the other 13 images, whose recording
  modules build the same requests in functions not read) the lab calls the clock read natively and sends the five
  requests with REC's blocks; FILECLBK runs each. The recorder's lock is not taken (nothing else records in the lab)
  and its error path (the cancel) is not modelled: a status not 0 stops the session. The chain write's sectors are
  `0x50880d1c`'s 512-byte form (a port's state byte +168, `0x508b0bd9`, is 0 in the lab: X). Elsewhere S-RECFILE
  writes through fileif as before.
- **What it does (X, E143):** two S2s give `C:\DCIM\100OMSYS\P1010001.JPG` and `P1010002.JPG` (clusters 5 and 6 on a
  blank 8 GiB card), the firmware's image count 1 then 2 and its next file 2 then 3 in the same session, its fnodes 1
  and 2 the two files (the DCF process's command 5, `{5, drive, index}`, which the fnode getter `0x50874bc9` sends);
  read back by `refs/volume.mjs`: the entries' dates the stamp, the bytes the JPEG's, FSInfo's free count less the
  folders' and the files' clusters. A 200,000-byte buffer goes to a chain of 7 clusters; on a 64 GiB exFAT card the
  file is contiguous (NoFatChain) and the volume passes the reader's consistency check.
- **fileif and a pending fnode (X):** an fopen of the name the open's pending fnode holds (`PB020001.JPG`, between
  the open and the registration) made a directory entry with a scrambled short name (`87 61 8c 60 b8 4f ae 62 68 c1
  1f`), and fileif's entries carry the file layer's own date (2022-01-01, `0x5421`), not the stamp: the steps are
  REC's together or fileif's alone (why fileif scrambles the name is not read).
- **S-CARD's image list retired where the database serves (`src/lab/camapp.mjs`):** with the recorder, the
  application's image count runs natively (no S-CARD hook on `0x503feea4`), the lab's count reads the database's table
  (fact `dcf.counts`, the getter's table, found on all 18 images), and playback's pictures are the database's at the
  play start: each index's folder and number from its fnode. The lab keeps only its record of each capture (the
  release, S-SCENE's scene, the clock and the lens), matched by folder and number; a picture from an earlier session
  has none (its view and still information are then those of no capture).
- **Open:** the recorder's own run in REC_FILE's task (the context the capture pipeline fills: on E143 since round 9,
  4.8.10); the older 13 bodies'
  recording modules (their builders of the same codes, not read; S-RECFILE writes through fileif there); RAW and
  RAW + JPEG files (types 0 / 3 / 9, the fnode's second file at +60..+72); the second slot.

#### 4.8.10 REC_FILE's task natively, round 9 (2026-11-08; D unless tagged, addresses E143's)

S2's picture file is recorded by REC_FILE's own task from the packet REC_IMAGE posts it, and the file's header (Exif,
maker notes, XMP) is built by REC_IMAGE's own header maker; on E143 only (`emu/src/lab/rec.mjs`). S-RECFILE retires
there (it stays on the other bodies).

- **The message (D):** REC's 316-byte packet, named field by field by its dump `0x50541561` (`pAlive` +0,
  `pExifParam` +28, `ObjResponse` +32, `Number` +44, `Packet` +48, `Command` +52, `HandleTarget` +116, `BuffAddr1..3` /
  `BuffSize1..3` +144..+164, `BuffAddrDoubleSlot` +168, `HeaderSize` +184, `Addr` +188, `Size` +192, `Status` +208,
  `Mode` +210,
  `Media` +214, `Media2` +216, `RecordDevice` +218, `ExifFileType` +288, `ExifFileTypeDoubleSlot` +290, `NoRecord` +298,
  `ImgAspect` +299, `NoCheckOut` +300, `Free` +302, `SlotNo` +313, `FileType` +314, and more). REC_MAIN builds it (its
  clear `0x50539e89..0x50539f0e`, `Mode` 4097 for a still at `0x5053a349`, `pExifParam` = `0x503afc3e(HandleTarget)`,
  TAKE's per-shot record), REC_IMAGE takes it over and REC_FILE gets it last.
- **Who posts it (D):** REC_IMAGE's task on CPU 0, with `0x5053990f(packet, queue)` to REC_EXEC_FILE 69 (`0x6004324e`):
  after its image (`0x50542359`, from `0x505422f1`) or at once for the modes 4100, 4103, 4105 and 4115 (`0x50541f16`,
  its dispatch table `0x606dff80`). The queue's id is read at six places: REC_FILE's init (`0x5053f189`, which binds the
  queue to flag 265), its receive and its exit, REC_IMAGE's two posts and the object-name list; so neither the
  shooting sequence nor CPU 1 / 2 post to REC_FILE directly (REC_MAIN posts to REC_IMAGE's and other queues,
  `0x50539b61`, `0x5053a388`, `0x5053d7b6`). REC_FILE (task 27, `0x5053f1a4`) waits on flag 265 (`0x60043182`): bit 2
  the queue (receive `0x5054dd40`, 316 bytes; handler `0x5053f354`), bit 0 a second input (`0x5054ebc8`; ?).
- **What it does (D, X):** the handler (trace `rec_file_record_entry`; REC's trace names by index `0x506bdb88`) picks
  the double-slot record (`0x5053f97d`, when `RecordDevice` bit 0, `RecordMediaMode` above 1 and a `Media2`) or the
  destination record (`0x50540345`): `RecordDevice` bit 0 the card (`rec_make_file` `0x5053f294`, then
  `rec_file_record` `0x5053fec0`), bit 2 another destination (`0x5054095d`, ?). `rec_file_record` takes `BuffAddr1` /
  `BuffSize1` (or the second buffer where `FileType` is 0), fills the file context for `Media` (`0x62a8c4e4`; `Media2`'s
  `0x62a8c540`, 92 bytes) and runs the five steps of 4.8.9 through FILECLBK: open `0x5054a894` (the folder name
  `xxxOMSYS` from its immediates `0x5054a903..0x5054a913`, the stamp from the shot's time record, `pExifParam` +37800),
  reserve, chain write, entry, register. It does not build the header. After it: the buffers freed to REC's pool
  (`0x5054bbfd`: pool 3, mode 1 for `Mode` 4097), the shot's DCF checkout (`0x50540784` -> `0x5087e0de`, the per-drive
  pending list `0xa33af3e8`, 115 entries keyed by `pExifParam`, which the media check-in `0x5087deb7` fills from the
  API `0x5040f2ec`, called from HLS components), the release of REC's resources (`0x50540cac`, `0x500044f2` with
  101..104) and, with `Free` set, the completion: `{Status, Number, Packet}` to the `ObjResponse` queue (`0x5053984b`)
  and the `HandleTarget`'s events (`0x50025095`, `0x5054059e`).
- **The header (D, X):** REC_IMAGE's `rec_jpeg_exec` (`0x505497e5`, from `0x5054215e`) allocates the file's buffer
  (`0x5054bb12`: pool 3), clears 41984 bytes at `Addr` (`0x5054c982`: the aligned middle through the image engine's
  fill `0x5048ee61`), has the image encoded (`rec_jpeg_make_image` `0x50549b42`, an imgpro_mdl request `0x50491699`),
  then `rec_jpeg_make_header` (`0x50549bf1`): the EXIF parameters from the shot's record, `HeaderSize` 41984, SOI, APP1
  `Exif` (the EXIF module's serializer `0x50429935`, table-driven: `{tag, type, bytes, offset}` at body `0x6058e0`,
  with the Olympus maker notes, `OM SYSTEM`, and IFD1's thumbnail slot), APP1 XMP (`0x5042aa91`), and `BuffAddr1` /
  `BuffSize1` = `Addr` / `Size` (`0x50549a00`). The XMP segment ends 2 bytes past `HeaderSize` and the header maker,
  run after the encode, writes them (X: `0a 00`), so the encoder's stream starts at `Addr` + 41984 with its SOI
  overwritten (I). The EXIF parameter template is the EXIF module's (`0x62a6c358`, 92252 bytes; init `0x504298bd`,
  called from the start function `0x501e9a7c`: Exif version `0231`, FlashPix `0100`, `R98`, Make and Model from the
  settings store, ids 11073 and 25329), which TAKE copies into each shot's record (`0x504298f9` from `0x503bba70`) and
  fills (its shooting values, then the EXIF set `0x5042992d` from `0x503bd48e`; the dates by `0x5012bd20` with the
  format `0x4200` from the time record +37800 into +4089, copied to +4109 and +1364).
- **The lab's part (`emu/src/lab/rec.mjs`):** before the first picture (I: nothing in the lab reads their state earlier;
  run at the bring-up they moved every golden session's instruction counts, X), H-EXIFINIT (the EXIF module's init
  natively, its cache flush answered), H-RECINIT (REC's module init `0x50539665`), H-RECFILE (REC_FILE started, act_tsk;
  I: which call starts it on the camera is not read). At S2: S-EXIFPRM, the shot's record as TAKE would hand it: the
  template copied natively, the clock read into +37800, the dates formatted natively, and three records the header maker
  divides by, the crop areas +40858 / +40866 `{0, 0, 1, 1}` (I: the full frame) and DigitalZoomRatio +4228 1/1 (I); the
  EXIF set itself does not run (X: it divides by zero in TAKE's state at `0x50398ca5`), so exposure, aperture, ISO,
  focal length, the lens and the image size stay 0. S-RECIMAGE, REC_IMAGE's part: the packet for a single-slot JPEG
  (`Mode` 4097, `Media` 0, `Media2` none, `RecordDevice` 1, `ImgAspect` 1, `FileType` 1, `HandleTarget` 1, I: the lab's
  one shot; the rest 0 as REC_MAIN's clear leaves it), `rec_jpeg_exec` natively on it, REC_IMAGE's post natively, then
  lab time until REC_FILE's handler returns (`0x5053f20d`). S-JPEGENC, the image pipeline's work inside it: the encode
  writes the lab's JPEG (without its JFIF APP0) at `Addr` + 41984 and sets `Size` (I), and the image engine's fill (a
  kind-14 request to the imgpro unit `0x9c600000`, not modelled) is done by the lab for REC's header clear only.
- **What it does (X, E143):** S2 gives `C:\DCIM\100OMSYS\P1010001.JPG` (41984 bytes of the firmware's header, then the
  lab's stream; 73,410 bytes with the live view); with the clock set first through the firmware's clock setting
  (`0x5012b7a7`, 2026-11-08 12:34:56) `PB080001.JPG`, whose Exif (read by `emu/refs/exif.mjs` and exiftool) has Make
  `OM Digital Solutions`, Model `OM-1`, DateTime, DateTimeOriginal and CreateDate `2026:11:08 12:34:56`, Exif version
  `0231`, the maker notes `OM SYSTEM` (20,156 bytes: CameraID `OM SYSTEM CAMERA`, CameraType2 `OM-1`, serial
  `00000001`) and an IFD1 thumbnail of length 0; with the clock unset the dates are `0000:00:00 00:00:00`. The file
  decodes (refs/jpeg.mjs, ImageIO); the firmware's image count is 1 and its next number 2 in the same session; on a
  64 and a 128 GiB exFAT card the same. The firmware logs warnings that follow from the stages the lab does not run:
  `0x0d090002` and `0x1e01500e` (the header maker's record `0x5000457f(123, 108 bytes)` refused), `0x1e001001` (the
  checkout finds no pending entry, `0xd01`), `0x1e01500d` twice (the resource releases refused).
- **Open:** the thumbnail and the shooting values in Exif (TAKE's record and the EXIF set, step 7); the media check-in
  (the HLS side); RAW and RAW + JPEG (`FileType` 0, `ExifFileType`, the type table `0x60358df8`); `Free` and its
  completion with a requester (api_rec); REC_IMAGE's and REC_MAIN's tasks themselves (the image pipeline); the E144
  family (E144 and E148 keep S-RECFILE's DCF steps; their REC is another version, below). E146 and E147 since the same
  day (below).
- **The second slot (survey, D):** the packet carries it (`Media2`, `ExifFileTypeDoubleSlot`, `BuffAddrDoubleSlot`,
  `SlotNo`) and REC_FILE records both slots in `rec_file_record_DoubleSlot` (`0x5053f97d`, the second file context
  `0x62a8c540`): the type `0..12` by `ExifFileType` and `ExifFileTypeDoubleSlot` (0 JPEG, 2 RAW, 5 RAW + JPEG;
  `0x5053e165`) indexes a table of three files per slot (`0x60358df8`, 12 bytes a type: `{buffer, kind}` pairs, the
  second slot's JPEG from `BuffAddrDoubleSlot`). The file layer names drive 1 `D:`, the SD host's port 1 is
  `0x9a300000` (IRQs 229 / 231 / 232), the card driver's detect table has both drives, the HLS mount word's kind 8 is
  SD2 (`0x60360c08`) and slot 2's switch is `0x1518` (4.8.2, 4.8.3). Not read: which setting picks the slot and the
  double-slot mode (Card Slot Settings; the source of `RecordMediaMode`, `Media` and `Media2` in REC_MAIN's packet),
  and sd_mount's and the insertion's path for port 1. So the model keeps one slot: the lab's insertion mounts drive 0
  only, and the second slot is left out of the model.
- **E146 and E147 (2026-11-08; D unless tagged).** REC_FILE runs natively on both (`src/fw/models.mjs` `rec_native`),
  every address and layout `src/lab/rec.mjs` uses read from each image by a rule (`src/fw/facts.mjs` `recFile`, fact
  `rec_file`; on E143 it reads the values given by hand before, `REC_FILE_E143`, and `test/test_facts.mjs` pins all
  three):
  - *How the rule finds them:* REC's trace table (`{name, id}` pairs opening `{"ERROR TRACE ID", 1}`, `{"rec_main",
    2}`: E143 `0x506bdb88`, E146 `0x506a2ac0`, E147 `0x506c3840`; another module's table, E146 `0x50a00f3c`, opens with
    the same string) gives each function by the trace call it holds, `or 0x31000000,d0; ...; mov (id - 1) << 16 |
    line,d1` (rec_jpeg_exec, rec_jpeg_make_image, rec_file_record; "REC post_msg" with `0x10020000`); REC_FILE by its
    receive with the file name `rec_file.c` (E146 `0x5051bfea`, E147 the same shape) and the static task that runs to
    it; its queue's bind right before its entry; REC's module init as the bind's one caller; the packet's fields by
    the packet dump's reads before each padded field name; the EXIF module by its template copy after its init, the
    EXIF set's date formatting, its tag table and the crop areas' pick; the clock setting by the function that ends
    right before the clock read.
  - *What differs from E143:* the packet is 276 bytes, not 316 (REC_FILE's receive and REC_IMAGE's post), and its
    fields lie elsewhere (their dump: `pExifParam` +20, `ObjResponse` +24, `HandleTarget` +100, `BuffAddr1` /
    `BuffSize1` +132 / +136, `HeaderSize` +172, `Status` +184, `Mode` +186, `Media` +190, `Media2` +192,
    `RecordDevice` +194, `ImgAspect` +269, `Free` +271, `FileType` +273). `pPacketAddr`, `pDcfFnode`, `Addr`, `Size`,
    `SlotNo` and a few more are not in the packet: `ImgProID[0]` +0, `IFinishID` +4, `Addr` +8, `Size` +12, `SizePrim`
    +16, `RecordTarget` +34, `RawJpeg` +46, `CbExecute` +48 and `SlotNo` are fields of REC_IMAGE's image record, 52
    bytes, which the packet's +180 points at and the dump prints after the packet's own (E146 `0x5051ec6e`). REC_IMAGE
    keeps the record on its task's stack and inits it before rec_jpeg_exec (E146 `0x5052b008`, called at `0x5051ee45`:
    cleared, `CbExecute` 1, the packet's +180 set to it; E147 `0x5053a22f`); rec_jpeg_exec (E146 `0x5052785e`, E147
    `0x50536a6c`) stores the buffer at the record's `Addr` and reads the encoded size from its `Size` after the header
    maker (E146 `0x5052791f`, `0x5052797f`), then sets `BuffAddr1` / `BuffSize1` from them on the lab's path (the
    record's `RawJpeg` 0, `RecordTarget` not 2: `0x50527adc`). HeaderSize is 41984 on both. The EXIF parameter block is
    91704 bytes on E146 and 91960 on E147 (E143 92252): the offsets the tag tables give (Make +1480, Model +1504,
    DateTime +1364, DateTimeOriginal +4089, CreateDate +4109, DigitalZoomRatio +4228; 95 entries, as E143's) are
    E143's, the ones past them are not: the capture's time record +37452 on both (E143 +37800; the EXIF set's date
    formatting E146 `0x504280e7`, E147 `0x504363ed`), the crop areas +40312 / +40320 on E146 and +40576 / +40584 on
    E147 (E143 +40858 / +40866). The header clear's fill takes a fourth argument (`mov 0,a1`; E146 `0x5048142b` from
    `0x5052abb8`), which S-JPEGENC ignores. REC_FILE is task 27 at priority 54 on both, as on E143 (E146 `0x5051bfa3`,
    E147 `0x5052b093`); its file contexts (E146 `0x62abb0cc` / `0x62abb128`, E147 `0x62ab7d08` / `0x62ab7d64`) keep
    E143's layout (D: rec_file_record stores their +78 and +52 as E143's does; X: the file's fnode and folder read
    through them match the card); E146's rec_file_record also sets a state by the result of its first check
    (`0x5051dcc1` with 80, 85 or 90 at `0x5051cde8..0x5051cdfd`, ?: not read).
  - *What runs (X, `test/test_storage.mjs` on each body, OM_EMU_MODEL):* with the clock set through the firmware's
    clock setting (E146 `0x5012bad8`, E147 `0x501358fd`) S2 gives `C:\DCIM\100OMSYS\PB080001.JPG`, 73,410 bytes
    with the live view (41984 of header, then the lab's stream), whose Exif (refs/exif.mjs and exiftool) has Make `OM
    Digital Solutions`, Model `OM-1MarkII` on E146 and `OM-3` on E147 (the strings in each image: E146 body
    `0x8c300`, E147 `0x74a84`; the maker notes' CameraType2 the same), the three dates `2026:11:08 12:34:56`, Exif
    version `0231` on E146 and `0300` on E147, the maker notes `OM SYSTEM` and an IFD1 thumbnail of length 0, and
    the same tags on both (exiftool); the firmware's image count 1 and next number 2 in the same session, and the
    next session's DCF mount finds it. Around S2 the firmware logs E143's REC warnings (`0x0d090002`, `0x1e01500e`,
    `0x1e001001`, `0x1e01500d` twice) and the codes E143 logs there too (`0x08010005`, `0x39000903`). modelcheck's
    S2 and playback path passes on both.
- **The E144 family (survey, D).** E144 (OM-5) and E148 (OM-5 II) hold REC's trace table (E144 `0x50556e4c`, 191
  pairs; E148 `0x5055e2b8`) and the traced functions (rec_jpeg_exec's trace E144 `0x503ff3f3`), the packet dump with
  E143's form (`Addr` +180 and `Size` +184 in the packet, `FileType` +298) and the EXIF module's date set with the
  time record at +28508 (E144 `0x5030dc6a`). The rest is another version, which the rule does not read: REC_FILE
  (E144 task 31, `0x503f5dc0`, priority 54) blocks in REC's receive wrapper `0x503f1206` (300 bytes; no event flag,
  no bind, and the receive does not pass `rec_file.c`), the EXIF template init `0x5030b384` has no cache flush and
  its template is 31700 bytes, the date set loads the time record with a 16-bit add in another order, and E143's
  crop-area pick and file-context pick are not found (not read further). E144 and E148 keep S-RECFILE's DCF steps; a
  port needs those forms read.

### 4.9 HDMI and DisplayPort

Status (2026-10-23): the plug of a cable runs natively down to the transmitter and the hot-plug pin, with the play
option `--hdmi on` and its input `hdmi plug` (`src/dev/hdmi.mjs`, `src/lab/edid.mjs`; FIDELITY-NOTES 4.5) on E143, E146
and E147; off by default. Since 2026-11-08 on E143 the plug goes on to the HDMI output: the application's change of
output device (TRA 588) is taken by S-OUTDEV, and the IO-device capability's open, the transmitter's open and VSC
channel 0 at 1080p59.94 run natively; channel 0 composes its window, with nothing drawn on it yet. The input `hdmi
unplug` runs natively down to the disconnect report (A-HDMI-1). Addresses are E143's (disassembly notation) unless a
body is named.

- **Driver (D):** inside the display code, `0x501d1381..0x501d6ad0` (about 7.7k): the HDMI init `0x501d15e8`, the IRQ
  239 (level 5) handler `0x501d508a`, the EDID read `0x501d3113`, the EDID step `0x501d34b8`, the state getter
  `0x501d30f6`, the hot-plug handler `0x501d6501`, the HDMI open `0x501d5bae` (from DISPLAY cmd 2, `0x501d14f5`). The
  driver's own task DISPLAY_DP 0x8e (`0x501d1381`) is a debug / ES test task by its strings (I), and DisplayPort has its
  own EDID reads. The DISPLAY task runs the HDMI open; the hot-plug work runs in task 16, the deferred-call task (kernel
  spec 9.6), on E146 and E147 in an HDMI task of their own (below).
- **Registers (D: the reader `0x501d55d8`, the writer `0x501d5645`):** a byte-register file at `0x99c07000`, register r
  in byte lane r & 3 of the word at r & ~3, read and written as words. The writer first stores (keep << 16) | 1 to the
  lane word `0x99c08000`, keep naming the three lanes the word store leaves alone (14, 13, 11, 7), then the byte in its
  lane. Register 8: bit 3 hot-plug detect, bit 4 receiver sense (I: names; `0x501d1727`, `0x501d173b`). Interrupts (the
  status reader `0x501d1985`): the summary 0x90 (bit 2 for 0x92, bit 4 for 0x94, bit 6 for 0x96), the statuses 0x92 /
  0x94 / 0x96, written back by the reader (W1C, I), their masks 0x9a / 0x9c / 0x9e (set and cleared by `0x501d17a3(off,
  &bits)`), and 0x98, which the init sets to 0x57 (I: the summary's mask). The handler, asked for 0x846: bit 2 (0x92 &
  3) calls `(0x62a3c9f4)`, bit 4 (0x92 & 0xc) `(0x62a3c9f8)`, the hot-plug callbacks `0x501d648c` / `0x501d64b6` that
  the display init stores (`0x501d5b85`); 0x94 bit 7 with bit 5 sets the DDC wait's flag `(0x60043176)` with pattern 1,
  with bit 6 pattern 2; 0x96 bit 7 sets `(0x6004308e)`, which the HDMI open's wait `0x501d5149` takes. The DDC: `0xa80`
  segment, `0xa81` offset, `0xa82` count - 1 (I), `0xa83` the command: 130 in the EDID read (an E-DDC read, I), 128 in
  the open's SCDC write `0x501d5186` (by way of `0x501d1b92`, `0x501d53d1`: slave `0xa8`, register `0x20`, the byte at
  `0xc00`, I: SCDC TMDS configuration; it polls 0x94 until one of its bits 5..7 is set, then writes 0xff to it), the
  data at `0xc00..`. The PHY / PLL words at `0x99c08004`, `0x99c08054`, `0x99c080fc` (the power step `0x501d174f`,
  `0x501d166c`) were the lab stub's until 2026-11-08; they and the open's `0x99c08040..48` are the device model's
  storage now (below).
- **Hot plug through a GIO pin (D):** the display init registers pin 77's handler `0x501d6243` (`0x501d696c`: the GIO
  mode `0x500519ce(77, 5)` and handler `0x50051a29(77, {type 0, handler})`) and enables it (`0x501d6926`). The GIO
  driver maps a logical pin through `0x500029ad` (class 0 here) to the class's functions (tables at run time
  `0x60118f30..0x60118fa0`: read `0x50002a35`, mode `0x5005222f`, handler `0x5005229f`, enable `0x500523ae`, disable
  `0x50052462`); the pin's level is bit 4 of the word `(0x60025ff8)[77]` = `0x9b881540`; the pin's slot is
  `0x60026788[77]` = 124, its record `0x600268f4 + 32 x 124` = {pin word, 0, IRQ 109, the group handler `0x500529af`,
  status `0x9b883038`, enable `0x9b883178`, bit 0x40 for type 0, 0x80 for type 1}, its state `0xa32c1f74 + 24 x 124`.
  The mode function takes only a free slot (255, `0x500525c7`; otherwise it returns `0xffff`) and attaches the record's
  IRQ (`0x50053f76`; level 5 here); the group handler `0x500525ee(121, ...)` calls the handler of each slot whose status
  and enable bits are set and writes the bit back. The slots are freed by the GIO init `0x50002a20` (last step
  `0x50002b5d`, 325 slots; before it `0x50002b84` and the board's pin setup `0x50002a59`), which the lab does not run:
  without it the display init's registration is refused without a word (X). On a rising pin the handler reads pin 77
  high, turns the pin's interrupt off (`0x501d6949`) and defers `0x501d6286` (`0x501d64e0`: flag `0x62a3ca21`, the
  poster `0x50053505`); low, it calls the disconnect send `0x501d644b`. E146 and E147: the same pin, words, slot, bit
  and IRQ (their tables, D).
- **The plug's sequence (D, X on E143, E146, E147):** in task 16 `0x501d6286` runs the HDMI init (state 0, IRQ 239
  attached, the clocks `0x501c7806`, the power step: lane word 1, the PHY words, `0xa32db45e` = 1; then 0x98 = 0x57,
  0x33, 0x05, 0x20, 0x21, 0x0a; OlyTaSS(1)) and the hot-plug handler, which wants the transmitter powered (`0x501d179a`)
  and then, for up to 30 passes, hot-plug detect and receiver sense: both high, it enables their interrupts (0x9a) and,
  with the state 0, runs the EDID read; detect without sense, with `(0xa32db46c)` = 1, it sleeps 100 ms a pass and after
  20 sets the state 0xff and posts `0x04020201` (`0x50025095`); detect low, it calls the disconnect send. The EDID read
  enables 0x9c's bits 5..7, writes 12 to `0xa9c` and per block b writes `0xa80` = b >> 1, `0xa81` = (b & 1) x 128,
  `0xa82` = 127, `0xa83` = 130, then waits in OlyEvWt on the DDC flag for 1000 ticks; pattern 1 runs the EDID step,
  pattern 2 prints "DDC RETRY"; it ends at state 0xf0, past block 64 or after six failed tries (errlog `0x37009108`, (3,
  2532, block, tries)). The step: block 0's checksum (`0x501d3d91`: the 128 bytes sum to 0) and the base parse
  `0x501d35dc` (the extension count, byte 126, to `0x62a3c8ed`; bytes 8..19 to `0x62a3c7f8` (manufacturer), `0x62a3c7fa`
  (product), `0x62a3c7f4` (serial), `0x62a3c7fc..ff` (week, year, version, revision); the 13 bytes from byte 95, the
  third descriptor's text, to `0x62a3c800`); state 0xf0 without an extension, else 1 and `0x62a3c8ee` = 1. Each later
  block: the checksum and `0x501d36a4` by its tag (2: the CTA-861 parse `0x501d36e4`: `0xa32db460` |= 8, tag, revision
  and timing offset to `0x62a3c810..812`, byte 3's bits 7..4 and its low nibble to `0x62a3c813..817`, then the data
  blocks: video VICs to `0x62a3c819..` (count `0x62a3c818`, at most 64, each matched against the table at run time
  `0x602bd278`), audio, vendor and extended blocks); state 0xf0 once `0x62a3c8ee` reaches the count. The hot-plug
  handler then calls the connect send `0x501d6402`: `0x501d699b` asks UI_IN for the switch `0x0501` (`0x5014c015(0x0501,
  2)`), and for its answer 1 (the lab's idle state, X) `0x501d69c2(1)` calls the group-4 producer with `0x02020501` and
  0 (H-G4SET's), and UI_IN forwards EV_HDMI_CONNECTED to the camera application. A failed read (the EDID read returns 0)
  logs `0x37008206` (1, 821, ...), sets the state 0xff (`0x501d3242`) and sends the connect report all the same. With
  the lab sink (S-HDMISINK: 1080p60, base block plus a CTA-861 block) the sequence takes 1.4 ms of lab time on E143: IRQ
  109, then IRQ 239 for each of two E-DDC reads (segment 0, offsets 0 and 128), state 0xf0, the fields as above (VICs 16
  native, 4, 3, 2, 1), one connect report (X, test_hdmi.mjs); with the base block's checksum off by one, six reads of
  block 0, both errlog entries, state 0xff and the report (X).
- **The DDC wait and IRQ-anywhere (X):** the wait is task 16's (E146 / E147: the HDMI task's) OlyEvWt, not in a display
  run: the task blocks natively, the CPU takes IRQ 239 at the idle point, its handler sets the flag and the task goes
  on. The transmitter completes a read when its command is written (I), before the wait, so no interrupt has to be taken
  anywhere but at the idle point; nor does S-IRQFIRST apply. HDMI is not a test case for ROADMAP step 3.
- **E146 and E147 (D):** the driver's code and its tables are E143's but for addresses, and the sequence's transmitter
  accesses are E143's (X: the same registers and words). The deferred call is replaced by an HDMI task the display init
  starts (E146 `0x501dc568`, E147 `0x501e3eca`; src/fw/models.mjs extra_tasks): the GIO handler (E146 `0x501dc2d1`) sets
  the task's flag (E146 `(0x60042fe2)`) with pattern 1 (`0x501dc544`), for which the task runs the HDMI init (E146
  `0x501d6aa2`) and the hot-plug handler (E146 `0x501dc5aa`); patterns 2 and 4 run the handler only. The EDID state is a
  word (E146 `0x62a67880`, E147 `0x62a655e4`).
- **After the report (X):** the camera application takes EV_HDMI_CONNECTED natively (CCommon::doHdmiConnectChange,
  setOutputType, getHdmiState by their strings), its display manager sends DISPLAY cmd 18 (S-DISPQ), and the TFT leaves
  the date prompt for the shooting screen. The same frame and cmd 18 follow H-G4SET's toggle of `0x0501` in a session
  without the port, so the driver's EDID state does not change what the application shows here.
- **Why no OPEN followed (D, X, 2026-11-08):** doHdmiConnectChange `0x510c4672` asks the camera API (`0x50afccd5`) its
  vt+56 (`0x50afcf14`, query 65803, `0x50abdbb5`: 1 while UI_IN's `0x0501` reads 1), which answers 0 once the report
  set it to 0 (X), reads settings 288 and 304, and calls vt+20 (`0x50afcd3a`, query 65797) with device 8:
  OlyHfwOpeCamCom's change of output device `0x50abcf49` builds TRA 588 (`0x50abf14d`: +32 the device, +36 the second,
  +40 0) and executes it at `0x50abd146`; S-TRAACK answers the exec 0 (X: the camapp log's "tra 588 from
  0x50abd14d"), so nothing opens. Then setOutputType `0x510c4946(1)` asks vt+28 (`0x50afce9d` -> `0x50abd8aa`, query
  65798), which maps the current device (`0x50ab651a`, the output-device property 4513 read at S-PROP's site
  `0x503eff61`) to type 1 and prints "not connected to HDMI" (X). The application waits for no setting, GUI state,
  second event or CPU 1 / A53 answer: the open is the transaction's (D below), and the lab answered it. In the camera
  the active state's component takes 588: CmpCst_Function (`0x50ce992d..0x50ce9a3f`) and CmpSqp_SequencePartsBase
  (`0x50c8fd69`, in nine vtables) each build the IO-device capability's event 224 (`0x50bf2f4e`: +28, +32, +36 the
  request's three words) and send it to CapIod_IODevice (their +636 / +696), beside steps of their own (the through
  image's bank `0x50bd5ff2(512, device == 8)`, their reply). CapIod (the singleton `0x50be92ca`; X: constructed, in its
  state 6, in both camapp modes) takes 224 in state 6 (`0x50bea64b` -> `0x50beace2` -> `0x50beab11` -> its change of
  device `0x50be9c6c` -> `0x50be9855` for 8), writes property 4513 = 16 (`0x50bea474`, X) and calls DevDpc's openDevice
  (vtable slot 31, `0x50d83338`, at `0x50be9c42`), which sends DISPLAY cmd 45 (`0x503e6aca`) with the code
  `0x0d000004`. Neither component runs it in the lab: S-TRAACK answers every transaction at the exec, with the
  components too, and in camapp 1 HIGHLEVEL_MAIN (task 57), whose OXF loop dispatches the reactives' events, does not
  run (X: 224 sent natively through `0x50d7f925` was queued and CapIod stayed in state 6).
- **S-OUTDEV (E143, `--hdmi on`; `src/lab/camapp.mjs`):** at TRA 588 the lab does the part both components share,
  after the step: event 224 built by its own constructor and made CapIod's current event, then CapIod's dispatchEvent
  natively (S-BOOTDONE's way); S-PROP's property 4513 then follows the value CapIod wrote (16). Only the HDMI output (8)
  is taken; another device stops the session. The components' own steps are not done.
- **The HDMI open (X: E143, format 13):** CapIod's openDevice reaches the DISPLAY OPEN of `0x0d000004` (S-DISPQ's run
  of cmd 45), which programs VSC channel 0 from the HDMI format table `0x60355614` (80 bytes a format, getters
  `0x501d5965..0x501d5b6b`, D; format 13: VIC 16, period 16683 us (59.94 Hz), progressive, 1920 x 1080 at (192, 41),
  vtotal 1125, vsync 5, htotal 2200, hsync 44; format 12 is the 16666 us one), closes the TFT (the opened word
  `0x0d000004`), and calls the HDMI open `0x501d5bae`: the EDID wait passes at once (state 0xf0), `0x501d2a44` writes
  registers 7, 0x33, 0x20..0x23, the indexed table `0x501d54b4` (0x31 / 0x30 select 0..8, data 0x24..0x2c), 0x0c, 0x05
  and 0x98 = 0x57; `0x501d67b4` posts AUD_EXEC function 36 with argument 4 (queue 8, reply queue `0x60043308`), and
  AUD_EXEC, native, answers it ("Response from Audio", `0x501d68c6`); `0x501d1b92` sets the format's PLL words
  `0x99c08040/44/48` (`0x501d5205`, by the format's code at +16) and makes the SCDC write (`0x501d53d1`: register 0x19
  = 1 and data 3 only for codes 16..21 under further conditions, I: the 4K formats; else 0 and 0; format 13's code is
  12); `0x501d1c39`, `0x501d1ca0`, `0x501d2261` and `0x501d2bab`
  fill 0x40..0x75, 0xa8..0xb9, 0xc0..0xc5, 0x200..0x228, 0x264, 0x268 and 0xe00..0xec0 (I: video, AVI and audio
  infoframes, by the packet update names below); the lines are both high on the first pass; `0x501d291c` requests the
  update: UPDCTRL 0x11 = 0x97, then SUPDCTRL 0x12, PKTUPD 0x204 / 0x205 and VSIUPD 0x211 / 0x212 by its argument's
  bytes (the names from its prints, D), and `0x501d5149` waits for `(0x6004308e)`, which IRQ 239 sets for 0x96 bit 7
  (the status reader's 0x800): "Update Done". The open takes 0.71 s of lab time; DISPLAY then publishes `0x04020218`,
  which openDevice waits for, openDevice re-sends the palettes for kind 8 (`0x503e52c7`, natively) and the component
  observer Cmp_ObserverNotifyChangeDeviceSuccess `0x50c66ee5` posts event 494 to CmpCst_Function. No errlog (X,
  test_hdmi.mjs). Two harness rules gave way: a display run now leaves to the kernel the reads of another task
  (AUD_EXEC, which the post woke) and the run's own read of another queue (the reply; `src/lab/display.mjs`
  task_message).
- **The transmitter in the open (X; `src/dev/hdmi.mjs`):** the open adds 27 words to the model's storage and the PHY
  words beside the lane word; every read it makes is read back to be modified (D: the callers). Command 128 is taken
  only as that SCDC write: the lab sink has no SCDC (no HDMI Forum block), so the write is not acknowledged, 0x94 bits 7
  and 6 at once (I). A write of UPDCTRL with bit 7 sets 0x96 bit 7 at once (I: the update done). With a failed EDID read
  CapIod opens nothing (X: TRA 588 is taken, the opened word stays the TFT's).
- **VSC channel 0 (X):** latched SYNC1 `0x1000001` (progressive), SYNC2 1125, SYNC3 5, SYNC6 `44 << 16 | 2200`,
  VIDEOAREA1 `192 << 16 | 1920`, VIDEOAREA2 `41 << 16 | 1080`, HDMI1 / HDMI2 the same window, BG `0x80800b`, CTRL2
  `0x1c0`, CTRL3 1, DMAEN 0. The lab runs the channel at the firmware table's period x 1000 / vtotal = 14829 ns a line
  (`DisplayLab.hdmi_line`, the harness rule the panels follow), and `compose('hdmi')` composes it under A13 extended to
  the HDMI open's state (vsc spec 10.10): the 1920 x 1080 window at (192, 41), its background, no plane (OSDCP2
  unwritten).
- **What the HDMI picture still lacks (X, I):** the GUI draws nothing on channel 0. It learns of the new output from the
  components: CmpCst_Function takes 494 in the states its own 588 leads to (`0x50ce9cee`, `0x50cea2e7`, which builds a
  reply `0x50abff6d` and sends it, `0x50d7efe4`; I: the transaction's completion to the application). In camapp 2 the
  main thread dispatched 494 to it (`0x50ce714a`) and nothing followed (X); I: it is not in the state its own 588 would
  have left it in, since S-OUTDEV, not the component, took the 588. An experiment that handed the 588 request to
  CmpCst_Function natively in camapp 2 opened the HDMI device through the component (X), and the settle then ran out at
  S-DISPFRAME's swap wait (300,000 stub calls); not followed. Corrected 2026-11-08 (4.1.5): the counter was the
  OlyTaSS wrapper's name, and the stall a transaction waiting while DISPLAY cmd 15 waited for the VSC histogram; in
  camapp 3 the component takes 588 and opens the device, and channel 0 still has no plane. The player shows the TFT's channel, which the open closed.
- **The unplug (D, X):** the hot-plug handler turned the pin's interrupt off at the plug (`0x501d6949`; X: enable 0
  after the open), so the cable's removal reaches the driver through the transmitter: 0x92's pairs (0x9a = 0x0f once the
  cable is in, X) call `0x501d648c` ("display_hdmi_seq_hpd_intr_proc") and `0x501d64b6` ("..._rxsence_intr_proc"),
  which both defer the hot-plug handler (`0x501d64e0`, flag `0x62a3ca21`); it reads register 8, finds detect low and
  runs the disconnect send `0x501d644b` ("disconnect send.": `0x501d699b` reads UI_IN's `0x0501` as 0, connected, and
  `0x501d69c2(0)` reports `0x02020501` = 1; "skip send disconnect." otherwise), then `0x501d324e(0)`. Executed with
  A-HDMI-1's 0x92 bits 0..3: IRQ 239 alone, both callbacks, the report, no errlog; CA_MAIN and the HLS event sender
  take the event, the GUI's ConnectChangePlay does not run, no TRA 588 follows and the HDMI device stays open (why
  the application does not switch back is ?). On E146 and E147 the same plug and unplug pass (X), without S-OUTDEV.
- **Next:** the application's notification of the open (CmpCst_Function's 494 and the TRA reply, with the components
  and the swap wait), the GUI's HDMI layout (setOutputType's HDMI_SIZE_HDMI_1920X1080) and its planes on channel 0; the
  return to the TFT at an unplug; a cable in at power-on (whether the pin's type 0 is an edge or a level, ?); the
  other bodies' S-OUTDEV; CEC and DisplayPort.
- **The E118 family's outputs (D, E122):** its DISPLAY OPEN names the device by a code (1 TFT, 2 NTSC, 3 PAL, 4 HDMI,
  5 VF-2, 6 the built-in EVF, 13 VF-3, the rest HDMI modes; `docs/om1-vsc-spec.md` section 12). NTSC and PAL time the
  channel at 262 lines of 858, write the TV encoder block `0x99100000` (`0x502fe38a`) and send AUD_EXEC function 36 with
  the argument 2 on the open and function 37 on the close (`0x502f6ba0`, `0x502f6cf2`; the TV's sound, I). The lab
  opened NTSC for the EVF until 2026-10-30 (`docs/model-survey.md` finding 35); no video output is opened now.

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
- **ISC (D):** node ids 0..3 are the MN cores, 4 the A53 (4.11.1); ports 0..47; per-port owners: 1 / 2 remote live view,
  3 / 4 BSD socket API, 5 / 6 / 8 FILEISCAM, 11..16 HTTPD CGI relay, 19 / 20 Wi-Fi requests, 21 Wi-Fi events, 24 UPnP,
  25 mDNS, 26 SYS_CA53_PWR_MNG, 27 the A53 start completion, 28 / 29 BLE, 30 / 31 IMGPRO_HHHR (not wireless), 47 / 49
  shell tests. The rings are the FIFOs of the shared control block `0x97f00c00` (4.11.1); the MN library's per-node
  structures at `0xa3251704 + 0xea8 * node` are its own, layout ?.
- **Others (D):** Bluetooth classic is dead code (BTSTK, BTTIM, BTEVU, BTAPL, BT_CTRL, BTIAP, OBEX, OBEX_ACP are
  one-instruction stubs at `0x510175d7..0x510175ec`); FlashAir / iSDIO (SPC_MAIN, SPC_TIMER, 3.8k) and ICTLOG belong
  here; location comes from the phone (HTTP and BLE), the OM-1 has no GPS receiver of its own.
- **Seam:** the ISC node-4 port boundary: a JS "A53 service" answers CPU 1's ISC messages as the Linux daemons would,
  either at the ISC services (send `0x50aa369e` behind the service gate `0x50aa4c98`, 4.11.1; cheaper) or as the
  device: node 4's FIFO in the control block plus the doorbell `+0x880` and IRQ 323 (4.11.1). The A53 start
  (`0x5003bd93`) needs the ISC init on all four cores, the power / reset registers as plain storage and a reply on port
  27 (content ?).
- **Breakdown (I, after a CPU 1 core exists):** ISC protocol decode 1-2 weeks; mailbox or intercept plus the A53 boot
  handshake 1 week; the JS service for HTTP and remote shooting 2-3 weeks; RTP live view and movie stream 1-2 weeks; BLE
  1-2 weeks.
- **First step:** the transport is read from both ends (4.11.1). Next, decode the per-port payloads without running
  anything: disassemble `isc_cgi`, `isc_socket`, `isc_olnet`, `isc_file` and `blebridge` (32-bit ARM, stripped) and
  pair each port with its CPU 1 call site. **Done (D):** the per-port protocol table (message lengths and the
  sccore/hhhr/socket/cgi bodies, the port-27 start-complete `{0x01,0,0,0}`, and how each daemon behaves without a
  radio) is in `docs/a53-spec.md` §9; the A53-side ISC registers and an MN-side peer (`iscpeer.mjs`) that plays this
  half outside QEMU are in `tools/a53-oracle/`.

#### 4.11.1 The ISC transport (D unless tagged)

- **Both ends share one configuration:** the MN table `0x6034d018` and the `.data` of the A53's `iscdrv.ko` (Linux
  module, "Inter System Communication driver", author Miraxia Edge Technology, not stripped) hold the same values:
  control block `0x97f00c00`, 1024 bytes; 48 channels (ports); shared memory 128 KiB at `0x63fe0000` for nodes 0..3 and
  `0x2_a3fe0000` for node 4; hardware lock id 7. The A53 image is readable with existing tools: the squashfs at
  `blk05a00000` body `0x2f10fe0` (v4.0, xz, 11,811,224 bytes) extracts with 7-Zip, and Apple's `objdump` disassembles
  both the aarch64 module and the 32-bit ARM daemons.
- **Control block:** `+0 u16` a magic `0x1000 | (byte sum of the configuration & 0xff)`, which `isc_start` checks;
  `+2 u8` the node count; `+4 u32` the size of the pool's allocator metadata (`0x1000`; the A53 maps that much for
  `memblock_init` and accepts blocks from `+4 >> shift` on, `docs/a53-spec.md` §3); `+8` one `u16` offset per node to
  that node's receive FIFO. `iscdrv` takes node 4 as its own (after its bank loop, `isc_start` stores 4 as the own
  node).
- **FIFO (one per receiving node):** a 12-byte header `{u16 state, u16 size, u16 read, u16 write, u32 pfn}` (the pfn:
  the page frame of that node's view of the shared pool, which an `ISC_attach_mem` maps, `docs/a53-spec.md` §3), the
  data from `+12`; state `0x1000` while the owner starts, `0x2000` when running (`isc_start` refuses a FIFO already in a
  `0x3000` state). A message is a 2-byte header `{u8 port, u8 length}` and at most 128 bytes (`isc_send` refuses longer
  ones and ports >= 48), written at the write index with wrap; free space is `read - 1 - write` modulo the size. Port
  `0xff` is skipped by the receiver (`isc_receive_interrupt`). A sender holds the hardware lock for the target: on the
  MN side bit `node` of the byte `0x97000000 + 64 * id` (`bset` / `bclr`, `0x50aa31d6` / `0x50aa31ed`), on the A53 an
  exclusive byte at `isc_lock_baseaddr + 64 * id` (that this is the same byte is I).
- **Doorbells:** after a write the sender writes `0x4000` to the target's register: for node n = 0..3 to `+0x800` of
  that core's bank, for node 4 to `+0x880` of bank 0 (from the A53) or of the sender's own bank (from an MN core,
  `0x50aa324b`). The A53 maps the four banks at `0x99200000`, `0x99300000`, `0x99b00000`, `0x99b80000` (`.rodata`
  `+0x110`), the same four addresses as `0x50aa324b`'s operands. The A53-side driver (`iscdrv.ko`) and the daemons that
  sit above each port are read out in `docs/a53-spec.md` §1 and §3 (a per-daemon port map: sccore 26/27, hhhr 30/31,
  isc_socket 3/4, isc_olnet 19/20/21, isc_cgi 11..16, isc_file 5/6/8, blebridge 28/29, and so on).
- **`0x50aa4c98` is a service gate, not a message dispatcher:** it takes a service code `0x15c00001..0x15c00024` and an
  argument block and jumps through `0x60ac7510`, e.g. to `0x50aa369e`, which makes `isc_send`'s checks (node below 5
  and not its own, size + 2 below the FIFO size) and writes through `0x50aa3595`, a caller of the doorbell `0x50aa324b`
  (so the send, I). The per-port payloads above the transport are decoded in `docs/a53-spec.md` §9 (D). The A53-side
  registers (the `irqcon` doorbell at `bank0+0x880` raising A53 IRQ 14, the `0x97000000` lock, the `0x97f00c00` control
  block and its magic/FIFO contract) are decoded in `docs/a53-spec.md` §3. ISC has been brought **up live** (X): a
  patched QEMU with a small `om-isc` device backs these windows and raises A53 IRQ 14 on the MN→A53 doorbell, and
  `tools/a53-oracle/iscpeer.mjs` plays the MN half (the same encoding as `0x6034d018` / `0x50aa324b`) — the port-27
  start-complete, a port-26 kind-3 round-trip and an `hhhr` 30/31 exchange all run end to end. The shared memory is one
  backing region for both the MN (`0x63fe0000`) and A53 (`0x2_a3fe0000`) views, and the peer writes the `ISC_alloc_mem`
  memblock pool header so the A53's own `alloc`/`attach` succeed (the socket `/dev/mem` buffer alias and the CGI pool both
  depend on this); the 64-byte socket and 32-byte CGI record field layouts are decoded and paired with the MN CPU-1
  marshallers in `docs/a53-spec.md` §9.1. Since 2026-11-08 a TCP server over ports 3/4 and the CGI relay's GET and
  POST over 11/12/13/16 run end to end in the oracle too (X, §9.1, §10 item 7), and S-A53ISC (`emu/src/lab/a53isc.mjs`,
  not wired) answers those records and sccore's as the A53 does, tested against the recorded exchanges. See
  `tools/a53-oracle/README.md` and `docs/a53-spec.md` §4 phase (c).

### 4.12 Detection, GPU / C3D, strobe

- **Detection (D):** MDET_PDT_CPU3 / MDET_TRC_CPU3, FACE_MAIN / FACE_FD on CPU 3, FACE_BEAUTY on CPU 1, SDET on CPU 2,
  MDET_CALC_FLAME_VECTOR on CPU 0; devices `0x9be00000` (PDT / TRC), `0x99600000`, `0x99a00000`; IRQs 278 / 279 / 286 /
  287 attached on CPU 3 only (cores spec §1). A CPU 3 workload of its own size (about 127k with the SDET and FACE units
  filed under capture and movie); it feeds AF tracking and DISP_FRAME.
- **Detection surveyed (2026-10-25, `docs/om1-subject-spec.md`).** The network runs on a dedicated engine, DML at
  `0x9c180000` (clock 50 `CLKDML`, IRQ 285, about 970 registers, one start write), not on CPU 3's instructions (D);
  the weights are resource `0x800f` of `blk05a00000`, five items of 9,383,936 bytes (motorsport, aircraft, train,
  bird, animal), the same on E146 / E147, which add a sixth (X). `0x9be00000` is PDT (IRQ 279) and TRC (IRQ 278); the
  face engines `0x99600000` / `0x99a00000` exist on E143 only. TAKE drives MDET through `0x5080a5e2..0x5080ab02`;
  results go to FCS's AF points and to DISP_FRAME (UP_FACE). The seams and a plan (a display-level S-SUBJECT first)
  are in that spec's sections 4.4 and 5.
- **Subject frames on the display (2026-10-27, spec 5.1; S-SUBJECT, `emu/src/lab/subject.mjs`).** MDET's frame table
  is read (D): main and part records (filled only in MDET's state `0xa337f082 = 1`, ?), a count and up to eight list
  records at `0xa337efa1..`, each four corners; DISP_FRAME's draw_face takes them through FACE's `0x5052202c` and MDET's
  getter `0x5083a299` when the getter's aspect code matches its own and the frame mode has bit 1, and maps them through
  a per-output, per-aspect transform (`0x60365754`). The setting is settings id 1682 (object `0x1e71`, MDET's kind,
  D). S-SUBJECT writes S-SCENE's subjects of the setting's kind as list records and posts UP_FACE; DISP_FRAME draws
  them natively on the TFT and the EVF, following the scene's rider (X). UP_LOCKON (tracking) is the AF module's
  request (D) and stays with step B; nothing is retired. Open: U9, U10 of the spec.
- **MDET_DL natively with S-DML (2026-11-07, spec 5.3; `emu/src/lab/mdet.mjs`, `emu/src/dev/dml.mjs`).** With the
  setting at a kind, S-TAKEMDET makes TAKE's start, change of kind and end and take_mov's per-frame offer natively;
  S-CPU3 serves MDET's post to CPU 3 at once and S-MDETDL runs MDET_DL_REQ's and MDET_DL_LDL's turns on the lab CPU,
  with CPU 3's flags 0x3003..0x3006 kept by the lab; dml_start programs S-DML (a register file at `0x9c180000`), whose
  completion IRQ 285 reaches dml_start_callback; MDET's post-processing, its subject records and LAF run natively (X:
  at kinds 1..5, no firmware error log). The learning data's copy is answered without copying (S-LEARNDATA). S-DML
  writes S-SCENE's subjects of the kind as the engine's records (spec 5.4): MDET's stabilisation reports the rider from
  the seventh run (sbj_kind 6, its box) and LAF fills the frame table's inputs natively with the same box. Since spec
  5.5 LAF's own writer (`0x5083a761`) fills the table, LAF derives the getter's aspect pair from the offer's aspect code
  and MDET posts UP_FACE, and DISP_FRAME draws that table (X): S-SUBJECT writes nothing on E143, and only the frame
  mode's subject bit (TAKE's request 1) is the lab's, S-TAKEFRAME's. Spec 5.6: S-DML writes every subject and its
  parts (S-SCENE's race preset: two motorcycles with their helmets); MDET's combination pairs each helmet with its own
  body (judge_comb: overlap, then the nearest centre and size) and LAF writes a list record per body, so DISP_FRAME
  draws two frames (X). The main and part records (U9) are set by LAF's frame trace on MDET_CALC_MAIN_CPU3 for a
  subject that overlaps the AF library's area: neither runs in the lab (D, X). Spec 5.7 (2026-11-08): S-TAKEMDET
  registers TAKE's LAF status-change callback as TAKE's start does (without it the status callback made a deferred
  call of address 0, the trap of 5.6); H-FCSAF runs three steps of the AF library's init natively, so LAF's AF area is
  the camera's AF target (the centre 3 x 3 points by default) and a subject under it becomes LAF's candidate with its
  tracking status (X); S-MDETDL runs MDET_E_SEND_CPU3 and MDET_CALC_MAIN_CPU3 when S-CPU3 serves one of LAF's event
  setters (X, through TAKE_MOV's mdet_laf_start in the test). The end-frame event that sets the main and part records
  comes only from LAF's chase cycle (take_mov's chase requests, EMS1 / EMS2, the PDT / TRC unit), which the lab does
  not run. Spec 5.8 (2026-11-08): the cycle is read: take_mov asks once per live-view frame while its LAF mode is on,
  after its own EMS1 run on CPU 0, and its first request carries LAF's parameters (TAKE's builder over TAKE_MOV's EMS1
  state); on CPU 3 TRC's colour tracking is the cycle's one engine ("EMS2" names that step), PDT serves the AF
  library's IP information. S-PDT (`emu/src/dev/pdt.mjs`) models the unit's register file at `0x9be00000` with IRQs
  279 / 278 on CPU 3; H-MDETINIT runs the boot chain's MDET queue init and the PDT and TRC drivers' inits natively;
  S-MDETDL runs MDET_PDT_CPU3 and MDET_TRC_CPU3 with the core register at 3 and CPU 3's deferred calls after their
  turns, so LAF's start opens both drivers natively (X), and the firmware's drivers run on S-PDT (X). Not reached: LAF's
  start with take_mov's parameters and the chase requests, which need TAKE_MOV's EMS1 state and run (D). Spec 5.9
  (2026-11-08): take_mov's LAF mode bits are TAKE's tracking sources (the AF library's tracking, FACE's, LAF's own
  tracking status), handed over at TAKE's live-view start and after TAKE's message 81 (D); served in a test, that
  message starts and ends LAF's PDT / TRC side natively (X; a session leaves it in TAKE's queue, since LAF started
  without chase requests writes no frame table, X). EMS1 (`0x9bd80000`, IRQ 276, CPU 0) is the front end's five-area
  motion and statistics engine: S-EMS1 (`emu/src/dev/ems1.mjs`) models its register file and the firmware's driver
  runs on it (X). The cycle stops at TAKE_MOV's frame events, which the image pipeline's live-view sequencer
  delivers through the callback TAKE_MOV's live-view start `0x506d9d6a` registers (D; spec U12).
- **The frame plane after a display switch (2026-11-08, `docs/om1-vsc-spec.md` section 9 items 11 and 12).** The face
  layer's one requester, OlyHfwOpeBGrCtl's AF display setter `0x50ae7b04`, posts DISPLAY cmd 18 only when api_disp's
  stored layer for the logical display changes (D); the GUI re-sends its cached mode on 131, and the lab's switch leaves
  the GUI at panel 10 throughout, so nothing is posted and the new output's frame-state byte, which every OPEN sets to 1,
  stays 1 (X). The face plane a later GUI transition sets up (MENU in and out) reads PLANC `0x1100`, the format setter's
  per-pixel alpha bit with the level the switch's cmd 28 left at 128 (D, X); A19 draws it as `0x1000`. What posts the
  face request on the camera after a switch is not read (the application's own switch, BGrCtl's drawing or the through
  image's display requests, I). The EVF menu's PLANC `0xb2` is BGrCtl's DISPLAY cmd 30 mode 2, OSD1-3 at level 89 (D,
  X); its blend needs hardware (A7).
- **GPU and C3D (D):** one stack seen from both ends: C3D (gap@0x5101aef5) makes 108 call edges into the DMP "K3000"
  GPU driver core (gap@0x51767cd6), plus a 15.6k GPU tail of gap@0x51740e22. Tasks: C3D_EXE_BRIDGE and C3D on CPU 0,
  C3D_EXE and C3D_UPDATE on CPU 1. Devices `0x9bc80000` (30 references) and `0x9bd00000` (10) are referenced only from
  C3D; the GPU driver has no MMIO constant, so its base is computed or in a table (I). Callers: DISPLAY `0x501c2c74` and
  `api_play.c`.
- **The feature that drives C3D (E147, X/D, 2026-11-02):** the colour-profile editor's wheel — the 12-sector colour
  wheel and the value polygon that plots the twelve hue/saturation values. That screen configures the only 32 bpp ARGB
  layer of the display: VSC channel 2 (TFT) IMG2, `PLANC` 0x1100 (0x100 = the plane fully applied, plus bit 12, which
  the format setter sets for the per-pixel-alpha formats), `IMG2FMT` 3, `IMG2DMASADR` `0x0ab0b2e0`
  (buffer `0xab0b2e00`), 900x600, stride 3712, `AREA1` `0x00620384` / `AREA2` `0x00080258`; the image carries the renderer
  that can fill it, EGL/DMP's OpenVG (`K3000`, `EGL_DMP_platform_dmpnative`, `vgCreatePathDataDMP`,
  `vgDrawPathDataDMP`, `vgDrawPathDataArraysDMP`, `VG_DMP_path_native_format_direct_load` at 0x617e...), the GUI's
  `fwOpe::drawC3dAsync` / `CGuiDrawCtrl::drawC3dAsync` / `CBS_DRAW_C3D_ASYNC`, C3D's `C3D_CMD_START/UPDATE/END` and
  `c3d_exe_bridge_disp_init`, and FIRMUP's `TYPE_C3D` (the camera also updates the GPU's firmware). The drawing itself is
  not traced: in the lab the whole stack is dormant (0x61300000..0x61b00000 executes 45 instructions from boot to that
  screen, none of them a draw) and the layer stays all-zero, so this feature is X, and the OM-3 wheel is the concrete
  target that would justify a K3000 model. The format is the documented one: the IMG format setter `0x501e1e95`
  names format 3 `R8G8B8a8` (`docs/om1-vsc-spec.md`), and the model draws IMG planes only at format 0.
- **Strobe (X, D):** 562 instructions run natively: the charge request `0x501af586`, `stb_external.c` `0x501ba32f` /
  `0x501ba47b`, the light exec `0x501c243b`, the register driver `0x501b3883`. Tasks STB_CHARGE 0x23 `0x501af7eb`,
  STB_EXTERNAL 0x65, STB_SEQ 0x66, STB_HANDLER_PROC 0x8b; `cam_strobe.c`, `stb_ext_microphone.c` (an accessory
  microphone through the hot-shoe code, I). The device `0x9b800000` has 71 references in the strobe code gap@0x501b385b;
  its role is ? (section 10). It is the uncovered block a user reaches in normal shooting.

## 5. Cross-cutting prerequisites

| Prerequisite | Blocks that need it | State today | Evidence |
|---|---|---|---|
| Interrupt acceptance at any instruction boundary, native delivery (F03, F27) | every device seam: SD (225-232), lens (14, 60), sensor (15-42, 243-247), SCPU (321), ISC (323); not HDMI's IRQs 109 and 239 or SCPU's 320, which their waiters take at the idle point (4.7.2, 4.9, X) | idle point only (H-IRQGATE) | ROADMAP phase 3; X: accepting anywhere moved 21 of 30 acceptances with identical output |
| A machine-owned time model, time mode by default (F06, F26) | sensor VD cadence, LENS_SYNC up to 240 fps, the lens command times, the SCPU clock, the accelerometer sampler, SD and DDC timeouts, cross-core timed waits | opt-in time mode; ticks lost inside display steps | ROADMAP phase 4, M9 follow-ups |
| More CPUs (per-core state, `0x8000` page, INTC banks, kicks, ticks) | live view, capture, movie, audio, AF, detection, wireless, histogram | CPU 0 only | 4.6 |
| Task starts and module inits from the boot chain (USTART2..5; init chains such as `0x503dae30`, `0x501ea63c..0x501ea78f`, EYEFI's) | every block | entries refused by the kernel lab's guard; inits skipped (of `0x503dae30` the property store's init runs, H-STOREINIT) | every block's footprint (section 4) |
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
   default (4-6 days); the SCPU port registers and IRQ 320 for group-0 keys and the power lever (3-5 days; both in
   since 2026-10-23, 4.7.1 and 4.7.2, S-NVRAM the players' default since 2026-11-08 and the power-off sequence
   open); the
   accelerometer (Level Adjust and the level gauge, in since 2026-10-23 at the sample cache, 4.7.3); HDMI EDID / HPD (in since 2026-10-23 behind `--hdmi on`, 4.9: its interrupts are
   taken at the idle point, so it was no test case for step 3 after all). They retire named stand-ins and fix visible
   defects: the frozen clock, lost settings, a GUI hang, the abandoned HDMI open.
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
   Formatting. Capture, movie, playback, USB and wireless all write or read through it. Started on E143 (2026-10-23,
   4.8.2) one layer lower, at the SD command layer, without steps 3 and 5: the command layer completes at once, and the
   four tasks the file system needs are started by name.
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

The shutter's sound is the mechanism's, not the firmware's (I): until the block runs, S-SHUTTERSND synthesizes an open
and a close click at S-RELSEQ's START_EXPOSE and END_EXPOSE (`docs/om1-shutter-spec.md` section 7 item 61,
`emu/FIDELITY-NOTES.md` 7.12); their timing within the exposure is the lab's choice.

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
20. **SCPU commands do not use the `0x98e00000` window** (D, 4.7.1): PER_SCPU frames them on PER_SIO channel 2 between
    pins 103 and 102. `0x07` is the SCPU firmware update's command, not a port scan; the port state comes as the reply
    to `0x88` and as the SCPU's own message `0x08` (both its port scan's PC13, scpu spec 3.4). None of the 19 call
    sites of the request API sends `0x05`.
    PER_SCPU's 100 timer is its start watchdog.
21. **`0x50aa4c98` is the ISC service gate** (D, 4.11.1), not a per-port dispatcher: intercepting it answers service
    calls (send, receive, memory), not messages. The ring layout is the control block's FIFOs at `0x97f00c00`, read from
    both ends. Applied to 4.11's seam.
22. **The lens init steps' "parsers" are predicates** (D, 4.4.1) on the lens record that earlier replies filled; the
    one step that writes the record from a table is `0x502b0bce` (known lens ids). `+0x08` of the lens serial controller
    is W1C (D: the IRQ 14 handler writes back what it read).
23. **HDMI's hot plug comes over a GIO pin, and its DDC wait is a task's** (D, X, 4.9): pin 77's interrupt (IRQ 109,
    the GIO group handler) starts the hot-plug work, which attaches IRQ 239 only then; the EDID read waits in task 16
    (E146, E147: an HDMI task), not in DISPLAY, so the interrupt is taken at the idle point and S-IRQFIRST is not
    needed. The GIO init that frees the pins' interrupt slots does not run in the lab, so both pin registrations a lab
    session makes, HDMI's and the touch panel's, were refused without a word (X: the coverage of the GIO mode function,
    and IRQ 132 attached for the touch panel once the slots are free); H-GIOSLOTS runs the slot reset with `--hdmi on`
    only.
24. **The E118 family's display sync holds the GUI's updates for the through image** (D, X, 2026-10-30;
    `docs/model-survey.md` findings 38 to 40): E122's GUI commits its OSD planes through a display sync module of its
    own (`api_disp_Disp_Update_Osd` `0x502c9c6c` -> manager blocks `0xa18a37f4 + 56 n`), whose synced type 3, sent while
    the application's sync word is set, waits for an image request the lab's missing through image would make; S-DISPSYNC
    releases it with the image sync of kind 0 (`0x502c9f95`, the release kind of this form, read by `displaySync`).
    The kind-3 VSC's planes take the GUI's layers in reverse (OSD1 layer 0, OSD3 layer 2) with their palettes, the
    128-entry banks by bit 4 of `0x1b8`. The touch task's queue takes asynchronous sends from the display opens, which
    its one slot holds, and from the application, which S-TPSEND serves while the lab runs no touch task (E122's panel
    is not modelled). E118 and E120 (findings 48 and 49, 2026-10-30) have another display sync module, a state byte
    per device (`0x5046b691`; E120's force path `0x5044737e`), whose asynchronous OSD update waits in state 2 for the
    same release (code 18, kind 0); E118's image sync is named by its trace only, E120's API takes records
    (`api_disp_Disp_Sync_Update_Osd_Multi_Ext`, `api_disp_Disp_Sync_Force_Update_Multi_Ext`), both read by
    `displaySync`. E118's code names no OSD level word (`vscLevels`), and its planes are drawn at the full level (?).

## 10. Open questions

The block-level unknowns are in section 4 and the shutter's in 7.5. Across blocks:

1. How a module's replies and callbacks reach the capabilities' observers (the HLS executor's token routing, 4.1.3),
   and why TRA 990 went unanswered in shutter spec item 43's native run although the shooting component answers it
   (4.1.2). Who handles TRA 991 and what answers TRA 990 is settled (section 9 item 19).
2. The DCF folder name: the capture code's strings name `100OLYMP` (body `0x6035ce`), the DCF layer's own strings
   (`0x9ed..0x9f8`) use `100OMSYS`; both exist (D, body `0x6035c5` / `0x6035ce` / `0x6035e9` and `0x9ef1c0` /
   `0x9f3226` / `0x9f8668`). REC's own DCF open writes `xxxOMSYS` (its immediates `0x5054a903..0x5054a913`, D), and
   the native REC_FILE run makes `100OMSYS` (X, 4.8.10); what the `100OLYMP` string is for is not read.
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
