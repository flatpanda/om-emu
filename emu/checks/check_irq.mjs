#!/usr/bin/env node
// The interrupt checks I1..I10 on the JS lab (Simulator,
// HLE, NativeKernel, LabTask, the INTC and timer debug views, MenuLab for I4's menu session), with the check's
// references from refs/irq.mjs (the image's static data, the ISA-manual and lab-assumption arithmetic) and its seeded
// draws from refs/mt19937.mjs. --mutants runs the harness mutant (gate mode 2 on the I4 menu session) and each
// machine mutant 20..31 (the machine option mutant, passed to every lab of the group); --only runs the
// named groups. A Group's eq compares with deepEqual and prints both values with show().
//   node emu/checks/check_irq.mjs [--mutants] [--only I1,I2,...]
import { labEnv, loadImage, loadBlock, runMain } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { newRandom } from './lib/rngtape.mjs';
import { Simulator, LAND, SP as SIM_SP } from '../src/lab/sim.mjs';
import { HLE, FirmwareError, disasm, install_core_index, runtime } from '../src/lab/hle.mjs';
import { IDLE_DONE, LabTask, NativeKernel, SVC, TTS, system_time } from '../src/lab/kernel.mjs';
import { PRINTS, ERRLOG } from '../src/lab/rtos.mjs';
import { MenuLab } from '../src/lab/menu.mjs';
import * as IRQ from '../src/lab/irq.mjs';
import { AssertionError, RuntimeError } from '../src/lab/errors.mjs';
import { pred, fault } from './lib/pred.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show } from '../src/util/show.mjs';
import { pack, unpack } from '../src/util/bytes.mjs';
import * as REF from '../refs/irq.mjs';

const CODE = 0x1000, SP0 = 0x20100;
const BREAK = [0xff];
const M32 = 0xFFFFFFFF;
const Z = 1, N = 2, C = 4, V = 8;
const RESERVED = 0xC0F0;
const TEST_BASE = 200;
const TASK_CODE = 0xA2300200, TASK_STACK = 0xA2320000;
const FN_CODE = 0xA2300800, ISR_CODE = 0xA2300C00, LOG = 0xA2301000;
const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (p instanceof Uint8Array ? [...p] : Array.isArray(p) ? p : [p])));
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const h = (s) => [...Buffer.from(s.replaceAll(' ', ''), 'hex')];
const hx = (v) => (v >>> 0).toString(16);
const x4 = (v) => (v >>> 0).toString(16).padStart(4, '0');
const x8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const range = (n) => Array.from({ length: n }, (_, i) => i);
const isFirmwareError = (e) => e instanceof FirmwareError;
const s400 = (e) => e.message.slice(0, 400);

class Group {
  constructor(name) { this.name = name; this.problems = []; this.cases = 0; }
  eq(label, got, want) {
    this.cases += 1;
    if (!pred(deepEqual(got, want), 2)) this.problems.push(`${label}: got ${show(got)}, want ${show(want)}`);
  }
  true(label, ok, detail = '') {
    this.cases += 1;
    if (!pred(ok, 2)) this.problems.push(`${label}${detail ? ': ' + detail : ''}`);
  }
}
// the Simulator / HLE with ORIGINAL; `with` closes it. machine: the machine options of the group's labs (labEnv)
function withSim(machine, limit, fn) { const sim = new Simulator(labEnv({ machine }), limit); try { return fn(sim); } finally { sim.close(); } }
function withHle(hle, fn) { try { return fn(hle); } finally { hle.close(); } }
const regsDict = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));

// ---------------------------------------------------------------- I1
function i1(machine = {}, seed = 1) {
  const g = new Group('I1 RTI');
  const rng = newRandom(seed);
  withSim(machine, 100, (sim) => {
    sim.write(CODE, bytes(0xf0, 0xfd, BREAK));
    for (let i = 0; i < 200; i++) {
      const kind = rng.choices(['valid', 'reserved', 'odd', 'half'], [75, 10, 8, 7])[0];
      let sp = 0x20000 + rng.randrange(0x40, 0x1F0, 4);
      let psw = rng.getrandbits(16) & ~RESERVED;
      if (kind === 'reserved') psw |= 1 << rng.choice([4, 5, 6, 7, 14, 15]);
      const target = 0x3000 + 16 * i;
      sim.write(target, bytes(0xc8, 0x03, BREAK, BREAK));
      const frame = pack('<HHI', psw, rng.getrandbits(16), target);
      sim.write(sp, frame);
      sp += { odd: 1, half: 2 }[kind] ?? 0;
      const regs = {};
      for (let k = 0; k < 4; k++) regs[`d${k}`] = rng.getrandbits(32);
      const p0 = rng.randrange(16);
      sim.reset({ pc: CODE, sp, psw: p0, ...regs });
      const r = sim.run();
      let want;
      if (kind === 'valid') want = { fault: 5, pc: target + (psw & Z ? 3 : 2), sp: sp + 8, psw };
      else if (kind === 'reserved') want = { fault: 6, pc: CODE, sp, psw: r.psw };
      else want = { fault: 3, pc: CODE, sp, psw: r.psw };
      g.eq(`frame ${i} (${kind}, SP 0x${hx(sp)}, PSW 0x${x4(psw)})`, regsDict(r, Object.keys(want)), want);
    }
  });
  return g;
}

// ---------------------------------------------------------------- I2
const TEST_IRQ = TEST_BASE + 10;
function i2(machine = {}, seed = 2) {
  const g = new Group('I2 acceptance');
  const img = loadImage();
  const ivars = REF.imageIvars(img);
  g.eq('the image stores 7 level IVARs at 0x5000f068', [...ivars.keys()].sort((a, b) => a - b), range(7));
  const rng = newRandom(seed);
  const levelreg = IRQ.BANKS[0] + 4 * TEST_IRQ;
  withSim(machine, 100, (sim) => {
    const intc = new IRQ.IntcDebug(sim);
    for (const [level, v] of ivars) sim.write(IRQ.IVAR + 4 * level, pack('<H', v));
    intc.set_gate(IRQ.GATE_ANY);
    const run = (code, psw, stops, level, storeFirst = true) => {
      sim.write(CODE, new Uint8Array(0x40));
      sim.write(CODE, bytes(code));
      sim.write(0x8A00, new Uint8Array(2));
      IRQ.cpu_store(sim, levelreg, storeFirst ? 1 << level : 0);
      sim.reset({ pc: CODE, sp: SP0, psw, d0: 1, d1: 2 });
      return sim.run(stops);
    };
    intc.set_test(new Map([[TEST_IRQ, IRQ.TEST_LEVEL]]));
    for (let level = 0; level < 7; level++) {
      const vector = (IRQ.VECTOR_PAGE | ivars.get(level)) >>> 0;
      for (const ie of [0, 1]) {
        for (let im = 0; im < 8; im++) {
          const psw = (ie << 11) | (im << 8) | rng.randrange(16) | rng.choice([0, 0x1000, 0x2000]);
          const r = run([0x40, 0x40, ...BREAK], psw, [vector], level);
          if (ie && level < im) {
            const frame = [...unpack('<II', sim.read(SP0 - 8, 8))];
            const got = [r.fault, r.pc, r.sp, frame, r.psw, r.insns, unpack('<H', sim.read(0x8A00, 2))[0]];
            const want = [0, vector, SP0 - 8, [psw, CODE], (psw & ~0x0F00) | (level << 8), 0, (16 + level) * 4];
            g.eq(`level ${level} IE 1 IM ${im}: accepted`, got, want);
          } else {
            g.eq(`level ${level} IE ${ie} IM ${im}: not accepted`, [r.fault, r.pc, r.sp], [5, CODE + 2, SP0]);
          }
        }
      }
    }
    let level = 5;
    let vector = (IRQ.VECTOR_PAGE | ivars.get(level)) >>> 0;
    let r = run([0x2c, 0x00, 0x0f, 0xf2, 0xf3, 0x40, 0x40, 0x40, ...BREAK], 0x0800, [vector], level);
    g.eq('mov 0x0f00,d0; mov d0,psw: accepted two instructions later', [r.pc, sim.u32(SP0 - 4), r.insns], [vector, CODE + 7, 4]);
    const store = [0xfc, 0xdc, ...le32(levelreg), 0xfc, 0xce, ...le32(1 << level), 0x68];
    r = run([0x54, ...store, 0x40, 0x40, ...BREAK], 0x0F00, [vector], level, false);
    g.eq('asl2 then the store raises the request: accepted after the inc that defines the flags',
      [r.pc, sim.u32(SP0 - 4), r.insns], [vector, CODE + 1 + store.length + 1, 5]);
    sim.write(IRQ.IVAR + 4 * 2, new Uint8Array(2));
    r = run([0x40, 0x40, ...BREAK], 0x0F00, [], 2);
    g.eq('IVAR 0: fault 1 at the interrupted pc, nothing pushed', [r.fault, r.pc, r.sp], [1, CODE, SP0]);
    sim.write(IRQ.IVAR + 4 * 2, pack('<H', ivars.get(2)));
    intc.set_gate(IRQ.GATE_PC, CODE + 2);
    vector = (IRQ.VECTOR_PAGE | ivars.get(4)) >>> 0;
    const r1 = run([0x40, 0x40, 0x40, ...BREAK], 0x0F00, [CODE + 2, vector], 4);
    const r2 = sim.run([CODE + 2, vector]);
    g.eq('gate mode 1: not accepted at CODE, a stop at the gate pc, accepted when continued from it',
      [r1.pc, r1.insns, r2.pc, sim.u32(SP0 - 4)], [CODE + 2, 2, vector, CODE + 2]);
    intc.set_gate(IRQ.GATE_OFF);
    r = run([0x40, 0x40, 0x40, ...BREAK], 0x0F00, [vector], 4);
    g.eq('gate off: never accepted', [r.fault, r.pc], [5, CODE + 3]);
    intc.set_test(new Map([[TEST_IRQ, IRQ.TEST_OFF]]));
    IRQ.cpu_store(sim, levelreg, 0);
    g.eq('no controller error', intc.errors()[0], 0);
    level = 0;
  });
  return g;
}

// ---------------------------------------------------------------- K-native helpers
function session(machine) {
  const hle = new HLE(labEnv({ machine }));
  hle.install_base_stubs();
  const prints = [];
  const pr = (name) => (hh, r) => {
    const b = hh.sim.read(r.a0, 120), z = b.indexOf(0);
    prints.push(String.fromCharCode(...(z < 0 ? b : b.subarray(0, z))));
    hh.finish(r);
  };
  for (const [a, n] of PRINTS) hle.hook(a, pr(n), n);
  return [hle, prints];
}
function isrCode(at, steps) {
  let code = [];
  for (const step of steps) {
    if (step[0] === 'log') {
      code.push(0xfc, 0xa0, ...le32(LOG));
      code.push(0x2c, ...pack('<h', step[1]));
      code.push(0x60);
      code.push(0xfc, 0xa8, ...le32(step[2]));
      code.push(0xf8, 0x10, 0x04);
      code.push(0x20, 0x08);
      code.push(0xfc, 0x80, ...le32(LOG));
    } else if (step[0] === 'set') {
      code.push(0xfc, 0xdd, ...le32(IRQ.BANKS[0] + 4 * step[1]));
      code.push(0xfc, 0xcd, ...le32(step[2]));
      code.push(0x65);
      code.push(0xcb, 0xcb, 0xcb, 0xcb);
    } else if (step[0] === 'isig_sem') {
      const [, sem, [mask, size], result] = step;
      code.push(0xf8, 0xfe, 0xfc, 0x2c, ...pack('<h', sem));
      const here = at + code.length;
      code.push(0xdd, ...pack('<i', (runtime(SVC.isig_sem) - here) | 0), mask, size);
      code.push(0xfc, 0x81, ...le32(result), 0xf8, 0xfe, 0x04);
    }
  }
  return new Uint8Array([...code, 0xf0, 0xfc]);
}
function taskFn() {
  const out = LOG + 0x100;
  const code = [0x2d, 0x00, 0x0f, 0xf2, 0xf7];
  code.push(0xfc, 0xcc, ...le32(0xD0D0D0D0));
  code.push(0xfc, 0xcd, ...le32(0xD1D1D1D1));
  const acceptAt = FN_CODE + code.length;
  code.push(0xa0, 0x00, 0xc8, 0x02, 0xcb);
  code.push(0xcb, 0xcb, 0xcb, 0xcb);
  ['d0', 'd1', 'a0', 'a1'].forEach((reg, k) => code.push(0xfc, { d0: 0x81, d1: 0x85, a0: 0x80, a1: 0x84 }[reg], ...le32(out + 4 * k)));
  code.push(0xf2, 0xe0, 0xfc, 0x81, ...le32(out + 16));
  code.push(0xdf, 0x00, 0x00);
  return [new Uint8Array(code), acceptAt, out];
}
function kNative(machine, pri = 60, allow = []) {
  const [hle, prints] = session(machine);
  const nk = new NativeKernel(hle);
  nk.boot();
  const lab = new LabTask(nk, pri, null, 0x60000, allow);
  lab.start();
  return [hle, prints, nk, lab];
}
function attach(hle, irq, level, handler) {
  const r = hle.call(IRQ.ATTACH_WRAPPER, { d0: irq, d1: level, a0: handler });
  if (r.d0) throw new FirmwareError(`attach(${irq}, ${level}) = ${r.d0}`);
}
function runTaskFn(hle, intc) {
  const [code, acceptAt, out] = taskFn();
  hle.sim.write(FN_CODE, code);
  intc.set_gate(IRQ.GATE_ANY);
  try {
    hle.call(disasm(FN_CODE), { a0: 0xA0A0A0A0, a1: 0xA1A1A1A1, lir: 0x11111111, lar: 0x1A1A1A1A }, null, [0, 0], 2000);
  } finally {
    intc.set_gate(IRQ.GATE_PC, IDLE_DONE);
  }
  return [acceptAt, [...unpack('<5I', hle.sim.read(out, 20))]];
}

// ---------------------------------------------------------------- I3
function i3(machine = {}) {
  const g = new Group('I3 priority and nesting');
  const img = loadImage();
  const [hle, , nk] = kNative(machine);
  withHle(hle, () => {
    const sim = hle.sim, intc = nk.intc;
    const table = nk.kcb(88);
    const want = REF.registration(img);
    g.eq('kcb[88][L] == the handler the image registers for L at 0x5001bdd0', range(7).map((k) => sim.u32(table + 4 * k)), range(7).map((k) => want.get(k)));
    const nest = nk.kcb(28);
    const [irq3, irq5, irq6] = [TEST_BASE + 3, TEST_BASE + 5, TEST_BASE + 6];
    const scenarios = [
      ['levels 3 and 5 together: 3 first', new Map([[irq3, [['log', 3, nest], ['set', irq3, 0]]], [irq5, [['log', 5, nest], ['set', irq5, 0]]]]),
        [irq3, irq5], [[3, 1], [5, 1]]],
      ['level 3 raised inside the level-5 handler nests, level 6 waits for the exit',
        new Map([[irq5, [['log', 5, nest], ['set', irq3, 1 << 3], ['set', irq6, 1 << 6], ['set', irq5, 0]]],
          [irq3, [['log', 3, nest], ['set', irq3, 0]]], [irq6, [['log', 6, nest], ['set', irq6, 0]]]]),
        [irq5], [[5, 1], [3, 2], [6, 1]]],
    ];
    for (const [name, handlers, raised, wantLog] of scenarios) {
      let at = ISR_CODE;
      for (const [irq, level] of [[irq3, 3], [irq5, 5], [irq6, 6]]) {
        const code = isrCode(at, handlers.get(irq) ?? [['set', irq, 0]]);
        sim.write(at, code);
        attach(hle, irq, level, at);
        at += (code.length + 15) & ~15;
      }
      for (const irq of [irq3, irq5, irq6]) if (!raised.includes(irq)) IRQ.cpu_store(sim, IRQ.BANKS[0] + 4 * irq, 0);
      sim.word(LOG, LOG + 0x10);
      sim.write(LOG + 0x10, new Uint8Array(0x40));
      intc.set_test(new Map([[irq3, IRQ.TEST_LEVEL], [irq5, IRQ.TEST_LEVEL], [irq6, IRQ.TEST_LEVEL]]));
      const acc0 = intc.accepted()[0];
      let acceptAt, stored;
      try {
        [acceptAt, stored] = runTaskFn(hle, intc);
      } catch (e) {
        if (!isFirmwareError(e)) throw e;
        g.true(name, false, e.message.slice(0, 300));
        intc.set_test(new Map([[irq3, 0], [irq5, 0], [irq6, 0]]));
        continue;
      }
      const n = Math.floor((sim.u32(LOG) - LOG - 0x10) / 8);
      let log = range(n).map((k) => unpack('<II', sim.read(LOG + 0x10 + 8 * k, 8)));
      log = log.map(([i, b]) => [i, b & 0xFF]);
      const [, acc] = intc.accepted(acc0);
      g.eq(`${name}: handler order (level, nest byte)`, log, wantLog);
      g.eq(`${name}: first acceptance at the end of the PSW window`, acc.length ? acc[0][1] : null, acceptAt);
      g.eq(`${name}: d0 d1 a0 a1 after the interrupts`, stored.slice(0, 4), [0xD0D0D0D0, 0xD1D1D1D1, 0xA0A0A0A0, 0xA1A1A1A1]);
      g.eq(`${name}: nothing presented afterwards, nest byte 0`, [intc.level_mask(), sim.read(nest, 1)[0]], [0, 0]);
      intc.set_test(new Map([[irq3, 0], [irq5, 0], [irq6, 0]]));
    }
    g.eq('no controller error', intc.errors()[0], 0);
  });
  return g;
}

// ---------------------------------------------------------------- I4
function i4(machine = {}, menu = true, gate = null) {
  const g = new Group('I4 firmware path');
  const [hle, prints] = session(machine);
  const seen = [];
  hle.hook(0x50012691, (hh, r) => { seen.push(['selftest', r.mdr]); hh.sim.run([], true); }, 'obs-selftest');
  withHle(hle, () => {
    const sim = hle.sim;
    const nk = new NativeKernel(hle);
    nk.boot();
    g.eq('boot stand-ins (H-VECINIT only besides K-OTHERCPU/K-BOOTSYNC/K-IPI/no kernel start)',
      nk.skipped.map(([s]) => s), ['H-VECINIT', 'K-BOOTSYNC', 'K-IPI', 'kernel start (not run)']);
    g.eq('the self-test 0x50012691 ran natively (and returned: boot reached idle)', seen.length, 1);
    g.eq('K-INTC native: (0x99200884), level register 325', [sim.u32(IRQ.BANKS[0] + 0x884), nk.intc.level(325)], [1, 0]);
    g.eq('kernel prints', prints, []);
    const lab = new LabTask(nk, 60, null, 0x60000, [TASK_CODE]);
    lab.start();
    const intc = nk.intc;
    const s = nk.svc('acre_sem', { a0: nk.packet(pack('<BxxxII', 1, 0, 1)) })[0];
    let prog = [], at = TASK_CODE;
    for (const [name, regs] of [['twai_sem', { d0: s, d1: -1 }], ['ext_tsk', {}]]) {
      for (const [op, reg] of [[0x2C, 'd0'], [0x2D, 'd1']]) {
        if (reg in regs) { prog.push(op, ...pack('<h', regs[reg])); at += 3; }
      }
      const [m, z] = hle.frame(SVC[name]);
      prog.push(0xdd, ...pack('<i', (runtime(SVC[name]) - at) | 0), m, z);
      at += 7;
    }
    sim.write(TASK_CODE, new Uint8Array(prog));
    const b = nk.svc('acre_tsk', { a0: nk.packet(pack('<IIIHxxII', 0, 0, TASK_CODE, 50, 0x1000, TASK_STACK - 0x1000)) })[0];
    nk.svc('act_tsk', { d0: b });
    const irq = TEST_BASE + 1;
    const result = LOG + 0x200;
    sim.word(result, 0xEEEEEEEE);
    const code = isrCode(ISR_CODE, [['isig_sem', s, hle.frame(SVC.isig_sem), result], ['set', irq, 0]]);
    sim.write(ISR_CODE, code);
    attach(hle, irq, 5, ISR_CODE);
    intc.set_test(new Map([[irq, IRQ.TEST_LEVEL]]));
    const stateB = TTS[lab.state(b)] ?? null;
    const [, stored] = runTaskFn(hle, intc);
    g.eq('B waited, then ran to ext_tsk inside the interrupt (before the RTI to the lab task)',
      [stateB, TTS[lab.state(b)] ?? null, unpack('<i', sim.read(result, 4))[0]], ['WAI', 'DMT', 0]);
    g.eq('sentinels d0 d1 a0 a1 after the interrupt', stored.slice(0, 4), [0xD0D0D0D0, 0xD1D1D1D1, 0xA0A0A0A0, 0xA1A1A1A1]);
    g.eq('lab task running, nest byte 0', [lab.current() === lab.tcb(lab.tid), sim.read(nk.kcb(28), 1)[0]], [true, 0]);
    intc.set_test(new Map([[irq, 0]]));
  });
  if (menu) {
    const [g2, depth] = i4Menu(machine, gate);
    g.problems.push(...g2.problems);
    g.cases += g2.cases;
    g.depth = depth;
  }
  return g;
}
const ISTACK_LIMIT = 6 * 1024;
function i4Menu(machine, gate = null) {
  const g = new Group('I4 menu');
  let lab = null;
  const pattern = new Uint8Array(0x2000).fill(0xa5);
  try {
    const mlab = new MenuLab(labEnv({ machine, resBlock: loadBlock() }), { key_mode: 'skip' });
    lab = mlab;
    const base = mlab.nk.kcb(112), size = mlab.nk.kcb(116);
    g.eq('kernel interrupt stack (kcb[112] base, kcb[116] size)', [base, size], [0x62E7FA00, 0x2000]);
    mlab.sim.write(base, pattern);
    mlab.bring_up('tft');
    if (gate !== null) mlab.nk.intc.set_gate(gate, IDLE_DONE);
    const acc0 = mlab.nk.intc.accepted()[0];
    mlab.open_menu();
    const osd = mlab.nk.intc.sync().filter((x) => x === IRQ.IRQ_OSD_ENGINE).length;
    const [, acc] = mlab.nk.intc.accepted(acc0);
    const where = new Set(acc.map(([, pc]) => (pc !== IDLE_DONE ? disasm(pc) : 'IDLE_DONE')));
    g.eq('menu entry: every acceptance at the idle point IDLE_DONE (H-IRQGATE)', [...where].sort(), ['IDLE_DONE']);
    const n0 = mlab.nk.intc.sync().length;
    mlab.run_to_frame(2, 'check_irq I4');
    const line = mlab.vsc.irq_line(2);
    mlab.settle('check_irq I4 vsync');
    const vsc = mlab.nk.intc.sync().slice(n0);
    const stack = mlab.sim.read(base, size);
    let first = stack.findIndex((v) => v !== 0xA5);
    if (first < 0) first = size;
    const used = size - first;
    g.true(`${osd} native OSD deliveries on the menu session`, osd > 0);
    g.eq('a TFT frame boundary is delivered natively at the idle point (IRQ 50)', [line, vsc], [1, [50]]);
    g.true(`kernel interrupt stack high-water mark ${used} bytes <= ${ISTACK_LIMIT}`, used > 0 && used <= ISTACK_LIMIT);
    return [g, used];
  } catch (e) {
    if (!isFirmwareError(e)) throw e;
    g.true('menu session', false, s400(e));
    return [g, null];
  } finally {
    if (lab) lab.close();
  }
}

// ---------------------------------------------------------------- I5
const SCR = 0xA2022000;
function i5(machine = {}) {
  const g = new Group('I5 UDF unit');
  withSim(machine, null, (sim) => {
    const run = (code, regs) => {
      sim.write(LAND, new Uint8Array(code));
      sim.reset({ pc: LAND, sp: SIM_SP, ...regs });
      return sim.run([]);
    };
    const A = 0x13579BDF, B = 0x2468ACE0, H = 0xCAFEF00D;
    for (const v of [0, V]) {
      const code = [...h('f2ffcbcb'), ...h('f511'), ...h('f50a'), ...h('f2e7'), ...h('fc8d'), ...pack('<I', SCR),
        ...h('000408'), ...h('f2f3cbcb'), ...h('f6df'), ...h('f2e4'), ...h('f6c5'), ...h('f6fa'), ...BREAK];
      const r = run(code, { d0: A, d1: B, d2: H, d3: v });
      g.eq(`T1 V=${v >> 3}: udf13 -> D, udf12 -> C, udf15 -> HI, V after udf13, flag values kept by udf21/udf20`,
        [r.fault, r.d3, r.d1, r.d2, r.d0 & V, sim.u32(SCR)], [5, B, A, H, v, v]);
    }
    for (const [name, insn, fault] of [['udf21 d0,d1', h('f511'), 6], ['udf20 d2,d2', h('f50a'), 5]]) {
      const r = run([...h('f2ffcbcb'), ...insn, ...h('f8e803'), ...BREAK], { d0: A, d1: B, d2: H, d3: V });
      g.eq(`T1d mov d3,psw ; nop ; nop ; ${name} ; bvc (reads V)`, r.fault, fault);
    }
    for (const gap of [0, 1, 2]) {
      const r = run([...h('f2ff'), ...Array(gap).fill(0xcb), ...h('f511'), ...BREAK], { d3: 8 });
      g.eq(`T1b mov d3,psw ; ${gap} nop ; udf21 (reads V)`, r.fault, gap < 2 ? 6 : 5);
    }
    let r = run([...h('f614f511'), ...BREAK], { d0: 3, d1: 5 });
    g.eq('T1c udf01 (V undefined) ; udf21', r.fault, 6);
    const rnd = newRandom(9);
    const pairs = [[3, 5], [M32, 7], [0x7FFFFFFF, 0x7FFFFFFF], [0x80000000, 0x80000000], [0x80000000, 0x7FFFFFFF], [0x12345678, 0x9ABCDEF0]];
    for (let k = 0; k < 10; k++) { const a = rnd.getrandbits(32); pairs.push([a, rnd.getrandbits(32)]); }
    const save = runtime(IRQ.SAVE), restore = runtime(IRQ.RESTORE);
    let good = 0;
    for (const [a, b] of pairs) {
      const c = [];
      const at = () => LAND + c.length;
      c.push(...h('f604'));
      c.push(...h('fc81'), ...pack('<I', SCR));
      c.push(...h('fc85'), ...pack('<I', SCR + 4));
      const fix1 = c.length;
      c.push(...h('fcdf'), 0, 0, 0, 0);
      c.push(0xdc, ...pack('<i', (save - at()) | 0));
      const ret1 = at();
      c.push(...h('f60bf50a00f51b'));
      const fix2 = c.length;
      c.push(...h('fcdf'), 0, 0, 0, 0);
      c.push(0xdc, ...pack('<i', (restore - at()) | 0));
      const ret2 = at();
      c.push(...h('fca4'), ...pack('<I', SCR));
      c.push(...h('fca5'), ...pack('<I', SCR + 4));
      c.push(...h('f6f5'), ...BREAK);
      c.splice(fix1 + 2, 4, ...pack('<I', ret1));
      c.splice(fix2 + 2, 4, ...pack('<I', ret2));
      r = run(c, { d0: a, d1: b, d2: 0x5A5A5A5A, d3: 0x77777777 });
      const [lo, hi] = REF.product64(a, b);
      const ok = deepEqual([r.fault, r.d0, r.d1, r.sp], [5, lo, hi, SIM_SP]);
      good += ok ? 1 : 0;
      if (!ok) g.problems.push(`T2 0x${hx(a)} * 0x${hx(b)}: fault ${r.fault} d0 0x${hx(r.d0)} d1 0x${hx(r.d1)}`);
    }
    g.eq('T2 HI across the firmware save/restore with HI and the unit clobbered in between', good, pairs.length);
  });
  withHle(new HLE(labEnv({ machine })), (hle) => {
    try {
      const r = hle.call(0x50012691, null, null, [0, 0], 10);
      g.eq('T3 self-test 0x50012691 natively (break(-112) on a mismatch)', [r.fault, r.insns > 50], [0, true]);
    } catch (e) {
      if (!isFirmwareError(e)) throw e;
      g.true('T3 self-test 0x50012691 natively', false, e.message.slice(0, 200));
    }
  });
  return g;
}

// ---------------------------------------------------------------- I6
function i6(machine = {}) {
  const g = new Group('I6 interrupt controller');
  const img = loadImage();
  const [op, clamp] = REF.attachClamp(img);
  g.eq('attach clamp constant (0x5002e947 mov imm8,d0)', [op, clamp], [0x80, 6]);
  withHle(new HLE(labEnv({ machine })), (hle) => {
    const sim = hle.sim;
    install_core_index(sim, 0);
    const intc = new IRQ.IntcDebug(sim);
    const handler = 0xA2300400;
    for (const [irq, level] of [[TEST_BASE, 0], [TEST_BASE + 1, 3], [TEST_BASE + 2, 6], [TEST_BASE + 3, 7]]) {
      attach(hle, irq, level, handler + 4 * level);
      const want = 1 << Math.min(level, clamp);
      g.eq(`attach(irq ${irq}, level ${level}): banks 0..3, handler table, shadow`,
        [range(4).map((k) => intc.bank_level(k, irq)), sim.u32(IRQ.HANDLER_TABLE + 4 * irq), sim.u32(IRQ.SHADOW_MASK + 4 * irq)],
        [[want, 0, 0, 0], handler + 4 * level, want]);
    }
    let e0 = intc.errors()[0];
    try {
      IRQ.cpu_store(sim, IRQ.BANKS[0] + 4 * TEST_BASE, 3);
      g.true('a level register value that is not one-hot faults', false);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      const [total, errs] = intc.errors();
      g.eq('a non-one-hot level register write is a bus error and recorded', [total - e0, errs.at(-1).name], [1, 'LEVEL_VALUE']);
    }
    const cpuRead = (address) => {
      sim.write(0x1000, bytes(0xfc, 0xa4, le32(address), BREAK));
      sim.reset({ pc: 0x1000, sp: SP0 });
      return sim.run();
    };
    const a = TEST_BASE + 1, b = TEST_BASE + 4;
    attach(hle, b, 3, handler);
    const p0 = intc.presented()[0];
    intc.set_test(new Map([[b, IRQ.TEST_LEVEL]]));
    let r = cpuRead(IRQ.BANKS[0] + 0x700 + 4 * 3);
    g.eq('presented at level 3: (irq + 1) * 4', [r.fault, r.d0], [5, (b + 1) * 4]);
    intc.set_test(new Map([[a, IRQ.TEST_LEVEL], [b, IRQ.TEST_LEVEL]]));
    r = cpuRead(IRQ.BANKS[0] + 0x700 + 4 * 3);
    g.eq('two IRQs at one level: the lower number first (A-INTC-ORDER)', r.d0, (a + 1) * 4);
    g.eq('other levels and banks present nothing', [sim.u32(IRQ.BANKS[0] + 0x700 + 4 * 5), sim.u32(IRQ.BANKS[1] + 0x700 + 4 * 3)], [0, 0]);
    const [, rows] = intc.presented(p0);
    g.eq('presented ring: the two CPU reads (irq, level, pc), debugger reads not logged',
      rows.map(([i, lv, pc]) => [i, lv, pc]), [[b, 3, 0x1000], [a, 3, 0x1000]]);
    hle.call(0x5002E9B0, { d0: a });
    g.eq('0x5002e9b0(irq) disables: level register 0, presentation falls to the next IRQ',
      [intc.level(a), sim.u32(IRQ.BANKS[0] + 0x700 + 12)], [0, (b + 1) * 4]);
    hle.call(0x5002E9F3, { d0: a });
    g.eq('0x5002e9f3(irq) re-enables from the shadow table', intc.level(a), 1 << 3);
    intc.set_test(new Map([[a, 0], [b, 0]]));
    g.eq('lines low: nothing presented, no CPU request', [intc.level_mask(), intc.u32(IRQ.D_REQUEST)], [0, 0]);
    e0 = intc.errors()[0];
    r = cpuRead(IRQ.BANKS[0] + 0x600);
    g.eq('unknown offset 0x600: bus error, recorded', [r.fault, intc.errors()[0] - e0, intc.errors()[1].at(-1).name], [2, 1, 'UNKNOWN']);
    e0 = intc.errors()[0];
    r = cpuRead(IRQ.DEBUG + IRQ.D_MAGIC);
    g.eq('lab window: a CPU read returns its RAM (magic INTC) and is not recorded (a ROM device)',
      [r.fault, r.d0, intc.errors()[0] - e0], [5, 0x43544E49, 0]);
    try {
      IRQ.cpu_store(sim, IRQ.DEBUG + IRQ.D_MAGIC, 0);
      g.true('lab window: a CPU write faults', false);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      const [total, errs] = intc.errors();
      g.eq('lab window: a CPU write faults, is recorded and changes nothing',
        [total - e0, errs.at(-1).name, intc.u32(IRQ.D_MAGIC)], [1, 'DEBUG_CPU', 0x43544E49]);
    }
    IRQ.cpu_store(sim, IRQ.BANKS[1] + 0x810, 1);
    g.eq('0x810 stored and counted, 0x884 stored', [sim.u32(IRQ.BANKS[1] + 0x810), intc.u32(IRQ.D_IPI_WRITES)], [1, 1]);
    try {
      intc.set_test(new Map([[IRQ.IRQ_OSD_ENGINE, IRQ.TEST_LEVEL]]));
      g.true('a test line on a device-driven IRQ is refused', false);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      g.true('a test line on a device-driven IRQ is refused', true);
    }
  });
  return g;
}

// ---------------------------------------------------------------- I7
const PROGRAM = 0x5006449B, START = 0x500644FA;
const CHAN_TABLE = 0x6011E3D8, MASK_TABLE = 0x6011E240, IRQ_TABLE = 0x6011E680;
const I7_CHANNELS = new Map([[5, 1], [6, 999], [7, 2000], [8, 12345]]);
const I7_START = 7_345_678;
function i7(machine = {}) {
  const g = new Group('I7 timer');
  const img = loadImage();
  withHle(new HLE(labEnv({ machine })), (hle) => {
    const sim = hle.sim;
    install_core_index(sim, 0);
    const timer = new IRQ.TimerDebug(sim), intc = new IRQ.IntcDebug(sim);
    const ref = new Map();
    for (const [ch] of I7_CHANNELS) {
      const [ctl, rel, , ie, status] = REF.rtData(img, CHAN_TABLE + 20 * ch, '<5I');
      const [mask, , ack] = REF.rtData(img, MASK_TABLE + 12 * ch, '<3I');
      const irq = REF.rtData(img, IRQ_TABLE + 8 * ch, '<IBB')[2];
      ref.set(ch, { irq, mask, ack, ctl, reload: rel, ie, status });
      g.eq(`channel ${ch}: image tables give IRQ 137 + n and mask bit n - 1`, [irq, mask, ack, ctl, rel],
        [137 + ch, 1 << (ch - 1), 1 << (ch - 1), IRQ.TIMER + 4 * ch, IRQ.TIMER + 0x100 + 4 * ch]);
    }
    g.eq('lab clock moved before the channels start (a channel started after boot)', [IRQ.run_to_event(sim, I7_START), timer.time()], [0, I7_START]);
    const t0 = timer.time();
    for (const [ch, reload] of I7_CHANNELS) {
      const r = hle.call(PROGRAM, { d0: ch, d1: 0, a0: 0xA2300400, a1: reload }, null, null, 200);
      g.eq(`0x5006449b(ch ${ch}, reload ${reload}) returns 0, ctl 0x40, reload`,
        [r.d0, timer.channel(ch).ctl, timer.channel(ch).reload, timer.channel(ch).running], [0, 0x40, reload, 0]);
    }
    for (const [ch] of I7_CHANNELS) {
      hle.call(START, { d0: ch }, null, null, 200);
      const c = timer.channel(ch);
      g.eq(`0x500644fa(ch ${ch}): ctl 0x80, running from t0 = T, period (reload + 1) us (A-TMR-1/2)`,
        [c.ctl, c.running, c.t0, c.period], [0x80, 1, t0, (I7_CHANNELS.get(ch) + 1) * 1000]);
    }
    let masks = 0;
    for (const v of ref.values()) masks += v.mask;
    g.eq('IE has the four channel masks', timer.ie() & masks, masks);
    const horizon = t0 + 30_000_000;
    const want = REF.timerSchedule(t0, I7_CHANNELS, horizon).map(([t, chs]) => [t, new Set(chs)]);
    const got = [];
    let statusOk = true, lineOk = true, bitsOk = true;
    // the channels acked (W1C) after each expiry, in this order: 8 first, as the recorded runs did (channel 5 is never
    // acked: it overruns)
    const ACKS = [8, 6, 7];
    const counts = new Map([...I7_CHANNELS.keys()].map((ch) => [ch, 0]));
    for (;;) {
      const src = IRQ.run_to_event(sim, horizon);
      const now = timer.time();
      if (!(src & 2)) break;
      const fired = [];
      for (const [ch] of I7_CHANNELS) {
        const n = timer.channel(ch).expiries;
        if (n !== counts.get(ch)) { fired.push(ch); counts.set(ch, n); }
      }
      got.push([now, new Set(fired)]);
      bitsOk = bitsOk && fired.every((ch) => (timer.status() >>> (ch - 1)) & 1);
      for (const ch of ACKS) if (fired.includes(ch)) IRQ.cpu_store(sim, ref.get(ch).status, ref.get(ch).ack);
      let ackMask = 0;
      for (const ch of ACKS) ackMask += ref.get(ch).mask;
      statusOk = statusOk && !(timer.status() & ackMask);
      lineOk = lineOk && intc.line(ref.get(5).irq)[0];
    }
    g.eq('every RUN_TO_EVENT stops at the next reference expiry with exactly the channels expiring there', got, want);
    g.true('each expiry set its channel\'s status bit', bitsOk);
    g.true('W1C acks cleared the acked channels\' status bits', statusOk);
    const n5 = want.filter(([, chs]) => chs.has(5)).length;
    g.eq('channel 5 (reload 1, never acked): expiries and overruns', [timer.channel(5).expiries, timer.channel(5).overruns], [n5, n5 - 1]);
    g.true('channel 5 line high while its status bit is set and IE has it', lineOk);
    IRQ.cpu_store(sim, ref.get(5).ie, timer.ie() & ~ref.get(5).mask);
    g.eq('IE bit cleared: the line drops, status stays', [intc.line(ref.get(5).irq)[0], (timer.status() >>> 4) & 1], [false, 1]);
    IRQ.cpu_store(sim, ref.get(5).status, ref.get(5).ack);
    g.eq('status W1C on channel 5', (timer.status() >>> 4) & 1, 0);
    const e0 = timer.errors()[0];
    sim.write(0x1000, bytes(0xfc, 0xa4, le32(IRQ.TIMER + 0x200 + 4 * 5), BREAK));
    sim.reset({ pc: 0x1000, sp: SP0 });
    let r = sim.run();
    g.eq('a channel counter read (0x214) is a bus error, recorded', [r.fault, timer.errors()[0] - e0], [2, 1]);
    sim.write(0x1000, bytes(0xfc, 0xa4, le32(IRQ.TIMER_DEBUG + IRQ.T_MAGIC), BREAK));
    sim.reset({ pc: 0x1000, sp: SP0 });
    r = sim.run();
    g.eq('lab window: a CPU read returns its RAM (magic TIMR) and is not recorded (a ROM device)',
      [r.fault, r.d0, timer.errors()[0] - e0], [5, 0x524D4954, 1]);
    try {
      IRQ.cpu_store(sim, IRQ.TIMER_DEBUG + IRQ.T_MAGIC, 0);
      g.true('lab window: a CPU write faults', false);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      g.eq('lab window: a CPU write faults, is recorded and changes nothing',
        [timer.errors()[0] - e0, sim.u32(IRQ.TIMER_DEBUG + IRQ.T_MAGIC)], [2, 0x524D4954]);
    }
    sim.write(0x1000, bytes(0xfc, 0xa4, le32(IRQ.TIMER + 0x284), BREAK));
    sim.reset({ pc: 0x1000, sp: SP0 });
    const c0 = sim.u32(IRQ.TIMER + 0x284);
    r = sim.run();
    g.eq('channel 33 (0x284): one less per CPU read, debugger reads change nothing (H-USCOUNT)',
      [r.d0, sim.u32(IRQ.TIMER + 0x284), sim.u32(IRQ.TIMER + 0x284)], [c0, c0 - 1, c0 - 1]);
    try {
      IRQ.cpu_store(sim, IRQ.TIMER + 4 * 9, 0x81);
      g.true('a ctl value other than 0x00/0x40/0x80/0xC0 is an error', false);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      g.true('a ctl value other than 0x00/0x40/0x80/0xC0 is an error', true);
    }
  });
  return g;
}

// ---------------------------------------------------------------- I8
function i8(machine = {}) {
  const g = new Group('I8 kernel tick');
  const [hle, , nk, lab] = kNative(machine, 60);
  withHle(hle, () => {
    const sim = hle.sim;
    const timer = new IRQ.TimerDebug(sim);
    const r = hle.call(0x5003121C, null, null, null, 2000);
    g.eq('0x5003121c returns 0; channel 1 runs at 1 ms; IRQ 138 at level 5 -> 0x50031198',
      [r.d0, timer.channel(1).period, nk.intc.level(138), sim.u32(IRQ.HANDLER_TABLE + 4 * 138)], [0, 1_000_000, 1 << 5, runtime(0x50031198)]);
    lab.time_mode = true;
    let e0 = timer.channel(1).expiries;
    const s0 = system_time(lab), t0 = timer.time();
    const log = lab.elapse_until(t0 + 10_000_000, () => timer.time(), (limit) => IRQ.run_to_event(sim, limit));
    const e1 = timer.channel(1).expiries, s1 = system_time(lab);
    g.eq('elapse 10 ms: system time grows by the channel-1 expiries (one kernel tick each)', [s1 - s0, e1 - e0], [10, 10]);
    g.eq('one acceptance per tick, no overrun', [log.filter((x) => x === 'irq').length, timer.channel(1).overruns], [10, 0]);
    lab.on_idle = () => { IRQ.run_to_event(sim, timer.time() + 5_000_000); return 'again'; };
    e0 = timer.channel(1).expiries;
    const rc = nk.svc('dly_tsk', { d0: 3 })[0];
    const ticks = timer.channel(1).expiries - e0;
    lab.on_idle = null;
    g.eq('dly_tsk(3) returns E_OK after 3 or 4 ticks (uITRON 4.0: at least the given time)', [rc, ticks === 3 || ticks === 4], [0, true]);
    g.depth = null;
  });
  return g;
}

// ---------------------------------------------------------------- I9
function i9(machine = {}) {
  const g = new Group('I9 us clock (A-USLAB)');
  withHle(new HLE(labEnv({ machine })), (hle) => {
    const sim = hle.sim;
    install_core_index(sim, 0);
    const reload = 0x7FFFFFFF;
    sim.write(0x1000, bytes(0xfc, 0xa4, le32(IRQ.TIMER + 0x284), BREAK));
    const cpuRead = () => { sim.reset({ pc: 0x1000, sp: SP0 }); const r = sim.run(); return r.fault === 5 ? r.d0 : null; };
    g.eq('USMODE defaults to 0', sim.u32(IRQ.TIMER_DEBUG + IRQ.T_USMODE), 0);
    const a = cpuRead();
    IRQ.run_to_event(sim, 3_000_000);
    const b = cpuRead();
    g.eq('USMODE 0 (H-USCOUNT): one less per CPU read, lab time does not count', [a, b], [reload, reload - 1]);
    sim.write(IRQ.TIMER_DEBUG + IRQ.T_USMODE, pack('<I', 1));
    const t = new IRQ.TimerDebug(sim).time();
    const want = REF.uslab(reload, t, 2);
    const d1 = sim.u32(IRQ.TIMER + 0x284), d2 = sim.u32(IRQ.TIMER + 0x284);
    const c = cpuRead();
    g.eq('USMODE 1 at 3 ms: lab us + reads; debugger reads change nothing', [d1, d2, c], [want, want, want]);
    IRQ.run_to_event(sim, 3_000_000 + 12_345_678);
    const t2 = new IRQ.TimerDebug(sim).time();
    const d = cpuRead(), e = cpuRead();
    const want2 = REF.uslab(reload, t2, 3);
    g.eq('USMODE 1 after 12.345678 ms more: the count fell by the lab us and one per read', [d, e], [want2, want2 - 1]);
    g.true('monotonic: every read below the one before', a > b && b > c && c > d && d > e);
    sim.write(IRQ.TIMER_DEBUG + IRQ.T_USMODE, pack('<I', 0));
    g.eq('back to USMODE 0: the H-USCOUNT count (reads only)', cpuRead(), reload - 5);
  });
  return g;
}

// ---------------------------------------------------------------- I10
function i10(machine = {}) {
  const g = new Group('I10 inter-CPU doorbell (A-IPI)');
  const img = loadImage();
  const desc = REF.ipiDescriptors(img);
  const regs = REF.ipiRegisters(img);
  g.eq('doorbell registers 0x60092dd4[target] = the banks\' +0x808', [...regs], [...IRQ.BANKS.map((b) => b + 0x808)]);
  const [hle, , nk, lab] = kNative(machine, 60);
  const errs = [];
  withHle(hle, () => {
    const sim = hle.sim, intc = nk.intc;
    if (!hle.hooks.has(runtime(ERRLOG))) hle.hook(ERRLOG, (hh, r) => { errs.push(r.d0); hh.finish(r); }, 'errlog (recorded)');
    g.eq('interrupt controller window version 2 (+0x808 model)', intc.version(), 2);
    g.eq('IRQ 324 line driven by the model (test lines refused there)', intc.line(IRQ.IRQ_IPI), [false, false, true]);
    let pool = sim.read(IRQ.IPI_POOL, IRQ.IPI_POOL_SIZE);
    g.eq('pre-condition: the 16 KiB at 0xa325a998 are still BSS 0 before H-IPIINIT', pool.every((v) => v === 0), true);
    let r = hle.call(IRQ.IPI_INIT, null, null, null, 20000);
    g.eq('H-IPIINIT 0x5002ce4d natively: d0 0, bank-0 level of IRQ 324 = 1 << 2, CPU 0 handler 0x5002d83a',
      [r.d0, intc.level(IRQ.IRQ_IPI), sim.u32(IRQ.HANDLER_TABLE + 4 * IRQ.IRQ_IPI)], [0, 1 << 2, runtime(IRQ.IPI_HANDLER0)]);
    pool = sim.read(IRQ.IPI_POOL, IRQ.IPI_POOL_SIZE);
    const u = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
    g.eq('0x5002de2d: 256 entries of 64 bytes with +0 = 63 and +52 = 0 (0x5002de41..47)',
      range(256).every((k) => u(pool, 64 * k) === 63 && u(pool, 64 * k + 52) === 0), true);
    sim.write(ISR_CODE, bytes(0xfc, 0x80, le32(LOG), 0xf0, 0xfc));
    sim.word(LOG, 0xEEEEEEEE);
    const [wp, rp, ring, bit] = desc.get('0,0');
    const w0 = sim.read(wp, 1)[0];
    r = hle.call(IRQ.IPI_POST, { d0: 0, a0: ISR_CODE, a1: 0x1234ABCD }, null, null, 2000);
    g.eq('post(0, f, arg) from core 0: d0 0, ring [0][0] entry {f, arg} at its write index, index + 1, bank-0 pending = the descriptor bit, line 324 high, level 2 presented',
      [r.d0, [...unpack('<II', sim.read(ring + 8 * w0, 8))], sim.read(wp, 1)[0], intc.ipi_pending(0), intc.line(IRQ.IRQ_IPI)[0], intc.present_now().get(2) ?? null],
      [0, [ISR_CODE, 0x1234ABCD], (w0 + 1) % 32, bit, true, IRQ.IRQ_IPI]);
    const seen = [];
    const observer = (name) => (hh, regs2) => { seen.push([name, name === 'drain' ? regs2.a0 : null]); hh.sim.run([], true); };
    hle.hook(IRQ.IPI_HANDLER0, observer('handler'), 'obs-ipi-handler');
    hle.hook(IRQ.IPI_DRAIN[bit], observer('drain'), 'obs-ipi-drain');
    const acc0 = intc.accepted()[0];
    lab.settle(() => 0, () => false);
    const [, acc] = intc.accepted(acc0);
    g.eq('settle: the CPU accepts level 2 once at the idle point; 0x5002d83a, then the drain 0x50035be0 ran',
      [acc.map(([lv, pc]) => [lv, pc]), seen.map(([n]) => n)], [[[2, IDLE_DONE]], ['handler', 'drain']]);
    g.eq('f ran with a0 = arg; pending 0 (the handler acked through +0x80c), line low, read index = write index',
      [sim.u32(LOG), intc.ipi_pending(0), intc.line(IRQ.IRQ_IPI)[0], sim.read(rp, 1)[0]], [0x1234ABCD, 0, false, (w0 + 1) % 32]);
    hle.hooks.delete(runtime(IRQ.IPI_HANDLER0));
    hle.hooks.delete(runtime(IRQ.IPI_DRAIN[bit]));
    const bit2 = desc.get('2,0')[3];
    const x0 = intc.xcpu()[0];
    r = hle.call(IRQ.IPI_POST, { d0: 2, a0: ISR_CODE, a1: 7 }, null, null, 2000);
    const [, rows] = intc.xcpu(x0);
    g.eq('post(2, f, 7): bank-2 pending = the descriptor bit, no line, nothing presented, xcpu ring {2, bit, 0x50035bd1}',
      [r.d0, intc.ipi_pending(2), intc.line(IRQ.IRQ_IPI)[0], intc.level_mask(), rows.map(([bb, v, pc]) => [bb, v, pc])],
      [0, bit2, false, 0, [[2, bit2, runtime(IRQ.IPI_STORE)]]]);
    intc.ipi_request(2, 0, bit2);
    g.eq('doorbell cmd 2 clears bank 2', intc.ipi_pending(2), 0);
    const e0 = errs.length;
    r = hle.call(IRQ.IPI_POST, { d0: 4, a0: ISR_CODE, a1: 0 }, null, null, 2000);
    g.eq('post(4, ...): -1 and errlog 0x43006001 (0x50035b04..0x50035b23)', [r.d0, errs.slice(e0)], [0xFFFFFFFF, [0x43006001]]);
    let nOk = 0;
    for (let k = 0; k < 32; k++) {
      r = hle.call(IRQ.IPI_POST, { d0: 3, a0: ISR_CODE, a1: k }, null, null, 2000);
      nOk += r.d0 === 0 ? 1 : 0;
    }
    g.eq('32 posts to target 3 with no drain: 31 accepted, the 32nd -1 and errlog 0x43006002 (ring full)',
      [nOk, r.d0, errs.slice(e0 + 1)], [31, 0xFFFFFFFF, [0x43006002]]);
    intc.ipi_request(3, 0, 0xFFFFFFFF);
    g.eq('no controller error', intc.errors()[0], 0);
  });
  withHle(new HLE(labEnv({ machine })), (hle2) => {
    const sim = hle2.sim;
    install_core_index(sim, 0);
    const intc = new IRQ.IntcDebug(sim);
    const cpu = (code) => { sim.write(0x1000, bytes(code, BREAK)); sim.reset({ pc: 0x1000, sp: SP0 }); return sim.run(); };
    IRQ.cpu_store(sim, IRQ.BANKS[1] + 0x808, 0x50);
    IRQ.cpu_store(sim, IRQ.BANKS[1] + 0x808, 0x10);
    let r = cpu([0xfc, 0xa4, ...le32(IRQ.BANKS[1] + 0x808)]);
    g.eq('+0x808 ORs (0x50, then 0x10: one repeat counted), a CPU read returns the bits, debugger reads too',
      [r.fault, r.d0, sim.u32(IRQ.BANKS[1] + 0x808), intc.u32(IRQ.D_IPI_REPEATS)], [5, 0x50, 0x50, 1]);
    IRQ.cpu_store(sim, IRQ.BANKS[1] + 0x80C, 0x40);
    // JS-only fault point (checks/lib/pred.mjs, for I10): a second store clears every pending bit of bank 1
    if (fault('ipi-80c-clear-all')) IRQ.cpu_store(sim, IRQ.BANKS[1] + 0x80C, 0xFFFFFFFF);
    g.eq('+0x80c clears the written bits', intc.ipi_pending(1), 0x10);
    const e0 = intc.errors()[0];
    r = cpu([0xfc, 0xdc, ...le32(IRQ.BANKS[1] + 0x808), 0xf0, 0x70]);
    const [total, rows] = intc.errors();
    g.eq('a u16 write to +0x808 is a bus error, recorded UNKNOWN', [r.fault, total - e0, rows.at(-1).name], [2, 1, 'UNKNOWN']);
  });
  return g;
}

const GROUPS = { I1: i1, I2: i2, I3: i3, I4: i4, I5: i5, I6: i6, I7: i7, I8: i8, I9: i9, I10: i10 };
const MUTANTS = new Map([
  [20, ['RTI pops PC and PSW swapped', 'I1']],
  [21, ['acceptance ignores IM', 'I2']],
  [22, ['the vector ignores IVAR', 'I2']],
  [23, ['acceptance picks the highest level number', 'I3']],
  [24, ['RTI opens a PSW write window', 'I3']],
  [25, ['udf21 swaps Dm and Dn', 'I5']],
  [26, ['udf13 leaves V undefined', 'I5']],
  [27, ['the controller presents the highest IRQ first', 'I6']],
  [28, ['timer period = reload', 'I7']],
  [29, ['timer status writes ignored', 'I7']],
  [30, ['A-USLAB ignores lab time', 'I9']],
  [31, ['+0x80c does not clear the pending bits', 'I10']],
]);
// machine: the machine options of every lab the group makes (added to the run's, labEnv)
function runGroup(name, machine = {}, kw = {}) {
  try {
    return name === 'I4' && 'menu' in kw ? GROUPS[name](machine, kw.menu) : GROUPS[name](machine);
  } catch (e) {
    if (!(e instanceof RuntimeError || e instanceof AssertionError)) throw e;
    const g = new Group(name);
    g.problems.push(`stopped: ${s400(e)}`);
    return g;
  }
}

function main(argv) {
  const a = parseArgs('check_irq.mjs', argv, [{ opt: '--mutants', type: 'flag' }, { opt: '--only', type: 'str' }]);
  const t0 = performance.now();
  const secs = () => Math.round((performance.now() - t0) / 1000);
  if (a.mutants) {
    const missed = [];
    let g = i4({}, true, IRQ.GATE_ANY);
    let caught = g.problems.length > 0;
    console.log(`[${caught ? 'ok' : 'FAIL'}] harness mutant gate mode 2 (acceptance anywhere) on the I4 menu session: ${g.problems.length} problem(s)${g.problems.length ? ': ' + g.problems[0].slice(0, 160) : ''}`);
    if (!caught) missed.push('gate-any');
    for (const [value, [what, group]] of MUTANTS) {
      g = runGroup(group, { mutant: value }, group === 'I4' ? { menu: false } : {});
      caught = g.problems.length > 0;
      console.log(`[${caught ? 'ok' : 'FAIL'}] mutant ${value} (${what}) -> ${group}: ${g.problems.length} problem(s)${g.problems.length ? ': ' + g.problems[0].slice(0, 120) : ''}`);
      if (!caught) missed.push(value);
    }
    console.log(`${!missed.length ? 'all mutants detected' : `MISSED ${show(missed)}`} (${secs()} s)`);
    return missed.length ? 1 : 0;
  }
  const names = a.only ? a.only.split(',') : Object.keys(GROUPS);
  const unknown = names.filter((n) => !Object.hasOwn(GROUPS, n));
  if (unknown.length) a.error(`--only: unknown group(s) ${unknown.join(', ')} (${Object.keys(GROUPS).join(', ')})`);
  let bad = 0;
  for (const name of names) {
    const g = runGroup(name);
    const extra = g.depth ? `; kernel interrupt stack high-water mark ${g.depth} bytes` : '';
    console.log(`[${!g.problems.length ? 'ok' : 'FAIL'}] ${g.name}: ${g.cases} checks${extra}`);
    for (const p of g.problems.slice(0, 12)) console.log('      ' + p);
    bad += g.problems.length ? 1 : 0;
  }
  console.log(`${!bad ? 'all groups passed' : 'FAILED'} (${bad} problem(s), ${secs()} s)`);
  return bad ? 1 : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) runMain('check_irq.mjs', main);
