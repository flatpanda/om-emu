// The touch panel in play (src/lab/play.mjs H-TPINIT, S-TPREG and the touch input path; src/lab/touchpanel.mjs, the
// controllers by slave; docs/model-survey.md finding 74):
//   touchSession  (firmware) a play session on the TFT of the body of OM_EMU_MODEL (E143 by default) and a tap (down,
//                 up) on the shooting screen's touch mode icon, which cycles the touch shutter's mode: the touch
//                 driver must read the controller, HFW's callback must see the tap's press at the pixel tapped and its
//                 end there (CLICK or LIFTOFF), and the frame after the tap must differ from the one before (the icon
//                 of the next mode drawn) where it held for as long without a tap (the control); on a body whose
//                 driver arms itself at the display open (the E144 family) the touch init has run before the open
//                 (H-TPINIT); on a body of SCP_CELL, OK opens the super control panel and a tap in it must reach HFW at
//                 the pixel, change the frame (the cell tapped selected), held without a tap, and keep the panel's
//                 state
//   evfSession    (firmware) on a body of EVF_BODIES, play sessions started on the EVF, a tap as the code on the EVF
//                 says (docs/model-survey.md findings 113 to 116): E118, whose application closes the panel off the
//                 TFT, reads no report and HFW sees nothing; the others, with the AF Targeting Pad off (the store's
//                 default), read the tap's reports while the GUI's gesture mask on the EVF passes no press or tap
//                 (EVF_PAD's mask) and HFW sees nothing; with the pad on (its store id set to 1 before the GUI exists,
//                 S-PERSIST's seed, as the menu would set it) the mask is 0x1f1 and a tap inside the pad's area
//                 reaches HFW (a press at the pixel and its end), one left of the area (EVF_PAD's x0) nothing; no tap
//                 changes the frame or the GUI's state
//   node emu/test/test_touch.mjs   (with OM_EMU_MODEL=E144 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

// the touch mode icon on each body's TFT shooting screen, a pixel inside it (X: the start's frame after IDLE_MS, past
// the clock warning E137, E142, E140, E125, E130 and E133 show at their start; the icon at the left edge, a tap
// there cycles it, X: the frames after)
export const TOUCH_ICON = {
  E143: [35, 465], E148: [30, 372], E144: [40, 333], E139: [40, 333], E134: [40, 333], E137: [40, 333], E142: [40, 333],
  E140: [40, 333], E125: [40, 333], E130: [40, 333], E133: [40, 333], E118: [40, 333], E120: [40, 333], E122: [40, 333],
};
// a cell of the super control panel OK opens, the pixel the test taps (X: the panel's frame; the tap selects the AF
// Mode cell on the E118 family and Face Priority on E144, docs/model-survey.md findings 75 and 87)
export const SCP_CELL = { E144: [360, 240], E118: [360, 240], E120: [360, 240], E122: [360, 240] };
const IDLE_MS = 6000;
// the bodies besides E143 whose touch the test covers: every body with a touch panel the lab runs (src/fw/models.mjs
// touch not false, a touch driver: src/fw/facts.mjs touchDriver)
export const TOUCH_BODIES = Object.keys(TOUCH_ICON).filter((m) => m !== 'E143');
// The EVF touch pad of the bodies with an EVF whose application opens one (docs/model-survey.md findings 113 to 115):
// [the AF Targeting Pad's store id, which the GUI's gesture set reads on the EVF; the mask it sets there with the pad
// off; the left edge x0 of the pad's control area, which the application sets (x0..719, 0..479)]. D: the id at the
// GUI's set (the load before its "[GuiTouch] Set EVF Touch To ON" trace; E143's 1415 is the Custom menu's row "AF
// Targeting Pad", its menu data), the OFF branch's flags, the application's area (E122 0x50b80aa6, E144 0x50cedd96)
export const EVF_PAD = {
  E120: [867, 0x140, 290], E122: [1109, 0, 0], E144: [1417, 0x40, 290], E148: [1453, 0x40, 290], E139: [1416, 0x40, 290],
  E134: [1417, 0x40, 290], E137: [1418, 0x140, 290], E140: [1427, 0x40, 290], E125: [1425, 0x40, 290], E130: [1426, 0x140, 290],
};
// E118's application holds no EVF touch pad and closes the panel off the TFT's display states (finding 113)
export const EVF_BODIES = ['E118', ...Object.keys(EVF_PAD)];
const PAD_IN = [360, 240], PAD_OUT = [40, 333], PAD_ON_MASK = 0x1f1;

async function labEnv() {
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  return { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
}

export async function touchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { words_to_rgb } = await import('../src/lab/display.mjs');
  const { SCP_STATES } = await import('../src/lab/play.mjs');
  const env = await labEnv();
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  ok(s.touch_on, `${MODEL}: touch is on in the session`);
  s.idle_slice(lab.lab_time() + IDLE_MS * 1e6);
  const digest = () => { const [, , words] = s.frame('boundary'); return createHash('sha256').update(words_to_rgb(words)).digest('hex'); };
  const before = digest(), state0 = lab.state();
  // the control: the frame holds without a tap for as long as the tap is given below
  s.idle_slice(lab.lab_time() + 500e6);
  ok(digest() === before, `${MODEL}: the shooting screen's frame holds for 500 ms without a tap`);
  const [x, y] = TOUCH_ICON[MODEL];
  const g0 = lab.gestures.length, r0 = lab.tp_reads.length;
  for (const action of ['down', 'up']) s.touch(action, x, y);
  s.idle_slice(lab.lab_time() + 500e6);
  while (s.pending_touch()) s.touch_gui_step();
  const reads = lab.tp_reads.slice(r0), gestures = lab.gestures.slice(g0).map((g) => [g.name, g.x, g.y]);
  ok(reads.length >= 2 && reads.some(([, , , data]) => /[1-9a-f]/.test(data)), `${MODEL}: the driver read the controller's report (${JSON.stringify(reads)})`);
  ok(gestures.some(([n, gx, gy]) => n === 'PRESS' && gx === x && gy === y), `${MODEL}: HFW saw the press at ${x},${y} (${JSON.stringify(gestures)})`);
  ok(gestures.some(([n, gx, gy]) => (n === 'CLICK' || n === 'LIFTOFF') && gx === x && gy === y), `${MODEL}: HFW saw the tap's end at ${x},${y} (${JSON.stringify(gestures)})`);
  ok(lab.state() === state0, `${MODEL}: the GUI stays in its shooting state (0x${state0.toString(16)} -> 0x${lab.state().toString(16)})`);
  ok(digest() !== before, `${MODEL}: the tap on the touch mode icon changed the frame`);
  if (SCP_CELL[MODEL]) {
    const [cx, cy] = SCP_CELL[MODEL];
    s.key('ok', 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6);
    s.key('ok', 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6);
    const scp = lab.state(), panel = digest(), g1 = lab.gestures.length;
    ok(SCP_STATES.includes(scp), `${MODEL}: OK opened the super control panel (0x${scp.toString(16)})`);
    s.idle_slice(lab.lab_time() + 500e6);
    ok(digest() === panel, `${MODEL}: the panel's frame holds for 500 ms without a tap`);
    for (const action of ['down', 'up']) s.touch(action, cx, cy);
    s.idle_slice(lab.lab_time() + 500e6);
    while (s.pending_touch()) s.touch_gui_step();
    const g = lab.gestures.slice(g1).map((x) => [x.name, x.x, x.y]);
    ok(g.some(([n, gx, gy]) => n === 'PRESS' && gx === cx && gy === cy), `${MODEL}: HFW saw the panel tap's press at ${cx},${cy} (${JSON.stringify(g)})`);
    ok(lab.state() === scp && digest() !== panel, `${MODEL}: the tap in the panel changed its frame in its state (0x${scp.toString(16)} -> 0x${lab.state().toString(16)})`);
  }
  pl.close_session();
  return { checks, bad };
}

// One session started on the EVF of OM_EMU_MODEL, with the AF Targeting Pad on (pad) or as the store holds it
async function evfOnce(pad, ok) {
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { words_to_rgb } = await import('../src/lab/display.mjs');
  const { PlaySession, TP_MASK_WORD } = await import('../src/lab/play.mjs');
  const env = await labEnv();
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'evf' }, env);
  const [sid, offMask, x0] = EVF_PAD[MODEL] ?? [null, null, null];
  const what = `${MODEL} EVF, pad ${pad ? 'on' : 'off'}`;
  const created = PlaySession.prototype.lab_created;
  // the pad's store id set to 1 before the GUI exists, through the firmware's property set (S-PERSIST's seed)
  if (pad) PlaySession.prototype.lab_created = function (lab) { created.call(this, lab); lab.seed = new Map([[sid, 1]]); };
  try { pl.open_session(); } finally { PlaySession.prototype.lab_created = created; }
  const s = pl.session, lab = s.lab;
  try {
    ok(s.touch_on && s.device === 'evf', `${what}: a session on the EVF with touch on`);
    if (pad) ok(lab.store_log.persist.some((p) => p.id === sid && p.why === 'seed' && p.before === 0 && p.after === 1), `${what}: the pad's store id ${sid} set from 0 to 1 (${JSON.stringify(lab.store_log.persist)})`);
    s.idle_slice(lab.lab_time() + IDLE_MS * 1e6);
    const digest = () => { const [, , words] = s.frame('boundary'); return createHash('sha256').update(words_to_rgb(words)).digest('hex'); };
    const before = digest(), state0 = lab.state();
    s.idle_slice(lab.lab_time() + 500e6);
    ok(digest() === before, `${what}: the frame holds for 500 ms without a tap`);
    const mask = lab.sim.u32(TP_MASK_WORD);
    if (sid !== null) ok(mask === (pad ? PAD_ON_MASK : offMask), `${what}: the GUI's gesture mask on the EVF is 0x${mask.toString(16)}, want 0x${(pad ? PAD_ON_MASK : offMask).toString(16)}`);
    const tap = ([x, y]) => {
      const g0 = lab.gestures.length, r0 = lab.tp_reads.length;
      for (const action of ['down', 'up']) s.touch(action, x, y);
      s.idle_slice(lab.lab_time() + 500e6);
      while (s.pending_touch()) s.touch_gui_step();
      return [lab.tp_reads.slice(r0), lab.gestures.slice(g0).map((g) => [g.name, g.x, g.y])];
    };
    const [reads, gestures] = tap(PAD_IN);
    const [x, y] = PAD_IN;
    if (sid === null) {
      ok(reads.length === 0, `${what}: the closed panel's tap is not read (${JSON.stringify(reads)})`);
      ok(gestures.length === 0, `${what}: HFW sees no gesture (${JSON.stringify(gestures)})`);
    } else {
      ok(reads.length >= 2 && reads.some(([, , , data]) => /[1-9a-f]/.test(data)), `${what}: the driver read the tap's reports (${JSON.stringify(reads)})`);
      if (!pad) ok(gestures.length === 0, `${what}: HFW sees no gesture under the mask 0x${offMask.toString(16)} (${JSON.stringify(gestures)})`);
      else {
        ok(gestures.some(([n, gx, gy]) => n === 'PRESS' && gx === x && gy === y), `${what}: HFW saw the press at ${x},${y} inside the pad (${JSON.stringify(gestures)})`);
        ok(gestures.some(([n]) => n === 'CLICK' || n === 'LIFTOFF'), `${what}: HFW saw the tap's end (${JSON.stringify(gestures)})`);
        if (x0 > 0) {
          const [, out] = tap(PAD_OUT);
          ok(out.length === 0, `${what}: a tap at ${PAD_OUT} left of the pad's area (x0 ${x0}) reaches HFW as nothing (${JSON.stringify(out)})`);
        }
      }
    }
    ok(lab.state() === state0 && digest() === before, `${what}: the GUI's state and the frame are unchanged (0x${state0.toString(16)} -> 0x${lab.state().toString(16)})`);
  } finally { pl.close_session(); }
}

export async function evfSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  if (!EVF_BODIES.includes(MODEL)) throw new Error(`${MODEL}: not a body of EVF_BODIES`);
  await evfOnce(false, ok);
  if (EVF_PAD[MODEL]) await evfOnce(true, ok);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const r = await touchSession();
  if (EVF_BODIES.includes(MODEL)) { const e = await evfSession(); r.checks += e.checks; r.bad.push(...e.bad); }
  console.log(`touch in play: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
