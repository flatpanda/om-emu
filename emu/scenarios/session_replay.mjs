// The Stage 1 and Stage 2 scenarios replayed at the session boundary from their inputs (emu/scenarios/calls/
// <scenario>.calls.json: the calls each session made, recorded on 2026-10-13, without the outcomes
// recorded with them). Stage 1 (format om-emu-session-inputs/1): every call into the session objects (PlaySession,
// NavSession, DisplayLab.compose, check_irq I4's MenuLab) is made on the JS session with the same arguments, and its
// outcome is normalised as the recording wrote it (the step records of __enter__, frame's [w, h, {sha256, len}],
// idle_slice's idle log, key / step records, compose's result with the pixels as {sha256, len}); each outcome's digest
// goes to env.replayStats.outcomes (bind.mjs outcomeSeen), where golden's output layer keeps it. Stage 2 (format
// om-emu-player-inputs/1, below): the calls at the Player boundary, each outcome with the Player's state after the
// call. Before every call after the lab exists, the trace gets the call's mark (devices summary and GUI state).
import { PlaySession } from '../src/lab/play.mjs';
import { Player } from '../src/lab/player.mjs';
import { NavSession } from '../src/lab/nav.mjs';
import { MenuLab } from '../src/lab/menu.mjs';
import { LabError, KeyError, AssertionError, ValueError, RuntimeError, FirmwareError } from '../src/lab/errors.mjs';
import { hexBytes } from '../src/util/bytes.mjs';
import { normOut as out, spacedJson, sortMembers, setKey } from '../src/util/tracejson.mjs';
import { bind, MISSING, outcomeSeen } from './bind.mjs';

export class Divergence extends Error {}
export const CALLS1_FORMAT = 'om-emu-session-inputs/1';

function dec(v) {
  if (Array.isArray(v)) return v.map(dec);
  if (v !== null && typeof v === 'object') {
    if ('$bytes' in v) return hexBytes(v.$bytes);
    if ('$tuple' in v) return v.$tuple.map(dec);
    const o = {};
    for (const [k, x] of Object.entries(v)) setKey(o, k, dec(x));
    return o;
  }
  return v;
}
const NAV_PARAMS = ['lang', 'device', 'u1', 'start', 'seed', 'open_menu', 'image', 'out', 'png', 'tag', 'store_first',
  'evf_layout', 'b2_options', 'a15', 'time'];
// The signatures (positional order, defaults) of the methods the drivers call.
const sig = (params, defaults, call) => ({ params, defaults, call });
const CALL = {
  'session.__enter__': sig([], {}, (o) => o.enter()),
  'nav.__enter__': sig([], {}, (o) => o.enter()),
  'session.frame': sig(['policy', 'raw'], { policy: 'boundary', raw: false }, (o, k) => o.frame(k.policy, k.raw)),
  'session.idle_slice': sig(['target'], {}, (o, k) => o.idle_slice(k.target)),
  'session.key': sig(['cid', 'action'], {}, (o, k) => o.key(k.cid, k.action)),
  // the lab's stand-in for the camera application's requests is gone: a request raises ValueError (its outcome)
  'session.request': sig(['index', 'data', 'tag'], { data: 0, tag: null }, () => { throw new ValueError('request: the camera application sends the GUI its own requests'); }),
  'session.close': sig([], {}, (o) => o.close()),
  'nav.step': sig(['token'], {}, (o, k) => o.step(k.token)),
  'nav.close': sig([], {}, (o) => o.close()),
  'lab.compose': sig(['device', 'next_frame', 'raw'], { next_frame: true, raw: false }, (o, k) => o.lab.compose(k.device, k.next_frame, k.raw)),
  // Stage 3 (menu-open, menu-open-any): check_irq I4's calls into its MenuLab
  'menu.nk.kcb': sig(['offset'], {}, (o, k) => o.nk.kcb(k.offset)),
  'menu.sim.write': sig(['address', 'data'], {}, (o, k) => o.sim.write(k.address, k.data)),
  'menu.sim.read': sig(['address', 'size'], {}, (o, k) => o.sim.read(k.address, k.size)),
  'menu.bring_up': sig(['device'], { device: 'tft' }, (o, k) => o.bring_up(k.device)),
  'menu.intc.set_gate': sig(['mode', 'pc'], { pc: 0 }, (o, k) => o.nk.intc.set_gate(k.mode, k.pc)),
  'menu.intc.accepted': sig(['since'], { since: 0 }, (o, k) => o.nk.intc.accepted(k.since)),
  'menu.intc.sync': sig([], {}, (o) => o.nk.intc.sync()),
  'menu.open_menu': sig([], {}, (o) => o.open_menu()),
  'menu.run_to_frame': sig(['c', 'cause'], {}, (o, k) => o.run_to_frame(k.c, k.cause)),
  'menu.vsc.irq_line': sig(['c'], {}, (o, k) => o.vsc.irq_line(k.c)),
  'menu.settle': sig(['label'], {}, (o, k) => o.settle(k.label)),
  'menu.close': sig([], {}, (o) => o.close()),
};
const MENU_PARAMS = ['image', 'lang', 'inputs', 'seed', 'key_mode', 'trace', 'store', 'store_first', 'evf_layout', 'time'];
// The constructors: PlaySession(opts=None, **kw) passes kw on to NavSession.__init__, whose parameters are NAV_PARAMS
// (no further positionals); NavSession(...) takes NAV_PARAMS positionally or by keyword. Absent parameters stay absent:
// the session classes apply their own defaults (PlaySession's setdefault calls).
const absent = (ps) => Object.fromEntries(ps.map((p) => [p, MISSING]));
const CTOR = {
  PlaySession: (env, a, k) => new PlaySession(env, bind('PlaySession', ['opts'], a, k, { keywords: ['opts', ...NAV_PARAMS], defaults: absent(['opts']) })),
  NavSession: (env, a, k) => new NavSession(env, bind('NavSession', NAV_PARAMS, a, k, { defaults: absent(NAV_PARAMS) })),
  // MenuLab(image, lang, inputs, seed, key_mode, ...) as the calls give it: the options object of the JS class,
  // absent parameters left to its defaults; image and trace are the environment's
  MenuLab: (env, a, k) => {
    const b = bind('MenuLab', MENU_PARAMS, a, k, { defaults: absent(MENU_PARAMS) }), opts = {};
    for (const [n, v] of Object.entries(b)) {
      if (v === MISSING) continue;
      if (['image', 'trace'].includes(n)) throw new Error(`session replay: MenuLab ${n}= is the environment's`);
      opts[n] = v;
    }
    return new MenuLab(env, opts);
  },
};
// The compose outcome: the result without the pixels, then the pixels as {sha256, len}.
function composeOut(c, sha) {
  const pix = c.raw ?? (() => { const b = new Uint8Array(4 * c.words.length); new Uint32Array(b.buffer).set(c.words); return b; })();
  const rest = {};
  for (const [k, v] of Object.entries(c)) if (k !== 'raw' && k !== 'words') rest[k] = v;
  return { ...out(rest, sha), pixels: { sha256: sha(pix), len: pix.length } };
}
const h4 = (v) => '0x' + (v >>> 0).toString(16).padStart(4, '0');

// env: as for scenarios/kernel.mjs plus resBlock and currentSession(). An inputs file the replayer cannot drive (an
// unknown action, a constructor or read it does not know) throws Divergence. env.replayStats.checkMs accumulates the
// replay's own outcome normalisation.
export function replay(env, doc) {
  if (doc.format === CALLS2_FORMAT) return replayStage2(env, doc);
  if (doc.format !== CALLS1_FORMAT) throw new Error(`calls file format ${doc.format}, want ${CALLS1_FORMAT} or ${CALLS2_FORMAT}`);
  const sha = (b) => env.createHash('sha256').update(b).digest('hex');
  const actions = doc.actions;
  doc.decoded ??= actions.map((a) => [dec(a[3]), dec(a[4])]);
  const clock = env.clock ?? (() => performance.now());
  const rs = env.replayStats ?? { checkMs: 0 };
  const tracer = () => env.currentSession?.()?.tracer ?? null;
  let session = null;
  for (let i = 0; i < actions.length; i++) {
    const [seq, target, method] = actions[i];
    const [args, kwargs] = doc.decoded[i];
    if (env.onAction) env.onAction(i, actions[i]);
    const tr = tracer();
    if (tr && tr.sim && target !== 'ctor' && method !== '__enter__') {
      const lab = tr.hle;
      let gui = null;
      if (lab && lab.state_names) {
        const st = lab.state();
        gui = { state: h4(st), name: lab.state_names.get(st) ?? '?', panel: lab.panels?.length ? lab.panels[lab.panels.length - 1][1] : null };
      }
      tr.events.push(['mark', `call ${seq} ${target}.${method}`, { devices: tr.devices(), gui }]);
    }
    let got;
    try {
      let result = null;
      if (target === 'ctor') {
        if (!Object.hasOwn(CTOR, method)) throw new Error(`session replay: no constructor ${method}`);
        session = CTOR[method](env, args, kwargs);
      } else {
        const name = `${target}.${method}`;
        if (!Object.hasOwn(CALL, name)) throw new Error(`session replay: no adapter for ${name}`);
        const { params, defaults, call } = CALL[name];
        result = call(session, bind(name, params, args, kwargs, { defaults }));
      }
      const c0 = clock();
      // stepOut on every outcome but compose's: a step record without its wall 'seconds'
      if (method === '__enter__') got = { ret: session.steps.map((r) => out(stepOut(r), sha)) };
      else if (target === 'menu') got = { ret: out(stepOut(result), sha) };
      else if (method === 'compose') got = { ret: composeOut(result, sha) };
      else got = { ret: out(stepOut(result === session ? null : result), sha) };
      rs.checkMs += clock() - c0;
    } catch (e) {
      if (!(e instanceof LabError)) throw e;
      got = { raise: [e.name, e.message, e.notes] };
    }
    outcomeSeen(env, got);
  }
  return 0;
}
export { KeyError, AssertionError, ValueError, RuntimeError, FirmwareError };

// ---- Stage 2: the Player boundary (format om-emu-player-inputs/1) -----------------------------------------------------
// Each action is [seq, target, method, args, kwargs]: target 'ctor' (Player(a), its namespace as kwargs), 'player' (the
// eight Player methods), 'session' (a driver's own session call: play-perf's idle_slice), and the pseudo-actions
// ['file', 'replay', [log]] (the --replay log), ['check', 'workload'] (check_perf's workload digest, just before the
// top-level close_session; an outcome too) and ['clock', 'set', [t]] (pace-wall: the Player's wall clock is t
// until the next one). A Player outcome is {ret | raise, player}: the Player's state after the call (pstate), wall-clock
// fields removed by path (WALL_PATHS). Before every call after a lab exists (and while it is open), the trace gets the
// call's mark. A later lab of the session is traced as NAME#2, NAME#3, ...; the inputs list the names in `labs`, and a
// replay that opens others throws Divergence.
export const CALLS2_FORMAT = 'om-emu-player-inputs/1';
export const WORKLOAD_DIGEST = '0a8f94603ae67b51';
// The play parser's defaults and the keys the recording adds: the ctor's kwargs must have exactly
// these keys.
export const PLAYER_PARSER = { lang: 'en', device: 'tft', evf_layout: false, a15: 'auto', start: 'shooting', tab: '7,1,1', idle: 'wall',
  touch: 'gui', us_clock: 'lab', no_bgdraw: false, compose: 'boundary', port: 0, no_browser: false, out: null, replay: null,
  debug_api: false, x_mutant: null, x_trim_keep: null };
export const PLAYER_EXTRA_KEYS = ['no_wait_on_error'];
// keys a later option added: a recording made before it lacks them, and the Player takes the option's default
export const PLAYER_ADDED_KEYS = ['hdmi'];
export const OUT_PLACEHOLDER = '<out>', REPLAY_PLACEHOLDER = '<replay>';
export const WALL_PATHS = {
  step: [['seconds']],
  player: [['error', 'traceback'], ['status', 'error', 'traceback'], ['status', 'last', 'latency_ms'], ['status', 'last', 'record', 'seconds'],
    ['status', 'pace'], ['status', 'log_tail', '*', 'record', 'seconds'], ['log', '*', 'record', 'seconds'], ['results', '*', 'record', 'seconds'],
    ['touch_last', 't_wall']],
  input: [['t_wall']],
};
// A scenario driven under a frozen clock keeps these wall-derived fields.
export const WALL_EXEMPT = { 'pace-wall': [['status', 'pace'], ['status', 'last', 'latency_ms']] };
export function wallPaths(name) {
  const ex = (WALL_EXEMPT[name] ?? []).map((p) => JSON.stringify(p));
  return WALL_PATHS.player.filter((p) => !ex.includes(JSON.stringify(p)));
}
// A copy of v without the value at each path ('*' is any dict key or list index).
export function stripWall(v, paths) {
  if (!paths.length) return v;
  if (Array.isArray(v)) {
    const sub = paths.filter((p) => p[0] === '*').map((p) => p.slice(1));
    return v.map((x) => stripWall(x, sub));
  }
  if (v !== null && typeof v === 'object') {
    const res = {};
    for (const [k, x] of Object.entries(v)) {
      const sub = paths.filter((p) => p[0] === '*' || p[0] === k).map((p) => p.slice(1));
      if (sub.some((p) => p.length === 0)) continue;
      setKey(res, k, stripWall(x, sub));
    }
    return res;
  }
  return v;
}
// out() for the Player state, strict (an unknown type is an error, not '<type>').
export function pout(v, sha) {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v ?? null;
  if (v instanceof Uint8Array) return out(v, sha);
  if (v instanceof Set) return sortMembers([...v].map((x) => pout(x, sha)));
  if (Array.isArray(v)) return Array.from(v, (x) => pout(x, sha));
  if (v instanceof Map) { const o = {}; for (const [k, x] of v) setKey(o, String(k), pout(x, sha)); return o; }
  if (Object.getPrototypeOf(v) === Object.prototype) { const o = {}; for (const [k, x] of Object.entries(v)) setKey(o, k, pout(x, sha)); return o; }
  throw new TypeError(`capture: Player state value of type ${v.constructor?.name}`);
}
// The Player's observable state after a call (new log entries and results only).
function pstate(pl, sha, paths = WALL_PATHS.player) {
  const seen = pl._rec_seen ??= { log: 0, results: new Set() };
  const newLog = pl.log.length >= seen.log ? pl.log.slice(seen.log) : [...pl.log];
  seen.log = pl.log.length;
  const newRes = [...pl.results].filter(([k]) => !seen.results.has(k));
  for (const [k] of newRes) seen.results.add(k);
  const results = {};
  for (const [k, v] of newRes.sort((a, b) => a[0] - b[0])) results[String(k)] = v;
  const idle_taken = {};
  for (const [k, v] of pl.idle_taken) idle_taken[String(k)] = v;
  const st = { phase: pl.phase, error: pl.error, session: pl.session !== null, frame_seq: pl.frame_seq, frame: pl.frame ? pl.frame.slice(1, 4) : null,
    frame_error: pl.frame_error, input_error: pl.input_error, dropped: pl.dropped.toObject(), down: [...pl.down].sort(), idle_taken,
    slices: pl.slices, log_count: pl.log_count, log: newLog, results, touch_last: pl.touch_last, held: pl.held.length, queued: pl.q.length,
    status_seq: pl.status_seq, status: pl.status_doc };
  const res = stripWall(pout(st, sha), paths);
  res.play = playState(pl, sha);
  return res;
}
// Open item 1 (playState): one entry per PlaySession entered during a call of this Player, in
// entry order (pl._recPlay, filled by env.onPlaySession from Player.open_session): the step records (step_out: without
// 'seconds') and S-CPU2 service records (lab.xcpu_log) appended since the previous Player call, found by the identity of
// the last record reported, and lab.ipi_handler_runs (null without a lab or before S-CPU2 is installed).
function newSince(lst, last, what) {
  if (last === null) return [...lst];
  for (let i = lst.length - 1; i >= 0; i--) if (lst[i] === last) return lst.slice(i + 1);
  throw new Error(`capture: ${what} trimmed past the last reported record`);
}
function playState(pl, sha) {
  const play = [];
  for (const ent of pl._recPlay ?? []) {
    const [sess, lab] = ent;
    const n = newSince(sess.steps, ent[2], 'PlaySession.steps');
    if (n.length) ent[2] = n[n.length - 1];
    const xl = lab !== null ? lab.xcpu_log : undefined;
    const nx = xl !== undefined && xl !== null ? newSince(xl, ent[3], 'xcpu_log') : [];
    if (nx.length) ent[3] = nx[nx.length - 1];
    play.push({ steps: n.map((r) => out(stepOut(r), sha)), xcpu: nx.map((r) => out(r, sha)),
      ipi_runs: lab !== null && lab.ipi_handler_runs !== undefined ? lab.ipi_handler_runs : null });
  }
  return play;
}
function stepOut(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r) || !Object.hasOwn(r, 'seconds')) return r;
  const c = { ...r };
  delete c.seconds;
  return c;
}
// The Player's namespace from the ctor kwargs: exactly build_parser()'s keys plus no_wait_on_error; '<out>'
// stays the placeholder (the JS Player writes no files), '<replay>' needs a file action before it.
// no_camseq: the option of the lab's stand-in for the camera application, gone with it (a recorded value is ignored).
const RETIRED_PLAYER_KEYS = ['no_camseq'];
function playerNamespace(kwargs, replayFile) {
  kwargs = Object.fromEntries(Object.entries(kwargs).filter(([k]) => !RETIRED_PLAYER_KEYS.includes(k)));
  const want = [...Object.keys(PLAYER_PARSER), ...PLAYER_EXTRA_KEYS].sort(), got = Object.keys(kwargs).filter((k) => !PLAYER_ADDED_KEYS.includes(k)).sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) {
    throw new Divergence(`Player ctor: keys missing ${JSON.stringify(want.filter((k) => !got.includes(k)))}, unknown ${JSON.stringify(got.filter((k) => !want.includes(k)))}`);
  }
  const a = { ...PLAYER_PARSER };
  for (const [k, v] of Object.entries(kwargs)) {
    if (k === 'out' && v !== OUT_PLACEHOLDER) throw new Divergence(`Player ctor: out ${JSON.stringify(v)}, want ${OUT_PLACEHOLDER}`);
    if (k === 'replay' && v !== null && (v !== REPLAY_PLACEHOLDER || replayFile === null)) throw new Divergence(`Player ctor: replay ${JSON.stringify(v)} with no file action before it`);
    a[k] = k === 'replay' && v !== null ? 'replay.jsonl' : v;
  }
  return a;
}
// An input argument of apply / submit: its t_wall was recorded as {"$wall": true}; it reads the wall clock again.
function unwall(v, wall) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) setKey(o, k, x !== null && typeof x === 'object' && x.$wall === true && Object.keys(x).length === 1 ? wall() : x);
    return o;
  }
  return v;
}
const PCALL = {
  open_session: sig([], {}, (p) => p.open_session()),
  close_session: sig([], {}, (p) => p.close_session()),
  marks: sig([], {}, (p) => p.marks()),
  after_lab_time: sig(['m', 'force'], { force: false }, (p, k) => p.after_lab_time(k.m, k.force)),
  apply: sig(['inp'], {}, (p, k) => p.apply(k.inp)),
  submit: sig(['inp'], {}, (p, k) => p.submit(k.inp)),
  tick: sig([], {}, (p) => p.tick()),
  run: sig([], {}, (p) => p.run()),
};
// check_perf's play workload digest: the first 16 hex digits of the sha256 of workloadText, the spaced JSON of [frames,
// lab time, hook-log length, GUI state, the last 2,000 hook-log entries] (bin/playperf.mjs, web/runner.mjs too).
export const workloadText = (frames, lab) => spacedJson([frames, lab.lab_time(), lab.log.length, lab.state(), lab.log.slice(-2000).map(String)]);
export const workloadDigest = (frames, lab, sha) => sha(workloadText(frames, lab)).slice(0, 16);
// The WINDOWS token's layers carry 'z', base64 of the window bytes deflated at level 6; zlib builds can give different
// streams for the same bytes, so a 'z' enters the outcome digest as the sha256 of its inflated bytes ('sha' already
// holds the raw bytes' digest).
function normZ(v, env, sha) {
  if (Array.isArray(v)) return v.map((x) => normZ(x, env, sha));
  if (v === null || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'layers' && x !== null && typeof x === 'object' && Object.values(x).every((l) => l && typeof l.z === 'string')) {
      if (!env.inflate) throw new Error('session replay: a WINDOWS token outcome without env.inflate');
      o[k] = Object.fromEntries(Object.entries(x).map(([n, l]) => {
        const bin = atob(l.z), b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return [n, { ...l, z: `inflated sha256 ${sha(env.inflate(b))}` }];
      }));
    } else setKey(o, k, normZ(x, env, sha));
  }
  return o;
}
function replayStage2(env, doc) {
  const sha = (b) => env.createHash('sha256').update(b).digest('hex');
  // the ['clock', 'set', [t]] pseudo-action (pace-wall) freezes the Player's wall clock at t
  let frozen = null;
  const wall0 = env.wallClock ?? (() => performance.now() / 1000), wall = () => (frozen !== null ? frozen : wall0());
  const wpaths = wallPaths(doc.scenario);
  const name = doc.scenario, actions = doc.actions;
  const clock = env.clock ?? (() => performance.now());
  const rs = env.replayStats ?? { checkMs: 0 };
  const created = [];
  const begin0 = env.beginSession;
  env.beginSession = () => { const s = begin0(); created.push(s); return s; };
  let pl = null, replayFile = null, frames = [];
  const penv = { ...env, wallClock: wall, readReplay: (p) => {
    if (p !== 'replay.jsonl' || replayFile === null) throw new Divergence(`Player read ${p}: not the inputs' replay log`);
    return replayFile.map((e) => JSON.stringify(e) + '\n').join('');
  }, onPlaySession: (player, s, lab) => { (player._recPlay ??= []).push([s, lab, null, null]); } };
  try {
    for (let i = 0; i < actions.length; i++) {
      const [seq, target, method, args0, kwargs0] = actions[i];
      if (seq !== i) throw new Divergence(`${name}: action ${i} has seq ${seq}`);
      if (env.onAction) env.onAction(i, actions[i]);
      if (target === 'file' && method === 'replay') {
        if (args0.length !== 1 || !Array.isArray(args0[0])) throw new Divergence(`${name} action ${seq}: file.replay takes the log's entries`);
        replayFile = args0[0];
        continue;
      }
      if (target === 'clock' && method === 'set') {
        if (args0.length !== 1 || typeof args0[0] !== 'number') throw new Divergence(`${name} action ${seq}: clock.set ${JSON.stringify(args0)}`);
        frozen = args0[0];
        continue;
      }
      if (target === 'check' && method === 'workload') {
        const nx = actions[i + 1];
        if (!nx || nx[1] !== 'player' || nx[2] !== 'close_session') throw new Divergence(`${name} action ${seq}: check.workload not followed by close_session`);
        if (pl === null || pl.session === null) throw new Divergence(`${name} action ${seq}: check.workload with no session`);
        const lab = pl.session.lab;
        outcomeSeen(env, { workload: workloadDigest(frames, lab, sha) });
        continue;
      }
      const args = dec(args0).map((x, k) => (target === 'player' && (method === 'apply' || method === 'submit') && k === 0 ? unwall(x, wall) : x));
      const kwargs = dec(kwargs0);
      const cur = env.currentSession?.() ?? null, tr = cur?.tracer ?? null;
      if (tr && tr.sim && tr.final === null && target !== 'ctor' && created.includes(cur)) {
        const lab = tr.hle;
        let gui = null;
        if (lab && lab.state_names) {
          const st = lab.state();
          gui = { state: h4(st), name: lab.state_names.get(st) ?? '?', panel: lab.panels?.length ? lab.panels[lab.panels.length - 1][1] : null };
        }
        tr.events.push(['mark', `call ${seq} ${target}.${method}`, { devices: tr.devices(), gui }]);
      }
      let got;
      if (target === 'ctor') {
        if (method !== 'Player') throw new Divergence(`${name} action ${seq}: no constructor ${method}`);
        try {
          pl = new Player(playerNamespace(kwargs, replayFile), penv);
          got = { ret: null, player: pstate(pl, sha, wpaths) };
        } catch (e) {
          if (!(e instanceof LabError)) throw e;
          got = { raise: [e.name, e.message, e.notes] };
        }
      } else if (target === 'player' || target === 'session') {
        let result = null, raised = null;
        try {
          if (target === 'player') {
            if (!Object.hasOwn(PCALL, method)) throw new Divergence(`${name} action ${seq}: no Player adapter for ${method}`);
            const { params, defaults, call } = PCALL[method];
            result = call(pl, bind(`Player.${method}`, params, args, kwargs, { defaults }));
          } else {
            const nm = `session.${method}`;
            if (!Object.hasOwn(CALL, nm) || method === '__enter__') throw new Divergence(`${name} action ${seq}: no session adapter for ${method}`);
            const { params, defaults, call } = CALL[nm];
            result = call(pl.session, bind(nm, params, args, kwargs, { defaults }));
          }
        } catch (e) {
          if (!(e instanceof LabError)) throw e;
          raised = [e.name, e.message, e.notes];
        }
        const c0 = clock();
        if (target === 'session') got = raised ? { raise: raised } : { ret: out(result, sha) };
        else got = raised ? { raise: raised, player: pstate(pl, sha, wpaths) } : { ret: pout(result, sha), player: pstate(pl, sha, wpaths) };
        rs.checkMs += clock() - c0;
        if (!raised && target === 'player' && (method === 'after_lab_time' || method === 'apply')) frames.push(pl.frame ? pl.frame[3] : null);
      } else throw new Divergence(`${name} action ${seq}: unknown action ${target}.${method}`);
      const c1 = clock();
      const zgot = normZ(got, env, sha);
      rs.checkMs += clock() - c1;
      outcomeSeen(env, zgot);
    }
  } finally {
    env.beginSession = begin0;
  }
  if (pl !== null && pl.session !== null) pl.close_session();
  const labs = created.map((s) => s.name);
  if (JSON.stringify(labs) !== JSON.stringify(doc.labs)) throw new Divergence(`${name}: labs ${JSON.stringify(labs)}, the inputs list ${JSON.stringify(doc.labs)}`);
  return 0;
}
