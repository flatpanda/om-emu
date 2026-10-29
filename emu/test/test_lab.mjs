// Unit tests of the harness: the session replayer's argument binding (refusing calls that do not bind), the Player
// ctor's strict keys and refusals, PlaySession's defaults, the canonical JSON of final.lab, and PlaySession.trim on an
// idling session (trimTests).
//   node emu/test/test_lab.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as P from '../src/lab/play.mjs';
import { canonJson } from '../src/util/tracejson.mjs';
import { replay, CALLS1_FORMAT } from '../scenarios/session_replay.mjs';
import * as SR from '../scenarios/session_replay.mjs';
import { labEnv, loadBlock } from '../checks/lib/env.mjs';
import { bind, MISSING } from '../scenarios/bind.mjs';
import * as PL from '../src/lab/player.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');

export function labTests() {
  const bad = [];
  let checks = 0;
  const eq = (label, got, want) => {
    checks++;
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: ${JSON.stringify(got).slice(0, 300)} != ${JSON.stringify(want).slice(0, 300)}`);
  };
  const image = new Uint8Array(fs.readFileSync(IMAGE));
  replayBinding(image, eq);
  stage2Binding(image, eq);
  // the canonical JSON of final.lab: keys sorted by code point, no spaces, non-ASCII kept
  eq('canonJson', canonJson({ b: [1, { z: 1, a: '\u00e9\n' }], a: null, '\u{1F600}': 1, '\uffff': 2 }), '{"a":null,"b":[1,{"a":"\u00e9\\n","z":1}],"\uffff":2,"\u{1F600}":1}');
  return { checks, bad };
}

// Checks of the Player-boundary replayer and the Player where they refuse: the ctor's namespace keys and placeholders
// are bound strictly, unknown actions and a check.workload not followed by close_session are refused, a mutant is
// Unported, and run() with nothing queued throws instead of spinning.
function stage2Binding(image, eq) {
  const env = { rom: image, createHash, currentSession: () => null, beginSession: () => { throw new Error('no lab in this check'); } };
  const kw = { ...SR.PLAYER_PARSER, out: '<out>', no_wait_on_error: true };
  const run = (actions) => {
    try { replay(env, { format: SR.CALLS2_FORMAT, scenario: 't', labs: [], actions }); return 'returned'; } catch (e) { return `${e.constructor.name}: ${e.message.split('\n')[0]}`; }
  };
  const ctor = (k) => [0, 'ctor', 'Player', [], k, { ret: null }];
  const { lang, ...noLang } = kw;
  eq('stage2 replay: ctor key missing', run([ctor(noLang)]), 'Divergence: Player ctor: keys missing ["lang"], unknown []');
  eq('stage2 replay: ctor key unknown', run([ctor({ ...kw, bogus: 'x' })]), 'Divergence: Player ctor: keys missing [], unknown ["bogus"]');
  eq('stage2 replay: ctor out not the placeholder', run([ctor({ ...kw, out: '/tmp/x' })]), 'Divergence: Player ctor: out "/tmp/x", want <out>');
  eq('stage2 replay: replay with no file action', run([ctor({ ...kw, replay: '<replay>' })]), 'Divergence: Player ctor: replay "<replay>" with no file action before it');
  // The play mutants are implemented (no Unported at the ctor); a mutant reaches the Player and its session's opts
  {
    const pl = new PL.Player({ ...kw, x_mutant: 'no-dispq', out: '<out>' }, { wallClock: () => 0 });
    eq('stage2 replay: a mutant reaches the Player', [pl.opts().mutant, pl.stand_ins_in_use().includes('S-DISPQ'), pl.stand_ins_in_use().includes('H-AEINIT')], ['no-dispq', false, true]);
  }
  let ctorWant = null;
  try { replay(env, { format: SR.CALLS2_FORMAT, scenario: 't', labs: [], actions: [[0, 'ctor', 'Player', [], kw, null]] }); } catch (e) { ctorWant = e.got; }
  eq('stage2 replay: unknown Player method', run([[0, 'ctor', 'Player', [], kw, ctorWant], [1, 'player', 'pace_step', [], {}, null]]), 'Divergence: t action 1: no Player adapter for pace_step');
  eq('stage2 replay: unknown action', run([[0, 'lab', 'x', [], {}, null]]), 'Divergence: t action 0: unknown action lab.x');
  eq('stage2 replay: check.workload before another action', run([[0, 'check', 'workload', [], {}, null], [1, 'player', 'tick', [], {}, null]]), 'Divergence: t action 0: check.workload not followed by close_session');
  const pl = new PL.Player({ ...kw }, env);
  pl.open_session = () => {};
  let got;
  try { pl.run(); got = 'returned'; } catch (e) { got = e.message; }
  eq('Player.run with nothing queued', got, 'Player.run: no input queued and not stopping (headless)');
  eq('Player.submit of a list', (() => { try { pl.submit([1]); return 'returned'; } catch (e) { return `${e.name}: ${e.message}`; } })(), 'ValueError: an input is a JSON object, not array');
}

// More checks where the replayer refuses: a call's arguments that do not bind, and PlaySession's defaults, which keep
// an explicit null.
function replayBinding(image, eq) {
  const env = { rom: image, createHash, currentSession: () => null };
  const run = (actions) => {
    try { replay(env, { format: CALLS1_FORMAT, actions }); return 'returned'; } catch (e) { return `${e.name === 'Unported' ? 'Unported' : 'Error'}: ${e.message}`; }
  };
  const ctor = (cls, args, kwargs) => run([[0, 'ctor', cls, args, kwargs, { ret: null }]]);
  const call = (target, method, args, kwargs) => run([[0, target, method, args, kwargs, { ret: null }]]);
  eq('replay PlaySession(opts) positional', ctor('PlaySession', [{ mutant: 'x' }], {}), ctor('PlaySession', [], { opts: { mutant: 'x' } }));
  // (the mutant no longer throws, so the binding itself is checked: the positional is opts)
  eq('replay PlaySession(opts) positional is the opts', bind('PlaySession', ['opts'], [{ mutant: 'x' }], {}, { keywords: ['opts'], defaults: { opts: MISSING } }).opts, { mutant: 'x' });
  const te = (label, got, re) => eq(label, re.test(got) ? 'binding refusal' : got, 'binding refusal');
  te('replay PlaySession 2 positionals', ctor('PlaySession', [{}, 1], {}), /PlaySession\(\) takes 1 positional arguments but 2 were given$/);
  te('replay PlaySession unknown keyword', ctor('PlaySession', [], { bogus: 1 }), /unexpected keyword argument 'bogus'/);
  te('replay PlaySession opts twice', ctor('PlaySession', [{}], { opts: {} }), /multiple values for argument 'opts'/);
  te('replay NavSession 16 positionals', ctor('NavSession', Array(16).fill(null), {}), /NavSession\(\) takes 15 positional arguments but 16 were given/);
  te('replay frame 3 positionals', call('session', 'frame', [1, 2, 3], {}), /session\.frame\(\) takes 2 positional arguments but 3 were given/);
  te('replay key missing action', call('session', 'key', ['menu'], {}), /session\.key\(\) missing required argument 'action'/);
  te('replay step unknown keyword', call('nav', 'step', [], { tok: 'OK' }), /unexpected keyword argument 'tok'/);
  te('replay compose device twice', call('lab', 'compose', ['tft'], { device: 'evf' }), /multiple values for argument 'device'/);
  const ps = new P.PlaySession(env, { time: null, open_menu: null, png: null });
  eq('PlaySession defaults keep null', [ps.time, ps.open_menu, ps.png], [null, null, null]);
  const pd = new P.PlaySession(env, {});
  eq('PlaySession defaults', [pd.time, pd.open_menu, pd.png], [true, false, 'none']);
}

// PlaySession.trim bounds the harness logs of a long session (the browser player runs for hours). On a session at the
// shooting screen: every array, Map or Set of the session, its lab, kernel, lab task and interrupt controller that
// grows while the session idles must be one trim() cuts (trim_lists); and a trim that cuts the controller's log must
// not lose the native deliveries presented after it (Kernel._native_seen indexes that log).
export function trimTests() {
  const bad = [];
  let checks = 0;
  const s = new P.PlaySession(labEnv({ resBlock: loadBlock() }), { opts: { start: 'shooting', touch: 'off', us_clock: 'lab', bgdraw: true },
    lang: 'en', device: 'tft', start: [7, 1, 1], out: null, tag: 'play', png: 'none' });
  s.enter();
  try {
    const lab = s.lab, idle = (n) => { for (let i = 0; i < n; i++) { s.idle_slice(lab.lab_time() + 50000000); s.frame(); } };
    const owners = { session: s, lab, kernel: lab.kernel, lt: lab.lt, intc: lab.nk.intc };
    const sizes = () => {
      const m = new Map();
      for (const [on, o] of Object.entries(owners)) {
        if (o === null) continue;
        for (const k of Object.keys(o)) { const v = o[k]; if (Array.isArray(v)) m.set(`${on}.${k}`, v.length); else if (v instanceof Map || v instanceof Set) m.set(`${on}.${k}`, v.size); }
      }
      return m;
    };
    const name = (obj) => Object.entries(owners).find(([, o]) => o === obj)?.[0];
    const listed = new Set(s.trim_lists().map(([obj, n]) => `${name(obj)}.${n}`));
    idle(20);                  // past the start's one-off records (S-DISPQ's one idle request, from about 2 s on)
    const a = sizes();
    idle(20);
    checks++;
    // bounded caches, not logs: the call-frame analyses per function, the names of the opt-in assumptions in use; and
    // not the harness's: S-HEAP's blocks are the guest heap's, which grows by about 5 blocks a second on the idle
    // shooting screen with either lens (the events S-TRAACK keeps, docs/hle-gaps.md 4.4.2) up to its area's end
    const bounded = new Set(['lab.frames', 'lab.assumptions_in_use', 'lab.heap_sizes', 'lab.heap_free']);
    const grows = [...sizes()].filter(([k, n]) => n > (a.get(k) ?? 0) && !listed.has(k) && !bounded.has(k)).map(([k, n]) => `${k} ${a.get(k) ?? 0} -> ${n}`);
    if (grows.length) bad.push(`trim: grows while idling and trim() does not cut it: ${grows.join(', ')}`);
    const intc = lab.nk.intc;
    checks++;
    if (intc === null || intc.log.length <= 50) bad.push(`trim: the controller log has ${intc?.log.length} entries, the check needs more than 50`);
    else {
      idle(3);                                     // presentations nobody has read through kernel.delivered yet
      const unread = intc.sync().slice(lab.kernel._native_seen).slice(-50);
      s.trim(50);
      const got = lab.kernel.delivered.slice(-unread.length);
      checks++;
      if (!unread.length || JSON.stringify(got) !== JSON.stringify(unread)) bad.push(`trim: the ${unread.length} native presentations unread at the trim are not the last deliveries after it (${JSON.stringify(got.slice(-8))} != ${JSON.stringify(unread.slice(-8))})`);
    }
  } finally { s.close(); }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = labTests(), tt = trimTests();
  console.log(`replayer binding and Player refusals: ${r.checks - r.bad.length}/${r.checks}; PlaySession.trim: ${tt.checks - tt.bad.length}/${tt.checks}`);
  [...r.bad.slice(0, 20), ...tt.bad].forEach((b) => console.log('  ', b));
  process.exit(r.bad.length || tt.bad.length ? 1 : 0);
}
