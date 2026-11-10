// The imgpro unit's model (src/dev/imgpro.mjs S-IMGPRO; docs/om1-imgpro-spec.md, docs/hle-gaps.md 4.3.1) on a bare
// machine, with the register writes in the order the firmware's driver makes them: the unit's init (0x5050a6b2), kind
// 14's start, set-up and go (0x5050a797, 0x5050b118, 0x5050a8ba), the handler's acknowledge (0x5048bfe3) and the end
// (0x5050a8e1). Checks: the register file and the bus errors around it, a start refused while powered down, without
// +0x00c, with a fill word not written since the last start, with another operation, mode or +0x39c, with a phase the
// model does not read and off the bus's memory; the rectangle fill of the menu's request (X: 600 rows of 1800 bytes at
// a pitch of 11136 into a live-view bank, 0x800b800b) and the linear fill both ways the fill 0x5048ee61 splits it,
// their bytes written and the end raised RUN_NS of lab time after the start (A-IMGPRO-1), the IRQ while the end and the
// enable are set, the status write 1 to clear. The firmware's own driver on the model runs in test_camapp.mjs
// (traRoutingSession, control camapp 3).
//   node emu/test/test_imgpro.mjs
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { RUN_NS } from '../src/dev/imgpro.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const tester = () => { const bad = []; let checks = 0; return { bad, get checks() { return checks; }, ok: (c, what) => { checks++; if (!c) bad.push(what); } }; };

export function imgproUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { imgpro: u, intc, clock, bus } = m.devices, irq = BOARD.imgpro.irq;
  m.stderr = () => {};
  const rd = (o, w = 4) => u.read(o, w, false), wr = (o, v, w = 4) => u.write(o, v, w, false);
  const mem = (a, n) => { const b = new Uint8Array(n); bus.read(a, b); return [...b]; };
  ok(u !== undefined && u.cfg.base === 0x9C600000 && irq === 300 && !u.touched, 'the machine builds the unit on the E143 board with IRQ 300, untouched');
  // the unit's init (0x5050a6b2): +0x004, +0x030, +0x070, +0x000
  for (const o of [0x004, 0x030, 0x070, 0x000]) wr(o, 1);
  ok(!u.powered && rd(0x000) === 1 && rd(0x030) === 1 && rd(0x020) === 0 && rd(0x028) === 0, 'the init leaves it powered down, its words read back, status and enable 0');
  ok([0x010, 0x014, 0x01c, 0x024, 0x02c, 0x050, 0x078, 0x07c, 0x0cc, 0x0f8, 0x100, 0x104, 0x10c, 0x37c, 0x3b4, 0xffc].every((o) => throwsAs(() => rd(o), BUS)),
    'an address the driver does not name is a bus error');
  ok(throwsAs(() => rd(0x3b0), BUS), 'kind 16\'s result +0x3b0 reads as a bus error: no run computes it');
  // kind 14's rectangle fill as the menu's request (X): the start's words, the set-up's, the go's
  const go = () => { wr(0x028, 1); wr(0x020, 1); wr(0x00c, 1); wr(0x018, 1); };
  const rect = (dst, pitch, x, bytes, rows, value) => {
    wr(0x108, 3); wr(0x398, value); wr(0x084, (dst >>> 4)); wr(0x0b8, pitch >>> 4); wr(0x380, 5); wr(0x390, x); wr(0x394, (rows << 16 | bytes) >>> 0); wr(0x39c, 0);
  };
  const BANK = 0x98D4D800, PITCH = 11136, BYTES = 1800, ROWS = 600, PAIR = 0x800B800B;
  rect(BANK, PITCH, 0, BYTES, ROWS, PAIR);
  ok(throwsAs(() => wr(0x018, 1), BUS) && u.runs === 0, '+0x018 without +0x00c since the last start is a bus error');
  ok(throwsAs(go, BUS) && u.runs === 0, 'a start while powered down is a bus error');
  for (const o of [0x004, 0x040, 0x048, 0x074]) wr(o, 1);
  rect(BANK, PITCH, 0, BYTES, ROWS, PAIR);
  const t0 = clock.t;
  go();
  ok(u.runs === 1 && u.busy() && rd(0x020) === 0 && intc.line[irq] === 0 && mem(BANK, 4).every((b) => b === 0), 'the go starts a run: no end yet, IRQ low, nothing written');
  ok(throwsAs(() => { wr(0x00c, 1); wr(0x018, 1); }, BUS), 'a second start while the run is in progress is a bus error');
  clock.advance(t0 + RUN_NS - 1, false);
  ok(u.busy() && intc.line[irq] === 0, 'still running 1 ns before RUN_NS');
  clock.advance(t0 + RUN_NS, false);
  const lastRow = BANK + (ROWS - 1) * PITCH, pair = [0x0b, 0x80, 0x0b, 0x80];
  ok(!u.busy() && rd(0x020) === 1 && intc.line[irq] === 1, 'after RUN_NS: the end bit and IRQ 300 high');
  ok(JSON.stringify(mem(BANK, 8)) === JSON.stringify([...pair, ...pair]) && JSON.stringify(mem(lastRow + BYTES - 4, 4)) === JSON.stringify(pair)
    && mem(BANK + BYTES, 4).every((b) => b === 0) && mem(BANK + PITCH - 4, 4).every((b) => b === 0) && mem(lastRow + PITCH, 4).every((b) => b === 0),
    'the 600 rows of 1800 bytes hold the pair 0b 80 0b 80; the bytes between the rows and after the last stay 0');
  const r = u.last();
  ok(r.op === 3 && r.mode === 5 && r.dst === BANK && r.bytes === BYTES && r.rows === ROWS && r.pitch === PITCH && r.value === PAIR, `the run's record: ${JSON.stringify(r)}`);
  // the handler (0x5048bfe8..f8, 0x5048c059): the status and'ed with the enable written back, the enable 0
  wr(0x020, rd(0x020) & rd(0x028));
  ok(rd(0x020) === 0 && intc.line[irq] === 0, 'the status written back clears it and the IRQ drops');
  wr(0x028, 0); wr(0x028, 1);
  ok(intc.line[irq] === 0, 'the end\'s enable with no end bit keeps the IRQ low');
  for (const o of [0x008, 0x070, 0x04c, 0x044, 0x000]) wr(o, 1);
  ok(!u.powered && rd(0x000) === 1, 'the end powers it down');
  // the linear fill (0x5050b18c..b3): the fill 0x5048ee61's simple path, an unaligned start below 64 in its 128-byte
  // line with the memset value 0 over bytes already written
  const D = 0xA0100000;
  bus.write(D, new Uint8Array(1024).fill(0xee));
  const linear = (dst, bytes, value) => { wr(0x108, 3); wr(0x084, dst >>> 4); wr(0x380, 4); wr(0x384, bytes); wr(0x390, dst & 127); wr(0x398, value); };
  wr(0x004, 1);
  linear(D + 5, 100, 0); go(); clock.advance(clock.t + RUN_NS, false);
  ok(mem(D + 4, 1)[0] === 0xee && mem(D + 5, 100).every((b) => b === 0) && mem(D + 105, 1)[0] === 0xee, 'a linear fill writes its 100 bytes from the unaligned address, the bytes around stay');
  wr(0x020, 1);
  // the split path (0x5048ee8a..ee): the aligned middle, then the head as a one-row rectangle at a pitch of 128
  const H = D + 512;
  linear(H + 128, 64, 0x5a5a5a5a); go(); clock.advance(clock.t + RUN_NS, false); wr(0x020, 1);
  rect(H, 128, 96, 32, 1, 0x5a5a5a5a); go(); clock.advance(clock.t + RUN_NS, false); wr(0x020, 1);
  ok(mem(H + 95, 1)[0] === 0xee && mem(H + 96, 96).every((b) => b === 0x5a) && mem(H + 192, 1)[0] === 0xee, 'the aligned middle and the head\'s one-row rectangle meet');
  // refusals at the start (a refused start keeps the words written since the last run)
  wr(0x108, 3); wr(0x380, 4); wr(0x084, D >>> 4); wr(0x390, 0); wr(0x398, 0);
  ok(throwsAs(go, BUS), 'a linear fill whose +0x384 was not written since the last start is refused');
  linear(D + 2, 8, 0x800b800b);
  ok(throwsAs(go, BUS), 'a value whose bytes differ at an address off a 4-byte boundary is refused (its phase is not read)');
  ok(throwsAs(() => wr(0x00c, 2), BUS) && throwsAs(() => wr(0x018, 0), BUS), 'the start pair takes 1 only');
  linear(D + 64, 8, 0); wr(0x084, (D + 0x20) >>> 4);
  ok(throwsAs(go, BUS), 'a linear fill whose +0x084 and +0x390 name different addresses is refused');
  linear(D, 8, 0); wr(0x380, 8);
  ok(throwsAs(go, BUS), 'another mode (kind 16\'s 8) is refused');
  linear(D, 8, 0); wr(0x108, 0);
  ok(throwsAs(go, BUS), 'another operation (+0x108 other than 3) is refused');
  rect(D, 128, 0, 8, 1, 0); wr(0x39c, 1);
  ok(throwsAs(go, BUS), 'a rectangle fill with +0x39c other than 0 is refused');
  linear(0x90000000, 8, 0);
  ok(throwsAs(go, BUS), 'a fill off the bus\'s memory is refused');
  rect(D, 64, 0, 128, 2, 0);
  ok(throwsAs(go, BUS), 'rows longer than their pitch are refused');
  ok(u.runs === 4 && !u.busy(), `none of the refused starts ran (${u.runs} runs)`);
  ok(throwsAs(() => wr(0x084, 1, 2), BUS) && throwsAs(() => rd(0x086), BUS) && throwsAs(() => u.write(0x084, 1, 4, true), BUS) && throwsAs(() => rd(0x084, 1), BUS)
    && throwsAs(() => wr(0x028, 2), BUS),
    'a halfword, an unaligned word, a debugger write, a byte read and an enable bit other than bit 0 are bus errors');
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['imgpro unit', imgproUnits()]];
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
