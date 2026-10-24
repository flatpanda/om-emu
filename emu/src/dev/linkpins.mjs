// The MN's three GIO pins of the sub-CPU link (board scpu_link; docs/om1-scpu-spec.md 3.1, docs/hle-gaps.md 4.7.1):
// ready (MN pin 102, an input driven by the sub-CPU's PC3, with its GIO interrupt), request (pin 103, an output to the
// sub-CPU's PB12) and reset (pin 107, an output to its reset). The far end is the sub-CPU (src/lab/scpudev.mjs, or a
// later LLE), wired by the lab (src/lab/scpulink.mjs) with connect(): this device tells it the outputs' levels and it
// sets the ready line's level here. Built by the machine on a board that gives scpu_link (src/machine.mjs); the pins'
// words lie in pages the lab stub allows, and these regions take their place.
//
// The pin words (D: the GIO driver's class-0 functions and its pin table): +0 reads the pin's level in bit 4 (the read
// 0x50002a35) and takes an output's level in bit 0 (the write 0x500521ff stores the level & 1); an output reads its own
// level in bits 0 and 4 (I: nothing reads one back but an error log's report); a store to an input's +0 is UNKNOWN; +4
// (the configuration, 0x500520f4) and +8 (the word the handler registration 0x5005229f writes) are storage, reset 0 (I:
// the GIO init's pin set-up, which would write them, does not run; nothing in the lab reads them).
//
// The ready pin's interrupt (D: its record, the enable 0x500523ae, the disable 0x50052462 and the dedicated-slot path
// of the group handler 0x500525ee at 0x500526cf): the status word has bits[0] for a type-0 interrupt and bits[1] for a
// type-1 one, the enable word is storage, and its IRQ is high while status & enable is not 0. A-LINKPINS-1 (I): type 0
// is the pin's high level and type 1 its low level, a status bit is set while its level holds and a write clears the
// bits it names only where their level no longer holds. Evidence: PER_SCPU arms type 1 to wait for the sub-CPU to drop
// pin 102 and type 0 to wait for it to raise it (0x5005bc9d, 0x5005be25, D), each callback first disables the pin's
// interrupt (0x5005c989, 0x5005c9dc, D), as a level interrupt needs, and the sub-CPU raises and drops PC3 back to back
// when it has a reply ready (0x8012eb6..0x8012eca, D), which an edge armed after the rise would miss; the enable writes
// the type's bit to the status before it enables (0x500523e2..ec), which clears a stale latch and keeps a held level.
// On a board whose pin 102 has a group slot (ready.shared: E139's and E134's pin 77, D: its record's group handler and
// status and enable words), the words also hold the group's other pins' bits: theirs are storage, a status write
// clearing them, and nothing sets them (I: those pins are not modelled; the IRQ is the group's, high while any bit of
// status & enable is set, and only the ready pin's can be). Any other offset, width or alignment, a status bit outside
// bits on a dedicated slot, and a debugger write are UNKNOWN (bus error, printed for a CPU access).
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const PIN_WORDS = 12;            // +0 level, +4 configuration, +8 the handler registration's word
export const LINK_INPUTS = ['ready'], LINK_OUTPUTS = ['request', 'reset'];

export class LinkPins {
  // cfg: the board's scpu_link {ready: {pin, word, status, enable, bits, irq}, request: {pin, word}, reset: {pin, word}}
  constructor(machine, intc, cfg) {
    this.m = machine;
    this.intc = intc;
    this.cfg = { ready: { ...cfg.ready, bits: [...cfg.ready.bits], shared: !!cfg.ready.shared }, request: { ...cfg.request }, reset: { ...cfg.reset } };
    this.level = { ready: 0, request: 0, reset: 0 };
    this.words = { ready: [0, 0], request: [0, 0], reset: [0, 0] };       // +4, +8
    this.status = 0;
    this.enable = 0;
    this.far = null;                     // the sub-CPU's side: {output(name, level)}, set by connect()
    this.log = [];                       // [name, level] of every level change, in order
    for (const name of [...LINK_INPUTS, ...LINK_OUTPUTS]) {
      const base = this.cfg[name].word;
      addRegion({ base, size: PIN_WORDS, kind: K_MMIO, name: `om1.link-pin-${name}`,
        dev: { read: (a, w, dbg) => this.wordRead(name, a - base, w, dbg), write: (a, v, w, dbg) => this.wordWrite(name, a - base, v, w, dbg) } });
    }
    const r = this.cfg.ready;
    addRegion({ base: r.status, size: 4, kind: K_MMIO, name: 'om1.link-pin-ready-status',
      dev: { read: (a, w, dbg) => this.irqRead('status', w, dbg), write: (a, v, w, dbg) => this.irqWrite('status', v, w, dbg) } });
    addRegion({ base: r.enable, size: 4, kind: K_MMIO, name: 'om1.link-pin-ready-enable',
      dev: { read: (a, w, dbg) => this.irqRead('enable', w, dbg), write: (a, v, w, dbg) => this.irqWrite('enable', v, w, dbg) } });
    intc.drive(r.irq);
    this.hold();
  }
  // far: {output(name, level)}, told every change of an output's level
  connect(far) { this.far = far; }
  unknown(what, kind, a, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: ${what} UNKNOWN ${kind} ${hex8(a)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  // the status bit the ready pin's level holds set (A-LINKPINS-1)
  held() { return this.cfg.ready.bits[this.level.ready ? 0 : 1]; }
  hold() {
    this.status = (this.status | this.held()) >>> 0;
    this.intc.setLine(this.cfg.ready.irq, (this.status & this.enable) !== 0);
  }
  // the sub-CPU sets the ready line's level
  setReady(level) {
    const v = level ? 1 : 0;
    if (v === this.level.ready) return;
    this.level.ready = v;
    this.log.push(['ready', v]);
    this.hold();
  }
  wordRead(name, off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown(`om1.link-pin-${name}`, 'read', this.cfg[name].word + off, size, 0, dbg);
    if (off === 0) { const v = this.level[name]; return (name === 'ready' ? v << 4 : v | v << 4) >>> 0; }
    return this.words[name][(off >> 2) - 1];
  }
  wordWrite(name, off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3)) return this.unknown(`om1.link-pin-${name}`, 'write', this.cfg[name].word + off, size, value, dbg);
    if (off !== 0) { this.words[name][(off >> 2) - 1] = value >>> 0; return; }
    if (name === 'ready' || (value & ~1)) return this.unknown(`om1.link-pin-${name}`, 'write', this.cfg[name].word, size, value, dbg);
    if (value === this.level[name]) return;
    this.level[name] = value;
    this.log.push([name, value]);
    if (this.far) this.far.output(name, value);
  }
  irqRead(word, size, dbg) {
    const r = this.cfg.ready;
    if (size !== 4) return this.unknown(`om1.link-pin-ready-${word}`, 'read', r[word], size, 0, dbg);
    return word === 'status' ? this.status : this.enable;
  }
  irqWrite(word, value, size, dbg) {
    const r = this.cfg.ready, bits = r.shared ? 0xFFFFFFFF : r.bits[0] | r.bits[1];
    if (dbg || size !== 4 || (value & ~bits)) return this.unknown(`om1.link-pin-ready-${word}`, 'write', r[word], size, value, dbg);
    if (word === 'status') this.status = (this.status & ~value) >>> 0;
    else this.enable = value >>> 0;
    this.hold();
  }
}
