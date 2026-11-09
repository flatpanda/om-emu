// The EMS1 engine's model (src/dev/ems1.mjs S-EMS1; docs/om1-subject-spec.md 2.4, 5.9) on a bare machine: the register
// file the driver uses as storage and every other address a bus error, the tables that read back what was written, a
// start refused while the engine is powered down, a start keeping its parameter image and completing after RUN_NS of
// lab time with each run channel's status bit and IRQ 276, the write-1-to-clear status, the result RAMs from the lab's
// source (0 where it gives none) and refused to writes, a nonzero block trigger refused, and the refusals of widths,
// unaligned and debugger accesses and of a second start while one runs. The firmware's own driver on the model runs in
// test_mdet.mjs (ems1Driver).
//   node emu/test/test_ems1.mjs
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { RUN_NS, chBit, RESULT, RESULT_STRIDE, TABLES } from '../src/dev/ems1.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

export function ems1Units() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { ems1, intc, clock } = m.devices, irq = BOARD.ems1.irq;
  m.stderr = () => {};
  const rd = (o, w = 4) => ems1.read(o, w, false), wr = (o, v, w = 4) => ems1.write(o, v, w, false);
  ok(ems1 !== undefined && ems1.cfg.base === BOARD.ems1.base && irq === 276 && rd(0x000) === 3, 'the machine builds the engine on the E143 board with IRQ 276, powered down');
  // the power-up's writes (0x501a5bd1): the state 2, the power words
  wr(0x000, 2); for (const o of [0x31c, 0x324, 0x310, 0x318]) wr(o, 1);
  wr(0x014, 0x12345678); wr(0x0d4, 5); wr(0x2a8, 6); wr(0x440, 7); wr(0x5e4, 8); wr(0x1308, 9); wr(0x186c, 1);
  ok(rd(0x014) === 0x12345678 && rd(0x0d4) === 5 && rd(0x2a8) === 6 && rd(0x440) === 7 && rd(0x5e4) === 8 && rd(0x1308) === 9 && rd(0x004) === 0,
    'registers keep their writes (common, power, channels 1 and 4, the clock table); the status reads 0');
  ok([0x00c, 0x024, 0x0cc, 0x0fc, 0x054, 0x1e4, 0x30, 0x2ac, 0x32c, 0x1820, 0x3000, 0x4ea0, 0x6800].every((o) => throwsAs(() => rd(o), BUS)),
    'an address the driver does not use is a bus error (channel 0 has no +0x1e4)');
  for (const [a, n] of TABLES) { wr(a, 0xa0000000 + n); wr(a + 4 * (n - 1), n); }
  ok(TABLES.every(([a, n]) => rd(a) === 0xa0000000 + n && rd(a + 4 * (n - 1)) === n) && throwsAs(() => rd(0x4000 + 4 * 936), BUS) && throwsAs(() => rd(0x6800), BUS),
    'the four tables read back their words, up to 936, 936, 256 and 256 words');
  ok(throwsAs(() => wr(0x008, chBit(1) | 0x2000000), BUS) && ems1.runs === 0, 'a start while the state word is 2 (not the start\'s 0) is a bus error');
  // a start of channels 1 and 3 (0x501a5cbd): +0x000 0, +0x008 0, the parameters, +0x008 the start word
  ems1.source = (k, p) => (k === 1 ? { 0: 0x03ff1234, 1023: p[0x440] + 1 } : {});
  wr(0x000, 0); wr(0x008, 0); wr(0x444, 11); wr(0xc40, 12);
  const t0 = clock.t, word = chBit(1) | chBit(3) | 0x2000000 | 0x18000000;
  wr(0x008, word);
  const im = ems1.last();
  ok(im.n === 1 && im.channels === 0b1010 && im.start === word && im.params[0x444] === 11 && im.params[0xc40] === 12 && im.params[0x014] === 0x12345678 && !(0x008 in im.params),
    `the run's image holds the parameter writes since the last start: ${JSON.stringify(im.params)}`);
  const r1 = RESULT + RESULT_STRIDE;
  ok(rd(r1) === 0x03ff1234 && rd(r1 + 4 * 1023) === 8 && rd(r1 + 4) === 0 && rd(RESULT + 3 * RESULT_STRIDE) === 0, 'channel 1\'s result RAM holds the source\'s words, the rest 0');
  ok(ems1.busy() && !ems1.pending() && intc.line[irq] === 0, 'running: no completion yet, IRQ low');
  ok(throwsAs(() => wr(0x008, word), BUS), 'a second start while the run is in progress is a bus error');
  ok(throwsAs(() => wr(r1, 1), BUS) && throwsAs(() => wr(0x018, 0x10), BUS), 'a write to a result RAM and a nonzero block trigger are bus errors');
  wr(0x018, 0);
  clock.advance(t0 + RUN_NS - 1, false);
  ok(ems1.busy() && intc.line[irq] === 0, 'still running 1 ns before RUN_NS');
  clock.advance(t0 + RUN_NS, false);
  ok(!ems1.busy() && rd(0x004) === (chBit(1) | chBit(3)) && intc.line[irq] === 1, `after RUN_NS: the bits of channels 1 and 3 and IRQ 276 high (status 0x${rd(0x004).toString(16)})`);
  wr(0x004, chBit(1));
  ok(rd(0x004) === chBit(3) && intc.line[irq] === 1, 'one bit written back clears it alone; the IRQ stays high');
  wr(0x004, rd(0x004));
  ok(rd(0x004) === 0 && intc.line[irq] === 0, 'the status written back clears it and the IRQ drops');
  // the handler's stop: +0x008 0, +0x000 2
  wr(0x008, 0); wr(0x000, 2);
  ok(!ems1.busy() && ems1.runs === 1 && rd(0x000) === 2, 'the handler\'s stop words start nothing');
  wr(0x000, 0);
  ems1.source = null;
  wr(0x008, chBit(0) | 0x2000000);
  ok(Object.keys(ems1.last().params).length === 0 && rd(RESULT) === 0, 'a second run\'s image holds only the writes since the first; no source, its results 0');
  clock.advance(clock.t + RUN_NS, false);
  ok(rd(0x004) === chBit(0), 'channel 0 alone completes on its bit');
  wr(0x004, chBit(0));
  ems1.source = () => ({ 1024: 1 });
  ok(throwsAs(() => wr(0x008, chBit(2)), Error), 'a source word past the RAM is the lab\'s error');
  ems1.source = null;
  ok(throwsAs(() => wr(0x0d4, 1, 2), BUS) && throwsAs(() => rd(0x0d6), BUS) && throwsAs(() => ems1.write(0x0d4, 1, 4, true), BUS) && throwsAs(() => rd(r1, 1), BUS),
    'a halfword, an unaligned word, a debugger write and a byte read are bus errors');
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['EMS1 engine', ems1Units()]];
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
