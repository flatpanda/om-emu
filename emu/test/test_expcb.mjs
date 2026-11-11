// The EXP callback that writes the AE results (docs/hle-gaps.md 4.2.2), E143, round 1: how far TAKE_EXPOSE's AE
// request for the through start runs natively, and where it stops; round 2 (4.2.3): with cam.c's init native. Addresses
// are E143's (D unless tagged).
//   expCallbackSession  two sessions with --take probe and --cpu2 native (camapp 1). Since round 2 the probe brings up
//                       what USTART2's stage 0x501e8e84 runs for EXP and the lab did not (H-EXPINIT, src/lab/take.mjs;
//                       the test made these steps by hand before): IMG_PRECON's module init 0x502a49b3 (its call at
//                       0x501e8ec0; it builds the white-balance table 0xa31f1bd0 through 0x5039814c -> 0x5039950e),
//                       EXP's init 0x50553649 (0x501e90c4), EXP_MOVIE (task 88, entry 0x50553697, started at
//                       0x501e90f3) and, on CPU 2, EXP_MOVIE2 0x2009 and EXP_MOVIE3 0x200a through the cross-core start
//                       0x5002c546 as the stage starts them (0x501e910e, 0x501e912f); EXP's queues EXP_MOVIE 0x17 and
//                       EXP_MOVIE_POST 0x18 go natively; and cam.c's first init (H-CAMINIT). Then the test posts
//                       TAKE_EXPOSE's command 0xa00, the request
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
//                       none of which runs, and EXP_MOVIE waits on its flag 21 for bit 0x1000 (0x5056ba07 ->
//                       0x50585dc2). With cam.c's init (round 2) the driver takes both requests without its pool error
//                       0x0a103000; 0x0a283000 is logged three times, once by request 8's queue count and twice by
//                       request 7's posts (the movie sequence's queues are registered by the second init, which does
//                       not run), and nothing fires the callbacks (docs/hle-gaps.md 4.2.3). On this path its
//                       answer to EXP_MOVIE_POST comes after that wait (0x5058cbe7; 0x5058c84a answers 2, 0x5058c963
//                       0), so TAKE_EXPOSE stays in its receive (0x505539af); the callback's status inputs
//                       (0x62abd550) and (0x62abd558) are 0, which would give it status 2 (0x5058cd54). Mode 1: the
//                       white balance takes its gains from the table (kind 5 of 0x5039821c) and stops at the divide
//                       0x50398ca5 (fault 6) in 0x50398a55, whose operands are both 0: 0x50398a55 scales the table's
//                       values by the words its request's +32 and +36 point to, 0x5056f1bb's locals (sp+16) and
//                       (sp+18), which it never writes (D); the words +24 and +28 point to come from the table. The
//                       through mode lands in 0x62abd7a0, whose mask 1 makes the callback skip the writer
//                       (0x505975ba). In neither does the request's callback or the AE result writer 0x50596187 run,
//                       so S-EXPOSE stays
//   camDriverSession    round 2 (docs/hle-gaps.md 4.2.3): cam.c natively (below)
//   camFrontEndSession  round 3 (docs/hle-gaps.md 4.2.5): cam.c's second init against S-CAMFE (below)
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
  // EXP_MOVIE_POST: the answer 0x5057240c, the caller's receive in 0x50553942 (the call, its return)
  post_answer: 0x5057240C, caller_wait: 0x505539AF, caller_back: 0x505539B6,
  // the status the callback gets is 0 only when (0x62abd550) = 2 and (0x62abd558) = 1 (0x5058cd54..0x5058cd6d);
  // the callback skips the writer while mask 1 of the through mode (0x62abd7a0) is set (0x505975ba)
  status_word: 0x62ABD550, status_byte: 0x62ABD558, through_mode: 0x62ABD7A0, scale: 0x50398A55,
};

async function session(mode) {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
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
    // (the camera driver's switch carries S-TAKECAM's hook, which records the requests of other tasks: take.cam.native)
    for (const f of E.frame_callbacks) mark(f, 'frame callback');
    mark(E.post_answer, 'EXP_MOVIE_POST answer', (l, r) => ({ from: h8(disasm(r.mdr)) }));
    mark(E.caller_wait, 'caller waits on EXP_MOVIE_POST');
    mark(E.caller_back, 'caller has the answer');
    // the words 0x50398a55 reads through its request's pointers +24, +28, +32, +36
    mark(E.scale, 'scale', (l, r) => ({ words: [24, 28, 32, 36].map((k) => u16(l.sim.u32((r.a0 >>> 0) + k) >>> 0, 1)[0]) }));
    // the bring-up USTART2's stage makes, by the probe (H-EXPINIT) before the application started
    out.used = pl.stand_ins_in_use().filter((x) => x === 'H-EXPINIT' || x === 'H-CAMINIT');
    out.wb1 = u16(E.wb_table, E.wb_table_size / 2);
    const tid = out.tid = lab.sim.read(E.exp_movie.tid, 2).reduce((a, b, k) => a | b << 8 * k, 0);
    out.probe_tid = take.exp_tid;
    out.entry = lab.nk.entry(tid);
    out.state0 = lab.nk.state(tid);
    out.cpu2_starts = s.cpu2.started.map(([, n]) => n);
    out.native = E.queues.every((q) => take.native.has(q));
    // EXP_MOVIE's frame waits (take.mjs records them: the wait 0x50585dc2's flag and bits, its caller)
    const c0 = { native: take.cam.native.length, errlogs: take.cam.errlogs.length, waits: take.cam.waits.length };
    marks.length = 0;
    // TAKE_EXPOSE's command 0xa00, the through start's request (no reply queue: nothing in the lab waits for it)
    const param = lab.alloc(new Uint8Array(52), 4);
    lab.sim.write(param, Uint8Array.of(mode));
    const msg = lab.alloc(pack('<IIII', 0, 1, 0xA00, param), 4), desc = lab.alloc(pack('<II', msg, 16), 4);
    out.posted = lab.call(E.olyqewr, { d0: E.take_expose, d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000).d0;
    try { s.settle('expcb TAKE_EXPOSE 0xa00'); } catch (e) { out.stop = e.message; }
    out.state = lab.nk.state(tid);
    out.back = s.cpu2.posts.filter((p) => p.fn === h8(0x50573383));
    out.status_word = lab.sim.u32(E.status_word) >>> 0;
    [out.status_byte] = lab.sim.read(E.status_byte, 1);
    [out.through_mode] = lab.sim.read(E.through_mode, 1);
    out.cam_native = take.cam.native.slice(c0.native).map((x) => `${x.task} ${x.id}`);
    out.cam_requests = take.cam.native.slice(c0.native).map((x) => ({ id: x.id, record: h8(x.record), from: h8(x.from) }));
    out.cam_lines = take.cam.lines.slice(c0.errlogs).map(([c, l, f]) => `${h8(c)} line ${l} from ${h8(f)}`);
    out.cam_errlogs = take.cam.errlogs.slice(c0.errlogs);
    out.waits = take.cam.waits.slice(c0.waits).map((w) => ({ flag: w.flag, bits: h8(w.bits), from: h8(w.from) }));
  } catch (e) { out.error = e.message.slice(0, 800); }
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
    ok(JSON.stringify(r.used) === JSON.stringify(['H-CAMINIT', 'H-EXPINIT']) && r.wb1.some((v) => v !== 0),
      `mode ${mode}: the probe runs H-CAMINIT and H-EXPINIT (${r.used}), and IMG_PRECON's init has filled the white-balance table (${r.wb1.filter((v) => v).length} nonzero)`);
    ok(r.tid === 88 && r.probe_tid === 88 && r.entry === E.exp_movie.entry && (r.state0 & 0xF) === 4 && r.native
      && E.cpu2_tasks.every(([, , n]) => r.cpu2_starts.includes(n)),
      `mode ${mode}: EXP_MOVIE (task ${r.tid}, ${h8(r.entry)}, state ${r.state0}) waits, EXP_MOVIE2 / 3 run on CPU 2 (${JSON.stringify(r.cpu2_starts)}), EXP's queues are native (${r.native})`);
    ok(r.posted === 0 && first('launcher')?.kind === 1280 && first('EXP entry')?.kind === 1280 && first('EXP entry')?.callback === h8(0x5059757F),
      `mode ${mode}: command 0xa00 builds the AE request of kind 1280 with the callback 0x5059757f (${JSON.stringify(m.slice(0, 2))})`);
    const off = first('offload to CPU 2');
    ok(off?.fn === h8(0x50556995) && off?.arg === h8(0xA3343900) && r.back.length === 1 && r.back[0].arg === h8(0x2000000) && r.back[0].task === '0x200a',
      `mode ${mode}: EXP_MOVIE's evaluation runs on CPU 2 (EXP_MOVIE3) and posts its end back (${JSON.stringify(off)} ${JSON.stringify(r.back)})`);
    const order = ['EXP_MOVIE kind handler', 'EXP evaluation', 'offload to CPU 2', 'white balance'];
    ok(JSON.stringify(names.filter((n) => order.includes(n))) === JSON.stringify(order), `mode ${mode}: EXP_MOVIE goes on after CPU 2's answer (${JSON.stringify(names.filter((n) => order.includes(n)))})`);
    ok(!names.includes('callback') && !names.includes('writer'), `mode ${mode}: the request's callback and the AE result writer do not run`);
    if (mode === 0) {
      const req = r.cam_requests.filter((x) => x.record === h8(E.frame_record));
      const wait = r.waits.at(-1);
      ok(r.stop === undefined && !names.includes('divide') && req.length === 1 && req[0].id === 7 && !names.includes('frame callback')
        && wait?.flag === 21 && wait?.bits === h8(0x1000) && wait?.from === h8(0x5056BA2C) && (r.state & 0xF) === 4,
        `mode 0: the camera driver gets request 7 with EXP's frame callbacks (${JSON.stringify(req)}), none runs, and EXP_MOVIE waits on flag 21 bit 0x1000 (${JSON.stringify(wait)}, state ${r.state}, stop ${r.stop})`);
      // round 2: cam.c's init native; the movie sequence's queues are missing (0x0a283000 each time): request 8's queue
      // count (0x50151ffc, line 1032, returning to 0x5015201c), then request 7's two posts (0x50151e45, line 487,
      // returning to 0x50151e9e)
      ok(JSON.stringify(r.cam_native) === JSON.stringify(['EXP_MOVIE 8', 'EXP_MOVIE 7']) && r.cam_errlogs.length === 3 && r.cam_errlogs.every((c) => c === 0x0A283000)
        && JSON.stringify(r.cam_lines) === JSON.stringify(['0x0a283000 line 1032 from 0x5015201c', '0x0a283000 line 487 from 0x50151e9e', '0x0a283000 line 487 from 0x50151e9e']),
        `mode 0: cam.c takes EXP_MOVIE's requests natively (${JSON.stringify(r.cam_native)}) and logs ${JSON.stringify(r.cam_lines)} (want 0x0a283000 three times, no pool error 0x0a103000)`);
      if (process.env.TF_PRINT) console.log(JSON.stringify(r.cam_lines));
      ok(!names.includes('EXP_MOVIE_POST answer') && names.includes('caller waits on EXP_MOVIE_POST') && !names.includes('caller has the answer')
        && r.status_word === 0 && r.status_byte === 0 && r.through_mode === 0,
        `mode 0: EXP_MOVIE has not answered EXP_MOVIE_POST, TAKE_EXPOSE stays in its receive, and the status inputs are 0 / 0 (${JSON.stringify(m.filter((x) => /EXP_MOVIE_POST|answer/.test(x.name)))}, ${r.status_word} / ${r.status_byte}, through mode ${r.through_mode})`);
    } else {
      const div = first('divide'), sc = first('scale');
      ok(/disasm 0x50398ca5\) fault=6/.test(r.stop ?? '') && div?.d0 === 0 && div?.d1 === 0,
        `mode 1: the white balance stops at the divide 0x50398ca5 with 0 / 0 (${JSON.stringify(div)}, ${String(r.stop).slice(0, 160)})`);
      ok(sc?.words[0] !== 0 && sc?.words[1] !== 0 && sc?.words[2] === 0 && sc?.words[3] === 0 && (r.through_mode & 1) === 1,
        `mode 1: the scaling reads the table's two values and 0x5056f1bb's two unwritten gains (0), and the through mode's mask 1 is set, so the callback would skip the writer (${JSON.stringify(sc)}, through mode ${r.through_mode})`);
    }
  }
  return { checks, bad };
}

// Round 2 (docs/hle-gaps.md 4.2.3): cam.c natively, in a default session (camapp 1, no probe, so the switch has no
// stand-in), every step from the test. (1) cam.c's first init 0x502a49ec (USTART's call at 0x50024aa2, H-CAMINIT's):
// it returns 0, its only device accesses are the interrupt controller's for IRQs 146 and 147 (the attach through the
// timer API 0x50064323 with 8 and 9, offsets 0x248 / 0x24c of each bank), and it builds the request pool: its base word
// 0x629a71dc goes from 0 to the pool's block (with it 0 the allocator hands out base + 128 x head, address 0, which
// request 148's handler takes as a failed allocation), and the free list's head 0x6299726c, 0 before as well, moves
// (to 2: the init takes two entries; 0xffff would be empty). (2) Requests 148 and 144 made of the switch natively
// (192-byte records, +0 the id, +3 the argument 1, +72 TAKE's completion 0x502cd4d0, which TAKE_FUNC_CP's and
// TAKE_MAIN's requests carry): each is accepted (0) and posted as a deferred call (0x500504aa: 148 0x502a4b74, 144
// 0x5015582d), which queues an item of the driver's sequence engine (0x501524c0), touching no device but the interrupt
// controller and the deferred-call triggers, both modelled; neither is completed in 100 ms of idle and cam.c logs
// nothing; request 6 logs 0x0a273000 and is not deferred. (3) The second init 0x50155357 (USTART's call at
// 0x50024d80) step by step in its order: its first nine calls (0x50152401 .. 0x5019813d: among them the movie
// sequence's queues SQMV, MQEX, INFN and SMFM, 0x5019868e) return 0 and touch no device; request 6 is then deferred
// (0x50153844) and queues its item, and is not completed either. The tenth call, the front end's init 0x5016efcd,
// writes 0x98800340 (which the lab stub keeps) and then the camera clock gate 0x9b500800, which the lab does not model:
// the session stops there
const CAM = {
  init: 0x502A49EC, pool: 0x6299726C, pool_base: 0x629A71DC, sw: 0x502A4A46, completion: 0x502CD4D0,
  deferred: 0x500504AA, item: 0x501524C0, errlog: 0x501504D0, handlers: { 148: 0x502A4B74, 6: 0x50153844, 144: 0x5015582D }, no6: 0x0A273000,
  init2: [0x50152401, 0x50150B66, 0x501550BC, 0x50151D07, 0x5015F38F, 0x501A3559, 0x5019C70F, 0x5019868E, 0x5019813D],
  front_end: 0x5016EFCD,
};
export async function camDriverSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  let phase = 'start';
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, m = lab.sim.m;
    const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const errlogs = [], deferred = [], items = [], completions = [];
    lab.observe(CAM.errlog, (l, r) => errlogs.push(h8(r.d0)), 'camdrv errlog');
    lab.observe(CAM.deferred, (l, r) => deferred.push(h8(disasm(r.a0))), 'camdrv deferred');
    lab.observe(CAM.item, (l, r) => items.push(u16(r.a0 >>> 0)), 'camdrv item');
    lab.observe(CAM.completion, (l, r) => completions.push(h8(r.a0)), 'camdrv completion');
    // the device accesses (the lab's lock registers, which the kernel touches throughout, aside)
    let mmio = [];
    m.setMmioTrace((dir, a, v, w, name, cpu) => { if (cpu === 0 && name !== 'om1.isc-locks') mmio.push({ dir: dir ? 'W' : 'R', a: a >>> 0, name }); });
    phase = 'init';
    const head0 = u16(CAM.pool), base0 = lab.sim.u32(CAM.pool_base) >>> 0;
    const rc = lab.call(CAM.init, null, null, null, 20000000).d0 & 0xFFFF, head1 = u16(CAM.pool), base1 = lab.sim.u32(CAM.pool_base) >>> 0;
    s.settle('camdrv init');
    const irqs = [...new Set(mmio.map((x) => (x.a & 0xFFF) / 4))];
    ok(rc === 0 && !errlogs.length && base0 === 0 && base1 !== 0 && head0 === 0 && head1 !== head0 && head1 !== 0xFFFF && mmio.length > 0 && mmio.every((x) => x.name === 'om1.intc')
      && JSON.stringify(irqs) === JSON.stringify([146, 147]),
      `cam.c's init returns ${rc}, logs [${errlogs}], the pool's base ${h8(base0)} -> ${h8(base1)} and head ${head0} -> ${head1}, its device accesses ${JSON.stringify([...new Set(mmio.map((x) => `${x.dir} ${h8(x.a)} ${x.name}`))])} (IRQs ${irqs})`);
    // a request made natively, then 100 ms of idle: [the switch's d0, the deferred call, the items queued, completed,
    // the errors logged, the devices the call touched]
    const request = (id) => {
      const rec = lab.alloc(new Uint8Array(192), 4);
      lab.sim.write(rec, Uint8Array.of(id & 0xFF, id >> 8, 0, 1));
      lab.sim.write(rec + 72, pack('<I', CAM.completion - 0x50000000 + 0x60021020));
      const d0 = deferred.length, i0 = items.length, e0 = errlogs.length;
      mmio = [];
      const r = lab.call(CAM.sw, { a0: rec }, null, null, 20000000).d0 & 0xFFFF;
      s.settle(`camdrv request ${id}`);
      const dev = [...new Set(mmio.map((x) => x.name))];
      idle(100);
      return { r, deferred: deferred[d0], items: items.length - i0, done: completions.includes(h8(rec)), errors: errlogs.slice(e0), dev };
    };
    const shown = (q) => JSON.stringify(q);
    phase = 'requests';
    for (const id of [148, 144]) {
      const q = request(id);
      ok(q.r === 0 && q.deferred === h8(CAM.handlers[id]) && q.items > 0 && !q.done && !q.errors.length && q.dev.every((x) => x === 'om1.intc' || x === 'om1.dpc-triggers'),
        `request ${id} with the first init: accepted, deferred to ${h8(CAM.handlers[id])}, an item queued, not completed in 100 ms, no error, no device but the controller and the deferred-call triggers (modelled): ${shown(q)}`);
    }
    const q6 = request(6);
    ok(q6.r === 0 && q6.deferred === undefined && !q6.items && !q6.done && JSON.stringify(q6.errors) === JSON.stringify([h8(CAM.no6)]),
      `request 6 with the first init alone logs ${h8(CAM.no6)} and is not deferred: ${shown(q6)}`);
    phase = 'init2';
    mmio = [];
    const rcs = CAM.init2.map((f) => lab.call(f, null, null, null, 50000000).d0 & 0xFFFF);
    ok(rcs.every((x) => x === 0) && !mmio.length, `the second init's first nine calls return ${rcs} and touch ${JSON.stringify(mmio.map((x) => h8(x.a)))}`);
    const q6b = request(6);
    ok(q6b.r === 0 && q6b.deferred === h8(CAM.handlers[6]) && q6b.items > 0 && !q6b.done && !q6b.errors.length,
      `request 6 after them: deferred to ${h8(CAM.handlers[6])}, an item queued, not completed in 100 ms: ${shown(q6b)}`);
    mmio = [];
    let stop = null;
    try { lab.call(CAM.front_end, null, null, null, 50000000); } catch (e) { stop = e.message; }
    ok(stop !== null && /lab-stub DENIED write 0x9b500800/.test(stop) && JSON.stringify(mmio.map((x) => `${x.dir} ${h8(x.a)}`)) === JSON.stringify(['W 0x98800340', 'W 0x9b500800']),
      `the front end's init stops at the camera clock gate: ${JSON.stringify(mmio.map((x) => `${x.dir} ${h8(x.a)} ${x.name}`))}, ${String(stop).slice(0, 200)}`);
    m.setMmioTrace(null);
  } catch (e) { bad.push(`camDriverSession (${phase}): ${e.message.slice(0, 600)}`); }
  pl.close_session();
  return { checks, bad };
}

// Round 3 (docs/hle-gaps.md 4.2.5): the probe with its cam_fe opt-in (camapp 1, --take probe, --cpu2 native) runs
// cam.c's second init 0x50155357 against S-CAMFE (H-CAMINIT2, src/lab/take.mjs; src/dev/camfe.mjs). (1) It writes
// S-CAMFE's whole program and attaches the front end's handlers in the interrupt table 0xa32600c0 (IRQ n at +4 n; the
// handlers below, X), cam_bright.c's per-bit callback tables are in RAM (0x629a7c64: AE1's 15 from 0x5015db6a;
// 0x629a7cdc: AWB1's 8, the per-area entry 0x5015e629 at +4) and the movie sequence's queues SQMV, MQEX, INFN and SMFM
// are registered (their handles 0x62a252a4, 0x62a252a8, 0x62a24288, 0x62a252ac). The 15 front-end contexts (32476 bytes
// each from 0x629aa520) hold the records 2464 / 2532 of type 7 with +36 0x50170433 and +44 0x5017078f / 0x501707c0 and
// no unit pointer (+4..+28, which only the fill sets), and the messages +8, +148, +288 and +428 of kinds 4..7 with +120
// 0x501704ef, which the start loop's entries 0, 1, 53 and 54 hand to the movie sequence's dispatcher (its 0x50198e56,
// not the frame step's kind 10). (2) TAKE_EXPOSE's 0xa00 (mode 0, as
// expCallbackSession): EXP_MOVIE gives cam.c requests 8 and 7, which it takes without an error (before: 0x0a283000
// three times); the movie sequence's kind 1 (0x50198993) keeps request 7's item (0x62a24248) with its state 1
// (0x62a24244) and posts it, and nothing goes further: the sequence's frame step 0x5019981d (kind 10) never runs, so
// the front end's entry 0x5016f2ae and cam_bright.c's job queue 0x50165b82 do not either, S-CAMFE takes no access, no
// frame callback runs and EXP_MOVIE waits on its flag 21 for bit 0x1000
const IRQ_TABLE = 0xA32600C0;
const FE_IRQS = { 15: 0x501A2478, 16: 0x501A24C2, 17: 0x501A250C, 18: 0x5019E218, 19: 0x501A2EC1, 22: 0x501A2F9F, 24: 0x50195B8E,
  25: 0x501A3BEA, 26: 0x50156528, 27: 0x501919B4, 31: 0x50191DF2, 32: 0x5015789D, 33: 0x501579AA, 34: 0x50157AB7, 35: 0x50157D21,
  36: 0x50157F8B, 37: 0x501581F5, 38: 0x501616F7, 39: 0x5018D3F1, 40: 0x50163408, 41: 0x5016763B, 42: 0x501667C9, 243: 0x5019F0D1,
  247: 0x5019F5DA };
const SEQ = { queues: [0x62A252A4, 0x62A252A8, 0x62A24288, 0x62A252AC], state: 0x62A24244, item: 0x62A24248, step: 0x5019981D };
const FE_CONTEXTS = { base: 0x629AA520, size: 32476, count: 15 };
export async function camFrontEndSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { pack } = await import('../src/util/bytes.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' }, env);
  pl.cam_fe = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, take = s.camapp.take, fe = take.camfe;
    const u32 = (a) => lab.sim.u32(a) >>> 0, u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const used = pl.stand_ins_in_use();
    ok(pl.opts().cam_fe === true && ['H-CAMINIT', 'H-CAMINIT2', 'S-CAMFE', 'A-CAMFE-1', 'A-CAMFE-2', 'H-EXPINIT'].every((x) => used.includes(x))
      && fe && fe.regs.size === 256 && fe.writes === 358 && fe.reads === 40,
      `the probe runs H-CAMINIT2 against S-CAMFE (${used.filter((x) => /CAM/.test(x))}): ${fe?.regs.size} registers, ${fe?.writes} writes, ${fe?.reads} reads`);
    const irqs = Object.entries(FE_IRQS).filter(([n, at]) => disasm(u32(IRQ_TABLE + 4 * Number(n))) !== at).map(([n]) => n);
    ok(!irqs.length, `the front end's handlers are in the interrupt table (wrong: ${irqs.map((n) => `${n}: ${h8(disasm(u32(IRQ_TABLE + 4 * n)))}`)})`);
    ok(disasm(u32(0x629A7C64)) === 0x5015DB6A && disasm(u32(0x629A7C8C)) === 0x5015DDF6 && disasm(u32(0x629A7CE0)) === 0x5015E629,
      `cam_bright.c's per-bit tables: AE1's [0] ${h8(disasm(u32(0x629A7C64)))}, [10] ${h8(disasm(u32(0x629A7C8C)))}, AWB1's [1] ${h8(disasm(u32(0x629A7CE0)))}`);
    ok(SEQ.queues.every((q) => u32(q) !== 0) && u16(SEQ.state) === 0 && u32(SEQ.item) === 0, `the movie sequence's queues are registered (${SEQ.queues.map((q) => h8(u32(q)))}), no item`);
    const ctx = [];
    for (let k = 0; k < FE_CONTEXTS.count; k++) {
      const c = FE_CONTEXTS.base + FE_CONTEXTS.size * k;
      for (const [o, cb] of [[2464, 0x5017078F], [2532, 0x501707C0]]) {
        if (u16(c + o) !== 7 || disasm(u32(c + o + 36)) !== 0x50170433 || disasm(u32(c + o + 44)) !== cb || [4, 8, 12, 16, 20, 24, 28].some((p) => u32(c + o + p) !== 0)) ctx.push(`${k} record ${o}`);
      }
      [8, 148, 288, 428].forEach((o, i) => { if (u16(c + o) !== 4 + i || disasm(u32(c + o + 120)) !== 0x501704EF) ctx.push(`${k} message +${o}: kind ${u16(c + o)}`); });
    }
    ok(!ctx.length, `the front end's ${FE_CONTEXTS.count} contexts: records 2464 / 2532 of type 7 with their +36 / +44 and no unit pointer, messages of kinds 4..7 (wrong: ${ctx.slice(0, 6)})`);
    const seen = [];
    for (const [at, what] of [[0x5016F2AE, 'front end'], [0x50165B82, 'job'], [SEQ.step, 'frame step']]) lab.observe(at, () => seen.push(what), `camfe ${what}`);
    const c0 = { native: take.cam.native.length, errlogs: take.cam.errlogs.length, waits: take.cam.waits.length }, w0 = fe.writes, r0 = fe.reads;
    const param = lab.alloc(new Uint8Array(52), 4);
    const msg = lab.alloc(pack('<IIII', 0, 1, 0xA00, param), 4), desc = lab.alloc(pack('<II', msg, 16), 4);
    lab.call(E.olyqewr, { d0: E.take_expose, d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000);
    s.settle('camfe TAKE_EXPOSE 0xa00');
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    idle(300);
    const native = take.cam.native.slice(c0.native), w = take.cam.waits.slice(c0.waits).at(-1);
    const r7 = native.find((x) => x.id === 7)?.record;
    ok(JSON.stringify(native.map((x) => `${x.task} ${x.id}`)) === JSON.stringify(['EXP_MOVIE 8', 'EXP_MOVIE 7']) && take.cam.errlogs.length === c0.errlogs,
      `cam.c takes EXP_MOVIE's requests 8 and 7 with no error (${JSON.stringify(native.map((x) => x.id))}, logs ${take.cam.errlogs.slice(c0.errlogs).map(h8)})`);
    ok(r7 === E.frame_record && u16(SEQ.state) === 1 && u32(SEQ.item) !== 0,
      `the movie sequence keeps request 7's item ${h8(u32(SEQ.item))} with its state ${u16(SEQ.state)} (want 1)`);
    ok(!seen.length && fe.writes === w0 && fe.reads === r0, `no frame step, front-end entry or unit job follows (${seen}), S-CAMFE untouched (${fe.writes - w0} writes, ${fe.reads - r0} reads)`);
    ok(!take.cam.frames.length && !take.cam.answers.length && w?.flag === 21 && w?.bits === 0x1000 && (lab.nk.state(take.exp_tid) & 0xF) === 4,
      `no frame callback (${take.cam.frames}), no answer (${take.cam.answers.length}); EXP_MOVIE waits on flag ${w?.flag} for ${h8(w?.bits)}`);
  } catch (e) { bad.push(`camFrontEndSession: ${e.message.slice(0, 600)}`); }
  pl.close_session();
  return { checks, bad };
}

// S-EXPOSE's readers in a default session (camapp 1, no probe): every property read of the three AE result objects
// 0xc12a / 0xc0ba / 0xc0ca through the getter 0x500417da, every set through 0x5004188b, the application's get by
// index 0x503ee3c8 for their indices 4011..4013 (the list 0x606239e4 + 2 (index - 4000)) and every run of the plan
// take_expose_calculate 0x50597e82, over a pass of S-EXPOSE again, an idle, a live view, S1, S2, the menu, a mode
// change P -> A and playback. The objects are read only by the plan's reader 0x50598688 (its gets at 0x505986c4,
// 0x505986f2, 0x50598721) and by the index get (its get at 0x503ef275); the plan runs from S-EXPOSE's call and
// natively through the API 0x20009 (0x50597dc0's call at 0x50597df5) at the mode change, where the index get runs too
// (called at 0x503eec39); only S-EXPOSE sets them, and the AE result writer 0x50596187 never runs. The records name
// each call by its return address (mdr), as below
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
  console.log(`the EXP callback, rounds 1 and 2: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  const c = await camDriverSession();
  console.log(`cam.c natively: ${c.checks - c.bad.length}/${c.checks}`);
  c.bad.forEach((x) => console.log('  ', x));
  const f = await camFrontEndSession();
  console.log(`cam.c's second init against S-CAMFE: ${f.checks - f.bad.length}/${f.checks}`);
  f.bad.forEach((x) => console.log('  ', x));
  const a = await aeReadersSession();
  console.log(`S-EXPOSE's readers: ${a.checks - a.bad.length}/${a.checks}`);
  a.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || c.bad.length || f.bad.length || a.bad.length ? 1 : 0);
}
