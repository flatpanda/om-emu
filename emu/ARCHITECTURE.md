# emu architecture

How emu is built, the rules it follows, what counts as ground truth, which design choices are worth keeping, and the
architectural findings that are still open. The user and developer guide is [README.md](README.md); known departures
from the hardware are in [FIDELITY-NOTES.md](FIDELITY-NOTES.md); what the tests compare with is in README.md "Tests".

## Overview

At the bottom, the CPU (`src/core/cpu.mjs`), the decode-cache interpreter (`src/core/interp.mjs`) and the paged memory
(`src/core/mem.mjs`) are ES-module singletons: a realm holds at most one machine. `createMachine()` (`src/machine.mjs`)
re-initialises the realm and returns a closure-based facade guarded by a generation counter. It builds the address map
of the model's board (`src/fw/board.mjs`) and constructs the lab devices: the interrupt controller, the timer and the
shared lab clock, the VSC display compositor, the OSD engine, the bus window, the lab stub and the SCPU interface
(`src/dev/`). The devices' debug windows and doorbells sit in guest-addressable memory.

`Simulator` (`src/lab/sim.mjs`) sits on top of the machine. It still speaks gdbstub-shaped text packets for registers
and run control, and its Stats and harness digests hash that traffic. The HLE labs form an eight-class inheritance
chain (`HLE < OsdLab < DisplayLab < GuiMixin(DisplayLab) < TextDisplayLab < MenuLab < NavLab < PlayLab`). They install
address-keyed hooks and named stand-ins, run the firmware's own uITRON kernel natively (K-native), and drive the
devices through CPU-store doorbells. Every E143 address the lab names goes through `A()` (`src/fw/model.mjs`), which
translates it to the running model's build (`src/fw/ports.mjs`, written by `bin/port.mjs`).

`Player` / `PlaySession` (`src/lab/player.mjs`, `src/lab/play.mjs`) turn inputs into lab operations. One router
(`PlayApi`, `src/lab/playapi.mjs`) serves a node host (an HTTP main thread plus a `worker_threads` lab running
`Player.run`, `host/`) and a browser host (a page plus a module Worker running an async driver, `web/`). A JSON-lines
debug protocol (`src/debug/`) serves `bin/debug.mjs`.

Verification has three parts: emu's own regression reference (`bin/golden.mjs`, `golden.json`: every scenario reduced
to screen, devices, stops and harness layers), the checks judged on their own exit status (`bin/checks.mjs`,
`checks/runs.json`), and the unit and regression suites with their fixtures (`test/`, the ISA vectors in
`test/fixtures/`, the checks' pinned data in `checks/fixtures/`). `bench`, `snapgate` and `webgate` compare a run
with itself (slicing, snapshot detours, the browser Worker against node).

```
hosts    web/  page.mjs <-> worker.mjs + Driver      host/  playcli (HTTP) <-> labworker (Player.run)      bin/debug (CLI, JSON-lines)
           |                                           |                                                    |
app      Player / PlaySession  ---- PlayApi (shared router) ----                                debug/Protocol -> Debugger
           |
labs     PlayLab < NavLab < MenuLab < TextDisplayLab < GuiMixin(DisplayLab) < DisplayLab < OsdLab < HLE
           |   hooks Map<rtaddr,[fn,name]>, stand-ins, Kernel/NativeKernel, rtos, irq, doorbell stubs; A() per model
harness  Simulator  (in-process gdbstub text: 'g'/'G'/'c'/'s'; Stats + HarnessDigest)
           |
machine  createMachine(): board address map, device wiring, cont/resume/step, snapshot/restore, generation guard
           |
core     cpu.mjs (R, S, step)   interp.mjs (decode cache, run, TB-look irq timing)   mem.mjs (page tables, buffer, DIRTY)
dev      intc  timer(+Clock)  vsc/vsccompose  engine  bus  stub  scpu   (debug windows + doorbell MMIO in guest space)
support  fw/ (olyfw, labfw, models, ports, xmap, facts, board)   util/ (bytes, hex, show, equal, parse, tally, tracejson)   trace/   debug/
verify   test/ (bin/test.mjs, bin/test-pure.mjs, fixtures/)   checks/ (runs.json, fixtures/)   scenarios/   golden.json   bin/*gate
```

## Design rules

- **Unported paths throw.** A device or harness path that is not modelled throws `Unported`
  with its source name. Devices log, write stderr and raise BUS on unknown widths, offsets or values instead of
  returning 0. Behaviour without firmware evidence is reported as an error or a fault, never guessed.
- **References stay independent.** The checks' references (`refs/`: the menu reference, font, settings, the OSD
  bitmap encoder and raster, the MT19937 generator with CPython-compatible seeding, the reference compositor, the
  ISA-manual expectations) import only `refs/`, and `src/` and `scenarios/` import neither `refs/` nor `checks/`
  (`test/test_pure.mjs` enforces both). A reference takes the lab's data modules (`src/lab/menudata.mjs`,
  `src/lab/resources.mjs`) as arguments, so it does not share the lab's code path.
- **No firmware and no run output is committed.** Firmware images, unpacked blocks, traces, device vectors and frames
  live outside git or under `emu/out/` (gitignored), or as sha256 manifests. What is committed from the firmware is
  small and derived: the register and name table `checks/fixtures/om1-vsc-regs.h`, the digests and short observations
  of `checks/fixtures/` and `golden.json`. The replayed scenarios' inputs (`scenarios/calls/`) carry call arguments
  only; the osd scenario's, which carry memory copied out of the image, are generated at run time. The browser player
  takes the firmware only from the user's own file.
- **The tooling fails loudly.** It fails on a missing scenario or input file, a stale trace, a format mismatch and an
  empty comparison, and every gate has negative controls that show it would catch a planted error.

## Ground truth

In order of authority:

1. **The firmware's own code, executed natively.** Wherever emu runs firmware code instead of a stand-in, the firmware
   decides. Every stand-in removed moves the lab closer to it.
2. **Silicon documentation.** The MN103 ISA manual (`BLOBS.md` says where to get it), the UDF spec
   (`docs/om1-udf-spec.md`) and the 5,311 ISA vectors in `test/fixtures/isa_vectors.json` (3,392 from GDB 15.2's
   `sim/mn10300`, 468 from that simulator corrected per the manual, 728 from the manual, 723 from the UDF spec). Where
   emu's model chooses something the manual does not say (TB-layout interrupt looks, undefined-flag tracking, faults on
   undefined results), the manual wins and the choice is recorded as an assumption.
3. **Camera observations.** Photos or HDMI captures of the rear screen and EVF, settings read back from a camera,
   timings measured on one. Nothing in the repository uses one yet; `docs/ROADMAP.md` "Hardware validation" lists the
   items they would settle.
4. **emu's recorded outputs** (`golden.json`, `checks/fixtures/`): regression baselines. They say what the lab did
   when they were recorded, so an unintended change is caught; they are not a specification. A change grounded in 1-3
   updates them with its reason (README.md "Tests").

## Strengths to keep

- **Memory fast path.** 64 KiB page tables (`RP` / `WP`) cover 4 GiB with one lookup per access. RAM write entry is
  enabled lazily. MMIO trace, watchpoints and the stub live only on the slow path (a watch demotes its page), so a
  disabled feature costs nothing on the hot path (`src/core/mem.mjs`).
- **Proportional reset and snapshot cost.** `DIRTY` tracking makes reset and snapshot scale with what was written
  (`src/core/mem.mjs`).
- **Self-modifying code and the decode cache.** Self-modifying code is invalidated by physical offset in 256-byte
  chunks with bounded swap-remove reverse lists, which makes the `0x6` / `0xA` DRAM aliases correct by construction.
  The decode cache is structure-of-arrays typed arrays (monomorphic, GC-free), and `CODEPG` keeps non-code writes fast
  (`src/core/interp.mjs`).
- **Precise faults.** Every instruction completes all its memory accesses before it writes registers, with a defined
  count rule, so the state after a fault is well defined and a retry is reliable (`src/core/cpu.mjs`). A 400,000-state
  `step()` against `run(1)` differential found no divergence and caught an injected mutant (`test/test_core.mjs`).
- **Sliced execution.** Budgeted `cont` / `resume` / `abort` give the same interrupt looks and stop points as one
  unsliced continue, the right base for a synchronous emulator inside event-loop hosts (`src/machine.mjs`).
- **Fail-loud lifecycle.** Generation, `live()`, a sticky HostStopped and `notPaused` guards still allow post-mortem
  reads (`src/machine.mjs`, `src/dev/intc.mjs`, `src/dev/vsc.mjs`).
- **Determinism.** `src/core`, `src/dev` and `src/machine.mjs` use no host time or randomness apart from the stats
  clock. Wall time enters only through injected clocks for stats and pacing. Checks draw from a seeded MT19937 with
  CPython-compatible seeding and draws (`refs/mt19937.mjs`). IRQs are a synchronous level model with an idempotent
  `setLine`. Session logs record `lab_ns` per input, and `--replay` turns idle off and replays by lab time
  (`src/lab/player.mjs`).
- **Clock model.** The lab clock is a pull-based discrete-event model (`next` / `fire` / `publish`) in integer ns with
  an "event in the past" assertion (`src/dev/timer.mjs`).
- **Reflective device snapshots.** New fields are covered automatically, unknown class instances are refused with a
  field path, and restore writes in place so external references stay valid (`src/debug/snapshot.mjs`).
- **Narrow device interface.** `{read, write, romdWrite, fetch, dbgRead, dbgWrite}` plus a BUS sentinel turned into a
  CPU fault. DMA goes through the bus's span checks with `markDirty` / `invalidateRange` (`src/dev/bus.mjs`).
- **HLE division of labour.** Firmware code runs natively (the uITRON kernel, the GUI tasks, the camera application,
  the OSD and VSC drivers, the settings store), and JS supplies named stand-ins and observers at the edges. Assumptions
  are checked against the image at install time (`is_call_to`, byte signatures, post-boot IVAR and KCB checks;
  `src/lab/play.mjs`, `src/lab/kernel.mjs`), and model facts are read from each firmware by rules (`src/fw/facts.mjs`).
- **Worker safety by injection.** `rom`, `createHash`, `clock` and `writeOutputs` arrive through `env`, and
  `test_pure` enforces purity on `src`, `scenarios`, `refs` and `web`. The container reader takes `read(offset, len)` and
  streams a 240 MB `.BIN`; the browser verifies the checksums and the model's digests and revalidates its OPFS cache
  (`src/fw/olyfw.mjs`, `src/fw/labfw.mjs`, `web/opfs.mjs`).
- **Transport-agnostic interfaces.** `PlayApi.handle(req)` serves both node HTTP and the browser Worker. The debug
  `Protocol` is transport-free JSON with typed errors that do not end the session, and trace-file switching is
  transactional (`src/debug/protocol.mjs`).
- **Host threading.** The node host keeps HTTP on the main thread and the lab in a worker, with SharedArrayBuffer flags
  and zero-copy frame transfer; the browser has one-frame-in-flight acknowledgement backpressure (`host/labworker.mjs`,
  `web/worker.mjs`).
- **Non-perturbing debugger.** `Debugger.attach` bypasses the Simulator's packet accounting, so attaching never
  perturbs Stats or the harness digests (`src/debug/debugger.mjs`).

## Open findings

An architecture review listed the findings below, numbered F01-F40 and C01-C05 (`docs/ROADMAP.md` cites them by number);
three findings about verification code that has since been removed (F33-F35) are left out. The work on the open ones is
planned in `docs/ROADMAP.md` "Emulator architecture".

| Finding | Status |
|---|---|
| F01 CPU, interpreter and memory are realm singletons | open, conditional: one machine per realm suffices today |
| F02 the lab drives the machine through gdbstub text, and the harness digests hash that traffic | open: a typed machine port is roadmap phase 2 |
| F03 interrupt delivery follows a TB-layout look model, not instruction boundaries | defect fixed (an undecidable case no longer kills the machine); the look model itself is phase 3 |
| F04 harness device commands travel through a single-stepped guest store | open, phase 2 |
| F05 device configuration lives in debug-window bytes without write notification | open: rebase a running VSC channel when `LINE_NS` changes |
| F06 the machine owns no simulated time; the lab clock moves only through VSC doorbells | open, phase 4 |
| F07 the product runtime reproduces CPython, glibc and http.server behaviour | fixed: plain JS values throughout (`src/util/py*` is gone, `test/test_pure.mjs` keeps it so), plain JSON on the HTTP API and in the session logs, node's own errors and stacks |
| F08 the checks report bare boolean predicates (`checks/lib/pred.mjs`) | open, phase 2: structured `eq(got, want)` results |
| F09 no firmware-free test tier | fixed: `bin/test-pure.mjs` |
| F10 hosts classify errors as "lab error or crash" | fixed: the browser Worker fails the session on `Unported` / `HostStopped` and a restart recovers |
| F11 firmware facts are literals spread across modules; node entry points did not validate the image | fixed: node loads refuse an image that is not the model's; facts are read by rules (`src/fw/facts.mjs`) |
| F12 hooks are a flat address-keyed Map any layer rewrites | partly fixed (`hook()` refuses the wrong address notation; `wrap()`); an owner-aware registry is phase 2 |
| F13 every entry point hand-builds an untyped env bag | open, phase 2 |
| F14 one Player, two loop shapes, with hosts reaching into Player internals | open, conditional |
| F15 dependency direction is unconstrained and inverted in places | open, conditional |
| F16 instruction semantics are implemented twice, with hand-maintained derived lists | partly fixed: `test/test_core.mjs` runs the two in lockstep and checks the length and transfer tables |
| F17 lab features form an eight-class inheritance chain | signature drift fixed; composition instead of the chain is phase 2 |
| F18 negative-control mutants are compiled into product code | open, phase 2 |
| F19 machine options travel through a realm-global array and import side effects | partly fixed: the Simulator passes `env.machine` (`mutant`, `oneInsn`) to `createMachine` and `OM_MACHINE` is parsed at first use; the options still travel in the untyped env bag (F13) |
| F20 board and SoC constants are hard-coded across core, memory and interpreter | largely addressed by the multi-model work: per-model boards (`src/fw/board.mjs`) and address tables (`src/fw/ports.mjs`) |
| F21 devices self-register into the global address table; the lab stub is special-cased | open, conditional |
| F22 the debug-window and doorbell ABI is defined on both the device and the harness side | open, phase 2 |
| F23 no single owner of machine state | open, conditional |
| F24 snapshots are live object graphs; lab sessions have no checkpoints | open: measure start-up cost first |
| F25 every snapshot copies the ROM view and all eagerly dirtied windows | open, conditional |
| F26 the only instruction clock is a register the harness rewrites | open, phase 4 |
| F27 one device interrupt can be delivered by two different mechanisms | open, phase 4 (native delivery) |
| F28 the decode cache helps only inlined forms | open: measure first |
| F29 error classification uses several overlapping mechanisms | fixed (`FirmwareError` is a `RuntimeError`; the class tree is tested) |
| F30 status, frame and log synchronisation is implemented twice | open, conditional |
| F31 the debug API cannot attach to a running session | open: `docs/ROADMAP.md` "Debug API follow-ups" |
| F32 a tick or continue cannot be cancelled from inside | open, conditional |
| F36 harness-owned guest memory is scattered constants with no guards | depth guard added; the scratch layout is unchanged |
| F37 VSC register tables load lazily from fixed image offsets | comment fixed; open, conditional |
| F38 IRQ line updates are mixed into view publication | open, conditional |
| F39 scenario runner and play workload exist in both `bin/` and `web/` | open, conditional |
| F40 the checks and gates hard-code Linux facilities | open, phase 2 |
| C01 the CPU stops on every exceptional event and has no architectural exception path | open, phase 3 (strictness faults, exception entry) |
| C02 the SoC has four CPUs; emu structurally has one | open: CPU 2 and CPU 3 are served by stand-ins at single call sites |
| C03 no hardware anchor below the ISA level | open, phase 5 (camera evidence) |
| C04 K-native runs firmware task bodies on harness stacks, outside kernel scheduling | open, phase 4 (DISPLAY as a kernel task) |
| C05 no standard reverse-engineering endpoint | open: an RSP endpoint only if someone needs gdb |
| N1 `PlaySession.trim` cut the interrupt controller's log while the kernel still indexed it | fixed |
