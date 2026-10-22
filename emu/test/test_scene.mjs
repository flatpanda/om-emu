// S-SCENE, the image sensor stand-in (src/lab/scene.mjs) and its live view in the player (src/lab/play.mjs scene_*):
//   sceneUnits (pure)  the exposure triangle (auto puts mid-grey at mid-grey, a stop of aperture is a stop of exposure,
//                      manual over- and underexposes), the circle of confusion (zero at the focus distance, growing
//                      away from it, smaller stopped down), the S1 focus on the layer under the AF point, every change
//                      checked (a refused change names its field), a frame the same for the same lab time and frame
//                      number and another for another time when a layer moves
//   sceneSession       bin/play.mjs with --a15 on: a scene input turns the live view on and the composite stays clean,
//                      the frame changes; S1 focuses (AF ok), S2 records a capture, REC twice a clip; a bad change is refused; the
//                      session log holds the accepted scene inputs, and --replay of it ends on the same frame
//   node emu/test/test_scene.mjs [--pure]
import fs from 'node:fs';
import path from 'node:path';
import * as SC from '../src/lab/scene.mjs';

const J = path.resolve(new URL('..', import.meta.url).pathname);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

export function sceneUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const base = SC.defaultScene();
  // exposure
  for (const [ev, N, iso] of [[12, 2.8, 200], [8, 1.4, 1600], [15, 8, 100]]) {
    const e = SC.exposureOf(SC.applySceneChange(base, { ev, aperture: N, iso }));
    const inRange = e.shutter_s > SC.LIVE_VIEW_SHUTTER[0] && e.shutter_s < SC.LIVE_VIEW_SHUTTER[1];
    ok(!inRange || near(e.exposure, 1, 1e-12), `auto exposure at EV ${ev} f/${N} ISO ${iso}: ${e.exposure} (shutter ${e.shutter_s})`);
  }
  const m = (c) => SC.exposureOf(SC.applySceneChange(base, { mode: 'manual', ...c }));
  ok(near(m({ aperture: 2.8, shutter_s: 1 / 125 }).exposure / m({ aperture: 4, shutter_s: 1 / 125 }).exposure, (4 / 2.8) ** 2), 'one stop of aperture is (4 / 2.8)^2 of exposure');
  ok(m({ ev: 12, aperture: 2.8, shutter_s: 1 }).clipped === 'over' && m({ ev: 2, aperture: 22, shutter_s: 1 / 8000 }).clipped === 'under', 'manual over- and underexposure are reported');
  // circle of confusion
  const lens = base.lens;
  ok(SC.cocMm(lens, lens.focus_m) === 0, 'no blur at the focus distance');
  ok(SC.cocMm(lens, 2) > SC.cocMm(lens, 4) && SC.cocMm(lens, 4) > 0, 'nearer than the focus: more blur closer in');
  ok(SC.cocMm({ ...lens, aperture: 8 }, 2) < SC.cocMm(lens, 2), 'stopped down: less blur');
  // S1's focus
  const post = SC.applySceneChange(base, { af_point: [0.72, 0.35] });
  ok(SC.focusAt(post) === 1.5, `the AF point on the signpost focuses at 1.5 m, got ${SC.focusAt(post)}`);
  ok(SC.focusAt(SC.applySceneChange(base, { af_point: [0.1, 0.05] })) === 200, 'the AF point on the sky focuses at the background');
  // refused changes
  for (const [c, want] of [[{ aperture: 0.9 }, /aperture 0\.9/], [{ preset: 'x' }, /preset "x"/], [{ bogus: 1 }, /unknown field "bogus"/],
    [{ layer: { index: 9, speed: 1 } }, /layer index 9/], [{ af_point: [2, 0] }, /af_point x 2/], [[1], /a change is an object/]]) {
    let got = 'accepted';
    try { SC.applySceneChange(base, c); } catch (e) { got = e.message; }
    ok(want.test(got), `refused ${JSON.stringify(c)}: ${got}`);
  }
  // frames
  const sha = (f) => f[2].reduce((h, r) => { for (let i = 0; i < r.length; i += 97) h = (Math.imul(h, 31) + r[i]) >>> 0; return h; }, 7);
  const a = SC.renderFrame(base, 162, 108, 1, 3, 1), b = SC.renderFrame(base, 162, 108, 1, 3, 1);
  ok(a[2].length === 108 && a[2][0].length === 324, 'a 162 x 108 frame is 108 rows of 324 bytes (4:2:2)');
  ok(sha(a) === sha(b), 'the same scene, time and frame number give the same frame');
  const moving = SC.applySceneChange(base, { preset: 'moving' });
  ok(sha(SC.renderFrame(moving, 162, 108, 0.5, 3, 1)) !== sha(SC.renderFrame(moving, 162, 108, 1.5, 3, 1)), 'a moving layer: another frame at another time');
  return { checks, bad };
}

export async function sceneSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-scene');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  process.env.OM_CHECK_OUT = out;
  const { withPlay } = await import('../checks/lib/playhttp.mjs');
  const sha = (b) => Buffer.from(b).toString('base64').length + ':' + Buffer.from(b).subarray(-64).toString('hex');
  let last = null, dir = null;
  try {
    await withPlay('scene', ['--idle', 'off', '--a15', 'on', '--debug-api'], async (pl) => {
      dir = pl.out;
      const [f0] = await pl.frame();
      await pl.input({ type: 'scene', change: { liveview: true } });
      await pl.input({ type: 'token', token: 'WAIT:100' });
      let s = await pl.status();
      const [f1] = await pl.frame();
      ok(s.frame_error === null && s.scene?.liveview === true, `live view on: frame_error ${s.frame_error}, scene ${JSON.stringify(s.scene ?? null).slice(0, 200)}`);
      ok(sha(f0) !== sha(f1), 'the frame shows the live view');
      ok(s.stand_ins.includes('S-SCENE') && s.stand_ins.includes('H-REQ'), `the status lists S-SCENE and H-REQ: ${s.stand_ins}`);
      await pl.input({ type: 'scene', change: { af_point: [0.72, 0.35], aperture: 1.2, mode: 'manual' } });   // auto: the camera's plan
      await pl.key('s1', 'down');
      await pl.key('s2', 'down');
      await pl.key('s2', 'up');
      await pl.key('s1', 'up');
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      await pl.input({ type: 'token', token: 'WAIT:500' });
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      s = await pl.status();
      const clip = s.scene.clips?.[0];
      ok(s.scene.clips?.length === 1 && clip.end_ns !== null && clip.seconds >= 0.5, `REC twice makes one clip of at least 0.5 s: ${JSON.stringify(s.scene.clips)}`);
      ok(s.scene.af === 'ok' && s.scene.lens.focus_m === 1.5, `S1 focuses on the signpost: AF ${s.scene.af}, focus ${s.scene.lens.focus_m}`);
      ok(s.scene.captures.length === 1 && s.scene.captures[0].aperture === 1.2, `S2 records one capture at f/1.2: ${JSON.stringify(s.scene.captures)}`);
      const r = await pl.input({ type: 'scene', change: { iso: 3 } }, true);
      ok(/scene: iso 3: a number from 64 to 102400/.test(r.error ?? ''), `a bad change is refused: ${r.error}`);
      await pl.input({ type: 'token', token: 'WAIT:100' });
      [last] = await pl.frame();
    });
    const log = path.join(dir, 'session.json');
    const doc = JSON.parse(fs.readFileSync(log, 'utf8'));
    ok(doc.inputs.filter((x) => x.input?.type === 'scene').length === 2, `the session log holds the 2 accepted scene inputs: ${doc.inputs.filter((x) => x.input?.type === 'scene').length}`);
    await withPlay('scene-replay', ['--a15', 'on', '--debug-api', '--replay', log], async (pl) => {
      await pl.wait_phase((st) => st.phase === 'stopped' || st.phase === 'running', 120);
      const [f] = await pl.frame();
      ok(sha(f) === sha(last), 'the replay ends on the same frame');
    });
  } catch (e) { bad.push(`session: ${e.message.slice(0, 600)}`); }
  fs.rmSync(out, { recursive: true, force: true });
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['scene units', sceneUnits()]];
  if (!process.argv.includes('--pure')) rs.push(['scene session', await sceneSession()]);
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
