// The gate runner of the browser player, Worker-safe (no node APIs): bin/run.mjs's runScenarios for the kernel
// sessions and the replayed scenarios (Stage 1, 2 and 3 calls files), and check_perf's play workload as
// bin/playperf.mjs runs it (no calls file). bin/webgate.mjs runs it twice on the same inputs, in node and in a headless
// Chrome Worker, both with env.createHash = src/util/sha256.mjs, and requires byte-identical trace documents (gate B5),
// identical to bin/run.mjs's too (B2, B5). Nothing here reads files: the image, the resource
// block (or its prefix) and the calls documents are passed in.
import { Session, dump } from '../src/trace/tracer.mjs';
import * as K from '../scenarios/kernel.mjs';
import * as S1 from '../scenarios/session_replay.mjs';
import { replay as osdReplay } from '../scenarios/osd_replay.mjs';
import { Player } from '../src/lab/player.mjs';

export const TRACE_ENV = { emu: true, runner: 'emu/web/runner.mjs' };
const SOURCES = { kernel: 'emu/scenarios/kernel.mjs main()', osd: 'emu/scenarios/osd_replay.mjs', replay: 'emu/scenarios/session_replay.mjs' };

// One scenario: {sessions: [{name, rc, stats, trace (the dump's JSON text, as run.mjs --trace writes it)}], wall_ms}.
// env: {rom, resBlock, createHash, slice?, onSlice?}; calls: the scenario's calls document (null for a kernel session).
export function runScenario(name, env, calls = null) {
  const sessions = [], stdout = [];
  let pending = name, current = null;
  const createHash = env.createHash;
  const lenv = {
    rom: env.rom, createHash, ...(env.slice ? { slice: env.slice } : {}), ...(env.onSlice ? { onSlice: env.onSlice } : {}),
    sessionName(n) { pending = n; },
    currentSession() { return current; },
    beginSession() {
      const n = Array.isArray(pending) ? pending.shift() : pending;
      if (n === undefined) throw new Error('runner: a lab beyond the names given for the scenario');
      current = new Session(n, createHash, true);
      sessions.push(current);
      return current;
    },
    mark(label) { if (current.tracer) current.tracer.events.push(['mark', label, { devices: current.tracer.devices() }]); },
    check(group, label, got, want, ok) { if (current.tracer) current.tracer.events.push(['check', group, label, got, want, ok]); },
    print(line) { stdout.push(line); },
  };
  const t0 = performance.now();
  let rc, source;
  if (K.SESSIONS.includes(name)) { rc = K.main(lenv, [name]); source = SOURCES.kernel; }
  else if (name === 'osd') { lenv.sessionName('osd'); rc = osdReplay(lenv, calls); source = SOURCES.osd; }
  else {
    if (!calls) throw new Error(`runner: ${name} needs its calls document`);
    lenv.resBlock = env.resBlock;
    lenv.sessionName(calls.format === S1.CALLS2_FORMAT ? [name, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${name}#${k}`)] : name);
    rc = S1.replay(lenv, calls);
    source = SOURCES.replay;
  }
  const wall_ms = performance.now() - t0;
  return { wall_ms, sessions: sessions.map((s) => {
    const st = s.hle.sim.m.stats;
    return { name: s.name, rc, stats: { insns: st.insns, guestMs: st.guestMs, engineMs: st.engineMs, composeMs: st.composeMs, conts: st.conts, steps: st.steps },
      trace: JSON.stringify(dump(s.tracer, createHash, { source, rc, env: TRACE_ENV, stdout })) };
  }) };
}

// check_perf's play workload (bin/playperf.mjs playWorkload without its node parts): phases, startup and the digest.
export const PLAY_SCRIPT = [['shoot 3 s lab', 'idle', 3000], ['MENU open', 'key', 'menu'], ['menu 2 s lab', 'idle', 2000],
  ['MENU close', 'key', 'menu'], ['OK -> SCP', 'key', 'ok'], ['SCP 2 s lab', 'idle', 2000], ['MENU close', 'key', 'menu']];
export function playWorkload(env, script = PLAY_SCRIPT) {
  const wall = () => performance.now() / 1000;
  const a = { ...S1.PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'auto', out: '<out>', no_wait_on_error: true };
  const pl = new Player(a, { rom: env.rom, resBlock: env.resBlock, createHash: env.createHash, ...(env.slice ? { slice: env.slice } : {}), wallClock: wall });
  const res = { phases: [], frames: [] };
  const t0 = performance.now();
  pl.open_session();
  res.startup = Math.round(performance.now() - t0) / 1000;
  const s = pl.session, st = () => s.lab.sim.m.stats;
  const published = () => res.frames.push(pl.frame ? pl.frame[3] : null);
  let seq = 0;
  try {
    for (const [name, kind, arg] of script) {
      const w0 = performance.now(), l0 = s.lab.lab_time(), i0 = st().insns;
      if (kind === 'idle') {
        for (let k = 0; k < Math.floor(arg / 50); k++) {
          const m = pl.marks();
          s.idle_slice(s.lab.lab_time() + 50000000);
          pl.after_lab_time(m);
          published();
        }
      } else {
        for (const action of ['down', 'up']) {
          seq += 1;
          pl.apply({ type: 'key', id: arg, action, seq, t_wall: wall() });
          if (pl.error) throw new Error(`play workload: ${JSON.stringify(pl.error).slice(0, 2000)}`);
          published();
        }
      }
      res.phases.push({ name, wall: Math.round(performance.now() - w0) / 1000, lab_ns: s.lab.lab_time() - l0, insns: st().insns - i0 });
    }
    const lab = s.lab;
    res.digest = S1.workloadDigest(res.frames, lab, (t) => env.createHash('sha256').update(t).digest('hex'));
    res.lab_ns = lab.lab_time();
    res.hook_log = lab.log.length;
    res.phase_sum = Math.round(res.phases.reduce((x, p) => x + p.wall * 1000, 0)) / 1000;
  } finally {
    pl.close_session();
  }
  res.frames = res.frames.length;
  return res;
}
