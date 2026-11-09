// S-EMS1: the EMS1 engine (board ems1; docs/om1-subject-spec.md 2.4 and 5.9), the camera front end's five-area motion
// and statistics engine that take_mov's per-frame run and four other clients (TAKE_MOV, MDET's frame vectors and two
// more; I which is which) share through one queueing driver on CPU 0 (0x501a5bb2..0x501a8dec; the strings
// "[ EMS1_DRV_PRM ]" and "EMS1_DRV_INT1".."EMS1_DRV_INT5_ERR" name it, D). A register file at the board's base with the
// behaviour the driver relies on; the engine's computation is not modelled: it writes nothing to memory (its outputs
// go by DMA to the buffers the area words dma_* name, which only the clients read) and its result RAMs read the lab's
// words or 0.
// The driver's addresses and their evidence are in src/fw/board.mjs ems1's comment and the spec's 2.4.
//
//   +0x000  the engine's state word (I): 2 at the power-up and after a run (the handler's write), 3 at the power-down,
//           0 written by the start before its parameters; storage. A run starts only while it is 0
//   +0x004  status: a run's completion sets bit 5k + 4 for each area channel k it ran (the handler's per-channel bits
//           0x01084210, "EMS1_DRV_INTk", D); the handler reads the word and writes it back (write 1 to clear, I); the
//           IRQ is high while a bit is set. Bits 25 (the pause the handler stops on) and 26..30 (the channels' errors)
//           are never set
//   +0x008  the start word (0x501a5cbd): bit 5k + 4 runs channel k, bits 5k..5k+2 a per-channel field from its ae_2
//           word, bit 25 always, bits 26 + k with each channel (I); a write with a channel bit while +0x000 is 0 starts
//           a run of those channels, which completes after RUN_NS of lab time (A-EMS1-1); 0 (the handler's stop) is
//           storage; the parameter registers written since the last start are kept as the run's image
//   +0x010  written 1 by the handler on an error bit (I: an acknowledge); storage
//   +0x014  control1 (the job's +8), read back by the channel callback's path (0x501a66ec: bits 0..9); storage
//   +0x018  the block trigger (0x501a5de9: four bits per channel from the job's request): 0 is storage; a nonzero
//           write is UNKNOWN (what a block is, and how a triggered block completes, is not read)
//   +0x01c, +0x020  control3 (the job's +12) and a per-channel bit word (set and cleared by 0x501a8ba5 / 0x501a8bec
//           around MDET's frame-vector read); storage
//   common parameters (0x501a5ec9: the job's +16..+0x128, "cb1_5".."dma1_17"): +0x0d4..+0x0f8, +0x104..+0x170,
//           +0x188..+0x1a8, +0x1b0..+0x1d0, +0x210..+0x248, +0x2a4, +0x2a8; storage
//   per area channel k < 5, at +0x400 k: the 65 registers of the table 0x602a3820 + 0x108 k (ae_1..5, pos_1..20,
//           cb_*, dma_1..15, cor_1..11, st_1..11; written from the job's +0x14c + 0x10c k); storage
//   +0x30c..+0x328  the power words (1 written to +0x310 / +0x318 / +0x31c / +0x324 at the power-up, to +0x30c /
//           +0x314 / +0x320 / +0x328 at the power-down; I: SRAM power); storage
//   +0x1808..+0x181c, +0x1848..+0x185c, +0x186c  two tables of six words loaded when the system clock's record
//           changes (0x501a6535; bit 16 of +0x1808 and +0x1848 set and cleared, +0x186c held at 1 around the load);
//           storage
//   tables (0x501a61a7..0x501a62c9: each word written, read back and rewritten until equal, up to 1000 times): +0x4000
//           and +0x5000, the job's first table pair, up to 936 words each (the job check 0x501a70c7 allows 0x3a8),
//           +0x6000 and +0x6400, the second pair, 256 words each (the gap to +0x6400; a longer second table, which the
//           check would allow, is not modelled); storage that reads back what was written
//   result RAMs, one per channel k at +0x7000 + 0x1000 k: words {bits 16..25, bits 0..7, bits 8..15} MDET's
//           frame-vector task reads (0x501a8c42 from 0x507fc569); read only: the lab's words, 0 without them (the
//           window's extent, 1024 words, is I)
// An address outside these, a width other than 4, an unaligned access, a debugger write and a start while a run is in
// progress are UNKNOWN (a bus error, printed for a CPU access). Built by the machine on a board that gives ems1
// (src/machine.mjs); passive until the firmware writes it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const EMS1_SIZE = 0xC000;
export const STATE = 0x000, STATUS = 0x004, START = 0x008, ERR_ACK = 0x010, CONTROL1 = 0x014, TRIGGER = 0x018;
export const CHANNELS = 5;
// a channel's completion bit in the status and its run bit in the start word: 5k + 4 (D: the handler's mask 0x01084210
// and the start's 0x10, 0x200, 0x4000, 0x80000, 0x1000000)
export const chBit = (k) => (1 << (5 * k + 4)) >>> 0;
// the per-channel area registers' offsets in channel 0's page (D: the table 0x602a3820, its 66 entries less channel 0's
// empty one; channel k at +0x400 k, the same offsets, plus +0x1e4 from the second, which channel 0 does not use)
const AREA = [0x40, 0x44, 0x48, 0x4c, 0x50, ...Array.from({ length: 20 }, (_, i) => 0x60 + 4 * i), 0xc0, 0xd0, 0x100, 0x180, 0x1e0, 0x24c,
  0x260, 0x264, 0x268, 0x26c, 0x270, 0x280, 0x284, 0x290, 0x294, 0x298, 0x29c, 0x2a0, ...Array.from({ length: 11 }, (_, i) => 0x2b0 + 4 * i),
  ...Array.from({ length: 11 }, (_, i) => 0x2e0 + 4 * i)];
// the common words the driver writes (control1, control3 and the channel bits, the common parameters, the power
// words and the clock tables): storage, kept in the run's image
const COMMON = [[0x014, 0x014], [0x01c, 0x020], [0x0d4, 0x0f8], [0x104, 0x170], [0x188, 0x1a8], [0x1b0, 0x1d0], [0x210, 0x248],
  [0x2a4, 0x2a8], [0x30c, 0x328], [0x1808, 0x181c], [0x1848, 0x185c], [0x186c, 0x186c]];
export const TABLES = [[0x4000, 936], [0x5000, 936], [0x6000, 256], [0x6400, 256]];
export const RESULT = 0x7000, RESULT_STRIDE = 0x1000, RESULT_WORDS = 1024;
// A-EMS1-1: a run takes 1 ms of lab time (I: the engine's time per frame is not known; the driver waits for the
// interrupt, so only the lab's pace depends on it)
export const RUN_NS = 1e6;
export const IMAGES_KEPT = 16;
const inRanges = (off, rs) => rs.some(([a, b]) => off >= a && off <= b);

export class Ems1 {
  // cfg: the board's ems1 {base, irq}
  constructor(machine, clock, intc, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc;
    this.cfg = { base: cfg.base, irq: cfg.irq };
    this.regs = new Uint32Array(EMS1_SIZE / 4);
    this.regs[STATE >> 2] = 3;    // powered down until the driver's power-up writes 2 (I)
    this.area = new Set();
    for (let k = 0; k < CHANNELS; k++) for (const o of AREA) this.area.add(0x400 * k + o);
    for (let k = 1; k < CHANNELS; k++) this.area.add(0x400 * k + 0x1e4);
    this.status = 0; this.due = Infinity; this.running = 0; this.runs = 0;
    this.touched = false;         // a CPU write made (the player's stand-in list)
    this.written = new Map(); this.images = []; this.dropped = 0;
    this.source = null;           // the lab's result words: (channel, params) -> {word index: value}
    intc.drive(this.cfg.irq);
    addRegion({ base: cfg.base, size: EMS1_SIZE, kind: K_MMIO, name: 'om1.ems1',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    clock.add({ next: () => this.due, fire: (at) => this.complete(at) });
  }
  unknown(kind, off, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.ems1 UNKNOWN ${kind} ${hex8(this.cfg.base + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  table(off) { return TABLES.some(([a, n]) => off >= a && off < a + 4 * n); }
  result(off) { return off >= RESULT && off < RESULT + CHANNELS * RESULT_STRIDE && (off - RESULT) % RESULT_STRIDE < 4 * RESULT_WORDS; }
  param(off) { return inRanges(off, COMMON) || this.area.has(off); }
  known(off) { return off === STATE || off === STATUS || off === START || off === ERR_ACK || off === TRIGGER || this.param(off) || this.table(off) || this.result(off); }
  pending() { return this.status !== 0; }
  busy() { return this.due !== Infinity; }
  update() { this.intc.setLine(this.cfg.irq, this.status !== 0); }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3) || !this.known(off)) return this.unknown('read', off, size, 0, dbg);
    if (off === STATUS) return this.status;
    return this.regs[off >> 2];
  }
  write(off, value, size, dbg) {
    value >>>= 0;
    if (dbg || size !== 4 || (off & 3) || !this.known(off)) return this.unknown('write', off, size, value, dbg);
    this.touched = true;
    if (off === STATUS) { this.status = (this.status & ~value) >>> 0; this.update(); return; }
    if (this.result(off)) return this.unknown('write', off, size, value, dbg, 'the result RAMs are the engine\'s');
    if (off === TRIGGER && value) return this.unknown('write', off, size, value, dbg, 'a block trigger: not modelled');
    if (off === START) {
      const ch = this.channels(value);
      if (ch) {
        if (this.busy()) return this.unknown('write', off, size, value, dbg, 'a start while a run is in progress');
        if (this.regs[STATE >> 2] !== 0) return this.unknown('write', off, size, value, dbg, `a start with the state word ${this.regs[STATE >> 2]}, not 0`);
        this.regs[off >> 2] = value;
        return this.start(ch, value);
      }
    }
    if (this.param(off)) this.written.set(off, value);
    this.regs[off >> 2] = value;
  }
  // the channels a start word runs (a mask of k < 5)
  channels(word) { let m = 0; for (let k = 0; k < CHANNELS; k++) if (word & chBit(k)) m |= 1 << k; return m; }
  // A start: the parameters written since the last one kept, the result RAMs of its channels set from the lab's source
  // (its words by index, the rest 0), the completion due after RUN_NS
  start(ch, word) {
    const params = this.params();
    for (let k = 0; k < CHANNELS; k++) {
      if (!(ch & (1 << k))) continue;
      const base = (RESULT + RESULT_STRIDE * k) >> 2, words = this.source ? this.source(k, params) : {};
      this.regs.fill(0, base, base + RESULT_WORDS);
      for (const [i, v] of Object.entries(words)) {
        const n = Number(i);
        if (!(Number.isInteger(n) && n >= 0 && n < RESULT_WORDS && Number.isInteger(v))) throw new Error(`S-EMS1: the lab's result word ${JSON.stringify([i, v])} of channel ${k} is not one of its RAM's`);
        this.regs[base + n] = v >>> 0;
      }
    }
    this.runs += 1;
    this.running = ch;
    this.images.push({ n: this.runs, t_ns: this.clock.t, start: word, channels: ch, params: [...this.written].sort((a, b) => a[0] - b[0]) });
    if (this.images.length > IMAGES_KEPT) { this.images.shift(); this.dropped += 1; }
    this.written.clear();
    this.due = this.clock.t + RUN_NS;
  }
  // the parameter registers as they stand (offset -> value), what the source may read
  params() {
    const out = {};
    for (const [a, b] of COMMON) for (let o = a; o <= b; o += 4) out[o] = this.regs[o >> 2];
    for (const o of this.area) out[o] = this.regs[o >> 2];
    return out;
  }
  // the lab clock: the run completes, each channel it ran with its bit
  complete(at) {
    if (this.due > at) return;
    this.due = Infinity;
    for (let k = 0; k < CHANNELS; k++) if (this.running & (1 << k)) this.status = (this.status | chBit(k)) >>> 0;
    this.running = 0;
    this.update();
  }
  // the newest run as {n, t_ns, start, channels, params: {offset: value}}, or null before the first start
  last() {
    const im = this.images.at(-1);
    return im ? { n: im.n, t_ns: im.t_ns, start: im.start, channels: im.channels, params: Object.fromEntries(im.params) } : null;
  }
}
