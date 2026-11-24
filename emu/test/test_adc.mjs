// The A/D converter and the A/D driver's init (src/dev/adc.mjs; src/lab/play.mjs H-ADINIT; src/fw/facts.mjs adDriver;
// docs/hle-gaps/4.7.md 4.7.20):
//   adcUnits    (no firmware) the device on the lab clock with a recording controller, driven through its register
//               handlers in the order E143's driver writes them for a request of 2 samples (0x5004cf16, the handler
//               0x5004d09c and its 0x5004d0d3, the stop 0x5004cfc0): +0x38 ready (A-ADC-1); the start with the control
//               word 0x7102 (channel 7, mode 2) samples every SAMPLE_NS (A-ADC-2), latching the lab's value into
//               +0x58 and setting +0x14, the IRQ high only with +0x10 (A-ADC-3); +0x14 written 1 clears it; +0x04
//               written 0 stops the conversions. UNKNOWN, a bus error counted: a mode-0 start, a channel the lab gives
//               no value, a channel >= 8, a control word while converting, +0x00's and +0x08's reads, an offset the
//               driver does not use, a halfword, a debugger access
//   adcFacts    (firmware: E143's image) the rule finds E143's init, its configuration records, table, count and IRQ
//               (AD_E143); control: an image whose init has another byte where the table's load is finds none
//   adcSession  a play session's start (E143) with H-ADINIT (the default) and with the mutant no-adinit (the path
//               before): with it the table holds 6 channels, UI_IN's channel open (0x5014ce00) completes through the
//               converter (2 samples of converter channel 7, UI_IN's value 1 << P's position) and logs no 0x28001511;
//               without it the table is empty, the converter idle and the open logs 0x28001511; the same screen, frame
//               and lab time both ways; the stand-ins H-ADINIT and A-ADC-1..5 only with it. Then with
//               OM_POWER_LATER=on and the sub-CPU's own firmware: the power manager's temperature read (channel 4,
//               converter channel 1) completes through the converter (5 samples per read)
//   node emu/test/test_adc.mjs [units|facts|session]
import { Clock } from '../src/dev/timer.mjs';
import { Adc, SAMPLE_NS } from '../src/dev/adc.mjs';
import { BUS } from '../src/core/mem.mjs';

const IRQ = 319, P_E143 = 8, DIAL_CONV = 7, TEMP_CONV = 1;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

// a device at base (each its own: the regions stay in the page table of the process until a machine is made)
function rig(base, values) {
  const lines = new Map(), driven = new Set(), errs = [];
  const intc = { drive: (irq) => driven.add(irq), setLine: (irq, level) => lines.set(irq, level) };
  const clock = new Clock(), a = new Adc({ stderr: (l) => errs.push(l) }, clock, intc, { base, irq: IRQ });
  a.values = values;
  const w = (off, v) => { try { a.write(off, v, 4, false); return 'ok'; } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
  const r = (off, size = 4, dbg = false) => { try { return a.read(off, size, dbg); } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
  return { a, clock, lines, driven, errs, w, r, line: () => lines.get(IRQ) === true };
}

export function adcUnits() {
  const t = tester(), { ok } = t;
  {
    const x = rig(0x8F100000, (k) => (k === DIAL_CONV ? 0xab5 : null));
    ok(x.driven.has(IRQ), 'the device drives IRQ 319');
    // 0x5004cf16: the divider, the ready wait, +0x14 1, +0x10 1, the control word, +0x04 1
    const start = [x.w(0x08, 4), x.r(0x38), x.w(0x14, 1), x.w(0x10, 1), x.w(0x00, 0x7102), x.w(0x04, 1)];
    ok(start.join(' ') === 'ok 1 ok ok ok ok' && x.a.channel === DIAL_CONV && x.a.next === SAMPLE_NS, `the start: ${start.join(' ')}, channel ${x.a.channel}, next ${x.a.next}`);
    x.clock.advance(SAMPLE_NS - 1, false);
    ok(x.r(0x14) === 0 && !x.line(), `before a sample: status ${x.r(0x14)}, line ${x.line()}`);
    x.clock.advance(SAMPLE_NS, false);
    ok(x.r(0x14) === 1 && x.line() && x.r(0x58) === 0xab5, `the first sample: status ${x.r(0x14)}, line ${x.line()}, +0x58 ${h8(x.r(0x58))}`);
    // the handler: +0x34, +0x1c read 0, +0x14 set; +0x10 0, +0x14 1, the data word, then +0x14 1, +0x10 1 (one owed)
    const isr = [x.r(0x34), x.r(0x1c), x.r(0x14), x.w(0x10, 0), x.w(0x14, 1)];
    ok(isr.join(' ') === '0 0 1 ok ok' && !x.line() && x.r(0x14) === 0, `the handler's reads and writes: ${isr.join(' ')}, line ${x.line()}`);
    x.w(0x14, 1); x.w(0x10, 1);
    x.clock.advance(2 * SAMPLE_NS, false);
    ok(x.a.samples[DIAL_CONV] === 2 && x.line(), `the second sample: ${x.a.samples[DIAL_CONV]} samples, line ${x.line()}`);
    // the last: +0x10 0, +0x14 1, then the stop 0x5004cfc0: +0x04 bit 0 cleared and read back 0, +0x10 0, +0x14 1, +0x00 0
    x.w(0x10, 0); x.w(0x14, 1);
    const stop = [x.r(0x28), x.r(0x04), x.w(0x04, 0), x.r(0x04), x.w(0x10, 0), x.w(0x14, 1), x.w(0x00, 0)];
    x.clock.advance(10 * SAMPLE_NS, false);
    ok(stop.join(' ') === '0 1 ok 0 ok ok ok' && x.a.channel === null && x.a.samples[DIAL_CONV] === 2 && !x.line(), `the stop: ${stop.join(' ')}; ${x.a.samples[DIAL_CONV]} samples after it`);
    ok(x.a.errors.length === 0 && x.errs.length === 0, `no UNKNOWN on the driver's path: ${x.errs.join('; ')}`);
  }
  {
    const x = rig(0x8F110000, (k) => (k === DIAL_CONV ? 0xab5 : null)), e0 = x.a.errors.length;
    const refused = [['a mode-0 start', (x.w(0x00, 0x7100), x.w(0x04, 1))], ['a channel with no value', (x.w(0x00, 0x1102), x.w(0x04, 1))],
      ['channel 8', (x.w(0x00, 0x8102), x.w(0x04, 1))], ['+0x00 read', x.r(0x00)], ['+0x08 read', x.r(0x08)], ['+0x60 written', x.w(0x60, 0)],
      ['+0x2c read', x.r(0x2c)], ['a halfword', x.r(0x14, 2)], ['a debugger read', x.r(0x38, 4, true)], ['+0x14 written 2', x.w(0x14, 2)]];
    x.w(0x00, 0x7102); x.w(0x04, 1);
    refused.push(['a control word while converting', x.w(0x00, 0x1102)]);
    ok(refused.every(([, s]) => s === 'BUS') && x.a.errors.length === e0 + refused.length - 1, `UNKNOWN accesses: ${refused.map(([k, s]) => `${k} ${s}`).join(', ')}; ${x.a.errors.length - e0} errors (the debugger read uncounted)`);
  }
  return t;
}

export async function adcFacts() {
  const t = tester(), { ok } = t;
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return t;
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { adDriver, AD_E143 } = await import('../src/fw/facts.mjs');
  const image = loadImage(), f = adDriver(image);
  ok(JSON.stringify(f) === JSON.stringify(AD_E143), `the rule reads ${JSON.stringify(f)}, AD_E143 ${JSON.stringify(AD_E143)}`);
  const bad = new Uint8Array(image), at = 0x5004D3E9 - 0x50000000;
  ok(bad[at] === 0xF8 && bad[at + 1] === 0x01, `the table's load at ${h8(0x5004D3E9)}`);
  bad[at + 1] = 0x02;
  ok(adDriver(bad) === undefined, 'control: with another byte in the table\'s load the rule finds no init');
  return t;
}

async function start(mutant, later) {
  const { loadImage, loadBlock, loadNand, createHash, loadScpuImage } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000,
    ...(later ? { scpu: 'native', scpuImage: loadScpuImage() } : {}) };
  const was = process.env.OM_POWER_LATER;
  if (later) process.env.OM_POWER_LATER = 'on'; else delete process.env.OM_POWER_LATER;
  try {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, x_mutant: mutant }, env);
    pl.open_session();
    const s = pl.session, lab = s.lab, sim = lab.sim;
    pl.publish_status?.();
    const r = { ad: s.ad_init ?? null, count: sim.read(0xA32BFF14, 1)[0], adc: sim.m.devices.adc.info(), uiin: sim.u32(0x62988784),
      errlog: lab.kernel.errors.map(([c]) => c).filter((c) => c === 0x28001511).length, used: pl.stand_ins_in_use(),
      at: { gui: pl.status_doc?.gui_name ?? null, frame: pl.frame?.[3] ?? null, ns: lab.lab_time() }, later: s.power_manager?.later ?? null };
    pl.close_session();
    return r;
  } finally {
    if (was === undefined) delete process.env.OM_POWER_LATER; else process.env.OM_POWER_LATER = was;
  }
}

export async function adcSession() {
  const t = tester(), { ok } = t;
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return t;
  const n = await start(null, false), o = await start('no-adinit', false);
  ok(n.ad !== null && n.count === 6 && n.ad.channels.some(([c, k]) => c === 12 && k === DIAL_CONV) && n.ad.channels.some(([c, k]) => c === 4 && k === TEMP_CONV),
    `H-ADINIT: ${n.count} channels ${JSON.stringify(n.ad?.channels)}`);
  ok(n.adc.samples[DIAL_CONV] === 2 && n.adc.channel === null && n.adc.errors === 0 && n.uiin === 1 << P_E143 && n.errlog === 0,
    `UI_IN's channel open through the converter: ${n.adc.samples[DIAL_CONV]} samples, UI_IN's value ${h8(n.uiin)}, ${n.errlog} x 0x28001511`);
  ok(o.ad === null && o.count === 0 && o.adc.samples.every((x) => x === 0) && o.uiin === 0 && o.errlog === 1,
    `control (no-adinit): ${o.count} channels, ${o.adc.samples.reduce((a, b) => a + b)} samples, UI_IN's value ${h8(o.uiin)}, ${o.errlog} x 0x28001511`);
  ok(JSON.stringify(n.at) === JSON.stringify(o.at) && n.at.frame !== null, `the same start: ${JSON.stringify(n.at)} with, ${JSON.stringify(o.at)} without`);
  const adc = ['H-ADINIT', 'A-ADC-1', 'A-ADC-2', 'A-ADC-3', 'A-ADC-4', 'A-ADC-5'];
  ok(adc.every((x) => n.used.includes(x)) && !o.used.some((x) => adc.includes(x)), `the stand-ins: ${n.used.filter((x) => /ADC|ADINIT/.test(x))} with, ${o.used.filter((x) => /ADC|ADINIT/.test(x))} without`);
  if (MODEL_INFO.scpu_lle) {
    const p = await start(null, true);
    ok(p.later?.length === 2 && p.adc.samples[TEMP_CONV] >= 5 && p.adc.samples[TEMP_CONV] % 5 === 0 && p.adc.errors === 0 && p.at.gui === n.at.gui,
      `OM_POWER_LATER=on: the temperature reads through the converter: ${p.adc.samples[TEMP_CONV]} samples of converter channel ${TEMP_CONV}, inits ${JSON.stringify(p.later?.map((x) => x.init))}, GUI ${p.at.gui}`);
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  for (const [name, fn] of [['units', adcUnits], ['facts', adcFacts], ['session', adcSession]]) {
    if (which !== 'all' && which !== name) continue;
    const r = await fn();
    console.log(`the A/D converter, ${name}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
