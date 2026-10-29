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
| E143 | OM-1 | 1900 | 32.0 | 0x60021020 (7.5%) | olycompress | - | - | the lab's build; its card a real FAT32 card since finding 19 |
| E146 | OM-1 II | 1300 | 32.0 | 0x60021020 (7.6%) | olycompress | 5.55M | 3 | modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E147 | OM-3 | 1100 | 32.0 | 0x60021020 (7.5%) | olycompress | 5.25M | 5 | modelcheck passes (since finding 18 with the count probe) |
| E144 | OM-5 | 1200 | 23.7, 2 sections | 0x60021020 (6.6%) | olycompress | 2.15M | 45 | modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E139 | E-M1 III | 1600 | 26.0, 2 sections | 0x60021020 (6.6%) | olycompress | 2.08M | 44 | through E144: modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E134 | E-M1X | 2400 | 26.0 | 0x60021020 (6.5%) | plain | 2.03M | 46 | through E139: modelcheck passes (TFT and EVF; the touch task's send, finding 11; the count probe since finding 18) |
| E137 | E-M5 III | 1700 | 23.9 | 0x60021020 (6.7%) | plain | 1.71M | 68 | through E144: modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E142 | E-P7 | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.47M | 74 | through E144: modelcheck passes (no EVF; the callback ids, finding 12; the shots query and the count probe, findings 15 and 16) |
| E140 | E-M10 IV | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.44M | 77 | through E142: modelcheck passes (TFT and EVF; format 9 and the lens record, finding 13; findings 15 and 16) |
| E125 | E-M1 II | 3700 | 22.0 | 0x60021020 (7.1%) | plain | 1.29M | 71 | through E134: modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E145 | TG-7 | 1103 | 19.5 | 0x60021020 (7.5%) | plain | 1.10M | 81 | through E142: modelcheck passes (TFT, the card native, the count probe; MENU answers its date and time setting at the start, finding 22) |
| E133 | E-PL9 | 1101 | 25.0 | 0x60400020 (7.2%) | plain | 1.04M | 83 | through E142: modelcheck passes (TFT, no EVF; the count probe and its card native) since UI_IN's boot key is the power switch's (finding 20); before, its start went to the battery insertion's boot service, which creates no GUI |
| E130 | E-M10 III | 1200 | 25.0 | 0x60400020 (6.9%) | plain | 1.02M | 82 | through E142: modelcheck passes (TFT and EVF; findings 11, 14 and 16) |
| E129 | TG-5 | 1101 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: kernel, display start, settings store (since S-BOOTSTAGE, finding 20) and the camera application's start, which waits for the internal charger's transfer on serial channel 9 as E132's: `all tasks blocked (lab task 153 state WAI)` |
| E132 | TG-5 (KOUICHIRO) | 1300 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: kernel, display start, settings store and the camera application's start, whose charger request on serial channel 9 runs its deferred send (IRQ 29, finding 21) and then waits for the transfer's completion, which the lab does not model: `all tasks blocked (lab task 155 state WAI)` |
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
11. **The touch task's synchronous command** (2026-10-23, step 7 round 2). E134's and E130's first EVF open sends cmd 5
   synchronously to queue 151 (E134, from `0x50210cc4`; E130 queue 150 from `0x50201120`) after its change task. The
   receiver is the touch task (E134 `0x50217e3f`, the port's place of E143's `0x501e3eac`): its loop waits on its event
   flag (`0x60041710`, mask 9), receives from the queue when bit 8 is set (`0x60041972`, at `0x50217eb2`), runs the
   command through a jump table (`0x602424f4`; cmd 5 traces "TP_SETUP_SELFRUN_START" and runs the touch panel's
   power-up sequence, `0x5017c100`) and replies only where the message's word 0 names a reply queue (`0x50217fd8`, D).
   E143's touch task has the same loop (flag `0x6004306c`, queue `0x600432e8`, bit 8, D). E137 runs the same sequence
   inline in its display task (`0x501625d7..`, D), so it never met the send. The rule `touchQueue` (fact `touch_task`)
   reads the flag, the queue and the bit on the twelve bodies with a touch task (bit 8 on all, X) and places E143's
   touch flag word, which the maps had put beside the task's own flag on E125, E130 and E133 (X); S-TPSEND
   (`src/lab/play.mjs`) runs the touch task's loop for a synchronous send from a display run, as a DISPLAY send runs
   the DISPLAY loop, with word 0 at 0. The power-up's 40 ms wait for the touch panel's interrupt times out
   ("TP_DRV_INT_WAIT TIME_OUT"); before the play bring-up sets the lab microsecond clock it takes 40,001 lab sleeps of
   2 ms, as E137's inline copy of it does at its starts (150,001 on the TFT, X; why the counter advances one per read
   then is not read). The camera application's own synchronous requests to the touch task (E143's cmd 8 through its API
   sender `0x503ec110`) stay S-MODACK's: run through the touch task too, they changed 26 golden sessions (X).
12. **The shooting callbacks' ids are per build** (2026-10-23). E142's PLAY after S2 stayed in shooting because its
   still state stayed in `0x5101` after a release, where E143's returns to `0x5100` at END_SHOOTING_PICTURE, so the
   state's procReady found no key to take (X: the state word at the state machine's store, E142 `0x50cd3053`, E143
   `0x5107e614`). S-RELSEQ posted E143's CBS ids, and E142 numbers CBS_END_SHOOTING_PICTURE 369 in its CBS name table
   (`0x60a6c7f4`), where E143 has 211; E142's callback handler (`0x50cd6b5a`) looks the id up in a hashed table that
   holds no 211 and posted nothing (D). E140 and E133 number it 369 too; every other name S-RELSEQ posts has E143's id
   on all 18 expanded images (X). The rule `cbsIds` (fact `cbs`) reads each name's id. Next, E142's playback set
   variable 226 with 2 bytes, which the menu record observer refused: 226 is E143's menu viewer record (2428 bytes,
   one site, D) and another variable on every other body read (2 bytes on E142 and E140, 382 on E144, 152 on E146,
   D), so the observer runs on E143 alone.
13. **The OSD bitmap format 9 and the lens record** (2026-10-23). E140's S1 drew its AF frame with bitmaps of format 9,
   which the engine model refused. Read from the data: in E140's resource block 7419 places with format 9 decode as
   8-bit tokens of a 2-bit colour index over a 6-bit run to exactly width x lines, 7379 of them up to the next bitmap's
   header (X, a byte scan); the E144 family's blocks hold 4300-7700 each, the E143 family's none (X); E140's AF frame
   draws them with the inline table [0, 0x21, 0x20, 0x1f] (D). None is wider than 32 or has a run over 32, so that bit
   5 is the run's is I. With the format the next stop was a division by zero in the focal-length interpolation
   (`0x500d96d1`): S-LENS had written the 12-40's zoom steps at E143's offset in E143's buffer. The E144 family keeps
   the record's zoom table at +1156 (E143 +1164; E130 and E133 +644, D at each port's place of E143's focal-length read,
   rule `lensZoomTable`), and its lens driver's init points the record at a static buffer of its own (E140
   `0xa2682d00`, from `0x501d2284`, rule `lensStatic`; ten E144-family and three E118-family bodies, none of the E143
   family, X), which the lab does not run; at E143's buffer the bytes on E140 held a nonzero flag (+35366) that sent
   the interpolation down the dividing path (X). Fact `lens_record` gives both.
14. **E130's AF upload and E145's frame plane** (2026-10-23). E130's AF upload is `0x50022dd8` (a hand override): its
   one caller `0x50605bc1` passes `mov 3,d0`, the count and the frames as E142's caller `0x5063ef07` passes them to
   E142's `0x50025d21`, and its body is E142's without the first call (D). E145's frame plane has the mode set
   (`0x5002264b`, modes 0 to 3) and two uploads, mode 1's (`0x500226e9`) and mode 2's (`0x5002272c`, five halfwords,
   four callers), but no function of the AF upload's shape (mode 3, a frame count and frames, D); which of them carries
   the TG-7's AF frame is not read.
15. **The remaining-shots query is the one getAvailableShootCount makes** (2026-10-23, step 7 round 3). E142 and E140
   showed "Card Full" from the start on because S-CARD answered nothing in their sessions (X: a count of S-CARD's
   hook calls), so their count was the count function's own, 0, on a card with no file system (I). The application
   asks for the count in `OlyHfwOpeShoot::getAvailableShootCount` (E143 `0x50ad893e`, which the handler of the HLS API
   `0x20116`, `0x50b5025f`, calls), and the GUI's card-full test reads the API (E143 `0x51055c38`, E130 `0x50c26f65`:
   1 where the count is 0, D). The method's callee is the query proper on the E143 family, E144, E139, E134, E137 and
   E125 (E143 `0x50419164`, called at `0x50ad89d6` and `0x50ad8a51`) and module `0x2800c`'s three-argument wrapper of
   the count on E142, E140 and E145 (E142 `0x502c79db` from `0x5076b263`, E140 `0x502d63a0`, E145 `0x502ceb73`) and on
   E133, E130, E129 and E132 (D). The rule had placed the callee of a store under a lock in a component whose init
   message is sent amid the Wi-Fi manager's app-protocol sequence (E143 `0x517fdb32`, storing to `0xa320c08c`; the
   init's sender is called at `0x517ecc22`, D); no session runs it (X), and on E142, E140 and E145 it calls the query
   proper (E142 `0x502d2e89`), which their application does not. The rule `shotsQuery` now reads the method (between
   its start and end traces, the callee whose result it stores with `movhu d0,(An)`, but for its settings read): the
   same place on 15 of the 18 images, E142's, E140's and E145's moved (X). S-CARD then answers E142 27 times, E140 27
   and E145 10 in a session, and E142 and E140 show 999 shots (X: frames). Where the method's gate holds (setting 477
   is 1 and 484 is not 0 on E143) it takes a kept count from setting 1436 instead of the query (D); no session took
   that branch (X). "E134's session makes no shots query" (round 2) was read from the camera application's log, which
   each step drains: S-CARD's hook counts 4 calls in E134's TFT and EVF sessions (X).
16. **The count probe** (2026-10-23). `bin/modelcheck.mjs` now checks after S1 that the screen draws S-CARD's count:
   three windows of six frames 300 ms apart at 999, 777 and 999 again; pixels that hold one value through the first
   window and another through the second must exist and be back through the third (pixels that change within a window
   are left out: E146's ISO item blinks from about 2.4 s after S1 on, X). It fails E142 and E140 before finding 15 and
   passes them after it, and passes E130; the count is at 660,448-710,473 on the 720 x 480 TFT and 929,718-1010,759 on
   the EVF (X). Until finding 18 it failed E143, E146, E147, E144, E139, E134, E137 and E125 on the TFT and the EVF:
   their screens did not follow S-CARD's count (the EVF shows an orange 0, the TFT no count; identical frames at 999 and
   777, X), though their application's method is answered. Only the E142 lineage's GUI has a count item that asks the
   API (E142 `0x50e1af20`, through API slot 36, storing the count at +8 of the item; the store's byte form occurs once
   on each of E142, E140 and E130 and on none of E143, E144 and E134, X). Ruled out on E143 (X): the API's GUI clients
   in a session are the card-full test and a buffer-count builder (`0x511f82a0`, which gets 999); the slot-in-media
   count (API slot 752, `getRemainCountInMediaSlot`, handler `0x50b54505`, which calls the count function directly) is
   called from none of its 26 GUI sites; 555 forced from the buffer count `0x504169b2` and 777 written to the Wi-Fi
   component's word `0xa320c08c` leave the EVF's 0 as it was. The cause is the card's detect state (finding 18).
17. **E145's start ends in its date and time setting** (2026-10-23). The frame of `0x1103` is the TG-7's date and time
   entry (Y, M, D and Time all "--", "Cancel" at the foot, X); MENU, the screen's Cancel, takes it to `0x108`
   ID_ST_CA_REQ_DISP with the clock warning E143 shows at its start (X). `0x1103` is the third state of E145's SS_MENU
   (`0x11`), which its state table lists without it, where E143's SS_MENU (`0xb`) lists `0xb03` ID_ST_INITIAL_SETTINGS
   (D), so the TG-7 opens its initial settings at power-on with the clock unset, where E143 warns (I). The lab names
   only the state table's first 12 parents (E143's count, `menu.mjs` state_names); the firmware's lookup bounds it at
   12 on E143 (`cmp 12,d3` at `0x5124b478`) and at 18 on E145 (`0x50de87bf`), whose 18 include SS_MENU (D), so the
   SS_MENU states of E145 and E142 print unnamed. After MENU, S1 stops at S-AFOSD as before (finding 14).
18. **The card is in the slot's detect state** (2026-10-23). E143's shooting-screen count updater (`0x511ff915`, one
   of the GUI's per-refresh items, run 9 times in a session, X) returns before it asks for the slot's count
   (getRemainCountInMediaSlot, API slot 752) where `0x5120054d` gives 0 (X): that gate takes the media control's
   getExistMedia (`0xa`, both slots, X) and, for each, getMediaStateInfo's field +4 (D), which the HLS media layer
   (`0x50ac95fa`) sets from the file layer's drive status bit `0x80` (D); the drive status was `0x600` for both drives
   (X). The drive status (`0x508a8327`) sets bit `0x80` where `0x5087bc22` finds the drive's halfword in the card
   driver's detect table (`0xa33af3d4` + 2 x drive) at 2 or 3 (D); the driver's init writes 1 to every drive
   (`0x5087bc5e`) and its insertion handler 2 where it finds 1 (`0x5087bd4c`, D); which event runs the handler is not
   read. S-CARD sets drive 0 to 2 before the application starts, read per build by the rule `cardDetect` (fact
   `card.detect`: the test has the same form on all 18 images, its drive bound 2 on E143, E146, E139, E134 and E125, the
   bodies with two slots, 1 on the other 13, X). With it E143's TFT top bar shows the first slot and `999` (`998` after
   S2) and its EVF the same at the bottom right, where an orange 0 stood, and the count probe passes on every body of
   the default set, the E143 and E144 families included (X: frames; modelcheck). E144's and E125's screens also show the
   slot icon and, newly drawn, an orange movie time `0:00:00` (the blank store's movie mode, which these bodies cannot
   record: `docs/hle-gaps.md` 4.8.5).
   Forcing the drive status to `0x680` had given the same screen (X). The golden sessions that show the shooting screen
   record the count; every compose that changed differs from the one before only in the count's box (X).
19. **E143's card is a real one** (2026-10-23, `docs/hle-gaps.md` 4.8.2). On the lab's build the file system runs
   natively on an SDHC card at the SD command layer, which the firmware formats (FAT32) and mounts itself; the card
   driver's detect state now comes from the DCF process's card-in (3 after its lists, X) and S-CARD's count and movie
   time answers are retired there: E143's TFT top bar shows `803` and `[05:25]` on the 8 GiB card (X: frames). The
   seam's addresses are E143's hand facts (`src/fw/models.mjs` storage), not rules: the other bodies keep S-CARD's card
   without a file system, so the E142 lineage's and the E144 family's orange `0:00:00` stays (ROADMAP Next stops).
   `bin/modelcheck.mjs` still excludes E143 from its default set; its count probe sets S-CARD's count, which E143 no
   longer asks.
20. **The boot's state the lab's start left unset** (2026-10-29). Two words the boot sets before the application,
   which the lab's start never set, read by a rule on each body (`src/fw/facts.mjs` bootState: one stage test and one
   boot key store on each of the 15 expanded images but the E118 family's, X). UI_IN's boot key, the code of the key
   that started the camera, which UI_IN's module init takes from the sub-CPU's wake factor and its key table (E143
   `0x5014e3ab`, word `0xa32dab30`; E133 `0x500f5d85` from `0x500f41fe`, word `0xa2ae718c`, D), and the stages' ready
   word, in which the boot's stage step marks each stage of the run-time image (E129 `0x50022f51(n)` sets bit n-1 of
   `0xa2b4d2cc` once the loader `0x50022ec0` has marked the stage read; E143's per-segment step `0x50024eda` sets bit
   n-1 of `0xa32df1f4`, `docs/om1-cores-spec.md` 3.6, D). E133's camera application judges its boot service from the
   wake-up issue (`0x50c5b440` <- `0x5071c204`): with the key and the second factor 0 the issue is 4,
   API_WUI_INSERT_BATTERY (`0x5071c46d`), whose service (8) creates no GUI; the key 0x000C, the power switch's code,
   gives 1, API_WUI_POWER_BUTTON (`0x5071c3b7..c7`, D). E130's issue maps 4 to 1 while module 9 is in state 2
   (`0x5072bd5e..7b`, D; its first issue 1, X), a step on E134, E137, E142, E140, E125, E129, E132 and E145, not on
   E143, E146, E147, E144, E139 and E133 (X, a byte scan): E133 was the one body it stopped. S-BOOTKEY sets the key
   before UI_IN starts, S-BOOTSTAGE stage 1's bit before the store's start; UI_IN's init itself stops at the SCPU
   window's offset 4, which the family's board does not model (X, a trial). With both: E133 passes modelcheck, E129's
   store starts, E143's frames of start, S1, S2 and PLAY are as before, and the ten other bodies' modelcheck output is
   the same line for line (X).
21. **The deferred calls on the E144 family** (2026-10-29, `docs/hle-gaps.md` 4.4.2). The family's deferred calls
   interrupt their core through IRQs 29..34, one trigger word each at `0x9b800030..0x9b800044` (E143's 53..58 at
   `0x9b880044..`): a post (E132 `0x5004a236`, E143 `0x500503d4`) puts the call on its core's ring, enables the IRQ
   for its core and writes 1 to the word; the init, which the boot head runs before the kernel (E132 `0x5004a115` from
   `0x500002ea`), clears the rings and words and attaches IRQs 29 and 30 on the three cores and 31..34 on its own (D;
   the init, words and IRQs on all 15 bodies but the E118 family's by `src/fw/facts.mjs` deferredCalls, X). The words
   lay in the lab-stub page `0x9b800000`, which kept a 1 and raised nothing. Of the starts, E144's, E142's, E130's and
   E133's post nothing (X: observers on every post's store over the play session), E132's posts its charger
   request's send. The board now has the triggers (src/dev/dpc.mjs) and H-DPCINIT runs the init at every play
   bring-up (E143's too); a post before the bring-up would be refused, and none of the eleven checked bodies' sessions
   makes one (X).
22. **E145 through modelcheck's path** (2026-10-29). Four stops, each read and fixed where it lies; E145 is in
   `bin/modelcheck.mjs`'s default set (`MODELS` `checked`) with its card native.
   - *The date prompt.* The start ends in `0x1103`, the TG-7's date and time setting on the unset clock (finding
     17); MENU (the screen's Cancel) and S1 both leave it, for `0x108` and the clock warning, which S1 clears to the
     shooting screen as on the other bodies (X: frames). modelcheck takes MENU after the start for E145 (its
     `START_PROMPT`, strict: a start that ends elsewhere fails). A set clock was the other way: it would drop the
     prompt by putting a state in the camera that only a user's clock setting gives (S-NVRAM does that, opt-in), and
     on E143 it would drop the start's date prompt from every golden session; the prompt and its cancel are the
     firmware's own path on a camera whose clock was never set, so MENU it is.
   - *The AF upload.* On the clamp form of the frame plane (the E144 family) each upload after the mode set opens by
     reading the mode byte and comparing it with its mode: 1 (the place of E143's UP_FACE), 2 (five halfwords, the
     place of E143's UP_LOCKON `0x50025764`, whose four callers' places it shares) and 3 (the AF upload, a count and
     8-byte frames, E143's UP_AF `0x500257ce`) (D, `src/fw/facts.mjs` framePlane). E145 has modes 1 (`0x500226e9`) and
     2 (`0x5002272c`) and no mode 3 (D); its TAKE module does ask the set for mode 3 (`mov 3,d0` at `0x5026da0d`, D)
     and CPU 3's DISP_FRAME reads the mode-3 count and frames (`0xa213a860`, `0xa213a498`, at `0x50ae07ae` and
     `0x50ae07da`, D), but no code of the image stores to either address in either DRAM view (X, a byte scan); its AF
     is TAKE_FOCUS's (`take_focus_get_af_frame_rect`), with no FCS layer and no `osd:upload_af_info()` (X, a string
     scan). So S-AFOSD gives E145 no upload (fact `frame_plane`, its mode-3 upload null) and logs that; the TG-5s
     (E129, E132) have no mode 3 either. The rule's mode-3 upload is the port's place of UP_AF on all eleven clamp-form
     bodies (E144, E139, E134, E137, E142, E140, E125, E133, E130; E130's had been a hand override, now retired), and
     its mode 1 is the place of UP_FACE wherever that is placed (X: `test_facts` PLANE_FOUND, the port). The shooting
     screen shows the GUI's own AF target brackets (X: frames).
   - *The capture display's bitmaps.* S2's display draws two GUI bitmaps of OSD format 1 from DRAM (32 x 56, 32 x 32),
     which the engine model refused (BMP_FORMAT). Read as 4-bit tokens, low nibble first, a 2-bit colour over a
     2-bit run, both decode to exactly width x lines, ending at the descriptor that follows each, with no run across
     a row end (X; high nibble first, 12 runs cross one); `src/dev/engine.mjs` decodes format 1 so. The resource
     blocks hold 303 places on E145 and 344 on E142 that decode so (X, a noisy byte scan: a format no bitmap has finds
     27).
   - *The application's deferral.* S2 then stopped in END_EXPOSE's settle (more than 400,000 stub calls; with more,
     the instruction limit): the GUI posts event 19 to the application (PostEventToCA `0x50debc86` from
     `0x50d939ad`, param 1), whose code `0x4000013` the state in force during the release answers by posting it to
     itself again (state table rows `0x50eae6c0` and `0x50eb1c60`: `0x4000013`, stay, action `0x50c06881`, which
     sets the state's next event to `0x4000013`, posted by the main loop at `0x50bf862f`, D), about 5,000 times in
     the settle (X). The state ends with END_SHOOTING_PICTURE (X: posted with END_EXPOSE, the loop ends at once).
     S-RELSEQ posted each callback and settled before the next, though END_EXPOSE and END_SHOOTING_PICTURE fall at
     the same lab time; it now posts the callbacks due at one lab time together and settles once
     (`src/lab/camapp.mjs` post_all), so the deferred event waits behind END_SHOOTING_PICTURE as it would on the
     camera, where the modules' notifications arrive while the application spins. On E143 this moves golden's `keys`
     session only: its steps after S2 come 83.4 ms of lab time (5 TFT frames) earlier, the composes unchanged but
     for their frame number and time (X; re-recorded).
   With these: start `0x1103`, MENU `0x108`, S1, S2 (one image), PLAY `0x608` SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE, INFO
   `0x60b` ID_ST_DISP_DETAIL, PLAY back to `0x108`; the count probe finds the count at 1289,447-1420,473; the blank
   8 GiB card formatted `OM SYSTEM`, 1362 shots and `0:37:22` from it, S2's file read back (X: modelcheck, frames).
   **Why the TFT area is 1440 wide.** The TG-7's video area is 1440 x 480 at (44, 21), and its three OSD planes are
   720-wide GUI canvases (stride 896) that the OSD resizer doubles horizontally (step `0x800`, half a source pixel
   per sample; X: the TFT channel's registers in a session). Its through-image size table holds E142's TFT rows
   with every width doubled (E142 `0x501c5fb0`: 640 x 480, 720 x 480, 720 x 404, ...; E145 `0x501e2bc8`: 1280 x 480,
   1440 x 480, 1440 x 404, ...; the EVF rows the same, D). So the display path runs at two samples per panel pixel
   and the frames' 1440 samples per line carry 720 pixels: they look stretched twice horizontally, and halving them
   gives the panel's picture (I). Why the panel takes two samples per pixel is not read (?).

## Per-body status

The state as of 2026-10-23. Each body's `MODELS` entry (`src/fw/models.mjs`) carries the numbers its `port_via` choice
rests on and the evidence of every hand value. On that date `bin/modelcheck.mjs --no-port` passes E146, E147, E144,
E139, E134, E137, E140, E125 and E130 on the TFT and the EVF and E142 (no EVF) on the TFT (their `MODELS` entries are
`checked`; E134, E142, E140 and E130 since the second round of step 7, findings 11 to 14, X), and since 2026-10-29
E133 on the TFT (finding 20, X). Since the third round
modelcheck also checks the screen's remaining-shots count after S1 (the count probe, finding 16): E142, E140 and E130
pass it, E142 and E140 since their shots query is placed where their application asks (finding 15; they had shown
"Card Full"); E146, E147, E144, E139, E134, E137 and E125 pass it since S-CARD's card is in the first slot's detect
state (finding 18), as E143 does: before, their screens did not follow S-CARD's count (the EVF an orange 0, the TFT no
count, X). The
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

**E134 (E-M1X).** Ported through E139 (the map from E139 pairs 8.12M instructions, the one from E144 5.88M, and through
E139 fewer overrides fail, X) and boots natively to its shooting screen; the TFT session stays in `0x108` and takes S1,
and its frame shows the shooting screen since the GUI canvas is read by a rule (X). Its own `MODELS` values: three
overrides (the display task init, which neither map places as a function; the EVF vtotal getter; the dial init), the
task its display task init starts (`extra_tasks`, a bare `retf`) and the shared g4set stand-in. Its AE init has no step
table (`aeInit` reads `table: false`, D), so H-AEINIT checks only its return value. Its start does not reach the
USB-disconnect power-off (X): its USB connection `0x0400` has polarity 1, so the old idle bit 0 already read as no cable
(finding 9), and it took S2 before the other bodies did. `bin/modelcheck.mjs` passes on the TFT (2026-10-23, X). Its EVF
start runs the first open's power-up and the change task (`display.change_entry` `0x5021007a`), then sends cmd 5
synchronously to the touch task's queue 151 (the id word `0x60041972`, from `0x50210cc4`), which S-TPSEND serves by
running the touch task's loop for it (finding 11); `bin/modelcheck.mjs` passes on the EVF too (X), its frame the 1024 x
768 EVF shooting screen with an orange 0 shots left, as E143's EVF, though S-CARD answered its application's query 4
times (findings 15 and 16, X); since finding 18 it shows the first slot and 999 shots (X). Open: what S1 runs beyond the
GUI state is not checked; the lab reads the touch I2C hooks' arguments in E143's layout, where E134's length is the
caller's (4,sp) (D), so the i2c records are not trustworthy on ported bodies.

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
shooting screen (P, 1" F1.0, the exposure scale, S-IS ON, MONO 1, L F, 4K 30p), and the player settles running with that
picture (X). Its own `MODELS` value is the shared stand-in g4set (S-NOPOWEROFF, at `0x50cba3a5`, went with finding 9).
Its other stops became rules or mechanisms: the touch panel's I2C through E144's port, the settings-DB init's and the
application's flash saves (`dbSave`, `appSaves`), the function-direct start by its shape (`funcDirect`), the PWM block
`0x9bc00000` (a stub page of the E144 family's board), S-IRQFIRST (an interrupt presented at a wait in a display run is
delivered before the wait, X; that the camera takes it so is I), the rec view component's standby (S-RVSTANDBY: with
RecView's state word at 0 the GUI drew only the rec view's items, X; that the component is in standby at power-on is I)
and the touch functions' length arguments (`touchArgs`: S-TPREG had written 6 bytes for a 1-byte read on the stack, X).
Since finding 9, S2 takes its card image (X). PLAY after S2 stayed in shooting: its still state waited in `0x5101` for
END_SHOOTING_PICTURE, which E142 numbers 369 (finding 12); with the ids read from its CBS table and the menu record
observer on E143 alone, `bin/modelcheck.mjs` passes (2026-10-23, X; it has no EVF, so only the TFT is checked). Its
screen showed "Card Full" from the start on; with its shots query placed at its application's (finding 15) it shows 999
shots and passes the count probe (X). Open: S-TPREG serves touch data only for E143's controller (slave `0x70`, register
2), where E142 polls slave `0x48`; its facts carry an EVF frame period word (`0x6222cd88`) from E144's, though the E-P7
has no EVF (not checked).

**E140 (E-M10 IV).** Ported through E142 (the map from E142 pairs 6.56M instructions with 81 conflicts, the one from
E144 3.49M with 111; through E142 none of the 134 carried overrides fails, through E144 8 of 126, X) and boots natively
to its shooting screen: the TFT session takes S1 and draws the full E-M10 IV shooting screen, and the player settles
running with that picture (X). Its own `MODELS` values are the shared stand-ins. Its settings-DB init logs the
device-state code `0x24000615`: the device-state table is filled by its module's init in the boot (`0x5015384e`, D),
which the lab runs on no body, so a first read fills the slot and logs the code (D; the log is expected, `display.mjs`
EXPECTED_ERRLOG). Through E142, which has no EVF, three E143 addresses stay unplaced: the eye-state compare
`0x501e806c`, the eye-state setter `0x50050efd` and the YCbCr conversion `0x501db1c8`. Since finding 9 its S1 releases
(S-RELSEQ's START_FOCUS, END_FOCUS), and the AF frame's draw met bitmaps of format 9 (header word `0x0900d027`), which
the engine model now decodes from the resources' data, and then the focal-length interpolation's division by zero, which
the lens record's zoom table and buffer read per build removed (finding 13); with E142's callback ids (finding 12)
`bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23, X; its EVF change task `0x5015713e`). Its screen showed
"Card Full" as E142's; since finding 15 it shows 999 shots on the TFT and the EVF and passes the count probe (X). Open:
E140's eye state (its word `0xa2717360`, stored in another shape than E144's, D).

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
post is not reached, X). Its frame plane has no function of the AF upload's shape (finding 14), so S-AFOSD has nothing
to call on it; what the TG-7 uploads its AF frame through is not read. `0x1103` is its date and time setting, which
MENU cancels to `0x108` (finding 17, X); S1 then stopped at S-AFOSD. Since 2026-10-29 (finding 22) S-AFOSD gives it no
upload (its frame plane has no mode 3, and nothing writes the mode-3 frames, D / X), S2's OSD format 1 is decoded and
S-RELSEQ posts same-time callbacks together, and `bin/modelcheck.mjs` passes on the TFT (MENU after the start), the
card's file system native and the count probe included (X).

**E130 (E-M10 III).** Ported through E142 (the map from E142 pairs 2.11M instructions against 1.02M from E143; through
E142 118 overrides carry and 14 fail; through E145 the start stops earlier, at the settings store's unplaced init, X)
and boots natively to its shooting screen: the TFT session takes S1 and draws the E-M10 III shooting screen (P, 1", the
exposure scale, S-IS ON, the flash mark, Wi-Fi, L N, FHD 60p, the movie time 0:00:00 and 999 shots, S-CARD's answers),
and the player settles running with that picture (X). Its own `MODELS` values are the reference and the shared stand-in
g4set (S-NOPOWEROFF, at `0x50c2f598`, `mov 7,d0`, D, went with finding 9), and the place of the AF upload,
`0x50022dd8` (finding 14). Since finding 9 its S1 releases; S-AFOSD's AF upload had no place (E142's bytes are not in
E130's image, a byte scan, X), and its EVF start sent cmd 5 to the touch task's queue 150 from `0x50201120` (finding
11). With both `bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23, X; the TFT frame the shooting screen with
999 shots). Its board's DRAM is 512
MiB (with E143's 384 MiB its application start faulted in a copy to `0xbfc59440`, X); that the GUI's first OSD bank ends
at the DRAM's top is I. S-PANELDONE answers three panel-flag waits in its start (X); which waits these are is not read.
Open: which touch controller it polls is not checked against S-TPREG's; its zoom table (+644) and lens buffer are the
rules', not checked against a lens attach.

**E133 (E-PL9).** Ported through E142 (2.24M instructions paired, against 1.04M directly). Since 2026-10-29
`bin/modelcheck.mjs` passes on the TFT (no EVF), the count probe and the card included (its card's file system native:
card 'NO NAME' formatted, 2018 shots, S2's file read back; playback `0x608`, INFO `0x60b`, X), and its `MODELS`
entry is `checked`; the shooting screen is the E-PL9's (P, S-IS ON, ISO-A 200, L N, FHD 60p, `0:37:23` and 2018 from
the card, X: frame). Before, its start ran the kernel, the display start, the touch start and the camera
application's start and stopped in H-GUIBYAPP with no GUI task. Root cause (finding 20, D/X): the application's
helper thread (task 149, entry `0x50c7ad48`, E143 `0x5108ba1b`) calls the GUI creator (`0x50c7af0c` from
`0x50c5acaf`) only when the boot service it judges (`0x50c5b440`) is not 8, 9 or 16, and it judged 8, the battery
insertion's service: the wake-up issue (`0x5071c204`) was 4, API_WUI_INSERT_BATTERY (`0x5071c46d`), because UI_IN's
boot key (`0xa2ae718c`) and the second factor (`0x62399284`) were 0. E130 gets 4 from the same inputs and maps it to
1, API_WUI_POWER_BUTTON, while module 9 is in state 2 (`0x5072bd5e..7b`; its first issue 1 and the creator called from
`0x50c2e971`, X); E133's issue has no such step (D). The waits the survey had read as a synchronous call's reply
(tasks 62 and 150 in `0x506eb4a7`, E143 `0x50ac5ddb`) are the threads' message receives, where E130's threads 62, 148
and 149 wait too once their start is done (X). S-BOOTKEY gives the boot key the power switch's code 0x000C, which
the issue maps to 1 (`0x5071c3b7..c7`, D). Open: the second factor's source; the E-PL9's power key code is taken from
the issue's own test, not from its key matrix.

**E129 (TG-5).** Ported through E145 (2.61M instructions paired, against 0.94M directly). The TG-5's panel driver (E129
`0x5015b466`) sends its command list over serial channel 2 with GPIO 117 around each send and waits on a completion
flag with no timeout (D); S-PANELDONE answers that wait in every display run on the E144 family's board (the port
places E143's EVF panel completion flag at the TG-5 panel's, X: 86 waits answered in the TFT open), so the TFT open
passes. A serial-channel model was not taken: the driver feeds a TX register byte by byte from its interrupt (E129
`0x5005094d`, the register block `0x9a200000`, D), whose IRQ and status bits are not read. It stopped in the
settings store's registry bootstrap (`menu.mjs` store_init, `0x50040aeb`): its flash read (E129 `0x5003ddcd`) polls
bit 0 of the stage word `0xa2b4d2cc` with 2 ms sleeps (`0x50022e49(1)`), which the stage step of the boot sets
(`0x50022f51(1)`, called at `0x5002282d`, D); the lab ends the init task before the boot runs it, so the bit was never
set (X). Since 2026-10-29 S-BOOTSTAGE sets it before the store's start (finding 20): the store, the play bring-up
(H-DPCINIT, H-PWRTASK, its task 11 at `0x500400df`) and the HighLevel create run, and the start stops where E132's
does, in the charger's transfer (the wait at `0x5003fc39`, every task blocked, X). The step's flash read (stage 1's
part read in `0xa2b4d2d0` by the loader `0x50022ec0`), its region set-up of the block `0x99700000` (not modelled) and
its hook list (empty for stage 1, `0x50173c78`) are not run (D).

**E132 (TG-5).** Ported through E145 (2.68M instructions paired, against 0.94M). Its registry bootstrap has no such
wait (D). It stopped in CamApp.start (`camapp.mjs`), every task blocked: the lab task requests serial channel 9 (E132
`0x5003fbaf`), whose grant callback `0x5003fd9a` ran and posted the send `0x5003fdb1` as a deferred call, and waits
3000 ms for the flag `0x60421358` (the wait at `0x5003fbf6`); the deferred send never ran (X). The deferred call
(finding 21, D): the post `0x5004a236` puts the call on its core's ring (`0x5004a34c`), enables IRQ 29 for that core
(`0x5004be41` -> `0x50035066`) and writes 1 to `0x9b800030`, a word of the lab-stub page `0x9b800000`, which kept it
and raised nothing (X); the deferred calls' init `0x5004a115` (boot head `0x500002ea`) attaches IRQ 29 and 30 on the
three cores and 31..34 on its own. Since 2026-10-29 the E144 family's board has the six triggers (`0x9b800030..44`,
IRQs 29..34) and H-DPCINIT runs the init at the bring-up: the send then runs in IRQ 29's handler at the next idle
point (X). The request is the internal charger's (`0x5003fa92`, reached from the HighLevel create through the
power module's `0x5003f8e2`, D): open channel 9, a write, a 3000 ms wait, a write with a read back, a 3000 ms wait,
close, and the byte read compared with the one written (`0x5003fc70..7e`, a mismatch to `0x5003fe6e(2)`, D);
the send's transfer layer (`0x5004b96e`, E143 `0x5005373f`; the write `0x5004ba70`, E143 `0x50053863`) divided by
zero in the channel's clock divisor (`0x50051c53`: 24 MHz over a rate of 0, X), because the channel's configuration
(channel 9, 400 kHz and the completion callbacks `0x5003fe46` / `0x5003fe5a` at `0xa2b1610c..`) is set by the charger
init `0x5003fa04`, which the power module's init `0x5003f48d` calls at the entry of the power task (11, `0x500400b7`)
that the boot starts (D). With H-PWRTASK starting that task (X: it then waits on its queue), the transfer starts on
PER_SIO channel 9 at its registers (the stub page `0x9a200000`), whose completion interrupt is not modelled, and the
request's 3000 ms wait is a harness call's, where no lab time passes: every task blocked (X). Next: the channel's
transfers and their completion, at the controller's registers or at the layer's transfer starts (E132 `0x500506cb`,
`0x500509be`, E143 `0x5005dc03`, `0x5005def6`; the completions `0x5004bb3a`, `0x5004bb6f` registered through
`0x50051145`), with the charger at the far end (its registers' behaviour is not known; a register file that keeps
what is written would pass the read-back, I). A trial, not landed (X): with the charger command answered 0 at its call
from `0x5003f931`, the start creates the GUI and ends in `0x10c` SS_COMMON/ID_ST_FOLDER_OMT_PROGRESS_BAR, a 960 x 480
frame with "Busy" and a bar; 8 s of idle there reach 300,000 stub calls in the panel driver (`0x5015b55f`); S1 stops
at S-AFOSD (`0x500257ce` has no place in E132's build, as on E145, finding 14).

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
Besides E143, E146 and E147, nine bodies pass the player with a picture (the shooting screen in their frame, S1 taken,
the player settled running): E144, E139, E134, E137, E142, E140, E125, E130 and, after MENU at its date and time
setting, E145 (finding 22). E133 passes modelcheck since 2026-10-29. E129
and E132 run to the camera application's start, where the internal charger's transfer waits; the E118 family runs no firmware code
in the lab yet, so nothing above says how far it boots. The next steps are in `ROADMAP.md` "Multi-model".
