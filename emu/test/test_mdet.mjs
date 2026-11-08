// The DML engine's model (src/dev/dml.mjs S-DML; docs/om1-subject-spec.md 2.1, 5.2):
//   dmlUnits (pure)  the engine's register file on a bare machine: storage and read-back, a start refused while powered
//                    down, the register image kept per start, the output area zeroed, the completion after RUN_NS of
//                    lab time with status bit 14 and IRQ 285, the write-1-to-clear status, the refusals
//   node emu/test/test_mdet.mjs
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { RUN_NS, S_DONE, CLASSES, RECORD } from '../src/dev/dml.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

export function dmlUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { dml, intc, bus, clock } = m.devices, irq = BOARD.dml.irq;
  const rd = (o, w = 4) => dml.read(o, w, false), wr = (o, v, w = 4) => dml.write(o, v, w, false);
  ok(dml !== undefined && dml.cfg.base === BOARD.dml.base && dml.runs === 0, 'the machine builds the engine on the E143 board');
  wr(0x400, 0x12345678);
  ok(rd(0x400) === 0x12345678 && rd(0x004) === 0, 'a register keeps its write; the status reads 0');
  wr(0x1118, 0xa3000000 >>> 4); wr(0x111c, 32);
  ok(throwsAs(() => wr(0x010, 1), BUS) && dml.runs === 0, 'a start before the power-up is a bus error');
  for (const o of [0x1408, 0x1418, 0x140c, 0x141c]) wr(o, 1);
  const out = 0xa3000000, bytes = CLASSES * 32 * RECORD;
  bus.write(out, new Uint8Array(bytes + 16).fill(0xa5));
  const t0 = clock.t;
  wr(0x010, 1);
  const got = new Uint8Array(bytes + 16); bus.read(out, got);
  ok(got.subarray(0, bytes).every((b) => b === 0) && got.subarray(bytes).every((b) => b === 0xa5), `the start zeroes the ${bytes}-byte output area and nothing past it`);
  const im = dml.last();
  ok(im.n === 1 && im.regs[0x400] === 0x12345678 && im.regs[0x111c] === 32 && im.regs[0x1408] === 1 && !(0x010 in im.regs) && im.out[0] === out && im.out[1] === bytes,
    `the run's image holds the writes since the last start: ${JSON.stringify(Object.keys(im.regs))}`);
  ok(dml.busy() && !dml.pending() && intc.line[irq] === 0, 'running: no completion yet, IRQ low');
  ok(throwsAs(() => wr(0x010, 1), BUS), 'a start while a run is in progress is a bus error');
  clock.advance(t0 + RUN_NS - 1, false);
  ok(dml.busy() && intc.line[irq] === 0, 'still running 1 ns before RUN_NS');
  clock.advance(t0 + RUN_NS, false);
  ok(!dml.busy() && rd(0x004) === S_DONE && intc.line[irq] === 1, `after RUN_NS: status bit 14 and IRQ ${irq} high (status 0x${rd(0x004).toString(16)})`);
  wr(0x004, rd(0x004));
  ok(rd(0x004) === 0 && intc.line[irq] === 0, 'the status written back clears it and the IRQ drops');
  wr(0x500, 7); wr(0x010, 1);
  const im2 = dml.last();
  ok(im2.n === 2 && JSON.stringify(Object.keys(im2.regs)) === JSON.stringify([String(0x500)]), `the second run's image holds only the writes since the first: ${JSON.stringify(im2.regs)}`);
  clock.advance(clock.t + RUN_NS, false);
  wr(0x004, S_DONE);
  for (const o of [0x1400, 0x1410, 0x1404, 0x1414]) wr(o, 1);
  ok(throwsAs(() => wr(0x010, 1), BUS), 'a start after the power-down is a bus error');
  for (const o of [0x1408, 0x1418, 0x140c, 0x141c]) wr(o, 1);
  wr(0x1118, 0x90000000 >>> 4);
  ok(throwsAs(() => wr(0x010, 1), BUS), 'an output area outside the DRAM is a bus error');
  wr(0x1118, out >>> 4);
  ok(throwsAs(() => wr(0x010, 2), BUS) && throwsAs(() => rd(0x004, 2), BUS) && throwsAs(() => wr(0x401, 1), BUS) && throwsAs(() => dml.write(0x400, 1, 4, true), BUS),
    'a start of another value, a halfword, an unaligned word and a debugger write are bus errors');
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['DML engine units', dmlUnits()]];
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
