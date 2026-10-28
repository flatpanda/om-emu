// S-SUBJECT: subject detection's frames on the display, from S-SCENE's subjects (docs/om1-subject-spec.md 5.1, step A
// of its plan; src/fw/models.mjs subject has the firmware's side with its evidence).
//
// On the camera, CPU 3's MDET runs the subject network on the DML engine, writes the detected subjects' boxes into its
// frame table and posts UP_FACE to the frame plane; DISP_FRAME (CPU 3 too) then reads the table through FACE's frame
// getter and MDET's (0x5052202c -> 0x5083a299) and draws the frames. In the lab DISP_FRAME runs natively on the lab CPU
// for each post to it (camapp.mjs S-DISPFRAME), and MDET, the DML engine and CPU 3 do not run. S-SUBJECT stands in for
// MDET at that seam (the spec's S1): while the camera's own subject-detection setting names a kind and S-SCENE's live
// view shows a subject of that kind, it writes MDET's frame table with the subjects' boxes as the network would have
// found them, and posts UP_FACE through the frame plane's own API; the getters, the transforms and the drawing are the
// firmware's. What it writes, field by field:
//   - each visible subject of the setting's kind as a list record (four corners, top left, top right, bottom left,
//     bottom right), up to the table's eight, larger subjects first; the main and part records' flags 0 (the writer
//     fills those only in MDET's state 0xa337f082 = 1, which is not decoded, ?), so DISP_FRAME draws list frames
//     (kind 1, colour 3, D: 0x5100dfef);
//   - the aspect pair whose code (the getter's map, D) equals the one DISP_FRAME computes for the frame (0x5100d469, run
//     natively), so draw_face takes the records (D: 0x5100d764..0x5100d778); MDET would derive it from the YC frame it
//     was offered (I);
//   - MDET's active byte (0x50839ed0's) at 1 while frames are shown, 0 after (the getter requires it, D);
//   - the frame mode with bit 1, the face / subject frames (D: 0x5039f583 maps TAKE's request 1 to it, DISP_FRAME draws
//     faces on it, 0x5100dc03): S-TAKEFRAME's mode 4 lacks it; TAKE's own live-view request (0x506d8dea) sets it unless
//     one of its conditions clears it (D), and when those hold in the lab is not read, so S-SUBJECT adds the bit while
//     it shows frames and takes it away after (I).
// The boxes: S-SCENE's subject boxes (scene.mjs subjectsAt, fractions of its frame) placed where the lab shows that
// frame on the panel (display.mjs LV_SCALED: the TH request's scaled size and offset), then into DISP_FRAME's plane (the
// TFT's plane is the panel's coordinates, the EVF's is drawn at twice its size: X, docs/om1-vsc-spec.md A19), clipped to
// the transform's clip rectangle and taken back through the transform DISP_FRAME will use (read from its table with
// the firmware's own index and row functions, D), so that DISP_FRAME's forward transform lands the frame on the subject
// as the panel shows it. S-SCENE's 3:2 frame fills the panel, wider than the camera's 4:3 image area on it (the TFT's
// x 50..850); a subject or the part of one outside that area is cut by the transform's clip (I: the camera's network
// would not see it there).
// When: after lab time passed (camapp.mjs tick), with the application started on its shooting screen and S-SCENE's
// live view showing the live scene (not the menu's stopped through image, a rec view or a played image); the table is
// written and posted when the boxes, the kind or the output change, at most every 1/15 s of lab time (S-SCENE's
// frame step). The setting is read through the firmware's property read, as TAKE reads it (D).
import { FirmwareError } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { LV_SCALED } from './display.mjs';
import * as SC from './scene.mjs';

export class SubjectError extends FirmwareError {}

// MDET's kinds (0x50338100: 0 OFF, 1 MOTOR_SPORTS, 2 AIRPLANE, 3 TRAIN, 4 BIRD, 5 ANIMAL, D) for scene.mjs's classes
export const KINDS = { 1: 'motorsports', 2: 'airplanes', 3: 'trains', 4: 'birds', 5: 'animals' };
// DISP_FRAME's plane in the panel's coordinates: the scale (X, docs/om1-vsc-spec.md A19: the TFT's plane 1:1, the
// EVF's 800-wide plane shown at 1600 x 1200)
export const PLANE_SCALE = { tft: 1, evf: 2 };
const STATE_SHOOTING = 0x0108, FRAME_MODE_FACE = 1;   // the GUI's shooting screen (camapp.mjs S-EXPOSE's); TAKE's bit
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// The transform DISP_FRAME applies to a frame record (0x500259bd) as {num, den, off, clip} per axis, from its 24 bytes
export function transformOf(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 24), h = (k) => dv.getInt16(2 * k, true);
  return { size: [h(0), h(1)], x: { num: h(2), den: h(3), off: h(6), clip: [h(8), h(10)] }, y: { num: h(4), den: h(5), off: h(7), clip: [h(9), h(11)] } };
}
// A box in plane coordinates [x0, y0, x1, y1] taken back through the transform to MDET's coordinates, clipped to the
// transform's clip rectangle first; null when nothing of it is inside
export function toMdet(box, t) {
  const back = (v, a) => Math.round(((v - a.off) * a.den) / a.num);
  const x0 = Math.max(box[0], t.x.clip[0]), x1 = Math.min(box[2], t.x.clip[1]);
  const y0 = Math.max(box[1], t.y.clip[0]), y1 = Math.min(box[3], t.y.clip[1]);
  if (!(x1 > x0 && y1 > y0)) return null;
  return [back(x0, t.x), back(y0, t.y), back(x1, t.x), back(y1, t.y)];
}
// A record's four corners as MDET's writer orders them (top left, top right, bottom left, bottom right)
export const corners = ([x0, y0, x1, y1]) => [x0, y0, x1, y0, x0, y1, x1, y1];

export class SubjectFrames {
  // session: the PlaySession; camapp: its CamApp (S-DISPFRAME's turns); f: the model's subject facts (its own
  // addresses, src/fw/models.mjs subject); frameModeSet(mode): S-TAKEFRAME's setter, frameModeBase its mode
  constructor(session, camapp, f, frameModeSet, frameModeBase) {
    this.s = session; this.camapp = camapp; this.f = f;
    this.frame_mode_set = frameModeSet; this.frame_mode_base = frameModeBase;
    this.mode_set = frameModeBase;   // the frame mode S-SUBJECT last asked for (S-TAKEFRAME's at the start)
    this.key = null;            // what the table holds: [kind, device, boxes, aspect] as JSON, or null when no frames are shown
    this.step = null;           // the scene step last looked at
    this.posts = 0;             // UP_FACE posts so far (the player lists S-SUBJECT once there is one)
    this.last = null;           // the last table written: { kind, device, aspect, t, frames: [[x0, y0, x1, y1] ...] }
  }
  get used() { return this.posts > 0; }
  // Whether the live scene is on the screen with the application on its shooting screen
  live() {
    const s = this.s, sc = s.scene;
    return !!(sc && sc.liveview && !s.through_off && !s.recview_hold && !s.playview_hold && s.lab.state() === STATE_SHOOTING);
  }
  call(fn, regs = null) { return this.s.lab.call(fn, regs, null, null, 2000000); }
  // The setting's kind, through the firmware's property read as TAKE reads it
  kind() { return this.call(this.f.prop_read, { d0: this.f.setting, a0: 0, d1: 0 }).d0 & 0xFF; }
  // After lab time passed
  tick() {
    const s = this.s;
    if (!this.camapp.started) return;
    if (!this.live()) { if (this.key !== null) this.clear('the live scene is not shown'); return; }
    const sc = s.scene, { step: n, t } = s.scene_step();
    const kind = this.kind();
    if (!Object.hasOwn(KINDS, kind)) { if (this.key !== null) this.clear(`the setting is ${kind}`); return; }
    const step = JSON.stringify([kind, sc.preset, sc.layers, sc.lens, n, s.device]);
    if (step === this.step) return;
    this.step = step;
    const frames = this.frames(kind, t);
    const key = JSON.stringify([kind, s.device, frames.boxes, frames.aspect]);
    if (key === this.key) return;
    if (!frames.boxes.length) { if (this.key !== null) this.clear('no subject of the kind in view'); return; }
    this.write(kind, frames);
    this.key = key;
  }
  // The frames for the subjects of the kind at time t (s): their boxes in MDET's coordinates, the larger first, and
  // the aspect code DISP_FRAME computes for the frame
  frames(kind, t) {
    const s = this.s, [src, size, off] = LV_SCALED[s.device], scale = PLANE_SCALE[s.device];
    const aspect = this.call(this.f.aspect_code).d0 & 0xFF;
    const pair = this.f.aspect_pairs[aspect];
    if (!pair) throw new SubjectError(`S-SUBJECT: DISP_FRAME's aspect code ${aspect} has no pair in MDET's getter (0x5083a368..0x5083a3f8)`);
    const tr = this.transform(aspect);
    const subjects = SC.subjectsAt(s.scene, t, src[1] / src[0]).filter((x) => x.subject === KINDS[kind]).sort((a, b) => b.area - a.area);
    const boxes = [];
    for (const { box: [u0, v0, u1, v1] } of subjects) {
      const plane = [off[0] + u0 * size[0], off[1] + v0 * size[1], off[0] + u1 * size[0], off[1] + v1 * size[1]].map((v) => v / scale);
      const m = toMdet(plane, tr);
      if (m !== null && boxes.length < this.f.table.max) boxes.push(m);
    }
    return { t, aspect, pair, boxes };
  }
  // DISP_FRAME's transform for the output it draws on and the aspect code: the table's pointer by the firmware's index
  // function, its row by the row function (src/fw/models.mjs subject.transform)
  transform(aspect) {
    const lab = this.s.lab, tf = this.f.transform;
    const state = this.call(this.f.state).d0 & 0xFF;
    const handle = lab.sim.u32(tf.object[1]);
    const obj = this.call(this.f.prop_read, { d0: tf.object[0], a0: handle, d1: 0 }).d0 & 0xFF;
    const dev = this.call(tf.device).d0 & 0xFF;
    const index = this.call(tf.index, { d0: state, a0: obj, d1: dev }).d0 & 0xFF;
    const row = this.call(tf.row, { d0: aspect }).d0 & 0xFF;
    const ptr = lab.sim.u32(tf.table + 4 * index);
    if (!ptr) throw new SubjectError(`S-SUBJECT: DISP_FRAME's transform table ${h8(tf.table)} has no pointer at index ${index}`);
    return transformOf(lab.sim.read(ptr + 24 * row, 24));
  }
  // MDET's table with the boxes as list records, its aspect pair and active byte, the frame mode's subject bit, and
  // UP_FACE
  write(kind, { t, aspect, pair, boxes }) {
    const lab = this.s.lab, tb = this.f.table;
    lab.sim.write(tb.main[0], Uint8Array.of(0));
    lab.sim.write(tb.part[0], Uint8Array.of(0));
    boxes.forEach((b, i) => lab.sim.write(tb.list + 16 * i, pack('<8H', ...corners(b))));
    lab.sim.write(tb.count, Uint8Array.of(boxes.length));
    lab.sim.write(this.f.aspect[0], Uint8Array.of(pair[0]));
    lab.sim.write(this.f.aspect[1], Uint8Array.of(pair[1]));
    lab.sim.write(this.f.active, Uint8Array.of(1));
    this.mode(true);
    this.post(`kind ${kind} (${KINDS[kind]}), aspect ${aspect}: ${boxes.length} frame(s) ${JSON.stringify(boxes)}`);
    this.last = { kind, device: this.s.device, aspect, t, frames: boxes };
  }
  // No frames: the table emptied and posted (DISP_FRAME erases the frames), the active byte 0, the mode back
  clear(why) {
    const lab = this.s.lab, tb = this.f.table;
    for (const a of [tb.main[0], tb.part[0], tb.count]) lab.sim.write(a, Uint8Array.of(0));
    this.post(`no frames: ${why}`);
    lab.sim.write(this.f.active, Uint8Array.of(0));
    this.mode(false);
    this.key = null; this.step = null;
    this.last = null;
  }
  // The frame mode with or without the subject bit, through the frame plane's setter as S-TAKEFRAME sets it
  mode(on) {
    const want = this.frame_mode_base | (on ? FRAME_MODE_FACE : 0);
    if (want === this.mode_set) return;
    this.mode_set = want;
    this.frame_mode_set(want);
  }
  post(what) {
    const s = this.s;
    this.call(this.f.up_face);
    s.settle('S-SUBJECT');
    this.posts += 1;
    this.camapp.log.push(['subject', what]);
    this.camapp.drain_cpu3();
  }
  // What is shown: the kind, the device, DISP_FRAME's aspect code, the scene time (s) of the boxes and the boxes in
  // MDET's coordinates; frames 0 when none
  status() {
    const l = this.last;
    return l === null ? { frames: 0 } : { kind: l.kind, device: l.device, aspect: l.aspect, t: l.t, frames: l.frames.length, boxes: l.frames };
  }
}
