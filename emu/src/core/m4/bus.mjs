// A memory bus for the Cortex-M4 core (cpu.mjs): little-endian regions of RAM and ROM, and a callback for every
// address outside them (by default a BusError). Peripherals attach as regions with their own read / write functions.
//   const bus = new MemoryBus();
//   bus.ram(0x20000000, 0x10000); bus.rom(0x08000000, image); bus.alias(0, 0x08000000, image.length);
//   bus.device(0x40021000, 0x400, { read(off, size), write(off, size, value) });
import { BusError } from './errors.mjs';

export class MemoryBus {
  // unmapped(addr, size, write, value): the answer for an address no region holds (return a value for a read)
  constructor({ unmapped = null } = {}) {
    this.regions = [];
    this.unmapped = unmapped || ((a, size, write) => { throw new BusError(a, write); });
    this.last = null;
  }
  add(r) { this.regions.push(r); this.regions.sort((x, y) => x.base - y.base); this.last = null; return r; }
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
  codeCacheable(a) { const r = this.find(a); return !!(r && r.rom); }
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
    if (r.rom) { this.unmapped(a, size, true, v); return; }
    const b = r.bytes, o = a - r.base;
    b[o] = v; if (size > 1) { b[o + 1] = v >>> 8; if (size > 2) { b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; } }
  }
  read8(a) { return this.rd(a, 1); }
  read16(a) { return this.rd(a, 2); }
  read32(a) { return this.rd(a, 4); }
  write8(a, v) { this.wr(a, 1, v); }
  write16(a, v) { this.wr(a, 2, v); }
  write32(a, v) { this.wr(a, 4, v); }
}
