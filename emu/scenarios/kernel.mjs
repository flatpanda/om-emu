// The kernel check's main(), one function per HLE session: kernel-1
// (groups 1-5), kernel-5b, kernel-5c, kernel-6, kernel-7, kernel-7b. env: { rom, createHash, beginSession(), mark(label),
// check(group, label, got, want, ok), print(line) }: Check.start emits a mark, Check.eq a check with normalised values.
import * as IRQ from '../src/lab/irq.mjs';
import { HLE, runtime } from '../src/lab/hle.mjs';
import { IDLE_DONE, LabTask, NativeKernel, SVC, TTS, disasm_of, in_interrupt, isr_call, system_time, tick } from '../src/lab/kernel.mjs';
import { FirmwareError } from '../src/lab/errors.mjs';
import { pack, unpack, bytesHex } from '../src/util/bytes.mjs';
import { hex } from '../src/util/hex.mjs';
import { norm } from '../src/util/tracejson.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show } from '../src/util/show.mjs';

const E_OK = 0, E_RSATR = -11, E_PAR = -17, E_ID = -18, E_CTX = -25, E_ILUSE = -28, E_NOEXS = -42, E_QOVR = -43, E_TMOUT = -50;
const TA_TPRI = 1, TA_WMUL = 2, TA_CLR = 4, TA_INHERIT = 2;
const TWF_ANDW = 0, TWF_ORW = 1;
const TMO_POL = 0, TMO_FEVR = -1;
const TASK_CODE = 0xA2300200, TASK_STACK = 0xA2320000, ISR_CODE = 0xA2300400, ISR_RESULT = 0xA2300600, TEST_IRQ = 200;
const PRINTS = { 0x50002F6D: 'printf_x', 0x50002F46: 'printf_d', 0x50002EE6: 'puts', 0x50002DD8: 'puts2' };
export const SESSIONS = ['kernel-1', 'kernel-5b', 'kernel-5c', 'kernel-6', 'kernel-7', 'kernel-7b'];

class Check {
  constructor(env) { this.env = env; this.groups = new Map(); this.group = null; }
  start(name) { this.env.mark('group ' + name); this.group = name; this.groups.set(name, []); }
  // deepEqual(got, want) decides; the failure line shows both values, the trace's check event carries them normalised.
  eq(label, got, want) {
    const ok = deepEqual(got, want);
    this.env.check(this.group, label, norm(got), norm(want), ok);
    if (!ok) this.groups.get(this.group).push(`${label}: got ${show(got)}, want ${show(want)}`);
  }
  report() {
    let bad = 0;
    for (const [name, problems] of this.groups) {
      this.env.print(`[${problems.length ? 'FAIL' : 'ok'}] ${name}`);
      for (const p of problems) this.env.print('      ' + p);
      bad += problems.length ? 1 : 0;
    }
    return bad;
  }
}
const latin1 = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
const cstr = (b) => { const z = b.indexOf(0); return latin1(z < 0 ? b : b.subarray(0, z)); };

function session(env) {
  const hle = new HLE(env);
  hle.install_base_stubs();
  const prints = [];
  const pr = () => (h, r) => { prints.push(cstr(h.sim.read(r.a0, 120))); h.finish(r); };
  for (const [a, n] of Object.entries(PRINTS)) hle.hook(+a, pr(n), n);
  return [hle, prints];
}
function withHle(hle, body) { try { return body(); } finally { hle.close(); } }
function taskProgram(hle, calls) {
  const parts = [];
  let at = TASK_CODE;
  for (const [name, regs] of [...calls, ['ext_tsk', {}]]) {
    for (const [op, reg] of [[0x2C, 'd0'], [0x2D, 'd1']]) {
      if (reg in regs) { parts.push(new Uint8Array([op]), pack('<h', regs[reg])); at += 3; }
    }
    const [mask, size] = hle.frame(SVC[name]);
    parts.push(new Uint8Array([0xdd]), pack('<i', runtime(SVC[name]) - at), new Uint8Array([mask, size]));
    at += 7;
  }
  const code = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { code.set(p, o); o += p.length; }
  hle.sim.write(TASK_CODE, code);
  return TASK_CODE;
}
const catchFirmware = (fn, onError) => { try { return fn(); } catch (e) { if (!(e instanceof FirmwareError)) throw e; return onError(e); } };

export function kernel1(env, c) {
  const [hle, prints] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle), sim = hle.sim;
    let pkAt = 0xA2201000 + 0x800;
    const pk = (data) => { pkAt += 0x40; sim.write(pkAt, data); return pkAt; };
    const svc = (name, regs = {}) => nk.svc(name, regs)[0];
    // 1. boot
    c.start('1 boot: firmware kernel init with the labelled stand-ins only');
    nk.boot();
    c.eq('stand-ins', nk.skipped.map(([s]) => s), ['H-VECINIT', 'K-BOOTSYNC', 'K-IPI', 'kernel start (not run)']);
    c.eq('K-INTC 0x5002cc69 ran on the controller model: 0x99200884, level register of IRQ 325',
      [sim.u32(IRQ.BANKS[0] + 0x884), nk.intc.level(325)], [1, 0]);
    c.eq('gate (H-IRQGATE)', nk.intc.gate(), [IRQ.GATE_PC, IDLE_DONE]);
    c.eq('nest/ctx bytes', bytesHex(sim.read(nk.kcb(28), 4)), '00000000');
    const counts = unpack('<30H', sim.read(nk.kcb(56), 60));
    c.eq('kcb[56] first pairs (next free id, static count) tsk/sem/flg/dtq', counts.slice(0, 8), [160, 159, 146, 145, 297, 296, 6, 5]);
    c.eq('timeout queue empty after init', nk.timed_waiters(), []);
    const lab = new LabTask(nk, 2);
    const tid = lab.start();
    c.eq('lab task id (first dynamic task id)', tid, 160);
    c.eq('init task state after ter_tsk', TTS[lab.state(lab.init_tid)], 'DMT');
    c.eq('started', lab.started, [0xA2300100]);
    const a = pk(new Uint8Array(4));
    c.eq('get_tid ret', svc('get_tid', { a0: a }), E_OK);
    c.eq('get_tid value', unpack('<H', sim.read(a, 2))[0], tid);
    c.eq('sns_ctx in task', svc('sns_ctx') & 0xFF, 0);
    c.eq('kernel prints', prints, []);
    // 2. event flags
    c.start('2 event flags (non-blocking)');
    c.eq('acre_flg bad attribute 8', svc('acre_flg', { a0: pk(pack('<BxxxI', 8, 0)) }), E_RSATR);
    const f = svc('acre_flg', { a0: pk(pack('<BxxxI', TA_WMUL, 0x5)) });
    c.eq('acre_flg id', f, 297);
    const p = pk(new Uint8Array(4));
    const twaiFlg = (d0, d1, mode, tmo) => nk.svc('twai_flg', { d0, d1, a1: mode, a0: p }, pack('<i', tmo))[0];
    c.eq('pol OR 0x4', twaiFlg(f, 0x4, TWF_ORW, TMO_POL), E_OK);
    c.eq('  flgptn', sim.u32(p), 0x5);
    c.eq('pol AND 0x6', twaiFlg(f, 0x6, TWF_ANDW, TMO_POL), E_TMOUT);
    c.eq('set_flg 0x30', svc('set_flg', { d0: f, d1: 0x30 }), E_OK);
    c.eq('clr_flg ~0x1', svc('clr_flg', { d0: f, d1: 0xFFFFFFFE }), E_OK);
    c.eq('pol AND 0x34', twaiFlg(f, 0x34, TWF_ANDW, TMO_POL), E_OK);
    c.eq('  flgptn after set|clr', sim.u32(p), 0x34);
    c.eq('wai_flg ptn 0 (E_PAR)', svc('wai_flg', { d0: f, d1: 0, a1: TWF_ORW, a0: p }), E_PAR);
    const g = svc('acre_flg', { a0: pk(pack('<BxxxI', TA_CLR, 0x3)) });
    c.eq('TA_CLR: wai satisfied', svc('wai_flg', { d0: g, d1: 0x1, a1: TWF_ORW, a0: p }), E_OK);
    c.eq('TA_CLR: pattern cleared', twaiFlg(g, 0x3, TWF_ORW, TMO_POL), E_TMOUT);
    c.eq('del_flg', svc('del_flg', { d0: g }), E_OK);
    c.eq('set_flg deleted', svc('set_flg', { d0: g, d1: 1 }), E_NOEXS);
    c.eq('set_flg id 0', svc('set_flg', { d0: 0, d1: 1 }), E_ID);
    c.eq('iset_flg from task context', svc('iset_flg', { d0: f, d1: 1 }), E_CTX);
    // 3. semaphores
    c.start('3 semaphores (non-blocking)');
    const s = svc('acre_sem', { a0: pk(pack('<BxxxII', TA_TPRI, 1, 2)) });
    c.eq('acre_sem id', s, 146);
    c.eq('pol 1', svc('twai_sem', { d0: s, d1: TMO_POL }), E_OK);
    c.eq('pol 0', svc('twai_sem', { d0: s, d1: TMO_POL }), E_TMOUT);
    c.eq('sig', svc('sig_sem', { d0: s }), E_OK);
    c.eq('sig', svc('sig_sem', { d0: s }), E_OK);
    c.eq('sig over max 2', svc('sig_sem', { d0: s }), E_QOVR);
    c.eq('isig_sem from task context', svc('isig_sem', { d0: s }), E_CTX);
    c.eq('acre_sem isemcnt > maxsem', svc('acre_sem', { a0: pk(pack('<BxxxII', 0, 3, 2)) }), E_PAR);
    // 4. mutexes
    c.start('4 mutexes (OXF uses TA_INHERIT, 0x50d9b764)');
    const m = svc('acre_mtx', { a0: pk(pack('<BxH', TA_INHERIT, 0)) });
    c.eq('acre_mtx id (no static mutexes)', m, 1);
    c.eq('loc', svc('loc_mtx', { d0: m }), E_OK);
    c.eq('loc again by owner', svc('loc_mtx', { d0: m }), E_ILUSE);
    c.eq('unl', svc('unl_mtx', { d0: m }), E_OK);
    c.eq('unl not owner', svc('unl_mtx', { d0: m }), E_ILUSE);
    // 5. blocking, interrupt wake-up and dispatch
    c.start('5 blocking waits: the kernel dispatches to idle, K-ISR wakes the lab task');
    const s2 = svc('acre_sem', { a0: pk(pack('<BxxxII', TA_TPRI, 0, 1)) });
    const seen = [];
    lab.on_idle = (lt) => {
      seen.push(TTS[lt.state(lt.tid)] ?? null);
      seen.push(in_interrupt(lt, () => isr_call(lt, SVC.isig_sem, { d0: s2 })));
      return true;
    };
    c.eq('wai_sem forever, woken by isig_sem', svc('twai_sem', { d0: s2, d1: 0xFFFFFFFF }), E_OK);
    c.eq('  lab state at idle, isig_sem result', seen, ['WAI', E_OK]);
    seen.length = 0;
    lab.on_idle = (lt) => { seen.push(in_interrupt(lt, () => isr_call(lt, SVC.iset_flg, { d0: f, d1: 0x300 }))); return true; };
    c.eq('wai_flg AND 0x200, woken by iset_flg 0x300', svc('wai_flg', { d0: f, d1: 0x200, a1: TWF_ANDW, a0: p }), E_OK);
    c.eq('  iset_flg result / flgptn', [seen, sim.u32(p)], [[E_OK], 0x334]);
    seen.length = 0;
    lab.on_idle = (lt) => {
      if (!seen.length) { seen.push(isr_call(lt, SVC.isig_sem, { d0: s2 })); return true; }
      return false;
    };
    catchFirmware(() => {
      svc('twai_sem', { d0: s2, d1: 0xFFFFFFFF });
      c.eq('negative control: wait returned', true, false);
    }, (e) => {
      c.eq('negative control: isig_sem without K-ISR', seen, [E_CTX]);
      c.eq('negative control: harness reports the dead wait', e.message.includes('all tasks blocked'), true);
    });
  });
}

export function kernel5b(env, c) {
  const [hle] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle);
    nk.boot();
    const lab = new LabTask(nk, 2);
    lab.start();
    c.start('5b timed waits: K-TICK runs isig_tim and the tick processing in interrupt context');
    const ticks = [], queued = [];
    lab.on_idle = (lt) => {
      queued.push(nk.timed_waiters());
      for (let i = 0; i < 100; i++) {
        tick(lt, 1);
        ticks.push(system_time(lt));
        if (lt.state(lt.tid) === 2) return true;
      }
      return false;
    };
    const st0 = system_time(lab);
    c.eq('dly_tsk(3)', nk.svc('dly_tsk', { d0: 3 })[0], E_OK);
    c.eq('  lab task in the timeout queue while it waited', queued, [[lab.tid]]);
    c.eq('  timeout queue empty afterwards', nk.timed_waiters(), []);
    c.eq('  ticks taken (uITRON: at least 3)', [3, 4].includes(ticks.length), true);
    c.eq('  system time advanced by the ticks', system_time(lab) - st0, ticks.length);
    const observed = ticks.length;
    ticks.length = 0;
    const s3 = nk.svc('acre_sem', { a0: nk.packet(pack('<BxxxII', TA_TPRI, 0, 1)) })[0];
    c.eq('twai_sem(5) times out', nk.svc('twai_sem', { d0: s3, d1: 5 })[0], E_TMOUT);
    c.eq('  ticks taken (at least 5)', [5, 6].includes(ticks.length), true);
    env.print(`    observed: dly_tsk(3) took ${observed} ticks, twai_sem(5) took ${ticks.length}`);
  });
}

export function kernel5c(env, c) {
  const [hle] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle);
    nk.boot();
    const lab = new LabTask(nk, 2);
    lab.start();
    const sim = hle.sim;
    c.start('5c timed waits with native ticks: 0x5003121c programs the kernel tick (channel 1, IRQ 138), lab time ' +
      'runs at the idle point (RUN_TO_EVENT), the CPU accepts IRQ 138 there');
    const timer = new IRQ.TimerDebug(sim);
    c.eq('0x5003121c', hle.call(0x5003121C, null, null, null, 2000).d0, 0);
    lab.time_mode = true;
    const queued = [];
    lab.on_idle = () => {
      queued.push(nk.timed_waiters());
      IRQ.run_to_event(sim, timer.time() + 5_000_000);
      return 'again';
    };
    let e0 = timer.channel(1).expiries;
    const st0 = system_time(lab);
    c.eq('dly_tsk(3)', nk.svc('dly_tsk', { d0: 3 })[0], E_OK);
    let ticks = timer.channel(1).expiries - e0;
    c.eq('  lab task in the timeout queue while it waited', queued[0], [lab.tid]);
    c.eq('  ticks taken (uITRON: at least 3)', [3, 4].includes(ticks), true);
    c.eq('  system time advanced by the channel-1 expiries', system_time(lab) - st0, ticks);
    const observed = ticks;
    e0 = timer.channel(1).expiries;
    const s3 = nk.svc('acre_sem', { a0: nk.packet(pack('<BxxxII', TA_TPRI, 0, 1)) })[0];
    c.eq('twai_sem(5) times out', nk.svc('twai_sem', { d0: s3, d1: 5 })[0], E_TMOUT);
    ticks = timer.channel(1).expiries - e0;
    c.eq('  ticks taken (at least 5)', [5, 6].includes(ticks), true);
    c.eq('  no overrun: every tick was accepted at the idle point', timer.channel(1).overruns, 0);
    env.print(`    observed with native ticks: dly_tsk(3) took ${observed} ticks, twai_sem(5) took ${ticks}`);
    const log0 = nk.intc.sync().length, p0 = nk.intc.u32(IRQ.D_PRESENTED_TOTAL);
    c.eq('dly_tsk(300)', nk.svc('dly_tsk', { d0: 300 })[0], E_OK);
    const presented = nk.intc.u32(IRQ.D_PRESENTED_TOTAL) - p0;
    const log = nk.intc.sync().slice(log0);
    c.eq('  more presentations than the ring holds, all logged, all IRQ 138',
      [presented > IRQ.RING_SLOTS, log.length, new Set(log)], [true, presented, new Set([IRQ.irq_timer(1)])]);
    IRQ.cpu_store(sim, IRQ.TIMER + 0x300, 0);
    lab.idle_again_limit = 50;
    const outcome = catchFirmware(() => { nk.svc('dly_tsk', { d0: 3 }); return 'returned'; },
      (error) => error.message.includes('no interrupt was presented'));
    c.eq('timer IE 0, dly_tsk(3): idle stops after idle_again_limit clock moves', outcome, true);
  });
}

export function kernel6(env, c) {
  const [hle] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle);
    nk.boot();
    const lab = new LabTask(nk, 2, null, 0x60000, [SVC.ext_tsk]);
    lab.start();
    c.start('6 preemption: act_tsk of a pri-1 task (entry ext_tsk) switches away and back');
    const b = nk.svc('acre_tsk', { a0: nk.packet(pack('<IIIHxxII', 0, 0, runtime(SVC.ext_tsk), 1, 0x1000, TASK_STACK - 0x1000)) })[0];
    c.eq('acre_tsk B', b, 161);
    c.eq('act_tsk B', nk.svc('act_tsk', { d0: b })[0], E_OK);
    c.eq('B ran (task start stub, entry)', lab.started.slice(1).map((v) => hex(disasm_of(v))), ['0x500107e8']);
    c.eq('B state after ext_tsk', TTS[lab.state(b)] ?? null, 'DMT');
    c.eq('lab task running again', [lab.current() === lab.tcb(lab.tid), TTS[lab.state(lab.tid)] ?? null], [true, 'RUN']);
  });
}

export function kernel7(env, c) {
  const [hle] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle);
    nk.boot('calls');
    const lab = new LabTask(nk, 60, null, 0x60000, [TASK_CODE]);
    lab.start();
    c.start('7 settle() (irq=calls): waits forever let the lab task resume; a timed wait stops with "time model needed"');
    c.eq('stand-ins (pre-M9 boot)', nk.skipped.map(([s]) => s), ['K-BOOTSYNC', 'K-SELFTEST', 'K-IPI', 'K-INTC', 'kernel start (not run)']);
    lab.make_settle_sem();
    const s4 = nk.svc('acre_sem', { a0: nk.packet(pack('<BxxxII', TA_TPRI, 0, 1)) })[0];
    taskProgram(hle, [['twai_sem', { d0: s4, d1: -1 }]]);
    const b = nk.svc('acre_tsk', { a0: nk.packet(pack('<IIIHxxII', 0, 0, TASK_CODE, 50, 0x1000, TASK_STACK - 0x1000)) })[0];
    c.eq('act_tsk B (pri 50, waits forever on a semaphore)', nk.svc('act_tsk', { d0: b })[0], E_OK);
    c.eq('B waiting after act_tsk (it preempted the lab task)', TTS[lab.state(b)] ?? null, 'WAI');
    const pend = [1];
    const log = lab.settle(() => { pend[0] = 0; return 'irq'; }, () => pend[0] > 0);
    c.eq('settle: one pending "interrupt" delivered, then the signal', log, ['irq', 'signal']);
    c.eq('  B still waiting, lab task running', [TTS[lab.state(b)] ?? null, TTS[lab.state(lab.tid)] ?? null], ['WAI', 'RUN']);
    c.eq('  settle semaphore count consumed (poll)', nk.svc('twai_sem', { d0: lab.settle_sem, d1: 0 })[0], E_TMOUT);
    c.eq("sig_sem B's semaphore: B runs to ext_tsk", nk.svc('sig_sem', { d0: s4 })[0], E_OK);
    c.eq('  B dormant', TTS[lab.state(b)] ?? null, 'DMT');
    taskProgram(hle, [['dly_tsk', { d0: 5 }]]);
    c.eq('act_tsk B again, now with dly_tsk(5)', nk.svc('act_tsk', { d0: b })[0], E_OK);
    c.eq('  B in the timeout queue', nk.timed_waiters(), [b]);
    catchFirmware(() => {
      lab.settle(() => null, () => false);
      c.eq('settle with a timed wait returned', true, false);
    }, (e) => c.eq('settle with a timed wait stops', e.message.includes('time model needed'), true));
  });
}

export function kernel7b(env, c) {
  const [hle] = session(env);
  withHle(hle, () => {
    const nk = new NativeKernel(hle);
    nk.boot();
    const lab = new LabTask(nk, 60, null, 0x60000, [TASK_CODE]);
    lab.start();
    const sim = hle.sim;
    c.start(`7b settle() with a native delivery: test line IRQ ${TEST_IRQ} at level 5, attached by 0x50053f76`);
    lab.make_settle_sem();
    const s5 = nk.svc('acre_sem', { a0: nk.packet(pack('<BxxxII', TA_TPRI, 0, 1)) })[0];
    taskProgram(hle, [['twai_sem', { d0: s5, d1: -1 }]]);
    const b = nk.svc('acre_tsk', { a0: nk.packet(pack('<IIIHxxII', 0, 0, TASK_CODE, 50, 0x1000, TASK_STACK - 0x1000)) })[0];
    c.eq('act_tsk B (pri 50, waits forever)', [nk.svc('act_tsk', { d0: b })[0], TTS[lab.state(b)] ?? null], [E_OK, 'WAI']);
    const [mask, size] = hle.frame(SVC.isig_sem);
    const isr = [new Uint8Array([0xf8, 0xfe, 0xfc, 0x2c]), pack('<h', s5), new Uint8Array([0xdd]),
      pack('<i', runtime(SVC.isig_sem) - (ISR_CODE + 6)), new Uint8Array([mask, size, 0xfc, 0x81]), pack('<I', ISR_RESULT),
      new Uint8Array([0xf8, 0xfe, 0x04, 0xf0, 0xfc])];
    const code = new Uint8Array(isr.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of isr) { code.set(p, o); o += p.length; }
    sim.write(ISR_CODE, code);
    sim.word(ISR_RESULT, 0xEEEEEEEE);
    const r = hle.call(IRQ.ATTACH_WRAPPER, { d0: TEST_IRQ, d1: 5, a0: ISR_CODE });
    c.eq('attach returns 0; level registers banks 0..3; handler table entry',
      [r.d0, [0, 1, 2, 3].map((k) => nk.intc.bank_level(k, TEST_IRQ)), sim.u32(IRQ.HANDLER_TABLE + 4 * TEST_IRQ)],
      [0, [1 << 5, 0, 0, 0], ISR_CODE]);
    const acc0 = nk.intc.accepted()[0];
    nk.intc.set_test(new Map([[TEST_IRQ, IRQ.TEST_ONCE]]));
    c.eq('presented at level 5 after the test line', nk.intc.present_now(), new Map([[5, TEST_IRQ]]));
    const log = lab.settle(() => null, () => false);
    const [, acc] = nk.intc.accepted(acc0);
    c.eq('settle log: the CPU accepted once at the idle point, then the signal', log, ['irq', 'signal']);
    c.eq('accepted (level, pc)', acc.map(([lv, pc]) => [lv, pc]), [[5, IDLE_DONE]]);
    c.eq('presented by the level handler', nk.intc.sync().slice(-1), [TEST_IRQ]);
    c.eq('handler isig_sem result; B ran to ext_tsk; lab task running',
      [unpack('<i', sim.read(ISR_RESULT, 4))[0], TTS[lab.state(b)] ?? null, TTS[lab.state(lab.tid)] ?? null],
      [E_OK, 'DMT', 'RUN']);
    const nb = new Uint8Array(2);
    nb.set(sim.read(nk.kcb(28), 1), 0); nb.set(sim.read(nk.kcb(16), 1), 1);
    c.eq('nest byte and handler flag cleared by the exit', nb, new Uint8Array(2));
    c.eq('nothing presented, no controller error', [nk.intc.level_mask(), nk.intc.errors()[0]], [0, 0]);
  });
}

export const RUNNERS = { 'kernel-1': kernel1, 'kernel-5b': kernel5b, 'kernel-5c': kernel5c, 'kernel-6': kernel6, 'kernel-7': kernel7, 'kernel-7b': kernel7b };
// main(): the six sessions in order with one Check, then the report.
export function main(env, only = null) {
  const c = new Check(env);
  for (const name of SESSIONS) if (!only || only.includes(name)) { env.sessionName(name); RUNNERS[name](env, c); }
  const bad = c.report();
  env.print(`${bad ? 'FAILED' : 'all groups passed'} <wall>`);
  return bad ? 1 : 0;
}
export { Check };
