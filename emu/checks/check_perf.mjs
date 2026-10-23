#!/usr/bin/env node
// The interpreter checks: the decoded-cache interpreter (run(): inline forms, the main-loop visits, the near-limit
// zone) against the CPU's own step run one instruction at a time ('s', the machine's step()) or against the forced
// one-instruction mode (the machine option oneInsn), with fixed programs, seeds and output lines:
//   P1 every isa_vectors.json case in continue mode == the committed outputs; the guard is the interpreter's mutant 1
//      (the inline SUB/CMP carry with <=), 22 of the 392 cases
//   P2 2000 seeded random sequences: 'c' == 's' (the default run on one machine, the stepped reference on a second,
//      compared pairwise: one machine exists at a time, createMachine)
//   P3 insn-limit residues, check_isa's two limit cases and the code-fetch fault at the limit, 'c' == 's'
//   P4 PSW windows, asl2/mul flag readers, and/or PSW windows across a page, the GDB PSW write, 'c' == 's'
//   P5 breakpoints and code writes: the default run == the stepped reference, and the default run == its results
//      pinned from emu (checks/fixtures/perf-p5.json), entry by entry: a difference there is the problem line
//      'scenario N: JS != pinned' (the first comparison is of two runs of one implementation, so a divergence the
//      stepped reference shares would pass it)
//   P6 the fixed run: the JS check_menu --quick (emu/checks/check_menu.mjs) in a node child with OM_STATS and
//      OM_COMPOSITES, default and with oneInsn: same stdout, the same composite per session, the same register
//      digest (sim.mjs Stats over the facade's 'g' replies) and FIXED_INSNS instructions each; MIPS inside 'c'
//   P7 HLE.frame (the call-frame index) == HLE._scan_frame over the same keys (checks/fixtures/p7-keys.json plus
//      Random(7) extras)
//   P8 status only (runs.json): the JS analogs 1 to 9 of the translator mutants make their groups fail (6, 8 and 9 on
//      P5: the decode slots of window pcs kept at every remap, or at a remap back to a segment shown before, and a
//      later instruction's crossing into the next page fetched at the decode of the first, interp.mjs crossFault); a
//      lost limit throws TimeoutError after 50,000,000 instructions
//   P9 gate mode 2: the default interpreter == the forced one-instruction mode on the accepted ring and registers
//   P10a the 22 PERF2 cases on the JS stub path == their outcome pinned from emu (checks/fixtures/perf-p10a.json)
//   P10b the shortened play workload on the JS Player: default == forced one-instruction == sliced (997), every
//      distinct frame's sha16 == the sha256 of the VSC output words; frames, lab time, hook log and the Stats digest
//      (g_count and instructions of the facade's 'g' replies, as sim.mjs Stats counts them) in the recorded format
//   P10c status only: the JS stub path's own controls make P10a or P10b fail
// --bench: the store-init hot loop on run() with 0 and 71 breakpoints (the times and MIPS are masked by the runner).
// --play (a timing workload; bin/playperf.mjs does that job) is refused once --bench and --play-run are handled;
// --repeat and --paced parse and do nothing without it.
//   node emu/checks/check_perf.mjs [--bench]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FIXTURES, ISA_VECTORS, ORIGINAL, labEnv, envMachine, formatMachine, loadImage, loadBlock, createHash, runMain, readBytes } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { pred, fault } from './lib/pred.mjs';
import { newRandom } from './lib/rngtape.mjs';
import * as I from './lib/isa.mjs';
import { Simulator, Stats, REGS } from '../src/lab/sim.mjs';
import { HLE, callFrames, CALLER, MEMCPY, MEMSET, SAVED, SP as HSP, runtime, BASE, memset } from '../src/lab/hle.mjs';
import * as IRQ from '../src/lab/irq.mjs';
import { OUTPUT } from '../src/lab/display.mjs';
import { RuntimeError, AssertionError, LabError } from '../src/lab/errors.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show, asText } from '../src/util/show.mjs';
import { pack, unpack, hexBytes, bytesHex } from '../src/util/bytes.mjs';
import { playWorkload } from '../bin/playperf.mjs';

const CODE = I.CODE, SP0 = I.SP0;
const LOW_END = 0x40000;
const M32 = 0xffffffff;
const BENCH_INSNS = 851_957;
const BREAK = [0xff];
const LOST_LIMIT = 50_000_000;
const x = (v) => (v >>> 0).toString(16);
const hexP = (v) => (v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16));
const commas = (n) => n.toLocaleString('en-US');
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameRegs = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
const cat = (...parts) => new Uint8Array(parts.flatMap((p) => [...p]));
const le = (v, n) => { const out = []; let b = BigInt(v) & ((1n << BigInt(8 * n)) - 1n); for (let i = 0; i < n; i++) { out.push(Number(b & 255n)); b >>= 8n; } return out; };
const h = (s) => [...hexBytes(s.replaceAll(' ', ''))];

class TimeoutError extends LabError {}
// check_perf.simulator(): a Simulator with these machine options added to the run's. A continue runs in slices of
// 1 M instructions and stops with TimeoutError past LOST_LIMIT (a mutant that loses the insn-limit would never stop).
function simulator(machine, limit) {
  let used = 0;
  const env = labEnv({ machine, slice: 1_000_000, onSlice() { used += 1_000_000; if (used > LOST_LIMIT) throw new TimeoutError('continue past the lost-limit budget'); } });
  const sim = new Simulator(env, limit);
  const run = sim.run.bind(sim);
  sim.run = (...a) => { used = 0; return run(...a); };
  return sim;
}
function stepped(sim, stops = new Set(), limit = 200000) {
  let r = sim.registers();
  for (let k = 0; k < limit; k++) {
    if (stops.has(r.pc)) return r;
    r = sim.run([], true);
    if (r.fault) return r;
  }
  throw new Error('reference run did not stop');
}
const windows = (sim) => [...I.WINDOWS.map(([base, size]) => sim.read(base, size)), sim.read(CODE, 0x1000)];
const sameWindows = (a, b) => a.every((w, i) => eqBytes(w, b[i]));

// ---------------------------------------------------------------- P1
const p1Cases = () => I.loadVectors(ISA_VECTORS).cases.map((c, i) => I.unpack(c, i));
function continuePlan(c) {
  const out = c.out, code = hexBytes(c.code);
  if (c.steps !== 1 || code[0] === 0xDB) return [false, null];
  if (out.fault) return [true, null];
  const pcIn = c.in[I.REGS.indexOf('pc')], nxt = out.regs.pc;
  const length = I.instructionLength(code[0], code.length > 1 ? code[1] : 0);
  if ((pcIn <= nxt && nxt < pcIn + length) || ((nxt ^ pcIn) & ~0xfff) || nxt + 1 > (pcIn | 0xfff) + 1) return [false, null];
  return [true, nxt];
}
function p1(machine = {}, cases = null) {
  cases = cases ?? p1Cases();
  const problems = [];
  let nCont = 0;
  const sim = simulator(machine, 1000);
  try {
    for (const c of cases) {
      const [useC, brk] = continuePlan(c);
      let result, memory;
      if (!useC) [result, memory] = I.replay(sim, c);
      else {
        nCont += 1;
        sim.write(c.base, hexBytes(c.code));
        if (brk !== null) sim.write(brk, new Uint8Array(BREAK));
        const chunks = I.windowBytes(c.seed);
        I.WINDOWS.forEach(([base], i) => sim.write(base, chunks[i]));
        sim.reset(Object.fromEntries(I.REGS.map((k, i) => [k, c.in[i]])));
        if ('unit' in c) I.setUnit(sim, c.unit);
        result = sim.run();
        memory = new Map(I.WINDOWS.map(([base, size]) => [base, sim.read(base, size)]));
        if ('unit' in c) memory.set('unit', I.getUnit(sim));
        if (brk !== null) {
          if (result.fault === 5 && result.pc === brk && result.insns === 2) result = { ...result, fault: 0 };
          else {
            if (!pred(false)) problems.push(`#${c.id} ${c.form} code=${c.code}: stopped fault ${result.fault} pc 0x${x(result.pc)} insns ${result.insns}, want the BREAK at 0x${x(brk)} after 2`);
            continue;
          }
        } else if (!pred(result.insns === 1)) {
          problems.push(`#${c.id} ${c.form}: faulting case ran ${result.insns} instructions`);
          continue;
        }
      }
      const bad = I.compare(c, result, memory);
      if (!pred(!bad.length)) problems.push(`#${c.id} ${c.form} code=${c.code}: ${bad.join('; ')}`);
    }
  } finally { sim.close(); }
  return [problems, nCont];
}

// ---------------------------------------------------------------- P2
function fuzzCase(rng) {
  const insns = [];
  const d = () => rng.randrange(4), a = () => rng.randrange(4);
  const memD8 = () => rng.randrange(-0x40, 0x40, rng.random() < 0.9 ? 4 : 1) & 0xff;
  const aligned = () => (rng.random() < 0.9 ? 4 : rng.choice([1, 2]));
  const gen = () => {
    const k = rng.random();
    const m = d(), n = d();
    const choices = [
      () => [m << 2],
      () => { const op = (0x01 + rng.randrange(3)) | (m << 2); return [op, ...le(I.ABS + rng.randrange(0, 0x100, aligned()), 2)]; },
      () => [0x10 + rng.randrange(16)],
      () => [0x20 + a(), rng.getrandbits(8)],
      () => [0x28 + n, rng.choice([1, 0xff, 0x80, 0x7f, rng.getrandbits(8)])],
      () => [0x2c + n, ...le(rng.choice([0, 1, 2, 3, 0x8000, 0xffff, rng.getrandbits(16)]), 2)],
      () => { const op = 0x30 + rng.randrange(12); return [op, ...le(I.ABS + rng.randrange(0, 0x100, aligned()), 2)]; },
      () => [0x3c + a()],
      () => [0x40 | (m << 2) | rng.choice([0, 1])],
      () => { const op = 0x42 | (m << 2) | rng.choice([0, 1]); return [op, rng.randrange(0, 0x100, aligned())]; },
      () => [0x50 + a()],
      () => [0x54 + n],
      () => { const op = 0x58 + rng.randrange(8); return [op, rng.randrange(0, 0x100, aligned())]; },
      () => [0x60 + rng.randrange(32)],
      () => [0x80 | (m << 2) | n, ...(m === n ? [rng.choice([0, 1, 2, 0xff, rng.getrandbits(8)])] : [])],
      () => [0x90 | (m << 2) | n, ...(m === n ? [rng.getrandbits(8)] : [])],
      () => { const op = 0xa0 + rng.randrange(32); return [op, ...(m === n ? [rng.choice([0, 1, 2, 3, 0xff, rng.getrandbits(8)])] : [])]; },
      () => [0xcb],
      () => [0xe0 | (m << 2) | n],
      () => [0xf0, rng.choice([0x00, 0x10, 0x40, 0x50, 0x60, 0x70]) | (m << 2) | n],
      () => [0xf1, rng.choice([0x00, 0x10, 0x20, 0x30, 0x50, 0x60, 0x70, 0x90, 0xa0, 0xd0, 0xe0]) | (m << 2) | n],
      () => [0xf2, rng.choice([0x00, 0x10, 0x20]) | (m << 2) | n],
      () => { const p = rng.randrange(0x80); return [0xf8, p, memD8()]; },
      () => { const p = rng.randrange(0x80); return [0xfa, p, ...le(rng.randrange(-0x40, 0x40, aligned()), 2)]; },
      () => { const p = rng.randrange(0x80); return [0xfc, p, ...le(rng.randrange(-0x40, 0x40, aligned()), 4)]; },
      () => { const p = (0x92 + rng.randrange(2)) | (m << 2); return [0xf8, p, rng.randrange(0, 0x100, aligned())]; },
      () => { const p = (0x90 + rng.randrange(4)) | (m << 2); return [0xfa, p, ...le(rng.randrange(0, 0x100, aligned()), 2)]; },
      () => { const p = 0xb8 + rng.randrange(8); return [0xf8, p, rng.randrange(0, 0x100, aligned())]; },
      () => { const p = 0xb0 + rng.randrange(16); return [0xfa, p, ...le(rng.randrange(0, 0x100, 4), 2)]; },
      () => { const p = rng.choice([0xe0, 0xe4, 0xec]) + n; return [0xf8, p, rng.getrandbits(8)]; },
      () => [0xf8, 0xfe, rng.getrandbits(8) & 0x7c],
      () => { const p = rng.choice([0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe4, 0xe8, 0xec]) + n; return [0xfa, p, ...le(rng.choice([0, 1, 2, 0xffff, rng.getrandbits(16)]), 2)]; },
      () => { const p = rng.choice([0xc0, 0xc4, 0xc8, 0xcc, 0xd0, 0xd4, 0xd8, 0xdc, 0xe0, 0xe4, 0xe8, 0xec]) + n; return [0xfc, p, ...le(rng.choice([0, 1, 2, M32, I.DATA + 0x100, rng.getrandbits(32)]), 4)]; },
      () => [0xfa, 0xfe, ...le(rng.randrange(-0x20, 0x20, 4), 2)],
      () => { const b = rng.randrange(0, 0x40, 4); const op = rng.random() < 0.5 ? 0xf3 : 0xf4; return [0x80 | (m << 2) | m, b, op, (rng.randrange(256) & ~0x0c) | (m << 2)]; },
      // helper forms
      () => [0xf2, rng.choice([0x40, 0x50]) | (m << 2) | n],
      () => [0xf2, rng.choice([0x90, 0xa0, 0xb0]) | (m << 2) | n],
      () => { const p = 0xc0 + rng.randrange(12); return [0xf8, p, rng.choice([0, 1, 2, 31, 32, rng.getrandbits(8)])]; },
      () => [0xf1, rng.choice([0x40, 0x80]) | (m << 2) | n],
      () => [0xf2, 0x80 + rng.randrange(8)],
      () => [0xf6, (m << 2) | n, ...(rng.random() < 0.7 ? [0xf6, 0xf0 | (n << 2) | n] : [])],
      () => [0xf6, 0x10 | (m << 2) | n],
      () => [0xf6, 0xf0 | (n << 2) | n],
      () => { const r = rng.randrange(16); return [0x2c + m, ...le(r | rng.choice([0, 0, 0x100, 0x8000]), 2), 0xf2, 0xf3 | (m << 2)]; },
      () => { const p = rng.choice([0xfc, 0xfd]); return [0xfa, p, ...le(rng.choice([rng.randrange(16), 0xfff0, 0xffff, 0x8000]), 2)]; },
      () => { const p = 0xf0 + rng.randrange(12); const dd = memD8(); return [0xfa, p, dd, 1 << rng.randrange(8)]; },
      () => [0xf0, rng.choice([0x80, 0x90]) | (m << 2) | n],
      () => { const p = (0x80 + rng.randrange(4)) | (m << 2); return [0xfc, p, ...le(rng.choice([0x50001000, I.ABS + 4, I.ABS + 1]), 4)]; },
      () => [0xf8, 0x02 | (m << 2) | n, 0x01],
    ];
    if (choices.length !== 49) throw new Error('fuzz forms: 49 expected');
    const idx = k < 0.75 ? rng.randrange(35) : 35 + rng.randrange(choices.length - 35);
    return choices[idx]();
  };
  const count = rng.randrange(10, 60);
  for (let i = 0; i < count; i++) {
    const r = rng.random();
    if (r < 0.1) insns.push(['bcc', rng.choice(Array.from({ length: 11 }, (_, k) => 0xc0 + k))]);
    else if (r < 0.13) insns.push(['bx', 0xe8 + rng.randrange(4)]);
    else if (r < 0.17) {
      const nb = rng.randrange(1, 5), body = [];
      for (let j = 0; j < nb; j++) body.push(gen());
      insns.push(['loop', [rng.randrange(0xd0, 0xdb), body]]);
    } else insns.push(['raw', gen()]);
  }
  const code = [], starts = [], fix = [];
  for (const [kind, item] of insns) {
    starts.push(code.length);
    if (kind === 'raw') code.push(...item);
    else if (kind === 'bcc') { fix.push([code.length, 1, 2]); code.push(item, 0); }
    else if (kind === 'bx') { fix.push([code.length, 2, 3]); code.push(0xf8, item, 0); }
    else { const [op, body] = item; code.push(0xdb); for (const b of body) code.push(...b); code.push(op); }
  }
  starts.push(code.length);
  code.push(...BREAK);
  for (const [at, off] of fix) {
    const reach = starts.filter((s) => s - at >= -120 && s - at <= 120 && s !== at);
    const target = reach.length ? rng.choice(reach) : code.length - 1;
    code[at + off] = (target - at) & 0xff;
  }
  const regs = {};
  for (let i = 0; i < 4; i++) regs[`d${i}`] = rng.choice([0, 1, 2, 3, M32, 0x80000000, 0x7fffffff, rng.getrandbits(32)]);
  for (let i = 0; i < 4; i++) { const step = rng.random() < 0.95 ? 4 : 1; regs[`a${i}`] = rng.randrange(I.AWIN[0], I.AWIN[1], step); }
  regs.sp = SP0; regs.pc = CODE;
  regs.psw = rng.randrange(16); regs.mdr = rng.getrandbits(32); regs.lir = rng.getrandbits(32); regs.lar = CODE + rng.randrange(code.length);
  return [new Uint8Array(code), regs];
}
const FUZZ = { 1: 2000 };
function p2(machine = {}, seed = 1, count = null) {
  const rng = newRandom(seed);
  count = count ?? FUZZ[seed];
  const cases = [];
  for (let index = 0; index < count; index++) {
    const [code, regs] = fuzzCase(rng);
    cases.push([code, regs, I.WINDOWS.map(([, size]) => rng.randbytes(size))]);
  }
  const runAll = (sim, how) => cases.map(([code, regs, chunks]) => {
    sim.write(CODE, new Uint8Array(0x1000));
    sim.write(CODE, code);
    I.WINDOWS.forEach(([base], i) => sim.write(base, chunks[i]));
    sim.reset(regs);
    return [how(sim), windows(sim)];
  });
  let got, want;
  const sim = simulator(machine, 300);
  try { got = runAll(sim, (s) => s.run()); } finally { sim.close(); }
  const ref = simulator({}, 300);
  try { want = runAll(ref, (s) => stepped(s)); } finally { ref.close(); }
  const problems = [], stats = { faults: 0, limit: 0, insns: 0 };
  cases.forEach(([code], index) => {
    const [g, gw] = got[index], [w, ww] = want[index];
    stats.insns += w.insns;
    stats.faults += w.fault !== 0 && w.fault !== 5 ? 1 : 0;
    stats.limit += w.fault === 7 ? 1 : 0;
    if (!sameRegs(g, w)) {
      const diff = {};
      for (const k of Object.keys(g)) if (g[k] !== w[k]) diff[k] = [hexP(g[k]), hexP(w[k])];
      problems.push(`sequence ${index} (${bytesHex(code)}): c/s differ ${show(diff)}`);
    } else if (!sameWindows(gw, ww)) problems.push(`sequence ${index} (${bytesHex(code)}): memory differs`);
  });
  return [problems, stats];
}

// ---------------------------------------------------------------- P3
const LOOPS = new Map([
  ['mixed', h('40 f2 41 a1 c4 03 cb e5 ca f8')],
  ['lowered', h('40 44 e1 81 c8 03 cb ca f9')],
  ['straight', [...Array(16).fill([0x40, 0x44, 0x48, 0x41, 0xe1]).flat(), 0xca, 0x100 - 80]],
]);
function p3(machine = {}) {
  const problems = [];
  let count = 0;
  const limit = 5000;
  const plan = [];
  for (const [name, loop] of LOOPS) for (let residue = 0; residue < 64; residue++) plan.push([name, loop, residue, limit - 130 - residue]);
  const runAll = (sim, how) => plan.map(([, loop, residue, start]) => {
    sim.write(CODE, new Uint8Array(loop));
    sim.reset({ pc: CODE, sp: SP0, insns: start, d0: residue, d1: 7 });
    return how(sim);
  });
  let got, want;
  const sim = simulator(machine, limit);
  try { got = runAll(sim, (s) => s.run()); } finally { sim.close(); }
  const ref = simulator({}, limit);
  try { want = runAll(ref, (s) => stepped(s)); } finally { ref.close(); }
  plan.forEach(([name, , , start], i) => {
    count += 1;
    if (!sameRegs(got[i], want[i]) || got[i].fault !== 7 || got[i].insns !== limit + 1) problems.push(`${name} insns ${start}: ${show(got[i])} != ${show(want[i])}`);
  });
  for (const [lim, wantInsns] of [[50, 51], [null, 1000001]]) {
    const s = simulator(machine, lim);
    try {
      s.write(CODE, new Uint8Array(h('cb ca ff')));
      s.reset({ pc: CODE });
      const r = s.run();
      count += 1;
      if (r.fault !== 7 || r.insns !== wantInsns) problems.push(`limit ${lim}: fault ${r.fault} insns ${r.insns}, want 7 / ${wantInsns}`);
    } finally { s.close(); }
  }
  const fetch = (s, how) => {
    s.write(LOW_END - 0x100, new Uint8Array([0xfc, 0xdc, ...le(LOW_END, 4), 0xf0, 0xf4]));
    s.reset({ pc: LOW_END - 0x100, sp: SP0, insns: 998 });
    return how(s);
  };
  let g, w;
  const s1 = simulator(machine, 1000);
  try { g = fetch(s1, (s) => s.run()); } finally { s1.close(); }
  const s2 = simulator({}, 1000);
  try { w = fetch(s2, (s) => stepped(s)); } finally { s2.close(); }
  count += 1;
  if (!sameRegs(g, w) || g.fault !== 2 || g.pc !== LOW_END || g.insns !== 1000) problems.push(`code-fetch fault at the limit: ${show(g)} != ${show(w)} (want fault 2, insns 1000)`);
  return [problems, count];
}

// ---------------------------------------------------------------- P4
function p4Programs() {
  const out = [];
  const pswZ = h('2c 01 00 f2 f3');
  for (let dist = 0; dist < 4; dist++) {
    for (const filler of [[0xcb], [0x44]]) {
      for (let consumer of [[0xc8, 0x00], [0xc4, 0x00], h('f8 e9 00')]) {
        consumer = [...consumer.slice(0, -1), consumer.length];
        out.push([`psw write, ${dist} x ${bytesHex(new Uint8Array(filler))}, ${bytesHex(new Uint8Array(consumer))}`, [...pswZ, ...Array(dist).fill(filler).flat(), ...consumer, ...BREAK], 0]);
      }
    }
  }
  for (const pre of [[], [0xa1]]) {
    for (const consumer of [[0xc4, 0x02], h('f8 e9 03'), [0xc8, 0x02], h('f8 eb 03'), [0xc3, 0x02]]) {
      const ph = bytesHex(new Uint8Array(pre)), ch = bytesHex(new Uint8Array(consumer));
      out.push([`${ph} asl2 ${ch}`, [...pre, 0x56, ...consumer, ...BREAK], 0]);
      out.push([`${ph} mul ${ch}`, [...pre, 0xf2, 0x41, ...consumer, ...BREAK], 0]);
    }
  }
  for (const write of [h('fa fd 01 00'), h('fa fc f7 ff')]) {
    for (const between of [[], [0xcb], [0xcb, 0xcb]]) {
      const code = [0xa1, ...write, ...between, 0xc8, 0x02, ...BREAK, ...BREAK];
      const wh = bytesHex(new Uint8Array(write)), bh = bytesHex(new Uint8Array(between));
      out.push([`${wh} ${bh} beq`, code, 0]);
      out.push([`${wh} ${bh} beq across a page`, code, 0x2000 - 3 - between.length]);
    }
  }
  return out;
}
function p4(machine = {}) {
  const problems = [];
  let count = 0;
  const programs = p4Programs();
  const gdbCode = [...h('2c 01 00 f2 f3 c8 02'), ...BREAK];
  const runAll = (s, how) => {
    const res = programs.map(([, code, at]) => {
      const base = at || CODE;
      s.write(base, new Uint8Array(code));
      s.reset({ pc: base, sp: SP0, d0: 0x12345, d1: 0x30001, d2: 0x40000001, psw: 0 });
      return how(s);
    });
    const gdb = [0, 1].map((psw) => {
      s.write(CODE, new Uint8Array(gdbCode));
      s.reset({ pc: CODE, sp: SP0 });
      s.run([], true);
      const r = s.run([], true);
      if (r.pc !== CODE + 5) throw new AssertionError(show(r));
      s.reset({ ...r, psw });
      return how(s);
    });
    return [res, gdb];
  };
  let got, want;
  const sim = simulator(machine, 1000);
  try { got = runAll(sim, (s) => s.run()); } finally { sim.close(); }
  const ref = simulator({}, 1000);
  try { want = runAll(ref, (s) => stepped(s)); } finally { ref.close(); }
  programs.forEach(([name], i) => {
    count += 1;
    if (!sameRegs(got[0][i], want[0][i])) problems.push(`${name}: ${show(got[0][i])} != ${show(want[0][i])}`);
  });
  [0, 1].forEach((psw, i) => {
    count += 1;
    if (!sameRegs(got[1][i], want[1][i]) || got[1][i].fault !== 5) problems.push(`G write of PSW ${psw} in the window: ${show(got[1][i])} != ${show(want[1][i])}`);
  });
  return [problems, count];
}

// ---------------------------------------------------------------- P5
const LOOP5 = [0x40, 0x81, 0xe5, 0xa0, 0x40, 0xc9, 0x100 - 5];                 // 0x1000..0x1006: counter loop
const LINE5 = [0x40, 0x44, 0x48, 0x84, 0x89, 0xe1, 0x41, 0x45, 0x80, 0x8a, 0xcb, 0xcb];
const SMC5 = [...h('2c 44 00 02 07 10 cb 48'), ...BREAK];                      // movbu rewrites 0x1007 (inc d2 -> inc d1)
const WINSW = h('fc dc 58 00 10 98  60  fc dd 00 10 00 b8  f0 f5');           // (0x98100058) = d0; jmp 0xB8001000
class Real5 {
  constructor(sim) { this.sim = sim; }
  run(stops = []) { return this.sim.run(stops); }
  step() { return this.sim.run([], true); }
}
class Ref5 extends Real5 { run(stops = []) { return stepped(this.sim, new Set(stops)); } }
function p5Script(xx) {
  const sim = xx.sim, out = [];
  const w = (a, bytes) => sim.write(a, new Uint8Array(bytes));
  w(CODE, [...LOOP5, ...LINE5, ...BREAK]);
  sim.reset({ pc: CODE, sp: SP0 });
  out.push(xx.run());                                           // translate and chain everything
  for (const bp of [0, 1, 3, 5, 7, 9, 12, 15, 17, 18].map((i) => CODE + i)) {
    sim.reset({ pc: CODE, sp: SP0 });
    const r = xx.run([bp]);
    const hits = [r];
    if (r.pc === bp) {
      hits.push(xx.run([bp]));                                  // continue at a breakpoint pc: no instruction
      hits.push(xx.step());                                     // a step from it: one instruction
      hits.push(xx.run([bp]));                                  // next arrival
    }
    hits.push(xx.run([]));                                      // removed: run to the BREAK
    out.push([bp, hits]);
  }
  // GDB writes into executed code: low RAM, both DRAM views, the ROM
  for (const [runAt, writeAt] of [[CODE, CODE], [0x62300000, 0xA2300000], [0xA2300000, 0x62300000], [0x51F00000, 0x51F00000]]) {
    w(runAt, [...LOOP5, ...BREAK]);
    sim.reset({ pc: runAt, sp: SP0 });
    out.push(xx.run());
    w(writeAt + 1, [0x82]);                                     // mov d0,d1 -> mov d0,d2
    sim.reset({ pc: runAt, sp: SP0 });
    out.push(xx.run());
    w(writeAt + 4, [0x44]);                                     // inc d0 -> inc d1 (loop now ends by the limit)
    sim.reset({ pc: runAt, sp: SP0 });
    out.push(xx.run());
  }
  for (let k = 0; k < 2; k++) {                                 // a guest store rewrites the next instruction of its own TB
    w(CODE, SMC5);
    sim.reset({ pc: CODE, sp: SP0 });
    out.push(xx.run());
  }
  // an instruction across a page edge, its second-page bytes patched by GDB between runs
  const head = h('40 44 48 fc cc 78 56'), start = 0x2000 - head.length;
  for (const tail of [[...h('34 12'), ...BREAK], [...h('cd ab'), ...BREAK]]) {
    w(start, [...head, ...tail]);
    sim.reset({ pc: start, sp: SP0 });
    out.push(xx.run());
  }
  // an instruction running onto the unmapped page after low RAM faults where it starts
  for (const code of [h('40 40 40 fc cc 11 22 33'), h('40 ff fc cc 11 22 33')]) {
    w(LOW_END - code.length, code);
    sim.reset({ pc: LOW_END - code.length, sp: SP0 });
    out.push(xx.run());
  }
  // a breakpoint inserted while the bus window (0xB8000000) maps another segment
  w(CODE, WINSW);
  w(0x60001000, h('40 40 40 40 ff'));                          // through segment 0x14: inc d0 x4
  w(0x68001000, h('44 44 44 44 ff'));                          // through segment 0x15: inc d1 x4
  for (const [seg, stops] of [[0x14161514, []], [0x15161514, []], [0x14161514, [0xB8001002]], [0x15161514, [0xB8001002]]]) {
    sim.reset({ pc: CODE, sp: SP0, d0: seg });
    out.push(xx.run(stops));
  }
  sim.reset({ pc: CODE, sp: SP0, d0: 0x17161514 });           // the window's reset segment again
  out.push(xx.run([CODE + WINSW.length - 2]));
  // a prefix form on the last byte of the SRAM page whose next page is a lab-stub allow range (readable MMIO)
  sim.write(0x89900100, pack('<3I', 0x97f02000, 0x100, 1));
  for (const op of [0xf0, 0xf8, 0xfa, 0xfc, 0xfe]) {
    w(0x97f01fff, [op]);
    sim.reset({ pc: 0x97f01fff, sp: SP0, a0: 0x10100 });
    out.push(xx.run());
  }
  sim.write(0x89900100, new Uint8Array(12));
  return out;
}
const P5_FILE = path.join(FIXTURES, 'perf-p5.json');
const P5_FORMAT = 'om-emu-perf-p5/1';
// a P5 result in the fixture's JSON form: registers in sim.mjs REGS order, (bp, hits) as [bp, [...]]
const canon5 = (v, regs) => (Array.isArray(v) ? v.map((y) => canon5(y, regs)) : v !== null && typeof v === 'object' ? regs.map((k) => v[k]) : v);
function p5Runs(machine = {}) {
  const runs = [];
  for (const [name, X, ex] of [['default', Real5, machine], ['reference', Ref5, {}]]) {
    const sim = simulator(ex, 100000);
    try { runs.push(p5Script(new X(sim))); } catch (e) {
      if (!(e instanceof RuntimeError || e instanceof TimeoutError)) throw e;
      return { error: [[`${name} run: ${e.message}`], 0] };
    } finally { sim.close(); }
  }
  return { runs };
}
function p5(machine = {}) {
  const { runs, error } = p5Runs(machine);
  if (error) return error;
  const [got, want] = runs;
  const problems = [];
  got.forEach((g, i) => { if (!deepEqual(g, want[i])) problems.push(`scenario ${i}: ${show(g)} != ${show(want[i])}`); });
  // the default run's pinned results: a divergence the stepped reference shares shows here
  const doc = JSON.parse(fs.readFileSync(P5_FILE, 'utf8'));
  if (doc.format !== P5_FORMAT) return [[...problems, `${P5_FILE}: format ${doc.format}, want ${P5_FORMAT}`], want.length];
  if (doc.results.length !== got.length) problems.push(`${got.length} results, ${doc.results.length} pinned`);
  got.forEach((g, i) => {
    const a = canon5(g, doc.regs), b = canon5(doc.results[i], doc.regs);
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`scenario ${i}: ${show(a)} != pinned ${show(b)}`);
  });
  return [problems, want.length];
}
// Re-pin P5's default run from emu (a deliberate change; its reason goes in the commit message).
function p5Pin() {
  const { runs, error } = p5Runs();
  if (error) throw new Error(`P5: ${error[0].join('; ')}`);
  const about = "check_perf P5: the default run's results of the breakpoint and code-write scenarios, pinned from emu (p5Pin); registers in regs order";
  fs.writeFileSync(P5_FILE, JSON.stringify({ format: P5_FORMAT, about, regs: REGS, results: JSON.parse(JSON.stringify(runs[0])) }, null, 1) + '\n');
}

// ---------------------------------------------------------------- P7
function p7() {
  const image = loadImage();
  const hle = Object.create(HLE.prototype);            // the index and the scan only need the image bytes
  hle.image = image; hle.frames = new Map();
  const keys = new Set();
  // the addresses the lab and its checks call, hook or frame (the fixture says where they were taken from)
  for (const k of JSON.parse(fs.readFileSync(path.join(FIXTURES, 'p7-keys.json'), 'utf8')).keys) keys.add(parseInt(k, 16));
  const index = callFrames(image);
  const rng = newRandom(7);
  const all = [...index.keys()];
  const multi = [...index].filter(([, f]) => f.size > 1).map(([t]) => t);
  const extra = [];
  for (let k = 0; k < 10; k++) extra.push(((rng.choice(all) + BASE) % 4294967296) >>> 0);
  for (let k = 0; k < 5; k++) extra.push(((rng.choice(multi) + BASE) % 4294967296) >>> 0);
  for (let k = 0; k < 5; k++) extra.push(BASE + rng.randrange(0x1000000));
  const problems = [];
  let errors = 0;
  for (const key of [...[...keys].sort((a, b) => a - b), ...extra]) {
    const outcome = [];
    for (const fn of [(k) => hle.frame(k), (k) => hle._scan_frame(k)]) {
      hle.frames = new Map();
      try { outcome.push(['ok', fn(key)]); } catch (e) {
        if (!(e instanceof LabError)) throw e;
        outcome.push(['error', e.message]);
      }
    }
    errors += outcome[0][0] === 'error' ? 1 : 0;
    if (JSON.stringify(outcome[0]) !== JSON.stringify(outcome[1])) {
      problems.push(`0x${x(key).padStart(8, '0')}: index ${show(outcome[0])} != scan ${show(outcome[1])}`);
    }
  }
  return [problems, keys.size + extra.length, errors];
}

// ---------------------------------------------------------------- P8 (JS analogs, status only)
const MUTANTS = new Map([
  [1, ['SUB/CMP carry with <= instead of <', 'P1, P2']],
  [2, ['Bcc/Lcc lowered without flags defined in the TB', 'P4']],
  [3, ['pending insns dropped at TB exits', 'P3']],
  [4, ['near-limit fallback disabled', 'P3']],
  [5, ['TB flag 1 ignored', 'P4']],
  [6, ['no TB invalidation on breakpoint insert or window remap', 'P5']],
  [7, ['asl2 defines V and C', 'P4']],
  [8, ['a later instruction in a TB may cross a page', 'P5']],
  [9, ['no TB invalidation when the bus window maps back', 'P5']],
]);
// the JS analog of each translator mutant (interp.mjs MUT): 1 inline SUB/CMP carry with <=; 2 inline Bcc/Lcc
// without the undefined-flag test; 3 inline branches not counted; 4 no near-limit zone, inline forms run past the
// limit; 5 the one-instruction TB flag (PSW window, irq_wait) ignored; 7 inline asl2 defines V and C
const ANALOG = { 1: 'inline SUB/CMP carry with <=', 2: 'inline Bcc/Lcc without the undefined-flag test', 3: 'inline branches not counted',
  4: 'no near-limit zone, inline forms run past the limit', 5: 'the one-instruction flag (PSW window, irq_wait) ignored',
  6: 'the decode slots of window pcs kept at every remap', 7: 'inline asl2 defines V and C',
  8: 'a later instruction crossing a page fetched at the decode of the first', 9: 'the decode slots of window pcs kept at a remap back to a segment shown before' };
function p8(cmpCases) {
  const out = [];
  for (const [value, [what, groups]] of MUTANTS) {
    const machine = { mutant: value };
    const caught = [];
    for (const g of groups.split(', ')) {
      const group = { P1: () => p1(machine, cmpCases), P2: () => p2(machine), P3: () => p3(machine), P4: () => p4(machine), P5: () => p5(machine) }[g];
      try {
        const [probs] = group();
        caught.push([g, `${probs.length} problem(s)`, probs.length > 0]);
      } catch (e) {
        if (!(e instanceof TimeoutError || e instanceof RuntimeError)) throw e;
        caught.push([g, e.name, true]);
      }
    }
    out.push([value, what, caught]);
  }
  return out;
}

// ---------------------------------------------------------------- P9
const P9_IRQ = 200, P9_LEVEL = 5, P9_IVAR = 0xF000, P9_HANDLER = 0x6003F000;
const P9_LEVELREG = IRQ.BANKS[0] + 4 * P9_IRQ;
function p9Programs() {
  const store = [0xfc, 0xdc, ...le(P9_LEVELREG, 4), 0xfc, 0xce, ...le(1 << P9_LEVEL, 4), 0x68];
  const after = CODE + 2 + store.length;
  const tail = [0x44, 0x44, 0x44, 0x44, 0x44, ...BREAK];
  return [
    ['IE 1 IM 7: accepted after the store', [0x40, 0x40, ...store, ...tail], 0x0F00, [after]],
    ['IE 1 IM 0, mov d0,psw opens IM 7', [0x40, 0x40, ...store, 0x2c, 0x00, 0x0f, 0xf2, 0xf3, ...tail], 0x0800, [after + 5 + 2]],
    ['IE 0 IM 7, or 0x800,psw opens IE', [0x40, 0x40, ...store, 0xfa, 0xfd, 0x00, 0x08, ...tail], 0x0700, [after + 4 + 2]],
    ['IM 3: level 5 not accepted', [0x40, 0x40, ...store, ...tail], 0x0B00, []],
    ['asl2 leaves V, C undefined: accepted after the inc that defines them', [0x54, ...store, ...tail], 0x0F00, [CODE + 1 + store.length + 1]],
  ];
}
const p9Handler = () => new Uint8Array([0xfc, 0xdd, ...le(P9_LEVELREG, 4), 0x0c, 0x6d, 0xf0, 0xfd]);
function p9Run(sim, intc, code, psw) {
  sim.write(CODE, new Uint8Array(0x40));
  sim.write(CODE, new Uint8Array(code));
  sim.write(P9_HANDLER, p9Handler());
  sim.write(IRQ.IVAR + 4 * P9_LEVEL, pack('<H', P9_IVAR));
  intc.set_gate(IRQ.GATE_ANY);
  IRQ.cpu_store(sim, P9_LEVELREG, 0);
  intc.set_test(new Map([[P9_IRQ, IRQ.TEST_LEVEL]]));
  const acc0 = intc.accepted()[0];
  sim.reset({ pc: CODE, sp: SP0, psw, d0: 1, d1: 2 });
  const r = sim.run();
  const [, acc] = intc.accepted(acc0);
  intc.set_test(new Map([[P9_IRQ, IRQ.TEST_OFF]]));
  IRQ.cpu_store(sim, P9_LEVELREG, 0);
  intc.set_gate(IRQ.GATE_OFF);
  return [r, acc];
}
function p9() {
  const problems = [];
  let accepted = 0;
  const programs = p9Programs();
  const runAll = (machine) => {
    const sim = simulator(machine, 1000);
    try { const intc = new IRQ.IntcDebug(sim); return programs.map(([, code, psw]) => p9Run(sim, intc, code, psw)); } finally { sim.close(); }
  };
  const def = runAll({}), one = runAll({ oneInsn: true });
  programs.forEach(([name, , , want], i) => {
    const [got, acc] = def[i], [rgot, racc] = one[i];
    accepted += acc.length;
    if (!sameRegs(got, rgot) || !deepEqual(acc, racc)) problems.push(`${name}: default ${show(got)} ${show(acc)} != one-insn ${show(rgot)} ${show(racc)}`);
    const pcs = acc.map(([, pc]) => pc);
    if (JSON.stringify(pcs) !== JSON.stringify(want) || got.fault !== 5) {
      problems.push(`${name}: accepted at ${show(pcs.map(hexP))}, want ${show(want.map(hexP))}; fault ${got.fault} at 0x${x(got.pc)}`);
    }
  });
  return [problems, programs.length, accepted];
}

// ---------------------------------------------------------------- P10a
const P10_CODE = 0xA2280000, P10_MEM = 0xA2290000;
const P10_STUB_LEVEL = IRQ.BANKS[0] + 4 * 200;
function p10aCases() {
  const msFrame = [0xA0, 8], mcFrame = [0xF0, 28];
  const calls = (at, n, target, frame, before = []) => {
    const code = [...before];
    let pc = at + before.length;
    for (let k = 0; k < n; k++) { code.push(0xdd, ...pack('<i', (runtime(target) - pc) | 0), ...frame); pc += 7; }
    return [code, pc];
  };
  const run = (hle, code, done, regs, limit = 5000) => {
    hle.sim.write(P10_CODE, new Uint8Array([...code, 0xff]));
    hle.sim.reset({ pc: P10_CODE, sp: HSP, ...SAVED, ...regs });
    return hle._loop(done, HSP, limit);
  };
  const cases = [];
  for (const n of [0, 1, 0x3FF, 0x401, 3000]) {
    cases.push([`memset ${hexP(n)}`, (hh) => hh.call(MEMSET, { a0: P10_MEM + 3, d0: 0x1A5, d1: n })]);
    cases.push([`memcpy ${hexP(n)}`, (hh) => hh.call(MEMCPY, { a0: P10_MEM + 0x2001, a1: P10_MEM + 5, d0: n })]);
  }
  cases.push(['memcpy overlapping up', (hh) => hh.call(MEMCPY, { a0: P10_MEM + 9, a1: P10_MEM + 4, d0: 2000 })]);
  cases.push(['memcpy overlapping down', (hh) => hh.call(MEMCPY, { a0: P10_MEM + 4, a1: P10_MEM + 9, d0: 2000 })]);
  cases.push(['memcpy from unmapped memory', (hh) => hh.call(MEMCPY, { a0: P10_MEM, a1: 0x40000000 - 8, d0: 64 })]);
  cases.push(['memset with V, C undefined, then bcs', (hh) => {
    const [code, pc] = calls(P10_CODE, 1, MEMSET, msFrame, [0x54]);
    return run(hh, [...code, 0xc4, 0x02], pc + 2, { a0: P10_MEM, d0: 3, d1: 16 }, 10);
  }]);
  cases.push(['memset reached without a CALL (check_osd group 1)', (hh) => {
    hh.sim.write(CALLER + 0x40, new Uint8Array(Array(7).fill(0xcb)));
    hh.sim.reset({ pc: runtime(MEMSET), sp: HSP, mdr: CALLER + 0x47, a0: P10_MEM, d1: 4, ...SAVED });
    return hh._loop(CALLER + 7, HSP, 10);
  }]);
  for (const [n, limit] of [[5, 6], [5, 5], [5, 3], [5, 1], [400, 1000], [400, 300]]) {
    cases.push([`${n} memset calls in one continue, limit ${limit}`, (hh) => {
      const [code, pc] = calls(P10_CODE, n, MEMSET, msFrame);
      return run(hh, code, pc, { a0: P10_MEM, d0: 0x22, d1: 0x40 }, limit);
    }]);
  }
  cases.push(['doorbell and faulting CPU stores', (hh) => {
    const intc = new IRQ.IntcDebug(hh.sim);
    const out = [];
    for (const [address, value] of [[P10_STUB_LEVEL, 1 << 5], [P10_STUB_LEVEL, 0], [IRQ.DEBUG + IRQ.D_MAGIC, 0], [P10_MEM + 2, 1], [0x50001000, 1], [0x40000000, 1], [P10_MEM, 0x12345678]]) {
      try { IRQ.cpu_store(hh.sim, address, value); out.push('ok'); } catch (e) { if (!(e instanceof RuntimeError)) throw e; out.push(e.message); }
    }
    out.push(intc.errors());
    hh.sim.reset({ insns: 999_999 });
    try { IRQ.cpu_store(hh.sim, P10_MEM, 7); } catch (e) { if (!(e instanceof RuntimeError)) throw e; out.push(e.message); }
    hh.sim.reset({ insns: 999_998 });
    IRQ.cpu_store(hh.sim, P10_MEM, 8);
    return out;
  }]);
  return cases;
}
function p10Hle() {
  const stats = new Stats(createHash);
  const env = labEnv({ beginSession: () => ({ stats, attach() {}, close(hle, closeSim) { closeSim(); } }) });
  const hle = new HLE(env);
  hle.install_base_stubs();
  return [hle, stats];
}
// P10a's pinned outcome: the 22 cases as emu ran them on the stub path (p10aRun), written by p10aPin
const P10A_FILE = path.join(FIXTURES, 'perf-p10a.json');
const P10A_FORMAT = 'om-emu-perf-p10a/1';
function p10aRun(patch = null) {
  const [hle, stats] = p10Hle();
  if (patch) patch(hle);
  const got = [];
  try {
    for (const [name, fn] of p10aCases()) {
      hle.sim.write(P10_MEM, new Uint8Array(0x2000).map((_, i) => i & 255));
      hle.log.length = 0;
      let result;
      try { result = show(fn(hle)); } catch (e) {
        if (!(e instanceof LabError)) throw e;
        result = `${e.name}: ${e.message}`;
      }
      const lab = [16, 17, 18, 19].map((n) => { const b = hexBytes(hle.sim.packet(`p${n.toString(16)}`)); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true); });
      got.push([name, { result, regs: hle.sim.registers(), log: [...hle.log], lab,
        mem: createHash('sha256').update(hle.sim.read(P10_MEM, 0x3000)).digest('hex').slice(0, 16),
        ret: bytesHex(hle.sim.read(0xA2100100, 3)), stderr: hle.stderr_tail(4000),
        stats: [stats.g_count, stats.digest.copy().digest('hex').slice(0, 16), stats.insns] }]);
    }
  } finally { hle.close(); }
  return got;
}
function p10a(patch = null) {
  const doc = JSON.parse(fs.readFileSync(P10A_FILE, 'utf8'));
  if (doc.format !== P10A_FORMAT) return [[`${P10A_FILE}: format ${doc.format}, want ${P10A_FORMAT}`], 0];
  const ref = doc.cases, got = p10aRun(patch);
  const problems = [];
  ref.forEach(([name, a], i) => {
    const b = got[i]?.[1];
    if (!b) { problems.push(`${name}: no JS case`); return; }
    for (const key of Object.keys(a)) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) problems.push(`${name}: ${key} differs: reference ${asText(a[key]).slice(0, 150)} != default ${asText(b[key]).slice(0, 150)}`);
    }
  });
  return [problems, ref.length];
}
// Re-pin P10a from emu (a deliberate change to the stub path; its reason goes in the commit message).
function p10aPin() {
  const about = 'check_perf P10a: the 22 PERF2 cases run on the HLE stub path, pinned from emu (p10aPin): per case the result, registers, '
    + 'hook log, lab registers p16..p19, memory digest, return bytes, stderr tail and the Stats g_count / digest / instructions';
  fs.writeFileSync(P10A_FILE, JSON.stringify({ format: P10A_FORMAT, about, cases: p10aRun() }, null, 1) + '\n');
}

// ---------------------------------------------------------------- P6
// 125_983_720 until S-DISPSTART (src/lab/display.mjs) ran the DISPLAY task's start-up in the first DISPLAY run only
// (X: the same run with the hook off gives that count and the earlier register digest 86258afcae1743f0); 125_980_953
// until S-SCPU (src/lab/scpuserver.mjs) served the store init's three SCPU requests at the request API, whose own
// trace record, message and post no longer run, while the completions and the waits run natively (X)
const FIXED_INSNS = 125_979_479;
const CHECK_MENU = path.join(path.dirname(new URL(import.meta.url).pathname), 'check_menu.mjs');
// check_menu --quick in a child with OM_STATS and OM_COMPOSITES, these machine options added to the run's:
// [exit code, stdout without timings, stats, {session label: sha256 of its composite words}].
function fixed_run(machine = {}) {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'om-emu-perf-'));
  try {
    const stats = path.join(tmp, 'stats.json'), comps = path.join(tmp, 'composites.json');
    const env = { ...process.env, OM_STATS: stats, OM_COMPOSITES: comps, TMPDIR: tmp, OM_MACHINE: formatMachine({ ...envMachine(), ...machine }) };
    delete env.OM_RNG_TAPE;                          // the parent's tape only: children are not taped
    delete env.OM_PRED_REC; delete env.OM_PRED_MUT;
    const p = spawnSync(process.execPath, [CHECK_MENU, '--quick'], { env, encoding: 'utf8', timeout: 1200 * 1000, maxBuffer: 1 << 26 });
    const data = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')) : {};
    const drawn = fs.existsSync(comps) ? JSON.parse(fs.readFileSync(comps, 'utf8')) : {};
    return [p.status, (p.stdout ?? '').replace(/\d+(\.\d+)? s\b/g, 'T s'), data, drawn];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function p6() {
  const problems = [], runs = new Map();
  for (const [name, machine] of [['default', {}], ['one-insn', { oneInsn: true }]]) {
    const [rc, text, stats, drawn] = fixed_run(machine);
    runs.set(name, [rc, text, stats.g_digest ?? null, stats.insns ?? null, drawn, stats]);
    if (rc !== 0) problems.push(`${name}: check_menu --quick exit ${rc}`);
    if (stats.insns !== FIXED_INSNS) problems.push(`${name}: ${stats.insns ?? null} instructions, want ${commas(FIXED_INSNS)}`);
    if (!Object.keys(drawn).length || !Object.values(drawn).every(Boolean)) problems.push(`${name}: sessions without a composite: ${show(drawn)}`);
  }
  const a = runs.get('default'), b = runs.get('one-insn');
  for (const [i, what] of [[1, 'stdout'], [2, 'register digest'], [4, 'session composites']]) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) problems.push(`${what} differ between the two translations`);
  const mips = {};
  for (const [k, v] of runs) if (v[3] && v[5].seconds) mips[k] = v[3] / v[5].seconds.c / 1e6;
  return [problems, mips, a[2], Object.keys(a[4]).length];
}

// ---------------------------------------------------------------- P10b
const P10B_SCRIPT = [['shoot 1 s lab', 'idle', 1000], ['MENU open', 'key', 'menu'], ['menu 1 s lab', 'idle', 1000], ['MENU close', 'key', 'menu'], ['shoot 1 s lab', 'idle', 1000]];
// --play-run --detail (a child): the workload on the JS Player with a Stats; one JSON line
function playRun(stale = false) {
  const stats = new Stats(createHash);
  let lab = null;
  const env = labEnv({ resBlock: loadBlock(), ...(process.env.OM_SLICE ? { slice: Number(process.env.OM_SLICE) } : {}),
    beginSession: () => ({ stats, attach(hle) { lab = hle; }, close(hle, closeSim) { closeSim(); } }) });
  const seen = new Set();
  let pngs = 0, last = null;
  const problems = [];
  const check = (pl) => {
    if (!pl.frame || seen.has(pl.frame[3])) return;
    seen.add(pl.frame[3]);
    const hdr = lab.vsc.header();
    const words = stale && last ? last : lab.sim.read(OUTPUT, 4 * hdr.width * hdr.height);
    last = words;
    pngs += 1;
    if (createHash('sha256').update(words).digest('hex').slice(0, 16) !== pl.frame[3]) problems.push(`frame ${pl.frame[3]}: sha != sha256 of the VSC output words`);
  };
  const res = playWorkload(env, P10B_SCRIPT, { onPublish: check, detail: true });
  return { frames: res.frames, lab_ns: res.lab_ns, log: res.log, stub_hits: res.stub_hits, elapse_log: res.elapse_log, settle_log: res.settle_log,
    idle_events: res.idle_events, digest: res.digest, stats: [stats.g_count, stats.digest.copy().digest('hex'), stats.insns],
    pngs_checked: pngs, png_problems: problems };
}
function playChild(env) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.OM_RNG_TAPE;                     // the parent's tape only: children are not taped
  const p = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--play-run', '--detail'], { env: childEnv, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = (p.stdout ?? '').split('\n').filter((l) => l.startsWith('{'));
  if (p.status || !lines.length) throw new Error(`play workload child exit ${p.status}: ${(p.stderr || p.stdout || '').slice(-1500)}`);
  return JSON.parse(lines.at(-1));
}
function p10b(stale = false) {
  const runs = new Map();
  const variants = [['default', {}], ['one-insn', { OM_MACHINE: formatMachine({ ...envMachine(), oneInsn: true }) }], ['sliced', { OM_SLICE: '997' }]];
  for (const [name, venv] of stale ? variants.slice(0, 1) : variants) {
    try { runs.set(name, playChild({ ...venv, ...(stale ? { OM_X_STALE: '1' } : {}) })); } catch (e) { return [[`${name}: ${String(e.message).slice(-300)}`], {}]; }
  }
  const ref = runs.get('default');
  const keys = ['frames', 'lab_ns', 'log', 'stub_hits', 'elapse_log', 'settle_log', 'idle_events', 'stats', 'digest'];
  const problems = [];
  for (const [name, r] of runs) {
    for (const k of keys) if (JSON.stringify(r[k]) !== JSON.stringify(ref[k])) problems.push(`${name}: ${k} differs from the default`);
    problems.push(...r.png_problems.slice(0, 3));
    if (!r.pngs_checked) problems.push(`${name}: no frame checked`);
  }
  const info = { frames: ref.frames.length, distinct: new Set(ref.frames).size, log: ref.log.length, lab_ms: Math.floor(ref.lab_ns / 1e6),
    pngs: ref.pngs_checked, digest: ref.stats[1].slice(0, 16), g: ref.stats[0], insns: ref.stats[2] };
  return [problems, info];
}

// ---------------------------------------------------------------- P10c (status only): the JS stub path's controls
function p10c() {
  const out = [];
  const control = (label, group, fn) => {
    try { const [probs] = fn(); out.push([label, group, `${probs.length} problem(s)`, probs.length > 0]); } catch (e) {
      if (!(e instanceof LabError)) throw e;
      out.push([label, group, e.name, true]);
    }
  };
  control('the memset stub writes n - 1 bytes', 'P10a', () => p10a((hle) => {
    hle.hook(MEMSET, (hh, r) => { hh.sim.write(r.a0, new Uint8Array(Math.max(0, r.d1 - 1)).fill(r.d0 & 0xff)); hh.finish(r, { a0: r.a0 }); }, 'memset');
  }));
  control('the HLE loop ignores the stub-call limit', 'P10a', () => p10a((hle) => { const loop = hle._loop.bind(hle); hle._loop = (done, sp) => loop(done, sp, 5000); }));
  control('each distinct frame is checked against the previous frame\'s words', 'P10b', () => p10b(true));
  return out;
}

// ---------------------------------------------------------------- bench
function bench(reps = 100) {
  const image = loadImage();
  const off = 0x503da0e0 - BASE;
  const body = image.subarray(off, off + 0x2d);
  if (!(body[0] === 0xdb && body.at(-1) === 0xd0)) throw new AssertionError(bytesHex(body));
  const code = cat(body, BREAK);
  const count = 0xffff;
  for (const nbp of [0, 71]) {
    const sim = simulator({}, 0);
    let spent = 0, total = 0;
    try {
      sim.write(CODE, code);
      sim.write(0xa2021000, pack('<H', count));
      sim.write(SP0 + 12, pack('<I', 0xa2100000));
      const stops = Array.from({ length: nbp }, (_, j) => 0x60100000 + 0x40 * j);
      for (let k = 0; k < reps; k++) {
        sim.reset({ pc: CODE, sp: SP0, a0: 0x12345, a3: 0xa2021000, d0: 0, d1: 0, d2: count });
        const t = performance.now();
        const r = sim.run(stops);
        spent += (performance.now() - t) / 1000;
        if (!(r.fault === 5 && r.pc === CODE + code.length - 1 && r.insns === BENCH_INSNS)) throw new AssertionError(show(r));
        total += r.insns;
      }
    } finally { sim.close(); }
    console.log(`bench: hot loop, ${nbp} breakpoints elsewhere: ${reps} x ${commas(BENCH_INSNS)} instructions in ${spent.toFixed(2)} s inside c: ${(total / spent / 1e6).toFixed(0)} MIPS`);
  }
}

function main(argv) {
  const a = parseArgs('check_perf.mjs', argv, [
    { opt: '--bench', type: 'flag' },
    { opt: '--play', type: 'flag' },                       // refused below, after --bench and --play-run
    { opt: '--repeat', type: 'int' },                      // used with --play only
    { opt: '--paced', type: 'number', metavar: 'S' },
    { opt: '--play-run', type: 'flag' },
    { opt: '--detail', type: 'flag' },
  ]);
  if (a.bench) { bench(); return 0; }
  if (a.play_run) {
    if (!a.detail) throw new Error('--play-run: only with --detail (P10b)');
    console.log(JSON.stringify(playRun(process.env.OM_X_STALE === '1')));
    return 0;
  }
  if (a.play) a.error('--play: the play workload is timed by node emu/bin/playperf.mjs');
  const t0 = performance.now();
  let bad = 0;
  const report = (ok, text, problems = []) => {
    ok = pred(ok, 2);
    if (!ok) bad += 1;
    console.log(`[${ok ? 'ok' : 'FAIL'}] ${text}`);
    for (const p of problems.slice(0, 10)) console.log('      ' + p);
  };
  const cases = p1Cases();
  // JS-only fault point (checks/lib/pred.mjs, for P1): the default P1 run with the interpreter's inline SUB/CMP
  // carry mutant (mutant 1), an ISA flag fault in the machine
  let [probs, nCont] = p1(fault('p1-isa-flags') ? { mutant: 1 } : {}, cases);
  const cmpCases = cases.filter((c) => continuePlan(c)[0] && /^(cmp|sub|asl2)/.test(c.form));
  const [guard] = p1({ mutant: 1 }, cmpCases);
  report(!probs.length && nCont && guard.length,
    `P1 ${cases.length} ISA vectors, ${nCont} in continue mode (BREAK at the expected pc), == committed outputs; lowered code ran (mutant 1 changes ${guard.length} of the ${cmpCases.length} cmp/sub/asl2 cases)`, probs);
  let st;
  [probs, st] = p2();
  report(!probs.length, `P2 ${FUZZ[1]} random sequences (seed 1), c == s on registers, fault, insns, windows and code page (${commas(st.insns)} instructions, ${st.faults} faulting, ${st.limit} at the limit)`, probs);
  let n;
  [probs, n] = p3();
  report(!probs.length, `P3 insn-limit: ${n} runs (3 loops x 64 residues + 2 check_isa cases + 1 code-fetch fault): fault 7 at insns N+1, a code-fetch fault at the limit is fault 2 and not counted, registers == s`, probs);
  [probs, n] = p4();
  report(!probs.length, `P4 flags and windows across TBs: ${n} programs == s (PSW window distance 0-3, asl2/mul then flag readers, and/or imm16,PSW windows incl. across a page, GDB PSW write in the window)`, probs);
  [probs, n] = p5();
  report(!probs.length, `P5 breakpoints and code writes: ${n} stops == s (insert into chained code, remove, continue and step at a breakpoint, GDB writes via both DRAM views and the ROM, precise SMC, page-crossing patch, crossing onto unmapped memory, a breakpoint in the remapped bus window, a prefix form before readable MMIO)`, probs);
  let mips, digest, nComp;
  [probs, mips, digest, nComp] = p6();
  report(!probs.length, `P6 fixed run check_menu --quick: default == one-insn (stdout, the composite of each of the ${nComp} session(s), register digest ${(digest || '?').slice(0, 16)}), ${commas(FIXED_INSNS)} instructions each; inside c `
    + `${(mips.default ?? 0).toFixed(1)} MIPS vs ${(mips['one-insn'] ?? 0).toFixed(1)} MIPS`, probs);
  let errors;
  [probs, n, errors] = p7();
  report(!probs.length, `P7 call-frame index == scan for ${n} functions (${errors} error cases)`, probs);
  const results = p8(cmpCases);
  const missed = results.filter(([, , c]) => !c.every(([, , k]) => k)).map(([v, w, c]) => `mutant ${v} (${w}): ${show(c)}`);
  report(!missed.length, 'P8 negative controls (JS analogs), each detected: ' + results.map(([v, w, c]) =>
    `${v} ${w} (${ANALOG[v]}) -> ` + c.map(([g, k]) => `${g} ${k}`).join(', ')).join('; '), missed);
  let accepted;
  [probs, n, accepted] = p9();
  report(!probs.length, `P9 interrupts: ${n} programs (gate mode 2; acceptance after an MMIO store mid-TB presents a test line, after mov d0,psw / or 0x800,psw open IM / IE, after undefined flags are defined again, the RTI of the handler): default == one-insn on the accepted ring (level, pc, insns) and all 16 registers (${accepted} acceptances)`, probs);
  [probs, n] = p10a();
  report(!probs.length, `P10a HLE builtins (PERF2): ${n} cases (memset and memcpy at 0, 1, 0x3ff, 0x401 and 3000 bytes, overlapping and unmapped copies, a call with undefined flags, a call site that is not a CALL, chains of 5 and 400 calls under limits that raise or return, doorbell and faulting CPU stores): == the pinned outcome (fixtures/perf-p10a.json) on memory, registers, hook log, stderr, result and register digest`, probs);
  let info;
  [probs, info] = p10b();
  report(!probs.length, `P10b play workload (PERF2): default == one-insn == sliced (OM_SLICE=997) on ${info.frames} frames (${info.distinct} distinct, ${info.pngs} PNGs == png_bytes), ${info.lab_ms} ms lab time, a hook log of ${info.log}, stub_hits, idle / elapse / settle logs, register digest ${info.digest} (${info.g} reads, ${info.insns} instructions)`, probs);
  const c10 = p10c();
  const missed10 = c10.filter(([, , , k]) => !k).map(([w, g, r]) => `${w}: ${r}`);
  report(!missed10.length, 'P10c negative controls (the JS stub path), each detected: ' + c10.map(([w, g, r]) => `${w} -> ${g} ${r}`).join('; '), missed10);
  console.log(`${!bad ? 'all groups passed' : 'FAILED'} (${bad} problem(s), ${Math.round((performance.now() - t0) / 1000)} s)`);
  return bad ? 1 : 0;
}

// test_checks.mjs NC-P1 runs P1's guard on a patched copy
export { p1, p1Cases, continuePlan, p10a, p10aPin, p5, p5Pin };

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_perf.mjs', main);
