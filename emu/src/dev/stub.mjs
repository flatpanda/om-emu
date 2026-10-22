// Lab stub for 0x80000000..0x9FFFFFFF below every lab device, with its window 0x89900000.
// With its tables empty every access is DENIED (a bus error, logged in the ring for a CPU access, printed). A harness
// that opts in (src/lab/display.mjs) fills through the debugger: the allow table (32 x {base, size, flags bit0 enable})
// and the preset table (128 x {addr, value, xor, flags}: bit0 enable, bit1 CPU writes clear the written 1-bits, bit2
// CPU writes replace the value; a read of an enabled preset returns value, then value ^= xor). Allowed reads return a
// preset, else the bytes the CPU last wrote, else 0 (flagged unwritten, 0x80). Debugger accesses have no side effects
// and see only allowed ranges; debugger writes are refused. Ring entry: {pc, addr, value, info = size | write << 4 |
// denied << 5 | preset << 6 | unwritten << 7}.
import { BUS, K_ROMD, addRegion, allocWindow, buf, ctx, setStub } from '../core/mem.mjs';

export const STUB_DEBUG_BASE = 0x89900000, STUB_DEBUG_SIZE = 0x100000;
const ALLOW = 0x100, NALLOW = 32, PRESET = 0x400, NPRESET = 128, RING = 0x10000, CAP = (STUB_DEBUG_SIZE - RING) / 16;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export class Stub {
  constructor(machine) {
    this.m = machine;
    this.store = new Map();                      // address -> byte the CPU last wrote
    const off = allocWindow(STUB_DEBUG_SIZE);
    this.d32 = new Uint32Array(buf, off, STUB_DEBUG_SIZE / 4);
    this.dset(0, 0x42555453); this.dset(4, 1); this.dset(16, CAP);
    addRegion({ base: STUB_DEBUG_BASE, size: STUB_DEBUG_SIZE, kind: K_ROMD, off, name: 'om1.lab-stub-window',
      dev: { romdWrite: (a) => { this.m.stderr(`om-emu: lab-stub DEBUG_CPU_WRITE ${hex8(a)} pc ${hex8(ctx.pc())}`); throw BUS; } } });
    setStub(this);
  }
  dget(o) { return this.d32[o >> 2]; }
  dset(o, v) { this.d32[o >> 2] = v; }
  allowed(addr, size) {
    for (let i = 0; i < NALLOW; i++) {
      const e = ALLOW + i * 12, base = this.dget(e), len = this.dget(e + 4);
      if ((this.dget(e + 8) & 1) && addr >= base && addr + size <= base + len) return true;
    }
    return false;
  }
  log(addr, value, size, flags) {
    const n = this.dget(8), e = RING + (n % CAP) * 16;
    this.dset(e, ctx.pc()); this.dset(e + 4, addr); this.dset(e + 8, value); this.dset(e + 12, size | flags);
    this.dset(8, n + 1);
    if (flags & 0x20) {
      this.dset(12, this.dget(12) + 1);
      this.m.stderr(`om-emu: lab-stub DENIED ${(flags & 0x10) ? 'write' : 'read'} ${hex8(addr)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    }
  }
  read(addr, size, dbg) {
    if (!this.allowed(addr, size)) {
      if (!dbg) this.log(addr, 0, size, 0x20);
      throw BUS;
    }
    for (let i = 0; i < NPRESET; i++) {
      const e = PRESET + i * 16;
      if ((this.dget(e + 12) & 1) && this.dget(e) === addr) {
        const v = this.dget(e + 4), data = size === 4 ? v : size === 2 ? v & 0xffff : v & 0xff;
        if (!dbg) { this.dset(e + 4, v ^ this.dget(e + 8)); this.log(addr, data, size, 0x40); }
        return data;
      }
    }
    let v = 0, unwritten = true;
    for (let i = 0; i < size; i++) {
      const b = this.store.get((addr + i) >>> 0);
      if (b !== undefined) { v |= b << (8 * i); unwritten = false; }
    }
    v >>>= 0;
    if (!dbg) this.log(addr, v, size, unwritten ? 0x80 : 0);
    return v;
  }
  write(addr, value, size, dbg) {
    if (dbg) throw BUS;
    if (!this.allowed(addr, size)) { this.log(addr, value, size, 0x10 | 0x20); throw BUS; }
    let hit = false;
    for (let i = 0; i < NPRESET; i++) {
      const e = PRESET + i * 16, fl = this.dget(e + 12);
      if ((fl & 1) && this.dget(e) === addr) {
        if (fl & 2) this.dset(e + 4, this.dget(e + 4) & ~value);
        else if (fl & 4) this.dset(e + 4, value);
        hit = true;
      }
    }
    for (let i = 0; i < size; i++) this.store.set((addr + i) >>> 0, (value >>> (8 * i)) & 0xff);
    this.log(addr, value, size, 0x10 | (hit ? 0x40 : 0));
  }
}
