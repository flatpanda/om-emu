#!/usr/bin/env node
// The menu checks: the firmware's GUI task paints Setup Menu pages on the JS lab (src/lab/menu.mjs);
// refs/menuref.mjs predicts them. The lab sessions run first; the references (refs/menuref.mjs with refs/font.mjs,
// refs/settings.mjs) are imported with import() only after they ended (asserted with a check-side flag),
// and they read only firmware data and formats (src/lab/menudata.mjs and src/lab/resources.mjs injected). Composites
// are compared with check_display's reference(). Groups 0..10 with their report lines; every pass/fail predicate (the exit code and the --mutants verdicts included) goes through
// checks/lib/pred.mjs. --jobs N runs the sessions in N worker_threads (each worker imports this module);
// --mutants first checks that a child spinning the guest on bra ., killed on timeout, leaves no process and no
// temporary directory (a node child running a JS Simulator), then reruns
// the check (--quick) under each mutant in a node child.
//   node emu/checks/check_menu.mjs [--quick | --full] [--write-notes] [--mutants] [--jobs N] [--store native|empty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { REPO, FIXTURES, labEnv, loadImage, loadBlock, runMain, SystemExit, resultHook } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { flushCoverage } from './lib/coverage.mjs';
import { pred, fault } from './lib/pred.mjs';
import { isValueError, hasStack } from './lib/errors.mjs';
import { encode, decode } from './lib/wire.mjs';
import { Stats } from '../src/lab/sim.mjs';
import * as CD from './check_display.mjs';
import * as D from '../src/lab/display.mjs';
import * as MM from '../src/lab/menu.mjs';
import * as M from '../src/lab/menudata.mjs';
import * as R from '../src/lab/resources.mjs';
import * as O from '../src/lab/osd.mjs';
import { ERRORS as F_ERRORS } from '../src/lab/osdfmt.mjs';
import { displayed_windows } from '../src/lab/windows.mjs';
import { FirmwareError, runtime } from '../src/lab/hle.mjs';
import { ValueError, LabError, AssertionError } from '../src/lab/errors.mjs';
import { Simulator } from '../src/lab/sim.mjs';
import { disasm_of as K_disasm } from '../src/lab/kernel.mjs';
import { PER_SCPU_TASK } from '../src/lab/scpulink.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show } from '../src/util/show.mjs';
import { pack } from '../src/util/bytes.mjs';

export const NOTES_FILE = path.join(FIXTURES, 'check_menu_notes.txt');
export const LANGS = ['en', 'ja', 'zh-CN'];
export const SEED = new Map([[450, 1], [1095, 1], [161, 255], [32, 60], [115, 240]]);
export const BAD_SEED = new Map([[161, 7]]);
export const MUTANTS = new Map([
  ['persist-page+1', 'S-PERSIST writes the page input + 1 (the title must be reported as wrong)'],
  ['no-ctors', 'CTORS off (the bring-up must stop with an error)'],
  ['settle-no-irq', 'settle() never delivers the engine interrupt (the stop must be reported)'],
  ['gui-4513-native', 'S-PROP off: the GUI reads property 4513 from the empty store (nothing reaches the VSC)'],
  ['vsc-other-device', 'composite compared against the other device (check_display.Skip must be reported)'],
]);
export const GUI_PATH_HOOKS = new Set(['S-STORE', 'S-RES', 'S-LOG', 'S-RPC', 'prop_get', 'sync_send', 'memset', 'memcpy', 'malloc', 'free',
  'errlog', 'clk_ctrl', 'idle', 'task_start', 'lab_home']);
export const PROP_SITES = new Set(['0x503eff61', '0x503d72c5', '0x503d2551']);
let JOBS = 1;
let STORE = process.env.OM_MENU_STORE ?? 'native';
export const DROPPED = [[10, 10, '0x50045474']];
export const STARTED = new Set([MM.CHANGE_TASK, MM.EMPTY_TASK, MM.GUI_TASK, MM.GENIFA_TIMER_TASK, MM.EYEFI_TASK]);
export const LAYER_RECORDS = new Map([[0, [2, 3]], [1, [4, 5]], [2, [0, 1]]]);
export const PALETTE_KIND = 8;
// GUI layout byte and connect state after H-CONNECT: lOutput 7's handler (0x510c4406) sets connect state 5, then reads
// the finder style CCommon+320 (0x510c8118) and calls SetLayoutMode(2) for style 1 or 2, SetLayoutMode(0) for 3 and
// nothing otherwise (0x510c4422..0x510c4451). The native store's style is 2 (setting 453's default); M5's empty store
// gives 0, so WinMain's mode 1 stays until the menu entry's ChangeFinderStyle(3, 1) sets 0 (lab, both stores).
export const EVF_CONNECT_AFTER = { native: { layout: 2, connect: 5 }, empty: { layout: 1, connect: 5 } };
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const sortStr = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// ints, strs and arrays of them in order, arrays element by element
const cmpItems = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpItems(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (a === null || b === null) throw new TypeError('cmpItems: null in a comparison');
  return a < b ? -1 : a > b ? 1 : 0;
};
const sortedItems = (xs) => [...xs].sort(cmpItems);
const cut = (s, n) => { const cs = Array.from(s); return cs.length > n ? cs.slice(0, n).join('') : s; };
// a Map of counts shown highest first (ties in insertion order)
const showCounts = (m) => show(new Map([...m].sort((a, b) => b[1] - a[1])));
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const bytesEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const wordsSha = (words) => createHash('sha256').update(new Uint8Array(Uint32Array.from(words).buffer)).digest('hex');
// the lines of a text, without the empty one after a final line break
const splitlines = (s) => { const out = s.split(/\r\n|\r|\n/); if (out.length && out.at(-1) === '') out.pop(); return out; };
let ENV = null;
const env = () => (ENV ??= labEnv({ resBlock: loadBlock(), ...(STATS ? { beginSession: () => ({ stats: STATS, attach() {}, close(hle, closeSim) { closeSim(); } }) } : {}) }));
// OM_STATS (check_perf P6): sim.mjs's process-wide Stats, written as JSON at exit (insns, g_digest, seconds.c)
const STATS = process.env.OM_STATS && isMainThread ? new Stats(createHash) : null;
let REFS_LOADED = false;                  // refs/menuref.mjs, refs/font.mjs or refs/settings.mjs imported (D18)

export function sessions(mode) {
  if (mode === 'quick') return [['p1-en-A', 1, 'en', 'tft', 'skip', 1, null]];
  const out = [];
  const pages = range(1, STORE === 'native' ? 7 : 6);
  const langs = mode === 'full' ? LANGS : ['en'];
  for (const lang of langs) {
    for (const p of pages) {
      out.push([`p${p}-${lang}-A`, p, lang, 'tft', 'skip', 1, null]);
      if (mode === 'full') out.push([`p${p}-${lang}-B`, p, lang, 'tft', 'write', 1, null]);
    }
  }
  if (mode !== 'full') {
    if (STORE === 'native') out.push(['p6-ja-A', 6, 'ja', 'tft', 'skip', 1, null]);
    out.push(['p1-ja-A', 1, 'ja', 'tft', 'skip', 1, null], ['p1-zh-CN-A', 1, 'zh-CN', 'tft', 'skip', 1, null],
      ['p1-en-B', 1, 'en', 'tft', 'write', 1, null], ['p5-en-B', 5, 'en', 'tft', 'write', 1, null],
      ['p1-ja-B', 1, 'ja', 'tft', 'write', 1, null], ['p1-zh-CN-B', 1, 'zh-CN', 'tft', 'write', 1, null]);
  }
  if (mode !== 'quick') out.push(['p1-en-evflayout-A', 1, 'en', 'evf', 'skip', 1, null]);
  out.push(['p1-en-refuse', 1, 'en', 'tft', 'refuse', 1, null], ['p1-en-evf-A', 1, 'en', 'evf', 'skip', 1, null],
    ['p5-en-seed-A', 5, 'en', 'tft', 'skip', 1, SEED], ['p1-en-c3-A', 1, 'en', 'tft', 'skip', 3, null],
    ['p5-en-c7-A', 5, 'en', 'tft', 'skip', 7, null]);
  return out;
}

// ---- lab side
const record_index = (lab, address) => { const i = lab.records.indexOf(address); return i < 0 ? null : i; };
const layer_of = (index) => { for (const [layer, recs] of LAYER_RECORDS) if (recs.includes(index)) return layer; return null; };
// Draw calls of the first paint pass: from the first exec_start to the first gpiUpdateDisplay.
function first_pass(draws) {
  const i0 = draws.findIndex((d) => d.op === 'exec_start'), i1 = draws.findIndex((d) => d.op === 'gpiUpdateDisplay');
  if (i0 < 0 || i1 < 0) throw new LabError('first_pass: no exec_start or no gpiUpdateDisplay draw');
  return draws.slice(i0, i1);
}
// [texts, images, fills] of a pass in screen coordinates.
function normalise_pass(lab, draws) {
  const texts = [], images = [], fills = [];
  let window = null;
  for (const d of draws) {
    if (d.op === 'text') {
      texts.push({ text: d.text, colour: d.colour, s4: d.style4, s8: d.style8, align: [...d.align], margins: [...d.margins], edge: d.edge,
        local: [...d.box], origin: [-d.origin[0], -d.origin[1]], mode684: d.mode684, attr: d.attr_gc === d.gc, gc_id: d.gc_id });
    } else if (d.op === 'copy') {
      const src = record_index(lab, d.src), dst = record_index(lab, d.dst);
      if (dst === 6 && src !== null && src < 6) window = [layer_of(src), d.x, d.y, d.args[2], d.args[3]];
    } else if (d.op === 'bitmap') {
      const idx = record_index(lab, d.record);
      let layer, x, y, via;
      if (idx === 6) {
        if (window === null) throw new FirmwareError(`kind-3 bitmap without a preceding window copy: ${show(d)}`);
        const [l, sx, sy, dx, dy] = window;
        layer = l; x = sx - (dx - d.x); y = sy - (dy - d.y); via = 'kind3';
      } else { layer = layer_of(idx); x = d.x; y = d.y; via = 'direct'; }
      images.push({ layer, data: d.data, x, y, lut: d.lut ? Array.from(d.lut, (b) => b.toString(16).padStart(2, '0')).join('') : null, scale: [...d.scale], via });
    } else if (d.op === 'rect') {
      fills.push({ layer: layer_of(record_index(lab, d.record)), x: d.x, y: d.y, w: d.w, h: d.h, colour: d.colour });
    }
  }
  return [texts, images, fills];
}
export const REFERENCE_MODULES = ['refs/menuref.mjs', 'refs/font.mjs', 'refs/settings.mjs'];

export function run_lab(spec, mutant = null) {
  const [label, page, lang, device, u1, cursor, seed] = spec;
  const layout0 = label.includes('evflayout');
  const t0 = performance.now();
  const [lab, r] = MM.run_session(env(), { page, lang, device, u1, cursor, seed, lab_hook: MUTANT_HOOKS.get(mutant) ?? null, store: STORE, evf_layout: layout0, a15: layout0 });
  try {
    // JS-only fault point (checks/lib/pred.mjs): the GUI state's child byte in guest memory set to 0x03 after the menu opened, so
    // lab.state() reads 0x0b03; only group 2's state predicate looks at it
    if (fault('menu-gui-state')) lab.sim.write(lab.sim.u32(MM.GUICALLER) + 1, new Uint8Array([0x03]));
    const draws = lab.menu_draws();
    const [texts, images, fills] = normalise_pass(lab, first_pass(draws));
    const cmds = lab.menu_commands();
    const starts = draws.filter((d) => d.op === 'exec_start').map((d) => d.seq);
    const pass1 = starts.length > 1 ? lab.exec_history.slice(starts[0], starts[1]) : cmds;
    const refused = [];
    for (const e of pass1) {
      const c = e.command;
      if (e.result && c.name === 'BITMAP') {
        const idx = lab.surfaces.findIndex((s) => s.base <= c.dst && c.dst < s.base + 1664 * s.height);
        const off = idx >= 0 ? c.dst - lab.surfaces[idx].base : null;
        refused.push([c.src, idx >= 0 && idx < 6 ? layer_of(idx) : 'kind3', off !== null ? off % 1664 : null, off !== null ? Math.floor(off / 1664) : null]);
      }
    }
    const comp = r.comp;
    const vsc_ref = vsc_compare(lab, mutant === 'vsc-other-device' ? { tft: 'evf', evf: 'tft' }[device] : device, comp, label, layout0 ? ['A15'] : []);
    const engine_errors = new Map();
    for (const e of cmds) if (e.result) inc(engine_errors, F_ERRORS[e.result]);
    const errlog = new Map();
    for (const [c] of lab.kernel.errors) inc(errlog, c);
    const rtos_stub = new Map();
    for (const e of lab.kernel.events) if (e[0] === 'rtos') inc(rtos_stub, e[1]);
    const sp = store_prints(lab);
    const out = { spec, label, page, lang, device, u1, cursor, seed, texts, images, fills, windows: displayed_windows(lab, device, layout0 ? 800 : 900),
      evf_layout: layout0, layout_byte: r.layout_byte, takeover: r.takeover, assumed: comp.header.assumed,
      refused, engine_errors, key_hits: lab.key_hits, comp_status: comp.status, vsc_errors: comp.errors, words: comp.words, vsc_ref,
      state: lab.state(), events: lab.events, rpc: lab.rpc_log.map((x) => [x.entry, x.origin]),
      palettes: draws.filter((d) => d.op === 'palette pending').map((d) => [d.layer, [...d.palette]]),
      palette_kinds: draws.filter((d) => d.op === 'palette kind').map((d) => d.kind),
      settings: lab.settings_log.filter(([, , k]) => k !== 'prop-native').map(([s, v, k]) => [s, v, k]),
      prints: lab.kernel.events.filter((e) => e[0] === 'print').slice(sp.length + (lab.scpu_link?.prints.length ?? 0)), store_prints: sp, link_prints: lab.scpu_link?.prints ?? null, persist: [...lab.store_log.persist],
      store_phases: lab.store_log.phases.map((p) => [p.label, p.ok, p.errlog]), errlog, lab_task: lab.lt.tid,
      started: new Set(lab.lt.started.slice(1).map(K_disasm)), tasks: lab.nk.tasks(), timed: lab.nk.timed_waiters(), init_loaded: lab.init_loaded,
      ctors: lab.ctor_results.filter((c) => c.status !== 'ok'), n_ctors: lab.ctor_results.length,
      routing: new Map(lab.route_log.entries().map(([k, v]) => [[...k], v])), rtos_stub,
      chgwait: [...lab.chgwait], font_log: [...lab.font_log], dropped: [...lab.dropped_sends],
      gui_props: new Map(lab.gui_props.entries().map(([k, v]) => [[...k], v])), prop_device: lab.prop_device,
      unvalued: lab.settings_log.filter(([, v, k]) => k === 'native' && v === null).map(([s, , , c]) => [s, c]),
      gui_hooks: gui_hooks(lab), seconds: (performance.now() - t0) / 1000 };
    resultHook('run_lab', out);
    return out;
  } finally { lab.close(); }
}
const store_prints = (lab) => lab.store_log.phases.flatMap((p) => p.prints);
// Hook runs outside display runs in the bring-up and menu phases, by hook name.
function gui_hooks(lab) {
  const out = new Map();
  for (const [[phase, name, where], n] of lab.stub_hits.entries()) if ((phase === 'bring-up' || phase === 'menu') && where === 'gui') inc(out, name, n);
  return out;
}
// check_display.reference() comparison as a string: 'MISMATCH ...' for a difference or a state the reference does not
// model (check_display.Skip), so either is reported by group 5 / G2, not raised.
export function vsc_compare(lab, device, comp, label, assume = []) {
  try { return CD.compare(lab, device, comp, label, false, assume); } catch (e) {
    if (e instanceof AssertionError) return `MISMATCH ${e.message}`;
    if (e instanceof CD.Skip) return `MISMATCH (check_display.reference does not model this state: ${e.message})`;
    throw e;
  }
}

// Gate G2: the display stack on K-native without a GUI.
export function g2_session(device) {
  const lab = new MM.MenuLab(env(), { inputs: new Map(), key_mode: 'refuse' });
  try {
    lab.kernel_display(device, false);
    const r = lab.call(O.OSDDRAW_INIT);
    if (r.d0 & 0xFFFF) throw new FirmwareError(`osddraw_init returned ${r.d0}`);
    lab.records = [...range(0, 6).map((i) => lab.sim.u32(O.REGISTRY + 8 * i)), O.KIND3_RECORD];
    lab.surfaces = range(0, 7).map((i) => lab.record(i));
    lab.surfaces.forEach((s, slot) => lab.engine.set_guard(slot, s.base, s.stride, s.height));
    lab.set_gui_buffers();
    lab.palettes();
    lab.update();
    const comp = lab.compose(device);
    const ref = vsc_compare(lab, device, comp, `G2 ${device}`);
    const stub = new Map();
    for (const e of lab.kernel.events) if (e[0] === 'rtos') inc(stub, e[1]);
    const out = { device, s_send: s_send_rule(lab), steps: lab.steps.map((s) => s.name), errlog: CD.errlog_counts(lab), comp, ref, chgwait: [...lab.chgwait],
      tasks: lab.nk.tasks(), started: new Set(lab.lt.started.slice(1).map(K_disasm)), routing: new Map(lab.route_log.entries().map(([k, v]) => [[...k], v])), stub };
    resultHook('g2_session', out);
    return out;
  } finally { lab.close(); }
}
// S-SEND by direct calls of the stub with a recording stand-in for hle.finish.
function s_send_rule(lab) {
  class Finish { constructor() { this.done = []; } finish(r, kw = {}) { this.done.push(kw); } }
  const q10 = lab._queue(MM.DROPPED_SENDS[0][0]);
  const problems = [];
  const base = { d0: q10, d1: 10, a0: 0, mdr: runtime(MM.DROPPED_SENDS[0][2]) };
  const f = new Finish();
  lab._sync_send(f, { ...base });
  const last = lab.dropped_sends.slice(-1);
  if (!pred(deepEqual(f.done, [{ d0: 0 }]) && deepEqual(last, [[q10, 10, '0x50045474']]))) problems.push(`listed send not dropped: ${show(f.done)} ${show(lab.dropped_sends)}`);
  for (const bad of [{ ...base, d1: 11 }, { ...base, mdr: runtime(0x50045478) }]) {
    try {
      lab._sync_send(new Finish(), bad);
      if (!pred(false)) problems.push(`unlisted send ${show(bad)} accepted`);
    } catch (e) { if (!(e instanceof MM.MenuError)) throw e; }
  }
  return problems;
}

// ---- mutants (applied before the sessions)
const MUTANT_HOOKS = new Map([
  ['persist-page+1', (lab) => { const v = lab.inputs.get(1882); lab.inputs.set(1882, v < 6 ? v + 1 : 1); }],
  ['no-ctors', (lab) => { lab.run_static_ctors = () => null; }],
  // Since M9 the CPU accepts a presented IRQ at the idle point (kernel.mjs LabTask._idle) before settle's on_idle asks
  // pending_irq(), so the engine IRQ 310 is never left for the harness path there: both paths are cut while settling.
  ['settle-no-irq', (lab) => {
    lab.pending_irq = () => false;
    const intc = lab.nk.intc, levelMask = intc.level_mask.bind(intc);
    intc.level_mask = () => (lab.lt.settling ? 0 : levelMask());
  }],
  ['gui-4513-native', (lab) => {
    const orig = (hle, r) => lab._prop(hle, r);
    lab.hook(D.PROP_GET, (hle, r) => {
      if ((r.d0 & 0xFFFF) === lab.prop_device && !lab.in_display_run()) {
        lab.settings_log.push([lab.prop_device, null, 'prop-native', MM_where(r.mdr)]);
        return lab.passthrough(r);
      }
      return orig(hle, r);
    }, 'prop_get');
  }],
]);
import { where as MM_where } from '../src/lab/hle.mjs';
import { naming } from './lib/procs.mjs';

// ---- reference side
// The reference's store: refs/settings.mjs's blank-store defaults (native) or 0 (empty), overlaid with the session's
// S-PERSIST writes and the seed.
class StoreView {
  constructor(settings, seed, persisted = null) { this.settings = settings; this.seed = new Map([...(persisted ?? []), ...(seed ?? [])]); }
  get(sid, d = 0) {
    if (this.seed.has(sid)) return this.seed.get(sid);
    if (this.settings === null) return d;
    return this.settings.default(sid)[0];
  }
}
class Refs {
  static async load() {
    const MR = await import('../refs/menuref.mjs');
    const S = await import('../refs/settings.mjs');
    REFS_LOADED = true;
    return new Refs(MR, S);
  }
  constructor(MR, S) {
    this.MR = MR;
    this.S = S;
    this.settings = STORE === 'native' ? new S.Settings(loadImage(), { sha256: (b) => createHash('sha256').update(b).digest('hex') }) : null;
    this.cache = new Map();
  }
  store(seed, persisted = null) { return new StoreView(this.settings, seed, persisted); }
  get(lang, layout = 1) {
    const k = `${lang}/${layout}`;
    if (!this.cache.has(k)) this.cache.set(k, new this.MR.Reference({ lang, layout, image: loadImage(), block: loadBlock(), M, R }));
    return this.cache.get(k);
  }
  model(s, kw = {}) {
    const ref = this.get(s.lang, s.evf_layout ? 0 : 1);
    const k = { ...kw };
    if (STORE === 'native' && !('s_rows' in k)) k.s_rows = this.MR.ROW_STATE_DEFAULTS.get(s.page) ?? new Set();
    const persisted = new Map((s.persist ?? []).map((x) => [x.id, x.value]));
    return [ref, ref.page(s.page, s.cursor, this.store(s.seed, persisted), undefined, k.s_rows ?? new Set())];
  }
}

const inside = (rect, box) => box[0] <= rect[0] && box[1] <= rect[1] && rect[2] <= box[2] && rect[3] <= box[3];
const unverified_rects = (model) => model.unverified.map(([, r]) => r);
const masked = (rect, model) => unverified_rects(model).some((u) => inside(rect, u));
const text_rect = (t) => { const [x, y] = t.origin; return [x + t.local[0], y + t.local[1], x + t.local[2], y + t.local[3]]; };
const hexOf = (b) => (b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);

// Group 2: the first pass's DrawText, image-draw and FILL lists equal the reference's, in order, except calls inside
// unverified rects (returned as a count).
export function compare_calls(s, ref, model, elements = null) {
  elements = elements ?? model.elements;
  const problems = [];
  const rt = elements.filter((e) => e.kind === 'text');
  const lt = s.texts.filter((t) => !masked(text_rect(t), model));
  const skipped_t = s.texts.length - lt.length;
  const keys = ['text', 'colour', 's4', 's8', 'align', 'margins', 'edge', 'local', 'origin'];
  let want = rt.map((e) => ({ text: e.data.text, colour: e.data.colour, s4: e.data.s4, s8: e.data.s8, align: [...e.data.align],
    margins: [...e.data.margins], edge: e.data.edge, local: [...e.data.local], origin: [...e.data.origin] }));
  let got = want.length ? lt.map((t) => Object.fromEntries(keys.map((k) => [k, t[k]]))) : lt;
  const first = (g, w) => { const n = Math.min(g.length, w.length); const k = range(0, n).find((i) => !deepEqual(g[i], w[i])); return k === undefined ? n : k; };
  if (!pred(deepEqual(got, want))) {
    const k = first(got, want);
    problems.push(`${s.label}: DrawText ${got.length} calls vs ${want.length} predicted; first difference #${k}: lab ${show(k < got.length ? got[k] : null)} reference ${show(k < want.length ? want[k] : null)}`);
  }
  const bad = lt.filter((t) => t.mode684 !== 0 || !t.attr || t.gc_id !== 1);
  if (!pred(!bad.length)) problems.push(`${s.label}: DrawText gc state (mode 0, attribute gc, gc id 1) differs: ${show(bad[0])}`);
  const ri = elements.filter((e) => e.kind === 'image');
  const li = s.images.filter((i) => !masked([i.x, i.y, i.x, i.y], model));
  const skipped_i = s.images.length - li.length;
  want = ri.map((e) => [e.layer, e.data.data, e.data.x, e.data.y, hexOf(e.data.lut), [0, 0]]);
  got = li.map((i) => [i.layer, i.data, i.x, i.y, i.lut, i.scale]);
  if (!pred(deepEqual(got, want))) {
    const k = first(got, want);
    const g = k < got.length ? got[k] : null, w = k < want.length ? want[k] : null;
    const head = (t) => show(t ? t.slice(0, 4) : null);
    const lutOf = (t) => (t ? (t[4] || '').slice(0, 24) : 'null');
    problems.push(`${s.label}: image draws ${got.length} vs ${want.length} predicted; first difference #${k}: lab ${head(g)} lut ${lutOf(g)} reference ${head(w)} lut ${lutOf(w)}`);
  }
  want = elements.filter((e) => e.kind === 'fill').map((e) => [e.layer, e.data.x, e.data.y, e.data.w, e.data.h, e.data.colour]);
  got = s.fills.map((f) => [f.layer, f.x, f.y, f.w, f.h, f.colour]);
  if (!pred(deepEqual(got, want))) problems.push(`${s.label}: FILLs ${show(got)} vs predicted ${show(want)}`);
  return [problems, skipped_t + skipped_i];
}
export function mask_window(data, rects) {
  const out = Uint8Array.from(data);
  const w = Math.floor(data.length / 600);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.max(y0, 0); y <= Math.min(y1, 599); y++) {
      const a = y * w + Math.max(x0, 0), n = Math.min(x1, w - 1) - Math.max(x0, 0) + 1;
      // a rect that starts right of the window's last column is refused (n < 0); n = 0 clears nothing
      if (n < 0) throw new ValueError('negative count');
      out.fill(0, a, a + n);
    }
  }
  return out;
}
export function compare_buffers(s, raster, model) {
  const problems = [];
  const rects = unverified_rects(model);
  for (let layer = 0; layer < 3; layer++) {
    const got = mask_window(s.windows.get(layer), rects), want = mask_window(raster.window(layer), rects);
    if (!pred(bytesEq(got, want))) {
      const w = Math.floor(want.length / 600);
      if (got.length !== want.length) { problems.push(`${s.label}: GUI layer ${layer} window ${got.length} bytes, reference ${want.length}`); continue; }   // not a predicate: the message of the one above
      let i = 0;
      while (got[i] === want[i]) i++;
      let n = 0;
      for (let k = 0; k < got.length; k++) if (got[k] !== want[k]) n++;
      problems.push(`${s.label}: GUI layer ${layer} window differs in ${n} bytes, first at x=${i % w} y=${Math.floor(i / w)}: lab ${got[i]} reference ${want[i]}`);
    }
  }
  return problems;
}
function masked_area(model) {
  const rects = unverified_rects(model);
  if (!rects.length) return 0;
  return mask_window(new Uint8Array(540000).fill(1), rects).filter((b) => b === 0).length;
}
// VSC PAL_UNWRITTEN count of the displayed OSD plane of a GUI layer: every index >= 128 in the window is unwritten.
const predicted_unwritten = (raster, layer = 1) => raster.window(layer).filter((b) => b >= 128).length;

// ---- notes
// Group 10's comparison of the notes: notes and got are Maps kind -> Set; a problem line per kind that differs, in
// kind order.
// the hex strings of xs sorted as strings ('0x50123456' before '0x8959'), not the numbers
export const hex_sorted = (xs) => sortStr([...xs].map((x) => '0x' + x.toString(16)));
export function notes_problems(notes, got) {
  const out = [];
  for (const kind of sortStr(new Set([...notes.keys(), ...got.keys()]))) {
    const a = notes.get(kind) ?? new Set(), b = got.get(kind) ?? new Set();
    if (!pred(setEq(a, b))) out.push(`${kind}: new ${show(sortStr([...b].filter((x) => !a.has(x))).slice(0, 3))} missing ${show(sortStr([...a].filter((x) => !b.has(x))).slice(0, 3))}`);
  }
  return out;
}
function read_notes(file = NOTES_FILE) {
  const out = new Map();
  if (fs.existsSync(file)) {
    for (const line of splitlines(fs.readFileSync(file, 'utf8'))) {
      if (line && !line.startsWith('#')) {
        const sp = line.indexOf(' ');
        if (sp < 0) throw new ValueError(`${file}: ${show(line)}: a note line is 'KIND TEXT'`);
        const kind = line.slice(0, sp);
        if (!out.has(kind)) out.set(kind, new Set());
        out.get(kind).add(line.slice(sp + 1));
      }
    }
  }
  return out;
}

// ---- --jobs: worker_threads
async function* pool_map(jobs, workers) {
  const n = Math.min(workers, jobs.length);
  const pending = new Map();
  let next = 0, dead = null;
  const results = jobs.map(() => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; });
  const pool = [];
  const dispatch = (w) => {
    if (next >= jobs.length) { w.terminate(); return; }
    const k = next++;
    pending.set(w, k);
    w.postMessage({ k, job: encode(jobs[k]) });
  };
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url), { env: { ...process.env, OM_STATS: '' }, workerData: { entry: 'check_menu' }, stdout: false, stderr: false });
    w.on('message', (m) => { results[m.k].resolve(m); pending.delete(w); dispatch(w); });
    w.on('error', (e) => { dead ??= e; for (const k of [...pending.values()]) results[k].resolve({ k, crash: String(e?.stack ?? e) }); pending.delete(w); });
    w.on('exit', (code) => { if (pending.has(w)) { const k = pending.get(w); pending.delete(w); results[k].resolve({ k, died: code }); } });
    pool.push(w);
    dispatch(w);
  }
  try {
    for (let k = 0; k < jobs.length; k++) {
      const m = await results[k].p;
      if (m.died !== undefined) {
        const first = jobs[k][2][0];
        throw new SystemExit(`FAILED: a --jobs worker process died before job ${jobs[k][1]} ${Array.isArray(first) ? first[0] : first} returned (exit ${m.died})`);
      }
      if (m.crash !== undefined) throw new Error(`--jobs worker: ${m.crash}`);
      yield [decode(m.value), m.out, m.err, m.guard];
    }
  } finally { for (const w of pool) w.terminate(); }
}
const JOB_FUNCTIONS = { run_lab, g2_session };
// One lab job in a worker: [['ok', value] or ['error', message], stdout, stderr, whether a reference module was
// imported in the worker before or after the job].
async function workerMain() {
  parentPort.on('message', ({ k, job }) => {
    const [, name, args] = decode(job);
    const before = REFS_LOADED;
    let value;
    try { value = ['ok', JOB_FUNCTIONS[name](...args)]; } catch (e) {
      if (e instanceof FirmwareError || isValueError(e)) value = ['error', e.message];
      else { flushCoverage(); parentPort.postMessage({ k, crash: String(e?.stack ?? e) }); return; }
    }
    flushCoverage();                   // OM_COVERAGE: the pool may terminate this worker without an exit event
    parentPort.postMessage({ k, value: encode(value), out: '', err: '', guard: before || REFS_LOADED });
  });
}

export async function check(mode = 'default', write_notes = false) {
  const mutant = process.env.OM_MENU_MUTANT || null;
  if (mutant && !MUTANTS.has(mutant)) throw new SystemExit(`unknown mutant ${show(mutant)}`);
  if (write_notes && (mode !== 'default' || mutant || STORE !== 'native')) throw new SystemExit('--write-notes: the notes pin the default matrix; run it without --quick/--full/a mutant');
  const t0 = performance.now();
  const failures = [], notes_out = [];
  const group = (name, problems, ran = true, why = null) => {
    if (!ran && !problems.length) { console.log(`[skip] ${name}: ${why || `no session of this kind in ${mode} mode`}`); return; }
    console.log(`[${pred(!problems.length) ? 'ok' : 'FAIL'}] ${name}`);
    for (const p of problems) console.log('      ' + cut(p, 600));
    failures.push(...problems);
  };

  // ---- 0. offline
  const p0 = [];
  const img = new M.Image(loadImage());
  try { M.check(img); } catch (e) { if (!(e instanceof AssertionError)) throw e; if (!pred(false)) p0.push(`src/lab/menudata.mjs check: ${e.message}`); }
  const t = M.tab_entry(img, MM.SETUP_TAB);
  const strings = new M.Strings(LANGS, loadImage(), loadBlock());
  const handlers = M.custom_value_handlers(img);
  let rows = 0;
  for (const page_id of t.pages.slice(0, 6)) {
    const g = M.groups(img).get(page_id);
    for (const lab_item of g.labels) {
      rows += 1;
      for (const lang of LANGS) if (!pred(M.render(lab_item, strings, lang))) p0.push(`page 0x${page_id.toString(16)} mode ${lab_item.key}: empty ${lang} label`);
      const mode_ = lab_item.key;
      if (!pred(!(g.values.has(mode_) && !handlers.has(mode_) && !g.values.get(mode_).length))) p0.push(`page 0x${page_id.toString(16)} mode ${mode_}: empty value list`);
    }
  }
  try {
    MM.validate_seed(img, M.page_of(img, MM.SETUP_TAB, 5)[0], BAD_SEED);
    if (!pred(false)) p0.push(`seed ${show(BAD_SEED)} accepted`);
  } catch (e) { if (!isValueError(e)) throw e; }
  if (!pred(deepEqual(MM.validate_seed(img, M.page_of(img, MM.SETUP_TAB, 5)[0], SEED), SEED))) p0.push('seed not accepted as given');

  // ---- lab sessions
  const specs = sessions(mode);
  const results = [], crashed = [], g2 = [];
  const sessionLine = (lbl, v) => console.log(`  session ${lbl}: ${v.texts.length} DrawText, ${v.images.length} image draws, ${v.comp_status}, ${v.seconds.toFixed(1)} s`);
  if (JOBS > 1) {
    const jobs = specs.map((spec) => ['check_menu', 'run_lab', [spec, mutant]]);
    if (mode !== 'quick') for (const device of ['tft', 'evf']) jobs.push(['check_menu', 'g2_session', [device]]);
    let k = 0;
    for await (const [[status, value], out, err, guard] of pool_map(jobs, JOBS)) {
      const [, name, args] = jobs[k++];
      process.stdout.write(out);
      process.stderr.write(err);
      if (!pred(!guard)) failures.push('refs/menuref.mjs, refs/font.mjs or refs/settings.mjs imported while lab sessions run');
      if (name === 'g2_session') {
        if (status === 'ok') g2.push(value); else crashed.push(`G2 ${args[0]}: ${cut(value, 400)}`);
      } else if (status === 'ok') { results.push(value); sessionLine(args[0][0], value); }
      else { crashed.push(`session ${args[0][0]}: ${cut(value, 400)}`); console.log(`  session ${args[0][0]}: FAILED ${cut(value, 200)}`); }
    }
  }
  for (const spec of JOBS <= 1 ? specs : []) {
    if (!pred(!REFS_LOADED)) failures.push('refs/menuref.mjs, refs/font.mjs or refs/settings.mjs imported while lab sessions run');
    try {
      results.push(run_lab(spec, mutant));
      sessionLine(spec[0], results.at(-1));
    } catch (e) {
      if (!(e instanceof FirmwareError || isValueError(e))) throw e;
      crashed.push(`session ${spec[0]}: ${cut(e.message, 400)}`);
      console.log(`  session ${spec[0]}: FAILED ${cut(e.message, 200)}`);
    }
  }
  if (mode !== 'quick' && JOBS <= 1) {
    for (const device of ['tft', 'evf']) {
      try { g2.push(g2_session(device)); } catch (e) {
        if (!(e instanceof FirmwareError || isValueError(e))) throw e;
        crashed.push(`G2 ${device}: ${cut(e.message, 400)}`);
      }
    }
  }
  if (crashed.length) group('sessions', crashed);
  if (!results.length) {
    console.log(`FAILED: no session ran (${Math.round((performance.now() - t0) / 1000)} s)`);
    return 1;
  }
  if (process.env.OM_COMPOSITES) {
    const doc = {};
    for (const r of [...results].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))) doc[r.label] = r.words.length ? wordsSha(r.words) : null;
    fs.writeFileSync(process.env.OM_COMPOSITES, JSON.stringify(doc, null, 1));
  }
  if (!pred(!REFS_LOADED)) failures.push('reference imported before the sessions ended');
  const refs = await Refs.load();
  const FT = await import('../refs/font.mjs');
  p0.push(...alignment_vectors(FT), ...cursor_range(refs), ...lut_rule(refs));
  group(`0 offline: src/lab/menudata.mjs structural checks; ${rows} rows of Setup pages 1-6 resolve in ${LANGS.join('/')}; seed validation (${show(BAD_SEED)} refused); DrawText step-7 vectors incl. odd negative centrings and empty `
    + 'boxes (refs/font.mjs align_box); the reference refuses cursor values outside 1..rows, tabs other than Setup and type-4 records with string id 0; the bitmap LUT word rule (0x510bc612..75)', p0);
  const by = new Map(results.map((r) => [r.label, r]));
  const first = results[0];

  // ---- 1. bring-up and G2
  const p1 = [];
  for (const r of results) {
    if (!pred(r.lab_task === 160)) p1.push(`${r.label}: lab task ${r.lab_task}`);
    // with the native store, PER_SCPU too, started at the store init over the sub-CPU link (src/lab/scpulink.mjs),
    // whose start prints the firmware's "SCPU RST!" and leaves the task waiting
    const link = r.link_prints !== null;
    if (!pred(setEq(r.started, link ? new Set([...STARTED, PER_SCPU_TASK]) : STARTED))) p1.push(`${r.label}: tasks started ${show(hex_sorted(r.started))}`);
    if (link && !pred(deepEqual(r.link_prints, ['SCPU RST!']))) p1.push(`${r.label}: PER_SCPU's start printed ${show(r.link_prints)}`);
    const live = [...r.tasks].filter(([, [, st]]) => st !== 'DMT').map(([, [, st]]) => st);
    if (!pred(deepEqual(sortStr(live), ['RUN', 'WAI', 'WAI', 'WAI', 'WAI', ...(link ? ['WAI'] : [])]) && !r.timed.length)) p1.push(`${r.label}: task states ${show(r.tasks)} timed ${show(r.timed)}`);
    if (!pred(!r.prints.length)) p1.push(`${r.label}: kernel prints ${show(r.prints.slice(0, 3))}`);
    if (!pred(!r.ctors.length && r.n_ctors === 112)) p1.push(`${r.label}: CTORS ${r.n_ctors} run, failed ${show(r.ctors.slice(0, 2))}`);
    const extraStub = [...r.rtos_stub.keys()].filter((k) => !['OlyTaSS', 'iOlyEvSt', 'OlyEvCl', 'OlyEvWt'].includes(k));
    if (!pred(!extraStub.length)) p1.push(`${r.label}: RTOS wrapper stand-ins outside the vsync flags / display clock: ${showCounts(r.rtos_stub)}`);
    if (!pred(!r.chgwait.length)) p1.push(`${r.label}: S-CHGWAIT used on K-native ${show(r.chgwait)}`);
    if (!pred(deepEqual(r.dropped, DROPPED))) p1.push(`${r.label}: S-SEND drops ${show(r.dropped)}, expected ${show(DROPPED)}`);
    const props = [...r.gui_props.keys()];
    const propOk = props.some((k) => k[0] === r.prop_device && k[1] === '0x503eff61') && props.every((k) => k[0] === r.prop_device && PROP_SITES.has(k[1]));
    if (!pred(propOk)) p1.push(`${r.label}: S-PROP reads ${show(r.gui_props)}`);
    if (STORE === 'native' && !pred(deepEqual(r.store_prints, MM.REGISTRY_PRINTS) && !r.store_phases.some(([, ok, err]) => !ok || err.length))) {
      p1.push(`${r.label}: store init prints ${show(r.store_prints)}, phases ${show(r.store_phases)}`);
    }
    if (!pred(!r.unvalued.length)) p1.push(`${r.label}: native settings reads without a recorded value ${show(r.unvalued.slice(0, 3))}`);
    const extra = [...r.gui_hooks.keys()].filter((n) => !GUI_PATH_HOOKS.has(n) && !n.endsWith('(native)') && !n.endsWith('(scoped)'));
    if (!pred(!extra.length)) p1.push(`${r.label}: hooks on the GUI path not listed as stand-ins: ${show(sortStr(extra))}`);
    notes_out.push(`PROP4513 ${r.label} ` + [...r.gui_props].sort((a, b) => cmpItems(a[0][1], b[0][1])).map(([[, site], n]) => `${site}:${n}`).join(' '));
  }
  const langs = new Map(R.languages(img.d, loadBlock()).map((e) => [e.lang, e]));
  const want_loaded = [[langs.get(first.lang).font_record, 0], [langs.get(first.lang).strings_record, 2], [0, 1]];
  if (!pred(deepEqual(first.init_loaded, want_loaded))) p1.push(`S-RES calls ${show(first.init_loaded)}, expected ${show(want_loaded)}`);
  for (const g of g2) {
    if (!pred(!(g.ref.startsWith('MISMATCH') || g.comp.status !== 'NONE' || g.comp.error_total))) p1.push(`G2 ${g.device}: composite ${g.comp.status} ${g.comp.error_total} errors; ${cut(g.ref, 300)}`);
    if (!pred(deepEqual(g.errlog, CD.ERRLOG[g.device]))) p1.push(`G2 ${g.device}: error log ${show(g.errlog)} != check_display ${show(CD.ERRLOG[g.device])}`);
    if (!pred(!g.chgwait.length)) p1.push(`G2 ${g.device}: S-CHGWAIT used`);
    if (!pred(setEq(g.started, new Set([MM.CHANGE_TASK, MM.EMPTY_TASK])))) p1.push(`G2 ${g.device}: tasks started ${show(hex_sorted(g.started))}`);
    p1.push(...g.s_send.map((x) => `G2 ${g.device}: S-SEND rule: ${x}`));
  }
  group('1 bring-up on K-native: lab task 160, only allowed tasks started (CHANGE, empty display task 70, GUI_TASK, Genifa timer, HLS_EYEFI; with the native store PER_SCPU, whose start prints SCPU RST!) and all waiting forever, no kernel print, 112 constructors, src/lab/text.mjs\'s post-init '
    + 'checks; S-SEND drops only queue 10 cmd 10 from 0x50045474, S-PROP only from 0x503eff61, every native settings read has its value, no unlisted hook on the GUI path'
    + (g2.length ? '; G2: DISPLAY OPEN tft/evf on K-native (the CHANGE task native up to its first receive), empty-GUI composite == check_display.reference(), error log == check_display\'s, S-SEND rule'
      : '; G2 not run in this mode'), p1);

  // ---- 2. calls
  const p2 = [], models = new Map(), skipped = new Map();
  for (const r of results) {
    const [ref, model] = refs.model(r);
    models.set(r.label, [ref, model]);
    const [probs, n] = compare_calls(r, ref, model);
    p2.push(...probs);
    skipped.set(r.label, n);
    if (!pred(r.state === MM.STATE_MENU)) p2.push(`${r.label}: GUI state 0x${r.state.toString(16).padStart(4, '0')}`);
    const pal = new Map(r.palettes.map(([layer, ids]) => [layer, ids]));
    const want_pal = [[0, 86], [1, 87], [2, 85]];
    if (!pred(!(want_pal.some(([k, v]) => !(pal.get(k) ?? []).includes(v)) || !r.palette_kinds.includes(PALETTE_KIND)))) p2.push(`${r.label}: palettes ${show(r.palettes)} kinds ${show(r.palette_kinds)}`);
    if (!pred(deepEqual(sortStr(new Set(r.rpc.map(([, o]) => o))), ['background-jpeg', 'finder-style']))) p2.push(`${r.label}: RPC origins ${show(r.rpc)}`);
  }
  group(`2 calls of the first paint pass == reference: DrawText (text, colour, +4/+8, align, margins, edge, box, origin, gc), image draws (layer, data, screen x/y, LUT bytes, no scaling), FILLs; palettes 86/87/85 by kind 8; `
    + `RPC from the two expected call sites; state 0x0b02 (${[...skipped.values()].reduce((a, b) => a + b, 0)} calls in unverified cells not compared)`, p2);

  // ---- 3. buffers A/B
  const p3 = [], rasters = new Map();
  for (const r of results) {
    if (r.u1 !== 'skip' && r.u1 !== 'write') continue;
    const [ref, model] = models.get(r.label);
    const raster = new refs.MR.Raster(ref, r.u1).run(model.elements);
    rasters.set(r.label, raster);
    p3.push(...compare_buffers(r, raster, model));
  }
  group('3 displayed GUI buffers (900x600 windows of OSD1/2/3) == reference raster under U1 A (skip) and B (write), unverified cells masked', p3);

  // ---- 4. refuse
  const p4 = [];
  for (const r of results) {
    if (r.u1 !== 'refuse') continue;
    const [ref, model] = models.get(r.label);
    const raster = new refs.MR.Raster(ref, 'refuse').run(model.elements);
    const refusedKeys = new Set(raster.refused.map((x) => JSON.stringify(x)));
    const want = new Map();
    for (const e of model.elements) {
      if (e.kind === 'image' && refusedKeys.has(JSON.stringify(['image', e.child]))) { const t4 = [e.data.data, e.layer, e.data.x, e.data.y]; want.set(JSON.stringify(t4), t4); }
      else if (e.kind === 'text') {
        ref.glyphs(e).forEach((it, n) => { if (refusedKeys.has(JSON.stringify(['text', e.child, n]))) { const t4 = [it.header, e.layer, it.x, it.y]; want.set(JSON.stringify(t4), t4); } });
      }
    }
    const got = new Map();
    for (const x of r.refused) if (x[1] !== 'kind3' && !masked([x[2], x[3], x[2], x[3]], model)) got.set(JSON.stringify(x), x);      // not a predicate: the lab's unmasked refusals, compared whole with the prediction below
    const got_k3 = r.refused.filter((x) => x[1] === 'kind3');
    const got_masked = r.refused.length - got.size - got_k3.length;
    if (!pred(got.size === want.size && [...got.keys()].every((k) => want.has(k)))) {
      p4.push(`${r.label}: refused direct BITMAPs: ${got.size} vs ${want.size} predicted; lab only ${show(sortedItems([...got].filter(([k]) => !want.has(k)).map(([, v]) => v)).slice(0, 3))}, reference only ${show(sortedItems([...want].filter(([k]) => !got.has(k)).map(([, v]) => v)).slice(0, 3))}`);
    }
    if (!pred(![...r.engine_errors.keys()].some((k) => k !== 'BMP_TRANSPARENCY'))) p4.push(`${r.label}: engine errors ${showCounts(r.engine_errors)}`);
    notes_out.push(`REFUSE ${r.label} first pass: direct ${got.size} as predicted, ${got_masked} in unverified cells, ${got_k3.length} on the kind-3 path (not predicted)`);
  }
  group('4 default U1 model (refuse): refused BITMAPs drawn directly into a layer == reference prediction; no other engine error (kind-3 path refusals counted, not predicted)', p4, results.some((r) => r.u1 === 'refuse'));

  // ---- 5. composites and U1 report
  const p5 = [];
  for (const r of results) {
    if (!pred(!r.vsc_ref.startsWith('MISMATCH'))) p5.push(`${r.label}: ${cut(r.vsc_ref, 300)}`);
    const names = r.vsc_errors.map((e) => e.name);
    if (!pred(!(r.comp_status !== 'NONE' || !deepEqual(names, ['PAL_UNWRITTEN']) || !deepEqual(r.vsc_errors[0].args.slice(0, 2), [4, 255])))) {
      p5.push(`${r.label}: composite ${r.comp_status}, VSC errors ${show(r.vsc_errors.map(D.format_vsc_error))}`);
    }
    const raster = rasters.get(r.label);
    const [, model] = models.get(r.label);
    if (raster && !model.unverified.length && r.device === 'tft' && r.vsc_errors.length) {
      const want = predicted_unwritten(raster);
      if (!pred(r.vsc_errors[0].value === want)) p5.push(`${r.label}: PAL_UNWRITTEN count ${r.vsc_errors[0].value}, predicted ${want}`);
    }
  }
  for (const r of results) {
    if (r.u1 !== 'skip' || r.device !== 'tft' || (r.seed && r.seed.size) || r.cursor !== 1) continue;
    const b = by.get(r.label.slice(0, -1) + 'B');
    if (b === undefined) continue;
    let n = 0;
    for (let i = 0; i < Math.min(r.words.length, b.words.length); i++) if (r.words[i] !== b.words[i]) n++;
    notes_out.push(`U1 ${r.label.slice(0, -2)} ${n}`);
  }
  group('5 composites == check_display.reference() of the buffers; the only VSC error is PAL_UNWRITTEN for OSD2 index 255 with the predicted count; U1 A/B difference per page pinned (notes)', p5);

  // ---- 6. EVF
  const p6 = [];
  for (const r of results) {
    if (r.device !== 'evf') continue;
    if (r.evf_layout) {
      const tk = r.takeover || {};
      const conn = tk.connect || {};
      const tft = by.get(r.label.replace('-evflayout', ''));
      if (!pred(!(r.layout_byte !== 0 || !deepEqual(conn.after ?? null, EVF_CONNECT_AFTER[STORE]) || (conn.rpc ?? []).length || !(r.assumed & 1)))) {
        p6.push(`${r.label}: mode byte ${r.layout_byte}, H-CONNECT ${show(conn.after ?? null)} rpc ${show(conn.rpc ?? null)}, composite assumed ${r.assumed}`);
      }
      const sameAsTft = tft !== undefined && range(0, 3).every((k) => {
        const crop = new Uint8Array(800 * 600), w = tft.windows.get(k);
        for (let y = 0; y < 600; y++) crop.set(w.subarray(y * 900, y * 900 + 800), y * 800);
        return bytesEq(r.windows.get(k), crop);
      });
      if (!pred(!(tft === undefined || sameAsTft))) p6.push(`${r.label}: the layout-0 buffers equal the layout-1 buffers (or no TFT session)`);
      notes_out.push(`EVFLAYOUT ${r.label} mode byte ${r.layout_byte} after H-CONNECT ${show(conn.after ?? null)} composite sha256 ${wordsSha(r.words)}`);
      continue;
    }
    const tft = by.get(r.label.replace('-evf', ''));
    if (!pred(tft !== undefined)) { p6.push(`${r.label}: no TFT session to compare`); continue; }
    for (let layer = 0; layer < 3; layer++) if (!pred(bytesEq(r.windows.get(layer), tft.windows.get(layer)))) p6.push(`${r.label}: GUI layer ${layer} buffer differs from the TFT session's`);
  }
  group('6 EVF: without the B2 inputs the TFT layout (same GUI buffers as the TFT session, composite == reference); with S-TAKEOVER and H-CONNECT (p1-en-evflayout-A) mode byte 0 at the menu, the 800-wide layout-0 buffers == '
    + 'refs/menuref.mjs (layout 0) (groups 2/3), composite == reference under A15 (group 5)', p6, results.some((r) => r.device === 'evf'));

  // ---- 7. seed
  const p7 = [];
  for (const r of results) {
    if (!r.seed || !r.seed.size) continue;
    if (STORE === 'native') {
      const persisted = new Map(r.persist.filter((x) => x.why === 'seed').map((x) => [x.id, x.after]));
      const reads = new Map(r.settings.filter(([s, , k]) => k === 'native' && r.seed.has(s)).map(([s, v]) => [s, v]));
      if (!pred(deepEqual(persisted, r.seed) && deepEqual(reads, r.seed))) p7.push(`${r.label}: S-PERSIST seed ${show(persisted)}, native reads ${show(reads)}, seed ${show(r.seed)}`);
    } else {
      const reads = new Map(r.settings.filter(([, , k]) => k === 'seed').map(([s, v]) => [s, v]));
      if (!pred(setEq(new Set(reads.keys()), new Set(r.seed.keys())))) p7.push(`${r.label}: seed reads ${show(reads)}`);
    }
    const [, model] = models.get(r.label);
    const texts = model.elements.filter((e) => e.kind === 'text').map((e) => e.data.text);
    const images = model.elements.filter((e) => e.kind === 'image').map((e) => e.data.image);
    for (const want of ['Body Battery', 'Hold', '1min', '4h']) if (!pred(texts.includes(want))) p7.push(`${r.label}: reference has no ${show(want)}`);
    if (!pred(images.includes(6440))) p7.push(`${r.label}: reference has no image 6440`);
  }
  group(`7 seeded store ${show(SEED)} on page 5: calls and buffers as predicted (groups 2/3); "Body Battery", image 6440, "Hold", "1min", "4h"`, p7, results.some((r) => r.seed && r.seed.size));

  // ---- 8. cursor
  const p8 = [];
  for (const r of results) {
    if (r.cursor === 1) continue;
    const [ref, model] = models.get(r.label);
    const base = ref.page(r.page, 1, refs.store(r.seed), undefined, STORE === 'native' ? refs.MR.ROW_STATE_DEFAULTS.get(r.page) ?? new Set() : new Set());
    const diff = new Set();
    const n = Math.min(model.elements.length, base.elements.length);
    for (let i = 0; i < n; i++) if (!deepEqual(model.elements[i].toJSON(), base.elements[i].toJSON())) diff.add(model.elements[i].child);      // not a predicate: the elements that changed, compared whole with the allowed rows below
    const allowed = new Set(range(1, 8));
    if (STORE === 'native') {
      for (const row of refs.MR.ROW_STATE_DEFAULTS.get(r.page) ?? []) if (row === r.cursor - 1) for (const c of [41 + row, 48 + row, 55 + row, 62 + row]) allowed.add(c);      // not a predicate: the allowed row backgrounds (reference data)
    }
    if (!pred(diff.size && [...diff].every((c) => allowed.has(c)))) p8.push(`${r.label}: reference elements changed outside the row backgrounds: ${show(sortedItems(diff))}`);
  }
  group('8 cursor rows 3 (page 1) and 7 (page 5): only the row backgrounds change (state and LUT), and on a row with s != 0 its label and value style (7 -> 8); calls and buffers as predicted (groups 2/3)', p8, results.some((r) => r.cursor !== 1));

  // ---- 9. negative controls
  const p9 = negative_controls(refs, by, models, rasters);
  group('9 negative controls, each detected: values left-aligned, value list next entry, colour 22 for style 1, row pitch 63, identity LUT on the cursor bar'
    + (by.has('p1-ja-B') ? ', ja page 1 A reference against B lab' : ' (ja A-against-B control: no p1-ja-B)'), p9);

  // ---- 10. unverified
  const p10 = [];
  for (const r of results) {
    const [, model] = models.get(r.label);
    if (r.device === 'tft' && r.u1 === 'skip') {
      const cells = new Map();
      for (const [c, , why] of model.unverified) { const t2 = [c, why.split(':')[0]]; cells.set(JSON.stringify(t2), t2); }
      const sorted = sortedItems([...cells.values()]);
      if (sorted.length) notes_out.push(`UNVERIFIED ${r.label} ${masked_area(model)} px: ` + sorted.map(([c, w]) => `${c} (${w})`).join(', '));
    }
    notes_out.push(`ERRLOG ${r.label} ` + sortNum(r.errlog.keys()).map((c) => `0x${c.toString(16).padStart(8, '0')}x${r.errlog.get(c)}`).join(' '));
  }
  const notesFile = process.env.OM_NOTES_DIR && write_notes ? path.join(process.env.OM_NOTES_DIR, 'check_menu_notes.txt') : NOTES_FILE;
  const notes = read_notes();
  const got = new Map();
  for (const line of notes_out) {
    const sp = line.indexOf(' '), kind = line.slice(0, sp);
    if (!got.has(kind)) got.set(kind, new Set());
    got.get(kind).add(line.slice(sp + 1));
  }
  if (write_notes) {
    fs.mkdirSync(path.dirname(notesFile), { recursive: true });
    fs.writeFileSync(notesFile, '# check_menu pinned observations (regenerate with --write-notes)\n'
      + '# UNVERIFIED <session> <masked px>: cells the reference does not predict (R5, R6); "row N" is the 0-based row index\n'
      + '# PROP4513 <session> <return site>:<count>...: S-PROP answers per return site (property 4513: 0x503eff61 the GUI gate, 0x503d72c5 and 0x503d2551 reached once the descriptor hash exists)\n'
      + '# U1 <page-lang> <pixels where the A and B composites differ>\n'
      + '# REFUSE <session>: BMP_TRANSPARENCY refusals in the default model\n'
      + '# ERRLOG <session>: firmware error-log calls by code\n'
      + sortStr(notes_out).join('\n') + '\n');
    console.log(`wrote ${notesFile}`);
  } else if (mode === 'default' && STORE === 'native') {
    p10.push(...notes_problems(notes, got));
  }
  group('10 unverified cells, U1 differences, refusals, error-log and S-PROP counts == check_menu_notes.txt', p10, mode === 'default' && STORE === 'native',
    'the notes pin the default matrix with the native store and are compared only there');

  const passed = pred(!failures.length);
  console.log(`${passed ? 'all groups passed' : 'FAILED'} (${failures.length} problem(s), ${results.length} sessions${g2.length ? ' + G2' : ''}, ${Math.round((performance.now() - t0) / 1000)} s)`);
  return passed ? 0 : 1;
}
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// DrawText step 7 by hand against refs/font.mjs align_box with a stub font of fixed advances.
function alignment_vectors(FT) {
  const G = (w) => ({ width: w, box_w: w, lsb: 0, rsb: 0, pad_l: 0, pad_r: 0 });
  const glyphs = new Map([...'ABCDEFGHIJ'].map((c) => [c.charCodeAt(0), G(10)]));
  const font = { glyphs, lookup: (c) => glyphs.get(c), lookup_next: (c) => (c === 0 || c === 10 || c === 13 ? 'end' : glyphs.get(c) ?? null) };
  const problems = [];
  const div = (a, b) => Math.floor(a / b);
  const cases = [
    ['ABC', [0, 0, 289, 61], [2, 1], [0, [260]]],
    ['AB', [10, 0, 30, 61], [1, 0], [0, [10 + div(21 - 20, 2)]]],
    ['ABC', [0, 0, 100, 199], [0, 2], [200 - 62, [0]]],
    ['AB\r\nABCD', [0, 0, 99, 199], [1, 1], [div(200 - 124, 2), [40, 30]]],
    ['ABCDEFGHIJ', [0, 0, 49, 61], [1, 1], [0, [-25]]],
    ['ABCDEFGHIJ', [0, 0, 50, 61], [1, 0], [0, [-24]]],
    ['AB', [0, 0, 99, 60], [0, 1], [0, [0]]],
    ['ABC', [0, 0, 32, 61], [1, 1], [0, [1]]],
    ['ABC\r\n', [0, 0, 99, 199], [0, 1], [div(200 - 62, 2), [0]]],
    ['ABC\n', [0, 0, 99, 199], [0, 2], [200 - 62, [0]]],
    ['AB\r\n\r\n', [0, 0, 99, 199], [2, 1], [div(200 - 124, 2), [80, 100]]],
    ['AB\n\x1f', [0, 0, 99, 199], [0, 2], [200 - 62, [0]]],
    ['', [0, 0, 99, 199], [0, 0], [0, []]],
    ['A', [10, 0, 5, 99], [0, 0], [0, []]],
    ['A', [0, 0, 99, -1], [0, 1], [0, []]],
    ['A', [7, 7, 7, 7], [1, 1], [7 + div(1 - 62, 2) + 1, [7 + div(1 - 10, 2) + 1]]],
  ];
  const tup = (v) => (Array.isArray(v) ? [...v] : v);
  for (const [text, box, align, want] of cases) {
    const got = FT.align_box(font, null, text, box, align, 62, 0);
    if (!pred(deepEqual(got[0], want[0]) && deepEqual(got[1], want[1]))) problems.push(`align ${show(text)} ${show(tup(box))} ${show(tup(align))}: ${show([got[0], got[1]])} != ${show([want[0], want[1]])}`);
  }
  try {
    FT.align_box(font, null, 'A', [0, 0, 99, 99], [0, 1], 0, 0);
    if (!pred(false)) problems.push('align_box predicts a line height of 0');
  } catch (e) { if (!isValueError(e)) throw e; }
  if (!pred(FT.div0(-7, 2) === -3 && FT.div0(7, -2) === -3)) problems.push('div0 does not truncate toward zero');
  return problems;
}

// The GPI bitmap callback's u8 table (0x510bc5e0..0x510bc675) against refs/menuref.mjs lut_bytes.
function lut_rule(refs) {
  const ref = refs.get('en'), problems = [];
  const nonzero = [];
  for (let lut = 0; lut < 1000; lut++) {
    const a = M.LUT_TABLE + 12 * lut;
    const n = ref.img.u32(a), ptr = ref.img.u32(a + 8);
    if (ptr && !(ptr >= 0x61000000 && ptr < 0x62000000)) break;
    if (ptr) {
      if (!pred(n === 256)) problems.push(`LUT ${lut}: n = ${n}, not 256`);
      else if (ref.img.u8(ptr)) nonzero.push([lut, ref.img.u8(ptr)]);      // not a predicate: the maps with map[0] != 0 (image data), counted below
    }
  }
  if (!pred(nonzero.length === 12)) problems.push(`${nonzero.length} maps with map[0] != 0, expected 12: ${show(nonzero.map((x) => [...x]))}`);
  for (const [lut, m0] of nonzero) {
    for (const [word, want] of [[0, m0], [m0, 0]]) {
      const got = ref.lut_bytes(lut, 0, { kind: 14, word20: word })[0];
      if (!pred(got === want)) problems.push(`LUT ${lut} word ${word}: table[0] = ${got}, want ${want}`);
    }
  }
  const [lut] = nonzero.length ? nonzero[0] : [27, 0];
  const realU32 = ref.img.u32;
  ref.img.u32 = (a) => (a === M.LUT_TABLE + 12 * lut ? 16 : realU32.call(ref.img, a));
  try {
    const mp = range(0, 16).map((i) => ref.img.u8(realU32.call(ref.img, M.LUT_TABLE + 12 * lut + 8) + i));
    for (const word of [3, 16, 200, 0x100 + 200]) {
      const table = ref.lut_bytes(lut, 0, { kind: 14, word20: word });
      const want = Uint8Array.from([...mp.map((v) => (v === word ? 0 : v)), ...range(16, 256)]);
      if ((word & 0xFF) >= 16) want[word & 0xFF] = 0;
      if (!pred(bytesEq(table, want))) problems.push(`LUT ${lut} cut to 16, word 0x${word.toString(16)}: table differs at ${show(range(0, 256).filter((i) => table[i] !== want[i]).slice(0, 4))}`);
      const untyped = ref.lut_bytes(lut, 0, { kind: 12, word20: word });
      if (!pred(bytesEq(untyped, Uint8Array.from([...mp, ...range(16, 256)])))) problems.push(`LUT ${lut} cut to 16, untyped record: a word rule applied`);
    }
  } finally { ref.img.u32 = realU32; }
  return problems;
}

// The reference models cursor-memory values 1..rows only; other values, tabs other than Setup and a type-4 record with
// string id 0 must be refused, not predicted.
function cursor_range(refs) {
  const ref = refs.get('en'), problems = [];
  for (const [page, cursor] of [[2, 0], [2, 4], [2, 5], [1, 7], [1, -1]]) {
    try { ref.page(page, cursor); if (!pred(false)) problems.push(`reference predicts page ${page} cursor ${cursor}`); } catch (e) { if (!isValueError(e)) throw e; }
  }
  try { ref.page(1, 3, null, 5); if (!pred(false)) problems.push('reference predicts tab 5 page 1 cursor 3 (the lab draws its labels in styles 7/8)'); } catch (e) { if (!isValueError(e)) throw e; }
  try { ref.record_widgets(new Map(), 0, 1, { type: 4, id: 0, literal: null, style: 1 }, 8); if (!pred(false)) problems.push('reference predicts a type-4 record with string id 0'); } catch (e) { if (!isValueError(e)) throw e; }
  for (const [page, cursor] of [[2, 3], [1, 6], [5, 7]]) {
    try { ref.page(page, cursor); } catch (e) {
      if (!isValueError(e)) throw e;
      if (!pred(false)) problems.push(`reference refuses page ${page} cursor ${cursor}: ${e.message}`);
    }
  }
  return problems;
}

// Each mutation of the reference must be detected by the comparisons of groups 2/3.
function negative_controls(refs, by, models, rasters) {
  const problems = [];
  const MR = refs.MR;
  const s = by.get('p1-en-A');
  if (s === undefined) return ['negative controls need session p1-en-A'];
  const [ref, model] = models.get('p1-en-A');
  const detected = (elements, label, buffers = true) => {
    const [probs] = compare_calls(s, ref, model, elements);
    if (buffers) probs.push(...compare_buffers(s, new MR.Raster(ref, 'skip').run(elements), model));      // not a predicate: a mode switch: compare_buffers' own predicates decide
    if (!pred(probs.length)) problems.push(`negative control "${label}" was not detected`);
  };
  const clone = (e, kw = {}) => new MR.Element(e.layer, e.kind, e.child, { ...e.data, ...kw });
  const els = model.elements;
  detected(els.map((e) => (e.kind === 'text' && e.child >= 62 && e.child <= 68 ? clone(e, { align: [0, e.data.align[1]] }) : e)), 'values left-aligned');
  const nxt = ref.page(1, 1, refs.store(new Map([[21, 1]])), undefined, STORE === 'native' ? MR.ROW_STATE_DEFAULTS.get(1) ?? new Set() : new Set());
  detected(nxt.elements, 'value lookup takes the next list entry');
  detected(els.map((e) => (e.kind === 'text' && e.data.colour === 13 ? clone(e, { colour: 22 }) : e)), 'colour 22 for style 1');
  const shift = (e) => {
    if (e.kind === 'text' && e.child >= 48 && e.child <= 68) {
      const r = e.child < 55 ? (e.child - 48) % 14 : e.child - 62;
      const o = e.data.origin, b = e.data.box;
      return clone(e, { origin: [o[0], o[1] + r], box: [b[0], b[1] + r, b[2], b[3] + r] });
    }
    if (e.kind === 'image' && ((e.child >= 1 && e.child <= 7) || (e.child >= 55 && e.child <= 61))) {
      const r = e.child <= 7 ? e.child - 1 : e.child - 55;
      const c = e.data.clip;
      return clone(e, { y: e.data.y + r, clip: [c[0], c[1] + r, c[2], c[3] + r] });
    }
    return e;
  };
  detected(els.map(shift), 'row pitch 63');
  detected(els.map((e) => (e.kind === 'image' && e.child === 1 ? clone(e, { lut: Uint8Array.from(range(0, 256)) }) : e)), 'identity LUT on the cursor bar');
  const b = by.get('p1-ja-B');
  if (b !== undefined) {
    const [ref_ja, model_ja] = models.get('p1-ja-B');
    if (!pred(compare_buffers(b, new MR.Raster(ref_ja, 'skip').run(model_ja.elements), model_ja).length)) problems.push('negative control "ja page 1: A reference against the B lab" was not detected');
  }
  return problems;
}

// ---- --mutants
// Run a check as a child in its own session (process group) with a private TMPDIR. On timeout the whole process group
// is killed (group_kill) or only the child; the TMPDIR is removed either way. Returns [returncode or null, output, tmp].
// cmd is an argv, or a function of the TMPDIR path returning one (timeout_cleanup's child names it in its argv).
export function run_child(cmd, envv, timeout, group_kill = true) {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'om-emu-check-child-'));
  if (typeof cmd === 'function') cmd = cmd(tmp);
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { env: { ...envv, TMPDIR: tmp }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (group_kill) process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch { /* gone */ }
    }, timeout * 1000);
    p.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve([timedOut ? null : code, out, tmp]);
    });
  });
}
// Live processes (not zombies) whose command line names tmp, after up to `wait` seconds.
async function leftover(tmp, wait = 5.0) {
  const deadline = performance.now() + wait * 1000;
  for (;;) {
    const found = naming(tmp);
    if (!found.length || performance.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 200));
  }
}
// A child that never finishes: a JS Simulator whose guest spins on 'bra .' (CA 00) with no insn-limit; it prints
// RUNNING once the continue is about to start. Its command line names its TMPDIR (the argument after --), so
// leftover() finds a survivor. The JS-only fault point
// menu-cleanup-survivor (test_checks.mjs) has it first start a grandchild in its own session, naming the TMPDIR too,
// which neither kill reaches: the 'processes left' predicate must trip.
const SURVIVOR = `
const { spawn } = await import('node:child_process');
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', process.argv.at(-1)], { detached: true, stdio: 'ignore' }).unref();
`;
const ENDLESS_CHILD = `
const [{ Simulator }, fs] = await Promise.all([import(${JSON.stringify(new URL('../src/lab/sim.mjs', import.meta.url).href)}), import('node:fs')]);
const { createHash } = await import('node:crypto');
const s = new Simulator({ rom: new Uint8Array(fs.readFileSync(${JSON.stringify(path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin'))})), createHash }, 0);
s.write(0x1000, new Uint8Array([0xca, 0x00]));
s.reset({ pc: 0x1000, sp: 0x20100 });
console.log('RUNNING');
s.run();
console.log('the endless guest loop stopped');
`;
// A child killed on timeout leaves no process and no temporary directory: once with the process-group kill, once
// killing only the child.
export async function timeout_cleanup(timeout = 8) {
  const problems = [];
  for (const group_kill of [true, false]) {
    const code = (fault('menu-cleanup-survivor') ? SURVIVOR : '') + ENDLESS_CHILD;
    const [rc, out, tmp] = await run_child((dir) => [process.execPath, '--input-type=module', '-e', code, '--', dir], process.env, timeout, group_kill);
    if (!pred(rc === null)) problems.push(`group_kill=${group_kill}: the endless child finished (exit ${rc}): ${out.trim().slice(-300)}`);
    else if (!pred(out.includes('RUNNING'))) problems.push(`group_kill=${group_kill}: the child did not reach the guest run within ${timeout} s`);
    const left = await leftover(tmp);
    if (!pred(!left.length)) problems.push(`group_kill=${group_kill}: processes left ${show(left)}`);
    for (const pid of left) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    if (!pred(!fs.existsSync(tmp))) problems.push(`group_kill=${group_kill}: ${tmp} left`);
  }
  return problems;
}
async function run_mutants() {
  let bad = 0;
  const problems = await timeout_cleanup();
  const clean = pred(!problems.length);
  bad += clean ? 0 : 1;
  console.log(`[${clean ? 'ok' : 'FAIL'}] a child spinning the guest on bra . killed on timeout leaves no child and no temporary directory (process-group kill, and child-only kill with the parent-death signal)`);
  for (const p of problems) console.log('      ' + p);
  for (const [name, what] of MUTANTS) {
    const envv = { ...process.env, OM_MENU_MUTANT: name };
    delete envv.OM_RNG_TAPE;
    const [rc, text] = await run_child([process.execPath, new URL(import.meta.url).pathname, '--quick'], envv, 900);
    const out = splitlines(text.trim());
    const fails = out.filter((line) => line.startsWith('[FAIL]'));
    const ok = pred(rc === 1 && !hasStack(out) && out.length && out.at(-1).startsWith('FAILED') && fails.length);
    bad += ok ? 0 : 1;
    console.log(`[${ok ? 'ok' : 'FAIL'}] mutant ${name} (${what}): exit ${rc}, ${fails.length} [FAIL] group(s); last line ${show(out.length ? cut(out.at(-1), 140) : null)}`);
    if (!ok) console.log(out.slice(-15).map((line) => '      ' + line).join('\n'));
  }
  const allOk = pred(!bad);
  console.log(`${allOk ? 'all mutants reported' : 'FAILED'} (${bad} problem(s))`);
  return allOk ? 0 : 1;
}

function writeStats() {
  if (!STATS) return;
  const doc = { packets: Object.fromEntries(STATS.packets), seconds: { ...STATS.seconds }, stops: STATS.stops, insns: STATS.insns,
    g_count: STATS.g_count, probes: STATS.probes, g_digest: STATS.digest.copy().digest('hex') };
  fs.writeFileSync(process.env.OM_STATS, JSON.stringify(doc, null, 1));
}

export async function main(argv) {
  const a = parseArgs('check_menu.mjs', argv, [
    { opt: '--quick', type: 'flag' },
    { opt: '--full', type: 'flag' },
    { opt: '--write-notes', type: 'flag' },
    { opt: '--mutants', type: 'flag' },
    { opt: '--jobs', type: 'int', metavar: 'N' },
    { opt: '--store', type: 'str', choices: ['native', 'empty'] },
  ]);
  const jobs = a.jobs ?? 1;
  if (jobs < 1) a.error('--jobs must be positive');
  JOBS = jobs;
  STORE = a.store ?? STORE;
  process.env.OM_MENU_STORE = STORE;
  if (a.write_notes && (a.quick || a.full || a.mutants)) a.error('--write-notes pins the default matrix: not with --quick, --full or --mutants');
  if (a.mutants) return run_mutants();
  if (a.write_notes && !process.env.OM_NOTES_DIR) a.error('--write-notes: needs OM_NOTES_DIR (the directory to write check_menu_notes.txt in)');
  try {
    return await check(a.quick ? 'quick' : a.full ? 'full' : 'default', !!a.write_notes);
  } catch (e) {
    if (e instanceof FirmwareError) throw new SystemExit(`FAILED: ${e.message}`);
    throw e;
  } finally { writeStats(); }
}

if (!isMainThread && workerData?.entry === 'check_menu') workerMain();
else if (import.meta.url === `file://${process.argv[1]}`) runMain('check_menu.mjs', main);
