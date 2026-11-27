// Unit tests for the non-mutating `cpu2` inspection op in LiveDebug (emu/src/debug/live.mjs).
// Firmware-free standalone test:
//   node emu/test/test_debug_cpu2.mjs
import { LiveDebug } from '../src/debug/live.mjs';
import { KCB, TCB_STATE, TCB_SP, TCB_CTSK } from '../src/lab/kernel.mjs';
import { runtime } from '../src/lab/hle.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makeMockSim() {
  const mem = new Map();
  let writes = 0;
  const setByte = (a, v) => mem.set(a >>> 0, v & 0xff);
  const putU16 = (a, v) => { setByte(a, v); setByte(a + 1, v >>> 8); };
  const putU32 = (a, v) => { setByte(a, v); setByte(a + 1, v >>> 8); setByte(a + 2, v >>> 16); setByte(a + 3, v >>> 24); };

  const sim = {
    debug: null,
    rearm() {},
    read(addr, len) {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = mem.get((addr + i) >>> 0) ?? 0;
      return out;
    },
    u32(addr) {
      const b = this.read(addr, 4);
      return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
    },
    write() { writes += 1; throw new Error('cpu2 op must not write memory'); },
    word() { writes += 1; throw new Error('cpu2 op must not write memory'); },
    m: {
      cores: null,
      devices: { clock: { t: 0 } },
      setExecTrace() {},
      setMmioTrace() {},
      setIrqTrace() {},
      paused() { return false; },
      setWatchpoints() {},
      setProbes() {},
    },
  };
  return { sim, putU16, putU32, writes: () => writes };
}

function makeMockPlayer(session) {
  return {
    phase: session ? 'running' : 'idle',
    q: { canBlock: false },
    session,
    env: {},
    wall() { return 0; },
    anchor() {},
    set_phase() {},
    finish_debug() {},
  };
}

export function debugCpu2Units() {
  const bad = [];
  let checks = 0;
  const ok = (what, cond, detail = '') => { checks++; if (!cond) bad.push(`${what}${detail ? ` (${detail})` : ''}`); };

  // ---- 1. No session -> BadRequest
  {
    const live = new LiveDebug(makeMockPlayer(null));
    const r = live.handle({ id: 1, op: 'cpu2' });
    ok('cpu2 without session fails with BadRequest', !r.ok && r.id === 1 && r.error?.type === 'BadRequest', JSON.stringify(r));
  }

  // ---- 2. Session without native CPU 2 -> { active: false }
  {
    const { sim, writes } = makeMockSim();
    const lab = { sim };
    const live = new LiveDebug(makeMockPlayer({ lab, cpu2: null }));
    const r = live.handle({ id: 2, op: 'cpu2' });
    ok('cpu2 when session.cpu2 is null returns { active: false }', r.ok && r.id === 2 && r.active === false && Object.keys(r).length === 3, JSON.stringify(r));
    ok('cpu2 inactive does not write memory', writes() === 0);
    live.closed();
  }

  // ---- 3. Session with active native CPU 2 -> state, hex8 regs, status, non-dormant tasks
  {
    const { sim, putU16, putU32, writes } = makeMockSim();
    const kcb2 = KCB[2];
    const countAddr = 0x60050000;
    const runningSlot = 0x60050010;
    const tcbTable = 0x60050100;
    const tcb1 = 0x60051000, tcb2 = 0x60051100, tcb3 = 0x60051200;

    // Populate KCB2
    putU32(kcb2 + 56, countAddr);
    putU32(kcb2 + 96, runningSlot);
    putU32(kcb2 + 204, tcbTable);

    // 3 tasks in table: tid 1 (RUN, running), tid 2 (WAI), tid 3 (DMT, filtered out)
    putU16(countAddr, 3);
    putU16(countAddr + 2, 3);
    putU32(runningSlot, tcb1);
    putU32(tcbTable + 0, tcb1);
    putU32(tcbTable + 4, tcb2);
    putU32(tcbTable + 8, tcb3);

    const entry1 = 0x50008fbb, entry2 = 0x5002ced4, entry3 = 0x50024572;
    const writeTcb = (addr, state, sp, entry, prio) => {
      putU16(addr + TCB_STATE, state);
      putU32(addr + TCB_SP, sp);
      putU32(addr + TCB_CTSK + 8, runtime(entry));
      putU16(addr + TCB_CTSK + 12, prio);
    };
    writeTcb(tcb1, 1, 0xa3100100, entry1, 10);
    writeTcb(tcb2, 4, 0xa3100200, entry2, 30);
    writeTcb(tcb3, 0x10, 0xa3100300, entry3, 50);

    const rawRegs = new Int32Array(24);
    rawRegs[0] = 0x11223344;            // d0
    rawRegs[1] = -1;                    // d1 -> 0xffffffff
    rawRegs[8] = 0xa3100100 | 0;        // sp (negative signed i32)
    rawRegs[9] = runtime(0x50038b09) | 0; // pc
    rawRegs[10] = 0x00000800;           // psw
    rawRegs[11] = runtime(0x50038840) | 0; // mdr
    const rawSnapshot = rawRegs.slice();

    const coreState = {
      started: true, halted: true, polling: false, parked: null,
      pc: rawRegs[9] >>> 0, psw: 0x0800, insns: 123456,
      irqReq: false, interleave: true, quantum: 2000,
      turns: 42, switches: 84, halts: 41, wakes: 41, skipped: 10,
    };
    const mockStatus = {
      ...coreState,
      pc: '0x50038b09',
      boot: { kind: 'halt', pc: '0x50038b09', turns: 2, insns: 90000, polling: false },
      started: [['0x50008fbb', 'BOOT_CPU2']],
      posts: 3, idle_runs: 5, presented: 7, accepted: 7, kicks: 7, polled: 0,
      cpu0_link: [[0x99, 'CPUCONN_CPU0']], tasks: [['0x2001', 'WB_MOV']], osd: null,
    };
    const cores = {
      state() { return { ...coreState }; },
      regs() { return rawRegs; },
    };
    sim.m.cores = cores;
    const cpu2 = { cores, status() { return { ...mockStatus }; } };
    const lab = { sim };
    const live = new LiveDebug(makeMockPlayer({ lab, cpu2 }));

    const r1 = live.handle({ id: 3, op: 'cpu2' });
    const r2 = live.handle({ id: 4, op: 'cpu2' });

    ok('cpu2 active returns ok: true and active: true', r1.ok && r1.id === 3 && r1.active === true, JSON.stringify(r1));
    ok('cpu2 state matches cores.state()', same(r1.state, coreState), JSON.stringify(r1.state));
    ok('cpu2 regs formats d0, d1, sp, psw, insns as hex8',
      r1.regs?.d0 === '0x11223344' &&
      r1.regs?.d1 === '0xffffffff' &&
      r1.regs?.sp === '0xa3100100' &&
      r1.regs?.psw === '0x00000800' &&
      r1.regs?.insns === '0x0001e240',
      JSON.stringify(r1.regs));
    ok('cpu2 status matches cpu2.status()', same(r1.status, mockStatus), JSON.stringify(r1.status));

    const wantTasks = [
      { tid: 1, entry: '0x50008fbb', state: 'RUN', priority: 10, sp: '0xa3100100', running: true },
      { tid: 2, entry: '0x5002ced4', state: 'WAI', priority: 30, sp: '0xa3100200', running: false },
    ];
    ok('cpu2 tasks lists only non-dormant core 2 tasks', same(r1.tasks, wantTasks), JSON.stringify(r1.tasks));
    ok('cpu2 is non-mutating across repeated calls',
      r2.ok && same({ state: r1.state, regs: r1.regs, status: r1.status, tasks: r1.tasks }, { state: r2.state, regs: r2.regs, status: r2.status, tasks: r2.tasks }),
      'repeated call differed');
    ok('cpu2 did not mutate rawRegs or write memory', same([...rawRegs], [...rawSnapshot]) && writes() === 0);

    // ---- 4. KCB2 not yet initialized (kcb(56) === 0) -> tasks: [] cleanly
    putU32(kcb2 + 56, 0);
    const r3 = live.handle({ id: 5, op: 'cpu2' });
    ok('cpu2 handles uninitialized KCB2 cleanly with tasks: []', r3.ok && r3.active === true && same(r3.tasks, []), JSON.stringify(r3));

    live.closed();
  }

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad } = debugCpu2Units();
  if (bad.length) {
    console.error(`test_debug_cpu2: FAIL (${bad.length}/${checks}):\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`test_debug_cpu2: PASS (${checks} checks)`);
}
