// The host's writer of a card's volume (src/lab/cardfs.mjs: bin/card.mjs's put, mkdir and rm, and the files a
// session's card gets before the firmware mounts it), checked by the independent readers it shares no code with
// (refs/fat.mjs, refs/exfat.mjs, refs/volume.mjs) and by the firmware:
//   cardfsUnits     without firmware: on the FAT32 volume and the exFAT volume test_storage.mjs builds, a file put
//                   under directories the writer makes, read back with its bytes, its stamp (the fixed one, and one
//                   given), the volume consistent by the reader's check (the chains, no cluster twice, none lost, the
//                   FAT's copies alike and FSInfo's free count the FAT's on FAT32; the bitmap on exFAT, its backup boot
//                   region untouched); a file replaced (its old clusters given back), a directory grown past its
//                   cluster (on exFAT a contiguous one chained first), a file deleted with its long-name entries, an
//                   empty file; refused: a name FAT32's 8.3 or exFAT's rules do not take (on FAT32 one that only Unicode's
//                   upper-casing makes 8.3, by put and rm, and not found by the reader), a path through a file, a
//                   missing file, a directory, a blank card, a FAT16 volume and a full card (the volume unchanged:
//                   each operation is all or nothing); a card's sector store written directly (zero sectors not
//                   kept, the card marked dirty so a closing session saves it) and the session hook (withCardFiles:
//                   once, at the first open; a blank card refused). Negative controls: on the written volume a cleared
//                   FAT entry, a cross-linked chain, a lost cluster, FSInfo's free count off by one, a FAT copy
//                   changed, an exFAT bitmap bit cleared and a set checksum changed are each caught by the reader
//   cardCliTests    without firmware: bin/card.mjs on a card the test makes (ls, put, get to a file and to stdout,
//                   mkdir, rm, --stamp, --help; refusals exit 1 with one 'card.mjs: ' line, a LOCAL get cannot write
//                   and a card in a read-only directory among them (the card unchanged, no .tmp left); usage errors 2)
//   cardfsSession   (firmware) on the body of OM_EMU_MODEL (E143 by default), on a 64 GiB SDXC card (the
//                   firmware's exFAT on E143 and E147) and the default 8 GiB SDHC card (FAT32): a blank card the
//                   firmware formats, S2's picture on it; between sessions the writer puts the picture back under a
//                   later DCF number and deletes the old name, and the session hook puts a file of the host's own at
//                   the next start; the firmware mounts the card without a format, its DCF numbering mount takes the
//                   next number after the writer's and its own image count finds the picture; the host saves the
//                   card at the close with the hook's file; after a power cycle S2 adds the next picture and leaves
//                   the writer's files intact (its allocation took the writer's FAT and FSInfo, or bitmap); a
//                   negative control: the FAT32 card with the put-back picture's clusters left free in the FAT (a
//                   writer that did not mark them) is reported by the reader's check, and the firmware's S2 on it
//                   stops or writes over the picture; bin/card.mjs new (a blank card the model's firmware formats,
//                   saved FAT32 and empty), and bin/play.mjs --card-put on it (the file listed while the session runs
//                   and on the card it saved; its refusals before the server starts)
//   node emu/test/test_cardfs.mjs [--session]
import { SdCard, SECTOR, cardImage, cardFromImage, cardSectors } from '../src/lab/sdcard.mjs';
import { openCardFs, cardDevice, cardPut, withCardFiles, fatStamp, shortName, FIXED_STAMP, CardFsError } from '../src/lab/cardfs.mjs';
import { FatVolume } from '../refs/fat.mjs';
import { ExfatVolume } from '../refs/exfat.mjs';
import { openVolume } from '../refs/volume.mjs';
import { buildFat32, buildExfat } from './test_storage.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (n, k = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + k * 13 + (i >> 9)) & 255);
// a test volume's disk as the writer's device
const diskDevice = (v) => ({ read: v.read, write: (lba, b) => v.disk.set(b, lba * SECTOR) });

function fatUnits(ok) {
  const f = buildFat32(), dev = diskDevice(f), vol = () => new FatVolume(f.read, f.start);
  const w = openCardFs(dev), v0 = vol(), free0 = v0.freeClusters();
  ok(w.type === 'FAT32' && v0.check().length === 0, `the test's FAT32 volume opens for writing and is consistent before: ${v0.check()}`);
  // a file under two new directories: one cluster each, then the file's two (512-byte clusters), from FSInfo's hint 6
  const a = bytes(1000), r = w.put('OM3MOD/SUB/LOOKS.BIN', a);
  let v = vol();
  const e = v.find('om3mod/sub/looks.bin');
  ok(JSON.stringify(r.made) === '["OM3MOD","OM3MOD/SUB"]' && !r.replaced && r.clusters === 2, `put made the directories: ${JSON.stringify(r)}`);
  ok(e && !e.dir && e.size === 1000 && same(v.data(e), a) && e.short === 'LOOKS.BIN' && (e.attr & 0x20) && e.date === FIXED_STAMP.date && e.time === FIXED_STAMP.time,
    `read back by refs/fat.mjs: ${JSON.stringify(e && { short: e.short, size: e.size, attr: e.attr, date: e.date, time: e.time })}`);
  const sub = v.find('OM3MOD/SUB'), dots = sub && v.list(sub.cluster);
  ok(sub?.dir && dots?.[0]?.name === '.' && dots[0].cluster === sub.cluster && dots[1]?.name === '..' && dots[1].cluster === v.find('OM3MOD').cluster && v.list(v.find('OM3MOD').cluster)[1].cluster === 0,
    'a new directory\'s . and .. entries (.. 0 in the root)');
  ok(JSON.stringify([v.find('OM3MOD').cluster, sub?.cluster, ...v.chain(e?.cluster ?? 0)]) === '[6,7,8,9]', `the clusters from FSInfo's hint on: ${v.find('OM3MOD')?.cluster}, ${sub?.cluster}, ${v.chain(e?.cluster ?? 0)}`);
  ok(v.freeClusters() === free0 - 4 && v.fsInfo().free === v.freeClusters() && v.fsInfo().next === 10 && v.check().length === 0, `FSInfo: free ${v.fsInfo().free} (the FAT's ${v.freeClusters()}), next ${v.fsInfo().next}; consistent: ${v.check()}`);
  const fat2 = f.fat + 544 * SECTOR;
  ok(same(f.disk.subarray(f.fat, f.fat + 64), f.disk.subarray(fat2, fat2 + 64)), 'the second FAT is the first\'s');
  // replace it (shorter), with a stamp; the old chain given back
  const b = bytes(300, 2), st = fatStamp([2026, 11, 13, 12, 34, 56]);
  const r2 = w.put('OM3MOD/SUB/looks.bin', b, { stamp: st });
  v = vol();
  const e2 = v.find('OM3MOD/SUB/LOOKS.BIN');
  ok(r2.replaced && e2 && same(v.data(e2), b) && e2.date === (46 << 9 | 11 << 5 | 13) && e2.time === (12 << 11 | 34 << 5 | 28) && v.list(sub.cluster).length === 3,
    `replaced in its entry, dated ${e2?.date.toString(16)} ${e2?.time.toString(16)}`);
  ok(v.freeClusters() === free0 - 3 && v.check().length === 0, `the old clusters given back: ${v.freeClusters()} free; consistent: ${v.check()}`);
  // a directory grown past its one cluster (16 entries a cluster here): 20 files
  for (let i = 0; i < 20; i++) w.put(`DCIM/F${i}.TXT`, bytes(10 + i, i));
  v = vol();
  const dcim = v.find('DCIM');
  ok(v.chain(dcim.cluster).length === 2 && v.list(dcim.cluster).length === 22 && v.find('DCIM/F19.TXT') && same(v.data(v.find('DCIM/F19.TXT')), bytes(29, 19)) && v.check().length === 0,
    `DCIM grew to ${v.chain(dcim.cluster).length} clusters holding the 20 files; consistent: ${v.check()}`);
  // an empty file: no cluster
  w.put('EMPTY', new Uint8Array(0));
  v = vol();
  ok(v.find('EMPTY')?.size === 0 && v.find('EMPTY').cluster === 0 && v.check().length === 0, 'an empty file has no cluster');
  // the long-named file deleted: its LFN entry and short entry marked, its chain given back
  const before = v.freeClusters(), rm = w.rm('LONGNA~1.JPG');
  v = vol();
  ok(rm.clusters === 2 && !v.list().some((x) => x.name === 'Long Name.jpg') && v.deleted().some((x) => x.tail === 'ONGNA~1.JPG') && v.freeClusters() === before + 2 && v.check().length === 0,
    `deleted with its long name: ${JSON.stringify(rm)}, the root ${v.list().map((x) => x.name)}`);
  const raw = f.read(f.start + 32 + 2 * 544, 1);
  ok(raw[64] === 0xe5 && raw[64 + 11] === 0x0f && raw[96] === 0xe5, 'the long-name entry before it marked deleted too');
  // refusals
  w.put('FILM.BIN', bytes(10, 4));
  const snap = f.disk.slice();
  // names Unicode's upper-casing turns into 8.3 ones (sharp s, the fi ligature, long s, dotless i): refused by put and
  // rm, not folded into STRASSE.TXT or FILM.BIN, and not found by the reader under them
  const folds = ['stra\u00dfe.txt', '\ufb01lm.bin', '\u017f.txt', '\u0131.txt'];
  ok(folds.every((n) => throwsLike(() => w.put(n, a), /not an 8\.3 name/)) && throwsLike(() => w.rm('\ufb01lm.bin'), /not an 8\.3 name/) && same(f.disk, snap)
    && vol().find('\ufb01lm.bin') === null && vol().find('stra\u00dfe.txt') === null && vol().find('film.bin')?.size === 10,
    `a name upper-cased into an 8.3 one refused, the volume unchanged, FILM.BIN kept and not found under '\ufb01lm.bin': ${folds.map((n) => { try { return shortName(n); } catch { return 'refused'; } })}`);
  ok(throwsLike(() => w.put('Long Name.jpg', a), /not an 8\.3 name/) && throwsLike(() => shortName('ABCDEFGHI.TXT'), /8\.3/) && throwsLike(() => shortName('A.TEXT'), /8\.3/) && throwsLike(() => shortName('A B.TXT'), /8\.3/),
    'a name 8.3 does not take is refused, not shortened');
  ok(throwsLike(() => w.put('EMPTY/X.TXT', a), /is a file/) && throwsLike(() => w.rm('NONE.TXT'), /no such file/) && throwsLike(() => w.rm('DCIM'), /is a directory/)
    && throwsLike(() => w.put('DCIM', a), /is a directory/) && throwsLike(() => w.rm('NODIR/A.TXT'), /no such directory/) && throwsLike(() => w.put('A/../B', a), /'\.\.'/),
    'a path through a file, a missing file or directory, a directory as a file and .. refused');
  ok(throwsLike(() => w.put('BIG/HUGE.BIN', new Uint8Array(v.freeClusters() * 512 + 1)), /card is full/) && same(f.disk, snap), 'a full card: refused, and the volume unchanged (not even the directory it would have made)');
  // negative controls: the reader catches each of these on the written volume
  const control = (what, change, re) => {
    const g = buildFat32(), gw = openCardFs(diskDevice(g));
    gw.put('OM3MOD/LOOKS.BIN', bytes(2000)); gw.put('OM3MOD/DEBUG.TXT', bytes(600, 3));
    const gv = new FatVolume(g.read, g.start), clean = gv.check();
    change(g, gv);
    const p = new FatVolume(g.read, g.start).check();
    ok(clean.length === 0 && p.some((x) => re.test(x)), `${what}: reported (${p.join('; ') || 'nothing'})`);
  };
  const putFat = (g, c, val) => { for (const at of [g.fat, g.fat + 544 * SECTOR]) for (let i = 0; i < 4; i++) g.disk[at + 4 * c + i] = (val >>> (8 * i)) & 255; };
  control('a cleared FAT entry in the file\'s chain', (g, gv) => putFat(g, gv.chain(gv.find('OM3MOD/LOOKS.BIN').cluster)[1], 0), /LOOKS\.BIN: its chain reaches a free entry/);
  control('a chain cross-linked into another file', (g, gv) => putFat(g, gv.find('OM3MOD/DEBUG.TXT').cluster, gv.chain(gv.find('OM3MOD/LOOKS.BIN').cluster)[2]), /cluster \d+ is .*LOOKS\.BIN's and .*DEBUG\.TXT's/);
  control('a cluster marked in use that nothing takes', (g) => putFat(g, 500, 0x0fffffff), /1 cluster\(s\) in use in the FAT and taken by nothing \(the first 500\)/);
  control('FSInfo\'s free count off by one', (g) => { const at = (g.start + 1) * SECTOR + 488; g.disk[at] += 1; }, /FSInfo's free count/);
  control('the second FAT copy changed', (g) => { g.disk[g.fat + 544 * SECTOR + 4 * 300] = 7; }, /FAT copy 2 differs/);
  // a FAT16 volume refused
  const f16 = buildFat32();
  f16.disk[f16.start * SECTOR + 22] = 1;           // BPB_FATSz16 set: a FAT12 / FAT16 BPB
  ok(throwsLike(() => openCardFs(diskDevice(f16)), /FAT12 or FAT16/), 'a FAT16 BPB is refused');
}

function exfatUnits(ok) {
  const x = buildExfat(), dev = diskDevice(x), vol = () => new ExfatVolume(x.read, x.start);
  const w = openCardFs(dev), boot = x.disk.slice(x.sec(0), x.sec(24));
  ok(w.type === 'exFAT' && vol().check().length === 0, 'the test\'s exFAT volume opens for writing');
  // a file in the root: the deleted set's entries taken, the root not grown
  const a = bytes(700), r = w.put('LOOKS.BIN', a);
  let v = vol();
  const e = v.find('looks.bin');
  ok(e && !e.dir && !e.contiguous && e.size === 700 && e.validSize === 700 && same(v.data(e), a) && e.date === FIXED_STAMP.date && e.time === FIXED_STAMP.time && (e.attr & 0x20),
    `read back by refs/exfat.mjs (its set checksum and name hash verified): ${JSON.stringify(e && { size: e.size, valid: e.validSize, date: e.date })}`);
  ok(r.clusters === 2 && v.chain(4).length === 1 && v.check().length === 0, `the root not grown (the deleted set's entries reused): ${v.chain(4)}; consistent: ${v.check()}`);
  // directories made, a long name with case kept, and a name past one name entry
  const name = 'A Long Mixed-Case Name For Two Entries.txt', b = bytes(1500, 2);
  w.put(`OM3MOD/Sub Dir/${name}`, b);
  v = vol();
  const e2 = v.find(`om3mod/SUB DIR/${name.toUpperCase()}`);
  ok(e2 && e2.name === name && same(v.data(e2), b) && v.find('OM3MOD').dir && v.find('OM3MOD').size === SECTOR && v.check().length === 0 && v.chain(4).length === 2,
    `a new path's directories (the root grown to ${v.chain(4).length} clusters), the name as given, found up-cased: ${e2?.name}; consistent: ${v.check()}`);
  // a contiguous directory grown: DCIM (NoFatChain, one cluster) chained, its lengths and set checksum updated
  for (let i = 0; i < 6; i++) w.put(`DCIM/P101000${i + 2}.JPG`, bytes(100 + i, i));
  v = vol();
  const dcim = v.find('DCIM');
  ok(dcim && !dcim.contiguous && dcim.size === 2 * SECTOR && dcim.validSize === 2 * SECTOR && v.list(dcim).length === 7 && same(v.data(v.find('DCIM/P1010001.JPG')), x.pic) && same(v.data(v.find('DCIM/P1010007.JPG')), bytes(105, 5)) && v.check().length === 0,
    `DCIM chained and grown to ${dcim?.size} bytes, its first picture kept: ${v.list(dcim).map((y) => y.name)}; consistent: ${v.check()}`);
  // a replaced file (by another case of its name): the name kept, the old chain given back; a deleted one
  const free = v.freeClusters();
  w.put('a long picture name.JPG', bytes(10, 9));
  v = vol();
  const e3 = v.find('A Long Picture Name.jpg');
  ok(e3?.name === 'A Long Picture Name.jpg' && e3.size === 10 && e3.validSize === 10 && same(v.data(e3), bytes(10, 9)) && v.freeClusters() === free + 1 && v.check().length === 0, `replaced, its name kept: ${e3?.name}, ${v.freeClusters()} free`);
  w.rm('DCIM/P1010003.JPG');
  w.put('EMPTY.TXT', new Uint8Array(0));
  v = vol();
  ok(v.find('DCIM/P1010003.JPG') === null && v.list(v.find('DCIM')).length === 6 && v.find('EMPTY.TXT')?.size === 0 && v.check().length === 0, 'a file deleted (its set\'s in-use bits clear) and an empty one put');
  ok(same(x.disk.subarray(x.sec(0), x.sec(24)), boot) && v.backupMatches(), 'the boot regions untouched');
  // refusals
  const snap = x.disk.slice();
  ok(throwsLike(() => w.put('BAD*NAME.TXT', a), /not an exFAT name/) && throwsLike(() => w.put('X'.repeat(256), a), /not an exFAT name/) && throwsLike(() => w.rm('DCIM'), /is a directory/)
    && throwsLike(() => w.put('LOOKS.BIN/X', a), /is a file/) && throwsLike(() => w.rm('NONE'), /no such file/), 'exFAT\'s forbidden names, a directory, a path through a file and a missing file refused');
  ok(throwsLike(() => w.put('NEW/BIG.BIN', new Uint8Array(vol().freeClusters() * 512 + 1)), /card is full/) && same(x.disk, snap), 'a full card: refused, the volume unchanged');
  // negative controls on the written volume
  const y = buildExfat(), yw = openCardFs(diskDevice(y));
  yw.put('LOOKS.BIN', bytes(700));
  const c = new ExfatVolume(y.read, y.start).find('LOOKS.BIN').cluster, i = c - 2;
  y.disk[y.cl(2) + (i >> 3)] &= ~(1 << (i & 7));
  const p = new ExfatVolume(y.read, y.start).check();
  ok(p.some((q) => new RegExp(`cluster ${c} \\(/LOOKS\\.BIN\\) is free in the bitmap`).test(q)), `a written file's cluster cleared in the bitmap is reported: ${p}`);
  const z = buildExfat(), zw = openCardFs(diskDevice(z));
  zw.put('LOOKS.BIN', bytes(700));
  // its set in the root's cluster: the file entry whose first name entry starts with 'L'
  let at = -1;
  for (let o = z.cl(4); o < z.cl(5) && at < 0; o += 32) if (z.disk[o] === 0x85 && z.disk[o + 64] === 0xc1 && z.disk[o + 66] === 0x4c) at = o;
  ok(new ExfatVolume(z.read, z.start).find('LOOKS.BIN') && at > 0, 'the written set found raw');
  z.disk[at + 8] ^= 1;          // its create timestamp: the set checksum no longer the entries'
  ok(throwsLike(() => new ExfatVolume(z.read, z.start).list(), /set checksum/), 'a changed byte in a written set: its set checksum refused by the reader');
}

export function cardfsUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  for (const [name, fn] of [['FAT32', fatUnits], ['exFAT', exfatUnits]]) {
    try { fn(ok); } catch (e) { bad.push(`${name}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); }
  }
  // the stamp
  ok(JSON.stringify(fatStamp([1980, 1, 1, 0, 0, 0])) === JSON.stringify(FIXED_STAMP) && throwsLike(() => fatStamp([1979, 12, 31, 0, 0, 0]), /1980 to 2107/), 'fatStamp: the FAT epoch is FIXED_STAMP; 1979 refused');
  // a card: blank refused; its sector store written directly (zero sectors not kept), the card's own counters unchanged
  const blank = new SdCard();
  ok(throwsLike(() => openCardFs(cardDevice(blank)), /blank .*card\.mjs new/) && throwsLike(() => cardPut(blank, [{ path: 'A.TXT', bytes: bytes(5) }]), /blank/), 'a blank card is refused, with the way to format one');
  const f = buildFat32(), card = new SdCard();
  for (let lba = 0; lba < 72048; lba++) { const s = f.disk.subarray(lba * SECTOR, (lba + 1) * SECTOR); if (s.some((b) => b)) card.data.set(lba, s.slice()); }
  const writes = card.writes, res = cardPut(card, [{ path: 'OM3MOD/LOOKS.BIN', bytes: bytes(1000) }, { path: 'OM3MOD/DEBUG.TXT', bytes: new TextEncoder().encode('debug') }]);
  const back = cardFromImage(cardImage(card)), cv = openVolume((lba, n) => back.read(lba, n));
  ok(res.length === 2 && same(cv.data(cv.find('OM3MOD/LOOKS.BIN')), bytes(1000)) && cv.find('OM3MOD/DEBUG.TXT')?.size === 5 && cv.check().length === 0 && card.writes === writes && card.take_dirty() && [...card.data.values()].every((s) => s.some((b) => b)),
    'cardPut on a card: read back through its saved image, consistent, its command counters untouched, its dirty flag set (a session saves it), no zero sector stored');
  // the session hook: the files at the first open only; a blank card refused at the open
  let opened = 0, got = null;
  const c2 = cardFromImage(cardImage(back)), hook = withCardFiles({ open: () => { opened++; return c2; }, save() {}, file: 'x' }, [{ path: 'HOOK.TXT', bytes: bytes(3) }], { results: (r) => { got = r; } });
  hook.open();
  const h1 = openVolume((lba, n) => c2.read(lba, n)).find('HOOK.TXT');
  openCardFs(cardDevice(c2)).rm('HOOK.TXT');
  hook.open();
  ok(opened === 2 && h1?.size === 3 && got?.[0]?.op === 'put' && openVolume((lba, n) => c2.read(lba, n)).find('HOOK.TXT') === null && hook.file === 'x', 'withCardFiles: the files put at the first open only, the provider\'s other fields kept');
  ok(throwsLike(() => withCardFiles({ open: () => new SdCard(), save() {} }, [{ path: 'A.TXT', bytes: bytes(1) }]).open(), /blank/), 'withCardFiles on a blank card: refused at the open');
  ok(new CardFsError('x') instanceof Error, 'CardFsError is an Error');
  return { checks, bad };
}

// bin/card.mjs without firmware, on a saved card this test makes from the FAT32 volume test_storage.mjs builds (and a
// blank one): ls, put, get (to a file and to stdout), mkdir, rm, --stamp, --help; refusals exit 1 with the reason
// after 'card.mjs: ', usage errors exit 2 with the usage line
const CARD_MJS = new URL('../bin/card.mjs', import.meta.url).pathname;
const cardTool = (...args) => spawnSync(process.execPath, [CARD_MJS, ...args], { encoding: 'buffer', timeout: 60000 });
const text = (r) => `${r.stdout}${r.stderr}`;
export function cardCliTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-cardfs-'));
  try {
    const f = buildFat32(), card = new SdCard();
    for (let lba = 0; lba < 72048; lba++) { const s = f.disk.subarray(lba * SECTOR, (lba + 1) * SECTOR); if (s.some((b) => b)) card.data.set(lba, s.slice()); }
    const file = path.join(tmp, 'card.omsd'), local = path.join(tmp, 'looks.bin'), back = path.join(tmp, 'back.bin'), blank = path.join(tmp, 'blank.omsd');
    fs.writeFileSync(file, cardImage(card)); fs.writeFileSync(local, bytes(5000)); fs.writeFileSync(blank, cardImage(new SdCard()));
    let r = cardTool('ls', file);
    ok(r.status === 0 && /^# 8 GiB SDHC card, FAT32 'TEST LABEL'/.test(text(r)) && /D .* DCIM\n/.test(text(r)) && /F +700 .* Long Name\.jpg\n/.test(text(r)), `ls: ${r.status} ${text(r).slice(0, 300)}`);
    r = cardTool('put', file, local, 'om3mod/looks.bin');
    ok(r.status === 0 && /wrote om3mod\/looks\.bin, 5000 bytes in 10 cluster\(s\) \(made om3mod\)/.test(text(r)), `put: ${r.status} ${text(r)}`);
    r = cardTool('get', file, 'OM3MOD/LOOKS.BIN', back);
    ok(r.status === 0 && same(new Uint8Array(fs.readFileSync(back)), bytes(5000)), `get to a file: ${r.status} ${text(r)}`);
    r = cardTool('get', file, 'OM3MOD/LOOKS.BIN', '-');
    ok(r.status === 0 && same(new Uint8Array(r.stdout), bytes(5000)), `get to stdout: ${r.status} ${r.stdout.length} bytes`);
    r = cardTool('put', file, local, 'OM3MOD/DEBUG.TXT', '--stamp', '2026-11-13T12:34:56');
    const ls = cardTool('ls', file, 'OM3MOD');
    ok(r.status === 0 && /F +5000 {2}1980-01-01 00:00 {2}OM3MOD\/LOOKS\.BIN\n/.test(text(ls)) && /F +5000 {2}2026-11-13 12:34 {2}OM3MOD\/DEBUG\.TXT\n/.test(text(ls)), `ls PATH with the stamps: ${text(ls)}`);
    r = cardTool('mkdir', file, 'A/B');
    ok(r.status === 0 && /made A, A\/B/.test(text(r)) && cardTool('ls', file, '--recursive').stdout.toString().includes('A/B\n'), `mkdir and ls --recursive: ${text(r)}`);
    r = cardTool('rm', file, 'OM3MOD/LOOKS.BIN');
    const gone = cardTool('get', file, 'OM3MOD/LOOKS.BIN', back);
    ok(r.status === 0 && /deleted OM3MOD\/LOOKS\.BIN \(5000 bytes, 10 cluster\(s\) free again\)/.test(text(r)) && gone.status === 1 && /^card\.mjs: .*OM3MOD\/LOOKS\.BIN: no such file\n$/.test(text(gone)), `rm, then get refused: ${text(r)} ${text(gone)}`);
    const saved = cardFromImage(new Uint8Array(fs.readFileSync(file))), v = openVolume((lba, n) => saved.read(lba, n));
    ok(v.check().length === 0 && v.find('OM3MOD/DEBUG.TXT')?.size === 5000, `the saved card is consistent: ${v.check()}`);
    // refusals (1) and usage errors (2)
    const refused = [['put', file, local, 'Long Name.jpg', /not an 8\.3 name/], ['put', file, local, 'stra\u00dfe.txt', /not an 8\.3 name/], ['ls', blank, /the card is blank \(not formatted\): node emu\/bin\/card\.mjs new/], ['put', blank, local, 'A.TXT', /the card is blank/],
      ['new', file, /exists \(--force/], ['ls', path.join(tmp, 'none.omsd'), /cannot read it \(ENOENT\)/], ['ls', local, /not an OMSD/], ['rm', file, 'DCIM', /is a directory/], ['get', file, 'DCIM', back, /is a directory/],
      // a LOCAL get cannot write: the reason on one line, no Node stack
      ['get', file, 'OM3MOD/DEBUG.TXT', path.join(tmp, 'none', 'x.bin'), /^card\.mjs: .*x\.bin: cannot write it \(ENOENT\)\n$/], ['get', file, 'OM3MOD/DEBUG.TXT', tmp, /^card\.mjs: .*: cannot write it \(EISDIR\)\n$/]];
    for (const [cmd, ...rest] of refused) {
      const re = rest.pop(), x = cardTool(cmd, ...rest);
      ok(x.status === 1 && /^card\.mjs: /.test(text(x)) && re.test(text(x)), `${cmd} ${rest.slice(1).join(' ')}: exit ${x.status}, ${text(x).trim()}`);
    }
    // a card whose directory is read-only (not as root, whom the mode does not stop): the put refused on one line, the
    // card's bytes as they were and no temporary file left
    if (process.getuid?.() !== 0) {
      const ro = path.join(tmp, 'ro'), rc = path.join(ro, 'card.omsd');
      fs.mkdirSync(ro); fs.copyFileSync(file, rc); fs.chmodSync(ro, 0o555);
      const was = fs.readFileSync(rc), x = cardTool('put', rc, local, 'RO.BIN');
      fs.chmodSync(ro, 0o755);
      ok(x.status === 1 && /^card\.mjs: .*card\.omsd: cannot save it \(EACCES\)\n$/.test(text(x)) && fs.readFileSync(rc).equals(was) && !fs.existsSync(`${rc}.tmp`),
        `put on a card in a read-only directory: exit ${x.status}, ${text(x).trim().slice(0, 200)}`);
    }
    for (const args of [[], ['format', file], ['get', file], ['put', file, local, 'X.TXT', '--stamp', 'yesterday'], ['ls', file, '--bogus']]) {
      const x = cardTool(...args);
      ok(x.status === 2 && /^card\.mjs[ :]/.test(text(x)) && /usage: /.test(text(x)), `${args.join(' ') || '(nothing)'}: exit ${x.status}, ${text(x).trim().slice(0, 200)}`);
    }
    r = cardTool('--help');
    ok(r.status === 0 && /node emu\/bin\/card\.mjs new CARD\.omsd/.test(text(r)), '--help prints the usage');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { checks, bad };
}

// (firmware) the writer's files mounted by the firmware on the body of OM_EMU_MODEL
export async function cardfsSession() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { A, MODEL } = await import('../src/fw/model.mjs');
  const { STORAGE } = await import('../src/lab/storage.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  const { runtime } = await import('../src/lab/hle.mjs');
  if (!STORAGE) return { checks: 1, bad: [`${MODEL}: src/fw/models.mjs card_fs does not run the card's file system natively`], notes };
  const rom = loadImage(), resBlock = loadBlock(), nand = loadNand(), DIR = `DCIM/100${STORAGE.names.folder}`;
  // a player whose card is the host's (env.card: a card, or a provider)
  const player = (card) => new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
    { rom, resBlock, nand, createHash, wallClock: () => performance.now() / 1000, card: card instanceof SdCard ? { open: () => card, save() {} } : card });
  // S2 with S-SCENE's live view on the E143 family (as test_storage.mjs storageSession)
  const SHOT = [...(BOARD.family === 'E143' ? [{ type: 'scene', change: { liveview: true } }] : []), { type: 'token', token: 'WAIT:100' }, { type: 'key', id: 's1', action: 'down' },
    { type: 'key', id: 's2', action: 'down' }, { type: 'token', token: 'WAIT:700' }, { type: 'key', id: 's2', action: 'up' }, { type: 'key', id: 's1', action: 'up' }];
  const volOf = (card) => openVolume((lba, n) => card.read(lba, n));
  const pictures = (card) => { const v = volOf(card), d = v.find(DIR); return d ? v.list(v.type === 'exFAT' ? d : d.cluster).filter((e) => !e.dir) : []; };
  // the firmware's own image count (the media API's, type 1), S-CARD's hook on it set aside (test_storage.mjs)
  const imageCount = (lab) => {
    const key = runtime(A(0x503FEEA4)), hook = lab.hooks.get(key);
    lab.hooks.delete(key);
    try { return lab.call(A(0x503FEEA4), { d0: 0, d1: 1 }, null, null, 2000000).d0; } finally { if (hook) lab.hooks.set(key, hook); }
  };
  const host = bytes(70000, 5);
  // steps 1 to 3 on a blank card of gib GiB (8: SDHC, FAT32; 64: SDXC, the body's choice, exFAT on E143 and E147):
  // {kept: the card as the writer left it before step 3, putName, pic}, or null when the first session made no picture
  const round = (gib) => {
    const card = new SdCard({ sectors: cardSectors(gib) }), tag = `${gib} GiB`;
    let pic = null, picName = null, pl = player(card);
    try {
      // 1. the firmware formats the blank card and writes S2's picture
      pl.open_session();
      for (const inp of SHOT) pl.run_input(inp);
      const files = pictures(card);
      ok(files.length === 1, `${tag}: S2's picture on the firmware's card: ${files.map((e) => e.name)}`);
      picName = files[0]?.name ?? null;
      pic = files[0] ? volOf(card).data(files[0]) : null;
    } catch (e) { bad.push(`${tag}: the first session: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
    if (!pic) return null;
    // 2. the host: the picture under number 0005 (its name's last four digits before the extension), the old name
    // deleted
    const m = /^(.*)(\d{4})(\.[^.]+)$/.exec(picName), putName = m ? `${m[1]}0005${m[3]}` : null;
    ok(m && m[2] === '0001', `${tag}: the picture's DCF name: ${picName}`);
    const w = openCardFs(cardDevice(card));
    w.put(`${DIR}/${putName}`, pic);
    w.rm(`${DIR}/${picName}`);
    const v1 = volOf(card);
    ok(v1.check().length === 0 && pictures(card).map((e) => e.name).join() === putName && same(v1.data(v1.find(`${DIR}/${putName}`)), pic), `${tag}: the writer's card reads back consistent (${v1.type}): ${v1.check()}`);
    const kept = cardImage(card);
    // 3. a file of the host's own put by the session hook at the player's first open (withCardFiles, as bin/play.mjs
    // --card-put) in a directory the writer makes; the firmware mounts the card: no format, the next DCF number after
    // the writer's, its own count. The session closes having written nothing itself, and the host saves the card with
    // the file (the writer marked it dirty); after the player's power cycle (the hook does not put again) S2's next
    // picture
    let saved = null, put = null;
    pl = player(withCardFiles({ open: () => card, save: (c) => { saved = cardImage(c); } }, [{ path: 'MISC/HOST.BIN', bytes: host }], { results: (r) => { put = r; } }));
    try {
      pl.open_session();
      ok(put?.[0]?.made?.[0] === 'MISC', `${tag}: the hook put the host's file before the mount: ${JSON.stringify(put)}`);
      const st = pl.session.steps.find((x) => x.storage)?.storage;
      ok(st && st.mounted && !st.formatted, `${tag}: the firmware mounts the writer's card without a format: ${JSON.stringify(st && { mounted: st.mounted, formatted: st.formatted })}`);
      ok(st?.dcf?.folder === 100 && st.dcf.file === 6, `${tag}: the firmware's DCF numbering mount takes the number after the writer's 0005: next ${JSON.stringify(st?.dcf)}`);
      const n = imageCount(pl.session.lab);
      ok(n === 1, `${tag}: the firmware's own image count finds the writer's picture: ${n}`);
      pl.close_session();
      const sv = saved && cardFromImage(saved), sf = sv && volOf(sv).find('MISC/HOST.BIN');
      ok(sf && same(volOf(sv).data(sf), host), `${tag}: the host saved the card at the close with the hook's file on it`);
      pl.open_session();
      for (const inp of SHOT) pl.run_input(inp);
      const img = pl.session.camapp.images[0];
      ok(img?.file?.number === 6 && imageCount(pl.session.lab) === 2, `${tag}: S2's picture takes number 6 and the count is 2: ${JSON.stringify(img?.file && { path: img.file.path, number: img.file.number })}`);
    } catch (e) { bad.push(`${tag}: the session on the writer's card: ${e.message.slice(0, 400)}`); }
    try { pl.close_session(); } catch { /* closed */ }
    const v2 = volOf(card), after = pictures(card).map((e) => e.name);
    ok(after.length === 2 && after.includes(putName) && same(v2.data(v2.find(`${DIR}/${putName}`)), pic) && same(v2.data(v2.find('MISC/HOST.BIN')), host) && v2.check().length === 0,
      `${tag}: after the firmware's S2 the writer's files are intact and the volume consistent: ${after}; ${v2.check()}`);
    notes.push(`${MODEL} ${tag}: ${v2.type}, the pictures ${after.join(', ')}`);
    return { kept, putName, pic };
  };
  round(64);
  const r8 = round(8);
  if (!r8) return { checks, bad, notes };
  const { kept, putName, pic } = r8;
  let pl;
  // 4. negative control: the writer's card with the put-back picture's clusters left free in the FAT, in both copies,
  // and FSInfo's count and hint as if they were never taken (a writer that did not mark them): the reader reports it
  const bad4 = cardFromImage(kept), bv = volOf(bad4), pe = bv.find(`${DIR}/${putName}`), chain = bv.chain(pe.cluster);
  ok(bv.type === 'FAT32', `the default card's volume is FAT32: ${bv.type}`);
  for (let k = 0; k < bv.nfats; k++) for (const c of chain) {
    const off = c * 4, lba = bv.start + bv.reserved + k * bv.fatSize + Math.floor(off / SECTOR), s = bad4.read(lba, 1);
    s.fill(0, off % SECTOR, off % SECTOR + 4); bad4.data.set(lba, s);
  }
  const fi = bad4.read(bv.start + bv.fsinfo, 1), dv = new DataView(fi.buffer);
  dv.setUint32(488, dv.getUint32(488, true) + chain.length, true); dv.setUint32(492, chain[0], true);
  bad4.data.set(bv.start + bv.fsinfo, fi);
  const p4 = volOf(bad4).check();
  ok(p4.length > 0, `negative control: the picture's clusters left free are reported by the reader: ${p4.slice(0, 2).join('; ')}`);
  // and the firmware does not take it as the good card: its S2 there stops the session (X on E143: REC_FILE's reply
  // status 0xa0c, which S-RECREQ refuses; what the status means is not read) or writes over the picture, so the good
  // card's intact files above are the firmware's use of the writer's FAT, not an allocator that ignores it
  let stopped = null;
  pl = player(bad4);
  try {
    pl.open_session();
    for (const inp of SHOT) pl.run_input(inp);
  } catch (e) { stopped = e.message; }
  try { pl.close_session(); } catch { /* closed */ }
  const v5 = volOf(bad4), e5 = v5.find(`${DIR}/${putName}`), first = e5 ? bad4.read(v5.sectorOf(e5.cluster), v5.spc) : null;
  const overwritten = !first || !same(first, pic.subarray(0, first.length));
  ok(stopped !== null || overwritten, `negative control: the firmware's S2 on that card stops or writes over the picture: ${stopped ? `stopped (${stopped.slice(0, 160)})` : overwritten ? 'overwritten' : 'neither'}`);
  notes.push(`${MODEL}: the negative control's S2: ${stopped ? `stopped: ${stopped.slice(0, 200)}` : overwritten ? 'the picture written over' : 'neither'}`);
  // 5. bin/card.mjs new: a blank card the model's firmware formats in a headless session, saved, its volume FAT32
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-emu-cardfs-'));
  try {
    const file = path.join(tmp, 'new.omsd'), r = cardTool('new', file, '--model', MODEL);
    const made = r.status === 0 ? cardFromImage(new Uint8Array(fs.readFileSync(file))) : null, mv = made && volOf(made);
    ok(r.status === 0 && text(r).startsWith(`${file}: ${MODEL}'s firmware formatted a 8 GiB SDHC card, FAT32 `) && mv?.type === 'FAT32' && mv.check().length === 0 && mv.list().length === 0,
      `card.mjs new: exit ${r.status}, ${text(r).trim().slice(0, 300)}`);
    // 6. bin/play.mjs --card-put on that card (OM_EMU_CARD): the line, the file in the Card panel's listing while the
    // session runs, and on the card the session saved; refused before the server starts without OM_EMU_CARD, on a
    // blank card, and a malformed item as a usage error
    const local = path.join(tmp, 'looks.bin'), blank = path.join(tmp, 'blank.omsd'), PLAY = new URL('../bin/play.mjs', import.meta.url).pathname;
    fs.writeFileSync(local, host.subarray(0, 1632)); fs.writeFileSync(blank, cardImage(new SdCard()));
    const play = (args, env = {}) => spawnSync(process.execPath, [PLAY, '--no-browser', '--nvram', 'off', '--out', path.join(tmp, 'refused'), ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, OM_EMU_CARD: '', ...env } });
    const item = `OM3MOD/LOOKS.BIN=${local}`, noCard = play(['--card-put', item]), onBlank = play(['--card-put', item], { OM_EMU_CARD: blank }), malformed = play(['--card-put', 'OM3MOD/LOOKS.BIN'], { OM_EMU_CARD: file });
    ok(noCard.status === 1 && /^play\.mjs: --card-put needs the card kept in a file, OM_EMU_CARD=FILE/.test(noCard.stderr) && onBlank.status === 1 && /--card-put refused: .*the card is blank/.test(onBlank.stderr)
      && malformed.status === 2 && /--card-put OM3MOD\/LOOKS\.BIN: DOS\/PATH=LOCAL/.test(malformed.stderr) && !/play: http/.test(noCard.stdout + onBlank.stdout + malformed.stdout),
      `play.mjs --card-put refusals: ${noCard.status} ${onBlank.status} ${malformed.status}: ${[noCard, onBlank, malformed].map((x) => x.stderr.trim().split('\n')[0]).join(' | ')}`);
    if (r.status === 0) {
      const { startPlay } = await import('./test_host.mjs');
      const pl = await startPlay('cardfs', ['--idle', 'off', '--card-put', item], { env: { ...process.env, OM_EMU_CARD: file } });
      try {
        ok(pl.lines.includes(`play: --card-put: OM3MOD/LOOKS.BIN (1632 bytes) onto ${file} before the first session`), `play's --card-put line: ${pl.lines.join(' | ')}`);
        await pl.waitPhase((x) => x.phase === 'running' && x.gui_name, 120);
        const listing = await pl.json('GET', '/api/card');
        ok(listing.slot?.mounted && listing.files?.some((x) => x.path === 'OM3MOD/LOOKS.BIN' && x.size === 1632), `GET /api/card lists the put file on the mounted card: ${JSON.stringify(listing.files)}`);
      } finally {
        const rc = await pl.close();
        ok(rc === 0, `play exit ${rc}: ${pl.errs.join('').slice(-400)}`);
      }
      const kept = cardFromImage(new Uint8Array(fs.readFileSync(file))), kv = volOf(kept), ke = kv.find('OM3MOD/LOOKS.BIN');
      ok(ke && same(kv.data(ke), host.subarray(0, 1632)) && kv.check().length === 0, 'the card the session saved holds the put file');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { checks, bad, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = cardfsUnits(), c = cardCliTests();
  console.log(`card writer units: ${u.checks - u.bad.length}/${u.checks}; bin/card.mjs ${c.checks - c.bad.length}/${c.checks}`);
  [...u.bad, ...c.bad].forEach((x) => console.log('  ', x));
  let n = u.bad.length + c.bad.length;
  if (process.argv.includes('--session')) {
    const r = await cardfsSession();
    console.log(`card writer in play: ${r.checks - r.bad.length}/${r.checks}`);
    r.notes.forEach((x) => console.log('   note:', x));
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
