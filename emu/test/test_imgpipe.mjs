// The pipeline block's and the JPEG codec's model (src/dev/imgpipe.mjs S-IMGPIPE; docs/hle-gaps.md 4.8.13) on a bare
// machine, and the lab's baseline JPEG decoder (src/lab/jpeg.mjs decodeJpeg) against the independent one
// (refs/jpeg.mjs). The register writes are in the order the firmware's driver makes them for the play module's view
// decode: the clock words and the unit masks (0x5048d48a, 0x5048134d), the program's words, the codec's start
// (0x5050a2ba), the go (0x5048198b), the handler's acknowledge (0x5048bb88) and the end (0x504814ef). Checks:
//   the decoder: the lab's own stream (every block its mean) sample for sample, and streams with AC coefficients,
//   zero runs and all three samplings from a small encoder of the test's own, within 1 level (the two inverse DCTs
//   round apart); its refusals (a progressive frame, a restart interval, a cut stream);
//   the register file and the bus errors around it: a word the driver does not read, an address outside the units'
//   pages, the codec's encode words, another access width; the commit word's low byte reading 0;
//   a decode of 160 x 96 to 80 x 48 (the prefilter's row for a ratio of 2) and one to 160 x 96 (no prefilter): the
//   destination's bytes against the test's own computation from the independent decoder's samples (the prefilter's
//   taps, the map's steps and start as the words give them, linear interpolation: A-IMGPIPE-2's arithmetic written
//   apart), nothing written beside the rows, the end RUN_NS of lab time after the go (A-IMGPIPE-1), the resizer's and
//   the block's status, IRQ 288 while a status and its enable are set, write 1 to clear;
//   the refusals, each for its reason: a go without the codec's start, other unit masks (the detail view's), a
//   program word not written since the last run, the 4:2:0 mode, a crop, a rotation, the image format 3330, a work
//   buffer on the lab's memory, a stream that is not 4:2:2, a destination off the bus's memory, taps that do not make
//   128, a pre-reduced source, a start while a run is in progress.
// The firmware's own driver on the model runs in test_camapp.mjs (playDecodeSession, control camapp 3).
//   node emu/test/test_imgpipe.mjs
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { RUN_NS, P, J } from '../src/dev/imgpipe.mjs';
import { jpegOfFrame, decodeJpeg } from '../src/lab/jpeg.mjs';
import { decodeJpeg as refDecode } from '../refs/jpeg.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

// ---- a baseline encoder of the test's own (T.81): 8-bit YCbCr planes at full resolution in, one interleaved scan of
// sampling [h, v] for Y (1 x 1 for the chroma), one quantization table q for all, Huffman tables of one code length
// (every DC category a 4-bit code, every AC symbol an 8-bit code: legal, since neither uses its all-ones code)
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42,
  49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const AC_SYMBOLS = (() => { const v = [0x00, 0xf0]; for (let r = 0; r < 16; r++) for (let s = 1; s <= 10; s++) v.push(r << 4 | s); return v; })();
function encodeJpeg(w, h, planes, [hs, vs], q) {
  const out = [];
  let acc = 0, n = 0;
  const put = (code, len) => { for (let i = len - 1; i >= 0; i--) { acc = acc << 1 | ((code >> i) & 1); if (++n === 8) { out.push(acc); if (acc === 0xff) out.push(0); acc = 0; n = 0; } } };
  const bits = (v) => { const m = Math.abs(v), s = m ? 32 - Math.clz32(m) : 0; return [s, v < 0 ? v + (1 << s) - 1 : v]; };
  const fdct = (blk) => {
    const F = new Array(64);
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += blk[8 * y + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      F[8 * v + u] = Math.round((s * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2)) / 4 / q);
    }
    return F;
  };
  // the component's plane at its own resolution: the mean of each hs x vs cell for the chroma
  const sub = (p, fx, fy) => {
    const cw = Math.ceil(w / fx), ch = Math.ceil(h / fy), o = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0, k = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { const xx = Math.min(w - 1, x * fx + i), yy = Math.min(h - 1, y * fy + j); s += p[yy * w + xx]; k++; }
      o[y * cw + x] = Math.round(s / k);
    }
    return [o, cw, ch];
  };
  const comps = [[...sub(planes[0], 1, 1), hs, vs], [...sub(planes[1], hs, vs), 1, 1], [...sub(planes[2], hs, vs), 1, 1]];
  const pred = [0, 0, 0];
  for (let my = 0; my < Math.ceil(h / (8 * vs)); my++) for (let mx = 0; mx < Math.ceil(w / (8 * hs)); mx++) {
    comps.forEach(([p, cw, ch, ch_, cv], ci) => {
      for (let by = 0; by < cv; by++) for (let bx = 0; bx < ch_; bx++) {
        const blk = new Array(64);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[8 * y + x] = p[Math.min(ch - 1, (my * cv + by) * 8 + y) * cw + Math.min(cw - 1, (mx * ch_ + bx) * 8 + x)] - 128;
        const F = fdct(blk), [s, v] = bits(F[0] - pred[ci]);
        pred[ci] = F[0];
        put(s, 4); put(v, s);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const c = Math.max(-1023, Math.min(1023, F[ZZ[k]]));
          if (!c) { run++; continue; }
          for (; run > 15; run -= 16) put(AC_SYMBOLS.indexOf(0xf0), 8);
          const [cs, cv2] = bits(c);
          put(AC_SYMBOLS.indexOf(run << 4 | cs), 8); put(cv2, cs);
          run = 0;
        }
        if (run) put(0, 8);                      // EOB, the first symbol
      }
    });
  }
  while (n) put(1, 1);
  const seg = (m, b) => [0xff, m, (b.length + 2) >> 8, (b.length + 2) & 255, ...b];
  const dc = [0x00, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 12 }, (_, i) => i)];
  const ac = [0x10, 0, 0, 0, 0, 0, 0, 0, AC_SYMBOLS.length, 0, 0, 0, 0, 0, 0, 0, 0, ...AC_SYMBOLS];
  return Uint8Array.from([0xff, 0xd8, ...seg(0xdb, [0, ...new Array(64).fill(q)]),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, hs << 4 | vs, 0, 2, 0x11, 0, 3, 0x11, 0]), ...seg(0xc4, dc), ...seg(0xc4, ac),
    ...seg(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]), ...out, 0xff, 0xd9]);
}
// a picture with edges, ramps and texture: Y, Cb, Cr planes of w x h
function picture(w, h) {
  const p = [new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    p[0][y * w + x] = ((x * 5 + y * 3) & 255) ^ ((x >> 3 ^ y >> 2) & 1 ? 0x55 : 0) ^ ((x * 7919 + y * 104729) >> 4 & 15);
    p[1][y * w + x] = (128 + 100 * Math.sin(x / 9) * Math.cos(y / 7)) | 0;
    p[2][y * w + x] = (x * 255 / w) | 0;
  }
  return p;
}
// the lab's live-view rows (Y Cb / Y Cr) of a picture's planes
const rowsOf = (w, h, [py, pb, pr]) => Array.from({ length: h }, (_, y) => { const r = new Uint8Array(2 * w); for (let x = 0; x < w; x++) { r[2 * x] = py[y * w + x]; r[2 * x + 1] = (x & 1 ? pr : pb)[y * w + (x & ~1)]; } return r; });

export function jpegUnits() {
  const t = tester(), { ok } = t;
  const [w, h] = [150, 70], pic = picture(w, h);
  // the lab's own stream: block means only, with its own tables: sample for sample
  const lab = jpegOfFrame([w, h, rowsOf(w, h, pic)]), a = decodeJpeg(lab), b = refDecode(lab);
  const same = (x, y) => x.components.length === y.components.length && x.components.every((c, i) => c.width === y.components[i].width && c.height === y.components[i].height
    && c.h === y.components[i].h && c.v === y.components[i].v && c.samples.every((s, k) => s === y.components[i].samples[k]));
  ok(a.width === w && a.height === h && a.bytes === lab.length && same(a, b), `the lab's stream (${lab.length} bytes): ${a.width} x ${a.height}, ${a.bytes} bytes read, the independent decoder's samples`);
  // AC coefficients, zero runs, the three samplings
  for (const [hs, vs, q] of [[2, 1, 3], [1, 1, 5], [2, 2, 2], [2, 1, 24]]) {
    const s = encodeJpeg(w, h, pic, [hs, vs], q), x = decodeJpeg(s), y = refDecode(s);
    let worst = 0, off = 0, total = 0, err = 0;
    x.components.forEach((c, i) => c.samples.forEach((v, k) => { const d = Math.abs(v - y.components[i].samples[k]); worst = Math.max(worst, d); if (d) off++; total++; }));
    for (let k = 0; k < w * h; k++) err += Math.abs(x.components[0].samples[k] - pic[0][k]);
    ok(x.bytes === s.length && x.components[0].h === hs && x.components[0].v === vs && worst <= 1 && off * 1000 < total && err / (w * h) < 2 * q,
      `sampling ${hs}x${vs}, quantizer ${q} (${s.length} bytes): ${off} of ${total} samples differ from the independent decoder's, at most ${worst}; mean luma error against the picture ${(err / (w * h)).toFixed(2)}`);
  }
  // refusals
  const s = encodeJpeg(w, h, pic, [2, 1], 3), refused = (bytes, re) => { try { decodeJpeg(bytes); return false; } catch (e) { return e instanceof RangeError && re.test(e.message); } };
  const prog = Uint8Array.from(s); prog[prog.indexOf(0xc0, 2)] = 0xc2;
  const dri = Uint8Array.from([...s.subarray(0, 2), 0xff, 0xdd, 0, 4, 0, 8, ...s.subarray(2)]);
  ok(refused(prog, /SOF2/) && refused(dri, /restart interval/) && refused(s.subarray(0, s.length - 9), /the data ends before/) && refused(s.subarray(1), /no SOI/),
    'a progressive frame, a restart interval, a cut stream and a missing SOI are refused');
  return { checks: t.checks, bad: t.bad };
}

// ---- A-IMGPIPE-2's arithmetic, written apart from the model: the prefilter's taps and the linear interpolation
const TAPS = { 2048: [64, 34, -2], 1024: null };   // the library's rows for a ratio of 2 (thresholds 1909 < 2048 <= 2068) and of 1
export function expectedView(pic, dw, dh, taps) {
  const [cy, cb, cr] = pic.components, w = pic.width, h = pic.height;
  const filt = (c) => {
    if (!taps) return c.samples;
    const [c0, c1, c2] = taps;
    const pass = (src, horizontal) => {
      const o = new Uint8Array(src.length);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const g = (k) => (horizontal ? src[y * c.width + Math.max(0, Math.min(c.width - 1, x + k))] : src[Math.max(0, Math.min(c.height - 1, y + k)) * c.width + x]);
        o[y * c.width + x] = Math.max(0, Math.min(255, Math.floor((c2 * (g(-2) + g(2)) + c1 * (g(-1) + g(1)) + c0 * g(0) + 64) / 128)));
      }
      return o;
    };
    return pass(pass(c.samples, true), false);
  };
  const Y = filt(cy), B = filt(cb), R = filt(cr);
  const ax = Math.floor(((w - 1) * 100 * 4096) / ((dw - 1) * 100)), ay = Math.floor(((h - 1) * 100 * 4096) / ((dh - 1) * 100));
  const x0 = (w - 1) * 2048 + Math.trunc((ax * -(dw - 1)) / 2), y0 = (h - 1) * 2048 + Math.trunc((ay * -(dh - 1)) / 2);
  const tap = (s, sw, sh, X, Yq) => {
    const xi = Math.floor(X / 4096), fx = X - xi * 4096, yi = Math.floor(Yq / 4096), fy = Yq - yi * 4096, x1 = Math.min(sw - 1, xi + 1), y1 = Math.min(sh - 1, yi + 1);
    const top = s[yi * sw + xi] * (4096 - fx) + s[yi * sw + x1] * fx, bot = s[y1 * sw + xi] * (4096 - fx) + s[y1 * sw + x1] * fx;
    return Math.floor((top * (4096 - fy) + bot * fy + 2 ** 23) / 2 ** 24);
  };
  const out = new Uint8Array(2 * dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const X = x0 + x * ax, Yq = y0 + y * ay, o = 2 * (y * dw + x);
    out[o] = tap(Y, w, h, X, Yq);
    if (!(x & 1)) { const Xc = Math.min(Math.floor(X / 2), (cb.width - 1) * 4096); out[o + 1] = tap(B, cb.width, cb.height, Xc, Yq); out[o + 3] = tap(R, cr.width, cr.height, Xc, Yq); }
  }
  return { out, ax, ay, x0, y0 };
}

export function imgpipeUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { imgpipe: u, intc, clock, bus } = m.devices, irq = BOARD.imgpipe.irq;
  let said = '';
  m.stderr = (s) => { said = s; };
  const rd = (o, w = 4) => u.read(o, w, false), wr = (o, v, w = 4) => u.write(o, v >>> 0, w, false);
  const jrd = (o, w = 4) => u.jread(o, w, false), jwr = (o, v, w = 4) => u.jwrite(o, v >>> 0, w, false);
  const mem = (a, n) => { const b = new Uint8Array(n); bus.read(a, b); return b; };
  ok(u !== undefined && u.cfg.base === 0x9C200000 && u.cfg.codec === 0x99900000 && irq === 288 && !u.touched, 'the machine builds the block and the codec on the E143 board with IRQ 288, untouched');
  // the register file's edges
  ok([0x038, 0x10c, 0x2f4, 0x400, 0xb470, 0x20000].every((o) => throwsAs(() => rd(o), BUS)) && [0x300, 0x1000, 0x2900, 0xb800, 0x1fffc].every((o) => throwsAs(() => wr(o, 0), BUS))
    && throwsAs(() => wr(0x2d8, 1, 2), BUS) && throwsAs(() => rd(0x228, 1), BUS),
    'a word the driver does not read, an address outside the decode\'s units and another width are bus errors');
  ok([0x1014, 0x1058, 0x1200, 0x1c00].every((o) => throwsAs(() => jwr(o, 0), BUS)) && throwsAs(() => jwr(J.encode, 1), BUS) && throwsAs(() => jrd(J.mode2), BUS) && throwsAs(() => jwr(J.mode, 0x8008), BUS),
    'the codec\'s encode words and modes are bus errors');
  wr(0x2f8, 0x2611);
  ok(rd(0x2f8) === 0x2600, `the commit word's low byte reads 0 at once: 0x${rd(0x2f8).toString(16)}`);
  // one request as the driver writes it. q: {stream, w, h, dw, dh, dst, pitch (pixels), work, taps}; over: words
  // written in place of the request's
  const SRC = 0xA0100000, DST = 0x98D4D800, WORK = 0xCFBD5400;
  const request = (q, over = {}, { codec = true, masks = [0x80301, 0x100001, 0x107], skip = [] } = {}) => {
    const e = expectedView(q.pic, q.dw, q.dh, q.taps);
    // the clock words and the unit masks, the mode words' read and write back
    wr(0x2d8, 0x400181); wr(0x2e8, 0x400000); wr(0x2e0, 0x107); wr(0x2f4, 0x200002a); wr(0x2f8, 0x2611); rd(0x2f8);
    wr(0x004, masks[0]); wr(0x014, masks[1]); wr(0x01c, masks[2]); wr(0x2b4, rd(0x2b4) & ~masks[1]); wr(0x228, (rd(0x228) & ~3) | 1);
    const tapw = q.taps ? [(q.taps[1] << 16 | q.taps[0]) >>> 0, q.taps[2] & 0xffff] : [0, 0], pfm = q.taps ? 0x503 : 0x100;
    const words = { [P.stream_mode]: 2, [P.stream]: q.stream, [P.limit0]: 0xffffffff, [P.limit1]: 0xffffffff, [P.mode]: 1, [P.codec]: 0x30001,
      [P.mcu_cols]: Math.ceil(q.w / 16), [P.mcu_rows]: Math.ceil(q.h / 8), [P.work]: q.work >>> 4, [P.src]: q.work >>> 4, [P.src_size]: q.h << 16 | q.w,
      [P.cx]: (q.w - 1) << 3, [P.cy]: (q.h - 1) << 3, [P.ccx]: (q.w - 1) << 3, [P.ccy]: (q.h - 1) << 3, [P.ax]: e.ax, [P.ay]: e.ay, [P.axy]: 0, [P.ayx]: 0, [P.cax]: e.ax, [P.cay]: e.ay,
      [P.x0]: Math.trunc((e.ax * -(q.dw - 1)) / 2), [P.y0]: Math.trunc((e.ay * -(q.dh - 1)) / 2), [P.dcx]: -((q.dw - 1) << 11), [P.dcy]: -((q.dh - 1) << 11),
      [P.dst_size]: q.dh << 16 | q.dw, [P.dst_last]: (q.dh - 1) << 16 | (q.dw - 1), [P.dst]: q.dst >>> 4, [P.format]: 0x1000002, [P.pitch]: Math.ceil(q.pitch / 64) << 3,
      [P.pf]: pfm, [P.pfx]: tapw[0], [P.pfx2]: tapw[1], [P.pfy]: tapw[0], [P.pfy2]: tapw[1], [P.pf_b]: pfm, [P.pfx_b]: tapw[0], [P.pfx2_b]: tapw[1], [P.pfy_b]: tapw[0], [P.pfy2_b]: tapw[1],
      0xb478: 0x1a40003, 0xb47c: 0, 0xb470: 0x47f, ...over };
    for (const [o, v] of Object.entries(words)) if (!skip.includes(+o)) wr(+o, v);
    for (let k = 0; k < 8; k++) wr(0x20000 + 4 * k, 0x1234 + k);                      // the resizer's program: storage
    if (codec) { jwr(J.reset, 4); jwr(J.reset, 0); jwr(J.encode, 0); jwr(J.mode, 0x8004); jwr(J.mode2, 0x8002); jwr(J.lim0, 0xffff); jwr(J.lim1, 0xffff); jwr(J.mode, jrd(J.mode) | 1); }
    wr(0x0c8, 0x102); wr(0x12c, 60); wr(0x034, masks[1]); wr(0x03c, masks[2]); wr(0x0cc, 5); wr(0x024, 0x80000); wr(0x150, 0); wr(0x154, 0); wr(0x13c, 0x100000); wr(0x140, 0);
    wr(0x0e8, 0x100000);
    return e;
  };
  const go = () => wr(0x0f4, 5);
  // the handler's acknowledge (0x5048bb88) and the end's writes (0x504814ef)
  const ack = () => { const s = [0x110, 0x120, 0x12c].map((o) => rd(o)), e = [0x134, 0x13c, 0x140].map((o) => rd(o)); [0x110, 0x120, 0x12c].forEach((o, i) => wr(o, s[i] & e[i])); [0x134, 0x13c, 0x140].forEach((o) => wr(o, 0)); return [s[1] & e[1], rd(0xb47c) & rd(0xb478)]; };
  const end = () => { wr(0x228, rd(0x228) & ~3); wr(0x10c, 0x80301); wr(0x11c, 0x80301); wr(0x120, 0x100001); wr(0x020, 0x80301); wr(0x12c, 0x107); wr(0x030, 0x100001); wr(0x038, 0x107);
    jwr(J.reset, 5); wr(0x000, 0x80301); wr(0x010, 0x100001); wr(0x018, 0x107); wr(0x2dc, 0x400181); wr(0x2e4, 0xffffffff); wr(0x2f0, 0x202aaaa); };
  const [w, h] = [160, 96], planes = picture(w, h), stream = jpegOfFrame([w, h, rowsOf(w, h, planes)]), ac = encodeJpeg(w, h, planes, [2, 1], 3);
  const refused = (re, fn) => { said = ''; const r = throwsAs(fn, BUS); return r && re.test(said) && !u.busy(); };
  for (const [name, bytes, dw, dh, ratio] of [['block means to half size', stream, 80, 48, 2048], ['AC coefficients at the same size', ac, 160, 96, 1024]]) {
    bus.write(SRC, bytes);
    const pitch = 256, sentinel = new Uint8Array(pitch * 2 * dh + 64).fill(0x5a);
    bus.write(DST - 32, sentinel);
    const pic = refDecode(bytes), q = { pic, stream: SRC, w, h, dw, dh, dst: DST, pitch, work: WORK, taps: TAPS[ratio] };
    const t0 = clock.t, runs = u.runs, e = request(q);
    go();
    ok(u.busy() && u.runs === runs + 1 && !intc.high(irq) && rd(0x120) === 0 && rd(0xb47c) === 0 && mem(DST, 4).every((b) => b === 0x5a), `${name}: the go starts a run; nothing is written and no end is raised yet`);
    said = '';
    ok(throwsAs(go, BUS) && /while a run is in progress/.test(said) && u.busy() && u.runs === runs + 1, `${name}: a second go while it runs is a bus error (${said.slice(said.indexOf('('))})`);
    clock.advance(t0 + RUN_NS - 1);
    const early = u.busy();
    clock.advance(t0 + RUN_NS);
    const got = mem(DST - 32, sentinel.length), rowb = 2 * dw;
    let wrong = 0, spilled = 0;
    for (let y = 0; y < dh; y++) for (let x = 0; x < rowb; x++) if (got[32 + y * 2 * pitch + x] !== e.out[y * rowb + x]) wrong++;
    for (let i = 0; i < got.length; i++) { const o = i - 32, inside = o >= 0 && o % (2 * pitch) < rowb && Math.floor(o / (2 * pitch)) < dh; if (!inside && got[i] !== 0x5a) spilled++; }
    const last = u.last();
    ok(early && !u.busy() && wrong === 0 && spilled === 0 && last.stream === SRC && last.bytes === bytes.length && last.width === w && last.dst_width === dw && last.dst_height === dh && last.pitch === 2 * pitch
      && last.step[0] === e.ax && last.from[0] === e.x0 && last.from[1] === e.y0,
      `${name}: after RUN_NS the ${dw} x ${dh} rows are the test's own computation (${wrong} bytes differ, ${spilled} written beside them); the run ${JSON.stringify({ ...last, taps: last.taps })}`);
    ok(rd(0xb47c) === 1 && rd(0x120) === 0x100000 && intc.high(irq), `${name}: the resizer's end and the block's status bit 20 are set, IRQ ${irq} high`);
    const [top, sub] = ack();
    ok(top === 0x100000 && sub === 1 && !intc.high(irq) && rd(0x120) === 0, `${name}: the handler's acknowledge reads them (0x${top.toString(16)}, ${sub}) and clears the line`);
    end();
  }
  // the enable gates the line; a status is cleared by writing 1
  bus.write(SRC, stream);
  const q0 = { pic: refDecode(stream), stream: SRC, w, h, dw: 80, dh: 48, dst: DST, pitch: 256, work: WORK, taps: TAPS[2048] };
  let t0 = clock.t;
  request(q0); wr(0x13c, 0); go(); clock.advance(t0 + RUN_NS);
  const masked = intc.high(irq);
  wr(0x13c, 0x100000);
  const raised = intc.high(irq);
  wr(0x120, 0x100000);
  ok(!masked && raised && !intc.high(irq) && rd(0x120) === 0, 'IRQ 288 follows the status and its enable; writing 1 clears the status');
  end();
  // the refusals, each a bus error at the go for its reason
  const cases = [
    ['a go without the codec\'s start', /without the codec's start/, {}, { codec: false }],
    ['the detail view\'s unit masks', /unit masks/, {}, { masks: [0x80301, 0x101001, 0x107] }],
    ['a program word not written since the last run', /not written since the last run/, {}, { skip: [P.dst] }],
    ['the 4:2:0 mode', /only the 4:2:2 mode/, { [P.mode]: 0, [P.codec]: 0x30000 }],
    ['a crop', /a crop is not modelled/, { [P.src]: (WORK >>> 4) + 8 }],
    ['a rotation', /cross terms/, { [P.axy]: 0x100 }],
    ['the image format 3330', /only the image format 3074/, { [P.format]: 0x1000102 }],
    ['a work buffer on the lab\'s memory', /work buffer .* on the lab's memory/, { [P.work]: 0xA0200000 >>> 4, [P.src]: 0xA0200000 >>> 4 }],
    ['a destination off the bus\'s memory', /not on the bus's memory/, { [P.dst]: 0x90000000 >>> 4 }],
    ['taps that do not make 128', /do not make 128/, { [P.pfx]: 0x220045, [P.pfx_b]: 0x220045 }],
    ['a pre-reduced source', /centres/, { [P.cx]: (w / 2 - 1) << 3, [P.ccx]: (w / 2 - 1) << 3 }],
    ['a stream address off the bus\'s memory', /stream's address is not on the bus's memory/, { [P.stream]: 0x90000000 }],
  ];
  for (const [name, re, over, opt] of cases) {
    request(q0, over, opt);
    ok(refused(re, go), `${name} is refused at the go: ${said.slice(said.indexOf('(')) || 'no bus error'}`);
  }
  bus.write(SRC, encodeJpeg(w, h, planes, [2, 2], 3));
  request(q0);
  ok(refused(/sampling 2x2,1x1,1x1 is not 4:2:2/, go), `a 4:2:0 stream under the 4:2:2 words is refused: ${said.slice(said.indexOf('('))}`);
  bus.write(SRC, new Uint8Array(4096));
  request(q0);
  ok(refused(/no SOI/, go), `a stream without SOI is refused: ${said.slice(said.indexOf('('))}`);
  // and the model runs again after the refusals
  bus.write(SRC, stream);
  t0 = clock.t;
  const e = request(q0);
  go(); clock.advance(t0 + RUN_NS);
  ok(!u.busy() && mem(DST, 160).every((b, i) => b === e.out[i]) && intc.high(irq), 'after the refusals a decode runs as before');
  return { checks: t.checks, bad: t.bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const j = jpegUnits(), r = imgpipeUnits();
  console.log(`the baseline decoder: ${j.checks - j.bad.length}/${j.checks}; the pipeline block (S-IMGPIPE): ${r.checks - r.bad.length}/${r.checks}`);
  [...j.bad, ...r.bad].forEach((x) => console.log('  ', x));
  process.exit(j.bad.length || r.bad.length ? 1 : 0);
}
