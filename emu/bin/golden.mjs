#!/usr/bin/env node
// emu's own regression reference: what the lab did at a recorded commit, so that a refactor can show it changed
// nothing a camera or the firmware could observe. It needs only the firmware (the replayed scenarios' inputs are in
// emu/scenarios/calls, osd's are generated). It is not a statement of correctness: an intended behaviour change is
// judged against the firmware, the manual or a screenshot, and then re-recorded here with its reason.
//
// Every scenario of bin/run.mjs is run with tracing, and each session's trace is reduced to layers, each hashed:
//   screen   every compose (device, status, the planes and the pixels' sha256, the VSC errors and notes) and every
//            OSD drawing bracket, then the final planes: what the panels show
//   devices  the interrupt controller's presented and accepted rows, the device summary at every recorded call, the
//            final devices and registers: what the firmware and the hardware see
//   stops    every stop's pc, kind, registers and lab time: where the harness met the firmware (changes when the
//            harness's hooks or call shape change, without any guest-visible effect)
//   harness  the harness's own digests (register and memory writes, 'g' replies, counts, hook inventory) and the lab's
//            own records (the display steps and notes, the scenario's check results)
// and, for a replayed scenario, an output layer: every replayed call's outcome digest.
// screen, devices and output gate (exit 1 on a difference); stops and harness are reported, never a failure.
// Besides the scenarios, every lab of the check runs below (bin/checktrace.mjs, each lab traced as the check
// creates it) is a session named check/<lab>, with a fifth gating layer:
//   output   the check's rc and stdout (wall-clock figures masked) and its session results: what the check concluded
// And every run of emu/checks/runs.json is a session named run/<id> with the output layer alone (rc, stdout and
// stderr, wall-clock figures masked, and the sha256 of each output file the run declares), N at a time (--jobs N,
// default 6).
//
//   node emu/bin/golden.mjs check [SCENARIO|GROUP|check/RUN|run/ID ...] [--jobs N]   run, compare with emu/golden.json
//                                                          (default: everything)
//   node emu/bin/golden.mjs record [--reason TEXT --evidence LEVEL] [...]
//                                                          run and write emu/golden.json (and keep the traces in
//                                                          out/golden/recorded/ for the first-difference report)
//   node emu/bin/golden.mjs record --tooling-only --reason TEXT [...]
//                                                          the same with evidence 'tooling', refused (exit 2, nothing
//                                                          written) when a session's screen or devices layer differs
//                                                          from emu/golden.json or a session is not recorded there
// A recording that changes sessions needs a reason and its evidence level (EVIDENCE): what the new behaviour rests on
// (the firmware's code, the MN103 manual, a camera) or 'tooling' when only what golden records changed, not the lab.
// A --tooling-only recording logs which layers of which sessions changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const J = path.resolve(new URL('..', import.meta.url).pathname), REPO = path.dirname(J);
const FILE = path.join(J, 'golden.json'), OUT = path.join(J, 'out/golden');
const IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');
export const EVIDENCE = ['firmware', 'manual', 'camera', 'tooling'];
const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export const GATING = ['screen', 'devices', 'output'], LAYERS = ['screen', 'devices', 'stops', 'harness', 'output'];
// the check runs whose labs are recorded: checktrace-runs.mjs's (play sessions are recorded as the Player scenarios)
const { STAGE3B_TRACED } = await import('./checktrace-runs.mjs');
export const CHECK_RUNS = [...STAGE3B_TRACED];

// The layers of one trace document, each a list of items (compared item by item for the first-difference report).
export function layers(doc) {
  if (doc.run) return { screen: [], devices: [], stops: [], harness: [], output: [['rc', doc.rc], ['stdout', doc.stdout.map(wall)], ['stderr', doc.stderr.filter((l) => !/^\s+at /.test(l)).map(wall)], ...(doc.files ?? []).map((f) => ['file', ...f])] };   // stack frames: node's own vary by version
  const ev = doc.events ?? [], f = doc.final ?? {};
  const screen = [], devices = [], stops = [], labEvents = [], results = [];
  for (const e of ev) {
    if (e[0] === 'compose' || e[0] === 'frame') screen.push(e);
    else if (e[0] === 'irq') devices.push(e);
    else if (e[0] === 'mark') devices.push(['mark', e[1], e[2]?.devices ?? null]);
    else if (e[0] === 'stop') stops.push(e.slice(0, 6));       // without h, the harness digest
    else if (e[0] === 'result') results.push(e);                // a check's session result (checktrace)
    else labEvents.push(e);                                     // the lab's display steps and notes, the scenario's checks
  }
  screen.push(['final.planes', f.planes ?? null]);
  devices.push(['final.devices', f.devices ?? null], ['final.regs', f.regs ?? null], ['rc', doc.rc ?? null]);
  if (doc.divergence) devices.push(['threw', doc.divergence]);
  const harness = [['digests', doc.digests ?? null], ['stats', f.stats ?? null], ['harness_sha', f.harness_sha ?? null],
    ['log', f.log_len ?? null, f.log_sha ?? null], ['inventory', doc.inventory ?? null], ['counts', doc.counts ?? null],
    ['stop.h', ev.filter((e) => e[0] === 'stop').map((e) => e[6])], ['lab events', labEvents]];
  // a replayed scenario's outcome digests (run.mjs: replay.outcomes)
  const output = [...(doc.stdout !== undefined ? [['rc', doc.rc ?? null], ['stdout', doc.stdout.map(wall)]] : []), ...(doc.replay ? [['replay', doc.replay]] : []), ...results];
  return { screen, devices, stops, harness, output };
}
const digestOf = (L) => Object.fromEntries(LAYERS.map((k) => [k, sha(L[k])]).concat([['items', Object.fromEntries(LAYERS.map((k) => [k, L[k].length]))]]));

// every lab of the check runs, traced by checktrace.mjs into dir/check
function runChecks(runs, dir) {
  const docs = {}, out = path.join(dir, 'check');
  fs.mkdirSync(out, { recursive: true });
  for (const run of runs) {
    const r = spawnSync(process.execPath, [path.join(J, 'bin/checktrace.mjs'), run, '--trace', out], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { process.stderr.write(`golden: checktrace ${run} exit ${r.status}\n${r.stdout.slice(-1500)}${r.stderr.slice(-1500)}`); process.exit(2); }
    for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.json') && !x.includes('.divergence') && (x === `${run}.json` || x.startsWith(`${run}#`)))) {
      docs[`check/${f.slice(0, -5)}`] = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
    }
  }
  return docs;
}
// wall-clock and speed figures anywhere in a line ('1.6 s', '3 s', '12.5 ms', '63 MIPS', 'load 1.21'): they differ
// between runs and hosts
const wall = (l) => l.replace(/\b\d+(?:\.\d+)? (?:m?s|MIPS|MB)\b/g, '<wall>').replace(/\bload \d+\.\d+/g, 'load <wall>');
async function runRuns(ids, jobs) {
  const C = await import('./checks.mjs');
  const sels = C.select(C.loadRuns(), []).filter((s) => !ids || ids.includes(s.run.id));
  const docs = {};
  let next = 0;
  const worker = async () => {
    while (next < sels.length) {
      const { check, run } = sels[next++];
      const r = await C.runJsAsync(check, run, { dirName: `golden-${run.id}` });
      const files = C.filesOf(run, r.dir).map((f) => [path.relative(r.dir, f), fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null]);
      fs.rmSync(r.dir, { recursive: true, force: true });
      // a volatile line (runs.json) is kept up to the end of its match: the check's verdict on it, not its wall-clock detail
      const vre = run.volatile ? new RegExp(run.volatile) : null;
      const stdout = r.stdout.split('\n').map((l) => { const m = vre?.exec(l); return m ? `${l.slice(0, m.index + m[0].length)}<volatile>` : l; });
      docs[`run/${run.id}`] = { run: true, rc: r.rc, stdout, stderr: r.stderr.split('\n'), files };
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  return docs;
}
function runAll(names, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(J, 'bin/run.mjs'), ...(names.length ? names : ['all']), '--trace', dir], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  // a session that threw leaves a partial trace and a divergence file instead of its trace
  const files = fs.readdirSync(dir);
  const docs = {};
  for (const x of files.filter((f) => f.endsWith('.json') && !f.includes('.divergence') && !f.includes('.partial'))) docs[x.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8'));
  for (const x of files.filter((f) => f.endsWith('.partial.json'))) {
    const n = x.slice(0, -'.partial.json'.length), div = path.join(dir, `${n}.divergence.json`);
    docs[n] = { ...JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')), divergence: fs.existsSync(div) ? JSON.parse(fs.readFileSync(div, 'utf8')) : { partial: true } };
  }
  // one that threw before its first lab (osd: check_osd, generating its inputs, failed) leaves only the divergence file
  for (const x of files.filter((f) => f.endsWith('.divergence.json'))) {
    const n = x.slice(0, -'.divergence.json'.length);
    docs[n] ??= { divergence: JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')) };
  }
  if (!Object.keys(docs).length) { process.stderr.write(`golden: run.mjs wrote no traces (exit ${r.status})\n${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`); process.exit(2); }
  return docs;
}
const git = (...a) => { try { return spawnSync('git', a, { cwd: REPO, encoding: 'utf8' }).stdout.trim(); } catch { return null; } };

function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return { index: i, of: [a.length, b.length], recorded: a[i], now: b[i] };
  return null;
}

async function main(argv) {
  const mode = argv[0];
  if (mode !== 'check' && mode !== 'record') { process.stderr.write('usage: golden.mjs check|record [--reason TEXT] [--evidence LEVEL | --tooling-only] [SCENARIO|GROUP ...]\n'); return 2; }
  let reason = null, evidence = null, jobs = 6, toolingOnly = false;
  const names = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--reason') reason = argv[++i];
    else if (argv[i] === '--evidence') evidence = argv[++i];
    else if (argv[i] === '--jobs') jobs = Number(argv[++i]);
    else if (argv[i] === '--tooling-only') toolingOnly = true;
    else names.push(argv[i]);
  }
  if (evidence !== null && !EVIDENCE.includes(evidence)) { process.stderr.write(`golden: --evidence ${evidence}: one of ${EVIDENCE.join(', ')}\n`); return 2; }
  if (toolingOnly && (mode !== 'record' || !reason || (evidence ?? 'tooling') !== 'tooling')) { process.stderr.write('golden: --tooling-only is a record with --reason TEXT (its evidence is tooling)\n'); return 2; }
  if (toolingOnly) evidence = 'tooling';
  const image = createHash('sha256').update(fs.readFileSync(IMAGE)).digest('hex');
  if (toolingOnly && (!fs.existsSync(FILE) || JSON.parse(fs.readFileSync(FILE, 'utf8')).image_sha256 !== image)) { process.stderr.write(`golden: --tooling-only: no ${path.relative(REPO, FILE)} recorded on this firmware image to compare with\n`); return 2; }
  // a --tooling-only recording runs where check does and replaces recorded/ only once the guard has passed
  const dir = path.join(OUT, mode === 'record' && !toolingOnly ? 'recorded' : 'current');
  const scen = names.filter((n) => !n.includes('/')), runs = names.length ? names.filter((n) => n.startsWith('check/')).map((n) => n.slice(6)) : CHECK_RUNS;
  const ids = names.length ? names.filter((n) => n.startsWith('run/')).map((n) => n.slice(4)) : null;
  const docs = { ...(scen.length || !names.length ? runAll(scen, dir) : (fs.rmSync(dir, { recursive: true, force: true }), {})), ...(runs.length ? runChecks(runs, dir) : {}),
    ...(ids === null || ids.length ? await runRuns(ids, jobs) : {}) };
  for (const [n, d] of Object.entries(docs)) if (d.run) { fs.mkdirSync(path.dirname(path.join(dir, `${n}.json`)), { recursive: true }); fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(d)); }
  const now = Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, digestOf(layers(d))]));
  if (mode === 'record') {
    const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { sessions: {}, log: [] };
    // golden.json keeps its session order (new sessions sorted at the end), not the runs' completion order: a
    // re-record's diff shows only the digests that moved
    const merged = names.length ? { ...old.sessions, ...now } : now;
    const sessions = Object.fromEntries([...Object.keys(old.sessions).filter((n) => n in merged), ...Object.keys(merged).filter((n) => !(n in old.sessions)).sort()].map((n) => [n, merged[n]]));
    const changed = Object.keys(now).filter((n) => JSON.stringify(old.sessions[n]) !== JSON.stringify(now[n]));
    // the layers each changed session differs in (all of them for a session golden.json does not hold)
    const diffs = Object.fromEntries(changed.map((n) => [n, LAYERS.filter((k) => old.sessions[n]?.[k] !== now[n][k])]));
    if (toolingOnly) {
      const moved = changed.filter((n) => !old.sessions[n] || diffs[n].some((k) => k === 'screen' || k === 'devices'));
      if (moved.length) { process.stderr.write(`golden: --tooling-only: ${moved.length} session(s) change on screen or devices, nothing recorded:\n${moved.map((n) => `  ${n}: ${old.sessions[n] ? diffs[n].join(', ') : 'not recorded'}\n`).join('')}`); return 2; }
      if (!changed.length) { console.log(`golden: nothing changed in ${Object.keys(now).length} sessions, ${path.relative(REPO, FILE)} kept`); return 0; }
    }
    const byLayer = Object.fromEntries(LAYERS.map((k) => [k, changed.filter((n) => diffs[n].includes(k))]).filter(([, ns]) => ns.length));
    const log = [...(old.log ?? []), { commit: git('rev-parse', '--short', 'HEAD'), sessions: changed.length, reason: reason ?? (old.log?.length ? null : 'first recording'), ...(evidence ? { evidence } : {}), ...(toolingOnly ? { changed: byLayer } : {}) }];
    if (old.log?.length && changed.length && (!reason || !evidence)) { process.stderr.write(`golden: ${changed.length} session(s) change (${changed.slice(0, 8).join(', ')}): give --reason and --evidence (${EVIDENCE.join(', ')})\n`); return 2; }
    fs.writeFileSync(FILE, JSON.stringify({ about: 'emu/bin/golden.mjs: per scenario session, the sha256 of each layer of its trace', image_sha256: image, sessions, log }, null, 1) + '\n');
    if (toolingOnly) { fs.rmSync(path.join(OUT, 'recorded'), { recursive: true, force: true }); fs.renameSync(dir, path.join(OUT, 'recorded')); }
    console.log(`golden: recorded ${Object.keys(now).length} sessions (${changed.length} changed) -> ${path.relative(REPO, FILE)}`);
    return 0;
  }
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (want.image_sha256 !== image) { process.stderr.write('golden: recorded on another firmware image\n'); return 2; }
  let bad = 0, notes = 0;
  for (const n of Object.keys(names.length ? now : want.sessions).sort()) {
    const w = want.sessions[n], g = now[n];
    if (!w || !g) { console.log(`${n}: ${!w ? 'not recorded' : 'not run'}`); bad++; continue; }
    const diff = LAYERS.filter((k) => w[k] !== g[k]);
    if (!diff.length) { console.log(`${n}: identical`); continue; }
    const gate = diff.filter((k) => GATING.includes(k));
    bad += gate.length ? 1 : 0; notes += gate.length ? 0 : 1;
    console.log(`${n}: ${gate.length ? 'DIFFERENT' : 'same screen, devices and output'} (${diff.join(', ')} changed)`);
    const rec = path.join(OUT, 'recorded', `${n}.json`);   // check/<lab>: recorded/check/<lab>.json
    if (fs.existsSync(rec)) {
      const a = layers(JSON.parse(fs.readFileSync(rec, 'utf8'))), b = layers(docs[n]);
      for (const k of diff) {
        const d = firstDiff(a[k], b[k]);
        if (d) console.log(`  ${k}: first difference at item ${d.index} of ${d.of.join('/')}\n    recorded: ${JSON.stringify(d.recorded)?.slice(0, 300)}\n    now:      ${JSON.stringify(d.now)?.slice(0, 300)}`);
      }
    } else console.log(`  (no recorded traces in ${path.relative(REPO, path.join(OUT, 'recorded'))} for a first-difference report)`);
  }
  console.log(bad ? `golden: ${bad} session(s) DIFFERENT on screen, devices or output` : `golden: screen, devices and output identical${notes ? ` (${notes} session(s) with harness-only changes)` : ''}`);
  return bad ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
