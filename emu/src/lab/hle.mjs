// High-level emulation harness (no PERF2 builtins: memset / memcpy are not folded on the host).
// Code addresses in this API use the disassembly base 0x50000000 + body offset; code runs at IMAGE_BASE + offset
// (src/fw/model.mjs; E143 0x60021020).
import { Simulator, REGS, SP, packRegs, BASE } from './sim.mjs';
import { FirmwareError, AssertionError } from './errors.mjs';
import { show } from '../util/show.mjs';
import { hexDigits as fx } from '../util/hex.mjs';
import { A, refuseUnmapped, MODEL_INFO, IMAGE_BASE } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';

export const CALLER = A(0xA2100000), RETURN = A(0xA2100100), ISR_CALLER = A(0xA2100200), ISR_SP = A(0xA2180000);
export const DATA = A(0xA2201000), DATA_END = A(0xA2300000);
export const HEAP = A(0x62424700), HEAP_END = A(0x6268D380);
export const SAVED = { d2: 0x22222222, d3: 0x33333333, a2: 0xaaaa2222, a3: 0xaaaa3333 };
export const MEMCPY = A(0x3FFE18EA), MEMSET = A(0x3FFE19F6), MALLOC = A(0x50002FDC), FREE = A(0x5000300E);
export const CORE_INDEX = 0x8050;
// finish_calls_after's frame below the hooked function's return address: the 4-byte slot fn's `calls` writes, with
// room above it for what fn may store there (16 bytes; that fn needs no more than 12 is I)
const CALLS_AFTER_FRAME = 16;
export const HLE_WINDOW = 0x89A30000;
export { FirmwareError, REGS, SP, BASE };

const le32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) | 0;
const le16s = (b, o) => ((b[o] | b[o + 1] << 8) << 16) >> 16;
const bytes = (...xs) => new Uint8Array(xs);
function cat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const i32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
export const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
export { cat, bytes };

const FRAMES = new WeakMap();      // image -> Map(body offset of a CALL target -> Map("mask,size" -> [mask, size]))
// Index every CALL d32 (dd) and CALL d16 (cd) encoding in image by its target.
export function callFrames(image) {
  let index = FRAMES.get(image);
  if (index) return index;
  index = new Map();
  const n = image.length;
  const add = (target, mask, size) => {
    let s = index.get(target);
    if (!s) index.set(target, s = new Map());
    s.set(mask * 256 + size, [mask, size]);
  };
  for (let p = image.indexOf(0xdd); p >= 0; p = image.indexOf(0xdd, p + 1)) {
    if (p + 7 <= n) add((p + le32(image, p + 1)) >>> 0, image[p + 5], image[p + 6]);
  }
  for (let p = image.indexOf(0xcd); p >= 0; p = image.indexOf(0xcd, p + 1)) {
    if (p + 5 <= n) add((p + le16s(image, p + 1)) >>> 0, image[p + 3], image[p + 4]);
  }
  FRAMES.set(image, index);
  return index;
}
export function install_core_index(sim, cpu = 0) { sim.word(CORE_INDEX, cpu); }
export function runtime(address) { return (address - BASE + IMAGE_BASE) >>> 0; }
export function disasm(address) { return (address - IMAGE_BASE + BASE) >>> 0; }
export function where(address) { return `0x${fx(address >>> 0, 8)} (disasm 0x${fx(disasm(address), 8)})`; }
const sortedPairs = (m) => [...m.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

export class HLE {
  // env: { rom (Uint8Array image), createHash, stats (Stats or null), observer factory... }; see Simulator.
  // env: { rom (the image, Uint8Array), createHash, clock?, beginSession? }. beginSession() returns the session's
  // { stats, attach(hle), close(hle, closeSim) }: the per-session hooks around HLE construction and close (Stats per
  // session, the tracer attached after init, devices read before close).
  constructor(env) {
    this.image = env.rom;
    this.env = env;
    this.session = env.beginSession ? env.beginSession(this) : null;     // the lab: a check tracer picks the format by its class
    this.sim = new Simulator({ ...env, stats: this.session ? this.session.stats : null }, this.constructor.INSN_LIMIT ?? null, this.constructor.KEEP_STDERR ?? false);
    this.hooks = new Map();
    this.log = [];
    this.heap = HEAP;
    this.frames = new Map();
    this.builtins = [];
    this.builtins_seen = 0;
    this.drained = 0;
    this.stubObserver = null;          // capture's on_stub patch (tracer)
    this.coverage = env.machine?.coverage ?? null;     // the machine's coverage collector: every stand-in that fires
    if (this.session) this.session.attach(this);
  }
  close() { if (this.session) this.session.close(this, () => this.sim.close()); else this.sim.close(); }
  // address in the disassembly notation (BASE + body offset): a runtime address of the image would be converted twice
  // and the hook would silently never fire, so one is refused (a plain Error: a caller bug, not a firmware outcome)
  hook(address, stub, name = null) {
    refuseUnmapped(address, `hook ${name ?? stub.name}`);
    if (address >= IMAGE_BASE && address < IMAGE_BASE + this.image.length) throw new Error(`hook ${name ?? stub.name}: 0x${fx(address >>> 0, 8)} is a runtime address (hook() takes the disassembly notation; hook_rt a runtime address)`);
    this.hooks.set(runtime(address), [stub, name ?? stub.name]);
  }
  // A hook keyed by a runtime address (a return address, a harness trampoline); a disassembly address is refused.
  hook_rt(address, stub, name) {
    refuseUnmapped(address, `hook ${name}`);
    if (address >= BASE && address < BASE + this.image.length) throw new Error(`hook ${name}: 0x${fx(address >>> 0, 8)} is a disassembly address (hook() converts it)`);
    this.hooks.set(address, [stub, name]);
  }
  // Layer a stub over the hook at address (disassembly notation): make(previous stub) gives the new one, named name or
  // the previous name. A missing hook is a port bug (the layer below did not install it). Returns the previous entry.
  wrap(address, make, name = null) {
    const prev = this.hooks.get(runtime(address));
    if (!prev) throw new Error(`wrap ${name ?? ''}: no hook at 0x${fx(address >>> 0, 8)} to wrap`);
    this.hook(address, make(prev[0]), name ?? prev[1]);
    return prev;
  }
  frame(fn) {
    if (this.frames.has(fn)) return this.frames.get(fn);
    const found = callFrames(this.image).get((fn - BASE) >>> 0) ?? new Map();
    if (found.size !== 1) throw new FirmwareError(`0x${fx(fn >>> 0, 8)}: call-site frames ${show(sortedPairs(found))}; pass frame=`);
    const f = [...found.values()][0];
    this.frames.set(fn, f);
    return f;
  }
  // The scan frame() used before the index: one pass over the image per function (check_perf P7 compares them).
  _scan_frame(fn) {
    const target = (fn - BASE) >>> 0, image = this.image, n = image.length, found = new Map();
    for (let p = image.indexOf(0xdd); p >= 0; p = image.indexOf(0xdd, p + 1)) {
      if (p + 7 <= n && ((p + le32(image, p + 1)) >>> 0) === target) found.set(image[p + 5] * 256 + image[p + 6], [image[p + 5], image[p + 6]]);
    }
    for (let p = image.indexOf(0xcd); p >= 0; p = image.indexOf(0xcd, p + 1)) {
      if (p + 5 <= n && ((p + le16s(image, p + 1)) >>> 0) === target) found.set(image[p + 3] * 256 + image[p + 4], [image[p + 3], image[p + 4]]);
    }
    if (found.size !== 1) throw new FirmwareError(`0x${fx(fn >>> 0, 8)}: call-site frames ${show(sortedPairs(found))}; pass frame=`);
    return [...found.values()][0];
  }
  finish(regs, results = {}) {
    const ra = regs.mdr, here = regs.pc;
    const longCall = this.sim.read(ra - 7, 7), shortCall = longCall.subarray(2);
    let mask, size;
    if (longCall[0] === 0xDD && ((ra - 7 + le32(longCall, 1)) >>> 0) === here) { mask = longCall[5]; size = longCall[6]; }
    else if (shortCall[0] === 0xCD && ((ra - 5 + le16s(shortCall, 1)) >>> 0) === here) { mask = shortCall[3]; size = shortCall[4]; }
    else throw new FirmwareError(`stub at ${where(here)} not reached by CALL (mdr ${where(ra)})`);
    this.sim.write(RETURN, bytes(0xDF, mask, size));
    const r = { ...regs, pc: RETURN, fault: 0 };
    for (const [name, value] of Object.entries(results)) r[name] = value >>> 0;
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  // From a hook on a CALL instruction: go on after it without running the callee (its registers stay as they are)
  skip_call(regs) {
    const here = regs.pc, op = this.sim.read(here, 1)[0];
    if (op !== 0xCD && op !== 0xDD) throw new FirmwareError(`skip at ${where(here)}: not a CALL`);
    const r = { ...regs, pc: (here + (op === 0xDD ? 7 : 5)) >>> 0, fault: 0 };
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  // From a hook inside the function the lab's call() entered with the frame [mask, size], its stack as that call left
  // it: return to the lab from here, as the function's own `ret [regs],size` would (the registers it saved restored)
  return_here(regs, [mask, size]) {
    this.sim.write(RETURN, bytes(0xDF, mask, size));
    const r = { ...regs, pc: RETURN, fault: 0 };
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  // finish() that first calls fn (disassembly notation) natively with the registers args ({d0: result} or {a0:
  // argument}) through `calls`, as a task calls a completion callback, then returns 0 in d0 from the hooked function
  finish_after(regs, fn, args) {
    const ra = regs.mdr, here = regs.pc;
    const longCall = this.sim.read(ra - 7, 7), shortCall = longCall.subarray(2);
    let mask, size;
    if (longCall[0] === 0xDD && ((ra - 7 + le32(longCall, 1)) >>> 0) === here) { mask = longCall[5]; size = longCall[6]; }
    else if (shortCall[0] === 0xCD && ((ra - 5 + le16s(shortCall, 1)) >>> 0) === here) { mask = shortCall[3]; size = shortCall[4]; }
    else throw new FirmwareError(`stub at ${where(here)} not reached by CALL (mdr ${where(ra)})`);
    refuseUnmapped(fn, 'finish_after');
    this.sim.write(RETURN, cat(bytes(0xfc, 0xff), u32le(runtime(fn) - RETURN), bytes(0x00, 0xDF, mask, size)));
    const r = { ...regs, pc: RETURN, fault: 0 };
    for (const [name, value] of Object.entries(args)) r[name] = value >>> 0;
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  finish_calls(regs, results = {}) {
    this._reached_by_calls(regs);
    this.sim.write(RETURN, bytes(0xf0, 0xfc));
    const r = { ...regs, pc: RETURN, fault: 0 };
    for (const [name, value] of Object.entries(results)) r[name] = value >>> 0;
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  // finish_after() for a function reached by `calls`: fn(args) through `calls` from a frame of CALLS_AFTER_FRAME bytes
  // below the return address the hooked function's `calls` left at (sp), which fn's own `calls` would overwrite, then
  // 0 in d0 and `rets` to that address
  finish_calls_after(regs, fn, args) {
    this._reached_by_calls(regs);
    refuseUnmapped(fn, 'finish_calls_after');
    this.sim.write(RETURN, cat(bytes(0xfc, 0xff), u32le(runtime(fn) - RETURN), bytes(0xf8, 0xfe, CALLS_AFTER_FRAME, 0x00, 0xf0, 0xfc)));
    const r = { ...regs, pc: RETURN, fault: 0, sp: (regs.sp - CALLS_AFTER_FRAME) >>> 0 };
    for (const [name, value] of Object.entries(args)) r[name] = value >>> 0;
    if (this.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
  }
  _reached_by_calls(regs) {
    const ra = regs.mdr, here = regs.pc;
    const top = this.sim.u32(regs.sp);
    if (top !== ra) {
      throw new FirmwareError(`stub at ${where(here)}: mem32[sp] 0x${fx(this.sim.u32(regs.sp), 8)} != mdr 0x${fx(ra, 8)}: not reached by CALLS`);
    }
    const before = this.sim.read(ra - 6, 6);
    if (!((before[4] === 0xF0 && before[5] >= 0xF0 && before[5] <= 0xF3) || (before[2] === 0xfa && before[3] === 0xff)
          || (before[0] === 0xfc && before[1] === 0xff))) {
      let h = ''; for (const b of before) h += b.toString(16).padStart(2, '0');
      throw new FirmwareError(`stub at ${where(here)} not reached by CALLS (mdr ${where(ra)}, bytes before ${h})`);
    }
  }
  call(fn, regs = null, stack = null, frame = null, limit = 5000) {
    refuseUnmapped(fn, 'call');
    const [mask, size] = frame ?? this.frame(fn);
    this.sim.write(CALLER, cat(bytes(0xdd), u32le(runtime(fn) - CALLER), bytes(mask, size, 0xff)));
    if (stack && stack.length) this.sim.write(SP + 4, stack);
    this.sim.reset({ pc: CALLER, sp: SP, ...SAVED, ...(regs ?? {}) });
    return this._loop(CALLER + 7, SP, limit);
  }
  calls(fn, regs = null, sp = SP, trampoline = CALLER, limit = 5000) {
    refuseUnmapped(fn, 'calls');
    this.sim.write(trampoline, cat(bytes(0xfc, 0xff), u32le(runtime(fn) - trampoline), bytes(0xff)));
    this.sim.reset({ pc: trampoline, sp, ...SAVED, ...(regs ?? {}) });
    return this._loop(trampoline + 6, sp, limit);
  }
  _loop(done, sp, limit) {
    this.call_depth = (this.call_depth ?? 0) + 1;
    try { return this._loop1(done, sp, limit); } finally { this.call_depth -= 1; }
  }
  _loop1(done, sp, limit) {
    let used = 0;
    while (used < limit) {
      const stops = new Set(this.hooks.keys());
      stops.add(done);
      // the PERF2 builtin pcs (HLE.builtins with the stub hooked by identity): JS keeps their breakpoints
      const folded = [];
      for (const [pc, stub] of [[runtime(MEMSET), memset], [runtime(MEMCPY), memcpy]]) {
        const hook = this.hooks.get(pc);
        if (hook !== undefined && hook[0] === stub && pc !== done) folded.push(pc);
      }
      this.drained = 0;
      const result = this.sim.run([...stops].sort((a, b) => a - b), false, null, folded);
      used += this.drained;
      const pc = result.pc;
      if (pc === done && !result.fault) {
        if (result.sp !== sp || Object.entries(SAVED).some(([k, v]) => result[k] !== v)) {
          throw new FirmwareError(`bad return state: ${show(result)}`);
        }
        return result;
      }
      const hook = this.hooks.get(pc);
      if (hook && !result.fault) {
        const [stub, name] = hook;
        used += 1;
        if (this.coverage !== null) this.coverage.stub(pc, name);
        this.on_stub(name);
        stub(this, result);
        continue;
      }
      throw new FirmwareError(`stopped at ${where(pc)} fault=${result.fault}: ${this.stderr_tail()}`);
    }
    throw new FirmwareError(`more than ${limit} stub calls`);
  }
  on_stub(name) {
    if (this.stubObserver) this.stubObserver(name);
    this.log.push(name);
  }
  stderr_tail(size = 600) { return this.sim.stderrTail(size); }
  install_base_stubs() {
    this.hook(MEMSET, memset, 'memset');
    this.hook(MEMCPY, memcpy, 'memcpy');
    this.hook(MALLOC, malloc, 'malloc');
    this.hook(FREE, free, 'free');
    if (MODEL_INFO.flash_core_id) this.hook(MODEL_INFO.flash_core_id, core_id, 'core-id');
  }
}
HLE.INSN_LIMIT = null;

export function memset(hle, r) {
  hle.sim.write(r.a0, new Uint8Array(r.d1).fill(r.d0 & 0xff));
  hle.finish(r, { a0: r.a0 });
}
export function memcpy(hle, r) {
  const data = new Uint8Array(r.d0);
  for (let o = 0; o < r.d0; o += 1024) data.set(hle.sim.read(r.a1 + o, Math.min(1024, r.d0 - o)), o);
  hle.sim.write(r.a0, data);
  hle.finish(r, { a0: r.a0 });
}
export function malloc(hle, r) {
  const address = hle.heap;
  hle.heap += Math.floor((r.d0 + 15) / 16) * 16;
  if (hle.heap > HEAP_END) throw new FirmwareError('HLE heap exhausted');
  hle.finish(r, { a0: address });
}
export function free(hle, r) { hle.finish(r); }
// the flash library's get-core-id of a later model: the core index the SRAM word holds (install_core_index)
export function core_id(hle, r) { hle.finish(r, { d0: hle.sim.u32(BOARD.core_byte) }); }
export const BUILTIN_STUBS = [memset, memcpy];

