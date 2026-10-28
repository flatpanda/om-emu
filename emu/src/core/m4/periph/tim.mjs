// The STM32L4's timers (RM0394 sections 26..28; TIM1 at 0x40012c00, TIM2 at 0x40000000, TIM15 at 0x40014000, TIM16
// at 0x40014400) as time bases at register level: the up-counting edge-aligned counter on the timer clock (RCC's,
// doubled when the APB prescaler is not 1) through the prescaler, ARR with its preload (ARPE), PSC and the repetition
// counter (RCR) loaded at each update event, one-pulse mode, EGR.UG, URS / UDIS, the update flag and the
// capture / compare flags of output-compare channels (CCxIF when the counter reaches CCRx), and their interrupts.
// The counter is computed from the core's cycles; events are scheduled for the next update and for the compares of
// the channels whose interrupt is enabled (I: the flag of a channel whose interrupt is off is not set; the SCPU image
// enables CC1 on TIM15), at the clocks of the time they are scheduled (a clock change takes effect at the next). What
// the channels drive on their pins (PWM, output compare modes) is not modelled, and nothing is ever captured (no input
// edges reach a timer, I). Down and centre-aligned counting, slave modes, DMA requests, break and the commutation
// events throw Unmodelled when enabled.
import { Regs, Unmodelled, merge } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, SMCR = 0x08, DIER = 0x0c, SR = 0x10, EGR = 0x14, CCMR1 = 0x18, CCMR2 = 0x1c,
  CCER = 0x20, CNT = 0x24, PSC = 0x28, ARR = 0x2c, RCR = 0x30, CCR1 = 0x34, BDTR = 0x44, DCR = 0x48, DMAR = 0x4c,
  OR1 = 0x50, CCMR3 = 0x54, CCR5 = 0x58, CCR6 = 0x5c, OR2 = 0x60, OR3 = 0x64;
const CEN = 1, UDIS = 2, URS = 4, OPM = 8, ARPE = 128, UIF = 1;
const PLAIN = [CR2, CCMR1, CCMR2, CCER, BDTR, DCR, OR1, CCMR3, CCR5, CCR6, OR2, OR3];

export class Timer extends Regs {
  // name, bits (16 or 32), channels (number of CC channels), sched, irq, irqs {up, cc, brk, trg} (IRQ numbers),
  // clockHz() / hclkHz()
  constructor({ name, bits = 16, channels = 4, sched, irq, irqs, clockHz, hclkHz }) {
    super(name);
    Object.assign(this, { bits, channels, sched, irq, irqs, clockHz, hclkHz });
    this.max = bits === 32 ? 0xffffffff : 0xffff;
    this.reset();
  }
  reset() {
    this.cr1 = 0; this.smcr = 0; this.dier = 0; this.sr = 0;
    this.psc = 0; this.pscActive = 0; this.arr = this.max; this.arrActive = this.max; this.rcr = 0; this.rep = 0;
    this.ccr = [0, 0, 0, 0];
    this.r = new Map(PLAIN.map((o) => [o, 0]));
    this.cnt = 0; this.t0 = 0;                     // the counter's value at cycle t0 while running
    this.ev = this.sched ? this.sched.cancel(this.ev) : null;
    if (this.irq) this.update();
  }
  running() { return (this.cr1 & CEN) !== 0; }
  // core cycles per counter tick
  period() { return this.hclkHz() * (this.pscActive + 1) / this.clockHz(); }
  // the counter now (it wraps at ARR + 1; the wraps themselves are the scheduled events)
  counter() {
    if (!this.running()) return this.cnt;
    const ticks = Math.floor((this.sched.now() - this.t0) / this.period());
    return Math.min(this.cnt + ticks, this.arrActive);
  }
  // fold the ticks so far into cnt, keeping t0 on a tick boundary
  freeze() {
    if (!this.running()) { this.t0 = this.sched.now(); return; }
    const per = this.period(), ticks = Math.floor((this.sched.now() - this.t0) / per);
    this.cnt = Math.min(this.cnt + ticks, this.arrActive);
    this.t0 += ticks * per;
  }
  rd(off) {
    switch (off) {
      case CR1: return this.cr1;
      case SMCR: return this.smcr;
      case DIER: return this.dier;
      case SR: return this.sr;
      case EGR: return 0;
      case CNT: return this.counter();
      case PSC: return this.psc;
      case ARR: return this.arr;
      case RCR: return this.rcr;
      case DMAR: return 0;
    }
    if (off >= CCR1 && off < CCR1 + 16) return this.ccr[(off - CCR1) >> 2];
    if (this.r.has(off)) return this.r.get(off);
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    switch (off) {
      case CR1: {
        this.freeze();
        const was = this.running();
        this.cr1 = merge(this.cr1, v, mask, 0x0bff);
        if (this.cr1 & (0x70)) throw new Unmodelled(`${this.name} down or centre-aligned counting (CR1 0x${this.cr1.toString(16)})`);
        if (!was && this.running()) this.t0 = this.sched.now();
        if (was && !this.running()) this.t0 = this.sched.now();
        this.schedule();
        return;
      }
      case SMCR: this.smcr = merge(this.smcr, v, mask); if (this.smcr & 0x10007) throw new Unmodelled(`${this.name} slave mode (SMCR 0x${this.smcr.toString(16)})`); return;
      case DIER: {
        this.dier = merge(this.dier, v, mask, 0x7fff);
        if (this.dier & 0x7f00) throw new Unmodelled(`${this.name} DMA requests (DIER 0x${this.dier.toString(16)})`);
        if (this.dier & 0xe0) throw new Unmodelled(`${this.name} commutation, trigger or break interrupts (DIER 0x${this.dier.toString(16)})`);
        this.freeze(); this.schedule(); this.update();
        return;
      }
      case SR: this.sr &= (v | ~mask); this.update(); return;          // rc_w0
      case EGR: {
        const g = v & mask;
        if (g & 1) {                                // UG: reinitialise the counter, load the preloaded registers
          this.cnt = 0; this.t0 = this.sched.now(); this.pscActive = this.psc; this.arrActive = this.arr; this.rep = this.rcr;
          if (!(this.cr1 & URS)) this.sr |= UIF;
        }
        for (let k = 1; k <= this.channels; k++) if ((g >>> k) & 1) this.sr |= 1 << k;
        this.schedule(); this.update();
        return;
      }
      case CNT: this.cnt = (v & mask & this.max) >>> 0; this.t0 = this.sched.now(); this.schedule(); return;
      case PSC: this.freeze(); this.psc = merge(this.psc, v, mask, 0xffff); return;     // takes effect at the next update
      case ARR:
        this.freeze();
        this.arr = merge(this.arr, v, mask, this.max);
        if (!(this.cr1 & ARPE)) this.arrActive = this.arr;
        this.schedule();
        return;
      case RCR: this.rcr = merge(this.rcr, v, mask, 0xffff); return;
      case DMAR: throw new Unmodelled(`${this.name} DMA burst (DMAR)`);
    }
    if (off >= CCR1 && off < CCR1 + 16) { this.freeze(); this.ccr[(off - CCR1) >> 2] = merge(this.ccr[(off - CCR1) >> 2], v, mask, this.max); this.schedule(); return; }
    if (this.r.has(off)) { this.r.set(off, merge(this.r.get(off), v, mask)); return; }
    throw this.missing(off, true, v);
  }
  // the next event: the overflow (counter past ARR) or a compare match ahead of it
  schedule() {
    this.ev = this.sched.cancel(this.ev);
    if (!this.running()) return;
    this.freeze();
    const c = this.cnt, per = this.period();
    let ticks = this.arrActive - c + 1, what = 'update';
    for (let k = 0; k < this.channels; k++) {
      const cc = this.ccr[k];
      if (cc > c && cc <= this.arrActive && cc - c < ticks && (this.dier & (2 << k))) { ticks = cc - c; what = `cc${k + 1}`; }
    }
    const at = this.t0 + ticks * per;
    this.ev = this.sched.at(at, () => { this.ev = null; this.fire(what, ticks, at); }, `${this.name} ${what}`);
  }
  fire(what, ticks, at) {
    this.cnt += ticks; this.t0 = at;
    if (what === 'update') {
      this.cnt = 0;
      const ue = this.rep === 0;
      this.rep = ue ? this.rcr : this.rep - 1;
      if (ue && !(this.cr1 & UDIS)) {
        this.sr |= UIF; this.pscActive = this.psc; this.arrActive = this.arr;
        if (this.cr1 & OPM) this.cr1 &= ~CEN;
      }
      for (let k = 0; k < this.channels; k++) if (this.ccr[k] === 0 && (this.dier & (2 << k))) this.sr |= 2 << k;
    } else this.sr |= 1 << Number(what.slice(2));
    this.update();
    this.schedule();
  }
  update() {
    const s = this.sr & this.dier;
    const up = !!(s & UIF), cc = !!(s & 0x1e);
    if (this.irqs.up === this.irqs.cc) this.irq(this.irqs.up, up || cc);
    else { this.irq(this.irqs.up, up); this.irq(this.irqs.cc, cc); }
  }
}
