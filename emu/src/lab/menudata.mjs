// Offline decoder of the GUI menu layout data (Image, descriptor, keyed_list, groups, page_record, tabs,
// custom_value_handlers, mode_alias, tab_entry, page_of, store_reads, row_order, Strings, render, image_info,
// blob_read, colours, text_colour, lut, panel_case, rects, widget, panel329, check, dis). Every table address is a
// run-time address (body offset + IMAGE_BASE, E143 0x60021020); code addresses are disassembly notation. The lab, the
// play runtime and (injected, injected) refs/menuref.mjs use the same module.
// Dicts keyed by an int are Maps; the resource block is an argument, not a file this module reads
// (Strings, image_info, blob_read).
import { A, IMAGE_BASE, refuseUnmapped } from '../fw/model.mjs';
import { ValueError, KeyError, AssertionError } from './errors.mjs';
import * as R from './resources.mjs';

export const RT = IMAGE_BASE, DIS = 0x50000000;
export const TAB_COUNT = 8, TAB_IDS = A(0x61527174), TAB_TABLE = A(0x6152722C);
export const GROUP_LIST = A(0x6152D6B8), CUSTOM_VALUE = A(0x6152D6C0), ROW_ORDER = A(0x614DA31C), MODE_ALIAS = A(0x60373F64);
export const ALIAS_HANDLER = A(0x511BF0A6), NO_ALIAS = 3200, NULL_DESC = A(0x615273E4), SETUP_TAB = 6;
export const TYPE_IMAGE_FIELD = new Set([3, 12, 8, 7]), TYPE_STRING_FIELD = new Set([4, 1, 2, 10, 11, 9]);
export const TYPE_LITERAL = new Set([1, 2, 7, 8, 5, 6, 10, 11, 9]);
export const TYPE_RENDER_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);     // the descriptor types render handles
export const STYLE_TABLE = A(0x61587FD0), THEME_TABLE = A(0x61587F58), THEME_ROWBG = A(0x603751C8), TAB_THEME = A(0x613A0CA8);
export const LUT_TABLE = A(0x6147F318);
export const PANEL_SWITCH = A(0x613382DC), CREATOR_HASH = A(0x613372DC), MENU_PANEL = 329;
export const PANEL329_CHILDREN = A(0x6036BB44), PANEL329_CHILD_COUNT = 150, VAR226_SIZE = 2428, IMAGE_TABLE_SLOT = A(0x60370AF8);

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class Image {
  constructor(d) { this.d = d; }
  off(a) {
    const o = a - RT;
    if (!(o >= 0 && o < this.d.length)) throw new ValueError(`address ${h8(a)} outside the image`);
    return o;
  }
  u8(a) { return this.d[this.off(a)]; }
  u16(a) { const o = this.off(a); return this.d[o] | this.d[o + 1] << 8; }
  s16(a) { const v = this.u16(a); return v & 0x8000 ? v - 0x10000 : v; }
  u32(a) { const o = this.off(a), d = this.d; return (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0; }
  isptr(v) { return RT <= v && v < RT + this.d.length; }
  cstr(a) {
    const o = this.off(a), z = this.d.indexOf(0, o);
    if (z < 0) throw new ValueError('subsection not found');
    let s = '';
    for (let i = o; i < z; i++) {
      if (this.d[i] > 0x7F) throw new ValueError(`'ascii' codec can't decode byte 0x${this.d[i].toString(16)} in position ${i - o}: ordinal not in range(128)`);
      s += String.fromCharCode(this.d[i]);
    }
    return s;
  }
}

export const dis = (rtAddr) => rtAddr - RT + DIS;

// ---- menu content
// 8-byte text descriptor {u16 type, u16 id, char *literal}.
export function descriptor(img, a) {
  const t = img.u16(a), i = img.u16(a + 2), p = img.u32(a + 4);
  let lit;
  if (p === NULL_DESC) lit = null;
  else {
    if (!img.isptr(p)) throw new ValueError(`descriptor ${h8(a)}: literal pointer ${h8(p)}`);
    lit = img.cstr(p);
  }
  if (!TYPE_RENDER_TYPES.has(t) && t !== 0) throw new ValueError(`descriptor ${h8(a)}: type ${t} not handled by 0x51241ff9`);
  return { type: t, id: i, literal: lit };
}
// n x 12-byte {u32 key, descriptor}.
export function keyed_list(img, a, n) {
  return range(0, n).map((k) => ({ key: img.u32(a + 12 * k), ...descriptor(img, a + 12 * k + 4) }));
}
const GROUPS = new WeakMap();
// page id -> {page_id, title, record, header, (page_record fields)}; cached per image bytes (pure reads; callers do
// not mutate it).
export function groups(img) {
  let out = GROUPS.get(img.d);
  if (out) return out;
  const key = img.u16(GROUP_LIST), count = img.u16(GROUP_LIST + 2), ptr = img.u32(GROUP_LIST + 4);
  if (key !== 0) throw new ValueError('group list key');
  out = new Map();
  for (let g = 0; g < count; g++) {
    const a = ptr + 16 * g;
    const page_id = img.u32(a), title = descriptor(img, a + 4), rec = img.u32(a + 12);
    const e = { page_id, title, record: rec, header: a };
    out.set(page_id, e);
    if (rec) Object.assign(e, page_record(img, rec));
  }
  GROUPS.set(img.d, out);
  return out;
}
// 28-byte page record {n, label list, help list, n2, value lists, n3, value lists (2nd layer)}.
export function page_record(img, a) {
  const [n, labels, helps, n2, vals, n3, vals2] = range(0, 7).map((i) => img.u32(a + 4 * i));
  const lab = keyed_list(img, labels, n), hlp = keyed_list(img, helps, n);
  const vl = new Map();
  for (let j = 0; j < n2; j++) {
    const m = img.u16(vals + 8 * j), c = img.u16(vals + 8 * j + 2), p = img.u32(vals + 8 * j + 4);
    vl.set(m, keyed_list(img, p, c));
  }
  return { n, labels: lab, helps: hlp, values: vl, values_2nd: [n3, vals2], values_ptr: [n2, vals] };
}
const TABS = new WeakMap();
// [{index, id, pages, aux}] of the 8 tabs; cached per image bytes.
export function tabs(img) {
  let out = TABS.get(img.d);
  if (out) return out;
  // a ListMenu build whose tables the port left unplaced (menu.mjs LIST_MENU) fails here by name, not on a read
  refuseUnmapped(TAB_IDS, 'menudata tabs: the tab id table');
  refuseUnmapped(TAB_TABLE, 'menudata tabs: the tab table');
  out = [];
  for (let t = 0; t < TAB_COUNT; t++) {
    const a = TAB_TABLE + 12 * t;
    const tid = img.u16(a), n = img.u16(a + 2), pages = img.u32(a + 4), aux = img.u32(a + 8);
    if (img.u16(TAB_IDS + 2 * t) !== tid) throw new ValueError(`tab ${t}: id table mismatch`);
    out.push({ index: t, id: tid, pages: range(0, n).map((i) => img.u16(pages + 2 * i)), aux: range(0, n).map((i) => img.u16(aux + 2 * i)) });
  }
  TABS.set(img.d, out);
  return out;
}
// menu mode -> handler (disassembly address).
export function custom_value_handlers(img) {
  const out = new Map();
  for (let i = 0; i < 36; i++) out.set(img.u16(CUSTOM_VALUE + 8 * i), dis(img.u32(CUSTOM_VALUE + 8 * i + 4)));
  return out;
}
// Menu mode -> store mode for handler 0x511bf0a6 (14 entries).
export function mode_alias(img) {
  const out = new Map();
  for (let i = 0; i < 14; i++) out.set(img.u16(MODE_ALIAS + 4 * i), img.u16(MODE_ALIAS + 4 * i + 2));
  return out;
}
export function tab_entry(img, tabId) {
  for (const t of tabs(img)) if (t.id === tabId) return t;
  throw new ValueError(`tab id ${tabId} not in the tab table`);
}
// [page id, cursor-memory setting id] of 1-based page `page` of tab id `tabId`.
export function page_of(img, tabId, page) {
  const t = tab_entry(img, tabId);
  if (!(page >= 1 && page <= t.pages.length)) throw new ValueError(`tab ${tabId} has ${t.pages.length} pages`);
  return [t.pages[page - 1], t.aux[page - 1]];
}
// Settings-store reads the value column of a page makes: Map store mode -> {row, menu_mode, keys}.
export function store_reads(img, pageId) {
  const e = groups(img).get(pageId);
  if (e === undefined) throw new KeyError(String(pageId));            // groups(img)[page_id]
  const handlers = custom_value_handlers(img), alias = mode_alias(img);
  const out = new Map();
  e.labels.forEach((lab, r) => {
    const m = lab.key;
    if (!e.values.has(m)) return;
    const keys = e.values.get(m).map((v) => v.key);
    if (!handlers.has(m)) out.set(m, { row: r, menu_mode: m, keys });
    else if (handlers.get(m) === ALIAS_HANDLER && (alias.get(m) ?? NO_ALIAS) !== NO_ALIAS) out.set(alias.get(m), { row: r, menu_mode: m, keys });
  });
  return out;
}
// cursor kind -> Map sub-key -> mode ids in row order (0x51170afb).
export function row_order(img) {
  const out = new Map();
  for (let a = ROW_ORDER; ; a += 8) {
    const k = img.u16(a), c = img.u16(a + 2), p = img.u32(a + 4);
    if (!img.isptr(p)) return out;
    const subs = new Map();
    for (let s = 0; s < c; s++) {
      const sk = img.u16(p + 8 * s), sn = img.u16(p + 8 * s + 2), sp = img.u32(p + 8 * s + 4);
      subs.set(sk, range(0, sn).map((i) => img.u16(sp + 2 * i)));
    }
    out.set(k, subs);
  }
}

// ---- strings / images
// The string table per language (the image's and the block's language map).
export class Strings {
  constructor(langs, image, block) {
    this.t = new Map();
    const table = R.languages(image, block);
    for (const lang of langs) {
      const e = table.find((x) => x.lang === lang);
      if (!e) throw new ValueError('StopIteration');
      this.t.set(lang, new R.StringTable(e.strings_record, R.raw_record(e.strings_record, block)));
    }
  }
  get(lang, sid) { return this.t.get(lang).text(sid); }
}
// Text the panel would show for a descriptor (0x51241ff9), or an image reference.
export function render(desc, strings, lang) {
  const t = desc.type, i = desc.id, lit = desc.literal;
  const s = () => strings.get(lang, i);
  if (t === 4) return i ? s() : '<type 4 id 0: the text widget keeps its previous text>';
  if (t === 1) return lit + s();
  if (t === 2) return s() + lit;
  if (t === 5) return lit !== null ? lit : '<no literal: text comes from the custom handler>';
  if (t === 6) return [...lit].map((ch) => (ch === '0' ? '@A08D@0' : ch)).join('');
  if (t === 9) return '@A028@' + lit + s();
  if (t === 10) return '@A070@' + lit + s();
  if (t === 11) return '@A061@' + lit + s();
  if (t === 3 || t === 12) return `<image ${i}>`;
  return '';
}
const IMG = new WeakMap();
function imgCache(block) {
  let c = IMG.get(block);
  if (c) return c;
  const blobs = R.blobs(block);
  const rd = (addr, n) => {
    for (const [load, data] of blobs) if (load <= addr && addr < load + data.length) return data.subarray(addr - load, addr - load + n);
    return null;
  };
  const d0 = blobs[0][1];
  const table = (d0[4] | d0[5] << 8 | d0[6] << 16 | d0[7] << 24) >>> 0;
  c = { rd, table };
  IMG.set(block, c);
  return c;
}
const u32b = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const u16b = (b, o) => b[o] | b[o + 1] << 8;
// Image id -> {kind, w, h, bpp, size, record, data, word20} through the resource-0 pointer table, or null.
export function image_info(iid, block) {
  const { rd, table } = imgCache(block);
  const pb = rd(table + 4 * iid, 4);
  if (pb === null || pb.length < 4) throw new ValueError('unpack requires a buffer of 4 bytes');
  const p = u32b(pb, 0);
  const rec = rd(p, 24);
  if (rec === null) return null;
  if (rec.length < 24) throw new ValueError('unpack requires a buffer of 24 bytes');
  return { kind: u16b(rec, 0), w: u16b(rec, 2), h: u16b(rec, 4), bpp: u16b(rec, 6), size: u32b(rec, 12), record: p, data: u32b(rec, 16), word20: u32b(rec, 20) };
}
// Bytes of the two resource blobs at their link addresses (null outside them).
export function blob_read(addr, n, block) { return imgCache(block).rd(addr, n); }

// ---- colours
export function colours(img) {
  const style = range(0, 24).map((c) => [img.u32(STYLE_TABLE + 8 * c), img.u32(STYLE_TABLE + 8 * c + 4)]);
  const themes = range(0, 10).map((t) => {
    const a = THEME_TABLE + 12 * t;
    const pimg = img.u32(a), pcol = img.u32(a + 4), edge = img.u8(a + 8), rowbg = img.u32(THEME_ROWBG + 4 * t);
    return { image_lut: range(0, 23).map((i) => img.u16(pimg + 2 * i)), text: range(0, 9).map((i) => img.u32(pcol + 4 * i)), edge,
      rowbg_lut: range(0, 12).map((i) => img.u16(rowbg + 2 * i)) };
  });
  return { style, themes, tab_theme: range(0, 8).map((i) => img.u32(TAB_THEME + 4 * i)) };
}
// Palette index the label is drawn with for record style code `code` (0x51242214..0x51242240).
export function text_colour(col, theme, code) {
  if (code >= 24) return null;
  const slot = col.style.at(code)[1];
  if (slot >= col.themes.at(theme).text.length) throw new ValueError(`style code ${code}: text slot ${slot} is past the 9-entry colour array`);
  return col.themes.at(theme).text[slot];
}
export function lut(img, lutId) {
  const a = LUT_TABLE + 12 * lutId;
  const n = img.u32(a), p = img.u32(a + 8);
  if (!p) return null;
  return bytes_at(img, p, n);
}
// The n bytes at p, read one at a time: the first byte outside the image raises ValueError, so a garbage
// count n (a u32) raises instead of allocating n bytes first.
export function bytes_at(img, p, n) {
  let o = 0;
  if (n > 0) {
    o = img.off(p);
    if (o + n > img.d.length) throw new ValueError(`address ${h8(p + (img.d.length - o))} outside the image`);   // Image.off's, at the first address past the image
  }
  return new Uint8Array(img.d.subarray(o, o + n));
}

// ---- panel
// Panel number -> [panel id, panel descriptor] from the case code.
export function panel_case(img, n) {
  const t = img.u32(PANEL_SWITCH + 4 * n);
  const code = img.d.subarray(img.off(t), img.off(t) + 24);
  if (code[9] !== 0x2C || code[12] !== 0xFC || code[13] !== 0xDD) throw new ValueError(`panel ${n}: unexpected case code ${Array.from(code, (b) => b.toString(16).padStart(2, '0')).join('')}`);
  return [u16b(code, 10), u32b(code, 14)];
}
export function rects(img, p, n = 2) {
  return range(0, n).map((i) => range(0, 4).map((k) => img.s16(p + 8 * i + 2 * k)));
}
export function widget(img, p) {
  const cls = img.u16(p), wid = img.u16(p + 2);
  const w = { desc: p, cls, id: wid, rects: rects(img, img.u32(p + 4)), h8: img.u32(p + 8), h12: img.u32(p + 12), h16: img.u16(p + 16) };
  if (cls === 0x8003 || cls === 0x8010) {
    const o = img.off(p) + 24, st = img.d.subarray(o, o + 24);
    const s16b = (b, k) => { const v = u16b(b, k); return v & 0x8000 ? v - 0x10000 : v; };
    Object.assign(w, { text_id: img.u16(p + 20), font: img.u16(p + 48),
      style: { colour: u32b(st, 0), s4: u32b(st, 4), s8: u32b(st, 8), halign: st[12], valign: st[13],
        margins: [s16b(st, 14), s16b(st, 16), s16b(st, 18), s16b(st, 20)], edge: st[22] } });
  }
  if (cls === 0x8003) {
    const n = img.u8(p + 53), sp = img.u32(p + 56);
    const states = range(0, n).map((s) => { const a = sp + 16 * s; return { bg: img.u32(a), c1: img.u32(a + 4), c2: img.u32(a + 8), image: img.u16(a + 12) }; });
    Object.assign(w, { kind: img.u8(p + 52), states, state_lut: range(0, n).map((s) => img.u16(img.u32(p + 60) + 2 * s)) });
  }
  if (cls === 0x8010) w.draw_mode = img.u8(p + 60);
  return w;
}
const PANEL = new WeakMap();
// Panel 329's widget tree; cached per image bytes.
export function panel329(img) {
  let out = PANEL.get(img.d);
  if (out) return out;
  const [pid, desc] = panel_case(img, MENU_PANEL);
  const kids = [];
  for (let i = 1; i < PANEL329_CHILD_COUNT; i++) {
    const p = img.u32(PANEL329_CHILDREN + 4 * i);
    if (p) kids.push({ index: i, ...widget(img, p) });
  }
  out = { panel: MENU_PANEL, panel_id: pid, descriptor: desc, panel_rects: rects(img, img.u32(desc + 4)), children: kids };
  PANEL.set(img.d, out);
  return out;
}

// ---- checks
// Structural assertions that make the decode fail loudly instead of guessing (AssertionError with the message the
// recorded outcomes carry).
export function check(img) {
  const assert = (ok, msg) => { if (!ok) throw new AssertionError(msg); };
  const g = groups(img);
  const ids = [...g.keys()].sort((a, b) => a - b);
  assert(g.size === 42 && sameList(ids, range(0xCB, 0xF5)), 'group ids');
  for (const [pid, e] of g) {
    if (!e.record) { assert(pid >= 0xF0 && pid <= 0xF4, `page 0x${pid.toString(16)} has no record`); continue; }
    assert(sameList(e.values_2nd, e.values_ptr), `page 0x${pid.toString(16)}: 2nd-layer value lists differ`);
    assert(sameList(e.labels.map((x) => x.key), e.helps.map((x) => x.key)), `page 0x${pid.toString(16)}: help keys`);
    assert([...e.labels, ...e.helps].every((x) => x.type === 4), `page 0x${pid.toString(16)}: non-string label`);
    const keys = new Set(e.labels.map((x) => x.key));
    assert([...e.values.keys()].every((k) => keys.has(k)), `page 0x${pid.toString(16)}: value list for unknown mode`);
  }
  const t = tabs(img);
  assert(sameList(t.flatMap((x) => x.pages).sort((a, b) => a - b), range(0xCB, 0xF5)), 'tabs cover the groups once');
  const ro = row_order(img);
  for (const [pid, e] of g) {
    if (!e.record) continue;
    const r = ro.get(pid + 4);
    assert(r !== undefined && r.size === 1 && r.has(0) && sameList(r.get(0), e.labels.map((x) => x.key)), `row order 0x${pid.toString(16)}`);
  }
  const [pid] = panel_case(img, MENU_PANEL);
  assert(pid === 0x6000 + 63, 'panel 329 id');
  assert(panel329(img).children.length === 149, '');
  assert(sameList(colours(img).tab_theme, range(2, 10)), '');
  return true;
}
