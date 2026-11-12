// The release route to TAKE_EXEC (src/lab/take.mjs rounds 2 to 4, --take probe; docs/hle-gaps.md 4.1.7, 4.1.8, 4.2.3),
// E143:
//   releaseSession  two play sessions. Under control camapp 3 without the probe the sequence parts take S1 (event
//                   826, Trig1Release, in phase 101) but refuse it at their S1 guard (0x50c8d4a4 -> 0x50bcdef7):
//                   CapThr's state word is its static 0x02010202, and CapTak_Take's take request is never made. Under
//                   camapp 1 with the probe TAKE_MAIN runs and S1 reaches nothing (no S-THRTAKEOVER). S-RELSEQ in both
//   focusSession    round 3 (H-TAKEFOCUS): camapp 3 with --take probe. TAKE_FOCUS runs natively from the start (its
//                   MODE_START and two MODE_UPDATEs, which set the lens's AF mode through the AF library once: the
//                   type-1 frame a0 b0 [fe 00]); S1 passes the S1 guard, CapTak_Take asks the take API with control
//                   0x20, and TAKE_MAIN takes the request natively: RdyFcsRdy1 asks TAKE_FOCUS's RELEASE_READY_START
//                   (0x300), which calls the four callbacks itself, at once (tokens 5, 0, 2, 3; its "focus" field: 1);
//                   TAKE_MAIN answers the application, asks TAKE_EXPOSE 0x400, BC_EXEC 53 and the camera driver's 144
//                   and goes through RdyFcsRdy2 (TAKE_EXPOSE 0x503, TAKE_FOCUS 0x403, the event 0x04080032 to the
//                   application) to RdyFcsRdy3, whose TAKE_EXPOSE 0x500 makes TAKE_EXPOSE ask EXP_MOVIE 0x509 and wait
//                   for it on EXP_MOVIE_POST. Since round 4 the session runs with --cpu2 native, so H-EXPINIT brings
//                   EXP up (and H-CAMINIT cam.c's init): EXP_MOVIE takes the request natively, gives the camera driver
//                   its requests 8 and 7 and waits on its flag 21 for bit 0x1000, which EXP's frame callback for the
//                   event 0x300 sets and nothing in the lab fires (docs/hle-gaps.md 4.2.3); meanwhile RdyFcsRdy3 asks
//                   TAKE_FOCUS 0x400 (RELEASE_IDLE_START, replied token 4), and TAKE_MAIN waits for TAKE_EXPOSE's
//                   token 15 (pending bits 0x200). S2 (event 824) reaches no TAKE task; its DISPLAY commands go in
//                   the DISPLAY task's order (docs/hle-gaps.md 4.1.9): the GUI's command 17, sent while the
//                   application's synchronous command 15 waits, is kept and run after it, then the display manager's
//                   two command 18 requests. REC_FILE runs natively on S2 and the sequence goes to phase 106. The
//                   power manager's sub-CPU command 0x14, which S1 brings at the manager's next cyclic tick with or
//                   without S2 (docs/hle-gaps.md 4.7.6), is taken by S-SCPUDEV as the write it is, and the idle
//                   goes on: no lab stop
//   camFeSession    round 5 (docs/hle-gaps.md 4.2.5): focusSession's S1 and S2 with the probe's cam_fe opt-in (below)
//   node emu/test/test_take_release.mjs
import { fileURLToPath } from 'node:url';

const h8 = (v) => '0x' + (v >>> 0).toString(16);
// TAKE_MAIN's state (u16), its state table (20 bytes a state, +4 the name), its pending bits and wait pattern, TAKE's
// queue count 0x502ce6ae (d0 the queue; 0x50399827 calls it for TAKE_EXEC), CapThr's state word
const MAIN_STATE = 0x62A3F018, MAIN_STATES = 0x605BFBC8, MAIN_PENDING = 0x62A3F03C, MAIN_PATTERN = 0x62A3F024;
const QUEUE_COUNT = 0x502CE6AE, TAKE_EXEC = 0x5A, THR_STATE = 0x60362B38;
// observed: the take API (its d0 control and caller), the S1 guard's CapThr test (0x50c8d4bb, d0), the sequence's
// state-4 handler after the event id and the phase (0x50c5b2f2: d0 the phase, the id at (16,sp))
const TAKE_API = 0x50417CD9, S1_GUARD_TEST = 0x50C8D4BB, SEQ_EVENT = 0x50C5B2F2, HISTOGRAM = 944;
const PROBE2 = ['H-TAKEMAIN', 'S-THRTAKEOVER'];

// the record in a canonical form: '<task> <= <queue> <command or token> [in <state>]' for what TAKE takes, '<task> ->
// <target> <command> [sync] (<answer kind>)' for a request, '<task> -> reply' for its reply
export function canon2(r, stateName) {
  if (r.dir === 'in') {
    const what = r.command === null || r.command === undefined ? `token ${r.token}` : `${r.command}`;
    return `${r.task} <=${r.queue ? ' ' + r.queue : ''} ${what}${r.state !== undefined ? ` in ${stateName(r.state)}` : ''}${r.handler ? ` (handler ${h8(r.handler)})` : ''}`;
  }
  if (r.event !== undefined) return `${r.task} -> event ${h8(r.event)}`;                    // (round 3: TAKE's event)
  const kind = r.answer.startsWith('native: TAKE') ? 'reply' : r.answer.startsWith('native') ? 'native' : r.answer.startsWith('none') ? 'unanswered' : 'answered';
  if (kind === 'reply') return `${r.task} -> reply`;
  const what = r.queue === null ? r.name.replace(/ \(.*$/, '') : `${r.name} ${r.command}`;
  return `${r.task} -> ${what}${r.sync ? ' sync' : ''} (${kind})`;
}
export async function releaseSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  // (camapp 3 with --take probe: focusSession, round 3)
  for (const [tag, mode, probe] of [['camapp 3', 3, false], ['camapp 1 --take probe', 1, true]]) {
    const pl = new Player({ ...args, ...(probe ? { take: 'probe' } : {}) }, env);
    pl.camapp_components = mode >= 2; pl.camapp_native_tra = mode === 3;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, take = s.camapp.take;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
      const str = (a) => { let t = ''; for (let c; (c = lab.sim.read(a + t.length, 1)[0]) && t.length < 32;) t += String.fromCharCode(c); return t; };
      const stateName = (n) => str(lab.sim.u32(MAIN_STATES + 20 * n + 4) >>> 0);
      const seen = [];
      lab.observe(TAKE_API, (l, r) => seen.push(`take API ${h8(r.d0)} from ${h8(disasm(r.mdr))}`), 'test take API');
      lab.observe(S1_GUARD_TEST, (l, r) => seen.push(`S1 guard ${r.d0}`), 'test S1 guard');
      lab.observe(SEQ_EVENT, (l, r) => {
        const id = l.sim.read((r.sp >>> 0) + 16, 2).reduce((a, b, k) => a | b << 8 * k, 0);
        if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`);
      }, 'test sequence');
      let n = take ? take.requests.length : 0;
      const since = () => { const out = take ? take.requests.slice(n).map((r) => canon2(r, stateName)) : []; n = take ? take.requests.length : 0; return out; };
      const used = pl.stand_ins_in_use(), thr = lab.sim.u32(THR_STATE) >>> 0;
      ok(s.status().gui === '0x0108' && used.includes('S-RELSEQ') && PROBE2.every((x) => used.includes(x) === (probe && (x === 'H-TAKEMAIN' || mode === 3))) && thr === (probe && mode === 3 ? 0x01010202 : 0x02010202),
        `${tag}: the start reaches the shooting screen (GUI ${s.status().gui}), S-RELSEQ ${used.includes('S-RELSEQ')}, round 2's stand-ins ${used.filter((x) => PROBE2.includes(x))}, CapThr's state ${h8(thr)}`);
      if (probe) {
        const st = Object.values(take.main_tids).map((t) => lab.nk.state(t) & 0xF);
        ok(st.every((x) => x === 4) && u16(MAIN_STATE) === 0 && !take.requests.some((r) => r.dir === 'in' && /^TAKE_MAIN/.test(r.task)),
          `${tag}: TAKE_MAIN and TAKE_MAIN_CP wait (${st}) in ${stateName(u16(MAIN_STATE))}, nothing taken at the start`);
      }
      idle(1000);
      since(); seen.length = 0;
      s.key('s1', 'down'); s.camapp.pump(); idle(600);
      const s1 = since(), seen1 = seen.splice(0);
      if (!probe && mode === 3) {
        ok(JSON.stringify(seen1) === JSON.stringify(['event 826 in phase 101', 'S1 guard 0']),
          `${tag}: S1 is event 826 in phase 101, refused at the S1 guard, no take request: ${JSON.stringify(seen1)}`);
      } else {
        ok(!seen1.length && !s1.length, `${tag}: S1 reaches neither the sequence nor TAKE (${JSON.stringify(seen1)}, ${JSON.stringify(s1)})`);
      }
      if (probe) {
        const count = lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, 200000).d0;
        const want = ['Idle', 0, 0x7];
        const got = [stateName(u16(MAIN_STATE)), lab.sim.u32(MAIN_PENDING) >>> 0, lab.sim.u32(MAIN_PATTERN) >>> 0];
        ok(JSON.stringify(got) === JSON.stringify(want) && count === 0,
          `${tag}: after S1 TAKE_MAIN is in ${got[0]} with the pending bits ${h8(got[1])}, the wait pattern ${h8(got[2])} (want ${JSON.stringify(want)}), TAKE_EXEC holds ${count}`);
        s.key('s2', 'down'); s.camapp.pump(); idle(700);
        const s2 = since(), seen2 = seen.splice(0), count2 = lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, 200000).d0;
        ok(!seen2.length && !s2.length && count2 === 0 && stateName(u16(MAIN_STATE)) === want[0],
          `${tag}: S2 ${JSON.stringify(seen2)}, TAKE takes nothing (${JSON.stringify(s2)}), TAKE_EXEC holds ${count2}, TAKE_MAIN in ${stateName(u16(MAIN_STATE))}`);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(800);
        const up = since();
        ok(!up.some((x) => /^TAKE_MAIN/.test(x)) && take.pending.length === 0 && s.status().gui === '0x0108',
          `${tag}: the releases reach TAKE_MAIN with nothing (${JSON.stringify(up)}), nothing left to answer (${take.pending.length}), GUI ${s.status().gui}`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  return { checks, bad };
}

// Round 3 (H-TAKEFOCUS; docs/hle-gaps.md 4.1.8). TAKE_FOCUS's context (0xa33d9564: +5 its "focus" field, object
// 0xc021 through 0x509b1bc5(14); +12 its state) and ready byte (0xa33d955c, its module init sets it); TAKE_MAIN's four
// RdyFcsRdy1 callbacks by entry and the token each posts to its mailbox (0x502ce7b7)
const FOCUS_CTX = 0xA33D9564, FOCUS_READY = 0xA33D955C, FOCUS_STOP = 0x0F803003;
const CALLBACKS = { 0x503C2BCD: 5, 0x503C2BAC: 0, 0x503C2BDD: 2, 0x503C2BBB: 3 };
// TAKE_FOCUS's part of the start: TAKE_FUNC 18's MODE_START and 22's MODE_UPDATE twice, each taken and replied natively
export const START_FOCUS = ['TAKE_FUNC -> TAKE_FOCUS 0 sync (native)', 'TAKE_FOCUS <= 0', 'TAKE_FOCUS -> reply',
  'TAKE_FUNC -> TAKE_FOCUS 2 sync (native)', 'TAKE_FOCUS <= 2', 'TAKE_FOCUS -> reply',
  'TAKE_FUNC -> TAKE_FOCUS 2 sync (native)', 'TAKE_FOCUS <= 2', 'TAKE_FOCUS -> reply'];
export const S1_FOCUS = ['TAKE_MAIN <= TAKE_EXEC 0 in Idle (handler 0x503a1172)', 'TAKE_MAIN -> FACE_FD 15 sync (answered)',
  'TAKE_MAIN -> TAKE_FUNC 80 sync (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply',
  // RdyFcsRdy1: TAKE_FOCUS's RELEASE_READY_START, which posts tokens 5, 0, 2 and 3 to TAKE_MAIN's mailbox at once
  'TAKE_MAIN -> TAKE_FOCUS 768 (native)', 'TAKE_FOCUS <= 768',
  'TAKE_MAIN <= mailbox token 5 in RdyFcsRdy1', 'TAKE_MAIN -> reply', 'TAKE_MAIN -> TAKE_EXPOSE 1024 (native)',
  'TAKE_MAIN <= mailbox token 0 in RdyFcsRdy1', 'TAKE_EXPOSE -> reply', 'TAKE_MAIN <= TAKE_POST token 11 in RdyFcsRdy1',
  'TAKE_MAIN -> BC_EXEC 53 sync (answered)', 'TAKE_FOCUS -> reply', 'TAKE_MAIN -> camera driver request 144 (answered)',
  'TAKE_MAIN -> TAKE_FUNC 80 sync (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply',
  'TAKE_MAIN <= mailbox token 2 in RdyFcsRdy1', 'TAKE_MAIN <= mailbox token 3 in RdyFcsRdy1',
  'TAKE_MAIN <= TAKE_POST token 1 in RdyFcsRdy1',
  // RdyFcsRdy2
  'TAKE_MAIN -> TAKE_FUNC 80 sync (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply',
  'TAKE_MAIN -> TAKE_EXPOSE 1283 (native)', 'TAKE_MAIN -> TAKE_FOCUS 1027 sync (native)', 'TAKE_FOCUS <= 1027',
  'TAKE_FOCUS -> reply', 'TAKE_MAIN -> TAKE_FUNC 80 sync (native)', 'TAKE_FUNC <= 80', 'TAKE_FUNC -> reply',
  'TAKE_MAIN <= mailbox token 13 in RdyFcsRdy2', 'TAKE_MAIN -> TAKE_FUNC 80 (native)', 'TAKE_MAIN -> event 0x4080032',
  'TAKE_EXPOSE -> reply', 'TAKE_FUNC <= 80', 'TAKE_MAIN <= TAKE_POST token 14 in RdyFcsRdy2',
  // RdyFcsRdy3's entry: TAKE_EXPOSE 0x500, which stops at EXP_MOVIE
  'TAKE_MAIN -> TAKE_EXPOSE 1280 (native)'];
// Round 4 (H-EXPINIT, --cpu2 native): TAKE_EXPOSE's request to EXP_MOVIE goes natively and is not answered; RdyFcsRdy3
// asks TAKE_FOCUS's RELEASE_IDLE_START (0x400), which replies token 4
export const S1_EXP = [...S1_FOCUS, 'TAKE_EXPOSE -> EXP_MOVIE 1289 (native)', 'TAKE_MAIN -> TAKE_FOCUS 1024 (native)',
  'TAKE_FOCUS <= 1024', 'TAKE_FOCUS -> reply', 'TAKE_MAIN <= TAKE_POST token 4 in RdyFcsRdy3'];
// EXP_MOVIE's wait for the frame events (flag 21 bit 0x1000, from 0x5056ba07's call at 0x5056ba25), cam.c's error
// when its movie sequence's queues are missing (its second init does not run; request 8's queue count 0x50151ffc once,
// request 7's posts 0x50151e45 twice). S2's synchronous DISPLAY sends: the application's command 15 (return
// 0x503ec117), the GUI's command 17 (return 0x507f66d1, task 168) while command 15 waits for the histogram's end, kept
// by S-DISPQ from the send's own post (0x5002e411) and run when command 15's run ends, and the GUI's command 17 again;
// the display manager's two command 18 requests (0x503eba07) after them, each with one reply to queue 6; until
// 2026-11-10 (docs/hle-gaps.md 4.1.9) the GUI's 17 ran inside command 15's run and S2 stopped at the GUI's command 18
// post there (depth 1). The GUI's command 17 goes on about every 125 ms of the idle (S2_SENDS: the first three). Until
// 2026-11-11 the idle after S2 stopped at the power manager's sub-CPU command 0x14 {0, 1, 0, 3, 0}, which S1 brings at
// the manager's next cyclic tick (about 1.1 s after S1, with or without S2); S-SCPUDEV takes that write since
// (PWR_14_FRAME, its one frame of the session after the start; docs/hle-gaps.md 4.7.6), keeping the two slots' bytes
// (S2_KEPT: the body's battery inserted, its recommend byte 3 kept as 0xff; the PBH's not inserted), and no stop
// follows: the session rests with TAKE_MAIN in RdyFcsRdy3 and the sequence in phase 106 (S2_PHASE: from 103 within
// 0.1 s of S2, X; phase 106's dispatcher is not read)
const EXP_WAIT = { flag: 21, bits: 0x1000, from: 0x5056BA2C }, CAM_NOQUEUE = 0x0A283000, CAM_NOPOOL = 0x0A103000;
export const PWR_14_FRAME = { cmd: '0x14', data: '0001000300', reply: null };
const S2_SENDS = [[15, 0x503EC117], [17, 0x507F66D1], [17, 0x507F66D1]], GUI_17 = [17, 0x507F66D1];
const S2_DISPQ = [[17, 168, '0x5002e411'], [18, null, null], [18, null, null]];
const S2_KEPT = [[1, 0xFF], [0, 0xFF]], S2_PHASE = 106, SEQ_PHASE = 0x60364A1C;
// what S2's idle leaves: the DISPLAY sends beyond S2_SENDS are the GUI's command 17 again; the link's frames since
// `from` are the 0x14 alone and the sub-CPU's model keeps S2_KEPT; null when so, else what differs
function s2Rest(lab, sends, from) {
  const frames = lab.store_log.scpu_frames.slice(from), kept = lab.scpu_dev.sources?.map((x) => [x.inserted, x.second]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(sends.slice(0, S2_SENDS.length), S2_SENDS) || !sends.slice(S2_SENDS.length).every((x) => same(x, GUI_17))) return `DISPLAY sends ${JSON.stringify(sends)}`;
  if (!same(frames, [PWR_14_FRAME])) return `the link's frames ${JSON.stringify(frames)}`;
  if (!same(kept, S2_KEPT)) return `S-SCPUDEV's slots ${JSON.stringify(kept)}`;
  if (lab.scpu_dev.out.message !== 1) return 'a message waiting for the MN';
  return null;
}

export async function focusSession() {
  const bad = [], notes = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' };
  const pl = new Player(args, env);
  pl.camapp_components = true; pl.camapp_native_tra = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, take = s.camapp.take;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const byte = (a) => lab.sim.read(a, 1)[0];
    const str = (a) => { let t = ''; for (let c; (c = lab.sim.read(a + t.length, 1)[0]) && t.length < 32;) t += String.fromCharCode(c); return t; };
    const stateName = (n) => str(lab.sim.u32(MAIN_STATES + 20 * n + 4) >>> 0);
    const seen = [];
    lab.observe(TAKE_API, (l, r) => seen.push(`take API ${h8(r.d0)} from ${h8(disasm(r.mdr))}`), 'test take API');
    lab.observe(S1_GUARD_TEST, (l, r) => seen.push(`S1 guard ${r.d0}`), 'test S1 guard');
    lab.observe(SEQ_EVENT, (l, r) => {
      const id = l.sim.read((r.sp >>> 0) + 16, 2).reduce((a, b, k) => a | b << 8 * k, 0);
      if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`);
    }, 'test sequence');
    const calls = [];
    for (const [at, token] of Object.entries(CALLBACKS)) lab.observe(Number(at), () => {
      calls.push(`token ${token} from ${lab.lt.current() === lab.nk.tcb(take.focus_tid) ? 'TAKE_FOCUS' : 'another task'}`);
    }, 'test RdyFcsRdy1 callback');
    let n = 0;
    const since = () => { const out = take.requests.slice(n).map((r) => canon2(r, stateName)); n = take.requests.length; return out; };
    const used = pl.stand_ins_in_use(), start = since().filter((x) => /TAKE_FOCUS/.test(x)), mcu = s.lens?.mcu;
    ok(s.status().gui === '0x0108' && ['H-TAKEFOCUS', 'H-TAKEMAIN', 'S-THRTAKEOVER', 'S-RELSEQ', 'H-CAMINIT', 'H-EXPINIT'].every((x) => used.includes(x)),
      `the start reaches the shooting screen (GUI ${s.status().gui}) with ${used.filter((x) => /TAKE|RELSEQ/.test(x))}`);
    ok((lab.nk.state(take.focus_tid) & 0xF) === 4 && byte(FOCUS_READY) === 1 && byte(FOCUS_CTX + 5) === 1 && byte(FOCUS_CTX + 12) === 1,
      `TAKE_FOCUS (task ${take.focus_tid}) waits (state ${lab.nk.state(take.focus_tid)}), its ready byte ${byte(FOCUS_READY)}, "focus" ${byte(FOCUS_CTX + 5)}, state ${byte(FOCUS_CTX + 12)} (want 1, 1, 1)`);
    ok(JSON.stringify(start) === JSON.stringify(START_FOCUS), `the start's TAKE_FOCUS record ${JSON.stringify(start)}, want ${JSON.stringify(START_FOCUS)}`);
    ok(mcu?.counts.get('a0 b0') === 1 && mcu.frames.some(([f]) => f === 'a0 b0 [fe 00]'),
      `MODE_UPDATE's AF mode set reaches the lens once as a0 b0 [fe 00] (${mcu ? JSON.stringify(mcu.frames.filter(([f]) => /^a0 b/.test(f))) : 'no native lens'})`);
    idle(1000);
    since(); seen.length = 0;
    const e0 = lab.kernel.errors.length, f0 = mcu ? mcu.frames.length : null, link0 = lab.store_log.scpu_frames.length;
    const c0 = { native: take.cam.native.length, waits: take.cam.waits.length, errlogs: take.cam.errlogs.length };
    let stop = null;
    try { s.key('s1', 'down'); s.camapp.pump(); idle(600); } catch (e) { stop = e; }
    const s1 = since(), errs = lab.kernel.errors.slice(e0).map(([c]) => c);
    if (process.env.TF_PRINT) console.log(JSON.stringify({ s1, seen, calls, stop: stop?.message.slice(0, 300), errs: errs.map(h8), lens: mcu?.frames.slice(f0) }, null, 1));
    // (the guard twice: phase 101's case for 826, 0x50c5cc94, calls the controller's vt[1306], which calls vt[111],
    // the guard, then vt[110] and, that one 0, vt[111] itself at 0x50c5cce7)
    // (round 4: S1's idle goes on past RdyFcsRdy3's entry, and the sequence takes event 794, TakeReadyFinish, in phase
    // 102 while TAKE_MAIN still waits for TAKE_EXPOSE's token 15, docs/hle-gaps.md 4.2.3)
    ok(JSON.stringify(seen) === JSON.stringify(['event 826 in phase 101', 'S1 guard 1', 'S1 guard 1', 'take API 0x20 from 0x50bc7c8e', 'event 794 in phase 102']),
      `S1 passes the S1 guard, CapTak_Take asks for the take, the sequence takes 794: ${JSON.stringify(seen)}`);
    // (and from S1 on no lens frame but the lens state poll c1 80 the driver sends about every 100 ms, docs/hle-gaps.md
    // 4.1.8, 4.4.2)
    const lens = mcu ? mcu.frames.slice(f0).map(([f]) => f) : null;
    ok(JSON.stringify(calls) === JSON.stringify(['token 5 from TAKE_FOCUS', 'token 0 from TAKE_FOCUS', 'token 2 from TAKE_FOCUS', 'token 3 from TAKE_FOCUS'])
      && lens !== null && lens.every((f) => f.startsWith('c1 80 ')),
      `RELEASE_READY_START calls RdyFcsRdy1's four callbacks itself, in order, and no lens frame but the state poll follows: ${JSON.stringify(calls)}, lens frames ${JSON.stringify(lens)}`);
    ok(JSON.stringify(s1) === JSON.stringify(S1_EXP) && stop === null, `S1: the record ${JSON.stringify(s1)}, want ${JSON.stringify(S1_EXP)} (stop ${stop ? stop.message.slice(0, 300) : 'none'})`);
    // round 4: EXP_MOVIE takes TAKE_EXPOSE's request, asks cam.c 8 and 7 and waits for the frame events, unanswered
    const native = take.cam.native.slice(c0.native).map((x) => `${x.task} ${x.id}`), waits = take.cam.waits.slice(c0.waits);
    const w = waits.at(-1), camerr = take.cam.errlogs.slice(c0.errlogs);
    ok(JSON.stringify(native) === JSON.stringify(['EXP_MOVIE 8', 'EXP_MOVIE 7']) && w?.flag === EXP_WAIT.flag && w?.bits === EXP_WAIT.bits
      && w?.from === EXP_WAIT.from && (lab.nk.state(take.exp_tid) & 0xF) === 4,
      `EXP_MOVIE gives the camera driver ${JSON.stringify(native)} and waits on flag ${w?.flag} for ${h8(w?.bits)} from ${h8(w?.from)} (state ${lab.nk.state(take.exp_tid)})`);
    ok(!take.cam.frames.length && !take.cam.answers.length && take.ae_writes === 0,
      `no frame callback (${JSON.stringify(take.cam.frames)}), no answer on EXP_MOVIE_POST (${take.cam.answers.map(h8)}), no AE result write (${take.ae_writes})`);
    const got = [stateName(u16(MAIN_STATE)), lab.sim.u32(MAIN_PENDING) >>> 0];
    ok(JSON.stringify(got) === JSON.stringify(['RdyFcsRdy3', 0x200]) && errs.filter((c) => c === FOCUS_STOP).length === 1
      && camerr.length === 3 && camerr.every((c) => c === CAM_NOQUEUE) && !errs.includes(CAM_NOPOOL),
      `TAKE_MAIN is in ${got[0]} with the pending bits ${h8(got[1])} (want RdyFcsRdy3, 0x200); the errors since S1 ${errs.map(h8)} (TAKE_FOCUS's ${h8(FOCUS_STOP)} once; cam.c's ${camerr.map(h8)}: ${h8(CAM_NOQUEUE)} three times, not ${h8(CAM_NOPOOL)})`);
    // S2: its DISPLAY commands in the DISPLAY task's order (S-DISPQ's queue); the idle goes on past the power
    // manager's 0x14, which S-SCPUDEV takes
    let stop2 = null;
    since(); seen.length = 0;
    const ds0 = lab.display_sends.length, st0 = s.steps.length;
    try { s.key('s2', 'down'); s.camapp.pump(); idle(700); } catch (e) { stop2 = e; }
    const s2 = since(), sends = lab.display_sends.slice(ds0).map(([c, , f]) => [c, f]);
    // (without the histogram's end, cmd 16, which S-DISPQ runs about every 50 ms)
    const dq = [...s.steps.slice(st0).flatMap((x) => x.dispq ?? []), ...lab.dispq].filter((d) => d.cmd !== 16).slice(0, 3);
    const dqs = dq.map((d) => [d.cmd, d.kept?.task ?? null, d.kept?.from ?? null]);
    if (process.env.TF_PRINT) console.log(JSON.stringify({ s2, seen, sends, dq, stop2: stop2?.message.slice(0, 300) }, null, 1));
    const rest = s2Rest(lab, sends, link0), phase = lab.sim.u32(SEQ_PHASE);
    ok(JSON.stringify(seen) === JSON.stringify(['event 824 in phase 103']) && JSON.stringify(sends.slice(0, S2_SENDS.length)) === JSON.stringify(S2_SENDS)
      && JSON.stringify(dqs) === JSON.stringify(S2_DISPQ) && dq.slice(1).every((d) => d.replies === 1 && d.words[0] === '0x6'),
      `S2 is event 824 in phase 103 (${JSON.stringify(seen)}); its synchronous DISPLAY sends ${JSON.stringify(sends.map(([c, f]) => [c, h8(f)]))}, S-DISPQ's runs ${JSON.stringify(dqs)} (want ${JSON.stringify(S2_DISPQ)}), the requests' replies ${JSON.stringify(dq.slice(1).map((d) => d.replies))}`);
    ok(stop2 === null && rest === null,
      `S2's idle goes on past the power manager's 0x14, the link's one frame since S1, which S-SCPUDEV takes with no answer (${rest ?? 'so'}; ${stop2 ? stop2.message.slice(0, 200) : 'no stop'})`);
    ok(!s2.length && stateName(u16(MAIN_STATE)) === 'RdyFcsRdy3' && (lab.sim.u32(MAIN_PENDING) >>> 0) === 0x200 && phase === S2_PHASE,
      `TAKE takes nothing (${JSON.stringify(s2)}), TAKE_MAIN in ${stateName(u16(MAIN_STATE))} pending ${h8(lab.sim.u32(MAIN_PENDING))}, the sequence in phase ${phase} (want ${S2_PHASE})`);
  } catch (e) { bad.push(`camapp 3 --take probe: ${e.message.slice(0, 800)}`); }
  pl.close_session();
  return { checks, bad, notes };
}

// Round 5 (H-CAMINIT2, S-CAMFE; docs/hle-gaps.md 4.2.5): camapp 3 with --take probe, --cpu2 native and the probe's
// cam_fe opt-in, so cam.c's second init has run against S-CAMFE. S1 goes as in focusSession (the same record, S1_EXP,
// and the sequence's events 826 and 794); EXP_MOVIE gives cam.c requests 8 and 7, which it now takes without an error,
// the movie sequence keeps request 7's item (state 1, 0x62a24244) and nothing runs its frame step (0x5019981d), so
// EXP_MOVIE still waits on flag 21 for bit 0x1000 and TAKE_MAIN in RdyFcsRdy3 for token 15; S-CAMFE takes no access
// after the init. S2 goes as in focusSession: its DISPLAY sends the same, the power manager's 0x14 taken by S-SCPUDEV
// and no stop (s2Rest; docs/hle-gaps.md 4.1.9, 4.7.6)
export async function camFeSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' }, env);
  pl.camapp_components = true; pl.camapp_native_tra = true; pl.cam_fe = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, take = s.camapp.take, fe = take.camfe;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const str = (a) => { let t = ''; for (let c; (c = lab.sim.read(a + t.length, 1)[0]) && t.length < 32;) t += String.fromCharCode(c); return t; };
    const stateName = (n) => str(lab.sim.u32(MAIN_STATES + 20 * n + 4) >>> 0);
    const seen = [];
    lab.observe(SEQ_EVENT, (l, r) => {
      const id = l.sim.read((r.sp >>> 0) + 16, 2).reduce((a, b, k) => a | b << 8 * k, 0);
      if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`);
    }, 'test sequence');
    let steps = 0;
    lab.observe(0x5019981D, () => { steps++; }, 'test movie frame step');
    let n = 0;
    const since = () => { const out = take.requests.slice(n).map((r) => canon2(r, stateName)); n = take.requests.length; return out; };
    const used = pl.stand_ins_in_use();
    ok(s.status().gui === '0x0108' && ['H-CAMINIT2', 'S-CAMFE', 'H-EXPINIT', 'H-TAKEFOCUS'].every((x) => used.includes(x)) && fe?.regs.size === 256,
      `the start reaches the shooting screen (GUI ${s.status().gui}) with ${used.filter((x) => /CAM|EXP/.test(x))}`);
    idle(1000);
    since(); seen.length = 0;
    const c0 = { native: take.cam.native.length, waits: take.cam.waits.length, errlogs: take.cam.errlogs.length }, w0 = fe.writes, r0 = fe.reads;
    const link0 = lab.store_log.scpu_frames.length;
    let stop = null;
    try { s.key('s1', 'down'); s.camapp.pump(); idle(600); } catch (e) { stop = e; }
    const s1 = since(), native = take.cam.native.slice(c0.native).map((x) => `${x.task} ${x.id}`), w = take.cam.waits.slice(c0.waits).at(-1);
    ok(stop === null && JSON.stringify(s1) === JSON.stringify(S1_EXP) && JSON.stringify(seen) === JSON.stringify(['event 826 in phase 101', 'event 794 in phase 102']),
      `S1: the record as focusSession's (${s1.length} entries, ${JSON.stringify(s1.slice(-5))}), events ${JSON.stringify(seen)} (stop ${stop ? stop.message.slice(0, 200) : 'none'})`);
    ok(JSON.stringify(native) === JSON.stringify(['EXP_MOVIE 8', 'EXP_MOVIE 7']) && take.cam.errlogs.length === c0.errlogs && u16(0x62A24244) === 1 && !steps,
      `EXP_MOVIE gives cam.c ${JSON.stringify(native)}, logged ${take.cam.errlogs.slice(c0.errlogs).map(h8)} (none), the movie sequence's state ${u16(0x62A24244)} (1), frame steps ${steps} (0)`);
    ok(w?.flag === EXP_WAIT.flag && w?.bits === EXP_WAIT.bits && w?.from === EXP_WAIT.from && !take.cam.frames.length && !take.cam.answers.length && take.ae_writes === 0
      && stateName(u16(MAIN_STATE)) === 'RdyFcsRdy3' && (lab.sim.u32(MAIN_PENDING) >>> 0) === 0x200 && fe.writes === w0 && fe.reads === r0,
      `EXP_MOVIE waits on flag ${w?.flag} for ${h8(w?.bits)}, no frame callback, answer or AE write; TAKE_MAIN in ${stateName(u16(MAIN_STATE))} pending ${h8(lab.sim.u32(MAIN_PENDING))}; S-CAMFE untouched since the init (${fe.writes - w0} writes, ${fe.reads - r0} reads)`);
    let stop2 = null;
    since(); seen.length = 0;
    const ds0 = lab.display_sends.length;
    try { s.key('s2', 'down'); s.camapp.pump(); idle(700); } catch (e) { stop2 = e; }
    const sends = lab.display_sends.slice(ds0).map(([c, , f]) => [c, f]);
    const rest = s2Rest(lab, sends, link0), phase = lab.sim.u32(SEQ_PHASE);
    ok(stop2 === null && rest === null && !since().length && JSON.stringify(seen) === JSON.stringify(['event 824 in phase 103']) && phase === S2_PHASE
      && stateName(u16(MAIN_STATE)) === 'RdyFcsRdy3' && fe.writes === w0 && fe.reads === r0,
      `S2 as focusSession's: the power manager's 0x14 taken and no stop (${seen}; ${rest ?? 'the link and the DISPLAY sends so'}; ${stop2 ? stop2.message.slice(0, 160) : 'no stop'}), the sequence in phase ${phase}, TAKE_MAIN in ${stateName(u16(MAIN_STATE))}, S-CAMFE untouched`);
  } catch (e) { bad.push(`camapp 3 --take probe, cam_fe: ${e.message.slice(0, 800)}`); }
  pl.close_session();
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await releaseSession();
  console.log(`the release route to TAKE_EXEC: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  const f = await focusSession();
  console.log(`the release route, rounds 2 and 4: TAKE_FOCUS and EXP (H-TAKEFOCUS, H-EXPINIT): ${f.checks - f.bad.length}/${f.checks}`);
  f.bad.forEach((x) => console.log('  ', x));
  const c = await camFeSession();
  console.log(`the release route with cam.c's second init (H-CAMINIT2, S-CAMFE): ${c.checks - c.bad.length}/${c.checks}`);
  c.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || f.bad.length || c.bad.length ? 1 : 0);
}
