// H-SHOTALLOC over many shots (src/lab/rec.mjs; src/fw/facts.mjs takeShot; docs/hle-gaps/4.3.md 4.3.13): the picture's
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
//                     S-RAWFRAME (src/lab/rawframe.mjs; docs/hle-gaps/4.3.md 4.3.14; E143, where the body's bytes have
//                     its form; on E146 and E147 not in use, with the reason): each picture's fill is the shot's
//                     Bayer buffer (the entry's +2 handle, MM's address of it) and, as rec_ImgProCtrl_Src_Bayer reads
//                     it natively later in the picture, the source's address, format (1031: 12 bits), stride, frame
//                     and developed size are the fill's; the frame's bytes (stride x 3 / 2 x height) lie inside
//                     MM's block of the handle (the pool's base + block x (n - 1), the block not smaller); the
//                     buffer holds the pattern byte for byte after the first and the last picture; the bytes past
//                     the frame in its block and the next block's (the kind-3 pair's first) are as before the first
//                     picture
//                     (X, 2026-11-22: on E143 MM's Bayer block 0xb8000000.. lies past the lab's 384 MiB of DRAM, so
//                     S-RAWFRAME is not in use there and the check pins that reason; with --dram 512 the fill's checks
//                     pass, 29 of 29 over 3 pictures)
//   node emu/test/test_shotalloc.mjs [--session] [--dram 512] [--shots N]     (OM_EMU_MODEL=E143 | E146 | E147)
// Negative controls (X, 2026-11-14, E143): with the free taken out the second picture's shot is id 2 with other
// handles and one entry stays in use (the checks of pictures 2.. fail); with H-SHOTALLOC taken out no picture has a
// shot and each logs the sources' refusals.
// --dram N: the lab's DRAM N MiB (src/fw/board.mjs dram_size, before the session; S-RAWFRAME's run on E143 with 512)
const DRAM = process.argv.includes('--dram') ? Number(process.argv[process.argv.indexOf('--dram') + 1]) : null;
const SHOTS = process.argv.includes('--shots') ? Number(process.argv[process.argv.indexOf('--shots') + 1]) : 20, NO_BUFFER = 0x25000402, NO_HANDLE = 0x08010004;
// rec_ImgProCtrl_Src_Bayer (E143): its entry (a1 the source record) and its return; the format of 12 bits (0x50547b9a)
const SRC_BAYER_E143 = 0x50549017, SRC_BAYER_RET_E143 = 0x505493BB, FORMAT_12 = 1031, SRC_SIZE = 28;
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
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  const { pattern } = await import('../src/lab/rawframe.mjs');
  if (DRAM) (await import('../src/fw/board.mjs')).BOARD.dram_size = DRAM << 20;
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
    // S-RAWFRAME: in use where the body's bytes have its form (E143), Src_Bayer's source records observed
    const G = rec.raw_geometry(), srcs = [];
    // (E143's MM bank 0 starts at 0xb8000000, where the lab's 384 MiB of DRAM end: there S-RAWFRAME is not in use and
    // gives that reason; with --dram 512 it is, X)
    const inUse0 = pl.stand_ins_in_use().includes('S-RAWFRAME');
    ok(ON_LAB_MODEL ? (G ? inUse0 : !inUse0 && /outside the lab's DRAM/.test(rec.raw_skip) && !DRAM) : !G && !inUse0 && !!rec.raw_skip,
      `S-RAWFRAME ${G ? 'in use' : `not in use (${rec.raw_skip})`} on ${MODEL}${DRAM ? ` with ${DRAM} MiB of DRAM` : ''} (want: on E143 in use where the lab's DRAM holds MM's Bayer block, elsewhere not in use)`);
    let around = null;
    if (G) {
      let at = null;
      lab.observe(SRC_BAYER_E143, (l, r) => { at = r.a1 >>> 0; }, 'obs-test-src-bayer');
      lab.observe(SRC_BAYER_RET_E143, () => { srcs.push(at === null ? null : sim.read(at, SRC_SIZE)); at = null; }, 'obs-test-src-bayer-ret');
      // MM's bank 0 (the Bayer's: MM kind 0) before any fill: the bytes past a frame in its first block, and its second
      const pool = sim.u32(G.banks + 4) >>> 0, base = sim.u32(pool + 8) >>> 0, block = sim.u32(pool + 12) >>> 0;
      around = [[base + G.stride * 3 / 2 * G.height, 4096], [base + block, 4096]].map(([a, len]) => [a, len, hex(sim.read(a, len))]);
    }
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
      if (G) {
        const raw = im?.raw, src = srcs[k - 1], u16 = (o) => src[o] | src[o + 1] << 8, u32 = (o) => (src[o] | src[o + 1] << 8 | src[o + 2] << 16 | src[o + 3] << 24) >>> 0;
        const bytes = G.stride * 3 / 2 * G.height, n = (raw?.handle ?? 0) & 0xFF;
        ok(raw && raw.handle === h16(2) && raw.size === bytes && raw.size <= raw.block && n >= 1 && raw.address === (raw.base + raw.block * (n - 1)) >>> 0,
          `picture ${k}: S-RAWFRAME filled the shot's Bayer buffer (handle 0x${raw?.handle?.toString(16)}, the entry's +2 0x${h16(2).toString(16)}) at ${raw && h8(raw.address)}, ${raw?.size} bytes (want ${bytes}) inside MM's block (base ${raw && h8(raw.base)}, 0x${raw?.block?.toString(16)} bytes a block)`);
        ok(src && raw && srcs.length === k && u32(0) === raw.address && u16(8) === FORMAT_12 && u16(10) === G.stride && u16(12) === G.width && u16(14) === G.height && u16(16) === G.crop[0] && u16(18) === G.crop[1],
          `picture ${k}: rec_ImgProCtrl_Src_Bayer's source (${srcs.length} runs) reads the fill: address ${src && h8(u32(0))} / ${raw && h8(raw.address)}, format ${src && u16(8)} / ${FORMAT_12}, stride ${src && u16(10)}, frame ${src && `${u16(12)}x${u16(14)}`}, developed ${src && `${u16(16)}x${u16(18)}`} (the fill's ${G.stride}, ${G.width}x${G.height}, ${G.crop.join('x')})`);
        if (raw && (k === 1 || k === shots)) {
          const want = pattern(G), got = sim.read(raw.address, raw.size);
          ok(Buffer.compare(Buffer.from(got.buffer, got.byteOffset, got.length), Buffer.from(want.buffer, want.byteOffset, want.length)) === 0, `picture ${k}: the Bayer buffer holds S-RAWFRAME's pattern byte for byte after the picture`);
          ok(around && around.every(([a, len, h]) => hex(sim.read(a, len)) === h), `picture ${k}: the 4096 bytes past the frame in its block and the next block's first 4096 are as before the first picture (${around?.map(([a]) => h8(a)).join(', ')})`);
        }
      }
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
  console.log(`H-SHOTALLOC over ${SHOTS} pictures (${s.model}${DRAM ? `, ${DRAM} MiB` : ''}): ${s.checks - s.bad.length}/${s.checks}`);
  s.bad.forEach((x) => console.log('  ', x));
  process.exit(s.bad.length ? 1 : 0);
}
