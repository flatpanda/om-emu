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
| E134 | E-M1X | 2400 | 26.0 | 0x60021020 (6.5%) | plain | 2.03M | 46 | through E139: modelcheck passes (TFT and EVF; the touch task's send, finding 11; the count probe since finding 18; the card native since finding 23) |
| E137 | E-M5 III | 1700 | 23.9 | 0x60021020 (6.7%) | plain | 1.71M | 68 | through E144: modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E142 | E-P7 | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.47M | 74 | through E144: modelcheck passes (no EVF; the callback ids, finding 12; the shots query and the count probe, findings 15 and 16) |
| E140 | E-M10 IV | 1100 | 25.0 | 0x60020020 (7.2%) | plain | 1.44M | 77 | through E142: modelcheck passes (TFT and EVF; format 9 and the lens record, finding 13; findings 15 and 16) |
| E125 | E-M1 II | 3700 | 22.0 | 0x60021020 (7.1%) | plain | 1.29M | 71 | through E134: modelcheck passes (TFT and EVF; the count probe since finding 18) |
| E145 | TG-7 | 1103 | 19.5 | 0x60021020 (7.5%) | plain | 1.10M | 81 | through E142: modelcheck passes (TFT, the card native, the count probe; MENU answers its date and time setting at the start, finding 22) |
| E133 | E-PL9 | 1101 | 25.0 | 0x60400020 (7.2%) | plain | 1.04M | 83 | through E142: modelcheck passes (TFT, no EVF; the count probe and its card native) since UI_IN's boot key is the power switch's (finding 20); before, its start went to the battery insertion's boot service, which creates no GUI |
| E130 | E-M10 III | 1200 | 25.0 | 0x60400020 (6.9%) | plain | 1.02M | 82 | through E142: modelcheck passes (TFT and EVF; findings 11, 14 and 16) |
| E129 | TG-5 | 1101 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: modelcheck passes (TFT, no EVF; the card native, the count probe; MENU answers its date and time setting at the start) since the charger's transfers on serial channel 9 are served (S-SIOIIC, S-CHARGER, finding 24); its settings store since S-BOOTSTAGE (finding 20) |
| E132 | TG-5 (KOUICHIRO) | 1300 | 25.0 | 0x60400020 (7.1%) | plain | 0.94M | 93 | through E145: modelcheck passes (TFT, no EVF; the card native, the count probe; its date and time setting has no Cancel, the clock is set) since the charger's transfers are served and S-MODACK answers its industrial category and logger modules (finding 24); its deferred send since finding 21 |
| E118 | E-M5 II | 4100 | 20.4 | 0x60021020 (7.2%) | plain | 0.80M | 123 | through E122: the start runs natively past UI_IN and stops at the lab's `g4set`, which E122's entry gives and E118's not; the EVF faults earlier (findings 28, 32-34, 37) |
| E122 | PEN-F | 3101 | 20.4 | 0x60021020 (7.2%) | plain | 0.79M | 123 | through E130: the start runs natively to the shooting screen state `0x0108` (the GUI draws the clock warning; the composite is one colour) and stops at the first long timer or S1 in the movie time; the EVF after the application's start on a full queue (findings 28, 31, 35-37) |
| E120 | E-M10 II | 1400 | 20.4 | 0x60021020 (7.4%) | plain | 0.76M | 122 | through E122: as E118 on the TFT and the EVF (its EVF stops at `g4set` too), no per-frame wait in its device open (findings 28, 32-34, 37) |
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
23. **E134's card waits for its lamps' module** (2026-10-29, `docs/hle-gaps.md` 4.8.7). On a native card E134's
   S-RECFILE fopen never completed: FILECLBK blocked in a send with no timeout (`0x50030432(queue, -1)` at
   `0x5010c35f`) to the queue of the halfword `0x6004192e` (117), after 53 sends that nothing read (X, round 3). The
   queue is not UI_IN's, as recorded then: the sender is the lamp request `0x5010c328` ({lamp id, u16, word}, a
   44-byte message), whose queue the init `0x5010cb57` sets up, and the boot calls that init after its checkpoint
   "2_9" (`0x50180afd`), then starts task 41 (the halfword `0x600413fa`; its static row's entry `0x5010cbda`) and names
   it "UI_OUT" (D). E134's file layer asks UI_OUT for the card's access lamp around its accesses (`0x5066dea4`: lamp 6
   with 500 or 0; six call sites in the file layer, D; that lamp 6 is the access lamp and 500 a blink in ms is I),
   which E143's and E144's file layers do not (X). Nothing on E134 runs UI_OUT in the lab (X: its init and its task
   entry never reached), so every lamp request stayed in the queue until it was full. H-UIOUTSTART (`src/lab/play.mjs`,
   MODELS `ui_out`, E134 only) runs the init natively at the play bring-up, before the file system's, and starts the
   task, which then waits on the queue and takes each request natively (X: 72 lamp requests in a session to S2 and
   PLAY, all complete; the session made no stop in UI_OUT). E134's card is native since: the blank 8 GiB card formatted
   FAT32 `NO NAME` at 8192 with 32 KiB clusters, 826 shots, S2's file read back, on the TFT and the EVF; a blank
   64 GiB card exFAT, no label, at 32768 with 128 KiB clusters, 6,618 shots (X: `bin/modelcheck.mjs`, with and without
   `--card-size 64`). Its movie time from the card is 0, as on the E144 family: the blank store's mode 1 at 60 fps
   (X: the getters) and the rate check's logs `0x3a040001` and `0x39000105` (X; `docs/hle-gaps.md` 4.8.5).
24. **The TG-5s through modelcheck's path** (2026-10-29, `docs/hle-gaps.md` 4.7.5). Three stops, each read where it
   lies; E129 and E132 are in `bin/modelcheck.mjs`'s default set (`MODELS` `checked`), their cards native.
   - *The charger's transfers.* The start's charger request writes register 1 = 0xa2 and reads it back over PER_SIO's
     channel 9, an IIC channel at 400 kHz (address 0x1b), and waited 3000 ms for a completion no controller gave
     (finding 21 and the E132 status). S-SIOIIC (`src/lab/sio.mjs`) serves the serial controller driver's transfer
     and receive starts for the channels a body's devices sit on, the layers above them native (PER_SIO's channel
     API, its IIC layer, the driver's completion dispatch, the charger request); S-CHARGER (`src/lab/charger.mjs`)
     answers only what the request's code shows (registers 0..2 keep what is written, I). A rule reads the driver's
     parts on each body (`src/fw/facts.mjs` sioDriver, the 15 expanded images but the E118 family's, X). PER_SIO's
     channel map had never been set (its setter ends PER_SIO's channel init, a boot step the lab does not run): every
     channel's controller index was a byte of low memory, and the charger's transfer went to index 0 (X). H-SIOMAP
     runs the firmware's setter at the bring-up; the TG-5's channels 9, 2 and 3 then reach controllers 7, 2 and 3,
     whose register blocks are lab-stub pages (`src/fw/models.mjs` board stub_pages, D from the driver's register
     table). The earlier trial's 300,000 stub calls in the panel driver were its open loop retrying every 1 ms on an
     index another channel held (the open flag is the index's, D; which channel held it is not read); with the map
     set they are not seen (X).
   - *E129's card.* With S-CARD's card the start divides by zero in the file system's free-cluster count (the
     cluster size of the absent volume, `0x50546d48`, X); with the card's file system native (as E133's and E145's)
     the start ends in the date and time setting `0x1103`, the TG-7's, with Cancel on MENU (X: frames), so modelcheck
     answers it with MENU (`START_PROMPT`). Start, MENU `0x108`, S1, S2 (one image), PLAY `0x608`, INFO `0x60b`, PLAY
     `0x108`; the count probe at 845,447-946,473; the blank card formatted (FAT32 on 8 GiB, exFAT on 64), 2629 shots,
     S2's file read back (X: modelcheck).
   - *E132's "Busy".* The start ended in `0x10c`, a progress screen with "Busy": the industrial TG-5 (its quality
     items include CALS) asks isCategoryUpdate first in its error-factor check (`0x50be0796`, setErrorFactor, then
     date, card, lens and battery cover), and its check (OlyHfwOpeIndustrial::checkUpdateCategoryInfo) is true when
     its synchronous DISPLAY cmd 43 returns 0; DISPLAY's reply word for cmd 43 is 0 (D), so the start shows "Update
     folder Allocation"'s progress (error factor 22, display request 267) and updateCategoryInfo posts its request to
     CATEGORY_MAIN (queue 0xe6, target 38 of its API target table), a module task the lab does not run and E143's
     table has no counterpart of, so S-MODACK did not answer it and the screen stayed (X). E145 has the same check as
     a stub that returns 0 (D). `src/fw/models.mjs` modack_queues gives S-MODACK E132's CATEGORY_MAIN and
     LOGGER_MAIN (target 43, queue 0xdf; without its answer the session stops once the clock is set, the
     application's queue 6 full, X, why is ?). The start then ends in the date and time setting with Set and no
     Cancel (X: frames): modelcheck's prompt answer is UP and OK on each of the five fields (2017.01.01 00:00), the
     fifth OK setting the clock, then the path: S1, S2, PLAY, INFO, PLAY, the count probe at 845,448-946,473, the card
     as E129's (9999 shots) (X: modelcheck).
   - *Not changed:* the twelve bodies modelcheck checked before pass as before, with a 64 GiB card too (E144's
     expected stop), and E143's golden sessions are identical (X); no body but the TG-5s runs H-SIOMAP or S-SIOIIC,
     and the rule's facts are only read there. The TG-5s' frames have a teal background where the
     other bodies' are black, and their text is pink (X); whether that is the panel's palette or the lab's
     composition is not read (?). S1 shows the GUI's AF target brackets; S-AFOSD gives the TG-5s no upload (they
     have no mode-3 frame plane, finding 22).
25. **The native lens on E146 and E147** (2026-10-29, `docs/hle-gaps.md` 4.4.3). Their lens drivers are E143's but
   for the addresses of their variables and entry points, the debug log's line numbers and the order of a few
   instructions in one send (X: LENS_SSC, the edge unit's handler, the init chain, the power-on and detect paths and
   type 6's frame switch walked instruction by instruction from the map's places). A rule reads the addresses the lab's
   lens needs (`src/fw/facts.mjs` lensDriver, fact `lens_driver`: the boot's starts of LENS_MAIN and LENS_ASKDATA by
   their names, LENS_COMMAND by its receive, USTART_L's calls, the flags' accessors, the lens-ready byte and the lens
   caches' table), equal to E143's hand values on E143 and to a reading of each body's code on E146 and E147 (D,
   `test_facts`). The one difference that mattered was outside the driver: E147's lens lock pin switch LLPSW is bit 6
   of UI_IN group 1 byte 0 (E143's and E146's bit 4 of byte 1), so with E143's bit its lens never powered on; the lab
   now takes the bit from the body's UI_IN tables. Both bodies' starts send E143's 15 frames, and the driver's record
   then holds what S-LENS writes (X). The rule finds no such driver on the other 15 bodies: the E144 family's boot
   starts LENS_ASKDATA but not LENS_MAIN in E143's shape, and E142, E140, E133, E130 and the E118 family miss another
   of its shapes (X), so they keep S-LENS. modelcheck is unchanged on E146 and E147.

26. **The power-off across the OM-1 line** (2026-10-29, `docs/hle-gaps.md` 4.7.4). The power manager's start and the
   power-off are read by one rule (`src/fw/facts.mjs` powerOff, fact `power.off`) from shapes the three OM-1-line builds
   share: the boot starter's start of the task named PWR_MAIN, the SCPU window's last write (`mov 127,d0; mov
   d0,(0x98e0009c)`) and the 0x85 sender called right before it, the shell's "sdk api shutdown" with its usage text,
   startShutDown's flash save and the RAM log's NAND write. It finds them on E143, E146 and E147 and on none of the
   other 15 ported bodies (X). On E139 and E134, whose sub-CPU link the lab runs too (another lineage of PER_SCPU,
   `src/fw/models.mjs` scpu port_scan false), it finds no start of PWR_MAIN. E147's sequence sends no IO expander a
   command (D: `0x50045807`, `mov 40977,d0` for the setting and then `0x5004fba2` straight to the 0x85 sender), and its
   image holds no expander code (X: PER_IOEXP's names only in a name list no code loads), where E143's and E146's send
   the body expander 6 or 5 and the PBH grip's 5 or 4: that the OM-3 lacks them because it takes no grip is I (the
   expanders' roles are read from their names). E146 and E147 then run E143's power-off frame for frame (X:
   `test_scpu.mjs --session`).

27. **The property store's own init on every body** (2026-10-30, `docs/om1-settings-spec.md` section 2.2). E143's
   mode changes committed 0 into most settings because the store's module init, the fifth of the settings init chain
   the lab does not run, had not set the mode store's three pointer words. One rule reads that init on every build
   (`src/fw/facts.mjs` propStore, fact `prop_store`): three back-to-back `mov imm32,d0; call; mov a0,(abs32)` stores to
   consecutive words, then `mov imm16,d0; mov 0,a0; clr d1` (the cache switch's read of kind 3505 on every build), its
   entry 0x92 bytes before the run on all 18 unpacked bodies (X, a byte scan; E143 `0x503ee2d6`, E122 `0x502cf141`).
   The lab runs it at every body's store init (H-STOREINIT), and its three words are non-zero after it on each body
   `bin/modelcheck.mjs` starts. modelcheck is unchanged: 14 bodies ok, and at 64 GiB all ok but E144's known SDXC xfail.
   On E146 a play session stepping its dial (E143's ten positions) changes mode exactly as E143 does (the same
   settings change at each position, P marked C1 at C1; X); the other bodies' mode changes are not measured.

28. **The E118 family's board** (2026-10-30). The family's board facts were read from E122's code and checked on E118
   and E120 by the census of `fc xx imm32` loads (X; `src/fw/board.mjs` FAMILIES.E118 has every address):
   - the interrupt controller is E144's one step lower: presented +0x200 + 4 level (the level handlers index the handler
     table by its (irq + 1) x 4), the inter-CPU doorbell +0x308 / +0x30c, the kernel kick +0x310, K-INTC's +0x314 (D;
     the doorbell and kick as fishcu/oly_fw_analysis had them, `analysis/oly-fw-analysis/README.md` 2.1). The scaffold
     had looked for E144's +0x408.. and found none. IRQs: the doorbell 120, the OSD engine 109, the VSC 21 and 23 (D:
     their attaches and handlers);
   - the timer keeps E143's {ctl, reload, counter} records in ten channels, with one IE word +0x78 and one
     write-1-to-clear status word +0x7c for channels 1..8 and one IRQ each, 57 + n (D); the software-timer init starts
     no channel of its own (X), so the board gives no software tick (`timer.soft_tick` null);
   - the OSD engine and the SCPU interface are E144's forms (D: the engine's registers 0x00..0x50 and its command
     encoding, the SCPU init's register order); the SCPU's word array starts at +0x04;
   - the VSC is a kind of its own (`src/dev/vsc.mjs` kind 3): two channels of 0x2000, no name table in the image (X: no
     register name string), so its register file is the offsets the family's code names (the census, and the OSD scaler
     words its writers index, D), the vertical total in SYNC2's low 11 bits (I), latched copies of four registers at
     +0x1c00 (D for the reads, I that they are the latched values), plain storage from +0x600 (I); its compositor was
     not written then (COMPOSE answered FEATURE_UNOBSERVED; finding 36).
   Three rules learned the family's forms: the hardware-timer table of 8-byte entries (`hwTimer`), a constant vtotal
   function with no period getter after it (`framePeriod` null: no frame period the lab can read, so A-PERIOD assumes
   E143's TFT period), and no boot state words (`bootState`). E122 ports through E130 (113 unmapped through E125, 114
   through E130 with 122 of its overrides carried, 116 direct; through E142, E137, E144 and E140 the port stopped at the
   hardware-timer rule on a carried place, X) with its own overrides (`src/fw/overrides-E122.mjs`). Its start then met,
   in order (X): the level-0 slot and the inline IVARs (as E144's), the GUI's output-device property (id 4014), the
   touch I2C write, the vsync flags, the hardware-timer init, the software-timer init's empty pool (H-DRVINIT: the reset
   path's early driver inits, which the lab's start skips, set it up; they also configure the GIO pins and read the
   board id from three strap pins, which the stub reads 0: board byte 4), a display task the display init starts
   (`extra_tasks`), no disp_sync module, the frame period, a scaler register the census missed, the stub pages of the
   serial channels, the clock block, the pin mux and the encoder, the SCPU word array, the boot state, the dial init
   (its table by the board byte) and then UI_IN's forward, which E122 inlines at three sites of its post (D): the next
   stop. On the EVF the start stops earlier: after two more stub pages (0x99100000, 0x98a00000, which its open writes),
   at a synchronous send to queue 8 from the display code (returning to 0x502f6bbd), whose receiver the lab does not run
   (X). E118 and E120 port through E122 (170 and 173 of its overrides carried, X); their dial inits take a fixed table,
   and the leg map put four of their level handlers wrong, which the kernel's own table corrects (X); they stop at the
   GUI message take, which `guiTake` finds on neither (X).
35. **The E118 family's EVF is device code 6** (2026-10-30, `docs/om1-vsc-spec.md` section 12). E122's EVF start
   stopped at a synchronous send to queue 8, cmd 1, from the display code (`0x502f6ba0..0x502f6bb6`). Queue 8 is
   AUD_EXEC (its object-name record `0x51114fac`, E143's id too; the task AUD_MAIN, 97 here, 82 on E143), the message
   its function 36 with the argument 2, which AUD_EXEC's dispatch (`0x50ac4905..`, the table `0x60d719dc`) passes on
   through `0x50ac53cd` (D; to CPU 2 as E143's AUD_MAIN does, I); function 37 follows when the device is left
   (`0x502f6cf2`). The send is the display's own for the device codes 2 and 3 (the switch `0x502f6b13`), and the
   lab had asked for code 2: E122's DISPLAY OPEN takes a byte of two device codes, the main VSC's in the low nibble
   and the sub VSC's in the high one (`0x502f6af7`), and its name switch `0x502fbf76` calls them 1 TFT, 2 NTSC, 3 PAL,
   4 HDMI, 5 VF-2, 6 BI_EVF, 13 VF-3, the rest HDMI modes (D). With E143's EVF mask 2 the lab had opened the NTSC
   video output: the channel at 262 lines of 858 (`0x50302567`), the TV encoder block `0x99100000` and the control
   word `0x98a00000` written (`0x502fe38a`, `0x5030b87a`, called for codes 2 and 3 only, `0x503037a8..b3`), AREA22
   `0xb50280` (640 wide) and the AUD request, the TV's sound (I) (D, X: the dump). The output-device property's writer
   gives 8, the value the lab answers for the EVF, for code 6 (`0x5018494d` `cmp 6`, then 4014 = 8; 5 gives 4, else
   1, D), E143's for code 2 (`0x501e8ad4`): the rule `evfCode` (fact `prop.evf_code`) reads that compare on every
   body, 2 on the 15 bodies of the E143 and E144 families, 6 on E118, E120 and E122 (X), and the lab's OPEN sends it
   (`src/lab/display.mjs` DEVICE code). E122's EVF start now opens the built-in EVF (1024 x 768 at `{48, 38}`, 825
   lines, the 640 x 480 canvas scaled by 0x11 / 0x9fc / 0x9fc, the OSD level `0xb2`) and runs to the TFT's stop,
   UI_IN's forward (X), without the two stub pages finding 28 had added for the TV's blocks (removed from the board;
   X: the start without them); no stand-in was added. E118 and E120 have the same send (`0x502d0b7e`, `0x502c4544`) and the
   same writer (`cmp 6`, X); their starts stop before the open (finding 28).
36. **The kind-3 VSC's compositor** (2026-10-30, `docs/om1-vsc-spec.md` section 12, `src/dev/vsccompose2.mjs`).
   E122's display code writes kind 2's register forms at kind 2's offsets below 0x314 (D at the writers; X: its TFT
   and EVF opens leave E144's values in the area, background, stride and scaler words), so kind 2's compositor serves
   kind 3 with three differences: the palettes are three groups by palette id (OSD1 128 entries at `+0x800` / `+0xa00`
   by bit 16 of `0x1b8`, OSD2 32 at `+0x680`, OSD3 32 at `+0x600`; that plane q takes id q rests on the display
   record's osd word k being GUI layer k, I), the format words `0x1b0` / `0x1b4` hold E143's OSDFMT1 / OSDFMT2 values
   `0x111` / `0x11` where kind 2's mix word holds `0x111111`, and OSD2's and OSD3's pixels index 32 entries (a larger
   one is refused, PAL_FIELD). The EVF's OSD level `0xb2` (70 %, the writer `0x502f9408`) is drawn as full, as kind 2
   draws E144's EVF `0xcc` (what a level below `0x100` does is ?). At E122's stop the composite is the firmware's
   state: the TFT 720 x 480 at `{30, 8}` and the EVF 1024 x 768 at `{48, 38}`, both the open's background `0x80800b`
   (RGB 11, 11, 11) with no plane enabled (DMA7 0, DMA12..DMA14 never written; the open uploaded the palette groups
   from RAM still zero) (X: the composite's words, 345,600 and 786,432 of `0x80800b`). `test/test_vsc3.mjs` drives
   the device on E122's board without firmware (18 checks).

29. **UI_IN's forward and the DISPLAY loop's replies, read by shape** (2026-10-30). The lab records the codes UI_IN
   passes on where its post tests the sink word (E143's forward `0x5014c3eb`, called at three places of the post with
   the code in d0). E122 has no such function: its post `0x50178f5e` tests the sink inline at three places, `mov
   (sink),Dn; cmp 0,Dn; beq`, then loads the code into d0 for the module event post, from d2 at `0x5017919f` and from a2
   at `0x50179230` and `0x501792ba` (D). One rule (`src/fw/facts.mjs` uiInForward, fact `ui_in.forward`) reads the
   sites from the post's place and the sink word's: a callee of the post with the test near its entry is one site with
   the code in d0, an inline test is a site with the register its `mov Rx,d0` names. It gives the map's forward on all
   15 bodies the maps place it on, and three inline sites on each of E118, E120 and E122 (X); the play bring-up observes
   every site (`obs-uiin-fwd`). On E122 S1 forwards `0x02000100` and its release `0x02010100` (X). The DISPLAY loop's
   two replies to a request's sender (S-DISPQ's `DISPQ_REPLY_RETURNS`, E143 `0x501c4913` / `0x501c4974` in a function
   of their own) are inline in E122's loop (`0x502f5ac7`, `0x502f5b26`, D); a second rule (displayReplies, fact
   `dispq.replies`) reads them as the pair of 12-byte reply sends within the loop or its callees, the maps' pair on
   the 15 bodies they place it on and one pair on each of the E118 family (X).

30. **The static constructor tables' counts** (2026-10-30). The module loader runs each module's constructors through
   one block per module, `mov N,d2; cmp 0,d2; beq; mov T,a2` and the loop `mov (a2),a0; add -32,sp; calls (a0)`, N / 4
   pointers from T (E143 `0x501e60ae..0x501e6124`, D). The lab ran E143's tables of modules 6 and 7 with E143's counts
   48 and 64 on every body, and the memory managers' table (module 2) at the map's place. A rule
   (`src/fw/facts.mjs` ctorTables, fact `ctors`) reads every block's [T, N / 4] (each table ends in 0xffffffff after
   its count, X on all 18): E143 15, 48, 64 and 6, E122 11, 39, 63 and 14, E146 14, 49, 69, 6, E144 13, 47, 69, 5,
   E142 12, 38, 75, 5; E120 has three tables (11, 101, 14). The lab runs the first (the memory managers') and those
   after it but the last (E143's module 8, which the lab's start does not load), with the loader's counts: the maps
   placed E143's three tables at the rule's first three on all 15 bodies they place (X), so before this the lab called
   past the end of the shorter tables (E144's 47, E142's 38: calls of 0xffffffff, which fault and were not checked on
   the play path) and left the ends of the longer ones unrun (E146's 49th and its five of 69, E142's eleven of 75).
   On E122 the map had put the memory managers' table on another table (`0x60427c30`; E122's is `0x6069b240`, D), so
   none of its eleven ran and the application's start called through a memory manager's empty vtable (X).
   With the loader's counts the 14 bodies `bin/modelcheck.mjs` checks pass as before (X).

31. **E122 (PEN-F) to its shooting screen state** (2026-10-30). Past UI_IN (finding 29) the start met, in order, each
   read where it lies (X: the stop, D: the code): the shared H-G4SET stand-in (`g4set` as the other ported bodies');
   the touch start, whose panel open and HFW callbacks the port does not place (`touch: false`); the VSC's CTRL3 OR
   (`0x501e04b7`, the A15 brackets), which the kind-3 VSC's build lacks (no observer, no brackets); the inter-CPU
   doorbell init, which the map had put on a trace function (`0x50002de5`): E122's is `0x5004ae84`, which calls the
   place of E143's first callee and attaches IRQ 120 for cores 0..2 with the handler at E143's IPI_HANDLER0's place
   (override); no display sync request, no RecView trace, no play component getter (sync and recview null, no play
   wrappers: S-DISPSYNC, S-RVSTANDBY and S-PLAYCOMP stand for nothing there); no DISP_FRAME start of E143's form
   (S-DISPFRAME not run); the event broker's init, which opens with two calls on its queue's id (`0x501a8270`, the
   rule had taken the second); the memory managers' constructors (finding 30) and a module init of the boot chain's
   stage 3, `0x50483a1f` after the trace "3_8", which sets up two slot managers the application's property reads
   reach (H-MMINIT); the composite cable `0x0500` (EV_CONPOSITE_CONNECTED at state 0): at the idle image's state 0
   getCompositeState (`0x506d4e29`, the switch query `0x502f3f8f(0x02020500)`) reported a cable, the application's
   output choice answered VIDEO where the GUI had the TFT, and it asked for an output change after every panel refresh
   (CA events `0x09000018` -> EVT_REQ_CHG_OUTPUT_DISPLAY); the idle image now has no cable (`IDLE_SWITCH_STATES`); no
   frame plane of E143's form (`frame_plane: null`, S-TAKEFRAME and S-AFOSD give none). The start then reaches the GUI
   state `0x0108` SS_COMMON/ID_ST_CA_REQ_DISP in 1.5 s, as E143's, and the OSD engine draws the clock warning (a clock
   and Y/M/D, the date being unset) into OSD layer 2's records (X: the records read back as images; no frame, since
   the kind-3 VSC has no compositor). Next stop: at the first long timer (about 3 s) and at S1 the application's
   movie time, `api_movie_CalculateMediaTime_Record_Movie` (`0x502d1710` -> `0x50565f13`), divides by a word of the
   movie module's object, whose pointer (`0x618c0ff0`) is 0 (`0x5056f5c6`, Fault 6): E143 creates the object in its
   file system's init (`0x5088fc8d`, its call at `0x5088fcb6` -> `0x50888c4a` -> `0x50880db8`, X: run in its session),
   E122 in `0x5056900d` (its call of `0x5056ef9c` stores it, D), reached from `0x50577796` (called at `0x5057f1b6`),
   which the lab does not run; that this is E122's file system init is I (its card is not native: `fileSystem` reads
   no SD layer of its form). With that API answered by hand (exploration only, not in the lab) S1, S2, PLAY and INFO ran
   to SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE and ID_ST_DISP_DETAIL and the GUI drew the shooting screen (P, 1250, ISO-A 200,
   999 shots, X), and the second PLAY met the same division through another movie API: the card's file system (or a
   stand-in for the movie APIs) is the next step. The EVF start still stops at the send to queue 8 (finding 28).

32. **E120's own stop and the E118 family's GUI take** (2026-10-30). E120's own tft child stopped where E118's did, in
   the lab's set-up: `hook obs-dispatch: the E143 address 0x510c2a2e has no place in E120's build` (X; finding 28 had
   reported it as E118's). Their GUI task sets a3 = sp + 396 early, `mov sp,a3` before a vtable call and `add 396,a3`
   after it (E118 0x50b932e9, 0x50b932ec), then waits in a loop of its own for message 38401 (`cmp 38401,d0; bne`,
   E118 0x50b93344, E120 0x509140ad), passes that message by value to GESetEvent (E118 0x50b8c4d7, the port's place of
   E143's 0x510ba2c2) and only then runs the receive loop, from `mov 32768,d3` on, with no a3 set-up before it (D).
   E122's GUI task has one loop and no such wait (D, 0x50b982f6..). 0x9601 is the GUI's first event and first take in
   E143's and E144's starts (X: their sessions' events), so the wait drops nothing a start sends before it (I).
   `src/fw/facts.mjs` guiTake now matches the loop from its `mov 32768,dN`, with a3 set right before it or as the last
   `add 396,a3` within 0x100 bytes before it after a `mov sp,a3`: E118's take is 0x50b93379, E120's 0x509140e2 (the
   `cmp d3,d0` after the load, as E134's), and the other 16 builds keep theirs (X, the rule on the 18 images).

33. **The family's handler tables, display task and PWM block** (2026-10-30). Past the take, E118's start stopped in
   H-BOOTTIME's hardware-timer init: `attach(irq 29, level 6) from 0x50066cc3: returned 0, handler table 0x00000000,
   want 0x600880e6` (X; E120 the same). Their ports had kept E143's handler-table address 0xa32600c0: the direct map
   has no vote for it, and a chained port takes the reference's answer only for an unplaced address, not for a kept one
   (E122's own map voted 0xa1bf3984). Their attach writes the tables at 0xa1bb3994 + k x 0x1e8 (D: E118 0x5004c80f,
   E120 0x5004c7bf). A rule reads every build's tables at the attach's run of one `mov imm32,An; mov d0,(d3,An)` per
   CPU (`src/fw/facts.mjs` handlerTables, fact `kernel.handlers`; E143 0x5002e95b, E144 0x5003408b, E122 0x5004c82e,
   D), and places E143's table: the 16 other builds keep their places (X). Every chained port keeps some lab addresses
   at E143's where its reference places them (from 1 on E139 to 16 on E122, X: the ports' kept lists against their
   references' places); no other one has been met at a stop. Then:
   - E120 has no per-frame wait in its device open: `frameWait` finds none (X), and the VSC command handler that
     holds E122's and E118's (`mov 135,d0` beside it, E122 0x503027e9, E118 0x502db856) has no counterpart in its
     image (X, a byte scan); what its open waits on per frame is ?. Its `display.frame_wait` is null, and S-FRAMEWAIT
     leaves it out (`src/fw/model.mjs` fact() gives a read null as undefined; the use takes `?? null`);
   - the display task init starts E122's display task (`extra_tasks`) on both: the static task table's row 0x51,
     whose entry word sits at the same image offset 0x18f70 on all three (D), E118 0x502d2fcd and E120 0x502c6a7d,
     the same opening as E122's 0x502f90f5 in another order (D), which the map does not pair;
   - their TFT opens enable a channel of the PWM block 0x9bc00000, the E144 family's, through the same channel enable
     (E118 0x5006bf92, D), which the family's board now keeps as a stub page; E122's start does not reach it (X).

34. **E118 and E120 at E122's level** (2026-10-30). Their starts now run natively through the kernel, the timers
   (H-DRVINIT), the display init and open, the settings store (H-STOREINIT) and the dial init, and stop where E122's
   do (X, each body's own tft and evf children): on the TFT at the play bring-up's UI_IN forward observer (E143
   0x5014c3eb, which E122 inlines, finding 28), on the EVF at the synchronous send to queue 8 from the display code
   (E118 0x502d0b98, E120 0x502c4560; E122's 0x502f6bbd). Both are E122's stops, so E122's mechanisms serve them: the
   two bodies port through E122 and take its overrides, but its other `MODELS` fields (`g4set`, `return_stubs`,
   `call_skips`, ...) do not carry and are to be given per body. With the UI_IN observer and the S-DISPQ reply returns
   (E143 0x501c4913, 0x501c4974, unplaced on all three) passed by hand in a scratch run (not committed, X), E118's and
   E120's GUI state read faulted: the GUI caller's word (E143 0x60368b88) had no vote, and their maps placed it by a
   section delta at a word no code of theirs loads. A rule reads it after the take, where the GUI task hands each
   message to its caller object (`src/fw/facts.mjs` guiCaller, fact `menu.caller`: E118 0x615e9970, E120 0x615e81d4,
   D; the other 16 builds keep their places, X). The scratch run then met, on all three in the same order, the
   missing `g4set`, the touch panel's open (E143 0x501e40da, unplaced on all three) and the VSC control bracket's
   observer (E143 0x501e04b7, E118), all on E122's path. Specific to E118 and E120, read for later:
   - the board byte: their boot driver init reads the strap id with `and 3` (E118) or `and 7` (E120) and maps id 0 to
     board 3 (E118's pairs at 0x60026860 0:3, 1:2, 2:1, 3:0; E120's at 0x60026804 0:3, 4:2, 6:1, 7:0, any other id
     halting; E122's maps it to 4, D); the getter has four callers on each (X), and their dial inits take one table;
   - the module queue word of PWR_EXEC (E143 0x600432bc, id 0x7c), carried from E144's override: the family's name
     table entry PWR_EXEC holds 0x86 on all three (X, the entry's bytes; E143's holds 0x7c), E118's and E122's ports
     place the word at the queue table's entry of 0x80, and E120's leaves it unplaced (the direct map and the leg
     disagree, carry_failed); whether the entry is the queue's is I. S-MODACK reads these ids at the application's
     start (`src/lab/camapp.mjs` module_queues), where an unplaced word reads as id 0.
   E118's carry_failed list also holds three display functions E122 and E120 place (E143 0x501c6a93, 0x501c6aca and
   0x501db1b4, X); the lab names them only in its stand-ins' descriptions, through no A() (X, a grep), so nothing waits
   on them.

37. **The E118 family's starts with findings 29 to 36 together** (2026-10-30; X: a play session per body and device,
   2.5 s of lab time, its error or its composite). E122's TFT start reaches the GUI state `0x0108`
   SS_COMMON/ID_ST_CA_REQ_DISP as in finding 31; its composite (finding 36's compositor, 720x480) holds one value, so
   the clock warning the OSD engine draws into OSD layer 2's records does not reach the composed planes yet (which osd
   word carries which GUI layer is finding 36's open I). E122's EVF start, now opening device code 6 (finding 35), runs
   past the camera application's start (S-CAMAPP) and stops on `tsnd_dtq` with timeout -1 to a full queue 156 (from
   `0x500484bb`). E118's and E120's TFT starts and E120's EVF start run past UI_IN and stop at the lab's `g4set`
   (H-G4SET), which E122's `MODELS` entry gives and theirs not (finding 34: E122's non-override facts are to be given
   per body). E118's EVF start faults earlier, a trap 7 at `0x5006e002` (not read yet, ?).

38. **The kind-3 composite's palettes are by GUI layer** (2026-10-30, `docs/om1-vsc-spec.md` section 12,
   `src/dev/vsccompose2.mjs`; corrects finding 36). With E122's GUI updates committed (finding 39) the TFT composite
   refused two things (X): `0x1b8` held `0x10`, a stray bit to the bank bit 16 finding 36 had read (OSDCP2_FIELD), and
   OSD3 drew 335,536 pixels of 255 against a 32-entry palette (PAL_FIELD). Both readings were wrong (D): the palette
   writer's `btst 16,d2` (`0x50307af4`) and the commit's flip (`0x50309f14..0x50309f24`, `and -17` / `or 16`) take
   16 as a mask, so the bank bit is bit 4; and the GUI's update puts GUI layer 2 - k's buffer in the display record's
   osd word k (`0x506c0aa3..0x506c0b25`: word 0 is checked with layer 2's dirty flag, `0x506c1c63(2)` and
   `0x50a5ccb5`, word 2 with layer 0's), so with the commit's OSD1 = word 2 and OSD3 = word 0 OSD1 shows GUI layer 0
   (palette id 2, `+0x600`), OSD2 layer 1 (id 1, `+0x680`) and OSD3 layer 2 (id 0, the 128-entry banks), as on E143
   (OSD3 = GUI layer 2). The planes' contents agree (X, the three buffers' histograms at the clock warning): OSD3 holds
   layer 2's indices 13..33 on its fill 255 (entry 127 of id 0, transparent), OSD1 layer 0's fill 31 (entry 31 of id
   2, transparent), OSD2 layer 1's fill 5 (entry 5 of id 1, `0x19808000`, black at 25 / 31). The compositor takes
   plane q's palette by id 2 - q and the bit `0x10`; the TFT composite then shows the clock warning (an orange clock
   and Y/M/D on the dimmed background, 8 values, X) in the firmware's own palette, the geometry of the false-colour
   dump of layer 2's records. `test/test_vsc3.mjs` (21 checks) drives the three layers as the clock warning leaves
   them. Which of OSD1 and OSD2 the chip draws on top is not read (the compositor keeps kind 2's order, OSD3 last; I).
39. **E122's display sync** (2026-10-30, `src/fw/facts.mjs` displaySync, `src/lab/camapp.mjs` S-DISPSYNC). The
   one-value composite at E122's shooting screen state (finding 37) was no compositor question: after the open's two
   commits of empty planes (`0x50309dc5`, X) the commit was not called again, DMA12..DMA14 stayed unwritten, and the
   GUI's updates sat in a display sync module E143 does not have. Its request is `api_disp_Disp_Update_Osd`
   (`0x502c9c6c`, d0 the sync type, d1 the device code) -> `Disp_Sync_Update_Osd` (`0x50483b96` -> `0x50483cda`), which
   queues the OSD handles in the device's manager block (`0xa18a37f4 + 56 n`, the blocks MODELS mm_init sets up, D):
   type 3 is command 4, which from state 0 or 3 leaves the block in state 3 and commits nothing (`0x50484370..0x504843ae`,
   D); an image request (commands 1, 3, 5, the through image's) commits both. The GUI sends type 3 while the TFT's sync
   word (`0x61600a24`, getDispSync `0x50694c65`) is set (`0x506c0d01..0x506c0dd4`, D), and the application sets it with
   CameraCommon::setDispSync (API `0x1012d`, `0x506d5889`) at its start and again after about 2.5 s (X; E143's
   application calls it too, X). Natively the through image releases it (I); the lab runs no through image. The rule `displaySync` now reads this form: the
   request by the name its trace loads (`mov "api_disp_Disp_Update_Osd",a0`), taken where no entry loads the id
   `0x10035`, the image sync by the id `0x10037` as before (`0x502c9f95`), and, through the image sync's one caller, a
   wrapper (`0x502c07ea`), stopRecView's two calls of it, each after a clear of one panel's sync word through the
   setter `0x50695318` (d1 0 the TFT, 1 the EVF, D). Its kinds differ from the other bodies': kind 1 passes the block
   command 12, which the handler (`0x50484490`) does not take (X: the state stays 3), kind 2 command 16 (the image),
   kind 0 command 17, which commits the OSD in states 1 and 3 (`0x504844dd..0x504844f7`, D; X). The fact gains the
   release's kind and panels (1 and [2] on the 15 other bodies, 0 and [0, 1] on E122), and S-DISPSYNC sends those. E122's
   TFT and EVF starts then draw the clock warning (X, `0x0108`). E118 loads the request's name but has no image sync of
   the id, E120 neither (X): the rule reads none there, and their display syncs' forms are ?. With the movie time
   answered by hand (exploration only, track 2's stop) S1 composed the shooting screen on both panels (P, 1250, -.-,
   +2.7, ISO-A 200, 999, COLOR 1, S-IS AUTO, a touch icon on the TFT, X).
40. **E122's EVF and the touch task's queue** (2026-10-30, `src/lab/play.mjs` S-TPSEND). The full queue 156 after the
   application's start (finding 37) is the touch task's (`touch_task` queue word `0x600411d2`, flag `0x60040ff8`, bit 8,
   read by the rule since finding 11; the task `0x5030ba09`, "[TP]touchpanel_main", static id 98, which the boot chain's
   stage starts after its init `0x5030b96f` joins the queue to the flag, `0x50186200..0x5018620e`, D). The lab starts
   no touch task on E122 (MODELS touch false, the panel's open unplaced), and the queue holds one message: both opens
   put cmd 4 there (`0x50302973..0x50302984`; the EVF's under the DISPLAY OPEN of code 6, `0x502f6b7b`), which fills
   it, and on the EVF the application's Set_Touch_Panel_Ctrl_Area (API `0xd001f`, `0x502f4c28` -> `0x5030bda9`) then
   sends cmd 8, TP_SET_CTRL_AREA, whose tsnd_dtq waited for good (X; the TFT start sends no second message). Not a
   device the display waits on and no EVF mask. S-TPSEND now also stands in for an asynchronous send to the touch
   task's queue from a task (not a display run) while the touch task does not run in the lab (before H-TPINIT, or
   with the panel not modelled): it runs the touch task's loop for the message as the synchronous S-TPSEND does (its
   flag wait returns the bit, its receive gets the message), wrapping OlyQeWr's routing. A display run's message is
   queued natively as before: run through the loop, E118's open's cmd 4 boots its touch IC, which the lab does not
   model ("TP BOOTLOAD ERROR", then every task blocked, X), where queued it leaves E118 at its earlier stop. On E122's
   EVF it runs the application's three cmd 8 (X; the open's synchronous cmd 5, `0x50302ac2`, is the synchronous
   S-TPSEND's, as before). E122's EVF start then runs past the application's start to the clock warning, composed on
   the 1024 x 768 device from the 640 x 480 canvas (X). The lab's other EVF masks (the through permit, the IMG fit,
   H-RESEND's check) were not met (the family runs no through image).

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
card), PLAY, INFO, PLAY. Their TFT start keeps the composite's UNWRITTEN error. E147 shoots and plays back. Since
2026-10-29 both run the lens natively by default, as E143 does (finding 25).

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
its hook list (empty for stage 1, `0x50173c78`) are not run (D). Since 2026-10-29 (finding 24) the charger's
transfers are served (S-SIOIIC, S-CHARGER, H-SIOMAP) and the card is native: the start ends in the date and time
setting, which MENU cancels, and `bin/modelcheck.mjs` passes.

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
at S-AFOSD (`0x500257ce` has no place in E132's build, as on E145, finding 14). Since 2026-10-29 (finding 24): the
transfers are served (S-SIOIIC, S-CHARGER, H-SIOMAP); the "Busy" screen was the industrial category update's, whose
request to CATEGORY_MAIN S-MODACK now answers (modack_queues), as LOGGER_MAIN's; the card is native; the start ends in
the date and time setting without Cancel, the clock set by modelcheck's prompt answer, and `bin/modelcheck.mjs`
passes; S1 does not stop at S-AFOSD since the framePlane rule gates it (finding 22).

**E118 (E-M5 II), E122 (PEN-F), E120 (E-M10 II).** Until 2026-10-30 they stopped at import on 18 board facts their
family scaffold left unread (`intc.irq_osd_engine` first, X). The board is read since (finding 28): E122's start runs
natively through the kernel, the timers, the display init and open, the settings store and the dial init and stops at
the play bring-up's UI_IN observer on the TFT, and on the EVF since it opens the built-in EVF (finding 35; it had
opened the NTSC output and stopped at its send to queue 8). E118 and E120, ported through E122, stopped earlier, at the
GUI message take's observer while the lab was set up; since findings 32 to 34 (2026-10-30) they run to E122's stop at
UI_IN. With UI_IN's forward read by shape (finding 29) the three run past it; finding 37 has where each stops now.

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
setting, E145 (finding 22). E133 passes modelcheck since 2026-10-29, E129 and E132 too (finding 24: E129 after MENU,
E132 after its clock is set at its date and time setting); the E118 family's starts run part way (finding 28). The next
steps are in `ROADMAP.md` "Multi-model".
