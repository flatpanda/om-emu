// The VSC register-offset tables of the om1-vsc model, read from the firmware image on the VSC's first use (vsc.mjs
// tables(), so a bare test image works while nothing reaches the VSC; a kind-3 VSC's from its board, boardTable
// below). Two name tables in the E143 v1.9 main block:
// body 0x331da0, 503 per-channel compositor registers, and body 0x332d60, 115 registers of the output block 0x9BB98000.
// Entry = {u32 run-time pointer to a ':'-terminated padded name, u32 word index}; a zero entry ends the table; register
// offset = 4 * index. The tables are firmware-derived and never stored in this repository (test_dev.mjs compares them
// with the committed header).
import { A, IMAGE_BASE } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';

// the tables' run-time addresses (body offset + IMAGE_BASE: 0x331da0 and 0x332d60 at E143), so a ported model's
// copy of this module names its own (bin/port.mjs); the entry counts are the board's (a VSC without an output block
// has no second table)
const [NCHAN, NOUT] = BOARD.vsc.names ?? [0, 0];
export const TABLES = { chan: [A(0x60352DC0) - IMAGE_BASE, NCHAN], out: NOUT ? [A(0x60353D80) - IMAGE_BASE, NOUT] : null };

const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// [[register offset, name], ...] in table order; exactly `expected` entries with strictly increasing offsets.
export function readTable(image, offset, expected) {
  const out = [];
  for (;;) {
    const at = offset + 8 * out.length, pointer = u32(image, at), index = u32(image, at + 4);
    if (pointer === 0) break;
    if (out.length > expected || pointer < IMAGE_BASE || pointer - IMAGE_BASE >= image.length) throw new Error(`vsc regs: table 0x${offset.toString(16)}: no end after ${out.length} entries (entry 0x${pointer.toString(16)})`);
    const start = pointer - IMAGE_BASE;
    let end = start, name = '';
    while (image[end] !== 0) {
      // an ASCII decode: a byte past 0x7f is an error, never a Latin-1 character
      if (image[end] > 0x7f) throw new Error(`vsc regs: table 0x${offset.toString(16)} entry ${out.length}: name byte 0x${image[end].toString(16)} is not ASCII`);
      name += String.fromCharCode(image[end++]);
    }
    if (!name.endsWith(':')) throw new Error(`vsc regs: table 0x${offset.toString(16)} entry ${out.length}: name ${JSON.stringify(name)} is not ":"-terminated`);
    out.push([4 * index, name.slice(0, -1).trim()]);
  }
  if (out.length !== expected) throw new Error(`vsc regs: table 0x${offset.toString(16)}: ${out.length} entries, expected ${expected}`);
  for (let i = 1; i < out.length; i++) {
    if (out[i][0] <= out[i - 1][0]) throw new Error(`vsc regs: table 0x${offset.toString(16)}: offsets not strictly increasing`);
  }
  return out;
}

// A kind-3 VSC (the E118 family, src/fw/board.mjs) has no name table in its firmware: its register file is the board's
// list of the offsets the family's code names, each called by the role its code shows (vsc.regs) or R<offset>
// otherwise, and its latched copies (vsc.latch + offset, vsc.latched) <name>_VL
function boardTable(v) {
  const roles = new Map(Object.entries(v.regs).map(([name, off]) => [off, name]));
  const name = (off) => roles.get(off) ?? 'R' + off.toString(16).toUpperCase().padStart(3, '0');
  return { chan: v.registers.map((off) => [off, name(off)]), latched: v.latched.map((off) => [v.latch + off, name(off) + '_VL']), out: [] };
}

const cache = new WeakMap();
export function vscTables(image) {
  if (BOARD.vsc.kind === 3) return boardTable(BOARD.vsc);
  let t = cache.get(image);
  if (t === undefined) {
    t = { chan: readTable(image, ...TABLES.chan), out: TABLES.out ? readTable(image, ...TABLES.out) : [] };
    cache.set(image, t);
  }
  return t;
}
