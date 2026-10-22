// The check runner's controls and the checks' permanent negative controls.
//   NC-RC    a run whose declared rc is not the check's: bin/checks.mjs reports FAIL <run> rc N, want M, exit 1
//   NC-FILE  a declared output file the check never writes: FAIL <run>: declared file ... not written, exit 1
//   NC-ENV   a run env naming a variable outside the whitelist: refused, exit 2
//   NC-LEAK  a run variable inherited from the caller: the child env refuses it, exit 2
//   Each control below plants one edit in a copy of emu and requires bin/golden.mjs check to report the named
//   sessions DIFFERENT (the output layer of a run/<id>: its rc, stdout, stderr and declared files):
//   NC-RUN1  check_kernel's last line with one changed character: run/kernel
//   NC-USAGE the usage line dropped from a usage error: run/irq-usage
//   NC-IMG1  img_row's + 2048 -> + 2047 (src/dev/vsccompose.mjs): run/display (its composites)
//   Unit and check controls:
//   NC-VSC   gen_vsc_regs --header with one offset changed: rc 1 and the message
//   HELP     --help is an unknown option: exit 2, the message and the usage line (there is no help text)
//   SHOW     check_isa --show N prints the first N failures (a negative N: all but the last |N|)
//   NC-P1    the interpreter's inline SUB Am,An (F1 3x) removed: check_perf P1's guard (mutant 1)
//            changes another number of the 392 cmp/sub/asl2 cases than 22
//   NOTES    (D11) check_display, check_liveview, check_text, check_menu and check_nav --write-notes with
//            OM_NOTES_DIR: the notes files are byte-identical to the pinned emu/checks/fixtures/check_*_notes.txt
//   FAULT    (D17) per check one JS-only fault point (OM_FAULT) that trips a predicate (exit 1), and the tautology
//            at that site (OM_PRED_MUT) that turns it into a pass (exit 0)
//   OSD-IN   the osd scenario's inputs generated from check_osd (checks/lib/osdcalls.mjs): consecutive actions, every
//            call one the replay has an adapter for, its keywords bound as the replay binds them.
// Needs emu/golden.json. Writes under emu/out/test-checks/ and removes it.
//   node emu/test/test_checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const J = path.join(REPO, 'emu');
const sh = (cmd, args, cwd = REPO) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// A copy of emu (without out/) under root/<name> with source replacements [[file, old, new], ...].
function mutant(root, name, edits) {
  const d = path.join(root, name);
  fs.mkdirSync(path.join(d, 'emu/out/checks'), { recursive: true });
  for (const x of ['bin', 'src', 'scenarios', 'test', 'refs', 'checks', 'host', 'web', 'package.json', 'golden.json']) fs.cpSync(path.join(J, x), path.join(d, 'emu', x), { recursive: true });
  for (const x of ['unpacked', 'artifacts']) fs.symlinkSync(path.join(REPO, x), path.join(d, x));
  for (const [file, oldText, newText] of edits) {
    const f = path.join(d, 'emu', file), t = fs.readFileSync(f, 'utf8');
    if (t.split(oldText).length !== 2) throw new Error(`mutant ${name}: ${file} does not hold the text once`);
    fs.writeFileSync(f, t.replace(oldText, newText));
  }
  return d;
}
const runner = (d, ...a) => sh('node', [path.join(d, 'emu/bin/checks.mjs'), ...a], d);
// bin/golden.mjs check of the sessions in copy d: null when it reports each of them DIFFERENT (exit 1), else what it did
function goldenCatches(d, sessions, env = process.env) {
  const r = spawnSync('node', [path.join(d, 'emu/bin/golden.mjs'), 'check', ...sessions], { cwd: d, encoding: 'utf8', env, maxBuffer: 1 << 28 });
  const missed = sessions.filter((s) => !new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: DIFFERENT`, 'm').test(r.stdout));
  return r.status === 1 && !missed.length ? null : `golden exit ${r.status}, not DIFFERENT: ${missed.join(', ')}\n${r.stdout.slice(-400)}${r.stderr.slice(-300)}`;
}

export async function checksTests() {
  const bad = [];
  const root = path.join(J, 'out/test-checks');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // NC-RUN1: one changed character in check_kernel's last line
  let d = mutant(root, 'run1', [['checks/check_kernel.mjs', "line.slice(0, -7)} (", "line.slice(0, -7).replace('passed', 'passeD')} ("]]);
  let r = { status: 0 }, why = goldenCatches(d, ['run/kernel']);
  if (why) bad.push(`NC-RUN1: ${why}`);
  // NC-RC: a run declaring another rc than the check's
  const runs = JSON.parse(fs.readFileSync(path.join(J, 'checks/runs.json'), 'utf8'));
  const withRuns = (name, edit) => {
    const doc = structuredClone(runs);
    edit(doc);
    const dd = mutant(root, name, []);
    fs.writeFileSync(path.join(dd, 'emu/checks/runs.json'), JSON.stringify(doc));
    return dd;
  };
  d = withRuns('rc', (doc) => { doc.checks.check_kernel.runs.find((x) => x.id === 'kernel').rc = 1; });
  r = runner(d, 'kernel');
  if (r.status !== 1 || !/^FAIL kernel \(check_kernel, [\d.]+ s\): rc 0, want 1$/m.test(r.stdout)) bad.push(`NC-RC: exit ${r.status}\n${r.stdout.slice(0, 400)}${r.stderr.slice(0, 300)}`);
  // NC-VSC
  const header = path.join(root, 'om1-vsc-regs.h');
  fs.writeFileSync(header, fs.readFileSync(path.join(J, 'checks/fixtures/om1-vsc-regs.h'), 'utf8').replace('{ 0x004,', '{ 0x008,'));
  r = sh('node', [path.join(J, 'checks/gen_vsc_regs.mjs'), '--check', '--header', header]);
  const image = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');
  if (r.status !== 1 || r.stdout !== '' || r.stderr !== `${header} differs from the tables in ${image}\n`) bad.push(`NC-VSC: exit ${r.status}\n${r.stdout}${r.stderr}`);
  // check_isa --show N prints the first N failures, a negative N all but the last |N| (vectors with three cases and
  // one firmware value changed)
  const vec = JSON.parse(fs.readFileSync(path.join(J, 'test/fixtures/isa_vectors.json'), 'utf8'));
  for (const i of [1, 10, 101]) vec.cases[i].out.regs.pc = (vec.cases[i].out.regs.pc ?? 0) + 1;
  vec.firmware[3].result = '0x0';
  const vf = path.join(root, 'isa_vectors.mut.json');
  fs.writeFileSync(vf, JSON.stringify(vec));
  for (const [n, cases, fws] of [['-1', 2, 0], ['-3', 0, 0], ['2', 2, 1], ['0', 0, 0]]) {
    r = sh('node', [path.join(J, 'checks/check_isa.mjs'), '--vectors', vf, '--show', n]);
    const got = [(r.stdout.match(/^ {2}FAIL #/gm) ?? []).length, (r.stdout.match(/^ {2}FAIL (?!#)/gm) ?? []).length];
    if (r.status !== 1 || got[0] !== cases || got[1] !== fws) bad.push(`check_isa --show ${n}: exit ${r.status}, ${got[0]} case and ${got[1]} firmware FAIL lines, want ${cases} and ${fws}`);
  }
  // NC-USAGE: the usage line dropped from a usage error
  d = mutant(root, 'usage', [['checks/lib/env.mjs', "${e.usage ? `${e.usage}\\n` : ''}", '']]);
  why = goldenCatches(d, ['run/irq-usage']);
  if (why) bad.push(`NC-USAGE: ${why}`);
  // HELP: --help is an unknown option, exit 2 with the usage line
  r = sh('node', [path.join(J, 'checks/gen_vsc_regs.mjs'), '--help']);
  if (r.status !== 2 || r.stderr !== 'gen_vsc_regs.mjs: unknown option --help\nusage: gen_vsc_regs.mjs [--image IMAGE] [--check] [--header HEADER]\n') bad.push(`--help: exit ${r.status}: ${r.stderr}`);
  // NC-P1: P1's guard on a copy without the inline F1 3x form
  const guard = (dd) => {
    const code = `const P = await import(${JSON.stringify(path.join(dd, 'emu/checks/check_perf.mjs'))});
      const cases = P.p1Cases().filter((c) => P.continuePlan(c)[0] && /^(cmp|sub|asl2)/.test(c.form));
      console.log(P.p1({ mutant: 1 }, cases)[0].length + ' of ' + cases.length);`;
    const g = spawnSync('node', ['--input-type=module', '-e', code], { cwd: dd, encoding: 'utf8' });
    return g.status === 0 ? g.stdout.trim() : `exit ${g.status}: ${g.stderr.slice(-300)}`;
  };
  d = mutant(root, 'p1', [['src/core/interp.mjs', '      case 0x30: k = K.SUB_AA; break; case 0x50: k = K.ADD_DA; break;', '      case 0x50: k = K.ADD_DA; break;']]);
  const [gReal, gMut] = [guard(path.join(root, '..', '..', '..')), guard(d)];
  if (gReal !== '22 of 392' || !/^\d+ of 392$/.test(gMut) || gMut === '22 of 392') bad.push(`NC-P1: the guard changes ${gReal} on the tree (want 22 of 392) and ${gMut} without F1 3x (want another count)`);
  // ---- check_display, check_liveview, check_text ----
  // NOTES (D11): --write-notes into OM_NOTES_DIR, byte-identical to the pinned fixtures
  const notesDir = path.join(root, 'notes');
  fs.mkdirSync(notesDir);
  for (const c of ['display', 'liveview', 'text']) {
    r = spawnSync('node', [path.join(J, `checks/check_${c}.mjs`), '--write-notes'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, OM_NOTES_DIR: notesDir }, maxBuffer: 1 << 28 });
    const got = path.join(notesDir, `check_${c}_notes.txt`), want = path.join(J, `checks/fixtures/check_${c}_notes.txt`);
    if (r.status !== 0 || !fs.existsSync(got) || !fs.readFileSync(got).equals(fs.readFileSync(want))) bad.push(`NOTES check_${c}: exit ${r.status}, ${fs.existsSync(got) ? 'notes differ from' : 'no notes written for'} ${want}\n${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  }
  // without OM_NOTES_DIR --write-notes is refused (it has nowhere to write the notes)
  r = sh('node', [path.join(J, 'checks/check_text.mjs'), '--write-notes']);
  if (r.status !== 2 || !r.stderr.includes('--write-notes: needs OM_NOTES_DIR')) bad.push(`NOTES refusal: exit ${r.status}: ${r.stderr.slice(0, 300)}`);
  // NC-ENV: a run env outside the whitelist
  d = withRuns('env1', (doc) => { doc.checks.check_kernel.runs.find((x) => x.id === 'kernel').env = { OM_SNEAKY: '1' }; });
  r = runner(d, 'kernel');
  if (r.status !== 2 || !r.stderr.includes('run kernel sets OM_SNEAKY: not in the run env whitelist')) bad.push(`NC-ENV: exit ${r.status}\n${r.stdout.slice(0, 300)}${r.stderr.slice(0, 300)}`);
  // NC-LEAK: a run variable or a gate's variable inherited from the caller's environment is
  // refused by the child env (refenv.mjs childEnv), exit 2
  r = spawnSync('node', [path.join(J, 'bin/checks.mjs'), 'kernel'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, OM_NAV_MUTANT: 'x' } });
  if (r.status !== 2 || !r.stderr.includes('refenv: the environment sets OM_NAV_MUTANT')) bad.push(`NC-LEAK (node): exit ${r.status}: ${r.stderr.slice(0, 300)}`);
  // NC-FILE: a declared file the check never writes
  d = withRuns('file1', (doc) => { doc.checks.check_liveview.runs.find((x) => x.id === 'liveview-g3s4').files = ['{out}/planted.json']; });
  r = runner(d, 'liveview-g3s4');
  if (r.status !== 1 || !/^FAIL liveview-g3s4 .*declared file .*planted\.json not written$/m.test(r.stdout)) bad.push(`NC-FILE: exit ${r.status}\n${r.stdout.slice(0, 400)}${r.stderr.slice(0, 300)}`);
  // NC-IMG1: IMG's rounding off by one
  d = mutant(root, 'img1', [['src/dev/vsccompose.mjs', 'const value = f ? Math.floor((a * (4096 - f) + ycComp(b, s + 1, comp) * f + 2048) / 4096) : a;',
    'const value = f ? Math.floor((a * (4096 - f) + ycComp(b, s + 1, comp) * f + 2047) / 4096) : a;']]);
  why = goldenCatches(d, ['run/display']);
  if (why) bad.push(`NC-IMG1: ${why}`);
  // FAULT: one fault point per check, then the tautology mutant at the predicate it trips
  for (const [c, name, text] of [['check_display', 'display-stub-preset', 'check(cpu(lab, LOAD, 0x9A900474).d0 === 0x15);'],
    ['check_liveview', 'liveview-winreg', 'check(CD.cpu(lab, LOAD, 0x98100058).d0 === 0x17161514);'],
    ['check_text', 'text-getstring', 'const bad = ids.filter((sid) => !pred(lab1.get_string(sid)[1] === tables.get(lang).text(sid)));']]) {
    const src = path.join(J, `checks/${c}.mjs`), lines = fs.readFileSync(src, 'utf8').split('\n');
    const at = lines.findIndex((x) => x.includes(text));
    if (at < 0 || lines.findIndex((x, i) => i > at && x.includes(text)) >= 0) { bad.push(`FAULT ${c}: the predicate text is not in ${src} once`); continue; }
    const run = (extra) => spawnSync('node', [src], { cwd: REPO, encoding: 'utf8', env: { ...process.env, OM_FAULT: name, ...extra }, maxBuffer: 1 << 28 });
    const f = run({}), t = run({ OM_PRED_MUT: `${c}.mjs:${at + 1}` });
    if (f.status !== 1) bad.push(`FAULT ${c} (${name}): exit ${f.status}, want 1 (the fault point trips nothing)`);
    if (t.status !== 0) bad.push(`FAULT ${c} (${name}) with the tautology at ${c}.mjs:${at + 1}: exit ${t.status}, want 0\n${t.stdout.slice(-300)}${t.stderr.slice(-300)}`);
  }
  // ---- check_menu, check_nav ----
  // NOTES (D11) for check_menu and check_nav: --write-notes into OM_NOTES_DIR, byte-identical to the pinned fixtures
  for (const c of ['menu', 'nav']) {
    r = spawnSync('node', [path.join(J, `checks/check_${c}.mjs`), '--write-notes'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, OM_NOTES_DIR: notesDir }, maxBuffer: 1 << 28 });
    const got = path.join(notesDir, `check_${c}_notes.txt`), want = path.join(J, `checks/fixtures/check_${c}_notes.txt`);
    if (r.status !== 0 || !fs.existsSync(got) || !fs.readFileSync(got).equals(fs.readFileSync(want))) bad.push(`NOTES check_${c}: exit ${r.status}, ${fs.existsSync(got) ? 'notes differ from' : 'no notes written for'} ${want}\n${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  }
  // FAULT (check_menu, check_nav, check_irq, check_osd): the fault point trips its predicate (exit 1), the tautology there passes (0)
  for (const [c, name, text, args] of [['check_menu', 'menu-gui-state', 'if (!pred(r.state === MM.STATE_MENU)) p2.push(', ['--quick']],
    ['check_nav', 'nav-scpu-command', "if (!pred(count(err, 'scpu UNKNOWN') === 6", ['--quick']],
    ['check_irq', 'ipi-80c-clear-all', "g.eq('+0x80c clears the written bits'", ['--only', 'I10']],
    ['check_osd', 'osd-debug-write', "check(deepEqual(lab.engine.errors().map((e) => e.name), ['DEBUG_CPU_WRITE'])", []]]) {
    const src = path.join(J, `checks/${c}.mjs`), lines = fs.readFileSync(src, 'utf8').split('\n');
    const at = lines.findIndex((x) => x.includes(text));
    if (at < 0 || lines.findIndex((x, i) => i > at && x.includes(text)) >= 0) { bad.push(`FAULT ${c}: the predicate text is not in ${src} once`); continue; }
    const run = (extra) => spawnSync('node', [src, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, OM_FAULT: name, ...extra }, maxBuffer: 1 << 28 });
    const f = run({}), t = run({ OM_PRED_MUT: `${c}.mjs:${at + 1}` });
    if (f.status !== 1) bad.push(`FAULT ${c} (${name}): exit ${f.status}, want 1 (the fault point trips nothing)`);
    if (t.status !== 0) bad.push(`FAULT ${c} (${name}) with the tautology at ${c}.mjs:${at + 1}: exit ${t.status}, want 0\n${t.stdout.slice(-300)}${t.stderr.slice(-300)}`);
  }
  // OSD-IN
  const oi = await osdInputsBind();
  if (oi) bad.push(`OSD-IN: ${oi}`);
  try {
    bad.push(...await fixRound1(root));
    bad.push(...await fixRound2(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return { checks: 11 + 15 + 10 + FIX1_CHECKS + FIX2_CHECKS + 1, bad };
}

// ---- fixRound1: regression checks for the first set of fixes to the menu and nav port ------------------------------
//   ERRORS    every error class the lab, the references and the checks define is named by its class (e.name), and
//             isValueError takes a ValueError of either tree and its subclasses (SettingsError, NavRefusal,
//             UnicodeDecodeError: yes; KeyError, a JS error, a FirmwareError: no); describe() is 'Name: message' (the
//             name alone for an empty message) and the notes
//   NC-SERR   check_nav compare_capture with a store whose get raises SettingsError: a problem line ('the
//             reference cannot model page 1 cursor 1: ...'), caught as a ValueError, not a crash
//   NULL      a register VscDebug.bank reports as null in arithmetic is an AssertionError naming it: check_palettes on a
//             fresh DisplayLab (OSDCP2 never latched), regValue; regValue(undefined) is a bug (a plain Error)
//   MASK      mask_window of a rect starting right of the window's last column raises ValueError('negative count');
//             a zero-width rect changes nothing
//   CLEANUP   timeout_cleanup: without a fault no problem; with the JS-only fault menu-cleanup-survivor (a grandchild in
//             its own session naming the child's TMPDIR) 'processes left' for both kills (before the fix the child's argv
//             named the literal 'TMPDIR', so leftover() could not find any survivor)
const FIX1_CHECKS = 9;
export async function fixRound1(root) {
  const bad = [];
  let r;
  const { isValueError, describe, regValue } = await import('../checks/lib/errors.mjs');
  // ERRORS
  const S = await import('../refs/settings.mjs'), MR = await import('../refs/menuref.mjs'), RE = await import('../refs/errors.mjs'), E = await import('../src/lab/errors.mjs');
  {
    const mods = await Promise.all(['../src/lab/errors.mjs', '../src/lab/menu.mjs', '../src/lab/nav.mjs', '../src/lab/play.mjs', '../refs/errors.mjs', '../refs/settings.mjs', '../refs/menuref.mjs', '../checks/lib/playhttp.mjs'].map((m) => import(m)));
    const classes = [...new Set(mods.flatMap((m) => Object.values(m)))].filter((C) => typeof C === 'function' && (C.prototype instanceof E.LabError || C.prototype instanceof RE.RefError));
    const misnamed = classes.filter((C) => Object.create(C.prototype).name !== C.name).map((C) => C.name);
    if (classes.length < 18 || misnamed.length) bad.push(`ERRORS: ${classes.length} classes, named otherwise: ${misnamed.join(', ')}`);
  }
  const yes = [new S.SettingsError('x'), new MR.NavRefusal('x'), new E.UnicodeDecodeError('x'), new RE.ValueError('x'), new E.ValueError('x')];
  const no = [new E.KeyError('x'), new RE.KeyError('x'), new TypeError('x'), new E.FirmwareError('x')];
  if (!yes.every(isValueError) || no.some(isValueError)) bad.push(`ERRORS: isValueError ${yes.map(isValueError)} / ${no.map(isValueError)}`);
  const noted = new E.EngineError('m');
  noted.addNote('n1');
  if (describe(new E.AssertionError('')) !== 'AssertionError' || describe(noted) !== 'EngineError: m\nn1') bad.push(`ERRORS: describe ${JSON.stringify(describe(new E.AssertionError('')))} / ${JSON.stringify(describe(noted))}`);
  // NC-SERR
  const CN = await import('../checks/check_nav.mjs'), MM = await import('../src/lab/menu.mjs');
  const refs = await CN.Refs.load(), problems = [], notes = [];
  const store = { get(sid) { throw new S.SettingsError(`${sid}: no default table entry and no region override`); } };
  const recd = { token: 'DOWN', n: 1, capture: { comp: 'NONE', vsc: [], windows: new Map() }, state: { screen: 'page', menu: { tab_id: MM.SETUP_TAB, page: 1, cursor_row: 0 } } };
  try {
    CN.compare_capture({ name: 'T', lang: 'en' }, recd, refs, store, problems, notes);
    if (problems.length !== 1 || !/^T DOWN: the reference cannot model page 1 cursor 1: \d+: no default table entry/.test(problems[0])) bad.push(`NC-SERR: problems ${JSON.stringify(problems).slice(0, 300)}`);
  } catch (e) { bad.push(`NC-SERR: compare_capture threw ${e?.name}: ${e?.message}`); }
  // NULL
  const { labEnv } = await import('../checks/lib/env.mjs');
  const D = await import('../src/lab/display.mjs'), CD = await import('../checks/check_display.mjs');
  const lab = new D.DisplayLab(labEnv());
  let got;
  try { got = `returned ${CD.check_palettes(lab, 'tft', [86, 87, 85])}`; } catch (e) { got = `${e?.name}: ${e?.message}`; } finally { lab.close(); }
  if (got !== 'AssertionError: OSDCP2 is not latched') bad.push(`NULL check_palettes on a fresh lab: ${got}`);
  const raised = (f) => { try { f(); return 'no error'; } catch (e) { return `${e?.name}: ${e?.message}`; } };
  for (const [f, want] of [[() => regValue(null, 'CTRL3'), 'AssertionError: CTRL3 is not latched'], [() => regValue(undefined), 'Error: regValue: undefined (a name the bank does not list)']]) {
    const g = raised(f);
    if (g !== want) bad.push(`NULL: ${f}: ${g}, want ${want}`);
  }
  if (regValue(0) !== 0) bad.push('NULL: regValue(0) is not 0');
  // MASK
  const CM = await import('../checks/check_menu.mjs');
  got = raised(() => CM.mask_window(new Uint8Array(900 * 600).fill(7), [[901, 0, 950, 0]]));
  if (got !== 'ValueError: negative count') bad.push(`MASK: a rect right of the last column: ${got}`);
  const w0 = CM.mask_window(new Uint8Array(900 * 600).fill(7), [[900, 0, 950, 3]]);
  if (w0.some((x) => x !== 7)) bad.push('MASK: a zero-width rect changed the window');
  // CLEANUP (a node child: the fault point is read at module load)
  const cleanup = (extra) => spawnSync('node', ['--input-type=module', '-e', `const CM = await import(${JSON.stringify(path.join(J, 'checks/check_menu.mjs'))}); console.log(JSON.stringify(await CM.timeout_cleanup(5)));`],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...extra }, maxBuffer: 1 << 24 });
  r = cleanup({});
  if (r.status !== 0 || r.stdout.trim() !== '[]') bad.push(`CLEANUP without a fault: exit ${r.status} ${r.stdout.slice(0, 300)}${r.stderr.slice(-300)}`);
  r = cleanup({ OM_FAULT: 'menu-cleanup-survivor' });
  let left = null;
  try { left = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* reported below */ }
  if (r.status !== 0 || !Array.isArray(left) || left.length !== 2 || !/^group_kill=true: processes left \[\d+\]$/.test(left[0]) || !/^group_kill=false: processes left \[\d+\]$/.test(left[1])) {
    bad.push(`CLEANUP with menu-cleanup-survivor: exit ${r.status} ${r.stdout.slice(0, 300)}${r.stderr.slice(-300)}`);
  }
  return bad;
}

// ---- fixRound2: regression checks for the second set of fixes to the menu and nav port -----------------------------
//   LUT        src/lab/menudata.mjs lut and refs/menuref.mjs lut_bytes of colour map 327 (a garbage count 0xffffffff):
//              the ValueError of the first byte outside the image, in a node child limited to 512 MB (before the fix it
//              allocated the whole count and died out of memory)
//   CHECK-OUT  checktrace.mjs gives the check its own OM_CHECK_OUT (an inherited one that cannot be created does not
//              reach it), removes it on exit and, first, the directories of checktrace processes that no longer exist
const FIX2_CHECKS = 2;
export async function fixRound2(root) {
  const bad = [];
  // LUT (a node child: before the fix the garbage count was allocated first, a V8 fatal out-of-memory)
  const lutJs = spawnSync('node', ['--max-old-space-size=512', '--input-type=module', '-e', `
    const { loadImage, loadBlock } = await import(${JSON.stringify(path.join(J, 'checks/lib/env.mjs'))});
    const M = await import(${JSON.stringify(path.join(J, 'src/lab/menudata.mjs'))}), R = await import(${JSON.stringify(path.join(J, 'src/lab/resources.mjs'))});
    const MR = await import(${JSON.stringify(path.join(J, 'refs/menuref.mjs'))});
    const o = (f) => { try { return ['ret', f()]; } catch (e) { return ['raise', e.name, e.message]; } };
    const ref = new MR.Reference({ lang: 'en', layout: 1, image: loadImage(), block: loadBlock(), M, R });
    console.log(JSON.stringify([o(() => M.lut(new M.Image(loadImage()), 327)), o(() => ref.lut_bytes(327, 0, { kind: 0, word20: 0 }))]));`], { encoding: 'utf8', timeout: 120_000 });
  let lj = null;
  try { lj = JSON.parse(lutJs.stdout); } catch { /* reported below */ }
  if (!lj || !lj.every((x) => x[0] === 'raise' && x[1] === 'ValueError' && / outside the image$/.test(x[2]))) bad.push(`LUT colour map 327: ${lj ? JSON.stringify(lj) : `exit ${lutJs.status} ${lutJs.signal ?? ''} ${lutJs.stderr.slice(-200)}`}, want a ValueError for each`);
  // CHECK-OUT: an inherited OM_CHECK_OUT under a regular file (mkdir fails) must not reach the check; TMPDIR is the
  // test's own, holding an orphan of a dead checktrace pid
  const tmpd = path.join(root, 'fix2-tmp'), blocker = path.join(root, 'fix2-file');
  fs.mkdirSync(path.join(tmpd, 'om-emu-checktrace-999999999-orphan'), { recursive: true });
  fs.writeFileSync(blocker, '');
  const r = spawnSync('node', [path.join(J, 'bin/checktrace.mjs'), 'display-knone', '--trace', path.join(root, 'fix2-js')], { cwd: REPO, encoding: 'utf8', env: { ...process.env, TMPDIR: tmpd, OM_CHECK_OUT: path.join(blocker, 'out') }, maxBuffer: 1 << 26 });
  if (r.status !== 0 || !/^display-knone: rc 0,/.test(r.stdout)) bad.push(`CHECK-OUT display-knone with an unusable inherited OM_CHECK_OUT: exit ${r.status}\n${r.stdout.slice(0, 300)}${r.stderr.slice(-300)}`);
  const leftTmp = fs.readdirSync(tmpd);
  if (leftTmp.length) bad.push(`CHECK-OUT: ${tmpd} holds ${leftTmp.join(' ')} after the run (its own directory or the orphan)`);
  return bad;
}

// ---- the osd inputs (checks/lib/osdcalls.mjs): generated from check_osd, each call one the replay binds ---------------
async function osdInputsBind() {
  const { osdInputs } = await import('../checks/lib/osdcalls.mjs');
  const { OSD_CALLS, OSD_INPUTS_FORMAT } = await import('../scenarios/osd_replay.mjs');
  const { bind } = await import('../scenarios/bind.mjs');
  const doc = osdInputs();
  if (doc.format !== OSD_INPUTS_FORMAT) return `format ${doc.format}`;
  for (const [i, [seq, target, method, args, kwargs]] of doc.actions.entries()) {
    if (seq !== i || args.length) return `action ${i}: seq ${seq}, ${args.length} positional arguments`;
    if (target === 'mark' || target === 'ctor' || method === 'log.clear' || method.startsWith('drawing.')) continue;
    const name = `${target}.${method}`, sig = OSD_CALLS[name];
    if (!sig) return `action ${i}: ${name} has no adapter`;
    try { bind(name, sig.params, [], kwargs, { defaults: sig.defaults, varkw: sig.varkw }); } catch (e) { return `action ${i}: ${e.message}`; }
  }
  return doc.actions.length > 1000 ? null : `only ${doc.actions.length} actions`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await checksTests();
  console.log(`check runner and check controls: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
