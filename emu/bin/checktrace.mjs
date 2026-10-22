#!/usr/bin/env node
// Trace every lab one emu/checks/runs.json run creates (bin/golden.mjs records them as check/<lab>): the JS check runs
// in-process with each lab traced as it is created (checks/lib/env.mjs traceLabs: the same Session, Tracer and dump as
// bin/run.mjs), as RUN, RUN#2, ... in creation order, format /4 for a DisplayLab and /2 (with 'frame' events from its
// drawing() brackets) for an OsdLab, the check's rc and stdout (wall figures masked) in each. A lab the check leaves
// open is closed after the check returns.
//   node emu/bin/checktrace.mjs RUN [--slice N] [--trace DIR]
// --slice N: every continue runs in slices of N instructions (the traces must not change).
// --trace DIR: where the traces go (default emu/out/js/check). The run's own env (runs.json "env") is applied before
// the check is imported. Refuses (exit 2) a run with --jobs or --mutants (child processes) and --write-notes. Exit 1 when the check's rc is not the run's declared one. The run's earlier traces in --trace are
// removed before anything else (a refusal of the run or an interrupted check leaves none behind); the check writes its
// files under a temporary OM_CHECK_OUT of its own, removed on exit (after a signal, by the next checktrace run).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadRuns, select, runEnv } from './checks.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const refuse = (msg) => { console.error(`checktrace.mjs: ${msg}`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { run: null, slice: null, trace: path.join(REPO, 'emu/out/js/check') };
for (let i = 0; i < argv.length; i++) {
  const x = argv[i];
  if (x === '--slice') { opts.slice = Number(argv[++i]); if (!Number.isInteger(opts.slice) || opts.slice < 1) refuse(`--slice ${argv[i]}: a positive instruction count`); }
  else if (x === '--trace') { const v = argv[++i]; if (v === undefined || v.startsWith('--')) refuse(`${x} DIR: a directory is required`); opts.trace = path.resolve(v); }
  else if (x.startsWith('--') || opts.run !== null) refuse(`unknown argument ${x}`);
  else opts.run = x;
}
if (opts.run === null) refuse('usage: checktrace.mjs RUN [--slice N] [--trace DIR]');
let sel;
try { [sel] = select(loadRuns(), [opts.run]); } catch (e) { refuse(e.message); }
if (sel.run.id !== opts.run) refuse(`${opts.run} is a check, not a run`);
const { check, run } = sel;
if (run.args.some((a) => a === '--jobs' || a === '--mutants')) refuse(`${run.id}: runs with --jobs or --mutants (child processes) are not traced`);
if (run.args.includes('--write-notes')) refuse(`${run.id}: --write-notes is not traced`);
Object.assign(process.env, runEnv(run));            // before the check (and checks/lib/env.mjs) is imported

// The run's earlier traces go first (RUN.json, RUN#k.json), before anything can fail or be interrupted, so a run that
// does not finish leaves no old trace behind (as run.mjs --trace does).
const ownFile = (f) => f.startsWith(`${run.id}.`) || f.startsWith(`${run.id}#`);
if (fs.existsSync(opts.trace)) for (const f of fs.readdirSync(opts.trace)) if (ownFile(f)) fs.rmSync(path.join(opts.trace, f));
// The check's own output directory: the {out} of its args and OM_CHECK_OUT (set before the check module is imported,
// which reads it at load), so a traced check never writes or reads back the shared emu/out/checks/js/manual/. It is
// removed on exit. A signal cannot remove it (the check runs synchronously, so a JS signal handler would only run after
// it, which would make the run uninterruptible): the directory names its pid, and each run first removes the
// directories of checktrace processes that no longer exist.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const f of fs.readdirSync(os.tmpdir())) {
  const m = /^om-emu-checktrace-(\d+)-/.exec(f);
  if (m && Number(m[1]) !== process.pid && !alive(Number(m[1]))) fs.rmSync(path.join(os.tmpdir(), f), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `om-emu-checktrace-${process.pid}-`));
process.env.OM_CHECK_OUT = tmp;
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const { traceLabs, exitFor } = await import('../checks/lib/env.mjs');
const { Session, dump, FORMAT, FORMAT4 } = await import('../src/trace/tracer.mjs');
const { DisplayLab } = await import('../src/lab/display.mjs');
const { OsdLab } = await import('../src/lab/osd.mjs');
const { spacedJson } = await import('../src/util/tracejson.mjs');

// Design D16: a session function's return value (check_menu's run_lab and g2_session, check_nav's run_script,
// run_long_wait and run_language) as ['result', fn, value] in the trace of the last lab created, normalised
// (dicts as sorted [key, value] pairs, sets sorted by their JSON, bytes
// and lists over 4096 items by sha256, tuples as lists, the wall-clock keys dropped, a png path as its file name; a
// float refused).
const { show } = await import('../src/util/show.mjs');
const { Tally } = await import('../src/util/tally.mjs');
const byCp = (a, b) => { const x = [...a], y = [...b]; for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d; } return x.length - y.length; };
const keyOf = (k) => (typeof k === 'string' ? k : show(k));
export function resultNorm(v, key = null) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean' || typeof v === 'string') return key === 'png' && typeof v === 'string' ? v.slice(v.lastIndexOf('/') + 1) : v;
  if (typeof v === 'number') { if (!Number.isInteger(v)) throw new TypeError(`resultNorm: float ${v} under ${key}`); return v; }
  if (v instanceof Uint8Array) return { $b: sha256(v), len: v.length };
  if (Array.isArray(v)) {
    let xs = v;
    if (key === 'phases' && v.length && v.every((x) => Array.isArray(x) && x.length === 5)) xs = v.map((x) => x.slice(0, 4));
    xs = xs.map((x) => resultNorm(x));
    if (xs.length > 4096) return { $l: sha256(Buffer.from(JSON.stringify(xs))), len: xs.length };
    return xs;
  }
  if (v instanceof Set) {
    const xs = [...v].map((x) => resultNorm(x)).map((x) => [JSON.stringify(x), x]).sort((a, b) => byCp(a[0], b[0])).map(([, x]) => x);
    return { $s: xs };
  }
  let entries;
  if (v instanceof Map) entries = [...v];
  else if (v instanceof Tally) entries = v.entries();
  else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) entries = Object.entries(v);
  else throw new TypeError(`resultNorm: an instance of ${v.constructor?.name} under ${key}`);
  const items = entries.filter(([k]) => k !== 'seconds' && k !== 'bring_up_seconds').map(([k, x]) => [keyOf(k), resultNorm(x, k)]);
  return { $d: items.sort((a, b) => byCp(a[0], b[0])) };
}

// every lab the check creates: a traced session, named in creation order, its format by the lab's class
const sessions = [];
let open = 0, overlap = 0;
traceLabs({
  ...(opts.slice ? { slice: opts.slice } : {}),
  onResult(fn, value) { if (sessions.length) sessions.at(-1).tracer.events.push(['result', fn, resultNorm(value)]); },
  beginSession(lab) {
    const name = sessions.length ? `${run.id}#${sessions.length + 1}` : run.id;
    const s = new Session(name, createHash, true), fmt = lab instanceof DisplayLab ? FORMAT4 : FORMAT;
    Object.assign(s.tracer, { fmt, fmt3: fmt === FORMAT4, fmt4: fmt === FORMAT4 });
    const close0 = s.close.bind(s);
    s.close = (hle, closeSim) => { open--; return close0(hle, closeSim); };
    if (open++) overlap++;
    sessions.push(s);
    return s;
  },
});
// The traced drawing(): a 'frame' event per bracket, in the lab's own trace (OsdLab and its subclasses)
const P = OsdLab.prototype, enter0 = P.drawing_enter, exit0 = P.drawing_exit, sha = (b) => createHash('sha256').update(b).digest('hex');
const trOf = (lab) => lab.session?.tracer ?? null;
const raisedFrame = (lab, e, expect) => {
  const tr = trOf(lab);
  if (tr) tr.events.push(['frame', { raised: e.constructor.name, expect: [...expect], planes: tr.planes() }]);
};
P.drawing_enter = function (expect = [], errlog = 0) {
  const tr = trOf(this);
  if (tr) tr.lab = this;
  this.engine.lastRaw = null;
  try { return enter0.call(this, expect, errlog); } catch (e) { raisedFrame(this, e, expect); throw e; }
};
P.drawing_exit = function (st, error = null) {
  let frame;
  try { frame = exit0.call(this, st, error); } catch (e) { raisedFrame(this, e, st.expect); throw e; }
  const tr = trOf(this);
  if (tr) {
    const rows = this.engine.lastRaw ?? [];
    tr.events.push(['frame', { result: frame.result, command_total: frame.command_total, error_total: frame.error_total,
      errors: frame.errors.map((e) => e.name), key_hits: frame.key_hits,
      errlog: frame.errlog.map(([c]) => '0x' + c.toString(16).padStart(8, '0')), logged: rows.length,
      exec_rows_sha: sha(spacedJson(rows)), expect: [...st.expect], planes: tr.planes() }]);
  }
  return frame;
};

// run the check (its stdout collected)
const args = run.args.map((a) => a.replaceAll('{out}', tmp));
const mod = await import(`../checks/${check}.mjs`);
if (typeof mod.main !== 'function') refuse(`checks/${check}.mjs exports no main(argv)`);
const load0 = os.loadavg()[0], t0 = performance.now(), lines = [];
const log0 = console.log;
console.log = (...xs) => { lines.push(...xs.map(String).join(' ').split('\n')); };
let rc;
try { rc = (await mod.main(args)) ?? 0; } catch (e) { console.log = log0; rc = exitFor(`${check}.mjs`, e); } finally { console.log = log0; }
for (const s of sessions) if (s.tracer.final === null && s.hle) s.hle.close();
const wall = (performance.now() - t0) / 1000;

// write
fs.mkdirSync(opts.trace, { recursive: true });
const env = { head: '', emu: true, node: process.version };
try { env.head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no git */ }
const WALL = /\(?\d+\.\d+ s\)?$/;
console.log(`${run.id}: rc ${rc}, ${wall.toFixed(2)} s (load ${load0.toFixed(2)} -> ${os.loadavg()[0].toFixed(2)}), ${sessions.length} lab(s)${opts.slice ? `, slices of ${opts.slice}` : ''}${overlap ? `, ${overlap} created while another was open` : ''}`);
if (rc !== run.rc) console.log(`  rc ${rc}, the run declares ${run.rc}`);
for (const s of sessions) {
  const doc = dump(s.tracer, createHash, { source: `emu/checks/${check}.mjs ${run.args.join(' ')}`.trimEnd(), rc, env, stdout: lines.map((l) => l.replace(WALL, '<wall>')) });
  fs.writeFileSync(path.join(opts.trace, `${s.name}.json`), JSON.stringify(doc));
  console.log(`${s.name}: written (${s.tracer.fmt.slice(-2)}, ${s.tracer.events.length} events)`);
}
process.exit(rc !== run.rc ? 1 : 0);
