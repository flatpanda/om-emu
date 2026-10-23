// bin/fwmap.mjs and the machine's coverage seam:
//   fwmapUnits (no firmware): the coverage option (createMachine coverage) off and on over the inline, helper and
//     one-instruction paths: the same registers and instruction count either way, every pc marked when on, and a later
//     machine without the option calls no earlier collector; fwmap/isa.mjs decode's control-flow kinds against the
//     interpreter's transfer forms (src/core/interp.mjs transfers()) over every defined (op, prefix) pair; the cover
//     union of thread files (groups, mutants apart, the packed format back); the block aggregation of fwmap/labels.mjs
//     (parts, unlabelled modules, stale labels).
//   fwmapFirmware (the E143 main block; skipped without it): the static map twice, identical, with the pinned headline
//     (102,803 functions, 5,186,071 instructions, 2,629 modules); every module carries a label and every label names a
//     module; bin/run.mjs kernel-1 under OM_COVERAGE prints the digests it prints without it, and what it ran is
//     instruction starts of the map.
//   node emu/test/test_fwmap.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createMachine } from '../src/machine.mjs';
import { R, S, PC, D0, insnLength } from '../src/core/cpu.mjs';
import { transfers } from '../src/core/interp.mjs';
import { decode, valid, prefixed } from '../fwmap/isa.mjs';
import { union, pack, unpack } from '../fwmap/cover.mjs';
import { aggregate } from '../fwmap/labels.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

// mov 5,d0 (inline); mov 0x11111111,d1 (inline); mov (0x2000),d1 (helper: step()); nop; then the breakpoint
const CODE = 0x1000, PROGRAM = [0x80, 0x05, 0xfc, 0xcd, ...le(0x11111111), 0x31, 0x00, 0x20, 0xcb], PCS = [0x1000, 0x1002, 0x1008, 0x100b];
function runProgram(options) {
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0, ...options });
  m.dbgWrite(CODE, new Uint8Array(PROGRAM));
  m.dbgWrite(0x2000, new Uint8Array(le(0x12345678)));
  m.setBreakpoints([CODE + PROGRAM.length]);
  R[PC] = CODE;
  m.cont();
  return { regs: [...R.slice(0, 16)], insns: S.insns };
}
function seam(bad) {
  let checks = 0;
  const off = runProgram({});
  for (const oneInsn of [false, true]) {
    const marks = new Map();
    const on = runProgram({ oneInsn, coverage: { mark: (pc) => marks.set(pc, (marks.get(pc) ?? 0) + 1), stub() {} } });
    const ref = oneInsn ? runProgram({ oneInsn }) : off;
    checks += 2;
    if (JSON.stringify(on) !== JSON.stringify(ref)) bad.push(`coverage on (oneInsn ${oneInsn}): ${JSON.stringify(on)}, off: ${JSON.stringify(ref)}`);
    const got = [...marks.keys()].sort((a, b) => a - b);
    if (JSON.stringify(got) !== JSON.stringify(PCS)) bad.push(`coverage on (oneInsn ${oneInsn}): marked ${got.map((x) => x.toString(16))}, want ${PCS.map((x) => x.toString(16))}`);
  }
  if (R[D0 + 1] !== 0x12345678 || R[D0] !== 5) bad.push(`the program did not run: d0 ${R[D0]}, d1 0x${(R[D0 + 1] >>> 0).toString(16)}`);
  // a machine made after one with a collector, without the option: the old collector hears nothing
  let late = 0;
  runProgram({ coverage: { mark: () => {}, stub() {} } });
  const before = { mark: () => { late++; }, stub() {} };
  runProgram({ coverage: before });
  const n = late;
  runProgram({});
  checks += 2;
  if (n === 0) bad.push('the collector of a machine heard none of its instructions');
  if (late !== n) bad.push(`a machine without the coverage option still marked ${late - n} pcs on an earlier machine's collector`);
  return checks;
}
function kinds(bad) {
  let pairs = 0;
  for (let op = 0; op < 256; op++) {
    for (let p = 0; p < (prefixed(op) ? 256 : 1); p++) {
      if (!valid(op, p)) continue;
      pairs++;
      const b = new Uint8Array(8); b[0] = op; b[1] = p;
      const d = decode(b, 0);
      if (d.len !== insnLength(op, p)) bad.push(`(${op.toString(16)}, ${p.toString(16)}): length ${d.len}, insnLength ${insnLength(op, p)}`);
      if ((d.kind !== 'seq') !== transfers(op, p)) bad.push(`(${op.toString(16)}, ${p.toString(16)}): fwmap kind ${d.kind}, interp transfers() ${transfers(op, p)}`);
    }
  }
  return pairs;
}
function unionUnit(bad) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-fwmap-'));
  try {
    const thread = (name, script, env, offs, stubs) => {
      fs.writeFileSync(path.join(dir, `${name}.bin`), Uint32Array.from(offs));
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ model: 'E143', argv: ['node', `emu/x/${script}.mjs`], env, other: [], stubs }));
    };
    thread('1-0', 'run', {}, [5 | 1 << 25, 9 | 4 << 25], [['60021025', 'S-X', 2]]);
    thread('2-0', 'check_menu', { OM_MACHINE: 'mutant=3' }, [7 | 1 << 25], []);
    thread('3-1', 'check_menu', {}, [5 | 4 << 25], [['60021025', 'S-X', 1]]);
    const u = union(dir, { size: 16, model: 'E143' });
    const g = u.doc.groups;
    const want = { scenarios: 2, mutants: 1, checks: 1, 'checks/check_menu': 1 };
    for (const [k, v] of Object.entries(want)) if (g[k]?.executed !== v) bad.push(`union: group ${k} executed ${g[k]?.executed}, want ${v}`);
    if (u.doc.executed_all !== 3 || u.doc.executed_without_mutants !== 2) bad.push(`union: ${u.doc.executed_all} executed, ${u.doc.executed_without_mutants} without mutants; want 3, 2`);
    if (u.all[5] !== 5) bad.push(`union: offset 5 has alias bits ${u.all[5]}, want 5`);
    if (u.doc.stubs.length !== 1 || u.doc.stubs[0].fires !== 3) bad.push(`union: stand-ins ${JSON.stringify(u.doc.stubs)}`);
    fs.writeFileSync(path.join(dir, 'packed.u32'), pack(u.all));
    const back = unpack(path.join(dir, 'packed.u32'), 16);
    if (!back.set.every((v, i) => v === u.all[i]) || back.outside) bad.push('pack / unpack does not give the set back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return 6;
}
function blocksUnit(bad) {
  const fn = (entry, module, insns, executed_insns, cores) => ({ entry, module, insns, executed_insns, cores });
  const functions = [fn('0x50000000', 'a.c', 10, 4, [0]), fn('0x50000100', 'a.c', 20, 0, [0, 2]), fn('0x50000200', 'gap@0x50000200', 30, 3, undefined), fn('0x50000300', 'b.c', 5, 0, [1])];
  const modules = [{ name: 'a.c', insns: 30, executed_insns: 4 }, { name: 'gap@0x50000200', insns: 30, executed_insns: 3 }, { name: 'b.c', insns: 5, executed_insns: 0 }];
  const labels = { modules: {
    'a.c': { block: 'x', gap_relevant: true, parts: [{ range: '0x50000100..0xffffffff', block: 'y', gap_relevant: false }] },
    'gap@0x50000200': { block: 'y', gap_relevant: true }, 'old.c': { block: 'x', gap_relevant: true } } };
  const b = aggregate(functions, modules, labels);
  const got = Object.fromEntries(Object.entries(b.parts).map(([k, r]) => [k, [r.modules, r.insns, r.executed, r.gap_unexecuted]]));
  const want = { y: [1, 50, 3, 27], x: [1, 10, 4, 6], '(unlabelled)': [1, 5, 0, 0] };
  if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(want).sort())) bad.push(`blocks: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (b.primary.x?.insns !== 30 || b.primary.x?.gap_unexecuted !== 26) bad.push(`blocks, primary x: ${JSON.stringify(b.primary.x)}`);
  if (b.total.insns !== 65 || b.total.cores.cpu0shared.insns !== 20 || b.total.cores['cpu1-3'].insns !== 5 || b.total.cores.none.insns !== 30) bad.push(`blocks, total: ${JSON.stringify(b.total)}`);
  if (JSON.stringify(b.unlabelled.map((m) => m.name)) !== '["b.c"]' || JSON.stringify(b.stale) !== '["old.c"]') bad.push(`blocks: unlabelled ${b.unlabelled.map((m) => m.name)}, stale ${b.stale}`);
  return 4;
}
export function fwmapUnits() {
  const bad = [];
  let checks = seam(bad);
  const pairs = kinds(bad);
  checks += 1 + unionUnit(bad) + blocksUnit(bad);
  return { checks, pairs, bad };
}

// ---- with the firmware
export async function fwmapFirmware() {
  const bad = [], skipped = [];
  const { MODEL_INFO, IMAGE_BASE } = await import('../src/fw/model.mjs');
  const { romPath } = await import('../src/fw/models.mjs');
  const file = path.join(REPO, romPath(MODEL_INFO));
  if (MODEL_INFO !== (await import('../src/fw/models.mjs')).MODELS.E143 || !fs.existsSync(file)) {
    skipped.push(`fwmap firmware tests: ${path.relative(REPO, file)} not found (or not E143)`);
    return { checks: 0, bad, skipped };
  }
  const { staticMap } = await import('../fwmap/static.mjs');
  const { CODE_BASE } = await import('../fwmap/isa.mjs');
  const img = new Uint8Array(fs.readFileSync(file));
  const seeds = JSON.parse(fs.readFileSync(path.join(REPO, 'emu/fwmap/E143.seeds.json'), 'utf8')).seeds.map((h) => parseInt(h, 16) - CODE_BASE);
  const digest = (st) => createHash('sha256').update(JSON.stringify(st.functions)).update(JSON.stringify(st.modules)).update(st.state).digest('hex');
  let st = staticMap(img, { base: IMAGE_BASE, seeds });
  const d1 = digest(st);
  const h = st.summary.attribution;
  const names = st.modules.map((m) => m.name);
  const state = st.state;
  st = staticMap(img, { base: IMAGE_BASE, seeds });
  if (digest(st) !== d1) bad.push('the static map differs between two runs on the same image');
  if (h.functions !== 102803 || h.instructions !== 5186071 || h.modules !== 2629) bad.push(`static map: ${h.functions} functions, ${h.instructions} instructions, ${h.modules} modules; want 102,803, 5,186,071, 2,629 (a deliberate change re-keys fwmap/E143.labels.json and updates these)`);
  st = null;
  const labels = JSON.parse(fs.readFileSync(path.join(REPO, 'emu/fwmap/E143.labels.json'), 'utf8')).modules;
  const missing = names.filter((n) => !Object.hasOwn(labels, n)), stale = Object.keys(labels).filter((n) => !names.includes(n));
  if (missing.length || stale.length) bad.push(`labels: ${missing.length} modules without a label (${missing.slice(0, 3)}), ${stale.length} labels without a module (${stale.slice(0, 3)})`);
  // bin/run.mjs kernel-1 with and without OM_COVERAGE
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-fwmap-'));
  try {
    const digests = (env) => {
      const r = spawnSync(process.execPath, ['emu/bin/run.mjs', 'kernel-1'], { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8' });
      if (r.status !== 0) bad.push(`run.mjs kernel-1 ${JSON.stringify(env)}: exit ${r.status}: ${r.stderr.slice(-300)}`);
      return r.stdout.split('\n').filter((l) => l.startsWith('kernel-1')).map((l) => l.replace(/^.*?insns (\d+)/, 'insns $1').replace(/MIPS [\d.]+; /, ''));
    };
    const off = digests({}), on = digests({ OM_COVERAGE: dir });
    if (!off.length || JSON.stringify(on) !== JSON.stringify(off)) bad.push(`run.mjs kernel-1 under OM_COVERAGE: ${on}; without: ${off}`);
    const bins = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));
    let marked = 0, notStart = 0;
    for (const f of bins) for (const v of new Uint32Array(new Uint8Array(fs.readFileSync(path.join(dir, f))).buffer)) { marked++; if (state[v & 0x1ffffff] !== 1) notStart++; }
    if (bins.length !== 1 || marked < 1000) bad.push(`run.mjs kernel-1 under OM_COVERAGE: ${bins.length} coverage files, ${marked} executed instruction starts`);
    if (notStart) bad.push(`run.mjs kernel-1 under OM_COVERAGE: ${notStart} of ${marked} executed offsets are not instruction starts of the map`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { checks: 6, bad, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = fwmapUnits(), f = await fwmapFirmware();
  console.log(`fwmap units: ${u.checks - u.bad.length}/${u.checks} (${u.pairs} defined (op, prefix) pairs); with the firmware: ${f.checks - f.bad.length}/${f.checks}${f.skipped.length ? ', SKIPPED' : ''}`);
  [...u.bad, ...f.bad, ...f.skipped.map((x) => `SKIPPED ${x}`)].forEach((x) => console.log('  ', x));
  process.exit(u.bad.length + f.bad.length ? 1 : 0);
}
