// S-CAMFE, the camera front end's control plane as cam.c's second init programs it (src/dev/camfe.mjs; docs/hle-gaps/4.2.md
// 4.2.5), on a bare machine: the program's 256 registers by block, a write of a value the program holds kept and any
// other value refused, A-CAMFE-1's read-before-write registers (0, then what was written; the init's |= 1, |= 2, |= 4
// and &= ~bit read back), A-CAMFE-2's start bit (+0xa08 of the clock block reads 0 after its write of 1), the reads of
// write-only registers (the clock gates among them) and of addresses outside the program refused, widths, unaligned and
// debugger accesses refused, no interrupt line driven, and a second device over the same blocks refused. And the
// power-on's clock enables (docs/hle-gaps/4.2.md 4.2.6; POWER_ON): the gate +0x870 = 1, +0x008 = 0x700 beside the init's
// 0x100, cam_cpm.c's |= 0x10 of +0x9a0 and +0x9e0 (A-CAMFE-1: 0, then what was written), any other value or gate
// refused. And SSG1's command unit (docs/hle-gaps/4.2.md 4.2.6, 2026-11-22; camfe.mjs SSG): its configuration words,
// +0x60c (A-CAMFE-4), a mode-0 batch and a mode-1 entry by +0xa04 bit 8, each ending after A-CAMFE-3's lab time on
// status bit 21 / 20 with IRQ 18 high under the mask +0x014, the write-back that clears it, and its refusals (the
// sensor's reply +0xa10, a busy start, a bad start word, the RAM read or past 120 entries), each by name. And
// camFeSsgSession: the same unit under the firmware in a session (below).
//   node emu/test/test_camfe.mjs
import { fileURLToPath } from 'node:url';
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { CamFe, PROGRAM, RMW, POLL, POWER_ON, POWER_RMW, SSG, RUN_NS, ENTRY_NS } from '../src/dev/camfe.mjs';

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
  ok([0x9B080004, 0x9B380044, 0x9B382044, 0x9B500028, 0x9A801C3C, 0x9B181028].every((a) => throwsAs(() => rd(a), BUS)),
    'a status register the units\' handlers read (0x9b080004, 0x9b380044, 0x9b382044, 0x9b500028, ...; SSG1\'s 0x9b000004 apart, below) is a bus error: not modelled');
  ok(throwsAs(() => rd(0x9A801C00, 2), BUS) && throwsAs(() => wr(0x9B500010, 3, 2), BUS) && throwsAs(() => rd(0x9A801C02), BUS)
    && throwsAs(() => fe.write(0x9B500010, 3, 4, true), BUS), 'a halfword, an unaligned address and a debugger write are bus errors');
  const n = fe.reads;
  ok(fe.read(0x9A801C00, 4, true) === 7 && fe.reads === n && n === 13, `a debugger read of a readable register has no side effect and is not counted (${n} CPU reads)`);
  // the power-on's clock enables (0x501609f6, 0x5015fb32, 0x50165955..0x50165962)
  const pregs = POWER_ON.reduce((k, [, r]) => k + r.length, 0);
  wr(0x9B500870, 1); wr(0x9B500008, 0x700); wr(0x9B500008, 0x100); wr(0x9B500008, 0x700);
  wr(0x9B5009A0, rd(0x9B5009A0) | 0x10); wr(0x9B5009E0, rd(0x9B5009E0) | 0x10);
  ok(POWER_ON.length === 1 && pregs === 4 && fe.power.size === 4 && POWER_RMW.length === 2 && fe.regs.get(0x9B500870) === 1
    && fe.regs.get(0x9B500008) === 0x700 && rd(0x9B5009A0) === 0x10 && rd(0x9B5009E0) === 0x10,
    `the power-on's clock enables are kept (${pregs} registers): +0x870 ${fe.regs.get(0x9B500870)}, +0x008 ${fe.regs.get(0x9B500008)}, +0x9a0 ${fe.regs.get(0x9B5009A0)}, +0x9e0 ${fe.regs.get(0x9B5009E0)}`);
  ok([[0x9B500870, 2], [0x9B500878, 1], [0x9B500004, 0x700], [0x9B5009A0, 0x30], [0x9B5009A4, 0x10]].every(([a, x]) => throwsAs(() => wr(a, x), BUS))
    && throwsAs(() => rd(0x9B500870), BUS) && throwsAs(() => rd(0x9B500008), BUS),
    'another value, the gates\' other words (+0x878, +0x004) and a read of a gate are bus errors');
  // SSG1's command unit (docs/hle-gaps/4.2.md 4.2.6, 2026-11-22): the configuration words, a mode-0 batch and a mode-1
  // entry ending on IRQ 18 after A-CAMFE-3's lab time, the status written back, and what stays refused
  const { clock } = m.devices, g = fe.ssg, l0 = lines.length;
  ok(throwsAs(() => wr(SSG.start, 0x101), BUS) && throwsAs(() => rd(SSG.mode), BUS) && rd(SSG.dummy) === 0 && rd(SSG.status) === 0 && g.starts === 0,
    'before +0xa04 is written a start is refused and +0xa04 does not read; +0x60c reads 0 (A-CAMFE-4), the status 0');
  wr(0x9B000014, 0x700000); wr(SSG.mode, 0x2100); wr(0x9B000A08, 0x10100020); wr(0x9B000A14, 1); wr(0x9B000A18, 0x12D50001); wr(0x9B000A40, 1);
  ok(rd(0x9B000014) === 0x700000 && rd(SSG.mode) === 0x2100 && rd(0x9B000A14) === 1 && rd(0x9B000A18) === 0x12D50001,
    'request 8\'s configuration words are storage (+0xa04 0x2100, +0xa14, +0xa18 0x12d50001), the mask +0x014 reads back');
  wr(SSG.ctrl, rd(SSG.ctrl) & ~0x40);
  for (let k = 0; k < 120; k++) { wr(SSG.ram + 8 * k, 0x60000000); wr(SSG.ram + 8 * k + 4, (k << 16 | 0x81) >>> 0); }
  const t0 = clock.t;
  wr(SSG.start, 120 << 8 | 1);
  ok(g.starts === 1 && g.due === t0 + RUN_NS + 120 * ENTRY_NS && intc.line[SSG.irq] === 0 && g.runs[0].count === 120 && g.runs[0].mode === 0
    && g.runs[0].entries[1] === 0x81 && g.runs[0].entries[239] === (119 << 16 | 0x81),
    `a start of 120 entries with +0xa04 bit 8 set is a mode-0 batch, due ${(g.due - t0) / 1e3} us later (A-CAMFE-3), its entries kept, IRQ 18 low`);
  ok(throwsAs(() => wr(SSG.start, 1 << 8 | 1), BUS) && throwsAs(() => wr(SSG.start, 0), BUS), 'a start or a stop while a run is in progress is refused');
  clock.advance(g.due - 1);
  ok(intc.line[SSG.irq] === 0 && g.ends === 0, 'the batch has not ended a nanosecond early');
  clock.advance(t0 + RUN_NS + 120 * ENTRY_NS);
  ok(intc.driven[SSG.irq] && intc.line[SSG.irq] === 1 && rd(SSG.status) === SSG.batch_end && g.ends === 1 && g.due === Infinity,
    `at its end status bit 21 is set and IRQ 18 high (status ${rd(SSG.status).toString(16)})`);
  wr(SSG.status, rd(SSG.status) & rd(0x9B000014)); wr(SSG.start, 0); wr(SSG.ctrl, rd(SSG.ctrl) | 0x40);
  ok(intc.line[SSG.irq] === 0 && rd(SSG.status) === 0 && rd(SSG.ctrl) === 0x40, 'the handler\'s write-back clears it and IRQ 18 falls; +0x000 takes bit 6 again');
  wr(SSG.mode, 0); wr(0x9B000A0C, 0); wr(SSG.start, 0x101);
  clock.advance(clock.t + RUN_NS + ENTRY_NS);
  ok(g.runs[1].mode === 1 && rd(SSG.status) === SSG.entry_end && intc.line[SSG.irq] === 1, 'with +0xa04 bit 8 clear a start of one entry is a mode-1 entry: it ends on status bit 20');
  wr(SSG.status, SSG.entry_end); wr(SSG.start, 0);
  ok([[SSG.start, 2 << 8 | 1], [SSG.start, 0x7802], [SSG.start, 121 << 8 | 1], [SSG.ram + 960, 0], [0x9B000A30, 0]].every(([a, x]) => throwsAs(() => wr(a, x), BUS))
    && throwsAs(() => rd(SSG.reply), BUS) && throwsAs(() => rd(SSG.ram), BUS) && throwsAs(() => rd(0x9B000A20), BUS) && intc.line[SSG.irq] === 0
    && lines.slice(l0).length === 12 && throwsAs(() => wr(SSG.ctrl, 8), BUS),
    'a mode-1 start of two entries, a start word without bit 0 or over 120 entries, the RAM past its entries, a word the driver does not use, another +0x000 value, the sensor\'s reply +0xa10, a read of the RAM and of a word not yet written are refused');
  ok(lines.slice(l0).length === 13 && lines.slice(l0, -1).every((l) => /SSG1's command unit/.test(l)) && lines.slice(l0).some((l) => /what the sensor answers is not modelled/.test(l)),
    `each refusal names SSG1's command unit: ${lines.slice(l0).at(-4)}`);
  ok(lines.length > 0 && lines.every((l) => /^om-emu: om1\.camfe UNKNOWN (read|write) 0x[0-9a-f]{8} size \d/.test(l)), `each refused CPU access is printed: ${lines.slice(0, 2)}`);
  ok([15, 16, 17, 19, 26, 32, 34, 37, 40, 243].every((irq) => intc.line[irq] === 0 && !intc.driven[irq]), 'no other interrupt line is driven');
  ok(throwsAs(() => new CamFe(m), Error), 'a second device over the same blocks is refused');
  return t;
}

// SSG1's command unit in a session (docs/hle-gaps/4.2.md 4.2.6, 2026-11-22; E143, camapp 1, --take probe --cpu2 native
// with cam_fe): the test makes cam.c's request 6 as TAKE_FUNC_CP's start does (argument 0, its completion +72 TAKE's
// 0x502cd4d0; test_expcb.mjs camFrontEndSession). The power-on now passes the command unit: the SSG's request 8
// configures it and the three 0x50171ade(1, n; 131) send 13 mode-0 batches (ten of 120 entries, 27, 1 and 1, the
// last after the 20 ms delay of 0x10004000), each ending on IRQ 18 through the handler 0x5019e218 and its batch end
// 0x5019e279, no mode-1 entry. Events 0x2000, 0x4000, 0x8000 and 0x10000 follow, and the units' set-up 0x5019d287
// stops at its sixth call, the clock gate 0x50160cee: 0x9b5008a0 = 1 at 0x50160cfe, a gate word S-CAMFE does not
// take. The kind-7 sender and TAKE's completion are not reached and cam.c logs nothing.
const POWER_ON_EVENTS = [0x10000001, 0x10000010, 0x10000008, 0x10000004, 0x10000020, 0x10000040, 0x10000080, 0x10000100, 0x10000200,
  0x10000400, 0x10000800, 0x10800000, 0x10001000, 0x11000000, 0x10002000, 0x10004000, 0x10008000, 0x10010000];
const SITES = { irq18: 0x5019E218, batch_end: 0x5019E279, entry_end: 0x5019E34B, one_shot: 0x5019E47C, sender: 0x5019D460, completion: 0x502CD4D0,
  cam_switch: 0x502A4A46 };
const SSG_STOP = /stopped at 0x[0-9a-f]+ \(disasm 0x50160cfe\) fault=2[\s\S]*om1\.camfe UNKNOWN write 0x9b5008a0 size 4 value 0x00000001 /;
export async function camFeSsgSession() {
  const t = tester(), { ok, bad } = t;
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' }, env);
  pl.cam_fe = true;
  const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, take = s.camapp.take, fe = take.camfe, g = fe.ssg;
    const used = pl.stand_ins_in_use();
    ok(['S-CAMFE', 'A-CAMFE-3', 'A-CAMFE-4'].every((x) => used.includes(x)) && g.starts === 0, `S-CAMFE with A-CAMFE-3 and A-CAMFE-4 in use (${used.filter((x) => /CAMFE/.test(x))}), no command run at the init`);
    const hits = {};
    for (const [k, at] of Object.entries(SITES)) lab.observe(at, () => { hits[k] = (hits[k] ?? 0) + 1; }, `ssg ${k}`);
    const rec = lab.alloc(new Uint8Array(192), 4), e0 = take.cam.errlogs.length, t0 = lab.lab_time();
    lab.sim.write(rec, Uint8Array.of(6, 0, 0, 0));
    lab.sim.write(rec + 72, pack('<I', SITES.completion - 0x50000000 + 0x60021020));
    const rc = lab.call(SITES.cam_switch, { a0: rec }, null, null, 20000000).d0 & 0xFFFF;
    s.settle('ssg request 6');
    let stop = null;
    try { const to = lab.lab_time() + 100e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); } catch (e) { stop = e.message; }
    const on = take.cam.power.filter((x) => x.what === 'on'), events = on.map((x) => x.event), at = new Map(on.map((x) => [x.event, x.t_ns]));
    ok(rc === 0 && JSON.stringify(events) === JSON.stringify(POWER_ON_EVENTS),
      `request 6 natively: the power-on takes the events ${events.map(h8)} (want ${POWER_ON_EVENTS.map(h8)})`);
    const counts = g.runs.map((r) => r.count), want = [...Array(10).fill(120), 27, 1, 1];
    ok(JSON.stringify(counts) === JSON.stringify(want) && g.runs.every((r) => r.mode === 0) && g.ends === 13 && g.status === 0 && g.due === Infinity,
      `SSG1's command unit runs 13 mode-0 batches of ${counts} entries (want ten of 120, 27, 1, 1), all ended, the status cleared`);
    ok(hits.irq18 === 13 && hits.batch_end === 13 && !hits.entry_end && !hits.one_shot,
      `each ends on IRQ 18 through the firmware's handler (0x5019e218 ${hits.irq18}, the batch end 0x5019e279 ${hits.batch_end}, want 13 each; the mode-1 end ${hits.entry_end ?? 0}, the one-shot ${hits.one_shot ?? 0})`);
    const first = g.runs[0].entries.slice(0, 6), singles = g.runs.slice(11).map((r) => r.entries);
    ok(JSON.stringify(first) === JSON.stringify([0x60000000, 0x81, 0x60000000, 0x01FC0081, 0x60000000, 0x39030081])
      && JSON.stringify(singles) === JSON.stringify([[0x60000000, 0x00010081], [0x60000000, 0x005A0081]]),
      `the entries: the first batch's ${first.map(h8)}, the single ones ${singles.map((e) => e.map(h8))}`);
    const ms = (a, b) => Math.round((at.get(b) - at.get(a)) / 1e6);
    ok(ms(0x10004000, 0x10008000) === 20 && Math.round((g.runs[12].t_ns - g.runs[11].t_ns) / 1e6) === 20,
      `the last batch waits for 0x10004000's delay: ${ms(0x10004000, 0x10008000)} ms (want 20)`);
    ok([[0x9B000000, 0x40], [0x9B000A00, 0], [0x9B000A04, 0x2100], [0x9B000A08, 0x10100020], [0x9B000A18, 0x12D50001], [0x9B000A20, 0x10101], [0x9B000A64, 10]].every(([a, v]) => fe.regs.get(a) === v),
      `the unit's words after the power-on's batches: ${[0x9B000000, 0x9B000A04, 0x9B000A08, 0x9B000A14, 0x9B000A18].map((a) => `${h8(a)} ${h8(fe.regs.get(a) ?? 0xFFFFFFFF)}`)}`);
    ok(stop !== null && SSG_STOP.test(stop) && !hits.sender && !hits.completion && take.cam.errlogs.length === e0,
      `it stops in the units' set-up at the clock gate 0x9b5008a0 (${String(stop).replace(/\s+/g, ' ').slice(0, 260)}); the kind-7 sender ${hits.sender ?? 0}, TAKE's completion ${hits.completion ?? 0}, cam.c logs ${take.cam.errlogs.slice(e0).map(h8)}; ${((lab.lab_time() - t0) / 1e6).toFixed(1)} ms`);
  } catch (e) { bad.push(`camFeSsgSession: ${e.message.slice(0, 600)}`); }
  pl.close_session();
  return t;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = camFeUnits();
  console.log(`S-CAMFE: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  const q = await camFeSsgSession();
  console.log(`S-CAMFE SSG1 session: ${q.checks - q.bad.length}/${q.checks}`);
  q.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || q.bad.length ? 1 : 0);
}
