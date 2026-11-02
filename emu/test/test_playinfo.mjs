// INFO's still information in playback (src/lab/camapp.mjs still_record: S-PLAYSEQ's getStillInfo and getHistogram,
// S-PLAYCOMP's getStillInfo, S-CARD's capture record; docs/model-survey.md findings 57 and 80):
//   playInfoSession  (firmware) a play session on the body of OM_EMU_MODEL (E143 by default): start, S1, S2 (one
//                    picture), PLAY and INFO, each step's GUI state checked, and the GUI's still information record as
//                    the firmware's own converter (fact play.still's convert: src/fw/facts.mjs stillFields) fills it,
//                    read at the converter's last return. Where PlyCom asks the play module (the E118 family:
//                    S-PLAYSEQ's answer to the synchronous request 3) or the play component (E143's, E146's, E147's and
//                    the E144 family's PlyCom: S-PLAYCOMP's answer in the component's struct), the record is the
//                    picture's own: the date the camera's clock gave at the capture (its read called again here,
//                    camapp's clock(): the clock is not set in the lab, so each build's default), the size of its
//                    file's JPEG (S-RECFILE, read back from the card by refs/volume.mjs and decoded by refs/jpeg.mjs),
//                    the focal length of the lens at the capture (S-LENS's zoom step or the native lens's, in tenths of
//                    a mm; 0 on a body with a built-in lens, whose focal length the lab does not read) and the
//                    release's exposure time (1/125 s without S-SCENE); and the histogram request answered empty
//   node emu/test/test_playinfo.mjs   (with OM_EMU_MODEL=E122 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

// the GUI's still information record (OlyHfwOpePlyCom's dump 0x50acd02d names the fields: createDate.year +0, month
// +2, date +3, hour +4, minute +5, pictureSize +8 / +10, expTime +40 / +44, focalLength +56; D, src/fw/facts.mjs
// stillFields)
const GUI = { year: 0, month: 2, day: 3, width: 8, height: 10, exp: 40, focal: 56 };
// a start that waits at a prompt S1 does not leave: the keys that answer it (bin/modelcheck.mjs START_PROMPT: E132's
// date and time setting has no Cancel, UP and OK five times set the clock; E145's and E129's S1 leaves theirs)
const START_KEYS = { E132: ['up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok', 'up', 'ok'] };
export async function playInfoSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand } = await import('../bin/run.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A, MODEL, fact } = await import('../src/fw/model.mjs');
  const { STILL_E143 } = await import('../src/fw/facts.mjs');
  const { LENS_MOUNT } = await import('../src/lab/camapp.mjs');
  const { openVolume } = await import('../refs/volume.mjs');
  const { decodeJpeg } = await import('../refs/jpeg.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), inflate: (b) => new Uint8Array(zlib.inflateSync(b)) };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, device: 'tft' }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  // the converter's calls: the GUI's record as the converter leaves it, read at its return (the record is the
  // caller's stack frame's)
  const calls = [], rd = (a, n) => lab.sim.read(a, n), still = fact('play.still', STILL_E143);
  if (!still) return { checks: 1, bad: [`${MODEL}: no still information layout (fact play.still ${JSON.stringify(still)})`] };
  lab.observe(still.convert, (l, r) => {
    const rec = r.a1 >>> 0, ret = r.mdr >>> 0;
    lab.hook_rt(ret, (h, rr) => { lab.hooks.delete(ret); calls.push(rd(rec, GUI.focal + 4)); lab.passthrough(rr); }, 'test still converter return');
  }, 'test still converter');
  const press = (k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 1200e6); };
  s.idle_slice(lab.lab_time() + 1500e6);
  for (const k of [...(START_KEYS[MODEL] ?? []), 's1', 's2', 'play']) press(k);
  ok(lab.state_names.get(lab.state()) === 'SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE', `${MODEL}: PLAY ${lab.state_names.get(lab.state())}`);
  const before = calls.length;
  press('info');
  ok(lab.state_names.get(lab.state()) === 'SS_PLAY_SINGLE/ID_ST_DISP_DETAIL', `${MODEL}: INFO ${lab.state_names.get(lab.state())}`);
  ok(calls.length > before, `${MODEL}: INFO converts the still information (${calls.length - before} calls)`);
  const img = s.camapp.images[0], log = [...s.steps.flatMap((x) => x.camapp ?? []), ...s.camapp.log];
  const answers = (kind) => log.filter(([k, d]) => k === kind && /^getStillInfo/.test(d)).length;
  if (!calls.length || !img) return { checks, bad: [...bad, `${MODEL}: no conversion or no picture (${calls.length}, ${s.camapp.images.length})`] };
  const b = calls[calls.length - 1], byte = (o) => b[o], u16 = (o) => b[o] | b[o + 1] << 8, u32 = (o) => (u16(o) | u16(o + 2) << 16) >>> 0;
  const got = { date: [u16(GUI.year), byte(GUI.month), byte(GUI.day)], size: [u16(GUI.width), u16(GUI.height)], exp: [u32(GUI.exp), u32(GUI.exp + 4)], focal: u32(GUI.focal) };
  // who answered: the play module (S-PLAYSEQ) or the component (S-PLAYCOMP), one of them
  const seq = answers('play'), comp = answers('playcomp');
  ok((seq > 0) !== (comp > 0), `${MODEL}: getStillInfo answered by one of S-PLAYSEQ (${seq}) and S-PLAYCOMP (${comp})`);
  // the picture's file read back independently: its JPEG's size
  const st = s.storage, vol = openVolume((lba, n) => st.card.read(lba, n)), f = st.files[0];
  const e = vol.find(f.path.slice(3).replaceAll('\\', '/')), jpeg = decodeJpeg(vol.data(e));
  ok(got.size.join('x') === `${jpeg.width}x${jpeg.height}`, `${MODEL}: the record's size ${got.size.join('x')}, the card's JPEG ${jpeg.width}x${jpeg.height}`);
  // the camera's clock now (it is not set in the lab: each build's default, which does not advance), as at the capture
  const clock = s.camapp.clock();
  ok(clock && got.date.join() === clock.date.slice(0, 3).join() && clock.date[0] > 0, `${MODEL}: the record's date ${got.date.join('-')}, the camera's clock ${clock?.date.join('-')} (status ${clock?.status})`);
  // the lens at the capture: a mounted one's focal length (S-LENS or the native lens), none with a built-in lens
  const lens = LENS_MOUNT || !!s.lens;
  ok(got.focal === (img.focal_mm ?? 0) * 10 && (img.focal_mm > 0) === lens, `${MODEL}: the record's focal length ${got.focal / 10} mm, the lens's at the capture ${img.focal_mm} mm (${lens ? 'a mounted lens' : 'a built-in lens'})`);
  ok(got.exp.join('/') === '1/125', `${MODEL}: the record's exposure time ${got.exp.join('/')} s`);
  // the histogram request answered empty where the play module answers: no bars from another answer's bytes
  if (seq) {
    const res = lab.sim.u32(A(0x60360C88)) >>> 0, hist = lab.sim.read(res + 4, 12);
    ok(hist.every((x) => x === 0), `${MODEL}: the histogram's flag and first bins 0: ${[...hist].join(' ')}`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await playInfoSession();
  console.log(`INFO's still information: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
