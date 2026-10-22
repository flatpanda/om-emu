// The body's Fn-type buttons (src/lab/play.mjs CONTROLS iso .. front2): each press reaches the camera application's
// button mapping, whose value-to-function step (0x5104be42) reads the button's setting value, and the buttons with a
// screen of their own open it:
//   fnKeySessions  one session (on a fresh S-NVRAM file, so no date prompt): ISO opens the ISO bar (GUI 0x0414), Drive
//                  and AF/metering open SETVAL (0x0202), each closed by a half press; +/-, AF-ON, |o| and the two front
//                  buttons leave the shooting screen; AEL/AFL and BKT are refused as not wired
//   node emu/test/test_fnkeys.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const J = path.resolve(new URL('..', import.meta.url).pathname);
const VALUE_TO_FUNCTION = 0x5104BE42;
// [control, the button setting's default value, the GUI state the press leaves]
const KEYS = [['iso', 6, 0x0414], ['exp', 3341, 0x0108], ['drive', 3412, 0x0202], ['afmeter', 3413, 0x0202],
  ['afon', 69, 0x0108], ['lvkey', 452, 0x0108], ['front1', 84, 0x0108], ['front2', 106, 0x0108]];

export async function fnKeySessions() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-fnkeys');
  fs.rmSync(out, { recursive: true, force: true });
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { fileNvram } = await import('../host/nvram.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })),
    wallClock: () => performance.now() / 1000, nvram: fileNvram(path.join(out, 'nvram.json')) };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  s.idle_slice(lab.lab_time() + 1500e6);
  const values = [];
  lab.observe(VALUE_TO_FUNCTION, (L, r) => values.push(r.d0 >>> 0), 'T-FNVALUE');
  const press = (k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6); };
  const gui = () => `0x${lab.state().toString(16)}`;
  ok(lab.state() === 0x0108, `the session starts on the shooting screen: GUI ${gui()}`);
  for (const [k, value, state] of KEYS) {
    values.length = 0;
    press(k);
    ok(values.includes(value), `${k}: the mapping reads ${value}: ${JSON.stringify([...new Set(values)])}`);
    ok(lab.state() === state, `${k}: GUI ${gui()}, want 0x${state.toString(16)}`);
    if (lab.state() !== 0x0108) { press('s1'); ok(lab.state() === 0x0108, `${k}: a half press closes it: GUI ${gui()}`); }
  }
  for (const k of ['ael', 'bkt']) {
    let e = null;
    try { s.key(k, 'down'); } catch (x) { e = x; }
    ok(/: not wired \(/.test(e?.message ?? ''), `${k} is refused as not wired: ${e?.message ?? 'accepted'}`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await fnKeySessions();
  console.log(`Fn-type buttons: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
