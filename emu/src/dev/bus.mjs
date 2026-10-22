// OM-Emu's DMA bus "om1.bus" as the OSD engine sees it, and its backed ranges:
// 0xA0000000 + DRAM size = the lab DRAM, and the two live-view bank ranges, RAM allocated lazily (zero until written).
// The CPU window 0xB8000000..0xBFFFFFFF and its register 0x98100058 (A17): the window aliases om1.bus at (byte 3 of the
// register) << 27, re-pointed by every valid CPU store to the register (a debugger store is refused). Its reads, bad
// offsets, widths and values are printed bus errors. A remap re-points the window's 64 KiB pages (mem.mjs remapPages):
// pages of bus DRAM become a RAM alias of the DRAM (loads, stores, debugger accesses and code fetch at RAM speed,
// stores into code invalidate through the physical offset); the rest stay on the window device, which serves CPU
// accesses of width 1, 2 and 4 onto a live-view range as RAM accesses (an alias of a RAM region: no I/O, no TB
// end), an unbacked range as a bus error (fault 2, an unassigned access), debugger reads and writes onto backed ranges
// in bulk (a read that meets an unbacked range fails, E14; a write skips it), and refuses a
// code fetch from a live-view range (Unported). At every remap the machine drops the decode-cache slots of window pcs
// (onRemap) and the next TB start is a main-loop visit that looks at a pending interrupt (S.exitReq, interp.mjs).
import { Unported, BUS, K_MMIO, K_RAM, addRegion, remapPages, ioMark, U8, DRAM_OFF, DRAM_SIZE, invalidateRange, markDirty, ctx } from '../core/mem.mjs';

export const BUS_DRAM = 0xA0000000;
const LV = [[0x95F6C000, 0xA0000000], [0xEE087000, 0xF533A000]];

const WINREG = 0x98100000, WINREG_OFF = 0x58, WINREG_RESET = 0x17161514, WINDOW = 0xB8000000, WINDOW_SIZE = 0x08000000;
const SEGMENT = 2 ** 27, PAGE = 0x10000;
const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
export class Bus {
  constructor(machine = null) {
    this.m = machine;
    this.winreg = WINREG_RESET;
    this.base = [BUS_DRAM, LV[0][0], LV[1][0]];
    this.size = [DRAM_SIZE, LV[0][1] - LV[0][0], LV[1][1] - LV[1][0]];
    this.lvPages = new Map();                 // 4 KiB page number -> Uint8Array
    this.onRemap = null;                      // the machine's: (segment) after every remap
    addRegion({ base: WINREG, size: 0x1000, kind: K_MMIO, name: 'om1.buswin',
      dev: { read: (a, w, dbg) => this.winregRead(a - WINREG, w, dbg), write: (a, v, w, dbg) => this.winregWrite(a - WINREG, v, w, dbg) } });
    this.windowDev = {
      read: (a, w, dbg) => this.windowRead(a, w, dbg),
      write: (a, v, w, dbg) => this.windowWrite(a, v, w, dbg),
      dbgRead: (a, n) => this.windowDbgRead(a, n),
      dbgWrite: (a, bytes) => this.windowDbgWrite(a, bytes),
      fetch: (a) => this.windowFetch(a),
    };
    this.remap();
  }
  // the window register's read and write
  unknown(kind, off, size, value, dbg, why = '') {
    if (!dbg && this.m) this.m.stderr(`om-emu: buswin UNKNOWN ${kind} 0x${hex8(WINREG + off)} size ${size} value 0x${hex8(value)} pc 0x${hex8(ctx.pc())}${why}`);
    throw BUS;
  }
  winregRead(off, size, dbg) {
    if (size !== 4 || off !== WINREG_OFF) this.unknown('read', off, size, 0, dbg);
    return this.winreg;
  }
  winregWrite(off, value, size, dbg) {
    if (dbg) throw BUS;
    if (size !== 4 || off !== WINREG_OFF) this.unknown('write', off, size, value, dbg);
    if ((value & 0xFFFFFF) !== (WINREG_RESET & 0xFFFFFF)) this.unknown('write', off, size, value, dbg, ' (bytes 0..2 other than 14 15 16)');
    const seg = this.winreg >>> 24;
    this.winreg = value >>> 0;
    // a store of the offset the window already has changes nothing: no remap, no kick
    if (value >>> 24 === seg) return;
    this.remap();
    if (this.onRemap) this.onRemap(value >>> 24);
  }
  // memory_region_set_alias_offset(window, segment << 27): the window's pages re-pointed
  remap() {
    const segBase = this.segBase(), n = WINDOW_SIZE / PAGE, regions = [];
    const dramPage = (k) => { const b = segBase + k * PAGE; return b >= BUS_DRAM && b + PAGE <= BUS_DRAM + DRAM_SIZE; };
    for (let k = 0; k < n;) {
      const dram = dramPage(k);
      let j = k + 1;
      while (j < n && dramPage(j) === dram) j++;
      const base = WINDOW + k * PAGE, size = (j - k) * PAGE;
      if (dram) regions.push({ base, size, kind: K_RAM, off: DRAM_OFF + (segBase + k * PAGE - BUS_DRAM), name: 'om1.bus-window (bus DRAM)' });
      else regions.push({ base, size, kind: K_MMIO, ram: true, name: 'om1.bus-window', dev: this.windowDev });
      k = j;
    }
    remapPages(WINDOW, WINDOW_SIZE, regions);
  }
  // the bus address of the window's first byte, and the one a CPU window address shows (beyond 4 GiB for segments
  // 0x20..0xff: unbacked)
  segBase() { return (this.winreg >>> 24) * SEGMENT; }
  busOf(a) { return this.segBase() + ((a >>> 0) - WINDOW); }
  windowRead(a, w, dbg) {
    const b = this.busOf(a);
    if (!(b < 2 ** 32 && this.span(b, w))) { if (!dbg) ioMark(); throw BUS; }      // unassigned: an I/O access, fault 2
    const t = new Uint8Array(4);
    this.read(b, t, 0, w);
    return (t[0] | t[1] << 8 | t[2] << 16 | t[3] << 24) >>> 0;
  }
  windowWrite(a, v, w, dbg) {
    const b = this.busOf(a);
    if (dbg || !(b < 2 ** 32 && this.span(b, w))) { if (!dbg) ioMark(); throw BUS; }
    this.write(b, new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]), 0, w);
  }
  // cpu_memory_rw_debug, per 4 KiB page: a read fails (E14) when any byte lies on an unbacked bus range
  windowDbgRead(a, n) {
    const b = this.busOf(a);
    if (!(b + n <= 2 ** 32)) return null;
    for (let i = 0; i < n;) {
      const k = Math.min(n - i, 4096 - ((b + i) % 4096));
      if (!this.span(b + i, k)) return null;
      i += k;
    }
    const out = new Uint8Array(n);
    this.read(b, out, 0, n);
    return out;
  }
  // address_space_write_rom: the backed pieces are stored, the rest skipped
  windowDbgWrite(a, bytes) {
    const b = this.busOf(a);
    for (let i = 0; i < bytes.length;) {
      const k = Math.min(bytes.length - i, 4096 - ((b + i) % 4096));
      if (b + i + k <= 2 ** 32 && this.span(b + i, k)) this.write(b + i, bytes, i, k);
      i += k;
    }
  }
  // a code fetch through the window outside bus DRAM: a live-view range, not modelled here
  windowFetch(a) {
    const b = this.busOf(a);
    if (b < 2 ** 32 && this.span(b, 1)) throw new Unported(`bus window: code fetch onto a live-view range (CPU 0x${hex8(a)}, bus 0x${hex8(b)})`);
    return -1;
  }
  // addr .. addr + len - 1 inside one backed range
  span(addr, len) {
    addr >>>= 0;
    for (let i = 0; i < 3; i++) if (addr >= this.base[i] && (addr - this.base[i]) + len <= this.size[i]) return true;
    return false;
  }
  left(addr) {
    addr >>>= 0;
    for (let i = 0; i < 3; i++) if (addr >= this.base[i] && addr - this.base[i] < this.size[i]) return this.size[i] - (addr - this.base[i]);
    return 0;
  }
  // address_space_read / write on om1.bus of a range the caller checked with span() (or left()).
  read(addr, out, at = 0, len = out.length - at) {
    addr >>>= 0;
    if (addr >= BUS_DRAM && addr - BUS_DRAM < DRAM_SIZE) {
      const o = DRAM_OFF + (addr - BUS_DRAM);
      out.set(U8.subarray(o, o + len), at);
      return;
    }
    for (let i = 0; i < len; ) {
      const a = addr + i, page = Math.floor(a / 4096), po = a % 4096, n = Math.min(len - i, 4096 - po);
      const p = this.lvPages.get(page);
      if (p) out.set(p.subarray(po, po + n), at + i); else out.fill(0, at + i, at + i + n);
      i += n;
    }
  }
  write(addr, data, at = 0, len = data.length - at) {
    addr >>>= 0;
    if (addr >= BUS_DRAM && addr - BUS_DRAM < DRAM_SIZE) {
      const o = DRAM_OFF + (addr - BUS_DRAM);
      U8.set(data.subarray(at, at + len), o);
      markDirty(o, len);
      invalidateRange(o, len);
      return;
    }
    for (let i = 0; i < len; ) {
      const a = addr + i, page = Math.floor(a / 4096), po = a % 4096, n = Math.min(len - i, 4096 - po);
      let p = this.lvPages.get(page);
      if (!p) this.lvPages.set(page, p = new Uint8Array(4096));
      p.set(data.subarray(at + i, at + i + n), po);
      i += n;
    }
  }
}
