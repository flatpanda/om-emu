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
// With --rotate on (PER_ROTATE natively, H-ROTINIT; run by --only, not by default):
//   R1  PER_ROTATE's orientation with its own hysteresis: the session starts reporting index 1 (EXIF code 1); turned
//       about the lens axis the orientation goes portrait past 50 degrees and comes back below 40 (48 and 42 hold the
//       last one), either way round (EXIF 8 and 6), upside down at 180 (EXIF 3); pitched, the lens down past 60
//       degrees and back below 50 (orientation 5, the reported index kept from portrait but not from upside down);
//       one event 0x4020310 for each change of the reported index and none otherwise; the gauge's getter reads the
//       orientation as its body and, in portrait, the roll from upright as its horizon. Without --rotate a tilt of 50
//       degrees is refused and the orientation is not reported; with it, 181 is
//   R2  the GUI follows: on the shooting screen with INFO's gauge, rolled 90 degrees the gauge is drawn for portrait
//       (its arc at the left, its bar at the bottom: none of the landscape bar's green), rolled -90 the other way (the
//       bar at the top, none of the landscape arc's green), upside down as level, rolled 95 the arc not green; level
//       again as before
// --mutants runs L2..L4 under the stand-in's mutants (acc-still: no sample is delivered; tilt-ignored: the tilt is not
// applied), with --only R1,R2 those groups under no-rotinit (--rotate on's range with PER_ROTATE not started), and
// passes when each is caught.
//   node emu/checks/check_level.mjs [--only L1,L2,...] [--mutants]
import { loadImage, loadBlock, loadNand, createHash, runMain } from './lib/env.mjs';
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
// R2's boxes (X, E143's TFT): the gauge for portrait with its arc at the left and its bar at the bottom (EXIF 8), and
// the other way round's bar at the top (EXIF 6)
const ARC_LEFT = [262, 226, 310, 372], BAR_TOP = [380, 168, 520, 200];
// R1's steps, from level: [roll, pitch, the orientation word 0..5, the getter's EXIF code] (D, docs/hle-gaps.md 4.7.3)
const ROTATIONS = [
  [48, 0, 0, 1], [52, 0, 3, 8], [42, 0, 3, 8], [38, 0, 0, 1],          // portrait past 50 degrees, landscape below 40
  [-48, 0, 0, 1], [-52, 0, 1, 6], [-42, 0, 1, 6], [-38, 0, 0, 1],      // the other way round
  [180, 0, 2, 3], [180, 65, 5, 1],                                       // upside down; the lens down does not keep 3
  [0, 0, 0, 1], [0, 55, 0, 1], [0, 65, 5, 1], [0, 55, 5, 1], [0, 45, 0, 1],   // the lens down past 60, back below 50
  [90, 0, 3, 8], [90, 65, 5, 8], [90, 0, 3, 8], [0, 0, 0, 1],            // portrait kept with the lens down
];
const EXIF_INDEX = { 1: 1, 6: 2, 3: 3, 8: 4 };     // the getter's table {11, 1, 6, 3, 8} by the reported index (D)

class Group {
  constructor(name) { this.name = name; this.problems = []; this.cases = 0; }
  eq(label, got, want) { this.cases += 1; if (!pred(deepEqual(got, want), 2)) this.problems.push(`${label}: got ${show(got)}, want ${show(want)}`); }
  true(label, ok, detail = '') { this.cases += 1; if (!pred(ok, 2)) this.problems.push(`${label}${detail ? ': ' + detail : ''}`); }
}
const env = () => ({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
function withPlayer(mutant, fn, extra = {}) {
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...(mutant ? { x_mutant: mutant } : {}), ...extra }, env());
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
function frame_pixels(s, boxes = [ARC, BAR]) {
  const [w, , words] = s.frame('boundary'), rgb = words_to_rgb(words);
  return boxes.map(([x0, y0, x1, y1]) => {
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
function gauge_pixels(s, boxes) { s.wait(200); return frame_pixels(s, boxes); }

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

function r1(mutant = null) {
  const g = new Group('R1 rotation');
  let refused = null;
  withPlayer(null, (pl, s) => {
    g.true('without --rotate: the orientation is not reported and H-ROTINIT not listed', s.acc.status().rotation === undefined && !pl.stand_ins_in_use().includes('H-ROTINIT'));
    try { tilt(pl, 50, 0); } catch (e) { refused = e.message; }
    g.true('without --rotate: a tilt of 50 degrees is refused (A-ACC-2)', refused !== null && /A-ACC-2/.test(refused), show(refused));
  });
  withPlayer(mutant, (pl, s, lab) => {
    const r = MODEL_INFO.acc.rotate, events = [];
    lab.observe(r.publish, (l, regs) => { if ((regs.d0 >>> 0) === r.event) events.push(l.sim.u32(r.index)); }, 'obs-rotate-event');
    g.true('H-ROTINIT is listed', pl.stand_ins_in_use().includes('H-ROTINIT'));
    g.eq('the start: level, index 1, EXIF 1', s.acc.status().rotation, { pose: 0, index: 1, exif: 1 });
    let index = 1;
    for (const [roll, pitch, pose, exif] of ROTATIONS) {
      events.length = 0;
      const rec = tilt(pl, roll, pitch), want = EXIF_INDEX[exif];
      g.eq(`roll ${roll}, pitch ${pitch}: the orientation`, rec.acc.rotation, { pose, index: want, exif });
      g.eq(`roll ${roll}, pitch ${pitch}: the events`, events, want === index ? [] : [want]);
      g.eq(`roll ${roll}, pitch ${pitch}: the gauge's body`, rec.gauge.body, pose);
      index = want;
    }
    for (const [roll, horizon] of [[95, 50], [-95, -50]]) {
      const gv = tilt(pl, roll, 0).gauge;
      g.true(`roll ${roll}: the getter reads the horizon ${horizon} (within 2) in portrait`, Math.abs(gv.horizon - horizon) <= 2 && gv.horizon_ok === 1, show(gv));
    }
    refused = null;
    try { tilt(pl, 181, 0); } catch (e) { refused = e.message; }
    g.true('a roll of 181 degrees is refused', refused !== null && /within 180/.test(refused), show(refused));
  }, { rotate: 'on' });
  return g;
}
function r2(mutant = null) {
  const g = new Group('R2 GUI');
  withPlayer(mutant, (pl, s) => {
    const boxes = [ARC, BAR, ARC_LEFT, BAR_TOP];
    key(pl, 'info');
    s.wait(300);
    const level = gauge_pixels(s, boxes);
    g.true('level: the landscape arc and bar green, no portrait layout', level[0] > 200 && level[1] > 200 && level[2] === 0 && level[3] === 0, show(level));
    tilt(pl, 90, 0);
    const p8 = gauge_pixels(s, boxes);
    g.true('roll 90: the arc at the left green, none of the landscape bar\'s', p8[2] > 200 && p8[1] === 0, show(p8));
    tilt(pl, -90, 0);
    const p6 = gauge_pixels(s, boxes);
    g.true('roll -90: the bar at the top green, none of the landscape arc\'s', p6[3] > 200 && p6[0] === 0 && p6[2] === 0, show(p6));
    tilt(pl, 180, 0);
    g.eq('roll 180: the gauge as level', gauge_pixels(s, boxes), level);
    tilt(pl, 95, 0);
    const p95 = gauge_pixels(s, boxes);
    g.true('roll 95: the left arc not green', p95[2] === 0 && p95[1] === 0, show(p95));
    tilt(pl, 0, 0);
    g.eq('level again: as before', gauge_pixels(s, boxes), level);
  }, { rotate: 'on' });
  return g;
}

const GROUPS = { L1: l1, L2: l2, L3: l3, L4: l4, R1: r1, R2: r2 };
const DEFAULT = ['L1', 'L2', 'L3', 'L4'];                 // R1 and R2 (--rotate on) by --only
const MUTANTS = [['acc-still', ['L2', 'L4']], ['tilt-ignored', ['L3', 'L4']], ['no-rotinit', ['R1', 'R2']]];
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
  const names = a.only ? a.only.split(',') : DEFAULT;
  const unknown = names.filter((n) => !Object.hasOwn(GROUPS, n));
  // the default groups only, as before R1 and R2 (the header lists those)
  if (unknown.length) a.error(`--only: unknown group(s) ${unknown.join(', ')} (${DEFAULT.join(', ')})`);
  if (a.mutants) {
    const missed = [];
    for (const [m, groups] of MUTANTS) for (const name of groups.filter((n) => (a.only ? names : DEFAULT).includes(n))) {
      const g = runGroup(name, m), caught = g.problems.length > 0;
      console.log(`[${caught ? 'ok' : 'FAIL'}] mutant ${m} -> ${name}: ${g.problems.length} problem(s)${g.problems.length ? ': ' + g.problems[0].slice(0, 120) : ''}`);
      if (!caught) missed.push(`${m}/${name}`);
    }
    console.log(`${!missed.length ? 'all mutants detected' : `MISSED ${show(missed)}`} (${secs()} s)`);
    return missed.length ? 1 : 0;
  }
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
