// OM-1 timer block (0x98900000) on the lab clock and its debug window 0x89a10000, and the lab clock itself,
// A-USLAB (USMODE 1) and the mutant negative controls 28..30 included. Times are
// integer ns held in Numbers (exact below 2^53 ns, about 104 lab days).
import { BUS, K_MMIO, K_ROMD, addRegion, allocWindow, buf, U8, ctx } from '../core/mem.mjs';
import { IRQ_TIMER } from './intc.mjs';
import { BOARD } from '../fw/board.mjs';

export const CLOCK_NONE = Infinity;

// The lab clock: one ns time line shared by the VSC model and the timer block, moved only by lab doorbell commands.
export class Clock {
  constructor() { this.t = 0; this.src = []; }
  add(s) { this.src.push(s); }
  advance(target, firstOnly) {
    let fired = 0;
    for (;;) {
      let at = CLOCK_NONE;
      for (const s of this.src) { const n = s.next(); if (n < at) at = n; }
      if (at === CLOCK_NONE || at > target) break;
      if (at < this.t) throw new Error('lab clock: an event in the past (model bug)');
      this.t = at;
      fired = 0;
      for (let i = 0; i < this.src.length; i++) {
        if (this.src[i].next() === at) { this.src[i].fire(at); fired |= 1 << i; }
      }
      if (firstOnly) break;
    }
    if (!firstOnly || !fired) this.t = target;
    for (const s of this.src) if (s.publish) s.publish();
    return fired;
  }
}

// The model's layout (src/fw/board.mjs). E143: 34 channels, ctl 0x000 / reload 0x100 / counter 0x200 + 4n, one IE
// (0x300) and one status (0x400, write-1-to-clear) bit n-1 for channels 1..32, IRQ 137 + n each, channel 33 the
// microsecond free-run (only its counter is read). A model may group the IE and status bits in several registers
// (bit n - first of its group) and share one IRQ per group; the debug window keeps bit n-1 of channel n.
const L = BOARD.timer;
export const TIMER_BASE = 0x98900000, TIMER_SIZE = 0x1000, CHANNELS = L.channels;
const RELOAD = L.reload, COUNTER = L.counter, US = L.us_channel, GROUPS = L.groups;
const LAST = Math.max(...GROUPS.map((g) => g[1]));
const groupMask = ([lo, hi]) => (hi - lo === 31 ? 0xffffffff : ((1 << (hi - lo + 1)) - 1) << (lo - 1)) >>> 0;
export const TIMER_DEBUG_BASE = 0x89A10000, TIMER_DEBUG_SIZE = 0x1000;
const D = { MAGIC: 0x000, VERSION: 0x004, T_LO: 0x008, IE: 0x010, STATUS: 0x014, ERR_TOTAL: 0x018, NOTE_TOTAL: 0x01C,
  USMODE: 0x030, ERR_RING: 0x040, ERR_SLOTS: 8, CH: 0x100, CH_SIZE: 0x40 };
const CH = { CTL: 0x00, RELOAD: 0x04, RUNNING: 0x08, T0: 0x0C, PERIOD: 0x14, NEXT: 0x1C, EXPIRIES: 0x24,
  OVERRUNS: 0x28, UNWRITTEN_READ: 0x2C };
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// mutant values of check_irq's negative controls, from the machine's mutant option
const MUT_PERIOD_RELOAD = 28, MUT_STATUS_IGNORED = 29, MUT_USLAB_NO_TIME = 30;
export class Timer {
  constructor(machine, clock, intc) {
    this.m = machine; this.clock = clock; this.intc = intc;
    this.ch = [];
    for (let n = 0; n < CHANNELS; n++) {
      this.ch.push({ ctl: 0, reload: 0, ctlWritten: false, running: false, t0: 0, period: 0, next: 0, expiries: 0, overruns: 0 });
    }
    this.ie = 0; this.status = 0;
    const c0 = this.ch[0], c33 = this.ch[US];                      // H-RESETTIMER
    c0.ctl = 0x80; c0.reload = L.prescaler ?? 0; c0.running = true; c0.ctlWritten = true;
    c33.ctl = 0x80; c33.reload = L.us_reload; c33.running = true; c33.ctlWritten = true;
    this.count33 = L.us_reload; this.usBase = 0;
    for (let n = 1; n <= LAST; n++) intc.drive(IRQ_TIMER(n));
    addRegion({ base: TIMER_BASE, size: TIMER_SIZE, kind: K_MMIO, name: 'om1.timer',
      dev: { read: (a, w, dbg) => this.read(a - TIMER_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - TIMER_BASE, v, w, dbg) } });
    const off = allocWindow(TIMER_DEBUG_SIZE);
    this.d32 = new Uint32Array(buf, off, TIMER_DEBUG_SIZE / 4);
    this.dset(D.MAGIC, 0x524D4954); this.dset(D.VERSION, 1);
    addRegion({ base: TIMER_DEBUG_BASE, size: TIMER_DEBUG_SIZE, kind: K_ROMD, off, name: 'om1.lab-timer-debug',
      dev: { romdWrite: (a, v, w) => this.error('write (lab debug window)', a - TIMER_BASE, w, v, false) } });
    clock.add({ next: () => this.clockNext(), fire: (at) => this.clockFire(at), publish: () => this.publish() });
    this.publish();
  }
  dget(o) { return this.d32[o >> 2]; }
  dset(o, v) { this.d32[o >> 2] = v; }
  dset64(o, v) { this.dset(o, v % 4294967296); this.dset(o + 4, Math.floor(v / 4294967296)); }
  error(kind, off, size, value, dbg) {
    if (!dbg) {
      const total = this.dget(D.ERR_TOTAL), slot = D.ERR_RING + (total % D.ERR_SLOTS) * 16;
      this.dset(slot, off); this.dset(slot + 4, size); this.dset(slot + 8, value); this.dset(slot + 12, ctx.pc());
      this.dset(D.ERR_TOTAL, total + 1);
      this.m.stderr(`om-emu: timer UNKNOWN ${kind} ${hex8(TIMER_BASE + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    }
    throw BUS;
  }
  updateLines() {
    for (const g of GROUPS) {
      if (g[4] !== null) { this.intc.setLine(g[4], ((this.status & this.ie & groupMask(g)) >>> 0) !== 0); continue; }
      for (let n = g[0]; n <= g[1]; n++) {
        const bit = (1 << (n - 1)) >>> 0;
        this.intc.setLine(IRQ_TIMER(n), ((this.status & this.ie & bit) >>> 0) !== 0);
      }
    }
  }
  publish() {
    this.dset64(D.T_LO, this.clock.t);
    this.dset(D.IE, this.ie); this.dset(D.STATUS, this.status);
    for (let n = 0; n < CHANNELS; n++) {
      const c = this.ch[n], b = D.CH + D.CH_SIZE * n;
      this.dset(b + CH.CTL, c.ctl); this.dset(b + CH.RELOAD, c.reload); this.dset(b + CH.RUNNING, c.running ? 1 : 0);
      this.dset64(b + CH.T0, c.t0); this.dset64(b + CH.PERIOD, c.period); this.dset64(b + CH.NEXT, c.running ? c.next : 0);
      this.dset(b + CH.EXPIRIES, c.expiries); this.dset(b + CH.OVERRUNS, c.overruns);
    }
  }
  clockNext() {
    let at = CLOCK_NONE;
    for (let n = 1; n <= LAST; n++) if (this.ch[n].running && this.ch[n].next < at) at = this.ch[n].next;
    return at;
  }
  clockFire(at) {
    for (let n = 1; n <= LAST; n++) {
      const c = this.ch[n];
      if (c.running && c.next === at) {
        const bit = (1 << (n - 1)) >>> 0;
        if (this.status & bit) c.overruns = (c.overruns + 1) >>> 0;
        this.status = (this.status | bit) >>> 0;
        c.expiries = (c.expiries + 1) >>> 0;
        c.next += c.period;
      }
    }
    this.updateLines();
  }
  start(n) {
    const c = this.ch[n];
    c.running = true;
    if (n >= 1 && n <= LAST) {
      const counts = this.m.mutant === MUT_PERIOD_RELOAD ? c.reload : c.reload + 1;   // A-TMR-1
      c.t0 = this.clock.t;
      c.period = counts * 1000;                                    // A-TMR-2
      if (!c.period) { c.running = false; return; }
      c.next = c.t0 + c.period;
    }
  }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.error('read', off, size, 0, dbg);
    if (off < 4 * CHANNELS) {
      const n = off >> 2, c = this.ch[n], u = D.CH + D.CH_SIZE * n + CH.UNWRITTEN_READ;
      if (!c.ctlWritten && !dbg && !this.dget(u)) {
        this.dset(u, ctx.pc());
        this.dset(D.NOTE_TOTAL, this.dget(D.NOTE_TOTAL) + 1);
      }
      return c.ctl;
    }
    if (off >= RELOAD && off < RELOAD + 4 * CHANNELS) return this.ch[(off - RELOAD) >> 2].reload;
    if (off === COUNTER + 4 * US) {
      let data = this.count33;
      if (this.dget(D.USMODE) === 1) {          // A-USLAB: lab microseconds since the last load, plus the reads
        const reload = BigInt(this.ch[US].reload), span = reload + 1n;
        const us = this.m.mutant === MUT_USLAB_NO_TIME ? 0n : BigInt(Math.floor((this.clock.t - this.usBase) / 1000));
        const reads = BigInt.asUintN(64, reload - BigInt(this.count33));
        data = Number(BigInt.asUintN(32, reload - BigInt.asUintN(32, BigInt.asUintN(64, us + reads) % span)));
      }
      if (!dbg) this.count33 = this.count33 ? this.count33 - 1 : this.ch[US].reload;   // H-USCOUNT
      return data;
    }
    for (const g of GROUPS) {
      if (off === g[2]) return (this.ie & groupMask(g)) >>> (g[0] - 1);
      if (off === g[3] && (dbg || L.status_readable)) return (this.status & groupMask(g)) >>> (g[0] - 1);
    }
    return this.error('read', off, size, 0, dbg);
  }
  write(off, value, size, dbg) {
    if (dbg) throw BUS;
    if (size !== 4 || (off & 3)) return this.error('write', off, size, value, dbg);
    if (off < 4 * CHANNELS) {
      const n = off >> 2, c = this.ch[n], was = (c.ctl & 0x80) !== 0;
      if (value & ~0xC0) return this.error('write (ctl value)', off, size, value, dbg);
      c.ctl = value; c.ctlWritten = true;
      if ((value & 0x80) && !was) this.start(n);
      else if (!(value & 0x80)) c.running = false;
      this.publish();
      return;
    }
    if (off >= RELOAD && off < RELOAD + 4 * CHANNELS) {
      this.ch[(off - RELOAD) >> 2].reload = value;
      if (off === RELOAD + 4 * US) { this.count33 = value; this.usBase = this.clock.t; }
      this.publish();
      return;
    }
    for (const g of GROUPS) {
      const mask = groupMask(g), bits = (value << (g[0] - 1)) & mask;
      if (off === g[2]) { this.ie = ((this.ie & ~mask) | bits) >>> 0; this.updateLines(); this.publish(); return; }
      if (off === g[3]) {
        if (this.m.mutant !== MUT_STATUS_IGNORED) this.status = (this.status & ~bits) >>> 0;   // A-TMR-4
        this.updateLines(); this.publish(); return;
      }
    }
    return this.error('write', off, size, value, dbg);
  }
}
