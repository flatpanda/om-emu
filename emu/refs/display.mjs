// check_display's independent references, as a module that imports only refs/ (test_pure.mjs):
// the reference compositor reference() written from the spec text (docs/om1-vsc-spec.md), the A6 column rule osd_cols,
// the firmware's BT.601 bt601, the register classes (REG_MODEL, REG_STORED, FEATURES, unwritten_class, model_classes:
// the parse of checks/fixtures/om1-vsc-tables.c, given the file's text), the register formulas of check_registers
// (registers_want), the palette formula of check_palettes (palette_word, gui_entry) and the display-switch level table
// (level_table, switch_planc). The lab state they read comes in as arguments: the latched bank (a Map name -> value or
// null, or a Recording that notes the names read), the palette SRAM words and flags, and fetch(address, n) -> bytes.
import { ValueError, IndexError } from './errors.mjs';

export const PLANES = ['IMG1', 'IMG2', 'IMG3', 'OSD1', 'OSD2', 'OSD3'];
// Device-table inputs (GEOMETRY / spec section 2): porch, active size, OSD canvas, htotal, hsync, vtotal, vsync.
export const PANEL = {
  tft: { porch: [98, 8], active: [900, 600], canvas: [900, 600], htotal: 1300, hsync: 4, vtotal: 770, vsync: 4, rank: 3 },
  evf: { porch: [48, 41], active: [1600, 1200], canvas: [800, 600], htotal: 1884, hsync: 16, vtotal: 1315, vsync: 5, rank: 2 },
};

// Full-range BT.601 integers of the firmware (spec section 5; written from the text): [y, cb, cr]
export function bt601(r, g, b) {
  const y = (19595 * r + 38470 * g + 7471 * b) >> 16;
  const cb = ((-11056 * r - 21712 * g + b * 32768) >> 16) + 128;
  const cr = ((r * 32768 - 27440 * g - 5328 * b) >> 16) + 128;
  return [y & 255, cb & 255, cr & 255];
}

// ---- register classes (spec section 7; the C tables' reg_class / features)
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
export const REG_MODEL = new Set(['INTEN1', 'INTST1', 'DMAEN', 'IMGDMASPOS', 'OSDDMASPOS', 'OSDFMT1', 'OSDFMT2', 'VIDEOAREA1',
  'VIDEOAREA2', 'OSDRESO', 'IMG2BC', 'IMG3BC', 'O1BC', 'O2BC', 'O3BC', 'OSDCP2', 'PEAK1', 'MIXODR1', 'MIXODR2', 'OSDMIX', 'BG',
  'SYNC1', 'SYNC2', 'SYNC4', 'MONI3',
  ...PLANES.flatMap((p) => ['DMASADR', 'DMALD', 'DMABN', 'AREA1', 'AREA2', 'PLANC', 'RSZ1', 'RSZ2', 'RSZ3', 'RSZ4', 'RSZ5', 'RSZ6']
    .map((r) => `${p}${r}`).filter((n) => n !== 'IMG1RSZ6')),
  'IMG1FMT', 'IMG2FMT', 'IMG3FMT']);
export const REG_STORED = new Set(['INTEN2', 'INTST2', 'VLSYNC', 'VLRST1', 'VLRST2', 'VLRST3', 'GAMTAEN',
  ...PLANES.flatMap((p) => range(2, 17).filter((n) => n !== 12).map((n) => `${p}DMASET${n}`)),
  ...range(1, 7).map((n) => `DMADDCSET${n}`), 'IMG1DMAODR', 'IMG2DMAODR', 'IMG3DMAODR', 'OSDDMAODR',
  'YGAIN', ...range(1, 14).map((n) => `KNEE${n}`), 'ROT1', 'ROT2', 'ROT3', 'ROT4', 'RGBCNV',
  ...range(1, 8).map((n) => `CRM${n}`), 'GAM1', 'YCCNV', 'SETUP', 'YCCLIP1', 'YCLPF',
  'TVTFT17', 'TFTOUT1', 'PORT', 'HDMI1', 'HDMI2', 'CYCLE1', 'SYNC3', 'SYNC5', 'SYNC6', 'LINECNT1']);
// (EVF channel 1, TFT channel 2)
export const FEATURES = new Map([['CTRL2', [0x1C0, 0x1C0]], ['CTRL3', [1, 1]], ['SRAM1', [0x4000, 0x4000]], ['SRAM3', [0x4000, 0x4000]],
  ['VIDEOAREA3', [0x29, 0x08]],
  ...PLANES.map((p, i) => [`${p}HDLY`, [[0x2E, 0x2E, 0x2E, 0x2E, 0x30, 0x32][i], [0x2E, 0x2E, 0x2E, 0x2E, 0x30, 0x32][i]]]),
  ['MIXHDLY', [0x2E, 0x2E]], ['IMG1LPF', [0x100, 0x100]], ...[3, 4, 5, 6].map((n) => [`LPF${n}`, [0x100, 0x100]])]);
// Opt-in assumptions (spec section 7): A15 also accepts CTRL3 = 0x41.
export const OPT_IN_FEATURES = { A15: new Map([['CTRL3', 0x41]]) };

// Registers that must stay unwritten (A13): the names minus the three other classes (names: any iterable of names).
export function unwritten_class(names) {
  const out = [];
  for (const n of names) if (!REG_MODEL.has(n) && !REG_STORED.has(n) && !FEATURES.has(n)) out.push(n);
  return out;
}
// The classes as checks/fixtures/om1-vsc-tables.c defines them (reg_class ranges, features[] values), by name.
// src: the C file's text; names: Map offset -> name. Returns Map name -> [class, value pair or null].
export function model_classes(names, src) {
  const body = (table) => { const i = src.indexOf(table); if (i < 0) throw new ValueError(`${table} not in om1-vsc.c`); const rest = src.slice(i + table.length); return rest.slice(0, rest.indexOf('};')); };
  const ranges = [...body('reg_class[] = {').matchAll(/\{ (0x[0-9A-F]+), (0x[0-9A-F]+), RC_(MODEL|STORED) \}/g)].map((m) => [parseInt(m[1], 16), parseInt(m[2], 16), m[3]]);
  const num = (t) => (t.startsWith('0x') ? parseInt(t, 16) : parseInt(t, 10));
  const fixed = new Map([...body('features[] = {').matchAll(/\{ (0x[0-9A-F]+), (0x[0-9A-F]+|\d+), (0x[0-9A-F]+|\d+) \}/g)].map((m) => [parseInt(m[1], 16), [num(m[2]), num(m[3])]]));
  const out = new Map();
  for (const [off, name] of names) {
    const cls = ranges.find(([a, b]) => a <= off && off <= b)?.[2] ?? null;
    out.set(name, fixed.has(off) ? ['FEATURES', fixed.get(off)] : [cls ?? 'UNWRITTEN', null]);
  }
  return out;
}

// ---- the reference compositor
export class Skip extends Error {}
// A6 horizontal OSD sampling: output pixel i -> source column round_half_up(i * sh / 4096)
export function osd_cols(w, sh) { const out = []; for (let i = 0; i < w; i++) out.push(Math.floor((i * sh + 2048) / 4096)); return out; }

// A register dump that records which names were read (check_display.Recording): get(name) -> value or null.
export class Recording {
  constructor(bank) { this.bank = bank; this.read = new Set(); }
  get(name) { this.read.add(name); const v = this.bank.get(name); return v === undefined ? null : v; }
  keys() { return this.bank.keys(); }
}
const getOf = (m) => (name) => { const v = m.get(name); return v === undefined ? null : v; };

// Compose channel c from the mirror bank m (Map or Recording: name -> value, null = never written), the palette SRAM
// (1536 words, 6 banks of 256) and its written flags, and fetch(address, n) -> bytes, per the spec (check_display's
// reference()). Returns [width, height, words (Uint32Array), drawn, skipped (Map plane -> why), traced (Set of output
// pixel indices at which plane trace[0] sampled index trace[1])].
export function reference(c, m, pal, palWritten, fetch, order = PLANES, trace = null, assume = []) {
  const get = getOf(m);
  const need = (name) => { const v = get(name); if (v === null) throw new Skip(`${name} never written`); return v; };
  const va1 = need('VIDEOAREA1'), va2 = need('VIDEOAREA2'), bg = need('BG');
  if (!((need('SYNC1') >>> 24) & 1) || ((get('SYNC4') ?? 0) & 0x7FFF)) throw new Skip('field mode');
  const accepted = new Map();
  for (const a of assume) for (const [n, v] of OPT_IN_FEATURES[a]) accepted.set(n, v);
  let feature = !(c === 1 || c === 2);
  if (!feature) for (const [n, v] of FEATURES) if (get(n) !== v[c - 1] && !(accepted.has(n) && get(n) === accepted.get(n))) { feature = true; break; }
  if (!feature) for (const n of unwritten_class([...m.keys()])) if (get(n) !== null) { feature = true; break; }
  if (feature) throw new Skip('feature register outside the observed state');
  const ox = va1 >>> 16, width = va1 & 0xFFFF, oy = va2 >>> 16, height = va2 & 0xFFFF;
  const out = new Uint32Array(width * height).fill(bg & 0xFFFFFF);
  const dmaen = need('DMAEN'), osdcp2 = get('OSDCP2');
  const drawn = [], skipped = new Map(), traced = new Set();
  for (const plane of order) {
    const p = PLANES.indexOf(plane);
    if (!((dmaen >>> (5 - p)) & 1)) continue;
    try {
      const osd = plane.startsWith('OSD'), n = Number(plane[3]) - 1;
      if (osd && (need('OSDFMT1') !== 0x111 || need('OSDFMT2') !== 0x11)) throw new Skip('OSDFMT');
      const a1 = need(`${plane}AREA1`), a2 = need(`${plane}AREA2`);
      const x0 = (a1 >>> 16) - ox, w = a1 & 0xFFFF, y0 = (a2 >>> 16) - oy, h = a2 & 0xFFFF;
      if (x0 < 0 || y0 < 0 || x0 + w > width || y0 + h > height) throw new Skip('outside the window');
      const planc = need(`${plane}PLANC`);
      if (planc === 0) continue;                       // A7: PLANC 0, the plane is not drawn
      if (planc !== 0x100) throw new Skip('PLANC');
      if (!osd && need(`${plane}FMT`) !== 0) throw new Skip('format');
      const address = need(`${plane}DMASADR`) * 16, ld = need(`${plane}DMALD`), bn = need(`${plane}DMABN`);
      const spos = Math.floor((get(osd ? 'OSDDMASPOS' : 'IMGDMASPOS') ?? 0) / 2 ** (8 * n)) & 0xFF;
      if (address >= 2 ** 32) throw new Skip('DMA fields');
      // A18: the fetch starts SPOS pixels into the 128-byte burst that holds the address
      const sbytes = spos * (osd ? 1 : 2);
      if (spos || address % 128) {
        if ((address & 0x70) !== (sbytes & 0x70) || sbytes >= 128 || (!osd && (spos & 1))) throw new Skip('SPOS');
      }
      const base = Math.floor(address / 128) * 128 + sbytes;
      if ((ld & 7) || (ld >>> 15) || (bn & 7)) throw new Skip('DMA fields');
      const stride = (ld >>> 3) * 128, burst = (bn >>> 3) * 128;
      const rsz1 = need(`${plane}RSZ1`);
      if ((rsz1 & ~0x11) || [3, 5, 6].some((k) => get(`${plane}RSZ${k}`))) throw new Skip('RSZ');
      const unit = c === 2 && plane === 'IMG1' ? 8192 : 4096;
      const sh = rsz1 & 1 ? need(`${plane}RSZ2`) : 4096;
      const sv = rsz1 & 0x10 ? need(`${plane}RSZ4`) : unit;
      if ((plane === 'IMG1' || plane === 'IMG2') && ((get('PEAK1') ?? 0) & 0x11)) throw new Skip('PEAK1');
      if (plane !== 'IMG1' && need(osd ? `O${n + 1}BC` : `${plane}BC`) !== 0x10F) throw new Skip('BC');
      if (osd) {
        if (osdcp2 === null || (osdcp2 & ~0x111)) throw new Skip('OSDCP2');
        const bank = 256 * (2 * n + ((osdcp2 >>> (4 * n)) & 1));
        const cols = osd_cols(w, sh);
        if (!cols.length) throw new IndexError('list index out of range');      // cols[-1] of an empty list (w == 0)
        if (cols[w - 1] + 1 + sbytes > burst) throw new Skip('DMABN');
        const rows = new Map();
        for (let j = 0; j < h; j++) {
          const sy = Math.floor(j * sv / unit);
          if (!rows.has(sy)) rows.set(sy, fetch(base + sy * stride, cols[w - 1] + 1));
          const src = rows.get(sy), line = (y0 + j) * width + x0;
          for (let i = 0; i < w; i++) {
            const index = src[cols[i]];
            if (trace && trace[0] === plane && trace[1] === index) traced.add(line + i);
            const word = pal[bank + index];
            if (!palWritten[bank + index] || word >>> 29) continue;
            const under = out[line + i], tra = (word >>> 24) & 31;
            let mixed = 0;
            for (const s of [0, 8, 16]) mixed |= Math.floor((((word >>> s) & 255) * tra + ((under >>> s) & 255) * (31 - tra) + 15) / 31) << s;
            out[line + i] = mixed;
          }
        }
      } else {
        const cols = [];
        for (let i = 0; i < w; i++) cols.push([Math.floor(i * sh / 4096), (i * sh) % 4096]);
        if (!cols.length) throw new IndexError('list index out of range');      // cols[-1] of an empty list (w == 0)
        const [ls, lf] = cols[w - 1];
        const last = ls + (lf ? 1 : 0), nbytes = 4 * (Math.floor(last / 2) + 1);
        if (nbytes + sbytes > burst) throw new Skip('DMABN');
        const cache = new Map();
        const hrow = (r) => {
          if (!cache.has(r)) {
            const b = fetch(base + r * stride, nbytes);
            const Y = (k) => b[2 * k], CB = (k) => b[4 * k + 1], CR = (k) => b[4 * k + 3];
            const row = cols.map(([s, f]) => {
              if (f) {
                const g = 4096 - f;
                return [(Y(s) * g + Y(s + 1) * f + 2048) >> 12, (CB(s >> 1) * g + CB((s + 1) >> 1) * f + 2048) >> 12,
                  (CR(s >> 1) * g + CR((s + 1) >> 1) * f + 2048) >> 12];
              }
              return [Y(s), CB(s >> 1), CR(s >> 1)];
            });
            cache.set(r, row);
          }
          return cache.get(r);
        };
        for (let j = 0; j < h; j++) {
          const r = Math.floor(j * sv / unit), g = (j * sv) % unit;
          const top = hrow(r), line = (y0 + j) * width + x0;
          if (!g) { top.forEach(([y, cb, cr], i) => { out[line + i] = y | cb << 8 | cr << 16; }); continue; }
          const bot = hrow(r + 1), k = unit - g, half = Math.floor(unit / 2);
          top.forEach((a, i) => {
            const b = bot[i];
            out[line + i] = Math.floor((a[0] * k + b[0] * g + half) / unit) | Math.floor((a[1] * k + b[1] * g + half) / unit) << 8
              | Math.floor((a[2] * k + b[2] * g + half) / unit) << 16;
          });
        }
      }
      drawn.push(plane);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      skipped.set(plane, e.message);
    }
  }
  return [width, height, out, drawn, skipped, traced];
}

// ---- check_registers: the firmware-written registers by the spec formulas and the device-table inputs. sources: the
// OSD buffer bases {OSD1, OSD2, OSD3}; imgBase: the IMG region (when attached). Returns Map name -> value or null.
export function registers_want(device, c, sources, attached, imgBase) {
  const p = PANEL[device];
  const [hs, vs] = p.porch, [aw, ah] = p.active, [cw, ch] = p.canvas;
  const [y, cb, cr] = bt601(11, 11, 11);
  const want = new Map([['VIDEOAREA1', hs << 16 | aw], ['VIDEOAREA2', vs << 16 | ah], ['VIDEOAREA3', vs],
    ['SYNC1', 0x01000001], ['SYNC2', p.vtotal], ['SYNC3', p.vsync], ['SYNC4', 0], ['SYNC6', p.hsync << 16 | p.htotal],
    ['OSDCP2', 0x111], ['MIXODR2', 8], ['OSDMIX', 0x111111], ['OSDFMT1', 0x111], ['OSDFMT2', 0x11], ['OSDRESO', 0],
    ['MIXODR1', null], ['IMG1PLANC', 0x100], ['BG', cr << 16 | cb << 8 | y], ['DMAEN', attached ? 0x27 : 0x07]]);
  const rsz = (cw !== aw ? 1 : 0) | (ch !== ah ? 0x10 : 0);
  const ceil = (a, b) => -Math.floor(-a / b);
  for (const n of [1, 2, 3]) {
    const o = `OSD${n}`;
    for (const [k, v] of [[`${o}AREA1`, hs << 16 | (aw & 0xFFFE)], [`${o}AREA2`, vs << 16 | ah], [`${o}DMALD`, Math.floor(1664 / 128) << 3],
      [`${o}DMABN`, ceil(cw, 128) << 3], [`${o}RSZ1`, rsz], [`${o}DMASADR`, Math.floor(sources[o] / 16)], [`${o}PLANC`, 0x100], [`O${n}BC`, 0x10F]]) want.set(k, v);
    if (rsz & 1) want.set(`${o}RSZ2`, 4 * ceil((cw - 1) * 1024, aw));
    if (rsz & 0x10) want.set(`${o}RSZ4`, 4 * ceil((ch - 1) * 1024, ah));
  }
  if (attached) {
    const sw = 1620, sh_ = 1080;                        // the 3:2 test card, aspect code 1 (rank 3)
    let ow, oh;
    if (3 <= p.rank) { ow = Math.floor(ah * 3 / 2); oh = ah; } else { ow = aw; oh = Math.floor(aw * 2 / 3); }
    const x = Math.floor((aw - ow) / 2), yy = Math.floor((ah - oh) / 2);
    const rsz4 = Math.floor(((sh_ - 1) << 10) / oh) * 4 * (c === 2 ? 2 : 1);
    for (const [k, v] of [['IMG1AREA1', (hs + x) << 16 | (ow & 0xFFFE)], ['IMG1AREA2', (vs + yy) << 16 | oh], ['IMG1RSZ1', 0x11],
      ['IMG1RSZ2', Math.floor(((sw << 12) - 0x1001) / (ow - 1))], ['IMG1RSZ3', 0], ['IMG1RSZ4', rsz4], ['IMG1RSZ5', 0],
      ['IMG1DMALD', Math.floor(5568 / 64) << 3], ['IMG1DMABN', ceil(sw, 64) << 3], ['IMG1FMT', 0], ['IMG1DMASADR', Math.floor(imgBase / 16)], ['IMGDMASPOS', 0]]) want.set(k, v);
  }
  return want;
}

// check_palettes: the displayed palette word for an osddraw array entry {r, g, b, tra} (the firmware formula), and a
// GUI palette colour 0xAARRGGBB as the {r, g, b, tra} the array must hold (tra = alpha >> 3).
export function palette_word(r, g, b, tra) { const [y, cb, cr] = bt601(r, g, b); return (tra << 24 | cr << 16 | cb << 8 | y) >>> 0; }
export function gui_entry(colour) { return [(colour >>> 16) & 255, (colour >>> 8) & 255, colour & 255, colour >>> 27]; }

// ---- the display switch (group 6): the level table {u8 index, u8 panel, u8 level} x 15 at 0x602ae4b4 (from the image
// file) and the PLANC the switch path's level gives: (T[p449 + 7].level * 2) & 0x1fe, T searched by its index byte.
export const LEVEL_TABLE = 0x602AE4B4, LEVEL_ENTRIES = 15, SWITCH_INDEX_OFFSET = 7;
export function level_table(image) {
  const off = LEVEL_TABLE - 0x60021020, out = [];          // E143's image base (refs/ read the E143 block only)
  for (let i = 0; i < LEVEL_ENTRIES; i++) out.push([image[off + 3 * i], image[off + 3 * i + 1], image[off + 3 * i + 2]]);
  return out;
}
export function switch_planc(image, p449 = 0) {
  const index = Math.min(p449 + SWITCH_INDEX_OFFSET, LEVEL_ENTRIES - 1);
  const e = level_table(image).find(([i]) => i === index);
  if (!e) throw new Error(`StopIteration: no level table entry with index ${index}`);
  return (e[2] * 2) & 0x1FE;
}
