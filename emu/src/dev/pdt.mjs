// S-PDT: the PDT / TRC unit (board pdt; docs/om1-subject-spec.md 2.2 and 5.8), the two engines LAF's tracking on CPU 3
// drives: PDT (page +0x2000, IRQ pdt) and TRC, the colour tracker (page +0x3000, IRQ trc). A register file at the
// board's base with the behaviour the firmware's drivers rely on; neither engine's computation is modelled: what a run
// writes to its result registers is the lab's (source, below), zeros without it. The drivers' addresses and their
// evidence are in src/fw/board.mjs pdt's comment and the spec's 2.2.
//
//   common page (trac_drv_*: 0x507fa1e9..0x507fa937)
//   +0x000  the unit's reset (I): 0 at the first open, 1 at the last close (storage); a start while it is 1 is UNKNOWN
//   +0x004  a second reset or hold (I): 0 at the first open after the clock goes on, 1 at the last close (storage);
//           a start while it is 1 is UNKNOWN
//   +0x010  read back after the open's, the close's and the LLF load's writes (I: a posted-write flush); reads 0
//   +0x108..+0x11c, +0x148..+0x15c  two LLF tables of six words each (0x507fa7ac: from the parameter block's +0xf30 and
//           +0xf48, then bit 16 of +0x108 and of +0x148 set and cleared, I: a load strobe), +0x16c bit 0 held while
//           they load: storage
//   each engine's page, PDT at +0x2000, TRC at +0x3000 (pdt_drv_* 0x507f90c8..0x507f9b4d, trc_drv_* 0x507fa937..
//   0x507fbdd1)
//   +0x000  the engine's reset (I): 0 at the first open, 1 at the last close (storage); a start while 1 is UNKNOWN
//   +0x004  1 while the driver writes the engine's parameters (the open's 0, the close's 1, the start's 1 then 0; I: a
//           shadow-register write enable): storage
//   +0x008  status: a run's completion sets bit 0 (I: the handler reads the word and writes it back, so its bits are
//           write 1 to clear; which bit is ?); the IRQ is high while a bit is set
//   +0x00c  written 1 before each start (I: a clear), +0x010 and +0x014 the close's and the open's words (PDT 3, 3;
//           TRC 1 and bits 0 and 1): storage
//   +0x018  start: a write with bit 0 set starts a run (TRC's open sets bit 1 alone, storage); the parameter registers
//           written since the last start are kept as the run's image (the debug API's pdt op), the result registers
//           take the lab's source's words, and the run completes after RUN_NS of lab time (A-PDT-1)
//   parameters: PDT +0x201c..+0x21fc; TRC +0x301c..+0x3334 and +0x35c0..+0x362c (storage)
//   results: PDT +0x2200..+0x225c (24 words), TRC +0x3338..+0x35a4 (156 words): the driver only reads them
//           (pdt_drv_get_result 0x507f99e0, trc_drv_get_result 0x507fb681); a write is UNKNOWN; a run sets them all,
//           to 0 where the lab's source gives no word
// An address outside these, a width other than 4, an unaligned access, a debugger write and a start while that
// engine runs are UNKNOWN (a bus error, printed for a CPU access). The YC frames the parameters address are not read.
// Built by the machine on a board that gives pdt (src/machine.mjs); passive until the firmware writes it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const PDT_SIZE = 0x4000;
export const RESET = 0x000, HOLD = 0x004, FLUSH = 0x010;
const LLF = [[0x108, 0x11c], [0x148, 0x15c], [0x16c, 0x16c]];
// an engine's page: its base, its words, its parameter ranges and its result range [first, last] (D: the drivers'
// operands, 0x9be02000..0x9be0225c and 0x9be03000..0x9be0362c, 558 addresses in all with the common page's)
export const ENGINES = {
  pdt: { page: 0x2000, params: [[0x201c, 0x21fc]], result: [0x2200, 0x225c] },
  trc: { page: 0x3000, params: [[0x301c, 0x3334], [0x35c0, 0x362c]], result: [0x3338, 0x35a4] },
};
export const E_RESET = 0x000, E_WRITE = 0x004, E_STATUS = 0x008, E_CLEAR = 0x00c, E_CLOSE = 0x010, E_OPEN = 0x014, E_START = 0x018;
export const S_DONE = 0x1;
// A-PDT-1: a run of either engine takes 2 ms of lab time (I: neither engine's time per frame is known; the drivers
// wait for the interrupt, so only the lab's pace depends on it)
export const RUN_NS = 2e6;
// the runs whose images are kept per engine (the newest)
export const IMAGES_KEPT = 16;
const inRanges = (off, rs) => rs.some(([a, b]) => off >= a && off <= b);

export class Pdt {
  // cfg: the board's pdt {base, irqs: {pdt, trc}}
  constructor(machine, clock, intc, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc;
    this.cfg = { base: cfg.base, irqs: { ...cfg.irqs } };
    this.regs = new Uint32Array(PDT_SIZE / 4);
    // per engine: the status, the run in progress (due), the runs, the parameter writes since the last start, the
    // newest runs' images {n, t_ns, params: [[offset, value]...], result: words written}, the lab's source
    this.e = {};
    for (const name of Object.keys(ENGINES)) {
      this.e[name] = { status: 0, due: Infinity, runs: 0, written: new Map(), images: [], dropped: 0, source: null };
      intc.drive(this.cfg.irqs[name]);
    }
    this.regs[RESET >> 2] = 1; this.regs[HOLD >> 2] = 1;
    for (const { page } of Object.values(ENGINES)) this.regs[page >> 2] = 1;
    addRegion({ base: cfg.base, size: PDT_SIZE, kind: K_MMIO, name: 'om1.pdt',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    clock.add({ next: () => Math.min(...Object.values(this.e).map((x) => x.due)), fire: (at) => this.complete(at) });
  }
  unknown(kind, off, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.pdt UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  // the engine whose page holds off and the register's offset within it, or null for the common page
  engine(off) {
    for (const [name, E] of Object.entries(ENGINES)) if (off >= E.page && off < E.page + 0x1000) return [name, E, off - E.page];
    return null;
  }
  known(off) {
    if (off === RESET || off === HOLD || off === FLUSH || inRanges(off, LLF)) return true;
    const en = this.engine(off);
    if (!en) return false;
    const [, E, r] = en;
    return r <= E_START || inRanges(off, E.params) || (off >= E.result[0] && off <= E.result[1]);
  }
  pending(name) { return (this.e[name].status & S_DONE) !== 0; }
  busy(name) { return this.e[name].due !== Infinity; }
  update(name) { this.intc.setLine(this.cfg.irqs[name], this.e[name].status !== 0); }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3) || !this.known(off)) return this.unknown('read', off, size, 0, dbg);
    const en = this.engine(off);
    if (en && en[2] === E_STATUS) return this.e[en[0]].status;
    if (off === FLUSH) return 0;
    return this.regs[off >> 2];
  }
  write(off, value, size, dbg) {
    value >>>= 0;
    if (dbg || size !== 4 || (off & 3) || !this.known(off)) return this.unknown('write', off, size, value, dbg);
    const en = this.engine(off);
    if (en) {
      const [name, E, r] = en, x = this.e[name];
      if (r === E_STATUS) { x.status = (x.status & ~value) >>> 0; this.update(name); return; }
      if (off >= E.result[0] && off <= E.result[1]) return this.unknown('write', off, size, value, dbg, `${name}'s result registers are the run's`);
      if (r === E_START && (value & 1)) {
        if (this.regs[RESET >> 2] || this.regs[HOLD >> 2] || this.regs[E.page >> 2]) return this.unknown('write', off, size, value, dbg, `a start of ${name} while the unit or the engine is held in reset`);
        if (this.busy(name)) return this.unknown('write', off, size, value, dbg, `a start of ${name} while its run is in progress`);
        this.regs[off >> 2] = value;
        return this.start(name, E);
      }
      if (inRanges(off, E.params)) x.written.set(off, value);
    }
    this.regs[off >> 2] = value;
  }
  // A start: the parameters written since the last one kept, the result registers set from the lab's source (its
  // words by result offset, the rest 0), the completion due after RUN_NS
  start(name, E) {
    const x = this.e[name], words = x.source ? x.source(this.params(name)) : {};
    for (let o = E.result[0]; o <= E.result[1]; o += 4) this.regs[o >> 2] = 0;
    for (const [k, v] of Object.entries(words)) {
      const o = Number(k);
      if (!(o >= E.result[0] && o <= E.result[1] && !(o & 3)) || !Number.isInteger(v)) throw new Error(`S-PDT: the lab's ${name} result word ${JSON.stringify([k, v])} is not one of its result registers`);
      this.regs[o >> 2] = v >>> 0;
    }
    x.runs += 1;
    x.images.push({ n: x.runs, t_ns: this.clock.t, params: [...x.written].sort((a, b) => a[0] - b[0]), result: Object.keys(words).length });
    if (x.images.length > IMAGES_KEPT) { x.images.shift(); x.dropped += 1; }
    x.written.clear();
    x.due = this.clock.t + RUN_NS;
  }
  // the engine's parameter registers as they stand (offset -> value), what its source may read
  params(name) {
    const out = {};
    for (const [a, b] of ENGINES[name].params) for (let o = a; o <= b; o += 4) out[o] = this.regs[o >> 2];
    return out;
  }
  // the lab clock: each run due at `at` completes
  complete(at) {
    for (const [name, x] of Object.entries(this.e)) {
      if (x.due > at) continue;
      x.due = Infinity;
      x.status = (x.status | S_DONE) >>> 0;
      this.update(name);
    }
  }
  // the newest run of an engine as {n, t_ns, params: {offset: value}, result}, or null before its first start
  last(name) {
    const im = this.e[name].images.at(-1);
    return im ? { n: im.n, t_ns: im.t_ns, params: Object.fromEntries(im.params), result: im.result } : null;
  }
}
