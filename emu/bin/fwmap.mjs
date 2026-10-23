#!/usr/bin/env node
// The firmware map: a bottom-up map of the main code block (every function a static scan finds, the source module it
// most likely belongs to, what it touches), the execution coverage of a workload over it, and both aggregated per
// module and per subsystem block, so that each modelling step can be measured. E143 (OM-1 v1.9) only: the roots, task
// tables and kernel addresses of fwmap/e143.mjs are its.
//   node emu/bin/fwmap.mjs [static|cover|report|all] [options]     (default all: static, cover, report)
//     static [--update-seeds]   the map (fwmap/static.mjs), a function of the image and fwmap/E143.seeds.json alone;
//                               --update-seeds first re-derives the seeds from the last cover run (it may rename gap
//                               modules, and the labels keyed to them must then be re-keyed)
//     cover [--scenarios all|none|A,B] [--checks all|none|A,B] [--jobs N]
//                               the workload under OM_COVERAGE (checks/lib/coverage.mjs): node emu/bin/run.mjs over the
//                               scenarios (default all), then node emu/bin/checks.mjs --jobs N (default 4) over the
//                               checks or runs of checks/runs.json (default all), each a child; then the union
//     report [--without-mutants] [--top N]
//                               the map joined with the coverage and fwmap/E143.labels.json: per function, module,
//                               MMIO region and block; the ranked lists (top N, default 40); report.md. Refuses a map
//                               made from another image or other seeds, and a missing cover run.
//     --model CODE              the model (default OM_EMU_MODEL, else E143); any other is refused, exit 2
//     --out DIR                 the output directory (default emu/out/fwmap/<model>)
// Outputs: static/ (functions.json, modules.json, summary.json; state.u8, owner.i32, phase.u8: per byte of the block
// 0 not code / 1 instruction start / 2 interior, the owning function's index per instruction start, the discovery
// phase), cover/ (raw/ the per-thread files and each part's stdout and stderr; executed.u32 and
// executed-nomutants.u32: u32 LE per executed body offset, offset | alias bits << 25, bit 0 the run-time copy, bit 1 the
// flash view, bit 2 the run-time copy's uncached alias; groups.json), report/ (functions.jsonl, modules.json, regions.json, lists.json, validation.json,
// blocks.json, report.md). A run prints each step's time and the headline; report also the table by block. cover shares
// emu/out/checks/js/ with bin/checks.mjs and bin/golden.mjs: do not run them at the same time. Exit 1 when a part of
// the workload fails (its coverage is still written), 2 on a usage error.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, UsageError } from '../checks/lib/args.mjs';

const PROG = 'fwmap';
const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const SPEC = [
  { name: 'command', positional: true, required: false },
  { opt: '--model', type: 'str', metavar: 'CODE' },
  { opt: '--out', type: 'path', metavar: 'DIR' },
  { opt: '--update-seeds', type: 'flag' },
  { opt: '--scenarios', type: 'str', default: 'all', metavar: 'all|none|A,B' },
  { opt: '--checks', type: 'str', default: 'all', metavar: 'all|none|A,B' },
  { opt: '--jobs', type: 'int', default: 4, metavar: 'N' },
  { opt: '--without-mutants', type: 'flag' },
  { opt: '--top', type: 'int', default: 40, metavar: 'N' },
];
const OWN = { static: ['update_seeds'], cover: ['scenarios', 'checks', 'jobs'], report: ['without_mutants', 'top'] };

let args;
try {
  args = parseArgs(PROG, process.argv.slice(2), SPEC);
  args.command ??= 'all';
  if (!['static', 'cover', 'report', 'all'].includes(args.command)) args.error(`${args.command}: one of static, cover, report, all`);
  for (const [cmd, opts] of Object.entries(OWN)) {
    if (args.command === cmd || args.command === 'all') continue;
    for (const o of opts) if (process.argv.slice(2).some((a) => a === `--${o.replaceAll('_', '-')}` || a.startsWith(`--${o.replaceAll('_', '-')}=`))) args.error(`--${o.replaceAll('_', '-')} is ${cmd}'s option`);
  }
  if (args.jobs < 1) args.error(`--jobs ${args.jobs}: at least 1`);
  if (args.top < 1) args.error(`--top ${args.top}: at least 1`);
  args.model ??= process.env.OM_EMU_MODEL || 'E143';
  if (args.model !== 'E143') args.error(`--model ${args.model}: E143 only (the static pass's roots, task tables and kernel addresses are the OM-1 v1.9's)`);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  process.stderr.write(`${PROG}: ${e.message}\n${e.usage}\n`);
  process.exit(2);
}
process.env.OM_EMU_MODEL = args.model;        // before anything reaches src/fw/model.mjs
const { MODEL_INFO, IMAGE_BASE } = await import('../src/fw/model.mjs');
const { ORIGINAL, readBytes, checkImage, sha256 } = await import('../checks/lib/env.mjs');
const { staticMap } = await import('../fwmap/static.mjs');
const { runWorkload, union, pack, unpack } = await import('../fwmap/cover.mjs');
const { buildReport, markdown } = await import('../fwmap/report.mjs');
const { loadLabels } = await import('../fwmap/labels.mjs');
const { CODE_BASE } = await import('../fwmap/isa.mjs');

const OUT = path.resolve(args.out ?? path.join(REPO, 'emu/out/fwmap', args.model));
const DIRS = { static: path.join(OUT, 'static'), cover: path.join(OUT, 'cover'), report: path.join(OUT, 'report') };
const SEEDS = path.join(REPO, `emu/fwmap/${args.model}.seeds.json`), LABELS = path.join(REPO, `emu/fwmap/${args.model}.labels.json`);
const t0 = performance.now();
const say = (m) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const n = (x) => x.toLocaleString('en-US');
const rel = (p) => (p.startsWith(REPO) ? path.relative(REPO, p) : p);
const refuse = (m) => { process.stderr.write(`${PROG}: ${m}\n`); process.exit(1); };
const writeJson = (dir, name, doc, indent = 1) => fs.writeFileSync(path.join(dir, name), JSON.stringify(doc, null, indent) + '\n');
const readJson = (file) => { if (!fs.existsSync(file)) refuse(`${rel(file)} is missing: run the step that writes it first`); return JSON.parse(fs.readFileSync(file, 'utf8')); };
const img = checkImage(readBytes(ORIGINAL));
const imageSha = sha256(img);
const rss = () => `${Math.round(process.memoryUsage().rss / 1e6)} MB`;
let rc = 0;

function seedsFile() {
  const doc = readJson(SEEDS);
  if (doc.format !== 'fwmap-seeds/1' || doc.model !== args.model) refuse(`${SEEDS}: format ${doc.format} for ${doc.model}, want fwmap-seeds/1 for ${args.model}`);
  return doc;
}
function doStatic() {
  const t = performance.now();
  const doc = seedsFile();
  const seeds = doc.seeds.map((h) => parseInt(h, 16) - CODE_BASE);
  if (args.update_seeds) {
    const { set } = unpack(path.join(DIRS.cover, 'executed.u32'), img.length);
    for (let o = 0; o < set.length; o++) if (set[o]) seeds.push(o);
  }
  const st = staticMap(img, { base: IMAGE_BASE, seeds, log: say });
  let used = doc.seeds;
  if (args.update_seeds) {
    const fresh = st.seedsTaken.map((o) => '0x' + (o + CODE_BASE).toString(16));
    if (JSON.stringify(fresh) !== JSON.stringify(doc.seeds)) {
      writeJson(path.dirname(SEEDS), path.basename(SEEDS), { ...doc, seeds: fresh });
      say(`seeds: ${doc.seeds.length} -> ${fresh.length} (${rel(SEEDS)} rewritten; check the report's unlabelled modules)`);
    } else say(`seeds: unchanged (${fresh.length})`);
    used = fresh;
  }
  fs.rmSync(DIRS.static, { recursive: true, force: true });
  fs.mkdirSync(DIRS.static, { recursive: true });
  const summary = { model: args.model, image_sha256: imageSha, seeds: used, ...st.summary, seconds: +((performance.now() - t) / 1000).toFixed(1) };
  writeJson(DIRS.static, 'summary.json', summary);
  writeJson(DIRS.static, 'functions.json', st.functions, 0);
  writeJson(DIRS.static, 'modules.json', st.modules, 0);
  fs.writeFileSync(path.join(DIRS.static, 'state.u8'), st.state);
  fs.writeFileSync(path.join(DIRS.static, 'owner.i32'), st.owner);
  fs.writeFileSync(path.join(DIRS.static, 'phase.u8'), st.phaseOf);
  const h = st.summary.attribution;
  say(`static: ${n(h.functions)} functions, ${n(h.instructions)} instructions, ${n(h.modules)} modules (${n(h.source_modules)} named, ${n(h.gap_clusters)} gap pieces); ${summary.seconds} s, rss ${rss()}`);
}
async function doCover() {
  const t = performance.now();
  const list = (s) => (s === 'none' ? [] : s === 'all' ? ['all'] : s.split(',').filter(Boolean));
  const raw = path.join(DIRS.cover, 'raw');
  const parts = await runWorkload({ repo: REPO, raw, scenarios: list(args.scenarios), checks: list(args.checks), jobs: args.jobs, model: args.model, log: say });
  if (!parts.length) refuse('cover: --scenarios none and --checks none leave no workload');
  const u = union(raw, { size: img.length, model: args.model });
  fs.writeFileSync(path.join(DIRS.cover, 'executed.u32'), pack(u.all));
  fs.writeFileSync(path.join(DIRS.cover, 'executed-nomutants.u32'), pack(u.clean));
  writeJson(DIRS.cover, 'groups.json', { ...u.doc, parts, seconds: +((performance.now() - t) / 1000).toFixed(1) });
  say(`cover: ${n(u.doc.threads)} threads, ${n(u.doc.executed_all)} executed instruction starts (${n(u.doc.executed_without_mutants)} without mutants), ${u.doc.stubs.length} stand-ins fired; ${((performance.now() - t) / 1000).toFixed(1)} s`);
  for (const p of parts) if (p.rc !== 0) { say(`cover: node ${p.argv.join(' ')} exited ${p.rc} (see ${rel(path.join(raw, `${p.part}.stdout`))})`); rc = 1; }
}
async function doReport() {
  const t = performance.now();
  const summary = readJson(path.join(DIRS.static, 'summary.json'));
  if (summary.image_sha256 !== imageSha) refuse(`static/summary.json was made from another image: rerun fwmap static`);
  if (JSON.stringify(summary.seeds) !== JSON.stringify(seedsFile().seeds)) refuse(`static/summary.json was made with other seeds than ${rel(SEEDS)}: rerun fwmap static`);
  const groups = readJson(path.join(DIRS.cover, 'groups.json'));
  const exe = unpack(path.join(DIRS.cover, args.without_mutants ? 'executed-nomutants.u32' : 'executed.u32'), img.length);
  const st = {
    summary, functions: readJson(path.join(DIRS.static, 'functions.json')), modules: readJson(path.join(DIRS.static, 'modules.json')),
    state: new Uint8Array(fs.readFileSync(path.join(DIRS.static, 'state.u8'))), phaseOf: new Uint8Array(fs.readFileSync(path.join(DIRS.static, 'phase.u8'))),
    owner: (() => { const b = new Uint8Array(fs.readFileSync(path.join(DIRS.static, 'owner.i32'))); return new Int32Array(b.buffer, 0, b.length >>> 2); })(),
  };
  const labels = loadLabels(LABELS);
  if (labels.model !== args.model) refuse(`${LABELS}: model ${labels.model}, want ${args.model}`);
  const r = await buildReport({ img, base: IMAGE_BASE, st, executed: exe.set, outside: exe.outside, groups, labels, top: args.top });
  fs.rmSync(DIRS.report, { recursive: true, force: true });
  fs.mkdirSync(DIRS.report, { recursive: true });
  fs.writeFileSync(path.join(DIRS.report, 'functions.jsonl'), r.functions.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeJson(DIRS.report, 'modules.json', { model: args.model, coverage: args.without_mutants ? 'without mutants' : 'all runs', headline: r.headline, modules: r.modules });
  writeJson(DIRS.report, 'regions.json', { model: args.model, regions: r.regions });
  writeJson(DIRS.report, 'lists.json', r.lists);
  writeJson(DIRS.report, 'validation.json', r.validation);
  writeJson(DIRS.report, 'blocks.json', { ...r.blocks, unlabelled: r.blocks.unlabelled.map((m) => ({ name: m.name, insns: m.insns, executed_insns: m.executed_insns })) });
  const md = markdown(r, { summary, groups, cover: groups, model: args.model });
  fs.writeFileSync(path.join(DIRS.report, 'report.md'), md);
  const hd = r.headline, B = r.blocks, pc = (a, b) => `${(100 * a / b).toFixed(2)}%`;
  say(`report: ${n(hd.executed_instructions)} of ${n(hd.instructions)} instructions executed (${pc(hd.executed_instructions, hd.instructions)}); normal use ${n(B.normal_use.executed)} of ${n(B.normal_use.insns)} (${pc(B.normal_use.executed, B.normal_use.insns)}); functions entered ${n(hd.functions_entered)} of ${n(hd.functions)}; modules entered ${n(hd.modules_entered)} of ${n(hd.modules)}; ${B.unlabelled.length} modules without a label, ${B.stale.length} labels without a module; ${((performance.now() - t) / 1000).toFixed(1)} s, rss ${rss()}`);
  const w = Math.max(...Object.keys(B.parts).map((b) => b.length), 5);
  console.log(`${'block'.padEnd(w)}  ${'modules'.padStart(7)}  ${'insns'.padStart(9)}  ${'executed'.padStart(8)}  ${'share'.padStart(7)}  ${'gap-unexec'.padStart(10)}`);
  for (const [b, x] of [...Object.entries(B.parts), ['total', B.total]]) console.log(`${b.padEnd(w)}  ${String(x.modules).padStart(7)}  ${String(x.insns).padStart(9)}  ${String(x.executed).padStart(8)}  ${pc(x.executed, x.insns || 1).padStart(7)}  ${String(x.gap_unexecuted).padStart(10)}`);
  say(`wrote ${rel(DIRS.report)}/ (report.md, blocks.json, modules.json, functions.jsonl, regions.json, lists.json, validation.json)`);
}

if (args.command === 'static' || args.command === 'all') doStatic();
if (args.command === 'cover' || args.command === 'all') await doCover();
if (args.command === 'report' || args.command === 'all') await doReport();
process.exitCode = rc;
