// The card and the file system (src/lab/sdcard.mjs, src/lab/storage.mjs, refs/fat.mjs):
//   storageUnits    without firmware: the card's registers as the firmware reads them (CSD 2.0's C_SIZE at bits 69..48,
//                   the host's response words: bits 127..8; CRC7), its command state machine (CMD0, CMD8's pattern,
//                   ACMD41, CMD2, CMD3's RCA, CMD9, CMD7, CMD13's state, reads and writes, CMD6, ACMD13 / ACMD51, erase,
//                   UHS-II and unknown commands unanswered, out of range), the saved card's round trip and refusals,
//                   a card out of the slot and back (nothing answered while out; back in idle, its sectors kept);
//                   and the independent FAT reader on a FAT32 volume this test builds (MBR, BPB, FSInfo, a directory, a
//                   long name, a two-cluster file), with a looping chain and an exFAT volume refused; the picture
//                   file's JPEG through the independent decoder (refs/jpeg.mjs): its size, sampling and block means
//   storageSession  (firmware) a play session on E143: the file system's bring-up and the card's insertion (H-FILEINIT,
//                   S-SDCARD, S-CARD) leave the drive mounted by the firmware's own path, on a blank card the firmware
//                   formatted itself; the card read independently (refs/fat.mjs): an MBR with one FAT32 partition, the
//                   firmware's boot sector ('OM SYSTEM', FAT32), FSInfo's free count against the FAT's; the firmware's
//                   remaining shots and movie time from the card (the queries S-CARD answered before), smaller on a 4 GiB
//                   card; a saved card (env.card) mounts in the next session without a format, and a player keeps
//                   its card across a power cycle; S2 with the live view writes the picture's file (S-RECFILE): its
//                   directory entry, size and bytes read back independently, the JPEG decoded (refs/jpeg.mjs) to the
//                   capture's block means, and the next session's DCF numbering mount and image count find it
//   node emu/test/test_storage.mjs [--session]
import { SdCard, NO_RESPONSE, SECTOR, crc7, r2Words, cardImage, cardFromImage } from '../src/lab/sdcard.mjs';
import { FatVolume, mbrPartition } from '../refs/fat.mjs';
import { jpegOfFrame } from '../src/lab/jpeg.mjs';
import { decodeJpeg } from '../refs/jpeg.mjs';

const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const cmd = (index, rt, acmd = false) => index | (acmd ? 0x40 : 0) | rt << 8;

// A FAT32 volume built here, for the reader: [read(lba, n), the files' bytes]. 70000 sectors at LBA 2048, 512-byte
// clusters: 69416 clusters, past FAT16's 65524, so FAT32 by the specification's cluster count
function buildFat32() {
  const disk = new Uint8Array(72048 * SECTOR), put16 = (o, v) => { disk[o] = v & 255; disk[o + 1] = v >> 8 & 255; };
  const put32 = (o, v) => { for (let i = 0; i < 4; i++) disk[o + i] = (v >>> (8 * i)) & 255; };
  const start = 2048, total = 70000, reserved = 32, fatSize = 544, spc = 1;
  // the MBR
  disk[446] = 0x80; disk[446 + 4] = 0x0c; put32(446 + 8, start); put32(446 + 12, total); disk[510] = 0x55; disk[511] = 0xaa;
  const b = start * SECTOR;
  disk.set([0xeb, 0x58, 0x90], b); disk.set([...'TESTFAT '].map((c) => c.charCodeAt(0)), b + 3);
  put16(b + 11, 512); disk[b + 13] = spc; put16(b + 14, reserved); disk[b + 16] = 2; put16(b + 17, 0); put16(b + 19, 0);
  disk[b + 21] = 0xf8; put16(b + 22, 0); put32(b + 32, total); put32(b + 36, fatSize); put32(b + 44, 2); put16(b + 48, 1); put16(b + 50, 6);
  disk[b + 66] = 0x29; put32(b + 67, 0x1234abcd); disk.set([...'TEST LABEL '].map((c) => c.charCodeAt(0)), b + 71);
  disk.set([...'FAT32   '].map((c) => c.charCodeAt(0)), b + 82); disk[b + 510] = 0x55; disk[b + 511] = 0xaa;
  const fi = (start + 1) * SECTOR;
  put32(fi, 0x41615252); put32(fi + 484, 0x61417272); put32(fi + 488, 0); put32(fi + 492, 6); disk[fi + 510] = 0x55; disk[fi + 511] = 0xaa;
  const fat = (start + reserved) * SECTOR, firstData = start + reserved + 2 * fatSize;
  const setFat = (c, v) => { put32(fat + 4 * c, v); put32(fat + fatSize * SECTOR + 4 * c, v); };
  setFat(0, 0x0ffffff8); setFat(1, 0x0fffffff);
  setFat(2, 0x0fffffff);                        // root
  setFat(3, 0x0fffffff);                        // DCIM
  setFat(4, 5); setFat(5, 0x0fffffff);          // the file: two clusters
  const entry = (at, name, attr, cluster, size) => {
    disk.set([...name].map((c) => c.charCodeAt(0)), at); disk[at + 11] = attr;
    put16(at + 20, cluster >>> 16); put16(at + 26, cluster & 0xffff); put32(at + 28, size);
  };
  const root = firstData * SECTOR, dcim = (firstData + 1) * SECTOR;
  entry(root, 'TEST LABEL ', 0x08, 0, 0);
  entry(root + 32, 'DCIM       ', 0x10, 3, 0);
  // 'Long Name.jpg' as one LFN entry, then its short entry
  const lfn = root + 64, chars = [...'Long Name.jpg'].map((c) => c.charCodeAt(0)).concat([0]);
  while (chars.length < 13) chars.push(0xffff);
  disk[lfn] = 0x41; disk[lfn + 11] = 0x0f;
  chars.forEach((c, i) => { const o = i < 5 ? 1 + 2 * i : i < 11 ? 14 + 2 * (i - 5) : 28 + 2 * (i - 11); put16(lfn + o, c); });
  const data = new Uint8Array(700).map((_, i) => (i * 7 + 3) & 255);
  entry(root + 96, 'LONGNA~1JPG', 0x20, 4, data.length);
  disk.set(data.subarray(0, 512), (firstData + 2) * SECTOR); disk.set(data.subarray(512), (firstData + 3) * SECTOR);
  entry(dcim, '.          ', 0x10, 3, 0); entry(dcim + 32, '..         ', 0x10, 0, 0);
  const read = (lba, n) => disk.slice(lba * SECTOR, (lba + n) * SECTOR);
  return { read, data, disk, start, fat, setFat };
}

export function storageUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  // registers as the firmware reads them: CSD_STRUCTURE at word 3 bits 22..23, C_SIZE (word 1 >> 8) & 0x3fffff,
  // capacity (C_SIZE + 1) << 10 sectors (sdmem_format 0x508b338e)
  const card = new SdCard();
  const w = r2Words(card.csd());
  ok(((w[3] >>> 22) & 3) === 1, `CSD: structure 1 (2.0) in the fourth response word: ${(w[3] >>> 22) & 3}`);
  ok((((w[1] >>> 8) & 0x3fffff) + 1) * 1024 === card.sectors, `CSD: the firmware's capacity read gives ${card.sectors} sectors`);
  ok(crc7(Uint8Array.of(0x40, 0, 0, 0, 0)) === 0x4a, 'CRC7 of CMD0 is 0x4a');
  ok(crc7(Uint8Array.of(0x51, 0, 0, 0, 0)) === 0x2a, 'CRC7 of CMD17 with argument 0 is 0x2a');
  const cid = card.cid(), csd = card.csd();
  ok((cid[15] & 1) === 1 && cid[15] >> 1 === crc7(cid.subarray(0, 15)) && csd[15] >> 1 === crc7(csd.subarray(0, 15)), 'CID and CSD end in their CRC7 and the stop bit');
  const r2 = r2Words(Uint8Array.from({ length: 16 }, (_, i) => i));
  ok(r2[0] === 0x0b0c0d0e && r2[1] === 0x0708090a && r2[3] === 0x000102, `R2 words: bits 39..8 first, 127..104 last: ${r2.map((x) => x.toString(16))}`);
  // the state machine
  const c = new SdCard({ sectors: 8388608 });
  ok(c.exec(cmd(0, 3), 0).status === 0, 'CMD0');
  ok(c.exec(cmd(8, 4), 0x1aa).resp[0] === 0x1aa, 'CMD8 echoes the voltage and the check pattern');
  ok(c.exec(cmd(8, 4), 0x2aa).status === NO_RESPONSE, 'CMD8 outside 2.7-3.6 V: no response');
  ok(c.exec(cmd(2, 6), 0).status === NO_RESPONSE, 'CMD2 before ACMD41: no response');
  ok(c.exec(cmd(41, 7, true), 0x40300000).resp[0] >>> 30 === 3, 'ACMD41: power-up done and CCS (SDHC)');
  ok(c.exec(cmd(2, 6), 0).resp.join() === r2Words(c.cid()).join(), 'CMD2: the CID');
  const r6 = c.exec(cmd(3, 4), 0).resp[0], rca = r6 >>> 16;
  ok(rca !== 0 && ((r6 >> 9) & 0xf) === 2, `CMD3: an RCA and the ident state: 0x${r6.toString(16)}`);
  ok(c.exec(cmd(9, 6), rca << 16).resp.join() === r2Words(c.csd()).join(), 'CMD9: the CSD');
  ok(c.exec(cmd(17, 4), 0).status === NO_RESPONSE, 'CMD17 in stand-by: no response');
  c.exec(cmd(7, 5), rca << 16);
  ok(((c.exec(cmd(13, 4), rca << 16).resp[0] >> 9) & 0xf) === 4, 'CMD7 then CMD13: transfer state');
  ok(c.exec(cmd(13, 4), (rca + 1) << 16).status === NO_RESPONSE, 'CMD13 to another RCA: no response');
  ok(c.exec(cmd(6, 4, true), 2).status === 0 && c.bus4 && (c.ssr()[0] >> 6) === 2, 'ACMD6: a 4-bit bus, which the SD Status reports');
  ok(c.exec(cmd(51, 4, true), 0).data.length === 8 && c.exec(cmd(13, 4, true), 0).data.length === 64, 'ACMD51 and ACMD13 return 8 and 64 bytes');
  const sw = c.exec(cmd(6, 4), 0x80fffff1).data;
  ok(sw.length === 64 && (sw[16] & 0xf) === 1 && (sw[13] & 3) === 3, 'CMD6 set: high speed selected, group 1 supports default and high speed');
  ok((c.exec(cmd(6, 4), 0x80fffff3).data[16] & 0xf) === 0xf, 'CMD6 for an unsupported access mode: 0xf');
  const wr = c.exec(cmd(25, 4), 100, 2, 512);
  ok(wr.status === 0 && wr.write, 'CMD25 takes the host\'s blocks');
  c.writeSector(100, new Uint8Array(512).fill(7)); c.writeSector(101, new Uint8Array(512));
  const rd = c.exec(cmd(18, 4), 100, 2, 512).data;
  ok(rd.length === 1024 && rd[0] === 7 && rd[600] === 0 && !c.data.has(101), 'CMD18 reads them back; an all-zero sector is not stored');
  ok((c.exec(cmd(17, 4), c.sectors).resp[0] >>> 31) === 1, 'a read past the capacity: OUT_OF_RANGE');
  c.exec(cmd(32, 4), 100); c.exec(cmd(33, 4), 100); c.exec(cmd(38, 5), 0);
  ok(!c.data.has(100) && c.read(100, 1)[0] === 0, 'CMD32, CMD33, CMD38 erase to 0');
  ok(c.exec(cmd(2, 6) | (1 << 30), 0).status === NO_RESPONSE && c.exec(cmd(5, 4), 0).status === NO_RESPONSE, 'UHS-II and unknown commands: no response');
  ok(throwsLike(() => new SdCard({ sectors: 4194304 }), /SDHC/) && throwsLike(() => new SdCard({ sectors: 8388609 }), /SDHC/), 'a capacity that is not SDHC is refused');
  // the saved card
  c.writeSector(5, new Uint8Array(512).fill(9));
  const back = cardFromImage(cardImage(c));
  ok(back.sectors === c.sectors && back.data.size === c.data.size && back.read(5, 1)[3] === 9, 'cardImage round trip');
  ok(throwsLike(() => cardFromImage(new Uint8Array(20)), /OMSD/) && throwsLike(() => cardFromImage(cardImage(c).subarray(0, 500)), /bytes for/), 'a broken card image is refused');
  ok(c.take_dirty() === true && c.take_dirty() === false, 'take_dirty reports a write once');
  // out of the slot and back: no command is answered while it is out; back in, the card is idle with its sectors
  const o = new SdCard({ sectors: 8388608 });
  o.exec(cmd(0, 3), 0); o.exec(cmd(41, 7, true), 0x40300000); o.exec(cmd(2, 6), 0);
  const orca = o.exec(cmd(3, 4), 0).resp[0] >>> 16;
  o.exec(cmd(7, 5), orca << 16); o.writeSector(9, new Uint8Array(512).fill(3));
  o.remove();
  ok(!o.present && o.exec(cmd(0, 3), 0).status === NO_RESPONSE && o.exec(cmd(13, 4), orca << 16).status === NO_RESPONSE, 'a card out of the slot answers nothing');
  o.insert();
  ok(o.present && o.state === 'idle' && o.exec(cmd(13, 4), orca << 16).status === NO_RESPONSE, 'back in, the card is idle: CMD13 to its old RCA gets no response');
  ok(o.exec(cmd(17, 4), 9).status === NO_RESPONSE && o.read(9, 1)[0] === 3, 'no read before the card init; its sectors are kept');
  // the FAT reader on the test's own volume
  const f = buildFat32(), p = mbrPartition(f.read(0, 1));
  ok(p && p.type === 0x0c && p.start === f.start && p.active, `MBR: one FAT32 LBA partition at ${f.start}: ${JSON.stringify(p)}`);
  const v = new FatVolume(f.read, p.start);
  ok(v.type === 'FAT32' && v.label === 'TEST LABEL ' && v.fsType === 'FAT32   ' && v.spc === 1, `the boot sector: ${v.type} '${v.label}' '${v.fsType}'`);
  const names = v.list().map((e) => e.name);
  ok(JSON.stringify(names) === JSON.stringify(['DCIM', 'Long Name.jpg']), `the root directory (label skipped, LFN joined): ${names}`);
  const e = v.find('long name.JPG');
  ok(e && e.size === 700 && JSON.stringify(v.chain(e.cluster)) === '[4,5]', 'find by the long name, the two-cluster chain');
  ok(e && v.data(e).every((x, i) => x === f.data[i]), 'the file\'s bytes');
  ok(v.find('DCIM')?.dir && v.list(v.find('DCIM').cluster).length === 2, 'a subdirectory with its dot entries');
  ok(v.freeClusters() === v.clusters - 4 && v.fsInfo()?.next === 6, `free clusters by the FAT ${v.freeClusters()} of ${v.clusters}; FSInfo`);
  f.setFat(5, 4);
  ok(throwsLike(() => v.chain(4), /loops/), 'a looping chain is refused');
  const ex = new Uint8Array(512); ex.set([...'EXFAT   '].map((ch) => ch.charCodeAt(0)), 3);
  ok(throwsLike(() => new FatVolume(() => ex, 0), /exFAT/), 'an exFAT volume is refused');
  // the picture file's JPEG (src/lab/jpeg.mjs) through the independent decoder: a 4:2:2 frame of 37 x 21 (edges
  // replicated), each 8 x 8 block its mean in every component
  const fw = 37, fh = 21, frows = [];
  for (let y = 0; y < fh; y++) { const r = new Uint8Array(2 * fw); for (let x = 0; x < fw; x++) { r[2 * x] = (x * 7 + y * 3) & 255; r[2 * x + 1] = x & 1 ? 200 - y : 60 + x; } frows.push(r); }
  const jp = jpegOfFrame([fw, fh, frows]), dj = decodeJpeg(jp);
  ok(jp[0] === 0xff && jp[1] === 0xd8 && jp[jp.length - 2] === 0xff && jp[jp.length - 1] === 0xd9, 'the JPEG starts with SOI and ends with EOI');
  ok(dj.width === fw && dj.height === fh && JSON.stringify(dj.components.map((c) => [c.id, c.h, c.v, c.width])) === '[[1,2,1,37],[2,1,1,19],[3,1,1,19]]', `decoded: ${dj.width} x ${dj.height}, components ${JSON.stringify(dj.components.map((c) => [c.id, c.h, c.v, c.width]))}`);
  const clampY = (x, y) => frows[Math.min(y, fh - 1)][2 * Math.min(x, fw - 1)];
  let ym = 0; for (let y = 8; y < 16; y++) for (let x = 16; x < 24; x++) ym += clampY(x, y);
  ok(Math.abs(dj.components[0].samples[10 * fw + 20] - Math.round(ym / 64)) <= 1, `a luma block decodes to its mean: ${dj.components[0].samples[10 * fw + 20]} for ${ym / 64}`);
  let cm = 0; for (let y = 0; y < 8; y++) for (let cx = 0; cx < 8; cx++) cm += frows[y][2 * (2 * cx + 1) + 1];
  ok(Math.abs(dj.components[2].samples[2 * 19 + 3] - Math.round(cm / 64)) <= 1, `a Cr block decodes to its mean: ${dj.components[2].samples[2 * 19 + 3]} for ${cm / 64}`);
  const prog = Uint8Array.from(jp); prog[jp.indexOf(0xc0, 2)] = 0xc2;
  ok(throwsLike(() => decodeJpeg(prog), /not baseline/), 'a progressive JPEG is refused');
  return { checks, bad };
}

// (firmware) the play session's card: E143 only (src/fw/models.mjs storage)
export async function storageSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const P = await import('../src/lab/play.mjs');
  const { labEnv, loadBlock } = await import('../checks/lib/env.mjs');
  const { A } = await import('../src/fw/model.mjs');
  const resBlock = loadBlock();
  const SHOTS = A(0x50419164), MOVIE = A(0x5042DA58);          // S-CARD's queries before (camapp.mjs SHOTS_QUERY, MOVIE_TIME_QUERY)
  let saved = null;
  const session = (card) => {
    const env = { ...labEnv({ resBlock }), card };
    const s = new P.PlaySession(env, { opts: { start: 'shooting', touch: 'off', us_clock: 'lab' }, lang: 'en', device: 'tft', start: [7, 1, 1], out: null, tag: 'play', png: 'none' });
    s.enter();
    return s;
  };
  const native = (s) => {
    const lab = s.lab, shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
    const buf = lab.alloc(new Uint8Array(24), 4);
    lab.call(MOVIE, { a0: buf }, null, null, 2000000);
    const b = lab.sim.read(buf, 24);
    return { shots, movie_ms: (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0 };
  };
  // a blank 8 GiB card, kept by the host at the end
  const host = (card) => ({ open: () => card, save: (c) => { saved = cardImage(c); } });
  const blank = new SdCard();
  let s = session(host(blank)), first;
  try {
    const st = s.steps.find((x) => x.storage)?.storage;
    ok(st && st.mounted && st.formatted, `the insertion formatted the blank card and mounted it: ${JSON.stringify(st && { mounted: st.mounted, formatted: st.formatted, drive_status: st.drive_status })}`);
    ok(st && st.dcf?.folder === 100 && st.dcf?.file === 1, `the DCF numbering mount: folder 100, file 1 next: ${JSON.stringify(st?.dcf)}`);
    ok(st && st.log.some(([k, d]) => k === 'mount' && /^error 0xe08/.test(d)), 'the first mount found no file system (0xe08)');
    ok((s.storage.status_word() & 0x1000) !== 0, 'the drive status has the mount bit natively');
    const vol = new FatVolume((lba, n) => blank.read(lba, n), mbrPartition(blank.read(0, 1))?.start ?? 0);
    ok(mbrPartition(blank.read(0, 1))?.type === 0x0c && vol.type === 'FAT32', `MBR and boot sector: one FAT32 partition: ${vol.type}`);
    ok(vol.label === 'OM SYSTEM  ' && vol.fsType === 'FAT32   ', `the firmware's label and type: '${vol.label}' '${vol.fsType}'`);
    const fsi = vol.fsInfo(), free = vol.freeClusters();
    ok(fsi !== null && fsi.free === free, `FSInfo's free count ${fsi?.free} is the FAT's ${free}`);
    ok(vol.total <= blank.sectors - vol.start, 'the partition fits the card');
    first = native(s);
    ok(first.shots > 0 && first.movie_ms > 0, `the firmware's remaining shots and movie time from the card: ${JSON.stringify(first)}`);
  } catch (e) { bad.push(`8 GiB session: ${e.message.slice(0, 400)}`); }
  s.close();
  ok(saved !== null, 'the host kept the card the firmware wrote');
  // the saved card mounts without a format
  if (saved) {
    s = session(host(cardFromImage(saved)));
    try {
      const st = s.steps.find((x) => x.storage)?.storage;
      ok(st && st.mounted && !st.formatted, `a saved card mounts without a format: ${JSON.stringify(st && { mounted: st.mounted, formatted: st.formatted })}`);
      ok(first && JSON.stringify(native(s)) === JSON.stringify(first), 'the same card, the same count and movie time');
    } catch (e) { bad.push(`saved card session: ${e.message.slice(0, 400)}`); }
    s.close();
  }
  // a player keeps the card in the slot across its sessions (a power cycle): the second start mounts it unformatted
  {
    const { loadImage, createHash } = await import('../checks/lib/env.mjs');
    const { Player } = await import('../src/lab/player.mjs');
    const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
      { rom: loadImage(), resBlock, createHash, wallClock: () => performance.now() / 1000 });
    const st = () => pl.session.steps.find((x) => x.storage)?.storage;
    try {
      pl.open_session();
      const a = st();
      ok(pl.stand_ins_in_use().includes('S-SDCARD') && pl.stand_ins_in_use().includes('H-FILEINIT'), 'the player lists the card\'s stand-ins');
      pl.close_session(); pl.open_session();
      const b = st();
      ok(a?.formatted === true && b?.formatted === false && b?.mounted === true, `a power cycle keeps the card: formatted ${a?.formatted}, then ${b?.formatted}`);
    } catch (e) { bad.push(`player: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
  }
  // S2 with S-SCENE's live view: the picture's file through the file module's own requests (S-RECFILE), read back
  // independently; the next session's DCF numbering mount and image count find it
  {
    const { loadImage, createHash } = await import('../checks/lib/env.mjs');
    const { Player } = await import('../src/lab/player.mjs');
    const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
    const { jpegOfFrame } = await import('../src/lab/jpeg.mjs');
    const { decodeJpeg } = await import('../refs/jpeg.mjs');
    const { runtime } = await import('../src/lab/hle.mjs');
    const card = new SdCard();
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
      { rom: loadImage(), resBlock, createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
    try {
      pl.open_session();
      for (const inp of [{ type: 'scene', change: { liveview: true } }, { type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' },
        { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' }, { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }]) pl.run_input(inp);
      const s2 = pl.session, img = s2.camapp.images[0];
      ok(img?.file?.path === 'C:\\DCIM\\100OMSYS\\P1010001.JPG', `S2 wrote the picture's file: ${JSON.stringify(img?.file)}`);
      const want = img ? jpegOfFrame(s2.picture_frame(s2.camapp.views.get(img.release) ?? null)) : null;
      const vol = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
      const e = vol.find('DCIM/100OMSYS/P1010001.JPG');
      ok(e && !e.dir && want && e.size === want.length, `the directory entry DCIM/100OMSYS/P1010001.JPG: ${JSON.stringify(e && { size: e.size, cluster: e.cluster })}, the JPEG ${want?.length} bytes`);
      const data = e ? vol.data(e) : null;
      ok(data && want && data.every((b, i) => b === want[i]), 'the file\'s bytes are the JPEG the lab handed the file module');
      const d = data ? decodeJpeg(data) : null, [w, h, rows] = want ? s2.picture_frame(s2.camapp.views.get(img.release)) : [0, 0, []];
      ok(d && d.width === w && d.height === h && d.components.length === 3, `the file decodes (refs/jpeg.mjs): ${d?.width} x ${d?.height}, frame ${w} x ${h}`);
      if (d) {
        let worst = 0;
        for (const [bx, by] of [[0, 0], [10, 7], [Math.floor(w / 16), Math.floor(h / 16)]]) {
          let sum = 0;
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += rows[by * 8 + y][2 * (bx * 8 + x)];
          worst = Math.max(worst, Math.abs(d.components[0].samples[(by * 8 + 3) * d.width + bx * 8 + 3] - sum / 64));
        }
        ok(worst <= 1, `the decoded luma is the capture frame's block means (worst difference ${worst})`);
      }
      pl.close_session();
      pl.open_session();
      const st = pl.session.steps.find((x) => x.storage)?.storage, lab = pl.session.lab;
      ok(st?.dcf?.folder === 100 && st?.dcf?.file === 2, `the next session's DCF numbering mount finds the file: next ${JSON.stringify(st?.dcf)}`);
      const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);   // S-CARD's image count (camapp.mjs IMAGE_COUNT) aside
      lab.hooks.delete(key);
      const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0;
      lab.hooks.set(key, hook);
      ok(n === 1, `the firmware's own image count (type 1) in the next session: ${n}`);
    } catch (e) { bad.push(`S2 picture: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
  }
  // a 4 GiB card: the firmware's count follows the card
  s = session(host(new SdCard({ sectors: 8388608 })));
  try {
    const four = native(s);
    ok(first && four.shots < first.shots && four.movie_ms < first.movie_ms, `a 4 GiB card has fewer shots and less movie time: ${JSON.stringify(four)} against ${JSON.stringify(first)}`);
  } catch (e) { bad.push(`4 GiB session: ${e.message.slice(0, 400)}`); }
  s.close();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = storageUnits();
  console.log(`card and FAT reader units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await storageSession();
    console.log(`card and file system in play: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
