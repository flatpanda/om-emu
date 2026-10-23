// The Player's loop for a host with an event loop (the browser player's Worker; the node host's worker thread): what
// Player.run does (open the session, tick until stopped, close, write the log), with the
// waiting inside next_input (q.get(timeout=0.02)) moved between ticks, where messages can arrive:
//   while (!stopping) { player.tick(); await wake(); }
// wake() resolves on the next macrotask when an input is queued (and not held back by its page's order) or when the
// lab is behind its pacing target (--idle wall); otherwise on the next kick() (a message arrived) or a timer: until the
// pacing target passes the lab time, until a held input's order deadline, else 20 ms. It never spins: a lab ahead of
// the wall clock with nothing queued sleeps, and so does a session halted by the live debug route (src/debug/live.mjs)
// until a debug input or control arrives. The Player runs with env.asyncHost (an overtaking input makes the blocking
// next_input return instead of polling). Worker-safe; the scheduler is injectable for the node test (test_web.mjs).
import { LabError } from '../src/lab/errors.mjs';
import { Unported, HostStopped } from '../src/machine.mjs';

// What a session survives in the browser: a lab error (LabError), and a path emu leaves out (Unported) or a machine it
// stopped (HostStopped). Both end the session in phase 'error', from which restart opens a fresh one; node's
// Player.run still lets them end the process.
const sessionError = (e) => e instanceof LabError || e instanceof Unported || e instanceof HostStopped;

export const IDLE_WAIT_MS = 20;

// The default scheduler: wall seconds (performance.timeOrigin-based, the epoch the page's t_page uses), timers, and a
// macrotask that lets queued messages in (a MessageChannel post: setTimeout(0) is clamped to 4 ms when nested).
export function defaultScheduler() {
  const ch = new MessageChannel(), q = [];
  ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
  return {
    now: () => (performance.timeOrigin + performance.now()) / 1000,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    macrotask: (fn) => { q.push(fn); ch.port2.postMessage(0); },
    close: () => { ch.port1.close(); },
  };
}

export class Driver {
  constructor(player, sched = defaultScheduler()) {
    this.pl = player;
    this.sched = sched;
    this.pending = null;            // [resolve, timer] of the current wait
    this.waits = { immediate: 0, timer: 0, kicked: 0, timedOut: 0 };
  }
  // A message arrived (an input, a control, a quit): end the current wait.
  kick() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p[1] !== null) this.sched.clearTimer(p[1]);
    this.waits.kicked++;
    p[0]('kick');
  }
  // How long to wait before the next tick: 0 (next macrotask) or milliseconds.
  delay() {
    const pl = this.pl;
    if (pl.stopping()) return 0;
    if (pl.live?.halted) return pl.debug_ready() ? 0 : IDLE_WAIT_MS;        // halted (debug): its inputs wait held
    if (pl.q.length || pl.held.length) {
      const h = pl.held[0];
      const key = h && h.client !== undefined ? `${h.client}\0${pl.client_next.get(h.client) ?? 1}` : null;
      const w = key !== null ? pl.client_wait.get(key) : undefined;
      if (!pl.q.length && w !== undefined) return Math.max(0, Math.min(IDLE_WAIT_MS, (w[2] - pl.wall()) * 1000));   // held back by its order
      return 0;
    }
    const s = pl.session;
    if (s !== null && pl.idle === 'wall') {
      const ahead_ns = s.lab.lab_time() - (pl.l_a + Math.trunc((pl.wall() - pl.w_a) * 1e9));
      if (ahead_ns < 0) return 0;
      return Math.min(IDLE_WAIT_MS, ahead_ns / 1e6 + 0.5);
    }
    return IDLE_WAIT_MS;
  }
  wake() {
    const ms = this.delay();
    return new Promise((resolve) => {
      if (ms <= 0) { this.waits.immediate++; this.sched.macrotask(() => resolve('now')); return; }
      this.waits.timer++;
      const p = [resolve, null];
      p[1] = this.sched.setTimer(() => { if (this.pending === p) this.pending = null; this.waits.timedOut++; resolve('timer'); }, ms);
      this.pending = p;
    });
  }
  // Player.run's loop for an async host (no --replay). Any other failure (a bug) propagates to the caller.
  async run() {
    const pl = this.pl;
    try { pl.open_session(); } catch (e) {
      if (!sessionError(e)) throw e;
      pl.set_phase('error', pl.describe(e));
    }
    while (!pl.stopping()) {
      try { pl.tick(); } catch (e) {
        if (!sessionError(e)) throw e;
        pl.fail(e);
      }
      await this.wake();
    }
    pl.close_session();
    pl.write_log();
    this.sched.close?.();
  }
}
