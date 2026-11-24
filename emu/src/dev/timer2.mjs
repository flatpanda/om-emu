// The E118 family's second timer unit at 0x9b800000 (board timer2; docs/model-survey.md finding 155, docs/hle-gaps/
// 4.7.md 4.7.14): its first group, channels 0..9 on one IRQ, on the lab clock. D on E122 unless tagged (disassembly
// notation), the tables checked on E118 and E120 by their bytes (X):
//   - the driver's channel table 0x600267b0, 15 records {ctl address, IRQ, ISR}: channel n's ctl at 0x9b800010 + 12 n,
//     channels 0..9 on IRQ 24 with the shared ISR 0x50064440, 10..14 on IRQs 25..29 (E118 0x600267ac, E120
//     0x60026750: the same addresses and IRQs, X). The start 0x500640ba writes the reload at ctl + 4 (0x50064112),
//     clamped to 1023 with the rest counted by the ISR in software; the early init 0x50001df6 writes ctl 0, reload 1
//     and ctl + 8 0 for all 15 (0x50001e0d..0x50001e2c), status 0x9b8000c4 1023, the words 0x9b8000c8..0x9b8000d8 1
//     and the IE words 0x9b8000dc..0x9b8000f0 0;
//   - the mask table 0x6012d240, {status, IE, mask} per channel: bit n of 0x9b8000c4 and of 0x9b8000dc for channels
//     0..9, bit 0 of the words 0x9b8000c8 + 4 k / 0x9b8000e0 + 4 k for 10..14 (E118 0x6011a4d0, E120 0x60116b88, X);
//   - the arm 0x50064118 writes the mask to the status word, sets it in IE and writes ctl 1; the stop 0x50064147
//     clears IE's bit, writes ctl 0 and the mask to status; the ISR 0x5006427a, for channels 0..9, reads the status
//     word, and for each bit set clears its IE bit, writes ctl 0, writes the mask to status, then either re-arms it
//     (the rest of a long count, or a periodic entry: kind 128) by reload, IE and ctl 1, or leaves it stopped, and
//     calls the entry's callback;
//   - the reload is the count of the driver's period at clock 19 (0x500640e6: 0x5006e5c4 with clock 19, rounding up
//     at 0x5006e6b6), whose frequency the clock query 0x5006e243 reads from the clock block: 32768 Hz /
//     ((0x98800004 + 1) x 2) while 0x9880004c is 0, else 24 MHz / ((0x98800008 + 1) x 2) (0x5006e25d.., 0x5006e583).
// The model: ctl 1 runs a channel, 0 stops it (another value UNKNOWN); a running channel expires every reload counts
// of clock 19 from its start (A-TMR2-1, I: the count the driver programs is the period it asks for), the frequency
// read from the clock block's words when ctl is written 1 (the lab's are the stub's: 0 and 0, 16384 Hz, so the
// software timer driver's 2 ms channel, reload 0x21, expires every 2.014 ms); an expiry sets the channel's status bit
// and the channel runs on (A-TMR2-2, I: the ISR stops every channel it serves before it decides, so the firmware does
// not see the difference); the status word reads the bits, a write clears the bits written 1 (A-TMR2-3, I: the init's
// 1023 and the ISR's write of the mask after it served the bit); IRQ 24 is high while a bit is set in both status and
// IE (A-TMR2-4, I: as the main timer block's lines). ctl + 8 takes the init's writes and has no reader the lab has met:
// a read is UNKNOWN. Channels 10..14 and their words stay the stub's (no start of them seen, X). Built by the machine
// on a board that gives timer2 (src/machine.mjs), the last of the lab clock's sources.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const NS = 1e9;

export class Timer2 {
  // cfg: the board's timer2 {base, ctl, stride, channels, status, ie, irq, clock: {select, slow: [hz, word], fast: [hz,
  // word]}}; readClock(addr): the clock block's word as the CPU would read it (the machine's stub, without a side effect)
  constructor(machine, clock, intc, cfg, readClock) {
    this.m = machine; this.clock = clock; this.intc = intc; this.cfg = cfg; this.readClock = readClock;
    this.ch = Array.from({ length: cfg.channels }, () => ({ ctl: 0, reload: null, word8: null, running: false, period: 0, next: 0, expiries: 0 }));
    this.status = 0; this.ie = 0; this.mask = (1 << cfg.channels) - 1;
    this.errors = [];
    const { base } = cfg, first = base + cfg.ctl, span = cfg.stride * cfg.channels;
    const dev = { read: (a, w, dbg) => this.read(a - base, w, dbg), write: (a, v, w, dbg) => this.write(a - base, v, w, dbg) };
    addRegion({ base: first, size: span, kind: K_MMIO, name: 'om1.timer2-channels', dev });
    addRegion({ base: base + cfg.status, size: 4, kind: K_MMIO, name: 'om1.timer2-status', dev });
    addRegion({ base: base + cfg.ie, size: 4, kind: K_MMIO, name: 'om1.timer2-ie', dev });
    intc.drive(cfg.irq);
    clock.add({ next: () => this.clockNext(), fire: (at) => this.clockFire(at) });
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) {
      this.errors.push({ kind, addr: this.cfg.base + off, size, value, pc: ctx.pc() });
      this.m.stderr(`om-emu: om1.timer2 UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    }
    throw BUS;
  }
  // clock 19's frequency as the driver's clock query computes it from the clock block (see the head)
  // (null where the lab does not let the clock block be read)
  hz() {
    const { select, slow, fast } = this.cfg.clock, sel = this.readClock(select);
    if (sel === null) return null;
    const [f, word] = sel === 0 ? slow : fast, div = this.readClock(word);
    return div === null ? null : f / ((div + 1) * 2);
  }
  updateLine() { this.intc.setLine(this.cfg.irq, (this.status & this.ie) !== 0); }
  clockNext() {
    let at = Infinity;
    for (const c of this.ch) if (c.running && c.next < at) at = c.next;
    return at;
  }
  clockFire(at) {
    this.ch.forEach((c, n) => {
      if (c.running && c.next === at) { this.status |= 1 << n; c.expiries++; c.next += c.period; }
    });
    this.updateLine();
  }
  // the channel's period in lab ns: reload counts of clock 19 (A-TMR2-1)
  start(n, off, dbg) {
    const c = this.ch[n];
    if (!c.reload) return this.unknown('write (ctl 1 with no reload)', off, 4, 1, dbg);
    const hz = this.hz();
    if (hz === null) return this.unknown('write (ctl 1: the clock block is not readable)', off, 4, 1, dbg);
    c.period = Math.round(c.reload * NS / hz);
    c.running = true; c.next = this.clock.t + c.period;
  }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    const { ctl, stride, status, ie } = this.cfg;
    if (off === status) return this.status;
    if (off === ie) return this.ie;
    const n = Math.floor((off - ctl) / stride), r = (off - ctl) % stride, c = this.ch[n];
    if (r === 0) return c.ctl;
    if (r === 4 && c.reload !== null) return c.reload;
    return this.unknown('read', off, size, 0, dbg);
  }
  write(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.unknown('write', off, size, value, dbg);
    value >>>= 0;
    const { ctl, stride, status, ie } = this.cfg;
    if (off === status || off === ie) {
      if (value & ~this.mask) return this.unknown('write (bits of no channel)', off, size, value, dbg);
      if (off === status) this.status &= ~value;                  // A-TMR2-3
      else this.ie = value;
      this.updateLine();
      return;
    }
    const n = Math.floor((off - ctl) / stride), r = (off - ctl) % stride, c = this.ch[n];
    if (r === 0) {
      if (value > 1) return this.unknown('write (ctl value)', off, size, value, dbg);
      if (value && !c.running) this.start(n, off, dbg);
      else if (!value) c.running = false;
      c.ctl = value;
    } else if (r === 4) {
      if (value > 0x3ff) return this.unknown('write (reload above 1023)', off, size, value, dbg);
      c.reload = value;
    } else if (value === 0) c.word8 = 0;
    else return this.unknown('write (ctl + 8)', off, size, value, dbg);
  }
  // the debugger's view (tests, probes)
  info() {
    return { status: this.status, ie: this.ie, errors: this.errors.length,
      channels: this.ch.map((c) => ({ ctl: c.ctl, reload: c.reload, running: c.running, period: c.period, next: c.running ? c.next : 0, expiries: c.expiries })) };
  }
}
