// OM-1 HDMI port (docs/hle-gaps.md 4.9, where the firmware addresses cited here are listed): the transmitter's byte
// registers (board hdmi.tx, 4 KiB), the lane word its register writer sets (hdmi.lanes) and its interrupt (hdmi.irq);
// the hot-plug pin's level word and its GIO group's status and enable words (hdmi.hpd), which drive the group's
// interrupt (hdmi.hpd.irq); and the sink at the far end of the cable: the lab's window holding the sink's EDID, and
// the lab's doorbell that plugs the cable in. Built only when the machine's hdmi option is on (src/machine.mjs):
// without it these addresses stay the lab stub's, as before.
//
// The transmitter (D: the driver's register reader and writer). Register r is byte lane r & 3 of the word at r & ~3,
// and the CPU reaches the file with word accesses only, but for the DDC buffer (below). The writer first stores
// (keep << 16) | 1 to the lane word, keep having a bit set for each byte lane the word store must leave as it is
// (14, 13, 11, 7 for lanes 0..3; the HDMI init stores 1, all four), then the register's byte in its lane; the model
// takes a lane word of that form only. Per register:
//   0x08      the sink's lines, read-only: bit 3 hot-plug detect, bit 4 receiver sense (I: the names; D: the hot-plug
//             handler wants both before it reads the EDID); the other bits read 0
//   0x90      the interrupt summary, read-only: bit 2 while 0x92 & 0x9a, bit 4 while 0x94 & 0x9c, bit 6 while
//             0x96 & 0x9e is not 0 (I: the status reader looks at a group only when its summary bit is set, D)
//   0x92, 0x94, 0x96  interrupt status, write 1 to clear (D: the reader writes back the bits it takes); their masks
//             0x9a, 0x9c, 0x9e are storage. IRQ hdmi.irq is high while 0x90 & 0x98 is not 0 (I: the HDMI init writes
//             0x57 to 0x98, and the IRQ 239 handler acts on the three groups)
//   0xa80..0xa83  the DDC: 0xa80 segment, 0xa81 offset, 0xa82 count - 1 (I: the EDID read writes 127 and then reads
//             128 bytes), 0xa83 the command. Command 130 (the EDID read's) is an E-DDC read: the sink's EDID bytes
//             from 256 x segment + offset go into the DDC buffer and 0x94 bits 7 and 5 are set at once (I: done and
//             success; D: the IRQ 239 handler sets the DDC wait's flag with pattern 1 for them, and the EDID read then
//             takes the buffer as the block). Any other command (128, an SCDC write the HDMI open sends, not reached)
//             or a read past the sink's EDID is UNKNOWN
//   0xc00..0xc7f  the DDC buffer, storage; the EDID checks read it by bytes and words
//   the other registers of the words the driver's path uses (WORDS): storage, reset 0 (I)
// Any other word, width or alignment, a write to a read-only register and a lane word of another form are UNKNOWN
// (bus error, printed for a CPU access).
//
// The hot-plug pin (D: the GIO driver's pin read, its group handler and the HPD pin's record in the GIO table; the same
// words, bit and IRQ on E143, E146 and E147): the pin's level is bit hpd.level_bit of its level word (read-only; its
// other bits read 0). The group's status word has the pin's bit hpd.bit set when the pin rises (I: the HPD pin's
// interrupt is set up with type 0, whose bit that is, and the firmware's plug handler acts on a high level); a write
// clears the bits it names (I: the group handler writes back the bit it handled). The enable word is storage. IRQ
// hpd.irq is high while status & enable is not 0. A falling pin sets nothing (A-HDMI-1: the edge type's other bit is
// not read; the firmware has the pin's interrupt off once the cable is in, and an unplug is not modelled).
//
// The lab's window (K_ROMD, written by the debugger): the magic 'HDMI', the cable state, the count of E-DDC reads
// answered, the length of the sink's EDID and the EDID itself at EDID (up to EDID_MAX bytes). The doorbell takes
// (PLUG << 24) from a CPU store: the cable goes in, the sink's lines and the pin go high (the sink's EDID must be in
// the window by then); any other store, a second plug, or a read, is a bus error.
import { BUS, K_MMIO, K_ROMD, addRegion, allocWindow, buf, ctx } from '../core/mem.mjs';
import { BOARD } from '../fw/board.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const W_MAGIC = 0x00, W_CABLE = 0x04, W_DDC_READS = 0x08, W_EDID_LEN = 0x0c, EDID = 0x100, EDID_MAX = 0x400;
export const WINDOW_SIZE = 0x1000, MAGIC = [...'HDMI'].reduce((v, c, i) => v | c.charCodeAt(0) << (8 * i), 0) >>> 0;
// the doorbell's commands (bits 31..24)
export const PLUG = 1;
// the transmitter's registers (byte offsets) with a behaviour of their own
const SINK = 0x08, SUMMARY = 0x90, STATUS = [0x92, 0x94, 0x96], MASK = [0x9a, 0x9c, 0x9e], IRQ_MASK = 0x98;
const DDC_SEGMENT = 0xa80, DDC_OFFSET = 0xa81, DDC_COUNT = 0xa82, DDC_COMMAND = 0xa83, DDC_BUFFER = 0xc00, DDC_BUFFER_END = 0xc80;
const DDC_READ = 130, DDC_DONE_OK = 0xa0, HPD = 0x08, RX_SENSE = 0x10;
// the words of the driver's path (X: every word the HDMI init, the hot-plug handler, the EDID read and the IRQ 239
// handler touch on E143, E146 and E147), the DDC buffer's apart
const WORDS = new Set([0x04, 0x08, 0x0c, 0x20, 0x30, 0x90, 0x94, 0x98, 0x9c, 0xa80, 0xa9c]);
const READ_ONLY = new Set([SINK, SUMMARY]);
const HPD_WORDS = ['level', 'status', 'enable'];

export class Hdmi {
  constructor(machine, intc, windowBase, doorbell) {
    this.m = machine;
    this.intc = intc;
    const { tx, lanes, irq, hpd } = BOARD.hdmi;
    this.cfg = { tx, lanes, irq, hpd: { ...hpd } };
    this.reg = new Uint8Array(0x1000);
    this.lanes = 1;
    this.plugged = false;
    this.pin = 0;
    this.status = 0;
    this.enable = 0;
    const off = allocWindow(WINDOW_SIZE);
    this.win = new Uint32Array(buf, off, WINDOW_SIZE / 4);
    this.winBytes = new Uint8Array(buf, off, WINDOW_SIZE);
    this.win[W_MAGIC >> 2] = MAGIC;
    addRegion({ base: tx, size: 0x1000, kind: K_MMIO, name: 'om1.hdmi',
      dev: { read: (a, w, dbg) => this.read(a - tx, w, dbg), write: (a, v, w, dbg) => this.write(a - tx, v, w, dbg) } });
    addRegion({ base: lanes, size: 4, kind: K_MMIO, name: 'om1.hdmi-lanes',
      dev: { read: (a, w, dbg) => this.laneRead(w, dbg), write: (a, v, w, dbg) => this.laneWrite(v, w, dbg) } });
    for (const word of HPD_WORDS) {
      addRegion({ base: hpd[word], size: 4, kind: K_MMIO, name: `om1.hdmi-hpd-${word}`,
        dev: { read: (a, w, dbg) => this.hpdRead(word, w, dbg), write: (a, v, w, dbg) => this.hpdWrite(word, v, w, dbg) } });
    }
    addRegion({ base: windowBase, size: WINDOW_SIZE, kind: K_ROMD, off, name: 'om1.lab-hdmi-sink',
      dev: { romdWrite: (a, v, w) => this.unknown('om1.lab-hdmi-sink', 'write', a, w, v, false) } });
    addRegion({ base: doorbell, size: 4, kind: K_MMIO, name: 'om1.lab-hdmi-doorbell',
      dev: { read: (a, w, dbg) => this.unknown('om1.lab-hdmi-doorbell', 'read', a, w, 0, dbg), write: (a, v, w, dbg) => this.doorbell(a, v, w, dbg) } });
    intc.drive(irq);
    intc.drive(hpd.irq);
  }
  unknown(name, kind, a, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: ${name} UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  txUnknown(kind, off, size, value, dbg) { return this.unknown('om1.hdmi', kind, this.cfg.tx + off, size, value, dbg); }
  summary() {
    const r = this.reg;
    return ((r[STATUS[0]] & r[MASK[0]]) ? 0x04 : 0) | ((r[STATUS[1]] & r[MASK[1]]) ? 0x10 : 0) | ((r[STATUS[2]] & r[MASK[2]]) ? 0x40 : 0);
  }
  update() {
    this.intc.setLine(this.cfg.irq, (this.summary() & this.reg[IRQ_MASK]) !== 0);
    this.intc.setLine(this.cfg.hpd.irq, (this.status & this.enable) !== 0);
  }
  byte(r) {
    if (r === SINK) return this.plugged ? HPD | RX_SENSE : 0;
    if (r === SUMMARY) return this.summary();
    return this.reg[r];
  }
  inBuffer(off) { return off >= DDC_BUFFER && off < DDC_BUFFER_END; }
  read(off, size, dbg) {
    if (this.inBuffer(off) && (size === 1 || (size === 4 && !(off & 3)))) {
      let v = 0;
      for (let i = 0; i < size; i++) v |= this.reg[off + i] << (8 * i);
      return v >>> 0;
    }
    if (size !== 4 || (off & 3) || !WORDS.has(off)) return this.txUnknown('read', off, size, 0, dbg);
    let v = 0;
    for (let i = 0; i < 4; i++) v |= this.byte(off + i) << (8 * i);
    return v >>> 0;
  }
  write(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3) || !(WORDS.has(off) || this.inBuffer(off))) return this.txUnknown('write', off, size, value, dbg);
    const keep = (this.lanes >>> 16) & 15;
    for (let i = 0; i < 4; i++) if (!(keep & (1 << i)) && READ_ONLY.has(off + i)) return this.txUnknown('write', off, size, value, dbg);
    for (let i = 0; i < 4; i++) {
      if (keep & (1 << i)) continue;
      const r = off + i, b = (value >>> (8 * i)) & 0xff;
      if (r === DDC_COMMAND && b !== DDC_READ) return this.txUnknown('write', off, size, value, dbg);
      if (STATUS.includes(r)) this.reg[r] &= ~b;
      else this.reg[r] = b;
      if (r === DDC_COMMAND) this.ddcRead();
    }
    this.update();
  }
  // the E-DDC read the command starts: the sink's bytes into the buffer, done and success at once
  ddcRead() {
    const at = 256 * this.reg[DDC_SEGMENT] + this.reg[DDC_OFFSET], n = this.reg[DDC_COUNT] + 1;
    const len = this.win[W_EDID_LEN >> 2];
    if (!this.plugged || at + n > len || n > DDC_BUFFER_END - DDC_BUFFER) {
      this.m.stderr(`om-emu: om1.hdmi UNKNOWN E-DDC read of ${n} bytes at ${at} (cable ${this.plugged ? 'in' : 'out'}, sink EDID ${len} bytes) pc ${hex8(ctx.pc())}`);
      throw BUS;
    }
    this.reg.set(this.winBytes.subarray(EDID + at, EDID + at + n), DDC_BUFFER);
    this.reg[STATUS[1]] |= DDC_DONE_OK;
    this.win[W_DDC_READS >> 2] += 1;
  }
  // the hot-plug pin's words: 'level', 'status', 'enable'
  hpdRead(word, size, dbg) {
    if (size !== 4) return this.unknown(`om1.hdmi-hpd-${word}`, 'read', this.cfg.hpd[word], size, 0, dbg);
    return word === 'level' ? this.pin : word === 'status' ? this.status : this.enable;
  }
  hpdWrite(word, value, size, dbg) {
    if (dbg || size !== 4 || word === 'level') return this.unknown(`om1.hdmi-hpd-${word}`, 'write', this.cfg.hpd[word], size, value, dbg);
    if (word === 'status') this.status = (this.status & ~value) >>> 0;
    else this.enable = value >>> 0;
    this.update();
  }
  laneRead(size, dbg) { return size === 4 ? this.lanes : this.unknown('om1.hdmi-lanes', 'read', this.cfg.lanes, size, 0, dbg); }
  laneWrite(value, size, dbg) {
    if (dbg || size !== 4 || (value & ~0xF0000) !== 1) return this.unknown('om1.hdmi-lanes', 'write', this.cfg.lanes, size, value, dbg);
    this.lanes = value >>> 0;
  }
  doorbell(a, value, size, dbg) {
    const len = this.win[W_EDID_LEN >> 2];
    if (dbg || size !== 4 || value >>> 0 !== (PLUG << 24) >>> 0 || this.plugged || len === 0 || len > EDID_MAX) {
      return this.unknown('om1.lab-hdmi-doorbell', 'write', a, size, value, dbg);
    }
    this.plugged = true;
    this.win[W_CABLE >> 2] = 1;
    this.pin = this.cfg.hpd.level_bit;
    this.status = (this.status | this.cfg.hpd.bit) >>> 0;
    this.update();
  }
}
