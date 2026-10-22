// COMPOSE(c) of the OM-1 VSC model: the latched mirror bank of channel c mixed
// into the output RAM (u32 Cr << 16 | Cb << 8 | Y per pixel of the active window): the A13 feature check over the name
// table and reg_class[]/features[], the A15 CTRL3 opt-in with its ASSUMED note, the plane geometry (A6, A7 PLANC 0,
// A12, A16 bus spans, A18 start position), the OSDFMT/OSDCP2 rules, the lab view mask and plane order, the OSD planes
// (8-bit index, nearest sampling, palette bank by OSDCP2, linear blend in tra / 31) and the IMG planes (format 0: YC
// 4:2:2 Y0 Cb Y1 Cr, two-tap linear, opaque; ycComp, imgRow, drawImg), and with the A19 opt-in the face/AF frame
// plane: IMG format 2, an 8-bit index into the eight YCbCr words at +0xD00..+0xD1C, index 0 transparent (drawFace).
import { MODEL_INFO } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import { E, NOTE, D, CH, FACE_FIRST, FACE_LAST, PAL_BASE, OUTPUT_SIZE, chanDbg, udiv } from './vsc.mjs';

const R = { INTEN1: 0x00C, INTST1: 0x010, DMAEN: 0x060, IMG_DMASADR: 0x390, OSD_DMASADR: 0x39C, IMG_DMALD: 0x3A8,
  OSD_DMALD: 0x3B4, IMG_DMABN: 0x3C0, OSD_DMABN: 0x3CC, IMGDMASPOS: 0x3D8, OSDDMASPOS: 0x3DC, IMG_FMT: 0x400,
  OSDFMT1: 0x40C, OSDFMT2: 0x410, VIDEOAREA1: 0x420, VIDEOAREA2: 0x424, IMG_AREA1: 0x42C, OSD_AREA1: 0x450,
  OSDRESO: 0x4C0, IMG2BC: 0x4C4, O1BC: 0x4D0, OSDCP2: 0x4E0, IMG1RSZ1: 0x4F0, IMG2RSZ1: 0x504, IMG3RSZ1: 0x51C,
  OSD_RSZ1: 0x534, PEAK1: 0x5E0, MIXODR1: 0x618, MIXODR2: 0x61C, IMG_PLANC: 0x620, OSD_PLANC: 0x62C, OSDMIX: 0x638,
  BG: 0x63C, SYNC1: 0x720, SYNC2: 0x728, SYNC4: 0x730, MONI3: 0xE80 };
const BC_V19 = 0x10F;
const HDR = { CHANNEL: 0, WIDTH: 1, HEIGHT: 2, FRAME: 3, ERRORS: 4, PAL_UNWRITTEN: 5, SKIPPED: 6, DRAWN: 7, OX: 8, OY: 9,
  MIX_FLAGS: 10, T_LO: 11, T_HI: 12, STATUS: 13, ASSUMED: 14, VIEW: 15 };
const UNW = 0xFFFFFFFF;
// (vsc.mjs imports this module: the bindings imported from it are used inside functions only, never at load time.)
const RC_NONE = 0, RC_MODEL = 1, RC_STORED = 2;
const REG_CLASS = [[0x00C, 0x010, RC_MODEL], [0x014, 0x018, RC_STORED], [0x030, 0x038, RC_STORED], [0x05C, 0x05C, RC_STORED],
  [0x060, 0x060, RC_MODEL], [0x068, 0x068, RC_STORED], [0x084, 0x33C, RC_STORED], [0x368, 0x38C, RC_STORED],
  [0x390, 0x3DC, RC_MODEL], [0x400, 0x410, RC_MODEL], [0x420, 0x424, RC_MODEL], [0x42C, 0x430, RC_MODEL],
  [0x438, 0x43C, RC_MODEL], [0x444, 0x448, RC_MODEL], [0x450, 0x454, RC_MODEL], [0x45C, 0x460, RC_MODEL],
  [0x468, 0x46C, RC_MODEL], [0x4C0, 0x4C8, RC_MODEL], [0x4D0, 0x4E0, RC_MODEL], [0x4F0, 0x578, RC_MODEL],
  [0x5E0, 0x5E0, RC_MODEL], [0x618, 0x63C, RC_MODEL], [0x660, 0x6D8, RC_STORED], [0x6E4, 0x6F8, RC_STORED],
  [0x720, 0x720, RC_MODEL], [0x724, 0x724, RC_STORED], [0x728, 0x728, RC_MODEL], [0x72C, 0x72C, RC_STORED],
  [0x730, 0x730, RC_MODEL], [0x734, 0x73C, RC_STORED], [0xE80, 0xE80, RC_MODEL]];
const FEATURES = [[0x004, 0x1C0, 0x1C0], [0x008, 1, 1], [0x03C, 0x4000, 0x4000], [0x044, 0x4000, 0x4000], [0x428, 0x29, 0x08],
  [0x580, 0x2E, 0x2E], [0x584, 0x2E, 0x2E], [0x588, 0x2E, 0x2E], [0x58C, 0x2E, 0x2E], [0x590, 0x30, 0x30], [0x594, 0x32, 0x32],
  [0x598, 0x2E, 0x2E], [0x5A0, 0x100, 0x100], [0x5A8, 0x100, 0x100], [0x5AC, 0x100, 0x100], [0x5B0, 0x100, 0x100],
  [0x5B4, 0x100, 0x100]];
// The class of channel register offset off in these tables: [class, [EVF value, TFT value] or null] with class
// MODEL, STORED, FEATURES or UNWRITTEN (test_dev's vsc-classes compares it with check_display's parse of
// checks/fixtures/om1-vsc-tables.c)
export function registerClass(off) {
  const f = FEATURES.find(([o]) => o === off);
  if (f) return ['FEATURES', [f[1], f[2]]];
  const c = regClassOf(off);
  return [c === RC_MODEL ? 'MODEL' : c === RC_STORED ? 'STORED' : 'UNWRITTEN', null];
}
function regClassOf(off) {
  for (const [first, last, cls] of REG_CLASS) if (off >= first && off <= last) return cls;
  return RC_NONE;
}
const P_IMG1 = 0, P_IMG2 = 1, P_IMG3 = 2, P_OSD1 = 3, PLANES = 6;
const HILIGHT1 = 0x5D0, UNAPPLIED = BOARD.vsc.unapplied;
const A15_BIT = 1, A19_BIT = 4, A20_BIT = 8, FACE_PLANC = 0x1000, FACE_FMT = 2, FACE_COLOURS = 8;
const PLANE_NOT_DRAWN = 0x1000;

// blend(): per component ((a * tra + b * (31 - tra) + 15) / 31), unsigned. A table of every (tra, a, b), built once.
let LUT = null;
export function blendLut() {
  if (LUT === null) {
    LUT = new Uint8Array(32 << 16);
    for (let t = 0; t < 32; t++) for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
      LUT[(t << 16) | (a << 8) | b] = Math.floor((a * t + b * (31 - t) + 15) / 31);
    }
  }
  return LUT;
}
export function blend(src, dst, tra) {
  const L = blendLut(), t = tra << 16;
  return (L[t | (src & 0xFF) << 8 | (dst & 0xFF)] | L[t | (src >>> 8 & 0xFF) << 8 | (dst >>> 8 & 0xFF)] << 8
    | L[t | (src >>> 16 & 0xFF) << 8 | (dst >>> 16 & 0xFF)] << 16) >>> 0;
}
const osdCol = (i, sh) => Math.floor((i * sh + 2048) / 4096);
// ycComp: component 0 Y of pixel x (byte 2x), 1 Cb and 2 Cr of its pair (bytes 4 (x >> 1) + 1 / + 3)
const ycComp = (b, x, comp) => (comp === 0 ? b[2 * x] : b[4 * (x >>> 1) + (comp === 1 ? 1 : 3)]);
// imgRow: output pixel i from source column s = i * sh >> 12 and the fraction f = i * sh & 4095 (S and F
// precomputed per plane), two taps when f != 0: (a * (4096 - f) + b * f + 2048) >> 12 per component
function imgRow(b, w, S, F, out) {
  for (let i = 0; i < w; i++) {
    const s = S[i], f = F[i];
    let word = 0;
    for (let comp = 0; comp < 3; comp++) {
      const a = ycComp(b, s, comp);
      const value = f ? Math.floor((a * (4096 - f) + ycComp(b, s + 1, comp) * f + 2048) / 4096) : a;
      word |= value << (8 * comp);
    }
    out[i] = word;
  }
}

class Compose {
  constructor(v, c) {
    this.v = v; this.c = c; this.m = v.ch[c].m; this.mf = v.mFlags(c); this.out = v.out;
    this.ox = 0; this.oy = 0; this.vw = 0; this.vh = 0; this.errors = 0; this.palUnwritten = 0; this.face = false;
  }
  mw(i) { return this.v.dbg[this.mf + i]; }
  cerror(code, off, value, a0, a1, a2) { this.errors++; this.v.recordError(code, this.c, off, value, a0, a1, a2); }
  need(off) {                  // a consumed register: never written -> error (null), the caller skips
    if (!this.mw(off / 4)) { this.cerror(E.UNWRITTEN, off, 0, 0, 0, 0); return null; }
    return this.m[off / 4];
  }
  zeroReg(off) {               // must hold 0 in the modelled domain: never written counts as 0 and is noted
    if (!this.mw(off / 4)) { this.v.note(NOTE.COMPOSE_RESET, this.c, off, 0); return 0; }
    return this.m[off / 4];
  }
  // Returns 0, PLANE_NOT_DRAWN or an error code; fills pl.
  planeGeometry(pl) {
    const p = pl.p, q = p >= P_OSD1 ? p - P_OSD1 : p, osd = p >= P_OSD1;
    const rsz = osd ? R.OSD_RSZ1 + 0x18 * q : (p === P_IMG1 ? R.IMG1RSZ1 : p === P_IMG2 ? R.IMG2RSZ1 : R.IMG3RSZ1);
    const a1off = (osd ? R.OSD_AREA1 : R.IMG_AREA1) + 12 * q;
    const sadrOff = (osd ? R.OSD_DMASADR : R.IMG_DMASADR) + 4 * q, ldOff = (osd ? R.OSD_DMALD : R.IMG_DMALD) + 4 * q;
    const bnOff = (osd ? R.OSD_DMABN : R.IMG_DMABN) + 4 * q, plancOff = (osd ? R.OSD_PLANC : R.IMG_PLANC) + 4 * q;
    let area1, area2, sadr, ld, bn, planc, rsz1;
    if ((area1 = this.need(a1off)) === null || (area2 = this.need(a1off + 4)) === null || (sadr = this.need(sadrOff)) === null ||
        (ld = this.need(ldOff)) === null || (bn = this.need(bnOff)) === null || (planc = this.need(plancOff)) === null ||
        (rsz1 = this.need(rsz)) === null) return E.UNWRITTEN;
    const xs = area1 >>> 16, ys = area2 >>> 16;
    pl.w = area1 & 0xFFFF; pl.h = area2 & 0xFFFF;
    if (xs < this.ox || ys < this.oy || !pl.w || !pl.h || xs - this.ox + pl.w > this.vw || ys - this.oy + pl.h > this.vh) {
      this.cerror(E.WINDOW, a1off, area1, area2, ((this.ox << 16) | this.vw) >>> 0, ((this.oy << 16) | this.vh) >>> 0);
      return E.WINDOW;
    }
    pl.x0 = xs - this.ox; pl.y0 = ys - this.oy;
    if (planc === 0) { this.v.noteRecord(NOTE.PLANC_ZERO, this.c, plancOff, p); return PLANE_NOT_DRAWN; }
    pl.fmt = 0;
    if (p === P_IMG3 && this.face && planc === FACE_PLANC) {          // A19 (opt-in): the face/AF frame plane
      const fmt = this.need(R.IMG_FMT + 4 * q);
      if (fmt === null) return E.UNWRITTEN;
      if (fmt !== FACE_FMT) { this.cerror(E.FMT_UNMODELLED, R.IMG_FMT + 4 * q, fmt, p, 0, 0); return E.FMT_UNMODELLED; }
      pl.fmt = FACE_FMT;
    } else {
      if (planc !== 0x100) { this.cerror(E.PLANC_UNOBSERVED, plancOff, planc, p, 0, 0); return E.PLANC_UNOBSERVED; }
      if (!osd) {
        const fmt = this.need(R.IMG_FMT + 4 * q);
        if (fmt === null) return E.UNWRITTEN;
        if (fmt !== 0) { this.cerror(E.FMT_UNMODELLED, R.IMG_FMT + 4 * q, fmt, p, 0, 0); return E.FMT_UNMODELLED; }
      }
    }
    if (sadr >>> 28) { this.cerror(E.DMA_FIELD, sadrOff, sadr, p, 0, 0); return E.DMA_FIELD; }
    const sposOff = osd ? R.OSDDMASPOS : R.IMGDMASPOS;
    const spos = (this.zeroReg(sposOff) >>> (8 * q)) & 0xFF;
    const addr = (sadr << 4) >>> 0, sbytes = spos * (osd ? 1 : 2);
    if (pl.fmt === FACE_FMT && (spos || (addr & 0x7F))) { this.cerror(E.SPOS_UNMODELLED, sposOff, spos, addr, p, 0); return E.SPOS_UNMODELLED; }
    if (spos || (addr & 0x7F)) {
      if ((addr & 0x70) !== (sbytes & 0x70) || sbytes >= 128 || (!osd && (spos & 1))) {
        this.cerror(E.SPOS_UNMODELLED, sposOff, spos, addr, p, 0);
        return E.SPOS_UNMODELLED;
      }
      this.v.noteRecord(NOTE.SPOS_A18, this.c, sposOff, (p << 8) | spos);
    }
    pl.base = ((addr & ~127) + sbytes) >>> 0;
    pl.sposBytes = sbytes;
    if ((ld & 7) || (ld >>> 15) || (bn & 7)) { this.cerror(E.DMA_FIELD, ldOff, ld, bn, p, 0); return E.DMA_FIELD; }
    pl.stride = (ld >>> 3) * 128;
    pl.burst = ((bn >>> 3) * 128) >>> 0;
    const nrsz = p === P_IMG1 ? 5 : 6;
    if (rsz1 & ~0x11) { this.cerror(E.RSZ_UNMODELLED, rsz, rsz1, p, 0, 0); return E.RSZ_UNMODELLED; }
    for (const i of [3, 5, 6]) {
      const value = i <= nrsz ? this.zeroReg(rsz + 4 * (i - 1)) : 0;
      if (value) { this.cerror(E.RSZ_UNMODELLED, rsz + 4 * (i - 1), value, p, i, 0); return E.RSZ_UNMODELLED; }
    }
    pl.uv = (this.c === 2 && p === P_IMG1) ? 8192 : 4096;
    pl.sh = 4096; pl.sv = pl.uv;
    if (rsz1 & 1) { const x = this.need(rsz + 4); if (x === null) return E.UNWRITTEN; pl.sh = x; }
    if (rsz1 & 0x10) { const x = this.need(rsz + 12); if (x === null) return E.UNWRITTEN; pl.sv = x; }
    if (!pl.sh || !pl.sv || ((pl.sh | pl.sv) >>> 16)) { this.cerror(E.RSZ_UNMODELLED, rsz, pl.sh, pl.sv, p, 0); return E.RSZ_UNMODELLED; }
    const peak = this.zeroReg(R.PEAK1);
    if ((p === P_IMG1 || p === P_IMG2) && (peak & 0x11)) { this.cerror(E.PEAK_BC, R.PEAK1, peak, p, 0, 0); return E.PEAK_BC; }
    if (p !== P_IMG1) {
      const bcoff = osd ? R.O1BC + 4 * q : R.IMG2BC + 4 * (p - P_IMG2), bc = this.need(bcoff);
      if (bc === null) return E.UNWRITTEN;
      if (bc !== BC_V19) { this.cerror(E.PEAK_BC, bcoff, bc, p, 0, 0); return E.PEAK_BC; }
    }
    const hpos = (pl.w - 1) * pl.sh, vpos = (pl.h - 1) * pl.sv;
    let lastCol = Math.floor(hpos / 4096), lastRow = udiv(vpos, pl.uv), bytes;
    if (osd) { lastCol = Math.floor((hpos + 2048) / 4096); bytes = lastCol + 1; }
    else if (pl.fmt === FACE_FMT) {                                // A19: the indices nearest-neighbour scaled
      if (pl.sh > 4096 || pl.sv > pl.uv) { this.cerror(E.RSZ_UNMODELLED, rsz, pl.sh, pl.sv, p, 0); return E.RSZ_UNMODELLED; }
      bytes = lastCol + 1;
    } else {
      lastCol += (hpos % 4096) ? 1 : 0;
      lastRow += (vpos % pl.uv) ? 1 : 0;
      bytes = 4 * (Math.floor(lastCol / 2) + 1);
    }
    if (bytes + pl.sposBytes > pl.burst) {
      this.cerror(E.DMABN_SHORT, bnOff, bn, (bytes + pl.sposBytes) % 4294967296, pl.burst, p);
      return E.DMABN_SHORT;
    }
    const span = lastRow * pl.stride + bytes;
    if (!this.v.bus.span(pl.base, span)) { this.cerror(E.DMA_RANGE, sadrOff, pl.base, span % 4294967296, p, 0); return E.DMA_RANGE; }
    return 0;
  }
  // drawImg: per output row j, source row r = j * sv / uv with remainder g; row r through imgRow, and for
  // g != 0 row r + 1 too, mixed per component (a * (uv - g) + c * g + uv / 2) / uv. Every product stays below 2^53.
  drawImg(pl) {
    const hpos = (pl.w - 1) * pl.sh;
    const last = Math.floor(hpos / 4096) + ((hpos % 4096) ? 1 : 0);
    const bytes = 4 * (Math.floor(last / 2) + 1);
    const b0 = new Uint8Array(bytes), b1 = new Uint8Array(bytes);
    const top = new Uint32Array(pl.w), bot = new Uint32Array(pl.w);
    const S = new Int32Array(pl.w), F = new Int32Array(pl.w);
    for (let i = 0; i < pl.w; i++) { const pos = i * pl.sh; S[i] = Math.floor(pos / 4096); F[i] = pos % 4096; }
    const uv = pl.uv, half = Math.floor(uv / 2), out = this.out;
    for (let j = 0; j < pl.h; j++) {
      const vpos = j * pl.sv, r = Math.floor(vpos / uv), g = vpos % uv;
      this.v.bus.read((pl.base + r * pl.stride) >>> 0, b0, 0, bytes);
      imgRow(b0, pl.w, S, F, top);
      const d0 = (pl.y0 + j) * this.vw + pl.x0;
      if (!g) { out.set(top, d0); continue; }
      this.v.bus.read((pl.base + (r + 1) * pl.stride) >>> 0, b1, 0, bytes);
      imgRow(b1, pl.w, S, F, bot);
      const k = uv - g;
      for (let i = 0; i < pl.w; i++) {
        const a = top[i], c = bot[i];
        out[d0 + i] = Math.floor(((a & 0xFF) * k + (c & 0xFF) * g + half) / uv)
          | Math.floor(((a >>> 8 & 0xFF) * k + (c >>> 8 & 0xFF) * g + half) / uv) << 8
          | Math.floor(((a >>> 16 & 0xFF) * k + (c >>> 16 & 0xFF) * g + half) / uv) << 16;
      }
    }
  }
  // A19: rows of 8-bit indices; output pixel (i, j) takes source column floor(i * sh / 4096) of source row
  // floor(j * sv / uv) (nearest neighbour: an index is not interpolated; unscaled on the TFT, twice the size on the
  // EVF, sh = sv = 2048); index 0 leaves the pixel, 1..7 replace it with the YCbCr word at +0xD00 + 4 * index of the
  // latched bank; an index of 8 or more, or an unwritten word, is an error.
  drawFace(pl) {
    const cols = Math.floor((pl.w - 1) * pl.sh / 4096) + 1, row = new Uint8Array(cols), out = this.out, base = FACE_FIRST / 4;
    const S = new Int32Array(pl.w);
    for (let i = 0; i < pl.w; i++) S[i] = Math.floor(i * pl.sh / 4096);
    let bad = 0, firstBad = 0;
    for (let j = 0; j < pl.h; j++) {
      this.v.bus.read((pl.base + Math.floor(j * pl.sv / pl.uv) * pl.stride) >>> 0, row, 0, cols);
      const d0 = (pl.y0 + j) * this.vw + pl.x0;
      for (let i = 0; i < pl.w; i++) {
        const idx = row[S[i]];
        if (!idx) continue;
        if (idx >= FACE_COLOURS || !this.mw(base + idx)) { if (!bad++) firstBad = idx; continue; }
        out[d0 + i] = this.m[base + idx] & 0xFFFFFF;
      }
    }
    if (bad) this.cerror(E.PAL_UNWRITTEN, FACE_FIRST, bad, pl.p, firstBad, 0);
  }
  drawOsd(pl, osdcp2) {
    const v = this.v, ch = v.ch[this.c], q = pl.p - P_OSD1;
    const bank = (0x800 * q + (((osdcp2 >>> (4 * q)) & 1) ? 0x400 : 0)) / 4, pal = ch.pal, pf = v.palFlags(this.c) + bank;
    let unwritten = 0, field = 0, firstUnwritten = 0, firstField = 0;
    const xmax = osdCol(pl.w - 1, pl.sh) + 1, row = new Uint8Array(xmax);
    const cols = new Int32Array(pl.w);
    for (let i = 0; i < pl.w; i++) cols[i] = osdCol(i, pl.sh);
    v.dset(D.PLANE + 32 * pl.p + 28, PAL_BASE + 4 * bank);
    const L = blendLut(), out = this.out, flags = v.dbg;
    for (let j = 0; j < pl.h; j++) {
      const sy = udiv(j * pl.sv, pl.uv) % 4294967296;
      v.bus.read((pl.base + sy * pl.stride) >>> 0, row, 0, xmax);
      const d0 = (pl.y0 + j) * this.vw + pl.x0;
      for (let i = 0; i < pl.w; i++) {
        const idx = row[cols[i]], word = pal[bank + idx];
        if (!flags[pf + idx]) { if (!unwritten++) firstUnwritten = idx; continue; }
        if (word >>> 29) { if (!field++) firstField = word; continue; }
        const t = ((word >>> 24) & 0x1F) << 16, dst = out[d0 + i];
        out[d0 + i] = L[t | (word & 0xFF) << 8 | (dst & 0xFF)] | L[t | (word >>> 8 & 0xFF) << 8 | (dst >>> 8 & 0xFF)] << 8
          | L[t | (word >>> 16 & 0xFF) << 8 | (dst >>> 16 & 0xFF)] << 16;
      }
    }
    if (unwritten) {
      this.cerror(E.PAL_UNWRITTEN, PAL_BASE + 4 * bank, unwritten, pl.p, firstUnwritten, 0);
      this.palUnwritten = (this.palUnwritten + unwritten) >>> 0;
    }
    if (field) this.cerror(E.PAL_FIELD, PAL_BASE + 4 * bank, field, pl.p, firstField, 0);
  }
}

export function compose(v, c) {
  const ch = v.ch[c], k = new Compose(v, c), t = v.clock.t;
  const hdr = new Uint32Array(16);
  hdr[HDR.CHANNEL] = c; hdr[HDR.FRAME] = ch.frames; hdr[HDR.T_LO] = t % 4294967296; hdr[HDR.T_HI] = Math.floor(t / 4294967296);
  let status = 0, osdCode = 0, osdcp2 = 0;
  for (let i = 0; i < 16; i++) v.dset(D.HDR + 4 * i, 0);
  for (let i = 0; i < 6 * 8; i++) v.dset(D.PLANE + 4 * i, 0);
  run: {
    if (!ch.latched) { k.cerror(E.NOT_LATCHED, 0, 0, 0, 0, 0); status = E.NOT_LATCHED; break run; }
    const sync1 = k.need(R.SYNC1);
    if (sync1 === null) { status = E.UNWRITTEN; break run; }
    const sync4 = k.zeroReg(R.SYNC4);
    if (!(sync1 & (1 << 24)) || (sync4 & 0x7FFF)) { k.cerror(E.FIELD_MODE, R.SYNC1, sync1, sync4, 0, 0); status = E.FIELD_MODE; break run; }
    let va1, va2, bg, dmaen;
    if ((va1 = k.need(R.VIDEOAREA1)) === null || (va2 = k.need(R.VIDEOAREA2)) === null || (bg = k.need(R.BG)) === null ||
        (dmaen = k.need(R.DMAEN)) === null) { status = E.UNWRITTEN; break run; }
    k.ox = va1 >>> 16; k.vw = va1 & 0xFFFF; k.oy = va2 >>> 16; k.vh = va2 & 0xFFFF;
    if (!k.vw || !k.vh || k.vw * k.vh * 4 > OUTPUT_SIZE) { k.cerror(E.WINDOW, R.VIDEOAREA1, va1, va2, 0, 0); status = E.WINDOW; break run; }
    if (bg >>> 24) { k.cerror(E.BG_FIELD, R.BG, bg, 0, 0, 0); status = E.BG_FIELD; break run; }
    if (dmaen & ~0x3F) { k.cerror(E.DMA_FIELD, R.DMAEN, dmaen, 0, 0, 0); status = E.DMA_FIELD; break run; }
    const order = [];
    let seen = 0;
    for (let i = 0; i < PLANES; i++) {
      order.push(v.dbg[chanDbg(c, CH.ORDER) + i]);
      seen |= order[i] < PLANES ? 1 << order[i] : 0x80;
    }
    if (seen !== 0x3F) {
      k.cerror(E.ORDER, 0, (order[0] | order[1] << 8 | order[2] << 16 | order[3] << 24) >>> 0, order[4] | order[5] << 8, 0, 0);
      status = E.ORDER; break run;
    }
    const mix = [[R.MIXODR2, 8], [R.OSDMIX, 0x111111], [R.OSDRESO, 0]];
    for (let i = 0; i < mix.length; i++) {
      const [off, value] = mix[i];
      if (!k.mw(off / 4) || k.m[off / 4] !== value) {
        hdr[HDR.MIX_FLAGS] |= 1 << i;
        k.cerror(E.MIX_UNOBSERVED, off, k.m[off / 4], k.mw(off / 4), 0, 0);
      }
    }
    if (k.mw(R.MIXODR1 / 4)) { hdr[HDR.MIX_FLAGS] |= 1 << 3; k.cerror(E.MIX_UNOBSERVED, R.MIXODR1, k.m[R.MIXODR1 / 4], 1, 0, 0); }
    if (c !== 1 && c !== 2) { k.cerror(E.FEATURE_UNOBSERVED, 0, c, 0, 0, 0); status = E.FEATURE_UNOBSERVED; break run; }
    let f = 0;
    for (const off of v.chanRegs) {                  // ascending offsets
      let want = UNW;
      const w = off / 4;
      while (f < FEATURES.length && FEATURES[f][0] < off) f++;
      if (f < FEATURES.length && FEATURES[f][0] === off) want = c === 1 ? FEATURES[f][1] : FEATURES[f][2];
      // a ported model's observed feature values for its own panels (MODEL_INFO.vsc_features: {off: [EVF, TFT]})
      const mf = MODEL_INFO.vsc_features?.[off];
      if (mf && mf[c === 1 ? 0 : 1] !== undefined) want = mf[c === 1 ? 0 : 1];
      else if (regClassOf(off) !== RC_NONE) continue;
      // A20 (opt-in): HILIGHT1 written 0. Its setters only change bit 0 (highlight, 0x501e1b2c, 0x501e1e08) and bits
      // 0x330 (zebra, 0x501e1bb1), each a read-modify-write, so 0 is both off over the 0 an unwritten register reads
      // (playback's entry writes it)
      if (off === HILIGHT1 && (v.dbg[chanDbg(c, CH.ASSUME)] & A20_BIT) && k.mw(w) && k.m[w] === 0) {
        hdr[HDR.ASSUMED] |= A20_BIT;
        v.noteRecord(NOTE.ASSUMED, c, off, 0);
        continue;
      }
      // A21: a register block the board's compositor does not apply (BOARD.vsc.unapplied; E147's highlight and NV
      // blocks, src/fw/models.mjs VSC_UNAPPLIED): the composite shows the planes without it
      if (UNAPPLIED.some(([lo, hi]) => off >= lo && off <= hi)) {
        v.noteRecord(NOTE.ASSUMED, c, off, k.m[w]);
        continue;
      }
      if (off === 0x008 && (v.dbg[chanDbg(c, CH.ASSUME)] & A15_BIT) && k.mw(w) && k.m[w] === 0x41) {   // A15 (opt-in)
        hdr[HDR.ASSUMED] |= 1;
        v.noteRecord(NOTE.ASSUMED, c, off, k.m[w]);
        continue;
      }
      if (want === UNW ? k.mw(w) : (!k.mw(w) || k.m[w] !== want)) {
        k.cerror(E.FEATURE_UNOBSERVED, off, k.m[w], k.mw(w), want, 0);
        status = E.FEATURE_UNOBSERVED;
      }
    }
    k.face = !!(v.dbg[chanDbg(c, CH.ASSUME)] & A19_BIT);
    if (k.face) { hdr[HDR.ASSUMED] |= A19_BIT; v.noteRecord(NOTE.ASSUMED, c, FACE_FIRST, FACE_FMT); }
    else for (let off = FACE_FIRST; off <= FACE_LAST; off += 4) {
      if (k.mw(off / 4)) { k.cerror(E.FEATURE_UNOBSERVED, off, k.m[off / 4], 1, UNW, 0); status = E.FEATURE_UNOBSERVED; }
    }
    if (status) break run;
    {
      let fmt1, fmt2;
      if ((fmt1 = k.need(R.OSDFMT1)) === null || (fmt2 = k.need(R.OSDFMT2)) === null) osdCode = E.UNWRITTEN;
      else {
        if (fmt1 !== 0x111) { k.cerror(E.FMT_UNMODELLED, R.OSDFMT1, fmt1, 0, 0, 0); osdCode = E.FMT_UNMODELLED; }
        if (fmt2 !== 0x11) { k.cerror(E.FMT_UNMODELLED, R.OSDFMT2, fmt2, 0, 0, 0); osdCode = E.FMT_UNMODELLED; }
      }
    }
    const cp2 = k.need(R.OSDCP2);
    if (cp2 === null) osdCode = osdCode || E.UNWRITTEN;
    else {
      osdcp2 = cp2;
      if (osdcp2 & ~0x111) { k.cerror(E.OSDCP2_FIELD, R.OSDCP2, osdcp2, 0, 0, 0); osdCode = osdCode || E.OSDCP2_FIELD; }
    }
    const view = v.dbg[chanDbg(c, CH.VIEW)] & 0x3F;
    hdr[HDR.VIEW] = view;
    if (view !== 0x3F) v.noteRecord(NOTE.VIEW, c, 0, view);
    hdr[HDR.WIDTH] = k.vw; hdr[HDR.HEIGHT] = k.vh; hdr[HDR.OX] = k.ox; hdr[HDR.OY] = k.oy;
    k.out.fill(bg, 0, k.vw * k.vh);
    for (let n = 0; n < PLANES; n++) {
      const pl = { p: order[n], x0: 0, y0: 0, w: 0, h: 0, base: 0, stride: 0, burst: 0, sh: 0, sv: 0, uv: 0, sposBytes: 0 };
      const info = D.PLANE + 32 * pl.p;
      if (!(dmaen & (0x20 >>> pl.p)) || !(view & (1 << pl.p))) continue;
      const code = (pl.p >= P_OSD1 && osdCode) ? osdCode : k.planeGeometry(pl);
      v.dset(info, code === PLANE_NOT_DRAWN ? 0x101 : code ? code : 0x100);
      if (code === PLANE_NOT_DRAWN) continue;
      if (code) { hdr[HDR.SKIPPED] |= 1 << pl.p; continue; }
      const rec = [pl.x0, pl.y0, pl.w, pl.h, pl.base, pl.stride];
      for (let i = 0; i < 6; i++) v.dset(info + 4 + 4 * i, rec[i]);
      if (pl.p >= P_OSD1) k.drawOsd(pl, osdcp2);
      else if (pl.fmt === FACE_FMT) k.drawFace(pl);
      else k.drawImg(pl);
      hdr[HDR.DRAWN] |= 1 << pl.p;
    }
  }
  hdr[HDR.ERRORS] = k.errors;
  hdr[HDR.PAL_UNWRITTEN] = k.palUnwritten;
  hdr[HDR.STATUS] = status;
  for (let i = 0; i < 16; i++) v.dset(D.HDR + 4 * i, hdr[i]);
  v.dset(chanDbg(c, CH.COMPOSE), status ? status : (k.errors ? 0x200 | k.errors : 0x100));
  return status;
}
