// Regression tests for the command-line tools and the regression net's permanent controls.
//   cli   run.mjs --trace removes an earlier run's trace and divergence files; bench.mjs refuses a pass count that
//         leaves no steady set and repeats pass 0 on every pass; a scenario that throws (no K-BOOTSYNC hook) is
//         reported with its partial trace and divergence file, the next scenario still runs, and golden reports it.
//   cli2  a wrong OSD fill colour is caught by golden on the screen layer (check_osd, which generates the osd
//         scenario's inputs, stops on it, and golden records the scenario as one that threw); golden record
//         --tooling-only refuses to record it (exit 2, golden.json and the recorded traces untouched).
//   cli3  run.mjs refuses --slice 0, and a --slice 3 run traces exactly what an unsliced one does; --trace and --calls
//         need a directory.
//   cli4  J1 (display.mjs stub_log() takes unwritten from bit 64 instead of 128): golden reports shoot-tft's harness
//         layer (the lab's display steps), and golden record --tooling-only records it with the changed layer in its
//         log entry, after which golden check is identical; the osd replay refuses a call with an unknown keyword (in
//         a copy of the generated osd inputs).
//   cli5  inputs whose labs the run does not open are refused, naming both lists;
//         run.mjs --trace writes one trace per lab of a multi-lab session; playperf.mjs refuses bad arguments.
//   cli6  the permanent controls J7 (the S-CPU2 reply index w0 + 1), J8 (a dial step record's word + 1) and
//         J7b (the IPI handler counted twice): golden reports the scenario on its output layer (the replayed calls'
//         outcome digests); an inputs file in another format (an earlier recorded-calls format, om1-stage2-calls/2) is
//         refused before its first action (NC-FMT).
// Needs emu/golden.json; writes its files to emu/out/test-cli*/ (gitignored, firmware-derived) and removes them.
//   node emu/test/test_cli.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const J = path.join(REPO, 'emu');
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// A copy of emu (without out/) under root/<name>/emu with one source replacement.
function mutant(root, name, file, oldText, newText) {
  const d = path.join(root, name);
  fs.mkdirSync(path.join(d, 'emu/out'), { recursive: true });
  for (const x of ['bin', 'src', 'scenarios', 'test', 'refs', 'checks', 'host', 'web', 'package.json', 'golden.json']) if (fs.existsSync(path.join(J, x))) fs.cpSync(path.join(J, x), path.join(d, 'emu', x), { recursive: true });
  for (const x of ['unpacked']) fs.symlinkSync(path.join(REPO, x), path.join(d, x));
  const f = path.join(d, 'emu', file), t = fs.readFileSync(f, 'utf8');
  if (t.split(oldText).length !== 2) throw new Error(`mutant ${name}: ${file} does not hold the text once`);
  fs.writeFileSync(f, t.replace(oldText, newText));
  return path.join(d, 'emu');
}
// bin/golden.mjs check of one session in the copy emu dir m: null when it reports the session with every layer of
// `layers` changed (and exits 1 when one of them gates), else what it reported
function goldenReports(m, session, layers) {
  const r = spawnSync('node', [path.join(m, 'bin/golden.mjs'), 'check', session], { cwd: path.dirname(m), encoding: 'utf8', maxBuffer: 1 << 28 });
  const line = r.stdout.split('\n').find((l) => l.startsWith(`${session}: `)) ?? '';
  const changed = /\(([\w, ]+) changed\)$/.exec(line)?.[1].split(', ') ?? [];
  const gates = layers.some((k) => ['screen', 'devices', 'output'].includes(k));
  if (layers.every((k) => changed.includes(k)) && r.status === (gates ? 1 : 0)) return null;
  return `golden exit ${r.status}, line ${JSON.stringify(line)}, want ${layers.join(', ')} changed\n${r.stdout.slice(-300)}${r.stderr.slice(-300)}`;
}

export function cli() {
  const bad = [];
  const root = path.join(J, 'out/test-cli'), js = path.join(root, 'js');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(js, { recursive: true });
  // stale files of an earlier run: a kernel-6 trace that is not this run's, a kernel-7 divergence
  fs.writeFileSync(path.join(js, 'kernel-6.json'), '{"stale": true}');
  fs.writeFileSync(path.join(js, 'kernel-7.divergence.json'), '{"stale": true}');
  let r = sh('node', [path.join(J, 'bin/run.mjs'), 'kernel-6', 'kernel-7', '--trace', js]);
  if (r.status !== 0) bad.push(`run.mjs kernel-6 kernel-7 --trace: exit ${r.status}\n${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  if (fs.existsSync(path.join(js, 'kernel-7.divergence.json'))) bad.push('stale kernel-7.divergence.json survived the run');
  if (!readJson(path.join(js, 'kernel-6.json')).env?.emu) bad.push('kernel-6.json is still the stale copy, not the JS trace');
  // bench.mjs: two passes leave no steady set; three passes repeat pass 0
  r = sh('node', [path.join(J, 'bin/bench.mjs'), 'osd', '--passes', '2']);
  if (r.status !== 2 || /NaN|Infinity/.test(r.stdout)) bad.push(`bench.mjs --passes 2: exit ${r.status}, want 2 and no NaN\n${r.stdout}${r.stderr}`);
  r = sh('node', [path.join(J, 'bin/bench.mjs'), 'kernel', '--passes', '3']);
  if (r.status !== 0 || !/every pass repeats pass 0/.test(r.stdout)) bad.push(`bench.mjs kernel --passes 3: exit ${r.status}, want 0\n${r.stdout.slice(-400)}${r.stderr}`);
  // a scenario that throws (no K-BOOTSYNC hook: a FirmwareError in boot) is reported, writes its divergence and
  // partial files, the next scenario still runs; golden reports the session
  const mb = mutant(root, 'bootsync', 'src/lab/kernel.mjs', "    hle.hook(BOOTSYNC, skip('K-BOOTSYNC'), 'K-BOOTSYNC');", '');
  const out = path.join(root, 'bootsync-js');
  r = sh('node', [path.join(mb, 'bin/run.mjs'), 'kernel-1', 'kernel-7', '--trace', out]);
  const d1 = path.join(out, 'kernel-1.divergence.json'), doc = fs.existsSync(d1) ? readJson(d1) : null;
  if (r.status !== 1 || !/kernel-1: THREW FirmwareError/.test(r.stdout) || !/kernel-7: THREW FirmwareError/.test(r.stdout)) bad.push(`throwing scenarios: exit ${r.status}, want 1 and a THREW line for each\n${r.stdout}${r.stderr.slice(-300)}`);
  if (doc?.exception?.class !== 'FirmwareError') bad.push(`kernel-1 divergence file: ${JSON.stringify(doc?.exception ?? null).slice(0, 300)}`);
  if (!fs.existsSync(path.join(out, 'kernel-1.partial.json')) || !fs.existsSync(path.join(out, 'kernel-7.divergence.json'))) bad.push('throwing scenarios: partial trace of kernel-1 or the kernel-7 divergence file missing');
  const g = goldenReports(mb, 'kernel-1', ['devices']);
  if (g) bad.push(`golden on the throwing kernel-1: ${g}`);
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 10, bad };
}

export function cli2() {
  const bad = [];
  const root = path.join(J, 'out/test-cli2');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // a wrong OSD fill colour: golden's screen layer
  const mf = mutant(root, 'fill', 'src/dev/engine.mjs', 'const row = new Uint8Array(width).fill(w[1]);', 'const row = new Uint8Array(width).fill(w[1] ^ 1);');
  const g = goldenReports(mf, 'osd', ['screen']);
  if (g) bad.push(`golden on the osd fill mutant: ${g}`);
  const before = fs.readFileSync(path.join(mf, 'golden.json'), 'utf8');
  const r = sh('node', [path.join(mf, 'bin/golden.mjs'), 'record', '--tooling-only', '--reason', 'a control', 'osd']);
  if (r.status !== 2 || !/^ {2}osd: .*\bscreen\b/m.test(r.stderr) || fs.readFileSync(path.join(mf, 'golden.json'), 'utf8') !== before || fs.existsSync(path.join(mf, 'out/golden/recorded'))) {
    bad.push(`golden record --tooling-only on the osd fill mutant: exit ${r.status}, want 2 and nothing written\n${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 2, bad };
}

export function cli3() {
  const bad = [];
  const root = path.join(J, 'out/test-cli3');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  let r = sh('node', [path.join(J, 'bin/run.mjs'), 'kernel-6', '--slice', '0']);
  if (r.status !== 2) bad.push(`run.mjs --slice 0: exit ${r.status}, want 2`);
  // --slice 3 traces what the unsliced run does (the events and the finals; env and source aside)
  const a = path.join(root, 'a'), b = path.join(root, 'b');
  r = sh('node', [path.join(J, 'bin/run.mjs'), 'kernel-6', '--trace', a]);
  const r2 = sh('node', [path.join(J, 'bin/run.mjs'), 'kernel-6', '--slice', '3', '--trace', b]);
  const body = (dir) => { try { const d = readJson(path.join(dir, 'kernel-6.json')); return createHash('sha256').update(JSON.stringify([d.events, d.final, d.counts])).digest('hex'); } catch { return null; } };
  if (r.status !== 0 || r2.status !== 0 || !body(a) || body(a) !== body(b)) bad.push(`run.mjs kernel-6 --slice 3: exit ${r.status}/${r2.status}, trace ${body(b)?.slice(0, 12)} vs unsliced ${body(a)?.slice(0, 12)}`);
  // --trace and --calls need a directory: nothing is written to ./--time
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd);
  for (const x of [['--trace', '--time'], ['--trace'], ['--trace', 'stage0'], ['--calls', '--time'], ['--calls']]) {
    r = spawnSync('node', [path.join(J, 'bin/run.mjs'), 'kernel-6', ...x], { cwd, encoding: 'utf8' });
    if (r.status !== 2 || !new RegExp(`${x[0]} DIR: a directory is required`).test(r.stderr) || fs.readdirSync(cwd).length) bad.push(`run.mjs kernel-6 ${x.join(' ')}: exit ${r.status}, want 2; files ${fs.readdirSync(cwd)}\n${r.stdout.slice(0, 200)}${r.stderr.slice(0, 200)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 7, bad };
}

export function cli4() {
  const bad = [];
  const root = path.join(J, 'out/test-cli4');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // J1 (permanent): the lab's display steps are the harness layer's
  const mj = mutant(root, 'j1', 'src/lab/display.mjs', 'unwritten: !!(info & 128)', 'unwritten: !!(info & 64)');
  const g = goldenReports(mj, 'shoot-tft', ['harness']);
  if (g) bad.push(`J1 (stub_log unwritten from bit 64): ${g}`);
  // a harness-only change passes golden record --tooling-only, which logs it; check is identical afterwards
  const rec = sh('node', [path.join(mj, 'bin/golden.mjs'), 'record', '--tooling-only', '--reason', 'a control', 'shoot-tft']);
  const last = readJson(path.join(mj, 'golden.json')).log.at(-1), again = goldenReports(mj, 'shoot-tft', []);
  if (rec.status !== 0 || last.evidence !== 'tooling' || JSON.stringify(last.changed) !== '{"harness":["shoot-tft"]}' || again) {
    bad.push(`golden record --tooling-only on J1: exit ${rec.status}, log ${JSON.stringify(last)}${again ? `; check after it: ${again}` : ''}\n${rec.stderr.slice(-300)}`);
  }
  // the osd replay binds a call's arguments strictly: an unknown keyword in a call is refused (a copy of the generated inputs in the
  // --calls directory, which run.mjs reads instead of generating them)
  const dk = path.join(root, 'osdkw');
  fs.mkdirSync(dk);
  const gen = sh('node', ['--input-type=module', '-e', `import { osdInputs } from ${JSON.stringify(path.join(J, 'checks/lib/osdcalls.mjs'))}; process.stdout.write(JSON.stringify(osdInputs()));`]);
  const calls = JSON.parse(gen.stdout);
  const w = calls.actions.find((a) => a[1] === 'sim' && a[2] === 'write');
  w[4] = { ...w[4], bogus: 1 };
  fs.writeFileSync(path.join(dk, 'osd.calls.json'), JSON.stringify(calls));
  const r = sh('node', [path.join(J, 'bin/run.mjs'), 'osd', '--calls', dk, '--trace', path.join(root, 'osdkw-js')]);
  if (r.status !== 1 || !/osd: THREW Error: replay: sim\.write\(\) got an unexpected keyword argument 'bogus'$/m.test(r.stdout)) bad.push(`osd replay, an unknown keyword: exit ${r.status}\n${r.stdout.slice(0, 600)}`);
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 3, bad };
}

export function cli5() {
  const bad = [];
  const root = path.join(J, 'out/test-cli5');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const copy = (name, edit) => {
    const d = path.join(root, `calls-${name}`);
    fs.mkdirSync(d);
    const calls = readJson(path.join(J, 'scenarios/calls/a15-open.calls.json'));
    edit(calls);
    fs.writeFileSync(path.join(d, 'a15-open.calls.json'), JSON.stringify(calls));
    return d;
  };
  // the labs of the session
  const d2 = copy('labs', (c) => { c.labs = []; });
  let r = sh('node', [path.join(J, 'bin/run.mjs'), 'a15-open', '--calls', d2, '--trace', path.join(root, 'labs-js')]);
  if (r.status !== 1 || !/^a15-open: DIVERGES \(replay\) a15-open: labs \["a15-open"\], the inputs list \[\]$/m.test(r.stdout)) bad.push(`inputs whose labs differ: exit ${r.status}\n${r.stdout.slice(0, 600)}`);
  const js3 = path.join(root, 'js3');
  r = sh('node', [path.join(J, 'bin/run.mjs'), 'power', '--trace', js3]);
  const files = ['power', 'power#2', 'power#3'].filter((n) => fs.existsSync(path.join(js3, `${n}.json`)));
  if (r.status !== 0 || files.length !== 3) bad.push(`run.mjs power --trace: exit ${r.status}, traces ${JSON.stringify(files)}\n${r.stdout.slice(0, 400)}`);
  // playperf.mjs refuses a bad --slice (and --dump / unknown arguments) with exit 2, as run.mjs does, rather than
  // running unsliced (each refusal comes before the image is read)
  for (const a of [['--slice', 'abc'], ['--slice', '0'], ['--slice', '-5'], ['--slice', '1.5'], ['--slice'], ['--dump'], ['--bogus']]) {
    r = sh('node', [path.join(J, 'bin/playperf.mjs'), ...a]);
    if (r.status !== 2 || r.stdout !== '' || !/^playperf\.mjs: /.test(r.stderr)) bad.push(`playperf.mjs ${a.join(' ')}: exit ${r.status}, want 2 and nothing run\n${r.stdout.slice(0, 200)}${r.stderr.slice(0, 200)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 9, bad };
}

export function cli6() {
  const bad = [];
  const root = path.join(J, 'out/test-cli6');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // Each harness-side change golden must report.
  const controls = [
    ['j7', 'switch-scp', 'index: w0, bit: bit0 };', 'index: w0 + 1, bit: bit0 };', ['output']],
    ['j8', 'inputs', 'dial: { slot, word: h8(word), count: 1 }', 'dial: { slot, word: h8(word + 1), count: 1 }', ['output']],
    ['j7b', 'switch-scp', 'lab.ipi_handler_runs += 1;', 'lab.ipi_handler_runs += 2;', ['output']],
  ];
  for (const [id, scenario, oldText, newText, layers] of controls) {
    const m = mutant(root, id, 'src/lab/play.mjs', oldText, newText);
    const g = goldenReports(m, scenario, layers);
    if (g) bad.push(`${id.toUpperCase()} (${newText}): ${g}`);
  }
  // NC-FMT: an inputs file in an earlier recorded-calls format is refused before action 1
  const d = path.join(root, 'fmt1');
  fs.mkdirSync(d);
  const calls = readJson(path.join(J, 'scenarios/calls/a15-open.calls.json'));
  calls.format = 'om1-stage2-calls/2';
  fs.writeFileSync(path.join(d, 'a15-open.calls.json'), JSON.stringify(calls));
  const r = sh('node', [path.join(J, 'bin/run.mjs'), 'a15-open', '--calls', d, '--trace', path.join(root, 'fmt1-js')]);
  const div = path.join(root, 'fmt1-js/a15-open.divergence.json'), dd = fs.existsSync(div) ? readJson(div) : null;
  // refused before the Player ctor: no lab session was created
  if (r.status !== 1 || !/^a15-open: THREW Error: calls file format om1-stage2-calls\/2, want om-emu-session-inputs\/1 or om-emu-player-inputs\/1$/m.test(r.stdout) || !dd || dd.session !== null) {
    bad.push(`NC-FMT (a recorded calls file): exit ${r.status}, divergence session ${JSON.stringify(dd?.session)}\n${r.stdout.slice(0, 600)}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { checks: 4, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [cli(), cli2(), cli3(), cli4(), cli5(), cli6()];
  console.log(rs.map((r, i) => `cli${i ? i + 1 : ''} ${r.checks - r.bad.length}/${r.checks}`).join('; '));
  rs.flatMap((r) => r.bad).forEach((x) => console.log('  ', x));
  process.exit(rs.some((r) => r.bad.length) ? 1 : 0);
}
