// A second MN103 core on the machine's bus (createMachine's cores option, off by default; docs/hle-gaps.md 4.6.1).
// The CPU model is one set of registers (cpu.mjs R, S) and one interpreter (interp.mjs); a core switch saves the
// running core's registers, its fields of S, its interpreter state (breakpoints, TB-start and look records) and its own
// pages, and puts the other core's back:
//   - page 0x0000: each core's system-register page (0x8000..0x8fff: IVAR, GxICR, the core number 0x8050, 0x8070,
//     the halt word 0x8040, IAGR 0x8a00; cores spec 3.2, I); the lab maps the whole 64 KiB page per core (A-COREPAGE);
//   - page 0x5000: the second core's local RAM at 0x50000000 (its early stack 0x500027fc and the 4 KiB window it copies
//     to 0x50002000, cores spec 3.4, I); core 0 keeps the flash view there, as the lab always had it (A-COREPAGE).
// Everything else (DRAM, the on-chip SRAM 0x97f00000, the ISC locks, every device) is one bus both cores share.
// The interrupt controller presents the second core's bank to it (src/dev/intc.mjs enableSecond; H-CPU2GATE: at any
// instruction).
// The interleave (A-INTERLEAVE): core 0 runs as the harness drives it; inside its continues, after every `quantum`
// instructions of core 0 (counted across continues), the second core runs a turn of up to `quantum` instructions. A
// core 2 that halts (a stop at one of its halt pcs) skips its turns until its bank presents an interrupt it admits.
// A core 2 at one of its poll pcs (a loop that only reads the words of a range and does nothing else until they change)
// sleeps the same way, and also wakes when a byte of that range changes, going on from the poll pc (H-CPU2POLL).
// Lab time does not move in a turn (FIDELITY 1.1). The harness talks to core 0 only: every turn ends on core 0.
// A second core's stop at one of its own breakpoints calls the lab's onStop(pc, api), which returns 'go' (the handler
// moved the pc), 'step' (run the instruction at the stop, then go on), or 'park' (with api.park(why): the core runs no
// more; the lab reports it). A fault parks the core with its trap line. Any error the handler throws parks it too, with
// the error kept (problem()), so that a firmware outcome on core 2 never stops core 0 mid-instruction.
import { R, S, PC, PSW, admits, execInterrupt, trapLines } from './cpu.mjs';
import { run, coreInterp, setCoreInterp, setLocalPage, stepAny, RUN_VISIT, RUN_LIMIT, RUN_FAULT, RUN_BP } from './interp.mjs';
import { Fault, K_RAM, U8, addRegion, allocWindow, markDirty, pageState, setPageState, IO, CST, dbgRead, dbgWrite } from './mem.mjs';

const CORE_S = ['insns', 'irqReq', 'irqWait', 'kick', 'exitReq', 'limit', 'fault'];
export const CORE_PAGE = 0x0000, LOCAL_PAGE = 0x5000, CORE_ID = 0x8050;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

class Ctx {
  constructor(n) {
    this.n = n; this.R = new Int32Array(R.length);
    this.S = { insns: 0, irqReq: false, irqWait: false, kick: false, exitReq: false, limit: 0, fault: null };
    this.interp = null; this.pages = new Map(); this.io = { n: -1, pc: 0 };
    this.cst = { n: new Float64Array(32), o: new Int32Array(32), k: 0 };
    this.started = false; this.halted = false; this.parked = null; this.resumable = false;
    this.halts = new Set(); this.stops = []; this.polls = new Map(); this.poll = null; this.pollSeen = new Map();
  }
}

export class Cores {
  constructor(m, intc, { second = 2, quantum = 2000 } = {}) {
    if (!Number.isInteger(quantum) || quantum < 1) throw new RangeError(`cores: quantum ${quantum}: a positive instruction count`);
    this.m = m; this.intc = intc; this.second = second; this.quantum = quantum;
    this.cur = 0; this.q0 = 0; this.interleave = false;
    this.ctx = { 0: new Ctx(0), [second]: new Ctx(second) };
    this.onStop = null;
    this.stats = { turns: 0, insns: 0, switches: 0, halts: 0, wakes: 0, skipped: 0 };
    this.problems = [];
    const c0 = this.ctx[0], c2 = this.ctx[second];
    for (const p of [CORE_PAGE, LOCAL_PAGE]) c0.pages.set(p, pageState(p));
    // the second core's own pages: RAM, zero but for its core number (the hardware's register, which no code writes,
    // cores spec 2; A-COREID)
    for (const [p, name] of [[CORE_PAGE, `om1.cpu${second}-sysregs`], [LOCAL_PAGE, `om1.cpu${second}-local-ram`]]) {
      const keep = pageState(p), off = allocWindow(0x10000);
      setPageState(p, { list: null, rp: -1, wp: -1, wpl: -1 });
      addRegion({ base: p * 0x10000, size: 0x10000, kind: K_RAM, off, name });
      c2.pages.set(p, pageState(p));
      setPageState(p, keep);
      if (p === CORE_PAGE) { U8[off + CORE_ID] = second; markDirty(off, 0x10000); }
    }
    setLocalPage(LOCAL_PAGE);
    intc.setIrq = (req) => this._request(0, req);
    intc.enableSecond(second, (req) => this._request(second, req));
  }
  // a core's request line (the controller's callbacks): the running core's S, else its saved fields
  _request(n, req) {
    const s = this.cur === n ? S : this.ctx[n].S;
    s.irqReq = req;
    if (req) s.kick = true; else s.irqWait = false;
  }
  select(n) {
    if (n === this.cur) return;
    const from = this.ctx[this.cur], to = this.ctx[n];
    from.R.set(R);
    for (const k of CORE_S) from.S[k] = S[k];
    from.interp = coreInterp();
    for (const p of from.pages.keys()) from.pages.set(p, pageState(p));
    from.io.n = IO.n; from.io.pc = IO.pc;
    from.cst.n.set(CST.n); from.cst.o.set(CST.o); from.cst.k = CST.k;
    R.set(to.R);
    for (const k of CORE_S) S[k] = to.S[k];
    setCoreInterp(to.interp);
    for (const [p, st] of to.pages) setPageState(p, st);
    IO.n = to.io.n; IO.pc = to.io.pc;
    CST.n.set(to.cst.n); CST.o.set(to.cst.o); CST.k = to.cst.k;
    this.intc.cur = n;
    this.cur = n;
    this.stats.switches += 1;
  }
  // The second core out of reset at pc with psw (A-CPU2RESET: every other register 0), its stops and halt pcs.
  // polls: [[pc, address, length]]
  start(pc, psw, { stops = [], halts = [], polls = [] } = {}) {
    const c = this.ctx[this.second];
    if (c.started) throw new Error(`cores: core ${this.second} already started`);
    c.R.fill(0); c.R[PC] = pc | 0; c.R[PSW] = psw & 0xffff;
    c.halts = new Set(halts.map((x) => x >>> 0)); c.stops = stops.map((x) => x >>> 0);
    c.polls = new Map(polls.map(([p, a, n]) => [p >>> 0, [a >>> 0, n]]));
    c.interp = { bp: [...c.stops, ...c.halts, ...c.polls.keys()], watch: -1, builtin: new Set(), tbPc: pc | 0, tbAt: 0, tbStart: 0, lookedPc: -1, lookedN: -1 };
    c.started = true;
  }
  // More stops for the second core (the lab's hooks after its bring-up); while it does not run, so in its saved state.
  addStops(pcs) {
    const c = this.ctx[this.second];
    if (this.cur === this.second) throw new Error('cores: addStops while core 2 runs');
    for (const pc of pcs) if (!c.stops.includes(pc >>> 0)) c.stops.push(pc >>> 0);
    c.interp.bp = [...c.stops, ...c.halts, ...c.polls.keys()];
  }
  state() {
    const c = this.ctx[this.second], r = this.cur === this.second ? R : c.R, s = this.cur === this.second ? S : c.S;
    return { started: c.started, halted: c.halted, polling: c.poll !== null, parked: c.parked, pc: r[PC] >>> 0, psw: r[PSW] & 0xffff, insns: s.insns,
      irqReq: s.irqReq, interleave: this.interleave, quantum: this.quantum, ...this.stats };
  }
  regs() { const c = this.ctx[this.second]; return this.cur === this.second ? R : c.R; }
  problem() { return this.problems.length ? this.problems[0] : null; }
  // the polled range changed since the core began to sleep on it
  _polled(c) {
    if (c.poll === null) return false;
    const b = dbgRead(c.poll.addr, c.poll.bytes.length);
    for (let i = 0; i < b.length; i++) if (b[i] !== c.poll.bytes[i]) return true;
    return false;
  }
  // would a turn run the second core (started, not parked, awake or with a reason to wake)
  runnable() {
    const c = this.ctx[this.second];
    return c.started && !c.parked && (!c.halted || c.S.irqReq || this._polled(c));
  }
  // core 0's run (machine.mjs _run): run() in slices of the quantum, with a turn of the second core after each
  run0(budget, resumed) {
    for (;;) {
      if (!this.interleave) return run(budget, resumed);
      const slice = Math.min(budget, Math.max(1, this.quantum - this.q0)), i0 = S.insns;
      const r = run(slice, resumed);
      const n = S.insns - i0;
      this.q0 += n;
      if (r !== RUN_LIMIT || (S.limit && S.insns >= S.limit)) return r;
      if (this.q0 >= this.quantum) { this.q0 = 0; this.turn(this.quantum); }
      if (n >= budget) return r;
      budget -= n; resumed = true;
    }
  }
  // One turn of the second core: up to budget instructions, ending at its stop, halt, fault or park. Returns
  // {kind: 'limit' | 'halt' | 'halted' (asleep, skipped) | 'parked' | 'idle' (not started), pc}.
  turn(budget) {
    const c = this.ctx[this.second];
    if (!c.started) return { kind: 'idle' };
    if (c.parked) return { kind: 'parked', pc: c.R[PC] >>> 0 };
    if (c.halted && !c.S.irqReq && !this._polled(c)) { this.stats.skipped += 1; return { kind: 'halted', pc: c.R[PC] >>> 0 }; }
    this.select(this.second);
    this.stats.turns += 1;
    const i0 = S.insns;
    try { return this._turn(c, budget); }
    finally { this.stats.insns += S.insns - i0; this.select(0); }
  }
  _turn(c, budget) {
    let visit = !c.resumable, resumed = c.resumable, used = 0;
    c.resumable = false;
    const api = this._api(c);
    if (c.halted) {
      const irq = admits(this.intc.irqLevel(R[PC])), changed = !irq && this._polled(c);
      if (!irq && !changed) { this.stats.skipped += 1; return { kind: 'halted', pc: R[PC] >>> 0 }; }
      c.halted = false; c.poll = null; visit = irq; resumed = false; this.stats.wakes += 1;
      if (changed) {                                         // go on from the poll pc: off its breakpoint by a step
        try { stepAny(); } catch (e) { if (!(e instanceof Fault)) throw e; return this._fault(c, e); }
        used += 1; visit = true;
      }
    }
    for (;;) {
      let r;
      try {
        if (visit && S.irqReq) execInterrupt();
        visit = false;
        const i0 = S.insns;
        r = run(Math.max(0, budget - used), resumed);
        used += S.insns - i0;
        resumed = false;
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
        return this._fault(c, e);
      }
      if (r === RUN_VISIT) { visit = true; if (used >= budget) return { kind: 'limit', pc: R[PC] >>> 0 }; continue; }
      if (r === RUN_LIMIT) { c.resumable = true; return { kind: 'limit', pc: R[PC] >>> 0 }; }
      if (r === RUN_FAULT) return this._fault(c, S.fault);
      // RUN_BP
      const pc = R[PC] >>> 0;
      if (c.halts.has(pc)) { c.halted = true; this.stats.halts += 1; return { kind: 'halt', pc }; }
      const pl = c.polls.get(pc);
      if (pl !== undefined) {
        // the range as the last pass left it: one more pass would do the same, so the core sleeps; else it goes on
        const bytes = dbgRead(pl[0], pl[1]), last = c.pollSeen.get(pc);
        if (bytes === null) throw new Error(`cores: the poll range ${h8(pl[0])}+${pl[1]} is not readable`);
        if (last !== undefined && last.every((v, i) => v === bytes[i])) {
          c.poll = { addr: pl[0], bytes }; c.halted = true; this.stats.halts += 1;
          return { kind: 'halt', pc, poll: true };
        }
        c.pollSeen.set(pc, bytes);
        try { stepAny(); } catch (e) { if (!(e instanceof Fault)) throw e; return this._fault(c, e); }
        used += 1; visit = true; continue;
      }
      let act;
      try { act = this.onStop ? this.onStop(pc, api) : 'park'; } catch (e) {
        this.problems.push(e); c.parked = `core ${this.second} at ${h8(pc)}: ${e.message}`;
        return { kind: 'parked', pc };
      }
      if (act === 'go') { visit = true; continue; }
      if (act === 'step') {
        try { stepAny(); } catch (e) { if (!(e instanceof Fault)) throw e; return this._fault(c, e); }
        used += 1; visit = true; continue;
      }
      if (act !== 'park') throw new Error(`cores: onStop returned ${act}`);
      if (!c.parked) c.parked = `core ${this.second} stopped at ${h8(pc)} (no handler)`;
      return { kind: 'parked', pc };
    }
  }
  _fault(c, f) {
    const lines = trapLines(f, R[PC]).map((l) => l.replace(/^om-emu: /, `om-emu: cpu${this.second} `));
    for (const l of lines) this.m.stderr(l);
    c.parked = `core ${this.second} fault ${f.code} at ${h8(R[PC])} address ${h8(f.addr)}`;
    this.problems.push(new Error(c.parked));
    return { kind: 'parked', pc: R[PC] >>> 0, fault: f.code };
  }
  // what a stop handler sees: the running core's registers and the bus (debugger accesses: no device side effects on
  // a read of RAM; a device read is the device's debugger read)
  _api(c) {
    const self = this;
    return {
      core: this.second, R,
      read(a, n) { const b = dbgRead(a >>> 0, n); if (b === null) throw new Error(`cores: debugger read ${h8(a)}+${n} failed`); return b; },
      u32(a) { const b = this.read(a, 4); return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; },
      write(a, bytes) { dbgWrite(a >>> 0, bytes); },
      park(why) { c.parked = why; self.problems.push(new Error(why)); return 'park'; },
      insns() { return S.insns; },
    };
  }
}
