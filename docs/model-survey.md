# Model survey

Every body firmware the vendor's updater API served on 2026-10-19, what the lab's port pipeline makes of each one, and
where each ported body stands. This is the baseline for the multi-model plan in `ROADMAP.md` "Multi-model". Tags as in
the specs: **X** executed or measured (the command is named), **D** read from the firmware, **I** inference.

Terms used below: a body's *port* is its address table and firmware facts in `emu/src/fw/ports.mjs`, written by
`emu/bin/port.mjs`; *paired* is the number of instructions the cross-build map pairs with E143's, *unmapped* the lab's
E143 addresses it cannot place; a *rule* reads a fact from each firmware (`emu/src/fw/facts.mjs`, each pinned on every
unpacked body in `emu/test/test_facts.mjs`); `port_via` names a reference body a port is chained through ("The chained
port" below); the *tft child* is `bin/modelcheck.mjs`'s session child on the TFT (`OM_EMU_MODEL=<code>`, start then
S1); *curl-drive* is the interactive player (`emu/play.sh --no-browser --model <code>`) driven over its HTTP API: its
status until it settles, a frame and S1. Stand-ins (S-...) and harness rules (H-...) are listed in the player's
status and in `emu/src/lab/playui.mjs`.

## How it was run

1. Probe: `node emu/bin/fw-survey.mjs probe 100 199` asks the API for `OLY<code>000000000` over E100..E199. 32 codes
   answer (table below); E148..E199 answer nothing, so the new OM System PEN is still not served (X).
2. Fetch: `node emu/bin/fw-survey.mjs fetch <code> ...` puts each `.BIN` with its reply under `fw/` (E140 and later) or
   `fw/old/`; the digests are in `BLOBS.sha256`. The six `.BIN`s pinned before this survey (E118, E122, E125, E134,
   E139, E142) downloaded again with the same digests, so none of these releases changed since 2026-10-06 (X).
3. Survey: `node emu/bin/fw-survey.mjs survey` walks each `.BIN` (blocks, checksums), expands the main block's
   olycompress sections, and reports the run-time base, the MMIO family and the resource block's form (the columns are
   defined in the tool's header) (X).
4. Port trial: each body with an image base in the 0x60000000 range, and the older ones for comparison, got a minimal
   `MODELS` entry (identity, digests, E143's panels) in a scratch copy of `emu/`, and `bin/port.mjs` ran on it (X).
   `res_prefix_sha256` was skipped for a resource block without olycompress, on which `port.mjs` throws.
5. Session trials: each tier A-C body then got its committed `MODELS` entry (`src/fw/models.mjs`: digests,
   `image_base`, `board.family`) and its port, and opened a play session through the tft child and, once it built one,
   through curl-drive. The Lab column below is the state as of 2026-10-23 (`bin/modelcheck.mjs --no-port`).

## The bodies

Main: the main code block (flags 0x0100) in MiB, with its olycompress sections. Base: the run-time base of the image
with the share of its pointers that land on a string start (E143: 7.5%). Res: whether the resource block (flags 0x0101)
holds olycompress blobs. Paired / unmapped: the port trial against E143, before any body-specific work (the ports
through a reference place more; "Per-body status" has their figures).

| Code | Body | fw | Main | Base | Res | Paired | Unmapped | Lab |
|---|---|---|---|---|---|---|---|---|
| E143 | OM-1 | 1900 | 32.0 | 0x60021020 (7.5%) | olycompress | - | - | the lab's build |
| E146 | OM-1 II | 1300 | 32.0 | 0x60021020 (7.6%) | olycompress | 5.55M | 3 | modelcheck passes (TFT and EVF) |
| E147 | OM-3 | 1100 | 32.0 | 0x60021020 (7.5%) | olycompress | 5.25M | 5 | modelcheck passes |
| E144 | OM-5 | 1200 | 23.7, 2 sections | 0x60021020 (6.6%) | olycompress | 2.15M | 45 | modelcheck passes (TFT and EVF) |
| E139 | E-M1 III | 1600 | 26.0, 2 sections | 0x60021020 (6.6%) | olycompress | 2.08M | 44 | through E144: modelcheck passes (TFT and EVF) |
| E134 | E-M1X | 2400 | 26.0 | 0x60021020 (6.5%) | plain | 2.03M | 46 | through E139: modelcheck passes on the TFT; the EVF start stops at a synchronous send to a queue whose task does not run |
| E137 | E-M5 III | 1700 | 23.9 | 0x60021020 (6.7%) | plain | 1.71M | 68 | through E144: modelcheck passes (TFT and EVF) |
| E142 | E-P7 | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.47M | 74 | through E144: S2 takes its card image; PLAY after S2 stays in shooting (no EVF) |
| E140 | E-M10 IV | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.44M | 77 | through E142: S1's AF frame stops at an OSD bitmap of format 9 the engine model lacks (TFT and EVF) |
| E125 | E-M1 II | 3700 | 22.0 | 0x60021020 (7.1%) | plain | 1.29M | 71 | through E134: modelcheck passes (TFT and EVF) |
| E145 | TG-7 | 1103 | 19.5 | 0x60021020 (7.5%) | plain | 1.10M | 81 | through E142: the start ends in 0x1103 (unnamed) with no USB cable; S1 stops at the unplaced AF upload (E143 `0x500257ce`) |
| E133 | E-PL9 | 1101 | 25.0 | 0x60400020 (7.2%) | plain | 1.04M | 83 | through E142: kernel, display start, touch start and the camera application's start, then the application's task waits inside the GUI creator: `H-GUIBYAPP: GUI tasks [], timer tasks [] after the application's start` |
| E130 | E-M10 III | 1200 | 25.0 | 0x60400020 (6.9%) | plain | 1.02M | 82 | through E142: shooting screen; S1 stops at the unplaced AF upload (E143 `0x500257ce`); the EVF start stops as E134's |
| E129 | TG-5 | 1101 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: kernel and display start, then the settings store's registry bootstrap waits for the boot's stage-1 bit: `registry bootstrap 0x50040aeb: all tasks blocked (lab task 153 state WAI)` |
| E132 | TG-5 (KOUICHIRO) | 1300 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: kernel, display start and settings store, then blocks in the camera application's start on a serial request (channel 9) whose send is deferred to an interrupt the lab does not raise: `all tasks blocked (lab task 155 state WAI)` |
| E118 | E-M5 II | 4100 | 20.4 | 0x60021020 (7.2%) | plain | 0.80M | 123 | stops at import: board fact `intc.irq_osd_engine` unknown (family E118) |
| E122 | PEN-F | 3101 | 20.4 | 0x60021020 (7.2%) | plain | 0.79M | 123 | stops at import, as E118 |
| E120 | E-M10 II | 1400 | 20.4 | 0x60021020 (7.4%) | plain | 0.76M | 122 | stops at import, as E118 |
| E113 | E-M10 | 1400 | 18.0 | 0x7d991020 (7.4%) | plain | 0.88M | 155 | not tried (base) |
| E109 | E-M1 | 4600 | 17.0 | 0x6daf1020 (7.2%) | plain | 0.76M | 139 | not tried (base) |
| E126 | E-PL8 | 1100 | 18.0 | 0x7d971020 (8.2%) | plain | 0.74M | 140 | not tried (base) |
| E117 | A01 | 1400 | 18.0 | 0x7d971020 (8.8%) | plain | 0.69M | 142 | not tried (base) |
| E115 | E-PL7 | 1400 | 18.0 | 0x7d971020 (8.0%) | plain | 0.66M | 141 | not tried (base) |
| E121 | TG-4 | 2000 | 18.0 | 0x7d991020 (10.9%) | plain | 0.50M | 179 | not tried (base) |
| E111 | STYLUS 1 | 2004 | 15.0 | 0x7e0e1020 (8.1%) | plain | 0.44M | 187 | not tried (base) |
| E108 | E-P5 | 1800 | 15.0 | 0x7e101020 (8.0%) | plain | 0.42M | 188 | not tried (base) |
| E100 | E-PL5 | 1600 | 13.5 | 0x7e421020 (8.3%) | plain | 0.30M | 215 | not tried (base) |
| E101 | E-PM2 | 1600 | 13.5 | 0x7e421020 (8.3%) | plain | 0.30M | 216 | not tried (base) |
| E112 | E-PL6 | 1400 | 13.5 | 0x7e421020 (8.5%) | plain | 0.30M | 215 | not tried (base) |
| E106 | TG-2 | 1100 | 14.0 | 0x6e465020 (9.6%) | plain | 0.25M | 230 | not tried (base) |
| E110 | TG-2 Limited | 1100 | 14.0 | 0x6e465020 (9.6%) | plain | 0.25M | 230 | not tried (base) |
| E107 | TG-630 | 1100 | 14.0 | 0x6e485020 (9.7%) | plain | 0.25M | 233 | not tried (base) |

A port considers the 936 32-bit hex literals of the lab's ported sources (`emu/src` but `util`, `core` and `fw`);
"unmapped" counts the ones the lab uses that the map cannot place.

## What the survey shows

1. **One container and one CPU across 2012-2025.** All 32 `.BIN`s walk to their end and every block's checksum is 0;
   every main block starts with the same AM33 reset head (`fafcfff0 cbcb f8fefc fcff..`: `and 0xf0ff,psw; nop; nop;
   add -4,sp; calls ...`), the first 32 bytes equal up to the call displacements (X). `src/fw/olyfw.mjs` walked them
   all unchanged.
2. **Two MMIO families, split at TruePic X.** E143, E146 and E147 load the ISC at 0x97000000 and the VSC at 0x9bb80000
   (E143's board); every other body, back to the 2012 E-PL5, loads the ISC at 0x8fe00000 and the VSC at 0x9c000000
   (E144's board), and all but E100, E101, E106, E107, E108, E110, E111 and E112 also the OSD engine at 0x9c100000 (D:
   mov imm32 counts, fw-survey). The board E144 needed (kind-2 VSC, its interrupt controller, timers, SCPU offsets) is
   therefore the board of 29 bodies, not one; how far its register layouts carry is not checked (I).
3. **One run-time base per body, eleven in all.** 0x60021020 (E143's) for the E-M5 II, PEN-F, E-M10 II, E-M1 II,
   E-M1X, E-M5 III, E-M1 III, TG-7 and the OM bodies; 0x60020020 for the E-M10 IV and E-P7; 0x60400020 for the TG-5s,
   E-M10 III and E-PL9; one of 0x6daf1020, 0x6e465020, 0x6e485020, 0x7d971020, 0x7d991020, 0x7e0e1020, 0x7e101020,
   0x7e421020 for each of the other 14 (X). The lab once wrote 0x60021020 in about 13 places; it now reads each model's
   `image_base` (checked against the reset head's jump, `src/fw/facts.mjs` `imageBase`), and `src/fw/xmap.mjs` names
   E143's `COPY_BASE`.
4. **Compressed sections only on E139 and E144.** Their main blocks hold two olycompress sections each (about 11.5 MB
   raw in all) that `src/fw/expand.mjs` expands; every other body's image is stored as it runs (X).
5. **Resources: one index, two forms.** Every resource block starts with the same index of {address, size} pairs whose
   first entry is the block's header load address + 0x800 (D, all 32). Only E139, E143, E144, E146 and E147 store
   olycompress blobs; the others' blocks are plain. The lab's resource origin is index entry 0 minus the 0x7e0-byte
   index area, which serves both forms (`resources.mjs` `origin`).
6. **Code similarity to E143.** The OM-1 line (E146, E147) pairs over 5M instructions. E139, E134 and E144 pair
   2.0M-2.2M; E139 and E134 leave 44 and 46 addresses unplaced without any override, as many as E144 does with its 85.
   Then E137 1.7M, E140 / E142 1.45M, E125 1.3M, E145 1.1M, the 0x60400020 bodies about 1M, the other 0x60021020
   bodies (E118, E120, E122) 0.8M, and the 14 bodies at other bases 0.25M-0.88M (X).
7. **The first trials' stops became rules.** Every stop the first session trials hit was fixed by reading the firmware
   rather than per model: the mode dial (the UI_IN group records point into RAM the reset head fills, now preloaded
   from the reset head, `resetHead`, with the group count from the firmware's own search, `play.mjs` `uiin_layout`),
   the resource origin (plain blocks, item 5), the language table (the lab had subtracted E143's base), E143's
   ListMenu tab tables (a fact read by `listMenu`: present on E143, E146 and E147 only), the RTOS hook OlyTaWu and
   CPU 0's init task (`taWu`, `initTask`), errlog (`errlogEntry`: the callee after `mov imm32,d0` that tests the id's
   module, `lsr 24,Dn; cmp imm8,Dn`), the interrupt vectors' page (`vectorPage`: `0x6041xxxx` on the `0x60400020`
   bodies, `0x6003xxxx` elsewhere), the CHANGE task (`displayChangeTask`, by its start trace "[CHG] CHG MAIN S"), the
   touch panel (`touchI2c`, `touchOpen`, `touchDriver`, `touchArgs`), the GUI canvas and OSD banks (`guiCanvas`), the
   remaining-shots query (`shotsQuery`) and the DRAM size (`dramSize`). A rule change re-ports every body
   (`node emu/bin/port.mjs all`), and the rules already served bodies not yet run: on their re-ports they placed the
   shooting service's start on E125, E129, E132 and the E118 family and the function-direct start on E125, and
   corrected E125's AE init (X: the `PORTS` diffs).
8. **The per-body cost** (step 3 of the plan, X: the stop sequences recorded with the E134 and E137 ports). E134 met 12
   stops (init task, the GUI message take, the touch panel's I2C, the display task init, the EVF period word and vtotal
   getter, the display open's frame wait, its software-timer sleep, the dial select, H-G4SET, the AE init, the shooting
   service, a function entry paired one instruction late) and E137 10 (H-VECINIT, init task, the GUI message take, the
   EVF period word, H-G4SET, the touch mask, the function-direct start, the play component's wrappers, K-CRT-134D, the
   USB-disconnect power-off). Each took one session step of reading the firmware; 7 of each became rules or mechanisms
   that serve every body. The TG-7 (E145) and the E-M1 II (E125) cost the most: almost every stop a new rule.
9. **The starts were USB starts** (2026-10-23, multi-model step 7). On every E144-family body but E134, S1 and S2
   released nothing ("down without the shooting service"), because the application had ended its shooting service 91 ms
   after starting it (X, E144: startShootingService's trace load `0x50860ead`, then endShootingService's `0x50857390`
   from the shooting state's end `0x50d12bd6`). The cause is the idle image of S-KEYBITS, which set the switches' bits
   to 0 (but the monitor's and the dials') whatever their polarity. On E144 the USB connection `0x0400` (group 1,
   polarity 0) was then in state 0, a cable: the shooting service start publishes module event `0x02000400` for it
   (`0x5083a349`, called at `0x508f962a`, the state read by `0x5083a00d` through `0x5030620a(0x02020400)`), the
   application's module-event broker makes it event 8 (`0x50837bd2`), which E144's name table calls OLY_USB_CONNECTED
   (`0x60fcca58`) and CA_MAIN's translation table turns into `0x01060000` (`0x60fc8d20`, entry 262), and the shooting
   state takes it with the command PC_START_PC_USB_SELECT, which leaves shooting for the PC state (D; X, the
   application's trace calls `0x50d19e11`). The next event took the PC state's USB-disconnect handler (`0x50cf0da1`),
   whose power-off post S-NOPOWEROFF stepped over. E134 alone reads `0x0400` at polarity 1, so its bit 0 was state 1, no
   cable, and only E134 took S2 (X). E144's and E137's power lever `0x000c` has polarity 1, so it was off too: with no
   cable and the lever off E144's start powers off (the final loop `0x5004da5b`, X), with both in their other states it
   reaches shooting and S2 writes its card image (X). The idle image now sets these two switches by state on every
   ported body (`src/lab/play.mjs` IDLE_SWITCH_STATES: the lever on, no cable) but in the group of the HDMI report,
   which the firmware's group-4 producer pushes from its own image: on E146 and E147 `0x0400` is there, the SCPU port
   scan's, and the producer's next push undid the lab's level (X: their HDMI plug test), so the E143 family keeps
   state 0 as before. S-NOPOWEROFF is retired: no body's start reaches the post any more (X: E144, E139, E137, E142,
   E140, E125, E145, E130).
10. **The E144 family's EVF start** (2026-10-23). The EVF session stopped in the vsync wait at `0x501850f6` (E144):
   its first EVF open (DISPLAY cmd 2's first-open branch `0x501711da`) powers the TFT down first, which waits for a
   TFT frame (`0x501829f8(1)`), then powers the EVF up, writing the EVF's vertical total SYNC8 `0x380` (`0x500221e8(2)`,
   its timing writer `0x500231e5` picks SYNC2 or SYNC8 by the device, D), then creates the task DISPLAY_CHANGE
   (`0x501747fd`, X). The harness had moved channel 0 to the EVF's timing bank before the open, so the TFT's frame
   never came. The kind-2 channel now runs from the bank whose vertical total the firmware wrote last (I), at that
   bank's line time (`src/dev/vsc.mjs`); the change task's entry is read by a rule (`displayChangeEntry`, fact
   `display.change_entry`) and the kernel starts it natively; and the EVF's OSD planes are scaled (RSZ18/24/30 `0x11`
   with steps `0x9fc`), which the kind-2 compositor now samples as E143's OSD scaler (I, `src/dev/vsccompose2.mjs`).
   The EVF then shows its 1024 x 768 shooting screen on E144, E139, E137 and E125 (X: frames).

## Per-body status

The state as of 2026-10-23. Each body's `MODELS` entry (`src/fw/models.mjs`) carries the numbers its `port_via` choice
rests on and the evidence of every hand value. On that date `bin/modelcheck.mjs --no-port` passes E146, E147, E144,
E139, E137 and E125 on the TFT and the EVF (their `MODELS` entries are `checked`) and E134 on the TFT; E142, E140 and
E130 stop later than before (their paragraphs, X). The
S-PANELDONE stand-in answers three to five panel-flag waits in the starts of E139, E134, E125 and E130, which ran
natively before with the same results (X), so on those bodies it replaces a native path that worked, without a visible
effect (`ROADMAP.md` "Next stops").

**E146 (OM-1 II), E147 (OM-3).** `bin/modelcheck.mjs` passes on the TFT and the EVF: start, S1, S2 (a picture on the
card), PLAY, INFO, PLAY. Their TFT start keeps the composite's UNWRITTEN error. E147 shoots and plays back.

**E144 (OM-5).** Boots natively to its shooting screen (kernel, display open, settings store, camera application, GUI;
the kind-2 VSC compositor draws the OSD planes), takes S1, and the player settles running with the shooting screen in
its frame (X). Its start had taken the power-off branch of POWER_ON (event `0x0b000001`, `shutDown(1, 1)` from
`0x50d10693`): module 9 = 2 is its USB charge start, in which the GUI's POWER_ON handler calls the charge services
(`getChargeSource`, `getChargeState`, `startCharging`, `shutDown`) and shuts down without a charge source; with
module 9 = 1 the application's start gates `0x5083cb7d` and `0x5083cf66` need the UI_IN switch `0x0400` in state 1,
and even then it creates no GUI and powers off later (D/X). Those starts were USB starts: the idle image left the
power lever off and the USB connection `0x0400` at "cable in" (finding 9). With the lever on and no cable the start
reaches shooting without stepping over anything, and S-NOPOWEROFF (the call at `0x50cf0e21` stepped over) is retired
(X). Its hand override of the inter-CPU init `0x5002ce4d` is gone (the full re-port wrote `src/fw/ports.mjs` byte for
byte without it, and every running body's tft child was unchanged, X). `bin/modelcheck.mjs` passes on the TFT (S2's
card image, playback `0x608` SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE, INFO `0x60b`, back to `0x108`) and on the EVF, whose
start powers the TFT down, the EVF up and runs the DISPLAY_CHANGE task natively, and whose frame is the 1024 x 768
EVF shooting screen (finding 10, X). Open: IMG planes (live view, playback) are not modelled on the kind-2 VSC yet;
which register selects a kind-2 channel's timing bank is ?.

**E139 (E-M1 III).** Ported through E144 and boots natively to its shooting screen as E144 does; the TFT session stays
in `0x108` ID_ST_CA_REQ_DISP and takes S1 (UI_IN codes `0x2000100` down, `0x2010100` up), with the same events as E144's
(X). Its own `MODELS` values: one override (the joystick publish return, which E144, with no joystick, cannot carry) and
the state log's argument registers (`state_log_regs`: one argument fewer than E143's, D); E144's S-NOPOWEROFF went with
the idle image's switch states (finding 9). Its application reads a source state (the charge source, I) through a
measurement in 50 ms steps before it creates the GUI (D), which the lab runs in lab time (`MenuLab.gui_await`). E144
keeps the function-direct id in d3, not at (28,sp) as E143 does; `funcDirect` reads the id's place per body (d3 on E146,
E144, E137 and E125, (28,sp) on E147, E139 and E134, D). Open: the VSC name table (the direct map's vote kept) is
unchecked and the three carried vsync channel words are not checked against E139's ISR; still unplaced are the eye
callback, the colour-conversion end, `upload_af_info`, the GUI creation site and the HLS heap bounds (`port.json`
`carry_failed`); errlog `0x28001412` (the UI_IN forward finds no sink for startup key codes) is not checked on E144.
`bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23, X): S2's card image, playback and INFO as E144's; the
EVF start creates its change task (`display.change_entry` `0x50174f55`) and shows the scaled EVF screen.

**E134 (E-M1X).** Ported through E139 (the map from E139 pairs 8.12M instructions, the one from E144 5.88M, and
through E139 fewer overrides fail, X) and boots natively to its shooting screen; the TFT session stays in `0x108` and
takes S1, and its frame shows the shooting screen since the GUI canvas is read by a rule (X). Its own `MODELS` values:
three overrides (the display task init, which neither map places as a function; the EVF vtotal getter; the dial
init), the task its display task init starts (`extra_tasks`, a bare `retf`) and the shared g4set stand-in. Its AE init
has no step table (`aeInit` reads `table: false`, D), so H-AEINIT checks only its return value. Its start does not
reach the USB-disconnect power-off (X): its USB connection `0x0400` has polarity 1, so the old idle bit 0 already
read as no cable (finding 9), and it took S2 before the other bodies did. `bin/modelcheck.mjs` passes on the TFT
(2026-10-23, X). Its EVF start runs the first open's power-up and the change task (`display.change_entry`
`0x5021007a`), then stops in the lab's synchronous send: after the change task the open sends cmd 5 to queue 151 (the
id word `0x60041972`, from `0x50210cc4`), whose receiver does not run in the lab and which no stand-in serves (X);
which task reads that queue is not read. Open: what S1 runs beyond the GUI state is not checked; the lab reads the
touch I2C hooks' arguments in E143's layout, where E134's length is the caller's (4,sp) (D), so the i2c records are
not trustworthy on ported bodies.

**E137 (E-M5 III).** Ported through E144 (E144's board traits, no SCPU backup, font limit `0x9fc00` and E144's EVF
code, D) and boots natively to its shooting screen; the TFT session stays in `0x108` and takes S1 (X). It has no hand
override; besides `port_via` its only `MODELS` value is the shared stand-in g4set (S-NOPOWEROFF, at the post
`usbPowerOff` finds at `0x50c3ef76` with event 7 where E144 posts 8, D, went with finding 9; its power lever has E144's
polarity 1). K-CRT-134D, which its operating-time count calls
(`0x5004d531`), returns the board's SCPU clock word (`0x98` on the E144 family, D). Two causes kept its TFT frame one
colour: the GUI canvas (896 x 600, four records per kind, D), and the display sync. Its GUI asks for the sync at the
start (`guiUtility::setDispSync`, API `0x1012d`, X), and while the sync word is set its updates are requests of type 3,
which the display manager holds pending until an image sync for the device (D); the image sync's one caller is the
shooting sequence's stopRecView, which does not run in an idle session. `displaySync` reads the request, the image
sync and the sync-word setter (one of each on the 15 bodies outside the E118 family), and S-DISPSYNC releases a pending
device after the step (X: the shooting screen). The image sync it sends is of kind 1, not stopRecView's kind 2: the
display manager takes an event only in the block states its transition table admits (kind 1 in states 1 and 3, kind 2
in 2 and 4, kind 0 in 1 to 4; the table is the same on every body but E118 and E120, X), and the synced request leaves
state 3 (D). Its cmd-19 DISPLAY sends from `0x5016000b` (every 200 ms from about 5 s of idle) are S-DISPQ's, read by a
rule (`displaySends`). Open: when the camera releases the sync at the start (I: once its through image shows); the
touch write is still the direct map's wrong `0x50177137`; the operating-time count would write NAND natively once the
SCPU counter advances; the movie function id (90 on E137 where E143's `FUNC_RECORDING_MOVIE` is 27) is unknown.
`bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23, X; its change task `0x5016187e`).

**E142 (E-P7).** Ported through E144 (the map from E139 pairs more, 4.63M instructions against 3.47M, but E142 has
E144's board traits, D) and boots natively to its shooting screen: the TFT session takes S1 and draws the full E-P7
shooting screen (P, 1" F1.0, the exposure scale, S-IS ON, MONO 1, L F, 4K 30p), and the player settles running with
that picture (X). Its own `MODELS` value is the shared stand-in g4set (S-NOPOWEROFF, at `0x50cba3a5`, went with
finding 9). Its
other stops became rules or mechanisms: the touch panel's I2C through E144's port, the settings-DB init's and the
application's flash saves (`dbSave`, `appSaves`), the function-direct start by its shape (`funcDirect`), the PWM block
`0x9bc00000` (a stub page of the E144 family's board), S-IRQFIRST (an interrupt presented at a wait in a display run is
delivered before the wait, X; that the camera takes it so is I), the rec view component's standby (S-RVSTANDBY: with
RecView's state word at 0 the GUI drew only the rec view's items, X; that the component is in standby at power-on is
I) and the touch functions' length arguments (`touchArgs`: S-TPREG had written 6 bytes for a 1-byte read on the stack,
X). Since finding 9, S2 takes its card image (X). PLAY after S2 stays in shooting, and so does INFO (X,
`bin/modelcheck.mjs`; it has no EVF, so only the TFT is checked): the application takes the key's event, but its
ShootingStill state's procReady goes another way than before S2 (eight setting reads, no rec view query) and gives
no command for it, where before S2 the same press gives ShootingCommon's CAM_PLAY and playback opens (`0x605`
ID_ST_NO_PICTURE; X, the application's trace calls `0x50cdbc6a`). What the state still waits for after a release is
not read (I: a notification of the release's end that S-RELSEQ does not send on E142). Open: S-TPREG serves touch
data only for E143's controller (slave `0x70`, register 2),
where E142 polls slave `0x48`; its facts carry an EVF frame period word (`0x6222cd88`) from E144's, though the E-P7 has
no EVF (not checked).

**E140 (E-M10 IV).** Ported through E142 (the map from E142 pairs 6.56M instructions with 81 conflicts, the one from
E144 3.49M with 111; through E142 none of the 134 carried overrides fails, through E144 8 of 126, X) and boots natively
to its shooting screen: the TFT session takes S1 and draws the full E-M10 IV shooting screen, and the player settles
running with that picture (X). Its own `MODELS` values are the shared stand-ins. Its settings-DB init logs the
device-state code `0x24000615`: the device-state table is filled by its module's init in the boot (`0x5015384e`, D),
which the lab runs on no body, so a first read fills the slot and logs the code (D; the log is expected, `display.mjs`
EXPECTED_ERRLOG). Through E142, which has no EVF, three E143 addresses stay unplaced: the eye-state compare
`0x501e806c`, the eye-state setter `0x50050efd` and the YCbCr conversion `0x501db1c8`. Since finding 9 its S1 releases
(S-RELSEQ's START_FOCUS, END_FOCUS), and the AF frame's draw stops the session on the TFT and the EVF: the OSD engine
model meets a bitmap of format 9 (header word `0x0900d027`, BMP_FORMAT at the engine start, pc E140 `0x50b8e3e6`), which
it does not decode (it knows formats 2, 3, 10 and 11), and the next wait faults (X). Its EVF start, before that, runs
with the change task `0x5015713e` (X). Open: format 9; E140's eye state (its word `0xa2717360`, stored in another shape
than E144's, D).

**E125 (E-M1 II).** Ported through E134 (of E139, E144 and E134, through E134 the most overrides carry, 108, the fewest
fail, 7, and only there is the EVF vtotal function placed at its entry, D) and boots natively to its shooting screen;
the TFT session takes S1 and the player settles running with the shooting screen (P, 1", F1.0, S-IS AUTO, WB AUTO, LN)
in its frame (X). Its own `MODELS` values: the battery manager's thread (`extra_tasks`: OlyHfwBatteryManager's
thread_entry `0x5078d50b`, D; E143 has no battery manager), the DCF remain count's mount test (`dcf_mount_test` at
`0x505f49d0`: of 16 bodies scanned only E125's count lacks the mount-bit test, and S-CARD's card has no file system, X)
and the shared g4set (S-NOPOWEROFF went with finding 9). Every other stop became a rule: the CHANGE task by its start
trace, the EVF period setter's form (`framePeriod`), the hardware-timer table it indexes in place (`hwTimer`), the
display init's second part at the first DISPLAY OPEN (`displayInit2nd`, H-DISPINIT2), the C-runtime clock read
(`crtClockRead`), the searched dial table (`dialStore`), the encoder block `0x9bd00000`, UI_IN (`uiInTask`), the touch
task's start (`touchStart`), the frame display mode set (`frameModeSet`), the output-device property 4013 (`propDevice`,
S-PROP), the DISPLAY task's start-up calls (`displayStart`, S-DISPSTART) and the HighLevel init (`callContested`). Its
frame was one colour until S-DISPSYNC sent the kind-1 image sync (E137's status above): E125's GUI sends no further
ordinary update after the sync-word clear, where E137's, E142's and E140's do. Open: S-TAKEFRAME passes E143's AF-frames
bit 4, which the clamp form's set stores as mode 0 (`0x50021ea7`, D), while the AF upload acts in mode 3 only
(`0x50021f60`, D), on the whole E144 family; UI_IN's key dispatch `0x500ffa76` logs errlog `0x28001412` for each pushed
key, its callback word `(0xa2764448)` being 0 (D), with no effect checked. `bin/modelcheck.mjs` passes on the TFT and
the EVF (2026-10-23, X); its change task is the static one, run as on E143 (`display.change_task`).

**E145 (TG-7).** Ported through E142 (of E142, E140 and E144, only through E142 are the DB init and its flash-save
return placed). It runs the kernel, display start, settings store, camera application and GUI natively, but its start
ends in `0x0102` POWER_ON with a one-colour frame at 1440 x 480, and S1 stops at S-AFOSD: `call: the E143 address
0x500257ce has no place in E145's build` (X). The TG-7 differs in kind from the earlier bodies, and its stops became
rules or generic mechanisms: no touch-panel driver (`touchDriver`: no `tp_drv_` string, X), the display task init's
entry before a trace call (`displayTaskInit`), the DISPLAY task loop (`displayLoop`), the backup store's save mark
"BS." where the SCPU keeps no backup, its 9 calls of tsnd_dtq (`tsndSites`), a third form of the AE interpolation
(`aeRows`), a built-in lens (`lensMount`), OlyTaSS sleeps on the lab task in a harness call (S-LABSLEEP) and the
compass's IIC transfer, which waits without timeout for a completion the lab does not give (S-IICWAIT: the init prints
"COMPASS: I2C Error, Failed WHOAMI" and goes on, X). Before the output-device rule (`propDevice`), its start reached `0x108` with a blank
frame: its GUI dropped every redraw because the draw-through API `0x10301` failed (`0xf0000058`), the output device
it read through property 4013 being 0 while S-PROP answered only E143's 4513 (X). With 4013 answered as 1, as S-PROP
does now, the GUI stays in `0x0102`. Why the start stays in POWER_ON (X, the events the camera
application takes at its main loop's receive, E145 `0x50bf81f1`, E142 `0x50ca76f3`): E142 takes GUI_END_CHANGE_OUTPUT,
SUB_EVENT_END_CHANGE_DISPLAY and SUB_EVENT_END_CTRL_THROUGH (request `0xae`, GUI `0xf001` EVT_REQ_REC_DISP_INFO, which
enters `0x108`), and only then OLY_USB_CONNECTED (twice) and SUB_EVENT_START_SHOOTING_BOOT. E145 takes
GUI_END_CHANGE_OUTPUT, then OLY_USB_CONNECTED twice and START_SHOOTING_BOOT, then END_CHANGE_DISPLAY and
END_CTRL_THROUGH, which gives no request there, and CAM_SUBAPP_SERVICE_STOP gives request `0x86`, GUI `0x9625`. Both
store END_CHANGE_DISPLAY as the next event while they handle GUI_END_CHANGE_OUTPUT; E142's handler then sets the word
at +184 of the object it stores the event in (`0x50cabb09..0x50cabb1e`), E145's does not (`0x50bfa53b..0x50bfa559`, D);
that this word makes the main loop take the stored event ahead of the queue is I. With each OLY_USB_CONNECTED replaced
by event 0, END_CTRL_THROUGH gives request `0xf9` (GUI `0xe75a`) and the GUI enters `0x1103`, a state the lab does not
name (X). Who posts OLY_USB_CONNECTED is not known. Also open: why the TFT area is 1440 wide (AREA10 `0x2c05a0`, X); the
IIC controller and its interrupt are not modelled; the state block save (E144's `block_save` code, D) is not covered by
a rule. With finding 9 (no USB cable; its power key is a button, type 2, so the lever's state does not apply) its
start ends in `0x1103`, the state the event-0 trial above reached, and S1 still stops at S-AFOSD's unplaced AF upload
(X; that it no longer takes OLY_USB_CONNECTED is I, its events were not traced again); S-NOPOWEROFF is retired (its
post is not reached, X).

**E130 (E-M10 III).** Ported through E142 (the map from E142 pairs 2.11M instructions against 1.02M from E143; through
E142 118 overrides carry and 14 fail; through E145 the start stops earlier, at the settings store's unplaced init, X)
and boots natively to its shooting screen: the TFT session takes S1 and draws the E-M10 III shooting screen (P, 1", the
exposure scale, S-IS ON, the flash mark, Wi-Fi, L N, FHD 60p, the movie time 0:00:00 and 999 shots, S-CARD's answers),
and the player settles running with that picture (X). Its own `MODELS` values are the reference and the shared stand-in
g4set (S-NOPOWEROFF, at `0x50c2f598`, `mov 7,d0`, D, went with finding 9). Since then its S1 releases, and S-AFOSD's AF
upload stops it: `call: the E143 address 0x500257ce has no place in E130's build`, as on E145 (X; the E144-family
upload's shape, E142's `0x50025d21`, is not in E130's image, a byte scan). Its EVF start stops as E134's, at the
synchronous send to queue 150 cmd 5 after the change task (`0x50200556`), from `0x50201120` (X). Its board's DRAM is 512
MiB (with E143's 384 MiB its application start faulted in a copy to `0xbfc59440`, X); that the GUI's first OSD bank ends
at the DRAM's top is I. S-PANELDONE answers three panel-flag waits in its start (X); which waits these are is not read.
Open: S-AFOSD's AF upload and the EVF's synchronous send (above); which touch controller it polls is not checked against
S-TPREG's.

**E133 (E-PL9).** Ported through E142 (2.24M instructions paired, against 1.04M directly). It runs the kernel, the
display start, the touch start and the camera application's start, then stops in H-GUIBYAPP: the application's task
(62) waits inside the GUI creator (E133 `0x50c7b065`, E143 `0x5108bdc7`) on a synchronous call's reply (`0x506eb516`,
E143 `0x50ac5e4a`), and so does a task the creator started (150, entry `0x50c7ad48`). E130, nearly the same build,
passes there; what the reply waits for is not read (X).

**E129 (TG-5).** Ported through E145 (2.61M instructions paired, against 0.94M directly). The TG-5's panel driver (E129
`0x5015b466`) sends its command list over serial channel 2 with GPIO 117 around each send and waits on a completion
flag with no timeout (D); S-PANELDONE answers that wait in every display run on the E144 family's board (the port
places E143's EVF panel completion flag at the TG-5 panel's, X: 86 waits answered in the TFT open), so the TFT open
passes. A serial-channel model was not taken: the driver feeds a TX register byte by byte from its interrupt (E129
`0x5005094d`, the register block `0x9a200000`, D), whose IRQ and status bits are not read. It then stops in the
settings store's registry bootstrap (`menu.mjs` store_init, `0x50040aeb`): its flash read (E129 `0x5003ddcd`) polls
bit 0 of the boot-stage word `0xa2b4d2cc` with 2 ms sleeps, which the stage-1 step of the boot sets (`0x50022f51(1)`,
called at `0x5002282d`, D); the lab ends the init task before the boot runs it, so the bit is never set (X).

**E132 (TG-5).** Ported through E145 (2.68M instructions paired, against 0.94M). Its registry bootstrap has no such
wait (D). It stops in CamApp.start (`camapp.mjs`), every task blocked: the lab task requests serial channel 9 (E132
`0x5003fbaf`), whose grant callback `0x5003fd9a` ran and posted the send `0x5003fdb1` as a deferred call (a per-CPU
queue, then `0x5004be41(29, cpu)` and a write of 1 to `0x9b800030`, D), and waits 3000 ms for the flag `0x60421358`;
the deferred send never runs (X), and the lab models no interrupt the `0x9b800030` write would raise (the store
`fc 81 30 00 80 9b` is at two places on each of the nine E144-family bodies searched, X).

**E118 (E-M5 II), E122 (PEN-F), E120 (E-M10 II).** They stop at import on 18 board facts their family scaffold leaves
unread (`FAMILIES.E118`, `src/fw/board.mjs`: the interrupt controller's IPI, kick and control registers and its
OSD-engine, VSC and IPI lines, the timer's tick tables, the VSC, OSD engine and SCPU), and `src/dev/intc.mjs` reads
`intc.irq_osd_engine` at import (X). The family scan found none of E144's IPI / kick / control offsets on this
controller and no IE or status words in its timer records, so some of these are absent rather than unread: the family
needs a board port whose devices accept "no such register", not one more value.

## The chained port

A body with `port_via` is ported twice: from E143 as every body is, and from its reference through a second map seeded
with the reference's effective override targets and knob addresses, not the lab's literals. Each of the reference's
effective overrides (its own and those it carried, so a chain of two carries E144's to E134) is carried through that
map to the body (`src/fw/place.mjs` `carryOverrides`): an address the leg places by code (or the snapped entry,
`code-entry`), calls, votes or an alignment is taken, a table slot or a section delta only where the direct map
agrees, and a null unless a fact (`kernel.cpus`, `scpu.backup`, ...) differs between the two builds, where the direct
map answers. The knobs the body lists in `carry` (`cflush_returns`, `block_save`) are carried and checked call by call
(`src/fw/knobs.mjs`). Then a lab literal the direct map leaves unplaced and nothing carried answers takes the
reference's own direct-map answer through the leg (`fillUnplaced`), so an address the reference places only through its
own map needs no hand copy per body. A rule's answer (`rulePlaces`, `placedRulePlaces`) wins over a carried one, and
`port.json` lists the overrides a rule places as it lists those the map places, what was carried, what failed
(`carry_failed`), the nulls a fact gated and what was filled. Through their references, of the overrides the lab uses,
103 carried on E139 (9 failed, 13 nulls gated), 100 on E134 (10 failed) and 114 on E137 (12 failed) (X, 2026-10-20).
The choice of reference is a hand field with its numbers as evidence (each candidate's leg map costs about a minute
to build). A change to the reference's effective overrides or knobs rebuilds the leg map; a lab change does not, but
the direct map's cache key holds the lab literals in their order of first occurrence, so a change to `src/lab` that
reorders them rebuilds every direct map (`bin/port.mjs` `cachedMap`).

`node emu/bin/port.mjs all` refreshes every body in one process: 52 s for the 17 bodies with every map from the cache,
119 s as one run per body (X, 2026-10-20). The placement had dominated, not the rules: the content search's
byte-by-byte scan of the whole image (`src/fw/place.mjs` `contentPlace`, 18 of E125's 33 s, X, a CPU profile); the rules
take about 1.1 s per body. Under heavy load the full re-port after E144's inter-CPU override was dropped took 4 min
34 s, eleven leg maps rebuilt.

## Not covered

The new OM System PEN (expected as E148) is not on the update server. Lens and accessory firmware are out of scope.
Besides E143, E146 and E147, eight bodies pass the player with a picture (the shooting screen in their frame, S1 taken,
the player settled running): E144, E139, E134, E137, E142, E140, E125 and E130. E145 reaches its POWER_ON state with a
one-colour frame after the whole start natively (kernel, display start, settings store, camera application, GUI); E133
and E132 run to the camera application's start and E129 into the settings store; the E118 family runs no firmware code
in the lab yet, so nothing above says how far it boots. The next steps are in `ROADMAP.md` "Multi-model".
