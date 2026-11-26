// Deterministic, firmware-free unit and regression gates for Player's timing and pacing paths
// (src/lab/player.mjs: BEHIND_NS re-anchor, 20 ms blocking queue wait, --idle wall cadence; docs/ROADMAP.md
// "Ungated timing paths"):
//   1. BEHIND_NS (250 ms) re-anchor: when target - lab > BEHIND_NS, pace_step re-anchors (w_a, l_a), logs the
//      'pacing re-anchored' drop and runs a 1 ms slice from the new anchor; control: when target - lab <= BEHIND_NS
//      (including the exact 250 ms boundary), it does NOT re-anchor and steps in SLICE_NS (50 ms) slices.
//   2. 20 ms queue wait cap: when lab time is ahead of wall time by > 20 ms (e.g. 100 ms, 500 ms, 2 s), pace_step
//      delegates to next_input(true) which calls q.get(0.02) — capped at 20 ms rather than waiting the whole lead —
//      so newly arriving inputs wake up and are applied promptly; when lab is behind wall, q.get is not called.
//   3. --idle wall cadence: no spinning (no idle_slice) when wall time has not advanced; advances 1:1 with wall
//      time in slices capped at SLICE_NS (50 ms); pace_ratio() tracks 1.0 and pace history is bounded at 200;
//      periodic status (every 10 slices) and trim (every TRIM_EVERY slices) run on cadence; control pause/resume
//      stops idle stepping and re-anchors on resume without a spurious re-anchor drop.
//   4. Negative controls: broken threshold (never re-anchors / re-anchors at <= BEHIND_NS), broken queue wait cap
//      (waits the full lead instead of 20 ms), and broken --idle wall cadence (spins while ahead / ignores SLICE_NS
//      cap / fails to advance) each cause their gate assertions to fail.
//
//   node emu/test/test_pacing.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from '../src/util/sha256.mjs';
import { Player, BEHIND_NS, SLICE_NS, TRIM_EVERY } from '../src/lab/player.mjs';

const QUEUE_WAIT_S = 0.02;

// Fake blocking queue implementing Player's queue contract (canBlock, put, get_nowait, get(timeout), qsize, items).
class FakeBlockingQueue {
  constructor() {
    this.buf = [];
    this.waits = [];       // timeout (seconds) passed to each get(timeout) call
    this.onGet = null;     // optional hook(timeout) -> input | null
  }
  get canBlock() { return true; }
  put(x) { this.buf.push(x); }
  get_nowait() { return this.buf.length ? this.buf.shift() : null; }
  get(timeout) {
    this.waits.push(timeout);
    if (this.buf.length) return this.buf.shift();
    return this.onGet ? this.onGet(timeout) : null;
  }
  qsize() { return this.buf.length; }
  items() { return [...this.buf]; }
}

// Lightweight fake PlaySession: advances lab_ns deterministically on idle_slice() and records slices, trims, dials.
function makeFakeSession(lab0 = 0) {
  let lab_ns = lab0;
  const slices = [];       // [from_ns, to_ns]
  const dials = [];        // [id, detents]
  const trims = [];        // keep argument passed to trim()
  return {
    device: 'tft',
    scene: null,
    audio: null,
    camapp: null,
    a15_frames: 0,
    slices,
    dials,
    trims,
    lab: {
      lab_time: () => lab_ns,
      set_lab_time: (ns) => { lab_ns = ns; },
      events: [],
      exec_history: [],
      steps: [],
      harvest() {},
    },
    idle_slice(to_ns) {
      slices.push([lab_ns, to_ns]);
      lab_ns = to_ns;
    },
    pending_touch() { return false; },
    gate_open() { return true; },
    dial_input(id, n) {
      dials.push([id, n]);
      return { kind: 'dial', token: `DIAL:${id}:${n}`, state: {} };
    },
    trim(keep) { trims.push(keep); },
    status() { return { lab_ns }; },
    close() {},
  };
}

// Build a Player wired with an injected fake wall clock, FakeBlockingQueue and fake PlaySession.
function makeHarness({ idle = 'wall', wall0 = 10.0, lab0 = 0, mutate = null } = {}) {
  let now_s = wall0;
  const q = new FakeBlockingQueue();
  const s = makeFakeSession(lab0);
  let statuses = 0;
  const args = {
    idle,
    out: '<out>',
    us_clock: 'lab',
    touch: 'off',
    x_mutant: null,
    no_bgdraw: false,
    a15: 'off',
    device: 'tft',
    compose: 'boundary',
    debug_api: false,
    x_trim_keep: 2000,
  };
  const env = {
    wallClock: () => now_s,
    queue: q,
    createHash,
    card: { open: () => null, save() {}, out: false },
    onStatus: () => { statuses += 1; },
  };
  const pl = new Player(args, env);
  pl.session = s;
  pl.phase = 'running';
  pl.anchor();
  if (mutate) mutate(pl);
  return {
    pl,
    s,
    q,
    get wall() { return now_s; },
    set wall(v) { now_s = v; },
    advanceWall(dt_s) { now_s += dt_s; },
    get statuses() { return statuses; },
  };
}

// ---- Gate 1: BEHIND_NS (250 ms) re-anchor and boundary control
function checkBehindReanchor(mutate = null) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 1a. Control: target - lab === BEHIND_NS (exact 250 ms boundary) must NOT re-anchor.
  // Use w_a = 0, l_a = 0, now_w = 0.25 (exact binary fraction 2^-2 -> target = 250_000_000 ns exactly).
  {
    const h = makeHarness({ wall0: 0, lab0: 0, mutate });
    h.wall = 0.25;
    h.pl.tick();
    ok(h.pl.dropped.get('pacing re-anchored') === undefined,
      `BEHIND_NS control (exact 250 ms): must not re-anchor, dropped=${h.pl.dropped.get('pacing re-anchored')}`);
    ok(h.pl.w_a === 0 && h.pl.l_a === 0,
      `BEHIND_NS control (exact 250 ms): anchor unchanged (w_a=${h.pl.w_a}, l_a=${h.pl.l_a})`);
    ok(h.s.slices.length === 1 && h.s.slices[0][0] === 0 && h.s.slices[0][1] === SLICE_NS,
      `BEHIND_NS control (exact 250 ms): first slice advances by SLICE_NS (${JSON.stringify(h.s.slices)})`);
    // Remaining 4 ticks catch up to 250 ms in 50 ms slices without re-anchoring
    for (let i = 0; i < 4; i++) h.pl.tick();
    ok(h.s.lab.lab_time() === BEHIND_NS && h.pl.dropped.get('pacing re-anchored') === undefined,
      `BEHIND_NS control (exact 250 ms): catches up to ${BEHIND_NS} ns without re-anchor (lab=${h.s.lab.lab_time()}, dropped=${h.pl.dropped.get('pacing re-anchored')})`);
  }

  // 1b. Just over boundary: target - lab === BEHIND_NS + 1 ns (exact: l_a = 1, lab = 0, w_a = 0, now_w = 0.25)
  // MUST re-anchor, log 'pacing re-anchored', and run a 1 ms slice from the new anchor.
  {
    const h = makeHarness({ wall0: 0, lab0: 0, mutate });
    h.pl.l_a = 1;
    h.wall = 0.25;
    h.pl.tick();
    ok(h.pl.dropped.get('pacing re-anchored') === 1,
      `BEHIND_NS + 1 ns: must log 1 'pacing re-anchored' drop, got ${h.pl.dropped.get('pacing re-anchored')}`);
    ok(h.pl.w_a === 0.25 && h.pl.l_a === 0,
      `BEHIND_NS + 1 ns: anchor reset to (0.25, 0), got (${h.pl.w_a}, ${h.pl.l_a})`);
    ok(h.s.slices.length === 1 && h.s.slices[0][0] === 0 && h.s.slices[0][1] === 1_000_000,
      `BEHIND_NS + 1 ns: re-anchored slice is 1 ms (${JSON.stringify(h.s.slices)})`);
  }

  // 1c. Large lag (500 ms): re-anchors once, then subsequent small wall advance does not re-anchor again.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 5_000_000, mutate });
    h.wall = 10.5;
    h.pl.tick();
    ok(h.pl.dropped.get('pacing re-anchored') === 1,
      `500 ms lag: logged 1 'pacing re-anchored' drop, got ${h.pl.dropped.get('pacing re-anchored')}`);
    ok(h.pl.w_a === 10.5 && h.pl.l_a === 5_000_000 && h.s.lab.lab_time() === 6_000_000,
      `500 ms lag: re-anchored at (10.5, 5_000_000) and stepped 1 ms to 6_000_000 (got w_a=${h.pl.w_a}, l_a=${h.pl.l_a}, lab=${h.s.lab.lab_time()})`);
    h.wall = 10.53125;                   // +31.25 ms (exact binary fraction 1/32 s)
    h.pl.tick();
    ok(h.pl.dropped.get('pacing re-anchored') === 1 && h.s.lab.lab_time() === 36_250_000,
      `post-re-anchor +31.25 ms wall: no second re-anchor, lab advances to 36_250_000 (got dropped=${h.pl.dropped.get('pacing re-anchored')}, lab=${h.s.lab.lab_time()})`);
  }

  return { checks, bad };
}

// ---- Gate 2: 20 ms queue wait cap when lab is ahead of wall time
function checkQueueWaitCap(mutate = null) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 2a. Lab ahead by 100 ms, 500 ms, and 2000 ms (> 20 ms): every tick calls q.get(0.02), never the full lead.
  for (const lead_ms of [100, 500, 2000]) {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    h.s.lab.set_lab_time(lead_ms * 1_000_000);
    h.pl.tick();
    ok(h.s.slices.length === 0,
      `lab ahead ${lead_ms} ms: must not run idle_slice (slices=${JSON.stringify(h.s.slices)})`);
    ok(h.q.waits.length === 1 && h.q.waits[0] === QUEUE_WAIT_S,
      `lab ahead ${lead_ms} ms: q.get timeout must be capped at ${QUEUE_WAIT_S} s, got ${JSON.stringify(h.q.waits)}`);
  }

  // 2b. Newly arriving input during the 20 ms wait wakes up promptly and is applied without waiting the 500 ms lead.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    h.s.lab.set_lab_time(500_000_000);   // 500 ms ahead of wall
    h.q.onGet = (timeout) => {
      h.advanceWall(timeout);            // simulated wait elapsed
      return { type: 'dial', id: 'main', detents: 1, seq: 1, t_wall: h.wall };
    };
    h.pl.tick();
    const res = h.pl.pop_result(1);
    ok(h.q.waits.length === 1 && h.q.waits[0] <= QUEUE_WAIT_S,
      `wake on input (500 ms lead): wait capped at ${QUEUE_WAIT_S} s, got ${JSON.stringify(h.q.waits)}`);
    ok(h.wall - 10.0 <= QUEUE_WAIT_S + 1e-9,
      `wake on input (500 ms lead): wall elapsed ${(h.wall - 10.0).toFixed(4)} s <= ${QUEUE_WAIT_S} s`);
    ok(h.s.slices.length === 0 && h.s.dials.length === 1 && h.s.dials[0][0] === 'main' && h.s.dials[0][1] === 1,
      `wake on input: dial applied immediately without idle_slice (slices=${h.s.slices.length}, dials=${JSON.stringify(h.s.dials)})`);
    ok(res !== null && res.error === null && res.dropped === false && res.record?.token === 'DIAL:main:1',
      `wake on input: result delivered cleanly (${JSON.stringify(res)})`);
  }

  // 2c. Control: when lab is behind wall, pace_step runs idle_slice directly without calling q.get.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    h.wall = 10.03125;                   // 31.25 ms behind wall (exact 1/32 s)
    h.pl.tick();
    ok(h.q.waits.length === 0 && h.s.slices.length === 1 && h.s.lab.lab_time() === 31_250_000,
      `lab behind wall: no q.get wait, stepped to 31.25 ms (waits=${JSON.stringify(h.q.waits)}, lab=${h.s.lab.lab_time()})`);
  }

  // 2d. --idle off with nothing queued also uses the 20 ms blocking wait and runs no idle_slice.
  {
    const h = makeHarness({ idle: 'off', wall0: 10.0, lab0: 0, mutate });
    h.wall = 10.1;
    h.pl.tick();
    ok(h.q.waits.length === 1 && h.q.waits[0] === QUEUE_WAIT_S && h.s.slices.length === 0,
      `idle off: waits ${QUEUE_WAIT_S} s via q.get without idle_slice (waits=${JSON.stringify(h.q.waits)}, slices=${h.s.slices.length})`);
  }

  return { checks, bad };
}

// ---- Gate 3: --idle wall cadence
function checkIdleWallCadence(mutate = null) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 3a. No spinning when wall time has not advanced: 5 ticks at fixed wall time run 0 idle slices and yield 5 waits.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    for (let i = 0; i < 5; i++) h.pl.tick();
    ok(h.s.slices.length === 0 && h.pl.slices === 0 && h.s.lab.lab_time() === 0 && h.pl.pace.length === 0,
      `no-spin at fixed wall: expected 0 slices and lab=0 (slices=${h.s.slices.length}, pl.slices=${h.pl.slices}, lab=${h.s.lab.lab_time()})`);
    ok(h.q.waits.length === 5 && h.q.waits.every((w) => w === QUEUE_WAIT_S),
      `no-spin at fixed wall: each tick yields a ${QUEUE_WAIT_S} s wait (waits=${JSON.stringify(h.q.waits)})`);
  }

  // 3b. Advances 1:1 on wall-clock pace in small steps (15.625 ms = 1/64 s each, exact in float64).
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    for (let i = 1; i <= 5; i++) {
      h.wall = 10.0 + i * 0.015625;
      h.pl.tick();
    }
    ok(h.s.slices.length === 5 && h.pl.slices === 5 && h.s.lab.lab_time() === 78_125_000,
      `wall cadence (5 x 15.625 ms): 5 slices to 78.125 ms (slices=${h.s.slices.length}, lab=${h.s.lab.lab_time()})`);
    ok(h.pl.pace_ratio() === 1,
      `wall cadence: pace_ratio() is 1.0, got ${h.pl.pace_ratio()}`);
    ok(h.q.waits.length === 0,
      `wall cadence: no queue waits while catching up (waits=${JSON.stringify(h.q.waits)})`);
    // Next tick at the same wall time does not spin
    h.pl.tick();
    ok(h.s.slices.length === 5 && h.q.waits.length === 1 && h.q.waits[0] === QUEUE_WAIT_S,
      `wall cadence: once caught up, next tick yields without running a slice (slices=${h.s.slices.length}, waits=${JSON.stringify(h.q.waits)})`);
  }

  // 3c. Slice cap at SLICE_NS (50 ms) when wall jumps 125 ms (exact 1/8 s, within BEHIND_NS): steps 50, 50, 25 ms, then yields.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    h.wall = 10.125;
    for (let i = 0; i < 4; i++) h.pl.tick();
    const ends = h.s.slices.map(([, to]) => to);
    ok(JSON.stringify(ends) === JSON.stringify([50_000_000, 100_000_000, 125_000_000]),
      `SLICE_NS cap on 125 ms jump: expected [50ms, 100ms, 125ms], got ${JSON.stringify(ends)}`);
    ok(h.q.waits.length === 1 && h.q.waits[0] === QUEUE_WAIT_S && h.pl.dropped.get('pacing re-anchored') === undefined,
      `SLICE_NS cap on 125 ms jump: 4th tick yields, no re-anchor (waits=${JSON.stringify(h.q.waits)}, dropped=${h.pl.dropped.get('pacing re-anchored')})`);
  }

  // 3d. Control pause / resume: pause halts idle slices; resume re-anchors so elapsed pause wall time does not
  // trigger BEHIND_NS re-anchor or a catch-up burst.
  {
    const h = makeHarness({ wall0: 10.0, lab0: 0, mutate });
    h.pl.submit({ type: 'control', op: 'pause' });
    h.pl.tick();                         // applies pause
    h.wall = 11.0;                       // 1 full second passes while paused (> BEHIND_NS)
    h.pl.tick();                         // idle is 'off': must not slice
    ok(h.pl.idle === 'off' && h.s.slices.length === 0 && h.s.lab.lab_time() === 0,
      `control pause: idle off and no slices while paused (idle=${h.pl.idle}, slices=${h.s.slices.length})`);
    h.pl.submit({ type: 'control', op: 'resume' });
    h.pl.tick();                         // applies resume -> re-anchors at wall=11.0, lab=0
    h.pl.tick();                         // wall unchanged: must not slice or re-anchor
    ok(h.pl.idle === 'wall' && h.pl.w_a === 11.0 && h.pl.l_a === 0 && h.s.slices.length === 0 && h.pl.dropped.get('pacing re-anchored') === undefined,
      `control resume: re-anchored at (11.0, 0) with no re-anchor drop (w_a=${h.pl.w_a}, l_a=${h.pl.l_a}, slices=${h.s.slices.length}, dropped=${h.pl.dropped.get('pacing re-anchored')})`);
    h.wall = 11.03125;                   // +31.25 ms (exact 1/32 s)
    h.pl.tick();
    ok(h.s.slices.length === 1 && h.s.lab.lab_time() === 31_250_000,
      `after resume +31.25 ms: advances 31.25 ms cleanly (slices=${h.s.slices.length}, lab=${h.s.lab.lab_time()})`);
  }

  // 3e. Periodic housekeeping over 210 slices: status every 10 slices, trim every TRIM_EVERY (100), pace capped at 200.
  {
    const h = makeHarness({ wall0: 0, lab0: 0, mutate });
    for (let i = 1; i <= 210; i++) {
      h.wall = i * 0.015625;
      h.pl.tick();
    }
    ok(h.pl.slices === 210 && h.pl.pace.length === 200,
      `210 slices: pace history capped at 200 (slices=${h.pl.slices}, pace.length=${h.pl.pace.length})`);
    ok(h.statuses === 21 && h.s.trims.length === Math.floor(210 / TRIM_EVERY),
      `210 slices: status published every 10 slices (${h.statuses}) and trim every ${TRIM_EVERY} (${h.s.trims.length})`);
  }

  return { checks, bad };
}

// ---- Gate 4: Negative controls proving each assertion fails if its threshold, cap, or cadence is broken
function checkNegativeControls() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 4a. Broken BEHIND_NS: never re-anchors (threshold disabled).
  const ncNoReanchor = checkBehindReanchor((pl) => {
    pl.pace_step = function () {
      const s = this.session;
      const now_w = this.wall();
      const lab = s.lab.lab_time();
      const target = this.l_a + Math.trunc((now_w - this.w_a) * 1e9);
      if (lab >= target) { const inp = this.next_input(true); if (inp !== null) this.apply(inp); return; }
      // Mutant: BEHIND_NS re-anchor check omitted.
      const m = this.marks();
      s.idle_slice(Math.min(target, lab + SLICE_NS));
      this.after_lab_time(m);
      this.pace.push([this.wall(), s.lab.lab_time()]);
      this.slices += 1;
    };
  });
  ok(ncNoReanchor.bad.length > 0,
    'negative control (BEHIND_NS re-anchor disabled): gate must fail');

  // 4b. Broken BEHIND_NS boundary: re-anchors at >= BEHIND_NS instead of > BEHIND_NS.
  const ncOffByOne = checkBehindReanchor((pl) => {
    pl.pace_step = function () {
      const s = this.session;
      const now_w = this.wall();
      const lab = s.lab.lab_time();
      let target = this.l_a + Math.trunc((now_w - this.w_a) * 1e9);
      if (lab >= target) { const inp = this.next_input(true); if (inp !== null) this.apply(inp); return; }
      if (target - lab >= BEHIND_NS) {   // Mutant: >= instead of >
        this.anchor();
        target = this.l_a + 1000000;
        this.dropped.add('pacing re-anchored');
      }
      const m = this.marks();
      s.idle_slice(Math.min(target, lab + SLICE_NS));
      this.after_lab_time(m);
      this.pace.push([this.wall(), s.lab.lab_time()]);
      this.slices += 1;
    };
  });
  ok(ncOffByOne.bad.length > 0,
    'negative control (BEHIND_NS >= instead of >): boundary control must fail');

  // 4c. Broken 20 ms queue wait cap: waits the full lab lead instead of capping at 0.02 s.
  const ncUncappedWait = checkQueueWaitCap((pl) => {
    const origNext = pl.next_input.bind(pl);
    pl.next_input = function (block) {
      if (block && !this.held.length && this.session) {
        this.drain();
        if (!this.held.length) {
          const target = this.l_a + Math.trunc((this.wall() - this.w_a) * 1e9);
          const lead_s = Math.max(QUEUE_WAIT_S, (this.session.lab.lab_time() - target) / 1e9);
          const x = this.q.get(lead_s);  // Mutant: waits full lead instead of 0.02 s
          if (x === null) return null;
          this.held.push(x);
          return origNext(false);
        }
      }
      return origNext(block);
    };
  });
  ok(ncUncappedWait.bad.length > 0,
    'negative control (queue wait uncapped to full lead): gate must fail');

  // 4d. Broken --idle wall cadence: spins (runs idle_slice even when lab >= target).
  const ncSpin = checkIdleWallCadence((pl) => {
    const origPace = pl.pace_step.bind(pl);
    pl.pace_step = function () {
      const s = this.session;
      const lab = s.lab.lab_time();
      const target = this.l_a + Math.trunc((this.wall() - this.w_a) * 1e9);
      if (lab >= target) {
        s.idle_slice(lab + 1_000_000);   // Mutant: spins a 1 ms slice instead of waiting
        this.slices += 1;
        return;
      }
      origPace();
    };
  });
  ok(ncSpin.bad.length > 0,
    'negative control (--idle wall spins when caught up): gate must fail');

  // 4e. Broken --idle wall cadence: ignores SLICE_NS (50 ms) cap and jumps straight to target.
  const ncNoSliceCap = checkIdleWallCadence((pl) => {
    pl.pace_step = function () {
      const s = this.session;
      const now_w = this.wall();
      const lab = s.lab.lab_time();
      let target = this.l_a + Math.trunc((now_w - this.w_a) * 1e9);
      if (lab >= target) { const inp = this.next_input(true); if (inp !== null) this.apply(inp); return; }
      if (target - lab > BEHIND_NS) {
        this.anchor();
        target = this.l_a + 1000000;
        this.dropped.add('pacing re-anchored');
      }
      const m = this.marks();
      s.idle_slice(target);              // Mutant: no SLICE_NS cap
      this.after_lab_time(m);
      this.pace.push([this.wall(), s.lab.lab_time()]);
      if (this.pace.length > 200) this.pace.shift();
      this.slices += 1;
      if (this.slices % TRIM_EVERY === 0) s.trim(this.trim_keep);
      if (this.slices % 10 === 0) this.publish_status();
    };
  });
  ok(ncNoSliceCap.bad.length > 0,
    'negative control (--idle wall ignores SLICE_NS cap): gate must fail');

  return { checks, bad };
}

export function pacingUnits() {
  const parts = [
    checkBehindReanchor(),
    checkQueueWaitCap(),
    checkIdleWallCadence(),
    checkNegativeControls(),
  ];
  const checks = parts.reduce((n, p) => n + p.checks, 0);
  const bad = parts.flatMap((p) => p.bad);
  const notes = [
    `BEHIND_NS=${BEHIND_NS} ns, SLICE_NS=${SLICE_NS} ns, queue wait=${QUEUE_WAIT_S * 1000} ms, TRIM_EVERY=${TRIM_EVERY}`,
  ];
  return { checks, bad, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = pacingUnits();
  console.log(`Player pacing and timing paths: ${r.checks - r.bad.length}/${r.checks}`);
  r.notes.forEach((x) => console.log('   note:', x));
  r.bad.slice(0, 40).forEach((x) => console.log('  ', x));
  process.exitCode = r.bad.length ? 1 : 0;
}
