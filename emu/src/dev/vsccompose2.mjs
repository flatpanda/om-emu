// COMPOSE(c) of the kind-2 VSC (E144, src/fw/board.mjs): the latched registers of channel c mixed into the output
// RAM as vsccompose.mjs does for E143 (u32 Cr << 16 | Cb << 8 | Y per pixel of the video area, the same debug-window
// header and plane records). The register meanings below were read from E144's code and from the values its display
// stack writes (D: code, X: a lab run's register dump):
//   video area     AREA22 {hstart << 16 | width}, AREA23 {vstart << 16 | vstart}, AREA24 height (0x5002293c, D)
//   background     BG1, Cr << 16 | Cb << 8 | Y (X: 0x80800b)
//   DMA enable     DMA7, bit 5 - p for plane p (IMG1..IMG3, OSD1..OSD3; the commit 0x50187cad, D)
//   OSD plane q    address DMA12 + q (a byte address, 0x501879e9 stores it unshifted, D), stride DMA18 + q in 64-byte
//                  units (X: 18 for the 1152-byte records), area AREA10 + 3q in the video area's three-word form,
//                  enable word OSD7 + q (0 = not drawn, I by analogy with E143's PLANC), scaler RSZ18/24/30 (0 = 1:1, X)
//   palette q      128 words at +0x800 + 0x800 q, the second bank +0x200 when bit 4 of OSD14 / OSD16 / OSD18 is set
//                  (the writer 0x50023685 fills the other bank, the commit 0x50187eda flips the bit, D); a word is
//                  tra << 24 | Cr << 16 | Cb << 8 | Y with tra 0..31 as on E143 (X)
//   pixel index    the low 7 bits of the 8-bit pixel (I: the GUI fills with 255 and 127, entry 127 is transparent in
//                  all three palettes, X)
//   mix            OSD4 must hold 0x111111 (the value every open writes, X)
// IMG planes are not modelled yet: an enabled one is skipped with FMT_UNMODELLED.
import { E, NOTE, D, CH, OUTPUT_SIZE, chanDbg } from './vsc.mjs';
import { blendLut } from './vsccompose.mjs';

const R = { DMA7: 0x030, DMA12: 0x044, DMA18: 0x05C, AREA10: 0x0C8, AREA22: 0x0F8, AREA23: 0x0FC, AREA24: 0x100,
  BG1: 0x190, OSD4: 0x1B0, OSD7: 0x2E0, OSD14: 0x364, RSZ: [0x104, 0x118, 0x130, 0x148, 0x160, 0x178] };
const HDR = { CHANNEL: 0, WIDTH: 1, HEIGHT: 2, FRAME: 3, ERRORS: 4, PAL_UNWRITTEN: 5, SKIPPED: 6, DRAWN: 7, OX: 8, OY: 9,
  MIX_FLAGS: 10, T_LO: 11, T_HI: 12, STATUS: 13, ASSUMED: 14, VIEW: 15 };
const PLANES = 6, P_OSD1 = 3, PAL = 0x800;

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
    let a22, a23, a24, bg, dmaen, mix;
    if ((a22 = need(R.AREA22)) === null || (a23 = need(R.AREA23)) === null || (a24 = need(R.AREA24)) === null ||
        (bg = need(R.BG1)) === null || (dmaen = need(R.DMA7)) === null || (mix = need(R.OSD4)) === null) { status = E.UNWRITTEN; break run; }
    const ox = a22 >>> 16, vw = a22 & 0xFFFF, oy = a23 >>> 16, vh = a24 & 0xFFFF;
    if (!vw || !vh || vw * vh * 4 > OUTPUT_SIZE || (a23 & 0xFFFF) !== oy) { cerror(E.WINDOW, R.AREA22, a22, a23, a24, 0); status = E.WINDOW; break run; }
    if (bg >>> 24) { cerror(E.BG_FIELD, R.BG1, bg, 0, 0, 0); status = E.BG_FIELD; break run; }
    if (dmaen & ~0x3F) { cerror(E.DMA_FIELD, R.DMA7, dmaen, 0, 0, 0); status = E.DMA_FIELD; break run; }
    if (mix !== 0x111111) { hdr[HDR.MIX_FLAGS] |= 1; cerror(E.MIX_UNOBSERVED, R.OSD4, mix, 1, 0, 0); }
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
      const q = p - P_OSD1;
      let base, ld, w1, w2, w3, planc, rsz, sel;
      if ((base = need(R.DMA12 + 4 * q)) === null || (ld = need(R.DMA18 + 4 * q)) === null || (w1 = need(R.AREA10 + 12 * q)) === null ||
          (w2 = need(R.AREA10 + 12 * q + 4)) === null || (w3 = need(R.AREA10 + 12 * q + 8)) === null ||
          (planc = need(R.OSD7 + 4 * q)) === null || (rsz = need(R.RSZ[p])) === null || (sel = need(R.OSD14 + 8 * q)) === null) {
        v.dset(info, E.UNWRITTEN); hdr[HDR.SKIPPED] |= 1 << p; continue;
      }
      const xs = w1 >>> 16, ys = w2 >>> 16, pw = w1 & 0xFFFF, ph = w3 & 0xFFFF, stride = ld * 64;
      if (xs < ox || ys < oy || !pw || !ph || xs - ox + pw > vw || ys - oy + ph > vh || (w2 & 0xFFFF) !== ys) {
        cerror(E.WINDOW, R.AREA10 + 12 * q, w1, w2, w3, 0); v.dset(info, E.WINDOW); hdr[HDR.SKIPPED] |= 1 << p; continue;
      }
      if (planc === 0) { v.noteRecord(NOTE.PLANC_ZERO, c, R.OSD7 + 4 * q, p); v.dset(info, 0x101); continue; }
      if (rsz) { cerror(E.RSZ_UNMODELLED, R.RSZ[p], rsz, p, 0, 0); v.dset(info, E.RSZ_UNMODELLED); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      if (sel & ~0x10) { cerror(E.OSDCP2_FIELD, R.OSD14 + 8 * q, sel, p, 0, 0); v.dset(info, E.OSDCP2_FIELD); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      if (!stride || !v.bus.span(base, (ph - 1) * stride + pw)) { cerror(E.DMA_RANGE, R.DMA12 + 4 * q, base, stride, p, 0); v.dset(info, E.DMA_RANGE); hdr[HDR.SKIPPED] |= 1 << p; continue; }
      const x0 = xs - ox, y0 = ys - oy, bank = (PAL + 0x800 * q + (sel & 0x10 ? 0x200 : 0)) / 4;
      const pal = ch.store, pf = v.palFlags(c) + bank - PAL / 4;
      v.dset(info, 0x100);
      [x0, y0, pw, ph, base, stride, 0x9C000000 + 0x4000 * c + 4 * bank].forEach((x, i) => v.dset(info + 4 + 4 * i, x));
      const row = new Uint8Array(pw);
      let unwritten = 0, firstUnwritten = 0;
      for (let j = 0; j < ph; j++) {
        v.bus.read((base + j * stride) >>> 0, row, 0, pw);
        const d0 = (y0 + j) * vw + x0;
        for (let i = 0; i < pw; i++) {
          const idx = row[i] & 0x7F, e = bank - PAL / 4 + idx;
          if (!v.dbg[pf + idx]) { if (!unwritten++) firstUnwritten = idx; continue; }
          const word = pal[e], tr = ((word >>> 24) & 0x1F) << 16, dst = out[d0 + i];
          out[d0 + i] = L[tr | (word & 0xFF) << 8 | (dst & 0xFF)] | L[tr | (word >>> 8 & 0xFF) << 8 | (dst >>> 8 & 0xFF)] << 8
            | L[tr | (word >>> 16 & 0xFF) << 8 | (dst >>> 16 & 0xFF)] << 16;
        }
      }
      if (unwritten) { cerror(E.PAL_UNWRITTEN, 4 * bank, unwritten, p, firstUnwritten, 0); palUnwritten = (palUnwritten + unwritten) >>> 0; }
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
