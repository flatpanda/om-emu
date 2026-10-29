// The play runtime's Player (session lifecycle, status and frame publishing,
// the input FIFO with its gating rules, lab time between inputs (after_lab_time, the B7 gate
// hold, H-TOUCHGAP), every input type, power and control, the session log and --replay, and the wall
// pacing of --idle wall (pace_step, H-IDLE) and wait_result), without threads or HTTP: submit() queues, tick() takes one
// input or one paced slice. The input queue has put, get_nowait, get(timeout), qsize and items:
// headless it is an ArrayQueue, whose get never waits (nothing can arrive while the loop runs), so run() refuses to
// spin with nothing queued and a host that runs the loop on an event loop (the browser player's web/driver.mjs) waits
// between ticks instead; the node host (host/labworker.mjs) runs Player.run in a worker thread on a queue that blocks
// (host/portqueue.mjs). The mutants (--x-mutant, negative
// controls) sit at the sites they break.
// env: the lab env (rom, resBlock, createHash, beginSession, ...) plus wallClock() (monotonic seconds:
// the wall-clock fields, which the recordings strip, the 0.3 s page-order deadline, and under --idle wall the pacing and
// touch_gap's user gap when the page sends no t_client), logSink(name, text) (session.jsonl / session.json; optional),
// readReplay(path) (the --replay file's text), and for a host that publishes (the browser player): onStatus(doc) after
// every published status, onFrame(w, h, raw, meta) after every published frame (raw: the composite's little-endian
// words, valid only during the call; meta {seq, device, lab_ns, sha16}), and asyncHost (true: an input that overtook its
// page's order makes a blocking next_input return null instead of polling until the deadline, so the host's own wait
// lets the missing input arrive), and refuseUnported (true: a debug token whose implementation throws
// Unported before it ran anything, WINDOWS on a host without env.deflate, is answered as a refused input, the session
// running on, instead of ending the host's loop; the browser player sets it, the node gates keep the throw). The node
// host (host/) adds queue (a blocking queue), flags (an Int32Array on shared memory: [1] stop, [2] signalled, read and
// written through the stop and signalled fields), onResult(seq, res) (finish: the host keeps the results), onStop()
// (set_stop), and onLogEntry(entry) / onLogUpdate(entry) / onLogTrim(n) (the in-memory session log: an entry appended,
// its frame field set after the lab time that followed it, the oldest n dropped), and debugHost ({openSink, disasm,
// resolvePath}: the live debug route's trace files and disassembler, host/debughost.mjs).
// Debug inputs ({type: 'debug', op, ...}, --debug-api only) go to the live debug route (src/debug/live.mjs), made at the
// first one: they run between ticks, outside the session log and the B7 gate, and answer with the result's debug field;
// a halted session ticks only debug inputs and controls (the others wait held, in their order).
// Card reads ({type: 'cardfiles', op, path?}, the players' Card panel) go to env.cardView (web/cardfiles.mjs, the
// host's reader of the card's files): between ticks, with or without a session, outside the session log and the B7
// gate, answering with the result's card field (card_files).
import * as P from './play.mjs';
import { PlaySession, PlayError, BY_ID, MODE_DIAL, B7_GATE } from './play.mjs';
import { LabError, ValueError, KeyError } from './errors.mjs';
import { Unported } from '../core/mem.mjs';
import { HostStopped } from '../machine.mjs';
import { S } from '../core/cpu.mjs';
import { MODEL, MODEL_INFO } from '../fw/model.mjs';
import { show } from '../util/show.mjs';
import { decimalInt, intLiteral } from '../util/parse.mjs';
import { setKey } from '../util/tracejson.mjs';
import { LiveDebug } from '../debug/live.mjs';
import { memoryCard } from './sdcard.mjs';
import { STORAGE } from './storage.mjs';

export const PNG_CACHE = 8, SLICE_NS = 50000000, GATE_SLICE_NS = 10000000, GATE_LIMIT_NS = 2000000000, BEHIND_NS = 250000000;
export const DIAL_CAP = 8, TOUCH_MIN_NS = 20000000, TOUCH_GAP_CAP_NS = 2000000000, TOUCH_TAP_CAP_NS = 320000000;
export const ORDER_WAIT_S = 0.3, TRIM_EVERY = 100;
export const TIMER_MAX_MS = 2 ** 31 - 1;                // the longest setTimeout delay
// An input the JS lab cannot run and refuses before anything ran (env.refuseUnported): not a LabError.
export class RefusedInput extends Error { constructor(m) { super(m); this.name = 'RefusedInput'; } }

// The input queue of a loop nothing can feed while it runs (the gates, the replays, the browser's Worker): get never
// waits. An Array, so the gates and the browser driver read its length and items as before.
export class ArrayQueue extends Array {
  static get [Symbol.species]() { return Array; }
  get canBlock() { return false; }
  put(x) { this.push(x); }
  get_nowait() { return this.length ? this.shift() : null; }     // null: empty
  get(_timeout) { return this.get_nowait(); }
  qsize() { return this.length; }
  items() { return [...this]; }
}

// The ?sync=1 results (by input seq, pruned to the newest 500) and their waiters: the Player's own when it
// runs headless or in the browser, the node host's main thread (host/proxy.mjs) when the Player runs in a worker.
// wait() is a promise of the result, or of null after timeout seconds or when stopped() holds at a notify: 0 or less
// answers at once, Infinity waits for the result (no timer). setTimeout holds at most 2^31 - 1 ms (a longer delay
// fires after 1 ms), so a longer wait re-arms.
export class ResultBox {
  constructor(stopped) {
    this.results = new Map();        // input seq -> result
    this.waiters = new Map();        // input seq -> [{resolve, timer}]
    this.stopped = stopped;
  }
  put(seq, res) {
    this.results.set(seq, res);
    if (this.results.size > 500) for (const k of [...this.results.keys()].sort((x, y) => x - y).slice(0, -500)) this.results.delete(k);
    if (this.waiters.size) this.notifyAll();
  }
  wait(seq, timeout = 120) {
    if (this.results.has(seq) || this.stopped() || timeout <= 0) return Promise.resolve(this.pop(seq));
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      const fire = () => { this.drop(seq, w); resolve(this.pop(seq)); };
      if (Number.isFinite(timeout)) {
        const end = performance.now() + timeout * 1000;
        const arm = () => {
          const left = end - performance.now();
          w.timer = left > TIMER_MAX_MS ? setTimeout(arm, TIMER_MAX_MS) : setTimeout(fire, Math.max(0, left));
        };
        arm();
      }
      if (!this.waiters.has(seq)) this.waiters.set(seq, []);
      this.waiters.get(seq).push(w);
    });
  }
  pop(seq) {
    const r = this.results.get(seq) ?? null;
    this.results.delete(seq);
    return r;
  }
  drop(seq, w) {
    const ws = this.waiters.get(seq);
    if (!ws) return;
    const i = ws.indexOf(w);
    if (i >= 0) ws.splice(i, 1);
    if (!ws.length) this.waiters.delete(seq);
  }
  // Wake the waiters whose result is in, or all of them once the Player stopped; each answers its result or null.
  // Stopping alone wakes nobody: a waiter answers at the next notify after it (a status or frame published, an input
  // finished, the host's own stop), so one whose input finishes first gets its record.
  notifyAll() {
    for (const k of [...this.waiters.keys()]) {
      if (!this.results.has(k) && !this.stopped()) continue;
      const ws = this.waiters.get(k);
      this.waiters.delete(k);
      for (const w of ws) { clearTimeout(w.timer); w.resolve(this.pop(k)); }
    }
  }
}
// A copy of an input without the given keys (its own '__proto__' key too, an ordinary key here).
function without(inp, drop) {
  const o = {};
  for (const [k, v] of Object.entries(inp)) if (!drop.includes(k)) setKey(o, k, v);
  return o;
}

// The first n code points of s; the JSON type of a value (as the messages name it).
const cut = (s, n) => { const cs = [...s]; return cs.length > n ? cs.slice(0, n).join('') : s; };
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
const has = (o, k) => isDict(o) && Object.hasOwn(o, k);
const get = (o, k, d = null) => (has(o, k) ? o[k] : d);
export function jsonType(v) {
  if (v === null || v === undefined) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
// A JSON value in a message: its JSON text, at most n code points (JSON.stringify does not recurse, and an input may
// nest deeply); label(v) is a string as it is, another value so.
const brief = (v, n = 80) => cut(JSON.stringify(v) ?? 'null', n);
const label = (v) => (typeof v === 'string' ? v : brief(v));
const field = (inp, k, n = 80) => brief(get(inp, k), n);
const typeOf = (inp) => label(get(inp, 'type'));

// number / integer / detents_of / bit_value / client_key / control_of: input fields, or ValueError. number is a
// finite number truncated toward zero; integer and detents_of take integers only.
export function number(inp, key) {
  const v = get(inp, key);
  if (!isNum(v)) throw new ValueError(`${typeOf(inp)} ${key}: ${brief(v)} is not a number`);
  return Math.trunc(v) + 0;
}
export function integer(inp, key) {
  const v = get(inp, key);
  if (!Number.isInteger(v)) throw new ValueError(`${typeOf(inp)} ${key}: ${brief(v)} is not an integer`);
  return v + 0;
}
export function detents_of(inp) {
  const v = has(inp, 'detents') ? inp.detents : 1;
  return Number.isInteger(v) ? v + 0 : null;
}
export function bit_value(inp, key = 'value') {
  const v = integer(inp, key);
  if (v !== 0 && v !== 1) throw new ValueError(`${typeOf(inp)} ${key}: ${field(inp, key, 40)} is not 0 or 1`);
  return v;
}
// The page an input comes from when it says which and its place in that page's order: client (1 to 64 characters)
// and cseq (a positive integer).
export function client_key(inp) {
  const c = get(inp, 'client'), n = get(inp, 'cseq');
  if (typeof c === 'string' && [...c].length > 0 && [...c].length <= 64 && Number.isSafeInteger(n) && n > 0) return c;
  return null;
}
export function control_of(inp) {
  const cid = get(inp, 'id');
  if (typeof cid !== 'string' || !BY_ID.has(cid)) throw new ValueError(`${typeOf(inp)}: unknown control id ${field(inp, 'id')}`);
  return BY_ID.get(cid);
}
// The integer after the colon of a token (WAIT_UNTIL:ns, GET:id), by parse (src/util/parse.mjs), or ValueError.
function tokenInt(tok, parse) {
  const [name, text = ''] = tok.split(':');
  const v = parse(text);
  if (v === null) throw new ValueError(`${name}: ${show(text)} is not an integer`);
  return v;
}
// The parts of a step record the page and the session log keep.
const LIGHT_KEEP = ['n', 'token', 'kind', 'indices', 'messages', 'state_before', 'state_after', 'panels', 'engine_commands', 'errlog',
  'writes', 'seconds', 'control', 'action', 'uiin', 'camseq', 'gestures', 'tp_status', 'touch_posted', 'cafwd', 'mode_dial_index', 'device',
  'set', 'wait', 'get', 'tp_image', 'held_ms', 'uiin_decoded', 'dial_unread', 'dispq', 'keymap', 'switch', 'info', 'state_from', 'from_state',
  'ca_posts'];
export function light(rec) {
  if (rec === null || rec === undefined) return null;
  const st = rec.state || {};
  const out = {};
  for (const k of LIGHT_KEEP) if (Object.hasOwn(rec, k)) out[k] = rec[k];
  out.writes = (rec.writes ?? []).map((w) => [w.id, w.d1, w.a1, w.ret]);
  out.state = { gui: st.gui ?? null, gui_name: st.gui_name ?? null, panel: st.panel ?? null, screen: st.screen ?? null, menu: st.menu ?? null };
  return out;
}
// Counts by reason in first-seen order (the dropped inputs), published as an object.
class Counts extends Map {
  add(k, n = 1) { this.set(k, (this.get(k) ?? 0) + n); }
  toObject() { return Object.fromEntries(this); }
}
// A --replay file: one document {inputs: [entry, ...]} when its name ends in .json (session.json), else one entry per
// non-blank line (session.jsonl). An entry is {input: {...}, lab_ns?, idx?}; lab_ns, when given, an integer. A
// malformed file is a ValueError.
export function replayEntries(file, text) {
  const name = String(file).split('/').at(-1);
  const parse = (t, where) => {
    try { return JSON.parse(t); } catch (e) { throw new ValueError(`--replay ${file}${where}: ${e.message}`); }
  };
  let entries;
  if (name.endsWith('.json') && name !== '.json') {
    const doc = parse(text, '');
    if (!isDict(doc)) throw new ValueError(`--replay ${file}: a JSON ${jsonType(doc)}, not an object`);
    entries = has(doc, 'inputs') ? doc.inputs : [];
    if (!Array.isArray(entries)) throw new ValueError(`--replay ${file}: inputs is a JSON ${jsonType(entries)}, not an array`);
  } else {
    entries = [];
    text.split(/\r\n|\r|\n/).forEach((line, i) => { if (line.trim()) entries.push(parse(line, ` line ${i + 1}`)); });
  }
  entries.forEach((e, i) => {
    if (!isDict(e) || !isDict(e.input)) throw new ValueError(`--replay ${file}: entry ${i + 1}: not an object with an input object`);
    const t = get(e, 'lab_ns');
    if (t !== null && !Number.isSafeInteger(t)) throw new ValueError(`--replay ${file}: entry ${i + 1}: lab_ns ${brief(t)} is not an integer`);
  });
  return entries;
}

export class Player {
  constructor(a, env) {
    this.a = a;
    // the card in the first slot (storage.mjs) stays in the slot across the player's sessions (a power cycle): the
    // host's (env.card, OM_EMU_CARD), else one in memory for the player's life
    this.env = STORAGE && !env.card ? { ...env, card: memoryCard() } : env;
    this.wall = env.wallClock ?? (() => performance.now() / 1000);
    this.q = env.queue ?? new ArrayQueue();
    this.stop = false;
    this.stop_seen = false;          // the stop as the ?sync=1 waiters see it (set_stop)
    this.session = null;
    this.camapp_components = false;  // S-BOOTDONE / S-CPU3 too (control camapp 2): the HLS components run
    this.phase = 'starting';
    this.error = null;
    this.status_seq = 0;
    this.status_doc = {};
    this.frame_seq = 0;
    this.frame = null;               // [png (null: no PNG here), device, lab_ns, sha16]
    this.box = new ResultBox(() => this.stop_seen);
    this.results = this.box.results; // input seq -> the result (?sync=1)
    this.log = [];
    this.log_written = 0;
    this.log_count = 0;
    this.input_seq = 0;
    this.idle = a.idle;
    this.down = new Set();
    this.dropped = new Counts();
    this.last = { input: null, latency_ms: null, record: null };
    this.pace = [];                  // [wall, lab], the last 200 (pace_step)
    this.touch_last = null;
    this.client_next = new Map();
    this.client_wait = new Map();    // `${page}\0${cseq}` -> [page, cseq, wall deadline]
    this.current = null;
    this.held = [];
    this.signalled = false;
    this.out = a.out;
    this.slices = 0;
    this.frame_error = null;
    this.input_error = null;
    this.idle_taken = new Map();
    this.trim_keep = a.x_trim_keep || 2000;
    this.replay_m = null;
    this.replay_limit = null;
    this.a15_frames_closed = 0;
    this.replaying = false;
    this.live = null;                // the live debug route (debug_input), made at the first debug input
    if (env.flags) {                 // the node host: stop and signalled live in shared memory (host/labworker.mjs)
      const f = env.flags;
      Object.defineProperty(this, 'stop', { get: () => Atomics.load(f, 1) !== 0, set: (v) => { Atomics.store(f, 1, v ? 1 : 0); }, enumerable: true });
      Object.defineProperty(this, 'signalled', { get: () => Atomics.load(f, 2) !== 0, set: (v) => { Atomics.store(f, 2, v ? 1 : 0); }, enumerable: true });
    }
  }
  // ---- session lifecycle
  opts() {
    const a = this.a;
    return { start: a.start, touch: a.touch, us_clock: a.us_clock, bgdraw: !a.no_bgdraw, mutant: a.x_mutant, a15: a.a15 ?? 'auto', hdmi: a.hdmi ?? 'off',
      ...(this.camapp_components ? { camapp_components: true } : {}) };
  }
  open_session() {
    const a = this.a;
    this.set_phase('starting');
    const tab = a.tab.split(',').map(decimalInt);
    if (tab.length !== 3 || tab.includes(null)) throw new ValueError(`--tab ${show(a.tab)}: three integers T,P,C`);
    const s = new PlaySession(this.env, { opts: this.opts(), lang: a.lang, device: a.device, start: tab, out: `${a.out}/shots`, tag: 'play',
      a15: (a.a15 ?? 'auto') === 'on' });
    // env.onPlaySession (the session replayer's recorder): the session and its lab as they stand right
    // after enter returned or raised (a failed enter closes and nulls the lab).
    try { s.enter(); } finally { this.env.onPlaySession?.(this, s, s.lab ?? null); }
    this.session = s;
    this.down.clear();
    this.touch_last = null;
    this.anchor();
    this.publish_frame();
    this.set_phase('running');
  }
  close_session() {
    if (this.live !== null) this.live.closed();
    if (this.session !== null) {
      this.a15_frames_closed += this.session.a15_frames;
      try { this.session.close(); } finally { this.session = null; }
    }
  }
  anchor() {
    this.w_a = this.wall();
    this.l_a = this.session ? this.session.lab.lab_time() : 0;
  }
  // ---- publishing
  set_phase(phase, error = null) {
    if (this.replaying && ['running', 'busy', 'waiting-gui'].includes(phase)) phase = 'replaying';
    this.phase = phase;
    if (error !== null) this.error = error;
    this.publish_status();
  }
  publish_status() {
    const s = this.session, a = this.a;
    const idle_taken = {};
    for (const [k, v] of this.idle_taken) idle_taken[typeof k === 'number' ? '0x' + k.toString(16).padStart(4, '0') : String(k)] = v;
    const doc = { phase: this.phase, error: this.error, queue: this.q.qsize() + this.held.length, idle: this.idle, last: this.last,
      dropped: this.dropped.toObject(), frame_seq: this.frame_seq, pace: this.pace_ratio(), stand_ins: this.stand_ins_in_use(),
      us_clock: a.us_clock, touch: a.touch, mutant: a.x_mutant, frame_error: this.frame_error, input_error: this.input_error,
      idle_taken, log_tail: this.log.slice(-12), ...(this.camapp_components ? { camapp_components: true } : {}),   // absent when off: the recorded documents
      ...(s?.hdmi_port && s.lab ? { hdmi: s.hdmi_status() } : {}),                                        // --hdmi on only, likewise
      ...(this.live !== null ? { debug: this.live.status() } : {}) };                                    // after a debug input only
    if (s !== null && s.lab !== null) {
      try { Object.assign(doc, s.status()); } catch (e) {
        if (!(e instanceof LabError)) throw e;          // a JS failure is never a status_error
        doc.status_error = cut(e.message, 300);
      }
    }
    this.status_seq += 1;
    doc.seq = this.status_seq;
    this.status_doc = doc;
    if (this.env.onStatus) this.env.onStatus(doc);
    this.box.notifyAll();
  }
  pace_ratio() {
    if (this.pace.length < 2) return null;
    const [w0, l0] = this.pace[0], [w1, l1] = this.pace[this.pace.length - 1];
    return w1 > w0 ? round((l1 - l0) / 1e6 / Math.max(1e-6, (w1 - w0) * 1000), 3) : null;
  }
  stand_ins_in_use() {
    const a = this.a;
    const used = ['H-UIINRING', 'H-UIIN', 'S-KEYBITS', 'H-G4SET', 'H-DIALSTEP', 'H-JSINJECT', 'SWITCH', 'H-POWER', 'S-HEAP',
      'S-TAKEOVER', 'H-CONNECT', 'H-EYESTATE', 'H-IPIINIT', 'A-IPI', 'S-CPU2'];
    if (a.x_mutant !== 'no-aeinit') used.push('H-AEINIT');
    if ((a.a15 ?? 'auto') !== 'off') used.push('A15');
    if (a.x_mutant !== 'no-dispq') used.push('S-DISPQ');                                     // :2519
    used.push('H-GUIBYAPP', 'S-CAMAPP', 'S-MODACK', 'S-RVSTANDBY', 'S-TRAACK', 'S-RELSEQ', 'S-CARD', ...(this.session?.lens ? [] : ['S-LENS']), 'S-EXPOSE', 'S-LONGTIMER', 'S-DISPFRAME', 'S-TAKEFRAME', 'S-AFOSD', 'S-CPU3', 'S-RECVIEW', this.env.nvram ? 'S-NVRAM' : 'S-SETSAVE', 'S-OUTDISP', 'S-THROUGH', 'S-PLAYSEQ', 'S-PLAYCOMP', 'S-PLAYVIEW', ...(this.camapp_components ? ['S-BOOTDONE'] : []));   // the camera application runs natively
    if ((a.device ?? 'tft') === 'evf' && a.x_mutant !== 'evf-store-after-open') used.push('H-STOREFIRST');   // :2521
    if (!a.no_bgdraw) used.push('S-BGDRAW');
    if (this.idle === 'wall') used.push('H-IDLE');
    if (a.touch !== 'off') used.push('H-TPINIT', 'H-TPSTART', 'S-TPREG', 'S-TPINT', 'S-GPIO-TP', 'H-TOUCHGAP');
    if (a.touch === 'gui') used.push('S-CAFWD', 'S-TOUCHMAP');
    if (a.us_clock === 'lab') used.push('A-USLAB');
    if (this.scene_used) used.push('S-SCENE', 'H-REQ');                                      // the image sensor stand-in's live view
    if (this.session?.lab?.iic_answered) used.push('S-IICWAIT');                            // a body whose firmware waits on the IIC bus
    if (this.session?.camapp?.dispsync_released) used.push('S-DISPSYNC');                   // a body whose GUI synced its display updates
    if (this.session?.camapp?.subject?.used) used.push('S-SUBJECT');                         // subject detection's frames drawn (subject.mjs)
    if (this.session?.lab?.panel_answered) used.push('S-PANELDONE');                        // a panel driver's serial completion wait answered
    if (this.session?.lab?.tp_sends?.length) used.push('S-TPSEND');                         // a synchronous send to the touch task
    if (this.session?.lab?.scpu_link) used.push('H-SCPUSTART', 'S-SIO2', ...this.session.lab.scpu_dev.labels, 'A-LINKPINS-1');   // a body whose PER_SCPU runs natively against the sub-CPU's model (S-SCPUDEV) or its own firmware (scpum4.mjs)
    if (this.session?.scpu_port) used.push('H-SCPUIRQ', 'H-UIINPORT', 'H-SCPUPORT');        // a body whose group 0 comes through the SCPU's ports
    if (this.session?.uiin_scan) used.push('H-UIINSCAN');                                    // UI_IN's port scan over the link
    if (this.session?.hdmi_port || this.session?.lab?.scpu_link) used.push('H-GIOSLOTS');   // the GIO slots, for the HDMI pin or the link's pin 102
    if (this.session?.hdmi_port) used.push('S-HDMISINK', 'A-HDMI-1');                       // --hdmi on: the HDMI port, its sink
    if (this.session?.storage) used.push('H-FILEINIT', 'H-FILECLBK', 'S-SDHOST', 'S-SDCARD', 'S-FSNAND', ...(this.session.storage.f.album_init !== null ? ['S-ALBM'] : []), 'S-RECFILE');   // the file system native on a card (storage.mjs; S-ALBM where the body has an album manager)
    if (this.session?.storage?.powered) used.push('S-SDPOWER');                           // a card supply request answered
    const media = this.session?.camapp?.media;
    if (media?.formats || media?.ctrl) used.push('S-MDACTRL');                               // a Card Formatting from the menu (media.mjs)
    if (this.session?.storage?.removals || this.session?.storage?.insertions) used.push('S-MEDIA');   // a card taken out or put back (media.mjs)
    if (this.session?.lens) used.push('H-DPCINIT', 'H-LENSINIT', 'S-LENSNAND', 'H-LENSON', 'S-LENSMCU', 'A-LENSSSC-1', 'A-LENSMCU-1', 'A-LENSMCU-2', 'A-LENSMCU-3', 'A-DPC-1');   // the lens on the mount natively (lens.mjs)
    if (this.session?.acc) used.push('H-ACCINIT', 'S-ACCREG', 'S-ACCSAMPLE', 'H-SLOPEINIT', 'A-ACC-1', 'A-ACC-2', 'A-ACC-3');   // a body whose accelerometer is stood in at its sample cache
    // the model's own stand-ins (src/fw/models.mjs return_stubs and call_skips, src/lab/play.mjs), each by its name
    for (const [, , name] of MODEL_INFO.return_stubs ?? []) used.push(name);
    for (const [, name] of MODEL_INFO.call_skips ?? []) used.push(name);
    return used;
  }
  // Compose and publish (PERF2's raw path: the frame is the sha of the raw composite); a composite error other than
  // PAL_UNWRITTEN keeps the previous frame and shows the error.
  publish_frame(policy = null) {
    const s = this.session;
    policy = policy || this.a.compose;
    let w, h, pixels;
    try { [w, h, pixels] = s.frame(policy, true); } catch (e) {
      if (!(e instanceof PlayError)) throw e;
      this.frame_error = cut(e.message, 600);
      return null;
    }
    this.frame_error = null;
    const sha = this.env.createHash('sha256').update(pixels).digest('hex').slice(0, 16);
    this.frame_seq += 1;
    this.frame = [null, s.device, s.lab.lab_time(), sha];
    if (this.env.onFrame) this.env.onFrame(w, h, pixels, { seq: this.frame_seq, device: s.device, lab_ns: this.frame[2], sha16: sha });
    this.box.notifyAll();
    return sha;
  }
  // Engine commands and display steps so far (taken before lab work; trim() runs only after the comparison).
  marks() {
    const lab = this.session.lab;
    lab.harvest();
    return [lab.exec_history.length, lab.steps.length, this.session.device];
  }
  // ---- inputs
  submit(inp) {
    if (!isDict(inp)) throw new ValueError(`an input is a JSON object, not ${jsonType(inp)}`);
    this.input_seq += 1;
    const seq = this.input_seq;
    this.q.put({ ...inp, seq, t_wall: this.wall() });
    return seq;
  }
  // q.put of an input that has its seq already (the /api/quit handler's control, seq 0).
  enqueue(inp) { this.q.put(inp); }
  // The input's result once finish() has it: ResultBox.wait.
  wait_result(seq, timeout = 120) { return this.box.wait(seq, timeout); }
  pop_result(seq) { return this.box.pop(seq); }
  // Wake the wait_result waiters (the host's own stop: every waiter answers).
  notify() { this.box.notifyAll(); }
  // Stop (a quit control, the host's own stop): the loop ends after this tick; the waiters see it at their next
  // notify (stopping wakes nobody). A quit control's stop (withResult) reaches them with its own result (finish),
  // as the node host's waiters see it (host/proxy.mjs): the status published in between wakes
  // nobody to a stop, so the control's ?sync=1 waiter answers its record (the browser's Worker, a headless Player).
  set_stop(withResult = false) {
    this.stop = true;
    if (!withResult) this.stop_seen = true;
    this.env.onStop?.();
  }
  // ---- the loop
  // Move every queued input to the tail of held, so gating sees one FIFO, each page's inputs in its own order.
  drain() {
    const n = this.held.length;
    for (let x; (x = this.q.get_nowait()) !== null;) this.held.push(x);
    if (this.held.length !== n) this.order_held();
  }
  // The inputs of one page keep the places they hold in the FIFO but take them in the page's order (cseq).
  order_held() {
    const places = new Map();
    this.held.forEach((x, i) => {
      const c = client_key(x);
      if (c !== null) { if (!places.has(c)) places.set(c, []); places.get(c).push(i); }
    });
    for (const idx of places.values()) {
      const items = idx.map((i) => this.held[i]).sort((x, y) => x.cseq - y.cseq);
      idx.forEach((i, k) => { this.held[i] = items[k]; });
    }
  }
  // An input leaves the FIFO (run, dropped or coalesced): its page's next expected cseq moves past it.
  took(inp) {
    const c = client_key(inp);
    if (c === null) return;
    const prev = this.client_next.get(c) ?? 1, after = inp.cseq + 1;
    const nxt = after > prev ? after : prev;
    this.client_next.set(c, nxt);
    for (const [k, [kc, kn]] of [...this.client_wait]) if (kc === c && kn < nxt) this.client_wait.delete(k);
    if (this.client_next.size > 64) {
      const old = this.client_next.keys().next().value;
      this.client_next.delete(old);
      for (const [k, [kc]] of [...this.client_wait]) if (kc === old) this.client_wait.delete(k);
    }
  }
  // True while inp must wait for an earlier input of its page that has not arrived (at most ORDER_WAIT_S of wall time).
  overtook(inp) {
    const c = client_key(inp);
    if (c === null) return false;
    const want = this.client_next.get(c) ?? 1;
    if (inp.cseq <= want) return false;
    const key = `${c}\0${want}`;
    if (!this.client_wait.has(key)) this.client_wait.set(key, [c, want, this.wall() + ORDER_WAIT_S]);
    if (this.wall() < this.client_wait.get(key)[2]) return true;
    this.client_wait.delete(key);
    this.dropped.add('page input missing', inp.cseq - want);
    return false;
  }
  // The next input in arrival order with gating applied: key repeats dropped, a run of touch moves coalesced to its
  // newest, dial detents capped. The waits: with nothing held, block waits 20 ms
  // for one input; an input that overtook its page's order waits 10 ms (block) or 2 ms for the next one, until its
  // order deadline. On an ArrayQueue get returns at once; with env.asyncHost (the browser) a blocking call with an
  // overtaking input returns null instead, so the host's own wait lets the missing input arrive.
  next_input(block) {
    for (;;) {
      this.drain();
      if (!this.held.length) {
        if (!block) return null;
        const x = this.q.get(0.02);
        if (x === null) return null;
        this.held.push(x);
        continue;
      }
      if (this.overtook(this.held[0])) {
        if (block && this.env.asyncHost) return null;
        const x = this.q.get(block ? 0.01 : 0.002);
        if (x !== null) { this.held.push(x); this.order_held(); } else if (!block) return null;
        continue;
      }
      let inp = this.held.shift();
      this.took(inp);
      this.current = inp;
      const t = get(inp, 'type');
      const cid = typeof get(inp, 'id') === 'string' ? inp.id : null;
      if (t === 'key' && get(inp, 'action') === 'down' && ['key', 'shutter', 'gui', 'fwkey', 'inject'].includes(BY_ID.get(cid)?.kind)) {
        if (this.down.has(inp.id)) {               // a held key: the host's auto-repeat is dropped
          this.dropped.add('key repeat');
          this.finish(inp, null);
          continue;
        }
      }
      if (t === 'touch' && get(inp, 'action') === 'move') {
        while (this.held.length && get(this.held[0], 'type') === 'touch' && get(this.held[0], 'action') === 'move') {
          this.dropped.add('touch moves coalesced');
          this.finish(inp, null);
          inp = this.held.shift();
          this.took(inp);
          this.current = inp;
        }
      }
      if (t === 'dial') {
        const n = detents_of(inp);
        if (n === null) {
          this.finish(inp, null, `dial: detents ${field(inp, 'detents')} is not an integer`);
          continue;
        }
        const name = `dial ${label(cid)}`;
        if (Math.abs(n) > DIAL_CAP) {
          this.dropped.add(name, Math.abs(n) - DIAL_CAP);
          inp.detents = n > 0 ? DIAL_CAP : -DIAL_CAP;
        }
        const waiting = [...this.q.items(), ...this.held];
        const queued = waiting.filter((x) => get(x, 'type') === 'dial' && get(x, 'id') === get(inp, 'id')).reduce((sum, x) => sum + Math.abs(detents_of(x) || 0), 0);
        if (queued >= DIAL_CAP) {
          this.dropped.add(name, Math.abs(detents_of(inp)));
          this.finish(inp, null);
          continue;
        }
      }
      return inp;
    }
  }
  // A debug input's answer: the live route's response object, as the result's debug field.
  finish_debug(inp, answer) { this.finish(inp, null, null, { debug: answer }); }
  // extra: the fields an answer that is not a record adds to the result (a debug input's debug, a card read's card);
  // an input with one is not dropped
  finish(inp, rec, error = null, extra = null) {
    if (inp === this.current) this.current = null;
    const lr = rec ? light(rec) : null;
    if (lr !== null && error === null) lr.frame = this.frame ? this.frame[3] : null;
    const res = { record: lr, error, dropped: !rec && error === null && extra === null, frame_seq: this.frame_seq };
    if (extra !== null) Object.assign(res, extra);
    if (this.stop) this.stop_seen = true;                // a quit control's stop takes effect with its result
    this.box.put(inp.seq, res);
    this.env.onResult?.(inp.seq, res);
  }
  stopping() { return this.stop || this.signalled; }
  // The first debug input or control in the FIFO, the others left held in their order (a halted or stopped session
  // takes only these): a debug input is taken out of it, a control too when take_controls (else it stays, for the
  // stopped session to see and let its stop go); null when there is none (block: after a blocking queue's 20 ms wait
  // for one).
  next_debug(block, take_controls) {
    for (;;) {
      this.drain();
      const i = this.held.findIndex((x) => ['debug', 'control'].includes(get(x, 'type')));
      if (i >= 0) return get(this.held[i], 'type') === 'control' && !take_controls ? this.held[i] : this.held.splice(i, 1)[0];
      if (!block || !this.q.canBlock) return null;
      const x = this.q.get(0.02);
      if (x === null) return null;
      this.held.push(x);
      this.order_held();
    }
  }
  // Whether a debug input or control waits (web/driver.mjs: a halted session's next tick).
  debug_ready() { return [...this.q.items(), ...this.held].some((x) => ['debug', 'control'].includes(get(x, 'type'))); }
  // A debug input: refused without --debug-api, else the live route's answer (now, or later for a cont).
  debug_input(inp) {
    if (!this.a.debug_api) { this.finish(inp, null, 'debug inputs need --debug-api'); return; }
    this.live ??= new LiveDebug(this, this.env.debugHost ?? {});
    const answer = this.live.handle(inp);
    if (answer !== null) this.finish_debug(inp, answer);
  }
  // A read of the card's files ({type: 'cardfiles', op: 'list'} or {op: 'read', path}: the players' Card panel,
  // src/lab/playapi.mjs /api/card): the card in the first slot as its sectors stand between ticks (the session's,
  // in the slot or out of it, or the one the host keeps while no session runs), read by the host's reader
  // (env.cardView, web/cardfiles.mjs: refs/fat.mjs or refs/exfat.mjs, not the firmware). Nothing of the lab runs; it
  // stays outside the session log, the GUI's event gate and --replay, as a debug input does. The answer is the result's
  // card field: {slot: {present, mounted, session, file, kind ('SDHC' or 'SDXC'), sectors (its capacity)}, ...the
  // reader's answer} (its error field when the volume cannot be read);
  // the result's error is a refusal (no reader, no card on this body, an unknown op).
  card_files(inp) {
    const view = this.env.cardView ?? null, op = get(inp, 'op'), path = get(inp, 'path');
    let why = null;
    if (view === null) why = 'cardfiles: this host reads no card files (env.cardView)';
    else if (!STORAGE || !this.env.card) why = `cardfiles: ${MODEL} has no card with a file system in the lab (S-CARD)`;
    else if (op !== 'list' && op !== 'read') why = `cardfiles: op ${field(inp, 'op', 40)} (list, read)`;
    else if (op === 'read' && (typeof path !== 'string' || !path)) why = `cardfiles read: path ${field(inp, 'path', 80)} is not a file's path`;
    if (why !== null) { this.finish(inp, null, why); return; }
    const st = this.session?.storage ?? null, card = st ? st.card : this.env.card.open();
    const read = (lba, count) => card.read(lba, count);
    const slot = { present: card.present, mounted: st ? st.mounted : false, session: st !== null, file: this.env.card.file ?? null,
      kind: card.kind, sectors: card.sectors };
    this.finish(inp, null, null, { card: { slot, ...(op === 'list' ? view.list(read) : view.read(read, path)) } });
  }
  run() {
    // the --replay file's entries (env.readReplay: the host's file read); a read error or a malformed file is raised
    // out of run(), before the session starts
    const replay = this.a.replay ? replayEntries(this.a.replay, this.env.readReplay(this.a.replay)) : null;
    this.replaying = replay !== null;
    try { this.open_session(); } catch (e) {
      if (!(e instanceof LabError)) throw e;
      this.replaying = false;
      this.set_phase('error', this.describe(e));
      if (this.a.no_wait_on_error) throw e;
    }
    if (replay !== null && this.session !== null) {
      this.replaying = true;
      this.set_phase('replaying');
      try { this.run_replay(replay); } finally { this.replaying = false; }
      if (this.session !== null) this.set_phase('running');
    }
    while (!this.stopping()) {
      if (!this.q.canBlock && !this.q.qsize() && !this.held.length && this.current === null) throw new Error('Player.run: no input queued and not stopping (headless)');
      try { this.tick(); } catch (e) {
        if (!(e instanceof LabError)) throw e;
        this.fail(e);
      }
    }
    this.close_session();
    this.write_log();
  }
  describe(e) {
    const s = this.session;
    let tail = '';
    try { if (s !== null && s.lab !== null) tail = s.lab.stderr_tail(800); } catch (x) { if (!(x instanceof LabError)) throw x; }
    return { message: `${e.name}: ${cut(e.message, 2500)}`, stderr_tail: tail, traceback: '' };
  }
  fail(e) {
    this.set_phase('error', this.describe(e));
    // a session the browser's Driver fails on a host error (Unported, HostStopped) may not close cleanly either
    try { this.close_session(); } catch (x) { if (!(x instanceof LabError || x instanceof Unported || x instanceof HostStopped)) throw x; }
    if (this.current !== null) this.finish(this.current, null, this.error.message);
    while (this.held.length) this.finish(this.held.shift(), null, this.error.message);
  }
  tick() {
    if (this.live !== null) {                       // the live debug route: a cont's maxMs, a halted session
      this.live.poll();
      if (this.live.halted) { this.live.tick_halted(); return; }
    }
    const s = this.session;
    if (s === null) {                               // off or error: only control inputs
      const inp = this.next_input(true);
      if (inp === null) return;
      if (get(inp, 'type') === 'control') this.control(inp);
      else if (get(inp, 'type') === 'cardfiles') this.card_files(inp);    // the card stays readable while off
      else this.finish(inp, null, `no session (${this.phase})`);
      return;
    }
    let inp = this.next_input(false);
    if (inp !== null) { this.apply(inp); return; }
    if (this.idle === 'wall') this.pace_step();
    else {
      inp = this.next_input(true);
      if (inp !== null) this.apply(inp);
    }
  }
  // H-IDLE (--idle wall): lab time follows the wall clock from the anchor (w_a, l_a), in slices of at most SLICE_NS; a
  // lab more than BEHIND_NS behind re-anchors (dropped 'pacing re-anchored'). Lab time ahead: wait for an input
  // (no 20 ms q.get here: next_input returns at once and the host waits).
  pace_step() {
    const s = this.session;
    const now_w = this.wall();
    const lab = s.lab.lab_time();
    let target = this.l_a + Math.trunc((now_w - this.w_a) * 1e9);   // int() of the same double
    if (lab >= target) {
      const inp = this.next_input(true);
      if (inp !== null) this.apply(inp);
      return;
    }
    if (target - lab > BEHIND_NS) {
      this.anchor();
      target = this.l_a + 1000000;
      this.dropped.add('pacing re-anchored');
    }
    const m = this.marks();
    const e0 = s.lab.events.length;
    s.idle_slice(Math.min(target, lab + SLICE_NS));
    for (const e of s.lab.events.slice(e0)) if (e[0] === 'take') this.idle_taken.set(e[1], (this.idle_taken.get(e[1]) ?? 0) + 1);
    this.after_lab_time(m);
    this.flush_log();
    this.pace.push([this.wall(), s.lab.lab_time()]);
    if (this.pace.length > 200) this.pace.shift();            // the last 200
    this.slices += 1;
    if (this.slices % TRIM_EVERY === 0) s.trim(this.trim_keep);
    if (this.slices % 10 === 0) this.publish_status();
  }
  // After lab work: touch gestures to the GUI, a new frame if something drew.
  // S-SCENE's live view changed since the last published frame (its scene, or a moving layer's 1/15 s step): the frame
  // is published although no GUI step or engine command happened (a recording clears the GUI). False with no live view.
  scene_moved() {
    const sc = this.session?.scene;
    if (!sc || !sc.liveview) return false;
    const moving = sc.layers.some((l) => l.speed);
    const k = JSON.stringify([sc.preset, sc.layers, sc.ev, sc.lens, sc.exposure, moving ? Math.floor(this.session.lab.lab_time() / (1e9 / 15)) : 0]);
    if (k === this.scene_published) return false;
    this.scene_published = k;
    return true;
  }
  after_lab_time(m, force = false) {
    const s = this.session;
    if (s === null) return;
    if (s.pending_touch()) {
      const t0 = s.lab.lab_time();
      const rec = s.touch_gui_step();
      this.log_input({ type: 'internal', what: 'touch gesture' }, rec, t0);
    }
    const now = this.marks();
    const scene = this.scene_moved();                // S-SCENE: a new live-view frame is a new frame even with a still GUI
    if (force || scene || now.length !== m.length || now.some((x, i) => x !== m[i])) {
      if (this.replay_limit !== null && this.a.x_mutant !== 'replay-no-limit') {   // --replay (replay-no-limit drops the limit)
        const nb = s.next_boundary();
        if (nb !== null && nb > Math.max(this.replay_limit, s.lab.lab_time())) {
          if (this.replay_m === null) this.replay_m = m;
          return;
        }
      }
      this.publish_frame();
    }
  }
  // B7: the GUI awaits an event ((0x603710f8) != 0): run 10 ms slices until it is taken (at most 2 s of lab time).
  hold_for_gate(inp) {
    const s = this.session;
    if (['control', 'token'].includes(get(inp, 'type')) || this.a.x_mutant === 'no-gate') return 0;
    if (get(inp, 'type') === 'key' && get(inp, 'action') === 'up') return 0;
    const t0 = s.lab.lab_time();
    if (s.gate_open()) return 0;
    this.set_phase('waiting-gui');
    while (!s.gate_open()) {
      if (s.lab.lab_time() - t0 > GATE_LIMIT_NS) {
        throw new PlayError(`the GUI still awaits event 0x${s.lab.sim.u32(B7_GATE).toString(16)} after ${Math.floor(GATE_LIMIT_NS / 1000000)} ms of lab time`);
      }
      const m = this.marks();
      s.idle_slice(s.lab.lab_time() + GATE_SLICE_NS);
      this.after_lab_time(m);
    }
    this.set_phase('running');
    return s.lab.lab_time() - t0;
  }
  // One input; a lab failure anywhere in it closes the session (error status), then answers the input with the error.
  apply(inp) {
    try { this._apply(inp); } catch (e) {
      if (!(e instanceof LabError)) throw e;
      const answered = this.results.has(inp.seq);
      if (this.current === inp) this.current = null;
      this.fail(e);
      if (!answered) this.finish(inp, null, `${e.name}: ${cut(e.message, 2000)}`);
    }
  }
  _apply(inp) {
    const s = this.session;
    const t = get(inp, 'type');
    if (t === 'control') { this.control(inp); return; }
    if (t === 'debug') { this.debug_input(inp); return; }
    if (t === 'cardfiles') { this.card_files(inp); return; }
    const held_ns = this.hold_for_gate(inp);
    if (this.session === null) { this.finish(inp, null, 'no session'); return; }
    this.set_phase('busy');
    const early = this.a.x_mutant === 'touch-lab-ns-early';     // lab_ns logged before the gap slice
    if (t === 'touch' && !early) this.touch_gap(inp);   // before lab_ns: the log holds the lab time the sample ran at
    const lab_ns = s.lab.lab_time();
    if (t === 'touch' && early) this.touch_gap(inp);
    let rec = null;
    const m = this.replay_m === null ? this.marks() : this.replay_m;
    this.replay_m = null;
    try { rec = this.run_input(inp); } catch (e) {
      if (e instanceof ValueError || e instanceof KeyError || e instanceof RefusedInput) {     // a bad request, not a lab failure
        this.input_error = e instanceof RefusedInput ? e.message : `${e.name}: ${e.message}`;
        this.set_phase('running');
        this.finish(inp, null, this.input_error);
        return;
      }
      if (e instanceof PlayError && (e.message.includes('not wired') || e.message.includes('no LONG_ON') || e.message.includes('touch is off'))) {
        this.input_error = e.message;
        this.set_phase('running');
        this.finish(inp, null, e.message);
        return;
      }
      throw e;
    }
    if (rec !== null && held_ns) rec.held_ms = round(held_ns / 1e6, 3);
    if (this.session === null) {                     // power off
      this.log_input(inp, rec, lab_ns);
      this.flush_log();
      this.publish_status();
      this.finish(inp, rec);
      return;
    }
    if (rec === null) {                              // nothing ran (a switch's release, a display key's release)
      this.set_phase('running');
      this.finish(inp, null);
      return;
    }
    s.camapp?.expose();                              // S-EXPOSE: the camera plans again after the input
    this.input_error = rec.dial_unread ?? null;
    const entry = this.log_input(inp, rec, lab_ns);
    this.after_lab_time(m);
    entry.frame = this.frame ? this.frame[3] : null;
    this.env.onLogUpdate?.(entry);                   // the one log entry changed after it was appended
    if (get(inp, 'type') === 'touch') {
      this.touch_last = { action: inp.action, lab_ns, end_ns: s.lab.lab_time(), t_wall: inp.t_wall, client: client_key(inp), t_client: get(inp, 't_client') };
    }
    s.trim(this.trim_keep);
    this.anchor();
    const latency = round((this.wall() - inp.t_wall) * 1000, 1);
    this.last = { input: without(inp, ['t_wall', 'seq']), latency_ms: latency, record: light(rec) };
    this.flush_log();
    this.set_phase('running');
    this.finish(inp, rec);
  }
  run_input(inp) {
    const s = this.session;
    if (!has(inp, 'type')) throw new KeyError(show('type'));
    const t = inp.type;
    if (t === 'key') {
      const c = control_of(inp);
      const act = has(inp, 'action') ? inp.action : 'down';
      if (!['down', 'up', 'long'].includes(act)) throw new ValueError(`key ${c.id}: action ${field(inp, 'action', 40)} (down, up, long)`);
      if (act === 'down') this.down.add(inp.id);
      else if (act === 'up') this.down.delete(inp.id);
      if (c.kind === 'switch' || c.kind === 'fwswitch') {
        if (act !== 'down') return null;
        return s.switch_input(c.id, 1 - s.bit_of(c.id));
      }
      if (c.kind === 'modedial') return s.switch_input('mode_dial', (s.mode_index + (act === 'down' ? 1 : 0)) % MODE_DIAL.positions.length);
      if (c.kind === 'display') return act === 'down' ? s.display_input(c.id) : null;
      if (c.kind === 'power') return act === 'down' ? this.power(act) : null;
      if (c.kind === 'dial') throw new ValueError('dials take {type: dial}');
      const rec = s.key(c.id, act);
      const sc = s.scene_key(c.id, act);
      if (sc !== null && rec !== null && typeof rec === 'object') rec.scene = sc;
      return rec;
    }
    if (t === 'scene') {
      if (!has(inp, 'change')) throw new KeyError(show('change'));
      try {
        const rec = s.scene_input(get(inp, 'change'));
        if (s.scene?.liveview) this.scene_used = true;
        return rec;
      } catch (e) {
        if (e instanceof RangeError) throw new ValueError(e.message);
        throw e;
      }
    }
    if (t === 'switch') {
      const c = control_of(inp);
      if (c.kind === 'power') return this.power(bit_value(inp) ? 'on' : 'off');
      if (c.kind === 'display') return s.display_input(c.id, has(inp, 'value') ? bit_value(inp) : null);
      if (c.kind === 'modedial' && has(inp, 'step')) {               // step positions on, either way, wrapping
        const n = MODE_DIAL.positions.length;                           // 10 on E143, the model's own count elsewhere
        return s.switch_input(c.id, (((s.mode_index + (integer(inp, 'step') % n)) % n) + n) % n);
      }
      if (c.kind === 'modedial') return s.switch_input(c.id, integer(inp, 'value'));
      return s.switch_input(c.id, bit_value(inp));
    }
    if (t === 'dial') {
      const n = detents_of(inp);
      if (n === null) throw new ValueError(`dial: detents ${field(inp, 'detents')} is not an integer`);
      return s.dial_input(get(inp, 'id'), n);
    }
    if (t === 'touch') {
      const act = get(inp, 'action');
      if (!['down', 'move', 'up'].includes(act)) throw new ValueError(`touch: action ${field(inp, 'action', 40)} (down, move, up)`);
      const x = number(inp, 'x'), y = number(inp, 'y');
      return s.touch(act, x, y);
    }
    if (t === 'hdmi') return s.hdmi_input(get(inp, 'action'));
    if (t === 'card') return s.card_input(get(inp, 'action'));
    if (t === 'tilt') {                                              // degrees, fractions kept; a field left out is 0
      const deg = (k) => {
        if (!has(inp, k)) return 0;
        const v = get(inp, k);
        if (!isNum(v)) throw new ValueError(`tilt ${k}: ${brief(v)} is not a number`);
        return v + 0;
      };
      return s.tilt_input(deg('roll'), deg('pitch'));
    }
    if (t === 'request') throw new ValueError('request: the camera application sends the GUI its own requests');
    if (t === 'token') {
      if (!this.a.debug_api) throw new ValueError('tokens need --debug-api');
      const tok = get(inp, 'token');
      if (typeof tok !== 'string') throw new ValueError(`token ${field(inp, 'token')}: a string`);
      if (tok.startsWith('EV:') || tok.startsWith('SET:') || tok.startsWith('WAIT:') || tok.startsWith('CLOCK:') || tok === 'OPEN' || tok === 'CLOSE') return s.step(tok);
      if (tok.startsWith('WAIT_UNTIL:')) return s.wait_until(tokenInt(tok, decimalInt), tok);
      if (tok.startsWith('GET:')) {
        const sid = tokenInt(tok, intLiteral);
        s.begin(`${String(s.steps.length).padStart(2, '0')}-${tok}`);
        return s.end(tok, 'get', [], [], { get: { id: sid, value: s.get(sid) } });
      }
      if (['WINDOWS', 'INTC', 'VSC', 'B2', 'EYE', 'STORE'].includes(tok) || tok.startsWith('XCALL:') || tok.startsWith('WINDOWS:')) {
        if (!this.env.refuseUnported) return s.debug_token(tok);
        const n0 = s.steps.length, i0 = S.insns;  // read without touching the lab (its Stats see nothing)
        try { return s.debug_token(tok); } catch (e) {
          // refused only when nothing ran: no step begun, no instruction executed
          if (e instanceof Unported && s.steps.length === n0 && S.insns === i0) throw new RefusedInput(`Unported: ${e.message.replace(/^unported: /, '')}`);
          throw e;
        }
      }
      throw new ValueError(`token ${show(tok)}: EV, SET, WAIT, WAIT_UNTIL, CLOCK, OPEN, CLOSE, GET, WINDOWS[:width], INTC, VSC, B2, EYE, STORE, XCALL:ctrl_or:ch:en`);
    }
    throw new ValueError(`input type ${field(inp, 'type')}`);
  }
  // H-TOUCHGAP before a touch sample: at least TOUCH_MIN_NS of lab time after the previous sample ended; with --idle wall
  // also at least the user's gap after the lab time the previous sample ran at (capped).
  touch_gap(inp) {
    const s = this.session, last = this.touch_last, act = get(inp, 'action');
    if (last === null || !['down', 'move', 'up'].includes(act)) return;
    let want = last.end_ns + TOUCH_MIN_NS;
    const inside = (act === 'move' || act === 'up') && (last.action === 'down' || last.action === 'move');
    const between = act === 'down' && last.action === 'up' && this.a.x_mutant !== 'tap-floor-only';
    if (this.idle === 'wall' && (inside || between)) {
      const c = client_key(inp);
      const t1 = get(inp, 't_client'), t0 = last.t_client;
      const gap = c !== null && c === last.client && isNum(t0) && isNum(t1) ? (t1 - t0) * 1e6 : (inp.t_wall - last.t_wall) * 1e9;
      const cap = inside ? TOUCH_GAP_CAP_NS : TOUCH_TAP_CAP_NS;
      want = Math.max(want, last.lab_ns + Math.trunc(Math.min(cap, Math.max(0, gap))));
    }
    if (want > s.lab.lab_time()) {
      const m = this.marks();
      s.idle_slice(want);
      this.after_lab_time(m);
    }
  }
  power(act) {
    const s = this.session;
    if (act === 'down') act = 'off';
    if (act === 'off') {
      const rec = s.switch_input('power', 1 - s.bit_of('power'));
      this.close_session();
      this.set_phase('off');
      return rec;
    }
    return null;
  }
  // restart, power (value 0, false or null off, anything else on; on when absent), camapp (value 2: a new session with
  // the HLS components running, other values: one without), pause, resume, quit; the status is published before
  // the answer.
  control(inp) {
    const op = get(inp, 'op');
    let res = { kind: 'control', token: op, state: {} }, err = null;
    try {
      const value = has(inp, 'value') ? inp.value : 1;
      if (op === 'camapp') {                         // a new session with (value 2) or without the HLS components
        this.camapp_components = Number(value) === 2;
        this.close_session();
        this.error = null;
        this.open_session();
        res.token = `camapp ${this.camapp_components ? 'components' : 'on'}`;
      } else if (op === 'restart' || (op === 'power' && value !== 0 && value !== false && value !== null)) {
        this.close_session();
        this.error = null;
        this.open_session();
      } else if (op === 'power') {
        if (this.session !== null) this.power('off');
        res.token = 'power off';
      } else if (op === 'pause') this.idle = 'off';
      else if (op === 'resume') { this.idle = 'wall'; this.anchor(); }
      else if (op === 'quit') this.set_stop(true);
      else { res = null; err = `control ${field(inp, 'op')}`; }
    } catch (e) {
      if (!(e instanceof LabError)) throw e;
      this.fail(e);
      res = null;
      err = cut(e.message, 2000);
    }
    if (err === null && (op === 'restart' || op === 'power' || op === 'camapp')) {   // in the session log: --replay restarts and powers off there too
      this.log_input(inp, null);
      this.flush_log();
    }
    this.publish_status();
    this.finish(inp, res, err);
  }
  // Append to the session log (in memory, the last 20,000; every entry also goes to session.jsonl).
  log_input(inp, rec, lab_ns = null) {
    this.log_count += 1;
    const entry = { seq: has(inp, 'seq') ? inp.seq : null, idx: this.log_count, lab_ns, input: without(inp, ['t_wall', 'seq']), record: light(rec), frame: this.frame ? this.frame[3] : null };
    this.log.push(entry);
    this.env.onLogEntry?.(entry);
    if (this.log.length > 20000) {
      this.flush_log();
      this.log.splice(0, 1000);
      this.log_written -= 1000;
      this.env.onLogTrim?.(1000);
    }
    return entry;
  }
  flush_log() {
    const fresh = this.log.slice(this.log_written);
    if (fresh.length) {
      if (this.env.logSink) this.env.logSink('session.jsonl', fresh.map((e) => JSON.stringify(e) + '\n').join(''));
      this.log_written = this.log.length;
    }
  }
  // At exit: session.json (arguments, stand-ins in use, the inputs in memory).
  write_log() {
    this.flush_log();
    const s = this.session;
    const frames = this.a15_frames_closed + (s !== null ? s.a15_frames : 0);
    const args = { ...this.a };
    const doc = { args, stand_ins: this.stand_ins_in_use(), assumptions_in_use: frames ? { A15: { frames, mode: this.a.a15 ?? 'auto' } } : {}, inputs: this.log };
    if (this.env.logSink) this.env.logSink('session.json', JSON.stringify(doc));
  }
  // --replay: the logged inputs at their lab times (idle off between them); internal entries post the touch gestures at
  // the lab time the session did; a frame waits for a later entry when its boundary lies past the
  // next entry's lab time; restart, power and camapp run where they were logged.
  run_replay(entries) {
    this.idle = 'off';
    try {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i], lab_ns = get(e, 'lab_ns');
        let inp = e.input;
        const nxt = i + 1 < entries.length ? get(entries[i + 1], 'lab_ns') : null;
        if (inp.type === 'control') {
          if (['restart', 'power', 'camapp'].includes(inp.op)) {
            this.replay_m = this.replay_limit = null;
            this.control({ ...inp, seq: -1, t_wall: this.wall() });
            if (this.phase === 'error') return;
          }
          continue;
        }
        const s = this.session;
        if (s === null) {
          const what = label(get(inp, 'id') || get(inp, 'action') || get(inp, 'what') || '');
          this.fail(new PlayError(`--replay: log entry ${label(get(e, 'idx'))} (${typeOf(inp)} ${what}) needs a session, and there is none (${this.phase}): no restart or power on is logged before it`));
          return;
        }
        this.replay_limit = lab_ns || s.lab.lab_time();
        if (lab_ns && lab_ns > s.lab.lab_time()) {
          const m = this.marks();
          s.wait_until(lab_ns, 'replay');
          if (this.a.x_mutant === 'replay-frame-wait') this.publish_frame();     // a frame after each wait
          else if (this.replay_m === null) this.replay_m = m;
        }
        this.replay_limit = nxt || null;
        if (inp.type === 'internal') {
          const m = this.replay_m || this.marks();
          this.replay_m = null;
          this.after_lab_time(m);                    // the gestures pending at this lab time go to the GUI
          continue;
        }
        inp = { ...inp, seq: -1, t_wall: this.wall() };
        this.apply(inp);                             // a failure closes the session (the loop then ends)
        if (this.session === null && this.phase === 'error') return;
      }
    } finally {
      this.replay_limit = null;
    }
    if (this.replay_m !== null && this.session !== null) {
      const m = this.replay_m;
      this.replay_m = null;
      this.after_lab_time(m);
    }
  }
}
export { P };
