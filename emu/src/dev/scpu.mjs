// OM-1 SCPU (sub-CPU) interface 0x98e00000..0x98e000ff. Storage
// 0x00, 0x08..0x3c, 0xe8, 0xec; command 0xf4 (a write is stored, counted and printed; a read returns 0, A-SCPU-1);
// every other offset, width or alignment is UNKNOWN (bus error, printed for a CPU access). Debugger reads see the
// storage of any aligned offset.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';
import { BOARD } from '../fw/board.mjs';

export const SCPU_BASE = 0x98E00000;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// the model's offsets (src/fw/board.mjs: E143's above; a later SCPU compacts its map, e.g. E144 command 0xa4, clock 0x98/0x9c)
const { command: COMMAND, clock: [CLK0, CLK1] } = BOARD.scpu, RANGES = BOARD.scpu.storage;
const storage = (off) => RANGES.some(([lo, hi]) => off >= lo && off <= hi);

export class Scpu {
  constructor(machine) {
    this.m = machine;
    this.reg = new Uint32Array(0x40);
    this.commands = 0;
    addRegion({ base: SCPU_BASE, size: 0x100, kind: K_MMIO, name: 'om1.scpu',
      dev: { read: (a, w, dbg) => this.read(a - SCPU_BASE, w, dbg), write: (a, v, w, dbg) => this.write(a - SCPU_BASE, v, w, dbg) } });
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: scpu UNKNOWN ${kind} ${hex8(SCPU_BASE + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    if (dbg || storage(off)) return this.reg[off >> 2];
    if (off === COMMAND) return 0;                    // A-SCPU-1
    return this.unknown('read', off, size, 0, dbg);
  }
  write(off, value, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('write', off, size, value, dbg);
    if (dbg || storage(off)) { this.reg[off >> 2] = value; return; }
    if (off === COMMAND) {
      this.reg[off >> 2] = value;
      this.commands = (this.commands + 1) >>> 0;
      this.m.stderr(`om-emu: scpu command ${hex8(value)} pc ${hex8(ctx.pc())} #${this.commands} (reg0 ${hex8(this.reg[0])} ${CLK0.toString(16)} ${hex8(this.reg[CLK0 >> 2])} ${CLK1.toString(16)} ${hex8(this.reg[CLK1 >> 2])})`);
      return;
    }
    return this.unknown('write', off, size, value, dbg);
  }
}
