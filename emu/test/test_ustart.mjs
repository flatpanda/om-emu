// The firmware's start tasks and the start probe (bin/ustart.mjs; docs/hle-gaps.md 4.6.3), E143:
//   ustartMap    (the image, no lab) the start conditions' code as the map gives it: every call of the phase wait
//                0x50024de8 and of the phase test 0x50024dcf with its phase, SetPermit's four calls (1, 2, 4, 5), the
//                start flag's sets and the state waits, each by its site; the phase setter 0x50024eda has no direct
//                caller (USTART_L2 posts it as a CREQ)
//   ustartProbe  the probe's record of each start task, run natively in a bare lab of its own from the state the lab's
//                reset path leaves: the boot marks it reaches, the tasks it would start (S-NOSTART), the start
//                conditions granted in order (S-STARTCOND; the first is its first stop in the lab as it is) and the
//                stop that ends the run:
//                  BOOT_CPU0      spins on the other cores' done bytes; then stage 0's first call writes the
//                                 address-decode monitor at 0x9a000004 (a bus error)
//                  USRSTART_LOAD  waits for the bytes 0xa32df1ad and 0xa32df1b7; then the resource loader's first
//                                 NAND access writes 0x98d011c0
//                  USR_FAST_APP   waits for the camera-on word; then waits on its flag 0x82, pattern 0x1ff
//                  USRSTART2      waits for phase 2 and the idle magics of CPUs 1..3; then the motion engine's init
//                                 writes 0x98800344
//                  USRSTART3      waits for the phases 3 and 4; then EXP's 0x5055368d divides by zero
//                  USRSTART4      waits for the phases 6 and 7; then MainSystem.cpp's init waits for an answer of the
//                                 tasks it started (1 s semaphore waits, retried)
//                  USRSTART5      waits for the phases 8, 9 and 10; then 0x518f724a's NAND access writes 0x98d011c0
//                and the check of what USRSTART3's stop needs: with EXP's init 0x50553649 (USRSTART2's call at
//                0x501e90c4) run first it does not divide, goes on to the mark 3_a and stops at the DML driver's
//                write of 0x98800348; a second run of a task gives the same record; an unknown task is refused; a
//                condition the probe misreads (a poll pointed at another word) is an error after 5000 ticks
//   node emu/test/test_ustart.mjs
import { fileURLToPath } from 'node:url';

const h = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// every direct call of target in the image: [site, the n of an imm8 `mov n,d0` (80 nn) right before it, or null]
function calls(image, target) {
  const out = [], t = (target - 0x50000000) >>> 0;
  const s16 = (o) => ((image[o] | image[o + 1] << 8) << 16) >> 16, s32 = (o) => image[o] | image[o + 1] << 8 | image[o + 2] << 16 | image[o + 3] << 24;
  for (let i = 2; i + 7 <= image.length; i++) {
    if ((image[i] === 0xDD && ((i + s32(i + 1)) >>> 0) === t) || (image[i] === 0xCD && ((i + s16(i + 1)) >>> 0) === t)) out.push([0x50000000 + i, image[i - 2] === 0x80 ? image[i - 1] : null]);
  }
  return out;
}
// the map's call sites (D): the phase waits by caller, the phase tests, SetPermit, the start flag's sets, the state
// waits. BOOT_CPU1..3 wait for phase 1 before their first overlay call; AUD_MAIN (0x50a62a48) waits for 6
const WAITS = [[0x50008CE7, 1], [0x50009072, 1], [0x50009474, 1],                       // BOOT_CPU1, 2, 3
  [0x5002422B, 2], [0x50024299, 4], [0x5002435C, 8],                                     // USRSTART_LOAD
  [0x50024803, 7], [0x5002483F, 8],                                                      // USTART_L2
  [0x500248D0, 1],                                                                       // stage 1
  [0x501E8EA5, 2], [0x501E94D3, 3], [0x501E94E9, 4], [0x501E9D80, 6], [0x501E9D89, 7],   // USRSTART2, 3, 3, 4, 4
  [0x501E9EC2, 8], [0x501E9ED8, 9], [0x501E9EEE, 10],                                    // USRSTART5
  [0x50A62A48, 6], [0x50A6C5B4, 9], [0x5187D20F, 9]];
const TESTS = [[0x50023B4E, 2], [0x50024DEA, null], [0x5004066C, 9], [0x50040683, 9], [0x500406C8, 9], [0x500406DF, 9], [0x50047391, 10],
  [0x5016ECAD, 3], [0x5018A5F0, 3], [0x502A52AB, 6], [0x502A52CB, 6], [0x50954C53, 9]];
const PERMITS = [[0x501E90AB, 1], [0x501E9226, 2], [0x501E9CC7, 4], [0x501E9E43, 5]];
// (0x501e8a74's is `mov 128,d0`, the imm16 form 2c 80 00, whose tail reads as an imm8 0 here)
const FLAG_SETS = [[0x50024D2F, 1], [0x501E8A74, 0], [0x501E9054, 2], [0x501E9CDB, 8]];
const STATE_WAITS = [[0x50024370, 13], [0x501E6AF2, 4], [0x501E8A7B, 13]];

export async function ustartMap() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage } = await import('../checks/lib/env.mjs');
  const { START_E143 } = await import('../bin/ustart.mjs');
  const image = loadImage(), S = START_E143;
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
  const show = (xs) => xs.map(([a, n]) => `${a.toString(16)}:${n}`).join(' ');
  ok(image[0x24DE8] === 0x82 && image[0x24DF6] === 0xDD, 'the image\'s offsets are the body\'s (the phase wait at 0x50024de8)');
  for (const [name, fn, want] of [['the phase wait', S.phase.wait, WAITS], ['the phase test', 0x50024DCF, TESTS], ['SetPermit', 0x501E6A7F, PERMITS],
    ['the start flag\'s set', 0x501E6A6D, FLAG_SETS], ['the state wait', 0x501E6A34, STATE_WAITS]]) {
    const got = calls(image, fn);
    ok(same(got, want), `${name} ${h(fn)}: its callers ${show(got)}, want ${show(want)}`);
  }
  ok(calls(image, S.phase.set).length === 0, `the phase setter ${h(S.phase.set)} has direct callers ${show(calls(image, S.phase.set))}`);
  // the waits' sleeps the probe reads the conditions from: each a return address right after a call
  for (const ret of [S.phase.poll, ...S.polls.keys()]) {
    const o = ret - 0x50000000;
    ok(image[o - 7] === 0xDD || image[o - 5] === 0xCD, `${h(ret)} does not follow a call`);
  }
  return { checks, bad };
}

// the probe's records (X): per task its marks, the ids it would start, the conditions granted [what, n, at, address]
// and the stop's fields; chain: return addresses the stop's call chain holds
const RECORDS = {
  BOOT_CPU0: { marks: 'OIE SCS SCE 0_1', starts: [0x99, 0x9A, 0x94, 0x2B],
    granted: [['done-bytes', null, '0x5002cd70', '0x97f00095,0x97f00096,0x97f00097']],
    stop: { kind: 'fault', code: 2, pc: '0x50031a6c', access: 'write', address: '0x9a000004', value: '0x000001fe' }, chain: ['0x50023ede', '0x5002cdaf'] },
  USRSTART_LOAD: { marks: 'L_0 L_2 RES', starts: [],
    granted: [['byte', null, '0x5002419d', '0xa32df1ad'], ['byte', null, '0x500241bf', '0xa32df1b7']],
    stop: { kind: 'fault', code: 2, pc: '0x50000e32', access: 'write', address: '0x98d011c0', value: '0x00000001' }, chain: ['0x50002304', '0x501a98a4', '0x501a8cd2', '0x500241df'] },
  USR_FAST_APP: { marks: 'MIS', starts: [],
    granted: [['camera-on', null, '0x501e677c', '0xa32dddcc']],
    stop: { kind: 'wait', call: 'OlyEvWt', object: 0x82, pattern: 0x1FF, from: '0x501e67ac' }, chain: ['0x501e67ac'] },
  USRSTART2: { marks: '2_1 2_5 2_6 2_7 2_8 2_9 2_b', starts: [0x6E, 0x26],
    granted: [['phase', 2, '0x501e8eac', '0xa32df1f4'], ['magics', null, '0x5003b691', '0xa3193680,0xa3193684,0xa3193688']],
    stop: { kind: 'fault', code: 2, pc: '0x501a5bd9', access: 'write', address: '0x98800344', value: '0x00000040' }, chain: ['0x501a5bc9', '0x501a6854', '0x501e8f67'] },
  USRSTART3: { marks: '3_1 3_2 3_3 3_4', starts: [0x52],
    granted: [['phase', 3, '0x501e94da', '0xa32df1f4'], ['phase', 4, '0x501e94f0', '0xa32df1f4']],
    stop: { kind: 'fault', code: 6, pc: '0x50578db0' }, chain: ['0x50578c0f', '0x50577ba7', '0x50553694', '0x501e9526'] },
  USRSTART4: { marks: '4_1 4_2 4_3 4_4 4_5', starts: [0xA1, 0xA2, 0x39, 0xA3, 0xA4],
    granted: [['phase', 6, '0x501e9d87', '0xa32df1f4'], ['phase', 7, '0x501e9d90', '0xa32df1f4']],
    stop: { kind: 'timed-wait', at: '0x50d9b0e4', ticks: 5000 }, chain: ['0x50af8563'] },
  USRSTART5: { marks: '5_1 5_2 5_3 5_4', starts: [],
    granted: [['phase', 8, '0x501e9ec9', '0xa32df1f4'], ['phase', 9, '0x501e9edf', '0xa32df1f4'], ['phase', 10, '0x501e9ef5', '0xa32df1f4']],
    stop: { kind: 'fault', code: 2, pc: '0x50001129', access: 'write', address: '0x98d011c0', value: '0x00000001' }, chain: ['0x50002304', '0x518f72a6', '0x501e9efc'] },
};
// USRSTART3 with EXP's init first: its marks, and the stop at the DML driver's init (0x507f906b, called at 0x501e9719)
const WITH_EXP = { before: 0x50553649, marks: '3_1 3_2 3_3 3_4 3_5 3_6 3_7 3_8 3_a',
  granted: [['phase', 3], ['phase', 4], ['byte', null, '0x501e9683', '0xa32df1bc']],
  stop: { kind: 'fault', code: 2, pc: '0x507f68d3', access: 'write', address: '0x98800348', value: '0x10000000' }, chain: ['0x507f9070', '0x501e9720'] };

export async function ustartProbe() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { StartProbe, StartProbeError, START_E143 } = await import('../bin/ustart.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash };
  const probe = new StartProbe(env);
  const fields = (stop, want) => Object.entries(want).every(([k, v]) => stop[k] === v);
  const grants = (r) => r.granted.map((g) => [g.what, g.n ?? null, g.at, String(g.address)]);
  let recs = null;
  try { recs = probe.run(); } catch (e) { bad.push(`the probe: ${e.message.slice(0, 600)}`); }
  if (recs !== null) {
    ok(recs.map((r) => r.task).join() === START_E143.tasks.map(([n]) => n).join() && recs.length === Object.keys(RECORDS).length, `the start tasks probed: ${recs.map((r) => r.task)}`);
    for (const r of recs) {
      const w = RECORDS[r.task];
      if (!w) continue;
      ok(r.marks.join(' ') === w.marks, `${r.task}: its boot marks "${r.marks.join(' ')}", want "${w.marks}"`);
      ok(JSON.stringify(r.starts.map((s) => s.id)) === JSON.stringify(w.starts), `${r.task}: the tasks it would start ${JSON.stringify(r.starts.map((s) => [s.id.toString(16), s.name]))}`);
      ok(JSON.stringify(grants(r)) === JSON.stringify(w.granted), `${r.task}: the conditions granted ${JSON.stringify(grants(r))}, want ${JSON.stringify(w.granted)}`);
      ok(fields(r.stop, w.stop) && w.chain.every((c) => r.stop.chain.includes(c)), `${r.task}: its stop ${JSON.stringify(r.stop)}, want ${JSON.stringify(w.stop)} with ${w.chain} in the chain`);
    }
    // the names the firmware logs for its starts (BOOT_CPU0's: the third is logged under the first's name)
    const boot = recs.find((r) => r.task === 'BOOT_CPU0');
    ok(boot && boot.starts.map((s) => s.log).join() === 'CPUCONN0,CPUSW0,CPUCONN0,USTART_L' && boot.starts[3].name === 'USRSTART_LOAD' && boot.starts[3].how === 'OlyTaSt',
      `BOOT_CPU0's starts as logged: ${JSON.stringify(boot?.starts)}`);
    // the same record from a second run
    try {
      const [again] = probe.run(['USRSTART2']);
      ok(JSON.stringify(again) === JSON.stringify(recs.find((r) => r.task === 'USRSTART2')), 'USRSTART2: a second run gives another record');
    } catch (e) { bad.push(`USRSTART2 again: ${e.message.slice(0, 400)}`); }
  }
  // what USRSTART3's divide needs: EXP's init, which USRSTART2 runs before it on the camera
  try {
    const [r] = probe.run(['USRSTART3'], [WITH_EXP.before]);
    ok(r.marks.join(' ') === WITH_EXP.marks, `USRSTART3 after EXP's init: its marks "${r.marks.join(' ')}"`);
    ok(WITH_EXP.granted.every((w, i) => w.every((v, k) => grants(r)[i]?.[k] === v)) && r.granted.length === WITH_EXP.granted.length, `USRSTART3 after EXP's init: granted ${JSON.stringify(grants(r))}`);
    ok(fields(r.stop, WITH_EXP.stop) && WITH_EXP.chain.every((c) => r.stop.chain.includes(c)), `USRSTART3 after EXP's init: its stop ${JSON.stringify(r.stop)}`);
    ok(r.starts.length === 15 && r.starts[1].name === 'FCS_MOVIE' && r.starts[14].name === 'SDET', `USRSTART3 after EXP's init: its starts ${r.starts.map((s) => s.name)}`);
  } catch (e) { bad.push(`USRSTART3 after EXP's init: ${e.message.slice(0, 600)}`); }
  let refused = null;
  try { probe.run(['USRSTART1']); } catch (e) { if (e instanceof StartProbeError) refused = e.message; else throw e; }
  ok(refused !== null && /no start task USRSTART1/.test(refused), `an unknown task is refused: ${refused}`);
  // a condition the probe misreads: USR_FAST_APP's camera-on poll pointed at another word, which the probe then sets
  // while the task sleeps on 0xa32dddcc: an error after 5000 ticks, not a stop and not a run without end
  const wrong = new StartProbe(env);
  wrong.S = { ...START_E143, polls: new Map([...START_E143.polls].map(([k, v]) => [k, k === 0x501E677C ? ['camera-on', 0xA32DDDD0, 4, 1, 'a wrong word'] : v])) };
  let misread = null;
  try { wrong.run(['USR_FAST_APP']); } catch (e) { if (e instanceof StartProbeError) misread = e.message; else throw e; }
  ok(misread !== null && /polled at 0x501e677c holds, and the task has slept on it for 5000 ticks/.test(misread), `a misread condition: ${misread}`);
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await ustartMap();
  console.log(`the start conditions' call sites: ${m.checks - m.bad.length}/${m.checks}`);
  m.bad.forEach((x) => console.log('  ', x));
  const p = await ustartProbe();
  console.log(`the start probe: ${p.checks - p.bad.length}/${p.checks}`);
  p.bad.forEach((x) => console.log('  ', x));
  process.exit(m.bad.length || p.bad.length ? 1 : 0);
}
