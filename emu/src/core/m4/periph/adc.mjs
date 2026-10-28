// The STM32L4's ADC1 (RM0394 section 16, at 0x50040000, common registers at +0x300) at register level: the power-up
// sequence (DEEPPWD, ADVREGEN, ADEN -> ISR.ADRDY, ADDIS), calibration (ADCAL clears at once, CALFACT 0), and regular
// conversions started by software (ADSTART with CFGR.EXTEN 0): the sequence SQR1..SQR4 converted one channel at a time,
// each result in DR with EOC (and EOS after the last), CONT repeating the sequence, OVR when a result finds EOC still
// set, DMA requests when CFGR.DMAEN, the interrupt (IRQ 18) from ISR & IER. A conversion takes a fixed CONV_CYCLES
// core cycles (I: sampling time and the ADC clock are not modelled). Injected conversions, hardware triggers,
// watchdogs' thresholds and oversampling are not modelled (Unmodelled when started or enabled). What each channel
// reads is the board's: analog(channel) gives a 12-bit value; the default reads 0 on every channel (?: the SCPU's
// analog inputs, battery temperature among them, docs/om1-scpu-spec.md section 4.2, are not known).
import { Regs, Unmodelled, merge } from './regs.mjs';

export const ISR = 0x00, IER = 0x04, CR = 0x08, CFGR = 0x0c, CFGR2 = 0x10, SMPR1 = 0x14, SMPR2 = 0x18, TR1 = 0x20,
  TR2 = 0x24, TR3 = 0x28, SQR1 = 0x30, SQR2 = 0x34, SQR3 = 0x38, SQR4 = 0x3c, DR = 0x40, JSQR = 0x4c, OFR1 = 0x60,
  JDR1 = 0x80, AWD2CR = 0xa0, AWD3CR = 0xa4, DIFSEL = 0xb0, CALFACT = 0xb4, CSR = 0x300, CCR = 0x308, CDR = 0x30c;
const ADRDY = 1, EOSMP = 2, EOC = 4, EOS = 8, OVR = 16;
const ADEN = 1, ADDIS = 2, ADSTART = 4, JADSTART = 8, ADSTP = 16, JADSTP = 32, ADCAL = 1 << 31;
export const CONV_CYCLES = 200;

const PLAIN = [CFGR2, SMPR1, SMPR2, TR1, TR2, TR3, SQR1, SQR2, SQR3, SQR4, JSQR, OFR1, OFR1 + 4, OFR1 + 8, OFR1 + 12,
  AWD2CR, AWD3CR, DIFSEL, CALFACT, CCR];

export class Adc extends Regs {
  constructor({ sched, irq, analog = () => 0 }) {
    super('ADC');
    this.sched = sched; this.irq = irq; this.analog = analog;
    this.dmaRequest = null;                      // (level) -> the DMA channel's request line
    this.reset();
  }
  reset() {
    this.isr = 0; this.ier = 0; this.cr = 0x20000000; this.cfgr = 0x80000000; this.dr = 0;
    this.r = new Map(PLAIN.map((o) => [o, 0]));
    this.r.set(TR1, 0x0fff0000); this.r.set(TR2, 0x00ff0000); this.r.set(TR3, 0x00ff0000);
    this.ev = this.sched ? this.sched.cancel(this.ev) : null;
    this.seq = 0;
    if (this.irq) this.update();
  }
  sequence() {
    const q = [this.r.get(SQR1), this.r.get(SQR2), this.r.get(SQR3), this.r.get(SQR4)];
    const n = (q[0] & 15) + 1, out = [];
    for (let i = 0; i < n; i++) {
      const k = i + 1, reg = Math.floor(k / 5), pos = k % 5;     // SQ1..4 in SQR1 from bit 6; SQ5.. from bit 0
      out.push((q[reg] >>> (reg === 0 ? 6 * k : 6 * pos)) & 0x1f);
    }
    return out;
  }
  rd(off) {
    switch (off) {
      case ISR: return this.isr;
      case IER: return this.ier;
      case CR: return this.cr;
      case CFGR: return this.cfgr;
      case DR: { const v = this.dr; this.isr &= ~EOC; if (this.dmaRequest) this.dmaRequest(false); this.update(); return v; }
      case JDR1: case JDR1 + 4: case JDR1 + 8: case JDR1 + 12: return 0;
      case CSR: return this.isr & 0x7ff;
      case CDR: return this.dr;
    }
    if (this.r.has(off)) return this.r.get(off);
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    v &= mask;
    switch (off) {
      case ISR: this.isr &= ~v; this.update(); return;
      case IER: this.ier = v & 0x7ff; this.update(); return;
      case CR: return this.writeCr(v);
      case CFGR:
        this.cfgr = merge(this.cfgr, v, mask);
        return;
      case DR: case CSR: case CDR: return;
    }
    if (this.r.has(off)) { this.r.set(off, merge(this.r.get(off), v, mask)); return; }
    throw this.missing(off, true, v);
  }
  writeCr(v) {
    let cr = this.cr;
    cr = (cr & ~(0x30000000 | (1 << 30))) | (v & (0x30000000 | (1 << 30)));   // DEEPPWD, ADVREGEN, ADCALDIF
    if (v & ADCAL) { /* calibration completes at once; CALFACT stays */ }
    if (v & ADEN) { cr |= ADEN; this.isr |= ADRDY; }
    if (v & ADDIS) { cr &= ~(ADEN | ADSTART); this.ev = this.sched.cancel(this.ev); }
    if (v & (JADSTART | JADSTP)) throw new Unmodelled('ADC injected conversions');
    if (v & ADSTP) { cr &= ~ADSTART; this.ev = this.sched.cancel(this.ev); }
    this.cr = cr;
    if ((v & ADSTART) && (cr & ADEN) && !(cr & ADSTART)) {
      if ((this.cfgr >>> 10) & 3) throw new Unmodelled('ADC hardware trigger (CFGR.EXTEN)');
      this.cr |= ADSTART; this.seq = 0;
      this.ev = this.sched.after(CONV_CYCLES, () => this.convert(), 'ADC conversion');
    }
    this.update();
  }
  convert() {
    this.ev = null;
    const seq = this.sequence(), ch = seq[this.seq];
    const res = (this.cfgr >>> 3) & 3, bits = 12 - 2 * res;
    let val = (this.analog(ch) & 0xfff) >>> (12 - bits);
    if (this.cfgr & (1 << 5)) val = bits === 6 ? (val << 2) : (val << (16 - bits));   // ALIGN left
    const overrun = (this.isr & EOC) !== 0;
    if (overrun) this.isr |= OVR;
    if (!overrun || (this.cfgr & (1 << 12))) this.dr = val;                         // OVRMOD 0: DR kept
    this.isr |= EOC | EOSMP;
    this.seq++;
    if (this.seq >= seq.length) {
      this.isr |= EOS; this.seq = 0;
      if (!(this.cfgr & (1 << 13))) this.cr &= ~ADSTART;                  // single mode: ADSTART clears
    }
    if (this.cfgr & 1 && this.dmaRequest) this.dmaRequest(true);
    if (this.cr & ADSTART) this.ev = this.sched.after(CONV_CYCLES, () => this.convert(), 'ADC conversion');
    this.update();
  }
  update() { this.irq(18, (this.isr & this.ier & 0x7ff) !== 0); }
}
