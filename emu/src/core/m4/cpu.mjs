// A Cortex-M4 (ARMv7E-M with the single-precision FPU's register file) core for the SCPU's firmware
// (docs/om1-scpu-spec.md section 8 step 4). It executes the Thumb / Thumb-2 instruction set decode.mjs decodes, takes
// exceptions with the ARMv7-M exception model (the 8-word and the 26-word frame, MSP / PSP, EXC_RETURN, lazy FP
// state preservation, PRIMASK / BASEPRI / FAULTMASK, fault escalation to HardFault), and keeps the system control
// space in sys.mjs. Pseudocode references are the ARMv7-M ARM's (DDI 0403E).
//
// The bus: an object with read8 / read16 / read32 (unsigned or signed values; the core masks), write8 / write16 /
// write32, and optionally codeCacheable(addr) (true where code never changes, e.g. flash: decoded instructions there
// are cached). Accesses come aligned to their size (the core splits unaligned word and halfword accesses into bytes);
// the core handles 0xe0000000..0xe00fffff (the PPB) itself. A bus throws BusError for an access the hardware answers
// with a bus error (the core takes a BusFault) and anything else to stop the run (that error propagates out of step()
// with the core at the start of the instruction, its registers unchanged; a store multiple may have stored part of
// its list).
//
// Not modelled: the MPU's checks (its registers are kept), the debug halting state (BKPT stops the run instead, unless
// haltOnBkpt is false), FP data processing (Unimplemented), exception-entry faults (Unimplemented), tail-chaining and
// late arrival (an exception return pops, then the next step takes what is pending: the same states, more stacking),
// cycle timing (one cycle per instruction), the bit-band regions (the bus may implement them).
import { decode } from './decode.mjs';
import { ALU_AND, ALU_EOR, ALU_ORR, ALU_ORN, ALU_BIC, ALU_MOV, ALU_MVN, ALU_ADD, ALU_ADC, ALU_SUB, ALU_SBC, ALU_RSB, ALU_TST,
  ALU_TEQ, ALU_CMP, ALU_CMN, popcount } from './decode.mjs';
import { SystemBlock, CFSR, HFSR_FORCED, HFSR_DEBUGEVT, EXC_HARDFAULT, EXC_MEMMANAGE, EXC_BUSFAULT, EXC_USAGEFAULT, EXC_SVCALL,
  EXC_DEBUGMON } from './sys.mjs';
import { Unimplemented, BusError } from './errors.mjs';
export { Unimplemented, BusError };

const SP = 13, LR = 14, PC = 15;

// a synchronous fault raised while an instruction executes: exception number, the CFSR bit, a fault address
class Fault {
  constructor(exc, bit, addr = -1) { this.exc = exc; this.bit = bit; this.addr = addr; }
}
const usage = (bit) => new Fault(EXC_USAGEFAULT, bit);

// step() results
export const STEP_OK = 0, STEP_SLEEP = 1, STEP_BKPT = 2, STEP_LOCKUP = 3, STEP_RESET = 4;

export class CortexM4 {
  constructor({ bus, irqs = 83, prioBits = 4, refDiv = 8, haltOnBkpt = true } = {}) {
    this.bus = bus;
    // r0..r14 (r13 the current stack pointer, the other one banked in msp / psp); r[15] holds pc + 4 only while an
    // instruction executes (what reads of pc see), the program counter itself is pc
    this.r = new Int32Array(16);
    this.s = new Int32Array(32);                 // S0..S31 as raw words
    this.sys = new SystemBlock(this, { irqs, prioBits, refDiv });
    this.haltOnBkpt = haltOnBkpt;
    this.dcache = new Map();
    this.insns = 0;
    this.cycles = 0;
    this.reset();
  }

  // ---- reset (B1.5.5 TakeReset): SP_main and the entry from the vector table at VTOR = 0
  reset() {
    this.r.fill(0); this.s.fill(0);
    this.sys.reset();
    this.n = 0; this.z = 0; this.c = 0; this.v = 0; this.q = 0; this.ge = 0;
    this.it = 0; this.t = 1; this.ipsr = 0;
    this.primask = 0; this.faultmask = 0; this.basepri = 0; this.control = 0;
    this.fpscr = 0;
    this.msp = 0; this.psp = 0;
    this.excl = -1;
    this.event = 0;
    this.sleeping = false;
    this.halted = 0;
    this.irqDirty = true;
    this.npc = 0;
    this.bkptImm = -1;
    this.excReturn = 0;
    this.pendingSync = null;
    const sp = this.ld32(0), entry = this.ld32(4);
    this.r[SP] = sp & ~3;
    this.r[LR] = -1;
    this.pc = entry & ~1;
    this.t = entry & 1;
  }

  // ---- state for tools and tests
  xpsr() {
    return ((this.n << 31) | (this.z << 30) | (this.c << 29) | (this.v << 28) | (this.q << 27) | ((this.it & 3) << 25) |
      (this.t << 24) | (this.ge << 16) | (((this.it >>> 2) & 0x3f) << 10) | (this.ipsr & 0x1ff)) | 0;
  }
  setXpsr(v) {
    this.n = (v >>> 31) & 1; this.z = (v >>> 30) & 1; this.c = (v >>> 29) & 1; this.v = (v >>> 28) & 1; this.q = (v >>> 27) & 1;
    this.ge = (v >>> 16) & 15; this.t = (v >>> 24) & 1; this.it = (((v >>> 10) & 0x3f) << 2) | ((v >>> 25) & 3); this.ipsr = v & 0x1ff;
  }
  handlerMode() { return this.ipsr !== 0; }
  privileged() { return this.ipsr !== 0 || (this.control & 1) === 0; }
  processStack() { return this.ipsr === 0 && (this.control & 2) !== 0; }
  getMsp() { return this.processStack() ? this.msp : this.r[SP]; }
  getPsp() { return this.processStack() ? this.r[SP] : this.psp; }
  setMsp(v) { v &= ~3; if (this.processStack()) this.msp = v; else this.r[SP] = v; }
  setPsp(v) { v &= ~3; if (this.processStack()) this.r[SP] = v; else this.psp = v; }
  // a change of mode or SPSEL: f() changes ipsr / control, the banked SPs follow
  switchStack(f) {
    const wasPsp = this.processStack();
    if (wasPsp) this.psp = this.r[SP]; else this.msp = this.r[SP];
    f();
    this.r[SP] = this.processStack() ? this.psp : this.msp;
  }

  // ---- memory (data side); the PPB is the system block's
  ppbCheck(a, write) {
    if (!this.privileged() && !(write && a === 0xe000ef00 && (this.sys.ccr & 2))) throw new Fault(EXC_BUSFAULT, CFSR.PRECISERR, a);
  }
  ld8(a) {
    a >>>= 0;
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, false); return this.sys.read(a, 1) & 0xff; }
    return this.bus.read8(a) & 0xff;
  }
  ld16(a) {
    a >>>= 0;
    if (a & 1) return this.ld8(a) | (this.ld8(a + 1) << 8);
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, false); return this.sys.read(a, 2) & 0xffff; }
    return this.bus.read16(a) & 0xffff;
  }
  ld32(a) {
    a >>>= 0;
    if (a & 3) return (this.ld8(a) | (this.ld8(a + 1) << 8) | (this.ld8(a + 2) << 16) | (this.ld8(a + 3) << 24)) | 0;
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, false); return this.sys.read(a, 4) | 0; }
    return this.bus.read32(a) | 0;
  }
  st8(a, v) {
    a >>>= 0;
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, true); this.sys.write(a, 1, v & 0xff); return; }
    this.bus.write8(a, v & 0xff);
  }
  st16(a, v) {
    a >>>= 0;
    if (a & 1) { this.st8(a, v); this.st8(a + 1, v >>> 8); return; }
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, true); this.sys.write(a, 2, v & 0xffff); return; }
    this.bus.write16(a, v & 0xffff);
  }
  st32(a, v) {
    a >>>= 0;
    if (a & 3) { this.st8(a, v); this.st8(a + 1, v >>> 8); this.st8(a + 2, v >>> 16); this.st8(a + 3, v >>> 24); return; }
    if (a >= 0xe0000000 && a < 0xe0100000) { this.ppbCheck(a, true); this.sys.write(a, 4, v | 0); return; }
    this.bus.write32(a, v | 0);
  }
  // an access whose size must be naturally aligned (LDM, LDRD, LDREX, ...), or any when CCR.UNALIGN_TRP is set
  aligned(a, size, always) {
    if ((a & (size - 1)) && (always || (this.sys.ccr & 8))) throw usage(CFSR.UNALIGNED);
  }
  load(a, size, signed) {
    this.aligned(a, size, false);
    if (size === 4) return this.ld32(a);
    if (size === 2) { const v = this.ld16(a); return signed ? (v << 16) >> 16 : v; }
    const v = this.ld8(a);
    return signed ? (v << 24) >> 24 : v;
  }
  store(a, size, v) {
    this.aligned(a, size, false);
    if (size === 4) this.st32(a, v); else if (size === 2) this.st16(a, v); else this.st8(a, v);
  }

  // ---- program counter writes (A2.3.1)
  branch(a) { this.npc = a & ~1; }                         // BranchWritePC (and ALUWritePC)
  bxWrite(a) {                                             // BXWritePC / LoadWritePC
    if (this.ipsr !== 0 && (a >>> 28) === 0xf) { this.excReturn = a | 0; return; }
    this.t = a & 1;
    this.npc = a & ~1;
  }
  setReg(n, v) {
    if (n === SP) this.r[SP] = v & ~3; else this.r[n] = v;
  }

  // ---- the condition (A7.3.1)
  pass(cond) {
    switch (cond) {
      case 0: return this.z === 1; case 1: return this.z === 0; case 2: return this.c === 1; case 3: return this.c === 0;
      case 4: return this.n === 1; case 5: return this.n === 0; case 6: return this.v === 1; case 7: return this.v === 0;
      case 8: return this.c === 1 && this.z === 0; case 9: return this.c === 0 || this.z === 1;
      case 10: return this.n === this.v; case 11: return this.n !== this.v;
      case 12: return this.z === 0 && this.n === this.v; case 13: return this.z === 1 || this.n !== this.v;
      default: return true;
    }
  }
  nz(v) { this.n = v >>> 31; this.z = v === 0 ? 1 : 0; }

  // ---- one instruction, or one exception entry
  step() {
    if (this.halted) return this.halted;
    if (this.irqDirty) {
      this.irqDirty = false;
      if (this.sleeping && this.sys.wakes()) this.sleeping = false;
      const n = this.sys.takeable();
      if (n) { this.sleeping = false; this.enter(n, this.pc); this.tick(); return STEP_OK; }
    }
    if (this.sleeping) { this.tick(); return STEP_SLEEP; }
    const pc = this.pc, it = this.it;
    let d;
    try {
      if (!this.t) throw usage(CFSR.INVSTATE);
      d = this.fetch(pc);
    } catch (e) {
      if (e instanceof BusError) return this.fault(new Fault(EXC_BUSFAULT, CFSR.IBUSERR), pc, it);
      if (e instanceof Fault) return this.fault(e, pc, it);
      throw e;
    }
    this.r[PC] = (pc + 4) | 0;
    this.npc = (pc + d.len) | 0;
    this.excReturn = 0;
    const inIt = (it & 15) !== 0;
    if (!inIt || this.pass(it >>> 4)) {
      try {
        X[d.op](this, d);
      } catch (e) {
        this.r[PC] = 0;
        if (e instanceof Fault) return this.fault(e, pc, it);
        if (e instanceof BusError) return this.fault(new Fault(EXC_BUSFAULT, CFSR.PRECISERR, e.addr), pc, it);
        this.npc = pc; this.it = it;
        throw e;
      }
      if (this.halted === STEP_BKPT) { this.halted = 0; this.r[PC] = 0; this.bkptImm = d.imm; return STEP_BKPT; }
    }
    if (inIt && d.op !== 'it') this.it = (it & 7) === 0 ? 0 : (it & 0xe0) | ((it << 1) & 0x1f);
    this.r[PC] = 0;
    this.pc = this.npc;
    this.insns++;
    this.tick();
    if (this.excReturn) this.exceptionReturn(this.excReturn);
    if (this.pendingSync) { const f = this.pendingSync; this.pendingSync = null; return this.raise(f.exc, f.ret); }
    if (this.sys.resetRequest) { this.sys.resetRequest = false; this.reset(); return STEP_RESET; }
    return this.halted || STEP_OK;
  }
  tick() { this.cycles++; this.sys.tick(1); }

  // run up to n steps; stops early at a breakpoint, a lockup, a reset request, or when asleep with nothing to wake it
  run(n) {
    for (let i = 0; i < n; i++) {
      const r = this.step();
      if (r !== STEP_OK && r !== STEP_SLEEP) return r;
    }
    return STEP_OK;
  }

  fetch(pc) {
    const cache = this.bus.codeCacheable && this.bus.codeCacheable(pc >>> 0);
    if (cache) { const d = this.dcache.get(pc); if (d) return d; }
    const hw1 = this.fetch16(pc);
    const hw2 = (hw1 >>> 11) >= 0x1d ? this.fetch16(pc + 2) : 0;
    const d = decode(hw1, hw2);
    if (cache) this.dcache.set(pc, d);
    return d;
  }
  fetch16(a) {
    a >>>= 0;
    if (a >= 0xe0000000) throw new Fault(EXC_MEMMANAGE, CFSR.IACCVIOL);   // execute never (B3.1)
    return this.bus.read16(a) & 0xffff;
  }

  // ---- exceptions (B1.5.6 .. B1.5.8)
  // a fault raised by the instruction at pc: CFSR, then entry (or escalation to HardFault, or lockup)
  fault(f, pc, it) {
    this.it = it; this.npc = pc; this.r[PC] = 0;
    const s = this.sys;
    s.cfsr |= f.bit;
    if (f.addr >= 0 && f.exc === EXC_BUSFAULT) { s.bfar = f.addr; s.cfsr |= CFSR.BFARVALID; }
    if (f.addr >= 0 && f.exc === EXC_MEMMANAGE) { s.mmfar = f.addr; s.cfsr |= CFSR.MMARVALID; }
    return this.raise(f.exc, pc);
  }
  // take a synchronous exception now if it can preempt, else escalate to HardFault; a fault at priority -1 or below
  // locks up
  raise(exc, ret) {
    const s = this.sys, exec = s.executionPriority();
    let n = exc;
    if (n !== EXC_HARDFAULT && (!s.faultEnabled(n) || s.group(s.priority(n)) >= exec)) {
      n = EXC_HARDFAULT;
      s.hfsr |= exc === EXC_DEBUGMON ? HFSR_DEBUGEVT : HFSR_FORCED;
    }
    if (n === EXC_HARDFAULT && exec <= -1) { this.halted = STEP_LOCKUP; return STEP_LOCKUP; }
    this.enter(n, ret);
    return STEP_OK;
  }

  // ExceptionEntry: PushStack, then ExceptionTaken
  enter(n, ret) {
    const s = this.sys;
    const fpca = (this.control >>> 2) & 1;
    const frame = fpca ? 0x68 : 0x20, force = fpca ? 1 : (s.ccr >>> 9) & 1;
    const psp = this.processStack();
    const sp = this.r[SP];
    const align = (sp >>> 2) & 1 & force;
    const fp = ((sp - frame) & ~(force << 2)) | 0;
    const xpsr = (this.xpsr() & ~(1 << 9)) | (align << 9);
    try {
      this.st32(fp, this.r[0]); this.st32(fp + 4, this.r[1]); this.st32(fp + 8, this.r[2]); this.st32(fp + 12, this.r[3]);
      this.st32(fp + 16, this.r[12]); this.st32(fp + 20, this.r[LR]); this.st32(fp + 24, ret); this.st32(fp + 28, xpsr);
      if (fpca) {
        if (s.fpccr & (1 << 30)) this.updateFpccr(fp);    // LSPEN: reserve the space, save lazily
        else { for (let i = 0; i < 16; i++) this.st32(fp + 0x20 + 4 * i, this.s[i]); this.st32(fp + 0x60, this.fpscr); }
      }
    } catch (e) {
      if (e instanceof BusError || e instanceof Fault) throw new Unimplemented(`a fault while stacking for exception ${n} at 0x${(fp >>> 0).toString(16)}`);
      throw e;
    }
    this.r[SP] = fp;
    const excRet = this.ipsr !== 0 ? 0xfffffff1 : psp ? 0xfffffffd : 0xfffffff9;
    this.r[LR] = (excRet & ~(fpca << 4)) | 0;
    let vec;
    try { vec = this.ld32((s.vtor + 4 * n) >>> 0); } catch (e) {
      if (e instanceof BusError) throw new Unimplemented(`a bus error on the vector fetch of exception ${n}`);
      throw e;
    }
    this.switchStack(() => { this.ipsr = n; this.control &= ~2; });
    this.control &= ~4;
    this.pc = vec & ~1; this.t = vec & 1;
    this.it = 0;
    s.activate(n);
    this.excl = -1;
    this.event = 1;
    this.irqDirty = true;
  }
  updateFpccr(fp) {
    const s = this.sys, exec = s.executionPriority();
    let v = s.fpccr & 0xc0000000;
    v |= 1;                                               // LSPACT
    if (!this.privileged()) v |= 2;                       // USER
    if (this.ipsr === 0) v |= 8;                          // THREAD
    if (exec > -1) v |= 16;                               // HFRDY
    if ((s.shcsrEna & 1) && s.group(s.priority(EXC_MEMMANAGE)) < exec) v |= 32;
    if ((s.shcsrEna & 2) && s.group(s.priority(EXC_BUSFAULT)) < exec) v |= 64;
    if ((s.demcr & (1 << 16)) && s.group(s.priority(EXC_DEBUGMON)) < exec) v |= 256;
    s.fpccr = v | 0;
    s.fpcar = (fp + 0x20) & ~7;
  }
  // PreserveFPState: the lazy save into the frame FPCAR names
  preserveFp() {
    const s = this.sys;
    for (let i = 0; i < 16; i++) this.st32(s.fpcar + 4 * i, this.s[i]);
    this.st32(s.fpcar + 0x40, this.fpscr);
    s.fpccr &= ~1;
  }

  // ExceptionReturn (B1.5.8)
  exceptionReturn(er) {
    const s = this.sys, ret = this.ipsr;
    const invalid = () => {
      s.cfsr |= CFSR.INVPC;
      this.r[LR] = er;                                    // (the pseudocode's 0xf0000000 + EXC_RETURN<27:0>)
      return this.raise(EXC_USAGEFAULT, this.pc);
    };
    if ((er & 0x0fffffe0) !== 0x0fffffe0 || !s.active[ret]) return invalid();
    const mode = er & 15, nested = s.activeCount();
    let toPsp = false, toHandler = false;
    if (mode === 1) { if (nested === 1) return invalid(); toHandler = true; }
    else if (mode === 9 || mode === 13) { if (nested !== 1 && !(s.ccr & 1)) return invalid(); toPsp = mode === 13; }
    else return invalid();
    s.deactivate(ret);
    // PopStack
    const fpFrame = ((er >>> 4) & 1) === 0;
    const frame = fpFrame ? 0x68 : 0x20, force = fpFrame ? 1 : (s.ccr >>> 9) & 1;
    // the frame's stack: SP_process for mode 13, else SP_main (the current SP in handler mode is SP_main)
    const fp = toPsp ? this.psp : this.r[SP];
    const v = [];
    try {
      for (let i = 0; i < 8; i++) v.push(this.ld32(fp + 4 * i));
      if (fpFrame) {
        if (s.fpccr & 1) s.fpccr &= ~1;                   // LSPACT: the FP registers still hold the state
        else { for (let i = 0; i < 16; i++) this.s[i] = this.ld32(fp + 0x20 + 4 * i); this.fpscr = this.ld32(fp + 0x60); }
      }
    } catch (e) {
      if (e instanceof BusError || e instanceof Fault) throw new Unimplemented(`a fault while unstacking from 0x${(fp >>> 0).toString(16)}`);
      throw e;
    }
    const psr = v[7];
    const spNew = ((fp + frame) | (((psr >>> 9) & 1 & force) << 2)) | 0;
    this.r[0] = v[0]; this.r[1] = v[1]; this.r[2] = v[2]; this.r[3] = v[3]; this.r[12] = v[4]; this.r[LR] = v[5];
    this.pc = v[6] & ~1;
    // mode and stack: handler mode keeps SP_main; thread mode selects by EXC_RETURN
    this.msp = toPsp ? this.r[SP] : spNew;
    if (toPsp) this.psp = spNew;
    this.ipsr = toHandler ? (psr & 0x1ff) : 0;
    this.control = (this.control & ~2) | (toPsp ? 2 : 0);
    this.control = (this.control & ~4) | (fpFrame ? 4 : 0);
    this.r[SP] = this.processStack() ? this.psp : this.msp;
    this.n = (psr >>> 31) & 1; this.z = (psr >>> 30) & 1; this.c = (psr >>> 29) & 1; this.v = (psr >>> 28) & 1; this.q = (psr >>> 27) & 1;
    this.ge = (psr >>> 16) & 15;
    this.t = (psr >>> 24) & 1;
    this.it = (((psr >>> 10) & 0x3f) << 2) | ((psr >>> 25) & 3);
    if (toHandler && (psr & 0x1ff) === 0) return invalid();
    if (!toHandler && (psr & 0x1ff) !== 0) return invalid();
    this.excl = -1;
    this.event = 1;
    this.irqDirty = true;
    if (!toHandler && (s.scr & 2)) this.sleeping = true;   // SLEEPONEXIT
    return STEP_OK;
  }

  // the FP instructions' check (B1.6 ExecuteFPCheck): CPACR, then the lazy save and the FP context flag
  fpCheck() {
    const acc = (this.sys.cpacr >>> 20) & 3;
    if (acc === 0 || acc === 2 || (acc === 1 && !this.privileged())) throw usage(CFSR.NOCP);
    const s = this.sys;
    if (s.fpccr & 1) this.preserveFp();
    if ((s.fpccr & (1 << 31)) && !(this.control & 4)) { this.fpscr = s.fpdscr; this.control |= 4; }
  }
}

// ---- arithmetic helpers
// Shift_C on (value, type, amount): the result, its carry in SC
let SC = 0;
function shiftC(v, type, amount, cin) {
  if (amount === 0) { SC = cin; return v; }
  switch (type) {
    case 0:
      if (amount < 32) { SC = (v >>> (32 - amount)) & 1; return v << amount; }
      SC = amount === 32 ? v & 1 : 0; return 0;
    case 1:
      if (amount < 32) { SC = (v >>> (amount - 1)) & 1; return (v >>> amount) | 0; }
      SC = amount === 32 ? v >>> 31 : 0; return 0;
    case 2:
      if (amount < 32) { SC = (v >> (amount - 1)) & 1; return v >> amount; }
      SC = v >>> 31; return v >> 31;
    case 3: {
      const a = amount & 31;
      const r = a === 0 ? v : ((v >>> a) | (v << (32 - a)));
      SC = r >>> 31; return r | 0;
    }
    default: SC = v & 1; return ((cin << 31) | (v >>> 1)) | 0;   // RRX
  }
}
// AddWithCarry: the result, its carry and overflow in AC / AV
let AC = 0, AV = 0;
function addc(x, y, cin) {
  const u = (x >>> 0) + (y >>> 0) + cin, r = u | 0;
  AC = u > 0xffffffff ? 1 : 0;
  AV = (x | 0) + (y | 0) + cin !== r ? 1 : 0;
  return r;
}
const ror = (v, a) => (a === 0 ? v : ((v >>> a) | (v << (32 - a))) | 0);
// SignedSatQ / UnsignedSatQ: the value, saturation in SAT
let SAT = 0;
function ssat(x, n) { const hi = 2 ** (n - 1) - 1, lo = -(2 ** (n - 1)); if (x > hi) { SAT = 1; return hi; } if (x < lo) { SAT = 1; return lo; } return x; }
function usat(x, n) { const hi = 2 ** n - 1; if (x > hi) { SAT = 1; return hi; } if (x < 0) { SAT = 1; return 0; } return x; }
const big = (v) => BigInt.asIntN(32, BigInt(v | 0));
const ubig = (v) => BigInt(v >>> 0);
function set64(c, lo, hi, v) { c.r[lo] = Number(BigInt.asIntN(32, v)); c.r[hi] = Number(BigInt.asIntN(32, v >> 32n)); }
const half = (v, top) => (top ? v >> 16 : (v << 16) >> 16);

// operand 2 of a data-processing form; its shifter carry in SC
function operand2(c, d) {
  if (d.rm < 0) { SC = d.ic >= 0 ? d.ic : c.c; return d.imm; }
  const m = c.r[d.rm];
  if (d.sa === -1) return shiftC(m, d.sh, c.r[d.ra] & 0xff, c.c);
  if (d.sh === 4) return shiftC(m, 4, 1, c.c);
  return shiftC(m, d.sh, d.sa, c.c);
}

// ---- the executor: one handler per decode op
const X = {
  dp(c, d) {
    const op2 = operand2(c, d), carry = SC;
    const n = d.rn >= 0 ? c.r[d.rn] : 0;
    const sf = d.s === 1 || (d.s === 2 && (c.it & 15) === 0);
    let r, arith = false;
    switch (d.alu) {
      case ALU_AND: case ALU_TST: r = n & op2; break;
      case ALU_EOR: case ALU_TEQ: r = n ^ op2; break;
      case ALU_ORR: r = n | op2; break;
      case ALU_ORN: r = n | ~op2; break;
      case ALU_BIC: r = n & ~op2; break;
      case ALU_MOV: r = op2; break;
      case ALU_MVN: r = ~op2; break;
      case ALU_ADD: case ALU_CMN: r = addc(n, op2, 0); arith = true; break;
      case ALU_ADC: r = addc(n, op2, c.c); arith = true; break;
      case ALU_SUB: case ALU_CMP: r = addc(n, ~op2, 1); arith = true; break;
      case ALU_SBC: r = addc(n, ~op2, c.c); arith = true; break;
      case ALU_RSB: r = addc(~n, op2, 1); arith = true; break;
    }
    if (d.rd === PC) { c.branch(r); return; }             // ADD / MOV (register) to pc: ALUWritePC
    if (d.rd >= 0) c.setReg(d.rd, r);
    if (sf) {
      c.nz(r);
      if (arith) { c.c = AC; c.v = AV; } else c.c = carry;
    }
  },
  adr(c, d) { c.setReg(d.rd, ((c.r[PC] & ~3) + d.imm) | 0); },
  movw(c, d) { c.setReg(d.rd, d.imm); },
  movt(c, d) { c.setReg(d.rd, (c.r[d.rd] & 0xffff) | (d.imm << 16)); },
  mul(c, d) {
    const r = Math.imul(c.r[d.rn], c.r[d.rm]);
    c.setReg(d.rd, r);
    if (d.s === 1 || (d.s === 2 && (c.it & 15) === 0)) c.nz(r);
  },
  mla(c, d) { c.r[d.rd] = (Math.imul(c.r[d.rn], c.r[d.rm]) + c.r[d.ra]) | 0; },
  mls(c, d) { c.r[d.rd] = (c.r[d.ra] - Math.imul(c.r[d.rn], c.r[d.rm])) | 0; },
  mull(c, d) {
    let p = d.sg ? big(c.r[d.rn]) * big(c.r[d.rm]) : ubig(c.r[d.rn]) * ubig(c.r[d.rm]);
    if (d.alu) p += (ubig(c.r[d.ra]) << 32n) | ubig(c.r[d.rd]);
    set64(c, d.rd, d.ra, p);
  },
  umaal(c, d) { set64(c, d.rd, d.ra, ubig(c.r[d.rn]) * ubig(c.r[d.rm]) + ubig(c.r[d.ra]) + ubig(c.r[d.rd])); },
  div(c, d) {
    const m = c.r[d.rm];
    if (m === 0) { if (c.sys.ccr & 0x10) throw usage(CFSR.DIVBYZERO); c.r[d.rd] = 0; return; }
    c.r[d.rd] = d.sg ? Math.trunc(c.r[d.rn] / m) | 0 : ((c.r[d.rn] >>> 0) / (m >>> 0)) >>> 0 | 0;
  },
  smulxy(c, d) {
    const p = half(c.r[d.rn], d.sh & 2) * half(c.r[d.rm], d.sh & 1);
    if (d.ra < 0) { c.r[d.rd] = p | 0; return; }
    const r = p + c.r[d.ra];
    if (r !== (r | 0)) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  smuad(c, d) {
    const n = c.r[d.rn], m = d.sh ? ror(c.r[d.rm], 16) : c.r[d.rm];
    const p1 = half(n, 0) * half(m, 0), p2 = half(n, 1) * half(m, 1);
    let r = d.sg ? p1 - p2 : p1 + p2;
    if (d.ra >= 0) r += c.r[d.ra];
    if (r !== (r | 0)) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  smulw(c, d) {
    const p = Math.floor((c.r[d.rn] * half(c.r[d.rm], d.sh)) / 65536);
    if (d.ra < 0) { c.r[d.rd] = p | 0; return; }
    const r = p + c.r[d.ra];
    if (r !== (r | 0)) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  smmul(c, d) {
    let p = big(c.r[d.rn]) * big(c.r[d.rm]);
    if (d.ra >= 0) p = d.sg ? (big(c.r[d.ra]) << 32n) - p : (big(c.r[d.ra]) << 32n) + p;
    if (d.sh) p += 0x80000000n;
    c.r[d.rd] = Number(BigInt.asIntN(32, p >> 32n));
  },
  smlalxy(c, d) {
    const p = BigInt(half(c.r[d.rn], d.sh & 2) * half(c.r[d.rm], d.sh & 1));
    set64(c, d.rd, d.ra, ((ubig(c.r[d.ra]) << 32n) | ubig(c.r[d.rd])) + p);
  },
  smlald(c, d) {
    const n = c.r[d.rn], m = d.sh ? ror(c.r[d.rm], 16) : c.r[d.rm];
    const p1 = BigInt(half(n, 0) * half(m, 0)), p2 = BigInt(half(n, 1) * half(m, 1));
    set64(c, d.rd, d.ra, ((ubig(c.r[d.ra]) << 32n) | ubig(c.r[d.rd])) + (d.sg ? p1 - p2 : p1 + p2));
  },
  usad8(c, d) {
    const n = c.r[d.rn], m = c.r[d.rm];
    let s = 0;
    for (let i = 0; i < 32; i += 8) s += Math.abs(((n >>> i) & 0xff) - ((m >>> i) & 0xff));
    c.r[d.rd] = (d.ra >= 0 ? s + c.r[d.ra] : s) | 0;
  },
  ext(c, d) {
    const v = ror(c.r[d.rm], d.imm);
    const x = d.sz === 1 ? (d.sg ? (v << 24) >> 24 : v & 0xff) : (d.sg ? (v << 16) >> 16 : v & 0xffff);
    c.r[d.rd] = d.rn >= 0 ? (c.r[d.rn] + x) | 0 : x;
  },
  ext16(c, d) {
    const v = ror(c.r[d.rm], d.imm), n = d.rn >= 0 ? c.r[d.rn] : 0;
    const e = (b) => (d.sg ? (b << 24) >> 24 : b & 0xff);
    const lo = (n + e(v & 0xff)) & 0xffff, hi = ((n >>> 16) + e((v >>> 16) & 0xff)) & 0xffff;
    c.r[d.rd] = (hi << 16) | lo;
  },
  rev(c, d) {
    const m = c.r[d.rm];
    if (d.sh === 0) c.r[d.rd] = ((m >>> 24) | ((m >>> 8) & 0xff00) | ((m << 8) & 0xff0000) | (m << 24)) | 0;
    else if (d.sh === 1) c.r[d.rd] = (((m >>> 8) & 0x00ff00ff) | ((m << 8) & 0xff00ff00)) | 0;
    else c.r[d.rd] = ((((m & 0xff) << 24) >> 16) | ((m >>> 8) & 0xff)) | 0;
  },
  rbit(c, d) {
    let m = c.r[d.rm], r = 0;
    for (let i = 0; i < 32; i++) { r = (r << 1) | (m & 1); m >>>= 1; }
    c.r[d.rd] = r | 0;
  },
  clz(c, d) { c.r[d.rd] = Math.clz32(c.r[d.rm]); },
  sel(c, d) {
    const n = c.r[d.rn], m = c.r[d.rm];
    let r = 0;
    for (let i = 0; i < 4; i++) r |= (((c.ge >>> i) & 1) ? n : m) & (0xff << (8 * i));
    c.r[d.rd] = r | 0;
  },
  qadd(c, d) {
    SAT = 0;
    let n = c.r[d.rn];
    if (d.sh & 1) n = ssat(2 * n, 32);
    const r = ssat(d.sh & 2 ? c.r[d.rm] - n : c.r[d.rm] + n, 32);
    if (SAT) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  sat(c, d) {
    SAT = 0;
    const x = d.sh === 2 ? (d.sa === 0 ? c.r[d.rn] >> 31 : c.r[d.rn] >> d.sa) : c.r[d.rn] << d.sa;
    const r = d.sg ? ssat(x, d.imm) : usat(x, d.imm);
    if (SAT) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  sat16(c, d) {
    SAT = 0;
    const n = c.r[d.rn];
    const f = (h) => (d.sg ? ssat(h, d.imm) : usat(h, d.imm)) & 0xffff;
    const r = (f(half(n, 1)) << 16) | f(half(n, 0));
    if (SAT) c.q = 1;
    c.r[d.rd] = r | 0;
  },
  bfx(c, d) {
    const v = c.r[d.rn] << (32 - d.sa - d.imm);
    c.r[d.rd] = d.sg ? v >> (32 - d.imm) : (v >>> (32 - d.imm)) | 0;
  },
  bfi(c, d) {
    const w = d.imm - d.sa + 1, mask = (w === 32 ? -1 : ((1 << w) - 1)) << d.sa;
    const src = d.rn === 15 ? 0 : c.r[d.rn] << d.sa;
    c.r[d.rd] = (c.r[d.rd] & ~mask) | (src & mask);
  },
  pkh(c, d) {
    const n = c.r[d.rn], m = shiftC(c.r[d.rm], d.sh, d.sa, c.c);
    c.r[d.rd] = d.sh === 2 ? ((n & 0xffff0000) | (m & 0xffff)) | 0 : ((n & 0xffff) | (m & 0xffff0000)) | 0;
  },
  par(c, d) {                                             // parallel add / subtract (A7.7: SADD16 .. UHSUB8)
    const n = c.r[d.rn], m = c.r[d.rm], sg = d.sg, mode = d.sh, o = d.alu;
    const byte = o === 0 || o === 4, lanes = byte ? 4 : 2, bits = byte ? 8 : 16, mask = byte ? 0xff : 0xffff;
    const lane = (v, i) => { const x = (v >>> (bits * i)) & mask; return sg ? (x << (32 - bits)) >> (32 - bits) : x; };
    let r = 0, ge = 0;
    for (let i = 0; i < lanes; i++) {
      let x, sub;
      if (byte) { sub = o === 4; x = sub ? lane(n, i) - lane(m, i) : lane(n, i) + lane(m, i); }
      else if (o === 1) { sub = false; x = lane(n, i) + lane(m, i); }
      else if (o === 5) { sub = true; x = lane(n, i) - lane(m, i); }
      else if (o === 2) { sub = i === 0; x = i === 0 ? lane(n, 0) - lane(m, 1) : lane(n, 1) + lane(m, 0); }   // ASX
      else { sub = i === 1; x = i === 0 ? lane(n, 0) + lane(m, 1) : lane(n, 1) - lane(m, 0); }               // SAX
      let out;
      if (mode === 0) {
        out = x & mask;
        const g = sg ? x >= 0 : (sub ? x >= 0 : x >= (1 << bits));
        if (g) ge |= byte ? 1 << i : 3 << (2 * i);
      } else if (mode === 1) {
        SAT = 0;
        out = (sg ? ssat(x, bits) : usat(x, bits)) & mask;
      } else out = (x >> 1) & mask;
      r |= out << (bits * i);
    }
    if (mode === 0) c.ge = ge;
    c.r[d.rd] = r | 0;
  },

  // ---- loads and stores
  ldr(c, d) {
    const base = d.rn === PC ? c.r[PC] & ~3 : c.r[d.rn];
    const off = d.rm >= 0 ? c.r[d.rm] << d.sa : d.imm;
    const oa = (d.add ? base + off : base - off) | 0, a = d.idx ? oa : base;
    const v = c.load(a, d.sz, d.sg);
    if (d.wb) c.setReg(d.rn, oa);
    if (d.rd === PC) { if (a & 3) throw usage(CFSR.UNALIGNED); c.bxWrite(v); } else c.setReg(d.rd, v);
  },
  str(c, d) {
    const base = c.r[d.rn];
    const off = d.rm >= 0 ? c.r[d.rm] << d.sa : d.imm;
    const oa = (d.add ? base + off : base - off) | 0, a = d.idx ? oa : base;
    c.store(a, d.sz, c.r[d.rd]);
    if (d.wb) c.setReg(d.rn, oa);
  },
  ldrd(c, d) {
    const base = d.rn === PC ? c.r[PC] & ~3 : c.r[d.rn];
    const oa = (d.add ? base + d.imm : base - d.imm) | 0, a = d.idx ? oa : base;
    c.aligned(a, 4, true);
    const lo = c.ld32(a), hi = c.ld32(a + 4);
    if (d.wb) c.setReg(d.rn, oa);
    c.setReg(d.rd, lo); c.setReg(d.ra, hi);
  },
  strd(c, d) {
    const base = c.r[d.rn];
    const oa = (d.add ? base + d.imm : base - d.imm) | 0, a = d.idx ? oa : base;
    c.aligned(a, 4, true);
    c.st32(a, c.r[d.rd]); c.st32(a + 4, c.r[d.ra]);
    if (d.wb) c.setReg(d.rn, oa);
  },
  ldm(c, d) {
    const base = c.r[d.rn], k = popcount(d.list);
    let a = d.add ? base : (base - 4 * k) | 0;
    c.aligned(a, 4, true);
    const v = new Int32Array(16);
    for (let i = 0; i < 16; i++) if ((d.list >>> i) & 1) { v[i] = c.ld32(a); a += 4; }
    if (d.wb) c.setReg(d.rn, d.add ? base + 4 * k : base - 4 * k);
    for (let i = 0; i < 15; i++) if ((d.list >>> i) & 1) c.setReg(i, v[i]);
    if ((d.list >>> 15) & 1) c.bxWrite(v[15]);
  },
  stm(c, d) {
    const base = c.r[d.rn], k = popcount(d.list);
    let a = d.add ? base : (base - 4 * k) | 0;
    c.aligned(a, 4, true);
    for (let i = 0; i < 15; i++) if ((d.list >>> i) & 1) { c.st32(a, c.r[i]); a += 4; }
    if (d.wb) c.setReg(d.rn, d.add ? base + 4 * k : base - 4 * k);
  },
  ldrex(c, d) {
    const a = (c.r[d.rn] + d.imm) | 0;
    c.aligned(a, d.sz, true);
    const v = d.sz === 4 ? c.ld32(a) : d.sz === 2 ? c.ld16(a) : c.ld8(a);
    c.excl = a;
    c.setReg(d.rd, v);
  },
  strex(c, d) {
    const a = (c.r[d.rn] + d.imm) | 0;
    c.aligned(a, d.sz, true);
    if (c.excl === a) {
      if (d.sz === 4) c.st32(a, c.r[d.rm]); else if (d.sz === 2) c.st16(a, c.r[d.rm]); else c.st8(a, c.r[d.rm]);
      c.r[d.rd] = 0;
    } else c.r[d.rd] = 1;
    c.excl = -1;
  },
  clrex(c) { c.excl = -1; },
  tb(c, d) {
    const base = c.r[d.rn], m = c.r[d.rm];
    const h = d.sz === 1 ? c.ld8((base + m) | 0) : c.ld16((base + (m << 1)) | 0);
    c.branch((c.r[PC] + 2 * h) | 0);
  },

  // ---- branches
  b(c, d) { if (d.cond === 14 || c.pass(d.cond)) c.branch((c.r[PC] + d.imm) | 0); },
  bl(c, d) { c.r[LR] = c.npc | 1; c.branch((c.r[PC] + d.imm) | 0); },
  bx(c, d) { c.bxWrite(c.r[d.rm]); },
  blx(c, d) { const t = c.r[d.rm]; c.r[LR] = c.npc | 1; c.bxWrite(t); },
  cbz(c, d) { if ((c.r[d.rn] !== 0) === (d.add === 1)) c.branch((c.r[PC] + d.imm) | 0); },
  it(c, d) { c.it = (d.cond << 4) | d.list; },

  // ---- system
  hint(c, d) {
    if (d.imm === 3) { if (!c.sys.wakes()) c.sleeping = true; }        // WFI
    else if (d.imm === 2) { if (c.event) c.event = 0; else if (!c.sys.wakes()) c.sleeping = true; }   // WFE
    else if (d.imm === 4) c.event = 1;                                // SEV (a single core: its own event register)
  },
  barrier() {},
  pld() {},
  mrs(c, d) {
    const sysm = d.imm;
    let v = 0;
    if (sysm < 8) {
      if (sysm & 1) v |= c.ipsr & 0x1ff;
      if (!(sysm & 4)) v |= ((c.n << 31) | (c.z << 30) | (c.c << 29) | (c.v << 28) | (c.q << 27) | (c.ge << 16));
    } else if (c.privileged()) {
      switch (sysm) {
        case 8: v = c.getMsp(); break;
        case 9: v = c.getPsp(); break;
        case 16: v = c.primask; break;
        case 17: case 18: v = c.basepri; break;
        case 19: v = c.faultmask; break;
        case 20: v = c.control; break;
      }
    } else if (sysm === 20) v = c.control;
    c.setReg(d.rd, v | 0);
  },
  msr(c, d) {
    const v = c.r[d.rn], sysm = d.imm;
    if (sysm < 8) {
      if (sysm & 4) return;                               // EPSR / IPSR: ignored
      if (d.list & 2) { c.n = (v >>> 31) & 1; c.z = (v >>> 30) & 1; c.c = (v >>> 29) & 1; c.v = (v >>> 28) & 1; c.q = (v >>> 27) & 1; }
      if (d.list & 1) c.ge = (v >>> 16) & 15;
      return;
    }
    if (!c.privileged()) return;
    const pm = c.sys.prioMask;
    switch (sysm) {
      case 8: c.setMsp(v); break;
      case 9: c.setPsp(v); break;
      case 16: c.primask = v & 1; break;
      case 17: c.basepri = v & pm; break;
      case 18: { const b = v & pm; if (b !== 0 && (c.basepri === 0 || b < c.basepri)) c.basepri = b; break; }
      case 19: if (c.sys.executionPriority() > -1 || !(v & 1)) c.faultmask = v & 1; break;
      case 20:
        c.control = (c.control & ~1) | (v & 1);
        if (c.ipsr === 0) c.switchStack(() => { c.control = (c.control & ~2) | (v & 2); });
        c.control = (c.control & ~4) | (v & 4);
        break;
    }
    c.irqDirty = true;
  },
  cps(c, d) {
    if (!c.privileged()) return;
    const dis = d.add;
    if (d.imm & 2) c.primask = dis;
    if (d.imm & 1) { if (!dis) c.faultmask = 0; else if (c.sys.executionPriority() > -1) c.faultmask = 1; }
    c.irqDirty = true;
  },
  svc(c) { c.pendingSync = { exc: EXC_SVCALL, ret: c.npc }; },
  bkpt(c) {
    if (c.haltOnBkpt) { c.halted = STEP_BKPT; return; }
    c.pendingSync = { exc: EXC_DEBUGMON, ret: c.pc };     // no debugger: DebugMonitor, which escalates when not enabled
  },
  udf() { throw usage(CFSR.UNDEFINSTR); },
  nocp() { throw usage(CFSR.NOCP); },
  vfp(c, d) { c.fpCheck(); throw new Unimplemented(`FP instruction ${d.enc}`); },

  // ---- the FPU's register transfers and loads / stores
  vmrs(c, d) {
    c.fpCheck();
    if (d.rd === 15) { const f = c.fpscr; c.n = (f >>> 31) & 1; c.z = (f >>> 30) & 1; c.c = (f >>> 29) & 1; c.v = (f >>> 28) & 1; }
    else c.setReg(d.rd, c.fpscr);
  },
  vmsr(c, d) { c.fpCheck(); c.fpscr = c.r[d.rd] & 0xf7c0009f; },
  vmov1(c, d) { c.fpCheck(); if (d.add) c.setReg(d.rd, c.s[d.rm]); else c.s[d.rm] = c.r[d.rd]; },
  vmov2(c, d) {
    c.fpCheck();
    if (d.add) { c.setReg(d.rd, c.s[d.rm]); c.setReg(d.ra, c.s[d.rm + 1]); }
    else { c.s[d.rm] = c.r[d.rd]; c.s[d.rm + 1] = c.r[d.ra]; }
  },
  vldr(c, d) {
    c.fpCheck();
    const base = d.rn === PC ? c.r[PC] & ~3 : c.r[d.rn], a = (d.add ? base + d.imm : base - d.imm) | 0;
    c.aligned(a, 4, true);
    c.s[d.rd] = c.ld32(a);
    if (d.sz === 8) c.s[d.rd + 1] = c.ld32(a + 4);
  },
  vstr(c, d) {
    c.fpCheck();
    const a = (d.add ? c.r[d.rn] + d.imm : c.r[d.rn] - d.imm) | 0;
    c.aligned(a, 4, true);
    c.st32(a, c.s[d.rd]);
    if (d.sz === 8) c.st32(a + 4, c.s[d.rd + 1]);
  },
  vldm(c, d) {
    c.fpCheck();
    const base = c.r[d.rn];
    let a = d.add ? base : (base - 4 * d.list) | 0;
    c.aligned(a, 4, true);
    const v = [];
    for (let i = 0; i < d.list; i++) { v.push(c.ld32(a)); a += 4; }
    if (d.wb) c.setReg(d.rn, d.add ? base + 4 * d.list : base - 4 * d.list);
    for (let i = 0; i < d.list; i++) c.s[d.rd + i] = v[i];
  },
  vstm(c, d) {
    c.fpCheck();
    const base = c.r[d.rn];
    let a = d.add ? base : (base - 4 * d.list) | 0;
    c.aligned(a, 4, true);
    for (let i = 0; i < d.list; i++) { c.st32(a, c.s[d.rd + i]); a += 4; }
    if (d.wb) c.setReg(d.rn, d.add ? base + 4 * d.list : base - 4 * d.list);
  },
};
export const EXECUTED_OPS = Object.keys(X);
