// The card and the file system (src/lab/sdcard.mjs, src/lab/storage.mjs, refs/fat.mjs):
//   storageUnits    without firmware: every body's card_fs (src/fw/models.mjs: native, or not with its reason); the
//                   card's registers as the firmware reads them (CSD 2.0's C_SIZE at bits 69..48, the host's response
//                   words: bits 127..8; CRC7), its command state machine (CMD0, CMD8's pattern,
//                   ACMD41, CMD2, CMD3's RCA, CMD9, CMD7, CMD13's state, reads and writes, CMD6, ACMD13 / ACMD51, erase,
//                   UHS-II and unknown commands unanswered, out of range), the saved card's round trip and refusals,
//                   a card out of the slot and back (nothing answered while out; back in idle, its sectors kept); an
//                   SDXC card by its capacity (C_SIZE above 32 GiB, the SCR's SD_SECURITY 4, its AU), the size option
//                   (cardSectors) and the capacity limits, a 128 GiB card that stores only what is written and erases
//                   to its end by its stored sectors; the independent FAT reader on a FAT32 volume this test builds
//                   (MBR, BPB, FSInfo, a directory, a long name, a two-cluster file), with a looping chain and an
//                   exFAT volume refused; the independent exFAT reader (refs/exfat.mjs) on an exFAT volume this test
//                   builds (MBR type 0x07, the boot region and its checksum, the FAT, the allocation bitmap, a
//                   compressed up-case table, the label, a benign entry and a deleted set skipped, a contiguous
//                   directory and file, a two-name-entry file whose chain skips a cluster, its valid data length),
//                   each checksum and the name hash refused when wrong, a looping chain, a cluster the bitmap does
//                   not allocate and one it leaks reported; refs/volume.mjs picking the reader; the picture
//                   file's JPEG through the independent decoder (refs/jpeg.mjs): its size, sampling and block means
//   storageSession  (firmware) play sessions on the body of OM_EMU_MODEL (E143 by default; its card_fs native): the
//                   file system's bring-up and the card's insertion (H-FILEINIT, S-SDCARD, S-CARD) leave the drive
//                   mounted by the firmware's own path, on a blank card the firmware formatted itself; the card read
//                   independently (refs/fat.mjs): an MBR with one FAT32 partition, the firmware's boot sector (FAT32;
//                   on E143 'OM SYSTEM'), FSInfo's free count against the FAT's; the firmware's
//                   remaining shots and movie time from the card (the queries S-CARD answered before), smaller on a 4 GiB
//                   card; a saved card (env.card) mounts in the next session without a format, and a player keeps
//                   its card across a power cycle; S2 with the live view writes the picture's file (S-RECFILE): its
//                   directory entry, size and bytes read back independently, the JPEG decoded (refs/jpeg.mjs) to the
//                   capture's block means, and the next session's DCF numbering mount and image count find it; where the body runs the HLS media side (card_fs.hls: E143) Card
//                   Formatting from the menu (S-MDACTRL): the card read back is freshly formatted, the counts reset and
//                   the application returns to the menu; the card out and back in (S-MEDIA): the drive unmounted and the
//                   screen without the counts, then mounted again by the firmware with the counts back
//   storageSdxc     (firmware) blank 64 and 128 GiB SDXC cards on the body of OM_EMU_MODEL: formatted and mounted by
//                   the firmware, read back independently whichever file system it chose (refs/volume.mjs) and
//                   consistent, S2's file found with its bytes, the remaining shots counted; what the firmware chose
//                   (exFAT on E143, docs/hle-gaps.md 4.8.6: the layout, the cluster size) and the counts are reported
//                   as notes
//   node emu/test/test_storage.mjs [--session] [--sdxc]
import { SdCard, NO_RESPONSE, SECTOR, crc7, r2Words, cardImage, cardFromImage, cardSectors } from '../src/lab/sdcard.mjs';
import { FatVolume, mbrPartition } from '../refs/fat.mjs';
import { ExfatVolume } from '../refs/exfat.mjs';
import { openVolume } from '../refs/volume.mjs';
import { jpegOfFrame } from '../src/lab/jpeg.mjs';
import { decodeJpeg } from '../refs/jpeg.mjs';
import { MODELS } from '../src/fw/models.mjs';

const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const cmd = (index, rt, acmd = false) => index | (acmd ? 0x40 : 0) | rt << 8;
// the remaining-shots and movie time queries (S-CARD's queries before: camapp.mjs SHOTS_QUERY, MOVIE_TIME_QUERY), at
// the model's addresses (A: src/fw/model.mjs)
const cardQueries = (A) => ({ SHOTS: A(0x50419164), MOVIE: A(0x5042DA58) });

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

// An exFAT volume built here from the exFAT specification, for the reader, with this test's own checksums: an MBR with
// one partition (type 0x07) at LBA 64 of 1024 sectors; the FAT at +24 (8 sectors), the cluster heap at +32: 992
// one-sector clusters. Cluster 2 the allocation bitmap, 3 a compressed up-case table (0xffff 0x61: the code points
// below 'a' to themselves, then a..z to A..Z), 4 the root (the label 'TEST', the bitmap, the up-case table, a volume
// GUID, DCIM, 'A Long Picture Name.jpg', a deleted set), 5 DCIM (contiguous: its FAT entry 0), 6 and 8 the long-named
// file's chain (700 bytes, 600 valid; 7 free and filled with 0xee), 9 and 10 DCIM's P1010001.JPG (1000 bytes,
// contiguous). Also the Card panel's exFAT volume (test/test_web.mjs cardTests)
export function buildExfat() {
  const start = 64, length = 1024, fatOffset = 24, fatLength = 8, heap = 32, count = length - heap;
  const disk = new Uint8Array((start + length) * SECTOR);
  const put16 = (o, v) => { disk[o] = v & 255; disk[o + 1] = v >> 8 & 255; };
  const put32 = (o, v) => { for (let i = 0; i < 4; i++) disk[o + i] = (v >>> (8 * i)) & 255; };
  const put64 = (o, v) => { put32(o, v % 0x100000000); put32(o + 4, Math.floor(v / 0x100000000)); };
  const sec = (s) => (start + s) * SECTOR, cl = (c) => sec(heap + c - 2);
  const sum32 = (b, skip = []) => { let c = 0; b.forEach((v, i) => { if (!skip.includes(i)) c = ((c & 1 ? 0x80000000 : 0) + (c >>> 1) + v) >>> 0; }); return c; };
  const sum16 = (b, skip = []) => { let c = 0; b.forEach((v, i) => { if (!skip.includes(i)) c = ((c & 1 ? 0x8000 : 0) + (c >>> 1) + v) & 0xffff; }); return c; };
  const utf16 = (t) => Uint8Array.from([...t].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8]));
  const ts = (46 << 25 | 10 << 21 | 28 << 16 | 12 << 11 | 34 << 5 | 5) >>> 0;   // 2026-10-28 12:34:10
  // the MBR
  disk[446 + 4] = 0x07; put32(446 + 8, start); put32(446 + 12, length); disk[510] = 0x55; disk[511] = 0xaa;
  // the boot sector and the extended boot sectors' signatures
  const b = sec(0);
  disk.set([0xeb, 0x76, 0x90], b); disk.set([...'EXFAT   '].map((ch) => ch.charCodeAt(0)), b + 3);
  put64(b + 64, start); put64(b + 72, length); put32(b + 80, fatOffset); put32(b + 84, fatLength); put32(b + 88, heap);
  put32(b + 92, count); put32(b + 96, 4); put32(b + 100, 0x1234abcd); put16(b + 104, 0x100);
  disk[b + 108] = 9; disk[b + 109] = 0; disk[b + 110] = 1; disk[b + 111] = 0x80; disk[b + 112] = 1; disk[b + 510] = 0x55; disk[b + 511] = 0xaa;
  for (let s = 1; s <= 8; s++) { disk[sec(s) + 510] = 0x55; disk[sec(s) + 511] = 0xaa; }
  // the FAT: the bitmap, the up-case table, the root and the long-named file's 6 -> 8 chained; DCIM and the picture not
  const fat = sec(fatOffset), setFat = (c, v) => put32(fat + 4 * c, v);
  setFat(0, 0xfffffff8); setFat(1, 0xffffffff);
  for (const c of [2, 3, 4, 8]) setFat(c, 0xffffffff);
  setFat(6, 8);
  for (const c of [2, 3, 4, 5, 6, 8, 9, 10]) disk[cl(2) + ((c - 2) >> 3)] |= 1 << ((c - 2) & 7);
  const up = [0xffff, 0x61, ...Array.from({ length: 26 }, (_, i) => 0x41 + i)];
  up.forEach((v, i) => put16(cl(3) + 2 * i, v));
  const upBytes = disk.slice(cl(3), cl(3) + 2 * up.length);
  // a file's entry set: the file entry, the stream extension, its name entries; sealed with its set checksum
  const reseal = (at) => put16(at + 2, sum16(disk.subarray(at, at + 32 * (1 + disk[at + 1])), [2, 3]));
  const fileSet = (at, name, attr, cluster, size, { contiguous = false, valid = size } = {}) => {
    const n = Math.ceil(name.length / 15);
    disk[at] = 0x85; disk[at + 1] = 1 + n; put16(at + 4, attr); put32(at + 8, ts); put32(at + 12, ts); put32(at + 16, ts);
    const st = at + 32;
    disk[st] = 0xc0; disk[st + 1] = 1 | (contiguous ? 2 : 0); disk[st + 3] = name.length; put16(st + 4, sum16(utf16(name.toUpperCase())));
    put64(st + 8, valid); put32(st + 20, cluster); put64(st + 24, size);
    for (let i = 0; i < name.length; i++) { const e = at + 64 + 32 * Math.floor(i / 15); disk[e] = 0xc1; put16(e + 2 + 2 * (i % 15), name.charCodeAt(i)); }
    reseal(at);
    return at + 32 * (2 + n);
  };
  let r = cl(4);
  disk[r] = 0x83; disk[r + 1] = 4; disk.set(utf16('TEST'), r + 2); r += 32;
  disk[r] = 0x81; put32(r + 20, 2); put64(r + 24, Math.ceil(count / 8)); r += 32;
  disk[r] = 0x82; put32(r + 4, sum32(upBytes)); put32(r + 20, 3); put64(r + 24, upBytes.length); r += 32;
  disk[r] = 0xa0; r += 32;                      // the volume GUID: benign, no secondaries
  const dcimAt = r;
  r = fileSet(r, 'DCIM', 0x10, 5, SECTOR, { contiguous: true });
  const longAt = r;
  r = fileSet(r, 'A Long Picture Name.jpg', 0x20, 6, 700, { valid: 600 });
  const goneAt = r;
  fileSet(r, 'GONE.JPG', 0x20, 7, 10);
  for (let k = 0; k < 3; k++) disk[goneAt + 32 * k] &= 0x7f;     // deleted: the set's in-use bits clear
  const picAt = cl(5);
  fileSet(picAt, 'P1010001.JPG', 0x20, 9, 1000, { contiguous: true });
  const long = Uint8Array.from({ length: 700 }, (_, i) => (i * 7 + 3) & 255), pic = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13 + 1) & 255);
  disk.set(long.subarray(0, 512), cl(6)); disk.fill(0xee, cl(7), cl(8)); disk.set(long.subarray(512), cl(8));
  disk.set(pic.subarray(0, 512), cl(9)); disk.set(pic.subarray(512), cl(10));
  // the boot checksum over sectors 0..10 (VolumeFlags and PercentInUse left out) repeated over sector 11; the backup
  // boot region a copy of the main one
  const bootSum = sum32(disk.subarray(sec(0), sec(11)), [106, 107, 112]);
  for (let i = 0; i < 128; i++) put32(sec(11) + 4 * i, bootSum);
  disk.copyWithin(sec(12), sec(0), sec(12));
  const read = (lba, n) => disk.slice(lba * SECTOR, (lba + n) * SECTOR);
  return { read, disk, start, count, sec, cl, setFat, reseal, ts, long, pic, dcimAt, longAt, picAt };
}

export function storageUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  // every body says whether its card's file system runs natively, and why not where it does not (src/fw/models.mjs card_fs)
  for (const [code, m] of Object.entries(MODELS)) {
    const cf = m.card_fs;
    ok(cf && typeof cf.native === 'boolean' && (cf.native || (typeof cf.why === 'string' && cf.why.length > 0)), `${code}: card_fs ${JSON.stringify(cf)}, want native true, or false with its reason`);
  }
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
  // an SDXC card: the capacity alone makes it one (the same OCR and CSD version, C_SIZE above 32 GiB), its SCR says
  // SD_SECURITY 4 (version 3.xx) where SDHC says 3, its AU the lab's 16 MiB (32 MiB above 128 GiB)
  const xc = new SdCard({ sectors: cardSectors('64G') }), xw = r2Words(xc.csd());
  ok(xc.kind === 'SDXC' && card.kind === 'SDHC' && xc.sectors === 134217728, `64 GiB: ${xc.kind} of ${xc.sectors} sectors; the default card ${card.kind}`);
  ok(((xw[3] >>> 22) & 3) === 1 && (((xw[1] >>> 8) & 0x3fffff) + 1) * 1024 === xc.sectors && xc.csd()[15] >> 1 === crc7(xc.csd().subarray(0, 15)), 'SDXC CSD: structure 1 (2.0), the firmware\'s capacity read gives its sectors, its CRC7');
  ok(xc.ocr() === card.ocr() && (xc.ocr() >>> 30) === 3, 'SDXC OCR: the same as SDHC\'s (power-up done, CCS)');
  ok(((xc.scr()[1] >> 4) & 7) === 4 && ((card.scr()[1] >> 4) & 7) === 3 && (xc.scr()[1] & 0xf) === 5 && (xc.scr()[2] & 0x80) !== 0, `SCR: SD_SECURITY 4 on SDXC, 3 on SDHC, 1- and 4-bit bus, SD_SPEC3: ${xc.scr()[1].toString(16)} / ${card.scr()[1].toString(16)}`);
  const au = (sectors) => new SdCard({ sectors }).ssr()[10] >> 4;
  ok(card.ssr()[10] >> 4 === 9 && xc.ssr()[10] >> 4 === 0xc && au(cardSectors(128)) === 0xc && au(cardSectors(256)) === 0xe, 'SD Status AU_SIZE: 4 MiB on SDHC, 16 MiB on SDXC to 128 GiB, 32 MiB above');
  ok(cardSectors(8) === 16777216 && cardSectors('128GiB') === 268435456 && cardSectors(' 64g ') === 134217728 && throwsLike(() => cardSectors('64 MB'), /GiB/), 'cardSectors: GiB as a number or text');
  ok(new SdCard({ sectors: 4294705152 }).kind === 'SDXC' && throwsLike(() => new SdCard({ sectors: 4294705152 + 1024 }), /SDXC/) && new SdCard({ sectors: cardSectors(32) }).kind === 'SDHC' && new SdCard({ sectors: cardSectors(32) + 1024 }).kind === 'SDXC', 'the capacity limits: SDHC to 32 GiB, SDXC above it to C_SIZE 0x3FFEFF, one 512 KiB unit past that refused');
  // a 128 GiB card stores only the sectors written, and an erase to its end goes by them
  const big = new SdCard({ sectors: cardSectors(128) });
  big.exec(cmd(0, 3), 0); big.exec(cmd(41, 7, true), 0x40300000); big.exec(cmd(2, 6), 0);
  const brca = big.exec(cmd(3, 4), 0).resp[0] >>> 16;
  big.exec(cmd(7, 5), brca << 16);
  big.writeSector(big.sectors - 1, new Uint8Array(512).fill(1)); big.writeSector(1000, new Uint8Array(512).fill(2));
  ok(big.data.size === 2 && cardFromImage(cardImage(big)).sectors === big.sectors && cardImage(big).length === 16 + 2 * 516, 'a 128 GiB card holds two sectors after two writes, and saves as them');
  ok(big.exec(cmd(17, 4), big.sectors - 1).data[0] === 1 && (big.exec(cmd(17, 4), big.sectors).resp[0] >>> 31) === 1, 'its last sector reads; one past it is OUT_OF_RANGE');
  big.take_dirty();
  big.exec(cmd(32, 4), 2000); big.exec(cmd(33, 4), big.sectors - 1); big.exec(cmd(38, 5), 0);
  ok(!big.data.has(big.sectors - 1) && big.data.has(1000) && big.take_dirty(), 'an erase from sector 2000 to the end: the stored sector in range gone, the one before kept');
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
  ok(openVolume(f.read) instanceof FatVolume && openVolume(f.read).start === f.start, 'refs/volume.mjs reads the FAT32 card with refs/fat.mjs');
  // the exFAT reader on the test's own volume
  const x = buildExfat(), xp = mbrPartition(x.read(0, 1)), xv = openVolume(x.read);
  ok(xp && xp.type === 0x07 && xp.start === x.start, `MBR: one exFAT partition (type 0x07) at ${x.start}: ${JSON.stringify(xp)}`);
  ok(xv instanceof ExfatVolume && xv.type === 'exFAT' && xv.start === x.start && xv.label === 'TEST' && xv.spc === 1 && xv.clusters === x.count && xv.serial === 0x1234abcd && xv.fsType === 'EXFAT   ',
    `refs/volume.mjs reads it with refs/exfat.mjs: ${xv.type} '${xv.label}', ${xv.spc} sector(s) a cluster, ${xv.clusters} clusters`);
  const xnames = xv.list().map((e) => e.name);
  ok(JSON.stringify(xnames) === JSON.stringify(['DCIM', 'A Long Picture Name.jpg']), `the root (the label, bitmap, up-case table, volume GUID and a deleted set skipped): ${xnames}`);
  const lp = xv.find('a long picture NAME.JPG'), lwant = Uint8Array.from(x.long).fill(0, 600);
  ok(lp && !lp.dir && !lp.contiguous && lp.size === 700 && lp.validSize === 600 && JSON.stringify(xv.chain(lp.cluster)) === '[6,8]', `found by its name up-cased by the volume's table; its FAT chain skips cluster 7: ${JSON.stringify(lp && { size: lp.size, valid: lp.validSize, cluster: lp.cluster })}`);
  ok(lp && xv.data(lp).every((v, i) => v === lwant[i]), 'its bytes, zeros past its valid data length');
  const pe = xv.find('dcim/p1010001.jpg');
  ok(pe && pe.contiguous && pe.size === 1000 && pe.date === x.ts >>> 16 && pe.time === (x.ts & 0xffff) && xv.data(pe).every((v, i) => v === x.pic[i]), 'a contiguous (NoFatChain) file in a contiguous directory, its FAT entries 0: its bytes and its modified time');
  ok(xv.find('DCIM')?.dir && xv.list(xv.find('DCIM')).length === 1 && xv.find('DCIM/NONE.JPG') === null && xv.find('DCIM/P1010001.JPG/X') === null, 'a subdirectory by its entry; a missing name and a path through a file: null');
  ok(xv.freeClusters() === x.count - 8 && xv.fsInfo() === null && xv.backupMatches() && xv.check().length === 0, `free clusters by the bitmap ${xv.freeClusters()} of ${x.count}; no FSInfo; the backup boot region the main one's; consistent: ${xv.check()}`);
  // what the reader refuses or reports: each on a fresh volume with one thing changed
  const changed = (change) => { const y = buildExfat(); change(y); return y; };
  const vol = (y) => new ExfatVolume(y.read, y.start);
  ok(throwsLike(() => vol(changed((y) => { y.disk[y.sec(0) + 100] ^= 1; })), /boot checksum/), 'a changed volume serial: the boot checksum refused');
  const flagged = vol(changed((y) => { y.disk[y.sec(0) + 106] = 2; y.disk[y.sec(0) + 112] = 50; }));
  ok(flagged.dirty && flagged.percentInUse === 50, 'VolumeFlags and PercentInUse are outside the boot checksum (a dirty volume opens)');
  ok(throwsLike(() => vol(changed((y) => { y.disk[y.cl(3) + 10] ^= 1; })), /up-case/), 'a changed up-case table: its checksum refused');
  ok(throwsLike(() => vol(changed((y) => { y.disk[y.dcimAt + 4] ^= 1; })).list(), /set checksum/), 'a changed file entry: its set checksum refused');
  ok(throwsLike(() => vol(changed((y) => { y.disk[y.dcimAt + 36] ^= 1; y.reseal(y.dcimAt); })).list(), /name hash/), 'a wrong name hash under a right set checksum: refused');
  ok(throwsLike(() => vol(changed((y) => y.setFat(8, 6))).chain(6), /loops/), 'a looping chain is refused');
  const unmarked = vol(changed((y) => { y.disk[y.cl(2) + 1] &= 0xfe; })).check();
  ok(unmarked.length === 1 && /cluster 10 .*P1010001\.JPG.* free in the bitmap/.test(unmarked[0]), `a file's cluster free in the bitmap is reported: ${unmarked}`);
  const leaked = vol(changed((y) => { y.disk[y.cl(2)] |= 1 << 5; })).check();
  ok(leaked.length === 1 && /1 cluster\(s\) allocated .*the first 7/.test(leaked[0]), `a cluster the bitmap allocates to nothing is reported: ${leaked}`);
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

// (firmware) the play session's card on the model of OM_EMU_MODEL (E143 by default), a body whose file system runs
// natively (src/fw/models.mjs card_fs); the HLS media side's parts where it runs that too (card_fs.hls)
export async function storageSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const P = await import('../src/lab/play.mjs');
  const { labEnv, loadBlock } = await import('../checks/lib/env.mjs');
  const { A, MODEL, ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  if (!STORAGE) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs does not run the card's file system natively`] };
  const resBlock = loadBlock();
  const { SHOTS, MOVIE } = cardQueries(A);
  // the first picture's file: the DCF module's initial names (src/fw/facts.mjs fileSystem names)
  // the bodies whose DCF remain movie time answers 0 on the card (the E144 family but the E142 lineage; X, its reason
  // ?, docs/hle-gaps.md 4.8.4): strictly, so an answer flags the table; S-SCENE's live view on the E143 family only
  // (its banks are E143's: on the E144 family 0x50534dd1's address is not the table's, X)
  const MOVIE_ZERO = ['E144', 'E139', 'E137', 'E125'].includes(MODEL), LIVE_VIEW = BOARD.family === 'E143';
  const names = STORAGE.names, DIR = `DCIM/100${names.folder}`, FILE1 = `${DIR}/${names.file}0001.${names.ext}`;
  let saved = null;
  const session = (card) => {
    const env = { ...labEnv({ resBlock }), card };
    const s = new P.PlaySession(env, { opts: { start: 'shooting', touch: 'off', us_clock: 'lab' }, lang: 'en', device: 'tft', start: [7, 1, 1], out: null, tag: 'play', png: 'none' });
    s.enter();
    return s;
  };
  // the firmware's counts once the shooting screen shows them (S1 leaves the date prompt; X: E146's movie time query
  // answers 0 before, at the date prompt; why is not read)
  const native = (s) => {
    s.key('s1', 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 150e6); s.key('s1', 'up'); s.camapp.pump();
    s.idle_slice(s.lab.lab_time() + 1500e6);
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
    ok((ON_LAB_MODEL ? vol.label === 'OM SYSTEM  ' : vol.label.trim() !== '') && vol.fsType === 'FAT32   ', `the firmware's label and type: '${vol.label}' '${vol.fsType}'`);
    const fsi = vol.fsInfo(), free = vol.freeClusters();
    ok(fsi !== null && fsi.free === free, `FSInfo's free count ${fsi?.free} is the FAT's ${free}`);
    ok(vol.total <= blank.sectors - vol.start, 'the partition fits the card');
    first = native(s);
    ok(first.shots > 0 && (MOVIE_ZERO ? first.movie_ms === 0 : first.movie_ms > 0), `the firmware's remaining shots and movie time from the card${MOVIE_ZERO ? ' (the movie time 0, hle-gaps.md 4.8.4)' : ''}: ${JSON.stringify(first)}`);
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
      for (const inp of [...(LIVE_VIEW ? [{ type: 'scene', change: { liveview: true } }] : []), { type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' },
        { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' }, { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }]) pl.run_input(inp);
      const s2 = pl.session, img = s2.camapp.images[0];
      ok(img?.file?.path === `${names.drive}:\\${FILE1.replaceAll('/', '\\')}`, `S2 wrote the picture's file: ${JSON.stringify(img?.file)}`);
      const want = img ? jpegOfFrame(s2.picture_frame(s2.camapp.views.get(img.release) ?? null)) : null;
      const vol = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
      const e = vol.find(FILE1);
      ok(e && !e.dir && want && e.size === want.length, `the directory entry ${FILE1}: ${JSON.stringify(e && { size: e.size, cluster: e.cluster })}, the JPEG ${want?.length} bytes`);
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
  // the HLS media side (Card Formatting, the card out and in) where the body runs it (src/fw/models.mjs card_fs.hls)
  if (STORAGE.hls) {
    // Card Formatting from the menu (S-MDACTRL, media.mjs) after a picture: the format reaches the card from the
    // firmware's own request, the card read back independently is freshly formatted, the counts reset, the application
    // leaves Busy for the menu
    {
      const { loadImage, createHash } = await import('../checks/lib/env.mjs');
      const { Player } = await import('../src/lab/player.mjs');
      const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
      const { runtime } = await import('../src/lab/hle.mjs');
      const card = new SdCard();
      const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
        { rom: loadImage(), resBlock, createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
      const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 100e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 400e6); };
      const frame = (s) => { const [w, h, words] = s.frame('boundary'); return { w, h, words }; };
      const rows = (f, y0, y1) => { const a = f.words.slice(y0 * f.w, y1 * f.w), b = []; for (const x of a) b.push(x); return b.join(','); };
      try {
        pl.open_session();
        const s = pl.session, lab = s.lab;
        s.idle_slice(lab.lab_time() + 1500e6);
        const fresh = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start).freeClusters();
        press(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
        const vol0 = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
        ok(vol0.find('DCIM/100OMSYS/P1010001.JPG') && vol0.freeClusters() < fresh && s.camapp.images.length === 1, `before the format: the picture's file on the card, ${vol0.freeClusters()} of ${fresh} clusters free`);
        press(s, 'menu');
        const menu = frame(s);
        for (const k of ['ok', 'ok', 'up', 'ok', 'up', 'ok']) press(s, k);
        const busy = frame(s), media = s.camapp.media;
        ok(media.ctrl !== null || media.formats === 1, 'Format Card, Yes: the media control start reached S-MDACTRL');
        for (let i = 0; i < 100 && media.formats === 0; i++) s.idle_slice(lab.lab_time() + 50e6);
        s.idle_slice(lab.lab_time() + 1000e6);
        ok(media.formats === 1 && media.ctrl === null, `the format finished: ${JSON.stringify(media.status())}`);
        const vol = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
        ok(vol.type === 'FAT32' && vol.label === 'OM SYSTEM  ' && vol.list().length === 0, `read back: a FAT32 'OM SYSTEM' volume with an empty root: ${JSON.stringify(vol.list().map((e) => e.name))}`);
        ok(!vol.find('DCIM/100OMSYS/P1010001.JPG') && vol.freeClusters() === fresh && vol.fsInfo()?.free === fresh, `the picture is gone: ${vol.freeClusters()} clusters free (FSInfo ${vol.fsInfo()?.free}), a fresh volume's ${fresh}`);
        const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);   // S-CARD's image count (camapp.mjs IMAGE_COUNT) aside
        lab.hooks.delete(key);
        const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0;
        lab.hooks.set(key, hook);
        ok(n === 0 && s.camapp.images.length === 0 && s.storage.next_file === 1, `the counts reset: the firmware's image count ${n}, S-CARD's ${s.camapp.images.length}, next file ${s.storage.next_file}`);
        const after = frame(s);
        ok(rows(after, 0, 130) === rows(menu, 0, 130) && rows(after, 200, 600) !== rows(busy, 200, 600), 'the application left Busy for the menu (its tab bar and title as before the format)');
        ok(pl.stand_ins_in_use().includes('S-MDACTRL'), 'the player lists S-MDACTRL');
      } catch (e) { bad.push(`menu format: ${e.message.slice(0, 400)}`); }
      try { pl.close_session(); } catch { /* closed */ }
    }
    // The card taken out and put back while the camera runs (S-MEDIA, media.mjs): the card switch through UI_IN, the
    // firmware unmounts and the screen loses the card's counts; back in, the firmware initialises and mounts the card
    // again and the counts come back
    {
      const { loadImage, createHash } = await import('../checks/lib/env.mjs');
      const { Player } = await import('../src/lab/player.mjs');
      const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
      const card = new SdCard();
      const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
        { rom: loadImage(), resBlock, createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
      const box = (s) => { const [w, , words] = s.frame('boundary'), out = []; for (let y = 0; y < 45; y++) for (let x = 230; x < 460; x++) out.push(words[y * w + x]); return out.join(','); };
      try {
        pl.open_session();
        const s = pl.session, lab = s.lab, st = s.storage, media = s.camapp.media;
        s.idle_slice(lab.lab_time() + 1500e6);
        s.key('s1', 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 100e6); s.key('s1', 'up'); s.camapp.pump();   // the date prompt off
        s.idle_slice(lab.lab_time() + 1000e6);
        const counts = box(s), shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0, cmds = st.commands;
        const detect = lab.sim.read(st.f.detect, 2)[0];
        const out = pl.run_input({ type: 'card', action: 'remove' });
        s.idle_slice(lab.lab_time() + 500e6);
        ok(!st.card.present && !st.mounted && lab.sim.read(st.f.detect, 2)[0] === 1 && media.mount_state(4) === 0, `out: the drive unmounted (detect state ${lab.sim.read(st.f.detect, 2)[0]}, HLS mount state ${media.mount_state(4)}, ${out?.card?.drive_status})`);
        ok(out?.uiin_codes?.includes('0x02021506') && media.level() === 1, `out: UI_IN decoded the card switch (${JSON.stringify(out?.uiin_codes)}), level ${media.level()}`);
        ok(box(s) !== counts, 'out: the screen lost the card\'s counts');
        let refused = false;
        try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { refused = /out of the slot already/.test(e.message); }
        ok(refused, 'a second removal is refused');
        const back = pl.run_input({ type: 'card', action: 'insert' });
        s.idle_slice(lab.lab_time() + 500e6);
        ok(st.card.present && st.mounted && st.insertions === 1 && lab.sim.read(st.f.detect, 2)[0] === detect && media.mount_state(4) === 8, `in: the firmware mounted the card again (${back?.card?.drive_status}, detect state ${lab.sim.read(st.f.detect, 2)[0]}, ${detect} at the start)`);
        ok(st.commands - cmds > 20 && card.log.some(([i]) => i === 2), `in: sd_mount initialised the card again (${st.commands - cmds} SD commands, CMD2 among them)`);
        const shots2 = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
        ok(shots2 === shots && box(s) === counts, `in: the counts are back (${shots2} shots, the screen's counts as before)`);
        ok(pl.stand_ins_in_use().includes('S-MEDIA'), 'the player lists S-MEDIA');
      } catch (e) { bad.push(`card out and in: ${e.message.slice(0, 400)}`); }
      try { pl.close_session(); } catch { /* closed */ }
    }
  }
  // a 4 GiB card: the firmware's count follows the card
  s = session(host(new SdCard({ sectors: 8388608 })));
  try {
    const four = native(s);
    ok(first && four.shots < first.shots && (MOVIE_ZERO ? four.movie_ms === 0 : four.movie_ms < first.movie_ms), `a 4 GiB card has fewer shots and less movie time: ${JSON.stringify(four)} against ${JSON.stringify(first)}`);
  } catch (e) { bad.push(`4 GiB session: ${e.message.slice(0, 400)}`); }
  s.close();
  return { checks, bad };
}

// A card's volume in one line: the MBR's partition and the file system's layout (for the notes)
function layout(p, v) {
  const part = p ? `MBR partition type 0x${p.type.toString(16)} at ${p.start} (${p.sectors} sectors)` : 'no MBR';
  const geo = v.type === 'exFAT'
    ? `FAT at +${v.fatOffset} (${v.nfats} x ${v.fatLength} sectors), cluster heap at +${v.heapOffset}, root at cluster ${v.rootCluster}, revision ${v.revision >> 8}.${v.revision & 0xff}, serial 0x${v.serial.toString(16)}, PercentInUse ${v.percentInUse}`
    : `${v.reserved} reserved sectors, ${v.nfats} FATs of ${v.fatSize} sectors, serial 0x${v.serial.toString(16)}`;
  return `${part}; ${v.type} '${v.label.trim()}', ${v.spc * SECTOR / 1024} KiB clusters, ${v.clusters} of them, ${v.freeClusters()} free; ${geo}`;
}

// (firmware) blank SDXC cards (64 and 128 GiB) in a player on the body of OM_EMU_MODEL (E143 by default; its card_fs
// native). The firmware's code for a card above 32 GiB is not read; E143's format gives the card exFAT in an MBR
// partition (X, docs/hle-gaps.md 4.8.6), and another body's may differ. So this checks only what holds whichever
// file system the firmware picks (the insertion formats the blank card and mounts it, the volume reads back
// independently through refs/volume.mjs and is consistent, S2's picture file is found with its bytes, the firmware
// counts remaining shots from the card) and reports what it finds as notes: the insertion's lab times, the partition
// and the file system's layout, the remaining shots and the movie time (803 shots and 5:25 on the 8 GiB
// card, docs/hle-gaps.md 4.8.2; the shooting screen draws the query's answer, modelcheck's count probe)
export async function storageSdxc(sizes = [64, 128]) {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A, MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  if (!STORAGE) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs does not run the card's file system natively`], notes };
  const { SHOTS, MOVIE } = cardQueries(A), rom = loadImage(), resBlock = loadBlock();
  const names = STORAGE.names, FILE1 = `DCIM/100${names.folder}/${names.file}0001.${names.ext}`, LIVE_VIEW = BOARD.family === 'E143';
  for (const gib of sizes) {
    const card = new SdCard({ sectors: cardSectors(gib) }), tag = `${MODEL} ${gib} GiB ${card.kind}`;
    const read = (lba, n) => card.read(lba, n);
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
      { rom, resBlock, createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
    try {
      pl.open_session();
      const st = pl.session.steps.find((x) => x.storage)?.storage;
      ok(st && st.mounted && st.formatted, `${tag}: the insertion formatted the blank card and mounted it: ${JSON.stringify(st && { mounted: st.mounted, formatted: st.formatted, drive_status: st.drive_status })}`);
      notes.push(`${tag}: the insertion: ${(st?.log ?? []).filter(([k]) => ['mount', 'format', 'drive'].includes(k)).map(([k, d]) => `${k} ${d}`).join('; ')}`);
      const vol = openVolume(read);
      notes.push(`${tag}: ${layout(mbrPartition(read(0, 1)), vol)}`);
      ok(vol.start + vol.total <= card.sectors, `${tag}: the volume (${vol.total} sectors at ${vol.start}) fits the card's ${card.sectors}`);
      if (vol.type === 'exFAT') {
        const problems = vol.check();
        ok(problems.length === 0 && vol.backupMatches(), `${tag}: the firmware's exFAT volume is consistent (refs/exfat.mjs check) and its backup boot region the main one's: ${problems.slice(0, 5).join('; ')}`);
      } else {
        const fsi = vol.fsInfo(), free = vol.freeClusters();
        ok(fsi !== null && fsi.free === free, `${tag}: FSInfo's free count ${fsi?.free} is the FAT's ${free}`);
      }
      // S2 with S-SCENE's live view (the E143 family): the picture's file through the file module (S-RECFILE)
      for (const inp of [...(LIVE_VIEW ? [{ type: 'scene', change: { liveview: true } }] : []), { type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' },
        { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' }, { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }]) pl.run_input(inp);
      const s = pl.session, lab = s.lab, img = s.camapp.images[0];
      const want = img ? jpegOfFrame(s.picture_frame(s.camapp.views.get(img.release) ?? null)) : null;
      const vol2 = openVolume(read), e = vol2.find(FILE1);
      ok(e && !e.dir && want && e.size === want.length && vol2.data(e).every((b, i) => b === want[i]), `${tag}: S2's file ${FILE1} read back with the JPEG's bytes: ${JSON.stringify(e && { size: e.size, cluster: e.cluster })}, the JPEG ${want?.length} bytes`);
      if (vol2.type === 'exFAT') {
        const problems = vol2.check();
        ok(problems.length === 0, `${tag}: the volume is consistent after the file: ${problems.slice(0, 5).join('; ')}`);
      }
      // the counts once the shooting screen shows them (S1 has left the date prompt)
      s.idle_slice(lab.lab_time() + 1500e6);
      const shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0, buf = lab.alloc(new Uint8Array(24), 4);
      lab.call(MOVIE, { a0: buf }, null, null, 2000000);
      const m = lab.sim.read(buf, 24), movie = (m[0] | m[1] << 8 | m[2] << 16 | m[3] << 24) >>> 0;
      ok(shots > 0, `${tag}: the firmware counts remaining shots from the card: ${shots}`);
      notes.push(`${tag}: remaining shots ${shots}, movie time ${movie} (the query's first word, as storageSession reads it), with one picture on the card`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
  }
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = storageUnits();
  console.log(`card, FAT and exFAT reader units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const s = await storageSession();
    console.log(`card and file system in play: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  if (process.argv.includes('--sdxc')) {
    const x = await storageSdxc();
    console.log(`SDXC cards in play: ${x.checks - x.bad.length}/${x.checks}`);
    x.notes.forEach((t) => console.log('   note:', t));
    x.bad.forEach((t) => console.log('  ', t));
    n += x.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
