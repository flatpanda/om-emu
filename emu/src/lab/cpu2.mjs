// CPU 2 natively (--cpu2 native, E143, off by default; docs/hle-gaps.md 4.6.1): the machine's second core
// (src/core/cores.mjs) run from CPU 2's entry through its kernel to its idle loop, then beside CPU 0 for the session.
//   H-CPU2RELEASE  the two words CPU 2 waits for before its kernel and its init task's starts, which CPU 0 writes in
//                  code the lab does not run: the release flag (0xa3258360) = 1 (CPU 0's reset head, 0x50000282..329)
//                  and the tick magic (0x97f00088) = 0x77777777 (CPU 0's init task right after its tick init,
//                  0x5002ccdc, whose tick init H-BOOTTIME runs); then core 2 out of reset at its entry 0x50008f01 (the
//                  run-time address CPU 0's reset head writes to 0x98d00144), PSW 0, every register 0 (A-CPU2RESET)
//   H-CPU2CACHE    the entry's write of 16 to its cache-control word 0x98100808 (0x50008f1a), skipped: no caches
//   H-CPU2UART     the entry's UART mark "2" (0x50000426, called at 0x50008f37), skipped: no UART
//   K-BOOTSYNC2    (core 2) the boot ring 0x50015a61 returns at once: CPUs 1 and 3 are absent, CPU 0's lab skips it
//   K-STARTBITS    the kernel-start barrier 0x50012367 natively, with the bits of CPUs 0, 1 and 3 set before core 2
//                  sets its own (0xb into (u16)0x97f00000): CPU 0's lab does not run its start, 1 and 3 are absent
//   H-CPU2POLL     the idle command loop's head 0x5003883a (BOOT_CPU2 at priority 70 after 0x500387eb): while its
//                  halt word 0x97f00100 is 0, a pass that leaves the command block 0x97f0009c..0x97f00113 as the pass
//                  before found it sleeps until a byte of it changes or an interrupt comes (the loop reads nothing
//                  else; cores.mjs polls); while the word is set (BOOT_CPU2's own 0x50038666 sets it) the loop halts
//                  natively every pass (0x50038b04), so the stand-in is used only after a command 0x40002
//   H-CPUCONN0     CPU 0's CPUCONN_CPU0 (0x99) and CPUCALL_CPU0 (0x9a) started with act_tsk before core 2's boot, as
//                  CPU 0's init task starts them (0x5002cd0c..0x5002cd2d; the lab ends that task), CPUCONN's proxy
//                  for CPU 2 (0x5002cf6e) allowed: CPU 2's cpu_conn calls on CPU 0 objects are then served natively
//   H-CPU2LOADER   USTART_L2 (0x2013, the overlay loader BOOT_CPU2 starts) returns from its entry at once: its copies
//                  go through the flash DMA 0x98d00200 (0x50001c4c), which the lab does not model, and its CREQs run
//                  the segments' constructor tables (0x50024eda -> 0x501e60xx), on CPU 0 those the lab's bring-up
//                  runs (segment 8's, on CPU 1, the lab does not run); the only readers of its byte flags' addresses
//                  are boot code the lab does not run (D), and whether code the lab runs depends on its other writes
//                  is ?; the control cpu2-loader runs it
//   H-CPU2TASKS    the CPU 2 tasks of CPU2_STARTS started as CPU 0's boot stages start them (the module init the
//                  stage calls before each start, natively on CPU 0, then OlyTaSt from the lab task, natively to core
//                  2); the stages' other steps between are not run (for SDET, two starts on CPUs 3 and 1 among them)
// Core 2's task starts are guarded (CPU2_TASKS; any other entry parks it), its cross-core calls recorded (the post
// 0x50035afd, CREQ 0x50036120, the cpu_conn sender 0x5002d679) and run natively, its device accesses recorded (the
// boot's first, then the first of each context). OSD_DRAW_CPU2's queue: osd_route.
// Lab time does not move on core 2; at CPU 0's idle point core 2 runs until it sleeps (the idle step), and inside
// CPU 0's runs it takes a turn after every CPU2_QUANTUM instructions of CPU 0 (A-INTERLEAVE, cores.mjs).
import { A } from '../fw/model.mjs';
import { runtime, disasm } from './hle.mjs';
import { FirmwareError } from './errors.mjs';
import { NativeKernel } from './kernel.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

export const CPU2_QUANTUM = 2000;
const h8 = (v) => '0x' + fx(v >>> 0, 8);
const D = (v) => runtime(A(v));                  // a code address in the disassembly notation, at run time

export const CPU2_ENTRY = A(0x50008F01), RELEASE = A(0xA3258360);
// core 2's return trampoline: an offset of the lab's CALLER page no other harness code uses (0x400 is display.mjs's
// DOORBELL_STUB, 0x480 irq.mjs's STORE_STUB)
export const RETURN2 = A(0xA2100600);
export const KCB2 = A(0x60043B34);
const STARTBITS = A(0x97F00000), TICK_MAGIC = A(0x97F00088), MAGIC = 0x77777777;
export const CMD_BLOCK = A(0x97F0009C), CMD_BLOCK_SIZE = 0x78, IDLE_LOOP = A(0x5003883A);
// the task entries core 2 may start: its init task's starts (D: 0x50008fbb..0x50009079)
export const CPU2_TASKS = new Map([[A(0x50008FBB), 'BOOT_CPU2'], [A(0x5002CED4), 'CPUCONN2'], [A(0x50036489), 'CPUCALL2'],
  [A(0x5002E2CB), 'CONTEST_CPU2'], [A(0x50024572), 'USTART_L2'],
  // CPUCONN's proxy for a call from CPU 0 (cores spec 5.1: entries 0x5002cf2d/4d/6e/8f by source), and the task
  // AUD_MAIN starts on CPU 2 through it (AUD_LEVEL_MONITOR 0x200e, cores spec 4)
  [A(0x5002CF2D), 'CPUCONN proxy (CPU 0)'], [A(0x50AAA99E), 'AUD_LEVEL_MONITOR'],
  // the tasks CPU 0's boot stages start on CPU 2 through OlyTaSt (H-CPU2TASKS, cores spec 4)
  [A(0x5046AAB2), 'WB_MOV'], [A(0x5045FCDD), 'MVR_MAIN'], [A(0x5050CC2A), 'SDET'], [A(0x51015F1D), 'OSD_DRAW_CPU2']]);
export const CPU2_STAND_INS = ['H-CPU2RELEASE', 'H-CPU2CACHE', 'H-CPU2UART', 'K-BOOTSYNC2', 'K-STARTBITS', 'H-CPU2POLL',
  'A-CPU2RESET', 'A-COREPAGE', 'A-COREID', 'A-INTERLEAVE', 'A-KICK', 'H-CPU2GATE', 'H-CPUCONN0', 'H-CPU2LOADER', 'H-CPU2TASKS'];
const BOOT_TURNS = 200, IDLE_TURNS = 500, DEVICE_LOG = 64, TASK_DEVICES = 8;
// CPU 0's side of the link (H-CPUCONN0): CPUCONN_CPU0 and CPUCALL_CPU0, which CPU 0's init task starts with act_tsk
// (0x5002cd0c..0x5002cd2d: the id words 0x60042e50, 0x60042e52), [id word, entry, name]; and the proxy CPU 0's CPUCONN
// creates for a call from CPU 2 (cores spec 5.1: entries 0x5002cf2d/4d/6e/8f by source)
export const CPU0_LINK = [[A(0x60042E50), A(0x5002CED4), 'CPUCONN_CPU0'], [A(0x60042E52), A(0x50036353), 'CPUCALL_CPU0']];
export const CPU0_PROXY2 = A(0x5002CF6E);
// USTART_L2, the overlay loader BOOT_CPU2 starts (H-CPU2LOADER)
export const USTART_L2 = A(0x50024572);
// OlyTaSt, which sends a start of another core's task to that core (cpu_conn kind 9, cores spec 3.7)
export const OLY_TA_ST = A(0x5002C546);
// H-CPU2TASKS: the CPU 2 tasks CPU 0's boot stages start (0x501e8f09..0x501ea7a9, USTART2..5, cores spec 3.7), in the
// stages' order, [task id word, its start site, entry, name, the site of the module init the stage calls before it]:
// TAKE's CPU 2 readers WB_MOV (queue 0x2006; init 0x5046aa2b), MVR_MAIN (MOV_COMMAND 0x2001; init 0x5045fed3, which
// binds MVR's queues to its flag 0x2003) and SDET (SDET_EXEC 0x2005; the init 0x50510afd, among SDET's functions,
// which the stage calls before FACE_MAIN's and FACE_BEAUTY's starts on CPUs 3 and 1, D), and OSD_DRAW_CPU2 (no init)
export const CPU2_STARTS = [
  [A(0x60043604), A(0x501E9157), A(0x5046AAB2), 'WB_MOV', A(0x501E9150)],
  [A(0x600435EA), A(0x501E9233), A(0x5045FCDD), 'MVR_MAIN', A(0x501E91EE)],
  [A(0x60043606), A(0x501E96F1), A(0x5050CC2A), 'SDET', A(0x501E96A0)],
  [A(0x60043610), A(0x501EA04C), A(0x51015F1D), 'OSD_DRAW_CPU2', null]];
// the halt word of core 2's idle loop (0x97f000fc[core - 1], in the command block): H-CPU2POLL sleeps while it is 0
export const HALT_WORD2 = A(0x97F00100);
// OSD_DRAW_CPU2's queue (the id word 0x60043698, 0x2013), the GUI's synchronous send to it (OSDControl::drawHistogram
// 0x50ae9f5f -> 0x510149a2, its send's return 0x51014a64), and OSD_DRAW_CPU2's loop: after its receive (0x51015f63,
// the message at sp + 72: reply queue, word, command, parameter) and at its reply's send (0x510160b8: d0 the reply
// queue, a2 the reply {u16 status, word, parameter})
export const OSD_QUEUE_WORD = A(0x60043698), OSD_SEND_RETURN = A(0x51014A64);
export const OSD_TAKEN = A(0x51015F63), OSD_REPLY = A(0x510160B8);

export class Cpu2 {
  constructor(session) {
    this.s = session; this.lab = session.lab; this.m = session.lab.sim.m; this.cores = this.m.cores;
    if (!this.cores) throw new FirmwareError('--cpu2 native: the machine has no second core (createMachine cores)');
    this.log = [];                   // [kind, detail]
    this.started = [];               // core 2's task starts [entry, name]
    this.posts = [];                 // core 2's cross-core calls (sys_callrequest, CREQ, cpu_conn)
    this.devices = [];               // core 2's first device accesses [R/W, address, value, size, region, pc]
    this.run_devices = new Map();    // and after its boot, by context: {n, first [..., the bus error]}
    this.cpu0_tids = null;           // H-CPUCONN0: CPU 0's [tid, name]
    this.tasks_started = [];         // H-CPU2TASKS: [id, name]
    this.osd = null;                 // OSD_DRAW_CPU2's queue: {queue, routed, sent, taken, replies}
    this.table = null;               // core 2's stops: pc -> [name, handler]
    this.polled = 0;                 // H-CPU2POLL's sleeps (only while the halt word is clear)
    this.boot_result = null;
    this.idle_runs = 0;
  }
  note(kind, detail) { this.log.push([kind, detail]); }
  take_log() { const out = this.log; this.log = []; return out; }
  // finish the function core 2 stopped at as if it returned at once (its caller's CALL frame), with d0 = result
  finish(api, d0 = null) {
    const R = api.R, mdr = R[11] >>> 0, here = R[9] >>> 0;
    const b = api.read(mdr - 7, 7), s = b.subarray(2);
    let mask, size;
    const le32 = (x, o) => (x[o] | x[o + 1] << 8 | x[o + 2] << 16 | x[o + 3] << 24) | 0, le16 = (x, o) => ((x[o] | x[o + 1] << 8) << 16) >> 16;
    if (b[0] === 0xDD && ((mdr - 7 + le32(b, 1)) >>> 0) === here) { mask = b[5]; size = b[6]; }
    else if (s[0] === 0xCD && ((mdr - 5 + le16(s, 1)) >>> 0) === here) { mask = s[3]; size = s[4]; }
    else throw new FirmwareError(`cpu2: the stop at ${h8(disasm(here))} was not reached by CALL (mdr ${h8(mdr)})`);
    api.write(RETURN2, new Uint8Array([0xDF, mask, size]));
    if (d0 !== null) R[0] = d0 | 0;
    R[9] = RETURN2 | 0;
    return 'go';
  }
  // core 2's running task: its TCB's id (kcb[96] -> TCB, +16)
  current_task(api) {
    const tcb = api.u32(api.u32(KCB2 + 96));
    if (!tcb) return null;
    const b = api.read(tcb + 16, 2);
    return '0x' + (b[0] | b[1] << 8).toString(16);
  }
  stops() {
    const self = this;
    const t = new Map();
    t.set(D(0x50008F1A), ['H-CPU2CACHE', (api) => { self.note('skip', 'H-CPU2CACHE: (0x98100808) = 16'); api.R[9] += 4; return 'go'; }]);
    t.set(D(0x50008F37), ['H-CPU2UART', (api) => { self.note('skip', `H-CPU2UART: "${String.fromCharCode(api.read(api.R[4] >>> 0, 1)[0])}"`); api.R[9] += 7; return 'go'; }]);
    t.set(D(0x50015A61), ['K-BOOTSYNC2', (api) => { self.note('skip', 'K-BOOTSYNC2: 0x50015a61'); return self.finish(api); }]);
    t.set(D(0x50012367), ['K-STARTBITS', (api) => {
      const v = api.read(STARTBITS, 2), w = (v[0] | v[1] << 8) | 0xb;
      api.write(STARTBITS, new Uint8Array([w & 0xff, w >> 8]));
      self.note('stand-in', `K-STARTBITS: (u16)0x97f00000 0x${(v[0] | v[1] << 8).toString(16)} -> 0x${w.toString(16)}`);
      return 'step';
    }]);
    t.set(D(0x50017B86), ['kbreak', (api) => api.park(`core 2: kernel break(${api.R[0]}) from ${h8(disasm(api.R[11]))}`)]);
    t.set(D(0x5001258B), ['xcpu_wait', (api) => api.park(`core 2: inter-CPU handshake with CPU ${api.R[0]} from ${h8(disasm(api.R[11]))}`)]);
    // the cross-core paths core 2 takes (cores spec 5.1), recorded with their arguments and the caller, run natively
    const post = (name, fmt) => (api) => {
      const R = api.R;
      self.posts.push({ path: name, ...fmt(api), caller: h8(disasm(R[11] >>> 0)), task: self.current_task(api), insns: api.insns(),
        lab_ns: self.lab.lab_time() });
      return 'step';
    };
    t.set(D(0x50035AFD), ['xcpu_post', post('sys_callrequest', ({ R }) => ({ target: R[0], fn: h8(disasm(R[4] >>> 0)), arg: h8(R[5]) }))]);
    t.set(D(0x50036120), ['xcpu_creq', post('CREQ', ({ R }) => ({ target: R[0], fn: h8(disasm(R[4] >>> 0)), arg: h8(R[5]) }))]);
    // the sender's d0: the object id; a0: the request, its kind the word at +0 (the callers store it there, D)
    t.set(D(0x5002D679), ['xcpu_conn', post('cpu_conn', (api) => ({ object: '0x' + (api.R[0] & 0xffff).toString(16), kind: api.u32(api.R[4] >>> 0) }))]);
    // H-CPU2LOADER: USTART_L2 returns from its entry at once (to the return address the kernel's task start left at
    // its sp); the control cpu2-loader runs it natively
    if (this.s.opts.mutant !== 'cpu2-loader') t.set(D(USTART_L2), ['H-CPU2LOADER', (api) => {
      const ra = api.u32(api.R[8] >>> 0);
      self.note('skip', `H-CPU2LOADER: USTART_L2 returns to ${h8(disasm(ra))}`);
      api.R[9] = ra | 0;
      return 'go';
    }]);
    t.set(D(0x50011825), ['task_start', (api) => {
      const entry = disasm(api.R[6] >>> 0), name = CPU2_TASKS.get(entry);
      self.started.push([h8(entry), name ?? null]);
      if (!name) return api.park(`core 2 would start task entry ${h8(entry)} (exinf 0x${(api.R[2] >>> 0).toString(16)}): not modelled`);
      self.note('start', name);
      return 'step';
    }]);
    return t;
  }
  // the halt pcs, each the instruction after a store of 8 to (0x8040): OlyTaSE's halt loop and the idle command loop's
  // halt (when its halt word 0x97f000fc[1] is set, D 0x50038b04), from which the interrupt that wakes the core returns
  // and goes on (cores.mjs); and the idle TCB's spins (bra to itself)
  static halts() { return [D(0x5002C75B), D(0x50038B09), D(0x500159F3), D(0x50015A0B)]; }
  // H-CPUCONN0: CPU 0's CPUCONN_CPU0 and CPUCALL_CPU0 started with act_tsk as CPU 0's init task starts them, and
  // CPUCONN's proxy for CPU 2 allowed; both then wait (CPUCONN_CPU0 on its flag, CPUCALL_CPU0 in its receive)
  cpu0_link() {
    const lab = this.lab, tasks = new Map([...lab.nk.tasks()].map(([t, [e]]) => [t, e]));
    const tids = CPU0_LINK.map(([word, entry, name]) => {
      const b = lab.sim.read(word, 2), tid = b[0] | b[1] << 8;
      if (tasks.get(tid) !== entry || lab.nk.state(tid) !== 0x10) {
        throw new FirmwareError(`H-CPUCONN0: ${name}'s task ${tid} (the id word ${h8(word)}): entry ${h8(tasks.get(tid) ?? 0)}, state 0x${lab.nk.state(tid).toString(16)}: not ${h8(entry)}, dormant`);
      }
      lab.lt.allow.add(entry);
      const [rc] = lab.nk.svc('act_tsk', { d0: tid });
      if (rc !== 0) throw new FirmwareError(`H-CPUCONN0: act_tsk(${tid}) = ${rc}`);
      return [tid, name];
    });
    lab.lt.allow.add(CPU0_PROXY2);
    this.s.settle('H-CPUCONN0');
    const waiting = tids.filter(([t]) => (lab.nk.state(t) & 0xF) !== 4);
    if (waiting.length) throw new FirmwareError(`H-CPUCONN0: ${waiting.map(([, n]) => n).join(', ')} not waiting after the start`);
    this.cpu0_tids = tids;
    this.note('start', `CPU 0: ${tids.map(([t, n]) => `${n} ${t}`).join(', ')}`);
  }
  // H-CPU2RELEASE, then core 2 from its entry until it sleeps (BOOT_TURNS turns of the quantum at most)
  boot() {
    this.cpu0_link();
    const lab = this.lab, cores = this.cores, table = this.table = this.stops();
    lab.sim.word(RELEASE, 1);
    lab.sim.word(TICK_MAGIC, MAGIC);
    const hw = HALT_WORD2 - CMD_BLOCK, halted = (b) => (b[hw] | b[hw + 1] | b[hw + 2] | b[hw + 3]) !== 0;
    cores.start(runtime(CPU2_ENTRY), 0, { stops: [...table.keys()], halts: Cpu2.halts(),
      polls: [[runtime(IDLE_LOOP), CMD_BLOCK, CMD_BLOCK_SIZE, (b) => !halted(b) && (this.polled += 1, true)]] });
    cores.onStop = (pc, api) => {
      const e = table.get(pc);
      if (!e) return api.park(`core 2 stopped at ${h8(disasm(pc))} with no handler`);
      return e[1](api);
    };
    const m = this.m;
    m.setMmioTrace((dir, a, v, w, name, cpu, err) => {
      if (cores.cur === 2 && cpu === 0 && this.devices.length < DEVICE_LOG) this.devices.push([dir ? 'W' : 'R', h8(a), h8(v), w, name, h8(disasm(cores.regs()[9])), err]);
    });
    let r = null, turns = 0;
    try {
      for (; turns < BOOT_TURNS; turns++) {
        r = cores.turn(CPU2_QUANTUM * 50);
        if (r.kind !== 'limit') break;
      }
    } finally { m.setMmioTrace(null); }
    const st = cores.state();
    this.boot_result = { kind: r.kind, pc: h8(disasm(r.pc)), turns: turns + 1, insns: st.insns, polling: st.polling };
    if (st.parked) throw new FirmwareError(`--cpu2 native: core 2's boot stopped: ${st.parked}`);
    if (r.kind !== 'halt') throw new FirmwareError(`--cpu2 native: core 2 did not reach its idle loop in ${BOOT_TURNS} turns (at ${h8(disasm(r.pc))})`);
    this.note('boot', `idle at ${h8(disasm(r.pc))} after ${st.insns} instructions`);
    cores.interleave = true;
    this.lab.lt.idle_steps.push(() => this.idle_step());
    // core 2's device accesses after its boot, by its context (a task's id, or 'interrupt' while the kernel's nesting
    // byte, KCB +28's pointer, is not 0): the first TASK_DEVICES of each, and the count
    m.setMmioTrace((dir, a, v, w, name, cpu, err) => {
      if (cores.cur !== 2 || cpu !== 0) return;
      const sim = lab.sim, nest = sim.read(sim.u32(KCB2 + 28), 1)[0];
      const key = nest ? 'interrupt' : '0x' + (sim.read(sim.u32(KCB2 + 96) + 16, 2).reduce((x, y, k) => x | y << 8 * k, 0)).toString(16);
      let e = this.run_devices.get(key);
      if (!e) this.run_devices.set(key, e = { n: 0, first: [] });
      e.n += 1;
      if (e.first.length < TASK_DEVICES) e.first.push([dir ? 'W' : 'R', h8(a), h8(v), w, name, h8(disasm(cores.regs()[9])), err]);
    });
    this.start_tasks();
    this.osd_route();
  }
  // H-CPU2TASKS: each CPU 2 task of CPU2_STARTS started as its CPU 0 boot stage starts it, OlyTaSt(id) from CPU 0 (the
  // lab task, which waits while the start goes to core 2 natively: cpu_conn kind 9, CPUCONN2's proxy, act_tsk there)
  start_tasks() { for (const row of CPU2_STARTS) this.start_task(row); }
  // one row [id word, start site, entry, name, init site]: the module init the start site's stage calls before it (the
  // `call d32` at the init site, its target and frame read there; or null) natively on CPU 0, then OlyTaSt(id)
  start_task([word, site, entry, name, initSite = null]) {
    const lab = this.lab, k2 = new NativeKernel(lab, 2);
    {
      const b = lab.sim.read(word, 2), id = b[0] | b[1] << 8, s = lab.sim.read(runtime(site), 6);
      // the site: movhu (word),d0 (fc ac abs32), then exth d0 and the call of OlyTaSt (D)
      if (s[0] !== 0xFC || s[1] !== 0xAC || (s[2] | s[3] << 8 | s[4] << 16 | s[5] << 24) >>> 0 !== word >>> 0) {
        throw new FirmwareError(`H-CPU2TASKS: ${name}'s start site ${h8(site)} does not load the id word ${h8(word)}`);
      }
      if (id >> 12 !== 2 || k2.entry(id) !== entry || k2.state(id) !== 0x10) {
        throw new FirmwareError(`H-CPU2TASKS: ${name}'s task 0x${id.toString(16)} on CPU 2: entry ${h8(k2.entry(id) ?? 0)}, state 0x${k2.state(id).toString(16)}: not ${h8(entry)}, dormant`);
      }
      if (initSite !== null) {
        const c = lab.sim.read(runtime(initSite), 7);
        if (c[0] !== 0xDD) throw new FirmwareError(`H-CPU2TASKS: ${name}'s init site ${h8(initSite)} is not a call d32`);
        const init = disasm((runtime(initSite) + (c[1] | c[2] << 8 | c[3] << 16 | c[4] << 24)) >>> 0);
        lab.call(init, null, null, [c[5], c[6]], 200000);
        this.note('init', `H-CPU2TASKS: ${name}'s init ${h8(init)} (the call at ${h8(initSite)}) on CPU 0`);
      }
      const r = lab.call(OLY_TA_ST, { d0: id }, null, null, 200000);
      if ((r.d0 | 0) !== 0) throw new FirmwareError(`H-CPU2TASKS: OlyTaSt(0x${id.toString(16)}) = ${r.d0 | 0}`);
      this.s.settle(`H-CPU2TASKS ${name}`);
      if ((k2.state(id) & 0xF) !== 4) throw new FirmwareError(`H-CPU2TASKS: ${name} (0x${id.toString(16)}) is ${k2.state(id)} after its start, not waiting`);
      this.tasks_started.push([`0x${id.toString(16)}`, name]);
      this.note('start', `H-CPU2TASKS: ${name} 0x${id.toString(16)} through OlyTaSt from CPU 0`);
      return id;
    }
  }
  // OSD_DRAW_CPU2's queue: under control camapp 3 the GUI's drawHistogram send goes to it natively; under camapp 1
  // and 2 it stays S-MODACK's (E_OK, nothing drawn): there nothing writes the bins the request points at
  // (getHistogramData answered by S-TRAACK), which keep 0xdeadbeef, the fill the task creation 0x5002cbe7..0x5002cbf8
  // writes into a new task's stack (X), and OSD_DRAW_CPU2 would draw columns of that height. Core 2's stops record each
  // request it takes and its reply.
  osd_route() {
    const lab = this.lab, b = lab.sim.read(OSD_QUEUE_WORD, 2), q = b[0] | b[1] << 8;
    this.osd = { queue: q, routed: !!this.s.opts.camapp_native_tra, sent: 0, taken: [], replies: [] };
    const self = this, api16 = (api, a) => { const x = api.read(a, 2); return x[0] | x[1] << 8; };
    const add = new Map([
      [D(OSD_TAKEN), ['OSD_DRAW_CPU2 takes', (api) => {
        const sp = api.R[8] >>> 0, req = api.u32(sp + 84);
        const plane = req ? api.u32(req) : 0;
        self.osd.taken.push({ reply_queue: api.u32(sp + 72), command: api.u32(sp + 80), req: h8(req), base: h8(plane ? api.u32(plane) : 0),
          x: api16(api, req + 4), y: api16(api, req + 6), w: api16(api, req + 8), h: api16(api, req + 10), n: api16(api, req + 24),
          bins: h8(api.u32(req + 12)), scale: api.u32(req + 20), lab_ns: self.lab.lab_time() });
        return 'step';
      }]],
      [D(OSD_REPLY), ['OSD_DRAW_CPU2 replies', (api) => {
        self.osd.replies.push({ queue: api.R[0] & 0xffff, status: api16(api, api.R[6] >>> 0), lab_ns: self.lab.lab_time() });
        return 'step';
      }]]]);
    for (const [pc, e] of add) this.table.set(pc, e);
    this.cores.addStops([...add.keys()]);
    if (!this.osd.routed) return;
    const prev = lab._sync_send.bind(lab);
    lab._sync_send = (h, r) => {
      if ((r.d0 & 0xFFFF) !== q) return prev(h, r);
      if (disasm(r.mdr) !== OSD_SEND_RETURN) throw new FirmwareError(`--cpu2 native: a synchronous send to OSD_DRAW_CPU2's queue 0x${q.toString(16)} from ${h8(disasm(r.mdr))}, not the GUI's ${h8(OSD_SEND_RETURN)}`);
      this.osd.sent += 1;
      return lab.passthrough(r);
    };
  }
  // the idle step (LabTask.idle_steps): at CPU 0's idle point core 2 runs while it is awake; 'again' when it ran
  idle_step() {
    const cores = this.cores;
    if (!cores.runnable()) return false;
    for (let k = 0; k < IDLE_TURNS; k++) {
      const r = cores.turn(CPU2_QUANTUM);
      if (r.kind === 'parked') throw new FirmwareError(`--cpu2 native: ${cores.state().parked}`);
      if (r.kind === 'halted') return k ? 'again' : false;           // asleep with a request it does not admit
      if (!cores.runnable()) { this.idle_runs += 1; return 'again'; }
    }
    throw new FirmwareError(`--cpu2 native: core 2 ran ${IDLE_TURNS} turns at one idle point without sleeping (at ${h8(disasm(cores.state().pc))})`);
  }
  problem() {
    const p = this.cores.problem();
    return p ? `--cpu2 native: ${p.message}` : null;
  }
  status() {
    const st = this.cores.state(), intc = this.lab.sim.m.devices.intc;
    return { ...st, pc: h8(disasm(st.pc)), boot: this.boot_result, started: this.started, posts: this.posts.length, idle_runs: this.idle_runs,
      presented: intc.log2.presented, accepted: intc.log2.accepted, kicks: intc.kicks.length, polled: this.polled, cpu0_link: this.cpu0_tids, tasks: this.tasks_started,
      osd: this.osd && { routed: this.osd.routed, sent: this.osd.sent, taken: this.osd.taken.length, replies: this.osd.replies.length } };
  }
}
