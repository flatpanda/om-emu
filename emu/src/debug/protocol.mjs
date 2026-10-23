// The JSON-lines protocol of the debug API (bin/debug.mjs --serve; a Worker can host it the same way): one request
// object in, one response object out, synchronously, in order. Transport-free: images, trace files and the
// disassembler come in through the host callbacks.
//   request  {"id": any, "op": "<name>", ...}
//   response {"id": same, "ok": true, ...} or {"id": same, "ok": false, "error": {"type", "message"}}
// Error types: the thrown error's class (Fault, RspError, Unported, HostStopped, Aborted, ValueError, RuntimeError, ...)
// or BadRequest for a malformed request. An error never ends the session; after HostStopped (a host error stopped the
// machine mid-instruction) every run or write op fails with it, as the machine refuses them.
// Addresses and values are numbers or "0x..." strings; registers and addresses come back as "0x%08x" strings. A field
// of the wrong shape is a BadRequest: an address outside 0..2^32-1, a register or stored value outside 32 bits
// (signed or unsigned: -2^31..2^32-1), a count that is not a non-negative integer (step's n, disasm's n,
// watch's len and a budget positive), a list (stops, pcs, watch's list, irqs) that is not an array, regs or a watch
// entry that is not an object. As with a GDB stub, a cont whose pc is on a breakpoint returns 'break' at once (step
// first); after abort every op fails with Aborted until the next load; while a budget / maxMs continue is paused, every
// op that changes the machine or its run is refused until resume, halt or abort (break, step, cont, watch, snapshot,
// restore, reset, setRegs, setReg, write, cpuStore, lab but lab {time}, an exec trace and trace {off}); the reads
// (regs, reg, read, stack, stderr, watchLog, stats, disasm, lab {time}) and mmio and irq traces are allowed. Requests
// are handled one at a time: a cont or resume without budget or maxMs runs until a stop, a fault or the insn limit, and
// no later request (abort included) is read meanwhile, so give maxMs (or a budget) to keep control; halt and abort end
// a paused continue between slices, they cannot interrupt a running one.
// With an attached Debugger (new Protocol(host, {attached}): the live route of a play session, src/debug/live.mjs)
// the ops that make, reset or rewind a machine or move lab time are refused (load, quit, reset, cpuStore, snapshot,
// restore, drop, abort, lab but lab {time}); live.mjs serves the run control itself.
//
// Ops (one to one with the Debugger):
//   load {image?, insnLimit?, mutant?, oneInsn?}      a fresh standalone machine (the image: the host's default)
//   reset {regs?}  regs  setRegs {regs}  reg {name}  setReg {name, value}
//   read {addr, size} -> {hex}   write {addr, hex}   cpuStore {addr, value, stub?} -> {regs}
//   break {pcs}   cont {stops?, budget?, maxMs?}   resume {budget?, maxMs?}   halt   abort   step {n?}
//     cont, resume, halt and step answer {stop: break|watch|fault|limit|paused|halt, regs, fault?, watch?, stderr,
//     stderrDropped?} (stderr: the lines the run wrote, the last 1,000 of them; stderrDropped: how many it wrote
//     before those); halt ends a paused continue where it paused (stop 'halt'), the machine runnable
//   watch {list: [{id?, addr|lo, len|hi, kind: r|w|rw, action: stop|log}]}
//   watchLog {limit?} -> {entries, more, dropped}   the oldest logged hits, at most limit (default 100,000), taken
//     off the log; more: the entries still in it; dropped: the hits lost since the last watchLog (the log keeps at
//     least the newest 100,000: at 200,000 it drops the oldest half); on a lab session each entry also has lab_ns (the
//     lab clock at the hit) and n (its number since attach, the dropped hits counted)
//     a watch stop's 'watch' and each watchLog entry: {id, kind (a number: 1 r, 2 w, 3 rw, mem.mjs's mask), addr, hit,
//     size, dir, value, pc, insns}
//   trace {exec?, mmio?, irq?, mode: native|one-insn, format: qemu|jsonl, from?, to?, filter?} or {off: true} -> {files}
//     filter: {exec?: {from?, to?, pcs?}, mmio?: {from?, to?, dir?: r|w}, irq?: {kind?: presented|accepted, irqs?}}
//     keeps the lines of those instructions (a pc range [from, to), a pc list), accesses (overlapping [from, to), one
//     direction) and interrupts (one kind; a list of IRQ numbers keeps presentations only); the top-level from and to
//     are the exec filter's
//     a key given again replaces that trace (its file closed, then the new file truncated: a trace restarted on its
//     own file starts empty); keys naming one file share it (lines interleaved); a file a running trace
//     keeps writing is refused; a failed request changes no file and no trace
//     jsonl: one JSON record per line, addresses and values as "0x..." strings as in the responses (trace.mjs)
//   lab {advance: ns} | {runToFrame: ch} | {runToEvent: ns} | {time: true}
//   snapshot -> {handle}   restore {handle}   drop {handle}
//   stack {words?, initialSp?, at?} -> {stack}   words upward from the current SP (at: from that address instead,
//     e.g. a task's saved SP); initialSp only tags the line at that address '<- initial sp' (default 0xa2200000)
//   stderr {since?} -> {lines, count, first, dropped}   the lines from index since (default 0) on; a standalone machine
//     keeps the last 1,000 to 2,000, so first > since and dropped = first - since
//     when older lines are gone; count: every line the machine wrote
//   stats   quit
//   disasm {addr, n} -> {lines}   n is a byte count (default 16), not an instruction count: one line per instruction
//     that starts in [addr, addr + n), with all its bytes (an instruction longer than objdump's 4 bytes a line is
//     one line)
import { A } from '../fw/model.mjs';
import { Debugger } from './debugger.mjs';
import { regsHex, hex8 } from './regs.mjs';
import { execLine, mmioLine, mmioPcLine, irqLine, jsonLine } from './trace.mjs';

const WATCH_LOG_LIMIT = 100000;                  // watchLog's entries per response by default (about 13 MB of JSON)
export class BadRequest extends Error { constructor(m) { super(m); this.name = 'BadRequest'; } }
const HEXRE = /^[0-9a-fA-F]*$/;
export function num(v, what) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^(0x[0-9a-f]+|-?[0-9]+)$/i.test(v.trim())) return Number(v.trim());
  throw new BadRequest(`${what}: a number or "0x..." string, got ${JSON.stringify(v)}`);
}
const absent = (v) => v === undefined || v === null;
// An address (0..2^32-1), a 32-bit value (signed or unsigned, as a u32), a count (an integer >= min), a range's
// exclusive end (0..0x100000000); the opt forms take d when the field is absent.
export function addr(v, what) {
  const x = num(v, what);
  if (x < 0 || x > 2 ** 32 - 1) throw new BadRequest(`${what}: ${JSON.stringify(v)} is not a 32-bit address`);
  return x;
}
export function word(v, what) {
  const x = num(v, what);
  if (x < -(2 ** 31) || x > 2 ** 32 - 1) throw new BadRequest(`${what}: ${JSON.stringify(v)} is not a 32-bit value`);
  return x >>> 0;
}
export function count(v, what, min = 0) {
  const x = num(v, what);
  if (x < min) throw new BadRequest(`${what}: ${JSON.stringify(v)} is not ${min ? 'a positive' : 'a non-negative'} integer`);
  return x;
}
function end(v, what) {
  const x = num(v, what);
  if (x < 0 || x > 0x100000000) throw new BadRequest(`${what}: ${JSON.stringify(v)} is not a range end in 0..0x100000000`);
  return x;
}
const opt = (v, what, d) => absent(v) ? d : num(v, what);
const optAddr = (v, what, d) => absent(v) ? d : addr(v, what);
const optCount = (v, what, d, min = 0) => absent(v) ? d : count(v, what, min);
const optEnd = (v, what) => absent(v) ? null : end(v, what);
// A list field (an array) and an object field (not an array).
export function list(v, what) {
  if (!Array.isArray(v)) throw new BadRequest(`${what}: a list, got ${JSON.stringify(v)}`);
  return v;
}
export function dict(v, what) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest(`${what}: an object, got ${JSON.stringify(v)}`);
  return v;
}
const regValues = (v) => Object.fromEntries(Object.entries(dict(v ?? {}, 'regs')).map(([k, x]) => [k, word(x, k)]));
// The ops an attached (live) Protocol refuses: they make, reset or rewind a machine (lab other than {time} too: it
// moves lab time).
const STANDALONE = new Set(['load', 'quit', 'reset', 'cpuStore', 'snapshot', 'restore', 'drop', 'abort']);
function bytes(hex, what) {
  if (typeof hex !== 'string' || hex.length % 2 || !HEXRE.test(hex)) throw new BadRequest(`${what}: an even-length hex string`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(2 * i, 2), 16);
  return out;
}
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function outcome(o) {
  const r = { stop: o.stop, regs: regsHex(o.regs) };
  if (o.fault !== undefined) r.fault = o.fault;
  if (o.watch) r.watch = { ...o.watch, addr: hex8(o.watch.addr), hit: hex8(o.watch.hit), value: hex8(o.watch.value), pc: hex8(o.watch.pc) };
  r.stderr = o.stderr;
  if (o.stderrDropped) r.stderrDropped = o.stderrDropped;
  return r;
}

// host: { env: {rom?, createHash}, loadImage(path) -> Uint8Array, defaultImage, resolvePath(path)? (two names of one file
// compare equal), openSink(path, {prepare}) -> {write(line),
// close(), and with prepare: commit() (truncate: the trace starts) and discard() (close, remove the file if this open
// created it), the file left as it was until commit}, disasm(addr, bytes) -> lines }
export class Protocol {
  constructor(host, { attached = null } = {}) { this.host = host; this.dbg = attached; this.live = attached !== null; this.sinks = []; this.done = false; }
  _need() { if (this.dbg === null) throw new BadRequest('no machine: send {"op": "load"} first'); return this.dbg; }
  _closeSinks() { for (const s of this.sinks) s.close(); this.sinks = []; }
  handle(req) {
    const id = req && typeof req === 'object' ? req.id ?? null : null;
    try {
      if (!req || typeof req !== 'object' || typeof req.op !== 'string') throw new BadRequest('a request is an object with a string "op"');
      const res = this._op(req);
      return { id, ok: true, ...res };
    } catch (e) {
      return { id, ok: false, error: { type: e?.name ?? 'Error', message: String(e?.message ?? e) } };
    }
  }
  _op(q) {
    const H = this.host;
    if (this.live && (STANDALONE.has(q.op) || (q.op === 'lab' && !(q.time && q.advance === undefined && q.runToFrame === undefined && q.runToEvent === undefined)))) {
      throw new BadRequest(`${q.op === 'lab' ? 'lab but lab {time}' : q.op}: not on a live session (it would make, reset or rewind the machine, or move lab time behind the session)`);
    }
    switch (q.op) {
      case 'load': {
        this.traces = {};
        if (this.dbg) { this._closeSinks(); try { this.dbg.close(); } catch { /* an aborted machine */ } this.dbg = null; }
        const image = q.image ?? H.defaultImage;
        const rom = H.loadImage(image);
        const mutant = q.mutant === undefined || q.mutant === null ? null : num(q.mutant, 'mutant');
        this.dbg = Debugger.create({ ...H.env, rom }, { insnLimit: optCount(q.insnLimit, 'insnLimit', null), mutant, oneInsn: !!q.oneInsn, disasm: H.disasm });
        return { image, regs: regsHex(this.dbg.regs()) };
      }
      case 'quit': this._closeSinks(); if (this.dbg) { try { this.dbg.close(); } catch { /* aborted */ } } this.dbg = null; this.done = true; return { quit: true };
      case 'reset': { const regs = regValues(q.regs); this._need().reset(regs); return { regs: regsHex(this.dbg.regs()) }; }
      case 'regs': return { regs: regsHex(this._need().regs()) };
      case 'setRegs': { const regs = regValues(q.regs); this._need().setRegs(regs); return { regs: regsHex(this.dbg.regs()) }; }
      case 'reg': { const v = this._need().reg(q.name); return { value: v === null ? null : hex8(v) }; }
      case 'setReg': { const v = word(q.value, 'value'); this._need().setReg(q.name, v); return {}; }
      case 'read': { const a = addr(q.addr, 'addr'), n = count(q.size, 'size'); return { hex: toHex(this._need().read(a, n)) }; }
      case 'write': { const a = addr(q.addr, 'addr'), b = bytes(q.hex, 'hex'); this._need().write(a, b); return {}; }
      case 'cpuStore': {
        const a = addr(q.addr, 'addr'), v = word(q.value, 'value'), stub = optAddr(q.stub, 'stub', undefined);
        return { regs: regsHex(this._need().cpuStore(a, v, stub)) };
      }
      case 'break': { const pcs = pcList(q.pcs ?? [], 'pcs'); return { pcs: this._need().breakpoints(pcs).map(hex8) }; }
      case 'cont': {
        const stops = absent(q.stops) ? undefined : pcList(q.stops, 'stops'), run = runLimits(q);
        return outcome(this._need().cont({ ...(stops ? { stops } : {}), ...run }));
      }
      case 'resume': { const run = runLimits(q); return outcome(this._need().resume(run)); }
      case 'halt': return outcome(this._need().halt());
      case 'abort': this._need().abort(); return {};
      case 'step': { const n = optCount(q.n, 'n', 1, 1); return outcome(this._need().step(n)); }
      case 'watch': { const ws = watchList(q.list ?? []); this._need().watch(ws); return { count: ws.length }; }
      case 'watchLog': {
        const d = this._need(), entries = d.watchLog(optCount(q.limit, 'limit', WATCH_LOG_LIMIT)), st = d.watchLogState();
        return { entries: entries.map((r) => ({ ...r, addr: hex8(r.addr), hit: hex8(r.hit), value: hex8(r.value), pc: hex8(r.pc) })), more: st.kept, dropped: st.dropped };
      }
      case 'trace': return this._trace(q);
      case 'lab': {
        const d = this._need();
        if (q.advance !== undefined) return d.advance(count(q.advance, 'advance'));
        if (q.runToFrame !== undefined) return d.runToFrame(count(q.runToFrame, 'runToFrame'));
        if (q.runToEvent !== undefined) return d.runToEvent(count(q.runToEvent, 'runToEvent'));
        if (q.time) return { time: d.labTime() };
        throw new BadRequest('lab: one of advance, runToFrame, runToEvent, time');
      }
      case 'snapshot': { const h = this._need().snapshot(); return { handle: h, bytes: this.dbg.snapshotBytes(h) }; }
      case 'restore': this._need().restore(num(q.handle, 'handle')); return { regs: regsHex(this.dbg.regs()) };
      case 'drop': this._need().drop(num(q.handle, 'handle')); return {};
      case 'stack': {
        if (q.sp !== undefined) throw new BadRequest('stack: "sp" is now "initialSp" (it only tags a line); "at" dumps from an address');
        const words = optCount(q.words, 'words', 16), top = optAddr(q.initialSp, 'initialSp', A(0xA2200000)), at = optAddr(q.at, 'at', null);
        return { stack: this._need().stack(words, top, at) };
      }
      case 'stderr': {
        const since = optCount(q.since, 'since', 0), d = this._need(), r = d.stderr(since);
        return { lines: r.lines, count: d.stderrCount(), first: r.first, dropped: r.first - since };
      }
      case 'stats': return { stats: this._need().stats() };
      case 'disasm': { const a = addr(q.addr, 'addr'), n = optCount(q.n, 'n', 16, 1); return { lines: this._need().disasm(a, n) }; }
      default: throw new BadRequest(`unknown op ${JSON.stringify(q.op)}`);
    }
  }
  _trace(q) {
    const d = this._need(), H = this.host;
    const SET = { exec: (f, o) => d.traceExec(f, o), mmio: (f, o) => d.traceMmio(f, o), irq: (f, o) => d.traceIrq(f, o) };
    if (q.off) { for (const k in SET) SET[k](null); this._closeSinks(); this.traces = {}; return {}; }
    const format = q.format ?? 'qemu';
    if (format !== 'qemu' && format !== 'jsonl') throw new BadRequest('trace format: qemu or jsonl');
    const keys = ['exec', 'mmio', 'irq'].filter((k) => q[k]);
    if (keys.length && !H.openSink) throw new BadRequest('trace: this host writes no trace files');
    const opts = traceFilters(q);
    const LINE = { exec: format === 'qemu' ? execLine : (r) => jsonLine('exec', r),
      mmio: format === 'qemu' ? (q.pc === false ? mmioLine : mmioPcLine) : (r) => jsonLine('mmio', r),
      irq: format === 'qemu' ? irqLine : (r) => jsonLine('irq', r) };
    // A request changes nothing unless all of it succeeds: a file another trace keeps writing (one this request does
    // not replace) is refused first; then the hooks are set (a refused one, e.g. mode 'one-insn' without oneInsn, has
    // opened no file); then each file is opened once, without truncating it (host.openSink's prepare: a failure removes
    // the files this request created and leaves the others as they were), keys naming one file sharing it (their
    // lines interleaved in event order); then the replaced traces' files are closed (their
    // buffered lines written) and only after that are the new files truncated, so a trace restarted on its own file
    // starts empty. On a failure the hooks of the earlier traces are put back.
    this.traces ??= {};
    const prev = { ...this.traces }, sinks = {}, set = [], opened = [];
    const where = (p) => (H.resolvePath ? H.resolvePath(p) : p);
    const paths = Object.fromEntries(keys.map((k) => [k, where(q[k])]));
    for (const [k, t] of Object.entries(prev)) {
      if (keys.includes(k)) continue;
      const clash = keys.find((nk) => paths[nk] === t.path);
      if (clash) throw new BadRequest(`trace ${clash}: ${q[clash]} is the file of the running ${k} trace (turn it off or give it a new file in the same request)`);
    }
    try {
      for (const k of keys) {
        const line = LINE[k];
        SET[k]((r) => sinks[k].write(line(r)), opts[k]);
        set.push(k);
      }
      const byPath = new Map();
      for (const k of keys) {
        if (!byPath.has(paths[k])) { const s = H.openSink(q[k], { prepare: true }); opened.push(s); byPath.set(paths[k], s); }
        sinks[k] = byPath.get(paths[k]);
      }
    } catch (e) {
      for (const k of set) { if (prev[k]) SET[k](prev[k].hook, prev[k].opts); else SET[k](null); }
      for (const s of opened) (s.discard ?? s.close).call(s);
      throw e;
    }
    const files = {};
    for (const k of keys) {
      const line = LINE[k];
      this.traces[k] = { sink: sinks[k], hook: (r) => sinks[k].write(line(r)), opts: opts[k], path: paths[k] };
      files[k] = q[k];
    }
    const live = new Set(Object.values(this.traces).map((t) => t.sink));
    for (const k of keys) {                             // a replaced file no trace writes any more: closed (flushed) now
      const old = prev[k]?.sink;
      if (old && !live.has(old) && this.sinks.includes(old)) { old.close(); this.sinks = this.sinks.filter((s) => s !== old); }
    }
    for (const s of opened) { s.commit?.(); this.sinks.push(s); }
    return { files };
  }
}
// A list of pcs (addresses).
const pcList = (v, what) => list(v, what).map((x) => addr(x, what));
// cont's and resume's budget (a positive instruction count) and maxMs (wall milliseconds, non-negative).
const runLimits = (q) => ({ budget: optCount(q.budget, 'budget', Infinity, 1), maxMs: optCount(q.maxMs, 'maxMs', null) });
// watch's list: [{id?, addr|lo, len|hi, kind?, action?}], each an object; len at least 1.
export function watchList(v) {
  return list(v, 'list').map((w, i) => {
    dict(w, `list[${i}]`);
    const lo = addr(w.lo ?? w.addr, 'lo');
    return { id: w.id ?? i, lo, hi: w.hi !== undefined ? end(w.hi, 'hi') : lo + count(w.len ?? 1, 'len', 1), kind: w.kind ?? 'w', action: w.action ?? 'stop' };
  });
}
// trace's options per kind: {exec: {mode, from, to, pcs}, mmio: {from, to, dir}, irq: {kind, irqs}} (null: no filter).
function traceFilters(q) {
  const f = absent(q.filter) ? {} : dict(q.filter, 'filter');
  for (const k of Object.keys(f)) if (!['exec', 'mmio', 'irq'].includes(k)) throw new BadRequest(`filter: ${JSON.stringify(k)} is not exec, mmio or irq`);
  const part = (k) => absent(f[k]) ? {} : dict(f[k], `filter.${k}`);
  const ex = part('exec'), mm = part('mmio'), iq = part('irq');
  if ((!absent(q.from) && !absent(ex.from)) || (!absent(q.to) && !absent(ex.to))) throw new BadRequest('trace: from or to given both at the top and in filter.exec');
  const dir = absent(mm.dir) ? null : mm.dir, kind = absent(iq.kind) ? null : iq.kind;
  if (dir !== null && dir !== 'r' && dir !== 'w') throw new BadRequest(`filter.mmio.dir: 'r' or 'w', got ${JSON.stringify(dir)}`);
  if (kind !== null && kind !== 'presented' && kind !== 'accepted') throw new BadRequest(`filter.irq.kind: 'presented' or 'accepted', got ${JSON.stringify(kind)}`);
  return {
    exec: { mode: q.mode ?? 'native', from: optAddr(q.from ?? ex.from, 'from', null), to: optEnd(q.to ?? ex.to, 'to'), pcs: absent(ex.pcs) ? null : pcList(ex.pcs, 'filter.exec.pcs') },
    mmio: { from: optAddr(mm.from, 'filter.mmio.from', null), to: optEnd(mm.to, 'filter.mmio.to'), dir },
    irq: { kind, irqs: absent(iq.irqs) ? null : list(iq.irqs, 'filter.irq.irqs').map((x) => count(x, 'filter.irq.irqs')) },
  };
}
