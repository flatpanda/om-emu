// The parts of the OSD formats the checks use as their reference (an independent reference: imports
// only refs/, test_pure.mjs): the bitmap format (bitmap_header, make_header, decode_bitmap, encode_bitmap, the token
// layouts), the GUI colour to osddraw palette entry conversion, and Surface, the reference raster of one 8 bpp buffer.
// The runtime parts the lab itself uses (decode_command, gui_palette) are src/lab/osdfmt.mjs.
//
// Buffer semantics: Surface writes are slice assignments (a slice past the end is cut, and a source of another length
// resizes the buffer); a read past the end of a byte buffer is an IndexError for an index (data[i]) and comes back
// short for a slice; byte values outside 0..255 are refused.
import { ValueError, KeyError, IndexError } from './errors.mjs';

export const STRIDE = 1664, WIDTH = 1600, HEIGHT = 1200;
export const ERRORS = ['NONE', 'REG_UNKNOWN', 'REG_READ_UNUSED', 'START_MODE', 'TRIGGER', 'FIFO_OVERFLOW', 'LIST_NO_END',
  'OPCODE_UNKNOWN', 'OPCODE_UNMODELED', 'WORD_BITS', 'DEPTH', 'COLOR_HIGH', 'SIZE_4096', 'DMA_RANGE', 'GUARD',
  'COPY_OVERLAP', 'BMP_FORMAT', 'BMP_SCALE', 'BMP_LUT', 'BMP_TOKEN', 'BMP_TRANSPARENCY', 'SEQUENCE', 'DEBUG_CPU_WRITE'];
export const ERROR_CODE = Object.fromEntries(ERRORS.map((n, i) => [n, i]));
// format -> [token bits, run bits, tokens per 64-bit word (null: a byte stream)]; 0x09 the E144 family's 2-bit colour
// over a 6-bit run (src/dev/engine.mjs)
export const TOKEN = new Map([[0x02, [8, 4, null]], [0x0A, [8, 4, null]], [0x09, [8, 6, null]], [0x03, [10, 2, 6]], [0x0B, [12, 4, 5]]]);
export const SHOOTING_PALETTE_FOR_PLANE = new Map([[0, 61], [1, 62], [2, 63]]);

const byteAt = (data, i) => { if (i < 0 ? i + data.length < 0 : i >= data.length) throw new IndexError('index out of range'); return data[i < 0 ? i + data.length : i]; };
// bytes([...]): every value must be an int in range(0, 256)
function bytesOf(values) {
  for (const v of values) if (!Number.isInteger(v) || v < 0 || v > 255) throw new ValueError('bytes must be in range(0, 256)');
  return Uint8Array.from(values);
}
// b[a:e] as a slice (a, e >= 0 here): cut at the end, empty when a >= len.
const slice = (b, a, e) => b.subarray(Math.min(a, b.length), Math.min(Math.max(e, a), b.length));

// (width, lines, format) with the 12-bit fields the resources use.
export function bitmap_header(data) {
  const lines = (byteAt(data, 0) | (byteAt(data, 1) & 0x0F) << 8) + 1;
  const width = ((byteAt(data, 1) >> 4) | byteAt(data, 2) << 4) + 1;
  return [width, lines, byteAt(data, 3)];
}
export function make_header(width, lines, fmt) {
  return bytesOf([(lines - 1) & 0xFF, (((lines - 1) >> 8) & 0x0F) | (((width - 1) & 0x0F) << 4), ((width - 1) >> 4) & 0xFF, fmt]);
}

// -> [width, lines, format, indices (Uint8Array), bytes consumed incl. the header]. ValueError for a format without a
// known token layout, a run that crosses a row end, or non-zero pad bits; IndexError for a byte stream that ends early.
export function decode_bitmap(data) {
  const [width, lines, fmt] = bitmap_header(data);
  if (!TOKEN.has(fmt)) throw new ValueError(`bitmap format 0x${fmt.toString(16).padStart(2, '0')}: no known token layout`);
  const [bits, runbits, perWord] = TOKEN.get(fmt);
  const total = width * lines;
  const px = new Uint8Array(total);
  let n = 0, i = 4;
  const runmask = (1 << runbits) - 1;
  const put = (t) => {
    const run = (t & runmask) + 1;
    if ((n % width) + run > width) throw new ValueError(`run crosses a row end at pixel ${n}`);
    px.fill(t >> runbits, n, n + run);
    n += run;
  };
  if (perWord === null) {
    while (n < total) { put(byteAt(data, i)); i += 1; }
  } else {
    const mask = (1 << bits) - 1;
    while (n < total) {
      // int.from_bytes(bytes(data[i:i + 8]).ljust(8, b'\0'), 'little') as two 32-bit halves
      let lo = 0, hi = 0;
      for (let k = 0; k < 8; k++) {
        const b = i + k < data.length ? data[i + k] : 0;
        if (k < 4) lo |= b << (8 * k); else hi |= b << (8 * (k - 4));
      }
      lo >>>= 0; hi >>>= 0;
      let used = 0;
      while (used < perWord && n < total) {
        const s = bits * used;
        let t;
        if (s + bits <= 32) t = (lo >>> s) & mask;
        else if (s >= 32) t = (hi >>> (s - 32)) & mask;
        else t = ((lo >>> s) | (hi << (32 - s))) & mask;
        put(t);
        used += 1;
      }
      if (used === perWord) {
        if (hi >>> 28) throw new ValueError('non-zero pad bits');
        i += 8;
      } else i += Math.floor((bits * used + 7) / 8);
    }
  }
  return [width, lines, fmt, px, i];
}

// Inverse of decode_bitmap (synthetic test images).
export function encode_bitmap(width, lines, fmt, pixels) {
  if (!TOKEN.has(fmt)) throw new KeyError(String(fmt));
  const [bits, runbits, perWord] = TOKEN.get(fmt);
  const maxrun = 1 << runbits;
  const tokens = [];
  for (let y = 0; y < lines; y++) {
    const row = slice(pixels, y * width, (y + 1) * width);
    let x = 0;
    while (x < width) {
      let run = 1;
      while (run < maxrun && x + run < width && byteAt(row, x + run) === byteAt(row, x)) run += 1;
      tokens.push((byteAt(row, x) << runbits) | (run - 1));
      x += run;
    }
  }
  const parts = [make_header(width, lines, fmt)];
  if (perWord === null) parts.push(bytesOf(tokens));
  else {
    for (let j = 0; j < tokens.length; j += perWord) {
      const group = tokens.slice(j, j + perWord);
      let word = 0n;
      group.forEach((t, k) => { word += BigInt(t) << BigInt(bits * k); });
      if (word >= 1n << 64n) throw new RangeError('int too big to convert');
      const n = group.length === perWord ? 8 : Math.floor((bits * group.length + 7) / 8);
      const b = new Uint8Array(8);
      for (let k = 0; k < 8; k++) b[k] = Number((word >> BigInt(8 * k)) & 0xFFn);
      parts.push(b.subarray(0, n));
    }
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// GUI colour 0xAARRGGBB -> osddraw palette entry {R, G, B, A >> 3} (GPISetPalette 0x510bcb4f).
export function argb_to_osddraw(c) {
  if (!Number.isInteger(c) || c < 0 || c > 0xFFFFFFFF) throw new ValueError(`argb_to_osddraw(${c}): a u32 colour`);
  return bytesOf([(c >>> 16) & 255, (c >>> 8) & 255, c & 255, (c >>> 24) >> 3]);
}

// The reference raster of one 8 bpp buffer (stride x height bytes).
export class Surface {
  constructor(stride = STRIDE, height = HEIGHT) {
    this.stride = stride; this.height = height;
    if (!Number.isInteger(stride * height) || stride * height < 0) throw new ValueError('negative count');
    this.data = new Uint8Array(stride * height);
  }
  // data[a:b] = src, a slice assignment (a negative a or b counts from the end, both clamped to the buffer)
  _assign(a, b, src) {
    const len = this.data.length;
    const norm = (v) => (v < 0 ? Math.max(0, v + len) : Math.min(v, len));
    const s = norm(a), e = Math.max(norm(b), s);
    if (e - s === src.length) { this.data.set(src, s); return; }
    const out = new Uint8Array(len - (e - s) + src.length);
    out.set(this.data.subarray(0, s), 0);
    out.set(src, s);
    out.set(this.data.subarray(e), s + src.length);
    this.data = out;
  }
  // a copy of data[a:b], a and b normalised as in _assign
  _read(a, b) {
    const len = this.data.length;
    const norm = (v) => (v < 0 ? Math.max(0, v + len) : Math.min(v, len));
    const s = norm(a), e = Math.max(norm(b), s);
    return this.data.slice(s, e);
  }
  fill(x, y, w, h, colour) {
    const row = bytesOf([colour]);
    for (let r = y; r < y + h; r++) {
      const src = new Uint8Array(Math.max(0, w)).fill(row[0]);
      this._assign(r * this.stride + x, r * this.stride + x + w, src);
    }
  }
  copy_from(src, sx, sy, w, h, dx, dy) {
    const rows = [];
    for (let r = 0; r < h; r++) rows.push(src._read((sy + r) * src.stride + sx, (sy + r) * src.stride + sx + w));
    rows.forEach((data, r) => this._assign((dy + r) * this.stride + dx, (dy + r) * this.stride + dx + w, data));
  }
  blit(x, y, width, lines, pixels, table = null) {
    for (let r = 0; r < lines; r++) {
      let row = slice(pixels, r * width, (r + 1) * width);
      if (table !== null) row = Uint8Array.from(row, (i) => byteAt(table, i));
      this._assign((y + r) * this.stride + x, (y + r) * this.stride + x + width, row);
    }
  }
  rows(width = WIDTH) {
    const out = [];
    for (let r = 0; r < this.height; r++) out.push(this._read(r * this.stride, r * this.stride + width));
    return out;
  }
}
