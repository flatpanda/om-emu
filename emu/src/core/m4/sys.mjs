// The Cortex-M4's system control space (0xe000e000..0xe000efff) and the debug blocks the firmware touches: NVIC,
// SCB (VTOR, AIRCR, SCR, CCR, SHPR, SHCSR, the fault status registers, CPACR), SysTick, the MPU's registers (kept,
// not enforced), the FPU's FPCCR / FPCAR / FPDSCR / MVFR, DWT's CTRL and CYCCNT and DEMCR. It keeps the exception
// state (pending, active, enabled, priorities) and answers the priority questions of the exception model (ARMv7-M
// ARM B1.5); the entry and return themselves are cpu.mjs's. Register layouts and reset values are the ARMv7-M ARM's
// (B3.2, B3.3, B3.4) and the Cortex-M4 TRM's (CPUID r0p1, CCR.STKALIGN set, FPCCR ASPEN | LSPEN). Any other address
// in the private peripheral bus throws Unimplemented naming it.
import { Unimplemented } from './errors.mjs';

export const EXC_RESET = 1, EXC_NMI = 2, EXC_HARDFAULT = 3, EXC_MEMMANAGE = 4, EXC_BUSFAULT = 5, EXC_USAGEFAULT = 6,
  EXC_SVCALL = 11, EXC_DEBUGMON = 12, EXC_PENDSV = 14, EXC_SYSTICK = 15;

// CFSR bits (MMFSR 7:0, BFSR 15:8, UFSR 31:16)
export const CFSR = {
  IACCVIOL: 1 << 0, DACCVIOL: 1 << 1, MUNSTKERR: 1 << 3, MSTKERR: 1 << 4, MLSPERR: 1 << 5, MMARVALID: 1 << 7,
  IBUSERR: 1 << 8, PRECISERR: 1 << 9, IMPRECISERR: 1 << 10, UNSTKERR: 1 << 11, STKERR: 1 << 12, LSPERR: 1 << 13, BFARVALID: 1 << 15,
  UNDEFINSTR: 1 << 16, INVSTATE: 1 << 17, INVPC: 1 << 18, NOCP: 1 << 19, UNALIGNED: 1 << 24, DIVBYZERO: 1 << 25,
};
// the system handlers with a priority byte in SHPR1..3
const SHPR = [EXC_MEMMANAGE, EXC_BUSFAULT, EXC_USAGEFAULT, EXC_SVCALL, EXC_DEBUGMON, EXC_PENDSV, EXC_SYSTICK];
export const HFSR_VECTTBL = 1 << 1, HFSR_FORCED = 1 << 30, HFSR_DEBUGEVT = 1 << 31;

export class SystemBlock {
  // cpu: the core (its irqDirty flag, cycles, privilege); irqs: the number of external interrupts; prioBits: the
  // implemented priority bits (STM32L4: 4); refDiv: SysTick's external reference as cpu cycles per count (STM32: HCLK / 8)
  constructor(cpu, { irqs = 83, prioBits = 4, refDiv = 8 } = {}) {
    this.cpu = cpu;
    this.irqs = irqs;
    this.n = 16 + irqs;
    this.prioMask = (0xff << (8 - prioBits)) & 0xff;
    this.refDiv = refDiv;
    this.pending = new Uint8Array(this.n);
    this.active = new Uint8Array(this.n);
    this.enabled = new Uint8Array(this.n);      // IRQs only (16..)
    this.level = new Uint8Array(this.n);        // the external lines, level-sensitive
    this.prio = new Uint8Array(this.n);         // configurable priorities (4..)
    this.reset();
  }

  reset() {
    this.pending.fill(0); this.active.fill(0); this.enabled.fill(0); this.prio.fill(0);
    this.vtor = 0; this.prigroup = 0; this.scr = 0; this.ccr = 0x200; this.shcsrEna = 0; this.cfsr = 0; this.hfsr = 0;
    this.dfsr = 0; this.mmfar = 0; this.bfar = 0; this.cpacr = 0; this.actlr = 0;
    this.fpccr = 0xc0000000 | 0; this.fpcar = 0; this.fpdscr = 0;
    this.stCsr = 0; this.stRvr = 0; this.stCvr = 0; this.stCount = 0; this.stFrac = 0;
    this.mpuCtrl = 0; this.mpuRnr = 0; this.mpuRbar = new Int32Array(8); this.mpuRasr = new Int32Array(8);
    this.dwtCtrl = 0x40000000; this.cyccnt = 0; this.demcr = 0;
    this.resetRequest = false;
  }

  // ---- priorities (ARMv7-M B1.5.4)
  group(p) { return p < 0 ? p : p & ~((2 << this.prigroup) - 1) & 0xff; }
  priority(n) { return n === EXC_RESET ? -3 : n === EXC_NMI ? -2 : n === EXC_HARDFAULT ? -1 : this.prio[n]; }
  executionPriority(ignorePrimask = false) {
    const c = this.cpu;
    let highest = 256;
    for (let n = 2; n < this.n; n++) if (this.active[n]) { const p = this.group(this.priority(n)); if (p < highest) highest = p; }
    let boosted = 256;
    if (c.basepri & 0xff) boosted = this.group(c.basepri & this.prioMask);
    if (c.primask && !ignorePrimask) boosted = 0;
    if (c.faultmask) boosted = -1;
    return boosted < highest ? boosted : highest;
  }
  // the pending exception that would be taken next, regardless of the current priority: 0 when none
  highestPending() {
    let best = 0, bp = 1e9;
    for (let n = 2; n < this.n; n++) {
      if (!this.pending[n] || (n >= 16 && !this.enabled[n])) continue;
      const p = this.priority(n);
      if (p < bp) { bp = p; best = n; }
    }
    return best;
  }
  // the exception to take now (its group priority below the execution priority), or 0
  takeable() {
    const n = this.highestPending();
    if (!n) return 0;
    return this.group(this.priority(n)) < this.executionPriority() ? n : 0;
  }
  // WFI's wake-up: a pending exception that would preempt with PRIMASK clear
  wakes() {
    const n = this.highestPending();
    return n !== 0 && this.group(this.priority(n)) < this.executionPriority(true);
  }
  activeCount() { let k = 0; for (let n = 1; n < this.n; n++) k += this.active[n]; return k; }
  setPending(n) { this.pending[n] = 1; this.cpu.irqDirty = true; }
  clearPending(n) { this.pending[n] = 0; if (n >= 16 && this.level[n]) this.pending[n] = 1; this.cpu.irqDirty = true; }
  // an external interrupt line (irq 0 = exception 16): level-sensitive, held pending while high
  irqLine(irq, high) {
    const n = 16 + irq;
    if (n >= this.n) throw new RangeError(`IRQ ${irq} beyond ${this.irqs}`);
    this.level[n] = high ? 1 : 0;
    if (high) this.setPending(n);
  }
  // a pulse: pending once (STIR, an edge from a peripheral)
  irqPulse(irq) { this.setPending(16 + irq); }
  activate(n) { this.active[n] = 1; this.pending[n] = 0; }
  deactivate(n) { this.active[n] = 0; if (n >= 16 && this.level[n]) this.pending[n] = 1; this.cpu.irqDirty = true; }
  // a synchronous fault's handler is enabled (SHCSR, DEMCR); MemManage, BusFault, UsageFault and DebugMonitor
  // escalate when not
  faultEnabled(n) {
    if (n === EXC_MEMMANAGE) return (this.shcsrEna & 1) !== 0;
    if (n === EXC_BUSFAULT) return (this.shcsrEna & 2) !== 0;
    if (n === EXC_USAGEFAULT) return (this.shcsrEna & 4) !== 0;
    if (n === EXC_DEBUGMON) return (this.demcr & (1 << 16)) !== 0;   // MON_EN; else a debug event escalates
    return true;
  }

  // ---- time: called once per cpu cycle batch
  tick(cycles) {
    if (this.dwtCtrl & 1 && this.demcr & (1 << 24)) this.cyccnt = (this.cyccnt + cycles) | 0;
    if (!(this.stCsr & 1)) return;
    let counts = cycles;
    if (!(this.stCsr & 4)) { this.stFrac += cycles; counts = Math.floor(this.stFrac / this.refDiv); this.stFrac -= counts * this.refDiv; }
    for (let i = 0; i < counts; i++) {
      if (this.stCvr === 0) { this.stCvr = this.stRvr; continue; }
      this.stCvr--;
      if (this.stCvr === 0) { this.stCsr |= 0x10000; if (this.stCsr & 2) this.setPending(EXC_SYSTICK); }
    }
  }

  // ---- registers
  read(a, size) {
    a >>>= 0;
    const w = (a & ~3) >>> 0, sh = (a & 3) * 8;
    if (w >= 0xe000e400 && w < 0xe000e5f0) return this.bytes(w, size, sh, (k) => (k < this.irqs ? this.prio[16 + k] : 0), 0xe000e400);
    if (w >= 0xe000ed18 && w <= 0xe000ed20) return this.bytes(w, size, sh, (k) => (SHPR.includes(k + 4) ? this.prio[k + 4] : 0), 0xe000ed18);
    return this.sub(this.read32(w), size, sh);
  }
  bytes(w, size, sh, get, from) {
    let v = 0;
    for (let i = 0; i < 4; i++) v |= get(w - from + i) << (8 * i);
    return this.sub(v, size, sh);
  }
  sub(v, size, sh) { return size === 4 ? v | 0 : size === 2 ? (v >>> sh) & 0xffff : (v >>> sh) & 0xff; }

  read32(a) {
    const c = this.cpu;
    switch (a) {
      case 0xe000e004: return (Math.ceil(this.irqs / 32) - 1);           // ICTR
      case 0xe000e008: return this.actlr;
      case 0xe000e010: { const v = this.stCsr; this.stCsr &= ~0x10000; return v; }   // COUNTFLAG clears on read
      case 0xe000e014: return this.stRvr;
      case 0xe000e018: return this.stCvr;
      case 0xe000e01c: return 0;                                            // CALIB: not modelled (?), reads 0
      case 0xe000ed00: return 0x410fc241;                                   // CPUID: Cortex-M4 r0p1
      case 0xe000ed04: {                                                   // ICSR
        const pend = this.highestPending();
        let ext = 0;
        for (let n = 16; n < this.n; n++) if (this.pending[n]) { ext = 1; break; }
        return ((this.pending[EXC_NMI] << 31) | (this.pending[EXC_PENDSV] << 28) | (this.pending[EXC_SYSTICK] << 26) |
          (ext << 22) | ((pend & 0x1ff) << 12) | ((this.activeCount() === 1 ? 1 : 0) << 11) | (c.ipsr & 0x1ff)) | 0;
      }
      case 0xe000ed08: return this.vtor;
      case 0xe000ed0c: return (0xfa050000 | (this.prigroup << 8)) | 0;
      case 0xe000ed10: return this.scr;
      case 0xe000ed14: return this.ccr;
      case 0xe000ed24: return ((this.shcsrEna << 16) | (this.pending[EXC_SVCALL] << 15) | (this.pending[EXC_BUSFAULT] << 14) |
        (this.pending[EXC_MEMMANAGE] << 13) | (this.pending[EXC_USAGEFAULT] << 12) | (this.active[EXC_SYSTICK] << 11) |
        (this.active[EXC_PENDSV] << 10) | (this.active[EXC_DEBUGMON] << 8) | (this.active[EXC_SVCALL] << 7) |
        (this.active[EXC_USAGEFAULT] << 3) | (this.active[EXC_BUSFAULT] << 1) | this.active[EXC_MEMMANAGE]) | 0;
      case 0xe000ed28: return this.cfsr;
      case 0xe000ed2c: return this.hfsr;
      case 0xe000ed30: return this.dfsr;
      case 0xe000ed34: return this.mmfar;
      case 0xe000ed38: return this.bfar;
      case 0xe000ed3c: return 0;
      case 0xe000ed88: return this.cpacr;
      case 0xe000ed90: return 0x800;                                        // MPU_TYPE: 8 regions
      case 0xe000ed94: return this.mpuCtrl;
      case 0xe000ed98: return this.mpuRnr;
      case 0xe000ed9c: case 0xe000eda4: case 0xe000edac: case 0xe000edb4: return (this.mpuRbar[this.mpuRnr & 7] & ~0x1f) | (this.mpuRnr & 7);
      case 0xe000eda0: case 0xe000eda8: case 0xe000edb0: case 0xe000edb8: return this.mpuRasr[this.mpuRnr & 7];
      case 0xe000edfc: return this.demcr;
      case 0xe000ef34: return this.fpccr;
      case 0xe000ef38: return this.fpcar;
      case 0xe000ef3c: return this.fpdscr;
      case 0xe000ef40: return 0x10110021;                                   // MVFR0 (Cortex-M4 TRM, the FPU's)
      case 0xe000ef44: return 0x11000011;                                   // MVFR1 (the same)
      case 0xe0001000: return this.dwtCtrl;
      case 0xe0001004: return this.cyccnt;
    }
    if (a >= 0xe000e100 && a < 0xe000e100 + 0x40) return this.bits(a - 0xe000e100, this.enabled);
    if (a >= 0xe000e180 && a < 0xe000e180 + 0x40) return this.bits(a - 0xe000e180, this.enabled);
    if (a >= 0xe000e200 && a < 0xe000e200 + 0x40) return this.bits(a - 0xe000e200, this.pending);
    if (a >= 0xe000e280 && a < 0xe000e280 + 0x40) return this.bits(a - 0xe000e280, this.pending);
    if (a >= 0xe000e300 && a < 0xe000e300 + 0x40) return this.bits(a - 0xe000e300, this.active);
    throw new Unimplemented(`system register read 0x${(a >>> 0).toString(16)}`);
  }
  bits(off, arr) {
    let v = 0;
    for (let i = 0; i < 32; i++) { const n = 16 + off * 8 + i; if (n < this.n && arr[n]) v |= 1 << i; }
    return v | 0;
  }

  write(a, size, v) {
    a >>>= 0;
    const w = (a & ~3) >>> 0, sh = (a & 3) * 8;
    if (w >= 0xe000e400 && w < 0xe000e5f0) {                               // IPR0..123; past the IRQs: RAZ / WI
      for (let i = 0; i < size; i++) {
        const k = (a - 0xe000e400) + i;
        if (k < this.irqs) this.prio[16 + k] = (v >>> (8 * i)) & this.prioMask;
      }
      this.cpu.irqDirty = true;
      return;
    }
    if (w >= 0xe000ed18 && w <= 0xe000ed20) {
      for (let i = 0; i < size; i++) {
        const n = 4 + (a - 0xe000ed18) + i;
        if (SHPR.includes(n)) this.prio[n] = (v >>> (8 * i)) & this.prioMask;
      }
      this.cpu.irqDirty = true;
      return;
    }
    if (size !== 4) {                                                       // a narrow write to a word register
      const old = this.peek32(w);
      const mask = (size === 2 ? 0xffff : 0xff) << sh;
      v = (old & ~mask) | ((v << sh) & mask);
    }
    this.write32(w, v | 0);
  }
  peek32(a) {
    if (a === 0xe000e010) return this.stCsr;                               // no COUNTFLAG side effect
    return this.read32(a);
  }

  write32(a, v) {
    const c = this.cpu;
    switch (a) {
      case 0xe000e008: this.actlr = v & 0x307; return;
      case 0xe000e010: this.stCsr = (this.stCsr & 0x10000) | (v & 7); c.irqDirty = true; return;
      case 0xe000e014: this.stRvr = v & 0xffffff; return;
      case 0xe000e018: this.stCvr = 0; this.stCsr &= ~0x10000; return;
      case 0xe000ed04:                                                     // ICSR
        if (v & (1 << 31)) this.setPending(EXC_NMI);
        if (v & (1 << 28)) this.setPending(EXC_PENDSV);
        else if (v & (1 << 27)) this.clearPending(EXC_PENDSV);
        if (v & (1 << 26)) this.setPending(EXC_SYSTICK);
        else if (v & (1 << 25)) this.clearPending(EXC_SYSTICK);
        return;
      case 0xe000ed08: this.vtor = v & ~0x7f; return;
      case 0xe000ed0c:                                                     // AIRCR: VECTKEY 0x05fa
        if (((v >>> 16) & 0xffff) !== 0x05fa) return;
        this.prigroup = (v >>> 8) & 7;
        if (v & 4) this.resetRequest = true;
        c.irqDirty = true;
        return;
      case 0xe000ed10: this.scr = v & 0x16; return;
      case 0xe000ed14: this.ccr = (v & 0x31b) | 0; return;
      case 0xe000ed24:
        this.shcsrEna = (v >>> 16) & 7;
        // the active and pended bits are writable (B3.2.13); kept for the faults and SVCall
        this.active[EXC_MEMMANAGE] = v & 1; this.active[EXC_BUSFAULT] = (v >>> 1) & 1; this.active[EXC_USAGEFAULT] = (v >>> 3) & 1;
        this.active[EXC_SVCALL] = (v >>> 7) & 1; this.active[EXC_DEBUGMON] = (v >>> 8) & 1; this.active[EXC_PENDSV] = (v >>> 10) & 1;
        this.active[EXC_SYSTICK] = (v >>> 11) & 1;
        this.pending[EXC_USAGEFAULT] = (v >>> 12) & 1; this.pending[EXC_MEMMANAGE] = (v >>> 13) & 1;
        this.pending[EXC_BUSFAULT] = (v >>> 14) & 1; this.pending[EXC_SVCALL] = (v >>> 15) & 1;
        c.irqDirty = true;
        return;
      case 0xe000ed28: this.cfsr &= ~v; return;
      case 0xe000ed2c: this.hfsr &= ~v; return;
      case 0xe000ed30: this.dfsr &= ~v; return;
      case 0xe000ed34: this.mmfar = v; return;
      case 0xe000ed38: this.bfar = v; return;
      case 0xe000ed3c: return;
      case 0xe000ed88: this.cpacr = v & 0x00f00000; return;
      case 0xe000ed94: this.mpuCtrl = v & 7; return;
      case 0xe000ed98: this.mpuRnr = v & 0xff; return;
      case 0xe000ed9c: case 0xe000eda4: case 0xe000edac: case 0xe000edb4:
        if (v & 0x10) this.mpuRnr = v & 7;
        this.mpuRbar[this.mpuRnr & 7] = v & ~0x1f;
        return;
      case 0xe000eda0: case 0xe000eda8: case 0xe000edb0: case 0xe000edb8: this.mpuRasr[this.mpuRnr & 7] = v; return;
      case 0xe000edfc: this.demcr = v & 0x010f07f1; return;
      case 0xe000ef00: if (c.privileged() || (this.ccr & 2)) { const n = 16 + (v & 0x1ff); if (n < this.n) this.setPending(n); } return;
      case 0xe000ef34: this.fpccr = v & 0xc000017b; return;                   // ASPEN LSPEN MONRDY BFRDY MMRDY HFRDY THREAD USER LSPACT
      case 0xe000ef38: this.fpcar = v & ~7; return;
      case 0xe000ef3c: this.fpdscr = v & 0x07c00000; return;
      case 0xe0001000: this.dwtCtrl = (0x40000000 | (v & 1)) | 0; return;
      case 0xe0001004: this.cyccnt = v; return;
    }
    const words = 0x40;                                                    // 16 words each; past the IRQs RAZ / WI
    const each = (base, f) => { for (let i = 0; i < 32; i++) if ((v >>> i) & 1) { const n = 16 + (a - base) * 8 + i; if (n < this.n) f(n); } c.irqDirty = true; };
    if (a >= 0xe000e100 && a < 0xe000e100 + words) return each(0xe000e100, (n) => { this.enabled[n] = 1; });
    if (a >= 0xe000e180 && a < 0xe000e180 + words) return each(0xe000e180, (n) => { this.enabled[n] = 0; });
    if (a >= 0xe000e200 && a < 0xe000e200 + words) return each(0xe000e200, (n) => { this.pending[n] = 1; });
    if (a >= 0xe000e280 && a < 0xe000e280 + words) return each(0xe000e280, (n) => this.clearPending(n));
    throw new Unimplemented(`system register write 0x${(a >>> 0).toString(16)} = 0x${(v >>> 0).toString(16)}`);
  }
}
