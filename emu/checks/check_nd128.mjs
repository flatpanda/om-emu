#!/usr/bin/env node
// The ND128 checks: the ND128 patch's provider, selector and frame-count slices and the CPU / memory / debug checks,
// run on src/lab/sim.mjs with the patched main code (built from artifacts/nd128/manifest.json's patches, sha256
// checked), then the original image; the report is JSON with a two-space indent plus a newline, keys in
// insertion order. --trace (an exec trace) is not implemented and throws Unported.
//   node emu/checks/check_nd128.mjs [--report PATH]
import fs from 'node:fs';
import path from 'node:path';
import { REPO, ORIGINAL, createHash, labEnv, readBytes, readPatched, runMain } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { Simulator, BASE, LAND, OUT, SP, STRUCT } from '../src/lab/sim.mjs';
import { Unported } from '../src/core/mem.mjs';
import { AssertionError } from '../src/lab/errors.mjs';
import { asText } from '../src/util/show.mjs';
import { unpack, pack, hexBytes } from '../src/util/bytes.mjs';

const ORIGINAL_SHA = '7f791611580925f3550d394baa9e8cca4e8f4c38e427ccd498170e8d1feb67e9';
const PATCHED_SHA = '8a7e8d2ca9feea8aa0478a197d17d1943f39b2c761d7bbf8c9dad4cb9649e29d';
const PROGRAM = 0xA2024000;
const SAVED = { d2: 0x22222222, d3: 0x33333333, a2: 0xaaaa2222, a3: 0xaaaa3333 };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// An assert: an AssertionError with `what` as its text.
function check(cond, what = null) { if (!cond) throw new AssertionError(what === null ? '' : asText(what)); }
const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function returned(regs, frame) {
  check(regs.fault === 0, regs);
  check(regs.pc === LAND && regs.sp === SP + frame, regs);
  for (const [name, value] of Object.entries(SAVED)) check(regs[name] === value, [name, regs]);
}
function provider(sim, step) {
  sim.frame(28);
  sim.write(STRUCT + 35, new Uint8Array([0xff]));
  sim.reset({ pc: BASE + 0x2d165d, d0: step, a3: STRUCT });
  returned(sim.run([LAND]), 28);
  return sim.read(STRUCT + 35, 1)[0];
}
function selector(sim, step, unit) {
  const top = sim.frame(84);
  sim.word(top + 4, OUT);
  sim.write(OUT, new Uint8Array([0xff]));
  sim.reset({ pc: BASE + 0x2d00f1, d0: step, d2: unit });
  const regs = sim.run([LAND, BASE + 0x2d0136]);
  check(regs.fault === 0, regs);
  const result = sim.read(OUT, 1)[0];
  if (step >= 1 && step <= 7) returned(regs, 84);
  else check(regs.pc === BASE + 0x2d0136 && regs.sp === SP, regs);
  return result;
}
function frames(sim, step) {
  sim.write(SP + 59, new Uint8Array([step]));
  sim.write(OUT, new Uint8Array([0xff, 0xff]));
  sim.reset({ pc: BASE + 0x2d0336, d3: OUT });
  const regs = sim.run([BASE + 0x2d0341]);
  check(regs.fault === 0 && regs.pc === BASE + 0x2d0341, regs);
  return unpack('<H', sim.read(OUT, 2))[0];
}
function cpuChecks(sim) {
  let count = 0;
  const one = (code, regs = {}) => {
    sim.write(PROGRAM, hexBytes(code.replaceAll(' ', '')));
    sim.reset({ pc: PROGRAM, ...regs });
    const result = sim.run([], true);
    count++;
    return result;
  };
  let regs;
  for (const [value, expected, flags] of [[0x7fffffff, 0x80000000, 10], [0xffffffff, 0, 5], [0, 1, 0]]) {
    regs = one('28 01', { d0: value });
    check(regs.d0 === expected && (regs.psw & 15) === flags, regs);
  }
  regs = one('a0 01', { d0: 0 });
  check(regs.d0 === 0 && (regs.psw & 15) === 6, regs);
  regs = one('a0 01', { d0: 0x80000000 });
  check((regs.psw & 15) === 8, regs);
  const conditions = [(z, n, c, v) => n !== v, (z, n, c, v) => n === v && !z, (z, n, c, v) => n === v, (z, n, c, v) => n !== v || z,
    (z, n, c, v) => c, (z, n, c, v) => !c && !z, (z, n, c, v) => !c, (z, n, c, v) => c || z, (z, n, c, v) => z, (z, n, c, v) => !z];
  for (let psw = 0; psw < 16; psw++) {
    conditions.forEach((condition, cc) => {
      regs = one(`${(0xc0 + cc).toString(16).padStart(2, '0')} 06`, { psw });
      const taken = condition(...[0, 1, 2, 3].map((bit) => !!(psw & (1 << bit))));
      check(regs.pc === PROGRAM + (taken ? 6 : 2), [cc, psw, regs]);
    });
  }
  regs = one('f2 91', { d0: 7, d1: 1 });
  check(regs.d1 === 128, regs);
  regs = one('f8 c4 02', { d0: 3 });
  check(regs.d0 === 0 && (regs.psw & 5) === 5, regs);
  regs = one('f8 c8 02', { d0: 0x80000001 });
  check(regs.d0 === 0xe0000000 && (regs.psw & 6) === 6, regs);
  regs = one('f8 fe fc', { psw: 15 });
  check(regs.sp === SP - 4 && regs.psw === 15, regs);
  regs = one('12', { d2: 0xfe, psw: 15 });
  check(regs.d2 === 0xfffffffe && regs.psw === 15, regs);
  for (const [call, length] of [['cd 10 00 f0 20', 5], ['dd 10 00 00 00 f0 20', 7]]) {
    const code = new Uint8Array([...hexBytes(call.replaceAll(' ', '')), ...new Uint8Array(16 - length).fill(0xcb), ...hexBytes('08dff020')]);
    sim.write(PROGRAM, code);
    sim.reset({ pc: PROGRAM, ...SAVED });
    regs = sim.run([PROGRAM + length]);
    count++;
    check(regs.pc === PROGRAM + length && regs.sp === SP && regs.fault === 0, regs);
    check(Object.entries(SAVED).every(([k, v]) => regs[k] === v), regs);
    check(unpack('<I', sim.read(SP, 4))[0] === PROGRAM + length);
  }
  sim.write(PROGRAM, hexBytes('cff8cef8'));
  sim.reset({ pc: PROGRAM, d0: 12, d1: 13, mdr: 14, lir: 15, lar: 16, ...SAVED });
  regs = sim.run([PROGRAM + 4]);
  count++;
  check(regs.sp === SP && regs.mdr === 14 && regs.d0 === 12 && regs.lar === 16, regs);
  regs = one('de 00 10', { mdr: LAND });
  check(regs.pc === LAND && regs.sp === SP + 16, regs);
  for (const [code, inputs, reason] of [['f2 c0', {}, 1], ['70', { a0: 0xdead0000 }, 2], ['60', { a0: 0xdead0000 }, 2],
    ['70', { a0: OUT + 1 }, 3], ['cf 01', {}, 4], ['60', { a0: BASE }, 2]]) {
    regs = one(code, inputs);
    check(regs.fault === reason && regs.pc === PROGRAM, [code, regs]);
  }
  // a store into the run-time copy at E143's image base (this check runs the E143 block)
  const original = sim.read(0x60021020, 4);
  regs = one('60', { a0: 0x60021020, d0: 0x5a5a5a5a });
  check(regs.fault === 0 && eqBytes(sim.read(0x60021020, 4), new Uint8Array(4).fill(0x5a)), regs);
  sim.write(0x60021020, original);
  check(eqBytes(sim.read(BASE + 0x2d00f1, 58), sim.read(0x60021020 + 0x2d00f1, 58)));
  count++;
  const cross = PROGRAM + 0xffe;
  for (const value of [0x12345678, 0x87654321]) {
    sim.write(cross, new Uint8Array([0xfc, 0xcc, ...pack('<I', value)]));
    sim.reset({ pc: cross });
    regs = sim.run([], true);
    count++;
    check(regs.d0 === value && regs.pc === cross + 6, regs);
  }
  return count;
}

function checkMain(report) {
  check(sha(readBytes(ORIGINAL)) === ORIGINAL_SHA, 'Original firmware hash mismatch');
  const patched = readPatched();
  check(sha(patched) === PATCHED_SHA, 'Patch firmware hash mismatch');
  const results = { original_sha256: ORIGINAL_SHA, patched_sha256: PATCHED_SHA,
    hardware_verified: false, scope: 'MN10300 firmware slices; parameter getter is a fixture' };
  let sim = new Simulator(labEnv({ rom: patched }));
  try {
    for (let step = 0; step < 256; step++) check(provider(sim, step) === (step === 6 ? 7 : step), String(step));
    results.provider_cases = 256;
    console.log('provider: 256 cases passed');
    for (let step = 0; step < 256; step++) {
      for (const unit of [1, 2, 3]) {
        const expected = step >= 1 && step <= 7 ? step * unit : 0;
        check(selector(sim, step, unit) === expected, [step, unit]);
      }
    }
    results.selector_cases = 768;
    console.log('selector: 768 cases passed (including invalid-input store)');
    const remapped = provider(sim, 6), exposure = selector(sim, remapped, 3), frameCount = frames(sim, remapped);
    check(remapped === 7 && exposure === 21 && frameCount === 128);
    results.patched_nd64_slot = { step: remapped, exposure_units: exposure, frames: frameCount };
    results.cpu_checks = cpuChecks(sim);
    console.log(`CPU/memory/debug checks: ${results.cpu_checks} passed`);
  } finally { sim.close(); }
  sim = new Simulator(labEnv({ rom: readBytes(ORIGINAL) }));
  try {
    check(provider(sim, 6) === 6 && frames(sim, 6) === 64);
    results.original_nd64_slot = { step: 6, frames: 64 };
    for (let step = 1; step < 7; step++) {
      for (const unit of [1, 2, 3]) {
        const top = sim.frame(84);
        sim.word(top + 4, OUT);
        sim.reset({ pc: BASE + 0x2d00f1, d0: step, d2: unit });
        returned(sim.run([LAND]), 84);
        check(sim.read(OUT, 1)[0] === step * unit);
      }
    }
    results.original_selector_cases = 18;
    results.original_udf_site = `0x${(BASE + 0x2d0128).toString(16).padStart(8, '0')}`;
  } finally { sim.close(); }
  results.status = 'passed';
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify(results, null, 2) + '\n');
  console.log(`Original: 64 frames; patched: 128 frames. Report: ${report}`);
  return 0;
}

function main(argv) {
  const a = parseArgs('check_nd128.mjs', argv, [
    { opt: '--report', type: 'path' }, { opt: '--trace', type: 'path' },
  ]);
  if (a.trace !== undefined) throw new Unported('check_nd128 --trace (the exec trace is Stage 4)');
  // Path(args.report): relative to the working directory; the default is emu/out/checks/nd128-report.json (the runner
  // always passes --report).
  return checkMain(a.report !== undefined ? path.normalize(a.report) : path.join(REPO, 'emu/out/checks/nd128-report.json'));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_nd128.mjs', main);
