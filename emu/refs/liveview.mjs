// check_liveview's independent references, importing only refs/ (test_pure.mjs): the TH
// register formulas of spec section 10.4 (th_formula, with the six reference MUTANTS group G3 must kill), the CMM
// selector, table entry and register formulas of section 11 (cmm_selector, cmm_entry, cmm_formula; the table read
// from the image file), the debug-dump table reader (reg_dump_reads) and DISPLAY cmd 5's IMG1 call trace
// (cmd5_img1_want). A request is any object with ThRequest's fields; a bank is a Map name -> value or null.
import { PANEL } from './display.mjs';
import { ValueError } from './errors.mjs';

export const RUNTIME = 0x60021020;                  // E143's image base: this reference reads the E143 v1.9 block only
export const LV_W = 5568, LV_H = 2160;
export const MUTANTS = ['no-burst-8', 'no-a12', 'step-from-area', 'spos-from-address', 'area-odd', 'sadr-no-crop'];
const ceil = (a, b) => -Math.floor(-a / b);
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// struct.unpack_from(f'<{n}I', image, address - RUNTIME)
export function image_u32(image, address, n = 1) { const o = address - RUNTIME, out = []; for (let i = 0; i < n; i++) out.push(u32(image, o + 4 * i)); return out; }

// Spec section 10.4: the written bank after one TH call on channel c (w = the bank before), for layer_format 1 (VSC
// format 0, 64 pixels per 128-byte burst), STILL picture mode. Returns [Map register -> value, img[0]].
export function th_formula(c, req, w, { ctrl_or = 0x40, last_area = null, mutant = null } = {}) {
  const W = (req.from_area[0] === 0 && req.from_area[1] === 0 ? last_area : req.from_area)[0];
  const [x, y] = req.from_coordinate, [tw, th] = req.from_target, [dw, dh] = req.to_target, [tx, ty] = req.to_coordinate;
  const [hs, vs] = PANEL[c === 1 ? 'evf' : 'tft'].porch;
  const old = (n) => w.get(n) ?? 0;
  const offset = mutant === 'sadr-no-crop' ? 0 : Math.floor(W * 128 / 64) * y + Math.floor((x & ~1) * 128 / 64);
  const start = (req.address + offset) % 4294967296;
  const spos = mutant === 'spos-from-address' ? (Math.floor(start / 2) % 64) & 126 : (x % 64) & 126;
  const out = new Map([['IMG1DMASADR', Math.floor(start / 16)],
    ['IMGDMASPOS', ((old('IMGDMASPOS') & ~0x7F) | spos) >>> 0],
    ['IMG1DMALD', ((old('IMG1DMALD') & 0xFFFF8000) | Math.floor(W / 64) << 3) >>> 0],
    ['IMG1DMABN', ceil(tw + spos, 64) << 3]]);
  const ypyc = (req.lut_onoff === 0 || req.prm_pic_mode === 0) && req.input_color_space === 2 && req.output_color_space === 1 ? 1 : 0;
  out.set('IMG1FMT', ((old('IMG1FMT') & ~0x3F) | ypyc << 4) >>> 0);
  out.set('IMG1AREA1', ((hs + tx) << 16 | (mutant === 'area-odd' ? dw : dw & 0xFFFE)) >>> 0);
  out.set('IMG1AREA2', ((vs + ty) << 16 | dh) >>> 0);
  let rsz1 = old('IMG1RSZ1');
  const sw = mutant === 'step-from-area' ? W : tw;
  if (sw === dw) rsz1 &= ~1;
  else {
    rsz1 |= 1;
    out.set('IMG1RSZ2', sw < dw && (sw * 4096) % dw === 0 ? Math.floor(sw * 4096 / dw) : Math.floor((sw * 4096 - 0x1001) / (dw - 1)));
    if (mutant !== 'no-burst-8' && ((2 * tw + start) % 128) === 0) out.set('IMG1DMABN', out.get('IMG1DMABN') + 8);
  }
  const sh = mutant === 'step-from-area' ? LV_H : th;
  if (sh === dh) {
    if (c === 2) { rsz1 |= 0x10; out.set('IMG1RSZ4', 0x2000); } else rsz1 &= ~0x10;
  } else {
    rsz1 |= 0x10;
    const step = sh < dh && (sh * 4096) % dh === 0 ? Math.floor(sh * 4096 / dh) : ceil((sh - 1) * 4096, dh);
    out.set('IMG1RSZ4', step * (c === 2 && mutant !== 'no-a12' ? 2 : 1));
  }
  out.set('IMG1RSZ1', rsz1 >>> 0);
  out.set('DMAEN', ((old('DMAEN') | 0x20) & ~0x08) >>> 0);
  out.set('CTRL3', (old('CTRL3') | ctrl_or) >>> 0);
  out.set('CTRL2', (old('CTRL2') | ctrl_or) >>> 0);
  return [out, start];
}

// Spec section 11.1 (0x501de269)
export function cmm_selector(lut, mode, inp, out, drange) {
  if (drange === 0) return 0;
  if (mode === 253) return out === 1 ? 1 : 0;
  if ((mode === 254 || mode === 255) && lut) {
    const table = mode === 254 ? new Map([['2,1', 2], ['2,2', 3]]) : new Map([['2,1', 4], ['2,2', 5], ['3,1', 6], ['3,2', 7]]);
    return table.get(`${inp},${out}`) ?? 0;
  }
  return 0;
}
// Entry of the CMM table 0x602c20b0 (36 bytes per state, 288 per drange half), from the image file: [pointers (7),
// bytes +28..+33, the six 16-entry u16 arrays]
export function cmm_entry(image, half, state) {
  const e = 0x602C20B0 + 288 * half + 36 * state;
  const ptrs = image_u32(image, e, 7);
  const b = image.slice(e - RUNTIME + 28, e - RUNTIME + 34);
  const arr = ptrs.slice(0, 6).map((p) => { const o = p - RUNTIME, a = []; for (let i = 0; i < 16; i++) a.push(image[o + 2 * i] | image[o + 2 * i + 1] << 8); return a; });
  return [ptrs, b, arr];
}
// Spec section 11.3: 0x501e0804 (table) then 0x501e0e1f(ch, {1, 0}) on a TFT/EVF channel (CMMSET2 0). Returns
// [Map register -> value, the entry's bytes].
export function cmm_formula(image, oldSet1, half, state) {
  const [, b, arr] = cmm_entry(image, half, state);
  const set1 = ((oldSet1 & 0xC88CEFFE) | b[4] << 28 | b[5] << 24 | b[3] << 20 | b[2] << 16 | b[1] << 12 | b[0]) >>> 0;
  const out = new Map([['CMMSET1', (((set1 & 0x7FFFFEEF) | 1 << 31 | 1 << 4) >>> 0)], ['CMMSET2', 0]]);
  for (let i = 0; i < 16; i++) {
    out.set(`CMM1_KNEE${2 * i + 1}`, (arr[1][i] << 16 | arr[0][i]) >>> 0);
    out.set(`CMM1_KNEE${2 * i + 2}`, arr[2][i]);
    out.set(`CMM2_KNEE${2 * i + 1}`, (arr[4][i] << 16 | arr[3][i]) >>> 0);
    out.set(`CMM2_KNEE${2 * i + 2}`, arr[5][i]);
  }
  return [out, b];
}

// Spec section 7 A15: the debug register dump's table walk (from the image file). Returns the summary line.
export const REG_DUMP_TABLE = 0x60352DC0;
export const REG_DUMP_LOADS = new Map([[0x501CDF1C, 'fca0c02d3560'], [0x501CDF48, 'fcdc0000b89b'], [0x501CDF72, 'fc0400800000'], [0x501CDF99, 'fc0400000100']]);
export function reg_dump_reads(image) {
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const code = (a, n) => hex(image.slice(a - 0x50000000, a - 0x50000000 + n));
  for (const [a, v] of REG_DUMP_LOADS) if (code(a, v.length / 2) !== v) throw new Error('AssertionError: debug dump loads');
  const rows = [];
  for (let k = 0; k < 3; k++) {
    const [name, index] = image_u32(image, REG_DUMP_TABLE + 8 * k, 2);
    const raw = image.slice(name - RUNTIME, name - RUNTIME + 16);
    const z = raw.indexOf(0);
    let text = String.fromCharCode(...(z < 0 ? raw : raw.slice(0, z)));
    while (text.endsWith(' ') || text.endsWith(':')) text = text.slice(0, -1);
    rows.push([text, index]);
  }
  const want = [['CTRL1', 0], ['CTRL2', 1], ['CTRL3', 2]];
  if (JSON.stringify(rows) !== JSON.stringify(want)) throw new Error(`AssertionError: ${JSON.stringify(rows)}`);
  return 'debug dump 0x501cdf1c..0x501cdfbc ("---- VSC Read Buff"): table 0x60352dc0 starts '
    + `[${rows.map(([n, i]) => `('${n}', ${i})`).join(', ')}], loads 0x9bb80000 + 4 * index (+0x8000, +0x10000 per channel): CTRL2/CTRL3 are read `
    + 'here, the only read of them found (A15)';
}

// DISPLAY cmd 5's IMG1 path, 0x501da1b3(mask, handle) (spec section 10.7): [(function, d0, d1 or null, return
// address)], width. CMD5_IMG1: (function, return address).
export const CMD5_IMG1 = [[0x501DA1B3, 0x501DA634], [0x501DF27A, 0x501DA1F9], [0x501E1E95, 0x501DA207],
  [0x501DFFAE, 0x501DA214], [0x501E0137, 0x501DA21F], [0x501E0045, 0x501DA22C]];
export const DEVICE_IO = { tft: { mask: 1, channel: 2 }, evf: { mask: 2, channel: 1 } };
export function cmd5_img1_want(device, handle) {
  const d = DEVICE_IO[device], rets = new Map(CMD5_IMG1), width = PANEL[device].active[0];
  if (!d) throw new ValueError(`device ${device}`);
  const want = [[0x501DA1B3, d.mask, handle], [0x501DF27A, d.mask, null]];
  if (handle) want.push([0x501E1E95, d.channel, 0], [0x501DFFAE, d.channel, LV_W], [0x501E0137, d.channel, 0], [0x501E0045, d.channel, width]);
  return [want.map(([fn, d0, d1]) => [fn, d0, d1, rets.get(fn)]), width];
}
