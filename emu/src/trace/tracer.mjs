// The trace of one scenario (one HLE session), format om1-stage0-ref/2 for the Stage 0 scenarios and om1-stage0-ref/4
// for the Stage 1 and Stage 2 ones (and a Stage 2 session's later labs NAME#k).
// Events, in guest order:
//   ['stop', n, kind, name, regs, t, h]    every continue / step: the hook that ran there (or null), the 'g' image,
//                                          lab time (ns), the first 16 hex digits of the harness digest
//   ['irq', presented_rows, accepted_rows] interrupt-controller ring rows new since the previous stop
//   ['mark', label, info]                  group boundaries (devices summary; OSD: return value, planes); Stage 1:
//                                          one per recorded call (devices summary, GUI state)
//   ['check', group, label, got, want, ok] check_kernel Check.eq, values normalised (tracejson norm)
//   ['frame', info]                        OsdLab.drawing() brackets
//   ['compose', info]                      /4 only: every DisplayLab.compose that returned (device, next_frame, status,
//                                          errors, notes, header, planes, pixels as {sha256, len})
//   ['dstep', record]                      /4 only: every append to the session lab's DisplayLab.steps (normOut of it)
//   ['dnote', [note, ...]]                 /4 only: every non-empty append to DisplayLab.notes
// Format /4 also adds the vsc, stub and ipi blocks to every devices summary (marks and final.devices), counts.composes,
// counts.dsteps, counts.dnotes, final.lab (DisplayLab.steps / notes lengths and canonical-JSON digests at the end),
// final.planes of the session lab's surfaces, and the inventory (every stop's hook name counted, the lab's stand-in
// counters) to the document. (/3, the Stage 1 format without dstep, dnote, ipi and final.lab, is no longer written.)
// The harness digest h hashes every register write ('G' + its hex) and every Simulator.write ('M' + <u32 address,
// u32 length> + data), except from a memset/memcpy hook stop to the next run and writes into the HLE window.
import { Stats, regsHex } from '../lab/sim.mjs';
import * as IRQ from '../lab/irq.mjs';
import { pack, bytesHex } from '../util/bytes.mjs';
import { norm, normOut, canonJson } from '../util/tracejson.mjs';

export const FORMAT = 'om1-stage0-ref/2';
export const FORMAT3 = 'om1-stage0-ref/3';
export const FORMAT4 = 'om1-stage0-ref/4';
export const STAGE1_SCENARIOS = ['shoot-tft', 'shoot-evf', 'menu-tft', 'nav-a', 'nav-evf'];
// The Stage 2 scenarios (replayed at the Player boundary by scenarios/session_replay.mjs)
export const STAGE2_SCENARIOS = ['play-perf', 'scp-timeout', 'scp-edge', 'evf-idle', 'eye-burn', 'switch-shoot', 'switch-scp',
  'inputs', 'a15-open', 'queue', 'power', 'scp-replay', 'keys', 'b7-gate', 'power-replay', 'tokens', 'playback', 'tokens-3b',
  'pace-wall'];
// The Stage 3 scenarios (check_irq I4's menu session, calls format /1)
export const STAGE3_SCENARIOS = ['menu-open', 'menu-open-any'];
// A scenario's format: /2 for Stage 0, /4 for Stages 1, 2 and 3 (NAME#k: a later lab of a Stage 2 session).
export function fmtOf(name) {
  const base = String(name).split('#')[0];
  return STAGE1_SCENARIOS.includes(base) || STAGE2_SCENARIOS.includes(base) || STAGE3_SCENARIOS.includes(base) ? FORMAT4 : FORMAT;
}
const VSC_DEBUG = 0x89800000, STUB_WINDOW = 0x89900000;
const T_ADDR = IRQ.TIMER_DEBUG + IRQ.T_T;
const HLE_WIN = [0x89A30000, 0x89A34000];
const BASE_STUBS = new Set(['memset', 'memcpy']);
const OSD_DEBUG = 0x8E000000;
const ENGINE_FIELDS = [['starts', 0x18], ['cmds_executed', 0x1C], ['err_total', 0x08], ['exec_total', 0x2C], ['irq_line', 0x0C]];
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// The per-HLE session: Stats always (g_digest is checked on every pass), the tracer when tracing, else the harness
// digest alone, so that a run with tracing off (bench.mjs) still checks the harness's own writes: final is then
// statsDict + harness_sha, the value the reference has in final.harness_sha.
export class Session {
  constructor(name, createHash, trace) {
    this.name = name;
    this.createHash = createHash;
    this.stats = new Stats(createHash);
    this.tracer = trace ? new Tracer(name, createHash) : null;
    this.harness = trace ? null : new HarnessDigest(createHash);
    this.hle = null; this.final = null; this.lab = null;
  }
  attach(hle) { this.hle = hle; if (this.tracer) this.tracer.attach(hle); else this.harness.attach(hle); }
  close(hle, closeSim) {
    if (this.tracer && this.tracer.final === null) {
      this.tracer.finishDevices();
      closeSim();
      this.tracer.finish(hle, this.stats);
      return;
    }
    closeSim();
    this.final = this.harness ? { ...statsDict(this.stats), harness_sha: this.harness.hex() } : statsDict(this.stats);
  }
}
export const statsDict = (st) => ({ stops: st.stops, insns: st.insns, g_count: st.g_count, probes: st.probes, g_digest: st.digest.copy().digest('hex') });

// The harness digest h: every register write ('G' + its hex) and every Simulator.write ('M' + <u32 address, u32 length>
// + data), quiet from a memset/memcpy hook stop to the next run, HLE window writes left out.
export class HarnessDigest {
  constructor(createHash) { this.h = createHash('sha256'); this.quiet = false; }
  attach(hle) { hle.sim.observer = this; hle.stubObserver = (name) => { this.quiet = BASE_STUBS.has(name); }; }
  beforeRun() { this.quiet = false; }
  onStop() {}
  onG(text) { if (!this.quiet) this.h.update('G' + text.slice(1)); }
  onWrite(address, data) {
    if (!this.quiet && !(address >= HLE_WIN[0] && address < HLE_WIN[1]) && data.length) {
      this.h.update(pack('<BII', 0x4D, address >>> 0, data.length));
      this.h.update(data);
    }
  }
  hex() { return this.h.copy().digest('hex'); }
}

export class Tracer extends HarnessDigest {
  constructor(name, createHash) {
    super(createHash);
    this.name = name; this.createHash = createHash;
    this.events = []; this.nstops = 0;
    this.hle = null; this.lab = null; this.sim = null;
    this.presented_seen = 0; this.accepted_seen = 0;
    this.last_exec_raw = null; this.final = null;
    this.fmt = fmtOf(name);
    this.fmt3 = this.fmt === FORMAT4;   // the /3 extras: devices summaries with the vsc and stub blocks, ...
    this.fmt4 = this.fmt === FORMAT4;   // ... and /4's: dstep / dnote events, ipi blocks, final.lab and planes
    this.stub_hits = null; this.final_lab = null;
  }
  sha(data) { return this.createHash('sha256').update(data).digest('hex'); }
  attach(hle) {
    this.hle = hle;
    const sim = this.sim = hle.sim;
    this.presented_seen = sim.u32(IRQ.DEBUG + IRQ.D_PRESENTED_TOTAL);
    this.accepted_seen = sim.u32(IRQ.DEBUG + IRQ.D_ACCEPTED_TOTAL);
    sim.observer = this;
    hle.stubObserver = (name) => this.on_stub(name);
    hle.composeObserver = (device, nextFrame, result, n0, notes) => this.onCompose(device, nextFrame, result, n0, notes);
    if (this.fmt4) {
      this.lab = hle;                                   // final.planes: the session lab's surfaces
      this.xcpu_seen = sim.u32(IRQ.DEBUG + IRQ.D_XCPU_TOTAL);
      hle.labObserver = this;                           // DisplayLab.step / compose call dstep and dnote
    }
  }
  // Format /4: DisplayLab.steps and DisplayLab.notes as they are appended.
  dstep(record) { if (this.final === null) this.events.push(['dstep', normOut(record, (b) => this.sha(b))]); }
  dnote(notes) { if (this.final === null && notes.length) this.events.push(['dnote', normOut(notes, (b) => this.sha(b))]); }
  // A 'compose' event per DisplayLab.compose that returned (format /3).
  onCompose(device, nextFrame, result, n0, notes) {
    const pix = result.raw ?? wordsBytes(result.words);
    this.events.push(['compose', { device, next_frame: nextFrame, status: result.status, errors: norm(result.errors),
      error_total: result.error_total, notes: norm(notes.slice(n0)), note_total: notes.length, header: norm(result.header),
      planes: norm(result.planes), pixels: { sha256: this.sha(pix), len: pix.length } }]);
  }
  // ---- Simulator observer (beforeRun, onG, onWrite: HarnessDigest)
  onStop(kind) { this._stop(kind, regsHex(this.sim.m.getRegs())); }
  _time() { const b = this.sim.read(T_ADDR, 8); return u32(b, 0) + u32(b, 4) * 4294967296; }
  _stop(kind, raw) {
    this.events.push(['stop', this.nstops, kind, null, raw, this._time(), this.hex().slice(0, 16)]);
    this.nstops += 1;
    this._irq_rows();
  }
  _ring(totalOff, base, since) {
    const sim = this.sim, total = sim.u32(IRQ.DEBUG + totalOff);
    if (total - since > IRQ.RING_SLOTS) throw new Error(`capture: ${total - since} ring entries since the last stop overflow the ring`);
    const rows = [];
    for (let n = since; n < total; n++) {
      const b = sim.read(IRQ.DEBUG + base + 16 * (n % IRQ.RING_SLOTS), 16);
      rows.push([u32(b, 0), u32(b, 4), u32(b, 8), u32(b, 12)]);
    }
    return [total, rows];
  }
  _irq_rows() {
    let pres, acc;
    [this.presented_seen, pres] = this._ring(IRQ.D_PRESENTED_TOTAL, IRQ.D_PRESENTED_RING, this.presented_seen);
    [this.accepted_seen, acc] = this._ring(IRQ.D_ACCEPTED_TOTAL, IRQ.D_ACCEPTED_RING, this.accepted_seen);
    if (pres.length || acc.length) this.events.push(['irq', pres, acc.map(([lv, pc, lo, hi]) => [lv, pc, lo + hi * 4294967296])]);
  }
  on_stub(name) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e[0] === 'stop') { if (e[3] === null) e[3] = name; break; }
    }
    this.quiet = BASE_STUBS.has(name);
  }
  // ---- summaries
  devices() {
    const sim = this.sim, d = (o) => sim.u32(IRQ.DEBUG + o);
    const gate = sim.read(IRQ.DEBUG + IRQ.D_GATE_MODE, 8);
    return {
      t: this._time(),
      intc: { presented: d(IRQ.D_PRESENTED_TOTAL), accepted: d(IRQ.D_ACCEPTED_TOTAL), errors: d(IRQ.D_ERR_TOTAL),
        level_mask: d(IRQ.D_LEVEL_MASK), gate: [u32(gate, 0), u32(gate, 4)] },
      timer: { ie: sim.u32(IRQ.TIMER_DEBUG + IRQ.T_IE), errors: sim.u32(IRQ.TIMER_DEBUG + IRQ.T_ERR_TOTAL),
        ch1: new IRQ.TimerDebug(sim).channel(1) },
      engine: Object.fromEntries(ENGINE_FIELDS.map(([k, off]) => [k, sim.u32(OSD_DEBUG + off)])),
      ...(this.fmt3 ? { vsc: vscSummary(sim), stub: { log_total: sim.u32(STUB_WINDOW + 8), denied: sim.u32(STUB_WINDOW + 12) } } : {}),
      ...(this.fmt4 ? { ipi: this.ipiSummary() } : {}),
    };
  }
  // The IPI summary (format /4): pending bits per bank, the xcpu ring total, repeats, +0x810 writes, the last
  // doorbell result, and the xcpu ring rows new since the previous summary.
  ipiSummary() {
    const sim = this.sim, d = (o) => sim.u32(IRQ.DEBUG + o), total = d(IRQ.D_XCPU_TOTAL);
    if (total - this.xcpu_seen > IRQ.RING_SLOTS) throw new Error(`capture: ${total - this.xcpu_seen} xcpu ring rows since the last summary overflow the ring`);
    const xcpu = [];
    for (let n = this.xcpu_seen; n < total; n++) {
      const b = sim.read(IRQ.DEBUG + IRQ.D_XCPU_RING + 16 * (n % IRQ.RING_SLOTS), 16);
      xcpu.push([u32(b, 0), u32(b, 4), u32(b, 8), u32(b, 12)]);
    }
    this.xcpu_seen = total;
    const p = sim.read(IRQ.DEBUG + IRQ.D_PENDING, 16);
    return { pending: [u32(p, 0), u32(p, 4), u32(p, 8), u32(p, 12)], xcpu_total: total, repeats: d(IRQ.D_IPI_REPEATS),
      writes: d(IRQ.D_IPI_WRITES), doorbell_result: d(IRQ.D_DOORBELL_RESULT), xcpu };
  }
  planes() {
    if (this.lab === null || !this.lab.surfaces) return null;
    return this.lab.surfaces.map((s) => this.sha(this.sim.m.dbgRead(s.base, s.stride * s.height)));
  }
  finish(hle, stats) {
    let last = null;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i][0] === 'stop') { last = this.events[i][4]; break; }
    const log = new TextEncoder().encode(hle.log.join('\n'));
    const names = this.events.filter((e) => e[0] === 'stop' && e[3] !== null).map((e) => e[3]);
    if (hle.log.length && names.slice(names.length - hle.log.length).join('\n') !== hle.log.join('\n')) {
      throw new Error(`capture ${this.name}: traced hook names do not end with hle.log`);
    }
    this.final = { regs: last, stats: statsDict(stats), log_len: hle.log.length, log_sha: this.sha(log),
      harness_sha: this.hex() };
  }
  finishDevices() {
    this.final_devices = this.devices();
    this.final_planes = this.planes();
    this.stub_hits = this.hle.stub_hits ? this.hle.stub_hits.entries().map(([k, v]) => [...k, v]) : [];
    if (this.fmt4) this.final_lab = labDigest(this.hle, (b) => this.sha(b));
  }
}
// The lab digest (format /4 final.lab): DisplayLab.steps and notes as they stand at the end (after any trim()).
export function labDigest(lab, sha) {
  if (!Array.isArray(lab.steps) || !Array.isArray(lab.notes)) return null;
  const enc = new TextEncoder();
  return { steps_len: lab.steps.length, notes_len: lab.notes.length,
    steps_tail_sha: sha(enc.encode(canonJson(normOut(lab.steps, sha)))), notes_tail_sha: sha(enc.encode(canonJson(normOut(lab.notes, sha)))) };
}

const wordsBytes = (words) => { const b = new Uint8Array(4 * words.length); new Uint32Array(b.buffer).set(words); return b; };
// The VSC summary: the VSC debug window's counters and per-channel clock state (format /3 devices summaries).
function vscSummary(sim) {
  const b = sim.read(VSC_DEBUG, 48), w = (i) => u32(b, 4 * i);
  const channels = [];
  for (let c = 0; c < 3; c++) {
    const x = sim.read(VSC_DEBUG + 0x40 + 0x40 * c, 44), y = (i) => u32(x, 4 * i);
    channels.push({ running: y(0), frames: y(1), field: y(2), irq: y(4), len: y(8), latched: y(9), compose: y(10) });
  }
  return { t: w(4) + w(5) * 4294967296, commands: w(10), last_cmd: w(6), last_result: w(7), err_total: w(2), note_total: w(3), channels };
}
// The inventory: every stop's hook name counted (sorted by name), and the lab's stand-in counters sorted.
export function inventory(tr) {
  const names = new Map();
  for (const e of tr.events) if (e[0] === 'stop' && e[3] !== null) names.set(e[3], (names.get(e[3]) ?? 0) + 1);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const hooks = {};
  for (const k of [...names.keys()].sort(cmp)) hooks[k] = names.get(k);
  const stub_hits = [...(tr.stub_hits ?? [])].sort((a, b) => { for (let i = 0; i < a.length; i++) { const c = cmp(a[i], b[i]); if (c) return c; } return 0; });
  return { hooks, stub_hits };
}
export function logical(events) {
  const seq = [], pres = [], acc = [];
  for (const e of events) {
    if (e[0] === 'stop') seq.push(['stop', e[1], ...e.slice(3)]);
    else if (e[0] === 'irq') { pres.push(...e[1]); acc.push(...e[2]); }
    else seq.push(e);
  }
  return [seq, pres, acc];
}
export function dump(tr, createHash, extra) {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const stops = tr.events.filter((e) => e[0] === 'stop');
  const kinds = { c: 0, s: 0, b: 0 };
  for (const e of stops) kinds[e[2]]++;
  const fmt3 = tr.fmt3, n = (kind) => tr.events.filter((e) => e[0] === kind).length;
  return {
    format: tr.fmt, scenario: tr.name, source: extra.source, rc: extra.rc, env: extra.env,
    counts: { events: tr.events.length, stops: stops.length, kinds, hooks: stops.filter((e) => e[3]).length,
      frames: n('frame'), checks: n('check'),
      ...(fmt3 ? { composes: n('compose') } : {}), ...(tr.fmt4 ? { dsteps: n('dstep'), dnotes: n('dnote') } : {}) },
    digests: { full: sha(JSON.stringify(tr.events)), logical: sha(JSON.stringify(logical(tr.events))) },
    final: { ...tr.final, devices: tr.final_devices, planes: tr.final_planes, ...(tr.fmt4 ? { lab: tr.final_lab } : {}) },
    stdout: extra.stdout ?? [], ...(fmt3 ? { inventory: inventory(tr) } : {}), events: tr.events,
  };
}
export { bytesHex };
