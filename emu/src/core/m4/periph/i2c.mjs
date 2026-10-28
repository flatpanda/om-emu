// The STM32L4's I2C controller (RM0394 section 37, I2C1 at 0x40005400, I2C2 at 0x40005800) in master mode at register
// level: CR1 / CR2 / OAR / TIMINGR / TIMEOUTR, ISR with ICR, TXDR / RXDR, and the master transfer: START sends the
// address (CR2.SADD, RD_WRN), then NBYTES bytes with TXIS / RXNE per byte, TC or TCR (RELOAD) after the last, or a STOP
// (AUTOEND, or CR2.STOP) with STOPF and BUSY clear; a NACK sets NACKF and a STOP follows by itself (RM0394 37.4.8). A
// byte takes 9 SCL periods from TIMINGR and the kernel clock (I2CxSEL in CCIPR). Interrupts: event IRQ (TXIS, RXNE,
// ADDR, NACKF, STOPF, TC, TCR with their enables) and error IRQ (BERR, ARLO, OVR, TIMEOUT, ALERT); DMA requests when
// CR1.TXDMAEN / RXDMAEN and the machine wired a channel (else Unmodelled). Slave mode, SMBus, PEC, 10-bit addresses and
// the analog / digital filters are not modelled. The devices on the bus are the board's: device(address) returns
// {start(read), write(byte) -> ack, read() -> byte, stop()} or null; a missing device NACKs its address (I for the
// SCPU's buses: their devices are not modelled, docs/om1-scpu-spec.md section 4.2).
import { Regs, Unmodelled, merge } from './regs.mjs';

export const CR1 = 0x00, CR2 = 0x04, OAR1 = 0x08, OAR2 = 0x0c, TIMINGR = 0x10, TIMEOUTR = 0x14, ISR = 0x18, ICR = 0x1c,
  PECR = 0x20, RXDR = 0x24, TXDR = 0x28;
export const TXE = 1, TXIS = 2, RXNE = 4, ADDR = 8, NACKF = 16, STOPF = 32, TC = 64, TCR = 128, BERR = 256, ARLO = 512,
  OVR = 1024, TIMEOUT = 1 << 12, ALERT = 1 << 13, BUSY = 1 << 15;
const PE = 1, START = 1 << 13, STOP = 1 << 14, RELOAD = 1 << 24, AUTOEND = 1 << 25, RD_WRN = 1 << 10;

export class I2c extends Regs {
  // name, sched, irqs [event, error], kernelHz() / hclkHz() -> the kernel clock and the core's, device(address7) -> a
  // device or null
  constructor({ name, sched, irq, irqs, kernelHz, hclkHz, device = () => null }) {
    super(name);
    Object.assign(this, { sched, irq, irqs, kernelHz, hclkHz, device });
    this.dmaTx = null; this.dmaRx = null;        // (level) -> DMA request lines
    this.log = [];                                // {addr, read, ack, bytes} per transfer, the board's oracle
    this.reset();
  }
  reset() {
    this.cr1 = 0; this.cr2 = 0; this.oar1 = 0; this.oar2 = 0; this.timingr = 0; this.timeoutr = 0;
    this.isr = TXE; this.rxdr = 0; this.txdr = 0; this.txFull = false;
    this.ev = this.sched ? this.sched.cancel(this.ev) : null;
    this.dev = null; this.count = 0; this.cur = null;
    if (this.irq) this.update();
  }
  byteCycles(hclkHz) {
    const t = this.timingr, presc = ((t >>> 28) & 15) + 1, scll = (t & 0xff) + 1, sclh = ((t >>> 8) & 0xff) + 1;
    const hz = this.kernelHz() || 16e6, scl = hz / (presc * (scll + sclh));
    return Math.max(1, Math.round(9 * hclkHz / scl));
  }
  rd(off) {
    switch (off) {
      case CR1: return this.cr1;
      case CR2: return this.cr2;
      case OAR1: return this.oar1;
      case OAR2: return this.oar2;
      case TIMINGR: return this.timingr;
      case TIMEOUTR: return this.timeoutr;
      case ISR: return this.isr;
      case ICR: return 0;
      case PECR: return 0;
      case RXDR: { const v = this.rxdr; if (this.isr & RXNE) { this.isr &= ~RXNE; this.rxTaken(); } return v; }
      case TXDR: return this.txdr;
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    switch (off) {
      case CR1: {
        const was = this.cr1 & PE;
        this.cr1 = merge(this.cr1, v, mask, 0x00ffdfff);
        if (this.cr1 & ((1 << 16) | (1 << 23) | (1 << 20) | (1 << 21))) throw new Unmodelled(`${this.name} slave byte control, SMBus or PEC (CR1 ${this.cr1.toString(16)})`);
        if (((this.cr1 & (1 << 14)) && !this.dmaTx) || ((this.cr1 & (1 << 15)) && !this.dmaRx)) throw new Unmodelled(`${this.name} DMA requests (no channel wired)`);
        if (was && !(this.cr1 & PE)) this.softReset();
        this.update();
        return;
      }
      case CR2: {
        const nv = merge(this.cr2, v, mask, 0x07ffffff);
        const start = (v & mask & START) !== 0, stop = (v & mask & STOP) !== 0;
        this.cr2 = nv & ~(START | STOP);
        if (start && (this.cr1 & PE)) this.start();
        else if (stop && (this.isr & BUSY)) this.stopNow();
        this.update();
        return;
      }
      case OAR1: this.oar1 = merge(this.oar1, v, mask, 0x87ff); return;
      case OAR2: this.oar2 = merge(this.oar2, v, mask, 0x87fe); return;
      case TIMINGR: this.timingr = merge(this.timingr, v, mask, 0xf0ffffff); return;
      case TIMEOUTR: this.timeoutr = merge(this.timeoutr, v, mask); return;
      case ISR:                                   // TXE can be set (flush), TXIS set when NOSTRETCH
        if (v & mask & TXE) { this.isr |= TXE; this.txFull = false; }
        return;
      case ICR: this.isr &= ~(v & mask & 0x3f38); this.update(); return;
      case PECR: case RXDR: return;
      case TXDR:
        this.txdr = v & 0xff; this.txFull = true; this.isr &= ~(TXE | TXIS);
        if (this.cur && this.cur.waitTx) { this.cur.waitTx = false; this.sendByte(); }
        this.update();
        return;
    }
    throw this.missing(off, true, v);
  }
  softReset() {                                   // PE = 0 (RM0394 37.4.5): the state and the flags, not the configuration
    this.ev = this.sched.cancel(this.ev);
    this.isr = TXE; this.txFull = false; this.cur = null;
  }
  after(fn, what) { this.ev = this.sched.after(this.byteCycles(this.hclkHz()), () => { this.ev = null; fn(); }, what); }
  // a START (or a repeated START): the address byte
  start() {
    if (this.cr2 & (1 << 11)) throw new Unmodelled(`${this.name} 10-bit addressing`);
    const addr = (this.cr2 >>> 1) & 0x7f, read = (this.cr2 & RD_WRN) !== 0;
    this.isr |= BUSY; this.isr &= ~(TC | TCR);
    this.cur = { addr, read, n: (this.cr2 >>> 16) & 0xff, done: 0, waitTx: false, bytes: [] };
    this.after(() => {
      const dev = this.device(addr);
      this.dev = dev;
      const ack = !!dev && dev.start(read) !== false;
      this.log.push({ addr, read, ack, bytes: this.cur.bytes });
      if (!ack) return this.nack();
      this.next();
    }, `${this.name} address`);
  }
  // the next byte of the transfer, or its end
  next() {
    const c = this.cur;
    if (c.done >= c.n) return this.end();
    if (c.read) this.after(() => this.receiveByte(), `${this.name} read`);
    else if (this.txFull) this.sendByte();
    else { c.waitTx = true; this.isr |= TXIS; if (this.dmaTx && this.cr1 & (1 << 14)) this.dmaTx(true); this.update(); }
  }
  sendByte() {
    const byte = this.txdr;
    this.txFull = false; this.isr |= TXE;
    if (this.dmaTx) this.dmaTx(false);
    this.after(() => {
      const c = this.cur;
      c.bytes.push(byte);
      const ack = this.dev.write(byte) !== false;
      c.done++;
      if (!ack) return this.nack();
      this.next();
    }, `${this.name} write`);
  }
  receiveByte() {
    const c = this.cur, byte = this.dev.read() & 0xff;
    c.bytes.push(byte); c.done++;
    if (this.isr & RXNE) this.isr |= OVR;
    this.rxdr = byte; this.isr |= RXNE;
    if (this.dmaRx && this.cr1 & (1 << 15)) this.dmaRx(true);
    c.waitRx = true;
    this.update();
  }
  rxTaken() {
    if (this.dmaRx) this.dmaRx(false);
    if (this.cur && this.cur.waitRx) { this.cur.waitRx = false; this.next(); }
  }
  end() {
    if (this.cr2 & RELOAD) { this.isr |= TCR; this.cur.done = 0; this.cur.n = (this.cr2 >>> 16) & 0xff; this.update(); return; }
    if (this.cr2 & AUTOEND) return this.stopNow();
    this.isr |= TC; this.update();
  }
  nack() { this.isr |= NACKF; this.stopNow(); }
  stopNow() {
    if (this.dev) this.dev.stop();
    this.dev = null; this.cur = null;
    this.isr = (this.isr | STOPF) & ~(BUSY | TC | TCR);
    this.update();
  }
  update() {
    const c = this.cr1, s = this.isr;
    const ev = ((c & 2) && (s & TXIS)) || ((c & 4) && (s & RXNE)) || ((c & 16) && (s & NACKF)) ||
      ((c & 32) && (s & STOPF)) || ((c & 64) && (s & (TC | TCR))) || ((c & 8) && (s & ADDR));
    const er = (c & 128) && (s & (BERR | ARLO | OVR | TIMEOUT | ALERT));
    this.irq(this.irqs[0], !!ev);
    this.irq(this.irqs[1], !!er);
  }
}
