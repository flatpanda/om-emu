// The STM32L4's USB full-speed device (RM0394 section 45, at 0x40006800; its packet memory at 0x40006c00) as a stub
// with no host on the bus (I: what the device is for is ?, docs/om1-scpu-spec.md section 4.2; the image initialises it
// and enables its IRQ 67): the registers keep what is written, with the RM's reset values (CNTR FRES | PDWN), ISTR
// raises nothing (no reset, SOF or transfer ever happens), FNR reads 0, and BCDR's detection bits read 0 (no data
// contact, no port detected). The endpoint registers' toggle-on-write bits are kept as written (the endpoints never
// run). The packet memory is plain RAM.
import { Regs, merge } from './regs.mjs';

export const CNTR = 0x40, ISTR = 0x44, FNR = 0x48, DADDR = 0x4c, BTABLE = 0x50, LPMCSR = 0x54, BCDR = 0x58;

export class UsbStub extends Regs {
  constructor() { super('USB'); this.reset(); }
  reset() {
    this.r = new Map([[CNTR, 0x0003], [ISTR, 0], [FNR, 0], [DADDR, 0], [BTABLE, 0], [LPMCSR, 0], [BCDR, 0]]);
    for (let e = 0; e < 8; e++) this.r.set(4 * e, 0);
  }
  rd(off) {
    if (!this.r.has(off)) throw this.missing(off, false);
    if (off === BCDR) return this.r.get(BCDR) & 0x800f;   // DCDET, PDET, SDET, PS2DET: 0
    return this.r.get(off);
  }
  wr(off, v, mask) {
    if (!this.r.has(off)) throw this.missing(off, true, v);
    if (off === FNR) return;
    if (off === ISTR) { this.r.set(ISTR, this.r.get(ISTR) & (v | ~mask) & 0xffff); return; }   // write 0 to clear
    this.r.set(off, merge(this.r.get(off), v, mask, 0xffff));
  }
}

// the packet memory: 1 KiB, accessed in halfwords and words (RM0394 45.5.1)
export class UsbPma extends Regs {
  constructor() { super('USB PMA'); this.bytes = new Uint8Array(1024); }
  reset() { this.bytes.fill(0); }
  rd(off) { const b = this.bytes; return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0; }
  wr(off, v, mask) {
    for (let i = 0; i < 4; i++) if ((mask >>> (8 * i)) & 0xff) this.bytes[off + i] = (v >>> (8 * i)) & 0xff;
  }
}
