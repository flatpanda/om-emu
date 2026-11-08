// CPU 3's MDET_DL natively with the DML engine's model (src/lab/mdet.mjs S-TAKEMDET, S-MDETDL, S-LEARNDATA;
// src/dev/dml.mjs S-DML; docs/om1-subject-spec.md 5.3):
//   dmlUnits (pure)  the engine's register file on a bare machine: storage and read-back, a start refused while powered
//                    down, the register image kept per start, the output area zeroed, the completion after RUN_NS of
//                    lab time with status bit 14 and IRQ 285, the write-1-to-clear status, the refusals
//   mdetSession      a headless Player on E143 with S-SCENE's rider: no request and no engine run while subject
//                    detection is OFF; at each kind 1..5 the chain mdet_dl_start / change_mode -> learning_data_load ->
//                    offer_yc_data -> dml_start -> IRQ 285 -> dml_start_callback runs natively (offers, runs, IRQs and
//                    callbacks counted alike, the kind's learning item answered), MDET reports 0 subjects; each run's
//                    register image as the firmware's tables give it, read at test time (the output buffer MDET's own
//                    global names, the records per class, the head's frame size and the kind's words, its bias and the
//                    resize words of object 0x3be4 through the firmware's property read); the debug API's dml op; at
//                    OFF, mdet_dl_end and no more runs; S-SUBJECT's frame on the rider at MOTOR_SPORTS meanwhile
//   node emu/test/test_mdet.mjs [--pure]
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

// The firmware's object 0x3be4 (the DML register images' values, spec 5.2 and the U4 notes) word i, through the
// property read the builders use (0x500417da with the object's data pointer from 0x500417b0, run natively)
const PROP_DATA = 0x500417B0, PROP_READ = 0x500417DA, OBJ_DML = 0x3BE4;
// The register image's derived expectations: the head's output words, and per kind (item = kind - 1) the kind block's
// words 17 m written to +0x498 + 0x100 m (m < 8), its bias words to +0x11c8.. and the resize words of aspect 0 (a 640 x
// 480 frame) to +0x074.. and +0x100.. (dml_set_common_reg's kind block 408 + 306 item; dml_set_sp_reg's 1974 + 60 item
// + 20 aspect and 1938 + 12 aspect, spec 5.2); 0x62f404e0 is MDET's global dml_start stores the output buffer in
const KIND_BLOCK = 408, KIND_STRIDE = 306, KIND_WORDS = 8, BIAS = 1974, BIAS_STRIDE = 60, BIAS_WORDS = 20, RESIZE = 1938;
const HEAD_FRAME = 263, RECORDS = 2457, OUT_GLOBAL = 0x62F404E0;
const R = { out: 0x1118, count: 0x111c, frame: 0x11c4, kind: (m) => 0x498 + 0x100 * m, bias: (j) => 0x11c8 + 4 * j, resize: (j) => (j < 4 ? 0x074 + 4 * j : 0x100 + 4 * (j - 4)) };

export async function mdetSession() {
  const t = tester(), { ok } = t;
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL_INFO } = await import('../src/fw/model.mjs');
  const results = new Map();
  let seq = 0;
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, debug_api: true },
    { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000, onResult: (n, r) => results.set(n, r) });
  const f = MODEL_INFO.mdet;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, dml = lab.sim.m.devices.dml;
    const idle = (ms) => s.idle_slice(lab.lab_time() + ms * 1e6);
    const ask = (q) => { const i = { seq: ++seq, t_wall: 0, type: 'debug', ...q }; pl.apply(i); return results.get(i.seq)?.debug; };
    s.scene_input({ liveview: true, preset: 'moving', layer: { index: 1, speed: 0 } });
    idle(100);
    s.key('s1', 'down'); s.camapp.pump(); idle(100); s.key('s1', 'up'); s.camapp.pump();   // the date prompt goes
    idle(300);
    ok(!s.camapp.status().mdet && dml.runs === 0 && !pl.stand_ins_in_use().includes('S-MDETDL'), `setting OFF: no request, no engine run, S-MDETDL not listed (runs ${dml.runs})`);
    const data = lab.call(PROP_DATA, { d0: OBJ_DML }, null, null, 2000000).a0 >>> 0;
    const obj = (i) => lab.call(PROP_READ, { d0: OBJ_DML, a0: data, d1: i }, null, null, 2000000).d0 >>> 0;
    const images = {};
    let prev = { offers: 0, dml_runs: 0, irqs: 0, callbacks: 0 };
    for (const kind of [1, 2, 3, 4, 5]) {
      const set = s.step(`SET:1682=${kind}`);
      ok(set?.set?.read_back === kind, `the setting reads back ${kind}: ${JSON.stringify(set?.set ?? null)}`);
      for (let i = 0; i < 4; i++) idle(80);                                       // an offer per S-SCENE frame step
      const st = s.camapp.status().mdet ?? {}, d = (k) => st[k] - prev[k];
      ok(st.kind === kind && d('offers') >= 2 && d('dml_runs') === d('offers') && d('irqs') === d('offers') && d('callbacks') === d('offers'),
        `kind ${kind}: offers, engine runs, IRQ 285 deliveries and dml_start_callback runs alike: ${JSON.stringify(st)}`);
      ok(s.camapp.mdet.loads.at(-1) === kind - 1, `kind ${kind}: learning item ${kind - 1} answered (S-LEARNDATA): ${JSON.stringify(s.camapp.mdet.loads)}`);
      const recs = [];
      for (let i = 0; i < f.result.count; i++) recs.push(lab.sim.read(f.result.records + f.result.size * i, 2));
      ok(recs.every((b) => b[0] === 0 && b[1] === 0) && st.subjects === 0, `kind ${kind}: MDET's subject records report 0 subjects (${st.subjects})`);
      ok(lab.sim.read(MODEL_INFO.subject.active, 1)[0] === 1, `kind ${kind}: LAF's running byte set by its start`);
      prev = st;
      // the newest run's image against the firmware's tables
      const im = dml.last().regs, item = kind - 1, bad = [];
      images[kind] = im;
      const want = (o, v, what) => { if (im[o] !== v) bad.push(`${what} +0x${o.toString(16)} 0x${(im[o] ?? 0).toString(16)}, want 0x${v.toString(16)}`); };
      want(R.out, lab.sim.u32(OUT_GLOBAL) >>> 4, 'the output buffer (MDET\'s 0x62f404e0 >> 4)');
      want(R.count, obj(RECORDS), 'the records per class');
      want(R.frame, obj(KIND_BLOCK + KIND_STRIDE * item + HEAD_FRAME), 'the head\'s frame');
      for (let m = 0; m < KIND_WORDS; m++) want(R.kind(m), obj(KIND_BLOCK + KIND_STRIDE * item + 17 * m), `kind word ${17 * m}`);
      for (let j = 0; j < BIAS_WORDS; j++) want(R.bias(j), obj(BIAS + BIAS_STRIDE * item + j), `bias ${j}`);
      for (let j = 0; j < 12; j++) want(R.resize(j), obj(RESIZE + j), `resize ${j}`);
      ok(!bad.length && lab.sim.u32(OUT_GLOBAL) === 0xb64f5c80 && im[R.count] === 32 && im[R.frame] === ((480 << 16) | 640),
        `kind ${kind}: the register image as the firmware's tables give it (0x9c181118 = 0x${im[R.out]?.toString(16)}, 0x9c18111c = ${im[R.count]}, 0x9c1811c4 = 0x${im[R.frame]?.toString(16)}): ${bad.slice(0, 4).join('; ')}`);
      if (kind === 1) {
        const sub = s.camapp.status().subject;
        ok(sub?.frames === 1 && sub.kind === 1 && pl.stand_ins_in_use().includes('S-SUBJECT'), `MOTOR_SPORTS: S-SUBJECT still shows the rider's frame: ${JSON.stringify(sub ?? null)}`);
      }
    }
    // between kinds the images differ exactly where the kind's words and bias words do
    for (const kind of [2, 3, 4, 5]) {
      const a = images[1], b = images[kind], got = Object.keys(a).filter((o) => a[o] !== b[o]).map(Number).sort((x, y) => x - y);
      const exp = [];
      for (let m = 0; m < KIND_WORDS; m++) if (obj(KIND_BLOCK + 17 * m) !== obj(KIND_BLOCK + KIND_STRIDE * (kind - 1) + 17 * m)) exp.push(R.kind(m));
      for (let j = 0; j < BIAS_WORDS; j++) if (obj(BIAS + j) !== obj(BIAS + BIAS_STRIDE * (kind - 1) + j)) exp.push(R.bias(j));
      exp.sort((x, y) => x - y);
      ok(got.length > 0 && JSON.stringify(got) === JSON.stringify(exp), `MOTOR_SPORTS against kind ${kind}: the registers that differ ${got.map((o) => o.toString(16))}, from the tables ${exp.map((o) => o.toString(16))}`);
    }
    const used = pl.stand_ins_in_use();
    ok(['S-TAKEMDET', 'S-MDETDL', 'S-LEARNDATA', 'S-DML', 'A-DML-1'].every((x) => used.includes(x)), 'the player lists S-TAKEMDET, S-MDETDL, S-LEARNDATA, S-DML and A-DML-1');
    const r = ask({ op: 'dml' });
    ok(r?.ok && r.runs === dml.runs && r.last?.regs?.['0x1118'] === '0x0b64f5c8' && r.last.out[0] === '0xb64f5c80' && r.last.out[1] === 4608,
      `the debug API's dml op: ${JSON.stringify({ runs: r?.runs, out: r?.last?.out, reg: r?.last?.regs?.['0x1118'] })}`);
    // OFF: mdet_dl_end, LAF stopped, no more runs
    s.step('SET:1682=0');
    idle(200);
    const runs = dml.runs, st = s.camapp.status().mdet;
    idle(300);
    ok(st.kind === null && dml.runs === runs && lab.sim.read(MODEL_INFO.subject.active, 1)[0] === 0 && s.camapp.mdet.requests.at(-1)?.[0] === 'end',
      `OFF: mdet_dl_end, no engine run after it, LAF's running byte 0: ${JSON.stringify(st)}, runs ${runs} -> ${dml.runs}`);
    ok(pl.phase === 'running', `the session runs on: ${pl.phase} ${pl.error?.message ?? ''}`);
  } catch (e) { t.bad.push(`session: ${e.stack.slice(0, 900)}`); }
  try { pl.close_session(); } catch { /* closed */ }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rs = [['DML engine units', dmlUnits()]];
  if (!process.argv.includes('--pure')) rs.push(['MDET_DL in play', await mdetSession()]);
  for (const [n, r] of rs) { console.log(`${n}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); }
  process.exit(rs.some(([, r]) => r.bad.length) ? 1 : 0);
}
