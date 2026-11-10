// S-IMGPRO: the imgpro unit at 0x9c600000 (board imgpro; docs/om1-imgpro-spec.md, docs/hle-gaps.md 4.3.1), the
// image library's unit 7 (its record 0x50481790(7), its trace record 0x50483474(7, ...)), which the library's request
// kinds 6, 13, 14, 16 and 17 drive (the kind table 0x6065a834: 13, 14, 16 and 17 to the handler 0x5046daa2, 6 to
// 0x5046dc32). A register file at the board's base with the behaviour the firmware's driver relies on, and of the
// unit's operations only the fills of kind 14 (op 3, modes 4 and 5), whose arithmetic the firmware's set-up gives;
// every other operation is refused (a bus error at the start), so nothing the lab does not know is computed. Evidence D
// unless tagged (the words the driver writes and reads are D; how the unit reads them is I, from the set-up's
// arithmetic and the callers' use of the fill); addresses E143's.
//
//   +0x000  written 1 by the unit's init 0x5050a6b2 (last) and by the end 0x5050a8e1, which reads it back (0x5050a923):
//           storage, and the model's power-down (I: the pair of +0x004)
//   +0x004  written 1 by the init (first) and by every kind's start before its parameters (0x5050a6ef, 0x5050a74e,
//           0x5050a7a9, 0x5050a804, 0x5050a86f): the model's power-up (I); a start while powered down is UNKNOWN
//   +0x008  written 1 by the end and by the interrupt handler's chained restart (0x5048c022): storage (I: a stop)
//   +0x00c, +0x018  written 1, in this order, by the go 0x5050a8ba and by the chained restart (0x5048c04a, 0x5048c050):
//           a write of 1 to +0x018 after one to +0x00c since the last start starts a run (I: the pair is the start);
//           any other value, or +0x018 without +0x00c, is UNKNOWN
//   +0x020  status, bit 0 a run's end (the handler 0x5048bfe3 reads it, ands it with +0x028 and writes the result back,
//           0x5048bfe8..f8: write 1 to clear, I); the go writes 1 before the start (clears a stale end)
//   +0x028  interrupt enable, bit 0 (the go writes 1, the handler 0, the end 1); IRQ imgpro.irq (300, which the
//           library's init attaches with the handler 0x5048bfe3 at level 4 on CPUs 0..3, 0x5048c728..0x5048c799, and
//           the go enables on the calling core, 0x50053ff6(300)) is high while (status & enable) bit 0 is set
//   +0x030, +0x040, +0x044, +0x048, +0x04c, +0x070, +0x074  written 1: the init +0x030 and +0x070, each start +0x040,
//           +0x048 and +0x074, the end +0x044, +0x04c and +0x070 (I: set and clear pairs of clock or power controls);
//           storage
//   parameters +0x080..+0x0c8, +0x0fc, +0x108, +0x380..+0x3ac: storage; a run reads those its mode names below
//   kind 6's blocks: its set-up 0x5050b328 also copies its parameter block through a base register into +0x10c..+0x1c0
//           and, by its +0x108, +0x1c4..+0x2cc (0), +0x2d0..+0x308 (1) or +0x30c..+0x368 (2): not in the model's map, a
//           bus error at the write; its op 3 copies the whole +0x380..+0x3ac (0x5050b512..28)
//   +0x3b0  kind 16's result (the handler copies it to the request's result word, 0x5048c06f): no run computes it, so a
//           read is UNKNOWN
// A run of op +0x108 = 3 (kind 14's set-up 0x5050b118 writes 3), computed only for kind 14's own program: +0x108,
// +0x380 and each word its mode lists below written since the last start, and no other parameter word (kind 6's op 3,
// which also writes +0x080..+0x08c, +0x0b4..+0x0c0 and every word of +0x380..+0x3ac, and kind 17, which writes no
// +0x380, are refused):
//   mode +0x380 = 4, the linear fill (the request without an image, 0x5050b18c..b3, as the fill 0x5048ee61 builds it):
//           destination dst with +0x084 = dst >> 4 and +0x390 = dst & 127 (the model takes dst from both and refuses
//           them when bits 4..6 disagree), +0x384 bytes, the value +0x398
//   mode +0x380 = 5, the rectangle fill (the request's image at its +32, 0x5050b132..88): the first row at +0x084 << 4
//           (the image's address >> 4 plus pitch * 2 * y >> 4), the pitch +0x0b8 << 4 bytes (pitch * 2 >> 4), the
//           column +0x390 bytes (x * 2), +0x394 = width in bytes (w * 2) | rows << 16, the value +0x398, +0x39c = 0
//   the value: the fill's 32-bit word, written as the CPU's little-endian store at a 4-byte aligned address (I; the
//           firmware composes it per pixel pair, 0x50490c89..a4: Y | Cb << 8 | Y << 16 | Cr << 24 for the image format
//           3074); a range that starts or ends off a 4-byte boundary is refused unless the value's 4 bytes are equal
//           (the word's phase there is not read)
//   the destination: bus addresses (src/dev/bus.mjs: the DRAM at 0xa0000000 and the live-view banks); a range outside
//           them is UNKNOWN
// A-IMGPRO-1: a run's bytes are written and its end raised RUN_NS of lab time after the start (I: the unit's time is
// not known; the firmware waits for the interrupt up to 1000 ms, 0x5049362a, so only the lab's pace depends on it).
// A width other than 4, an unaligned access, an address outside the map, a debugger write and a start while a run is in
// progress are UNKNOWN (a bus error, printed for a CPU access). Built by the machine on a board that gives imgpro
// (src/machine.mjs); passive until the firmware writes it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const IMGPRO_SIZE = 0x1000;
export const OFF = 0x000, ON = 0x004, STOP = 0x008, ARM = 0x00c, START = 0x018, STATUS = 0x020, ENABLE = 0x028;
export const OP = 0x108, MODE = 0x380, RESULT = 0x3b0;
export const S_END = 1;
// the words written 1 by the init, the starts and the end (their meaning I)
const CONTROLS = new Set([0x030, 0x040, 0x044, 0x048, 0x04c, 0x070, 0x074]);
// every parameter word an absolute operand of the driver names (0x5050af26..0x5050b547, the handler 0x5048bfe3)
const PARAMS = new Set([...Array.from({ length: 19 }, (_, i) => 0x080 + 4 * i), 0x0fc, 0x108, ...Array.from({ length: 12 }, (_, i) => 0x380 + 4 * i)]);
// a fill mode's words, each of which kind 14's set-up writes before every start of that mode (0x5050b118..b5)
const FILL_WORDS = { 4: [0x084, 0x384, 0x390, 0x398], 5: [0x084, 0x0b8, 0x390, 0x394, 0x398, 0x39c] };
export const OP_FILL = 3, LINEAR = 4, RECT = 5;
// A-IMGPRO-1: 1 ms of lab time a run
export const RUN_NS = 1e6;
export const RUNS_KEPT = 16;

export class Imgpro {
  // cfg: the board's imgpro {base, irq}; bus: the machine's om1.bus (src/dev/bus.mjs)
  constructor(machine, clock, intc, bus, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc; this.bus = bus;
    this.cfg = { base: cfg.base, irq: cfg.irq };
    this.regs = new Uint32Array(IMGPRO_SIZE / 4);
    this.status = 0; this.enable = 0;
    this.powered = false;              // the last of +0x000 / +0x004 written was +0x004 (I)
    this.armed = false;                // +0x00c written 1 since the last start
    this.written = new Set();          // the parameter words written since the last start
    this.due = Infinity; this.pending = null;
    this.runs = 0; this.touched = false;
    this.log = [];                     // the newest runs: {n, t_ns, op, mode, dst, bytes, rows, pitch, value}
    this.dropped = 0;
    intc.drive(this.cfg.irq);
    addRegion({ base: cfg.base, size: IMGPRO_SIZE, kind: K_MMIO, name: 'om1.imgpro',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    clock.add({ next: () => this.due, fire: (at) => this.complete(at) });
  }
  unknown(kind, off, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.imgpro UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  known(off) { return off === OFF || off === ON || off === STOP || off === ARM || off === START || off === STATUS || off === ENABLE || CONTROLS.has(off) || PARAMS.has(off); }
  busy() { return this.due !== Infinity; }
  update() { this.intc.setLine(this.cfg.irq, (this.status & this.enable & S_END) !== 0); }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    if (off === RESULT) return this.unknown('read', off, size, 0, dbg, 'kind 16\'s result: no run computes it');
    if (!this.known(off)) return this.unknown('read', off, size, 0, dbg);
    if (off === STATUS) return this.status;
    if (off === ENABLE) return this.enable;
    return this.regs[off >> 2];
  }
  write(off, value, size, dbg) {
    value >>>= 0;
    if (dbg || size !== 4 || (off & 3) || !this.known(off)) return this.unknown('write', off, size, value, dbg);
    this.touched = true;
    if (off === STATUS) { this.status = (this.status & ~value) >>> 0; this.update(); return; }
    if (off === ENABLE) {
      if (value & ~S_END) return this.unknown('write', off, size, value, dbg, 'an enable bit other than bit 0');
      this.enable = value; this.update(); return;
    }
    if (off === ARM || off === START) {
      if (value !== 1) return this.unknown('write', off, size, value, dbg, 'the start pair writes 1');
      if (off === ARM) { this.armed = true; this.regs[off >> 2] = value; return; }
      if (!this.armed) return this.unknown('write', off, size, value, dbg, '+0x018 without +0x00c since the last start');
      if (this.busy()) return this.unknown('write', off, size, value, dbg, 'a start while a run is in progress');
      if (!this.powered) return this.unknown('write', off, size, value, dbg, 'a start while powered down (+0x000 written last)');
      const why = this.start();
      // a refused start (a bus error, which stops a session) ends the program too
      if (why) { this.written.clear(); this.armed = false; return this.unknown('write', off, size, value, dbg, why); }
      this.regs[off >> 2] = value;
      return;
    }
    if (off === ON) this.powered = true;
    if (off === OFF) this.powered = false;
    if (PARAMS.has(off)) this.written.add(off);
    this.regs[off >> 2] = value;
  }
  r(off) { return this.regs[off >> 2]; }
  // A start: the run's operation from the parameters written since the last start, or the reason it is refused
  start() {
    const op = this.r(OP), mode = this.r(MODE);
    if (op !== OP_FILL || (mode !== LINEAR && mode !== RECT)) return `op ${op} mode ${mode}: only kind 14's fills (op 3, modes 4 and 5) are modelled`;
    const need = [OP, MODE, ...FILL_WORDS[mode]].filter((o) => !this.written.has(o));
    if (need.length) return `the fill's ${need.map((o) => '+0x' + o.toString(16)).join(', ')} not written since the last start`;
    const extra = [...this.written].filter((o) => o !== OP && o !== MODE && !FILL_WORDS[mode].includes(o));
    if (extra.length) return `${extra.map((o) => '+0x' + o.toString(16)).join(', ')} written since the last start: kind 14's mode ${mode} writes only its own words`;
    const value = this.r(0x398), uniform = ((value & 0xff) * 0x01010101) >>> 0 === value;
    let run;
    if (mode === LINEAR) {
      const hi = (this.r(0x084) << 4) >>> 0, lo = this.r(0x390), bytes = this.r(0x384);
      if (lo > 127 || (hi & 0x70) !== (lo & 0x70)) return `the linear fill's +0x084 ${hex8(this.r(0x084))} and +0x390 ${hex8(lo)} name different addresses`;
      const dst = ((hi & ~0x7f) | lo) >>> 0;
      run = { dst, bytes, rows: 1, pitch: bytes };
    } else {
      const span = this.r(0x394);
      if (this.r(0x39c) !== 0) return `the rectangle fill's +0x39c ${hex8(this.r(0x39c))}: only 0 is read`;
      run = { dst: ((this.r(0x084) << 4) + this.r(0x390)) >>> 0, bytes: span & 0xffff, rows: span >>> 16, pitch: (this.r(0x0b8) << 4) >>> 0 };
    }
    const { dst, bytes, rows, pitch } = run;
    if (!bytes || !rows) return `an empty fill (${bytes} bytes, ${rows} rows)`;
    if (rows > 1 && pitch < bytes) return `rows of ${bytes} bytes at a pitch of ${pitch}`;
    const aligned = (dst & 3) === 0 && (bytes & 3) === 0 && (rows === 1 || (pitch & 3) === 0);
    if (!aligned && !uniform) return `the value ${hex8(value)} at ${hex8(dst)} (${bytes} bytes a row, pitch ${pitch}): its phase off a 4-byte boundary is not read`;
    const last = dst + (rows - 1) * pitch;
    if (!this.bus.span(dst, bytes) || !this.bus.span(last, bytes) || (rows > 1 && !this.bus.span(dst, last + bytes - dst))) return `the fill's ${rows} rows of ${bytes} bytes from ${hex8(dst)} (pitch ${pitch}) are not on the bus's memory`;
    this.runs += 1;
    this.pending = { n: this.runs, t_ns: this.clock.t, op, mode, dst, bytes, rows, pitch, value };
    this.written.clear();
    this.armed = false;
    this.due = this.clock.t + RUN_NS;
    return null;
  }
  // the lab clock: the run's bytes written, its end raised
  complete(at) {
    if (this.due > at) return;
    const p = this.pending;
    this.due = Infinity; this.pending = null;
    const row = new Uint8Array(p.bytes);
    for (let i = 0; i < p.bytes; i++) row[i] = (p.value >>> (8 * ((p.dst + i) & 3))) & 0xff;
    for (let k = 0; k < p.rows; k++) this.bus.write(p.dst + k * p.pitch, row);
    this.log.push(p);
    if (this.log.length > RUNS_KEPT) { this.log.shift(); this.dropped += 1; }
    this.status = (this.status | S_END) >>> 0;
    this.update();
  }
  // the newest run, or null before the first end
  last() { return this.log.at(-1) ?? null; }
}
