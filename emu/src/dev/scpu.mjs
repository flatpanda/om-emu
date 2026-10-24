// OM-1 SCPU (sub-CPU) interface 0x98e00000..0x98e000ff. Storage 0x00, 0x08..0x3c; the clock 0xe8 / 0xec, which
// ticks with the lab clock (below; on a board whose scpu.ticks is false, storage that stands still); command 0xf4 (a write is stored, counted and printed; a read returns 0, A-SCPU-1);
// on a board with scpu.events (E143's), the event word 0x98 and the seven port words 0xa0..0xb8 (below), which drive
// IRQ 320, and the lab's doorbell that sets the ports' input levels;
// every other offset, width or alignment is UNKNOWN (bus error, printed for a CPU access). Debugger reads see the
// storage of any aligned offset, and the clock, the event word and the ports as the CPU reads them.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';
import { BOARD } from '../fw/board.mjs';

export const SCPU_BASE = 0x98E00000;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the model's offsets (src/fw/board.mjs: E143's above; a later SCPU compacts its map, e.g. E144 command 0xa4, clock 0x98/0x9c)
const { command: COMMAND, clock: [CLK0, CLK1], ticks: TICKS } = BOARD.scpu, RANGES = BOARD.scpu.storage;
const EV = BOARD.scpu.events ?? null;
const storage = (off) => RANGES.some(([lo, hi]) => off >= lo && off <= hi) || (!TICKS && (off === CLK0 || off === CLK1));
const NS = 1e9;
// the doorbell's command: bits 31..24 the command, bits 23..0 its argument
export const SET_INPUTS = 1;

// The clock (docs/hle-gaps.md 4.7.1, D from its readers and its writer): CLK0 counts seconds since 1970 in local time,
// CLK1 bits 14..5 the 1/1024 s phase. Both tick with the lab clock (integer ns), so a run is deterministic: `clk` is
// the second CLK0 counts at lab time `at`, where a second began. A write of CLK0 sets the second and keeps the phase;
// a write of 0 to CLK1 restarts the phase at the current second (the firmware's setter writes it when told to, I: that
// it zeroes the phase). CLK1's bits 4..0 read 0 and a nonzero write to it is UNKNOWN (A-SCPU-3: no writer of another
// value is known).
//
// The event and port words (docs/hle-gaps.md 4.7.2; board scpu.events {pending, ports, count, irq}): port k (the word
// at ports + 4k, k < count) reads its input level in bit 31, which the firmware's port byte reader packs into bit k of
// a byte (D); its other bits read 0 (A-SCPU-4: the configuration the firmware's port setter writes there is not
// modelled, and a write is UNKNOWN). The event word holds a pending bit per port: bit k is set when
// port k's level changes, either way (I: the firmware's callbacks pair event bit k with port bit k and act on both
// edges, D), and IRQ 320's line is high while a bit is pending. A write clears the bits it has set (I: the IRQ 320
// handler writes back the word it read, the SCPU init writes 127, D); a bit outside the ports is UNKNOWN. The levels
// are the lab's: a store of (SET_INPUTS << 24) | levels to the doorbell sets them (bit k port k's level), as the
// body's levers and buttons would; any other store, or a read, is a bus error. The levels and the events start at 0.
// But for port events.message (board scpu.events; E143's port 3): its level is the sub-CPU's message line, PC2, which
// the sub-CPU's model sets through setMessage() (src/lab/scpulink.mjs); it starts high, released (I: the line is low
// only while the sub-CPU has a message to post, D: docs/om1-scpu-spec.md 3.1), and a doorbell store with that port's
// bit 0 is a bus error (the lab drives no level onto the line).
export class Scpu {
  constructor(machine, clock, intc = null, doorbell = null) {
    this.m = machine;
    this.clock = clock;
    this.intc = intc;
    this.reg = new Uint32Array(0x40);
    this.clk = { sec: 0, at: 0 };
    this.commands = 0;
    this.inputs = 0;
    this.message = 1;                    // the sub-CPU's message line (events.message), released
    this.pending = 0;
    addRegion({ base: SCPU_BASE, size: 0x100, kind: K_MMIO, name: 'om1.scpu',
      dev: { read: (a, w, dbg) => this.read(a - SCPU_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - SCPU_BASE, v, w, dbg) } });
    if (EV) {
      if (intc === null || doorbell === null) throw new Error('Scpu: a board with scpu.events needs the interrupt controller and a doorbell');
      intc.drive(EV.irq);
      addRegion({ base: doorbell, size: 4, kind: K_MMIO, name: 'om1.lab-scpu-doorbell',
        dev: { read: (a, w, dbg) => this.labUnknown('read', a, w, 0, dbg), write: (a, v, w, dbg) => this.doorbell(a, v, w, dbg) } });
    }
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: scpu UNKNOWN ${kind} ${hex8(SCPU_BASE + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  labUnknown(kind, a, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: scpu doorbell UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  // [whole seconds, ns into the current second] since the clock's second began
  elapsed() {
    const ns = this.clock.t - this.clk.at, s = Math.floor(ns / NS);
    return [s, ns - s * NS];
  }
  seconds() { return (this.clk.sec + this.elapsed()[0]) >>> 0; }
  phase() { return (Math.floor(this.elapsed()[1] * 1024 / NS) << 5) >>> 0; }
  // the port k an offset names, or -1
  port(off) {
    if (!EV || off < EV.ports) return -1;
    const k = (off - EV.ports) >> 2;
    return k < EV.count ? k : -1;
  }
  // the ports' levels (bit k port k): the lab's, but for the message port, whose level is the sub-CPU's line
  levels() {
    if (EV.message === undefined) return this.inputs;
    const m = 1 << EV.message;
    return ((this.inputs & ~m) | (this.message ? m : 0)) >>> 0;
  }
  // a changed port's event bit is set and the line follows the event word
  changed(before) {
    this.pending = (this.pending | (before ^ this.levels())) >>> 0;
    this.intc.setLine(EV.irq, this.pending !== 0);
  }
  // the lab's levels (bit k port k)
  setInputs(levels) {
    const before = this.levels();
    this.inputs = levels >>> 0;
    this.changed(before);
  }
  // the sub-CPU's message line (src/lab/scpulink.mjs)
  setMessage(level) {
    if (EV?.message === undefined) throw new Error('Scpu: the board has no message port (scpu.events.message)');
    const before = this.levels();
    this.message = level ? 1 : 0;
    this.changed(before);
  }
  doorbell(a, value, size, dbg) {
    const held = EV.message === undefined ? 0 : 1 << EV.message;
    if (dbg || size !== 4 || (a & 3) || value >>> 24 !== SET_INPUTS || (value & 0xffffff) >>> EV.count || (value & held) !== held) return this.labUnknown('write', a, size, value, dbg);
    this.setInputs(value & 0xffffff);
  }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    if (TICKS && off === CLK0) return this.seconds();
    if (TICKS && off === CLK1) return this.phase();
    if (EV && off === EV.pending) return this.pending;
    const k = this.port(off);
    if (k >= 0) return ((this.levels() >>> k) & 1) << 31 >>> 0;
    if (dbg || storage(off)) return this.reg[off >> 2];
    if (off === COMMAND) return 0;                    // A-SCPU-1
    return this.unknown('read', off, size, 0, dbg);
  }
  write(off, value, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('write', off, size, value, dbg);
    if (TICKS && off === CLK0) {
      const into = this.elapsed()[1];
      this.clk.sec = value >>> 0; this.clk.at = this.clock.t - into;
      return;
    }
    if (TICKS && off === CLK1) {
      if (value !== 0) return this.unknown('write', off, size, value, dbg);    // A-SCPU-3
      this.clk.sec = this.seconds(); this.clk.at = this.clock.t;
      return;
    }
    if (EV && off === EV.pending) {
      if (dbg || value >>> EV.count) return this.unknown('write', off, size, value, dbg);
      this.pending = (this.pending & ~value) >>> 0;
      this.intc.setLine(EV.irq, this.pending !== 0);
      return;
    }
    if (this.port(off) >= 0) return this.unknown('write', off, size, value, dbg);   // A-SCPU-4
    if (dbg || storage(off)) { this.reg[off >> 2] = value; return; }
    if (off === COMMAND) {
      this.reg[off >> 2] = value;
      this.commands = (this.commands + 1) >>> 0;
      this.m.stderr(`om-emu: scpu command ${hex8(value)} pc ${hex8(ctx.pc())} #${this.commands} (reg0 ${hex8(this.reg[0])} ${CLK0.toString(16)} ${hex8(this.read(CLK0, 4, true))} ${CLK1.toString(16)} ${hex8(this.read(CLK1, 4, true))})`);
      return;
    }
    return this.unknown('write', off, size, value, dbg);
  }
}
