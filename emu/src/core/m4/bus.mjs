// A memory bus for the Cortex-M4 core (cpu.mjs): little-endian regions of RAM and ROM, and a callback for every
// address outside them (by default a BusError). Peripherals attach as regions with their own read / write functions.
//   const bus = new MemoryBus();
//   bus.ram(0x20000000, 0x10000); bus.rom(0x08000000, image); bus.alias(0, 0x08000000, image.length);
//   bus.device(0x40021000, 0x400, { read(off, size), write(off, size, value) });
//
// Code pages, for the core's decode cache (dcache.mjs): every byte region's backing buffer has a version word per
// 256-byte page in pageVer (regions that view one buffer, as the flash and its boot alias do, share the buffer's
// pages). codePage(addr) is the page of a byte region's address, -1 for a device or no region. A page's version is odd
// while the cache holds an instruction decoded from it; a write through write8 / 16 / 32 into such a page (RAM, or ROM
// on its way to the unmapped callback, which may program it) makes it even, a new value, so every instruction decoded
// from it is decoded again. A model that changes a region's bytes in any other way (a flash erase or programming done
// on the bytes themselves, a clear of SRAM) must report it with written(addr, len). codeEpoch changes when the map
// changes (add) and when a version wraps; the cache then drops everything.
import { BusError } from './errors.mjs';

export const PAGE_SHIFT = 8;

export class MemoryBus {
  // unmapped(addr, size, write, value): the answer for an address no region holds (return a value for a read)
  constructor({ unmapped = null } = {}) {
    this.regions = [];
    this.unmapped = unmapped || ((a, size, write) => { throw new BusError(a, write); });
    this.last = null;
    this.pageVer = new Uint32Array(0);
    this.pageBase = new Map();                    // backing ArrayBuffer -> the index of its first page in pageVer
    this.codeEpoch = 0;
  }
  add(r) {
    if (r.bytes) {                                // the region's pages: pg0 + ((off + addr - base) >>> PAGE_SHIFT)
      const buf = r.bytes.buffer;
      let pg0 = this.pageBase.get(buf);
      if (pg0 === undefined) {
        pg0 = this.pageVer.length;
        const v = new Uint32Array(pg0 + Math.max(1, Math.ceil(buf.byteLength / (1 << PAGE_SHIFT))));
        v.set(this.pageVer);
        this.pageVer = v;
        this.pageBase.set(buf, pg0);
      }
      r.pg0 = pg0; r.off = r.bytes.byteOffset;
    }
    this.regions.push(r); this.regions.sort((x, y) => x.base - y.base); this.last = null;
    this.codeEpoch++;
    return r;
  }
  ram(base, size) { const bytes = new Uint8Array(size); this.add({ base, end: base + size, bytes, rom: false }); return bytes; }
  rom(base, bytes) { this.add({ base, end: base + bytes.length, bytes, rom: true }); return bytes; }
  // the same bytes at a second address (the STM32's boot alias of flash at 0)
  alias(base, of, size) { const r = this.find(of); this.add({ base, end: base + size, bytes: r.bytes.subarray(of - r.base, of - r.base + size), rom: r.rom }); }
  device(base, size, dev) { this.add({ base, end: base + size, dev }); }
  find(a) {
    const l = this.last;
    if (l && a >= l.base && a < l.end) return l;
    for (const r of this.regions) if (a >= r.base && a < r.end) { this.last = r; return r; }
    return null;
  }
  // ---- code pages
  codePage(a) { const r = this.find(a); return r && r.bytes ? r.pg0 + ((r.off + a - r.base) >>> PAGE_SHIFT) : -1; }
  dirty(p) {
    const pv = this.pageVer;
    if (pv[p] & 1) { pv[p]++; if (pv[p] === 0) this.codeEpoch++; }
  }
  // bytes [addr, addr + len) of the byte regions changed other than through the write functions
  written(a, len) {
    if (len <= 0) return;
    const end = a + len;
    for (const r of this.regions) {
      if (!r.bytes || r.end <= a || r.base >= end) continue;
      const lo = r.off + Math.max(a, r.base) - r.base, hi = r.off + Math.min(end, r.end) - 1 - r.base;
      for (let p = lo >>> PAGE_SHIFT; p <= hi >>> PAGE_SHIFT; p++) this.dirty(r.pg0 + p);
    }
  }
  // ---- accesses
  rd(a, size) {
    const r = this.find(a);
    if (!r || a + size > r.end) return this.unmapped(a, size, false, 0);
    if (r.dev) return r.dev.read(a - r.base, size);
    const b = r.bytes, o = a - r.base;
    if (size === 1) return b[o];
    if (size === 2) return b[o] | (b[o + 1] << 8);
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
  }
  wr(a, size, v) {
    const r = this.find(a);
    if (!r || a + size > r.end) { this.unmapped(a, size, true, v); return; }
    if (r.dev) { r.dev.write(a - r.base, size, v); return; }
    const o = a - r.base, x = r.off + o;
    this.dirty(r.pg0 + (x >>> PAGE_SHIFT));
    if (size > 1) this.dirty(r.pg0 + ((x + size - 1) >>> PAGE_SHIFT));
    if (r.rom) { this.unmapped(a, size, true, v); return; }
    const b = r.bytes;
    b[o] = v; if (size > 1) { b[o + 1] = v >>> 8; if (size > 2) { b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; } }
  }
  read8(a) { return this.rd(a, 1); }
  read16(a) { return this.rd(a, 2); }
  read32(a) { return this.rd(a, 4); }
  write8(a, v) { this.wr(a, 1, v); }
  write16(a, v) { this.wr(a, 2, v); }
  write32(a, v) { this.wr(a, 4, v); }
}
