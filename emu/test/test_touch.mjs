// The touch panel in play (src/lab/play.mjs H-TPINIT, S-TPREG and the touch input path; src/lab/touchpanel.mjs, the
// controllers by slave; docs/model-survey.md finding 74):
//   touchSession  (firmware) a play session on the TFT of the body of OM_EMU_MODEL (E143 by default) and a tap (down,
//                 up) on the shooting screen's touch mode icon, which cycles the touch shutter's mode: the touch
//                 driver must read the controller, HFW's callback must see the tap's press at the pixel tapped and its
//                 end there (CLICK or LIFTOFF), and the frame after the tap must differ from the one before (the icon
//                 of the next mode drawn); on a body whose driver arms itself at the display open (the E144 family)
//                 the touch init has run before the open (H-TPINIT); on a body of SCP_CELL, OK opens the super control
//                 panel and a tap in it must reach HFW at the pixel, change the frame (the cell tapped selected) and
//                 keep the panel's state
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

export async function touchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { words_to_rgb } = await import('../src/lab/display.mjs');
  const { SCP_STATES } = await import('../src/lab/play.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  ok(s.touch_on, `${MODEL}: touch is on in the session`);
  s.idle_slice(lab.lab_time() + IDLE_MS * 1e6);
  const digest = () => { const [, , words] = s.frame('boundary'); return createHash('sha256').update(words_to_rgb(words)).digest('hex'); };
  const before = digest(), state0 = lab.state();
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await touchSession();
  console.log(`touch in play: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
