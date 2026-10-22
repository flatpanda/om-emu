#!/usr/bin/env node
// The checks' own verdicts: every run of emu/checks/runs.json (or the checks / run ids named) as
// `node emu/checks/<check>.mjs ARGS` from the repository root, one child process each, N at a time (--jobs N, default
// 4). A run passes when it exits with the status runs.json declares and, where the run names them, some stdout line
// matches its stdout_re and some stderr line its stderr_re (a fault-point run names the predicate it must trip). What a
// run prints and writes (stdout, stderr, its declared files) is recorded by bin/golden.mjs as run/<id>, so a change in
// a check's output that keeps its verdict shows there.
//
// A run may set its own environment variables (runs.json "env", ENV_WHITELIST); the child runs under a pinned terminal
// (refenv TERMINAL: NO_COLOR) and refuses the run variables inherited from the caller (refenv childEnv).
// Its output files go under OM_CHECK_OUT, emu/out/checks/js/<run>/, removed after a pass unless --keep.
//
//   node emu/bin/checks.mjs [CHECK | RUN ...] [--jobs N] [--keep] [--measure N]
//     --keep       keep the outputs of the runs that pass
//     --measure N  N processes per run, one at a time: median and range of wall, load before and after, peak RSS
//                  (/usr/bin/time); no verdict
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { childEnv } from '../checks/lib/refenv.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const J = path.join(REPO, 'emu');
const RUNS = path.join(J, 'checks/runs.json');
const JS = path.join(J, 'out/checks/js');
const load1 = () => os.loadavg()[0];
const lines = (t) => { const l = t.split('\n'); if (l.length && l[l.length - 1] === '') l.pop(); return l; };

export class Refusal extends Error {}

export function loadRuns(file = RUNS) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.format !== 'om1-checks/2') throw new Refusal(`${file}: format ${doc.format}, want om1-checks/2`);
  return doc;
}
// The JS check files and runs.json must name the same checks.
export function checkFiles(doc, dir = path.join(J, 'checks')) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
  const named = Object.keys(doc.checks).sort();
  const noFile = named.filter((c) => !files.includes(c)), noRun = files.filter((c) => !named.includes(c));
  if (noFile.length) throw new Refusal(`runs.json names ${noFile.join(', ')} with no emu/checks/<check>.mjs`);
  if (noRun.length) throw new Refusal(`emu/checks/${noRun.join('.mjs, ')}.mjs not in runs.json`);
}
export function select(doc, names) {
  const runs = Object.entries(doc.checks).flatMap(([check, c]) => c.runs.map((run) => ({ check, run })));
  const unknown = names.filter((n) => !runs.some((r) => r.check === n || r.run.id === n));
  if (unknown.length) throw new Refusal(`no run or check named ${unknown.join(', ')} in runs.json`);
  const picked = names.length ? runs.filter((r) => names.includes(r.check) || names.includes(r.run.id)) : runs;
  for (const r of picked) runEnv(r.run);               // a run env outside the whitelist is refused before any run
  return picked;
}
// A run's own environment variables (runs.json "env"): only these.
export const ENV_WHITELIST = ['OM_MACHINE', 'OM_MENU_MUTANT', 'OM_NAV_MUTANT', 'OM_TEXT_MUTANT', 'OM_MENU_STORE', 'OM_FAULT'];
export function runEnv(run) {
  const env = run.env ?? {};
  const bad = Object.keys(env).filter((k) => !ENV_WHITELIST.includes(k));
  if (bad.length) throw new Refusal(`run ${run.id} sets ${bad.join(', ')}: not in the run env whitelist ${ENV_WHITELIST.join(', ')}`);
  return { ...env };
}
const subst = (args, dir) => args.map((a) => a.replaceAll('{out}', dir));

// A run's fresh output directory, environment and node arguments.
function invocation(check, run, { extraEnv = {}, dirName = run.id } = {}) {
  const dir = path.join(JS, dirName);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...childEnv(), ...runEnv(run), OM_CHECK_OUT: dir, ...extraEnv };
  const args = [path.join('emu/checks', `${check}.mjs`), ...subst(run.args, path.relative(REPO, dir))];
  return { dir, env, args };
}
// The run's declared output files, as paths
export const filesOf = (run, dir) => (run.files ?? []).map((f) => path.join(REPO, subst([f], path.relative(REPO, dir))[0]));

export function runJs(check, run, { timeFile = null, extraEnv = {}, dirName = run.id } = {}) {
  const { dir, env, args } = invocation(check, run, { extraEnv, dirName });
  const cmd = timeFile ? ['/usr/bin/time', ['-o', timeFile, '-f', '%e %M', process.execPath, ...args]] : [process.execPath, args];
  const l0 = load1(), t0 = performance.now();
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr, wall: (performance.now() - t0) / 1000, load: [l0, load1()], dir };
}
// runJs without blocking (several runs at once)
export function runJsAsync(check, run, { extraEnv = {}, dirName = run.id } = {}) {
  const { dir, env, args } = invocation(check, run, { extraEnv, dirName });
  const l0 = load1(), t0 = performance.now();
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ rc: code, stdout, stderr, wall: (performance.now() - t0) / 1000, load: [l0, load1()], dir }));
  });
}

// The verdict on one finished run: null when it passed, else what is wrong.
export function verdict(run, js) {
  const why = [];
  if (js.rc !== run.rc) why.push(`rc ${js.rc}, want ${run.rc}${js.stderr.trim() ? ` (stderr, last line: ${lines(js.stderr).pop()})` : ''}`);
  if (typeof run.stdout_re === 'string' && !lines(js.stdout).some((l) => new RegExp(run.stdout_re).test(l))) why.push(`no stdout line matches ${JSON.stringify(run.stdout_re)}`);
  if (typeof run.stderr_re === 'string' && !lines(js.stderr).some((l) => new RegExp(run.stderr_re).test(l))) why.push(`no stderr line matches ${JSON.stringify(run.stderr_re)}`);
  for (const f of filesOf(run, js.dir)) if (!fs.existsSync(f)) why.push(`declared file ${path.relative(REPO, f)} not written`);
  return why.length ? why.join('; ') : null;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
function measure(sels, n) {
  const tf = path.join(os.tmpdir(), `om-emu-checks-time-${process.pid}.txt`);
  for (const sel of sels) {
    const js = [];
    for (let k = 0; k < n; k++) {
      const r = runJs(sel.check, sel.run, { timeFile: tf });
      const [, rss] = fs.readFileSync(tf, 'utf8').trim().split(/\s+/).slice(-2);
      js.push({ wall: r.wall, load: r.load, rss: Number(rss), rc: r.rc });
    }
    fs.rmSync(path.join(JS, sel.run.id), { recursive: true, force: true });
    const f = (xs) => `${median(xs).toFixed(2)} [${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}]`;
    const loads = js.flatMap((x) => x.load);
    console.log(`${sel.run.id}: ${f(js.map((x) => x.wall))} s, peak RSS ${f(js.map((x) => x.rss / 1024))} MB, load ${Math.min(...loads).toFixed(2)}-${Math.max(...loads).toFixed(2)}, rc ${[...new Set(js.map((x) => x.rc))].join('/')}`);
  }
  fs.rmSync(tf, { force: true });
}

async function main(argv) {
  const names = [];
  let keep = false, measureN = 0, jobs = 4;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') keep = true;
    else if (argv[i] === '--measure' || argv[i] === '--jobs') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1) throw new Refusal(`${argv[i]} ${argv[i + 1]}: a positive count`);
      if (argv[i++] === '--jobs') jobs = v; else measureN = v;
    } else if (argv[i].startsWith('--')) throw new Refusal(`unknown option ${argv[i]}`);
    else names.push(argv[i]);
  }
  const doc = loadRuns();
  checkFiles(doc);
  const sels = select(doc, names);
  if (measureN) { measure(sels, measureN); return 0; }
  fs.mkdirSync(JS, { recursive: true });
  let bad = 0, next = 0;
  const worker = async () => {
    while (next < sels.length) {
      const { check, run } = sels[next++];
      const js = await runJsAsync(check, run);
      const why = verdict(run, js);
      fs.writeFileSync(path.join(JS, `${run.id}.stdout`), js.stdout);
      fs.writeFileSync(path.join(JS, `${run.id}.stderr`), js.stderr);
      if (why) bad++;
      else if (!keep) fs.rmSync(js.dir, { recursive: true, force: true });
      console.log(`${why ? 'FAIL' : 'ok  '} ${run.id} (${check}, ${js.wall.toFixed(1)} s)${why ? `: ${why}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, sels.length) }, worker));
  console.log(bad ? `\n${bad} of ${sels.length} runs FAILED (stdout and stderr in ${path.relative(REPO, JS)}/)` : `\nall ${sels.length} runs passed`);
  return bad ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((rc) => { process.exitCode = rc; }, (e) => {
    if (!(e instanceof Refusal)) throw e;
    console.error(`checks.mjs: ${e.message}`);
    process.exitCode = 2;
  });
}
