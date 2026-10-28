// The SCPU's time base: the core's cycle counter (src/core/m4/cpu.mjs counts one cycle per instruction, at HCLK) and
// the peripherals' events on it. A peripheral schedules a callback at a cycle (a character's end on a UART, a timer's
// update, an RTC second); the machine (stm32l4.mjs) fires the due ones between instructions and, while the core
// sleeps, jumps the cycle counter to the next event.
//
// A peripheral whose clock a low-power mode stops (the Stop modes stop HCLK and the APB clocks, RM0394 5.3.6..5.3.8)
// takes a clock domain (domain(name)) in place of the scheduler: the same now() / at() / after() / cancel(), in the
// domain's own time. While the domain is frozen its time stands still and its events wait; thawed, each falls due as
// many cycles later as the domain was frozen, so a timer's counter, a UART's frame or a DMA transfer resumes where it
// stopped.
export class Scheduler {
  constructor(cpu) {
    this.cpu = cpu;
    this.q = [];                                  // events sorted by cycle, then by order of scheduling
    this.seq = 0;
    this.domains = [];                            // the clock domains made by domain()
  }
  now() { return this.cpu.cycles; }
  // fn() at cycle t (at once if t is not in the future); returns a handle for cancel()
  at(t, fn, what = '', domain = null) {
    const e = { t: Math.max(Math.ceil(t), this.cpu.cycles), seq: this.seq++, fn, what, dead: false, domain };
    this.insert(e);
    return e;
  }
  insert(e) {
    let i = this.q.length;
    while (i > 0 && (this.q[i - 1].t > e.t)) i--;
    this.q.splice(i, 0, e);
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
  // a clock domain on this time base (registered, so the machine can freeze and thaw them all)
  domain(name) { const d = new Domain(this, name); this.domains.push(d); return d; }
  // remove a domain's events from the queue, in order (the queue is changed in place: the machine's run loop holds it)
  take(domain) {
    const out = [];
    for (let i = this.q.length - 1; i >= 0; i--) {
      if (this.q[i].domain !== domain) continue;
      const [e] = this.q.splice(i, 1);
      if (!e.dead) out.unshift(e);
    }
    return out;
  }
}

// A clock domain: the scheduler as one peripheral sees it, with time that stands still while the domain is frozen.
// Its time is the core's cycles less `offset`, the cycles it has spent frozen; an event's cycle in the queue is its
// domain time plus the offset at the time it was scheduled, and a thaw moves the held events on by the frozen span.
export class Domain {
  constructor(sched, name) {
    this.sched = sched;
    this.name = name;
    this.offset = 0;
    this.frozenAt = -1;                           // the core's cycle at the freeze, -1 while running
    this.held = [];                               // the events waiting while frozen
  }
  frozen() { return this.frozenAt >= 0; }
  now() { return (this.frozenAt >= 0 ? this.frozenAt : this.sched.now()) - this.offset; }
  at(t, fn, what = '') {
    if (this.frozenAt < 0) return this.sched.at(t + this.offset, fn, what, this);
    const e = { t: Math.max(Math.ceil(t), this.now()) + this.offset, seq: this.sched.seq++, fn, what, dead: false, domain: this };
    this.held.push(e);
    return e;
  }
  after(cycles, fn, what) { return this.at(this.now() + cycles, fn, what); }
  cancel(e) { return this.sched.cancel(e); }
  freeze() {
    if (this.frozenAt >= 0) return;
    this.frozenAt = this.sched.now();
    this.held = this.sched.take(this);
  }
  thaw() {
    if (this.frozenAt < 0) return;
    const d = this.sched.now() - this.frozenAt;
    this.offset += d;
    this.frozenAt = -1;
    const held = this.held.filter((e) => !e.dead).sort((a, b) => a.t - b.t || a.seq - b.seq);
    this.held = [];
    for (const e of held) { e.t += d; this.sched.insert(e); }
  }
}
