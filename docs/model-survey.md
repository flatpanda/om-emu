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
   answer (table below); E148..E199 answered nothing on 2026-10-19, and E148 has since been served v1.1 on 2026-10-28 as
   the OM-5 Mark II (finding 65), so the new OM System PEN is still not served (X).
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
| E148 | OM-5 II | 1100 | 23.7, 2 sections | 0x60021020 (7.5%) | olycompress | 2.47M | 49 | through E144: modelcheck passes (TFT and EVF; the count probe and its card native; the ListMenu memories 1909/1910 read at vtable slot 8, finding 65) |
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
| E118 | E-M5 II | 4100 | 20.4 | 0x60021020 (7.2%) | plain | 0.80M | 123 | through E122: `bin/modelcheck.mjs` passes on the TFT and the EVF with its card native, the frames composed, the count probe with INFO's redraw (findings 28, 32-34, 37, 43-45, 48, 50-52, 56, 61) |
| E122 | PEN-F | 3101 | 20.4 | 0x60021020 (7.2%) | plain | 0.79M | 123 | through E130: `bin/modelcheck.mjs` passes on the TFT and the EVF with its card native, the frames composed, the count probe with INFO's redraw (findings 28, 31, 35-42, 47, 61) |
| E120 | E-M10 II | 1400 | 20.4 | 0x60021020 (7.4%) | plain | 0.76M | 122 | through E122: `bin/modelcheck.mjs` passes on the TFT and the EVF with its card native, the frames composed, the count probe with INFO's redraw (findings 28, 32-34, 37, 43, 46, 49, 50, 53-56, 61) |
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
   ListMenu tab tables (a fact read by `listMenu`: present on E143, E146, E147 and, since finding 65, E148), the RTOS
   hook OlyTaWu and
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
   SS_MENU states of E145 and E142 print unnamed (named since finding 82). After MENU, S1 stops at S-AFOSD as before
   (finding 14).
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
     application's queue 6 full, X, why is ?; that stop no longer reproduces, `docs/hle-gaps.md` 4.3.2, X: what
     changed is ?, and that the guard then named queue 6 for LOGGER_MAIN's full queue is I).
     The start then ends in the date and time setting with Set and no
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

41. **The E118 family's card and file system** (2026-10-30, `docs/hle-gaps.md` 4.8.8). The movie time's divide by 0
   (finding 31) was not the movie module's: the object `0x618c0ff0` is the file system's volume object, which the
   file layer's init creates (`0x5056fc92` -> `0x5056900d`, its store `0x5056ef9c`, D) and whose free count at +8164
   the FAT's cache flush sets to -1 (`0x5056f488..0x5056f490`, as E143's `0x50888202..`); the movie time divides by
   its word +8168 (`0x5056f5bb..0x5056f5c6`, D; what that word holds is ?). That init is the file system's bring-up's
   call, as on E143: the bring-up `0x5057799c` (the boot chain's call at `0x501867d3`; E143's `0x5088fc8d` from
   `0x500242ab`), which the lab ran only on the bodies whose card is native (H-FILEINIT). `0x50577796`, named in
   finding 31, is not on that path (a drive flag test called at `0x5057f1b6`, D). The family's file system is the
   other bodies' library, instruction for instruction in the parts read (the bring-up, FILECLBK's loop and class
   dispatch, the dosfat and dcfnum handlers, the 45 places of the unformatted error `0xe08`, X), with five seams of
   another form, which `src/fw/facts.mjs` fileSystem now reads (D at E122's, the same on E118 and E120 by the rule, X):
   - *The SD command layer* `0x50581242`: `mov a0,a2; cmp 0,a2` and one busy word (`0xa1c87d70`) where E143 has a
     table per port, the command's status at +62 and its response at +28 (E143 +74, +32), the code, argument,
     buffer, block count and size in the same order around the response (+20, +24, +44, +48, +52: the issue
     `0x50581563..` writes the code to SD_CMD and the argument's halves to SD_ARG, `0x505814dc..` the buffer, count
     and size to the DMA wrapper and SD_SIZE). The rule reads the layer by its opening, the busy completion and the
     command's clear, and gives the fields (`command_fields`), which S-SDCARD now takes from the fact: one SD host,
     port 0 at `0x99000000`, SD_INFO2 bit 13 polled at `0x5058108c` (the board's `sd`, D).
   - *The file layer's flash record* in place of E143's NAND area: the drive status reads a record of
     `0x50579b21`'s 47480 bytes, rounded to 512, from `0x402a0000` with the flash access `0x500510c1` op `0x103`
     (`0x5056482c`), the 1024 bytes after it (checked for "OLYM", `0x50564950`), and writes with op 0 (`0x50564d94`):
     S-FSNAND keeps the two records, `[0x402a0000, 0xbe00]` (E118 and E120 at `0x40280000`, X).
   - *The album manager's init* `0x505885df`, from the DCF numbering mount (`0x50563142`): it starts TSK_ALBM_MAIN
     (task 90, `0x5058d097`) and sends it command 1 synchronously on queue 201 (`0x5058d14d`), which the lab does not
     run; read by its trace "[ALBM]init exec" (only the E118 family holds it, X), and S-ALBM returns from it as on the
     other bodies.
   - *The drive status* `0x5057e8e3` (`mov d0,d3; exthu d3` and the compares in another order) and *the flush's
     return* `0x5056f480` (the object by `mov (abs32),a0` where E143 reads it from the stack).
   - *The dosfat error* is not stored in the request's block (E143 stores it at +48, `0x50881736`; E122's dosfat ends
     `0x5056958e` without it, D): FILECLBK replies it to the sender (`0x50577e41`, `{u16 status, ...}`). The rule
     reads where dosfat leaves it (`storage.fat_error`: +48 on the 15 other bodies, three stores each, null on the
     family, X), and where it is null the lab's mount and format requests read the reply's status through an
     observer at the reply (`storage.fileclbk.reply`), installed only while the request is out (on E143 an observer
     at the reply for the whole session changed golden's output layer with screens and devices identical, X).
   With these E122's card is native (`src/fw/models.mjs` card_fs): the bring-up starts FILEFGND, DCFPROC_SUB and the
   third task, the SD init needs no UHS-II fallback (CMD0, CMD8, ACMD41 .. CMD16, X: the card's log), the blank 8 GiB
   card mounts with `0xe08` after 275 ms, the firmware formats it FAT32 `NO NAME` at sector 8192 with 32 KiB clusters
   (165 ms) and mounts it, the drive status is `0x3780`, and the DCF numbering mount gives folder 100, file 1 (X). The
   movie time no longer divides by 0: the screen shows `00:37:19` (FHD F 60p) and 1470 shots, which the firmware
   counts from the card (X: OSD layer 2's records after S1, read back as an image in false colour).
   E118's and E120's cards stay S-CARD's (`card_fs` false): their starts stop before the play bring-up runs the file
   system (finding 37), so it is not tried on them.

42. **E122 through modelcheck's path** (2026-10-30). With its card native, E122's TFT start, S1, S2, PLAY, INFO and
   PLAY run without a stop: `0x0108` SS_COMMON/ID_ST_CA_REQ_DISP after the start, S1 and S2 (one picture,
   `P1010001.JPG` in `100OLYMP`, read back by `refs/volume.mjs`), PLAY `0x0608` SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE, INFO
   `0x060b` ID_ST_DISP_DETAIL, PLAY back to `0x0108` (X: `bin/modelcheck.mjs E122 --no-port`; with `--card-size 64`
   the same path on an exFAT card, 9999 shots). It fails the count
   probe only: the composite holds one value (the kind-3 compositor's open, finding 36), so no pixel follows the count.
   The probe would also fail on the screen's cadence: E122's count is the application's getAvailableShootCount
   (`0x506b3aff`, its trace "OlyHfwOpeShoot::getAvailableShootCount start"), which asks the query (`0x502e3440`)
   six times in the 4 s after the start, once in the 3 s after the first S1 and not in the 3 s after a second S1
   (X: an observer on the query), where the E142 lineage's GUI item asks at each refresh (finding 16): with the
   query answered 777 right after S1 the count drawn in OSD layer 2's records reads 777, and with the answer removed
   it stays 777 for 4 s (X: the records), so the probe's third window would find no pixel back at its first value
   (I). What makes the application ask again is ?. PLAY's screen draws the file number `000-0000` and `0` in its
   records, INFO's detail `0x0` and `0mm` (X), where the picture is `100-0001`: E122 has no play component wrappers
   (finding 31, S-PLAYCOMP stands for nothing there), and what fills the playback's file information on it is not
   read (?). The EVF stops where it did (finding 37, queue 156). E122 is not in modelcheck's checked set: the count
   probe and the EVF fail.

43. **What a chained port takes from its reference** (2026-10-30). A body with `port_via`
   carries its reference's effective overrides and the knobs its `carry` lists (`src/fw/place.mjs` carryOverrides,
   `src/fw/knobs.mjs`), nothing else: every other field of the reference's `MODELS` entry is the body's to decide,
   read by a rule where the shape repeats or given in its own entry with its evidence. `test/test_facts.mjs` now
   checks it: a chained body gives or reads each field its reference gives, but the firmware's identity, the port's
   own fields, the knobs not carried and the stand-ins a body owns by nature (`return_stubs`, `call_skips`,
   `vsync_alias_flags`, `ui_out`). E122's fields, decided on E118 and E120 (D at each place, X at the stops):
   - `state_log_regs` became a rule (`src/fw/facts.mjs` stateLog, fact `state_log.regs`): the state log's one caller
     stores the new state at W and loads W - 4 and W into the log's arguments (E143 `0x510c2af0..0x510c2b0a`: a0, a1;
     E118 `0x50b933ef..0x50b93405`, E120 `0x50914158..0x5091416e`, E122 `0x50b9838a..0x50b983a0`: d1, a0). It reads
     a0, a1 on E143, E146, E147, E144 and E145 and d1, a0 on the 13 others (X, the 18 images); E139's and E122's hand
     values go. E134, E137, E142, E140, E125, E133, E130, E129 and E132 had taken the lab's a0, a1, so their `state`
     events named the wrong registers' values (the GUI state the lab reads from the caller's object was right, D);
   - `mm_init` became a rule (mmInit, fact `mm_init`): the call right after the boot chain's `"3_8"` trace, E122
     `0x50483a1f` (its hand value), E118 `0x5046ae65`, E120 `0x50447041`, the same module's init in another form (two
     slots set up, then the slots' calls; all three near one place of E143's code, X: `bin/xwhere.mjs`); null where
     the chain starts a task there (E143 `0x501e96f1`, E144 `0x5018f813`) or holds no such trace (X, the 18);
   - `g4set` (the shared stand-in, as on every ported body), `touch: false` (the panel's open, E143 `0x501e40da`,
     unplaced on both) and `frame_plane: null` (framePlane reads none; the frame display mode set and the AF upload
     unplaced) are given per body (X: `port.json`); `IDLE_SWITCH_STATES`' composite cable `0x0500` applies by code
     (both tables hold it, X); E122 gives no `return_stubs` or `call_skips`.
   Past `g4set` the starts met three addresses their maps had wrong or not: E118's function direct start, which
   funcDirect had not found because its opening also keeps a1 at (28,sp) (`0x50b78a12`; the start `0x50b78a3a`, the
   id in d3, D: the rule now takes that store; the 17 others unchanged, X); the GUI task, which both maps had put on
   another task's opening of the same form (E118 `0x50c3d339`, E120 `0x509bd6e4`), read now by its start trace
   `"[GUI App]:Start Gui Task"` (guiTask, fact `menu.task`; E118 `0x50b93162`, the entry its application starts, X;
   E120 `0x50913ecb`; the 13 other bodies holding the trace keep their places, X); and E120's CA_MAIN, which neither map
   places (override `0x508eaf45`: its object of 68 bytes, constructor and run as E122's `0x50b738ce` in short call
   forms, D). The PWR_EXEC queue word (finding 34): S-MODACK reads E143's 20 module-queue id words through the port,
   and by the object-name table five read another queue's id on the family (XTC_APP_EXEC `0x80` by name, `0x7a` read;
   TFT_EXEC `0x6e`, `0x68`; LENS_COMMAND `0x34`, `0x31`; FCS_EXEC `0x1e`, none; PWR_EXEC `0x86`, `0x80` on E118 and
   E122, none on E120; X). Up to the stops below the applications post to one module queue, 104, which S-MODACK
   answers (X), and to none of these. The two readings differ on 13 of the 15 other bodies as well (E146's XTC_APP_EXEC
   `0x77` by name, `0x76` read, X); that the name table's id is the queue's holds on E143 (X) and is I elsewhere. Next:
   the module queues read from each build's API target table by a rule.

44. **E118's EVF waits for its serial transmitter** (2026-10-30). The trap 7 at `0x5006e002` was the display run's
   budget running out in the serial driver's polled send (`0x5006dfc3`): after its byte loop (`0x5006e24b`, which
   writes `+0x18` while `+0x1c` is not 0) it waits until the channel's `+0x1c` equals the depth word the channel's init
   keeps (`0x611515c0 + 4 x ch`: 16, 16, 16, 16, 64 for channels 0..4, X at the stop; the channel records
   `0x6011c034 + 0x60 x ch` name `+0x18` and `+0x1c` at +24 and +28, D). E118's EVF panel takes its command list over
   channel 2 (`0x98500000`) at 4 MHz in that polled mode, a GPIO pin (139) around each command (`0x502d3b20..`, D); a
   lab-stub page read `+0x1c` as 0. The family's board now presets each enabled channel's `+0x1c` to its depth, a
   transmitter that is idle (that `+0x1c` counts free entries is I); E118's EVF open completes, E122's and E120's
   stops are unchanged (X).

45. **E118 (E-M5 II) to its shooting screen state** (2026-10-30). Past the open, E118's start faulted in its GUI task
   (`0x50b8f68d`, a bus error at `0xc000002c`): the search for font record 147 (`0x50b8f675`) in the font table of the
   icons record (the table at record offset `0x808848`, 78-byte records) ran off the table's end, whose records from
   the 26th were the bitmaps record's bytes (X). E118's loader puts the icons record at `0xa24e2c00` and the bitmaps
   record at `0xa2cebc00` (resLoader, D), and the icons record is `0x809400` bytes (its head, X): 0x400 bytes overlap.
   The lab wrote both records at its start, the bitmaps record last; the firmware asks for the icons record at the
   GUI's start and for the bitmaps record later (X: the lab's request log). On a body whose records overlap the lab
   now writes each record again at its request (`src/lab/resources.mjs` overlap; E118 alone of the 18, X). E118's TFT
   and EVF starts then reach the GUI state `0x0108` SS_COMMON/ID_ST_CA_REQ_DISP (X), at 0.2 s of lab time, with E122's
   events (POWER_ON `0x9601`, `0x9b01`, the application's `0xf001`), and the OSD engine draws the clock warning (a
   clock and Y/M/D) into OSD layer 2's records on both, the EVF's centred for its 640-wide canvas, and fills layer 1's
   640 x 480 area on the EVF (X: the records read back as images). The composite is one value (finding 36's open;
   since findings 38 and 39 the display sync's, finding 47). At the first long timer (about 2.2 s) the start stops on both devices where E122's does,
   in the movie time's division by the movie module's object word (`0x5055ee88`, E122's `0x5056f5c6` code; the object
   pointer `0x6189b858` is 0, X), the file system's volume object, which finding 41 brings up on E122. S1 was not tried past it.

46. **E120 (E-M10 II) at POWER_ON** (2026-10-30). With findings 43 to 45 E120's TFT start runs the application and the
   GUI natively and stays in `0x0102` POWER_ON (X: 4 s of lab time, the OSD records only filled, the frame one value).
   Its GUI takes E118's events up to `0x9b01` and no `0xf001`. The application takes the same events in the same order
   on both (X: the event its main loop has handled, E118 `0x50b6b3da` (200,sp), E120 `0x508ebc8e` (196,sp)):
   `0x05000000`, `0x04000000`, `0x04000016` (after which it asks the GUI for `0x9b01`), `0x0900001b` (E120 `0x0900001a`),
   `0x05000003`, `0x09000023` (E120 `0x09000022`), `0x09000009`. Handling `0x09000023` E118 asks for `0xf001` (its
   request list sent through the GUI's request table, `0x50b777d5`, D); handling `0x09000022` E120 does not. The two
   runs read the same settings in that handler up to setting 44 (0 on both, X), after which E118 reads 1508, 683 and
   402 and E120 the properties 26, 478, 24, 4 and 434 (X): the branch is ?. Compared and alike: the queue traffic (the
   DISPLAY cmd 33 reply and S-MODACK's answer to queue 104 on queue 6), the module-9 readers, the UI_IN layout (monitor
   bit, switch states); E118 also asks the touch panel for its swivel (`Set_Touch_Panel_Swivel`, a synchronous send to
   TOUCHPANEL 156, cmd 10, which S-MODACK's fallback returns), which E120's tilting monitor has no counterpart of.
   E120's EVF start stops on E122's EVF stop, `tsnd_dtq` with timeout -1 to the full queue 156 (from `0x500484bb`;
   queue 156 is TOUCHPANEL, the touch task's, which the lab does not start on the family; finding 40).
   Also measured: E120's device open waits in a loop of its own (`0x502d9b0c`: a 2 ms sleep until the word
   `0x61879784` is 1, with a timeout, 28 ms per call from the open's command list at `0x502d01c5`) for a callback
   (`0x502da12c`) that the pin driver's attach registers for GIO pin 30 (`0x502d99cf` -> `0x500647ed`, the attach
   taking pins below 224 and keeping a callback per pin, D; which line pin 30 is, ?; the callback also sets bit 1 of
   the touch task's flag word `0x60040f52`, D). The lab raises no pin interrupt: the callback never runs (X, 0 hits in
   2 s after the bring-up), every wait times out, and the TFT open takes 300 s of lab time, the EVF's 500 s (X; E122's
   TFT open takes 300 s as well, E118's well under one). With the wait answered at once (exploration, not landed) the
   TFT open takes 0.19 s and the start still stays at POWER_ON (X), so it is not the stop's cause.

47. **The E118 family with findings 38 to 46 together** (2026-10-30; X: a play session per body and device to 5 s of
   lab time after the start, the composite read back, and `bin/modelcheck.mjs`). E122 (PEN-F) runs without a stop on
   both panels and its composites show the shooting screen in the firmware's palette (P, 1250, -.-, +2.7 and the
   exposure scale, ISO-A 200, S-AF, the movie mode FHD 60p, 00:37:19 and 1470 from the card; 19 values on the
   720 x 480 TFT, 11 on the 1024 x 768 EVF); its device opens still take 300 s and 500 s of lab time (finding 46's pin
   wait). `bin/modelcheck.mjs E122` passes the path on the TFT (start, S1, S2, PLAY `0x0608`, INFO `0x060b`, PLAY back
   to `0x0108`) and the EVF (start, S1, S2), the card formatted FAT32 and counting 1470 shots on the 8 GiB card, exFAT
   and 9999 at 64 GiB, S2's picture read back by `refs/volume.mjs` on both. Only the count probe fails, for finding
   42's cause (the application asks for the count at its start and after the first S1 only): E122 is in modelcheck's
   checked set, the probe in its PROBE_XFAIL, strictly, so a probe that passes fails the run. E118 (E-M5 II) reaches
   `0x0108` on both panels and stops at about 5 s of lab time in the movie time's division (`0x5055ee88`, Fault 6,
   finding 45), its composite one value: its GUI's updates wait in its display sync, whose form the rule does not
   read (finding 39). With its card's file system native (exploration, not landed) its start ends in more than
   2,000,000 stand-in calls (which stand-in, ?), so its card stays out. E120 (E-M10 II) stays in POWER_ON `0x0102` on
   the TFT and, past queue 156 since finding 40, on the EVF (finding 46), its composite one value.
48. **E118's display sync and its planes without level words** (2026-10-30, `src/fw/facts.mjs` displaySync and
   vscLevels, `src/dev/vsccompose2.mjs`, `docs/om1-vsc-spec.md` section 12). E118's one-value composite was its display
   sync's, as E122's had been (finding 39): its GUI sends api_disp_Disp_Update_Osd (`0x502b147a`, through the API
   dispatcher's call at `0x502a91fa`) type 1 at 0.19 s, whose commit enabled no plane, then type 3 at 0.22 s and at 2.2
   s, and the VSC's commit (`0x502e2174`, the function of E122's `0x50309dc5`) ran after none of the type-3 requests (X:
   observers). E118 has E122's API (D): the request's checks, the image sync api_disp_dummy_Disp_Update_Force_Disp_Sync
   (`0x502b16ec`, E122's argument checks and codes 15, 16, 18), whose trace loads its name and no API id, so the rule
   had found none; the wrapper `0x502a9281`; stopRecView's two calls of it after the per-panel clears through the setter
   `0x506a6b0f` (`0x5082200b`, `0x5082202f`). Its display sync module is another one (D): the request maps type 3 to the
   module's asynchronous OSD update (exec 5; with bit 31 set exec 3, which waits; `0x502b1513..0x502b1521`), which from
   the idle state 8 leaves the device's state byte at 2 and commits nothing (`0x5046b691`, `0x5046b7c7..0x5046b7cb`);
   the force path's code 18 (kind 0 with a0 1: `0x5046b188` -> `0x5046b1a2`), admitted in states 0 to 3 (`0x5046bb6e`),
   commits the OSD in states 0 and 2 (`0x5046b28a`, the module's commit `0x5046c0c0` with 1) and leaves state 8. The
   rule now reads the image sync by that name where no entry loads its id, as it reads the request, and gives E118
   E122's release (kind 0, panels 0 and 1); with S-DISPSYNC sending it the commit follows each synced update (X: at
   0.235 s and 2.27 s, with the GUI's buffers). The composite then refused OSD7..OSD9 unwritten (UNWRITTEN at
   `+0x2e0..+0x2e8`): E118's open (`0x502e1b48`) stores no level where E122's stores `0x100` (`0x503097b7..0x503097c6`),
   and no word of E118's image holds the three addresses (X, a byte scan; E120's code sets them, `0x502d6c9c`, D). A
   rule (vscLevels, fact `board.vsc.levels`) reads whether a kind-3 build names them: true on E122 and E120, false on
   E118 (X). On a build that names none the compositor draws each plane at the full level, the plane's bit set in the
   header's ASSUMED word with a note (what the chip does with its unwritten level word is ?). E118's TFT and EVF
   composites show the clock warning, an orange clock and Y/M/D (8 values on 720 x 480 and on 1024 x 768, X), until the
   movie time's division stops the start at 4.3 s of lab time (finding 45). E122's facts and frames are unchanged (X: 19
   and 11 values at 5 s, golden), and the 15 other bodies' display sync facts too (X: the rule on the 18 images).
   `test/test_vsc3.mjs` drives a plane without level words on E118's board (25 checks).
49. **E120's display sync takes records** (2026-10-30, `src/fw/facts.mjs` displaySync, `src/lab/camapp.mjs` S-DISPSYNC).
   E120's one-value composite at POWER_ON is the firmware's state: its GUI's three layers hold only their fills, layers
   0 and 1 index 31 and layer 2 255 on the 800 x 600 canvas, each a transparent entry (palette ids 2 and 1 entry 31, id
   0 entry 127, transparency 0), and its one display update is a type-1 request with no OSD handle, so the VSC's commit
   (`0x502d72a7`, the same function) runs only for the open's two empty commits and DMA12..DMA14 stay unwritten (X: the
   records, palettes and observers at 5 s). E120 holds neither of E118's names: its display API takes records (the
   `_Multi_Ext` functions, D). api_disp_Disp_Sync_Update_Osd_Multi_Ext (`0x502a6042`) takes a0 a record of the OSD
   handles, the u16 type at +16 and the device code at +20 (1 the TFT; `0x502a6062..0x502a607b`) and passes the type to
   the module as its exec (3, 5, else 1; `0x502a608b..0x502a6097` -> `0x50447127`), whose force path is E118's
   (`0x5044737e`, E118's `0x5046b1a2`); api_disp_Disp_Sync_Force_Update_Multi_Ext (`0x502a663b`) takes a record of the
   u16 code (15, 16, 18; `0x502a6687..0x502a6693`) and the device code at +4, code 18 into the force path
   (`0x50447364`). stopRecView calls it itself (`0x507ccd72`, `0x507ccd98`), each call after a clear of one panel's sync
   word through the setter `0x50653b0f` (`0x507ccd61`, `0x507ccd85`). The GUI's synced update is type 5 (`0x5067b98e`),
   the asynchronous one. The rule reads this form by its two names (a name may be loaded up to 0x20 bytes into the
   function: E120's request clears its locals first) and gives the record's fields (`record`: type +16, device +20,
   synced type 5, code 18 at +0, device +4), and S-DISPSYNC reads the request's type and device from the record and
   releases with a record of code 18. Exploration only (not in the lab): with the GUI's `0xf001` posted after the start
   (E118's application asks for it, E120's does not, finding 46) and the movie time answered, E120's GUI reached
   `0x0108`, sent type 5 with its three layers' buffers and nothing was committed; S-DISPSYNC's release then composed
   its shooting screen on the TFT and the EVF (P, 1", -.-, 0.0 and the exposure scale, ISO-A LOW, S-IS AUTO, L N, FHD F
   60p, 00:00:00, 999: 22 values on the TFT, 14 on the EVF, X). In the lab E120 stays in POWER_ON.

50. **E118's card and the sub-CPU's card line** (2026-10-30, `docs/hle-gaps.md` 4.8.8). With E118's card native the
   file system's bring-up (H-FILEINIT, a lab call) ended in more than 2,000,000 stand-in calls: 1,999,982 of them
   OlyTaSS(1) from the sleep wrapper `0x505768bd` (X: the callers of the hle's stand-ins, the stack at the sleep). The
   sleep is the poll of the SD driver's switch of a card line (`0x5057e30c`, from the SD init's `0x5057e06c` with d0 1,
   `0x5057e083`), which the driver makes right after the card's supply on each body, in two forms (D): E122 sets GIO
   pin 74 (`0x50582b1b` -> `0x50582ace`), E120 pin 59 (`0x505566e4`), and E118 asks its body control for it, a
   24-byte request of code 42 with a callback (`0x5057e2fe`: the status to +18, 1 to +20) through the request entry
   `0x5015ee69` (codes 2..44 through the table `0x601b14dc`), and sleeps 1 ms at a time until the callback has run.
   Request 42 writes register `0xdd` of the sub-CPU's link with the switch byte (`0x5015f30a`) and goes out through a
   deferred call (`0x50160421` -> the post `0x50061df8`), the transaction's completion calling the request's callback
   (`0x5015f367` .. `0x5015f3ab`, D); the module's dumps name the link's lines (`--bc_scpu--` RST, CS, RDY, RQ, TRG and
   `--bc_ssc--`, D; that it is the sub-CPU's serial link is I by those names), which the lab does not model. Which card
   line it is, ?. `src/fw/facts.mjs` fileSystem reads the request form as `storage.card_switch` {send, ret, callback,
   code} (E118 `0x5015ee69`, `0x5057e34a`, `0x5057e2fe`, 42; null on E122 and E120; X), and S-SDSWITCH answers it at
   its send: the callback with status 0 (I: the sub-CPU's answer), then 0 from the send (`src/lab/storage.mjs`). Seven
   E144-family bodies hold the same request (E134, E137, E125, E133, E130, E129, E132, X), behind a test that is false
   in their build (E130 `0x505f3f03`: `0x505f39f8(2)`, 2 == 1, D), so their sessions never send it (X: E130's, no
   send). The deferred call's trigger was a stub word: the family's deferred-call init has four words where the other
   bodies' have six, `0x9b8000f4` and `+4` with IRQs 30 and 31 on every core, `+8` and `+12` with 32 and 33 on its own
   core (E118 `0x50061d01`, E122 `0x5005f419`, E120 `0x50060a1d`; the handlers disable 30 and 31 and write 0 to 32 and
   33, `0x50061f37..0x50061fcb`, as E143's, D). deferredCalls reads that form too (the 15 others unchanged, X), so the
   family's board has the triggers (`src/dev/dpc.mjs`) and H-DPCINIT runs its init; the family's sessions post nothing
   up to modelcheck's path's end (X: the init's four writes only). With S-SDSWITCH E118's bring-up mounts the blank 8
   GiB card as E122's does (`0xe08`, the firmware's FAT32 format `NO NAME` at sector 8192 with 32 KiB clusters, the
   mount, drive status `0x3780`, DCF folder 100, file 1, X), and E120's too (X, its TFT and EVF starts, which stay at
   POWER_ON `0x0102`): the card is native on all three. E118's start then runs past the movie time's division
   (finding 45's stop) to the next long timer's (finding 51).
51. **E118's movie record time and modelcheck's path** (2026-10-30). Past the volume object, E118's start stopped at
   about 5.6 s of lab time in a Fault 6 at `0x50535c40`, a `divu` by the byte `0xa1c2fad8` (X: S-LONGTIMER's settle;
   the stack: `0x5051876b`, `0x502b75ec`, `0x506c512e`). The function (`0x50535bf4`) fills the movie module's record
   time for api_movie_Get_Time_Record_Movie (`0x502b75d3` -> `0x5051875a`, the place of E143's movie time query
   `0x5042da58`, which getMovieTime calls), dividing a frame count by the frame rate byte without a test
   (`0x50535c34..0x50535c42`, D); E122's and E120's record time multiplies a word by 1000 there (E122 `0x5054664a`,
   D). The rate is the movie module's set-up's (`0x50535c83`, its +6, called from the record sequence's state
   handlers `0x50547042` and `0x50547f09`, D), which the lab does not run: E143's own query finds the same rate 0 and
   logs `0x39000903` from its rate conversion, which E118 holds too (`0x50534891`, D). `src/fw/facts.mjs` movieRate
   reads the unchecked division (fact `card.movie_rate`: E118 `{fn 0x50535bf4, rate 0xa1c2fad8, error 0x9d05}`, null
   on the other 17, X), and S-MOVRATE (`src/lab/camapp.mjs`) returns the function's own error for no struct (`0x9d05`)
   while the rate is 0, without the division; the query then answers its error, as E143's does. E118 then runs
   `bin/modelcheck.mjs`'s path on both panels (X): on the TFT start, S1, S2, PLAY `0x0608` SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE,
   INFO `0x060b` ID_ST_DISP_DETAIL and PLAY back to `0x0108`, on the EVF start, S1 and S2 (and, in a play session,
   PLAY, INFO and PLAY as on the TFT, X), the card formatted FAT32, 2116 shots, S2's `P1010001.JPG` read back by
   `refs/volume.mjs`; with `--card-size 64` exFAT and 9999 shots (X). OSD layer 2's records (read back as images in
   false colour) show the shooting screen after S1: P, 8000, -.-, ISO-A 200, S-AF, S-IS AUTO, WB AUTO, 4:3, LN, FHD F
   60p, `00:37:19` and 2116 from the card (X). Only the count probe fails: the composite holds one value (its display
   sync's form is not read, findings 39 and 47), so no pixel follows the count. E118 is in modelcheck's checked set
   with its TFT and EVF, the probe in PROBE_XFAIL with that reason.
52. **The family's playback file number** (2026-10-30). PLAY and INFO drew `000-0000` and `0` on E122 (finding 42).
   OlyHfwOpePlyCom::getNumber has two branches on E143 (D): with its mode word (`0x60360c74`) not 3 it asks the play
   component through the wrapper `0x50acf1a8` (S-PLAYCOMP's getNumber), with 3 it sends the play module the
   synchronous request 5 (`0x50ace1db`) and reads the response block (`0x50ad46b4`) back: +4 the index, +8 the file
   number and +10 the folder as halfwords (`0x50ace206..0x50ace225`). The E118 family's getNumber is that second
   branch alone (E122 `0x506aacfa`, the reads `0x506aad25..0x506aad43`, D), which S-PLAYSEQ left unanswered. S-PLAYSEQ
   now answers request 5 from the image shown, its DCF name's numbers where the card is native (S-RECFILE's file;
   `src/lab/camapp.mjs`); the index counts from 1 as the component's does (I). E122's and E118's PLAY and INFO then
   draw `100-0001` and `1` (X: E122's composite, both bodies' OSD records). INFO's detail still draws `0x0`, `0mm` and
   the date `0001.00.00 00:00` on both: they come from api_play_Get_StillInfo_ExifData (API `0x30089`, E122
   `0x502e16b2`), which reads the play module's information for the picture, not read (?; finding 57).

53. **E120 (E-M10 II) past POWER_ON: the rec view word** (2026-10-30, `src/fw/facts.mjs` recViewStandby,
   `src/lab/camapp.mjs` S-RVSTANDBY). The camera application's own trace function (E118 `0x50b8af78`, E120
   `0x5090bce1`: `mov <name>,a1; call` at every step, its strings read at each call, X) shows where finding 46's two
   runs part: handling `0x09000023` E118 logs "isRecviewOnSubAppMdlRecview", "Recview OFF DISP", then
   ">>>setCameraAppData", the date setup's timer and "end sendEventToGui" (the request for `0xf001`); handling
   `0x09000022` E120 logs "Recview ON DISP" and asks the GUI for nothing (X). getRecViewState (API `0x20145` on both,
   the method E120 `0x506d2c1d` -> `0x50672f5e`, E118 `0x5072699a` -> `0x506c6453`) first calls a gate on the RecView
   component's state word W: E120's (`0x50654ba2`) reports a rec view unless W is 1, E118's (`0x506a7c75`) and E122's
   (`0x50696381`) unless W is 0 or 1 (D). W starts at 0 (E120 `0x615e07a0`, X). Past E120's gate the method reads the
   properties 26, 478, 24, 4, 434, 109 and 600 (`0x50672f96..0x50673070`): these were finding 46's reads after setting
   44, not the cause. S-RVSTANDBY stores the component's standby state 1 in W on the other bodies, but its rule reads W
   from the "[RecView] entryStandby " trace, which the family does not hold. The component is E143's code without its
   traces: the state helper `0x50791b40` (`mov a0,a2; mov d0,d2; call` the setter `0x50654c29`, `mov d0,(W); retf`)
   with the entries `0x507913b3..` in E143's order and states (2, 3, 1, 4, 5, 6, and 0 by `clr d0`; the standby entry
   third, `mov 1,d0` as E143's `0x50c65ff2`), and a second helper `0x507976dd` with 2, 3, 1, 4 as E143's `0x50c6ce93`
   (D). Where the trace is not held the rule now reads W by that form, the one word whose setter the helpers call, and
   the standby value from the gate `clr d2; call G; cmp n,d0; beq`, G `mov (W),d0; retf`. On the 15 bodies holding the
   trace the form gives the trace rule's word and the gate its n (X; E144 holds a second gate, of 2); E118 reads
   `0x615dec74`, E122 `0x61600a74`, E120 `0x615e07a0`, all 1. With W 1 E120's TFT and EVF starts take `0xf001` and
   reach `0x0108` SS_COMMON/ID_ST_CA_REQ_DISP, and the OSD engine draws the clock warning (a clock and
   Y/M/D) into OSD layer 2's records on both, the EVF's centred for its 640-wide canvas (X: the records read back as
   images); E118's and E122's stops and E122's modelcheck path are unchanged (their gates took 0 as none already, X).
54. **The E118 family's GIO pin 30 is the touch controller's INT** (2026-10-30, `src/fw/facts.mjs` touchIntWait,
   `src/lab/menu.mjs` S-TPINTWAIT). E120's open-time wait (finding 46, `0x502d9b0c`) belongs to the touch panel driver:
   its set-up `0x502d99a2`, which the device open's command list calls (`0x502d016b`), configures pin 30 and attaches
   the callback `0x502da12c` through the GIO driver's class-0 functions (`0x500647b6`, `0x500647ed`; the tables at
   `0x601151b4..`, E143's driver's form), and enables it (`0x50064823`). The callback stores 1 in `0x61879784` while
   the driver waits (`0x61879788` 0) and otherwise disables the pin and sets bit 1 of the touch task's flag word (a
   touch's data ready, I). The wait (2 ms sleeps until the word is 1, a timeout of d1 ms on the us clock) ends the
   command list with 150 ms, and its timeout logs "TP INT TIME OUT" (`0x502d0296..0x502d02a8`; E122 `0x50302930`, the
   wait `0x5030c426`, D): pin 30 is the touch panel controller's interrupt line. The lab models neither the controller
   nor a GIO interrupt on the family's board, so every wait timed out, and the us clock counts CPU reads until the play
   bring-up turns A-USLAB on (`0x50001ef1` reads channel 9's counter `0x98900074`; H-USCOUNT): the 150 ms took 300 s
   of lab time (X: the wait's elapsed count 150001 after 300 s). A rule reads the wait, its poll and the word from the
   call before that trace (fact `touch_int`: E120 `0x502d9b0c`, `0x502d9b4c`, `0x61879784`; E122 `0x5030c426`,
   `0x5030c466`, `0x6189f508`; null on the 16 others: the name is held by E118, E134, E137, E125, E133 and E130 too,
   E118 loading it after a wait inline in its touch driver's command list, `0x502e3fe3..`, which its open does not
   reach, and the others after no such call, X). S-TPINTWAIT stores 1 in the word at the poll, as the callback would
   on the INT, so each wait returns after its first sleep (how long the controller takes is ?). The opens' lab time
   (X, the DISPLAY OPEN step): E120 TFT 300.19 s -> 0.19 s, EVF 500.39 s -> 0.39 s; E122 TFT 300.18 s -> 0.18 s, EVF
   500.33 s -> 0.33 s; E118 0.19 s and 0.13 s, unchanged. E122 passes `bin/modelcheck.mjs` as before (X).
55. **E120 to E118's stop** (2026-10-30; X: a play session per device and `bin/modelcheck.mjs E120`). With findings
   53 and 54 E120's TFT and EVF starts run their opens in under 0.4 s, reach `0x0108` and draw the clock warning into
   the OSD records; the composite holds one value, the GUI's updates waiting in the display sync whose form the rule
   does not read on E120 (finding 39). At the first long timer, about 2.7 s after the start, and at S1 the start stops
   where E118's does (finding 45): in the movie time's division by the file system's volume object word +8168
   (`0x505372b0`, the instruction for instruction counterpart of E118's `0x5055ee88`, Fault 6; the object pointer
   `0x61899518`), which finding 41 brings up natively on E122 and the card's file system is the next step for. Up to
   that stop E120's application sends through its API sender to two queues only, 104 (TAKE_FUNC by the family's
   object-name table, which S-MODACK answers) and 146 (DISPLAY, S-DISPQ's), and to none of the five finding 43 found
   the port's words read as another queue's (X: OlyQeWr from the sender's return `0x502a9076`), so S-MODACK's ids from
   the API target table are not needed yet. E120 is not in modelcheck's checked set.

56. **The E118 family with findings 48 to 55 together** (2026-10-30; X: a play session per body and device to 5 s of
   lab time after the start, the composite read back, and `bin/modelcheck.mjs`). The three run without a stop on both
   panels and their composites show the shooting screen in the firmware's palette: E118 (E-M5 II) P, 8000, -.-, ISO-A
   200, the movie mode FHD 60p, 00:37:19 and 2116 shots from the card (21 values on the 720 x 480 TFT, 13 on the
   1024 x 768 EVF); E120 (E-M10 II) P, 4000, -.-, 0.0 and the exposure scale, ISO-A LOW, flash ±0.0, 00:37:19 and 2116
   (19 and 11); E122 as before (19 and 11). Their opens take under 0.4 s of lab time (finding 54). `bin/modelcheck.mjs`
   passes the path on E118 and E120 as on E122: the TFT's start, S1, S2, PLAY `0x0608`, INFO `0x060b` and PLAY back to
   `0x0108`, the EVF's start, S1 and S2, the card formatted FAT32 with 2116 shots on the 8 GiB card (exFAT and 9999
   at 64 GiB), S2's picture read back by `refs/volume.mjs`. The count probe fails on all three for finding 42's cause,
   now measured on each: with the query answered with the card's own count by a hook, the application asks six times
   in the 4 s after the start, once in the 3 s after the first S1 and not in the 3 s after a second (X, E118, E120 and
   E122 alike), so the probe's answer at its second window is never asked for. E118 and E120 join E122 in
   modelcheck's checked set, the three in PROBE_XFAIL with that one reason (E118's had been its one-value composite).

57. **The family's INFO still information** (2026-10-31, `src/lab/camapp.mjs` S-PLAYSEQ, `src/fw/facts.mjs`
   stillFields and realTimeGetter, `test/test_playinfo.mjs`; addresses E122's). INFO's `0x0`, `0mm` and
   `0001.00.00 00:00` (finding 52) were no Exif read: api_play_Get_StillInfo_ExifData (`0x502e16b2`) is not called on
   the lab's path (X: an observer, 0 calls). The family's OlyHfwOpePlyCom::getStillInfo (`0x506aae51`) is E143's
   second branch alone, as its getNumber (finding 52): it sends the play module the synchronous request 3 (`mov
   3,d0` `0x506aae93`; E143 with its mode word at 3, `0x50ace3d4`; the ids follow PlyCom's name table, 0
   startPlayService .. 3 getStillInfo .. 5 getNumber, D) and hands the response block to the converter E143's
   component branch uses (`0x506a9cc9`, E143's `0x50acc981`, paired by the port), which S-PLAYSEQ left unanswered:
   the converter read what getNumber's answer left in the shared block (+8 the file number 1, drawn as the year
   `0001`; D, finding 52's answer). On the
   camera the request is a transaction the HLS play component answers (the method `0x5078b672`, D) by
   api_play_Get_StillInfo_ExifData with the image's play-buffer handle (`0x5078b6c1`), which reads the image's Exif
   tags through `play_exif_search_tag` (`0x50ad1fb5`: DateTimeOriginal `0x9003`, PixelX/YDimension `0xa002`,
   `0xa003`, ExposureTime `0x829a` .., D) from the record the play module filled when it loaded the file (the play
   buffer's table at `0xa1c929dc`, `playbuff_get_img_info`; the current handle `0x6189a4f4`, set by
   api_play_Set_Current_ImageHandle `0x502dc680` and Set_Bank `0x502dcfaa` from the play module's code, D). Neither
   the components nor the play module's load runs in the lab, and S2's picture holds no Exif to read: it is
   S-RECFILE's JPEG of the lab's frame (`src/lab/jpeg.mjs`, JFIF only). Not native, then: S-PLAYSEQ answers request
   3 from the picture's own record, kept at its END_SHOOTING_PICTURE: the date the camera's clock gives (its getter
   api_sctime_GET_REAL_TIME `0x502ee369` called natively, fact `clock.real_time`, read by the name its trace loads on
   the family alone: E118 `0x502cb0db`, E120 `0x502be4d7`, X), the size of the JPEG on the card, the release's
   exposure (S-PLAYCOMP's) and the focal length of the lens at the capture (S-LENS's zoom step, in tenths of a mm).
   The layout is the converter's (D, E143's and E122's side by side): the date at +8 (u16 year, then month, day,
   hour, minute, second bytes), the size at +16, the exposure time, f-number and bias rationals at +48, +56 and +72 on
   both, but the focal length E143's u32 +148, E122's u32 +136, the ISO E143's u32 +100, E122's u16 +90; the rule
   (fact `play.still`) reads the copies to the GUI record's +56 (focalLength, by the dump `0x50acd02d`) and +88 at the
   port's place of the converter, or the first call after the getStillInfo wrapper's one call (X, the 18: E143,
   E146, E147 148/100; the E118 family, E137, E142, E140, E145, E133, E130, E129 136/90; E144, E139, E125 144/98; E134
   and E132 another form, null). An exploration with test values gave the units (X: the GUI drew 25 as `2.5mm`, ISO
   200 at +90). The family's clock is not set in the lab: its getter answers its default with the status 10501, E122
   2016-01-01 00:00:00, E118 and E120 2015-01-01 (X, at the start, S2 and INFO; which date the camera's recording
   writes with that status is ?). INFO on the TFT then shows (X, the composite): E122 `2016.01.01 00:00`, `125`,
   `25mm`, `1620x1080`, `100-0001`; E118 and E120 the same with `2015.01.01` (the size the lab's frame, 1620 x 1080;
   25 mm S-EXPOSE's zoom step for the default scene); E118's EVF the same (X). E122's and E120's EVF PLAY stops at
   the key's UI_IN group 5 with more than 300,000 stand-in calls (memset, OlyTaSS), with these answers and without
   them (X), not read (finding 70 reads it). `test/test_playinfo.mjs` reads the GUI's record at the
   converter's return on E122, E118 and E120 against the card's JPEG (decoded by `refs/jpeg.mjs`), the clock and the
   lens (9 checks each), and on E143 that S-PLAYCOMP's answer is unchanged (5184 x 3888, no date, no focal length;
   the picture's record since finding 80).
58. **The playback histogram and S-PLAYCOMP's ISO** (2026-10-31). INFO's histogram drew a bar on the family (X, before
   finding 57): getHistogram sends request 7 (E122 `0x506aaaa0`, E143's always) and copies the response's flag byte
   at +4 and the bins from +8 (and three more pairs at +1032/+1036, +2060/+2064, +3088/+3092; E143
   `0x50acdeb0..0x50acdf8e`, E122 `0x506aab09..0x506aabe7`, D), which held getNumber's index and file number; with
   request 3 answered they held the still information. S-PLAYSEQ now answers request 7 with flags and bins 0, an
   empty histogram (the module counts the decoded picture's levels; the lab decodes none, I), and the cells stay
   empty (X). E143's INFO sends request 7 too (X), its block 0 there but for canMoveCurrent's +8 with two pictures.
   S-PLAYCOMP wrote the ISO of an S-SCENE capture at E143's u32 +100 on every body with component wrappers, where
   ten of them (the E144 family but E134 and E132) read it at u16 +90 or +98 and E134's and E132's converters are of
   a form the rule does not read (finding 57): it now writes it where the build's converter reads it, and none on
   E134 and E132 (logged). E143's, E146's and E147's are unchanged (+100).

59. **The E118 family's movie recorder set-up runs at a movie take** (2026-10-31, `src/fw/facts.mjs` movieRate,
   `src/lab/camapp.mjs` S-MOVRATE; corrects finding 51, which took the set-up for one the lab skips). E118's frame rate
   byte `0xa1c2fad8` has two writers: the set-up `0x50535c83` (its +6) and a setter `0x50535cbb` (X: a byte scan finds
   the address seven times, two stores and five loads); it lies past the image's end (`0x61481020`), a BSS byte, 0 at
   the start as in the lab. Both run on CPU 2, in MVR_MAIN (static task 8194, entry `0x505433eb`, D): its loop takes
   the bits of its flag (`0x60041384`) to the movie recorder's dispatcher `0x5053fcec` (which the other MVR tasks
   call too) with its queues (the words `0x600413ac`, `0x600413ae`, `0x600413b8`: `0x2001`, `0x2002`, `0x2007`, X), which
   gives them row 0 of the handler table `0x60652e60`, the record sequence's state machine `0x5054388e`: a message's
   command becomes an event (`0x505436a9`; queue `0x2001`'s commands 1..32 by the table `0x60653c84`) and the state's
   row of 31 events of 8 bytes at `0x6065305c` its handler (D). The set-up's one caller `0x50534fdf` (which clears the
   info first, `0x50535be0`) is called by the handlers of state 2 / event 2 (`0x50547042`) and of state 0 / event 8
   (`0x50547f09`, which calls the setter too, through `0x505246c5`), D. Event 2 is command 16 on queue `0x2001`, which
   TAKE_FUNC's command 30 sends (`0x502045c3`: it sets its movie bit `0x8000`, sends 2563, 2560 and 3072 to two other
   modules and 4 to the queue at `0x600413b4`, then 16, `0x502046c1`): a movie take's start. Event 8 is command 81 on
   queue `0x2007`, which PLAY_IMAGE (CPU 0's task 29) sends synchronously (`0x50b1b9a2`, from `0x50b1b9c0`): a movie's
   playback. TAKE_FUNC's other synchronous sends to the queue (through `0x50206369` and `0x50207728`) carry the
   commands 1 to 3 and 18 to 23 and 26 (D); what its four 16-byte posts there (`0x501b52f0`, from its commands 28, 31,
   34 and 35) carry is not read (?); the CPU-2 code only reads the queue word (X: the 22 places that load it). So on a camera the movie recorder is set up at a movie take or a movie's playback and never at
   the start: before the first one the rate is 0 there too, and the record time `0x50535bf4` divides by it, the
   MN103's DIVU by 0, which sets V and leaves the quotient undefined (`emu/FIDELITY-NOTES.md` 3.2), where the emulator
   faults. The lab runs neither sender as a task (the start sends TAKE_FUNC, queue 104, its commands 13 and 18 only,
   whose handlers send to the queues at `0x60041150` and `0x60041154`, X and D; S-MODACK answers them) and has no CPU 2.
   E122 and E120 have E118's state machine (the engine's `udfu01 248` row at E122 `0x505541a7`, E120 `0x5051c531`;
   their set-ups E122 `0x505466cf`, E120 `0x5050e919`, each called from the handlers of state 2 / event 2 and state 0
   / event 8, X), and their record times store a word times 1000 where E118's divides (finding 51), so their rate's 0
   divides nothing. What the division computes: at E118's shooting screen the words before the rate hold 134340 and
   104400 (X, 8.8 s), 2239 s and 1740 s at 60p, the screen's `00:37:19` and a 29-minute clip (I, by the values), and
   the quotient times 1000 goes to the record time's +20. Of the query's seven callers two read +20 (`0x502b7571` at
   `0x502b75a0`, `0x502b885f` at `0x502b891d` when its a2 is set); the others read +24, +28, +32 or +36 (D), and in the
   lab's start only `0x502b75d3` (+28) and `0x502b8999` (+32, +36) call it (X: three calls in 9 s). S-MOVRATE now
   stands in for the divide alone: while the rate is 0 the `divu` is not executed and its quotient is taken as 0 (fact
   `card.movie_rate` {div `0x50535c40`, rate `0xa1c2fad8`}), and the record time runs natively, filling its block and
   returning 0, where it returned its error for no struct (`0x9d05`) before (`0x502b7571` answers 0 either way). The
   camera's quotient is ?.
   E118's frames are unchanged (X: the TFT and the EVF at 5 s, the TFT at 9 s) and it passes modelcheck as before.
   What would retire the stand-in: the MN103's DIVU by 0 on hardware (as for E144's movie parameters, FIDELITY-NOTES
   3.2), not a set-up the lab skips.
60. **E143's movie module set-up runs in TAKE_MOV's take job** (2026-10-31). E143's set-up `0x5045c3fd` copies its
   728-byte info into `0xa32ed128` (+720 the rate the movie time query's conversion `0x5044949b` reads), and the image
   loads that address only there and in one copy-out (`0x5045c4bb`; X, a byte scan). Its chain is on CPU 0 (D):
   TAKE_MOV (task 112, entry `0x506e4326`) runs the take jobs of its list (`0x62a484d4`, its flag's bit 1;
   `0x506e458b` -> `0x506e4618`), whose `0x506e46f0` calls the movie API `0x5042d4cb` -> `0x5042d4d4` -> `0x5045afb6`
   or `0x5045b010` -> `0x504361d4` / `0x5043b907` -> the set-up; the jobs are posted by `0x506e43fe`, a handler of
   TAKE_MOV's function table (built at `0x506da030`), from which request of the application is ?. So E143's rate, too,
   is 0 before a movie take on the camera, and the query's log `0x39000903` there (MOVIE_TIME_ERRLOG, also E146's and
   E147's) is the camera's state (I), not the lab's gap: the errlog's description says so now. The movie module's
   set-up is a movie take's on every body read; running it natively is a movie take's work (TAKE_FUNC, TAKE_MOV and,
   on the E118 family, CPU 2), not a start's.

61. **The E118 family asks for the count when its shooting screen is redrawn** (2026-10-31; X: an observer on the shots
   query with the return addresses on its stack, on the count item and on the screen's update, and the composite read
   back; read on E122, measured alike on E118 and E120). E122's getAvailableShootCount (`0x506b3aff`) has no direct
   caller: it is a slot of OlyHfwOpeShoot's vtable (the word at `0x509571d0`, D), reached through the HLS API (the
   return `0x50715b76`, X). Two GUI clients ask it (X): the card-full test (`0x50b7b26c`, E143's `0x51055c38` by the
   port's pairing) and the shooting screen's count item (`0x50ca1608`: it asks the API through its object and stores the
   count at +8 of its block, the form of the E142 lineage's item, finding 16, D). The item's update (`0x50c9ae11`) asks
   where its screen's update word +1952 is 0, or 1 with +1956 among the eight values of its table (D); it runs only from
   the screen object's update (`0x50c96925`, a vtable word at `0x50f52ee4`), which calls the updates of the 115 items of
   its table (`0x50c96dd4..0x50c96e19`, D). That update runs when the GUI task takes message 0xf000 (its state table's
   dispatch `0x50baaa32`, called at `0x50b98375`, X) after the GUI's camera-event handler (`0x50b97a00`, the event in
   d0) posts GUI event 0xf001 for an application event. Measured (X; the start's and the S1s' counts the same on the
   three): the start, one redraw on the events `0x03000058`, `0x03000057`, `0x03000055` and `0x09000022` (the item once,
   the card-full test five times: finding 42's six queries); the first S1, one redraw about 3 s after it, on
   `0x03000057`, the end of the shooting information's 3 s timer (I: E143's timer 3 posts that event,
   `docs/om1-shutter-spec.md` item 41), which no later S1 starts again (why is ?); a later S1, none: S1's own events
   (`0x01000002`, `0x01000003`, `0x03000032`, `0x03000033`) post no redraw, and no redraw ran in 6 s of idle after it;
   PLAY back to shooting, one at the screen's entry and one on `0x03000057` 3 s later; INFO, redraws on its key's events
   (`0x0100002a`, `0x0100002b`) and `0x09000022`, 26 queries in four presses. So the lab delivers the events the
   family's application asks on; where the E142 lineage's and the E143 family's GUIs ask at their refreshes (findings
   16, 18), the family's asks only when the screen is redrawn. INFO cycles the shooting screen's four views back to the
   first on both panels of the three: the frame after four presses is the one before the first, pixel for pixel, after
   one, two or three 12833 to 47207 pixels differ (X). PLAY and back also redraws with the count on the TFTs and E118's EVF,
   but on E120's and E122's EVF PLAY stops at the step's bound in a task that polls a word every 40 ms (E122
   `0x502f936b..0x502f938f`, the word `0xa1c5a80c`, D; read in finding 70: the VSC's line compare).
   `bin/modelcheck.mjs` now takes PROBE_REDRAW: for these three, INFO pressed until the screen is back (four presses,
   X), then four presses before each of the probe's windows (26 queries each time, X). The count follows the query to 777 and back on the three on both panels:
   the TFT's box at 643,443-710,469 (E118, E120) and 645,444-710,469 (E122), the EVF's at 902,710-1010,753 and
   905,712-1010,753 (X, `bin/modelcheck.mjs`); the three are out of PROBE_XFAIL, which is empty, and the other 14
   bodies' probes run as before.
62. **The family's screen after a shot** (2026-10-31; X: the composite after S2 on E118, E120 and E122's TFTs). At S2
   E122's item asks once, at the shot's start (with the events `0x01000004` and `0x0300000c`), and the card-full test
   four times after `0x03000001`. The screen then shows no OSD for at least 9 s and after an S1, until INFO, which
   brings back the shooting screen with the count before the shot (2116 on E118; whether the card's count after one of
   the lab's pictures is the same is not read, ?). On the camera the shooting screen comes back after the rec view; what
   ends it there, and whether the lab withholds that event, is ? (read in finding 69: the through image's start). Not
   exercised: a setting change (E122's MENU, and OK a second time in the super control panel `0x0407`, stop in an
   event storm, X; the panel's open asked the count twice) and the card's insertion.

63. **The us clock counted CPU reads until the play bring-up, on every body** (2026-10-31, `docs/om1-intc-timer-spec.md`
   section 3.1). Each board's us clock is one free-running counter of the one timer model (`src/dev/timer.mjs`):
   E143's family channel 33 (`0x98900284`, read by `0x50002bfa`), the E144 family's channel 27 (`+0x14c`, E144 reads
   it at `0x50002397`), the E118 family's channel 9 (`0x98900074`, read at `0x50001ec8` / `0x50001ecf` / `0x50001ef1`
   on E118 / E122 / E120; `src/fw/board.mjs` `us_channel`, D). H-USCOUNT, one count per CPU read and lab time
   ignored, is M2's stand-in for the hardware's counter at 1 MHz (A-TMR-2), from before the lab had a clock: it kept
   every timed poll moving, deterministically. M10 added A-USLAB (the lab us plus every CPU read) as the player's
   opt-in only and wrote it on after the touch bring-up inside the play bring-up, so that the other labs' outputs and
   the play session's bring-up, which M10's play checks compared with the nav lab's, stayed the same; no failure
   with it from the start is recorded, it was not tried (commit history: M2 `ab32095`, M10 `ebf28ea`). So on all 18
   bodies every wait on the clock before the play bring-up lasted as many CPU reads as its microseconds. A census
   of the clock's CPU reads with their callers up to the end of each start (X: an observer of the counter's reads,
   the caller from the stack; 18 bodies, TFT and EVF sessions) found three kinds of wait there:
   - *A wait with sleeps between its reads*, which the reads stretched: the E144 family's open-time wait, 2 ms
     sleeps (`0x50030a0b(2)`) until the word `0x620c662c` is 1 or the d1 ms have passed on the us clock (E144
     `0x5018a924..0x5018a987`, D), called with 150 ms by the open (`0x50181ef8`), whose timeout logs `0x37005206`
     through `0x50041d51` (`0x50181f05..0x50181f18`, D); E120's touch INT wait's form (finding 54), the touch
     controller's INT by that form and the 150 ms (I; its pin and callback on E144 are not read, ?). One read per
     sleep: 150,001 reads and 300 s of lab time on the TFT of E144, E139, E134, E137, E142, E140, E125, E133 and
     E130 (callers E144 `0x5018a969`, E139 `0x5018b521`, E142 `0x5016c71a`, E140 `0x5016c5e9`, E134 `0x5021827a`,
     E137 `0x501771cb`, E125 `0x5022d50b`, E133 `0x501f8abc`, E130 `0x50207ce6`), and on the EVF a second wait of 40
     ms after the first (E144: 190,002 reads, 380 s; E125 250,002 reads, 500 s). The E118 family's touch INT wait
     was this kind before S-TPINTWAIT (finding 54). The E144 family's starts thus reached the play bring-up at 300.1
     to 300.4 s of lab time on the TFT and 380.3 to 500.3 s on the EVF; modelcheck passed them so.
   - *A busy wait inside one lab instant*, which takes as many reads either way: 25 us at the start's timer steps on
     every body (26 reads; E143 `0x50003a7e`, E144 `0x50003198`, E118 `0x50002e4d`), 210 us on the TG-5s' TFT
     (E129 `0x50051cb2` / `0x50051cba`), and E118's EVF serial loop at 32 ms (`0x5006f318` / `0x5006f320`, 147
     reads).
   - *Loops that end on a condition and read the clock for a timeout or a log*, whose lab time the clock does not
     set: E120's and E122's EVF loop (`0x5006cadb`, `0x5006b280`: 111 rounds over 140 ms), E147's EVF loops at 28.7
     to 35.4 ms (`0x501d35c8`, `0x501d35e9`, `0x501d36a4`), E143's display power sequence's timestamps (one read
     per step, logged with the step: `0x501d8844` .. `0x501c6170`).
64. **The us clock on lab time from the reset** (2026-10-31, `src/dev/timer.mjs` usCount, `src/lab/play.mjs`). Every
   lab's us clock now counts the lab microseconds since its load from the reset (A-USLAB, the timer window's USMODE 1
   by default), and a CPU read gets at least one count more than the read before: a busy wait still ends in zero lab
   time (CPU execution takes no lab time), and the counts it ran ahead are not counted again once lab time passes
   them, where M10's A-USLAB added every read since the reset to the lab us. The player's `--us-clock reads` writes
   USMODE 0 (H-USCOUNT) at the lab's creation, before the bring-up; the switch inside the play bring-up is gone. The
   census again (X), the play bring-up's lab time before -> after: E144 TFT 300.44 -> 0.53 s, EVF 380.64 -> 0.75 s;
   E139 300.26 -> 0.34, 380.32 -> 0.43; E142 and E140 300.28 -> 0.43, 380.48 -> 0.67; E134 300.20 -> 0.35, 380.28 ->
   0.47; E137 300.26 -> 0.34, 380.44 -> 0.55; E125 300.20 -> 0.35, 500.29 -> 0.53; E133 TFT 300.11 -> 0.26 (its EVF
   session stops before, on more than 300,000 stand-in calls, as on master); E130 300.11 -> 0.26, 380.31 -> 0.50. The
   open-time wait now takes its 150 ms (76 reads) on the TFT and 190 ms with the EVF's second wait (97 reads over
   222 ms; E125 127 reads over 346 ms), still running to its timeout: the lab raises no INT. The other 18 x 2
   sessions' bring-up times are unchanged (E143 TFT 202.2 ms, EVF 446.7 ms; E146, E147, E145, E129, E132, E118,
   E120 and E122 alike), and so are the busy waits' read counts. S-TPINTWAIT's reason stays, its cost changes: without
   it E120's TFT open takes 0.34 s instead of 0.19 s and its EVF open 0.29 s longer (X), no longer 300 s and 500 s.
   E143's golden sessions keep their screens, devices and outputs, and their stops and hooks keep their names and lab
   times (X: shoot-tft's trace against master's, 59,724 events of the same kinds at the same lab times); the
   register and memory digests differ from 206.19 ms of lab time on, the first reads after the play bring-up, where
   A-USLAB had added the 69 reads made since the reset and every later one. playperf's digest is unchanged; check_irq
   I9 checks the new rule (mutant 30 still caught) and check_perf's P6 and P10b register digests change with the
   same instruction counts. Next: the E144 family's wait could be read by its form for S-TPINTWAIT, as finding 54's
   rule reads E120's and E122's.
65. **The OM-5 II (E148) and modelcheck's path** (2026-11-01). The updater's reply for E148 is not the PEN the probe
   expected: `model_name` "OM-5 Mark II", `file_name` `OLY_E_148_1100_0000_0000.BIN`, `up_date` 2026/10/28, 90,832,896
   bytes (D: `fw/E148_reply.xml`). Its main block is 23.7 MiB with two olycompress sections at 0x60021020 (7.5%), its
   resource block 12,582,848 bytes, and its MMIO is the E144 family's (ISC 0x8fe00000, VSC 0x9c000000, the engine at
   0x9c100000; X, `bin/fw-survey.mjs`). The cross-build maps agree: 9,503,564 instructions pair with E144's build and
   2,471,331 with E143's (X, `bin/port.mjs`), so its hardware layer and most of its application are E144's, and its port
   is chained through E144 (`port_via`; `carry` `cflush_returns` and `block_save`; finding 43), which takes 98 of E144's
   117 overrides over (47 of them nulls) with 19 failing, 6 nulls gated by a fact and 2 addresses filled from E144's map
   (X: `emu/out/port/E148/port.json`). Its GUI is not E144's: the image holds `Menu_ListMenu_Tab_Menu_` and
   `Menu_Viewer` (D, a string read), and its ListMenu open reads the settings object's getter at vtable slot 8, not 12,
   for the tab and the page memories 1909 and 1910 (0x50e77adb, 0x50e77afb, D), E147's ids. `src/fw/facts.mjs`
   menuMemory now tries the slot at 12 and at 8, the tab and the page at the same one; E143, E146 and E147 find their
   pairs as before and no other body finds one (X). The port translates 900 addresses, leaves 49 unmapped and 7
   collisions (X). `bin/modelcheck.mjs E148` passes on the TFT and the EVF (start 0x0108, S1, S2, PLAY, INFO, PLAY; the
   count at 186,3,228,29 on the TFT and 282,5,350,48 on the EVF) and its card is native: an 8 GiB SDHC card, FAT32
   "OM SYSTEM" at sector 8192 in 32 KiB clusters, formatted, 826 shots counted and one file read back (X). The menu does
   not come up: nav's bring-up reads an address the map cannot place (0x62b3e364, a text module's data, `src/lab/text.mjs`
   check_init) and 18 of the lab's menu addresses are unmapped, the bar the E144 family's own menu trials stop at (X:
   `bin/nav.mjs --model E144` stops at its GUI buffer tables), so E148 is at the family's: the shooting path and
   playback, not the menu. Pinned in `BLOBS.sha256` with its five unpacked blocks. (Since 2026-11-02 its menu runs
   in a play session, findings 66 to 68.)
66. **The E144 family's menus in a play session, and the OSD planes' stacking** (2026-11-02; X: a play session per
   body on the TFT, MENU, RIGHT, DOWN, OK, MENU, MENU from the shooting screen, with frames). Before (the lab of
   2026-11-01): E139's and E134's MENU opened the camera's Shooting Menu 1 with its rows, its sub-screens and MENU back
   and out; E144's opened it with the rows hidden (the title, the footer and the current tab's icon only, the rest
   black), though RIGHT, DOWN and OK worked behind it (OK opened Picture Mode, drawn whole); E148's (the ListMenu,
   `0x0b02`) opened with its rows dim and the highlighted row empty; E137, E142, E140, E125, E130, E133 and the E118
   family stopped at MENU's press (finding 67); E145, E129 and E132 were not tried past their date prompts. E144's
   GUI drew the rows: its draw log at MENU is E139's, call for call (X). The difference is where the planes go. The
   kind-2 commit takes each OSD plane's address from a word of the display record: E139's OSD1 from word 2
   (`0x501889f9`), E144's from word 0 (`0x50187e33`), so E144's OSD1 shows GUI layer 2 and its OSD3 layer 0 (D; X: the
   registers at the shooting screen), and the lab drew OSD3 on top, where E144's menu background (layer 0, an opaque
   fill over rows 50..431) covered the rows (layer 1). The OSD-plane open writes the word at `+0x1a4` (OSD1 in E144's
   name table) 2 on E144 (`0x50022fbf`) and 3 on E139 (`0x500230f2`), a setter (`0x501872ac`) replacing its low nibble
   from the device's record (D); on the 16 bodies of kinds 2 and 3 it is 3 with layer 0 in OSD1 but on E144 and E148,
   which write 2 and put layer 0 in OSD3 (X). The compositor now stacks the OSD planes by it: 3, OSD1 at the bottom;
   2, OSD3 at the bottom (I: on both GUI layer 0 is then at the bottom, which the menus need; the chip's definition
   of the word is not read); another value is refused, and kind 3 takes 3 only (`emu/src/dev/vsccompose2.mjs`,
   `docs/om1-vsc-spec.md` section 12). E144's and E148's menus show their rows, and their shooting screens and
   modelcheck's path are unchanged (X).
67. **The menu open's event sets are coalesced, not a storm** (2026-11-02). On E137, E142, E140, E125, E130, E133,
   E122, E118 and E120 MENU stopped with "event storm: more than 810 GESetEvent calls" at the press (GUI state
   `0x1101`). Without the guard the press settles and the menu opens (X, E142: 1128 sets, 145 messages taken): the
   open calls one function about 980 times (E142 `0x50ce1a2e`, from `0x50ce3f4c`), each setting `0x1002` (the set
   returns to `0x50ce1c4f`, E143's `0x510a25a9`), which the GUI takes 3 times; E144's open makes 120 such sets. GESetEvent does not queue an event
   that is already pending (E143 `0x510ba2c2`: `0x1002` and `0x1100` by their pending bytes, the others by a scan of
   the pending list, D). The lab's guard (`emu/src/lab/nav.mjs` NavLab) now counts only the sets that queue, an event
   being pending from its set to its take (I: the dispatch takes it off the list); the step records still count every
   set. check_nav's storm (N3's MENU deferred into itself, taken before each set) still stops the session (X).
68. **E137's and E125's buffer sync, and MENU in modelcheck** (2026-11-02). On E137 the menu then drew over the
   shooting screen's last frame (X: its bottom bar under the menu's rows, no footer): its GUI syncs a layer's two
   buffers with copies of 800 x 1200 from record 2k to record 2k + 2 (its banks hold four 896 x 600 records; its
   screen descriptor says 800 x 1200, finding 7's `guiCanvas`), and the OSD engine's guard of one record refused each
   (GUARD, six at MENU on E137 and on E125, X). A GUI session's guards now run from each record to the end of its bank
   (`emu/src/lab/osd.mjs` GUI_GUARDS): a draw may cross into the next record of its kind, not out of its bank. With
   findings 66 to 68 the menu runs on every ported body of the E144 and E118 families on the TFT (X, frames): MENU
   opens Shooting Menu 1 (`0x1102` on the Menu_Viewer builds; `0x0b02` on E148's ListMenu, there at Setup's
   Card/Folder/File), RIGHT enters the page, DOWN moves the tab or the cursor, OK opens a setting (E144 Picture Mode's
   list, E145 Focus BKT's choices, E148 Lens Info Settings), MENU goes back and then out to `0x0108`; E145 and E129
   after their date prompt's MENU, E132 after its clock set. On the EVF it runs the same on the kind-2 and kind-3
   bodies but E122 and E120, whose press at MENU runs to the hook-stop limit with the lab clock at about 3000 s,
   sleeping in OlyTaSS (X; why is ?, their TFTs and E118's EVF open the menu); on E146 and E147 the menu's EVF
   composite has the dimmed plane at PLANC `0xb2`, which E143's compositor refuses, as in their EVF playback. (With
   the kind-3 VSC's line compare, finding 70, E122's and E120's EVF run MENU, DOWN and MENU too; modelcheck no longer
   expects them to fail, X.)
   `bin/modelcheck.mjs` now takes MENU, DOWN and MENU after the path (on the EVF after S2), judged by what each
   changes: MENU leaves the shooting screen's state with the frame changed, DOWN keeps the menu's state with the frame
   changed, MENU brings the shooting state back (the menus' states are unnamed on most builds: the E144 family's
   SS_MENU parent lies past the 12 parents the lab names, finding 17); the four EVF failures above are expected
   strictly (MENU_EVF_XFAIL). Open: `bin/nav.mjs --model E144` still stops at its own GUI bring-up's checks, which are
   E143's shape (`emu/src/lab/text.mjs` check_init: the GUI buffer tables hold E143's record pairs where E144's banks
   hold four records a kind, the icon table and its word 1 point elsewhere than the resource blob's words, and four
   tasks start, `0x500216a0`, `0x50d36d1c`, `0x50e15cb6` and `0x508396e7`, where the check names three); a play session, where the application creates the GUI (H-GUIBYAPP), does not run
   them. E144's port leaves 25 of the lab's menu-module addresses unmapped: 10 of E143's ListMenu decode tables
   (`emu/src/lab/menudata.mjs`, read where `menu.list_menu`) and 15 in `emu/src/lab/menu.mjs`, the store init's SCPU
   request, waits and replies (used where `scpu.backup`), the NAND post and a dropped send's site; the sessions above
   run with them unmapped (X).
69. **The screen after a shot comes back with the through image's start** (2026-11-02, `src/lab/camapp.mjs` S-RELSEQ;
   answers finding 62; X: the application's and the GUI's own traces, read on E122, and the composite after S2 on the
   bodies' TFTs). The application's trace function (E122 `0x50b971e5`, `mov <name>,a1; call` as finding 53's) shows S2
   run to its end: END_SHOOTING_PICTURE takes it back to its shooting ready state ("startMoveToShootingReady",
   "moveStateToShootingReady"), and its request for the shooting information (`0x09000022`) reaches the GUI before
   START_RECVIEW, which S-RELSEQ posts in the same batch. The GUI's own trace (its printf-form function `0x50cef73c`,
   the format at the caller's (4,sp)) then logs `guiEventFilter::DRAW_RECVIEW_SYNC` for EVT_REC_DISP_RECVIEW (`0xf005`):
   its rec view flag `0x6161bf88` is set (the setter `0x50cf4739`), the rec view's viewer chosen and the three layers
   cleared (X: the buffers' histograms). END_RECVIEW reaches the GUI as the application's relay `0x03000014`, and the
   GUI logs nothing (the relays are the CBK names' indices in the image's order from `0x50da52d2`: `0x0300000c`
   START_SHOOTING_PICTURE, `0x03000010` START_RECVIEW, `0x03000014` END_RECVIEW, `0x03000057` TIMER_RECINFO_3S, X:
   each relay with its callback). Neither the rec view component's state word at 4 (finding 53: the View entry's
   state) from START_RECVIEW to END_RECVIEW nor CBS_RECVIEW_TIMEOUT (295) or CBS_REQUEST_DISPLAY_RECVIEW (294) posted
   before END_RECVIEW changed that (X, tried): the application's END_RECVIEW handler sends the GUI no request either
   way. CBS_START_THROUGH_IMAGE_PROCESS (258, relayed as `0x0300000b`) does: the GUI's filter takes
   EVT_REQ_REC_DISP_INFO (`0xf001`), ends the rec view flag ("[GUI End]", the clear `0x50cf475f`), creates the shooting
   information and draws it (X). The HLS shooting reactive posts 258 for the notification 1366 (E143: its handler
   `0x50af4a63` in the table `0x60dfec00`, key 943; the notification's builder `0x50af2daf`, which CapThr_ThroughImage
   calls at `0x50bd2488` and CmpSqp_SequencePartsBase at `0x50c87ef1` and `0x50cacf6b`, the files their allocations
   name, D): the through image's restart (I, by the names; when the camera's comes after the rec view is ?). The lab
   never posted it. S-RELSEQ now posts it with END_RECVIEW (fact `cbs` gains the name: 258 on all 19 builds, X, the
   rule). The TFT 0.7 s after the rec view, before -> after (values in the frame, X): E118 1 -> 18, E120 1 -> 19, E122
   1 -> 16, E142 1 -> 20, E140 1 -> 20, E130 1 -> 21, E133 1 -> 20, E145 1 -> 17, E129 1 -> 16, E132 1 -> 15; E143,
   E144, E139, E134, E137, E125 and E148, whose GUIs come back at END_RECVIEW already, keep their frames pixel for
   pixel (E143's application asks the count twice more). The family's EVFs show the shooting screen
   again too (10, 11 and 8 values on E118, E120 and E122, X). The count item asks the query at that redraw
   (twice, X), and the firmware's count after the picture is the one before it (E118 and E120 2116, E122 1470, X: the
   query called after S2): how it rounds the card's free space is not read. `bin/modelcheck.mjs` now requires a frame
   of more than one value after S2 on every body and panel.
70. **E120's and E122's EVF playback waits for the VSC's line compare** (2026-11-02, `src/dev/vsc.mjs`,
   `src/fw/board.mjs` vsc.line_irq, `docs/om1-vsc-spec.md` section 12; reads finding 61's 40 ms poll and finding 57's
   stand-in calls). PLAY on E122's EVF ran 3000 s of lab time in the display task (static row 0x51, `0x502f90f5`)
   until UI_IN group 5's bound, with 225,070 memset and 74,998 OlyTaSS calls (X): on its flag's bit 4 the task asks the
   EVF panel for a change (`0x502f9313..0x502f9369`) and polls, 40 ms at a time, the word `0xa1c5a80c`, re-arming the
   driver's line compare for its device each round (`0x503078b9(6)`; `0x502f936b..0x502f939a`, D). Only the EVF
   panel's command scheduler `0x502f946a` sets the word (its stores `0x502f9690`, `0x502f9822`, `0x502f99fe`, after
   GPIO pin 139 and the serial send, D), and both VSC ISRs call it on INTST1 bits 4 and 5 (`0x50305c23`,
   `0x50307238`); the arm `0x50307960` writes the line into `+0x260` and enables the mask word `0xa1c5ca4c`, which
   holds 16 or 0 only (X, a byte scan). The kind-3 model raised bit 0 at the frame alone: the ISR ran every frame
   (59,999 times in the stall) and the scheduler never (X). The board now gives the line compare (`line_irq` {+0x260,
   bit 4}, irq_mask 0x11), and the model raises the bit as the scan reaches the line, once a frame, while INTEN1 holds
   it (I: that the compare counts MONI3's lines). E122's EVF then runs PLAY `0x0608`, INFO `0x060b` and PLAY back to
   `0x0108` (X: the scheduler 40 ms after each arm), and so does E120's, whose ISR test (`0x502d337a`) and arm store
   (`0x502d4e72`) are E122's form; E118 holds stores to `+0x260` in its opens and no test of that form (X, a byte
   scan), and its EVF played back before. The scheduler now also runs at S1 and S2 (armed there before, never raised);
   the family's modelcheck results are unchanged, and `bin/modelcheck.mjs` runs the three's EVF through the whole
   path (EVF_PLAY). `test/test_vsc3.mjs` checks the compare on E122's and E118's boards.
71. **REC's whole-file recorder on five bodies** (2026-11-02, `src/fw/facts.mjs` recorder, `docs/hle-gaps.md` 4.8.9).
   E143's `0x519f9dd7` records a file from a buffer through REC_FILE's own steps: three blocks of 64, 100 and 116
   bytes, then the lock, the camera's clock read (`0x5012b7cd`), the DCF open (FILECLBK code `0x32`), the cluster
   reservation (`0xf1`), the chain write (`0x54`), the directory entry (`0x66`), the registration (`0x33`), the cancel
   on an error (`0x36`) and the unlock (D). The rule finds it by the three allocations and reads the calls after them:
   one on E143, E146, E147, E144 and E148, none on the other 13 images (X, a byte scan); its clock reads are E146
   `0x5012bafe`, E147 `0x50135923`, E144 `0x500f024e`, E148 `0x500f0271`, and the open's, the entry's and the
   registration's builders each send their code once (E144's and E148's after an `exth d0`, E144 `0x50400745`; X).
   E143's rec_file functions call the same builders (`0x5053f591`, `0x505408b5`, `0x50540950`, `0x5053f875`); the
   older 13 bodies' recording modules are not read, and S-RECFILE writes through fileif there.

72. **The DCF database's counts** (2026-11-02, `src/fw/facts.mjs` dcfCounts). The media API's image count
   (`0x503feea4`) reads a table of 52 bytes a slot through `0x502d1799` (+4 + 4 x type for types 1..8, +40 type 255,
   +44 type 9, +48 type 33), to which the registration's count update adds (`0x50874b48`); the getter is the same
   instructions on each of the 18 images, once (X, a byte scan): E143 `0xa33aa5b4`, E146 `0xa33dd268`, E147
   `0xa33c4f1c`, E144 `0xa26fcbe8`, E148 `0xa274bd98`, E122 `0xa1c874f0`. The lab reads the count there where the
   database holds the pictures, so a status read calls no firmware.

73. **The DCF names by the clock, and fileif beside a pending fnode** (2026-11-02, X on E143). The DCF open names the
   file `P`, the time stamp's month in hex, its day and the number (`0x5087a253`): `PB020001.JPG` for a stamp of
   2026-11-02. E143's clock read answers 2022-01-01 00:00:00 with status 10501 in the lab (its sub-CPU's clock not
   set), so S2's files keep the names `P1010001.JPG` and on. A fopen through fileif of the name an open fnode holds
   wrote a directory entry with a scrambled short name, and fileif's entries carry the file layer's date (2022-01-01)
   rather than the stamp: REC's directory entry (`0x66`) is what gives the file its name and date.
74. **The E144 family's touch INT wait, read by its form** (2026-11-02, `src/fw/facts.mjs` touchIntWait, `src/lab/menu.mjs`
   S-TPINTWAIT; the next stop of finding 64). The rule had found the wait from the "TP INT TIME OUT" trace, which only
   E120 and E122 load after it; it now finds the wait by its own form, one of two openings that clear the word W when
   called with d0 1, followed by the poll `mov (W),d1; cmp 1,d1; beq` (D): E120's `mov d1,d2; clr d1; mov d1,(4,sp);
   cmp 1,d0; bne; mov d1,(W)` (E120, E122, E125 `0x5022d4d4`, E130 `0x50207caf`, E133 `0x501f8a85`, and E129 and E132,
   whose drivers have no panel to open), and E144's `mov d1,a3; mov d0,d2; clr d0; mov d0,(4,sp); mov <pin>,d0; call
   <enable>; cmp 1,d2; bne; clr d0; mov d0,(W)`, which enables the pin's interrupt first (E144 `0x5018a924`, W
   `0x620c662c`, pin 120; E148, E137, E142, E140 pin 120, E139 and E134 pin 88). On E144 the pin's callback
   (`0x5018b191`, attached to pin 120 by the driver's init `0x5018a7e7` at `0x5018a809`) stores 1 in W while the word
   after it (`0x620c6630`) is 0 and otherwise disables the pin and sets bit 1 of the touch task's flag (D), as E120's
   does for pin 30. One wait on each of those 16 bodies, none on the E143 family, E145 and E118 (inline, finding 54)
   (X, a byte scan of each expanded image). The device open calls it with 150 ms (E144 `0x50181efb`, E125 `0x5022a568`,
   E130 `0x5020176c`, E133 `0x501f24be`, E134 `0x5021139c`; the timeout logs the numbered error `0x37005206` on E144
   through `0x50041d51`), the touch task's power-up commands with 40 or 100 ms (E144 `0x5018a0ca`, `0x5018a0fa`,
   `0x5018a158`, D). S-TPINTWAIT now answers it on the ten E144-family bodies with a touch panel: the play bring-up's
   lab time (X, a session per body and device), TFT before -> after: E144 and E148 525.10 -> 375.10 ms, E139 and E137
   340.10 -> 190.10, E134 and E125 346.41 -> 196.41, E142 and E140 425.00 -> 275.00, E130 and E133 264.00 -> 114.00;
   EVF, two answers (the open's 150 ms and its EVF wait of 40 ms): E144 and E148 748.24 -> 558.24, E139 429.78 ->
   239.78, E134 469.46 -> 279.46, E137 546.55 -> 356.55, E142 and E140 666.09 -> 476.09, E125 531.07 -> 280.93 (its
   EVF wait is 100 ms), E130 501.09 -> 311.09 (E133's EVF session stops before, on more than 300,000 stand-in calls,
   as on master). E120 and E122 are unchanged (TFT 194.00 and 175.41, EVF 392.97 and 332.92 ms).
75. **Touch on the E144 family** (2026-11-02, `src/lab/play.mjs` H-TPINIT, S-TPREG, S-TOUCHMAP, `src/lab/touchpanel.mjs`,
   `test/test_touch.mjs`; X: a play session per body on the TFT, taps through the player's router as webgate's B6
   sends them). Before, on the ten bodies whose touch the lab runs (E144, E148, E139, E134, E137, E142, E140, E125,
   E130, E133), a tap reached nothing: the touch task took the flag's bit 1 and ran its INT handler (E144
   `0x5018af22`), which returned at once, the driver's armed word `0x620c6630` being 0 (`0x5018af23..0x5018af2f`,
   D; no I2C read, no HFW callback, X). Three stops, in the order they were met:
   - *The touch init after the display open.* The open's command list powers the panel up, waits for its INT (finding
     74) and then arms the driver for the INT's data (`0x5018a9a4`: W 0, `0x620c6630` 1, called at `0x50181f1f`, D);
     the lab ran the boot's touch init (H-TPINIT, E144 `0x50189dc3`, called by the boot at `0x500251a8`, before the
     display opens) in the play bring-up, after the start's open, and the init's driver set-up `0x5018a7e7` clears
     both words (`0x5018a81b..0x5018a826`, D; X: armed at 525.1 ms, cleared at 525.1 ms by H-TPINIT). The lab now
     calls the touch init before the start's open on a build whose driver waits for the INT (fact touch_int), as the
     boot does. On E143, whose open runs no touch code, the same move changed 28 golden sessions' stops and replay
     outcomes (X), so E143 keeps the lab's order.
   - *The controller.* The E144 family's driver reads the controller at slave `0x48` with 16-bit register addresses
     (d1 the high byte, a1 the low; E144's read `0x5018adf3` sends them as the transfer's address bytes,
     `0x5018ae80..0x5018ae8f`; the same opening on E142 `0x5016cbe8`, E125 `0x50185997`, E120 `0x502d9bd2`, D), where
     S-TPREG served E143's controller only (slave `0x70`, register 2) and read 0 for the rest. Every body but the E143
     family reads slave `0x48`, the E143 family `0x70` (X, the immediates at each read call of each image). After the
     INT the driver reads 10 bytes at `0x0000` (`0x5018b4d7`): byte 0's low nibble the number of touches, byte 1's low
     nibble the event, byte 2 the points' touch ids, point 0's x and y in 12 bits from bytes 3..5, point 1's from 7..9
     (`0x5018b503..0x5018b557`); with event 0 one byte at `0x1c0a`, whose bit 1 must be set (`0x5018b56f..0x5018b57f`).
     Its control area is off (`0x620c6480` 0: nothing sets it in the lab's sessions, the application's
     Set_Touch_Panel_Ctrl_Area, API `0xd001f`, not being called, X), so the driver passes the controller's event on:
     0, 1 and 8 end a touch, 2 and 3 carry the point (`0x5018bca1..0x5018bcd5`); with the area on it derives the same
     codes from the ids itself, 2 at a new id, 3 while it stays, at its end 1 within 150 ms of the press, 8 for a
     second tap within 800 ms, else 0 (`0x5018b8d4..0x5018ba6b`, D). S-TPREG now answers each read from the controller
     at its slave: `0x48` a down as event 2 with id 1 at point 0, a move 3, an up event 1 within 150 ms of lab time of
     its down and else event 0 with `0x1c0a` bit 1 set (I: the driver's own codes; which codes the controller sends,
     and what bit 1 means, are ?), x and y the TFT panel's pixels (the driver bounds an area by 720 x 480,
     `0x5018a2b1`, and flips only for the swivelled monitor, `0x5018c2d9`, D). The register address's form is read by
     a rule (touch_args read_addr: `['d1']` on the E143 family, `['d1', 'a1']` on the 15 others with a touch read).
   - *The GUI's touch message's index.* S-TOUCHMAP posted sendEvent index 109, E143's touch message `0x9100`; the
     event maps of E137, E142, E140, E125, E130 and E133 lack E143's 107 and 108 (messages `0xf839`, `0xf83a`), so
     `0x9100` is their 107 and 109 is `0x9201` (X, each image's map): their HFW saw PRESS and CLICK and their screen did
     not change (X). The session posts at the build's index of `0x9100`. The same shift moves E143's MENU_EVENT `0x87`
     to `0x9628` (E143 `0x9624`) and CONNECT_EVENT `0x83` to `0x9622` (E143 `0x9601`) on those six (X), which the
     menu and display-switch paths use.
   After (X): a tap (down, up) on the shooting screen's touch mode icon gives HFW PRESS and CLICK at the pixel on all
   ten bodies and cycles the icon (touch shutter, off, touch AF) as on E143 (frames); a press of 150 ms or more ends
   in LIFTOFF. A tap in the super control panel selects the cell tapped (E144: Face Priority at 360,240 after OK). A
   tap on the live view in touch AF mode reaches HFW (PRESS, CLICK) and changes nothing on screen, on E144 as on
   E143 with S-LENS: S-CAFWD drops the GUI's forward to the camera. `test/test_touch.mjs` taps the icon on E143 and
   the ten (bin/test.mjs).
76. **The E118 family's touch** (2026-11-02, X). Their touch stays off (`src/fw/models.mjs` touch false): H-TPSTART
   needs the panel's open, which `src/fw/facts.mjs` touchOpen does not read on their builds and the maps do not place
   (corrected 2026-11-10: the HFW callbacks were placed, finding 84; touch runs since findings 84 to 89). Their drivers
   read the same controller at slave `0x48` with the same register addresses as
   the E144 family's (X: the read calls' immediates; E120's read `0x502d9bd2` opens as E144's, D), so S-TPREG's model
   would serve them once the open is placed. E120's and E122's INT waits are unchanged (finding 54).
77. **The browser player in Firefox** (2026-11-02, `bin/browsergate.mjs`). In the OrbStack VM (Arch Linux ARM,
   aarch64), Firefox 159.0 headless through geckodriver 0.37.1, on the published site (`bin/site.mjs`, 127 files,
   2.66 MiB) served under `/om-emu/`: the landing page's link, the E143 `.BIN` through the file input (unpacked in
   0.37-0.49 s, written to OPFS in 0.09-0.13 s), the shooting screen (0x0108) at 2.84 lab s, the canvas read back
   equal to the RGBA the Worker sent (frame 1, sha16 `42a5747dde3ac6d8`, the digest WebKit's canvas and node's
   conversion in `bin/webgate.mjs` give too), M, Down, M, the
   press on the monitor at (35, 465) and Enter each to its GUI state (0x0b02, row 0 -> 1, 0x0108, the touch answered,
   0x0403), S1 and S2 to one picture that the Card panel reads (FAT32 "OM SYSTEM" on the 8 GiB SDHC card, a 96 x 64
   thumbnail, the 1620 x 1080 view), LV to the EVF and back with both canvases equal to the Worker's (1600 x 1200 and
   900 x 600), a second page started from the OPFS cache (read in 0.17-0.24 s) and E144 by `?model=E144` to its
   shooting screen at 3.0-3.2 lab s, every request a GET under the prefix answered 200 (X, five runs). The page needed
   no change: module Workers, `File.slice`, the transferred RGBA buffers, `ImageData` on a 2D canvas,
   `performance.timeOrigin`, top-level `await` and OPFS's sync access handles in the Worker all behave as in Chrome.
   Neither browser has `SharedArrayBuffer` on the site (no COOP/COEP, `crossOriginIsolated` false; X), which the player
   does not use (its `Atomics` are the node host's shared flags only). The pace at `--idle wall` over 10 s of the wall
   clock: 0.93-0.99 x real time, 0.79 with the host's test suite running beside it (X; reported, not judged).
78. **The browser player in WebKit** (2026-11-02, `web/opfs.mjs`). WebKitGTK 2.54.2's MiniBrowser through
   WebKitWebDriver on Xvfb, the engine Safari is built on. Master's page could not start there: "could not start:
   undefined is not an object (evaluating 'navigator.storage.getDirectory')" (X), because WebKitGTK ships the Storage
   API off (MiniBrowser `--features=help` lists StorageAPI, FileSystem and AccessHandle as off; `navigator.storage` is
   undefined in the page and the Worker, X), and the Worker's cache write ran before the Player. `web/opfs.mjs` now
   checks for OPFS and its sync access handles (`unsupported()`), and the Worker runs from the `.BIN` alone when the
   cache cannot be written: the page says the firmware is not cached and why, offers no cache on the next visit and
   disables "Keep the settings". With that, WebKit runs everything finding 77 lists but the cache, with the same
   canvas digests, at 0.99 x real time (X). With the Storage API, OPFS and the access handles switched on (the
   gate's `webkit-storage`, as Safari ships them) the page and the Worker have `getDirectory`, but in an automation
   session it rejects with "UnknownError: The operation failed for an unknown transient reason" (X), so the same
   uncached path runs and names that error (master's page stopped there with the same message, X); outside
   automation, in a MiniBrowser with a profile directory, `getDirectory` and `getFileHandle` work and
   `createSyncAccessHandle` throws "NotSupportedError: Backend does not support this operation" (X). So WebKitGTK
   cannot stand in for Safari's cache path; Safari itself is not run (finding 79).
79. **Driving the browsers, and what is left** (2026-11-02, `host/webdriver.mjs`). Classic W3C WebDriver over HTTP
   with node's `fetch` serves both drivers; WebDriver BiDi and Playwright were not needed. What the gate had to learn
   (X): MiniBrowser takes the automation session only when started with `--automation` (without it the new-session
   request never answers), opens at 1024 x 768 whatever the X screen's size (the gate sets the window rect), and
   WebKitWebDriver sends a pointer target outside the viewport to its edge (an event on `<html>`) where geckodriver
   refuses it with "move target out of bounds" as the spec says, so the gate scrolls the canvas into view first; the
   WebDriver key U+E007 is the keypad's Enter (code `NumpadEnter`, which the page does not map), U+E006 the main one.
   Not covered outside Chrome: the drop of a `.BIN` (classic WebDriver has no file drop; `bin/sitegate.mjs` drops in
   Chrome), the start options (debug API, card size, HDMI, kept settings), mobile browsers and Safari. Safari on macOS
   is driven by its own `safaridriver`, which its user must enable once: `safaridriver --enable` (an administrator's
   password), and in Safari, Settings > Advanced > show the features for web developers, then Develop > Allow Remote
   Automation. Those are host settings this round did not change, so Safari's OPFS and sync access handles stay
   untested; the same WebDriver commands would apply, and the gate has no Safari entry.
80. **INFO's still information on E143 and the E144 family, and the camera's clock read on every body** (2026-11-02,
   `src/lab/camapp.mjs` still_record and clock(), `test/test_playinfo.mjs`). On E143, E146, E147 and the E144 family
   PlyCom's getStillInfo asks the play component, whose wrapper (E143 `0x50acf1fa`) S-PLAYCOMP answers in the
   component's struct, which goes to the same converter as the E118 family's answer to request 3 (finding 57, D). It
   wrote the size 5184 x 3888 and the exposure alone, leaving the date and focal length to whatever the struct held:
   INFO showed (X, the composite, before) on E143 `0mm`, `5184x3888` and no date line; on E144 `0mm`, `5184x3888` and
   `0000.00.00 55:00:00`; on E142 the GUI's record held the date 51120-191-97 (X, the converter's return). S-PLAYCOMP
   now writes the picture's own record as S-PLAYSEQ does, one function for both (the date, the JPEG's size, the
   exposure, f-number, bias and ISO, the focal length at the build's offsets, fact `play.still`). The date is the
   camera's clock read, E143's `0x5005a59e` (behind the wrapper `0x5012b7cd` its 61 callers call, D): where the SCPU
   window's clock signature (`0x5004e384`, bits 7..2 of word 0) is 42 it converts the window's seconds since 1970 and
   subsecond count (`0x5012bf86`) and checks the date (`0x5012b9ab`), else, or for no date, it answers the build's
   default with the status 10501 (`0x5012b91f`, E143 2022-01-01 00:00:00, D). The port places it on all 19 bodies; on
   E122 its place is the RTC driver's get `0x50068dbc` that api_sctime_GET_REAL_TIME (`0x502ee369`) calls through
   `0x5016892e` (D, finding 57), so the name rule realTimeGetter and its fact `clock.real_time`, which read the E118
   family's API alone, are retired. Called natively at a capture (X, a hermetic session, whose window clock counts
   from 1970 and whose signature the boot's store init leaves at 42), every body answers its build's default with the
   status 10501 and no side effect: 01-01 of E118 and E120 2015, E122 and E125 2016, E129, E130 and E132 2017, E133
   2018, E134 and E137 2019, E139 and E140 2020, E142 2021, E143 and E144 2022, E145 2023, E146 2024, E147 and E148
   2025, the E118 family's as their API gave. INFO then shows (X, the composite after S2 on the TFT): E143 `25mm`,
   `1620x1080`, `2022/01/01 00:00:00`, `1/125`, `100-0001`; E144 `25mm`, `1620x1080`, `2022.01.01 00:00:00`; E134
   the same with `2019.01.01`; E145 `2023.01.01` and 0 mm (the TG-7's built-in lens, whose focal length the lab does
   not read); E146 12 mm (its native lens). E143's INFO composite is FEATURE_UNOBSERVED as before (its highlight
   and shadow registers `0x48c..0x4cc` and `0x5d0..0x5dc`, never-written class); the frames were taken with their
   mirror flags cleared in the model's debug window (a probe's view, not the lab's). `test/test_playinfo.mjs` reads
   the GUI's record at the converter's return on all 19 bodies (`bin/test.mjs`: E143 in process, 18 children, 8 at a
   time): the card's JPEG size, the clock's date, the lens's focal length (0 with a built-in lens), 1/125 s and one
   of the two stand-ins answering (8 checks; 9 with the histogram on the E118 family), each passing (X). E132's start
   waits at its date setting, which the test answers as modelcheck does (finding 24). golden's keys session takes the
   clock read as one more native call at its S2 (one stop; screen, devices and output identical), recorded tooling-only.
81. **E134's and E132's still converters** (2026-11-02, `src/fw/facts.mjs` stillFields). The rule read neither form
   (finding 57: null, so S-PLAYCOMP wrote no ISO there and S-PLAYSEQ refused). Both keep the GUI's record on the
   stack and form a field's address in d1, the load to d0 and `mov (12,sp),d1` in either order, then `add G,d1` (E134
   `0x5082c3b9..0x5082c3be` with the information in d3, `movhu (98,a0),d0` to the GUI's +88, `mov (144,a0),d0` to +56
   at `0x5082c42e`; E132 `0x5068b193..0x5068b19a` with it at (16,sp), `movhu (90,a0),d0`, `mov (136,a0),d0` at
   `0x5068b1fe`; D). The rule takes this second form from one stack slot and only for the GUI's +56 and +88 (taken for
   every G, it matched E146's converter elsewhere at two slots, X). E134 {focal 144/4, iso 98/2}, E132 {136/4, 90/2};
   the other 17 unchanged (X, the rule at each port's converter). The fact now carries the converter too (`convert`),
   which the test observes on every body (E144's, E139's and E125's are unplaced by the map: the call after the
   wrapper's one call, finding 57).
82. **The GUI state table's bound by a rule** (2026-11-02, `src/fw/facts.mjs` stateTableBound, fact
   `gui_states.parents`, `src/lab/menu.mjs` state_names). The lab named the state table's first 12 parents on every
   body (finding 17). The firmware's name lookup loads the table and ends its search at `cmp N,d3; lcs; cmp N,d3;
   bcc` (E143 `0x5124b459`, the load at `0x5124b467`, 12 at `0x5124b478`; E145 18 at `0x50de87bf`; D); the rule
   reads N after each load of the table's address at the port's place. 12 on E143, E146, E147 and E148, 18 on the
   other 15 (X). The six parents the 15 add are the same on each: `0xe` SS_DPS (26 states), `0xf` SS_BTSEND (35),
   `0x10` SS_BTRECEIVE (19), `0x11` SS_MENU (2), `0x12` SS_EDIT (8), `0x13` SS_SHORT_MOVIE (7), 97 names (X). E145's
   start state `0x1103` stays unnamed: its SS_MENU lists `0x01` ID_ST_MENU_ENTRY and `0x02` ID_ST_MENU only (X;
   finding 17). No E143 output
   changes (its bound is the lab's 12); on the 15 a state of those parents prints its name where it printed `?`.
83. **REC_FILE's task on E146 and E147, and the E144 family's REC** (2026-11-08, `src/fw/facts.mjs` recFile, fact
   `rec_file`, `docs/hle-gaps.md` 4.8.10). The rule reads every address and layout `src/lab/rec.mjs` uses by REC's
   own trace table (each function by the trace call it holds), REC_FILE's receive with the file name `rec_file.c`,
   the packet dump and the EXIF module's template copy, date set, tag table and crop-area pick (D): on E143 the values
   given by hand before it, on E146 and E147 their own, on none of the other 15 (X). E146 and E147 differ from E143
   in the packet (276 bytes, other offsets, the image's address and size in REC_IMAGE's 52-byte image record the
   packet points at) and the EXIF parameter block (91704 and 91960 bytes; the time record at +37452, the crop areas
   elsewhere), not in the steps (D). Both record S2's file natively with the firmware's header: Model `OM-1MarkII` on
   E146 and `OM-3` on E147, Exif version `0231` and `0300`, the clock's dates, image count 1 and next number 2 in the
   session (X, `test/test_storage.mjs`). E144 and E148 hold the trace table, the traced functions and the dump (with
   E143's packet form), but their REC_FILE (E144 task 31) blocks in a receive wrapper with no flag, their EXIF init
   has no cache flush and its template is 31700 bytes, and the date set has another form (D; E143's two picks are
   not found, not read further): they keep S-RECFILE's DCF steps.
84. **The touch panel's open by its form, and the gesture mask's word** (2026-11-10, `src/fw/facts.mjs` touchOpen,
   touchMask). The family's touch stayed off for its open alone: HFW's callback and its status sites were placed (X: the
   PORTS of master `8a826db`; D on E122, whose HFW touch init `0x5073a8a7` loads the callback `0x5073a9b7` and passes it
   through the API wrapper `0x502f4a80`, API `0xd001c`, to the open, and whose callback's status dispatch is E143's
   instruction for instruction), which corrects finding 76's "and the HFW callbacks". The family holds neither open
   trace name; its open is E144's form, which has none either: `movbu (F),d1; clr d0; cmp d0,d1; bne; cmp 0,a0; beq; mov
   a0,(C)`, three stores and `mov 1,d1; movbu d1,(F)` 0x29 bytes in (E122 `0x5030bb4c`, F `0x6189f36c`; E120
   `0x502d9242`; E118 `0x502e3efc`; E144 `0x5018a04b`, D). touchOpen reads it where neither name is held: one called
   function of the form on E148, E144, E139, E142 and E140, where the maps had placed E143's open at it, and on the
   three (X, a byte scan of the 19 expanded images; none on the traced bodies, E145 and the TG-5s). The gesture mask's
   word, which H-TPSTART's set and the session's status read (TP_MASK_WORD), is the word the mask set stores (`mov
   (Am),d0; mov d0,(W)`: E143 `0x501e41f1`, E122 `0x5030bd11`, D), the word after the open's byte on all 16 bodies with
   a touch panel (X). The maps had placed E143's elsewhere on E130 (`0x6264b0d6`, W `0x6264b22c`), E133 (`0x626136de`, W
   `0x62613834`), E122 (`0x6189f2e2`, W `0x6189f370`), E118 and E120 (X), so on E130 and E133 the status's mask and the
   display switch's mask check read another word (I: no test reads them there). touchMask reads W at the port's place of
   the mask set on a build with a touch-panel driver (the TG-5s' and E145's maps place the set at other code, I:
   `0x50b5bdcc` on E145).
85. **The family's touch power-up, and E118's command list** (2026-11-10, D unless tagged). E122's opens post the touch
   task's cmd 4 (finding 40), its power-up `0x5030bbb4`, which writes the controller's registers through the touch I2C
   write and returns (E122's and E120's sessions write 18 registers `0x1cxx`, the same but one value, X: the lab's I2C
   log); the open's own list then waits for the INT (finding 54). E118's cmd 4 (`0x502e3f5f`) runs a command list of 19
   6-byte entries copied from `0x603f1ca4` through a table of 14 ops (`0x603f1ea8`): an INT wait of 50 ms (op 5); a
   check of the controller's version (op 2: two bytes at `0x1c14` through `0x502e4b94`; `0xc400` goes on, any other
   value jumps to entry 10); `0x1c00` = 0, `0x1c03` = 10 and 117 bytes at `0x1400` (ops 12, 10 and 8 with 0; the bytes
   from the record the lookup `0x50055b7c` gives for id 36049, not read further, all 0 in the lab, X); op 9's register
   list (finding 87); `0x1c00` = 2 (op 11); and the list's end `0x502e477d`, which arms the driver for the INT's data
   (its INT word 0, the word after it 1). From entry 10: a download of the controller's firmware (op 7: 0x30, 0x10 and
   then 24496 bytes through the write's `0xff` paths, X: the lab's log; then an INT wait of up to 16 x 10 ms, "TP
   BOOTLOAD ERROR" on its timeout), the version again (op 2 with 16: `0xc400` goes on to `0x1c03` = 10 and a
   calibration, op 8 with 1: `0x1c00` = 3, an INT wait of up to 31 x 50 ms, "TP CALIB ERROR"; any other value jumps to
   entry 16), op 9 and op 11. The version read logs "[TP] Touch IC F/W Version A not available!!" for a value outside
   `0x3000`, `0x9e00`, `0xc400` and `0xd700` (`0x502e4bb8..0x502e4bdc`), and the report parser `0x502e4f80` takes the
   coordinates for every event from `0xd700` on (`0x502e4ff7`); its report is E144's 10 bytes at `0x0000`. The other
   drivers at `0x48` read the version too, without the check: E120's, E122's and E144's display opens' command lists
   call a getter that reads `0x1c14` while its kept value is 0 and keeps it as b1 << 8 | b0 where E118 keeps b0 << 8 |
   b1 (E120 `0x502da010` from `0x502d0175`, E122 `0x5030c914` from `0x503027bc`, E144 `0x5018a8ee` from `0x50181c96`, D;
   the read's immediates on every other body at `0x48`, X: a byte scan), and their report parsers compare it with
   `0xd700` as E118's does (E120 `0x502dad03`, E122 `0x5030d871`, E144 `0x5018bc54`, D). Of the 16 bodies with a touch
   panel only E118 holds "TP BOOTLOAD ERROR" and "TP CALIB ERROR" (X, a string scan): its panel arrangement is E120's
   and E122's controller at slave `0x48` (I: op 9's values `0c`, `12`, `06`, `73`, `17`, `19` are among E120's and
   E122's power-up writes, X; whether the version's two byte orders read one controller alike is ?) under a driver that
   downloads the controller's firmware when its version differs (I).
86. **E118's INT waits and the controller's version** (2026-11-10, `src/fw/facts.mjs` touchIntWait,
   `src/lab/touchpanel.mjs`). E118's three INT waits are inline in its list's ops 5, 7 and 8: sleeps of 2, 10 or 50 ms
   until the getter `0x502e4764`, `mov (0x6187b7e4),d0; retf`, returns 1, called from those three loops alone
   (`0x502e3ffd`, `0x502e4028`, `0x502e40b0`, X); the list's end clears that word and sets the one after it, and the INT
   handler `0x502e4b21` reads a report only with that one set (D); its pin callback `0x502e4d0a`, which the driver's
   set-up `0x502e4601` attaches to pin 30 (`0x502e462e`), stores 1 in the word while the one after it is 0, as E144's
   (D). touchIntWait reads it as a third form: a call of such a getter followed by `cmp 1,d0` within 0x60 bytes before a
   load of "TP INT TIME OUT\n" (E118: the wait `0x502e3ffd`, the poll `0x502e4764`); S-TPINTWAIT answers it at the
   getter's call as at the other forms' polls, and the rule reads the 18 other bodies as before (X). S-TPREG's
   controller at `0x48` answers `0x1c14` with `0xc400` (I: a controller that runs the firmware this build carries, so
   the list writes its registers without the download; which version an E-M5 II's controller reports at power-up is ?).
   Before, with the touch task running the list: "TP INT TIME OUT", the version read 0 and "not available", the
   download, "TP BOOTLOAD ERROR", the version 0 again, then op 9 (X, the firmware's prints and the lab's I2C log). With
   S-TPINTWAIT's third form and S-TPREGLIST in place, 0 at `0x1c14` runs the download (`30`, `10` and the 24496 bytes,
   recorded by the write's stand-in), S-TPINTWAIT answers its wait, the version reads 0 again (a second "not
   available"), entry 12 jumps past the calibration, op 9 and op 11 run, and a tap on the touch mode icon reaches HFW as
   PRESS and CLICK (X): the answer picks the list's path, not whether touch runs.
87. **E118's register list over the touch transport (S-TPREGLIST)** (2026-11-10, `src/fw/facts.mjs` touchRegList,
   `src/lab/display.mjs`). Op 9 (`0x502e4eee`) writes ten registers, `0x1c<b0>` = b1 from the 2-byte entries of the
   table `0x615de290`, not through the touch I2C write, which the lab stands in for, but through the write's transport
   inline: its semaphore `0x60040e40`, the transport's open `0x502e4d50` (serial channel 4 through `0x5006f673`,
   then a flag wait), the descriptor `0x6187b7c4` with `0x50068418`, `0x50068506` and `0x5006851a`, and the
   completion flag `0x60040fe2` per write (D). The family's serial channels' completions in that mode are not modelled
   (finding 44 presets the transmitters' idle state only): run, the transport's open and its flag wait returned and the
   first entry's completion wait (`0x502e49e3` on that flag) did not, the touch task waiting there for good, no `0x1c00`
   = 2, no arm and a tap read nothing (X: observers on the list's steps). touchRegList finds such a list as the function
   besides the touch read and write that calls the transport's open after the write's semaphore load, with its table,
   count, slave and register byte (E118 only: on E120 and E122 the open's callers are the read and the write, X);
   S-TPREGLIST stands in for it as for the write, the ten entries recorded as writes to slave `0x48`, the transport not
   run, 0 returned. In the lab's sessions the table holds `1b 0c`, `23 00`, `3f 12`, `1f 06`, `1e 00`, `24 73`, `29 17`,
   `38 04`, `3d 01` and `0b 19` (X).
88. **Touch on the E118 family** (2026-11-10, X: a play session per body on the TFT, `test/test_touch.mjs`). With
   findings 84 to 87 the three run the touch path as the E144 family does: H-TPINIT before the start's display open
   (fact touch_int on all three; on E118 the order also matters because the open posts cmd 4 to the queue the init
   joins to the touch task's flag: with the init after the open the list never ran, no I2C, and a tap read nothing,
   X), the open and the mask by H-TPSTART, S-TPREG's controller at `0x48` (the report reads return to E122
   `0x5030cd66`, E120 `0x502da45e`, E118 `0x502e4fce`). A tap on the touch mode icon at 40, 333 gives HFW PRESS and
   CLICK at the pixel and cycles the icon on all three (frames); OK opens the super control panel (`0x0403`) and a tap
   at 360, 240 selects its AF Mode cell (frames). The touch message `0x9100` is sendEvent index 107 on the three, E137's
   shift (S-TOUCHMAP's lookup). `test/test_touch.mjs` taps the icon on the three and the panel on them and E144 (11
   checks each, all pass, among them that each frame holds for 500 ms without a tap before the tap changes it);
   `bin/modelcheck.mjs` passes the three on the TFT and the EVF with touch on.
89. **The application's own touch start, and the control area** (2026-11-10, X: observers on the opens, closes and
   mask sets of E122, E118 and E144 in a TFT session). At the camera application's start E122 closes the panel and
   opens it again with HFW's callback through its touch API (the close returning to `0x502f4b5d`, the open to
   `0x502f4ad9`, in the API `0xd001c` wrapper HFW's touch init calls, D), 615.4 ms of lab time, and sets the gesture
   mask for each screen (six sets in the start, one at a later redraw); E118 does the same (the close at 629.4 ms,
   the open at 651.6 ms) and E144 at 2830.1 ms. H-TPSTART's open and mask at the bring-up are thus superseded on those
   bodies (not looked at on the others; corrected 2026-11-10: E143's start runs the same, finding 114). The close
   clears the driver's control area (E122 `0x5030bccb` -> `0x5030bda9` with five words 0, D, X), and no TFT session
   sets one, so the driver passes the controller's events as on E144 (finding 75); on E122's EVF the application's
   Set_Touch_Panel_Ctrl_Area runs (finding 40), and touch on the EVF is not tried (since tried, findings 113 to 116).
90. **What S-PLAYSEQ stands in for on the E118 family** (2026-11-10, `src/lab/camapp.mjs` S-PLAYSEQ; addresses E122's, D
   unless tagged). PlyCom's requests go to the play module as transactions the HLS play component answers: the
   synchronous getStillInfo (3, `0x506aae51`: the request set by `0x506af68a`, run by `0x506af724`, its response read by
   `0x506afbaa` and converted by `0x506a9cc9`), getNumber (5), getHistogram (7), canMoveCurrent (344) and endPlayService
   (1), and the asynchronous startPlayService (0), startSingleFrame (8) and moveCurrent (9), with 238 at PLAY's start
   and 13 at INFO (X: S-PLAYSEQ's log; their names not read, ?). On the camera the component's getStillInfo method
   (`0x5078b672`, called from `0x507daabe` and `0x507f1372`) calls api_play_Get_StillInfo_ExifData (`0x502e16b2`, API
   `0x30089`) with the image's handle (`0x50747231`'s): the API sets the 73 words of its record to 1, returns 1 where it
   has no handle and the current one (`0x6189a4f4`) is 0, and else reads the image's tags through
   api_play_Get_ExifTag_ASCII (`0x502dc0c4`: DateTimeOriginal `0x9003`) and api_play_Get_ExifTag_Data (`0x502dc001`, API
   `0x30017`: `0xa002`, `0xa003`, `0x829a` ..). The Data getter's read is play_exif_search_tag (`0x50ad1fb5`, called at
   `0x502dc075`): playbuff_get_img_info (`0x50ae1593`: handles 1..16 in the table at `0xa1c929dc`, 24 bytes a handle,
   the image's record at the entry's +12) must give a record whose u16 +12 is 1, the handle's Exif context
   (`0x50ad8fbe`: its work area + 66560 - 140) is searched by the EXIF module's library (`0x5052a7b9`, by the IFD in the
   key) and the value read (`0x50ad203f`). E118 and E120 (D, the same instructions and the same trace strings): the
   method `0x5079b2cf` and `0x5074720b`, the API `0x502c11cf` and `0x502b51cb` (an older wrapper without the API id's
   log; the current handle `0x61876bec` and `0x6187472c`), play_exif_search_tag `0x50b11a39` and `0x50e6bad8`,
   playbuff_get_img_info `0x50b20aeb` and `0x50e7ab08`. In the lab none of it runs (X, a session per body to INFO: an
   observer on the method, the API, the search, the info getter and the load functions of finding 92 counts 0 calls, the
   handle word reads 0, playbuff_get_img_info(1) returns 0, and the API called natively at INFO returns 1 with its
   record's words at 1), so S-PLAYSEQ stands in for the component and all of the play module below it, and answers from
   the picture's own record (finding 57).
91. **The other bodies: the same chain under S-PLAYCOMP** (2026-11-10, D unless tagged). On E143, E146, E147 and the
   E144 family PlyCom calls the component through its wrappers (S-PLAYCOMP, findings 52, 80), and the component's
   getStillInfo method is the family's code, calling the same API at the same place: E143 `0x50bdb01a` -> `0x5040a86e`
   (a record of 95 words; the current handle `0x62a6b6c0`), E130 `0x507ffae4` -> `0x502e5f11` (`0x62667348`), E144
   `0x5095b8aa` -> `0x502ec0a0` (`0x620eaac4`); play_exif_search_tag E143 `0x518aad34`, E130 `0x50bb2f9f`, E144
   `0x514ab553`; playbuff_get_img_info E143 `0x518bfc7e`, E130 `0x50bc5008`, E144 `0x514bee9c` (by the maps and the play
   module's trace strings, which these three hold where their API layer has no names). X on E130 and E144 as in finding
   90: 0 calls, the handle word 0, the API's answer 1. No body reads a picture's Exif in playback, then: S-PLAYCOMP and
   S-PLAYSEQ answer from one record (camapp.mjs still_record), E143's, E146's and E147's although their files hold the
   firmware's Exif (finding 83). The family differs only in PlyCom's route, its getStillInfo and getNumber being E143's
   mode-3 branch alone (a synchronous request through the transaction where the others call a wrapper), and is at
   E130's and the E144 family's level: PLAY and INFO on E122's and E130's TFTs draw the same items, the clock's date,
   `125`, `25mm`, `1620x1080`, `100-0002` and `2` (X: the composites; E130's date with seconds and its Wi-Fi icon,
   E122's an icon left of `25mm`).
92. **The play module's load and the header parse** (2026-11-10, D; E122's addresses, the others after them). Where the
   camera loads a picture, play_load_load_exif_header (E122 `0x50ad901c`) reads the file's first bytes, its size at the
   DCF fnode's +48 but at most 66560, into the handle's header area (play_img_get_header_address `0x50ad8aea`) through
   play_file_read (`0x50ad529d`, which sets up the fnode's read with `0x5056040b` in the file system's code), and
   play_img_analyze_exif_header (`0x50ad6bbd`, called from eight places of the play module, play_cube_set_jpeg
   `0x50aceae0` among them) runs the EXIF module's dispatcher (`0x5052a452`) on the handle's Exif context with the
   operations 1, 2 and 4 over that area; operation 1 is, for the context's kinds 0, 3 and 4, the JPEG parse
   `0x5052a7d7`, which requires SOI (`ff d8`) and walks the marker segments by their lengths to an APP1 (`ff e1`) whose
   data opens with `Exif\0` (`0x5052a82d..0x5052a853`; what follows the match not read): a byte other than `ff` where
   a marker is due, or fewer than 4 bytes left, ends it with 29505 (`0x5052a875..0x5052a889`). The decode is
   play_img_decode_jpeg (`0x50ad6cf6`). The dispatcher and the parse are the same instructions on the six bodies read
   but for two of the context's fields: the one the dispatcher tests first (+138 on the family, +142 on E130 and E144,
   +150 on E143) and the one the parse addresses at a match (+96 on the family, +100 on the other three; E143's
   dispatcher `0x504289eb` and parse `0x50428d91` beside its EXIF module's init `0x504298bd`). E118
   / E120 / E143 / E130 / E144: the load `0x50b186d0` / `0x50e72704` / `0x518b51e6` / `0x50bba284` / `0x514b4944`, the
   analysis `0x50b16255` / `0x50e7028d` / `0x518b1f44` / `0x50bb7723` / `0x514b1c9b`, the file read `0x50b1493d` /
   `0x50e6e975` / `0x518b017f` / `0x50bb5fcd` / `0x514b04f7`, the dispatcher `0x50513585` / `0x504ec781` / `0x504289eb`
   / `0x503027e3` / `0x5030a56e` and the parse `0x5051390a` / `0x504ecb06` / `0x50428d91` / `0x50302b6a` / `0x5030a8f5`
   (each by the trace string it loads, or by the maps and its first bytes). None runs in the lab (finding 90); running
   them needs the play module's handle, its play buffer and image record, which the PLAY tasks and the component's start
   make, and the picture's Exif in the file (finding 93).
93. **The record's Exif writer on the family: S2's file has none** (2026-11-10, D unless tagged). S-RECFILE writes the
   lab's JPEG (JFIF, `src/lab/jpeg.mjs`) on the family as on E130 and the E144 family, so a native parse of its header
   would find no APP1 (I, finding 92's parse). The family's REC holds the trace table recFile reads (165 names on E122,
   169 on E118, 163 on E120) and the traced rec_jpeg_exec (E122 `0x50515ab1`, E118 `0x504fe72d`), rec_jpeg_make_image
   (E122 `0x50515c18`, E118 `0x504fe899`, E120 `0x504d7e89`), rec_jpeg_make_header (E122 `0x50515cbb`) and
   rec_file_record (E122 `0x50510091`, E118 `0x504f66bf`; no trace of it on E120); E118's make_header trace is in two
   places, one in a function whose entry the rule does not find, and E120's exec and make_header traces are in two
   functions each, which the rule refuses (X). Its next part is not found: no load of `rec_file.c` (E122 `0x6063cedc`)
   anywhere in the image (X, no 32-bit reference to it; none on E118 and E120 either), so REC_FILE's receive is of
   another form, as on E130 (no load either) and E144 (18 loads, none in that receive's form, finding 83) (X: the rule
   stops there on both); nor are the EXIF module's template copy after its init and its
   date set in E143's forms (X, on the family, E130 and E144). The EXIF tag table (the one with DateTime {`0x0132`, 2,
   20}) gives the family's own parameter block: body `0x620700` on E122 (`0x625104` E118, `0x5f80d8` E120), Make +1480,
   Model +1504 and DateTime +1364 as on E143, but DateTimeOriginal +2313, CreateDate +2333, ExposureTime +2356, FNumber
   +2396, ISO +2406, FocalLength +2388, PixelXDimension +2172 and DigitalZoomRatio +2428 (E143 4089, 4109, 4152, 4192,
   4202, 4184, 3948, 4228; E130 1785, 1805, 1848, 1888, 1898, 1880, 1644, 1920; E144 E143's but 4224). The family's
   rec_jpeg_exec is another REC version than E143's (Mode at +210, pExifParam at +28): it compares the packet's +68 with
   the modes 4100, 4107, 4103 and 4108, reads a block at +124 (E118 +188) at offsets past 18000 (+18572, +18578, +18580,
   +18595, +19304; what the block is, ?), keeps the buffer at +200 and calls the header maker where +14 is 0 (E122
   `0x50515b67`). The stop: a native Exif in the family's file needs its header maker run as E143's (H-EXIFINIT,
   S-EXIFPRM, S-RECIMAGE, `docs/hle-gaps.md` 4.8.10) with its own packet, parameter block and EXIF init read, and the
   play side then needs finding 92's load run or stood in; neither is done, and the same holds for E130 and the E144
   family.
94. **Two pictures, RIGHT and LEFT, INFO's three views on the family** (2026-11-10, X: a play session per body and
   device, `test/test_playinfo.mjs`). S1 and S2 twice put `P1010001.JPG` and `P1010002.JPG` on the card; PLAY shows the
   newest (`100-0002`, `2`), RIGHT the other (S-PLAYSEQ's moveCurrent 4: `100-0001`, `1`, a changed frame), LEFT the
   newest again (the frame PLAY drew), on E122, E118 and E120 as on E130 and E144 (S-PLAYCOMP's) and E143. INFO cycles
   three views: ID_ST_DISP_DETAIL (`0x060b`; E143 `0x050b`), ID_ST_DISP_OFF (`0x0606`, the composite one value: the
   picture alone, which the lab does not draw) and ID_ST_DISP_SIMPLE again; PLAY then returns to the shooting screen.
   The family's EVFs run the same path. `test/test_playinfo.mjs` now takes it on the 19 bodies (frames compared before
   INFO only, E143's composite being refused after it, finding 80): 15 checks pass on the family (with the histogram),
   14 on the others. modelcheck's path is unchanged, the other bodies' taking no second picture there. Erase is covered
   on no body (no test; the media control's erase is not modelled): OlyHfwOpePlyCom::erase sends the asynchronous
   request 301 (`mov 301,d0` E122 `0x506aa8a3`, E130 `0x50702e1c`, E143 `0x50acdc69`, before the request's execute,
   E143's `0x50ad26fb`; D), which no session here sent, and S-PLAYSEQ would finish it as it finishes every request,
   with the result 0 and no file removed (D, camapp.mjs play_finish; what the firmware then shows, ?): a gap to close
   before erase is driven. In a session (X): E130's Delete opens SS_MENU_MAIN/ID_ST_WIZARD_MENU_ENTRY (`0x0302`,
   request 286, a changed frame), UP and OK return to playback with the picture kept (S-PLAYSEQ finishes request 21,
   then 8, with result 0; PLAY's frame), and PLAY from it returns to the shooting screen (`0x0108`, endPlayService);
   the family's Delete changes nothing (the player posts E143's UI_IN code for it; the family's is not read) and its
   OK opens the same wizard state (request 286) without a change to the frame, as E130's OK opens it; E144's OK and
   Delete change nothing (its Delete asks S-PLAYCOMP's getSelectPicNumberSpecifyMedia twice, answered 0 unmodelled;
   whether that answer is why nothing opens, ?). PLAY from the wizard OK opens faults on E130 (a jump to `0x0000801f`)
   and on the three (`0x00008010`): the GUI's `0x50cbd271` (E122) calls slot +32 of its current screen object
   (`0x6161c024`), which is 0 there (X); that word's three writers store the result of the screen factory `0x50cf49e0`
   (D); which screen PLAY asks for there and why none is made is not read (?).
95. **E118's EVF playback was never missing** (2026-11-10; corrects this round's premise that finding 70 left it out).
   Finding 70 says E118's EVF played back before the line compare, and modelcheck's EVF_PLAY holds E118; its EVF runs
   PLAY, INFO's three views, RIGHT, LEFT and PLAY back (X: finding 94's session). Why it never waited (D): E118's
   display task (task 80, `0x502d2fcd`) on its flag's bit 4 (`0x502d3106`) runs its display update (`0x502d319d`) and
   returns to its loop, where E122's (task 80, `0x502f90f5`; bit 4 at `0x502f9315`) and E120's (`0x502c6a7d`; bit 4 at
   `0x502c6c9d`) first ask the EVF panel for a change (`mov 2,d0; call`, E122 `0x502f931d`, E120 `0x502c6ca5`) and,
   where `0x502fa2d2`'s word (`0xa1c5a814`) is 4, poll the panel scheduler's word every 40 ms (finding 70). E118's image
   holds no such poll (`mov 40,d0; call; mov (W),d0; cmp 1,d0; beq`): two each on E122 (`0x502f92cd`, `0x502f936b`) and
   E120 (`0x502c6c55`, `0x502c6cf3`), none on E118 (X, a byte scan). Nothing to close.
96. **The OSD planes' order is the GUI's order code** (2026-11-10, `src/dev/vsccompose2.mjs` ORDER_CODES,
   `docs/om1-vsc-spec.md` section 12; corrects findings 38 and 66's reading of `+0x1a4`). The word's low bits are the
   OSD order code the display's layer-custom path writes from its record's osd_mixorder (D): on E122 the setter
   `0x50308b76` (`and -8; or`, the low 3 bits), called at `0x5030459c` when the record's +40 is not 255, its API's
   converter mapping 0..5 and 255 and asserting on another value ("osdMixOrder", `0x502ca802..0x502ca849`); E118
   `0x502e0f3a` and E120 `0x502d6058` the same (called at `0x502dd1d2`, `0x502d1de8`); E144's `0x501872ac` replaces
   the low nibble, called at `0x50183bc3` for a value of 5 or less. The code is the GUI's: GPISetOsdOrder (E122
   `0x50bac52d`, its trace "[GUI gpi] GPISetOsdOrder [%d, %d, %d]"; E143 `0x510bd77e`) orders the three layers and its
   mapper (E122 `0x506c1680`, E143 `0x50ae9870`) takes the code from six {code, plane, plane, plane} records, 0 {2, 1,
   0}, 1 {1, 2, 0}, 2 {2, 0, 1}, 3 {0, 2, 1}, 4 {1, 0, 2}, 5 {0, 1, 2} (E122 `0x60978f77`, E143 `0x60df8352`; the same
   24 bytes once in each of the 19 bodies' images, X, `test/test_facts.mjs` ORDER_TABLE), and its update puts the code
   in the display's custom record when its
   flag is set (`0x506c0b7b..0x506c0bbe`, D). The screens choose it through a mode function (E122 `0x50bb5922`, E143
   `0x510c9903`): mode 2 code 2, 3 code 0, 4 code 5, otherwise code 3 (D); of its 154 call sites on E122 152 pass 1,
   one 4 (`0x50c19a67`) and one 2 (`0x50c37218`), and E118 and E120 have the same 151, 1, 1 of 153 (X: each site's
   `mov n,d0`), so 3, the code the opens write, is the GUI's own default. Which end of a record is the top is not in
   the code: reading a record as the planes in their order is I (E144 writes 2 with GUI layer 2 in OSD1, E139 and the
   family 3 with layer 0 there, and only that reading gives both the GUI layers 0, 2, 1 from one end, the order the
   GUI's shared table and drawing are made for), and the first plane being the top one is I from the layers' contents
   (X: the three buffers in a play session): at the menu GUI layer 1 holds an opaque black fill and the rows' grey
   bars (245,060 pixels of index 3 on E139 and E144) under the rows' text on layer 2, and at E122's clock warning
   layer 1 is the 25 / 31 black dimming under the clock and Y/M/D on layer 2; layer 0 is transparent in every frame
   looked at (E122's TFT and EVF at the start, S1, the menu, PLAY and INFO; E139's and E144's menus). Finding 66's
   reading of E144's menu was wrong on the layers: its OSD3 (GUI layer 0) is transparent at the menu, the opaque fill
   is in OSD2 (layer 1) and the rows' text in OSD1 (layer 2) (X, re-checked in review: index 31, entry 31
   transparent, in all 345,600 pixels of OSD3; 245,060 pixels of index 3, opaque black, in OSD2), so the lab before
   finding 66, OSD3 on top, hid the rows by drawing OSD2 over OSD1, not by layer 0. So the
   compositor draws code k's planes in its record's order from the top on both kinds (OSD1, OSD3, OSD2 for 3; OSD3,
   OSD1, OSD2 for E144's 2), GUI layer 1 at the bottom, and refuses a word that is no code 0..5. Before, it drew GUI
   layer 0 at the bottom and took 3 and 2 only (kind 3: 3); the two orders differ only where layer 0 has content, so
   no frame looked at changed (X: each composite drawn both ways in one session and compared pixel for pixel, all
   equal: E122's TFT at the start, S1, S2, PLAY, INFO, PLAY, MENU, DOWN and MENU and its EVF through PLAY, INFO and
   PLAY, E118's and E120's TFT on the same path, E139's and E144's menus; in review, the kind-2 order of E125, E130,
   E134, E137, E142, E145 and E148 too, their TFT at the start, MENU, DOWN and MENU). What would settle the direction
   directly: a
   screen of the camera with layer 0 drawn over layer 2, taken from its panel. `test/test_vsc3.mjs` drives every code
   on E122's board against the GUI's records (53 checks with the rest).
97. **OSD1's and OSD2's pixels of 32 or more** (2026-11-10, `docs/om1-vsc-spec.md` section 12). The firmware gives the
   two 32-entry planes no colour for such a pixel: the palette set uploads 32 entries for GUI layers 1 and 0
   (`0x50304cb5..0x50304d73`, `0x50304d87..0x50304e47`; 128 of layer 2's 256) and the GUI's palette setters refuse an
   index at or above the layer's bound, the halfwords {32, 32, 256} at `0x60d46130` (`0x50a5c9c4..0x50a5c9eb`, D). The
   writer of `+0x700..+0x7ff`, the one store area not read for the planes, fills 8 entries from colours of its own
   (`0x50307b33`; its callers' loops end at `cmp 8`, `0x50303a7d` and `0x50304458`, D), not a third group. Every OSD1
   and OSD2 pixel in E122's sessions was below 32 (X: 31, 5 and 4 at the start, S1, the menu and PLAY, TFT and EVF).
   The compositor keeps refusing a pixel of 32 or more (PAL_FIELD); what the chip does with one is ?, and only the
   panel's picture with such a pixel written into the plane would settle it.
98. **The OSD level words** (2026-11-10, `docs/om1-vsc-spec.md` section 12). E122's opens write `0x100` to OSD7..OSD9
   (`0x503097b7..0x503097c6`); the one writer of a percentage, `0x502f93f9` (`2 floor(p 128 / 100)`), has five
   calls: three in the EVF panel's command scheduler `0x502f946a`, with a byte of the command record (`0x502f968b`,
   `0x502f986e`, `0x502f99f9`), one with 70 (`0x502f9b11`, in `0x502f9a27`, called from `0x502fa36b`) and one with a
   byte `0x502f9bae` reads (`0x502f9ba6`). Its second argument picks the words: 0, channel 0's OSD7..OSD9; another,
   `0x9c0022c4` and `0x9c0022c8` (channel 1's `+0x2c4` and `+0x2c8`, their meaning ?), which the scheduler passes
   as 1 where a byte of its frame is 2 and as 0 where it is 1, another skipping the call (`0x502f9675..0x502f9689`,
   the same at the other two; what the byte names is not read); with the byte `0xa1c5a811`
   set it writes no register and keeps only the percentage, in `0xa1c5a810` (D; corrected in review, which read the
   flag as choosing channel 1). E120 has the writer (`0x502c6d81`, five callers, its flag `0xa1c1a039`) and stores
   `0x100` in channel 1's two words (`0x502d7787`); E118 loads none of the five addresses (X, a byte scan), as finding
   48 found for channel 0. On E122's EVF the words hold `0xb2` after the open (finding 35), `0xcc` (80 %) at the
   shooting screen and after S1, and `0x100` at PLAY (X), so the level is lowered over the live view and restored for
   playback (I: which call writes each is not traced); that the level is the OSD's opacity is I (its percentage, and
   API names with "OSD_Trans"), and how the
   chip blends with it is not in the code (the code computes the level and reads it back only at its own stores). The
   compositor keeps drawing any level but 0 as full, and E118's unwritten words as full with the ASSUMED bit. What
   would settle them: E122's or E120's EVF panel input taken over a known OSD colour and live view at `0xcc` and at
   `0x100`; for E118, its words read back on the camera after its open (their reset value).
99. **S-MODACK's module queues from each body's API target table** (2026-11-10, `src/fw/facts.mjs` apiTargets, fact
   `api`, `src/lab/camapp.mjs` module_queues; answers finding 43's next step). The application's API sender posts a
   request to the queue id its target table holds at the target's index (docs/om1-shutter-spec.md 2.2): the last `add
   imm32,An` before its OlyQeWr call is the table and `mov (An),Dm` its entry, and a `mov imm32,a0; mov (Dn,a0),d0`
   before it loads the target's word of the table after it (E143 `0x503eb9b2` and `0x503eb984`, E122 `0x502cd985` and
   `0x502cd942`, D). A placed rule reads both from the sender's return (the port's place of E143's `0x503eba07`) and
   gives the table, its count and E143's module queues by name at E143's targets: 44 targets on E143, 43 on E118, E122
   and E125, 42 on E120 (no C3D target, 42), 44 on the 14 others (X). Each entry is the queue its name in the
   object-name table names on all 19 (X). On the family the five queues finding 43 found are named so: XTC_APP_EXEC
   `0x80`, TFT_EXEC `0x6e`, LENS_COMMAND `0x34`, FCS_EXEC `0x1e`, PWR_EXEC `0x86` (the port's words read `0x7a`,
   `0x68`, `0x31`, none and `0x80` or none); the words were wrong on ten other bodies too (E146 and E147 three, E145
   five, E134 and E125 four unplaced, E129 and E132 three, E137, E133 and E130 one, FCS_EXEC unplaced); E120's word for
   C3D named its queue `0xa2`, which S-MODACK no longer answers, no target of its table posting to it (X). S-MODACK now
   answers the table's queues and PC_PD_CMD_EXEC, which no target names, by its word where the port places it: the
   queue its name names on the seven bodies that hold the name (E143, E146, E147, E144, E148, E139, E134),
   REC_EXEC_PROGRESS and FMEMEXEC on E137 and E125, which hold none (not changed), and on the ten others, which hold
   none either and leave the word unplaced, no queue where the lab had read it as id 0 (X). E143's set is unchanged
   (checked against its words at the start). On E122's TFT path through the menu the API sender posted once to a
   module queue, 104 (TAKE_FUNC by the table and by the port's word alike), and to none of the five (X);
   `bin/modelcheck.mjs` gives every body and panel the lines it gave before (X: 31 runs, each step's state, card
   count, frame size and count box the same).
100. **Who releases the family's display syncs** (2026-11-10, `src/lab/camapp.mjs` S-DISPSYNC's text; D on E122, the
   same sites on E118 and E120, X). The application's CameraCommon::setDispSync (OlyHfwOpeCamCom.cpp, its call of the
   setter at `0x5069cc6b`) sets a panel's sync word, while which the GUI's updates wait (finding 39). 25 of the 26
   other calls of the setter `0x50695318` clear it, among them: DevDpc_DispCtrlBase's imageUpdate() and imageUpdate2()
   (`0x50917657`, `0x50917729`, `0x50917794`, `0x509177b9`) after the device's image update (`0x50917364`), once
   api_disp_Disp_Get_Wait_State (`0x502ca48a`) answers 0 for the device ("SyncUpdate!"); setThroughPermit()
   (`0x50917e32`, `0x50917e88`, `0x50917f27`); the still shooting component's rcvShtDrawThrough() ("AsyncThroughPermit
   ON", `0x507e3b7c`, which restores the word after its draw, `0x507e3bab`); the sequence parts' stopRecView beside
   startPeaking (`0x5081199e`, `0x508119c2`, the image sync after each, finding 39); the multi-exposure effect's start
   and stop and the level gauge's sequence, and the layer-custom paths (`0x5076a2af`, `0x5076a586`). So the camera
   releases the start's sync at the display's first image update, the through image's (I: that is what
   DevDpc_DispCtrlBase updates in shooting). The lab's hold is right in what it holds and commits (the GUI's pending
   buffers, committed by an image sync of the kind the pending state takes, as the image update's request commits
   them, finding 39) and differs in when: it releases at the end of the step in which the request came, where the
   camera's release waits for its first through-image frame, a time the lab, which runs no through image, cannot place
   (I). The panels: each of imageUpdate()'s clears names one panel's word (the setter's d1: 0 after the update of
   device 6, `0x50917657` and `0x50917794`; 1 after that of device 2, `0x50917729`; D; that each is the panel updated
   is I), S-DISPSYNC clears both, as stopRecView does.
101. **The family's through permit, image update and palette request take no device mask** (2026-11-10,
   `src/lab/display.mjs` DEVICE and deviceMask; answers finding 40's last sentence). E143's lab helpers pass E143's
   device mask (TFT 1, EVF 2) to the through permit `0x501c40d0`, the IMG fit `0x501df31a` and the palette request
   `0x503e52c7` (H-RESEND, whose DISPLAY cmd 4 carries it), all three unplaced on the family. The family's forms (D,
   E122): api_disp_Set_Through_Permit (`0x502c8f96`) takes a record {u8 permit, u32 device} and stores the permit in
   one byte, `0xa1c5a77d` (`0x502f6241`), for the device 2 alone, which api_info_Get_DisplayCurrent (`0x502d029b`)
   answers from the output-device property 4014 without its bit 16, or 0 with it (`0x502d02da..0x502d02f0`; the main
   display, TFT or EVF, and not HDMI, I); its callers pass 2 (`0x5076a236`, `0x507e3f33`); api_disp_Disp_Update_Image
   (its traces "device_type", "img_handle[0..2]", "through_permit" from `0x603f8384`) and
   api_disp_Disp_Update_Osd_Color_Pallet (`0x502ca1d6`, "aDeviceType", 0..2) take a device type, not a mask. E118
   holds the three names and traces (X); E120 holds api_disp_Set_Through_Permit, but neither
   api_disp_Disp_Update_Image nor the palette update's "aDeviceType": its image update is api_disp_Disp_UpdateScreen,
   whose traces name a record's device and its MAIN and SUB handles (`0x6039cdac..`, X, a string scan; corrected in
   review; its display API takes records, finding 49; what its device field holds is not read, so the refusal below
   stands there for want of a read value). So the family has no value for E143's EVF mask 2:
   DEVICE's masks are null on the kind-3 bodies and the three helpers (and play's TH live view) refuse there with that
   reason, where they had reached an unplaced function; none of them runs on the family's paths (X: modelcheck's E118,
   E120 and E122 runs unchanged).
118. **The E144 family's REC version: REC_FILE on its queue alone** (2026-11-10, `src/fw/facts.mjs` recFileQueue, fact
   `rec_file`, `docs/hle-gaps.md` 4.8.10; D on E144 unless tagged; finding 83's stop). REC_FILE (task 31,
   `0x503f5dc0`) receives REC's packet of 300 bytes from its queue (the word `0x60041864`, id 73) through REC's
   receive wrapper (`0x503f1206`: the kernel's receive with "rec.c", no timeout), with no event flag and no bind. For
   each packet its loop calls a trace, rec_file_start_process (`0x503f73c2`), where NoRecord (+282) is 1 the buffers'
   free (`0x503f5f3f`), else rec_file_destination_record (`0x503f6bb9`: RecordDevice bit 0 to rec_make_file
   `0x503f5e47`, rec_file_record `0x503f5fbb`), whose status it keeps (`mov d0,d2` at `0x503f5e05`, the lab's
   handled), rec_file_finish_process (`0x503f74a1`) and with Free (+286) the reply (`0x503f1192`); a status of 8064 to
   8191 ends the loop. The packet dump (`0x503f8314`) names every field in the packet, the image's address and size
   too (no image record, unlike E146's): pExifParam +28, HandleTarget +116, BuffAddr1 / BuffSize1 +136 / +140,
   HeaderSize +176, Addr / Size +180 / +184, Status +192, Mode +194, Media +198, Media2 +200, RecordDevice +202,
   ImgAspect +283, Free +286, FileType +298 (+296 on E134, E137 and E125). REC_IMAGE's rec_make_image_finish
   (`0x503f8c55`) posts a still's packet to REC_FILE's queue itself (`0x503f8da9`: Mode 4097 by its table
   `0x605791a4`, Status not 40662 and the shot's record's +28600 not 5) with "REC post_msg" (`0x503f1256`, 300 bytes),
   where E143's goes through REC's ring (`docs/hle-gaps.md` 4.3.3): S-RECIMAGE's post is the camera's route here. The
   other seven run the same loop as task 30 or 31; E139, E134 and E125 (the double-slot bodies) first call
   `0x503f2402` (E139's) with a 92-byte record of the task's stack (sp + 304) and, where its +88 is 1,
   rec_make_file_DoubleSlot (`0x503f3e0c`) in the destination record's place (I: the second slot's record); E137, E142
   and E140 call rec_make_file there directly. REC's module init is the function that ends `mov 8191,d0; ret` right
   before REC_MAIN's task, which holds the "rec_main" trace (E144 `0x503f0fa9` before `0x503f1010`; E143's
   `0x50539665` before `0x505396d1`), and binds one queue, to REC_MAIN's flag (E144 `0x60041868` to `0x60041726`, as
   E143's binds `0x60043252` to `0x600430fe`); E143's bind of REC_FILE's queue (`0x5053f189`) has no counterpart.
119. **The family's header maker and EXIF module** (2026-11-10; D on E144 unless tagged). rec_jpeg_exec
   (`0x503ff3e3`) takes the file's buffer from REC's pool 3 (`0x50401673`) into Addr, runs rec_jpeg_make_image
   (`0x503ff598`), frees a work area (`0x50401965`) and, with Status 0, runs rec_jpeg_make_header (`0x503ff64c`); no
   header area is cleared through the image engine before the encode (E143's `0x5054c982` has no counterpart), so
   S-JPEGENC stands in for the encode alone. The header maker sets HeaderSize 41984 (`0x503fff59`) and writes SOI,
   APP1 `Exif` (its length 41982 less `0x5030c51b`'s, the serializer `0x5030b3d4`) and after it `0x5030c4d4`'s part;
   it divides by the shot's crop area at +31550 ({x, y, xden, yden}, `0x503ffa31`, `0x503ffa6e`; rec_raw_make_header
   by +31558, `0x50405d8c`), which S-EXIFPRM sets to {0, 0, 1, 1} as on E143 (X: with it 0 the header maker faulted
   at `0x503ffa82`, the divide). The EXIF module's init (`0x5030b384`, its inner `0x5030b38d` loading the template
   `0x620eb760`) flushes no cache; TAKE's copy (`0x5030b3b9`) copies 31700 bytes; the EXIF set's date formatting
   (`0x5030dc6a`) takes the time record at +28508 with the format `0x4200` into DateTimeOriginal +4089, copied to
   CreateDate +4109 and DateTime +1364, in a 16-bit form of E143's add; E137 and E125 add the time to a3, E142, E140
   and E130 to d0 kept at (12,sp) (`0x502fcdfe`, `0x502e26c3`; X, a scan of the three forms: one hit per image). By
   body (X, the rule): the template 31708 bytes on E148, 29068 on E139 and E134, 27928 on E137, 27620 on E125, 27332
   on E142, 26956 on E140; the time record +28516, +25868, +25868, +24728, +23984, +23832, +23824; DateTimeOriginal
   +4089 on E148, +1785 on the six others (CreateDate +1805); DigitalZoomRatio +4224 on E144 and E148, +1920, and
   +1900 on E125; Make +1480 and Model +1504 on all; the crop areas E148 +31558 / +31566, E139 and E134 +28910 /
   +28918, E137 +27778 / +27786, E125 +27462 / +27470, E142 +27180 and E140 +26804 (no RAW header's area: their
   rec_raw_make_header holds no such divide).
120. **The family's file contexts and the camera's clock, by form** (2026-11-10; D unless tagged). E144's
   rec_file_record fills one file context of E143's 92-byte layout (`0x62127124`, `0x503f6041..0x503f60b6`: +8 the
   DCF block, +12 and +32 the chain write's and the entry's blocks (I: E142's fill sizes them 116 and 96), +40
   pExifParam, +44 the time record, +48 HeaderSize, +52 the size, +76 Media, +78 the type, +80 FileType; X: the fnode
   at +36 and the stamp in the DCF block read through it give the card's file) and records through it with the
   whole-file recorder's own builders (the open `0x50400188`, the reservation `0x50400368`, the chain write
   `0x504003f8`, the entry `0x50400556`, the registration `0x504006d5`, finding 71). E139, E134 and E125 pick one of
   two by Media as E143 does (E139 `0x503f4a61`: `0x62165420`, `0x6216547c`); E142 and E140 load theirs into a2 for
   the context fill `0x503c4340` (E142's: `0x622930f4`, its entry block one of 96 bytes). Where there is one, the rule
   takes the one data address rec_file_record loads into an address register whose +52 and +78 it also stores to by
   address (E144 `0x503f6083` and `0x503f6093`, E142 `0x503c491f` and `0x503c4919`; the same on E148, E137 and E140,
   X: a scan). The camera's clock setting is the one function of each of the 19 images that ends `mov
   10499,d0; movhu d0,(8,a2); ret` (E144 `0x500f022e`), and its clock read the function right after it (E144
   `0x500f024e`), the port's place of E143's `0x5012b7cd` on all 19 (X, a scan): the rule reads both there, where
   recFile took the read from the recorder (fact `recorder`, read on E144 and E148 only). It is also the clock read
   the 96-byte recorder calls on the eleven images that hold one (finding 122; X, a scan of its third call).
121. **REC_FILE natively on eight E144-family bodies** (2026-11-10, X: `test/test_storage.mjs --session` per body,
   32 checks each; refs/exif.mjs and exiftool). With the clock set through each body's clock setting (2026-11-08
   12:34:56) S2 gives `C:\DCIM\100OMSYS\PB080001.JPG` on E144 and E148 and `C:\DCIM\100OLYMP\PB080001.JPG` on E139,
   E134, E137, E142, E140 and E125: 62,857 bytes, 41,984 of the firmware's header, then the lab's stream after its
   SOI, from cluster 5. Its Exif: on E144 and E148 Make `OM Digital Solutions`, Model `OM-5` and `OM-5MarkII`, Exif
   version 0231 and 0300, the maker notes `OM SYSTEM` (19,636 and 19,644 bytes, CameraType2 the Model) and an XMP
   segment after the Exif (`0a 00` past HeaderSize, as E143's); on the six others Make `OLYMPUS CORPORATION`, Model
   `E-M1MarkIII`, `E-M1X`, `E-M5MarkIII`, `E-P7`, `E-M10MarkIV` and `E-M1MarkII`, Exif version 0231 (0230 on E125),
   the maker notes `OLYMPUS` (CameraID `OLYMPUS DIGITAL CAMERA`, 16,996 to 19,164 bytes) and no XMP, the Exif segment
   then reaching 2 bytes past HeaderSize; on all eight the three dates the clock's and IFD1's thumbnail of length 0,
   read by exiftool without a warning. The firmware's image count is 1 and its fnode 1 the file in the same session
   (S-CARD's count and list retired there, `src/lab/camapp.mjs` dcf_db), and the next session's numbering mount gives
   file 2. Around S2 E144 and E139 log E143's REC warnings (`0x0d090002`, `0x1e01500e`, `0x1e001001`, `0x1e01500d`
   twice). `test/test_playinfo.mjs` (two pictures, RIGHT, LEFT, INFO's three views) passes on all eight, 14 checks
   each. The rule reads none on E130, E145, E133, E129 and E132 (finding 123) nor on the E118 family, whose loop has
   the form but whose table names no "REC post_msg" function (the post's `0x1002` trace's code names the name before
   it, X).
122. **A correction to finding 71, and REC's trace table** (2026-11-10). Finding 71's recorder is one form of two: the
   whole-file recorder with blocks of 64, 96 and 116 bytes (the second the directory entry's) is on E139, E134, E137,
   E125, E142, E140, E130, E145, E133, E129 and E132 (X, a scan; E139 `0x515be1ab`, its clock read `0x500f0d89` and
   builders `0x503fede6` ..), none on the E118 family, so "none on the other 13" holds for the 100-byte form only.
   E139's builders are E144's instruction for instruction (D, but for data addresses and the folder name's `LYMP`)
   except the entry's block, which lacks E144's word at +28: the stamps at +28 and +32, the first cluster +36, the
   attribute +42, the folder's entry place +80 (`0x503ff344` against `0x50400556`, the place's copy `0x5062a1bc` against
   `0x506682e2`); E134's, E137's and E125's are E139's but for their error traces' line numbers (X, a diff); those of
   E142, E140, E130, E145, E133, E129 and E132 differ (not read). The rule `recorder` keeps the 100-byte form, so
   S-RECFILE's DCF steps are not extended to them. REC's trace table is on all 19 images (X); recFile's read of it,
   which wants a NUL before its head string, misses E134's, E137's and E125's, where a word precedes it (E134
   `0x6055d190`), and recFileQueue reads it there.
123. **What is left of the family's REC** (2026-11-10; D unless tagged). E130, E145, E133, E129 and E132: REC_FILE's
   task inlines its start and finish processes (E130 `0x503d9350`, both traces in its loop, `0x503d9382` and
   `0x503d942f`), and E130 holds no "pExifParam " dump string (X); they keep S-RECFILE through fileif (no rec_native,
   which test_facts leaves to each body, E142 giving it), their 96-byte recorder's builders not read (finding 122). On
   the eight: REC_IMAGE's own task (the post of rec_make_image_finish read, finding 118), the thumbnail and the
   shooting values in Exif (S-EXIFPRM leaves the template's), RAW files and the second slot, the shot's DCF checkout
   (`0x1e001001`, the HLS media check-in).
102. **The E118 family's REC version and its header maker, by a rule** (2026-11-10, `src/fw/facts.mjs` recHeader, fact
   `rec_header`; D on E122 unless tagged; answers finding 93's stop). The family's REC is older than E143's: its packet
   has no dump (no "pExifParam " in the image), REC's post (the function of the trace "REC post_msg_main", id 4; E143's
   post traces "REC post_msg", id 5, which the family's table names but no code traces) sends it with `mov SIZE,d1; mov
   "rec.c",a1; call` (`0x5050bcaf`: 216 bytes on E122, 280 on E118 and E120), and no receive loads "rec_file.c" (finding
   93). rec_jpeg_exec (`0x50515ab1`) opens `mov a0,a3; mov (124,a3),d3; mov 68,a2; add a0,a2; movhu (a2),d0`: d3 is the
   shot's EXIF parameter block, which its header maker hands the EXIF module's serializer (below; so finding 93's "block
   at +124", ?, is pExifParam), +68 is Mode, which rec_make_image dispatches on (`0x50510ca8`, 4097 the first of
   4097..4111 through the table `0x6063e3f4` to rec_make_image_exec `0x50510d0e`, which calls rec_jpeg_exec at
   `0x50510da6` where the packet's +208 is not 3 and two checks answer 0). It keeps the buffer REC's pool gives
   (`0x50517600`, rec_misc.c's `0x50516b3f`; its size from a table by the image size and the setting 53140, read with
   the port's place of E143's settings read, plus 41984, `0x50519ec1`) at +200 (`mov d0,(8,sp); mov d0,(200,a3)`,
   `0x50515afa`), calls rec_jpeg_make_image (`0x50515c18`) for a Mode other than 4100, 4107 and 4103 where `0x505170c8`
   answers 0, then the header maker rec_jpeg_make_header (`0x50515cbb`) where the encode left +14 0 (`0x50515b67`). The
   header maker loads the block (`add 124,d0`) and the buffer (`mov (32,sp),a0; mov (200,a0),d0`), stores HeaderSize,
   `mov 41984,d0; mov d0,(196,a0)` (`0x5051618d`), and writes SOI, `ff e1`, the length 41982 and "Exif\0\0"
   (`0x5051623c..0x5051626d`) before the EXIF module's serializer (`0x5052b526`, the port's place of E143's
   `0x50429935`, X) writes the TIFF data at +12. E118 and E120 (D): the same code with pExifParam +188, Addr +264 and
   HeaderSize +260 (`0x504fe72e`, `0x504fe77b`, `0x504fed96`), the packet in (28,sp) in the header maker. Finding 93's
   two traces: the second function of E118's rec_jpeg_make_header trace and of E120's rec_jpeg_exec and
   rec_jpeg_make_header traces call another trace function, with a string in a0 (E120 `0x504c15d8` -> `0x504b9a22`, E118
   `0x504e732e`; what they are, ?); the rule takes the rec_jpeg_exec of the family's opening that calls the traced
   rec_jpeg_make_image and the traced header maker it calls, one on each of the three, and the packet's fields from
   those instructions (the names E143's for the same uses, I: no dump names them). It finds it on E122, E118 and E120
   and on none of the other 16 images (X); `test/test_facts.mjs` pins the three (REC_HEADER_FOUND). Added in review
   (D): the header maker's mode checks (`0x5051790e`: 4108, 4099, 4100; `0x50517407`: 4100, 4099, 4106, 8193) answer 0
   for 4097, the Mode the lab gives (that 4097 is the still, as E143's, I); rec.c holds a 216-byte receive
   (`0x5050bbec`, through `0x5051869e` to the queue read `0x5004830d`, which loads "OlyQeRdCpu"; eight callers), the
   size REC's post sends; which caller is REC_FILE's is not read (?).
103. **The family's EXIF module and the shot's parameters** (2026-11-10, D on E122 unless tagged). The EXIF module's
   init (`0x5052b4d9`, `call; clr d0; ret`; one caller, `0x50186c73`) calls the template's init (`0x5052b4e2`: `mov
   0x618bb6b8,a0; call 0x5052c570`, then three stores and `ret`), which has no cache flush where E143's calls one; the
   template's copy follows it, `mov 0x618bb6b8,a1; mov -5520,d1; setlb; ...; lne; retf` (`0x5052b50b`: 22080 bytes; E118
   `0x50514558` 20084, E120 `0x504ed754` 20004). The EXIF set (`0x5052b51e` -> `0x5052cda4`) formats the dates `mov
   (8,sp),a2; mov (8,sp),a3; add 2313,a2; add 18404,a3; mov a2,a0; mov a3,a1; mov 0x4200,d0; call 0x5016841d`
   (`0x5052dcff`, one function from the entry: no return between, X) and copies them to +2333 and +1364 (`0x50002cb7`):
   the capture's time record at +18404 (E118 +18340, E120 +18284), a 16-bit add where E143's is 32-bit; the tag table's
   DateTime, DateTimeOriginal and CreateDate are these offsets and Make and Model +1480 and +1504 on the three (X;
   finding 93's table). The camera's clock setting `0x50167f55` ends `mov 10499,d0; movhu d0,(8,a2); ret` as E143's
   does, the one such end in each image (X), and the clock read follows it (`0x50167f73`, the port's place of E143's
   `0x5012b7cd`, X; E118 `0x501569b3`, E120 `0x5015274e`). X, a play session per body: the init leaves Make and Model in
   the template, 'OLYMPUS CORPORATION' and 'PEN-F' on E122, 'OLYMPUS IMAGING CORP.' and 'E-M5MarkII' on E118, 'OLYMPUS
   CORPORATION' and 'E-M10MarkII' on E120 (from the settings store as on E143, I; E118's Make is not a string of its
   main block, X); the clock set through the clock setting, the clock read gives it to the time record and the format
   `2026:11:08 12:34:56`. The EXIF set called natively on the copied block divides by zero (`div` at `0x50212ef5`, by a
   halfword read through a pointer on the stack, in TAKE's state; X), as E143's does (hle-gaps 4.8.10), so the lab
   formats the dates as it does and the exposure fields stay the template's.
104. **S2's file carries the firmware's Exif on the family** (2026-11-10, X: `test/test_storage.mjs` per body, 29 of 29
   checks on each; `src/lab/recheader.mjs`, `src/fw/models.mjs` exif_native). At the first picture H-EXIFINIT runs the
   EXIF module's init natively; at each picture S-EXIFPRM gives the shot's block (the template copied, the clock read
   and the dates formatted natively; no crop area or zoom ratio set, the header maker dividing by none of the block's
   zeros, X) and S-RECHDR the packet rec_jpeg_exec would hand its header maker (Mode 4097, pExifParam, Addr a lab buffer
   holding the lab's stream without its APP0 at +41984, the rest 0, I) and runs rec_jpeg_make_header natively; S-RECFILE
   writes the buffer's 41984 bytes and the stream as the file, through fileif as before. The file
   (`C:\DCIM\100OLYMP\P1010001.JPG`, its size 41984 plus the stream's): SOI, APP1 Exif of 41982 bytes, then the stream's
   tables at 41986 (its SOI as APP1's last 2 bytes, which the header maker leaves, X, where E143's XMP overwrites
   it); refs/exif.mjs reads IFD0's Make and Model as in finding 103 (exiftool 13.55 reads the same on E122, X in
   review, with 8 warnings: 4 undefined values, the dates' odd offsets, zero thumbnail and preview lengths),
   ImageDescription 'OLYMPUS DIGITAL CAMERA', Software 'Version 0.0' (where it comes from is not read, ?), DateTime,
   DateTimeOriginal and CreateDate the clock's, Exif version `0230`, FlashPix `0100`, the maker notes 'OLYMPUS' (14072
   bytes on E122, 13924 on E118, 13832 on E120), IFD1 with its thumbnail slot of length 0; ExposureTime 0/100, FNumber
   0/10, ISO 0, FocalLength 0/10 and PixelXDimension 0, the template's, as the EXIF set does not run. The file decodes
   (refs/jpeg.mjs) to the capture's block means. The header maker's return value is not used (d0 0 on E122, 0x1c on E118
   and E120: not a status, I).
105. **The family's DCF steps are not run** (2026-11-10, D on E122 unless tagged; "as on E144" does not carry).
   REC_FILE's rec_file_record (`0x50510091`) makes the five requests in its own builders, at the port's places of E143's
   but the registration's: the open (`0x505162f8`, its block +2 drive, +4 `xxxOLYMP`, +16 the stamp, the fnode back at
   +24, code 0x32 by the synchronous send `0x5004c303`, E143's `0x5002e39d`), the entry (`0x50516667`, 0x66) and the
   registration (`0x5051679a`, 0x33) as E143's; but the reservation calls the file system's cluster allocation itself in
   REC's task (`0x50516481` -> `0x50566a01` -> `0x5056f91d`; the port's place of E143's, `0x505164cf`, is its twin with
   `0x50566a51`, called from `0x5051c8e3`), not FILECLBK's 0xf1, and the chain write posts the message {reply queue
   `(0x60041144)`, code 0x54, the block} asynchronously to the queue the open's send names (`(0x600410de)`, I:
   FILECLBK's) through rec_media.c's send (`0x50516530` -> `0x505186eb`; for the drive word 0x8010 a message 258 to
   another queue, `(0x6004117c)`, ?), its block in E143's layout (+6 drive, +8 cluster, +12 sector, +16 sectors, +20
   buffer, +28 mode, +32 cluster, +36 bytes) with the sectors by the drive's own form (`0x50568f79`: 512-byte sectors
   rounded up to whole 2048-byte units where `0x50582b63` answers non-zero). X on E122: S-RECFILE's DCF steps
   (src/lab/storage.mjs record(), E143's requests to FILECLBK, as on E144 and E148) with the family's clock read get the
   open's and the reservation's status 0 and the chain write's 0xe13, the one load of it in the file system's code,
   `0x5056baaf`, in a cluster chain's walk (I: the chain ends while sectors remain; not read further). So the family
   keeps S-RECFILE's fileif path, and the DCF database learns of the file at the next mount, as before. Next: the chain
   write's cluster chain against the reservation the family makes itself (its mode word +72 2, D), then a rule of the
   family's builders.
106. **The family's playback header load, and what stands for it** (2026-11-10; D after finding 92, X where tagged).
   With finding 104 the file holds what the play module's header parse requires: play_load_load_exif_header (E122
   `0x50ad901c`) reads the file's first bytes, at most 66560, which hold the whole 41986-byte APP1, and the EXIF
   module's JPEG parse (operation 1, E122 `0x5052a7d7`) needs SOI and an APP1 whose data opens `Exif\0` (X: the file's
   bytes 0, 2 and 6; the parse itself not run). None of it runs in the lab (finding 90's observation, not repeated with
   the new file), and S-PLAYSEQ answers getStillInfo from the lab's record of the capture (camapp.mjs still_record). The
   two now differ: INFO shows the record's exposure, ISO and focal length (`125`, `25mm`, finding 91), where the file's
   Exif holds the template's zeros (finding 104), so a native load would show other values until TAKE's EXIF set fills
   the block (I). Running the load needs the play module's handle, play buffer and image record (finding 92), which the
   PLAY tasks and the component's start make.
124. **The E118 family's Format runs in its application** (2026-11-10, `src/fw/facts.mjs` mediaHls, `src/lab/media.mjs`;
   D at E122's addresses unless tagged). The menu path on the family (X, frames on E122, E118 and E120): MENU opens
   Shooting Menu 1, whose first row is Card Setup; RIGHT enters the page and OK opens it, which offers All Erase and
   Format while the card holds a picture and the Format confirm alone (Yes, No, the cursor on No) on an empty card. Yes
   runs OlyHfwOpeMdaCtrl's format sender (`0x506a6c5e`, of the opening and callback id 16 of E143's TRA 1511 sender
   `0x50ac937f`), which starts the media control itself (`0x506a819b`, X: d0 the command, 1, d1 the media, 0) where
   E143's sends the HLS function component a transaction: no transaction runs at Yes (X: S-TRAACK's log), so the
   family's CmpCst_Function has no part in it. The start sees the media status's bit 7 (`0x502d0c73`), calls the
   command's API through its dispatcher `0x506a836c` (commands 1 to 5; 1, api_media's format `0x502d0a63`, API
   `0xe0005`, which posts FILECLBK `{6, token, 0x34, block}` as E143's `0x503f0820` does) and registers a process of 44
   bytes (OlyHfwOpeMdaCtrlProcessEvFw, ctor `0x506a7c09`) with OlyHfwEventManager (`0x5069a761`). The process's handler
   (`0x506a7d08`) takes the file module's progress `0x04020011` (the callback (16, 3, percent) through getMediaProgress
   `0x502d0b04`) and the API's reply as an event whose code's upper half is the token's, d1 the status, in the
   application's event manager natively. X on E122: the card formatted (4,198 SD writes), FILECLBK's reply status 0 for
   token `0xf0040000`, the handler's event `0xf0040000`, the bar full. During the format FILECLBK slept 500 ms once
   where logsec's mount path finds UI_IN's last code `0x1506` (`0x50562b6b` -> `0x5057b8b1(500)`; E143's 740 ms at
   `0x508ac202`, hle-gaps 4.8.3).
125. **The end goes to the camera base, whose thread does not run (S-MDAEND)** (2026-11-10, D unless tagged). On the
   reply the handler sends the progress at 100, then two requests to the camera base through `0x5073c573`, which gens
   them (OMReactive's gen `0x5092fe44`) to the inner reactive of StateTransitionFactory's singleton (`0x61602c58`):
   12986 (+32 1; its closure has no function) and 12965 (+32 0, +36 1), whose closure (+28; ctor `0x506d164f`, 28 bytes:
   +12 the argument, +16 the function; vt[0] `0x506d1691` calls the function with the argument when it is not 0) holds
   `0x506a7c9e` and the result callback (16, 72, 0) (`0x5069825a`, X). `0x506a7c9e` posts the callback (`0x50697e5b`,
   `0x50697f12`) and calls `0x5073c0e3(15, 0)`, whose (15, 1) the start made (I: a lock of the media control). The
   reactive is the camera base (I: its vtable sits among Cab_CameraBase.cpp's strings, "standbyState",
   "shootModeState"); a handler that tests for 12965 (`0x5083a076`, whose class is not read) passes the closure on
   (`0x50910c21`) with a request of its own, a 40-byte event (`0x507713b0`) to its +236, not read (?). It runs on the
   OXF main thread (HIGHLEVEL_MAIN, task 64, `0x50693849`), dormant in the default session (X: state 0x10), so neither
   event was handled (X: the reactive's handleEvent `0x509116dc` never ran) and the application stayed at Busy with the
   bar full over the formatted card, on all three (X). In a default session one other event goes there, 11827 at PLAY's
   return (X), unhandled as well. S-MDAEND stands in for the camera base's part: at the handler's sends (the rule's
   sites) it records the event and, after the step, runs the DCF numbering mount (the next file number, I as
   S-MDACTRL's) and the closure through its own vt[0], natively; the events stay in the camera base's queue. X: the
   application leaves Busy for the shooting screen, 1470 shots and `00:37:19` on E122's fresh card. That the camera base
   calls the closure once its request is done is I; where the family returns after a Format on the camera is ? (E143
   returns to the menu). Any command but the format, or the handler's other path (another command's end or an error,
   `0x506a8101`), stops the session.
126. **The card out and in on the family (S-MEDIA)** (2026-11-10, D unless tagged). The family's application has E143's
   receiving side: OlyHfwReception (its singleton creator `0x506d0e75`, vtable slot 2 synchronous in E143's form), the
   media manager's mount notification (E143's 711, the family's id 13596, ctor `0x506a670d`, 40 bytes, sent by
   CapMed_MediaManager with the states 8, 4 and 2 at `0x5076f37d`, `0x5076f429` and `0x5076f491`), the HLS mount state's
   getter and setter by media kind (4 the SD card, 1, and 32 where E143 has 8), the card switch `0x1506`, which the file
   layer registers with UI_IN (`0x50562ce6`) and the SD driver asks UI_IN's level getter for (`0x50582a1d` ->
   `0x50177e44`, the port's place of E143's `0x5014c015`); one slot. S-MEDIA runs unchanged at these. X on E122: out,
   the firmware's own no-card state, "No Card" with the card icon struck through and the count 0 and `00:00:00` in
   orange (E143 draws no such screen, hle-gaps 4.8.3), the drive status 1, and the SD driver's supply request {32, 255,
   1} answered by S-SDPOWER; in, {32, 255, 1} and {32, 0, 1} (what 0 and 255 select is ?, hle-gaps 4.8.4), the mount
   after 275 ms of lab time, 1470 and `00:37:19` back (the frames; finding 128 has the checks). The player's card input
   had stopped before (a TypeError): its lookup of the switch's control row read the UI_IN code of each fwswitch row,
   and a row a body's tables do not wire has none (`src/lab/play.mjs` card_input; fixed). That this is E147's "control
   row without a UI_IN code" (hle-gaps 4.8.7) is I; E147 was not tried again.
127. **The rule and its reach** (2026-11-10, `src/fw/facts.mjs` mediaHls, fact `media`; `test/test_facts.mjs`
   MEDIA_FOUND). The rule starts at the process's handler and reads each part by its form (the comment at the rule has
   them): the handler's sends and start, the reception's creator and synchronous slot, operator new, the mount
   notification (of two constructors of its form after the media manager's allocations, the one sent the states 2, 4 and
   8; the other is id 5627, X), the mount state's getter and setter (of three getters of the form, the one whose words
   the setter writes, X) and the switch code with UI_IN's level getter. E122's values are the ones found by hand and run
   above (X); E118's and E120's the rule's, run in their sessions (finding 128). The class is held by 15 of the 19
   images, not by the E143 family and E148 (X): the E144 family's application holds the same media control process,
   which corrects the reading that it has a function component of its own (ROADMAP); the rule reads every part on E118,
   E120, E122 and E145 only, and gives no fact elsewhere (X: the E144 family's start and mount state, E142's and E140's
   reception creator, the TG-5s' and E125's level getter are of other forms). Whether the E144 family's Format runs as
   the family's is not tried (?). `src/fw/models.mjs` card_fs.hls 'rule' takes the fact on E118, E120 and E122 with the
   family's library numbers (`src/fw/facts.mjs` MEDIA_LIB) and the module event post at the port's place of E143's
   `0x50025095`.
128. **The family's HLS side in play** (2026-11-10, X: `test/test_storage.mjs --hls` per body, in `bin/test.mjs`; 21 of
   21 checks on each of E122, E118 and E120, the same numbers on the three). On a blank 8 GiB card after S2's picture:
   MENU, RIGHT, OK, DOWN (Format), OK, DOWN (Yes), OK; the application's start with command 1, media 0; the card input
   refused while the format runs (S-MDAEND's start to its end, as E143's during S-MDACTRL; it had pulled the card in
   mid-format before, X); 12986 logged without a closure, 12965's closure run (E122 `0x506a7c9e`, E118 `0x506b6bd5`,
   E120 `0x506637c4`, each through its closure class's vt[0]); the format within 839 ms of lab time after Yes. Read
   back independently (`refs/volume.mjs`): FAT32 `NO NAME` at 8192 with 32 KiB clusters as the insertion's format gave
   it, the root empty, the picture gone, 260,351 of 260,352 clusters free in the FAT and FSInfo; the firmware's image
   count 0, its next file 1, the remaining shots the fresh card's; the application back at the shooting screen; S2 then
   writes `P1010001.JPG` again. The card out: the drive unmounted (detect state 1, the HLS mount state 0), UI_IN's
   `0x02021506` with the level 1, the screen changed (the remaining-shots query itself still answers the count, so the
   screen's 0 is the application's, I); a second removal refused. The card in: sd_mount initialises the card again
   (CMD2 among more than 20 commands), the FAT mount after 275 ms, the drive status `0x3780`, the boot sector unchanged
   (no format), the count and the whole screen as before the removal; S2 then writes its picture. E143's and E146's HLS
   sessions are unchanged (18 of 18 each, X).
129. **Left open** (2026-11-10). The camera base's own work at the end (its request to its +236, and 12986's), and
   whether the camera issues the DCF numbering mount after a Format (S-MDAEND's, I); the media control's other commands
   (All Erase among them, not driven); the second slot (the family has one); an SDXC card on the family's HLS side (not
   tried); the menu path to Format, read from the frames and checked by the start's command, not found by a rule in the
   menu's tables (the family's Menu_Viewer tables are not decoded in the lab); where the family returns after a Format
   on the camera (?).
130. **S-MODACK's PC_PD_CMD_EXEC on E137 and E125** (2026-11-10, `src/fw/facts.mjs` objectNameId, fact `api.pc_pd`,
   `src/lab/camapp.mjs` module_queues; corrects finding 99's rule). The target tables name no PC_PD_CMD_EXEC: E143's
   (`0x606214a0`, 44 targets), E137's (`0x604de358`, 44) and E125's (`0x604f7d68`, 43) hold XTC_APP_EXEC, PLAY_EXEC,
   TFT_EXEC, TAKE_EXEC, REC_EXEC_MAIN, FILECLBK_UEXEC, LENS_EXEC, ADJ_EXEC, TAKE_FUNC, ZOOM_EXEC, FCS_EXEC, PWR_EXEC,
   DPST_APP, ADJ_SLF_EXEC, BC_EXEC, DISPLAY, AUD_EXEC, UI_OUT_EXEC, LENS_COMMAND, MOVE_MAIN, C3D and API_DUMMY at the
   same targets (D: the words; the names X, from the object-name tables), so there is no entry to read: the queue is
   a kernel object with a name, and the body's form is whether its object-name table, the `{char name[24], u16 id}`
   records, holds that name. E137's (250 records from `0x6144108c`) and E125's (249 from `0x614385ac`) do not (X); the
   port's place of E143's id word `0x60043362` there (E137 `0x60040eda`, E125 `0x6004119c`) is REC_EXEC_PROGRESS's
   (0xd6) and FMEMEXEC's (0xdc) word. The rule now reads the queue by its name (objectNameId: the record whose name
   field is the name, in a run of at least 100 records; refused where two hold it): 0xcf on E143, E146 and E147, 0xd6
   on E144, E148 and E139, 0xdc on E134, each the queue the port's word read (X), and none on E137, E125 and the ten
   others, where S-MODACK so no longer counts REC_EXEC_PROGRESS or FMEMEXEC as a module queue. No session changes by
   it (I, from the paths): the API sender posts only to its table's queues, and the camera application's
   synchronous-send stand-in returns E_OK to a queue without a running receiver whether S-MODACK names it or not; on
   E143 the queue's 12 id-word reads are 9 synchronous sends, 2 posts and a receive at `0x5102b35f..0x5102ba1a`
   (D; beside the C3D module's code, I; docs/hle-gaps.md 4.1.11). `bin/modelcheck.mjs` after the re-port: its 31 runs
   pass (X).
108. **PLAY in the playback wizard OK opens, and the image type** (2026-11-10, `src/lab/camapp.mjs` S-PLAYCOMP's
   get_img_type and S-PLAYSEQ's getImageType, IMAGE_TYPE_STILL; answers finding 94's last open question and extends it:
   E143 and nine more bodies stopped too). The symptom (X, a session per body: start, S1, S2, PLAY, OK, PLAY): OK opens
   SS_MENU_MAIN/ID_ST_WIZARD_MENU_ENTRY with the frame unchanged, and PLAY there stops the GUI task (E122's task 149) at
   a jump to a low address, through `calls (a1)` after `mov (W),a0; mov (a0),a1; mov (N,a1),a1` with the current screen
   word W 0: E122 `0x00008010` at PLAY down (message 0x9010; the state's handler `0x50cbd271`, called by the state
   dispatcher at `0x50baaab9`, its `calls` at `0x50cbd292`, W `0x6161c024`, N 32; fault 3, mdr `0x50cbd294`), E130
   `0x0000801f` at PLAY down (`0x50d9f6bf`, `0x623b6c54`, 32), E143 `0x00000334` at PLAY up (0x9011; `0x5121f3b2`,
   `0x60375ba8`, 36); E118 and E120 hold the same handler (`calls` at `0x50c9ad4f` and `0x50a1abf9`, W `0x615f7dd0` and
   `0x615f65a4`, D). The target is the vtable slot read from address 0, so it differs by body: before the fix the same
   stop on E146 (`0x0000034c`, fault 7), E137, E142, E140, E125 and E145 (`0x00008940`), E133, E129 and E132
   (`0x0000801f`), 14 bodies with the family's three; OK opened nothing on E147, E144, E139, E134 and E148 (X). The
   candidates: (a) S-PLAYSEQ's finish of OK's request 286 (PlaySelect's single mode with a sub-area, its trace "pSubArea
   [TL:%d,%d].." at E143 `0x50b6e60a`, finished by its callback `0x50b6ea5c` as CBC_PLAY_SELECT / CBS_READY_SINGLE_MODE,
   50 / 67, D; the names from the {value, name} tables at `0x50dad1e0` and `0x50daec00`, D) bringing too little: ruled
   out, the post reaches the GUI, which moves from ID_ST_DRAWING to the wizard state and runs the state's entry handler
   (E143 `0x5121745e`) to its end (X: a call trace of OK); (b) the lab's PLAY coming before a screen the camera would
   have made by then: ruled out, the same trace shows the handler asking for no screen at all; (c) an answer the
   wizard's kind needs, verified. The entry handler takes the wizard kind, the u16 +12 of the wizard context
   (`0x60375bf8`; getter `0x51257b36`; the handler logs it as "[GUI App]:StWizardMenu_Entry - Disp_Play_Wizard (%d)"),
   into a jump table of 14 screens (`cmp 13`), each through the screen change (E143 `0x512552ec`, E130 `0x50de51ab`,
   E122 `0x50cf6ccd`; its three stores of the screen factory's result are finding 94's three writers); the kind was
   65535 (X), the context's reset value (`0x51257aa4`), so no screen was asked for, the screen change never ran (X) and
   W stayed 0. OK sets the kind in `0x510dbb29` from OlyApiPlayCommon's getImageType (its log at `0x6133146f`) through
   the table `0x51311894` of {type, handler}: 0xf00, 0x200, 0x100 and 0x400 to the kind 6 or 12, 0x10 to 11 or 13, 1 to
   8 or 13, 4 to 7 or 13, 5 to 9 or 13, 8 and 9 to 10 or 13, 0xff as 1; 0 sets none (D; the same table on E122
   `0x60ddb940`, E118, E120 and E130, X). S-PLAYCOMP answered the component's get_img_type 0 and S-PLAYSEQ left the
   family's synchronous request 2 unanswered (its response's u16 +0, read at E122 `0x506aac2f`, D), so the type was 0: a
   lab defect, a stand-in's answer missing while that screen comes up. The value: E143's
   Cmp_PlayComponentBase::get_img_type (`0x50c465c5`) maps the media API's file type of the picture (`0x5040184d`, from
   the DCF fnode's kind at +88) through its table (`0x50e73228`): file type 1 to 1, 2 to 2, 3 to 4, 4 to 0xf00, 5 to 5,
   8 to 9, 9 to 8, 10 to 0x400, 14 to 0x10, the rest to 0 (D; E130's the same instructions, `0x5086004c`, X); the lab's
   pictures are the DCF database's file type 1 (X: S-CARD's image count is the count of type 1), so their type is 1. The
   family's play module's own mapping is not read (?); its GUI's table being E143's, 1 is taken there too (I), and it
   opens the same "JPEG" wizard (X). S-PLAYCOMP's get_img_type and S-PLAYSEQ's getImageType now answer 1 for a picture
   shown, 0 for none. After it (X): on the 14 bodies OK draws the wizard (E143 "JPEG" with one item, Rating; the
   family's "JPEG" with one item and Back / Set; why the other items, Erase among them, are not offered is not read, ?)
   and PLAY returns to the shooting screen; E147, E144, E139, E134 and E148 still open nothing at OK (why, ?). E143's
   and E146's playback frames are unchanged (their PLAY does not ask the type, X).
109. **The family's requests that read the response's first word** (2026-11-10, `src/lab/camapp.mjs` SYNC_ZERO; D on
   E122, the same request ids at E118 `0x506b9dd7`, `0x506b9df9`, `0x506b9c68`, `0x506b9cb1` and E120 `0x506669c6`,
   `0x506669e8`, `0x50666857`, `0x506668a0`). The family's GUI asks PlyCom, at PLAY, request 303 (u32 +0; isProtect by
   the order of PlayCommon's name table, erase 301, isReservePrint, isProtect, isRecording 304: I), isRecording 304 (u32
   +0, its trace "OlyHfwOpePlyCom::isRecording result:%d isValue:%d" at `0x6096dfe5`) and getShortMovieAlbumNo 501 (u16
   +0, `0x6096df6d`), and at OK getSelectPicNumber 306 (u16 +0, `0x6096df0c`) (X, before and after the type was
   answered). S-PLAYSEQ answered none of them: each read the response's +0, which no answer had written before, 0, and
   which getImageType's answer now leaves at 1, so each read 1 (X): PLAY drew a protect key, a sound mark and an album
   mark with 1 (I: the three by their look), and OK's kind function took 306's 1 for a selection and opened nothing
   (E122 `0x50bc3b99..0x50bc3bb3`: with a selection, and the settings 2059 and 2040 not 1, no wizard, D). They are
   answered 0 now, as S-PLAYCOMP answers the component's (not protected, not recording, nothing selected, no album; I
   for a picture the lab took), and PLAY's frame is the one it drew before the type was answered (X: E122's composite,
   the same digest). Any other synchronous request S-PLAYSEQ does not answer is now logged as not answered (X: 285 at OK
   on E143, E146, E130 and the family, 241 and 334 at UP in playback) and still reads what the last answer left: open.
   285 is sent by OlyHfwOpePlySel::start (E143 `0x50b6e4ba`, after its trace) and 241 by OlyHfwOpePlySnd::setVolume
   (`0x50b7168f`, after its error traces), D; 334's sender (a single-frame operation that logs a sub-area, I) is not
   named (?).
110. **Erase: the requests, and S-PLAYSEQ's refusal** (2026-11-10, `src/lab/camapp.mjs` ERASE_REQUESTS and SYNC_ERASE;
   corrects S-PLAYSEQ's text and finding 94's reading of E130's request 21, D unless tagged).
   PlaySingleFrame::eraseCurrent sends the asynchronous request 21 (E143 `0x50b6fa6d`, after its trace
   "OlyHfwPlaySingleFrameOperation::eraseCurrent#"; E122 `0x50733116`, E118 `0x50742bc3`, E120 `0x506ef09d`, E130
   `0x50793ad0`, E144 `0x508ef872`, E146 `0x50b7c852`); PlyCom::erase sends 301 (finding 94's sites, and E118
   `0x506b978a`, E120 `0x50666379`, E144 `0x5084d6f4`, E146 `0x50ad8284`), PlaySelect::eraseCurrent 510 (E143
   `0x50b6f254`). Their siblings (2026-11-10 review): OlyHfwOpePlyLightBox::eraseCurrent sends 395 and ::erase 396 (E143
   `0x50b6cc90`, `0x50b6cbfb`), OlyHfwOpePlyIxp::eraseAlbum 497 on E122, E118, E120, E142, E140, E130, E133, E137 and
   E125 (E122 `0x5072e778`; on the other ten it returns 0xf0000001 without a request), and OlyHfwOpePlyRec::erase the
   synchronous 265 (E143 `0x50b6e106`; PlayRecord::erase, the picture's sound record by the name, I); PlaySingleFrame's
   eraseAll and eraseEvent traces are not referenced. Each of these ids is the same on the 19 bodies (by each
   function's trace, D) and sent from that one site alone on E143 and E122 (D: every request id set there). The
   single-frame callback (`0x50b7118d`) takes 21 at kind 3 (a progress, I) and at kind 2 calls `0x50ad37d4` on its a1
   and posts CBC_PLAY_SINGLE_FRAME / CBS_ERASE_CURRENT (27 / 32); 23 it posts as CBS_ERASE_ALL
   (31; the sender of 23 not found, ?); PlaySelect's callback (`0x50b6ea5c`) finishes 510 as CBC_PLAY_SELECT /
   CBS_ERASE_CURRENT (50 / 32). On the camera the component erases in its state machine
   (Cmp_PlayComponentBase::state_erase_current, CmpPls_PlaySingleComponent::erase_current_start_enter,
   app_play_idle_erase, which calls app_select_execute `0x50c33967` with `0x02000089`; by their traces), and the file
   module's DCF edit names its object deletes DCFED_OBJ_DEL, DCFED_OBJ_DEL_OPT and DCFED_OBJ_DEL_PART (strings at
   `0x509f345a..`); which request the component sends for it, with which block and to which queue, and how the
   database's count follows, is not read (?). The request 21 finding 94 saw E130's Delete, UP and OK send and S-PLAYSEQ
   finish with result 0, then request 8 and the picture kept, was eraseCurrent's (X: the execute called from
   `0x50793b05`): the silent success S-PLAYSEQ's text and finding 94 foresaw for 301 had already happened there.
   S-PLAYSEQ now refuses 21, 23, 301, 510, 395, 396 and 497 at their execute and 265 at its request, with a
   FirmwareError naming the request and its caller (X for 21 on E130, E142, E140 and E133: the session stops at OK with
   the refusal, both files on the card by refs/volume.mjs; golden's, modelcheck's and test_playinfo's sessions send
   none of the others, X). The play
   requests that write a file (the edits' saves, OlyHfwOpeEdtRaw::save 284 and OlyHfwOpeEdtRsz::save 120 among them by
   their traces, I) are still finished as every request is, with nothing written (camapp.mjs play_finish): not erase,
   open. The native erase this round asked for (two pictures, one erased in playback, the count, the remaining picture
   and the file gone from the card, the last erased to No Picture) is not done: it needs the DCF edit's object delete
   read and sent as the component sends it, then the play module's notification, on each body by a rule.
111. **Who opens the erase dialog** (2026-11-10, X: Delete in playback with one picture on each of the 19 bodies; D on
   E143). Delete opens SS_MENU_MAIN/ID_ST_WIZARD_MENU_ENTRY with the erase dialog (the screen change with screen 143,
   E130's call from `0x50d9d53b`) on E142, E140, E130 and E133, and changes nothing on E143, E146, E147, E144, E139,
   E134, E137, E125, E148 and the E118 family; E145's, E129's and E132's UI_IN tables hold no Delete key (0x0084), which
   the player refuses as not wired. E143's Delete handler (`0x510d7773`) asks getSelectPicNumber twice (vt +144, through
   S-PLAYCOMP's getSelectPicNumberSpecifyMedia, 0), then canExecute(MODE_ERASE), the property 3238 (its log at
   `0x61330314`), and isProtect (vt +56, its log at `0x61330338`), and opens the dialog (`0x510d783e`) only where one of
   the two is 1; the lab reads the property as 0 (X). Who sets 3238 on the camera is not read (?). The family's Delete
   reaches its GUI (X: it asks 306 and 303 at the press), so finding 94's "the family's [code] is not read" does not
   hold: the player sends the code the family's own UI_IN tables give the key (`src/lab/play.mjs` apply_uiin_layout, X);
   what keeps the dialog shut there is not read (?).
112. **Coverage of the wizard and of the erase's refusal** (2026-11-10, `test/test_playinfo.mjs`). Between LEFT and
   INFO: OK (the wizard's state and a changed frame, or on OK_OPENS_NOTHING's five bodies the state and the frame kept,
   held strictly), PLAY (the shooting screen) and PLAY again (the newest picture with PLAY's frame); at the end, on
   ERASE_DIALOG's four bodies, Delete (the dialog's state), UP, OK (the refusal of request 21) and both files on the
   card. X: 17 checks pass on twelve bodies, 18 on the family, 20 on E142, E140, E130 and E133, 338 in all; with the
   camapp.mjs before these findings the new steps stop E122, E130 and E143 at PLAY in the wizard.
113. **What the application does with touch on the EVF** (2026-11-10, D on E122 and E144 unless tagged; the camera
   application's touch module, SubAppMdlTouchPanel, by its traces). Its action (`actionTouchPanel`, E122 `0x50b80365`)
   and its display change (`DispalyChangeTouchPanel`, `0x50b80b53`, called at `0x50b75eb1`) read the display state
   (`0x50b7637d`). On 2 and 3 (the monitor's, I) its TFT judge (`0x50b807e0`: the module enabled, getSettingUser(426) 1,
   setting 285 0) starts the panel with every gesture flag but FLICK, 0x1f1 (`0x50b801f4`, `0x50b8025b`: the open
   through HFW's touch init) or ends it (`0x50b802d1`: the close). On 6, the built-in EVF (finding 36), its EVF judge
   (`0x50b8083b`: the module enabled, settings 284, 38 and 15130 and two state reads, not read further) passing, starts
   it again as the "EVF touch pad" (the display change ends it first) (`0x50b80a38`, "activated EVF Touch Pad"): the
   driver's control area on (its area set `0x5030bda9` with mode 1 over x 0..719, y 0..479 on E122, `0x50b80aa6`; over x
   290..719 on E120 and the E144 family, E144 `0x50cedd96`), the gesture flags by its argument (0x1f1 again, through
   HFW's mask builder `0x5073a6fb`, where the argument is 1; DCLICK alone, 0x40, where it is 0), then the start; where
   the judge or the pad's own check fails (E122: a check of id 867 through another settings object and getSetting(426)
   1; E144: of 1417; what that check reads is not read) it ends the pad (`0x50b80b00`: area mode 0, the module's state
   ended). The argument is a store value: E122's id 867 at the action (`0x50b803c3`), 1109 at other states
   (`0x50b7bc6e`); 0 on E144 in the lab's default session (X: the mask 0x40). E118's module has no EVF branch: its
   action (`0x50b75a42`) starts the panel on its judge (`0x50b75e24`, E122's TFT judge, display state 2 or 3) and ends
   it otherwise (`0x50b759ae`), and its image holds no "EVF Touch Pad" trace and no area set (X, a string scan and a
   scan for the area's clamp), so the E-M5 II's panel is closed while its EVF shows (X, finding 116).
114. **H-TPSTART is the application's start's** (2026-11-10, X: observers on the driver's open, close and mask set in a
   TFT session per body; corrects finding 89's sentence on E143). The camera application's start ends the panel (the
   driver's close), starts it through HFW's touch init, which opens it with HFW's callback, and the GUI sets the mask
   per screen on E143 too: the close `0x501e4139`, the init `0x50b76d47` and the open, which returns 0, at 2756.2 and
   again at 2771.3 ms of lab time (finding 89 had "E143's `camapp 1` runs no such start"). H-TPSTART's open and mask at
   the bring-up are overwritten before any input on every body that runs the start. The lab now leaves H-TPSTART out
   where H-TPINIT runs before the display open (`src/lab/play.mjs` touch_bring_up, fact touch_int: the E144 and E118
   families; the player's stand-in list drops it there): without it each of the 13 bodies' starts opens the panel once
   with HFW's callback (E122 at 615.4 ms, E118 and E120 651.6, E144 2830.1, E134 416.4) and the TFT shooting screen's
   mask is the GUI's (0x11f1; E118's 0x1f1, set by its GUI at 6757.6 ms), and `test/test_touch.mjs` passes the TFT taps
   on all 13 as before. With H-TPSTART put back at the bring-up's end (an experiment, not committed) the TFT sessions of
   E118, E122 and E144 give the same masks, frames and gestures at the same lab times through two taps on the touch
   mode icon. E143, E146 and E147 keep it: golden records E143's sessions with it, and its removal there is not tried.
115. **The GUI's gesture mask on the EVF, and the AF Targeting Pad** (2026-11-10, D unless tagged; `test/test_touch.mjs`
   EVF_PAD). The GUI's gesture set for a screen (E122 `0x50d0e9bb`, nine callers; E144 `0x50f32327`) returns unless a
   setting reads 1 (E122's 426), sets every flag and, where HFW's output state is 5 (the EVF, I; X: the EVF sessions
   take that branch), reads one store id: with 1 it traces "[GuiTouch] Set EVF Touch To ON" and passes every gesture but
   FLICK (0x1f1), otherwise "... OFF" and its build's mask: 0 on E122, SLIDE and DCLICK (0x140) on E120, E137 and E130,
   DCLICK (0x40) on E144, E148, E139, E134, E140 and E125 (the flags stored after each trace's load, X: a scan of the
   ten); on another output it copies the screen's own eight flags. The id is E143's 1415, the menu's row "AF Targeting
   Pad" (tab id 3, page 218, values 0 and 1, by its menu data); at the same place E120 867, E122 1109, E144 and E134
   1417, E148 1453, E139 1416, E137 1418, E140 1427, E125 1425, E130 1426 (I: each its build's AF Targeting Pad). The
   GUI's double tap on the EVF (E122 `0x50d011cd`, "[GuiTouch] ActivateEVFTouchPad"; E144 `0x50f22bb8`) acts only with
   that id at 1 and then toggles a second one (E122 867, E144 858). In the lab's store every pad id reads 0 (X,
   S-PERSIST's 'before' in finding 116), the setting's Off.
116. **Taps with the EVF active** (2026-11-10, X: play sessions started on the EVF, `test/test_touch.mjs` evfSession).
   E118: no report is read and HFW sees nothing (its panel closed, finding 113). The ten others, the pad off: the start
   leaves the GUI's OFF mask of finding 115 (on E122 at the GUI's set at 6907.5 ms, after the application's 0x1f1), a
   tap at 360, 240 is read (two reports) and HFW sees no gesture. With the pad's id set to 1 before the GUI exists
   (S-PERSIST's seed through the firmware's property set, 0 -> 1), the mask is 0x1f1 and the tap reaches HFW as PRESS at
   the pixel and CLICK, and on E120 and the E144 family a tap at 40, 333, left of the pad's area, reaches nothing.
   E120's first tap inside the pad ends as LIFTOFF at 0, 0, at any pixel and after a 5 s wait as well, and each later
   one as CLICK: its driver's area-on derivation (E120 `0x502da6bd`, the down `0x502da6eb`, the end `0x502da73e`)
   takes the first tap's down but finds no end for its point at the up (observers), where a later tap's up is an end
   with the press 2 us before; why the first is not seen is not read. No tap changes the frame or the GUI's state
   (the pad's AF target moves with a slide, I: "[GuiTouch] Evf_Touch_Pad_Slide" `0x50d012e2`; not tried). On E122 with
   the pad on a second tap within 800 ms is a DCLICK, and the GUI's double tap ran twice for its one post (id 867
   1 -> 0 -> 1): two passes of the GUI's touch action, each taking action 0x13 to its dispatch `0x50d01984` and 1 back
   from the handler, the other dispatch `0x50d0e84e` not running (observers); why two passes is not read. Checks with
   the TFT's: 16 on E118, 27 on E120 and E144, 26 on E122, 23 on E148, E139, E134, E137, E140, E125 and E130, all pass.
117. **E118's download and the controller's version** (2026-11-10, D unless tagged; answers finding 86's "?" in part).
   The download (op 7, `0x502e4bec`) clears the INT word, writes `30` and `10` to slave `0x48` and then 24496 bytes from
   the image itself (run-time `0x603f1f85`, beside the driver's "prm_calib_data", "read_calib_data" and
   "tp_drv_adjust_jd_a/b" traces). The version read (`0x502e4b94`) keeps b0 << 8 | b1 of `0x1c14` and logs "not
   available" outside 0x3000, 0x9e00, 0xc400 and 0xd700, and both of the list's checks take 0xc400 alone: before the
   download it skips the download (entry 1), after it it goes on to the calibration (entry 12), any other value taking
   the list past the calibration (entry 16). The program the download sends sets that value itself (D, the blob read as
   Thumb code, its addresses the program's with the blob's offset 9 at 0; unless tagged). The blob is a Cortex-M
   program by the vector table at its offset 9 (initial SP 0x10007da0, reset 0x00005ec1), after `48`, a length 0x5fa8
   and four more bytes. Its reset `0x5ec0` runs `0x33c8`, whose first call `0x2ee8` calls `0x38b4`, which gives the
   register file's banks their RAM (`0x45c0`: bank, base, size; bank 7 0xa4 bytes) and sets bank 7's bytes, among them
   `movs r2,#0xc4; strh r2,[r4,#0x14]` (`0x39d8`), c4 00 at offset 0x14, and 10 at offset 3. The slave's receive and
   send handlers (`0x4696`, `0x46ca`) take the first two bytes as the register address, the high first, and write or
   read the bytes after it through `0x45d8` and `0x45fe`, which take bank = address >> 10 and offset = address & 0x3ff
   (that they run on the controller's I2C interrupts is I): bank 7 is `0x1c00..0x1ca3`, so the program answers c4 00 at
   `0x1c14`, which E118's read keeps as 0xc400, and its `0x1c03` holds the 10 the list writes there. The host's writes
   leave `0x1c14` alone (op 9's ten registers `0x1c0b` .. `0x1c3f`, X: the lab's I2C log; `0x1c00`, `0x1c03` and
   `0x1400`, finding 85). So 0xc400 is the version of the controller firmware this build ships, the value both of the
   list's checks take, and S-TPREG's c4 00 is a controller that runs it; the blob holds no 0xc400 literal (its one
   `00 c4` pair lies in its code, X). What a controller without that program answers before any download is ?, which
   only a read of the register on a camera settles. The 117 bytes at `0x1400`
   (op 8 with 0, on the no-download path alone) are the record of id 36049 (`0x50055b7c`, a table indexed by id >> 4):
   in the lab the record is found (E118 `0x61b121fc`) and its 117 bytes are 0 (X); what fills it on a camera is not read
   (the panel's adjustment data, I).



## Per-body status

The state as of 2026-10-23, of E148 since 2026-11-01 (finding 65), and of the menus since 2026-11-02 (findings 66 to
68: MENU runs in a play session on every body of the E144 and E118 families, and modelcheck takes it). Each body's `MODELS` entry (`src/fw/models.mjs`)
carries the numbers its `port_via` choice rests on and the evidence of every hand value. On that date
`bin/modelcheck.mjs --no-port` passes E146, E147, E144,
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
effect (`ROADMAP.md` "Next stops"). Since 2026-10-31 the us clock runs on lab time from the reset (findings 63, 64):
the nine E144-family bodies reach the play bring-up at 0.26 to 0.75 s of lab time, where their open-time wait of 150
ms, counted in CPU reads, had made it 300 s on the TFT and 380 to 500 s on the EVF.

**E146 (OM-1 II), E147 (OM-3).** `bin/modelcheck.mjs` passes on the TFT and the EVF: start, S1, S2 (a picture on the
card), PLAY, INFO, PLAY. Their TFT start keeps the composite's UNWRITTEN error. E147 shoots and plays back. Since
2026-10-29 both run the lens natively by default, as E143 does (finding 25). Since 2026-11-08 REC_FILE's own task
records S2's file on both, with the firmware's Exif header (finding 83).

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
EVF shooting screen (finding 10, X). Since 2026-11-02 its menu shows its rows: its OSD planes are stacked the other
way round from E139's (finding 66). Open: IMG planes (live view, playback) are not modelled on the kind-2 VSC yet;
which register selects a kind-2 channel's timing bank is ?.

**E148 (OM-5 II).** Ported through E144 (the map pairs 9.5M instructions with E144's build against 2.47M with E143's;
finding 65) and boots natively to its shooting screen; `bin/modelcheck.mjs` passes on the TFT and the EVF with the count
probe and its card native, an 8 GiB SDHC card the firmware formats and counts 826 shots from (X). Its GUI is the ListMenu
generation: the tab and page memories are 1909 and 1910, E147's ids, read at the settings object's vtable slot 8 where
E143, E146 and E147 read slot 12 (`src/fw/facts.mjs` menuMemory; finding 65). Its menu runs in a play session since
2026-11-02, as the family's (findings 66 to 68). Open: nav's own GUI bring-up reads unplaced data (0x62b3e364), as
the family's stops at its checks (finding 68); 19 of E144's carried overrides fail
and 49 addresses stay unmapped (`port.json`; finding 65).

**E139 (E-M1 III).** Ported through E144 and boots natively to its shooting screen as E144 does; the TFT session stays
in `0x108` ID_ST_CA_REQ_DISP and takes S1 (UI_IN codes `0x2000100` down, `0x2010100` up), with the same events as E144's
(X). Its own `MODELS` values: one override (the joystick publish return, which E144, with no joystick, cannot carry) and
the state log's argument registers (one argument fewer than E143's, D; finding 43); E144's S-NOPOWEROFF went with
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
rule (`displaySends`). Open: when the camera releases the sync at the start (I: once its through image shows;
finding 100 reads the release on the E118 family, at the display's first image update, I; E137's code is not
checked); the
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
UI_IN. With UI_IN's forward read by shape (finding 29) the three run past it; finding 37 has where each stopped then.
Since findings 43 to 45 (2026-10-30) E118's TFT and EVF starts reach the shooting screen state `0x0108` with the clock
warning in the OSD records and stop at about 2.2 s in E122's movie-time division; E120's TFT start stays in POWER_ON
(finding 46, ?) and its EVF start stops on E122's EVF stop, the full TOUCHPANEL queue 156.
Since findings 41 and 42 (2026-10-30) E122's card is native and its TFT runs modelcheck's path but for the count
probe; with findings 38 to 46 together E122 passes modelcheck on the TFT and the EVF, the count probe an expected
failure, and is in its checked set, E118 stops in the movie time and E120 stays in POWER_ON on both panels (finding 47).
Since findings 48 and 49 (2026-10-30) E118's TFT and EVF frames show its clock warning up to that stop (its display sync
released by S-DISPSYNC, its planes drawn without level words), and E120's display sync is read in its record form; at
POWER_ON E120's GUI draws only transparent fills, so its frame is the background.
Since findings 53 to 55 (2026-10-30) E120's TFT and EVF starts reach `0x0108` with the clock warning in the OSD
records and stop where E118's do, in the movie time's division, and E120's and E122's opens take under 0.4 s of lab
time where they took 300 s and 500 s.
Since findings 50 and 51 (2026-10-30) E118's card is native (its card line's request to the sub-CPU answered by
S-SDSWITCH, its record time's division by S-MOVRATE, since finding 59 the DIVU by 0 alone) and E118 passes modelcheck on the TFT and the EVF; E120's card is
native too. Both bodies' PLAY and INFO draw the picture's `100-0001` since finding 52. With findings 48 to 55 together
E118 and E120 compose their shooting screens on both panels and pass modelcheck on the TFT and the EVF, the count
probes expected failures, and are in its checked set with E122 (finding 56).
Since finding 61 (2026-10-31) the three pass the count probe on both panels, their screens redrawn by INFO before each
window (PROBE_REDRAW): their application asks for the count only when the shooting screen is redrawn.
Since findings 84 to 89 (2026-11-10) touch runs on the three's TFT: a tap on the touch mode icon and in the super
control panel reaches the GUI (X, `test/test_touch.mjs`).

## The chained port

A body with `port_via` is ported twice: from E143 as every body is, and from its reference through a second map seeded
with the reference's effective override targets and knob addresses, not the lab's literals. Each of the reference's
effective overrides (its own and those it carried, so a chain of two carries E144's to E134) is carried through that
map to the body (`src/fw/place.mjs` `carryOverrides`): an address the leg places by code (or the snapped entry,
`code-entry`), calls, votes or an alignment is taken, a table slot or a section delta only where the direct map
agrees, and a null unless a fact (`kernel.cpus`, `scpu.backup`, ...) differs between the two builds, where the direct
map answers. The knobs the body lists in `carry` (`cflush_returns`, `block_save`) are carried and checked call by call
(`src/fw/knobs.mjs`). Nothing else carries: a reference's other `MODELS` fields are each body's to read by a rule
or give with its evidence, which `test/test_facts.mjs` checks (finding 43). Then a lab literal the direct map leaves
unplaced and nothing carried answers takes the
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

The new OM System PEN was expected as E148, which the updater now serves as the OM-5 Mark II (finding 65); the PEN is
still not on the update server. Lens and accessory firmware are out of scope.
Besides E143, E146 and E147, nine bodies pass the player with a picture (the shooting screen in their frame, S1 taken,
the player settled running): E144, E139, E134, E137, E142, E140, E125, E130 and, after MENU at its date and time
setting, E145 (finding 22). E133 passes modelcheck since 2026-10-29, E129 and E132 too (finding 24: E129 after MENU,
E132 after its clock is set at its date and time setting); E122 and E118 pass it too (findings 47, 51), E120 stays at
POWER_ON (finding 46). The next
steps are in `ROADMAP.md` "Multi-model".
