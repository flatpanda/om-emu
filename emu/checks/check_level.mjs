#!/usr/bin/env node
// The accelerometer, the level gauge and Level Adjust in a play session (src/lab/acc.mjs, src/fw/models.mjs acc;
// docs/hle-gaps.md 4.7.3), on the model of OM_EMU_MODEL (E143 by default; E146 also gives the fact):
//   L1  the probe ran natively through S-ACCREG: open (6, 107), the WHO_AM_I read answered with the value the probe
//       wants, the two set-up writes, close; the probe's success halfword is 1; ACC_MAIN waits in its cycle; the
//       stand-ins are listed
//   L2  samples reach the cache: over 1 s of lab time (from 500 ms after the start) the counter moves once per ACC_MAIN
//       cycle (11 to 13: A-ACC-2's 80 ms, some cycles stretched), the raw cache (the firmware's raw accessor) is the
//       level sample, the firmware's pose-0 reference (0, -16384, 0), and the corrected cache equals it (blank factory
//       data: the correction's gate is closed, D)
//   L3  the gauge follows a tilt: the gauge's getter (natively) reads the horizon within 0.2 degree of the roll and
//       the vertical within 0.2 degree of pitch / 3, both valid, body orientation 0, for five tilts; and the TFT
//       composite of the shooting screen's gauge (INFO) is green on the arc and the bar when level and loses the
//       arc's green at roll 5 and the bar's at pitch 9 (the GUI redraws it natively, from PER_SLOPE's results)
//   L4  Level Adjust's Adjust runs to completion: Setup page 6 row 3, Adjust, OK; within 2 s of lab time the GUI is at
//       its message receive again, back on the shooting screen, and the store's user pose 0 holds the sample of the
//       tilt it was adjusted at (x, y, z) and 250 (25.0 degC)
// --mutants runs L2..L4 under the stand-in's mutants (acc-still: no sample is delivered; tilt-ignored: the tilt is not
// applied) and passes when each is caught.
//   node emu/checks/check_level.mjs [--only L1,L2,...] [--mutants]
import { loadImage, loadBlock, createHash, runMain } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { pred } from './lib/pred.mjs';
import { Player } from '../src/lab/player.mjs';
import { PLAYER_PARSER } from '../scenarios/session_replay.mjs';
import { MODEL, MODEL_INFO, A } from '../src/fw/model.mjs';
import { STATE_SHOOTING } from '../src/lab/play.mjs';
import { words_to_rgb } from '../src/lab/display.mjs';
import { bodyReading, sensorOf } from '../src/lab/acc.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show } from '../src/util/show.mjs';

// the readers the check calls natively (D): the raw and the corrected cache's accessors ({x, y, z} to a0, the counter
// in d0); the data-object read 0x500417da (E143) and the user pose kinds x, y, z, temperature (0x4eba.. , index =
// pose) that Level Adjust's Adjust writes
const READERS = { E143: { raw: 0x50049771, corrected: 0x50049795 }, E146: { raw: 0x5004A462, corrected: 0x5004A486 } };
const STORE_READ = A(0x500417DA), USER_POSE = [0x4EBA, 0x4ECA, 0x4EDA, 0x4EEA];
// the gauge on the TFT's shooting screen (900 x 600, INFO's first page, X): the horizon's arc and the vertical's bar
const ARC = [370, 395, 530, 452], BAR = [583, 228, 622, 370];
const TILTS = [[5, 0], [-3, 0], [0, 6], [2, -9], [-4.5, 7.5]];

class Group {
  constructor(name) { this.name = name; this.problems = []; this.cases = 0; }
  eq(label, got, want) { this.cases += 1; if (!pred(deepEqual(got, want), 2)) this.problems.push(`${label}: got ${show(got)}, want ${show(want)}`); }
  true(label, ok, detail = '') { this.cases += 1; if (!pred(ok, 2)) this.problems.push(`${label}${detail ? ': ' + detail : ''}`); }
}
const env = () => ({ rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 });
function withPlayer(mutant, fn) {
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...(mutant ? { x_mutant: mutant } : {}) }, env());
  pl.open_session();
  try { ready(pl.session); return fn(pl, pl.session, pl.session.lab); } finally { pl.close_session(); }
}
// lab time in 50 ms waits while the GUI task is not at its message receive (at most 2 s), as a user's next key comes
// after the screen has settled; and after the open, until the application has the GUI on the shooting screen (at
// once on E143, X; E146's application takes about 100 ms of lab time)
function settle(s) { for (let i = 0; i < 40 && s.gui_busy(); i++) s.wait(50); }
function ready(s) { for (let i = 0; i < 60 && (s.lab.state() !== STATE_SHOOTING || s.gui_busy()); i++) s.wait(50); }
// an input as the player takes it: the input, then the frame it publishes after one (src/lab/player.mjs)
const input = (pl, inp) => { const rec = pl.run_input(inp); pl.publish_frame(); return rec; };
const key = (pl, id) => { settle(pl.session); input(pl, { type: 'key', id, action: 'down' }); input(pl, { type: 'key', id, action: 'up' }); };
const tilt = (pl, roll, pitch) => { const rec = input(pl, { type: 'tilt', roll, pitch }); settle(pl.session); return rec; };
// a cache accessor natively: [x, y, z] and the counter
function cache(lab, which) {
  const a = lab.nk.packet(new Uint8Array(6)), r = lab.call(READERS[MODEL][which], { a0: a }, null, null, 200);
  const b = lab.sim.read(a, 6), dv = new DataView(b.buffer, b.byteOffset, 6);
  return [[0, 2, 4].map((o) => dv.getInt16(o, true)), r.d0 >>> 0];
}
// the green pixels of the arc and of the bar in the frame the player would publish now (the composite at the next
// frame boundary, src/lab/play.mjs frame)
function frame_pixels(s) {
  const [w, , words] = s.frame('boundary'), rgb = words_to_rgb(words);
  return [ARC, BAR].map(([x0, y0, x1, y1]) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = 3 * (y * w + x);
      if (rgb[o + 1] > 150 && rgb[o] < 100 && rgb[o + 2] < 100) n += 1;
    }
    return n;
  });
}
// the same after 200 ms more of lab time: the GUI redraws the arc and the bar some frames apart after PER_SLOPE's new
// result (X: up to about 50 ms after the tilt input's 250 ms)
function gauge_pixels(s) { s.wait(200); return frame_pixels(s); }

function l1() {
  const g = new Group('L1 probe');
  withPlayer(null, (pl, s, lab) => {
    const f = MODEL_INFO.acc, acc = s.acc;
    g.eq('S-ACCREG: the probe\'s accesses', acc.reg_log, [['open', ...f.dev], ['read', ...f.who_am_i], ...f.setup.map(([k, v]) => ['write', k, v]), ['close', f.dev[0]]]);
    g.eq('the probe\'s success halfword', [...lab.sim.read(f.probed, 2)], [1, 0]);
    g.true('ACC_MAIN waits in its cycle', lab.nk.timed_waiters().includes(acc.main_tid), show(lab.nk.timed_waiters()));
    const used = pl.stand_ins_in_use();
    g.true('the stand-ins are listed', ['H-ACCINIT', 'S-ACCREG', 'S-ACCSAMPLE', 'H-SLOPEINIT'].every((x) => used.includes(x)), show(used.filter((x) => /ACC|SLOPE/.test(x))));
  });
  return g;
}
function l2(mutant = null) {
  const g = new Group('L2 samples');
  withPlayer(mutant, (pl, s, lab) => {
    // from 500 ms after the shooting screen: on E143 the native lens's attach reaches the application about 120 ms
    // after it, and the application's work on it held CPU 0 through one 129 ms ACC_MAIN cycle, 11 in the second (X).
    // 11 to 13 cycles a second: an 80 ms cycle (A-ACC-2) that other tasks' work stretches to about 100 ms comes a few
    // times a second with either lens; on E146 with the native lens three of them fall in the first second after the
    // shooting screen, while the application shows the lens's focal length (X: 11 there, 12 with S-LENS; docs/hle-gaps.md
    // 4.4.3)
    s.wait(500);
    const [, c0] = cache(lab, 'raw');
    s.wait(1000);
    const [raw, c1] = cache(lab, 'raw'), [corrected, c2] = cache(lab, 'corrected');
    g.true('the counter moves once per ACC_MAIN cycle over 1 s', c1 - c0 >= 11 && c1 - c0 <= 13, `${c0} -> ${c1}`);
    g.eq('the raw cache is the level sample', raw, [0, -16384, 0]);
    g.eq('the corrected cache equals the raw one (blank factory data)', [corrected, c2], [raw, c1]);
    g.eq('the level sample is the pose-0 reference', s.acc.level, [0, -16384, 0]);
  });
  return g;
}
function l3(mutant = null) {
  const g = new Group('L3 gauge');
  withPlayer(mutant, (pl, s, lab) => {
    key(pl, 'info');
    s.wait(300);
    const level = gauge_pixels(s);
    g.true('level: the arc and the bar are green', level[0] > 200 && level[1] > 200, show(level));
    g.eq('level: the getter', s.acc.gauge(), { horizon: 0, horizon_ok: 1, vertical: 0, vertical_ok: 1, body: 0 });
    for (const [roll, pitch] of TILTS) {
      const gv = tilt(pl, roll, pitch).gauge;
      const ok = Math.abs(gv.horizon - 10 * roll) <= 2 && Math.abs(gv.vertical - (10 * pitch) / 3) <= 2 && gv.horizon_ok === 1 && gv.vertical_ok === 1 && gv.body === 0;
      g.true(`tilt ${roll}, ${pitch}: the getter reads the horizon ${10 * roll} and the vertical ${((10 * pitch) / 3).toFixed(1)} (0.1 degree, within 2)`, ok, show(gv));
    }
    tilt(pl, 5, 0);
    const rolled = gauge_pixels(s);
    tilt(pl, 0, 9);
    const pitched = gauge_pixels(s);
    g.true('roll 5: the arc is not green, the bar is', rolled[0] === 0 && rolled[1] > 200, show(rolled));
    g.true('pitch 9: the bar is not green, the arc is', pitched[1] === 0 && pitched[0] > 200, show(pitched));
    tilt(pl, 0, 0);
    g.eq('level again: the arc and the bar are green as before', gauge_pixels(s), level);
    let refused = null;
    try { tilt(pl, 50, 0); } catch (e) { refused = e.message; }
    g.true('a tilt beyond 45 degrees is refused (A-ACC-2)', refused !== null && /A-ACC-2/.test(refused), show(refused));
  });
  return g;
}
function l4(mutant = null) {
  const g = new Group('L4 Level Adjust');
  withPlayer(mutant, (pl, s, lab) => {
    tilt(pl, 2, -3);
    const sample = sensorOf(bodyReading(2, -3, 16384), s.acc.axes);   // the reading of roll 2, pitch -3 at 1 g = 16384
    key(pl, 'menu');
    for (let i = 0; i < 5; i++) key(pl, 'right');
    for (let i = 0; i < 3; i++) key(pl, 'down');
    key(pl, 'ok');
    g.eq('Setup page 6 row 3 opens Level Adjust (panel 387)', s.state().panel, 387);
    key(pl, 'down');
    key(pl, 'ok');
    s.wait(2000);
    g.true('the GUI is at its message receive again', s.gui_busy() === null, s.gui_busy() ?? '');
    g.eq('the GUI is back on the shooting screen', lab.state(), STATE_SHOOTING);
    const user = USER_POSE.map((k) => (lab.call(STORE_READ, { d0: k, d1: 0, a0: 0 }, null, null, 20000).d0 << 16) >> 16);
    g.eq('the store\'s user pose 0 is the adjusted sample and 25.0 degC', user, [...sample, 250]);
  });
  return g;
}

const GROUPS = { L1: l1, L2: l2, L3: l3, L4: l4 };
const MUTANTS = [['acc-still', ['L2', 'L4']], ['tilt-ignored', ['L3', 'L4']]];
function runGroup(name, mutant = null) {
  try { return GROUPS[name](mutant); } catch (e) {
    const g = new Group(name);
    g.problems.push(`stopped: ${String(e.message).slice(0, 400)}`);
    return g;
  }
}

function main(argv) {
  const a = parseArgs('check_level.mjs', argv, [{ opt: '--mutants', type: 'flag' }, { opt: '--only', type: 'str' }]);
  const t0 = performance.now(), secs = () => Math.round((performance.now() - t0) / 1000);
  if (!MODEL_INFO.acc || !READERS[MODEL]) a.error(`${MODEL}: no accelerometer in the lab (src/fw/models.mjs acc) or no readers here`);
  if (a.mutants) {
    const missed = [];
    for (const [m, groups] of MUTANTS) for (const name of groups) {
      const g = runGroup(name, m), caught = g.problems.length > 0;
      console.log(`[${caught ? 'ok' : 'FAIL'}] mutant ${m} -> ${name}: ${g.problems.length} problem(s)${g.problems.length ? ': ' + g.problems[0].slice(0, 120) : ''}`);
      if (!caught) missed.push(`${m}/${name}`);
    }
    console.log(`${!missed.length ? 'all mutants detected' : `MISSED ${show(missed)}`} (${secs()} s)`);
    return missed.length ? 1 : 0;
  }
  const names = a.only ? a.only.split(',') : Object.keys(GROUPS);
  const unknown = names.filter((n) => !Object.hasOwn(GROUPS, n));
  if (unknown.length) a.error(`--only: unknown group(s) ${unknown.join(', ')} (${Object.keys(GROUPS).join(', ')})`);
  let bad = 0;
  for (const name of names) {
    const g = runGroup(name);
    console.log(`[${!g.problems.length ? 'ok' : 'FAIL'}] ${g.name}: ${g.cases} checks`);
    for (const p of g.problems.slice(0, 12)) console.log('      ' + p);
    bad += g.problems.length ? 1 : 0;
  }
  console.log(`${!bad ? 'all groups passed' : 'FAILED'} (${bad} problem(s), ${secs()} s)`);
  return bad ? 1 : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) runMain('check_level.mjs', main);
