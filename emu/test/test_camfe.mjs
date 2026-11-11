// S-CAMFE, the camera front end's control plane as cam.c's second init programs it (src/dev/camfe.mjs; docs/hle-gaps.md
// 4.2.5), on a bare machine: the program's 256 registers by block, a write of a value the program holds kept and any
// other value refused, A-CAMFE-1's read-before-write registers (0, then what was written; the init's |= 1, |= 2, |= 4
// and &= ~bit read back), A-CAMFE-2's start bit (+0xa08 of the clock block reads 0 after its write of 1), the reads of
// write-only registers (the clock gates among them) and of addresses outside the program refused, widths, unaligned and
// debugger accesses refused, no interrupt line driven, and a second device over the same blocks refused.
//   node emu/test/test_camfe.mjs
import { fileURLToPath } from 'node:url';
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { CamFe, PROGRAM, RMW, POLL } from '../src/dev/camfe.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

export function camFeUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const lines = [];
  m.stderr = (s) => lines.push(s);
  const fe = new CamFe(m), { intc } = m.devices;
  const rd = (a, w = 4) => fe.read(a >>> 0, w, false), wr = (a, v, w = 4) => fe.write(a >>> 0, v, w, false);
  const regs = PROGRAM.reduce((n, [, r]) => n + r.length, 0), pairs = PROGRAM.reduce((n, [, r]) => n + r.reduce((k, x) => k + x.length - 1, 0), 0);
  ok(PROGRAM.length === 15 && regs === 256 && pairs === 330 && fe.allowed.size === 256 && RMW.length === 15,
    `the program: ${PROGRAM.length} blocks, ${regs} registers, ${pairs} values, ${RMW.length} read-before-write registers`);
  // the clock block's first writes (0x50163717..0x5016378e) and a clock gate (0x5015ff22: 0x2000 at a count of 0)
  wr(0x9B500000, 0); wr(0x9B500010, 3); wr(0x9B500020, 0x703F); wr(0x9B500800, 0x2000); wr(0x9B500800, 0x40);
  ok(fe.regs.get(0x9B500010) === 3 && fe.regs.get(0x9B500020) === 0x703F && fe.regs.get(0x9B500800) === 0x40 && fe.writes === 5,
    'a write of a value the program holds is kept (the last one)');
  ok([[0x9B500010, 2], [0x9B500800, 0x4000], [0x9B500800, 0x41], [0x9B382044, 0], [0x9B500004, 0], [0x9A801C38, 1]].every(([a, v]) => throwsAs(() => wr(a, v), BUS)),
    'a value the program does not write, and a register outside it (AWB1\'s status 0x9b382044 among them), are bus errors');
  // A-CAMFE-1: the read-modify-writes of 0x9a801c00.. (|= 1, |= 2, |= 4), 0x9b000000 / 0x9b080000 (&= ~8),
  // 0x9b000a08 (&= ~0x10000000)
  let v = rd(0x9A801C00); wr(0x9A801C00, v | 1); v = rd(0x9A801C00); wr(0x9A801C00, v | 2); v = rd(0x9A801C00); wr(0x9A801C00, v | 4);
  ok(rd(0x9A801C00) === 7 && rd(0x9A801C04) === 0, 'a read-before-write register reads 0, then what was written (A-CAMFE-1)');
  wr(0x9B000000, rd(0x9B000000) & ~8); wr(0x9B000A08, rd(0x9B000A08) & ~0x10000000);
  ok(rd(0x9B000000) === 0 && rd(0x9B000A08) === 0 && rd(0x9B080000) === 0, 'the sync generators\' &= ~bit words read 0 and keep 0');
  ok(throwsAs(() => wr(0x9A801C00, 0xF), BUS), 'a read-modify-write that sets a bit the program does not set is a bus error');
  // A-CAMFE-2: +0xa08 of the clock block, written 1 and polled until it does not read 1 (0x5016381a..0x5016382c)
  ok(rd(POLL) === 0, 'the clock block\'s start word reads 0 before its write');
  wr(POLL, 1);
  ok(fe.regs.get(POLL) === 1 && rd(POLL) === 0 && rd(POLL) === 0, 'written 1, it reads 0 at the next read (A-CAMFE-2)');
  ok([0x9B500800, 0x9B500808, 0x9B500010, 0x98280198, 0x9A801C18, 0x9B300000].every((a) => throwsAs(() => rd(a), BUS)),
    'a register the init only writes (the clock gates among them) is a bus error to read');
  ok([0x9B000004, 0x9B380044, 0x9B382044, 0x9B500028, 0x9A801C3C, 0x9B181028].every((a) => throwsAs(() => rd(a), BUS)),
    'a status register the units\' handlers read (0x9b000004, 0x9b380044, 0x9b382044, 0x9b500028, ...) is a bus error: not modelled');
  ok(throwsAs(() => rd(0x9A801C00, 2), BUS) && throwsAs(() => wr(0x9B500010, 3, 2), BUS) && throwsAs(() => rd(0x9A801C02), BUS)
    && throwsAs(() => fe.write(0x9B500010, 3, 4, true), BUS), 'a halfword, an unaligned address and a debugger write are bus errors');
  const n = fe.reads;
  ok(fe.read(0x9A801C00, 4, true) === 7 && fe.reads === n && n === 13, `a debugger read of a readable register has no side effect and is not counted (${n} CPU reads)`);
  ok(lines.length > 0 && lines.every((l) => /^om-emu: om1\.camfe UNKNOWN (read|write) 0x[0-9a-f]{8} size \d/.test(l)), `each refused CPU access is printed: ${lines.slice(0, 2)}`);
  ok([15, 16, 17, 18, 19, 26, 32, 34, 37, 40, 243].every((irq) => intc.line[irq] === 0 && !intc.driven[irq]), 'no interrupt line is driven');
  ok(throwsAs(() => new CamFe(m), Error), 'a second device over the same blocks is refused');
  return t;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = camFeUnits();
  console.log(`S-CAMFE: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
