// S-SUBJECT, subject detection's frames from S-SCENE's subjects (src/lab/subject.mjs, src/lab/scene.mjs subjectsAt):
//   subjectUnits (pure)  the rider's subject box against the pixels renderFrame draws for it, still and moving (its
//                        wrap); the box taken back through a DISP_FRAME transform and forward again; a record's four
//                        corners read back as FACE's converter reads them (0x50523fe3: centre and size)
//   subjectSession       bin/play.mjs on E143 with --a15 on and the moving scene's rider held still: with the camera's
//                        subject-detection setting (settings id 1682) at OFF no subject frame is drawn; at 1
//                        (MOTOR_SPORTS) DISP_FRAME draws a frame in its colour 3 along the rider's box as the panel shows
//                        it, and the status lists S-SUBJECT; at 4 (BIRD) the frame goes; the rider moving, each frame
//                        drawn lies on the rider at the scene time S-SUBJECT used, and the frame moves with it; at 0 it
//                        goes; --replay of the session log ends on the same frame
//   node emu/test/test_subject.mjs [--pure]
import fs from 'node:fs';
import path from 'node:path';
import * as SC from '../src/lab/scene.mjs';
import { transformOf, toMdet, corners } from '../src/lab/subject.mjs';

const J = path.resolve(new URL('..', import.meta.url).pathname);
// the rider alone, held still at its preset's distance (8 m), in focus
const riderScene = (speed = 0) => {
  const s = SC.applySceneChange(SC.defaultScene(), { preset: 'moving', layer: { index: 1, speed } });
  s.layers = s.layers.filter((l) => l.pattern === 'rider');
  return s;
};

// The bounding box [x0, y0, x1, y1] (pixels, x1 / y1 exclusive) of the rider renderFrame draws: its pixels brighter
// than the empty layer's black, above the ground strip (the rows whose first pixel is bright)
function drawnBox(frame) {
  const [w, h, rows] = frame, Y = (x, y) => rows[y][2 * x];
  let x0 = w, x1 = -1, y0 = h, ground = h;
  for (let y = 0; y < h; y++) {
    if (Y(0, y) > 50) { ground = Math.min(ground, y); continue; }
    for (let x = 0; x < w; x++) if (Y(x, y) > 50) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); }
  }
  return [x0, y0, x1 + 1, ground];
}

export function subjectUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const W = 324, H = 216, near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  // still, and moving at two times when the whole rider is in the frame (at 2.0 s through the layer's wrap)
  for (const [speed, t] of [[0, 0], [3, 0.4], [3, 2.0]]) {
    const sc = riderScene(speed);
    const subs = SC.subjectsAt(sc, t, H / W);
    const drawn = drawnBox(SC.renderFrame(sc, W, H, t, 1, 1));
    ok(subs.length === 1 && subs[0].subject === 'motorsports' && subs[0].layer === 'midground',
      `speed ${speed}, t ${t}: one motorsports subject, got ${JSON.stringify(subs)}`);
    const px = subs.length ? subs[0].box.map((v, i) => v * (i % 2 ? H : W)) : null;
    ok(px !== null && near(px, drawn, 1.5), `speed ${speed}, t ${t}: the subject box ${JSON.stringify(px?.map((v) => +v.toFixed(1)))} is the rider renderFrame draws ${JSON.stringify(drawn)}`);
  }
  ok(SC.subjectsAt(SC.defaultScene()).length === 0, 'the static preset has no subject');
  // DISP_FRAME's TFT transform for 4:3 (the table 0x60365754's first output, row 0: 900 x 600, x 10/8 + 50, y 10/8,
  // clip 50..850 x 0..600, D) as its 24 bytes
  const bytes = new Uint8Array(new Int16Array([900, 600, 10, 8, 10, 8, 50, 0, 50, 0, 850, 600]).buffer);
  const tr = transformOf(bytes);
  ok(tr.x.num === 10 && tr.x.den === 8 && tr.x.off === 50 && tr.y.off === 0 && tr.x.clip[1] === 850 && tr.y.clip[1] === 600, `the transform's fields: ${JSON.stringify(tr)}`);
  const fwd = (m) => [m[0] * 10 / 8 + 50, m[1] * 10 / 8, m[2] * 10 / 8 + 50, m[3] * 10 / 8];
  const plane = [306.25, 255, 596.25, 558.75], m = toMdet(plane, tr);
  ok(near(fwd(m), plane, 1), `a plane box back to MDET's coordinates and forward again: ${JSON.stringify(m)} -> ${JSON.stringify(fwd(m))}`);
  ok(JSON.stringify(toMdet([0, 100, 40, 200], tr)) === 'null', 'a box left of the clip rectangle has no record');
  ok(toMdet([10, -20, 300, 700], tr)[0] === 0 && toMdet([10, -20, 300, 700], tr)[1] === 0 && toMdet([10, -20, 300, 700], tr)[3] === 480, 'a box over the clip rectangle is clipped to it');
  // FACE's converter (0x50523fe3): centre x = w0 + (w2 - w0) / 2, centre y = w1 + (w5 - w1) / 2, width w2 - w0,
  // height w5 - w1, of the record's halfwords w0..w7
  const c = corners([204, 203, 436, 447]);
  ok(JSON.stringify([c[0] + (c[2] - c[0]) / 2, c[1] + (c[5] - c[1]) / 2, c[2] - c[0], c[5] - c[1]]) === '[320,325,232,244]', `the corners read back as FACE reads them: ${JSON.stringify(c)}`);
  return { checks, bad };
}

// The share of each edge of the panel box (x0, y0, x1, y1) that has a frame pixel of colour rgb within tol pixels of it
// (outside the 4:3 image area the frame is clipped: an edge there is checked at the clip), as [left, top, right, bottom]
function edgeCover(png, box, rgb, tol = 4, clip = [50, 0, 850, 600]) {
  const [w, h, rows] = png, is = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][3 * x] === rgb[0] && rows[y][3 * x + 1] === rgb[1] && rows[y][3 * x + 2] === rgb[2];
  const b = [Math.max(box[0], clip[0]), Math.max(box[1], clip[1]), Math.min(box[2], clip[2]), Math.min(box[3], clip[3])].map(Math.round);
  const band = (fixed, along, vertical) => {
    let hit = 0, n = 0;
    for (let a = along[0] + tol; a < along[1] - tol; a++) {
      n++;
      for (let d = -tol; d <= tol; d++) if (vertical ? is(fixed + d, a) : is(a, fixed + d)) { hit++; break; }
    }
    return n ? hit / n : 0;
  };
  return [band(b[0], [b[1], b[3]], true), band(b[1], [b[0], b[2]], false), band(b[2], [b[1], b[3]], true), band(b[3], [b[0], b[2]], false)];
}

export async function subjectSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-subject');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  process.env.OM_CHECK_OUT = out;
  const { withPlay } = await import('../checks/lib/playhttp.mjs');
  const { read_png } = await import('../checks/lib/png.mjs');
  const { LV_SCALED } = await import('../src/lab/display.mjs');
  const sha = (b) => Buffer.from(b).toString('base64').length + ':' + Buffer.from(b).subarray(-64).toString('hex');
  const png = (b) => { const f = path.join(out, 'f.png'); fs.writeFileSync(f, b); return read_png(f); };
  // the frame colour: DISP_FRAME's colour 3, grey 170 (its table 0x51016e3e, X: the drawn pixels)
  const GREY = [170, 170, 170];
  // the rider's box on the TFT at scene time t (the larger copy, while the moving layer wraps): S-SCENE's frame is
  // shown at LV_SCALED.tft
  const [[sw, sh], [pw, ph], [ox, oy]] = LV_SCALED.tft;
  const panelBox = (speed, t) => {
    const [s] = SC.subjectsAt(riderScene(speed), t, sh / sw).sort((a, b) => b.area - a.area);
    return s ? [ox + s.box[0] * pw, oy + s.box[1] * ph, ox + s.box[2] * pw, oy + s.box[3] * ph] : null;
  };
  // drawn: most of each edge (the GUI's items cover some of it: the exposure scale over the bottom edge, X)
  const drawn = (cover) => cover.every((c) => c >= 0.7), absent = (cover) => cover.every((c) => c < 0.2);
  const fmt = (c) => c.map((v) => v.toFixed(2)).join(' ');
  let last = null, dir = null;
  try {
    await withPlay('subject', ['--idle', 'off', '--a15', 'on', '--debug-api'], async (pl) => {
      dir = pl.out;
      await pl.input({ type: 'scene', change: { liveview: true, preset: 'moving', layer: { index: 1, speed: 0 } } });
      await pl.input({ type: 'token', token: 'WAIT:100' });
      await pl.key('s1', 'down'); await pl.key('s1', 'up');         // the date prompt goes, the shooting screen comes
      await pl.input({ type: 'token', token: 'WAIT:300' });
      const still = panelBox(0, 0);
      let [f] = await pl.frame();
      let s = await pl.status();
      ok(absent(edgeCover(png(f), still, GREY)) && !s.camapp?.subject && !s.stand_ins.includes('S-SUBJECT'),
        `setting OFF: no subject frame (${fmt(edgeCover(png(f), still, GREY))}), status ${JSON.stringify(s.camapp?.subject ?? null)}`);
      const set = await pl.input({ type: 'token', token: 'SET:1682=1' });
      ok(set.record?.set?.read_back === 1, `the setting reads back 1 (MOTOR_SPORTS): ${JSON.stringify(set.record?.set ?? set.error)}`);
      await pl.input({ type: 'token', token: 'WAIT:200' });
      [f] = await pl.frame();
      s = await pl.status();
      const sub = s.camapp?.subject;
      ok(sub?.kind === 1 && sub?.frames === 1 && sub?.aspect === 1 && sub?.device === 'tft' && s.stand_ins.includes('S-SUBJECT'),
        `setting 1: S-SUBJECT shows one frame of kind 1 at aspect code 1 (4:3) on the TFT: ${JSON.stringify(sub ?? null)}; S-SUBJECT listed ${s.stand_ins.includes('S-SUBJECT')}`);
      ok(drawn(edgeCover(png(f), still, GREY)), `setting 1: DISP_FRAME draws the frame on the rider's box ${JSON.stringify(still.map(Math.round))}: edges ${fmt(edgeCover(png(f), still, GREY))}`);
      await pl.input({ type: 'token', token: 'SET:1682=4' });
      await pl.input({ type: 'token', token: 'WAIT:200' });
      [f] = await pl.frame();
      s = await pl.status();
      ok(absent(edgeCover(png(f), still, GREY)) && s.camapp?.subject?.frames === 0, `setting 4 (BIRD): no frame on the rider (${fmt(edgeCover(png(f), still, GREY))}), ${JSON.stringify(s.camapp?.subject ?? null)}`);
      // the rider moving: each frame on the rider where the scene had it, the frame moving with it
      await pl.input({ type: 'token', token: 'SET:1682=1' });
      await pl.input({ type: 'scene', change: { layer: { index: 1, speed: 3 } } });
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await pl.input({ type: 'token', token: 'WAIT:150' });
        [f] = await pl.frame();
        s = await pl.status();
        const t = s.camapp?.subject?.t ?? null, box = t === null ? null : panelBox(3, t);
        const cover = box ? edgeCover(png(f), box, GREY) : [0, 0, 0, 0];
        // an edge outside the 4:3 image area is the clip's; an edge at the clip is checked there
        ok(box !== null && drawn(cover), `moving ${i}: the frame lies on the rider at scene time ${t}, box ${JSON.stringify(box?.map(Math.round))}: edges ${fmt(cover)}`);
        if (box) seen.push(`${Math.round(Math.max(box[0], 50))}..${Math.round(Math.min(box[2], 850))}`);
      }
      ok(seen.length === 3 && new Set(seen).size === 3, `the frame moves with the rider: its sides at ${JSON.stringify(seen)}`);
      await pl.input({ type: 'token', token: 'SET:1682=0' });
      await pl.input({ type: 'token', token: 'WAIT:200' });
      s = await pl.status();
      ok(s.camapp?.subject?.frames === 0, `setting OFF again: the frames go: ${JSON.stringify(s.camapp?.subject ?? null)}`);
      await pl.input({ type: 'token', token: 'SET:1682=1' });
      await pl.input({ type: 'token', token: 'WAIT:120' });
      [last] = await pl.frame();
    });
    const log = path.join(dir, 'session.json');
    await withPlay('subject-replay', ['--a15', 'on', '--debug-api', '--replay', log], async (pl) => {
      await pl.wait_phase((st) => st.phase === 'stopped' || st.phase === 'running', 120);
      const [f] = await pl.frame();
      ok(sha(f) === sha(last), 'the replay ends on the same frame');
    });
  } catch (e) { bad.push(`session: ${e.message.slice(0, 600)}`); }
  fs.rmSync(out, { recursive: true, force: true });
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['subject units', subjectUnits()]];
  if (!process.argv.includes('--pure')) rs.push(['subject session', await subjectSession()]);
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
