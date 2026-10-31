// COMPOSE(c) of the kind-2 VSC (E144, src/fw/board.mjs) and of the kind-3 one (the E118 family): the latched registers
// of channel c mixed into the output RAM as vsccompose.mjs does for E143 (u32 Cr << 16 | Cb << 8 | Y per pixel of the
// video area, the same debug-window header and plane records). The register meanings below were read from E144's code
// and from the values its display stack writes (D: code, X: a lab run's register dump):
//   video area     AREA22 {hstart << 16 | width}, AREA23 {vstart << 16 | vstart}, AREA24 height (0x5002293c, D)
//   background     BG1, Cr << 16 | Cb << 8 | Y (X: 0x80800b)
//   DMA enable     DMA7, bit 5 - p for plane p (IMG1..IMG3, OSD1..OSD3; the commit 0x50187cad, D)
//   OSD plane q    address DMA12 + q (a byte address, 0x501879e9 stores it unshifted, D), stride DMA18 + q in 64-byte
//                  units (X: 18 for the 1152-byte records), area AREA10 + 3q in the video area's three-word form,
//                  enable word OSD7 + q (0 = not drawn, I by analogy with E143's PLANC), scaler RSZ18/24/30 (0 = 1:1, X)
//   OSD scaler     six words from RSZ18 + 0x18 q in E143's OSDnRSZ1..6 layout (I, by the values): the control's bits 0
//                  and 4 scale horizontally and vertically, +4 and +12 the source steps per output pixel in 1/4096,
//                  +8, +16 and +20 zero; sampled as E143's OSD planes (A6: columns rounded half up, rows floor). The
//                  EVF's (X: E144, E139, E137, E125) are 0x11, 0x9fc, 0, 0x9fc, 0, 0 for a 640 x 480 canvas on a
//                  1024 x 768 area: 0x9fc is E143's OSD step form 4 ceil((src - 1) 1024 / dst) for 640 -> 1024 and
//                  for 480 -> 768 (docs/om1-vsc-spec.md section 3)
//   palette q      128 words at +0x800 + 0x800 q, the second bank +0x200 when bit 4 of OSD14 / OSD16 / OSD18 is set
//                  (the writer 0x50023685 fills the other bank, the commit 0x50187eda flips the bit, D); a word is
//                  tra << 24 | Cr << 16 | Cb << 8 | Y with tra 0..31 as on E143 (X)
//   pixel index    the low 7 bits of the 8-bit pixel (I: the GUI fills with 255 and 127, entry 127 is transparent in
//                  all three palettes, X)
//   mix            OSD4 must hold 0x111111 (the value every open writes, X)
// Kind 3 keeps every word above at its kind-2 offset (read from E122's code, docs/om1-vsc-spec.md section 12 has the
// sites; X: the TFT's and the EVF's opens leave E144's values there, e.g. AREA22 0x1e02d0 / 0x300400, BG1 0x80800b,
// the EVF's scaler 0x11, 0x9fc, 0, 0x9fc): the video area from the device's getters, BG1, DMA7 and the OSD planes'
// addresses from the commit (OSD1..OSD3 = DMA12..DMA14, enabled for an area width of 16 or more), the strides
// DMA18..DMA20 (14: the GUI canvas's 896-byte rows), the scaler words (bit 0 and +4 horizontal, bit 4 and +12
// vertical, each 4 ceil((src - 1) 1024 / dst)), D; its scaler has four words a plane (+8 zero). It differs in:
//   palettes       three groups by the palette writer's id, each the palette of one GUI layer (the palette set uploads
//                  id 0 from GUI layer 2's palette, 256 entries, id 1 from layer 1's, 32, id 2 from layer 0's, 32, D):
//                  id 0 128 words at +0x800, the other bank +0xa00 while bit 4 of 0x1b8 is set (the writer fills
//                  +0x800 while the bit is set and +0xa00 while it is clear, `btst 16` at 0x50307af4, and the commit
//                  flips the bit after an upload, 0x50309f14..0x50309f24, D; that the bank shown is the one not written
//                  is I, as kinds 1 and 2), id 1 32 words at +0x680 and id 2 32 words at +0x600, single (the commit
//                  copies them whole, D). The plane of a GUI layer: the GUI's update puts layer 2 - k's buffer in the
//                  display record's osd word k (0x506c0aa3..0x506c0b25, each word with that layer's dirty flag, D) and
//                  the commit takes OSD1's address from word 2 and OSD3's from word 0 (D), so OSD1 shows GUI layer 0
//                  with palette id 2, OSD2 layer 1 with id 1 and OSD3 layer 2 with id 0 (X: E122's clock warning, layer
//                  2's indices 13..33 and its fill 255 in OSD3, layer 0's fill 31 in OSD1, layer 1's 5 in OSD2)
//   pixel index    OSD3's the low 7 bits (I, as kind 2: layer 2's fill 255 takes entry 127, transparent, X); OSD1's
//                  and OSD2's below 32, a larger one is not drawn and is counted (PAL_FIELD: no code read says what
//                  the chip does with it, ?)
//   formats        0x1b0 = 0x111 and 0x1b4 = 0x11, the values every open writes (D); E143's OSDFMT1 and OSDFMT2 hold
//                  the same, kind 2's mix word 0x1b0 another (I): checked as kind 2's mix
//   level          OSD7..OSD9 as kind 2's enable words; the display sets them to 2 floor(p 128 / 100) for a level of p
//                  percent (D; 0x100 at 100 %, E143's PLANC form), the EVF's 0xb2 (70 %, X). A build whose code names
//                  no level word (BOARD.vsc.levels false, src/fw/facts.mjs vscLevels: E118's open writes none, D) has
//                  its planes drawn at the full level with the plane's ASSUMED bit (what the chip's unwritten level
//                  word holds is ?; I: E118's clock warning then shows as E122's does)
// On both kinds a level other than 0 is drawn as full (E144's EVF writes 0xcc, X; what the chip does with a level
// below 0x100 is ?, as E143's PLANC, docs/om1-vsc-spec.md section 3, which E143's compositor refuses).
// IMG planes are not modelled yet: an enabled one is skipped with FMT_UNMODELLED.
import { BOARD } from '../fw/board.mjs';
import { E, NOTE, D, CH, OUTPUT_SIZE, STORE_BASE, chanDbg } from './vsc.mjs';
import { blendLut, osdCol } from './vsccompose.mjs';

const R = { DMA7: 0x030, DMA12: 0x044, DMA18: 0x05C, AREA10: 0x0C8, AREA22: 0x0F8, AREA23: 0x0FC, AREA24: 0x100,
  BG1: 0x190, OSD7: 0x2E0, RSZ: [0x104, 0x118, 0x130, 0x148, 0x160, 0x178] };
const HDR = { CHANNEL: 0, WIDTH: 1, HEIGHT: 2, FRAME: 3, ERRORS: 4, PAL_UNWRITTEN: 5, SKIPPED: 6, DRAWN: 7, OX: 8, OY: 9,
  MIX_FLAGS: 10, T_LO: 11, T_HI: 12, STATUS: 13, ASSUMED: 14, VIEW: 15 };
const PLANES = 6, P_OSD1 = 3;
// What differs by kind (see the head): mix, the words every open writes, [offset, value]; rszZero, the scaler words
// after the control that must be zero; palette(q), OSD plane q's palette: sel, the word holding its bank bit (null:
// one bank), bit, banks [shown while the bit is clear, while it is set] (byte offsets in the channel), entries, mask
// (the pixel bits that index it; null: a pixel of entries or more is not drawn)
const KINDS = {
  2: { mix: [[0x1B0, 0x111111]], rszZero: [8, 16, 20],
    palette: (q) => ({ sel: 0x364 + 8 * q, bit: 0x10, banks: [0x800 + 0x800 * q, 0xA00 + 0x800 * q], entries: 128, mask: 0x7F }) },
  3: { mix: [[0x1B0, 0x111], [0x1B4, 0x11]], rszZero: [8],
    palette: (q) => (q === 2 ? { sel: 0x1B8, bit: 0x10, banks: [0x800, 0xA00], entries: 128, mask: 0x7F }
      : { sel: null, bit: 0, banks: [q === 1 ? 0x680 : 0x600], entries: 32, mask: null }) },
};
const K = KINDS[BOARD.vsc.kind] ?? null;
// kind 3: whether the build sets the level words (a build that names none draws its planes at the full level)
const LEVELS = BOARD.vsc.kind !== 3 || BOARD.vsc.levels;
const FULL_LEVEL = 0x100;

export function compose2(v, c) {
  const ch = v.ch[c], m = ch.m, mf = v.mFlags(c), t = v.clock.t, out = v.out;
  const hdr = new Uint32Array(16);
  let errors = 0, palUnwritten = 0, status = 0;
  const cerror = (code, off, value, a0, a1, a2) => { errors++; v.recordError(code, c, off, value, a0, a1, a2); };
  const mw = (off) => v.dbg[mf + off / 4];
  const need = (off) => { if (!mw(off)) { cerror(E.UNWRITTEN, off, 0, 0, 0, 0); return null; } return m[off / 4]; };
  hdr[HDR.CHANNEL] = c; hdr[HDR.FRAME] = ch.frames; hdr[HDR.T_LO] = t % 4294967296; hdr[HDR.T_HI] = Math.floor(t / 4294967296);
  for (let i = 0; i < 16; i++) v.dset(D.HDR + 4 * i, 0);
  for (let i = 0; i < 6 * 8; i++) v.dset(D.PLANE + 4 * i, 0);
  run: {
    if (!ch.latched) { cerror(E.NOT_LATCHED, 0, 0, 0, 0, 0); status = E.NOT_LATCHED; break run; }
    let a22, a23, a24, bg, dmaen;
    if ((a22 = need(R.AREA22)) === null || (a23 = need(R.AREA23)) === null || (a24 = need(R.AREA24)) === null ||
        (bg = need(R.BG1)) === null || (dmaen = need(R.DMA7)) === null) { status = E.UNWRITTEN; break run; }
    const mix = [];
    for (const [off] of K.mix) { const x = need(off); if (x === null) { status = E.UNWRITTEN; break run; } mix.push(x); }
    const ox = a22 >>> 16, vw = a22 & 0xFFFF, oy = a23 >>> 16, vh = a24 & 0xFFFF;
    if (!vw || !vh || vw * vh * 4 > OUTPUT_SIZE || (a23 & 0xFFFF) !== oy) { cerror(E.WINDOW, R.AREA22, a22, a23, a24, 0); status = E.WINDOW; break run; }
    if (bg >>> 24) { cerror(E.BG_FIELD, R.BG1, bg, 0, 0, 0); status = E.BG_FIELD; break run; }
    if (dmaen & ~0x3F) { cerror(E.DMA_FIELD, R.DMA7, dmaen, 0, 0, 0); status = E.DMA_FIELD; break run; }
    K.mix.forEach(([off, want], k) => { if (mix[k] !== want) { hdr[HDR.MIX_FLAGS] |= 1 << k; cerror(E.MIX_UNOBSERVED, off, mix[k], k + 1, 0, 0); } });
    const order = [];
    let seen = 0;
    for (let i = 0; i < PLANES; i++) { order.push(v.dbg[chanDbg(c, CH.ORDER) + i]); seen |= order[i] < PLANES ? 1 << order[i] : 0x80; }
    if (seen !== 0x3F) { cerror(E.ORDER, 0, 0, 0, 0, 0); status = E.ORDER; break run; }
    const view = v.dbg[chanDbg(c, CH.VIEW)] & 0x3F;
    hdr[HDR.VIEW] = view;
    if (view !== 0x3F) v.noteRecord(NOTE.VIEW, c, 0, view);
    hdr[HDR.WIDTH] = vw; hdr[HDR.HEIGHT] = vh; hdr[HDR.OX] = ox; hdr[HDR.OY] = oy;
    out.fill(bg, 0, vw * vh);
    const L = blendLut();
    for (let n = 0; n < PLANES; n++) {
      const p = order[n], info = D.PLANE + 32 * p;
      if (!(dmaen & (0x20 >>> p)) || !(view & (1 << p))) continue;
      if (p < P_OSD1) { cerror(E.FMT_UNMODELLED, 0, p, 0, 0, 0); v.dset(info, E.FMT_UNMODELLED); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      const q = p - P_OSD1, P = K.palette(q);
      let base, ld, w1, w2, w3, planc, rsz, sel = 0;
      if ((base = need(R.DMA12 + 4 * q)) === null || (ld = need(R.DMA18 + 4 * q)) === null || (w1 = need(R.AREA10 + 12 * q)) === null ||
          (w2 = need(R.AREA10 + 12 * q + 4)) === null || (w3 = need(R.AREA10 + 12 * q + 8)) === null ||
          (planc = LEVELS ? need(R.OSD7 + 4 * q) : FULL_LEVEL) === null || (rsz = need(R.RSZ[p])) === null || (P.sel !== null && (sel = need(P.sel)) === null)) {
        v.dset(info, E.UNWRITTEN); hdr[HDR.SKIPPED] |= 1 << p; continue;
      }
      const xs = w1 >>> 16, ys = w2 >>> 16, pw = w1 & 0xFFFF, ph = w3 & 0xFFFF, stride = ld * 64;
      if (xs < ox || ys < oy || !pw || !ph || xs - ox + pw > vw || ys - oy + ph > vh || (w2 & 0xFFFF) !== ys) {
        cerror(E.WINDOW, R.AREA10 + 12 * q, w1, w2, w3, 0); v.dset(info, E.WINDOW); hdr[HDR.SKIPPED] |= 1 << p; continue;
      }
      if (planc === 0) { v.noteRecord(NOTE.PLANC_ZERO, c, R.OSD7 + 4 * q, p); v.dset(info, 0x101); continue; }
      if (!LEVELS) { hdr[HDR.ASSUMED] |= 1 << p; v.noteRecord(NOTE.ASSUMED, c, R.OSD7 + 4 * q, p); }
      let sh = 4096, sv = 4096;
      if (rsz) {
        const zero = K.rszZero.find((k) => mw(R.RSZ[p] + k) && m[(R.RSZ[p] + k) / 4]);
        if ((rsz & ~0x11) || zero !== undefined) {
          cerror(E.RSZ_UNMODELLED, R.RSZ[p] + (zero ?? 0), zero === undefined ? rsz : m[(R.RSZ[p] + zero) / 4], p, 0, 0); v.dset(info, E.RSZ_UNMODELLED); hdr[HDR.SKIPPED] |= 1 << p; continue;
        }
        if ((rsz & 1 && (sh = need(R.RSZ[p] + 4)) === null) || (rsz & 0x10 && (sv = need(R.RSZ[p] + 12)) === null)) {
          v.dset(info, E.UNWRITTEN); hdr[HDR.SKIPPED] |= 1 << p; continue;
        }
        if (!sh || !sv || ((sh | sv) >>> 16)) { cerror(E.RSZ_UNMODELLED, R.RSZ[p], sh, sv, p, 0); v.dset(info, E.RSZ_UNMODELLED); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      }
      if (sel & ~P.bit) { cerror(E.OSDCP2_FIELD, P.sel, sel, p, 0, 0); v.dset(info, E.OSDCP2_FIELD); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      const cols = new Int32Array(pw);
      for (let i = 0; i < pw; i++) cols[i] = osdCol(i, sh);
      const sw = cols[pw - 1] + 1, lastRow = Math.floor((ph - 1) * sv / 4096);
      if (!stride || !v.bus.span(base, lastRow * stride + sw)) { cerror(E.DMA_RANGE, R.DMA12 + 4 * q, base, stride, p, 0); v.dset(info, E.DMA_RANGE); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      // the shown bank: its first word's index in the channel's storage and in its palette flags
      const bankOff = P.banks[sel & P.bit ? 1 : 0], first = (bankOff - STORE_BASE) / 4;
      const x0 = xs - ox, y0 = ys - oy, pal = ch.store, pf = v.palFlags(c) + first;
      v.dset(info, 0x100);
      [x0, y0, pw, ph, base, stride, BOARD.vsc.base + BOARD.vsc.stride * c + bankOff].forEach((x, i) => v.dset(info + 4 + 4 * i, x));
      const row = new Uint8Array(sw);
      let unwritten = 0, firstUnwritten = 0, outside = 0, firstOutside = 0;
      for (let j = 0; j < ph; j++) {
        v.bus.read((base + Math.floor(j * sv / 4096) * stride) >>> 0, row, 0, sw);
        const d0 = (y0 + j) * vw + x0;
        for (let i = 0; i < pw; i++) {
          let idx = row[cols[i]];
          if (P.mask !== null) idx &= P.mask;
          else if (idx >= P.entries) { if (!outside++) firstOutside = idx; continue; }
          if (!v.dbg[pf + idx]) { if (!unwritten++) firstUnwritten = idx; continue; }
          const word = pal[first + idx], tr = ((word >>> 24) & 0x1F) << 16, dst = out[d0 + i];
          out[d0 + i] = L[tr | (word & 0xFF) << 8 | (dst & 0xFF)] | L[tr | (word >>> 8 & 0xFF) << 8 | (dst >>> 8 & 0xFF)] << 8
            | L[tr | (word >>> 16 & 0xFF) << 8 | (dst >>> 16 & 0xFF)] << 16;
        }
      }
      if (unwritten) { cerror(E.PAL_UNWRITTEN, bankOff, unwritten, p, firstUnwritten, 0); palUnwritten = (palUnwritten + unwritten) >>> 0; }
      if (outside) cerror(E.PAL_FIELD, bankOff, outside, p, firstOutside, 0);
      hdr[HDR.DRAWN] |= 1 << p;
    }
  }
  hdr[HDR.ERRORS] = errors;
  hdr[HDR.PAL_UNWRITTEN] = palUnwritten;
  hdr[HDR.STATUS] = status;
  for (let i = 0; i < 16; i++) v.dset(D.HDR + 4 * i, hdr[i]);
  v.dset(chanDbg(c, CH.COMPOSE), status ? status : (errors ? 0x200 | errors : 0x100));
  return status;
}
