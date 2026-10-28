// The STM32L4's SPI (RM0394 section 40; SPI2 at 0x40003800) in slave mode at register level: CR1 / CR2, SR with the
// FIFO levels, DR with data packing (a byte access moves one frame of up to 8 bits, a halfword access two), the
// 32-bit transmit and receive FIFOs with TXE (transmit FIFO at most half full), RXNE (by FRXTH, one byte or two),
// OVR when the receive FIFO is full, the interrupt (SPI2 IRQ 36) and the DMA requests (TXDMAEN while TXE, RXDMAEN
// while RXNE). The master is the board's: exchange(byte) clocks one frame, the slave shifting out its transmit FIFO's
// head (0 when it is empty, I: the underrun pattern is not modelled) and taking the master's byte into its receive
// FIFO. With no master (this step) nothing is ever clocked: the transmit FIFO fills and stays full. Master mode, CRC,
// TI mode, frames other than 8 bits and bidirectional mode throw Unmodelled.
import { Regs, Unmodelled, merge } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, SR = 0x08, DR = 0x0c, CRCPR = 0x10, RXCRCR = 0x14, TXCRCR = 0x18;
const RXNE = 1, TXE = 2, OVR = 64, BSY = 128, SPE = 64;

export class Spi extends Regs {
  constructor({ name, irq, irqn }) {
    super(name);
    Object.assign(this, { irq, irqn });
    this.dmaTx = null; this.dmaRx = null;
    this.reset();
  }
  reset() {
    this.cr1 = 0; this.cr2 = 0x0700; this.crcpr = 7; this.ovr = false;
    this.txf = []; this.rxf = [];
    if (this.irq) this.update();
  }
  sr() {
    const rxThreshold = this.cr2 & (1 << 12) ? 1 : 2;
    let s = 0;
    if (this.rxf.length >= rxThreshold) s |= RXNE;
    if (this.txf.length <= 2) s |= TXE;
    if (this.ovr) s |= OVR;
    s |= Math.min(this.rxf.length, 3) << 9;      // FRLVL
    s |= Math.min(this.txf.length, 3) << 11;     // FTLVL
    return s;
  }
  rd(off, size) {
    switch (off) {
      case CR1: return this.cr1;
      case CR2: return this.cr2;
      case SR: return this.sr();
      case DR: {
        const n = size === 1 ? 1 : 2;
        let v = 0;
        for (let i = 0; i < n; i++) v |= (this.rxf.length ? this.rxf.shift() : 0) << (8 * i);
        this.lines();
        return v;
      }
      case CRCPR: return this.crcpr;
      case RXCRCR: case TXCRCR: return 0;
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    switch (off) {
      case CR1: {
        this.cr1 = merge(this.cr1, v, mask, 0xffff);
        if (this.cr1 & ((1 << 2) | (1 << 13) | (1 << 15))) throw new Unmodelled(`${this.name} master, CRC or bidirectional mode (CR1 0x${this.cr1.toString(16)})`);
        if (!(this.cr1 & SPE)) { this.ovr = false; }
        this.lines();
        return;
      }
      case CR2: {
        this.cr2 = merge(this.cr2, v, mask, 0x7fff);
        if (((this.cr2 >>> 8) & 15) !== 7 || (this.cr2 & (1 << 4))) throw new Unmodelled(`${this.name} frames other than 8-bit Motorola (CR2 0x${this.cr2.toString(16)})`);
        this.lines();
        return;
      }
      case SR: this.ovr = this.ovr && !!(v & OVR); return;   // CRCERR is the only writable bit; OVR clears by reading
      case DR: {
        const n = mask === 0xff || mask === 0xff00 || mask === 0xff0000 || mask === 0xff000000 ? 1 : 2;
        for (let i = 0; i < n; i++) if (this.txf.length < 4) this.txf.push((v >>> (8 * i)) & 0xff);
        this.lines();
        return;
      }
      case CRCPR: this.crcpr = merge(this.crcpr, v, mask, 0xffff); return;
      case RXCRCR: case TXCRCR: return;
    }
    throw this.missing(off, true, v);
  }
  // the master clocks one frame: the slave's byte out, the master's in
  exchange(byte) {
    if (!(this.cr1 & SPE)) return 0;
    const out = this.txf.length ? this.txf.shift() : 0;
    if (this.cr1 & (1 << 10)) { /* RXONLY: still receives */ }
    if (this.rxf.length >= 4) this.ovr = true; else this.rxf.push(byte & 0xff);
    this.lines();
    return out;
  }
  lines() {
    const s = this.sr(), on = (this.cr1 & SPE) !== 0;
    if (this.dmaTx) this.dmaTx(on && (this.cr2 & 2) !== 0 && (s & TXE) !== 0);
    if (this.dmaRx) this.dmaRx(on && (this.cr2 & 1) !== 0 && (s & RXNE) !== 0);
    this.update();
  }
  update() {
    const c = this.cr2, s = this.sr();
    this.irq(this.irqn, !!(((c & (1 << 7)) && (s & TXE)) || ((c & (1 << 6)) && (s & RXNE)) || ((c & (1 << 5)) && (s & OVR))));
  }
}
