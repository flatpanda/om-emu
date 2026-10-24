# emu: the OM-Emu emulator and lab

emu runs Olympus / OM System camera firmware in JavaScript: an MN10300 (AM33) CPU, the camera's interrupt controller,
timers, OSD engine, VSC display compositor and SCPU interface, and a harness that runs the firmware's own kernel, GUI
and camera application with named stand-ins where a part of the camera is not modelled. It runs the OM-1 v1.9 (E143)
natively and other bodies through ports (`docs/model-survey.md`). This file is the user and developer guide; the design
is in [ARCHITECTURE.md](ARCHITECTURE.md) and the known departures from the hardware in
[FIDELITY-NOTES.md](FIDELITY-NOTES.md).

## Requirements

- node 26 (tested with v26.11.1); no npm packages, no Python.
- The model's firmware, which is never stored in this repository: `node emu/bin/fetch-fw.mjs [--model CODE]` downloads
  the `.BIN` from the vendor's updater API, checks it against `BLOBS.sha256`, unpacks the main code block and the
  resource block into `unpacked/<code>/` and checks both against `src/fw/models.mjs` (for the OM-1, about 240 MB
  downloaded, 90 MB kept). The player does this itself on first use.
- For the debug API's `--disasm` only: `tools/mn10300-objdump` (or `$OM_OBJDUMP`; the build recipe is in `BLOBS.md`).
- For `bin/webgate.mjs`: the `.BIN` (`$OM_BIN`, or `$OM_FW_DIR` holding it) and Chrome: `--chrome PATH`, else the
  first found of `/usr/bin/google-chrome-stable`, `/usr/bin/google-chrome`, `/usr/bin/chromium`,
  `/usr/bin/chromium-browser` and the macOS Chrome and Chromium apps in `/Applications` (tested with Chrome
  155.0.8059.39 on Linux and 155.0.8059.85 on macOS). The browser player itself needs a browser with module Workers and
  OPFS.

## Quick start

```sh
emu/play.sh                    # the interactive player in the default browser (the play page and its API)
emu/play.sh --device evf --start menu --idle off     # any play option
emu/play.sh --model E144       # another camera model (OM-5); --model list shows them all
```

The model is E143 (OM-1 v1.9) unless `--model CODE` names another body of `src/fw/models.mjs` (`OM_EMU_MODEL` in the
environment does the same; the option wins); `bin/play.mjs`, `bin/nav.mjs` and `bin/fetch-fw.mjs` take the same option.
`--model list` prints each one's code, name, firmware version and whether its firmware is on disk. A body whose port is
not finished stops during its start: the status's phase is `error` with the reason, and the page shows it; a body the
lab does not load on yet (the E118 family, on unread board facts) is refused at start with the reason, exit 1. The
page's model menu switches a running server to another body (`POST /api/model`): the session stops as Quit stops it,
the server restarts on that model at the same URL, and the page reloads. It refuses, with the reason under the menu and
the session running on, a body whose firmware is not unpacked yet (run `fetch-fw.mjs --model CODE` first), a body the
lab does not load on, and a session started with `--out` or `--replay`.

On first use the player provisions the model's firmware (`host/firmware.mjs`): it takes the `.BIN` from `fw/` or
`fw/old/` (or `$OM_FW_DIR`, or `$OM_BIN` when that file is the model's `.BIN`), else downloads it (the API serves only
each body's latest release), and verifies and unpacks it as `fetch-fw.mjs` does (`--check` only reports whether the
blocks are the model's). `npm run play` in `emu/` does the same as `play.sh`. Ctrl+C stops it; the session log is in
`emu/out/play/<model>/<time>/session.json`. A browser-only variant, with the lab in a Worker and no server, is under
"The browser player".

**The live view.** The page's "Scene and image sensor" panel turns on S-SCENE, a stand-in for the image sensor
(`src/lab/scene.mjs`, `docs/om1-shutter-spec.md`). It renders a synthetic scene (static, moving or a test chart; three
layers at their own distances and speeds) through a thin lens on a Four Thirds sensor (focal length, aperture, focus
distance: depth of field from the circle of confusion) at an exposure (EV, shutter, ISO, compensation; auto or
manual), and the firmware's own through-image API shows it on the live-view plane under the GUI. S1 focuses on the
layer under the AF point, S2 records a capture with the exposure in use and REC starts and ends a clip; all three are
the stand-in's, because the camera modules that would run AF, the release and the movie recording do not run in the
lab. Its inputs are session-log inputs, so `--replay` repeats them.

**The camera application.** Every play session runs the firmware's camera application (CA_MAIN) natively (S-CAMAPP,
`src/lab/camapp.mjs`, `docs/om1-shutter-spec.md` section 7). It takes the GUI from power-on to its own screen (on the
lab's unset clock, the date prompt), and S1 and S2 are the application's: S1 cancels the prompt and shows the shooting
information, S2 the capture display and the rec view. What runs below it is stood in:

- the sub-CPU's side of the firmware's SCPU requests is answered (S-SCPU, `src/lab/scpuserver.mjs`): the date and the
  backed-up time-zone word are kept for the session, and the SCPU clock ticks with lab time. On E143, E146 and E147
  the power lever, the Fn lever and S1 are the SCPU interface's port levels (H-SCPUPORT): IRQ 320, its handler and
  UI_IN's callback run natively; the lab attaches the IRQ and registers the callback in place of the inits that would
  (H-SCPUIRQ, H-UIINPORT).
- With `--hdmi on` (E143, E146, E147; off by default) the HDMI port is modelled: the transmitter's registers, its
  DDC and IRQ 239, and the hot-plug GIO pin with its IRQ 109 (`src/dev/hdmi.mjs`). The input `{"type": "hdmi",
  "action": "plug"}` puts a lab sink on it (S-HDMISINK: a 1080p60 EDID with a CTA-861 block composed for the lab,
  `src/lab/edid.mjs`), and the firmware takes the pin's interrupt, starts the transmitter, reads and parses the EDID
  over the DDC and reports the connection to UI_IN natively; the lab only frees the GIO interrupt slots the pin's
  registration needs, as the GIO init that does not run would (H-GIOSLOTS). The camera application then leaves the
  date prompt but opens no HDMI output; an unplug is refused (A-HDMI-1), and so is the `fw_0501` switch, which the
  firmware now drives (`docs/hle-gaps.md` 4.9).
- On E143 and E146 the accelerometer is stood in at its sample cache (`src/lab/acc.mjs`): the ACC module init and
  PER_SLOPE's init run natively at the bring-up (H-ACCINIT, H-SLOPEINIT), the sensor's register file answers the
  probe (S-ACCREG), and before each of ACC_MAIN's 80 ms copies the lab stores one sample where the sampler's
  completion would (S-ACCSAMPLE): a level camera by default, tilted by the input `{"type": "tilt", "roll": 5,
  "pitch": 0}` (degrees, within 45; A-ACC-1..3). ACC_MAIN, PER_SLOPE, the shooting screen's level gauge and Setup's
  Level Adjust run natively; with the lab's blank factory data Adjust writes the user table but leaves the gauge as it
  was (`docs/hle-gaps.md` 4.7.3).
- module requests are answered (S-MODACK), the HLS transaction layer's exec succeeds (S-TRAACK), and the modules'
  notifications of a release (focus, exposure, rec view) are posted as the callbacks the HLS would make of them
  (S-RELSEQ); no image is captured. The focus result and the exposure time come from S-SCENE when its live view is on.
- A card is in the SD slot. On E143 it is an 8 GiB SDHC card behind the firmware's SD command layer (S-SDCARD,
  `src/lab/sdcard.mjs`), and the firmware's own storage stack runs on it (`src/lab/storage.mjs`, `docs/hle-gaps.md`
  4.8.2): the file system's bring-up and the file tasks natively before the application starts (H-FILEINIT,
  H-FILECLBK; the SD host's registers S-SDHOST, its NAND area S-FSNAND, the album manager S-ALBM), the card's
  insertion as the file module's requests (S-CARD): the firmware formats a blank card itself (FAT32, `OM SYSTEM`) and
  mounts it, and counts the remaining shots and the movie time from it. Each picture taken is also written to the card
  as `C:\DCIM\100OMSYS\P1010001.JPG` and on, through the file module's own file requests (S-RECFILE: a JPEG of
  S-SCENE's frame at the capture, each 8 x 8 block its mean). Card Formatting from the menu formats it: the menu's
  Yes reaches the file module through api_media's own format call (S-MDACTRL, `src/lab/media.mjs`, `docs/hle-gaps.md`
  4.8.3, in place of the HLS function component), its progress bar runs and the application returns to the menu. The
  input `{"type": "card", "action": "remove"}` takes the card out of the slot while the camera runs and `"insert"`
  puts it back: the card switch changes as a body's does and UI_IN decodes it natively, S-MEDIA (in place of the HLS
  media manager) has the firmware unmount and mount it again, and the shooting screen drops the card's counts and
  shows them again. The card stays in the slot across a player's power
  cycles; `OM_EMU_CARD=FILE` keeps it between sessions (`host/card.mjs`). On the other bodies the card has no file
  system (S-CARD: the HLS mount state, every picture taken kept as an image of folder 100, a remaining-shots answer of
  999 less the images to the application's getAvailableShootCount, the first slot's card detect state at inserted and
  a movie time left of an hour less what has been recorded). The system timer module's
  long timers run out (S-LONGTIMER), and a lens is on the mount (S-LENS: an attach flag, a lens-ready byte and a
  12-40mm F2.8 PRO record, so the screen shows S-AF and the AF target).
- A half press in focus shows the green AF frame and focus mark. They are CPU 3's (its task DISP_FRAME draws them into
  the TFT's face-frame plane), so S-DISPFRAME runs DISP_FRAME on the lab CPU for each post to it, S-TAKEFRAME sets the
  frame display mode the TAKE module would, S-AFOSD uploads the indicator and the AF frame the AF module would, and
  the VSC model shows the plane under the opt-in A19 (`docs/om1-shutter-spec.md` section 7 item 50). A full press
  clears the GUI's information for the capture and the rec view; during the rec view S-RECVIEW holds S-SCENE's frame
  of the capture on the live-view plane (the lab develops no image).
- With the control op camapp at 2 a new session runs the HLS components too (off otherwise: the GUI then shows its
  shooting panel over a black image area): S-CAMAPP starts the OXF main thread (task 57 HIGHLEVEL_MAIN), S-BOOTDONE
  sends the camera base and the still-shooting category the events the modules' start would bring, so the shoot mode
  and Cmp_ShootingComponent are created natively, and S-CPU3 takes their remote calls to CPU 3 off the ring.
- REC records at mode-dial position 7 once the LLPSW firmware key is released; while it records, the GUI shows its
  movie recording screen (the card, a red REC mark with the recording's time, the time left, the movie mode, shutter,
  aperture and a blinking ISO).
- OK opens the Super Control Panel, MENU the menu (the live view stops behind it, S-THROUGH; closing it skips the
  settings' flash save, S-SETSAVE), PLAY playback (the pictures taken, newest first, through S-PLAYSEQ, S-PLAYCOMP and
  S-PLAYVIEW; left and right move between them, INFO shows the detail view, PLAY or S1 returns; "No Picture" before
  any), and LV or the eye sensor switches to the EVF with the application re-entering the screen (S-OUTDISP). The
  application creates the GUI itself (H-GUIBYAPP), so the EVF shows its information and bottom bar in every frame.

## Run

```sh
sh emu/play.sh                                   # the interactive player (bin/play.mjs) in the browser
node emu/bin/play.mjs --no-browser --idle off    # its server alone (HTTP API; --debug-api for the debug tokens and
                                                 # the live debug route, below)
node emu/bin/play.mjs --hdmi on                  # with the HDMI port; the input {"type": "hdmi", "action": "plug"}
OM_EMU_NVRAM=~/.om-emu.json sh emu/play.sh       # keep the settings and the clock between sessions (S-NVRAM): no date
                                                 # prompt at power-on, menu changes back in the next session
OM_EMU_CARD=emu/out/card/E143.omsd sh emu/play.sh   # keep the card between sessions (E143): formatted once, the
                                                 # pictures' files stay on it (src/lab/sdcard.mjs cardImage)
node emu/bin/nav.mjs --time --png each 'DOWN OK MENU'     # a scripted menu session: a line and a PNG per step
node emu/bin/run.mjs all --trace emu/out/js      # the replayed scenarios, traced (37 labs, about 3 min)
node emu/bin/run.mjs stage2 --slice 1000000      # the same in budgeted continues of 1 M instructions
node emu/bin/golden.mjs check [--jobs N]         # emu against its own recorded outputs (golden.json), about 20 min
node emu/bin/modelcheck.mjs [MODEL ...]          # the ported models' smoke test: start, S1, S2, PLAY, INFO on TFT and EVF
node emu/bin/port.mjs all                        # re-port every model after a change to the rules, src/lab or overrides
node emu/bin/xto.mjs E144 0x501e04b7             # where an E143 code address is in a ported model (xwhere.mjs: back)
node emu/bin/fw-survey.mjs survey                # the multi-model survey's columns for every .BIN in fw/ and fw/old/
node emu/bin/fwmap.mjs                           # the firmware map: static map, coverage run, report (about 5 min)
```

`bin/play.mjs` is the play server and `bin/nav.mjs` the scripted menu tool (`host/playcli.mjs`, `host/navcli.mjs`). The
server answers every request with the router the browser uses (`src/lab/playapi.mjs`) on node's main thread and runs
`Player.run` synchronously in a `worker_threads` Worker (`host/labworker.mjs`), whose input queue blocks
(`host/portqueue.mjs`: `receiveMessageOnPort` and `Atomics.wait`). SIGINT, SIGTERM and SIGHUP stop the loop after its
current tick; a second signal exits 130. The default `--out` is `emu/out/play/<model>/<time>`
(`emu/out/nav/<model>/<tag>` for nav). Two request bodies throw Unported rather than guess: a JSON body nested deeper
than 10,000 levels and a body whose `surrogatepass` decode puts two surrogates in a row.

**Scenarios.** `bin/run.mjs` replays sessions from their inputs: `scenarios/calls/<scenario>.calls.json` holds recorded
calls into the lab objects (recorded on 2026-10-13; inputs only, no outcomes), and the osd scenario's calls are
generated from `check_osd` at run time (`checks/lib/osdcalls.mjs`: its arguments carry memory copied out of the
firmware, so they are not committed). Each replayed call's outcome digest goes into the trace, where `bin/golden.mjs`
records it. Groups: `stage0` (the six kernel sessions `kernel-1`, `kernel-5b`, `kernel-5c`, `kernel-6`, `kernel-7`,
`kernel-7b`, and `osd`), `stage1` (`shoot-tft`, `shoot-evf`, `menu-tft`, `nav-a`, `nav-evf`: the play session's bring-up
to the shooting screen, a menu open and close, two scripted menu sessions), `stage2` (the Player driven without HTTP or
threads: `play-perf`, `scp-timeout`, `scp-edge`, `evf-idle`, `eye-burn`, `switch-shoot`, `switch-scp`, `inputs`,
`a15-open`, `queue`, `power`, `scp-replay`, `power-replay`, `keys`, `b7-gate`, `tokens`, `playback`, `tokens-3b`,
`pace-wall`), `stage3` (`menu-open`, `menu-open-any`: a menu session in interrupt gate modes 1 and 2) and `all` (37
labs). `pace-wall` drives the Player with `--idle wall` under a frozen clock, so its pacing is kept in its outcomes
rather than removed. A session that opens more than one lab is traced as `NAME`, `NAME#2`, `NAME#3`. A scenario that
throws (a FirmwareError, Unported, a calls file the replayer cannot drive, or a bug) is reported and the others still
run; with `--trace` its partial trace goes to `<scenario>.partial.json` and the throw to `<scenario>.divergence.json`,
and the exit status is 1. `run.mjs --trace DIR` first removes the earlier trace, partial and divergence files of the
scenarios it runs, so a failed run never leaves an old trace behind.

**The checks** (`checks/check_*.mjs`), like `bin/debug.mjs`, `bin/play.mjs` and `bin/nav.mjs`, parse their command lines
with `checks/lib/args.mjs`: options are spelled in full, and an unknown option, a missing or malformed value or a usage
rule of the check's own prints `PROG: message` and the usage line on stderr and exits 2. check_perf's `--play`, which it
does not implement, is refused that way with the reason. An uncaught error prints its stack and exits 1.
`checks/runs.json` lists every run with the exit status it must give, its own environment variables, the output files it
must write and, for a fault-point run (`OM_FAULT`), a line its output must hold; `bin/checks.mjs` runs them and
judges each on its own exit status. `OM_MACHINE` sets the machine options of every lab a check makes, as white-space
separated `mutant=N` (a negative control) and `oneInsn=0|1` (the one-instruction mode); run `irq-xm28` sets `mutant=28`.
`--write-notes` writes into `OM_NOTES_DIR` and is refused without it; output files go under `OM_CHECK_OUT` (default
`emu/out/checks/js/manual/`). A check that declares a notes file compares its observations with
`checks/fixtures/check_*_notes.txt`, pinned from emu's own run. PNGs are compared by their pixels, never by their bytes.
check_menu's and check_nav's `--jobs N` run the sessions in N `worker_threads`; `--mutants` runs the check as a node
child under each mutant; check_menu's and check_nav's first check that a child spinning on `bra .` and killed on timeout
leaves no child process and no temporary directory.

## The firmware map

`bin/fwmap.mjs` measures how much of the E143 main block emu runs, per source module and per subsystem block, so that a
modelling step can be measured against the one before. Its subcommands (default `all`, the three in order):

```sh
node emu/bin/fwmap.mjs static          # the static map: functions, their modules and features (a few seconds)
node emu/bin/fwmap.mjs cover           # golden's workload under OM_COVERAGE, and the union of what it ran (about 4 min)
node emu/bin/fwmap.mjs report          # the map joined with the coverage and the labels: emu/out/fwmap/E143/report/
node emu/bin/fwmap.mjs cover --scenarios shoot-tft,menu-tft --checks none     # a smaller workload
node emu/bin/fwmap.mjs report --without-mutants --top 20
```

**static** (`fwmap/discover.mjs`, `fwmap/static.mjs`) finds the code by recursive descent from the reset and CPU 1..3
entries, the static task tables and the interrupt vectors, then from validated code pointers (`mov imm32` in code,
aligned words in data, jump tables), each kind of evidence drained before the next, and splits it into functions. A
function's module is the source file whose `__FILE__` string it loads, or a `Class::method` string's class; the
functions between two of one module take it (contiguity, call affinity at the edges), and what is left forms gap
pieces named `gap@<first entry>`. The instruction lengths are emu's (`src/core/cpu.mjs insnLength`); the validity of an
encoding is the ISA spec's (`fwmap/isa.mjs` says why not `step()`'s). The map is a function of the image and
`fwmap/E143.seeds.json`, executed instruction starts the static phases miss, pinned; `static --update-seeds` re-derives
them from the last cover run. On E143: 102,803 functions, 5,186,071 instructions, 2,629 modules (1,217 named).

**cover** runs `node emu/bin/run.mjs all` and `node emu/bin/checks.mjs --jobs 4` (every run of `checks/runs.json`, the
mutant and fault-injection runs included) with `OM_COVERAGE` set, and takes the union of the per-thread files
(`checks/lib/coverage.mjs`). The machine option behind it, `coverage` (`src/machine.mjs`), marks every pc the CPU runs
(at its decode into the cache and at every helper step) and every stand-in that fires; without it nothing changes,
`golden.mjs check` included. `OM_COVERAGE=DIR` works on its own for any lab made through `labEnv`, `bin/run.mjs` or
`bin/playperf.mjs`; children and worker threads inherit it. It shares `emu/out/checks/js/` with `checks.mjs`, so do not
run it beside `checks.mjs` or `golden.mjs`.

**report** writes, under `emu/out/fwmap/E143/report/`, `functions.jsonl` and `modules.json` (each function and module
with what ran of it, the direct call sites that ran, the stand-ins at it), `regions.json` (each MMIO region the code
names, with emu's model status), `lists.json` (the largest modules never entered, the ones a running caller did not
call, the ones that touch unmodelled MMIO, the functions stood in for), `blocks.json` and `report.md`, and prints the
table by block. The blocks come from `fwmap/E143.labels.json`: per module a subsystem block, whether its code is
gap-relevant (code a native path would still have to reach), the evidence and a description, written by agents from
the map. The labels are keyed by the static pass's module names, so a change to discovery or attribution (or to the
seeds) that renames modules needs them re-keyed: report lists the modules without a label and the labels without a
module, and `test/test_fwmap.mjs` fails until both are empty. Only E143 is supported (`--model` refuses others).

## The debug API

`bin/debug.mjs` is the command-line debugger (`--entry`, `--stop`, `--reg`, `--write`, `--read`, `--step`, `--stack`,
`--trace`, `--insn-limit`; `--image` defaults to the ND128 candidate's main code, built in memory from the E143 main
block and the patches in `artifacts/nd128/manifest.json`). It also has
`--watch ADDR:LEN[:r|w|rw]`, `--exec-trace PATH` with `--trace-mode native|one-insn`, `--mmio-trace PATH`,
`--irq-trace PATH`, `--disasm ADDR:LEN` (through `tools/mn10300-objdump` or `$OM_OBJDUMP`) and `--max-ms N`.
`node emu/bin/debug.mjs --serve` reads one JSON request per line and answers one per line, for scripts, for
example:

```
{"id": 1, "op": "load", "image": "unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin"}
{"id": 2, "op": "reset", "regs": {"pc": "0x502d0336", "d3": "0xa2022000"}}
{"id": 3, "op": "watch", "list": [{"addr": "0xa2022000", "len": 2, "kind": "w"}]}
{"id": 4, "op": "cont", "stops": ["0x502d0341"], "maxMs": 5000}
```

The ops are in `src/debug/protocol.mjs`. The library behind both, `src/debug/debugger.mjs`, is Worker-safe: a standalone
machine or a running lab session's Simulator, registers and memory, continues with a budget or a wall-time limit, single
steps, watchpoints per virtual address (stop or log), exec, MMIO and interrupt traces, lab time, and in-memory
snapshots. The exec trace has two modes: `one-insn` runs every instruction as its own one-instruction block (the
machine option `oneInsn`), `native` (the default) keeps the untraced run's interrupt timing; both write the line format
of QEMU's `-d exec` log (the protocol's trace format `qemu`; `jsonl` is its other).

A client has to plan for three behaviours. A `cont` whose pc is on a breakpoint (after a break stop, or a watch stop
that ended on a breakpoint pc) returns `break` at once without executing anything, so `step` first. After `abort` the
machine is gone: every op, `reset` included, fails with `Aborted` until the next `load`; `halt` instead ends a paused
continue where it paused (stop `halt`) and leaves the machine runnable, as after a breakpoint stop. While a budgeted
or `maxMs` continue is paused, every op that would change the machine or its run is refused until `resume`, `halt`
or `abort`: `break`,
`step`, `cont`, `watch`, `snapshot`, `restore`, `reset`, `setRegs`, `setReg`, `write`, `cpuStore`, `lab` other than
`time`, an `exec` trace and `trace {off}` (which turns the exec trace off too); the reads (`regs`, `reg`, `read`,
`stack`, `stderr`, `watchLog`, `stats`, `disasm`, `lab {time}`) and `mmio` and `irq` traces are allowed.

Requests are handled one at a time: a `cont` or `resume` without `budget` or `maxMs` runs until a stop, a fault or the
insn limit, and no later request, `abort` included, is read meanwhile, so give `maxMs` to keep control. `stack` dumps
upward from the current SP, or from `at` (a task's saved SP); `initialSp` only tags the line at that address. A `jsonl`
trace writes addresses and values as `"0x..."` strings, as the responses do; a `trace` request that fails changes no
file and no running trace; a trace restarted on its own file starts empty, two keys of one request may name one file
(their lines interleave), and a file another running trace writes is refused. The watch log keeps the newest hits (at
200,000 it drops the oldest half): `watchLog {limit?}` takes at most `limit` entries (default 100,000) off it and says
how many are `more` and how many were `dropped` since the last call. A standalone machine keeps its last 1,000 to 2,000
stderr lines: `stderr {since?}` answers from the oldest line still kept, with `first` and `dropped`, and a run's own
`stderr` field is its last 1,000 lines, with `stderrDropped` when it wrote more. `disasm`'s `n` is a byte count, not an
instruction count, and each returned line is one whole instruction. A watch stop's `watch` record and the `watchLog`
entries give `kind` as a number (1 read, 2 write, 3 both), where the `watch` request takes `r`, `w` or `rw`. A field
of the wrong shape is a `BadRequest`, never a JS error or a silent truncation: an address outside 0..2^32-1, a register
or stored value outside 32 bits (signed or unsigned), a count that is not a non-negative integer (`step`'s `n`,
`disasm`'s `n`, a watch's `len` and a `budget` positive), a list field (`stops`, `pcs`, `list`) that is not a list,
`regs` or a watch entry that is not an object. A trace's `filter` keeps fewer lines: `{exec: {from, to, pcs}, mmio:
{from, to, dir}, irq: {kind, irqs}}` (a pc range or list; accesses overlapping an address range, one direction; one
kind of interrupt event, or the presentations of some IRQ numbers); the top-level `from` and `to` are the exec
filter's. On a lab session's Simulator (`Debugger.attach(sim, {lab})`) breakpoints are refused, because the harness
owns the breakpoint list and takes any stop as its own, and so are stopping watchpoints unless a host routes the
stops (the live route below); the watch log's entries there also carry `lab_ns` (the lab clock at the hit) and `n`
(the hit's number since attach, dropped hits counted).

**A running play session (the live route).** With `--debug-api`, `POST /api/debug` (the `X-Token` header, as every API
request) takes one request of the JSON-lines protocol and answers its response object once it ran; `node
emu/bin/debug.mjs --attach 'http://127.0.0.1:PORT/?t=TOKEN'` (the URL `bin/play.mjs` prints) sends its stdin's lines
there in order and prints the answers, as `--serve` does. Without `--debug-api` the route answers 403 and a `{type:
'debug'}` input on `/api/input` is refused. The requests are inputs on the session's own queue (`src/debug/live.mjs`):
the Player runs them between ticks, outside the session log and the GUI's event gate, through `Debugger.attach(lab.sim,
{lab})` on the current session (a restart starts with a fresh debugger), and nothing of the route runs before the first
one, so an unused route changes nothing (the golden runs are identical). The reads and memory writes of the protocol
work (`regs`, `reg`, `setReg`, `setRegs`, `read`, `write`, `stack`, `stderr`, `stats`, `disasm`, `watchLog`, `trace`,
`lab {time}`), plus `tasks` (the kernel's tasks: id, entry in the disassembly notation, state, priority, saved SP, the
running one) and `standins {limit?}` (the last harness stub calls by name, the camera application's stand-in actions,
the stand-ins in use); `load`, `reset`, `cpuStore`, the snapshots, `abort`, `quit` and `lab` time moves are refused. Run
control: `halt` pauses the session at the current tick boundary (phase `debug`; only debug inputs and controls run, the
other inputs wait in the queue in their order); `break {pcs}` and a stopping watchpoint make a debug stop inside a tick,
where the session is held (the harness's continue or step waits in the Simulator's debug hook) while debug inputs run:
`step {n?}` single-steps there (no interrupt accepted; it stops before an instruction at one of the harness's own
breakpoints, `harness: true`, which a `cont` then lets the harness take); `cont {stops?, maxMs?}` runs on and answers at
the next debug stop or halt (stop `break`, `watch` or `halt`, the registers, the watch hit, `lab_ns`, `at: run` or
`tick`, the stderr lines since), `maxMs` halting at the first tick boundary after that much wall time; `resume` runs on
and answers at once; `detach` turns breakpoints, watchpoints and traces off and runs on; `state` says where the session
is. A control (restart, power, quit) during a debug stop lets the stop go (its breakpoints and stopping watchpoints
cleared) and runs after the tick; during a halt it runs at once. A debug stop waits for the next input inside the tick,
which needs a blocking input queue: the node server's has one, the browser player's Worker does not, so there
(`/api/debug` on its router) `break`, `cont`'s `stops` and stopping watchpoints are refused while `halt`, the reads and
log watchpoints work, and trace files and `disasm` are not offered. Stepping and setting registers inside a tick can
leave the harness in a state it did not expect; that is the user's to judge.

The open items are in `docs/ROADMAP.md` "Debug API follow-ups".

## The browser player

`web/index.html` is the player's page (`web/play.html`) running the lab in a module Worker (`web/worker.mjs`). Serve
`emu/` from any static server on localhost (for example `python3 -m http.server -d emu 8000 --bind 127.0.0.1`), open
`http://127.0.0.1:8000/web/index.html` and choose the camera's firmware file (the page names it: E143's is
`OLY_E_143_1900_0000_0000.BIN`). The Worker reads it block by block (`src/fw/olyfw.mjs`: the container walk,
descramble and checksum), keeps the main code block and the part of the resource block the lab can read
(`src/fw/resprefix.mjs`, 9.6 of 58 MiB), and caches both in the browser's Origin Private File System, so a later visit
starts with "Start from the cached firmware". Nothing is uploaded.

The query string takes the player's options (`?idle=off`, `device=evf`, `a15=on`, `touch=driver`, `start=menu`,
`tab=7,5,1`, `debug_api=1`, ...); the default is `--idle wall`. The page runs one model, E143 unless `?model=CODE`
names another of `src/fw/models.mjs` (the page's model menu reloads it with that parameter): the Worker compares the
main code block and the resource prefix with that model's sha256 (`src/fw/labfw.mjs`) before it caches anything (one
OPFS directory per model), so any other `.BIN` (a newer release, or another body's) is refused with a message that
names the file the model needs, and the file input is offered again. With `debug_api=1`, the `WINDOWS` token is
refused before it runs anything (its layers carry zlib's level-6 deflate, which the Worker does not have); `STORE` and
the other tokens run as in `bin/play.mjs`. Quit ends the session; the page then stops polling and says so.

The Worker runs the Player as the server's lab thread does (`web/driver.mjs`: tick, then wait for a message, the pacing
target or 20 ms) and answers the page's API calls with `src/lab/playapi.mjs`. The page swaps play.html's `fetch` for
`web/page.mjs`, which answers the status and frame long polls from what the Worker pushes (every status, the newest
frame as RGBA, the session log) and sends every other request to the Worker. The message protocol is in
`web/worker.mjs`'s header. `web/gate.html` and `web/runner.mjs` are `bin/webgate.mjs`'s Worker-side runner.

## Layout

- `src/`: the machine and the harness, with no node APIs, so that it runs in a Web Worker. `core/` the CPU, the
  interpreter and the one machine buffer; `dev/` the devices; `machine.mjs` the board and its gdbstub-equivalent API
  (with budgeted continues: `cont({budget})`, `resume`, `abort`); `lab/` the harness (the HLE layers, the native
  kernel, display, text, menu, navigation, the play session, the Player, the camera application's stand-ins, the
  scene, the accelerometer's stand-in, and the card with the file system: `sdcard.mjs`, `storage.mjs`, `media.mjs`, `jpeg.mjs`); `fw/` the `.BIN` unpacker, the model table (`models.mjs`), the per-model address tables (`ports.mjs`, written
  by `bin/port.mjs`), the cross-build map (`xmap.mjs`, `place.mjs`), the firmware rules (`facts.mjs`) and the boards
  (`board.mjs`); `debug/` the debug API; `trace/` the trace writer; `util/` sha256 for the Worker, bytes and hex text
  (`bytes`, `hex`), counts (`tally`), value text and equality for messages and checks (`show`, `equal`), the numbers
  of the lab's text inputs (`parse`) and the trace and digest JSON (`tracejson`). Values are plain JS values
  throughout; the Player's HTTP API and session logs are plain JSON (`JSON.stringify` / `JSON.parse`).
- `refs/`: the checks' independent references (the menu reference with its raster and navigation rules, the font, the
  settings tables, the OSD bitmap format, the MT19937 generator with CPython-compatible seeding (`mt19937`), the
  reference compositor and register formulas, the live-view formulas, the ISA and interrupt expectations, a FAT reader
  `fat.mjs` and a baseline JPEG decoder `jpeg.mjs` for the card's files), Worker-safe and importing only `refs/`.
- `checks/`: one node command per check, `checks/lib/` their helpers, `checks/runs.json` the run table.
- `scenarios/`: the scenario replayers (`kernel.mjs`, `osd_replay.mjs`, `session_replay.mjs`, `bind.mjs`) and the
  replayed scenarios' inputs (`scenarios/calls/`).
- `bin/`: the command-line tools. `host/`: the node hosts of the player and the scripted menu tool. `web/`: the browser
  player (page, Worker, driver, frame conversion, OPFS cache), importing only `src/`, `scenarios/` and `web/`.
- `fwmap/`: the firmware map's library (`bin/fwmap.mjs`: the ISA view, discovery, the static map, the coverage run, the
  report, the block aggregation) and its E143 data: the module labels (`E143.labels.json`) and the pinned discovery
  seeds (`E143.seeds.json`).
- `test/`: the test suites (`bin/test.mjs` runs them) and their fixtures (`test/fixtures/isa_vectors.json`);
  `checks/fixtures/`: the checks' pinned data; `golden.json`: the regression reference.

`src/` and `scenarios/` import neither `refs/` nor `checks/`; `test/test_pure.mjs` checks the import rules and that the
Worker-side modules use no node API. Paths that are not modelled throw `Unported` with their source name.

**Interrupt acceptance** is not checked at every instruction: a pending interrupt is looked at only at the start of a
continue, after a helper RTI or PSW write, after an instruction run as a one-instruction translation block (TB: the PSW
write window, irq_wait, the last 64 instructions before the insn limit, or every instruction with the `oneInsn` machine
option), and once more after an instruction that raised the request. Where a look would depend on a TB layout or TB
cache that emu does not model, `src/core/interp.mjs` refuses (`TbUndecidable`) instead of guessing, and the continue
ends with a stop of kind `undecidable`; `test/test_irq.mjs` checks those refusals unsliced and in slices. A budgeted
continue pauses only where no look is pending, so a chain of slices takes exactly the looks of one continue. CPU faults
write trap lines prefixed `om-emu:` to stderr, and a FirmwareError message ends with them (golden pins the check runs
that print them). FIDELITY-NOTES 2.1-2.3 say where this departs from the hardware.

## Data

Firmware images and unpacked blocks stay outside git (`fw/`, `unpacked/`; see `BLOBS.md`), and what a run produces
(traces with register and memory images, device vectors, frames) is written to `emu/out/`, which is gitignored. None of
that is committed or published with this code; composites appear in traces only as sha256. The repository does hold
small derived data: the VSC register and name table `checks/fixtures/om1-vsc-regs.h`, the digests and short recorded
observations of `checks/fixtures/` and `golden.json`, the replayed scenarios' inputs in `scenarios/calls/` (call
arguments: keys, options, lab-time targets, addresses; no firmware bytes), the firmware map's module labels and seeds in
`fwmap/` (module names, addresses, descriptions with short strings), and the addresses, tables and short excerpts in
`docs/` and `analysis/`. The browser player takes the firmware only from the user's own file and keeps the unpacked
blocks only in that browser's Origin Private File System; the page embeds no firmware, and `bin/webgate.mjs` checks that
it sends nothing but GETs for its own files.

### Publication audit

`bin/pubaudit.mjs` checks what a push would publish: every blob in a ref's history (each blob once, with every path
it was committed at) and every commit's identity and message. It fails (exit 1, with blob, path and commit per
finding) on forbidden paths (`fw/`, `unpacked/`, `emu/out/`, `*.bin`, `.claude/`, scratch, key and ignored files),
blobs over 1 MiB, content that is not text, home and temporary directories, email addresses, tokens and keys, long
hex or base64 runs, commits by an identity that is not noreply, and firmware: any 47 bytes or more of a local `.BIN`
(descrambled) found in a binary blob or decoded from text (hex runs, number lists, base64, listings), or a run of
quoted firmware text over 128 bytes. Short listings (up to 512 matching bytes per file) and quoted strings pass. The
rules and the reviewed exceptions (`ALLOW`, each with its reason) are in the tool's header. Names that must never
appear can be added locally with `git config --add pubaudit.marker TEXT`; they stay in `.git/config`.

Before each push to the public repository, audit only what is not public yet:

```sh
git fetch https://github.com/flatpanda/om-emu.git main    # FETCH_HEAD: what is already published
node emu/bin/pubaudit.mjs release --since FETCH_HEAD       # the commits about to go out; push only when clean
node emu/bin/pubaudit.mjs release                          # the whole history: after a rule change
```

The firmware rule reads `fw/` (about 4 s for the 2.9 GB of `.BIN` files; `--fw PATH` for other places); without
firmware the run warns and skips that rule. `--explain N` prints what each firmware finding matched.

## Tests

| Command | What it covers | Needs |
|---|---|---|
| `node emu/bin/test-pure.mjs` (`npm run test:pure`) | the ISA vectors on both engines, the core's two tiers in lockstep and its length tables, the pure sha256 and JSON parser, the browser driver's pure parts, the scene model, the purity rule, the firmware rules (each unpacked main block checked against its `MODELS` entry when present), the firmware map's units, the SCPU clock, port words and request server (S-SCPU), the HDMI port's device and sink, the accelerometer stand-in's sample, the SD card model, the FAT reader and the JPEG pair, the publication audit's rules on a throwaway repository | node and git; runs on any checkout in a few seconds |
| `node emu/bin/test.mjs` (`npm test`) | all of the above, plus the decode-cache regressions, the VSC register, class and blend tables, the kick model's TB-layout refusals, the replayer's argument binding, the check runner and the checks' controls, the debug API's units, the browser player's parts and hosts, the node host, the command-line tools, the scene, the camera application, an HDMI plug in play on E143, E146 and E147, check_level on E146, the card and the file system in play on E143 (a blank card formatted and mounted by the firmware, read back independently; the counts from the card; a picture's file written and found again; Card Formatting from the menu, read back; the card taken out and put back), the firmware map and the regression net's controls | the E143 firmware blocks (E146's and E147's for the HDMI plug, E146's for check_level) and `golden.json`; with `OM_FW_DIR=fw` also the unpacker against `unpacked/E143` and the Worker in a node worker thread (without it those count as failures) |
| `node emu/bin/golden.mjs check` | every scenario, every lab of the traced check runs and every check run's output against `golden.json`: what the panels show, what the devices see and what the checks conclude must not change | the firmware |
| `node emu/bin/checks.mjs [CHECK \| RUN ...]` | every run of `checks/runs.json`, judged on its exit status | the firmware |
| `node emu/bin/checktrace.mjs RUN [--slice N]` | the labs one check run creates, traced (golden records them) | as checks.mjs |
| `node emu/bin/bench.mjs SCENARIO --passes 5` | MIPS and cost per stop; exit 1 if a pass does not repeat pass 0 | the firmware |
| `node emu/bin/playperf.mjs` | the play workload on the Player; exit 1 unless its digest is `33b134deb36a03ef` | the firmware |
| `node emu/bin/snapgate.mjs kernel-5c osd shoot-tft` | snapshot detours leave the sessions and the end state unchanged | the firmware |
| `OM_FW_DIR=fw node emu/bin/webgate.mjs --rounds 4` | headless Chrome: the Worker against node and `bin/run.mjs`, the page (keys, touch, canvas, session log), no uploads; about 5 min | the `.BIN`, Chrome |
| `node emu/bin/modelcheck.mjs` | the ported models marked `checked` in `src/fw/models.mjs` (E146, E147, E144, E139, E134, E137, E142, E140, E125, E130), or those named: start, S1, S2, PLAY, INFO, PLAY on the TFT, and start, S1, S2 on the EVF of a body with one; GUI states by name; after S1 the count probe: the screen must change with S-CARD's remaining-shots count and only there (all pass; a body expected to fail it goes in PROBE_XFAIL with its reason, strictly: a pass of an expected failure fails the run) | the models' firmware |
| `node emu/test/test_fwmap.mjs` | the coverage option off and on, the static map's determinism and headline, the labels' keys, `run.mjs` under `OM_COVERAGE` (also in both suites above) | the E143 main block for the second half |

What the tests compare with is emu's own data, and it is regression data, not a specification
([ARCHITECTURE.md](ARCHITECTURE.md), "Ground truth"): `golden.json` is recorded from emu by `bin/golden.mjs record`, the
checks' notes files and pinned results under `checks/fixtures/` come from emu's own runs, and the 5,311 ISA vectors
(`test/fixtures/isa_vectors.json`) are recorded vectors, fixed data that no tool in this tree regenerates. The replayed
scenarios' inputs (`scenarios/calls/`) are the other recorded data, replayed as inputs only. A checkout with the fetched
firmware runs every command above but `webgate`, which also needs Chrome.

An intended behaviour change updates a fixture only with a recorded reason and its evidence level (firmware code,
manual, camera). `bin/golden.mjs record` asks for both (`--reason`, `--evidence`) and writes them into `golden.json`'s
log. A change to the tooling alone is recorded with `record --tooling-only --reason TEXT`: it refuses (exit 2, nothing
written) when any session's screen or devices layer differs, and logs which layers of which sessions changed. A pinned
fixture under `checks/fixtures/` or `test/fixtures/`, or a pinned constant in a check, changes in the commit that
changes the behaviour, with its reason in the commit message.

Do not run `bin/checks.mjs`, `bin/checktrace.mjs` and `bin/golden.mjs` against the same output directories at the same
time: they share `emu/out/checks/js/` and `emu/out/js/check/`. Give a second checktrace its own `--trace DIR`.

## Performance

Measured on an Intel i7-1265U laptop (2 P-cores with 4 threads and 8 E-cores, 15 GB of RAM) under Linux with node
v26.11.1. Medians of alternating runs unless noted; MIPS are instructions per second of guest time.

| Date | What | Figure |
|---|---|---|
| 2026-10-10 | interpreter on the kernel and OSD sessions (`bench.mjs`, steady passes) | 34-36 MIPS unpinned; 31-34 on the P-cores, 20-22 on the E-cores; 53-56 in long continues only; the cold first pass 13-16 (V8 warm-up) |
| 2026-10-10 | cost per stop (harness, HLE stubs, machine API) | 29-34 us on the kernel and OSD sessions; 18-25 us on the play sessions |
| 2026-10-10 | the play bring-up sessions (`shoot-tft`, `menu-tft`, `nav-a`, ...) | 50-62 MIPS steady |
| 2026-10-10 | the play workload (`bench.mjs play-perf`) | 44 MIPS steady (bring-up 56-61, Player phases 28), 18 us per stop |
| 2026-10-10 | the play workload's phases (`playperf.mjs`) | 3.78 s; a whole process 7.16 s |
| 2026-10-10 | lab seconds per wall second, unpaced | shooting screen 3.75, menu 5.30, Super Control Panel 2.30 |
| 2026-10-10 | peak RSS of `run.mjs all` | 2.2 GB |
| 2026-10-13 | the debug API's hooks, off | no cost: `shoot-tft` 56.7 MIPS against 56.7 before the debug API, `play-perf` 43.5 against 44.2 |
| 2026-10-13 | headless Chrome 155 against node | `shoot-tft` 1.5x node's time, the workload's phases 1.08x; a paced page ran 10.12 lab s in 10.00 wall s; Chrome's memory 1.6-2.1 GB |
| 2026-10-13 | firmware loading in Chrome | unpacking the `.BIN` with the E143 check 0.85-0.88 s, the first OPFS write about 50 ms, a start from the OPFS cache 0.71-0.75 s |
| 2026-10-13 | `bin/test.mjs`, the whole suite | 742 s |
| 2026-10-20 | `bin/port.mjs all`, 17 bodies with every map from the cache | 52 s and 3.4 GB in one process; 119 s as one run per body |

A real-time player needs at least 1.0 lab second per wall second; the slowest phase measured, the Super Control Panel,
clears it about 2.3 times over unpaced on this host. Under load the figures drop: at a load of 3-6 the OSD session fell
to 16-17 MIPS unpinned (2026-10-10).
