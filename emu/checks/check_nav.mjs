#!/usr/bin/env node
// The navigation checks: key and dial events drive the firmware's Setup Menu on the firmware's own store
// (src/lab/nav.mjs). The lab sessions run first; the references (refs/menuref.mjs with its Nav rules, refs/settings.mjs,
// refs/font.mjs) are imported with import() only after they ended (asserted with a check-side flag). They
// read firmware data only (src/lab/menudata.mjs and src/lab/resources.mjs injected). Groups 0..10 and N3T with their
// report lines; every pass/fail predicate (the exit code and the --mutants verdicts included) goes through checks/lib/pred.mjs. Class patching (native_init,
// store_init, dial_init, resend_palettes, MenuLab._follow_language, NavLab.skip_defer) is prototype patching,
// restored in finally; the module globals NAV_PRI and WAIT_SLICE_MS are set through nav.mjs's setters. --jobs N runs the
// sessions in N worker_threads; --mutants runs this file again under each mutant in a node child. Group 1's bare
// the lab's machine is a JS Simulator (src/lab/sim.mjs) with its stderr lines. Screenshots (N8) are written under OM_CHECK_OUT
// (default emu/out/checks/js/manual) in check-<script>/.
//   node emu/checks/check_nav.mjs [--quick] [--write-notes] [--mutants] [--jobs N]
import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { REPO, FIXTURES, labEnv, loadImage, loadBlock, runMain, SystemExit, resultHook } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { flushCoverage } from './lib/coverage.mjs';
import { pred, fault } from './lib/pred.mjs';
import { isValueError, hasStack, regValue } from './lib/errors.mjs';
import { encode, decode } from './lib/wire.mjs';
import { write_outputs } from './lib/png.mjs';
import * as CD from './check_display.mjs';
import * as CM from './check_menu.mjs';
import * as D from '../src/lab/display.mjs';
import * as MM from '../src/lab/menu.mjs';
import { ScpuError } from '../src/lab/scpudev.mjs';
import * as M from '../src/lab/menudata.mjs';
import * as N from '../src/lab/nav.mjs';
import * as R from '../src/lab/resources.mjs';
import { displayed_windows } from '../src/lab/windows.mjs';
import { FirmwareError, disasm, runtime } from '../src/lab/hle.mjs';
import { ValueError, AssertionError } from '../src/lab/errors.mjs';
import { Simulator } from '../src/lab/sim.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show, asText } from '../src/util/show.mjs';
import { unpack, unpackFrom } from '../src/util/bytes.mjs';

export const NOTES_FILE = path.join(FIXTURES, 'check_nav_notes.txt');
export const MUTANTS = new Map([
  ['no-store-init', 'the store init is skipped (empty store: S-PERSIST must fail)'],
  ['defaults-shift', 'the reference defaults are shifted by one id'],
  ['reg0-clear', 'the SCPU signature register is cleared before page 6 (not-42 path, errlog 0x19001004)'],
  ['pri60', 'the lab task stays at priority 60 (the GUI runs during the post)'],
  ['no-dial-init', 'the dial-table init is skipped (the GUI cannot read the dial: errlog 0x28001324)'],
  ['updown-swapped', 'the Nav reference with UP and DOWN swapped'],
  ['b2-no-takeover', 'N7 without S-TAKEOVER (module 9 stays 1: ChangeOutline takes the RPC path, the layout stays 1)'],
  ['b2-loutput-1', 'N7 with H-CONNECT lOutput 1 instead of 7 (must not reach layout 0)'],
  ['b2-scope', 'N7 with an extra harness read of module 9 after S-TAKEOVER (the scope guard must raise)'],
  ['switch-no-resend', 'N8 without H-RESEND (the switched channel keeps zero palettes)'],
  ['b7-no-task16', 'N3T without H-DEFER (task 16 not initialised): the GUI must still await 0x9ac6 at T_pred'],
  ['lang-no-follow', 'group 10 with S-RES pinned to the start language (the M6..M10 behaviour): the change must fail'],
]);
export const MUTANT_SCRIPTS = new Map([['b2-no-takeover', ['N7']], ['b2-loutput-1', ['N7']], ['b2-scope', ['N7']], ['switch-no-resend', ['N8']], ['b7-no-task16', ['N3T']]]);
let JOBS = 1;
const MUTANT = process.env.OM_NAV_MUTANT || null;
export const EPOCH1 = 1791369000, EPOCH2 = 1791455461;
const N1 = ['OPEN', ['INFO', 'cap'], 'DOWN', 'INFO', 'INFO:off', ['DOWN', 'cap'], 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN',
  ['DOWN', 'cap'], ['UP', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'],
  ['RIGHT', 'cap'], 'LEFT', 'MAIN+1', 'MAIN-1', 'SUB+1', 'SUB-1', 'SUB-1', 'SUB+1', 'OK', ['MENU', 'cap'], 'DOWN',
  'MENU', ['OPEN', 'cap'], 'RIGHT', ['LEFT', 'cap'], 'SUB-1', 'MENU', 'OPEN', 'MENU',
  'OPEN', 'RIGHT', 'LEFT', 'MENU', 'OPEN', 'RIGHT', 'MAIN-1', 'MENU', 'OPEN', 'LEFT', 'MENU'];
const N2 = ['OPEN', 'SUB+1', 'SUB+1', ['MENU', ''], ['OPEN', 'cap']];
const N3 = ['OPEN', ['SET:32=180', 'free'], ['RIGHT', ''], ['LEFT', 'cap'], 'DOWN', 'DOWN', 'DOWN', 'DOWN', ['OK', ''],
  ['DOWN', 'free'], ['OK', 'free'], ['MENU', 'error:event storm']];
const N3T = [...N3.slice(0, -1), ['B7', 'cap'], 'MENU'];
const N4 = [[`CLOCK:${EPOCH1}`, 'free'], 'OPEN', ['RIGHT', 'cap'], [`CLOCK:${EPOCH2}`, 'free'], 'LEFT', ['RIGHT', 'cap']];
const N5 = ['OPEN', ['DOWN', 'cap'], ['RIGHT', 'cap'], ['LEFT', 'cap']];
const N6 = ['OPEN', 'MENU'];
const N7 = [['OPEN', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], ['RIGHT', 'cap'], 'MENU', ['OPEN', 'cap']];
const N7C = [['OPEN', 'cap']];
const N8 = ['OPEN', ['SHOT', 'free cap'], ['SWITCH:evf', 'free cap'], ['SHOT', 'free cap'], ['SWITCH:tft', 'free cap'], ['SHOT', 'free cap']];
export const SCRIPTS = new Map([
  ['N1', [N1, [7, 1, 1], 'en']], ['N2', [N2, null, 'en']], ['N3', [N3, [7, 5, 1], 'en']], ['N3T', [N3T, [7, 5, 1], 'en']],
  ['N4', [N4, [7, 5, 1], 'en']], ['N5', [N5, [7, 1, 1], 'ja']], ['N6', [N6, [8, 5, 2], 'en']], ['N7', [N7, [7, 1, 1], 'en']],
  ['N7C', [N7C, [7, 1, 1], 'en']], ['N8', [N8, [7, 1, 1], 'en']],
]);
const SESSION = { N7: { device: 'evf', evf_layout: true, a15: true }, N7C: { device: 'evf' }, N8: { store_first: true, a15: true }, N3T: { time: true } };
const TIME_SCRIPTS = ['N3T'];
const SOFT_SLOTS = 0xA32C5620, SOFT_SLOT_COUNT = 32, OSAL_TIMER_CB = 0x50AB8FE6, GENIFA_CLOCK = 0x603679D0, GENIFA_STEP = 10;
const GENIFA_TIMER_START = 0x5124F980, B7_TIMER = 522, B7_MS = 100, SOFT_TICK_CHANNEL = 21;
const B2_SCRIPTS = ['N7', 'N7C'], SWITCH_SCRIPTS = ['N8'];
const LEVEL_STEP = 0x501C67AA, LEVEL_APPLY = 0x501C69E5, EDGE_PAD_COPY = 0x501DB7D8, STATE_GET = 0x500417DA;
const DISPLAY_KINDS = new Map([[0xE831, 587], [0x4671, 1947], [0xD7F9, 449], [0x8279, 31]]);
const KIND_TABLE = 0x606217E4, TIMER_ERRLOG = 0x19001807, AWAITED = 0x603710F8, EV_10MS_WIZARD_MENU = 0x9AC6;
const SCPU_OFFSETS = new Set([0x00, 0xE8, 0xEC, 0xF4, ...Array.from({ length: 14 }, (_, i) => 0x08 + 4 * i)]);
const DESC_IDS = 16384;
const OUT = process.env.OM_CHECK_OUT ? path.resolve(process.env.OM_CHECK_OUT) : path.join(REPO, 'emu/out/checks/js/manual');
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const hx = (v, w = 0) => '0x' + (regValue(v) >>> 0).toString(16).padStart(w, '0');
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const sortStr = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// ints, strs and arrays of them in order, arrays element by element
const cmpItems = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpItems(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
const sortedItems = (xs) => [...xs].sort(cmpItems);
const cut = (s, n) => { const cs = Array.from(s); return cs.length > n ? cs.slice(0, n).join('') : s; };
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const bytesEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
// the lines of a text, without the empty one after a final line break
const splitlines = (s) => { const out = s.split(/\r\n|\r|\n/); if (out.length && out.at(-1) === '') out.pop(); return out; };
const pad2 = (n) => String(n).padStart(2, '0');
// the counts of the error-log codes (as 0x and 8 hex digits), in first-seen order
const errCounter = (errors) => { const m = new Map(); for (const [c] of errors) inc(m, h8(c)); return m; };
let ENV = null;
const env = () => (ENV ??= labEnv({ resBlock: loadBlock(), writeOutputs: (lab, name, device, comp, dump, dir) => write_outputs(lab, name, device, comp, dump, path.join(OUT, dir)) }));
let REFS_LOADED = false;

// Store ids the Setup pages 1-6 read: getter-backed rows and the decoded handlers' ids, the memories and the language.
function setup_ids(img) {
  const t = M.tab_entry(img, MM.SETUP_TAB);
  const ids = new Set();
  for (const p of t.pages) for (const k of M.store_reads(img, p).keys()) ids.add(k);
  for (const k of [1129, 1130, 1400, 1133, 179, 1881, 1882, 3009, ...t.aux]) ids.add(k);
  return sortNum(ids);
}

// ---- lab side
// Composite and the displayed GUI windows; full (N7/N8): also the reference comparison, the bank, PLANC, the palette
// formula and the word hash.
function capture(nav, full = false) {
  const lab = nav.lab;
  const comp = lab.compose(nav.device);
  const width = nav.evf_layout || nav.device === 'evf' ? 800 : 900;
  const out = { windows: displayed_windows(lab, nav.device, width), comp: comp.status, vsc: comp.errors.map((e) => e.name), device: nav.device,
    after_evf: (nav.evf_updated ?? false) && nav.device === 'tft' };
  if (full) {
    const c = D.DEVICE[nav.device].channel;
    const bank = lab.vsc.bank(c, true);
    let pal;
    try { pal = `${CD.check_palettes(lab, nav.device, [86, 87, 85])} words == formula`; } catch (e) {
      if (!(e instanceof AssertionError)) throw e;
      pal = `FAIL ${cut(e.message, 120)}`;
    }
    Object.assign(out, { errors: comp.errors.map((e) => [e.name, e.args.slice(0, 2), e.value]), ref: CM.vsc_compare(lab, nav.device, comp, nav.device, nav.a15 ? ['A15'] : []),
      assumed: comp.header.assumed, bank, palette: pal, planc: [1, 2, 3].map((n) => bank.get(`OSD${n}PLANC`) ?? null), layout: lab.b2_snapshot(),
      sha: createHash('sha256').update(new Uint8Array(Uint32Array.from(comp.words).buffer)).digest('hex') });
    if (nav.device === 'tft') out.words = comp.words;
  }
  return out;
}
const entries = (script) => script.map((e) => (typeof e === 'string' ? [e, ''] : e));

// Prototype patches of NavLab, restored by the returned function.
function patchNavLab(hooks) {
  const P = N.NavLab.prototype, saved = [];
  for (const [k, f] of Object.entries(hooks)) {
    if (k === 'skip_defer') {
      saved.push(() => { if (Object.hasOwn(N.NavLab, 'skip_defer0')) { N.NavLab.skip_defer = N.NavLab.skip_defer0; delete N.NavLab.skip_defer0; } });
      N.NavLab.skip_defer0 = N.NavLab.skip_defer;
      N.NavLab.skip_defer = f;
      continue;
    }
    const d = Object.getOwnPropertyDescriptor(P, k);
    saved.push(() => { if (d) Object.defineProperty(P, k, d); else delete P[k]; });
    Object.defineProperty(P, k, { value: f, writable: true, configurable: true });
  }
  return () => { for (const r of saved.reverse()) r(); };
}

export function run_script(name, mutant = null) {
  const [script, start, lang] = SCRIPTS.get(name);
  const t0 = performance.now();
  const opts = { ...(SESSION[name] ?? {}) };
  const out = { name, start: start ? [...start] : null, lang, steps: [], problems: [], layout: opts.evf_layout ? 0 : 1, device: opts.device ?? 'tft' };
  let b2 = {};
  if (name === 'N7' && mutant === 'b2-no-takeover') b2 = { takeover: false };
  if (name === 'N7' && mutant === 'b2-loutput-1') b2 = { loutput: 1, extra_readers: [0x50ABD077] };
  const device = opts.device ?? 'tft';
  delete opts.device;
  const nav = new N.NavSession(env(), { lang, device, u1: 'skip', start, open_menu: false, png: 'none', tag: `check-${name}`, b2_options: b2, ...opts });
  const hooks = {};
  const observed = new Map();
  const obs = (k) => { if (!observed.has(k)) observed.set(k, []); return observed.get(k); };
  if (TIME_SCRIPTS.includes(name)) {
    const native_init_t = N.NavLab.prototype.native_init;
    hooks.native_init = function () {
      native_init_t.call(this);
      this.observe(GENIFA_TIMER_START, (l, r) => obs('genifa_starts').push([r.d0 & 0xFFFF, r.d1, l.sim.u32(GENIFA_CLOCK), l.lab_time(), l.step_tag]), 'obs-genifa-start');
    };
  }
  if (mutant === 'b7-no-task16') hooks.skip_defer = true;
  if (SWITCH_SCRIPTS.includes(name) || B2_SCRIPTS.includes(name)) {
    const native_init = N.NavLab.prototype.native_init;
    hooks.native_init = function () {
      native_init.call(this);
      if (SWITCH_SCRIPTS.includes(name)) {
        this.observe(LEVEL_STEP, (l, r) => obs('level_step').push([r.d0 & 0xFF, disasm(r.mdr)]), 'obs-level-step');
        this.observe(LEVEL_APPLY, (l, r) => obs('level_apply').push(r.d0 & 0xFF), 'obs-level-apply');
      }
      const edge_pad = (l, r) => {
        const plane = r.d3 & 0xFF;
        const [w, h] = unpack('<HH', l.sim.read(CD.OSD_BUFFER_W + 4 * plane, 4));
        obs('edge_pad').push([l.step_tag ?? l.phase, plane, r.a2 - (w - 1), w, h, l.sim.read(r.a2, 1)[0]]);
      };
      this.observe(EDGE_PAD_COPY, edge_pad, 'obs-edge-pad');
    };
  }
  if (mutant === 'switch-no-resend') hooks.resend_palettes = function () { return []; };
  if (mutant === 'no-store-init') hooks.store_init = function () { return null; };
  if (mutant === 'no-dial-init') hooks.dial_init = function () { return null; };
  if (mutant === 'pri60') N.setNavPri(MM.LAB_PRI);
  const restore = patchNavLab(hooks);
  let lab = null;
  try {
    try {
      nav.enter();
      lab = nav.lab;
      const sl = lab.store_log;
      out.store = { phases: sl.phases.map((p) => [p.label, p.ok, p.prints, p.errlog, p.seconds]), persist: [...sl.persist], waits: [...sl.scpu_waits],
        requests: [...sl.scpu_requests], replies: [...sl.scpu_replies], cflush: new Map(sl.cflush), crt: [...sl.crt134d], flash: [...sl.flash_save],
        dial: sl.dial, scpu: { ...(sl.scpu ?? {}) }, cover: lab.stub_pages().filter(([p, n]) => p <= MM.SCPU && MM.SCPU < p + n).map(([p]) => '0x' + p.toString(16)) };
      out.scpu_commands = lab.scpu_commands();
      out.bring_up_errlog = errCounter(lab.kernel.errors);
      out.bring_up_seconds = nav.bringup_seconds;
      out.pad_widths = range(0, 3).map((p) => unpack('<H', lab.sim.read(CD.OSD_BUFFER_W + 4 * p, 2))[0]);
      if (B2_SCRIPTS.includes(name)) out.b2 = { takeover: lab.takeover_log, after_bring_up: lab.b2_snapshot() };
      if (name === 'N7' && mutant === 'b2-scope') lab.call(MM.MODULE_STATE_GET, { d0: MM.TAKEOVER_MODULE }, null, null, 200);
      if (SWITCH_SCRIPTS.includes(name)) {
        out.kinds = new Map();
        for (const k of DISPLAY_KINDS.keys()) out.kinds.set(k, lab.call(STATE_GET, { d0: k, d1: 0, a0: 0 }, null, null, 2000).d0);
      }
      if (start === null) {
        out.reads = new Map(setup_ids(nav.img).map((sid) => [sid, nav.get(sid)]));
        const key = runtime(D.PROP_GET), hook = lab.hooks.get(key);
        lab.hooks.delete(key);
        try { out.prop4513 = lab.call(D.PROP_GET, { d0: 4513 }, null, null, 1000).d0; } finally { lab.hooks.set(key, hook); }
        out.rules = stand_in_rules(lab);
        const descs = new Map();
        for (let sid = 0; sid < DESC_IDS; sid++) { const d = lab.descriptor(sid); if (d !== null) descs.set(sid, d); }
        out.descriptors = new Map([...descs].map(([sid, d]) => [sid, d.address]));
        out.key_fns = new Map([...descs].filter(([, d]) => d.key_fn).map(([sid, d]) => [sid, d.key_fn]));
      }
      for (const [token, flags] of entries(script)) {
        if (mutant === 'reg0-clear' && token === 'RIGHT' && lab.var226 && N.decode_var226(lab.var226, nav.img).page === 5) lab.cpu_store(MM.SCPU, 0);
        let rec;
        try {
          rec = token === 'B7' ? b7_bracket(nav, observed) : nav.step(token);
        } catch (e) {
          if (!(e instanceof FirmwareError || isValueError(e))) throw e;
          out.steps.push({ token, error: cut(e.message, 1500), awaited: lab.sim.u32(AWAITED), flags });
          if (!pred(flags.startsWith('error'))) out.problems.push(`${name} ${token}: ${cut(e.message, 500)}`);
          break;
        }
        rec.flags = flags;
        rec.var = lab.var226 ? N.decode_var226(lab.var226, nav.img) : null;
        rec.awaited = lab.sim.u32(AWAITED);
        if (token.startsWith('SET:') || rec.writes.length) {
          rec.reads = new Map(rec.writes.map((w) => [w.id, nav.get(w.id)]));
          if (token.startsWith('SET:')) { const sid = Number.parseInt(token.slice(4).split('=')[0], 10); rec.reads.set(sid, nav.get(sid)); }
        }
        if (token === 'SWITCH:evf') nav.evf_updated = true;
        if (flags.includes('cap')) rec.capture = capture(nav, B2_SCRIPTS.includes(name) || SWITCH_SCRIPTS.includes(name));
        if (B2_SCRIPTS.includes(name)) rec.layout = lab.b2_snapshot();
        out.steps.push(rec);
        if (!pred(!flags.startsWith('error'))) out.problems.push(`${name} ${token}: expected a stop (${flags}), the step completed`);
      }
      if (B2_SCRIPTS.includes(name)) { out.b2.trace = [...(lab.b2_trace ?? [])]; out.b2.module9_reads = [...(lab.module9_reads ?? [])]; }
      out.observed = observed;
      out.errlog_all = errCounter(lab.kernel.errors);
    } finally { nav.close(); }
  } catch (e) {
    if (!(e instanceof FirmwareError || isValueError(e))) throw e;
    out.problems.push(`${name}: session: ${cut(e.message, 800)}`);
  } finally {
    restore();
    N.setNavPri(50);
  }
  out.seconds = Math.round((performance.now() - t0) / 100) / 10;
  resultHook('run_script', out);
  return out;
}

const LONG_WAIT = ['OPEN', 'WAIT:10500', 'DOWN'];
// Group 9's session: LONG_WAIT in time mode from (7, 1, 1); slice_ms replaces WAIT_SLICE_MS for this session.
export function run_long_wait(slice_ms = null) {
  const nav = new N.NavSession(env(), { lang: 'en', device: 'tft', u1: 'skip', start: [7, 1, 1], open_menu: false, png: 'none', tag: 'check-long-wait', time: true });
  const t0 = performance.now();
  const out = { steps: [], problems: [], slice_ms };
  const saved = N.WAIT_SLICE_MS;
  if (slice_ms !== null) N.setWaitSliceMs(slice_ms);
  try {
    try {
      nav.enter();
      for (const token of LONG_WAIT) {
        const rec = nav.step(token);
        out.steps.push({ token, gesetevent: rec.gesetevent, hook_stops: rec.hook_stops, wait: rec.wait ?? null, row: (rec.state.menu ?? {}).cursor_row ?? null });
      }
    } finally { nav.close(); }
  } catch (e) {
    if (!(e instanceof FirmwareError || isValueError(e))) throw e;
    out.problems.push(`long WAIT: ${cut(e.message, 800)}`);
  } finally { N.setWaitSliceMs(saved); }
  out.seconds = Math.round((performance.now() - t0) / 100) / 10;
  resultHook('run_long_wait', out);
  return out;
}
const ONE_SLICE_MS = 11000;
const LANGUAGE_CHANGE = ['OPEN', 'DOWN', 'DOWN', 'OK', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'LEFT', 'LEFT', 'OK', 'WAIT:500'];

// Group 10's sessions: the language change from en (control=false) or the zh-CN control opened at (7, 6, 3).
export function run_language(control = false) {
  const [lang, start, script] = control ? ['zh-CN', [7, 6, 3], ['OPEN']] : ['en', [7, 6, 1], LANGUAGE_CHANGE];
  const P = MM.MenuLab.prototype, d = Object.getOwnPropertyDescriptor(P, '_follow_language');
  if (MUTANT === 'lang-no-follow') P._follow_language = function () { return null; };
  const t0 = performance.now();
  const out = { control, problems: [], steps: [] };
  try {
    const nav = new N.NavSession(env(), { lang, device: 'tft', u1: 'skip', start, open_menu: false, png: 'none', tag: 'check-language', time: true });
    nav.enter();
    try {
      for (const token of script) {
        const rec = nav.step(token);
        out.steps.push([token, rec.state.panel]);
      }
      const lab = nav.lab;
      const win = displayed_windows(lab, 'tft', 900);
      Object.assign(out, { lang: lab.lang, changes: lab.language_changes.map((c) => c.slice(0, 4)), loaded: [...lab.loaded],
        lang_reads: lab.settings_log.filter(([sid, , k]) => sid === 3009 && k === 'native').map(([, v]) => v),
        windows: createHash('sha256').update(windowsText(win)).digest('hex') });
    } finally { nav.close(); }
  } catch (e) {
    if (!(e instanceof FirmwareError || isValueError(e))) throw e;
    out.problems.push(`language ${control ? 'control' : 'change'}: ${cut(e.message, 600)}`);
  } finally {
    if (d) Object.defineProperty(P, '_follow_language', d); else delete P._follow_language;
  }
  out.seconds = Math.round((performance.now() - t0) / 100) / 10;
  resultHook('run_language', out);
  return out;
}
// check_menu.displayed_windows(...) shown, as bytes: {0: <hex>, 1: <hex>, 2: <hex>}
const windowsText = (win) => new TextEncoder().encode(show(win));

function language_group(run, control) {
  const problems = [...run.problems, ...control.problems];
  if (problems.length) return problems;
  if (!pred(deepEqual(run.changes, [['en', 'zh-CN', 19, 0]]) && run.lang === 'zh-CN')) problems.push(`S-RES followed ${show(run.changes)}, session language ${run.lang}`);
  if (!pred(deepEqual(run.loaded.slice(-2), [[19, 0], [1, 2]]))) problems.push(`records loaded by the change ${show(run.loaded.slice(-2))}, expected zh-CN's font 19 and strings 1`);
  if (!pred(run.lang_reads.includes(5))) problems.push(`native reads of 3009 ${show(run.lang_reads)}: the store never said zh-CN (5)`);
  if (!pred(run.steps.at(-1)[1] === 329 && run.steps.at(-2)[1] === 439)) problems.push(`panels ${show(run.steps.slice(-2))}: the OK in panel 439 did not return to the page`);
  if (!pred(run.windows === control.windows)) problems.push('displayed windows after the change != the zh-CN control session at (7, 6, 3)');
  return problems;
}

function long_wait_group(run, notes, one = null) {
  const problems = [];
  for (const bad of [-5.0, 0.0, 1e-7, Infinity, NaN]) {
    try {
      N.NavSession.prototype.wait.call(null, bad);
      if (!pred(false)) problems.push(`WAIT:${bad} accepted`);
    } catch (e) { if (!isValueError(e)) throw e; }
  }
  problems.push(...run.problems);
  const steps = new Map(run.steps.map((s) => [s.token, s]));
  const w = steps.get('WAIT:10500'), down = steps.get('DOWN');
  if (!(w && down)) return [...problems, `long WAIT: steps ${show(run.steps.map((s) => s.token))}`];
  const wait = w.wait;
  const budget = N.STORM + Math.ceil(10500 * N.WAIT_STORM_PER_MS);
  if (!pred(wait.slices === 2 && wait.end === wait.target && wait.target - wait.start === 10500000000)) problems.push(`long WAIT: ${show(wait)}, expected 2 slices ending at start + 10.5 s`);
  if (!pred(N.STORM < w.gesetevent && w.gesetevent <= budget)) problems.push(`long WAIT: ${w.gesetevent} GESetEvent calls, expected above STORM ${N.STORM} (the fixed step budget this test guards against) and at most ${budget}`);
  if (!pred(down.row === 1)) problems.push(`long WAIT: DOWN after the wait left row ${down.row}, expected 1`);
  problems.push(...long_wait_control(w, down, one));
  notes.push(`LONG-WAIT WAIT:10500 slices ${wait.slices} GESetEvent ${w.gesetevent} hook stops ${w.hook_stops} idle log ${show(sortedItems(Object.entries(wait.log)))}; DOWN row ${down.row}`);
  return problems;
}
function long_wait_control(w, down, one) {
  if (one === null) return ['long WAIT: the one-slice control did not run'];
  if (one.problems.length) return one.problems;
  const steps = new Map(one.steps.map((s) => [s.token, s]));
  const w1 = steps.get('WAIT:10500'), down1 = steps.get('DOWN');
  if (!(w1 && down1)) return [`long WAIT one-slice: steps ${show(one.steps.map((s) => s.token))}`];
  const problems = [];
  if (!pred(w1.wait.slices === 1 && w1.wait.end === w1.wait.target)) problems.push(`long WAIT one-slice: ${show(w1.wait)}, expected 1 slice ending at its target`);
  const a = [w.gesetevent, w.wait.log.irq ?? null, down.row], b = [w1.gesetevent, w1.wait.log.irq ?? null, down1.row];
  if (!pred(deepEqual(a, b))) problems.push(`long WAIT: (GESetEvent, acceptances, DOWN row) ${show(a)} with 2 slices, ${show(b)} with 1`);
  return problems;
}

// N3T: the B7 bracket's prediction held (event exactly at T_pred), the popup closed on it, MENU closed the menu.
function b7_group(run, notes) {
  const problems = [];
  const b7s = run.steps.filter((s) => s.token === 'B7' && 'b7' in s);
  if (!b7s.length) return [...problems, `N3T: no B7 bracket (${show(run.steps.map((s) => s.token ?? null))})`];
  const b7 = b7s[0].b7, before = b7.before, at = b7.at;
  if (!pred(before.awaited === EV_10MS_WIZARD_MENU && before.clock - b7.g0 === B7_MS - GENIFA_STEP)) {
    problems.push(`N3T B7: at T_pred - 1 = ${b7.t_pred - 1} the GUI awaits 0x${before.awaited.toString(16)} with the Genifa clock at start + ${before.clock - b7.g0}, expected 0x9ac6 and + ${B7_MS - GENIFA_STEP}`);
  }
  if (!pred(at.awaited === 0 && at.clock - b7.g0 === B7_MS)) {
    problems.push(`N3T B7: at T_pred = ${b7.t_pred} the GUI awaits 0x${at.awaited.toString(16)} with the Genifa clock at start + ${at.clock - b7.g0}, expected the event taken (0) and + ${B7_MS}`);
  }
  notes.push(`B7 N3T slot count ${b7.count} period ${b7.slot_period}, Genifa clock ${b7.g0} at timer 522's start (${b7.genifa_ticks_done} ticks before the bracket), channel 21 next ${b7.t1} period ${b7.P} ns: `
    + `T_pred ${b7.t_pred} ns; before ${hx(before.awaited)}/${before.clock}, at ${hx(at.awaited)}/${at.clock}, lab time after ${at.t}`);
  const menu = run.steps.filter((s) => s.token === 'MENU' && 'state' in s);
  if (!pred(menu.length && menu.at(-1).state.screen === 'closed')) problems.push(`N3T: MENU after B7 did not close the menu: ${menu.length ? menu.at(-1).state.screen : '[]'}`);
  return problems;
}
function soft_slots(sim) {
  const out = [];
  for (let i = 0; i < SOFT_SLOT_COUNT; i++) {
    const b = sim.read(SOFT_SLOTS + 24 * i, 24);
    const [handle, active] = unpackFrom('<HH', b, 0), [period, cb] = unpackFrom('<II', b, 8), [count] = unpackFrom('<H', b, 20);
    if (active) out.push({ slot: i, handle, period, callback: disasm(cb), count });
  }
  return out;
}
// B7 with lab time: predict when Genifa timer 522 posts 0x9ac6, from the lab state only, then elapse to T_pred - 1 and
// to T_pred.
function b7_bracket(nav, observed) {
  const lab = nav.lab, sim = lab.sim;
  nav.begin(`${pad2(nav.steps.length)}-B7`);
  const slots = soft_slots(sim).filter((s) => s.callback === OSAL_TIMER_CB);
  const starts = (observed.get('genifa_starts') ?? []).filter((s) => s[0] === B7_TIMER);
  if (slots.length !== 1 || !starts.length || starts.at(-1)[1] !== B7_MS) throw new N.NavError(`B7: Genifa slots ${show(slots)}, timer ${B7_TIMER} starts ${show(starts)}`);
  const slot = slots[0], g0 = starts.at(-1)[2], gnow = sim.u32(GENIFA_CLOCK);
  const done = Math.floor((gnow - g0) / GENIFA_STEP), rest = (((gnow - g0) % GENIFA_STEP) + GENIFA_STEP) % GENIFA_STEP;
  const ticks = Math.floor(B7_MS / GENIFA_STEP);
  if (rest || !(done >= 0 && done < ticks)) throw new N.NavError(`B7: Genifa clock ${gnow} at the bracket, ${g0} at the timer start`);
  const ch = lab.timer.channel(SOFT_TICK_CHANNEL);
  const t1 = ch.next, period = ch.period;
  const t_pred = t1 + (slot.count - 1 + slot.period * (ticks - done - 1)) * period;
  const b7 = { count: slot.count, slot_period: slot.period, g0, g_bracket: gnow, genifa_ticks_done: done, t1, P: period, t_pred, start: lab.lab_time() };
  for (const [label, target] of [['before', t_pred - 1], ['at', t_pred]]) {
    const log = lab.lt.elapse_until(target, () => lab.lab_time(), (x) => lab.run_to_event(x), N.STEP_HOOKS * 8);
    const counts = {};
    for (const x of log) { const k = x.trim().split(/\s+/)[0]; counts[k] = (counts[k] ?? 0) + 1; }
    b7[label] = { awaited: sim.u32(AWAITED), clock: sim.u32(GENIFA_CLOCK), t: lab.lab_time(), log: counts };
  }
  return nav.end('B7', 'wait', [], [], { b7 });
}

// The listed-site rules of K-CFLUSH and S-FLASHSAVE, S-SCPUDEV's refusals and the S-PERSIST phase rule, called directly
// with a recording finish: an unlisted caller must raise MenuError, a command S-SCPUDEV does not model ScpuError (its
// read handlers called as a frame would: the port scan 0x88, which UI_IN sends and no session does, and a read of the
// backed-up word 3, which no caller reads). K-CRT-134D takes any caller since the multi-model work:
// it returns the SCPU counter the window code reads (`mov (0x98e000e8),d0; retf`, D), which E137's operating-time count
// calls too.
function stand_in_rules(lab) {
  class Finish { constructor() { this.done = []; } finish(r, kw = {}) { this.done.push(kw); } }
  const problems = [];
  const read = (cmd, data) => () => lab.scpu_dev.read(cmd, new Uint8Array(data));
  for (const [label, fn, regs, error] of [
    ['K-CFLUSH unlisted caller', (h, r) => lab._k_cflush(h, r), { mdr: runtime(0x5004086C) }, MM.MenuError],
    ['S-SCPUDEV command 0x88', read(0x88, []), {}, ScpuError],
    ['S-SCPUDEV backed-up word 3', read(0x86, [3, 0]), {}, ScpuError],
    ['S-FLASHSAVE unlisted caller', (h, r) => lab._s_flash_save(h, r), { d0: 0, mdr: runtime(0x503C5534) }, MM.MenuError]]) {
    try {
      fn(new Finish(), regs);
      if (!pred(false)) problems.push(`${label} accepted`);
    } catch (e) { if (!(e instanceof error)) throw e; }
  }
  try {
    lab.persist(1914, 2, 'input');
    if (!pred(false)) problems.push('S-PERSIST accepted after GUI creation');
  } catch (e) { if (!(e instanceof MM.MenuError)) throw e; }
  try {
    const k = lab.scalar_keys(2, 'SET');
    if (!pred(false)) problems.push(`SET/S-PERSIST validation accepts key-selected id 2: ${show(k)}`);
  } catch (e) {
    if (!(e instanceof MM.MenuError)) throw e;
    if (!pred(e.message.includes('key selector 0x503c589b'))) problems.push(`id 2 refused for another reason: ${e.message}`);
  }
  const k32 = lab.scalar_keys(32, 'SET');
  if (!pred(deepEqual(k32, [0, 60, 180, 300]))) problems.push(`SET 32 allowed list ${show(k32)}`);
  return problems;
}

// A bare OM-Emu machine (no kernel): CPU loads/stores from a two-byte snippet at sim.mjs LAND.
function device_group() {
  const LAND = 0xA2100000;
  const problems = [];
  const sim = new Simulator(labEnv());
  try {
    const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
    const access = (code, addr, d0 = 0) => {
      sim.write(LAND, cat(code, new Uint8Array([0xCB])));
      sim.reset({ pc: LAND, a0: addr, d0 });
      return sim.run([], true);
    };
    for (const off of [0x00, 0x08, 0x3C, 0xE8]) {
      const v = (0x5A000000 | off << 8 | 0xA5) >>> 0;
      const w = access(new Uint8Array([0x60]), MM.SCPU + off, v);
      const r = access(new Uint8Array([0x70]), MM.SCPU + off);
      if (!pred(!(w.fault || r.fault || r.d0 !== v))) problems.push(`0x${off.toString(16).padStart(2, '0')}: store fault ${w.fault}, load fault ${r.fault} d0 0x${r.d0.toString(16)}`);
    }
    // the clock ticks with the lab clock: 2.5 s on, 0xe8 has counted two seconds and 0xec holds the half second in bits
    // 14..5; a store of 0 to 0xec restarts the phase at the second, a store of another value is a bus error
    const clock = sim.m.devices.clock, load = (off) => access(new Uint8Array([0x70]), MM.SCPU + off).d0 >>> 0;
    const e8 = (0x5A000000 | 0xE8 << 8 | 0xA5) >>> 0;
    clock.advance(clock.t + 2.5e9);
    const ticked = [load(0xE8), load(0xEC)];
    const zero = access(new Uint8Array([0x60]), MM.SCPU + 0xEC, 0);
    clock.advance(clock.t + 0.25e9);
    const restarted = [load(0xE8), load(0xEC)];
    const odd = access(new Uint8Array([0x60]), MM.SCPU + 0xEC, 1);
    if (!pred(deepEqual([ticked, zero.fault, restarted, odd.fault], [[e8 + 2, 512 << 5], 0, [e8 + 2, 256 << 5], 2]))) {
      problems.push(`clock: 2.5 s on ${show(ticked.map((v) => hx(v)))}, store 0 to 0xec fault ${zero.fault}, 0.25 s on ${show(restarted.map((v) => hx(v)))}, store 1 to 0xec fault ${odd.fault}`);
    }
    const w = access(new Uint8Array([0x60]), MM.SCPU + 0xF4, 0x20041001);
    // JS-only fault point (checks/lib/pred.mjs): a second command store, so om1.scpu prints two command lines; only the stderr
    // predicate counts them (the stored command reads back the same)
    if (fault('nav-scpu-command')) access(new Uint8Array([0x60]), MM.SCPU + 0xF4, 0x20041001);
    const r = access(new Uint8Array([0x70]), MM.SCPU + 0xF4);
    if (!pred(!(w.fault || r.fault || r.d0 !== 0 || sim.u32(MM.SCPU + 0xF4) !== 0x20041001))) {
      problems.push(`0xf4: write fault ${w.fault}, read ${hx(r.d0)} fault ${r.fault}, stored 0x${sim.u32(MM.SCPU + 0xF4).toString(16).padStart(8, '0')}`);
    }
    for (const [label, code, off] of [['byte load 0x00', [0xF0, 0x40], 0x00], ['byte store 0x00', [0xF0, 0x50], 0x00], ['load 0x04', [0x70], 0x04],
      ['store 0xf0', [0x60], 0xF0], ['load 0xf8', [0x70], 0xF8], ['load 0x80', [0x70], 0x80]]) {
      const rr = access(new Uint8Array(code), MM.SCPU + off);
      if (!pred(rr.fault === 2)) problems.push(`${label}: fault ${rr.fault}, expected a bus error (2)`);
    }
    const err = sim.stderrLines().join('\n') + '\n';
    const count = (s, sub) => s.split(sub).length - 1;
    if (!pred(count(err, 'scpu UNKNOWN') === 7 && count(err, 'om-emu: scpu command 0x20041001') === 1 && err.includes('#1 '))) problems.push(`stderr: ${err.slice(-600)}`);
  } finally { sim.close(); }
  return problems;
}

// ---- reference side
// refs/settings.mjs defaults (shifted by one id in the defaults-shift mutant), overlaid with inputs and writes.
export class Store {
  constructor(refs, settings, inputs, shift = 0) { this.refs = refs; this.settings = settings; this.over = new Map(inputs); this.shift = shift; }
  get(sid) {
    if (this.over.has(sid)) return this.over.get(sid);
    if (this.shift) {
      try { return this.settings.default(sid + this.shift)[0]; } catch (e) {
        if (!(e instanceof this.refs.S.SettingsError)) throw e;
        return this.settings.default(sid)[0] + 1;
      }
    }
    return this.settings.default(sid)[0];
  }
}
const inputs_of = (run) => (run.store ? new Map(run.store.persist.map((x) => [x.id, x.value])) : new Map());

export function compare_capture(run, rec, refs, store, problems, notes) {
  const cap = rec.capture;
  if (!cap) return;
  const st = rec.state, m = st.menu ?? {};
  if (!pred(!(cap.comp !== 'NONE' || cap.vsc.some((v) => v !== 'PAL_UNWRITTEN')))) problems.push(`${run.name} ${rec.token}: composite ${cap.comp} ${show(cap.vsc)}`);
  if (st.screen !== 'page' || (m.tab_id ?? null) !== MM.SETUP_TAB) {
    notes.push(`CAPTURE ${run.name} ${pad2(rec.n)}-${rec.token} not compared (${st.screen}, tab ${show(m.tab_id ?? null)}): pixels pinned by the composite only`);
    return;
  }
  const ref = refs.ref(run.lang, run.layout ?? 1);
  const page = m.page, cursor = m.cursor_row + 1;
  let model;
  try { model = ref.page(page, cursor, store, undefined, refs.MR.ROW_STATE_DEFAULTS.get(page) ?? new Set()); } catch (e) {
    if (!isValueError(e)) throw e;
    problems.push(`${run.name} ${rec.token}: the reference cannot model page ${page} cursor ${cursor}: ${e.message}`);
    return;
  }
  let raster = new refs.MR.Raster(ref, 'skip').run(model.elements);
  const width = Math.floor(cap.windows.get(0).length / 600);
  if (width < ref.W) {
    const full = raster;
    raster = { window: (layer) => {
      const w = full.window(layer), out = new Uint8Array(width * 600);
      for (let y = 0; y < 600; y++) out.set(w.subarray(y * ref.W, y * ref.W + width), y * width);
      return out;
    } };
  }
  let shown = model;
  if (cap.after_evf) shown = { ...model, unverified: [...model.unverified, [null, [800, 0, 800, 599], 'EVF edge pad column 800']] };
  const s = { label: `${run.name} ${pad2(rec.n)}-${rec.token} (page ${page} row ${cursor - 1})`, windows: cap.windows };
  problems.push(...CM.compare_buffers(s, raster, shown));
  rec.model = model;
}

export class Refs {
  static async load() {
    const MR = await import('../refs/menuref.mjs');
    const S = await import('../refs/settings.mjs');
    REFS_LOADED = true;
    return new Refs(MR, S);
  }
  constructor(MR, S) {
    this.MR = MR; this.S = S;
    this.settings = new S.Settings(loadImage(), { sha256: (b) => createHash('sha256').update(b).digest('hex') });
    this.cache = new Map();
  }
  ref(lang, layout = 1) {
    const k = `${lang}/${layout}`;
    if (!this.cache.has(k)) this.cache.set(k, new this.MR.Reference({ lang, layout, image: loadImage(), block: loadBlock(), M, R }));
    return this.cache.get(k);
  }
}

// The page-6 clock row's format from the SCPU seconds since 1970 (UTC, no offset).
function clock_text(epoch) {
  const t = new Date(epoch * 1000), p = (n) => String(n).padStart(2, '0');
  return [`'${p(t.getUTCFullYear() % 100)}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`, `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`];
}

// Group 3 for one script: every step against the Nav reference.
function compare_run(run, refs, mutant, problems, notes) {
  const MR = refs.MR;
  const store = new Store(refs, refs.settings, inputs_of(run), mutant === 'defaults-shift' ? 1 : 0);
  const nav = new MR.Nav(store, { image: loadImage(), M });
  if (mutant === 'updown-swapped') {
    const orig = nav.predict.bind(nav);
    nav.predict = (tok) => orig({ UP: 'DOWN', DOWN: 'UP' }[tok] ?? tok);
  }
  const name = run.name;
  for (const rec of run.steps) {
    const tok = rec.token, flags = rec.flags ?? '';
    const tag = 'n' in rec ? `${name} ${pad2(rec.n)}-${tok}` : `${name} ${tok}`;
    if ('error' in rec) {
      notes.push(`STOP ${tag}: ${cut(splitlines(rec.error)[0], 160)}; awaited 0x${rec.awaited.toString(16).padStart(4, '0')}`);
      if (flags.startsWith('error:') && !pred(rec.error.includes(flags.slice(6)))) problems.push(`${tag}: stopped with ${cut(rec.error, 200)}, expected ${show(flags.slice(6))}`);
      continue;
    }
    const st = rec.state, m = st.menu ?? {};
    const writes = sortedItems(rec.writes.map((w) => [w.id, w.a1]));
    const bad_w = rec.writes.filter((w) => w.d1 !== 0 || w.ret !== 0);
    if (!pred(!bad_w.length)) problems.push(`${tag}: vt+4 writes with d1/return != 0: ${show(bad_w)}`);
    const apply_writes = () => {
      for (const w of rec.writes) store.over.set(w.id, w.a1);
      if (tok.startsWith('SET:')) { const [sid, v] = tok.slice(4).split('=').map((x) => Number.parseInt(x, 10)); store.over.set(sid, v); }
    };
    if (!pred(!(rec.errlog && Object.keys(rec.errlog).length))) problems.push(`${tag}: firmware error log ${show(rec.errlog)}`);
    notes.push(`STEP ${tag} ${st.screen} panel ${st.panel} hooks ${rec.hook_stops} sets ${rec.gesetevent} engine ${rec.engine_commands}`);
    if (flags.includes('free')) {
      apply_writes();
      compare_capture(run, rec, refs, store, problems, notes);
      continue;
    }
    let p;
    try { p = nav.predict(tok); } catch (e) {
      if (!(e instanceof MR.NavRefusal)) throw e;
      problems.push(`${tag}: the reference refuses: ${e.message}`);
      apply_writes();
      continue;
    }
    apply_writes();
    if (p.screen === 'ok') {
      if (!pred(st.screen === 'sub' || st.screen === 'popup')) problems.push(`${tag}: OK gave screen ${st.screen}, expected a sub-screen or popup`);
      notes.push(`SUBSCREEN ${name} page ${show(m.page ?? null)} row ${show(m.cursor_row ?? null)}: ${st.screen} panel ${st.panel}`);
      nav.screen = st.screen;
      p.screen = st.screen;
    }
    const closed = st.screen === 'closed';
    const got = { screen: st.screen, tab_id: closed ? null : m.tab_id ?? null, page: closed ? null : m.page ?? null, row: closed ? null : m.cursor_row ?? null };
    const want = { screen: p.screen, tab_id: p.tab_id, page: p.page, row: p.row };
    const pw = sortedItems(p.writes);
    if (!pred(deepEqual(got, want) && deepEqual(writes, pw))) problems.push(`${tag}: lab ${show(got)} writes ${show(writes)}; reference ${show(want)} writes ${show(pw)}`);
    if (st.screen !== 'closed' && (m.tab_id ?? null) !== null) {
      const mem = st.store;
      const g = mem.has(1881) ? mem.get(1881) : null;
      if (!pred(deepEqual(g, store.get(1881)))) problems.push(`${tag}: getter 1881 ${show(mem)} vs store ${store.get(1881)}`);
    }
    compare_capture(run, rec, refs, store, problems, notes);
  }
}

// Group 4: on every Setup page visited at a capture, the variable 226 value records equal value_record.
function check_defaults_rows(runs, refs, problems, notes) {
  const seen = new Set();
  for (const run of runs) {
    for (const rec of run.steps) {
      if (!('model' in rec) || rec.var === null || rec.var === undefined) continue;
      const m = rec.var;
      if (seen.has(m.page_id) || !['N1', 'N2'].includes(run.name)) continue;
      seen.add(m.page_id);
      const ref = refs.ref(run.lang);
      rec.model.var.rows.forEach((row, r) => {
        const got = m.values[r], want = row.value;
        if (want === null && row.source === 'none') return;
        if (row.source === 'handler') {
          notes.push(`UNVERIFIED-VALUE page ${m.page} row ${r} mode ${row.mode} handler ${h8(ref.handlers.get(row.mode))}`);
          return;
        }
        const g = { type: got.type, literal: got.literal, id: [3, 12, 7, 8].includes(got.type) ? got.image : got.type ? got.string : 0 };
        const w = { type: want.type, literal: [1, 2, 5, 6, 7, 8, 9, 10, 11].includes(want.type) ? want.literal : null, id: want.id };
        if ([3, 12, 4].includes(got.type)) { g.literal = null; w.literal = null; }
        if (!pred(deepEqual(g, w))) problems.push(`page ${m.page} row ${r} mode ${row.mode}: variable 226 value ${show(g)}, reference (${row.source}) ${show(w)}`);
      });
    }
  }
  return sortNum(seen);
}

function offline_group(refs) {
  const problems = refs.S.self_test(refs.settings);
  const img = new M.Image(loadImage());
  const t = M.tab_entry(img, MM.SETUP_TAB);
  let rows = 0;
  const langs = sortNum(R.languages(img.d, loadBlock()).map((e) => e.setting));
  const nodesc = [];
  for (const p of t.pages) {
    for (const [mode, info] of M.store_reads(img, p)) {
      rows += 1;
      const allowed = refs.settings.allowed(mode);
      if (allowed === null) {      // not a predicate: the modes without a descriptor list (data)
        nodesc.push(mode);
        if (mode === 3009 && !pred(deepEqual(sortNum(info.keys), langs))) problems.push(`3009: value-list keys ${show(sortNum(info.keys))} != language settings ${show(langs)}`);
        continue;
      }
      if (!pred(deepEqual(allowed, info.keys))) problems.push(`store id ${mode} (page 0x${p.toString(16)} row ${info.row}): descriptor list ${show(allowed)} != value-list keys ${show(info.keys)}`);
    }
  }
  if (!pred(deepEqual(nodesc, [1072, 3009]))) problems.push(`ids without a descriptor ${show(nodesc)}, expected [1072, 3009]`);
  const d = img.d, offs = new Map();
  for (let i = indexOf3(d, 0); i >= 0; i = indexOf3(d, i + 1)) inc(offs, d[i - 1]);
  const modelled = sortNum([...offs.keys()].filter((o) => SCPU_OFFSETS.has(o)));
  const unknown = sortNum([...offs.keys()].filter((o) => !SCPU_OFFSETS.has(o)));
  const MR = refs.MR;
  const mk = (values) => ({ get: (k) => (values.has(k) ? values.get(k) : 1) });
  const pt = (p) => [p.tab_index, p.page, p.row];
  let nav = new MR.Nav(mk(new Map([[1881, 7], [1882, 1]])), { image: loadImage(), M });
  for (const [tok, want] of [['OPEN', [6, 1, 0]], ['UP', [6, 1, 5]], ['DOWN', [6, 1, 0]], ['LEFT', [5, 5, 0]], ['RIGHT', [6, 1, 0]],
    ['SUB-1', [7, 1, null]], ['RIGHT', [0, 1, 0]], ['MAIN-1', [7, 1, null]], ['SUB+1', [6, 1, 0]]]) {
    const p = nav.predict(tok);
    if (!pred(deepEqual(pt(p), want))) problems.push(`Nav ${tok}: ${show(p)} != ${show(want)}`);
  }
  for (const tok of ['UP:long', 'OPEN']) {
    try { nav.predict(tok); if (!pred(false)) problems.push(`Nav predicts ${tok} (not observed)`); } catch (e) { if (!(e instanceof MR.NavRefusal)) throw e; }
  }
  nav.predict('INFO');
  try { nav.predict('LEFT'); if (!pred(false)) problems.push('Nav predicts LEFT with the help shown (not observed)'); } catch (e) { if (!(e instanceof MR.NavRefusal)) throw e; }
  nav.predict('INFO');
  nav.predict('DOWN');
  nav.predict('DOWN');
  try { nav.predict('OK'); if (!pred(false)) problems.push('Nav predicts OK on an unselectable row'); } catch (e) { if (!(e instanceof MR.NavRefusal)) throw e; }
  const seqCheck = (label, store, seq) => {
    const nv = new MR.Nav(store, { image: loadImage(), M });
    for (const [tok, want, writes] of seq) {
      const p = nv.predict(tok);
      const gotWrites = tok === 'OPEN' ? p.writes.length : p.writes;
      if (!pred(deepEqual(pt(p), want) && deepEqual(gotWrites, writes))) problems.push(`Nav ${label}${tok}: ${show(p)} != ${show(want)} writes ${show(writes)}`);
    }
  };
  seqCheck('(1914 = 6) ', mk(new Map([[1881, 7], [1882, 1], [1914, 6]])), [['OPEN', [6, 1, 5], 4], ['RIGHT', [6, 2, 0], []], ['LEFT', [6, 1, 0], []], ['SUB-1', [7, 1, null], []],
    ['MENU', [null, null, null], [[1881, 8], [1920, 2]]]]);
  seqCheck('(My Menu backwards) ', mk(new Map([[1881, 1], [1882, 1]])), [['OPEN', [0, 1, 0], 4], ['LEFT', [7, 1, null], []], ['MENU', [null, null, null], [[1881, 8], [1882, 5], [1924, 2]]],
    ['OPEN', [7, 1, null], 4], ['MENU', [null, null, null], []], ['OPEN', [7, 1, null], 4], ['LEFT', [6, 6, 0], []], ['MENU', [null, null, null], [[1881, 7], [1882, 6]]]]);
  const refused = (label, values, tokens) => {
    const nv = new MR.Nav(mk(values), { image: loadImage(), M });
    try {
      for (const tok of tokens) nv.predict(tok);
      if (!pred(false)) problems.push(`Nav predicts ${label} (not observed)`);
    } catch (e) {
      if (e instanceof MR.NavRefusal) return;
      if (!pred(false)) problems.push(`Nav ${label}: ${e?.name}: ${e?.message}`);
    }
  };
  refused('OPEN on My Menu with 1882 = 3', new Map([[1881, 8], [1882, 3]]), ['OPEN']);
  refused('OPEN with 1881 = 99 (no tab entry)', new Map([[1881, 99], [1882, 1]]), ['OPEN']);
  refused('OPEN with cursor memory 1914 = null', new Map([[1881, 7], [1882, 1], [1914, null]]), ['OPEN']);
  refused('INFO on My Menu (no rows)', new Map([[1881, 8], [1882, 5]]), ['OPEN', 'INFO']);
  refused('OK on My Menu (no rows)', new Map([[1881, 8], [1882, 1]]), ['OPEN', 'OK']);
  const persist = MM.persist_ids(img);
  const missing = sortNum(new Set(M.tabs(img).flatMap((tt) => tt.aux).filter((sid) => !persist.has(sid))));
  if (!pred(!missing.length)) problems.push(`S-PERSIST does not list the cursor memories ${show(missing)}`);
  return [problems, rows, modelled, unknown, offs];
}
// d.find(b'\x00\xe0\x98', from)
function indexOf3(d, from) {
  for (let i = d.indexOf(0x00, from); i >= 0 && i + 2 < d.length; i = d.indexOf(0x00, i + 1)) if (d[i + 1] === 0xE0 && d[i + 2] === 0x98) return i;
  return -1;
}

// Group 7 on the N7 run (and N7C, when it ran).
function b2_group(n7, n7c, notes) {
  const problems = [];
  if (n7.problems.length) return n7.problems.map((x) => `N7: ${x}`);
  const b2 = n7.b2 ?? {};
  const tk = b2.takeover ?? {};
  const conn = tk.connect ?? {};
  const trace = conn.trace ?? [];
  const tr = trace.filter((x) => x[1] !== 'ctrl_or').map((x) => [x[1], x[2], x[4]]);
  const want = [['ConnectChangePlay', 7, null], ['vt+56', 0x50AFCF14, null], ['vt+56 ret', 1, null], ['0x510c91eb ret', 0, null], ['vt+20', 16, null], ['vt+20 ret', 0, null],
    ['SetConnectState', 5, 0x510C6C76], ['SetLayoutMode', 2, null]];
  const got = tr.slice(0, want.length).map(([n, d0, ra], i) => [n, d0, want[i][2] ? ra : null]);
  if (!pred(!(!tk.takeover || !deepEqual(got, want) || tr.length !== want.length || (conn.rpc ?? []).length || !deepEqual(conn.after ?? null, { layout: 2, connect: 5 })))) {
    problems.push(`N7 H-CONNECT: trace ${show(tr.map(([n, d0, ra]) => [n, hx(d0), ra && hx(ra)]))}, rpc ${show(conn.rpc ?? null)}, after ${show(conn.after ?? null)}, takeover ${show(tk.takeover ?? null)}`);
  }
  const q = trace.find((x) => x[1] === 'vt+56 ret') ?? null;
  const gateE = trace.find((x) => x[1] === '0x510c91eb ret');
  const gate = gateE ? gateE[3] : null;
  if (!pred(gate === 0)) problems.push(`N7 H-CONNECT: gate word 0x60375a9c at 0x510c4235 = ${show(gate)}, not 0`);
  notes.push(`B2 N7 ConnectChangePlay: vt+56 0x50afcf14 (query 65803) -> ${show(q && q[2])}, 0x510c91eb locals (settings 304/1265/288, id 44) ${show(q && q[3])}, gate word 0x60375a9c ${show(gate)}`);
  const pads = n7.observed?.get('edge_pad') ?? [];
  const padKeys = sortedItems(pads.map(([t, p, , w, h]) => [p, t, w, h]));
  const wantPads = [0, 0, 1, 1, 2, 2].map((p) => [p, '00-OPEN', 800, 600]);
  if (!pred(deepEqual(n7.pad_widths ?? null, [900, 900, 900]) && deepEqual(padKeys, wantPads))) problems.push(`N7 edge pad: bring-up width words ${show(n7.pad_widths ?? null)}, copies ${show(pads)}`);
  for (const [t, plane, buf, w, h, value] of pads) notes.push(`B2 N7 edge pad ${t} plane ${plane} buffer ${h8(buf)} width ${w} rows ${h} byte 0x${value.toString(16).padStart(2, '0')}`);
  if (n7c && !n7c.problems.length && !pred(!(!deepEqual(n7c.pad_widths ?? null, [900, 900, 900]) || (n7c.observed?.get('edge_pad') ?? []).length))) {
    problems.push(`N7C edge pad: bring-up width words ${show(n7c.pad_widths ?? null)}, copies ${show(n7c.observed?.get('edge_pad') ?? null)}`);
  }
  const steps = n7.steps.filter((r) => 'n' in r);
  const b2trace = b2.trace ?? [];
  const first_open = b2trace.filter((x) => x[0].startsWith('00-OPEN'));
  const cfs = first_open.filter((x) => x[1] === 'ChangeFinderStyle'), slm = first_open.filter((x) => x[1] === 'SetLayoutMode');
  if (!pred(deepEqual(cfs.map((x) => [x[2], x[3], x[4]]), [[3, 1, 0x5120CCDF]]) && deepEqual(slm.map((x) => x[2]), [0]))) problems.push(`N7 OPEN: ChangeFinderStyle ${show(cfs)}, SetLayoutMode ${show(slm)}`);
  const layouts = steps.map((r) => [r.token, (r.layout ?? {}).layout ?? null]);
  if (!pred(!layouts.some(([, v]) => v !== 0))) problems.push(`N7 mode byte per step ${show(layouts)}`);
  const bad_reads = (b2.module9_reads ?? []).filter((x) => !MM.TAKEOVER_READERS.includes(x[1]));
  if (!pred(!bad_reads.length)) problems.push(`N7 module-9 reads outside ChangeOutline ${show(bad_reads)}`);
  const caps = steps.filter((r) => 'capture' in r);
  const pages = sortNum(new Set(caps.filter((r) => r.var).map((r) => r.var.page)));
  if (!pred(deepEqual(pages, [1, 2, 3, 4, 5, 6]))) problems.push(`N7 captured pages ${show(pages)}`);
  for (const r of caps) {
    const c = r.capture;
    if (!pred(!(c.ref.startsWith('MISMATCH') || c.comp !== 'NONE' || !deepEqual(c.errors.map((e) => [e[0], e[1]]), [['PAL_UNWRITTEN', [4, 255]]]) || !(c.assumed & 1) || c.bank.get('CTRL3') !== 0x41))) {
      problems.push(`N7 ${pad2(r.n)}-${r.token}: composite ${c.comp} ${show(c.errors)} assumed ${c.assumed} CTRL3 ${hx(c.bank.get('CTRL3'))}: ${cut(c.ref, 200)}`);
    }
    notes.push(`B2 N7 ${pad2(r.n)}-${r.token} page ${r.var ? r.var.page : null} composite sha256 ${c.sha}`);
  }
  const errStr = (m) => [...m].sort((a, b) => cmpItems(a[0], b[0])).map(([k, v]) => `${k}x${v}`).join(' ');
  if (!pred(!((conn.errlog ?? []).length || (n7c && !n7c.problems.length && !deepEqual(n7.errlog_all, n7c.errlog_all))))) {
    problems.push(`N7 error log: H-CONNECT ${show(conn.errlog ?? null)}, session ${show(n7.errlog_all)}, N7C ${show(n7c ? n7c.errlog_all : null)}`);
  }
  notes.push(`B2 N7 error log ${errStr(n7.errlog_all)}`);
  if (n7c && !n7c.problems.length) {
    const a = n7.steps.find((r) => 'capture' in r).capture.bank, b = n7c.steps.find((r) => 'capture' in r).capture.bank;
    const diff = new Map();
    for (const [k, v] of a) if (v !== b.get(k)) diff.set(k, [b.get(k) ?? null, v]);      // not a predicate: the differing registers, compared whole below
    notes.push('B2 N7 registers vs N7C (layout 1 -> layout 0): ' + sortStr(diff.keys()).map((k) => { const [v0, v1] = diff.get(k); return `${k}=${v0 === null ? null : hx(v0)}->${v1 === null ? null : hx(v1)}`; }).join(' '));
    const dk = sortStr(diff.keys());
    if (!pred(deepEqual(dk, ['CTRL3', 'OSDDMASPOS']) && deepEqual(diff.get('CTRL3'), [1, 0x41]) && !(diff.get('OSDDMASPOS')[1] & 0xFFFFFF))) {
      problems.push(`N7 registers vs N7C: ${show(new Map([...diff].map(([k, v]) => [k, [...v]])))}`);
    }
    const cc = n7c.steps.filter((r) => 'capture' in r)[0].capture;
    if (!pred(!(cc.ref.startsWith('MISMATCH') || cc.assumed || cc.layout.layout !== 1))) problems.push(`N7C: ${cut(cc.ref, 200)} assumed ${cc.assumed} layout ${show(cc.layout)}`);
  } else if (n7c) problems.push(...n7c.problems.map((x) => `N7C: ${x}`));
  return problems;
}

// Group 8 on the N8 run.
function switch_group(n8, refs, notes) {
  if (n8.problems.length) return n8.problems.map((x) => `N8: ${x}`);
  const problems = [];
  const caps = n8.steps.filter((r) => 'capture' in r);
  const devs = caps.map((r) => r.capture.device);
  if (!pred(deepEqual(devs, ['tft', 'evf', 'evf', 'tft', 'tft']))) problems.push(`N8 capture devices ${show(devs)}`);
  for (const r of caps) {
    const c = r.capture;
    if (!pred(!(c.comp !== 'NONE' || !deepEqual(c.errors.map((e) => [e[0], e[1]]), [['PAL_UNWRITTEN', [4, 255]]]) || !deepEqual(c.planc, [0x100, 0x100, 0x100]) || c.ref.startsWith('MISMATCH') || !c.palette.endsWith('formula')))) {
      problems.push(`N8 ${pad2(r.n)}-${r.token} (${c.device}): ${c.comp} ${show(c.errors)} PLANC ${show(c.planc)} palettes ${c.palette}: ${cut(c.ref, 200)}`);
    }
    notes.push(`SWITCH N8 ${pad2(r.n)}-${r.token} ${c.device} assumed ${c.assumed} sha256 ${c.sha}`);
  }
  const shots = caps.filter((r) => r.token === 'SHOT').map((r) => r.capture);
  let diff = null;
  if (shots.length === 3) {
    diff = [];
    const a = shots[0].words, b = shots[2].words;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(i);      // not a predicate: the differing words, compared whole below
  }
  const pads = n8.observed?.get('edge_pad') ?? [];
  if (!pred(deepEqual(n8.pad_widths ?? null, [800, 800, 800]))) problems.push(`N8: bring-up edge-pad width words ${show(n8.pad_widths ?? null)}, expected [800, 800, 800]`);
  if (!pred(!(!pads.length || pads.some(([t, , , w, h]) => t !== '02-SWITCH:evf' || w !== 800 || h !== 600)))) problems.push(`N8: edge pad 0x501db6d5 calls (step, plane, buffer, width, rows, byte) ${show(pads)}`);
  for (const [t, plane, buf, w, h, value] of pads) notes.push(`SWITCH N8 edge pad ${t} plane ${plane} buffer ${h8(buf)} width ${w} rows ${h} byte 0x${value.toString(16).padStart(2, '0')}`);
  const assumed = caps.map((r) => r.capture.assumed);
  if (!pred(deepEqual(assumed, [1, 0, 0, 0, 0]))) problems.push(`N8: A15 in use per capture ${show(assumed)}, expected [1, 0, 0, 0, 0]`);
  if (!pred(!(diff === null || !diff.length || diff.some((i) => i % 900 !== 800)))) {
    problems.push(`N8: the third SHOT differs from the first outside column 800 or not at all (${(diff ?? []).length} px, columns ${show(sortNum(new Set((diff ?? []).map((i) => i % 900))).slice(0, 8))})`);
  } else notes.push(`SWITCH N8 third SHOT vs first: ${diff.length} px differ, all in column 800 (rows ${Math.floor(Math.min(...diff) / 900)}..${Math.floor(Math.max(...diff) / 900)})`);
  const obs = n8.observed ?? new Map();
  if (!pred(!((obs.get('level_apply') ?? []).length || !deepEqual(obs.get('level_step') ?? null, [[16, 0x501C4F54]])))) problems.push(`N8: 0x501c67aa calls ${show(obs.get('level_step') ?? null)}, 0x501c69e5 calls ${show(obs.get('level_apply') ?? null)}`);
  const kinds = n8.kinds ?? new Map();
  const img = new M.Image(loadImage());
  const table = new Map([...DISPLAY_KINDS.values()].map((sid) => [sid, img.u16(KIND_TABLE + 4 * sid)]));
  if (!pred(deepEqual(table, new Map([...DISPLAY_KINDS].map(([k, sid]) => [sid, k]))))) problems.push(`N8: data-object kinds of 587/1947/449/31 in 0x${KIND_TABLE.toString(16)}: ${show(table)}`);
  const want = new Map([...DISPLAY_KINDS].map(([k, sid]) => [k, refs.settings.default(sid)[0]]));
  if (!pred(deepEqual(kinds, want) && deepEqual(want, new Map([[0xE831, 1], [0x4671, 1], [0xD7F9, 0], [0x8279, 0]])))) problems.push(`N8 state kinds ${show(kinds)}, refs/settings.mjs defaults ${show(want)}`);
  if (!pred(!n8.errlog_all.has(h8(TIMER_ERRLOG)))) problems.push(`N8 error log ${show(n8.errlog_all)}`);
  notes.push(`SWITCH N8 kinds ${sortNum(kinds.keys()).map((k) => `0x${k.toString(16).padStart(4, '0')}=${kinds.get(k)}`).join(' ')} error log ${[...n8.errlog_all].sort((a, b) => cmpItems(a[0], b[0])).map(([k, v]) => `${k}x${v}`).join(' ')}`);
  return problems;
}

// Group 6's comparison of the notes: notes (want) and got are Maps kind -> Set; a problem line per kind that differs,
// in kind order.
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

// ---- --jobs: worker_threads, as check_menu's pool
async function* pool_map(jobs, workers) {
  const n = Math.min(workers, jobs.length);
  const pending = new Map();
  let next = 0;
  const results = jobs.map(() => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; });
  const pool = [];
  const dispatch = (w) => {
    if (next >= jobs.length) { w.terminate(); return; }
    const k = next++;
    pending.set(w, k);
    w.postMessage({ k, job: encode(jobs[k]) });
  };
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url), { env: { ...process.env }, workerData: { entry: 'check_nav' }, stdout: false, stderr: false });
    w.on('message', (m) => { results[m.k].resolve(m); pending.delete(w); dispatch(w); });
    w.on('error', (e) => { for (const k of [...pending.values()]) results[k].resolve({ k, crash: String(e?.stack ?? e) }); pending.delete(w); });
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
const JOB_FUNCTIONS = { run_script, run_long_wait, run_language };
function workerMain() {
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
  if (MUTANT && !MUTANTS.has(MUTANT)) throw new SystemExit(`unknown mutant ${show(MUTANT)}`);
  if (write_notes && (mode !== 'default' || MUTANT)) throw new SystemExit('--write-notes pins the default run');
  const t0 = performance.now();
  const failures = [], notes = [];
  const group = (name, problems, ran = true, why = null) => {
    if (!ran && !problems.length) { console.log(`[skip] ${name}: ${why}`); return; }
    console.log(`[${pred(!problems.length) ? 'ok' : 'FAIL'}] ${name}`);
    for (const p of problems) console.log('      ' + cut(p, 700));
    failures.push(...problems);
  };
  const names = mode === 'quick' ? MUTANT_SCRIPTS.get(MUTANT) ?? ['N1'] : [...SCRIPTS.keys()];
  const runs = [];
  const long_wait = mode === 'default' && !MUTANT;
  let long_run = null, long_one = null;
  const language = (mode === 'default' && !MUTANT) || MUTANT === 'lang-no-follow';
  let lang_run = null, lang_control = null;
  const sessionLine = (name, run) => console.log(`  session ${name}: ${run.steps.length} steps, ${run.seconds.toFixed(1)} s` + (run.problems.length ? `; ${cut(run.problems[0], 200)}` : ''));
  if (JOBS > 1) {
    const jobs = names.map((name) => ['check_nav', 'run_script', [name, MUTANT]]);
    if (long_wait) jobs.push(['check_nav', 'run_long_wait', []], ['check_nav', 'run_long_wait', [ONE_SLICE_MS]]);
    if (language) jobs.push(['check_nav', 'run_language', []], ['check_nav', 'run_language', [true]]);
    let k = 0;
    for await (const [[status, run], out, err, guard] of pool_map(jobs, JOBS)) {
      const [, func, args] = jobs[k++];
      process.stdout.write(out);
      process.stderr.write(err);
      if (!pred(!guard)) failures.push('reference modules imported while lab sessions run');
      if (status !== 'ok') throw new FirmwareError(run);
      if (func === 'run_language') { if (args.length) lang_control = run; else lang_run = run; continue; }
      if (func === 'run_long_wait') { if (args.length) long_one = run; else long_run = run; continue; }
      runs.push(run);
      sessionLine(args[0], run);
    }
  }
  for (const name of JOBS <= 1 ? names : []) {
    if (!pred(!REFS_LOADED)) failures.push('reference modules imported while lab sessions run');
    const run = run_script(name, MUTANT);
    runs.push(run);
    sessionLine(name, run);
  }
  if (long_wait && long_run === null) { long_run = run_long_wait(); long_one = run_long_wait(ONE_SLICE_MS); }
  if (language && lang_run === null) { lang_run = run_language(); lang_control = run_language(true); }
  if (lang_run !== null) console.log(`  session language change: ${lang_run.seconds.toFixed(1)} s; zh-CN control ${lang_control.seconds.toFixed(1)} s`);
  if (long_run !== null) console.log(`  session long WAIT: ${long_run.steps.length} steps, ${long_run.seconds.toFixed(1)} s; one-slice control ${long_one ? long_one.seconds.toFixed(1) : null} s`);
  const p1 = mode === 'quick' && MUTANT ? [] : device_group();
  if (!pred(!REFS_LOADED)) failures.push('reference modules imported before the sessions ended');
  const refs = await Refs.load();
  const by = new Map(runs.map((r) => [r.name, r]));

  const [p0, rows, modelled, unknown, offs] = offline_group(refs);
  group(`0 offline: refs/settings.mjs self-test (2529-id default table digest, investigation spot values, allowed lists, region rows); ${rows} getter-backed Setup rows: descriptor list == value-list keys; SCPU immediates: `
    + `${modelled.length} offsets modelled ${show(modelled.map((o) => '0x' + o.toString(16)))}, ${unknown.length} UNKNOWN; Nav rules and refusals`, p0);
  notes.push('SCPU-IMMEDIATES ' + sortNum(offs.keys()).map((o) => `0x${o.toString(16).padStart(2, '0')}:${offs.get(o)}`).join(' '));
  group('1 device: om1.scpu 32-bit storage at 0x00/0x08/0x3c, the clock 0xe8/0xec ticks with the lab clock (0xec takes 0 only), 0xf4 stores and counts a command and reads 0, byte accesses and offsets 0x04/0x80/0xf0/0xf8 are bus errors printed as scpu UNKNOWN', p1,
    !(mode === 'quick' && MUTANT), 'not in a mutant run');

  // ---- 2. store init
  let p2 = [];
  for (const run of runs) {
    const s = run.store;
    if (!pred(!!s)) { p2.push(`${run.name}: no store record`); continue; }
    if (!pred(deepEqual(s.phases.map((x) => x[2]), [MM.REGISTRY_PRINTS, []]) && !s.phases.some((x) => x[3].length))) p2.push(`${run.name}: store phases ${show(s.phases)}`);
    if (!pred(deepEqual(sortStr(s.waits.map((w) => w.flag)), ['0xf5', '0xf6', '0xf7']) && s.waits.every((w) => w.rc === 0)
      && deepEqual(s.requests.map((q) => q.request.slice(0, 2)), ['06', '01', '86']))) p2.push(`${run.name}: S-SCPU requests ${show(s.requests)}, waits ${show(s.waits)}`);
    if (!pred(deepEqual(s.crt, ['0x5005a6d2']) && deepEqual(s.flash, ['0x503c5537']) && deepEqual(s.cflush, new Map([[MM.K_CFLUSH_RETURN, 4]])))) p2.push(`${run.name}: K-CRT-134D ${show(s.crt)}, S-FLASHSAVE ${show(s.flash)}, K-CFLUSH ${show(s.cflush)}`);
    if (!pred(deepEqual([s.scpu['0x00'] ?? null, s.scpu['0xe8'] ?? null, s.scpu['0xec'] ?? null], [0xA8, 0, 0]) && deepEqual(run.scpu_commands.slice(0, 1).map((c) => [c[0], c[2]]), [[0x20041001, 1]]))) {
      p2.push(`${run.name}: SCPU after init ${show(s.scpu)}, commands ${show(run.scpu_commands)}`);
    }
    if (!pred(!s.cover.length)) p2.push(`${run.name}: lab-stub pages over the SCPU block ${show(s.cover)}`);
    if (!pred(deepEqual(s.dial, { board: 0, table: '0x60223dbc' }))) p2.push(`${run.name}: dial table ${show(s.dial)}`);
    notes.push(`STORE ${run.name} K-CFLUSH ${show(sortedItems([...s.cflush].map(([k, v]) => [h8(k), v])))} replies ${show(s.replies.map((r) => [r.reader, r.bytes]))} requests ${s.requests.length} `
      + `SCPU commands ${show(run.scpu_commands.map((c) => [hx(c[0]), hx(disasm(c[1])), c[2]]))}`);
  }
  group('2 store init: FlD. BlD. ElD. MlD., no error log; PER_SCPU carries 0x06, 0x01 and 0x86 to S-SCPUDEV and the native waits on 0xf5/0xf6/0xf7 return E_OK once each, K-CRT-134D and S-FLASHSAVE once and K-CFLUSH 4 times from their listed sites, no lab-stub page over 0x98e00000; SCPU reg0 '
    + `0xa8, e8 = ec = 0, one command 0x20041001; dial table 0x60223dbc (${names.join(', ')})`, p2);
  p2 = [];
  const blank = by.get('N2');
  if (names.includes('N2') && !pred(!!(blank && 'reads' in blank))) p2.push('N2: the blank-camera session recorded no getter reads');
  if (blank && 'reads' in blank) {
    const bad = [];
    for (const [sid, v] of blank.reads) {
      let want;
      try { want = new Store(refs, refs.settings, new Map(), MUTANT === 'defaults-shift' ? 1 : 0).get(sid); } catch (e) {
        if (!(e instanceof refs.S.SettingsError)) throw e;
        notes.push(`DEFAULT-UNPREDICTED ${sid} lab ${v}: ${e.message}`);
        continue;
      }
      if (!pred(v === want)) bad.push([sid, v, want]);
    }
    if (!pred(!bad.length)) p2.push(`native getter != refs/settings.mjs default for (id, lab, reference) ${show(bad)}`);
    p2.push(...(blank.rules ?? []));
    const fw = blank.descriptors ?? new Map();
    const py = new Map();
    for (let sid = 0; sid < DESC_IDS; sid++) { const d = refs.settings.descriptor(sid); if (d) py.set(sid, d.address); }
    const ids = sortNum(new Set([...fw.keys(), ...py.keys()]));
    const diff = ids.filter((sid) => fw.get(sid) !== py.get(sid)).map((sid) => [sid, '0x' + (fw.get(sid) ?? 0).toString(16), '0x' + (py.get(sid) ?? 0).toString(16)]);
    if (!pred(!(diff.length || fw.size < 1500))) p2.push(`descriptor lookup 0x503da999 != refs/settings.mjs descriptor for ${diff.length} of ${fw.size} ids (id, firmware, reference): ${show(diff.slice(0, 6))}`);
    const kf = blank.key_fns ?? new Map();
    const want_kf = new Map();
    for (const sid of refs.settings.custom.keys()) { if (!py.has(sid)) continue; const ks = refs.settings.key_selector(sid); if (ks) want_kf.set(sid, ks[0]); }
    if (!pred(deepEqual(kf, want_kf) && setEq(new Set(kf.values()), new Set(MM.KEY_SELECTORS.keys())))) {
      p2.push(`key selectors (custom object +20) firmware ${show(sortNum(kf.keys()).map((k) => [k, kf.get(k)]))} != refs/settings.mjs ${show(sortNum(want_kf.keys()).map((k) => [k, want_kf.get(k)]))}`);
    }
    notes.push(`DESCRIPTORS ${fw.size} ids: firmware lookup == refs/settings.mjs (first record in table order)`);
    notes.push(`KEY-SELECTORS ${kf.size} ids ` + sortNum(kf.keys()).map((sid) => `${sid}:${h8(kf.get(sid))}`).join(' '));
    notes.push(`PROP4513 native after init ${show(blank.prop4513 ?? null)}`);
    notes.push(`DEFAULTS checked ${blank.reads.size} ids`);
  }
  group('2b blank camera (N2): unlisted callers, a late S-PERSIST and SET/S-PERSIST of a key-selected id raise; native getter == refs/settings.mjs default for every Setup id; descriptor lookup == refs/settings.mjs for ids '
    + '0..16383 and its key-selector ids == refs/settings.mjs', p2, names.includes('N2'), 'N2 not run (--quick)');

  // ---- 3. navigation
  const p3 = [];
  for (const run of runs) {
    p3.push(...run.problems);
    compare_run(run, refs, MUTANT, p3, notes);
  }
  const n3 = by.get('N3');
  if (n3) {
    const steps = new Map(n3.steps.filter((s) => 'n' in s).map((s) => [s.n, s]));
    const sets = [...steps.values()].filter((s) => s.token.startsWith('SET:'));
    if (!pred(sets.length && sets[0].set.read_back === 180)) p3.push(`N3: SET:32=180 read back ${sets.length ? show(sets[0].set) : '[]'}`);
    const cap = [...steps.values()].filter((s) => s.token === 'LEFT' && 'capture' in s);
    const has3min = cap.length && (cap[0].texts.includes('3min') || asText(cap[0].model?.var ?? null).includes('3min'));
    if (!pred(has3min)) p3.push('N3: page 5 after the SET does not draw "3min"');
    const popup = [...steps.values()].filter((s) => s.token === 'OK' && s.writes.length);
    const w = popup.flatMap((s) => s.writes);
    if (!pred(!(w.length !== 1 || w[0].id !== 32 || ![0, 60, 180, 300].includes(w[0].a1) || w[0].a1 === 180))) p3.push(`N3: popup OK writes ${show(w)}, expected one write of 32 with a listed value != 180`);
    else if (!pred(popup[0].reads.get(32) === w[0].a1)) p3.push(`N3: getter 32 after the popup write ${show(popup[0].reads)}`);
    else if (!pred(popup[0].awaited === EV_10MS_WIZARD_MENU)) p3.push(`N3: after the popup OK the GUI awaits 0x${popup[0].awaited.toString(16)}, not 0x9ac6`);
    else notes.push(`POPUP-WRITE N3 32 = ${w[0].a1}; GUI awaits 0x9ac6 EVT_10MS_WIZARD_MENU (Genifa timer 522)`);
  }
  const n3t = by.get('N3T');
  if (n3t) p3.push(...b7_group(n3t, notes));
  const n4 = by.get('N4');
  if (n4) {
    const caps = n4.steps.filter((s) => 'capture' in s);
    const texts = caps.map((s) => s.var.clock[1]);
    const wantT = [clock_text(EPOCH1), clock_text(EPOCH2)];
    if (!pred(caps.length === 2 && deepEqual(texts, wantT))) p3.push(`N4: clock row strings ${show(texts)}, expected ${show(wantT)}`);
    else if (!pred(!range(0, 3).every((l) => bytesEq(caps[0].capture.windows.get(l), caps[1].capture.windows.get(l))))) p3.push('N4: the second epoch did not change the page');
    else {
      const a = caps[0].capture.windows, b = caps[1].capture.windows;
      const xs = [], ys = [];
      for (let layer = 0; layer < 3; layer++) { const A = a.get(layer), B = b.get(layer); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) { xs.push(i % 900); ys.push(Math.floor(i / 900)); } }
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      notes.push(`CLOCK-DIFF N4 second epoch changes ${xs.length} bytes in ${show(box)}`);
      if (!pred(586 <= box[0] && box[2] <= 899 && 205 <= box[1] && box[3] <= 266)) p3.push(`N4: the second epoch changed pixels outside the clock value cell: ${show(box)}`);
    }
  }
  const n1 = by.get('N1');
  if (n1) {
    const p6 = n1.steps.filter((s) => s.var && s.var.page === 6 && s.var.tab_id === 7);
    if (p6.length) notes.push(`CLOCK-EPOCH0 N1 row 1 strings ${show(p6[0].var.clock[1])}`);
  }
  for (const name of ['N3', 'N4', 'N6']) if (names.includes(name) && !pred(by.has(name))) p3.push(`${name}: no run record`);
  group(`3 navigation ${names.join(' ')}: screen, tab, page, row and vt+4 writes == the Nav reference after every predicted step; Setup pages: displayed buffers == refs/menuref.mjs raster (U1 A, store = defaults + inputs + writes)`
    + (names.includes('N3') ? '; N3 SET 32 = 180 -> "3min", one popup write of 32 read back by the getter, then the GUI awaits 0x9ac6 and MENU is deferred into an event storm (B7)' : '')
    + (names.includes('N3T') ? '; N3T (lab time) B7: at T_pred - 1 the GUI awaits 0x9ac6 with the Genifa clock at start + 90, at T_pred it took the event (clock + 100) and closed the popup (popup_confirm), page 5 raster with the written value, '
      + 'MENU writes the cursor memory and closes' : '')
    + (names.includes('N4') ? '; N4 clock row == datetime of the SCPU epoch' : '')
    + (names.includes('N6') ? '; N6 S-PERSIST of My Menu page 5 with memory 1924 = 2: OPEN shows 1/1, MENU writes nothing' : ''), p3);

  const allSteps = runs.flatMap((r) => r.steps.filter((x) => 'hooks' in x));
  const posts = allSteps.flatMap((x) => x.hooks.map((h) => h[0])), settles = allSteps.flatMap((x) => x.hooks.map((h) => h[1]));
  const sets = runs.flatMap((r) => r.steps.filter((x) => 'gesetevent' in x).map((x) => x.gesetevent));
  if (posts.length) {
    const mx = (xs) => xs.reduce((a, b) => (b > a ? b : a));
    notes.push(`BUDGET measured maxima: post ${mx(posts)} hook stops, settle ${mx(settles)}, GESetEvent ${mx(sets)} per step; limits ${N.POST_HOOKS} / ${N.STEP_HOOKS} / ${N.STORM}`);
    console.log(`  measured maxima: post ${mx(posts)}, settle ${mx(settles)}, GESetEvent ${mx(sets)}`);
  }

  // ---- 4. defaults per row
  const p4 = [];
  const pages = check_defaults_rows(runs, refs, p4, notes);
  group(`4 defaults per row: variable 226 value records on ${pages.length} Setup pages == value_record with the refs/settings.mjs defaults (custom handlers listed in the notes)`, p4);

  // ---- 7. B2
  const p7 = [];
  const n7 = by.get('N7'), n7c = by.get('N7C');
  if (n7) p7.push(...b2_group(n7, n7c ?? null, notes));
  group('7 B2 (N7): S-TAKEOVER 0x50ab6299(9, 2) and H-CONNECT sendEvent(0x83, 7): ConnectChangePlay(7), its query vt+56 0x50afcf14 (65803) = 1 so 0x510c91eb = 0, gate word 0x60375a9c = 0, vt+20(16) '
    + '= 0 without S-RPC, SetConnectState(5) returning to 0x510c6c76, mode byte 2; OPEN: ChangeFinderStyle(3, 1) returning to 0x5120ccdf, mode byte 0 (kept after MENU and OPEN), module 9 read only by ChangeOutline; pages '
    + '1..6 displayed buffers == refs/menuref.mjs (layout 0), composite == reference under A15, registers == the EVF menu without the inputs (N7C) except CTRL3 0x41 and OSDDMASPOS 0, error log == N7C\'s (none in the inputs or '
    + 'the steps); edge pad 0x501db6d5: bring-up width words 900 (stand-in order), N7 copies column 800 in the first OPEN only (width 800), N7C never', p7, names.includes('N7'), 'N7 not run in this mode');

  // ---- 8. store-first switch
  const p8 = [];
  const n8 = by.get('N8');
  if (n8) p8.push(...switch_group(n8, refs, notes));
  group('8 store-first switch (N8): SHOT, SWITCH:evf, SHOT, SWITCH:tft, SHOT on the firmware\'s store: every composite status NONE, OSD PLANC 0x100, == reference (A15 for the first TFT capture only), palettes == '
    + 'formula after H-RESEND, only PAL_UNWRITTEN OSD2 index 255; the OSD edge pad 0x501db6d5 runs only in SWITCH:evf (width 800, 600 rows); the third SHOT == the first except column 800 (written by that pad); '
    + '0x501c69e5 never runs, 0x501c67aa only with 16; kinds 0xe831/0x4671/0xd7f9/0x8279 (data-object table 0x606217e4) == refs/settings.mjs defaults of 587/1947/449/31; no 0x19001807', p8,
  names.includes('N8'), 'N8 not run in this mode');

  // ---- 9. long WAIT
  group('9 long WAIT (lab time): WAIT:ms refuses -5, 0, 1e-7, inf, nan; OPEN, WAIT:10500, DOWN: 2 ELAPSE slices to the exact target, GESetEvent above the fixed step budget STORM and within the duration-scaled one, DOWN to row 1; '
    + 'one-slice control: equal GESetEvent, acceptances and DOWN row', long_run ? long_wait_group(long_run, notes, long_one) : [], long_run !== null, 'default run only');
  // ---- 10. language change
  group('10 language change (lab time): Setup page 6, zh-CN in panel 439, OK: 3009 = 5 read natively, S-RES follows (font 19, strings 1), the windows equal a zh-CN session opened at (7, 6, 3)',
    lang_run ? language_group(lang_run, lang_control) : [], lang_run !== null, 'default run and lang-no-follow only');

  // ---- 6. notes
  const p6n = [];
  if (mode === 'default' && !MUTANT) {
    const got = new Map();
    for (const line of notes) {
      const sp = line.indexOf(' '), kind = line.slice(0, sp);
      if (!got.has(kind)) got.set(kind, new Set());
      got.get(kind).add(line.slice(sp + 1));
    }
    if (write_notes) {
      const file = path.join(process.env.OM_NOTES_DIR, 'check_nav_notes.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# check_nav pinned observations (regenerate with --write-notes)\n# STEP <script> <n>-<token> <screen> panel <id> hooks <hook stops> sets <GESetEvent> '
        + 'engine <commands>\n# SUBSCREEN, POPUP-WRITE, STOP: sub-screens, the popup write and the expected stops\n# STORE: stand-in counts and SCPU replies; CLOCK-EPOCH0: page-6 '
        + 'texts with e8 = 0\n' + sortStr(notes).join('\n') + '\n');
      console.log(`wrote ${file}`);
    } else {
      const want = read_notes();
      p6n.push(...notes_problems(want, got));
    }
  }
  group('6 notes == check_nav_notes.txt', p6n, mode === 'default' && !MUTANT, 'compared in the default run only');
  const passed = pred(!failures.length);
  console.log(`${passed ? 'all groups passed' : 'FAILED'} (${failures.length} problem(s), ${runs.length} sessions, ${Math.round((performance.now() - t0) / 1000)} s)`);
  return passed ? 0 : 1;
}
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

async function run_mutants() {
  let bad = 0;
  const problems = await CM.timeout_cleanup();
  const clean = pred(!problems.length);
  bad += clean ? 0 : 1;
  console.log(`[${clean ? 'ok' : 'FAIL'}] a child spinning the guest on bra . killed on timeout leaves no child and no temporary directory`);
  for (const [name, what] of MUTANTS) {
    const envv = { ...process.env, OM_NAV_MUTANT: name };
    delete envv.OM_RNG_TAPE;
    const [rc, text] = await CM.run_child([process.execPath, new URL(import.meta.url).pathname, '--quick'], envv, 900);
    const out = splitlines(text.trim());
    const fails = out.filter((line) => line.startsWith('[FAIL]'));
    const ok = pred(rc === 1 && !hasStack(out) && out.length && out.at(-1).startsWith('FAILED') && fails.length);
    bad += ok ? 0 : 1;
    console.log(`[${ok ? 'ok' : 'FAIL'}] mutant ${name} (${what}): exit ${rc}, ${fails.length} [FAIL] group(s)`);
    if (!ok) console.log(out.slice(-12).map((line) => '      ' + line).join('\n'));
  }
  const allOk = pred(!bad);
  console.log(`${allOk ? 'all mutants reported' : 'FAILED'} (${bad} problem(s))`);
  return allOk ? 0 : 1;
}

export async function main(argv) {
  const a = parseArgs('check_nav.mjs', argv, [
    { opt: '--quick', type: 'flag' },
    { opt: '--write-notes', type: 'flag' },
    { opt: '--mutants', type: 'flag' },
    { opt: '--jobs', type: 'int', metavar: 'N' },
  ]);
  const jobs = a.jobs ?? 1;
  if (jobs < 1) a.error('--jobs must be positive');
  JOBS = jobs;
  if (a.mutants) return run_mutants();
  // check() raises its own SystemExit for --write-notes with --quick or a mutant before anything runs;
  // otherwise --write-notes needs OM_NOTES_DIR, the directory to write the notes in
  if (a.write_notes && !(a.quick || MUTANT) && !process.env.OM_NOTES_DIR) a.error('--write-notes: needs OM_NOTES_DIR (the directory to write check_nav_notes.txt in)');
  return check(a.quick ? 'quick' : 'default', !!a.write_notes);
}

if (!isMainThread && workerData?.entry === 'check_nav') workerMain();
else if (import.meta.url === `file://${process.argv[1]}`) runMain('check_nav.mjs', main);
