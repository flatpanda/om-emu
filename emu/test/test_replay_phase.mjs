// Firmware-free unit tests for Player phase transitions during --replay (including across a power cycle,
// ending powered off, and failing with a LabError) and Play.init's startupReady wait predicate.
//   node emu/test/test_replay_phase.mjs
import { Player } from '../src/lab/player.mjs';
import { startupReady } from '../checks/lib/playhttp.mjs';

function makeSession() {
  const lab = {
    t: 0,
    lab_time() { return this.t; },
    harvest() {},
    exec_history: [],
    steps: [],
    events: [],
    stderr_tail() { return ''; },
  };
  return {
    lab,
    device: 'tft',
    a15_frames: 0,
    status() { return {}; },
    close() {},
    gate_open() { return true; },
    pending_touch() { return false; },
    next_boundary() { return null; },
    positions() { return { mode_dial: 0 }; },
    power_arm() {},
    bit_of() { return 1; },
    switch_input(id, val) { return { kind: 'switch', token: `${id}:${val}`, state: {} }; },
    power_down() { return null; },
    trim() {},
    key(id, act) { return { kind: 'key', token: `${id}:${act}`, state: {} }; },
    scene_key() { return null; },
    wait_until(t) { lab.t = t; },
  };
}

class FakePlayer extends Player {
  constructor(a, env) {
    super(a, env);
    this.opens = 0;
  }
  open_session() {
    this.set_phase('starting');
    this.opens += 1;
    this.off_positions = null;
    this.session = makeSession();
    this.down.clear();
    this.touch_last = null;
    this.anchor();
    this.set_phase('running');
  }
}

function runReplayCase(inputs) {
  const published = [];
  const a = {
    idle: 'off',
    out: '/tmp',
    tab: '0,0,0',
    start: 'lv',
    touch: 'off',
    us_clock: 'lab',
    compose: 'raw',
    debug_api: false,
    replay: 'session.json',
  };
  const env = {
    wallClock: () => 0,
    readReplay: () => JSON.stringify({ inputs }),
    onStatus: (doc) => published.push({ phase: doc.phase, replaying: doc.replaying, error: doc.error }),
  };
  const pl = new FakePlayer(a, env);
  pl.enqueue({ type: 'control', op: 'quit', seq: 0, t_wall: 0 });
  pl.run();
  return { pl, published };
}

export function replayPhaseTests() {
  const bad = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) bad.push(msg); };

  // 1. Replay across a power cycle (power key off -> control power on):
  //    must never publish phase 'off' or satisfy startupReady while replaying,
  //    and must settle to 'running' with replaying unset once replay ends.
  {
    const { pl, published } = runReplayCase([
      { input: { type: 'key', id: 'power', action: 'down' } },
      { input: { type: 'control', op: 'power', value: 1 } },
    ]);
    const duringReplay = published.filter((s) => s.replaying);
    const readyAt = published.findIndex((s) => startupReady(s));
    ok(pl.opens === 2, `power cycle replay opened 2 sessions, got ${pl.opens}`);
    ok(duringReplay.length >= 4, `power cycle replay published statuses while replaying (${duringReplay.length})`);
    ok(duringReplay.every((s) => s.phase !== 'off'),
      `power cycle replay never published phase 'off' during replay: ${JSON.stringify(duringReplay.map((s) => s.phase))}`);
    ok(duringReplay.every((s) => !startupReady(s)),
      `startupReady stayed false for every status published during replay`);
    ok(readyAt >= 0 && published[readyAt].phase === 'running' && published[readyAt].replaying === undefined,
      `first startupReady status settled to running without replaying: ${JSON.stringify(published[readyAt])}`);
    ok(pl.phase === 'running' && pl.replaying === false,
      `final player state after power cycle replay: phase=${pl.phase} replaying=${pl.replaying}`);
  }

  // 2. Replay across a power cycle via control power off -> restart:
  {
    const { pl, published } = runReplayCase([
      { input: { type: 'control', op: 'power', value: 0 } },
      { input: { type: 'control', op: 'restart' } },
    ]);
    const duringReplay = published.filter((s) => s.replaying);
    ok(pl.opens === 2, `control power-off/restart replay opened 2 sessions, got ${pl.opens}`);
    ok(duringReplay.every((s) => s.phase !== 'off' && !startupReady(s)),
      `control power-off/restart replay never published 'off' or became ready mid-replay: ${JSON.stringify(duringReplay)}`);
    ok(pl.phase === 'running' && pl.status_doc.replaying === undefined,
      `control power-off/restart replay settled to running: phase=${pl.phase}`);
  }

  // 3. Replay that genuinely ends powered off:
  //    stays in 'replaying' during the replay, then settles to 'off' once replay finishes.
  {
    const { pl, published } = runReplayCase([
      { input: { type: 'key', id: 'power', action: 'down' } },
    ]);
    const duringReplay = published.filter((s) => s.replaying);
    const readyAt = published.findIndex((s) => startupReady(s));
    ok(pl.opens === 1, `ending-off replay opened 1 session, got ${pl.opens}`);
    ok(duringReplay.every((s) => s.phase !== 'off' && !startupReady(s)),
      `ending-off replay never published 'off' while replaying: ${JSON.stringify(duringReplay)}`);
    ok(readyAt >= 0 && published[readyAt].phase === 'off' && published[readyAt].replaying === undefined,
      `ending-off replay settled to 'off' after replay finished: ${JSON.stringify(published[readyAt])}`);
    ok(pl.phase === 'off' && pl.replaying === false,
      `final player state after ending-off replay: phase=${pl.phase} replaying=${pl.replaying}`);
  }

  // 4. Replay that fails with a LabError (non-control input while powered off):
  //    settles to 'error' (not overwritten with 'off' or 'running') with replaying cleared.
  {
    const { pl, published } = runReplayCase([
      { input: { type: 'key', id: 'power', action: 'down' } },
      { idx: 2, input: { type: 'key', id: 'ok', action: 'down' } },
    ]);
    const readyAt = published.findIndex((s) => startupReady(s));
    ok(readyAt >= 0 && published[readyAt].phase === 'error' && published[readyAt].replaying === undefined,
      `failing replay settled to 'error' without replaying: ${JSON.stringify(published[readyAt])}`);
    ok(pl.phase === 'error' && pl.error !== null && pl.replaying === false,
      `final player state after failing replay: phase=${pl.phase} replaying=${pl.replaying}`);
  }

  // 5. Direct unit checks on playhttp.mjs startupReady predicate:
  {
    ok(!startupReady({ phase: 'starting' }), 'startupReady rejects starting');
    ok(!startupReady({ phase: 'replaying' }), 'startupReady rejects replaying');
    ok(!startupReady({ phase: 'off', replaying: true }), 'startupReady rejects transient off while replaying');
    ok(!startupReady({ phase: 'running', replaying: true }), 'startupReady rejects running while replaying');
    ok(!startupReady({ phase: 'error', replaying: true }), 'startupReady rejects error while replaying');
    ok(startupReady({ phase: 'running' }), 'startupReady accepts running');
    ok(startupReady({ phase: 'off' }), 'startupReady accepts settled off');
    ok(startupReady({ phase: 'error' }), 'startupReady accepts settled error');
    ok(startupReady({ phase: 'stopped' }), 'startupReady accepts stopped');
  }

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = replayPhaseTests();
  console.log(`replay_phase: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
