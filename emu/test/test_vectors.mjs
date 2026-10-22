// Gate T: the recorded single-instruction vectors (test/fixtures/isa_vectors.json, the CPU core's instruction-level
// regression) through the JS core, once with the CPU's own step (step) and once with the decoded-cache interpreter
// (run, one instruction per call). The RAM windows of each case are check_isa's: random.Random(seed).randbytes, regenerated from each case's
// seed (checks/lib/isa.mjs windowBytes), so the vectors need no firmware (bin/test-pure.mjs).
//   node emu/test/test_vectors.mjs [port|cached]
import fs from 'node:fs';
import { createMachine } from '../src/machine.mjs';
import { R, S, FAULT, HI, UC, UD, UV, step } from '../src/core/cpu.mjs';
import { run } from '../src/core/interp.mjs';
import { Fault } from '../src/core/mem.mjs';
import { WINDOWS, REGS as NAMES, windowBytes } from '../checks/lib/isa.mjs';

const REPO = new URL('../../', import.meta.url).pathname;
export function vectors(engine) {
  const doc = JSON.parse(fs.readFileSync(REPO + 'emu/test/fixtures/isa_vectors.json', 'utf8'));
  const m = createMachine({ rom: new Uint8Array(0) });
  let pass = 0, fail = 0;
  const fails = {};
  doc.cases.forEach((c, i) => {
    const base = c.base ?? 0x1000, steps = c.steps ?? 1;
    m.dbgWrite(base, Buffer.from(c.code, 'hex'));
    const win = windowBytes(c.seed);
    WINDOWS.forEach(([a], w) => m.dbgWrite(a, win[w]));
    R.fill(0); c.in.forEach((v, k) => { R[k] = v; }); R[FAULT] = 0; S.insns = 0;
    if (c.unit) { R[HI] = c.unit[0]; R[UC] = c.unit[1]; R[UD] = c.unit[2]; R[UV] = c.unit[3]; }
    if (engine === 'port') {
      for (let s = 0; s < steps; s++) { try { step(); } catch (e) { if (!(e instanceof Fault)) throw e; break; } }
    } else {
      for (let s = 0; s < steps && R[FAULT] === 0; s++) run(1);
    }
    const out = c.out, probs = [];
    if (R[FAULT] !== out.fault) probs.push(`fault ${R[FAULT]} != ${out.fault}`);
    const want = [...c.in];
    if (!(out.fault && !out.regs)) for (const [k, v] of Object.entries(out.regs || {})) want[NAMES.indexOf(k)] = v;
    const mask = 0xffff & ~(out.undef || 0);
    NAMES.forEach((n, k) => {
      const got = R[k] >>> 0;
      if (n === 'psw' ? ((got & mask) !== (want[k] & mask)) : got !== want[k] >>> 0) probs.push(`${n} ${got.toString(16)} != ${(want[k] >>> 0).toString(16)}`);
    });
    const exp = win.map((b) => Buffer.from(b));
    for (const [addr, hex] of out.mem || []) Buffer.from(hex, 'hex').forEach((b, j) => {
      WINDOWS.forEach(([a, s], w) => { if (addr + j >= a && addr + j < a + s) exp[w][addr + j - a] = b; });
    });
    WINDOWS.forEach(([a, s], w) => { if (!Buffer.from(m.dbgRead(a, s)).equals(exp[w])) probs.push('mem@' + a.toString(16)); });
    if (out.unit) { const u = [R[HI] >>> 0, R[UC] >>> 0, R[UD] >>> 0, R[UV] >>> 0]; if (u.join() !== out.unit.join()) probs.push('unit'); }
    if (probs.length) { fail++; (fails[c.form] ||= []).push(i + ': ' + probs.join('; ')); } else pass++;
  });
  return { pass, total: pass + fail, fails };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const engine of process.argv[2] ? [process.argv[2]] : ['port', 'cached']) {
    const r = vectors(engine);
    console.log(`${engine}: isa_vectors ${r.pass}/${r.total} pass`);
    for (const [f, l] of Object.entries(r.fails)) console.log('  ', f, l.length, l.slice(0, 3));
    bad += r.total - r.pass;
  }
  process.exit(bad ? 1 : 0);
}
