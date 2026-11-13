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
  natively against a device model (4.4.2, 4.4.3). Behind options that are off by default more runs (X): with
  `--take probe` TAKE_FUNC, TAKE_MAIN and the neighbours TAKE_EXPOSE, TAKE_POWER_MANAGER, TAKE_FOCUS and the strobe
  over an empty hot shoe (4.1.4, 4.1.6-4.1.8, 4.12.1); with `--cpu2 native` CPU 2 and its queue tasks (4.6.1, 4.6.2);
  with `control camapp 3` the HLS transactions, the VSC histogram and the imgpro unit `0x9c600000` (4.1.5, 4.2.1,
  4.3.1), with its play opt-in the play module (4.8.11); with the probe's `cam_fe` cam.c's second init (4.2.5).
  Since 2026-11-11 (X): camapp 3's half-press shots end in STANDBY past phase 111 and a full shot waits in phase 106
  for TAKE's capture (S-TAKERDY, 4.1.12); the histogram unit's bins are counted (4.2.7); the play opt-in's view is
  decoded on the image library's pipeline block (S-IMGPIPE, 4.8.13); cam.c's request 6, the sensor's power-on, runs
  under `cam_fe` as far as SSG1's command unit when a test makes it (S-TAKECAM keeps it in sessions, 4.2.6).
- **In code:** the lab executes 287,101 of the main block's 5,186,071 instructions (5.54%), about 6.1% of the code a
  camera runs in normal use (section 2.2). The largest unrun blocks are playback (613k instructions), AF / lens / IS
  (505k), still capture (421k), the AV codec back end (411k), the sensor / ISP / live view (321k) and the TAKE module
  with the HLS shooting sequence (301k).
- **Three gaps block almost everything:** no native TAKE module, so no firmware code below the HLS ever asks for focus,
  exposure, capture or a movie; only CPU 0 runs by default; interrupts are accepted only at the idle point and there
  is no machine-owned time model. Closing them is the precondition for every device seam below.
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
| **EXP exposure module** (inside the sensor block, 4.2) | S: only the plan `take_expose_calculate` `0x50597e82` runs, under S-EXPOSE and H-AEINIT, and natively at a mode change (4.2.2) | native, fed by seam B's statistics | seam B, the TAKE_EXPOSE and EXP_MOVIE tasks | about 107k (EXP 96k plus TAKE_EXPOSE 13.6k), one MMIO reference: device-free | part of seam B (3-5 weeks) | continuous metering, AE / AF BV, flicker detection, face and spot AE |
| **Still capture, image processing, recording** (4.3) | S: S-RELSEQ, S-RECVIEW, S-CARD, S-TAKEFRAME; X: S2 posts no module request | C1 DRAM capture, C2 the imgpro_mdl API, C3 CIC, C4 storage (shared with 4.8), C5 the CPU 2 halves | TAKE, the sensor (C1), CPU 2, storage, the A53 for Handheld High Res (I) | 429,869 / 421,668, of which the imgpro library about 275k behind about 10 imgpro_mdl entries | 6-9 weeks | S2 writes a real JPEG / ORF with the firmware's EXIF and DCF name; the rec view shows the firmware's view image |
| **AF and lens** (4.4) | S: S-LENS (record values I) on the other bodies and selectable on E143, where the lens runs natively down to its serial controller by default (S-LENSMCU, 4.4.2); S-RELSEQ's END_FOCUS, S-AFOSD's fixed frame; X: no request reaches FCS, BC or TAKE_EXEC | lens: the serial device `0x9b980000` (IRQ 14) and the edge unit `0x9b883e40` (IRQ 60); AF: the module seam TAKE_FOCUS `0x5d` / FCS_EXEC `0x1b` | TakeReady (TAKE), task starts and the lens inits, sensor VD for LENS_SYNC, CPU 1 (FCS_IP, flag 0x92) and CPU 3 (MDET) for native FCS, IRQs anywhere, time | 510,058 / 504,680 with IS: FCS 372k (about 100k CPU-1-only), lens about 84k | lens 2-3 weeks; AF 2-3 weeks once TakeReady runs; native FCS months | the lens identified by the firmware, zoom and MF, the firmware's AF decision and frames |
| **Body IS (BC)** (4.4) | 0: no BC, no gyro, no IS state | the module seam BC_EXEC `0x09`; BC native only with a capture of the IS link | TAKE (TAKE_FUNC sends to BC_EXEC), the IS controller's serial channel (?) | 34-42k / about 34k (inside AF / lens / IS) | about 1 week at BC_EXEC | IS mode and indicator, IS EXIF |
| **Subject detection** (4.12) | S: MDET_DL native with S-DML at single call sites since 2026-11-07, the scene's subjects and their parts as the engine's records, the frames drawn from MDET's own table (step C parts 1 to 3, several subjects and parts); the frame mode's subject bit S-TAKEFRAME's; S-SUBJECT's frames (step A) only on a body without MDET_DL | surveyed 2026-10-25 (`docs/om1-subject-spec.md`): S1 DISP_FRAME's inputs (MDET's frame table and UP_FACE), S2 MDET's results to FCS, S3 the DML engine `0x9c180000` (IRQ 285) | CPU 3, the DML, PDT / TRC and face engines, the `0x800f` model load, take_mov's YC frames, native FCS for S2 | 84,500 / 81,771 keyed; about 127k with the SDET and FACE units | S1 about 1 week; S3 4-6 weeks after CPU 3; a reproduced network months | subject and face frames, C-AF tracking |
| **Movie and audio** (4.5) | S: S-RELSEQ's movie callbacks, S-CARD's movie time, S-CPU2's zero level snapshot, S-MODACK for AUD_EXEC with `--audio off`; N with the audio hardware (`--audio auto`, the default on E143): AUD_MAIN and AUD_EXEC, the audio port's TX, IRQ 43 / 45, S-WM8946, UI_OUT and the AF beep's request from the GUI (S-AFLOCK), its sound from S-SOUNDRES's lab-made area (4.5) | S3 TAKE_FUNC commands 30 / 31 / 68 / 69, S4 the mvr IF (CPU 2), S5 AUD_LEVEL_MONITOR, S6 a host AVM writing a MOV through the firmware's DFS calls, S7 AUD_EXEC | TAKE (commands 30 / 31 / 68 / 69 wait on CPU 2's MOV_COMMAND, SDET_EXEC and WB_MOV, 4.1.1), CPU 2 (MVR, audio level), sensor, storage, EXP_MOVIE / FCS_MOVIE | 134,137 / 124,319 | 10-15 weeks (stages A-C) | a playable .MOV on the card, the firmware's recording sequence, audio meters; the AF beep plays since 2026-11-02 (the lab's sound, not the camera's) |
| **AV codec back end** (4.5) | 0 | none for HLE: seam S6 bypasses it | CPU 1; the codec engines; IRQs 303-306 | 416,471 / 411,438 (overlay segment 8, CPU 1) | ?: native needs register-level codec models, no documentation | native movie encode and playback below the HLS (I) |
| **CPUs 1-3 and inter-core** (4.6) | S: K-OTHERCPU, K-BOOTSYNC, K-IPI, no start barrier; S-CPU2 (one post), S-CPU3, S-DISPFRAME on CPU 0; any other doorbell is an error | run CPUs 1-3 natively on one bus; per-core `0x8000` page, INTC bank n to core n, `+0x808/+0x80c` IRQ 324, `+0x810/+0x814` IRQ 325, `+0x800/+0x804` ISC IRQ 323, ticks 139..141. A53: "off" or ISC node 4 | a machine refactor (per-core CPU state), a per-core kernel lab, flash reads for CPU 2's loader and CPU 3's boot jobs, ROADMAP phases 3-4 | 5,422 keyed; 441,542 reachable only from CPU 1-3 tasks (a lower bound) | 5-7 weeks for the cores | the histogram, a native DISP_FRAME, cross-core owners (AUD_MAIN, AVM) can start; three stand-ins and four kernel stand-ins retire |
| **SCPU, power, clock, on-board sensors, persistence** (4.7) | N: PER_SCPU, its start and its transactions, over the link to S-SCPUDEV, the sub-CPU's transport-level model (since 2026-10-23: `0x85`, `0x01`, `0x81`, `0x06`, `0x86`; 4.7.1; S-SIO2, H-SCPUSTART); S: the SCPU window's storage (`0x00`, `0x08..0x3c`), command word and its clock `0xe8 / 0xec` ticking with lab time; group 0 through the event and port words and IRQ 320 natively (since 2026-10-23, 4.7.2; H-SCPUIRQ, H-UIINPORT, H-SCPUPORT), H-POWER, H-EYESTATE, S-SETSAVE / S-NVRAM (the players' default since 2026-11-08); N: the ACC module init, ACC_MAIN, PER_SLOPE, the level gauge and Level Adjust with the accelerometer at its sample cache (since 2026-10-23, 4.7.3; H-ACCINIT, S-ACCREG, S-ACCSAMPLE, H-SLOPEINIT); PER_ROTATE with `--rotate on` (since 2026-11-08, 4.7.3; H-ROTINIT) | the accelerometer at the PER_SIO transfer and its data-ready pin (ACC_SENS_MAIN native); PER_ROTATE by default; S-NVRAM's NAND seam as the default | lab time; the UI_IN, SCPU and PER_SIO inits, the GIO init for the data-ready pin; CPU 3 for the store's boot load in a native boot | 64,446 / 56,954 | 4-5 weeks (steps 1-4), 7-9 with the power manager and NAND | a running clock, persistence by default, native power lever and power-down, rotation by default, eye sensor (Level Adjust, the level gauge and, with `--rotate on`, the orientation and the gauge's portrait layout in, 4.7.3) |
| **Card and file system** (4.8) | N on E143 since 2026-10-23 (4.8.2): the file system's bring-up, FILECLBK, FILEFGND, DCFPROC_SUB, sd_mount, sdmem, the format, dosfat, DCF and the shots / movie-time counts natively on an 8 GiB SDHC card at the SD command layer (S-SDCARD, S-SDHOST, S-FSNAND, S-ALBM, H-FILEINIT, H-FILECLBK); the picture's file at S2 through the file module (S-RECFILE; since 2026-11-08 REC_FILE's task natively from REC_IMAGE's packet with the firmware's own header on E143, E146 and E147, 4.8.10: H-RECFILE, S-RECIMAGE, S-EXIFPRM, S-JPEGENC; on E143 since 2026-11-10 REC_IMAGE's own task, 4.3.3: H-RECIMAGE, S-RECREQ in S-RECIMAGE's place, S-JPEGENC the encode only; on E146 and E147 too since the same day, 4.3.5; S-JPEGENC the run and Jpeg_Result on the three since 2026-11-11, 4.3.9); since 2026-10-24 (4.8.3) Card Formatting from the menu (S-MDACTRL) and the card's removal and insertion (S-MEDIA), the application's media control native; S: S-CARD's insertion requests, its HLS mount state and image list; every other body now runs the same file system (4.8.4, 4.8.8; `emu/src/fw/models.mjs` card_fs), the HLS side on E146 (4.8.7) and on the E118 family (S-MDAEND, `docs/model-survey.md` findings 124 to 129), since 2026-11-11 on E147, E148 and eight E144-family bodies (findings 149 to 152); two slots on E143 and E146, the second empty by default (2026-11-11, 4.8.12) | the SD host's registers and interrupts with a card model (seam A), the rule-found seam on the other bodies, REC_IMAGE and the image pipeline (the thumbnail, the shooting values in Exif) | the HLS media layer (which sends the insertion), REC_MAIN / REC_FILE (the picture's file), TAKE_MOV's movie take (the movie module's set-up, whose frame rate the movie time query reads: 0 before a take on the camera too), IRQs anywhere for the SD host | 115,103 / 108,887 (17k of it self-test and debug) | 1-2 weeks left: REC_FILE's DCF steps, both slots, exFAT, the other bodies | a card that fills, real files in DCIM, both slots |
| **Playback** (4.8) | S: S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW; on E143 under `control camapp 3` behind an opt-in the play module's tasks natively, its view decoded on the model of the image library's pipeline block and JPEG codec, a pre-reduced one stood in (H-PLAYSTART, S-IMGPIPE, S-PLAYDEC, A-JPEGDHT-1; since 2026-11-10, 4.8.11, 4.8.13); since 2026-11-11 Delete's eraseCurrent by the firmware's own attribute and object delete (H-OBJDEL, `docs/model-survey.md` findings 137 to 140) on the bodies of `emu/test/test_erase.mjs` ERASE_NATIVE | with the S-PLAY* stand-ins kept: a JPEG decoder at the codec seam; native: the HLS play components, PLAY_* / MOVP / MOVE, the AV back end for movies, CIC for RAW | storage, imgpro C2, CIC `0x9be80000`, the AV back end | 684,201 / 612,936 (HLS components 310k, GUI 80k+, segment-9 PLAY_* / MOVP / MOVE 113k): the largest block | 2-4 weeks on top of storage with S-PLAY* kept; native: a block of its own (?) | playback of real files, index, zoom, histogram, erase, protect |
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
  `0x50417cd9`, which neither camapp mode reaches (camapp 1 and 2; camapp 3 reaches it after a menu pass, 4.3.2, and
  with the probe, 4.1.7, 4.1.10).
- **Seam:** TAKE native, its neighbours answered at their own seams. Inside the step: lens at its serial seam (or
  LENS_EXEC answered) and BC_EXEC answered; the sensor control plane far enough for TAKE's through start (TAKE_FUNC
  command 25, 4.1.1); the shutter at its control plane; the strobe can be planned beside the shutter.
- **First step:** the static decodes are done (4.1.1-4.1.3). Next, make the HLS component bring-up (`control camapp
  2`) the default of the coverage workload, so the HLS half of TAKE is measured before TAKE itself is attempted
  (tried 2026-11-08, 4.1.5: with the transactions native the components answer them; since 2026-11-09 the menu and
  playback pass udf07 and the imgpro unit `0x9c600000`, and the next stops and what keeps the default at camapp 1 are
  in 4.3.1); then a
  probe that runs TAKE_FUNC and TAKE_FUNC_CP natively with a recording stand-in on each queue they send to (4.1.1's
  table), which gives the order and contents of their requests for a start, a through switch and a movie. The probe
  runs since 2026-11-08 (4.1.4): the start's and a mode change's requests are recorded; the through switch and the
  movie do not reach TAKE_FUNC in the lab, and neither do S1 and S2.
  Under camapp 3 with the probe S1's take request reaches TAKE_MAIN natively since 2026-11-09 (X, 4.1.7); with
  TAKE_FOCUS native too (H-TAKEFOCUS) it goes on to RdyFcsRdy3 and stops at TAKE_EXPOSE's request to EXP_MOVIE (X,
  4.1.8). The strobe answers the start natively over an empty hot shoe (H-STBINIT, S-HOTSHOE, H-SIOMAP; X, 4.12.1).

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
runs a CPU 2 reader without `--cpu2 native`, so a native TAKE_FUNC would wait for ever at the first of these sends (I);
with it the readers run and wait on their queues, and no lab session reaches these sends (X, 4.6.2). The meaning of the
TAKE_EXPOSE command words (`0xc0n`, `0x200`) and of the mvr IF helpers' kinds is ? (TAKE_FOCUS's `0xa0n` are its
MOVIE_* commands, 4.1.8); whether TAKE_MOV (flag 0x95) is woken from commands 30 / 31 is ?.

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
  not run: request 148's handler `0x502a4b74` found its pool `0x6299726c` empty and logged `0x0a103000`, X;
  corrected in 4.2.3: the pool was not built, its base word 0, where "empty" is a head of `0xffff`, D, X; and the
  first init runs as H-CAMINIT since 2026-11-10), S-TAKEUSF
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
| | | STB_EXTERNAL command 1, token 4, after a 10 ms sleep (`0x502cda87`; `0x502cdc33` from `0x502cda92`) | token 4 on 0x61 | S-TAKEREQ: `{0, 4, 0}` (STB_EXTERNAL's own since 4.12.1) |
| | | the dust filter's gate on, record `{0x502cdc97, 0}` (`0x502cdb34`, once BC's and the lens's tokens are in, `0x502cdb07..0x502cdb34`) | flag TAKE_FUNC_CP bit 1 (`0x506d99ed`, the count `0x62a3f3c0` from `0x502cdc5d`) | S-TAKEUSF: `0x502cdc97(0, record)`, whose deferred call counts down to the flag |
| | | STB_EXTERNAL command 4, token 8 (`0x502cdc33` from `0x502cdb67`) | token 8 on 0x61 | S-TAKEREQ: `{0, 8, 0}` (STB_EXTERNAL's own since 4.12.1) |
| | | the reply to the application: status 0 to queue 6, token `0xf0010000` (return `0x502cd75d`) | | (native) |
| 3 | TAKE_FUNC command 13 (sync, the application's reply queue `0x102`) | TAKE_EXPOSE command 0, synchronously (`0x506d9854`, return `0x506d7f32`) | its u16 status on 0xa7 | S-TAKEREQ: status 0 (TAKE_EXPOSE's own since 4.1.6) |
| 4 | TAKE_FUNC command 18 (sync) | TAKE_FOCUS command 0, no reply queue (`0x506ea965` from `0x506eab52`; synchronous once TAKE_FOCUS's inits run, 4.1.8) | nothing | none (since 4.1.8 TAKE_FOCUS's reply) |
| 5 | (camapp 2) TAKE_FUNC command 29 (sync, parameter `0x62a6b6d4`) | nothing | | |
| 6 | (camapp 2) TAKE_FUNC command 22 (sync) | TAKE_FOCUS command 2, synchronously (return `0x5039abbb`) | status on 0xa7 | S-TAKEREQ: status 0 (TAKE_FOCUS's own since 4.1.8) |

Each synchronous command ends with TAKE_FUNC's reply to the requester's queue (status 0). Of the requests 4.1.1's table
lists for 13 and 18, the start made only these (X): 13 no TAKE_EXPOSE `0x200`, 18 no TAKE_FOCUS command 2 (its command
0 is `0x506eab1f`'s; command 2 came from 22's handler). TAKE_POWER_MANAGER_EXEC is not
asked: the start's branch `0x502cd84c..0x502cd881` skips its two messages (X; which of its three conditions, the byte
`0x62a3f2bc` or the settings 61633 and 7729, is not traced). LENS_EXEC's command 1 comes after H-LENSON's (4.4.2) and
LENS_MAIN takes it natively (X). With the probe the warning `0x39000903` (`0x504494ed`, a frame-rate code conversion),
logged about 12 times a second on the idle shooting screen under S-MODACK, was not logged in this round's runs (X); the
probe as it stands since 2026-11-09 logs it (X: 4.12.1's and 4.1.8's runs, with and without their tasks native; which
change brought it back is not read).

**The other scenarios (X, both camapp modes):**
- **A mode change** (the dial P -> A, and A -> P, and to Movie): TAKE_FUNC command 22 three times, each TAKE_FOCUS
  command 2 synchronously (`0x5039abbb`), S-TAKEREQ's status 0 (TAKE_FOCUS's own since 4.1.8); under camapp 2 the
  change to Movie also command 29 three times, which asks nothing.
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
  start's (corrected in 4.3.11: the divisor is IMG_PRECON's white-balance table, which neither start builds; with
  IMG_PRECON's init the set runs, X). No end-to-end improvement (TAKE's frame mode in place of S-TAKEFRAME, its EXIF set in place of S-EXIFPRM)
  is possible from this probe without inventing a request.

**Each neighbour's reply (classification: (a) a native module the lab can start; (b) a modelled device or CPU 2; (c)
unknown):**

| Neighbour | Asked by | What TAKE needs back | Class |
|---|---|---|---|
| LENS_EXEC (LENS_MAIN) | CP 0 | `{status, token 1}` on 0x61 | (a), native since 2026-10-28 and answering in the probe (X) |
| TAKE_EXPOSE (task 0x67, `0x5059145d`) | 13 | the status of command 0 | (a), native since 2026-11-09 (H-TAKENBINIT): its command 0 asks nothing and it replies itself (X, 4.1.6) |
| TAKE_POWER_MANAGER_EXEC (task 0x83) | CP 0 when its branch runs | `{status, token 512 / 1024}` on 0x61 | (a), native since 2026-11-09 and not asked: every sender in TAKE_FUNC and TAKE_FUNC_CP waits for TAKE's start-up flag, which the lab never sets (X, D, 4.1.6); its own request goes to CPU 1 (b). Under camapp 3 the start's command 29 from `0x503a05fb` sets the flag and asks it command 0 twice, which it answers natively (X, 4.1.7 "Also seen", 4.1.11) |
| TAKE_FOCUS (task 0x68, `0x509a0ebe`) | 18, 22 | the status of command 2 | (a), native since 2026-11-09 (H-TAKEFOCUS): it answers commands 0 and 2 itself, status 0 (X, 4.1.8); its AF over FCS (FCS_EXEC, FCS_IP on CPU 1) stays (c) |
| STB_EXTERNAL (the strobe module) | CP 0 | `{status, token 4}`, `{status, token 8}` on 0x61 | (b): task 0x65 (`0x501b7465`) answers command 1 once a transfer on PER_SIO channel 11 ends or its 13 s wait for it runs out, then a 64 ms timer, flash or no flash (D, X); run natively in the lab it answers only through that timeout, 13.1 s after the request, as PER_SIO's controller is not modelled (X, 4.1.6); native since 2026-11-09 over channel 11 with nothing on the shoe (H-STBINIT, S-HOTSHOE), 85.4 ms after the request (X, 4.12.1) |
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
   TAKE_FOCUS's AF; round 2 (X, 4.1.8) runs TAKE_FOCUS and stops at TAKE_EXPOSE's request to EXP_MOVIE.
2. **EXIF shooting parameters (S-EXIFPRM)** follow from 1: takepic's record (`0x503bba70`, the EXIF set from
   `0x503bd48e`) is the take's, and the start does not fill the state the EXIF set divides by (X). (Since 2026-11-13
   the EXIF set runs natively at S2 after H-RECPRECON, 4.3.11; what is left of this step is takepic's exposure
   record, from TAKE_MAIN's take request.) A few hours after 1
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
    traRoutingSession takes no frames (without A-VSCHIST-3; with it camapp 3's TFT composes, 4.2.4).
    DISPLAY cmd 15 (`0x501d709f`), which the menu and the HDMI plug send while the
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
their queues no longer go to S-TAKEREQ; the strobe's did until 4.12.1. `emu/test/test_take.mjs` pins the records and the
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
  computation over the sensor's statistics (I; read in 4.2.2: EXP_MOVIE's handler calls them after its evaluation and
  a frame wait, not an interrupt). 4.2 and S-EXPOSE's text called `0x50596187` TAKE_EXPOSE's command
  handler; it is the writer called back through EXP (D; corrected there, 4.2.2).
- **TAKE_POWER_MANAGER is asked nothing (X, D).** Every send to TAKE_POWER_MANAGER_EXEC from TAKE_FUNC and
  TAKE_FUNC_CP waits for TAKE's start-up flag, the byte `0x62a3f2bc` (start_up_flag, 4.1.2) = 1: the start's branch
  (`0x502cd84c`: `0x502cd3fa` returns the byte; X: 0 in both camapp modes, so it is the first of 4.1.4's three
  conditions that skips the branch), command 29's `0x5039c6a3` -> `0x506d8c72`, and TAKE_FUNC_CP command 1's stop
  sequence `0x503a0c18` (`0x503a0d53`, `0x503a0e22`). A fifth sender, `0x503a978c`, is reached only from `0x5039f735`,
  whose only static caller `0x50399cd3` is the function named "take" in two `{name, function}` tables (`0x502a2904`,
  `0x502a3ea4`; I: a debug shell's commands). The flag is
  set to 1 only by `0x503a05fb`, which also sends TAKE_FUNC command 29 and is api_rec's `0x50416123`, called by
  CmpSqp_SequencePartsBase `0x50c9d590`; neither camapp mode reaches it (X: the flag stays 0; true of camapp 1 and 2,
  camapp 3's start reaches it, 4.1.7 "Also seen", 4.1.11). What it would do (not
  executed): its handler `0x503a949f` takes the slot the request's parameter byte 0 names, calls the parameter's
  callback, and for byte 0 = 0 replies on its POST queue (`0x503a950d`), for 1 posts a 16-byte request to CPU 1's
  queue 0x1018 (`0x503a9525` through `0x502ce5b7`; CA53_POWER_MNG_REQ in CPU 1's object-name table, type 5 index 24,
  `docs/om1-cores-spec.md` 4). The start's first message (`{1, 0, 0}`, command 2, token 512) would take that path,
  that is ask CPU 1 to change the A53's power (I from the name); no lab runs CPU 1.
- **STB_EXTERNAL answers with no device only through its timeouts, so it stays at S-TAKEREQ (D, X; natively with the
  hot shoe's channel since 4.12.1, which corrects this bullet where marked).** Its task, 101
  (`0x501b7465`, tid word `0x60042df0`, started by the same stage at `0x501e8ff3`), is queue 0x57's one reader: it
  receives at `0x501b7594` (no time limit while its state `0x62a29ad4` is 0) and replies `{u16 status, token,
  parameter}` to word 0 after each command (`0x501b76ba..0x501b76fb`), status always 0 for commands 1 and 4. Of the
  places 4.1.4 named as the strobe's readers, `0x501b74a1` is this task's; `0x501aa18f` and `0x501b2735` (stb_debug.c)
  are senders, synchronous sends to 0x57 through the kernel's `0x5002e39d` (`0x501aa198`, `0x501b273a`). Command 1
  (TAKE's token 4) is processed while `0x62a29ade` is not 1 and `0x62a29ad6` is 0 (`0x501b6de5`; after each command 1
  `0x501b6f9c` sets the first to 1, a command 0 clears it, `0x501b6f8c`; `0x501b7b55` clears the second at the task's
  start): case 1 of `0x501b780e` writes a record at `0x62a296b4` whose first byte is 11 (`0x501b6be7`: PER_SIO's
  configuration of channel 11, which `0x5006480b` reads, 4.12.1), then `0x501b82ab(0)` -> `0x501b833e` opens PER_SIO
  channel 11 and starts a transfer (`0x501bb0b8` -> `0x501b67fc` -> `0x501b6c54`: `0x5005f0f7(11, ...)`, up to five
  tries 10 ms apart while it is busy; the transfer `0x501b6ab9` sends one byte 0x00, the wake, 4.12.1), waits up to
  13000 on the strobe flag's bit 2 (`0x501ba1ac` -> `0x501c18b6`, the flag id at
  `0x60042fee`), which the transfer's completion callback `0x501ba0bc` sets, and on a timeout logs `0x23000112` and
  `0x23000222` and goes on (`0x501ba1c8..0x501ba207`); then it starts a timer of 64 through the firmware's timer service
  (`0x501c1831` -> `0x5005899c`, `docs/om1-kernel-spec.md` 8; its handler `0x501ba277` sets bit 8) and waits for bit 8
  without limit. Nothing on the path asks whether a flash is on the shoe (`0x501b1e7e`, called first, is not read in
  detail; corrected in 4.12.1: the wait is for the wake byte's own transmission, and the shoe is asked after it, by
  state 1's ID exchange, whose reply's first byte is awaited 20 ms; `0x501b1e7e` configures GIO pin 160). Run natively
  in an experiment (X, camapp 1, not committed: the task started with act_tsk after H-TAKENBINIT,
  queue 0x57 taken out of S-TAKEREQ): channel 11 opens (0) and the transfer starts with no error, but it never ends
  (PER_SIO's controller and its interrupt are not modelled on E143, `emu/src/lab/sio.mjs`); the wait runs out 13,001 ms
  of lab clock later with the two logs, the timer fires 64.9 ms after that, a second transfer start (the ID exchange;
  the wake never closed the channel, 4.12.1) finds the channel busy five times and its failure path calls `0x501ba0bc`
  with status 1 (from `0x501b6959`), and the task replies to
  0x61 13.1 s after TAKE's request, the GUI waiting at `0x0102` until then. So the strobe answers with no flash and no
  device model, but only through a path the lab's missing controller decides; run natively it would put a 13 s stall and
  the strobe's error logs into TAKE's start, so it stays at S-TAKEREQ (until 4.12.1: with the channel modelled it
  answers 85.4 ms after the request, X). Command 4 (token 8) is answered at once in the
  state command 1 leaves (`0x62a29ad4` = 1, `0x501b7872`; only state 2 processes it, `0x501b6e6c`). Whether the camera's
  controller ends the transfer with nothing on the shoe is ? (I: it does, 4.12.1: mode 0 sends on its own bit timing).
- **Open.** TAKE_EXPOSE's other commands (`0x200` from 13 under its mode bits, 14's `0x201` and 1, the movie's
  `0xc00` / `0xc01`) and what they ask of EXP (`0x505536be` runs in TAKE_EXPOSE's task); TAKE_POWER_MANAGER needs the
  sequence parts' start-up call (`0x50c9d590`, its trigger not read) and then CPU 1; the strobe needed PER_SIO's
  controller on E143 (the end of channel 11's transfer), modelled since 4.12.1. Of plan item 5 in 4.1.4, the first step
  is done; the strobe's step ended here with a negative result (done in 4.12.1); the camera driver, the dust filter and
  BC are unchanged.

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
  queue is TAKE_POST only where TAKE_MAIN's handler for its token was read (TAKE_FOCUS's `0x300` with token 1, below;
  not reached since TAKE_FOCUS runs natively and replies itself, 4.1.8); any other throws.
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
| | | TAKE_FOCUS command `0x300`, reply queue TAKE_POST, token 1, parameter the record `0x62a4cea8` (`0x503c2ba1`) | token 1 on TAKE_POST | S-TAKEREQ: `{0, 1, 0}` there (since 4.1.8 TAKE_FOCUS's own reply) |
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
  callbacks it calls, and when, is not read (?; answered in 4.1.8: run natively at S1 it calls all four at once). The
  probe answers none of them, since that would invent the AF's progress: the take-ready stops there (X; it goes on
  with TAKE_FOCUS native, 4.1.8).
- **S2 (X).** CapTak_Take's control `0x40` posts TAKE_EXEC command 5. TAKE_MAIN does not take it (TAKE_EXEC holds one
  message by TAKE's own count `0x502ce6ae`); RdyFcsRdy1's command table would take 5 (`0x503c2f5e`), as RdyTrig2Wait's
  would (`0x503c35e9`). No reply goes to the application for S1's request (X). S-RELSEQ's callbacks run beside the
  native path as before (X).
- **Also seen (X; re-run 2026-11-10, 4.1.11).** The start under camapp 3 with the probe, with and without `--cpu2
  native` alike, gives TAKE_FUNC commands 0, 13 and 18, then 29 five times and 22 twice with reply queues, and one
  command 29 with no reply queue (parameter `0x62a3f2be`), which asks TAKE_POWER_MANAGER_EXEC command 0
  synchronously twice. TAKE_POWER_MANAGER (H-TAKENBINIT) takes both natively and replies itself on
  TAKE_FUNC_IMDFUNC, posting once to TAKE_POWER_MANAGER_POST between them (`0x503a9522`); this paragraph had
  S-TAKEREQ answer them, from a run before H-TAKENBINIT (I, from the history: its commit 0b63215, written 18:34 on
  2026-11-09, was rebased onto 6bfb93d, written 19:07, which starts TAKE_POWER_MANAGER natively with the probe and
  takes its queues from S-TAKEREQ). The 29's sender (D): `0x503a05fb`, which api_rec's `0x50416123` (API 0x200ca)
  calls, which CmpSqp_SequencePartsBase's `0x50c9d590` calls at `0x50c9d778`, in the OXF main thread (task 57, X); it
  posts `{0, 0, 29, 0x62a3f2be}` through TAKE's send `0x502ce57b` while TAKE's start-up flag `0x62a3f2bc` is 0, which
  it sets to 1 first. So camapp 3's start reaches the flag's writer, which 4.1.6 found reached in neither camapp mode
  (true of camapp 1 and 2, X). Without the probe S-MODPOST takes the post (4.1.11).

**What S-RELSEQ's retirement still needs (I unless tagged):**
1. The through image's take-over made whole in the default sessions: S-THRTAKEOVER beside S-TAKEOVER (with the rest
   of the kinds 1 and 2 path, `0x50ae005c..0x50ae007b`, ?), or the boot take-over `0x50adffda` itself. Both are every
   play session's, so golden would change; the default camapp mode is still 1 (udf07, the VSC histogram and the imgpro
   unit `0x9c600000` are in since 2026-11-09; what still keeps it is in 4.3.1).
2. TAKE_FOCUS's AF for command `0x300`: the record's callbacks (tokens 0, 2, 3, 5) with FCS and CPU 1 behind them
   (4.1.4, class (c)), and TAKE_EXPOSE's command `0x400` (token 11), whose reply's word 2 its handler frees (D), so
   S-TAKEREQ may not answer it with `{0, 11, 0}`. Bit `0x08` follows from tokens 0 and 11 (`0x503c2d08`, D).
   Answered in 4.1.8: TAKE_FOCUS calls the four callbacks itself, and TAKE_EXPOSE answers `0x400` with its buffer.
3. CPU 3's FACE_FD command 15, answered 0 by S-TAKEREQ: what it asks of face detection (?). Answered in 4.1.8: it
   hands FACE_FD the mode and carries no detection result, its status 0 is the native one (D); what the mode changes on
   CPU 3 is ?.
4. TAKE_MAIN past RdyFcsRdy1: `0x503c2d08`'s BC_EXEC command 53 and camera driver request 144 (D), RdyFcsRdy2 and 3
   (reply tokens 3, 12..14 and 4, 15, D), RdyTrig2Wait (which takes S2's command 5), then the still states (StlRdy1
   .. StlEnd2) for the capture, each new neighbour recorded the same way. Then TAKE_MAIN's reply to the application,
   and the notifications that CapTak_Take's observers turn into sequence events (4.1.3), from which the sequence parts
   would post the callbacks S-RELSEQ posts now. None of these was reached (X); since 4.1.8 S1 goes through
   RdyFcsRdy2 to RdyFcsRdy3's request to EXP_MOVIE, and TAKE_MAIN replies to the application (X).

#### 4.1.8 The release route, round 2: TAKE_FOCUS (2026-11-09; D unless tagged, addresses E143's)

With `--take probe` TAKE_FOCUS runs natively too (H-TAKEFOCUS, `emu/src/lab/take.mjs` round 3; off by default, golden
unchanged). Under `control camapp 3` S1's take request then goes natively through RdyFcsRdy1, RdyFcsRdy2 and
RdyFcsRdy3's entry and stops at TAKE_EXPOSE's request to EXP_MOVIE (X). `emu/test/test_take_release.mjs` focusSession
pins the records below (X, 9 of 9); `emu/test/test_take.mjs` pins the start and the mode change with TAKE_FOCUS native
under camapp 1 and 2 (X, 19 of 19). S-RELSEQ stays in every session.
Since 2026-11-10 focusSession runs with `--cpu2 native` and pins S1 as 4.2.3 gives it (EXP_MOVIE takes the `0x509`
natively and waits for the frame events); the stop below without `--cpu2 native` is no longer pinned by a test.

- **TAKE_FOCUS's task (D).** Task 104 (0x68), entry `0x509a0ebe`, tid word `0x60042df6`: after `0x509b1475` (the
  handles of the objects it reads) it receives 16 bytes on queue 0x5d (word `0x6004327e`; `0x506ea9a8`, timeout -1)
  and looks the command (word 2) up in a static table at `0x60a64f00` (64 slots `{command + 1, case}`, probed from
  the slot `(command + 1) & 63` on, `0x509a0f1c..0x509a0f41`; 43 commands; correction to 4.4: at `0x60a64f00` and in
  the image's data, not built at run time: its bytes are the image's own at offset `0xa43ee0`, X, and a byte scan
  finds the address only in this lookup, `0x509a0ed5`). Each case logs its name and
  calls its handler with the context `0xa33d9564` and the parameter; then `0x509b1342`, and, when word 0 is not 0, the
  reply `{u16 0, token, parameter}` (`0x506ea985` at `0x509a13e7`): the status is 0 after every command. The commands:
  0 MODE_START, 1 MODE_END, 2 MODE_UPDATE, 0x100 LOCK_START, 0x101 LOCK_END, 0x102 LOCK_START_END, 0x103
  LOCK_START_END_FAST, 0x104 LOCK_RESTART, 0x200 / 0x201 PANORAMA_START / END, 0x300 / 0x301 RELEASE_READY_START /
  END, 0x400 / 0x401 / 0x403 RELEASE_IDLE_START / END / READY, 0x500 / 0x501 RELEASE_TAKE_START / END, 0x600 / 0x601
  / 0x603 TAKE_CONTINUE_START / END / BRACKET, 0x700..0x702 LV_START / END / UPDATE, 0x800 / 0x801 MF_START / END,
  0x802 MF_RING, 0x803 FIXED_FOCUS, 0x900 / 0x901 IAF_RESTART / PAUSE, 0x903 z_af_test, 0xa00..0xa03 MOVIE_START /
  END / UPDATE / READY, 0xb00 / 0xb01 TAKE_ONCE_START / END, 0xc00 / 0xc01 MOVIE_MODE_UPDATE_PRE / UPDATE, 0xe01
  RELEASE_END, 0xf03 (`0x509ad477`), 0x1003 INFINITE_FOCUS (a log only), 0x1102 FOCUS_RING_LOCK_UPDATE, 0x1202
  FACE_SELECT. So 4.1.1's `0xa0n` are MOVIE_* and 4.1.7's `0x300` is RELEASE_READY_START.
- **H-TAKEFOCUS (D).** Two inits, in the boot's order: TAKE_FOCUS's interface `0x506ea9d7` (USTART2's stage
  `0x501e8e84` at `0x501e9088`, before TAKE_EXPOSE's: the context pointer `0xa33d9560` = `0xa33d9564`, the ready byte
  `0xa33d955c` cleared, the UI_IN edge callback `0x506eac7a` registered for 0x101 through `0x5014c420`) and its module
  `0x509a0e37` (the stage `0x501e94a5` at `0x501e9541`, after the AF library's init `0x508bede6` at
  `0x501e9533`: the context's fields, the ready byte set to 1 at `0x509a0eb5`); the stage starts the task at
  `0x501e964f`. The probe runs the two inits and act_tsk after H-TAKEMAIN; TAKE_FOCUS then waits on its queue (X).
  The AF library's init does not run (the lab runs three of its steps for MDET only, H-FCSAF, `docs/om1-subject-spec.md`
  5.7). TAKE_FOCUS's queue leaves S-TAKEREQ; TAKE's event post `0x502ce5e6` to the application's queue 6 and TAKE_MAIN's
  reply to the take request's requester (`0x50399c4f`) go natively and are recorded (both new in this round's runs).
  S-TAKEREQ's answer on TAKE_POST to TAKE_FOCUS's `0x300` (4.1.7, `take.mjs` MAIN_REPLIES) is no longer reached: the
  request goes to TAKE_FOCUS natively (X).
- **Correction to 4.1.4 row 4 (D, X).** TAKE_FOCUS's request API `0x506eab1f` posts commands 0 and 0x700 with no
  reply queue only while the ready byte is 0; any other command it then logs (errlog `0x0f803002`, from
  `0x506eab5a`) and sends synchronously all the same (`0x506eab75` -> `0x506eabe8`). With the byte 1 it runs 0x601
  in the caller's task (`0x509aa840` at `0x506eabd7`) and sends every other command, 0 and 0x700 included,
  synchronously through the kernel (`0x506ea9cc`). With TAKE_FOCUS's inits run, as the boot runs them before the
  application starts (I: the order of the stages), command 18's MODE_START is therefore a synchronous request that
  TAKE_FOCUS answers itself (X). Command 22's MODE_UPDATE does not use this API: it was synchronous before
  (`0x506d9854`, row 6) and TAKE_FOCUS now answers it itself too (X).
- **The start (X).** TAKE_FOCUS takes MODE_START once and MODE_UPDATE twice (camapp 3; camapp 1: MODE_START alone,
  camapp 2: MODE_START and one MODE_UPDATE, which sends no lens frame), each replied with status 0. In camapp 3 a
  MODE_UPDATE sets the lens's AF mode through the AF library once (`0x509a1a73` -> `0x50974212` ->
  `0x50974553(1, 0)`: a request {the completion `0x50974677`, the address of a status word set to 1, u16 the kind 1,
  the byte `(0xa33d8ba1)`, a byte} to the lens driver `0x502c2524`, then a wait on the flag whose id is at
  `0x60043082`), which the driver's deferred job `0x502c2635` (posted through `0x502c6171`) turns into a type-1
  request (`0x502c29ca`: id 1 for the kinds 1, 3 and 5, id 0 for 2, 6 and 7; sub-code 0xfe; the byte) and the
  builder `0x502b7e8a` into the frame `a0 b0 [fe 00]` (class `0xa0`, code `0xb0`, or `0xb1` with `[00 00]` for id
  0, data count 0). Its completion `0x502b7efe` reads only the status, so no reply is parsed; S-LENSMCU now
  completes the frame with no reply (before, it stopped the session naming it, X). What the lens does with it is ?.
  TAKE_FOCUS's context then holds its "focus" field (+5) 1 and its state (+12) 1 (X); the field is object 0xc021
  read through `0x509b1bc5(14)` (case table `0x60a65300`), which MODE_UPDATE's mode computation `0x509a14b0` logs
  as "focus" beside saf_mf (+6, object 0x8de1), movie, tracking, ring and star_af. What 1 means is ? (the shooting
  screen shows S-AF, X).
- **RELEASE_READY_START (`0x509a54e1`) at S1 (D, X).** It copies the record TAKE_MAIN gives it (`0x62a4cea8`) into its
  context, then, when its byte +7 is 0 and the record's byte +37 (its copy +45) is 1 (`0x509a561a..0x509a5631`, so
  in the lab, X), by the "focus" field: 0 has paths that call the AF library (`0x508c0a34(0x1100)` at `0x509a5698`) and
  paths that answer at once, 2 its own; for 1 with the state 1 (`0x509a5965..0x509a5975`, log id 0x11601) it sets
  the state 2 and calls the record's four callbacks at once, in its own task (X): +0x18 through `0x509ae086` (log
  "exp_allw": token 5), +0 through `0x509ad79a` with status 0 ("free_notice": token 0), the result callback through
  `0x509ad948` ("result:0": token 2) and the end callback through `0x509af010` ("end:0": token 3; "end:1" after
  OlyTaSS(40) when its byte +27 is 3), then returns and TAKE_FOCUS replies token 1 on TAKE_POST. No FCS request and
  no lens frame is made (X; focusSession pins both: a post or a synchronous send from TAKE_FOCUS's task to a queue
  the probe does not know, FCS_EXEC's among them, would throw before the stop, and the lens's frame count does not
  change from S1 to the stop). So in the lab's state TAKE_FOCUS does no AF at S1 and reports its result 0 at once; that
  0 means "in focus" is I, and whether the camera's S-AF scan comes at this command or later (LOCK_START, 0x100) is ?.
  On the way `0x509afafc` (from `0x509a5609`) logs errlog `0x0f803003` (`0x509aef05`: the context's u16 +20 is 0;
  its writer is not read, ?).
- **FACE_FD's command 15 (D, X).** RdyFcsRdy1's entry asks it through the face API `0x50522464` (`0x503c29f0`, when
  `0x503a0641()` differs from the mode) with a 1-byte request, the mode (1 at S1, X), synchronously to CPU 3's
  queue 0x3002 (`0x50524a20`). CPU 3's FACE_FD task (`0x505174e7`) takes its queue's messages in its loop (the count
  `0x50524f1b`, each 16-byte message `0x50524a98`), dispatches through the table `0x606d6d3c` (commands 0..16) and
  replies `{u16 status, token, word 3}` (`0x50524add`); case 15 (`0x50517a85` -> `0x5051f0ef`) runs its commands 13
  (`0x50518119`) and 14 (`0x5051a642`) with the byte when it is 1 or 2 (else errlog `0x2f00080e`), and the status is 0
  for every valid command (`0x50517a9f`). TAKE_MAIN reads only the status (`0x50524a63..0x50524a7b`: not 0 gives
  `0x8708`). So S-TAKEREQ's status 0 is the native status (D) and "no face" does not arise: command 15 carries no
  detection result. What the face detector's mode 1 changes on CPU 3 is not done in the lab (no CPU 3 FACE task, I)
  and not read (?).

**S1's take request (X; `test_take_release.mjs` S1_FOCUS).** The guard and the take API as in 4.1.7 (control `0x20`).

| State | TAKE_MAIN takes | It asks | The answer |
|---|---|---|---|
| Idle | TAKE_EXEC 0 (reply queue 6, token `0xf0050000`, handler `0x503a1172`) | FACE_FD 15 sync; TAKE_FUNC 80 sync; TAKE_FOCUS 0x300 (reply TAKE_POST, token 1) | S-TAKEREQ 0; native; native: TAKE_FOCUS calls tokens 5, 0, 2, 3 and replies token 1 |
| RdyFcsRdy1 | mailbox token 5 (`0x503c2c3a`) | its reply to the application (status 0, `0x50399c4f`); TAKE_EXPOSE 0x400 (token 11, a 52-byte buffer) | native; TAKE_EXPOSE replies token 11 with the buffer, which `0x503c2ce6` frees |
| RdyFcsRdy1 | mailbox token 0, TAKE_POST token 11 | `0x503c2d08`: BC_EXEC 53 sync, the camera driver's request 144, TAKE_FUNC 80 sync | S-TAKEREQ 0; S-TAKECAM (completion 0); native |
| RdyFcsRdy1 | mailbox tokens 2 and 3, TAKE_POST token 1 | (to RdyFcsRdy2, `0x503c2fbf`) | |
| RdyFcsRdy2 | (entry `0x503c2fcf`) | TAKE_FUNC 80 sync; TAKE_EXPOSE 0x503 (token 14); TAKE_FOCUS 0x403 RELEASE_IDLE_READY sync; TAKE_FUNC 80 sync | native, each |
| RdyFcsRdy2 | mailbox token 13 (`0x503c3214`; TAKE_EXPOSE's 0x503 calls the callback from its task, `0x50593201`) | TAKE_FUNC 80, no reply queue (`0x503c42fd`); TAKE's event `0x04080032` to API_EVENT (`0x503c3269`) | native |
| RdyFcsRdy2 | TAKE_POST token 14 (`0x503c32ce`) | (to RdyFcsRdy3) | |
| RdyFcsRdy3 | (entry `0x503c335a`: object 0xc021 is 1, `0x503c3385..0x503c3398`) | pending bits `0x300`, TAKE_EXPOSE 0x500 (token 15), OlyTaSS(16) | TAKE_EXPOSE's 0x500 asks EXP_MOVIE (below) |

TAKE_MAIN answers the application's take request at RdyFcsRdy1's token 5 (status 0), the first native answer to it.
The stop: TAKE_EXPOSE's 0x500 builds an AE request in EXP's `0x50553942` (in TAKE_EXPOSE's task), which posts
`{EXP_MOVIE_POST 0x18, 0, 0x509, request}` to EXP_MOVIE (0x17, the queue word `0x600431f2`) and receives 12 bytes on
0x18 with no time limit. EXP_MOVIE (task 0x58) does not run and the probe has no reading of its answer, so the
request throws; TAKE_MAIN is then in RdyFcsRdy3 with the pending bits `0x300` (X). The errlogs since S1 are
`0x25001703` (4.1.7), `0x0f803003` (above) and `0x39000903` twice (X).

- **Past the stop, an experiment (X, not committed; EXP_MOVIE's 0x509 answered `{0, 0, 0}` on EXP_MOVIE_POST, an
  invented answer).** TAKE_EXPOSE replies token 15, RdyFcsRdy3 asks TAKE_FOCUS 0x400 RELEASE_IDLE_START (token 4,
  replied natively) and TAKE_MAIN reaches RdyTrig2Wait with the pending bits 0 and the wait pattern 7; the sequence
  takes event 794 (CmpSts_ObserverNotifyTakeReadyFinish, 4.1.3) in phase 102. S2 is then event 824 in phase 103, and
  CapTak_Take's takePicture (`0x50bc876a`, at `0x50bc8acc`) sends api_rec `0x5040ee43` (API `0x20013`): TAKE_EXEC
  command 11 (reply queue 6, token `0xf0070000`), which RdyTrig2Wait takes (`0x503c40b2`; 4.1.7's command 5 is, I,
  the S2 of a take-ready not yet finished): TAKE_FUNC 80, FACE_FD 15, TAKE_FOCUS 0x500 RELEASE_TAKE_START (token 8),
  state RdyFcsTake; its mailbox token 5 asks TAKE_EXPOSE 0x600 synchronously, in whose run EXP logs `0x0e0000ff`
  (`0x50576bac`), `0x0e001606` and `0x0e0000ff` and the CPU jumps to `0x000020fb` (fault 3) in TAKE_EXPOSE's task.
  Why is ? (I: EXP's init `0x50553649` does not run, 4.1.6). Without the experiment S2 is not reached.
- **Also corrected.** Round 1's record attributed a post through TAKE's helpers `0x502ce5b7` and `0x502ce5e6` to the
  helper itself: the probe's keys for their calls of the send helper were one byte short of the return addresses
  (`0x502ce5d8`, `0x502ce612` for `0x502ce5d9`, `0x502ce613`); fixed, the canonical records are unchanged (X). 4.1.7's
  open items 2 and 3 are answered above: TAKE_FOCUS calls the four callbacks itself, and TAKE_EXPOSE (native since
  4.1.6) answers 0x400 itself with its buffer.

**What S-RELSEQ's retirement still needs (I unless tagged):**
1. EXP for TAKE_EXPOSE's take-ready and take requests: EXP_MOVIE's answer to 0x509 (RdyFcsRdy3's 0x500, X) and
   TAKE_EXPOSE's 0x600 at S2 (the crash above, X with an invented answer); 4.2 seam B, S-EXPOSE's round. Since
   4.2.3 (H-EXPINIT) EXP_MOVIE takes 0x509 natively and waits for the frame events of the driver's front end (X).
2. The AF: what object 0xc021 = 1 means and whether the camera's S-AF scans at RELEASE_READY_START or later (?);
   TAKE_FOCUS's context +20 (errlog `0x0f803003`); the AF library's init `0x508bede6` (logs `0x1c005002` in the lab,
   `docs/om1-subject-spec.md` 5.7); behind them FCS on CPU 1 and the AF data path (4.4).
3. The neighbours still stood in on this route: BC_EXEC 53 (the IS link, 4.4), the camera driver's request 144
   (`0x5015582d`, a sequence item, S-TAKECAM; cam.c's init, 4.2), FACE_FD 15 (status native, its mode change not).
4. RdyFcsTake's reply tokens 5 and 8, the still states (StlRdy1 .. StlEnd2) and the capture (TAKE_FUNC, the shutter,
   cam.c's still capture, 4.3), then the notifications CapTak_Take's observers turn into the sequence events that make
   the sequence parts post what S-RELSEQ posts now (4.1.3; 794 is the first of them, reached in the experiment).
5. For the default sessions besides: S-THRTAKEOVER beside S-TAKEOVER (4.1.7 item 1), camapp 3 as the default (past
   the imgpro unit since 2026-11-09; its next stops and what else keeps camapp 1 the default, 4.3.1; their causes in
   4.3.2 and what still separates it in 4.2.4, 2026-11-10), and the probe's
   bring-ups (H-TAKEINIT, H-TAKEMAIN, H-TAKENBINIT, H-TAKEFOCUS, H-STBINIT with S-HOTSHOE) as the default, each
   recording stand-in (S-TAKEREQ, S-TAKECAM, S-TAKEUSF) retired by its neighbour running natively; all of these change
   golden.

#### 4.1.9 S-DISPQ's nested posts (2026-11-10; D unless tagged, addresses E143's)

Two `control camapp 3` sessions stopped at the same lab refusal: S-DISPQ refused a post to the DISPLAY queue made
while a DISPLAY run was open (depth 1): S2 under `--take probe --cpu2 native` (4.2.3) and PLAY pressed at the start's
end (4.2.4). This round reads the DISPLAY task's queue discipline and makes S-DISPQ keep such a post for the run's end
(`emu/src/lab/dispq.mjs`, `emu/src/lab/play.mjs`); another task's synchronous DISPLAY send in that time now runs
natively and waits for its reply, as on the camera. `emu/test/test_dispq.mjs` dispqUnits (X, 6 of 6, firmware-free)
and dispqSession (X, 12 of 12), and `emu/test/test_take_release.mjs` focusSession (X, 12 of 12) pin it.

- **The symptom (X).** In both, the OXF main thread (task 57, priority 55) sends DISPLAY cmd 15 synchronously (from
  `0x503ec117`); its run waits for the histogram's end (S-HISTEND, 4.2.1), the wait blocks natively, and task 168
  (entry `0x5115ba0c`, priority 55) runs. Its synchronous DISPLAY send (S2: cmd 17 from `0x507f66d1`; PLAY: cmd 4
  from `0x503ec117`, after a send to queue 8211) ran the DISPLAY loop at once, inside cmd 15's run, on task 168, and
  returned; task 168 went on to the display manager's request (cmd 18 from `0x503eba07`, `{6, 0xf0080000, 18, param}`
  at S2, token `0xf0050000` at PLAY), which S-DISPQ refused at depth 1: "UI_IN group 1 (group 3 at PLAY): OlyQeWr to
  the DISPLAY queue from ... (disasm `0x503eba07`) (depth 1)".
- **The DISPLAY task's loop (D).** Static id 54, priority 26, entry `0x501c3035`: the message buffer at sp + 44 (16
  bytes) and its descriptor at sp + 60; OlyQeRd(the queue of `(0x600432d4)`, timeout -1) at `0x501c308b`;
  `0x501c3922(0)`; the dispatch on word 2 (cmd 2..48 through the table `0x602abbfc`, any other logs `0x37003103` at
  `0x501c3848`); the reply status (40,sp), 0 but for cmd 14 (2 when word 0 equals `(0x60043286)`) and cmd 16 (4 when
  `(0x62a3540c)` is not 0); the reply `0x501c48bf(status, &message)` at `0x501c38a3`; `0x501c3922(1)`,
  `0x501c7eae(16)` and `jmp 0x501c307c`, back to the receive. So the task takes one message at a time. The reply: status
  0 with word 0 not 0 sends `{u16 status, word 1, word 3}` (12 bytes from the static `0xa32db3d8`) to the queue in word
  0 (OlyQeWr at `0x501c490c`, timeout -1); word 0 = 0 sends nothing (statuses 2 and 4: `docs/om1-input-spec.md`
  section 7). The kernel copies a message at the post: OlyQeWr's tsnd_dtq (`0x50016578`) copies it into a waiting
  receiver's buffer (the byte copy `0x50015a0d` called at `0x50016667`) or, with no receiver waiting, keeps it in the
  queue (`0x5001667d..`; I: that write not read to its end). So a post made while the task handles a message waits
  in the queue and is taken at the next receive, in the order of the posts; the camera has no nesting.
- **How a synchronous command replies (D).** The send `0x5002e39d` (a queue id without bit 15): two blocks of 16 and 12
  bytes (`0x500030e0`), its own reply queue from acre_Queue1 (`0x5002c866`), the target kept at `0xa325ea7c`, the
  message `{its reply queue, get_tid's id (0x5002e3e4), cmd, param}`, OlyQeWr(target, `{message, 16}`, -1) at
  `0x5002e40c` (a 5-byte call, returning to `0x5002e411`), then OlyQeRd(its reply queue, -1) at `0x5002e422`, OlyQeDl
  (`0x5002bfec`) and the reply's first halfword as its result (`0x5002e441`). With bit 15 it takes the semaphore of
  `(0x60042d00)` and one of eight static reply queues (`0xa325ea3c`, a busy byte at +4), with the same post and wait at
  `0x5002e4e7` / `0x5002e4ff`. So the sending task waits in its receive until the DISPLAY task has answered, and a
  synchronous send from a second task during a command waits behind that command.
- **Causes (X unless tagged).** (1) S-DISPQ refused a post in an open run, which the queue keeps: the stop's own
  cause. (2) The lab's synchronous send (`DisplayLab._sync_send`) ran task 168's command at once inside task 57's
  run, so task 168 went on past a send it waits in on the camera and made its post while cmd 15 was still open; on
  the camera task 168 posts cmd 18 only after its own command's reply, which comes after cmd 15's (D, above). (3)
  Ruled out: the post's site is the display manager's request S-DISPQ already runs (`0x503eba07`); only the depth
  refused it. That task 168 runs while cmd 15 waits is not the lab's (I): on the camera the DISPLAY task's block in
  the same wait lets a ready task run too, and whether task 168 is ready then is timing (?). The lab's difference is
  the wait's end: the run has its sender's priority (55), not the DISPLAY task's 26, so it does not take the CPU back
  from a running task of priority 55 when the wait ends. Either way task 168's command waits behind cmd 15 (D, above).
- **The change (X).** A DISPLAY run is open from its start to its loop's next receive (`PlayLab.task_message` over
  `DisplayQueue`, `emu/src/lab/dispq.mjs`). While one is open S-DISPQ keeps a post to the DISPLAY queue (the display
  manager's request, or a synchronous send's own post, return `0x5002e411`), copied at the post; when the outermost
  run ends it runs each kept message in order, on the task the run was on, whatever they post in turn kept behind the
  ones before. Another task's synchronous DISPLAY send while a run is open runs natively (`PlayLab._sync_send`): its
  queue created, its post kept, its receive blocking; the kept message's run sends the reply to the send's own queue
  natively (`0x501c490c`), which readies the task. A reply to queue 6 goes through S-CAMAPP's pump after the step as
  before (4.4.2). Unchanged: a send of a run's own task (a handler's) runs nested at once, a post inside a run of
  another loop (CHANGE, touch) with no DISPLAY run open is refused, and the dispq-at-once mutant (the control) gives
  the old discipline back. The kept message's word 1 is the DISPLAY task's id 54 (`0x36`) where the camera's is the
  sender's (X: the kept cmd 4's words `{0x104, 0x36, 4, param}`): get_tid's lab stand-in answers DISPLAY_TID to any
  task while `in_display_run()` holds (`emu/src/lab/menu.mjs`; the run depth is the lab's, not a task's), so to task
  168's send too. The reply echoes the word and the send reads only the status halfword (D); the loop itself reads
  word 1 only for an error log (`0x501c36c6`, D) and hands the whole message to `0x501c7fb2` and `0x501c4980`, which
  are not read to their end (?).
- **The siblings (D, X).** None of the three named stand-ins runs another task's loop inside a command. S-MODACK
  takes the application's posts to module queues off at the post and answers them after the step through S-CAMAPP's
  pump, each with a settle, in their order; its synchronous branch (`camapp.mjs` `_sync_send`, module queues)
  returns 0 at once and runs no receiver. S-TRAACK answers at the exec in the caller's context (0, or the request's
  own delete) or, under camapp 3, hands the transaction to the exec natively. S-RPC answers the two remote entries 0
  at once without sending. The defect was the DISPLAY synchronous send stand-in's, fixed here for other tasks' sends;
  a run's own nested sends and S-TPSEND (the touch task's loop inside a display run, `emu/FIDELITY-NOTES.md` 7.8)
  still run a loop inside a run (no session reaches a handler's own nested DISPLAY send in these tests, X).
- **How far the early PLAY goes (X, dispqSession).** Cmd 15 (task 57); task 168's cmd 4, kept from `0x5002e411` with
  its reply queue `0x104`, runs on task 57 once cmd 15's run has ended, nothing between them, and its reply
  `{0, word 1, word 3}` goes to `0x104`; task 168 goes on to its cmd 17 and the request cmd 18, both at depth 0, cmd
  18's one reply reaching queue 6 through the pump. No DISPLAY run starts inside another. PLAY shows No Picture
  (`0x0505`), the frame word for word that of PLAY after 2 s of idle, and PLAY again returns to `0x0108`. Control:
  under dispq-at-once cmd 4 runs on task 168 inside cmd 15's run and the step stops as 4.2.4 recorded.
- **How far S2 goes (X, focusSession).** Event 824 in phase 103; cmd 15 (task 57); task 168's cmd 17 kept (reply
  queue `0x105`) and run after it; the display manager's two requests cmd 18 (tokens `0xf0080000` from task 57 and
  `0xf0090000` from task 168) at depth 0, one reply each to queue 6; task 168's cmd 17 again. TAKE takes nothing and
  TAKE_MAIN stays in RdyFcsRdy3 (EXP_MOVIE waits for the frame events, 4.2.3). The idle then stops at 5.03 s of lab
  time at S-SCPUDEV: the MN's sub-CPU command `0x14 {00 01 00 03 00}` (a power manager short write, 4.7.1; the
  sub-CPU's handler `0x8015345`, its message 11), not modelled. S2 does not bring it: with S1 alone held it comes at
  5.08 s, 1.16 s after S1, with the old discipline too (dispq-at-once). Which of the power manager's builders sends
  it, and why S1 held brings it, is ?.
  (2026-11-11, 4.7.6: both are read, S-SCPUDEV takes the write, and S2's idle goes on with no stop.)
- **Golden (X).** `emu/bin/golden.mjs check`: identical, every one of its 240 sessions (the default is camapp 1, whose
  sessions this change leaves as they were); no re-record.
- **Corrections.** 4.2.3's S2 record ("the GUI's command 17 runs nested in it", the S-DISPQ stop) and 4.2.4's
  "playback's PLAY, pressed at the start's end (2.86 s), stops at S-DISPQ" describe the lab before this round; the
  nesting was the lab's (the camera's cmd 17 waits for cmd 15), and 4.2.3's next step (3) is done.

#### 4.1.10 TAKE's take-ready on the second shot (2026-11-10; D unless tagged, addresses E143's)

4.3.2's stop 1: after a shot under `control camapp 3` the sequence waits in phase 102 and no key is taken, while in
4.2.3 the sequence takes event 794 (TakeReadyFinish) 66.7 ms after S1. This round reads who sends 794 and why a later
shot gets none. The two sessions differ: 4.2.3's runs TAKE natively (`--take probe --cpu2 native`), 4.3.2's does not.
`emu/test/test_take_ready.mjs` secondShotSession pins the probe's side (X, 15 of 15).

- **Who sends 794 (D; X in the probe's session).** It is TAKE's module event mapped by the application, not a
  capability's notification.
  - TAKE_MAIN in RdyFcsRdy2, at its mailbox token 13, posts the module event `0x04080032` to API_EVENT (queue 6)
    through `0x502ce5e6` (at `0x503c3269`, 4.1.8).
  - The application's event task (task 164, entry `0x50abbf0c`, X) hands the event to Com_EvSenderManager
    `0x50d76ac8`. A code without the top nibble `0xf` goes to `0x50d76cfa`. There `0x50ab5683` selects a table: when it
    answers non-zero, the second one (run-time `0x60ef11d4`, 128 slots `{code - 0x01000101, case}`), which gives
    `0x04080032` the case `0x50d77e6a`.
    The first table (run-time `0x60ef15d4`, 64 slots `{code - 0x020000ff, case}`) has no `0x04080032`. `0x50ab5683`
    returns the word `(0x6035e9d4)`, 1 in the probe's session (X).
  - The case builds event 794 (constructor `0x50c811ce`, called at `0x50d77eaf`) when the word `(0x60364d6c)` is
    non-zero and the shooting phase query `0x50ab57e9` answers a phase outside 113..117 (113..116 are the movie
    phases, `docs/om1-shutter-spec.md` 7). The sequence (task 57) takes 794 in phase 102 and moves to phase 103 (X).
  - The constructor's other caller, the observer `0x50c705a3` of CmpSts_ObserverNotifyTakeReadyFinish.cpp (4.1.3),
    does not run (X). This settles 4.2.3's "it follows `0x04080032`" (I there). The same table holds the TAKE codes
    `0x04080034..0x04080040`; their senders are not read (?).
- **Without the probe (traRoutingSession; X).** No shot gets 794, and the menu's shot is the session's first take
  request, not its second. The passes before the menu stop at the S1 guard (4.1.7). After the menu, S1's control
  `0x20` and S2's `0x40` reach the take API, and TAKE_EXEC is S-MODACK's: TAKE_MAIN does not run without the probe.
  S-MODACK answers status 0, TAKE_MAIN's own answer (4.1.8), and nothing posts `0x04080032`. S1's release is event
  827 in phase 102 and makes no take API call, so the sequence stays in phase 102 (after the pass's S2 only: S1
  released alone goes to phase 111 and on, corrected in 4.1.12; since 2026-11-11 S-TAKERDY posts the event).
- **With TAKE native (`--take probe --cpu2 native`; X unless tagged).** The first S1 goes as in 4.2.3: 794 at
  66.7 ms. TAKE_MAIN then waits in RdyFcsRdy3 with the pending bits `0x200` (TAKE_EXPOSE's token 15) and the wait
  pattern `0x5`, while EXP_MOVIE waits on flag 21 for the frame events.
  - S1's release is event 827 in phase 103 (case `0x50c5e325`, D). CapTak_Take's TakeReady (`0x50bc79e6`) calls the
    take API with control 0 (`0x50bc7a2a`), which posts TAKE_EXEC command 7 `{6, 0xf0070000, 7, packet}` through the
    API sender.
  - TakeReady builds 793 (StopTakeReadyDone) at once when the API returns 0 (`0x50bc7a32..0x50bc7a4d`, D). On another
    result its argument decides (d0, kept in d3; 0 here, X). With 1 it builds a response object (`0x50ab7316`) and then
    793 too (`0x50bc7ad4`, D). With 0 it goes to `0x50bc7aec`: a response object (`0x50ab705f`, with that result)
    handed to the object at +2848 (its vt[1], D), and no 793. The API returns the request's token `0xf0070000`, so this
    stop takes the second path. (Since the second slot is empty by default, 4.8.12, the token is `0xf0060000`, X:
    secondShotSession's STOP_TOKEN at the round's merge; I: camapp 3's media manager no longer sends drive 1's mount
    through the API sender at the start.)
    That TAKE's reply to command 7 is what would bring 793 is I (X in 4.1.12: through
    `0x50bca801`). The other builders of 793 (`0x50bca801`, `0x50bcb5bc`, `0x50cd42fc`, D) do not run.
  - The sequence moves to phase 111. Phase 111's dispatcher `0x50c611d5` (pointer to member at `0x603644e4`; table
    run-time `0x60e9aeb0`, 46 ids in 282..1247, read in the lab) takes 793, 791, 789, 786 and 794. It does not take
    824, 826, 827 or 828 (D). An id outside its table goes to its default case `0x50c615e4`, which makes a virtual
    call (vt +5220) on the object at +2784 and returns 0 (D; what the callee does is not read, ?; 4.1.12: it is a
    bare return). The second S1's 826 and 827 reach that case, as the histogram's 944 does (X).
  - TAKE_MAIN does not take command 7, so TAKE_EXEC holds it (TAKE's count 1). TAKE_EXEC is read only while the wait
    pattern has the bit `0x2` (`btst 2` at `0x5039983f`, D), and the pattern stays `0x5` while bits are pending.
    RdyFcsRdy3's command table is empty, while Idle, RdyFcsRdy1 and RdyTrig2Wait list command 7 (the state table
    `0x605bfbc8`, read in the lab; D).
  - The second S1 is event 826 in phase 111 and its release 827 in phase 111. There is no take request, no 794, and
    TAKE takes nothing; the state holds 1.8 s after the first release and through the second S1. MENU then reaches
    UI_IN and sets no GUI event. No event reaches the sequence, and isCtrlReleaseEnable is not asked: 4.3.2's refusal
    is phase 102's. Where the application drops the key is not read (?).
- **Why (I, from the above).** 794 is not sent the second time because the first take-ready never ends. TAKE_MAIN
  waits for TAKE_EXPOSE's token 15, TAKE_EXPOSE for EXP_MOVIE's answer to `0x509`, and EXP_MOVIE for the camera front
  end's frame events (4.2.3). The stop waits behind them, so 793 never comes and the sequence never leaves phase 111,
  where S1 is not an event it takes. No stand-in of the first shot's path answers only once, and the menu and
  playback play no part here: the probe's first S1 passes the guard without them (S-THRTAKEOVER).
- **An experiment (X, not committed; an invented answer).** TAKE_EXPOSE's wait on EXP_MOVIE_POST was answered
  `{0, 0, 0}` once EXP_MOVIE had taken the `0x509`, as in 4.1.8's experiment; EXP_MOVIE itself still waited on flag 21.
  The take-ready then reached RdyTrig2Wait (pending 0, pattern 7). At S1's release TAKE_MAIN took command 7 there
  (`0x503c4047`) and went to RdyAbort, which asked TAKE_FOCUS `0x401` (RELEASE_IDLE_END), took mailbox token 5, and
  asked TAKE_FUNC 80 and TAKE_EXPOSE `0x501` synchronously. The `0x501` did not return: TAKE_EXPOSE waited in a
  receive, its stack holding returns into EXP's code (`0x50580690`, `0x502a9bb1`); for what is ?. TAKE_MAIN stayed in
  RdyAbort with the pending bits `0x400`, and the sequence in phase 111. So the stop, too, needs EXP's answer (I).
- **A lab stop on this route: S-SCPUDEV's `0x14` (X; D where tagged).** With S-SCPUDEV, the default, the probe's
  session stops 1.16 s after S1, whether S1 is released or not; without S1 no `0x14` comes in 3 s.
  - The power manager (task 10, entry `0x50043cdb`) sends the sub-CPU `0x14 {0, 1, 0, 3, 0}`. The builder is
    `0x500435b0`, called at `0x5004452e` from its state-change notice `0x500444b3`, which sends the write when its
    comparison of two state records (`0x500444cb..0x500444fc`) finds a difference (D; the field layout is not read in
    full).
  - S-SCPUDEV does not model `0x14`: its handler `0x8015345` posts the sub-CPU's power manager message 11, whose
    meaning is ? (`docs/om1-scpu-spec.md` 3.3). Which state change comes 1.16 s after S1 is not read (?).
  - With the sub-CPU's own firmware (env.scpu 'native'; A-SCPUM4-1, A-SCPUM4-2, S-SCPUBOARD) the write is the link's
    only transfer from S1 on, and no message comes back in the next 3.3 s. So the session's second part runs that
    way.
  - S-SCPUDEV is left as it is: it is every body's model, and nothing shows what message 11 changes. focusSession
    does not reach the write, since its S2 stops first.
  - 2026-11-11 (4.7.6): the state change is the session's first source check, which TAKE_MAIN's RdyFcsRdy1 lets the
    power manager's cyclic tick run; message 11 keeps the two battery slots' bytes and sends the MN nothing; S-SCPUDEV
    takes the write, and the stop is gone.
- **Tests (X).** secondShotSession's two sessions:
  - with S-SCPUDEV: the first S1's record (focusSession's S1_EXP) and the 794 build in the event task, the release's
    stop and phase 111, phase 111's table, the stop at `0x14` (the power manager's task, 1.1 to 1.2 s after S1);
  - with the sub-CPU's firmware: the link's one transfer, the state 1.8 s after the release, the second S1 and its
    release (each in phase 111's default case), and MENU.
  - 2026-11-11 (4.7.6): both sessions run both parts (24 of 24), with the `0x14`'s cause and the bytes each sub-CPU
    keeps in place of the stop.

  `emu/test/test_camapp.mjs` traRoutingSession (25 of 25) adds a check: the session's only take requests are the
  post-menu pass's (`0x20`, `0x40`), they go to S-MODACK's TAKE_EXEC, and no 794 is built.
- **Open.** The neighbour is the camera front end's interrupt behind EXP_MOVIE's frame events (4.2.3). With it, the
  next to read are TAKE_EXPOSE's token 15, RdyTrig2Wait taking command 7, RdyAbort's `0x501` and its tokens 5 and 7.
  793 and phase 111's exit are read in 4.1.12, where the session without the probe gets past phase 111 (S-TAKERDY)
  and waits, after S2, for TAKE's capture. Also open: S-SCPUDEV's `0x14`, and without the probe TAKE itself (4.1.8
  item 5).
  (S-SCPUDEV's `0x14`: closed 2026-11-11, 4.7.6.)

#### 4.1.11 Messages posted directly to module queues (2026-11-10; D unless tagged, addresses E143's)

S-MODACK takes what the application's API sender posts to a module queue and answers it (4.3.2; `docs/model-survey.md`
finding 99). This round enumerates the other posts to those queues, reads what the module's task does with each and
adds S-MODPOST, which takes those the task would take (`emu/src/lab/camapp.mjs` MODPOST_E143, E143 only;
`emu/test/test_modpost.mjs`).

- **The scan.** S-MODACK's 20 queues on E143 (the target table's 19 and PC_PD_CMD_EXEC) are named by their words in
  the static queue-id table (`0x600431c6`, id n at +2(n - 1)). A byte scan of the main block for the words' run-time
  addresses finds 661 reads, each a `movhu (abs32),Dn`: 286 of FILECLBK_UEXEC (its task runs natively, H-FILECLBK),
  76 of AUD_EXEC, LENS_EXEC, LENS_COMMAND and UI_OUT_EXEC (their tasks run natively by default and the queues leave
  S-MODACK), 299 of the 15 others. XTC_APP_EXEC, TFT_EXEC, FCS_EXEC and PWR_EXEC have none: only the target table
  names them, the answered path. A linear read from each of the 299 loads to its first call (branches not followed)
  gives 158 synchronous sends (the kernel's `0x5002e39d`, directly or through the API's `0x503ec094` and the modules'
  wrappers), which the lab's synchronous-send stand-in answers E_OK and nothing reaches a queue; 11 receives in the
  module's own task; 16 others (queue binds `0x5002c285`, TAKE's count `0x502ce6ae`, ref_dtq, error logs); and 114
  asynchronous posts, read by hand: four of them are synchronous sends after all (`0x5039fc93`'s jumps to `0x503a0484`,
  `0x51019c29`'s to `0x5101a010`), five not read or not sends (`0x50399f4a` branches to its function's two posts,
  `0x51807624` branches away, `0x5101d2c7` calls a stub that returns 0, `0x5002bfe8`; two at `0x51a70120` and
  `0x51a7021e` lie in code whose calls lead outside CPU 0's code, I: another core's image), and among the 16 others
  `0x5040f118` is a post (API 0x20014's kind 5, below): 106 posts. Two go through `0x5002e56e`, which posts with
  OlyQeWr and then waits on the caller's reply queue (ADJ_EXEC `0x5180e13d`, BC_EXEC `0x51036510`; not stood in for).
- **Who sends them.** Each post's function walked up its static callers (the firmware map's, five levels) to the first
  named module: only the API layer's direct senders (api_rec.c) and the TAKE function `0x503a05fb` that api_rec calls
  are reached from the application's code by calls; `0x503a091b` (TAKE_FUNC command 81) and API 0x20139 have
  callers there without a static call to them (`0x50aff95b`, `0x50abf03a`; I: function tables). The rest are the
  modules' own: the play module's 15 posts to PLAY_EXEC (`0x517d6b68..0x517f5454` through `0x517dd738`,
  `0x518b1e38..0x518bee7b` through `0x518bb57f`); TAKE's 16 to TAKE_EXEC (TAKE_FUNC_CP `0x503adade` / `0x503adc6f`,
  TAKE_PROXY's `0x503a9a59..0x503aa3f5`, `0x503a829b`, `0x50399e75` under the take command `0x50399cd3` (4.1.6),
  USR_FAST_APP's `0x501e7a22` / `0x501e86b1`) and its 32 to TAKE_FUNC; REC_EXEC_MAIN's 6 (TAKE's take-picture
  paths, rec.c), BC_EXEC's 9 (TAKE_FUNC_CP command 0's `{0x61, 2, 29 or 0, param}`, 4.1.1, and its stop sequence, TAKE's
  take-picture paths, `0x5013dd12`, `0x51805620`, `0x5180578c`, `0x51036510`), ADJ_EXEC's 1, MOVE_MAIN's 10 (the
  MOVE code, movp_if_move.c and `0x518e0902..0x518ef36a`), C3D's 4 (c3d_debug.c, `0x5101d316`, `0x5101dd67`) and
  PC_PD_CMD_EXEC's 2 (`0x5102b3f4`, `0x5102b470` through `0x51024657`). A module's own post comes only where its tasks
  run, and a module the lab runs leaves S-MODACK (I).

| Sender (callers) | Queue and message `{reply queue, token, command, parameter}` | Reached in the lab (X) |
|---|---|---|
| take API 0x200dc `0x50417cd9`, control 0x40 (`0x50417efd`; CapTak_Take's Take_Start_Shoot_Ready `0x50bc7b89`) | TAKE_EXEC `{0, 0, 5, 0}` through the API's direct post `0x503ebe46` | camapp 3, S2 in phase 102 (4.1.7, 4.3.2) |
| API 0x200ca `0x50416123` -> `0x503a05fb` (CmpSqp_SequencePartsBase `0x50c9d590`, at `0x50c9d778`) | TAKE_FUNC `{0, 0, 29, 0x62a3f2be}` through TAKE's send `0x502ce57b`, once (below) | camapp 3, the start, task 57 |
| API 0x20014 `0x5040f040`, kind 1, 2, 3, 4 / 5 (CapTak_Take `0x50bc8250..0x50bc82d4`, CapMov_MovieRecorderSLR `0x50bf19d3`) | TAKE_EXEC `{0, 0, 17 / 15 / 14 / 16, 0}` / TAKE_FUNC `{0, 0, 54, 0}`, `0x503ebe46` | no |
| API 0x2006b `0x50411caa` -> `0x50399cac` (no static caller) | TAKE_EXEC `{0, 0, 14, 0}` through `0x502ce57b` | no |
| API 0x200a0 `0x504148dc` (CapTak_Take `0x50bc8551`) | TAKE_EXEC `{0, 0, 19, 0}`, `0x503ebe46` | no |
| API 0x200eb `0x50418cdb` (CapTak_Take `0x50bc9c73`) | TAKE_EXEC `{0, 0, 20, 0}`, `0x503ebe46` | no |
| API 0x20071 `0x50411e33` (CapTak_Take `0x50bc79dc`) | TAKE_FUNC `{0, 0, 5, 0}`, `0x503ebe46` | no |
| API 0x20139 `0x5041c726` (`0x50abf03a`) | TAKE_FUNC `{0, 0, 37, 0}`, `0x503ebe46` | no |
| API 0x20030 `0x504100f2`, kind 1, 2, 3, 4, 7, 8 (CapCzm_CtrlZoom, OlyHfwOpeShoot, OlyHfwUserSettingManager, OlyHfwOpeLifTstSequence; kind 0 sends synchronously) | ZOOM_EXEC `{0, 0, 2 / 1 / 9 / 8 / 7 / 6, 0}`, `0x503ebe46` | no |
| `0x503a091b` (`0x50aff95b`), when its argument changes the byte `0x62a3f2ac`, the start-up flag is 1 and TAKE_FUNC's context bit 5 is set | TAKE_FUNC `{0, ?, 81, 0x603c1997}` through `0x502ce57b`: word 1 is what the stack held | no |

- **What the modules' tasks do with them.** None names a reply queue (word 0 is 0 at every sender above).
  TAKE_MAIN (`0x503996c3`), while its wait pattern holds TAKE_EXEC's bit 2, counts the queue (`0x502ce6ae`) and
  receives each message (`0x50399847..58`), runs its state's handler for the command, or for one the state lacks
  prints two debug histories (`0x502ce33f`, `0x502ce28b`) and logs errlog `0x25000e02`, then steps the state; a
  state whose pattern lacks bit 2 (RdyFcsRdy1, 4.1.7) leaves the message queued until a later one reads it.
  TAKE_FUNC (`0x502cd1ca`) receives every message and runs or rings it (4.1.1: 5 and 54 go on to TAKE_FUNC_CP). A
  reply to a request goes through `0x502ce619` (TAKE_FUNC's, and TAKE_MAIN's to S1's take request, X: the probe's
  record, 4.1.8), which sends nothing where the message's word 0 is 0 (`0x502ce61a`), as TAKE's other reply helper
  `0x502ce5e6` sends nothing to queue 0 (`0x502ce5e9`). So each TAKE_EXEC and TAKE_FUNC message above is consumed
  with no reply (I for a TAKE_MAIN handler that would reply otherwise: not read handler by handler). ZOOM's task
  (task 0x6e, ZOOM in the object-name table; entry `0x5038f842`, its static task record at `0x50018cac`) loops
  without exit: it receives ZOOM_EXEC with timeout -1 (`0x5038f862`), runs code for the message (`0x5038f869` ..
  `0x5038f8fb`, not read in detail, ?), and then replies `{status 0, token, word 3}`, S-MODACK's layout, to word 0's
  queue only where word 0 is not 0 (`0x5038f8fe`: word 0 = 0 jumps back to the receive; the send `0x5038f920`). So
  each of API 0x20030's posts above is consumed with no reply (D).
- **S-MODPOST** (E143) takes the table's TAKE_EXEC, TAKE_FUNC and ZOOM_EXEC posts but `0x503a091b`'s (eighteen;
  Open), matched by the queue (the body's apiQueues), OlyQeWr's return in the sender's wrapper (`0x503ebe71` in
  `0x503ebe46`, `0x502ce58c` in `0x502ce57b`) and the whole message: OlyQeWr returns E_OK and the message is not put
  in the kernel's queue; nothing the handler would do is done (I, as for S-MODACK's answers). `0x503a05fb`'s
  parameter `0x62a3f2be` is referenced there alone, and it posts once: it sets TAKE's start-up flag `0x62a3f2bc` to 1
  (and the halfword `0x62a3f2c0` to 63) first, and the byte's other absolute store is TAKE_FUNC's init's clear
  (`0x502cd039`). Any other post to one of S-MODACK's queues goes to the kernel's queue as before and is recorded with
  its message, sender and task; the blocked-send guard (`emu/src/lab/play.mjs` check_sends) then names them after the
  queue it reports full.
- **Result (X).** A probe of OlyQeWr over workloads under the three camapp modes: camapp 1 (passes of S1, S2, the
  menu and playback with right and left; menu navigation; the Super Control Panel and ISO; both dials; a movie at the
  mode dial's 7 with REC; LV to the EVF and a pass there; the card out and in; an HDMI plug; 20 s of idle) and camapp 2
  (the same up to the HDMI plug, which stops at S-TAKEOVER's scope) post nothing directly to S-MODACK's queues; camapp
  3 (the menu, the dials, idle, passes) posts the table's first two, each once. Before S-MODPOST
  TAKE_FUNC held one message from the start and TAKE_EXEC one from S2 on (ref_dtq's count, the control block's +52);
  with it no queue holds one. `test_modpost.mjs`: camapp 3's two posts taken and the player listing S-MODPOST; six
  further passes of S1, S2, the menu and playback, every S-MODACK queue empty after each; the control (the list
  emptied) leaves one message in each, named with its sender and task (57); camapp 1: six passes with no direct post
  and every queue empty; each API sender of the table run from the lab task, API 0x20030's six kinds among them, has
  its post taken; ZOOM_EXEC's command 3, which no sender of the scan posts, posted through `0x503ebe46` from the lab
  stays: ZOOM_EXEC holds one message, the second send waits and the guard reports queue 125 with the two posts and
  their sender `0x503ebe71` (7 of 7; units 16 of 16). Golden: unchanged (no default session posts directly; 240
  sessions identical), modelcheck's 31 runs pass.
- **Open.** What ZOOM's task does with a command (above, ?); `0x503a091b`'s TAKE_FUNC 81, whose word 1 is not set
  (TAKE_FUNC would take it, D; not listed); the `0x5002e56e` requests (ADJ_EXEC, BC_EXEC), which would wait on their
  reply queue; the other bodies, where S-MODPOST does not apply and their direct posts stay, recorded. The probe's
  camapp 3 workloads stopped at the mode dial's 7 (S-IOEXP), at LV at the card's removal and at an HDMI plug after
  the passes (module 9 reads outside S-TAKEOVER's list), so those inputs are not covered there.

#### 4.1.12 The second shot past phase 111 (2026-11-11; D unless tagged, addresses E143's)

4.1.10 left the second shot in phase 111 with TAKE native and in phase 102 without it. This round reads what takes the
sequence out of phase 111, finds why neither of the lab's sessions got past it, and fixes the lab's part. S-TAKEOVER's
scope now takes the sequence parts' two reads of module 9's state, and S-TAKERDY (`emu/src/lab/camapp.mjs`; control
camapp 3 without the probe, E143) follows S-MODACK's answer to the take-ready request with TAKE's event and leaves the
take-picture request unanswered. Three half-press shots in a row then end in STANDBY, with the menu and playback taken
between them; a full shot goes on to phase 106 and waits there for TAKE's capture, the unmodelled neighbour.
`emu/test/test_take_ready.mjs` takeReadyUnits (X, 7 of 7), takeReadySession (X, 16 of 16) and secondShotSession (X,
15 of 15, as before), `emu/test/test_camapp.mjs` traRoutingSession (X, 25 of 25) and `emu/test/test_modpost.mjs` (X,
16 of 16 and 7 of 7) pin what follows. Golden: unchanged (240 sessions identical); modelcheck: 31 of 31 runs ok.

- **The phases on this route (D; X: the callers of the phase setter `0x50cc6121` in the sessions).** 101 STANDBY (entry
  `0x50c89da1`), 102 (the READY entry `0x50c87e53`), 103 (`0x50c886e7`, on 794), 104 READY_TRIG2 (`0x50c88ae5`, which
  logs "entryREADY_TRIG2"), 106 (`0x50c8b218`; "execReadyTrig2after" `0x50c8974d` sets the second phase word
  `0x60364a20` to 106 first) and 111 END_WAIT (`0x50c86f31`, whose body logs "entryEND_WAIT createRecview" and
  "entryEND_WAIT restartThroughImage"). The names of 102, 103 and 106 are I (the state list of
  `docs/om1-shutter-spec.md` 2.3: READY, then its finish, TAKE_PICTURE).
- **What leaves phase 111 on the camera: TAKE's reply to the stop (D; X in the session without the probe).**
  - S1's release (827) enters END_WAIT, from phase 103 and from phase 102 alike (X, below). The entry sets phase 111
    and has CapTak_Take stop the take-ready (`0x50bc79e6`: the take API's control 0, TAKE_EXEC command 7 with reply
    queue 6, 4.1.10).
  - The API returns the request's token, so `0x50bc7aec` registers an observer for the answer: an event 428
    (`0x50ab705f`: +28 the token, +32 the receiver `this + 2656`, +36 the take API's address `0x50417cd3`) executed
    through the object at +2848. The system-transaction handler's `0x50af8df9` takes it (4.1.2's EVFW observer
    registration; X: its d0 is the token).
  - TAKE_MAIN answers command 7 with status 0. In Idle at once (`0x50399c0b`): `0x50399c1d` keeps the request's four
    words in its packet's +44..+59 and `0x50399c4f` replies `{u16 status, token, parameter}` to its reply queue (the
    status through `0x503b7053`, which passes it on while the error word `0x62a4b07c` is 0). In RdyTrig2Wait and
    RdyFastTrig2Wait `0x503c4047` goes to RdyAbort (state 9) with the packet; RdyAbort's entry registers `0x503c3e0f`
    (through `0x5039a5ad`), which goes to RdyEnd (state 10), and RdyEnd replies status 0: at `0x503c3f37` when a next
    request is queued (then RdyStart), else from its deferred `0x503c3fd6` at `0x503c4013` (then Idle). RdyFcsRdy1's
    `0x503c2f22` keeps the packet (`0x62a4ce60`) and goes to RdyFcsAbort (state 8) on a condition; its way to the
    reply is not read (?). RdyFcsRdy2, RdyFcsRdy3 and RdyFcsTake have no command table, so there the stop waits in
    TAKE_EXEC (4.1.10).
  - The reply on queue 6 goes, in the application's event task, to the observer
    CapTak_NotifyTakeReadyEndDoneObserver (`0x50bcb823`, called from `0x50af90f4`), which builds event 143
    (constructor `0x50be6e24`). CapTak_Take's reactive (state dispatch `0x50bca3cc` -> `0x50bca600`; table run-time
    `0x60e67230`, 23 ids in 119..422) takes 143 in case `0x50bca7ea`, which builds 793 (StopTakeReadyDone, at
    `0x50bca801`: one of 4.1.10's "other builders") and sends it to the sequence.
  - Phase 111's dispatcher takes 793 in case `0x50c6149a` (the controller's vt +8556, the thunk `0x50cc82b3` to its
    vt +3548, `0x50c9fa76`: its vt +4484 `0x50cac8f9` and vt +3552 `0x50c9fa90`, which builds the parts' own event
    1078 through `0x50cae2d5` at `0x50c9fcdb`) and then 1078 in case `0x50c61530` (vt +5324, the thunk `0x50ccbc3e` to
    its vt +416, `0x50c8d093`), which enters STANDBY: phase 101. The controller's vtable is run-time `0x60eb54f8` (X:
    the slots read in a session).
  - Phase 111's default case's callee (vt +5220, 4.1.10's ?) is `0x50ccbe73`, a bare return: S1 and its release do
    nothing in phase 111.
- **The symptom, session by session (X; the lab before this round).**

| Session | First shot | Second shot |
|---|---|---|
| TAKE native (`--take probe --cpu2 native`, 4.1.10) | S1: 826 in 101, phase 102, the take request, 794 after 66.7 ms, phase 103. Release: 827 in 103, phase 111, command 7 left in TAKE_EXEC (TAKE_MAIN in RdyFcsRdy3, pending `0x200`); no 143, no 793 | 826 and 827 in phase 111, its default case; no take request |
| no probe, S1 alone | S1: 826 in 101, phase 102, the take request, S-MODACK's status; no 794. Release: 827 in 102, phase 111, command 7, S-MODACK's reply, 143, 793, 1078, STANDBY's entry, where the lab stopped the session: "S-TAKEOVER scope: module 9 state read from ... `0x50c8a335`" | not reached |
| no probe, S1 and S2 (traRoutingSession) | S1 as above. S2: 824 in 102, the take API's control `0x40` (TAKE_EXEC command 5, S-MODPOST). Releases: 828 and 827 in 102, no take API call, the sequence stays in 102 | 826, 824, 828, 827 in 102; no take request; MENU refused (isCtrlReleaseEnable, Seq 102) |

  Correction to 4.1.10 and 4.3.2: "S1's release is event 827 in phase 102 and makes no take API call" holds after
  an S2 in phase 102 only. Phase 102's case for 827 (`0x50c5de4d`, dispatcher `0x50c5de00`) asks the controller's
  guard vt +452 (`0x50c8d721`): passed, vt +5620 (`0x50cc79b0`) goes to END_WAIT; after an S2 it refuses (vt +5624,
  `0x50cc79e1`; X). What the guard tests is not read (?; I: the sequence keeps the take-ready for S2's picture). So
  S1 released alone in phase 102 stops the take-ready as in phase 103, and S-MODACK's reply carried the sequence
  through phase 111; the session's stop was the lab's scope guard at the next step (X: the base commit's lab).
- **Causes (X unless tagged).** The candidates raised with the task do not hold: no stand-in on the route answers
  only once (S-MODACK answers every request it takes, each time); the stops reproduce in a session of the menu's open
  and close and one S1 alone, with no playback and no S2, so no state a playback pass left, no event it consumed and
  no completion of REC is involved. What holds:
  1. The scope guard (the top candidate, verified before any edit): on master the chain above ran to STANDBY's entry
     with S-MODACK's reply, and the stop was the entry's read of module 9's state (`0x50c8a32e`), which S-TAKEOVER's
     list did not hold. With the reader allowed for the experiment the session went on.
  2. Nothing finishes the take-ready without the probe (4.1.10): S-MODACK answers TAKE_EXEC command 0 with the status
     alone, where TAKE_MAIN also posts `0x04080032`. With the event posted by hand after the take request (an
     experiment) 794 came, the sequence went to phase 103, and three shots with the menu and playback between them
     ended in STANDBY.
  3. With TAKE native the stop is never read: TAKE_MAIN waits in RdyFcsRdy3 for TAKE_EXPOSE's token 15, behind
     EXP_MOVIE's wait on flag 21 for bit `0x1000` (`0x5056ba25`), the camera front end's event `0x300` (4.2.3, 4.2.5).
     That is the unmodelled neighbour; nothing changes there.

  The menu matters only in that its close starts the through image: CapThr's state word, which the S1 guard asks for
  (4.3.2), and the word `0x60364954`, which STANDBY's read asks for (below). Playback's return sets both too.
- **The sequence parts' reads of module 9 (D; X).** STANDBY's entry, while the word `0x60364954` is not 0
  (`0x50c8a31d`), reads the state (`0x50ab5780(9)` at `0x50c8a32e`): 3 is cleared (`0x50ab6299(9, 0)`) and skips the
  entry's through-image part (`0x50c8a339..0x50c8a345` -> `0x50c8a478`), any other state goes on (`0x50c8a348`). The
  word is `0x50cb032e`'s d0, the +32 of the record `0x50c9d590` passes it (calls at `0x50c9d714`, `0x50c9d762`; the
  function that posts TAKE_FUNC command 29 at the start, 4.1.11): 1 after the start, 0 while the menu or playback is
  open (from `0x50c9d71b`), 1 again at their return (from `0x50c9d769`) (X; I: the through image shown). At the
  start's and playback's return's own STANDBY entries the word is still 0, so they read nothing (X). What the entry
  reads on the way back from END_WAIT is 0, the components' own write (`0x50ca4ae1` at each through start,
  `0x50c78b0e` at PLAY; X: every read of the tests), not S-TAKEOVER's 2, which the start consumed (`0x50c78bb4`,
  4.1.5). No call writes 3 there: of the setter's 83 call sites ten name index 9, with 0 (seven), 1 and 2 (the boot
  take-over, `0x50ae0008`, `0x50ae0048`) and 4 (`0x50abd077`); a computed index is not excluded (?). The sibling: the
  through start `0x50ca435e` makes the same test (`0x50ca4a30`; not 3: `0x50cc3c25(1)` and the phase's `0x50cc6143`)
  while `0x50cbcd07` answers non-zero, reached by S1 pressed on the Super Control Panel's item (GUI `0x0418`): there
  too the lab stopped ("module 9 state read from ... `0x50ca4a37`", with or without a menu pass, X), and it reads 0.
  CMP_MODULE9_READERS gains both returns (`0x50c8a335`, `0x50ca4a37`): 17 of the image's 33 reads of index 9 are now
  listed, the other 16 not reached (X: no scope stop in the tests).
- **S-TAKERDY (control camapp 3 without the probe).** What TAKE_MAIN sends beyond S-MODACK's status for the take
  capability's requests to TAKE_EXEC through the API sender (TAKERDY_E143, take_ready_rule); with the probe TAKE_EXEC
  is TAKE_MAIN's and the stand-in is not reached.
  - *The take-ready: command 0 with the packet's kind 0.* The take API's packet (`0x503eb86c`) has +0 0, +4 the
    queue word `0x600431d0` and +8 the kind: 0 for a control the API does not list (CapTak_Take's `0x20`), 2, 1, 4,
    `0x2000`, `0x4000` and 3 for the controls 16, 8, 128, 512, 1024 and 2048 (`0x50417fcf..0x50418010`); control 256
    is command 6. TAKE_MAIN replies status 0 at RdyFcsRdy1's token 5 (4.1.8) and, at RdyFcsRdy2's token 13
    (`0x503c3214`), clears pending bit `0x1000` and posts `0x04080032` with parameter 0 to the queue the packet names:
    the word `0x62a4cef4` (`0x502ce5e6` at `0x503c3262`), which TAKE_MAIN copies from the packet's +4 on taking the
    request (`0x503c275c`, a2 the packet, X), not from the request's reply queue word; unless `0x506e6475` answers
    non-zero or the word `0x62a4cee0` is 3 (neither read, ?); X in the probe's session (4.1.8, 4.1.10), where both
    queues are 6 and the event's 12 bytes were `00000000 32000804 00000000` (its +2 half is not written: `movhu` at
    `0x502ce600`, D; 0 there, X). S-TAKERDY sends the two in that order, each followed by a settle: S-MODACK's reply
    to the request's reply queue, then `{u16 0, 0x04080032, 0}`, the same 12 bytes, to the queue the packet names when
    the request is taken (6). 794 is then built in the event task and taken in phase 102, 16.7 to 17.6 ms of lab time
    after the take request in the sessions measured (X; the native TAKE's: 66.7 ms). That the camera's take-ready
    ends without a wait is I: its AF and AE come between (TAKE_FOCUS's callbacks and TAKE_EXPOSE's `0x503`, 4.1.8),
    and S-RELSEQ's START_FOCUS and END_FOCUS still follow in the same step.
  - *The stop: command 7.* S-MODACK's reply is TAKE_MAIN's (above); nothing is added.
  - *takePicture: command 11* (api_rec `0x5040ee43`, 4.1.8). RdyTrig2Wait takes it (`0x503c40b2`); when TAKE_MAIN
    replies is not read (I: at the capture's end). The reply is the sequence's 791 (X: event 791 in phase 106 right
    after it; its builder is CmpSts_ObserverNotifyTakePictureDone's `0x50c7045e`). Answered status 0 at once, as
    S-MODACK would (the test's control), the rec view controller (CmpCtp_RecViewControllerParts `0x50c849d0` ->
    `0x50bdb01a`) reads the picture's record through api_play's `0x5040a86e` and divides its +704 by its +708, which
    is 0: DIVU at `0x50bdb830`, fault 6, the session's end (X). So the request is taken off the queue and not
    answered, and the sequence waits in phase 106.
  - A command 0 of another kind keeps S-MODACK's status alone and is logged (not reached, X). A test's control
    switches the stand-in off (`takerdy_on`): the session is then the one before this round.
- **What the sequence posts by itself (X: the callers of the shooting reactive's post `0x50af4451`).** At S1's READY
  entry CBS_START_SHOOTING_PICTURE (210, from `0x50af5214`) and CBS_START_READY (208, `0x50af4893`), on master too;
  with 794 CBS_END_READY (209, `0x50af480b`) and CBS_ENABLE_AFL (233, `0x50af4aa4`); at STANDBY's entry from
  END_WAIT CBS_END_SHOOTING_PICTURE (211, `0x50af4eb2`) and CBS_ENABLE_AFL again; at S2, entering phase 106,
  CBS_START_EXPOSE (136, `0x50af4d77`). S-RELSEQ's posts come beside them as before, so under camapp 3 a full shot
  gives the application START_SHOOTING_PICTURE and START_EXPOSE twice, and S-RELSEQ's START_SHOOTING_PICTURE at S2
  (I there) is not the sequence's, which posts it at S1 and END_SHOOTING_PICTURE at the return to STANDBY, with or
  without a picture. S-RELSEQ is every default session's and is left as it is.
- **Result (X).**
  - *Three shots (takeReadySession).* After the menu's open and close, three times: S1 is 826 in phase 101, phase
    102, the take request `{6, token, 0, packet}` of kind 0, S-MODACK's reply and S-TAKERDY's event, 794 from
    Com_EvSenderManager in the event task, phase 103; the release is 827 in phase 103, phase 111, the stop
    `{6, token, 7, packet}`, its reply, the observer in the event task, 143, 793 and 1078 in phase 111, phase 101,
    module 9 read as 0. After the first the menu opens and closes, after the second PLAY shows playback (No
    Picture: the card is empty) and returns, after the third the menu again; isCtrlReleaseEnable refuses none.
  - *A full shot.* S1 as above; S2 is 824 in phase 103, phases 104 and 106, and the take-picture request
    `{6, token, 11, packet}`, which S-TAKERDY takes (TAKE_EXEC holds nothing) and does not answer. No 791; 828 and 827
    are taken in phase 106 and change nothing. The picture on the card is S-RELSEQ's. MENU then reaches UI_IN and
    sets no GUI event, and isCtrlReleaseEnable is not asked, as in the probe's phase 111 (4.1.10; where the key is
    dropped is not read, ?). This is the furthest point: a second full shot is 826 and 824 in phase 106.
    A card switch's change is not handed to the media manager there either (4.8.12, X; merge fix 2026-11-12).
  - *The controls.* With S-TAKERDY off: S1 on the Super Control Panel's item returns to the shooting screen with the
    through start's read of module 9 (0); after the menu, S1 and S2 leave the sequence in phase 102 with the take
    API's controls `0x20` and `0x40` and no 794, and MENU is refused there (the table's third row). With the
    take-picture request answered at once: 791 and the rec view's divide.
  - *After playback of a card with pictures (traRoutingSession).* S1 makes the take request, S-TAKERDY's event
    brings 794 and phase 103, and the through image's histogram, which the menu's cmd 15 had stopped, runs again (X:
    no run between the menu and S1). PLAY with pictures on the card has left IMG1 enabled on the TFT channel (DMAEN
    `0x27`, bit 5; `0x7` on an empty card), and the VSC model refuses DISPLAY cmd 16's read of the bins of a run
    whose source plane was on (`0x501e153d`; A-VSCHIST-2 covers a plane that is off, 4.2.1): the session stops in
    S1's step. With S-TAKERDY off the same read stops it in the release's step, on the way to STANDBY (X). The test
    takes either end of that S1: the stop, or, where the read is modelled, the full shot's furthest point above.
    With the bins model of the round's histogram track (4.2.7) in a trial merge the second end is taken: no stop, the
    pass records its fourth picture, the take-picture request is not answered, phase 106, and MENU sets no GUI event
    (X: traRoutingSession 25 of 25 and takeReadySession 16 of 16 there).
  - *With TAKE native (secondShotSession)* nothing changes: the stop is not read and the sequence stays in phase 111.
- **Open.**
  - TAKE's capture: its reply to command 11 and what the sequence reads after 791, first the picture's record
    behind `0x5040a86e` for the rec view; then the notifications of 4.1.3 (790, 788, 787, 782) and S-RELSEQ's
    retirement (4.1.8's list). Until then a full shot under camapp 3 leaves the keys untaken.
  - With TAKE native: EXP_MOVIE's frame events (4.2.5), then RdyTrig2Wait's command 7 and RdyAbort's `0x501`
    (4.1.10).
  - The histogram's bins with IMG1 on (the stop of an S1 after playback of a card with pictures; counted since
    4.2.7, the second end above).
  - S-RELSEQ's callbacks beside the sequence's own under camapp 3 (above); the take-ready's time (I) and what
    `0x506e6475` and the word `0x62a4cee0` are; the kinds other than 0; RdyFcsRdy1's way from the stop to its
    reply; who writes 3 to module 9; what the READY state's release guard `0x50c8d721` tests; where a key is
    dropped in the phases 106 and 111.
  - The sibling question, not surveyed: which other requests S-MODACK answers with a status alone where the
    module's task sends more (a module event after its reply, as TAKE_MAIN does for the take-ready). On this route
    no stand-in answers once only (X: each take-ready and each stop of the three shots answered).

### 4.2 Sensor, ISP front end and live view (with EXP)

- **Tasks (D):** CPU 0: TAKE_FUNC's through commands 25 / 27 / 28 and their context bytes `through_s_wait` ..
  `through_start` (`0x62a3f2b4..0x62a3f2b8`, 4.1.2; the through permit `0x501c40d0` called at `0x5039f578`, the frame
  display mode `0x500256d9` at `0x5039f622`); TAKE_EXPOSE (its AE result writer `0x50596187`, called back, 4.2.2, writes
  the AE result objects `0xc12a` / `0xc0ba` / `0xc0ca`); EXP_MOVIE 0x58 `0x50553697` (states THROUGH_START ..
  THROUGH_LV_END, CONT_LVAE, `[EXP] AF_BV_18x18`); ISEQ_MAIN 0x44, ISEQ_ASIC 0x81; USR_FAST_APP 0x55 `0x501e673b`;
  PER_CCD_TEMP_MAIN 0x14. CPU 2: EXP_MOVIE2 0x2009 / EXP_MOVIE3 0x200a (EXP's, D, 4.2.2), MVR_IMG1 0x2005, MVR_IMG2
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
  | SSG1 (sync generator, I; +0xa00 the sensor's command unit, I, 4.2.6) | `0x9b000000` | 15, 16, 17, 18 |
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
  | cam.c, unknown | 26: `0x9b280000` through a RAM base word (4.2.5, correcting "RAM only"); 25 not read | 26, 25 |
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
  **S-HISTWAIT is retired**; S-HISTEND moves only the lab clock, as the vsync wait's RUN_TO_FRAME does. What ran next
  (udf07 in) stopped at the imgpro unit's start `0x5050a7a9` (4.1.5); the menu opens since 4.3.1. Default sessions
  do not start the histogram (camapp 1 and 2 leave HIST1 unwritten over the start, S1, S2, the menu and playback, X).
- **Open.** The TFT's composite stays FEATURE_UNOBSERVED once the histogram's registers are written (A13: whether
  they change the mixer output is ?; composed under the assumption A-VSCHIST-3 since 4.2.4);
  bins with an IMG plane on are refused, so a live view under camapp 3 would stop
  at its first end; the unit's real time per run (A-VSCHIST-1 sets only the lab's pace); the ring's reader (no literal
  of `0x62a3cab8` but the writer's, I: a computed address), what the application does with `0x04020301`, and what
  OSD_DRAW_CPU2 draws from the bins (4.6).
  The bins are counted since 4.2.7, which also reads where the bins go and the callers that name the event.

#### 4.2.2 The EXP callback and the AE results (2026-11-09; D unless tagged, addresses E143's)

S-EXPOSE sets the AE result objects `0xc12a` / `0xc0ba` / `0xc0ca` and runs the plan. This round reads the path from
TAKE_EXPOSE's AE request to the routine that writes them, runs it natively as far as it goes in a test
(`emu/test/test_expcb.mjs`, no lab option: golden unchanged) and maps S-EXPOSE's readers. None of the readers is
served natively, so S-EXPOSE stays (its text now gives the routine's role and the readers).

- **`0x50596187` is TAKE_EXPOSE's AE result writer, not a command handler.** It copies EXP's AE result record (a0)
  into eleven property objects through the setter `0x5004188b`: +0 `0xc12a`, +2 `0xc0ba`, +4 `0xc0ca`, +6 `0xc2ea`, +8
  `0xc2da`, +10 `0xc2ca`, +12 `0xc4ba`, +128 `0xc57a`, +196 `0xcdca`, +198 `0xcdda`, byte +208 `0xcdb1` (the data
  pointers TAKE_EXPOSE's init caches, `0x50591220` -> `0x502d03c1`). S-EXPOSE's text, 4.2's task row and shutter spec
  item 60 called it a command handler (4.1.6 found that wrong); they are corrected.
- **Who registers the callback.** TAKE_EXPOSE's launcher `0x505964e7` builds a 216-byte request on its stack: +0 the
  callback by kind (`0x5059757f` for 1280, 1281, 1289 and the default; `0x5059781d` for 1282, 1283, 1290, 1294;
  `0x5059794c` for 1293; `0x5059790f` for 2314 when `0x5059a629` answers nonzero; `0x5059787e`, which runs the plan
  but not the writer, for 1792, 1793 and some modes of 1285, 1295 and 2592; `0x5059798c`, which does not write either,
  for 1284, 1286, 1287, 1288, 1291, 1297 and 2315; none for 1794, 2816, 2314 when `0x5059a629` answers 0, and 1285 in
  the mode that puts `0x5059781d` at +20), +4 `0x505976da`, +8 `0x505977f6`, +24 the kind, +172 `0x505979a5` for
  2816; `0x50596af0` fills the rest. EXP's entry `0x505536be` takes it by kind - 1279 (the hashed
  table `0x606e0924`): 1280, 1289, 1792 and 2816, and thirteen more through `0x50553aa4` / `0x50553aed`, are posted by
  `0x50553942` to EXP_MOVIE (queue `0x17`: `{EXP_MOVIE_POST 0x18, 0, kind, request}`), and the caller's task waits on
  EXP_MOVIE_POST without limit. Kind 1281 runs `0x505539bc` in the caller's task instead: `0x5058bcd7` copies the
  request to `0x62abd65c` and keeps its callback at `0x62abd544`, which `0x5058bf17` (kinds 1283 / 1284, the caller's
  task), `0x5058c55e` and `0x5058e66f` (EXP_MOVIE) call later.
- **What fires it: EXP_MOVIE's handler, not an interrupt.** EXP_MOVIE (task 88, `0x50553697` -> loop `0x50572105`,
  started by USTART2's stage at `0x501e90f3`) copies the request to `0x62abca2c` (`0x50588266`) and dispatches by kind
  (`0x606e8264`); 1280, 1289, 1792 and 5122 go to `0x5058bd51` -> `0x5058c97c`. It answers EXP_MOVIE_POST once
  (`0x5057240c` -> `0x50585ccc`, status 0; the byte `0x62ab2fc8`, cleared for each message, keeps it to one answer)
  at the first of four places it reaches: `0x5058be40` (in `0x5058bd51`, when `0x5058c84a` answers 1), `0x5058cbb5`
  (when `0x50588e45(request + 196)` answers 1), `0x5058cbe7` (after the frame wait below) or `0x5058cd3f`; then it
  calls the request's +0 at `0x5058cdb7` with a 44-byte record: +0 a u16 status, +4 the AE result (EXP's frame slot
  with role 1, `0x5055e3f5(1)`: 8 slots of 560 bytes at `0x62a8dedc`), +8 a halfword, +20, +24, +32, +40. The
  status is 0 only when `(0x62abd550)` is 2 and the byte `(0x62abd558)` is 1, else 2 (`0x5058cd54..0x5058cd6d`). For
  kind 1280 the evaluation below sets the word to 2 when `0x5058c955(kind)` is nonzero (`0x5058d3ee` -> `0x5058d504`;
  `0x505882b3` clears it first) and clears the byte (`0x5058d487` -> `0x5058e43a`); after the frame wait
  `0x5058e47b` (`0x5058cc5b`) sets the byte (`0x5058e4e3`, `0x5058e4f1` -> `0x5058e467`) on conditions over the
  frame's result that are not read, so for this request the callback gets status 0 only after a frame step (I from
  the order). The callback `0x5059757f` writes when the status is not 2, the through mode's mask 1 (`0x62abd7a0`) is
  clear and bit `0x20` of TAKE_EXPOSE's state byte `0x62abd78a` is clear (what sets it is not read): under the
  semaphore `(0x60042e98)` the writer, then the plan take_expose_calculate `0x50597e82`, then the module event
  `0x04030020`; status 0 each time, another status at most once per 250 ms (`0x62abd78d`, a 250 ms timer to
  `0x505963ee`); in TAKE_EXPOSE's state 7 it calls `0x505963ba(+4)` instead. It also sets the object `0xce0a` from +8
  and calls `0x50598f22(+10)`.
- **Who sends the request on the camera.** TAKE_EXPOSE's command `0xa00` (case `0x50595964`; once, while its byte
  `0x62abd78b` is 0, else errlog `0x0e001f04`) copies the through start's 52-byte parameter (`0x50597a05`: the through
  mode to `0x62abd7a0` and `0xa33447f8`, the other fields to `0x62abd7a1..a8`; with the mode's mask 1 also EXP's
  live-view request `0x505538ee`) and launches kind 1280 in TAKE_EXPOSE's states 1, 17, 33 and 49 (command 0 sets 1).
  Its one sender (D: the senders that name TAKE_EXPOSE's queue word) is the through start: TAKE_FUNC command 25
  (`0x506d7f55`) calls `0x506d83f9` with d0 32 (`0x506d835e`), which asks TAKE_EXPOSE command 0 synchronously
  (`0x506d84cc`) and later posts `0xa00` (`0x506d8645`: reply queue TAKE_FUNC_POST `0x62`, token 1, the parameter from
  `0x506d8b0c` and command 25's own parameter; only while bit `0x400000` of that parameter's first word is clear,
  `0x506d85fe`); command 75 calls it with 128, which skips the send (`cmp 32` at `0x506d85f8`). The lab never reaches
  the through start (4.1.4). The other AE launches come from TAKE_EXPOSE's other commands and from `0x50591973`
  (TAKE_MAIN `0x503ad611`), `0x50591c6b` (`0x508eeb32`) and `0x50591d1a` (`0x509af437`); none runs in the lab (X).
- **What the handler reads.**
  - *EXP's evaluation runs on CPU 2.* `0x5058c97c` -> `0x5058d352` -> `0x5058d531` -> `0x50587cc7` -> `0x50587d8b` ->
    `0x505568c7(2, slot 4, ...)` builds a record at `0xa3343900` from EXP's frame slot with role 4 (`0x50555ef4`) and
    21 words of EXP's state, and `0x50556af4` hands `{0x50556995, record}` to EXP_MOVIE3's ring `0xa3344700`, posts
    `0x50573399(0x2002)` to CPU 2 (`0x50035afd`: CPU 2's flag `0x2002` bit `0x1000000`) and waits on EXP_MOVIE's flag
    17 `(0x60042f92)` bit `0x2000000` without limit. EXP_MOVIE3 (`0x200a`, entry `0x505536b1` -> `0x505731f1`) pops it
    and runs `0x50556995` -> `0x50556a09` -> `0x5058447e`, then posts `0x50573383(0x2000000)` to CPU 0 (`0x5057320c`),
    which sets the bit. EXP_MOVIE2 (`0x2009`, `0x505536a4` -> `0x505731c8`, flag `0x2001`, ring `0xa334460c`) serves
    EXP's other CPU 2 jobs (`0x5058391c`, `0x50589da2`). USTART2's stage starts both at `0x501e910e` / `0x501e912f`
    (4.2's task row had them as I). With a first argument other than 2, `0x505568c7` runs the evaluation on CPU 0.
  - *The metering data* is slot 4. What fills the slots is not traced; EXP's frame processing (`0x50586a86` ->
    `0x505829d6`) hands frames at `0xa332d2c4 + 2624 n` to EXP_MOVIE2's job `0x5058391c` (I: the ISP's AE statistics,
    4.2 seam B). In the lab the slots hold what EXP's init leaves.
  - *The white balance* (`0x5058c97c` -> `0x5056afe2(3)` -> `0x5056b07d` -> `0x5056b19a` -> `0x5056f0bb` ->
    `0x5056f101` -> `0x5056f1bb` -> `0x5039821c`, TAKE's arithmetic block) takes its gains from the table
    `0xa31f1bd0` (three blocks of 14 rows of four u16, 112 bytes each; the request's +2 picks the block through the
    map `0x605bdb36`: 0, 0, 1, 2), which IMG_PRECON's init `0x502a49b3` (USTART2's stage, `0x501e8ec0`) builds
    through `0x5039814c` -> `0x5039950e` from the preset objects `0xc5f2..` and `0xca92..` (their products >> 8). X:
    the first block all 0 in a default session, filled after the init.
  - *The frame events.* `0x5058bd51` -> `0x5056a6e4` prepares the camera driver's request record `0x62a98a0c`
    (`0x502a4a2e`) with EXP's frame callbacks `0x5056fd44`, `0x5056fd61`, `0x5056fff0` and `0x50570024`, and
    `0x5058c97c` -> `0x5056a873` gives it to cam.c's switch `0x502a4a46` as request 7 (`0x5056aa0e`); `0x5056fff0` ->
    `0x5057004e` sets per-frame bits (the mask `0xff000`) of EXP's flag 21 `(0x60042f9a)`, `0x5056fd61` its bit 4
    (`0x5056ffe6`), `0x5056fd44` its bit 8, and `0x5058c97c` waits for its bits before the callback (`0x5056ba07` ->
    `0x50585dc2`, without limit). EXP_MOVIE's loop also gives cam.c a request 8 for each message (`0x5056a527` ->
    `0x5056c06c`, X).
- **Run natively (X, `test_expcb.mjs` expCallbackSession).** Camapp 1 with `--take probe` and `--cpu2 native`; the test
  brings up what USTART2's stage runs (IMG_PRECON's init, EXP's init `0x50553649`, EXP_MOVIE, EXP_MOVIE2 and 3 through
  the cross-core start `0x5002c546`; each init returns 0 and touches no device), makes EXP's queues native in the probe
  and posts TAKE_EXPOSE `0xa00` with a parameter of zeros whose byte 0, the through mode, is 0 or 1 (the values the mode
  table `0x5059f204` holds; I), one session each. In both, the request reaches EXP_MOVIE as kind 1280 with the callback
  `0x5059757f`, CPU 2 runs the evaluation and posts its end back (task `0x200a`), and EXP_MOVIE goes on to the white
  balance. Mode 0: the white balance ends, cam.c's switch answers requests 8 and 7 with 0 and logs `0x0a103000` and
  `0x0a283000` (its own init does not run, 4.1.4), no frame callback runs and EXP_MOVIE waits on flag 21 for bit
  `0x1000`. It has not answered EXP_MOVIE_POST: `0x5058c84a` answers 2 and `0x5058c963` 0, so its answer is the one
  after that wait (`0x5058cbe7`), and TAKE_EXPOSE stays in its receive at `0x505539af`, taking no other command; the
  status inputs `(0x62abd550)` and `(0x62abd558)` are 0 and 0. Mode 1: the white balance takes kind 5 of `0x5039821c`,
  which fills the words its request's +24 and +28 point to from the table (X: 260 and 231) and calls `0x50398a55`.
  That scales four interpolated values by the words the request's +24 .. +36 point to (`0x50398aee..0x50398b62`),
  writes the products back through them (`0x50398c16..0x50398c7f`) and divides the larger of the +32 and +36 products,
  << 7, by the smaller (`0x50398ca5` / `0x50398cbc`). It stops at `0x50398ca5` (fault 6) with both operands 0: +32 and
  +36 point to `0x5056f1bb`'s locals (sp+16) and (sp+18), which it never writes before the call and does not read
  after it (D; X: 0 and 0 at `0x50398a55`'s entry). On the camera they hold whatever EXP_MOVIE's stack held there (I),
  and a divide by zero the CPU leaves undefined, where the lab stops (`emu/FIDELITY-NOTES.md` 3.2). It is the same
  divide the EXIF set stops at (4.1.4); whether for the same reason is not read. Through mode 1 would not write the AE
  results through this callback anyway: the mode lands in `0x62abd7a0` (X: 1), whose mask 1 makes `0x5059757f` skip
  the writer (`0x505975ba`). In neither mode does the callback or the writer run. Without `--cpu2 native` the post to
  CPU 2 is an unserviced doorbell; without IMG_PRECON's init mode 1 stops at the same divide (X).
- **S-EXPOSE's readers (X, `test_expcb.mjs` aeReadersSession: a default camapp 1 session, S-EXPOSE again, an idle, a
  live view, S1, S2, the menu twice, P -> A and playback).** (1) The plan's reader `0x50598688` (gets at `0x505986c4`
  `0xc0ca`, `0x505986f2` `0xc0ba`, `0x50598721` `0xc12a`), from S-EXPOSE's own call and natively 5 times at the mode
  change, through the application's API `0x20009` (api_rec `0x5040e8c7` -> TAKE's `0x5039f656` -> `0x50597dc0`, which
  calls the plan under the semaphore `(0x60042e98)`). (2) The application's get by index `0x503ee3c8` for 4011, 4012 and
  4013 (`0xc0ca`, `0xc12a`, `0xc0ba`: the id list `0x606239e4 + 2 (index - 4000)`, `0x503ee4f0`), once each at the mode
  change, from `0x503eeba1` (callers `0x503c8127`, `0x503d37dc`, `0x503d455e`, `0x503d458a`, `0x519c8530`; which of
  them, and what it does with the values, is not read). Nothing else reads them and only S-EXPOSE sets them. Not reached
  (D): takepic's `0x503bcd51` reads `0xc0ba` (at `0x503bcecb`, the take's record); `0x502d03c1` caches the data
  pointers. An immediate scan of the main block's code finds the three ids only in those four functions. Section 3.2's
  EXP row ("only the plan ... runs, under S-EXPOSE and H-AEINIT") misses the plan's native runs at a mode change.
- **What retiring S-EXPOSE needs, in order (I; Claude wall-clock).** (1) The trigger: the through start natively,
  that is TRA 991 to the shooting component and CapThr (4.1.2, 4.1.7) and command 25's parameter. (2) EXP's bring-up
  as the stage runs it, the four steps above (device-free, X): an H- step of a few hours once (1) is there. (3) The
  frame events: cam.c's init and request 7's callbacks on the sensor's frame timing (4.2 seam D), or a stand-in at
  those callbacks paced by the lab clock: days. They also free TAKE_EXPOSE, which waits for EXP_MOVIE's answer until
  then. (4.2.3: the first init runs, H-CAMINIT; the callback the wait needs, event `0x300`'s, is fired from the
  driver's front end, whose interrupt is not read, so no stand-in calls it.)
  (4) The metering data: EXP's slots from the ISP's AE statistics (seam B, 3-5 weeks). (5) The status: the
  frame step `0x5058e47b` must set `(0x62abd558)` and `0x5058c955(1280)` must answer nonzero (neither read), or the
  callback gets status 2 and skips the writer. The divide by zero blocks only through mode 1, whose callback does not
  write (above); where mode 1's AE results come from, if anywhere, is ?. Then the callback writes the objects and the
  plan's and the index get's reads see the firmware's values.

#### 4.2.3 The camera driver and the frame events (2026-11-10; D unless tagged, addresses E143's)

Two tracks stopped at the same place: S1's TAKE_EXPOSE `0x500` posts `0x509` to EXP_MOVIE and waits (4.1.8), and
EXP_MOVIE calls the AE result writer's callback only after a wait on its flag 21, whose bits the camera driver's
request-7 callbacks set (4.2.2). This round reads cam.c's inits, its request switch and request 7 down to what fires
those callbacks, runs its first init natively (H-CAMINIT, every `--take probe` session) and EXP as USTART2's stage
brings it up (H-EXPINIT, `--take probe` with `--cpu2 native`; `emu/src/lab/take.mjs` round 4, off by default, golden
unchanged). The interrupt that fires the events is not identified, so no stand-in raises them: EXP_MOVIE waits (X).
`emu/test/test_take_release.mjs` focusSession (X, 11 of 11), `emu/test/test_expcb.mjs` expCallbackSession (X, 17 of 17)
and camDriverSession (X, 7 of 7) pin what follows.

- **Two inits.** USTART calls cam.c's first init `0x502a49ec` at `0x50024aa2` (before the lens init at `0x50024ab6` and
  TAKE_FUNC's at `0x50024c2d`) and its second `0x50155357` at `0x50024d80` (it then starts USTART2's stage task,
  `0x50024d9b`: task 40, entry `0x501e8e84`, X). The first: `0x501504c0` (the error log's state `0x62988868`), `0x501529dc` (four free lists through
  `0x50152f14`, of 200, 100, 13 and 4 entries; the first is the request pool, head `0x6299726c`, its base words
  `0x629a71dc..e8` set here), `0x5015368b`, `0x50154a12` (`0x501536b4(1)` and the timer code `0x50064323` with 8 and 9),
  `0x50150f69`, `0x50154704`, `0x50152f4c` and, when that returns 0, `0x50152495` (`0x50150f8e(6, 1)` to `0x62997268`,
  the instance the sequence items of `0x501524c0` go to). X: it returns 0, logs nothing, creates no kernel object and
  touches only the interrupt controller (IRQs 146 and 147, which already carry the timer block's handlers); it builds
  the request pool: its base word `0x629a71dc` goes from 0 to its block and the free list's head from 0 to 2 (the init
  takes two entries). Correction to 4.1.4 (D, X): before the init that pool was not empty (an empty list's head is
  `0xffff`, whose path logs `0x0a163000`, `0x50152af8`) but not built: with the base word 0 the allocator `0x50152a63`
  hands out base + 128 x head, address 0, which request 148's handler takes as a failed allocation (`0x502a4c04`,
  `0x0a103000`). The second makes ten calls, the first seven unconditionally (only the seventh's result is kept) and
  each of the last three only while the call before returned 0 (`0x50155380..0x501553a3`): `0x50152401`,
  `0x50150b66`, `0x501550bc`, `0x50151d07` (the named-queue registry `0x6298b240` cleared), `0x5015f38f`, `0x501a3559`,
  `0x5019c70f`, `0x5019868e` (cam_seq_movie.c's init: its queues SQMV, MQEX, INFN and SMFM registered through
  `0x50151d1b`), `0x5019813d` and the front end's init `0x5016efcd`, then `0x501536b4(13)` (kept at `0x629a7af0`,
  request 151's), `0x50167b16` and `0x50156519(0, 0)`. The front end's init attaches the units' interrupts (the SSG's
  15-17 at `0x5019f621` and 18 at `0x5019d733`, SLVS 243-247 `0x5019e49e`, PRO 27-31 `0x501916ec`, AE / AWB 32-37
  `0x501587b3`, AF 38, PFP 39, the clock block's 40, DMA 41 / 42, `0x9b180000`'s 24 and 4.2's "cam.c, unknown" 26 at
  `0x50156666`, handler `0x50156528`) and builds the front end's callback table (below). X: the first nine calls return
  0 and touch no device; the front end's first writes are `0x98800340` (kept by the lab stub) and the camera clock gate
  `0x9b500800`, which the lab stub refuses. So the first init runs as H-CAMINIT and the second does not (since 4.2.5
  it runs as H-CAMINIT2 against S-CAMFE behind the probe's `cam_fe`).
- **The request switch** `0x502a4a46`: ids 5..152 through a hashed table at `0x602c651c` (32 slots {id - 4, case}; X:
  read in the lab). 5 `0x5015553b`, 6 `0x5015552a`, 7 `0x5015541d`, 8 `0x501556fb`, 17 `0x5015572e`, 134 `0x5015573a`,
  137 `0x5015575c`, 152 `0x5015574b` run in the caller's task; 13, 15, 16, 144, 145 and 148 are posted as deferred calls
  (`0x500504aa`: `0x5015554c`, `0x501555df`, `0x5015566d`, `0x5015582d`, `0x501558b8`, `0x502a4b74`); 151 calls
  `0x5015373a` with `(0x629a7af0)`; 130..132 return 0; any other id logs `0x0a103000` (`0x502a4b52`).
- **Request 7.** Its record (EXP's `0x62a98a0c`, built by `0x5056a6e4`): +0 the id, +4..+20 five pointers into the
  record, +72 the completion, and from +76 one slot per event: the callback for event `n << 8` at +76 + 4 (n - 1), its
  mask at +128 + 4 (n - 1), n 1..13. EXP's: +72 `0x5056fd44`, +80 `0x5056fd61` (event `0x200`, mask 1), +84 `0x5056fff0`
  (`0x300`, mask 3), +88 `0x50570024` (`0x400`, mask 2). So 4.2.2's four frame callbacks are request 7's completion and
  three event slots. The handler `0x5015541d`, under the lock `0x50053ebe(2)`: with +68 set `0x50155cfb`; else with +64
  set `0x50155c28(7, ...)`; else, when the word +16 of the block +12 points to has none of the bits `0x7f08` (EXP's
  case, X), `0x501563c9` and `0x50155b2b(1, 0x50155de8)`, which takes a 136-byte item from the pool, copies the record's
  +76..+179 into its +8..+111, sets +116 the notifier `0x50155e66`, +120 the callback and +124 the record, and hands it
  to cam_seq_movie.c's dispatcher `0x501987cd` (kind 1, `0x50198993`: a 136-byte copy posted to INFN and a message to
  SQMV through `0x50151e45`). The notifier (d1 a mask, a1 the event or'd with a kind 1..4) calls the slot of the event
  when the slot's mask and d1 share a bit (`0x50155ed3`: the cases through `0x6022562c`; `0x50155f03`, `0x50155f63`,
  `0x50155f82` for `0x200`, `0x300`, `0x400`); `0x50155de8`, `0x50155e12` and `0x50155e3c` call the completion. X with
  H-CAMINIT alone: requests 8 and 7 are accepted (no `0x0a103000`), and the movie sequence's queue lookups fail:
  `0x0a283000` three times (the queue count `0x50151ffc` once, line 1032, in request 8's dispatch, kind 3,
  `0x501556fb` -> `0x501987cd`; the post `0x50151e45` twice, line 487, in request 7's, kind 1). With
  the second init's first nine calls run as well (an experiment, not pinned), the posts succeed and nothing else happens
  in 300 ms.
- **Who fires the events (D to the front end; ?).** Event `0x200`: the movie sequence, `0x501999f4` at `0x50199a3d` (the
  notifier of the INFN copy with `0x202`, when its +64, the record's `0x200` mask, has bit 1), reached from the
  dispatcher's kind 10 (`0x50199383` -> `0x5019981d`). Events `0x300` and `0x400`: the front end. The movie sequence
  gives it 144-byte kind-7 requests (`0x501984e7` from `0x501981ae`, request 7's other branch; `0x5019c498` from kind
  10's `0x50199f42`; corrected in 4.2.5: `0x501984e7` is cam_seq_dram_capture.c's, and `0x5019c498` and two more
  builders are reached only from the frame step) carrying the item's slots and masks at +24.. and a wrapper at +128
  (`0x5019862f`, `0x5019c69c`)
  that calls the item's notifier with the event or'd with kind 4 or 2. The front end's entry `0x5016f2ae` (`0x5016f2da`
  -> `0x5016f5a6`) fills a context (I: one of the 15 of 32476 bytes from `0x629aa520`, by the same offsets): the record
  +2464 for `0x300` (mask +48 from the request's +84, enabled +64 while bit 23 of the context's event mask is set) and
  +2532 for `0x400` (+88, bit 24). Their +44 callbacks, `0x5017078f` (`0x300`) and `0x501707c0` (`0x400`), come from the
  table the front end's init builds on its stack (entries 30 and 31) and `0x50172466` writes into each context. The
  units' per-bit handlers call a record's +44 with its +48 mask (cam_bright.c's, the table `0x6022575c`, e.g.
  `0x5015db6d`); which handler takes the records +2464 and +2532, and so which interrupt raises `0x300` and `0x400`, is
  not read (?). (4.2.5: the handlers pass their own bit and'ed with the mask; the records' units are AE1 and AE2, IRQs
  32 and 33, and no handler found passes `0x300` to EXP, ?.) The SSG's handlers (15-17 `0x501a2478`, `0x501a24c2`,
  `0x501a250c`; 18 `0x5019e218`) read their status
  at `0x9b000004..0x9b000020` (18: `0x9b000604`) and run per-bit one-shot lists (`0x501a26d6`, `0x501a272d`, ...), whose
  writers are not read. So the frame events come from the front end's interrupts (I), which the lab neither attaches nor
  models, and no stand-in raises them.
- **S-TAKECAM stays (X, camDriverSession).** Natively, with the first init, requests 148 and 144 are accepted, deferred
  (`0x502a4b74`, `0x5015582d`) and each queues an item of the engine (`0x501524c0`), touching only the interrupt
  controller and the deferred-call triggers; neither completes in 100 ms. Request 6 logs `0x0a273000` (the engine
  instance code `0x501536b4..0x5015382c`) until the second init's first nine calls have run, and is then deferred
  (`0x50153844`) and queued without completing. So S-TAKECAM keeps answering TAKE's requests; EXP_MOVIE's go natively.
  (4.2.6: request 6 is the sensor's power-on; the test's argument 1 queues that item, TAKE_FUNC_CP's start passes 0.)
- **H-EXPINIT (X).** After H-TAKENBINIT, with `--cpu2 native`: IMG_PRECON's init `0x502a49b3`, EXP's init `0x50553649`,
  EXP_MOVIE (task 88) by act_tsk and EXP_MOVIE2 / 3 on CPU 2 by OlyTaSt, as test_expcb.mjs did by hand (4.2.2); EXP's
  queues 0x17 / 0x18 then go natively. The stage runs IMG_PRECON's init before TAKE_MAIN's and EXP's before
  TAKE_EXPOSE's start (I: no difference, TAKE_EXPOSE waits on its queue). EXP's init includes H-AEINIT's table init
  `0x50560b29`, which so runs twice; what the second run changes is not read (?), and the tests pass with it (X).
  EXP_MOVIE2 / 3 join `cpu2.mjs` CPU2_TASKS for the step's two starts only (the map is the process's, and a later
  session in the same process must not inherit them).
- **S1 (X, focusSession: camapp 3, `--take probe --cpu2 native`).** As in 4.1.8 to RdyFcsRdy3's TAKE_EXPOSE `0x500`;
  then TAKE_EXPOSE's `0x509` (kind 1289) reaches EXP_MOVIE natively, which gives cam.c requests 8 and 7 and waits on
  flag 21 for bit `0x1000` (`0x5056ba25`), the bit `0x5056fff0` (event `0x300`) sets. It does not answer EXP_MOVIE_POST,
  so TAKE_EXPOSE stays in its receive. RdyFcsRdy3 also asks TAKE_FOCUS `0x400` RELEASE_IDLE_START (token 4, replied
  natively): TAKE_MAIN stays in RdyFcsRdy3 with the pending bits `0x200` (TAKE_EXPOSE's token 15). The sequence takes
  event 794 (TakeReadyFinish) in phase 102 66.7 ms after S1, after TAKE's event `0x04080032` (RdyFcsRdy2) and
  TAKE_EXPOSE's post and before TAKE_FOCUS's `0x400`: correction to 4.1.8's experiment, 794 does not need RdyTrig2Wait
  (I: it follows `0x04080032`; D and X in 4.1.10). No frame callback, answer or AE result write runs, so S-EXPOSE's
  readers are as in
  4.2.2. Since S1: `0x25001703`, `0x0f803003` (4.1.8), `0x0f833000` once (`0x5090afde` in `0x5090af48`, from the AF
  library's `0x508c10c1`; why is ?), cam.c's `0x0a283000` three times, besides the frame-rate warning `0x39000903`
  (4.1.4); to the lens only its state poll `c1 80`.
- **S2 (X).** Event 824 in phase 103, as in 4.1.8's experiment; then the lab stops. The application's synchronous
  DISPLAY command 15 (sent from `0x503ec117`) runs, the GUI's command 17 (from `0x507f66d1`) runs nested in it and
  returns, and then, while command 15's run is still in progress, task 168 (entry `0x5115ba0c`) posts DISPLAY command
  18 (reply queue 6, token `0xf0080000`) through the application's API sender (`0x503eba07`), which S-DISPQ does not
  stand in for inside a DISPLAY run (depth 1). TAKE takes nothing. The stop is the lab's; what command 18 does there
  is not read. (The lab before 4.1.9, which found the nesting the lab's: S-DISPQ keeps such posts since, and S2's idle
  stops at S-SCPUDEV's `0x14`; taken since 2026-11-11, 4.7.6: no stop.)
- **Next (I; Claude wall-clock).** (1) The consumer of the records +2464 / +2532 read to its interrupt (half a day to a
  day); if it is a unit whose status the lab can raise from its frame clock, an S- stand-in at that interrupt, with the
  front end's init (its devices) as the cost (4.2 seam D). (2) Then EXP_MOVIE's answer, TAKE_EXPOSE's token 15 and
  RdyTrig2Wait, and S2's TAKE_EXPOSE `0x600` (4.1.8). (3) S-DISPQ's nested post at S2 (a lab change, hours). (1) is
  read in 4.2.5 (no interrupt found), (3) done in 4.1.9.

#### 4.2.4 The TFT composite under camapp 3 (2026-11-10; D unless tagged, addresses E143's)

Under `control camapp 3` the TFT's composite was refused from the components' start on (4.1.5, 4.2.1, 4.3.1), so no
camapp 3 session had a frame. This round finds what the compositor refused, settles enough of it to compose, takes
camapp 3's frames and compares them with camapp 1's. The default stays camapp 1.

- **What the compositor refused: the histogram unit's six registers, nothing else (X).** At the shooting screen (1 s
  after the start) COMPOSE of channel 2 is FEATURE_UNOBSERVED with exactly six errors, A13's never-written class
  (`docs/om1-vsc-spec.md` section 7): HIST1 `0x04c` = 1, HISTAREA1 `0x474` = `0x01f20064`, HISTAREA2 `0x478` =
  `0x010f004b`, HISTAREA3 `0x47c` = `0x10f`, HIST2 `0x748` = `0x00100112`, HIST3 `0x74c` = `0x004008bc` (the spot
  area's run). Over a start, 2 s of idle, S1, S2, the menu, its close, PLAY and its return the firmware writes them
  only on channel 2, 89 set-ups, with the values HIST1 0 and 1, HIST2 `0x100002`, `0x100012`, `0x100112`, HIST3
  `0x400000`, `0x400116`, `0x4008bc` and the two areas' HISTAREA1-3 (X). With them accepted the next refusal was the
  harness's IMG edge guard at the menu (below).
- **Their writers (D).** An immediate scan of the main block for the six addresses (`0x9bb8004c` .. `0x9bb8074c`, and
  their mirror copies) finds them only in the unit's driver: the set-up `0x501e127f` (HIST2 at `0x501e1378`, then
  `|= 0x10` at `0x501e1406` with a clip and `|= 0x100` at `0x501e1438` with a scale; HISTAREA1 `0x501e1396`, HISTAREA3
  `0x501e13c6`, HISTAREA2 `0x501e13f6`; HIST3 `0x501e141b` and `0x501e144e`; HIST1 `&= ~0xf` at `0x501e142b` and
  `0x501e145e`), `0x501e1488` (HIST2 `= (HIST2 & ~0x03000000) | d1 << 24` at `0x501e14a0`; its callers pass 0,
  `0x501d6e01`, and `(a3 - 1) & 0xffff`, `0x501d6fd8`, whose value is not read),
  the start `0x501e14a4` (HIST1 = 1 at `0x501e14c8`)
  and the readers `0x501e1462` (HIST2) and `0x501e150e` (the bins, the mirror's HIST3). None of the 63 calls of the
  generic writer `0x501e2ce6` passes their word indices (19, 285-287, 466, 467; the indices passed are 1, 2, 4, 12-14,
  224-227, 246, 316-319, 321-325, 327, 360, 362-365, 408, 426, 436-438, 441-444 and 456-463). The set-up's two callers
  (`0x501d6df7`, `0x501d6fca`) and the start's (`0x501d6ea6`, `0x501d7083`) lie in the start path `0x501d6bec`. A store
  through a computed address would escape both scans (I: none is known).
- **Settled: the unit measures, and the camera's histogram is drawn by software (D, X).** Each field whose formula is
  read is a measurement parameter: the bin count's code, the area in output coordinates, the clip of a bin's value
  (which `0x501e150e` applies again to the bins it reads), a scale `(((0x62a3eac8) >> 3) << 16) / (w * h)` for an
  area of w x h pixels, at most 8190 (the start path, `0x501d6d87..0x501d6db1`), the source plane by its DMA address
  (`docs/om1-vsc-spec.md` section 13); none names a colour, a level or an output plane. HIST2 bit 20 (always set),
  HIST1[3:1] and `0x501e1488`'s field are not understood (?). Its result goes to
  the CPU (the bins at `+0x4000`, read by cmd 16), and the histogram the shooting screen shows is drawn from those bins
  by CPU 2's OSD_DRAW_CPU2 into GUI layer 1's buffers (4.6.2, X), which the compositor already draws as OSD2. A53 /
  Linux: the A53 is the network and maths coprocessor and has no display driver (`docs/a53-spec.md`), so it says
  nothing about the VSC. **Assumed (A-VSCHIST-3, I):** the unit adds nothing to the mixer output. Its registers in the
  forms of their writers leave the composite unchanged: HIST1 0 or 1; HIST2 bit 20 with the bin count's code, the clip
  and scale bits and a source plane 0..2, with bit 12 (two-field) and bits 31..24 clear; HIST3 any; HISTAREA1 and
  HISTAREA2 a non-empty area inside the window; HISTAREA3 HISTAREA2's y. Any other value stays FEATURE_UNOBSERVED.
  It is an opt-in of the compositor (`emu/src/dev/vsccompose.mjs` histForm, CH_ASSUME bit 4) that camapp 3 sets on
  every channel; each composite that uses it carries header ASSUMED bit 4 and an ASSUMED note per register, the debug
  word `0x038` counts them, and the player lists A-VSCHIST-3. Default sessions never write the registers (4.2.1, X).
  What would settle it: a photo of the TFT while a run is on next to the lab's composite of the same latched state;
  no firmware path draws the unit's own output, so the code cannot.
- **The menu's IMG2 plane (X, D).** Past the histogram the menu's frame stopped at the harness's IMG edge guard (A6,
  `docs/om1-vsc-spec.md` section 8): reason 1, IMG2 drawn with no recorded attach. The menu shows the through image's
  bank as IMG2: DISPLAY cmd 5 with an IMG2 handle (the format setter `0x501e1e95(2, 0, plane 1)` returning to
  `0x501da3bd`; img[1] = `0x98d4d800` in the commits from `0x501da63d`, `0x501dabb2` and `0x501da7e5`), DMAEN `0x17`,
  with the geometry the open left (900 x 600 at the window's origin, stride 11136, DMABN `0x78`, RSZ1 0). It is the
  rectangle the imgpro unit's fill writes just before (4.3.1: Y 11, Cb and Cr 128), which is the background's colour
  {11, 11, 11} (`docs/om1-vsc-spec.md` section 4): the composite without IMG2 (the lab's view mask) is the same word
  for word (X). The plane stays on after the menu's close and goes at PLAY. Unscaled, it fetches one source pixel per
  output pixel, so A6's question (a second tap past the source) does not arise: the guard now passes an IMG2 or IMG3
  latched with RSZ1 bits 0 and 4 clear (`emu/src/lab/display.mjs` unscaled). IMG1 keeps its attach rule (its 1:1 on
  channel 2 rests on A12, and check_liveview pins its reason 1 after DISPLAY cmd 5).
- **Camapp 3's frames against camapp 1's (X; the same keys with 100 ms held and 800 ms after, no live view, the
  native lens).** Every difference is in GUI layer 1 (OSD2's buffer bytes and the composite differ at the same pixels)
  or in IMG2's plane, which draws the background's colour:
  - *Shooting screen* (start + 2 s; also after the menu's close and after PLAY's return): 1,655 pixels in x 417..894,
    y 72..334. Camapp 3 shows MF where camapp 1 shows S-AF, and no AF target brackets. Cause: setting 535
    (MODE_AF_CHANGE) is 1 in camapp 3 and 0 in camapp 1; set to 1 in a camapp 1 session (`SET:535=1`) the shooting
    screen is camapp 3's word for word. Camapp 3 sets it at 2.77 s of lab time through the setter `0x503c6511` from
    `0x503c49fd` (return chain `0x50ab51f0`, `0x50adfc16`, `0x50b530c1`, `0x51054474`: the application's
    initLeverSwitch, from the Fn lever; the three words named here before were log strings, 4.3.7), and camapp 2 does
    the same at PLAY's return (from then on its shooting screen is camapp 3's). Camapp 1 never does: OlyHfwOpeShoot
    writes it only while the sequence parts stand by (4.3.7). S1 (600 ms, no live view) changes no frame in either.
    Since 2026-11-11 (4.3.8) the lab's idle lever is at API_LEVER_SW_1 and camapp 1 has the gate's stand-in: the two
    shooting screens are the same, S-AF, and both show MF with the lever at API_LEVER_SW_2.
  - *MENU*: 4,602 pixels in x 38..871, y 283..327: the movie Card Slot Settings row is available in camapp 3 and
    greyed in camapp 1 (camapp 2 greys it too). Not caused by the scalar settings that differ: 17 do after the start
    (19, 51, 53, 112, 535, 678, 1245, 1247, 1256, 1259, 1261, 1627, 1628, 1649-1652; camapp 2 has 11 of the 17 values,
    and 535, 1627 and 1628 after PLAY's return), and set to camapp 3's values in camapp 1 (19, 678 and 1256 one at a
    time, and every settable one together) they leave its menu unchanged (1259 and 1261 are 85, which their descriptor
    lists do not hold, and equal in camapp 2). What decides the row: both slots' media flags 15261 and 15262, which
    have no descriptor (4.3.7). IMG2 is drawn under the menu and changes no pixel (above).
    (Since 2026-11-11, 4.8.12: the lab's second slot is empty by default and the row is grey in both, X.)
  - *PLAY* (No Picture, no shots taken): identical.
  - *The histogram* (GUI layer 1's box at x 4..259, y 110..172 on the shooting screen): empty in camapp 1 with or
    without `--cpu2 native` (S-MODACK answers OSD_DRAW_CPU2's send, 4.6.2) and in camapp 3 without it; in camapp 3
    with `--cpu2 native` OSD_DRAW_CPU2 draws one column, bin 5 at x 14..15, rows 110..172 (126 pixels, GUI layer 1's
    index 54): the 64 in bin 5 the firmware puts in place of the bins it discards while IMG1 is off (4.2.1). Nothing
    else in the frame changes.
  - *Live view* (S-SCENE's): camapp 1 composes it; camapp 3 stops at the histogram's first end with IMG1 on, the bins'
    read at `0x501e153d` (fault 2, HIST_UNMODELLED: A-VSCHIST-2 gives no bins for a plane that is on; 2.9 s of lab
    time). That is 4.2.1's open item, now observed.
    Since 4.2.7 the unit's bins are counted and camapp 3's live view runs on.
- **Tests (X).** `emu/test/test_dev.mjs` vscHistUnits (30 checks with the new vscHistCompose: the six registers at the
  run's values leave a composite of the TFT's open state with one OSD plane word for word as it is without them under
  the opt-in, are FEATURE_UNOBSERVED without it, and twelve values outside the forms stay refused one at a time);
  `emu/test/test_camapp.mjs` camapp3FramesSession (6 checks: the frames above compose, the menu's IMG2 is the bank and
  changes no pixel, `--cpu2 native` adds exactly bin 5's column).
- **What still separates camapp 3 from the default (X unless tagged).** The live view stops at its first histogram
  end (above); the keys lost after a menu pass and a shot, playback with pictures and REC's header fill (4.3.1's next
  stops, and S-JPEGENC and S-ALBM there; their causes in 4.3.2, followed in 4.1.10 and 4.8.11; the header fill runs
  natively in REC_IMAGE's task
  since 4.3.3, under camapp 3 too, X); the GUI differences above (MF and no AF target, the movie card slot row),
  their causes in 4.3.7 (MF is no difference since 4.3.8: the lab's lever input was SW_2); S1's release (600 ms
  after S1) after a menu and a PLAY pass stops at S-TAKEOVER's scope (a
  module-9 read from `0x50c8a335`, not one of CMP_MODULE9_READERS; X, 2026-11-10).
  *Golden with camapp 3 as the player's default* (a local, uncommitted run of the 21 Player sessions; X): all 21 differ
  in every layer, as they must (the components run, so instruction counts, stand-in lists, traces and frames change).
  Seven run to their end through the same GUI states and outcomes (a15-open, evf-idle, power#2, power#3, scp-edge,
  scp-replay, scp-timeout); re-measured after 4.3.6 (X: the GUI state and panel at every call's mark of golden's
  camapp 1 traces against a flipped run's; the replayed outcomes' digests differ in all 21 sessions, so this count
  leaves them out) eight do, switch-scp joining them. Three keep the GUI states but end
  otherwise (X, a replay of each scenario's calls under
  camapp 1 and 3 in review): b7-gate's second OK at the B7 gate ends camapp 1's session in UI_IN group 1's event-storm
  NavError (more than 810 GESetEvent calls) while camapp 3 takes it and runs to the end; under camapp 3 power's and
  power-replay's first power-off ends in S-SHUTDOWN's PowerError (the power-off had not reached its last write after
  10 s of lab time) where camapp 1 is off (cause in 4.3.6: TRA 586 is not answered, the flash capability still
  running when the shooting component's teardown asks for its stop). The other ten take other GUI states or end
  early: an output switch to the EVF from the shooting screen stops the
  session at the open (eye-burn's eye switch, switch-shoot's and tokens-3b's LV, X): the
  firmware logs `0x37001418` from the histogram ISR (`0x501deccc`), the TFT channel's run ending with the TFT closed
  (`docs/om1-vsc-spec.md` section 13), and the harness's DISPLAY cmd 2 refuses a step with an error log (4.3.6: the
  application's histogram stop, TRA 937, comes after the lab's own OPEN; switch-scp's LV, from the Super Control
  Panel, stopped at the switch's module-9 post-condition, fixed there); playback's PLAY, pressed at the
  start's end (2.86 s), stops at S-DISPQ (UI_IN group 3's OlyQeWr to the DISPLAY queue from `0x503eba07`, not the
  asynchronous request it stands in for; after 2 s of idle PLAY works, X; the lab's nesting, 4.1.9, after which PLAY
  there shows No Picture); keys ends at its 15th call (a switch input;
  its message not reproduced), tokens' OPEN gives GUI `0x0b01` where camapp 1 gives `0x0b02`, and queue, inputs,
  pace-wall and play-perf take other states (not traced). The check runs (check/, run/) were not run with the flip.
  Re-measured 2026-11-11 (4.3.10, X, by scenario): at that master six of the 19 scenarios stop (eye-burn,
  switch-shoot, tokens-3b, keys, power's first lab, power-replay), six run through camapp 1's GUI states and seven
  through other states; after 4.3.10's two fixes three stop (power's first lab, power-replay, tokens-3b) and 16 run
  to their end. The table of sessions with cause and status is in 4.3.10, which also corrects this count (it mixed
  stops with other states, and switch-scp's EVF composites were refused).
- **Corrections.** 4.1.5's, 4.2.1's and 4.3.1's "the composite is refused" and 4.6.2's "no frame shows the column"
  hold only without A-VSCHIST-3; 4.2.1's open item on the composite is answered here (as an assumption, not a fact).

#### 4.2.5 The front end's interrupt and cam.c's second init (2026-11-10; D unless tagged, addresses E143's)

4.2.3 stopped at the front end: request 7's events `0x300` / `0x400` reach EXP through the front end's records +2464 /
+2532, whose interrupt was not read. This round reads every reader of those records and of request 7's event slots,
the camera units' interrupt handlers and cam.c's second init, builds the device model the second init needs (S-CAMFE,
`emu/src/dev/camfe.mjs`) and runs that init natively (H-CAMINIT2, `emu/src/lab/take.mjs` round 5) behind the probe's
`cam_fe` opt-in (the Player's `cam_fe`, off by default; golden unchanged). Result: the chain from the units' handlers
to EXP's callbacks is read, but no handler is found that passes `0x300` to EXP, and the records are armed only through
the front end's entry, whose callers (the movie sequence's frame step, cam_still_drv.c and the handlers of the module
the second init's seventh step `0x5019c70f` sets up, which cam.c's request 6 starts) none reaches in the lab; so no
stand-in raises an interrupt and EXP_MOVIE waits as before (X). `emu/test/test_camfe.mjs` camFeUnits (15 of 15),
`emu/test/test_expcb.mjs` camFrontEndSession (9 of 9) and `emu/test/test_take_release.mjs` camFeSession (5 of 5) pin
what follows.

- **The records' readers.** An immediate scan of cam.c's range (`0x50150000..0x501a8000`) for 2464 and 2532 (and their
  +44, +48, +64) finds: the fill `0x5016f5a6` (`0x5016ffab`, `0x5016ffeb`: 2464's +24 from `(12, (4, request))` and
  2532's +28 from `(16, (4, request))`, their only unit pointers, +48 from the kind-7 request's +84 / +88, +64 the
  enable; the request is the fill's d0, `0x5016f33b`), the context init at `0x50173c67` / `0x50173c7c` (+0 the
  type 7, +44 the callback from the init's stack table, +36), and the descriptor registrations `0x501741c2` /
  `0x501741ce` (entries 23 and 24 of the table `0x5021f958`, which `0x5017ada3`, cam_frame_queue.c, runs for each set
  bit of a context's 64-bit mask into the descriptor `(0x62a21504) + 244 k`, `0x50179450`) and `0x501796ae`,
  `0x50179c86` (the same slots wholesale): the record's address goes to the descriptor's +192 / +196. The 2464 / 2532 at
  `0x501a18fa`, `0x501a4d49` and `0x501a512f` are offsets into another structure (`(0x62a26a58)`). Nothing else reads
  the records but through those slots: the start loop `0x50170a96` (called from the front end, the movie sequence's
  states and the cam_still code at `0x5086004c`) calls entry k of the table `0x5021c800` for each set bit, and entries
  23 / 24 (`0x50170e00`, `0x50170e12`) hand the record to cam_bright.c's start `0x50158cac`, which dispatches by its u16
  type.
- **Request 7's event slots.** Read by the notifier `0x50155e66` (4.2.3), by the movie sequence's frame step
  `0x501999f4` (the item's +64, event `0x200`) and by the kind-7 request builders that copy them, `0x501984e7`
  (cam_seq_dram_capture.c) and `0x5019c498`, `0x5019c50a`, `0x5019c57c` (cam_seq_movie.c's; I for the last two, by their
  place; each reached only from the frame step, through `0x501998d8`, `0x50199938` and `0x50199954`): each copies the
  item's +8..+111 to the request's +24..+127, so the request's +84 / +88 are the item's `0x300` / `0x400` masks (EXP's 3
  and 2, 4.2.3), and puts its wrapper at +128 (`0x5019862f`; `0x5019c69c` for the three) and the item at +136.
- **The chain to EXP's callbacks.** A unit's per-bit handler calls the record's +44 with a0 the record, d0 0 and d1 its
  own bit masked by the record's +48. Record 2464's +44 `0x5017078f` takes the request from `(8, (40, record))`, ands d1
  with its +84 and, if nonzero, calls the wrapper with a1 `0x300`; 2532's `0x501707c0` the same with +88 and `0x400`.
  The wrapper (`0x5019c69c` on the movie sequence's path, EXP's, or'ing a1 with 2; `0x5019862f` or'ing it with 4) calls
  the item's notifier (+116), and the notifier EXP's slot callback when the slot's mask and d1 share a bit (4.2.3).
- **The record type's units.** `0x50158cac` by type: 9 `0x5015900e` / `0x5015969f` (jobs on the handles
  `(0x629a7e64)`, `(0x629a7e68)`), 128 `0x50159d30`.. and 7 `0x50158d54` (with +4 set it first copies +4's block and
  calls the record's +36; then, +4 set or not, a job for each of the record's unit pointers that is set: +8, +12, +16,
  +20 on the handles `(0x629a7e6c)`..`(0x629a7e78)`, units 2, 3, 11, 12, and +24, +28 on `(0x629a7e64)`, `(0x629a7e68)`,
  units 0, 1, `0x50158dc6..0x50158fe7`), 144 / 145 `0x5015b9bd`.. / `0x5015bac1`... The job queue is `0x50165b82`
  (handle, unit number, callback, record). Type 7's job callbacks (`0x5015d6c3`, `0x5015d6fb` for +24, +28,
  `0x5015d733`, `0x5015d76b`, `0x5015d7a3`, `0x5015d7db` for +8..+20) call the record's +36 (X: `0x50170433` in each
  context), which counts the record's +64 and its context's +3274 down and at 0 calls the request's completion +132
  (`0x50170947`; for `0x5019c498`'s requests `0x5019c5ea`, which calls the item's +120, the completion of 4.2.3); none
  calls +44.
- **The units' interrupts (D; X: the table `0xa32600c0`, IRQ n at +4 n, after the second init).** The handlers
  cam_bright.c's six use: IRQ 32 `0x5015789d` and 33 `0x501579aa` (AE1, AE2), 34-37 `0x50157ab7`, `0x50157d21`,
  `0x50157f8b`, `0x501581f5` (AWB1-4); each reads its status (`0x9b380044`, `0x9b381044`, `0x9b382044`, `0x9b382844`,
  `0x9b383044`, `0x9b383844`), writes the value back and calls per bit from a RAM table copied from the image's
  `0x6022575c` (X): 15 entries each from `0x629a7c64` for AE1 / AE2, 8 each from `0x629a7cdc` for AWB1-4, an entry
  taking the unit's current or next job (`0x629a7d5c` / `0x629a7d60` for IRQ 32, ..). The entries of IRQ 32 + u use the
  handle `(0x629a7e64 + 4 u)`, u = 0..5, so a type-7 record's +24 / +28 jobs are AE1's / AE2's and its +8..+20 AWB1-4's;
  2464's and 2532's are AE1's and AE2's (the fill sets only their +24 / +28). The first device word the other front-end
  handlers read: SSG1 15-17 `0x9b000004` and `0x9b000018` (each and'ed with its enable `0x9b000008`.. / `0x9b00001c`..,
  then written back), 18 `0x9b00060c`, SSG2 19-22 `0x9b080004` / `0x9b080018`, 24 `0x9b181028`, 26 `0x9b280024` (the
  base word `0x629a7afc`, X: `0x9b280000`; its mask a RAM word, `(0x629a7af8)` + 40, X: `0xa039a028`; correction to
  4.2's "cam.c, unknown, RAM only"), PRO 27-31 `0x9b300018`.., AF 38 `0x9b400018`, PFP 39 `0x9b480020`, the clock block
  40 `0x9b500028`, DMA 41 / 42 `0x9b580080` / `0x9b600080`, SLVS 243-247 `0x982800a0`... What sets any of these bits is
  ?.
- **No handler passes `0x300` to EXP (D; why is ?).** AE1's per-bit entries (X: the 15 from `0x629a7c64`,
  `0x5015db6a`..`0x5015e064`) call +44 with `0x20`, `0x40`, `0x80`, .., `0x4000` (`0x5015db93..0x5015dfcc`; the other
  five call no +44 themselves, [11] `0x5015dfef` calls `0x50165ce1`), AE2's likewise (`0x5015e0e4..0x5015e51e`); AWB's
  per-area handlers (AWB1's `0x5015e629`, `0x5015e6c7`, `0x5015e766`, `0x5015e805` for status bits 4..7 with the job's
  pending bit) copy the unit's results (`0x9b382200..0x9b3822ec`) into the record's buffers and call +44 with `0x200`,
  `0x400`, `0x800`, `0x1000`. Record 2464's +48 is EXP's mask 3, so none of these bits reaches the wrapper, on the
  records' own units (AE1 / AE2) or any other. cam_bright.c calls a record's +44 with 1 only from the job callbacks
  `0x5015bd6d` and `0x5015be1d` (type 9's, their pointers at `0x50159036`, `0x501596c7`) and `0x5015be74`, `0x5015becb`,
  `0x5015bf22`, `0x5015bf79` (pointers at `0x50159d58`, `0x5015a690`, `0x5015ad01`, `0x5015b374`, beside type 128's
  below), with 2 only from type 128's (`0x5015cce1`.., pointers at `0x50159d4f`, `0x5015a687`, `0x5015acf8`,
  `0x5015b36b`) and with `0x10` from `0x5015bfd0..0x5015c115` (pointers `0x5015b9dd..0x5015bc6a`), while the context
  init gives 2464 and 2532 type 7 and type 7's job callbacks do not call +44 (above). Which path delivers bit 0 or 1 to
  a type-7 record is not found: either the type or the mask changes on the way (no such write was found) or the event
  comes from elsewhere (?).
- **What arms the records: the front end's entry (D).** The fill runs only from the front end's entry `0x5016f2ae`,
  which is called by the four builders above, by cam_still_drv.c (18 sites `0x5085a2f3..0x5085ae74`) and by the kind-7
  sender `0x5019d460` (`0x5019d499`; no slot copy, its kind and pointers from its caller), which the handlers
  `0x5019c8de` and `0x5019ceaa` call (`0x5019cd8f`, `0x5019cf56`): the event handlers that `0x5019c843` / `0x5019ce1c`
  register on an instance of the sequence engine before posting an event (`0x10000001`, or `0x10000002` by
  `(0x62960790)`), which the message handler `0x5019c7d3` of the module the second init's seventh step `0x5019c70f` sets
  up schedules for its kinds 1 and 2; those are cam.c's requests 6 and 5 (`0x5015552a`, `0x5015553b`, through
  `0x50155ad9`), and request 6 is the one TAKE_FUNC_CP's start makes, which S-TAKECAM answers in the probe (4.2.3).
  Whether these kind-7 requests set the context bits 23 / 24 the records need is not read. X (an experiment, not pinned;
  camapp 1, `--take probe`, `cam_fe`): request 6 made of the switch natively after H-CAMINIT2 runs `0x5015552a`,
  `0x5019c7d3`, the deferred `0x50153844` (9 times) and `0x5019c843`, and the event handler `0x5019c8de` 10 times in 300
  ms, but neither the sender `0x5019d460` nor the front end's entry; cam.c logs nothing and S-CAMFE takes no access.
  Request 7's kind 1 (`0x50198993`) keeps the item in `0x62a24248` with the state `0x62a24244` = 1 and posts it to INFN
  and SQMV; it reaches the front end only from the frame step `0x5019981d`, whose one caller is kind 10's handler
  `0x50199383`. The first step sets the state 2 and fires nothing (`0x50199a1e..0x50199a2e`); each later one calls the
  item's notifier with `0x202` when its `0x200` mask has bit 0 (`0x50199a33..0x50199a51`). Kind 10 is sent by
  cam_still_drv.c's `0x5085aeef`, the first step of the list `0x509e4da0` that the row of event `0x10000100` in
  cam_still_seq.c's table `0x5033c224..` (read by `0x5085f9d0`) names; the dispatcher's other callers send kinds 1 and 3
  (requests 7 and 8), 12 and 13 (`0x5019d3f8`), 8, 9, 11 and 14-17 (cam_still_drv.c), and the messages a front-end
  context holds (descriptor +16 .. +28, bits 0, 1, 53, 54, the start loop's `0x50170b57..0x50170b90`): the context's +8,
  +148, +288 and +428 (`0x501740aa`, `0x501740b4`, `0x5017428e`, `0x50174299`), of kinds 4, 5, 6 and 7 (the context
  init, `0x5017313a..0x5017317e`; X in each of the 15, camFrontEndSession), which the dispatcher hands to `0x50198e56`
  (when the byte +46 of the message's +112 block is 1 it copies that block's +48..+119 to `0x62a23efc` + 72 (kind - 4);
  then it calls the message's +120, X: `0x501704ef`), not to the frame step. X (an experiment, not pinned): kind-10
  messages given by hand after request 7, under a recording stub over the camera blocks, run the frame step, which hands
  the front end two kind-7 requests (from `0x5019c4ff` and `0x5019c5df`; contexts `0x629b23fc` and `0x629aa520`); cam.c
  logs `0x0a143000` (line 3718, `0x5018a616`) and `0x0a113001` (line 3938, `0x5019ab61`), no unit is started, and the
  next idle stops at a system clock change (the kernel's clk_ctrl; `0x5005e55c` reads `0x98580014`, which the lab does
  not model).
- **cam.c's second init (X: its trace under a recording stub; D: the code at the pcs).** With the first init run
  (H-CAMINIT) it returns 0 after 358 writes and 40 reads of 256 registers in 15 blocks, all 4 bytes: SLVS `0x98280198`;
  `0x9a801c00..0x9a801c34` (14 words; 12 of them read-modify-written, `|= 1`, `|= 2`, `|= 4`, each under the lock
  `0x500640d4` / `0x500640de`, `0x501639bb..0x50163ca6`); SSG1 `0x9b000000` (`&= ~8`, `0x501a0948`), +0x14, +0xa08
  (`&= ~0x10000000`, `0x5019d89f`); SSG2 `0x9b080000` (`&= ~8`, `0x501a2de0`); `0x9b180000` (9), `0x9b200000` (1),
  `0x9b280000` (4); PRO `0x9b300000..0x9b304fff` (30); AE / AWB `0x9b380000..0x9b384fff` (21); AF `0x9b400000` (2); PFP
  `0x9b480000` (8); the clock and control block `0x9b500000` (102: the clock gates `0x9b500800`..`0x9b500898`, single
  bits, `0x9b500800` = `0x2000` first, `0x5015ff22`, under a reference count at `0x629a7f37`; +0xa08 written 1 and
  polled until it does not read 1, `0x5016381a..0x5016382c`; tables from `0x602259c0..` and `0x60225a2c..`); DMA
  `0x9b580000` (36) and `0x9b600000` (22); `0x9b680000` (2); plus `0x98800340..0x98800398` in a stub page. It attaches
  IRQs 15-22, 24-42 and 243-247. It reads nothing else: no code in cam.c's range reads the clock gates by address.
- **S-CAMFE (`emu/src/dev/camfe.mjs`).** A register file over those 256 registers that takes exactly the values the
  init writes (330 pairs, recorded from the trace) and refuses any other value, address, width or a debugger write
  (a bus error, printed), so a later write that would start a unit or change a clock stops loudly. **Assumed
  (A-CAMFE-1, I):** the read-before-write registers read 0 (their reset value is ?); the init branches on none of
  them, so the value reaches only bits it does not touch, which nothing in the lab reads. **Assumed (A-CAMFE-2, I):**
  +0xa08's bit 0 has cleared by the next read. No status register is modelled and no line is driven: none of the
  handlers above runs. The probe builds it (not the machine) when the session's opts carry `cam_fe`.
- **Run natively (X, camFrontEndSession: camapp 1, `--take probe --cpu2 native`, `cam_fe`).** H-CAMINIT2 after
  H-TAKEINIT, as USTART calls the second init after TAKE_FUNC's start (`0x50024d80`): it writes S-CAMFE's whole program,
  the handlers above are in the table, the bright unit's tables are in RAM, the movie sequence's queues are registered
  and the 15 contexts of 32476 bytes from `0x629aa520` hold records 2464 / 2532 of type 7 with +36 `0x50170433`, their
  +44 and no unit pointer, and the messages of kinds 4..7 (above; 4.2.3's I on the contexts). TAKE_EXPOSE `0xa00` (mode
  0, as 4.2.2): cam.c takes EXP_MOVIE's requests 8 and 7 with no error (before: `0x0a283000` three times), the movie
  sequence keeps the item with state 1, and in 300 ms no frame step, front-end entry or job follows, S-CAMFE takes no
  access, no frame callback runs and EXP_MOVIE waits on flag 21 for `0x1000`.
- **S1 and S2 (X, camFeSession: camapp 3, `--take probe --cpu2 native`, `cam_fe`).** S1's record is 4.2.3's (S1_EXP)
  and the sequence's events 826 and 794 as there; cam.c takes requests 8 and 7 without an error, EXP_MOVIE waits on
  flag 21 for `0x1000`, TAKE_MAIN stays in RdyFcsRdy3 with the pending bits `0x200` (TAKE_EXPOSE's token 15), so
  RdyTrig2Wait is not reached; no frame callback, answer or AE result write (S-EXPOSE's writer `0x50596187` does not
  run). S2 goes as focusSession's: S-DISPQ keeps its nested DISPLAY posts (4.1.9) and its idle stops at the sub-CPU's
  command 0x14, before any TAKE_EXPOSE `0x600` (X, after the round's merge). (Since 2026-11-11, 4.7.6, S-SCPUDEV takes
  the 0x14 and S2's idle goes on with no stop; TAKE still takes nothing, X.)
- **Corrections to 4.2.3.** "The units' per-bit handlers call a record's +44 with its +48 mask": they call it with
  their own bit and'ed with the mask, and the mask holds EXP's bits (above). "The movie sequence gives it 144-byte
  kind-7 requests": `0x501984e7` is cam_seq_dram_capture.c's; `0x5019c498`, `0x5019c50a` and `0x5019c57c` are
  cam_seq_movie.c's (the last two I).
- **Next (I; Claude wall-clock).** (1) The `0x300` path for a type-7 record: neither its units' per-bit handlers nor
  type 7's job callbacks (`0x5015d6c3`.., above) pass bit 0 or 1, so the callers of a record's +44 outside cam_bright.c
  read to the bit EXP's mask takes (half a day). (2) The frame step's sender:
  cam_still_seq.c's run to event `0x10000100`, and the system clock controller at `0x98580000` the experiment stopped at
  (days, open-ended; 4.2 seam D). (3) The shorter lead to the front end: request 6 natively under `cam_fe` (TAKE's,
  which S-TAKECAM answers now), read to what the event handler `0x5019c8de` waits for before its kind-7 requests
  (hours). Only then can a stand-in at a unit's interrupt (paced by the lab's frame clock) have a job to complete.
  (3) is read in 4.2.6: request 6 is the sensor's power-on, which natively stops at the sensor's serial unit.

#### 4.2.6 cam.c's request 6 and the arming of the front end (2026-11-11; D unless tagged, addresses E143's)

4.2.5 ended at the third way into the front end's entry: the module the second init's seventh step sets up, which
cam.c's request 6 starts and whose handler ran ten times in the reviewer's experiment without reaching the kind-7
sender. This round reads that module. It is cam_seq_power.c: request 6 is the sensor's power-on and request 5 its
power-off (that the image sensor is what they power is I: the rails, the camera clocks and the serial commands that
follow). The ten runs were the experiment's own argument (1), which makes the power-on wait for the mechanism driver;
TAKE_FUNC_CP's start passes 0 (other senders in TAKE's code pass 2, below). With 0 the power-on runs natively under
`cam_fe` through the sensor's eight power rails and the camera clocks (S-CAMFE takes four more clock enables,
`emu/src/dev/camfe.mjs` POWER_ON) and stops at the first unsettled device, the unit of SSG1 that sends the sensor its
serial commands (that role I; `0x9b000a04`, IRQ 18). The front end's entry lies behind three requests to that unit and
the units' set-up, and in a permissive experiment the power-on's kind-7 request arms neither record +2464 nor +2532.
So no stand-in is added, S-TAKECAM keeps requests 6 and 5, and EXP_MOVIE waits as before (X).
`emu/test/test_camfe.mjs` camFeUnits (18 of 18), `emu/test/test_expcb.mjs` camFrontEndSession (15 of 15) and
camDriverSession (8 of 8) and `emu/test/test_take_release.mjs` camFeSession (6 of 6) pin what follows.

- **The files of cam.c's range.** The error log's file names are literals in the code: cam_lens.c (first at
  `0x50151623`), cam_list.c (`0x50151d40`), cam_mec_ctrl.c (`0x501525f4`), cam_sem.c (`0x501539c6`), cam_strobe.c
  (`0x50153abd`), cam_time_m.c (`0x5015470b`), cam_timer.c (`0x50154a4f`), cam_watchdog_timer.c (`0x501550f1`), cam.c
  (`0x50155556..0x50155e46`), cam_bright.c (`0x50159011`), cam_contrast.c (`0x50161db5`), cam_cpm.c (`0x50165ded`),
  cam_expcal.c (`0x5016d148`), cam_frame_driver.c (`0x50171ae8..0x501722e0`), cam_frame_queue.c (`0x501794ff`),
  cam_imgdev_sio.c (`0x5017ed3a`), cam_param.c (`0x5018a38f`), cam_pfp.c (`0x5018d8fb`), cam_prepro.c (`0x5018f09e`),
  cam_seq_dram_capture.c (`0x501982bd`), cam_seq_movie.c (`0x50198945`), cam_seq_power.c (`0x5019c8ed..0x5019d6fe`)
  and cam_slvs.c (`0x5019f485`). So 4.2.3's "sequence engine" `0x501524c0` is cam_mec_ctrl.c's item entry (I: by the
  name's place; items 15, 16, 13, 144 and 145; any other logs `0x002b0000`, `0x50152504`), and its "engine instance
  code" `0x501536b4..0x5015382c` is cam_sem.c's (I: likewise): `0x501536b4(n)` gives a semaphore, `0x5015373a`
  (a0 the semaphore, a1 a function, d1 its argument) runs the function once the semaphore is free (deferred,
  `0x50153844`) and `0x501537d8` releases it (I: from their use below).
- **The module (cam_seq_power.c).** Its init `0x5019c70f` clears its 32 bytes `0x62a25494..`, takes a semaphore
  (`0x501536b4(11)`, `0x62a25498`), four event queues (`0x50150f8e(2..5, 1)`: `0x62a254a4`, `0x62a254a8`,
  `0x62a2549c`, `0x62a254a0`) and two watchdogs (`0x501550e1`, cam_watchdog_timer.c: the records {100, the handler
  `0x5019d659` / `0x5019d6aa`, 14880 / 14881, the code `0x0a113002`, 3}, `0x62a254ac` / `0x62a254b0`; their period is
  not read, ?). Requests 6 and 5 (`0x5015552a`, `0x5015553b`) build a 24-byte record through `0x50155ad9`: +0 the
  kind 1 / 2, +4 the request + 4, +8 the request's argument byte +3, +12 the completion relay `0x50155d90`, +16 the
  request, +20 a status. The relay frees the record, tells cam.c's state setter `0x50156519` 2 after the first
  power-on and 1 after the last power-off (by the count `0x5019c83a` returns) and calls the request's completion +72
  with the status. The message handler `0x5019c7d3` gives the record to the semaphore with the kind's start function,
  `0x5019c843` (1, power-on) or `0x5019ce1c` (2, power-off); another kind logs `0x0a113002` (line 338).
- **The power-on's events.** The start counts the power-ons in the byte `0x62a25494`: at 1 it registers the handler
  `0x5019c8de` on the queue `(0x62a2549c)` (`0x5015110c`, the record its argument, `0x50151210`) and posts event
  `0x10000001`, or `0x10000002` while the byte `0x62960790` is set (below); at more than 1 it calls the record's +12
  and releases the semaphore. The handler ors each event into the word `0x603502c8`, takes a 12-byte block {queue,
  the next event, record} for the step's completion callback (`0x5019d4d8` and `0x5019d518` post the block's event,
  `0x5019d558` the same as a kind-7 request's completion +132) and looks the event less `0x10000000` up in 32 slots
  of {key, case} at `0x602a29f8` (slot key & 31, linear probe; a key with no slot only sets its bit):
  - `0x1`, `0x2` (`0x5019c96f`): the watchdog `(0x62a254ac)` on (`0x50155166`); for `0x1` rail step 0, whose end
    posts `0x4`, for `0x2` a post of `0x800000`. Then by the argument byte: with 1 or 2 a cam_mec_ctrl.c item 13
    (`0x501524c0`; its +4 0 for 1, else 1; its +8 `0x5019d62c` posts `0x10`, its +12 `0x5019d607` posts `0x8`), with
    any other value posts of `0x10` and `0x8` at once.
  - `0x4`, `0x20`, `0x40`, `0x80`, `0x100`, `0x200`, `0x400` (`0x5019ca2b..0x5019ca79`): rail steps 1..7, whose ends
    post `0x20`, `0x40`, `0x80`, `0x100`, `0x200`, `0x400` and `0x800`. `0x800` (`0x5019ca96`) posts `0x800000`.
  - `0x800000`, `0x8` (`0x5019caac`), only once both are in (`0x10800008`): the camera clocks on (`0x5019d213`),
    `0x5017c624`, cam_frame_driver.c's `0x50171ade(0, 0; 133)`, port 16 on; `0x1000` after a delay of 7
    (`0x50154b03`; cam_timer.c's by its place, I).
  - `0x1000` (`0x5019caf7`): port 13 on; `0x1000000` after a delay of 1.
  - `0x1000000` (`0x5019cb24`): ports 14 and 15 on; the SSG's requests 7 (with the table `0x50180bcf()` returns) and
    8, which program SSG1's command unit (below); the end of `0x50171ade(1, 0; 131)` posts `0x2000`.
  - `0x2000` (`0x5019cb90`): `0x50154c04(150)` (not read); the end of `0x50171ade(1, 1; 131)` posts `0x4000`.
    `0x4000` (`0x5019cbad`): `0x8000` after a delay of 20. `0x8000` (`0x5019cbc4`): the end of `0x50171ade(1, 2;
    131)` posts `0x10000`.
  - `0x10000` (`0x5019cbe8`): the units' set-up `0x5019d287`, a 68-byte record {130} to `0x5018ed9e`, then the
    kind-7 sender `0x5019d460(7, 0, request + 4)`, whose completion posts `0x20000`.
  - `0x20000` (`0x5019cc40`): `0x5019d167`, `0x50180bc6`, `0x501a0958`, the movie sequence's kind 12 (`0x5019d3f8`),
    `0x501a1f1b`, `0x501a1fef`, `0x501a20c3`, `0x50171b9c(10)`; the end of `0x50171b9c(135)` posts `0x40000`.
  - `0x40000` (`0x5019cc96`): ports 14 and 15 off, `0x501a1ee6`, `0x501a1fba`, `0x501a208e`; the ends of
    `0x50171ade(3, 3; 131)`, of `0x5019f0b0` (I: the SLVS receiver's, by its place before IRQ 243's handler) and of
    `0x50171b9c(136)` post `0x80000`, `0x200000` and `0x100000`; then `0x50171e8b(3)`.
  - `0x80000` (`0x5019cd4f`): `0x5019db7d`, the command unit's +0xa18 / +0xa1c written again. `0x100000`
    (`0x5019cd56`): the kind-7 sender `0x5019d460(7, 1, request + 4)`, whose completion posts `0x400000`. `0x200000`
    (`0x5019cd96`): `0x50171ade(1, 0; 132)`.

  After each case, once the word holds `0x10e00010` (`0x10`, `0x200000`, `0x400000` and `0x800000` are in), the
  power-on is done (`0x5019cdc1..0x5019ce16`): the byte `0x62960790` is cleared, the record's +12 is called with the
  status +20 (the relay above; for TAKE's request the completion is `0x502cd4d0`), the handler is unregistered
  (`0x5015121d`), the word cleared, the watchdog stopped (`0x501551b1`) and the semaphore released. So both of 4.2.5's
  kind-7 requests from `0x5019c8de` are steps of the sensor's power-on, each a wait for the front end.
- **What the ten runs waited for (X, camDriverSession).** They are what the argument 1 gives; camDriverSession's records
  carry +3 = 1, as TAKE's request 148 does. With 1 the first event queues cam_mec_ctrl.c's item 13, whose first job
  (147, the table `0x602253d8`) asks the mechanism driver's request 34 (`0x5010914d` from `0x501532d8`; 7.2's driver,
  whose queue handle `(0x629651b4)` is 0 in the lab, X); its function `0x50109c7b` never runs, so `0x10000008` never
  comes. The handler takes `0x1`, `0x4`, `0x20` .. `0x800` (the eight rails) and `0x800000`: ten events, the last of
  which finds bit 3 missing at `0x5019caac`. S-CAMFE saw no access because the clocks come after that test (X under
  `cam_fe` too, an experiment). TAKE_FUNC_CP's start passes 0: `0x502cda4a..0x502cda61` makes request 6 only when d2 is
  0 and gives d2 as the argument (X: S-TAKECAM's record of it has the parameter 0). It is not TAKE's only sender: its
  request builder `0x502cd411` (d1 the argument, +3) is called with 6 and 2 at `0x503c2882`, `0x503a8cca` and
  `0x506d8488`, and `0x503c288d` makes request 6 with 0 through `0x502cd403` (their callers are not read); with 2 the
  power-on takes the mechanism's path as with 1 (item 13 with +4 = 1). None of them runs in camFeSession (X: one
  request 6, TAKE_FUNC_CP's). Correction to 4.2.3: "request 6 is then deferred and queued without completing" holds
  for an argument of 1 or 2 only; the item queued is the mechanism's.
- **The rails.** `0x500236fe` (d0 the step, a0 a callback, a1 its argument): the step's row of the table `0x600472e0`
  (8 bytes: u16 port, u16 on-delay, u16 off-delay, the levels) gives the GIO port to turn on (`0x5002357c(port, 1,
  level)`) and the delay after which the callback runs (`0x5005899c`; a delay of 0 as a deferred call, `0x500504aa`).
  Steps 0..7: ports 132, 44, 38, 39, 40, 186, 134, 133 with on-delays 5, 5, 0, 5, 5, 0, 2, 5 (X: milliseconds, 27 ms
  in all; which rail each port switches is ?). The module can run all eight by itself (`0x5002381f`, a chain through
  the step word `0x62960784`), after which it sets `0x62960790` (`0x500238b2`): the power-on then starts at event
  `0x2` and skips the rails. Who starts that chain is not read (?); in the lab the byte is 0 (X). The power-off uses the
  rows' off side through `0x5002374e`.
- **Natively under `cam_fe` (X, camFrontEndSession: camapp 1, `--take probe --cpu2 native`, `cam_fe`).** S-TAKECAM
  answers TAKE's own request 6 at the start and no event of the power sequence runs (the probe records them:
  `take.cam.power`). The test then makes request 6 of the switch as TAKE does (argument 0, +72 `0x502cd4d0`). The
  handler takes `0x1`, `0x10`, `0x8`, `0x4`, `0x20`, `0x40`, `0x80`, `0x100`, `0x200`, `0x400`, `0x800`, `0x800000`,
  `0x1000` and `0x1000000`; the eight rail steps run in order and the ports go on as in the list above (132 .. 133, then
  16, 13, 14, 15; their GIO words are the lab stub's, which keeps them); `0x800000` comes 27 ms after `0x1`, `0x1000` 7
  ms and `0x1000000` 1 ms later. At `0x800000` S-CAMFE takes the clocks (below; 8 writes and 3 reads with the SSG's
  register clock +0x810 = 1 of the next step). At `0x1000000` the SSG's request 8 writes the command unit's first
  register, `0x9b000a04` = `0x2100` at `0x5019dcb6`, which S-CAMFE refuses by name: the session stops there, 35 ms after
  the request. The kind-7 sender, the front end's entry and TAKE's completion are not reached, and cam.c logs nothing.
- **S-CAMFE takes the power-on's clock enables.** The clock block's gate functions share one shape: a count byte in
  RAM, the gate's bit written to the gate's "on" word when the count leaves 0 and to its "off" word when it returns
  to 0 (`0x5015ff11`, count `0x629a7f37`: `0x2000` to +0x800; `0x5015fbc3` / `0x5015ff58`, `0x629a7f2a`: 1 to +0x800
  / +0x808; `0x501602fa` / `0x50160601`, `0x629a7f50`: 1 to +0x810 / +0x818, around every access of SSG1's registers;
  `0x501609e6`, `0x629a7f3a`: 1 to +0x870). The second init's program already holds those of +0x800..+0x818. The
  power-on's `0x5019d213` adds four registers (X: its trace): +0x870 = 1 (`0x501609f6`); +0x008 = `0x700`
  (`0x5015fb32`, in `0x5015fb17` under the count `0x629a7f28`, whose reverse `0x5015fb69` writes `0x700` to +0x004: a
  set / clear pair of three enables, I; the init writes `0x100` here); and cam_cpm.c's `0x5016591d(0x20000010)`,
  which ors `0x10` into +0x9a0 and +0x9e0 (`0x50165955..0x50165962`) before the strobe +0xa08 = 1 and its poll
  (`0x50165b31`, A-CAMFE-2's word). They are enables no code reads back by address and nothing in the lab acts on, so
  the register file takes exactly these values beside the init's (POWER_ON; any other value or gate word is still a
  bus error). **A-CAMFE-1 now covers +0x9a0 and +0x9e0 (I):** they read 0 before their first write; the code
  branches on neither value. Which clocks the gates are is ?.
- **The first unsettled device: SSG1's command unit.** `(0x62a254c0)` = `0x9b000a00`. The SSG's request 7 (`0x5019d91a`)
  keeps a parameter table and request 8 (`0x5019dacb`) applies it through `0x5019dc8f`, by the table's flag bits:
  +0xa00, +0xa04, +0xa08, +0xa0c, +0xa14, +0xa18, +0xa1c, +0xa20, +0xa24 and the ten words +0xa40..+0xa64. The unit's
  driver (`0x5019deed..0x5019e47c`, its state from `0x62a25548`, the active request `0x62a25ed8`) has two modes. Mode 0
  (`0x5019e0a0`) copies up to 120 8-byte entries from the request's list into the command RAM `0x9b003000..` and starts
  the unit with +0xa00 = count << 8 | 1. Mode 1 (`0x5019e17a`) writes one entry, +0xa04 and +0xa0c from `0x62a254e0` /
  `0x62a254e4` and +0xa00 = `0x101`. Before either the driver clears bit 6 of `0x9b000000`, and the request's sender
  sets +0xa14 to 0 (`0x5019dc77`; the handler puts back the value the enqueue saved, `0x5019e01e`, `0x5019e31b`, when
  the queue empties). IRQ 18's handler `0x5019e218` takes SSG1's status +0x004 and'ed with +0x014 (the init's
  `0x700000`: bits 20..22) and writes it back: bit 21 (`0x5019e279`) ends a mode-0 batch (+0xa00 = 0, then the next
  batch or, the list done, bit 6 of `0x9b000000` set again and the request's callback +4), bit 20 (`0x5019e34b`) ends a
  mode-1 entry and stores the reply +0xa10 in the request's buffer +12, bit 22 (`0x5019e47c`) calls once the function
  kept in `0x62a25edc` (who sets it is not read). The reads of +0x60c around these steps are kept in `0x62a25ee4`, which
  nothing reads back (dummy reads, I). Correction to 4.2.5: IRQ 18's status is +0x004 under the mask +0x014, as IRQs
  15-17's is under theirs; +0x60c is only the first word its handler reads. What is not settled: when a started batch
  ends (+0xa18 / +0xa1c, which five functions `0x5019db7d..0x5019dc21` rewrite from parameter pairs, are its timing, I;
  written `0x12d50001` / 0 here, meaning ?), whether the unit runs without the sync generator (+0xa14, ?), and what the
  sensor answers a mode-1 entry. So S-CAMFE refuses the unit (its registers, +0x60c) and the lab stub the command RAM.
- **Beyond the stop (X: an experiment, not pinned).** With every register S-CAMFE and the stub refuse made storage
  that reads 0, and each start of +0xa00 answered at once by status bit 21 on IRQ 18 (values chosen to see the road,
  not the camera's), the power-on goes on: request 8 writes +0xa04 = `0x2100`, +0xa08 = `0x10100020`, +0xa14 = 1,
  +0xa18 = `0x12d50001`, +0xa20 = +0xa24 = `0x10101` and +0xa40..+0xa64 = 1..10; the three `0x50171ade(1, n; 131)`
  are mode-0 requests of 1227 entries (ten batches of 120 and one of 27), 1 and 1, each entry {`0x60000000`, a word
  with the low byte `0x81`} (the first three words `0x00000081`, `0x01fc0081`, `0x39030081`, the two single ones
  `0x00010081` and `0x005a0081`; I: a register number and a value for the sensor), with the 20 ms delay before the
  last. Between the last of them and the entry the firmware writes 597 registers of the clock block, 168 and 204 of
  the DMA blocks, 26 of `0x9b180000` and three blocks 4.2 does not list (`0x98b00140..`, 7 registers; `0x99d00000`,
  50; `0x9c700000`, 626). The kind-7 sender then calls the front end's entry, whose start loop (`0x50170a96`) gets
  the mask `0x00000caa:0x8001735d`: 18 bits, without 23 and 24, so this request arms neither record +2464 nor +2532
  (4.2.5's open question, for the first of the two requests); cam_bright.c's start runs once, for a type-7 record
  (context 0's +744), and queues no job. The context's pending count +3274 falls from 27 to 7 in the same instant
  (`0x50170947`) and stays: the handlers of IRQs 15-17, 24, 26, 27, 32, 33, 40-42 and 243 do not run, the request's
  completion `0x5019d558` does not come in 1.5 s and `0x20000` is never posted. Which seven units are pending is not
  read (?).
- **AE1 / AE2 from the frame clock: not built.** A stand-in at IRQ 32 / 33 would still have no job to complete: the only
  native way to the entry in the lab is this power-on, it stops before the sensor's serial unit, and its first kind-7
  request does not start the AE units (X, the experiment). EXP_MOVIE's flag 21 wait does not end and S1 goes as far as
  in 4.2.5 (X, camFeSession: TAKE_MAIN in RdyFcsRdy3 with the pending bits `0x200`).
- **The power-off (request 5, kind 2).** `0x5019ce1c` counts down and at the last power-off registers `0x5019ceaa` on
  `(0x62a254a0)` (table `0x602a2af8`, events `0x1` .. `0x4000`). Its first event starts the second watchdog and
  sends the front end a kind-7 request (`0x5019cf56`, d1 2); the later ones undo the set-up and the SSG
  (`0x5019d339`, `0x5019d1bd`, `0x5019dc4a`), turn ports off and run the rails' off side (`0x5002374e`). Read by its
  calls only; it cannot complete natively either (its first step waits for the front end).
- **S-TAKECAM stays for requests 6 and 5 (X, camFeSession).** Natively TAKE_FUNC_CP's start would wait on
  TAKE_CAM_EVENT for a completion that needs the sensor, so the stand-in answers as before: through the start, S1 and
  S2 no power-sequence event or rail step runs and the front end's entry is not called.
- **Next (I; Claude wall-clock).** (1) SSG1's command unit as a device of S-CAMFE: the RAM, the start and the end on
  IRQ 18 are read; the end's delay needs +0xa18 / +0xa1c read in `0x50180bcf`'s tables, else a named assumption (a
  day). (2) The set-up's programs (the clock block's 597 registers, the DMA blocks, `0x98b00000`, `0x99d00000`,
  `0x9c700000`) as register files, each block's reads checked for branches (days). (3) The seven units the first
  kind-7 request leaves pending, from the start loop's table `0x5021c800` to their interrupts: the first interrupt a
  stand-in must raise (days, open-ended; 4.2 seam D). (4) The argument 1 / 2 path needs the mechanism driver (7.2).

#### 4.2.7 The histogram unit (2026-11-11; D unless tagged, addresses E143's)

4.2.1 modelled the unit's runs and their end and refused its bins wherever the firmware keeps them
(HIST_UNMODELLED): under `control camapp 3` a live view stopped at the first end with IMG1 on (4.2.4) and INFO's
detail view at its first read (4.8.11). This round reads the rest of the driver and its callers, counts the bins in
the VSC model, and has the live histogram and playback's drawn from them. What the unit counts is in no code: it is
modelled under three named assumptions (A-VSCHIST-4 to A-VSCHIST-6). Default sessions do not start the unit and are
unchanged (X: golden identical). The registers and formulas are in `docs/om1-vsc-spec.md` section 13.

- **Two modes and the kinds of run.** DISPLAY cmd 13 (`0x501d7286`) copies the request's 40 bytes to `0x62a3eac0`
  (`0x501d6a58`) and its byte +4 to the mode byte `0x62a3eafc`. Cmd 14 (`0x501d729b(device, message)`) picks the run
  by that byte and calls the start path `0x501d6bec(device, a0 mode, d1 kind)`:
  - *mode byte 1, the live view:* the message's +4 and +8 are the buffers of the main and the second area (both
    must be set, `0x501d72b8..c3`); kind 1, start-path mode 1. Kind 1 measures the main area with the scale s =
    `N << 16 / (w * h)`, kind 5 the second area with `(N >> 3) << 16 / (w2 * h2)` (`0x501d6d24..4b`,
    `0x501d6d87..b1`); no address goes to the set-up, and the component field is 0 (`0x501e1488(ch, 0)` at
    `0x501d6e01`). Each end's cmd 16 starts the other kind (`0x501d742e..3c`).
  - *mode byte 3, playback:* the first non-zero of the message's +4, +12, +16 and +20 is the buffer, and its
    place the kind 1..4 (`0x501d72dd..0x501d731f`); start-path mode 2, one run a cmd 14. The scale is
    `N << 15 / (w * h)` (`0x501d6f43..63`); the request's image handle (+32), unless 0 or -1, goes through
    `0x50534dd1` to an address the set-up looks for among the planes (`0x501d6fa7..c0`); the component field is
    kind - 1 (`0x501d6fd3..d8`).
  - A kind above 6, a mode above 3 or an area of no width or height starts nothing (`0x501d6bfa..27`); each s is at
    most 8190. The request (offsets from `0x62a3eac0`): +8 u32 N, +12 u16 the bin count (clamped to 32..128), +14
    u16 the clip, +16 the main area {x, y, w, h}, +24 the second area, +32 the handle.
- **The components are Y, R, G and B.** The field `0x501e1488` stores is HIST2[25:24] (mask `~0x03000000`). In
  playback CapPlh::execute (`0x50be03c2`, CapPlh_PlayHistogram.cpp, "APP_HISTOGRAM_EXEC_MODE_STILL") makes four
  starts through the API's start (`0x503ed991`, api_histogram.c, id `0x170006`: its request is {the buffers of kind
  1 and of the second area, of kinds 2, 3 and 4, the device}). The first has its buffer `0x62b1205c` at +0 and
  logs "Disp_Start_Histogram_Calculation Y err" on failure, the second `0x62b11e5c` at +8 ("R err"), the third
  `0x62b11c5c` at +12 ("G err"), the fourth `0x62b11a5c` at +16 ("B err"). Each is bracketed by calls that name
  the event `0x04020301`, cmd 16's post to queue 6 (`0x50b7e281` before it, `0x50b7e314` after a start that
  succeeded; I: registering for the event and awaiting it), and followed by the stop (`0x503edc05`). So kinds
  1..4, HIST2[25:24] 0..3, are Y, R, G and B.
  OlyHfwOpePlyCom::getHistogram copies the four series out in that order with the logs yChannel, rChannel, gChannel
  and bChannel (`0x50acdeb0..0x50acdf8e`), and the GUI draws them white, red, green and blue (X, below). CapPlh's
  divisions: 64 bins with N 1024 and clip 64, 128 with 3072 and 128, 32 with 256 and 32 (`0x50be0439..97`).
- **The read-out.** One series a run: `0x501e150e(ch, n, buffer)` reads n / 2 words from `+0x4000`, two 16-bit bins
  a word, the low half first, clips each to the mirror's HIST3[31:16] and stores it as a u32 in the buffer the
  message named (`0x62a3eb00`, or `0x62a3eb04` for kind 5: `0x501d737a..91`). That buffer is the consumer's own
  (CapHis's `0x62b07ccc` and `0x62b080cc` in the live view, CapPlh's four in playback; X), so the ring
  `0x62a3cab8`, written after it, is a second copy: 4.2.1's open item on the ring's reader. There is no register
  per component: the component is a field of the run.
- **The end and the stop.** The channel's ISR (`0x501de8df`) takes INTST1 & INTEN1 (`0x501e049e`). For bit 8 it
  takes the channel's device from the opened word (`0x501c3f0d`, masked `0xff000004`, 2 or 1 for channels 0, 1, 2);
  where that device is not open it takes the channel's bit anyway and logs `0x37001418` once (`0x501dec88..d4`). It
  posts the done callback with that mask (`0x501d6a03`) and acknowledges with INTST1 = `0x100` (`0x501e14fc`). The
  stop (cmd 15, `0x501d734c` -> `0x501d709f`) clears the mode byte and `0x62a3eabe` and waits up to 50 ms for the
  running run's end. It writes no register: a run is never cut short, HIST1 is cleared only by the next set-up
  (`& ~0xf`, `0x501e142b` / `0x501e145e`), and INTEN1 bit 8 goes off only where a cmd 16 finds `0x62a3eabe` clear
  (`0x501e14d4` from `0x501d70fb`). A cmd 16 whose device is not open runs no handler (`0x501c3793..b9`), so no
  bins are read and nothing restarts.
- **What the unit counts (I; A-VSCHIST-4, A-VSCHIST-6).** No code computes a bin: the driver programs the unit and
  reads the result. The model takes:
  - *the pixels:* those of the source plane (HIST2[17:16]) as its resizer puts them on the output, inside the
    area. For it: the area is in output coordinates (the set-up adds the window's origin, `0x501e1379..f6`), the
    scale divides by the area's size in those pixels, and the source is named by a plane's DMA address.
  - *the bins:* value v in bin `v * count >> 8`, the count 32, 64 or 128 by HIST2[1:0] (0, 1, 2). D: the codes
    (`0x501e12b1..cb`); X: every request with code 0 asks 32 (INFO's); I: the unit's count at code 0. Code 3 (256)
    is never written (the clamp) and stays refused.
  - *the scale and the clip:* with HIST2 bit 8 a bin is `count * HIST3[15:0] >> 17`, with bit 4 at most
    HIST3[31:16]. D: HIST3[15:0] = 2 s with the formulas above, so the bins of an area sum to about N (1024 for
    the live view's main area, 128 for its second, half the request's N in playback); I: the unit's arithmetic.
  - *the component (A-VSCHIST-6):* 0 the pixel's Y; 1, 2, 3 its R, G, B by A9's inverse full-range BT.601, the
    conversion the lab's PNG uses. The names are D (above); the unit's own conversion is ? (no constant for it in
    the VSC's code).
- **The model (X; `emu/src/dev/vsc.mjs`, `emu/src/dev/vsccompose.mjs` histMeasure).** At the boundary that ends a
  run (A-VSCHIST-1) the model counts the bins from the bank latched for the frame measured and the source plane's
  rows as memory holds them then, with the compositor's own sampling (imgRows, shared with drawImg). A run whose
  source plane had its DMAEN bit clear has no source: its bins read 0. That is A-VSCHIST-2 where the firmware
  discards them, as before, and A-VSCHIST-5 (I) where it keeps them: the plane came on between the frame measured
  and the read (one run at the live view's start, X); what the unit gives without a source is ?. A plane the
  compositor does not draw as YC 4:2:2, an area not inside the plane, a register outside its writers' form or a
  count that does not fit 16 bits leaves the bins unknown, and a read of them is HIST_UNMODELLED with the reason
  (a bus error), as is a read with no run ended and a word past the run's bins. A-VSCHIST-3's form of HIST2 now
  takes the component field. S-SCENE renders the live view's frame only when a composite is taken, so the unit
  asks it for the frame of its own time (the device's histSource hook, `emu/src/lab/play.mjs` scene_frame): the
  bins do not depend on the composites taken (a `--replay` takes fewer than the session it replays).
- **The live histogram (X).** With S-SCENE's live view under camapp 3 IMG1 is the scene's 1620 x 1080 resized to
  the window's 900 x 600, and the request asks 128 bins, N 1024 and clip 64 over 800 x 600 at {50, 0} and 100 x 75
  at {400, 263} (HIST3 `0x00400116` / `0x004008bc`). The session runs on: the run the live view starts under is
  kept as 0 (A-VSCHIST-5), every later read returns the unit's 128 bins, the two areas in turn. They equal the
  histogram counted from the TFT's composite of IMG1 alone inside the area (the static scene: 40 bins set, sum 978;
  the spot's sum 121). They reach CapHis's buffers and, through TRA 944, the two series of the GUI's drawHistogram
  request (4.6.2). Without CPU 2 S-MODACK answers that send and the box stays as the GUI cleared it. With
  `--cpu2 native` OSD_DRAW_CPU2 draws every column from them: the second area's series from the box's bottom row
  in the colour at +34, the main area's above it in the colour +31, +32 or +33 for a bin below the limit at +26,
  below the one at +28, or neither (`0x51016015..31`; X: limits 1 and 127, so 0, 1..126 and 127). With a moving
  scene the bins change from run to run.
- **Playback's histogram (X; the Player's `camapp_play_native`, 4.8.11).** INFO's detail view asks 32 bins, N 256
  and clip 32 over the picture's 474 x 316 at {24, 62}, with the handle `0x0a02`: `0x9a43e000`, IMG1's address
  there, so the source field stays 0. Four runs follow, HIST2 `0x00100110` with [25:24] 0, 1, 2, 3 and HIST3
  `0x00200070`, each read into CapPlh's buffer of its kind; the view asks twice (eight runs). The GUI draws four
  panels of bars in GUI layer 1 itself (no drawHistogram send, so the same with `--cpu2 native`): bars of 11 pixels
  every 10 from x 555, the panels' bottom rows 129, 215, 301 and 387, a bar `ceil(bin * 78 / 32)` rows high, in
  the palette's white, red, green and blue. What the bins are counted from: the plane's bytes as they are.
  S-PLAYDEC writes no pixel (4.8.11; still so for this view since 4.8.13, whose decode has a pre-reduction S-IMGPIPE
  refuses), so the plane holds the imgpro fill's Y 11, Cb and Cr 128, and all four
  histograms are bin 1 at the clip. The test writes a pattern into the plane at the first start, and the four
  histograms and the bars are the pattern's. INFO no longer stops; the detail view's frame is still refused, for
  the highlight unit's area alone: HIAREA1-3 (`0x48c..0x494`, the window), written at PLAY by `0x501e1c14`,
  `0x501e1c47` and `0x501e1c51`, are in A13's never-written class (`docs/om1-vsc-spec.md` section 7).
- **The EVF switch under a run (X, D): not a defect of the unit's model.** Until 4.3.10 the lab's SWITCH (4.3.6)
  called DISPLAY cmd 2 OPEN of the EVF with a run on; under camapp 3 LV is now the firmware's own output change,
  whose stop (DISPLAY cmd 15) waits for the run: it ends 16.7 ms after the stop on the TFT still open (the ISR's
  a2 1, the opened word 1, no errlog), and TRA 588 opens the EVF 50 ms later (X). histEvfSession pins both: LV
  that way, and the lab's OPEN made by the test itself under a run (camapp 1 and 2's switch makes it, with the
  unit not started there). The opened word is 2 before the run ends; the run ends at the TFT channel's
  next boundary, 17.6 ms after the open, with the channel running as before (INTEN1 `0x101`, DMAEN 7); the ISR finds the
  device not open, logs `0x37001418`, posts the done callback with the channel's bit 1 and acknowledges, as its
  code says. The open keeps bit 8 enabled while it waits (INTEN1 `0x100`, `0x501e03f5`) and closes the channel
  216 ms later (INTEN1 0 at `0x501e032a`, CTRL2 6, DMAEN 0, INTST1 all ones at `0x501e0344`, the resets), with no
  run on. So the interrupt on a closed device is the firmware's own path once an open comes before the
  application's stop (TRA 937, 4.3.6's order), and nothing in the model is changed; the open's step stops at the
  harness's refusal of an error log in a DISPLAY step.
- **Default sessions (X).** Camapp 1 and 2 do not write HIST1 (4.2.1), so no bin is counted there. What their
  screens show of a histogram are stand-ins: the shooting screen's box is empty because S-TRAACK answers
  getHistogramData (TRA 944) without filling its series and S-MODACK answers the GUI's drawHistogram send (4.6.2);
  INFO's detail view shows S-PLAYSEQ's empty histogram (getHistogram, sync 7: the flags and bins 0).
- **Tests (X).** `emu/test/test_dev.mjs` vscHistUnits (59 checks, a read in the run after an ended one among
  them; 26 of them vscHistBins: the bins of a 16 x 8 plane against histograms computed by hand, for 128, 64 and 32
  bins, the scale, the clip, the firmware's scale formula, a resized plane, the four components, the source field
  and the source's own DMAEN bit, the frame measured, and eight cases that stay unknown). `emu/test/test_hist.mjs`
  histLiveSession (14 checks, without and with `--cpu2 native`), histInfoSession (12, the detail view's stop at
  HIAREA1-3 alone among them) and histEvfSession (5: the lab's OPEN under a run, 3; LV under a run, 2).
  `emu/test/test_camapp.mjs` playNativeSession's pinned stop moved: INFO reaches ID_ST_DISP_DETAIL past the bins'
  reads.
- **Corrections.** 4.2.1 and the vsc spec left `0x501e1488`'s second caller unread and its field at [31:24]: it is
  kind - 1 in [25:24]. 4.2.1's "which component, Y or another" is answered for the names (D), not for the unit
  (I). 4.2.4's and 4.8.11's stops at the bins' read are gone; 4.2.1's "bins with an IMG plane on are refused" no
  longer holds.
- **Open.** The unit's arithmetic and its conversion to R, G and B, and what it gives without a source: a camera's
  histogram of a known chart would settle them (the code cannot). HIST2 bit 20, HIST1[3:1] and HISTAREA3's role;
  the bin count at code 0; the unit's time per run. CapHis_Histogram.cpp's code that makes four rounds with the
  buffers `0x62b07ccc`, `0x62b084cc`, `0x62b088cc` and `0x62b08ccc` (`0x50bb6600..0x50bb69f0`; its caller and its
  mode are not read) is not followed. The detail view's composite (HIAREA1-3) and the decode's pixels (S-PLAYDEC),
  without which INFO's histogram is the fill's.
  The EVF switch's order (4.3.6). S-SCENE seeds a frame's noise with the count of frames rendered, which follows
  the composites taken while no run asks for a frame: a moving scene's bins can then differ by that noise between
  a session and its replay (not changed here).

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
  unchanged). Since 2026-11-10 a default session that takes a picture does: REC's header clear's fill, one kind-14
  mode-4 run in REC_IMAGE's task after H-RECIMGPRO (4.3.3, X).
- **Result (X, `emu/test/test_camapp.mjs` traRoutingSession 19 of 19; `emu/test/test_imgpro.mjs` 31 of 31).** After
  three passes of S1 and S2: MENU's cmd 15 wait as in 4.2.1, the fill's run (the bank's first and last words `0b 80 0b
  80`), its end taken natively, the unit powered down again; the menu opens (ID_ST_MENU) and closes; PLAY shows
  playback's ID_ST_NO_PICTURE with two more fills of the same bank and PLAY returns; their transactions are the
  components' (4.1.5). Without shots the menu and playback passes repeat (X, twice).
- **Next stops (X; their causes in 4.3.2, 2026-11-10).** (1) After the menu and playback passes a pass of S1 and S2
  records its picture (the fourth), and then no key is taken: MENU's EV_PRESS_MENU_KEY reaches UI_IN, the step sets no
  GUI event and sends no transaction; the same after 5 s of idle, for OK and PLAY. Cause (4.3.2): the menu's close
  restarts the through image, so S1 now passes the sequence parts' guard, the sequence waits in phase 102 for a
  take-ready TAKE would finish, and isCtrlReleaseEnable refuses every key; the queue-90 request is that S1's take
  request. (2) With pictures on the card PLAY shows ID_ST_NO_PICTURE, not the newest picture (camapp 1's S-PLAYSEQ /
  S-PLAYCOMP show it). Cause (4.3.2): the play module does not run, so its header getter finds the picture not loaded.
  (3) In that playback, right fills the other bank (bus `0x9a43e000`, same size and value), and the session stopped
  within 50 ms of idle after that fill. Corrected (4.3.2): the blocked send was the play API's request to PLAY_EXEC,
  full with S-MODACK's answered requests, not a send to queue 6 (the guard named the wrong queue); fixed, right and left
  are taken and PLAY returns.
- **REC and the album manager.** (The S-JPEGENC half is superseded by 4.3.3: on E143 rec_jpeg_exec runs in
  REC_IMAGE's own task, the fill natively, and S-JPEGENC keeps rec_jpeg_make_image only.)
  S-JPEGENC keeps REC's header fill (`0x5048ee61` from `0x5054c9d3`, kind 14 mode 4,
  41984 bytes of 0 at `0xab0bd800`): with the hook lifted under camapp 3 the fill ran natively, but rec_jpeg_exec runs
  in S-RECIMAGE's lab call, outside REC_IMAGE's task, and the request's wait blocked the lab task (X: "all tasks
  blocked", rerun 2026-11-10 at the first shot): a plain lab call does not move lab time when every task waits
  (`emu/src/lab/kernel.mjs`, no on_idle), so the unit's end, 1 ms of lab time on, never comes. It needs the call run
  where lab time moves (REC_IMAGE's own task, I, or a call whose idle runs the clock). S-ALBM is unchanged and not
  tried: the DCF numbering mount that would start ALBM_MAIN runs at the storage bring-up, before camapp 3's
  H-IMGPROINIT, and the movie module it asks next does not run (S-ALBM's text). Both texts now say so.
- **What still keeps camapp 1 the default.** (Updated 2026-11-10 in 4.2.4, "What still separates camapp 3 from the
  default": the composite below is refused only without A-VSCHIST-3, with which camapp 3's TFT frames compose; stop 3
  is fixed, 4.3.2; S-JPEGENC keeps the encode only, 4.3.3.)
  The TFT's composite is refused once the components start the VSC
  histogram (A13, 4.2.1), so a camapp 3 session publishes no frames (I: every frame check and golden play scenario
  would fail on that alone); the keys lost after a menu pass and a shot (1 above); playback with pictures (2, 3
  above), which camapp 1's checks (camappSession's PLAY, right, left) need; S-JPEGENC and S-ALBM. The golden diffs a
  camapp 3 default would cause are not measured (I: every play session's instruction counts and stand-in lists change:
  H-IMGPROINIT and S-STAGE9 at the start, S-TRAACK gone; S-BOOTDONE and S-OUTDEV are not camapp 1's).
- **Open.** The unit's time per run (A-IMGPRO-1) and the value's phase off a 4-byte boundary; kinds 13, 16, 17 and 6;
  the meaning of the power, stop and control words (I); the three next stops above.

#### 4.3.2 camapp 3 after the imgpro unit: the next stops (`control camapp 3`, 2026-11-10; D unless tagged)

4.3.1's three next stops, each followed to its cause (addresses E143's). The furthest point is now a pass of S1 and
S2 after the menu and playback, with playback's right and left taken on the way (`emu/test/test_camapp.mjs`
traRoutingSession, below).

- **Right in playback (stop 3): a lab defect, fixed (X, D).** The OXF main thread (task 57) waited in tsnd_dtq on
  PLAY_EXEC (0x3f), not on queue 6: the play API's request from `0x50404383` (API target 21, which the target table
  `0x606214a0` maps to 63, X) through the API sender's OlyQeWr (`0x503eba00`, timeout -1). PLAY_EXEC's kernel queue
  holds 40 bytes, 20 a message (X): the menu's PLAY_EXEC command 5 and PLAY's command 0 filled it, right's request was
  the third. Queue 6 was empty with the event task (164) waiting to receive (X: the data queue's control block from
  the kernel's table at kcb +232, its send and receive wait lists at +4 and +12, as ref_dtq `0x50013ca7` reads them).
  The queue's reader is the play module's task, which the lab does not run; S-MODACK answered each request after the
  step but passed the message on to the native OlyQeWr, so every message it answered stayed in a queue no task reads
  (with one exception, the native lens's two queues, below).
  The guard named queue 6 because it kept one record per call site: UI_IN's key posts to queue 6 through the same
  site (OlyQeWr's tsnd_dtq, return `0x5002c1f8`) overwrote the blocked call's queue (X).
  - Fixed: S-MODACK takes the message as the module's task would (OlyQeWr returns E_OK and the message is not put in
    the kernel's queue), as S-DISPQ does for the DISPLAY queue (`docs/om1-input-spec.md` section 7); the guard keeps
    its record per calling task and site and names the task (`emu/src/lab/play.mjs`). With the old S-MODACK restored
    for PLAY_EXEC alone (traRoutingSession's control) right's request blocks again and the guard reports "queue 63 ...
    in task 57" (X).
  - The queues a task the lab runs reads leave S-MODACK, since it now takes what it answers: with the native lens
    LENS_MAIN (92) and LENS_COMMAND (91) wait on LENS_EXEC (0x2e) and LENS_COMMAND (0x31), both in S-MODACK's set
    until then (X: the tasks in the queues' receive-wait lists after the bring-up; no other of its queues has a
    waiting receiver in E143's default session, X). Their asynchronous requests go to the tasks alone (before,
    S-MODACK answered them too); a synchronous send to them still returns E_OK. The golden sessions post none (X:
    golden unchanged by it).
  - The same defect elsewhere (X unless tagged). 4.4.2's open item, a late workload pass ending in "task 165's
    request to queue 6": with S-MODACK's old way restored for every queue, the default session's workload passes (S1,
    S2, the menu, playback, 2 s; heapWorkloadSession's) stop at a PLAY up, task 165's send to TAKE_FUNC (0x5e), which
    holds eight messages, waiting (the guard now names it): at the eighth pass with master's code, the start's own
    request held too (the guard naming queue 6), at the ninth with the old way restored after the start; with the
    fix ten passes run, the queue empty (2026-11-10). E132's LOGGER_MAIN (4.7.5):
    its queue (0xdf) holds four messages (80 bytes), CATEGORY_MAIN's (0xe6) one, and with LOGGER_MAIN left out of
    S-MODACK the start, the clock set and modelcheck's keys (S1, S2, PLAY, INFO, PLAY) now run on (three messages
    held), so the old stop does not reproduce, with master's code before this fix as well (X), so not by it; what
    changed since is ?, and that it was LOGGER_MAIN's full queue under a guard naming queue 6 is I.
  - Not covered: a post to a module queue other than the API sender's stays in the kernel's queue. CapTak_Take's
    control `0x40` posts TAKE_EXEC command 5 straight through OlyQeWr (`0x503ebe46`, 4.1.7) at an S2 in phase 102;
    TAKE_EXEC holds 25 messages (500 bytes; X: one held after the shot below). Covered since 4.1.11: S-MODPOST takes
    it and the other direct posts the module's task would take (E143).
- **No Picture (stop 2): the play module does not run (X, D).** At PLAY the GUI goes ID_ST_PREPARE, ID_ST_DRAWING and
  ID_ST_DISP_SIMPLE, then ID_ST_NO_PICTURE on event `0x9627` (X). The chain:
  - PLAY sends PLAY_EXEC command 0 from the OXF main thread, which S-MODACK answers with status 0 (X); the capability
    then logs "[chls]Play_Picture with ph =%d is successful" for the picture handle `0x101` (X: the status 0 at
    `0x50bb1f4c`; that this status is the request's answer is I).
  - The play capability's get_picture_header_info (`0x50bb1f58`) calls Play_Get_Picture_Header_Info (`0x5040ce8f`,
    which runs the play module's getter `0x518b629e` in the caller's task): the handle's record (its lookup
    `0x518b5181`) is there, but the picture's record (`0x518bfc7e`'s) has its u16 +12 at 0 where 1 passes, so the
    getter's code is 6152 (6155 without a record; X: 6152) and the API returns 1 (X).
  - The capability then sets its state word `0x62b0dc8c` to 4 (`0x50bb20ce..dd`, after its log "get_picture_header_info
    failed"; X: 4), which the single component's playOneFrameStart reads (`0x50bc0153`): neither 0 nor 1, so it
    answers 0xf0000001 (`0x50c5007b`, X). Its response, event 581 (evTraPlyResponse, built at `0x50ad3c4b` with the
    code 0xf0000001 and kind 2, X), reaches the async RSB in its state 6 (`0x50ad2f8d`, "PlyComAsyncRsb aft ack rcv
    evTraPlyResponse"), whose notify (`0x50ad2bc2`) runs the single-frame callback (`0x50b7118d`); task 162 hands the
    GUI the callback (27, 39) with the result 0xf0000001 (X: the first single-frame request's result 0 had shown
    ID_ST_DISP_SIMPLE), and the GUI's handler (`0x510d6803`, case `0x510d6c89`) sets event `0x9627` (its parameter 10
    or 64 by `0x51287def(1135)`).
  - So the answer that leads there is S-MODACK's to Play_Picture: on the camera the play module's tasks (PLAY_MAIN on
    PLAY_EXEC, PLAY_LOAD 0x18, PLAY_IMAGE 0x17, PLAY_DECODE 0x76, 4.8) would load the picture and mark its record (I;
    the writer of +12 is not read). Not S-TRAACK (it answers no transaction under camapp 3, 4.1.5) and not the album
    manager: playOneFrameStart's Get_Album_Num (`0x503dd27f`) runs only after a result 0 (`0x50c500a5`).
  - The fills: PLAY's two of the through image's bank and right's of `0x9a43e000` go through `0x50b90189` (from
    `0x50b927fb` and `0x50b9280c` at PLAY, `0x50b936d7` at right), called from the single component (`0x50c1b9b9`,
    `0x50c4ecc8`) in the OXF main thread (X: the stacks at api_tft's `0x504223a4`); what they clear is I (the image
    plane before the picture).
  - Left documented: the neighbour is the play module (segment 9's PLAY_* with the JPEG decode at 4.3's seam C2; 4.8
    "Playback"). A stand-in that marked the record loaded would answer for the module's load and decode and move the
    stop to the requests that follow (I); none is added.
  - Followed in 4.8.11 (2026-11-10, X; the writer D): with the play module's tasks native (an opt-in under camapp 3)
    PLAY_LOAD's load sets the record's +12 (`0x518b53b7`, the writer read there), and once the picture's stream carries
    the firmware's own Huffman tables (A-JPEGDHT-1) the getter answers 0 and PLAY shows the picture's view, its decode
    stood in at the image library (S-PLAYDEC). Without the opt-in this stop is unchanged. (Since 2026-11-11 the view
    is decoded on the pipeline block's model, S-IMGPIPE, and S-PLAYDEC keeps a pre-reduced view alone, 4.8.13.)
- **No key after a shot (stop 1): TAKE does not finish the take-ready (X, D).** Before the menu CapThr's state word
  `0x60362b38` reads `0x02010202` (S-TAKEOVER's static value, 4.1.7), so S1 (826) is refused in phase 101 by the
  sequence parts' guard `0x50bcdef7` and goes no further, as in 4.1.7. The menu's close restarts the through image
  natively and the word becomes `0x01010202` (`0x02010202` again in playback, `0x01010202` at its return; X). S1 then
  passes the guard: the sequence moves to phase 102 (setter `0x50cc6121` from `0x50c87f1a`, the phase word
  `0x60364a1c`; X), CapTak_Take's take API (`0x50417cd9`) sends control `0x20`, TAKE_EXEC command 0 through the API
  sender, the queue-90 request of 4.3.1, which S-MODACK answers (TAKE_MAIN's own answer is the same status 0, 4.1.8),
  and S2 (824 in phase 102) control `0x40`, command 5 straight to TAKE_EXEC (X). Nothing finishes the take-ready:
  event 794 (CmpSts_ObserverNotifyTakeReadyFinish), which the sequence takes in phase 102, comes from TAKE_MAIN's
  module event `0x04080032` through Com_EvSenderManager (4.1.10), and TAKE does not run (TAKE_EXEC is S-MODACK's, X:
  no 794 is built); the menu's shot is the session's first take request. The releases (828, 827) are taken in
  phase 102 and leave
  the sequence there, with no take API call (X; after S2 only: S1 released alone goes to phase 111 and back to
  STANDBY, and since 2026-11-11 S-TAKERDY posts TAKE's event, so a shot gets 794 and phase 103 and a full shot waits
  in phase 106, 4.1.12). The key path then refuses: the application's key handler (task 165)
  asks isCtrlReleaseEnable (`0x50ab5c04`), which answers 1 for the phases 100 and 101 and otherwise logs
  "isCtrlReleaseEnable UNRESPONSIVE(Seq=%d)" (`0x50ab5c26`) and answers 0, so MENU, OK and PLAY send no GUI event (X:
  for MENU after the shot it reads the phase three times, at `0x50ab5c09`, `0x50ab5c12` and `0x50ab5c23`, and logs
  Seq 102).
  - A shot before any menu pass leaves the keys working because its S1 never reaches the take (4.1.7's guard); the
    menu is not needed as such, only a running through image (I: playback's return sets the word too, X).
  - Left documented: the neighbour is TAKE (TAKE_MAIN's take-ready and the notifications its events become, 4.1.7,
    4.1.8; with `--take probe` it stops at EXP_MOVIE, and a second shot is not taken either: S1's release leaves the
    sequence in phase 111 behind a stop TAKE_MAIN does not read, 4.1.10). A stand-in posting TAKE's notifications
    would invent the
    take-ready's progress, as 4.1.7 declined; S1 in camapp 3 with the through image running needs what S-RELSEQ's
    retirement needs (4.1.8's list).
- **Result (X, `emu/test/test_camapp.mjs` traRoutingSession 24 of 24; 25 of 25 with 4.1.10's check, X 2026-11-11).**
  After three passes of S1 and S2 and the menu
  (CapThr's top byte 2 before it, 1 after): PLAY shows ID_ST_NO_PICTURE with three pictures on the card, the header
  getter's code 6152, the capability's state 4; right (one fill, of `0x9a43e000`) and left are taken and PLAY returns;
  a pass records the fourth picture with the sequence in phase 102, and MENU's EV_PRESS_MENU_KEY sets no GUI event,
  isCtrlReleaseEnable refusing it in phase 102 (since 4.1.12 and 4.2.7 that pass's shot waits in phase 106, where
  MENU sets no GUI event either, X there). The control (S-MODACK's old way for PLAY_EXEC) blocks at right and the
  guard names queue 63 and task 57. In both of its sessions the native lens's two queues are out of S-MODACK's set,
  LENS_MAIN and LENS_COMMAND waiting on them.
- **Open.** TAKE's take-ready and capture under camapp 3 (stop 1, with 4.1.8's list; with TAKE native the second
  shot, 4.1.10; the take-ready since 2026-11-11, 4.1.12); the play module (stop 2: its decode and INFO's histogram,
  4.8.11; read since, 4.8.13 and 4.2.7); posts
  to module queues outside the API sender (TAKE_EXEC's command 5; S-MODPOST since 4.1.11); E132's old LOGGER_MAIN stop
  (not reproduced).

#### 4.3.3 REC_IMAGE and the JPEG path (2026-11-10; D unless tagged, addresses E143's)

- **Why.** S-JPEGENC stood in for the header clear's fill because rec_jpeg_exec ran in S-RECIMAGE's lab call, which
  has no idle path: the imgpro unit's end never came (4.3.1, X). This round runs REC_IMAGE's own task instead, where
  lab time moves while it waits. It supersedes the S-JPEGENC half of 4.3.1's "REC and the album manager" bullet.
- **What S-JPEGENC stood in for.** Two calls inside rec_jpeg_exec (`0x505497e5`). (1) REC's header clear
  (`0x5054c982`) fills the header area's aligned middle through the image engine (`0x5048ee61`): a kind 14 mode 4
  request to the imgpro unit at `0x9c600000`, IRQ 300 (4.3.1). (2) rec_jpeg_make_image (`0x50549b42`) is no codec
  call of its own but an imgpro_mdl pipeline. rec_ImgPro_CreateParam (`0x50542363`) builds a 48-byte request on the
  stack: +0 the callback `0x505446b1`, +4 the packet, +8 and +12 from `0x50547cf7` and `0x50547e3b`, +32..+44 the
  aspect and flags. The create (`0x50491699`) allocates its context (9312, 7512 and 160 bytes) and gives an id, kept
  at the packet's +36. rec_ImgPro_ImageParam (`0x50542528`) sets the request's images: REC's trace names include
  rec_ImgProCtrl_Src_Bayer, _Dst_Prim, _Dst_Thum, _Dst_View, rec_ImgPro_Bayer2Ycc and rec_ImgPro_Ycc2Jpeg.
  `0x50542407` runs it (`0x50492758(id, 0xffff)`, then `0x504929e9(id)`; with bit 3 of property 53009 set and Mode
  neither 8193 nor 8198, `0x50492836` with a 16448-byte buffer in place of the first), and
  rec_ImgPro_Jpeg_Result (`0x50542ce1`) reads the result. Which of the library's kinds the pipeline issues, and which
  unit encodes, is ?. The kind table `0x6065a834` has 22 kinds. The starts read so far reach `0x9c600000` (13, 14,
  16, 17, 6), `0x9bf80000` (9), `0x9c580000` (8) and `0x9c080000` (19, 20); kinds 5, 7 and 18 reach their unit
  through a register (not read).
- **Who drives REC_IMAGE.** REC_IMAGE (task 28, `0x50541c45`) receives 316-byte packets from REC_EXEC_IMAGE 70 (its
  id at `0x60043250`; receive `0x505398bf`). On CPU 2 the same entry takes queue `0x6004369a` (by `(0x8050)`,
  `0x50541c4b`). Three places read `0x60043250`: that receive, REC_PREPRO's post and the object-name list
  (`0x519f9cb7`, which names the queue and posts nothing). REC_PREPRO (task 30, `0x5054ed2a`) takes packets from
  queues `0x60043254` and `0x60043256`, which REC_MAIN posts to (`0x50539b61`, `0x5053a388`). It runs rec_precon_exec
  (`0x5054ef23`), which sets ImgAspect (the record's +38122 or 1, `0x5054ef5e..0x5054ef84`) and does the WB
  precondition for Mode 8194. It then posts to REC_IMAGE (`0x5054edcf`), or to `0x6004325a` when Command (+52) is 19.
  On CPU 2, `0x5054ede2` moves packets from REC's ring to `0x6004369a`.
- **What REC_IMAGE does with a packet.** rec_bracket_entry (`0x5053b1dc`) sets FileType 1. It takes the last frame's
  index from the record's bracket fields (`0x5053b321..0x5053b382`): 0 when +38074 and +38076 are 0 and +38086 is 1
  (unless `0x5053dce6` gives 5), else the product of +38078, +38080, +38086 and a multiplier less 1 (the multiplier 1
  unless `0x5053dce6` gives 5, `0x5053b2d4..0x5053b319`). Then, per frame:
  - rec_bracket_update (`0x5053b39c`) sets ImgAspect from the record's +38122 (Mode 4097 with the packet's +220 0,
    `0x5053b45d..0x5053b469`) and gives Free its result;
  - rec_make_image_pre (`0x50541db7`);
  - rec_make_image (`0x50541e55`): its Mode table `0x606dff34` sends 4097 to rec_make_image_exec (`0x5054208e`), which
    calls rec_jpeg_exec (`0x5054215e`);
  - rec_make_image_finish (`0x50541ec5`): its table `0x606dff80` sends 4097 to `0x50541f20`, then `0x505422f1`;
  - pAlive's word cleared (`0x50541d5f`).

  This repeats until rec_bracket_finish (`0x5053b761`) finds the frame index past the last. TAKE fills the bracket and
  aspect fields from the settings store (`0x503bbd26..0x503bbd98`: ids 35217, 38737, 38769, 38785, 40401;
  `0x503bc035..0x503bc044`: id 12417).
- **The hand-over to REC_FILE (corrects 4.8.10's "Who posts it").** `0x505422f1` posts to REC_EXEC_FILE 69
  (`0x50542359`) only when `0x5054ca14` gives 0. For Mode 4097 it gives 1 when the record's +38006 (TAKE's setting
  39265, `0x503bbc66`) is 0 or `0x5054bf6c` is 0. `0x5054bf6c` is 0 for 4097 unless the record's +38764 is 22
  (`0x5054c02c`). So a normal JPEG goes through REC's packet ring (`0x5054eaf0`: 120 slots of 316 bytes at
  `0xa3323a38`, heads at `0xa33235fc`). REC_FILE's flag is then set with pattern 1 across the cores (`0x5054de46`):
  entry 7 of the bind table `0xa332ce5c` is {core 0, REC_FILE's flag `0x60043182`, 1}, and the set goes through
  cpu_conn `0x50035afd` to core 0. REC_FILE waits for the pattern 3 and takes the ring with `0x5054ebc8(1)`. The same
  handler runs, returning to `0x5053f249` (4.8.10's "bit 2" and "bit 0" are the patterns 2 and 1). REC's shared init
  `0x5054dbe8` fills the bind table. REC_MAIN_CPU2's task (`0x5053d5dc`) runs it at its start on CPU 2 (`0x5053d5e4`),
  and so does CPU 2's ring task (`0x5054ede9`). With Free set, REC_FILE's handler ends with REC's reply to the
  packet's ObjResponse (`0x5053984b` from `0x5053f3bb`).
- **The lab (X, `emu/src/lab/rec.mjs`, E143 only).** At the first picture, besides H-EXIFINIT, H-RECINIT and
  H-RECFILE:
  - H-RECSHARED runs REC's shared init natively;
  - H-RECIMGPRO runs the image library's IRQ attach, id bitmap clear and the unit's init, where camapp 3's
    H-IMGPROINIT did not run them;
  - H-RECIMAGE starts task 28 with act_tsk.

  S-EXIFPRM also writes the six settings fields above, each read natively with TAKE's settings read `0x500417da`.
  S-RECREQ posts the packet to queue 70 with REC's post `0x5053990f`, as REC_PREPRO does; its pAlive is a word of the
  lab's set to 1, and its ImgAspect is left to REC_IMAGE. S-RECREQ also takes REC_FILE's reply, since no requester
  owns ObjResponse in the lab. Lab time then runs in 5 ms slices until the reply comes and both tasks wait again.
  S-JPEGENC keeps rec_jpeg_make_image only. S-RECIMAGE retires on E143; it stays on E146 and E147, where no rule reads
  REC_IMAGE's addresses (since the same day a rule does and it retires there too, 4.3.5).
- **What runs (X).** S2's packet is made in REC_IMAGE's task as one frame:
  - the header clear's fill is one kind-14 mode-4 run of 41984 bytes of 0 at the file's buffer (`0xab0bd800`), its
    end 1 ms later as IRQ 300 (A-IMGPRO-1);
  - then the encode (S-JPEGENC), the header, the ring and REC_FILE's file steps, with 4.8.10's warnings and no other;
  - REC_FILE replies Status 0 with Free 1; ImgAspect is 1 (setting 12417) and pAlive is cleared;
  - the reply comes 1 ms of lab time after the post, at the fill's end; the lab's loop runs one 5 ms slice.

  Two shots in one session reuse the same buffer and give two files. Camapp 3's run is unchanged
  (`test_camapp.mjs` traRoutingSession 19 of 19). Without H-RECSHARED, REC_FILE never took the packet. Without the
  bracket fields REC_IMAGE looped, the last index being 65535, each frame a new buffer. With pAlive 0 it would clear
  the word at address 0 (D).
- **The picture's bytes (X).** The file keeps its size (73,410 bytes with the live view). 4 bytes differ from the
  previous round's, each 0 before and 25 now. Two are ISO (0x8827) and StandardOutputSensitivity (0x8831) (exiftool).
  The other two (file offsets 5286, a halfword, and 5292, a word) lie in the Exif segment's value area after ExifIFD's
  values, before the maker notes (from 5560), where no IFD entry points (an IFD walk; exiftool shows neither). That
  they hold the record's +4202 and +4208, 6 bytes apart as these are, is I. rec_bracket_after_trig (`0x5053bfe2`, from
  `0x5053be89`) writes the record's ISO (+4202, +4208) from an Sv through `0x50590ca6` when the record's +7626 is 0;
  the Sv 0 gives 25 (corrected in 4.3.5: on the lab's path the Sv is the record's +38174, 0 as the template leaves it,
  not the packet's +294, X; 4.3.4: rec_bracket_update_iso sets the packet's SvAdj, +294, from the same +38174 and the
  gain). Without the aspect
  setting the maker notes' AspectRatio was "Unknown (1 0)" and AspectFrame 0 0 55274 2911; with it they stay 4:3 and
  0 0 5183 3887.
- **The encode natively (X).** With S-JPEGENC lifted, rec_ImgPro_CreateParam and the create run. rec_ImgPro_ImageParam
  then divides by zero (`divu` at `0x505099e0` in `0x505099c0`, called from `0x50509ac9` with `0x6246cfc8`, whose
  halfwords +4 and +6 are 0: the request's two G gains, not a geometry, 4.3.4) before any request to a pixel unit. So
  S-JPEGENC still covers what the lab does not compute: the development of a RAW the lab never captures (Bayer2Ycc),
  the JPEG encode, the thumbnail and the view.
- **Open.** The pipeline's kinds and its JPEG unit (above); the WB gains behind the divide (4.3.4); REC_MAIN,
  REC_PREPRO and api_rec (S-RECREQ: the Sv, ObjResponse, Number); TAKE's record (S-EXIFPRM); REC_IMAGE on E146 and
  E147, which needs a rule (done the same day, 4.3.5); which core makes a normal still (4.3's ?) is unchanged: the lab
  runs CPU 0's.

#### 4.3.4 The still's image parameters and the encode (2026-11-10; D unless tagged, addresses E143's)

- **Why.** 4.3.3 stopped the native encode at a divide by zero inside rec_ImgPro_ImageParam and took its operands for
  a geometry record. This round reads them back to their source, follows rec_jpeg_make_image past ImageParam and reads
  where the file's exposure values come from.
- **The divide's operands are white balance gains, not a geometry (corrects 4.3.3).** ImageParam gets the request's
  context from the packet's ImgProID[0] (+36, the create's id) through `0x50491c98` (X: id `0x6246b220`, context
  `0x6246b254`) and fills a parameter block at the context's +7540 (X: `0x6246cfc8`, the fault's a0). Its halfwords
  +0, +2, +4 and +6 are the shot record's +37810, +37816, +37812 and +37814 (`0x50542640..0x5054266c`), +8..+14 the
  same times the packet's GainAdj (+292) over 256 (`0x5054266f..0x505426af`). ImageParam ends by handing the request
  to the image library's parameter set (`0x50491c9f`, called at `0x50542c97`); inside it `0x50509ab4` (called at
  `0x5049256c`, X: the stack) has `0x505099c0` divide +0 and +2, << 7, by the smaller of +4 and +6, each quotient
  clamped to 1..65535: R and B over G (I, from the arithmetic). The record's four are 0 in the lab (X).
  - Why white balance (D): REC_PREPRO's rec_precon_wb_exec (REC's trace id 39, `0x5054eeeb`) writes them, below;
    rec_precon_exec's path for Mode 8194 writes 128 to each, or the record's +6326, +6334, +6504 or +6512 halved
    (`0x5054efc7..0x5054f02a`); rec_imgpro_cb_wb_exif (id 110, `0x505458ad`) writes the library's four back to the
    record's +6326.. (times 512 over GainAdj, for Command 16). The EXIF module's tag table (body `0x6058e0`) puts
    +6326 at a maker-note tag 0x100 of four u16 and +6594 at 0x610, which exiftool reads in the file as Olympus
    WB_RBLevels and GainBase (X: 256 256 256 256 and 256, the template's).
- **Who fills them on the camera: REC_PREPRO, from TAKE's shot fields.** rec_precon_exec (`0x5054ef23`, REC_PREPRO's
  task, 4.3.3) calls rec_precon_wb_exec for a still whose record's +7626 is 0 at `0x5054f784` (other modes at
  `0x5054f101`, `0x5054f13a`, `0x5054f736`, `0x5054f76b`), which calls `0x5053823f(record, HandleTarget, Mode & 0xf000
  is 0x2000)`. That function:
  - first asks REC's cache (`0x505387c9`): 33 slots, a 36-byte block at `0xa33201b8 + 36 n` and a 336-byte work
    record at `0xa332065c + 336 n` with its key at +320; the slot whose key is the record's +38532 (low half) is copied
    to the record's +37810.. and the computation skipped, `0x50538ced` still run (`0x50538522`) (not when the record's
    +41000 has bit 2, or its +38764 is 11 with +38118 not 0 and the flag 0);
  - else computes the block: from the record's +6334, +6512 or +6504 halved (by +38775) when +7626, or +6140 with
    +41001, is set and +37992 (I: the white balance's mode) is 0 or 4; otherwise from a 336-byte work record of its
    fields (+38190, +38196, +10542.., +38160, +38008, +37992, +37988, +37990, +6720, +38764, +38210, +38775) and the
    object `0x50534dd1(0x503afb12(HandleTarget))`, through TAKE's code (`0x503909cf` -> `0x50390fcb`;
    `0x50538ec8` -> `0x503972f3`; `0x50538feb`, `0x50538ced`; I: its white balance computation, in the fixed-point
    block whose role 4.1 left ?), then `0x50390ed5` for the rest of the block (+14 and +16 4095, +18.., I: nine
    halfwords);
  - then `0x50538887` keeps the block in the cache and writes it to the record's +37810 (`0x5053894a`), and
    `0x50538979` writes the record's +7444, +7446, +6504.., +6334.., +6512.. (doubled), +7490.. and +7494...

  So neither the capture sequence, the sensor mode table nor TAKE's S2 path writes the divisor, but REC_PREPRO, from
  the cache or from the shot record's fields that TAKE fills (a scan for the offset 37810: TAKE's code holds none; the
  image's three users outside REC, `0x508686f0..0x50869f36`, lie among the iseq_pixshift_sr_*.c functions, a 36-byte
  copy there among them, I: High Res Shot's). The default still's white balance is Auto (X: exiftool's WhiteBalance and
  WhiteBalance2, the template's).
- **In the lab (X).** S-RECREQ posts to REC_IMAGE's queue, so rec_precon_exec does not run and the block stays the
  template's 0. Run natively on the lab's record (a probe): rec_precon_wb_exec takes a cache slot whose key 0 matches
  the template's +38532 0 (the restore answers 1; all 33 slots' keys are 0, the cache never written in the lab) and
  the block is 0 again; with a key not in the cache (a probe's) the computation divides by zero at `0x503932d7` (in
  `0x50392d64`, under `0x50390fcb`) on its zero inputs. The source is a computation over TAKE's shot fields (I: the
  white balance the live view measures among them, 4.2 seam B, 4.2.2), not a table and settings, so no stand-in gives
  the gains and the divide stays.
- **rec_jpeg_make_image's steps.** `0x50549b42` runs rec_ImgPro_CreateParam and, with its status 0, the create
  (`0x50491699`, the id to +36), ImageParam (with the create's status 0), the run (`0x50542407`, with ImageParam's 0),
  rec_ImgPro_Jpeg_Result (`0x50542ce1`, with the run's 0) and, once the create has run, the release in every case
  (CreateParam's non-zero status skips both, `0x50549b7f`; the release `0x5054322e`: IFinishID +40
  through `0x5054381a` and `0x5048e6ab` when set, `0x5054372e`, `0x5054363a`, then `0x50491c04` with the id, I: the
  library's delete), and sets Status (+208) to the status.
  - The run is `0x50492758(id, 0xffff)` and `0x504929e9(id)` (4.3.3); what they issue is not read.
  - Jpeg_Result, with PlayPic (+301) 0: Size (+192) = 41984 + the +36 word of the library's destination record for
    DstIndexPrim (+303; 56-byte records at the context's +6688; I: the primary JPEG's size); the record's +4884,
    +4888, +4892 (tags 0x100..0x102, exiftool's PreviewImageValid, Start, Length) 0 and +18488 (tag 0x331) the
    header's and primary's end rounded up to 128, less 12; then a kind 13 request (`0x5048ee39`: its byte +16 13,
    +20 the source, +24 the destination, +28 the count) copies 51200 bytes from the record's +41052 to Addr + that
    offset + 12 and Size grows by 51200 (`0x50542df8..0x50542e20`); then +4380 (IFD1's 0x202, the thumbnail's
    length) from DstIndexThum's (+305) record and, where `0x5054bf6c` gives 0, +3948 and +3952 (Exif 0xa002 and
    0xa003) from the primary's record's +12 and +14 (I: its width and height). The template's +41052.. are 0 (X);
    who fills them is not read. With PlayPic set the layout differs (not read; read in 4.3.9, 2026-11-11: the lab's
    packet has PlayPic 1 at ImageParam, X, so the layout above is not the one the lab's packet would take).
  - So a still's encode reaches the imgpro unit at `0x9c600000` for the header clear's fill (kind 14, modelled) and
    Jpeg_Result's copy (kind 13, not modelled); the development and the JPEG encode are inside the run, whose kinds
    and units are ? (the kind table `0x6065a834`, 4.3.3; read in 4.3.9: one kind 0 request to the pipeline unit at
    `0x9c200000`, which starts the JPEG codec at `0x99901000`).
- **Past the divide, a probe (X; the gains set to 128, a value with no source, in a probe only).** ImageParam returns 0
  and the run starts. Before any request to a pixel unit it reaches the library's allocator (`0x5048da64` ->
  `0x5048e0bd` -> `0x5048d7a5`, from `0x504a83e4`), whose free-list walk never meets its end marker (-1): it loops
  until the probe's budget of 200,000,001 instructions runs out at `0x5048d7b6`. The only request dispatched
  (`0x5046d814`) was the header clear's kind 14. Which list it walks is not read (I: one of the library's pools, which
  an init the lab does not run would set up).
- **The lab (X, `emu/src/lab/rec.mjs`).** On E143 S-JPEGENC now starts at the first step the lab cannot run:
  ImageParam's call of the parameter set (a hook on the call at `0x50542c97` skips it with the status 0), the run
  (returns 0) and Jpeg_Result (the lab's stream at Addr + HeaderSize and Size = HeaderSize + its length, as before).
  CreateParam, the create, ImageParam's body and the release run natively in REC_IMAGE's task. The files' bytes are
  unchanged (X: two shots, byte for byte the previous round's); the create gives the same handle at each shot (X:
  `0x6246b220`), the release having deleted it. E146 and E147 keep S-JPEGENC over all of rec_jpeg_make_image
  (S-RECIMAGE; until 2026-11-11, when the rule reads the points there too, 4.3.9).
  `emu/test/test_storage.mjs` storageSession checks the steps (E143 58 of 58); traRoutingSession's four
  pictures take them too (24 of 24; 25 of 25 after the round's merge, 4.1.10).
  - ImageParam's sources natively (D, X). Through `0x505489d4` ImageParam sets the request's four sources:
    rec_ImgProCtrl_Src_Bayer (`0x50549017`), _Src_Thumb (`0x505493be`), _Src_ThumbICam1 (`0x50549441`) and
    _Src_ThumbICam2 (`0x505494f5`; REC's trace ids 130..133). Each asks TAKE for the HandleTarget's (+116) buffer
    handle (`0x503af9de`, `0x503afb12`, `0x503afb5d`, `0x503afbf3`: an id 1..115 whose entry at `0x62a494a4 + 32 n`
    has the lookup's flag, masks 1, 1, 0x10 and 0x40, gives a halfword of it, any other logs `0x25000402` and gives 0)
    and MM's `0x50534dd1` for its address. In the lab shot 1's entry has none of the flags (I: TAKE, which does not
    run, fills it): each lookup logs `0x25000402` and MM logs `0x08010004` for handle 0 (X: four pairs a shot, the only
    logs from the post to the set's call; the record's errlog, which storageSession pins).
  - In keys (golden) the native steps add 18,866 instructions, 97 stops (28 get_tid, 20 memset, 8 errlog, 4 malloc
    and 4 free, 2 S-JPEGENC, 1 memcpy, 1 the release's observer and 29 single steps) and, in the player's status,
    these 8 logs' kernel events (harness entries +8) and the create's 4 allocations, freed by the release (heap
    new and freed +4, top +22,240); the 7 IRQ rows after it keep their pcs, only their instruction counts move, and the
    screen, the session's end in lab time and the file are the same (X).
- **The exposure values in the file.**
  - ISO (corrects 4.3.3, which had it from the packet's Sv as S-RECREQ leaves it). The packet's +292 and +294 are
    GainAdj and SvAdj (the dump's names), and REC_IMAGE sets both: rec_bracket_update calls rec_bracket_update_iso
    (id 55, `0x5053bca6`, from `0x5053b733`), which with the record's +38086 1 and `0x5054b8ce` not 1 (X: the path at
    `0x5053bdd2`) sets GainAdj to the record's +6594 and SvAdj to the record's +38174 plus a term of +6594 (I: 256
    log2(+6594 / 256), from the constants 256.0 and log10 2; X: 0 for 256); rec_bracket_after_trig (`0x5053bfe2`, the
    record's +7626 0) then writes the ISO (+4202, +4208) through `0x50590ca6` (X: SvAdj 0, ISO 25). +6594 is the EXIF
    template's 256 (H-EXIFINIT, `0x5042b0d1`). +38174 is 0: TAKE's takepic (`0x503bcd51`) writes it from TAKE's state
    (+3144's record, its +202, `0x503bcdcd..0x503bcde4`), with +38164, +38172 and +38178 from an exposure record's +6,
    +8, +10 and +38170, +38176, +38180 from its +56, +58, +60 (the takepic's argument's +48, or its request's +60;
    `0x503bcdac..0x503bce38`) and +38198 from the AE result object `0xc0ba` (`0x503bcecb`, with TAKE's +3604 1).
  - Tv and Av: ExposureTime and FNumber are the template's 0 (X: exiftool). The EXIF set (`0x5042992d`, which divides
    by zero in TAKE's state, 4.1.4) formats them from the record takepic filled; which of its fields it reads is not
    read. (4.3.11, 2026-11-13: the zero is IMG_PRECON's table, the set runs natively, and it reads Tv +38164 and Av
    +38178; ExposureTime is now its 1 s for Tv 0, FNumber 0/10.)
  - ObjResponse, Number, Packet: REC_MAIN (`0x50539b9c`) copies them from the requester's 16-byte message on its
    queue (the id at `0x60043252`): +0 ObjResponse, +4 Number, +8 Command, +12 Packet (`0x50539bc8..0x50539bdd`).
    REC_FILE's reply sends Number and Packet back to ObjResponse (`0x5053984f..0x5053987a`). The requester (I: TAKE
    through api_rec, 4.3's first step) does not run in the lab; S-RECREQ leaves them 0 and takes the reply.
  - S-EXPOSE's values cannot be delivered honestly: it sets the AE result objects `0xc12a`, `0xc0ba` and `0xc0ca`, and
    of the record's exposure fields takepic reads only +38198 from one of them; the others come from TAKE's state and
    the exposure record takepic is handed, which TAKE (not run) fills from what is not read. S-EXIFPRM writing
    S-EXPOSE's values there would invent that mapping, so it does not.
- **Open.** The gains' computation and its inputs (TAKE's shot fields; the cache's keys); TAKE's shot table
  (`0x62a494a4`) and MM's banks behind ImageParam's sources; the run's kinds and units (development, encode,
  thumbnail, view) and the allocator's list (the kinds, the stages and the JPEG codec read in 4.3.9; the pipeline unit
  at `0x9c200000` and the work buffer's source still open there); the record's +41052 block, the layout with PlayPic
  (read in 4.3.9), and Jpeg_Result's EXIF
  writes (ExifImageWidth and the thumbnail's length stay 0 in the file, X); takepic and the EXIF set for the exposure
  fields.

#### 4.3.5 REC_IMAGE on E146 and E147 (2026-11-10; D unless tagged)

- **Why.** 4.3.3 ran REC_IMAGE's task natively on E143 at addresses given by hand; E146 and E147 kept S-RECIMAGE
  (rec_jpeg_exec in a lab call, S-JPEGENC also doing the header clear's fill), as no rule read REC_IMAGE's parts there.
- **The rule (`emu/src/fw/facts.mjs` recImage, fact `rec_image`).** It runs where recFile reads REC_FILE's parts
  (E143, E146, E147; the E144 family has neither) and throws where a part's form differs. It reads:
  - the task: the static task that calls rec_bracket_entry (by its trace) within 0x200 bytes. It must open with `mov
    (0x8050),d1; movhu (Q),Dn` (Q its CPU 0 queue word) and keep the packet at sp + 4. Its first call must be REC's
    receive of the packet's size. Where the packet points at an image record, it must call the record's init before
    rec_bracket_entry;
  - pAlive's offset: the word cleared after rec_make_image_finish (by its trace);
  - REC's shared init: the function that binds REC_FILE's flag to entry 7 of its bind table, and the one byte it
    sets to 1 after that;
  - the image library's IRQ attach and id bitmap clear and the imgpro unit's init. The unit's init is the one function
    that writes `0x9c600004` and `0x9c600030`. Its one caller is the units' init, whose one caller is the library's
    init: four calls, `clr d0; ret`;
  - REC_FILE's reply: the call before the target of its handler's Free test, which must be "REC post_msg_main"'s
    function (by its trace, kind 0x1101);
  - TAKE's fill: the record offsets that rec_bracket_entry's bracket test and product and rec_bracket_update's
    aspect read. For each, the one TAKE site `mov ID,d0; mov 0,a0; call S; mov (4,sp),a0; clr d1; movhu (or movbu)
    d0,(offset,a0)`, with one settings read S for all.

  On E143 it reads the values given by hand before (X: `emu/test/test_facts.mjs`). On E146 and E147 each value was
  checked against the disassembly; pAlive is +0 on all three:

| Part | E143 | E146 | E147 |
|---|---|---|---|
| REC_IMAGE, task 28 | `0x50541c45` | `0x5051ee03` | `0x5052def3` |
| its queue word (REC_EXEC_IMAGE) | `0x60043250` | `0x6004328e` | `0x60043200` |
| shared init, done byte | `0x5054dbe8`, `0xa332ce59` | `0x5052c2e8`, `0xa332b8f1` | `0x5053b50f`, `0xa3322075` |
| IRQ attach, bitmap clear, unit init | `0x5048c3a0`, `0x5048ba3a`, `0x5050a6b2` | `0x5047e67f`, `0x5047dc11`, `0x504fe0d8` | `0x5048cf75`, `0x5048c507`, `0x5050d1aa` |
| REC's reply, from | `0x5053984b`, `0x5053f3c0` | `0x50516d81`, `0x5051c212` | `0x50525e69`, `0x5052b302` |
| settings read | `0x500417da` | `0x500423e1` | `0x50042360` |
| bracket fields, aspect | +38074..+38086, +38122 | +37726..+37738, +37774 | as E146 |

- **What differs on E146 and E147.**
  - The packet (276 bytes) and the image record (4.8.10). REC_IMAGE's task keeps the record on its stack (E146 sp +
    364) and inits it itself after the receive (E146 `0x5051ee45`). S-JPEGENC finds `Addr` and `Size` through the
    packet's +180.
  - Another stage. On E146 REC_PREPRO (task 30, `0x5052d324`) posts a normal still (Command not 19) to Q_REC_EXEC_RAWNR
    (the word `0x600432a0`, named by the object-name list; `0x5052d3d4`), not to REC_IMAGE's queue as E143's
    `0x5054edda` does. Its reader is task 32 (`0x5052fedd`; E147 `0x5053f112`), REC_RAWNR: the image's table of task
    names and ids, {24-byte name, u16 id}, gives "REC_RAWNR" 32 after REC_FILE 27 and REC_IMAGE 28 (E146 body
    `0x1a2b122`, E147 `0x1a35d02`; which code reads the table is not read). E143's image has neither the name nor the
    queue's (X: a scan). It copies the shot's record +37564..+37570 into the packet's +254..+260, outside the dump's
    names. When `0x5052acc1` gives 1 it runs `0x50518f3b` and `0x50520916` (not read). It then posts the packet to
    REC_IMAGE's queue (`0x5052ffd0`). That is the only CPU 0 post: the word's loads are REC_IMAGE's receive, that post
    and the name list (E147 the same, `0x5053f205`).
  - REC_IMAGE's loop is E143's with two additions. For Mode 4097 it calls `0x5052a1e8` (not read) and, when that gives
    0, `0x5052b021(packet, 30)`, which calls the packet's pFnSetPercent (+12) if set. After rec_bracket_update it
    clears RecordTarget in the image record (+34), where E143 clears the packet's (+286).
  - The hand-over to REC_FILE is E143's (corrects `emu/src/lab/rec.mjs`'s "the route on E146 and E147 is not
    read"). `0x5051f53d` calls `0x5052abf9`. On 1 it puts the packet in REC's ring (`0x5052d051`) and sets REC_FILE's
    flag through the bind table (`0x5052c568`); otherwise it posts to REC_EXEC_FILE (`0x5051f5a5`).
  - The shared init's ring holds 216 slots of 276 bytes on E146 (93 on E147; E143 120 of 316). E146 clears a third
    area (432 bytes at `0xa332b954`) and two more bytes after the done byte.
  - The ISO: rec_bracket_after_trig (E146 `0x505196b5`, from `0x50519557` when the shot's record +7632 is 0) takes
    its Sv from its caller `0x50519356` (the packet in a1). With the record's bracket byte +37738 1 (setting 40401, as
    in the lab) that is the record's +37826 (`0x505193c3`, `0x505194fc`), which the caller also writes to the image
    record's SvAdj (+38, `0x505193d2`). Only with that byte not 1 is it SvAdj (`0x50519547`). E147's caller is the
    same (`0x505284a3`, `0x505285dc`). E143's (`0x5053bca6`) has the same two paths: +38086, +38174 (`0x5053be39`)
    and the packet's +294 in SvAdj's place (`0x5053be7a`), +7626 for +7632.
  - Which path runs (X: an observe at each path's read and at rec_bracket_after_trig, one S2 per body): on E146 and
    on E143 the first, with d0 0 from the record's +37826 (E143 +38174), which S-EXIFPRM's template copy leaves 0.
    So the 25 comes from the parameter block, not from a packet's Sv. This corrects 4.3.3's and 4.8.10's "from the
    packet's Sv (+294), which S-RECREQ leaves 0": the packet's +294 is written from +38174 on that path, not read.
- **The lab (`emu/src/lab/rec.mjs`).** All three now run H-RECSHARED, H-RECIMGPRO, H-RECIMAGE and S-RECREQ.
  S-EXIFPRM writes TAKE's six fields at the rule's offsets, and S-JPEGENC does the encode only (since 2026-11-11 the
  parameter set's call, the run and Jpeg_Result at the rule's points, as on E143, 4.3.9). S-RECIMAGE and its
  path are removed: no body uses them. On E146 and E147 S-RECREQ posts in REC_RAWNR's place, so REC_RAWNR's copy and
  its check do not run. The four halfwords stay 0, and neither REC_IMAGE nor REC_FILE reads them on this path (X: log
  watchpoints on each task's own copy of +250..+261 see only OptView, +250).
- **What runs (X, E146 and E147).** S2's picture is made in task 28, which encodes once. The header clear's fill is
  one kind-14 mode-4 run of 41984 bytes of 0 at the buffer, ending 1 ms later; the driver's register writes are
  E143's (an MMIO trace). REC_FILE replies Status 0 and Free 1, with HeaderSize 41984 and BuffSize1 73,410.
  ImgAspect is 1 and pAlive is cleared. TAKE's settings read as on E143: 35217 0, 38737 0, 38769 1, 38785 1, 40401 1,
  12417 1. Two shots give `PB080001.JPG` and `PB080002.JPG` (73,410 and 73,397 bytes) from the same buffer.
  - Around S2 the firmware logs the REC warnings of 4.8.10 and no new code.
  - The session ends 34.1 ms later in lab time, so the movie time query's 0x39000903 is logged twice more. S-RECREQ's
    one 5 ms slice ends at the next idle, 34.1 ms on. On E146 the GUI task (171) is in a timed wait at the slice's start
    and runs about 1.0M instructions in it. Why it is busy then is ?; E147 is not profiled. On E143 the slice ends
    at 5 ms, as before.
- **The picture's bytes (X).** Per body the file keeps its size and differs in 4 bytes, each 0 before and 25 now: file
  offsets 288 and 312 (ISO 0x8827 and StandardOutputSensitivity 0x8831, exiftool) and 5286 and 5292. These are E143's
  4 bytes of 4.3.3, and the second shot's are the same. exiftool's other tags are unchanged (AspectRatio 4:3,
  AspectFrame 0 0 5183 3887). E143's file is byte-identical.
- **Tests (X).** `emu/test/test_facts.mjs` 1381 of 1381 (the rule on the three bodies, no rec_image on the other 15,
  and two forms it refuses on E143's image: the task's queue read made `mov`, the bind to entry 6);
  `emu/test/test_storage.mjs` with `--session`: E146 56 of 56, E147 38 of 38, E143 56 of 56, its REC_IMAGE checks now
  on all three; with `--sdxc`: E146 30 of 30, E147 12 of 12. `emu/bin/modelcheck.mjs` with the idle below: the 31 paths
  of the 18 ported bodies pass, each line as with one slice per idle but E146's and E147's TFT S2.
- **modelcheck (X).** With REC_IMAGE native, E146's and E147's TFT paths first failed the S2 check ("the frame holds
  1 value(s) after the rec view"); their EVF paths passed. The cause was the check's sampling against the lab's
  timing, not REC:
  - `emu/src/lab/camapp.mjs` tick posts the camera's timed events only at an idle slice's end (`emu/src/lab/play.mjs`
    idle_slice, D). END_RECVIEW and START_THROUGH_IMAGE_PROCESS, due inside the check's 1200 ms idle after S2, came at
    its end (14114.5 ms in a replica of the check's session on E146 and on E147).
  - The check composes at the TFT's next boundary, 1.2 ms later, before the GUI has redrawn the shooting screen: the
    OSD planes have the same banks, their contents blank, and the screen is drawn 50 ms later.
  - Before this change S2 ended earlier and the boundary came 51 ms after the slice's end, after the redraw. With
    master's code an idle of 17, 34 or 50 ms before S2 made the same check fail on E146.

  The check now idles in slices that end at each timed event's due time (`emu/bin/modelcheck.mjs` idle), so each comes
  when due. The Player's slices of at most 50 ms (`emu/src/lab/player.mjs` SLICE_NS) bring it within one slice. In the
  replica END_RECVIEW then comes at 13255.7 ms and the frame composed at 14132.3 ms holds 20 values. Every ported body
  passes so (Tests). The lab's own delivery is unchanged: open.
- **Open.** REC_RAWNR (what `0x5052acc1` decides, the RAW NR step); REC_MAIN's and REC_PREPRO's own work, as on E143;
  which call starts REC_IMAGE (I); the GUI task's work in the slice; the E144 family, whose REC_FILE no rule reads;
  the camera's timed events posted only at an idle slice's end, which modelcheck now idles around (above).

#### 4.3.6 camapp 3: the power-off error and the EVF switch (2026-11-10; D unless tagged, addresses E143's)

Two of 4.2.4's reasons camapp 3 is not the default, each followed to its cause. Neither stop is a lab defect: both
are where a lab stand-in (S-SHUTDOWN, the SWITCH of M10B) enters the firmware in a place the HLS components, which run
under camapp 3, did not expect. One lab defect on the way is fixed (the switch's module-9 post-condition, below). No
stand-in is added, the default is unchanged, and `emu/test/test_c3power.mjs` pins both (below). Run with the native
lens, as golden's sessions.

- **The power-off: the symptom (X, scenario `power`'s first lab).** The lever's off is decoded at 2.855 s of lab time;
  S-SHUTDOWN calls shutDown at 2.938 s (camapp 1: 2.888 s). startShutDown sends TRA 588 (the output device 0,
  `0x50af6789`), which the components answer 0 at 3.115 s, then TRA 586 (built at `0x50af6857` by `0x50abf10c`,
  vtable `0x60ddf848`; executed from `0x50af6860`) after setting the exec's timeout to 10000 (`0x50af6829`). Nothing
  answers 586: the lab task waits on the receiver's semaphore (156) in the remote path (`0x50af8515`), and at 12.938 s
  S-SHUTDOWN reports "the power-off had not reached its last write after 10000 ms"; the settings' save (`0x50af6a0e`)
  is never reached. The application's task 162 sends TRA 994 (`0x50b7d442`) at 3.211 s, which waits too (why it is
  not served is not read). In camapp 1 S-TRAACK answers 588, 586 and then 1061 at the exec at once (all at 2.888 s,
  X) and the sequence ends at 2.998 s.
- **Where 586 goes (X: the reactives' events in task 57; D: the handlers).** The shooting component
  (CmpSht_ShootingComponent_NEW, state 14; dispatcher `0x50d725f0`, case `0x50d732c7` -> `0x50c2f7ec`) passes a copy
  to its +152, the still category (state 11, `0x50d97c69` -> `0x50d97a8a`, which does the same), then the shoot mode
  (vtable `0x60ef7ea0`, state 13) to the camera base (state 13), whose common default (`0x50d74c59`) takes 586:
  `0x50d74c17` sends the start's answer (`0x50d7edc6`; event 425 follows, X) and enters the teardown (`0x50d749f1`),
  which sends event 422 down the tree. The shooting component goes from state 14 to 18 and 16, where it counts four
  event 25s from the children on its +336 list (X), and on its own event 500 (`0x50c7617d`: the word +176 of every
  child and of its +2008 and +2060 objects is 3) enters state 20 (`0x50d73976`). There it sends 422 to its +908, the
  flash capability CapFls_Flash (vtable `0x60e7985c`, `0x50d719fe`), and to each element of its +320 list (none, X),
  and waits for an event 25 (`0x50d73a64`, with no timer) that never comes. That is where 586 stops.
- **Why the flash does not answer (D, X).** CapFls (dispatch `0x50be870c`) is in its state 4 (running, I), which its
  state 3 takes on event 415 (`0x50be89a5..aa`; X: 4 at the shooting screen). In state 4 a 422 turns its flash state
  off (`0x50be8385`) and moves it to state 3 (`0x50be8b01..0d`), nothing more. Its stop observers (its +228 list, one
  entry: the shooting component's +468, vtable `0x60ef230c`, whose `0x50d7e085` posts event 25 to its owner) are told
  only for a 422 taken in state 3 (`0x50be8975`) or a 413 in state 1 (`0x50be875f`). So the component's 422 finds the
  flash running, stops it and gets no 25. At PLAY the flash is stopped before any teardown: the application's mode
  change sends TRA 987 (`0x50ad7fb2`; the component's case `0x50d731a0` -> `0x50c787b3`, "received
  evTraReqShtEndShootingService"), whose handler posts CapFls the 422 (`0x50c78945..53`), and CapFls goes to state 3
  (X).
- **The next stop (X, a diagnostic: the flash stopped first by its own 422, built by `0x50ab6ef9` and posted by
  `0x50d7f97e` from the lab).** The teardown then runs on: the shooting component goes 20, 17, 19, 6, 5 and ends in
  state 3, the category and the shoot mode end, and CmpSdw_ShutdownComponent (vtable `0x60eee834`, "Mode My
  Shutdown"; created by the teardown in both runs, X) is started (event 415, then 285 in its state 8; state 5 at the
  deadline). CapTak_Take (vtable `0x60e67330`) and the capability of vtable `0x60e6f0f0` (constructor `0x50bcb9a6`,
  name not read) take a 422 in their state 4 with nothing after it, and 586 is still unanswered at the deadline. The
  same pattern as the flash's is I (not read).
- **What the lab does not run (X, D).** Under camapp 3 the lever's off alone (the switch step, then 3.5 s of idle)
  sends no transaction and calls no shutDown, and neither does the shell's "sdk shutdown" ("request shutdown to GUI":
  `0x50afc199` posts event `0x03000000` through `0x503ea6bc`; 5 s of idle). Both runs left TRA 944 and 994 out; the
  lever's run without that filter (3 s of idle) shows only the GUI task's TRA 944 (task 168, from `0x50ada63e`), which
  it sends at intervals of up to 0.3 s before the lever too (X). S-SHUTDOWN's call is the shell's "sdk
  shutdown_api" ("force shutdown", the usage strings at `0x60e01d0f` and `0x60e01d56`). 4.7.4 names the
  camera-common component as the caller of shutDown; the strings of its range (`0x50d034a8..0x50d05ef3`) are the
  firmware update's ("start_usb_firmup", "Execute_FirmwareUpdate"), and whether it takes the lever is ? (its code is
  not read). So the camera's route from the lever to shutDown, and whatever ends the shooting service or stops the
  flash before 586, is the unmodelled neighbour; that the camera stops the flash (or sends 987) before 586 is I.
- **The firmware's own timeout (X, a local run with S-SHUTDOWN's deadline at 30 s; not committed).** 586 times out
  10 s after its send (13.114 s); startShutDown goes on (`0x50af6865`: 0xf0000043 -> `0x503c4a5d`) and sends TRA 1061,
  and the call then reaches the lab's instruction limit (fault 7). The 10 s deadline equals 586's own timeout and
  ends first, which power.mjs's comment now says; it is not changed, as a 10 s wait is not the camera's power-off (I).
- **The EVF switch: the symptom (X, scenario `switch-shoot`'s first LV).** The lab's SWITCH runs DISPLAY cmd 2 OPEN of
  the EVF at 3.088 s while the VSC histogram runs on the TFT (the run word `0x62a3eaf8` 1); the OPEN closes the TFT,
  the run's end interrupt finds its channel's device closed and the ISR logs `0x37001418` (`0x501deccc`, vsc spec
  section 13), and the step refuses the error log. Every EVF switch from the shooting screen under camapp 3 stops there
  (eye-burn's eye switch, switch-shoot's and tokens-3b's LV, X; from the Super Control Panel see below).
  Since 2026-11-11 the switch under camapp 3 is the firmware's own output change, the application's stop first, and
  this stop is gone (4.3.10).
- **The histogram's stop and its caller (X: the menu and the HDMI plug under camapp 3; D: the code).** The stop is
  DISPLAY cmd 15 (`0x501d709f`: clears `0x62a3eabe`, waits for the run's end), a synchronous send (`0x5002e39d`) from
  api_histogram.c's stop (`0x503edd30..47`, its line 685), reached (the stack's returns) through `0x50ab6533`,
  `0x50d8721d` and the histogram capability's `0x50bb69fe` / `0x50bb7356` (its name not read) from
  CmpSqp_SequencePartsBase's "Through Histogram Stop" `0x50ca1f39` (through `0x50c9b14d`, the method at offset 1072 of
  its vtables, nine words of the image hold it), which CmpShc_ShootingSequenceBase's case `0x50c59f2d` calls for TRA
  937; 937 is the application's (the call returning to `0x51057525`, after its log "stopHistogram"), through the HLS
  sender `0x50ae1b8e`. The writers named for this round (`0x501e127f`, `0x501e1488`, `0x501e14a4`) are only the start
  path's (vsc spec section 13). At the HDMI plug the application (task 165) sends 937 at 3.857 s, the run stops there,
  and the GUI's own output change (TRA 588 from `0x50abd14d`, task 168) follows at 3.906 s with CapIod's DISPLAY cmd 45:
  the histogram stops before the device changes.
- **Why that caller comes too late in the lab (X, D).** The LV button and the eye sensor are the lab's SWITCH: its own
  OPEN, H-RESEND, H-EYESTATE, then H-CONNECT's 131 to the GUI (`docs/om1-menu-spec.md` live switches). In camapp 1 the
  GUI's ConnectChangePlay then calls the camera API's output change (vt+20, `0x50afcd3a`, from `0x510c6c6b`) with device
  16, which sends no TRA 588 (D: with module 9's state 2 or 3 ChangeOutline compares the device asked for with
  `0x50ab651a`(1, 0)'s value through the pairs 0-0, 1-1, 2-4, 4-2, 8-16 and 16-8, `0x50abcfe9..0x50abd02c`, and
  returns 0 without running a transaction when they match; I: that value is the current device, the EVF after the
  lab's OPEN; with any other state, camapp 3's 0, it skips that test for `0x50abd08e`, and vt+20 then sends TRA 588,
  X, diagnostic 1 below), and only then does task 165 send TRA 1061 and TRA 937 (stopHistogram, from the
  application's display change, its stack's returns through `0x5107d4e5` beside the log
  "receiveReqChangeDisplaySubAppStateShootingStill", I): after the OPEN. The
  camera's own chain from EV_PRESS_EVFSW / EV_EYESENSOR_STATUS to the GUI's sender `0x5105053c` does not run (EVFSW
  `0x1707/0x170b/0x170f` and the eye sensor `0x2301` are not in UI_IN's groups 0..4; `docs/om1-input-spec.md` section 8,
  open). That the camera stops the histogram before it opens the EVF is I (the HDMI plug's order, X).
- **Two diagnostics (X).** (1) The firmware's own output change to the EVF, vt+20 with device 16 called from the lab
  task in lab time, sends TRA 588, and CapIod's DISPLAY cmd 45 with the code 2 opens the EVF (the opened word 1 -> 2);
  with no 937 before it the histogram's run ends on the closed TFT and `0x37001418` is logged once. So the device
  change does not stop the histogram itself; the application's 937 has to come first. (2) The SWITCH without its own
  OPEN and H-RESEND: the GUI's vt+20 sends TRA 588, and the GUI and the application then alternate (index 131's event
  storm, more than 810 GESetEvent calls): S-OUTDISP answers the EVF only while the lab's own OPEN holds it
  (`emu/src/lab/camapp.mjs` S-OUTDISP). Running the switch the camera's way needs that chain modelled; ordering 937
  before the lab's OPEN would invent its order, and is not done.
  Corrected in 4.3.10 (2026-11-11): the storm was S-PROP's stale output-device property, not S-OUTDISP; with it
  following CapIod's write the eye sensor's event alone runs the chain, 937 first, and the switch is run that way.
- **A lab defect, fixed: the switch's module-9 post-condition (X, D).** From the Super Control Panel, whose open
  stops the histogram (the run word 0 after OK, X), switch-scp's LV opened the EVF without an error log and then
  stopped at the SWITCH's own post-condition "module 9 read from 0x50abcfd7, 0x50abcfe2". ChangeOutline (vt+20's
  `0x50abcf49`) reads module 9's state at `0x50abcfd7` and, when it is not 2, again at `0x50abcfe2` (`cmp 3`); under
  camapp 3 the components write the state themselves (0 from `0x50ca4ae1`, 4.1.5) and both reads return 0 (X), where
  S-TAKEOVER's 2 ends camapp 1's at the first. The session's S-TAKEOVER guard lists both sites (`menu.mjs`
  TAKEOVER_READERS) and, under camapp 3, the components' readers; the post-condition allowed only the first. Under
  camapp 3 it now also allows the second reads the state 0 reaches (`emu/src/lab/play.mjs` MODULE9_SECOND_READS):
  ChangeOutline's `0x50abcfe2` and the application's `0x50abb044` (its test in `0x50abb032`: `cmp 2` at `0x50abb039`,
  then `cmp 1`), which the eye switch back to the TFT makes twice (X); CMP_MODULE9_READERS' others (the shooting
  component's `0x50c78bb4`, the HDMI plug's two in `0x50d787f0`), which the session's guard allows, stay refused at a
  switch (none is read there, X). camapp 1 and 2 keep the first site alone. With it switch-scp's LV and eye
  switches run and the Super Control Panel stays (X).
- **Tests (X).** `emu/test/test_c3power.mjs` powerOffSession (7 checks: the shooting component's flash and its
  observer in CapFls's list, the deadline with 586 unanswered, the component in state 20 with the flash moved to 3;
  the control with the flash stopped first ends the component in state 3 and starts CmpSdw_ShutdownComponent) and
  evfSwitchSession (5 checks: camapp 3's LV stops at `0x37001418`; in camapp 1 the GUI's vt+20(16) comes before
  task 165's 937; from the Super Control Panel under camapp 3 the switches' module-9 reads are exactly the two pairs
  above, and LV and the eye switch run, ChangeOutline reading 0 at both sites; the native output change opens the EVF
  and logs `0x37001418` once).
- **Open.** The camera's route from the lever to shutDown and from EVFSW / the eye sensor to the GUI's 131 (the CA
  chains); 586's next stop after the flash (CapTak_Take, `0x60e6f0f0`'s capability, CmpSdw_ShutdownComponent);
  why TRA 994 from task 162 waits.
  Since 4.3.10 (2026-11-11): the eye sensor's event to the GUI's 131 runs natively (the application's chain, X); the
  sequence parts see the lever's off and in standby start nothing (X), and its way to shutDown is still not found;
  EVFSW has no producer.

#### 4.3.7 camapp 3: the AF mode and the card-slot row (2026-11-10; D unless tagged, addresses E143's)

4.2.4's two GUI differences between camapp 3 and camapp 1, each to the firmware's own decision and the lab input it
reads. No stand-in changed this round; the default stays camapp 1.

- **The shooting screen's MF is MODE_AF_CHANGE (535) from the Fn lever.** The application's start (`0x51081333`, on task
  165 in the lab, X) calls initLeverSwitch (SubAppModuleLeverSwitch, `0x5105420f`; fwmap files it under
  IOlyApiShooting). It reads the lever through the HFW interface's slot 236, OlyHfwOpeCamCom's `0x50abdd4b`: with 15260
  (I: the lever as power switch, docs/om1-input-spec.md) at 0 it answers 1 unless UI_IN's state of `0x02021223` is 1,
  and the shell's own enum (`0x50df201f`) names 0 API_LEVER_SW_1 and 1 API_LEVER_SW_2. It reads the mode dial (at dial
  state 5, 1290 takes 534's place unless 534 is 7 with the lever at API_LEVER_SW_2) and the lever's function 534
  (factory default 4: the lab's store with no saved settings, X; list 0, 8, 4, 7, X: its descriptor) and
  switches on it (table `0x512ac924`): 0, 1, 2 and 8 set the focus mode change to 0; 3, 5 and 6 set it to 0 and give the
  Fn buttons' function by the lever; 7 sets it to 0 and calls `0x51054cd8` with the lever; 4 calls
  Shooting::setFocusModeChange with the lever's state (`0x5105443b..0x51054472`). The menu's names of these values are
  not read.
- **Who writes it (D).** Shooting::setFocusModeChange (`0x50b53072`, slot `0x50e174d8` of its table) calls
  OlyHfwOpeShoot's `0x50adfbc3`, which writes 535 (0 or 1, `0x50ab51d5` -> `0x503c49f7` -> `0x503c6511`) only where
  `0x50ab5f6f` answers 1: the shooting phase query `0x50ab57e9` at 101. Otherwise it returns `0xf0000058` and writes
  nothing. The query answers 100 with no sequence controller (`0x6035f024` 0), else the sequence parts' phase
  (`0x60364a1c` through `0x50c5880b`). The other writer of 535, `0x50b82c3c` (from `0x50adfb2a`, behind the same gate,
  and the sequence parts' `0x50cce85b`), does not run in the first 3.5 s of either session (X).
- **The runs (X).** Both camapps run initLeverSwitch at 2.771 s of lab time with the lever read as 1 (SW_2), dial state
  9 and 534 = 4, and both call setFocusModeChange(1). Camapp 3: the sequence parts set phase 100 and then 101
  (`0x50c89db3`, the OXF main thread) at the same instant, before it, and 535 becomes 1, MF. Camapp 1: no sequence
  parts, phase 100, refused, 535 stays 0, S-AF. The lens is not on this path: getLensMfMode (`0x50b4e805`, setting
  597) answers 0 in both, and the lens MF switch `0x02021519` reads UI_IN state 1 in both (X); what that state means
  for the clutch, and what sets 597, is not read. With the lab's lever input moved to 1 (UI_IN state 1,
  API_LEVER_SW_1) camapp 3 writes 535 = 0 and its shooting screen is camapp 1's word for word; moved back, MF again
  (1,655 pixels). In camapp 1 the lever changes nothing: to SW_1 the application asks getFocusModeChange (slot 492,
  `0x50b53124`), finds 0 and calls nothing (`0x51054abe..0x51054ac6`), and back to SW_2 its setFocusModeChange(1)
  (from `0x510547ed`) is refused with `0xf0000058` (X): its Fn lever's focus function is dead.
- **Decision.** With the lab's hardware state, the lever at API_LEVER_SW_2 (UI_IN's decode of the idle level, D) and a
  factory store (534 = 4, X), the camera shows MF, camapp 3's picture (D for the logic). That the camera's sequence
  parts stand by before the start reaches initLeverSwitch is I: in camapp 3 both come at 2.771 s, and the start waits
  from 2.756 to 2.771 s in camapp 1 as well (last on the API flag `0x13e`, X), where no component runs, so the order is
  the scheduler's. Camapp 1's S-AF is the wrong one, from the missing sequence parts, not from a stand-in's value. Not
  fixed: the fix is a stand-in for the sequence parts' standby at the gate `0x50ab5f6f` (its callers `0x50adfbda`,
  `0x50adfb4c` and OlyHfwLowApiWrap's `0x50ac4792`). With the lever at SW_2 it puts every default session in MF while
  S-RELSEQ and S-AFLOCK keep feeding S1 an AF lock (X, the gate answered for `0x50adfbda` alone in camapp 1: MF, and
  S1's frame changes by the same 1,072 pixels as without it), which the camera does not make in MF (I). So the gate's
  stand-in needs S-RELSEQ's focus callbacks to follow the focus mode first, and golden then changes in every session.
  The lever's position is a free input of the lab (no firmware default); moving its idle level to SW_1 to keep S-AF
  would be a choice, not evidence. What would settle the order: on a camera with the lever at position 2 and a factory
  store, the shooting screen right after power-on.
  Superseded 2026-11-11 (4.3.8): the idle level's SW_2 was no decision and contradicts the factory store, which is a
  camera's at SW_1, so the idle lever moved there on that evidence; the gate has its stand-in (S-SEQSTANDBY) and
  S-RELSEQ follows the focus mode, so the lever's focus function works in camapp 1 and the default sessions keep S-AF.
- **The movie Card Slot Settings row is both slots' media flags.** The menu's actuator (Cursor_Move_Menu_1st_Actuator
  `0x51170a91`) stores a row's state, 0 or 1 (grey), from the item query `0x50b01314` (`0x50b012a0`'s slot 0) of the
  row's item, 1131 (X: the one item whose answer differs, 1 in camapp 3, 0 in camapp 1). The query (`0x50b7ae3f` ->
  `0x50b7aeae` -> `0x50b7e4b8`) runs 1131's restriction record (`0x50e2b790`: conditions 0, 1, 3 and 5, functions from
  `0x60e4ad9c`). Condition 0 (`0x50b7e680`) asks the store's restriction of 1131 (`0x50ab5092(1131, 2, 3200)` ->
  `0x503c4be9` -> `0x503d28ec`), whose rule (`0x605df54c`) has three cases on (15261, 15262): (0, 0), (1, 0) and (0, 1)
  (D). The row is available only with both flags at 1 (X: in camapp 1, set with the store's setter the slot update uses,
  `0x50ab4f75`, (0, 0), (0, 1) and (1, 0) answer 256 and (1, 1) answers 0, as camapp 3's (1, 1) does; with both set,
  camapp 1's menu is camapp 3's word for word). 15261 and 15262 have no descriptor, so 4.2.4's comparison of the scalar
  settings did not see them.
- **The flags (D).** CapMed_MediaManager's slot update `0x50bba897` sets 15261 + slot to 1 for a slot whose media status
  (api_media `0x503f0bd7`) has bit 2 or 3 set or whose device answers `0x50bb7b46` (first 4510 / 4521 to -1,
  `0x50bba8ff..0x50bba925`), and to 0 where bit 14 is clear; the function component sets them after a format (4.8.3). At
  its start (`0x50bb7bba`) the manager asks for the second slot's mount where the slot's device answers vt 140 with 0
  (I: not mounted): the request vt 20 with 3 (`0x50bb7e8c`), the kind's mount state 2 (`0x50bb7e7b`; X, that slot's
  path). No test of the card's presence is on that path: the branches before it test the device's vt 140, api_media's
  bit 0x100 and UI_IN's `0x0400` (`0x50bb7db8..0x50bb7e42`), not the card bit 0x80 (4.8.3: a card out clears it, X).
  (Corrected 2026-11-11, 4.8.12: the start does test the card's presence first, at `0x50bb7af6`, the device's state
  4097 for a slot whose detect answers no card; that path clears the slot's flag.)
- **The runs (X).** Camapp 1 runs no media manager: both flags 0, the row grey. Camapp 3's manager sets 15261 = 1 at
  2.756 s (the first slot's card) and 15262 = 1 at 3.06 s: its mount of the second slot runs the DCF card-in for drive 1
  (detect state 2 at `0x5087bd4e`) and the second slot's SD port, the command's u16 at +12 (port 1; the command layer
  indexes its ports' busy words with it, `0x508ad044..0x508ad055`), gets 56 commands, each answered by S-SDCARD's one
  card, which answers every command whatever its port (`emu/src/lab/storage.mjs`): the second slot mounts the first
  slot's card (api_media's status 0x3780 with the card bit 0x80, where camapp 1 has 0x600). Not the cause, each changed
  alone in camapp 3: the second slot's card switch `0x1518` at the no-card level, S-CARD's HLS mount state of kind 8
  (`0x60360c08`) left 0, UI_IN's `0x0400` at state 1. Tried and not kept: port 1 answered as an empty slot (no
  response). Drive 1 then reads 0x8608 (api 0x608: bit 3, the failed init), which the slot update also takes (15262 = 1,
  the row still available), and camapp 3's `--hdmi on` plug stalls (more than 300,000 stub calls in S-DISPFRAME's swap
  wait; traRoutingSession 20/21, 24/24 without it).
- **Decision.** By the firmware's rule the row is grey with one card unless the media manager flags the empty slot.
  Camapp 1's grey follows from no flags at all (it lacks the first slot's 15261 = 1 too, a latent difference the row
  alone does not show, X: the trial above); camapp 3's available row follows from the lab's one card answering both
  ports, a wrong lab input (D, X). Which the camera shows with one card is not settled by the code read: it turns on
  what the empty second slot does at the manager's mount, and an empty answer gives the init error that flags it as
  well. What would settle it: an OM-1 with one card in slot 1 (is the movie Card Slot Settings row grey?), and, for the
  lab, the card detect of the second port as the SD driver reads it before the card's init (the path from the DCF
  card-in to sd_mount's init is not read; S-SDHOST keeps the host's registers as written and models no card detect).
  This also answers 4.8.3's (?) (D): its format sets both flags (S-CARD gives both slots the mount state 8, the second
  with no card in it: a lab input of the same kind), so the row is available after it.
  Settled 2026-11-11 (4.8.12): the SD driver's detect of a port is a pin of the body IO expander, not UI_IN's level,
  and the lab's read "card present" for both; with the second slot empty (the lab's default now) the manager clears
  15262 and the row is grey with one card, in camapp 3 as in camapp 1 (D, X). The mount state 8 of the empty slot is
  the manager's own (X), not a lab input, and the menu's format no longer flags the empty slot.
- **Corrections.** 4.2.4's return chain past `0x50b530c1` was not one: `0x50e171e0` is the log format `%1s(%d)` that
  `0x50b53072` logs with (run-time `0x60e38200`), `0x50db73f1` the string "Shooting::setFocusModeChange" and
  `0x512ac5e4` "changeFunctionButton", stack words a scan took for return addresses; the caller is initLeverSwitch
  (return `0x51054474`, X). 4.2.4 now says so.
- **Tests (X).** `emu/test/test_camapp.mjs` camapp3FramesSession (12 checks, 6 before) adds a camapp 1 session and pins:
  the shooting screen differs by 1,655 pixels in x 417..894, y 72..334, with 535 at 1 and 0 and the shooting phase query
  at 101 and 100; the menu by 4,602 pixels in x 38..871, y 283..327, with the flags (1, 1) and (0, 0) and the second
  slot's media status 0x3780 and 0x600, and camapp 1 with both flags set shows camapp 3's menu word for word; with the
  Fn lever moved to 1 camapp 3 writes 535 = 0 and is camapp 1's frame word for word, and camapp 1's frame does not
  change; moved back, camapp 3 writes 535 = 1 and shows its MF frame again, and camapp 1 keeps 0 and its frame.
  (Changed 2026-11-11, 4.8.12: with the second slot empty both menus are the same word for word, flags (1, 0) in
  both and the slot's media status 1; the 4,602 pixels are now camapp 1's with both flags set against without.)

#### 4.3.8 The standby gate in camapp 1 and the Fn lever (2026-11-11; D unless tagged, addresses E143's)

4.3.7 named camapp 1's S-AF the wrong side of a camera whose Fn lever stands at API_LEVER_SW_2 and proposed a stand-in
for the gate that would put every default session in MF. This round re-checks the input first. The lever's idle
position was no decision and contradicts the factory store, so the input is corrected (API_LEVER_SW_1), and the default
sessions keep S-AF, now for a reason. The gate's stand-in (S-SEQSTANDBY) and S-RELSEQ's focus mode follow, so the AF
mode follows the lever in camapp 1 as it does in camapp 3.

- **The lever's two states.** UI_IN reads it at group 0, bit 1 (code `0x1223`, a switch of polarity 0: the bit 0 is
  state 0). The lever read (the HFW interface's slot 236, API `0x10140`, `0x50afe3d2` -> `0x50abdd4b`, its argument
  unused) answers, with property 15260 at 0, 1 unless UI_IN's state is 1, and the shell's enum (`0x50df201f`) names 0
  API_LEVER_SW_1 and 1 API_LEVER_SW_2: state 1 is SW_1, state 0 is SW_2. The switch table's row for the lever
  (`0x60e49560`: `0x02021223`, EV_POWER_SW_ON, EV_POWER_SW_OFF) is used with 15260 non-zero: at 1 SW_1 picks ON and
  SW_2 OFF, at 2 the reverse (`0x50b79539..0x50b79561`), and the lever read then answers the position the camera is on
  in, 0 at 1 and 1 at 2 (`0x50abdd5c..0x50abdd73`, while module 9's state is 2). The menu lists 15260's values as Fn,
  ON/OFF and OFF/ON and shows the factory 0 as Fn (X); that ON/OFF is 1, and that SW_1 is the body's position 1, is I.
- **The lever's function.** Setting 534 is MODE_LEVER_SWITCH_TYPE (the names are the 52-byte records of the resource
  block `blk05a00000`), its descriptor list 0, 8, 4, 7 and its factory default 4. The menu (the Operations tab's first
  page, Fn Lever Settings; X, `bin/nav.mjs --start 6,1,1`) shows "Fn Lever Function mode2" for stills and for movies
  (1290, MODE_MOVIE_LEVER_SWITCH_TYPE, 4 too) and lists Off, mode1, mode2, mode3. The help of mode2 reads "Switches AF
  mode/AF target mode/AF target point according to Fn lever position. Target can be selected.", Off's "Disables Fn
  lever function." So 4, the factory value, is the menu's mode2, not mode1 (X), which answers 4.3.7's "the menu's names
  of these values are not read"; that 0, 8 and 7 are Off, mode1 and mode3 is I (the two lists' order). In the lever
  function table (`0x512ac924`, 4.3.7) 4 is the one case that calls setFocusModeChange with the lever read.
- **The two banks.** MODE_AF_CHANGE (535; 0 or 1, default 0) selects the bank. The still focus mode is MODE_FOCUS_STILL
  (289, factory 0) in bank 0 and MODE_FOCUS_AF_CHANGE_STILL (536, factory 2) in bank 1; MODE_FOCUS (25) reads 0 with
  535 at 0 and 2 with it at 1, the property getter `0x503ee3bf` reads those as 0 and 1, and the shooting screen shows
  S-AF and MF (X). initLeverSwitch's case for 4 (`0x51054401`) calls setFocusModeChange with the lever read, so SW_1 is
  bank 0, S-AF, and SW_2 bank 1, MF. A camera at position 1 with the factory settings shows S-AF (D for the logic, X in
  the lab; that SW_1 is position 1 is I, above).
- **The lab's lever was at SW_2, and why (D: `emu/src/lab/play.mjs` idle_images before this round).** The idle image
  set every switch bit 0, "the old state of every lab before M10" (`docs/om1-input-spec.md`), except the monitor's and
  the mode dial's. For the lever that is state 0, SW_2. Nobody chose it. With the factory store a start at SW_2 runs
  setFocusModeChange(1) and rewrites the store to bank 1, as camapp 3's start did (4.3.7, X).
- **The factory store reads as a camera's at SW_1 (I, from the defaults below).** Its MODE_AF_CHANGE is 0, the value
  the start writes at SW_1. Its two records of the lever say position 1 as well: MODE_LEVER_SWITCH_LOCK_STATE (1685)
  is written 1 where the lever read answers 0 and 2 where it answers 1 by three application sites (`0x5107fbe4`,
  `0x51083f83`, `0x511682ae`), and its default is 1; MODE_LOCKING_FN_LEVER_POSITION's (1476) default is 1 too (X),
  that its 1 means position 1 is I (its name; no writer of it is read). The lab's lever events do not reach those
  sites (X: 1685 stays 1 over both changes in both camapps), and the readers of 1685 and 1476 are not read (?). The
  firmware cannot know a lever's position without reading it, and which position a camera ships in is a fact about
  hardware (?).
- **Decision: the lab's input is corrected (I: it rests on the reading above).** A session is a camera with a factory
  store at its first start; the store reads as position 1's, while the lever input said position 2. (The default
  session's S-AF before this round is no evidence for either: it came from the refused gate, 4.3.7, not from the
  lever.) The idle image now sets the lever to state 1, API_LEVER_SW_1
  (`play.mjs` LEVER_IDLE_STATE), as the mode dial starts where the store's mode is (`docs/om1-input-spec.md`). With it
  camapp 3 starts with 535 at 0 and its shooting screen is camapp 1's pixel for pixel; at SW_2 it writes 1 and shows
  MF, 1,655 pixels in x 417..894, y 72..334, 4.3.7's box (X). 4.3.7's "the lever at API_LEVER_SW_2 (UI_IN's decode of
  the idle level)" describes the lab before this round. A camera with the lever at position 2 and a factory store
  shows MF after power-on (D for the logic; the order against the sequence parts' standby is I, as in 4.3.7). The
  other bodies' idle images keep the lever's bit 0: what their starts make of the lever is not read.
- **The TAKE probe keeps SW_2 (`play.mjs` LEVER_PROBE_STATE).** Every result of `--take probe` (4.1.4 to 4.1.10, 4.2.3,
  4.2.5) was measured with the lever at SW_2. Under control camapp 3, where the gate passed, that is MF, and
  TAKE_MAIN's take-ready asks TAKE_FOCUS for nothing and ends (RdyFcsRdy3, event 794); under control camapp 1 the gate
  refused and 535 stayed 0 until this round (its probe start now takes the change and sends command 22 too,
  `test_take.mjs` START_LAB). At SW_1 the take-ready waits in RdyFcsRdy1 with the pending bits `0x5b` for an AF the
  lab's TAKE_FOCUS does not finish, and the second shot's and the release route's sessions stop there (X:
  `test_take_ready.mjs` and `test_take_release.mjs` rounds 2 and 4 fail with the probe at SW_1). So the probe's
  sessions start at SW_2, a stated input of the probe, not the default's.
- **The gate and its callers.** `0x50ab5f6f` answers 1 where the phase query `0x50ab57e9` answers 101 (4.3.7). A byte
  scan finds three calls of it, against more than 200 of the query: `0x50adfbda` in setFocusModeChange's first form
  (`0x50adfbc3`, from the API `0x20183`'s `0x50b53072`), `0x50adfb4c` in its second (`0x50adfb2a`, from the same API's
  `0x50b53009`; it writes 535 through `0x50ac3d02` -> `0x50b82c3c` after `0x50b822cf`, which creates the object at
  `(0x60361c24)` where there is none), and `0x50ac4792` in OlyHfwLowApiWrap::getShutterSpeedLimit (`0x50ac464e`, named
  by its trace strings; its one caller `0x50ad8e87`). Each form has one caller, its API entry (`0x50b530ba`,
  `0x50b53051`; a `jmp` the scan also matches at `0x50adc595` is the inside of a `mov` immediate), and the two entries
  are slots 484 and 480 of the Shooting interface's table (`0x50e174d8`, `0x50e174d4`; getFocusModeChange's 492 is
  `0x50e174e0`, and initLeverSwitch calls 484 at `0x5105446e`). The scan finds 33 indirect calls through an offset of
  484 and 24 through 480 of some interface; which are Shooting's is not read (?), so what reaches the forms is the run
  below (X). Both forms return `0xf0000058` behind a 0. getShutterSpeedLimit reaches its call only with the property
  MODE_CAMERA (26) at 6, 477 and 754 at 0, 598 at neither 1 nor 2 and two state tests not 1 (`0x50ab57e0`,
  `0x50ab5780(3)`). A 0 sends it to `0x50ac47b7`, which sets shtSpdLimt[0] from the shutter value (property 4): 1
  at `0x8001`, 682's test at `0x7fff` (which also clears shtSpdLimt[1]), else 0. A 1 sends it on to `0x5040ecc2`
  and 682 and, with neither at 1, to `0x50ac47dd`, which with MODE_DIAL_B_ONOFF (1444) not 1 leaves both limits as
  the range compare before it set them.
- **The camera's standby (X: control camapp 3).** The query answers 101 at the shooting screen, with the menu or the
  Super Control Panel open and in playback (where the shooting service has ended), and 102 from S1 down on. With S1
  held the lever's setFocusModeChange is refused and 535 stays.
- **S-SEQSTANDBY (`emu/src/lab/camapp.mjs` STANDBY_GATE_RETURN).** Under control camapp 1, where no sequence controller
  exists (`(0x6035f024)` 0), the stand-in answers the gate's own call of the query (the return address `0x50ab5f74`)
  with 101 while S-RELSEQ's release sequence is at rest: no shutter stage held, no callback of a release pending, no
  recording. Every other call of the query still reads 100 (X: the lab's own). The start's setFocusModeChange(0) then
  writes 535 = 0, the lever at SW_2 writes 1, and the shooting screen is camapp 3's at both positions, the same frames
  (X). That the camera's sequence is back in standby when the rec view ends is I: the lab's own shot does not end under
  camapp 3, so the phases after S2 are not measured, and the stand-in refuses until S-RELSEQ's last callback of a
  release. During a movie the query keeps S-RELSEQ's movie phases, so the gate refuses. Not under control camapp 2 or
  3: under 2 the controller word is 0 at the start as well, and an answer there gave the probe's start one more focus
  mode request to TAKE (command 22) before its own (X), a change to the components' order this topic has no evidence
  for.
- **What else starts passing (X: camapp 1 with the stand-in against camapp 3, the returns of the three calls
  observed).** Over the lever's two changes at the shooting screen, with the menu open and with the Super Control
  Panel open, PLAY and its return, and the mode dial at M (with main and sub dial steps and the lever's changes), S,
  A and B, the two sessions make the same calls with the same answers at every step: setFocusModeChange's first form
  once per lever change, 1; none in playback, where the lever's event asks for no change, and one at PLAY's return,
  where the lever init runs again; getShutterSpeedLimit's at M and B only, 1, its limits `[0, 0]` in both. The second
  form never runs. So in M and B getShutterSpeedLimit takes its standby branch as the camera does; where the two
  branches give different limits (the shutter value at its range's end, by the code above) is not measured (?).
- **S1 by the focus mode: what the sequence does.** READY's entry calls the sender of evTraResShtStartFocus
  (`0x50c88324` -> `0x50cad835`; TRA 1323, the reactive's START_FOCUS). The sender builds the event only where the
  callback flag allows it (`0x50caa479`, bit `0x80`) and `0x50ca8b44` answers 1, whose last test `0x50ccef3c` reads the
  property MODE_FOCUS: 0 asks MODE_HALF_RELEASE_AF_SAF (1933) for 1, or, with the store's MODE_FOCUS at 11 or 12
  (`0x50bcacce`; which modes those are is not read), MODE_START_STAR_AF (2092) for 0; 2 asks MODE_HALF_RELEASE_AF_CAF
  (1934) for 1; any other value, MF's 1 among them, answers 0. After posting, the sender sets word 16 of the table that
  holds module 9's state to 1 (`0x50ab6299(16, 1)`); END_FOCUS's sender (`0x50cad03e`, TRA 1321) clears it and is
  guarded by its callback flag alone. Its twelve callers are the statechart's transition actions; one (`0x50c8f9b6`)
  sends only while that word is 1, the guards of the others are not read (?). Just before it READY's entry calls
  `0x50cad93f`, which builds TRA 1319 (START_READY, builder `0x50af26c5`) behind its callback flag's bit `0x20` alone,
  whatever the focus mode (review, D); S-RELSEQ has never posted a START_READY in either mode, and whether the camera's
  flag lets it through is not read (?).
- **The same, measured (X).** Under camapp 3 after a menu pass (4.1.10) S1 enters READY (phase 102) and the sender
  runs: at SW_2 it builds nothing, at SW_1 one 1323 (since S-TAKERDY's merge, 4.1.12, S1 down then goes on to phase
  103 in the same step: X, fnLeverSequenceSession; 102 with S-TAKERDY off).
  With TAKE native (`--take probe --cpu2 native`) S1 at SW_2 ends
  READY in its own step: phase 103, the take status's word 0 `0x00100007` (STANDBY's 1, READY's 2, READY_FINISH's 4),
  isFocus 0, and neither 1323 nor 1321 built; at SW_1 the sequence builds 1323 and waits in 102 with the word
  `0x00100003` (the AF does not end in the lab). So READY_FINISH is the take-ready's end, not the AF lock's state:
  this corrects S-AFLOCK's comment and `emu/FIDELITY-NOTES.md` 7.14, which had that as I. The lever's change to SW_2
  sends TRA 974, OlyHfwOpeShoot::setAelState's 958 and 1515, endMfAssist's 955 and 974 again (X, camapp 3's exec and
  camapp 1's S-TRAACK alike).
- **S-RELSEQ, S-AFLOCK, S-AFOSD and S-SCENE in MF (`camapp.mjs` HALF_AF).** On E143 S-RELSEQ asks the same test
  (the property and the three settings, read natively; the sender's other tests, a lens test `0x504106f8`, a state
  test and the take capability's `0x50bc71cc`, need objects camapp 1 does not have and are taken as passing, I). Where
  it answers 0, in MF or with the half-press AF off, S1 posts neither START_FOCUS nor END_FOCUS; S-AFLOCK sets READY's
  and READY_FINISH's bits at once and nothing else (no isFocus, the AF module's getter native, no CBS_AF_LOCK, so no
  beep); S-AFOSD uploads nothing, at S1 up either; S-SCENE's lens stays where it is. S2 takes its picture as before
  (X). That no END_FOCUS comes later in the release is I beyond READY_FINISH (the unread guards above). The other
  bodies' S1 is unchanged: the ids are E143's.
- **Golden (X).** 28 of 240 sessions differ: the 26 Player sessions with a camera application start (22 scenarios:
  a15-open, b7-gate, evf-idle, eye-burn, inputs, keys, menu-tft, pace-wall, play-perf, playback, power and
  power-replay with their #2 and #3, queue, scp-edge, scp-replay, scp-timeout, shoot-evf, shoot-tft, switch-scp,
  switch-shoot, tokens, tokens-3b) and run/perf, run/perf-fault. By cause: (1) the idle lever: UI_IN's group 0 image
  has the lever bit (the first push's d0 `0x3c` -> `0x3e`, status bits.lever 1), and each start and PLAY's return no
  longer takes the application's SW_2 path: no TRA 958, 1515 (setAelState) and 955 (endMfAssist), no writes of 679 and
  680 (the start's writes 14 -> 12, S-TRAACK's answers 16 -> 13), 677 and 1950 not read, fewer heap blocks (the
  start's new 477 -> 468); which code takes that path at SW_2 is not read (?). (2) S-SEQSTANDBY: the start's and PLAY's
  return's setFocusModeChange(0) is answered at the gate and taken, the stand-in listed from the first outcome on
  (with (1), the start step's hook stops 9,201 -> 9,648 and prop_get 2,667 -> 3,259). (3) HALF_AF: keys' S1 asks
  the focus mode (S1 down 18 stops more: prop_get 7, memset 1 and 10 unnamed; its callbacks the same, S-AF). (4)
  inputs' lever step submits 0 (above); that scenario's composite stops at its FEATURE_UNOBSERVED before and after,
  so no frame shows the MF. Every screen is identical; every devices item is identical with the instruction counts
  masked (the irq rows' and the xcpu ring rows' instruction word); run/perf's P10b play workload has the same
  frames, lab time, hook log and settle and elapse logs and 315,470 instructions (185,434,406 -> 185,749,876) and 949 register reads more. Control:
  this tree with the lever at SW_2 and S-SEQSTANDBY off gives P10b's recorded detail in every field and golden.json's
  digests for shoot-tft, playback and power-replay (keys then differs in stops, harness and output alone, HALF_AF's
  reads); the lever at SW_1 alone is 71,678 instructions and 322 reads fewer, so the stand-in's taken path is
  387,148 and 1,271 more. Re-recorded with that reason, evidence firmware.
  Review (2026-11-12, X): with the three switches off (the idle lever's bit 0, S-SEQSTANDBY's answer, HALF_AF) and the
  inputs file as before, all 28 sessions check identical, every layer, against golden.json as it was before this
  round, so these causes are the whole difference. Three of its parts are not a start's, all from (1) and (2): at the
  menu's close (menu-tft's second MENU, play-perf's step 304) the application's lever code (`0x510548cc`, after the
  lever read API's `0x50afe42e`) reads 534 once more at SW_1, 6 stops; the object at `(0x60361c24)` that `0x50b822cf`
  makes on its first use (7 heap blocks, 0x1b0, 0x100 and five of 0x50, and 10 memsets) was made by the start's SW_2
  path and is now made by its next user, queue's RIGHT (its tick 4, through `0x50b7b79a` -> `0x50ac3cb7` ->
  `0x50b822ec`), 17 stops there, and the sessions that reach no other user never make it; playback's PLAY return is
  978 stops where a start is 943: at SW_2 it found that object made, and its difference has 9 property reads more than
  the start's (535 three times, 44, 855, 1138, 1320, 1837, 15209; which code makes them is not read, ?).
- **Tests (X).** `emu/test/test_fnlever.mjs` fnLeverSession (12 checks: the idle lever read as API_LEVER_SW_1, the
  factory lever function and banks, S-SEQSTANDBY listed from the start and the lab's own query still 100; S1 in S-AF
  with its callbacks, the AF lock and S-SCENE's focus; the lever to SW_2 writing 535 behind the gate's 1, MF, with the
  focus mode change's five transactions; S1 there with no focus callback, READY and READY_FINISH and no isFocus, no
  AF OSD, the lens where it was set, and S2's picture; the lever refused while S1 is held and taken after the release;
  S-AF with MODE_HALF_RELEASE_AF_SAF 0; getShutterSpeedLimit's gate call at M) and fnLeverSequenceSession (4 checks:
  camapp 3 at each lever position, the store, the property and the lever's transactions, and its own StartFocus sender
  building no TRA 1323 at SW_2 and one at SW_1; S1 down's phase 103 since S-TAKERDY, 4.1.12), registered in
  `emu/bin/test.mjs`. `emu/test/test_camapp.mjs`
  camapp3FramesSession (13 checks, 12 before) rewrites 4.3.7's AF pins: the two camapps show the same frame at SW_1,
  MF at SW_2 (1,655 pixels against the start, the two frames equal, the gate 1 at both changes, S-SEQSTANDBY listed in
  camapp 1 alone) and the start's frame again at SW_1; control: with the stand-in's standby taken away camapp 1 is
  refused at the gate and keeps 535 and its frame, as before this round. Its heap workload's event 294 (the user
  setting manager's notification of a written setting) falls from 21 to 19 a pass: at PLAY's return the application
  no longer writes MODE_SELF_SHOT_BEAUTY (679) and MODE_SELF_SHOT_CUSTOM (680) besides 2108, which it wrote with the
  lever at SW_2 and 535 left at 0 by the refusal (X: the two writes come back with the stand-in's standby taken away
  and the lever at SW_2; why the application writes them is not read). Its camapp 3 start's transactions lose 958, 1515
  and 955 (the lever's change sends them now) and send 994 later. `emu/test/test_take.mjs`: the probe's camapp 1 start
  ends with command 22 to TAKE_FOCUS (the focus mode's change, as camapp 2's start), START_LAB.
  Results: test_fnlever 12/12 and 4/4; test_camapp 33/33, 2/2, 5/5, 25/25, 25/25, 13/13, 11/11; test_take 27/27;
  test_take_ready 15/15; test_take_release 8/8, 12/12, 5/5; test_expcb, test_storage (session), test_audio (session),
  test_cpu2, test_c3power, test_dispq, test_modpost, test_scene, test_live and test_fnkeys unchanged and passing;
  test-pure all passed. Review (2026-11-12): the sessions left HALF_AF's C-AF and 11/12 branches unpinned (X: HALF_AF
  answering 1 for every mode but MF passed fnLeverSession's 12 checks), so fnLeverUnits (13 checks, firmware-free,
  registered in `emu/bin/test-pure.mjs`) runs every branch of the rule and S-SEQSTANDBY's rest test on a stub lab;
  mutating the C-AF branch, the 11/12 branch or the rest test's pending callbacks fails it (X).
- **Open.** Which position a camera ships in, and the shooting screen of one started at position 2 with a factory
  store (the order of the start against the sequence parts' standby, 4.3.7's question). The sequence's phase after S2
  and through the rec view (the stand-in refuses there). The guards of END_FOCUS's other senders. The readers of 1685
  and 1476; property 15267, which the sites that write 1685 test for 2; 595 (MODE_LEVER_SWITCH_LINKAGE) and
  1304..1306 (MODE_FOCUS_AF_CHANGE_ONOFF_STILL and its target mode and target point siblings, all 1 in the factory
  store), whose part in the bank's switch is not read. Which application sites call the Shooting interface's slots 480
  and 484 besides initLeverSwitch. getShutterSpeedLimit's limits at the shutter range's end. START_READY (TRA 1319) at
  READY's entry, which S-RELSEQ does not post in either focus mode. TAKE's frame mode in MF
  (S-TAKEFRAME keeps the AF frames' 4). The other bodies: the lever's idle bit, the gate and S1's test are as before;
  their ids and addresses are not read.
- **Corrections.** 4.3.7's decision (camapp 1's S-AF "the wrong one", the idle level's API_LEVER_SW_2 a free input)
  is superseded above, and its proposal to put every default session in MF is not followed. S-AFLOCK's "READY_FINISH
  is the state of the AF lock" (I) is corrected: it is the take-ready's end (X). The `inputs` scenario's lever step
  (`emu/scenarios/calls/inputs.calls.json`) now submits 0, a change from the new idle state as its captured 1 was from
  the old one.

#### 4.3.9 The JPEG encode (2026-11-11; D unless tagged, addresses E143's)

- **Why.** S-JPEGENC stands in for the run and rec_ImgPro_Jpeg_Result (4.3.4). This round reads what the run asks of
  the hardware, to see whether the encode can be a request of its own that a device model answers. It is not one: the
  encode is a stage inside the image library's pipeline request, and the JPEG codec it starts holds no buffer address.
  The codec's block and its driver are read below; the pipeline unit around it is not, so S-JPEGENC keeps the run and
  the file's bytes are unchanged (X: golden, the storage sessions). Two clean-ups in the lab's REC rule are at the end.
- **The run is a table of stages.** The library's request lives at the create's handle (the context of 4.3.4 is the
  handle + 52, `0x50491c98`). At the handle's +8128 it keeps up to 16 stages of 12 bytes (the stage's function at +0,
  the issue record to wait for at +8), their count at +9298, the next stage at +9296, the status at +9300 and an
  abort flag at +9302. The run `0x50492758(handle, limit)` calls the stages' functions in turn until one returns a
  status or the limit is reached; `0x504929e9` then waits for the last stage's issue (`0x50493786`, the wait
  `0x50493617` of `docs/om1-imgpro-spec.md` 1).
  - The create fills the table (`0x504934a6`, called at `0x50491bbf`). For REC's still it takes the constructor
    `0x504a8e07` (through `0x504a7027`; the others, `0x5049cb5c`, `0x504953b9` and `0x504953a9`, by the request's
    bytes +37, +42 and +8, are not read). That one gives two stages when the request's byte +40 is set, one or two by
    three tests (`0x504a9f81`, `0x504a9572`, `0x504a8ed8`), and otherwise three: `0x504a88d1`, `0x504a88ee` and
    `0x504a8961`. `0x504934a6` then appends `0x50494b9c` unless the request's byte +35 is 1 (or the byte +4556 of
    the request's operations block, which the handle's +9304 points at, is set and the request's byte +39 is not 1).
  - X (a probe: the shot record's four gains set to 256, a value with no source, so that the parameter set returns;
    the library's other units on the lab stub): the three run in that order. Nothing is appended: the request's byte
    +35 is 1 (X), rec_ImgPro_CreateParam's copy of the packet's ImgAspect (`0x505423a8..0x505423bd`). Stages 1 and
    2 issue nothing: `0x504a88d1` calls `0x504a703d` only when the operations block's byte +4584 is set,
    `0x504a88ee` issues (`0x504a7596`) only when its byte +4583 is 1 or 2.
  - Stage 3's worker `0x504a7a30` sizes the destinations and allocates intermediate images from the request's work
    pool (`0x504a83e4` -> `0x5048da64`). Then it builds one request record of 1696 bytes at the operations block's
    +4608 (`0x50493d5a` -> `0x50494d1b`: its kind byte +16 is 0, its callback `0x50494a24`, its sources' descriptors
    from `0x50493b36`) and issues it (`0x50493824`); under conditions not followed (the context's +7516 among them)
    it builds two records of kind 21 instead (`0x50493daa`). In the probe it never issued: the pool's walk does not
    end (4.3.4). The request's work buffer at the context's +7524 is `0x8c230e00` with a size of 0 at the parameter
    set's call (X), and the parameter set hands it to the pool (`0x5048d75a`, `0x50491cdc`); what gives REC that
    buffer is not read.
  - The appended stage `0x50494b9c` (not reached in the lab) takes the first JPEG destination whose flag word +42 has
    bit 3 and encodes it from an intermediate image of the run (the work pool's resource 5, a YCbCr image of format
    3074, I: the name) with a request of kind 3 (`0x50493d96` -> `0x504952b1`, 976 bytes).
- **The kinds (completes 4.3.3's list).** The table `0x50639814` (run-time `0x6065a834`) has 22 handlers: kinds 0 to
  4, 10, 11, 12 and 15 the generic one `0x5046d994`; 13, 14, 16 and 17 `0x5046daa2` (the imgpro unit, 4.3.1); 5
  `0x5046db4d`, 6 `0x5046dc32`, 7 `0x5046dbc3`, 8 `0x5046dca7`, 9 `0x5046dd0b`, 18 `0x5046debd`, 19 `0x5046df39`, 20
  `0x5046df46`, 21 `0x5046dfaa`. So a still's development and its primary JPEG are one kind 0 request, an encode from
  a YCbCr image in memory is kind 3 (I: stage 3's request and the appended stage's, above), and play's decode is kind
  10 (4.8.11): all three the generic handler's.
- **The generic handler drives the pipeline unit at `0x9c200000`.** `0x5046d994` (through `0x5046d9a6`) packs the
  request into the unit's parameter block (`0x50472941`, `0x5047291a`: the straight-line packing of 4.3), then runs
  the unit's set-up `0x5048134d` and its go `0x504814d2`, calling the request's callback between them
  (`0x5048011d`). The set-up writes the block's three enable words (`0x9c200004` or `0x9c20000c`, `0x9c200014`,
  `0x9c20001c`, and `0x9c200250` or `0x9c200258`, `0x9c200260`, `0x9c200268`) and registers the request's callback
  in the unit's record (`0x50483474`). The go (`0x5048198b`, or `0x50481bd1` where the second enable word has none
  of `0x00b00000`) starts the unit, and with bit 1 of the third enable word the JPEG codec first (`0x504819e7`,
  `0x50481c2a`). The unit's own registers and interrupts are not read (?): the lab refuses its first write (4.8.11).
- **The JPEG codec at `0x99900000` and `0x99901000`.** Its driver lies right before the imgpro unit's
  (`0x5050a282..0x5050a6b2`): the init `0x5050a282` (from the units' init, `0x50481301`), the start
  `0x5050a2ba(request, flags)`, a second start `0x5050a4ad` that takes both quantisation tables from its caller
  (`0x5047d913`; whose it is, ?), the Huffman tables' load `0x5050a606` and the interrupt handler `0x5048c1f5`.
  - The start opens the clock gate (`0x98800344` = `0x400`), pulses a reset (`0x9990000c` = 4, then 0), writes
    `0x99900008` = 1 when flags is not 0 and 0 when it is (I: encode and decode), and opens a second gate
    (`0x98800360` = `0x40`). The go passes as flags the destination's byte +51 when the parameter block's +11684 & 7
    is 2 or more, else 0 (`0x504819b8..0x504819e7`). With flags 0 it writes only `+0x000` = `0x8004`, `+0x00c` =
    `0x8002` and `0xffff` to `+0x028` and `+0x02c` (I: a decode, whose tables and size come from the stream). With
    flags it writes the registers below from the destination's descriptor (the request's +28: the format at +8, the
    width rounded up at +10, as 4.8.11's request has it, the width +12, the height +14, the capacity +32, a scale +40
    and a flag word +42), loads the tables and sets bit 0 of `+0x000` last.

| `0x99901000` + | Written (the start, unless said) | Reading |
|---|---|---|
| `0x000` | `0x8008` with flags bit 0, else `0x8028`; bit 0 set last. The handler: 6 after a header, `0x8000` after an error | control; bit 0 the start (I) |
| `0x004` | the init: `0x308b` | ? |
| `0x008` | - (the handler reads it and writes 0) | the interrupt's cause, 1..27 |
| `0x00c` | `0x8200`; `0x8002` with flags 0; `0x8000` by the second start | ? |
| `0x014` | `0xe0` when the flag word has bit 2, else `0x60` | ? |
| `0x020`, `0x024` | - (the handler reads them at a stream's end) | the stream's length, low and high half |
| `0x028`, `0x02c` | with flags bit 0 the capacity + 64, the whole word and its high half; else 24 and 0 | I: the stream's limit |
| `0x058`, `0x05c` | (rounded width >> 4) x (height >> 3, for 4:2:0 >> 4) - 1, low and high half | the MCUs less one |
| `0x060`, `0x064` | the width, the height | |
| `0x068` | 2 | I: the components less one (the handler wants 2 back after a header) |
| `0x070` | `0x10` for format 7170, `0x11` for 7171 | the sampling: 4:2:2, 4:2:0 |
| `0x074`, `0x078` | 0; bit 2 of the flag word << 2 | ? |
| `0x0a0`, `0x0a4`, `0x0b8`, `0x0bc` | `0x100`, 1, `0x1100`, `0x11` | I: the components' table selectors (0, 1, 1) |
| `0x200`, `0x240`, `0x280`, `0x2c0` | 16 words each: the code counts of the DC luma, DC chroma, AC luma and AC chroma tables | Huffman BITS |
| `0x300`, `0x340`; `0x400`, `0x800` | 12 words each; 162 words each: the tables' values in the same order | HUFFVAL |
| `0xc00`, `0xc80` | 32 words each, two table bytes a word: the luma and the chroma table in zigzag order | quantisation |

  - The tables are the library's own data. Quantisation: T.81's K.1 and K.2 in zigzag order at `0x506b3bc8` and
    `0x506b3c08` (their pointers at `0x506b3bb8`, the two register addresses at `0x506b3bc0`), K.2 exactly and K.1
    but for one entry, 61 for its 62 at row 3, column 7, zigzag position 53 (X, a comparison of the image's bytes
    with T.81's tables; corrected in review, 2026-11-11). Each entry is scaled as (q x scale + 128) >> 8 and capped
    at 255 (`0x5050a45f..0x5050a47b`), the scale the descriptor's halfword +40 (1 for 0): 256 leaves the tables as
    they are. Huffman: BITS and HUFFVAL at `0x506b3c48..0x506b3de3`, K.3's four tables, byte for byte those of the
    EXIF module's DHT segment at `0x50605318` (4.8.11's A-JPEGDHT-1; X, a comparison of the image's bytes).
  - X (a probe: the start run natively on a lab-made destination of 1620 x 1080, rounded width 1632, flag word 0,
    the codec's pages on the lab stub for that call): for 7170, scale 256, flags 1 it writes `0x8008`, `0x8200`, the
    limit capacity + 64, `0x60`, 13769 MCUs less one (102 x 135 - 1), 1620, 1080, 2, `0x10`, K.1 and K.2 unscaled
    (first words `0x0b10`, `0x1211`), the four tables' 16, 16, 16, 16, 12, 12, 162 and 162 words, and `0x8009`; for
    7171, scale 128, flags 2 `0x8028`, the limit 24, 6833 (102 x 67 - 1), `0x11` and the tables halved (`0x0608`);
    for flags 0 `0x8004`, `0x8002`, `0xffff` twice and `0x8005`, and no table.
  - The interrupt is IRQ 302: the library's attach gives it the handler `0x5048c1f5` at level 4 on CPUs 0..3
    (`0x5048c95d..`), and `0x50483474` enables it, with IRQ 290 (its handler not read), on the calling core when
    the request uses the codec (`0x50483595..0x504835a2`). The handler reads the cause, clears it, writes 1 to
    `0x99900000` (I: the acknowledge) and dispatches through `0x50640388` (27 entries).
    - A stream's end (`0x5048c225`): with bit 2 of `+0x000` set (the mask 4, which the decode's `0x8004` has; bit 4
      until the review, 2026-11-11) it writes 4 to the pipeline unit's `0x9c200108` and returns. Else it reads the
      length (`+0x024` << 16 | `+0x020`), takes the unit's record (`0x50481790(1)`, or unit 0's where that one's
      halfword +44 lacks bit 1, the mask 2), writes the pipeline unit's `0x9c200108` and, by `+0x000`'s bit 5 and the
      record's flags, `0x9c200140` or `0x9c200168`, sets bit 8 of the record's +44 and calls the record's callback
      with phase 8 and the length (`0x5048011d`).
    - A header read (`0x5048c2d0`; I: a decode's): `+0x068` must be 2, `+0x074` 0 and `+0x070` `0x10` or `0x11`
      (else error 40553); it rounds `+0x060` and `+0x064` up to whole MCUs and writes 6 to `+0x000`.
    - The other causes are errors: 21..27 give 40548, 40549, 40550, 40546, 40544, 40551 and 40552, 3..20 and any
      cause out of 1..27 40547 (`0x5048c34b..0x5048c387`; no cause gives 40545): `+0x000` = `0x8000` and
      `0x50481825(error)`.
- **How the length comes back.** The record's callback is the request's own (`0x50494a24`, its argument the issue
  record, 60 bytes at the handle's +8320 + 60 n): phase 8 stores the length in the issue record's +20
  (`0x50494a7e`). rec_ImgPro_Jpeg_Result reads the destination record's +36 (56-byte records at the handle's +6740,
  the context's +6688 of 4.3.4), and stores the records' halfword +40 in two words of REC's (`0x5054b898`,
  `0x5054b8aa`: `0xa332331e`, `0xa3323320`). What copies the length from the issue record to the destination
  record is not read (?).
- **What it encodes, and who fills it.** Neither start gives the codec an address: every operand of
  `0x5050a282..0x5050a6b2` is one of the registers above. Its pixels come from the pipeline unit and its stream
  leaves through it (I: from the go's writes around the codec's start, `0x9c2000c8` = `0x102`, `0x9c20012c` = `0x3c`,
  `0x9c2001a4` |= `0x20`, and the handler's writes at the end). For kind 0 the unit's input is the request's source:
  rec_ImgProCtrl_Src_Bayer's buffer (TAKE's shot table by HandleTarget, MM's address, 4.3.4), which the DRAM capture
  fills on the camera (4.3's seam C1, I). So the primary JPEG is made in the development's own pass, with no
  full-size YCbCr image in memory for REC to hand over (I: stage 3 issues one request, with a Bayer source and JPEG
  destinations). The images that do lie in memory are the work pool's intermediates, which kind 3 encodes.
  - No rec_ImgPro_Ycc2Jpeg runs on E143 (I: REC's functions trace their entry, as each one read here does). REC's
    trace table names it (id 87), but no trace call carries the id: of the calls of REC's trace `0x5053d959`, 86
    (rec_ImgPro_Bayer2Ycc, `0x505432d8`) and 82 (Jpeg_Result) have a site, 87, 88 and 136 (rec_ImgProCtrl_Src_Yc)
    none (X, a scan of the image: 244 calls, 243 with the code, the id less one, in d1's high half; the other,
    `0x50546b67`, in a callback the library is handed at `0x50545c45`, passes a value of its own). Nor do
    rec_jpeg_exec's branches call one: before the header, with the record's +38006 set, Mode 4100 calls
    rec_cam_dram_capture_exec_icam_raw_edit (`0x5053cd0a`, REC's trace id 68) and another Mode, with the packet's +309
    not 1 and `0x5054bf6c` 1, rec_cam_dram_capture_exec_icam_pixshift_sr (`0x5053cb72`, id 67;
    `0x5054980c..0x50549844`); after it the Mode tests only skip rec_jpeg_make_image (for 4103 and 4114, and for 4100
    when the record's +38037 is 8 or its +38008 is 67, `0x5054987a..0x505498a8`). rec_ImgPro_Bayer2Ycc
    (`0x505432bb`, from rec_make_image at `0x50541eb1`) is the same create, ImageParam, run and release without
    Jpeg_Result. The E144 family's rec_jpeg_exec does call a rec_ImgPro_Ycc2Jpeg by Mode (E144 `0x503f9e56`,
    `emu/src/fw/facts.mjs` recFileQueue).
- **The request REC leaves in the lab (X, a probe at the parameter set's call, `0x50542c94`).** Three JPEG
  destinations, each of format 7170 (4:2:2):

| Record | Address | Size | Capacity | +40, +42, +51 |
|---|---|---|---|---|
| 0, DstIndexPrim | Addr + 41984 | 5184 x 3888 | 14,929,920 | 5, `0x0004`, 2 |
| 1, the packet's +304 | 0 | 1600 x 1200 | 480,256 | 56, `0x0100`, 2 |
| 2, DstIndexThum | Addr + 25728 | 160 x 120 | 9,728 | 86, `0x0208`, 1 |

  The four sources are empty (TAKE's shot table has no buffer, 4.3.4) and the gains are 0. The packet's PlayPic
  (+301) is 1, not 0 as 4.3.4 took it. So natively Jpeg_Result would take its other layout (`0x50542d65..`): Size is
  the header and the primary rounded up to 128 bytes plus record 1's length, with PreviewImageValid 1, its start
  that offset less 12 and its length record 1's (the record's +4884, +4888, +4892), and then the 51200-byte copy at
  that end (+18488) + 12. Record 1 is that preview (I: its address 0 until the primary's length is known; REC's
  trace names rec_imgpro_cb_set_playpic_addr), record 2 IFD1's thumbnail inside the header area. With +51 the codec
  would be started with flags 2 for the primary (control `0x8028`, the limit 24; its flag word's bit 2 gives `+0x014`
  = `0xe0` and `+0x078` = 4) and 1 for the thumbnail (`0x8008`, the limit its capacity + 64); the thumbnail's flag
  word has bit 3, the appended stage's mark. The scale each start would read is ?: 5 would zero most of K.1, so the
  +40 seen here is not the final one or not a scale (I).
- **Whether the lab can run it.** Not this round. What a native run needs, each without a source in the lab:
  - the gains (4.3.4: REC_PREPRO's rec_precon_wb_exec from TAKE's shot fields; the lab's capture stand-in is a
    developed YCbCr frame and measures no white balance);
  - the Bayer source and the work buffer, which TAKE's shot table and MM give on the camera;
  - the pipeline unit at `0x9c200000`: its parameter block, its steps and its end, for kind 0 the whole development.

  A device answering the codec's registers alone would have nothing to encode, and a stream written at the run's end
  without the unit would be S-JPEGENC under another name. So the lab's stream stays what it was: the capture
  stand-in's frame (S-SCENE's, 1620 x 1080, each 8 x 8 block its mean, `emu/src/lab/jpeg.mjs`), not the request's
  5184 x 3888, and the file has neither the preview nor the 51200-byte block.
- **The lab (`emu/src/lab/rec.mjs`, `emu/src/fw/facts.mjs`).**
  - S-JPEGENC's points are the rule's on all three bodies: recImage now reads `encode` (ImageParam's call of the
    parameter set, the set, the run, Jpeg_Result, the release, where the create's handle is kept and ImageParam's
    frame slot of the packet), E143's as given by hand before (`emu/test/test_facts.mjs` pins the three bodies' and
    refuses two altered forms on E143, the handle kept through another register and another test after the set's
    call; X, 1429 of 1429). On E146 and E147 the handle is the image record's +0
    (`mov (180,a3),a1; mov d0,(a1)`, E146 `0x50527c76`), and S-JPEGENC is narrowed there as on E143: CreateParam, the
    create, ImageParam's body and the release run natively, the parameter set's call is skipped, the run and
    Jpeg_Result are stood in. X (`emu/test/test_storage.mjs` storageSession, E143 59 of 59, E146 59 of 59, E147 41 of
    41): on each body the steps once, the create's handle read at the rule's id the one ImageParam hands the set (in
    d0 at its call; added in review, as reading the handle through the packet on E146 passed unseen before, X) and the
    release, and the error logs of ImageParam's four lookups up to the set's call, the callers each body's own; on
    E146 and E147 the first lookup's log comes twice before MM's. Both are the Bayer source's: on E146 and E147
    rec_ImgProCtrl_Src_Bayer calls rec_misc_select_bayer (E146 `0x5052af03`, REC's trace id 147, from
    `0x5052700e`), which asks TAKE's lookup (`0x503afa8a`) at `0x5052af6b` and, the answer's high byte clear, again at
    `0x5052af7a` before MM's `0x50515182` (D; E147's `0x5053a12a` from `0x5053621c`, asking at `0x5053a192` and
    `0x5053a1a1`, D; X on E146: an observer at each of the lookup's call sites in REC sees these two only, and its
    entry twice). E143's trace table has no rec_misc_select_bayer: its Src_Bayer asks the lookup itself, once
    (`0x5054904d`). (Corrected in review, 2026-11-11: the extra log was taken for rec_ImgProCtrl_Dst_Bayer's, E146
    `0x50525452`, whose entry the shot never reaches, X; nor E143's `0x50547695`, X.) The files are byte for byte the
    previous round's (X: S2's picture as storageSession takes it, 73,410 bytes on each, sha256 `bd2e3ed5...` on E146
    and `0032e248...` on E147 on both commits; the review's own run the same) and E143's sessions are golden's.

| Part | E143 | E146 | E147 |
|---|---|---|---|
| ImageParam's call of the set, the set | `0x50542c97`, `0x50491c9f` | `0x5051ff50`, `0x50484597` | `0x5052f03f`, `0x50492de6` |
| the run, Jpeg_Result, the release | `0x50542407`, `0x50542ce1`, `0x5054322e` | `0x5051f653`, `0x5051ff9a`, `0x50520568` | `0x5052e743`, `0x5052f089`, `0x5052f657` |
| the handle, the packet's frame slot | packet +36, 24 | record +0, 24 | record +0, 24 |

  - recFile no longer gives rec_file's `jpeg.exec`, `jpeg.fill` and `jpeg.fill_return` (E143, E146, E147): nothing
    reads them there, the fill not since the imgpro unit runs the header clear's fill (4.3.3, 4.3.5) and rec_jpeg_exec
    not since REC_IMAGE's task runs it (the lab called it only in S-RECIMAGE's call; `jpeg.exec` dropped in review,
    2026-11-11); the rule still reads both as part of the form. The E144 family's recFileQueue gives its own `exec` and
    `fill: null, fill_return: null`, which S-RECIMAGE's lab call uses (`emu/src/lab/rec.mjs` image_lab; that rule and
    path are another topic's).

#### 4.3.10 camapp 3 against the golden sessions (2026-11-11; X unless tagged, addresses E143's)

What still separates `control camapp 3` from the default, session by session: the 19 Player scenarios of golden (23
labs) run with camapp 3 as the player's default (a local flip in a wrapper outside the tree: the Player's first
open_session sets its two flags; nothing of it is committed) and compared with camapp 1's, call by call (the GUI
state and panel at every call's mark, the Player's error, the composites). The sessions are grouped by first cause;
each group has its symptom, the candidates, the verified cause and either the fix or the neighbour. Two lab defects
are fixed (the display switch under camapp 3, the session's module-9 scope); the default stays camapp 1 and
`emu/bin/golden.mjs check` is identical. Run with the native lens, as golden's sessions.

- **The measure at master (before this round's changes).** Six scenarios stop: eye-burn, switch-shoot and tokens-3b
  at the lab's EVF open (errlog `0x37001418`, 4.3.6), power's first lab and power-replay at S-SHUTDOWN's PowerError
  (4.3.6), keys at its 15th call, the lens lock switch's release (S-TAKEOVER's scope: a module-9 read from
  `0x50c8a335`; 4.2.4 had it as "a switch input; its message not reproduced"). Six run through camapp 1's GUI states
  (a15-open, evf-idle, scp-edge, scp-replay, scp-timeout, switch-scp; power's second and third labs too). Seven run
  to their end through other states (b7-gate, inputs, pace-wall, play-perf, playback, queue, tokens); playback's
  PLAY no longer stops (4.1.9). 4.2.4 counted GUI states only: switch-scp's EVF frames were refused there already
  (three PLANC_UNOBSERVED in each EVF composite, below).
- **After this round** 16 of the 19 scenarios run to their end under camapp 3 and 3 stop (power's first lab,
  power-replay, tokens-3b). These counts and the table were measured on the c3-default branch, before the round's
  merge, and are not measured again here: since the merge S-TAKERDY takes a shot under camapp 3 past phase 111 and
  leaves a full shot waiting in phase 106 (4.1.12), the second slot is empty by default (4.8.12) and the histogram's
  bins are counted (4.2.7).

  | Scenario | Under camapp 3 against camapp 1 | First cause | Status |
  |---|---|---|---|
  | a15-open, evf-idle, scp-edge, scp-replay, scp-timeout | the same GUI state and panel at every call | none | run |
  | power (labs 2 and 3) | the same | none | run |
  | power (lab 1), power-replay | PowerError 10 s after the lever's off | TRA 586 unanswered (4.3.6); the lever's own route to shutDown not found: the sequence parts take its code and, in standby, do nothing (below) | stop; neighbour named |
  | switch-shoot | the same states, the date prompt's panel 324 gone by the first switch's end; every EVF composite refused | fixed: the lab's switch (below); then PLANC `0xca` on the EVF (A7) | runs; EVF frames refused |
  | switch-scp | the Super Control Panel is left for the shooting screen at the first switch; every EVF composite refused | the application's own display change; PLANC `0xca` | runs; other states |
  | eye-burn | the eye sensor makes no switch (the scenario sets property 1947 to 0), the TFT stays; the date prompt's panel 324 gone by that step's end, where camapp 1 keeps it to the WAIT (X, review) | the application's eye handler asks for no output at 1947 = 0 | runs; other end |
  | tokens-3b | LV switches; the WINDOWS token, which needs a composite, then stops | PLANC `0xca` on the EVF (A7) | stops; neighbour named |
  | keys | panel 10 from S2 on where camapp 1 shows panel 0 (S2's rec view, I); the multi-selector's keys reach no GUI event | fixed: the scope guard's list (below); the shot under camapp 3 (4.3.2, 4.1.7) and MF (4.3.7) are other tracks' | runs; other states |
  | tokens | OPEN leaves the GUI in `0x0b01`, and CLOSE and EV:217, sent with no lab time between, change nothing | the menu's entry takes lab time under camapp 3 (below) | runs; other end |
  | play-perf, pace-wall | `0x0b01` at the end of the menu key's step, `0x0b02` one call later, then camapp 1's states | the same | run; timing |
  | playback | PLAY's step ends on the shooting screen; No Picture one call (1 s) later, then camapp 1's states | PLAY at the start's end waits for DISPLAY cmd 15 (4.1.9) | runs; timing |
  | inputs | the tap at (90, 30) opens no Wi-Fi menu | the tap comes 0.1 s after the start, where the GUI answers it as the bare screen (below) | runs; other end |
  | queue | after the slide the dial and the left key reach no GUI event; camapp 1 ends in `0x0405` | the slide's notifyGesture (TRA 984) under the components (below) | runs; other end |
  | b7-gate | camapp 1 stops at its second OK (UI_IN group 1's event storm); camapp 3 takes it and runs to the end | camapp 1's own stop | runs |

- **Group 1, the EVF switch from the shooting screen: a lab defect in the display switch, fixed.**
  - *Symptom.* LV or the eye sensor from the shooting screen: the lab's SWITCH runs DISPLAY cmd 2 OPEN of the EVF
    while the VSC histogram runs on the TFT, the run's end logs `0x37001418` and the step refuses it (4.3.6).
  - *Candidates.* (1) The lab's switch does in the wrong order what the firmware would do itself: its own OPEN comes
    before the application's histogram stop. (2) The histogram's stop belongs to a caller the lab does not run (the
    chain from EVFSW or the eye sensor, 4.3.6's open item). (3) The VSC model ends the run where the unit would not.
  - *Verified: (1), and (2) does not hold for the eye sensor.* H-EYESTATE's setter (`0x50050efd`) alone, with
    S-OUTDISP answering INTERNAL_EVF and no OPEN, resend or 131 of the lab's: the application's event task (165)
    asks getOutputDisplay twice (from `0x5104f269`), sends TRA 937 (stopHistogram, its stack through `0x51057525`,
    `0x51057822`, `0x51050290` and `0x5104fbea`), the OXF main thread sends DISPLAY cmd 15 and the run stops; 17 ms
    later task 165 sends the GUI 131 with device 6 from its own sender (`0x5105053c`, from `0x510504fd`); 50 ms later
    the GUI's ConnectChangePlay calls the output change with device 16 (from `0x510c6c6b`), which sends TRA 588;
    CapIod writes the output-device property 8 (through `0x50ab4f90`) and the opened word goes 1 -> 2; then task 165
    sends TRA 1061, 974, 994 twice, 1046 and 974. No errlog; 133 ms of lab time in all. Back (state 1): 131 with
    device 2, the output change with device 1, TRA 588, the property 1, the opened word 1, then TRA 1061 and TRA 938
    (startHistogram: DISPLAY cmd 13 and 14), 974, 994, 1045, 974, and the histogram runs again. So on the eye
    sensor's event the application stops the histogram before the GUI is told and starts it after the TFT is open:
    the camera's order, by the firmware's own chain (X; the eye driver's path to the setter stays open, input spec).
  - *Why 4.3.6's diagnostic 2 ended in a storm.* With no OPEN of the lab's, S-PROP kept the TFT's value for the
    output-device property (4513), which the lab sets only at its own OPEN: the application read it at S-PROP's site,
    found the output unchanged and sent 131 again after every change (more than 810 GESetEvent calls; errlog
    `0x3700140c` from `0x501dc7a7` about 600 times; I: the open's device step, repeated). With S-PROP following CapIod's
    write the chain ends as above. 4.3.6's "S-OUTDISP answers the EVF only while the lab's own OPEN holds it" was
    not the cause.
  - *The change.* Under camapp 3 the SWITCH is the firmware's own output change (`emu/src/lab/play.mjs`
    native_switch): the lab sets S-OUTDISP's answer and the eye sensor's state, settles, and checks what the
    firmware did: the opened word is the device's, the property its value, the GUI's connect state 5 or 2,
    ChangeOutline returned 0, no errlog outside the expected list, the module-9 reads within the switch's list. For
    its step S-PROP follows the property's writes (`emu/src/lab/camapp.mjs` prop_follow). No DISPLAY cmd 2 OPEN,
    H-RESEND or H-CONNECT. The screen the GUI is on afterwards is recorded, not judged (the lab's switch re-enters
    the screen it left; the application's change picks its own). Camapp 1 and 2 keep the lab's switch unchanged. LV
    takes the same path as the eye sensor, as it does in the lab's switch (H-EYESTATE on every switch); the camera's
    EVF button (EV_PRESS_EVFSW) has no producer in the lab (its code `0x1707`, given to UI_IN's code entry, is passed
    on to nobody).
  - *Property 1947.* With 1947 at 0 (eye-burn's first token) the application's eye handler asks getOutputDisplay
    once from another site (`0x51051d2f`) and sends nothing: no 937, no 131, nothing opens. With S-OUTDISP left on
    the EVF (a probe), its next output check then makes the change (from `0x5104fc44`, on an event of its own about
    0.2 s after the start in that run), so the answer the lab gives decides. The step records the switch as not made,
    with the reason, and puts S-OUTDISP back, so the device stays (camapp 1's lab switch does not ask 1947). That
    1947 is the menu's EVF auto switch (0: off) is I (the eye callback's registration arms the EVF's burn-in timer
    only at 0, vsc spec section 9 item 10); its name in the menu is not read. No change with 1947 not 0 has no reason
    read and stops the step (since the review, 2026-11-11): after a switch not made the eye state stays the EVF's,
    so with 1947 set back to 1 an LV to the EVF finds the setter's state unchanged, nothing is published and nothing
    changes (X); until then the step recorded that as not made, with 1947's text.
  - *From the Super Control Panel.* The application's change leaves the panel: the GUI is on the shooting screen
    (`0x0108`, panel 10) on the EVF and stays there on the way back, where the lab's switch (camapp 1, and camapp 3
    until this round) re-entered `0x0403`. Which the camera shows is not settled by a camera.
  - *What stops next: the EVF's plane level.* After the firmware's own open the three OSD planes of the EVF have
    PLANC `0xca`. The level comes with DISPLAY cmd 7, which the OXF main thread (task 57) sends synchronously after
    the open (from api_disp `0x503e624d`, the request's first byte 7; X, corrected in review: not a step of the open
    itself). The command's handler passes that byte to the level step `0x501c4f14` (`0x501c3580..0x501c3582`, D),
    which with the EVF open calls the EVF level table's `0x501c67aa` (the TFT's `0x501d8a10` otherwise,
    `0x501c4f2e..0x501c4f4f`, D); entry 7 of the table gives level 101, and the EVF level writer `0x501e2bcb` sets it
    on OSD1 to OSD3 (property 587 reads 1 on the way, so vsc spec item 3's 587 = 0 path is not the one taken). The
    compositor knows a plane level of 128 and of 0 (A7) and refuses any other (PLANC_UNOBSERVED), so every EVF
    composite after a switch is refused: the frames keep the last good one, and tokens-3b's WINDOWS token, which
    needs a composite, stops the session. The lab's own OPEN (DISPLAY cmd 2) leaves level 128 and camapp 1's switch
    sends no cmd 7 (X), so camapp 1's EVF composes. Where the index 7 comes from is not read (?): it is not vsc spec
    item 3's property 449 + 7 (with 449 set to 1 the index is still 7, X), so "a brightness setting of 0" is not
    shown. Whether the camera's EVF runs its OSD at level 101 follows only if its chain sends the same command (I);
    what a level between 1 and 127 does to the pixels is A7's open question (hardware). The same three errors are in
    the EVF composites of camapp 3's switch from the Super Control Panel before this round (the GUI's output change
    sent TRA 588 there too), which 4.2.4 and 4.3.6 counted as running.
- **Group 2, the power-off: not fixed; the lever's route to shutDown is not found.** Symptom and 586's stop as
  4.3.6. New: with the lever's off alone (the switch step, no S-SHUTDOWN) the components see the code, and do
  nothing with it in standby. CmpSqp_SequencePartsBase's handler `0x50c94612` (its log "APPEVENT_CAMST_POWER")
  calls the method at offset 4976 of its vtable with `0x0202000c` (D), `0x50cbf55e` (X: entered from there), which
  logs the "ERRSEQ" line (`0x50c86d2e`) and calls `0x50cbf597`: `0x50cbd2eb` (its block `0x50cbd486..0x50cbd69d`
  holds the logs "startErrorSequenceCtrl ShootGuard ON", "... Timer Stop" and "... TimeLapseGuard") returns 0, so
  the method at offset 4980 runs (`0x50cbf5c3`), then the error sequence's step `0x50cbd6a1` (D, X). `0x50cbf5c3`
  finds the code in its table (`0x60eb47c8`, entry 12, X) and branches on the sequence word `0x60364980` (D: 1 or 6
  sets the error sequence's code at +216 through `0x50cb11d6`, `0x50cbf6f2`): it is 0 (X), and on that branch the
  power code (`0x50cbfb83`, D) asks the method at offset 4736 (`0x50cbc194`, X: the vtable's entry; it answers 1
  only while the byte `0x60364950` is 1, D), which returns 0 (X: the byte is 0), and the function returns; only at
  1 would the power code go on (`0x50cbfb94..0x50cbfc2f`: two calls of `0x50c86837` and one of `0x50bc79dc`, D; what
  they do and who sets the byte are not read). `0x50cbd6a1` then reads +216 = 0 and returns at once (`0x50cbd6c9`, X).
  So in standby the sequence parts take the power switch's code and start no error sequence (I: the error sequence
  aborts a running shooting sequence; the names of `0x60364980` and `0x60364950` are not read). In 12 s of idle
  after it: no transaction but 944 and 994, no CameraCommon::shutDown (`0x50afd2d7`), no startShutDown, the sequence
  in its standby phase 101. Camapp 1 has no sequence parts and reaches none of it. What carries the lever's off to
  shutDown on the camera is not found (?), so S-SHUTDOWN's forced call stays the only way in, with the shoot mode
  still up. Candidates not taken: answering 586 in the lab, or stopping the flash first (4.3.6's control: the next
  capabilities stop the teardown the same way), would invent the route's steps.
- **Group 3, keys' stop: the session's module-9 scope, fixed.**
  - *Symptom.* keys' 15th call, the lens lock switch's release after a shot (the lens attaches again): "S-TAKEOVER
    scope: module 9 state read from `0x50c8a335`". The same site stopped S1's release after a menu and a PLAY pass
    (4.2.4).
  - *Candidates.* (1) A reader of the components' own state that the list lacks. (2) Code that depends on
    S-TAKEOVER's stand-in value 2.
  - *Verified: (1).* `0x50c8a335` is in the sequence parts' standby entry (`0x50c89da1`, whose start sets phase 101,
    `0x50c89db1`): with its word `0x60364954` set it reads module 9's state (`0x50c8a32c`) and, at 3, writes 0
    (`0x50c8a339..0x50c8a33c`), else goes on (D). Under camapp 3 the state is the components' own from the start on
    (0 from `0x50ca4ae1`, 4.1.5): the read returns 0 with the word at 1, and the components write 0 again from
    `0x50ca4ae1` and `0x50c78b0e` (X). The site joins CMP_MODULE9_READERS (`emu/src/lab/camapp.mjs`); taken out
    again, the same step stops at the guard (the test's control). 4.2.4's S1 release after a menu and a PLAY pass
    runs too: the read returns 0 with the word at 1 and the sequence is back in phase 101 (X).
  - *What remains in keys.* After S2 camapp 1's GUI shows panel 0 to the session's end (S2's rec view, I: ROADMAP's
    panel 0) and camapp 3's keeps panel 10; the multi-selector's press and its up and right reach the GUI in
    camapp 1 (`0xf835`, `0xf83c`, `0xf858`, `0x9005`, `0xf85b`, `0x900b`) and not in camapp 3. Not followed here:
    the shot under camapp 3 (S1 is refused by the sequence parts' guard before a menu pass, 4.3.2, 4.1.7) and MF
    (4.3.7) are the tracks take-111 and af-gate (4.1.12, 4.3.8).
- **Group 4, the menu's entry takes lab time (tokens, play-perf, pace-wall): no defect.** OPEN (the GUI's menu
  request, sent by the lab) leaves the GUI in `0x0b01` (ID_ST_MENU_ENTRY): the GUI task sends TRA 994 four times,
  694, 991 and 593 and sleeps; 10 ms later it sends DISPLAY cmd 4 and 5, 23 ms after that cmd 17, and `0x0b02` is
  there 50 ms after the request. In camapp 1 S-TRAACK answers each transaction at the exec, and the menu is open in
  the request's own step. tokens sends OPEN, CLOSE and EV:217 with no lab time between them, so under camapp 3 the
  last two reach a GUI still in `0x0b01` and the session ends there; with 10 ms steps between them the states are
  camapp 1's (`0x0b02`, `0x0104`, `0x0407` panel 452). play-perf and pace-wall differ only at the calls between
  the menu's request and the next one that lets lab time pass.
- **Group 5, the first 0.3 s after the start (playback, inputs).** The lab's start ends when the GUI shows its first
  screen (2.855 s); the application's start goes on (the date prompt's panel 324 gives way to panel 10 at the first
  idle in both camapps; camapp 3's media manager ends its second slot's mount at 3.06 s, 4.3.7; with the second slot
  empty by default since 4.8.12 port 1 gets no command). playback: PLAY's
  step ends before the GUI leaves the shooting screen and No Picture is there at the next call (4.1.9 has the
  order). inputs: the GUI answers the application's touch forward (event 35) with 94 for the Wi-Fi icon at
  (90, 30) in camapp 1, and the application opens Wi-Fi Connection; under camapp 3 the tap, which ends 0.1 s after
  the start, is answered 55 (the bare shooting screen's answer, 4.4.2), 57 with 0.1 s of idle before it and 94 with
  0.2 s or more, from where the menu opens as in camapp 1. What makes the icon answer (I: the start's end in the
  components, the second slot's mount by its time) is not read.
- **Group 6, queue: the slide.** In camapp 1 the slide on the shooting screen sends TRA 988 alone; under camapp 3
  the application sends TRA 974 (ctrlRelease) and 984 twice besides (OlyHfwOpeShoot::notifyGesture, at the slide's
  start and end), and from then on UI_IN's dial steps and EV_PRESS_LEFT_KEY bring no GUI event (camapp 1: `0xf001`
  for the dial, and the left key opens `0x0405`, panel 491). The sequence stays in phase 101 and the tasks wait
  where camapp 1's wait (X: the stacks of tasks 57, 162, 164, 165, 166 and 168), so no task is blocked. With the
  Fn lever at position 1 (S-AF, 4.3.7) the slide also sends TRA 966 and a synchronous TAKE_FUNC command 29, and
  the keys are lost the same way. Which gate of the application refuses them after the gesture is not read (?):
  the neighbour is the touch target's path through the components (AF, TAKE).
- **b7-gate.** Camapp 1's session ends at its second OK in UI_IN group 1's event storm (more than 810 GESetEvent
  calls, 4.2.4); camapp 3 takes the key and runs to the end. Nothing to fix under camapp 3.
- **Also found, left as it was.** With S-PROP following the property's writes at every output change, camapp 3's
  HDMI plug goes on to the GUI's HDMI layout and stops at a vsync wait on channel 0, whose line time the lab sets
  only after the step (`emu/test/test_camapp.mjs` traRoutingSession's `--hdmi on` part in that trial; 25 of 25
  without it). So the follow is on for the display switch's step alone, and at the plug S-PROP keeps the panel's
  value as before: the HDMI layout under camapp 3 is open (4.9).
- **Corrections.** 4.2.4's count (ten "take other GUI states or end early") mixed stops and other states and took
  switch-scp's EVF for running; its keys entry is group 3's stop. 4.3.6: the camera's stop of the histogram comes
  from the application's own display change on the eye sensor's event, before the GUI's 131, not after it (its
  order there was the lab's switch's); diagnostic 2's storm was S-PROP's stale value. 4.3.6's "the lever's off
  alone sends no transaction and calls no shutDown" holds, and the components do see the code (group 2).
- **Tests (X).** `emu/test/test_c3power.mjs`: evfSwitchSession (9 checks: under camapp 3 LV is the firmware's own
  change with TRA 937 before TRA 588, the EVF open, the property 8, the run word 0 and no `0x37001418`; the EVF's
  composite stops at three PLANC `0xca`; back, TRA 588 before TRA 938, the TFT open and composing, the histogram
  running; with 1947 at 0 the eye sensor's switch is recorded as not made, and with 1947 back at 1 LV's unchanged
  eye state stops the step; from the Super Control Panel both
  switches land on the shooting screen, the module-9 reads listed; camapp 1's order and the output change without
  the application's stop as in 4.3.6), leverSession (2: under camapp 3 the lever's off reaches `0x50c94612` once,
  takes the standby branch (`0x60364980` 0, the method at 4736 returning 0) and leaves `0x50cbd6a1` at its +216
  test, with no shutDown, no TRA 586 and the phase 101 1.5 s on; none of it in camapp 1), standbySession (2: the
  standby entry's read returns 0 with its word at 1 and the step runs; without the list's entry it stops at the
  guard), powerOffSession (7, unchanged).
- **Open.** The VSC's plane level (A7: PLANC `0xca`, the EVF after the firmware's own open) and where DISPLAY
  cmd 7's index 7 comes from; what carries the lever's off to shutDown on the camera (not the sequence parts in
  standby; the byte `0x60364950` the power code asks for); the EVF button's producer and what the camera's eye sensor
  does with 1947 at 0 (the lab's LV is an eye-state change under camapp 3, so with 1947 at 0 LV switches nothing and
  the eye state stays the EVF's); which screen the camera shows after a switch from the Super Control Panel; the
  application's gate after a slide's notifyGesture; the GUI's answer to a tap in the first 0.2 s; the HDMI layout
  under camapp 3.
  (The AF pins are rewritten in 4.3.8: 13 checks.)

#### 4.3.11 The EXIF set natively (2026-11-13; D unless tagged, addresses E143's)

- **Why.** S-EXIFPRM copied the template and formatted the dates itself because the EXIF set "divides by zero in
  TAKE's state" (4.1.4, 4.8.10). A patch that hooks the per-shot fill inside the EXIF set (a modified firmware's
  photo code in ImageDescription and UserComment, for one) never ran in the lab. This round reads the divide back
  to its operands.
- **The EXIF set.** TAKE's takepic (`0x503bcd51`) calls the module's wrapper `0x5042992d` (`call 0x5042b50d; ret
  [],4`) at `0x503bd48e` with a0 the shot's block. The body `0x5042b50d..0x5042cd6f` calls TAKE's arithmetic block
  `0x5039821c` 20 times (`0x5042bb7e..0x5042c0fe`), each with a request on its stack whose +24 .. +36 point at four
  halfwords of the block (the maker notes' white-balance gains, +6342 on). For the request's kind 0
  (`0x503986f9..0x50398739`) the block copies a row of the white-balance preset table `0xa31f1bd0` (the request's +2
  picks the table's block, `0x5039822a..0x50398240`, its +4 the row) through those pointers and calls `0x50398a55`, which
  scales them and divides the larger of the +32 and +36 products, << 7, by the smaller (`0x50398ca5` /
  `0x50398cbc`). With the table's zeros that divisor is 0. The table is IMG_PRECON's: its module init `0x502a49b3`
  (USTART2's stage, `0x501e8ec0`) builds it through `0x5039814c` -> `0x5039950e` (4.2.2), and the lab's start does
  not run that stage. So the zero is not TAKE's state, and 4.1.4's "the state it divides by is the take's
  (takepic's), not the start's" is wrong: the probe's start does not run IMG_PRECON's init either (H-EXPINIT runs it
  only with `--cpu2 native`). 4.2.2's mode-1 divide in TAKE_EXPOSE's white balance is the same instruction with
  other operands (`0x5056f1bb`'s locals).
- **Run natively (X: an experiment at S2, then the lab as below).** IMG_PRECON's init returns 0. Then the EXIF set on
  S-EXIFPRM's block runs to its return: 18 calls of the arithmetic block (the request kinds 0 and 2; kind 2 at
  `0x503983cc` is not read, its requests call `0x50398a55` twice each), no error log, and the per-shot fill's code
  runs once (on E147 the instruction at `0x50436558`, E143's `0x5042c2d5`, after two string copies from the settings
  store, `0x5042ceb5` at `0x5042c2c0` and `0x5042c2d0`). Without the init it stops at
  `0x50398ca5` (fault 6), in the experiment and in the lab with H-RECPRECON taken out (X: test_storage's S2 stops
  there). The init also binds its two queues to its flag (`0x5002c285`), resets its 13 settings (ids 50674 ..
  50866; I: white-balance gains, such as 159/448; `0x50041dbc` -> `0x50041de5`, which copies each setting's
  default) and copies settings into properties (`0x5004188b`). In a default session the 13 settings hold their
  defaults already (X: read before and after, each of the four values the same).
- **What the EXIF set writes and reads.** The dates from the time record +37800 (`0x5042c16a..0x5042c196`, the code
  S-EXIFPRM ran itself before); the digital zoom ratio +4228 as 0/100 (X; the header maker's `0x504287f1` divides
  by its denominator); X and Y resolution 350/1, the time offsets (`+09:00` from the lab's settings store), the
  maker notes' white-balance gains, exposure mode, picture mode and the UTC date among others (X: exiftool, the file
  before and after). It does not write the crop areas +40858 / +40866 (no access in the body; X: 0 after it), so
  S-EXIFPRM keeps them. It reads the aspect +38122 (`0x5042c356`), so S-EXIFPRM writes TAKE's settings fields before
  it. The shooting values are conversions of takepic's fields: ExposureTime +4152 from Tv +38164 with +38166, +38168
  and +38200 (`0x50573517` from `0x5042c41f`; from +38212 instead where Tv is `0x8000`, `0x5042c3a6`), FNumber
  +4192 from Av +38178 with +38182, +38184 and +38200 (`0x50573611`) only where the record's +37982 has bit 12
  (`0x5042c460`), 0/10 otherwise. takepic fills Tv, +38172 and Av from its exposure record's +6, +8 and +10
  (`0x503bcdac..0x503bcdc7`; the record is its argument's +48, or its request's +60), Sv +38174 from TAKE's state
  (+3144's +202), +38170, +38176 and +38180 from the record's +56, +58 and +60, +38188, +38200 and +38202 from the
  settings 41050, 35818 and 36442, and +38198 from the AE result object `0xc0ba` (`0x503bcecb`). The exposure record
  comes with TAKE_MAIN's take request, which the lab does not run (S-RELSEQ), and S-EXPOSE's plan (`0x62a919dc`: +6
  Tv, +10 Sv, +14 Av; its address appears in the code only at `0x50560b2c` and `0x5056108b`) has another layout; which of TAKE's steps copies
  the plan into that record is not read (?). So S-EXIFPRM leaves takepic's fields the template's 0, and the file
  carries the EXIF set's conversions of those zeros: ExposureTime 1 s (Tv 0), FNumber 0/10, ExposureProgram 5, and ISO
  25 (REC_IMAGE's, 4.3.5). These are not the session's exposure.
- **The lab (`emu/src/lab/rec.mjs`).** Where `src/fw/facts.mjs` recFile reads the EXIF set (`exif.set`: the wrapper,
  the one call of the function that holds the date set and is followed by `ret [],4`; E143 `0x5042992d`, E146
  `0x5042588c`, E147 `0x50433b5c`, X: `emu/test/test_facts.mjs`), H-RECPRECON runs IMG_PRECON's init (at its port's
  place, `A()`: E146 `0x502bbc32`, E147 `0x502cd4b6`) at the first picture, unless H-EXPINIT ran it, and S-EXIFPRM
  runs the EXIF set natively after its copy, the clock read, the crop areas and TAKE's settings fields. Its own date
  formatting and the zoom ratio 1/1 remain on the bodies whose rule reads no EXIF set (the E144 family,
  recFileInline's, the E118 family's).
- **What runs (X, `emu/test/test_storage.mjs` storageSession on E143, E146 and E147).** One native run of the EXIF set
  per picture, after H-RECPRECON. The file's dates are the clock's, as before. X and Y resolution 350/1, the zoom
  ratio 0/100, ExposureTime 10/10 and FNumber 0/10 (refs/exif.mjs). Control: a fresh template copy, with the clock
  read after the clock was set to another date, gets that date from the EXIF set and keeps the template's empty
  DateTimeOriginal without it. A modified OM-3 firmware that hooks the per-shot fill (Caduceus v0.29, outside the
  tree) wrote its film's name into ImageDescription and its code into UserComment in the card's file, which it did
  not before (X).
- **Open.** The source of takepic's exposure record (TAKE_MAIN's take request, 4.1.4's plan step 1) and of TAKE's
  state +3144; the lens flag +37982 and the lens fields; the EXIF set on the E144 family's, recFileInline's and the
  E118 family's REC versions (no rule reads it there; the E118 family's set divided by zero too, finding 103, whether
  in the same table is not read); the orientation (4.1.4's plan step 3).

### 4.4 AF, lens and body IS

- **Tasks (D):** CPU 0: LENS_MAIN 0x5c `0x502a5e37` (queue LENS_EXEC 0x2e, target 18), LENS_COMMAND 0x5b `0x50115a08`
  (queue 0x31, target 40), LENS_ASKDATA 0x5a `0x502a8193` (queue 0x2d), LENS_FLASH / LENS_FIRM_UP, ZOOM 0x6e (queue
  ZOOM_EXEC 0x7d, target 26), BC_MAIN 0x57 `0x5013e603` (queue BC_EXEC 0x09, target 34), BC_INDICATOR 0x91, TAKE_FOCUS
  0x68 (queue 0x5d; dispatch through a static 64-slot hash table at `0x60a64f00`, 4.1.8), FCS_IP 0x6f / FCS_IP_SUB
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
    menu and playback run since the imgpro unit, but a pass of S1 and S2 after them leaves the next key untaken
    (4.3.1), so a full pass is not measured there.
  - **Kept behind S-RPC, open (X: 5 a pass, with and without the components):** the 72-byte request object (vtable
    `0x60de54e8`) `0x50ac722a` builds (operator new at `0x50ac723d`, its constructor `0x50ac7291` sets its own-delete
    word +20 to 1) and hands to its method `0x50ac734c`, which S-RPC answers 0 at its entry. The method's no-channel
    path (`0x50ac7381..98`) returns 0 too and deletes it through `0x50ac72e3` (operator delete when +20 is set); a
    send's failure completes it through `0x50ac7eba`, which sets +20 again, and deletes it (`0x50ac743c`). On the
    synchronous path the method clears +20 before it posts (`0x50ac73dd`) and keeps the object after its wait; the
    reply's handler (vt[2] `0x50ac744e`, reply 425) signals the waiter and sets +24, not +20. So no code of this class
    frees the object after a reply (D); whether the receiver does, by a route not read, is ?. S-RPC leaves it: freeing
    it would be the no-channel path's choice, which the lab cannot show the camera takes.
  - **Not a heap block, answered 2026-11-10 (4.3.2):** the seventh pass ends in the lab's blocked-send guard, with or
    without the fix: at PLAY up task 165's request to queue 6 (`0x503eba00`) waits on a full queue while task 164's last
    receive was on queue 6 (X). Corrected (X, 4.3.2): the send waited on TAKE_FUNC's queue (0x5e), full with the
    requests S-MODACK had answered but left in it; the guard named the queue of a later send through the same site.
    S-MODACK now takes the message, and ten passes run. The test runs five passes.
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
     `emu/src/lab/wm8946.mjs`). AUD_MAIN (task 0x52, entry `0x50a62a05`) runs as USTART3 starts it (`0x501e950b`;
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
- **Shared IRQs:** the imgpro IRQs 282-283, 288-292 and 296-302 are attached on all four cores (4.3); which core
  services them, and 307-309, 53 / 54 and 323-326, depends on the enable calls `0x50054012` / `0x5002ea93`, not scanned.
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
  on the branch, with the same workload digest (`13fa8f7471592f8a`; the digest then pinned in playperf was stale on
  master too, and is re-pinned to this one since: commit e69ad4d's delivery of S-DISPQ's replies to queue 6); test-pure
  81.8 s and 81.9 s; a session of open, 2 s, OK to the Super Control Panel and 2 s takes 7,944 ms with
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

#### 4.6.2 CPU 2 natively, round 2: queues and CPU 0's link (2026-11-09; D unless tagged, addresses E143's)

Still behind `--cpu2 native` (E143, off by default; `emu/src/lab/cpu2.mjs`, `emu/src/core/cores.mjs`,
`emu/test/test_cpu2.mjs` cpu2Session and cpu2Histogram): CPU 0's CPUCONN_CPU0 and CPUCALL_CPU0 now run, USTART_L2 is
stood in for, the four CPU 2 tasks CPU 0's boot stages start that a lab session can reach are started, and under
`control camapp 3` OSD_DRAW_CPU2 draws the GUI's histogram natively (X). golden is unchanged and a default session
runs the same instructions (the cost bullet). Round 1's open item 1 is corrected below; its items 3 and 4 are done.

- **CPU 0's side of the link (H-CPUCONN0).** CPU 0's init task starts CPUCONN_CPU0 (`0x99`) and CPUCALL_CPU0 (`0x9a`)
  with act_tsk (`0x5002cd0c..0x5002cd2d`, right after its tick init and the tick magic `0x5003b542(3)` at
  `0x5002ccdc`); the lab ends that task, so neither ran in round 1. Both now start with act_tsk before CPU 2's boot and
  wait (X): CPUCONN_CPU0 on its flag (`0x5002cf11`), CPUCALL_CPU0 in `0x50016096` (`0x5003638e`), its receive of the
  CREQ dispatcher's messages (cores spec 5.1). For each call from CPU 2 CPUCONN_CPU0 creates a proxy task (entry
  `0x5002cf6e`), which the lab's task-start guard allows; OSD_DRAW_CPU2's replies are served that way (X, below).
- **USTART_L2 (H-CPU2LOADER; round 1's open item 1 corrected).** With FLASH_CS1 granted natively (the control
  `cpu2-loader`, X), USTART_L2's copy of segment 1 makes no CREQ: the flash driver's read of chip 1 (`0x500022c2` ->
  `0x5000237a` -> `0x50002219` -> `0x500019b3` -> `0x50001c23`) programs a DMA in `0x98d00200..0x98d0048c` (eleven
  stores, the last to `0x98d00324`; IRQ 238 attached on the calling core, `0x50001cd7`) and its first write,
  `0x50001c4c`, is a bus error: CPU 2 parks and the session stops (X). The block also holds the start addresses
  `0x98d00140..148` (cores spec 3.1). Past the copies, the CREQ's `0x50024eda(n)` runs the segment's static
  constructor table through `calls` (`0x501e6112..0x501e6121`: segment 2's 15 pointers at `0x60714e78`, 6's 48 at
  `0x60ef9ad0`, 7's 64 at `0x615c71d4`, 8's 6 at `0x617d0310` on CPU 1; 1, 4 and 9 have empty ones, 3, 5 and 10 no
  hook). The lab's bring-up runs segments 2, 6 and 7's on CPU 0 (`src/lab/osd.mjs` mm_ctors, `src/lab/menu.mjs`
  CTOR_TABLES), and run again they would construct live objects a second time (I); segment 8's would run on the absent
  CPU 1, and the lab does not run it. Of USTART_L2's byte flags `0xa32df1ad..0xa32df1b6` and `0xa32df1b9` only `1ad`,
  `1b6` and `1b9` have readers that name their addresses, all boot code the lab does not run (`0x5002418a`,
  `0x50024488`, `0x500243d1`, `0x501e9e17`, `0x501e996c`; a scan for the addresses, which a base-relative read would
  escape). Its last call `0x504262b5` reads resource 0x8007 item 17 to `0xa51a8680` and clears bit 17 of `0x97f0027c`
  (the DSP service's word); `0xa51a8680` is named again only at `0x50426ea2`, which passes the address on. Neither
  happens with the stand-in, and whether code the lab runs depends on them is ?. So USTART_L2 now returns from its
  entry at once, to the kernel's task exit (`0x5001182d` -> `0x500107e8`), with no cross-core call (X); CPU 2 reaches
  its first halt in 35,135 instructions (35,788 in round 1, with USTART_L2's twai_sem).
- **The CPU 2 tasks CPU 0's boot stages start (H-CPU2TASKS, X).** The stages (`0x501e8f09..0x501ea7a9`) start them
  through OlyTaSt after a module init; the lab now does the same at the play bring-up, in the stages' order: the init
  natively on CPU 0, then OlyTaSt from the lab task, which waits while the start goes to CPU 2 (cpu_conn kind 9,
  CPUCONN2's proxy, act_tsk there). Each task waits at once, with no device access in its own context and no
  cross-core call. The stages' other steps between are not run (D), among them MVR_MAIN's site's wait for the byte
  `0xa32df1be` (set by USTART_L `0x50024259` and USTART_L3 `0x500244b5`) and `0x501e6a7f(2)`, and for SDET the starts
  of FACE_MAIN `0x3009` on CPU 3 (`0x501e96a7`) and FACE_BEAUTY `0x100a` on CPU 1 (`0x501e96c9`) and `0x50512a3c`
  (which clears the byte `0x62ef0fa4`), all between its init and its start: the init `0x50510afd` lies among SDET's
  own functions (right after its wait `0x50510a9a..0x50510afc`), and which of the three tasks needs it is ?.

  | Task (entry) | Start site; the init before it | Waits (X; the wait's site D) |
  |---|---|---|
  | WB_MOV `0x200f` (`0x5046aab2`) | `0x501e9157`; `0x5046aa2b` (call at `0x501e9150`): context words, `0x500417da(16234)`, `0x5046c794` | OlyQeRd on its queue `0x2006` (`0x5046aadb`) |
  | MVR_MAIN `0x2002` (`0x5045fcdd`) | `0x501e9233`; `0x5045fed3` (`0x501e91ee`): `0x5044ec78` with MOV_COMMAND `0x2001`, MVR's flag `0x2003` and 4, then with queue `0x2002`, the flag and 8 (I: the queues bound to the flag's bits) | OlyEvWt on flag `0x2003`, pattern `0x383fd` (`0x5045fd27..0x5045fd45` -> `0x5044ec9c`), after 18,006 instructions of start-up |
  | SDET `0x2010` (`0x5050cc2a`) | `0x501e96f1`; `0x50510afd` (`0x501e96a0`), before the starts of FACE_MAIN and FACE_BEAUTY (above) | OlyEvWt on flag `0x2005`, pattern 3 (`0x5050cd1d` -> `0x50510aad`) |
  | OSD_DRAW_CPU2 `0x2015` (`0x51015f1d`) | `0x501ea04c`; none | OlyQeRd on its queue `0x2013` (`0x51015f4f`) |

- **TAKE's requests to MOV_COMMAND, SDET_EXEC and WB_MOV are not made in the lab's sessions (X).** No cpu_conn on
  `0x2001`, `0x2005` or `0x2006` and no post to CPU 2 but the Super Control Panel's over the start, idle, S1, S2, the
  releases, REC, MENU and PLAY, in camapp 1, and in camapp 3 with `--take probe`: TAKE_FUNC's commands 28, 30, 31, 68
  and 69 (4.1.1) are not reached (as in 4.1.4 and 4.1.7). So those three records end at the tasks' waits; what each
  does with a request, and its first device access after one, are ?. 4.1.1's "no lab runs a CPU 2 reader" no longer
  holds with `--cpu2 native`: the readers wait on their queues. The only request CPU 0 makes of a CPU 2 queue in the
  lab's sessions is the GUI's histogram.
- **The histogram on OSD_DRAW_CPU2 (X unless tagged).** OSDControl::drawHistogram (`0x50ae9f5f`, API 0x11117) calls
  `0x510149a2` at idle, S1 and S2 (shutter spec item 42; 12 times in 2 s of camapp 3's idle). That copies the request
  under OSD_SDRAM_WRITE (36 bytes to `0xa33eb558`, its plane descriptor to `0xa33eb57c`, the two series of n words to
  `0xa33eb58c` and `0xa33eb78c`) and sends {reply queue, word, command 1, `0xa33eb558`} synchronously (`0x5002e39d`: a
  reply queue created on CPU 0, OlyQeWr to `0x2013`, OlyQeRd on the reply queue; D).
  - *Camapp 1 and 2: S-MODACK still answers it E_OK.* The series' words there are `0xdeadbeef`, the fill the task
    creation `0x5002cbe7..0x5002cbf8` writes into a new task's stack (D), and a watch on them from the lab's start
    sees no other write: S-TRAACK's answer to getHistogramData fills nothing, so a native draw would draw columns of
    that height.
  - *Camapp 3: natively.* The series come from the firmware's own path (the VSC histogram's cmd 16, its ring, TRA 944;
    0, and 64 in bin 5, while IMG1 is off, 4.2.1). The OlyQeWr to the CPU 2 queue is a cpu_conn tsnd_mbf (kind 1);
    OSD_DRAW_CPU2 takes command 1 (`0x51015f63`), checks the request (`0x51015e30`, which the GUI's `0x510149a2` also
    runs before it sends: the request, its plane and both series set, bit 31 of the plane's first word, the buffer's
    address, set, 0 < n <= 128, 0 < w, n <= w, x + w <= 1664, y + h <= 1200, scale > 0; D), draws, and replies {0, word,
    parameter} to the reply queue
    (`0x510160b8`), a cpu_conn kind 1 on CPU 0's queue (`0x104` in the run) that CPUCONN_CPU0's proxy serves; the
    GUI's wait returns. Every send is taken and answered with status 0 (12 of 12 in 2 s), each request {command 1,
    x 4, y 110, 256 x 63, n 128, scale 64}, its plane `0xb7493000` and `0xb767a800` in turn.
  - *Command 1 (D, `0x51015fe9..0x51016087`).* For each column k < w, bin b = k * n / w; the series at +16 is drawn in
    the colour at +34 from the rectangle's bottom row up, bin * h / scale (+20) rows at a stride of 1664 bytes, then
    the series at +12, in the colour +31, +32 or +33 chosen by b against +26 and +28, from there on up to its own
    height (the row count is not reset between them, so it shows only where it is taller). This answers the cores
    spec's open question 3.
  - *Result.* In both buffers bin 5's columns x 14 and 15, rows 110..172, turn from index 52 to 54, and the pixels
    beside them stay; a camapp 3 session without CPU 2 leaves 52 there. The TFT channel's OSD plane 1 address register
    reads `0xb767a80` at that time (the buffer's address >> 4, I). No device access in OSD_DRAW_CPU2's context. The
    TFT's composite stays FEATURE_UNOBSERVED under camapp 3 (4.1.5, A13), so no frame shows the column yet (it does
    since 4.2.4, under A-VSCHIST-3).
- **H-CPU2POLL narrowed (X).** It now sleeps at the loop's head only while the halt word `0x97f00100` is 0. With the
  word set (BOOT_CPU2's `0x50038666`), which is every lab session (no CPU 0 writer of 0x40002 is known), the loop
  halts natively every pass at `0x50038b09`, and each tick runs the rest of the pass and halts again.
  `test_cpu2.mjs` writes 0x40002 (core 2 then sleeps at the head under the stand-in) and 0x40001 (back to the halt).
- **What stays, and why (D, I).** H-CPU2RELEASE: the release flag comes from CPU 0's reset head (`0x50000282..
  0x50000329`: the flag 0, the three start addresses to `0x98d00140..148`, four bit-sets per core in `0x98800340..
  0x98800434`, for CPU 2 `0x98800344` bit 0, `0x98800350` bit 21, `0x98800370` bit 6, `0x98800430` bit 0, then the
  flag 1), which the lab does not run, and which bit-set releases the core is ?; the tick magic is the init task's
  `0x5003b542(3)`, and the lab ends that task. K-BOOTSYNC2: CPU 2's ring partners are CPUs 3 and 1 (wait on 3, kick
  1, wait on 1, kick 3; CPU 0's only partner is CPU 1), both absent. K-STARTBITS: CPU 0 sets its bit in its own
  barrier at its kernel start, which the lab never runs (it owns CPU 0's first dispatch), at the session's creation,
  before CPU 2 boots at the play bring-up; CPUs 1 and 3 are absent. None of the three is retired.
- **Cost (X; means of 3, alternated, load average about 3).** A default camapp session (open, 2 s, S1, S2, 0.8 s)
  runs 187,314,635 instructions to the same lab time on master and the branch, in 6,675 and 6,680 ms. A session of
  open, 2 s, OK to the Super Control Panel and 2 s: 6,626 ms without the flag, 7,075 ms with it (+6.8%; round 1's code
  6,917 ms); CPU 0 runs 32,465 more instructions (round 1: 3,259), CPU 2 8,605,799 (round 1: 8,010,523; I: the
  difference is mostly the native halt's pass per tick). Camapp 3, 2 s of idle: 5,299 ms against 5,588 ms (+5.5%),
  CPU 0 +149,523 instructions, CPU 2 5,438,481, 12 histograms drawn. Re-run in review (X, at load average 5 to 10):
  every instruction count above to the instruction; the wall times varied by up to 2.6 s between runs of one session,
  so they neither confirm nor refute the percentages (the default session 7,951 ms on master, 8,263 ms on the branch,
  means of 3, alternated).
- **Open, in order (I; Claude wall-clock).** (1) A frame of the histogram: the TFT composite under camapp 3 (what
  HIST1..3 do to the mixer, 4.2.1, A13): unknown (taken in 4.2.4 under A-VSCHIST-3).
  (2) TAKE's queues: TAKE_FUNC's commands 28, 30, 31, 68, 69 reached
  first (the through start's TRA 991 path, the movie API; 4.1.4), then each task's request record: 2-4 h each. (3)
  AUD_WAKEUP on CPU 2 (round 1's item 2): 2-4 h. (4) Snapshots and the live debugger with two cores (round 1's item 5;
  the session's MMIO record now holds the machine's trace hook while CPU 2 runs): 1-2 h. (5) The release, the boot
  ring and the start bits need CPU 0's reset path and CPUs 1 and 3 (above). (6) The flash DMA `0x98d00200` would be
  needed only for a cold boot's loader, which the lab does not run (I).

#### 4.6.3 The start tasks and their phases (2026-11-11; D unless tagged, addresses E143's)

4.8.11 found that none of the conditions USTART4 and USTART5 wait for is met in the lab. This section maps every start
task: what each waits for, what it calls and starts and in what order, who sets each condition, and which of the lab's
steps stands for which part. A probe then runs each start task natively, as far as it goes (`emu/bin/ustart.mjs`,
`emu/test/test_ustart.mjs`; off by default, no session runs it). One order the map showed wrong is fixed: the event
broker's init now runs before the HighLevel steps (below); the default sessions change in instruction counts only.

- **The chain.** The kernel's static task table names seven start tasks on CPU 0. The docs' names are the ones the
  firmware logs at each start; the task name table's are in brackets.
  - BOOT_CPU0 (task 1, `0x5002cca5`, priority 1) is the init task. It starts USTART_L and then runs two functions in
    its own context: stage 0 (`0x50023eca`, marks `0_`) and stage 1 (`0x500248b4`, called at `0x50024172`, print
    "Usr1", marks `1_`). Stage 1 ends by starting USTART2 and calling OlyTaSE (`0x5002c701`), which for the four init
    tasks is `chg_pri(70)` and the idle loop `0x5002c756`.
  - USTART_L (USRSTART_LOAD, task `0x2b`, `0x5002417a`, marks `L_`), started at `0x5002cd98`.
  - USR_FAST_APP (task `0x55`, `0x501e673b`, priority 36, marks "MIS" / "MIE"), started by stage 1 at `0x50024c7a`.
  - USTART2 (USRSTART2, `0x28`, `0x501e8e84`), USTART3 (USRSTART3, `0x2a`, `0x501e94a5`), USTART4 (USRSTART4, `0x29`,
    `0x501e9d54`) and USTART5 (USRSTART5, `0x27`, `0x501e9e94`), all priority 55. Each prints "UsrN", runs its steps
    and ends by starting the next (`0x50024d9b`, `0x501e9393`, `0x501e9d1c`, `0x501e9e5c`), printing "PrN" and
    calling OlyTaSE, which for any other task is ext_tsk. So they run one after another, never two at once.
  - Beside them run the loaders USTART_L2 (CPU 2, `0x2013`, `0x50024572`, marks `N_`; 4.6.1) and USTART_L3 (CPU 3,
    `0x300e`, `0x5002440b`, marks `M_`), started by their cores' init tasks.
  - Two more start functions are no tasks: "UsrA" (`0x501e93cb`, called from `0x50420349` with a mode word; for one
    mode it starts ADJSLF after a wait for phase 9) and `0x501ea75d` / `0x501ea792`, which start (OlyTaSt) and end
    (OlyTaSp) ASH_REC_SHELL and FILEISCAM on CPU 1, called from `0x5003be41` and `0x5003bf0c` beside the A53's start.

  The four USTART tasks make 28, 47, 3 and 56 direct OlyTaSt calls (the cores spec's 83 / 17 / 26 / 10 count the
  starts per target core), stage 0 seven and stage 1 seventeen.
- **The conditions they wait for** are of four kinds. No wait but one has a timeout.
  - *Phases:* bit n - 1 of `0xa32df1f4`, n 1..10. USTART_L2 loads segment n (`0x50024e6b`, which sets the same bit of
    `0xa32df1f8`) and posts the CREQ that runs `0x50024eda(n)` on CPU 0 (n = 8 on CPU 1; 4.6.2), whose last store sets
    the bit (`0x50024ffa`). `0x50024de8(n)` waits for it in 2 ms sleeps; `0x50024dcf(n)` reads it.

    | Phase | Waited for by (the call) | Read by |
    |---|---|---|
    | 1 | stage 1 (`0x500248d0`), BOOT_CPU1, 2, 3 (`0x50008ce7`, `0x50009072`, `0x50009474`) | |
    | 2 | USTART_L (`0x5002422b`), USTART2 (`0x501e8ea5`) | `0x50023b4e` |
    | 3 | USTART3 (`0x501e94d3`) | `0x5016ecad`, `0x5018a5f0` |
    | 4 | USTART_L (`0x50024299`), USTART3 (`0x501e94e9`) | |
    | 5 | nobody | |
    | 6 | USTART4 (`0x501e9d80`), AUD_MAIN (`0x50a62a48`) | `0x502a52ab`, `0x502a52cb` |
    | 7 | USTART4 (`0x501e9d89`), USTART_L2 before segment 8's CREQ (`0x50024803`) | |
    | 8 | USTART_L (`0x5002435c`), USTART_L2 before segment 9's CREQ (`0x5002483f`), USTART5 (`0x501e9ec2`) | |
    | 9 | USTART5 (`0x501e9ed8`), `0x50a6c5b4`, UsrA's `0x5187d20f` | `0x5004066c..0x500406df`, `0x50954c53` |
    | 10 | USTART5 (`0x501e9eee`) | `0x50047391` |

  - *Loader bytes* `0xa32df1ad..0xa32df1c0`, each set to 1 when a step of a loader is done. They tie the three loaders
    to one another and gate four of the start tasks:

    | Byte | Set by | Waited for by |
    |---|---|---|
    | `1ad` | USTART_L2 after segment 1 (`0x500245a7`) | USTART_L (`0x5002418a`), USTART_L3 (`0x50024488`) |
    | `1ae..1b5` | USTART_L2 after the segments 2..9 | nobody (4.6.2) |
    | `1b6` | USTART_L2 after segment 10 (`0x5002487f`) | USTART_L's end (`0x500243d1`), USTART4 (`0x501e9e17`) |
    | `1b7` | USTART_L3 after "D1" (`0x5002443e`): `0x50040d4d`, a flash read of 512 KiB from `0x400c0000` | USTART_L (`0x500241ac`), stage 1 before `0x50040d78` (`0x50024d57`) |
    | `1b8` | USTART_L3 after "LB" (`0x50024482`): `0x5012a799(0xa32df1cc)` | USTART3 (`0x501e9957`) |
    | `1b9` | USTART_L2 after "LF" (`0x5002464c`): a 32-byte flash read from `0x51ffffe0` | USTART3 (`0x501e996c`) |
    | `1ba` | USTART_L after "DP" (`0x50024253`) | USTART_L3 (`0x50024444`) |
    | `1bb` | USTART_L after "FB", the file system's init (`0x500242c1`) | USTART_L3 (`0x500244c8`), USTART3 before FILECLBK's start (`0x501e9c3f`) |
    | `1bc` | USTART_L after "FD" (`0x50024291`) | USTART3 before the FACE tasks' starts (`0x501e9670`) |
    | `1bd` | `0x50003f99` (mark "C1E"), called by the resource read's block loader `0x5003cab3` (from `0x501a98af`) | USTART_L3 (`0x50024508`) |
    | `1be` | USTART_L3 after "DL", `0x50156352(1)` (`0x500244b5`) | USTART_L (`0x50024259`), USTART2 (`0x501e9202`), USTART3 (`0x501e9c8e`) |
    | `1bf` | USTART_L3 after "DS", `0x50156352(2)` (`0x500244f5`) | USTART_L (`0x500242dd`), USTART3 (`0x501e9ca3`) |
    | `1c0` | USTART_L3 after "DM", `0x50156352(4)` (`0x50024535`) | USTART_L (`0x50024323`), USTART4 (`0x501e9e2c`) |

    `0x50156352(bit)` ORs the bit into `0xa32db174` and calls `0x50167b5e`; it lies among the camera driver's
    functions (CAM_MAIN's entry is `0x501562a3`), and what each step loads is not read (?). The block loader's one
    caller is the resource read's helper `0x501a986a`, for a read mode other than 1 (`0x501a9891`; mode 1 is the plain
    flash read the resource loader's own reads take, X below). Which reads pass that mode is not read; USTART_L's
    "LC0" (`res_read(11, 0)` at `0x5002430f`), its first `res_read`, comes right before its wait for `1c0` (I: that
    read sets `1bd`). So USTART4's two bytes (4.8.11) mark the end of the overlay loader (`1b6`) and the last of
    USTART_L3's steps (`1c0`), which waits for USTART_L's file init and for `1bd`.
  - *Magics and done bytes* of the other cores (4.6.1): the four init tasks' done bytes `0x97f00094..97`
    (`0x5003b4e8`), which BOOT_CPU0 polls without a sleep (`0x5002cd70..0x5002cd79`); the tick magic `0x97f00088` and
    the watchdog magic `0x97f006fc` (stage 0, `0x50024042`), which CPUs 1..3 wait for; CPU 3's magic `0x97f00090`
    after its boot jobs (`0x50009450`), which stage 1 waits for at `0x500249d1`, the one wait with a timeout (1000
    polls of 1 ms, then `0x50053ebe(0)`, `0x5000275e(1)` and a branch to itself, `0x5003b632..0x5003b643`); and the
    idle magics `0xa3193680 / 84 / 88` of CPUs 1..3, which USTART2 waits for (`0x501e8ed6`).
  - *The fast start's levels.* USR_FAST_APP is a sequencer beside the start tasks. By its logs it runs the lens
    set-up, the through image's start, a second stage and a hand-over to the HighLevel ("Flg-LensSetupStart",
    "Flg-ThroughStart", "Flg-2ndStart", "Flg-2ndChk", "Flg-2ndEnd", "Flg-TakeFunc", "Flg-RhpTake", "Flg-EcecEnd",
    "Exch-DispDevice"; the hand-over's call `0x50ab22cb` logs "rhp_take_over : bootState %d"; what "Rhp" stands for is
    ?). It first waits for the camera-on word `0xa32dddcc`, which stage 0's `0x50023db7` clears and its power callback
    `0x50023e71` sets to 1 (mark "FPE"; 99, "camNoon", where the start factor forbids the start). Then it waits on
    flag `0x82` (the id word `0x60043074`) for the pattern `0x1ff` (`0x501e67a5`) and serves the bits: 1 set by stage
    1 ("FSS", `0x50024d2f`), 2 by USTART2 ("FTS", `0x501e9054`), 8 by USTART3 ("F2C", `0x501e9cdb`), 128 by the
    callback USTART4 registers with the HighLevel ("FastEndCb" `0x501e8a5f`, its set at `0x501e8a74`), 32 by itself
    (`0x501e6890`); who sets 4, 16, 64 and 256 is not read (?). Its state word `0xa32dddbc` (cleared by stage 0,
    `0x50023d89`; 5, 11, 12 and 13 stored at `0x501e687a`, `0x501e68cc`, `0x501e6959`, `0x501e69d1`, others in its
    handlers) is waited for by `0x501e6a34(n)`: 13 by USTART_L (`0x50024370`) and by that callback (`0x501e8a7b`), 4
    by USTART4's take-over (`0x501e6af2`). The permit word `0xa32dddc0` is the start tasks' answer: SetPermit
    `0x501e6a7f(n)` with 1 in USTART2 ("FPE", `0x501e90ab`), 2 in USTART2 after byte `1be` ("FPT", `0x501e9226`), 4
    in USTART3 after `1be` and `1bf` ("FP2", `0x501e9cc7`) and 5 in USTART4 after `1b6` and `1c0` (`0x501e9e43`). The
    sequencer waits for levels of it (`0x501e6a55`: 5 before the hand-over, `0x501e6952`; 1, 4, 4, 2, 3 and 4 in
    handlers not read). So `0x501e6a7f(5)`, which 4.8.11 left unread, lets the fast start hand over once the overlay
    loader and USTART_L3 are done.
- **The steps in order, against the lab.** "W" marks a wait; a start names the task and its site. The right column
  names the lab's step that does the same work, or says that nothing does. The lab's own order is in the next bullet.

  | Mark | BOOT_CPU0: its init, stage 0, stage 1 | In the lab |
  |---|---|---|
  | OIE..SCE | tick init `0x5003121c`; tick magic; starts CPUCONN_CPU0, CPUCALL_CPU0, CONTEST_CPU0 (act_tsk) | H-BOOTTIME; H-CPU2RELEASE and H-CPUCONN0 with `--cpu2 native` |
  | | `0x50039e4b`, `0x50039c2c`; IRQ 325 attached (`0x50003ff1`); done byte; W the other cores' done bytes | none |
  | | hardware and software timer inits `0x500642dd`, `0x50058959`; starts USTART_L | H-BOOTTIME |
  | 0_1 | the address-decode monitor's init `0x50031892` (below) | none |
  | 0_3..0_l | `0x50038e7a`, `0x50025003`, `0x50047287`, five calls from `0x5005f404` to `0x5005373b`, `0x5004d3c3`, `0x5005d52c`, `0x50031f02`, the queue bind table `0x5002bfb9` ("QIS"), `0x5002e30d` | none in a default session (4.8.11: the bind table) |
  | 0_p | `0x5003ccdd`; starts SYS_WDT on each core; watchdog magic | none |
  | 1_b | starts PER_SCPU (`0x50024079`); `0x50055e10`, `0x500540fc` | H-SCPUSTART, at the store init |
  | 0_y, 0_A | `0x50059649`; the power manager's init `0x50044eb6`; starts PWR_MAIN (`0x500240d2`); `0x50044fe0` | H-PWRSTART, after UI_IN's port scan |
  | 0_F | the fast start's reset `0x50023d89` and power start `0x50023db7`; `0x50053dd9`; starts PER_IN | none |
  | 1_1 | W phase 1 | S-BOOTSTAGE |
  | 1_2 | the deferred task's init `0x5005304d` | H-DEFER, in H-BOOTTIME |
  | 1_6..1_e | `0x50046660`, `0x50044c83`; starts DBG_OUT, S_SHELL, U_SHELL; `0x5012b767`; UI_IN's `0x5014b714`; `0x50059680`; starts FLASH_PRM_EXEC_ASYNC | none |
  | | W CPU 3's magic (its boot jobs: the registry bootstrap `0x50040aeb` among them); `0x50003cf9` | the registry bootstrap at the store init |
  | DIS, DIE | the flash access guard's check; the display task's init `0x501c2f13`; `0x50108fe0`, `0x5010fc72` | the display task init, in the display start |
  | 1_f | `0x50050db0` (I: the eye sensor's) | none |
  | 1_h | cam.c's first init `0x502a49ec` | H-CAMINIT (`--take probe`) |
  | 1_i, 1_j | the lens module's init `0x502a5d10`; starts LENS_MAIN, LENS_ASKDATA | H-LENSINIT |
  | 1_o, 1_k | `0x5012abfa`; starts SC_TTIMER; `0x5013e4bd`; starts BC_MAIN, BC_INDICATOR | none (S-MODACK answers BC_EXEC) |
  | 1_l | UI_IN's module init `0x5014bf91` (the ring init, the port scan `0x5005d36a`) and start stage `0x5014bfc6`; starts UI_IN (`0x50024b92`) | H-UIINRING, H-UIINSCAN, H-UIINPORT, H-UIIN |
  | 1_B, 1_C | `0x5004e53f`; `0x500649d8` (the pin block `0x9b880000`) | none |
  | 1_D | TAKE_FUNC's init `0x502ccff8`; starts TAKE_FUNC, TAKE_FUNC_CP | H-TAKEINIT (`--take probe`) |
  | 1_E | starts USR_FAST_APP | none |
  | 1_G | the touch init `0x501e3dca`; starts TOUCHPANEL, DISPLAY, DISPLAY_CHANGE | H-TPINIT; S-DISPQ runs DISPLAY's loop; K-CHANGE |
  | 1_H..1_J | `0x501c2238`; `0x5014110d`; flag bit 1 ("FSS"); `0x50044ed7` | none |
  | 1_K | W byte `1b7`; `0x50040d78` | none |
  | 1_L | cam.c's second init `0x50155357` | H-CAMINIT2 (the probe's cam_fe) |
  | 1_M | starts USTART2 | |

  | Mark | USTART_L (`0x5002417a`) | In the lab |
  |---|---|---|
  | L_0, L_2 | W bytes `1ad`, `1b7`; `chg_pri(54)` | |
  | RES | the resource loader `0x501a8ca0` | H-RESINIT with S-RESNAND |
  | FLS | W the lens module's init (its last store sets `0x6296c28e`, `0x502a5dd6`); the lens data cache load `0x502a6371`; `0x502a5dff` | H-LENSINIT, in this order |
  | DPS | W phase 2; `0x5042615c`; byte `1ba`; W byte `1be` | none |
  | FDS | `0x505171ae`; byte `1bc` | none |
  | FBS | W phase 4; the file system's init `0x5088fc8d`; byte `1bb`; `chg_pri` back | H-FILEINIT |
  | L_b, LC0 | W byte `1bf`; `0x5003ca96`; `res_read(11, 0)` | none |
  | LC1 | W byte `1c0`; sound 0 loaded to `0xa4000000` (`0x50024353`) | H-RESINIT, right after the loader |
  | L_c | W phase 8; W the fast start's state 13 | none |
  | LC2 | `res_read(11, 37)`; `0x5003cc38`; starts SYS_CA53_PWR_MNG (CPU 1); W byte `1b6`; `0x50553e51(0)` | none |

  | Mark | USTART2 (`0x501e8e84`) | In the lab |
  |---|---|---|
  | 2_1 | W phase 2; its stage word `0xa32d6d58` = 1 (`0x5012abef`) | H-TAKEINIT sets the word |
  | 2_5 | IMG_PRECON's module init `0x502a49b3` | H-EXPINIT (`--take probe --cpu2 native`) |
  | 2_6 | W the idle magics of CPUs 1..3 | none |
  | 2_7, 2_8 | `0x501ea93d`; `0x5038f7e0`; starts ZOOM | none |
  | 2_9 | UI_OUT's init `0x5014f4e9`; starts UI_OUT | H-UIOUTSTART |
  | 2_b | the motion engine's init `0x501a6827` (IRQ 276, EMS1) | none (S-EMS1 is the register file) |
  | 2_d, 2_e | `0x506e41fe`; TAKE_MAIN's module init `0x50399619`; starts TAKE_MOV | H-TAKEMAIN (`--take probe`) |
  | 2_g, 2_h | starts STB_HANDLER_PROC, STB_CHARGE, STB_EXTERNAL; `0x501c169d`; starts STB_SEQ | H-STBINIT (`--take probe`) |
  | FTS | flag bit 2; the event broker's init through `0x502a48a0` (`0x501e9059`) | S-CAMAPP's broker init |
  | | the settings init chain `0x503dae30` (its fifth is the property store's `0x503ee2d6`); `0x502d03a7` | H-STOREINIT |
  | 2_l | `0x501eac35` (the settings-DB init `0x503c5473`); TAKE_FOCUS's interface init `0x506ea9d7` | the store init; H-TAKEFOCUS |
  | FPE | SetPermit(1) | none |
  | 2_p | TAKE_EXPOSE's init `0x50591220`; EXP's init `0x50553649`; starts TAKE_EXPOSE, EXP_MOVIE, EXP_MOVIE2, 3 | H-TAKENBINIT, H-EXPINIT; H-AEINIT runs one table init of EXP's |
  | 2_q, 2_s | WB_MOV's init `0x5046aa2b`; starts WB_MOV; starts DSP0, 1, 2 (CPU 1) | H-CPU2TASKS (`--cpu2 native`) |
  | 2_t, 2_u | the image library's init `0x5046d7ab`; `0x50534a20`; MVR's init `0x5045fed3` | H-IMGPROINIT / H-RECIMGPRO in part; H-CPU2TASKS |
  | 2_r, FPT | W byte `1be`; SetPermit(2); starts MVR_MAIN and ten more MVR tasks (CPU 2), TAKE_POWER_MANAGER | H-CPU2TASKS (MVR_MAIN); H-TAKENBINIT |
  | 2_w | starts USTART3 | |

  | Mark | USTART3 (`0x501e94a5`) | In the lab |
  |---|---|---|
  | 3_2, 3_3 | W phases 3 and 4 | |
  | 3_4 | `0x501553fa`; starts AUD_MAIN (`0x501e950b`); `0x5055368d` | H-AUDSTART |
  | 3_5 | the AF library's init `0x508bede6`; `0x508c0e38`; TAKE_FOCUS's module init `0x509a0e37` | H-FCSAF in part; H-TAKEFOCUS |
  | 3_6 | starts FCS_MOVIE and eight more FCS tasks (CPUs 0, 1, 3), TAKE_FOCUS | H-TAKEFOCUS starts TAKE_FOCUS |
  | 3_7 | W byte `1bc`; starts FACE_FD; `0x50510afd`; starts FACE_MAIN; `0x50512a3c`; starts FACE_BEAUTY | none |
  | 3_8 | starts SDET (CPU 2) | H-CPU2TASKS |
  | 3_a | the DML driver's init `0x507f906b`; `0x507f9c18`, `0x507fbdd9`, `0x508042df`; starts seven MDET tasks; `0x50804377` | H-MDETINIT, S-MDETDL |
  | 3_b | REC's init `0x50539665`; starts REC_PREPRO, REC_IMAGE (`0x501e984a`), REC_FILE (`0x501e9880`), REC_MAIN and seven more | H-RECINIT, H-RECIMAGE, H-RECFILE |
  | PC3, PC4 | `0x50044f7d`; W bytes `1b8`, `1b9`; the versions' log | none |
  | 3_c, 3_d, 3_e | the EXIF module's init `0x504298bd`; disp_sync's init `0x507f2fe0`; `0x509b2281`; starts SERV_MAIN | H-EXIFINIT; the disp_sync init, in the display start |
  | 3_f..3_j | `0x50863cb5`; starts four ISEQ tasks, PER_CCD_TEMP_MAIN, LENS_COMMAND, LENS_FLASH (after `0x50120cc4`), TAKE_MAIN, TAKE_MAIN_CP, TAKE_PROXY | the native lens starts LENS_COMMAND; H-TAKEMAIN |
  | 3_l..3_n | the ACC init `0x50048cad`; `0x5004bc72`; PER_SLOPE's init `0x5005fb31`; PER_ROTATE's `0x5005a08c` | H-ACCINIT, H-SLOPEINIT, H-ROTINIT |
  | 3_o | W byte `1bb`; starts FILECLBK (`0x501e9c5b`) | H-FILECLBK |
  | 3_p, 3_q | `0x501eaa1b`; W bytes `1be`, `1bf`; SetPermit(4) ("FP2"); flag bit 8 ("F2C") | none |
  | 3_r, 3_u | starts DBG_MESS1; starts USTART4 | |

  | Mark | USTART4 (`0x501e9d54`) | In the lab |
  |---|---|---|
  | 4_2 | W phases 6 and 7 | H-AUDSTART sets 6 |
  | 4_4 | `0x501ea849`, an empty function (`retf`) | |
  | 4_5 | the HighLevel object's create `0x50ab222a` (MainSystem.cpp); starts HIGHLEVEL_MAIN (`0x501e9dca`); its init `0x50ab22bc` | S-CAMAPP |
  | | `0x501e6aa9`: the fast start's two callbacks registered (`0x50ab22f6`, `0x50ab2331`) | none |
  | 4_a | the take-over `0x501e6adb`: W the fast start's state 4, then `0x50ab2309` | S-TAKEOVER writes the module state the take-over leaves |
  | 4_b | starts CA_MAIN (`0x501e9e03`) | S-CAMAPP |
  | FPT | W bytes `1b6`, `1c0`; SetPermit(5) | none |
  | 4_v | starts USTART5 | |

  | Mark | USTART5 (`0x501e9e94`) | In the lab |
  |---|---|---|
  | 5_2..5_4 | W phases 8, 9, 10; `0x518f724a`; `0x50155412` | S-STAGE9 sets 9 (camapp 3) |
  | 5_5 | starts PLAY_MAIN, PLAY_LOAD, PLAY_IMAGE, PLAY_SOUND, PLAY_DECODE, PLAY_LOADDRAW | H-PLAYSTART (the opt-in of 4.8.11) |
  | 5_6..5_8 | `0x51031b76`; starts EFFECT_EXE; `0x51030b0d`; starts EFFECT; `0x51017051`; starts IMG_PRECON | none |
  | 5_9 | starts OSD_DRAW_CPU2; `0x5100d04a`; starts DISP_FRAME (CPU 3) | H-CPU2TASKS; S-DISPFRAME |
  | 5_a..5_r | 45 more starts with their inits: TPC, BAS, C3D, MVR_ENC, MOVP, MOVE, the AV middleware (`0x50527bcf`), SAICAS, DPS, PTP, PC, FIRMUP, ADJ, the WIFI tasks | none |

- **Where the lab's order differs (D for the camera's, X for the lab's).** The lab's bring-up is not the chain run in
  order: each step was placed where a session first needed it.
  - *Fixed: the event broker's init.* The lab ran it after the HighLevel create and init (S-CAMAPP's order since its
    probe, shutter spec section 7 item 7). On the camera USTART2 runs it (`0x501e9059`) and USTART4 the HighLevel
    steps (`0x501e9dbc`, `0x501e9dd1`), with all of USTART3 between: the broker's tables are cleared, UI_IN's forward
    gate and the publish gate (`0xa31f1d26` = 119) are open before the HighLevel object exists. The lab now runs the
    broker init first (`emu/src/lab/camapp.mjs` start). The same order holds on the 18 ported bodies: each image holds
    one call of the broker init's wrapper after a boot mark of start function 2 or 3 ("FTS" on E146 and E147, "2_h" on
    the E144 family, "3_1" on the E118 family) and the create and init calls, 21 bytes apart, after a mark of start
    function 4 ("4_5", "4_4", "4_7") at a higher address (D: a scan of each image for the three call sites and the
    mark loaded before each; that their start functions chain as E143's is I).
    What the order changes: after the bring-up of a default E143 session the two orders' DRAM differs in one byte,
    `0xa31f1d27` (X). The broker init clears it (`0x502a494c`); the HighLevel init's `0x50ab2d1c`
    (OlyHfwHighLevelService.cpp) sets it to 1 through the broker's setter `0x503eb246(1)` (`0x50ab2d5b`). So the lab's
    old order left it 0, and the camera's order leaves it 1 (D). The publish `0x50025095` tests it (`0x503eb0c5`,
    called at `0x500250d1`): with it set, the event `0x02022301` is dropped unless `0x50424f9a` returns non-zero for
    each of `0x02021706`, `0x0202170a` and `0x0202170e`, and every other code passes two instructions later than with
    it clear (D; what the event and the three values are is ?). That is the whole difference in the default sessions
    (X, the traces of both orders compared item by item): golden's devices layer differs in 23 sessions only in the
    instruction counts the interrupt rows and the IPI records carry, 2 or 6 higher (I: two instructions per publish
    since the machine's counter last restarted), check_perf's P10b runs 14 instructions more (185,434,420) with the
    same frames, lab time and hook log, and the screens, the outputs and the final registers are the same. An earlier
    comparison of frames, lab times, hook-log lengths, error-log counts and heap top under camapp 1, 2 and 3 (a start,
    1.5 s, a shot, the menu, playback) found no difference either. Under camapp 1 and camapp 3 the flag is 1 after the
    bring-up, and over S1, S2, MENU, playback, INFO, OK, the arrows and REC 21 event codes reach `0x503eb0c5`, none of
    them `0x02022301` (X). The broker init still follows the lab's store init (H-STOREINIT, the settings-DB init),
    which USTART2 runs right after it (`0x501e9060`, `2_l`): not changed; whether either touches the other's state is
    not read (?).
  - *The power manager.* Stage 0 runs its init and starts PWR_MAIN before UI_IN's module init runs the port scan
    (stage 1, `1_l`); the lab starts it after the scan (H-PWRSTART's text says so). So the lab's sub-CPU sees `0x88`
    before `0x82 {45}` and `0x12 {5}`, the camera's the other way round. Not changed: the swap is two lines of
    `play_bring_up`, but it reorders the link's frames in every session of E143, E146 and E147.
  - *PER_SCPU and the registry bootstrap* run before the display task's init on the camera (stage 0; CPU 3's boot
    job, whose magic stage 1 waits for before "DIS"). The lab runs both in the store init: after the display's
    open, or between its init and its open for an EVF start (H-STOREFIRST). The settings-DB init is USTART2's on the
    camera, after the display task's init, as in the lab.
  - *The display.* DISPLAY_CHANGE starts after the display task's init on the camera (`0x50024a6c`, then
    `0x50024ce6`); the lab starts it before (K-CHANGE, checked waiting). disp_sync's init is USTART3's (`3_d`); the
    lab runs it right after the display task's init. The touch init is before the DISPLAY task's start on the camera
    and after the lab's open (H-TPINIT's text has the reason it stays).
  - *The resource loader and the file system.* USTART_L runs the loader, the lens data cache load and then the file
    system's init; sound 0 is loaded last. The lab runs the file system's bring-up first (S-RESNAND and S-LENSNAND
    are layered over S-FSNAND), then the loader with sound 0 at once, then the lens steps.
  - *REC and EXIF.* USTART3 starts REC_IMAGE before REC_FILE and runs the EXIF module's init after both; the lab runs
    H-EXIFINIT first and starts REC_FILE before REC_IMAGE, all before the first picture. Each task waits on its own
    queue after its start.
  - *The accelerometer, UI_OUT and the AE table.* The lab runs H-AEINIT, then H-ACCINIT, then H-UIOUTSTART; the
    camera UI_OUT's init (`2_9`), EXP's init (`2_p`), then the ACC init (`3_l`).
  - *AUD_MAIN* starts at the head of USTART3 on the camera, before the FCS, REC and ACC steps; the lab starts it
    last in the bring-up. *The take-over* is USTART4's, between the HighLevel init and CA_MAIN's start; the lab writes
    the module state before the application starts (S-TAKEOVER). *HIGHLEVEL_MAIN* starts between the create and the
    init on the camera: so under camapp 3; under camapp 2 the lab starts it after both.
- **The probe (X).** `node emu/bin/ustart.mjs [TASK ...]` runs each start task in a lab of its own, from the state
  the lab's reset path leaves: segment 2's static constructors, the kernel's own init from its entry to its idle
  loop, the init task ended and the lab task created. The lab is made bare first: the RTOS wrappers' and every other
  stand-in hook a lab is built with are taken out and the lab stub's pages closed, so that anything the machine does
  not model is a bus error. The host's memset and memcpy, the lab's heap behind malloc and free, the error log and the
  UART prints (recorded) stay. Its own steps: H-PROBECTORS runs the constructors of the segments 6 and 7 before the
  task starts, as the lab's display bring-up does. S-NOSTART records each task the start task would start and answers
  E_OK without starting it. S-STARTCOND records a start condition the task waits for and then grants it: the bit,
  byte, word or magic is written as its writer writes it, and the writer's other work is not done. H-PROBETICK gives
  the kernel's tick from the idle point while the task is in a timed wait; no lab time passes. The module lies
  under `bin/`, not `src/lab/`, so that its E143-only addresses are none of the port's literals. The seven records
  take about 1 s together. A known condition that holds while the task sleeps on it for 5000 ticks is the probe's
  misreading and a thrown error, not a record.

  | Task | First stop: the condition nobody sets | Marks reached, conditions granted | The stop that ends the run | What it needs |
  |---|---|---|---|---|
  | BOOT_CPU0 | the done bytes `0x97f00095..97` (the spin at `0x5002cd70`) | OIE..SCE, `0_1`; its four starts recorded; the tick and timer inits run | a bus error: `0x50031a6c` writes `0x1fe` to `0x9a000004` (in `0x50031892`, stage 0's first call) | the address-decode monitor `0x9a000000` |
  | USTART_L | byte `1ad` (`0x5002418a`) | `L_0`, `L_2`, RES; bytes `1ad`, `1b7` | a bus error: `0x50000e32` writes 1 to `0x98d011c0` (the flash driver under the resource loader, the call at `0x500241d8`) | the flash controller's NAND path (the block `0x98d01000`, IRQ 237 attached right before, `0x50000de9`); in sessions S-RESNAND answers the loader's reads |
  | USR_FAST_APP | the camera-on word `0xa32dddcc` (`0x501e675a`) | MIS | waits in OlyEvWt on flag `0x82`, pattern `0x1ff` (`0x501e67a5`) | the stages' flag bits; this is its event loop |
  | USTART2 | phase 2 (`0x501e8ea5`) | `2_1`..`2_b`; phase 2, the idle magics; ZOOM and UI_OUT recorded; 831 error logs `0x1c005002` from `0x5004098b` (I: lookups in the settings store, whose registry is not built) | a bus error: `0x501a5bd9` writes `0x40` to `0x98800344` (the motion engine's init `0x501a6827`, before EMS1's first register) | the block `0x98800000`'s `+0x344`, a lab-stub page in sessions |
  | USTART3 | phase 3 (`0x501e94d3`) | `3_1`..`3_4`; phases 3, 4; AUD_MAIN recorded | fault 6 at `0x50578db0`: `divu` by 0 in `0x50578d9e` (EXP's `0x5055368d`, called at `0x501e951f`) | EXP's init `0x50553649`, which USTART2 runs first (checked, below) |
  | USTART4 | phase 6 (`0x501e9d80`) | `4_1`..`4_5`; phases 6, 7; four tasks of the HighLevel's own and HIGHLEVEL_MAIN recorded | a timed wait retried for 5000 ticks: the HighLevel init's transaction waits in the receiver for its answer (`0x50af855c`: 1 s waits on a semaphore, "TRA REQ TIMEOUT" logged after five) | the tasks it started (S-NOSTART), the OXF main thread among them; S-CAMAPP's part in sessions |
  | USTART5 | phase 8 (`0x501e9ec2`) | `5_1`..`5_4`; phases 8, 9, 10 | a bus error: `0x50001129` writes 1 to `0x98d011c0` (the flash driver under `0x518f724a`, the call at `0x501e9ef5`) | the flash controller's NAND path, as USTART_L |

  So from the lab's reset state every start task stops at once at a condition of the overlay loader, of another
  loader or of another core, as the map says it must (a default E143 session's bring-up sets the phases 1 and 6 and
  none of the bytes; camapp 3 adds phase 9). With those granted, four of the seven stop at a device the lab has no
  model of (two at the flash controller), one at an init an earlier start task runs, one at tasks the probe does not
  start, and one in its own event loop.
  - *The check of a need (X).* `--before ADDR` calls a function natively before the task starts. With EXP's init
    first (`--before 0x50553649 USRSTART3`) USTART3 does not divide: it goes on through `3_5`..`3_a`, records 15
    starts, has byte `1bc` granted and stops at the DML driver's init (`0x507f906b`, the call at `0x501e9719`), whose
    `0x507f68d3` writes `0x10000000` to `0x98800348`. The table init H-AEINIT runs (`0x50560b29`) does not suffice (X:
    the same divide with it first).
  - *The address-decode monitor.* `0x50031892` attaches IRQs 0..3, one per core, to `0x50031aa1` and IRQ 4 to
    `0x50031bb7`, keeps a table of four register blocks at `0x9a000000 + 0x100 * core` (+0 control, +4, +8 the
    address, +0xc the read data, +0x10 the write data, +0x14 the status) and writes `0x1fe` to each `+4` and bits 2
    and 1 into each `+0`, then the same at `0x9a000400`. The handlers print "[SYS WANA] ADDEC ERROR", the core and
    the four words. So `0x9a000000` is MMIO after all: section 9 item 5's return codes are real, and so is this unit.
  - The records are regression data: `test_ustart.mjs` pins each task's marks, starts, conditions and stop, the
    check above, and every call site of the phase wait, the phase test, SetPermit, the flag's sets and the state
    waits in the image against the tables here, and that a misread condition (a poll pointed at another word) is the
    error above.
- **Corrected by this section.** AUD_MAIN is started by USTART3 (`0x501e950b` lies in `0x501e94a5..0x501e9d54`), not
  USTART2 (4.5, `audiohw.mjs`, H-AUDSTART's text). FILECLBK's start, "not traced" in H-FILECLBK's text, is USTART3's
  at `0x501e9c5b`, after byte `1bb`. REC_IMAGE's start, "not read" in H-RECIMAGE's text, is USTART3's at
  `0x501e984a`, before REC_FILE's at `0x501e9880` ("not read" in H-RECFILE's comment, `rec.mjs`). The code texts
  are left for the owners of those files to update. That the lens data cache load follows the lens module's init
  (H-LENSINIT's I) is the firmware's own wait on `0x6296c28e`. 4.8.11's two bytes and its `0x501e6a7f(5)` are read
  above. The event broker's init runs before the HighLevel steps, not after them (S-CAMAPP's order, fixed above).
- **Open.** What `0x50156352`'s three steps load; who sets the flag's bits 4, 16, 64 and 256; the fast start's
  handlers past its flag wait (`0x501e6d17..0x501e8a5e`) and what its hand-over does; stage 0's unread calls
  (`0_3`..`0_l`); the block `0x98800000` (`+0x344`, `+0x348`: I, the engines' resets or gates, beside the cores'
  release bits of 4.6.2); a model of the flash controller's NAND path (`0x98d011c0`, IRQ 237), which two start tasks
  stop at (the overlay loader stops at the same block's DMA for chip 1, `0x98d00200`, 4.6.2); the order differences
  kept above, each with its cost.

### 4.7 SCPU, power, clock, on-board sensors and persistence

- **Tasks (CPU 0, D):** PER_SCPU 0x7a `0x5005b424` (the request server: reads the data queue PER_SCPU_RECEIVE id 2
  and runs a table-driven state machine, `0x5004fe2e`; its 100 timer is the SCPU start watchdog, 4.7.1), PWR_MAIN 0x0a
  (it reads its queue 10, 4.7.4; not PWR_EXEC 0x7c, target 28, an S-MODACK queue with no waiting receiver in E143's
  default session, 4.3.2, X), PWR_STANDBY 0x9d, PER_IN 0x15, PER_EYE_SENSOR 0x41, PER_SLOPE 0x4e (level gauge),
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
| `0x12`, `0x13`, `0x14` | short writes, batched | the power manager through `0x5004322c` (semaphore PWR_COMM_SCPU 0x68, flag PWR_COMM_SND_SCPU_WAIT 0xee; builders `0x500433f9`, `0x50043452`, `0x500435b0`, `0x50043a47`, `0x50043abd`) | SCPU handlers `0x801570b`, `0x801535f`, `0x8015345` (and `0x80150a5` for `0x11`, which the MN sends too, 4.7.6) in its power manager; formats ? but for `0x12 {5}`, the start's handshake, which the sub-CPU answers with its message `0x12 {5}` (4.7.4); the formats, the two `0x11` builders and what each sender waits for: 4.7.6 (2026-11-11) |
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
    and the reset's error paths (the sub-CPU always answers), every command but the six (eight since 2026-10-29: `0x82` of the scan's ports and `0x12 {5}`, 4.7.4; nine since 2026-11-11: the power manager's `0x14`, 4.7.6), PER_SIO at the register
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
  LOGGER_MAIN's unanswered request fills the application's queue 6 once the clock is set (X, ?; 2026-11-10, 4.3.2: the
  guard then named the queue of the last send through the blocked call's site, I, and the stop no longer reproduces, X).
- **The E118 family's channels (2026-10-30, `docs/model-survey.md` finding 44).** Their blocks
  (`0x98200000`..`0x98600000`, five enabled) are lab-stub pages with one preset each: the transmit level word `+0x1c`
  reads the channel's FIFO depth (16, 64 for channel 4), an idle transmitter, so the driver's polled send, which waits
  for that value, returns (E118's EVF panel commands over channel 2); that the word counts free entries is I, and
  nothing is received.

#### 4.7.6 The sub-CPU's command 0x14 (2026-11-11; D unless tagged, addresses E143's)

4.1.9 and 4.1.10 left a lab stop: under `--take probe --cpu2 native` the MN's power manager sends the sub-CPU
`0x14 {0, 1, 0, 3, 0}` 1.16 s after S1, and S-SCPUDEV refused it. This round reads the sender's chain, the five bytes
on both ends and what the sender waits for, and S-SCPUDEV takes the write (`emu/src/lab/scpudev.mjs`). Pinned by
`emu/test/test_scpu.mjs` scpuUnits (X, 105 of 105, firmware-free), `emu/test/test_take_ready.mjs` secondShotSession
(X, 24 of 24) and `emu/test/test_take_release.mjs` focusSession (X, 13 of 13) and camFeSession (X, 5 of 5).

- **The power manager's record and its names.** The manager keeps a 100-byte record at `0x62963ca4`, id 0 of its
  table `0x60115464` (`{u16 id, +4 size, +8 address}`, 30 ids; `0x50043bae(id, to)` reads one, `0x50043bdb(id, from)`
  writes one under the interrupt lock `0x50053ebe(3)`). Its debug print `0x50044acc` (run when `(0x62963d18)` has
  pattern 1) names the fields: of a message `cmd` (u16 +0), `s_cmd` (+2), `batt_eve` (+3); of the record `pwr_src`
  (u16 +0), `bat_lv` (u16 +2), `bat_emp` (+4), `vb_ad[B]` and `vb_ad[P]` (u16 +18, +20), `pwr_ins` (+22), `bat_prio`
  (+23), `bat_use` (+24), `psrc_bit` (+25), and two 34-byte battery records, "[B BODY]" at +30 and "[B PBH]" at +64,
  each `recommend` (+0), `batt_lev` (u16 +2), `d_percent` (u16 +4). The source check's prints name +6 "PWR LEVER", +7
  "PBH CONNECT", +8 "PBH COVER", +9 "PD ST", +10 "PD VOLT", +12 "PD CURR", +14 "BODY TEMP AD", +16 "PBH TEMP AD". That
  the PBH is the battery holder grip is I.
- **The message handler and the source check.** `0x5004408f(message)`: `cmd` with pattern 1 reads a state id, with 2
  writes one; with `0x30` it copies the record and calls the functions of the table `0x6011563c` (`{u16 mask, +4
  function}`) whose mask meets `cmd`, each with the message and the copy (`0x500440d0`); any other (`0x100`) goes by
  `s_cmd` through the table `0x601156c0` (`0x50044687`). `cmd` `0x10` is the source check:
  - `0x500457da` runs the steps of the table `0x60115870` (`{u8 mask, +4 function}`) whose mask meets `s_cmd`. With
    `s_cmd` 1: the lever (`0x50045928`), the PBH's connection (`0x50045956`, `0x5000297f(8)`) and cover
    (`0x500459b7`), the PD state (`0x500459e8`), the temperature A/D values (`0x50045a54`: `0x50042366(4)` the body's,
    `(5)` the PBH's, `0xffff` for a PBH whose connection byte is not 0), the inserted sources (`0x50045ab5`) and the
    priority (`0x50045b2d`). `s_cmd` 2 adds the mask-2 steps (`0x500458e6`, `0x50045b6b`, `0x50045bc7`: "INIT USE",
    the battery voltages, "USE").
  - The inserted sources: `pwr_ins` is cleared, then bit 0 is set when `0x500467e8(0, the body's temperature value)`
    answers 0 and bit 1 when `0x500467e8(1, the PBH's)` does (each: the value below 3766), and bit 4 when the PD state
    is 1.
  - `0x5004581d` (the judge `0x50045c6a`), `0x50045861`, then `0x50042535`, which compares the copy's `pwr_ins` with
    the published record's: a bit that went clears that slot's battery record (`recommend` 0) and its counter (state
    id `0x8103` for the body, `0x8104` for the PBH, by `0x5004716b`); a bit that came sets the slot's `recommend` to
    3 (`0x500425c5..c7`).
  - Last, mask `0x30`: `0x5004418b` calls the notices of the list `0x6011569c` with the published record and the
    copy: `0x500441c8`, `0x50044218`, `0x5004434c`, `0x50044393`, `0x500444b3`, `0x5004453e`, `0x500445bb` (which
    publishes the copy, `0x50043bdb(0, copy)`) and `0x500445c8` (the module events `0x040a0074`, `0x040a0081`,
    `0x040a0070`, `0x040a0071` through `0x50025095`).
- **The sender and the five bytes.** The notice `0x500444b3` takes, for slot 0 (the body) and slot 1 (the PBH), bit
  `slot` of the copy's `pwr_ins` and the slot's `recommend`. When either slot's `recommend` differs from the published
  record's it builds one record with `0x500435b0` (called at `0x5004452e`) and sends it with `0x5004322c`
  (`0x50044536`). The record is `{0x14, 5, {0, pwr_ins bit 0, pwr_ins bit 1, recommend of the body, recommend of the
  PBH}}`. So `0x14 {0, 1, 0, 3, 0}` says: the body's battery inserted, the PBH's not, the body's `recommend` 3 (set at
  the insertion), the PBH's 0.
- **What the sender waits for.** `0x5004322c(batch, out)` takes a batch `{+0 records, +4 u8 count, +8 wait bits}` of
  12-byte records `{command, size, data}`. It takes the semaphore PWR_COMM_SCPU (`(0x60042f28)`, no timeout) and, per
  record, posts a PER_SCPU request (`0x5005cd17`: the command, s_size, tx = the record + 2, no rx, the completion
  `0x500435fe`) and waits with no timeout for pattern 1 of the flag PWR_COMM_SND_SCPU_WAIT (`(0x6004314c)`), which the
  completion sets. Then `0x5004363f(the first record's command, wait bits, out)`: after `0x11` and after `0x12` it
  waits 5000 for the wait bits on the flag `(0x6004314e)`, which the MN's handlers of the sub-CPU's messages `0x11`
  and `0x12` set (a timeout logs `0x1d00a001`; after `0x11` it copies the 104 bytes of battery information at
  `0x62963c38` to out); after any other command it returns at once. So after `0x14` the sender waits for the write's
  end only, and PER_SCPU calls a write's completion once its frame is sent, with no reply frame (4.7.1).
- **The sub-CPU's end.** The handler `0x8015345` posts its power manager message 11 with the 5 bytes
  (`0x80155cc(11, data, 5)`). The manager's task (`0x801a1ec`; its dispatch `0x801a29c`, a `tbb` over ids 1..32)
  takes it at `0x801a4d2`, which copies the bytes (`0x801a67e`) and, for slot 0 and then slot 1, keeps two bytes in
  the manager's object at `0x2000a7c8 + 10 * slot`:
  - byte 0, the inserted byte: 0 or 1 as sent, `0xff` for any other value; when it changed, `0x801acb0(8)`;
  - byte 1: `0xff` when byte 0 is 0, else 1 for `recommend` 1, 0 for `recommend` 2 and `0xff` for any other.

  It does not read the frame's byte 0. `0x801acb0(8)` acts on the PBH's inserted byte (+10) as it is at the call. When
  `0x801ac9a()` answers 1 (bit 0 of the object's +0x20 or +0x21) and +0x15 is 1 (its copy of !PC5, scpu spec 3.4): for
  1, GIO port 36 high, `0x8013790(200)`, GIO port 24 low and `0x8013ebe(1)`, with a timer started when that answers
  non-zero (`0x801adc8`; its log string names it PBH_IOEXP_RETRY_TIMER); for 0, GIO port 36 low. When `0x801ac9a()`
  does not answer 1 and `0x801ac84()` answers 2 (bit 1 of +0x20 or +0x21): GIO port 36 low, whatever the PBH's byte
  (`0x801ad72` branches past its test `0x801ad68`). Otherwise nothing. None of these paths posts the MN a message
  (no call of `0x80133dc` or of its users `0x801526e`, `0x80152b0`), and a write has no reply frame (scpu spec 3.2).
  What reads a slot's byte 1 is not read (?). I: `0x8013ebe(1)` starts the PBH's IO expander (by the timer's name)
  and GIO ports 36 and 24 switch the grip's supply.
  X (the image on the lab's Cortex-M4, S-SCPUBOARD): after its start the two slots read `ff ff`, +0x14 and +0x15 `01
  01`, +0x20 and +0x21 `00 00`; after the session's `0x14` the slots read `01 ff` and `00 ff`, and the link carries
  nothing more in the 2.5 s the run went on.
- **Why S1 brings it (X where tagged).** The manager's task starts a PER_MINTIMER (`0x50043c75`: id 130, count 1000,
  callback `0x50043e2c`), whose callback sets pattern 1 of the task's flag 11, and the loop then runs `0x50043e6d`
  (`0x50043e13`). That function reads the byte `(0xa32bfb58)` (A), the state id `0x8101` (B: 1 when it is 1..5) and
  the byte `(0xa32bfb59)` (C) and gives the handler a message: `{0x30, 1}` for A 1, B 1, C 1; `{0x20, 1}` for A 1, B
  1, C 0; `{0x10, 1}` for A 1, B 0, C 1; `{0x10, 1}` between `0x5000f9aa(0, 54)` and `0x5000f9aa(0, 55)` for A 0, C
  1; nothing otherwise. So C lets the cyclic source check run, and A with the state `0x8101` the battery check (`cmd`
  `0x20`).
  - The setters are `0x50043c63` (A) and `0x50043c6c` (C). The task's start clears both (`0x50043cfe`, `0x50043d09`).
  - The boot calls three inits. `0x50044eb6` (from `0x500240c4`) sends `{0x100, 0x20}`: the one H-PWRSTART runs
    (4.7.4). `0x50044ed7` (from `0x50024d43`) sends the source check `{0x10, 2}`. `0x50044f7d` (from `0x501e9943`)
    sends `{0x10, 2}` again, posts event 9 to queue 10 and sets A and C. The lab runs neither of the last two (X: at a
    session's open the record is as `{0x100, 0x20}` leaves it, `pwr_ins` 0 and both temperature values `0xffff`, and A
    and C are 0).
  - TAKE_MAIN sets C on its own: RdyFcsRdy1's entry `0x503c2961` clears it (`0x503c29bb`), and `0x503c2d08`, which the
    entry registers with 20 in TAKE_MAIN's 12-slot handler table `0x62a3f050` (`0x5039a5ad`, at `0x503c297e..89`; what
    20 selects is not read), sets it (`0x503c2d2b`). The setters' other callers are not read: C's `0x503b2302`,
    `0x503b2fac`, `0x503b30de` and `0x519d04c6`, A's `0x503bae7c`, `0x503bae88` and `0x519d04a0`, the queue's events 4
    and 5 (C, `0x5004402a` / `0x5004402d`), and for both the sleep return (`0x5004553c`, `0x50045543`) and the
    power-off (`0x50045588`, `0x5004558e`).
  - X (the probe's session): A and C are 0 from the start, so a tick does nothing (one at 3.45 s of lab time sends no
    message). S1 comes at 3.92 s, and TAKE_MAIN (task 107) calls `0x50043c6c(0)` and `0x50043c6c(1)`. The next tick,
    at 5.08 s, finds A 0 and C 1 and runs `{0x10, 1}`, the session's first source check: `pwr_ins` goes 0 to 1, the
    body's `recommend` 0 to 3, `pwr_src` to `0x200`, and the notice sends `0x14 {0, 1, 0, 3, 0}`. The 1.16 s are what
    was left of the timer's period at S1, not a delay S1 starts: the ticks come 1.08 to 1.63 s of lab time apart
    (the count's unit is ?, 4.7.1). Without S1 neither byte is set and no source check runs; a default session
    (camapp 1, no probe) sends no `0x14` through S1, S2 and 3 s more.
  - The inserted battery is the lab's (X): the A/D driver `0x5004d4f4` knows no channel there (its count
    `(0xa32bff14)` is 0; I: its init is not among the lab's bring-ups), so the request for channel 4 fails with 1 and
    `0x50042366` answers 0 without a sample, which is below 3766. The PBH's connection byte reads `0xff`, so its
    value is `0xffff`.
  - I: on the camera the boot's `0x50044ed7` makes the first source check, so the `0x14` for an inserted battery goes
    out at the start, and the one the lab sees after the first S1 is that one, late.
- **The sibling commands.**

  | Command | Bytes and builder | Sent when | What the sender waits for | The sub-CPU's handler |
  |---|---|---|---|---|
  | `0x11` | `{0, slot, kind, 0}` for kinds 0..2 (`0x500436f6`), `{0, slot, kind, 0, 2 bytes}` for kinds 3, 4 (`0x50043736`), by the rows of `0x601152f0` (`{kind, +4 builder, +8 / +12 the answer's takers, +16 / +20 the wait bit of slot 0 / 1}`) through `0x50043308` | the battery check's requests for a pack's information (callers `0x50042705`, `0x50042a18`, `0x50042b41`, `0x500448dd`; their conditions not read) | the sub-CPU's message `0x11` for each slot asked, 5000 (flag `(0x6004314e)`, the rows' bits 1, 2, 4, 8) | `0x80150a5`: takes byte 0 = 0 only and calls `0x8016116(0x10, 1)`; the rest, from `0x80150be`, is not read |
  | `0x12` | `{5}` (`0x500433f9`) | the start's handshake (4.7.4) | the message `0x12 {5}`, 5000 (bit `0x10000`) | `0x801570b` -> its message 12 |
  | `0x12` | `{2, a, b, 0}` (`0x50043a47`, a request of its own with the flag `(0x60043150)`, "ChargeCtrlW") | from `0x5014f07d` (not read) | the write's end | `0x80156f0(a, b)` |
  | `0x12` | `{0, 0, 0, x}`, `{1, ..}`, `{3, ..}` or `{4, ..}` (`0x50043abd`, the same flag) | from `0x50043a21` (callers `0x5040d6ec`, `0x5040d751`, not read) | the write's end | none: `0x801570b` takes the first bytes 2 and 5 only |
  | `0x13` | `{0}` (`0x50043452`) | the notice `0x50044393` -> `0x5004443c`: the PD state 1 and both slots' `d_percent` at most 10 (at most 0 when the product of the PD volt and PD curr values reaches 18,000,000) | the write's end | `0x801535f` -> its message 20 |
  | `0x13` | `{1}` (`0x5004347d`) | the same notice -> `0x500443af`: the PD state 1 and neither battery inserted; the MN then logs `0x1d00b001` and stops (`0x5003cc5c(1)`, a branch to itself) | the write's end | its message 27 |
  | `0x13` | `{2}` (`0x500434a9`) | `{0x100, 3}` (`0x50044a4e`), sent on the queue's event 13 (`0x50043fe9`) | the write's end | its message 28 |
  | `0x14` | `{0, inserted 0, inserted 1, recommend 0, recommend 1}` (`0x500435b0`) | the notice `0x500444b3`: a slot's `recommend` changed | the write's end | `0x8015345` -> its message 11 (above) |

  What the sub-CPU's messages 20, 27 and 28 do is not read (?). `recommend`'s values: 3 is set at an insertion, 0 at a
  removal and at the start; the MN asks for a pack's information while it is 2 (`0x500426d1`), and the sub-CPU tells
  1 and 2 apart. What 1 and 2 mean and who sets them is not read (?).
- **Built (S-SCPUDEV).** `0x14` with 5 data bytes is taken as the write it is: no reply frame, no message, the
  command manager idle after the release. The model keeps the two slots' bytes as `0x801a4d2` keeps them (`sources`;
  `0xff` at the start, X, and after a reset, I) and logs them. Refused, each stopping the session: a `0x14` of another
  size (no sender builds one); a `0x14` that changes a slot's inserted byte while the PBH's is 1 (the grip's bring-up
  depends on the manager's flags +0x15, +0x20 and +0x21, which the model does not keep, and what the MN then sees is
  not known); `0x11`, `0x13` and the `0x12` writes but `{5}`, as before. GIO port 36 is not modelled: nothing here
  reads it. A body's quiet list may not name `0x14`. The handler is read from E143's image, which E146 carries
  byte for byte (scpu spec 2), so the model takes `0x14` on those two (`src/lab/menu.mjs`: the bodies whose
  `scpu_lle` digest is that image's, `SOURCES_IMAGE`) and refuses it on the other linked bodies (E147's own build,
  E139's and E134's lineages), whose handlers are not read; `emu/test/test_scpu.mjs` scpuSession checks which body
  takes it on each of the five (X: E143 23 of 23, E146 and E147 20 of 20, E139 and E134 11 of 11).
- **How far S1 and S2 go now (X).** With the write taken no lab stop follows in 8 s of lab time after S1 or after S2.
  - S1 held: the `0x14` 1.16 s after S1 is the link's only transfer. Every later tick runs the source check, finds
    nothing changed and sends nothing. TAKE_MAIN stays in RdyFcsRdy3 (pending `0x200`, pattern `0x5`) and the sequence
    in phase 103.
  - S1 released: 4.1.10's second part, which ran with the sub-CPU's own firmware only, runs with S-SCPUDEV too: phase
    111, TAKE_EXEC holding command 7, the second S1 and its release in phase 111's default case, MENU setting no GUI
    event.
  - S2 0.72 s after S1 (focusSession): event 824 in phase 103. REC_FILE (task 27) runs and calls the power manager's
    `0x50045477(1)` at `0x50540773` 85 to 135 ms after S2 (two traces whose idles are sliced differently): the
    message `{0x100, 34}`, whose handler `0x500446c3` adds the byte to the u16 counter of the battery in use (id
    `0x8103`, the body's) unless `pwr_src` is `0x401`. A default session's shot does the same (the counter reads 1
    after it). Around S2 the firmware logs the REC warnings 4.8.10 lists (`0x0d090002`, `0x1e01500e`, `0x1e001001`,
    `0x1e01500d` twice). The sequence goes from phase 103 to 106 within 0.1 s of S2. The `0x14` comes about 0.37 s
    after S2. DISPLAY takes cmd 15 and then the GUI's cmd 17 about every 125 ms. TAKE takes nothing and TAKE_MAIN
    stays in RdyFcsRdy3. The releases of S2 and S1 are events 828 and 827 in phase 106, which stays. Phase 106's
    dispatcher is not read (?).
  - With the probe's `cam_fe` opt-in (camFeSession) S2 goes the same way, and S-CAMFE takes no access.
- **Golden (X).** `emu/bin/golden.mjs check`: identical; no default session sends `0x14`.
- **Corrections.** 4.1.9's "Which of the power manager's builders sends it, and why S1 held brings it, is ?" and
  4.1.10's "Which state change comes 1.16 s after S1 is not read" are answered above, and their stop is gone. 4.7.1's
  table and scpu spec 3.3 said `0x11` has no MN sender: it has two builders (the table above). 4.7.1's table named
  `0x500435dc` among the builders: that is the store of `0x14` inside the builder `0x500435b0`. 4.7.4's "bit 2", "bit 4"
  and "bit 1" of the task's flag are the patterns 2, 4 and 1.
- **Open.** (1) The power manager's two later inits, `0x50044ed7` and `0x50044f7d`, at the bring-up: every session
  would then send `0x14` at its start and run the cyclic checks, whose `0x11` requests need the sub-CPU's battery
  task and a pack on its UART (scpu spec 4.2). (2) The A/D driver's init and its channels' values: the lab's failed
  read counts as an inserted battery. (3) Who sets `recommend` to 1 and 2 (the battery check's handlers
  `0x5004261a..0x500428b5`). (4) The sub-CPU's messages 20, 27 and 28, the reader of a slot's byte 1 and its flags
  +0x20 and +0x21. (5) PER_MINTIMER's unit. (6) Phase 106.

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
  components' and the play module's Exif read, which the lab's JPEG (no Exif) would not feed. (The files carry the
  firmware's Exif on E143, E146 and E147 since 2026-11-08, 4.8.10, on eight E144-family bodies and the E118 family
  since 2026-11-10, `docs/model-survey.md` findings 121 and 104; on E143 under camapp 3's play opt-in the play module
  reads it, 4.8.11.)
- **Playback:** with S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW kept, real files need a JPEG decoder at the codec seam (4.3's
  C2 `decode_jpeg`, `play_img.c`): 2-4 weeks on top of storage (on E143 under camapp 3's play opt-in the play
  module's own decode runs on the pipeline block's model since 2026-11-11, 4.8.13).
  A native path needs the HLS play components (310k),
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
  Round 10 (2026-11-11, 4.8.12): the second card slot on E143 and E146: two slots, the second empty by default, each
  slot's card-detect pin as the SD driver reads it, a second card mounted by the firmware from its own port, and S2's
  picture on the card the save settings name. The same round: the play module's view decoded on the pipeline block's
  model under camapp 3's play opt-in (4.8.13); the HLS side on E147, E148 and eight E144-family bodies, REC_FILE's
  task on E130, E133, E129 and the E118 family, and Delete's eraseCurrent natively (`docs/model-survey.md` findings
  131 to 154).

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
  (The second slot: 4.8.12, 2026-11-11.)

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
  Settings" row enabled where it was grey (?; answered in 4.3.7, D: the format sets both slots' media flags 15261 and
  15262, S-CARD giving the empty second slot a mount state too, a lab input, and both flags make the row available).
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
  (The second slot is modelled since 2026-11-11, 4.8.12: its mount state 8 at the start is what the media manager
  leaves for an empty slot, X, and its switch `0x1518` and card-detect pin follow its card.)

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
  control row without a UI_IN code (`play.mjs` card_input); neither is read (the second, I, is the card input's
  lookup fixed in `docs/model-survey.md` finding 126; E147 not tried again). E144's HLS function component is
  another build (no `CmpCst_Function.cpp`; getMediaCtrlCBC and getMediaProgress do not pair): not attempted. (Finding
  127: the E144 family's application holds the E118 family's media control process, X; its Format is not tried.)
  Since 2026-11-11 (`docs/model-survey.md` findings 149 to 154): both of E147's stops are read. Its Yes was never
  pressed: the OM-3 has one slot and opens Card Formatting without the card choice (the row's handler `0x51183dc6`,
  D; X), so E143's keys took the dialog's No; the card input's stop was the lookup (X: the row of `0x2007`, which
  E147's UI_IN tables lack, comes before the card switch's). Its HLS side runs at E143's seams by E146's comparison
  (ids 1509, 1511 and 1512, the reply queue's halfword `0x60043180`; X: 21 of 21 checks). E148's does too: of the
  E144 family it alone has the function component format the card (ids 1512, 1514 and 1515, 698 and 712; 21 of 21).
  E144, E139, E134, E137, E142, E140, E125 and E130 format the card in their application's media control process as
  the E118 family does, at the seams `src/fw/facts.mjs` mediaHls reads in their forms (a static reception, four media
  kinds, another start, the card switch by the SD driver's asks), with S-MDAEND for the camera base's part and
  S-MEDIA for the card out and in (X: `test/test_storage.mjs --hls`, 21 of 21 on each). The tests walk the menu to
  Format by what the firmware draws (`src/lab/menuwalk.mjs`), not by key counts. The sentence above on E144's
  function component is wrong in one point: E144 holds `CmpCst_Function.cpp` (at `0x60c543f5`, 109 loads, X); it is
  its media control that the component lacks.
- **E134's card (goal d; `docs/model-survey.md` finding 23):** the queue FILECLBK blocked on is UI_OUT's, the module of
  the camera's lamps, not UI_IN's: E134's file layer asks it for the card's access lamp around its accesses, and
  nothing ran UI_OUT. H-UIOUTSTART runs its init and starts its task at the play bring-up (MODELS `ui_out`); the
  card is native on E134 since (X: modelcheck with the 8 GiB card, 826 shots, and with a 64 GiB card, exFAT, 6,618
  shots; `test_storage.mjs --session`, 22 of 22, in `bin/test.mjs`). Its movie time is 0, as on the E144 family
  (4.8.5; X: mode 1 at 60, the logs `0x3a040001` and `0x39000105`).
- **Open:** the HLS side on E147 (the two failures above) and on the E144 family (its own function component; the
  media control process, finding 127), both done on 2026-11-11 but for what `docs/model-survey.md` finding 154
  lists (the second slot, the other commands, E133, E145, E129 and E132, an SDXC card there); a
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
  picture is S-RECFILE's JPEG without Exif (with the firmware's Exif since 2026-11-10, `docs/model-survey.md`
  findings 102 to 104, and recorded by REC_FILE's own task since 2026-11-11, findings 143 to 148). S-PLAYSEQ now
  answers request 3 from the picture's own record: the
  camera's clock at the capture (its read, since 2026-11-02 E143's `0x5005a59e` at its place, the RTC driver's get
  `0x50068dbc` that api_sctime_GET_REAL_TIME calls; before, the API by its name, fact `clock.real_time`, retired),
  the JPEG's size, the release's exposure and
  S-LENS's focal length, in the layout the build's converter reads (fact `play.still`); and the histogram request 7
  empty. INFO on E122 shows `2016.01.01 00:00` (its unset clock's default; E118's and E120's `2015.01.01`),
  `1620x1080` (the lab's frame), `125` and `25mm` (X).
- **Not done:** the HLS side (S-MDACTRL, S-MEDIA) is E143's and E146's only; the picture's Exif (the lab's JPEG has
  none) and the play module's own load of it. (Since 2026-11-10 the family's HLS side runs, S-MDAEND and S-MEDIA,
  findings 124 to 129, and its file carries the firmware's Exif, findings 102 to 104; the load still does not run,
  finding 106.)

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
  recording modules (their builders of the same codes, not read; S-RECFILE writes through fileif there; read since:
  `docs/model-survey.md` findings 118 to 123, 131 to 136 and 143 to 148, E132 and E145 left, finding 136); RAW and
  RAW + JPEG files (types 0 / 3 / 9, the fnode's second file at +60..+72); the second slot (on E143 and E146 since
  2026-11-11, 4.8.12).

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
  Corrected in 4.3.3 (D): a normal JPEG (Mode 4097, the record's +38764 not 22) does not go through REC_EXEC_FILE's
  queue but through REC's packet ring (`0x5054eaf0`), REC_FILE's flag set with pattern 1 through cpu_conn (bind table
  `0xa332ce5c` entry 7); "bit 2" and "bit 0" above are the patterns 2 and 1, the second input the ring.
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
  EXIF set itself does not run (X: it divides by zero in TAKE's state at `0x50398ca5`; since 2026-11-13 it runs on
  E143, E146 and E147 after H-RECPRECON, the divisor being IMG_PRECON's table, 4.3.11), so exposure, aperture, ISO,
  focal length, the lens and the image size stay 0 (ISO 25 on E143 since 4.3.3: rec_bracket_after_trig computes it
  from the record's Sv +38174, which the template leaves 0, X; 4.3.5 corrects 4.3.3's "the packet's Sv"). S-RECIMAGE,
  REC_IMAGE's part: the packet for a single-slot JPEG
  (`Mode` 4097, `Media` 0, `Media2` none, `RecordDevice` 1, `ImgAspect` 1, `FileType` 1, `HandleTarget` 1, I: the lab's
  one shot; the rest 0 as REC_MAIN's clear leaves it), `rec_jpeg_exec` natively on it, REC_IMAGE's post natively, then
  lab time until REC_FILE's handler returns (`0x5053f20d`). S-JPEGENC, the image pipeline's work inside it: the encode
  (rec_jpeg_make_image, an imgpro_mdl pipeline) writes the lab's JPEG (without its JFIF APP0) at `Addr` + 41984 and
  sets `Size` (I). Since 2026-11-10 (4.3.3) REC_IMAGE's own task runs this on E143 (S-RECREQ in S-RECIMAGE's place)
  and the header clear's fill runs natively on the imgpro unit, so S-JPEGENC keeps the encode only there; on E146 and
  E147 it still does the fill too (a kind-14 request whose wait cannot end in S-RECIMAGE's lab call, 4.3.1). Since
  the same day REC_IMAGE's task runs it on E146 and E147 too (4.3.5), S-RECIMAGE retired. Since 2026-11-11 S-JPEGENC
  keeps the parameter set's call skipped, the run and Jpeg_Result on the three, the rest of the encode native (4.3.9).
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
  completion with a requester (api_rec); REC_MAIN's task and the image pipeline (REC_IMAGE's task runs natively on
  E143 since 2026-11-10, 4.3.3, X); the E144
  family's E145 and E132 (E130, E133 and E129 natively since 2026-11-11, `docs/model-survey.md` findings 131 to 136;
  the eight others since 2026-11-10, below). E146
  and E147 since the same day (below).
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
  (Read and modelled 2026-11-11, 4.8.12, which also corrects the contexts above: they are drive 0's and drive 1's,
  picked by `Media`'s value, not `Media`'s and `Media2`'s.)
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
  crop-area pick and file-context pick are not found (not read further). Read and run since 2026-11-10 (below).
- **The E144 family natively (2026-11-10; D on E144 unless tagged; `docs/model-survey.md` findings 118 to 123).**
  REC_FILE runs natively on E144, E148, E139, E134, E137, E142, E140 and E125 (`src/fw/models.mjs` rec_native) at the
  addresses and layouts a second rule reads (`src/fw/facts.mjs` recFileQueue, fact `rec_file` in recFile's shape and
  the clock read; `test/test_facts.mjs` pins the eight):
  - *The version:* REC_FILE (E144 task 31, `0x503f5dc0`) waits on its queue alone (`0x60041864`; no event flag, no
    bind), takes REC's 300-byte packet, whose dump names every field in it (Addr and Size too: no image record), and
    runs rec_file_start_process, the destination record (rec_make_file, rec_file_record through a file context of
    E143's layout and the recorder's own builders), rec_file_finish_process; REC_IMAGE's rec_make_image_finish posts a
    still's packet to that queue itself (`0x503f8da9`), so S-RECIMAGE's post is the camera's route. rec_jpeg_exec
    clears no header area through the image engine (S-JPEGENC stands in for the encode alone) and the EXIF init
    flushes no cache; the header maker divides by the shot's crop area (+31550 on E144), which S-EXIFPRM sets to the
    full frame. The camera's clock setting and read are read by their own form (the one `mov 10499,d0; movhu
    d0,(8,a2); ret` of each image and the function after it), as the 100-byte recorder is on E144 and E148 alone.
  - *What runs (X, `test/test_storage.mjs --session` per body; refs/exif.mjs and exiftool):* S2 gives
    `PB080001.JPG` in `100OMSYS` (E144, E148) or `100OLYMP` (the six others), 62,857 bytes (41,984 of the
    firmware's header, then the lab's stream), with the body's Make (`OM Digital Solutions` on E144 and E148,
    `OLYMPUS CORPORATION` on the others), Model (`OM-5`, `OM-5MarkII`, `E-M1MarkIII`, `E-M1X`, `E-M5MarkIII`, `E-P7`,
    `E-M10MarkIV`, `E-M1MarkII`), Exif version (0231; 0300 on E148, 0230 on E125), the clock's dates, maker notes
    (`OM SYSTEM`; `OLYMPUS` on the six), XMP on E144 and E148 only and IFD1's thumbnail of length 0; the firmware's
    image count 1 and its fnode 1 the file in the same session (S-CARD's count retired there), file 2 next at the
    next session's mount; E143's REC warnings around S2 (E144, E139). test_playinfo passes on the eight.
  - *Open:* E145 and E132 (no rec_native: S-RECFILE through fileif; `docs/model-survey.md` finding 136). E130, E133
    and E129, whose REC is the version before the family's (a 284-byte packet, REC_FILE's loop inlining its start
    and finish, rec_make_file's context on its stack), run REC_FILE natively since 2026-11-11 by a rule of their own
    (`src/fw/facts.mjs` recFileInline, findings 131 to 135), which also reads the 96-byte recorder's builders on
    them (the rule `recorder` keeps the 100-byte form); REC_IMAGE's own task on the family; the thumbnail and
    shooting values; RAW; the second slot.

#### 4.8.11 The play module's load under camapp 3 (2026-11-10; D unless tagged, addresses E143's)

- **Why.** Under `control camapp 3` PLAY showed ID_ST_NO_PICTURE with pictures on the card: S-MODACK answered
  PLAY_EXEC, the play module did not run, and its header getter (`0x518b629e`) found the picture not loaded (4.3.2,
  stop 2). This round runs the module's tasks behind an opt-in under camapp 3 (the Player's `camapp_play_native`,
  `emu/src/lab/playmod.mjs`). The default sessions are unchanged (X: golden identical), and so is camapp 3 without it
  (X: traRoutingSession and camapp3FramesSession pass as before; golden runs no camapp 3 session).
- **The start.** USTART4 (`0x501e9d54`) starts CA_MAIN (`0x501e9e03`) and then USTART5 (task 39, `0x501e9e5c`), both
  through OlyTaSt (`0x5002c546`). In between it waits for the bytes `0xa32df1b6` and `0xa32df1c0` to be set (2 ms
  sleeps, `0x501e9e17..0x501e9e3f`) and calls `0x501e6a7f` with 5; what these mark is not read (?; read since: 4.6.3).
  USTART5 waits for the stages 8, 9 and 10 (`0x501e9ec0..0x501e9ef2`), calls `0x518f724a` (a log area at `0x63ae0000`
  checked, the task of the word `0x60042e34` started: not the play module's) and `0x50155412`, and then starts six
  tasks (`0x501e9f17..0x501e9fab`, the tids from the words `0x60042d58`, `0x60042d56`, `0x60042d54`, `0x60042d5a`,
  `0x60042e12`, `0x60042e14`): PLAY_MAIN (25), PLAY_LOAD (24), PLAY_IMAGE (23), PLAY_SOUND (26), PLAY_DECODE (118) and
  PLAY_LOADDRAW (119). The module has no other init in the start functions; each task inits itself (PLAY_MAIN's
  play_init `0x518a5a3c`). Their queues: PLAY_EXEC 63 (PLAY_MAIN), 64 PLAY_IMAGE, 65 PLAY_LOAD, 67 PLAY_SOUND, 194
  PLAY_DECODE, 195 PLAY_LOADDRAW (X: the words `0x60043242..0x6004324a`, `0x60043348`, `0x6004334a`). PLAY_MAIN
  receives a 16-byte message (`0x518bb56d`, OlyQeRd) and passes Load, Image, Sound and Load Draw requests on to their
  task's queue by the message (its logs "PLAY: receive Load request" ..). It replies 12 bytes to the queue in the
  request's word 0 (`0x518a5b61..0x518a5ba6`: the status, the token, a word of the parameter block).
- **The lab (X).** H-PLAYSTART starts the six with act_tsk after CA_MAIN's start; each then waits on its queue.
  PLAY_EXEC leaves S-MODACK. S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW are not installed: the module and the components
  answer. The camera's conditions before the start are not met there: the stage word (`0xa32df1f4`) holds the stages
  1, 6 and 9 only, and the two bytes USTART4 waits for are 0. The lab's image holds every segment's code (as for
  S-STAGE9), and the sessions below run without them; whether a part not followed here needs them is not read (?).
- **What PLAY asks (X).** The play API's Play_Picture reaches PLAY_EXEC as {6, `0xf0080000`, 0, parameter}.
  PLAY_MAIN passes it to PLAY_LOAD (65), a message comes back on PLAY_EXEC (word 2 10000; I: PLAY_LOAD's completion),
  and PLAY_MAIN replies to queue 6. In PLAY_LOAD's task play_load_load_exif_header (`0x518b51e6`) runs. It reads
  the file's first bytes into the handle's header area through play_file_read (`0x518b017f`, the file system
  natively): the fnode's +48, at most 66560 (D). Then play_img_analyze_exif_header (`0x518b1f44`) runs the EXIF
  module's dispatcher `0x504289eb` with the operations 1, 2 and 4 (finding 92). When both return 0 the load sets the
  picture record's u16 +12 to 1, else to 0 (`0x518b53ab..0x518b53b7`, D): the writer 4.3.2 left unread. The header
  getter (in the OXF main thread) then needs the image's size.
- **The getter's size and the JPEG parse.** `0x518b1ff4` runs the EXIF module's JPEG helper `0x50428ee6` with op 1,
  the parse `0x50429055`. It runs over the IFD1 thumbnail (the record's +124 / +132, where its +136 is not `0xffff`),
  then over the header area (66560 bytes from SOI, where the record's +2 is not 2). The getter answers 6152 first where
  the record's +12 is not 1 (`0x518b62cd..0x518b62d4`, 4.3.2's stop). After the parses it answers 6152 where neither
  gives a size (the first u16 of each 0) and a third one is 0 too: the u16 at `0x62ce0800`, copied to the getter's +8
  where `0x62ce0804` is 0 (`0x518b62e5..0x518b630e`, `0x518b638c..0x518b63a3`; what that third size is, ?). It
  answers 6155 where the orientation tag is missing (play_exif_search_tag `0x518aad34` with {1, `0x112`},
  `0x518b63ad..0x518b63d7`).
  The parse walks the markers through a table (`0x60626504`: DQT `0x5042919e`, DHT `0x5042921a`, DRI `0x5042931b`,
  SOF0 `0x5042933b`, SOS `0x50429500`; APPn passed over). Its checks:
  - at least 590 bytes (12418, `0x50429082`), then SOI first (12421);
  - DQT: precision 0, table id 3 or less (12440);
  - DHT: class 0 or 1 (12442), id 0 or 1 (12441), and a code count of 12 for a DC table, 162 for an AC table
    (12428, `0x5042928a`, `0x504292c0`);
  - SOF0: at most 4 components (12444), quantization ids 3 or less (12445);
  - SOS: table selectors 1 or less (12431), Ss 0, Se 63 (12432), Ah / Al 0 (12433), and with three components a
    check on two pairs of their selectors (12437; which pairs is not read).

  The file's thumbnail has 0 bytes (12418, X). The lab's stream had AC tables of one code (EOB): the parse refused
  the second DHT (12428). So the getter answered 6152 and playback showed No Picture (X).
- **A-JPEGDHT-1.** The firmware's own header maker (`0x50428ee6` op 0) writes SOI and a DQT of three tables (`ff db
  00 c5`). Then the DHT segment of 420 bytes from `0x60626338` (`0x50428f7f`): T.81 Annex K.3's four tables, DC 12
  codes and AC 162. Then SOF0 (Y 2x1, Cb and Cr 1x1, quantization tables 0, 1, 2) and SOS, from the templates
  `0x60626334..0x606264ff`. Under the opt-in the lab's stream carries that segment, read from the image, and codes
  with it (`src/lab/jpeg.mjs` `dht`). The file grows from 73,410 to 76,937 bytes and decodes (refs/jpeg.mjs, X). That
  the camera's encoder writes these tables is I: its output is not read.
- **With it (X).** The parse gives the main image's 1620 x 1080 and the getter answers 0. The play capability's state
  (`0x62b0dc8c`) stays 0, and the view is asked for. PLAY_LOADDRAW (119) runs the load again and a second file read;
  the decode's source then holds the file from SOI. PLAY_DECODE (118) takes the request (its command 1, `0x518a8f3f`;
  then `0x518aa055`) and runs play_img_make_view_division (`0x518b44fc`).
- **The decode request (X unless tagged).** play_img_make_view_division builds a 120-byte request (`0x518b452e`). It
  calls the image library's issue `0x5048f331`, then its wait `0x5048f6e4`. The issue's block: {the request, its
  destination, 1, ..., the callback {`0x518b4b0b`, a record}, -1}. The request:
  - +0 the file's address in the play buffer (the whole file, SOI first);
  - +8 u16 the source format: 7171 where the play record's (the second argument's) +24 is 0, 7170 where it is 1,
    neither for another value (`0x518b45b1..0x518b4606`; 7170 for the lab's 4:2:2 picture, whose sampling
    `0x518b1ff4` reads from SOF0);
  - +10 the width rounded up to 16 (1632); +12 / +14 and +16 / +18 the width and height (1620, 1080);
  - +24 / +26 the source's +14 / +16 (the first argument's, whose +0 is the file's address and +18 / +20 the size;
    810, 540); +36 the source plane's bytes (the width to 64, times the height to 8, times 2: 3,594,240);
  - +64 the destination: its address (the through image's bank `0x98d4d800`, the one the menu's fill clears), +72 u16
    the format 3074 (`0x518b4643`), +74 the pitch in pixels rounded up to 64 (5568), +76 / +78 the size (900 x 600;
    INFO's detail view asks 474 x 316 at `0x9a43e000`), +80 / +82 the offsets 0.

  Natively the issue makes it the library's kind 10: the dispatch `0x5046d814` reads 10 at its +16. The handler is
  `0x5046d994`, the library's generic one (the kind table `0x6065a834`, D). Its units' set-up (`0x5048134d`) writes
  the unit at `0x9c200000` first at +0x2d8 (`0x5048d4c0` in `0x5048d48a`). The lab refused that write and the session
  stopped. The issue has two callers, both the play module's: `0x518b446f` in play_img_decode_jpeg_division and
  `0x518b478b` in play_img_make_view_division, the wait two beside them (`0x518b447d`, `0x518b4799`); neither
  function's address is a word in the image (D: a scan of the direct calls and the words). The callback takes the
  phases 21 and 22 (a resource of play_img.c, `0x50536126` / `0x50536273`), 15, and 38 (six halfwords into a
  record's +10506..+10530); what they mean is ?. Which of the library's units decode, their registers and their
  interrupt are not read (?).
- **S-PLAYDEC (the stand-in at that seam).** The issue and the wait return 0 from those call sites, and the request is
  recorded. No pixel is written: the view keeps the bank's content. The callback is not called.
- **What runs (X, `emu/test/test_camapp.mjs` playNativeSession 11 of 11).** Two pictures are taken first.
  - PLAY shows ID_ST_DISP_SIMPLE (`0x0508`): the getter answers 0, the capability's state is 0, one decode is recorded,
    and the component's getNumber (OlyHfwOpePlyCom `0x50acf1a8`) gives index 2, file 2, folder 100.
  - Right gives index 1 (file 1) and left 2 again, each with a decode; PLAY returns to the shooting screen.
  - INFO reaches ID_ST_DISP_DETAIL (`0x050b`). The converter (`0x50acc981`) gets the file's own values: the date from
    DateTimeOriginal (`0000:00:00 00:00:00` with the clock unset: all 0, where still_record gave the build's default
    2022-01-01), 1620 x 1080 from SOF0, the exposure 0/100 and ISO 25 from the Exif (still_record: 1/125 and 0).
  - Control: with the lab's own tables the parse refuses the second DHT (12428), the getter answers 6152, and PLAY
    shows No Picture.
- **The next stop (X).** At INFO's detail view DISPLAY cmd 16 (`0x501c3788` -> `0x501d7377` -> `0x501d7121`) reads
  the VSC histogram's bins on channel 2 (`0x501e150e`, its load at `0x501e153d`). No run has ended since the last
  began, so the model refuses the read (HIST_UNMODELLED; A-VSCHIST-2's scope, 4.2.1).
  Since 4.2.7 the bins are counted and INFO's four histograms are drawn; the detail view's frame is the next stop.
- **Seen on the way: queue 6's bind record in low RAM (X, D).** Each send to queue 6 logs errlog `0x43002002` (OlyEvSt
  -18, E_ID). OlyQeWr finds a queue's bound flag through a table pointer at `0xa3258350` + 4 x the queue id's bits
  12..14, the record 12 x ((id & `0xfff`) - 1) past it (`0x5002c246..0x5002c27b`). Only `0x5002bfb9` sets it (its one
  write `0x5002bfbe`), called from the boot at `0x50023f92` (its one caller), which the lab does not run. So the
  pointer is 0, and queue n's 12-byte record is low RAM 12 x (n - 1); the binds (`0x5002c285`, 38 calls in a scan)
  write there too. At PLAY under camapp 3 the code at `0x509b00f6..0x509b0151` writes a record through a
  null pointer (a watchpoint; I: the AF module's, beside its state getter `0x509b06f6`): 100 lands at `0x42`, queue
  6's flag word. Each later send to queue 6 then sets flag `0x640000` after the message is queued, and fails. The same
  happens without the opt-in, from S-MODACK's replies: 3 errlogs at PLAY, 8 after its return, 15 after a further
  pass; none in camapp 1. Not fixed here: the table's init belongs to the boot every session runs.
- **Open.** The decode's units (kind 10, `0x9c200000`: read and modelled 2026-11-11, 4.8.13, where S-PLAYDEC keeps
  only the requests with a pre-reduction) and the callback's phases; the thumbnail (IFD1 empty); INFO's
  histogram (above); the queue bind table; PLAY_IMAGE's and PLAY_SOUND's parts (not followed); the album / index
  build behind the component's index and right / left (read 2026-11-11, 4.8.13: the album is the short-movie album
  manager's, and the index is the DCF database's). On the other bodies the
  module stays stood in (finding 92's addresses), and the E118 family's files lack the firmware's Exif (finding 93;
  they carry it since findings 102 to 104, and its native load would read it, finding 106).

#### 4.8.12 The second card slot (2026-11-11; D unless tagged, addresses E143's)

The lab has the body's two card slots on E143 and E146 (`src/fw/models.mjs` `card_fs.second_slot`): the second is
empty unless the host gives it a card of its own, and what the firmware does with an empty slot, with two cards and
with the save settings is its own code's (`emu/src/lab/storage.mjs`, `media.mjs`, `camapp.mjs`; every address the lab
uses in `src/fw/facts.mjs` `cardSlots`, fact `card.slots`). Until this round one card answered both SD ports and both
slots read "card present", so `control camapp 3` mounted the first slot's card in the second slot too (4.3.7).

- **How the firmware numbers the slots.** Slot 1 and slot 2 are 0 and 1 everywhere below the menu's texts: the file
  layer's drives 0 and 1 (`C:` and `D:`, `0x508a8149`: the letter less `C`), the SD host's ports 0 and 1 (the
  drive-to-port map `0x508accba` returns 0, 1 and 2 themselves and 3 for drive 8; the hosts `0x99000000` and
  `0x9a300000`, 4.8), a command's port index at its +12 (`0x508ad044`), the media API's slot (`0x503f0bd7(slot)`),
  the HLS media kinds 4 and 8 with their mount state words `0x60360bfc` and `0x60360c08`, the card switches' UI_IN
  codes `0x1506` and `0x1518`, the media flags 15261 and 15262, the save settings' values 0 and 1 (`MODE_MEDIA_SLOT0` /
  `_SLOT1` in the shell's usage texts), the DCF count table's rows of 52 bytes, and REC's `Media` (below). The HLS
  record controller alone counts from 1 (1 slot 1, 2 slot 2, 3 both).
- **The card detect is a pin of the body IO expander.** The SD driver's detect of a port is `0x508b0221(port)`. Its
  helper `0x508b0859` reads the GIO code `0x0200000f` (port 0) or `0x02000010` (port 1) through the GIO read
  `0x5000297f`, stores 0 where the pin reads 0 and 1 otherwise, and always returns 1; so the detect answers that word,
  0 for a card in the slot. Its other path, taken where the helper returns 0 (never on this build), starts from
  `0x1301` and answers 0 where UI_IN's level of `0x1506` / `0x1518` is 0 (`0x508b0240..0x508b025f`): level 0 is a
  card in the slot there too, which makes 4.8.3's reading of the level D. The GIO read maps the code (`0x500029ad`:
  class 2's row of the map table `0x6034db0c` has no board table, the code is the pin) and calls the class's reader
  from the table `0x60118f30`; class 2's (`0x50052e28`) takes the pin's mask from `0x601190c4` (1 << pin) and tests
  it (`0x5005605b`) in the word of the mask's byte in the body IO expander's input shadow, three words at
  `0xa32c5310`. The expander's driver fills the shadow with three one-byte reads of the chip (`0x50056e2e`, from its
  init `0x50055e10`, its refresh `0x50056514` and `0x50056f03`). So the card detects are the expander's pins 15 and
  16 (the shadow's word 1 bit 7 and word 2 bit 0). The expander's init also reads three bytes of the chip (its
  command 217; which register, ?) and stores a UI_IN code for the first bit set among them (`0x50055eed`: pin 15
  `0x1506`, pin 16 `0x1518`, pin 5 `0x0004`, pin 6 `0x000b`, pin 17 `0x2004`), so the pins 15 and 16 are also
  UI_IN's card switches (I, from the matching pins and codes; how the pins reach UI_IN's group 1 image is not read,
  ?). The write-protect read `0x508b01f7` has the detect's form over the pins 21 and 22 (`0x508b0824`; I: the two
  cards' write-protect switches, which read 0 in the lab). Callers of the detect:
  the drive status (below), logsec's init (`0x508ac195`: it marks a port whose detect answers `0x1301`, which this
  build's never does), the sdmem request's card check for a UHS-II card (`0x508b3acf`) and `0x508966a1`,
  `0x508a8498`.
- **An empty slot to the firmware.** The file layer's drive status (`0x508a8327`) returns 1 at once for drive 0 or 1
  whose detect does not answer 0 (`0x508a834f..0x508a8361`); api_media's status (`0x503f0bd7`) copies that bit 0;
  DevMed_MediaControl's state of the slot (`0x50d896f3`, the device's vtable +124) is then 4097, where a present
  card gives `0xf000` (the status's 0x80), 8192 (4), 8193 (8 or 0x20), 12288 (2) or 12289 (0x10). In the lab
  the shadow is never written (the expander's task does not run, S-IOEXP), so both pins read 0: two cards present.
  The drive status of the empty second slot was `0x8600` (camapp 1) and, with S-SDCARD's card answering port 1,
  `0x13780` (camapp 3). 4.3.7's trial of UI_IN's `0x1518` at the no-card level changed nothing because this detect
  does not read it.
- **The media manager's start, per slot** (`0x50bb7bba`, a slot's controller: +172 the slot, +320 its device). It
  first asks whether the device's state is 4097 (`0x50bb7af6`). If so it clears the slot's media flag (15261 + slot,
  `0x50bb7c53..0x50bb7c6e`) and ends the slot's mount process (`0x50bb8092`). 4.3.7 read "no test of the card's
  presence on that path": this is the test, missed there. X, `control camapp 3`, one card: the device's state
  `0xf000` for slot 1 and 4097 for slot 2; 15261 = 1 and 15262 = 0 at 2.756 s; the mount state of kind 4 goes 2, 4, 8
  with the notifications 711 {4, 1, 2}, {4, 1, 4}, {4, 1, 8}, the mount state of kind 8 is set to 8 with no
  notification, and port 1 gets no command. So S-CARD's 8 for the empty second slot's mount state is what the manager
  leaves, not a lab input as 4.3.7 and 4.8.3 said. X, a second card with the firmware's file system: mount state
  of kind 8 = 1, then one request to the file module, FILECLBK `0x31` {0, drive 1} through the API sender (reply
  queue 6): the DCF numbering mount alone, which mounts the volume and reads the card's lists itself (56 commands on
  port 1 for a formatted card with no picture, 66 for one with two pictures in the tests; the drive status
  `0x13780`); 299 ms later 15262 = 1 and the states 2, 4, 8 with 711 {8, 1, 2}, {8, 1, 4},
  {8, 1, 8}; after each slot's end a synchronous request `0x72` to the file module (its block `{0x60038c9a, 1,
  drive}`; what it is, ?). S-CARD's insertion of the first slot sends four requests (`0x51`, `0xf0` 1 and 3, `0x31`,
  4.8.2, I); the manager's own is `0x31` alone (X). X, a blank second card: the same `0x31`; the drive status ends
  `0x8704` (media status `0x704`: its 4 set, its 0x80 not), nothing is written to the card, and the slot update
  sets 15262 = 1 (for the 4): the camera does not format a card by itself, where S-CARD's first-slot insertion does
  (I, 4.8.2).
- **The slot update and the movie Card Slot Settings row.** The update (`0x50bba897`, 4.3.7) sets the flag to 1
  where the slot's device answers mounted (`0x50d8a16a`: the status's 0x1000; and the controller's +168 is 0) or
  the status has 4 or 8, else to 0 unless it has 0x4000. With one card the flags are (1, 0), and the row's
  restriction (4.3.7: available only at (1, 1)) greys it. So a camera with one card in slot 1 shows the row grey (D
  for the logic; X in the lab under camapp 3: its menu is then camapp 1's word for word). This settles 4.3.7's open
  question. With two cards the flags are (1, 1) and the row is available (X: 4,602 pixels in x 38..871, y 283..327,
  the box 4.3.7 pinned).
- **A change at run time (X, `control camapp 3`).** The second card out: the mount state of kind 8 is set to 0 (first
  from the sequence parts, `0x50c93b5a`), 711 {8, 0, 0}, one request FILECLBK `0x35` {drive 1} from the API sender
  (I: the DCF unmount; S-MEDIA's removal sends the DCF process's card out and sdmem's card-info clear instead, I),
  15262 = 0 (DevMed_MediaControl, `0x50d89227`), 711 {8, 0, 8}; the drive status is 1 and the mount state stays 0.
  Back in: 711 {8, 1, 0}, `0x35` again, then the start's sequence (state 1, `0x31` {drive 1}, 1.34 s later 15262 = 1
  and 2, 4, 8). The removal of the card the save slot names stops the session at the sequence parts' read of module
  9's state (`0x50c8a335`, outside S-TAKEOVER's list): the first slot's with the default settings, the second's
  after the save slot is set to it (X; open).
- **Who hands the change to the manager: the sequence's phase (merge fix, 2026-11-12).** The UI_IN change reaches
  the shooting sequence first (event 1083, in each phase's case, which calls the sequence parts' vt +4920,
  `0x50c93ac7`). That handler writes the mount state above (`0x50c93b47` in, `0x50c93b5a` out) and returns 1 where
  both media flags are 0, the phase is not 101, 102 or 103 (`0x50cc60fa` at `0x50c93b82..0x50c93ba7`), one of
  three tests `0x50c8ce8c(0x200000)`, `(0x4000)`, `(0x400)` answers non-zero, or the save slot 1130 is 1; else 0
  (D). On 1 the phase's case passes the switch's code `0x02021518` to its own virtual (phase 102's vt +4984
  `0x50cbfc3a`, phase 106's vt +5024 `0x50cc00d4`, D; what they do with it, ?). X: in the phases 101 and 102 the
  handler returns 0 and the manager then takes the change (`0x50bb89b2` from `0x50bb81f9`) and unmounts or mounts
  as above; in 106, where S-TAKERDY's unanswered take-picture request leaves the sequence after S2 (4.1.12), it
  returns 1, the manager is not called, 15262 stays 1 and an insertion is not mounted. The round's slot2 test made
  the change after S2, which the lab then left in phase 102 (no 794); after take-111's merge the sequence was in 106
  and two checks failed. The test now makes the change before S2, in phase 101.
- **The save settings.** 1129 (data object `0x52b1`, the shell's `MODE_PICTURE_RECORD_MEDIA`; six values 0..5), 1130
  (the still save slot, 0 or 1), 1131 (the movie slot, 0 or 1; also the id of the menu row 4.3.7 followed), 1132 (0
  or 1), 1134 and 1404; in the lab's blank store all are 0 but 1134, which is 1 (X). Who reads them:
  - *The record controller's card choice* (CmpSts_RecordController `0x50c73f16`): for 1129 = 0 or 1 the card of
    1130 (1 + its value), whatever is in the slot; for 2 to 5 both cards (3) where its own test `0x50c73fd5`
    passes for both slots (not read) and neither media status has a bit of the mask 0x12, else the one slot that
    passes, else 0. DevRec_Rec::recordMedia (`0x50d8b0a1`) turns it into `apiRecInfo`: `slot[0]` the drive
    (0, 1, or `0xffff` for none), `slot[1]` 1 for both cards else `0xffff`, and 1129 itself; REC_MAIN copies the
    request's +76 / +78 / +80 / +82 into the packet's `Media` / `Media2` / `RecordMediaMode` (+297) /
    `RecordDevice` (`0x50539cb0..0x50539cd7`). rec_file_record picks its file context by `Media`'s value
    (`0x5053ff29`: `0x62a8c4e4`, or `0x62a8c540` where `Media` is 1). Correction to 4.8.10: the two contexts are
    drive 0's and drive 1's, not `Media`'s and `Media2`'s.
  - *The remaining shots* (`0x50419164`): for 1129 = 0, or 1 with 1134 = 0, the count of the card of 1130 where its
    status has bit 0x80, else 0; otherwise both cards' counts (0 for an absent one), combined by `0x5041b58d` for 1
    (not read), the smaller for 2 and 4, the larger for 3 and 5.
  - *The application's card check* (checkMediaErrorSubAppMdlShootingCmn `0x5105c978`): in a movie mode the error
    of the slot 1131; for stills 1129 = 0 the slot 1130's (none where exactly one slot has the factor 1), 2 and 4
    an error where either slot has one, 1, 3 and 5 only where both have. setRecordMedia (`0x5107dc70`): with 1129 =
    1 and 1134 = 1 it moves 1130 to the other slot when `0x5105ccd5` answers for the save slot and not for the
    other (validateAutoCardSwitch `0x5107dcf5`; I: the slot is full). One case of `0x51052056` sets the playback
    slot 1404 from 1131 in a movie mode, from 1130 for 1129 = 0 or 1, else from 1132
    (`0x51052084..0x510520da`).
  - *Below the HLS:* TAKE's shot record (`0x503bbb6f`: for 2 and 3 it reads further settings into the record's
    +38000..+38020), the file layer's DCF numbering across the two drives (`0x5087b07d`, `0x5087acfd`,
    `0x5087ad37`), the play module, the movie module (1131).
  - The menu's names of the six values are not read. By the logic 0 records on the save slot, 1 switches cards
    (1134), 2 and 4 need both cards and 3 and 5 go on with one (I: Standard, Auto Switch, Dual Independent and Dual
    Same in their two forms).
- **The menu with one card (X).** OK on Card Formatting opens the card's Format Card / No screen at once; with two
  cards it opens "Select Card to Set Up" first (4.8.2). `test_storage.mjs`'s menu format takes the one-card path on
  E143 and E146 now.
- **The lab's model.**
  - *S-SDCARD's slots:* two cards, each answering the commands of its port (the command's +12); an empty slot
    answers nothing. The second card is the host's `env.card2` (node: `OM_EMU_CARD2=FILE`, `OM_EMU_CARD2_SIZE=GiB`),
    or a new blank card from the Player's input `{"type": "card", "action": "insert", "slot": 2}` (`"size"` in GiB),
    which the player keeps for its later sessions; the first slot's card, or one sharing its sector store, is
    refused. Each slot's card-detect pin is written into the expander's input shadow, 0 with a card and 1 without
    (the seam is S-IOEXP's: its task would store the chip's reads there; a bit the firmware changed stops the
    session), and the slot's card switch in S-KEYBITS' image is at level 1 without a card.
  - *S-CARD:* with a second card and no media manager (camapp 1 and 2) its insertion is the manager's own request,
    `0x31` for drive 1, at the bring-up and at a card input; a card with no file system stays unformatted and
    unmounted, and Card Formatting from the menu formats it (S-MDACTRL with media 1, then the same mount). The
    media flags follow the slot update's rule from each slot's media status, through the store's setter
    (`0x50ab4f75`), at the start and after each change: (1, 0) with one card, where camapp 1 had (0, 0) before. A
    picture goes to the card the record controller's rule names: the slot 1130 for 1129 = 0 or 1, REC's `Media`;
    no picture where that slot has no mounted card; 1129 = 2..5 stop the session (the double-slot record is not
    made). The settings are the store's as they stand: a test sets 1130 through the store's setter, not through
    the menu, and whether the application lets the save slot stand at an empty slot is not read (?).
  - *S-MEDIA:* the second slot's switch as the first's where no manager runs; under camapp 3 the manager takes the
    second slot's change itself and S-MEDIA only reads the drive status back. The first slot under camapp 3 is as
    before (S-CARD mounts it before the application starts). A second card its insertion left unmounted (one with
    no file system) goes out as a mounted one: mount state 0, the removal's requests (the card-info clear's block +0
    is the drive, which `0x508b2b51` maps to its port, D), 711 {8, 0, 0}, flag 0; under
    camapp 3 the manager also unmounts it (state 0, 711 {8, 0, 0}, `0x35`, 15262 = 0, 711 {8, 0, 8}, X). Corrected
    in review: S-MEDIA had left such a card's flag at 1 and its port's card info set, and the card came back
    unmountable (media status `0x608`) and its format failed (`0x1402`) (X).
  - *What stays I or lab choice:* that the camera's expander pin reads 1 for an empty slot (the code only tests for
    not 0); S-CARD's four requests for the first slot and S-MEDIA's removal requests for either (the manager's are
    `0x31` and `0x35`, X); the slot controller's +168 in S-CARD's flags (taken as 0). S-CARD sets the flag alone: for
    a flag of 1 the update also sets 4510 (slot 1) or 4521 (slot 2) to -1 and calls api_rec's `0x504169b2` for both
    slots (`0x50bba8ff..0x50bba95a`, D; what they keep is not read), which camapp 1 and 2 do not get (open).
- **E146.** The rule reads the same forms in its image (the detect `0x508ca01d`, its helper `0x508ca655`, the same
  shadow words, the port index +12, the record controller's 1129 and 1130 at `0x50c81e24`); its sessions pass
  (below). The other bodies with two slots (E139, E134, E125: `card.detect` drives 2) have no helper of this form;
  their one card answers every port as before (open).
- **Tests (X).** `emu/test/test_storage.mjs --slot2` (storageSlots; E143 28 of 28, E146 22 of 22; registered in
  `bin/test.mjs`). One card: detect 0 and 1, the second drive's status 1 and media status 1, no command on port 1,
  flags (1, 0), mount states 8 and 8, switch levels 0 and 1; the first slot's card refused for the second; with the
  save slot at slot 2 the firmware's remaining shots are 0 (803 at slot 1) and S2 makes no file; back at slot 1 S2's
  file is on the card; 1129 = 2 stops S2. Two cards (a blank one and the one with that picture): both mounted, the
  second not formatted by the lab, its DCF database counting its picture (next file 2); the row enabled; S2 with the
  save slot at slot 2 gives `D:\DCIM\100OMSYS\P1010002.JPG`, read back on the second card by `refs/volume.mjs` and
  absent on the first; at slot 1 `C:\...\P1010001.JPG` on the first only; the second card out (drive status 1, flag
  0, the first still mounted) and in, then the first out and in. A blank card put into the empty slot: media status
  with the 4, 0 sectors written, flags (1, 1); out again (slot 2 empty, flag 0, mount state 0, S-MEDIA in use) and
  in again as before; "Select Card to Set Up", the second card, Format Card, Yes formats
  and mounts it, the first card keeps its picture; the player's next session starts with it mounted. E143 under
  camapp 3: one card (the manager clears 15262, its menu camapp 1's word for word; a blank card in and out, the
  manager's flags and mount states those camapp 1's above give), two cards (mounted by the
  manager, the menu camapp 1's with two cards, the second card out and in by the manager, then S2 on the second card).
  `test_camapp.mjs` camapp3FramesSession (12 of 12) now pins the one-card menus equal and the row's pixels against
  camapp 1 with both flags set. `test_facts.mjs` pins `card.slots` on E143 and E146 and none on the 17 others (1447
  of 1447). storageSession passes on E143 (59 of 59) and E146 (58 of 58) with the one-card menu path.
- **Golden (X).** The default sessions are a camera with one card in slot 1 now, so 28 of golden's sessions change:
  the 26 Player sessions (devices, output, stops, harness) and `run/perf`, `run/perf-fault` (output: the play
  workload's hook log, register digest and instruction count; still ok). The screen layer is identical in every
  session, and the devices layer differs only in the instruction stamps of the interrupt and IPI rows. The
  replayed outcomes differ in the same few ways everywhere: UI_IN's idle codes gain `0x02021518` (slot 2's card
  switch at the no-card level), 15261 is 1 where it was 0, the GUI reads 1129, 1130, 1404, 44 and 15209 more often
  and 15262 no longer, and the GUI's extra work moves its stand-in counts and heap (S-RPC request addresses by `0x50`).
  Re-recorded with that reason (evidence: firmware).
- **Open.** The double-slot record (`rec_file_record_DoubleSlot`, 1129 = 2..5) and the auto switch; the movie slot
  1131 beyond the row; the playback slot (1404, `startSlotSwitch`); the manager's own requests in S-CARD's and
  S-MEDIA's place for the first slot (`0x31`, `0x35`); `0x72`; the write-protect pins; the expander's chip and
  UI_IN's group 1 producer; the removal of the save slot's card under camapp 3; E139, E134 and E125; the browser
  player's page (the input works through the API; no control for the second slot yet).

#### 4.8.13 The play module's decode and the album (2026-11-11; D unless tagged, addresses E143's)

- **Why.** 4.8.11 left the view's decode stood in (S-PLAYDEC: no pixel written) and the album open. This round reads
  the decode from the play module's request down to the registers, models the block the request drives, and reads what
  "album" and the picture index are. Everything is behind `camapp_play_native` under `control camapp 3`; the default
  sessions are unchanged (X: golden identical).
- **The path.** PLAY_LOADDRAW (119) reads the file (two requests) and posts PLAY_DECODE's queue 194 {`0x42`, 0, 1, a
  parameter}; PLAY_DECODE (118) runs play_img_make_view_division, whose request (4.8.11) carries one more field: +28
  a work buffer for the decoded planes (+36 its bytes), X: bus `0xcfbd5400` and `0xe2f61400`, outside the lab's
  memory (the lab backs 384 MiB of DRAM from bus `0xa0000000`). The source's +0 is a bus address too (X: `0xaefce700`,
  the whole file). The issue `0x5048f331` builds a local request of kind 10 (`0x5048f39d`), the source's 64 bytes at
  its +20 and each destination's 56 from +84. It compares the destination with the source's size over 7, plus 1, made
  even (`0x5048f3d1..0x5048f40a`): a smaller destination takes an intermediate image and a further call
  (`0x5048f4b3..0x5048f559`, not followed); the views here (900 x 600, 474 x 316) are larger (X). The dispatch
  `0x5046d814` gives kind 10 to the generic handler `0x5046d994` -> `0x5046d9a6`: the parameters' packing
  `0x504809ec` into a register image (X: at `0x62a83228`, more than 11 KiB), the callback's phase 4, the units' set-up
  `0x5048134d`, phase 5, the go `0x504814d2`, phase 6. After the end's interrupt the end function `0x504814ef` runs
  (X: its writes follow the handler's).
- **The block: the image library's pipeline at `0x9c200000`, and the JPEG codec at `0x99900000`.** Not the imgpro
  unit `0x9c600000` (4.3.1). The register image's first three words are unit masks A, B and C; the set-up writes each
  unit's words by its bit (`0x50481cd5..0x50482224`). The decode's masks are A `0x80301`, B `0x100001`, C `0x107` (X),
  and its units:

  | Unit | Bit | What (D where the code computes its words, else I) |
  |---|---|---|
  | `+0x000..+0x2fc` | - | the block's own: unit masks, starts, statuses, IRQ enables, clock words |
  | `+0x400` | A 0 | ? (28 words) |
  | `+0x2e00` | A 8 | the prefilter: mode and taps (below) |
  | `+0x2400` | A 9 | the resizer's map: centres, steps, cross terms |
  | `+0x800` | B 0 | the output: format, pitch |
  | `+0xb400`, `+0x20000` | B 20 | the resizer: source, destination, sizes; its program (`0x13a2` words, below) |
  | `+0xb000` | C 0 | the codec's output: the work buffer, the MCUs a row |
  | `+0xb080`, `+0x3a00` | C 1 | the codec's side: MCU counts, the mode |
  | `+0xae00` | C 2 | the codec's stream: its address |
  | `+0xc00..+0xeff` | - | written for every request (`0x50481c53`, `0x50482444`); ? |

  The resizer's program is copied from the image's table `0x5063a040` (`0x50482e38`), the same for every request.
  The codec's driver is `0x5050a2ba`: mode 0 is the decode (`+0x1000` = `0x8004`, `+0x100c` = `0x8002`, `+0x1028` =
  `+0x102c` = `0xffff`, then `+0x1000` bit 0 set); any other mode is the encode, which writes the size, the MCU count
  and the Huffman tables (`+0x1200..+0x1800`, `0x5050a606`), as does the start beside it (`0x5050a4ad`, with the
  quantization tables at `+0x1c00` and `+0x1c80`). The codec parses the stream's headers itself (I: the driver gives it
  the file from SOI and no table).
- **The protocol (D; X: 5,464 register accesses a request, 5,026 of them the program's copy).** The set-up writes the
  clock words (`0x5048d48a`: `+0x2d8`, `+0x2e8`, `+0x2e0`, `+0x2f4`, then `+0x2f8` = `0x2611` and a wait until its low
  byte reads 0), the masks to `+0x004`, `+0x014`, `+0x01c`, and the units' words. The go (`0x5048198b`): the codec's
  start, `+0x0c8` = `0x102`, `+0x12c` = 60, the masks to `+0x034`, `+0x03c`, `+0x0cc` = 5, `+0x024`, `+0x13c` =
  `0x100000`, `+0x0e8` = B & `0x700000`, `+0x0f4` = 5. The end is IRQ 288 (the handler `0x5048bb88`, attached at level
  5 by the library's `0x5048c3a0`, which H-IMGPROINIT runs): it ands the statuses `+0x110`, `+0x120`, `+0x12c` with
  their enables `+0x134`, `+0x13c`, `+0x140`, writes the results back and clears the enables; with `+0x120` bit 20 it
  reads the resizer's status `+0xb47c` and enable `+0xb478`: bit 0 calls the request's callback with phase 12 (X: the
  wait then returns), unless the record's halfword +44 has bit 5: then it writes `+0x1b4` = `0x800000` and returns
  (`0x5048bc05..19`; not taken here, X). The end function writes the masks to the statuses (`+0x10c`, `+0x11c`,
  `+0x120`, `+0x12c`) and to `+0x020`, `+0x030`, `+0x038`, `+0x000`, `+0x010`, `+0x018`, the codec's `+0x000c` = 5
  and the clock words (`0x5048d53a`). The driver reads no codec register but `+0x1000` and no result word on this
  path (X: 13 reads a request).
- **The geometry is in the words (D).** The stream: `+0xae04` = the request's source +0 (`0x50477451`). The codec's
  output: `+0xb00c` = the work buffer >> 4 (`0x504773c2`), `+0xb08c` / `+0xb080` the MCUs a row and the MCU rows
  (`0x504772d5..fe`). The resizer reads the same buffer (`+0xb550`, `0x5047991b`; `+0xb548` the size) and maps each
  destination pixel into the source about the two centres: `+0x249c` / `+0x24a0` = (size - 1) << 3, `+0x24ac` /
  `+0x24b0` the steps in 4.12 fixed (`0x504784f4..0x5047853e`; X: `0x1cd0`, `0x1cd2` = (1619 << 12) / 899 and (1079
  << 12) / 599), `+0x24b4` a cross term (`0x5047a47a`: the map is affine), `+0xb514` / `+0xb518` the position of
  pixel (0, 0) from the source's centre (step * -(size - 1) / 2), `+0xb598` / `+0xb59c` the destination's centre.
  So x reads the source at 809.5 + (x - 449.5) * 1.80078: 0.049 .. 1618.95 (X). The destination: `+0xb560` =
  address >> 4, `+0xb5a0` the size, `+0x8b8` the format (the low nibble 2, bit 8 clear for 3074, `0x5047ecbf..`),
  `+0x8ac` the pitch in units of 64 pixels (`0x5047ef83..b0`).
- **The prefilter (D for the table and the words; its form I).** The packing `0x50477d5b` takes per axis the ratio
  ((source - 1) * 100 << 10) / ((destination - 1) * k), .10 fixed, from a 32-bit dividend to a 16-bit quotient: the
  source's size from its +16 / +18 (`0x50477e57..6e`), the destination's from its +12 / +14 (`0x50477e70..86`), k
  100 for a source format whose bits 15..10 are not 1, 3 or 4 (`0x50477e43`; 7170 and 7171 are 7; the others take k
  from a table, not read), the divisions at `0x50478284..ab` (X: d0 / d1 at `0x504782ac` 1844 and 1844 for the view,
  where (1620 << 10) / 900 would give 1843). `0x504e2425` writes the unit `+0x2e00` for each axis whose ratio is above
  1024: the row `0x504e23a5` finds, the first of 40 thresholds (`0x5066fb58`) the ratio does not exceed, the last row
  above them all (`0x504e23c8`; the rows, `0x506a4a64`'s pointers). A row is a pre-reduction code (0, 1, 3 or 7) and
  three taps; every row's taps make 128 as centre + 2 * next + 2 * outer (X: all 40), so a symmetric filter of 5 taps
  in 1/128 (I), its pass band narrowing with the ratio. The view's 1844 (1.80) takes row 9 (1778 < 1844 <= 1909): 68,
  34, -4 (X: `+0x2e64` = `0x220044`, `+0x2e68` = `0xfffc`). A ratio above 3327 (3.249) takes a pre-reduction: INFO's
  detail view (474 x 316; X: 3504 and 3507 at `0x504782ac` in a run that passed the request to the model) has code 1,
  and its request differs in 57 words beside the program's copy (X): B is `0x101001`, the resizer's source is 810 x
  540 (`+0x249c` = `0x1948`), `+0xcd8`, `+0xce8`, `+0xd00`, `+0xf00`, `+0xb4b8`, `+0xb4dc`, `+0xb588` change. Which
  unit halves the picture, and how, is not read (?). The table fits codes 1, 3 and 7 being reductions by 2, 4 and 8
  (I): rows 16 to 23, 24 to 31 and 32 to 39 repeat the taps of rows 8 to 15 at 2, 4 and 8 times their thresholds (X:
  3557, 7114, 14228 against 1778; the last threshold is 65535, so a 16-bit ratio always finds a row).
- **The model (X, `emu/src/dev/imgpipe.mjs`, board `imgpipe`).** S-IMGPIPE: the units' pages above as storage and,
  of the block's own words, the 45 the decode writes (X; any other, such as the handler's `+0x1b4`, a bus error), the
  commit word's low byte 0, the statuses' write 1 to clear, IRQ 288 while a status and its enable share a bit. At the
  go's last word it computes the one program read here and refuses any other with a bus error (other masks, a missing
  word, the 4:2:0 mode, a crop, a cross term, format 3330, a work buffer on the lab's memory, the encode; a
  pre-reduction already at its set-up's write of `+0xf00`, X): the stream from `+0xae04` decoded by the lab's own
  baseline decoder (`emu/src/lab/jpeg.mjs` decodeJpeg; SOF0, 8 bits, one interleaved scan), checked against the
  words' size and MCU counts, then **A-IMGPIPE-2 (I)**: each plane through the prefilter's taps along x and y (edge
  samples repeated), sampled at the mapped position by linear interpolation, the chroma at each pair's even pixel;
  the destination written as Y Cb Y Cr, the layout the library's fill gives format 3074 (4.3.1). **A-IMGPIPE-1
  (I)**: the end comes 1 ms of lab time after the go. The work buffer is not written. What the units at `+0x400` and
  `+0xc00` and the resizer's program do to the samples is not read; the resizer's own filter and the chroma's siting
  are assumptions. What would settle them: the program's meaning, or a frame read back from a camera.
- **S-PLAYDEC, what remains.** A request with a pre-reduction (the lab applies the library's own rule above to the
  request's fields, the thresholds read from the image; another source format is refused) is answered as before:
  issue and wait 0, no pixel. X: the detail view's (ratios 3504 and 3507, codes 1 and 1); for each view the rule's
  ratios equal the library's own at `0x504782ac` (playDecodeSession). S-PLAYSEQ, S-PLAYCOMP and S-PLAYVIEW stay out;
  S-ALBM stays (below).
- **Where the result is shown (X).** The destination is one of the through image's two banks in turn (`0x98d4d800`,
  `0x9a43e000`; the request's +64). The display interface then sends DISPLAY cmd 5 (the function ending at
  `0x507f67fb`, through `0x5002e39d`) and the TFT's IMG1 is latched on the bank: DMASADR = address >> 4, DMALD `0x2b8`,
  AREA 900 x 600, FMT 0, RSZ1 `0x10` with RSZ4 `0x2000`, no horizontal resize. That is one source row per line only
  with IMG1's vertical unit of 1/8192 on channel 2 (A12): a 600-row picture for a 600-line window is evidence for A12
  (I). The lab's IMG edge guard knew no such attach; it now passes an IMG1 drawn one pixel per pixel from a frame a
  decode wrote (`emu/src/lab/display.mjs` decoded_fit).
- **The frame against camapp 1's (X, playDecodeSession).** Two pictures of two scenes (S-SCENE's static and chart
  presets), taken in camapp 1 with the live view, and under camapp 3 the same two from the same scene views and a
  third of the static one (camapp 3's live view stops at the histogram, 4.2.4, so the test gives each picture its
  view; the bins are counted since 4.2.7). Differences, each with its cause:
  - *The picture.* Mean luma difference 1.47 (static) and 5.29 (chart); against the other picture 79.8 and 77.0.
    Camapp 1 shows the scene's frame, which S-PLAYVIEW renders again and the VSC scales from 1620 x 1080; camapp 3
    shows the file: S-JPEGENC's stream keeps each 8 x 8 block's mean only, then the prefilter and the resizer's map
    (A-IMGPIPE-2). The chart's fine detail is what the block means lose.
  - *The plane.* Camapp 1: IMG1 on the lab's live-view bank, resized by the VSC. Camapp 3: IMG1 on the bank the
    firmware chose, one pixel per pixel.
  - *The OSD.* 11,744 (picture 1), 11,849 (picture 2) and 12,124 pixels (picture 3 against camapp 1's picture 1),
    all from row 519 down: the information rows. Camapp 3's values are the file's Exif (4.8.11: no date with the
    clock unset, ISO L25, 3:2, 1/1), camapp 1's S-PLAYCOMP's record.
  The bank's 1,080,000 bytes equal the test's own computation from the independent decoder's samples, and the
  composite's picture equals the bank's samples (0 differ, four views).
- **The album is the short-movie album manager (D).** ALBM's functions are albm_main_* over "smv" and "4gb" albums
  (its console's `albm add FILENAME ALBUM_NO ..`), and Get_Album_Num `0x503dd27f` is PlayCommon's
  getShortMovieAlbumNum. playOneFrameStart calls it only where `0x5040111b(4, index)` returns 0 and a flag word is 0
  (`0x50c50096..0x50c500c5`). X: not entered with one, two or three stills over PLAY, right and left. Stills have no
  album.
- **The picture index is the DCF database (D, X).** The play module builds no index of its own. A move's requests
  are PLAY's: the play API posts PLAY_EXEC {6, a token, 0 (load), parameter}, then {.., `0xb` (load and draw), ..}.
  The picture is named by its DCF index: the media API reads the count from the database's table (`0x50874b39`: the
  word at `0xa33aa5b4` + 52 * slot) and the fnode by index through `0x50874bc9`, which sends the DCF process command
  5, the one the lab's S-CARD list sends (`emu/src/lab/storage.mjs` fnode). play_file_read (`0x518b017f`) takes the
  file part's offset and size from the fnode (`0x508750f6`: +68 / +72 for part 3) and sends the file module a request
  of code `0x53` (`0x518b0236..40`). X, three pictures: PLAY shows index 3, right 1, 2, 3 (it wraps), left 2; each
  view makes three reads (PLAY_LOAD one, PLAY_LOADDRAW two) and one decode. X (playDecodeSession, three pictures):
  PLAY 3, right 1, left 3, left 2, each with the component's getNumber (index, file number, folder 100) and the
  decode into the other bank than the view before; the move right calls the fnode getter 49 times, for the indices 1
  and 3.
- **Stand-ins under the opt-in (X).** Over PLAY, right and left no S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW or S-PLAYDEC
  fires; the first three install no hook, S-PLAYDEC's observe the issue and the wait and pass a request without a
  pre-reduction to the firmware. S-ALBM answers once, at the mount, as in every session with the file
  system. (Since the second slot is empty by default, 4.8.12, camapp 3's media manager no longer mounts drive 1,
  whose mount's init that answer was, so S-ALBM answers nothing after the bring-up there: 0 in playDecodeSession, X
  at the round's merge.)
  Lifted, the storage bring-up stops at once: the album manager's init starts a task (entry `0x508b7e91`) the
  lab's kernel does not allow, before the application starts. It stays: no still path needs it.
- **Tests (X).** `emu/test/test_imgpipe.mjs`: the decoder against refs/jpeg.mjs 6 of 6 (the lab's stream sample for
  sample; streams with AC coefficients in three samplings within 1 level), the model on a bare machine 30 of 30.
  `emu/test/test_camapp.mjs`: playDecodeSession 27 of 27, playNativeSession 11 of 11.
- **Open.** The pre-reduction (which unit, its phase), so the detail view's decode; the units at `+0x400` and
  `+0xc00`, the resizer's program and filter (A-IMGPIPE-2); the units' time (A-IMGPIPE-1); the codec's own registers
  beyond the driver's words, and its encode (another track); the request's callback phases 21, 22, 15 and 38; the
  second request for a destination under 1/7 of the source; the index view, movies and the album manager; INFO's
  histogram (4.8.11; its bins counted since 4.2.7, from the fill while this view's pixels are S-PLAYDEC's); the other
  bodies.

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

#### 4.12.1 The strobe and the hot shoe natively (2026-11-09; D unless tagged, addresses E143's)

With `--take probe` STB_EXTERNAL and STB_HANDLER_PROC run natively (H-STBINIT, `emu/src/lab/take.mjs`) over a model of
the hot shoe's serial channel with nothing on the shoe (S-HOTSHOE, `emu/src/lab/shoe.mjs`): STB_EXTERNAL answers
TAKE_FUNC_CP's start (commands 1 and 4, tokens 4 and 8) itself, 85.4 ms after command 1 where 4.1.6's run took 13.1 s,
and S-TAKEREQ no longer answers its queue. `emu/test/test_take.mjs` pins it under camapp 1 and camapp 2 (X, 27 of 27
checks); `emu/test/test_take_release.mjs` passes unchanged (X, 15 of 15); golden is unchanged (the probe is off by
default). This corrects 4.1.6's strobe bullet where it says nothing on the path asks for a flash.

- **What the 13 s wait was (D, X).** Command 1's case (`0x501b7856`, from the table `0x602a8694` keyed by command + 1)
  calls `0x501b1e7e` (below), then `0x501b6be7`, which fills PER_SIO's configuration of channel 11 at `0x62a296b4` (+0
  the channel; +4 0, the controller kind; +6 `0x300`, a transmit and a receive completion; +8 the rate 20833; +20 1 with
  the callbacks +24 `0x501b6810`, transmitted, and +28 `0x501b6860`, received), then the exchange switch `0x501b82ab(0)`
  (kinds 0..9 through `0x602a8714`). Kind 0 is the wake `0x501b833e` ("WAKE_S", "WAKE_E"): its transfer record
  `0x62a2978c` (+0 the completion `0x501ba0bc`, +10 one byte, +12 no receive, +14 the byte 0x00, +414 a 50 ms receive
  timer) goes through `0x501bb0b8` -> `0x501b67fc` -> `0x501b6c54` (channel 11's open, up to five tries 10 ms apart
  while it answers 1 or 3) -> `0x501b6ab9`, which configures the channel through `0x5006480b` (always mode 0: the
  configuration's mode byte is cleared at `0x500648ae`), starts the receive (`0x50064949`) when +12 is not 0 and the
  first-byte event (`0x5006495f`) when +416 is 1, then the transmit (`0x50064933`). The wait of 13000 on the strobe
  flag's bit 2 (`0x501b8392`) ends when the transmitted callback `0x501b6810` has run: with no receive it calls
  `0x501b6931(0)`, which starts a 1 ms timer whose handler `0x501b69cd` queues `0x501b69fc` to STB_HANDLER_PROC
  (`0x501bb29c`), which calls `0x501ba0bc(0)` (status 0, bit 2) and closes the channel. So the 13 s were the wake byte's
  transmission never ending, the end of channel 11's transmit that the lab had no controller for (as 4.1.6 found); no
  timer was missing (the review's refutation stands), and nothing on the path waits on a shoe pin or a reply.
- **How the firmware decides there is no flash (D, X).** After the wake's 64 ms timer, state 1 (`0x62a29ad4`, set by
  command 1 at `0x501b7872`) runs the detection `0x501b7f36` -> `0x501b7fb3`: a 20 ms window (timer handler
  `0x501ba2aa`: `0x62a29ae5` = 1, bit 64) with GIO pin 24's interrupt enabled for its length (`0x501c17cd(24, 1)` and
  `(24, 0)`, the callback `0x501c17b7` setting bit 1 of the flag at `0x6004311c`; what drives pin 24 is ?), a 6 ms wait
  (bit 32), then kind 2, the ID exchange `0x501b83ff`: the bytes 0x55 0x82 (0x55 0x8d and 13 bytes when `0x501bb1f8` is
  true, not read) with a receive of 9 and its first-byte event on bit 16, and a wait of at most 5000 for bit 16, 64 or 4
  (a new request). With no first byte the window's end makes the exchange fail (`0x501b853b`: the channel closed, status
  1, no log), and the detection returns 0 with the state left at 1, the no-flash state; command 1 then replies status 0
  (`0x501b76ba`). A first byte would lead on to the rest of the reply and the 13000 wait for the transfer
  (`0x501b8501`), then `0x501b9292` ("ext strobe detected ID", not read). In state 1 the task's receive times out after
  250 ms (`0x501b7575`, `0x501b9261`) and each timeout runs the detection again (`0x501b773e` -> `0x501b7794`): the
  camera polls the shoe for a flash (D; X: every 265 to 586 ms in the lab; I: the spread is the lab's timer delivery,
  which it takes at its idle points).
- **What an empty shoe presents (D, I, ?).** Until a reply, the camera is the only talker on channel 11: the wake's
  byte and the ID request go out on the controller's own bit timing (mode 0: the divider `0x5005efe9` divides the clock
  by 32 times the rate, against 4 times in mode 1, the clocked serial of PER_SCPU's channel, and 16 times in mode 2, the
  IIC layer's; I: an asynchronous serial line), so their ends do not depend on the far end (I). With nothing on the
  shoe no byte comes back (I); what the receive line idles at is ?, and the firmware reads 20 ms with no first byte as
  no flash (D). No shoe detect pin is on the path: `0x501b1e7e` -> `0x501b1ea6` asks the built-in strobe test
  `0x501b387f` (`clr d0; retf`: 0 on E143, which has no built-in flash) and then configures GIO pin 160 (`0x5005197a`
  with the record `0x501c17f2` builds; what the pin drives is ?).
- **PER_SIO channel 11 on E143 (D).** The channel map `0x6011be1c` (the map setter `0x5005f0b2` takes it for every board
  id, the table `0x6011be0c`) gives channel 11 the controller index 6, whose registers (the driver's register-address
  table `0x6011b614`, 136 bytes an index) are `0x98580000..0x98580028`, `+0x40..0x58` and `+0x80..0xa0`; the A53
  kernel's `mn_sio_uart`, which drives index 1's block `0x98300000` as ttyS1, takes +0x18 as its TX byte and +0x44 bit
  15 as not ready too (`docs/a53-spec.md` 5). The board configuration `0x6011be3c` (three bytes an index) gives index 6
  {1, 0, 1} (bytes `0x6011be4e..0x6011be50`): the driver's init `0x5005d5c7` -> `0x5005d66f` attaches its IRQs 205 and
  206 (`0x5005e8db(6)` through the stubs `0x5005e744`, `0x5005e7d2`) and 207 (`0x5005e877`: the table `0x6011bdd8` by
  the index's direction byte) at level 5, from the tables `0x6011bc18`, `0x6011bc9c`, `0x6011bd20`, with byte 1 as the
  attach's CPU (`0x50053fcd`'s fourth argument, `docs/om1-intc-timer-spec.md`): index 6's interrupts go to CPU 0, the
  CPU STB_EXTERNAL and its timers run on (the lab ends the transfer there too). Mode 0's transfer start `0x5005dc2c`
  (the table `0x6011bdb0`, from the driver's start `0x5005dc03`) resets the transmit side (`0x5005e43e`: +0x28, +0x50),
  writes bytes to +0x18 while +0x1c reads nonzero (`0x5005de3f`) and enables the transmit interrupt (`0x5005e221`,
  `0x5005e40a`); the handler `0x5005e8db` clears the error bits 0x4c of +0x50 (logged where the index's byte 2 is 1, as
  for index 6), takes the receive status (+0x14 bit 16) to mode 0's receive handler `0x5005ed8a` and the transmit status
  (+0x28 bit 16) to mode 0's transmit handler `0x5005e9ab`, which refills the FIFO and, the count done, calls the
  index's transmit completion (`0xa32c9658`, `0x5005ea80..0x5005ea99`). Mode 0's receive start `0x5005df40` splits off
  the first-byte event's count (`0x5005e311`'s tables `0xa32c97e4`, `0xa32c9810`, `0xa32c983c`), whose end sets the
  event's flag bits (`0x5005edfc`). The close `0x5005e628` turns both directions off (`0x5005e56e`: +0x14, +0x40, the
  first-byte event cleared; `0x5005e5ac`: +0x28, polling +0x44 bit 15 for the transmitter, at most 1,152,072 reads).
  STB's protocol is its exchanges, kinds 0..9 of `0x501b82ab` (0 the wake, 2 the ID exchange; `0x501b85c2`,
  `0x501b860c`, `0x501b86a3`, `0x501b8756`, `0x501b8d5f` not read).
- **The model (X).** H-SIOMAP: the channel map set by its own setter under the probe (the word `0xa32c9e48` was 0 and
  low memory's bytes 0, X, so in 4.1.6's run channel 11 used index 0's `0x98200000`, I), which gives every channel its
  own index for the rest of the session, not only channel 11 (X: the probe's sessions in `test_take.mjs` and
  `test_take_release.mjs` run on with it); index 6's page is allowed in the lab stub, which keeps what is written (the
  close's poll reads +0x44 as 0, the transmitter idle, I). S-HOTSHOE serves mode 0's transfer and receive starts for
  index 6: a transfer's bytes go nowhere and it ends at the MN's next idle point (A-HOTSHOE-1) in interrupt context
  through the index's transmit completion; a receive is kept, never answered (A-HOTSHOE-2), and dropped at the index's
  close. H-STBINIT starts STB_HANDLER_PROC (task 139, `0x501bb24a`, tid word `0x60042e3c`) and STB_EXTERNAL (task 101)
  as USTART2's stage `0x501e8e84` does (`0x501e8fbd`, `0x501e8ff3`; STB_CHARGE, started at `0x501e8fd8` between them,
  stays dormant). STB_HANDLER_PROC is needed: the wake's end is a function the 1 ms timer queues to it (`0x501bb29c`:
  ten slots at `0x62a29b4c`, flag `(0x6004317c)` bit 1; without it the wake waited, X). While a request STB_EXTERNAL
  took has no reply, the step runs lab time in 10 ms slices, at most 1 s, as its requester's wait lets the camera's time
  run.
- **The run (X, camapp 1 and 2).** STB_EXTERNAL takes command 1 at 2782.000 ms of lab time; the wake's byte 00 ends at
  once, the 1 ms timer's callback gives status 0 at 2783.001, the 64 ms timer ends at 2847.423, the 6 ms wait at
  2853.424, the ID exchange 55 82 goes out with a receive of 9 that nothing answers, the window ends at 2867.424, the
  channel closes, and the reply `{0, 4, 0}` reaches TAKE_FUNC_CP_POST at 2867.424, 85.4 ms after command 1 (the strobe's
  own 1 + 64 + 20 ms and the lab's timer delivery); command 4 (token 8) is taken and answered at once in state 1, status
  0. Row 2 of 4.1.4's start table now reads: STB_EXTERNAL 1 (native), the dust filter, STB_EXTERNAL's reply,
  STB_EXTERNAL 4 (native), its reply, TAKE_FUNC_CP's reply; the GUI reaches the shooting screen within the start. Over
  the test's scenarios (a live view, S1, S2, MENU, a mode change) the task keeps polling (28 exchanges under camapp 2),
  its state stays 1, it sends nothing but its two replies (OlyQeWr to 0x61; STB_HANDLER_PROC sends nothing; camapp 1 and
  2), and no strobe error log comes (0x23000112, 0x23000222: none). The warning `0x39000903` that 4.1.4 reports absent
  with the probe is logged with and without the native strobe in these runs (X; not this round's).
- **The built-in and RC strobe on TAKE's requests (D, X, I).** TAKE's start asks the strobe only through STB_EXTERNAL's
  commands 1 and 4 (X). The built-in strobe test on their path is the constant 0 (above). The RC strobe's code
  (`stb_control_flash_rc_iocontrol` `0x501b1719`, STB_SEQ's `0x501be6a3`, the light-value helpers `0x501abe98` and
  `0x501abf94`) is not in STB_EXTERNAL's static call closure (538 functions, the firmware map's direct calls; 22 of them
  make indirect calls it does not follow), none of it runs in the test's sessions (X, camapp 1 and 2), so TAKE's
  requests do not need it (I).
- **Open.** A flash on the shoe: its replies to the ID exchange and the other kinds (not read; S-HOTSHOE has no device,
  so the firmware would read no flash); channel 11's controller at its registers with IRQs 205..207 on CPU 0 (the bits
  above are the driver's accesses, their meaning partly I); GIO pins 160 and 24; STB_CHARGE and STB_SEQ.

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
   measured before TAKE is attempted. The start tasks' own order, the conditions each waits for and where each stops
   when run natively are in 4.6.3 (2026-11-11).
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
   `0x9a000108` (42). `0x9bf1000x` and `0x9c01000e` are probably codes of the same kind (I, not checked). Corrected
   2026-11-11 (4.6.3): the codes are codes, but the block is MMIO too. The boot's first stage-0 call `0x50031892`
   programs an address-decode error monitor at `0x9a000000..0x9a000414` (D), and its first store is a bus error in
   the lab (X).
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
    was not modelled then; since 2026-11-10 the touch task runs on the family and takes them, `docs/model-survey.md`
    finding 88). E118 and E120 (findings 48 and 49, 2026-10-30) have another display sync module, a state byte
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
8. Which core services each shared interrupt (282-283, 288-292, 296-302, 307-309, 53 / 54, 323-326): the enable calls
   `0x50054012` / `0x5002ea93` decide it and are not scanned (static, no hardware needed).
