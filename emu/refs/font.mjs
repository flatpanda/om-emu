// The offline reference for the OM-1 (E143 v1.9) GUI fonts and the firmware's text layout, written
// from the font-format investigation (docs/om1-text-spec.md section 4), as an independent reference (imports only
// refs/, test_pure.mjs). Used by check_text, and by check_menu's group 0 and refs/menuref.mjs.
//
// Font blob (resource entries 19..36, linked at 0xA4F63680): +0x00 a 16-byte header (+8 line height, +11 vertical
// offset), +0x10 u32[256] page pointers (index code >> 8; 0 = absent), pages of u32[256] glyph-record pointers (index
// code & 0xFF), glyph record (16 bytes): +0 box_w, +1 box_h, +2 s8 top, +4 bitmap (format 0x02), +8 s8 lsb, +9 width,
// +10 s8 rsb, +11 pad_l, +12 pad_r. The layout rules, their code addresses and what is refused are documented
// below at each function. Text is iterated as UTF-16 code units (a JS string's own units); div0 and Math.trunc
// halve toward zero, floorDiv toward -infinity, each where the firmware's code does.
import { decode_bitmap } from './osdfmt.mjs';
import { ValueError } from './errors.mjs';

export const FONT_BASE = 0xA4F63680;
export const DEVICE_W = 1600;                 // device +2 of all three GPI devices
export const ICON_MIN = 0xA000, ICON_MAX = 0xA095;
const hex4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const u32 = (d, o) => (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
const s8 = (v) => (v << 24) >> 24;
const floorDiv = (a, b) => Math.floor(a / b);

// The 16 zero bytes at 0x61328dc0 (missing next glyph inside 0x510bf358).
export const ZERO = Object.freeze({ lsb: 0, width: 0, rsb: 0, pad_l: 0, pad_r: 0, box_w: 0 });

// Strict parse of one font blob linked at base. ValueError for any pointer outside the blob, a bitmap that is not
// format 0x02 or does not decode exactly, a record whose box differs from its bitmap, or a record that does not follow
// its bitmap within 3 bytes.
export class Font {
  constructor(data, base = FONT_BASE) {
    this.data = data; this.base = base;
    this.header = data.subarray(0, 16);
    this.line_h = data[8]; this.adj = data[11];
    this.glyphs = new Map();
    this.pages = new Map();
    for (let hi = 0; hi < 256; hi++) {
      const page = u32(data, 16 + 4 * hi);
      if (!page) continue;
      this.pages.set(hi, this._off(page));
      for (let lo = 0; lo < 256; lo++) {
        const rec = u32(data, this.pages.get(hi) + 4 * lo);
        if (rec) this.glyphs.set(hi << 8 | lo, this._glyph(hi << 8 | lo, rec));
      }
    }
  }
  _off(ptr) {
    const off = ptr - this.base;
    if (!(off >= 0 && off < this.data.length)) throw new ValueError(`pointer 0x${hex8(ptr)} outside the blob`);
    return off;
  }
  _glyph(code, rec) {
    const d = this.data, r = this._off(rec);
    const g = { code, record: rec, box_w: d[r], box_h: d[r + 1], top: s8(d[r + 2]), bitmap: u32(d, r + 4),
      lsb: s8(d[r + 8]), width: d[r + 9], rsb: s8(d[r + 10]), pad_l: d[r + 11], pad_r: d[r + 12], pixels: null };
    const start = this._off(g.bitmap);
    const [w, h, fmt, pixels, used] = decode_bitmap(d.subarray(start, r));
    if (fmt !== 0x02 || w !== g.box_w || h !== g.box_h) {
      throw new ValueError(`U+${hex4(code)}: bitmap ${w}x${h} fmt 0x${fmt.toString(16).padStart(2, '0')}, record ${g.box_w}x${g.box_h}`);
    }
    if (!((r - start) - used >= 0 && (r - start) - used <= 3)) throw new ValueError(`U+${hex4(code)}: record 0x${r.toString(16)} not directly after its bitmap`);
    g.pixels = pixels;
    return g;
  }
  lookup(code) {
    if (!this.pages.has(code >> 8)) return this.glyphs.get(0x20);
    return this.glyphs.get(code) ?? this.glyphs.get(0x20);
  }
  lookup_next(code) {
    if (code === 0 || code === 10 || code === 13) return 'end';
    return this.glyphs.get(code) ?? ZERO;
  }
}

// Pen step: iterator +8 plus the extra term (_step).
export function advance(g, nxt, mode) { const [a, extra] = _step(g, nxt, mode); return a + extra; }

// [iterator +8, extra] for glyph g (0x510bf0a6..0x510bf0f7, 0x510bf358). nxt: a glyph, ZERO, 'end' or 'icon'. Mode 0
// with next.lsb < 0 stores next.lsb as the extra advance, rsb < 0 adds rsb; the step is the sum.
export function _step(g, nxt, mode) {
  if (nxt === 'end') return [mode === 0 ? g.width : g.box_w, 0];
  const a = g.width + (mode ? g.pad_l : 0);
  if (nxt === 'icon') return [a + (mode === 0 ? g.rsb : Math.max(g.rsb, g.pad_r)), 0];
  const d = g.rsb + nxt.lsb;
  let extra = 0, out;
  if (mode === 0) {
    if (nxt.lsb >= 0) out = a + d;
    else { out = a + g.rsb; extra = nxt.lsb; }
  } else out = d > g.pad_r + nxt.pad_l ? a + d - nxt.pad_l : a + g.pad_r;
  if (g.rsb < 0) { out -= g.rsb; extra += g.rsb; }
  return [out, extra];
}

// The '@XXXX@' parser 0x510bee28 on the units text[i..] (a JS string of code units): 0 is 'not an escape'. Each of
// the six characters must be a hex digit (either case) or '@', which counts as the value 64; the sixth must be '@';
// the code is (n1 << 12 | n2 << 8 | n3 << 4 | n4) & 0xFFFF, and codes above 0xA095 give 0. No lower bound.
const HEX = '0123456789abcdefABCDEF';
export function escape_code(text, i) {
  const s = text.slice(i, i + 6);
  if (s.length < 6) return 0;
  const nib = [];
  for (const c of s) {
    if (c === '@') nib.push(64);
    else if (HEX.includes(c)) nib.push(parseInt(c, 16));
    else return 0;
  }
  if (s[5] !== '@') return 0;
  const code = (nib[1] << 12 | nib[2] << 8 | nib[3] << 4 | nib[4]) & 0xFFFF;
  return code <= ICON_MAX ? code : 0;
}

// UTF-16 code units, as the firmware reads the string (surrogate pairs stay two units)
export function _units(text) { const out = []; for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i)); return out; }
const unitStr = (line) => String.fromCharCode(...line);

// Units DrawText's measure iterator counts on a line (op52): every unit but U+001F outside an escape's five skips.
export function _measure_count(line) {
  const ls = unitStr(line);
  let count = 0, mskip = 0;
  line.forEach((c, i) => {
    if (mskip > 0) { mskip -= 1; count += 1; } else if (c !== 0x1F) {
      count += 1;
      if (c === 0x40 && escape_code(ls, i)) mskip = 5;
    }
  });
  return count;
}

// Split at CR LF or a lone LF; a line break always records a line, the last line only when its measure count is
// non-zero.
export function _lines(units) {
  const lines = [];
  let cur = [], i = 0;
  while (i < units.length) {
    if (units[i] === 13 && i + 1 < units.length && units[i + 1] === 10) { lines.push(cur); cur = []; i += 2; }
    else if (units[i] === 10) { lines.push(cur); cur = []; i += 1; }
    else { cur.push(units[i]); i += 1; }
  }
  return _measure_count(cur) ? [...lines, cur] : lines;
}

// Signed division truncating toward zero (`ext d0; div d1,d0`).
export function div0(a, b) { const q = Math.floor(Math.abs(a) / Math.abs(b)); return (a >= 0) === (b > 0) ? q : -q; }

// The icon's pen step from the unit after its first '@' (0x510bef1b..a1).
function iconAdvance(w, nxt, mode) {
  let adv = w;
  if (mode === 0 && nxt.lsb > 0) adv += nxt.lsb;
  else if (mode && nxt.lsb > nxt.pad_l) adv += nxt.lsb - nxt.pad_l;
  return adv;
}

// Width of each line as DrawText's measure pass computes it (0x510ab383..0x510ab45f).
export function line_widths(font, icons, text, mode) {
  const out = [];
  for (const line of _lines(_units(text))) {
    const ls = unitStr(line);
    let width = 0, skip = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (skip > 0) { skip -= 1; continue; }
      if (c === 0x1F) continue;
      const code = c === 0x40 ? escape_code(ls, i) : 0;
      if (code) {
        if (code < ICON_MIN) throw new ValueError(`@${hex4(code)}@: icon code below 0x${hex4(ICON_MIN)} not modelled`);
        const [w] = icons(code);
        const nxt = font.glyphs.get(line[i + 1]);
        if (nxt === undefined) throw new ValueError('icon followed by a missing glyph (0x510bef63..6f) not checked');
        width += iconAdvance(w, nxt, mode);
        skip = 5;
        continue;
      }
      if (c >= 0x0E00 && c <= 0x0E5B) throw new ValueError('Thai shaping (0x510bf19f) is not decoded');
      const g = font.lookup(c);
      let nxt;
      if (i + 1 < line.length) { const nc = line[i + 1]; nxt = nc === 0x40 && escape_code(ls, i + 1) ? 'icon' : font.lookup_next(nc); }
      else nxt = 'end';
      width += _step(g, nxt, mode)[0];
    }
    out.push(width);
  }
  return out;
}

// DrawText step 7 for an inclusive box (x0, y0, x1, y1): [first line y, [pen x per line]].
export function align_box(font, icons, text, box, align, line_h, mode, gap = 0) {
  const [x0, y0, x1, y1] = box;
  if (line_h <= 0) throw new ValueError(`line height ${line_h}: only positive line heights are modelled`);
  if (x0 > x1 || y0 > y1) return [y0, []];
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const widths = line_widths(font, icons, text, mode);
  const allowed = div0(h + line_h - 1, line_h), n = Math.min(widths.length, allowed);
  const block = n * line_h + (n - 1) * gap;
  const v = align[1] === 0 ? 0 : align[1] === 1 ? div0(h - block, 2) : align[1] === 2 ? h - block : null;
  if (v === null || ![0, 1, 2].includes(align[0])) throw new ValueError(`alignment (${align.join(', ')}): only 0, 1 and 2 are read from the code`);
  const pens = widths.slice(0, n).map((wd) => x0 + (align[0] === 0 ? 0 : align[0] === 1 ? div0(w - wd, 2) : w - wd));
  return [y0 + v, pens];
}

// Reference placement of every BITMAP a left/top-aligned DrawText issues: [{kind, code, header, x,
// y, width, height, pixels (glyphs), pen, line_y, step}] in drawing order. device_w null drops the screen-edge rule (a
// negative control only).
export function layout(font, icons, text, x, y, size, mode, line_pitch, { max_lines = null, clip_right = null, device_w = DEVICE_W, line_x = null } = {}) {
  if (device_w !== null && clip_right !== null && clip_right >= device_w) throw new ValueError(`clip right ${clip_right} outside the device (width ${device_w})`);
  const edgeCell = (pen, step) => {
    if (device_w === null || pen + step <= device_w) return false;
    if (clip_right === null) throw new ValueError(`cell at x ${pen} runs past the device edge ${device_w}: pass clip_right`);
    return true;
  };
  const units = _units(text);
  if (units.includes(0)) throw new ValueError('NUL inside the text is not modelled');
  const out = [];
  let lines = _lines(units);
  if (max_lines !== null) lines = lines.slice(0, max_lines);
  let skip = 0;                                         // draw iterator +24, carried from line to line
  lines.forEach((line, n) => {
    const ls = unitStr(line), count = _measure_count(line);
    let pen = line_x === null ? x : line_x[n];
    const ly = y + n * line_pitch;
    for (let i = 0; i < count; i++) {
      const c = line[i];
      if (c === 0x1F || skip > 0) { skip = Math.max(skip - 1, 0); continue; }
      if (c >= 0x0E00 && c <= 0x0E5B) throw new ValueError('Thai shaping (0x510bf19f) is not decoded');
      const code = c === 0x40 ? escape_code(ls, i) : 0;
      if (code) {
        if (code < ICON_MIN) throw new ValueError(`@${hex4(code)}@: icon code below 0x${hex4(ICON_MIN)} reads the icon table at a negative index (0x510bef1d), unchecked (0x510bef2a): not modelled`);
        skip = 5;
        const [w, h, header] = icons(code);
        const nxt = font.glyphs.get(line[i + 1]);
        if (nxt === undefined) throw new ValueError('icon followed by a missing glyph (0x510bef63..6f) not checked');
        if (clip_right !== null && pen > clip_right) break;
        const adv = iconAdvance(w, nxt, mode);
        edgeCell(pen, adv);
        out.push({ kind: 'icon', code, header, x: pen, y: ly + floorDiv(size - h, 2), width: w, height: h, pen, line_y: ly, step: adv });
        pen += adv;
        continue;
      }
      if (clip_right !== null && pen > clip_right) break;
      const g = font.lookup(c);
      let nxt;
      if (i + 1 < line.length) { const nc = line[i + 1]; nxt = nc === 0x40 && escape_code(ls, i + 1) ? 'icon' : font.lookup_next(nc); }
      else nxt = 'end';
      const [step, extra] = _step(g, nxt, mode);
      const moved = edgeCell(pen, step);
      const shift = mode === 0 && pen - g.pad_l >= 0 && !moved;
      const gx = shift ? pen - g.pad_l : pen;
      const gy = ly + g.top + font.adj + Math.trunc((size - font.line_h) / 2);
      out.push({ kind: 'glyph', code: c, header: g.bitmap, x: gx, y: gy, width: g.box_w, height: g.box_h, pixels: g.pixels, pen, line_y: ly, step });
      pen += step + extra;
    }
  });
  return out;
}

// The 16-entry table the GUI text callback 0x510bc7d8 builds: {0, c, c+1, c+2, e, e+1, e+2, 0...}; e = 0 maps 4..6 to 0.
export function text_lut(colour, edge) {
  return Uint8Array.from([0, colour, colour + 1, colour + 2, ...(edge ? [edge, edge + 1, edge + 2] : [0, 0, 0]), ...Array(9).fill(0)]);
}
