// CPU 3's MDET_DL natively with the DML engine's model (src/lab/mdet.mjs S-TAKEMDET, S-MDETDL, S-LEARNDATA;
// src/dev/dml.mjs S-DML; docs/om1-subject-spec.md 5.3):
//   dmlUnits (pure)  the engine's register file on a bare machine: storage and read-back, a start refused while powered
//                    down, the register image kept per start, the output area zeroed, the completion after RUN_NS of
//                    lab time with status bit 14 and IRQ 285, the write-1-to-clear status, the lab's records written
//                    packed per class, the refusals
//   mdetSession      a headless Player on E143 with S-SCENE's live view: no request and no engine run while subject
//                    detection is OFF; with no subject in the scene, at each kind 1..5 the chain mdet_dl_start /
//                    change_mode -> learning_data_load -> offer_yc_data -> dml_start -> IRQ 285 -> dml_start_callback
//                    runs natively (offers, runs, IRQs and callbacks counted alike, the kind's learning item answered),
//                    MDET reports 0 subjects and its frame table is empty; each run's register image as the firmware's
//                    tables give it, read at test time (the output buffer MDET's own global names, the records per
//                    class, the head's frame size and the kind's words, its bias and the resize words of object 0x3be4
//                    through the firmware's property read); then with S-SCENE's rider at MOTOR_SPORTS S-DML's record
//                    for it (class 0, slot 0, at the box subject.mjs places) from each run, and MDET's own subject
//                    record (sbj_kind 6, the body {cx, cy, w, h, rel, dtct}) from the run after the hits its
//                    stabilisation needs (object 0x61a4 [915]), LAF's box for the frame table equal to S-DML's, and
//                    MDET's frame table written by MDET's own writer with that box as its list record, the getter's
//                    aspect pair LAF derived from the offer's aspect code, S-TAKEFRAME's subject bit set and S-SUBJECT
//                    not run; the debug API's dml op; after passes with no subject, S-SCENE's race preset (two racers
//                    held still): S-DML's bodies in class 0 and helmets in class 2, nothing reported for the hits the
//                    stabilisation asks, then two subject records, each body combined with its own helmet as part 2,
//                    and the two bodies as the table's list records (spec 5.6); at OFF, mdet_dl_end, no more runs, the
//                    table empty and the bit gone
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
  // the lab's records: packed from slot 0 of each class, the u16 fields +0 score, +2 h, +4 w, +6 cy, +8 cx
  dml.source = () => [{ cls: 0, score: 0xe00, h: 244, w: 232, cy: 325, cx: 320 }, { cls: 0, score: 0x1000, h: 2, w: 4, cy: 6, cx: 8 }, { cls: 3, score: 1, h: 10, w: 12, cy: 14, cx: 16 }];
  wr(0x010, 1);
  const u16s = (at, n) => { const b = new Uint8Array(2 * n); bus.read(at, b); return [...new Uint16Array(b.buffer)]; };
  ok(JSON.stringify(u16s(out, 8)) === '[3584,244,232,325,320,0,0,0]' && JSON.stringify(u16s(out + 16, 5)) === '[4096,2,4,6,8]' &&
    JSON.stringify(u16s(out + 16 * 32 * 3, 5)) === '[1,10,12,14,16]' && JSON.stringify(u16s(out + 32, 8)) === '[0,0,0,0,0,0,0,0]' && dml.last().records === 3,
    'the lab\'s records written packed per class (class 0 slots 0 and 1, class 3 slot 0), the rest zero');
  clock.advance(clock.t + RUN_NS, false);
  wr(0x004, S_DONE);
  dml.source = () => [{ cls: 9, score: 1, h: 0, w: 0, cy: 0, cx: 0 }];
  ok(throwsAs(() => wr(0x010, 1), Error), 'a record of a class past the ninth is the lab\'s error');
  dml.source = () => [{ cls: 0, score: 1, h: 0x400, w: 0, cy: 0, cx: 0 }];
  ok(throwsAs(() => wr(0x010, 1), Error), 'a field past its 10 bits is the lab\'s error');
  dml.source = null;
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
// MDET's parameters, object 0x61a4: [915] the hits a new track of a large or high-scoring box needs to register
// (regist_judge_update 0x5081455a, spec 5.2)
const OBJ_MDET = 0x61A4, HITS = 915;
// [905] the passes a registered track survives without a detection (lost_judge_update, spec 5.2)
const LOST_PASSES = 905;
// the frame table writer's box of subject 0 and its valid byte, which LAF fills (spec 5.1: 0xa33790b2 + 8 n, 0xa337d53c + n)
const LAF_BOX = 0xA33790B2, LAF_VALID = 0xA337D53C;
// LAF's subject 0 (row 0, slot 0): its centre x and y halfwords (spec 5.6: cx at 0xa337d554 + 2 n, cy at
// 0xa337d584 + 2 n)
const LAF_ROW0 = [0xA337D554, 0xA337D584];
// DISP_FRAME's frame mode (0xa3209010; bit 1 the subject frames, TAKE's request 1)
const DF_MODE = 0xA3209010;
// The AF target (spec 5.7): object 0x88b2 [0] its point in the AF library's 39 x 27 grid (row * 39 + column), object
// 0x1dd1 [0] / [1] its height and width in points (the record builder 0x5097500a; target mode 3, object 0x84d1), and
// the grid's x and y tables 0x60a63a48 / 0x60a63ae8 (40 and 28 words), from which the AF library's 0x5099d7d5 makes
// LAF's AF area: columns c - w / 2 - 1 .. c + w / 2 + 2 clamped to 0..39, rows r - h / 2 - 1 .. r + h / 2 + 2 clamped
// to 0..27
const OBJ_AF_POINT = 0x88B2, OBJ_AF_SIZE = 0x1DD1, GRID_X = 0x60A63A48, GRID_Y = 0x60A63AE8, GRID_COLS = 39, GRID_ROWS = 27;
// TAKE's status-change callback's guard byte, which it sets as it posts its message (0x506d991d)
const TAKE_CB_POSTED = 0xA32DF204;
// TAKE_MOV's call mdet_laf_start (0x5081ee9d from 0x506da292), which no stand-in makes; MDET_PDT_CPU3's dispatch
// (mdet_laf_pdt_dispatch 0x50841edd), where LAF's start goes on to the PDT / TRC unit the lab does not have
const LAF_START = 0x5081EE9D, PDT_DISPATCH = 0x60862EFD;
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
    s.scene_input({ liveview: true });                                           // the default scene: no subject
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
      const fr = s.camapp.status().subject;
      ok(recs.every((b) => b[0] === 0 && b[1] === 0) && st.subjects === 0 && st.records === 0 && fr?.source === 'mdet' && fr.frames === 0,
        `kind ${kind}: no subject in the scene, no engine record, MDET's subject records report 0 subjects (${st.subjects}), its frame table none: ${JSON.stringify(fr ?? null)}`);
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
    // the rider at MOTOR_SPORTS: S-DML's record for it from each run on, MDET's own subject record once its
    // stabilisation registers the track (object 0x61a4 [915] hits, spec 5.2), with the box subject.mjs places
    s.scene_input({ preset: 'moving', layer: { index: 1, speed: 0 } });
    s.step('SET:1682=1');
    const prevOffers = s.camapp.status().mdet.offers, prevWrites = s.camapp.mdet.table_writes;
    const data61 = lab.call(PROP_DATA, { d0: OBJ_MDET }, null, null, 2000000).a0 >>> 0;
    const hits = lab.call(PROP_READ, { d0: OBJ_MDET, a0: data61, d1: HITS }, null, null, 2000000).d0;
    let seen = 0, first = null;
    for (let i = 0; i < hits + 4 && first === null; i++) {
      idle(70);
      const st = s.camapp.status().mdet;
      if (st.records) seen += 1;
      if (st.subjects && first === null) first = seen;
    }
    // the AF area LAF tests candidates against (spec 5.7): the AF target's cells in the AF library's grid, H-FCSAF
    const prop = (o, i) => lab.call(PROP_READ, { d0: o, a0: 0, d1: i }, null, null, 2000000).d0;
    const point = prop(OBJ_AF_POINT, 0), [th, tw] = [prop(OBJ_AF_SIZE, 0), prop(OBJ_AF_SIZE, 1)], [col, row] = [point % GRID_COLS, Math.floor(point / GRID_COLS)];
    const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
    const area = [lab.sim.u32(GRID_X + 4 * clamp(col - (tw >> 1) - 1, GRID_COLS)), lab.sim.u32(GRID_Y + 4 * clamp(row - (th >> 1) - 1, GRID_ROWS)),
      lab.sim.u32(GRID_X + 4 * clamp(col + (tw >> 1) + 2, GRID_COLS)), lab.sim.u32(GRID_Y + 4 * clamp(row + (th >> 1) + 2, GRID_ROWS))];
    const L0 = s.camapp.status().mdet.laf, writes0 = s.camapp.mdet.table_writes, frames0 = s.camapp.status().subject.frames;
    ok(JSON.stringify(L0.area) === JSON.stringify(area) && JSON.stringify(area) === '[279,196,361,284]',
      `LAF's AF area from the AF target (point ${point}, ${tw} x ${th}, grid column ${col} row ${row}): ${JSON.stringify(L0.area)}, from the grid ${JSON.stringify(area)}`);
    // the rider overlaps it: at the offer that first reports it LAF marks it a candidate and sets its tracking status
    // instead of writing the table (0x50839d79..0x50839da4); the status callback copies the status and runs TAKE's
    // callback, which posts TAKE its message (S-TAKEMDET registered it); the writer's state stays 0 (U9)
    ok(L0.candidates[0] === 1 && L0.candidates.slice(1).every((c) => c === 0) && L0.tracking === 1 && L0.tracking_seen === 1 && L0.main_state === 0 &&
      lab.sim.read(TAKE_CB_POSTED, 1)[0] === 1 && frames0 === 0,
      `the rider in the AF area: LAF's candidate, the tracking status set and seen, TAKE's callback run, no table that offer: ${JSON.stringify(L0)}, frames ${frames0}`);
    idle(70);
    const sub = s.camapp.status().subject, box = s.camapp.mdet.boxes[0], got = s.camapp.mdet.subjects();
    const out = dml.last().out[0], rec = new Uint8Array(16); lab.sim.m.devices.bus.read(out, rec);
    const score = rec[0] | rec[1] << 8, want = box ? [(box[0] + box[2]) >> 1, (box[1] + box[3]) >> 1, (box[2] - box[0]) & ~1, (box[3] - box[1]) & ~1, (score * 255) >> 12, 1] : null;
    ok(box && s.camapp.mdet.boxes.length === 1, `MOTOR_SPORTS: S-DML's box for the rider: ${JSON.stringify(s.camapp.mdet.boxes)}`);
    ok(box && JSON.stringify([rec[8] | rec[9] << 8, rec[6] | rec[7] << 8, rec[4] | rec[5] << 8, rec[2] | rec[3] << 8]) === JSON.stringify(want.slice(0, 4)) && score === 0x0e00,
      `S-DML's record in class 0, slot 0: cx, cy, w, h ${[rec[8] | rec[9] << 8, rec[6] | rec[7] << 8, rec[4] | rec[5] << 8, rec[2] | rec[3] << 8]}, score 0x${score.toString(16)}, for the box ${JSON.stringify(box)}`);
    ok(first === hits + 1, `MDET reports the rider from the run after its ${hits} hits register the track: first at the ${first}th run with the record`);
    ok(got.length === 1 && got[0].sbj_kind === 6 && JSON.stringify(got[0].body) === JSON.stringify(want),
      `MDET's subject record at 0xa3376b5c: sbj_kind 6 (6 + 3 (kind - 1) + group 0) and the body {cx, cy, w, h, rel, dtct} ${JSON.stringify(want)}: ${JSON.stringify(got)}`);
    // LAF's step to the frame table (spec 5.2.1 (a)): its box for subject 0, {x0, x1, y0, y1} at LAF_BOX with the valid
    // byte LAF_VALID (the frame table writer's inputs, spec 5.1), is S-DML's box
    const laf = [...new Uint16Array(lab.sim.read(LAF_BOX, 8).slice().buffer)], valid = lab.sim.read(LAF_VALID, 1)[0];
    ok(box && valid === 1 && JSON.stringify(laf) === JSON.stringify([box[0], box[2], box[1], box[3]]),
      `LAF's box for the frame table from MDET's subject: ${JSON.stringify(laf)} (valid ${valid}), S-DML's ${JSON.stringify(box)}`);
    // the frame table itself (spec 5.5): the box as its one list record, the main and part flags 0, written by MDET's
    // writer (mdet.table_writer, its runs observed) after each offer, the getter's aspect pair (4, 3) for the offers'
    // aspect code 1, which LAF maps (S-SUBJECT, whose writes would be the only other source, made none: not listed, no
    // post); S-TAKEFRAME's subject bit in the frame mode
    const S = MODEL_INFO.subject, rd = (a) => lab.sim.read(a, 1)[0], st1 = s.camapp.status().mdet;
    ok(sub?.source === 'mdet' && sub.frames === 1 && JSON.stringify(sub.boxes) === JSON.stringify([box]) && sub.main === 0 && sub.part === 0 && sub.aspect === 1 && sub.kind === 1,
      `MDET's frame table holds the rider's box as its list record: ${JSON.stringify(sub ?? null)}`);
    ok(sub && st1.offers > prevOffers && sub.writes - prevWrites === st1.offers - prevOffers - 1 && sub.writes - writes0 === 1 && JSON.stringify([rd(S.aspect[0]), rd(S.aspect[1])]) === '[4,3]',
      `MDET's writer ran once per offer but the one that set the tracking status (${sub?.writes - prevWrites} runs, ${st1.offers - prevOffers} offers since the rider), the aspect pair ${[rd(S.aspect[0]), rd(S.aspect[1])]}`);
    ok(!pl.stand_ins_in_use().includes('S-SUBJECT') && s.camapp.subject.posts === 0 && (rd(DF_MODE) & 1) === 1,
      `S-SUBJECT made no write (posts ${s.camapp.subject.posts}, listed ${pl.stand_ins_in_use().includes('S-SUBJECT')}); the frame mode ${rd(DF_MODE)} has the subject bit`);
    const used = pl.stand_ins_in_use();
    ok(['S-TAKEMDET', 'S-MDETDL', 'S-LEARNDATA', 'S-DML', 'A-DML-1'].every((x) => used.includes(x)), 'the player lists S-TAKEMDET, S-MDETDL, S-LEARNDATA, S-DML and A-DML-1');
    const r = ask({ op: 'dml' });
    ok(r?.ok && r.runs === dml.runs && r.last?.regs?.['0x1118'] === '0x0b64f5c8' && r.last.out[0] === '0xb64f5c80' && r.last.out[1] === 4608,
      `the debug API's dml op: ${JSON.stringify({ runs: r?.runs, out: r?.last?.out, reg: r?.last?.regs?.['0x1118'] })}`);
    // two racers with their helmets (S-SCENE's race preset, held still; spec 5.6). First a scene with no subject for
    // more passes than a registered track survives unmatched (object 0x61a4 [905]), so that no track of the rider is
    // left to take a racer over (MDET's stabilisation keeps a track across a change of scene, X). Then S-DML writes
    // each body in class 0 and each helmet in class 2 (part 2 of group 0); MDET reports nothing for [915] runs and from
    // the next one two subjects, each the combination of a body with its own helmet, and LAF writes both bodies as
    // list records (main and part flags 0: spec U9)
    const LOST = lab.call(PROP_READ, { d0: OBJ_MDET, a0: data61, d1: LOST_PASSES }, null, null, 2000000).d0;
    s.scene_input({ preset: 'static' });
    for (let i = 0; i < LOST + 2; i++) idle(70);
    s.scene_input({ preset: 'race' });
    s.scene_input({ layer: { index: 1, speed: 0 } });
    s.scene_input({ layer: { index: 2, speed: 0 } });
    for (let i = 0; i < hits; i++) idle(70);
    const early = s.camapp.mdet.subjects().length, earlyFrames = s.camapp.status().subject?.frames;
    idle(70);
    // the offer that first reports the racers: the near racer overlaps the AF area and is LAF's candidate (slot 0,
    // LAF's row 0 its box), the far one not; the tracking status is set and no table written (as with the rider)
    const L1 = s.camapp.status().mdet.laf, row0 = LAF_ROW0.map((a) => lab.sim.read(a, 2)).map((b) => b[0] | b[1] << 8), frames1 = s.camapp.status().subject.frames;
    idle(70);
    const m = s.camapp.mdet, rx = m.subjects(), out2 = dml.last().out[0];
    ok(early === 0 && earlyFrames === 0 && LOST === 8, `the race: no subject and no frame after ${hits} runs (the stabilisation's hits), ${early} / ${earlyFrames}; a lost track lasts ${LOST} passes`);
    const near = m.boxes.reduce((a, b) => (b[2] - b[0] > a[2] - a[0] ? b : a)), cen0 = [(near[0] + near[2]) >> 1, (near[1] + near[3]) >> 1];
    const overlaps = (b) => b[0] <= L1.area[2] && b[2] >= L1.area[0] && b[1] <= L1.area[3] && b[3] >= L1.area[1];
    ok(L1.candidates[0] === 1 && L1.candidates.slice(1).every((c) => c === 0) && row0[0] === cen0[0] && row0[1] === cen0[1] && L1.tracking === 1 && frames1 === 0 &&
      m.boxes.filter(overlaps).length === 1 && overlaps(near),
      `the race: the near racer, the one body in the AF area ${JSON.stringify(L1.area)}, is LAF's candidate in slot 0 (row 0 at ${row0}, its centre ${cen0}), the far one none: ${JSON.stringify(L1)}, frames ${frames1}`);
    const slot = (cls, j) => { const b = new Uint8Array(16); lab.sim.m.devices.bus.read(out2 + 16 * (32 * cls + j), b); const w = [...new Uint16Array(b.buffer)]; return [w[4], w[3], w[2], w[1], w[0]]; };
    const cen = ([x0, y0, x1, y1]) => [(x0 + x1) >> 1, (y0 + y1) >> 1, (x1 - x0) & ~1, (y1 - y0) & ~1];
    const helmets = m.parts.map((p) => p.helmet);
    ok(m.boxes.length === 2 && helmets.length === 2 && helmets.every(Boolean),
      `the race: S-DML's two bodies and their helmets: ${JSON.stringify(m.boxes)} ${JSON.stringify(m.parts)}`);
    const dmlRecs = [slot(0, 0), slot(0, 1), slot(2, 0), slot(2, 1), slot(0, 2), slot(1, 0), slot(2, 2)];
    const wantRecs = [...m.boxes, ...helmets].map((b) => [...cen(b), 0x0e00]);
    ok(m.boxes.length === 2 && JSON.stringify(dmlRecs.slice(0, 4)) === JSON.stringify(wantRecs) && dmlRecs.slice(4).every((r) => r.every((v) => v === 0)),
      `S-DML's records: class 0 slots 0 and 1 the bodies, class 2 slots 0 and 1 the helmets, class 1 empty {cx, cy, w, h, score}: ${JSON.stringify(dmlRecs)}`);
    const pairs = m.boxes.map((b, i) => [[...cen(b), 223, 1], [...cen(helmets[i] ?? [0, 0, 0, 0]), 223, 1]]);
    const gotPairs = rx.map((x) => [x.body, x.parts[1]]), none = [0, 0, 0, 0, 0, 0];
    ok(rx.length === 2 && rx.every((x) => x.sbj_kind === 6 && JSON.stringify(x.parts[0]) === JSON.stringify(none)) &&
      pairs.every((p) => gotPairs.some((g) => JSON.stringify(g) === JSON.stringify(p))),
      `MDET's subject records: two of sbj_kind 6, each body combined with its own helmet as part 2 (part 1 empty): ${JSON.stringify(rx)}, want ${JSON.stringify(pairs)}`);
    const sub2 = s.camapp.status().subject, ev = (b) => [b[0], b[1], b[0] + ((b[2] - b[0]) & ~1), b[1] + ((b[3] - b[1]) & ~1)];
    ok(sub2?.frames === 2 && sub2.main === 0 && sub2.part === 0 && m.boxes.every((b) => sub2.boxes.some((x) => JSON.stringify(x) === JSON.stringify(ev(b)))),
      `MDET's frame table: the two bodies as its list records (sizes made even), main and part flags 0: ${JSON.stringify(sub2 ?? null)}`);
    // OFF: mdet_dl_end, LAF stopped, no more runs
    s.step('SET:1682=0');
    idle(200);
    const runs = dml.runs, st = s.camapp.status().mdet;
    idle(300);
    const fr = s.camapp.status().subject;
    ok(st.kind === null && dml.runs === runs && lab.sim.read(MODEL_INFO.subject.active, 1)[0] === 0 && s.camapp.mdet.requests.at(-1)?.[0] === 'end' && fr.frames === 0 && (lab.sim.read(DF_MODE, 1)[0] & 1) === 0,
      `OFF: mdet_dl_end, no engine run after it, LAF's running byte 0, no frame, the subject bit gone: ${JSON.stringify(st)}, runs ${runs} -> ${dml.runs}, ${JSON.stringify(fr)}`);
    ok(pl.phase === 'running', `the session runs on: ${pl.phase} ${pl.error?.message ?? ''}`);
    // MDET_E_SEND_CPU3 and MDET_CALC_MAIN_CPU3 natively at a post of the firmware's own (spec 5.7): TAKE_MOV's call
    // mdet_laf_start, made here by the test (no stand-in makes it), posts LAF's start request to CPU 3; S-CPU3 serves
    // the setter, MDET_E_SEND forwards the event to MDET_CALC_MAIN's queue and MDET_CALC_MAIN's turn runs LAF's start,
    // which posts on to MDET_PDT_CPU3, a function S-CPU3 does not serve: the session stops there, naming it
    const m2 = s.camapp.mdet, turns0 = { ...Object.fromEntries(m2.turns) }, ev0 = m2.events.length;
    let stop = null;
    try { lab.call(LAF_START, null, null, null, 2000000); s.settle('mdet_laf_start'); s.camapp.drain_cpu3(); } catch (e) { stop = e.message; }
    const turn = (n) => (m2.turns.get(n) ?? 0) - (turns0[n] ?? 0);
    ok(turn('MDET_E_SEND_CPU3') === 1 && turn('MDET_CALC_MAIN_CPU3') === 1 && m2.events.length === ev0 + 1 &&
      m2.events.at(-1)[0] === f.events.laf_start_request && stop?.includes(`0x${PDT_DISPATCH.toString(16)}`),
      `mdet_laf_start: one turn of MDET_E_SEND_CPU3 and of MDET_CALC_MAIN_CPU3 for the start request, then the stop at MDET_PDT_CPU3's dispatch: ${JSON.stringify({ e_send: turn('MDET_E_SEND_CPU3'), calc_main: turn('MDET_CALC_MAIN_CPU3'), events: m2.events.slice(ev0) })} ${stop?.slice(0, 160)}`);
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
