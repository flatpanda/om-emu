// OM-1 VSC display compositor (0x9BB80000..0x9BB9FFFF), strict model, and its lab windows:
// the register file (the firmware's name tables, read from the image by vscregs.mjs, plus FACE 0xD00..0xD1C), the
// mirror bank +0x2000, palettes +0x4400 and LUT +0x5C00, the output block, the written/latched/palette flags in the
// debug window, notes and errors, the channel clock on the lab clock (frame boundaries, RUN_TO_FRAME,
// RUN_TO_EVENT), the doorbell with its error paths, and COMPOSE with its IMG planes (vsccompose.mjs, draw_img
// included; kinds 2 and 3: vsccompose2.mjs).
import { MODEL_INFO } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import { BUS, K_MMIO, K_ROMD, addRegion, allocWindow, buf, U8, ctx } from '../core/mem.mjs';
import { CLOCK_NONE } from './timer.mjs';
import { IRQ_VSC } from './intc.mjs';
import { vscTables } from './vscregs.mjs';
import { compose } from './vsccompose.mjs';
import { compose2 } from './vsccompose2.mjs';

// The model's VSC (src/fw/board.mjs). Kind 1 (E143, E147): what this header says. Kind 2 (E144): two channels of
// 0x4000, the register file 0x000..reg_end with the latched copies of some registers named *_VL at +0x400 (read-only;
// the frame boundary latches them), INTST1 at 0x014, the vertical total in SYNC2 (TFT, HDMI) or SYNC8 (EVF), MONI3
// with a 14-bit line count at [13:0] and at [29:16], and plain storage 0x800..0x3fff (palettes, gamma and the serial
// engine's words); no output block. A kind-2 channel runs from the bank whose vertical total the firmware wrote last
// (CH.TIMING, published: 0 SYNC2, 1 SYNC8), at that bank's line time (the harness's CH.LINE_NS, CH.LINE_NS_EVF), and a
// change of bank starts a new frame there (I: the firmware's timing writer stores one of the two per device,
// src/fw/board.mjs; what selects the bank on the chip is ?).
// Kind 3 (the E118 family): kind 2's register file without a name table (the board lists the offsets the family's code
// names, src/dev/vscregs.mjs) and without the EVF bank, two channels of 0x2000, the latched copies of a few registers
// at +vsc.latch (+0x1c00) instead of +0x400, plain storage vsc.store (palettes and tables) below them, the vertical
// total and MONI3's line count in vsc.line_bits bits. Its COMPOSE is kind 2's with the family's palette groups and
// formats (vsccompose2.mjs).
const V = BOARD.vsc, GEN2 = V.kind === 2, K3 = V.kind === 3, LATER = GEN2 || K3;
const LINE_MASK = K3 ? (1 << V.line_bits) - 1 : GEN2 ? 0x3FFF : 0x7FFF;
export const VSC_BASE = V.base, VSC_SIZE = V.size, CHANNELS = V.channels, CHAN_STRIDE = V.stride;
export const REG_WORDS = V.reg_end / 4, PAL_BASE = 0x4400, PAL_WORDS = 0x1800 / 4, LUT_BASE = 0x5C00, LUT_WORDS = 0xC00 / 4;
export const OUT_SRAM = 0x4000, OSRAM_WORDS = 0x1000 / 4;
export const OUTPUT_BASE = 0x89000000, OUTPUT_SIZE = 0x800000;
export const DEBUG_BASE = 0x89800000, DEBUG_SIZE = 0x10000, DOORBELL_BASE = 0x89810000;
export const E = { REG_UNKNOWN: 1, WIDTH: 2, MIRROR_WRITE: 3, MIRROR_LIVE: 4, RO_WRITE: 5, DEBUG_CPU_WRITE: 6, DOORBELL: 7,
  NOT_LATCHED: 8, FIELD_MODE: 9, WINDOW: 10, MIX_UNOBSERVED: 11, PLANC_UNOBSERVED: 12, FMT_UNMODELLED: 13,
  SPOS_UNMODELLED: 14, DMA_FIELD: 15, DMABN_SHORT: 16, DMA_RANGE: 17, RSZ_UNMODELLED: 18, PEAK_BC: 19, BG_FIELD: 20,
  OSDCP2_FIELD: 21, PAL_UNWRITTEN: 22, PAL_FIELD: 23, UNWRITTEN: 24, NOT_RUNNING: 25, ORDER: 26,
  FEATURE_UNOBSERVED: 27 };
const ERROR_NAMES = [];
for (const [k, v] of Object.entries(E)) ERROR_NAMES[v] = k;
export const NOTE = { RESET_READ: 1, MIRROR_RESET_READ: 2, SRAM_RESET_READ: 3, OUT_READ: 4, MONI3_IDLE: 5,
  COMPOSE_RESET: 6, ASSUMED: 7, SPOS_A18: 8, PLANC_ZERO: 9, VIEW: 10 };
export const D = { MAGIC: 0x000, VERSION: 0x004, ERR_TOTAL: 0x008, NOTE_TOTAL: 0x00C, T_LO: 0x010, T_HI: 0x014,
  LAST_CMD: 0x018, LAST_RESULT: 0x01C, ARG0: 0x020, ARG1: 0x024, COMMANDS: 0x028, CPU_ACCESSES: 0x02C,
  EVENT_SOURCES: 0x030, CHAN: 0x040, CHAN_SIZE: 0x40, HDR: 0x100, PLANE: 0x180, ERR_RING: 0x400, ERR_SLOTS: 64,
  NOTE_RING: 0x1000, NOTE_SLOTS: 512, FLAGS: 0x4000, FLAGS_SIZE: 0x1400, OUT_FLAGS: 0x8000 };
export const CH = { RUNNING: 0x00, FRAMES: 0x04, FIELD: 0x08, MONI3: 0x0C, IRQ: 0x10, LINE_NS: 0x14, START_LO: 0x18,
  START_HI: 0x1C, LEN: 0x20, LATCHED: 0x24, COMPOSE: 0x28, LINE_NS_EVF: 0x2C, ORDER: 0x30, ASSUME: 0x38, VIEW: 0x39,
  TIMING: 0x3A };
const CMD_ADVANCE = 1, CMD_RUN_TO_FRAME = 2, CMD_COMPOSE = 3, CMD_CLEAR = 4, CMD_RUN_TO_EVENT = 5;
export const R = V.regs;
// kind 2's storage after the register file and the *_VL mirror words (the copy of the register 0x400 below)
const STORE = K3 ? V.store : [0x800, 0x4000];
// kinds 2 and 3: the plain storage's first local offset (a stored word at offset o is ch.store[(o - STORE_BASE) / 4],
// flagged in the palette flags at that index)
export const STORE_BASE = STORE[0];
const STORE_FLAGGED = K3 ? (V.store[1] - V.store[0]) / 4 : 0xC00, VL = 0x400;
// kind 3's latched copies: [first local offset, the registers that have one]
const LATCH = K3 ? V.latch : null, LATCHED = new Set(K3 ? V.latched : []);
const SERIAL_START = 0x3214, SERIAL_DONE = 0x8000;
export const FACE_FIRST = 0xD00, FACE_LAST = 0xD1C;
export const chanDbg = (c, f) => D.CHAN + D.CHAN_SIZE * c + f;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const hex = (v) => '0x' + (v >>> 0).toString(16);
const liveRegister = (off) => off === R.INTEN1 || off === R.INTST1 || off === R.MONI3 || off === R.INTEN2 || off === R.INTST2;
// floor(a / b) of non-negative integers below 2^53 (uint64 division in the C)
export function udiv(a, b) { let q = Math.floor(a / b); if (q * b > a) q--; return q; }

export class Vsc {
  constructor(machine, clock, intc, bus, image) {
    this.m = machine; this.clock = clock; this.intc = intc; this.bus = bus;
    for (let c = 0; c < CHANNELS; c++) intc.drive(IRQ_VSC(c));
    this.ch = [];
    for (let c = 0; c < CHANNELS; c++) {
      this.ch.push({ w: new Uint32Array(REG_WORDS), m: new Uint32Array(REG_WORDS), pal: new Uint32Array(PAL_WORDS),
        lut: new Uint32Array(LUT_WORDS), running: false, latched: false, field: 0, curLen: 0, frames: 0, frameStart: 0,
        bank: 0 });
    }
    this.ow = new Uint32Array(REG_WORDS); this.osram = new Uint32Array(OSRAM_WORDS);
    this.chanValid = null; this.outValid = null; this.chanRegs = null; this.image = image;
    this.noted = new Set();
    const off = allocWindow(DEBUG_SIZE);
    this.dbg = U8.subarray(off, off + DEBUG_SIZE);
    this.d32 = new Uint32Array(buf, off, DEBUG_SIZE / 4);
    this.dset(D.MAGIC, 0x4D435356); this.dset(D.VERSION, 1);
    for (let c = 0; c < CHANNELS; c++) {
      for (let i = 0; i < 6; i++) this.dbg[chanDbg(c, CH.ORDER) + i] = i;
      this.dbg[chanDbg(c, CH.VIEW)] = 0x3F;
    }
    addRegion({ base: DEBUG_BASE, size: DEBUG_SIZE, kind: K_ROMD, off, name: 'om1.lab-vsc-debug',
      dev: { romdWrite: (a, v) => {
        this.recordError(E.DEBUG_CPU_WRITE, 0, a & 0xFFFF, v, a, 0, 0);
        throw BUS;
      } } });
    const out = allocWindow(OUTPUT_SIZE);
    this.out = new Uint32Array(buf, out, OUTPUT_SIZE / 4);
    addRegion({ base: OUTPUT_BASE, size: OUTPUT_SIZE, kind: K_ROMD, off: out, name: 'om1.lab-vsc-output',
      dev: { romdWrite: (a, v) => { this.recordError(E.DEBUG_CPU_WRITE, 0, 0, v, a, 0, 0); throw BUS; } } });
    addRegion({ base: DOORBELL_BASE, size: 4, kind: K_MMIO, name: 'om1.lab-vsc-doorbell',
      dev: { read: (a, w, dbg) => { if (!dbg) this.recordError(E.DOORBELL, 0, a - DOORBELL_BASE, 0, 0, 0, 0); throw BUS; },
             write: (a, v, w, dbg) => this.doorbell(a - DOORBELL_BASE, v, w, dbg) } });
    addRegion({ base: VSC_BASE, size: VSC_SIZE, kind: K_MMIO, name: 'om1.vsc',
      dev: { read: (a, w, dbg) => this.read(a - VSC_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - VSC_BASE, v, w, dbg) } });
    clock.add({ next: () => this.clockNext(), fire: (at) => this.clockFire(at), publish: () => this.publish() });
    this.publish();
  }
  // The register tables (om1-vsc-regs.h in the C build) are read from the firmware image on first use, so a machine on
  // a bare test image works as long as nothing reaches the VSC register file or COMPOSE.
  tables() {
    if (this.chanValid !== null) return;
    let t;
    try { t = vscTables(this.image); } catch (e) {
      throw new Error(`vsc: the register tables are read from the firmware image, and this machine's image (${this.image.length} bytes) has none: ${e.message}`);
    }
    this.chanValid = new Uint8Array(REG_WORDS); this.outValid = new Uint8Array(REG_WORDS);
    this.chanRegs = t.chan.map(([off]) => off);              // ascending (vscregs.mjs checks)
    for (const off of this.chanRegs) this.chanValid[off / 4] = 1;
    if (!LATER) for (let off = FACE_FIRST; off <= FACE_LAST; off += 4) this.chanValid[off / 4] = 1;
    for (const [off] of t.out) this.outValid[off / 4] = 1;
    // kind 2: the latched copies (2 in chanValid: read-only, the register at off - 0x400)
    if (GEN2) for (const [off, name] of t.chan) if (name.endsWith('_VL')) this.chanValid[off / 4] = 2;
  }
  dget(o) { return this.d32[o >> 2]; }
  dset(o, v) { this.d32[o >> 2] = v; }
  wFlags(c) { return D.FLAGS + D.FLAGS_SIZE * c; }                 // byte offsets in dbg
  mFlags(c) { return D.FLAGS + D.FLAGS_SIZE * c + 0x400; }
  palFlags(c) { return D.FLAGS + D.FLAGS_SIZE * c + 0x800; }

  recordError(code, c, off, value, a0, a1, a2) {
    const total = this.dget(D.ERR_TOTAL), slot = D.ERR_RING + (total % D.ERR_SLOTS) * 32, pc = ctx.pc() >>> 0;
    const rec = [code, pc, c, off, value, a0, a1, a2];
    for (let i = 0; i < 8; i++) this.dset(slot + 4 * i, rec[i] >>> 0);
    this.dset(D.ERR_TOTAL, total + 1);
    this.m.stderr(`om-emu: vsc ERROR ${ERROR_NAMES[code]} pc ${hex8(pc)} ch ${c >>> 0} off 0x${(off >>> 0).toString(16).padStart(4, '0')} value ${hex8(value)} args ${hex(a0)} ${hex(a1)} ${hex(a2)}`);
  }
  noteRecord(kind, c, off, value) {
    const pc = ctx.pc() >>> 0, total = this.dget(D.NOTE_TOTAL), slot = D.NOTE_RING + (total % D.NOTE_SLOTS) * 16;
    this.dset(slot, kind); this.dset(slot + 4, pc); this.dset(slot + 8, ((c << 16) | (off & 0xFFFF)) >>> 0);
    this.dset(slot + 12, value >>> 0);
    this.dset(D.NOTE_TOTAL, total + 1);
  }
  note(kind, c, off, value) {          // de-duplicated per (kind, channel, offset, guest pc) for the machine's life
    const key = `${kind},${c},${off & 0xFFFF},${ctx.pc() >>> 0}`;
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.noteRecord(kind, c, off, value);
  }

  // ---- lab clock
  lineNs(c) { return this.dget(chanDbg(c, GEN2 && this.ch[c].bank === 1 ? CH.LINE_NS_EVF : CH.LINE_NS)); }
  moni3(c) {
    const ch = this.ch[c];
    if (!ch.running || !this.lineNs(c)) return 0;
    const lines = udiv(this.clock.t - ch.frameStart, this.lineNs(c)) % 4294967296;
    if (GEN2) return ((lines & 0x3FFF) | (lines & 0x3FFF) << 16) >>> 0;   // the TFT/HDMI and the EVF counter
    if (K3) return (lines & LINE_MASK) >>> 0;                           // every reader masks the count (src/fw/board.mjs)
    return ((lines & 0x7FFF) | (ch.field === 0 ? 1 << 16 : 0)) >>> 0;
  }
  // the register holding the vertical total: E143 SYNC2; kind 2 that of the channel's bank, SYNC2 or SYNC8 (EVF)
  vreg(c) { return GEN2 && this.ch[c].bank === 1 ? R.SYNC8 : R.SYNC2; }
  publish() {
    const t = this.clock.t;
    this.dset(D.T_LO, t % 4294967296); this.dset(D.T_HI, Math.floor(t / 4294967296));
    for (let c = 0; c < CHANNELS; c++) {
      const ch = this.ch[c], irq = (ch.w[R.INTST1 / 4] & ch.w[R.INTEN1 / 4] & V.irq_mask) !== 0;
      this.dset(chanDbg(c, CH.RUNNING), ch.running ? 1 : 0);
      this.dset(chanDbg(c, CH.FRAMES), ch.frames);
      this.dset(chanDbg(c, CH.FIELD), ch.field);
      this.dset(chanDbg(c, CH.MONI3), this.moni3(c));
      this.dset(chanDbg(c, CH.IRQ), irq ? 1 : 0);
      this.intc.setLine(IRQ_VSC(c), irq);
      this.dset(chanDbg(c, CH.START_LO), ch.frameStart % 4294967296);
      this.dset(chanDbg(c, CH.START_HI), Math.floor(ch.frameStart / 4294967296));
      this.dset(chanDbg(c, CH.LEN), ch.curLen);
      this.dset(chanDbg(c, CH.LATCHED), ch.latched ? 1 : 0);
      if (GEN2) this.dbg[chanDbg(c, CH.TIMING)] = ch.bank;
    }
  }
  // A channel starts running at the current lab time once it has a line time (harness) and a written vertical total.
  chanSync(c) {
    const vr = this.vreg(c), ch = this.ch[c], lines = ch.w[vr / 4] & LINE_MASK;
    if (ch.running && !this.lineNs(c)) ch.running = false;
    if (!ch.running && this.lineNs(c) && this.dbg[this.wFlags(c) + vr / 4] && lines) {
      ch.running = true; ch.frameStart = this.clock.t; ch.field = 0; ch.curLen = lines;
    }
  }
  nextBoundary(c) { const ch = this.ch[c]; return ch.frameStart + ch.curLen * this.lineNs(c); }
  boundary(c, at) {
    this.tables();
    const ch = this.ch[c], wf = this.wFlags(c), mf = this.mFlags(c);
    for (let i = 0; i < REG_WORDS; i++) {
      if (this.chanValid[i] === 1 && !liveRegister(4 * i)) { ch.m[i] = ch.w[i]; this.dbg[mf + i] = this.dbg[wf + i]; }
    }
    ch.latched = true;
    ch.w[R.INTST1 / 4] |= 1;
    ch.frames = (ch.frames + 1) >>> 0;
    ch.frameStart = at;
    // kind 2 has no second-field register (progressive, I)
    const f1 = ch.w[this.vreg(c) / 4] & LINE_MASK, f2 = LATER ? 0 : ch.w[R.SYNC4 / 4] & 0x7FFF;
    if (f2) { ch.field ^= 1; ch.curLen = ch.field ? f2 : f1; } else { ch.field = 0; ch.curLen = f1; }
    if (!ch.curLen || !this.lineNs(c)) ch.running = false;
  }
  clockNext() {
    let at = CLOCK_NONE;
    for (let c = 0; c < CHANNELS; c++) {
      if (this.ch[c].running && this.lineNs(c) && this.nextBoundary(c) < at) at = this.nextBoundary(c);
    }
    return at;
  }
  clockFire(at) {
    for (let c = 0; c < CHANNELS; c++) {
      if (this.ch[c].running && this.lineNs(c) && this.nextBoundary(c) === at) this.boundary(c, at);
    }
  }

  // ---- register file
  sramWord(c, local) {            // [array, index, flag byte offset in dbg] or null
    if (LATER) {                    // kinds 2 and 3: plain storage, flagged in the palette flags while they last
      if (local < STORE[0] || local >= STORE[1]) return null;
      const ch = this.ch[c], i = (local - STORE[0]) / 4;
      ch.store ??= new Uint32Array((STORE[1] - STORE[0]) / 4);
      return [ch.store, i, i < STORE_FLAGGED ? this.palFlags(c) + i : -1];
    }
    if (local >= PAL_BASE && local < PAL_BASE + 4 * PAL_WORDS) {
      const i = (local - PAL_BASE) / 4;
      return [this.ch[c].pal, i, this.palFlags(c) + i];
    }
    if (local >= LUT_BASE && local < LUT_BASE + 4 * LUT_WORDS) {
      const i = (local - LUT_BASE) / 4;
      return [this.ch[c].lut, i, this.palFlags(c) + PAL_WORDS + i];
    }
    // a later model's extra per-channel block (MODEL_INFO.vsc_extra: [byte offset, bytes]): plain storage, no meaning
    // modelled and no debug-window flags (-1)
    const x = MODEL_INFO.vsc_extra;
    if (x && local >= x[0] && local < x[0] + x[1]) {
      const ch = this.ch[c];
      ch.extra ??= new Uint32Array(x[1] / 4);
      return [ch.extra, (local - x[0]) / 4, -1];
    }
    return null;
  }
  read(addr, size, dbg) {
    this.tables();
    const c = Math.floor(addr / CHAN_STRIDE), local = addr % CHAN_STRIDE;
    if (size !== 4 || (addr & 3)) {
      if (!dbg) this.recordError(E.WIDTH, c, local, size, 0, 0, 0);
      throw BUS;
    }
    if (!dbg) this.dset(D.CPU_ACCESSES, this.dget(D.CPU_ACCESSES) + 1);
    if (c === 3 && !LATER) {                         // output block: stored only
      let arr, i, flag;
      const reg = local < 4 * REG_WORDS && this.outValid[local / 4] !== 0;
      if (reg) { arr = this.ow; i = local / 4; flag = D.OUT_FLAGS + i; }
      else if (local >= OUT_SRAM && local < OUT_SRAM + 4 * OSRAM_WORDS) {
        arr = this.osram; i = (local - OUT_SRAM) / 4; flag = D.OUT_FLAGS + 0x400 + i;
      } else {
        if (!dbg) this.recordError(E.REG_UNKNOWN, c, local, 0, 0, 0, 0);
        throw BUS;
      }
      const data = arr[i];
      if (!dbg) this.note(this.dbg[flag] ? NOTE.OUT_READ : reg ? NOTE.RESET_READ : NOTE.SRAM_RESET_READ, c, local, data);
      return data;
    }
    const ch = this.ch[c];
    if (!dbg) this.chanSync(c);
    if (local < (LATER ? STORE[0] : 0x2000)) {
      if (local >= 4 * REG_WORDS || !this.chanValid[local / 4]) {
        if (!dbg) this.recordError(E.REG_UNKNOWN, c, local, 0, 0, 0, 0);
        throw BUS;
      }
      let data;
      if (this.chanValid[local / 4] === 2) {         // kind 2's latched copy
        const i = (local - VL) / 4;
        data = ch.m[i];
        if (!dbg && !this.dbg[this.mFlags(c) + i]) this.note(NOTE.MIRROR_RESET_READ, c, local, ch.latched ? 1 : 0);
      } else if (local === R.MONI3) {
        data = this.moni3(c);
        if (!dbg && !ch.running) this.note(NOTE.MONI3_IDLE, c, local, 0);
      } else {
        data = ch.w[local / 4];
        if (!dbg && !this.dbg[this.wFlags(c) + local / 4]) this.note(NOTE.RESET_READ, c, local, 0);
      }
      if (!dbg) this.publish();
      return data;
    }
    if (K3 && local >= LATCH) {                     // kind 3's latched copy
      const off = local - LATCH;
      if (!LATCHED.has(off)) {
        if (!dbg) this.recordError(E.REG_UNKNOWN, c, local, 0, 0, 0, 0);
        throw BUS;
      }
      const data = ch.m[off / 4];
      if (!dbg && !this.dbg[this.mFlags(c) + off / 4]) this.note(NOTE.MIRROR_RESET_READ, c, local, ch.latched ? 1 : 0);
      return data;
    }
    if (local < 0x4000 && !LATER) {
      const off = local - 0x2000;
      if (off >= 4 * REG_WORDS || !this.chanValid[off / 4]) {
        if (!dbg) this.recordError(E.REG_UNKNOWN, c, local, 0, 0, 0, 0);
        throw BUS;
      }
      if (liveRegister(off)) {
        if (!dbg) this.recordError(E.MIRROR_LIVE, c, local, 0, 0, 0, 0);
        throw BUS;
      }
      const data = ch.m[off / 4];
      if (!dbg && !this.dbg[this.mFlags(c) + off / 4]) this.note(NOTE.MIRROR_RESET_READ, c, local, ch.latched ? 1 : 0);
      return data;
    }
    const s = this.sramWord(c, local);
    if (s === null) {
      if (!dbg) this.recordError(E.REG_UNKNOWN, c, local, 0, 0, 0, 0);
      throw BUS;
    }
    const data = s[0][s[1]];
    if (!dbg && s[2] >= 0 && !this.dbg[s[2]]) this.note(NOTE.SRAM_RESET_READ, c, local, 0);
    return data;
  }
  write(addr, value, size, dbg) {
    this.tables();
    const c = Math.floor(addr / CHAN_STRIDE), local = addr % CHAN_STRIDE;
    value >>>= 0;
    if (dbg) throw BUS;
    if (size !== 4 || (addr & 3)) { this.recordError(E.WIDTH, c, local, value, size, 0, 0); throw BUS; }
    this.dset(D.CPU_ACCESSES, this.dget(D.CPU_ACCESSES) + 1);
    if (c === 3 && !LATER) {
      if (local < 4 * REG_WORDS && this.outValid[local / 4]) {
        this.ow[local / 4] = value; this.dbg[D.OUT_FLAGS + local / 4] = 1;
      } else if (local >= OUT_SRAM && local < OUT_SRAM + 4 * OSRAM_WORDS) {
        this.osram[(local - OUT_SRAM) / 4] = value; this.dbg[D.OUT_FLAGS + 0x400 + (local - OUT_SRAM) / 4] = 1;
      } else { this.recordError(E.REG_UNKNOWN, c, local, value, 1, 0, 0); throw BUS; }
      return;
    }
    const ch = this.ch[c];
    if (local < (LATER ? STORE[0] : 0x2000)) {
      if (local >= 4 * REG_WORDS || !this.chanValid[local / 4]) { this.recordError(E.REG_UNKNOWN, c, local, value, 1, 0, 0); throw BUS; }
      if (local === R.MONI3) { this.recordError(E.RO_WRITE, c, local, value, 0, 0, 0); throw BUS; }
      if (this.chanValid[local / 4] === 2) { this.recordError(E.MIRROR_WRITE, c, local, value, 0, 0, 0); throw BUS; }
      if (local === R.INTST1 || local === R.INTST2) ch.w[local / 4] &= ~value;          // write-1-to-clear
      else ch.w[local / 4] = value;
      this.dbg[this.wFlags(c) + local / 4] = 1;
      if (GEN2 && (local === R.SYNC2 || local === R.SYNC8) && ch.bank !== +(local === R.SYNC8)) {
        ch.bank = +(local === R.SYNC8); ch.running = false;                  // the other bank: a new frame (see above)
      }
      this.chanSync(c);
      this.publish();
      return;
    }
    if ((local < 0x4000 && !LATER) || (K3 && local >= LATCH)) { this.recordError(E.MIRROR_WRITE, c, local, value, 0, 0, 0); throw BUS; }
    const s = this.sramWord(c, local);
    if (s === null) { this.recordError(E.REG_UNKNOWN, c, local, value, 1, 0, 0); throw BUS; }
    s[0][s[1]] = value;
    if (s[2] >= 0) this.dbg[s[2]] = 1;
    // kind 2's serial engine (the panel command words at +0x3800, filled by 0x5018998b): a write of bit 0 to +0x3214
    // (0x5018970c) starts it, and the ISR takes INTST1 bit 15 as its completion (0x50185bea, D). Modelled as done at
    // once, the start bit cleared (I: the firmware ORs it in again for the next command)
    if (GEN2 && local === SERIAL_START && (value & 1)) {
      s[0][s[1]] = value & ~1;
      ch.w[R.INTST1 / 4] |= SERIAL_DONE;
      this.publish();
    }
  }

  // ---- doorbell: one CPU store of cmd | channel << 8; arguments in the debug window
  doorbell(off, data, size, dbg) {
    if (dbg) throw BUS;
    data >>>= 0;
    const cmd = data & 0xff, c = (data >>> 8) & 0xff;
    let result = 0;
    if (size !== 4 || off || (data >>> 16) || c >= CHANNELS) {
      this.recordError(E.DOORBELL, c, off, data, size, 0, 0);
      this.dset(D.LAST_RESULT, E.DOORBELL);
      throw BUS;
    }
    for (let i = 0; i < CHANNELS; i++) this.chanSync(i);
    switch (cmd) {
      case CMD_ADVANCE:
        this.clock.advance(this.clock.t + (this.dget(D.ARG1) * 4294967296 + this.dget(D.ARG0)), false);
        break;
      case CMD_RUN_TO_FRAME:
        if (!this.ch[c].running) {
          this.recordError(E.NOT_RUNNING, c, 0, 0, this.lineNs(c), this.ch[c].w[this.vreg(c) / 4], 0);
          result = E.NOT_RUNNING;
        } else this.clock.advance(this.nextBoundary(c), false);
        break;
      case CMD_COMPOSE: {          // host time counted as compose time (machine stats.composeMs; measurement only)
        const t0 = this.m.clock();
        this.tables();
        result = LATER ? compose2(this, c) : compose(this, c);
        this.m.stats.composeMs += this.m.clock() - t0;
        break;
      }
      case CMD_CLEAR: this.dset(D.ERR_TOTAL, 0); this.dset(D.NOTE_TOTAL, 0); break;
      case CMD_RUN_TO_EVENT: {
        const limit = this.dget(D.ARG1) * 4294967296 + this.dget(D.ARG0);
        if (limit < this.clock.t) {
          this.recordError(E.DOORBELL, c, off, data, size, limit % 4294967296, this.clock.t % 4294967296);
          this.dset(D.LAST_RESULT, E.DOORBELL);
          throw BUS;
        }
        this.dset(D.EVENT_SOURCES, this.clock.advance(limit, true));
        break;
      }
      default:
        this.recordError(E.DOORBELL, c, off, data, size, 0, 0);
        this.dset(D.LAST_RESULT, E.DOORBELL);
        throw BUS;
    }
    this.dset(D.LAST_CMD, data); this.dset(D.LAST_RESULT, result);
    this.dset(D.COMMANDS, this.dget(D.COMMANDS) + 1);
    this.publish();
  }
}
