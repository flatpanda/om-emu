// bin/fwmap.mjs cover: run a workload under OM_COVERAGE (checks/lib/coverage.mjs) and take the union of what every
// node thread of it executed. The workload is golden's without its tracing: bin/run.mjs over the scenarios, then
// bin/checks.mjs over the runs of checks/runs.json (each a child process, check_menu's and check_nav's --jobs worker
// threads, the --mutants children), each part selectable.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Run the workload with raw (emptied first) as OM_COVERAGE. scenarios / checks: the names bin/run.mjs and
// bin/checks.mjs take, [] for none. Returns [{part, argv, rc, seconds}]; each part's stdout and stderr go to
// raw/<part>.stdout / .stderr.
export async function runWorkload({ repo, raw, scenarios, checks, jobs, model, log }) {
  fs.rmSync(raw, { recursive: true, force: true });
  fs.mkdirSync(raw, { recursive: true });
  const env = { ...process.env, OM_COVERAGE: raw, OM_EMU_MODEL: model };
  const parts = [];
  if (scenarios.length) parts.push(['run', ['emu/bin/run.mjs', ...scenarios]]);
  if (checks.length) parts.push(['checks', ['emu/bin/checks.mjs', '--jobs', String(jobs), ...(checks[0] === 'all' ? [] : checks)]]);
  const out = [];
  for (const [part, argv] of parts) {
    log(`${part}: node ${argv.join(' ')}`);
    const t0 = performance.now();
    const rc = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, argv, { cwd: repo, env, stdio: ['ignore', fs.openSync(path.join(raw, `${part}.stdout`), 'w'), fs.openSync(path.join(raw, `${part}.stderr`), 'w')] });
      p.on('error', reject);
      p.on('exit', (code, signal) => resolve(code ?? signal));
    });
    const seconds = +((performance.now() - t0) / 1000).toFixed(1);
    log(`${part}: exit ${rc} after ${seconds} s`);
    out.push({ part, argv, rc, seconds });
  }
  return out;
}

// A thread's group: 'scenarios' (bin/run.mjs), 'mutants' (a run whose environment breaks the lab on purpose:
// OM_*_MUTANT, OM_FAULT, OM_MACHINE with a mutant) or 'checks'.
const isMutant = (env) => Object.entries(env).some(([k, v]) => /MUTANT|FAULT/.test(k) || (k === 'OM_MACHINE' && /mutant/.test(v)));
// The union of raw's thread files: {all, clean (without the mutant group), doc}. all / clean: Uint8Array per body
// offset of the alias bits; doc: per group (and per group/script) threads, executed count and runs, the stand-ins
// fired ({pc, name, fires, groups}), the other pcs.
export function union(raw, { size, model }) {
  const all = new Uint8Array(size), clean = new Uint8Array(size);
  const groups = {}, stubs = new Map(), other = new Map();
  const files = fs.readdirSync(raw).filter((f) => /^\d+-\d+\.json$/.test(f)).sort();
  for (const f of files) {
    const meta = JSON.parse(fs.readFileSync(path.join(raw, f), 'utf8'));
    if (meta.model !== model) throw new Error(`${path.join(raw, f)}: model ${meta.model}, want ${model}`);
    const offs = words(path.join(raw, f.replace(/\.json$/, '.bin')));
    const script = path.basename(meta.argv[1] ?? '?', '.mjs');
    const mutant = isMutant(meta.env);
    const group = script === 'run' ? 'scenarios' : mutant ? 'mutants' : 'checks';
    const args = meta.argv.slice(2).join(' ');
    const run = `${script}${args ? ' ' + args : ''}${mutant ? ' ' + JSON.stringify(meta.env) : ''}`;
    for (const g of [group, `${group}/${script}`]) {
      groups[g] ??= { threads: 0, set: new Uint8Array(size), runs: new Set() };
      groups[g].threads++; groups[g].runs.add(run);
      for (const v of offs) groups[g].set[v & 0x1ffffff] |= v >>> 25;
    }
    for (const v of offs) { all[v & 0x1ffffff] |= v >>> 25; if (!mutant) clean[v & 0x1ffffff] |= v >>> 25; }
    for (const [pc, name, fires] of meta.stubs) {
      const k = `${pc}|${name}`, s = stubs.get(k) ?? { pc, name, fires: 0, groups: new Set() };
      s.fires += fires; s.groups.add(group); stubs.set(k, s);
    }
    for (const [pc, n] of meta.other) other.set(pc, (other.get(pc) ?? 0) + n);
  }
  const countOf = (set) => { let n = 0; for (let o = 0; o < size; o++) if (set[o]) n++; return n; };
  const doc = {
    model, threads: files.length, executed_all: countOf(all), executed_without_mutants: countOf(clean),
    groups: Object.fromEntries(Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([g, v]) => [g, { threads: v.threads, executed: countOf(v.set), runs: [...v.runs].sort() }])),
    stubs: [...stubs.values()].map((s) => ({ ...s, groups: [...s.groups].sort() })).sort((a, b) => b.fires - a.fires || a.pc.localeCompare(b.pc) || a.name.localeCompare(b.name)),
    other_pcs: [...other].sort((a, b) => b[1] - a[1]).slice(0, 200),
  };
  return { all, clean, doc };
}

// The executed set as the file format: u32 LE per body offset with any bit set, offset | bits << 25, offset order.
export function pack(set) {
  let n = 0;
  for (let o = 0; o < set.length; o++) if (set[o]) n++;
  const out = new Uint32Array(n);
  for (let o = 0, k = 0; o < set.length; o++) if (set[o]) out[k++] = (o | set[o] << 25) >>> 0;
  return out;
}
// u32 LE words of a file (a small file's Buffer may sit unaligned in node's pool: copied)
const words = (file) => { const b = fs.readFileSync(file); return new Uint32Array(b.byteOffset & 3 ? new Uint8Array(b).buffer : b.buffer, b.byteOffset & 3 ? 0 : b.byteOffset, b.length >>> 2); };
export function unpack(file, size) {
  const set = new Uint8Array(size);
  let outside = 0;
  for (const v of words(file)) { const o = v & 0x1ffffff; if (o < size) set[o] = v >>> 25; else outside++; }
  return { set, outside };
}
