// OM-1 interrupt controller, strict model, and its lab windows, the inter-CPU pending
// bits of M10B included (A-IPI: bank +0x808 set / +0x80c clear, doorbell command 2, the xcpu ring of banks 1..3), with
// check_irq's mutant negative controls (MUT_HIGHEST_LEVEL, MUT_HIGHEST_IRQ, MUT_IPI_NO_CLEAR, from the machine's
// mutant option). Gate mode 2's extra look at the next TB start after a request rises is the interpreter's
// (interp.mjs, S.kick).
import { BUS, Unported, K_MMIO, K_ROMD, addRegion, allocWindow, buf, U8, ctx } from '../core/mem.mjs';
import { BOARD, timerIrq } from '../fw/board.mjs';

// the model's controller (src/fw/board.mjs; E143: 4 banks, 356 IRQs, the offsets named below)
const B = BOARD.intc;
export const IRQS = B.irqs, LEVELS = 7, BANKS = B.banks.length;
export const DEBUG_BASE = 0x89A00000, DEBUG_SIZE = 0x10000, DOORBELL_BASE = 0x89A20000;
export const IRQ_OSD_ENGINE = B.irq_osd_engine, IRQ_IPI = B.irq_ipi;
export const IRQ_VSC = (c) => B.irq_vsc0 + 2 * c, IRQ_TIMER = timerIrq;
const BANK_BASE = B.banks;
const PRESENTED = B.presented, IPI_SET = B.ipi_set, IPI_CLEAR = B.ipi_clear, KICK = B.kick, CTL = B.ctl;
const D = {
  MAGIC: 0x000, VERSION: 0x004, GATE_MODE: 0x008, GATE_PC: 0x00C, PRESENTED_TOTAL: 0x010, ACCEPTED_TOTAL: 0x014,
  REQUEST: 0x018, LEVEL_MASK: 0x01C, ERR_TOTAL: 0x020, IPI_WRITES: 0x024, DOORBELL_RESULT: 0x028, IPI_REPEATS: 0x02C,
  PRESENT_NOW: 0x040, PENDING: 0x060, IPI_REQ: 0x070, XCPU_TOTAL: 0x07C, ERR_RING: 0x100, ERR_SLOTS: 16,
  LINES: 0x1000, LEVELS: 0x2000, TEST: 0x3000, PRESENTED_RING: 0x4000, ACCEPTED_RING: 0x5000, RING_SLOTS: 256,
  XCPU_RING: 0x6000,
};
const GATE_OFF = 0, GATE_PC = 1, GATE_ANY = 2;
const MUT_HIGHEST_LEVEL = 23, MUT_HIGHEST_IRQ = 27, MUT_IPI_NO_CLEAR = 31;
const ERR_UNKNOWN = 1, ERR_LEVEL_VALUE = 2, ERR_TEST_DRIVEN = 3, ERR_DEBUG_CPU = 4, ERR_DOORBELL = 5;
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// The debugger's interrupt trace (src/debug/): IT(0, irq, level, pc, insns) at every presentation the presented ring
// records (a CPU read of bank 0's +0x700 register that names an IRQ), IT(1, level, pc, insns) at every acceptance
// (cpu.mjs execInterrupt). insns is the full count; the rings keep its low word (presented) or both words (accepted).
let IT = null;
export function setIrqTrace(f) { IT = f; }

export class Intc {
  constructor(machine) {
    IT = null;
    this.m = machine;
    this.level = BANK_BASE.map(() => new Uint32Array(IRQS));
    this.r884 = new Uint32Array(BANKS); this.r810 = new Uint32Array(BANKS); this.pending = new Uint32Array(BANKS);
    this.line = new Uint8Array(IRQS); this.test = new Uint8Array(IRQS); this.driven = new Uint8Array(IRQS);
    this.presentedMask = 0;
    this.setIrq = null;                      // the machine's set_irq callback
    const off = allocWindow(DEBUG_SIZE);
    this.dbg = U8.subarray(off, off + DEBUG_SIZE);
    this.d32 = new Uint32Array(buf, off, DEBUG_SIZE / 4);
    this.dset(D.MAGIC, 0x43544E49);
    this.dset(D.VERSION, 2);
    this.driven[IRQ_IPI] = 1;
    this.dbg[D.LINES + IRQ_IPI] = 0x80;
    for (let b = 0; b < BANKS; b++) {
      addRegion({ base: BANK_BASE[b], size: 0x1000, kind: K_MMIO, name: 'om1.intc',
        dev: { read: (a, w, dbg) => this.bankRead(b, a - BANK_BASE[b], w, dbg),
               write: (a, v, w, dbg) => this.bankWrite(b, a - BANK_BASE[b], v, w, dbg) } });
    }
    addRegion({ base: DEBUG_BASE, size: DEBUG_SIZE, kind: K_ROMD, off, name: 'om1.lab-intc-debug',
      dev: { romdWrite: (a, v) => { this.recordError(ERR_DEBUG_CPU, a, v, 'CPU write to the lab window'); throw BUS; } } });
    addRegion({ base: DOORBELL_BASE, size: 4, kind: K_MMIO, name: 'om1.lab-intc-doorbell',
      dev: { read: (a, w, dbg) => this.doorbellRead(a, w, dbg), write: (a, v, w, dbg) => this.doorbellWrite(a - DOORBELL_BASE, v, w, dbg) } });
  }
  dget(o) { return this.d32[o >> 2]; }
  dset(o, v) { this.d32[o >> 2] = v; }
  recordError(kind, addr, value, what) {
    const total = this.dget(D.ERR_TOTAL), slot = D.ERR_RING + (total % D.ERR_SLOTS) * 16;
    this.dset(slot, kind); this.dset(slot + 4, addr); this.dset(slot + 8, value); this.dset(slot + 12, ctx.pc());
    this.dset(D.ERR_TOTAL, total + 1);
    this.m.stderr(`om-emu: intc ${what} ${hex8(addr)} value ${hex8(value)} pc ${hex8(ctx.pc())}`);
  }
  // ---- presentation
  high(irq) { return this.line[irq] !== 0 || this.test[irq] !== 0; }
  presented(level) {
    const want = 1 << level, lv = this.level[0];
    if (this.m.mutant === MUT_HIGHEST_IRQ) {
      for (let irq = IRQS - 1; irq >= 0; irq--) if (lv[irq] === want && (this.line[irq] !== 0 || this.test[irq] !== 0)) return irq;
      return -1;
    }
    for (let irq = 0; irq < IRQS; irq++) if (lv[irq] === want && (this.line[irq] !== 0 || this.test[irq] !== 0)) return irq;
    return -1;
  }
  recompute() {
    let mask = 0;
    for (let l = 0; l < LEVELS; l++) {
      const irq = this.presented(l);
      this.dset(D.PRESENT_NOW + 4 * l, irq < 0 ? 0 : (irq + 1) * 4);
      if (irq >= 0) mask |= 1 << l;
    }
    for (let irq = 0; irq < IRQS; irq++) {
      this.dbg[D.LINES + irq] = (this.line[irq] ? 1 : 0) | (this.test[irq] ? 2 : 0) | (this.driven[irq] ? 0x80 : 0);
    }
    this.presentedMask = mask;
    this.dset(D.LEVEL_MASK, mask);
    this.dset(D.REQUEST, mask !== 0 ? 1 : 0);
    // every set_irq(true) is a CPU kick: the machine's callback sets S.kick.
    if (this.setIrq) this.setIrq(mask !== 0);
  }
  setLine(irq, level) {
    const v = level ? 1 : 0;
    if (irq >= IRQS || this.line[irq] === v) return;
    this.line[irq] = v;
    this.recompute();
  }
  drive(irq) { this.driven[irq] = 1; this.dbg[D.LINES + irq] |= 0x80; }
  // ---- inter-CPU pending bits (A-IPI): bank 0's bits drive IRQ 324's line; a set of banks 1..3 is logged in the
  // xcpu ring {bank, value, pc, insns lo} (their CPUs are not modelled). A set whose bits are pending already counts.
  ipiUpdate(b) {
    this.dset(D.PENDING + 4 * b, this.pending[b]);
    if (b === 0) this.setLine(IRQ_IPI, this.pending[0] !== 0);
  }
  ipiSet(b, value) {
    if (this.pending[b] & value) this.dset(D.IPI_REPEATS, this.dget(D.IPI_REPEATS) + 1);
    this.pending[b] |= value;
    if (b !== 0) {
      const total = this.dget(D.XCPU_TOTAL), slot = D.XCPU_RING + (total % D.RING_SLOTS) * 16;
      this.dset(slot, b); this.dset(slot + 4, value); this.dset(slot + 8, ctx.pc()); this.dset(slot + 12, ctx.insns() % 4294967296);
      this.dset(D.XCPU_TOTAL, total + 1);
    }
    this.ipiUpdate(b);
  }
  ipiClear(b, value) {
    if (this.m.mutant !== MUT_IPI_NO_CLEAR) this.pending[b] &= ~value;    // check_irq I10 negative control
    this.ipiUpdate(b);
  }
  // ---- CPU side (cpu.mjs execInterrupt): the level to present now, gate applied, or -1
  irqLevel(pc) {
    const mode = this.dget(D.GATE_MODE), mask = this.presentedMask;
    if (!mask || mode === GATE_OFF || (mode === GATE_PC && (pc >>> 0) !== this.dget(D.GATE_PC))) return -1;
    if (mode !== GATE_PC && mode !== GATE_ANY) return -1;
    if (this.m.mutant === MUT_HIGHEST_LEVEL) return 31 - Math.clz32(mask);
    return 31 - Math.clz32(mask & -mask);                     // ctz32
  }
  // The level irqLevel would name with the gate open (the kick refusals), and the gate.
  levelAny() {
    const mask = this.presentedMask;
    if (!mask) return -1;
    return this.m.mutant === MUT_HIGHEST_LEVEL ? 31 - Math.clz32(mask) : 31 - Math.clz32(mask & -mask);
  }
  gateMode() { return this.dget(D.GATE_MODE); }
  gatePc() { return this.dget(D.GATE_PC) | 0; }
  irqAccepted(level, pc, insns) {
    if (IT !== null) IT(1, level, pc >>> 0, insns);
    const total = this.dget(D.ACCEPTED_TOTAL), slot = D.ACCEPTED_RING + (total % D.RING_SLOTS) * 16;
    this.dset(slot, level); this.dset(slot + 4, pc); this.dset(slot + 8, insns % 4294967296);
    this.dset(slot + 12, Math.floor(insns / 4294967296)); this.dset(D.ACCEPTED_TOTAL, total + 1);
  }
  connect(setIrq) { this.setIrq = setIrq; this.recompute(); }
  // ---- banks
  bankRead(b, off, size, dbg) {
    if (size === 4 && !(off & 3)) {
      if (off < 4 * IRQS) return this.level[b][off >> 2];
      if (off >= PRESENTED && off < PRESENTED + 4 * LEVELS) {
        const level = (off - PRESENTED) >> 2, irq = b === 0 ? this.presented(level) : -1;
        const data = irq < 0 ? 0 : (irq + 1) * 4;
        if (irq >= 0 && !dbg) {
          const total = this.dget(D.PRESENTED_TOTAL), slot = D.PRESENTED_RING + (total % D.RING_SLOTS) * 16;
          this.dset(slot, irq); this.dset(slot + 4, level); this.dset(slot + 8, ctx.pc());
          this.dset(slot + 12, ctx.insns() % 4294967296); this.dset(D.PRESENTED_TOTAL, total + 1);
          if (IT !== null) IT(0, irq, level, ctx.pc() >>> 0, ctx.insns());
          if (this.test[irq] === 2) { this.test[irq] = 0; this.recompute(); }
        }
        return data;
      }
      if (off === CTL) return this.r884[b];
      if (off === KICK) return this.r810[b];
      if (off === IPI_SET) return this.pending[b];
    }
    if (!dbg) this.recordError(ERR_UNKNOWN, BANK_BASE[b] + off, 0, `UNKNOWN read size ${size}`);
    throw BUS;
  }
  bankWrite(b, off, value, size, dbg) {
    if (dbg) throw BUS;
    if (size === 4 && !(off & 3)) {
      if (off < 4 * IRQS) {
        if (value && ((value & (value - 1)) || value >= 1 << LEVELS)) {
          this.recordError(ERR_LEVEL_VALUE, BANK_BASE[b] + off, value, 'level register value not 0 or one-hot 1 << L (L = 0..6):');
          throw BUS;
        }
        this.level[b][off >> 2] = value;
        if (b === 0) { this.dset(D.LEVELS + off, value); this.recompute(); }
        return;
      }
      if (off === CTL) { this.r884[b] = value; return; }
      if (off === KICK) { this.r810[b] = value; this.dset(D.IPI_WRITES, this.dget(D.IPI_WRITES) + 1); return; }
      if (off === IPI_SET) { this.ipiSet(b, value); return; }
      if (off === IPI_CLEAR) { this.ipiClear(b, value); return; }
    }
    this.recordError(ERR_UNKNOWN, BANK_BASE[b] + off, value, `UNKNOWN write size ${size}`);
    throw BUS;
  }
  doorbellRead(a, size, dbg) {
    if (!dbg) this.recordError(ERR_DOORBELL, a, 0, 'doorbell read');
    throw BUS;
  }
  // cmd 1: apply the test lines written at DBG_TEST + irq; cmd 2: apply the pending-bit request {bank, set, clear} at
  // DBG_IPI_REQ (pending = (pending & ~clear) | set; a bank >= 4 is an error).
  doorbellWrite(off, data, size, dbg) {
    if (!dbg && size === 4 && !off && data === 2) {
      const b = this.dget(D.IPI_REQ), set = this.dget(D.IPI_REQ + 4), clear = this.dget(D.IPI_REQ + 8);
      if (b >= BANKS) {
        this.recordError(ERR_DOORBELL, DOORBELL_BASE, b, 'doorbell cmd 2 bank');
        this.dset(D.DOORBELL_RESULT, ERR_DOORBELL);
        throw BUS;
      }
      if (clear) this.ipiClear(b, clear);
      if (set) this.ipiSet(b, set);
      this.dset(D.DOORBELL_RESULT, 0);
      return;
    }
    if (dbg || size !== 4 || off || data !== 1) {
      this.recordError(ERR_DOORBELL, DOORBELL_BASE + off, data, 'doorbell command');
      this.dset(D.DOORBELL_RESULT, ERR_DOORBELL);
      throw BUS;
    }
    let result = 0;
    for (let irq = 0; irq < IRQS; irq++) {
      let want = this.dbg[D.TEST + irq];
      if (want > 2) want = 0;
      if (want && this.driven[irq]) {
        this.recordError(ERR_TEST_DRIVEN, irq, want, 'test line on a device-driven IRQ');
        result = ERR_TEST_DRIVEN;
        this.dbg[D.TEST + irq] = 0;
        continue;
      }
      this.test[irq] = want;
    }
    this.recompute();
    this.dset(D.DOORBELL_RESULT, result);
  }
}
