// The debug API for reverse-engineering work: one library over the JS lab machine for registers, memory, breakpoints,
// watchpoints, snapshots and the exec, MMIO and interrupt traces (in the line formats of QEMU's -d exec and
// memory_region_ops logs). Worker-safe (no node APIs): the image, the hash and the disassembler come in through env and
// options.
//
// Two ways in:
//   Debugger.create(env, {insnLimit, mutant, oneInsn}): a standalone machine, a src/lab/sim.mjs Simulator of its own
//     (env: {rom, createHash, machine?}; insnLimit null keeps 1,000,000, 0 disables; mutant and oneInsn: the machine
//     options, added to env.machine: a negative control's number, and the one-instruction mode, which the exec
//     trace's 'one-insn' mode needs);
//   Debugger.attach(sim, {lab}): the Simulator of a running lab session. Every call goes to the machine without the
//     facade's packet accounting, so the session's own Stats and harness digest do not see the debugger; lab-time
//     calls go through the lab (its time log and kernel delivery run); snapshot and restore are refused (the harness
//     state cannot be rewound), and so are breakpoints and stopping watchpoints: the harness sets its own breakpoint
//     list at every continue, and takes any stop as its own (a watch stop ends the input with a NavError). With a lab
//     session, use log watchpoints (watchLog) and the traces. Pass {lab} whenever the Simulator belongs to a lab session.
//     A lab's watch log entries carry lab_ns (the lab clock at the hit) and n (the hit's number since attach, counting
//     the hits the log dropped too). routed: the host takes the stops off the harness (src/debug/live.mjs, through
//     the Simulator's debug hook), so stopping watchpoints are accepted; the breakpoints are the host's (live.mjs).
// Addresses and values are numbers (u32), byte strings Uint8Array. A refused call throws the machine's own error; a
// register or stored value outside 32 bits (signed or unsigned) and a step count that is not a positive integer are
// a ValueError.
import { Simulator, SP as SIM_SP, BASE } from '../lab/sim.mjs';
import { IMAGE_BASE, IMAGE_END } from '../fw/model.mjs';
import { R, S, SP, D0, PSW } from '../core/cpu.mjs';
import { ValueError, RuntimeError } from '../lab/errors.mjs';
import { RspError, WATCH_LOG_MAX } from '../machine.mjs';
import { REGS, regNumber } from './regs.mjs';
import { DEBUG as VSC_DEBUG, DOORBELL, DOORBELL_STUB, DBG_ARG0, DBG_LAST_RESULT, DBG_T, DBG_EVENT_SOURCES,
  CMD_ADVANCE, CMD_RUN_TO_FRAME, CMD_RUN_TO_EVENT } from '../lab/display.mjs';

const KINDS = { r: 1, w: 2, rw: 3, a: 3 };
const u32le = (b) => (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
const le4 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
const SLICE = 1000000;                 // maxMs: continues run in slices of this many instructions
// A 32-bit register or stored value, signed or unsigned, as a u32.
function word(v, what) {
  if (!Number.isInteger(v) || v < -(2 ** 31) || v > 2 ** 32 - 1) throw new ValueError(`${what}: ${v} is not a 32-bit value`);
  return v >>> 0;
}

export class Debugger {
  constructor(sim, { lab = null, attached = false, routed = false, disasm = null, clock = () => performance.now() } = {}) {
    this.sim = sim; this.m = sim.m; this.lab = lab; this.attached = attached; this.routed = routed;
    this.disasmFn = disasm; this.clock = clock;
    this.snaps = new Map(); this.nextSnap = 1;
    this.bps = new Set();
    this.log = []; this.logDropped = 0; this.hits = 0;     // a lab's watch log (watch)
  }
  static create(env, { insnLimit = null, mutant = null, oneInsn = false, disasm = null } = {}) {
    const machine = { ...env.machine, ...(mutant !== null ? { mutant } : {}), ...(oneInsn ? { oneInsn } : {}) };
    const sim = new Simulator({ ...env, machine }, insnLimit);
    return new Debugger(sim, { disasm, ...(env.clock ? { clock: env.clock } : {}) });
  }
  static attach(sim, { lab = null, routed = false, disasm = null } = {}) { return new Debugger(sim, { lab, attached: true, routed, disasm }); }
  close() {
    this.m.setExecTrace(null); this.m.setMmioTrace(null); this.m.setIrqTrace(null);
    if (!this.m.paused()) this.m.setWatchpoints([]);
    this.snaps.clear();
    if (!this.attached) this.sim.close();
  }

  // ---- state
  regs() {
    const r = this.m.getRegs(), out = {};
    for (let k = 0; k < 16; k++) out[REGS[k]] = r[k];
    return out;
  }
  reg(name) {
    const n = regNumber(name);
    if (n < 0) throw new ValueError(`Unknown register: ${name}`);
    return this.m.getReg(n);
  }
  setReg(name, value) {
    const n = regNumber(name);
    if (n < 0) throw new ValueError(`Unknown register: ${name}`);
    this.m.setReg(n, word(value, name));
  }
  // Some or all of the 16 registers ('G' with the others unchanged).
  setRegs(values) {
    const cur = this.regs();
    for (const [k, v] of Object.entries(values)) {
      if (!Object.hasOwn(cur, k)) throw new ValueError(`Unknown register: ${k}`);
      cur[k] = word(v, k);
    }
    this.m.setRegs(Uint32Array.from(REGS.map((k) => cur[k])));
  }
  // reset(values): every register 0, sp 0xA2200000, pc 0x50000000, then the given ones.
  reset(values = {}) {
    const regs = Object.fromEntries(REGS.map((k) => [k, 0]));
    regs.sp = SIM_SP; regs.pc = BASE;
    for (const [k, v] of Object.entries(values)) {
      if (!Object.hasOwn(regs, k)) throw new ValueError(`Unknown register: ${k}`);
      regs[k] = word(v, k);
    }
    this.m.setRegs(Uint32Array.from(REGS.map((k) => regs[k])));
  }

  // ---- memory: debugger accesses ('m'/'M': no watchpoint, no MMIO write; a device read error is E14)
  read(addr, size) { return this.sim.read(addr >>> 0, size); }
  write(addr, bytes) { if (bytes.length) this.m.dbgWrite(addr >>> 0, bytes); }
  u32(addr) { return u32le(this.read(addr, 4)); }
  // cpuStore: one 32-bit CPU store from harness code (mov d0,(a0) at stub, single-stepped, no interrupt accepted), all
  // 16 registers restored. Returns the registers after the step.
  cpuStore(addr, value, stub = DOORBELL_STUB) {
    value = word(value, 'cpuStore value');
    const saved = this.m.getRegs().slice();
    this.write(stub, new Uint8Array([0x60]));
    const r = saved.slice();
    r[9] = stub >>> 0; r[0] = value >>> 0; r[4] = addr >>> 0; r[14] = 0;
    this.m.setRegs(r);
    this.m.step();
    const after = this.regs();
    this.m.setRegs(saved);
    return after;
  }

  // ---- run control
  _noStops(what) {
    if (this.lab && !this.routed) throw new Error(`${what}: refused while attached to a lab session (its harness owns the breakpoints and takes every stop as its own; use action 'log' and watchLog)`);
  }
  breakpoints(pcs) {
    if (pcs !== undefined) {
      if (this.lab) throw new Error('breakpoints: refused while attached to a lab session (its harness owns the breakpoints and takes every stop as its own; use action \'log\' and watchLog, or the live route, src/debug/live.mjs)');
      this.bps = new Set([...pcs].map((x) => x >>> 0));
      this.m.setBreakpoints([...this.bps]);
    }
    return [...this.bps];
  }
  _outcome(k0, extra = {}) {
    const st = this.m.lastStop() ?? { kind: 'break', code: 0 };
    // the lines this run wrote, at most the last 1,000 (stderrDropped: how many before them it wrote)
    const n = this.m.stderrCount(), k = Math.max(k0, n - 1000);
    const out = { stop: st.kind, regs: this.regs(), ...extra, stderr: this.m.stderrSince(k) };
    if (k > k0) out.stderrDropped = k - k0;
    if (st.kind === 'fault' || st.kind === 'limit') out.fault = st.code;
    if (st.kind === 'watch') out.watch = this.m.watchHit();
    return out;
  }
  _chain(first, { budget = Infinity, maxMs = null } = {}) {
    const k0 = this.m.stderrCount(), i0 = S.insns, t0 = this.clock();
    if (maxMs === null) return this._outcome(k0, { result: first ? this.m.cont({ budget }) : this.m.resume({ budget }) });
    let r = 'paused';
    for (let once = true; r === 'paused'; once = false) {
      const done = S.insns - i0;
      if (!once && (done >= budget || this.clock() - t0 >= maxMs)) break;
      const b = Math.max(1, Math.min(SLICE, budget - done));
      r = once && first ? this.m.cont({ budget: b }) : this.m.resume({ budget: b });
    }
    return this._outcome(k0, { result: r });
  }
  // Continue: to a breakpoint (stops: the set to use, else the current one), a stopping watchpoint, a fault or the
  // insn limit. budget: pause after about that many instructions (stop 'paused'; resume() goes on, abort() ends the
  // machine); maxMs: pause after that much wall time (continues of 1 M instructions chained). Returns {stop, regs,
  // watch?, fault?, stderr: the device and trap lines it wrote}.
  cont({ stops, budget = Infinity, maxMs = null } = {}) {
    if (stops !== undefined) this.breakpoints(stops);
    return this._chain(true, { budget, maxMs });
  }
  resume({ budget = Infinity, maxMs = null } = {}) { return this._chain(false, { budget, maxMs }); }
  abort() { this.m.abort(); }
  // End a paused continue where it paused (stop 'halt'), the machine runnable, as after a breakpoint stop.
  halt() { const k0 = this.m.stderrCount(); this.m.halt(); return this._outcome(k0); }
  paused() { return this.m.paused(); }
  // Single step(s) ('s': no breakpoint, no interrupt); stops early at a fault, the insn limit or a watchpoint hit.
  step(n = 1) {
    if (!Number.isInteger(n) || n < 1) throw new ValueError(`step: n ${n} is not a positive integer`);
    const k0 = this.m.stderrCount();
    for (let i = 0; i < n; i++) {
      this.m.step();
      const st = this.m.lastStop();
      if (st && st.kind !== 'break') break;
    }
    return this._outcome(k0);
  }

  // ---- watchpoints: [{id, lo, hi (exclusive) | len, kind 'r' | 'w' | 'rw', action 'stop' | 'log'}] per CPU virtual
  // address ([] clears). A stop ends a continue after the accessing instruction (stop 'watch', the hit in .watch:
  // {id, kind (a number, mem.mjs's mask: 1 r, 2 w, 3 rw), addr, hit (the reported address: the watchpoint's lo),
  // size, dir, value, pc, insns}); a log entry (the same fields) only records the access. A hit by an interrupt entry's
  // stores (the PSW and pc pushed below SP) ends the continue after the entry, before the handler's first instruction:
  // the record's pc and insns are the interrupted instruction's (the entry is no instruction of its own).
  watch(list) {
    const ws = list.map((w, i) => {
      const lo = Number(w.lo) >>> 0, hi = w.hi !== undefined ? Number(w.hi) : lo + Number(w.len);
      if (!Object.hasOwn(KINDS, w.kind ?? 'w')) throw new ValueError(`watch kind ${w.kind}: 'r', 'w' or 'rw'`);
      if (w.action !== undefined && w.action !== 'stop' && w.action !== 'log') throw new ValueError(`watch action ${w.action}: 'stop' or 'log'`);
      return { id: w.id ?? i, lo, hi, kind: KINDS[w.kind ?? 'w'], stop: (w.action ?? 'stop') === 'stop' };
    });
    if (ws.some((w) => w.stop)) this._noStops('a stopping watchpoint');
    this.m.setWatchpoints(ws, this.lab ? { onLog: (rec) => this._logHit(rec) } : {});
  }
  // A lab's log hit: stamped with the lab clock and its number, kept as the machine keeps its own (src/machine.mjs).
  _logHit(rec) {
    rec.lab_ns = this.m.devices.clock.t; rec.n = ++this.hits;
    this.log.push(rec);
    if (this.log.length >= WATCH_LOG_MAX) { this.log.splice(0, WATCH_LOG_MAX / 2); this.logDropped += WATCH_LOG_MAX / 2; }
  }
  // The oldest limit log entries (all by default), taken off the log. The log keeps at least the newest
  // WATCH_LOG_MAX / 2 hits (src/machine.mjs): watchLogState() says how many it holds and how many it dropped since
  // the last call.
  watchLog(limit = Infinity) {
    if (!this.lab) return this.m.drainWatchLog(limit);
    if (limit >= this.log.length) { const out = this.log; this.log = []; return out; }
    return this.log.splice(0, limit);
  }
  watchLogState() {
    if (!this.lab) return this.m.watchLogState();
    const r = { kept: this.log.length, dropped: this.logDropped }; this.logDropped = 0; return r;
  }

  // ---- traces (null stops one). Each sink gets a record object; formatting is the sink's (trace.mjs).
  // exec: {pc, op, sp, d0, d1, d2, psw, insns} before each instruction executes. mode 'native' (inline forms routed
  // through the helper, the untraced run's interrupt looks) or 'one-insn' (every instruction a one-instruction TB:
  // the debugger must have been created with oneInsn). from/to: a pc range [from, to); pcs: a set.
  traceExec(sink, { mode = 'native', from = null, to = null, pcs = null } = {}) {
    if (sink === null) { this.m.setExecTrace(null); return; }
    const set = pcs ? new Set([...pcs].map((x) => x >>> 0)) : null, lo = from ?? 0, hi = to ?? 2 ** 32;
    const all = set === null && from === null && to === null;
    this.m.setExecTrace((pc, op) => {
      pc >>>= 0;
      if (!all && (pc < lo || pc >= hi || (set !== null && !set.has(pc)))) return;
      sink({ pc, op, sp: R[SP] >>> 0, d0: R[D0] >>> 0, d1: R[D0 + 1] >>> 0, d2: R[D0 + 2] >>> 0, psw: R[PSW] & 0xffff, insns: S.insns });
    }, { mode });
  }
  // mmio: {dir 'r' | 'w', cpu 0 | -1, addr, value, size, name, pc (cpu 0), insns, err}. Filters: from/to, an address
  // range [from, to) an access must overlap; dir 'r' or 'w'.
  traceMmio(sink, { from = null, to = null, dir = null } = {}) {
    if (sink === null) { this.m.setMmioTrace(null); return; }
    if (dir !== null && dir !== 'r' && dir !== 'w') throw new ValueError(`traceMmio: dir ${dir}: 'r' or 'w'`);
    const lo = from ?? 0, hi = to ?? 2 ** 32, all = from === null && to === null && dir === null, wd = dir === 'w' ? 1 : 0;
    this.m.setMmioTrace((d, addr, value, size, name, cpu, err) => {
      if (!all && ((dir !== null && (d ? 1 : 0) !== wd) || (addr >>> 0) + size <= lo || (addr >>> 0) >= hi)) return;
      sink({ dir: d ? 'w' : 'r', cpu, addr, value, size, name, pc: cpu === 0 ? R[9] >>> 0 : null, insns: S.insns, err });
    });
  }
  // irq: {kind 'presented', irq, level, pc, insns} (a CPU read of +0x700 that names an IRQ) or {kind 'accepted', level,
  // pc, insns} (cpu.mjs execInterrupt). Filters: kind 'presented' or 'accepted'; irqs, a set of IRQ numbers (an
  // acceptance names none, so irqs keeps the presentations only).
  traceIrq(sink, { kind = null, irqs = null } = {}) {
    if (sink === null) { this.m.setIrqTrace(null); return; }
    if (kind !== null && kind !== 'presented' && kind !== 'accepted') throw new ValueError(`traceIrq: kind ${kind}: 'presented' or 'accepted'`);
    const set = irqs ? new Set(irqs) : null, want = kind === null ? -1 : kind === 'presented' ? 0 : 1;
    this.m.setIrqTrace((k, a, b, c, d) => {
      if ((want !== -1 && k !== want) || (set !== null && (k !== 0 || !set.has(a)))) return;
      sink(k === 0 ? { kind: 'presented', irq: a, level: b, pc: c, insns: d } : { kind: 'accepted', level: a, pc: b, insns: c });
    });
  }

  // ---- lab time (the VSC doorbell). Standalone: DisplayLab's sequence (the argument into the VSC debug window, a CPU
  // store of the command to the doorbell from the doorbell stub, the result read back); attached to a DisplayLab: the
  // lab's own advance / run_to_frame / run_to_event.
  labTime() { const b = this.read(VSC_DEBUG + DBG_T, 8); return u32le(b) + u32le(b.subarray(4)) * 4294967296; }
  _doorbell(cmd, channel = 0, arg = 0) {
    const a = new Uint8Array(8);
    a.set(le4(arg % 4294967296), 0); a.set(le4(Math.floor(arg / 4294967296)), 4);
    this.write(VSC_DEBUG + DBG_ARG0, a);
    const after = this.cpuStore(DOORBELL, cmd | channel << 8, DOORBELL_STUB);
    if (after.fault || after.pc !== DOORBELL_STUB + 1) throw new RuntimeError(`doorbell ${cmd}: fault ${after.fault} at 0x${after.pc.toString(16)}`);
    return this.u32(VSC_DEBUG + DBG_LAST_RESULT);
  }
  advance(ns) {
    if (this.lab) { this.lab.advance(ns, 'debugger'); return { time: this.labTime() }; }
    return { result: this._doorbell(CMD_ADVANCE, 0, ns), time: this.labTime() };
  }
  runToFrame(ch) {
    if (this.lab) { this.lab.run_to_frame(ch, 'debugger'); return { time: this.labTime() }; }
    return { result: this._doorbell(CMD_RUN_TO_FRAME, ch), time: this.labTime() };
  }
  runToEvent(limitNs) {
    if (this.lab) return { sources: this.lab.run_to_event(limitNs), time: this.labTime() };
    const result = this._doorbell(CMD_RUN_TO_EVENT, 0, limitNs);
    return { result, sources: this.u32(VSC_DEBUG + DBG_EVENT_SOURCES), time: this.labTime() };
  }

  // ---- snapshots (standalone, at a stop, kept in memory)
  snapshot() {
    if (this.attached) throw new Error('snapshot: refused while attached to a lab session (its harness state cannot be rewound)');
    const h = this.nextSnap++;
    this.snaps.set(h, this.m.snapshot());
    return h;
  }
  restore(h) {
    if (this.attached) throw new Error('restore: refused while attached to a lab session (its harness state cannot be rewound)');
    if (!this.snaps.has(h)) throw new ValueError(`restore: no snapshot ${h}`);
    this.m.restore(this.snaps.get(h));
  }
  drop(h) { if (!this.snaps.delete(h)) throw new ValueError(`drop: no snapshot ${h}`); }
  snapshotBytes(h) { return this.m.snapshotBytes(this.snaps.get(h)); }

  // ---- misc
  // stack: up to `words` words upward from SP, one line per word (no facade accounting). top: the address tagged
  // '<- initial sp' (the reset SP by default; it changes nothing else); at: dump from this address instead of the
  // current SP (a saved task SP), the lines then say 'at+0x...'.
  stack(words = 16, top = SIM_SP, at = null) {
    const sp = at === null ? this.m.getRegs()[8] : at >>> 0, out = [];
    for (let i = 0; i < words; i++) {
      const address = sp + 4 * i;
      let v;
      try {
        if (address > 0xffffffff) break;
        v = u32le(this.m.dbgRead(address, 4));
      } catch (e) { if (e instanceof RspError) break; throw e; }
      let line = `${at === null ? 'sp' : 'at'}+0x${(4 * i).toString(16).padStart(3, '0')} 0x${address.toString(16).padStart(8, '0')}: 0x${v.toString(16).padStart(8, '0')}`;
      if ((BASE <= v && v < BASE + 0x2000000) || (IMAGE_BASE <= v && v < IMAGE_END)) line += ' code';
      if (top !== null && address === top) line += ' <- initial sp';
      out.push(line);
    }
    return out;
  }
  // The machine's stderr lines from index since on, {first, lines}: a standalone machine keeps the last 1,000 to
  // 2,000 lines (src/machine.mjs's ring), so first is above since when older lines were dropped.
  stderr(since = 0) { return this.m.stderrFrom(since); }
  stderrCount() { return this.m.stderrCount(); }
  stats() { return { ...this.m.stats }; }
  // disasm(addr, bytes) -> lines: the options' callback (bin/debug.mjs runs tools/mn10300-objdump), on the window plus
  // up to 6 bytes more (the longest MN10300 instruction is 7 bytes), so the last instruction that starts in the window
  // is decoded whole. n is a byte count. One line per instruction that starts in the window: objdump prints at most 4
  // bytes a line, so a longer instruction's continuation line (an address and bytes, no mnemonic) is appended to its
  // instruction's bytes, never returned as a line of its own; none of objdump's 'Address ... is out of bounds.' lines
  // (an instruction cut by the end of the bytes read) or bare 'addr:' lines.
  disasm(addr, n) {
    if (!this.disasmFn) throw new Error('disasm: no disassembler callback (bin/debug.mjs runs tools/mn10300-objdump or $OM_OBJDUMP)');
    addr >>>= 0;
    let bytes = null;
    for (let more = 6; bytes === null; more--) {
      try { bytes = this.read(addr, n + more); } catch (e) { if (more === 0) throw e; }
    }
    const end = addr + n;
    const out = [];
    let last = -1;                 // the index in out of the instruction line a continuation belongs to (-1: dropped)
    for (const l of this.disasmFn(addr, bytes)) {
      const m = /^\s*([0-9a-f]+):\s*(.*)$/.exec(l);
      if (!m) { out.push(l); last = -1; continue; }
      const text = m[2].trim();
      if (/^[0-9a-f]{2}(?: [0-9a-f]{2})*$/.test(text)) {          // bytes, no mnemonic: the previous instruction's tail
        if (last >= 0) {
          const f = out[last].split('\t');
          f[1] = `${f[1].trimEnd()} ${text} `;
          out[last] = f.join('\t');
        }
        continue;
      }
      if (parseInt(m[1], 16) < end && text !== '' && !/Address 0x[0-9a-f]+ is out of bounds\.$/.test(text)) { out.push(l); last = out.length - 1; } else last = -1;
    }
    return out;
  }
}
