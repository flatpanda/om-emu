// The CPU core's two execution tiers against each other, with no firmware (bin/test.mjs --tier=pure):
// - lockstep: seeded random states (registers, flags, UNDEF/HAZ, unit registers, memory windows, an instruction
//   stream) run one instruction through the CPU's own step (step) and through the decoded-cache interpreter
//   (run(1)), which must leave identical registers, instruction counts and memory. Mutant 7 (the interpreter's ASL2
//   with clobbered flags) must make it fail: the differential's own sensitivity check.
// - lengths: every (op, p) pair: insnLength (cpu.mjs) against check_isa's instructionLength (checks/lib/isa.mjs), and
//   for the forms the interpreter does not treat as transfers (interp.mjs transfers()), the next pc after a
//   non-faulting step() is pc + insnLength on every sampled state.
//   node emu/test/test_core.mjs
import { createMachine } from '../src/machine.mjs';
import { R, S, PC, PSW, FAULT, UNDEF, HAZ, HI, UC, UD, UV, insnLength, step } from '../src/core/cpu.mjs';
import { run, transfers } from '../src/core/interp.mjs';
import { Fault } from '../src/core/mem.mjs';
import { instructionLength } from '../checks/lib/isa.mjs';

const CODE = 0x1000;
const WINDOWS = [[0x8000, 0x100], [0x10000, 0x400], [0x20000, 0x200]];
const PTRS = [0x8000, 0x8080, 0x10000, 0x10200, 0x10300, 0x20000, 0x20100, 0x201f0];
const hex = (v) => (v >>> 0).toString(16);

function rng(seed) {                        // xorshift32: a fixed sequence per seed
  let x = (seed * 0x9E3779B9) >>> 0 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  return { u32: next, below: (n) => next() % n, bytes: (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = next() & 255; return b; } };
}

// One random state: registers (an address register or two inside a window, so memory forms reach RAM), PSW, the
// undefined-flag set and hazard, the unit registers, the windows and 16 bytes of code at CODE.
function state(g) {
  const r = new Int32Array(R.length);
  for (let k = 0; k < 14; k++) r[k] = g.u32() | 0;
  for (let k = 4; k < 8; k++) if (g.below(4)) r[k] = (PTRS[g.below(PTRS.length)] + (g.below(16) & ~3)) | 0;
  for (let k = 0; k < 4; k++) if (!g.below(4)) r[k] = (PTRS[g.below(PTRS.length)] + g.below(16)) | 0;
  r[8] = (0x20100 + 4 * g.below(16)) | 0;                         // sp inside the stack window
  r[PC] = CODE;
  r[PSW] = g.u32() & 0xffff;
  r[UNDEF] = g.below(3) ? 0 : g.u32() & 15;
  r[HAZ] = g.below(8) ? 0 : 1;
  r[HI] = g.u32() | 0; r[UC] = g.u32() | 0; r[UD] = g.u32() | 0; r[UV] = g.below(2);
  return { r, code: g.bytes(16), win: WINDOWS.map(([, n]) => g.bytes(n)) };
}

function load(m, st) {
  m.dbgWrite(CODE, st.code);                 // a debugger write drops the decode-cache slots it covers
  WINDOWS.forEach(([a], w) => m.dbgWrite(a, st.win[w]));
  R.set(st.r); R[FAULT] = 0;
  S.insns = 0; S.limit = 0; S.irqReq = false; S.irqWait = false; S.kick = false; S.exitReq = false;
}
function result(m) {
  return { r: R.slice(), insns: S.insns, mem: [[CODE, 16], ...WINDOWS].map(([a, n]) => m.dbgRead(a, n)) };
}
function differ(a, b) {
  const out = [];
  for (let k = 0; k < R.length; k++) if (a.r[k] !== b.r[k]) out.push(`R[${k}] ${hex(a.r[k])} != ${hex(b.r[k])}`);
  if (a.insns !== b.insns) out.push(`insns ${a.insns} != ${b.insns}`);
  a.mem.forEach((x, i) => { const y = b.mem[i]; for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) { out.push(`memory window ${i} byte ${j}`); break; } });
  return out;
}

export function lockstep({ cases = 30000, seed = 1, mutant = 0 } = {}) {
  const m = createMachine({ rom: new Uint8Array(0), mutant });
  const g = rng(seed), bad = [];
  let faults = 0;
  for (let i = 0; i < cases; i++) {
    const st = state(g);
    load(m, st);
    try { step(); } catch (e) { if (!(e instanceof Fault)) throw e; faults++; }
    const port = result(m);
    load(m, st);
    run(1);
    const cached = result(m);
    const d = differ(port, cached);
    if (d.length) bad.push(`case ${i} (code ${[...st.code.subarray(0, 7)].map((b) => b.toString(16).padStart(2, '0')).join('')}, HAZ ${st.r[HAZ]}, UNDEF ${st.r[UNDEF]}): ${d.slice(0, 4).join('; ')}`);
  }
  return { cases, faults, bad };
}

export function lengths({ samples = 4, seed = 2 } = {}) {
  const m = createMachine({ rom: new Uint8Array(0) });
  const g = rng(seed), bad = [];
  let pairs = 0, ran = 0;
  for (let op = 0; op < 256; op++) {
    const prefixed = op >= 0xf0 && op <= 0xfe && op !== 0xf7;
    for (let p = 0; p < (prefixed || op === 0xfe ? 256 : 1); p++) {
      pairs++;
      const len = insnLength(op, p);
      if (len !== instructionLength(op, p)) bad.push(`(${hex(op)}, ${hex(p)}): insnLength ${len}, check_isa's instructionLength ${instructionLength(op, p)}`);
      if (transfers(op, p)) continue;
      for (let s = 0; s < samples; s++) {
        const st = state(g);
        st.code[0] = op; st.code[1] = prefixed || op === 0xfe ? p : st.code[1];
        st.r[HAZ] = 0;
        load(m, st);
        try { step(); } catch (e) { if (!(e instanceof Fault)) throw e; continue; }
        ran++;
        if (R[PC] !== ((CODE + len) | 0)) { bad.push(`(${hex(op)}, ${hex(p)}): not a transfer for the interpreter, but step() went from 0x${hex(CODE)} to 0x${hex(R[PC])} (length ${len})`); break; }
      }
    }
  }
  return { pairs, ran, bad };
}

export function coreTests() {
  const ls = lockstep(), lm = lockstep({ cases: 3000, mutant: 7 }), ln = lengths();
  const bad = [...ls.bad.slice(0, 10), ...ln.bad.slice(0, 10)];
  if (ls.faults === ls.cases || ls.faults < ls.cases / 20) bad.push(`lockstep: ${ls.faults} of ${ls.cases} cases fault (want a mix)`);
  if (!lm.bad.length) bad.push('lockstep with mutant 7 (ASL2 flags clobbered in the interpreter) found no difference');
  return { lockstep: ls, mutant: lm, lengths: ln, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = coreTests();
  console.log(`core lockstep step() vs run(1): ${r.lockstep.cases - r.lockstep.bad.length}/${r.lockstep.cases} identical (${r.lockstep.faults} faulting); mutant 7 caught in ${r.mutant.bad.length}/${r.mutant.cases}; lengths: ${r.lengths.pairs} (op, p) pairs, ${r.lengths.ran} non-faulting steps of non-transfer forms`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
