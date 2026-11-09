// S-NVRAM, the camera's non-volatile state kept between sessions (src/lab/menu.mjs, src/lab/nvramdoc.mjs,
// host/nvram.mjs):
//   nvramUnits     (pure) bin/play.mjs's choice (host/nvram.mjs nvramChoice: on by default in the model's own file,
//                  --nvram over OM_EMU_NVRAM, off, a file; refused where it cannot apply); the document's saves and
//                  its model check; the Player's record (recordNvram: the start, each session's clock, a document
//                  only where another writer changed it) and its replay in memory (replayNvram)
//   nvramSessions  in the lab: on a fresh file the first session starts on the shooting screen where a session without
//                  it shows the date prompt (at the start's frame); the blank store's saves of E and M reach the file;
//                  a setting changed in the session and saved as the menu closes (the native menu-close save, posted
//                  to the flash task) is back in the next session, whose registry bootstrap restores M and E; the
//                  Player records what each session started from
//   nvramHost      bin/play.mjs (HOME a fresh directory): by default the state is kept in ~/.om-emu/nvram-E143.json
//                  and the startup line names it; the second session restores M and E and the first one's settings
//                  (the STORE digest); --replay of the first session's session.json, and of its session.jsonl,
//                  repeats it frame for frame from the recorded state without touching the file, and without the
//                  record it does not (negative control); --nvram off and OM_EMU_NVRAM=off give a blank camera and
//                  leave the file; OM_EMU_NVRAM=FILE keeps it there; E146 keeps its own file, refuses E143's, and
//                  E143's stays as it was; E144, whose build lacks S-NVRAM's sites, runs blank by default and refuses
//                  --nvram on
//   node emu/test/test_nvram.mjs [units|lab|host]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const J = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.dirname(J);
const SID = 571, VALUE = 3200;                  // the front upper button's function (default 84) -> off

export async function nvramUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { nvramChoice, nvramDefault } = await import('../host/nvram.mjs');
  const D = await import('../src/lab/nvramdoc.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const C = (o) => nvramChoice({ arg: null, env: null, model: 'E143', ...o });
  const dflt = nvramDefault('E143');
  ok(/\/\.om-emu\/nvram-E143\.json$/.test(dflt) && nvramDefault('E146') !== dflt, `the default files: ${dflt}, ${nvramDefault('E146')}`);
  let c = C({});
  ok(c.file === dflt && !c.explicit && !c.custom && c.line.includes(dflt), `the default: ${JSON.stringify(c)}`);
  c = C({ arg: 'off', env: '/x.json' });
  ok(c.file === null && c.line.includes('--nvram off'), `--nvram off over OM_EMU_NVRAM: ${JSON.stringify(c)}`);
  c = C({ env: 'off' });
  ok(c.file === null && c.line.includes('OM_EMU_NVRAM off'), `OM_EMU_NVRAM=off: ${JSON.stringify(c)}`);
  c = C({ env: 'rel/n.json' });
  ok(c.file === path.resolve('rel/n.json') && c.explicit && c.custom && c.source === 'OM_EMU_NVRAM', `OM_EMU_NVRAM=FILE: ${JSON.stringify(c)}`);
  c = C({ arg: 'on', env: '/x.json' });
  ok(c.file === dflt && c.explicit && !c.custom, `--nvram on over OM_EMU_NVRAM: ${JSON.stringify(c)}`);
  c = C({ unsupported: 'no sites' });
  ok(c.file === null && /not kept on E143: no sites/.test(c.line), `an unsupported body, by default: ${JSON.stringify(c)}`);
  ok(/^--nvram on: no sites/.test(C({ arg: 'on', unsupported: 'no sites' }).refuse ?? ''), 'an unsupported body, asked for: refused');
  ok(C({ scpuNative: true }).file === null && /OM_EMU_SCPU=native/.test(C({ env: '/x', scpuNative: true }).refuse ?? ''), 'OM_EMU_SCPU=native: off by default, refused when asked for');
  ok(/--replay/.test(C({ arg: 'off', replay: true }).refuse ?? '') && C({ env: '/x', replay: true }).envIgnored && C({ replay: true }).file === null, '--replay: --nvram refused, OM_EMU_NVRAM ignored');
  ok(/on, off or a file/.test(C({ arg: '' }).refuse ?? ''), '--nvram with an empty value refused');
  // the document: saves stamp the model; another model's is refused; a store that is not base64 is refused
  const M = Uint8Array.from({ length: 30 }, (_, i) => i);
  let j = D.nvramSave(null, 'M', M);
  ok(j.model === MODEL && j.version === 1 && D.nvramDecode(j, 'x').M.join() === M.join(), `a new document: ${JSON.stringify(j)}`);
  const throwsLike = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
  ok(throwsLike(() => D.nvramDecode({ ...j, model: 'E999' }, 'x'), /the state of a E999/), 'a document of another model refused');
  ok(throwsLike(() => D.nvramDecode({ M: 'abc' }, 'x'), /store M is not base64/), 'a store that is not base64 refused');
  ok(D.nvramDecode({ M: j.M }, 'x').M.length === 30, 'a document without a model (older files) is taken');
  // the record: a fake host whose document another writer changes between two sessions
  let hostDoc = null, t = 1000;
  const host = { file: 'f', doc: () => hostDoc, load: () => D.nvramDecode(hostDoc, 'f'), save: (n, d) => { hostDoc = D.nvramSave(hostDoc, n, d); },
    saveScpu: (w) => { hostDoc = D.nvramSaveScpu(hostDoc, w); }, saveScpuMemory: (m) => { hostDoc = D.nvramSaveScpuMemory(hostDoc, m); }, now: () => t++ };
  const seen = [];
  const { nvram: rn, record } = D.recordNvram(host, (r) => seen.push(r.sessions.length));
  const run = (nv) => {
    const out = [];
    out.push(JSON.stringify(nv.load()), nv.now());
    nv.save('E', Uint8Array.of(out.length, 2)); nv.saveScpu({ 0: 168 }); nv.saveScpuMemory({ clock_offset: -5, clock_status: 0, words: { 1: 2 } });
    return out;
  };
  const a1 = run(rn);
  hostDoc = D.nvramSave(hostDoc, 'M', M);           // another writer
  const a2 = run(rn), a3 = run(rn);
  ok(record.start === null && record.sessions.length === 3 && record.sessions.map((s) => s.clock).join() === '1000,1001,1002' &&
    !('doc' in record.sessions[0]) && record.sessions[1].doc?.M === j.M && !('doc' in record.sessions[2]) && seen.join() === '1,2,3',
  `the record: ${JSON.stringify(record).slice(0, 300)}, onRecord ${seen}`);
  const rp = D.replayNvram(JSON.parse(JSON.stringify(D.nvramRecord(record, 'r'))), 'the log');
  const b = [run(rp), run(rp), run(rp)];
  ok(JSON.stringify(b) === JSON.stringify([a1, a2, a3]), `the replay's loads and clocks: ${JSON.stringify(b).slice(0, 200)}`);
  ok(throwsLike(() => rp.load(), /records 3 session start/), 'a replay opening a session the log does not record refused');
  ok(throwsLike(() => D.nvramRecord({ start: null, sessions: [{}] }, 'r'), /session 1: no integer clock/), 'a record without a clock refused');
  return { checks, bad };
}

const labBase = async () => {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  return { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), wallClock: () => performance.now() / 1000 };
};

export async function nvramSessions() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-nvram');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'nvram.json');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { fileNvram } = await import('../host/nvram.mjs');
  const base = await labBase();
  // the session idles idle_ms after its start (the comparison with a session without S-NVRAM takes the start's frame:
  // with the native lens, E143's default, the application leaves the date prompt for the shooting screen when the lens
  // module's state event comes, about 120 ms later, docs/hle-gaps.md 4.4.2)
  let last = null;
  const open = (nvram, idle_ms = 1500) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...base, ...(nvram ? { nvram } : {}) });
    pl.open_session();
    last = pl;
    const s = pl.session;
    s.idle_slice(s.lab.lab_time() + idle_ms * 1e6);
    return s;
  };
  const frame = (s) => Buffer.from(s.frame('boundary', true)[2]).toString('base64');
  const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 1200e6); };
  const plain = frame(open(null, 0));
  ok(last.nvram_record === null, 'without S-NVRAM the Player records nothing');
  const nvram = fileNvram(file);
  let s = open(nvram, 0);
  ok(frame(s) !== plain, 'S-NVRAM: the first session starts without the date prompt a session without it shows');
  s.idle_slice(s.lab.lab_time() + 1500e6);
  ok(JSON.stringify(s.lab.store_log.nvram.loaded) === '[]', `a fresh file restores nothing: ${JSON.stringify(s.lab.store_log.nvram.loaded)}`);
  const rec = last.nvram_record;
  ok(rec?.start === null && rec.sessions.length === 1 && Number.isSafeInteger(rec.sessions[0].clock) && !('doc' in rec.sessions[0]),
    `the Player's record of a fresh file: ${JSON.stringify(rec)}`);
  const saved = nvram.load();
  ok(saved?.M?.length === 0x40000 && saved?.E?.length === 0x30000 && saved?.scpu?.[0] === 0xa8,
    `the blank store's saves reach the file (M ${saved?.M?.length}, E ${saved?.E?.length}, SCPU word 0 ${saved?.scpu?.[0]})`);
  s.set(SID, VALUE);
  press(s, 'menu'); press(s, 'menu');
  const saves = s.lab.store_log.nvram.saves;
  ok(saves.some((x) => x.store === 'M' && x.posted), `the menu close saves M through the flash task: ${JSON.stringify(saves)}`);
  s = open(nvram);
  ok(JSON.stringify(s.lab.store_log.nvram.loaded) === '["M","E"]', `the next session restores M and E: ${JSON.stringify(s.lab.store_log.nvram.loaded)}`);
  ok(s.get(SID) === VALUE, `setting ${SID} kept: ${s.get(SID)}, want ${VALUE}`);
  ok(s.lab.state() === 0x108, `the restored camera reaches its screen: GUI 0x${s.lab.state().toString(16)}`);
  ok(fileNvram(file).doc()?.model === 'E143', 'the file names its model');
  return { checks, bad };
}

// bin/play.mjs over HTTP (checks/lib/playhttp.mjs), HOME a fresh directory so that the default file is the test's own
export async function nvramHost() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-nvram-host');
  fs.rmSync(out, { recursive: true, force: true });
  const home = path.join(out, 'home');
  fs.mkdirSync(home, { recursive: true });
  process.env.OM_CHECK_OUT = out;
  const { Play } = await import('../checks/lib/playhttp.mjs');
  const env = { ...process.env, HOME: home };
  delete env.OM_EMU_NVRAM;
  const file = path.join(home, '.om-emu/nvram-E143.json');
  const bytes = (f) => (fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : null);
  // nvramFromEnv: the harness adds no --nvram off, so the default (or env's OM_EMU_NVRAM) decides
  const open = (tag, args, e = env) => Play.open(tag, ['--idle', 'off', '--a15', 'on', ...args], { env: e, nvramFromEnv: true });
  const store = async (pl) => (await pl.token_('STORE')).record.info.sha;
  const lineOf = (pl) => pl.lines.find((l) => /^play: (settings|--replay)/.test(l)) ?? '(none)';
  const used = (st) => st.stand_ins.filter((x) => x === 'S-NVRAM' || x === 'S-SETSAVE').join();
  const visit = async (pl) => {                     // the menu opened and closed: the native menu-close save
    await pl.key('menu'); await pl.token_('WAIT:1000'); await pl.key('menu'); await pl.token_('WAIT:1500');
  };
  const sameInputs = (x, y) => JSON.stringify(x.map((e) => [e.input, e.frame, e.record?.info ?? null])) === JSON.stringify(y.map((e) => [e.input, e.frame, e.record?.info ?? null]));
  const sessionJson = (pl) => JSON.parse(fs.readFileSync(path.join(pl.out, 'session.json'), 'utf8'));

  // 1. the default: kept in ~/.om-emu/nvram-E143.json
  let pl = await open('first', []), d0, d1;
  try {
    ok(lineOf(pl) === `play: settings and clock kept in ${file} (S-NVRAM; --nvram off for a blank camera)`, `the default's line: ${lineOf(pl)}`);
    const st = await pl.status();
    ok(used(st) === 'S-NVRAM' && JSON.stringify(st.nvram?.loaded) === '[]' && st.gui === '0x0108', `the first session: ${used(st)} ${JSON.stringify(st.nvram)} ${st.gui}`);
    const sess = await pl.get('/api/session');
    ok(sess.nvram === file, `GET /api/session's nvram: ${sess.nvram}`);
    d0 = await store(pl);
    await visit(pl);
    d1 = await store(pl);
    ok(d0 !== d1 && (await pl.status()).nvram?.saves >= 3, `the menu visit changes the settings (STORE ${d0} -> ${d1}) and saves them`);
  } finally { ok(await pl.close() === 0, 'the first session exits 0'); }
  const first = pl.out, firstLog = JSON.parse(fs.readFileSync(path.join(first, 'session.json'), 'utf8'));
  ok(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).model === 'E143', 'the default file written, naming E143');
  ok(firstLog.nvram?.start === null && firstLog.nvram.sessions.length === 1 && fs.existsSync(path.join(first, 'session.nvram.json')),
    `session.json records the start and session.nvram.json is beside it: ${JSON.stringify(firstLog.nvram)?.slice(0, 200)}`);
  const kept = bytes(file);

  // 2. the next session: M and E restored, the settings as the first left them
  pl = await open('second', []);
  try {
    const st = await pl.status();
    ok(JSON.stringify(st.nvram?.loaded) === '["M","E"]' && st.gui === '0x0108', `the second session restores M and E: ${JSON.stringify(st.nvram)} ${st.gui}`);
    ok(await store(pl) === d1, 'the second session starts with the first one\'s settings (STORE digest)');
  } finally { await pl.close(); }
  const afterSecond = bytes(file);

  // 3. --replay of the first session: its record, in memory; the file untouched. From session.json, from session.jsonl
  // (its session.nvram.json beside it), and without the record (a blank camera: it diverges)
  for (const [tag, log] of [['replay-json', path.join(first, 'session.json')], ['replay-jsonl', path.join(first, 'session.jsonl')]]) {
    pl = await open(tag, ['--replay', log]);
    try {
      ok(lineOf(pl).startsWith('play: --replay: each session starts from the kept state its log records'), `${tag}'s line: ${lineOf(pl)}`);
      const st = await pl.wait_phase((x) => x.phase === 'running', 300);
      ok(used(st) === 'S-NVRAM' && sameInputs(await pl.log(), firstLog.inputs), `${tag}: the inputs' frames and STORE digests are the first session's`);
    } finally { await pl.close(); }
    ok(JSON.stringify(sessionJson(pl).nvram) === JSON.stringify(firstLog.nvram), `${tag}: its session.json records the same start`);
  }
  const stripped = path.join(out, 'stripped.json');
  fs.writeFileSync(stripped, JSON.stringify({ ...firstLog, nvram: undefined }));
  pl = await open('replay-blank', ['--replay', stripped]);
  try {
    ok(lineOf(pl).startsWith('play: --replay: the log kept no state'), `the stripped log's line: ${lineOf(pl)}`);
    const st = await pl.wait_phase((x) => x.phase === 'running', 300);
    ok(used(st) === 'S-SETSAVE' && !sameInputs(await pl.log(), firstLog.inputs), 'negative control: without the record the replay is a blank camera and does not repeat the session');
  } finally { await pl.close(); }
  ok(bytes(file) === afterSecond, 'the replays leave the kept file as it was');

  // 4. the opt-out: --nvram off, OM_EMU_NVRAM=off: a blank camera, the file untouched; OM_EMU_NVRAM=FILE
  for (const [tag, args, e, want] of [['off-flag', ['--nvram', 'off'], env, '--nvram off'], ['off-env', [], { ...env, OM_EMU_NVRAM: 'off' }, 'OM_EMU_NVRAM off']]) {
    pl = await open(tag, args, e);
    try {
      ok(lineOf(pl).startsWith(`play: settings not kept (${want})`), `${tag}'s line: ${lineOf(pl)}`);
      const st = await pl.status();
      ok(used(st) === 'S-SETSAVE' && st.nvram === undefined, `${tag}: ${used(st)}`);
      ok(await store(pl) !== d1, `${tag}: a fresh camera, not the kept settings`);
    } finally { await pl.close(); }
  }
  const other = path.join(out, 'other.json');
  pl = await open('env-file', [], { ...env, OM_EMU_NVRAM: other });
  try {
    ok(lineOf(pl).startsWith(`play: settings and clock kept in ${other} `) && used(await pl.status()) === 'S-NVRAM', `OM_EMU_NVRAM=FILE's line: ${lineOf(pl)}`);
    const sw = await pl.req('POST', '/api/model', { model: 'E146' });
    ok(sw[0] === 409 && /cannot switch/.test(Buffer.from(sw[2]).toString()), `a model switch with a named file refused: ${sw[0]}`);
  } finally { await pl.close(); }
  ok(fs.existsSync(other), 'OM_EMU_NVRAM=FILE written');
  ok(bytes(file) === afterSecond, 'the opt-outs and another file leave the default file as it was');

  // 5. per model: E146 keeps its own file; E143's refused there; E144 has no S-NVRAM sites
  const f146 = path.join(home, '.om-emu/nvram-E146.json');
  pl = await open('e146', ['--model', 'E146']);
  try {
    ok(lineOf(pl).includes(f146) && used(await pl.status()) === 'S-NVRAM', `E146's line: ${lineOf(pl)}`);
    await visit(pl);
  } finally { await pl.close(); }
  ok(fs.existsSync(f146) && JSON.parse(fs.readFileSync(f146, 'utf8')).model === 'E146' && bytes(file) === afterSecond, 'E146 writes its own file, E143\'s stays as it was');
  const node = (args) => spawnSync(process.execPath, [path.join(J, 'bin/play.mjs'), '--no-browser', '--idle', 'off', '--out', path.join(out, 'refused'), ...args],
    { cwd: REPO, env, encoding: 'utf8', timeout: 120000 });
  let r = node(['--model', 'E146', '--nvram', file]);
  ok(r.status === 1 && r.stderr.includes('the state of a E143, not of this E146') && !/play: http/.test(r.stdout), `E143's file on E146 refused: rc ${r.status} ${r.stderr.slice(0, 300)}`);
  r = node(['--model', 'E144', '--nvram', 'on']);
  ok(r.status === 1 && /--nvram on: S-NVRAM's sites are not placed in OM-5's build/.test(r.stderr), `--nvram on on E144 refused: rc ${r.status} ${r.stderr.slice(0, 300)}`);
  pl = await open('e144', ['--model', 'E144']);
  try {
    ok(/^play: settings not kept on E144: S-NVRAM's sites are not placed/.test(lineOf(pl)) && used(await pl.status()) === 'S-SETSAVE', `E144 by default: ${lineOf(pl)}`);
  } finally { await pl.close(); }
  ok(!fs.existsSync(path.join(home, '.om-emu/nvram-E144.json')), 'E144 writes no file');
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  for (const [name, f] of [['units', nvramUnits], ['lab', nvramSessions], ['host', nvramHost]]) {
    if (which !== 'all' && which !== name) continue;
    const r = await f();
    console.log(`S-NVRAM ${name}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
