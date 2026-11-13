// The live route of the debug API (F31): debug inputs on a running play session's own input queue, {type: 'debug',
// op, id?, ...} with the JSON-lines protocol's fields (protocol.mjs), each answered with that protocol's response
// object ({id, ok, ...}; the Player's result carries it as `debug`). The Player (src/lab/player.mjs) hands them here
// between ticks; the session must have been started with --debug-api (the tokens' rule), and nothing of this module
// runs until the first one arrives, so an unused route changes nothing. The debugger is Debugger.attach(lab.sim, {lab,
// routed}) on the session's lab, made again for each new session (a restart, a power on: its breakpoints,
// watchpoints and traces are gone with the old session).
//
// States: running (the session ticks as ever), halted (paused between ticks: only debug inputs and controls run, the
// other inputs wait in the queue in their order) and stopped (held at a debug stop inside a tick: a breakpoint the
// harness did not set, or a stopping watchpoint; the Simulator's debug hook, src/lab/sim.mjs, holds the harness's
// continue or step there and this module answers debug inputs until a cont, resume or detach lets it go on).
//   halt                    running: halt at this tick boundary; answers {stop: 'halt', ...} (stopped or halted: the
//                           state's record, nothing changes)
//   cont {stops?, maxMs?}   run on (stops: the breakpoints first, as break); answered at the next debug stop or halt
//                           with {stop: break|watch|halt, regs, watch?, during?, lab_ns, stops, at: run|tick, stderr,
//                           stderrDropped?}; maxMs: halt at the first tick boundary after that much wall time (stop
//                           'halt', reason 'maxMs'). A cont's ?sync=1 wait may time out first: the state op says where
//                           the session is.
//   resume                  run on, answered at once {state: 'running'}
//   step {n?}               at a debug stop only: n single steps (no interrupt accepted), ending early at a fault, a
//                           watchpoint hit or before an instruction at one of the harness's breakpoints (harness:
//                           true; cont then lets the harness take that stop as its own)
//   break {pcs}             the debug breakpoints ([] clears)
//   watch {list}            as the protocol's; stopping entries need a host whose queue blocks (below); the log
//                           entries carry lab_ns and n
//   detach                  breakpoints, watchpoints and traces off, then run on: {state: 'running'}
//   state                   {state, stops, breakpoints, watchpoints, waiting, routed, stop?: the record}
//   tasks                   the kernel's tasks: [{tid, entry (disassembly notation), state, priority, sp (saved),
//                           running}]
//   standins {limit?}       the stand-in log: the last limit (default 100) harness stub calls by name (calls), the
//                           camera application's stand-in actions [kind, detail] (camapp), the stand-ins in use
//   dml                     the DML engine's model (src/dev/dml.mjs, S-DML): {runs, busy, status, dropped, last: the
//                           newest run's register image {n, t_ns, regs: {offset: value}, out: [address, bytes]} or
//                           null}, offsets and values in hex; refused on a board without the engine
//   pdt                     the PDT / TRC unit's model (src/dev/pdt.mjs, S-PDT): per engine (pdt, trc) {runs, busy,
//                           status, dropped, last: the newest run's parameter image {n, t_ns, params: {offset: value},
//                           result: the lab's result words written} or null}, offsets and values in hex; refused on a
//                           board without the unit
//   ems1                    the EMS1 engine's model (src/dev/ems1.mjs, S-EMS1): {runs, busy, status, dropped, last: the
//                           newest run {n, t_ns, start: the start word, channels: their mask, params: {offset:
//                           value}} or null}, offsets and values in hex; refused on a board without the engine
//   call {fn, ...}          a firmware function run natively through the lab's harness, its hooks and stand-ins
//                           answering (src/debug/call.mjs lists the fields, the convention and what is restored);
//                           running or halted only (refused at a debug stop, inside a tick) and with no stopping
//                           watchpoint armed; an error's detail (pc, steps, stubs, reads) rides in error.detail
// and the protocol's reads and the ops that change memory or registers (regs, reg, setReg, setRegs, read, write,
// stack, stderr, stats, disasm, watchLog, trace, lab {time}); load, quit, reset, cpuStore, snapshot, restore, drop,
// abort and lab time moves are refused (protocol.mjs). A control input (restart, power, quit, ...) while stopped lets
// the stop go: the breakpoints and stopping watchpoints are cleared, the tick runs to its end and the control runs in
// its place in the queue; while halted, controls run at once. The host's stop (a signal) does the same.
// routed: a debug stop waits inside the tick for the next input, which needs a blocking queue (the node host's
// PortQueue); on a host whose queue does not block (the browser's Worker, a headless ArrayQueue) break, cont's stops
// and stopping watchpoints are refused, and halt, the reads and log watchpoints remain.
// host: {openSink, disasm, resolvePath} as the protocol's (the node host: host/debughost.mjs); without them trace and
// disasm are refused. Worker-safe.
import { Debugger } from './debugger.mjs';
import { Protocol, BadRequest, outcome, list, addr, count, watchList } from './protocol.mjs';
import { regsHex, hex8 } from './regs.mjs';
import { TCB_SP } from '../lab/kernel.mjs';
import { callSpec, runCall } from './call.mjs';

const RUN_CONTROL = new Set(['state', 'halt', 'cont', 'resume', 'step', 'break', 'watch', 'detach', 'tasks', 'standins', 'dml', 'pdt', 'ems1', 'call']);
const isControl = (inp) => inp !== null && typeof inp === 'object' && inp.type === 'control';
const absent = (v) => v === undefined || v === null;
const hexWatch = (w) => ({ ...w, addr: hex8(w.addr), hit: hex8(w.hit), value: hex8(w.value), pc: hex8(w.pc) });

export class LiveDebug {
  constructor(player, host = {}) {
    this.player = player;
    this.host = host;
    this.lab = null; this.sim = null; this.dbg = null; this.proto = null;
    this.pcs = new Set();            // the debug breakpoints (the Simulator's debug hook reads pcs)
    this.watches = [];               // the watch list as set
    this.halted = false;             // paused between ticks
    this.at = null;                  // the debug stop the session is held at, or null
    this.holding = false;            // inside stopped(): until a cont, resume or detach
    this.waiting = [];               // the conts answered at the next stop or halt: {inp, k0, deadline}
    this.stops = 0;                  // debug stops so far, this session
    this.let_go = null;              // why the last stop was let go without a cont (a control, the host's stop)
  }
  get routed() { return this.player.q.canBlock === true; }
  // ---- the session
  // The debugger of the session now running (a new one after a restart).
  _attach() {
    const lab = this.player.session?.lab ?? null;
    if (lab === null) throw new BadRequest(`no session (${this.player.phase})`);
    if (lab === this.lab) return;
    this.closed();
    this.lab = lab; this.sim = lab.sim;
    this.dbg = Debugger.attach(lab.sim, { lab, routed: this.routed, disasm: this.host.disasm ?? null });
    const H = this.host;
    this.proto = new Protocol({ env: {}, ...(H.openSink ? { openSink: H.openSink } : {}), ...(H.resolvePath ? { resolvePath: H.resolvePath } : {}) }, { attached: this.dbg });
  }
  // The session closes (Player.close_session, before the lab goes): every hook off, the trace files closed, the
  // waiting conts answered with the error.
  closed() {
    if (this.lab === null) return;
    const err = { type: 'SessionClosed', message: 'the session closed' };
    for (const w of this.waiting.splice(0)) this.player.finish_debug(w.inp, { id: w.inp.id ?? null, ok: false, error: err });
    try { this.proto._closeSinks(); this.dbg.close(); } catch { /* a machine a newer one replaced, or one stopped on a host error */ }
    if (this.sim.debug === this) this.sim.debug = null;
    this.lab = this.sim = this.dbg = this.proto = null;
    this.pcs = new Set(); this.watches = [];
    this.halted = false; this.at = null; this.holding = false; this.stops = 0;
  }
  // The Simulator's hook is on only while a stop is armed (a debug breakpoint, a stopping watchpoint).
  _hook() {
    const on = this.pcs.size > 0 || this.watches.some((w) => w.action === 'stop');
    this.sim.debug = on ? this : null;
    this.sim.rearm();
  }
  // ---- the Player's calls
  // One debug input: its answer, or null when it is answered later (cont).
  handle(q) {
    const id = q.id ?? null;
    try {
      if (typeof q.op !== 'string') throw new BadRequest('a debug input has a string "op"');
      this._attach();
      const r = RUN_CONTROL.has(q.op) ? this._op(q) : this.proto._op(q);
      return r === null ? null : { id, ok: true, ...r };
    } catch (e) {
      return { id, ok: false, error: { type: e?.name ?? 'Error', message: String(e?.message ?? e), ...(e?.detail ? { detail: e.detail } : {}) } };
    }
  }
  // At every tick: a cont's maxMs that passed halts the session.
  poll() {
    if (this.halted || !this.waiting.length) return;
    const now = this.player.wall();
    if (this.waiting.some((w) => w.deadline !== null && now >= w.deadline)) this._halt('maxMs');
  }
  // A halted session's tick: one debug input or control, or a wait for one (a blocking queue's 20 ms).
  tick_halted() {
    const pl = this.player;
    const inp = pl.next_debug(true, true);
    if (inp === null) {
      if (!pl.q.canBlock && !pl.env.asyncHost) throw new Error('Player.run: the session is halted (debug) and no debug input or control is queued (headless)');
      return;
    }
    if (isControl(inp)) pl.control(inp);
    else pl.debug_input(inp);
  }
  // The Simulator's hook: a debug stop inside a tick (stop: {kind 'break' | 'watch', pc, watch?, during 'continue' |
  // 'step'}). Held here, answering debug inputs, until a cont, resume or detach, a control or the host's stop.
  stopped(stop) {
    const pl = this.player, phase = pl.phase;
    this.stops += 1;
    this.at = stop;
    this.holding = true;
    this.let_go = null;
    this._answer(stop.kind);
    pl.set_phase('debug');
    try {
      while (this.holding) {
        if (pl.stopping()) { this._letGo('the host stops'); break; }
        if (!pl.q.canBlock) { this._letGo('the input queue does not block'); break; }
        const inp = pl.next_debug(true, false);
        if (inp === null) continue;
        if (isControl(inp)) { this._letGo(`control ${String(inp.op)}`); break; }
        pl.debug_input(inp);
      }
    } finally {
      this.at = null;
      this.holding = false;
      if (pl.phase === 'debug') pl.set_phase(phase);
    }
  }
  // The status document's field.
  status() {
    return { state: this.state_name(), stops: this.stops, breakpoints: this.pcs.size, watchpoints: this.watches.length,
      ...(this.at ? { stop: { kind: this.at.kind, pc: hex8(this.at.pc) } } : {}), ...(this.let_go ? { let_go: this.let_go } : {}) };
  }
  state_name() { return this.at !== null ? 'stopped' : this.halted ? 'halted' : 'running'; }
  // ---- run control
  _op(q) {
    switch (q.op) {
      case 'state': return { state: this.state_name(), stops: this.stops, breakpoints: [...this.pcs].map(hex8), watchpoints: this.watches.length,
        waiting: this.waiting.length, routed: this.routed, ...(this.let_go ? { let_go: this.let_go } : {}),
        ...(this.at || this.halted ? { stop: this._record(this.at ? this.at.kind : 'halt') } : {}) };
      case 'halt':
        if (this.at || this.halted) return this._record(this.at ? this.at.kind : 'halt');
        return this._halt('halt');
      case 'cont': {
        if (!absent(q.budget)) throw new BadRequest('cont: budget is not on a live session (maxMs halts at a tick boundary after that much wall time)');
        const maxMs = absent(q.maxMs) ? null : count(q.maxMs, 'maxMs');
        if (!absent(q.stops)) this._break(q.stops, 'cont stops');
        this.waiting.push({ inp: q, k0: this.sim.m.stderrCount(), deadline: maxMs === null ? null : this.player.wall() + maxMs / 1000 });
        this._run();
        return null;
      }
      case 'resume': this._run(); return { state: 'running' };
      case 'detach': {
        this.pcs = new Set(); this.watches = [];
        this.dbg.watch([]);
        this.proto._trace({ off: true });
        this._hook();
        this._answer('detach');
        this._run();
        return { state: 'running' };
      }
      case 'step': return this._step(q);
      case 'break': this._break(q.pcs ?? [], 'pcs'); return { pcs: [...this.pcs].map(hex8) };
      case 'watch': {
        const ws = watchList(q.list ?? []);
        if (ws.some((w) => w.action === 'stop')) this._needRouted('a stopping watchpoint');
        this.dbg.watch(ws);
        this.watches = ws;
        this._hook();
        return { count: ws.length };
      }
      case 'tasks': return this._tasks();
      case 'call': {
        const spec = callSpec(q);
        if (this.at !== null) throw new BadRequest('call: not at a debug stop (the lab is inside a tick there): cont, then call between ticks (running or halted)');
        if (this.watches.some((w) => w.action === 'stop')) throw new BadRequest('call: a stopping watchpoint is armed (it would end the call inside the harness): give it action \'log\' or clear it');
        return runCall(this.lab, this.dbg, spec);
      }
      case 'standins': {
        const n = absent(q.limit) ? 100 : count(q.limit, 'limit'), cut = (v) => (n ? v.slice(-n) : []);
        const camapp = this.player.session?.camapp ?? null;
        return { calls: cut(this.lab.log), camapp: camapp ? cut(camapp.log) : [], in_use: this.player.stand_ins_in_use() };
      }
      case 'dml': {
        const d = this.sim.m.devices.dml;
        if (!d) throw new BadRequest('dml: the board has no DML engine (src/fw/board.mjs dml)');
        const l = d.last(), hex = (v) => '0x' + (v >>> 0).toString(16);
        return { runs: d.runs, busy: d.busy(), status: hex8(d.status), dropped: d.dropped,
          last: l === null ? null : { n: l.n, t_ns: l.t_ns, regs: Object.fromEntries(Object.entries(l.regs).map(([o, v]) => [hex(+o), hex8(v)])), out: [hex8(l.out[0]), l.out[1]] } };
      }
      case 'pdt': {
        const d = this.sim.m.devices.pdt;
        if (!d) throw new BadRequest('pdt: the board has no PDT / TRC unit (src/fw/board.mjs pdt)');
        const hex = (v) => '0x' + (v >>> 0).toString(16);
        return Object.fromEntries(Object.entries(d.e).map(([name, x]) => {
          const l = d.last(name);
          return [name, { runs: x.runs, busy: d.busy(name), status: hex8(x.status), dropped: x.dropped,
            last: l === null ? null : { n: l.n, t_ns: l.t_ns, params: Object.fromEntries(Object.entries(l.params).map(([o, v]) => [hex(+o), hex8(v)])), result: l.result } }];
        }));
      }
      case 'ems1': {
        const d = this.sim.m.devices.ems1;
        if (!d) throw new BadRequest('ems1: the board has no EMS1 engine (src/fw/board.mjs ems1)');
        const l = d.last(), hex = (v) => '0x' + (v >>> 0).toString(16);
        return { runs: d.runs, busy: d.busy(), status: hex8(d.status), dropped: d.dropped,
          last: l === null ? null : { n: l.n, t_ns: l.t_ns, start: hex8(l.start), channels: l.channels, params: Object.fromEntries(Object.entries(l.params).map(([o, v]) => [hex(+o), hex8(v)])) } };
      }
      default: throw new BadRequest(`unknown op ${JSON.stringify(q.op)}`);
    }
  }
  _needRouted(what) {
    if (!this.routed) {
      throw new BadRequest(`${what}: a debug stop waits inside the session's tick for the next input, which this host's input queue cannot do (it does not block: the browser's Worker, a headless queue); halt, the reads and log watchpoints work here`);
    }
  }
  _break(pcs, what) {
    const set = new Set(list(pcs, what).map((x) => addr(x, what)));
    if (set.size) this._needRouted('break');
    this.pcs = set;
    this._hook();
  }
  // Let the session go on: a stop is let go (the Simulator's continue goes on), a halt ends (the pacing re-anchored:
  // the paused wall time is not lab time owed).
  _run() {
    if (this.at !== null) this.holding = false;
    if (this.halted) {
      this.halted = false;
      this.player.anchor();
      if (this.player.phase === 'debug') this.player.set_phase('running');
    }
  }
  _halt(reason) {
    this.halted = true;
    const r = this._record('halt');
    if (reason !== 'halt') r.reason = reason;
    this._answer('halt', reason);
    this.player.set_phase('debug');
    return r;
  }
  // A stop's control lost to a control or the host's stop: the stops cleared, the session runs on.
  _letGo(why) {
    this.let_go = why;
    this.pcs = new Set();
    const keep = this.watches.filter((w) => w.action !== 'stop');
    if (keep.length !== this.watches.length) { this.dbg.watch(keep); this.watches = keep; }
    this._hook();
    this.holding = false;
  }
  // The state of a stop or halt: {stop, regs, watch?, during?, lab_ns (the lab clock), stops, at: run | tick}.
  _record(kind) {
    const r = { stop: kind, regs: regsHex(this.dbg.regs()), lab_ns: this.sim.m.devices.clock.t, stops: this.stops, at: this.at ? 'run' : 'tick' };
    if (this.at?.watch) r.watch = hexWatch(this.at.watch);
    if (this.at?.during) r.during = this.at.during;
    return r;
  }
  // The waiting conts, answered with the stop's record and the stderr lines since each (the last 1,000).
  _answer(kind, reason = null) {
    if (!this.waiting.length) return;
    const base = this._record(kind), m = this.sim.m, n = m.stderrCount();
    if (reason !== null && reason !== 'halt') base.reason = reason;
    for (const w of this.waiting.splice(0)) {
      const k = Math.max(w.k0, n - 1000), r = { ...base, stderr: m.stderrFrom(k).lines };
      if (k > w.k0) r.stderrDropped = k - w.k0;
      this.player.finish_debug(w.inp, { id: w.inp.id ?? null, ok: true, ...r });
    }
  }
  // n single steps at a debug stop, each before an instruction that is not at a harness breakpoint.
  _step(q) {
    if (this.at === null) throw new BadRequest(`step: only at a debug stop (the session is ${this.state_name()}): set a breakpoint or a stopping watchpoint, then cont`);
    const n = absent(q.n) ? 1 : count(q.n, 'n', 1), m = this.sim.m, k0 = m.stderrCount();
    let harness = false;
    for (let i = 0; i < n; i++) {
      if (this.sim.breakpoints.has(m.getRegs()[9] >>> 0)) { harness = true; break; }
      m.step();
      if (m.lastStop().kind !== 'break') break;
    }
    const o = outcome(this.dbg._outcome(k0));
    if (m.lastStop().kind === 'watch') m.dropPendingStop();     // reported here: the next step or cont runs
    return harness ? { ...o, harness: true } : o;
  }
  _tasks() {
    const nk = this.lab.nk, sim = this.sim, running = sim.u32(nk.kcb(96)), out = [];
    for (const [tid, [entry, state]] of nk.tasks()) {
      const tcb = nk.tcb(tid);
      out.push({ tid, entry: hex8(entry), state, priority: nk.priority(tid), sp: hex8(sim.u32(tcb + TCB_SP)), running: tcb === running });
    }
    return { tasks: out };
  }
}
