// A baseline JPEG (ITU-T T.81, JFIF) of a frame in the lab's live-view format (YCbCr 4:2:2: two bytes per pixel, Y
// then Cb for an even pixel, Y then Cr for an odd one), with each 8 x 8 block reduced to its mean: every block's DCT
// coefficients but the DC one are 0. It is the lab's picture file content (src/lab/storage.mjs S-RECFILE), not the
// camera's development: the image processing does not run in the lab. Pure JS.
//   jpegOfFrame([w, h, rows], { dht }) -> Uint8Array
// dht (optional): a DHT segment (ff c4, its length, then the tables) holding the four tables the stream uses (DC and
// AC, ids 0 and 1), written in place of the lab's own four and used for the coding (the firmware's own tables with the
// play module native, src/lab/playmod.mjs A-JPEGDHT-1; docs/hle-gaps.md 4.8.11). Without it the output is as before.

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
// a DHT segment's tables: (class << 4 | id) -> [bits, vals]; throws on anything but one segment of whole tables
export function dhtTables(segment) {
  const b = segment, out = new Map();
  if (b[0] !== 0xff || b[1] !== 0xc4 || (b[2] << 8 | b[3]) !== b.length - 2) {
    throw new RangeError('dhtTables: not one DHT segment');
  }
  for (let k = 4; k < b.length;) {
    const tc = b[k], bits = [...b.subarray(k + 1, k + 17)], n = bits.reduce((x, y) => x + y, 0);
    if (k + 17 + n > b.length || out.has(tc)) throw new RangeError(`dhtTables: table 0x${tc.toString(16)} at ${k}`);
    out.set(tc, [bits, [...b.subarray(k + 17, k + 17 + n)]]);
    k += 17 + n;
  }
  return out;
}

export function jpegOfFrame([w, h, rows], { dht: given = null } = {}) {
  if (!(w > 0 && h > 0 && w < 65536 && h < 65536)) throw new RangeError(`jpegOfFrame: ${w} x ${h}`);
  const own = given ? dhtTables(given) : null;
  if (own && ![0x00, 0x01, 0x10, 0x11].every((tc) => own.has(tc))) {
    throw new RangeError('jpegOfFrame: the DHT lacks a DC or AC table 0 or 1');
  }
  const at = (x, y) => rows[Math.min(y, h - 1)].subarray(0, 2 * w);
  // the samples of a block's 8 x 8 area, edges replicated: Y at a pixel; Cb or Cr at a chroma column (half width)
  const mean = (x0, y0, pick) => {
    let s = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += pick(x0 + x, y0 + y);
    return s / 64;
  };
  const Y = (x, y) => at(Math.min(x, w - 1), y)[2 * Math.min(x, w - 1)];
  const C = (cx, y, odd) => { const x = Math.min(2 * cx + odd, w - 1 - ((w - 1 - odd) & 1)); return at(x, y)[2 * x + 1]; };
  const tables = own ? [codes(own.get(0x00)), codes(own.get(0x01))] : [codes(DC_LUMA), codes(DC_CHROMA)];
  const eobs = own ? [codes(own.get(0x10)).get(0), codes(own.get(0x11)).get(0)]
    : [codes(AC_EOB).get(0), codes(AC_EOB).get(0)];
  if (eobs.some((e) => !e)) throw new RangeError('jpegOfFrame: an AC table without EOB');
  const bits = new Bits(), pred = [0, 0, 0];
  const block = (comp, m) => {
    const dc = Math.round(m) - 128, diff = dc - pred[comp];
    pred[comp] = dc;
    const mag = Math.abs(diff), cat = mag === 0 ? 0 : 32 - Math.clz32(mag);
    const [code, len] = tables[comp === 0 ? 0 : 1].get(cat);
    bits.put(code, len);
    if (cat) bits.put(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
    const eob = eobs[comp === 0 ? 0 : 1];
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
    ...(given ? given : [...dht(0, 0, DC_LUMA), ...dht(1, 0, AC_EOB), ...dht(0, 1, DC_CHROMA), ...dht(1, 1, AC_EOB)]),
    ...seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
    ...bits.flush(), 0xff, 0xd9];
  return Uint8Array.from(out);
}

// The lab's decoder of a baseline JPEG (T.81: sequential DCT, Huffman coding, 8-bit samples, one interleaved scan),
// for the device that stands at the camera's JPEG codec (src/dev/imgpipe.mjs). Written apart from refs/jpeg.mjs, the
// independent reference the tests check it against (test/test_imgpipe.mjs).
//   decodeJpeg(bytes) -> { width, height, bytes (SOI to EOI), components: [{ id, h, v, width, height, samples }] }
// Each component's samples are at its own resolution (no upsampling, no colour conversion). What it does not decode
// is refused with a RangeError: no SOI, another frame type than SOF0, a sample precision other than 8, 16-bit
// quantization tables, restart intervals, a scan that is not the frame's one interleaved scan, a missing table, a code
// the tables do not hold, data that ends before EOI (the message then says "the data ends before").
const NATURAL = (() => {                         // zigzag index -> natural (row-major) index, T.81 Figure A.6
  const out = new Uint8Array(64);
  let k = 0;
  for (let s = 0; s < 15; s++) {
    for (let i = 0; i <= s; i++) {
      const y = s & 1 ? i : s - i, x = s - y;
      if (x < 8 && y < 8) out[k++] = 8 * y + x;
    }
  }
  return out;
})();
// T.81 Annex F.2.2.3's decode tables of one Huffman table: per code length the smallest code, the largest and the
// index of its first value
function decodeTable(bits, vals) {
  const min = new Int32Array(17), max = new Int32Array(17).fill(-1), first = new Int32Array(17);
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    if (bits[len - 1]) { first[len] = k; min[len] = code; code += bits[len - 1]; k += bits[len - 1]; max[len] = code - 1; }
    code <<= 1;
  }
  return { min, max, first, vals };
}
// A.3.3's inverse DCT of a row or column of 8, in place
const IDCT_C = Float64Array.from({ length: 64 }, (_, i) => ((i & 7) === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * (i >> 3) + 1) * (i & 7) * Math.PI) / 16) / 2);
function idct8(v, o, step, t) {
  for (let x = 0; x < 8; x++) {
    let s = 0;
    for (let u = 0; u < 8; u++) s += IDCT_C[8 * x + u] * v[o + u * step];
    t[x] = s;
  }
  for (let x = 0; x < 8; x++) v[o + x * step] = t[x];
}
const u8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function decodeJpeg(bytes) {
  const be16 = (o) => (bytes[o] << 8) | bytes[o + 1];
  const no = (why) => { throw new RangeError(`decodeJpeg: ${why}`); };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) no('no SOI');
  const quant = [], huff = [[], []];
  let frame = null, at = 2;
  for (;;) {
    if (at + 4 > bytes.length) no('the data ends before a scan');
    if (bytes[at] !== 0xff) no(`no marker at ${at}`);
    const marker = bytes[at + 1], len = be16(at + 2), body = at + 4, end = at + 2 + len;
    if (end > bytes.length) no(`the data ends before the end of segment 0x${marker.toString(16)} at ${at}`);
    if (marker === 0xdb) {
      for (let p = body; p < end; p += 65) {
        if (bytes[p] >> 4) no('a 16-bit quantization table');
        quant[bytes[p] & 15] = bytes.subarray(p + 1, p + 65);
      }
    } else if (marker === 0xc4) {
      for (let p = body; p < end;) {
        const bits = bytes.subarray(p + 1, p + 17);
        let n = 0;
        for (const b of bits) n += b;
        if ((bytes[p] >> 4) > 1) no(`Huffman table class ${bytes[p] >> 4}`);
        huff[bytes[p] >> 4][bytes[p] & 15] = decodeTable(bits, bytes.subarray(p + 17, p + 17 + n));
        p += 17 + n;
      }
    } else if (marker === 0xc0) {
      if (frame) no('a second frame');
      if (bytes[body] !== 8) no(`${bytes[body]}-bit samples`);
      frame = { height: be16(body + 1), width: be16(body + 3), components: [] };
      for (let i = 0, p = body + 6; i < bytes[body + 5]; i++, p += 3) {
        frame.components.push({ id: bytes[p], h: bytes[p + 1] >> 4, v: bytes[p + 1] & 15, tq: bytes[p + 2] });
      }
      if (!frame.width || !frame.height || !frame.components.length) no('an empty frame');
    } else if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc8 && marker !== 0xcc) {
      no(`frame type SOF${marker - 0xc0}: only the baseline SOF0 is decoded`);
    } else if (marker === 0xdd) {
      if (be16(body)) no('a restart interval');
    } else if (marker === 0xda) {
      if (!frame) no('a scan before the frame');
      const n = bytes[body];
      if (n !== frame.components.length) no(`a scan of ${n} of the frame's ${frame.components.length} components`);
      for (let i = 0; i < n; i++) {
        const c = frame.components[i], p = body + 1 + 2 * i;
        if (bytes[p] !== c.id) no('the scan\'s components are not in the frame\'s order');
        c.dc = huff[0][bytes[p + 1] >> 4]; c.ac = huff[1][bytes[p + 1] & 15]; c.q = quant[c.tq];
        if (!c.dc || !c.ac || !c.q) no(`component ${c.id} names a table the headers do not give`);
      }
      if (bytes[body + 1 + 2 * n] !== 0 || bytes[body + 2 + 2 * n] !== 63 || bytes[body + 3 + 2 * n] !== 0) no('not a sequential scan');
      return scanOf(bytes, end, frame, no);
    } else if (marker === 0xd9) no('EOI before a scan');
    at = end;
  }
}

function scanOf(bytes, start, frame, no) {
  let p = start, acc = 0, left = 0;
  const bit = () => {
    if (left === 0) {
      if (p >= bytes.length) no('the data ends before the last block');
      acc = bytes[p++];
      if (acc === 0xff) {
        if (bytes[p] !== 0) no(`marker 0x${(bytes[p] ?? 0).toString(16)} inside the entropy data at ${p - 1}`);
        p += 1;
      }
      left = 8;
    }
    left -= 1;
    return (acc >> left) & 1;
  };
  const symbol = (t) => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | bit();
      if (code <= t.max[len]) return t.vals[t.first[len] + code - t.min[len]];
    }
    return no('a code no Huffman table holds');
  };
  const value = (size) => {                      // F.2.2.1's RECEIVE and EXTEND
    if (!size) return 0;
    let v = 0;
    for (let i = 0; i < size; i++) v = (v << 1) | bit();
    return v < (1 << (size - 1)) ? v - (1 << size) + 1 : v;
  };
  const hmax = Math.max(...frame.components.map((c) => c.h)), vmax = Math.max(...frame.components.map((c) => c.v));
  const cols = Math.ceil(frame.width / (8 * hmax)), rows = Math.ceil(frame.height / (8 * vmax));
  for (const c of frame.components) {
    c.width = Math.ceil((frame.width * c.h) / hmax); c.height = Math.ceil((frame.height * c.v) / vmax);
    c.pitch = cols * c.h * 8; c.plane = new Uint8Array(c.pitch * rows * c.v * 8); c.pred = 0;
  }
  const block = new Float64Array(64), t = new Float64Array(8);
  for (let my = 0; my < rows; my++) for (let mx = 0; mx < cols; mx++) {
    for (const c of frame.components) for (let by = 0; by < c.v; by++) for (let bx = 0; bx < c.h; bx++) {
      c.pred += value(symbol(c.dc));
      let last = 0;                              // the highest zigzag index that holds a coefficient
      for (let k = 1; k < 64; k++) {
        const rs = symbol(c.ac), run = rs >> 4, size = rs & 15;
        if (!size) { if (run !== 15) break; k += 15; continue; }
        k += run;
        if (k > 63) no('a run past the block\'s end');
        if (!last) block.fill(0);
        block[NATURAL[k]] = value(size) * c.q[k];
        last = k;
      }
      const o = (my * c.v + by) * 8 * c.pitch + (mx * c.h + bx) * 8, dc = c.pred * c.q[0];
      if (!last) {                               // the DC coefficient alone: every sample its level
        const s = u8(Math.round(dc / 8 + 128));
        for (let y = 0; y < 8; y++) c.plane.fill(s, o + y * c.pitch, o + y * c.pitch + 8);
        continue;
      }
      block[0] = dc;
      for (let y = 0; y < 8; y++) idct8(block, 8 * y, 1, t);
      for (let x = 0; x < 8; x++) idct8(block, x, 8, t);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c.plane[o + y * c.pitch + x] = u8(Math.round(block[8 * y + x] + 128));
    }
  }
  // the bytes the scan's last bits came from, then EOI (a fill byte or two before it is passed over)
  while (p < bytes.length && bytes[p] === 0xff && bytes[p + 1] === 0xff) p += 1;
  if (p + 2 > bytes.length) no('the data ends before EOI');
  if (bytes[p] !== 0xff || bytes[p + 1] !== 0xd9) no(`no EOI after the last block (at ${p})`);
  return { width: frame.width, height: frame.height, bytes: p + 2,
    components: frame.components.map((c) => {
      const samples = new Uint8Array(c.width * c.height);
      for (let y = 0; y < c.height; y++) samples.set(c.plane.subarray(y * c.pitch, y * c.pitch + c.width), y * c.width);
      return { id: c.id, h: c.h, v: c.v, width: c.width, height: c.height, samples };
    }) };
}
