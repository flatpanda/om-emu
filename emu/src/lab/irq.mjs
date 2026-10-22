// Interrupts in OM-Emu (the firmware addresses, the debugger views of the
// interrupt controller and of the timer block, cpu_store, run_to_event, the M10B inter-CPU doorbell request).
import { A } from '../fw/model.mjs';
import { RuntimeError } from './errors.mjs';
import { BOARD, timerIrq } from '../fw/board.mjs';
import { show } from '../util/show.mjs';
import { pack as spack } from '../util/bytes.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

// the board's vector page (src/fw/board.mjs vector_page, E143's 0x60030000, which the machine gives the core): a board
// fact read from the vector init's stores, not a firmware address A() translates (no data of the image sits there to
// place); a body's level slots must lie in it (NativeKernel.boot)
export const VECTOR_PAGE = BOARD.vector_page;
export const LEVEL_SLOTS = { 0: A(0x5000F000), 1: A(0x5000F038), 2: A(0x5000F040), 3: A(0x5000F048), 4: A(0x5000F050), 5: A(0x5000F058), 6: A(0x5000F060) };
export const VECINIT = A(0x5000F068), IVAR = 0x8000, GXICR = 0x8940, IAGR = 0x8A00;
export const ENTRY = A(0x50017D41), ENTRY_END = A(0x50017E83), SAVE = A(0x5000F259), RESTORE = A(0x5000F26E);
export const LEVEL_HANDLERS = { 0: A(0x5002E7DE), 1: A(0x5002E79B), 2: A(0x5002E758), 3: A(0x5002E715), 4: A(0x5002E6D2), 5: A(0x5002E68F), 6: A(0x5002E64C) };
export const ATTACH = A(0x5002E84E), ATTACH_WRAPPER = A(0x50053F76), HANDLER_TABLE = A(0xA32600C0), SHADOW_MASK = A(0xA325EA80);
export const DEFAULT_HANDLER = A(0x5002EAF2), IDLE_PSW = 0x0F00;
// the model's controller and timer block (src/fw/board.mjs; E143: these four banks, 356 IRQs, OSD engine 310, IPI 324,
// timer channel n on IRQ 137 + n, 34 channels)
export const BANKS = BOARD.intc.banks;
export const IRQS = BOARD.intc.irqs, LEVELS = 7, IRQ_OSD_ENGINE = BOARD.intc.irq_osd_engine;
// inter-CPU doorbell (M10B)
export const IRQ_IPI = BOARD.intc.irq_ipi, IPI_INIT = A(0x5002CE4D), IPI_POOL = A(0xA325A998), IPI_POOL_SIZE = 256 * 64;
export const IPI_POST = A(0x50035AFD), IPI_STORE = A(0x50035BD1), IPI_DESC = A(0x60092CD4), IPI_REGS = A(0x60092DD4), IPI_HANDLER0 = A(0x5002D83A);
// the drain routine per descriptor bit
export const IPI_DRAIN = { 8: A(0x50035BE0), 16: A(0x50035C34), 32: A(0x50035C88), 64: A(0x50035CDC) };
export const irq_timer = timerIrq;
export const DEBUG = 0x89A00000, DOORBELL = 0x89A20000, STORE_STUB = A(0xA2100480);
export const D_MAGIC = 0x000, D_GATE_MODE = 0x008, D_GATE_PC = 0x00C;
export const D_PRESENTED_TOTAL = 0x010, D_ACCEPTED_TOTAL = 0x014, D_REQUEST = 0x018, D_LEVEL_MASK = 0x01C, D_ERR_TOTAL = 0x020;
export const D_IPI_WRITES = 0x024, D_DOORBELL_RESULT = 0x028, D_IPI_REPEATS = 0x02C, D_PRESENT_NOW = 0x040;
export const D_PENDING = 0x060, D_IPI_REQ = 0x070, D_XCPU_TOTAL = 0x07C, D_XCPU_RING = 0x6000;
export const D_ERR_RING = 0x100, D_LINES = 0x1000, D_LEVELS = 0x2000, D_TEST = 0x3000;
export const D_PRESENTED_RING = 0x4000, D_ACCEPTED_RING = 0x5000, RING_SLOTS = 256;
export const GATE_OFF = 0, GATE_PC = 1, GATE_ANY = 2;
export const TEST_OFF = 0, TEST_LEVEL = 1, TEST_ONCE = 2;
export const ERRORS = { 1: 'UNKNOWN', 2: 'LEVEL_VALUE', 3: 'TEST_DRIVEN', 4: 'DEBUG_CPU', 5: 'DOORBELL' };

const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const pack = (...vs) => { const b = new Uint8Array(4 * vs.length); const d = new DataView(b.buffer); vs.forEach((v, i) => d.setUint32(4 * i, v >>> 0, true)); return b; };

export function cpu_store(sim, address, value, stub = STORE_STUB) {
  const after = sim.cpu_store(address, value, stub);
  if (after.fault || after.pc !== stub + 1) {
    throw new RuntimeError(`store 0x${(value >>> 0).toString(16)} to 0x${fx(address >>> 0, 8)}: fault ${after.fault} at 0x${fx(after.pc, 8)}`);
  }
}

export class IntcDebug {
  constructor(sim) {
    this.sim = sim;
    let magic;
    try { magic = sim.u32(DEBUG + D_MAGIC); } catch (e) {
      if (e instanceof RuntimeError) throw new RuntimeError(`the machine has no interrupt controller window (${e.message})`);
      throw e;
    }
    if (magic !== 0x43544E49) throw new RuntimeError(`interrupt controller window magic 0x${fx(magic, 8)}: not emu's interrupt controller model`);
    this.presented_seen = 0;
    this.log = [];
  }
  u32(offset) { return this.sim.u32(DEBUG + offset); }
  set_gate(mode, pc = 0) { this.sim.write(DEBUG + D_GATE_MODE, pack(mode, pc)); }
  gate() { const b = this.sim.read(DEBUG + D_GATE_MODE, 8); return [u32(b, 0), u32(b, 4)]; }
  level_mask() { return this.u32(D_LEVEL_MASK); }
  pending() { return this.level_mask() !== 0; }
  present_now() {
    const b = this.sim.read(DEBUG + D_PRESENT_NOW, 28), out = new Map();
    for (let level = 0; level < 7; level++) { const w = u32(b, 4 * level); if (w) out.set(level, Math.floor(w / 4) - 1); }
    return out;
  }
  level(irq) { return this.sim.u32(BANKS[0] + 4 * irq); }
  bank_level(bank, irq) { return this.sim.u32(BANKS[bank] + 4 * irq); }
  line(irq) { const b = this.sim.read(DEBUG + D_LINES + irq, 1)[0]; return [!!(b & 1), !!(b & 2), !!(b & 0x80)]; }
  _ring(totalOffset, base, since = 0) {
    const total = this.u32(totalOffset), first = Math.max(since, total - RING_SLOTS), out = [];
    for (let n = first; n < total; n++) {
      const b = this.sim.read(DEBUG + base + 16 * (n % RING_SLOTS), 16);
      out.push([u32(b, 0), u32(b, 4), u32(b, 8), u32(b, 12)]);
    }
    return [total, out];
  }
  presented(since = 0) { return this._ring(D_PRESENTED_TOTAL, D_PRESENTED_RING, since); }
  accepted(since = 0) {
    const [total, rows] = this._ring(D_ACCEPTED_TOTAL, D_ACCEPTED_RING, since);
    return [total, rows.map(([lv, pc, lo, hi]) => [lv, pc, lo + hi * 4294967296])];
  }
  sync() {
    const total = this.u32(D_PRESENTED_TOTAL);
    if (total !== this.presented_seen) {
      if (total - this.presented_seen > RING_SLOTS) throw new RuntimeError(`${total - this.presented_seen} presentations overflowed the ring`);
      const [, rows] = this.presented(this.presented_seen);
      this.presented_seen = total;
      for (const r of rows) this.log.push(r[0]);
    }
    return this.log;
  }
  errors() {
    const total = this.u32(D_ERR_TOTAL), out = [];
    for (let n = Math.max(0, total - 16); n < total; n++) {
      const b = this.sim.read(DEBUG + D_ERR_RING + 16 * (n % 16), 16);
      const kind = u32(b, 0);
      out.push({ name: ERRORS[kind] ?? kind, addr: u32(b, 4), value: u32(b, 8), pc: u32(b, 12) });
    }
    return [total, out];
  }
  version() { return this.u32(0x004); }
  // +0x808 pending bits of a bank (A-IPI), from the debug window (no side effect).
  ipi_pending(bank) { return this.u32(D_PENDING + 4 * bank); }
  // [total, [(bank, value, pc, insns_lo)]] of the sets of banks 1..3.
  xcpu(since = 0) { return this._ring(D_XCPU_TOTAL, D_XCPU_RING, since); }
  // Doorbell cmd 2: pending[bank] = (pending[bank] & ~clear) | set_ (one CPU store from harness code).
  ipi_request(bank, set_ = 0, clear = 0, stub = STORE_STUB) {
    if (this.version() < 2) throw new RuntimeError('interrupt controller window version < 2 (no +0x808 model)');
    this.sim.write(DEBUG + D_IPI_REQ, spack('<III', bank, set_, clear));
    cpu_store(this.sim, DOORBELL, 2, stub);
    const result = this.u32(D_DOORBELL_RESULT);
    if (result) throw new RuntimeError(`ipi request bank ${bank} set 0x${set_.toString(16)} clear 0x${clear.toString(16)}: doorbell result ${ERRORS[result] ?? result}`);
  }
  set_test(lines, stub = STORE_STUB) {
    for (const [irq, mode] of lines) this.sim.write(DEBUG + D_TEST + irq, new Uint8Array([mode]));
    cpu_store(this.sim, DOORBELL, 1, stub);
    const result = this.u32(D_DOORBELL_RESULT);
    if (result) throw new RuntimeError(`test lines ${show(lines)}: doorbell result ${ERRORS[result] ?? result}`);
  }
}

export const TIMER = 0x98900000, TIMER_DEBUG = 0x89A10000;
export const T_MAGIC = 0x000, T_T = 0x008, T_IE = 0x010, T_STATUS = 0x014, T_ERR_TOTAL = 0x018, T_NOTE_TOTAL = 0x01C,
  T_ERR_RING = 0x040, T_CH = 0x100, T_USMODE = 0x030, TIMER_CHANNELS = BOARD.timer.channels;

export class TimerDebug {
  constructor(sim) {
    this.sim = sim;
    let magic;
    try { magic = sim.u32(TIMER_DEBUG + T_MAGIC); } catch (e) {
      if (e instanceof RuntimeError) throw new RuntimeError(`the machine has no timer debug window (${e.message})`);
      throw e;
    }
    if (magic !== 0x524D4954) throw new RuntimeError(`timer debug window magic 0x${fx(magic, 8)}: not emu's timer model`);
  }
  u32(offset) { return this.sim.u32(TIMER_DEBUG + offset); }
  time() { const b = this.sim.read(TIMER_DEBUG + T_T, 8); return u32(b, 0) + u32(b, 4) * 4294967296; }
  ie() { return this.u32(T_IE); }
  status() { return this.u32(T_STATUS); }
  channel(n) {
    const b = this.sim.read(TIMER_DEBUG + T_CH + 0x40 * n, 0x30);
    const q = (o) => u32(b, o) + u32(b, o + 4) * 4294967296;
    return { ctl: u32(b, 0), reload: u32(b, 4), running: u32(b, 8), t0: q(0x0C), period: q(0x14), next: q(0x1C),
      expiries: u32(b, 0x24), overruns: u32(b, 0x28), unwritten_read: u32(b, 0x2C) };
  }
  running() { const out = new Map(); for (let n = 1; n < 33; n++) { const c = this.channel(n); if (c.running) out.set(n, c); } return out; }
  errors() {
    const total = this.u32(T_ERR_TOTAL), out = [];
    for (let n = Math.max(0, total - 8); n < total; n++) {
      const b = this.sim.read(TIMER_DEBUG + T_ERR_RING + 16 * (n % 8), 16);
      out.push({ offset: u32(b, 0), size: u32(b, 4), value: u32(b, 8), pc: u32(b, 12) });
    }
    return [total, out];
  }
}

export const VSC_DEBUG = 0x89800000, VSC_DOORBELL = 0x89810000;
export const CLOCK_ARG0 = 0x20, CLOCK_LAST_RESULT = 0x1C, CLOCK_EVENT_SOURCES = 0x30, CMD_RUN_TO_EVENT = 5;

export function run_to_event(sim, limit, stub = STORE_STUB) {
  sim.write(VSC_DEBUG + CLOCK_ARG0, pack(limit % 4294967296, Math.floor(limit / 4294967296)));
  cpu_store(sim, VSC_DOORBELL, CMD_RUN_TO_EVENT, stub);
  if (sim.u32(VSC_DEBUG + CLOCK_LAST_RESULT)) throw new RuntimeError(`RUN_TO_EVENT(${limit}) refused`);
  return sim.u32(VSC_DEBUG + CLOCK_EVENT_SOURCES);
}
