// Localized GUI text through the firmware's own text path (GuiMixin's bring-up,
// the stubs S-SET, S-RES and S-LOG, the language load and switch, gcs, strings, the layer helpers and DrawText /
// DrawTextById in an exec bracket; TextLab over OsdLab and TextDisplayLab over DisplayLab; demo_blocks, demo_session).
// GuiMixin is a class mixin (GuiMixin(Base)) over OsdLab / DisplayLab. The
// resource block is env.resBlock.
import { A, IMAGE_BASE, fact } from '../fw/model.mjs';
import * as R from './resources.mjs';
import * as D from './display.mjs';
import { FirmwareError, runtime, where } from './hle.mjs';
import { EXPECTED_RECORDS, KIND3_RECORD, KIND3_AREA, STRIDE, HEIGHT, REGISTRY, OsdLab, OSD_DEFAULTS, EngineError, format_error } from './osd.mjs';
import { ValueError } from './errors.mjs';
import { decode_command } from './osdfmt.mjs';
import { SP } from './sim.mjs';
import { show } from '../util/show.mjs';
import { deepEqual } from '../util/equal.mjs';
import { pack, unpack, bytesHex } from '../util/bytes.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

export const POOL_INIT = A(0x510BAD63), POOL_TABLE = A(0x613292D0), LANG_LOADER = A(0x51257BFB), GENIFA_INIT = A(0x510B93DA);
export const SETTINGS_READ = A(0x50B7B618), SETTINGS_READ_RA = A(0x50B4E88A);
export const RES_GET = A(0x50B4ECF3), RES_GET_CALLERS = [A(0x51257C5A), A(0x51257CBA), A(0x51257D3D)];
export const GC_CREATE = A(0x510B998E), GC_SET_DEVICE = A(0x510BA02C), GC_SET_BACKGROUND = A(0x510B9B39), GC_SET_FONT_BY_ID = A(0x510B9F70);
export const GET_STRING = A(0x510BB079), DRAW_TEXT_BY_ID = A(0x510AE820), DRAW_TEXT = A(0x510AB0F9), GPIFONT_LOG = A(0x5124B173);
export const API_VTABLE = A(0x60E38124), CUR_FONT = A(0x62B3E36C), STRING_LIST = A(0x60370858), FONT_LIST = A(0x603708A4);
export const ICON_TABLE = A(0x62B3E364), ICON_AUX = A(0x60370AF8), DEVICES = A(0x62B3DC94), GPI_TEXT_CALLBACK = A(0x510BC7D8);
export const GUI_BUFFER_TABLES = [A(0x62B3DFDC), A(0x62B3DFE4), A(0x62B3DFEC)], OFFSCREEN_RECORD = A(0x62B3DFF4);
export const FONT_ENABLE = A(0x603657C5), STRING_BANK = A(0x603671C4), FRONT_BACK = A(0x603672F0), DRAW_OFFSET = A(0x6036731C);
// LANG_SETTING: the language's store id, the one the language loader LANG_LOADER reads (E143 3009, D; another model's
// read from its loader, src/fw/facts.mjs langSetting: E147 renumbered it 3011)
export const ATTR_TABLE = A(0x62B3E3BC), LANG_SETTING = fact('text.lang_setting', 3009), SENTINEL = 0xC0000000, KIND3_BASE = A(0xB6ECC800);

// H-STACK: DrawText 0x510ab0f9 never initialises its iterator's skip count; the harness hands each DrawText call a
// zeroed stack window of STACK_CLEAR bytes below SP (check_text's no-h-stack mutant sets it to 0: setStackClear).
export let STACK_CLEAR = 0x1000;
export function setStackClear(n) { STACK_CLEAR = n; }
export const DEFAULT_COLOUR = 10, DEFAULT_EDGE = 7, TEXT_LAYER = 1, PANEL_LAYER = 0, PANEL_COLOUR = 35;
export const DEMO = [['en', [1020, 4414, 2872]], ['ja', [1020, 4414, 2872]], ['zh-CN', [1020, 4414, 2872]]];
export const STAND_INS = {
  'S-SET': 'settings read 0x50b7b618 returns the language setting-3009 value (experiment input)',
  'S-RES': 'resource get 0x50b4ecf3 copies the raw record to its link slot and returns it',
  'S-LOG': 'gpifont log 0x5124b173 recorded and returned (log level 0 in the image: no output)',
  'H-GC': 'gc id 0 and background -1 passed to the native gc setters',
  'H-STYLE': 'DrawText style: colour, edge, no margins, left/top alignment',
  'H-CLEAR': 'harness zeroes the text layer (LUT value 0 transparency unknown; osddraw refuses colour 0)',
  'H-SWITCH': '0x51257bfb(1), then GcSetFontById on every gc',
  'H-STACK': 'zeroed stack window before each DrawText call (iterator skip count +24 uninitialised)',
  bracket: 'exec_start/exec_end around each drawing call',
  colours: 'text 10, edge 7 in palette 63',
};
const h8 = (v) => '0x' + fx(v >>> 0, 8);
// UTF-16-LE of a str plus the NUL unit
export function utf16(text) {
  const units = [];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  units.push(0);
  return pack(`<${units.length}H`, ...units);
}
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const latin1 = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };

// The engine execution log as entries: [{seq, source, result, command}] (the raw
// rows EngineDebug keeps, decoded with osdfmt.mjs decode_command).
export function execEntries(engine, decode) {
  return engine.exec_log().map((r) => ({ seq: r[0], source: r[1], result: r[3], command: decode(r.slice(4, 4 + r[2])) }));
}

export const GuiMixin = (Base) => class extends Base {
  preinit(opts) {
    this.block = this.env.resBlock;
    if (!this.block) throw new Error('GuiMixin: env.resBlock (the resource block blk02000000.OE.0101.bin) is required');
    this.langs = new Map(R.languages(this.image, this.block).map((e) => [e.lang, e]));
    const lang = opts.lang ?? 'en';
    if (!this.langs.has(lang)) throw new ValueError(`language ${show(lang)}: one of ${show([...this.langs.keys()].sort())}`);
    this.lang = lang;
    this.setting = this.langs.get(lang).setting;
    this.loaded = [];
    this.setting_reads = [];
    this.gcs = [];
    this.init_prints = [];
    this.font_log = [];
    super.preinit(opts);
  }
  // S-SET: the settings-store read behind vtable +12 (0x50b4e86d)
  _s_set(hle, r) {
    if (r.mdr !== runtime(SETTINGS_READ_RA)) throw new FirmwareError(`S-SET ${h8(SETTINGS_READ)} reached from ${where(r.mdr)}`);
    if ((r.d0 & 0xFFFF) !== LANG_SETTING) throw new FirmwareError(`S-SET: setting ${r.d0 & 0xFFFF} requested; only ${LANG_SETTING} is modelled`);
    this.setting_reads.push(r.d0 & 0xFFFF);
    hle.finish(r, { d0: this.setting });
  }
  // S-RES: resource get, vtable +56 (d0 = record, d1 = kind): the raw record goes to the slot its firmware handler uses.
  _s_res(hle, r) {
    if (!RES_GET_CALLERS.map(runtime).includes(r.mdr)) throw new FirmwareError(`S-RES reached from ${where(r.mdr)}`);
    const record = r.d0 & 0xFFFF, kind = r.d1 & 0xFFFF;
    const entry = this.langs.get(this.lang);
    const { fonts, strings, images } = R.layout(this.block);
    let address, limit;
    if (kind === 0 && record >= fonts[0] && record <= fonts[1]) [address, limit] = R.FONT_SLOT;
    else if (kind === 2 && record >= strings[0] && record <= strings[1]) [address, limit] = R.STRING_SLOT;
    else if (kind === 1 && record === images[0]) {
      [address, limit] = [R.BLOB_LOADS[0], null];
      if (R.overlap(this.block)) R.rewrite(this.sim, this.block, 0);   // the icons record as loaded now (R.overlap)
    }
    else throw new FirmwareError(`S-RES: (record ${record}, kind ${kind}) not modelled`);
    if (kind === 0 || kind === 2) {
      const want = kind === 0 ? entry.font_record : entry.strings_record;
      if (record !== want) throw new FirmwareError(`S-RES: record ${record} kind ${kind}, language ${this.lang} uses ${want}`);
      const data = R.raw_record(record, this.block);
      if (!(data.length > 0 && data.length <= limit)) throw new FirmwareError(`S-RES: record ${record} size 0x${data.length.toString(16)} > slot 0x${limit.toString(16)}`);
      if (kind === 2) {
        const table = new R.StringTable(record, data);
        if (table.lang !== this.lang) throw new FirmwareError(`S-RES: string record ${record} is ${table.lang}, not ${this.lang}`);
      }
      this.sim.write(((address & 0x3FFFFFFF) | 0x40000000) >>> 0, data);
    }
    this.loaded.push([record, kind]);
    hle.finish_calls(r, { d0: address });
  }
  // S-LOG (observer): records (file, line) and returns.
  _s_log(hle, r) {
    const call = this.sim.read(r.mdr - 7, 7);
    const size = call[0] === 0xDD ? call[6] : this.sim.read(r.mdr - 5, 5)[4];
    const args = unpack('<3I', this.sim.read(r.sp + size + 4, 12));
    const raw = this.sim.read(args[1], 32), z = raw.indexOf(0);
    this.font_log.push([latin1(z < 0 ? raw : raw.subarray(0, z)), args[2], where(r.mdr)]);
    hle.finish(r);
  }
  // ---- bring-up (GuiMixin.native_init: what the GUI startup 0x510c2830 does)
  native_init() {
    const marks = [['memory-manager constructors', this.kernel.events.length]];
    R.load(this.sim, this.block);                                    // the image records (icons, bitmaps)
    const off = POOL_TABLE - IMAGE_BASE;
    const table = this.alloc(this.image.slice(off, off + 18 * 16), 4);
    let r = this.call(POOL_INIT, { d0: 18, a0: table });
    if ((r.d0 & 0xFFFF) !== 18) throw new FirmwareError(`Genifa pools ${h8(POOL_INIT)} returned ${r.d0}`);
    marks.push(['Genifa pools 0x510bad63', this.kernel.events.length]);
    this.hook(SETTINGS_READ, (h, rr) => this._s_set(h, rr), 'S-SET');
    this.hook(RES_GET, (h, rr) => this._s_res(h, rr), 'S-RES');
    this.hook(GPIFONT_LOG, (h, rr) => this._s_log(h, rr), 'S-LOG');
    this.load_language(0);
    this.init_loaded = [...this.loaded];
    marks.push(['getLanguageLoadResource(0) 0x51257bfb', this.kernel.events.length]);
    [...EXPECTED_RECORDS.map(([b]) => [b, HEIGHT]), KIND3_AREA].forEach(([base, height], slot) => this.engine.set_guard(slot, base, STRIDE, height));
    r = this.call(GENIFA_INIT, null, null, null, 20000);
    if (!(r.d0 & 0xFFFF)) throw new FirmwareError('Genifa init 0x510b93da returned 0');
    marks.push(['Genifa init 0x510b93da', this.kernel.events.length]);
    let start = 0;
    for (const [step, end] of marks) {
      for (const e of this.kernel.events.slice(start, end)) if (e[0] === 'print') this.init_prints.push([step, e[1], e[2]]);
      start = end;
    }
    this.records = [];
    for (let i = 0; i < 6; i++) this.records.push(this.sim.u32(REGISTRY + 8 * i));
    this.records.push(KIND3_RECORD);
    this.surfaces = [];
    for (let i = 0; i < 7; i++) this.surfaces.push(this.record(i));
    this.init_log = this.engine.exec_log().map((row) => ({ seq: row[0], source: row[1], result: row[3], command: decode_command(row.slice(4, 4 + row[2])) }));
    this.init_commands = this.engine.exec_total();
    this.init_errors = this.engine.errors();
    let problems = this.check_init();
    if (this.init_errors.length || this.kernel.errors.length) {
      problems = [...problems, ...this.init_errors.map(format_error), ...this.kernel.errors.map(([code, , , caller]) => `error log ${h8(code)} from ${caller}`)];
    }
    if (problems.length) throw new EngineError('GUI bring-up: ' + problems.join('; '));
    this.engine.clear();
    this.errlog_seen = this.kernel.errors.length;
    this.isr_runs = 0;
  }
  load_language(mode) {
    const r = this.call(LANG_LOADER, { d0: mode, a0: SENTINEL });
    if ((r.d0 & 0xFFFF) !== 1) throw new FirmwareError(`getLanguageLoadResource(${mode}) ${h8(LANG_LOADER)} returned ${r.d0}`);
  }
  // Post-init assertions (each a string naming what differs).
  check_init() {
    const out = [];
    const got = this.surfaces.map((s) => [s.base, s.stride, s.height]);
    const want = [...EXPECTED_RECORDS.map(([b]) => [b, STRIDE, HEIGHT]), [KIND3_AREA[0], STRIDE, KIND3_AREA[1]]];
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`registry ${show(got)} != guarded ${show(want)}`);
    const recs = this.records;
    const tables = GUI_BUFFER_TABLES.map((t) => unpack('<II', this.sim.read(t, 8)));
    const wantT = [[recs[2], recs[3]], [recs[4], recs[5]], [recs[0], recs[1]]];
    if (JSON.stringify(tables) !== JSON.stringify(wantT)) out.push(`GUI buffer tables ${show(tables.map((t) => t.map((a) => '0x' + a.toString(16))))}`);
    if (this.sim.u32(OFFSCREEN_RECORD) !== KIND3_RECORD) out.push(`offscreen record ${h8(this.sim.u32(OFFSCREEN_RECORD))}`);
    for (let n = 0; n < 3; n++) {
      const dev = DEVICES + 168 * n;
      if (this.sim.u32(dev + 108) !== runtime(GPI_TEXT_CALLBACK)) out.push(`device ${n} +108 = ${h8(this.sim.u32(dev + 108))}`);
    }
    const sr = R.raw_record(this.langs.get(this.lang).strings_record, this.block);
    const s0 = u32(sr, 0), s1 = u32(sr, 4);
    const blob0 = R.blobs(this.block)[0][1];
    const icon0 = u32(blob0, 0), icon1 = u32(blob0, 4);
    for (const [name, address, value] of [['font', CUR_FONT, R.FONT_SLOT[0]], ['pStringsList', STRING_LIST, s0],
      ['pFontsList', FONT_LIST, s1], ['icon table', ICON_TABLE, icon0], ['icon word 1', ICON_AUX, icon1]]) {
      if (this.sim.u32(address) !== value) out.push(`${name} (${h8(address)}) = ${h8(this.sim.u32(address))}, expected ${h8(value)}`);
    }
    for (const [name, address, size] of [['font primitive byte', FONT_ENABLE, 1], ['string bank', STRING_BANK, 1],
      ['front/back byte', FRONT_BACK, 1], ['draw offset', DRAW_OFFSET, 4]]) {
      const b = this.sim.read(address, size);
      if (b.some((x) => x)) out.push(`${name} (${h8(address)}) = ${bytesHex(b)}`);
    }
    const entry = this.langs.get(this.lang);
    const wantLoaded = [[entry.font_record, 0], [entry.strings_record, 2], [R.layout(this.block).images[0], 1]];
    if (JSON.stringify(this.init_loaded) !== JSON.stringify(wantLoaded)) out.push(`resource calls ${show(this.init_loaded)}`);
    if (this.sim.u32(A(0x603613B0)) === 0 || this.sim.u32(this.sim.u32(A(0x603613B0))) !== API_VTABLE) {
      out.push('resource/settings API object (0x603613b0) has no vtable 0x60e38124');
    }
    const kinds = new Map();
    for (const e of this.init_log) kinds.set(e.command.name, (kinds.get(e.command.name) ?? 0) + 1);
    if (!(kinds.size === 1 && kinds.has('FILL')) || this.init_commands !== this.init_log.length) {
      out.push(`engine during init: ${show(Object.fromEntries(kinds))} of ${this.init_commands}`);
    }
    return out;
  }
  // The gc the font attributes of gc's font handle point to (attribute +12 of (0x62b3e3bc) + 24 * handle index).
  attr_gc(gc) {
    const b = this.sim.read(this.sim.u32(gc + 76), 2), index = b[0] | b[1] << 8;
    return this.sim.u32(this.sim.u32(ATTR_TABLE) + 24 * index + 12);
  }
  // ---- language: H-SWITCH, native 0x51257bfb(1) with the new setting value, then GcSetFontById again on every gc
  set_language(lang) {
    if (!this.langs.has(lang)) throw new ValueError(`language ${show(lang)}`);
    this.lang = lang; this.setting = this.langs.get(lang).setting;
    const before = this.loaded.length;
    this.load_language(1);
    const entry = this.langs.get(lang), calls = this.loaded.slice(before);
    if (!deepEqual(calls, [[entry.font_record, 0], [entry.strings_record, 2]])) throw new FirmwareError(`language switch to ${lang}: resource calls ${show(calls)}`);
    for (const [gc, fontId] of this.gcs) this.call(GC_SET_FONT_BY_ID, { a0: gc, d0: fontId });
    return calls;
  }
  // ---- gc and strings: GcCreate, set device (GUI layer), background none (H-GC values), GcSetFontById
  make_gc(layer = TEXT_LAYER, font_id = 1) {
    const gc = this.call(GC_CREATE, { d0: 0, d1: 0, a0: 0 }).a0 >>> 0;
    if (!gc) throw new FirmwareError('GcCreate returned 0');
    if (!(this.call(GC_SET_DEVICE, { a0: gc, d0: layer, a1: 0 }).d0 & 0xFFFF)) throw new FirmwareError(`gc set device ${layer} returned 0`);
    this.call(GC_SET_BACKGROUND, { a0: gc, d0: 0xFFFFFFFF });
    this.call(GC_SET_FONT_BY_ID, { a0: gc, d0: font_id });
    if (this.sim.u32(gc + 72) !== DEVICES + 168 * layer || !this.sim.u32(gc + 76)) {
      throw new FirmwareError(`gc ${h8(gc)}: device ${h8(this.sim.u32(gc + 72))}, font handle ${h8(this.sim.u32(gc + 76))}`);
    }
    this.gcs.push([gc, font_id]);
    return gc;
  }
  // Descriptor +66 of pFontsList[font_id] (getFont 0x510bafcb); 62 for every language.
  font_size(font_id = 1) { return this.sim.read(this.sim.u32(FONT_LIST) + 74 * font_id + 66, 1)[0]; }
  // Native GetString; returns [address, text read back from guest RAM].
  get_string(sid) {
    const address = this.call(GET_STRING, { d0: sid }).a0 >>> 0;
    return [address, this.read_utf16(address)];
  }
  // The record the text callback draws into: *(0x62b3dfdc + 8 * layer + 4 * byte 0x603672f0).
  front_record(layer) {
    const index = this.sim.read(FRONT_BACK, 1)[0];
    return this.sim.u32(GUI_BUFFER_TABLES[0] + 8 * layer + 4 * index);
  }
  buffer_of(layer) {
    const i = this.records.indexOf(this.front_record(layer));
    if (i < 0) throw new ValueError(`${this.front_record(layer)} is not in list`);
    return i;
  }
  // H-CLEAR: the harness writes zeros (debugger write) into rect (x, y, w, h) of the layer's front record.
  clear_layer(layer = TEXT_LAYER, rect = [0, 0, 1664, 1200]) {
    const s = this.surfaces[this.buffer_of(layer)], [x, y, w, h] = rect;
    if (x < 0 || y < 0 || x + w > s.stride || y + h > s.height) throw new ValueError(`clear rect ${show(rect)} outside the record`);
    if (w === s.stride) this.sim.write(s.base + y * s.stride, new Uint8Array(w * h));
    else for (let row = y; row < y + h; row++) this.sim.write(s.base + row * s.stride + x, new Uint8Array(w));
  }
  // One DrawTextById (sid) or DrawText (literal text) call in its own exec bracket; box (x0, y0, x1, y1) inclusive,
  // default (x, y, 1599, 1199). H-STYLE: {+0 colour, +4 0, +8 0, +12 h-align, +13 v-align, +14..+21 margins 0, +22 edge}.
  // The result's commands are the engine's raw execution rows (osd.mjs EngineDebug.exec_log).
  draw_text(gc, x, y, { sid = null, text = null, colour = DEFAULT_COLOUR, edge = DEFAULT_EDGE, box = null, align = [0, 0], expect = [], errlog = 0 } = {}) {
    if ((sid === null) === (text === null)) throw new ValueError('give sid or text');
    box = box ?? [x, y, 1599, 1199];
    const style = this.alloc(cat2(pack('<IIIBBHHHHB', colour, 0, 0, align[0], align[1], 0, 0, 0, 0, edge), new Uint8Array(9)), 4);
    const rect = this.alloc(pack('<hhhh', ...box), 4);
    let address, string, regs, fn;
    if (sid !== null) {
      [address, string] = this.get_string(sid);
      regs = { a0: gc, d0: sid, d1: style, a1: rect }; fn = DRAW_TEXT_BY_ID;
    } else {
      address = this.alloc(utf16(text), 4);
      string = text;
      regs = { a0: gc, d0: style, d1: address, a1: rect }; fn = DRAW_TEXT;
    }
    this.prepare_bracket();
    const st = this.drawing_enter(expect, errlog);
    try {
      this.sim.write(SP - STACK_CLEAR, new Uint8Array(STACK_CLEAR));     // H-STACK
      this.call(fn, regs, null, null, 100000);
    } catch (e) { this.drawing_exit(st, e); }
    const frame = this.drawing_exit(st);
    const glyphs = frame.commands.filter((row) => decode_command(row.slice(4, 4 + row[2])).name === 'BITMAP').length;
    return { lang: this.lang, sid, text: string, address, x, y, box: [...box], colour, edge, attr_gc: this.attr_gc(gc),
      commands: frame.commands, frame, glyph_bitmaps: glyphs };
  }
  read_utf16(address, limit = 1024) {
    const data = this.sim.read(address, 2 * limit);
    for (let i = 0; i < data.length; i += 2) if (data[i] === 0 && data[i + 1] === 0) return R.utf16Text(data.subarray(0, i));
    throw new FirmwareError(`no NUL within ${limit} characters at ${h8(address)}`);
  }
  prepare_bracket() {}
};

const cat2 = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

// TextLab: GuiMixin over OsdLab. opts: lang, kernel (default OSD_DEFAULTS.kernel).
export class TextLab extends GuiMixin(OsdLab) {
  constructor(env, opts = {}) { super(env, 0, opts.kernel ?? OSD_DEFAULTS.kernel, opts); }
}

export class TextDisplayLab extends GuiMixin(D.DisplayLab) {
  // What DisplayLab.draw does before its bracket: pending VSC interrupts first; firmware error-log calls of earlier
  // display steps are not drawing errors.
  prepare_bracket() {
    this.kernel.deliver();
    this.errlog_seen = this.kernel.errors.length;
  }
  // [base of the record the text callback draws into, OSDn DMASADR << 4 of the latched bank]
  layer_matches_vsc(layer, device) {
    const c = D.DEVICE[device].channel, mirror = this.vsc.bank(c, true);
    const base = unpack('<I', this.sim.read(this.front_record(layer), 4))[0];
    const shown = (mirror.get(`OSD${layer + 1}DMASADR`) || 0) * 16;      // x 16, not << 4: unbounded, never wrapped at 2^32
    return [base, shown];
  }
}

// ---- demo
// One block of three 64-px lines per language at x = 24, y = 12 + 64 * line; H-SWITCH between blocks; a translucent
// panel behind each block on GUI layer 0.
export function demo_blocks(lab, gc, content, colour, edge) {
  const drawn = [];
  let line = 0;
  for (const [lang, items] of content) {
    if (lang !== lab.lang) lab.set_language(lang);
    const top = 12 + 64 * line;
    lab.prepare_bracket();
    const st = lab.drawing_enter();
    try { lab.rectangle(12, top - 4, 776, 64 * items.length + 8, PANEL_COLOUR, PANEL_LAYER, lab.buffer_of(PANEL_LAYER)); } catch (e) { lab.drawing_exit(st, e); }
    lab.drawing_exit(st);
    for (const it of items) {
      const kw = typeof it === 'number' ? { sid: it } : { text: it };
      drawn.push(lab.draw_text(gc, 24, 12 + 64 * line, { colour, edge, ...kw }));
      line += 1;
    }
  }
  return drawn;
}
// One fresh TextDisplayLab session: open device, palettes, H-CLEAR, the text blocks, update, IMG, composite. Returns
// [lab, drawn, composite]; the caller closes the lab.
export function demo_session(env, device, { content = DEMO, frame = null, aspect = null, colour = DEFAULT_COLOUR, edge = DEFAULT_EDGE } = {}) {
  const lab = new TextDisplayLab(env, { lang: content[0][0] });
  try {
    lab.check_img_region();
    lab.start();
    lab.open(device);
    lab.palettes();
    lab.clear_layer(TEXT_LAYER);
    lab.clear_layer(PANEL_LAYER);
    const gc = lab.make_gc(TEXT_LAYER);
    const drawn = demo_blocks(lab, gc, content, colour, edge);
    lab.update(`gpiUpdateDisplay(0) on ${device}`);
    if (frame !== null) {
      lab.load_img(frame);
      lab.attach_img(device, aspect);
    }
    return [lab, drawn, lab.compose(device)];
  } catch (e) {
    lab.close();
    throw e;
  }
}
