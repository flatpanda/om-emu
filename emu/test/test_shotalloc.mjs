// H-SHOTALLOC over many shots (src/lab/rec.mjs; src/fw/facts.mjs takeShot; docs/hle-gaps.md 4.3.13): the picture's
// shot in TAKE's shot table, allocated through api_rec as the application's CapBuf_TakeBuff allocates it and freed
// through api_rec after REC_FILE's reply, must leave nothing behind: TAKE's table and MM's handles are the camera's own
// state, and a shot that kept its entry or a buffer would starve a later one.
//   shotAllocSession  (firmware; the body of OM_EMU_MODEL: E143 by default, E146, E147, the bodies whose rule reads the
//                     shot) one session, SHOTS consecutive pictures with S-SCENE's live view. Before the first no
//                     entry of TAKE's table is in use. Each picture: its shot's id is in the table's range, its entry
//                     as TAKE's allocation left it has the record and the buffers ImageParam's four sources look up,
//                     and is byte for byte the first picture's (the same id, MM's same handles and the same record
//                     address: what the free gave back the next allocation took); ImageParam's sources log no error;
//                     after it no entry is in use; its file is on the card, with the firmware's header (Make, Model
//                     and Exif version as the first file's, the body's Model) before the lab's stream. Over all
//                     pictures TAKE's lookups and MM's handle-to-address log no refusal for a missing buffer
//                     (0x25000402, 0x08010004). The first and the last file decode (refs/jpeg.mjs)
//   node emu/test/test_shotalloc.mjs [--session]     (OM_EMU_MODEL=E143 | E146 | E147)
// Negative controls (X, 2026-11-14, E143): with the free taken out the second picture's shot is id 2 with other
// handles and one entry stays in use (the checks of pictures 2.. fail); with H-SHOTALLOC taken out no picture has a
// shot and each logs the sources' refusals.
const SHOTS = 20, NO_BUFFER = 0x25000402, NO_HANDLE = 0x08010004;
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function shotAllocSession(shots = SHOTS) {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { SdCard } = await import('../src/lab/sdcard.mjs');
  const { FatVolume, mbrPartition } = await import('../refs/fat.mjs');
  const { readExif } = await import('../refs/exif.mjs');
  const { decodeJpeg } = await import('../refs/jpeg.mjs');
  const card = new SdCard();
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  t.model = MODEL;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, sim = lab.sim, rec = s.storage?.rec, T = rec?.shot;
    ok(!!T && pl.stand_ins_in_use().includes('H-SHOTALLOC'), `${MODEL}: H-SHOTALLOC is in use (a body whose rule reads TAKE's shot: fact take_shot)`);
    if (!T) return t;
    const R = T.record, flagsOf = (id) => { const b = sim.read(R.table + R.entry * id, 2); return b[0] | b[1] << 8; };
    const inUse = () => { const ids = []; for (let id = 1; id < R.ids; id++) if (flagsOf(id) !== 0) ids.push(id); return ids; };
    const run = (inp) => { pl.run_input(inp); if (pl.error) throw pl.error; };
    run({ type: 'scene', change: { liveview: true } });
    run({ type: 'token', token: 'WAIT:300' });
    ok(inUse().length === 0, `before the first picture no entry of TAKE's table ${h8(R.table)} (ids 1..${R.ids - 1}) is in use: ${JSON.stringify(inUse())}`);
    const e0 = lab.kernel.errors.length;
    let first = null;
    for (let k = 1; k <= shots; k++) {
      for (const inp of [{ type: 'key', id: 's1', action: 'down' }, { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' },
        { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }, { type: 'token', token: 'WAIT:300' }]) run(inp);
      const im = rec.images[k - 1], sh = im?.shot, e = sh?.entry ?? new Uint8Array(R.entry), h16 = (o) => e[o] | e[o + 1] << 8;
      if (k === 1) first = sh;
      const file = s.camapp.images[k - 1]?.file;
      ok(rec.images.length === k && s.camapp.images.length === k && file?.size > 0 && JSON.stringify(im?.errlog) === '[]',
        `picture ${k}: recorded (${rec.images.length} REC_IMAGE runs, ${s.camapp.images.length} pictures, the file ${JSON.stringify(file && { path: file.path, size: file.size })}), no error log from ImageParam's sources: ${JSON.stringify(im?.errlog)}`);
      ok(sh && sh.id >= 1 && sh.id < R.ids && (sh.flags & 0x55) === 0x55 && [2, 10, 12, 16, 24].every((o) => h16(o) !== 0) && sh.record !== 0,
        `picture ${k}: its shot ${sh?.id} has the record and the sources' buffers (flags 0x${sh?.flags?.toString(16)}, want the bits 0x55; the entry ${hex(e)})`);
      ok(sh && first && sh.id === first.id && sh.record === first.record && hex(e) === hex(first.entry),
        `picture ${k}: the shot's entry is the first picture's (id ${sh?.id} / ${first?.id}, record ${sh && h8(sh.record)} / ${first && h8(first.record)}, entry ${hex(e)} / ${first && hex(first.entry)}): the free gave the id and MM's handles back`);
      ok(inUse().length === 0, `picture ${k}: no entry of TAKE's table is in use after it: ${JSON.stringify(inUse())}`);
    }
    const logged = lab.kernel.errors.slice(e0).map(([c]) => c >>> 0);
    ok(!logged.includes(NO_BUFFER) && !logged.includes(NO_HANDLE),
      `over ${shots} pictures no lookup of a missing buffer is logged (TAKE's ${h8(NO_BUFFER)}: ${logged.filter((c) => c === NO_BUFFER).length}, MM's ${h8(NO_HANDLE)}: ${logged.filter((c) => c === NO_HANDLE).length})`);
    // the files, read back from the card independently
    const vol = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
    const text = (m, key) => m?.get(key)?.trim?.();
    const heads = [];
    for (let k = 1; k <= shots; k++) {
      const f = s.camapp.images[k - 1]?.file, name = f?.path?.replace(/^.:\\/, '').replaceAll('\\', '/');
      const e = name ? vol.find(name) : null, data = e && !e.dir ? vol.data(e) : null, x = data ? readExif(data) : null;
      heads.push(x ? [text(x.ifd0, 0x10F), text(x.ifd0, 0x110), x.exif ? String.fromCharCode(...x.exif.get(0x9000)) : null, e.size === f.size] : null);
      if (k === 1 || k === shots) {
        let px = null;
        try { px = decodeJpeg(data); } catch (err) { px = String(err?.message ?? err); }
        ok(px && px.width > 0 && px.height > 0, `picture ${k}: the file decodes (refs/jpeg.mjs): ${px && px.width ? `${px.width}x${px.height}` : px}`);
      }
    }
    ok(heads.every((h) => h && h[0] && h[1] && h[2] && h[3] === true && JSON.stringify(h) === JSON.stringify(heads[0])),
      `the ${shots} files on the card carry the firmware's header (Make, Model, ExifVersion, the fnode's size): ${JSON.stringify(heads[0])}${heads.every((h) => JSON.stringify(h) === JSON.stringify(heads[0])) ? ' each' : `, not all: ${JSON.stringify(heads)}`}`);
  } catch (e) {
    ok(false, `the session stopped: ${String(e?.message ?? e).slice(0, 600)}`);
  } finally {
    try { pl.close_session(); } catch { /* closed */ }
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await shotAllocSession();
  console.log(`H-SHOTALLOC over ${SHOTS} pictures (${s.model}): ${s.checks - s.bad.length}/${s.checks}`);
  s.bad.forEach((x) => console.log('  ', x));
  process.exit(s.bad.length ? 1 : 0);
}
