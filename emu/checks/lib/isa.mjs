// The ISA vector replay machinery, shared by checks/check_isa.mjs and checks/check_perf.mjs: the vector cases
// (unpack), the three RAM windows from random.Random(seed).randbytes, the lab unit registers through 'p'/'P', one
// vector's replay by single steps, the comparison with its committed output, the firmware functions (HLE.call
// against refs/isafw.mjs), the cross-page fetch checks and the insn-limit checks.
import fs from 'node:fs';
import { newRandom } from './rngtape.mjs';
import { labEnv } from './env.mjs';
import { Simulator } from '../../src/lab/sim.mjs';
import { HLE } from '../../src/lab/hle.mjs';
import { RuntimeError, AssertionError } from '../../src/lab/errors.mjs';
import { show } from '../../src/util/show.mjs';
import { hexBytes, bytesHex } from '../../src/util/bytes.mjs';
import { firmwareCases, want32, regs32 } from '../../refs/isafw.mjs';

export const CODE = 0x1000, SP0 = 0x20100;
export const ABS = 0x8000, DATA = 0x10000, STACK = 0x20000;
export const WINDOWS = [[ABS, 0x100], [DATA, 0x400], [STACK, 0x200]];
export const AWIN = [0x10100, 0x10300];
export const REGS = ['d0', 'd1', 'd2', 'd3', 'a0', 'a1', 'a2', 'a3', 'sp', 'pc', 'psw', 'mdr', 'lir', 'lar'];
export const FAULTS = { 0: 'none', 1: 'opcode', 2: 'bus', 3: 'align', 4: 'regmask', 5: 'break', 6: 'undefined', 7: 'limit' };
export const UNIT_REGS = [16, 17, 18, 19];
const x8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const x4 = (v) => (v >>> 0).toString(16).padStart(4, '0');

export const loadVectors = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export function unpack(c, index) { return { base: CODE, steps: 1, ...c, id: index }; }
export function windowBytes(seed) { const r = newRandom(seed); return WINDOWS.map(([, size]) => r.randbytes(size)); }

export function instructionLength(op, p) {
  if (op <= 0x0F) return op & 3 ? 3 : 1;
  if (op <= 0x1F) return 1;
  if (op <= 0x23 || (op >= 0x28 && op <= 0x2B)) return 2;
  if (op <= 0x3B) return 3;
  if (op <= 0x3F) return 1;
  if (op <= 0x4F) return (op & 3) >= 2 ? 2 : 1;
  if (op <= 0x57) return 1;
  if (op <= 0x5F) return 2;
  if (op <= 0x7F) return 1;
  if (op <= 0xBF) return ((op >> 2) & 3) === (op & 3) ? 2 : 1;
  if (op <= 0xCA) return 2;
  const fixed = { 0xCB: 1, 0xCC: 3, 0xCD: 5, 0xCE: 2, 0xCF: 2, 0xDC: 5, 0xDD: 7, 0xDE: 3, 0xDF: 3, 0xF7: 1, 0xF8: 3, 0xF9: 3, 0xFA: 4, 0xFB: 4, 0xFC: 6, 0xFD: 6, 0xFF: 1 };
  if (Object.hasOwn(fixed, op)) return fixed[op];
  if (op === 0xFE) return p & 0x80 ? 5 : 7;
  return op <= 0xEF ? 1 : 2;
}

export function setUnit(sim, unit) {
  UNIT_REGS.forEach((reg, k) => {
    const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, unit[k] >>> 0, true);
    if (sim.packet(`P${reg.toString(16)}=${bytesHex(b)}`) !== 'OK') throw new AssertionError('');
  });
}
export function getUnit(sim) {
  return UNIT_REGS.map((reg) => { const b = hexBytes(sim.packet(`p${reg.toString(16)}`)); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true); });
}

// check_isa.replay: write the code and the windows, reset, unit, single steps; the result and the memory windows.
export function replay(sim, c) {
  const regs = Object.fromEntries(REGS.map((k, i) => [k, c.in[i]]));
  sim.write(c.base, hexBytes(c.code));
  const chunks = windowBytes(c.seed);
  WINDOWS.forEach(([base], i) => sim.write(base, chunks[i]));
  sim.reset(regs);
  if ('unit' in c) setUnit(sim, c.unit);
  let result;
  for (let s = 0; s < c.steps; s++) {
    result = sim.run([], true);
    if (result.fault) break;
  }
  const memory = new Map(WINDOWS.map(([base, size]) => [base, sim.read(base, size)]));
  if ('unit' in c) memory.set('unit', getUnit(sim));
  return [result, memory];
}

const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// check_isa.compare: the problems of one result against the committed output.
export function compare(c, result, memory) {
  const out = c.out, problems = [];
  const regsIn = Object.fromEntries(REGS.map((k, i) => [k, c.in[i]]));
  if (result.fault !== out.fault) problems.push(`fault ${FAULTS[result.fault] ?? null} != ${FAULTS[out.fault]}`);
  const want = { ...regsIn };
  if (!(out.fault && !('regs' in out))) Object.assign(want, out.regs ?? {});
  const mask = 0xFFFF & ~(out.undef ?? 0);
  for (const name of REGS) {
    const got = result[name];
    if (name === 'psw') {
      if ((got & mask) !== (want[name] & mask)) problems.push(`psw ${x4(got)} != ${x4(want[name])} (mask ${x4(mask)})`);
    } else if (got !== want[name]) problems.push(`${name} ${x8(got)} != ${x8(want[name])}`);
  }
  const chunks = windowBytes(c.seed);
  const expect = new Map(WINDOWS.map(([base], i) => [base, new Uint8Array(chunks[i])]));
  for (const [address, data] of out.mem ?? []) {
    hexBytes(data).forEach((byte, i) => {
      for (const [base, size] of WINDOWS) if (base <= address + i && address + i < base + size) expect.get(base)[address + i - base] = byte;
    });
  }
  for (const [base] of WINDOWS) {
    const m = memory.get(base), e = expect.get(base);
    if (!eqBytes(m, e)) {
      const first = e.findIndex((v, i) => m[i] !== v);
      problems.push(`memory differs at 0x${(base + first).toString(16)}`);
    }
  }
  if ('unit' in out && !(memory.has('unit') && memory.get('unit').length === out.unit.length && memory.get('unit').every((v, i) => v === out.unit[i]))) {
    problems.push(`unit (hi, c, d, v) ${show(memory.get('unit') ?? null)} != ${show(out.unit)}`);
  }
  return problems;
}

// check_isa.firmware_checks on the JS HLE: [number of cases, failure lines].
export function firmwareChecks(vectors) {
  const cases = firmwareCases(vectors, newRandom(1)), failures = [];
  const hle = new HLE(labEnv());
  try {
    for (const [name, fn, regs, frame, memory, kind, wantAddr, want] of cases) {
      for (const [address, data] of memory) hle.sim.write(address, data);
      if (kind === 'mem') hle.sim.write(wantAddr, new Uint8Array([0xee, 0xee, 0xee, 0xee]));
      let result;
      try {
        result = hle.call(fn, regs32(regs), null, frame);
      } catch (e) {
        if (!(e instanceof RuntimeError)) throw e;
        failures.push(`${name}: ${String(e.message).slice(0, 200)}`);
        continue;
      }
      const got = kind === 'mem' ? hle.sim.u32(wantAddr) : result.d0;
      if (got !== want32(want)) failures.push(`${name} = 0x${x8(got)}, want 0x${x8(want32(want))}`);
    }
  } finally { hle.close(); }
  return [cases.length, failures];
}

// check_isa.limit_check: a two-instruction loop stops with fault 7 (insn-limit 50, and the default 1,000,000).
export function limitCheck() {
  for (const [limit, want] of [[50, 51], [null, 1000001]]) {
    const sim = new Simulator(labEnv(), limit);
    try {
      sim.write(CODE, hexBytes('cbcaff'));
      sim.reset({ pc: CODE });
      const result = sim.run();
      if (!(result.fault === 7 && result.insns === want)) throw new AssertionError(show(result));
    } finally { sim.close(); }
  }
  return 2;
}

// check_isa.page_checks: instructions of every length that cross a page, their second-page bytes patched between runs.
export function pageChecks() {
  let count = 0;
  const sim = new Simulator(labEnv());
  try {
    for (const [first, second, check] of [
      ['fe 00 00 01', ['000001', '000004'], (r, m) => m[0x100]],
      ['dd 10 00', ['00000000', '01000000'], (r) => r.pc],
      ['fd 00 00 00', ['0100', '0200'], (r) => r.d0],
      ['dc 00 01', ['0000', '0100'], (r) => r.pc],
      ['01', ['0001', '0401'], (r, m) => m[0x104]]]) {
      const head = hexBytes(first.replaceAll(' ', '')), start = 0x2000 - head.length, seen = [];
      for (const tail of second) {
        const t = hexBytes(tail), code = new Uint8Array(head.length + t.length);
        code.set(head); code.set(t, head.length);
        sim.write(start, code);
        sim.write(0x100, new Uint8Array(8));
        sim.reset({ pc: start, d0: 3, sp: SP0 });
        const result = sim.run([], true);
        if (!(result.fault === 0 && result.pc !== start)) throw new AssertionError(show([first, result]));
        seen.push(check(result, sim.read(0, 0x200)));
        count++;
      }
      if (seen[0] === seen[1]) throw new AssertionError(show([first, seen]));
    }
  } finally { sim.close(); }
  return count;
}
