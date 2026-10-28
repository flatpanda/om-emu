// The lens serial controller (board lens.ssc, IRQ lens.irq; docs/hle-gaps.md 4.4.1, where the firmware addresses
// cited here are listed) and the lens at its far end (src/lab/lensmcu.mjs S-LENSMCU, or anything with its seam:
// frame(f) -> the lens's reply bytes). The controller is a frame engine: the driver (LENS_SSC, 0x502c0e4e..0x502c2193)
// loads a frame's header, its data and the reply's destination into registers and starts it; the engine sends the
// frame, takes the lens's reply into its FIFO or by DMA into memory and raises its interrupt. Built by the machine on
// a board that gives lens (src/machine.mjs); until a lab connects the lens, a start is UNKNOWN.
//
// Registers (D: every operand of the driver; any other offset, a width other than 4, but for the receive FIFO's bytes,
// and a debugger write are UNKNOWN, a bus error printed for a CPU access):
//   +0x008  status, write 1 to clear (the IRQ handler 0x502c12c0 reads it and writes it back; the completion writes
//           0x3ff3, the stop 0x3fff). Bits the model sets at a frame's end: 7, the frame done; 8, its DMA done (a frame
//           with a DMA count; the handler completes a frame with a count only on bit 8, 0x502c1390); 11, reply data
//           received (D: bits 11 and 12 send the handler to the copy 0x502c144d, which wants bit 7; which of the two
//           means what is ?, I: 11). Bits 0, 1, 4, 5 are the driver's error bits, 2 and 3 its one-shot callbacks, 9 its
//           stop, 10..13 timestamps for one command (D, 0x502c12c0..0x502c13b7); the model sets none of them
//   +0x00c  the interrupt enable: IRQ lens.irq is high while status & enable is not 0 (I: the driver writes 959 or
//           5055 before each start, 0x502c124c, the bits its handler acts on)
//   +0x018  the DMA count (the packet's +29; non-zero: the reply goes to memory, D 0x502c1a6d)
//   +0x01c  1 aborts the DMA: the engine stops and raises bit 9 (I: the driver's abort 0x502c15a5 writes it when a DMA
//           count is set, marks the abort pending and leaves it to the handler, which on bit 9 clears the mark and the
//           count, 0x502c13ba; until then it completes no frame, 0x502c137b, X: a lens unlocked while a state poll's
//           count was set stayed pending)
//   +0x020  the DMA destination: bits 2..28 are the address >> 6 (D: the driver's packing of the packet's +32,
//           0x502c1aac..0x502c1ac9, and the 64-byte alignment it checks, 0x502c4d89)
//   +0x034  the frame's mode word, one of the driver's: 7 (the initial frame, 0x502c10b8) and the class table's 33,
//           81, 1057, 9761, 14113, 22561, 37921 (0x602f384c, 0x502c1b83, 0x502c1bd5, D); another is UNKNOWN at the start
//   +0x038  1 starts the frame (0x502c10e3, 0x502c125a); 0 stops (storage)
//   +0x040  read only: the count of reply bytes received (the driver takes it, less one for the classes 0x8x and
//           0xcx, as the reply's length, 0x502c1ea7)
//   +0x044  the frame's data count, at most 128, its bytes in the transmit FIFO +0x05c..+0x0db (packed four to a
//           word, 0x502c1ddb). Only a frame of the modes 9761 and 22561 carries data: the driver loads the FIFO and
//           the count for exactly the frames whose mode is one of them (class 0x6x; class 0xf0 codes 0x60, 0x63, 0x64,
//           0x70, 0x73, 0x74; class 0x90 codes 0x95, 0x97: 0x502c11e3..0x502c122b against the mode table, D) and
//           leaves the last count in place for the others
//   +0x048  the frame's header: byte 0 the class, 1 the code, 2 and 3 two parameter bytes (0x502c17d5)
//   +0x054  the packet's count (+14, 1 written as 0, 0x502c1820)
//   +0x0e4..+0x163  the receive FIFO, read by bytes (0x502c1f5e)
//   the rest of the driver's words (+0x000, 0x004, 0x010, 0x014, 0x030, 0x03c, 0x164..0x190, 0x19c, 0x1a0,
//           0x1a4, 0x1a8, 0x1b4, 0x1b8, 0x200..0x21c): storage, reset 0 (I: their roles are not read)
//
// A frame (A-LENSSSC-1, I): a start hands the frame to the far end at once and ends it in zero lab time; the reply's
// bytes go to the DMA destination or the receive FIFO, +0x040 is their count, and the status gains bit 7, bit 8 for a
// frame with a DMA count and bit 11 for a reply that is not empty. A reply longer than the FIFO on a frame without
// DMA is UNKNOWN. The far end's errors (an unknown frame) stop the session where the frame starts.
//
// Two units the lens path writes a few words of (board lens.units, {name, base, size, words}): the FCS unit, whose
// +0x000 and +0x068 the lens open clears (0x502c0e99, 0x502c0e9f; the unit's role, ?), and the mechanism unit at
// 0x9b900000 (docs/hle-gaps.md section 7), which the lens attach powers through the mechanism's reference-counted
// power-on (0x502c86bb -> 0x5010fd7a -> 0x501090e9 -> 0x5010b937: +0x000 and +0x004 cleared, then 0x5010b996
// +0x020, +0x024, +0x028 from its table; the power-off 0x5010ba1e writes +0x004 and +0x000). Those words are storage;
// any other access to the units, and a debugger write, is UNKNOWN.
//
// The lens-detect pin (board lens.detect): its GIO word reads the level in bit 4 (every GIO pin's read, 0x50002a35),
// low while a lens is on the mount (D: the detect poll 0x502c0b1f takes a change of the level read by 0x502c0b0a to
// 1 as the lens leaving, 0x502c0b94..0x502c0bf0, and the power-on 0x502c0a8f starts the lens only with it at 0,
// 0x502c0ad4); +4 and +8 are storage (the GIO init that would configure the pin does not run), and a store to +0
// (an input) is UNKNOWN. The lab sets whether a lens is on the mount (mount()).
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const SIZE = 0x220;
export const STATUS = 0x008, ENABLE = 0x00c, DMA_COUNT = 0x018, DMA_ABORT = 0x01c, DMA_ADDR = 0x020, MODE = 0x034, START = 0x038, RX_COUNT = 0x040;
export const TX_COUNT = 0x044, HEADER = 0x048, COUNT = 0x054, TX_FIFO = 0x05c, RX_FIFO = 0x0e4, FIFO_BYTES = 128;
export const DONE = 0x80, DMA_DONE = 0x100, STOPPED = 0x200, RX_DATA = 0x800;
export const MODES = new Set([7, 33, 81, 1057, 9761, 14113, 22561, 37921]), TX_MODES = new Set([9761, 22561]);
// the words the driver names, the FIFOs apart
const STORAGE = [0x000, 0x004, 0x010, 0x014, 0x030, 0x03c, 0x164, 0x168, 0x16c, 0x170, 0x174, 0x178, 0x17c,
  0x180, 0x184, 0x188, 0x18c, 0x190, 0x19c, 0x1a0, 0x1a4, 0x1a8, 0x1b4, 0x1b8, 0x200, 0x204, 0x208, 0x20c, 0x210, 0x214,
  0x218, 0x21c];
const WORDS = new Set([...STORAGE, STATUS, ENABLE, DMA_COUNT, DMA_ABORT, DMA_ADDR, MODE, START, RX_COUNT, TX_COUNT, HEADER, COUNT]);
const READ_ONLY = new Set([RX_COUNT]);

export class LensSsc {
  // cfg: the board's lens {ssc, irq, units, detect}; bus: the DMA bus (src/dev/bus.mjs)
  constructor(machine, intc, bus, cfg) {
    this.m = machine;
    this.intc = intc;
    this.bus = bus;
    this.cfg = { ...cfg };
    this.reg = new Uint32Array(SIZE / 4);
    this.rx = new Uint8Array(FIFO_BYTES);
    this.status = 0;
    this.far = null;                     // the lens: {frame(f) -> Uint8Array | null}, set by connect()
    this.frames = 0;
    this.units = cfg.units.map((u) => ({ name: u.name, base: u.base, words: new Map(u.words.map((o) => [o, 0])) }));
    this.mounted = false;                // a lens on the mount: the detect pin low
    this.detectWords = [0, 0];           // the pin's +4, +8
    addRegion({ base: cfg.ssc, size: SIZE, kind: K_MMIO, name: 'om1.lens-ssc',
      dev: { read: (a, w, dbg) => this.read(a - cfg.ssc, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.ssc, v, w, dbg) } });
    cfg.units.forEach((u, k) => addRegion({ base: u.base, size: u.size, kind: K_MMIO, name: `om1.${u.name}-unit`,
      dev: { read: (a, w, dbg) => this.unitAccess(k, 'read', a, 0, w, dbg), write: (a, v, w, dbg) => this.unitAccess(k, 'write', a, v, w, dbg) } }));
    const d = cfg.detect.word;
    addRegion({ base: d, size: 12, kind: K_MMIO, name: 'om1.lens-detect-pin',
      dev: { read: (a, w, dbg) => this.pinRead(a - d, w, dbg), write: (a, v, w, dbg) => this.pinWrite(a - d, v, w, dbg) } });
    intc.drive(cfg.irq);
  }
  // far: the lens at the far end, {frame(f) -> reply bytes or null}
  connect(far) { this.far = far; }
  // a lens on the mount (the detect pin low) or not
  mount(on) { this.mounted = !!on; }
  pinRead(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('om1.lens-detect-pin', 'read', this.cfg.detect.word + off, size, 0, dbg);
    return off === 0 ? (this.mounted ? 0 : 0x10) : this.detectWords[(off >> 2) - 1];
  }
  pinWrite(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3) || off === 0) return this.unknown('om1.lens-detect-pin', 'write', this.cfg.detect.word + off, size, value, dbg);
    this.detectWords[(off >> 2) - 1] = value >>> 0;
  }
  unknown(name, kind, a, size, value, dbg, why = '') {
    if (!dbg) this.m.stderr(`om-emu: ${name} UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}${why}`);
    throw BUS;
  }
  sscUnknown(kind, off, size, value, dbg, why) { return this.unknown('om1.lens-ssc', kind, this.cfg.ssc + off, size, value, dbg, why); }
  update() { this.intc.setLine(this.cfg.irq, (this.status & this.reg[ENABLE >> 2]) !== 0); }
  read(off, size, dbg) {
    if (off >= RX_FIFO && off < RX_FIFO + FIFO_BYTES && size === 1) return this.rx[off - RX_FIFO];
    if (size !== 4 || (off & 3) || !(WORDS.has(off) || (off >= TX_FIFO && off < TX_FIFO + FIFO_BYTES))) return this.sscUnknown('read', off, size, 0, dbg);
    return off === STATUS ? this.status : this.reg[off >> 2];
  }
  write(off, value, size, dbg) {
    const fifo = off >= TX_FIFO && off < TX_FIFO + FIFO_BYTES;
    if (dbg || size !== 4 || (off & 3) || READ_ONLY.has(off) || !(WORDS.has(off) || fifo)) return this.sscUnknown('write', off, size, value, dbg);
    value >>>= 0;
    if (off === STATUS) { this.status = (this.status & ~value) >>> 0; this.update(); return; }
    this.reg[off >> 2] = value;
    if (off === ENABLE) this.update();
    else if (off === DMA_ABORT && value === 1) { this.status = (this.status | STOPPED) >>> 0; this.update(); }
    else if (off === DMA_ABORT && value !== 0) return this.sscUnknown('write', off, size, value, dbg, ' (abort: 1)');
    else if (off === START && value === 1) this.start();
    else if (off === START && value !== 0) return this.sscUnknown('write', off, size, value, dbg, ' (start: 1, stop: 0)');
  }
  // the frame the registers describe, as the far end sees it
  frame() {
    const r = (o) => this.reg[o >> 2], hdr = r(HEADER), n = TX_MODES.has(r(MODE)) ? r(TX_COUNT) : 0;
    const tx = new Uint8Array(n);
    for (let i = 0; i < n; i++) tx[i] = (r(TX_FIFO + (i & ~3)) >>> (8 * (i & 3))) & 0xff;
    return { cls: hdr & 0xff, code: (hdr >>> 8) & 0xff, p1: (hdr >>> 16) & 0xff, p2: hdr >>> 24, tx, mode: r(MODE), count: r(COUNT),
      dma: r(DMA_COUNT) !== 0 };
  }
  start() {
    const r = (o) => this.reg[o >> 2];
    if (!MODES.has(r(MODE))) return this.sscUnknown('write', START, 4, 1, false, ` (a frame of mode ${r(MODE)}, not the driver's)`);
    if (TX_MODES.has(r(MODE)) && r(TX_COUNT) > FIFO_BYTES) return this.sscUnknown('write', START, 4, 1, false, ` (a frame of ${r(TX_COUNT)} data bytes)`);
    if (!this.far) return this.sscUnknown('write', START, 4, 1, false, ' (no lens connected)');
    const f = this.frame();
    let reply;
    try { reply = this.far.frame(f) ?? new Uint8Array(0); } catch (e) {
      this.m.stderr(`om-emu: om1.lens-ssc frame refused by the lens: ${e.message} pc ${hex8(ctx.pc())}`);
      throw BUS;
    }
    if (f.dma) {
      const at = (((r(DMA_ADDR) >>> 2) & 0x7ffffff) * 64) >>> 0;
      if (reply.length) {
        if (!this.bus.span(at, reply.length)) return this.sscUnknown('write', START, 4, 1, false, ` (a DMA of ${reply.length} bytes to ${hex8(at)}, not backed)`);
        this.bus.write(at, reply);
      }
    } else {
      if (reply.length > FIFO_BYTES) return this.sscUnknown('write', START, 4, 1, false, ` (a reply of ${reply.length} bytes without DMA)`);
      this.rx.fill(0);
      this.rx.set(reply);
    }
    this.reg[RX_COUNT >> 2] = reply.length;
    this.frames += 1;
    this.status = (this.status | DONE | (f.dma ? DMA_DONE : 0) | (reply.length ? RX_DATA : 0)) >>> 0;
    this.update();
  }
  unitAccess(k, kind, a, value, size, dbg) {
    const u = this.units[k], off = a - u.base;
    if (kind === 'write' && !dbg && size === 4 && u.words.has(off)) { u.words.set(off, value >>> 0); return; }
    if (kind === 'read' && size === 4 && u.words.has(off) && dbg) return u.words.get(off);
    return this.unknown(`om1.${u.name}-unit`, kind, a, size, value, dbg);
  }
}
