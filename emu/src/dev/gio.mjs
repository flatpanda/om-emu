// The MN's GIO input pins of UI_IN's group-1 keys (board gio_keys; docs/hle-gaps/4.7.md 4.7.21): eight pins the
// key init 0x5014d62e reads and arms through the GIO driver's class-0 functions (E143), each an input whose level the
// lab sets (src/lab/play.mjs H-GIOKEYS) and whose interrupt the firmware arms.
//
// The pin words (D: the driver's pin read 0x50002a35 and its pin table (0x60025ff8)[pin]; the handler registration
// 0x5005229f): +0 reads the level in bit 4; +4 (the configuration) and +8 (the word the registration writes, bit 0 of
// its record's +4) are storage, reset 0 (I: the GIO init's pin set-up, which would write them, does not run). A store
// to +0 is UNKNOWN (the pins are inputs; nothing in the key path writes one).
//
// The interrupts (D: each pin's record 0x600268f4 + 32 x slot, the slot from (0x60026788)[pin]: +4 dedicated (1) or
// a group's (0), +8 the IRQ, +16 the status word, +20 the enable word, +24 the type-0 bit, +28 the type-1 bit; the
// enable 0x500523ae, the disable 0x50052462): as the sub-CPU link's pin 102 (src/dev/linkpins.mjs), by A-LINKPINS-1
// (I): type 0 is the pin's high level and type 1 its low level, a status bit is set while its level holds and a write
// clears the bits it names only where their level no longer holds; the IRQ is high while status & enable is not 0.
// The key init arms the type of the level the pin is not at (its table's entry for the read level gives the type
// through 0x60224904, D), so an armed pin's IRQ rises at its next change. On a group slot the words also hold the
// group's other pins' bits, as storage (I: those pins are not modelled; nothing sets them). Any other offset, width or
// alignment, a status or enable bit outside the pin's two on a dedicated slot, and a debugger write are UNKNOWN (bus
// error, printed for a CPU access).
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const PIN_WORDS = 12;            // +0 level, +4 configuration, +8 the handler registration's word

export class GioKeyPins {
  // cfg: the board's gio_keys {pins: [{pin, word, status, enable, bits: [type 0, type 1], irq, shared}]}
  constructor(machine, intc, cfg) {
    this.m = machine;
    this.intc = intc;
    this.pins = cfg.pins.map((p) => ({ ...p, bits: [...p.bits], shared: !!p.shared }));
    this.byPin = new Map(this.pins.map((p, i) => [p.pin, i]));
    const n = this.pins.length;
    this.level = new Uint8Array(n);
    this.words = new Uint32Array(2 * n);          // +4, +8 of each pin
    this.status = new Uint32Array(n);
    this.enable = new Uint32Array(n);
    this.log = [];                                // [pin, level] of every level change the lab makes, in order
    this.pins.forEach((p, i) => {
      addRegion({ base: p.word, size: PIN_WORDS, kind: K_MMIO, name: `om1.gio-key-pin-${p.pin}`,
        dev: { read: (a, w, dbg) => this.wordRead(i, a - p.word, w, dbg), write: (a, v, w, dbg) => this.wordWrite(i, a - p.word, v, w, dbg) } });
      for (const word of ['status', 'enable']) {
        addRegion({ base: p[word], size: 4, kind: K_MMIO, name: `om1.gio-key-pin-${p.pin}-${word}`,
          dev: { read: (a, w, dbg) => this.irqRead(i, word, w, dbg), write: (a, v, w, dbg) => this.irqWrite(i, word, v, w, dbg) } });
      }
      intc.drive(p.irq);
      this.hold(i);
    });
  }
  unknown(what, kind, a, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: ${what} UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  has(pin) { return this.byPin.has(pin); }
  // the lab sets a pin's level (H-GIOKEYS)
  setLevel(pin, level) {
    const i = this.byPin.get(pin);
    if (i === undefined) throw new Error(`gio-key-pins: pin ${pin} is not modelled (board gio_keys: ${this.pins.map((p) => p.pin).join(', ')})`);
    const v = level ? 1 : 0;
    if (v === this.level[i]) return;
    this.level[i] = v;
    this.log.push([pin, v]);
    this.hold(i);
  }
  getLevel(pin) { return this.level[this.byPin.get(pin)]; }
  // the status bit pin i's level holds set (A-LINKPINS-1)
  held(i) { return this.pins[i].bits[this.level[i] ? 0 : 1]; }
  hold(i) {
    this.status[i] = (this.status[i] | this.held(i)) >>> 0;
    this.intc.setLine(this.pins[i].irq, (this.status[i] & this.enable[i]) !== 0);
  }
  wordRead(i, off, size, dbg) {
    const p = this.pins[i];
    if (size !== 4 || (off & 3)) return this.unknown(`om1.gio-key-pin-${p.pin}`, 'read', p.word + off, size, 0, dbg);
    if (off === 0) return this.level[i] << 4;
    return this.words[2 * i + (off >> 2) - 1];
  }
  wordWrite(i, off, value, size, dbg) {
    const p = this.pins[i];
    if (dbg || size !== 4 || (off & 3) || off === 0) return this.unknown(`om1.gio-key-pin-${p.pin}`, 'write', p.word + off, size, value, dbg);
    this.words[2 * i + (off >> 2) - 1] = value >>> 0;
  }
  irqRead(i, word, size, dbg) {
    const p = this.pins[i];
    if (size !== 4) return this.unknown(`om1.gio-key-pin-${p.pin}-${word}`, 'read', p[word], size, 0, dbg);
    return word === 'status' ? this.status[i] : this.enable[i];
  }
  irqWrite(i, word, value, size, dbg) {
    const p = this.pins[i], bits = p.shared ? 0xFFFFFFFF : p.bits[0] | p.bits[1];
    if (dbg || size !== 4 || (value & ~bits)) return this.unknown(`om1.gio-key-pin-${p.pin}-${word}`, 'write', p[word], size, value, dbg);
    if (word === 'status') this.status[i] = (this.status[i] & ~value) >>> 0;
    else this.enable[i] = value >>> 0;
    this.hold(i);
  }
}
