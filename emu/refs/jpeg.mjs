// An independent decoder of baseline JPEG (ITU-T T.81: sequential DCT, Huffman, 8-bit samples), written from the
// standard's text, for checking the picture files on the lab's card (refs/fat.mjs reads them). It imports only refs/
// (test_pure.mjs). It returns each component's samples at its own resolution (no colour conversion, no upsampling):
// {width, height, components: [{id, h, v, width, height, samples}]}, and refuses what it does not decode (progressive,
// arithmetic, 12-bit, restart intervals).
import { ValueError } from './errors.mjs';

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14,
  21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63];

// Annex C: a table's codes, as a map from (length << 16 | code) to the symbol
function huffman(bits, vals) {
  const map = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) map.set(len << 16 | code++, vals[k++]);
    code <<= 1;
  }
  return map;
}

// A.3.3's IDCT of one block (coefficients in natural order), level-shifted and clamped to 0..255
const COS = Float64Array.from({ length: 64 }, (_, i) => (i % 8 === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * (i >> 3) + 1) * (i % 8) * Math.PI / 16));
function idct(F) {
  const out = new Uint8Array(64), nz = [];
  for (let i = 0; i < 64; i++) if (F[i]) nz.push(i);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0;
    for (const i of nz) s += F[i] * COS[x * 8 + (i & 7)] * COS[y * 8 + (i >> 3)];
    out[y * 8 + x] = Math.min(255, Math.max(0, Math.round(s / 4 + 128)));
  }
  return out;
}

export function decodeJpeg(bytes) {
  const u16 = (o) => bytes[o] << 8 | bytes[o + 1];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ValueError('decodeJpeg: no SOI');
  const qt = [], dc = [], ac = [];
  let frame = null, o = 2;
  for (;;) {
    if (bytes[o] !== 0xff) throw new ValueError(`decodeJpeg: no marker at ${o}`);
    const m = bytes[o + 1];
    if (m === 0xd9) throw new ValueError('decodeJpeg: EOI before a scan');
    const len = u16(o + 2), body = o + 4, end = o + 2 + len;
    if (m === 0xdb) {
      for (let p = body; p < end;) {
        const pq = bytes[p] >> 4, tq = bytes[p] & 15;
        if (pq) throw new ValueError('decodeJpeg: 16-bit quantization table');
        qt[tq] = Array.from(bytes.subarray(p + 1, p + 65)); p += 65;
      }
    } else if (m === 0xc4) {
      for (let p = body; p < end;) {
        const tc = bytes[p] >> 4, th = bytes[p] & 15, bits = Array.from(bytes.subarray(p + 1, p + 17));
        const n = bits.reduce((a, b) => a + b, 0), vals = Array.from(bytes.subarray(p + 17, p + 17 + n));
        (tc === 0 ? dc : ac)[th] = huffman(bits, vals); p += 17 + n;
      }
    } else if (m === 0xc0) {
      if (bytes[body] !== 8) throw new ValueError(`decodeJpeg: ${bytes[body]}-bit samples`);
      const height = u16(body + 1), width = u16(body + 3), n = bytes[body + 5], components = [];
      for (let i = 0; i < n; i++) { const p = body + 6 + 3 * i; components.push({ id: bytes[p], h: bytes[p + 1] >> 4, v: bytes[p + 1] & 15, tq: bytes[p + 2] }); }
      frame = { width, height, components };
    } else if (m === 0xdd) {
      if (u16(body)) throw new ValueError('decodeJpeg: restart intervals are not decoded here');
    } else if (m >= 0xc1 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      throw new ValueError(`decodeJpeg: SOF${m - 0xc0} is not baseline`);
    } else if (m === 0xda) {
      if (!frame) throw new ValueError('decodeJpeg: SOS before SOF');
      const ns = bytes[body], scomp = [];
      for (let i = 0; i < ns; i++) { const p = body + 1 + 2 * i, c = frame.components.find((x) => x.id === bytes[p]); scomp.push({ c, td: bytes[p + 1] >> 4, ta: bytes[p + 1] & 15 }); }
      if (bytes[body + 1 + 2 * ns] !== 0 || bytes[body + 2 + 2 * ns] !== 63) throw new ValueError('decodeJpeg: not a sequential scan');
      return scan(bytes, end, frame, scomp, qt, dc, ac);
    }
    o = end;
  }
}

function scan(bytes, start, frame, scomp, qt, dcT, acT) {
  let p = start, acc = 0, nbits = 0, marker = false;
  const bit = () => {
    if (nbits === 0) {
      if (marker) throw new ValueError('decodeJpeg: the entropy data ends early');
      let b = bytes[p++];
      if (b === 0xff) { const n = bytes[p]; if (n === 0) p++; else { marker = true; b = 0xff; } }
      acc = b; nbits = 8;
    }
    nbits -= 1;
    return (acc >> nbits) & 1;
  };
  const decode = (t) => {
    let code = 0;
    for (let len = 1; len <= 16; len++) { code = code << 1 | bit(); const s = t.get(len << 16 | code); if (s !== undefined) return s; }
    throw new ValueError('decodeJpeg: no Huffman code');
  };
  const receive = (s) => { let v = 0; for (let i = 0; i < s; i++) v = v << 1 | bit(); return v; };
  const extend = (v, s) => (s && v < 1 << (s - 1) ? v - (1 << s) + 1 : v);
  const hmax = Math.max(...frame.components.map((c) => c.h)), vmax = Math.max(...frame.components.map((c) => c.v));
  const mx = Math.ceil(frame.width / (8 * hmax)), my = Math.ceil(frame.height / (8 * vmax));
  for (const c of frame.components) {
    c.width = Math.ceil(frame.width * c.h / hmax); c.height = Math.ceil(frame.height * c.v / vmax);
    c.bw = mx * c.h * 8; c.samples = new Uint8Array(c.bw * my * c.v * 8); c.pred = 0;
  }
  for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) {
    for (const { c, td, ta } of scomp) {
      for (let by = 0; by < c.v; by++) for (let bx = 0; bx < c.h; bx++) {
        const F = new Float64Array(64), q = qt[c.tq];
        const t = decode(dcT[td]);
        c.pred += extend(receive(t), t);
        F[0] = c.pred * q[0];
        for (let k = 1; k < 64;) {
          const rs = decode(acT[ta]), r = rs >> 4, s = rs & 15;
          if (s === 0) { if (r === 15) { k += 16; continue; } break; }
          k += r;
          F[ZIGZAG[k]] = extend(receive(s), s) * q[k];
          k += 1;
        }
        const px = idct(F), ox = (x * c.h + bx) * 8, oy = (y * c.v + by) * 8;
        for (let i = 0; i < 8; i++) c.samples.set(px.subarray(i * 8, i * 8 + 8), (oy + i) * c.bw + ox);
      }
    }
  }
  return { width: frame.width, height: frame.height,
    components: frame.components.map((c) => {
      const s = new Uint8Array(c.width * c.height);
      for (let y = 0; y < c.height; y++) s.set(c.samples.subarray(y * c.bw, y * c.bw + c.width), y * c.width);
      return { id: c.id, h: c.h, v: c.v, width: c.width, height: c.height, samples: s };
    }) };
}
