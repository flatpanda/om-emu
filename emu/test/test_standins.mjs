// The Stand-ins tab's rows (GET /api/screens' stand_ins: src/lab/playapi.mjs standInRows) against the labels a session
// can report in use (src/lab/player.mjs stand_ins_in_use):
//   standinsUnits    (firmware-free, over the tables) every label stand_ins_in_use() can return has a row with a text:
//                    the label literals of its source, and the labels it takes from elsewhere, each from its own
//                    table (CPU 2's and the native play module's lists, the sub-CPU's two, PER_SIO's devices', the
//                    recorder's by its two forms, and every MODELS body's own return_stubs and call_skips). The
//                    function's sources are pinned: a label pushed in a form this test does not read (a new list, a
//                    computed name) fails it until the test enumerates that source. Controls: the check reports a
//                    label without a row, an empty text and a row table without the camera application's rows (the
//                    page's table before: 76 of 219 labels without a row, X on b36e3e5); the rows keep STAND_INS's text where
//                    two tables have one; the router's /api/screens answers the rows
//   standinsSession  (the process's model through bin/session.mjs; E147 in bin/test.mjs's child) the labels a session
//                    reports at run time (a start, S1, S2, playback, the menu: the summary's stand_ins) each have a row
//   node emu/test/test_standins.mjs [--units] [--session]       (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const LABEL = /^(?:[SHAK]-[A-Z0-9]+(?:-[A-Z0-9]+)*|A\d+|SWITCH)$/;
// the labels without a row or with no text in it
export const missingRows = (labels, rows) => [...labels].filter((l) => typeof rows[l] !== 'string' || rows[l].trim().length < 20);

export async function standinsUnits() {
  const t = tester(), { ok } = t;
  const { standInRows, modelStandInRows } = await import('../src/lab/playapi.mjs');
  const { STAND_INS } = await import('../src/lab/playui.mjs');
  const { CAMAPP_STAND_INS } = await import('../src/lab/camapp.mjs');
  const { CPU2_STAND_INS } = await import('../src/lab/cpu2.mjs');
  const { PLAY_NATIVE_STAND_INS } = await import('../src/lab/playmod.mjs');
  const { SCPUDEV_LABELS } = await import('../src/lab/scpudev.mjs');
  const { SCPUM4_LABELS } = await import('../src/lab/scpum4.mjs');
  const { sioDeviceLabels } = await import('../src/lab/sio.mjs');
  const { recStandIns } = await import('../src/lab/rec.mjs');
  const { MODELS } = await import('../src/fw/models.mjs');

  // stand_ins_in_use()'s source: its label literals, and the other forms it pushes labels in
  const src = fs.readFileSync(path.join(EMU, 'src/lab/player.mjs'), 'utf8');
  const i = src.indexOf('\n  stand_ins_in_use() {'), j = src.indexOf('\n  }\n', i), body = i < 0 || j < 0 ? '' : src.slice(i, j);
  const code = body.split('\n').map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');      // without the line comments
  const literals = new Set([...code.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]));
  const VALUES = new Set(['no-aeinit', 'auto', 'off', 'no-dispq', 'tft', 'evf', 'evf-store-after-open', 'wall', 'gui', 'reads', 'mm_init']);   // option values and a fact name it compares with
  const labels = new Set([...literals].filter((x) => !VALUES.has(x)));
  ok(body.length > 5000 && labels.size >= 170 && [...labels].every((x) => LABEL.test(x)), `stand_ins_in_use's literals: ${labels.size} labels; not label-shaped: ${[...labels].filter((x) => !LABEL.test(x)).join(' ') || 'none'}`);
  // every other form a label is pushed in: an identifier spread, a call, a loop over the model's entries
  const without = code.replace(/'[^'\n]*'/g, "''");
  const spreads = [...without.matchAll(/\.\.\.\(?([A-Za-z_][\w.?]*(?:\([^)]*\))?)/g)].map((m) => m[1]).filter((x) => !x.startsWith('this.camapp_') && !/^(?:mdet|stb|vsc|imgpro|ems1|media)\b/.test(x) && x !== 'a.touch');
  const other = [...new Set([...spreads.filter((x) => /STAND_INS|labels|recStandIns/.test(x)), ...[...without.matchAll(/used\.push\(([a-z]\w*)\)/g)].map((m) => `push(${m[1]})`),
    ...[...without.matchAll(/\b(CPU2_STAND_INS|PLAY_NATIVE_STAND_INS|recStandIns)\b/g)].map((m) => m[1])])].sort();
  const KNOWN = ['CPU2_STAND_INS', 'PLAY_NATIVE_STAND_INS', 'push(name)', 'recStandIns', 'this.session.lab.scpu_dev.labels', 'this.session.sio.labels'];
  ok(JSON.stringify(other) === JSON.stringify(KNOWN), `stand_ins_in_use takes labels from the sources this test reads: ${JSON.stringify(other)}, read ${JSON.stringify(KNOWN)}`);
  ok((without.match(/MODEL_INFO\.(return_stubs|call_skips)/g) ?? []).join() === 'MODEL_INFO.return_stubs,MODEL_INFO.call_skips', 'the two loops over the model\'s own stand-ins');
  // those sources, each from its own table
  const rec = (image, precon, imgpro) => recStandIns({ image, precon_by_rec: () => precon, imgpro_by_rec: () => imgpro });
  const elsewhere = { 'CPU 2': CPU2_STAND_INS, 'the play module': PLAY_NATIVE_STAND_INS, 'the sub-CPU\'s model': SCPUDEV_LABELS, 'the SCPU\'s firmware': SCPUM4_LABELS, 'PER_SIO\'s devices': sioDeviceLabels(),
    'the recorder': [...rec(true, true, true), ...rec(true, false, false), ...rec(false, false, false)] };
  for (const [what, list] of Object.entries(elsewhere)) {
    ok(list.length > 0 && list.every((x) => LABEL.test(x)), `${what}: ${list.join(' ')}`);
    for (const x of list) labels.add(x);
  }
  const rows = standInRows();
  ok(missingRows(labels, rows).length === 0, `${labels.size} labels a session can report, without a row: ${missingRows(labels, rows).join(' ') || 'none'}`);
  // every body's own stand-ins, in that body's rows
  let own = 0;
  for (const [c, m] of Object.entries(MODELS)) {
    const names = [...(m.return_stubs ?? []).map((x) => x[2]), ...(m.call_skips ?? []).map((x) => x[1])];
    own += names.length;
    const r = standInRows(m);
    ok(names.every((x) => LABEL.test(x)) && missingRows(names, r).length === 0 && missingRows(labels, r).length === 0, `${c}'s own stand-ins ${names.join(' ') || '(none)'}: without a row ${missingRows([...names, ...labels], r).join(' ') || 'none'}`);
  }
  ok(own >= 1 && JSON.stringify(modelStandInRows({ return_stubs: [[0x12345678, 0, 'S-X', 'no such part']], call_skips: [['a.b', 'S-Y', 'not run'], [0x9abcdef0, 'S-Z', 'nor this']] })) ===
    '{"S-X":"(this model\'s own, src/fw/models.mjs return_stubs) the function 0x12345678 is not run and returns 0: no such part","S-Y":"(this model\'s own, src/fw/models.mjs call_skips) the call the fact a.b names is stepped over: not run","S-Z":"(this model\'s own, src/fw/models.mjs call_skips) 0x9abcdef0 is stepped over: nor this"}',
  `the model's own rows (${own} over MODELS): ${JSON.stringify(modelStandInRows({ return_stubs: [[0x12345678, 0, 'S-X', 'no such part']], call_skips: [['a.b', 'S-Y', 'not run'], [0x9abcdef0, 'S-Z', 'nor this']] }))}`);
  // controls: the check tells a label without a row, an empty text, and the table the page had (STAND_INS alone)
  const less = { ...rows }; delete less['S-SCENE']; less['H-REQ'] = ' ';
  const before = missingRows(labels, Object.fromEntries(Object.entries(STAND_INS).filter(([k]) => !['S-SCENE', 'H-REQ', 'S-IICWAIT', 'S-PANELDONE', 'S-TPSEND', 'S-TPINTWAIT', 'S-TPREGLIST'].includes(k))));
  ok(missingRows(labels, less).join() === 'S-SCENE,H-REQ' && before.length >= 60 && before.includes('S-CARD') && before.includes('S-CAMAPP') && before.includes('S-SCPUDEV'),
    `control: a removed row and an empty text are reported; the page's rows before this table lacked ${before.length} labels`);
  const both = Object.keys(CAMAPP_STAND_INS).filter((k) => k in STAND_INS);
  ok(both.length > 0 && both.every((k) => rows[k] === STAND_INS[k]) && Object.keys(rows).length === new Set([...Object.keys(STAND_INS), ...Object.keys(CAMAPP_STAND_INS), ...Object.keys(modelStandInRows((await import('../src/fw/model.mjs')).MODEL_INFO))]).size,
    `a label in both tables keeps STAND_INS's text (${both.join(' ')}); ${Object.keys(rows).length} rows`);
  // the route answers them, the shape as before: {not_offered, stand_ins: {label: text}} (a headless Player, no session)
  const { PlayApi } = await import('../src/lab/playapi.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, debug_api: false, idle: 'off', a15: 'off', out: '<out>', no_wait_on_error: false }, { rom: null, resBlock: null, wallClock: () => performance.now() / 1000 });
  const res = await new PlayApi(pl, { tables: null, frameRgba: () => null }).handle({ method: 'GET', path: '/api/screens', headers: {} });
  const doc = res.status === 200 ? JSON.parse(new TextDecoder().decode(res.body)) : null;
  ok(doc !== null && Object.keys(doc).join() === 'not_offered,stand_ins' && JSON.stringify(doc.stand_ins) === JSON.stringify(rows) && Array.isArray(doc.not_offered), `GET /api/screens: ${res.status} ${doc ? Object.keys(doc) : ''}`);
  return t;
}

export async function standinsSession() {
  const t = tester(), { ok } = t;
  const { standInRows } = await import('../src/lab/playapi.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const r = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), 'wait:1500', 's1', 's2', 'wait:1500', 'play', 'play', 'menu', 'menu'], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 28 });
  let sum = null;
  for (const l of (r.stdout ?? '').split('\n').filter(Boolean)) { try { const x = JSON.parse(l); if (x.summary) sum = x; } catch { /* reported below */ } }
  const used = sum?.stand_ins ?? [];
  ok(r.status === 0 && used.length >= 60, `${MODEL}: the session ran and reports ${used.length} labels in use: rc ${r.status} ${(r.stderr ?? '').trim().split('\n').at(-1)}`);
  ok(missingRows(used, standInRows()).length === 0, `${MODEL}: labels in use without a row: ${missingRows(used, standInRows()).join(' ') || 'none'}`);
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  const say = (name, r) => { console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); fail += r.bad.length; };
  if (all || process.argv.includes('--units')) say('stand-in rows, units', await standinsUnits());
  if (process.argv.includes('--session')) say(`stand-in rows of a session's labels (${process.env.OM_EMU_MODEL ?? 'E143'})`, await standinsSession());
  process.exit(fail ? 1 : 0);
}
