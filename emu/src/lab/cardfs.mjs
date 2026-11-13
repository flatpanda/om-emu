// Files put on and taken off a card's volume by the host, between sessions or before one starts (bin/card.mjs, a
// session's start: withCardFiles): make a directory, write or replace a file, delete a file, on the FAT32 volume the
// firmware gives an SDHC card and the exFAT volume it gives an SDXC card (test/test_storage.mjs storageSdxc). Written
// from Microsoft's FAT specification (FAT: General Overview of On-Disk Format, version 1.03) and exFAT specification
// (2019, file system revision 1.00), not from the firmware's code: the volume is the firmware's, made by its own format
// (bin/card.mjs new), and this module only adds to it, as a card reader on a computer would. It shares no code with
// the independent readers (refs/fat.mjs, refs/exfat.mjs), which check what it writes (test/test_cardfs.mjs), and the
// firmware mounts the result. Pure JS (a card's sector store, src/lab/sdcard.mjs; no node: imports).
//
// Nothing here stands in for the camera: the files are written while the card is out of the firmware's hands, as a
// computer's card reader would write them. What it writes (the host's own choice where the specifications leave one):
//   names     FAT32: 8.3 short names only (A-Z, 0-9 and ! # $ % & ' ( ) - @ ^ _ ` { } ~; compared without the case of
//             a-z and stored upper-case, no long-name entries); another name is refused, not shortened or folded
//             (shortName). exFAT: any name of 1 to 255 characters but the specification's forbidden ones, compared
//             up-cased by the volume's own table
//   stamp     every entry this writes, created or replaced, is dated FIXED_STAMP (1980-01-01 00:00:00, the FAT epoch:
//             not a time anything happened) unless the caller gives one (fatStamp); FAT32's create, write and access
//             dates, exFAT's create, modify and access timestamps, the UTC offsets left invalid (0)
//   clusters  FAT32: the first free clusters from FSInfo's next-free hint (cluster 2 when it has none), the FAT's
//             copies kept the same (unless the BPB's flags turn mirroring off: then only the active one), FSInfo's
//             free count less the clusters taken and more those given back (left alone when it says unknown) and its
//             hint the cluster after the last one taken, as the firmware leaves it after a picture (X, 2026-11-13: a
//             card E147's firmware formatted and wrote one picture to, the picture at clusters 5 and 6, next-free 7;
//             test/test_cardfs.mjs has the firmware allocate after the writer). exFAT: the first free
//             clusters by the allocation bitmap, always chained in the FAT (NoFatChain clear, which every reader must
//             take); PercentInUse is left as it is (the firmware writes 0xff, not available: X, E143's 64 GiB format)
//   dirs      FAT32: a new directory's cluster zeroed with its '.' and '..' entries ('..' 0 in the root); an entry
//             goes in the directory's first free slot, the directory grows by a zeroed cluster when it has none.
//             exFAT: a directory's entry set in the first run of free entries long enough, the directory grown by a
//             zeroed cluster (its stream extension's lengths and set checksum updated; a contiguous one is chained
//             first); a replaced file's set is written anew
// Each operation is all or nothing: the sectors it changes are kept here and written to the card only when it ends
// without an error (a full card, a name refused, a broken chain); each reads the card afresh.
export class CardFsError extends Error {}

export const SECTOR = 512;
// The FAT epoch, 1980-01-01 00:00:00: FAT's date (year - 1980 << 9 | month << 5 | day) and time (hour << 11 |
// minute << 5 | second / 2)
export const FIXED_STAMP = Object.freeze({ date: 0x0021, time: 0 });
// a stamp from a Date's local time, or from [year, month, day, hour, minute, second]
export function fatStamp(when) {
  const [y, mo, d, h, mi, s] = when instanceof Date
    ? [when.getFullYear(), when.getMonth() + 1, when.getDate(), when.getHours(), when.getMinutes(), when.getSeconds()] : when;
  if (!(y >= 1980 && y <= 2107) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31) || !(h >= 0 && h < 24) || !(mi >= 0 && mi < 60) || !(s >= 0 && s < 60)) {
    throw new CardFsError(`fatStamp: ${JSON.stringify(when)} is not a time FAT can date (1980 to 2107)`);
  }
  return { date: (y - 1980) << 9 | mo << 5 | d, time: h << 11 | mi << 5 | s >> 1 };
}

// No constant here is written in eight hex digits: bin/port.mjs takes every such literal under src/ for an E143
// address to port
const U32_MAX = 2 ** 32 - 1;
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const put16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >> 8 & 255; };
const put32 = (b, o, v) => { for (let i = 0; i < 4; i++) b[o + i] = (v >>> (8 * i)) & 255; };
const put64 = (b, o, v) => { put32(b, o, v % 0x100000000); put32(b, o + 4, Math.floor(v / 0x100000000)); };
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

// A card's sector store as the writer's device (src/lab/sdcard.mjs SdCard: its read, and its sparse map written
// directly, as a card reader on a computer would: the card's command counters are the SD bus's and stay as they were;
// its dirty flag is set, so the session that closes with the card saves it with the files, src/lab/storage.mjs)
export function cardDevice(card) {
  return {
    read: (lba, n) => card.read(lba, n),
    write(lba, bytes) {
      card.dirty = true;
      for (let i = 0; i * SECTOR < bytes.length; i++) {
        const s = bytes.slice(i * SECTOR, (i + 1) * SECTOR);
        if (lba + i >= card.sectors) throw new CardFsError(`sector ${lba + i} is past the card's ${card.sectors}`);
        if (s.every((v) => v === 0)) card.data.delete(lba + i); else card.data.set(lba + i, s);
      }
    },
  };
}

// The sectors an operation reads and changes, written to the device at the end (flush) or dropped (an error)
class Sectors {
  constructor(dev) { this.dev = dev; this.cache = new Map(); this.dirty = new Set(); }
  get(lba) {
    let s = this.cache.get(lba);
    if (!s) { s = this.dev.read(lba, 1).slice(); this.cache.set(lba, s); }
    return s;
  }
  changed(lba) { this.dirty.add(lba); }
  set(lba, bytes) { this.cache.set(lba, bytes); this.dirty.add(lba); }
  flush() {
    for (const lba of [...this.dirty].sort((a, b) => a - b)) this.dev.write(lba, this.cache.get(lba));
    this.dirty.clear();
  }
  drop() { this.cache.clear(); this.dirty.clear(); }
}

// A path's parts ('OM3MOD/LOOKS.BIN', '/' or '\' between them, a leading one ignored)
function partsOf(path) {
  const parts = String(path).split(/[/\\]+/).filter(Boolean);
  if (!parts.length) throw new CardFsError(`'${path}': no file or directory name`);
  for (const p of parts) if (p === '.' || p === '..') throw new CardFsError(`'${path}': '.' and '..' are not taken in a path here`);
  return parts;
}

// The volume on a card (or any device of 512-byte sectors): the MBR's first partition, or sector 0 when that is the
// boot sector; a FatWriter (FAT32) or an ExfatWriter. A blank card (no MBR, no boot sector) is refused: its format must
// be the firmware's (bin/card.mjs new)
export function openCardFs(dev) {
  const s0 = dev.read(0, 1);
  if (s0.every((v) => v === 0)) throw new CardFsError('the card is blank (no partition table, no file system): the firmware formats a card, make one with node emu/bin/card.mjs new');
  let start = 0;
  if (ascii(s0, 3, 8) !== 'EXFAT   ' && s0[510] === 0x55 && s0[511] === 0xaa && s0[446 + 4] !== 0 && u16(s0, 11) !== SECTOR) start = u32(s0, 446 + 8);
  const b = start ? dev.read(start, 1) : s0;
  if (ascii(b, 3, 8) === 'EXFAT   ') return new ExfatWriter(dev, start, b);
  if (b[510] !== 0x55 || b[511] !== 0xaa) throw new CardFsError(`sector ${start} holds no boot sector (no 0x55aa): not a volume written here`);
  return new FatWriter(dev, start, b);
}

// The operations both writers share; each returns what it did, for a tool's line ({op, path, made: the directories
// it made, ...})
class Writer {
  // an operation in a transaction: its changes written at the end, dropped on an error
  _do(fn) {
    try { const r = fn(); this.sec.flush(); return r; } finally { this.sec.drop(); }
  }
  mkdir(path, { stamp = FIXED_STAMP } = {}) {
    return this._do(() => { const made = []; this._dir(partsOf(path), stamp, made); return { op: 'mkdir', path, made }; });
  }
  put(path, bytes, { stamp = FIXED_STAMP } = {}) {
    return this._do(() => {
      const parts = partsOf(path), made = [], dir = this._dir(parts.slice(0, -1), stamp, made);
      return { op: 'put', path, made, ...this._put(dir, parts.at(-1), bytes, stamp) };
    });
  }
  rm(path) {
    return this._do(() => {
      const parts = partsOf(path), dir = this._dir(parts.slice(0, -1), null, null);
      return { op: 'rm', path, ...this._rm(dir, parts.at(-1)) };
    });
  }
  // the directory at parts, made where missing when made is an array (it gets each new directory's path)
  _dir(parts, stamp, made) {
    let dir = this._root();
    parts.forEach((name, i) => {
      const e = this._find(dir, name);
      if (e && !e.dir) throw new CardFsError(`${parts.slice(0, i + 1).join('/')} is a file, not a directory`);
      if (e) { dir = this._open(e); return; }
      if (!made) throw new CardFsError(`${parts.slice(0, i + 1).join('/')}: no such directory`);
      dir = this._mkdir(dir, name, stamp);
      made.push(parts.slice(0, i + 1).join('/'));
    });
    return dir;
  }
}

// ---- FAT32
const FAT_EOC = 0xfffffff, FAT_EOC_MIN = 0xffffff8, ATTR_DIR = 0x10, ATTR_ARCHIVE = 0x20, ATTR_LFN = 0x0f, ATTR_LABEL = 0x08;
const SHORT_CHARS = /^[A-Z0-9!#$%&'()\-@^_`{}~]+$/;
// an 8.3 name as its 11 bytes' text ('LOOKS   BIN'), or a refusal. The characters are checked before the case is
// folded, and only a-z are folded: Unicode's upper-casing would turn some other names into 8.3 ones ('straße.txt'
// into STRASSE.TXT, the ligature U+FB01 into FI), a name shortened under another spelling, which this writer refuses
export function shortName(name) {
  const up = /[^\x21-\x7e]/.test(name) ? '' : name.replace(/[a-z]/g, (c) => c.toUpperCase()), dot = up.lastIndexOf('.');
  const base = dot < 0 ? up : up.slice(0, dot), ext = dot < 0 ? '' : up.slice(dot + 1);
  if (!base.length || base.length > 8 || ext.length > 3 || (dot >= 0 && !ext.length) || !SHORT_CHARS.test(base) || (ext && !SHORT_CHARS.test(ext))) {
    throw new CardFsError(`'${name}' is not an 8.3 name (1-8 characters, a dot and 0-3 more, of A-Z 0-9 and ! # $ % & ' ( ) - @ ^ _ \` { } ~): this writer makes no long names on FAT32`);
  }
  return base.padEnd(8) + ext.padEnd(3);
}

export class FatWriter extends Writer {
  constructor(dev, start, b) {
    super();
    this.dev = dev; this.start = start; this.sec = new Sectors(dev);
    if (u16(b, 11) !== SECTOR) throw new CardFsError(`FAT: ${u16(b, 11)} bytes per sector, only 512 written here`);
    this.spc = b[13]; this.reserved = u16(b, 14); this.nfats = b[16];
    const rootEntries = u16(b, 17), total = u16(b, 19) || u32(b, 32), fat16 = u16(b, 22);
    this.fatSize = fat16 || u32(b, 36);
    if (!this.spc || this.spc & (this.spc - 1) || !this.nfats || !this.fatSize) throw new CardFsError(`FAT: a BPB with ${this.spc} sectors a cluster, ${this.nfats} FATs of ${this.fatSize} sectors`);
    this.firstData = this.reserved + this.nfats * this.fatSize + Math.ceil(rootEntries * 32 / SECTOR);
    this.clusters = Math.floor((total - this.firstData) / this.spc);
    if (this.clusters < 65525 || rootEntries || fat16) throw new CardFsError(`FAT: ${this.clusters} clusters, a FAT12 or FAT16 volume (the firmware formats an SDHC card FAT32): not written here`);
    if (this.fatSize * SECTOR < 4 * (this.clusters + 2)) throw new CardFsError(`FAT: a FAT of ${this.fatSize} sectors for ${this.clusters} clusters`);
    const flags = u16(b, 40);
    this.fats = flags & 0x80 ? [flags & 0xf] : Array.from({ length: this.nfats }, (_, i) => i);
    this.rootCluster = u32(b, 44); this.fsinfo = u16(b, 48);
    this.type = 'FAT32';
    this.per = this.spc * SECTOR;
  }
  sectorOf(c) { return this.start + this.firstData + (c - 2) * this.spc; }
  _fatAt(c, k = this.fats[0]) { const off = c * 4; return [this.start + this.reserved + k * this.fatSize + Math.floor(off / SECTOR), off % SECTOR]; }
  next(c) { const [lba, o] = this._fatAt(c); return u32(this.sec.get(lba), o) & FAT_EOC; }
  setNext(c, v) {
    for (const k of this.fats) {
      const [lba, o] = this._fatAt(c, k), s = this.sec.get(lba);
      put32(s, o, ((u32(s, o) & ~FAT_EOC) | v) >>> 0);       // the entry's top four bits kept
      this.sec.changed(lba);
    }
  }
  chain(c) {
    const out = [], first = c;
    while (c < FAT_EOC_MIN) {
      if (c < 2 || c > this.clusters + 1) throw new CardFsError(`FAT: the chain from cluster ${first} reaches ${c}, outside 2..${this.clusters + 1}`);
      if (out.length > this.clusters) throw new CardFsError(`FAT: the chain from cluster ${first} loops`);
      out.push(c);
      c = this.next(c);
    }
    return out;
  }
  _info() {
    if (!this.fsinfo || this.fsinfo === 0xffff) return null;
    const lba = this.start + this.fsinfo, s = this.sec.get(lba);
    return ascii(s, 0, 4) === 'RRaA' && ascii(s, 484, 4) === 'rrAa' ? { lba, s } : null;
  }
  // n free clusters chained (their FAT entries ending in the end-of-chain mark), after `after` when given; FSInfo kept
  _alloc(n, after = null) {
    if (!n) return [];
    const info = this._info(), hint = info ? u32(info.s, 492) : U32_MAX, out = [];
    const from = hint >= 2 && hint <= this.clusters + 1 ? hint : 2;
    for (let k = 0; k < this.clusters && out.length < n; k++) {
      const c = 2 + (from - 2 + k) % this.clusters;
      if (this.next(c) === 0) out.push(c);
    }
    if (out.length < n) throw new CardFsError(`the card is full: ${n} clusters of ${this.per} bytes needed, ${out.length} free`);
    out.forEach((c, i) => this.setNext(c, i + 1 < n ? out[i + 1] : FAT_EOC));
    if (after !== null) this.setNext(after, out[0]);
    if (info) {
      const free = u32(info.s, 488);
      if (free !== U32_MAX) put32(info.s, 488, free >= n ? free - n : U32_MAX);    // a count below n was wrong: unknown
      put32(info.s, 492, out.at(-1) + 1 > this.clusters + 1 ? 2 : out.at(-1) + 1);
      this.sec.changed(info.lba);
    }
    return out;
  }
  _free(clusters) {
    for (const c of clusters) this.setNext(c, 0);
    const info = this._info();
    if (info && clusters.length) {
      const free = u32(info.s, 488);
      if (free !== U32_MAX) { put32(info.s, 488, free + clusters.length); this.sec.changed(info.lba); }
    }
  }
  // bytes into clusters, the last padded with zeros
  _write(clusters, bytes) {
    clusters.forEach((c, i) => {
      for (let k = 0; k < this.spc; k++) {
        const s = new Uint8Array(SECTOR), o = i * this.per + k * SECTOR;
        if (o < bytes.length) s.set(bytes.subarray(o, Math.min(o + SECTOR, bytes.length)));
        this.sec.set(this.sectorOf(c) + k, s);
      }
    });
  }
  _root() { return { cluster: this.rootCluster }; }
  _open(e) { return { cluster: e.cluster }; }
  // a directory's 32-byte slots: [lba, offset] of slot i, and their count
  _slots(dir) {
    const clusters = this.chain(dir.cluster), per = this.per / 32;
    return { clusters, count: clusters.length * per, at: (i) => [this.sectorOf(clusters[Math.floor(i / per)]) + Math.floor((i % per) * 32 / SECTOR), (i * 32) % SECTOR] };
  }
  // the short entry named name11 in a directory: {i, slots, cluster, size, dir}, or null
  _find(dir, name) {
    const name11 = shortName(name), sl = this._slots(dir);
    for (let i = 0; i < sl.count; i++) {
      const [lba, o] = sl.at(i), s = this.sec.get(lba), first = s[o], attr = s[o + 11];
      if (first === 0) break;
      if (first === 0xe5 || attr === ATTR_LFN || attr & ATTR_LABEL) continue;
      if (ascii(s, o, 11) === name11) return { i, slots: sl, cluster: (u16(s, o + 20) << 16 | u16(s, o + 26)) >>> 0, size: u32(s, o + 28), dir: (attr & ATTR_DIR) !== 0 };
    }
    return null;
  }
  // a free slot (first byte 0 or 0xe5), the directory grown by a zeroed cluster when it has none
  _slot(dir) {
    let sl = this._slots(dir);
    for (let i = 0; i < sl.count; i++) {
      const [lba, o] = sl.at(i), b = this.sec.get(lba)[o];
      if (b === 0 || b === 0xe5) return sl.at(i);
    }
    const [c] = this._alloc(1, sl.clusters.at(-1));
    this._write([c], new Uint8Array(0));
    sl = this._slots(dir);
    return sl.at(sl.count - this.per / 32);
  }
  _entry([lba, o], name11, attr, cluster, size, stamp) {
    const s = this.sec.get(lba), e = new Uint8Array(32);
    for (let i = 0; i < 11; i++) e[i] = name11.charCodeAt(i);
    e[11] = attr;
    put16(e, 14, stamp.time); put16(e, 16, stamp.date); put16(e, 18, stamp.date);
    put16(e, 20, cluster >>> 16); put16(e, 22, stamp.time); put16(e, 24, stamp.date); put16(e, 26, cluster & 0xffff); put32(e, 28, size);
    s.set(e, o);
    this.sec.changed(lba);
  }
  _mkdir(parent, name, stamp) {
    const name11 = shortName(name), at = this._slot(parent), [c] = this._alloc(1);
    this._write([c], new Uint8Array(0));
    const up = parent.cluster === this.rootCluster ? 0 : parent.cluster;
    this._entry([this.sectorOf(c), 0], '.'.padEnd(11), ATTR_DIR, c, 0, stamp);
    this._entry([this.sectorOf(c), 32], '..'.padEnd(11), ATTR_DIR, up, 0, stamp);
    this._entry(at, name11, ATTR_DIR, c, 0, stamp);
    return { cluster: c };
  }
  _put(dir, name, bytes, stamp) {
    const name11 = shortName(name), old = this._find(dir, name);
    if (old?.dir) throw new CardFsError(`${name} is a directory`);
    if (old) this._free(old.cluster ? this.chain(old.cluster) : []);
    const clusters = this._alloc(Math.ceil(bytes.length / this.per));
    this._write(clusters, bytes);
    const at = old ? old.slots.at(old.i) : this._slot(dir);
    let attr = ATTR_ARCHIVE;
    if (old) { const [lba, o] = at; attr = this.sec.get(lba)[o + 11] | ATTR_ARCHIVE; }
    this._entry(at, name11, attr, clusters[0] ?? 0, bytes.length, stamp);
    return { replaced: !!old, size: bytes.length, clusters: clusters.length, first: clusters[0] ?? 0 };
  }
  // the short entry and the long-name entries just before it marked deleted, its clusters given back
  _rm(dir, name) {
    const e = this._find(dir, name);
    if (!e) throw new CardFsError(`${name}: no such file`);
    if (e.dir) throw new CardFsError(`${name} is a directory (only files are deleted here)`);
    const mark = (i) => { const [lba, o] = e.slots.at(i), s = this.sec.get(lba); s[o] = 0xe5; this.sec.changed(lba); };
    mark(e.i);
    for (let i = e.i - 1; i >= 0; i--) {
      const [lba, o] = e.slots.at(i), s = this.sec.get(lba);
      if (s[o + 11] !== ATTR_LFN || s[o] === 0xe5) break;
      mark(i);
    }
    const clusters = e.cluster ? this.chain(e.cluster) : [];
    this._free(clusters);
    return { size: e.size, clusters: clusters.length };
  }
}

// ---- exFAT
const EX_EOC = U32_MAX, BITMAP = 0x81, UPCASE = 0x82, FILE = 0x85, STREAM = 0xc0, NAME = 0xc1, IN_USE = 0x80;
const ALLOC_POSSIBLE = 1, NO_FAT_CHAIN = 2;
const FORBIDDEN = /[\u0000-\u001f"*/:<>?\\|]/;
const rotate16 = (c, v) => ((c & 1 ? 0x8000 : 0) + (c >>> 1) + v) & 0xffff;
const rotate32 = (c, v) => ((c & 1 ? 2 ** 31 : 0) + (c >>> 1) + v) >>> 0;

export class ExfatWriter extends Writer {
  constructor(dev, start, b) {
    super();
    this.dev = dev; this.start = start; this.sec = new Sectors(dev);
    if (b[108] !== 9) throw new CardFsError(`exFAT: 2^${b[108]} bytes per sector, only 512 written here`);
    if (u16(b, 104) >> 8 !== 1) throw new CardFsError(`exFAT: file system revision ${b[105]}.${b[104]}, only 1.x written here`);
    this.fatOffset = u32(b, 80); this.fatLength = u32(b, 84); this.heapOffset = u32(b, 88);
    this.clusters = u32(b, 92); this.rootCluster = u32(b, 96); this.spc = 1 << b[109]; this.nfats = b[110];
    this.activeFat = this.nfats === 2 ? u16(b, 106) & 1 : 0;
    if (u16(b, 106) & 2) throw new CardFsError('exFAT: the volume is marked dirty (VolumeDirty): not written here');
    if (this.fatLength * SECTOR < 4 * (this.clusters + 2)) throw new CardFsError(`exFAT: a FAT of ${this.fatLength} sectors for ${this.clusters} clusters`);
    this.per = this.spc * SECTOR;
    this.type = 'exFAT';
    this._tables();
  }
  // the root's allocation bitmap (the active FAT's) and up-case table, read again after a dropped operation
  _tables() {
    this.bitmap = null; let up = null;
    for (const set of this._sets(this._root())) {
      const e = set.bytes;
      if (e[0] === BITMAP && (e[1] & 1) === this.activeFat) this.bitmap = { clusters: this.chain(u32(e, 20)), size: u64(e, 24) };
      if (e[0] === UPCASE) up = { cluster: u32(e, 20), size: u64(e, 24), checksum: u32(e, 4) };
    }
    if (!this.bitmap || !up) throw new CardFsError(`exFAT: no ${this.bitmap ? 'up-case table' : 'allocation bitmap'} in the root directory`);
    if (this.bitmap.size * 8 < this.clusters) throw new CardFsError(`exFAT: a bitmap of ${this.bitmap.size} bytes for ${this.clusters} clusters`);
    const table = this._read(this.chain(up.cluster), up.size);
    let sum = 0;
    for (const v of table) sum = rotate32(sum, v);
    if (sum !== up.checksum) throw new CardFsError(`exFAT: the up-case table's checksum 0x${sum.toString(16)}, its entry's 0x${up.checksum.toString(16)}`);
    // the table: a u16 per code point from 0; 0xffff n: the next n code points map to themselves
    const map = [];
    for (let k = 0; k + 1 < table.length; k += 2) {
      const v = u16(table, k);
      if (v === 0xffff && k + 3 < table.length) { const n = u16(table, k + 2); for (let j = 0; j < n; j++) map.push(map.length); k += 2; } else map.push(v);
    }
    this.upcase = map;
  }
  up(name) { let s = ''; for (let i = 0; i < name.length; i++) { const c = name.charCodeAt(i); s += String.fromCharCode(c < this.upcase.length ? this.upcase[c] : c); } return s; }
  sectorOf(c) { return this.start + this.heapOffset + (c - 2) * this.spc; }
  _fatAt(c) { const off = c * 4; return [this.start + this.fatOffset + this.activeFat * this.fatLength + Math.floor(off / SECTOR), off % SECTOR]; }
  next(c) { const [lba, o] = this._fatAt(c); return u32(this.sec.get(lba), o); }
  setNext(c, v) { const [lba, o] = this._fatAt(c), s = this.sec.get(lba); put32(s, o, v); this.sec.changed(lba); }
  chain(c) {
    const out = [], first = c;
    if (c === 0) return out;
    while (c !== EX_EOC) {
      if (c < 2 || c > this.clusters + 1) throw new CardFsError(`exFAT: the chain from cluster ${first} reaches 0x${c.toString(16)}, outside 2..${this.clusters + 1}`);
      if (out.length >= this.clusters) throw new CardFsError(`exFAT: the chain from cluster ${first} loops`);
      out.push(c);
      c = this.next(c);
    }
    return out;
  }
  _read(clusters, size) {
    const out = new Uint8Array(size);
    for (let i = 0; i * SECTOR < size; i++) {
      const s = this.sec.get(this.sectorOf(clusters[Math.floor(i / this.spc)]) + i % this.spc);
      out.set(s.subarray(0, Math.min(SECTOR, size - i * SECTOR)), i * SECTOR);
    }
    return out;
  }
  _bit(c) {
    const i = c - 2, byte = i >> 3, lba = this.sectorOf(this.bitmap.clusters[Math.floor(byte / this.per)]) + Math.floor((byte % this.per) / SECTOR);
    return [lba, byte % SECTOR, 1 << (i & 7)];
  }
  allocated(c) { const [lba, o, m] = this._bit(c); return (this.sec.get(lba)[o] & m) !== 0; }
  _mark(c, on) { const [lba, o, m] = this._bit(c), s = this.sec.get(lba); s[o] = on ? s[o] | m : s[o] & ~m; this.sec.changed(lba); }
  // n free clusters by the bitmap, marked and chained in the FAT (after `after`'s chain when given)
  _alloc(n, after = null) {
    const out = [];
    for (let c = 2; c < this.clusters + 2 && out.length < n; c++) if (!this.allocated(c)) out.push(c);
    if (out.length < n) throw new CardFsError(`the card is full: ${n} clusters of ${this.per} bytes needed, ${out.length} free`);
    out.forEach((c, i) => { this._mark(c, true); this.setNext(c, i + 1 < n ? out[i + 1] : EX_EOC); });
    if (after !== null && n) this.setNext(after, out[0]);
    return out;
  }
  // clusters given back: their bits cleared, their FAT entries too when they were chained
  _free(clusters, chained) {
    for (const c of clusters) { this._mark(c, false); if (chained) this.setNext(c, 0); }
  }
  _write(clusters, bytes) {
    clusters.forEach((c, i) => {
      for (let k = 0; k < this.spc; k++) {
        const s = new Uint8Array(SECTOR), o = i * this.per + k * SECTOR;
        if (o < bytes.length) s.set(bytes.subarray(o, Math.min(o + SECTOR, bytes.length)));
        this.sec.set(this.sectorOf(c) + k, s);
      }
    });
  }
  // a directory: its clusters, whether they are contiguous (NoFatChain), and where its own set is (null: the root)
  _root() { return { clusters: this.chain(this.rootCluster), contiguous: false, set: null }; }
  _open(e) {
    const n = Math.ceil(e.size / this.per);
    const clusters = e.contiguous ? Array.from({ length: n }, (_, i) => e.cluster + i) : this.chain(e.cluster).slice(0, n);
    if (clusters.length < n || clusters.some((c) => c < 2 || c > this.clusters + 1)) throw new CardFsError(`exFAT: ${e.name}'s clusters do not hold its ${e.size} bytes`);
    return { clusters, contiguous: e.contiguous, set: e.set };
  }
  _at(dir, i) { const per = this.per / 32; return [this.sectorOf(dir.clusters[Math.floor(i / per)]) + Math.floor((i % per) * 32 / SECTOR), (i * 32) % SECTOR]; }
  _entryBytes(dir, i) { const [lba, o] = this._at(dir, i); return this.sec.get(lba).subarray(o, o + 32); }
  // a directory's entry sets in use: {i, n (entries), bytes (a copy)}; the end at a type 0
  _sets(dir) {
    const out = [], count = dir.clusters.length * this.per / 32;
    for (let i = 0; i < count;) {
      const t = this._entryBytes(dir, i)[0];
      if (t === 0) break;
      if (!(t & IN_USE)) { i++; continue; }
      const n = 1 + (t === FILE || (t & 0x20) ? this._entryBytes(dir, i)[1] : 0);
      if (i + n > count) throw new CardFsError(`exFAT: an entry set at ${i} runs past its directory`);
      const bytes = new Uint8Array(32 * n);
      for (let k = 0; k < n; k++) bytes.set(this._entryBytes(dir, i + k), 32 * k);
      out.push({ i, n, bytes });
      i += n;
    }
    return out;
  }
  // the file or directory named name: {name, set: {dir, i, n}, attr, dir, cluster, size, contiguous}, or null
  _find(dir, name) {
    this._name(name);
    const want = this.up(name);
    for (const s of this._sets(dir)) {
      const b = s.bytes;
      if (b[0] !== FILE || s.n < 3 || b[32] !== STREAM) continue;
      const len = b[32 + 3];
      let text = '';
      for (let k = 2; k < s.n && text.length < len; k++) if (b[32 * k] === NAME) for (let j = 0; j < 15 && text.length < len; j++) text += String.fromCharCode(u16(b, 32 * k + 2 + 2 * j));
      if (this.up(text) !== want) continue;
      return { name: text, set: { dir, i: s.i, n: s.n }, attr: u16(b, 4), dir: (u16(b, 4) & ATTR_DIR) !== 0, cluster: u32(b, 32 + 20), size: u64(b, 32 + 24), contiguous: (b[33] & NO_FAT_CHAIN) !== 0 };
    }
    return null;
  }
  _name(name) {
    if (!name.length || name.length > 255 || FORBIDDEN.test(name)) throw new CardFsError(`'${name}' is not an exFAT name (1-255 characters, none of the controls and " * / : < > ? \\ |)`);
  }
  // n free entries in a row (type below 0x80), the directory grown by zeroed clusters until it has them
  _room(dir, n) {
    for (;;) {
      const count = dir.clusters.length * this.per / 32;
      let run = 0;
      for (let i = 0; i < count; i++) {
        run = this._entryBytes(dir, i)[0] & IN_USE ? 0 : run + 1;
        if (run === n) return i - n + 1;
      }
      this._grow(dir);
    }
  }
  _grow(dir) {
    const last = dir.clusters.at(-1);
    if (dir.contiguous) dir.clusters.forEach((c, i) => this.setNext(c, i + 1 < dir.clusters.length ? dir.clusters[i + 1] : EX_EOC));
    const [c] = this._alloc(1, last);
    this._write([c], new Uint8Array(0));
    dir.clusters.push(c);
    if (dir.set) {          // its stream extension: chained now, its lengths one cluster more, the set's checksum again
      const st = this._entryBytes(dir.set.dir, dir.set.i + 1), len = dir.clusters.length * this.per;
      st[1] &= ~NO_FAT_CHAIN; put64(st, 8, len); put64(st, 24, len);
      this.sec.changed(this._at(dir.set.dir, dir.set.i + 1)[0]);
      this._seal(dir.set.dir, dir.set.i, dir.set.n);
    }
    dir.contiguous = false;
  }
  // the set checksum over the set's entries (its own field left out)
  _seal(dir, i, n) {
    let sum = 0;
    for (let k = 0; k < n; k++) { const e = this._entryBytes(dir, i + k); for (let j = 0; j < 32; j++) if (!(k === 0 && (j === 2 || j === 3))) sum = rotate16(sum, e[j]); }
    const [lba, o] = this._at(dir, i), s = this.sec.get(lba);
    put16(s, o + 2, sum); this.sec.changed(lba);
  }
  // a file entry set written at a free run: the file entry, the stream extension, the name entries
  _set(dir, name, attr, cluster, size, stamp) {
    this._name(name);
    const names = Math.ceil(name.length / 15), n = 2 + names, i = this._room(dir, n), ts = (stamp.date << 16 | stamp.time) >>> 0;
    const set = new Uint8Array(32 * n);
    set[0] = FILE; set[1] = n - 1; put16(set, 4, attr); put32(set, 8, ts); put32(set, 12, ts); put32(set, 16, ts);
    set[32] = STREAM; set[33] = ALLOC_POSSIBLE; set[35] = name.length;
    let hash = 0;
    const upName = this.up(name);
    for (let j = 0; j < upName.length; j++) { const v = upName.charCodeAt(j); hash = rotate16(rotate16(hash, v & 0xff), v >> 8); }
    put16(set, 36, hash); put64(set, 40, size); put32(set, 52, cluster); put64(set, 56, size);
    for (let j = 0; j < name.length; j++) { const e = 64 + 32 * Math.floor(j / 15); set[e] = NAME; put16(set, e + 2 + 2 * (j % 15), name.charCodeAt(j)); }
    for (let k = 0; k < n; k++) { const [lba, o] = this._at(dir, i + k); this.sec.get(lba).set(set.subarray(32 * k, 32 * k + 32), o); this.sec.changed(lba); }
    this._seal(dir, i, n);
  }
  _unset(set) {
    for (let k = 0; k < set.n; k++) { const [lba, o] = this._at(set.dir, set.i + k), s = this.sec.get(lba); s[o] &= ~IN_USE; this.sec.changed(lba); }
  }
  _mkdir(parent, name, stamp) {
    const [c] = this._alloc(1);
    this._write([c], new Uint8Array(0));
    this._set(parent, name, ATTR_DIR, c, this.per, stamp);
    const e = this._find(parent, name);
    return this._open(e);
  }
  _put(dir, name, bytes, stamp) {
    const old = this._find(dir, name);
    if (old?.dir) throw new CardFsError(`${name} is a directory`);
    if (old) { this._unset(old.set); this._free(this._open(old).clusters, !old.contiguous); }
    const clusters = this._alloc(Math.ceil(bytes.length / this.per));
    this._write(clusters, bytes);
    this._set(dir, old?.name ?? name, ATTR_ARCHIVE, clusters[0] ?? 0, bytes.length, stamp);
    return { replaced: !!old, size: bytes.length, clusters: clusters.length, first: clusters[0] ?? 0 };
  }
  _rm(dir, name) {
    const e = this._find(dir, name);
    if (!e) throw new CardFsError(`${name}: no such file`);
    if (e.dir) throw new CardFsError(`${name} is a directory (only files are deleted here)`);
    const clusters = e.size ? this._open(e).clusters : [];
    this._unset(e.set);
    this._free(clusters, !e.contiguous);
    return { size: e.size, clusters: clusters.length };
  }
}

// Files written to a card before the firmware mounts it ([{path, bytes}], each put as put() does, with the stamp),
// on the card the firmware formatted (a blank card is refused: openCardFs). The writer's results, in order
export function cardPut(card, files, { stamp = FIXED_STAMP } = {}) {
  const fs = openCardFs(cardDevice(card));
  return files.map((f) => fs.put(f.path, f.bytes, { stamp }));
}
// A session's card (env.card: {open(), save(card)}, src/lab/storage.mjs) with files put on it at its first open,
// before the firmware's insertion mounts it (the next opens, a player's power cycle, give the card as the last
// session left it); results(list) is called with cardPut's results
export function withCardFiles(provider, files, { stamp = FIXED_STAMP, results = () => {} } = {}) {
  let done = false;
  return {
    ...provider,
    open() {
      const card = provider.open();
      if (!done && files.length) {
        if (!card) throw new CardFsError('no card in the slot to put files on');
        results(cardPut(card, files, { stamp }));
      }
      done = true;
      return card;
    },
  };
}
