# OM-Emu roadmap

What OM-Emu does today, and what is open and next. The firmware is the OM-1 (E143) v1.9 unless a row says otherwise.
Every firmware fact here is owned by another document and cited by section ([docs/README.md](README.md) lists them);
evidence tags as in the specs: **X** executed or measured, **D** read from code or data, **I** inference, **?**
unknown. Sizes are rough estimates of focused work, not commitments.

The ground rule throughout: behaviour without firmware evidence is reported as an error or a fault, never guessed
(`docs/om1-vsc-spec.md` section 7, `docs/mn10300-isa-spec.md` section 8, `emu/ARCHITECTURE.md` "Design rules").

## Done

Every milestone runs in emu and is covered by the check its row names; the `check_*` checks are
`emu/checks/check_*.mjs`, run by `emu/bin/checks.mjs`.

| Milestone | What runs natively | Check | Owner |
|---|---|---|---|
| ND128 fragments | the ND128 candidate's parameter writer, exposure selector and frame-count code (the getter's return value injected) | `check_nd128` | `analysis/nd128/README.md` |
| M1 HLE rectangles | `gpiDrawOsdRectangle` from a RAM trampoline; the main block copied at its run-time base `0x60021020` | `check_osd` | vsc spec §7 |
| ISA + UDF | the full MN10300 base ISA (1,684,008 of 1,684,013 reachable instructions), the UDF multiply/HI and binary32 float unit | `check_isa`: 5,311 vectors, 125 firmware functions | ISA spec, UDF spec |
| M2 OSD | memory-manager constructors, `osddraw_init`, `gpiDraw*` down to the OSD engine model at `0x9BC00000`, the IRQ 310 handler | `check_osd` | vsc spec §7 |
| M3 VSC | display task init, DISPLAY OPEN, `GPISetPalette`, `gpiUpdateDisplay` programming the VSC model at `0x9BB80000`; TFT 900x600 and EVF 1600x1200 composites | `check_display` | vsc spec |
| M4 text | language load `0x51257bfb`, Genifa init, `DrawTextById` down to `osddraw_exec_font`, 18 languages | `check_text` | text spec |
| K-native | the firmware's uITRON kernel: CPU 0 init, the lab task, blocking waits, interrupt wake-ups, ticks, preemption | `check_kernel` | kernel spec |
| M5 Setup Menu | GUI task creation, WinMain, menu entry by `sendEvent(0x87)`, the viewer, panel 329, DrawText and gpiDraw*, palettes, all on K-native; Setup pages 1-5 in en / ja / zh-CN on the TFT | `check_menu` | menu spec §1-§12 |
| M6 navigation | event post to repaint (keys, dials, OPEN / CLOSE; the GUI's cursor, page, tab, sub-screen, popup and help logic), the settings store's init on the blank-store path, menu writes through API vt+4 `0x50b4f28b`, the dial-table init, the SCPU interface `0x98e00000` as a device model | `check_nav`, `check_menu` | menu spec §13, settings spec |
| M7 live view | the through permit `0x501c40d0`; the TH API `0x501c3f4d -> 0x501dac92` down to the VSC registers on TFT and EVF; DISPLAY cmd 5 and 32; the CMM register path; frames in the live-view banks through the firmware's bus window; the composite under the opt-in assumption A15 | `check_liveview` | vsc spec §10, §11 |
| M8 display gaps | the software-timer boot step in every lab (H-TIMER), EVF -> TFT; the palette re-request after a switch (H-RESEND); store-first switches; the Setup Menu in its EVF layout (S-TAKEOVER, H-CONNECT); OSD column rounding (A6), PLANC 0 = not drawn (A7) | `check_display`, `check_liveview`, `check_menu`, `check_nav` | vsc spec §7, §9; menu spec §14 |
| M9 interrupts, UDF unit, lab time | maskable interrupts end to end at the idle point: the CPU's acceptance and RTI, the interrupt controller model at `0x99200000`, the firmware's vector page, kernel entry / exit and level handlers; the UDF context unit; the 34-channel timer block on one lab clock shared with the VSC; in time mode the kernel tick and the 2 ms software tick natively | `check_irq`, `check_kernel`, `check_nav` | intc/timer spec, kernel spec §9, ISA spec §11 |
| M10 interactive play | the player (one command, a page on 127.0.0.1): keys through UI_IN (task 84) natively, dial detents, the multi-selector, the touch driver (task 83) and its gesture recogniser on lab time, the GUI's asynchronous DISPLAY requests, lab time paced to the wall clock | the play scenarios, `golden.json` | input spec |
| M10B EVF layout and Super Control Panel in play | live TFT <-> EVF switches from every play screen (LV, eye sensor), the Super Control Panel painted, navigated, changed and closed natively, the inter-CPU doorbell `+0x808` / `+0x80c` (A-IPI), CPU 2 stood in at one call site (S-CPU2) | the play scenarios | menu spec §14, §15 |
| PLAYFIX | the GUI's 8 s inactivity timeouts return to the shooting screen; EVF starts run the store init before the OPEN, so the EVF burn-in dim timer is never armed | the play scenarios | menu spec §15, vsc spec §9 |
| Hosts and the debug API | the player on node (an HTTP server with the lab in a worker thread) and in the browser (a module Worker), the JSON-lines debug API | `emu/bin/test.mjs`, `golden.json` | `emu/README.md` |
| The camera application | every play session runs the firmware's camera application (CA_MAIN) natively (S-CAMAPP, 2026-10-15): power-on to the shooting screen, S1, S2 and the rec view, REC, playback, the Super Control Panel and the menu; the lab's own stand-ins for it are gone | `test_camapp`, `golden.json` | shutter spec §7 |
| Exposure | a 12-40mm F2.8 PRO record on the mount (S-LENS) and the scene's brightness fed to the camera's own exposure plan (S-EXPOSE); the screen shows the planned shutter, aperture and ISO | `golden.json` | shutter spec §7 item 60 |
| Multi-model, steps 1-4 and part of 7 | 17 bodies besides E143 have ports; E146, E147, E144, E139, E134, E137, E140, E125 and E130 shoot, play back and run the EVF through `bin/modelcheck.mjs`, E142 (no EVF) on the TFT, each with the screen's remaining-shots count (the count probe); E145, E133, E129 and E132 stop in their start, the E118 family at import (Multi-model below) | `emu/bin/modelcheck.mjs`, `test_facts` | `docs/model-survey.md` |

Instruction counts: the ISA row's 1,684,013 reachable instructions come from a reachability scan that is no longer in
the repository. `node emu/bin/fwmap.mjs` finds 5,186,071 instructions in the main block, because it also follows code
pointers held in data (vtables, handler and command tables). The scan's method is not available, so the two counts are
not reconciled.

## Next, in recommended order

1. **Depth on the ported bodies** (Multi-model step 7): ten bodies pass `bin/modelcheck.mjs` since 2026-10-23, its
   count probe included, E139 and E134 with PER_SCPU native over the sub-CPU link as E143, E146 and E147 (SCPU track
   step 2); left are the movie time the E142 lineage and the E144 family show (an orange `0:00:00`) and E145's AF
   upload (Multi-model "Next stops").
2. **The open stops of the remaining bodies** (Multi-model "Next stops"): E145's start, E133's GUI creator, E129's
   settings store, E132's deferred serial send, then the E118 family's board port.
3. **HLE of E143, step 2** (HLE of E143 below; step 1's static decodes are done): the cheap CPU 0 wins (a ticking
   clock, persistence by default, native group-0 keys and power lever, Level Adjust, the HDMI EDID). The ticking clock
   is in, and PER_SCPU runs natively against a transport-level model of the sub-CPU (S-SCPUDEV, 2026-10-23, in place of
   the request server S-SCPU; SCPU track step 2), so are the SCPU port registers and IRQ 320 (group 0
   natively, 2026-10-23), the HDMI plug down to the EDID (`--hdmi on`, 2026-10-23) and the accelerometer at its sample
   cache (2026-10-23, hle-gaps.md 4.7.3: ACC_MAIN, PER_SLOPE, the level gauge following a tilt input and Level Adjust
   completing natively on E143 and E146); left of step 2: persistence by default (S-NVRAM opt-in) and the power-off
   sequence. The SCPU survey (2026-10-23, `docs/om1-scpu-spec.md`) put the transport-level model before any LLE of the
   sub-CPU; it is built (SCPU track below).
4. **Debug API follow-ups** (Debug API follow-ups below): the route to a running play session (F31), the attached
   watch log's lab time, halt and trace filters are in (2026-10-23); left are the gate gaps (items 1-3, 6, 7).
5. **Emulator architecture** phases 2-5: finish phase 2's typed seams (machine port, options object, composed lab
   features), then ground the CPU and interrupts in the manual, then the time model. Phases 3 and 4 are also step 3 of
   the HLE plan: every device seam below the camera application waits on them.
6. **HLE of E143, steps 4-8**: CPUs 2, 3 and 1; task starts with the HLS bring-up; storage; TAKE native with its
   neighbours; then the blocks by user-visible gain.
7. **The A53 and its A9 siblings** (`docs/a53-spec.md`, `tools/a53-oracle/`): in the QEMU oracle (a patched build with
   the `om-isc` device for the ISC windows and the irqcon banks) the A53's own Linux brings ISC up live: `isc_start`
   passes, the port-27 start completion arrives, and sccore (26 / 27) and hhhr (30 / 31) answer an MN-side peer. Next:
   decode the isc_socket (3 / 4) and isc_cgi (11..16) records and exercise them live, then build the JS ISC node-4
   service (4.11) against the oracle's replies; an in-JS AArch64 core stays optional. Answering CPU 1 natively waits
   on the multi-core and ISC transport work.
8. **Hardware validation**, as soon as an OM-1 is available for photos or HDMI captures.

## Multi-model

The model survey (`docs/model-survey.md`, 2026-10-19) ran every body the update API serves, 32 from E100 (E-PL5,
2012) to E147, through the unpacker, `bin/port.mjs` and a play session; `node emu/bin/fw-survey.mjs` reproduces its
first columns. All 32 decode with one container, scramble and AM33 reset head. Every body outside the OM-1 line (E143,
E146, E147) has E144's MMIO family (ISC `0x8fe00000`, VSC `0x9c000000`), so E144's board is the starting point for 29
bodies; the bodies whose image runs at a `0x60xxxxxx` base pair 0.76M-2.08M instructions with E143, the 14 others
0.25M-0.88M.

| Tier | Bodies | Where it stands |
|---|---|---|
| ported | E146 OM-1 II, E147 OM-3 | `bin/modelcheck.mjs` passes on the TFT and the EVF, the count probe included |
| ported | E144 OM-5, E139 E-M1 III | `bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23), the count probe included |
| A | E134 E-M1X | `bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23), the count probe included |
| B | E137 E-M5 III, E142 E-P7, E140 E-M10 IV, E125 E-M1 II, E145 TG-7 | E137, E140 and E125: `bin/modelcheck.mjs`'s path passes on the TFT and the EVF, E142 (no EVF) on the TFT; the count probe passes on all four; E145's start ends in its date and time setting (`0x1103`) |
| C | E133 E-PL9, E130 E-M10 III, E129 / E132 TG-5, E118 E-M5 II, E122 PEN-F, E120 E-M10 II | E130: `bin/modelcheck.mjs` passes on the TFT and the EVF (2026-10-23), the count probe too; E133, E129 and E132 stop in their start; the E118 family stops at import on its board |
| D | E100, E101, E106-E113, E115, E117, E121, E126 | not tried |
| - | the new OM System PEN (E148?) | not served yet (E148-E199 answer nothing, 2026-10-19): re-probe |

The status of each body, its first stop and the evidence are in `docs/model-survey.md` ("Per-body status").

Everything model-specific in the lab is E143 v1.9 data that a port translates: every code and data address in
`src/lab` (through `A()` and `src/fw/ports.mjs`), the specs' addresses, the VSC register names and the resource record
indices. Some of it is shape, not address, which no port translates (the UI_IN key matrix, the menu tables, the
resource form, the image base); each of these is now read from the model's own firmware (`src/fw/facts.mjs`,
`play.mjs` `uiin_layout`, `resources.mjs` `layout`), and a build without E143's ListMenu menus skips the menu tables.
A newer OM-1 release would move most of the addresses too, and the update API serves only the latest version
(`BLOBS.md`).

Choosing the body: `--model CODE|list` on `emu/play.sh`, `bin/play.mjs`, `bin/nav.mjs` and `bin/fetch-fw.mjs` (else
`OM_EMU_MODEL`, else E143), and the play page's model menu; a body the lab does not load on yet is refused with its
reason, and one whose session stops shows phase `error` (`emu/README.md` "Quick start").

How a port works: `bin/port.mjs` translates every E143 address the lab names through the cross-build map
(`src/fw/xmap.mjs`, placement in `src/fw/place.mjs`), runs the firmware rules of `src/fw/facts.mjs` on the model's
image and writes both into `src/fw/ports.mjs`; hand overrides in `src/fw/models.mjs` and `src/fw/overrides-E144.mjs`
carry their evidence. A body with `port_via` is ported a second time from a reference body through a leg map, which
carries the reference's overrides (`carryOverrides`) and fills what the direct map leaves unplaced (`fillUnplaced`). A
rule's answer wins over a carried one. `node emu/bin/port.mjs all` refreshes all 17 ported bodies in about a minute
with every map from the cache; the direct map's cache key holds the lab's 8-digit hex literals in their order of first
occurrence, so a change to `src/lab` that reorders them rebuilds every map.

The plan:

1. Let the lab build a session for any body at a `0x60xxxxxx` base, before any new firmware work: the run-time base,
   the resource block's origin and forms, the mode dial, the language table, the board families and the menu framework
   are read from each firmware by rules. **Done** (2026-10-19) for the eleven E144-family bodies; the E118 family is
   blocked on its board (step 5).
2. E139 (E-M1 III) to E144's level, ported from E144 as well as from E143, keeping E144's overrides through the leg
   map. **Done** (2026-10-19): start and S1 on the TFT.
3. E134 (E-M1X) and E137 (E-M5 III) to their shooting screen, and the per-body cost recorded. **Done** (2026-10-19): 12
   stops on E134 and 10 on E137, most of which became rules that serve every body (`docs/model-survey.md` finding 8).
4. E142 (E-P7) and E140 (E-M10 IV) at `0x60020020`, then E125 and E145. **Done** (2026-10-20) but for E145, whose
   start stays in POWER_ON.
5. Tier C. E130 (E-M10 III) is **done**; E133, E129 and E132 stop in their start; the E118 family needs a board port
   (its interrupt controller lacks E144's IPI, kick and control registers, so its devices must accept "no such
   register", not one more value).
6. Tier D: no work planned. Their ports place 60-80% of what tier A places; the survey keeps them as a record.
7. **Depth on the bodies that reach their shooting screen** (proposed 2026-10-21). Take E144, E139, E134, E137, E142,
   E140, E125 and E130 through modelcheck's path: S2 writes a card image, playback shows it, the menu opens; then the
   EVF. Done when `bin/modelcheck.mjs` passes on each. **Done** for E144, E139, E137 and E125 (2026-10-23, `MODELS`
   `checked`): their starts had been USB starts (the idle image's power lever and USB connection, survey finding 9;
   S-NOPOWEROFF retired), and their EVF starts met the kind-2 channel's timing bank, the change task created at run
   time and the EVF's scaled OSD planes (finding 10). **Done** for E134, E142, E140 and E130 too (2026-10-23, round 2):
   the EVF open's synchronous command to the touch task (finding 11), the shooting callbacks' ids per build (finding
   12), the OSD bitmap format 9 and the lens record's layout and buffer (finding 13) and E130's AF upload (finding 14).
   Round 3 (2026-10-23): the shots query is placed where each build's getAvailableShootCount asks (finding 15), so
   E142 and E140 show 999 shots, and modelcheck's count probe checks that the screen draws S-CARD's count (finding 16):
   E142, E140 and E130 passed it at once, the E143 and E144 families (E143 too) once S-CARD's card is in the first
   slot's detect state (finding 18). This comes before more bodies: a body counts as supported once it passes
   modelcheck.

Throughout: re-probe the update API (`fw-survey.mjs probe`) for the new PEN; a new `.BIN` goes into `BLOBS.sha256` and
the survey table.

### Next stops

- **The card on the other bodies:** on E143 the file system runs natively on a card since 2026-10-23 (hle-gaps.md
  4.8.2; its addresses are E143's hand facts, `src/fw/models.mjs` storage). A body gets it once rules find, in every
  image, the file system's bring-up, FILECLBK's entry, queue and busy word, its message codes, the SD command layer,
  the NAND access and its area, the album manager's init and the fileif codes; until then S-CARD keeps their card
  without a file system.
- **The card, next on E143:** Card Formatting from the menu and the card's removal and insertion while the camera
  runs are done (2026-10-24, hle-gaps.md 4.8.3: S-MDACTRL and S-MEDIA stand in for the HLS function component and
  media manager, the application's media control runs natively). Next: REC_FILE's own DCF steps (the DCF fnode its
  media writer uses, `0x5054aa70`, in the recording modules the capture pipeline drives), so the firmware's image count
  follows a picture in the same session and S-CARD's image list retires; the HLS media manager itself (camapp 2 does
  not create it) in place of S-CARD's and S-MEDIA's requests; the second slot (its switch `0x1518`, and S-CARD's start
  value of its mount state); the media control's other commands (erase all, copy, unlock); an SDXC card (exFAT); the SD
  host at its registers with its interrupts and card detect (seam A); playback of the card's files (a JPEG decoder at
  the codec seam); the movie module's set-up, whose frame rate the movie time query reads (it logs `0x39000903`).
- **The movie time of the E142 lineage and the E144 family:** E142, E140 and E130, and since survey finding 18 E144
  and E125 (the others not looked at), show an orange `0:00:00` where E143 showed S-CARD's `1:00:00` and shows the
  card's time since its file system runs natively (frames, X). E143's
  movie item asks getMovieCountdownTime, whose time-left wrapper reaches S-CARD's movie query (`0x503f3dd3`); E142's
  getMovieTimeInMedia runs in its sessions (E142 `0x5076da59`, X); its time comes from the movie time in media (E142
  `0x502ae8f3`, the place of E143's `0x503f1bcd`, module `0x5000e`), which asks the DCF remain movie time (`0x505fd798`)
  and returns 0 (X): S-CARD's card has no file system. Answering it is the seam; its unit is not read (forcing 3600
  shows `0:00:06` on E142's TFT, X).
- **The GUI state table's length:** the lab names the first 12 parents (E143's); the firmware's lookup bounds it at 12
  on E143 (`0x5124b478`) and 18 on E145 (`0x50de87bf`, D), so E142's and E145's SS_MENU (`0x11`) states print unnamed.
  A rule reading the bound would name them (survey finding 17).
- **E142's touch controller** (slave `0x48`) is not the one S-TPREG serves (E143's slave `0x70`, register 2), so touch
  input does not reach its GUI.
- **E145's AF upload:** its frame plane has no function of the AF upload's shape (survey finding 14); read what its AF
  module uploads the frame through (its mode-2 upload `0x5002272c` takes five halfwords, I).
- **The touch task's power-up wait:** before the play bring-up sets the lab microsecond clock, the touch panel's 40 ms
  interrupt wait (and E137's 150 ms one) takes one lab sleep of 2 ms per microsecond-counter read, 40,001 sleeps (X,
  survey finding 11); why the counter advances one per read then is not read.
- **The kind-2 VSC:** which register selects a channel's timing bank (the model follows the last vertical total
  written, I); IMG planes (live view, playback) are not modelled.
- **The E143 family's USB connection:** E143, E146 and E147 keep `0x0400` at state 0, which on the E144 family is a
  cable (survey finding 9); their starts publish no USB connection from it (X). On them it is the SCPU port scan's,
  reported through the group-4 producer: answering the port scan (`0x88`, which S-SCPUDEV refuses: its result bits
  are ?) would set it the firmware's way.
- **E137's display sync:** S-DISPSYNC stands in for the camera's release of the start's display sync (stopRecView's
  sync-word clear, then an image sync of the kind the pending state takes). What the camera waits for before the
  release is not known (I: once its through image shows). E143's GUI asks for the sync at a recording's start too
  (shutter spec item 44), so the recording frames of the camera-application tests should be looked at.
- **E145's start:** it ends in `0x1103`, its date and time setting, which the TG-7 opens at power-on with the clock
  unset where E143 warns (survey finding 17: the frame, X; SS_MENU's state, I); MENU cancels it to `0x108`. So the
  start waits for the user, not a device. To run its modelcheck path the session needs MENU after the start (or a set
  clock, which would also drop E143's start warning from golden); then place or gate S-AFOSD's AF upload. Why its TFT
  area is 1440 wide is not read (the setting's frame looks stretched twice horizontally, I).
- **E133's GUI creator** waits on a synchronous call's reply where E130's passes: compare the two at E133
  `0x50c7b065`.
- **E129's settings store:** its flash read waits for the boot's stage-1 bit, which the init task the lab ends would
  set. Read what the stage step does and whether the lab can run it, or set the bit as a named stand-in.
- **E132's camera application start:** its serial request defers its send to an interrupt the post raises through
  `0x9b800030`. Read that interrupt's source (IRQ 29 or another), and whether the E144-family bodies' starts reach the
  same post.
- **The E118 family** needs its board port before any of its code runs.
- **S-PANELDONE's gate:** on the E144 family's board it answers every display run's wait on the panel flag, also on
  E139, E134, E125 and E130, whose waits ran natively before with the same results (X). Read which of those waits find
  the flag already set, and answer at once only the waits that would otherwise block, as the TG-5's completion wait
  does.
- **E134's dial-init override** (`0x5014b7c7`): `dialStore` reads the select it holds, so the rule could place the init
  too where no map does (E134; E125's is carried from that override).

Naming: the tools dropped the model from their names (`bin/play.mjs`, `bin/nav.mjs`, `bin/debug.mjs`, `web/play.html`);
the specs of E143's firmware (`docs/om1-*-spec.md`), the machine's memory-region names (`om1.dram`, ... in
`src/machine.mjs`) keep `om1`; the environment knobs are `OM_*`. Model-specific data lives in per-model tables
(`src/fw/models.mjs`, `src/fw/ports.mjs`).

## HLE of E143

What a complete HLE of E143 still lacks below the camera application, block by block (firmware footprint, seam,
dependencies, code size, effort, first step), is in [hle-gaps.md](hle-gaps.md), with the basis of the order below in
its section 6; this section owns the order and the status. The lab executes 287,101 of the main block's 5,186,071
instructions (5.54%, about 6.1% of normal-use code; `node emu/bin/fwmap.mjs`, hle-gaps.md §2.2).

| Step | What | Status |
|---|---|---|
| 1 | static decodes: the TRA layer (who handles TRA 991, what answers TRA 990), TAKE_FUNC's dispatcher, the HLS TRA event dispatchers, the PER_SCPU dispatch, the sdmem contract, the lens serial layer, the ISC port formats | done (2026-10-23): the TRA layer, TAKE_FUNC's commands and the HLS event dispatch (hle-gaps.md 4.1.1-4.1.3); the PER_SCPU request server and command set (4.7.1); the sdmem request / completion contract (4.8.1); the lens serial layer, its IRQ 14 bits, the command history and the init chain's command ids (4.4.1); the ISC transport from both ends (4.11.1). Two parts stay ? and move to later first steps: the table from a lens command id to its packet bytes (4.4's probe) and the per-port ISC payloads (4.11) |
| 2 | cheap CPU 0 wins: the SCPU request server with a ticking clock and S-NVRAM by default; the SCPU port registers and IRQ 320; the accelerometer; HDMI EDID / HPD | started (2026-10-23): S-SCPU, the request server at the request API (`0x01`, `0x81`, `0x06`, `0x86`, hle-gaps.md 4.7.1) on E143, E146, E147, E139 and E134, with the SCPU window's clock ticking with lab time (on those bodies) and a blank sub-CPU memory per session; S-SCPU-MSG is retired. S-NVRAM stays opt-in (`OM_EMU_NVRAM`): as the player's default it would need a state file per model, put the host's clock into every session and make sessions start from the last one's settings, a choice for the user. The port and event words with IRQ 320 (2026-10-23, hle-gaps.md 4.7.2) on E143, E146 and E147: group 0 (power lever, Fn lever, S1) reaches UI_IN through IRQ 320, its handler and UI_IN's callback natively (H-SCPUIRQ, H-UIINPORT, H-SCPUPORT in place of S-KEYBITS for group 0); the power-off sequence after the lever's code needs the power manager, so H-POWER stays. The HDMI plug (2026-10-23, hle-gaps.md 4.9) with `--hdmi on` on E143, E146 and E147, off by default: the hot-plug pin's IRQ 109 (GIO pin 77, after H-GIOSLOTS frees the slots its registration needs), the HDMI init, two E-DDC reads with IRQ 239, the EDID's checks and parse of a lab sink (S-HDMISINK, 1080p60 with a CTA-861 block) and the connect report to UI_IN, all natively and with interrupts at the idle point (HDMI turned out to need no step 3); the camera application then leaves the date prompt but opens no HDMI output, an unplug is refused (A-HDMI-1). The accelerometer (2026-10-23, hle-gaps.md 4.7.3) on E143 and E146 at the sample cache: the ACC module init (device part stepped over), ACC_MAIN with its probe through a register file and PER_SLOPE run natively (H-ACCINIT, S-ACCREG, S-ACCSAMPLE, H-SLOPEINIT); the gauge follows the play input tilt, and Level Adjust's Adjust completes and writes the user table, which the correction ignores on the lab's blank factory data. Open: PER_ROTATE (orientation), the sampler and data-ready pin at the PER_SIO seam, E147's different ACC code |
| 3 | interrupt acceptance anywhere, then the machine-owned time model | not started: architecture phases 3 and 4 |
| 4 | CPU 2, then CPU 3, then CPU 1, natively | not started |
| 5 | task-start and module-init infrastructure; the HLS component bring-up as the coverage workload's default | not started |
| 6 | storage at the sdmem seam | started (2026-10-23, hle-gaps.md 4.8.2) on E143, one layer lower, at the SD command layer: an 8 GiB SDHC card (S-SDCARD) the firmware formats (FAT32) and mounts itself, with the file system's bring-up, FILECLBK, FILEFGND, DCFPROC_SUB, sd_mount, sdmem, dosfat and the DCF modules native; the remaining shots and the movie time counted by the firmware from the card; the picture's file written at S2 through the file module (S-RECFILE, in place of REC_FILE) and found by the firmware's DCF scan at the next mount; Card Formatting from the menu and the card's removal and insertion at run time (2026-10-24, 4.8.3). Open: REC_FILE natively, the second slot, exFAT, the other bodies |
| 7 | TAKE native with the lens, BC, the sensor control plane and the shutter (the strobe beside it) | not started |
| 8 | by gain: still capture, live-view statistics and EXP, AF, movie and audio, playback, USB, the power manager, wireless after CPU 1, GPU / C3D, the rest | not started |

## Debug API follow-ups

1. **No recorded vector for halfword device accesses.** The MMIO hook's 2-byte path and sub-word store values are
   pinned by a unit test only; a session or vector with a `movhu` to a device register would close it.
2. **MMIO-trace rules no session reaches:** code fetched from the lab stub (traced byte by byte) and CPU accesses
   through the bus window's off-DRAM pages (no trace line), correct by construction only.
3. **Edge cases no gate covers:** a code-fetch fault in an instruction's operand bytes writes no exec-trace line,
   because `step()` fetches every byte before the exec hook; a watch hit inside interrupt entry stops the continue
   before the handler's first instruction; the snapshot gate's cross-check detours are short (22 to 687 instructions).
4. **Feature requests:** done (2026-10-23). F31, the live route (`src/debug/live.mjs`, `emu/README.md` "The debug
   API"): debug inputs `{type: 'debug', op, ...}` on the play session's own input queue, through `POST /api/debug` or
   `bin/debug.mjs --attach URL` (JSON lines), `--debug-api` only, handled between ticks through
   `Debugger.attach(lab.sim, {lab})`: the protocol's reads and writes, `tasks`, `standins`, `halt` at a tick boundary,
   breakpoints and stopping watchpoints that hold the session inside its tick (the Simulator's debug hook), `step`,
   `cont`, `resume`, `detach`; nothing runs before the first debug input (golden identical). The attached watch log's
   entries carry `lab_ns` and `n`; `halt` ends a paused standalone continue; traces take a `filter` (exec pcs, an MMIO
   range and direction, an interrupt kind or IRQ list). Left: the browser player's Worker cannot hold a debug stop (its
   queue does not block, so break and stopping watchpoints are refused there, and it offers no trace files or
   disassembler); a step at a debug stop accepts no interrupt; `--attach` sends one request at a time, so a `cont`
   without `maxMs` holds the client until the next stop.
5. **Protocol rough edges:** fixed (2026-10-23). `cont {stops: "0x502d0341"}`, `setReg d0 0x1ffffffff` and `step {n:
   0}` / `{n: -1}` answer BadRequest, and so do their siblings: every list field (`pcs`, `list`, `filter.exec.pcs`,
   `irqs`) that is not a list, `regs` or a watch entry that is not an object, every address outside 32 bits (they were
   wrapped by `>>> 0`), every register or stored value outside 32 bits (`setRegs`, `reset`, `cpuStore`, also in the
   library as a ValueError and on `bin/debug.mjs`'s command line as a usage error), and negative counts (`size`,
   `words`, `since`, `limit`, `advance`), a zero `disasm` `n`, watch `len` or `budget`.
6. **`web/index.html`'s EVF layout class** is not checked by any gate.
7. The browser player was measured in Chrome on one machine; other browsers and platforms are untested.

## Emulator architecture

The findings are listed with their status in `emu/ARCHITECTURE.md` "Open findings". Each phase ends with every gate
green; a phase that changes behaviour on purpose records every changed baseline with its reason and evidence level
(`emu/README.md` "Tests", the change rule).

**Phase 2: typed seams in place of the scaffolding (M).** The baselines can verify these refactors.
- F02: a typed machine port replaces the gdbstub text in `Simulator`; Stats and the harness digest become optional
  observers.
- F07 is done: plain JS values, plain JSON on the HTTP API and in the session logs, node's own errors.
- F08: the checks' `pred()` seam becomes structured `eq(got, want)` results, with the RNG tape.
- F18: mutants move out of product code into test-only injection (or go with the checks that used them).
- F13: one explicit options object per lab, which also finishes F19 (the machine options are already their own
  `env.machine`, `OM_MACHINE` parsed at first use, but still ride in the env bag).
- F17, F12: the eight-class lab chain becomes composed features that register hooks through an owner-aware registry.
- F22, F04, F40: each device module owns its window ABI and exposes command methods; the harness-side copy of that ABI
  and the Linux-only facilities of the checks and gates go.

**Phase 3: ground the CPU and interrupts in the manual (M-L).** The first deliberate behaviour changes, each a
baseline update with a recorded reason.
- Interrupt acceptance (F03, FIDELITY 2.1-2.3): accept at any instruction boundary where PSW IE and the level mask allow
  it, as the MN103 manual describes. The TB-layout look model, its refusals, `tbPosition`, the IO and code-store rings
  and `LOOKED_PC` go, which also makes the interpreter simpler and faster. A-ACCEPT, A-ENTRY and A-RTI-WINDOW ("Open
  unknowns" below) are settled from the manual where it speaks and kept as named assumptions where it does not.
- Strictness faults (C01, FIDELITY 3.1-3.2): every place where the CPU faults on something the ISA defines or leaves
  unspecified (undefined flags, reserved PSW bits, DIV results, UDF special values) becomes a named assumption with a
  manual-backed default. A strict mode keeps today's stops for reverse-engineering runs; the player and the gates run
  the hardware-like default and count assumption hits in status. Exception vectoring follows once the firmware's
  exception entry is reverse-engineered.
- The memory-model artefacts of FIDELITY 3.6: replaced by the documented behaviour, or by an explicit assumption where
  nothing is documented.

**Phase 4: time and the HLE boundary (L, months).**
- A machine-owned time model (F06, F26): instructions advance time at a documented or measured rate, devices schedule
  their own events, and lab time no longer moves only through VSC doorbells.
- Native delivery (F27): interrupts reach the firmware through its own vector only; the HLE delivery path and the
  OlyTaSS and vsync stand-ins go.
- DISPLAY as a kernel task (C04), then the other stand-ins one by one, each removal moving work from the harness to the
  firmware. This is the road to the full-boot LLE below.

**Phase 5: hardware evidence (S to start; needs a camera).**
- A hardware report (C03): capture fixed screens from an OM-1 on v1.9 (HDMI or photos, defaults reset) and compare
  them with the lab's composed frames by region. The first targets are the "Hardware validation" list below.
- Evidence tags (D / X / I / ?) become structured data on every stand-in and assumption, reported in session status.
- Timing measured on a camera (key-to-redraw latency, frame cadence) feeds phase 4's time model.

**Later, when a concrete need appears:** a GDB RSP endpoint if someone needs gdb (C05); checkpoints if start-up
dominates (F24); decode-cache work if interpretation dominates (F28); the host duplication (F14, F30, F39) when the
publication protocol next changes.

## Open follow-ups by milestone

Each item is what is left of a done milestone, with its blocker. The owner document has the evidence.

**Menu (M5, M6).** Unverified cells: the value cells and per-row children of the rows with handlers `0x511bf596`
(Monitor Adjust, EVF Adjust) and `0x511bf765` (Bluetooth); class 0x8013 is not decoded. Reference inputs not read from
code: the paint pass's FILL colours 127 / 255 / 31 (observed), the row state s (level 0 of `0x511bdb2c` not decoded;
two Setup rows have s != 0 under the defaults, observed), the cursor-memory rule for values outside 1..rows. S-SEND
drops the menu entry's synchronous send to queue 10 cmd 10 (`0x50045462`), whose receiver does not run; S-PROP answers
the GUI's reads of the output device. DrawText's step-7 alignment is checked against the firmware only for right
alignment. The navigation rules are observed (X), not decoded: the 0x9031 / 0x9032 handlers, the tab actuator
`0x511bde6b`, the page and tab edges. The camera path above sendEvent (the reader of queue 6, long-press and repeat
timing), the physical rotation of the dials (the board byte `0x97f00254` selects between two dial tables; which board
the OM-1 is, is not known), sub-screens that list media and the Card Formatting actions, My Menu's page count and
internal page, the 18 key-selected settings (settings spec section 2), the SCPU's replies beyond the five commands S-SCPUDEV answers, the flash
controller `0x98d01800` (settings do not persist without S-NVRAM), the settings module init chain `0x503dae30` (not
run), mode-dependent defaults (`0x605e9198`), and the store-init order (menu spec §12-§13, settings spec §4).

**Live view (M7).** CTRL3 bit 6 (A15): the live-view setup ORs it in (`0x501e04b7`) and the only read found is a debug
register dump, so every TH composite rests on the opt-in assumption that it does not change the picture; needs a photo
or code that acts on the bit. The CMM image (knot interpolation, colour domain, the matrix stage, its place relative to
the mixer; vsc spec §11.4) and YPYC are outside the model. A6 for exact upscale and the vertical escape case;
FIELD_MODE and what CTRL2 = 1, CTRL3 = 8, VLFRM, AREA3 and SYNC1 bit 28 mean. Branches not reached: HDMI and channel 0,
egpk, the callback `0x50035afd`. The camera's real request (the mvr builders `0x50453c2e` / `0x50453d88`) and who sets
the live-view geometry around a cmd 5 attach; DISPLAY cmd 32 reads the frame-rate index from an empty camera-state
store in the lab (vsc spec §10).

**Display gaps (M8).**

| Item | Where it stands | Blocker | Owner |
|---|---|---|---|
| PLANC `0xca` after TFT -> EVF | cause settled: the lab's empty store reads property 587 as 0; on the firmware's store PLANC stays `0x100` | what `0xca` does to the pixels needs A7 (hardware) | vsc spec §9.3 |
| Palette re-upload after a switch | the request `0x503e52c7` runs natively (H-RESEND) | the caller of openDevice `0x50d83338` (the eye sensor), `0x50ab4756`, `0x503e4bf5` | vsc spec §9.2 |
| Display update after a switch | H-UPDATE calls the GUI's re-display wrapper `0x510bd84b`; the OSD right-edge pad `0x501db6d5` copies column 799 into column 800 when its width word is 800 (X) | the camera's GUI message after a switch and the code that updates the display | menu spec §13-§14 |
| Palette indices >= 128 (U16) | no v1.9 path uploads them | what bit 7 shows: a photo | text spec U16 |
| Plane order, blend, PLANC scale | order fixed in v1.9 (cmd 6 rejects GPISetOsdOrder); PLANC = 128 - trans, 0 = not drawn (A7) | which plane is on top, the blend curve: hardware | vsc spec §7 A5, A7 |
| HDMI channel 0 | the OPEN waits for `0x62a3c8ec` = `0xF0` 50 times and gives up; with `--hdmi on` a plug sets it natively (hle-gaps.md 4.9), but the camera application then sends no OPEN | the application's output switch, the open's PLL / PHY, infoframes and SCDC, VSC channel 0 | vsc spec §10.10, hle-gaps.md 4.9 |
| IMG FMT != 0, YPYC; OSDFMT1/2 variants, RSZ3/5/6; A12 | never produced by v1.9 or no independent path in the lab | hardware | vsc spec §3, §7 |
| OSD sampling (A6), burst count (A18) | columns rounded half up from the edge pad, rows floor; A18 holds except widths that are a multiple of 128 (DMABN_SHORT) | hardware | vsc spec §7 A6, A18 |
| EVF layout (B2) | done with S-TAKEOVER and H-CONNECT; everything from ConnectChangePlay down is native; the composite rests on A15 | whether the branch `0x510c4239..0x510c4282` runs on the camera; the normal-boot route to connect state 5; a photo of the EVF menu | menu spec §14 |

**Interrupts, timers, lab time (M9).**
- Acceptance anywhere as the default: the CPU side works anywhere; the labs accept only at the idle point (H-IRQGATE).
  Accepting anywhere moved 21 of 30 acceptances on a 9-token navigation session and left every frame, GUI state,
  engine command count and setting write identical (X). Phase 3 above takes it up.
- Native delivery inside display steps, and DISPLAY / DISPLAY_CHANGE as real tasks: display steps are harness calls
  with PSW 0 whose clock moves deliver every pending source directly; running them as tasks needs OlyTaSS on the lab
  clock and native vsync flags (phase 4).
- Time mode as the default: opt-in; inside display steps the stand-ins move the clock without servicing the timers,
  so periodic channels count overruns there and those ticks are lost (also why the Genifa clock runs about 0.945 ms per
  lab ms on the Super Control Panel, X; menu spec §15).
- Timers not yet traced as they first fire: Genifa timers 537 and 554 and task 16's bit-2 path `0x50053199` /
  `0x500532b2` (kernel spec §9.5).
- A-VEC, A-IAGR, A-TMR-1..5, A-INTC-ORDER; the meaning of udf12/13/21 (A-UNIT); TRAP, NMI, level 0; K-IPI and
  K-BOOTSYNC with CPUs 1..3 (intc/timer spec §5, udf spec).
- The I2C map init `0x5005f0b2` is not run, so the panel I2C channel byte comes from low RAM 0.
- Store init in boot order as the default: an option since M8, the default for EVF starts since PLAYFIX; making it the
  default for TFT starts needs A15's bracket recorder first.

**Inputs and display switching (M10, M10B).** The camera application runs natively since 2026-10-15, which retired the
lab's stand-ins for its key mapping, request sequences and display-switch re-entry; what stays open below it:
- Raw-bit producers (S-KEYBITS pushes whole group images): the SCPU receive path and the poller; the producers of
  EVFSW, the eye sensor `0x2301`, the multi-selector `0x1234` / `0x1235`, the lock lever `0x0202123d/e`. Group 0 (power
  lever, Fn lever, S1) comes from the SCPU's port registers through IRQ 320 natively on E143, E146 and E147 since
  2026-10-23 (hle-gaps.md §4.7.2); the E144 family's bodies still push it.
- UI_IN's module init: only the ring init `0x5014cb5f` runs (H-UIINRING); `0x5014e3ab`, `0x5014ce00`, `0x5005d36a`,
  `0x5014d62e`, `0x5014d97a` do not; the board byte that selects the bit-table variant.
- Switch idle state: HDMI `0x0501` and `0x0400` both at 1 make the menu close paint the black panel 6 (X); what
  `0x0400` is.
- The encoder: H-DIALSTEP calls the counter writer `0x5014bae6` per detent; the encoder position read `0x50059fa4` and
  which dial is main and which rotation is "+" are open.
- Touch: S-TOUCHMAP maps HFW statuses to GUI touch kinds by name and S-CAFWD drops the GUI's forward to the camera
  (STS_TOUCH_EV_RESPONCE, the HFW client; LONGPRESS never comes); S-TPINT sets the touch flag from the lab task (a GPIO
  interrupt model, IRQ 132, `0x500525ee`, would replace it); H-TOUCHGAP's 20 ms between samples keeps the driver's
  5-slot gesture queue, which has no bound check, from faulting (X); the controller's real report rate is unknown.
- Fn-type buttons (wired 2026-10-15): a dial turn, alone or with +/- held, leaves the shown compensation at 0.0; AFL,
  one-touch WB, PREVIEW and CHANGE_LV_STATE change nothing on screen (their camera-side work is not modelled); AEL/AFL
  `0x120b` exists only in UI_IN variant 1, BKT has no key in the matrix.
- The display-switch trigger chain from the eye sensor / EVFSW to the sender `0x5105053c`, the eye driver's path to the
  setter `0x50050efd` and its publish gate `(0xa31f1d26)` = 119 (H-EYESTATE stands in).
- The Super Control Panel's Live Control, live-guide and ART / SCN variants (settings 109 and 44 have no descriptor
  list), each cell's value -> image / string mapping, the group descriptors (type 6) the settings reference does not
  decode.
- CPU 2: S-CPU2 serves the one allow-listed post (AUD_LEVEL_MONITOR's level data read 0); its swap path `0x50aaad0e` is
  refused. The GUI's histogram send to OSD_DRAW_CPU2 (queue `0x2013`) at idle, S1 and S2 is not refused: S-MODACK's
  blanket rule answers it E_OK (shutter spec item 42).
- Level Adjust -> Adjust changes the store but not the gauge: the correction's gate needs factory calibration data
  (store F), which the lab does not have (hle-gaps.md 4.7.3).
- The touch interrupt, the I2C reads (touch I2C reads return 0, otherwise a divide by zero at `0x5005f00d`) and the
  mode-dependent values, the start-screen logo and live view under the shooting screen are not modelled (input spec
  §9).

**The player's hosts (M10).**
- The host memory probe covers the main isolate only: `host/memprobe.mjs` (`OM_HOST_MEM`) samples node's main isolate
  after a forced GC, which holds the HTTP front and the proxy. The harness (PlaySession, the Player and the lab's lists)
  runs in the lab worker, whose heap grew 16-20 MB in a 60 s window (X) and is bounded by nothing, and external memory
  (Buffers, ArrayBuffers) is logged, not bounded. The worker's live heap after a full GC, sampled from the loop's tick,
  would close it.
- The play client's start-up wait accepts a power cycle's `off`: `checks/lib/playhttp.mjs` waits for a phase other
  than `starting` or `replaying`, so during a replay across a power cycle it can return at the `off` published between
  the power lever's key and the power-on control (X: one replay in two on node). A fix waits for the replay's end.
- Ungated timing paths: the Player's 20 ms queue wait and the `BEHIND_NS` re-anchor (`src/lab/player.mjs`) have no
  gate; there is no `--idle wall` cadence gate, and `pace-wall` never lags 250 ms. HTTP and Worker message latencies
  are not checked at all: the pacing logic is checked under a frozen clock (`pace-wall`), and the checks mask the
  remaining wall-clock figures.

**Exposure.** The plan runs at the application's start and after each input on the shooting screen, not continuously
(the camera's LV AE task with its 18 x 18 grids does not run; the live-view statistics seam, hle-gaps.md §4.2, would run
it); one lens record, the 12-40 at the zoom step nearest the scene's focal length (the lens table `0x506ea4f3` names the
others, their characteristics are not in the firmware); why the application does not apply a dial turn to the exposure
compensation (input spec §9).

## Open unknowns and assumptions

Each listed once; the owner document has the evidence.

| Subsystem | Open items | Owner |
|---|---|---|
| CPU core and ISA | core variant unconfirmed (AM32-only `FE 80-82`, LIR byte order); DIV by zero or overflow results; reserved PSW bits; flags left undefined by a producer; the PSW write delay, whose scan cannot see indirect callers built at run time; misaligned values written to SP; TRAP, `F0 C0`, `F0 FF`, `break`, the `F7` page; interrupt acceptance: A-ACCEPT, A-ENTRY, A-RTI-WINDOW, A-VEC, A-IAGR, NMI and level 0 | ISA spec §2.4, §8, §11 |
| UDF unit | `udf07`; `udf12` / `13` / `20` / `21` implemented as a round trip of unit state (A-UNIT), their meaning ?; whether `udf00` imm, `udf01`, `udfu01` write HI (A-HI: unobservable); the unit's flag behaviour | udf spec §1, §2, §2a |
| Interrupt controller | A-IPI: `+0x808` ORs and reads the inter-CPU pending bits, `+0x80c` clears (OR versus overwrite unobservable); CPUs 1..3 not modelled | intc/timer spec §2, §5 |
| Memory map | 256 KiB of low RAM is a lab assumption; the OE header at `0x60021000` is zero in the lab; the bus space and the `0xb8000000` window are modelled as A16 / A17 (the physical backing of the live-view bank ranges ?, `0x9810004c` unmodelled); the camera's use of the lab region `0x62021000..0x62321000`; bank `0x5f` read as a bus address (I); which core runs the GUI (core id at `0x8050`, string `OSDDRAW_CPU2`); ROM past the image is zero-filled | cores spec §2, §3.4, §6; FIDELITY 4.1-4.3; vsc spec §9 |
| Panel-side stand-ins | lab-stub reads of never-written addresses return 0 (`STUB_UNWRITTEN`: 25 TFT and 16 EVF entries in `check_display_notes.txt`), including `0x99800004`, which drives the OSD2 / OSD3 HDLY; the five stub presets are only the firmware poll loops' exit values | vsc spec A13, §9; FIDELITY 4.2, 7.4 |
| RTOS and text stand-ins | kernel-less labs only on request (`--kernel none`); K-native accepts interrupts only at the idle point (H-IRQGATE); kcb+56's meaning; task 16's caller (H-DEFER); `get_tid` returns the DISPLAY task in display runs; synchronous message delivery; OlyTaSS's unit is ms (A10); S-RES copies resources with no resource task or flash; H-SWITCH replaces the untraced camera sequence after a language change (U7) | kernel spec §8, §9; text spec §3, §7, U7, U11; FIDELITY 7.3 |
| Inputs | the raw-bit producers; the UI_IN board variant; what group-4 `0x0400` is; LONGPRESS; the CA chain to the display-switch sender `0x5105053c`; A-USLAB (one count = 1 us of lab time) | input spec; intc/timer spec §5 |
| Menu | the row state s and the cursor-memory path; the paint pass's FILL colours; the dropped queue-10 send (S-SEND); classes 0x0105 and 0x8013; handlers `0x511bf596`, `0x511bf765`, `0x511bf8d2`; the camera's MENU event; dial direction; the observed navigation rules; B2's two inputs (S-TAKEOVER, H-CONNECT) and the normal-boot route behind them; the "Setup Menu" title list `0x6153a7ac` and its user | menu spec §10, §12, §13, §14 |
| Settings store and SCPU | SCPU command semantics, reg-0 bits other than the signature, the TX / RX block, the SCPU task's replies, the clock tick (A-SCPU-1/2); flash contents and controller; the module init chain `0x503dae30`; mode-dependent defaults; the store-init order; which menu rows write the display kinds `0xe831` / `0x4671` / `0xd7f9` / `0x8279` | settings spec §3-§7 |
| OSD engine | LUT index-0 transparency (U1; the lab can run either hypothesis, menu pages differ by 0-20 pixels); status bit 1; COPY order on overlap; opcodes `0x41` / `0x60` (not executed, FIDELITY 5.3); bitmap formats `0x01`, `0x05..0x07` and header bits 2/3; clipping; scaling; hardware trigger `0x30`; buffer kind -> palette choice; LUT slots past 128; the bitmap header width (the firmware reads 10 bits, but 13 resources wider than 1024 match only a 12-bit read); the engine finishes inside the CPU store that starts it (FIDELITY 1.3) | vsc spec §7; text spec U1; FIDELITY 1.3, 5.3 |
| VSC | A1-A19 (A15 opt-in: CTRL3 bit 6, adopted by play under the bracket guard; A18 the SPOS start); the meaning of `+0xD00..+0xD1C` (face path); the CMM image; register reset values; INTST1 bit 1's source; OSDFMT1/2 values and the field-to-plane map; BC registers; the physical meaning of the output selectors; channel 2 tables at `+0x5C00`; channel 0's IMGDMASPOS reset value | vsc spec §1-§5, §7, §10, §11 |
| Display flow | the M8 follow-ups above; eye sensor -> cmd 2 (openDevice's caller); the camera's live-view requests (the mvr builders); timers fire only in time mode (H-TIMER otherwise), and inside display steps their ticks are lost as overruns | vsc spec §9, §10.10; intc/timer spec §4 |
| Text and resources | U4-U6, U9, U10, U13, U14, U16, U17 for widgets other than the menu's; U2 / U8 answered for the Setup tab only; whether the camera can hit the DrawText skip-count issue behind H-STACK | text spec §9, §10 |
| ND128 | the composition limit downstream of the frame count; 128-frame safety; preview and EXIF; updater acceptance; other readers of the ND parameter still see 6 | `analysis/nd128/README.md` "Verification and its limits" |

## SCPU track: from S-SCPUDEV to the sub-CPU's own firmware

Survey done 2026-10-23 (`docs/om1-scpu-spec.md`): `blk0e560000` is a Cortex-M4F image for an STM32L4-class part,
loaded at `0x08000000` (E143 and E146 byte-identical, E147 its own build; E139 and E134 carry other SCPU lineages).
The MN link is SPI2 slave plus three pins, and the command table of hle-gaps.md 4.7.1 maps onto a two-level dispatch
table. The sub-CPU handles batteries, charging, USB PD, the RTC and backup words. Keys and the accelerometer are not
on it, so an LLE would retire S-SCPUDEV and run the inbound path natively, but would not touch the input or
accelerometer stand-ins. Step 2 is built (2026-10-23, hle-gaps.md 4.7.1, scpu spec 8): PER_SCPU, its start, its state
machine and its transactions run natively over S-SIO2 and the pins 102 / 103 / 107 against S-SCPUDEV on E143, E146
and E147, and on E139 and E134 (their own pins and channel; their sub-CPUs answered as E143's, I).

| Step | Content | Size (I) |
|---|---|---|
| 1 | settle the open link items statically: the PC2 / PC3 roles, the inbound message layouts, the `0x85` message-to-state map, the `0x88` reply | partly done (2026-10-23): PC3 is pin 102 and PC2 the message line, `0x85`'s reply, the date's and backup registers' semantics, the `0x88` reply's shape (scpu spec 3); left: the inbound message layouts, `0x85`'s message-to-state map, the port scan's result bits |
| 2 | S-SCPUDEV: a transport-level SCPU device at PER_SIO channel 2 and pins 102 / 103 / 107 speaking the frame protocol with handlers from the D table; PER_SCPU's start, gate, watchdog and poll path native; S-SCPU retired and the store-init session compared | done (2026-10-23): the same three requests, now as frames, the waits E_OK; S-SCPU removed rather than kept behind a flag; the watchdog's and poll's paths are native but not reached (the model always answers and posts no message) |
| 3 | a Thumb-2 instruction census of the image (`tools/`) | 1-2 days |
| 4 | a pure-JS Cortex-M4 core (`emu/src/core/`), checked against a QEMU M4 board in the VM | 2-3 weeks |
| 5 | the STM32L4 system block and the must-behave peripherals (RCC, FLASH, PWR, GPIO, EXTI, SPI2 + DMA, LPUART1, RTC); X target: the console prompt "SUB> " and the 13 tasks | 1-2 weeks |
| 6 | the SCPU core behind step 2's seam: `0x85 {2}` answered by the real firmware, `comm trace on` frames equal to S-SCPUDEV's | 1 week |
| 7 | battery, charger and PD device models only where the firmware's own errors demand them | open |

Recommended: steps 1-2 as part of HLE step 2's power-off work; steps 3-7 only when an SCPU behaviour the MN side
shows cannot be written from the D table. Risks: the I2C devices' identities and the battery protocol are unknown, and
silence from them may change what the power manager reports to the MN.

## Longer term: full-boot LLE

Booting the image from reset needs the real processor variant, the boot entry, the full memory map and the peripheral
protocols. What the repository shows about the cores: a core id read from `0x8050` (879 `mov` and 11 `movhu` sites,
never written), ISC hardware semaphores at `0x97000000`, CPU 0 alone running the reset head and CPUs 1..3 with their
own boot paths (`docs/om1-cores-spec.md` §2, §3, §6.1). What runs before the main block (a boot stage, which block
loads first) is unknown.

Approach: start at the main block's reset path, let each unmapped MMIO access fault (fault 2), and add a stub or model
for that device only with code evidence, as for the panel-side stub (`docs/om1-vsc-spec.md` §9). Two constant clusters
that look like device regions are not roles to model: `0x9a000000`'s constants are AVFW return codes, and
`0x9c700000` is touched only by LLF bus-arbiter and DRAM bus-measurement debug code (hle-gaps.md §9 items 5, 6). The
interrupts, the timer block and the lab clock exist (M9); a full boot also needs acceptance anywhere, the display tasks
as real tasks and time mode by default (the M9 follow-ups, architecture phase 4).

Verification: the firmware's own boot prints as progress markers; reaching GUI init without harness calls; display
output identical to the harness-driven M2-M6 runs. Size: months.

## Firmware-patch track

| Candidate | Status | Next step | Owner |
|---|---|---|---|
| Live ND -> ND128 | offline candidate (the ND64 slot remapped to step 7), all checksums pass, fragments verified in the emulator (`check_nd128`); not tested on a camera | trace the consumer of the ND info behind body offset `0x553f48` for composition limits, preview and EXIF; the lab can run that consumer once its inputs are known | `analysis/nd128/README.md`; `analysis/feature-gap/README.md` "Next reverse-engineering steps" 1 |
| Configurable burst fps | scoped as about one struct and two functions | map the drive-handler delta, E146 `0x503b95a6` vs E143 `0x503b8e73` | `analysis/feature-gap/README.md` step 2 |
| GPS location state | a thin accessor on existing state, low value | trace `getGpsLocationState` from the menu / SDK side | `analysis/feature-gap/README.md` step 3 |
| Lens-gated features (focus stacking, 50 fps SH2) | each gate mapped; a one-site patch un-greys the menu for every lens; untested on a non-listed lens | the open questions of the note (which lenses set the capability bits) | `analysis/lens-gates/README.md` |

Before any flashing: the offline unpack -> patch -> repack -> checksum loop is done (all six blocks round-trip byte for
byte; `docs/firmware-container.md`); what remains is whether the camera accepts a no-op image. Nothing has been written
to a camera. Flashing risks bricking it.

The menu work helps here directly. For ND128 the menu still shows ND64, so the useful lab check is that selecting that
entry reaches the patched parameter write at body `0x2d165d` and stores 7. That needs the settings store (M6), since
the parameter is read from setting `0x1e51`.

## Hardware validation

The lab's only ground truth is the firmware's own code. Some items cannot be settled from code: U1 (a photo of the
Thai menu settles it, text spec U1), how strings with icon codes show (U6), what indices >= 128 show (U16), plane order
and blend (A5, A7), the EVF menu in its EVF layout (a photo through the viewfinder next to `check_nav` N7's
composite, B2), the IMG edge rule (A6), what CTRL3 bit 6 of the live-view setup does (A15), the EVF image after the
post-mix stages (A14), which palette a buffer kind uses (vsc spec §7), `udf07`'s bit order (udf spec §2), and whether
the updater accepts a modified image. Photos of the rear screen from an OM-1 on v1.9 need no flashing and would also be
the external reference for the menu: the Setup pages where U1 hypotheses A and B differ (`check_menu_notes.txt`) would
settle U1, given a camera reset to its defaults (the lab's store) or set to a seed. For the blocks below the camera
application, hle-gaps.md §8 lists the captures and files that would unblock each, a debug-UART console log first.
