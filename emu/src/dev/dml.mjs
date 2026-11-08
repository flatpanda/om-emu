// S-DML: the DML engine (board dml; docs/om1-subject-spec.md 2.1, 5.2 and 5.3), the unit CPU 3's MDET_DL code runs the
// subject network on. A register file at the board's base with the behaviour the firmware's driver relies on; the
// network itself is not modelled, and the engine writes no detection (all scores 0). The driver's addresses are in
// src/fw/board.mjs dml's comment and the spec's section 2.1, with their evidence.
//
//   +0x000  control: the power-up writes 2, the power-down 3, the start 0 and the completion handler 2 (storage)
//   +0x004  status: bit 14 the run's completion (I: the handler tests it and writes the value it read back, so the
//           bits are write 1 to clear); a read returns it, a write clears the bits it has set
//   +0x008  written 0xffff before each start (storage; I: an interrupt mask, which the model does not apply)
//   +0x010  start: a write of 1 starts a run (any other value is UNKNOWN); the register image written since the last
//           start is kept as that run's (images, the debug API's dml op and the tests read it), the output area is
//           zeroed and the run completes after RUN_NS of lab time: bit 14 of +0x004 is set and IRQ dml.irq raised,
//           high while the bit is set (A-DML-1)
//   +0x1118 the output area's address >> 4, +0x111c the records per class: the run writes CLASSES classes of that many
//           16-byte records from the address on (I: MDET reads 9 classes, its count of them is 9 for every kind, and
//           a record of score 0 is an empty slot)
//   +0x1400..+0x142c the power words: 1 to +0x1408 / +0x1418 / +0x140c / +0x141c with 7 to +0x1420 / +0x1424 at the
//           power-up, 1 to +0x1400 / +0x1410 / +0x1404 / +0x1414 with 7 to +0x1428 / +0x142c at the power-down (I: SRAM
//           power and retention controls); a start while the last of them was a power-down write is UNKNOWN
//   the rest of +0x000..+0x1fff: storage, the run's configuration (about 970 registers: the stage descriptors, the
//           head, the input planes' addresses), read by nothing in the model; a read returns the last value written (the
//           driver reads back +0x1a08, +0x1a48, +0x1a88 and +0x1aac to set and clear bits in them when the system
//           clock's record changes, D: board dml's comment)
// A width other than 4, an unaligned access, a debugger write, a start while a run is in progress and an output area
// outside the DRAM are UNKNOWN (a bus error, printed for a CPU access). The weights
// and the feature maps the stage descriptors address (0x9xxxxxxx) are not read. Built by the machine on a board that
// gives dml (src/machine.mjs); passive until the firmware writes it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const DML_SIZE = 0x2000;
export const CTRL = 0x000, STATUS = 0x004, START = 0x010, OUT_ADDR = 0x1118, OUT_COUNT = 0x111c;
export const S_DONE = 0x4000, CLASSES = 9, RECORD = 16;
const POWER_UP = new Set([0x1408, 0x1418, 0x140c, 0x141c]), POWER_DOWN = new Set([0x1400, 0x1410, 0x1404, 0x1414]);
// A-DML-1: a run takes 10 ms of lab time (I: the engine's time per frame is not known; MDET waits for the interrupt
// without a timeout, so only the lab's pace depends on it)
export const RUN_NS = 10e6;
// the runs whose register images are kept (the newest; older ones are counted and dropped)
export const IMAGES_KEPT = 16;

export class Dml {
  // cfg: the board's dml {base, irq}
  constructor(machine, clock, intc, bus, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc; this.bus = bus;
    this.cfg = { base: cfg.base, irq: cfg.irq };
    this.regs = new Uint32Array(DML_SIZE / 4);
    this.written = new Map();          // offset -> value written since the last start (the next run's image)
    this.status = 0;
    this.powered = false;              // the last power word written was a power-up's
    this.due = Infinity;               // the run in progress completes at this lab ns
    this.runs = 0;                     // starts so far
    this.images = [];                  // the newest runs: {n, t_ns, regs: [[offset, value]...], out: [address, bytes]}
    this.dropped = 0;                  // images dropped from the front of images
    addRegion({ base: cfg.base, size: DML_SIZE, kind: K_MMIO, name: 'om1.dml',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    intc.drive(cfg.irq);
    clock.add({ next: () => this.due, fire: (at) => this.complete(at) });
  }
  unknown(kind, off, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.dml UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  pending() { return (this.status & S_DONE) !== 0; }
  update() { this.intc.setLine(this.cfg.irq, this.pending()); }
  busy() { return this.due !== Infinity; }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    if (off === STATUS) return this.status;
    return this.regs[off >> 2];
  }
  write(off, value, size, dbg) {
    value >>>= 0;
    if (dbg || size !== 4 || (off & 3)) return this.unknown('write', off, size, value, dbg);
    if (off === STATUS) { this.status = (this.status & ~value) >>> 0; this.update(); return; }
    if (off === START) {
      if (value !== 1) return this.unknown('write', off, size, value, dbg, 'a start writes 1');
      if (!this.powered) return this.unknown('write', off, size, value, dbg, 'a start while powered down');
      if (this.busy()) return this.unknown('write', off, size, value, dbg, 'a start while a run is in progress');
      return this.start(off, size, value);
    }
    if (POWER_UP.has(off) && value === 1) this.powered = true;
    if (POWER_DOWN.has(off) && value === 1) this.powered = false;
    this.regs[off >> 2] = value;
    this.written.set(off, value);
  }
  // A start: the image written since the last one kept, the output area zeroed, the completion due after RUN_NS
  start(off, size, value) {
    const out = (this.regs[OUT_ADDR >> 2] << 4) >>> 0, count = this.regs[OUT_COUNT >> 2], bytes = CLASSES * count * RECORD;
    if (!count || !this.bus.span(out, bytes)) return this.unknown('write', off, size, value, false, `the output area ${hex8(out)}, ${count} records per class, is not in the DRAM`);
    this.bus.write(out, new Uint8Array(bytes));
    this.runs += 1;
    this.images.push({ n: this.runs, t_ns: this.clock.t, regs: [...this.written].sort((a, b) => a[0] - b[0]), out: [out, bytes] });
    if (this.images.length > IMAGES_KEPT) { this.images.shift(); this.dropped += 1; }
    this.written.clear();
    this.due = this.clock.t + RUN_NS;
  }
  // the lab clock: the run completes at `at`
  complete(at) {
    this.due = Infinity;
    this.status = (this.status | S_DONE) >>> 0;
    this.update();
  }
  // the newest run's image as {n, t_ns, regs: {offset: value}, out}, or null before the first start
  last() {
    const im = this.images.at(-1);
    return im ? { n: im.n, t_ns: im.t_ns, regs: Object.fromEntries(im.regs), out: im.out } : null;
  }
}
