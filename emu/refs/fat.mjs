// An independent reader of a FAT volume on a block device, written from Microsoft's FAT specification (FAT: General
// Overview of On-Disk Format, version 1.03) and the MBR's partition table, for checking what the firmware wrote to the
// lab's card (src/lab/sdcard.mjs). It imports only refs/ (test_pure.mjs) and reads through read(lba, count) -> bytes
// (512-byte sectors), so it shares no code with the firmware or the lab. FAT12 / FAT16 / FAT32 and long file names;
// an exFAT volume is recognised and refused here (refs/exfat.mjs reads it; refs/volume.mjs picks the reader).
import { ValueError } from './errors.mjs';

const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

// The first partition of an MBR: {type, start, sectors}, or null when sector 0 is no MBR (no 0x55aa, or a boot
// sector with its own BPB at 0)
export function mbrPartition(sector0) {
  if (sector0[510] !== 0x55 || sector0[511] !== 0xaa) return null;
  const e = 446;
  const type = sector0[e + 4], start = u32(sector0, e + 8), sectors = u32(sector0, e + 12);
  return type === 0 ? null : { type, start, sectors, active: sector0[e] === 0x80 };
}

export class FatVolume {
  // read(lba, count): bytes of count sectors; start: the volume's first sector
  constructor(read, start = 0) {
    this.read = read; this.start = start;
    const b = read(start, 1);
    if (ascii(b, 3, 8) === 'EXFAT   ') throw new ValueError('FatVolume: an exFAT volume (not read here)');
    if (b[510] !== 0x55 || b[511] !== 0xaa) throw new ValueError(`FatVolume: sector ${start} has no boot signature`);
    this.bps = u16(b, 11); this.spc = b[13]; this.reserved = u16(b, 14); this.nfats = b[16];
    this.rootEntries = u16(b, 17);
    this.total = u16(b, 19) || u32(b, 32);
    this.media = b[21];
    this.fatSize = u16(b, 22) || u32(b, 36);
    if (this.bps !== 512) throw new ValueError(`FatVolume: ${this.bps} bytes per sector`);
    const rootSectors = Math.ceil(this.rootEntries * 32 / this.bps);
    this.firstData = this.reserved + this.nfats * this.fatSize + rootSectors;
    this.clusters = Math.floor((this.total - this.firstData) / this.spc);
    this.type = this.clusters < 4085 ? 'FAT12' : this.clusters < 65525 ? 'FAT16' : 'FAT32';
    if (this.type === 'FAT32') {
      this.rootCluster = u32(b, 44); this.fsinfo = u16(b, 48); this.backup = u16(b, 50);
      this.label = ascii(b, 71, 11); this.fsType = ascii(b, 82, 8); this.serial = u32(b, 67);
    } else {
      this.rootCluster = 0; this.label = ascii(b, 43, 11); this.fsType = ascii(b, 54, 8); this.serial = u32(b, 39);
    }
    this.boot = b;
  }
  sectorOf(cluster) { return this.start + this.firstData + (cluster - 2) * this.spc; }
  // the FAT entry of a cluster (the first FAT)
  next(cluster) {
    const fatStart = this.start + this.reserved;
    if (this.type === 'FAT32') {
      const off = cluster * 4, s = this.read(fatStart + Math.floor(off / 512), 1);
      return u32(s, off % 512) & 0x0fffffff;
    }
    if (this.type === 'FAT16') {
      const off = cluster * 2, s = this.read(fatStart + Math.floor(off / 512), 1);
      return u16(s, off % 512);
    }
    const off = cluster + (cluster >> 1), s = this.read(fatStart + Math.floor(off / 512), 2);
    const v = u16(s, off % 512);
    return cluster & 1 ? v >> 4 : v & 0xfff;
  }
  eoc(v) { return this.type === 'FAT32' ? v >= 0x0ffffff8 : this.type === 'FAT16' ? v >= 0xfff8 : v >= 0xff8; }
  chain(cluster) {
    const out = [];
    while (cluster >= 2 && !this.eoc(cluster)) {
      if (out.length > this.clusters) throw new ValueError(`FatVolume: the chain from cluster ${out[0]} loops`);
      out.push(cluster);
      cluster = this.next(cluster);
    }
    return out;
  }
  // the free clusters by the FAT
  freeClusters() {
    let n = 0;
    for (let c = 2; c < this.clusters + 2; c++) if (this.next(c) === 0) n += 1;
    return n;
  }
  // FAT32's FSInfo: {free, next} or null
  fsInfo() {
    if (this.type !== 'FAT32') return null;
    const b = this.read(this.start + this.fsinfo, 1);
    if (u32(b, 0) !== 0x41615252 || u32(b, 484) !== 0x61417272) return null;
    return { free: u32(b, 488), next: u32(b, 492) };
  }
  // the entries of a directory (cluster 0: the FAT12/16 root; a directory's entry, as refs/exfat.mjs takes it, by its
  // cluster): {name, short, attr, cluster, size, time, date}
  list(dir = this.rootCluster) {
    const cluster = dir !== null && typeof dir === 'object' ? dir.cluster : dir ?? this.rootCluster;
    let bytes;
    if (cluster === 0) {
      const n = Math.ceil(this.rootEntries * 32 / 512);
      bytes = this.read(this.start + this.reserved + this.nfats * this.fatSize, n);
    } else {
      const parts = this.chain(cluster).map((c) => this.read(this.sectorOf(c), this.spc));
      bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    }
    const out = [];
    let lfn = [];
    for (let o = 0; o + 32 <= bytes.length; o += 32) {
      const first = bytes[o];
      if (first === 0) break;
      if (first === 0xe5) { lfn = []; continue; }
      const attr = bytes[o + 11];
      if (attr === 0x0f) {
        const part = [];
        for (const [a, n] of [[1, 5], [14, 6], [28, 2]]) for (let i = 0; i < n; i++) part.push(u16(bytes, o + a + 2 * i));
        lfn.unshift(part);
        continue;
      }
      const base = ascii(bytes, o, 8).trimEnd(), ext = ascii(bytes, o + 8, 3).trimEnd();
      const short = ext ? `${base}.${ext}` : base;
      let name = short;
      if (lfn.length) {
        const chars = lfn.flat(); const end = chars.findIndex((c) => c === 0 || c === 0xffff);
        name = String.fromCharCode(...(end < 0 ? chars : chars.slice(0, end)));
      }
      lfn = [];
      if (attr & 0x08) continue;          // the volume label
      out.push({ name, short, attr, cluster: (u16(bytes, o + 20) << 16 | u16(bytes, o + 26)) >>> 0, size: u32(bytes, o + 28),
        time: u16(bytes, o + 22), date: u16(bytes, o + 24), dir: (attr & 0x10) !== 0 });
    }
    return out;
  }
  // the entry at a path ('DCIM/100OMSYS/P1010001.JPG', names compared without case), or null
  find(path) {
    let cluster = this.rootCluster, entry = null;
    for (const part of path.split('/').filter(Boolean)) {
      entry = this.list(cluster).find((e) => e.name.toUpperCase() === part.toUpperCase() || e.short.toUpperCase() === part.toUpperCase()) ?? null;
      if (!entry) return null;
      cluster = entry.cluster;
    }
    return entry;
  }
  // a file's bytes, by its entry
  data(entry) {
    const out = new Uint8Array(entry.size), per = this.spc * 512;
    let o = 0;
    for (const c of this.chain(entry.cluster)) {
      if (o >= entry.size) break;
      const b = this.read(this.sectorOf(c), this.spc);
      out.set(b.subarray(0, Math.min(per, entry.size - o)), o);
      o += per;
    }
    if (o < entry.size) throw new ValueError(`FatVolume: ${entry.name}'s chain is ${o} bytes, its size ${entry.size}`);
    return out;
  }
}
