// S-IMGPIPE: the image library's pipeline block at 0x9c200000 and the JPEG codec at 0x99900000 (board imgpipe;
// docs/hle-gaps.md 4.8.13), as far as the play module's view decode drives them: the library's request kind 10, which
// its generic handler 0x5046d994 runs (the parameters' packing 0x504809ec into a register image, the units' set-up
// 0x5048134d, the go 0x504814d2, the end 0x504814ef). A register file with the behaviour the driver relies on, and one
// program computed: the codec decodes a baseline JPEG from memory and the resizer scales the picture into a display
// buffer. Every other program is refused (a bus error at the start), so nothing the lab does not know is computed.
// Evidence D unless tagged; addresses E143's.
//
// The block's units: the set-up writes each unit's words from its part of the register image, by the bit of the
// image's three unit masks A, B and C at its +0, +4 and +8 (0x50481cd5..0x50482224). The decode's masks are A 0x80301,
// B 0x100001 and C 0x107 (X), which the model's start requires. Their units: +0x400 (A bit 0; what it does is ?),
// +0x2e00 (A bit 8, the prefilter), +0x2400 (A bit 9, the resizer's map), +0x800 (B bit 0, the output), +0xb400 (B
// bit 20, the resizer, with its program of 0x13a2 words copied from the image's table 0x5063a040 to +0x20000,
// 0x50482e38), +0xb000 (C bit 0, the codec's output), +0xb080 and +0x3a00 (C bit 1, the codec's side), +0xae00 (C
// bit 2, the codec's stream), and +0xc00 (0x50481c53, 0x50482444, always written). A bit 19 and C bit 8 have no
// pages of their own on this path (X).
//   +0x000..+0x2fc  the block's own words, only those the decode writes (OWN, X); any other is UNKNOWN:
//     +0x000 / +0x004, +0x010 / +0x014, +0x018 / +0x01c  written with the masks A, B and C: +0x004, +0x014, +0x01c by
//           the set-up (0x50481393..a9), +0x000, +0x010, +0x018 by the end (0x50481715..25); storage (I: set and
//           clear pairs)
//     +0x020, +0x024, +0x030..+0x03c, +0x0c8, +0x130, +0x150, +0x154, +0x248..+0x254, +0x260..+0x26c, +0x2d8..+0x2e8,
//           +0x2f0, +0x2f4  the go's, the end's and the clock words' (0x5048d48a, 0x5048d53a) writes: storage
//     +0x0cc, +0x0e8, +0x0f4  the go's starts (0x5048198b: +0x0c8 = 0x102 and +0x0cc = 5 after the codec's own start,
//           then +0x0e8 = B & 0x700000 and last +0x0f4 = 5): the model starts a run at +0x0f4 written 5 after the
//           other three (I: which word starts which unit is not read)
//     +0x10c, +0x110, +0x11c, +0x120, +0x12c  statuses, write 1 to clear (the handler writes back what it read,
//           0x5048bbc6..cf; the end writes the unit masks, 0x504815dd..0x50481611). The model sets +0x120 bit 20, the
//           resizer's end
//     +0x134, +0x13c, +0x140  IRQ 288's enables of +0x110, +0x120 and +0x12c (the handler 0x5048bb88 ands each pair
//           and clears the three enables): the line is high while a pair has a common bit (I, from the handler)
//     +0x228, +0x2b4  read, masked and written back by the set-up and the end (0x50481c62, 0x504813c8, 0x5048150d):
//           storage
//     +0x2f8  written 0x2611 after the clock words; the driver then waits until its low byte reads 0 (0x5048d523..
//           2f): the low byte reads 0 at once (I: the hardware's time)
//   +0xb470  written 0x47f after the resizer's words (0x50482bc6..ce): storage; +0xb478 its interrupt enable; +0xb47c
//           its status, which the handler reads with +0xb478: bit 0 the end (the callback's phase 12, 0x5048bcba; but
//           where the record's halfword +44 has bit 5 the handler writes +0x1b4 = 0x800000 and returns, 0x5048bc05..19,
//           not taken here, X), bit 1 another end (phase 12 with the record's halfword +46, I: an error). The set-up
//           writes it 0 from the image (X); the model sets bit 0 at a run's end
// The codec's words (its start 0x5050a2ba with mode 0, the decode): +0x000c written 4, then 0 after a short loop
// (0x5050a2d2..e4), and 5 by the end (0x50481657); +0x0008 = 0 (1 for an encode); +0x1000 = 0x8004, +0x100c = 0x8002,
// +0x1028 = +0x102c = 0xffff, then +0x1000 read and written back with bit 0 set (0x5050a4a5..a9): the codec's start.
// +0x0004 and +0x1004 are its init's (0x5050a282). The encode's words (+0x1014, +0x1058.., the tables at +0x1200..,
// +0x1c00..) are not in the map: a bus error. The driver reads no codec status on this path (X).
//
// The program's words, each written since the last run (the set-up writes all of them before every go):
//   +0xae00 = 2 and +0xae04 the stream's address, the request's source word 0 (0x50477451..54): the file from SOI (X);
//           +0xae0c = +0xae10 = 0xffffffff (no limit: the model reads to the stream's EOI)
//   +0xb004 = 1 and +0xb088 bits 2..0 = 1: the mode of 8-line MCUs (0x504772af..bf, 0x5047733b..43; X: the request's
//           source format 7170, a 4:2:2 picture); another mode is refused. +0xb08c the MCUs a row, ceil(width / 16),
//           +0xb080 the MCU rows, ceil(height / 8)
//           (0x504772d5..fe); +0xb00c the codec's output address >> 4, the request's source +28 (0x504773c2..ca: a
//           work buffer of the play module's). The lab does not back it (X: bus 0xcfbd5400, 0xe2f61400) and the model
//           keeps the decoded planes to itself; a work buffer on the lab's memory is refused (its layout is not read)
//   +0xb550 the resizer's source address >> 4, the same buffer (0x5047991b..36; a crop offset added, 0x50479937..65:
//           refused when not 0), +0xb548 the source's width | height << 16 (0x504799a8..db)
//   +0x249c, +0x24a0 the source's centre, (width - 1) << 3 and (height - 1) << 3 (0x504785b1..); +0x24ac, +0x24b0 the
//           steps of a destination pixel in the source, 4.12 fixed (0x504784f4..0x5047853e: ((width - 1) * 100 << 12)
//           over a divisor of the caller's; X: 0x1cd0 and 0x1cd2 for 1620 x 1080 to 900 x 600, the divisors 89900 and
//           59900, the destination's size less 1, times 100); +0x24b4 the x position's term in y (0x5047a47a..97: an
//           affine map) and +0x24b8 (I: y's term in x): refused when not 0; +0x24a4, +0x24a8, +0x24bc, +0x24c0 the
//           same for the chroma (X; refused when they differ from the luma's)
//   +0xb514, +0xb518 the source position of the destination's pixel (0, 0) from the source's centre, .12 fixed: (the
//           x step * -(destination width - 1) + the cross term * -(height - 1)) / 2 (0x5047a460..97); +0xb598, +0xb59c
//           the destination's centre, -(width - 1) << 11 and -(height - 1) << 11 (0x5047a8ec..f9); +0xb5a0 the
//           destination's width | height << 16 (0x5047a98f..b2), +0xb5ac the same less 1
//   +0xb560 the destination's address >> 4 (0x5047ef36..3c, 0x5047f256); +0x8b8 its format: the low nibble 2 with
//           bit 8 clear for the image format 3074 (0x5047ecbf..0x5047ed04; 3330 sets bit 8 and is refused), bytes Y Cb
//           Y Cr a pixel pair (as the fill composes its word for 3074, 0x50490c89..a4); +0x8ac bits 16..3 the pitch
//           in units of 64 pixels (0x5047ef83..b0)
//   +0x2e60 the prefilter's mode, 0x500 with bit 0 for x and bit 1 for y, and its taps: +0x2e64 the x filter's centre
//           tap | the next << 16, +0x2e68 its outer tap; +0x2e6c, +0x2e70 the y filter's; +0x2e7c..+0x2e8c the same
//           again (0x504e2425: for each axis whose ratio is above 1024, the row 0x504e23a5 finds by the ratio, .10
//           fixed, ((source - 1) * 100 << 10) / ((destination - 1) * 100), 0x50478284..ab, in the 40 thresholds at
//           0x5066fb58; the rows, 0x506a4a64's pointers: a pre-reduction code 0, 1, 3 or 7 and three taps). Every
//           row's taps make 128 as centre + 2 * next + 2 * outer (X: all 40), so a symmetric filter of 5 taps in 1/128
//           (I). X: 68, 34 and -4 for the view's 1844 (1.80). A row with a pre-reduction (a ratio above 3327, 3.249;
//           X: the detail view's 3504 and 3507) changes the unit masks, the source's size and more words: refused
//           here (X: at the set-up's write of +0xf00, outside the pages; the reduction's unit is not read), and the
//           play module's lab side keeps such a request (src/lab/playmod.mjs S-PLAYDEC)
// So a destination pixel (x, y) reads the source at centre + (+0xb514 + x * step) / 4096: 0.049 .. 1618.95 for 0 ..
// 899 of the 900 x 600 view (X).
// A-IMGPIPE-2 (I): what the units between the codec and the output do to the samples is read only as far as the
// words above (the resizer's program, the words of the units at +0x400 and +0xc00 and the resizer's filter are not).
// The model filters each plane with the prefilter's 5 taps along x and then y (the edge samples repeated, the sum
// rounded to 1/128, the chroma planes at their own resolution) and samples the result at the position above by
// linear interpolation between the four neighbours, the chroma at the even pixel of each destination pair, at half
// its x. What would settle it: the resizer's program, or a frame read back from a camera.
// A-IMGPIPE-1 (I): the destination is written and the end raised RUN_NS of lab time after the start (the units' time
// is not known).
// A width other than 4, an unaligned access, an address outside the map, a read of a word the driver does not read,
// a write of a block word the decode does not write, a debugger write and a start while a run is in progress are
// UNKNOWN (a bus error, printed for a CPU access). Built by the machine on a board that gives imgpipe
// (src/machine.mjs); passive until the firmware writes it.
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';
import { decodeJpeg } from '../lab/jpeg.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const PIPE_SIZE = 0x25000, CODEC_SIZE = 0x2000;
// the block's words the model gives a behaviour
export const COMMIT = 0x2f8, GO = [[0x0c8, 0x102], [0x0cc, 5], [0x0e8, 0x100000], [0x0f4, 5]];
export const STATUS = [0x10c, 0x110, 0x11c, 0x120, 0x12c];
export const IRQ_PAIRS = [[0x110, 0x134], [0x120, 0x13c], [0x12c, 0x140]];
export const END_STATUS = 0x120, END_BIT = 0x100000, RSZ_ENABLE = 0xb478, RSZ_STATUS = 0xb47c, RSZ_END = 1;
// the decode's unit masks, in the words the set-up writes them to
export const MASKS = [[0x004, 0x80301], [0x014, 0x100001], [0x01c, 0x107]];
// the block's own words the decode's set-up, go, handler and end write (X; the others are UNKNOWN: a start word the
// lab does not know, such as the handler's +0x1b4, must not pass for storage)
export const OWN = new Set([0x000, 0x004, 0x010, 0x014, 0x018, 0x01c, 0x020, 0x024, 0x030, 0x034, 0x038, 0x03c, 0x0c8,
  0x0cc, 0x0e8, 0x0f4, ...STATUS, 0x130, 0x134, 0x13c, 0x140, 0x150, 0x154, 0x228, 0x248, 0x24c, 0x250, 0x254, 0x260,
  0x264, 0x268, 0x26c, 0x2b4, 0x2d8, 0x2dc, 0x2e0, 0x2e4, 0x2e8, 0x2f0, 0x2f4, 0x2f8]);
// the units' pages the decode's set-up and end write (storage)
const RANGES = [[0x400, 0x500], [0x800, 0x900], [0xc00, 0xf00], [0x2400, 0x2600], [0x2e00, 0x2f00],
  [0x3a00, 0x3b00], [0xae00, 0xaf00], [0xb000, 0xb100], [0xb400, 0xb800], [0x20000, 0x25000]];
// the words the driver reads on this path
const READS = new Set([0x110, 0x120, 0x12c, 0x134, 0x13c, 0x140, 0x228, 0x2b4, COMMIT, RSZ_ENABLE, RSZ_STATUS]);
// the program's words (above)
export const P = { stream_mode: 0xae00, stream: 0xae04, limit0: 0xae0c, limit1: 0xae10, mode: 0xb004, codec: 0xb088,
  mcu_cols: 0xb08c, mcu_rows: 0xb080, work: 0xb00c, src: 0xb550, src_size: 0xb548, cx: 0x249c, cy: 0x24a0, ccx: 0x24a4,
  ccy: 0x24a8, ax: 0x24ac, ay: 0x24b0, axy: 0x24b4, ayx: 0x24b8, cax: 0x24bc, cay: 0x24c0, x0: 0xb514, y0: 0xb518,
  dcx: 0xb598, dcy: 0xb59c, dst_size: 0xb5a0, dst_last: 0xb5ac, dst: 0xb560, format: 0x8b8, pitch: 0x8ac,
  pf: 0x2e60, pfx: 0x2e64, pfx2: 0x2e68, pfy: 0x2e6c, pfy2: 0x2e70, pf_b: 0x2e7c, pfx_b: 0x2e80, pfx2_b: 0x2e84, pfy_b: 0x2e88, pfy2_b: 0x2e8c };
// the codec's words: the reset, the mode select, the init's, and the decode's
export const J = { reset: 0x000c, encode: 0x0008, on: 0x0004, init: 0x1004, mode: 0x1000, mode2: 0x100c, lim0: 0x1028, lim1: 0x102c };
export const J_DECODE = 0x8004, J_START = 1, J_MODE2 = 0x8002, J_LIMIT = 0xffff;
const FORMAT_3074 = 2, PITCH_UNIT = 64, STREAM_ONE = 2, MODE_422 = 1;
// the prefilter's mode: 0x500 with bit 0 (x) and bit 1 (y), or 0x100 with neither (0x504e23fd); its taps make 128
export const PF_ON = 0x500, PF_OFF = 0x100, PF_SUM = 128;
// the stream is read from memory in pieces of this size until its EOI, up to the limit
const CHUNK = 1 << 18, STREAM_MAX = 1 << 26;
// A-IMGPIPE-1: 1 ms of lab time a run
export const RUN_NS = 1e6;
export const RUNS_KEPT = 16;

const s32 = (v) => v | 0;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// A-IMGPIPE-2: a plane of w x h filtered along x (step 1) or y (step w) with the taps [outer, next, centre, next,
// outer] / 128, the edge samples repeated
function prefilter(s, w, h, [c0, c1, c2], along_x) {
  const out = new Uint8Array(s.length), n = along_x ? w : h, lines = along_x ? h : w, step = along_x ? 1 : w, line = along_x ? w : 1;
  for (let l = 0; l < lines; l++) {
    const o = l * line;
    for (let i = 0; i < n; i++) {
      const a = (k) => s[o + (k < 0 ? 0 : k >= n ? n - 1 : k) * step];
      out[o + i * step] = clamp8((c2 * (a(i - 2) + a(i + 2)) + c1 * (a(i - 1) + a(i + 1)) + c0 * a(i) + 64) >> 7);
    }
  }
  return out;
}

export class ImgPipe {
  // cfg: the board's imgpipe {base, codec, irq}; bus: the machine's om1.bus (src/dev/bus.mjs)
  constructor(machine, clock, intc, bus, cfg) {
    this.m = machine; this.clock = clock; this.intc = intc; this.bus = bus;
    this.cfg = { base: cfg.base, codec: cfg.codec, irq: cfg.irq };
    this.regs = new Uint32Array(PIPE_SIZE / 4);
    this.jregs = new Uint32Array(CODEC_SIZE / 4);
    this.written = new Set();          // the block's words written since the last start
    this.jwritten = new Set();         // the codec's
    this.started = false;              // the codec's start written since the last run
    this.due = Infinity; this.pending = null;
    this.runs = 0; this.touched = false;
    this.log = [];                     // the newest runs: {n, t_ns, stream, bytes, width, height, dst, pitch, dst_width, dst_height}
    this.dropped = 0;
    intc.drive(this.cfg.irq);
    addRegion({ base: cfg.base, size: PIPE_SIZE, kind: K_MMIO, name: 'om1.imgpipe',
      dev: { read: (a, w, dbg) => this.read(a - cfg.base, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.base, v, w, dbg) } });
    addRegion({ base: cfg.codec, size: CODEC_SIZE, kind: K_MMIO, name: 'om1.jpegcodec',
      dev: { read: (a, w, dbg) => this.jread(a - cfg.codec, w, dbg), write: (a, v, w, dbg) => this.jwrite(a - cfg.codec, v, w, dbg) } });
    clock.add({ next: () => this.due, fire: (at) => this.complete(at) });
  }
  unknown(kind, addr, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: om1.imgpipe UNKNOWN ${kind} ${hex8(addr)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why ? ` (${why})` : ''}`);
    throw BUS;
  }
  known(off) { return off < 0x300 ? OWN.has(off) : RANGES.some(([lo, hi]) => off >= lo && off < hi); }
  busy() { return this.due !== Infinity; }
  r(off) { return this.regs[off >> 2]; }
  update() { this.intc.setLine(this.cfg.irq, IRQ_PAIRS.some(([s, e]) => (this.r(s) & this.r(e)) !== 0)); }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3) || !READS.has(off)) return this.unknown('read', this.cfg.base + off, size, 0, dbg);
    return this.regs[off >> 2];
  }
  write(off, value, size, dbg) {
    value >>>= 0;
    const no = (why) => this.unknown('write', this.cfg.base + off, size, value, dbg, why);
    if (dbg || size !== 4 || (off & 3) || !this.known(off)) return no('');
    this.touched = true;
    if (STATUS.includes(off)) { this.regs[off >> 2] = (this.regs[off >> 2] & ~value) >>> 0; this.update(); return; }
    if (off === RSZ_STATUS) {
      if (value !== 0) return no('the resizer\'s status written other than 0');
      this.regs[off >> 2] = 0; return;
    }
    if (off === COMMIT) { this.regs[off >> 2] = (value & ~0xff) >>> 0; return; }
    if (off === GO.at(-1)[0]) {
      if (this.busy()) return no('a start while a run is in progress');
      const why = this.start(value);
      // a refused start (a bus error, which stops a session) ends the program too
      this.written.clear(); this.jwritten.clear(); this.started = false;
      if (why) return no(why);
      this.regs[off >> 2] = value;
      return;
    }
    this.written.add(off);
    this.regs[off >> 2] = value;
    if (IRQ_PAIRS.some(([, e]) => e === off)) this.update();
  }
  jread(off, size, dbg) {
    if (size !== 4 || off !== J.mode) return this.unknown('read', this.cfg.codec + off, size, 0, dbg);
    return this.jregs[off >> 2];
  }
  jwrite(off, value, size, dbg) {
    value >>>= 0;
    const no = (why) => this.unknown('write', this.cfg.codec + off, size, value, dbg, why);
    if (dbg || size !== 4 || !Object.values(J).includes(off)) return no('');
    this.touched = true;
    if (off === J.encode && value !== 0) return no('the codec\'s encode: only the decode is modelled');
    if (off === J.mode) {
      if (value === (J_DECODE | J_START)) {
        if (this.busy() || this.started) return no('the codec\'s start while it runs');
        this.started = true;
      } else if (value !== J_DECODE) return no('the codec\'s mode: only the decode\'s 0x8004 is modelled');
      else this.started = false;
    }
    this.jwritten.add(off);
    this.jregs[off >> 2] = value;
  }
  // the stream from addr to its EOI: read in pieces until the decoder has its last block
  decode(addr) {
    for (let n = CHUNK; ; n *= 2) {
      const len = Math.min(n, this.bus.left(addr), STREAM_MAX);
      if (!len) return 'the stream\'s address is not on the bus\'s memory';
      const bytes = new Uint8Array(len);
      this.bus.read(addr, bytes);
      try { return decodeJpeg(bytes); } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        if (len < n || len === STREAM_MAX || !/the data ends before/.test(e.message)) return `the stream at ${hex8(addr)}: ${e.message}`;
      }
    }
  }
  // The go's last word: the run the words written since the last one describe, or the reason it is refused
  start(value) {
    const r = (o) => this.r(o), bad = [];
    for (const [off, want] of GO.slice(0, -1)) if (!this.written.has(off) || r(off) !== want) bad.push(`+0x${off.toString(16)} ${hex8(r(off))}`);
    if (value !== GO.at(-1)[1] || bad.length) return `the go's words ${bad.join(', ')} and ${hex8(value)}: only the decode's go is modelled`;
    if (!this.started) return 'a go without the codec\'s start: only the decode is modelled';
    const jbad = [[J.mode2, J_MODE2], [J.lim0, J_LIMIT], [J.lim1, J_LIMIT]].filter(([o, v]) => !this.jwritten.has(o) || this.jregs[o >> 2] !== v);
    if (jbad.length) return `the codec's ${jbad.map(([o]) => `+0x${o.toString(16)} ${hex8(this.jregs[o >> 2])}`).join(', ')}: not the decode's words`;
    const masks = MASKS.filter(([o, v]) => !this.written.has(o) || r(o) !== v);
    if (masks.length) return `the unit masks ${MASKS.map(([o]) => hex8(r(o))).join(', ')} are not the decode's ${MASKS.map(([, v]) => hex8(v)).join(', ')}`;
    const need = Object.values(P).filter((o) => !this.written.has(o));
    if (need.length) return `the decode's ${need.map((o) => '+0x' + o.toString(16)).join(', ')} not written since the last run`;
    if (!(r(RSZ_ENABLE) & RSZ_END)) return 'the resizer\'s end is not enabled (+0xb478 bit 0)';
    if (r(P.stream_mode) !== STREAM_ONE || r(P.limit0) !== 0xffffffff || r(P.limit1) !== 0xffffffff) return `the stream's mode ${r(P.stream_mode)} and limits ${hex8(r(P.limit0))}, ${hex8(r(P.limit1))}`;
    if (r(P.mode) !== MODE_422 || (r(P.codec) & 7) !== MODE_422) return `the codec's sampling mode ${r(P.mode)} / ${r(P.codec) & 7}: only the 4:2:2 mode is modelled`;
    const work = (r(P.work) << 4) >>> 0;
    if (r(P.src) !== r(P.work)) return `the resizer's source ${hex8(r(P.src))} is not the codec's output ${hex8(r(P.work))} (a crop is not modelled)`;
    if (this.bus.span(work, 1)) return `the work buffer ${hex8(work)} is on the lab's memory: its layout is not modelled`;
    const pic = this.decode(r(P.stream));
    if (typeof pic === 'string') return pic;
    const { width: w, height: h, components: [cy, cb, cr] } = pic;
    if (pic.components.length !== 3 || cy.h !== 2 || cy.v !== 1 || [cb, cr].some((c) => c.h !== 1 || c.v !== 1)) return `the stream's sampling ${pic.components.map((c) => `${c.h}x${c.v}`)} is not 4:2:2`;
    if (r(P.src_size) !== ((h << 16) | w) >>> 0 || r(P.mcu_cols) !== Math.ceil(w / 16) || r(P.mcu_rows) !== Math.ceil(h / 8)) return `the stream's ${w} x ${h} against the words' size ${hex8(r(P.src_size))} and MCUs ${r(P.mcu_cols)} x ${r(P.mcu_rows)}`;
    const dw = r(P.dst_size) & 0xffff, dh = r(P.dst_size) >>> 16, ax = r(P.ax), ay = r(P.ay);
    if (!dw || !dh || (dw & 1) || r(P.dst_last) !== (((dh - 1) << 16) | (dw - 1)) >>> 0) return `the destination's size ${hex8(r(P.dst_size))} and last pixel ${hex8(r(P.dst_last))}`;
    if (r(P.axy) || r(P.ayx)) return `the map's cross terms ${hex8(r(P.axy))}, ${hex8(r(P.ayx))}: a rotation is not modelled`;
    if (r(P.ccx) !== r(P.cx) || r(P.ccy) !== r(P.cy) || r(P.cax) !== ax || r(P.cay) !== ay) return 'the chroma\'s centre or steps differ from the luma\'s: not modelled';
    if (r(P.cx) !== (w - 1) << 3 || r(P.cy) !== (h - 1) << 3 || s32(r(P.dcx)) !== -((dw - 1) << 11) || s32(r(P.dcy)) !== -((dh - 1) << 11)) {
      return `the centres ${hex8(r(P.cx))}, ${hex8(r(P.cy))}, ${hex8(r(P.dcx))}, ${hex8(r(P.dcy))} are not the source's and the destination's`;
    }
    // the first and last pixel's source positions, 1/4096 of a pixel
    const x0 = (r(P.cx) << 8) + s32(r(P.x0)), y0 = (r(P.cy) << 8) + s32(r(P.y0));
    const x1 = x0 + (dw - 1) * ax, y1 = y0 + (dh - 1) * ay;
    if (!ax || !ay || ax > 0xfffff || ay > 0xfffff || x0 < 0 || y0 < 0 || x1 > (w - 1) << 12 || y1 > (h - 1) << 12) return `the map ${x0 / 4096}..${x1 / 4096} x ${y0 / 4096}..${y1 / 4096} leaves the source's ${w} x ${h}`;
    if ((r(P.format) & 0x10f) !== FORMAT_3074) return `the output's format word ${hex8(r(P.format))}: only the image format 3074 is modelled`;
    const dst = (r(P.dst) << 4) >>> 0, pitch = ((r(P.pitch) >>> 3) & 0x3fff) * PITCH_UNIT * 2, bytes = dw * 2;
    if (pitch < bytes) return `rows of ${bytes} bytes at a pitch of ${pitch}`;
    const last = dst + (dh - 1) * pitch;
    if (!this.bus.span(dst, bytes) || !this.bus.span(last, bytes) || !this.bus.span(dst, last + bytes - dst)) return `the destination's ${dh} rows of ${bytes} bytes from ${hex8(dst)} (pitch ${pitch}) are not on the bus's memory`;
    // the prefilter's mode and taps, both sets alike
    const pf = r(P.pf), taps = (lo, hi) => [r(lo) & 0xffff, r(lo) >>> 16, (r(hi) << 16) >> 16];
    if ([[P.pf, P.pf_b], [P.pfx, P.pfx_b], [P.pfx2, P.pfx2_b], [P.pfy, P.pfy_b], [P.pfy2, P.pfy2_b]].some(([a, b]) => r(a) !== r(b))) return 'the prefilter\'s two sets of words differ: not modelled';
    if (pf !== PF_OFF && (pf & ~3) !== PF_ON) return `the prefilter's mode ${hex8(pf)}`;
    const fx = pf & 1 ? taps(P.pfx, P.pfx2) : null, fy = pf & 2 ? taps(P.pfy, P.pfy2) : null;
    for (const f of [fx, fy]) if (f && f[0] + 2 * f[1] + 2 * f[2] !== PF_SUM) return `the prefilter's taps ${f} do not make ${PF_SUM}`;
    // A-IMGPIPE-2: the prefilter, then linear interpolation at the mapped position
    for (const c of [cy, cb, cr]) {
      if (fx) c.samples = prefilter(c.samples, c.width, c.height, fx, true);
      if (fy) c.samples = prefilter(c.samples, c.width, c.height, fy, false);
    }
    const out = new Uint8Array(bytes * dh), cw = cb.width;
    const lerp = (s, sw, x, fx, row0, row1, fy) => {
      const xb = fx ? x + 1 : x;
      const top = s[row0 + x] * (4096 - fx) + s[row0 + xb] * fx, bottom = s[row1 + x] * (4096 - fx) + s[row1 + xb] * fx;
      return (top * (4096 - fy) + bottom * fy + (1 << 23)) / (1 << 24) | 0;
    };
    for (let y = 0; y < dh; y++) {
      const sy = y0 + y * ay, yi = sy >>> 12, fy = sy & 4095, yb = fy ? yi + 1 : yi;
      for (let x = 0; x < dw; x++) {
        const sx = x0 + x * ax, o = y * bytes + 2 * x;
        out[o] = lerp(cy.samples, w, sx >>> 12, sx & 4095, yi * w, yb * w, fy);
        if (x & 1) continue;
        const sc = sx >>> 1, ci = sc >>> 12, fc = ci + 1 < cw ? sc & 4095 : 0;
        out[o + 1] = lerp(cb.samples, cw, ci, fc, yi * cw, yb * cw, fy);
        out[o + 3] = lerp(cr.samples, cw, ci, fc, yi * cw, yb * cw, fy);
      }
    }
    this.runs += 1;
    this.pending = { rec: { n: this.runs, t_ns: this.clock.t, stream: r(P.stream) >>> 0, bytes: pic.bytes, width: w, height: h, work, dst, pitch, dst_width: dw, dst_height: dh,
      step: [ax, ay], from: [x0, y0], taps: [fx, fy] }, out, row: bytes };
    this.due = this.clock.t + RUN_NS;
    return null;
  }
  // the lab clock: the destination's rows written, the resizer's end raised
  complete(at) {
    if (this.due > at) return;
    const { rec, out, row } = this.pending;
    this.due = Infinity; this.pending = null;
    for (let y = 0; y < rec.dst_height; y++) this.bus.write(rec.dst + y * rec.pitch, out, y * row, row);
    this.log.push(rec);
    if (this.log.length > RUNS_KEPT) { this.log.shift(); this.dropped += 1; }
    this.regs[RSZ_STATUS >> 2] |= RSZ_END;
    this.regs[END_STATUS >> 2] = (this.regs[END_STATUS >> 2] | END_BIT) >>> 0;
    this.update();
  }
  // the newest run, or null before the first end
  last() { return this.log.at(-1) ?? null; }
}
