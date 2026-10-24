// A baseline JPEG (ITU-T T.81, JFIF) of a frame in the lab's live-view format (YCbCr 4:2:2: two bytes per pixel, Y
// then Cb for an even pixel, Y then Cr for an odd one), with each 8 x 8 block reduced to its mean: every block's DCT
// coefficients but the DC one are 0. It is the lab's picture file content (src/lab/storage.mjs S-RECFILE), not the
// camera's development: the image processing does not run in the lab. Pure JS.
//   jpegOfFrame([w, h, rows]) -> Uint8Array

// T.81 Annex K.3's DC tables (code lengths 1..16 and the categories), and an AC table with its one symbol, EOB
const DC_LUMA = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const DC_CHROMA = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const AC_EOB = [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0]];
const Q = 8;                                     // every entry of the quantization table: a DC of 8 x (mean - 128)

// T.81 Annex C: the codes of a table, symbol -> [code, length]
function codes([bits, vals]) {
  const out = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) out.set(vals[k++], [code++, len]);
    code <<= 1;
  }
  return out;
}

class Bits {
  constructor() { this.out = []; this.acc = 0; this.n = 0; }
  put(code, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1); this.n += 1;
      if (this.n === 8) { this.out.push(this.acc); if (this.acc === 0xff) this.out.push(0); this.acc = 0; this.n = 0; }
    }
  }
  flush() { while (this.n) this.put(1, 1); return this.out; }
}

const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const dht = (cls, id, [bits, vals]) => seg(0xc4, [cls << 4 | id, ...bits, ...vals]);

export function jpegOfFrame([w, h, rows]) {
  if (!(w > 0 && h > 0 && w < 65536 && h < 65536)) throw new RangeError(`jpegOfFrame: ${w} x ${h}`);
  const at = (x, y) => rows[Math.min(y, h - 1)].subarray(0, 2 * w);
  // the samples of a block's 8 x 8 area, edges replicated: Y at a pixel; Cb or Cr at a chroma column (half width)
  const mean = (x0, y0, pick) => {
    let s = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += pick(x0 + x, y0 + y);
    return s / 64;
  };
  const Y = (x, y) => at(Math.min(x, w - 1), y)[2 * Math.min(x, w - 1)];
  const C = (cx, y, odd) => { const x = Math.min(2 * cx + odd, w - 1 - ((w - 1 - odd) & 1)); return at(x, y)[2 * x + 1]; };
  const tables = [codes(DC_LUMA), codes(DC_CHROMA)], eob = codes(AC_EOB).get(0);
  const bits = new Bits(), pred = [0, 0, 0];
  const block = (comp, m) => {
    const dc = Math.round(m) - 128, diff = dc - pred[comp];
    pred[comp] = dc;
    const mag = Math.abs(diff), cat = mag === 0 ? 0 : 32 - Math.clz32(mag);
    const [code, len] = tables[comp === 0 ? 0 : 1].get(cat);
    bits.put(code, len);
    if (cat) bits.put(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
    bits.put(eob[0], eob[1]);
  };
  for (let my = 0; my < Math.ceil(h / 8); my++) for (let mx = 0; mx < Math.ceil(w / 16); mx++) {
    const x0 = 16 * mx, y0 = 8 * my;
    block(0, mean(x0, y0, Y)); block(0, mean(x0 + 8, y0, Y));
    block(1, mean(x0 >> 1, y0, (cx, y) => C(cx, y, 0)));
    block(2, mean(x0 >> 1, y0, (cx, y) => C(cx, y, 1)));
  }
  const out = [0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, [0, ...new Array(64).fill(Q)]),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x21, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...dht(0, 0, DC_LUMA), ...dht(1, 0, AC_EOB), ...dht(0, 1, DC_CHROMA), ...dht(1, 1, AC_EOB),
    ...seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
    ...bits.flush(), 0xff, 0xd9];
  return Uint8Array.from(out);
}
