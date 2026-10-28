// The SCPU's time base: the core's cycle counter (src/core/m4/cpu.mjs counts one cycle per instruction, at HCLK) and
// the peripherals' events on it. A peripheral schedules a callback at a cycle (a character's end on a UART, a timer's
// update, an RTC second); the machine (stm32l4.mjs) fires the due ones between instructions and, while the core
// sleeps, jumps the cycle counter to the next event.
export class Scheduler {
  constructor(cpu) {
    this.cpu = cpu;
    this.q = [];                                  // events sorted by cycle, then by order of scheduling
    this.seq = 0;
  }
  now() { return this.cpu.cycles; }
  // fn() at cycle t (at once if t is not in the future); returns a handle for cancel()
  at(t, fn, what = '') {
    const e = { t: Math.max(Math.ceil(t), this.cpu.cycles), seq: this.seq++, fn, what, dead: false };
    let i = this.q.length;
    while (i > 0 && (this.q[i - 1].t > e.t)) i--;
    this.q.splice(i, 0, e);
    return e;
  }
  after(cycles, fn, what) { return this.at(this.cpu.cycles + cycles, fn, what); }
  cancel(e) { if (e) e.dead = true; return null; }
  next() {
    while (this.q.length && this.q[0].dead) this.q.shift();
    return this.q.length ? this.q[0].t : Infinity;
  }
  // fire every event due at the current cycle
  fire() {
    const now = this.cpu.cycles;
    while (this.q.length && this.q[0].t <= now) {
      const e = this.q.shift();
      if (!e.dead) e.fn();
    }
  }
}
