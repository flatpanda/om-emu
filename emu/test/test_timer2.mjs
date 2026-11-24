// The E118 family's second timer unit (src/dev/timer2.mjs, docs/model-survey.md finding 155), without firmware: the
// device on the lab clock with a recording controller, driven through its register handlers in the order E122's driver
// writes them (D there: the early init 0x50001df6, the start 0x500640ba and arm 0x50064118, the ISR 0x5006427a).
// The init's writes are taken; channel 0 armed with the software timer driver's reload 0x21 at the lab's clock words
// (both 0: 16384 Hz) expires at 33 counts (A-TMR2-1, 2014160 ns), sets its status bit and raises the IRQ only with its
// IE bit (A-TMR2-4); the ISR's sequence lowers it and re-arms the channel from that instant; a channel left running
// expires every period (A-TMR2-2); a status write clears only the bits written 1 (A-TMR2-3); the clock block's other
// selection (24 MHz / ((0x98800008 + 1) x 2)) gives the period; and what the model does not know is UNKNOWN, a bus
// error with the error counted: a ctl value other than 0 and 1, a reload above 1023, bits of no channel, a read of
// ctl + 8, a start with no reload written, and a start where the clock block cannot be read.
//   node emu/test/test_timer2.mjs
import { Clock } from '../src/dev/timer.mjs';
import { Timer2 } from '../src/dev/timer2.mjs';
import { BUS } from '../src/core/mem.mjs';

const CFG = { ctl: 0x10, stride: 12, channels: 10, status: 0xC4, ie: 0xDC, irq: 24,
  clock: { select: 0x9880004C, slow: [32768, 0x98800004], fast: [24000000, 0x98800008] } };

// a device at base (each test its own: the regions stay in the page table of the process until a machine is made)
function rig(base, words = {}) {
  const lines = new Map(), driven = new Set(), errs = [];
  const intc = { drive: (irq) => driven.add(irq), setLine: (irq, level) => lines.set(irq, level) };
  const machine = { stderr: (l) => errs.push(l) };
  const clock = new Clock(), clockWords = new Map(Object.entries(words).map(([a, v]) => [Number(a), v]));
  const t = new Timer2(machine, clock, intc, { ...CFG, base }, (a) => (clockWords.has(a) ? clockWords.get(a) : 0));
  const w = (off, v) => { try { t.write(off, v, 4, false); return 'ok'; } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
  const r = (off) => { try { return t.read(off, 4, false); } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
  return { t, clock, lines, driven, errs, w, r, line: () => lines.get(24) === true, clockWords };
}

export function timer2Units() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const PERIOD = Math.round(33 * 1e9 / 16384);
  {
    const x = rig(0x8F000000);
    ok(x.driven.has(24), 'the device drives IRQ 24');
    // the early init: status 1023, IE 0, every channel ctl 0, reload 1, ctl + 8 0
    const init = [x.w(0xC4, 1023), x.w(0xDC, 0)];
    for (let n = 0; n < 10; n++) init.push(x.w(0x10 + 12 * n, 0), x.w(0x14 + 12 * n, 1), x.w(0x18 + 12 * n, 0));
    ok(init.every((s) => s === 'ok') && x.r(0xC4) === 0 && x.r(0xDC) === 0 && x.r(0x14) === 1 && x.errs.length === 0, `the early init's writes: ${init.filter((s) => s !== 'ok').length} refused, ${x.errs.join('; ')}`);
    // the start and the arm of channel 0: reload 0x21, status cleared, IE bit 0, ctl 1
    x.w(0x14, 0x21); x.w(0xC4, 1); x.w(0xDC, x.r(0xDC) | 1); x.w(0x10, 1);
    ok(x.t.hz() === 16384 && x.t.ch[0].period === PERIOD && x.t.ch[0].next === PERIOD, `channel 0: ${x.t.hz()} Hz, period ${x.t.ch[0].period} ns (${PERIOD}), next ${x.t.ch[0].next}`);
    x.clock.advance(PERIOD - 1, false);
    ok(x.r(0xC4) === 0 && !x.line(), `before its period: status ${x.r(0xC4)}, line ${x.line()}`);
    x.clock.advance(PERIOD, false);
    ok(x.r(0xC4) === 1 && x.line(), `at its period: status ${x.r(0xC4)}, line ${x.line()}`);
    // the ISR: IE bit cleared, ctl 0, the mask to status, then reload, IE and ctl 1 again (a periodic entry)
    x.w(0xDC, x.r(0xDC) & ~1);
    ok(!x.line() && x.r(0xC4) === 1, `IE cleared: line ${x.line()}, status ${x.r(0xC4)} kept`);
    x.w(0x10, 0); x.w(0xC4, 1); x.w(0x14, 0x21); x.w(0xDC, x.r(0xDC) | 1); x.w(0x10, 1);
    ok(x.r(0xC4) === 0 && !x.line() && x.t.ch[0].next === 2 * PERIOD, `re-armed: status ${x.r(0xC4)}, line ${x.line()}, next ${x.t.ch[0].next}`);
    // left running: it expires every period (A-TMR2-2); a status write clears only the bits written 1 (A-TMR2-3)
    x.w(0x20, 0x21); x.w(0x1C, 1); x.w(0xDC, 3);
    x.clock.advance(3 * PERIOD, false);
    ok(x.t.ch[0].expiries === 3 && x.r(0xC4) === 3 && x.line(), `three periods on: ${x.t.ch[0].expiries} expiries, status ${x.r(0xC4)}`);
    x.w(0xC4, 2);
    ok(x.r(0xC4) === 1 && x.line(), `status 2 written: status ${x.r(0xC4)}, line ${x.line()}`);
    x.w(0xC4, 1);
    ok(x.r(0xC4) === 0 && !x.line(), `status 1 written: status ${x.r(0xC4)}, line ${x.line()}`);
    // UNKNOWN: a bus error, the error counted
    const e0 = x.t.errors.length;
    const refused = [['ctl 2', x.w(0x10, 2)], ['reload 0x400', x.w(0x14, 0x400)], ['status bit 10', x.w(0xC4, 0x400)], ['IE bit 10', x.w(0xDC, 0x400)],
      ['ctl + 8 read', x.r(0x18)], ['ctl + 8 written 1', x.w(0x18, 1)], ['a halfword', (() => { try { x.t.read(0x10, 2, false); return 'read'; } catch (e) { return e === BUS ? 'BUS' : 'other'; } })()]];
    ok(refused.every(([, s]) => s === 'BUS') && x.t.errors.length === e0 + refused.length, `UNKNOWN accesses: ${refused.map(([k, s]) => `${k} ${s}`).join(', ')}; ${x.t.errors.length - e0} errors`);
  }
  {
    // the clock block's other selection: 24 MHz / ((0x98800008 + 1) x 2)
    const x = rig(0x8F010000, { 0x9880004C: 1, 0x98800008: 11 });
    const none = x.w(0x1C, 1), e = x.t.errors.length;
    ok(none === 'BUS' && e === 1 && !x.t.ch[1].running, `ctl 1 with no reload written: ${none}, ${e} error`);
    x.w(0x14, 1000); x.w(0x10, 1);
    ok(x.t.hz() === 1000000 && x.t.ch[0].period === 1000000, `24 MHz / 24: ${x.t.hz()} Hz, period ${x.t.ch[0].period} ns`);
  }
  {
    // the clock block not readable: the start is UNKNOWN
    const lines = new Map(), clock = new Clock();
    const t = new Timer2({ stderr: () => {} }, clock, { drive: () => {}, setLine: (i, l) => lines.set(i, l) }, { ...CFG, base: 0x8F020000 }, () => null);
    t.write(0x14, 0x21, 4, false);
    let s = 'ok';
    try { t.write(0x10, 1, 4, false); } catch (e) { s = e === BUS ? 'BUS' : 'other'; }
    ok(s === 'BUS' && !t.ch[0].running && t.errors.length === 1, `ctl 1 with the clock block unreadable: ${s}, running ${t.ch[0].running}`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = timer2Units();
  console.log(`the second timer unit: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
