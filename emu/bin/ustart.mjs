#!/usr/bin/env node
// The firmware's start tasks and the conditions they wait for (docs/hle-gaps.md 4.6.3; E143 only), and the start
// probe: each start task run natively from the state the lab's reset path leaves, as far as it goes. Off by default:
// no session runs it (this tool and test/test_ustart.mjs do); it is a tool's module and not the lab's, so that its
// addresses, which no other body needs, are none of the port's literals (bin/port.mjs reads src/). Addresses are
// E143's (D unless tagged).
//   node emu/bin/ustart.mjs [TASK ...] [--before ADDR[,ADDR ...]] [--json]
//     TASK      BOOT_CPU0, USRSTART_LOAD, USR_FAST_APP, USRSTART2, USRSTART3, USRSTART4, USRSTART5 (default: all)
//     --before  functions called natively before the task starts, to check what a stop needs (an init an earlier
//               start task runs on the camera): --before 0x50553649 USRSTART3
//     --json    the records as one JSON line each
// It prints each task's record: its trace in order and the stop that ends the run (below).
//
// The camera's chain (D): the init task BOOT_CPU0 (task 1, 0x5002cca5) starts USRSTART_LOAD (0x2b, the marks "L_")
// and runs the stages 0 (0x50023eca, "0_") and 1 (0x500248b4, "Usr1"), whose end starts USRSTART2 (0x28); each of
// USRSTART2, 3 (0x2a) and 4 (0x29) ends by starting the next, USRSTART5 (0x27) being the last. Stage 1 also starts
// USR_FAST_APP (0x55), whose flag the stages set bits of. The loaders USTART_L2 (CPU 2, 0x2013) and USTART_L3 (CPU 3,
// 0x300e) run beside them. Between them they keep four sets of conditions (START_E143 below):
//   phases   bit n - 1 of the word 0xa32df1f4 (n 1..10): USTART_L2 loads the overlay segment n and posts the CREQ
//            that runs 0x50024eda(n) on CPU 0 (n = 8 on CPU 1), which runs the segment's constructors and sets the
//            bit; 0x50024de8(n) waits for it in 2 ms sleeps, 0x50024dcf(n) reads it
//   bytes    0xa32df1ad..0xa32df1c0, one per step of a loader, set to 1 when the step is done
//   magics   0x77777777 in a word another core writes (0x5003b542 writes, 0x5003b5c3 waits), and the four cores'
//            done bytes 0x97f00094..97 (0x5003b4e8 sets, 0x500006ec reads)
//   levels   USR_FAST_APP's state 0xa32dddbc (0x501e6a34 waits for a level) and the permit 0xa32dddc0 (0x501e6a7f
//            sets, 0x501e6a55 waits), and its camera-on word 0xa32dddcc
//
// The probe (StartProbe). The lab's reset path is: segment 2's static constructors (src/lab/osd.mjs), the kernel's
// own init from its entry to its idle loop (K-native, src/lab/kernel.mjs), the init task ended and the lab task
// created. From that state the probe starts one start task with act_tsk, in a lab of its own, and lets it run
// natively. That lab is bare: the display and GUI stand-ins a lab is built with are taken out (the RTOS wrappers'
// and every S-* hook, the lab stub's allowed pages), so that what the lab does not model stops the task: a bus error,
// the instruction limit, a wait nobody answers. Kept are memset and memcpy (the host's copies), malloc and free (the
// lab's heap, as in every lab: the firmware's heap init is the reset head's), the error log and the UART prints
// (recorded). Its own steps:
//   H-PROBECTORS  the static constructors of the segments 6 and 7 natively before the task starts, as the lab's
//                 display bring-up runs them (src/lab/menu.mjs run_static_ctors); on the camera 0x50024eda(n) runs
//                 them when the segment is loaded (segment 8's are CPU 1's and do not run)
//   S-NOSTART     a task the start task starts (OlyTaSt, act_tsk, OlyTaStCpu) is recorded, answered E_OK and not
//                 started: the probe shows the start task's own path. A wait for such a task's answer then ends the
//                 run as a wait
//   S-STARTCOND   a start condition the task waits for and nobody sets in the probe's lab is recorded, then granted:
//                 the bit, byte, word or magic is written as its writer writes it, and the task goes on. The writer's
//                 other work is not done (a loader's step, another core's boot). The lab's image holds every
//                 segment's code, as for S-BOOTSTAGE, H-AUDSTART and S-STAGE9
//   H-PROBETICK   the kernel's tick (isig_tim 0x50011043) from the idle point while the task is in a timed wait; no
//                 lab time passes and no device is clocked
// The record of a task: its trace in order (boot marks, prints, the tasks it would start, the conditions granted,
// error-log calls, ticks), and the stop that ends the run: a fault (with the access the machine refused), a wait
// without a timeout (the wrapper's call and the call chain), a timed wait that 5000 ticks do not end, a spin, or the
// task's own end. The first condition granted is the task's first stop in the lab as it is. A known condition that
// holds while the task sleeps on it for 5000 ticks is the probe's misreading, a StartProbeError, not a stop.
import { fileURLToPath } from 'node:url';
import { FirmwareError, disasm, runtime } from '../src/lab/hle.mjs';
import * as K from '../src/lab/kernel.mjs';
import { RTOS, ERRLOG, PRINTS } from '../src/lab/rtos.mjs';
import { PlayLab } from '../src/lab/play.mjs';
import { STUB } from '../src/lab/display.mjs';
import { MODEL, ON_LAB_MODEL } from '../src/fw/model.mjs';
import { pack } from '../src/util/bytes.mjs';

export class StartProbeError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const MAGIC = 0x77777777;

// E143's start conditions and the code that keeps them (D):
//   tasks      the start tasks in the camera's order: [name in the task name table, id, entry]
//   mark       the boot log's mark 0x500039f7 (a0: its text); name: the log of a started task's name 0x5002cdb7
//   starters   the calls that start a task, the id in d0: OlyTaSt, act_tsk, OlyTaStCpu
//   phase      the word, its wait (poll: the return address of the wait's sleep) and its setter
//   polls      the other waits' sleeps by their return address, each with the condition it waits for: [what, the
//              word or byte (or several), its size, the value that ends the wait (null: a level, read from the
//              caller's `mov n,d0`), who sets it on the camera]
//   bytes      who sets each loader byte (the store's address)
//   spin       BOOT_CPU0's wait for the four cores' done bytes, which does not sleep: the call of the test in the loop
//   halt       OlyTaSE's idle loop, which BOOT_CPU0 ends in (0x5002c756: `(0x8040) = 8` for good)
//   names      the task name tables per CPU: {char name[24], u16 index} from index 1
export const START_E143 = {
  tasks: [['BOOT_CPU0', 0x01, 0x5002CCA5], ['USRSTART_LOAD', 0x2B, 0x5002417A], ['USR_FAST_APP', 0x55, 0x501E673B],
    ['USRSTART2', 0x28, 0x501E8E84], ['USRSTART3', 0x2A, 0x501E94A5], ['USRSTART4', 0x29, 0x501E9D54],
    ['USRSTART5', 0x27, 0x501E9E94]],
  mark: 0x500039F7, name: 0x5002CDB7,
  starters: [[0x5002C546, 'OlyTaSt'], [0x5000F879, 'act_tsk'], [0x5002D325, 'OlyTaStCpu']],
  phase: { word: 0xA32DF1F4, wait: 0x50024DE8, poll: 0x50024DFD, set: 0x50024EDA },
  polls: new Map([
    [0x5003B62A, ['magic', 0x97F00090, 4, MAGIC, 'BOOT_CPU3 after its boot jobs (0x50009450)']],
    [0x5003B691, ['magics', [0xA3193680, 0xA3193684, 0xA3193688], 4, MAGIC, 'the idle of CPUs 1, 2 and 3 (0x500387f6, 0x50038807, 0x50038819)']],
    [0x501E6A47, ['state', 0xA32DDDBC, 4, null, 'USR_FAST_APP\'s state machine (0x501e687a..0x501e69fd)']],
    [0x501E6A68, ['permit', 0xA32DDDC0, 4, null, 'SetPermit 0x501e6a7f: USRSTART2 (1, 2), USRSTART3 (4), USRSTART4 (5)']],
    [0x501E677C, ['camera-on', 0xA32DDDCC, 4, 1, 'stage 0\'s power start 0x50023db7, its callback 0x50023e71']],
    [0x500241FF, ['lens-init', 0x6296C28E, 1, 1, 'stage 1\'s lens module init 0x502a5d10 (0x502a5dd6)']],
  ]),
  bytes: new Map([
    [0xA32DF1AD, 'USTART_L2 after segment 1 (0x500245a7)'], [0xA32DF1B6, 'USTART_L2 after segment 10 (0x5002487f)'],
    [0xA32DF1B7, 'USTART_L3 after its D1 step (0x5002443e)'], [0xA32DF1B8, 'USTART_L3 after its LB step (0x50024482)'],
    [0xA32DF1B9, 'USTART_L2 after its LF read (0x5002464c)'], [0xA32DF1BA, 'USRSTART_LOAD after DPS (0x50024253)'],
    [0xA32DF1BB, 'USRSTART_LOAD after FBS (0x500242c1)'], [0xA32DF1BC, 'USRSTART_LOAD after FDS (0x50024291)'],
    [0xA32DF1BD, 'the resource read\'s block loader 0x5003cab3 (0x50003f9b, the mark "C1E")'],
    [0xA32DF1BE, 'USTART_L3 after DLS (0x500244b5)'], [0xA32DF1BF, 'USTART_L3 after DSS (0x500244f5)'],
    [0xA32DF1C0, 'USTART_L3 after DMS (0x50024535)'],
  ]),
  spin: { call: 0x5002CD70, bytes: [0x97F00094, 0x97F00095, 0x97F00096, 0x97F00097], who: 'each core\'s init task (0x5003b4e8)' },
  halt: 0x5002C756,
  names: [0x51A1B77C, 0x51A1C9EE, 0x51A1D34A, 0x51A1D756],
};
// the hooks the probe's lab keeps
const KEPT = new Set(['memset', 'memcpy', 'malloc', 'free', 'errlog', 'obs-irq_attach', 'printf_x', 'printf_d', 'puts', 'puts2',
  'kbreak', 'xcpu_wait', 'irq_default', 'lab_home', 'idle']);
// the RTOS wrappers a task can wait in for good, recorded with their object for the stop's record
const WAITERS = new Set(['OlyEvWt', 'OlyQeRd', 'OlyQeWr', 'OlySmWt']);
const KERNEL = [0x50008B7C, 0x50018000];          // the kernel's code: its return addresses are left out of a chain
const CODE = [0x50000000, 0x52000000];
const DMT = 0x10, WAI = 4;
// ticks one timed wait's site may take in a row before the run ends there: a poll, or a wait with a timeout retried,
// for something the probe does not know
const DELAY_LIMIT = 5000;
// instructions one continue of the probe's lab may run (a spin ends the run there)
const INSN_LIMIT = 60000000;
export const START_PROBE_STEPS = ['H-PROBECTORS', 'S-NOSTART', 'S-STARTCOND', 'H-PROBETICK'];

class ProbeLab extends PlayLab { static INSN_LIMIT = INSN_LIMIT; }
class Ended extends Error {}

export class StartProbe {
  // env: the lab's (rom, resBlock, createHash, ...)
  constructor(env) {
    if (!ON_LAB_MODEL) throw new StartProbeError(`the start probe reads E143's addresses only, not ${MODEL}'s`);
    this.env = env;
    this.S = START_E143;
  }
  // the start tasks (all, or those named), each in a lab of its own: [record]. before: functions (their addresses)
  // called natively from the lab task before the task starts, in order: a check of what a stop needs (an init an
  // earlier start task runs on the camera); none by default
  run(names = null, before = []) {
    const bad = (names ?? []).filter((n) => !this.S.tasks.some(([t]) => t === n));
    if (bad.length) throw new StartProbeError(`no start task ${bad.join(', ')}: ${this.S.tasks.map(([t]) => t).join(', ')}`);
    return this.S.tasks.filter(([n]) => names === null || names.includes(n)).map((t) => this.run_task(...t, before));
  }
  run_task(name, tid, entry, before = []) {
    const lab = new ProbeLab(this.env, { lang: 'en', inputs: new Map(), seed: new Map(), key_mode: 'skip', time: true });
    const rec = { task: name, tid, entry: h8(entry), ...(before.length ? { before: before.map(h8) } : {}), trace: [], marks: [], starts: [], granted: [], stop: null };
    try { this._run(lab, rec, tid, entry, before); } finally { lab.close(); }
    return rec;
  }
  _run(lab, rec, tid, entry, before) {
    const S = this.S, sim = lab.sim, nk = lab.nk, lt = lab.lt;
    if (nk.entry(tid) !== entry || nk.state(tid) !== DMT) throw new StartProbeError(`${rec.task}: task ${tid} has entry ${h8(nk.entry(tid) ?? 0)}, state 0x${nk.state(tid).toString(16)}: not ${h8(entry)}, dormant`);
    // the bare lab
    for (const [a, [, n]] of [...lab.hooks]) if (!KEPT.has(n)) lab.hooks.delete(a);
    sim.write(STUB + 0x100, new Uint8Array(12 * 32));
    sim.write(STUB + 0x400, new Uint8Array(16 * 128));
    // H-PROBECTORS
    lab.run_static_ctors();
    const failed = lab.ctor_results.filter((c) => c.status !== 'ok');
    if (failed.length) throw new StartProbeError(`H-PROBECTORS: ${failed.length} of ${lab.ctor_results.length} constructors failed: ${JSON.stringify(failed[0])}`);
    const text = (a, n) => { const b = sim.read(a, n), z = b.indexOf(0); return String.fromCharCode(...(z < 0 ? b : b.subarray(0, z))); };
    const task_name = (id) => {
      const base = S.names[id >> 12], n = id & 0xFFF;
      if (base === undefined || n < 1 || n > 255) return null;
      const b = sim.read(runtime(base + 26 * (n - 1)), 26);
      return (b[24] | b[25] << 8) === n ? text(runtime(base + 26 * (n - 1)), 24) : null;
    };
    // the trace: an entry repeated in a row is counted
    const trace = (kind, what) => {
      const t = rec.trace[rec.trace.length - 1];
      if (t && t[0] === kind && t[1] === what) t[2] += 1; else rec.trace.push([kind, what, 1]);
    };
    // the marks and prints, the error log, the starts (S-NOSTART) and the waits' objects
    lab.observe(S.mark, (l, r) => { const m = text(r.a0, 8); rec.marks.push(m); trace('mark', m); }, 'obs-bootmark');
    // (the name's log follows the start's call within a few instructions: `mov name,a0; call` or `mov a2,a0; call`)
    lab.observe(S.name, (l, r) => {
      const s = rec.starts[rec.starts.length - 1], t = rec.trace[rec.trace.length - 1];
      if (!s || s.log !== undefined || !t || t[0] !== 'start') return;
      const gap = disasm(r.mdr) - parseInt(s.from, 16);
      if (gap < 0 || gap > 16) return;
      s.log = text(r.a0, 24);
      t[1] += `, logged "${s.log}"`;
    }, 'obs-startname');
    for (const a of PRINTS.keys()) lab.wrap(a, (print) => (h, r) => { trace('print', text(r.a0, 60).trim()); print(h, r); });
    lab.wrap(ERRLOG, (errlog) => (h, r) => { trace('errlog', `${h8(r.d0)} from ${h8(disasm(r.mdr))}`); errlog(h, r); });
    let armed = false, last = null;
    for (const [fn, how] of S.starters) {
      lab.hook(fn, (h, r) => {
        const id = r.d0 & 0xFFFF;
        if (!armed && id === tid) { armed = true; lab.passthrough(r); return; }     // the probe's own start of the task
        const s = { id, name: task_name(id), how, from: h8(disasm(r.mdr)) };
        rec.starts.push(s);
        trace('start', `0x${id.toString(16)}${s.name ? ` ${s.name}` : ''} (${how} from ${s.from})`);
        h.finish(r, { d0: 0 });
      }, 'S-NOSTART');
    }
    for (const [a, n] of RTOS) if (WAITERS.has(n)) lab.observe(a, (l, r) => { last = { call: n, object: r.d0 & 0xFFFF, pattern: r.d1 >>> 0, from: h8(disasm(r.mdr)) }; }, `obs-${n}`);
    lab.hook(K.TASK_START, (h, r) => {
      if (K.disasm_of(r.a2) !== entry) throw new StartProbeError(`${rec.task}: the kernel starts the task entry ${h8(K.disasm_of(r.a2))}`);
      sim.packet('s');
    }, 'task_start');
    lab.hook(S.halt, () => { throw new Ended(); }, 'obs-halt');
    const grant = (g) => {
      if (rec.granted.some((x) => x.at === g.at && String(x.address) === String(g.address))) throw new StartProbeError(`${rec.task}: ${g.what} at ${g.at} granted and waited for again`);
      rec.granted.push(g);
      trace('grant', `${g.what}${g.n !== undefined ? ` ${g.n}` : ''} at ${g.at}: ${g.address}`);
    };
    // S-STARTCOND for BOOT_CPU0's spin on the done bytes: granted at its third pass
    let spins = 0;
    lab.observe(S.spin.call, () => {
      const b = S.spin.bytes.map((a) => sim.read(a, 1)[0]);
      if (b.every((v) => v === 1) || ++spins < 3) return;
      const missing = S.spin.bytes.filter((a, i) => b[i] !== 1);
      grant({ what: 'done-bytes', at: h8(S.spin.call), address: missing.map(h8), who: S.spin.who });
      for (const a of missing) sim.write(a, pack('<B', 1));
    }, 'S-STARTCOND');
    // the return addresses on the task's stack from sp up (its saved sp while it waits), the kernel's own left out
    const chain = (sp = sim.u32(nk.tcb(tid) + K.TCB_SP)) => {
      const out = [];
      for (let k = 0; k < 96 && out.length < 8; k++) {
        const w = sim.u32(sp + 4 * k) >>> 0;
        if (w < runtime(CODE[0]) + 8 || w >= runtime(CODE[1])) continue;
        const b = sim.read(w - 7, 7), d = disasm(w);
        const called = b[0] === 0xDD || b[2] === 0xCD || (b[5] === 0xF0 && b[6] >= 0xF0 && b[6] <= 0xF3) || (b[3] === 0xFA && b[4] === 0xFF) || (b[1] === 0xFC && b[2] === 0xFF);
        if (called && !(d >= KERNEL[0] && d < KERNEL[1])) out.push(d);
      }
      return out;
    };
    // the n of `mov n,d0` (imm8, 80 nn) right before the call that returns to ret; the waits' call sites are pinned
    // with their n by test/test_ustart.mjs ustartMap
    const level_before = (ret) => {
      const b = sim.read(runtime(ret) - 9, 9), at = b[2] === 0xDD ? 0 : b[4] === 0xCD ? 2 : -1;
      if (at < 0 || b[at] !== 0x80) throw new StartProbeError(`${rec.task}: no \`mov n,d0\` before the call that returns to ${h8(ret)}`);
      return b[at + 1];
    };
    // the loader byte a `movbu (abs32),d0; cmp 0,d0; bne; mov 2,d0; call dly_tsk` loop waits for, by the sleep's return
    const byte_wait = (ret) => {
      const b = sim.read(runtime(ret) - 19, 19);
      if (!(b[0] === 0xFC && b[1] === 0xA8 && b[6] === 0xA0 && b[7] === 0 && b[8] === 0xC9 && b[10] === 0x80 && b[12] === 0xDD)) return null;
      return (b[2] | b[3] << 8 | b[4] << 16 | b[5] << 24) >>> 0;
    };
    const u = (a, size) => (size === 1 ? sim.read(a, 1)[0] : sim.u32(a) >>> 0);
    // S-STARTCOND at the idle point: the condition the sleeping task polls (by the chain c), granted where it does not
    // hold; the poll's site (the return address the condition is known by), or false where the sleep is none the probe
    // knows
    const condition = (c) => {
      const k = c.indexOf(S.phase.poll);
      if (k >= 0) {
        const n = level_before(c[k + 1]), word = sim.u32(S.phase.word) >>> 0;
        if (!(word & 1 << (n - 1))) {
          grant({ what: 'phase', n, at: h8(c[k + 1]), address: h8(S.phase.word), who: `USTART_L2's CREQ of ${h8(S.phase.set)}(${n})` });
          sim.word(S.phase.word, word | 1 << (n - 1));
        }
        return c[k + 1];
      }
      for (const [i, ret] of c.entries()) {
        const p = S.polls.get(ret);
        if (!p) continue;
        const [what, where, size, value, who] = p, want = value ?? level_before(c[i + 1]), all = Array.isArray(where) ? where : [where];
        const short = all.filter((a) => (value === null ? (u(a, size) | 0) < want : u(a, size) !== want));
        if (short.length) {
          grant({ what, ...(value === null ? { n: want } : {}), at: h8(value === null ? c[i + 1] : ret), address: short.length === 1 ? h8(short[0]) : short.map(h8), who });
          for (const a of short) sim.write(a, size === 1 ? pack('<B', want) : pack('<I', want));
        }
        return ret;
      }
      const a = c.length ? byte_wait(c[0]) : null;
      if (a === null) return false;
      if (!sim.read(a, 1)[0]) {
        grant({ what: 'byte', at: h8(c[0]), address: h8(a), who: S.bytes.get(a) ?? 'not read' });
        sim.write(a, pack('<B', 1));
      }
      return c[0];
    };
    // H-PROBETICK: at the idle point, a tick while the task is in a timed wait
    // (a condition that holds while the task sleeps on it wakes the task within its sleep; one that holds for
    // DELAY_LIMIT ticks in a row and does not is one the probe misreads: an error, not a stop)
    let site = null, run = 0, held = null, holds = 0;
    const pending = () => {
      if ((nk.state(tid) & 0x1F) === DMT || !nk.timed_waiters().includes(tid)) return false;
      const c = chain(), n = rec.granted.length, known = condition(c);
      if (known !== false) {
        site = null;
        if (rec.granted.length > n || known !== held) { held = known; holds = 0; }
        if (++holds > DELAY_LIMIT) throw new StartProbeError(`${rec.task}: the start condition polled at ${h8(known)} holds, and the task has slept on it for ${DELAY_LIMIT} ticks`);
        return true;
      }
      // a timed wait for no start condition the probe knows: time passes, up to DELAY_LIMIT ticks at one site
      const at = c[0] ?? 0;
      if (at !== site) { site = at; run = 0; }
      if (++run > DELAY_LIMIT) { rec.stop = { kind: 'timed-wait', at: h8(at), ticks: run - 1, chain: c.map(h8) }; return false; }
      trace('tick', `in a timed wait at ${h8(at)}`);
      return true;
    };
    lt.time_mode = true;                                // (the lab task's settle then takes a timed wait as no error)
    for (const fn of before) {
      trace('before', h8(fn));
      try { lab.call(fn, null, null, null, 5000000); } catch (e) {
        if (!(e instanceof FirmwareError)) throw e;
        throw new StartProbeError(`${rec.task}: ${h8(fn)}, called before the task, did not return: ${e.message.slice(0, 300)}`);
      }
    }
    let err = null;
    try {
      const [rc] = nk.svc('act_tsk', { d0: tid }, null, 5000000);
      if (rc !== 0 || !armed) throw new StartProbeError(`${rec.task}: act_tsk(${tid}) = ${rc}`);
      lt.settle(() => K.tick(lt, 1), pending, 50000000);
    } catch (e) {
      if (e instanceof StartProbeError || !(e instanceof FirmwareError || e instanceof Ended)) throw e;
      err = e;
    }
    if (err instanceof Ended) rec.stop = { kind: 'end', how: `OlyTaSE's idle loop ${h8(S.halt)}` };
    else if (err !== null) rec.stop = this._fault(lab, err, chain);
    else if (rec.stop === null) {
      const st = nk.state(tid) & 0x1F;
      if (st === DMT) rec.stop = { kind: 'end', how: 'the task exited' };
      else if (st === WAI) rec.stop = { kind: 'wait', ...(last ?? {}), chain: chain().map(h8) };
      else throw new StartProbeError(`${rec.task}: task ${tid} is in state 0x${st.toString(16)} after the run`);
    }
  }
  // the run's end in a fault: the pc (a run-time address where it left the image), the fault's code, the access the
  // machine's lines name and the call chain on the stack
  _fault(lab, e, chain) {
    const m = /stopped at (0x[0-9a-f]+) \(disasm (0x[0-9a-f]+)\) fault=(\d+)/.exec(e.message);
    if (!m) return { kind: 'error', text: e.message.slice(0, 300) };
    const rt = parseInt(m[1], 16) >>> 0, code = +m[3], inside = rt >= runtime(CODE[0]) && rt < runtime(CODE[1]);
    const tail = lab.sim.stderrTail(600);
    const denied = /lab-stub DENIED (write|read) (0x[0-9a-f]+) size (\d+) value (0x[0-9a-f]+)/.exec(tail);
    const trap = [.../trap reason=(\d+) pc=(0x[0-9a-f]+) address=(0x[0-9a-f]+)/g[Symbol.matchAll](tail)].pop();
    return { kind: code === 7 ? 'spin' : 'fault', code, pc: inside ? m[2] : m[1], ...(inside ? {} : { outside: true }),
      ...(code === 2 && denied ? { access: denied[1], address: denied[2], size: +denied[3], ...(denied[1] === 'write' ? { value: denied[4] } : {}) }
        : trap ? { address: trap[3] } : {}),
      chain: chain(lab.sim.registers().sp).map(h8) };
  }
}
// a record as lines of text
export function recordLines(r) {
  const out = [`${r.task} (task ${r.tid}, entry ${r.entry})`];
  for (const [kind, what, n] of r.trace) out.push(`  ${kind} ${what}${n > 1 ? ` x${n}` : ''}`);
  const s = r.stop;
  out.push(`  STOP ${s.kind}: ${Object.entries(s).filter(([k]) => k !== 'kind').map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' < ') : v}`).join(', ')}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const args = process.argv.slice(2), names = [];
  let before = [], json = false;
  const usage = (why) => { console.error(`${why}\nusage: node emu/bin/ustart.mjs [TASK ...] [--before ADDR[,ADDR ...]] [--json]`); process.exit(2); };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--before') {
      const v = args[++i];
      if (v === undefined || !v.split(',').every((x) => /^(0x)?[0-9a-fA-F]{8}$/.test(x))) usage(`--before ${v}: code addresses in hex, comma-separated`);
      before = v.split(',').map((x) => parseInt(x, 16) >>> 0);
    } else if (args[i].startsWith('-')) usage(`${args[i]}: not an option`);
    else names.push(args[i]);
  }
  let recs;
  try {
    recs = new StartProbe({ rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash }).run(names.length ? names : null, before);
  } catch (e) {
    if (!(e instanceof StartProbeError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
  for (const r of recs) console.log(json ? JSON.stringify(r) : recordLines(r).join('\n'));
}
