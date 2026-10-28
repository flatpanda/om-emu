// The deferred-call triggers (board dpc; docs/hle-gaps.md 4.4.2): six words, one per interrupt line, by which the
// firmware's deferred calls interrupt the core that posts them. The posts (0x500503cf IRQ 53, 0x5005043f IRQ 54,
// 0x500504aa IRQ 55, 0x500504d9 IRQ 56; D) put {function, argument, value} on a ring of 32, enable the IRQ for the
// posting core (0x50054012) and write 1 to the line's word; the handlers run the ring (0x5005062d). The handlers of
// 53 and 54 (0x50050539, 0x50050583) disable their IRQ (0x5005401d) and leave the word, those of 55..58 (0x500505cd,
// 0x500505e5, 0x500505fd, 0x50050615) write 0 to it; the init 0x50050279 writes 0 to all six and attaches the
// handlers (D). A-DPC-1 (I): bit 0 of a word is its line's level, so a word written 1 holds its IRQ high until it is
// written 0 or, for 53 and 54, until the handler disables the IRQ at the controller (the controller is level
// sensitive, docs/om1-intc-timer-spec.md section 2; the next post enables it again, and an empty ring then runs no
// call). Any other value, width or offset, and a debugger write, are UNKNOWN. Built by the machine on a board that
// gives dpc (src/machine.mjs).
import { BUS, K_MMIO, addRegion, ctx } from '../core/mem.mjs';

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export class DpcTriggers {
  // cfg: the board's dpc {triggers (the first word's address), irqs (one per word)}
  constructor(machine, intc, cfg) {
    this.m = machine;
    this.intc = intc;
    this.cfg = { triggers: cfg.triggers, irqs: [...cfg.irqs] };
    this.words = new Uint32Array(cfg.irqs.length);
    this.writes = 0;
    addRegion({ base: cfg.triggers, size: 4 * cfg.irqs.length, kind: K_MMIO, name: 'om1.dpc-triggers',
      dev: { read: (a, w, dbg) => this.read(a - cfg.triggers, w, dbg), write: (a, v, w, dbg) => this.write(a - cfg.triggers, v, w, dbg) } });
    for (const irq of cfg.irqs) intc.drive(irq);
  }
  unknown(kind, off, size, value, dbg) {
    if (!dbg) this.m.stderr(`om-emu: om1.dpc-triggers UNKNOWN ${kind} ${hex8(this.cfg.triggers + off)} size ${size} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
    throw BUS;
  }
  read(off, size, dbg) {
    if (size !== 4 || (off & 3)) return this.unknown('read', off, size, 0, dbg);
    return this.words[off >> 2];
  }
  write(off, value, size, dbg) {
    if (dbg || size !== 4 || (off & 3) || (value >>> 0) > 1) return this.unknown('write', off, size, value, dbg);
    const k = off >> 2;
    this.words[k] = value;
    this.writes += 1;
    this.intc.setLine(this.cfg.irqs[k], value === 1);
  }
}
