// The debug API's call op: one firmware function run natively in a play session between ticks, through the lab's own
// call (src/lab/hle.mjs HLE.call), so every hook and stand-in of the session answers as it does for the lab's own calls
// (a raw single-step from the debugger runs past them). The live route (src/debug/live.mjs) serves it; a standalone
// machine has no harness and refuses it (protocol.mjs).
//   call {fn, space?, regs?, stack?, frame?, mem?, read?, restore?, limit?, scratch?}
//     fn       the function's entry: an address in the image's notation range (0x50000000 + body offset) or its
//              run-time range (IMAGE_BASE + body offset) is taken as such; space 'notation' or 'runtime' says which
//              for any other address (a function the lab names below the image, as its memcpy)
//     regs     {d0, d1, d2, d3, a0, a1, a2, a3}: the entry registers (the others are the harness's: sp, pc, mdr the
//              CALL's, psw 0 so no interrupt is taken, d2 d3 a2 a3 default to the lab's markers 0x22222222 ...)
//     stack    words stored from the harness stack's (4,sp) up before the CALL: at the callee's entry they are at
//              (size+4, sp), (size+8, sp), ... (size: the frame's)
//     frame    [mask, size]: the CALL's register mask and frame size; default the one every CALL d16 / d32 of fn in
//              the image uses (HLE.frame), refused when its call sites use several or none
//     mem      [[addr, hex | "=value"], ...] written in order before the call (the debugger's writes: no watchpoint,
//              no MMIO write); "=value" stores a 32-bit little-endian word
//     read     [[addr, len], ...] read after the call (also after a failed one), answered as hex
//     restore  true: mem's bytes put back after the reads (default false: they stay, as the write op's do)
//     limit    the instruction budget (default 1,000,000; at most the machine's insn limit, a play session's
//              200,000,000): the instructions run at the call's own level; a stand-in's own native calls run under
//              the machine's limit and are not counted (their stub calls are)
//     scratch  N bytes (at most SCRATCH_MAX) of the lab's data ring (OsdLab.alloc, zeroed) for the call; "scratch"
//              or "scratch+OFF" in regs, stack, mem (both sides) and read is its address; after the call its bytes
//              and the ring's next address are put back (the address only if no stand-in took a block from the
//              ring meanwhile: that block may be in use)
//   -> {fn: {given, notation, runtime}, frame, regs (the 16 at the return: pc and sp the harness's), steps (the
//      instructions run), stubs: [[name, calls], ...] (the harness stubs that answered, stand-ins among them, in the
//      order first called; the session's stand-in log keeps them, as it keeps the lab's own calls'), prints and
//      errlog (the kernel's print lines and error-log entries the call made), reads [{addr, hex}], scratch (its
//      address or null), restored, stderr (the machine's lines the call wrote)}
// The calling convention is the lab's: the harness writes `call fn,[mask],size` at CALLER and starts it with sp
// SP_TOP; the CALL stores the return address at (0,sp) of that sp, the masked registers below it, moves sp down by
// size and writes the return address to mdr; fn returns with ret / retf to CALLER+7, where the call ends: sp must be
// back at SP_TOP and d2 d3 a2 a3 as they started (else 'bad return state').
// After the call, failed or not, the machine is as before: all 20 registers (the insn count among them), the harness's
// trampoline bytes, the stack words, the scratch, mem's bytes under restore, the breakpoints and the live debugger's
// hook; the session's Stats and capture tracer see none of it. What the function itself did stays: memory it wrote,
// a stand-in's state it moved (S-HEAP's next block, a queue a hook filled), the frames it left on the harness stack
// below SP_TOP (dead memory the lab's next call overwrites). A call that ends on its budget answers CallLimit, a CPU
// fault CallFault; a lab error (a hook's refusal, a bad return state) answers under its own type; each carries detail
// (pc, steps, stubs, reads, stderr; fault). A host error (Unported: a device path the lab has not ported; or, with
// --loaded on, code the boot does not load or is not shown to load, S-STALERAM) stops the machine mid-instruction, as
// in a tick: the session cannot go on, and nothing above is put back. A fn in such a range is refused before the call
// (BadRequest, the range named), so the session goes on; a callee that reaches one answers UnloadedCode, its detail
// with restored false: every later run or write of the session fails (HostStopped).
import { BadRequest, num, addr, word, count, list, dict } from './protocol.mjs';
import { regsHex, hex8 } from './regs.mjs';
import { IMAGE_BASE, IMAGE_END } from '../fw/model.mjs';
import { CALLER, RETURN, SP as SP_TOP, DATA, DATA_END, BASE, runtime, disasm } from '../lab/hle.mjs';
import { LabError } from '../lab/errors.mjs';
import { gapAt } from '../fw/sections.mjs';

export const CALL_REGS = ['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3'];
export const SCRATCH_MAX = 0x40000, STACK_MAX = 256, LIMIT_DEFAULT = 1000000;
const IMAGE_LEN = IMAGE_END - IMAGE_BASE;
const absent = (v) => v === undefined || v === null;
const REF = /^\s*scratch\s*(?:\+\s*(0x[0-9a-f]+|[0-9]+)\s*)?$/i;
const HEXRE = /^(?:[0-9a-fA-F]{2})*$/;
export class CallLimit extends Error { constructor(m, detail) { super(m); this.name = 'CallLimit'; this.detail = detail; } }
export class CallFault extends Error { constructor(m, detail) { super(m); this.name = 'CallFault'; this.detail = detail; } }

// A value that may name the scratch: {off} (resolved once the scratch is placed) or a number (u32 / address).
function valueOrRef(v, what, kind) {
  if (typeof v === 'string' && REF.test(v)) return { off: Number(REF.exec(v)[1] ?? 0), what };
  return kind === 'addr' ? addr(v, what) : word(v, what);
}
// fn and space -> {given, notation, runtime}
export function callTarget(fn, space) {
  const a = addr(fn, 'fn');
  if (!absent(space) && space !== 'notation' && space !== 'runtime') throw new BadRequest(`space: 'notation' or 'runtime', got ${JSON.stringify(space)}`);
  let given = space ?? null;
  if (given === null) {
    if (a >= BASE && a < BASE + IMAGE_LEN) given = 'notation';
    else if (a >= IMAGE_BASE && a < IMAGE_END) given = 'runtime';
    else throw new BadRequest(`fn: ${hex8(a)} is in neither the image's notation range [${hex8(BASE)}, ${hex8(BASE + IMAGE_LEN)}) nor its run-time range [${hex8(IMAGE_BASE)}, ${hex8(IMAGE_END)}): give space 'notation' or 'runtime'`);
  }
  return given === 'notation' ? { given, notation: a, runtime: runtime(a) } : { given, notation: disasm(a), runtime: a };
}
// The request's fields checked and normalised (BadRequest on a malformed one); firmware-free.
export function callSpec(q) {
  const target = callTarget(q.fn, q.space);
  const scratch = absent(q.scratch) ? 0 : count(q.scratch, 'scratch');
  if (scratch > SCRATCH_MAX) throw new BadRequest(`scratch: ${scratch} bytes is over ${SCRATCH_MAX} (the lab's data ring is shared with the session's own messages)`);
  const regs = {};
  for (const [k, v] of Object.entries(absent(q.regs) ? {} : dict(q.regs, 'regs'))) {
    if (!CALL_REGS.includes(k)) throw new BadRequest(`regs: ${JSON.stringify(k)} is not one of ${CALL_REGS.join(', ')} (sp, pc and mdr are the harness's and the CALL's, psw 0)`);
    regs[k] = valueOrRef(v, `regs.${k}`, 'word');
  }
  const stack = absent(q.stack) ? [] : list(q.stack, 'stack').map((v, i) => valueOrRef(v, `stack[${i}]`, 'word'));
  if (stack.length > STACK_MAX) throw new BadRequest(`stack: ${stack.length} words is over ${STACK_MAX}`);
  let frame = null;
  if (!absent(q.frame)) {
    const f = list(q.frame, 'frame');
    if (f.length !== 2) throw new BadRequest(`frame: [mask, size], got ${JSON.stringify(q.frame)}`);
    frame = f.map((x, i) => { const v = num(x, `frame[${i}]`); if (v < 0 || v > 255) throw new BadRequest(`frame[${i}]: ${JSON.stringify(x)} is not a byte`); return v; });
  }
  const mem = (absent(q.mem) ? [] : list(q.mem, 'mem')).map((e, i) => {
    if (list(e, `mem[${i}]`).length !== 2) throw new BadRequest(`mem[${i}]: [addr, hex | "=value"]`);
    const [a, h] = e;
    const at = valueOrRef(a, `mem[${i}] addr`, 'addr');
    if (typeof h === 'string' && h.startsWith('=')) return { at, word: valueOrRef(h.slice(1), `mem[${i}] value`, 'word'), len: 4 };
    if (typeof h !== 'string' || !HEXRE.test(h)) throw new BadRequest(`mem[${i}]: an even-length hex string or "=value", got ${JSON.stringify(h)}`);
    return { at, bytes: Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)), len: h.length / 2 };
  });
  const read = (absent(q.read) ? [] : list(q.read, 'read')).map((e, i) => {
    if (list(e, `read[${i}]`).length !== 2) throw new BadRequest(`read[${i}]: [addr, len]`);
    return { at: valueOrRef(e[0], `read[${i}] addr`, 'addr'), len: count(e[1], `read[${i}] len`) };
  });
  if (!absent(q.restore) && typeof q.restore !== 'boolean') throw new BadRequest(`restore: true or false, got ${JSON.stringify(q.restore)}`);
  const limit = absent(q.limit) ? LIMIT_DEFAULT : count(q.limit, 'limit', 1);
  // a scratch reference needs the scratch, and stays inside it (a pointer may be its end)
  const inside = (r, len, ptr) => {
    if (typeof r === 'number') return;
    if (!scratch) throw new BadRequest(`${r.what}: "scratch" without a scratch size`);
    if (r.off + len > scratch || (!ptr && len === 0 && r.off >= scratch)) throw new BadRequest(`${r.what}: scratch+${r.off} (${len} bytes) is outside the ${scratch} bytes of scratch`);
  };
  for (const v of [...Object.values(regs), ...stack]) inside(v, 0, true);
  for (const m of mem) { inside(m.at, m.len, false); if (m.word !== undefined) inside(m.word, 0, true); }
  for (const r of read) inside(r.at, r.len, false);
  return { target, regs, stack, frame, mem, read, restore: q.restore === true, limit, scratch };
}

const le4 = (v) => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Run spec (callSpec's) on the session's lab between ticks; dbg: the live route's attached Debugger.
export function runCall(lab, dbg, spec) {
  const sim = lab.sim, m = sim.m, { target, limit } = spec, fn = target.notation;
  if ((lab.call_depth ?? 0) !== 0) throw new BadRequest('call: the lab is inside a call of its own');
  const cap = m.insnLimit();
  if (!cap) throw new BadRequest('call: the machine has no insn limit to bound the call by');
  if (limit > cap) throw new BadRequest(`limit: ${limit} is over the machine's insn limit ${cap}`);
  // S-STALERAM: a fn the fetch guard would refuse, refused before the call stops the machine
  const un = sim.unloaded ?? null, g = un ? gapAt(un.gaps, target.runtime) : null;
  if (g) throw new BadRequest(`call ${hex8(fn)} (run-time ${hex8(target.runtime)}): refused before it runs: ${un.message(g, target.runtime)}`);
  let frame = spec.frame;
  if (frame === null) {
    try { frame = lab.frame(fn); } catch (e) {
      if (!(e instanceof LabError)) throw e;
      throw new BadRequest(`fn ${hex8(fn)}: ${e.message.replace(/; pass frame=$/, '')}: give frame [mask, size]`);
    }
  }
  const saved = m.getRegs().slice(), labRegs = [16, 17, 18, 19].map((n) => m.getReg(n));
  const keep = { stats: sim.stats, observer: sim.observer, stub: lab.stubObserver, debug: sim.debug, bps: [...sim.breakpoints], data: lab.data };
  const n0 = lab.log.length, ev0 = lab.kernel?.events.length ?? 0, err0 = lab.kernel?.errors.length ?? 0, k0 = m.stderrCount();
  const undo = [];                   // [address, bytes]: put back last first
  const keepBytes = (a, n) => { if (n) undo.push([a >>> 0, dbg.read(a >>> 0, n)]); };
  if (spec.scratch && typeof lab.alloc !== 'function') throw new BadRequest('scratch: this lab has no data ring');
  keepBytes(CALLER, 8); keepBytes(RETURN, 16); keepBytes(SP_TOP + 4, 4 * spec.stack.length);
  let base = null;
  const val = (v) => (typeof v === 'number' ? v : base + v.off) >>> 0;
  const start = cap - limit, out = { fn: { given: target.given, notation: hex8(target.notation), runtime: hex8(target.runtime) }, frame };
  sim.stats = null; sim.observer = null; lab.stubObserver = null; sim.debug = null;
  let failure = null, result = null, thrown = null;
  try {
    if (spec.scratch) {                                // OsdLab.alloc's placement, its bytes kept first
      const up = (v) => Math.ceil(v / 16) * 16;
      let at = up(lab.data);
      if (at + spec.scratch > DATA_END) at = up(DATA);
      keepBytes(at, spec.scratch);
      base = lab.alloc(new Uint8Array(spec.scratch), 16);
      if (base !== at) throw new Error(`call: the data ring placed the scratch at ${hex8(base)}, not ${hex8(at)}`);
    }
    for (const w of spec.mem) {
      const a = val(w.at), b = w.word !== undefined ? le4(val(w.word)) : w.bytes;
      if (spec.restore) keepBytes(a, b.length);
      dbg.write(a, b);
    }
    const regs = Object.fromEntries(Object.entries(spec.regs).map(([k, v]) => [k, val(v)]));
    const stack = spec.stack.length ? new Uint8Array(4 * spec.stack.length) : null;
    spec.stack.forEach((v, i) => stack.set(le4(val(v)), 4 * i));
    try { result = lab.call(fn, { ...regs, insns: start }, stack, frame, limit); } catch (e) {
      if (!(e instanceof LabError)) throw e;
      failure = e;
    }
    const now = m.getRegs(), steps = now[15] - start, pc = hex8(now[9]);
    out.steps = steps;
    const stubs = new Map();
    for (const name of lab.log.slice(n0)) stubs.set(name, (stubs.get(name) ?? 0) + 1);
    out.stubs = [...stubs];
    if (lab.kernel) {
      out.prints = lab.kernel.events.slice(ev0).filter((e) => e[0] === 'print').map((e) => e[2].trim());
      out.errlog = lab.kernel.errors.slice(err0).map(([c, , , caller]) => [hex8(c), caller]);
    }
    out.reads = spec.read.map((r) => ({ addr: hex8(val(r.at)), hex: toHex(dbg.read(val(r.at), r.len)) }));
    if (failure) {
      const st = m.lastStop(), detail = { pc, steps, stubs: out.stubs, reads: out.reads, stderr: m.stderrFrom(k0).lines };
      const at = `call ${hex8(fn)} (run-time ${hex8(target.runtime)})`;
      if (m.failed() !== null) {          // a host error the lab wrapped (S-STALERAM's UnloadedCode): the machine stopped
        const e = new Error(`${at}: ${failure.message}; the machine stopped on this host error, so the session cannot go on (nothing was put back; every later run or write fails with HostStopped)`);
        Object.defineProperty(e, 'name', { value: m.failed().name ?? 'HostError' });
        e.detail = { ...detail, restored: false };
        throw e;
      }
      if (st?.kind === 'limit') {          // the limit's fault 7 counts in insns, its instruction did not run
        detail.steps = limit;
        throw new CallLimit(`${at}: the budget of ${limit} instructions ran out at pc ${pc}`, detail);
      }
      if (/^more than \d+ stub calls$/.test(failure.message)) throw new CallLimit(`${at}: more than ${limit} stub calls (the budget) by pc ${pc}`, detail);
      if (st?.kind === 'fault' && now[14]) throw new CallFault(`${at}: fault ${now[14]} at pc ${pc}`, { ...detail, fault: now[14] });
      const e = new Error(`${at}: ${failure.message}`);
      Object.defineProperty(e, 'name', { value: failure.name });
      e.detail = detail;
      throw e;
    }
    out.regs = regsHex(Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'insns')));
    out.scratch = base === null ? null : hex8(base);
    out.restored = spec.restore;
    out.stderr = m.stderrFrom(k0).lines;
    return out;
  } catch (e) { thrown = e; throw e; } finally {
    sim.stats = keep.stats; sim.observer = keep.observer; lab.stubObserver = keep.stub; sim.debug = keep.debug;
    // the ring goes back to where it was unless a stand-in allocated from it during the call (its block may be in use)
    if (base !== null && lab.data === base + spec.scratch) lab.data = keep.data;
    try {
      for (let i = undo.length - 1; i >= 0; i--) dbg.write(undo[i][0], undo[i][1]);
      m.setRegs(saved);
      labRegs.forEach((v, i) => m.setReg(16 + i, v));
      sim.break_at(keep.bps);
    } catch (e) { if (thrown === null) throw e; }    // a machine a host error stopped refuses them: that error is the answer
  }
}
