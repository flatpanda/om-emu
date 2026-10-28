// An independent reader of an exFAT volume on a block device, written from Microsoft's exFAT File System Specification
// (the version Microsoft published in 2019, file system revision 1.00) and the SD File System Specification's use of it
// on SDXC cards, for checking what the firmware wrote to the lab's card (src/lab/sdcard.mjs) when it formats a card
// exFAT. It imports only refs/ (test_pure.mjs) and reads through read(lba, count) -> bytes (512-byte sectors), as
// refs/fat.mjs does, and gives its callers the same surface (type, label, spc, clusters, list, find, data, chain,
// freeClusters, fsInfo), so a card of either kind reads the same way (refs/volume.mjs picks the reader by the boot
// sector). It is strict, as a check of another writer's volume should be: the boot region's checksum, the up-case
// table's checksum, each directory entry set's checksum and each name's hash are verified, and a mismatch is a
// ValueError, not a guess.
//
// The layout read (offsets in bytes, sizes in sectors unless said):
//   boot sector  3 'EXFAT   ', 11..63 zero, 64 PartitionOffset (u64), 72 VolumeLength (u64), 80 FatOffset, 84
//                FatLength, 88 ClusterHeapOffset, 92 ClusterCount, 96 FirstClusterOfRootDirectory, 100
//                VolumeSerialNumber, 104 FileSystemRevision (u16, major in the high byte), 106 VolumeFlags (u16: bit 0
//                ActiveFat, 1 VolumeDirty, 2 MediaFailure), 108 BytesPerSectorShift, 109 SectorsPerClusterShift, 110
//                NumberOfFats, 111 DriveSelect, 112 PercentInUse, 510 0x55 0xaa
//   boot region  sectors 0..11 (the boot sector, eight extended boot sectors, the OEM parameters, a reserved sector,
//                the boot checksum: one u32 repeated over sector 11, over sectors 0..10 but bytes 106, 107 and 112);
//                the backup boot region the same at 12..23
//   FAT          u32 entries from FatOffset (the second FAT, FatLength further, when ActiveFat is 1); 0xffffffff ends a
//                chain, 0xfffffff7 marks a bad cluster; the clusters are 2..ClusterCount+1, cluster c at
//                ClusterHeapOffset + (c - 2) << SectorsPerClusterShift
//   directory    32-byte entries: bit 7 of the type in use, bit 6 a secondary entry, bit 5 a benign one; 0 ends the
//                directory. Critical primaries: 0x81 the allocation bitmap (+1 flags: bit 0 the FAT it is for, +20 its
//                first cluster, +24 its length), 0x82 the up-case table (+4 its checksum, +20, +24), 0x83 the volume
//                label (+1 its length in characters, +2 up to 11 UTF-16 characters), 0x85 a file (+1 its secondary
//                count, +2 the set checksum, +4 its attributes, +8 / +12 / +16 its create / modify / access timestamps,
//                FAT's date in the high half and time in the low); the file's secondaries 0xc0 the stream extension
//                (+1 flags: bit 0 allocation possible, bit 1 NoFatChain; +3 the name's length, +4 its hash, +8 the
//                valid data length (u64), +20 the first cluster, +24 the data length (u64)) and 0xc1 a name (+2, 15
//                UTF-16 characters); the benign primaries (0xa0 the volume GUID, 0xa1 TexFAT padding) carry their
//                secondary count at +1 and are skipped with it
//   bitmap       bit c - 2 (byte (c - 2) >> 3, bit (c - 2) & 7) set: cluster c is allocated
//   up-case      u16 per code point from 0; 0xffff n stands for n code points that map to themselves; a code point
//                past the table maps to itself
import { ValueError } from './errors.mjs';

const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const SECTOR = 512;
const EOC = 0xffffffff, BAD = 0xfffffff7;
const BITMAP = 0x81, UPCASE = 0x82, LABEL = 0x83, FILE = 0x85, STREAM = 0xc0, NAME = 0xc1;
const IN_USE = 0x80, SECONDARY = 0x40, BENIGN = 0x20;
const NO_FAT_CHAIN = 2, ATTR_DIR = 0x10;

// The checksums of the specification: the boot region's and the up-case table's (32 bits; skip: offsets left out) and
// an entry set's or a name's (16 bits), each a rotate right by one and an add per byte
export function checksum32(bytes, skip = []) {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) if (!skip.includes(i)) c = ((c & 1 ? 0x80000000 : 0) + (c >>> 1) + bytes[i]) >>> 0;
  return c;
}
export function checksum16(bytes, skip = []) {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) if (!skip.includes(i)) c = ((c & 1 ? 0x8000 : 0) + (c >>> 1) + bytes[i]) & 0xffff;
  return c;
}
// the boot region's checksum over sectors 0..10 (VolumeFlags and PercentInUse left out)
export const bootChecksum = (sectors0to10) => checksum32(sectors0to10, [106, 107, 112]);
// an entry set's checksum (its own field, bytes 2 and 3 of the file entry, left out)
export const setChecksum = (set) => checksum16(set, [2, 3]);
// a name's hash: over its up-cased UTF-16 code units, low byte first (up: code unit -> code unit)
export function nameHash(name, up = (c) => c) {
  const b = new Uint8Array(2 * name.length);
  for (let i = 0; i < name.length; i++) { const c = up(name.charCodeAt(i)); b[2 * i] = c & 0xff; b[2 * i + 1] = c >> 8; }
  return checksum16(b);
}
// sector 0 of a volume (or of a card without an MBR) holds an exFAT boot sector
export const isExfatBoot = (b) => ascii(b, 3, 8) === 'EXFAT   ' && b[510] === 0x55 && b[511] === 0xaa;

export class ExfatVolume {
  // read(lba, count): bytes of count sectors; start: the volume's first sector
  constructor(read, start = 0) {
    this.read = read; this.start = start;
    const region = read(start, 12), b = region.subarray(0, SECTOR);
    if (!isExfatBoot(b)) throw new ValueError(`ExfatVolume: sector ${start} is no exFAT boot sector`);
    if (b.subarray(11, 64).some((v) => v !== 0)) throw new ValueError('ExfatVolume: the boot sector\'s bytes 11..63 are not zero (a FAT BPB?)');
    if (b[108] !== 9) throw new ValueError(`ExfatVolume: 2^${b[108]} bytes per sector, only 512 read here`);
    if (b[109] > 25 - 9) throw new ValueError(`ExfatVolume: 2^${b[109]} sectors per cluster, past the specification's 32 MiB cluster`);
    if (b[110] !== 1 && b[110] !== 2) throw new ValueError(`ExfatVolume: ${b[110]} FATs`);
    this.revision = u16(b, 104);
    if (this.revision >> 8 !== 1) throw new ValueError(`ExfatVolume: file system revision ${this.revision >> 8}.${this.revision & 0xff}, only 1.x read here`);
    // the boot checksum: sector 11 is the one value repeated
    const sum = bootChecksum(region.subarray(0, 11 * SECTOR)), sums = region.subarray(11 * SECTOR, 12 * SECTOR);
    for (let i = 0; i < SECTOR; i += 4) {
      if (u32(sums, i) !== sum) throw new ValueError(`ExfatVolume: the boot checksum 0x${u32(sums, i).toString(16)} at sector 11 +${i}, the region's is 0x${sum.toString(16)}`);
    }
    this.bootSum = sum;
    this.bps = SECTOR;
    this.partitionOffset = u64(b, 64); this.total = u64(b, 72);
    this.fatOffset = u32(b, 80); this.fatLength = u32(b, 84);
    this.heapOffset = u32(b, 88); this.clusters = u32(b, 92); this.rootCluster = u32(b, 96);
    this.serial = u32(b, 100); this.flags = u16(b, 106);
    this.spc = 1 << b[109]; this.nfats = b[110]; this.percentInUse = b[112];
    this.activeFat = this.nfats === 2 ? this.flags & 1 : 0;
    this.dirty = (this.flags & 2) !== 0;
    this.firstData = this.heapOffset;
    this.type = 'exFAT'; this.fsType = ascii(b, 3, 8);
    if (this.fatOffset < 24 || this.heapOffset < this.fatOffset + this.nfats * this.fatLength) throw new ValueError(`ExfatVolume: FAT at ${this.fatOffset} (${this.nfats} x ${this.fatLength}) and the heap at ${this.heapOffset} overlap the boot regions or each other`);
    if (this.heapOffset + this.clusters * this.spc > this.total) throw new ValueError(`ExfatVolume: ${this.clusters} clusters from ${this.heapOffset} run past the volume's ${this.total} sectors`);
    if (this.fatLength * SECTOR < 4 * (this.clusters + 2)) throw new ValueError(`ExfatVolume: a FAT of ${this.fatLength} sectors for ${this.clusters} clusters`);
    this.boot = b.slice();
    // the root directory's critical entries: the allocation bitmap (the active FAT's), the up-case table, the label
    this.bitmapEntry = null; this.upcaseEntry = null; this.label = '';
    for (const set of this._sets(this._dirBytes(null))) {
      const t = set[0];
      if (t === BITMAP && (set[1] & 1) === this.activeFat) this.bitmapEntry = { cluster: u32(set, 20), size: u64(set, 24) };
      else if (t === UPCASE) this.upcaseEntry = { cluster: u32(set, 20), size: u64(set, 24), checksum: u32(set, 4) };
      else if (t === LABEL) {
        const n = set[1];
        if (n > 11) throw new ValueError(`ExfatVolume: a volume label of ${n} characters`);
        this.label = String.fromCharCode(...Array.from({ length: n }, (_, i) => u16(set, 2 + 2 * i)));
      }
    }
    if (!this.bitmapEntry) throw new ValueError(`ExfatVolume: no allocation bitmap for FAT ${this.activeFat} in the root directory`);
    if (!this.upcaseEntry) throw new ValueError('ExfatVolume: no up-case table in the root directory');
    if (this.bitmapEntry.size < Math.ceil(this.clusters / 8)) throw new ValueError(`ExfatVolume: an allocation bitmap of ${this.bitmapEntry.size} bytes for ${this.clusters} clusters`);
    const table = this._bytes(this.chain(this.upcaseEntry.cluster), this.upcaseEntry.size);
    const tsum = checksum32(table);
    if (tsum !== this.upcaseEntry.checksum) throw new ValueError(`ExfatVolume: the up-case table's checksum is 0x${tsum.toString(16)}, its entry says 0x${this.upcaseEntry.checksum.toString(16)}`);
    this.upcase = ExfatVolume.upcaseMap(table);
  }
  // The up-case table's bytes as a map code unit -> code unit (identity past its end and in its 0xffff runs)
  static upcaseMap(table) {
    const out = [];
    for (let k = 0; k + 1 < table.length; k += 2) {
      const v = u16(table, k);
      if (v === 0xffff && k + 3 < table.length) {
        const n = u16(table, k + 2);
        for (let j = 0; j < n; j++) out.push(out.length);
        k += 2;
      } else out.push(v);
    }
    return Uint16Array.from(out);
  }
  up(c) { return c < this.upcase.length ? this.upcase[c] : c; }
  upName(name) { let s = ''; for (let i = 0; i < name.length; i++) s += String.fromCharCode(this.up(name.charCodeAt(i))); return s; }
  sectorOf(cluster) { return this.start + this.heapOffset + (cluster - 2) * this.spc; }
  // the FAT entry of a cluster (the active FAT)
  next(cluster) {
    const off = cluster * 4, fat = this.start + this.fatOffset + this.activeFat * this.fatLength;
    return u32(this.read(fat + Math.floor(off / SECTOR), 1), off % SECTOR);
  }
  eoc(v) { return v === EOC; }
  // the clusters of a FAT chain from cluster (0: none, an empty file)
  chain(cluster) {
    const out = [];
    if (cluster === 0) return out;
    const first = cluster;
    while (cluster !== EOC) {
      if (cluster === BAD) throw new ValueError(`ExfatVolume: the chain from cluster ${first} reaches a bad cluster`);
      if (cluster < 2 || cluster > this.clusters + 1) throw new ValueError(`ExfatVolume: the chain from cluster ${first} reaches ${cluster}, outside the heap's 2..${this.clusters + 1}`);
      if (out.length >= this.clusters) throw new ValueError(`ExfatVolume: the chain from cluster ${first} loops`);
      out.push(cluster);
      cluster = this.next(cluster);
    }
    return out;
  }
  // the clusters an entry's data takes: a NoFatChain entry's are contiguous (the FAT is not read), the others' its
  // chain; either way enough for its size
  clustersOf(entry) {
    const per = this.spc * SECTOR, need = Math.ceil(entry.size / per);
    if (entry.size === 0) return [];
    if (entry.contiguous) {
      if (entry.cluster < 2 || entry.cluster + need - 1 > this.clusters + 1) throw new ValueError(`ExfatVolume: ${entry.name}: clusters ${entry.cluster}..${entry.cluster + need - 1} are not all in the heap`);
      return Array.from({ length: need }, (_, i) => entry.cluster + i);
    }
    const c = this.chain(entry.cluster);
    if (c.length < need) throw new ValueError(`ExfatVolume: ${entry.name}'s chain is ${c.length * per} bytes, its size ${entry.size}`);
    return c.slice(0, need);
  }
  // size bytes of the clusters, read a contiguous run at a time
  _bytes(clusters, size) {
    const per = this.spc * SECTOR, out = new Uint8Array(size);
    for (let i = 0; i < clusters.length && i * per < size;) {
      let n = 1;
      while (i + n < clusters.length && clusters[i + n] === clusters[i] + n && (i + n) * per < size) n += 1;
      const b = this.read(this.sectorOf(clusters[i]), n * this.spc), o = i * per;
      out.set(b.subarray(0, Math.min(b.length, size - o)), o);
      i += n;
    }
    return out;
  }
  // a directory's bytes: null the root, a number a directory by its first cluster through the FAT (both their
  // chain's length), else a directory's entry
  _dirBytes(dir) {
    if (dir === null || typeof dir === 'number') {
      const c = this.chain(dir ?? this.rootCluster);
      return this._bytes(c, c.length * this.spc * SECTOR);
    }
    if (!dir.dir) throw new ValueError(`ExfatVolume: ${dir.name} is not a directory`);
    return this._bytes(this.clustersOf(dir), dir.size);
  }
  // A directory's entry sets in order: each primary entry with its secondaries (the file entry's checksum verified);
  // unused entries skipped, the end at a type 0
  _sets(bytes) {
    const out = [];
    for (let o = 0; o + 32 <= bytes.length;) {
      const t = bytes[o];
      if (t === 0) break;
      if (!(t & IN_USE)) { o += 32; continue; }
      if (t & SECONDARY) throw new ValueError(`ExfatVolume: a secondary entry 0x${t.toString(16)} at +${o} with no primary before it`);
      if (!(t & BENIGN) && ![BITMAP, UPCASE, LABEL, FILE].includes(t)) throw new ValueError(`ExfatVolume: a critical primary entry 0x${t.toString(16)} at +${o} (not read here)`);
      const n = t === FILE || (t & BENIGN) ? bytes[o + 1] : 0;
      if (o + 32 * (n + 1) > bytes.length) throw new ValueError(`ExfatVolume: the entry set at +${o} (${n} secondaries) runs past its directory`);
      const set = bytes.subarray(o, o + 32 * (n + 1));
      if (t === FILE) {
        const sum = setChecksum(set);
        if (sum !== u16(set, 2)) throw new ValueError(`ExfatVolume: the set checksum at +${o} is 0x${u16(set, 2).toString(16)}, its entries' is 0x${sum.toString(16)}`);
      }
      out.push(set);
      o += set.length;
    }
    return out;
  }
  // a file entry set as an entry: {name, short (the name: exFAT has no short names), attr, cluster, size, validSize,
  // contiguous, time, date, dir}, its name hash verified
  _file(set) {
    const n = set[1];
    if (n < 2 || n > 18) throw new ValueError(`ExfatVolume: a file entry with ${n} secondaries (2..18)`);
    if (set[32] !== STREAM) throw new ValueError(`ExfatVolume: a file entry's first secondary is 0x${set[32].toString(16)}, not the stream extension`);
    const s = set.subarray(32, 64), length = s[3], units = [];
    for (let k = 2; k <= n; k++) {
      const e = set.subarray(32 * k, 32 * k + 32);
      if (e[0] === NAME) for (let i = 0; i < 15; i++) units.push(u16(e, 2 + 2 * i));
      else if (!(e[0] & BENIGN)) throw new ValueError(`ExfatVolume: a critical secondary 0x${e[0].toString(16)} in a file's set (not read here)`);
    }
    if (length < 1 || length > units.length) throw new ValueError(`ExfatVolume: a name of ${length} characters in ${units.length / 15} name entries`);
    const name = String.fromCharCode(...units.slice(0, length));
    const hash = nameHash(name, (c) => this.up(c));
    if (hash !== u16(s, 4)) throw new ValueError(`ExfatVolume: ${name}'s name hash is 0x${u16(s, 4).toString(16)}, its up-cased name's 0x${hash.toString(16)}`);
    const attr = u16(set, 4), modified = u32(set, 12);
    return { name, short: name, attr, cluster: u32(s, 20), size: u64(s, 24), validSize: u64(s, 8),
      contiguous: (s[1] & NO_FAT_CHAIN) !== 0, time: modified & 0xffff, date: modified >>> 16, dir: (attr & ATTR_DIR) !== 0 };
  }
  // the files and directories of a directory (null or nothing: the root; else a directory's entry, as list() and
  // find() give it: an exFAT directory may be contiguous, which its cluster alone does not say; a cluster number is
  // read as fat.mjs reads it, through the FAT)
  list(dir = null) {
    return this._sets(this._dirBytes(dir)).filter((set) => set[0] === FILE).map((set) => this._file(set));
  }
  // the entry at a path ('DCIM/100OMSYS/P1010001.JPG', names compared up-cased by the volume's table), or null
  find(path) {
    let dir = null, entry = null;
    for (const part of path.split('/').filter(Boolean)) {
      if (dir !== null && !dir.dir) return null;
      const want = this.upName(part);
      entry = this.list(dir).find((e) => this.upName(e.name) === want) ?? null;
      if (!entry) return null;
      dir = entry;
    }
    return entry;
  }
  // a file's bytes, by its entry: its size, those past its valid data length read as zeros
  data(entry) {
    const out = this._bytes(this.clustersOf(entry), entry.size);
    if (entry.validSize < entry.size) out.fill(0, entry.validSize);
    return out;
  }
  // the allocation bitmap's bytes, and whether a cluster is allocated by it
  bitmap() { return this._bytes(this.chain(this.bitmapEntry.cluster), Math.ceil(this.clusters / 8)); }
  allocated(cluster, bits = this.bitmap()) { const i = cluster - 2; return (bits[i >> 3] >> (i & 7) & 1) === 1; }
  // the free clusters by the allocation bitmap
  freeClusters() {
    const bits = this.bitmap();
    let used = 0;
    for (let i = 0; i < this.clusters; i++) used += bits[i >> 3] >> (i & 7) & 1;
    return this.clusters - used;
  }
  // FAT32's FSInfo has no exFAT counterpart
  fsInfo() { return null; }
  // the backup boot region (sectors 12..23) is the main one's copy
  backupMatches() {
    const r = this.read(this.start, 24);
    for (let i = 0; i < 12 * SECTOR; i++) if (r[i] !== r[12 * SECTOR + i]) return false;
    return true;
  }
  // The volume's consistency, as a list of problems (none: consistent): every cluster the bitmap, the up-case table,
  // the directories and the files take is allocated in the bitmap and taken once, a FAT-chained file's chain is as
  // long as its size needs, and the bitmap allocates no other cluster (the specification's rules; a writer that
  // breaks one is reported, not excused)
  check() {
    const problems = [], bits = this.bitmap(), owner = new Map(), per = this.spc * SECTOR;
    const take = (what, clusters) => {
      for (const c of clusters) {
        if (owner.has(c)) problems.push(`cluster ${c} is ${owner.get(c)}'s and ${what}'s`);
        else owner.set(c, what);
        if (!this.allocated(c, bits)) problems.push(`cluster ${c} (${what}) is free in the bitmap`);
      }
    };
    take('the allocation bitmap', this.chain(this.bitmapEntry.cluster));
    take('the up-case table', this.chain(this.upcaseEntry.cluster));
    take('the root directory', this.chain(this.rootCluster));
    const walk = (dir, path) => {
      for (const e of this.list(dir)) {
        const p = `${path}/${e.name}`, need = Math.ceil(e.size / per);
        const cs = e.contiguous || e.size === 0 ? this.clustersOf(e) : this.chain(e.cluster);
        if (cs.length !== need) problems.push(`${p}: ${cs.length} clusters in its chain, ${need} for its ${e.size} bytes`);
        if (e.validSize > e.size) problems.push(`${p}: valid data length ${e.validSize} past its size ${e.size}`);
        take(p, cs);
        if (e.dir) walk(e, p);
      }
    };
    walk(null, '');
    const leaked = [];
    for (let c = 2; c < this.clusters + 2; c++) if (this.allocated(c, bits) && !owner.has(c)) leaked.push(c);
    if (leaked.length) problems.push(`${leaked.length} cluster(s) allocated in the bitmap and taken by nothing (the first ${leaked.slice(0, 8).join(', ')})`);
    return problems;
  }
}
