// The STM32L4's DMA controllers (RM0394 section 11; DMA1 at 0x40020000, DMA2 at 0x40020400): ISR / IFCR, the seven
// channels' CCR / CNDTR / CPAR / CMAR and the request selection CSELR. A channel moves one item per request between
// its peripheral and memory addresses on the SCPU's bus (so a write to a peripheral's data register has the
// register's effects), with the sizes, increments, circular mode and memory-to-memory mode of CCR, and sets the
// half-transfer / transfer-complete flags with their interrupts (DMA1 channels IRQs 11..17, DMA2 channels 1..5 IRQs
// 56..60, 6 and 7 IRQs 68 and 69). A peripheral's request is a level (request(channel, sel, level)); while it is high
// and the channel is enabled with that request selected, one item moves per core cycle (I: arbitration and the bus
// timing are not modelled). The machine wires the requests it models (stm32l4.mjs); enabling a channel whose CSELR
// selects a request nothing drives throws Unmodelled. A bus error on a transfer sets TEIF and disables the channel.
import { Regs, Unmodelled, merge } from './regs.mjs';

export const ISR = 0x00, IFCR = 0x04, CSELR = 0xa8;
export const ccr = (ch) => 0x08 + 0x14 * (ch - 1);
const EN = 1, TCIE = 2, HTIE = 4, TEIE = 8, DIR = 16, CIRC = 32, PINC = 64, MINC = 128, MEM2MEM = 1 << 14;
const SIZE = [1, 2, 4, 4];

export class Dma extends Regs {
  // name, bus (read8/16/32, write8/16/32 of the machine), sched, irq, irqs[7]
  constructor({ name, bus, sched, irq, irqs }) {
    super(name);
    Object.assign(this, { bus, sched, irq, irqs });
    this.wired = new Set();                       // `${channel}:${sel}` that a model drives
    this.reset();
  }
  reset() {
    this.isr = 0; this.cselr = 0;
    this.ch = [];
    for (let i = 0; i <= 7; i++) this.ch.push({ ccr: 0, cndtr: 0, cpar: 0, cmar: 0, reload: 0, pa: 0, ma: 0, req: new Set(), ev: null, done: 0 });
    if (this.irq) for (let i = 1; i <= 7; i++) this.update(i);
  }
  // a peripheral's request line: channel, request number in CSELR, level
  wire(channel, sel) { this.wired.add(`${channel}:${sel}`); return (level) => this.request(channel, sel, level); }
  sel(channel) { return (this.cselr >>> (4 * (channel - 1))) & 15; }
  rd(off) {
    if (off === ISR) return this.isr;
    if (off === IFCR) return 0;
    if (off === CSELR) return this.cselr;
    const c = this.reg(off);
    if (!c) throw this.missing(off, false);
    const ch = this.ch[c.ch];
    return [ch.ccr, ch.cndtr, ch.cpar, ch.cmar][c.r];
  }
  reg(off) {
    if (off < 0x08 || off >= 0x08 + 0x14 * 7) return null;
    const k = off - 0x08, r = (k % 0x14) / 4;
    return r < 4 ? { ch: Math.floor(k / 0x14) + 1, r } : null;
  }
  wr(off, v, mask) {
    if (off === ISR) return;
    if (off === IFCR) {
      const w = v & mask;
      for (let i = 1; i <= 7; i++) {
        const sh = 4 * (i - 1);
        if ((w >>> sh) & 1) this.isr &= ~(15 << sh);              // CGIF clears all four
        else this.isr &= ~(w & (14 << sh));
        this.update(i);
      }
      return;
    }
    if (off === CSELR) { this.cselr = merge(this.cselr, v, mask, 0x0fffffff); return; }
    const c = this.reg(off);
    if (!c) throw this.missing(off, true, v);
    const ch = this.ch[c.ch];
    if (c.r === 0) {
      const was = ch.ccr & EN;
      ch.ccr = merge(ch.ccr, v, mask, 0x7fff);
      if (!was && (ch.ccr & EN)) this.enable(c.ch);
      if (was && !(ch.ccr & EN)) ch.ev = this.sched.cancel(ch.ev);
      this.update(c.ch);
      return;
    }
    if (ch.ccr & EN) return;                       // CNDTR / CPAR / CMAR are read-only while enabled
    if (c.r === 1) { ch.cndtr = merge(ch.cndtr, v, mask, 0xffff); ch.reload = ch.cndtr; }
    else if (c.r === 2) ch.cpar = merge(ch.cpar, v, mask);
    else ch.cmar = merge(ch.cmar, v, mask);
  }
  enable(i) {
    const ch = this.ch[i];
    ch.pa = ch.cpar; ch.ma = ch.cmar; ch.reload = ch.cndtr; ch.done = 0;
    if (ch.ccr & MEM2MEM) { this.kick(i); return; }
    const sel = this.sel(i);
    if (!this.wired.has(`${i}:${sel}`)) throw new Unmodelled(`${this.name} channel ${i} request ${sel}: no model drives it`);
    this.kick(i);
  }
  request(i, sel, level) {
    const ch = this.ch[i];
    if (level) ch.req.add(sel); else ch.req.delete(sel);
    if (level) this.kick(i);
  }
  active(i) {
    const ch = this.ch[i];
    return (ch.ccr & EN) && ch.cndtr > 0 && ((ch.ccr & MEM2MEM) || ch.req.has(this.sel(i)));
  }
  kick(i) {
    const ch = this.ch[i];
    if (ch.ev || !this.active(i)) return;
    ch.ev = this.sched.after(1, () => { ch.ev = null; this.service(i); }, `${this.name} ch${i}`);
  }
  service(i) {
    if (!this.active(i)) return;
    const ch = this.ch[i];
    const ps = SIZE[(ch.ccr >>> 8) & 3], ms = SIZE[(ch.ccr >>> 10) & 3];
    const fromMem = (ch.ccr & DIR) !== 0;
    try {
      // the source's item in its size; the destination takes it in its own size (RM0394 11.4.8: zero-extended or
      // truncated)
      const v = fromMem ? this.load(ch.ma, ms) : this.load(ch.pa, ps);
      if (fromMem) this.store(ch.pa, ps, v); else this.store(ch.ma, ms, v);
    } catch (e) {
      if (e.name !== 'BusError' && e.name !== 'Unmapped') throw e;
      this.isr |= 8 << (4 * (i - 1)); ch.ccr &= ~EN; this.update(i);
      return;
    }
    if (ch.ccr & PINC) ch.pa = (ch.pa + ps) >>> 0;
    if (ch.ccr & MINC) ch.ma = (ch.ma + ms) >>> 0;
    ch.cndtr--; ch.done++;
    const sh = 4 * (i - 1);
    if (ch.done === Math.floor(ch.reload / 2)) this.isr |= 4 << sh;    // HTIF
    if (ch.cndtr === 0) {
      this.isr |= 2 << sh;                                                // TCIF
      if (ch.ccr & CIRC) { ch.cndtr = ch.reload; ch.pa = ch.cpar; ch.ma = ch.cmar; ch.done = 0; }
    }
    this.update(i);
    this.kick(i);
  }
  load(a, size) { return size === 1 ? this.bus.read8(a) & 0xff : size === 2 ? this.bus.read16(a) & 0xffff : this.bus.read32(a) >>> 0; }
  store(a, size, v) { if (size === 1) this.bus.write8(a, v & 0xff); else if (size === 2) this.bus.write16(a, v & 0xffff); else this.bus.write32(a, v); }
  // the channel's flags (GIF = any of TC, HT, TE) and its interrupt
  update(i) {
    const sh = 4 * (i - 1), f = (this.isr >>> sh) & 14;
    this.isr = (this.isr & ~(1 << sh)) | (f ? 1 << sh : 0);
    const c = this.ch[i].ccr;
    this.irq(this.irqs[i - 1], !!(((c & TCIE) && (f & 2)) || ((c & HTIE) && (f & 4)) || ((c & TEIE) && (f & 8))));
  }
}
