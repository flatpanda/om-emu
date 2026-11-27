// Navigating the Setup Menu (NavLab's observers,
// NavSession's bring-up with seeds, post / settle, step records, every token, press, dial, set, get, clock, switch,
// screenshot, wait, wait_until, state(), decode_record, decode_var226, screen_of). The module globals NAV_PRI and
// WAIT_SLICE_MS, which check_nav rebinds for a session, are live bindings with setters here (setNavPri,
// setWaitSliceMs). screenshot writes through env.writeOutputs (PNG and zlib live in
// checks/lib/png.mjs, so src/ stays Worker-safe); the session's out directory is a relative path the writer resolves.
import { A, ON_LAB_MODEL } from '../fw/model.mjs';
import * as D from './display.mjs';
import * as K from './kernel.mjs';
import * as MM from './menu.mjs';
import * as M from './menudata.mjs';
import { FirmwareError, disasm, runtime, where } from './hle.mjs';
import { ValueError, IndexError, lookup } from './errors.mjs';
import { Unported } from '../core/mem.mjs';
import { show } from '../util/show.mjs';
import { decimalInt, intLiteral, decimalNumber } from '../util/parse.mjs';
import { pack, bytesHex } from '../util/bytes.mjs';
import { hexDigits as fx } from '../util/hex.mjs';
import { Tally } from '../util/tally.mjs';
import { dispsyncFacts, observeDispsync, releaseDispsync } from './dispsync.mjs';

export let NAV_PRI = 50;
export const POST_HOOKS = 140, STEP_HOOKS = 40000, STORM = 810;
export const WAIT_STORM_PER_MS = 0.4, WAIT_HOOKS_PER_MS = 9;
export let WAIT_SLICE_MS = 10000;
export function setNavPri(v) { NAV_PRI = v; }
export function setWaitSliceMs(v) { WAIT_SLICE_MS = v; }
export const SHOW_PANEL = A(0x5124F726), VAR_SET = A(0x51090EA1), VAR_MENU = 226, VAR_SIZE = 2428, MENU_PANEL = M.MENU_PANEL;
// sendEvent's indices of the keys (on; on + 1 long; on + 2 off), INFO, the dials ([index, the S-DIAL counter slot]),
// the menu's open and close: E143's (D: its event map EV_MAP). A session posts each at its build's index of E143's
// message (MESSAGES; NavSession.index_of, the rule of S-TOUCHMAP, src/lab/play.mjs): the event maps of E137, E142,
// E140, E125, E130, E133 and the E118 family lack E143's 107 and 108, so from there on each message sits two indices
// lower (OPEN's 0x9624 at 0x85, E143's 0x87 being 0x9628 there; X, each image's map, docs/model-survey.md findings 75
// and 160), while the keys', INFO's and the dials' indices are E143's on every body (X)
export const KEYS = { UP: 8, DOWN: 11, LEFT: 14, RIGHT: 17, OK: 20, MENU: 23 };
export const INFO = [37, 38];
export const DIALS = { MAIN: [59, 2], SUB: [60, 3] };
export const OPEN = 0x87, CLOSE = 0x88, NO_MESSAGE = 0x7FFF, STATE_CLOSED = 0x0104;
// E143's message of each index above
export const MESSAGES = new Map([[8, 0x9004], [9, 0x9036], [10, 0x9005], [11, 0x9006], [12, 0x9037], [13, 0x9007],
  [14, 0x9008], [15, 0x9034], [16, 0x9009], [17, 0x900A], [18, 0x9035], [19, 0x900B], [20, 0x900C], [21, 0x903E],
  [22, 0x900D], [23, 0x900E], [24, 0x9040], [25, 0x900F], [37, 0x9014], [38, 0x9015], [59, 0x9032], [60, 0x9031],
  [OPEN, 0x9624], [CLOSE, 0x9625]]);
export const REDISPLAY = A(0x510BD84B), HELP_FLAG = 2421;

const h4 = (v) => '0x' + fx(v >>> 0, 4);
const h8 = (v) => '0x' + fx(v >>> 0, 8);
// H-GUICONNECT (NavSession gui_connect): the TFT's lOutput in the connect message (the application's start's, X on
// E118), and the span before the GUI task's take its gate is read in (E118's gate 0x39 bytes before the take
// 0x50b93379, E120's 0x509140a9 before 0x509140e2, D)
export const CONNECT_TFT = 2, CONNECT_GATE_SPAN = 0x60;
// The connect message on a build without the gate: E143's message at sendEvent index MM.CONNECT_EVENT (131, play's
// H-CONNECT index), 0x9601, posted at the build's index of it (two lower on the shifted maps, 129, X)
export const CONNECT_MESSAGE = 0x9601;
// S-DISPSYNC (NavSession dispsync_release): the releases one step may make (play's bound, src/lab/camapp.mjs pump)
export const DISPSYNC_RELEASES = 20;
const GATE = [0xfa, 0xb4, 0x8c, 0x01, 0xfc, 0xc8], GATE_TAIL = [0x00, 0x00, 0xc9];
// The message the GUI task's gate waits for: `mov (396,sp),d0; cmp imm32,d0; bne` (fa b4 8c 01, fc c8 imm32, c9)
// within CONNECT_GATE_SPAN bytes before the take (src/lab/menu.mjs DISPATCH, fact 'menu.take'); null where there is
// none, or where the take is the lab's own (E143)
export function connect_gate(image) {
  if (ON_LAB_MODEL) return null;
  const take = MM.DISPATCH - 0x50000000, at = (o, bytes) => bytes.every((b, k) => image[o + k] === b);
  const found = [];
  for (let o = Math.max(0, take - CONNECT_GATE_SPAN); o < take; o++) {
    if (at(o, GATE) && at(o + 8, GATE_TAIL)) found.push(image[o + 6] | image[o + 7] << 8);
  }
  if (found.length > 1) throw new NavError(`H-GUICONNECT: ${found.length} gates before the GUI's take ${h8(MM.DISPATCH)}`);
  return found.length ? found[0] : null;
}
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);   // table[key] for an own key, else undefined
// an integer literal x of token t (decimal, 0x, 0o, 0b)
function integer(t, x) {
  const v = intLiteral(x);
  if (v === null) throw new ValueError(`${t}: ${show(x)} is not an integer`);
  return v;
}
const utf16 = new TextDecoder('utf-16le');
const zstr = (b) => utf16.decode(b).split('\0')[0];
const u16 = (b, o) => b[o] | b[o + 1] << 8;
export const dial_counters = (slot) => MM.DIAL_COUNTERS + 16 * slot;

export class NavError extends FirmwareError {}

// 108-byte value/label record (0x51188203).
export function decode_record(raw) {
  const lit = zstr(raw.subarray(12, 108));
  return { type: u16(raw, 0), image: u16(raw, 2), string: u16(raw, 4), style: u16(raw, 6), edge: u16(raw, 8), literal: lit || null };
}
// Variable 226 as the viewer wrote it.
export function decode_var226(raw, img) {
  const tabs = Array.from(raw.subarray(0, 8));
  let cur = tabs.findIndex((b) => b === 1 || b === 2);
  if (cur < 0) cur = null;
  const bgs = [];
  for (let k = 0; k < 7; k++) bgs.push([raw[2289 + 2 * k], raw[2290 + 2 * k]]);
  const at = (a, b) => bgs.findIndex((t) => t[0] === a && t[1] === b);
  let cursor, f;
  if (at(1, 5) >= 0) { cursor = at(1, 5); f = 1; }
  else if (bgs.filter((t) => t[0] === 2 && t[1] === 11).length === 1) { cursor = at(2, 11); f = 2; }
  else { cursor = null; f = null; }
  const labels = [], values = [];
  for (let r = 0; r < 7; r++) {
    labels.push(decode_record(raw.subarray(132 + 108 * r, 240 + 108 * r)));
    values.push(decode_record(raw.subarray(888 + 108 * r, 996 + 108 * r)));
  }
  const rows = labels.filter((x) => x.type).length;
  const clock = [];
  for (let r = 0; r < 7; r++) clock.push([zstr(raw.subarray(1644 + 20 * r, 1664 + 20 * r)), zstr(raw.subarray(1784 + 18 * r, 1802 + 18 * r))]);
  const out = { tabs, tab_index: cur, page: raw[128], pages: raw[129], cursor_row: cursor, f, rows, bgs,
    title: decode_record(raw.subarray(20, 128)), labels: labels.slice(0, rows), values: values.slice(0, rows),
    number: zstr(raw.subarray(10, 16)), clock };
  out.tab_id = null; out.page_id = null; out.cursor_memory_id = null;     // in this key order
  if (cur !== null) {
    const t = M.tabs(img)[cur], page = out.page;
    out.tab_id = t.id;
    out.page_id = page >= 1 && page <= t.pages.length ? t.pages[page - 1] : null;
    out.cursor_memory_id = page >= 1 && page <= t.aux.length ? t.aux[page - 1] : null;
  }
  return out;
}
// closed (GUI 0x0104), sub (a panel other than 329 shown last), popup, help, page; 'unknown' otherwise.
export function screen_of(state, v) {
  const gui = parseInt(state.gui, 16);
  if (gui === STATE_CLOSED) return 'closed';
  if (gui !== MM.STATE_MENU || v === null) return 'unknown';
  if (state.panel !== MENU_PANEL) return 'sub';
  if (state.menu?.f === 2) return 'popup';
  if (v[HELP_FLAG] === 1) return 'help';
  return 'page';
}

// MenuLab (native store) + observers for navigation: panels shown, variable 226, menu writes (vt+4).
export class NavLab extends MM.MenuLab {
  constructor(env, opts = {}) { super(env, { ...opts, store: 'native' }); }
  preinit(opts) {
    this.panels = [];
    this.var226 = null;
    this.var226_steps = [];
    this.var226_log = [];
    this.writes = [];
    this.write_sites = new Map();
    this.step_tag = 'bring-up';
    this.posting = false;
    this.step_sets = 0;
    this.step_queued = 0;
    this.pending_events = new Set();
    this.step_storm = STORM;
    this.set_callers = new Tally();
    super.preinit({ ...opts, store: 'native' });
  }
  native_init() {
    super.native_init();
    this.observe(SHOW_PANEL, (lab, r) => lab.panels.push([lab.step_tag, r.d0 & 0xFFFF]), 'obs-showpanel');
    // variable 226 is E143's menu viewer record (2428 bytes, set at one place, D); on another build 226 is another
    // variable (E142 and E140: 2 bytes, E144: 382, E146: 152, at the port's place of the setter, D) and the record
    // is not identified, so only E143's is observed
    if (ON_LAB_MODEL) this.observe(VAR_SET, (lab, r) => this._var(lab, r), 'obs-var226');
    this.hook(MM.API_WRITE, (h, r) => this._vt4(h, r), 'obs-vt4', true);
    // The event storm guard counts the GESetEvent calls that queue an event. GESetEvent does not queue an event that is
    // already pending (E143's SET_EVENT: 0x1002 and 0x1100 by their pending bytes, the others by a scan of the pending
    // list, D; the addresses are in docs/model-survey.md, 2026-11-02), so a set of an event set and not taken since
    // does no work: the lab counts it as pending from its set to its take (I: the dispatch takes it off the list). The
    // E142 lineage's menu open sets 0x1002 about 980 times and takes it 3 times (X), which a count of every call
    // refused as a storm; a GUI that defers an event into itself again (check_nav N3's MENU) takes it before each set,
    // so every set counts
    this.wrap(MM.DISPATCH, (take) => (hle, r) => {
      if (this.posting) throw new NavError(`GUI ran during post (dispatch ${h8(MM.DISPATCH)} reached before sendEvent returned): the lab task does not outrank the GUI task`);
      this.pending_events.delete(this.sim.u32(r.sp + 396));
      return take(hle, r);
    });
    this.wrap(MM.SET_EVENT, (put) => (hle, r) => {
      this.step_sets += 1;
      this.set_callers.add(h8(disasm(r.mdr)));
      const id = this.sim.u32(r.sp + 28);
      if (!this.pending_events.has(id)) {
        this.pending_events.add(id);
        this.step_queued += 1;
        if (this.step_queued > this.step_storm) throw new NavError(`event storm: more than ${this.step_storm} GESetEvent calls in step ${this.step_tag}`);
      }
      return put(hle, r);
    });
  }
  _var(lab, r) {
    if ((r.d0 & 0xFFFF) === VAR_MENU) {
      if (r.d1 !== VAR_SIZE) throw new NavError(`variable 226 set with size ${r.d1} from ${where(r.mdr)}`);
      this.var226 = this.sim.read(r.a0, VAR_SIZE);
      this.var226_steps.push(this.step_tag);
      this.var226_log = [...this.var226_log, [this.step_tag, this.var226]].slice(-4);
    }
  }
  // Observer of API vt+4 (the menu's settings write); the return value is taken at the return address.
  _vt4(hle, r) {
    this.writes.push({ step: this.step_tag, id: r.d0 & 0xFFFF, d1: r.d1, a1: r.a1, caller: h8(disasm(r.mdr)), ret: null });
    const ra = r.mdr;
    if (!this.write_sites.has(ra)) {
      if (this.hooks.has(ra)) throw new NavError(`vt+4 returns to ${where(ra)}, which is already hooked: return value not observable`);
      this.write_sites.set(ra, []);
      this.hooks.set(ra, [(h, r2) => this._vt4_return(h, r2), 'obs-vt4-return', true]);
    }
    this.write_sites.get(ra).push(this.writes.length - 1);
    this.passthrough(r);
  }
  _vt4_return(hle, r) {
    const pending = this.write_sites.get(r.pc);
    this.writes[pending.pop()].ret = r.d0;
    if (!pending.length) { this.write_sites.delete(r.pc); this.hooks.delete(r.pc); }
    this.passthrough(r);
  }
}

// with NavSession: the keyword arguments as kw (lang, device, u1, start, seed, open_menu, png, tag, store_first,
// evf_layout, b2_options, a15, time, hdmi: the lab's H-GIOSLOTS for a machine with the HDMI port); env as for the lab.
export class NavSession {
  static lab_class = NavLab;
  constructor(env, kw = {}) {
    const k = { lang: 'en', device: 'tft', u1: 'skip', start: [MM.SETUP_TAB, 1, 1], seed: null, open_menu: true, out: null,
      png: 'each', tag: 'nav', store_first: false, evf_layout: false, b2_options: null, a15: false, time: false, hdmi: false, ...kw };
    if (k.evf_layout && k.device !== 'evf') throw new ValueError('--evf-layout: EVF only');
    this.env = env;
    this.store_first = k.store_first; this.evf_layout = k.evf_layout; this.b2_options = k.b2_options ?? {}; this.a15 = k.a15;
    this.time = k.time; this.hdmi = k.hdmi;
    this.lang = k.lang; this.device = k.device; this.u1 = k.u1; this.start = k.start;
    this.seed = k.seed instanceof Map ? new Map(k.seed) : new Map(Object.entries(k.seed ?? {}).map(([s, v]) => [+s, v]));   // a Map keeps the dict's order
    this.open_menu = k.open_menu; this.png = k.png; this.tag = k.tag;
    this.out = k.out ? String(k.out) : k.tag;           // default: the tag; env.writeOutputs resolves it
    this.steps = [];
    this.img = new M.Image(env.rom);
    this.lab = null;
    this.clock_inputs = [];
    this.gui_connected = null;          // H-GUICONNECT (gui_connect)
    this.dispsync = null;               // S-DISPSYNC (dispsync_install): the device codes with a synced request waiting
    this.dispsync_fns = null;
    this.dispsync_released = [];        // S-DISPSYNC: [step tag, device code] of each release
  }
  get lab_class() { return this.constructor.lab_class; }
  enter() {
    const t0 = performance.now();
    let inputs = new Map();
    if (this.start !== null) {
      if (this.start.length !== 3) throw new ValueError(`start ${show(this.start)}: [tab, page, cursor]`);
      [, , inputs] = MM.inputs_for(this.img, this.start[0], this.start[1], this.start[2]);
    }
    for (const sid of this.seed.keys()) if (!this.scalar_hint(sid)) throw new ValueError(`seed ${sid}: not a Setup row store id`);
    this.lab = new this.lab_class(this.env, { lang: this.lang, inputs, seed: this.seed, key_mode: this.u1,
      store_first: this.store_first, evf_layout: this.evf_layout, time: this.time, hdmi: this.hdmi });
    this.lab.b2_options = { ...this.b2_options };
    try {
      this.lab_created(this.lab);
      if (this.a15) this.lab.assume('A15', true);
      if (!this.lab.gui_by_app) this.dispsync_install();                    // S-DISPSYNC (the application's own in play)
      this.lab.bring_up(this.device);
      const [rc] = this.lab.nk.svc('chg_pri', { d0: 0, d1: NAV_PRI });
      if (rc !== K.E_OK) throw new NavError(`chg_pri(TSK_SELF, ${NAV_PRI}) = ${rc}`);
      if (!this.lab.gui_by_app && !this.evf_layout) this.gui_connect();     // H-GUICONNECT (H-CONNECT's own on the EVF layout)
      if (this.dispsync?.size) { this.begin('S-DISPSYNC bring-up'); this.dispsync_release(); }
      this.lab.phase = 'nav';
      this.lab.menu_first = this.lab.exec_history.length;
      this.lab.menu_draw_first = this.lab.draw_log.length;
      this.bringup_seconds = Math.round((performance.now() - t0) / 100) / 10;   // wall seconds, to 0.1
      if (this.open_menu) this.step('OPEN');
    } catch (e) {
      this.close();
      throw e;
    }
    return this;
  }
  // H-GUICONNECT: on a build whose GUI task, before its message loop, waits in a loop of its own for the output's
  // connect message and drops every other (E118 0x50b93333..0x50b9334a: `mov (396,sp),d0; cmp 38401,d0; bne` back to
  // its receive; E120 0x509140a9; src/fw/facts.mjs guiTake's comment, D), the session posts that message once after
  // the bring-up, at the build's index of it, with the device's lOutput, and settles: the GUI takes it, runs its
  // connect (E118 0x50b8c4d7) and enters its loop, in POWER_ON. In a play session the application sends it at its
  // start (X, E118: the GUI's gate passed with {0x9601, 0xfffe, 0, 2}, lOutput 2 on the TFT), which nav does not run;
  // without it every key, OPEN included, was dropped at the gate and the GUI stayed at POWER_ON (X, E118 and E120,
  // docs/model-survey.md finding 162). lOutput: the TFT's 2, as the application's start; the EVF's 7, H-CONNECT's
  // (src/lab/menu.mjs CONNECT_LOUTPUT). The gate is read at its bytes before the take (MM.DISPATCH, within
  // CONNECT_GATE_SPAN bytes).
  // The TFT's layout (2026-11-24): on a build without the gate the GUI takes keys unconnected, but its layout stays the
  // one its WinMain set, SetLayoutMode(1) (the byte LAYOUT_BYTE 1 after the bring-up on all 19 bodies, X), until the
  // connect's handler resets it: ConnectChangePlay -> CCommon::resetCoordinate (its log text on E129, 0x50c22469;
  // E143's 0x510c857d), which reads a key (0 at the TFT's connect, X on both), looks it up in its table of {key,
  // handler} (E143 0x6132c2cc, E129 0x6128d6e0; keys 0..2 one handler, below 1 `blt` to it) and calls SetLayoutMode
  // with the handler's mode. That handler goes on E143 to `mov 1,d0` (0x510c85bf -> 0x510c8601) and on E129 to
  // `clr d0` (0x50c224ba -> 0x50c22515), D. Mode 1 picks the widgets' wider rects (docs/om1-menu-spec.md "Layout
  // mode"), which on the TG-5s' 640-wide canvas put the value column and the right half of "Set" past the canvas's
  // edge (X, E129 and E132; play, whose application sends the connect at its start, shows layout 0 and both). So on
  // the TFT the session posts the connect on every ported body, as the application's start does in play: E143's
  // CONNECT_MESSAGE at the build's index of it, lOutput 2. Layout 1 -> 0 on E129 and E132, 1 -> 1 on the 16 other
  // ported bodies (X); E143, the lab model, whose checked sessions run without it, and the EVF without the gate run
  // none (E143's TFT handler keeps layout 1, D above). gui_connected: null, or {index, message, loutput, gate (the
  // GUI waits for it), layout: [the byte before, after]}
  gui_connect() {
    this.gui_connected = null;
    const gate = connect_gate(this.lab.image);
    if (gate === null && (ON_LAB_MODEL || this.device !== 'tft')) return;
    const message = gate ?? CONNECT_MESSAGE;
    let index = 1;
    for (; index <= 334 && this.message(index) !== message; index++);
    if (index > 334) throw new NavError(`H-GUICONNECT: no sendEvent index for the ${gate === null ? '' : 'GUI\'s gate '}connect message 0x${fx(message, 4)} in the build's event map`);
    const loutput = this.device === 'evf' ? MM.CONNECT_LOUTPUT : CONNECT_TFT;
    const layout0 = this.lab.sim.read(MM.LAYOUT_BYTE, 1)[0];
    this.begin('H-GUICONNECT');
    this.post(index, loutput);
    this.settle('H-GUICONNECT');
    if (this.lab.state() !== MM.STATE_POWER_ON) throw new NavError(`H-GUICONNECT: GUI state ${this.lab.state_name(this.lab.state())} after the connect message, not POWER_ON`);
    this.gui_connected = { index, message: h4(message), loutput, gate: gate !== null, layout: [layout0, this.lab.sim.read(MM.LAYOUT_BYTE, 1)[0]] };
  }
  // S-DISPSYNC in nav (src/lab/camapp.mjs has the stand-in's text, src/fw/facts.mjs displaySync the evidence): with
  // the lab's own creation of the GUI no application runs, and on the bodies whose GUI asks for the display sync at
  // its start (the application's setDispSync, E137 0x507ebdff, which guiUtility::setDispSync calls) every GUI update is
  // a synced request (type 3; E120's record form type 5) that leaves the device's buffers pending until an image sync
  // only the application's stopRecView sends: the menu ran, its texts were drawn, and the frame stayed the start's (X:
  // E137's requests from 0x507d537c, E122's from 0x502c076a, 12 bodies; docs/model-survey.md findings 160 and 162).
  // The session observes the request from before the GUI's creation and releases each device with such a request as
  // play's application stand-in does after each step: at the bring-up's end (after H-GUICONNECT) and at each step's
  // end. A build whose rule reads no display sync (fact 'display.sync' undefined) observes none. A play session's GUI
  // is the application's (H-GUIBYAPP): its CamApp releases there, and this does not run
  dispsync_install() {
    this.dispsync = null;
    const sync = dispsyncFacts();
    if (!sync) return;
    this.dispsync = new Set();
    this.dispsync_fns = sync;
    observeDispsync(this.lab, sync, (code) => this.dispsync.add(code));
  }
  // The releases, each followed by a settle (a release can bring the GUI's next synced update), at most
  // DISPSYNC_RELEASES in one step, as play's
  dispsync_release() {
    for (let k = 0; this.dispsync?.size;) {
      if (++k > DISPSYNC_RELEASES) throw new NavError(`S-DISPSYNC: more than ${DISPSYNC_RELEASES} releases in step ${this.lab.step_tag} (devices ${[...this.dispsync].join(', ')})`);
      const [code] = this.dispsync;
      this.dispsync.delete(code);
      releaseDispsync(this.lab, this.dispsync_fns, code);
      this.dispsync_released.push([this.lab.step_tag, code]);
      this.settle('S-DISPSYNC');
    }
  }
  // The lab, created and not yet brought up: the machine is at its reset (a subclass sets its lab choices here)
  lab_created(lab) {}
  // Is sid a store id a Setup row reads through the getter (menudata.mjs store_reads)?
  scalar_hint(sid) {
    for (const t of M.tabs(this.img)) if (t.id === MM.SETUP_TAB) for (const p of t.pages) if (M.store_reads(this.img, p).has(sid)) return true;
    return false;
  }
  close() {
    if (this.lab !== null) { this.lab.close(); this.lab = null; }
  }
  // ---- primitives
  message(index) { return this.lab.message_for(index); }
  // The build's sendEvent index of E143's index e143 (KEYS, INFO, DIALS, OPEN, CLOSE): the first index whose message in
  // the build's event map is E143's message of it (MESSAGES); refused where the map has none
  index_of(e143) {
    this._indices ??= new Map();
    let i = this._indices.get(e143);
    if (i !== undefined) return i;
    const m = MESSAGES.get(e143);
    if (m === undefined) throw new NavError(`sendEvent index ${e143}: not one of the session's events`);
    for (i = 1; i <= 334 && this.message(i) !== m; i++);
    if (i > 334) throw new NavError(`no sendEvent index for message 0x${fx(m, 4)} (E143's index ${e143}) in the build's event map`);
    this._indices.set(e143, i);
    return i;
  }
  // POST_HOOKS as read at call time (PlaySession.set raises it for its call: _post_hooks).
  post_hooks() { return this._post_hooks ?? POST_HOOKS; }
  // sendEvent(index) from the lab task (priority 50): GESetEvent posts, the GUI must not run.
  post(index, data = 0, kind = 0) {
    if (!(index >= 1 && index <= 334)) throw new NavError(`sendEvent index ${index}: outside 1..334 (0x5115b2a5/0x5115b2af return)`);
    if (this.message(index) === NO_MESSAGE) throw new NavError(`sendEvent index ${index} maps to 0x7fff, which has no message name: refused`);
    const lab = this.lab;
    lab.harvest();
    const msg = lab.alloc(pack('<8I', index, data, kind, 0, 0, 0, 0, 0), 4);
    lab.posting = true;
    const limit = this.post_hooks();
    try {
      lab.calls(MM.SEND_EVENT, { a0: 0, a1: msg }, undefined, undefined, limit);
    } catch (e) {
      if (e instanceof FirmwareError && e.message.includes('more than') && e.message.includes('stub calls')) {
        throw new NavError(`post of index ${index}: more than ${limit} hook stops`);
      }
      throw e;
    } finally {
      lab.posting = false;
    }
  }
  settle(label) {
    const lab = this.lab;
    try { return lab.lt.settle(lab._deliver_raw, () => lab.pending_irq(), this.settle_hooks ?? STEP_HOOKS); } catch (e) {
      if (e instanceof FirmwareError) throw new NavError(`${label}: ${e.message.slice(0, 600)}\n` + this.diagnose());
      throw e;
    }
  }
  diagnose() {
    const lab = this.lab, m = this.marks;
    const hooks = new Map();
    for (const n of lab.log.slice(m.log)) hooks.set(n, (hooks.get(n) ?? 0) + 1);
    const top = [...hooks].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const taken = lab.events.slice(m.events ?? 0).filter((e) => e[0] === 'take').map((e) => e[1]);
    return `  step ${lab.step_tag}; GUI state ${lab.state_name(lab.state())}; messages taken ${show(taken.slice(0, 20))}; ` +
      `GESetEvent ${lab.step_sets} from ${show(lab.set_callers.mostCommon(6))}; hook stops ${lab.log.length - m.log}, top ${show(top)}; ` +
      `kernel events ${show(lab.kernel.events.slice(-6).map((e) => show(e).slice(0, 100)))}; tasks ${show(lab.task_states())}`;
  }
  begin(tag) {
    const lab = this.lab;
    lab.harvest();
    lab.step_tag = tag;
    lab.step_sets = 0;
    lab.step_queued = 0;
    lab.step_storm = STORM;
    lab.set_callers = new Tally();
    this.marks = { events: lab.events.length, draws: lab.draw_log.length, exec: lab.exec_history.length,
      settings: lab.settings_log.length, log: lab.log.length, panels: lab.panels.length, writes: lab.writes.length,
      errors: lab.kernel.errors.length, kernel: lab.kernel.events.length, rpc: lab.rpc_log.length,
      sends: lab.dropped_sends.length, var: lab.var226_steps.length, stubs: new Tally(lab.stub_hits), lost: lab.exec_lost };
    this.t0 = performance.now();
    this.state0 = lab.state();
  }
  // One event: post, then settle; returns the hook stops of each half.
  event(index, data = 0) {
    const n0 = this.lab.log.length;
    this.post(index, data);
    const n1 = this.lab.log.length;
    this.settle(`index ${index}`);
    return [n1 - n0, this.lab.log.length - n1];
  }
  end(token, kind, indices, hooks, extra = null) {
    const lab = this.lab, m = this.marks, released = this.dispsync_released.length;
    this.dispsync_release();                                                // S-DISPSYNC (nav's own GUI only)
    lab.harvest();
    const lost = lab.exec_lost - m.lost;
    const stubs = {};
    for (const [[p, n, w], v] of lab.stub_hits.entries()) {
      const before = m.stubs.get([p, n, w]);
      if (v !== before) stubs[`${n} (${w})`] = v - before;
    }
    const kinds = {}, errlog = {};
    for (const e of lab.exec_history.slice(m.exec)) kinds[e.command.name] = (kinds[e.command.name] ?? 0) + 1;
    for (const [c] of lab.kernel.errors.slice(m.errors)) errlog[h8(c)] = (errlog[h8(c)] ?? 0) + 1;
    const callers = {};
    for (const [k, v] of lab.set_callers.entries()) callers[k] = v;
    const rec = { n: this.steps.length, token, kind, indices,
      messages: indices.filter((i) => i >= 1 && i <= 334).map((i) => h4(this.message(i))),
      state_before: lab.state_name(this.state0), state_after: lab.state_name(lab.state()),
      events: lab.events.slice(m.events), panels: lab.panels.slice(m.panels).map(([, p]) => p),
      var226: lab.var226_steps.length > m.var,
      settings: lab.settings_log.slice(m.settings).filter(([, , k]) => k === 'native').map(([s, v]) => [s, v]),
      writes: lab.writes.slice(m.writes), texts: lab.draw_log.slice(m.draws).filter((d) => d.op === 'text').map((d) => d.text),
      engine_commands: lab.exec_history.length - m.exec + lost, engine_log_lost: lost, engine_kinds: kinds, errlog,
      rpc: lab.rpc_log.slice(m.rpc), dropped_sends: lab.dropped_sends.slice(m.sends), stand_ins: stubs,
      gesetevent: lab.step_sets, gesetevent_callers: callers, hooks, hook_stops: lab.log.length - m.log,
      seconds: Math.round((performance.now() - this.t0) / 10) / 100 };   // wall seconds to 0.01 (every comparison strips them)
    if (this.dispsync_released.length > released) rec.dispsync = this.dispsync_released.slice(released).map(([, c]) => c);
    Object.assign(rec, extra ?? {});
    rec.state = this.state();
    this.steps.push(rec);
    return rec;
  }
  // ---- tokens
  step(token) {
    const t = token.trim();
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${t}`);
    const c = t.indexOf(':');
    const name = c < 0 ? t : t.slice(0, c), arg = c < 0 ? '' : t.slice(c + 1);
    const base = name.replace(/[+\-0-9@]+$/, '');
    if (Object.hasOwn(KEYS, name)) {
      const kind = arg || 'click', on = KEYS[name];
      let seq = own({ click: [on, on + 2], on: [on], long: [on + 1], off: [on + 2] }, kind);
      if (seq === undefined) throw new ValueError(`${t}: kind ${show(kind)} (click, on, long, off)`);
      seq = seq.map((i) => this.index_of(i));
      const hooks = seq.map((i) => this.event(i));
      return this.end(t, kind, seq, hooks);
    }
    if (name === 'INFO') {
      const kind = arg || 'click';
      let seq = own({ click: [...INFO], on: [INFO[0]], off: [INFO[1]] }, kind);
      if (seq === undefined) throw new ValueError(`${t}: kind ${show(kind)} (click, on, off)`);
      seq = seq.map((i) => this.index_of(i));
      const hooks = seq.map((i) => this.event(i));
      return this.end(t, kind, seq, hooks);
    }
    if (Object.hasOwn(DIALS, base)) {
      const rest = name.slice(base.length), sign = rest ? rest[0] : '';
      const at = rest.indexOf('@', 1), n = at < 0 ? rest.slice(1) : rest.slice(1, at), k = at < 0 ? '' : rest.slice(at + 1);
      const nv = /^[0-9]+$/.test(n) ? decimalInt(n) : null, count = decimalInt(k || '1');
      if (!['', '+', '-'].includes(sign) || nv === null) throw new ValueError(`${t}: dial token is MAIN+n, MAIN-n, SUB+n or SUB-n`);
      if (count === null) throw new ValueError(`${t}: the count after @ is not an integer`);
      return this.dial(base.toLowerCase(), sign === '+' ? nv : -nv, count, t);
    }
    if (name === 'OPEN' || name === 'CLOSE') {
      const index = this.index_of(name === 'OPEN' ? OPEN : CLOSE);
      return this.end(t, 'event', [index], [this.event(index)]);
    }
    if (name === 'EV') {
      const parts = arg.split(':').map((x) => integer(t, x));
      return this.end(t, 'event', [parts[0]], [this.event(parts[0], parts.length > 1 ? parts[1] : 0)]);
    }
    if (name === 'SET') {
      const xs = arg.split('=');
      if (xs.length !== 2) throw new ValueError(`${t}: SET:sid=value`);
      const [sid, v] = xs.map((x) => integer(t, x));
      return this.set(sid, v, t);
    }
    if (name === 'CLOCK') return this.clock(integer(t, arg), t);
    if (name === 'SWITCH') return this.switch(arg, t);
    if (name === 'SHOT') {
      const png = this.screenshot(arg || this.device, `${this.out}/${String(this.steps.length).padStart(2, '0')}-SHOT-${arg || this.device}`);
      return this.end(t, 'shot', [], [], { png });
    }
    if (name === 'WAIT') {
      const ms = decimalNumber(arg);
      if (ms === null) throw new ValueError(`${t}: WAIT:ms takes a number of milliseconds`);
      return this.wait(ms, t);
    }
    throw new ValueError(`unknown token ${show(t)}`);
  }
  // WAIT:ms (time mode): lab time runs ms milliseconds forward with the lab task waiting (ELAPSE); ms is finite and at
  // least 1 ns (1e-6 ms).
  wait(ms, tag = null) {
    if (!(Number.isFinite(ms) && Math.trunc(ms * 1000000) > 0)) throw new ValueError(`${tag || 'WAIT'}: WAIT:ms takes a finite duration of at least 1 ns, not ${ms}`);
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-WAIT:${ms}`);
    return this.wait_until(this.lab.lab_time() + Math.trunc(ms * 1000000), tag || `WAIT:${ms}`, true);
  }
  // Time mode: lab time runs to the absolute t_ns, which must lie ahead of the lab clock; the step budgets grow with the
  // duration; the wait runs as ELAPSE slices of at most WAIT_SLICE_MS. kind: the step record's; extra: a function
  // whose fields the record gets besides the wait's, called after it.
  wait_until(t_ns, tag = 'WAIT', begun = false, { kind = 'wait', extra = null } = {}) {
    const lab = this.lab;
    if (!lab.time_mode) throw new NavError(`${tag}: lab time needs --time (a NavSession with time: true)`);
    const n0 = lab.log.length, t0 = lab.lab_time();
    if (t_ns <= t0) throw new ValueError(`${tag}: target ${t_ns} ns is not after the lab clock ${t0} ns`);
    if (!begun) this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    const ms = Math.ceil((t_ns - t0) / 1000000);
    lab.step_storm = STORM + Math.ceil(ms * WAIT_STORM_PER_MS);
    let log = [], slices = 0;
    try {
      while (lab.lab_time() < t_ns) {
        const target = Math.min(t_ns, lab.lab_time() + WAIT_SLICE_MS * 1000000);
        const slice_ms = Math.ceil((target - lab.lab_time()) / 1000000);
        log = log.concat(lab.lt.elapse_until(target, () => lab.lab_time(), (x) => lab.run_to_event(x), STEP_HOOKS * 4 + slice_ms * WAIT_HOOKS_PER_MS));
        slices += 1;
      }
    } catch (e) {
      if (e instanceof FirmwareError) throw new NavError(`${tag}: ${e.message.slice(0, 600)}\n` + this.diagnose());
      throw e;
    }
    const counts = {};
    for (const x of log) {
      const k = x.trim().split(/\s+/)[0];
      if (!k) throw new IndexError(`${tag}: an empty elapse log entry`);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return this.end(tag, kind, [], [[0, lab.log.length - n0]], { wait: { start: t0, target: t_ns, end: lab.lab_time(), slices, log: counts }, ...(extra ? extra() : {}) });
  }
  // SWITCH:<tft|evf>: DISPLAY cmd 2 OPEN of the other device, H-RESEND, H-UPDATE (the GUI's re-display wrapper
  // 0x510bd84b from the lab task), then a capture; the GUI is not told.
  switch(device, tag = null) {
    if (!Object.hasOwn(D.DEVICE, device) || device === this.device) throw new ValueError(`SWITCH:${device}: the other device (tft or evf) of the current ${this.device}`);
    if (this.evf_layout) throw new ValueError('SWITCH with --evf-layout: the EVF layout inputs are not defined for a switch');
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-SWITCH:${device}`);
    this.lab.open(device);
    const sends = this.lab.resend_palettes(device);
    this.lab.step(`H-UPDATE re-display 0x510bd84b (gpiUpdateDisplay(1)) on ${device} after the switch (lab task)`, () => this.lab.call(REDISPLAY, null, null, null, 300000));
    this.device = device;
    const png = this.screenshot(device, `${this.out}/${String(this.steps.length).padStart(2, '0')}-SWITCH-${device}`);
    return this.end(tag || `SWITCH:${device}`, 'switch', [], [], { png, device, resend: sends.map(([c, d, r]) => [c, bytesHex(d), h8(r)]) });
  }
  press(key, kind = 'click') { return this.step(kind !== 'click' ? `${key}:${kind}` : key); }
  // |n| dial events; the sign selects the S-DIAL counter word: + -> +8, - -> +10.
  dial(which, n, count = 1, tag = null) {
    const sgn = (v) => (v >= 0 ? `+${v}` : `${v}`);
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-${which.toUpperCase()}${sgn(n)}`);
    const [e143, slot] = lookup(DIALS, which.toUpperCase()), index = this.index_of(e143);
    const word = dial_counters(slot) + (n > 0 ? 8 : 10);
    const hooks = [];
    for (let i = 0; i < Math.abs(n); i++) {
      this.lab.sim.write(dial_counters(slot) + 8, new Uint8Array(4));
      this.lab.sim.write(word, pack('<H', count));
      hooks.push(this.event(index));
      const left = this.lab.sim.read(dial_counters(slot) + 8, 4);
      if (left.some((b) => b)) throw new NavError(`dial ${which}: counters ${h8(dial_counters(slot) + 8)} not consumed (${bytesHex(left)}): the GUI did not read slot ${slot}`);
    }
    return this.end(tag || `${which.toUpperCase()}${sgn(n)}`, 'dial', Array(Math.abs(n)).fill(index), hooks, { dial: { slot, word: h8(word), count } });
  }
  // Native setter 0x50ac4afe(id, value), then settle; scalar ids and listed values only.
  set(sid, value, tag = null) {
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-SET:${sid}=${value}`);
    let keys;
    try { keys = this.lab.scalar_keys(sid, 'SET'); } catch (e) {
      if (e instanceof MM.MenuError) throw new NavError(e.message);
      throw e;
    }
    if (!keys.includes(value)) throw new NavError(`SET ${sid}=${value}: not in the descriptor list ${show(keys)}`);
    const n0 = this.lab.log.length;
    const r = this.lab.call(MM.API_SET, { d0: sid, d1: value }, null, null, this.post_hooks());
    const n1 = this.lab.log.length;
    this.settle(`SET ${sid}`);
    return this.end(tag || `SET:${sid}=${value}`, 'set', [], [[n1 - n0, this.lab.log.length - n1]],
      { set: { id: sid, value, ret: r.d0, read_back: this.get(sid) } });
  }
  // The native setter 0x50ac4afe(id, values) for a group id (a descriptor of type 6, such as MODE_QUALITY_SLOT2 1096,
  // whose members are 1096 and MODE_RAW_SLOT2 1097; docs/hle-gaps/4.8.md 4.8.24): d1 points at one u32 per member, the
  // group's set writing each member's own value from it (D on E143); values must be one of the descriptor's allowed
  // records (descriptor +4, +12 bytes of +14-byte records, a u32 per member, the rest 0), and the getter then reads
  // the descriptor's value-table entry (+8) of that record (X on E143); then settle.
  set_group(sid, values, tag = null) {
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-SETGROUP:${sid}=${values.join(',')}`);
    const d = this.lab.descriptor(sid), sim = this.lab.sim;
    if (d === null || d.type !== 6) throw new NavError(`SETGROUP ${sid}: descriptor ${show(d)}: not a group (type 6)`);
    const [allowed, table, nbytes, elem] = [sim.u32(d.address + 4) >>> 0, sim.u32(d.address + 8) >>> 0, ...(() => { const b = sim.read(d.address + 12, 4); return [b[0] | b[1] << 8, b[2] | b[3] << 8]; })()];
    if (!elem || nbytes % elem || elem % 4 || values.length > elem / 4) throw new NavError(`SETGROUP ${sid}: ${nbytes} bytes of ${elem}-byte records: not ${values.length} u32 values a record`);
    const recs = Array.from({ length: nbytes / elem }, (_, i) => Array.from({ length: elem / 4 }, (_, k) => sim.u32(allowed + elem * i + 4 * k) >>> 0));
    const index = recs.findIndex((r) => r.every((v, k) => v === (values[k] ?? 0)));
    if (index < 0) throw new NavError(`SETGROUP ${sid}=${values.join(',')}: not one of the descriptor's allowed records ${show(recs.map((r) => r.slice(0, values.length)))}`);
    const want = table ? sim.u32(table + 4 * index) >>> 0 : null;
    const n0 = this.lab.log.length;
    const r = this.lab.call(MM.API_SET, { d0: sid, d1: this.lab.alloc(pack(`<${values.length}I`, ...values), 4) }, null, null, this.post_hooks());
    const n1 = this.lab.log.length;
    this.settle(`SETGROUP ${sid}`);
    const back = this.get(sid);
    if (want !== null && back !== want) throw new NavError(`SETGROUP ${sid}=${values.join(',')}: the getter reads ${back}, the value table's entry ${index} is ${want}`);
    return this.end(tag || `SETGROUP:${sid}=${values.join(',')}`, 'set', [], [[n1 - n0, this.lab.log.length - n1]],
      { set: { id: sid, values, record: index, ret: r.d0, read_back: back } });
  }
  get(sid) { return this.lab.get(sid); }
  // S-SCPU-CLOCK: the sub-CPU's counter now reads epoch, and ticks on from it with lab time: one CPU store to om1.scpu's
  // clock word from harness code (MM.SCPU_CLOCK; E143's 0x98e000e8).
  clock(epoch, tag = null) {
    if (tag === null) this.begin(`${String(this.steps.length).padStart(2, '0')}-CLOCK:${epoch}`);
    this.lab.cpu_store(MM.SCPU_CLOCK, epoch);
    const got = this.lab.sim.u32(MM.SCPU_CLOCK);
    if (got !== epoch) throw new NavError(`S-SCPU-CLOCK: 0x${MM.SCPU_CLOCK.toString(16)} reads 0x${got.toString(16)} after the store`);
    this.clock_inputs.push(epoch);
    return this.end(tag || `CLOCK:${epoch}`, 'input', [], [], { clock: epoch });
  }
  // The composite of device written through env.writeOutputs as <path>.png/.ycc/.json;
  // a status other than NONE or a VSC error other than PAL_UNWRITTEN raises. Returns the PNG path.
  screenshot(device, path) {
    const comp = this.lab.compose(device);
    const cut = path.lastIndexOf('/'), dir = cut < 0 ? '.' : cut === 0 ? '/' : path.slice(0, cut), name = path.slice(cut + 1);   // Path(path).parent, .name
    if (!this.env.writeOutputs) throw new Unported('NavSession.screenshot without env.writeOutputs (checks/lib/png.mjs write_outputs)');
    const [png] = this.env.writeOutputs(this.lab, name, device, comp, this.lab.dump(device), dir);
    const bad = comp.errors.filter((e) => e.name !== 'PAL_UNWRITTEN').map(D.format_vsc_error);
    if (comp.status !== 'NONE' || bad.length) throw new NavError(`composite ${comp.status}: ${show(bad)}`);
    return png;
  }
  // ---- state
  state() {
    const lab = this.lab, s = lab.state();
    const out = { gui: h4(s), gui_name: lab.state_names.get(s) ?? '?', panel: lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null };
    let ids;
    if (lab.var226 !== null) {
      const v = decode_var226(lab.var226, this.img);
      out.menu = {};
      for (const k of ['tab_index', 'tab_id', 'page', 'pages', 'page_id', 'cursor_row', 'f', 'rows', 'number']) out.menu[k] = v[k];
      out.menu.labels = v.labels.map((x) => [x.type, x.string, x.image, x.style]);
      out.menu.values = v.values.map((x) => [x.type, x.string, x.image, x.literal]);
      out.menu.title = [v.title.type, v.title.string, v.title.literal];
      ids = [...(MM.MENU_MEMORY ?? []), ...(v.cursor_memory_id ? [v.cursor_memory_id] : [])];
    } else ids = MM.MENU_MEMORY ?? [];
    out.store = new Map();
    for (const sid of ids) out.store.set(sid, lab.get(sid));
    out.screen = screen_of(out, lab.var226);
    return out;
  }
}

