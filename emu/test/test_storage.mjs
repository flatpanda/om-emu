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
//                   file's JPEG through the independent decoder (refs/jpeg.mjs): its size, sampling and block means;
//                   the independent Exif reader (refs/exif.mjs) on an APP1 this test builds, and its refusals; the
//                   menu walker (src/lab/menuwalk.mjs) on menus this test draws: the screen's texts, a list's rows,
//                   the cursor's row in both looks, the walks to the Format's Yes and their refusals
//   storageSession  (firmware) play sessions on the body of OM_EMU_MODEL (E143 by default; its card_fs native): the
//                   file system's bring-up and the card's insertion (H-FILEINIT, S-SDCARD, S-CARD) leave the drive
//                   mounted by the firmware's own path, on a blank card the firmware formatted itself; the card read
//                   independently (refs/fat.mjs): an MBR with one FAT32 partition, the firmware's boot sector (FAT32;
//                   on E143 'OM SYSTEM'), FSInfo's free count against the FAT's; the firmware's
//                   remaining shots and movie time from the card (the queries S-CARD answered before), smaller on a 4 GiB
//                   card; a saved card (env.card) mounts in the next session without a format, and a player keeps
//                   its card across a power cycle; S2 with the live view writes the picture's file (S-RECFILE; on
//                   E143, E146, E147, the E118 family and the E144 family but E145 and E132 REC_FILE natively, the
//                   clock set first): its directory entry, size and bytes
//                   read back independently (natively the firmware's header, its Make, the body's Model and Exif
//                   version, dates, maker notes and thumbnail slot read by refs/exif.mjs, then the lab's stream;
//                   REC_IMAGE's own task made it from S-RECREQ's packet: the encode in task 28 (S-JPEGENC from
//                   ImageParam's parameter set on; before it the error logs of ImageParam's four sources' lookups
//                   only), the header area cleared by the imgpro unit's fill natively, REC_FILE's reply, pAlive
//                   cleared, the aspect from the setting and the ISO from the record's +38174 0, the EXIF set run
//                   natively once after H-RECPRECON (its resolution, zoom ratio and its conversions of the template's
//                   zero exposure in the file; a fresh block with the clock moved gets the new date from the set and
//                   none without it), on E143, E146 and E147; on the E118 family REC_FILE's own four requests to the file module
//                   each answered 0, its own cluster allocation of the file's bytes and its reply taken, the whole
//                   stream after the header, the directory entry's stamp the clock's, then a second picture, PLAY
//                   and back and a third: the firmware's own numbers, counts, clusters and the FAT's free count
//                   follow each), the JPEG decoded
//                   (refs/jpeg.mjs) to the capture's block means, and the next session's DCF numbering mount and
//                   image count find it; where the body runs the HLS media side (card_fs.hls) Card Formatting from
//                   the menu (S-MDACTRL on E143, E146, E147 and E148; S-MDAEND where the application formats the card
//                   itself), the menu's path walked by what the firmware draws (src/lab/menuwalk.mjs): the card read
//                   back is freshly formatted, the counts reset and the application returns to the menu; the card out
//                   and back in (S-MEDIA): the drive unmounted and the screen without the counts, then mounted again
//                   by the firmware with the counts back
//   storageSdxc     (firmware) blank 64 and 128 GiB SDXC cards on the body of OM_EMU_MODEL: formatted and mounted by
//                   the firmware, read back independently whichever file system it chose (refs/volume.mjs) and
//                   consistent, S2's file found with its bytes, the remaining shots counted; where the body runs the
//                   HLS media side, on a 64 GiB card Card Formatting from the menu (the volume formatted again with
//                   the file system it had, consistent, the counts reset) and the card out and in (unmounted, then
//                   mounted again without a format, the counts back); what the firmware chose (exFAT on E143,
//                   docs/hle-gaps.md 4.8.6: the layout, the cluster size), the lab times and the counts are reported
//                   as notes
//   storageHls      (firmware, --hls) the HLS media side alone on the body of OM_EMU_MODEL (the E118 family's and
//                   the E144 family's: Format from Card Setup, then S2's picture on the formatted card; the card out,
//                   the camera's no-card state, the card in, its count back, then S2's picture on it; E143's line:
//                   Card Formatting, the card out and in)
//   storageSlots    (firmware, --slot2) the second card slot on the body of OM_EMU_MODEL (card_fs.second_slot: E143,
//                   E146; docs/hle-gaps.md 4.8.12): with one card the SD driver's detect, the drive status and the
//                   media status give slot 2 empty, its port gets no command, S-CARD's media flags are 1 and 0, the
//                   firmware's remaining shots are 0 with the save slot at slot 2 and S2 makes no file there, and
//                   the first slot's card is refused for the second; with two cards both mount, each from its own
//                   card, the menu's movie Card Slot Settings row is enabled, S2's file lands on the card of the
//                   save slot (read back independently on that card alone), each card goes out and in while the
//                   camera runs; a blank card put into the empty slot stays unformatted (out and in again too) until
//                   Card Formatting formats it from the menu, and the player keeps it for its next session; the
//                   double-slot save modes stop the session; on E143 under control camapp 3 the firmware's own media
//                   manager does the same: one card, its menu camapp 1's, a blank card in and out; two cards mounted
//                   by it, S2 on the second, the second out and in
//   node emu/test/test_storage.mjs [--session] [--sdxc] [--hls] [--slot2]
import { SdCard, NO_RESPONSE, SECTOR, crc7, r2Words, cardImage, cardFromImage, cardSectors, memorySlot } from '../src/lab/sdcard.mjs';
import { FatVolume, mbrPartition } from '../refs/fat.mjs';
import { ExfatVolume } from '../refs/exfat.mjs';
import { openVolume } from '../refs/volume.mjs';
import { jpegOfFrame } from '../src/lab/jpeg.mjs';
import { decodeJpeg } from '../refs/jpeg.mjs';
import { readExif, jpegSegments } from '../refs/exif.mjs';
import { MODELS } from '../src/fw/models.mjs';
import { screenTexts, rowsOf, bandColour, cursorOf, MenuWalk, TEXT_LAYER, CLEAR_COLOUR } from '../src/lab/menuwalk.mjs';

const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const cmd = (index, rt, acmd = false) => index | (acmd ? 0x40 : 0) | rt << 8;
// the remaining-shots and movie time queries (S-CARD's queries before: camapp.mjs SHOTS_QUERY, MOVIE_TIME_QUERY), at
// the model's addresses (A: src/fw/model.mjs)
const cardQueries = (A) => ({ SHOTS: A(0x50419164), MOVIE: A(0x5042DA58) });
// What each body's firmware writes in the file's Exif where REC_FILE runs natively (src/lab/rec.mjs): IFD0's Model
// and the Exif version (X, read by refs/exif.mjs and exiftool, 2026-11-08; the Model strings are in each image, D:
// E143 'OM-1' at body 0x76da8, E146 'OM-1MarkII' at 0x8c300, E147 'OM-3' at 0x74a84), the maker notes' 'OM SYSTEM'
// on all three; the E144 family's (X, 2026-11-10, refs/exif.mjs and exiftool): Make 'OM Digital Solutions', the maker
// notes 'OM SYSTEM' and an XMP segment after the Exif on E144 and E148, Make 'OLYMPUS CORPORATION', 'OLYMPUS' and no
// XMP on the six others; E130's, E133's and E129's (X, 2026-11-11, refs/exif.mjs and exiftool: the REC version before
// the family's, src/fw/facts.mjs recFileInline; the Model strings in each image, D: E130 'E-M10 Mark III' at body
// 0x60a74, E133 'E-PL9' at 0x589c0, E129 'TG-5' at 0x5cdd0), as the six; the E118 family's (X, 2026-11-10 with the
// header maker alone, 2026-11-11 with REC_FILE natively; refs/exif.mjs): the Make and Model the EXIF template's init
// takes from the settings store (the Model strings are in each image, D: E122 'PEN-F' at 0x6009698c, E118 'E-M5MarkII'
// at 0x600a8560, E120 'E-M10MarkII' at 0x600a5bec; E118's Make is not a string of its main block, X), the Exif version
// '0230', the maker notes' 'OLYMPUS' and no XMP on all three
const OM = { make: 'OM Digital Solutions', notes: 'OM SYSTEM', xmp: true }, OLY = { make: 'OLYMPUS CORPORATION', notes: 'OLYMPUS', xmp: false };
const EXIF_BODY = { E143: { model: 'OM-1', version: '0231', ...OM }, E146: { model: 'OM-1MarkII', version: '0231', ...OM }, E147: { model: 'OM-3', version: '0300', ...OM },
  E144: { model: 'OM-5', version: '0231', ...OM }, E148: { model: 'OM-5MarkII', version: '0300', ...OM }, E139: { model: 'E-M1MarkIII', version: '0231', ...OLY },
  E134: { model: 'E-M1X', version: '0231', ...OLY }, E137: { model: 'E-M5MarkIII', version: '0231', ...OLY }, E142: { model: 'E-P7', version: '0231', ...OLY },
  E140: { model: 'E-M10MarkIV', version: '0231', ...OLY }, E125: { model: 'E-M1MarkII', version: '0230', ...OLY },
  E130: { model: 'E-M10 Mark III', version: '0231', ...OLY }, E133: { model: 'E-PL9', version: '0231', ...OLY }, E129: { model: 'TG-5', version: '0231', ...OLY },
  E122: { model: 'PEN-F', version: '0230', ...OLY }, E118: { model: 'E-M5MarkII', version: '0230', ...OLY, make: 'OLYMPUS IMAGING CORP.' },
  E120: { model: 'E-M10MarkII', version: '0230', ...OLY } };

// A FAT32 volume built here, for the reader: [read(lba, n), the files' bytes]. 70000 sectors at LBA 2048, 512-byte
// clusters: 68880 clusters, past FAT16's 65524, so FAT32 by the specification's cluster count; FSInfo's free count
// the FAT's (68876). Also the host writer's FAT32 volume (test/test_cardfs.mjs)
export function buildFat32() {
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
  put32(fi, 0x41615252); put32(fi + 484, 0x61417272); put32(fi + 488, 68876); put32(fi + 492, 6); disk[fi + 510] = 0x55; disk[fi + 511] = 0xaa;
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
  // the independent Exif reader (refs/exif.mjs) on an APP1 this test builds (big-endian, TIFF 6.0 and CP-3451's
  // layout): IFD0 with Make (ASCII), Orientation (SHORT) and the Exif IFD's pointer, which holds DateTimeOriginal and
  // FNumber (RATIONAL); a bad TIFF magic and an offset out of the segment are refused
  {
    const be16 = (v) => [v >> 8 & 255, v & 255], be32 = (v) => [v >>> 24, v >> 16 & 255, v >> 8 & 255, v & 255];
    const ent = (tag, type, n, v) => [...be16(tag), ...be16(type), ...be32(n), ...v];
    const make = [...'Lab Make\0'].map((c) => c.charCodeAt(0)), dto = [...'2026:11:08 12:34:56\0'].map((c) => c.charCodeAt(0));
    // TIFF header 8, IFD0 at 8 (3 entries: 2 + 36 + 4 = 42) -> Make's bytes at 50, the Exif IFD at 60 (2 entries: 30)
    // -> DateTimeOriginal at 90, FNumber at 110
    const tiff = [0x4d, 0x4d, ...be16(42), ...be32(8), ...be16(3), ...ent(0x10f, 2, make.length, be32(50)), ...ent(0x112, 3, 1, [...be16(6), 0, 0]),
      ...ent(0x8769, 4, 1, be32(60)), ...be32(0), ...make, 0, ...be16(2), ...ent(0x9003, 2, dto.length, be32(90)), ...ent(0x829d, 5, 1, be32(110)),
      ...be32(0), ...dto, ...be32(28), ...be32(10)];
    const app1 = (t) => [0xff, 0xe1, ...be16(t.length + 8), 0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
    const file = (t) => Uint8Array.from([0xff, 0xd8, ...app1(t), 0xff, 0xda, 0, 2]);
    const x = readExif(file(tiff));
    ok(x?.order === 'MM' && x.ifd0.get(0x10f) === 'Lab Make' && x.ifd0.get(0x112) === 6 && x.exif?.get(0x9003) === '2026:11:08 12:34:56'
      && JSON.stringify(x.exif.get(0x829d)) === '[28,10]' && x.ifd1 === null, `refs/exif.mjs reads the built APP1: ${x && JSON.stringify([x.order, x.ifd0.get(0x10f), x.ifd0.get(0x112), x.exif?.get(0x9003), x.exif?.get(0x829d)])}`);
    ok(jpegSegments(file(tiff)).map((g) => g.marker).join() === [0xd8, 0xe1, 0xda].join(), 'the segments: SOI, APP1, SOS');
    const bad42 = [...tiff]; bad42[3] = 43;
    ok(throwsLike(() => readExif(file(bad42)), /magic/), 'a TIFF header without 42 is refused');
    const far = [...tiff]; far.splice(18, 4, ...be32(500));
    ok(throwsLike(() => readExif(file(far)), /out of the segment/), 'a tag\'s value out of the segment is refused');
    ok(readExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])) === null, 'a JPEG without an Exif APP1 reads as none');
  }
  menuWalkUnits(ok);
  // the second slot's holder between a player's sessions (memorySlot): empty until a card is put in, then that card
  {
    const slot = memorySlot(), c = new SdCard();
    ok(slot.open() === null, 'memorySlot: no card until one is put in');
    slot.put(c);
    c.remove();
    ok(slot.open() === c && slot.open().present === false, 'memorySlot: the card put in, out of the slot as it was left');
    slot.save(c);
    ok(slot.open() === c, 'memorySlot: save keeps the card');
  }
  return { checks, bad };
}

// The menu walker (src/lab/menuwalk.mjs) on menus this test draws: each a set of screens {title, rows, cursor (a row
// or null: on the tabs), page (the page's colour)}, drawn as the lab's observers record a body's (a full clear of the
// text layer, the title, the rows; the graphics context's origin negated) into a frame of 320 x 240. Two looks:
// 'frame', the Menu_Viewer bodies' (the cursor a mark over the page, the menu opened on the tabs, the dialogs on a page
// of another colour, the selected row's text in another colour), and 'bar', the ListMenu bodies' (every row a bar, the
// cursor's of another colour; a title drawn as the rows are; a card choice whose rows are pictures)
function menuWalkUnits(ok) {
  const W = 320, H = 240, X = 40, ROW = [200, 20], PITCH = 26, SEL = 0xcc3366, BAR = 0x333333;
  const menu = (look, screens, start) => {
    const m = { at: start, draws: [], keys: [], done: false };
    const draw = () => {
      const scr = screens[m.at], text = (t, y, colour) => m.draws.push({ op: 'text', text: t, colour, box: [0, 0, ROW[0] - 1, ROW[1] - 1], origin: [-X, -y], draw_offset: [0, 0] });
      m.draws.push({ op: 'rect', x: 0, y: 0, w: W, h: H, colour: CLEAR_COLOUR, layer: TEXT_LAYER });
      if (look === 'bar') text(scr.title, 0, 16); else m.draws.push({ op: 'text', text: scr.title, colour: 25, box: [0, 0, 279, 19], origin: [-20, -4], draw_offset: [0, 0] });
      scr.rows.forEach((t, i) => text(t, scr.top + PITCH * i, look === 'frame' && i === scr.cursor ? 34 : 22));
    };
    m.frame = () => {
      const scr = screens[m.at], words = new Uint32Array(W * H).fill(scr.page);
      scr.rows.forEach((t, i) => {
        const colour = i === scr.cursor ? SEL : look === 'bar' ? BAR : null, y = scr.top + PITCH * i;
        if (colour !== null) for (let yy = y; yy < y + ROW[1]; yy++) words.fill(colour, yy * W + X - 14, yy * W + X + ROW[0]);
      });
      return [W, H, words];
    };
    m.press = (key) => {
      const scr = screens[m.at];
      m.keys.push(key);
      if (scr.cursor === null) {
        if (key === 'down') m.at = scr.next; else if (key === 'right') scr.cursor = 0; else throw new Error(`${key} on the tabs`);
      } else if (key === 'down' || key === 'up') scr.cursor = (scr.cursor + (key === 'down' ? 1 : scr.rows.length - 1)) % Math.max(scr.rows.length, 1);
      else if (key === 'ok') { const to = scr.ok[scr.rows.length ? scr.rows[scr.cursor] : '']; if (to === 'done') m.done = true; else if (to === undefined) throw new Error(`OK on ${scr.rows[scr.cursor]}`); else m.at = to; }
      else throw new Error(`${key} in a list`);
      draw();
    };
    draw();
    return m;
  };
  const GOALS = [{ row: ['Card Formatting', 'Card Setup'] }, { pass: ['Select Card to Set Up'], key: 'ok' }, { row: ['Format Card', 'Format'] }, { row: ['Yes'] }];
  const walk = (m) => { const w = new MenuWalk({ press: m.press, frame: m.frame, draws: () => m.draws }); w.to(GOALS); return w; };
  const viewer = () => menu('frame', {
    shoot: { title: 'Shooting Menu 1', rows: ['Reset', 'Picture Mode', 'Image Aspect'], cursor: null, top: 40, page: 0, next: 'setup' },
    setup: { title: 'Setup Menu', rows: ['Clock', 'Card Setup', 'Language', 'Firmware'], cursor: null, top: 40, page: 0, next: 'shoot', ok: { 'Card Setup': 'card' } },
    card: { title: 'Card Setup', rows: ['All Erase', 'Format'], cursor: 0, top: 100, page: 0x0a0a0a, ok: { Format: 'yes' } },
    yes: { title: 'Format', rows: ['Yes', 'No'], cursor: 1, top: 120, page: 0x0a0a0a, ok: { Yes: 'done' } },
  }, 'shoot');
  const list = (slots) => menu('bar', {
    main: { title: '1.Card/Folder/File', rows: ['Card Formatting', 'Assign Save Folder', 'File Name', 'Edit Filename'], cursor: 0, top: 60, page: 0x0a0a0a, ok: { 'Card Formatting': slots === 2 ? 'select' : 'card' } },
    select: { title: 'Select Card to Set Up', rows: [], cursor: 0, top: 100, page: 0x0a0a0a, ok: { '': 'card' } },
    card: { title: 'Card Formatting', rows: ['Format Card', 'No'], cursor: 1, top: 150, page: 0x0a0a0a, ok: { 'Format Card': 'yes' } },
    yes: { title: 'Format Card', rows: ['Yes', 'No'], cursor: 1, top: 150, page: 0x0a0a0a, ok: { Yes: 'done' } },
  }, 'main');
  // the screen's texts and a list's rows
  const v = viewer(), texts = screenTexts(v.draws, [W, H]), reset = texts.find((t) => t.text === 'Reset');
  ok(texts.length === 4 && reset.box.join() === [X, 40, X + ROW[0] - 1, 40 + ROW[1] - 1].join(), `screenTexts: the title and three rows, each at its box on the screen: ${JSON.stringify(texts.map((t) => [t.text, t.box]))}`);
  ok(rowsOf(texts, reset).map((t) => t.text).join() === 'Reset,Picture Mode,Image Aspect' && rowsOf(texts, texts.find((t) => t.text === 'Shooting Menu 1')).length === 1, 'rowsOf: the three rows from the top; the title is a list of its own');
  v.draws.push({ op: 'rect', x: 0, y: 60, w: W, h: 60, colour: CLEAR_COLOUR, layer: TEXT_LAYER }, { op: 'text', text: 'Art', colour: 22, box: [0, 0, ROW[0] - 1, ROW[1] - 1], origin: [-X, -66], draw_offset: [0, 0] });
  ok(screenTexts(v.draws, [W, H]).map((t) => t.text).join() === 'Shooting Menu 1,Reset,Art', `a partial clear takes the texts it covers, a later draw at a place replaces the earlier: ${screenTexts(v.draws, [W, H]).map((t) => t.text)}`);
  ok(throwsLike(() => screenTexts(v.draws.filter((e) => e.w !== W), [W, H]), /no full clear/), 'no full clear of the text layer among the draws: refused');
  const l = list(1), lt = screenTexts(l.draws, [W, H]), lrows = rowsOf(lt, lt.find((t) => t.text === 'File Name'));
  ok(lrows.length === 4 && lrows[0].text === 'Card Formatting', `rowsOf: a title drawn as the rows are, off their pitch, is not a row: ${lrows.map((t) => t.text)}`);
  // the cursor
  const bands = lrows.map((r) => bandColour(l.frame(), r.box));
  ok(bands.join() === [SEL, BAR, BAR, BAR].join() && bandColour(l.frame(), [4, 0, 40, 19]) === null, 'bandColour: the bar left of each row\'s text; no band where the strip leaves the frame');
  ok(JSON.stringify(cursorOf(bands, 0x0a0a0a, null)) === JSON.stringify({ cursor: 0, bar: BAR }) && cursorOf([0, 0, 0], 0x202020, null).cursor === null && cursorOf([0, 0, 0], 0, null).bar === null,
    'cursorOf, three rows or more: the row off the common band; none off, the cursor is not in the list; bars are learned where the common band is not the page\'s');
  ok(cursorOf([SEL, 7], 7, null).cursor === 0 && cursorOf([7, 7], 7, null).cursor === null && cursorOf([BAR, SEL], 7, BAR).cursor === 1 && cursorOf([BAR], 7, BAR).cursor === null,
    'cursorOf, one or two rows: the row off the page\'s colour, or with bars the row off the learned bar colour');
  ok(throwsLike(() => cursorOf([BAR, SEL], 7, null), /no bar colour learned/) && throwsLike(() => cursorOf([1, 2, 3], 7, null), /2 of 3 rows off/) && throwsLike(() => cursorOf([SEL, 7], null, null), /no page above/) && throwsLike(() => cursorOf([null, 7], 7, null), /no band/),
    'cursorOf refuses two barred rows with no bar learned, two rows off the common band, a short list with no page above it, a row with no band');
  // the walks
  const wv = viewer();
  ok(walk(wv) && wv.done && wv.keys.join() === 'down,right,down,ok,down,ok,up,ok', `the Menu_Viewer look: the tabs down to the one with Card Setup, into its list, Format, Yes: ${wv.keys}`);
  const w1 = list(1), w2 = list(2);
  ok(walk(w1) && w1.done && w1.keys.join() === 'ok,up,ok,up,ok', `the ListMenu look with one slot: Card Formatting, Format Card, Yes: ${w1.keys}`);
  ok(walk(w2) && w2.done && w2.keys.join() === 'ok,ok,up,ok,up,ok', `with two slots: the card choice passed with OK: ${w2.keys}`);
  const none = viewer(), lone = list(1);
  ok(throwsLike(() => new MenuWalk({ press: none.press, frame: none.frame, draws: () => none.draws }).to([{ row: ['Sensor Cleaning'] }]), /none of the goals on any of the 2 tabs/) && none.keys.join() === 'down,down', `a goal on no tab: refused after the tabs came round: ${none.keys}`);
  lone.at = 'card'; lone.press('down'); lone.press('down');
  ok(throwsLike(() => walk(lone), /no bar colour learned/) && lone.keys.length === 2, 'a walk that starts in a list of two bars: refused, no key pressed');
}

// (firmware) the play session's card on the model of OM_EMU_MODEL (E143 by default), a body whose file system runs
// natively (src/fw/models.mjs card_fs); the HLS media side's parts where it runs that too (card_fs.hls)
export async function storageSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const P = await import('../src/lab/play.mjs');
  const { labEnv, loadBlock, loadNand } = await import('../checks/lib/env.mjs');
  const { A, MODEL, ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  if (!STORAGE) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs does not run the card's file system natively`] };
  const resBlock = loadBlock();
  const { SHOTS, MOVIE } = cardQueries(A);
  // the first picture's file: the DCF module's initial names (src/fw/facts.mjs fileSystem names)
  // the bodies whose DCF remain movie time answers 0 on the card (the E144 family but the E142 lineage, and E134: the
  // blank store's 4K 60p mode has no rate in their tables, docs/hle-gaps.md 4.8.5; E134 X, its mode 1 at 60 and the
  // rate check's logs 0x3a040001 and 0x39000105): strictly, so an answer flags the table; S-SCENE's live view on the
  // E143 family only (its banks are E143's: on the E144 family 0x50534dd1's address is not the table's, X)
  const MOVIE_ZERO = ['E144', 'E139', 'E137', 'E125', 'E134'].includes(MODEL), LIVE_VIEW = BOARD.family === 'E143';
  const names = STORAGE.names, DIR = `DCIM/100${names.folder}`, FILE1 = `${DIR}/${names.file}0001.${names.ext}`;
  let saved = null;
  const session = (card) => {
    const env = { ...labEnv({ resBlock, nand: loadNand() }), card };
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
      { rom: loadImage(), resBlock, nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
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
  // S2 with S-SCENE's live view: the picture's file through the file module's own requests (S-RECFILE; on E143
  // REC_FILE natively from REC_IMAGE's packet, src/lab/rec.mjs, with the clock set first through the firmware's clock
  // setting 0x5012b7a7, so the header the firmware builds carries its date), read back independently; the next
  // session's DCF numbering mount and image count find it
  {
    const { loadImage, createHash } = await import('../checks/lib/env.mjs');
    const { Player } = await import('../src/lab/player.mjs');
    const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
    const { jpegOfFrame } = await import('../src/lab/jpeg.mjs');
    const { decodeJpeg } = await import('../refs/jpeg.mjs');
    const { readExif, jpegSegments } = await import('../refs/exif.mjs');
    const { runtime } = await import('../src/lab/hle.mjs');
    const { encoderStream } = await import('../src/lab/rec.mjs');
    const { pack } = await import('../src/util/bytes.mjs');
    const card = new SdCard();
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
      { rom: loadImage(), resBlock, nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
    try {
      pl.open_session();
      const rec = pl.session.storage.rec, DATE = [2026, 11, 8, 12, 34, 56], HEADER = rec?.header, body = EXIF_BODY[MODEL], setRuns = [];
      // the DCF name: the file letter, the month in hex and the day of the capture's stamp (docs/hle-gaps.md 4.8.9)
      const file1 = rec ? `${DIR}/P${DATE[1].toString(16).toUpperCase()}${String(DATE[2]).padStart(2, '0')}0001.${names.ext}` : FILE1;
      if (rec) {
        ok(pl.stand_ins_in_use().includes('H-RECFILE') && !pl.stand_ins_in_use().includes('S-RECFILE'), `${MODEL}: REC_FILE natively, S-RECFILE not in use`);
        const lab = pl.session.lab, at = lab.alloc(new Uint8Array(10), 4);
        lab.sim.write(at, pack('<HBBBBBBH', ...DATE, 0, 0));
        lab.call(rec.R.clock_set, { a0: at }, null, null, 2000000);
        pl.session.settle('the clock setting');
        // the EXIF set's runs, seen at its entry (where the rule reads it: S-EXIFPRM runs it natively)
        if (rec.exif_set()) lab.observe(rec.R.exif.set, (l, r) => setRuns.push(r.a0 >>> 0), 'obs-exif-set');
      }
      const SHOT = [{ type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' }, { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' },
        { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }];
      for (const inp of [...(LIVE_VIEW ? [{ type: 'scene', change: { liveview: true } }] : []), ...SHOT]) pl.run_input(inp);
      const s2 = pl.session, img = s2.camapp.images[0];
      if (rec) ok(rec.started && rec.waiting(), `REC_FILE (task ${rec.R.task.id}) started at the picture and waiting on its input again`);
      ok(img?.file?.path === `${names.drive}:\\${file1.replaceAll('/', '\\')}`, `S2 wrote the picture's file: ${JSON.stringify(img?.file)}`);
      const jfif = img ? jpegOfFrame(s2.picture_frame(s2.camapp.views.get(img.release) ?? null)) : null;
      // natively the file is the firmware's header and the encoder's stream after it (src/lab/rec.mjs S-JPEGENC)
      const stream = jfif && rec ? encoderStream(jfif) : null, want = jfif && (rec ? { length: HEADER + stream.length } : jfif);
      const vol = new FatVolume((lba, n) => card.read(lba, n), mbrPartition(card.read(0, 1)).start);
      const e = vol.find(file1);
      ok(e && !e.dir && want && e.size === want.length, `the directory entry ${file1}: ${JSON.stringify(e && { size: e.size, cluster: e.cluster })}, the file ${want?.length} bytes`);
      const data = e ? vol.data(e) : null;
      if (rec) {
        // the header maker runs after the encode, and its XMP segment's last 2 bytes overwrite the stream's SOI
        ok(data && stream && data.subarray(HEADER + 2).every((b, i) => b === stream[i + 2]), 'the bytes after the header are the lab\'s JPEG stream (but its SOI)');
        const segs = data ? jpegSegments(data) : [], x = data ? readExif(data) : null, t = (m, k) => m?.get(k)?.trim?.();
        const tables = body?.xmp ? 3 : 2;
        ok(segs[1]?.marker === 0xE1 && (!body?.xmp || segs[2]?.marker === 0xE1) && segs[tables]?.at === HEADER + 2, `SOI, APP1 Exif, ${body?.xmp ? 'APP1 XMP, ' : ''}then the stream's tables: ${segs.slice(0, 4).map((g) => `${g.marker.toString(16)}@${g.at}`).join(' ')}`);
        const dt = `${DATE[0]}:${DATE.slice(1, 3).map((v) => String(v).padStart(2, '0')).join(':')} ${DATE.slice(3).map((v) => String(v).padStart(2, '0')).join(':')}`;
        ok(body && t(x?.ifd0, 0x10F) === body.make && t(x?.ifd0, 0x110) === body.model, `the firmware's Make and Model (refs/exif.mjs): '${t(x?.ifd0, 0x10F)}' '${t(x?.ifd0, 0x110)}', ${MODEL}'s '${body?.make}' '${body?.model}'`);
        ok(x?.ifd0.get(0x132) === dt && x?.exif?.get(0x9003) === dt && x?.exif?.get(0x9004) === dt, `the firmware's dates are the clock's ${dt}: ${x?.ifd0.get(0x132)}, ${x?.exif?.get(0x9003)}, ${x?.exif?.get(0x9004)}`);
        const version = x?.exif ? String.fromCharCode(...x.exif.get(0x9000)) : null;
        ok(version === body?.version && x.makernote?.header === body.notes && x.ifd1?.has(0x201) && x.ifd1.get(0x202) === 0,
          `ExifVersion ${version} (${MODEL}'s ${body?.version}), the maker notes '${x?.makernote?.header}' (${MODEL}'s '${body?.notes}', ${x?.makernote?.length} bytes), IFD1's thumbnail slot of length 0: ${x?.ifd1?.get(0x202)}`);
        // REC_IMAGE's own task made the picture where REC is recFile's version, E143, E146 and E147 (src/lab/rec.mjs
        // H-RECIMAGE, S-RECREQ; docs/hle-gaps.md 4.3.3, 4.3.5); the E144 family's REC_IMAGE part is S-RECIMAGE's
        if (rec.image) {
          const used = pl.stand_ins_in_use(), run = rec.images[0], y = run?.reply, fill = run?.fills;
          ok(['H-RECSHARED', 'H-RECIMGPRO', 'H-RECIMAGE', 'S-RECREQ', 'S-IMGPRO'].every((n) => used.includes(n)) && !used.includes('S-RECIMAGE'), `REC_IMAGE natively, S-RECIMAGE not in use: ${used.filter((n) => /REC|IMGPRO|JPEG/.test(n)).join(' ')}`);
          ok(rec.images.length === 1 && run.task === rec.image.task.id && run.encoded === 1 && rec.waiting(rec.image.task.id), `the encode ran once in REC_IMAGE's task (${rec.image.task.id}), which waits on its queue again: ${JSON.stringify(run && { task: run.task, encoded: run.encoded })}`);
          // S-JPEGENC from ImageParam's parameter set on, at the points the rule reads (fact rec_image encode; E146
          // and E147 since 2026-11-11): CreateParam, the create (its handle in the packet, on E146 and E147 in the
          // image record), ImageParam's body and the release natively (docs/hle-gaps.md 4.3.4, 4.3.9); the handle read
          // at the rule's id the one ImageParam hands the set
          const steps = run?.steps;
          ok(steps && steps.set === 1 && steps.run === 1 && steps.result === 1 && steps.id !== 0 && steps.id === steps.handle && steps.released === 1, `S-JPEGENC's steps: the parameter set skipped once, the run and Jpeg_Result stood in once, the create's id (the set's handle) and the release native: ${JSON.stringify(steps)}`);
          // ImageParam's four sources natively: TAKE's shot table has no buffer (0x25000402 from each lookup), MM none
          // for handle 0 (0x08010004), and nothing else logged before the parameter set's call; each body's callers
          // pinned as run (X; on E146 and E147 the first lookup's log comes twice: the Bayer source's
          // rec_misc_select_bayer asks it again when its answer's high byte is clear, D on E146 0x5052af6b and
          // 0x5052af7a, E147 0x5053a192 and 0x5053a1a1; X on E146: the lookup's only two calls in the shot)
          const SRC = { E143: [['0x503afa1f', '0x503afb54', '0x503afb9f', '0x503afc35'], '0x50534ec2', 1], E146: [['0x503afacd', '0x503afc0a', '0x503afc57', '0x503afcf1'], '0x50511fbc', 2],
            E147: [['0x503b9d62', '0x503b9e97', '0x503b9ee2', '0x503b9f78'], '0x50521140', 2] }[MODEL];
          const SRC_LOGS = SRC ? SRC[0].flatMap((at, k) => [...new Array(k === 0 ? SRC[2] : 1).fill(['0x25000402', at]), ['0x08010004', SRC[1]]]) : null;
          ok(JSON.stringify(run?.errlog) === JSON.stringify(SRC_LOGS), `the error logs up to the parameter set's call: ImageParam's sources' lookups (TAKE's 0x25000402, MM's 0x08010004 after each): ${JSON.stringify(run?.errlog)}`);
          ok(y && y.status === 0 && y.free === 1 && y.header === HEADER && y.size === HEADER + stream.length && run.alive === 0, `REC_FILE's reply (S-RECREQ): ${JSON.stringify(y)}, pAlive ${run?.alive}`);
          ok(fill?.length === 1 && fill[0].mode === 4 && fill[0].dst === y?.addr && fill[0].bytes === HEADER && fill[0].value === 0, `the header area cleared by the imgpro unit natively (one linear fill of 0 over the buffer's ${HEADER} bytes): ${JSON.stringify(fill)}`);
          ok(y?.aspect === run.take[12417] && run.take[40401] === 1, `ImgAspect from the record's aspect, TAKE's setting 12417 (${run?.take?.[12417]}): ${y?.aspect}; the bracket's 40401 ${run?.take?.[40401]}`);
          ok(x?.exif?.get(0x8827) === 25 && x?.exif?.get(0x8831) === 25, `the ISO REC_IMAGE derives from the record's +38174 0 (rec_bracket_after_trig 0x5053bfe2: the shot's record's +38174, on E146 and E147 +37826; on E143 also the SvAdj rec_bracket_update_iso 0x5053bca6 sets), ISO and StandardOutputSensitivity: ${x?.exif?.get(0x8827)} ${x?.exif?.get(0x8831)}`);
        }
        // the EXIF set natively where the rule reads it (E143, E146, E147; src/lab/rec.mjs S-EXIFPRM after H-RECPRECON,
        // docs/hle-gaps.md 4.3.11): run once for the shot, on the packet's block, seen at its entry; in the file
        // (refs/exif.mjs) what it writes over the template's: X and Y resolution 350/1 (the template's 0/0), the
        // digital zoom ratio 0/100 (S-EXIFPRM's 1/1 before), the time offsets; and its conversions of takepic's
        // shooting values, which stay the template's 0 in the lab (their source, TAKE_MAIN's request, does not run):
        // ExposureTime 1 s (Tv 0), FNumber 0/10 (the lens flag clear). A change that gives them a source updates this
        if (rec.exif_set()) {
          const used = pl.stand_ins_in_use();
          const tags = [[0x011A, 'ifd0'], [0x011B, 'ifd0'], [0xA404, 'exif'], [0x829A, 'exif'], [0x829D, 'exif']].map(([k, d]) => JSON.stringify(x?.[d]?.get(k)));
          ok(used.includes('H-RECPRECON') && rec.precon_init && rec.exif_sets === 1 && setRuns.length === 1, `the EXIF set ran natively once, after H-RECPRECON (${used.filter((n) => /PRECON|EXIF/.test(n)).join(' ')}): ${rec.exif_sets} by the lab's count, ${setRuns.length} seen at its entry 0x${rec.R.exif.set.toString(16)}`);
          ok(tags.join(' ') === '[350,1] [350,1] [0,100] [10,10] [0,10]' && x?.exif?.get(0x9010) === x?.exif?.get(0x9011) && /^[+-]\d\d:\d\d$/.test(x?.exif?.get(0x9010) ?? ''),
            `the EXIF set's values: X and Y resolution, DigitalZoomRatio, ExposureTime and FNumber ${tags.join(' ')} (want [350,1] [350,1] [0,100] [10,10] [0,10]), OffsetTime ${x?.exif?.get(0x9010)}`);
          // the control: the dates are the EXIF set's, from its block's time record; a fresh copy of the template with
          // the clock read after the clock is set to another date gets that date from the set, and keeps the
          // template's empty DateTimeOriginal without it
          const lab = s2.lab, X = rec.R.exif, D2 = [2025, 3, 4, 5, 6, 8], at = lab.alloc(new Uint8Array(10), 4);
          const block = (set) => {
            const b = lab.alloc(new Uint8Array(X.size), 64);
            lab.call(X.copy, { a0: b }, null, null, 2000000);
            lab.call(rec.clock_read, { a0: b + X.time }, null, null, 2000000);
            if (set) lab.call(X.set, { a0: b }, null, null, 2000000);
            return rec.text(b + X.date.original, 20);
          };
          lab.sim.write(at, pack('<HBBBBBBH', ...D2, 0, 0));
          lab.call(rec.R.clock_set, { a0: at }, null, null, 2000000);
          const withSet = block(true), without = block(false);
          lab.sim.write(at, pack('<HBBBBBBH', ...DATE, 0, 0));
          lab.call(rec.R.clock_set, { a0: at }, null, null, 2000000);
          ok(withSet === '2025:03:04 05:06:08' && without === '', `a fresh block with the clock at 2025-03-04 05:06:08: the EXIF set's DateTimeOriginal '${withSet}', without it '${without}' (the template's)`);
        }
        // the REC version before the family's (src/fw/facts.mjs recFileInline: E130, E133, E129): REC_FILE's reply to
        // the requester taken with status 0, and the file's context, on rec_make_file's stack, read at the
        // registration: its stamp the FAT stamp of the clock's date, as the directory entry's
        if (rec.R.reply && !rec.frame) {
          const fat = ((DATE[0] - 1980) << 25 | DATE[1] << 21 | DATE[2] << 16 | DATE[3] << 11 | DATE[4] << 5 | DATE[5] >> 1) >>> 0;
          ok(rec.R.contexts === null && rec.reply?.status === 0 && rec.context?.stamp === fat && img?.file?.stamp === fat && e?.date === fat >>> 16 && e?.time === (fat & 0xFFFF),
            `REC_FILE's reply taken (S-RECIMAGE) with status ${rec.reply?.status}, its context's stamp at the registration ${rec.context?.stamp} (the clock's ${fat}, the directory entry's ${e && (e.date << 16 | e.time) >>> 0})`);
        }
        // the E118 family's REC version (src/lab/rec.mjs frame; docs/model-survey.md findings 143 to 146): REC_FILE's
        // own steps seen where they reach the file module and the file system, and the file's whole stream
        if (rec.frame) {
          const used = pl.stand_ins_in_use(), run = rec.records[0], C = STORAGE.rec.codes, hexs = (v) => v.map((n) => `0x${n.toString(16)}`).join(' ');
          ok(['H-EXIFINIT', 'H-RECINIT', 'H-RECFILE', 'S-EXIFPRM', 'S-RECIMAGE', 'S-JPEGENC'].every((n) => used.includes(n)) && !used.includes('S-RECHDR'), `${MODEL}: rec_jpeg_exec and REC_FILE natively: ${used.filter((n) => /REC|EXIF|JPEG/.test(n)).join(' ')}`);
          const own = run?.requests.filter(([c]) => [C.open, C.write, C.entry, C.register, C.cancel, C.reserve].includes(c)) ?? [];
          ok(rec.records.length === 1 && JSON.stringify(own) === JSON.stringify([C.open, C.write, C.entry, C.register].map((c) => [c, 0])), `REC_FILE's requests to the file module, each answered 0: the open, the chain write, the entry, the registration (${hexs([C.open, C.write, C.entry, C.register])}; no reservation request 0x${C.reserve.toString(16)}): ${JSON.stringify(run?.requests.map(([c, v]) => [`0x${c.toString(16)}`, v]))}`);
          ok(run?.allocs.length === 1 && run.allocs[0].drive === 0 && run.allocs[0].bytes === want?.length && run.allocs[0].mode === 2, `the reservation is REC_FILE's own call of the file system's allocation, once, for drive 0, the file's ${want?.length} bytes, mode 2: ${JSON.stringify(run?.allocs)}`);
          ok(run?.reply && run.reply.status === 0 && run.reply.free === 0 && run.reply.dst === 0, `REC_FILE's reply to the packet's ObjResponse taken (S-RECIMAGE), status 0 with Free 0 and Dst 0: ${JSON.stringify(run?.reply)}`);
          // the header maker leaves APP1's last 2 bytes, the stream's SOI (on E143 the XMP's end overwrites them, X)
          ok(data && stream && data.subarray(HEADER).every((b, i) => b === stream[i]) && segs[1].at === 2 && segs[1].length === HEADER - 2, `after the ${HEADER}-byte header the bytes are the lab's whole JPEG stream, its SOI as APP1's last 2 bytes (APP1 of ${segs[1]?.length} bytes)`);
          // the directory entry's stamp is the capture's, packed from the shot's time record (the FAT date and time)
          const fd = (DATE[0] - 1980) << 9 | DATE[1] << 5 | DATE[2], ft = DATE[3] << 11 | DATE[4] << 5 | DATE[5] >> 1;
          ok(e && e.date === fd && e.time === ft && (e.attr & 0x20) !== 0 && img.file.stamp === ((fd << 16 | ft) >>> 0), `the directory entry's date and time 0x${e?.date.toString(16)} 0x${e?.time.toString(16)} are the clock's (0x${fd.toString(16)} 0x${ft.toString(16)}), an archive (attribute 0x${e?.attr.toString(16)}); the DCF block's stamp 0x${img.file.stamp?.toString(16)}`);
          // the shooting values are the EXIF template's, held strictly: the EXIF set, which converts the record's Tv
          // and Av, and REC_IMAGE's rec_bracket_after_trig, which converts its Sv, do not run, and the lab has no
          // source for the three records on the family (docs/model-survey.md finding 147); a change that fills them
          // updates this
          const tags = [0x829A, 0x829D, 0x8827, 0x920A].map((k) => JSON.stringify(x?.exif?.get(k)));
          ok(tags.join(' ') === '[0,100] [0,10] 0 [0,10]', `ExposureTime, FNumber, ISO and FocalLength are the template's 0/100, 0/10, 0 and 0/10: ${tags.join(' ')}`);
        }
      } else ok(data && want && data.every((b, i) => b === want[i]), 'the file\'s bytes are the JPEG the lab handed the file module');
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
      // where REC's recorder records it (S-RECFILE's DCF steps) or REC_FILE natively: the DCF database counts it in the
      // same session, and its fnode of index 1 is the file's
      if (STORAGE.recorder || rec) {
        const lab = s2.lab, key = runtime(A(0x503FEEA4));
        ok(!lab.hooks.has(key), 'with the DCF database the media API\'s image count runs natively (no S-CARD hook)');
        const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0, f1 = s2.storage.fnode(1, 'test');
        ok(n === 1 && s2.camapp.card_images() === 1, `the firmware's own image count right after S2: ${n}, S-CARD's ${s2.camapp.card_images()}`);
        ok(f1 && f1.folder === img.file.folder && f1.number === img.file.number && s2.storage.fnode(2, 'test') === null, `the database's picture 1: ${JSON.stringify(f1)}, the file's ${img.file.folder}-${img.file.number}`);
        ok(e && e.cluster === img.file.cluster, `the directory entry's first cluster ${e?.cluster}, the reservation's ${img.file.cluster}`);
      }
      // the E118 family: a second picture, then PLAY and back and a third: each recorded by REC_FILE under the
      // firmware's next number, counted by its database, on the card under its own directory entry, the FAT's free
      // count less each file's clusters (refs/fat.mjs)
      if (rec?.frame) {
        const lab = s2.lab, cam = s2.camapp, shooting = lab.state(), per = vol.spc * 512, free0 = vol.freeClusters();
        const press = (k) => { for (const inp of [{ type: 'key', id: k, action: 'down' }, { type: 'token', token: 'WAIT:150' }, { type: 'key', id: k, action: 'up' }, { type: 'token', token: 'WAIT:1200' }]) pl.run_input(inp); };
        const shot = (n, what) => {
          for (const inp of SHOT) pl.run_input(inp);
          pl.run_input({ type: 'token', token: 'WAIT:1200' });
          const im = cam.images[n - 1], name = `${DIR}/P${DATE[1].toString(16).toUpperCase()}${String(DATE[2]).padStart(2, '0')}${String(n).padStart(4, '0')}.${names.ext}`;
          const v = new FatVolume((lba, k) => card.read(lba, k), mbrPartition(card.read(0, 1)).start), en = v.find(name), bytes = en ? v.data(en) : null, x = bytes ? readExif(bytes) : null;
          const count = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0, fnode = s2.storage.fnode(n, 'test'), d = bytes ? decodeJpeg(bytes) : null;
          ok(cam.images.length === n && im?.file?.path === `${names.drive}:\\${name.replaceAll('/', '\\')}` && im.file.number === n && count === n && cam.card_images() === n && fnode?.number === n && fnode.folder === 100,
            `${what}: picture ${n} is the firmware's next number: ${JSON.stringify(im?.file && { path: im.file.path, number: im.file.number })}, its image count ${count}, its fnode ${JSON.stringify(fnode)}`);
          ok(en && en.size === im?.file?.size && en.cluster === im.file.cluster && x?.exif?.get(0x9003) === x?.ifd0.get(0x132) && d?.width > 0, `${what}: its directory entry ${JSON.stringify(en && { size: en.size, cluster: en.cluster })} is the fnode's (${im?.file?.size} bytes from cluster ${im?.file?.cluster}), its Exif dated ${x?.exif?.get(0x9003)} and its JPEG decoding (${d?.width} x ${d?.height})`);
          const used = cam.images.slice(1, n).reduce((a, i) => a + Math.ceil(i.file.size / per), 0);
          ok(v.freeClusters() === free0 - used && v.fsInfo()?.free === v.freeClusters(), `${what}: the FAT's free clusters ${v.freeClusters()}, ${used} less than after the first picture (${free0}); FSInfo's ${v.fsInfo()?.free}`);
          ok(rec.records.length === n && rec.waiting(), `${what}: REC_FILE handled ${rec.records.length} packets and waits on its queue again`);
        };
        shot(2, 'a second S2');
        press('play');
        ok(lab.state_names.get(lab.state()) === 'SS_PLAY_SINGLE/ID_ST_DISP_SIMPLE' && cam.play_cur === 1, `PLAY shows the newest of the two pictures: ${lab.state_names.get(lab.state())}, image ${cam.play_cur + 1}`);
        press('play');
        ok(lab.state() === shooting, `PLAY again returns to the shooting screen (0x${lab.state().toString(16)}, 0x${shooting.toString(16)} before)`);
        shot(3, 'S2 after playback');
      }
      const taken = s2.camapp.images.length;
      pl.close_session();
      pl.open_session();
      const st = pl.session.steps.find((x) => x.storage)?.storage, lab = pl.session.lab;
      ok(st?.dcf?.folder === 100 && st?.dcf?.file === taken + 1, `the next session's DCF numbering mount finds the ${taken === 1 ? 'file' : `${taken} files`}: next ${JSON.stringify(st?.dcf)}`);
      const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);   // S-CARD's image count (camapp.mjs IMAGE_COUNT) aside
      lab.hooks.delete(key);
      const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0;
      if (hook) lab.hooks.set(key, hook);
      ok(n === taken, `the firmware's own image count (type 1) in the next session: ${n}`);
    } catch (e) { bad.push(`S2 picture: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
  }
  // the HLS media side (Card Formatting, the card out and in) where the body runs it (src/fw/models.mjs card_fs.hls)
  if (STORAGE.hls) {
    const notes = [];
    await hlsFormat(new SdCard(), MODEL, ok, bad, notes);
    await hlsOutIn(new SdCard(), MODEL, ok, bad, notes);
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

// The HLS media side on a card (src/fw/models.mjs card_fs.hls: E143, E146, E147 and E148 by hand; the E118 family's
// and the E144 family's read by the rule, src/fw/facts.mjs mediaHls), whichever file system the firmware gave it at
// the insertion (refs/volume.mjs reads either). ok(cond, what) counts a check, bad collects a throw, notes what the
// firmware did (the layout, the lab times).
//
// The menu's path to the Format's Yes is not a list of keys: the walker (src/lab/menuwalk.mjs) finds it on the screen
// the firmware draws, by the items' English names: the row Card Formatting (the ListMenu bodies) or Card Setup (the
// Menu_Viewer bodies, on whichever tab holds it: the walker goes down the tabs), the card choice of a body with two
// slots in use (passed with OK: its cursor starts on the first card, X; the format's media 0 checks it), the row
// Format Card or Format, and Yes. A body with one slot opens Card Formatting without the card choice (E147, E148), an
// empty card's Card Setup the confirm without All Erase (the E118 family, X). The path is checked by what the
// application does at its end: the media control's start with the format's command (a wrong row starts no format, or
// another command, which stops the session)
//
// Card Formatting from the menu (S-MDACTRL, media.mjs) after a picture: the format reaches the card from the
// firmware's own request, the card read back independently is freshly formatted with the file system it had (its
// label, an empty root, the free count of the volume as the insertion's format left it; FAT32's FSInfo with it, an
// exFAT volume consistent with its backup boot region), the counts reset, the application leaves Busy for the menu;
// the card input is refused while the format runs, and after MENU S2's picture lands on the card as the first file
const FORMAT_GOALS = [{ row: ['Card Formatting', 'Card Setup'] }, { pass: ['Select Card to Set Up'], key: 'ok' }, { row: ['Format Card', 'Format'] }, { row: ['Yes'] }];
// from the menu MENU opened to the Format's Yes taken: the keys and what the walker read for each
async function walkToFormat(s, press) {
  const { MenuWalk } = await import('../src/lab/menuwalk.mjs');
  const walk = new MenuWalk({ press: (k) => press(s, k), frame: () => s.frame('boundary'), draws: () => s.lab.draw_log });
  walk.to(FORMAT_GOALS);
  return walk.log;
}
async function hlsFormat(card, tag, ok, bad, notes) {
  const { STORAGE: F } = await import('../src/lab/storage.mjs');
  if (F.hls.cab) return hlsFormatFamily(card, tag, ok, bad, notes);
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  const { A } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const names = STORAGE.names, FILE1 = `DCIM/100${names.folder}/${names.file}0001.${names.ext}`;
  const read = (lba, n) => card.read(lba, n);
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 100e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 400e6); };
  const frame = (s) => { const [w, h, words] = s.frame('boundary'); return { w, h, words }; };
  const rows = (f, y0, y1) => { const a = f.words.slice(y0 * f.w, y1 * f.w), b = []; for (const x of a) b.push(x); return b.join(','); };
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab;
    s.idle_slice(lab.lab_time() + 1500e6);
    const first = openVolume(read), fresh = first.freeClusters();
    notes.push(`${tag}: before the menu's format: ${layout(mbrPartition(read(0, 1)), first)}`);
    press(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
    const vol0 = openVolume(read), shooting = lab.state();
    ok(vol0.find(FILE1) && vol0.freeClusters() < fresh && s.camapp.images.length === 1, `${tag}: before the format: the picture's file on the card, ${vol0.freeClusters()} of ${fresh} clusters free`);
    press(s, 'menu');
    const menu = frame(s);
    // (with one card a body whose second slot the lab models shows no "Select Card to Set Up" panel, X,
    // docs/hle-gaps.md 4.8.12: the walker passes that panel only where it shows)
    notes.push(`${tag}: the menu's path to the format: ${(await walkToFormat(s, press)).join('; ')}`);
    const busy = frame(s), media = s.camapp.media, t0 = lab.lab_time();
    ok((media.ctrl !== null || media.formats === 1) && media.started?.cmd === media.f.ctrl.format && media.started.media === 0, `${tag}: Format Card, Yes: the media control's start reached S-MDACTRL with the format's command for the first card: ${JSON.stringify(media.started)}`);
    // the format runs (S-MDACTRL's start seen, its end not yet): the card input is refused
    let held = false;
    try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { held = /media layer is busy/.test(e.message); }
    ok(media.ctrl !== null && held && s.storage.card.present, `${tag}: while the format runs the card input is refused (S-MDACTRL ${media.ctrl === null ? 'done' : 'running'})`);
    for (let i = 0; i < 100 && media.formats === 0; i++) s.idle_slice(lab.lab_time() + 50e6);
    const took = lab.lab_time() - t0;
    s.idle_slice(lab.lab_time() + 1000e6);
    ok(media.formats === 1 && media.ctrl === null, `${tag}: the format finished: ${JSON.stringify(media.status())}`);
    const vol = openVolume(read);
    notes.push(`${tag}: the menu's format done within ${(took / 1e6).toFixed(0)} ms of lab time (50 ms steps): ${layout(mbrPartition(read(0, 1)), vol)}`);
    ok(vol.type === first.type && vol.label.trim() === 'OM SYSTEM' && vol.list().length === 0, `${tag}: read back: a ${vol.type} 'OM SYSTEM' volume (the insertion's ${first.type}) with an empty root: '${vol.label.trim()}', ${JSON.stringify(vol.list().map((e) => e.name))}`);
    ok(!vol.find(FILE1) && vol.freeClusters() === fresh, `${tag}: the picture is gone: ${vol.freeClusters()} clusters free, a fresh volume's ${fresh}`);
    if (vol.type === 'exFAT') {
      const problems = vol.check();
      ok(problems.length === 0 && vol.backupMatches(), `${tag}: the formatted exFAT volume is consistent and its backup boot region the main one's: ${problems.slice(0, 5).join('; ')}`);
    } else ok(vol.fsInfo()?.free === fresh, `${tag}: FSInfo's free count ${vol.fsInfo()?.free}, a fresh volume's ${fresh}`);
    const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);   // S-CARD's image count (camapp.mjs IMAGE_COUNT) aside
    lab.hooks.delete(key);
    const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0;
    if (hook) lab.hooks.set(key, hook);
    ok(n === 0 && s.camapp.images.length === 0 && s.storage.next_file === 1, `${tag}: the counts reset: the firmware's image count ${n}, S-CARD's ${s.camapp.images.length}, next file ${s.storage.next_file}`);
    const after = frame(s);
    ok(rows(after, 0, 130) === rows(menu, 0, 130) && rows(after, 200, 600) !== rows(busy, 200, 600), `${tag}: the application left Busy for the menu (its tab bar and title as before the format)`);
    ok(pl.stand_ins_in_use().includes('S-MDACTRL'), `${tag}: the player lists S-MDACTRL`);
    press(s, 'menu'); s.idle_slice(lab.lab_time() + 500e6);
    press(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
    const e = openVolume(read).find(FILE1);
    ok(lab.state() === shooting && e && e.size > 0 && s.camapp.images.length === 1, `${tag}: MENU, then S2 as before the format (state 0x${lab.state().toString(16)}, 0x${shooting.toString(16)} then): its picture on the card as ${FILE1} again (${e?.size} bytes)`);
  } catch (e) { bad.push(`${tag}: menu format: ${e.message.slice(0, 400)}`); }
  try { pl.close_session(); } catch { /* closed */ }
}

// The card taken out and put back while the camera runs (S-MEDIA, media.mjs): the card switch through UI_IN, the
// firmware unmounts and the screen loses the card's counts; back in, the firmware initialises and mounts the card again
// (without a format: the volume it had, read back the same) and the counts come back; then S2's picture lands on the
// card
async function hlsOutIn(card, tag, ok, bad, notes) {
  const { STORAGE: F } = await import('../src/lab/storage.mjs');
  if (F.hls.cab) return hlsOutInFamily(card, tag, ok, bad, notes);
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A } = await import('../src/fw/model.mjs');
  const { SHOTS } = cardQueries(A), read = (lba, n) => card.read(lba, n);
  const FILE1 = `DCIM/100${F.names.folder}/${F.names.file}0001.${F.names.ext}`;
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
  const box = (s) => { const [w, , words] = s.frame('boundary'), out = []; for (let y = 0; y < 45; y++) for (let x = 230; x < 460; x++) out.push(words[y * w + x]); return out.join(','); };
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, st = s.storage, media = s.camapp.media;
    s.idle_slice(lab.lab_time() + 1500e6);
    s.key('s1', 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 100e6); s.key('s1', 'up'); s.camapp.pump();   // the date prompt off
    s.idle_slice(lab.lab_time() + 1000e6);
    const counts = box(s), shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0, cmds = st.commands;
    const detect = lab.sim.read(st.f.detect, 2)[0], boot = openVolume(read).boot.slice();
    const out = pl.run_input({ type: 'card', action: 'remove' });
    s.idle_slice(lab.lab_time() + 500e6);
    ok(!st.card.present && !st.mounted && lab.sim.read(st.f.detect, 2)[0] === 1 && media.mount_state(4) === 0, `${tag}: out: the drive unmounted (detect state ${lab.sim.read(st.f.detect, 2)[0]}, HLS mount state ${media.mount_state(4)}, ${out?.card?.drive_status})`);
    ok(out?.uiin_codes?.includes('0x02021506') && media.level() === 1, `${tag}: out: UI_IN decoded the card switch (${JSON.stringify(out?.uiin_codes)}), level ${media.level()}`);
    ok(box(s) !== counts, `${tag}: out: the screen lost the card's counts`);
    let refused = false;
    try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { refused = /out of the slot already/.test(e.message); }
    ok(refused, `${tag}: a second removal is refused`);
    const logged = st.log.length, t0 = lab.lab_time();
    const back = pl.run_input({ type: 'card', action: 'insert' });
    s.idle_slice(lab.lab_time() + 500e6);
    ok(st.card.present && st.mounted && st.insertions === 1 && lab.sim.read(st.f.detect, 2)[0] === detect && media.mount_state(4) === 8, `${tag}: in: the firmware mounted the card again (${back?.card?.drive_status}, detect state ${lab.sim.read(st.f.detect, 2)[0]}, ${detect} at the start)`);
    ok(st.commands - cmds > 20 && card.log.some(([i]) => i === 2), `${tag}: in: sd_mount initialised the card again (${st.commands - cmds} SD commands, CMD2 among them)`);
    const vol = openVolume(read);
    ok(vol.boot.every((b, i) => b === boot[i]) && (vol.type !== 'exFAT' || vol.check().length === 0), `${tag}: in: the card's ${vol.type} volume as it was (its boot sector unchanged: no format)`);
    notes.push(`${tag}: the card put back at ${(t0 / 1e9).toFixed(3)} s of lab time: ${st.log.slice(logged).filter(([k]) => ['mount', 'format', 'drive'].includes(k)).map(([k, d]) => `${k} ${d}`).join('; ') || 'no mount, format or drive entry in the storage log'}`);
    const shots2 = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
    ok(shots2 === shots && box(s) === counts, `${tag}: in: the counts are back (${shots2} shots, ${shots} before; the screen's counts as before)`);
    notes.push(`${tag}: the card out and in: ${shots} remaining shots before, ${shots2} after`);
    s.key('s2', 'down'); s.camapp.pump(); s.idle_slice(lab.lab_time() + 100e6); s.key('s2', 'up'); s.camapp.pump();
    s.idle_slice(lab.lab_time() + 1400e6);
    const e = openVolume(read).find(FILE1);
    ok(e && e.size > 0 && s.camapp.images.length === 1, `${tag}: S2 after the card came back: its picture on the card as ${FILE1} (${e?.size} bytes)`);
    ok(pl.stand_ins_in_use().includes('S-MEDIA'), `${tag}: the player lists S-MEDIA`);
  } catch (e) { bad.push(`${tag}: card out and in: ${e.message.slice(0, 400)}`); }
  try { pl.close_session(); } catch { /* closed */ }
}

// The HLS side of the bodies whose application runs the media control itself (S-MDAEND and S-MEDIA,
// src/lab/media.mjs; the E118 family, docs/model-survey.md findings 124 to 129, and the E144 family but E148,
// findings 151 and 152), in a player on the body of OM_EMU_MODEL. The menu's path is walked (walkToFormat): on the
// E118 family MENU opens Shooting Menu 1, whose first row is Card Setup, on the E144 family Card Setup is the Setup
// Menu's first row, five tabs down; Card Setup offers All Erase and Format while the card holds a picture, and the
// confirm's cursor is on No (X, the walker's notes). The path is checked by what the application does at its end: the
// media control's start with the format's command, which S-MDAEND reads where the application makes it
const familyPress = (s, k) => { s.key(k, 'down'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 150e6); s.key(k, 'up'); s.camapp.pump(); s.idle_slice(s.lab.lab_time() + 600e6); };
const familyPlayer = async (card) => {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  return new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
};
// Format from the menu after a picture: the firmware formats the card from the application's own start; read back
// independently, the volume the insertion's format gave (its type, its label), its root empty, the picture gone and the
// free count a fresh volume's; the counts reset (the firmware's image count 0, its next file 1, the remaining shots the
// fresh card's); the application leaves Busy for the shooting screen (X in the lab; where the camera returns is ?,
// docs/model-survey.md finding 129); then S2's picture lands on the card as the first file again
async function hlsFormatFamily(card, tag, ok, bad, notes) {
  const { runtime } = await import('../src/lab/hle.mjs');
  const { A } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { SHOTS } = cardQueries(A), names = STORAGE.names, FILE1 = `DCIM/100${names.folder}/${names.file}0001.${names.ext}`;
  const read = (lba, n) => card.read(lba, n), pl = await familyPlayer(card);
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, media = s.camapp.media;
    s.idle_slice(lab.lab_time() + 1500e6);
    const first = openVolume(read), fresh = first.freeClusters(), shots0 = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
    familyPress(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
    const vol0 = openVolume(read), shooting = lab.state();
    ok(vol0.find(FILE1) && vol0.freeClusters() < fresh && s.camapp.images.length === 1, `${tag}: before the format: the picture's file on the card, ${vol0.freeClusters()} of ${fresh} clusters free`);
    familyPress(s, 'menu');
    ok(lab.state() !== shooting, `${tag}: MENU left the shooting screen (state 0x${lab.state().toString(16)})`);
    notes.push(`${tag}: the menu's path to the format: ${(await walkToFormat(s, familyPress)).join('; ')}`);
    // the format runs (S-MDAEND's start seen, its end not yet): the card input is refused, as E143's during S-MDACTRL
    let held = false;
    try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { held = /media layer is busy/.test(e.message); }
    ok(media.mda !== null && media.started?.cmd === media.f.cab.format && media.started.media === 0 && held && s.storage.card.present, `${tag}: the application's start with the format's command for the first card; while the format runs the card input is refused (start ${JSON.stringify(media.started)})`);
    notes.push(`${tag}: the media control's start (the application's own): ${JSON.stringify(media.mda)}`);   // camapp's pump takes the log meanwhile
    const t0 = lab.lab_time();
    for (let i = 0; i < 100 && media.formats === 0; i++) s.idle_slice(lab.lab_time() + 50e6);
    const took = lab.lab_time() - t0;
    s.idle_slice(lab.lab_time() + 1000e6);
    const log = media.log.concat(s.camapp.log.filter(([k]) => k.startsWith('media')).map(([k, d]) => [k.slice(6), d]));
    ok(media.formats === 1 && media.ended === 1 && media.mda === null, `${tag}: Format, Yes: the application's media control started the format and S-MDAEND ran its end: ${JSON.stringify(media.status())}`);
    const vol = openVolume(read);
    notes.push(`${tag}: the menu's format done within ${(took / 1e6).toFixed(0)} ms of lab time after Yes (50 ms steps): ${layout(mbrPartition(read(0, 1)), vol)}`);
    ok(vol.type === first.type && vol.label === first.label && vol.list().length === 0, `${tag}: read back: a ${vol.type} '${vol.label.trim()}' volume (the insertion's ${first.type} '${first.label.trim()}') with an empty root: ${JSON.stringify(vol.list().map((e) => e.name))}`);
    ok(!vol.find(FILE1) && vol.freeClusters() === fresh, `${tag}: the picture is gone: ${vol.freeClusters()} clusters free, a fresh volume's ${fresh}`);
    if (vol.type === 'exFAT') ok(vol.check().length === 0 && vol.backupMatches(), `${tag}: the formatted exFAT volume is consistent`);
    else ok(vol.fsInfo()?.free === fresh, `${tag}: FSInfo's free count ${vol.fsInfo()?.free}, a fresh volume's ${fresh}`);
    const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);   // S-CARD's image count (camapp.mjs IMAGE_COUNT) aside
    lab.hooks.delete(key);
    const n = lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0;
    if (hook) lab.hooks.set(key, hook);
    const shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
    ok(n === 0 && s.camapp.images.length === 0 && s.storage.next_file === 1 && shots === shots0, `${tag}: the counts reset: the firmware's image count ${n}, S-CARD's ${s.camapp.images.length}, next file ${s.storage.next_file}, ${shots} shots (${shots0} on the fresh card)`);
    ok(lab.state() === shooting, `${tag}: the application left Busy for the shooting screen: state 0x${lab.state().toString(16)}`);
    ok(pl.stand_ins_in_use().includes('S-MDAEND') && !pl.stand_ins_in_use().includes('S-MDACTRL'), `${tag}: the player lists S-MDAEND, not S-MDACTRL`);
    familyPress(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
    const vol2 = openVolume(read), e = vol2.find(FILE1);
    ok(e && e.size > 0 && s.camapp.images.length === 1, `${tag}: S2 after the format: its picture on the card as ${FILE1} again (${e?.size} bytes)`);
    notes.push(`${tag}: the media control: ${log.filter(([k]) => k === 'control' || k === 'end').map(([k, d]) => `${k} ${d}`).join('; ')}`);
  } catch (e) { bad.push(`${tag}: menu format: ${e.message.slice(0, 400)}`); }
  try { pl.close_session(); } catch { /* closed */ }
}
// The card out and in on the family (S-MEDIA), from the shooting screen (S1 leaves the start's clock warning): out, the
// drive unmounted and the camera's no-card state (the screen changed; X, its frames: "No Card" and the card icon, 0 and
// 00:00:00 in orange; the remaining-shots query itself still answers the count, X, so the screen's 0 is the
// application's); in, the card initialised and mounted again without a format, the screen as before (the whole frame)
// and the count the same; then S2's picture lands on the card
async function hlsOutInFamily(card, tag, ok, bad, notes) {
  const { A } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { SHOTS } = cardQueries(A), names = STORAGE.names, FILE1 = `DCIM/100${names.folder}/${names.file}0001.${names.ext}`;
  const read = (lba, n) => card.read(lba, n), pl = await familyPlayer(card);
  const screen = (s) => { const [w, h, words] = s.frame('boundary'); return `${w}x${h}:${words.join(',')}`; };
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, st = s.storage, media = s.camapp.media, slot = media.f.slots[0];
    s.idle_slice(lab.lab_time() + 1500e6);
    familyPress(s, 's1'); s.idle_slice(lab.lab_time() + 1000e6);
    const before = screen(s), shots = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0, cmds = st.commands;
    const detect = lab.sim.read(st.f.detect, 2)[0], boot = openVolume(read).boot.slice();
    const out = pl.run_input({ type: 'card', action: 'remove' });
    s.idle_slice(lab.lab_time() + 500e6);
    const code = `0x${(media.f.switch_event | slot.switch).toString(16).padStart(8, '0')}`;
    ok(!st.card.present && !st.mounted && lab.sim.read(st.f.detect, 2)[0] === 1 && media.mount_state(slot.kind) === 0, `${tag}: out: the drive unmounted (detect state ${lab.sim.read(st.f.detect, 2)[0]}, HLS mount state ${media.mount_state(slot.kind)}, ${out?.card?.drive_status})`);
    ok(out?.uiin_codes?.includes(code) && media.level() === 1, `${tag}: out: UI_IN decoded the card switch (${JSON.stringify(out?.uiin_codes)}, want ${code}), level ${media.level()}`);
    ok(screen(s) !== before, `${tag}: out: the no-card state: the screen changed`);
    let refused = false;
    try { pl.run_input({ type: 'card', action: 'remove' }); } catch (e) { refused = /out of the slot already/.test(e.message); }
    ok(refused, `${tag}: a second removal is refused`);
    const logged = st.log.length, t0 = lab.lab_time();
    const back = pl.run_input({ type: 'card', action: 'insert' });
    s.idle_slice(lab.lab_time() + 1500e6);
    ok(st.card.present && st.mounted && st.insertions === 1 && lab.sim.read(st.f.detect, 2)[0] === detect && media.mount_state(slot.kind) === media.f.mount.mounted, `${tag}: in: the firmware mounted the card again (${back?.card?.drive_status}, detect state ${lab.sim.read(st.f.detect, 2)[0]}, ${detect} at the start)`);
    ok(st.commands - cmds > 20 && card.log.some(([i]) => i === 2), `${tag}: in: sd_mount initialised the card again (${st.commands - cmds} SD commands, CMD2 among them)`);
    ok(openVolume(read).boot.every((b, i) => b === boot[i]), `${tag}: in: the card's volume as it was (its boot sector unchanged: no format)`);
    const shots2 = lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
    ok(shots2 === shots && screen(s) === before, `${tag}: in: the count back (${shots2} shots, ${shots} before) and the screen as before the removal`);
    notes.push(`${tag}: the card put back at ${(t0 / 1e9).toFixed(3)} s of lab time: ${st.log.slice(logged).filter(([k]) => ['mount', 'format', 'drive'].includes(k)).map(([k, d]) => `${k} ${d}`).join('; ')}`);
    familyPress(s, 's2'); s.idle_slice(lab.lab_time() + 1000e6);
    const e = openVolume(read).find(FILE1);
    ok(e && e.size > 0 && s.camapp.images.length === 1, `${tag}: S2 after the card came back: its picture on the card as ${FILE1} (${e?.size} bytes)`);
    ok(pl.stand_ins_in_use().includes('S-MEDIA'), `${tag}: the player lists S-MEDIA`);
  } catch (e) { bad.push(`${tag}: card out and in: ${e.message.slice(0, 400)}`); }
  try { pl.close_session(); } catch { /* closed */ }
}

// The HLS media side alone (--hls): Card Formatting from the menu and the card out and in on a blank 8 GiB card each,
// on the body of OM_EMU_MODEL whose card_fs runs it (bin/test.mjs runs it on the bodies whose --session it does not
// run, and on the E118 family)
export async function storageHls() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  if (!STORAGE?.hls) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs runs no HLS media side`], notes };
  await hlsFormat(new SdCard(), MODEL, ok, bad, notes);
  await hlsOutIn(new SdCard(), MODEL, ok, bad, notes);
  return { checks, bad, notes };
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
export async function storageSdxc(sizes = [64, 128], hlsSizes = [64]) {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
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
      { rom, resBlock, nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, card: { open: () => card, save() {} } });
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
      // with REC_FILE natively (src/lab/rec.mjs): the firmware's header, then the stream but its SOI, which the header's
      // XMP segment ends over
      const { encoderStream } = await import('../src/lab/rec.mjs');
      const es = want && s.storage.rec ? encoderStream(want) : null, skip = es ? s.storage.rec.header + 2 : 0, body = es ? es.subarray(2) : want;
      const vol2 = openVolume(read), e = vol2.find(FILE1);
      ok(e && !e.dir && want && e.size === skip + body.length && vol2.data(e).subarray(skip).every((b, i) => b === body[i]), `${tag}: S2's file ${FILE1} read back with the JPEG's bytes: ${JSON.stringify(e && { size: e.size, cluster: e.cluster })}, the JPEG ${want?.length} bytes`);
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
  // the HLS media side with an SDXC card where the body runs it (card_fs.hls): Card Formatting from the menu and the
  // card out and in, each on a blank card the insertion formats (docs/hle-gaps.md 4.8.6)
  if (STORAGE.hls) {
    for (const gib of hlsSizes) {
      const tag = `${MODEL} ${gib} GiB`;
      await hlsFormat(new SdCard({ sectors: cardSectors(gib) }), tag, ok, bad, notes);
      await hlsOutIn(new SdCard({ sectors: cardSectors(gib) }), tag, ok, bad, notes);
    }
  }
  return { checks, bad, notes };
}

// The second card slot (src/lab/storage.mjs S-SDCARD's slots, src/lab/media.mjs S-MEDIA and S-CARD's flags,
// src/lab/camapp.mjs S-CARD's save slot; docs/hle-gaps.md 4.8.12) on the body of OM_EMU_MODEL (card_fs.second_slot:
// E143, E146). X unless tagged; the row's pixels are E143's (test_camapp.mjs FRAMES_SLOT_ROW pinned them between
// camapp 3 and camapp 1 while one card answered both ports)
const SLOT_ROW = { pixels: 4602, box: [38, 283, 871, 327] };
// the media status's bits (api_media 0x503f0bd7's, D): no card (the drive status 1), a card with no file system (X),
// the card present, the DCF mount
const MS_NO_CARD = 1, MS_UNFORMATTED = 4, MS_CARD = 0x80, MS_MOUNTED = 0x1000;
export async function storageSlots() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A, MODEL, ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE: F, SECOND, DRIVE_NO_CARD } = await import('../src/lab/storage.mjs');
  if (!F?.slots) return { checks: 1, bad: [`${MODEL}: the lab does not model a second card slot (src/fw/models.mjs card_fs.second_slot)`], notes };
  const H = F.hls, FLAG = H.ctrl.flag[1], { mode: MODE, slot: SAVE } = F.slots.record, { SHOTS } = cardQueries(A);
  const names = F.names, DIR = `DCIM/100${names.folder}`, file = (n) => `${DIR}/${names.file}${String(n).padStart(4, '0')}.${names.ext}`;
  const hx = (v) => '0x' + (v >>> 0).toString(16), J = JSON.stringify;
  const holder = (card) => ({ open: () => card, save() {} });
  const env = () => ({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 });
  const player = (card, card2 = null, camapp = 1) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true },
      { ...env(), card: holder(card), ...(card2 ? { card2: holder(card2) } : {}) });
    if (camapp === 3) { pl.camapp_components = true; pl.camapp_native_tra = true; }
    pl.open_session();
    return pl;
  };
  const idle = (s, ms) => { const to = s.lab.lab_time() + ms * 1e6; while (s.lab.lab_time() < to) s.idle_slice(Math.min(to, s.lab.lab_time() + 50e6)); };
  const press = (s, k) => { s.key(k, 'down'); s.camapp.pump(); idle(s, 100); s.key(k, 'up'); s.camapp.pump(); idle(s, 500); };
  const shoot = (s) => { s.key('s1', 'down'); s.camapp.pump(); idle(s, 600); s.key('s2', 'down'); s.camapp.pump(); idle(s, 1200); s.key('s2', 'up'); s.key('s1', 'up'); s.camapp.pump(); idle(s, 800); };
  const frame = (s) => s.frame('boundary')[2];
  const menu = (s) => { press(s, 'menu'); const f = frame(s); press(s, 'menu'); return f; };
  const diff = (a, b, w = 900) => {
    const at = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push([i % w, Math.floor(i / w)]);
    return { pixels: at.length, box: at.length ? at.reduce((r, [x, y]) => [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)], [1e9, 1e9, -1, -1]) : null };
  };
  // the slots as the firmware has them: the SD driver's detect, the file layer's drive status, api_media's status, the
  // media flags, the HLS mount states, the card switches' levels (UI_IN's getter), and the commands each port got
  const state = (s) => {
    const lab = s.lab, st = s.storage, m = s.camapp.media, two = [0, 1];
    return { det: two.map((d) => st.detect(d)), drive: two.map((d) => st.status_word(d)), api: two.map((d) => lab.call(H.ctrl.status, { d0: d }, null, null, 2000000).d0 & 0xFFFF),
      flags: two.map((i) => lab.get(FLAG + i)), mount: H.slots.map((x) => m.mount_state(x.kind)), level: two.map((i) => m.level(i)), ports: [...st.port_commands] };
  };
  const show = (x) => J({ ...x, drive: x.drive.map(hx), api: x.api.map(hx) });
  const shots = (s) => s.lab.call(SHOTS, { d0: 0 }, null, null, 2000000).d0 | 0;
  const vol = (card) => { try { return openVolume((lba, n) => card.read(lba, n)); } catch (e) { return null; } };
  const has = (card, n) => vol(card)?.find(file(n)) ?? null;
  const mounted = (x, d) => (x.api[d] & (MS_CARD | MS_MOUNTED)) === (MS_CARD | MS_MOUNTED) && x.det[d] === 0;
  const empty = (x, d) => x.det[d] !== 0 && x.drive[d] === DRIVE_NO_CARD && x.api[d] === MS_NO_CARD;
  const cardA = new SdCard(), cardB = new SdCard();
  let menu1 = null, menu2 = null;
  // the node host's second card (host/card.mjs secondCard): none without an option, a blank card of the size asked
  // for, a file's card, and the first slot's file refused
  {
    const { secondCard } = await import('../host/card.mjs');
    const sized = secondCard(undefined, '64', undefined).card2?.open(), same = (() => { try { secondCard('/tmp/x.omsd', undefined, '/tmp/./x.omsd'); return null; } catch (e) { return e.message; } })();
    ok(J(secondCard(undefined, undefined, '/tmp/x.omsd')) === '{}' && sized?.kind === 'SDXC' && typeof secondCard('/tmp/y.omsd', undefined, '/tmp/x.omsd').card2?.open === 'function'
      && /a card of its own/.test(same ?? ''), `secondCard: no option, no card; a size, a blank card (${sized?.kind}); the first slot's file refused: ${same}`);
  }

  // ---- one card (the default): the second slot empty
  let pl = null;
  try {
    pl = player(cardA);
    const s = pl.session, lab = s.lab;
    idle(s, 1500);
    const x = state(s);
    ok(x.det[0] === 0 && empty(x, SECOND) && x.ports[0] > 0 && x.ports[1] === 0 && x.level.join() === '0,1',
      `one card: the SD driver's detect answers a card in slot 1 and none in slot 2, whose drive status is ${DRIVE_NO_CARD} and media status ${MS_NO_CARD}; its port gets no command; the card switches' levels 0 and 1: ${show(x)}`);
    ok(mounted(x, 0) && x.flags.join() === '1,0' && x.mount.join() === '8,8' && s.storage.second.card === null && !('second' in s.storage.status()),
      `one card: slot 1 mounted, S-CARD's media flags ${FLAG} / ${FLAG + 1} as the manager's update leaves them (1, 0), the mount states 8 and 8: ${show(x)}`);
    let refused = null;
    try { s.storage.put_card(s.storage.card); } catch (e) { refused = e.message; }
    ok(/each slot takes a card of its own/.test(refused ?? ''), `the first slot's card is refused for the second slot: ${refused}`);
    menu1 = menu(s);
    // the count and the record destination follow the save slot (the firmware's own query and S-CARD's save_slot)
    const n0 = shots(s);
    s.set(SAVE, 1); idle(s, 300);
    const n1 = shots(s);
    shoot(s);
    const none = s.storage.files.length === 0 && s.camapp.images.length === 0 && s.camapp.card_images(0) === 0;
    ok(n0 > 0 && n1 === 0 && none, `one card, the save slot (setting ${SAVE}) at slot 2: the firmware's remaining shots ${n1} (slot 1: ${n0}), and S2 makes no file: ${J(s.storage.files.map((f) => f.path))}`);
    s.set(SAVE, 0); idle(s, 300);
    shoot(s);
    const f1 = has(cardA, 1);
    ok(s.storage.files.length === 1 && s.storage.files[0].path.startsWith(`${names.drive}:`) && f1 && f1.size === s.storage.files[0].size && s.camapp.card_images(0) === 1,
      `one card, the save slot back at slot 1: S2's file ${s.storage.files[0]?.path} on the card (${f1?.size} bytes, read independently), the firmware's image count ${s.camapp.card_images(0)}`);
    // the double-slot record modes are refused
    s.set(MODE, 2); idle(s, 300);
    let stop = null;
    try { shoot(s); } catch (e) { stop = e.message; }
    ok(/double-slot record/.test(stop ?? ''), `the save mode (setting ${MODE}) 2: S2 stops the session, the double-slot record not made: ${(stop ?? 'no stop').slice(0, 160)}`);
  } catch (e) { bad.push(`one card: ${e.message.slice(0, 500)}`); }
  try { pl?.close_session(); } catch { /* closed */ }
  for (const c of [cardA]) { c.state = 'idle'; c.selected = false; c.bus4 = false; }

  // ---- two cards: a blank one in slot 1, the card with the picture in slot 2
  try {
    pl = player(cardB, cardA);
    const s = pl.session, st = s.storage;
    idle(s, 1500);
    const x = state(s), writes = cardA.writes;
    ok(mounted(x, 0) && mounted(x, 1) && x.ports[1] > 0 && x.flags.join() === '1,1' && x.level.join() === '0,0' && st.second.mounted && !st.second.formatted,
      `two cards: both mounted (S-CARD's request for drive 1 the DCF numbering mount alone), the second on its own port, not formatted by the lab, flags 1, 1: ${show(x)}`);
    ok(st.second.dcf?.file === 2 && s.camapp.card_images(0) === 0 && s.camapp.card_images(1) === 1,
      `two cards: the second card's DCF database has its picture (count ${s.camapp.card_images(1)}, next file ${st.second.dcf?.file}), the first card's none (${s.camapp.card_images(0)})`);
    menu2 = menu(s);
    const row = menu1 && diff(menu1, menu2);
    ok(row && row.pixels > 0 && (!ON_LAB_MODEL || (row.pixels === SLOT_ROW.pixels && J(row.box) === J(SLOT_ROW.box))),
      `the menu with two cards against one: the movie Card Slot Settings row enabled, ${row?.pixels} pixels in ${J(row?.box)}${ON_LAB_MODEL ? ` (want ${SLOT_ROW.pixels} in ${J(SLOT_ROW.box)})` : ''}`);
    // the save slot picks the card
    s.set(SAVE, 1); idle(s, 300);
    shoot(s);
    const f2 = has(cardA, 2), second = st.files[0];
    ok(st.files.length === 1 && second.path.startsWith(`${String.fromCharCode(names.drive.charCodeAt(0) + 1)}:`) && second.number === 2 && f2 && f2.size === second.size && has(cardA, 1) && !has(cardB, 1)
      && cardA.writes > writes && s.camapp.card_images(1) === 2 && s.camapp.card_images(0) === 0,
      `the save slot at slot 2: S2's file ${second?.path} is on the second card (${f2?.size} bytes beside its first picture, read independently) and not on the first; the image counts ${s.camapp.card_images(0)} and ${s.camapp.card_images(1)}`);
    s.set(SAVE, 0); idle(s, 300);
    shoot(s);
    const f1 = has(cardB, 1);
    ok(st.files.length === 2 && st.files[1].path.startsWith(`${names.drive}:`) && f1 && f1.size === st.files[1].size && !has(cardA, 3) && s.camapp.card_images(0) === 1,
      `the save slot at slot 1: S2's file ${st.files[1]?.path} is on the first card (${f1?.size} bytes) and the second card got none`);
    // the second card out and in while the camera runs, then the first
    const out = pl.run_input({ type: 'card', action: 'remove', slot: 2 });
    idle(s, 1000);
    let y = state(s);
    ok(out && mounted(y, 0) && empty(y, SECOND) && y.flags.join() === '1,0' && y.level.join() === '0,1' && s.camapp.card_images(1) === 0,
      `the second card out: slot 2 empty to the firmware, its flag 0, the first card still mounted: ${show(y)}`);
    pl.run_input({ type: 'card', action: 'insert', slot: 2 });
    idle(s, 1500);
    y = state(s);
    ok(mounted(y, 0) && mounted(y, 1) && y.flags.join() === '1,1' && y.ports[1] > x.ports[1] && s.camapp.card_images(1) === 2,
      `the second card in again: mounted by the firmware from its own card (its two pictures counted), flags 1, 1: ${show(y)}`);
    pl.run_input({ type: 'card', action: 'remove' });
    idle(s, 1000);
    y = state(s);
    ok(empty(y, 0) && mounted(y, 1) && y.flags.join() === '0,1', `the first card out: slot 1 empty to the firmware (drive status ${hx(y.drive[0])}), the second still mounted: ${show(y)}`);
    pl.run_input({ type: 'card', action: 'insert' });
    idle(s, 1500);
    y = state(s);
    ok(mounted(y, 0) && mounted(y, 1) && y.flags.join() === '1,1', `the first card in again: both mounted: ${show(y)}`);
    let twice = null;
    try { pl.run_input({ type: 'card', action: 'insert', slot: 2 }); } catch (e) { twice = e.message; }
    ok(/in the slot already/.test(twice ?? ''), `a second insert into slot 2 is refused: ${twice}`);
  } catch (e) { bad.push(`two cards: ${e.message.slice(0, 500)}`); }
  try { pl?.close_session(); } catch { /* closed */ }

  // ---- a new blank card put into the empty second slot while the camera runs; the Player keeps it for its next
  // session
  try {
    for (const c of [cardB]) { c.state = 'idle'; c.selected = false; c.bus4 = false; }
    pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...env(), card: holder(cardB) });
    pl.open_session();
    let s = pl.session;
    idle(s, 1500);
    pl.run_input({ type: 'card', action: 'insert', slot: 2 });
    idle(s, 1500);
    const x = state(s), c2 = s.storage.second.card;
    ok(c2 && c2 !== cardB && c2.present && x.det[1] === 0 && (x.api[1] & MS_UNFORMATTED) && !(x.api[1] & MS_MOUNTED) && c2.writes === 0 && x.ports[1] > 0 && x.flags.join() === '1,1',
      `a blank card into slot 2: the firmware finds no file system (media status ${hx(x.api[1])}), does not format it (${c2?.writes} sectors written) and leaves it unmounted; the update's rule flags it: ${show(x)}`);
    // the blank card out and in again before its format: out, slot 2 empty, its flag 0 and its mount state 0, as the
    // manager leaves them under control camapp 3 (below), and S-MEDIA in use; in, the same unformatted card again
    pl.run_input({ type: 'card', action: 'remove', slot: 2 });
    idle(s, 1000);
    const xo = state(s);
    ok(empty(xo, SECOND) && mounted(xo, 0) && xo.flags.join() === '1,0' && xo.mount[1] === 0 && pl.stand_ins_in_use().includes('S-MEDIA'),
      `the blank card out again: slot 2 empty, its flag 0, its mount state 0, S-MEDIA in the stand-ins in use: ${show(xo)}`);
    pl.run_input({ type: 'card', action: 'insert', slot: 2 });
    idle(s, 1500);
    const xi = state(s);
    ok(s.storage.second.card === c2 && (xi.api[1] & MS_UNFORMATTED) && !(xi.api[1] & MS_MOUNTED) && c2.writes === 0 && xi.flags.join() === '1,1' && xi.ports[1] > x.ports[1],
      `the blank card in again: unformatted and unmounted as before, flags 1, 1: ${show(xi)}`);
    // Card Formatting from the menu: with two cards the panel "Select Card to Set Up", its second card, Format Card,
    // Yes
    shoot(s);
    press(s, 'menu');
    for (const k of ['ok', 'down', 'ok', 'up', 'ok', 'up', 'ok']) press(s, k);
    const media = s.camapp.media;
    for (let i = 0; i < 200 && media.formats === 0; i++) idle(s, 50);
    idle(s, 1000);
    const y = state(s), v = vol(c2);
    ok(media.formats === 1 && mounted(y, 1) && mounted(y, 0) && v && v.label.trim() !== '' && v.list().length === 0 && has(cardB, 1) && c2.writes > 0,
      `Card Formatting, the second card: formatted by the firmware's own request (media 1), '${v?.label.trim()}' ${v?.type} with an empty root, mounted; the first card keeps its picture: ${show(y)}`);
    press(s, 'menu');
    pl.close_session();
    for (const c of [cardB, c2]) { c.state = 'idle'; c.selected = false; c.bus4 = false; }
    pl.open_session();
    s = pl.session;
    idle(s, 1500);
    const z = state(s);
    ok(s.storage.second.card === c2 && mounted(z, 0) && mounted(z, 1) && !s.storage.second.formatted, `the player's next session starts with the same second card, mounted: ${show(z)}`);
  } catch (e) { bad.push(`a new second card: ${e.message.slice(0, 500)}`); }
  try { pl?.close_session(); } catch { /* closed */ }

  // ---- control camapp 3 (E143): the firmware's own media manager
  if (ON_LAB_MODEL) {
    for (const [tag, cards] of [['one card', [new SdCard()]], ['two cards', [new SdCard(), cardA]]]) {
      try {
        for (const c of cards) { c.state = 'idle'; c.selected = false; c.bus4 = false; }
        pl = player(cards[0], cards[1] ?? null, 3);
        const s = pl.session;
        idle(s, 2000);
        const x = state(s), m = menu(s), same = diff(m, cards.length === 1 ? menu1 : menu2);
        if (cards.length === 1) {
          ok(mounted(x, 0) && empty(x, SECOND) && x.flags.join() === '1,0' && x.ports[1] === 0 && x.mount.join() === '8,8' && same.pixels === 0,
            `camapp 3, one card: the media manager finds slot 2 empty, clears its flag and sends its port nothing; its menu is camapp 1's word for word (${same.pixels} pixels differ): ${show(x)}`);
          // a blank card into the empty slot and out again: the manager's flags and mount states, the ones S-CARD and
          // S-MEDIA give in camapp 1 (above); S-MEDIA is not in use
          pl.run_input({ type: 'card', action: 'insert', slot: 2 });
          idle(s, 2500);
          const xi = state(s);
          pl.run_input({ type: 'card', action: 'remove', slot: 2 });
          idle(s, 1500);
          const xo = state(s);
          ok((xi.api[1] & MS_UNFORMATTED) && !(xi.api[1] & MS_MOUNTED) && xi.flags.join() === '1,1' && xi.mount[1] === 8 && empty(xo, SECOND) && xo.flags.join() === '1,0'
            && xo.mount[1] === 0 && s.storage.slot(SECOND).insertions === 1 && s.storage.slot(SECOND).removals === 1 && !pl.stand_ins_in_use().includes('S-MEDIA'),
            `camapp 3, a blank card into slot 2 and out: the manager flags it, then clears its flag and mount state; S-MEDIA not in use: ${show(xi)} ${show(xo)}`);
          continue;
        }
        ok(mounted(x, 0) && mounted(x, 1) && x.flags.join() === '1,1' && x.ports[1] > 0 && x.mount.join() === '8,8' && same.pixels === 0,
          `camapp 3, two cards: the media manager mounts the second card itself (${x.ports[1]} commands on its port), both flags 1; its menu is camapp 1's with two cards (${same.pixels} pixels differ): ${show(x)}`);
        // the second card out and in: the manager's own unmount and mount, with the sequence in its standby (101) and
        // the save slot at slot 1. The removal of the card the save slot names stops under camapp 3, at the sequence
        // parts' read of module 9's state (0x50c8a335, outside S-TAKEOVER's list), as the first slot's does
        // (docs/hle-gaps.md 4.8.12, open). Before S2, not after it: the sequence parts hand a card switch's change on
        // to the manager only in the phases 101, 102 and 103 (0x50c93ac7's test at 0x50c93b82..0x50c93ba7, D); in
        // 106, where S-TAKERDY's unanswered take-picture request leaves the sequence after S2, the phase's own case
        // (vt +5024, 0x50cc00d4) takes it and the manager neither unmounts nor mounts the card (X, docs/hle-gaps.md
        // 4.1.12)
        pl.run_input({ type: 'card', action: 'remove', slot: 2 });
        idle(s, 1500);
        let y = state(s);
        ok(mounted(y, 0) && empty(y, SECOND) && y.flags.join() === '1,0' && y.mount[1] === 0, `camapp 3, the second card out: the manager unmounts it and clears its flag: ${show(y)}`);
        pl.run_input({ type: 'card', action: 'insert', slot: 2 });
        idle(s, 2500);
        y = state(s);
        ok(mounted(y, 0) && mounted(y, 1) && y.flags.join() === '1,1' && y.mount[1] === 8 && s.storage.slot(SECOND).mounted, `camapp 3, the second card in: the manager mounts it again: ${show(y)}`);
        const before = s.camapp.card_images(1);
        s.set(SAVE, 1); idle(s, 300);
        shoot(s);
        const got = s.storage.files[0], f = got && has(cardA, got.number);
        ok(s.storage.files.length === 1 && got.path.startsWith(`${String.fromCharCode(names.drive.charCodeAt(0) + 1)}:`) && f && f.size === got.size && s.camapp.card_images(1) === before + 1,
          `camapp 3, the save slot at slot 2: S2's file ${got?.path} on the second card (${f?.size} bytes), its image count ${before} + 1`);
      } catch (e) { bad.push(`camapp 3, ${tag}: ${e.message.slice(0, 500)}`); }
      try { pl?.close_session(); } catch { /* closed */ }
    }
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
  if (process.argv.includes('--hls')) {
    const x = await storageHls();
    console.log(`the HLS media side in play: ${x.checks - x.bad.length}/${x.checks}`);
    x.notes.forEach((t) => console.log('   note:', t));
    x.bad.forEach((t) => console.log('  ', t));
    n += x.bad.length;
  }
  if (process.argv.includes('--slot2')) {
    const x = await storageSlots();
    console.log(`the second card slot in play: ${x.checks - x.bad.length}/${x.checks}`);
    x.bad.forEach((t) => console.log('  ', t));
    n += x.bad.length;
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
