// The Cortex-M4 core's differential cases (tools/m4-oracle/oracle.mjs runs them on QEMU's mps2-an386 in the om-emu
// VM; test_m4.mjs replays the recorded ones, test/fixtures/m4_vectors.json, on the JS core). A case is a short
// instruction sequence of our own generation (never firmware) with an initial state that a seed determines:
//   { seed, code: [halfwords], set: { reg: value } }   (set: registers a branch's fix-up gave a target)
// The layout both engines share: a boot image at 0 (vector table, one `b .` stub per system exception at STUB(n), an
// idle loop, the MSR prologue the oracle runs in QEMU to set the system registers), the case's code at CODE ending in
// `b .` at END, and an 8 KiB data window at WINDOW that every register pointer and the stacks lie in. A case ends
// when pc reaches END or a stub (an exception taken); the result is the registers, the system registers, the FP
// registers, CFSR / HFSR and the window's changed bytes.
import { CortexM4, STEP_OK } from '../src/core/m4/cpu.mjs';
import { MemoryBus } from '../src/core/m4/bus.mjs';

export const CODE = 0x1000, WINDOW = 0x20000000, WSIZE = 0x2000, LOW = 0x2000;
export const STUB = (n) => 0x200 + 4 * n, IDLE = 0x310, PROLOGUE = 0x340, PROLOGUE_END = PROLOGUE + 24;
export const MAX_STEPS = 64;

export function rng(seed) {                  // xorshift32: a fixed sequence per seed
  let x = (Math.imul(seed | 0, 0x9e3779b9) >>> 0) || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  return { u32: next, below: (n) => next() % n, bytes: (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = next() & 255; return b; } };
}

// the boot image: SP, reset = IDLE; exceptions 2..15 at their stubs; the prologue
//   msr msp, r4; msr psp, r0; msr basepri, r1; msr primask, r2; msr control, r3; isb; b .
export function bootImage() {
  const img = new Uint8Array(0x400);
  const w32 = (o, v) => { img[o] = v; img[o + 1] = v >>> 8; img[o + 2] = v >>> 16; img[o + 3] = v >>> 24; };
  const w16 = (o, v) => { img[o] = v; img[o + 1] = v >>> 8; };
  w32(0, WINDOW + 0x1800);
  w32(4, IDLE | 1);
  for (let n = 2; n < 16; n++) { w32(4 * n, STUB(n) | 1); w16(STUB(n), 0xe7fe); }
  w16(IDLE, 0xe7fe);
  [0xf384, 0x8808, 0xf380, 0x8809, 0xf381, 0x8811, 0xf382, 0x8810, 0xf383, 0x8814, 0xf3bf, 0x8f6f, 0xe7fe]
    .forEach((h, i) => w16(PROLOGUE + 2 * i, h));
  return img;
}

// the initial state a seed gives: registers (half of them pointers into the window), flags, the two stacks, CONTROL's
// SPSEL and FPCA, PRIMASK, BASEPRI, the FPU's enable (CPACR), S0..S31, FPSCR and the window's bytes
export function initialState(seed) {
  const g = rng(seed);
  const ptr = (align) => (WINDOW + 0x800 + (g.below(0x1000) & ~(align - 1))) | 0;
  const r = new Int32Array(16);
  for (let k = 0; k < 13; k++) {
    const kind = g.below(8);
    r[k] = kind < 3 ? ptr(g.below(4) ? 4 : 1) : kind < 4 ? g.below(64) : kind < 5 ? -g.below(64) : g.u32() | 0;
  }
  r[14] = g.u32() | 0;
  const msp = (WINDOW + 0x1400 + 8 * g.below(64)) | 0, psp = (WINDOW + 0x0c00 + 8 * g.below(64)) | 0;
  const fp = g.below(4) !== 0;
  const control = (g.below(3) === 0 ? 2 : 0) | (fp && g.below(3) === 0 ? 4 : 0);
  const primask = g.below(4) === 0 ? 1 : 0;
  const basepri = g.below(4) === 0 ? (1 + g.below(15)) << 4 : 0;
  const xpsr = ((g.u32() & 0xf8000000) | (g.below(16) << 16) | 0x01000000) | 0;
  const s = new Int32Array(32);
  for (let i = 0; i < 32; i++) s[i] = g.u32() | 0;
  const fpscr = g.u32() & 0xf7c0009f;
  const window = g.bytes(WSIZE);
  r[13] = control & 2 ? psp : msp;
  return { r, xpsr, msp, psp, control, primask, basepri, fp, s, fpscr, window };
}

// the low memory both engines see: the boot image and the case's code (zero elsewhere)
export function lowImage(code) {
  const low = new Uint8Array(LOW);
  low.set(bootImage());
  code.forEach((h, i) => { low[CODE + 2 * i] = h & 0xff; low[CODE + 2 * i + 1] = h >>> 8; });
  const end = CODE + 2 * code.length;
  low[end] = 0xfe; low[end + 1] = 0xe7;
  return low;
}
export const endOf = (kase) => CODE + 2 * kase.code.length;

class Drop extends Error {}
const STUBS = new Set(Array.from({ length: 14 }, (_, i) => STUB(i + 2)));

// a case's machine on the JS core at the case's initial state: { cpu, bus, st, win, end, restart }. Low memory is ROM
// (a write to it leaves the layout), so the cached tier keeps the case's decoded instructions; restart() puts the same
// machine back to the initial state with those kept (cpu.resetCore), a second pass of the same code. tier, mutant: the
// core's (cpu.mjs), with a decode cache of 256 slots (the case's code at CODE takes at most 10, none shared); Bus: the
// bus class (a MemoryBus).
export function setupJs(kase, { prioBits = 4, tier = 'reference', mutant = 0, Bus = MemoryBus } = {}) {
  const st = initialState(kase.seed);
  for (const [k, v] of Object.entries(kase.set || {})) st.r[Number(k)] = v | 0;
  const low = lowImage(kase.code), win = st.window.slice();
  const bus = new Bus({ unmapped: (a, size, w) => { throw new Drop(`${w ? 'write' : 'read'} 0x${(a >>> 0).toString(16)}`); } });
  bus.rom(0, low);
  bus.add({ base: WINDOW, end: WINDOW + WSIZE, bytes: win, rom: false });
  const cpu = new CortexM4({ bus, prioBits, tier, mutant, dcacheBits: 8 });
  const sys = cpu.sys;
  // the state the QEMU prologue makes: MSP, PSP, BASEPRI, PRIMASK, CONTROL, then the registers
  const start = () => {
    sys.cpacr = st.fp ? 0x00f00000 : 0;
    cpu.setMsp(st.msp);
    cpu.psp = st.psp;
    cpu.basepri = st.basepri; cpu.primask = st.primask;
    cpu.switchStack(() => { cpu.control = st.control & 2; });
    cpu.control |= st.control & 4;
    for (let k = 0; k < 13; k++) cpu.r[k] = st.r[k];
    cpu.r[13] = st.r[13]; cpu.r[14] = st.r[14];
    cpu.setXpsr(st.xpsr);
    cpu.s.set(st.s); cpu.fpscr = st.fpscr;
    cpu.pc = CODE; cpu.irqDirty = true;
  };
  start();
  sys.read = () => { throw new Drop('system space read'); };
  sys.write = () => { throw new Drop('system space write'); };
  const restart = () => {
    win.set(st.window); bus.written(WINDOW, WSIZE);
    cpu.resetCore();
    start();
  };
  return { cpu, bus, st, win, end: endOf(kase), restart };
}
// the case has ended: pc at END or at an exception's stub
export const caseOver = (m) => m.cpu.pc === m.end || STUBS.has(m.cpu.pc);
// one step of a case: null, or why the case leaves the layout (runJs's drop)
export function stepCase(m) {
  const cpu = m.cpu;
  try {
    if (cpu.pc < CODE || cpu.pc > m.end) throw new Drop(`pc 0x${(cpu.pc >>> 0).toString(16)}`);
    const r = cpu.step();
    if (r !== STEP_OK) throw new Drop(`step result ${r}`);
    return null;
  } catch (e) {
    if (e instanceof Drop || e.name === 'Unimplemented') return e.message;
    throw e;
  }
}

// run a case on the JS core: its result, or { drop } when the case leaves the layout (an access outside the window, a
// write to low memory, the system space, more than MAX_STEPS steps, pc outside the code, an Unimplemented)
export function runJs(kase, opts = {}) {
  const m = setupJs(kase, opts);
  let steps = 0;
  for (; steps < MAX_STEPS && !caseOver(m); steps++) {
    const drop = stepCase(m);
    if (drop) return { drop };
  }
  if (steps === MAX_STEPS) return { drop: 'steps' };
  return result(m.cpu, m.st.window, m.win, steps);
}

function result(cpu, before, after, steps) {
  const mem = [];
  for (let i = 0; i < WSIZE; i++) if (before[i] !== after[i]) mem.push([i, after[i]]);
  const r = Array.from(cpu.r); r[15] = cpu.pc;
  return { pc: cpu.pc, r, xpsr: cpu.xpsr(), msp: cpu.getMsp(), psp: cpu.getPsp(), primask: cpu.primask, basepri: cpu.basepri,
    faultmask: cpu.faultmask, control: cpu.control, s: Array.from(cpu.s), fpscr: cpu.fpscr, cfsr: cpu.sys.cfsr, hfsr: cpu.sys.hfsr | 0, mem, steps };
}

// the differences between two results (steps are the JS core's only)
export function differ(a, b) {
  const out = [];
  const hx = (v) => '0x' + (v >>> 0).toString(16);
  for (let k = 0; k < 16; k++) if ((a.r[k] | 0) !== (b.r[k] | 0)) out.push(`r${k} ${hx(a.r[k])} != ${hx(b.r[k])}`);
  for (const f of ['xpsr', 'msp', 'psp', 'primask', 'basepri', 'faultmask', 'control', 'fpscr', 'cfsr', 'hfsr']) {
    if ((a[f] | 0) !== (b[f] | 0)) out.push(`${f} ${hx(a[f])} != ${hx(b[f])}`);
  }
  for (let k = 0; k < 32; k++) if ((a.s[k] | 0) !== (b.s[k] | 0)) { out.push(`s${k} ${hx(a.s[k])} != ${hx(b.s[k])}`); break; }
  const ma = new Map(a.mem), mb = new Map(b.mem);
  for (const [o, v] of ma) if (mb.get(o) !== v) { out.push(`window +0x${o.toString(16)}: ${v} != ${mb.get(o)}`); break; }
  for (const [o, v] of mb) if (!ma.has(o)) { out.push(`window +0x${o.toString(16)}: unchanged != ${v}`); break; }
  return out;
}
