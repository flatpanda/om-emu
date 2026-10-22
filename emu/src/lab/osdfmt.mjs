// OSD engine command words, bitmap headers and GUI palettes: the parts the lab uses at run time
// (decode_command for the execution log, bitmap_header for the draw observers, gui_palette, the error names). The
// reference raster and the bitmap decoder live with the checks (refs/osdfmt.mjs).
import { A, IMAGE_BASE } from '../fw/model.mjs';
import { ValueError } from './errors.mjs';
import { pack } from '../util/bytes.mjs';

export const M32 = 0xFFFFFFFF;
export const ERRORS = ['NONE', 'REG_UNKNOWN', 'REG_READ_UNUSED', 'START_MODE', 'TRIGGER', 'FIFO_OVERFLOW', 'LIST_NO_END',
  'OPCODE_UNKNOWN', 'OPCODE_UNMODELED', 'WORD_BITS', 'DEPTH', 'COLOR_HIGH', 'SIZE_4096', 'DMA_RANGE', 'GUARD',
  'COPY_OVERLAP', 'BMP_FORMAT', 'BMP_SCALE', 'BMP_LUT', 'BMP_TOKEN', 'BMP_TRANSPARENCY', 'SEQUENCE', 'DEBUG_CPU_WRITE'];
export const ERROR_CODE = Object.fromEntries(ERRORS.map((n, i) => [n, i]));

function bitaddr(top3, word) { return [(((top3 & 7) << 29) | (word >>> 3)) >>> 0, word & 7]; }

// One command (its words) -> the named fields, in the key order the recorded outputs use.
export function decode_command(words) {
  const w0 = words[0] >>> 0, op = w0 & 0xFF;
  const c = { op, words: Array.from(words) };
  if (op === 0x10) {
    const [, color, a, d] = words;
    Object.assign(c, { name: 'FILL', depth: (w0 >>> 8) & 0xFF, color,
      w: (((d >>> 11) & 0x7FF) | ((w0 >>> 17) & 1) << 11) + 1,
      h: ((d & 0x7FF) | ((w0 >>> 16) & 1) << 11) + 1,
      stride: (((d >>> 23) & 0x1FF) | ((w0 >>> 20) & 1) << 9) << 7 });
    [c.dst, c.dst_bit] = bitaddr(w0 >>> 24, a);
  } else if (op === 0x20) {
    const [, sa, sz, da, ds] = words;
    Object.assign(c, { name: 'COPY', depth: (w0 >>> 8) & 0xFF,
      w: (((sz >>> 11) & 0x7FF) | ((w0 >>> 17) & 1) << 11) + 1,
      h: ((sz & 0x7FF) | ((w0 >>> 16) & 1) << 11) + 1,
      src_stride: (((sz >>> 23) & 0x1FF) | ((w0 >>> 20) & 1) << 9) << 7,
      dst_stride: (((ds >>> 23) & 0x1FF) | ((w0 >>> 21) & 1) << 9) << 7 });
    [c.src, c.src_bit] = bitaddr(w0 >>> 24, sa);
    [c.dst, c.dst_bit] = bitaddr(w0 >>> 28, da);
  } else if (op === 0x30) {
    Object.assign(c, { name: 'BITMAP', depth: (w0 >>> 8) & 7, lut: !!(w0 & 0x800), inline_lut: !!(w0 & 0x1000),
      scale: !!(w0 & 0x6000), src: words[1], stride: (((words[3] >>> 1) & 0x1FF) | ((w0 >>> 20) & 1) << 9) << 7 });
    [c.dst, c.dst_bit] = bitaddr(w0 >>> 28, words[2]);
    const i = w0 & 0x6000 ? 5 : 4;
    if (w0 & 0x1000) c.table = pack('<4I', ...words.slice(i, i + 4));
  } else if (op === 0x40 || op === 0x41) {
    Object.assign(c, { name: op === 0x40 ? 'LUT' : 'LUT_IDX', table: ((words[1] << 6) & M32) >>> 0 });
  } else if (op === 0x60) c.name = 'BITMAP2';
  else if (op === 0xFF) c.name = 'END';
  return c;
}

// (width, lines, format) with the 12-bit fields the resources use.
export function bitmap_header(data) {
  return [(((data[1] >> 4) | data[2] << 4) + 1), ((data[0] | (data[1] & 0x0F) << 8) + 1), data[3]];
}

export const GUI_PALETTE_TABLE = A(0x603708EC);
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const PAL_CACHE = new WeakMap();
// The colours 0xAARRGGBB of GUI palette pid; ValueError for an entry that is not a palette.
// Results (and refusals) are cached per image: the lookups are pure reads of the image.
export function gui_palette(image, pid) {
  let cache = PAL_CACHE.get(image);
  if (!cache) PAL_CACHE.set(image, cache = new Map());
  let r = cache.get(pid);
  if (r === undefined) {
    try { r = { ok: guiPalette(image, pid) }; } catch (e) { if (!(e instanceof ValueError)) throw e; r = { err: e.message }; }
    cache.set(pid, r);
  }
  if (r.err !== undefined) throw new ValueError(r.err);
  return r.ok;
}
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
function guiPalette(image, pid) {
  const table = GUI_PALETTE_TABLE - IMAGE_BASE + 4 * pid;
  if (pid < 0 || table + 4 > image.length) throw new ValueError(`GUI palette ${pid}: outside the palette table`);
  const entry = u32(image, table);
  if (!(IMAGE_BASE <= entry && entry <= IMAGE_BASE + image.length - 8)) throw new ValueError(`GUI palette ${pid}: table entry ${h8(entry)} is not a palette`);
  const count = u32(image, entry - IMAGE_BASE), colours = u32(image, entry - IMAGE_BASE + 4);
  if (!(count >= 1 && count <= 256) || !(IMAGE_BASE <= colours && colours <= IMAGE_BASE + image.length - 4 * count)) {
    throw new ValueError(`GUI palette ${pid}: entry ${h8(entry)} = {${count}, ${h8(colours)}} is not a palette`);
  }
  const out = [];
  for (let i = 0; i < count; i++) out.push(u32(image, colours - IMAGE_BASE + 4 * i));
  return out;
}
