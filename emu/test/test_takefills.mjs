// H-TAKEFILLS (src/lab/rec.mjs take_fills; src/fw/facts.mjs takeFills; docs/hle-gaps.md 4.3.13): TAKE's own fills of
// a still's shot natively, in the still states' order, on H-SHOTALLOC's shot and TAKE's context, in place of the parts
// of S-EXIFPRM that wrote what they write.
//   takeFillsSession  (firmware; the body of OM_EMU_MODEL: E143 by default, E146, E147, the bodies whose rule reads
//                     the fills) one session, two pictures with S-SCENE's live view: the first with H-TAKEFILLS taken
//                     out (S-EXIFPRM's copies, as before it), the second with it. The shot's record is read at the
//                     end of S-EXIFPRM each time and the two compared byte for byte. Checks: H-TAKEFILLS is in use and
//                     runs once, for the second picture, with no error log (take_fills throws on one); both files are
//                     on the card; the records differ only where TAKE's fills write (the halfwords that differ are
//                     listed, and pinned by count: 40 on each body); the record's clock (+37800, StlTake's capture fill's read
//                     now) and the EXIF set's dates are the camera's; the shot-record fill's fields REC_IMAGE reads
//                     equal the settings (exif_param's own check); and on E143 the key +38532 is the shot counter,
//                     setting 25380, under TAKE's context +3128, +38190 setting 41082, and the frame count +3088
//                     stepped to 1 from Standby's 0. Since 2026-11-17 takepic, the lens fill and the third fill run
//                     too (each once, the third fill's EXIF set the picture's one), takepic's AF maker-note fill
//                     answered by S-AFMKNT once with the crop areas the full frame; on E143 the lens fill sets the
//                     lens flag's bit 12 (+37982) and the focal length +38792 (120: 12 mm, S-LENSMCU's lens at its
//                     wide end), and takepic the white-balance mode +37992 and +37988 from settings 33057 and 33073
//                     (the frame count 1). Last (E143), the control for S-AFMKNT: takepic run natively without it on
//                     the third picture's shot reaches its AF maker-note fill's `calls (a1)` (0x508c9cdd) with a1 0,
//                     the word 0xa33b262c TAKE_FOCUS's release-take start sets (0x509a847a -> 0x508ca329), which the
//                     default session does not run.
//   node emu/test/test_takefills.mjs [--session]     (OM_EMU_MODEL=E143 | E146 | E147)
// Negative controls (X, 2026-11-16, E143): with the frame count's step taken out of take_fills the record is the
// same but the count stays 0 (the count check fails); with the shot-record fill's call taken out exif_param's check
// of the fields REC_IMAGE reads stops the picture.
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
// the halfwords of the record the fills change against S-EXIFPRM's copies (X); E143's fields (D, docs/hle-gaps.md 4.3.13)
// (40 on each before takepic, the lens fill and the third fill ran, 2026-11-16)
const DIFFS = { E143: 110, E146: 110, E147: 110 }, KEY = 38532, AE_SETTING = 41082, AE_AT = 38190, COUNTER = 25380, CTX_TIMER = 3128, COUNT = 3088;
const AF_CALLS = 0x508C9CDD, AF_WORD = 0xA33B262C, TAKEPIC = 0x503BCD51;
const LENS_FLAG = 37982, LENS_BIT = 0x1000, FOCAL = 38792, FOCAL_12MM = 120, WB = [[37992, 33057], [37988, 33073]];

export async function takeFillsSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const card = new SdCard();
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  t.model = MODEL;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, sim = lab.sim, rec = s.storage?.rec, F = rec?.fills;
    ok(!!F && pl.stand_ins_in_use().includes('H-TAKEFILLS'), `${MODEL}: H-TAKEFILLS is in use (a body whose rule reads TAKE's fills: fact take_fills)`);
    if (!F) return t;
    const run = (inp) => { pl.run_input(inp); if (pl.error) throw pl.error; };
    const shoot = () => { for (const inp of [{ type: 'key', id: 's1', action: 'down' }, { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' },
      { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }, { type: 'token', token: 'WAIT:300' }]) run(inp); };
    const setting = (id) => lab.call(rec.image.settings, { d0: id, d1: 0, a0: 0 }, null, null, 2000000).d0 & 0xFFFF;
    const u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    run({ type: 'scene', change: { liveview: true } });
    run({ type: 'token', token: 'WAIT:300' });
    const size = rec.R.exif.size, snaps = [], orig = rec.exif_param.bind(rec);
    rec.exif_param = (shot) => { const out = orig(shot); snaps.push({ rec: sim.read(shot.record, size), count: u16(F.take.count), ctx: sim.u32(F.context + CTX_TIMER) >>> 0, counter: setting(COUNTER) }); return out; };
    // the runs of takepic, the lens fill, the third fill and the AF maker-note fill's stand-in, in the second picture
    const P = F.pic, runs = { pic: 0, lens: 0, third: 0, af: 0 }, call0 = lab.call.bind(lab);
    lab.call = (fn, ...a) => { for (const k of ['fn', 'lens', 'third']) if (fn === P[k]) runs[k === 'fn' ? 'pic' : k] += 1; return call0(fn, ...a); };
    const hook0 = lab.hook.bind(lab);
    lab.hook = (at, stub, name, ...a) => hook0(at, name === 'S-AFMKNT' ? (h, r) => { runs.af += 1; return stub(h, r); } : stub, name, ...a);
    rec.fills = null;
    shoot();
    rec.fills = F;
    shoot();
    rec.exif_param = orig;
    lab.call = call0; lab.hook = hook0;
    ok(rec.take_fill_runs === 1 && s.camapp.images.length === 2 && s.camapp.images.every((im) => im.file?.size > 0),
      `two pictures recorded, H-TAKEFILLS run for the second alone (${rec.take_fill_runs} runs; files ${JSON.stringify(s.camapp.images.map((im) => im.file?.path))})`);
    const [a, b] = snaps, diffs = [];
    for (let o = 0; o < size; o += 2) if (a.rec[o] !== b.rec[o] || a.rec[o + 1] !== b.rec[o + 1]) diffs.push(o);
    const X = rec.R.exif, clock = (r) => Array.from(r.slice(X.time, X.time + 10)).join(','), date = (r) => String.fromCharCode(...r.slice(X.date.original, X.date.original + 19));
    t.note = `${diffs.length} halfwords of the record differ: ${diffs.map((o) => `+${o}`).join(' ')}`;
    ok(diffs.length > 0 && diffs.every((o) => o < X.time || o >= X.time + 10), `the fills change the record beyond the clock (${t.note})`);
    ok(diffs.length === DIFFS[MODEL], `${DIFFS[MODEL]} halfwords differ (X, 2026-11-17, on E143, E146 and E147; E146's and E147's TAKE fields 348 bytes lower): ${diffs.length}`);
    const area = (at) => Array.from({ length: 4 }, (_, k) => b.rec[at + 2 * k] | b.rec[at + 2 * k + 1] << 8).join(',');
    ok(runs.pic === 1 && runs.lens === 1 && runs.third === 1 && runs.af === 1 && rec.exif_sets === 2 && pl.stand_ins_in_use().includes('S-AFMKNT'),
      `takepic, the lens fill and the third fill natively once each with S-AFMKNT once (${JSON.stringify(runs)}), the EXIF set once per picture (${rec.exif_sets})`);
    ok(P.crop.every((at) => area(at) === '0,0,1,1') && P.crop.every((at) => area(at) === Array.from({ length: 4 }, (_, k) => a.rec[at + 2 * k] | a.rec[at + 2 * k + 1] << 8).join(',')),
      `S-AFMKNT's crop areas +${P.crop.join(', +')} the full frame, as S-EXIFPRM's: ${P.crop.map(area).join(' / ')}`);
    ok(clock(a.rec) === clock(b.rec) && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(date(b.rec)) && date(a.rec) === date(b.rec),
      `the capture fill's clock read and the EXIF set's date are S-EXIFPRM's: ${clock(b.rec)} / ${clock(a.rec)}, '${date(b.rec)}' / '${date(a.rec)}'`);
    if (MODEL === 'E143') {
      const key = (b.rec[KEY] | b.rec[KEY + 1] << 8 | b.rec[KEY + 2] << 16 | b.rec[KEY + 3] << 24) >>> 0;
      ok(key === (((b.ctx & 0xFFFF) << 16) | b.counter) >>> 0 && b.counter !== 0 && a.rec[KEY] === 0,
        `the key +${KEY} ${h8(key)} is TAKE's context +${CTX_TIMER} ${h8(b.ctx)} over the shot counter ${COUNTER} ${b.counter} (S-EXIFPRM's: ${a.rec[KEY]})`);
      ok((b.rec[AE_AT] | b.rec[AE_AT + 1] << 8) === setting(AE_SETTING), `+${AE_AT} is setting ${AE_SETTING} (${setting(AE_SETTING)}): ${b.rec[AE_AT] | b.rec[AE_AT + 1] << 8}`);
      ok(a.count === 0 && b.count === 1, `the frame count +${COUNT}: ${a.count} without the fills, ${b.count} with them (Standby's clear, StlTake's step)`);
      const h16 = (r, at) => r[at] | r[at + 1] << 8;
      ok((h16(b.rec, LENS_FLAG) & LENS_BIT) && !(h16(a.rec, LENS_FLAG) & LENS_BIT) && h16(b.rec, FOCAL) === FOCAL_12MM,
        `the lens fill's lens step: the lens flag +${LENS_FLAG} 0x${h16(b.rec, LENS_FLAG).toString(16)} (0x${h16(a.rec, LENS_FLAG).toString(16)} without it), the focal length +${FOCAL} ${h16(b.rec, FOCAL)}`);
      ok(WB.every(([at, id]) => h16(b.rec, at) === setting(id)), `takepic's white-balance mode: ${WB.map(([at, id]) => `+${at} ${h16(b.rec, at)} (setting ${id} ${setting(id)})`).join(', ')}`);
      // the control for S-AFMKNT: takepic natively without it on a third shot, to its AF maker-note fill's call through
      // the word TAKE_FOCUS sets
      const shot = rec.shot_alloc(), pk = lab.alloc(new Uint8Array(64), 4);
      sim.write(pk, Uint8Array.of(shot.id, 0, 0, 0));
      let at = null;
      try { at = lab.call(TAKEPIC, { d0: 0, a0: F.context, a1: pk }, null, null, 2000000, new Set([runtime(AF_CALLS)])); } catch (e) { at = String(e.message).slice(0, 200); }
      rec.shot_free(shot);
      ok(at?.pc === runtime(AF_CALLS) && at.a1 === 0 && (sim.u32(AF_WORD) >>> 0) === 0,
        `takepic ${h8(TAKEPIC)} reaches its AF maker-note fill's calls (a1) ${h8(AF_CALLS)} with a1 ${h8(at?.a1 ?? 0)}, the word ${h8(AF_WORD)} ${h8(sim.u32(AF_WORD))} unset: ${typeof at === 'string' ? at : h8(at?.pc ?? 0)}`);
    }
  } catch (e) {
    ok(false, `the session stopped: ${String(e?.message ?? e).slice(0, 600)}`);
  } finally {
    try { pl.close_session(); } catch { /* closed */ }
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await takeFillsSession();
  console.log(`H-TAKEFILLS (${s.model}): ${s.checks - s.bad.length}/${s.checks}`);
  if (s.note) console.log('  ', s.note);
  s.bad.forEach((x) => console.log('  ', x));
  process.exit(s.bad.length ? 1 : 0);
}
