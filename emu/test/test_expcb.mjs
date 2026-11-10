// The EXP callback that writes the AE results (docs/hle-gaps.md 4.2.2), E143, round 1: how far TAKE_EXPOSE's AE
// request for the through start runs natively, and where it stops. Addresses are E143's (D unless tagged).
//   expCallbackSession  two sessions with --take probe and --cpu2 native (camapp 1). Each brings up what USTART2's
//                       stage 0x501e8e84 runs and the lab does not: IMG_PRECON's module init 0x502a49b3 (its call at
//                       0x501e8ec0; it builds the white-balance table 0xa31f1bd0 through 0x5039814c -> 0x5039950e),
//                       EXP's init 0x50553649 (0x501e90c4), EXP_MOVIE (task 88, entry 0x50553697, started at
//                       0x501e90f3) and, on CPU 2, EXP_MOVIE2 0x2009 and EXP_MOVIE3 0x200a through the cross-core start
//                       0x5002c546 as the stage starts them (0x501e910e, 0x501e912f); EXP's queues EXP_MOVIE 0x17 and
//                       EXP_MOVIE_POST 0x18 go natively. Then the test posts TAKE_EXPOSE's command 0xa00, the request
//                       the through start makes (TAKE_FUNC command 25 -> 0x506d83f9 with d0 32, its send at
//                       0x506d8645), which the lab does not reach. Its 52-byte parameter is filled by 0x506d8b0c from
//                       command 25's parameter, which the lab does not have: the test gives zeros with byte 0, the
//                       through mode, 0 or 1 (the two values the mode table 0x5059f204 holds; I), one session each.
//                       Both: command 0xa00 builds the AE request of kind 1280 (0x505964e7, its +0 callback the
//                       writer's 0x5059757f); EXP's entry 0x505536be hands it to EXP_MOVIE, whose handler 0x5058bd51 ->
//                       0x5058c97c sends the evaluation 0x50556995 to CPU 2 (0x50556af4: record 0xa3343900, flag 0x2002
//                       bit 0x1000000) and waits for CPU 0's flag 17 bit 0x2000000; EXP_MOVIE3 runs it and posts
//                       0x50573383(0x2000000) back; EXP_MOVIE goes on to the white balance (0x5056afe2). Mode 0: the
//                       white balance ends, the handler has given the camera driver its request 7 with EXP's frame
//                       callbacks (record 0x62a98a0c from 0x5056a6e4: 0x5056fd44, 0x5056fd61, 0x5056fff0, 0x50570024),
//                       none of which runs (cam.c's own init does not run in the lab, docs/hle-gaps.md 4.1.4), and
//                       EXP_MOVIE waits on its flag 21 for bit 0x1000 (0x5056ba07 -> 0x50585dc2). Mode 1: the white
//                       balance takes its gains from the table (kind 5 of 0x5039821c) and stops at the divide
//                       0x50398ca5 (fault 6) in 0x50398a55, whose operands are both 0: the two gains 0x5056f1bb hands
//                       0x5039821c through its locals (sp+16) and (sp+18), which it never writes (D). In neither does
//                       the request's callback or the AE result writer 0x50596187 run, so S-EXPOSE stays
//   aeReadersSession    S-EXPOSE's readers in a default session (below)
//   node emu/test/test_expcb.mjs
import { fileURLToPath } from 'node:url';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const E = {
  imgprecon_init: 0x502A49B3, exp_init: 0x50553649, exp_movie: { tid: 0x60042DD6, entry: 0x50553697 },
  cpu2_tasks: [[0x2009, 0x505536A4, 'EXP_MOVIE2'], [0x200A, 0x505536B1, 'EXP_MOVIE3']], start_cpu: 0x5002C546,
  queues: [0x17, 0x18], olyqewr: 0x5002C151, take_expose: 0x5B, evwt: 0x5002BDD8,
  wb_table: 0xA31F1BD0, wb_table_size: 112,
  launcher: 0x505964E7, exp_entry: 0x505536BE, handler: 0x5058BD51, eval: 0x5058C97C, offload: 0x50556AF4,
  wb: 0x5056AFE2, divide: 0x50398CA5, writer: 0x50596187, callback_call: 0x5058CDB7,
  cam_switch: 0x502A4A46, frame_record: 0x62A98A0C, frame_callbacks: [0x5056FD44, 0x5056FD61, 0x5056FFF0, 0x50570024],
};

async function session(mode) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { CPU2_TASKS } = await import('../src/lab/cpu2.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  // core 2 parks a task start whose entry it does not list (cpu2.mjs CPU2_TASKS): EXP's two CPU 2 servers, for these
  // sessions only
  for (const [, entry, name] of E.cpu2_tasks) CPU2_TASKS.set(entry, name);
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' }, env);
  const out = { mode };
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, take = s.camapp.take;
    const u16 = (a, n) => { const b = lab.sim.read(a, 2 * n); return [...Array(n)].map((_, i) => b[2 * i] | b[2 * i + 1] << 8); };
    const marks = out.marks = [];
    const mark = (at, name, f = null) => lab.observe(at, (l, r) => marks.push({ name, ...(f ? f(l, r) : {}) }), `expcb ${name}`);
    mark(E.launcher, 'launcher', (l, r) => ({ kind: r.d0 & 0xFFFF }));
    mark(E.exp_entry, 'EXP entry', (l, r) => ({ kind: u16((r.a0 >>> 0) + 24, 1)[0], callback: h8(disasm(l.sim.u32(r.a0 >>> 0) >>> 0)) }));
    mark(E.handler, 'EXP_MOVIE kind handler');
    mark(E.eval, 'EXP evaluation');
    mark(E.offload, 'offload to CPU 2', (l, r) => ({ fn: h8(disasm(r.a0 >>> 0)), arg: h8(r.a1) }));
    mark(E.wb, 'white balance');
    mark(E.divide, 'divide', (l, r) => ({ d0: r.d0 >>> 0, d1: r.d1 >>> 0 }));
    mark(E.callback_call, 'callback');
    mark(E.writer, 'writer');
    mark(E.cam_switch, 'camera driver request', (l, r) => ({ id: u16(r.a0 >>> 0, 1)[0], record: h8(r.a0), from: h8(disasm(r.mdr)) }));
    for (const f of E.frame_callbacks) mark(f, 'frame callback');
    mark(E.evwt, 'OlyEvWt', (l, r) => ({ flag: r.d0 & 0xFFFF, bits: h8(r.d1), from: h8(disasm(r.mdr)) }));
    // the bring-up USTART2's stage would have made
    out.wb0 = u16(E.wb_table, E.wb_table_size / 2);
    out.imgprecon = lab.call(E.imgprecon_init, null, null, null, 20000000).d0 >>> 0;
    s.settle('expcb IMG_PRECON init');
    out.wb1 = u16(E.wb_table, E.wb_table_size / 2);
    out.exp_init = lab.call(E.exp_init, null, null, null, 20000000).d0 >>> 0;
    s.settle('expcb EXP init');
    const tid = out.tid = lab.sim.read(E.exp_movie.tid, 2).reduce((a, b, k) => a | b << 8 * k, 0);
    out.entry = lab.nk.entry(tid);
    lab.lt.allow.add(out.entry);
    [out.act] = lab.nk.svc('act_tsk', { d0: tid });
    s.settle('expcb EXP_MOVIE');
    out.state0 = lab.nk.state(tid);
    out.started = [];
    for (const [t] of E.cpu2_tasks) {
      out.started.push(lab.call(E.start_cpu, { d0: t }, null, null, 20000000).d0 >>> 0);
      s.settle(`expcb start 0x${t.toString(16)}`);
    }
    out.cpu2_starts = s.cpu2.take_log().filter(([k]) => k === 'start').map(([, n]) => n);
    for (const q of E.queues) take.native.add(q);
    marks.length = 0;
    // TAKE_EXPOSE's command 0xa00, the through start's request (no reply queue: nothing in the lab waits for it)
    const param = lab.alloc(new Uint8Array(52), 4);
    lab.sim.write(param, Uint8Array.of(mode));
    const msg = lab.alloc(pack('<IIII', 0, 1, 0xA00, param), 4), desc = lab.alloc(pack('<II', msg, 16), 4);
    out.posted = lab.call(E.olyqewr, { d0: E.take_expose, d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000).d0;
    try { s.settle('expcb TAKE_EXPOSE 0xa00'); } catch (e) { out.stop = e.message; }
    out.state = lab.nk.state(tid);
    out.back = s.cpu2.posts.filter((p) => p.fn === h8(0x50573383));
  } catch (e) { out.error = e.message.slice(0, 800); }
  finally { for (const [, entry] of E.cpu2_tasks) CPU2_TASKS.delete(entry); }
  pl.close_session();
  return out;
}

export async function expCallbackSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  for (const mode of [0, 1]) {
    const r = await session(mode), m = r.marks ?? [];
    if (r.error) { bad.push(`mode ${mode}: ${r.error}`); continue; }
    const first = (n) => m.find((x) => x.name === n), names = m.map((x) => x.name);
    ok(r.imgprecon === 0 && r.wb0.every((v) => v === 0) && r.wb1.some((v) => v !== 0),
      `mode ${mode}: IMG_PRECON's init returns ${r.imgprecon} and fills the white-balance table (${r.wb0.filter((v) => v).length} -> ${r.wb1.filter((v) => v).length} nonzero)`);
    ok(r.exp_init === 0 && r.tid === 88 && r.entry === E.exp_movie.entry && r.act === 0 && (r.state0 & 0xF) === 4
      && r.started.every((x) => x === 0) && E.cpu2_tasks.every(([, , n]) => r.cpu2_starts.includes(n)),
      `mode ${mode}: EXP's init (${r.exp_init}), EXP_MOVIE (task ${r.tid}, ${h8(r.entry)}, state ${r.state0}) and EXP_MOVIE2 / 3 on CPU 2 (${r.started}, ${JSON.stringify(r.cpu2_starts)}) start and wait`);
    ok(r.posted === 0 && first('launcher')?.kind === 1280 && first('EXP entry')?.kind === 1280 && first('EXP entry')?.callback === h8(0x5059757F),
      `mode ${mode}: command 0xa00 builds the AE request of kind 1280 with the callback 0x5059757f (${JSON.stringify(m.slice(0, 2))})`);
    const off = first('offload to CPU 2');
    ok(off?.fn === h8(0x50556995) && off?.arg === h8(0xA3343900) && r.back.length === 1 && r.back[0].arg === h8(0x2000000) && r.back[0].task === '0x200a',
      `mode ${mode}: EXP_MOVIE's evaluation runs on CPU 2 (EXP_MOVIE3) and posts its end back (${JSON.stringify(off)} ${JSON.stringify(r.back)})`);
    const order = ['EXP_MOVIE kind handler', 'EXP evaluation', 'offload to CPU 2', 'white balance'];
    ok(JSON.stringify(names.filter((n) => order.includes(n))) === JSON.stringify(order), `mode ${mode}: EXP_MOVIE goes on after CPU 2's answer (${JSON.stringify(names.filter((n) => order.includes(n)))})`);
    ok(!names.includes('callback') && !names.includes('writer'), `mode ${mode}: the request's callback and the AE result writer do not run`);
    if (mode === 0) {
      const req = m.filter((x) => x.name === 'camera driver request' && x.record === h8(E.frame_record));
      const wait = m.filter((x) => x.name === 'OlyEvWt' && x.from === h8(0x50585DD5)).at(-1);
      ok(r.stop === undefined && !names.includes('divide') && req.length === 1 && req[0].id === 7 && !names.includes('frame callback')
        && wait?.flag === 21 && wait?.bits === h8(0x1000) && (r.state & 0xF) === 4,
        `mode 0: the camera driver gets request 7 with EXP's frame callbacks (${JSON.stringify(req)}), none runs, and EXP_MOVIE waits on flag 21 bit 0x1000 (${JSON.stringify(wait)}, state ${r.state}, stop ${r.stop})`);
    } else {
      const div = first('divide');
      ok(/disasm 0x50398ca5\) fault=6/.test(r.stop ?? '') && div?.d0 === 0 && div?.d1 === 0,
        `mode 1: the white balance stops at the divide 0x50398ca5 with 0 / 0 (${JSON.stringify(div)}, ${String(r.stop).slice(0, 160)})`);
    }
  }
  return { checks, bad };
}

// S-EXPOSE's readers in a default session (camapp 1, no probe): every property read of the three AE result objects
// 0xc12a / 0xc0ba / 0xc0ca through the getter 0x500417da, every set through 0x5004188b, the application's get by
// index 0x503ee3c8 for their indices 4011..4013 (the list 0x606239e4 + 2 (index - 4000)) and every run of the plan
// take_expose_calculate 0x50597e82, over a pass of S-EXPOSE again, an idle, a live view, S1, S2, the menu, a mode
// change P -> A and playback. The objects are read only by the plan's reader 0x50598688 (0x505986cb, 0x505986f9,
// 0x50598728) and by the index get's 0x503ef27c; the plan runs from S-EXPOSE's call and natively through the API
// 0x20009 (0x50597dc0's call at 0x50597dfa) at the mode change, where the index get runs too (from 0x503eec3e); only
// S-EXPOSE sets them, and the AE result writer 0x50596187 never runs
const READERS = new Set([0x505986CB, 0x505986F9, 0x50598728, 0x503EF27C].map(h8));
export async function aeReadersSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm, CALLER } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  const IDS = [0xC12A, 0xC0BA, 0xC0CA];
  const rec = [];
  let phase = 'start';
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab;
    const harness = (r) => { const d = (r.mdr >>> 0) - (CALLER >>> 0); return d >= 0 && d < 0x100; };   // the lab's own call (S-EXPOSE)
    const from = (r) => (harness(r) ? 'lab' : h8(disasm(r.mdr)));
    lab.observe(0x500417DA, (l, r) => { if (IDS.includes(r.d0 & 0xFFFF)) rec.push({ phase, what: 'get', id: r.d0 & 0xFFFF, from: from(r) }); }, 'expcb get');
    lab.observe(0x5004188B, (l, r) => { if (IDS.includes(r.d0 & 0xFFFF)) rec.push({ phase, what: 'set', id: r.d0 & 0xFFFF, from: from(r) }); }, 'expcb set');
    lab.observe(0x503EE3C8, (l, r) => { const i = r.d0 & 0xFFFF; if (i >= 4011 && i <= 4013) rec.push({ phase, what: 'index get', index: i, from: from(r) }); }, 'expcb index');
    lab.observe(0x50597E82, (l, r) => rec.push({ phase, what: 'plan', from: from(r) }), 'expcb plan');
    lab.observe(0x50596187, (l, r) => rec.push({ phase, what: 'writer', from: from(r) }), 'expcb writer');
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); } };
    const press = (k, ms) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(ms); };
    phase = 'S-EXPOSE'; s.camapp.expose();
    phase = 'idle'; idle(300);
    phase = 'live view'; s.scene_input({ liveview: true }); s.camapp.pump(); idle(500);
    phase = 'S1 S2'; s.key('s1', 'down'); s.camapp.pump(); idle(400); s.key('s2', 'down'); s.camapp.pump(); idle(500);
    s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(500);
    phase = 'menu'; press('menu', 600); press('menu', 600);
    phase = 'mode'; const names = s.status().mode_dial_positions.map((p) => p.name); s.switch_input('mode_dial', names.indexOf('A')); s.camapp.pump(); idle(1500);
    phase = 'play'; press('play', 600); press('play', 600);
  } catch (e) { bad.push(`aeReadersSession (${phase}): ${e.message.slice(0, 600)}`); }
  pl.close_session();
  const gets = rec.filter((x) => x.what === 'get'), sets = rec.filter((x) => x.what === 'set');
  const plans = rec.filter((x) => x.what === 'plan'), index = rec.filter((x) => x.what === 'index get');
  ok(gets.length > 0 && gets.every((x) => READERS.has(x.from)), `the AE result objects are read only by the plan and the index get: ${JSON.stringify([...new Set(gets.map((x) => `${x.phase} ${x.from}`))])}`);
  ok(sets.length === 3 && sets.every((x) => x.from === 'lab') && !rec.some((x) => x.what === 'writer'),
    `only S-EXPOSE sets them (${sets.length} sets: ${JSON.stringify([...new Set(sets.map((x) => x.from))])}) and the writer 0x50596187 never runs`);
  const native = plans.filter((x) => x.from !== 'lab');
  ok(native.length > 0 && native.every((x) => x.phase === 'mode' && x.from === h8(0x50597DFA)) && plans.filter((x) => x.from === 'lab').length === 1,
    `the plan runs natively only at the mode change, from 0x50597dfa (${JSON.stringify(plans.map((x) => `${x.phase} ${x.from}`))})`);
  ok(index.length === 3 && index.every((x) => x.phase === 'mode' && x.from === h8(0x503EEC3E)), `the index get reads them only at the mode change (${JSON.stringify(index)})`);
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await expCallbackSession();
  console.log(`the EXP callback, round 1: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  const a = await aeReadersSession();
  console.log(`S-EXPOSE's readers: ${a.checks - a.bad.length}/${a.checks}`);
  a.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || a.bad.length ? 1 : 0);
}
