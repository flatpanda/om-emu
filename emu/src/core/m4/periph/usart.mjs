// The STM32L4's USART and LPUART (RM0394 sections 38 and 39; USART1 at 0x40013800, USART2 at 0x40004400, LPUART1 at
// 0x40008000) at register level, asynchronous mode: CR1..CR3, BRR, GTPR / RTOR (USART only), RQR, ISR with ICR, RDR /
// TDR. Transmit: TDR moves to the shift register when it is empty (TXE set again at once), each frame takes its time on
// the line (start bit, the word of CR1.M with parity, CR2.STOP's stop bits, at the rate BRR gives from the kernel
// clock: USARTDIV with OVER8 for a USART, 256 * fck / BRR for the LPUART), the frame's word (with PCE its top bit the
// parity the hardware computes) goes to the board's line (onTx(word)) at the frame's end, and TC sets when the shift
// register empties with TDR empty. Receive: the board's bytes (receive(bytes)) arrive one frame time apart while RE is
// set; a byte waits while RXNE is still set (I: the far end is never overrun; the line's own pace is not modelled for
// a slow reader), IDLE sets one frame after the last. TEACK / REACK follow TE / RE at once while UE is set (I).
// Interrupts from ISR and the enables of CR1 / CR3; DMA requests (CR3.DMAT while TXE, DMAR while RXNE) where the
// machine wired a channel (else Unmodelled). Not modelled: synchronous, smartcard, IrDA, LIN, RS-485 driver enable,
// auto baud rate, the receiver timeout, character match, wake-up from stop, hardware flow control (each throws
// Unmodelled when enabled).
import { Regs, Unmodelled, merge } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, CR3 = 0x08, BRR = 0x0c, GTPR = 0x10, RTOR = 0x14, RQR = 0x18, ISR = 0x1c,
  ICR = 0x20, RDR = 0x24, TDR = 0x28;
export const PE = 1, FE = 2, NF = 4, ORE = 8, IDLE = 16, RXNE = 32, TC = 64, TXE = 128, BUSY = 1 << 16, TEACK = 1 << 21,
  REACK = 1 << 22;
const UE = 1, RE = 4, TE = 8;

export class Usart extends Regs {
  // name, lp (an LPUART), sched, irq, irqn, kernelHz() / hclkHz(), onTx(byte)
  constructor({ name, lp = false, sched, irq, irqn, kernelHz, hclkHz, onTx = () => {} }) {
    super(name);
    Object.assign(this, { lp, sched, irq, irqn, kernelHz, hclkHz, onTx });
    this.dmaTx = null; this.dmaRx = null;
    this.rxQueue = [];
    this.reset();
  }
  reset() {
    this.cr1 = 0; this.cr2 = 0; this.cr3 = 0; this.brr = 0; this.gtpr = 0; this.rtor = 0;
    this.isr = TXE | TC; this.rdr = 0; this.tdr = 0; this.tdrFull = false; this.shifting = false;
    if (this.sched) { this.txEv = this.sched.cancel(this.txEv); this.rxEv = this.sched.cancel(this.rxEv); this.idleEv = this.sched.cancel(this.idleEv); }
    this.rxQueue = [];
    if (this.irq) this.update();
  }
  // the time of one frame in core cycles
  frameCycles() {
    const m = ((this.cr1 >>> 28) & 1) * 2 + ((this.cr1 >>> 12) & 1);   // M1 M0: 0 = 8 bits, 1 = 9, 2 = 7
    const word = m === 1 ? 9 : m === 2 ? 7 : 8;
    const stop = [1, 0.5, 2, 1.5][(this.cr2 >>> 12) & 3];
    const fck = this.kernelHz();
    let baud;
    if (this.lp) baud = this.brr ? 256 * fck / this.brr : 0;
    else {
      const div = this.cr1 & (1 << 15) ? ((this.brr & 0xfff0) | ((this.brr & 7) << 1)) / 2 : this.brr;
      baud = div ? fck / div : 0;
    }
    if (!baud) return 1e6;
    return Math.max(1, Math.round((1 + word + stop) * this.hclkHz() / baud));
  }
  rd(off) {
    switch (off) {
      case CR1: return this.cr1;
      case CR2: return this.cr2;
      case CR3: return this.cr3;
      case BRR: return this.brr;
      case GTPR: if (this.lp) break; return this.gtpr;
      case RTOR: if (this.lp) break; return this.rtor;
      case RQR: return 0;
      case ISR: return this.isr;
      case ICR: return 0;
      case RDR: { const v = this.rdr; if (this.isr & RXNE) this.taken(); return v; }
      case TDR: return this.tdr;
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    switch (off) {
      case CR1: {
        this.cr1 = merge(this.cr1, v, mask, this.lp ? 0x10003fff : 0x1fffffff);
        if (this.cr1 & ((1 << 26) | (1 << 27) | (1 << 14) | (1 << 1))) throw new Unmodelled(`${this.name} receiver timeout, end of block, character match or wake-up (CR1 0x${this.cr1.toString(16)})`);
        this.enables();
        return;
      }
      case CR2: this.cr2 = merge(this.cr2, v, mask); if (this.cr2 & ((1 << 11) | (1 << 14) | (1 << 20))) throw new Unmodelled(`${this.name} synchronous, LIN or auto baud rate (CR2 0x${this.cr2.toString(16)})`); return;
      case CR3:
        this.cr3 = merge(this.cr3, v, mask);
        if (this.cr3 & ((1 << 1) | (1 << 3) | (1 << 5) | (1 << 8) | (1 << 9) | (1 << 14))) throw new Unmodelled(`${this.name} IrDA, half duplex, smartcard, flow control or driver enable (CR3 0x${this.cr3.toString(16)})`);
        if (((this.cr3 & (1 << 7)) && !this.dmaTx) || ((this.cr3 & (1 << 6)) && !this.dmaRx)) throw new Unmodelled(`${this.name} DMA requests (no channel wired)`);
        this.dmaLines(); this.update();
        return;
      case BRR: this.brr = merge(this.brr, v, mask, this.lp ? 0xfffff : 0xffff); return;
      case GTPR: if (this.lp) break; this.gtpr = merge(this.gtpr, v, mask, 0xffff); return;
      case RTOR: if (this.lp) break; this.rtor = merge(this.rtor, v, mask); return;
      case RQR:
        if (v & mask & 8) { this.isr &= ~RXNE; this.taken(); }       // RXFRQ: drop the received byte
        if (v & mask & 0x7) throw new Unmodelled(`${this.name} request 0x${(v & 7).toString(16)} (auto baud, break, mute)`);
        this.update();
        return;
      case ISR: case RDR: return;
      case ICR: this.isr &= ~(v & mask & 0x00121b5f); this.update(); return;
      case TDR: this.writeTdr(v & 0x1ff); return;
    }
    throw this.missing(off, true, v);
  }
  enables() {
    const on = (this.cr1 & UE) !== 0;
    this.isr = (this.isr & ~(TEACK | REACK)) | (on && (this.cr1 & TE) ? TEACK : 0) | (on && (this.cr1 & RE) ? REACK : 0);
    if (!on) {                                    // UE = 0: the transfers stop, the status returns to its reset state
      this.txEv = this.sched.cancel(this.txEv); this.rxEv = this.sched.cancel(this.rxEv); this.idleEv = this.sched.cancel(this.idleEv);
      this.shifting = false; this.tdrFull = false;
      this.isr = (this.isr & ~(RXNE | ORE | IDLE | FE | PE | NF | BUSY)) | TXE | TC;
    } else this.pump();
    this.dmaLines(); this.update();
  }
  writeTdr(v) {
    this.tdr = v;
    if (!(this.cr1 & UE) || !(this.cr1 & TE)) return;
    this.tdrFull = true; this.isr &= ~(TXE | TC);
    this.startTx();
    this.dmaLines(); this.update();
  }
  // the frame's data on the line: the word of CR1.M, its top bit the parity when CR1.PCE (even, or odd with PS)
  wire(v) {
    const m = ((this.cr1 >>> 28) & 1) * 2 + ((this.cr1 >>> 12) & 1), word = m === 1 ? 9 : m === 2 ? 7 : 8;
    if (!(this.cr1 & (1 << 10))) return v & ((1 << word) - 1);
    const data = v & ((1 << (word - 1)) - 1);
    let ones = 0;
    for (let x = data; x; x >>>= 1) ones += x & 1;
    return data | (((ones & 1) ^ ((this.cr1 >>> 9) & 1)) << (word - 1));
  }
  startTx() {
    if (this.shifting || !this.tdrFull) return;
    const byte = this.wire(this.tdr);
    this.tdrFull = false; this.isr |= TXE; this.shifting = true;
    this.txEv = this.sched.after(this.frameCycles(), () => {
      this.txEv = null; this.shifting = false;
      this.onTx(byte);
      if (this.tdrFull) this.startTx(); else this.isr |= TC;
      this.dmaLines(); this.update();
    }, `${this.name} tx`);
  }

  // ---- the board's side of the receive line
  receive(bytes) { for (const b of bytes) this.rxQueue.push(b & 0x1ff); this.pump(); }
  pump() {
    if (this.rxEv || !this.rxQueue.length || !(this.cr1 & UE) || !(this.cr1 & RE) || (this.isr & RXNE)) return;
    this.idleEv = this.sched.cancel(this.idleEv);
    this.isr |= BUSY;
    this.rxEv = this.sched.after(this.frameCycles(), () => {
      this.rxEv = null;
      if (!(this.cr1 & UE) || !(this.cr1 & RE)) return;
      this.rdr = this.rxQueue.shift();
      this.isr |= RXNE; this.isr &= ~BUSY;
      if (!this.rxQueue.length) this.idleEv = this.sched.after(this.frameCycles(), () => { this.idleEv = null; this.isr |= IDLE; this.update(); }, `${this.name} idle`);
      this.dmaLines(); this.update();
    }, `${this.name} rx`);
  }
  taken() { this.isr &= ~RXNE; this.dmaLines(); this.update(); this.pump(); }
  dmaLines() {
    if (this.dmaTx) this.dmaTx((this.cr3 & (1 << 7)) !== 0 && (this.isr & TXE) !== 0 && (this.cr1 & TE) !== 0 && (this.cr1 & UE) !== 0);
    if (this.dmaRx) this.dmaRx((this.cr3 & (1 << 6)) !== 0 && (this.isr & RXNE) !== 0);
  }
  update() {
    const c1 = this.cr1, c3 = this.cr3, s = this.isr;
    const on = ((c1 & (1 << 8)) && (s & PE)) || ((c1 & (1 << 7)) && (s & TXE)) || ((c1 & (1 << 6)) && (s & TC)) ||
      ((c1 & (1 << 5)) && (s & (RXNE | ORE))) || ((c1 & (1 << 4)) && (s & IDLE)) || ((c3 & 1) && (s & (FE | NF | ORE)));
    this.irq(this.irqn, !!on);
  }
}
