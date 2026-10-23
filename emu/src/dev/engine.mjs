// OM-1 OSD draw engine (MMIO 0x9BC00000), strict model, and its lab debug window 0x8E000000.
// Commands run synchronously inside the CPU store to the start register; their host time is counted as
// engine time (machine stats.engineMs).
import { BUS, K_MMIO, K_ROMD, addRegion, allocWindow, buf, U8, ctx } from '../core/mem.mjs';
import { IRQ_OSD_ENGINE } from './intc.mjs';
import { BOARD } from '../fw/board.mjs';

// the model's engine (src/fw/board.mjs; E144: base 0x9c100000, registers 0x00..0x50 only, the list base a byte
// address, 16 guard slots: the first 8 at 0x040, the rest at 0x8000)
const BE = BOARD.engine, ENC2 = BE.enc === 2;
// Kind-2 command words (E144, D: the builders at 0x50ca50c3, 0x50ca51fc, 0x50ca54c6, 0x50ca5545): the high bits of an
// address are bits 29..30 of the engine's 31-bit bus address, a destination's at w0 bits 29..30 unshifted, a copy
// source's at w0 bits 26..27; the bus address is the CPU's uncached one without bit 31 (0x2fca0000 for 0xafca0000)
const hiDst = (w0, at) => (ENC2 ? (w0 & 0x60000000) : ((w0 >>> at) & 7) << 29) >>> 0;
const hiSrc = (w0) => (ENC2 ? ((w0 >>> 26) & 3) << 29 : ((w0 >>> 24) & 7) << 29) >>> 0;
const bus = (a) => (ENC2 ? (a | 0x80000000) : a) >>> 0;
export const ENGINE_BASE = BE.base, ENGINE_SIZE = 0x1000, DEBUG_BASE = 0x8E000000, DEBUG_SIZE = 0x10000;
const E = { REG_UNKNOWN: 1, REG_READ_UNUSED: 2, START_MODE: 3, TRIGGER: 4, FIFO_OVERFLOW: 5, LIST_NO_END: 6,
  OPCODE_UNKNOWN: 7, OPCODE_UNMODELED: 8, WORD_BITS: 9, DEPTH: 10, COLOR_HIGH: 11, SIZE_4096: 12, DMA_RANGE: 13,
  GUARD: 14, COPY_OVERLAP: 15, BMP_FORMAT: 16, BMP_SCALE: 17, BMP_LUT: 18, BMP_TOKEN: 19, BMP_TRANSPARENCY: 20,
  SEQUENCE: 21, DEBUG_CPU_WRITE: 22 };
const NAMES = [];
for (const [k, v] of Object.entries(E)) NAMES[v] = k;
const D = { MAGIC: 0x000, VERSION: 0x004, ERR_TOTAL: 0x008, IRQ_LINE: 0x00C, STATUS: 0x010, ENABLE: 0x014,
  STARTS: 0x018, CMDS_EXECUTED: 0x01C, FIFO_WORDS: 0x020, LUT_ADDR: 0x024, CPU_REG_ACCESSES: 0x028, EXEC_TOTAL: 0x02C,
  KEY_MODE: 0x030, KEY_HITS: 0x034, GUARD: 0x040, GUARDS: BE.guards, GUARD_HI: 0x8000, ERR_RING: 0x100, ERR_SLOTS: 64, EXEC_LOG: 0x1000,
  EXEC_SLOTS: 256 };
const FIFO_SOURCE = 0xF1F0, LIST_LIMIT = 0x10000, END_WORD = 0xff;
const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');

export class Engine {
  constructor(machine, bus, intc) {
    this.m = machine; this.bus = bus; this.intc = intc;
    intc.drive(IRQ_OSD_ENGINE);
    this.regs = new Uint32Array(0x100 / 4);
    this.fifo = new Uint32Array(32); this.fifoCount = 0;
    this.lut = new Uint8Array(256); this.lutValid = false;
    this.failArg = 0; this.failValue = 0;
    const off = allocWindow(DEBUG_SIZE);
    this.d32 = new Uint32Array(buf, off, DEBUG_SIZE / 4);
    this.dset(D.MAGIC, 0x4544534F); this.dset(D.VERSION, 2);
    addRegion({ base: DEBUG_BASE, size: DEBUG_SIZE, kind: K_ROMD, off, name: 'om1.lab-osd-debug',
      dev: { romdWrite: (a, v) => { this.recordError(E.DEBUG_CPU_WRITE, a, v, null, 0); throw BUS; } } });
    addRegion({ base: ENGINE_BASE, size: ENGINE_SIZE, kind: K_MMIO, name: 'om1.osd-engine',
      dev: { read: (a, w, dbg) => this.read(a - ENGINE_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - ENGINE_BASE, v, w, dbg) } });
    this.updateLine();
  }
  dget(o) { return this.d32[o >> 2]; }
  dset(o, v) { this.d32[o >> 2] = v; }
  dinc(o) { this.d32[o >> 2]++; }
  recordError(code, arg, value, words, n) {
    const total = this.dget(D.ERR_TOTAL), slot = D.ERR_RING + (total % D.ERR_SLOTS) * 32, pc = ctx.pc();
    const rec = [code, pc, arg, value, 0, 0, 0, 0];
    for (let i = 0; i < 4 && i < n; i++) rec[4 + i] = words[i];
    for (let i = 0; i < 8; i++) this.dset(slot + 4 * i, rec[i]);
    this.dset(D.ERR_TOTAL, total + 1);
    let line = `om-emu: osd-engine ERROR ${NAMES[code]} pc 0x${hex8(pc)} arg 0x${hex8(arg)} value 0x${hex8(value)} words`;
    for (let i = 0; i < n; i++) line += ' ' + hex8(words[i]);
    this.m.stderr(line);
  }
  recordExec(source, w, n, result) {
    const total = this.dget(D.EXEC_TOTAL), slot = D.EXEC_LOG + (total % D.EXEC_SLOTS) * 64;
    const rec = new Uint32Array(16);
    rec[0] = total; rec[1] = source; rec[2] = n; rec[3] = result;
    for (let i = 0; i < 9 && i < n; i++) rec[4 + i] = w[i];
    for (let i = 0; i < 16; i++) this.dset(slot + 4 * i, rec[i]);
    this.dset(D.EXEC_TOTAL, total + 1);
  }
  fail(code, arg, value) { this.failArg = arg >>> 0; this.failValue = value >>> 0; return code; }
  updateLine() {
    const st = this.regs[1], en = this.regs[2], line = ((st & en & 3) >>> 0) !== 0;
    this.dset(D.STATUS, st); this.dset(D.ENABLE, en); this.dset(D.FIFO_WORDS, this.fifoCount);
    this.dset(D.IRQ_LINE, line ? 1 : 0);
    this.intc.setLine(IRQ_OSD_ENGINE, line);
  }
  // ---- bus master
  guarded(addr, stride, w, h) {
    addr >>>= 0;
    for (let g = 0; g < D.GUARDS; g++) {
      const off = g < 8 ? D.GUARD + 16 * g : D.GUARD_HI + 16 * (g - 8);
      const base = this.dget(off), gstride = this.dget(off + 4), height = this.dget(off + 8), flags = this.dget(off + 12);
      if (!(flags & 1) || !gstride || stride !== gstride || addr < base) continue;
      const rel = addr - base;
      if (rel % gstride + w <= gstride && Math.floor(rel / gstride) + h <= height) return true;
    }
    return false;
  }
  // ---- commands
  cmdFill(w) {
    const extra = (w[0] & ~(0xFFFF | 1 << 16 | 1 << 17 | 1 << 20 | (ENC2 ? 3 << 29 : 7 << 24))) >>> 0;
    if (extra) return this.fail(E.WORD_BITS, 0, extra);
    if (w[3] & (1 << 22)) return this.fail(E.WORD_BITS, 3, w[3]);
    const depth = (w[0] >>> 8) & 0xff;
    if (depth !== 3 || (w[2] & 7)) return this.fail(E.DEPTH, depth, w[2] & 7);
    if (w[1] > 0xff) return this.fail(E.COLOR_HIGH, 0, w[1]);
    const wm1 = sizeM1(w[3] >>> 11, w[0], 17), hm1 = sizeM1(w[3], w[0], 16);
    if (wm1 === 0xfff || hm1 === 0xfff) return this.fail(E.SIZE_4096, wm1, hm1);
    const width = wm1 + 1, height = hm1 + 1;
    const stride = (((w[3] >>> 23) & 0x1ff) | ((w[0] >>> 20) & 1) << 9) << 7;
    const dst = bus(hiDst(w[0], 24) | (w[2] >>> 3));
    if (!this.guarded(dst, stride, width, height)) return this.fail(E.GUARD, dst, stride);
    if (!this.bus.span(dst, rectSpan(stride, width, height))) return this.fail(E.DMA_RANGE, dst, stride);
    const row = new Uint8Array(width).fill(w[1]);
    for (let y = 0; y < height; y++) this.bus.write(dst + y * stride, row);
    return 0;
  }
  cmdCopy(w) {
    const extra = (w[0] & ~(0xFFFF | 1 << 16 | 1 << 17 | 1 << 20 | 1 << 21 | (ENC2 ? 3 << 26 | 3 << 29 : 7 << 24 | 7 << 28))) >>> 0;
    if (extra) return this.fail(E.WORD_BITS, 0, extra);
    if (w[2] & (1 << 22)) return this.fail(E.WORD_BITS, 2, w[2]);
    if (w[4] & 0x7FFFFF) return this.fail(E.WORD_BITS, 4, w[4]);
    const depth = (w[0] >>> 8) & 0xff;
    if (depth !== 3 || (w[1] & 7) || (w[3] & 7)) return this.fail(E.DEPTH, depth, (w[1] & 7) << 4 | (w[3] & 7));
    const wm1 = sizeM1(w[2] >>> 11, w[0], 17), hm1 = sizeM1(w[2], w[0], 16);
    if (wm1 === 0xfff || hm1 === 0xfff) return this.fail(E.SIZE_4096, wm1, hm1);
    const width = wm1 + 1, height = hm1 + 1;
    const sstride = (((w[2] >>> 23) & 0x1ff) | ((w[0] >>> 20) & 1) << 9) << 7;
    const dstride = (((w[4] >>> 23) & 0x1ff) | ((w[0] >>> 21) & 1) << 9) << 7;
    const src = bus(hiSrc(w[0]) | (w[1] >>> 3));
    const dst = bus(hiDst(w[0], 28) | (w[3] >>> 3));
    if (!this.guarded(src, sstride, width, height)) return this.fail(E.GUARD, src, sstride);
    if (!this.guarded(dst, dstride, width, height)) return this.fail(E.GUARD, dst, dstride);
    if (!this.bus.span(src, rectSpan(sstride, width, height))) return this.fail(E.DMA_RANGE, src, sstride);
    if (!this.bus.span(dst, rectSpan(dstride, width, height))) return this.fail(E.DMA_RANGE, dst, dstride);
    if (rectsMeet(src, sstride, dst, dstride, width, height)) return this.fail(E.COPY_OVERLAP, src, dst);
    const row = new Uint8Array(width);
    for (let y = 0; y < height; y++) { this.bus.read(src + y * sstride, row); this.bus.write(dst + y * dstride, row); }
    return 0;
  }
  cmdLut(w) {
    if (w[0] !== 0x40) return this.fail(E.WORD_BITS, 0, w[0]);
    if (w[1] >>> 26) return this.fail(E.WORD_BITS, 1, w[1]);
    const addr = bus((w[1] << 6) >>> 0);
    if (!this.bus.span(addr, 256)) return this.fail(E.DMA_RANGE, addr, 256);
    this.bus.read(addr, this.lut);
    this.lutValid = true;
    this.dset(D.LUT_ADDR, addr);
    return 0;
  }
  cmdBitmap(w, n) {
    const extra = (w[0] & ~(0xFF | 7 << 8 | 1 << 11 | 1 << 12 | 1 << 13 | 1 << 14 | 1 << 20 | (ENC2 ? 3 << 29 : 1 << 26 | 7 << 28))) >>> 0;
    if (extra) return this.fail(E.WORD_BITS, 0, extra);
    if (!ENC2 && ((w[0] >>> 26) & 1) !== w[1] >>> 31) return this.fail(E.WORD_BITS, 1, w[0]);
    if (w[3] & ~0x3FE) return this.fail(E.WORD_BITS, 3, w[3]);
    if (w[0] & 0x6000) return this.fail(E.BMP_SCALE, w[0], n > 4 ? w[4] : 0);
    const depth = (w[0] >>> 8) & 7;
    if (depth !== 3 || (w[2] & 7)) return this.fail(E.DEPTH, depth, w[2] & 7);
    const src = bus(w[1] >>> 0);
    if (!this.bus.span(src, 4)) return this.fail(E.DMA_RANGE, src, 4);
    const hdr = new Uint8Array(4);
    this.bus.read(src, hdr);
    const lines = (hdr[0] | (hdr[1] & 0xF) << 8) + 1, width = (hdr[1] >> 4 | hdr[2] << 4) + 1, fmt = hdr[3];
    let bits, runbits, perWord;
    switch (fmt) {
      case 0x02: case 0x0A: bits = 8; runbits = 4; perWord = 0; break;
      // a 2-bit colour index over a 6-bit run, through the inline table's first four entries: in E140's resource
      // block 7419 places with format 9 decode so to exactly width x lines, 7379 of them up to the next bitmap's
      // header (X, a byte scan; the E144 family's blocks hold 4300-7700 each, the E143 family's none), and E140's
      // AF frame draws them with the table [0, 0x21, 0x20, 0x1f] (D). None is wider than 32 or has a run over 32,
      // so that bit 5 is the run's and not the colour's is I
      case 0x09: bits = 8; runbits = 6; perWord = 0; break;
      case 0x03: bits = 10; runbits = 2; perWord = 6; break;
      case 0x0B: bits = 12; runbits = 4; perWord = 5; break;
      default: return this.fail(E.BMP_FORMAT, src, (hdr[0] | hdr[1] << 8 | hdr[2] << 16 | hdr[3] << 24) >>> 0);
    }
    const lut = (w[0] & 0x800) !== 0, inlineLut = (w[0] & 0x1000) !== 0;
    const map = new Uint8Array(256);
    if (bits === 8) {
      if (!lut || !inlineLut) return this.fail(E.BMP_LUT, w[0], fmt);
      for (let i = 0; i < 16; i++) map[i] = w[4 + (i >> 2)] >>> (8 * (i % 4));
    } else if (inlineLut) {
      return this.fail(E.BMP_LUT, w[0], fmt);
    } else if (lut) {
      if (!this.lutValid) return this.fail(E.BMP_LUT, w[0], fmt);
      map.set(this.lut);
    } else {
      for (let i = 0; i < 256; i++) map[i] = i;
    }
    const stride = (((w[3] >>> 1) & 0x1ff) | ((w[0] >>> 20) & 1) << 9) << 7;
    const dst = bus(hiDst(w[0], 28) | (w[2] >>> 3));
    if (!this.guarded(dst, stride, width, lines)) return this.fail(E.GUARD, dst, stride);
    if (!this.bus.span(dst, rectSpan(stride, width, lines))) return this.fail(E.DMA_RANGE, dst, stride);
    const total = width * lines;
    const need = perWord ? Math.floor((total + perWord - 1) / perWord) * 8 : total;
    const avail = Math.min(need, this.bus.left(src + 4));
    const data = new Uint8Array(avail + 8), px = new Uint8Array(total);
    let code = 0;
    this.bus.read(src + 4, data, 0, avail);
    const dv = new DataView(data.buffer);
    let count = 0, pos = 0;
    const mask = 2 ** bits - 1, runmask = (1 << runbits) - 1;
    while (count < total && !code) {
      const tokens = perWord ? perWord : 1;
      let used = 0;
      // the 64-bit word as two halves (tokens of 10 or 12 bits straddle bit 32)
      const lo = perWord ? dv.getUint32(pos, true) : data[pos], hi = perWord ? dv.getUint32(pos + 4, true) : 0;
      for (; used < tokens && count < total; used++) {
        const end = pos + (perWord ? Math.floor((bits * (used + 1) + 7) / 8) : 1);
        if (end > avail) { code = this.fail(E.DMA_RANGE, src + 4 + pos, avail); break; }
        const t = field64(lo, hi, bits * used, bits) & mask;
        const run = (t & runmask) + 1, col = count % width;
        if (col + run > width) { code = this.fail(E.BMP_TOKEN, src + 4 + pos, t); break; }
        px.fill(t >>> runbits, count, count + run);
        count += run;
      }
      if (!code && perWord && used === tokens && (hi >>> 28)) code = this.fail(E.BMP_TOKEN, src + 4 + pos, hi);
      pos += perWord ? 8 : 1;
    }
    const keyMode = this.dget(D.KEY_MODE), skipKeys = keyMode === 1, refuse = keyMode !== 1 && keyMode !== 2;
    let hit = false;
    const row = new Uint8Array(width);
    for (let y = 0; y < lines && !hit && !code; y++) {
      this.bus.read(dst + y * stride, row);
      for (let x = 0; x < width; x++) {
        const idx = px[y * width + x], v = map[idx];
        if ((idx === 0 || v === 0) && row[x] !== v) {
          hit = true;
          if (refuse) code = this.fail(E.BMP_TRANSPARENCY, dst + y * stride + x, row[x]);
          break;
        }
      }
    }
    if (hit) this.dinc(D.KEY_HITS);
    for (let y = 0; y < lines && !code; y++) {
      if (skipKeys) this.bus.read(dst + y * stride, row);
      for (let x = 0; x < width; x++) {
        const idx = px[y * width + x], v = map[idx];
        if (!(skipKeys && (idx === 0 || v === 0))) row[x] = v;
      }
      this.bus.write(dst + y * stride, row);
    }
    return code;
  }
  execute(source, w, n) {
    let code;
    this.failArg = this.failValue = 0;
    switch (w[0] & 0xff) {
      case 0x10: code = this.cmdFill(w); break;
      case 0x20: code = this.cmdCopy(w); break;
      case 0x30: code = this.cmdBitmap(w, n); break;
      case 0x40: code = this.cmdLut(w); break;
      default: code = this.fail(E.OPCODE_UNMODELED, source, w[0]); break;
    }
    if (code) this.recordError(code, this.failArg, this.failValue, w, n);
    else this.dinc(D.CMDS_EXECUTED);
    this.recordExec(source, w, n, code);
  }
  runList() {
    const base = (this.regs[0x18 / 4] << BE.list_shift) >>> 0, words = new Uint32Array(9), b = new Uint8Array(36);
    for (let off = 0; off < LIST_LIMIT;) {
      const at = (base + off) >>> 0;
      if (!this.bus.span(at, 4)) { this.recordError(E.DMA_RANGE, at, base, null, 0); return; }
      this.bus.read(at, b, 0, 4);
      words[0] = le32(b, 0);
      const n = commandLength(words[0]);
      if (!n) { this.recordError(E.OPCODE_UNKNOWN, at, words[0], words, 1); return; }
      if ((words[0] & 0xff) === 0xff) {
        if (words[0] !== END_WORD) this.recordError(E.WORD_BITS, at, words[0], words, 1);
        return;
      }
      if (off + 4 * n > LIST_LIMIT || !this.bus.span(at, 4 * n)) { this.recordError(E.DMA_RANGE, at, n, words, 1); return; }
      this.bus.read(at, b, 0, 4 * n);
      for (let i = 0; i < n; i++) words[i] = le32(b, 4 * i);
      this.execute(at, words, n);
      off += 4 * n;
    }
    this.recordError(E.LIST_NO_END, base, LIST_LIMIT, null, 0);
  }
  runFifo() {
    const f = Uint32Array.from(this.fifo), count = this.fifoCount;
    let i = 0, ended = false;
    this.fifoCount = 0;
    while (i < count) {
      if (ended) {
        if (f[i]) { this.recordError(E.SEQUENCE, i, f[i], f.subarray(i), 1); return; }
        i++; continue;
      }
      const n = commandLength(f[i]);
      if (!n) { this.recordError(E.OPCODE_UNKNOWN, i, f[i], f.subarray(i), 1); return; }
      if (i + n > count) { this.recordError(E.SEQUENCE, i, count, f.subarray(i), count - i); return; }
      if ((f[i] & 0xff) === 0xff) {
        if (f[i] !== END_WORD) { this.recordError(E.WORD_BITS, i, f[i], f.subarray(i), 1); return; }
        ended = true;
      } else {
        this.execute(FIFO_SOURCE, f.subarray(i), n);
      }
      i += n;
    }
    if (!ended) this.recordError(E.SEQUENCE, count, 0, null, 0);
  }
  // ---- registers
  read(off, size, dbg) {
    if (size !== 4 || !knownOffset(off)) {
      if (!dbg) this.recordError(E.REG_UNKNOWN, ENGINE_BASE + off, size, null, 0);
      throw BUS;
    }
    const data = this.regs[off >> 2];
    if (!dbg) {
      this.dinc(D.CPU_REG_ACCESSES);
      if (!cpuReadable(off)) this.recordError(E.REG_READ_UNUSED, ENGINE_BASE + off, data, null, 0);
    }
    return data;
  }
  write(off, value, size, dbg) {
    if (dbg) throw BUS;
    this.dinc(D.CPU_REG_ACCESSES);
    if (size !== 4 || !knownOffset(off)) {
      this.recordError(E.REG_UNKNOWN, ENGINE_BASE + off, value, null, 0);
      throw BUS;
    }
    switch (off) {
      case 0x04: this.regs[1] = (this.regs[1] & ~value) >>> 0; break;
      case 0x28:
        if (this.fifoCount >= 32) this.recordError(E.FIFO_OVERFLOW, this.fifoCount, value, [value], 1);
        else this.fifo[this.fifoCount++] = value;
        break;
      case 0x2C: this.regs[off >> 2] = value; if (value === 1) this.fifoCount = 0; break;
      case 0x24:
        this.regs[off >> 2] = value;
        if (value === 1 || value === 2) {
          this.dinc(D.STARTS);
          const t0 = this.m.clock();
          if (value === 1) this.runList(); else this.runFifo();
          this.m.stats.engineMs += this.m.clock() - t0;
          this.regs[1] |= 1;
        } else if (value) {
          this.recordError(E.START_MODE, value, 0, null, 0);
        }
        break;
      case 0x30:
        this.regs[off >> 2] = value;
        if (value) this.recordError(E.TRIGGER, value, 0, null, 0);
        break;
      default: this.regs[off >> 2] = value; break;
    }
    this.updateLine();
  }
}
function sizeM1(lo11, w0, bit) { return (lo11 & 0x7ff) | ((w0 >>> bit) & 1) << 11; }
function rectSpan(stride, w, h) { return (h - 1) * stride + w; }
function rectsMeet(a, as, b, bs, w, h) {
  const aEnd = a + rectSpan(as, w, h), bEnd = b + rectSpan(bs, w, h);
  if (aEnd <= b || bEnd <= a) return false;
  if (as !== bs) return true;
  const d = b - a, s = as;
  const q = d >= 0 ? Math.floor(d / s) : -Math.floor((-d + s - 1) / s);
  const r = d - q * s;
  return (r < w && Math.abs(q) < h) || (s - r < w && Math.abs(q + 1) < h);
}
// bits [start, start + n) of the little-endian 64-bit value hi:lo, n <= 12
function field64(lo, hi, start, n) {
  if (start >= 32) return hi >>> (start - 32);
  if (start + n <= 32) return lo >>> start;
  return (lo >>> start) | (hi << (32 - start));
}
function commandLength(w0) {
  switch (w0 & 0xff) {
    case 0x10: return 4;
    case 0x20: return 5;
    case 0x30: return 4 + ((w0 & 0x6000) ? 1 : 0) + ((w0 & 0x1000) ? 4 : 0);
    case 0x40: case 0x41: return 2;
    case 0x60: return 5;
    case 0xff: return 1;
    default: return 0;
  }
}
function knownOffset(off) {
  if (off & 3) return false;
  switch (off) {
    case 0x00: case 0x04: case 0x08: case 0x0C: case 0x18: case 0x1C: case 0x20: case 0x24: case 0x28: case 0x2C:
    case 0x30: case 0x34: case 0x38: case 0x3C: case 0x40: case 0x44: case 0x48: case 0x4C: case 0x50: return true;
    case 0x5C: case 0x60: case 0x64: case 0x68: case 0x6C: return BE.lut;
  }
  return BE.lut && off >= 0x88 && off < 0x100 && ((off - 0x88) & 0x1f) < 0x18;
}
function cpuReadable(off) { return off === 0x00 || off === 0x04 || off === 0x5C || off === 0x88 || off === 0xA8 || off === 0xC8 || off === 0xE8; }
function le32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }
