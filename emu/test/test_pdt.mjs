// The PDT / TRC unit's model (src/dev/pdt.mjs S-PDT; docs/om1-subject-spec.md 2.2, 5.8) on a bare machine: the
// register file the drivers use as storage and every other address a bus error, the resets a start is refused under,
// a start of either engine keeping its parameter image, setting its result registers from the lab's source (0 where it
// gives none) and completing after RUN_NS of lab time with status bit 0 and its own IRQ (279 PDT, 278 TRC), the
// write-1-to-clear status, the result registers refused to writes, the refusals of widths, unaligned and debugger
// accesses and of a second start while one runs. The firmware's own drivers on the model run in test_mdet.mjs
// (pdtDrivers).
//   node emu/test/test_pdt.mjs
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { RUN_NS, S_DONE, ENGINES } from '../src/dev/pdt.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

export function pdtUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { pdt, intc, clock } = m.devices, irqs = BOARD.pdt.irqs;
  m.stderr = () => {};
  const rd = (o, w = 4) => pdt.read(o, w, false), wr = (o, v, w = 4) => pdt.write(o, v, w, false);
  ok(pdt !== undefined && pdt.cfg.base === BOARD.pdt.base && irqs.pdt === 279 && irqs.trc === 278, 'the machine builds the unit on the E143 board with IRQs 279 (PDT) and 278 (TRC)');
  wr(0x108, 0x12345678); wr(0x2020, 5); wr(0x3600, 6);
  ok(rd(0x108) === 0x12345678 && rd(0x2020) === 5 && rd(0x3600) === 6 && rd(0x010) === 0 && rd(0x2008) === 0, 'registers keep their writes; the flush word and the status read 0');
  ok([0x008, 0x0fc, 0x120, 0x170, 0x1000, 0x2260, 0x25d8, 0x35a8, 0x3630, 0x3ffc].every((o) => throwsAs(() => rd(o), BUS)),
    'an address the drivers do not use is a bus error');
  wr(0x301c, 1);
  ok(throwsAs(() => wr(0x3018, 1), BUS) && pdt.e.trc.runs === 0, 'a start while the unit is held in reset (its open not made) is a bus error');
  // the open's writes (trac_drv_open 0x507fa1e9, trc_drv_open 0x507fa9ee): resets released
  for (const o of [0x000, 0x3000, 0x2000, 0x004, 0x3004]) wr(o, 0);
  wr(0x3014, rd(0x3014) | 1); wr(0x3018, rd(0x3018) | 2);
  ok(!pdt.busy('trc') && pdt.e.trc.runs === 0, 'the open\'s bit 1 of TRC\'s +0x018 starts nothing');
  // a TRC start (trc_drv_start 0x507fab96): +0x00c 1, +0x004 1, the parameters, +0x004 0, +0x018 1
  pdt.e.trc.source = (p) => ({ 0x3338: 0xabcd0001, 0x35a4: p[0x301c] + 1 });
  wr(0x300c, 1); wr(0x3004, 1); wr(0x301c, 41); wr(0x3334, 7); wr(0x3004, 0);
  const t0 = clock.t;
  wr(0x3018, 1);
  const im = pdt.last('trc');
  ok(im.n === 1 && im.params[0x301c] === 41 && im.params[0x3334] === 7 && im.params[0x3600] === 6 && !(0x3018 in im.params) && im.result === 2,
    `the run's image holds the parameter writes since the last start: ${JSON.stringify(im.params)}`);
  ok(rd(0x3338) === 0xabcd0001 && rd(0x35a4) === 42 && rd(0x3400) === 0, 'the result registers hold the source\'s words, the rest 0');
  ok(pdt.busy('trc') && !pdt.pending('trc') && intc.line[irqs.trc] === 0 && !pdt.busy('pdt'), 'running: no completion yet, IRQ 278 low, PDT idle');
  ok(throwsAs(() => wr(0x3018, 1), BUS), 'a second start while the run is in progress is a bus error');
  ok(throwsAs(() => wr(0x3338, 1), BUS), 'a write to a result register is a bus error');
  clock.advance(t0 + RUN_NS - 1, false);
  ok(pdt.busy('trc') && intc.line[irqs.trc] === 0, 'still running 1 ns before RUN_NS');
  clock.advance(t0 + RUN_NS, false);
  ok(!pdt.busy('trc') && rd(0x3008) === S_DONE && intc.line[irqs.trc] === 1 && intc.line[irqs.pdt] === 0, `after RUN_NS: status bit 0 and IRQ 278 high, 279 low (status 0x${rd(0x3008).toString(16)})`);
  wr(0x3008, rd(0x3008));
  ok(rd(0x3008) === 0 && intc.line[irqs.trc] === 0, 'the status written back clears it and the IRQ drops');
  // a PDT start without a source: its results 0
  wr(0x2018, 1);
  ok(pdt.busy('pdt') && rd(0x2200) === 0 && rd(0x225c) === 0 && pdt.last('pdt').params[0x2020] === 5, 'a PDT start with no source: its result registers 0, its image kept');
  clock.advance(clock.t + RUN_NS, false);
  ok(intc.line[irqs.pdt] === 1 && rd(0x2008) === S_DONE && intc.line[irqs.trc] === 0, 'the PDT run completes on IRQ 279 alone');
  wr(0x2008, S_DONE);
  wr(0x3018, 1);
  ok(Object.keys(pdt.last('trc').params).length === 0, 'a second TRC run\'s image holds only the writes since the first');
  clock.advance(clock.t + RUN_NS, false);
  wr(0x3008, S_DONE);
  pdt.e.trc.source = () => ({ 0x3000: 1 });
  ok(throwsAs(() => wr(0x3018, 1), Error), 'a source word outside the engine\'s results is the lab\'s error');
  pdt.e.trc.source = null;
  // the close (trc_drv_close 0x507faac9, trac_drv_close 0x507fa60d): resets held
  wr(0x3004, 1); wr(0x004, 1); wr(0x3000, 1); wr(0x000, 1);
  ok(throwsAs(() => wr(0x3018, 1), BUS), 'a start after the close is a bus error');
  ok(throwsAs(() => wr(0x2020, 1, 2), BUS) && throwsAs(() => rd(0x2022), BUS) && throwsAs(() => pdt.write(0x2020, 1, 4, true), BUS) && throwsAs(() => rd(0x3338, 1), BUS),
    'a halfword, an unaligned word, a debugger write and a byte read are bus errors');
  ok(Object.keys(ENGINES).join() === 'pdt,trc', 'two engines');
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['PDT / TRC unit', pdtUnits()]];
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
