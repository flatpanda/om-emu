// OM-1 SCPU (sub-CPU) interface 0x98e00000..0x98e000ff. Storage 0x00, 0x08..0x3c; the clock 0xe8 / 0xec, which
// ticks with the lab clock (below; on a board whose scpu.ticks is false, storage that stands still); command 0xf4 (a write is stored, counted and printed; a read returns 0, A-SCPU-1);
// every other offset, width or alignment is UNKNOWN (bus error, printed for a CPU access). Debugger reads see the
// storage of any aligned offset and the clock as the CPU reads it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';
import { BOARD } from '../fw/board.mjs';

export const SCPU_BASE = 0x98E00000;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the model's offsets (src/fw/board.mjs: E143's above; a later SCPU compacts its map, e.g. E144 command 0xa4, clock 0x98/0x9c)
const { command: COMMAND, clock: [CLK0, CLK1], ticks: TICKS } = BOARD.scpu, RANGES = BOARD.scpu.storage;
const storage = (off) => RANGES.some(([lo, hi]) => off >= lo && off <= hi) || (!TICKS && (off === CLK0 || off === CLK1));
const NS = 1e9;

// The clock (docs/hle-gaps.md 4.7.1, D from its readers and its writer): CLK0 counts seconds since 1970 in local time,
// CLK1 bits 14..5 the 1/1024 s phase. Both tick with the lab clock (integer ns), so a run is deterministic: `clk` is
// the second CLK0 counts at lab time `at`, where a second began. A write of CLK0 sets the second and keeps the phase;
// a write of 0 to CLK1 restarts the phase at the current second (the firmware's setter writes it when told to, I: that
// it zeroes the phase). CLK1's bits 4..0 read 0 and a nonzero write to it is UNKNOWN (A-SCPU-3: no writer of another
// value is known).
export class Scpu {
  constructor(machine, clock) {
    this.m = machine;
    this.clock = clock;
    this.reg = new Uint32Array(0x40);
    this.clk = { sec: 0, at: 0 };
    this.commands = 0;
    addRegion({ base: SCPU_BASE, size: 0x100, kind: K_MMIO, name: 'om1.scpu',
      dev: { read: (a, w, dbg) => this.read(a - SCPU_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - SCPU_BASE, v, w, dbg) } });
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: scpu UNKNOWN ${kind} ${hex8(SCPU_BASE + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  // [whole seconds, ns into the current second] since the clock's second began
  elapsed() {
    const ns = this.clock.t - this.clk.at, s = Math.floor(ns / NS);
    return [s, ns - s * NS];
  }
  seconds() { return (this.clk.sec + this.elapsed()[0]) >>> 0; }
  phase() { return (Math.floor(this.elapsed()[1] * 1024 / NS) << 5) >>> 0; }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    if (TICKS && off === CLK0) return this.seconds();
    if (TICKS && off === CLK1) return this.phase();
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
