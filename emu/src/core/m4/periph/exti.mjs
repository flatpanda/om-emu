// The STM32L4's EXTI controller (RM0394 section 14, at 0x40010400) and SYSCFG (section 9, at 0x40010000) as far as
// EXTI needs it. EXTI: the interrupt masks, edge selections, software triggers and pending registers of lines 0..31
// and 32..40 (IMR2 .. PR2); a GPIO edge on line n (SYSCFG_EXTICR selects the port of each of lines 0..15) or an
// internal line's rising edge (the RTC's alarm on 18, tamper / timestamp on 19, wake-up timer on 20, from rtc.mjs)
// sets the line's pending bit when its edge is selected, and the NVIC line of its group follows the OR of pending and
// unmasked (lines 0..4 IRQs 6..10, 5..9 IRQ 23, 10..15 IRQ 40, 16 IRQ 1, 18 IRQ 41, 19 IRQ 2, 20 IRQ 3). A selected
// edge, or a software trigger, on a configurable line whose EMR bit is set also sends an event to the core (onEvent(n):
// the machine's event input, which ends a WFE and with it a Stop mode entered by WFE; RM0394 section 14's event
// mode and 5.3.6..5.3.8). The direct lines (17, 23 .. 40: USB, I2C wake-up, UARTs, LPTIM) raise nothing here: in a
// Stop mode the peripherals that run there wake the core with their own interrupts (stm32l4.mjs; I: the direct
// lines' masks are not consulted).
import { Regs, merge } from './regs.mjs';

export const IMR1 = 0x00, EMR1 = 0x04, RTSR1 = 0x08, FTSR1 = 0x0c, SWIER1 = 0x10, PR1 = 0x14,
  IMR2 = 0x20, EMR2 = 0x24, RTSR2 = 0x28, FTSR2 = 0x2c, SWIER2 = 0x30, PR2 = 0x34;
// the configurable lines and their NVIC IRQs
const LINE_IRQ = [6, 7, 8, 9, 10, 23, 23, 23, 23, 23, 40, 40, 40, 40, 40, 40, 1, -1, 41, 2, 3];
const CONFIGURABLE = 0x007dffff;                   // lines 0..16, 18..22 (RM0394 table 52: 17 is direct); 21, 22 comparators

export class Exti extends Regs {
  constructor(irq) {
    super('EXTI');
    this.irq = irq;                                  // irq(n, level)
    this.syscfg = null;
    this.onEvent = null;                             // onEvent(line): an event to the core
    this.reset();
  }
  reset() {
    this.imr = [0xff820000, 0x00000087]; this.emr = [0, 0]; this.rtsr = [0, 0]; this.ftsr = [0, 0]; this.pr = [0, 0];
    this.lines = 0;                                  // the internal lines' levels
    if (this.irq) this.refresh();
  }
  rd(off) {
    switch (off) {
      case IMR1: return this.imr[0]; case EMR1: return this.emr[0]; case RTSR1: return this.rtsr[0];
      case FTSR1: return this.ftsr[0]; case SWIER1: return 0; case PR1: return this.pr[0];
      case IMR2: return this.imr[1]; case EMR2: return this.emr[1]; case RTSR2: return this.rtsr[1];
      case FTSR2: return this.ftsr[1]; case SWIER2: return 0; case PR2: return this.pr[1];
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    switch (off) {
      case IMR1: this.imr[0] = merge(this.imr[0], v, mask); break;
      case EMR1: this.emr[0] = merge(this.emr[0], v, mask); break;
      case RTSR1: this.rtsr[0] = merge(this.rtsr[0], v, mask, CONFIGURABLE); break;
      case FTSR1: this.ftsr[0] = merge(this.ftsr[0], v, mask, CONFIGURABLE); break;
      case SWIER1: this.pr[0] = (this.pr[0] | (v & mask & CONFIGURABLE)) >>> 0; this.events(v & mask & CONFIGURABLE); break;
      case PR1: this.pr[0] = (this.pr[0] & ~(v & mask)) >>> 0; break;
      case IMR2: this.imr[1] = merge(this.imr[1], v, mask, 0xff); break;
      case EMR2: this.emr[1] = merge(this.emr[1], v, mask, 0xff); break;
      case RTSR2: this.rtsr[1] = merge(this.rtsr[1], v, mask, 0x78); break;
      case FTSR2: this.ftsr[1] = merge(this.ftsr[1], v, mask, 0x78); break;
      case SWIER2: this.pr[1] = (this.pr[1] | (v & mask & 0x78)) >>> 0; break;
      case PR2: this.pr[1] = (this.pr[1] & ~(v & mask)) >>> 0; break;
      default: throw this.missing(off, true, v);
    }
    this.refresh();
  }
  // an edge on line n (0..31)
  edge(n, rising) {
    const bit = (1 << n) >>> 0;
    if (!(CONFIGURABLE & bit)) return;
    if ((rising ? this.rtsr[0] : this.ftsr[0]) & bit) { this.pr[0] = (this.pr[0] | bit) >>> 0; this.refresh(); this.events(bit); }
  }
  // the events of the lines in `bits` whose EMR bit is set
  events(bits) {
    const ev = (bits & this.emr[0]) >>> 0;
    if (!ev || !this.onEvent) return;
    for (let n = 0; n < 32; n++) if ((ev >>> n) & 1) this.onEvent(n);
  }
  // a GPIO pin's change: line `pin` when SYSCFG selects its port
  gpio(port, pin, level) {
    if (this.syscfg && this.syscfg.extiPort(pin) !== port) return;
    this.edge(pin, level === 1);
  }
  // an internal line's level (16, 18, 19, 20)
  line(n, level) {
    const bit = 1 << n, old = (this.lines & bit) !== 0;
    this.lines = level ? this.lines | bit : this.lines & ~bit;
    if (level !== old) this.edge(n, level);
  }
  refresh() {
    const act = this.pr[0] & this.imr[0];
    const want = new Map();
    LINE_IRQ.forEach((irq, n) => { if (irq >= 0) want.set(irq, (want.get(irq) || 0) | ((act >>> n) & 1)); });
    for (const [irq, high] of want) this.irq(irq, high === 1);
  }
}

// SYSCFG (RM0394 section 9.2): MEMRMP, CFGR1, EXTICR1..4, SCSR, CFGR2, SWPR, SKR, as plain registers; EXTICR selects
// the port of each EXTI line 0..15 (0 = A .. 7 = H).
export const MEMRMP = 0x00, CFGR1 = 0x04, EXTICR1 = 0x08, SCSR = 0x18, CFGR2 = 0x1c, SWPR = 0x20, SKR = 0x24;
export class Syscfg extends Regs {
  constructor() { super('SYSCFG'); this.reset(); }
  reset() { this.r = new Map([[MEMRMP, 0], [CFGR1, 0x7c000001], [0x08, 0], [0x0c, 0], [0x10, 0], [0x14, 0], [SCSR, 0], [CFGR2, 0], [SWPR, 0], [SKR, 0]]); }
  extiPort(line) { return (this.r.get(EXTICR1 + 4 * (line >> 2)) >>> (4 * (line & 3))) & 7; }
  rd(off) { if (!this.r.has(off)) throw this.missing(off, false); return off === SKR ? 0 : this.r.get(off); }
  wr(off, v, mask) {
    if (!this.r.has(off)) throw this.missing(off, true, v);
    const writable = off >= EXTICR1 && off < SCSR ? 0xffff : 0xffffffff;
    this.r.set(off, merge(this.r.get(off), v, mask, writable));
  }
}
