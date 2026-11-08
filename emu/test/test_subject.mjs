// Subject detection's frames from S-SCENE's subjects (src/lab/subject.mjs, src/lab/scene.mjs subjectsAt; on E143 drawn
// from MDET's own frame table, src/lab/mdet.mjs, docs/om1-subject-spec.md 5.5):
//   subjectUnits (pure)  the rider's subject box against the pixels renderFrame draws for it, still and moving (its
//                        wrap); the race preset's racers and their helmets against theirs, two subjects apart; the box
//                        taken back through a DISP_FRAME transform and forward again; a record's four corners read back
//                        as FACE's converter reads them (0x50523fe3: centre and size)
//   subjectSession       bin/play.mjs on E143 with --a15 on and the moving scene's rider held still: with the camera's
//                        subject-detection setting (settings id 1682) at OFF no subject frame is drawn; at 1
//                        (MOTOR_SPORTS) none for the first offers (MDET's stabilisation registers the track at its
//                        seventh run, the firmware's delay), then DISP_FRAME draws a frame in its colour 3 along the
//                        rider's box as the panel shows it, from MDET's own frame table (the status's source, its
//                        writer's runs counted, S-SUBJECT not listed); at 16:9 and 3:4 the frame follows the aspect
//                        (LAF's pair from the offer's aspect code, the letterbox's clip); on the EVF it lands on the
//                        rider too; at 4 (BIRD) the frame goes; the rider moving, each frame drawn lies on the rider at
//                        the scene time of the offer whose result the table holds, and the frame moves with it; at 0 it
//                        goes; --replay of the session log ends on the same frame
//   subjectRaceSession   a headless Player on E143 with the race preset's two racers held still: no frame after six
//                        offers, then two frames, each on its racer, MDET's subjects with their helmets; at OFF none
//   subjectStandInSession  a headless Player on E143 with the mdet facts taken away (a body where MDET_DL does not run
//                        natively): S-SUBJECT writes the frame table, the frame drawn on the still rider at once, the
//                        status's source S-SUBJECT's, no MDET request; at OFF the frame goes
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
// the race preset's two racers held still (name: that layer alone)
const raceScene = (name = null) => {
  let s = SC.applySceneChange(SC.defaultScene(), { preset: 'race' });
  s = SC.applySceneChange(s, { layer: { index: 1, speed: 0 } });
  s = SC.applySceneChange(s, { layer: { index: 2, speed: 0 } });
  if (name) s.layers = s.layers.filter((l) => l.name === name);
  return s;
};

// The bounding box [x0, y0, x1, y1] (pixels, x1 / y1 exclusive) of the rider renderFrame draws: its pixels brighter
// than the empty layer's black (than min: a brighter part of it), above the ground strip (the rows whose first pixel
// is bright)
function drawnBox(frame, min = 50) {
  const [w, h, rows] = frame, Y = (x, y) => rows[y][2 * x];
  let x0 = w, x1 = -1, y0 = h, y1 = -1, ground = h;
  for (let y = 0; y < h; y++) {
    if (Y(0, y) > 50) { ground = Math.min(ground, y); continue; }
    for (let x = 0; x < w; x++) if (Y(x, y) > min) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; }
  }
  return [x0, y0, x1 + 1, min === 50 ? ground : y1 + 1];
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
  // the race preset: each racer alone, its subject box and its helmet's (the brightest pixels: white, Y above 225)
  // against what renderFrame draws; both racers in one scene are two subjects with a helmet each, apart
  for (const name of ['far', 'near']) {
    const sc = raceScene(name), [sub] = SC.subjectsAt(sc, 0, H / W), f = SC.renderFrame(sc, W, H, 0, 1, 1);
    const px = (b) => b.map((v, i) => v * (i % 2 ? H : W));
    ok(sub?.subject === 'motorsports' && sub.layer === name && near(px(sub.box), drawnBox(f), 1.5) && sub.parts.helmet && near(px(sub.parts.helmet), drawnBox(f, 225), 1.5),
      `race, ${name}: the subject box ${JSON.stringify(sub && px(sub.box).map(Math.round))} and its helmet ${JSON.stringify(sub?.parts?.helmet && px(sub.parts.helmet).map(Math.round))} are the racer and helmet drawn ${JSON.stringify(drawnBox(f))} ${JSON.stringify(drawnBox(f, 225))}`);
  }
  const both = SC.subjectsAt(raceScene(), 0, H / W);
  ok(both.length === 2 && both.every((x) => x.parts.helmet) && (both[0].box[2] <= both[1].box[0] || both[1].box[2] <= both[0].box[0]),
    `race: two motorsport subjects side by side, each with its helmet: ${JSON.stringify(both.map((x) => x.box.map((v) => +v.toFixed(3))))}`);
  ok(JSON.stringify(SC.subjectsAt(riderScene(0), 0, H / W)[0].parts) === '{}', 'the rider has no part');
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
  return edgeCoverBy(is, box, tol, clip);
}
// The same over a predicate is(x, y): the pixel is the frame's
function edgeCoverBy(is, box, tol = 4, clip = [50, 0, 850, 600]) {
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
  const panelBox = (speed, t) => {
    const [[sw, sh], [pw, ph], [ox, oy]] = LV_SCALED.tft;
    const [s] = SC.subjectsAt(riderScene(speed), t, sh / sw).sort((a, b) => b.area - a.area);
    return s ? [ox + s.box[0] * pw, oy + s.box[1] * ph, ox + s.box[2] * pw, oy + s.box[3] * ph] : null;
  };
  // S-SCENE's frame step (play.mjs SCENE_STEP_NS), S-TAKEMDET's offer pace, rounded up to whole milliseconds
  const STEP_MS = 67;
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
      // S-TAKEMDET offers a frame at most once per tick and per 1/15 s of lab time, and a WAIT is one tick: one WAIT of
      // one frame step per offer. Three offers: MDET reports nothing before its seventh run (spec 5.4), so no frame yet
      const offer = async (n) => { for (let i = 0; i < n; i++) await pl.input({ type: 'token', token: `WAIT:${STEP_MS}` }); };
      await offer(3);
      [f] = await pl.frame();
      s = await pl.status();
      ok(absent(edgeCover(png(f), still, GREY)) && s.camapp?.subject?.frames === 0 && s.camapp?.mdet?.offers >= 2,
        `setting 1, the first offers: no frame before MDET registers the track (${fmt(edgeCover(png(f), still, GREY))}), ${JSON.stringify(s.camapp?.subject ?? null)}, offers ${s.camapp?.mdet?.offers}`);
      await offer(5);
      [f] = await pl.frame();
      s = await pl.status();
      const sub = s.camapp?.subject;
      ok(sub?.source === 'mdet' && sub?.kind === 1 && sub?.frames === 1 && sub?.aspect === 1 && sub?.device === 'tft' && sub?.writes > 0,
        `setting 1: MDET's own frame table holds one frame of kind 1 at aspect code 1 (4:3) on the TFT, written by its writer: ${JSON.stringify(sub ?? null)}`);
      ok(!s.stand_ins.includes('S-SUBJECT') && s.stand_ins.includes('S-TAKEMDET') && s.stand_ins.includes('S-TAKEFRAME'),
        `setting 1: S-SUBJECT not listed (it wrote nothing), S-TAKEMDET and S-TAKEFRAME listed: ${s.stand_ins.filter((x) => /SUBJECT|MDET|TAKEFRAME/.test(x))}`);
      ok(drawn(edgeCover(png(f), still, GREY)), `setting 1: DISP_FRAME draws the frame on the rider's box ${JSON.stringify(still.map(Math.round))}: edges ${fmt(edgeCover(png(f), still, GREY))}`);
      // the still aspects 16:9 and 3:4 (settings id 269: DISP_FRAME's aspect codes 3 and 9): LAF's pair follows the
      // offers' code, and the frame the letterbox's clip (the TFT's rows: 16:9 clip y 47..553, 3:4 clip x 225..675)
      for (const [value, clip] of [[3, [0, 47, 900, 553]], [9, [225, 0, 675, 600]]]) {
        await pl.input({ type: 'token', token: `SET:269=${value}` });
        await offer(2);
        [f] = await pl.frame();
        s = await pl.status();
        const cover = edgeCover(png(f), still, GREY, 4, clip);
        ok(s.camapp?.subject?.aspect === value && s.camapp.subject.frames === 1 && drawn(cover),
          `aspect code ${value}: the frame on the rider within the clip ${JSON.stringify(clip)}: edges ${fmt(cover)}, ${JSON.stringify(s.camapp?.subject ?? null)}`);
      }
      await pl.input({ type: 'token', token: 'SET:269=1' });
      await offer(1);
      await pl.input({ type: 'token', token: 'SET:1682=4' });
      await pl.input({ type: 'token', token: 'WAIT:200' });
      [f] = await pl.frame();
      s = await pl.status();
      ok(absent(edgeCover(png(f), still, GREY)) && s.camapp?.subject?.frames === 0, `setting 4 (BIRD): no frame on the rider (${fmt(edgeCover(png(f), still, GREY))}), ${JSON.stringify(s.camapp?.subject ?? null)}`);
      // the rider moving at 3 m/s (about 32 panel pixels per offer; it wraps across the panel every 2.25 s of scene time,
      // and MDET registers each new track after six hits): one offer per WAIT until three frames are drawn while the
      // rider is wholly inside the 4:3 image area, each on the rider at the scene time of the offer whose result the
      // table holds or of the one before: the published frame shows DISP_FRAME's buffer latched at the display boundary
      // it was composed at, and the published status can follow an offer made in the tick at that boundary, whose
      // buffer awaits the next one (spec 5.5); the frame moving with it
      await pl.input({ type: 'token', token: 'SET:1682=1' });
      await pl.input({ type: 'scene', change: { layer: { index: 1, speed: 3 } } });
      const seen = [];
      for (let i = 0; i < 60 && seen.length < 3; i++) {
        await offer(1);
        [f] = await pl.frame();
        s = await pl.status();
        const t = s.camapp?.subject?.t ?? null;
        if (!s.camapp?.subject?.frames || t === null) continue;
        const cand = [t, t - 1 / 15].map((u) => [u, panelBox(3, u)]).filter(([, b]) => b && b[0] >= 50 && b[2] <= 850);
        if (cand.length < 2) continue;
        const covers = cand.map(([u, b]) => [u, b, edgeCover(png(f), b, GREY)]), hit = covers.find(([, , c]) => drawn(c));
        ok(hit, `moving ${seen.length}: the frame lies on the rider at scene time ${t} or one offer before: ${covers.map(([u, b, c]) => `${u.toFixed(3)} box ${JSON.stringify(b.map(Math.round))} edges ${fmt(c)}`).join('; ')}`);
        if (hit) seen.push(`${Math.round(hit[1][0])}..${Math.round(hit[1][2])}`);
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

// A headless Player on E143 with the moving scene's rider held still on the live view (race: the race preset's two
// racers instead, both held still), the date prompt gone; device: the output it starts on; mdet: false takes the mdet
// facts away before the session opens (the CamApp reads them once, at its construction) and puts them back after.
// fn({pl, s, idle, cover, boxes, ok}): boxes, the subjects' boxes on that output's panel, the larger first; cover(i)
// composes a frame and gives the share of each edge of box i (default 0) with DISP_FRAME's colour 3 as the composite's
// word (Cr 128, Cb 128, Y 170) on that output (the EVF's plane drawn at twice its size, its 4:3 area the whole panel)
async function inProcess(what, { device = 'tft', mdet = true, race = false }, fn) {
  const bad = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) bad.push(msg); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const { LV_SCALED } = await import('../src/lab/display.mjs');
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
  const facts = MODEL_INFO.mdet, GREY = (128 << 16) | (128 << 8) | 170;
  try {
    if (!mdet) delete MODEL_INFO.mdet;
    try { pl.open_session(); } finally { MODEL_INFO.mdet = facts; }
    const s = pl.session, lab = s.lab;
    const idle = (ms) => s.idle_slice(lab.lab_time() + ms * 1e6);
    const [[sw, sh], [pw, ph], [ox, oy]] = LV_SCALED[device];
    const boxes = SC.subjectsAt(race ? raceScene() : riderScene(0), 0, sh / sw).sort((a, b) => b.area - a.area)
      .map((r) => [ox + r.box[0] * pw, oy + r.box[1] * ph, ox + r.box[2] * pw, oy + r.box[3] * ph]);
    const clip = device === 'evf' ? [0, 0, 1600, 1200] : [50, 0, 850, 600];
    const cover = (i = 0) => { const [w, h, words] = s.frame('boundary', false); return edgeCoverBy((x, y) => x >= 0 && y >= 0 && x < w && y < h && words[y * w + x] === GREY, boxes[i], 4, clip); };
    if (race) {
      s.scene_input({ liveview: true, preset: 'race' });
      s.scene_input({ layer: { index: 1, speed: 0 } });
      s.scene_input({ layer: { index: 2, speed: 0 } });
    } else s.scene_input({ liveview: true, preset: 'moving', layer: { index: 1, speed: 0 } });
    idle(100);
    s.key('s1', 'down'); s.camapp.pump(); idle(100); s.key('s1', 'up'); s.camapp.pump();
    idle(300);
    await fn({ pl, s, idle, cover, boxes, ok });
  } catch (e) { bad.push(`${what}: ${e.stack.slice(0, 900)}`); }
  try { pl.close_session(); } catch { /* closed */ }
  return { checks, bad };
}

// Two racers (S-SCENE's race preset, held still): no frame after six offers (MDET's stabilisation registers a new
// track at its seventh run), two frames, each on its racer, after the eighth (the seventh's frame drawn into
// DISP_FRAME's other buffer, spec 5.5), from MDET's table of two list records (each racer's helmet combined
// with its body, test_mdet.mjs; the list frames are the bodies'); OFF: both go
export async function subjectRaceSession() {
  return inProcess('race session', { race: true }, ({ pl, s, idle, cover, boxes, ok }) => {
    const m = s.camapp.mdet, upTo = (n) => { for (let i = 0; i < 20 && m.offers < n; i++) idle(70); return m.offers; };
    s.step('SET:1682=1');
    const n6 = upTo(6), c0 = [cover(0), cover(1)], st0 = s.camapp.status().subject;
    ok(boxes.length === 2 && n6 === 6 && st0?.frames === 0 && c0.every((c) => c.every((v) => v < 0.2)),
      `the race, ${n6} offers: no frame yet: edges ${c0.map((c) => c.map((v) => v.toFixed(2)))}, ${JSON.stringify(st0 ?? null)}`);
    upTo(8);
    const c1 = [cover(0), cover(1)], st1 = s.camapp.status().subject, subs = s.camapp.mdet.subjects();
    ok(st1?.source === 'mdet' && st1.frames === 2 && subs.length === 2 && subs.every((x) => x.parts[1][5] === 1) && c1.every((c) => c.every((v) => v >= 0.7)),
      `the race: two frames, each on its racer ${JSON.stringify(boxes.map((b) => b.map(Math.round)))}: edges ${c1.map((c) => c.map((v) => v.toFixed(2)))}, ${JSON.stringify(st1 ?? null)}, ${subs.length} subjects with parts`);
    s.step('SET:1682=0');
    idle(100);
    const c2 = [cover(0), cover(1)];
    ok(s.camapp.status().subject?.frames === 0 && c2.every((c) => c.every((v) => v < 0.2)) && !pl.stand_ins_in_use().includes('S-SUBJECT'),
      `OFF: both frames go: edges ${c2.map((c) => c.map((v) => v.toFixed(2)))}`);
  });
}

// The EVF (a session started on it): MDET's frame on the rider, after its seven offers (one per idle slice of a frame
// step)
export async function subjectEvfSession() {
  return inProcess('EVF session', { device: 'evf' }, ({ pl, s, idle, cover, ok }) => {
    s.step('SET:1682=1');
    for (let i = 0; i < 9; i++) idle(70);
    const c = cover(), st = s.camapp.status().subject;
    ok(s.device === 'evf' && st?.source === 'mdet' && st.device === 'evf' && st.frames === 1 && c.every((v) => v >= 0.7) && !pl.stand_ins_in_use().includes('S-SUBJECT'),
      `the EVF: MDET's frame on the rider: edges ${c.map((v) => v.toFixed(2))}, ${JSON.stringify(st ?? null)}`);
  });
}

// S-SUBJECT where MDET_DL does not run natively: no body is so today (E143 gives both the subject and the mdet facts),
// so the session takes the mdet facts away
export async function subjectStandInSession() {
  return inProcess('stand-in session', { mdet: false }, ({ pl, s, idle, cover, ok }) => {
    ok(s.camapp.mdet === null && s.camapp.subject !== null, 'the CamApp has S-SUBJECT and no MDET_DL');
    s.step('SET:1682=1');
    idle(100);
    const c1 = cover(), st = s.camapp.status().subject;
    ok(st?.source === 's-subject' && st.frames === 1 && st.kind === 1 && c1.every((c) => c >= 0.7) && pl.stand_ins_in_use().includes('S-SUBJECT') && !pl.stand_ins_in_use().includes('S-TAKEMDET'),
      `MOTOR_SPORTS: S-SUBJECT's frame on the rider at once: edges ${c1.map((v) => v.toFixed(2))}, ${JSON.stringify(st ?? null)}`);
    s.step('SET:1682=0');
    idle(100);
    const c0 = cover();
    ok(s.camapp.status().subject?.frames === 0 && c0.every((c) => c < 0.2), `OFF: the frame goes: edges ${c0.map((v) => v.toFixed(2))}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['subject units', subjectUnits()]];
  if (!process.argv.includes('--pure')) {
    rs.push(['subject session', await subjectSession()], ['subject frames on the EVF', await subjectEvfSession()], ['two racers\' frames', await subjectRaceSession()],
      ['S-SUBJECT without MDET_DL', await subjectStandInSession()]);
  }
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
