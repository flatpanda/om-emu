#!/usr/bin/env node
// The text checks: the M4 text path on the JS lab (src/lab/text.mjs: the firmware loads the language
// resources, looks strings up, lays out and draws every glyph) against refs/font.mjs, written from the font format
// alone and imported only after the first lab exists (the load-order assertion of group 1: a check-side flag, since
// the module is loaded with import() there). Pixels are decoded with refs/osdfmt.mjs; composites are compared with
// check_display's reference(). Groups 0..11 with their report lines; every pass/fail predicate (the exit code and the --mutants verdicts included) goes through
// checks/lib/pred.mjs. --mutants runs this file again under each MUTANTS entry (OM_TEXT_MUTANT) in a node child.
//   node emu/checks/check_text.mjs [--seed N] [--write-notes] [--mutants] [--kernel native|none]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FIXTURES, labEnv, loadImage, loadBlock, runMain, SystemExit } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { newRandom } from './lib/rngtape.mjs';
import { pred, fault } from './lib/pred.mjs';
import { isValueError, hasStack } from './lib/errors.mjs';
import * as CD from './check_display.mjs';
import * as fmt from '../refs/osdfmt.mjs';
import * as R from '../src/lab/resources.mjs';
import * as T from '../src/lab/text.mjs';
import * as D from '../src/lab/display.mjs';
import { OSD_DEFAULTS, EngineError } from '../src/lab/osd.mjs';
import { decode_command } from '../src/lab/osdfmt.mjs';
import { FirmwareError, LabError } from '../src/lab/errors.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show } from '../src/util/show.mjs';
import { unpackFrom } from '../src/util/bytes.mjs';

const NOTES_FILE = path.join(FIXTURES, 'check_text_notes.txt');
const FIXED_IDS = [0, 1, 737, 1020, 1117, 2872, 4404, 4414, 4701];
const IDS = [1020, 4414, 2872, 737, 147];
const LITERAL = 'AVATAR To We Ty 0123456789';
const EDGE_LINES = ['A\x1fB', 'AB\x1fCD', 'AV\x1fVAW', 'A\x1f\x1fBCD', '\x1fAB', 'T\x1f@A003@ok', 'A@0000@B', 'A@A00@@B',
  'X一\x1fYZ', 'A\x1f@A003@', '\x1f\x1fAB@A003@', 'AB\x1f\x1f@A003@@A004@', 'A\x1f\x1f\x1f\x1f\x1f\x1f@A003@B', 'A\u{1F600}B'];
const EDGE_MULTI = ['A\x1fB\r\nCD\x1fEF', 'Ok\x1f@A003@\r\nNext', 'A\x1f@A003@\r\nBC', 'A\x1f\x1f@A003@\r\nBCD',
  'A\x1f\x1f\x1f@A003@\r\nB\r\nCDE', 'A\x1f@A003@\r\n\x1f\x1fBC', 'A\x1f@A003@\r\n\x1fBC'];
const EDGE_MODE0 = ['A@a003@B', 'A@A003@B'];
const SCREEN_EDGE = [['Hello', [1580, 300, 1599, 1199]], ['Hello', [1480, 300, 1499, 1199]], ['Wi'.repeat(60), [24, 400, 1599, 1199]]];
const TWO_GC_TEXT = ['Wavy', LITERAL];
const CLIP_ICON = ['A@A003@\r\nCDEFGHIJ', 'AB\r\nCDEFGHIJ', [24, 12, 50, 1199]];
const LOW_ESCAPES = ['A@0041@B', 'A@0@00@B'];
const LANGS = ['en', 'ja', 'zh-CN'];
const STRIDE = 1664, ROWS = 1200;
const REJECT_LOG = ['gpifont.c', 1060];
const ERR = (code, msg) => `[RTOS]ServiceCallErr = ${code}  / Message = ${msg} / CPU 0 de Error Hassei !!\n`;
const INIT_PRINTS = [];
const KERNEL_NONE_INIT_PRINTS = [['getLanguageLoadResource(0) 0x51257bfb', 'puts2', ERR(-34, 'BMT_ACRMTX')],
  ['getLanguageLoadResource(0) 0x51257bfb', 'puts2', ERR(-25, 'BSE_ACRTSK')],
  ['getLanguageLoadResource(0) 0x51257bfb', 'puts2', ERR(-25, 'BMT_ACRMTX')],
  ['Genifa init 0x510b93da', 'puts2', ERR(-25, 'BMT_ACRMTX')]];
const KERNEL_NONE_NOTES = new Map([
  ...['tft', 'evf'].flatMap((d) => ['0014', '0028', '0040', '0044'].map((x) => [`${d} STUB_UNWRITTEN 0x9820${x}`, `${d} STUB_UNWRITTEN 0x9848${x}`])),
  ...['A@0041@B', 'A@0@00@B'].map((s) => [`low escape ${show(s)} (lab memory before the icon table, not asserted): BITMAPs ${show([['0xa4f65ec0', 24, 24], ['0xa4f6606c', 51, 24]])}`,
    `low escape ${show(s)} (lab memory before the icon table, not asserted): BITMAPs ${show([['0xa4f65ec0', 24, 24], ['0xa4f6606c', 55, 24]])}`])]);
const MUTANTS = new Map([
  ['sset-accepted', 'S-SET answers the requested language whatever lab.setting says (group 1 control)'],
  ['no-h-stack', 'H-STACK off: DrawText inherits a stale iterator skip count and skips characters'],
]);
const SET_CLIP = 0x510B9B6D;
const lineY = (i) => 12 + 64 * i;
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const sortStr = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const bytesEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const counter = () => new Map();
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
let ENV = null;
const env = () => (ENV ??= labEnv({ resBlock: loadBlock() }));
const withLab = (lab, fn) => { try { return fn(lab); } finally { lab.close(); } };
const newTextLab = (lang) => new T.TextLab(env(), { lang });
let FONT = null;                    // refs/font.mjs once group 1 imports it (the load-order flag)

// Predictions from the blobs (refs/font.mjs), built only after a lab exists.
class Reference {
  constructor(F, langs) {
    this.F = F;
    this.block = loadBlock();
    this.fonts = new Map();
    for (const e of langs.values()) if (e.lang !== 'th') this.fonts.set(e.lang, new F.Font(R.raw_record(e.font_record, this.block)));
    const [load, blob0] = R.blobs(this.block)[0];
    this.load0 = load; this.blob0 = blob0;
    this.icon_table = unpackFrom('<I', this.blob0, 0)[0];
  }
  mem(address, n) { return this.blob0.subarray(address - this.load0, address - this.load0 + n); }
  icon(code) {
    const entry = unpackFrom('<I', this.mem(this.icon_table + 4 * (code - 0xA000), 4), 0)[0];
    const [w, h, header, two] = unpackFrom('<HHII', this.mem(entry, 12), 0);
    if (two !== 2) throw new LabError(`icon entry 0x${entry.toString(16)}: word 2 is ${two}, not 2`);
    return [w, h, header];
  }
  icon_pixels(header) { return fmt.decode_bitmap(this.mem(header, 0x10000))[3]; }
  layout(lang, text, x, y, edge, size = 62, { vcenter_delta = 0, advance_delta = null, clip_right = null, max_lines = null, carry = true, layout_edge = null, device_w = null } = {}) {
    const mode = (layout_edge === null ? edge : layout_edge) ? 1 : 0;
    if (!carry) {
      const lines = text.replaceAll('\r\n', '\n').split('\n').slice(0, max_lines ?? undefined);
      return lines.flatMap((line, n) => this.layout(lang, line, x, y + n * size, edge, size, { clip_right, layout_edge, device_w }));
    }
    const items = this.F.layout(this.fonts.get(lang), (code) => this.icon(code), text, x, y, size + 2 * vcenter_delta, mode, size,
      { clip_right, max_lines, ...(device_w === 0 ? { device_w: null } : {}) });
    if (vcenter_delta) for (const it of items) if (it.kind === 'icon') it.y -= vcenter_delta;
    if (advance_delta !== null) for (const it of items.slice(advance_delta + 1)) it.x += 1;
    for (const it of items) if (it.kind === 'icon') it.pixels = this.icon_pixels(it.header);
    return items;
  }
}

// the BITMAPs of a draw_text result as (src, x, y, inline LUT); other commands as (name,)
const decoded = (result) => result.commands.map((r) => decode_command(r.slice(4, 4 + r[2])));
function bitmaps_of(result, base) {
  return decoded(result).map((c) => {
    if (c.name !== 'BITMAP') return [c.name];
    const off = c.dst - base;
    return [c.src, off % STRIDE, Math.floor(off / STRIDE), c.table ?? null];
  });
}
const predicted = (items, lut) => items.map((it) => [it.header, it.x, it.y, lut]);
// Engine-model rule: a BITMAP whose LUT-0 pixel would change a non-zero byte is refused whole. Returns the refusals.
function blit(surface, items, lut, clip = null) {
  let refused = 0;
  for (const it of items) {
    const w = it.width, h = it.height, px = it.pixels, writes = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const X = it.x + c, Y = it.y + r;
        if (clip && !(clip[0] <= X && X <= clip[2] && clip[1] <= Y && Y <= clip[3])) continue;
        writes.push([Y * STRIDE + X, lut[px[r * w + c]]]);
      }
    }
    if (writes.some(([a, v]) => v === 0 && surface.data[a])) { refused += 1; continue; }
    for (const [a, v] of writes) surface.data[a] = v;
  }
  return refused;
}
function plane(lab, layer = T.TEXT_LAYER) {
  const s = lab.surfaces[lab.buffer_of(layer)];
  return lab.sim.read(s.base, STRIDE * ROWS);
}
function first_diff(a, b) {
  let i = 0;
  while (a[i] === b[i]) i++;
  return `x=${i % STRIDE} y=${Math.floor(i / STRIDE)}: firmware ${a[i]} reference ${b[i]}`;
}
// lab.draw_text; an engine error the call did not expect becomes a problem of the group
function safe_draw(lab, problems, label, gc, x, y, kw) {
  try { return lab.draw_text(gc, x, y, kw); } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    problems.push(`${label}: ${e.message.slice(0, 300)}`);
    return { lang: lab.lang, sid: kw.sid ?? null, text: kw.text ?? null, y, commands: [], frame: null, glyph_bitmaps: 0, attr_gc: lab.attr_gc(gc) };
  }
}
// jobs: [(sid or text, y)]. Clears the text layer; for each job predicts the BITMAPs and refusals, then draws and compares.
function draw_and_predict(lab, ref, gc, jobs, edge, { colour = T.DEFAULT_COLOUR, ...refKw } = {}) {
  lab.clear_layer();
  const base = lab.surfaces[lab.buffer_of(T.TEXT_LAYER)].base;
  const surface = new fmt.Surface(STRIDE, ROWS);
  const lut = ref.F.text_lut(colour, edge);
  const problems = [], results = [], allItems = [];
  for (const [what, y] of jobs) {
    const text = typeof what === 'number' ? lab.get_string(what)[1] : what;
    const items = ref.layout(lab.lang, text, 24, y, edge, lab.font_size(), refKw);
    const refused = blit(surface, items, lut);
    const kw = typeof what === 'number' ? { sid: what } : { text: what };
    const r = safe_draw(lab, problems, `${lab.lang} ${show(what)}`, gc, 24, y, { colour, edge, expect: Array(refused).fill('BMP_TRANSPARENCY'), ...kw });
    r.text = text;
    r.refused = refused;
    const got = bitmaps_of(r, base), want = predicted(items, lut);
    if (!pred(deepEqual(got, want))) {
      const n = Math.min(got.length, want.length);
      let k = 0;
      while (k < n && deepEqual(got[k], want[k])) k++;
      problems.push(`${lab.lang} ${show(what)}: ${got.length} commands vs ${want.length} predicted; first difference #${k}: firmware ${show(k < got.length ? got[k] : null)} reference ${show(k < want.length ? want[k] : null)}`);
    }
    results.push(r);
    allItems.push(items);
  }
  return [results, allItems, surface, problems];
}
function compare_plane(lab, surface, label) {
  const got = plane(lab);
  if (!pred(bytesEq(got, surface.data))) return [`${label}: buffer differs at ${first_diff(got, surface.data)}`];
  return [];
}

function apply_mutant(name) {
  if (name === 'sset-accepted') {
    for (const C of [T.TextLab, T.TextDisplayLab]) {
      const sSet = C.prototype._s_set;
      C.prototype._s_set = function (hle, r) { this.setting = this.langs.get(this.lang).setting; return sSet.call(this, hle, r); };
    }
  } else if (name === 'no-h-stack') T.setStackClear(0);
  else if (name) throw new SystemExit(`unknown mutant ${show(name)}: one of ${show(sortStr(MUTANTS.keys()))}`);
}

// Each mutant must fail with reported problems: exit 1, a FAILED summary, no uncaught error.
function run_mutants() {
  let bad = 0;
  for (const [name, what] of MUTANTS) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, OM_TEXT_MUTANT: name, OM_RNG_TAPE: '' }, maxBuffer: 1 << 26 });
    const out = (r.stdout + r.stderr).trim().split(/\r\n|\r|\n/).filter((_, i, a) => a.length > 1 || a[0] !== '');
    const fails = out.filter((line) => line.startsWith('[FAIL]'));
    const ok = pred(r.status === 1 && !hasStack(out) && out.length && out.at(-1).startsWith('FAILED') && (fails.length || out.at(-1).startsWith('FAILED:')));
    bad += ok ? 0 : 1;
    console.log(`[${ok ? 'ok' : 'FAIL'}] mutant ${name} (${what}): exit ${r.status}, ${fails.length} [FAIL] group(s): ${fails.map((f) => f.split(/\s+/)[1]).join(', ')}; last line ${show(out.length ? out.at(-1).slice(0, 120) : null)}`);
    if (!ok) console.log(out.slice(-15).map((line) => '      ' + line).join('\n'));
  }
  const allOk = pred(!bad);
  console.log(`${allOk ? 'all mutants reported' : 'FAILED'} (${bad} problem(s))`);
  throw new SystemExit(allOk ? 0 : 1);
}

const init_prints = () => (OSD_DEFAULTS.kernel === 'native' ? INIT_PRINTS : KERNEL_NONE_INIT_PRINTS);

async function check(seed = 1) {
  apply_mutant(process.env.OM_TEXT_MUTANT || null);
  const t0 = performance.now();
  const rng = newRandom(seed);
  const image = loadImage(), block = loadBlock();
  const failures = [], notes = [];
  const group = (name, problems) => {
    const status = pred(!problems.length) ? 'ok' : 'FAIL';
    console.log(`[${status}] ${name}`);
    for (const p of problems) console.log('      ' + p);
    failures.push(...problems);
  };
  // ---- 0. offline
  const langs = new Map(R.languages(image, block).map((e) => [e.lang, e]));
  const tables = new Map([...langs].map(([lang, e]) => [lang, new R.StringTable(e.strings_record, R.raw_record(e.strings_record, block))]));
  const p0 = [...langs].filter(([lang]) => !pred(tables.get(lang).lang === lang && tables.get(lang).count === 4702)).map(([lang, e]) => `${lang}: string record ${e.strings_record} tag ${tables.get(lang).tag}`);
  p0.push(...[...langs].filter(([, e]) => !pred(e.font_record === e.strings_record + 18)).map(([lang, e]) => `${lang}: font ${e.font_record} != strings ${e.strings_record} + 18`));
  // ---- 1. language resources (one session, all 18 languages)
  const p1 = [];
  let ref, ids, negSset = 'not refused';
  const lab1 = newTextLab('en');
  try {
    if (pred(FONT !== null)) p1.push('refs/font.mjs imported by the drawing code');
    FONT = await import('../refs/font.mjs');
    ref = new Reference(FONT, langs);
    const en = langs.get('en');
    if (!pred(deepEqual(lab1.init_loaded, [[en.font_record, 0], [en.strings_record, 2], [0, 1]]))) p1.push(`mode-0 resource calls ${show(lab1.init_loaded)}`);
    if (!pred(deepEqual(lab1.init_prints, init_prints()))) p1.push(`bring-up prints ${show(lab1.init_prints)}`);
    ids = [...FIXED_IDS, ...rng.sample({ range: 4702 }, 64)];
    for (const [lang, e] of langs) {
      const calls = lab1.set_language(lang);
      if (fault('text-getstring') && lang === 'fr') lab1.sim.write(lab1.get_string(ids[0])[0], new Uint8Array([0x58, 0]));   // JS-only fault point
      if (!pred(deepEqual(calls, [[e.font_record, 0], [e.strings_record, 2]]))) p1.push(`${lang}: resource calls ${show(calls)}`);
      const bad = ids.filter((sid) => !pred(lab1.get_string(sid)[1] === tables.get(lang).text(sid)));
      if (!pred(!bad.length)) p1.push(`${lang}: GetString differs for ids ${show(bad.slice(0, 5))}`);
    }
    lab1.setting = langs.get('ja').setting;
    try {
      lab1.load_language(1);
      if (!pred(false)) p1.push('negative control: S-SET with the ja value while en is requested was accepted');
    } catch (e) {
      if (!(e instanceof FirmwareError)) throw e;
      negSset = e.message;
    }
    lab1.setting = langs.get(lab1.lang).setting;
  } finally { lab1.close(); }
  let glyphs = 0;
  for (const [lang, font] of ref.fonts) {
    glyphs += font.glyphs.size;
    if (!pred(font.glyphs.size && [58, 61].includes(font.line_h))) p0.push(`${lang}: font ${font.glyphs.size} glyphs line height ${font.line_h}`);
  }
  try { new FONT.Font(R.raw_record(langs.get('th').font_record, block)); } catch (e) {
    if (!isValueError(e)) throw e;
    if (!pred(false)) p0.push(`th font does not parse: ${e.message}`);
  }
  group(`0 offline: 18 string tables x 4702 ids, 18 fonts strict-parsed (${glyphs} glyphs without th), font = strings + 18`, p0);
  group(`1 native 0x51257bfb for 18 languages (mode 0 at bring-up, mode 1 per switch: resource calls as the setting maps say); GetString x ${ids.length} ids each; bring-up prints pinned (${init_prints().length}); `
    + `S-SET with a wrong value refused (${negSset.split(':')[0]})`, p1);

  // ---- 2..4, 7..9: one fresh session per language
  const [p2, p3, p4, p7, p8, p9, p10] = [[], [], [], [], [], [], []];
  let refused0 = null;
  const planes = new Map(), counts = counter();
  for (const lang of LANGS) {
    withLab(newTextLab(lang), (lab) => {
      const gc = lab.make_gc();
      if (lang === 'en') {
        const before = plane(lab);
        const r = safe_draw(lab, p8, '1020 over the 255 clear', gc, 24, 12, { sid: 1020, expect: Array(10).fill('BMP_TRANSPARENCY') });
        if (!pred(bytesEq(plane(lab), before) && r.frame && r.frame.error_total === 10)) p8.push('1020 over the 255 clear: target changed or error count differs');
      }
      const jobs = IDS.map((sid, i) => [sid, lineY(i)]);
      if (lang === 'en') jobs.push([LITERAL, lineY(IDS.length)]);
      const [results, items, surface, probs] = draw_and_predict(lab, ref, gc, jobs, T.DEFAULT_EDGE);
      p2.push(...probs, ...compare_plane(lab, surface, `${lang} mode 1`));
      counts.set(lang, results.reduce((s, r) => s + r.glyph_bitmaps, 0));
      planes.set(lang, plane(lab));
      if (!pred(!lab.font_log.length)) p2.push(`${lang}: gpifont log ${show(lab.font_log)}`);
      const prints = lab.kernel.events.filter((e) => e[0] === 'print');
      if (!pred(prints.length === lab.init_prints.length)) p2.push(`${lang}: prints while drawing ${show(prints.slice(lab.init_prints.length))}`);
      // 4a. the inline icon of 2872
      const r = results[IDS.indexOf(2872)];
      const icon = items[IDS.indexOf(2872)].find((it) => it.kind === 'icon') ?? { header: null, y: null };
      const [, h, header] = ref.icon(0xA003);
      const entry = unpackFrom('<I', ref.mem(ref.icon_table + 4 * 3, 4), 0)[0];
      const drawn = bitmaps_of(r, lab.surfaces[lab.buffer_of(1)].base);
      if (!pred(icon.header === header && icon.y === r.y + Math.floor((lab.font_size() - h) / 2) && drawn.length && deepEqual(drawn[0].slice(0, 3), [header, 24, icon.y]))) {
        p4.push(`${lang} 2872: icon ${show(icon)} vs table entry 0x${entry.toString(16).padStart(8, '0')}`);
      }
      // 7. negative controls on the same firmware buffer
      const lut = ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE);
      for (const [label, kw, table] of [['vcenter + 1', { vcenter_delta: 1 }, lut], ['advance + 1 on glyph 3', { advance_delta: 3 }, lut],
        ['LUT shades c+1/c+2 swapped', {}, Uint8Array.from([lut[0], lut[1], lut[3], lut[2], ...lut.slice(4)])]]) {
        if (lang !== 'en') break;
        const s = new fmt.Surface(STRIDE, ROWS);
        jobs.forEach(([, y], i) => blit(s, ref.layout(lang, results[i].text, 24, y, T.DEFAULT_EDGE, lab.font_size(), kw), table));
        if (!pred(!bytesEq(s.data, planes.get(lang)))) p7.push(`negative control "${label}" was not detected`);
      }
      if (lang === 'en') {
        // 3. mode 0 (edge 0)
        const jobs0 = [...[1020, 4414, 737, 147].map((sid, i) => [sid, lineY(i)]), [LITERAL, lineY(4)]];
        const [results0, , surface0, probs0] = draw_and_predict(lab, ref, gc, jobs0, 0);
        p3.push(...probs0, ...compare_plane(lab, surface0, 'en mode 0'));
        counts.set('en mode 0', results0.reduce((s, x) => s + x.glyph_bitmaps, 0));
        refused0 = results0.reduce((s, x) => s + x.refused, 0);
        notes.push(`mode0 en: ${refused0} BITMAPs refused (BMP_TRANSPARENCY, predicted) of ${counts.get('en mode 0')}: ` + results0.filter((x) => x.refused).map((x) => `${show(x.text)} ${x.refused}`).join(', '));
        // 4b. rejected escapes
        for (const sid of [1212, 1281]) {
          lab.font_log.length = 0;
          const [res, , surf, pr] = draw_and_predict(lab, ref, gc, [[sid, 12]], T.DEFAULT_EDGE);
          p4.push(...pr, ...compare_plane(lab, surf, `en ${sid}`));
          const log = counter();
          for (const [f, ln] of lab.font_log) inc(log, JSON.stringify([f, ln]));
          if (!pred(log.size === 1 && log.has(JSON.stringify(REJECT_LOG)))) p4.push(`${sid}: gpifont log ${show(lab.font_log)}`);
          notes.push(`reject ${sid} ${res[0].glyph_bitmaps} bitmaps, gpifont.c(1060) x ${log.get(JSON.stringify(REJECT_LOG)) ?? 0} from ${show(sortStr(new Set(lab.font_log.map(([, , c]) => c))))}`);
        }
        // 10. character edge cases
        let lut10 = ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE);
        let [, , surf, probs] = draw_and_predict(lab, ref, gc, EDGE_LINES.map((s, i) => [s, 12 + 64 * i]), T.DEFAULT_EDGE);
        p10.push(...probs, ...compare_plane(lab, surf, 'en edge cases, one line each'));
        let s = new fmt.Surface(STRIDE, ROWS);
        EDGE_LINES.forEach((text, i) => blit(s, ref.layout('en', text.replaceAll('\x1f', ' '), 24, 12 + 64 * i, T.DEFAULT_EDGE, lab.font_size()), lut10));
        if (!pred(!bytesEq(s.data, plane(lab)))) p10.push('negative control "U+001F as a space" was not detected');
        const multiY = EDGE_MULTI.map((_, i) => 12 + 64 * EDGE_MULTI.slice(0, i).reduce((acc, t) => acc + t.split('\n').length, 0));
        [, , surf, probs] = draw_and_predict(lab, ref, gc, EDGE_MULTI.map((t, i) => [t, multiY[i]]), T.DEFAULT_EDGE);
        p10.push(...probs, ...compare_plane(lab, surf, 'en edge cases, several lines'));
        s = new fmt.Surface(STRIDE, ROWS);
        EDGE_MULTI.forEach((text, i) => blit(s, ref.layout('en', text, 24, multiY[i], T.DEFAULT_EDGE, lab.font_size(), { carry: false }), lut10));
        if (!pred(!bytesEq(s.data, plane(lab)))) p10.push('negative control "no skip carry" was not detected');
        [, , surf, probs] = draw_and_predict(lab, ref, gc, EDGE_MODE0.map((t, i) => [t, lineY(i)]), 0);
        p10.push(...probs, ...compare_plane(lab, surf, 'en edge cases, mode 0'));
        const base = lab.surfaces[lab.buffer_of(T.TEXT_LAYER)].base;
        for (const text of LOW_ESCAPES) {
          try {
            ref.layout('en', text, 24, 12, T.DEFAULT_EDGE, lab.font_size());
            if (!pred(false)) p10.push(`${show(text)}: the reference did not refuse an escape below 0xA000`);
          } catch (e) { if (!isValueError(e)) throw e; }
          lab.clear_layer();
          const got = bitmaps_of(safe_draw(lab, p10, show(text), gc, 24, 12, { text }), base).map((b) => (b.length === 1 ? b : ['0x' + b[0].toString(16), b[1], b[2]]));
          notes.push(`low escape ${show(text)} (lab memory before the icon table, not asserted): BITMAPs ${show(got)}`);
        }
        // 9. clip
        const kind3 = lab.surfaces[6];
        const clearKind3 = () => lab.sim.write(kind3.base, new Uint8Array(kind3.stride * kind3.height));
        lab.clear_layer(); clearKind3();
        let box = [24, 200, 140, 200 + 61];
        let r9 = safe_draw(lab, p9, `4414 box ${show(box)}`, gc, 24, 200, { sid: 4414, box });
        const items9 = ref.layout('en', lab.get_string(4414)[1], 24, 200, T.DEFAULT_EDGE, lab.font_size(), { clip_right: box[2] });
        let s9 = new fmt.Surface(STRIDE, ROWS);
        blit(s9, items9, ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE), box);
        p9.push(...compare_plane(lab, s9, `en 4414 clipped to ${show(box)}`));
        let kinds = decoded(r9).map((c) => c.name);
        if (!pred(kinds.filter((k) => k === 'COPY').length === 2)) p9.push(`clipped draw: engine commands ${show(kinds)}`);
        notes.push(`clip right box ${show(box)}: engine ${kinds.join(' ')}`);
        lab.clear_layer(); clearKind3();
        box = [24, 200, 600, 240];
        r9 = safe_draw(lab, p9, `4414 box ${show(box)}`, gc, 24, 200, { sid: 4414, box });
        s9 = new fmt.Surface(STRIDE, ROWS);
        blit(s9, ref.layout('en', lab.get_string(4414)[1], 24, 200, T.DEFAULT_EDGE, lab.font_size(), { clip_right: box[2] }), ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE), box);
        p9.push(...compare_plane(lab, s9, `en 4414 clipped to ${show(box)}`));
        const sortedCounts = (rr) => { const k = counter(); for (const c of decoded(rr)) inc(k, c.name); return new Map(sortStr(k.keys()).map((n) => [n, k.get(n)])); };
        notes.push(`clip bottom box ${show(box)}: engine ${show(sortedCounts(r9))}`);
        for (const text of CLIP_ICON.slice(0, 2)) {
          box = CLIP_ICON[2];
          lab.clear_layer(); clearKind3();
          r9 = safe_draw(lab, p9, `${show(text)} box ${show(box)}`, gc, 24, 12, { text, box });
          const lut9 = ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE);
          s9 = new fmt.Surface(STRIDE, ROWS);
          blit(s9, ref.layout('en', text, 24, 12, T.DEFAULT_EDGE, lab.font_size(), { clip_right: box[2] }), lut9, box);
          p9.push(...compare_plane(lab, s9, `en ${show(text)} clipped to ${show(box)}`));
          s9 = new fmt.Surface(STRIDE, ROWS);
          blit(s9, ref.layout('en', text, 24, 12, T.DEFAULT_EDGE, lab.font_size(), { clip_right: box[2], carry: false }), lut9, box);
          if (!pred(bytesEq(s9.data, plane(lab)) !== text.includes('@'))) p9.push(`${show(text)}: the "no skip carry" reference ${text.includes('@') ? 'matches' : 'differs'}`);
          notes.push(`clip right ${show(text)} box ${show(box)}: engine ${show(sortedCounts(r9))}`);
        }
        lab.clear_layer(); clearKind3();
        box = [24, 1130, 1599, 1199];
        safe_draw(lab, p9, `2387 box ${show(box)}`, gc, 24, 1130, { sid: 2387 });
        s9 = new fmt.Surface(STRIDE, ROWS);
        blit(s9, ref.layout('en', lab.get_string(2387)[1], 24, 1130, T.DEFAULT_EDGE, lab.font_size(), { clip_right: box[2], max_lines: 2 }), ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE), box);
        p9.push(...compare_plane(lab, s9, `en 2387 clipped to ${show(box)}`));
        lab.clear_layer(); clearKind3();
        safe_draw(lab, p8, `2387 mode 0 box ${show(box)}`, gc, 24, 1130, { sid: 2387, edge: 0, expect: ['BMP_TRANSPARENCY'] });
        for (const [text, bx] of SCREEN_EDGE) {
          lab.clear_layer(); clearKind3();
          r9 = safe_draw(lab, p9, `${show(text.slice(0, 8))} mode 0 box ${show(bx)}`, gc, bx[0], bx[1], { text, edge: 0, box: bx });
          const lut0 = ref.F.text_lut(T.DEFAULT_COLOUR, 0);
          const got = plane(lab), shown = [];
          for (const dw of [null, 0]) {
            s9 = new fmt.Surface(STRIDE, ROWS);
            const refused = blit(s9, ref.layout('en', text, bx[0], bx[1], 0, lab.font_size(), { clip_right: bx[2], device_w: dw }), lut0, bx);
            shown.push([bytesEq(s9.data, got), refused]);
          }
          const edgeHit = bx[2] === 1599;
          if (!pred(shown[0][0] === true && shown[0][1] === 0)) p9.push(`${show(text.slice(0, 8))} mode 0 box ${show(bx)}: the reference (equal, refused) is ${show(shown[0])}`);
          if (!pred(shown[1][0] !== edgeHit)) p9.push(`${show(text.slice(0, 8))} mode 0 box ${show(bx)}: the reference without the screen-edge rule ${edgeHit ? 'matches' : 'differs'}`);
          const k3 = decoded(r9).filter((c) => c.name === 'BITMAP' && kind3.base <= c.dst && c.dst < kind3.base + kind3.stride * kind3.height).map((c) => (c.dst - kind3.base) % kind3.stride);
          notes.push(`screen edge mode 0 ${show(text.slice(0, 8))} box ${show(bx)}: ${r9.glyph_bitmaps} BITMAPs, x of those in the kind-3 record ${show(k3)}`);
        }
        // 9b. top clip (U9), observation only
        lab.clear_layer(); clearKind3();
        const clip = lab.alloc(new Uint8Array(new Int16Array([0, 214, 1599, 1199]).buffer), 4);
        lab.call(SET_CLIP, { a0: gc, a1: clip });
        let outcome;
        try { lab.draw_text(gc, 24, 200, { sid: 1020 }); outcome = 'no engine errors'; } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          outcome = e.message.split(';')[0];
        }
        lab.call(SET_CLIP, { a0: gc, a1: 0 });
        const got = plane(lab);
        const rows = range(0, ROWS).filter((y) => got.subarray(y * STRIDE, y * STRIDE + 1600).some((b) => b));
        notes.push(`topclip clip y0 214, line y 200: rows written ${rows.length ? `${rows[0]}..${rows.at(-1)}` : 'none'}, ${outcome} (U9, not asserted)`);
        // 8b. Thai
        lab.set_language('th');
        lab.clear_layer();
        try { lab.draw_text(gc, 24, 12, { sid: 1020, expect: Array(3).fill('BMP_TRANSPARENCY') }); } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          p8.push(`th 1020: ${e.message.slice(0, 300)}`);
        }
      }
    });
  }
  group(`2 en/ja/zh-CN mode 1, ids ${show(IDS)} (+ literal for en): every BITMAP (header, x, y, inline LUT) and the whole 1664x1200 buffer equal the reference (${show(counts)} BITMAPs)`, p2);
  group(`3 en mode 0 (edge 0): commands, the predicted BMP_TRANSPARENCY refusals (${refused0}: adjacent glyph boxes overlap and the next glyph's LUT-0 pixels fall on the previous ink, U1) and the buffer equal the reference`, p3);
  group("4 icons: 2872 icon = icon table[3], y = line + (size - h) / 2; 1212/1281 rejected codes drawn as '@' glyphs with gpifont.c(1060) logged; 1212 has 5 CR LF lines", p4);

  // ---- 5. language switch equivalence
  const p5 = [];
  withLab(newTextLab('en'), (lab) => {
    const gc = lab.make_gc();
    for (const lang of LANGS) {
      if (lang !== lab.lang) lab.set_language(lang);
      const jobs = [...IDS.map((sid, i) => [sid, lineY(i)]), ...(lang === 'en' ? [[LITERAL, lineY(IDS.length)]] : [])];
      draw_and_predict(lab, ref, gc, jobs, T.DEFAULT_EDGE);
      if (!pred(bytesEq(plane(lab), planes.get(lang)))) p5.push(`${lang} after switch differs from a fresh session at ${first_diff(plane(lab), planes.get(lang))}`);
    }
  });
  group('5 en -> ja -> zh-CN in one session (H-SWITCH): buffers byte-equal to fresh sessions', p5);

  // ---- 11. two gcs with one font
  const p11 = [];
  withLab(newTextLab('en'), (lab) => {
    const g1 = lab.make_gc(), g2 = lab.make_gc();
    const handles = [lab.sim.u32(g1 + 76), lab.sim.u32(g2 + 76)];
    if (!pred(handles[0] === handles[1] && lab.attr_gc(g1) === g2)) p11.push(`handles ${show(handles.map((x) => '0x' + x.toString(16)))}, attribute gc 0x${lab.attr_gc(g1).toString(16).padStart(8, '0')} (gc2 0x${g2.toString(16).padStart(8, '0')})`);
    const jobs = TWO_GC_TEXT.map((t, i) => [t, lineY(i)]);
    const refused11 = [];
    for (const [attr, other] of [[g2, g1], [g1, g2]]) {
      if (!pred(lab.attr_gc(g1) === attr)) p11.push(`attribute gc 0x${lab.attr_gc(g1).toString(16).padStart(8, '0')}, expected 0x${attr.toString(16).padStart(8, '0')}`);
      const rest = lab.sim.read(other + 684, 1)[0];
      if (!pred(!rest)) p11.push(`gc 0x${other.toString(16).padStart(8, '0')} +684 = ${rest} between calls`);
      for (const [gc, layoutEdge, label] of [[attr, null, 'attribute gc'], [other, rest, 'other gc']]) {
        const [res, , surf, probs] = draw_and_predict(lab, ref, gc, jobs, T.DEFAULT_EDGE, { layout_edge: layoutEdge });
        p11.push(...probs, ...compare_plane(lab, surf, `${label}, edge ${T.DEFAULT_EDGE}`));
        if (!pred(!res.some((r) => r.attr_gc !== attr))) p11.push(`${label}: attribute gc changed by DrawText`);
        if (gc === other) {
          refused11.push(res.reduce((s, r) => s + r.refused, 0));
          const s11 = new fmt.Surface(STRIDE, ROWS);
          for (const [t, y] of jobs) blit(s11, ref.layout('en', t, 24, y, T.DEFAULT_EDGE, lab.font_size()), ref.F.text_lut(T.DEFAULT_COLOUR, T.DEFAULT_EDGE));
          if (!pred(!bytesEq(s11.data, plane(lab)))) p11.push(`${label}: negative control "mode from the drawing gc" was not detected`);
        }
      }
      lab.call(T.GC_SET_FONT_BY_ID, { a0: g1, d0: 1 });
    }
    notes.push(`two gcs: text with edge ${T.DEFAULT_EDGE} on the gc that is not the attribute gc lays out in mode 0 with the edge LUT; BMP_TRANSPARENCY refusals (predicted) ${show(refused11)}`);
  });

  // ---- 6. display
  const p6 = [];
  for (const device of ['tft', 'evf']) {
    let lab, drawn, comp;
    try {
      [lab, drawn, comp] = T.demo_session(env(), device, { frame: CD.test_card(), aspect: CD.ASPECTS.get('3,2') });
    } catch (e) {
      if (!(e instanceof FirmwareError)) throw e;
      p6.push(`${device} demo: ${e.name}: ${e.message.slice(0, 300)}`);
      continue;
    }
    withLab(lab, () => {
      if (!pred(comp.status === 'NONE' && !comp.error_total)) p6.push(`${device}: compose ${comp.status}, ${comp.error_total} errors`);
      const [base, shown] = lab.layer_matches_vsc(T.TEXT_LAYER, device);
      if (!pred(base === shown)) p6.push(`${device}: text record 0x${base.toString(16).padStart(8, '0')} but OSD2 shows 0x${shown.toString(16).padStart(8, '0')}`);
      try { CD.compare(lab, device, comp, device); } catch (e) {
        if (e?.name !== 'AssertionError') throw e;
        p6.push(e.message);
      }
      if (!pred(deepEqual(CD.errlog_counts(lab), CD.ERRLOG[device]))) p6.push(`${device}: error log ${show(CD.errlog_counts(lab))}`);
      const canvas = lab.sim.read(lab.surfaces[lab.buffer_of(1)].base, STRIDE * 600);
      const width = comp.header.width, scale = device === 'evf' ? 2 : 1;
      for (const r of drawn.filter((_, i) => i % 3 === 0)) {
        if (!pred(r.commands.length)) { p6.push(`${device} ${r.lang} ${r.sid}: no engine commands`); continue; }
        const first = decoded(r)[0];
        const off = first.dst - lab.surfaces[lab.buffer_of(1)].base;
        const x0 = off % STRIDE, y0 = Math.floor(off / STRIDE);
        let spot = null;
        outer: for (let y = y0; y < y0 + 60; y++) for (let x = x0; x < x0 + 60; x++) if (canvas[y * STRIDE + x] === T.DEFAULT_COLOUR) { spot = [x, y]; break outer; }
        const luma = spot ? comp.words[(spot[1] * scale) * width + spot[0] * scale] & 0xFF : null;
        if (!pred(spot !== null && luma >= 240)) p6.push(`${device} ${r.lang}: fill pixel ${show(spot)} luma ${show(luma)}`);
      }
      const got = new Map();
      for (const [kind, ch, name] of CD.note_set(lab)) { const t = [device, kind, `${ch} ${name}`]; got.set(JSON.stringify(t), t); }
      for (const a of CD.stub_unwritten(lab)) { const t = [device, 'STUB_UNWRITTEN', '0x' + a.toString(16).padStart(8, '0')]; got.set(JSON.stringify(t), t); }
      const cmp = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
      notes.push(...[...got.values()].sort(cmp).map(([d, k, v]) => `${d} ${k} ${v}`));
    });
  }
  let want = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8').split(/\r\n|\r|\n/).filter((line) => line && !line.startsWith('#')) : [];
  if (OSD_DEFAULTS.kernel === 'none') want = want.map((line) => KERNEL_NONE_NOTES.get(line) ?? line);
  group('6 TFT and EVF demo: status NONE, record = OSD2 DMASADR, composite == check_display.reference(), fill pixels reach both outputs, error log as check_display', p6);
  group('7 negative controls: vcenter + 1, advance + 1, LUT shades swapped detected', p7);
  group('8 recorded unknowns: 1020 over the 255 clear -> 10 x BMP_TRANSPARENCY and no change; th 1020 -> 3 x BMP_TRANSPARENCY (stacked marks, U1/U5); 2387 bottom-clipped in mode 0 -> 1 x BMP_TRANSPARENCY (kind-3 record, U1)', p8);
  group('9 clip: a line cut by the right edge of the box, one cut by its bottom edge, an icon right of the clip whose skips carry into line 2 (+ glyph-only control, "no skip carry" detected), a 3-line '
    + 'string cut after line 2 (offscreen COPY/BITMAP/COPY path per cell) and mode-0 cells cut by the device edge (no pad_l shift; "no screen-edge rule" detected, and equal for a box inside the '
    + 'screen), equal the reference cropped to the box', p9);
  group(`10 edge cases ${EDGE_LINES.length} one-line and ${EDGE_MULTI.length} multi-line literals (U+001F before glyphs and escapes, @ inside an escape, @0000@, missing glyph, U+1F600, skips carried across lines, `
    + `into a U+001F too) and ${EDGE_MODE0.length} mode-0 escapes (@a003@: lsb term of the icon advance): BITMAPs and buffer equal the reference ("U+001F as a space" and "no skip carry" detected); escapes `
    + 'below 0xA000 refused by the reference', p10);
  group('11 two gcs, font id 1: one shared handle; attribute +12 = the last GcSetFontById caller; text with an edge lays out in mode 1 on that gc and in mode 0 (resting +684) with the edge LUT on the other, both '
    + 'ways round ("mode from the drawing gc" detected)', p11);
  return [failures, notes, want, (performance.now() - t0) / 1000];
}

export async function main(argv) {
  const a = parseArgs('check_text.mjs', argv, [
    { opt: '--seed', type: 'int' },
    { opt: '--write-notes', type: 'flag' },
    { opt: '--mutants', type: 'flag' },
    { opt: '--kernel', type: 'str', choices: ['native', 'none'] },
  ]);
  OSD_DEFAULTS.kernel = a.kernel ?? 'native';
  if (a.write_notes && OSD_DEFAULTS.kernel !== 'native') a.error('--write-notes pins the default (K-native) lab');
  if (a.mutants) run_mutants();
  if (a.write_notes && !process.env.OM_NOTES_DIR) a.error('--write-notes: needs OM_NOTES_DIR (the directory to write check_text_notes.txt in)');
  let failures, notes, want, elapsed;
  try { [failures, notes, want, elapsed] = await check(a.seed ?? 1); } catch (e) {
    if (e instanceof FirmwareError) throw new SystemExit(`FAILED: ${e.name}: ${e.message}`);
    throw e;
  }
  if (a.write_notes) {
    const file = path.join(process.env.OM_NOTES_DIR, 'check_text_notes.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# check_text observations and display notes (regenerate with --write-notes)\n' + notes.join('\n') + '\n');
    console.log(`wrote ${file}`);
  } else if (!pred(deepEqual(notes, want))) {
    const ws = new Set(want), ns = new Set(notes);
    failures.push('notes differ from check_text_notes.txt: new ' + show(sortStr([...ns].filter((x) => !ws.has(x))).slice(0, 6)) + ' missing ' + show(sortStr([...ws].filter((x) => !ns.has(x))).slice(0, 6)));
    console.log('[FAIL] notes: ' + failures.at(-1));
  } else console.log(`[ok] notes equal check_text_notes.txt (${notes.length} lines)`);
  const passed = pred(!failures.length);
  console.log(`${passed ? 'all text checks passed' : 'FAILED'} (${failures.length} problem(s), ${elapsed.toFixed(1)} s)`);
  return passed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_text.mjs', main);
