// The STM32L4's timers (RM0394 sections 26..28; TIM1 at 0x40012c00, TIM2 at 0x40000000, TIM15 at 0x40014000, TIM16
// at 0x40014400) at register level: the up-counting edge-aligned counter through the prescaler, ARR with its preload
// (ARPE), PSC and the repetition counter (RCR) loaded at each update event, one-pulse mode, EGR.UG / TG, URS / UDIS, the
// update, capture / compare and trigger flags of output-compare channels (CCxIF when the counter reaches CCRx) and
// their interrupts, the slave mode controller and the trigger output (below). On the internal clock (RCC's timer
// clock, doubled when the APB prescaler is not 1) the counter is computed from the core's cycles; events are scheduled
// for the next update and for the compares of the channels whose interrupt is enabled (I: the flag of a channel whose
// interrupt is off is not set; the SCPU image enables CC1 on TIM15), at the clocks of the time they are scheduled (a
// clock change takes effect at the next).
//
// The slave mode controller (SMCR.SMS / TS, the timers' "slave mode" and synchronization sections of RM0394 26..28) on
// the timers that have one (`slave`: TIM1 and TIM2 with the encoder modes and ETR, TIM15 without either, TIM16 none).
// The trigger input TRGI is ITR0..3 (another timer's TRGO, as the machine wires them), TI1F_ED (each edge of TI1),
// TI1FP1 / TI2FP2 (TI1 / TI2 through the channel's CCxP polarity) or ETRF (ETR through SMCR.ETP). Reset mode: a TRGI
// rising edge reinitialises the counter as UG does; gated mode: the counter counts while TRGI is high; trigger mode: a
// rising edge sets CEN; reset + trigger mode: both; external clock mode 1: TRGI's rising edges, through the prescaler,
// clock the counter. TIF is set at each active edge, in gated mode at both. Encoder modes 1..3: the edges of TI1FP1
// (mode 1), TI2FP2 (mode 2) or both (mode 3) count up or down by the other input's level, CR1.DIR showing the
// direction (?: which of modes 1 and 2 counts on TI1 is taken from the HAL's TIM_ENCODERMODE_TI1 = SMS 1, as the RM
// texts read differ). The trigger output TRGO (CR2.MMS): reset (a pulse at UG or at the slave controller's reset),
// enable (the counter enable as a level, I: CEN, and in gated mode CEN with TRGI), update (a pulse at each update event).
// The inputs are the board's (input('TI1' | 'TI2' | 'ETR', level); I: the pins' alternate-function routing is not
// modelled) or the other timers' TRGO; the input filters (ICxF, ETF) and MSM pass every edge at once (I), the
// encoder modes count without the prescaler (I), and the prescaler's count is dropped when the gate closes (I).
// Not modelled, each throws Unmodelled when enabled or when it would act: down and centre-aligned counting outside the
// encoder modes, external clock mode 2 (SMCR.ECE), the ETR prescaler (ETPS), both-edge polarity on TI1FP1 / TI2FP2 as
// a trigger, gated mode on TI1F_ED, an ITR with no timer wired behind it, TRGO from compare pulses or OCxREF (MMS 3..7)
// when a slave uses it, DMA requests, break and the commutation events and their interrupts. What the channels drive
// on their pins (PWM, output compare modes) is not modelled, and nothing is ever captured.
import { Regs, Unmodelled, merge } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, SMCR = 0x08, DIER = 0x0c, SR = 0x10, EGR = 0x14, CCMR1 = 0x18, CCMR2 = 0x1c,
  CCER = 0x20, CNT = 0x24, PSC = 0x28, ARR = 0x2c, RCR = 0x30, CCR1 = 0x34, BDTR = 0x44, DCR = 0x48, DMAR = 0x4c,
  OR1 = 0x50, CCMR3 = 0x54, CCR5 = 0x58, CCR6 = 0x5c, OR2 = 0x60, OR3 = 0x64;
const CEN = 1, UDIS = 2, URS = 4, OPM = 8, DIR = 16, CMS = 0x60, ARPE = 128, UIF = 1, TIF = 64;
// SMCR.SMS (SMS[3] is bit 16)
export const SMS_ENC1 = 1, SMS_ENC3 = 3, SMS_RESET = 4, SMS_GATED = 5, SMS_TRIGGER = 6, SMS_EXT1 = 7, SMS_RESET_TRIGGER = 8;
const ECE = 1 << 14, ETPS = 3 << 12, ETP = 1 << 15;
const PLAIN = [CCMR1, CCMR2, CCER, BDTR, DCR, OR1, CCMR3, CCR5, CCR6, OR2, OR3];

export class Timer extends Regs {
  // name, bits (16 or 32), channels (number of CC channels), sched, irq, irqs {up, cc, trg} (IRQ numbers),
  // clockHz() / hclkHz(), slave: {encoder, etr} (what its slave mode controller has) or null (none)
  constructor({ name, bits = 16, channels = 4, sched, irq, irqs, clockHz, hclkHz, slave = { encoder: true, etr: true } }) {
    super(name);
    Object.assign(this, { bits, channels, sched, irq, irqs, clockHz, hclkHz, slave });
    this.max = bits === 32 ? 0xffffffff : 0xffff;
    this.itr = [null, null, null, null];          // the timers behind ITR0..3 (connect)
    this.trgoListeners = [];                      // (level) of TRGO, from the slaves' connect
    this.trgoUsers = [];                          // [slave, k]: the slaves that take TRGO as their ITRk
    this.reset();
  }
  reset() {
    this.cr1 = 0; this.cr2 = 0; this.smcr = 0; this.dier = 0; this.sr = 0;
    this.psc = 0; this.pscActive = 0; this.arr = this.max; this.arrActive = this.max; this.rcr = 0; this.rep = 0;
    this.ccr = [0, 0, 0, 0];
    this.r = new Map(PLAIN.map((o) => [o, 0]));
    this.cnt = 0; this.t0 = 0;                     // the counter's value at cycle t0 while running
    this.pscCount = 0;                            // TRGI edges into the prescaler (external clock mode 1)
    this.in = { TI1: 0, TI2: 0, ETR: 0 };         // the board's input levels
    this.itrLevel = [0, 0, 0, 0];
    this.trgi = 0;
    this.ev = this.sched ? this.sched.cancel(this.ev) : null;
    if (this.irq) { this.update(); this.emit(0); }
  }
  sms() { return (this.smcr & 7) | ((this.smcr >>> 13) & 8); }
  ts() { return (this.smcr >>> 4) & 7; }
  mms() { return (this.cr2 >>> 4) & 7; }
  encoder() { const s = this.sms(); return s >= SMS_ENC1 && s <= SMS_ENC3; }
  // the counter runs on the internal clock (all but the encoder and the external clock modes), and counts now
  internal() { const s = this.sms(); return s === 0 || (s >= SMS_RESET && s <= SMS_TRIGGER) || s === SMS_RESET_TRIGGER; }
  running() { return (this.cr1 & CEN) !== 0 && this.internal() && (this.sms() !== SMS_GATED || this.trgi === 1); }
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
  // a change that may start or stop the counting on the internal clock: fold the time so far, change, restart
  retime(change) {
    this.freeze();
    const was = this.running();
    change();
    if (was !== this.running()) this.t0 = this.sched.now();
    this.schedule();
  }
  rd(off) {
    switch (off) {
      case CR1: return this.cr1;
      case CR2: return this.cr2;
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
      case CR1:
        this.retime(() => {
          const enc = this.encoder(), dir = this.cr1 & DIR;   // in an encoder mode DIR is the hardware's
          this.cr1 = enc ? (merge(this.cr1, v, mask, 0x0bff & ~DIR) & ~DIR) | dir : merge(this.cr1, v, mask, 0x0bff);
          if ((this.cr1 & CMS) || (!enc && (this.cr1 & DIR))) throw new Unmodelled(`${this.name} down or centre-aligned counting (CR1 0x${this.cr1.toString(16)})`);
        });
        this.trgoEnable();
        return;
      case CR2:
        this.cr2 = merge(this.cr2, v, mask);
        if (this.trgoUsers.some(([t, k]) => t.uses(k))) this.trgoSupported();
        this.emit(this.mms() === 1 ? this.cnten() : 0);
        return;
      case SMCR: return this.writeSmcr(v, mask);
      case DIER: {
        this.dier = merge(this.dier, v, mask, 0x7fff);
        if (this.dier & 0x7f00) throw new Unmodelled(`${this.name} DMA requests (DIER 0x${this.dier.toString(16)})`);
        if (this.dier & 0xa0) throw new Unmodelled(`${this.name} commutation or break interrupts (DIER 0x${this.dier.toString(16)})`);
        this.freeze(); this.schedule(); this.update();
        return;
      }
      case SR: this.sr &= (v | ~mask); this.update(); return;          // rc_w0
      case EGR: {
        const g = v & mask;
        if (g & 1) this.reinit();                   // UG: reinitialise the counter, load the preloaded registers
        for (let k = 1; k <= this.channels; k++) if ((g >>> k) & 1) this.sr |= 1 << k;
        if (g & (1 << 6)) this.sr |= TIF;           // TG
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
  writeSmcr(v, mask) {
    if (!this.slave) {                              // no slave mode controller (TIM16): the register is not there
      if (v & mask) throw new Unmodelled(`${this.name} has no slave mode controller (SMCR 0x${(v >>> 0).toString(16)})`);
      return;
    }
    this.retime(() => {
      this.smcr = merge(this.smcr, v, mask, this.slave.etr ? 0x1ffff : 0x100f7);
      if (this.smcr & ECE) throw new Unmodelled(`${this.name} external clock mode 2 (SMCR.ECE)`);
      if (this.sms() !== 0) this.checkSlave();
      this.trgi = this.sms() && !this.encoder() ? this.trgiLevel() : 0;   // a new selection: the input's level, no edge (I)
    });
    this.trgoEnable();
  }
  // the slave mode controller's configuration, where the model stops
  checkSlave() {
    const sms = this.sms(), ts = this.ts();
    if (sms > SMS_RESET_TRIGGER) throw new Unmodelled(`${this.name} the reserved slave mode ${sms}`);
    if (sms >= SMS_ENC1 && sms <= SMS_ENC3) {
      if (!this.slave.encoder) throw new Unmodelled(`${this.name} has no encoder mode (SMS ${sms})`);
      this.polarity(1); this.polarity(2);
      return;
    }
    if (this.smcr & ETPS) throw new Unmodelled(`${this.name} the ETR prescaler (SMCR.ETPS)`);
    if (ts === 7 && !this.slave.etr) throw new Unmodelled(`${this.name} has no ETR (SMCR.TS 7)`);
    if (ts === 4 && sms === SMS_GATED) throw new Unmodelled(`${this.name} gated mode on TI1F_ED`);
    if (ts === 5) this.polarity(1);
    if (ts === 6) this.polarity(2);
    if (ts <= 3) {
      if (!this.itr[ts]) throw new Unmodelled(`${this.name} ITR${ts}: no timer wired behind it`);
      this.itr[ts].trgoSupported();
    }
  }
  // CCxP of input channel ch as a level inversion (CCxNP must be 0: both edges are not modelled as a trigger)
  polarity(ch) {
    const cc = (this.r.get(CCER) >>> (4 * (ch - 1))) & 0xf;
    if (cc & 8) throw new Unmodelled(`${this.name} CC${ch}NP: both-edge polarity on TI${ch}`);
    return (cc >>> 1) & 1;
  }
  // a slave using ITRk while its slave mode controller is on
  uses(k) { return this.sms() !== 0 && !this.encoder() && this.ts() === k; }
  trgoSupported() { if (this.mms() > 2) throw new Unmodelled(`${this.name} TRGO from compare pulses or OCxREF (CR2.MMS ${this.mms()}) used by a slave`); }

  // ---- the counter's events on the internal clock: the overflow (counter past ARR) or a compare match ahead of it
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
      this.overflow();
      this.compares();
    } else this.sr |= 1 << Number(what.slice(2));
    this.after();
    this.schedule();
  }
  // a wrap of the counter: the repetition counter, then the update event (UIF, the preloads, one-pulse's stop, TRGO)
  overflow() {
    const ue = this.rep === 0;
    this.rep = ue ? this.rcr : this.rep - 1;
    if (!ue || (this.cr1 & UDIS)) return;
    this.sr |= UIF; this.pscActive = this.psc; this.arrActive = this.arr;
    if (this.cr1 & OPM) this.cr1 &= ~CEN;
    this.pulse(2);
  }
  // the compare flags at the counter's value (of the channels whose interrupt is enabled, as on the internal clock)
  compares() {
    for (let k = 0; k < this.channels; k++) if (this.ccr[k] === this.cnt && (this.dier & (2 << k))) this.sr |= 2 << k;
  }
  // UG, or a reset by the slave controller: the counter and the prescaler's count reinitialised; the update event (the
  // preloads, and UIF unless URS) unless UDIS; TRGO's reset pulse
  reinit() {
    this.cnt = 0; this.t0 = this.sched.now(); this.pscCount = 0;
    if (!(this.cr1 & UDIS)) {
      this.pscActive = this.psc; this.arrActive = this.arr; this.rep = this.rcr;
      if (!(this.cr1 & URS)) this.sr |= UIF;
    }
    this.pulse(0);
  }
  // one count by an edge (external clock mode 1, the encoder modes), up or down, with CEN
  count(up) {
    if (!(this.cr1 & CEN)) return;
    if (up) { if (this.cnt >= this.arrActive) { this.cnt = 0; this.overflow(); } else this.cnt++; }
    else if (this.cnt === 0) { this.cnt = this.arrActive; this.overflow(); } else this.cnt--;
    this.compares();
  }

  // ---- the slave mode controller's inputs
  // the board's input levels: TI1 / TI2 (the channels' inputs) and ETR
  input(name, level) {
    if (!this.slave) throw new Unmodelled(`${this.name} input ${name}: no slave mode controller`);
    if (!(name in this.in) || (name === 'TI2' && this.channels < 2) || (name === 'ETR' && !this.slave.etr)) throw new Unmodelled(`${this.name} has no input ${name}`);
    level = level ? 1 : 0;
    if (this.in[name] === level) return;
    this.in[name] = level;
    if (!this.sms()) return;                        // slave mode off: the inputs reach nothing modelled
    if (this.encoder()) { if (name !== 'ETR') this.encoderEdge(name); return; }
    if (name === 'TI1' && this.ts() === 4) { this.trigger(1); this.trigger(0); return; }    // TI1F_ED: each edge
    this.trgiChanged();
  }
  // another timer's TRGO on ITRk
  itrInput(k, level) {
    this.itrLevel[k] = level;
    if (this.uses(k)) this.trgiChanged();
  }
  trgiLevel() {
    const ts = this.ts();
    if (ts <= 3) return this.itrLevel[ts];
    if (ts === 4) return 0;                         // TI1F_ED: pulses only
    if (ts === 5) return this.in.TI1 ^ this.polarity(1);
    if (ts === 6) return this.in.TI2 ^ this.polarity(2);
    return this.in.ETR ^ ((this.smcr & ETP) ? 1 : 0);
  }
  trgiChanged() { const level = this.trgiLevel(); if (level !== this.trgi) this.trigger(level); }
  // TRGI goes to `level`: the slave mode's action at its edge
  trigger(level) {
    const sms = this.sms();
    if (sms === SMS_GATED) {
      this.retime(() => { this.trgi = level; });
      this.sr |= TIF;
      this.after();
      return;
    }
    this.trgi = level;
    if (!level) return;                             // the other modes act on rising edges
    switch (sms) {
      case SMS_RESET: this.reinit(); this.schedule(); break;
      case SMS_TRIGGER: if (!(this.cr1 & CEN)) this.retime(() => { this.cr1 |= CEN; }); break;
      case SMS_RESET_TRIGGER: this.reinit(); if (!(this.cr1 & CEN)) this.retime(() => { this.cr1 |= CEN; }); else this.schedule(); break;
      case SMS_EXT1:
        if ((this.cr1 & CEN) && ++this.pscCount > this.pscActive) { this.pscCount = 0; this.count(true); }
        break;
      default: return;                              // slave mode off: TRGI does nothing
    }
    this.sr |= TIF;
    this.after();
  }
  // an edge of TI1 or TI2 in an encoder mode (the input already changed): mode 1 counts TI1FP1's edges, mode 2
  // TI2FP2's, mode 3 both; up or down by the edge and the other input's level (the RM's encoder counting table)
  encoderEdge(name) {
    const sms = this.sms(), t1 = this.in.TI1 ^ this.polarity(1), t2 = this.in.TI2 ^ this.polarity(2);
    let up;
    if (name === 'TI1') { if (!(sms & 1)) return; up = t1 !== t2; }    // TI1FP1 rising counts up while TI2FP2 is low
    else { if (!(sms & 2)) return; up = t1 === t2; }                   // TI2FP2 rising counts up while TI1FP1 is high
    this.cr1 = up ? this.cr1 & ~DIR : this.cr1 | DIR;
    this.count(up);
    this.after();
  }

  // ---- TRGO and the internal trigger connections
  // this timer's ITRk is `master`'s TRGO (the machine's wiring)
  connect(k, master) {
    this.itr[k] = master;
    master.trgoUsers.push([this, k]);
    master.trgoListeners.push((level) => this.itrInput(k, level));
  }
  // the counter enable signal (TRGO with MMS 1)
  cnten() { return (this.cr1 & CEN) && (this.sms() !== SMS_GATED || this.trgi === 1) ? 1 : 0; }
  emit(level) {
    if (level === this.trgoOut) return;
    this.trgoOut = level;
    for (const f of this.trgoListeners) f(level);
  }
  // a pulse on TRGO when CR2.MMS selects `mms` (0 reset, 2 update)
  pulse(mms) { if (this.mms() === mms && this.trgoListeners.length) { this.emit(1); this.emit(0); } }
  // TRGO's level when it is the counter enable (MMS 1)
  trgoEnable() { if (this.mms() === 1) this.emit(this.cnten()); }
  // after a change of the flags and maybe of the counter enable: TRGO's enable level, the interrupt lines
  after() { this.trgoEnable(); this.update(); }
  update() {
    const s = this.sr & this.dier, lines = new Map();
    const or = (n, on) => { if (n !== undefined) lines.set(n, (lines.get(n) || false) || on); };
    or(this.irqs.up, (s & UIF) !== 0); or(this.irqs.cc, (s & 0x1e) !== 0); or(this.irqs.trg, (s & TIF) !== 0);
    for (const [n, on] of lines) this.irq(n, on);
  }
}
