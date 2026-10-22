// The independent reference for a Setup Menu page (what the firmware should draw, predicted from
// data) and for navigation (Nav), used by check_menu and check_nav after their lab sessions ended. It reads firmware
// data only: the menu tables through src/lab/menudata.mjs, the resource block through src/lab/resources.mjs, glyphs
// through refs/font.mjs and bitmaps through refs/osdfmt.mjs; never lab memory. Those two modules are
// injected (new Reference({lang,
// layout, image, block, M, R})), so refs/ still imports only refs/. The rules, their tags and evidence are
// INPUTS and NAV_RULES, below.
import * as FT from './font.mjs';
import * as F from './osdfmt.mjs';
import { ValueError, KeyError, IndexError } from './errors.mjs';

export const PANEL_W = 900, PANEL_H = 600;
export const PAGE_BARS = new Map([[0, [0x613A0CC8, 0x613A0DC8]], [1, [0x613A0D48, 0x613A0E48]]]);
export const STRIDE = 1664, ROWS = 1200, SETUP_TAB_ID = 7;
export const LUT_LIMIT = new Map([[0, 256], [1, 256], [2, 64]]);
export const INPUTS = {
  clear: ['X', 'paint-pass FILL colour per GUI layer 127 / 255 / 31; the source of these values is not traced'],
  row_state_s: ['I', 's (0x511bdb2c level 0 -> 0x511b5689, item objects vt+12) taken as 0 on every row of the Setup tab except the rows of ROW_STATE_DEFAULTS; not decoded (R4). Other tabs are refused: on tab 5 page 1 the lab drew the labels in colours 22/25 (styles 7/8, s != 0), not 13'],
  row_state_defaults: ['X', 's != 0 with the blank-store defaults on page 1 row 2 (video Card Slot Settings) and page 4 row 1 (Bluetooth), rows from 0: the lab draws them in style 7 (colour 22); s = 0 on every other Setup row (pages 1-6, en, M6 lab). With the empty store of M5 s = 0 everywhere. Which store values the item objects test is not decoded'],
  cursor_row: ['I', 'cursor row = cursor-memory value - 1 for values 1..rows only; the path 0x511bdfea (value + 1) -> kind-6 object +140 -> level-0 object is not decoded, and other values are refused. Lab observations (X, not modelled; rows counted from 1): page 2 (3 rows) value 0 -> row 3 and value 5 -> row 1; page 1 value 7 -> row 1'],
  paint_order: ['I', 'per GUI layer (descriptor +16 - 1): FILL of the panel, then the visible children in index order'],
  text_box: ['I', "text widget DrawText box = (0, 0, w-1, h-1), gc+12/+14 = -(x, y) of the layout's rect"],
  second_pass: ['I', 'the second paint (message 0x1002, tab band clip (130,0)-(769,61)) repaints the band with the same content: the displayed buffers equal the first pass'],
  type0: ['I', 'a value with no matching item leaves the record as its caller set it, taken as zeroed (type 0; 0x51188203 writes nothing for a missing key, where the record is cleared is not traced). The renderer part is read from code: type < 1 jumps to 0x51242204 with a3 = 0 and (40,sp) = 0 (0x51241ffd..08), no colour is set and 0x51242285..9c hides both widgets'],
  child29: ['I', 'variable 226 +8 = 0: the scroll-position child 29 is hidden'],
  containers: ['I', 'containers 8..20, 135..149 (class 0x0105, not decoded) draw nothing'],
  menu_mode: ['I', 'menu mode 0x51167269(0x51167085()) is not 1, 3 or 4 (the normal tab menu)'],
};
export const CLEAR = new Map([[0, 127], [1, 255], [2, 31]]);
export const F_LEVEL = 1, S_ROW = 0;
export const ROW_STATE_DEFAULTS = new Map([[1, new Set([2])], [4, new Set([1])]]);
export const CARD_SLOT = 0x511BF488, SAVE_FOLDER = 0x511BF4F4, DPI = 0x511BF55D;
const h8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const bytesHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
// printf's %d (with a width) of an int
const pd = (fmt, v) => fmt.replace(/%(\d*)d/, (_, w) => String(v).padStart(w ? +w : 0, ' '));

export class Element {
  constructor(layer, kind, child, data) {
    this.layer = layer; this.kind = kind; this.child = child; this.data = { ...data };
  }
  // What an element shows as (src/util/show.mjs) and compares by: its data without the pixels, bytes as hex.
  toJSON() {
    const data = Object.fromEntries(Object.entries(this.data).filter(([k]) => k !== 'pixels').map(([k, x]) => [k, x instanceof Uint8Array ? bytesHex(x) : x]));
    return { kind: this.kind, layer: this.layer, child: this.child, data };
  }
}

// Firmware data for one language; page() builds the element list of a Setup page.
//   new Reference({ lang, layout = 1, image (main block bytes), block (resource block bytes), M (src/lab/menudata.mjs),
//   R (src/lab/resources.mjs) })
export class Reference {
  constructor({ lang, layout = 1, image, block, M, R }) {
    if (layout !== 0 && layout !== 1) throw new ValueError(`layout ${layout}: 0 (mode byte 0) or 1`);
    this.M = M;
    this.img = new M.Image(image);
    this.lang = lang;
    this.layout = layout;
    this.strings = new M.Strings([lang], image, block);
    this.colours = M.colours(this.img);
    const panel = M.panel329(this.img);
    this.panel = new Map(panel.children.map((w) => [w.index, w]));
    const [x, y, W, H] = panel.panel_rects[layout];
    this.W = W; this.H = H;
    if (x !== 0 || y !== 0) throw new ValueError(`panel 329 layout ${layout} rect (${panel.panel_rects[layout].join(', ')}): not at the origin`);
    this.handlers = M.custom_value_handlers(this.img);
    this.alias = M.mode_alias(this.img);
    this.groups = M.groups(this.img);
    this.block = block;
    const langs = new Map(R.languages(this.img.d, block).map((e) => [e.lang, e]));
    this.font = new FT.Font(R.raw_record(langs.get(lang).font_record, block));
    const [load, blob0] = R.blobs(block)[0];
    this.blob0 = blob0; this.load0 = load;
    this.icon_table = u32(this.blob0, 0);
    this.size = 62;
  }
  element(layer, kind, child, data) { return new Element(layer, kind, child, data); }
  // ---- data access
  icon(code) {
    const a = this.icon_table + 4 * (code - 0xA000) - this.load0;
    const entry = u32(this.blob0, a);
    const o = entry - this.load0;
    const w = u16(this.blob0, o), h = u16(this.blob0, o + 2), header = u32(this.blob0, o + 4), two = u32(this.blob0, o + 8);
    if (two !== 2) throw new ValueError(`icon ${code.toString(16).toUpperCase().padStart(4, '0')}: entry 0x${h8(entry)}`);
    return [w, h, header];
  }
  // 0x51241a9a via 0x51241ff9: THEME[t].text[STYLE[code].text slot].
  text_colour(theme, style) { return this.M.text_colour(this.colours, theme, style); }
  // The u8 table the GPI bitmap callback passes as gpiDrawBitmap (112).
  lut_bytes(lutId, layer, record) {
    const a = this.M.LUT_TABLE + 12 * lutId;
    const n = this.img.u32(a), ptr = this.img.u32(a + 8);
    if (!ptr) return null;
    if (!LUT_LIMIT.has(layer)) throw new KeyError(String(layer));
    const limit = LUT_LIMIT.get(layer);
    const cnt = Math.min(n, limit);
    // n bytes from ptr, read one by one: the first byte outside the image raises, so a garbage n (a u32) raises that
    // ValueError here instead of allocating n bytes first
    let o = 0;
    if (n > 0) {
      o = this.img.off(ptr);
      if (o + n > this.img.d.length) throw new ValueError(`address 0x${(ptr + this.img.d.length - o).toString(16).padStart(8, '0')} outside the image`);   // Image.off's, at the first address past the image
    }
    const mp = this.img.d.subarray(o, o + n);
    const typed = [14, 15, 16].includes(record.kind);
    const table = Uint8Array.from(range(0, 256));
    for (let i = 0; i < cnt; i++) table[i] = typed && mp[i] === record.word20 ? 0 : mp[i];
    const word = record.word20 & 0xFF;
    if (typed && cnt < limit && word >= cnt) table[word] = 0;
    if (limit < 256) throw new ValueError(`layer ${layer}: entries ${limit}..255 of the table are not written by the firmware (0x510bc5fd..0x510bc646): not modelled`);
    return table;
  }
  image(iid) {
    const info = this.M.image_info(iid, this.block);
    if (info === null || info.kind !== 14) throw new ValueError(`image ${iid}: ${info === null ? 'null' : infoRepr(info)}`);
    const data = this.M.blob_read(info.data, info.size + 4, this.block);
    const [w, h, fmt, pixels] = F.decode_bitmap(data);
    if (w !== info.w || h !== info.h) throw new ValueError(`image ${iid}: bitmap ${w}x${h}, record ${info.w}x${info.h}`);
    return { ...info, fmt, pixels };
  }
  // ---- the page model
  // Elements of Setup page `page` (1-based) with cursor-memory value `cursor` and store values (a mapping with get(id,
  // default)). Returns {page_id, elements, unverified, var, theme, cursor_row}. s_rows: rows with s != 0.
  page(page, cursor, store = null, tab = SETUP_TAB_ID, s_rows = new Set()) {
    const M = this.M;
    if (tab !== SETUP_TAB_ID) throw new ValueError(`tab ${tab}: only the Setup tab (${SETUP_TAB_ID}) is modelled; the row state s is taken as 0 (INPUTS row_state_s), which the lab contradicts on other tabs`);
    store = store ?? { get: (sid, d = 0) => d };
    const t = M.tab_entry(this.img, tab);
    const tabIndex = t.index;
    const pageId = t.pages.at(page - 1);
    if (pageId === undefined) throw new IndexError('list index out of range');
    const count = t.pages.length;
    const theme = this.colours.tab_theme[tabIndex];
    const g = this.groups.get(pageId);
    const rowModes = g.labels.map((x) => x.key);
    const nRows = Math.min(rowModes.length, 7);
    if (!(cursor >= 1 && cursor <= nRows)) throw new ValueError(`cursor memory ${cursor} on page ${page} (${nRows} rows): only 1..${nRows} is modelled (the firmware path 0x511bdfea -> level 0 is not decoded)`);
    const cursorRow = cursor - 1;
    const unverified = [];
    const f = F_LEVEL;
    const tabs = range(0, 8).map((i) => (i === tabIndex ? 1 : 3));
    const [numCode, titleStyle] = f === 1 ? [5, 6] : [6, 7];
    const rows = [];
    rowModes.slice(0, 7).forEach((mode, r) => {
      const label = g.labels.find((x) => x.key === mode);
      let style;
      if (f === 2) style = r === cursorRow ? 1 : 7;
      else {
        const s = s_rows.has(r) ? 1 : S_ROW;
        style = s === 0 ? 1 : r === cursorRow ? 8 : 7;
      }
      const [value, source] = this.value_record(g, mode, store);
      rows.push({ mode, label, style, value, source });
    });
    const bgs = range(0, 7).map((k) => (f === 2 ? (k === cursorRow ? [2, 11] : null) : k === cursorRow ? [1, 5] : [2, 11]));
    const v = { tabs, number: `${page}.`, number_code: numCode, title: { ...g.title, style: titleStyle }, bars: [count, page], rows, bgs, theme };
    const widgets = new Map();
    for (let k = 0; k < 8; k++) if (tabs[k]) widgets.set(21 + k, { kind: 'image', state: tabs[k] - 1 });
    widgets.set(30, { kind: 'text', text: v.number, colour: this.colours.themes[theme].text[numCode], edge: 0 });
    this.record_widgets(widgets, 31, 32, v.title, theme);
    const [bx, bd] = PAGE_BARS.get(this.layout);
    const barX = range(0, count).map((k) => this.img.s16(bx + 16 * (count - 1) + 2 * k));
    const barD = range(0, count).map((k) => this.img.s16(bd + 16 * (count - 1) + 2 * k));
    for (let k = 0; k < count; k++) {
      const selected = k + 1 === page;
      const code = selected ? 18 : 19;
      const lutId = this.colours.themes[theme].image_lut[code];
      widgets.set(33 + k, { kind: 'image', state: selected ? 0 : 1, lut_id: lutId, rect: [barX[k], null, barX[k] + barD[k], null] });
    }
    rows.forEach((row, r) => {
      this.record_widgets(widgets, 41 + r, 48 + r, { ...row.label, style: row.style }, theme);
      if (row.value !== null) this.record_widgets(widgets, 55 + r, 62 + r, { ...row.value, style: row.style }, theme);
      if (row.source === 'handler') {
        const pad = this.font.header[10];
        for (const child of [55 + r, 62 + r, ...range(69, 132).filter((c) => this.row_of(c) === r)]) {
          const [x0, y0, x1, y1] = this.rect(child);
          unverified.push([child, [x0 - pad, y0, x1 + pad, y1], `row ${r} mode ${row.mode}: custom value handler 0x${h8(this.handlers.get(row.mode))} not decoded (R5)`]);
        }
      }
    });
    bgs.forEach((bg, k) => {
      if (bg) {
        const [state, code] = [bg[0] - 1, bg[1]];
        const w = { kind: 'image', state };
        if (code !== 11) w.lut_id = this.colours.themes[theme].rowbg_lut[code];
        widgets.set(1 + k, w);
      }
    });
    const elements = [];
    const children = [...widgets.keys()].sort((a, b) => a - b);
    for (let layer = 0; layer < 3; layer++) {
      elements.push(this.element(layer, 'fill', null, { x: 0, y: 0, w: this.W, h: this.H, colour: CLEAR.get(layer) }));
      for (const child of children) if (this.panel.get(child).h16 - 1 === layer) elements.push(...this.draw(child, widgets.get(child), layer));
    }
    return { page_id: pageId, elements, unverified, var: v, theme, cursor_row: cursorRow };
  }
  // Value cell of a row: [record or null, source].
  value_record(g, mode, store) {
    if (!g.values.has(mode)) return [null, 'none'];
    const items = g.values.get(mode);
    let value;
    if (this.handlers.has(mode)) {
      const h = this.handlers.get(mode);
      if (h === CARD_SLOT) {
        const v1 = store.get(1129, 0);
        const sub = (v1 === 0 || v1 === 1) && store.get(1130, 0) ? items.slice(2) : items;
        const item = sub.find((x) => x.key === v1) ?? null;
        return [item ? { type: item.type, id: item.id, literal: item.literal } : { type: 0, id: 0, literal: null }, `handler 0x${h8(h)}`];
      }
      if (h === SAVE_FOLDER) {
        if (store.get(1400, 0) === 0) {
          const item = items.find((x) => x.key === 0) ?? null;
          if (item === null) throw new TypeError('SAVE_FOLDER: no item with key 0');
          return [{ type: item.type, id: item.id, literal: item.literal }, `handler 0x${h8(h)}`];
        }
        return [{ type: 5, id: 0, literal: pd('%3dOMSYS', store.get(1133, 0)) }, `handler 0x${h8(h)}`];
      }
      if (h === DPI) return [{ type: 5, id: 0, literal: pd('%ddpi', store.get(179, 0)) }, `handler 0x${h8(h)}`];
      if (h !== this.M.ALIAS_HANDLER) return [null, 'handler'];
      const smode = this.alias.get(mode) ?? this.M.NO_ALIAS;
      if (smode === this.M.NO_ALIAS) return [{ type: 0, id: 0, literal: null }, 'alias none'];
      value = store.get(smode, 0);
    } else value = store.get(mode, 0);
    const item = items.find((x) => x.key === (value & 0xFFFFFFFF) >>> 0) ?? null;
    if (item === null) return [{ type: 0, id: 0, literal: null }, `value ${value}: no item`];
    return [{ type: item.type, id: item.id, literal: item.literal }, `value ${value}`];
  }
  // 0x51241ff9: a record shows in the text widget (types 1, 2, 4, 5, 6, 9, 10, 11) or the image widget (3, 12).
  record_widgets(widgets, imageChild, textChild, rec, theme) {
    const t = rec.type, style = rec.style;
    if (t === 4 && rec.id === 0) throw new ValueError('type 4 with string id 0: 0x51241a80 hides the text widget without setting its text, then 0x5124229c shows it again (a3 = 1 from 0x512421c2), so it keeps the text it held before: not modelled');
    if ([1, 2, 4, 5, 6, 9, 10, 11].includes(t)) {
      widgets.set(textChild, { kind: 'text', text: this.M.render(rec, this.strings, this.lang), colour: this.text_colour(theme, style), edge: 0 });
    } else if (t === 3 || t === 12) {
      const code = t === 12 && style >= 1 && style <= 9 ? style + 9 : style;
      const slot = this.colours.style.at(code)[0];
      const lutId = this.colours.themes[theme].image_lut.at(slot);
      widgets.set(imageChild, { kind: 'image', image: rec.id, state: 0, lut_id: lutId === 0xFFFF ? null : lutId });
    }
  }
  row_of(child) { return Math.floor((this.panel.get(child).rects[this.layout][1] - 141) / 64); }
  // Inclusive rect [x0, y0, x1, y1] of a child in this layout.
  rect(child) {
    const [x, y, w, h] = this.panel.get(child).rects[this.layout];
    return [x, y, x + w - 1, y + h - 1];
  }
  draw(child, wd, layer) {
    const desc = this.panel.get(child);
    let [x0, y0, x1, y1] = this.rect(child);
    if (wd.kind === 'text') {
      const st = desc.style;
      return [this.element(layer, 'text', child, { text: wd.text, colour: wd.colour, edge: wd.edge, s4: st.s4, s8: st.s8, align: [st.halign, st.valign],
        margins: [...st.margins], box: [x0, y0, x1, y1], local: [0, 0, x1 - x0, y1 - y0], origin: [x0, y0] })];
    }
    if ('rect' in wd) { x0 = wd.rect[0]; x1 = wd.rect[2]; }
    const iid = wd.image || desc.states[wd.state].image;
    const img = this.image(iid);
    const lutId = 'lut_id' in wd ? wd.lut_id : desc.state_lut[wd.state];
    const lut = lutId !== null ? this.lut_bytes(lutId, layer, img) : null;
    const hAl = desc.h8 & 0x30000, vAl = desc.h8 & 0xC0000;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const x = hAl === 0 ? x0 : hAl === 0x10000 ? x0 + FT.div0(w - img.w, 2) : hAl === 0x20000 ? x1 + 1 - img.w : null;
    const y = vAl === 0 ? y0 : vAl === 0x40000 ? y0 + FT.div0(h - img.h, 2) : vAl === 0x80000 ? y1 + 1 - img.h : null;
    if (x === null || y === null) throw new ValueError(`child ${child}: alignment flags 0x${desc.h8.toString(16)}`);
    const clip = [Math.max(x0, 0), Math.max(y0, 0), Math.min(x1, this.W - 1), Math.min(y1, this.H - 1)];
    return [this.element(layer, 'image', child, { image: iid, data: img.data, w: img.w, h: img.h, x, y, lut, lut_id: lutId, clip, pixels: img.pixels })];
  }
  // ---- glyphs
  // BITMAPs of a text element: refs/font.mjs layout with step-7 alignment, mode 0, line height = size 62.
  glyphs(e) {
    const d = e.data;
    const [x0, y0, x1, y1] = d.box;
    if (d.margins.some((m) => m)) throw new ValueError('margins are 0 on every menu widget');
    const icon = (code) => this.icon(code);
    const [y, pens] = FT.align_box(this.font, icon, d.text, [x0, y0, x1, y1], d.align, this.size, 0);
    const clipRight = Math.min(x1, this.W - 1);
    const items = FT.layout(this.font, icon, d.text, pens.length ? pens[0] : x0, y, this.size, 0, this.size, { max_lines: pens.length, clip_right: clipRight, line_x: pens });
    for (const it of items) if (it.kind === 'icon') it.pixels = F.decode_bitmap(this.blob0.subarray(it.header - this.load0))[3];
    return items;
  }
}
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const infoRepr = (i) => `{${Object.entries(i).map(([k, v]) => `'${k}': ${v}`).join(', ')}}`;

// Three 1664 x 1200 GUI-layer buffers drawn with the engine model's key rule (U1 mode refuse / skip / write).
export class Raster {
  constructor(ref, mode) {
    this.ref = ref; this.mode = mode;
    this.layers = new Map([0, 1, 2].map((n) => [n, new Uint8Array(STRIDE * ROWS)]));
    this.refused = []; this.hits = 0; this.kind3 = [];
  }
  fill(e) {
    const d = e.data, buf = this.layers.get(e.layer);
    for (let y = d.y; y < d.y + d.h; y++) buf.fill(d.colour, y * STRIDE + d.x, y * STRIDE + d.x + d.w);
  }
  blit(layer, x, y, w, h, pixels, table, clip, label) {
    const buf = this.layers.get(layer);
    const wa = [], wi = [], wv = [];
    for (let r = 0; r < h; r++) {
      const Y = y + r;
      if (!(clip[1] <= Y && Y <= clip[3])) continue;
      for (let c = 0; c < w; c++) {
        const X = x + c;
        if (clip[0] <= X && X <= clip[2]) {
          const i = pixels[r * w + c];
          wa.push(Y * STRIDE + X); wi.push(i); wv.push(table !== null ? table[i] : i);
        }
      }
    }
    const partial = wa.length !== w * h;
    let key = false;
    for (let k = 0; k < wa.length; k++) if ((wi[k] === 0 || wv[k] === 0) && buf[wa[k]] !== wv[k]) { key = true; break; }
    if (key) this.hits += 1;
    if (this.mode === 'refuse') {
      if (partial) this.kind3.push(label);
      if (key && !partial) { this.refused.push(label); return; }
      if (key && partial) return;
    }
    for (let k = 0; k < wa.length; k++) {
      if (this.mode === 'skip' && (wi[k] === 0 || wv[k] === 0)) continue;
      buf[wa[k]] = wv[k];
    }
  }
  run(elements) {
    for (const e of elements) {
      if (e.kind === 'fill') this.fill(e);
      else if (e.kind === 'image') {
        const d = e.data;
        this.blit(e.layer, d.x, d.y, d.w, d.h, d.pixels, d.lut, d.clip, ['image', e.child]);
      } else if (e.kind === 'text') {
        const lut = FT.text_lut(e.data.colour, e.data.edge);
        const box = e.data.box;
        const clip = [Math.max(box[0], 0), Math.max(box[1], 0), Math.min(box[2], this.ref.W - 1), Math.min(box[3], this.ref.H - 1)];
        this.ref.glyphs(e).forEach((it, n) => {
          const cell = [it.pen, it.line_y, it.pen + it.step - 1, it.line_y + this.ref.size - 1];
          const full = clip[0] <= cell[0] && clip[1] <= cell[1] && cell[2] <= clip[2] && cell[3] <= clip[3];
          const window = full ? [0, 0, STRIDE - 1, ROWS - 1] : [Math.max(cell[0], clip[0]), Math.max(cell[1], clip[1]), Math.min(cell[2], clip[2]), Math.min(cell[3], clip[3])];
          this.blit(e.layer, it.x, it.y, it.width, it.height, it.pixels, lut, window, ['text', e.child, n]);
        });
      }
    }
    return this;
  }
  // The layout's panel area of a layer (W x H bytes, row by row).
  window(layer) {
    const buf = this.layers.get(layer), W = this.ref.W, H = this.ref.H;
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) out.set(buf.subarray(y * STRIDE, y * STRIDE + W), y * W);
    return out;
  }
}

// ---- navigation (M6)
export const NAV_RULES = {
  updown: ['X', 'DOWN/UP: row +1/-1 modulo the rows of the page (rows = min(labels, 7)); both wraps observed'],
  page: ['X', 'RIGHT and MAIN+ (counter +8): next page; at the last page the next tab (modulo 8) page 1. LEFT and MAIN- (counter +10): previous page; at page 1 the previous tab (modulo 8), its last page. Both tab wraps (8 -> 1, 1 -> 8) observed'],
  tab: ['X', 'SUB- (counter +10): tab index + 1 modulo 8; SUB+ (counter +8): tab index - 1 modulo 8; page 1'],
  entry_cursor: ['X', "OPEN enters its page with row = the page's cursor memory (tab table +8 list) - 1; a page entered inside the menu (RIGHT, LEFT, MAIN, SUB) gets row 0 whatever its memory or an earlier cursor position on it (memories change only on MENU)"],
  open: ['X', 'OPEN (0x87): tab = 1881, page = 1882, row from memory; writes 1446..1449 = 3200 (d1 0)'],
  close: ['X', "MENU on a page: closed (0x0104); writes, d1 0, only the memories that differ from the store: 1881 = tab id, 1882 = page (on My Menu the GUI's internal page, see mymenu), the page's cursor memory = row + 1 (order not predicted); on My Menu (no rows) the internal page's memory = 2 (1920 for page 1, 1924 for page 5), meaning unknown (variable 226 has no cursor slot there)"],
  ok: ['X', 'OK on a row opens its sub-screen: a separate panel (Card Formatting: 386) or a value popup (variable 226 f = 2); which one per row is pinned in the notes, not predicted'],
  unselectable: ['X', 'OK on a row with s != 0 shows "This item cannot be selected for the following reason." with a per-row reason (page 1 row 2: Camera Settings or Status; page 4 row 1: Initial Setting not performed); variable 226 does not change, so the reference refuses OK there'],
  back: ['X', 'MENU in a sub-screen or an unconfirmed popup: back to the page, same row'],
  help: ['X', "INFO on a page shows the cursor row's help (variable 226 +2421 = 1); INFO or DOWN closes it with the row unchanged"],
  noop: ['X', 'key OFF messages and INFO OFF change nothing'],
  mymenu: ['X', "tab index 7 (My Menu, id 8) shows 1 page with no rows with the default store (variable 226 +129 = 1, cursor slot none), although its tab entry lists 5 pages. The GUI keeps an internal page that MENU writes to 1882: 1 when entered with SUB+1/SUB-1 (RIGHT/MAIN+1 from Setup page 6 is not observed; the page rule predicts 1), the tab entry's last page (5) when entered with LEFT/MAIN-1 from tab 1 page 1; OPEN with 1882 = 1 or 5 shows the same 1/1 page and keeps it. RIGHT/MAIN+1 and LEFT/MAIN-1 leave the tab from either internal page. Whether the shown page count follows My Menu content (empty by default) is undecided; 1882 = 2..4 is not observed. UP/DOWN, OK and INFO there are not observed and refused (they presuppose a cursor row)"],
  popup_ok: ['X', "OK in a value popup writes the popup's item through vt+4 (d1 0, also when unchanged), then the GUI awaits EVT_10MS_WIZARD_MENU (0x9ac6) from Genifa timer 522 and defers every event: not predicted beyond the write (B7; with lab time see popup_confirm)"],
  popup_confirm: ['X', 'with lab time (M9, check_nav N3T): when Genifa timer 522 posts EVT_10MS_WIZARD_MENU (0x9ac6) the popup closes: back to the page, same row, no further write (token B7)'],
};
export const MYMENU_TAB = 7, MYMENU_CLOSE_MEMORY = 2;

// a token the reference refuses to predict (a ValueError)
export class NavRefusal extends ValueError {}
const refuse = (m) => new NavRefusal(m);

// Predicted menu state per script token. store: a mapping with get(id) (defaults + inputs); writes go to an overlay.
//   new Nav(store, { image, M })
export class Nav {
  constructor(store, { image, M }) {
    this.img = new M.Image(image);
    this.tabs = M.tabs(this.img);
    this.groups = M.groups(this.img);
    this.store = store;
    this.overlay = new Map();
    this.screen = 'closed'; this.tab = null; this.page = null; this.row = null;
  }
  get(sid) { return this.overlay.has(sid) ? this.overlay.get(sid) : this.store.get(sid); }
  rows(tab = null, page = null) {
    const t = this.tabs.at(tab === null ? this.tab : tab);
    const g = this.groups.get(t.pages.at((page === null ? this.page : page) - 1));
    return g && 'labels' in g ? Math.min(g.labels.length, 7) : 0;
  }
  pages(tab) { return tab === MYMENU_TAB ? 1 : this.tabs.at(tab).pages.length; }
  last_page(tab) { return this.tabs.at(tab).pages.length; }
  shown_page() { return this.tab === MYMENU_TAB ? 1 : this.page; }
  memory_id() { return this.tabs.at(this.tab).aux.at(this.page - 1); }
  // NAV_RULES entry_cursor: the cursor memory only on OPEN (memory=true), row 0 otherwise.
  enter(tab, page, memory = false) {
    this.tab = tab; this.page = page;
    const rows = this.rows();
    if (rows === 0) { this.row = null; return; }
    if (!memory) { this.row = 0; return; }
    const mem = this.get(this.memory_id());
    if (!Number.isInteger(mem) || !(mem >= 1 && mem <= rows)) throw refuse(`cursor memory ${this.memory_id()} = ${mem ?? null} outside 1..${rows}: not modelled`);
    this.row = mem - 1;
  }
  state(writes = []) {
    const t = this.tab !== null ? this.tabs.at(this.tab) : null;
    return { screen: this.screen, tab_index: this.tab, tab_id: t && t.id, page: this.page !== null ? this.shown_page() : null, gui_page: this.page, row: this.row, writes: [...writes] };
  }
  // Apply one nav script token; returns the predicted state with the vt+4 writes [[id, value]].
  predict(token) {
    const c = token.indexOf(':');
    const name = c < 0 ? token : token.slice(0, c);
    const kind = (c < 0 ? '' : token.slice(c + 1)) || 'click';
    let writes = [];
    if (name === 'OPEN') {
      if (this.screen !== 'closed') throw refuse('OPEN with the menu open: not observed');
      const tabId = this.get(1881);
      const tab = this.tabs.findIndex((t) => t.id === tabId);
      if (tab < 0) throw refuse(`1881 = ${tabId}: no tab entry has this id`);
      const p = this.get(1882);
      const ok = tab === MYMENU_TAB ? [1, this.last_page(tab)].includes(p) : Number.isInteger(p) && p >= 1 && p <= this.pages(tab);
      if (!ok) throw refuse(`1881/1882 = ${tabId}/${this.get(1882)}: no such tab/page (My Menu: 1 or ${this.last_page(MYMENU_TAB)} observed)`);
      this.screen = 'page';
      this.enter(tab, this.get(1882), true);               // 1882 is read again here
      writes = [[1446, 3200], [1447, 3200], [1448, 3200], [1449, 3200]];
      return this.state(writes);
    }
    if (kind === 'off' || (name === 'INFO' && kind === 'off')) return this.state();
    if (kind !== 'click' && kind !== 'on') throw refuse(`${token}: kind ${kind} not observed`);
    if (this.screen === 'closed') throw refuse(`${token} with the menu closed: not observed`);
    if (this.screen === 'help') {
      if (name === 'INFO' || name === 'DOWN') { this.screen = 'page'; return this.state(); }
      throw refuse(`${token} while the help is shown: not observed`);
    }
    if (name === 'B7') {
      if (this.screen !== 'popup') throw refuse(`B7 (EVT_10MS_WIZARD_MENU) on screen ${this.screen}: not observed`);
      this.screen = 'page';
      return this.state();
    }
    if (this.screen === 'sub' || this.screen === 'popup') {
      if (name === 'MENU') { this.screen = 'page'; return this.state(); }
      throw refuse(`${token} in a ${this.screen}: not predicted (pinned per script)`);
    }
    let n = this.pages(this.tab);
    if (this.tab === MYMENU_TAB && ['RIGHT', 'MAIN+1', 'LEFT', 'MAIN-1'].includes(name)) { n = 1; this.page = 1; }
    const mod = (a, m) => ((a % m) + m) % m;
    if (name === 'DOWN' || name === 'UP') {
      if (this.row === null) throw refuse(`${token} on a page without rows: not observed`);
      this.row = mod(this.row + (name === 'DOWN' ? 1 : -1), this.rows());
    } else if (name === 'RIGHT' || name === 'MAIN+1') {
      if (this.page < n) this.enter(this.tab, this.page + 1); else this.enter(mod(this.tab + 1, 8), 1);
    } else if (name === 'LEFT' || name === 'MAIN-1') {
      if (this.page > 1) this.enter(this.tab, this.page - 1);
      else { const prev = mod(this.tab - 1, 8); this.enter(prev, this.last_page(prev)); }
    } else if (name === 'SUB-1' || name === 'SUB+1') {
      this.enter(mod(this.tab + (name === 'SUB-1' ? 1 : -1), 8), 1);
    } else if (name === 'MENU') {
      const want = [[1881, this.tabs.at(this.tab).id], [1882, this.page]];
      if (this.row !== null) want.push([this.memory_id(), this.row + 1]);
      else if (this.tab === MYMENU_TAB) want.push([this.memory_id(), MYMENU_CLOSE_MEMORY]);
      else throw refuse(`MENU on tab index ${this.tab} page ${this.page} without rows: not observed`);
      writes = want.filter(([sid, v]) => this.get(sid) !== v);
      for (const [sid, v] of writes) this.overlay.set(sid, v);
      this.screen = 'closed'; this.tab = null; this.page = null; this.row = null;
    } else if ((name === 'OK' || name === 'INFO') && this.row === null) {
      throw refuse(`${token} on a page without rows: not observed`);
    } else if (name === 'OK') {
      if (this.tabs.at(this.tab).id === SETUP_TAB_ID && (ROW_STATE_DEFAULTS.get(this.page) ?? new Set()).has(this.row)) {
        throw refuse(`OK on page ${this.page} row ${this.row} (s != 0): the firmware shows "This item cannot be selected" (X, NAV_RULES unselectable), which the nav reference does not classify`);
      }
      this.screen = 'ok';
    } else if (name === 'INFO') {
      this.screen = 'help';
    } else throw refuse(`${token}: no rule`);
    return this.state(writes);
  }
}
