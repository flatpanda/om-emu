// The firmware's own uITRON kernel run natively in OM-Emu (K-native):
// NativeKernel, LabTask, in_interrupt, isr_call, tick, system_time. Addresses are disassembly notation unless
// marked run-time.
import { A, MODEL_INFO, isUnmapped, IMAGE_BASE, IMAGE_END, fact } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import * as IRQ from './irq.mjs';
import { DATA, ISR_CALLER, ISR_SP, SAVED, FirmwareError, disasm, install_core_index, runtime, where, cat, bytes, i32le, u32le } from './hle.mjs';
import { SP, packRegs } from './sim.mjs';
import { ValueError, AssertionError } from './errors.mjs';
import { show } from '../util/show.mjs';
import { hex, hexDigits as fx } from '../util/hex.mjs';

export const KCB_TABLE = BOARD.sram + 4;                // the kcb pointer per CPU (on-chip SRAM, src/fw/board.mjs)
// one per CPU, as many as the kernel has (src/fw/facts.mjs kernelCpus, its entry's stubs; E143 4, D): E144 and the
// other E144- and E118-family bodies have three (E144: D kcb[380])
export const KCB = [A(0x6004381C), A(0x600439A8), A(0x60043B34), A(0x60043CC0)].slice(0, fact('kernel.cpus', 4));
export const KENTRY = A(0x50011883), KSTART = A(0x500119AB), IDLE = [A(0x500159F3), A(0x500159F8)], BOOTSYNC = A(0x50015A61);
export const SELFTEST = A(0x50012691), IPI = A(0x50012651), INTC_INIT = A(0x5002CC69), XCPU_WAIT = A(0x5001258B), KBREAK = A(0x50017B86);
export const SVC = {
  acre_tsk: A(0x5000F76F), act_tsk: A(0x5000F879), ext_tsk: A(0x500107E8), ter_tsk: A(0x50015E87),
  chg_pri: A(0x5000F9AA), sus_tsk: A(0x50017718), frsm_tsk: A(0x50017242), dly_tsk: A(0x50010561),
  wup_tsk: A(0x50016BF0), get_tid: A(0x5001091E),
  acre_sem: A(0x5000F6D1), del_sem: A(0x50010279), sig_sem: A(0x50014FCB), isig_sem: A(0x50010F6A), twai_sem: A(0x50016749),
  acre_flg: A(0x5000F343), del_flg: A(0x50010007), set_flg: A(0x50014EC7), iset_flg: A(0x50017A6B),
  clr_flg: A(0x5000FBAF), wai_flg: A(0x500169D6), twai_flg: A(0x50017E85),
  acre_mtx: A(0x5000F639), del_mtx: A(0x50017084), loc_mtx: A(0x500112F2), unl_mtx: A(0x500168FB),
  acre_dtq: A(0x5000F3BB), del_dtq: A(0x50010129), tsnd_dtq: A(0x50016578), trcv_dtq: A(0x5001625E),
  sns_ctx: A(0x50017B6A),
};
export const E_OK = 0, E_QOVR = -43, E_TMOUT = -50, E_CTX = -25;
export const TTS = { 1: 'RUN', 2: 'RDY', 4: 'WAI', 8: 'SUS', 0xC: 'WAS', 0x10: 'DMT' };
export const TCB_STATE = 12, TCB_ID = 16, TCB_SP = 24, TCB_TMO_NODE = 28, TCB_CTSK = 68;

class Idle extends Error {}           // _Idle: control flow out of kernel init
class LabHome extends Error {}        // _LabHome: the lab task reached LAB_HOME
export const s32 = (v) => v | 0;
export function disasm_of(address) { return address >= IMAGE_BASE && address < IMAGE_END ? disasm(address) : address; }
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const tts = (s) => TTS[s] ?? hex(s);

export class NativeKernel {
  constructor(hle, cpu = 0) {
    this.hle = hle; this.cpu = cpu; this.kcb_addr = KCB[cpu];
    this.skipped = []; this.breaks = []; this.irq = null; this.intc = null;
  }
  kcb(offset) { return this.hle.sim.u32(this.kcb_addr + offset); }
  boot(irq = 'native') {
    if (irq !== 'native' && irq !== 'calls') throw new ValueError(`irq ${show(irq)}: native or calls`);
    this.irq = irq;
    const hle = this.hle, sim = hle.sim;
    if (this.cpu !== 0) throw new FirmwareError('only the CPU-0 init path (0x50011883) is wired; CPUs 1-3 enter at 0x50012776/0x50012826/0x500128d6');
    install_core_index(sim, this.cpu);
    for (let other = 0; other < KCB.length; other++) {
      if (other !== this.cpu) {
        sim.word(KCB_TABLE + 4 * other, KCB[other]);
        const queue = sim.u32(KCB[other] + 332);
        sim.write(queue, new Uint8Array(256).fill(0xff));
      }
    }
    const skip = (name, replay = null) => (h, r) => {
      this.skipped.push([name, where(r.mdr)]);
      if (replay) replay();
      try { h.finish(r); } catch (e) { if (!(e instanceof FirmwareError)) throw e; h.finish_calls(r); }
    };
    const ipiReplay = () => {
      sim.word(this.kcb(260), 0);
      sim.word(this.kcb(264), 0);
      sim.write(this.kcb(268), new Uint8Array(2));
    };
    const idle = () => { throw new Idle(); };
    if (irq === 'native') {
      this.intc = new IRQ.IntcDebug(sim);
      if (!isUnmapped(IRQ.VECINIT)) hle.call(IRQ.VECINIT, null, null, [0, 0], 10);
      else {
        // no vector-init function (E144): the reset head writes the IVARs inline (0x5000006c..0x500000ab, D), the low
        // half of each level slot's run-time address, and the whole word for level 7; GxICR is K-INTC's
        for (let level = 0; level < 7; level++) sim.write(IRQ.IVAR + 4 * level, bytes(runtime(IRQ.LEVEL_SLOTS[level]) & 0xff, (runtime(IRQ.LEVEL_SLOTS[level]) >>> 8) & 0xff));
        sim.word(IRQ.IVAR + 0x1c, runtime(IRQ.LEVEL_SLOTS[6]));
      }
      this.skipped.push(['H-VECINIT', 'harness, before the kernel entry']);
    }
    const saved = new Map(hle.hooks);
    if (irq === 'calls') hle.hook(SELFTEST, skip('K-SELFTEST'), 'K-SELFTEST');
    hle.hook(IPI, skip('K-IPI', ipiReplay), 'K-IPI');
    if (irq === 'calls') hle.hook(INTC_INIT, skip('K-INTC'), 'K-INTC');
    hle.hook(KSTART, skip('kernel start (not run)'), 'kstart');
    hle.hook(BOOTSYNC, skip('K-BOOTSYNC'), 'K-BOOTSYNC');
    for (const a of IDLE) hle.hook(a, idle, 'idle');
    this.install_guards();
    try {
      hle.call(KENTRY, null, null, [0, 0], 100000);
      throw new FirmwareError('kernel init returned instead of entering the idle loop');
    } catch (e) {
      if (!(e instanceof Idle)) { hle.hooks = saved; throw e; }
    }
    hle.hooks = saved;
    this.install_guards();
    const cur = sim.u32(this.kcb(96));
    if (cur !== this.kcb(100)) throw new FirmwareError(`after init kcb[96] -> 0x${fx(cur, 8)}, idle TCB 0x${fx(this.kcb(100), 8)}`);
    if (irq === 'native') {
      const ivars = [];
      for (let level = 0; level < 7; level++) ivars.push(u16(sim.read(IRQ.IVAR + 4 * level, 2), 0));
      if (ivars.some((v, level) => disasm((IRQ.VECTOR_PAGE | v) >>> 0) !== IRQ.LEVEL_SLOTS[level])) {
        throw new FirmwareError(`H-VECINIT: IVARs ${show(ivars.map(hex))} do not point at the level slots`);
      }
      const handlers = [];
      for (let level = 0; level < 7; level++) handlers.push(disasm(sim.u32(this.kcb(88) + 4 * level)));
      if (handlers.some((h, level) => h !== IRQ.LEVEL_HANDLERS[level])) throw new FirmwareError(`kcb[88] level handlers ${show(handlers.map(hex))}`);
      this.intc.set_gate(IRQ.GATE_PC, IDLE_DONE);
    }
    return cur;
  }
  install_guards() {
    const kbreak = (h, r) => {
      this.breaks.push([s32(r.d0), where(r.mdr)]);
      throw new FirmwareError(`kernel break(${s32(r.d0)}) from ${where(r.mdr)}`);
    };
    const xcpu = (h, r) => {
      throw new FirmwareError(`inter-CPU handshake with CPU ${r.d0} (0x5001258b) from ${where(r.mdr)}: only one CPU in the lab`);
    };
    const defaultHandler = (h, r) => {
      throw new FirmwareError(`IRQ presented with no handler attached: default handler 0x${fx(IRQ.DEFAULT_HANDLER, 8)} called from ${where(r.mdr)}; presented now ${show(this.intc.present_now())}`);
    };
    this.hle.hook(KBREAK, kbreak, 'kbreak');
    this.hle.hook(XCPU_WAIT, xcpu, 'xcpu_wait');
    if (this.irq === 'native') this.hle.hook(IRQ.DEFAULT_HANDLER, defaultHandler, 'irq_default');
  }
  svc(name, regs = null, stack = null, limit = 5000) {
    const r = this.hle.call(SVC[name], regs ?? {}, stack, null, limit);
    return [s32(r.d0), r];
  }
  packet(data, offset = 0x800) {
    const address = DATA + offset;
    this.hle.sim.write(address, data);
    return address;
  }
  task_count() { const b = this.hle.sim.read(this.kcb(56), 4); return Math.max(u16(b, 0), u16(b, 2)); }
  tcb(tid) { return this.hle.sim.u32(this.kcb(204) + 4 * ((tid & 0xFFF) - 1)); }
  state(tid) { return u16(this.hle.sim.read(this.tcb(tid) + TCB_STATE, 2), 0); }
  entry(tid) { const p = this.tcb(tid); return p ? disasm_of(this.hle.sim.u32(p + TCB_CTSK + 8)) : null; }
  priority(tid) { return u16(this.hle.sim.read(this.tcb(tid) + TCB_CTSK + 12, 2), 0); }
  tasks() {
    const out = new Map();
    for (let tid = 1; tid <= this.task_count(); tid++) {
      if (this.tcb(tid) && this.entry(tid)) out.set(tid, [this.entry(tid), tts(this.state(tid))]);
    }
    return out;
  }
  timed_waiters() {
    const sim = this.hle.sim, head = this.kcb(72), found = [];
    let node = sim.u32(head);
    for (let i = 0; i < 512; i++) {
      if (node === head) return found;
      const tcb = node - TCB_TMO_NODE;
      found.push(u16(sim.read(tcb + TCB_ID, 2), 0));
      node = sim.u32(node);
    }
    throw new FirmwareError(`timeout queue at 0x${fx(head, 8)} does not close within 512 nodes`);
  }
}

export const IDLE_DONE = A(0xA2300080), LAB_HOME = A(0xA2300100), IDLE_SP = A(0xA2318000), LAB_EXINF = 0x1AB;
export const TASK_START = A(0x50011825), DISPATCH = A(0x50014DA8), LOCK = A(0x50017BDD), UNLOCK = A(0x50017C54);
export const INIT_TASK_ENTRY = A(0x5002CCA5);

export class LabTask {
  constructor(nk, pri = 1, stack_top = null, stack_size = 0x60000, allow_tasks = []) {
    this.nk = nk; this.hle = nk.hle; this.sim = nk.hle.sim;
    this.pri = pri; this.stack_top = stack_top || SP; this.stack_size = stack_size;
    this.allow = new Set([...allow_tasks, ...(MODEL_INFO.extra_tasks ?? [])]);
    this.tid = null; this.idle_events = []; this.on_idle = null; this.started = [];
    this.settle_sem = null; this.settling = false; this.settle_log = []; this._settle_current = null;
    this._irq_open = false; this.native_opens = 0; this._accepted_seen = 0;
    this.strict_levels = true; this.time_mode = false; this.elapse_log = []; this.idle_again_limit = 1000;
  }
  tcb(tid) { return this.nk.tcb(tid); }
  state(tid) { return this.nk.state(tid); }
  current() { return this.sim.u32(this.nk.kcb(96)); }
  nk_tasks() { return this.nk.task_count(); }
  _idle_call(fn, regs = null, frame = null) {
    const [mask, size] = frame ?? this.hle.frame(fn);
    const at = IDLE_DONE - 7;
    this.sim.write(at, cat(bytes(0xdd), i32le(runtime(fn) - at), bytes(mask, size)));
    this.sim.write(IDLE_DONE, bytes(0xcb));
    this.sim.reset({ pc: at, sp: IDLE_SP, ...SAVED, ...(regs ?? {}) });
    return this.hle._loop(IDLE_DONE, IDLE_SP, 20000);
  }
  _dispatch_code() {
    const [dm, ds] = this.hle.frame(DISPATCH);
    const start = IDLE_DONE - 22;
    const parts = [bytes(0x00)];
    let at = start + 1;
    for (const [fn, m, s] of [[LOCK, 0, 0], [DISPATCH, dm, ds], [UNLOCK, 0, 0]]) {
      parts.push(bytes(0xdd), i32le(runtime(fn) - at), bytes(m, s));
      at += 7;
    }
    if (at !== IDLE_DONE) throw new AssertionError('');
    this.sim.write(start, cat(...parts, bytes(0xcb)));
    return start;
  }
  start() {
    const hle = this.hle;
    hle.hook(TASK_START, (h, r) => this._task_start(h, r), 'task_start');
    hle.hook_rt(LAB_HOME, (h, r) => this._home(h, r), 'lab_home');
    this.sim.write(LAB_HOME, bytes(0xcb, 0xcb));
    const initIds = [];
    for (const [t, [e]] of this.nk.tasks()) if (e === INIT_TASK_ENTRY) initIds.push(t);
    if (initIds.length !== 1 || this.state(initIds[0]) !== 2) throw new FirmwareError(`init task not found READY: ${show(initIds)}`);
    let r = this._idle_call(SVC.ter_tsk, { d0: initIds[0] });
    if (s32(r.d0) !== 0 || this.state(initIds[0]) !== 0x10) throw new FirmwareError(`ter_tsk(init task ${initIds[0]}) = ${s32(r.d0)}`);
    this.init_tid = initIds[0];
    const pk = new Uint8Array(24), dv = new DataView(pk.buffer);
    dv.setUint32(0, 0, true); dv.setUint32(4, LAB_EXINF, true); dv.setUint32(8, LAB_HOME, true); dv.setUint16(12, this.pri, true);
    dv.setUint32(16, this.stack_size, true); dv.setUint32(20, (this.stack_top - this.stack_size) >>> 0, true);
    r = this._idle_call(SVC.acre_tsk, { a0: this.nk.packet(pk) });
    this.tid = s32(r.d0);
    if (this.tid <= 0) throw new FirmwareError(`acre_tsk(lab task) = ${this.tid}`);
    try {
      this._idle_call(SVC.act_tsk, { d0: this.tid });
      throw new FirmwareError('act_tsk(lab task) returned to idle without starting the task');
    } catch (e) { if (!(e instanceof LabHome)) throw e; }
    hle.hook_rt(IDLE_DONE, (h, r2) => this._idle(h, r2), 'idle');
    if (this.current() !== this.tcb(this.tid) || this.state(this.tid) !== 1) throw new FirmwareError('lab task is not the running task after act_tsk');
    return this.tid;
  }
  // A task whose entry returns at once (`retf [],0` or `ret [],0`) runs no firmware code and is started as the
  // allowed ones are: the display task init of E134 and E145 starts one, the static task table's row naming a bare
  // retf (D; MODEL_INFO.extra_tasks gave E134's by hand before, started, X)
  _bare_return(entry) {
    const b = this.sim.read(entry, 3);
    return (b[0] === 0xDE || b[0] === 0xDF) && b[1] === 0 && b[2] === 0;
  }
  _task_start(hle, r) {
    const entry = r.a2;
    this.started.push(entry);
    if (entry !== LAB_HOME && !this.allow.has(disasm_of(entry)) && !this._bare_return(entry)) {
      throw new FirmwareError(`kernel would start firmware task entry 0x${fx(disasm_of(entry), 8)} (exinf 0x${r.d2.toString(16)}): not modelled`);
    }
    this.sim.packet('s');
  }
  _home(hle, r) {
    if (r.d0 !== LAB_EXINF) throw new FirmwareError(`lab task started with exinf 0x${r.d0.toString(16)}`);
    throw new LabHome();
  }
  _idle(hle, r) {
    this.idle_events.push(hle.log.length);
    const intc = this.nk.intc;
    let moves = 0, madeReady;
    for (;;) {
      if (intc !== null) {
        intc.sync();
        const accepted = intc.u32(IRQ.D_ACCEPTED_TOTAL);
        if (this._settle_current !== null) for (let k = 0; k < accepted - this._accepted_seen; k++) this._settle_current.push('irq');
        this._accepted_seen = accepted;
        const mask = intc.level_mask();
        if (mask) {
          if (this._irq_open) {
            throw new FirmwareError(`presented IRQ not accepted at IDLE_DONE: presented ${show(intc.present_now())}, PSW 0x${fx(r.psw, 4)}, gate ${show(intc.gate())}`);
          }
          if ((mask & (mask - 1)) && this.strict_levels) {
            throw new FirmwareError(`two interrupt levels presented together at the idle point: ${show(intc.present_now())} (A-INTC-ORDER and the level priority would decide)`);
          }
          this._irq_open = true;
          this.native_opens += 1;
          const regs = { ...r, psw: IRQ.IDLE_PSW, fault: 0 };
          if (this.sim.packet('G' + packRegs(regs)) !== 'OK') throw new AssertionError('');
          return;
        }
        this._irq_open = false;
      }
      madeReady = this.on_idle ? this.on_idle(this) : false;
      if (madeReady !== 'again') break;
      moves += 1;
      if (moves > this.idle_again_limit) {
        throw new FirmwareError(`idle: on_idle moved lab time ${moves - 1} times and no interrupt was presented (lab task ${tts(this.state(this.tid))})`);
      }
    }
    if ((this.state(this.tid) & 0xF) === 2 || madeReady) {
      const start = this._dispatch_code();
      const regs = { ...this.sim.registers(), pc: start, sp: IDLE_SP, fault: 0, ...SAVED };
      if (this.sim.packet('G' + packRegs(regs)) !== 'OK') throw new AssertionError('');
      return;
    }
    throw new FirmwareError(`all tasks blocked (lab task ${this.tid} state ${tts(this.state(this.tid))}) and no interrupt made one ready`);
  }
  make_settle_sem() {
    const pk = new Uint8Array(12), dv = new DataView(pk.buffer);
    pk[0] = 1; dv.setUint32(4, 0, true); dv.setUint32(8, 1, true);
    const [rc] = this.nk.svc('acre_sem', { a0: this.nk.packet(pk) });
    if (rc <= 0) throw new FirmwareError(`acre_sem(settle) = ${rc}`);
    this.settle_sem = rc;
    return rc;
  }
  settle(deliver, pending, limit = 200000) {
    if (this.settle_sem === null) this.make_settle_sem();
    const log = [];
    const onIdle = (lt) => {
      if (pending()) { in_interrupt(lt, deliver); log.push('irq'); return true; }
      const timed = this.nk.timed_waiters().filter((t) => t !== this.tid);
      if (timed.length && this.time_mode) log.push(`timed ${show(timed)}`);
      else if (timed.length) {
        throw new FirmwareError(`settle: task(s) ${show(timed)} in a timed wait (${show(timed.map((t) => hex(this.nk.entry(t))))}): time model needed`);
      }
      const rc = in_interrupt(lt, () => isr_call(lt, SVC.isig_sem, { d0: this.settle_sem }));
      if (rc === E_QOVR) throw new FirmwareError('settle: isig_sem E_QOVR: the lab task is blocked elsewhere');
      if (rc !== E_OK) throw new FirmwareError(`settle: isig_sem = ${rc}`);
      log.push('signal');
      return true;
    };
    const previous = this.on_idle;
    this.on_idle = onIdle; this.settling = true;
    this._settle_current = log;
    if (this.nk.intc !== null) this._accepted_seen = this.nk.intc.u32(IRQ.D_ACCEPTED_TOTAL);
    let rc;
    try { [rc] = this.nk.svc('twai_sem', { d0: this.settle_sem, d1: 0xFFFFFFFF }, null, limit); }
    finally { this.on_idle = previous; this.settling = false; this._settle_current = null; }
    if (rc !== E_OK) throw new FirmwareError(`settle: twai_sem = ${rc}`);
    this.settle_log.push(log);
    return log;
  }
  elapse_until(target, now, runToEvent, limit = 200000) {
    if (this.settle_sem === null) this.make_settle_sem();
    const log = [];
    const onIdle = (lt) => {
      const t = now();
      if (t < target) { runToEvent(target); log.push('time'); return 'again'; }
      if (t !== target) log.push(`past ${t - target}`);
      const rc = in_interrupt(lt, () => isr_call(lt, SVC.isig_sem, { d0: this.settle_sem }));
      if (rc !== E_OK) throw new FirmwareError(`elapse: isig_sem = ${rc}`);
      log.push('signal');
      return true;
    };
    const previous = this.on_idle;
    this.on_idle = onIdle; this.settling = true;
    this._settle_current = log;
    if (this.nk.intc !== null) this._accepted_seen = this.nk.intc.u32(IRQ.D_ACCEPTED_TOTAL);
    let rc;
    try { [rc] = this.nk.svc('twai_sem', { d0: this.settle_sem, d1: 0xFFFFFFFF }, null, limit); }
    finally { this.on_idle = previous; this.settling = false; this._settle_current = null; }
    if (rc !== E_OK) throw new FirmwareError(`elapse: twai_sem = ${rc}`);
    this.elapse_log.push([target, log]);
    return log;
  }
}

export function in_interrupt(lab, body) {
  const sim = lab.sim, nk = lab.nk;
  const nest = nk.kcb(28), flags = nk.kcb(16);
  const n = sim.read(nest, 1)[0], f = sim.read(flags, 1)[0];
  if (n + 1 > 255) throw new ValueError('bytes must be in range(0, 256)');
  sim.write(nest, bytes(n + 1));
  sim.write(flags, bytes(f | 1));
  try { return body(); }
  finally {
    sim.write(nest, bytes(n));
    sim.write(flags, bytes(sim.read(flags, 1)[0] & ~1 & 0xFF));
  }
}
export function isr_call(lab, fn, regs = null) {
  const hle = lab.hle, sim = lab.sim;
  const [mask, size] = hle.frame(fn);
  sim.write(ISR_CALLER, cat(bytes(0xdd), i32le(runtime(fn) - ISR_CALLER), bytes(mask, size, 0xcb)));
  sim.reset({ pc: ISR_CALLER, sp: ISR_SP, ...SAVED, ...(regs ?? {}) });
  const r = hle._loop(ISR_CALLER + 7, ISR_SP, 5000);
  return s32(r.d0);
}
export const ISIG_TIM = A(0x50011043), TICK = A(0x500156C5);
export function tick(lab, count = 1) {
  const sim = lab.sim, nk = lab.nk, hle = lab.hle;
  const body = () => {
    for (let i = 0; i < count; i++) {
      const r = isr_call(lab, ISIG_TIM);
      if (r !== 0) throw new FirmwareError(`isig_tim = ${r}`);
      while (sim.read(nk.kcb(20), 1)[0] === 0 && sim.read(nk.kcb(4), 1)[0] > 0) {
        sim.write(nk.kcb(4), bytes(sim.read(nk.kcb(4), 1)[0] - 1));
        const mask = 0xF0, size = 0x20;
        sim.write(ISR_CALLER, cat(bytes(0xdd), i32le(runtime(TICK) - ISR_CALLER), bytes(mask, size, 0xcb)));
        sim.reset({ pc: ISR_CALLER, sp: ISR_SP, ...SAVED });
        hle._loop(ISR_CALLER + 7, ISR_SP, 5000);
      }
    }
  };
  in_interrupt(lab, body);
}
export function system_time(lab) {
  const lo = lab.sim.u32(lab.nk.kcb(36)), hi = u16(lab.sim.read(lab.nk.kcb(36) + 4, 2), 0);
  return hi * 4294967296 + lo;
}
