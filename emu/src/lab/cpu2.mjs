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
//   H-CPU2POLL     the idle command loop's head 0x5003883a (BOOT_CPU2 at priority 70 after 0x500387eb): a pass that
//                  leaves the command block 0x97f0009c..0x97f00113 as the pass before found it sleeps until a byte of
//                  it changes or an interrupt comes (the loop reads nothing else; cores.mjs polls); with the halt
//                  word set a pass would halt again at once, so core 2 sleeps here after its first halt
// Core 2's task starts are guarded (CPU2_TASKS; any other entry parks it), its cross-core calls recorded (the post
// 0x50035afd, CREQ 0x50036120, the cpu_conn sender 0x5002d679) and run natively, its first device accesses recorded.
// Lab time does not move on core 2; at CPU 0's idle point core 2 runs until it sleeps (the idle step), and inside
// CPU 0's runs it takes a turn after every CPU2_QUANTUM instructions of CPU 0 (A-INTERLEAVE, cores.mjs).
import { A } from '../fw/model.mjs';
import { runtime, disasm } from './hle.mjs';
import { FirmwareError } from './errors.mjs';
import { hexDigits as fx } from '../util/hex.mjs';

export const CPU2_QUANTUM = 2000;
const h8 = (v) => '0x' + fx(v >>> 0, 8);
const D = (v) => runtime(A(v));                  // a code address in the disassembly notation, at run time

export const CPU2_ENTRY = A(0x50008F01), RELEASE = A(0xA3258360);
export const RETURN2 = A(0xA2100400);            // core 2's return trampoline (the lab's CALLER page, unused offset)
export const KCB2 = A(0x60043B34);
const STARTBITS = A(0x97F00000), TICK_MAGIC = A(0x97F00088), MAGIC = 0x77777777;
export const CMD_BLOCK = A(0x97F0009C), CMD_BLOCK_SIZE = 0x78, IDLE_LOOP = A(0x5003883A);
// the task entries core 2 may start: its init task's starts (D: 0x50008fbb..0x50009079)
export const CPU2_TASKS = new Map([[A(0x50008FBB), 'BOOT_CPU2'], [A(0x5002CED4), 'CPUCONN2'], [A(0x50036489), 'CPUCALL2'],
  [A(0x5002E2CB), 'CONTEST_CPU2'], [A(0x50024572), 'USTART_L2'],
  // CPUCONN's proxy for a call from CPU 0 (cores spec 5.1: entries 0x5002cf2d/4d/6e/8f by source), and the task
  // AUD_MAIN starts on CPU 2 through it (AUD_LEVEL_MONITOR 0x200e, cores spec 4)
  [A(0x5002CF2D), 'CPUCONN proxy (CPU 0)'], [A(0x50AAA99E), 'AUD_LEVEL_MONITOR']]);
export const CPU2_STAND_INS = ['H-CPU2RELEASE', 'H-CPU2CACHE', 'H-CPU2UART', 'K-BOOTSYNC2', 'K-STARTBITS', 'H-CPU2POLL',
  'A-CPU2RESET', 'A-COREPAGE', 'A-COREID', 'A-INTERLEAVE', 'A-KICK', 'H-CPU2GATE'];
const BOOT_TURNS = 200, IDLE_TURNS = 500, DEVICE_LOG = 64;

export class Cpu2 {
  constructor(session) {
    this.s = session; this.lab = session.lab; this.m = session.lab.sim.m; this.cores = this.m.cores;
    if (!this.cores) throw new FirmwareError('--cpu2 native: the machine has no second core (createMachine cores)');
    this.log = [];                   // [kind, detail]
    this.started = [];               // core 2's task starts [entry, name]
    this.posts = [];                 // core 2's cross-core calls (sys_callrequest, CREQ, cpu_conn)
    this.devices = [];               // core 2's first device accesses [R/W, address, value, size, region, pc]
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
  // H-CPU2RELEASE, then core 2 from its entry until it sleeps (BOOT_TURNS turns of the quantum at most)
  boot() {
    const lab = this.lab, cores = this.cores, table = this.stops();
    lab.sim.word(RELEASE, 1);
    lab.sim.word(TICK_MAGIC, MAGIC);
    cores.start(runtime(CPU2_ENTRY), 0, { stops: [...table.keys()], halts: Cpu2.halts(), polls: [[runtime(IDLE_LOOP), CMD_BLOCK, CMD_BLOCK_SIZE]] });
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
      presented: intc.log2.presented, accepted: intc.log2.accepted, kicks: intc.kicks.length };
  }
}
