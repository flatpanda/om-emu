// Bytes: hex text of a Uint8Array and back, base64 text and back, and little-endian struct packing (pack / unpack /
// unpackFrom) of the formats the lab reads and writes guest memory in.
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export function bytesHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += HEX[b[i]]; return s; }
export function hexBytes(s) {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}

// base64 (RFC 4648 section 4, padded) of bytes, and the bytes of such a text: null for a text that is not one (a
// length that is not a multiple of 4, a character outside the alphabet, padding other than at the end). Byte payloads
// in the hosts' JSON messages (the card's files, src/lab/player.mjs cardfiles; web/nvram.mjs)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));
export function bytesBase64(b) {
  const parts = [];
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (i + 1 < b.length ? b[i + 1] << 8 : 0) | (i + 2 < b.length ? b[i + 2] : 0);
    parts.push(B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < b.length ? B64[n >> 6 & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '='));
  }
  return parts.join('');
}
export function base64Bytes(s) {
  if (typeof s !== 'string' || s.length % 4) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(s.length / 4 * 3 - pad);
  for (let i = 0, o = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = s[i + k], last = i + 4 === s.length;
      const v = c === '=' && last && k >= 4 - pad ? 0 : B64_VALUE.get(c);
      if (v === undefined) return null;
      n = n << 6 | v;
    }
    out[o++] = n >> 16 & 255;
    if (o < out.length) out[o++] = n >> 8 & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// pack / unpack / unpackFrom for little-endian formats of B, H, h, I, i, Q and x pad bytes (e.g. '<BxxxII'). pack
// refuses a value outside the code's range or not an integer, and a wrong number of values; it never wraps. A boolean
// packs as 0 / 1. The refusals are StructError (a RangeError: the caller's bug, not a failure the lab reports).
export class StructError extends RangeError { get name() { return 'StructError'; } }
const RANGE = { B: [0, 255], H: [0, 65535], h: [-32768, 32767], I: [0, 4294967295], i: [-2147483648, 2147483647],
  Q: [0, 18446744073709551615n] };
export function pack(fmt, ...values) {
  const codes = parseFmt(fmt), size = codes.reduce((s, c) => s + SIZES[c], 0);
  const want = codes.filter((c) => c !== 'x').length;
  if (values.length !== want) throw new StructError(`pack expected ${want} items for packing (got ${values.length})`);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let o = 0, i = 0;
  for (const c of codes) {
    if (c !== 'x') {
      let v = values[i++];
      if (typeof v === 'boolean') v = +v;
      if (!Number.isInteger(v)) throw new StructError('required argument is not an integer');
      const [lo, hi] = RANGE[c];
      if (v < lo || v > hi) throw new StructError(`'${c}' format requires ${lo} <= number <= ${hi}`);
      if (c === 'Q' && v > Number.MAX_SAFE_INTEGER) throw new RangeError(`pack: 'Q' value ${v} is not exact in a Number`);
      if (c === 'B') dv.setUint8(o, v); else if (c === 'H') dv.setUint16(o, v, true); else if (c === 'h') dv.setInt16(o, v, true);
      else if (c === 'I') dv.setUint32(o, v, true); else if (c === 'i') dv.setInt32(o, v, true);
      else if (c === 'Q') { dv.setUint32(o, v % 4294967296, true); dv.setUint32(o + 4, Math.floor(v / 4294967296), true); }
    }
    o += SIZES[c];
  }
  return out;
}
// unpack(fmt, b): b must be exactly the format's size. unpackFrom(fmt, b, offset): at least that many bytes from offset
// (a negative offset counts from the end). The errors are StructError; a 'Q' value above 2^53 throws RangeError (a
// Number cannot hold it exactly).
export function unpack(fmt, b) {
  const codes = parseFmt(fmt), size = codes.reduce((s, c) => s + SIZES[c], 0);
  if (b.length !== size) throw new StructError(`unpack requires a buffer of ${size} bytes`);
  return readFields(codes, b, 0);
}
export function unpackFrom(fmt, b, offset = 0) {
  const codes = parseFmt(fmt), size = codes.reduce((s, c) => s + SIZES[c], 0);
  let o = offset;
  if (o < 0) {
    if (o + b.length < 0) throw new StructError(`offset ${o} out of range for ${b.length}-byte buffer`);
    if (o + size > 0) throw new StructError(`not enough data to unpack ${size} bytes at offset ${o}`);
    o += b.length;
  } else if (b.length - o < size) {
    throw new StructError(`unpack_from requires a buffer of at least ${size + o} bytes for unpacking ${size} bytes at offset ${o} (actual buffer size is ${b.length})`);
  }
  return readFields(codes, b, o);
}
function readFields(codes, b, o) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  for (const c of codes) {
    if (c === 'B') out.push(dv.getUint8(o)); else if (c === 'H') out.push(dv.getUint16(o, true));
    else if (c === 'h') out.push(dv.getInt16(o, true)); else if (c === 'I') out.push(dv.getUint32(o, true));
    else if (c === 'i') out.push(dv.getInt32(o, true));
    else if (c === 'Q') {
      const hi = dv.getUint32(o + 4, true);
      if (hi >= 0x200000) throw new RangeError(`unpack: 'Q' value at offset ${o} is not exact in a Number`);
      out.push(dv.getUint32(o, true) + hi * 4294967296);
    }
    o += SIZES[c];
  }
  return out;
}
const SIZES = { B: 1, H: 2, h: 2, I: 4, i: 4, Q: 8, x: 1 };
function parseFmt(fmt) {
  if (fmt[0] !== '<') throw new Error('pack: little-endian formats only');
  const out = [];
  for (const m of fmt.slice(1).matchAll(/(\d*)([BHhIiQx])/g)) for (let k = 0; k < (m[1] ? +m[1] : 1); k++) out.push(m[2]);
  return out;
}
