// The OM-Emu board and its debugger API. The API follows the GDB remote protocol's packets: registers 'g'/'G',
// breakpoints Z0/z0, continue 'c' (main-loop visits, interrupt acceptance before the breakpoint check), single step
// 's' (no breakpoint, no interrupt), debugger memory 'm'/'M'. One machine per realm: createMachine() replaces the
// previous one, whose object then refuses every call.
import { BOARD, boardKnows } from './fw/board.mjs';
import { IMAGE_BASE } from './fw/model.mjs';
import * as mem from './core/mem.mjs';
import { Fault, Unported, TbUndecidable, K_RAM, K_ROM, K_ROMD, K_MMIO, BUS, addRegion, allocWindow } from './core/mem.mjs';
import { R, S, PC, PSW, UNDEF, HAZ, HI, UC, UD, UV, resetCpu, execInterrupt, getRegs, setRegs, limitFault, trapLines, admits, setExecTrace, setCoverage } from './core/cpu.mjs';
import { run, resetInterp, configureInterp, setBreakpoints, setWatch, windowRemapped, stepAny, setForceHelper, flushDecode, interpState, setInterpState, RUN_VISIT, RUN_LIMIT, RUN_FAULT, RUN_BP } from './core/interp.mjs';
import { Intc, setIrqTrace } from './dev/intc.mjs';
import { snapshotDevices, restoreDevices, devicesBytes } from './debug/snapshot.mjs';
import { Clock, Timer } from './dev/timer.mjs';
import { Vsc } from './dev/vsc.mjs';
import { Bus } from './dev/bus.mjs';
import { Engine } from './dev/engine.mjs';
import { Stub } from './dev/stub.mjs';
import { Scpu } from './dev/scpu.mjs';
import { Hdmi } from './dev/hdmi.mjs';
import { LinkPins } from './dev/linkpins.mjs';
import { LensSsc } from './dev/lensssc.mjs';
import { DpcTriggers } from './dev/dpc.mjs';

export { Unported, TbUndecidable };
export class HostStopped extends Error {       // a run or write call after a host error stopped the machine mid-instruction
  constructor(what, cause) { super(`${what}: the machine stopped on a host error (${cause.name}: ${cause.message.split('\n')[0]})`); this.name = 'HostStopped'; this.cause = cause; }
}
export class Aborted extends Error {           // any call on a machine after abort() ended its paused continue
  constructor() { super('machine aborted (abort() ended its paused continue)'); this.name = 'Aborted'; }
}
export class RspError extends Error {          // the debug stub's error reply (E14, E22)
  constructor(code) { super(code); this.code = code; this.name = 'RspError'; }
}
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const HLE_BASE = 0x89A30000, HLE_SIZE = 0x4000, HLE_MAGIC = 0x31454C48;
// the lab's doorbell of the SCPU interface (src/dev/scpu.mjs): the input levels of its ports
export const SCPU_DOORBELL = 0x89A40000;
// the HDMI port's lab window (the sink's EDID) and doorbell (the cable), with the hdmi option (src/dev/hdmi.mjs)
export const HDMI_WINDOW = 0x89A50000, HDMI_DOORBELL = 0x89A51000;
let generation = 0;
const LONG_CONT = 50000;
// The creation registry (src/debug/, the trace and snapshot gates): every function registered here is called with each
// new machine at the end of createMachine. Returns the function that unregisters it.
const ON_MACHINE = [];
export function onMachine(fn) {
  ON_MACHINE.push(fn);
  return () => { const i = ON_MACHINE.indexOf(fn); if (i >= 0) ON_MACHINE.splice(i, 1); };
}

// options: mutant (a negative control: check_irq's 20..31 in the CPU, INTC and timer, check_perf's 1 to 9 in the
// interpreter; 0 none), oneInsn (the one-instruction mode: one instruction per TB), keepStderr (keep
// every stderr line: MenuLab.scpu_commands reads it whole; default a 2,000-line ring), coverage (an execution-coverage
// collector, bin/fwmap.mjs cover: its mark(pc) is called with the pc of every instruction the CPU runs, at least once
// each, and HLE calls its stub(pc, name) for every stand-in that fires; null, the default: none, and nothing changes),
// hdmi (the HDMI port's transmitter, its hot-plug pin and the sink, src/dev/hdmi.mjs; false, the default: none, and
// their addresses stay the lab stub's).
export const WATCH_LOG_MAX = 200000;
export function createMachine({ rom, dramBytes = BOARD.dram_size, insnLimit = 1000000, clock = () => performance.now(), mutant = 0, oneInsn = false, keepStderr = false, coverage = null, hdmi = false } = {}) {
  if (dramBytes > mem.DRAM_MAX || dramBytes < 64 << 20) throw new Error(`om-emu: DRAM must be 64..${mem.DRAM_MAX >> 20} MiB`);
  const myGen = ++generation;
  const tCreate = clock();
  mem.initMemory(dramBytes);
  resetCpu(insnLimit);
  resetInterp();
  S.mutant = mutant | 0;
  S.vectorPage = BOARD.vector_page;              // the board's interrupt vectors' page (src/fw/board.mjs)
  configureInterp({ mutant, oneInsn });
  setCoverage(coverage === null ? null : coverage.mark);
  const stderrLines = [];
  let stderrBase = 0;                           // global index of stderrLines[0] (older lines are dropped)
  // guestMs: time inside cont/step, the OSD engine's synchronous command execution (engineMs) and the VSC's COMPOSE
  // (composeMs, inside the doorbell store's step) included; long*: the
  // continues of LONG_CONT instructions or more; createMs: this createMachine call.
  const stats = { insns: 0, guestMs: 0, engineMs: 0, composeMs: 0, conts: 0, steps: 0, longInsns: 0, longMs: 0, longEngineMs: 0, createMs: 0 };
  const m = {
    gen: myGen, clock, stats, mutant: mutant | 0, oneInsn: !!oneInsn,
    stderr(line) { stderrLines.push(line); if (!keepStderr && stderrLines.length > 2000) { stderrLines.splice(0, 1000); stderrBase += 1000; } },
    stderrCount() { return stderrBase + stderrLines.length; },
    // The device and trap lines from global index k on (test aid: the lines between two device-vector snapshots).
    stderrSince(k) {
      if (k < stderrBase) throw new Error(`stderrSince(${k}): lines before ${stderrBase} were dropped`);
      return stderrLines.slice(k - stderrBase);
    },
    // The lines kept from index k on: {first (the index of the first one: k, or the oldest kept line when the ring
    // dropped lines past k), lines}.
    stderrFrom(k) {
      const first = Math.max(k, stderrBase);
      return { first, lines: stderrLines.slice(first - stderrBase) };
    },
  };
  mem.ctx.pc = () => R[PC] >>> 0;
  mem.ctx.insns = () => S.insns;
  // the debug hooks start off (mem.initMemory, resetCpu, resetInterp and the Intc constructor reset theirs)
  let inCont = false;                           // inside a continue: a stopping watchpoint ends it (S.kick)
  let lastStop = null;                          // the last run's end: {kind: 'break'|'fault'|'limit'|'paused'|'watch'|'undecidable', code}
  let lastWatch = null;                         // the watchpoint hit that ended the last run (watchHit)
  // The watch log keeps the newest hits: at WATCH_LOG_MAX entries the oldest half is dropped and counted (a log
  // watchpoint on a hot address fills millions a second; an unbounded log ran node out of heap).
  let watchLog = [], watchDropped = 0;
  const logHit = (rec) => {
    watchLog.push(rec);
    if (watchLog.length >= WATCH_LOG_MAX) { watchLog.splice(0, WATCH_LOG_MAX / 2); watchDropped += WATCH_LOG_MAX / 2; }
  };
  // A single step that hits a watchpoint leaves a debug stop pending (the step itself reported the stop): the next step
  // or continue stops at once without executing anything.
  let pendingDebug = false;
  const watchHooks = { stop() { if (inCont) S.kick = true; }, log: logHit };
  // memory
  addRegion({ base: 0x50000000, size: mem.ROM_SIZE, kind: K_ROM, off: mem.ROM_OFF, name: 'om1.code' });
  addRegion({ base: 0x60000000, size: dramBytes, kind: K_RAM, off: mem.DRAM_OFF, name: 'om1.dram' });
  addRegion({ base: 0xA0000000, size: dramBytes, kind: K_RAM, off: mem.DRAM_OFF, name: 'om1.dram-uncached' });
  addRegion({ base: 0x00000000, size: mem.LOW_SIZE, kind: K_RAM, off: mem.LOW_OFF, name: 'om1.lab-low-ram' });
  addRegion({ base: BOARD.sram, size: BOARD.sram_size, kind: K_RAM, off: allocWindow(BOARD.sram_size), name: `om1.sram-${BOARD.sram.toString(16)}` });
  // the hardware semaphores: one byte register per group, BOARD.isc.stride apart (E143 0x97000000, 0x40)
  const ISC = BOARD.isc.base, ISC_STRIDE = BOARD.isc.stride;
  const isc = new Uint8Array(BOARD.isc.groups);
  const unknown = (dev, kind, base, off, size, value, dbg) => {
    if (!dbg) m.stderr(`om-emu: ${dev} UNKNOWN ${kind} ${hex8(base + off)} size ${size} value ${hex8(value)} pc ${hex8(R[PC])}`);
    throw BUS;
  };
  addRegion({ base: ISC, size: isc.length * ISC_STRIDE, kind: K_MMIO, name: 'om1.isc-locks', dev: {
    read: (a, w, dbg) => { const off = a - ISC; if (w !== 1 || (off % ISC_STRIDE)) unknown('isc', 'read', ISC, off, w, 0, dbg); return isc[off / ISC_STRIDE]; },
    write: (a, v, w, dbg) => { const off = a - ISC; if (w !== 1 || (off % ISC_STRIDE)) unknown('isc', 'write', ISC, off, w, v, dbg); isc[off / ISC_STRIDE] = v; } } });
  const lclock = new Clock();
  const bus = new Bus(m);
  bus.onRemap = windowRemapped;                // the decode slots of window pcs, the main-loop return (interp.mjs)
  const intc = new Intc(m);
  const scpu = new Scpu(m, lclock, intc, SCPU_DOORBELL);
  const hdmiPort = hdmi ? new Hdmi(m, intc, HDMI_WINDOW, HDMI_DOORBELL) : null;
  // the sub-CPU link's GIO pins, on a board that gives them (src/dev/linkpins.mjs; the lab wires the sub-CPU)
  const linkPins = boardKnows('scpu_link') ? new LinkPins(m, intc, BOARD.scpu_link) : null;
  // the lens mount's controller, the FCS unit's words and the detect pin, and the deferred-call triggers, on a board
  // that gives them (src/dev/lensssc.mjs, src/dev/dpc.mjs; passive until the lab connects a lens or a post writes)
  const lensSsc = boardKnows('lens') ? new LensSsc(m, intc, bus, BOARD.lens) : null;
  const dpc = boardKnows('dpc') ? new DpcTriggers(m, intc, BOARD.dpc) : null;
  const engine = new Engine(m, bus, intc);
  const vsc = new Vsc(m, lclock, intc, bus, rom);
  const timer = new Timer(m, lclock, intc);
  const stub = new Stub(m);
  // every set_irq(true) kicks the CPU (S.kick: the next TB start looks, interp.mjs)
  intc.connect((requested) => { S.irqReq = requested; if (requested) S.kick = true; else S.irqWait = false; });
  S.intc = {
    level: () => intc.irqLevel(R[PC]), accepted: (level, pc, insns) => intc.irqAccepted(level, pc, insns),
    // the kick refusals: would a look at pc take (or wait for) the request, with the gate (or ignoring it)
    admitted: (pc, ignoreGate) => admits(ignoreGate ? intc.levelAny() : intc.irqLevel(pc)),
    gateMode: () => intc.gateMode(),
  };
  let builtins = new Set();                     // the PERF2 builtin pcs the harness's current loop folds (refusal d)
  const hleOff = allocWindow(HLE_SIZE);
  new Uint32Array(mem.buf, hleOff, 1)[0] = HLE_MAGIC;
  addRegion({ base: HLE_BASE, size: HLE_SIZE, kind: K_ROMD, off: hleOff, name: 'om1.lab-hle',
    dev: { romdWrite: (a, v, w) => unknown('hle', 'write', HLE_BASE, a - HLE_BASE, w, v, false) } });
  // the descrambled main code: flash view 0x50000000 and its run-time copy at the model's image base (E143
  // 0x60021020), the whole run-time image (src/fw/expand.mjs, with the reset head's copies past the block)
  const n1 = Math.min(rom.length, mem.ROM_SIZE), copy = mem.DRAM_OFF + (IMAGE_BASE - 0x60000000);
  if (IMAGE_BASE < 0x60000000 || IMAGE_BASE - 0x60000000 + rom.length > dramBytes) throw new Error(`createMachine: the run-time image ${hex8(IMAGE_BASE)}+0x${rom.length.toString(16)} is outside the DRAM 0x60000000+0x${dramBytes.toString(16)}`);
  mem.U8.set(rom.subarray(0, n1), mem.ROM_OFF); mem.markDirty(mem.ROM_OFF, n1);
  mem.U8.set(rom, copy); mem.markDirty(copy, rom.length);
  // The flash library's window (src/fw/board.mjs; E143 has none, its lab never reaches one): RAM holding the part of
  // the main block the boot copies there, which later builds call by address (E147: the image head at 0x3FFDEFE0,
  // a d32 call from flash into it, X; E144: file 0x1681fe0, 6 KiB at 0x47000800, the reset head's copy, D).
  if (BOARD.library) {
    const { base, size, image: [from, len, at] } = BOARD.library, off = allocWindow(size);
    mem.U8.set(rom.subarray(from, Math.min(from + len, rom.length, from + size - at)), off + at); mem.markDirty(off, size);
    addRegion({ base, size, kind: K_RAM, off, name: `om1.on-chip-ram-${base.toString(16)}` });
  }
  // the lab's scratch RAM when the model's firmware uses E143's (src/fw/board.mjs)
  if (BOARD.scratch) {
    const { base, size } = BOARD.scratch;
    addRegion({ base, size, kind: K_RAM, off: allocWindow(size), name: 'om1.lab-scratch' });
  }

  let gen = myGen;
  const live = () => { if (gen !== generation) throw gen === -1 ? new Aborted() : new Error('machine replaced by a newer createMachine()'); };
  let chain = null;                            // a paused continue (cont with a budget)
  // A host error (Unported, a bug: anything but a CPU Fault) thrown inside cont/resume/step leaves the CPU in the middle
  // of an instruction, a state the CPU model cannot resume from. The machine then refuses to run or be written
  // (HostStopped); reads stay allowed for the post-mortem (divergence reports read registers and device state). A
  // TB-layout refusal (TbUndecidable) is thrown at an instruction boundary instead: the continue ends with lastStop
  // kind 'undecidable' and the machine stays runnable; the error still reaches the caller.
  let failed = null;
  const runnable = (what) => { if (failed !== null) throw new HostStopped(what, failed); };
  const budgetOk = (b) => b === Infinity || (Number.isInteger(b) && b >= 1);
  const notPaused = (what) => { if (chain !== null) throw new Error(`${what}: a continue is paused (resume or abort it first)`); };
  // Every CPU fault writes its trap line (after any device line the faulting access wrote).
  const trap = (f) => { for (const line of trapLines(f, R[PC])) m.stderr(line); };
  // The insn limit reached: fault 7, unless the next instruction's code fetch faults first (fault 2, not counted;
  // cpu.mjs limitFault), which the stop then reports.
  const limitStop = () => { const f = limitFault(); trap(f); return f.code === 7 ? { kind: 'limit', code: 7 } : { kind: 'fault', code: f.code }; };
  Object.assign(m, {
    devices: { intc, timer, engine, vsc, bus, stub, scpu, clock: lclock, ...(hdmiPort ? { hdmi: hdmiPort } : {}), ...(linkPins ? { linkpins: linkPins } : {}),
      ...(lensSsc ? { lens: lensSsc } : {}), ...(dpc ? { dpc } : {}) },
    getRegs() { live(); return getRegs(); },
    // 'p' / 'P' (registers 0..15 as cpu.mjs getRegs / setRegs, and the lab registers 16..19: HI, unit C,
    // unit D, unit V); null for a register the stub does not have.
    getReg(n) {
      live();
      if (n < 15) return R[n] >>> 0;
      if (n === 15) return S.insns % 4294967296;
      return n <= 19 ? R[[HI, UC, UD, UV][n - 16]] >>> 0 : null;
    },
    setReg(n, v) {
      live(); runnable('setReg'); notPaused('setReg');
      if (n > 19) return false;
      if (n < 15) {
        R[n] = v | 0;
        if (n === PSW) { R[PSW] &= 0xffff; R[UNDEF] = 0; R[HAZ] = 0; }   // a debugger-written PSW is defined
      } else if (n === 15) S.insns = v >>> 0;
      else R[[HI, UC, UD, UV][n - 16]] = n === 19 ? v & 1 : v | 0;
      return true;
    },
    setRegs(r16) { live(); runnable('setRegs'); notPaused('setRegs'); setRegs(r16); },
    setBreakpoints(pcs) { live(); runnable('setBreakpoints'); notPaused('setBreakpoints'); setBreakpoints(pcs); },
    // The breakpoints that are PERF2 builtin pcs (src/lab/hle.mjs's builtin stubs): an instruction raising a request
    // right before one is refusal (d).
    setBuiltins(pcs) { live(); if (pcs.length || builtins.size) builtins = new Set(pcs); },
    // cont({budget}): a continue that pauses after about `budget` instructions (at the first instruction boundary
    // at or past it, never inside a one-instruction-TB run's visit) and returns 'paused'; resume({budget}) goes on with
    // it and abort() ends it and the machine at once (only a paused continue can be aborted; every later call throws
    // Aborted). budget: a positive integer or Infinity. The run loop is the same: a pause is run()'s budget return,
    // where no main-loop visit is pending (run() returns RUN_VISIT before it tests the budget), so a chain of slices
    // takes exactly the interrupt looks and stops of one unsliced continue. Returns 'stop' when the continue has ended (breakpoint, fault,
    // insn-limit). A chain counts as one continue in stats. While paused only getRegs, dbgRead, resume, halt and abort
    // are allowed: a debugger write could raise a request that would only be seen at the next real 'c' visit.
    cont({ budget = Infinity } = {}) {
      live(); runnable('cont'); notPaused('cont');
      if (!budgetOk(budget)) throw new RangeError(`cont: budget ${budget}: a positive instruction count or Infinity`);
      stats.conts++;
      if (pendingDebug) { pendingDebug = false; lastWatch = null; lastStop = { kind: 'break', code: 0 }; return 'stop'; }
      chain = { i0: S.insns, e0: stats.engineMs, ms: 0 };
      setWatch(intc.gateMode() === 1 ? intc.gatePc() : -1, builtins);    // refusals c and d
      return this._run(budget, true);
    },
    resume({ budget = Infinity } = {}) {
      live(); runnable('resume');
      if (chain === null) throw new Error('resume: no paused continue');
      if (!budgetOk(budget)) throw new RangeError(`resume: budget ${budget}: a positive instruction count or Infinity`);
      return this._run(budget, false);
    },
    abort() {
      live();
      if (chain === null) throw new Error('abort: no paused continue');
      chain = null; gen = -1;                  // every later call, resume included, throws Aborted
    },
    // halt(): ends a paused continue where it paused, leaving the machine runnable (lastStop kind 'halt'). The pause is
    // an instruction boundary with no main-loop visit pending, so the machine stands as after a breakpoint stop there:
    // the next continue visits first.
    halt() {
      live();
      if (chain === null) throw new Error('halt: no paused continue');
      this._endChain();
      lastStop = { kind: 'halt', code: 0 };
    },
    paused() { return chain !== null; },
    // The debug stop a single step's watchpoint hit left pending (pendingDebug), dropped: the caller reported the hit
    // itself (src/lab/sim.mjs's live debugger), so the next step or continue runs.
    dropPendingStop() { live(); pendingDebug = false; },
    _run(budget, visit) {
      const t0 = clock();
      let result = 'stop';
      lastWatch = null; mem.clearWatchHit();
      inCont = true;
      try {
        for (;;) {
          if (visit && S.irqReq) execInterrupt();
          // a stopping watchpoint hit (a debugger watch, mem.mjs): the continue ends after the accessing instruction,
          // without the main-loop visit, which the next continue makes (cont visits first), as after a breakpoint
          if (mem.WHIT !== null) { result = 'watch'; lastStop = { kind: 'watch', code: 0 }; break; }
          const resumed = !visit;                 // resume(): the paused continue goes on, no visit between
          visit = false;
          const r = run(budget, resumed);
          if (r === RUN_VISIT) { if (mem.WHIT !== null) continue; visit = true; continue; }
          if (r === RUN_LIMIT) {
            if (S.limit && S.insns >= S.limit) lastStop = limitStop();
            else { result = 'paused'; lastStop = { kind: 'paused', code: 0 }; break; }
          } else if (r === RUN_FAULT) { lastStop = { kind: 'fault', code: S.fault.code }; trap(S.fault); }
          else if (r === RUN_BP) lastStop = { kind: 'break', code: 0 };
          break;
        }
      } catch (e) {
        inCont = false;
        if (e instanceof TbUndecidable) { chain.ms += clock() - t0; this._endChain(); lastStop = { kind: 'undecidable', code: 0 }; mem.clearWatchHit(); throw e; }
        if (!(e instanceof Fault)) { chain.ms += clock() - t0; this._endChain(); failed = e; mem.clearWatchHit(); throw e; }
        lastStop = { kind: 'fault', code: e.code };
        trap(e);
      }
      inCont = false;
      if (mem.WHIT !== null) { if (result === 'watch') lastWatch = mem.WHIT; mem.clearWatchHit(); }
      chain.ms += clock() - t0;
      if (result === 'paused') return result;
      this._endChain();
      return result;
    },
    _endChain() {
      const n = S.insns - chain.i0, ms = chain.ms;
      stats.insns += n;
      stats.guestMs += ms;
      if (n >= LONG_CONT) { stats.longInsns += n; stats.longMs += ms; stats.longEngineMs += stats.engineMs - chain.e0; }
      chain = null;
    },
    step() {
      live(); runnable('step'); notPaused('step');
      const t0 = clock(), i0 = S.insns;
      stats.steps++;
      lastWatch = null; mem.clearWatchHit();
      lastStop = { kind: 'break', code: 0 };
      if (pendingDebug) { pendingDebug = false; return; }
      const account = () => { stats.insns += S.insns - i0; stats.guestMs += clock() - t0; };
      if (S.limit && S.insns + 1 > S.limit) lastStop = limitStop();
      else try { stepAny(); } catch (e) {          // (an instruction fetched from MMIO: interp.mjs)
        if (!(e instanceof Fault)) { account(); failed = e; mem.clearWatchHit(); throw e; }
        lastStop = { kind: 'fault', code: e.code };
        trap(e);
      }
      // a watchpoint hit by the stepped instruction is reported (watchHit), with no other effect (no S.kick)
      if (mem.WHIT !== null) { if (lastStop.kind === 'break') { lastWatch = mem.WHIT; lastStop = { kind: 'watch', code: 0 }; pendingDebug = true; } mem.clearWatchHit(); }
      account();
    },
    dbgRead(a, n) {
      live();
      const out = mem.dbgRead(a, n);
      if (out === null) throw new RspError('E14');
      return out;
    },
    dbgWrite(a, bytes) { live(); runnable('dbgWrite'); notPaused('dbgWrite'); mem.dbgWrite(a, bytes); },
    failed() { return failed; },
    stderrTail(size = 600) { const t = stderrLines.join('\n').trim(); return t.slice(Math.max(0, t.length - size)); },

    // ---- the debug API's machine side (src/debug/). Every hook is off at creation and costs nothing while off.
    // The last run's end (cont/resume/step/halt): {kind: 'break' (a breakpoint, or a step that ended normally), 'fault',
    // 'limit' (insn-limit, fault 7), 'paused' (budget), 'watch' (a stopping watchpoint), 'halt' (a paused continue
    // halted), code: the fault code}.
    lastStop() { return lastStop; },
    // Exec trace: fn(pc, op) before each instruction executes. mode 'native': every decoded form runs through the
    // helper (setForceHelper), the interrupt looks unchanged; 'one-insn': every instruction runs as a one-instruction
    // TB: the machine must have been created with oneInsn. null: off.
    setExecTrace(fn, { mode = 'native' } = {}) {
      live(); notPaused('setExecTrace');
      if (fn !== null && mode === 'one-insn' && !this.oneInsn) throw new Error("setExecTrace: mode 'one-insn' needs a machine created with oneInsn");
      if (fn !== null && mode !== 'one-insn' && mode !== 'native') throw new Error(`setExecTrace: mode ${mode}: 'native' or 'one-insn'`);
      setExecTrace(fn);
      setForceHelper(fn !== null && mode === 'native' && !this.oneInsn);
    },
    // MMIO trace: fn(dir 0/1, addr, value, size, name, cpu 0/-1, err) (mem.mjs). null turns it off.
    setMmioTrace(fn) { live(); mem.setMmioTrace(fn); },
    // Interrupt trace: fn(0, irq, level, pc, insns) per presentation, fn(1, level, pc, insns) per acceptance.
    setIrqTrace(fn) { live(); setIrqTrace(fn); },
    // Watchpoints: [{id, lo, hi (exclusive), kind: 1 read, 2 write, 3 access, stop}] (per virtual address; [] clears).
    // A stopping hit inside a continue ends it with 'watch' after the accessing instruction (watchHit()); a logging hit
    // is appended to the watch log (drainWatchLog(), or onLog(record) when given) and changes nothing else.
    setWatchpoints(list, { onLog = null } = {}) {
      live(); notPaused('setWatchpoints');
      for (const r of list) {
        if (!(r.lo >= 0 && r.hi <= 2 ** 32 && r.lo < r.hi) || ![1, 2, 3].includes(r.kind)) throw new RangeError(`setWatchpoints: ${JSON.stringify(r)}: lo < hi within 32 bits, kind 1, 2 or 3`);
      }
      watchHooks.log = onLog ?? logHit;
      mem.setWatchpoints(list, watchHooks);
    },
    watchHit() { return lastWatch; },
    // The oldest limit entries (all by default) taken off the log; watchLogState(): {kept, dropped} (dropped: the hits
    // the cap dropped since the last call, which resets it).
    drainWatchLog(limit = Infinity) {
      if (limit >= watchLog.length) { const out = watchLog; watchLog = []; return out; }
      return watchLog.splice(0, limit);
    },
    watchLogState() { const r = { kept: watchLog.length, dropped: watchDropped }; watchDropped = 0; return r; },
    // Snapshot at a stop (never while a continue is paused, never after a host error): guest memory and the memory
    // tables (mem.mjs), the CPU, the interpreter's TB-start record, every device (src/debug/snapshot.mjs), the ISC
    // locks, the stderr lines, the stats and the builtin pcs. Breakpoints, watchpoints and trace hooks are debugger
    // state and stay as they are; the decode cache is dropped at a restore. A restore also clears a host error that
    // happened after the snapshot (the whole machine state comes back).
    snapshot() {
      live(); notPaused('snapshot');
      if (failed !== null) throw new HostStopped('snapshot', failed);
      const cpuS = {};
      for (const k of Object.keys(S)) if (k !== 'intc') cpuS[k] = S[k];
      return { gen: myGen, mem: mem.memSnapshot(), R: R.slice(), S: cpuS, interp: interpState(),
        devices: snapshotDevices(this.devices, [m, ...Object.values(this.devices), rom], mem.buf),
        isc: isc.slice(), stderrLines: stderrLines.slice(), stderrBase, stats: { ...stats }, builtins: new Set(builtins), pendingDebug };
    },
    restore(snap) {
      live(); notPaused('restore');
      if (snap.gen !== myGen) throw new Error('restore: a snapshot of another machine');
      mem.memRestore(snap.mem);
      R.set(snap.R);
      for (const [k, v] of Object.entries(snap.S)) S[k] = v;
      setInterpState(snap.interp);
      flushDecode();
      restoreDevices(this.devices, snap.devices);
      isc.set(snap.isc);
      stderrLines.length = 0; stderrLines.push(...snap.stderrLines); stderrBase = snap.stderrBase;
      Object.assign(stats, snap.stats);
      builtins = new Set(snap.builtins);
      pendingDebug = snap.pendingDebug;
      failed = null; lastStop = null; lastWatch = null; mem.clearWatchHit();
    },
    snapshotBytes(snap) { return snap.mem.data.length + devicesBytes(snap.devices) + 4 * snap.R.length; },
  });
  stats.createMs = clock() - tCreate;
  for (const fn of ON_MACHINE.slice()) fn(m);
  return m;
}
