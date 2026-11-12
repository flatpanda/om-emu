// TAKE's take-ready under control camapp 3, E143 (docs/hle-gaps.md 4.1.10, 4.1.12): with --take probe and --cpu2
// native (focusSession's configuration, test_take_release.mjs), where TAKE runs natively, and without the probe,
// where S-MODACK and S-TAKERDY answer for TAKE_MAIN:
//   secondShotSession  two play sessions. In both the first S1 goes as in focusSession (the record S1_EXP) and the
//                  sequence takes event 794 (TakeReadyFinish) in phase 102: TAKE_MAIN's RdyFcsRdy2 posts the module
//                  event 0x04080032 to the application's queue, and the application's event task hands it to
//                  Com_EvSenderManager, whose case for it builds 794 (no capability observer). TAKE_MAIN then waits in
//                  RdyFcsRdy3 for TAKE_EXPOSE's token 15 (pending bits 0x200, wait pattern 0x5: TAKE_EXEC unread), as
//                  EXP_MOVIE waits for the camera front end's frame events. S1's release is event 827 in phase 103:
//                  CapTak_Take stops the take-ready through the take API's control 0, a TAKE_EXEC command 7, whose
//                  call returns the request's token (not 0), so it builds no 793 (StopTakeReadyDone) and the sequence
//                  waits in phase 111, whose table takes 793 and not S1 or its release (its default case takes
//                  them). TAKE_EXEC then holds the command 7, which TAKE_MAIN does not read in RdyFcsRdy3 (whose
//                  command table is empty).
//                  With S-SCPUDEV the session stops 1.16 s after the first S1: the power manager (task 10) sends the
//                  sub-CPU 0x14 {0, 1, 0, 3, 0}, which S-SCPUDEV does not model.
//                  With the sub-CPU's own firmware (env.scpu 'native') the session runs on: the 0x14 is the link's
//                  only transfer from S1 on (no message back), and the second S1 is event 826 in phase 111, which
//                  makes no take request: no 794, TAKE takes nothing; MENU after it reaches UI_IN and sets no GUI
//                  event, with no event to the sequence and no isCtrlReleaseEnable call (where it is dropped: not read)
//   takeReadyUnits  (no firmware) S-TAKERDY's rule take_ready_rule (src/lab/camapp.mjs; docs/hle-gaps.md 4.1.12): a
//                  request the API sender posts to TAKE_EXEC is the take-ready (command 0 of the packet's kind 0: the
//                  reply, then TAKE's event), the take-picture request (command 11: taken, not answered), a command 0
//                  of another kind (S-MODACK's status alone, logged) or none of S-TAKERDY's (the stop's command 7
//                  among them); nothing on another queue or body
//   takeReadySession  control camapp 3 without the probe (traRoutingSession's configuration, test_camapp.mjs), where
//                  TAKE_EXEC is S-MODACK's. Once the menu has restarted the through image, three half-press shots in a
//                  row, the menu, playback and the menu again between and after them: each S1 is event 826 in phase
//                  101, the sequence's phase 102 and the take request (control 0x20: TAKE_EXEC command 0, kind 0),
//                  answered by S-MODACK's status and then S-TAKERDY's event 0x04080032, TAKE_MAIN's own two messages
//                  in the probe's session; Com_EvSenderManager builds 794 in the event task and the sequence goes to
//                  phase 103. S1's release is 827 in phase 103: phase 111 (END_WAIT), the stop (control 0: TAKE_EXEC
//                  command 7, its token registered with the take capability's observer), S-MODACK's reply, from which
//                  the observer (the event task) and CapTak_Take's case for event 143 build 793; the sequence takes
//                  793 and its own 1078 in phase 111 and enters STANDBY (101), whose entry reads module 9's state (0,
//                  the components' own) under S-TAKEOVER's scope. After each the key is taken (the menu opens and
//                  closes, PLAY shows playback and returns), isCtrlReleaseEnable refusing none. Then a full shot: S2
//                  is 824 in phase 103, phases 104 and 106, and the take-picture request (TAKE_EXEC command 11), which
//                  S-TAKERDY takes and does not answer: no 791, the sequence waits in phase 106 through the releases,
//                  the picture is S-RELSEQ's, and MENU sets no GUI event (the furthest point; isCtrlReleaseEnable is
//                  not asked there, as in the probe's phase 111).
//                  Control 1, S-TAKERDY off: the session before 2026-11-11: S1 on the Super Control Panel's item
//                  reads module 9's state (0) in the through start and stops nothing; after the menu S1 leaves the
//                  sequence in phase 102 with no 794, S2 is the take API's control 0x40 and MENU is refused there.
//                  Control 2, the take-picture request answered as S-MODACK answers (status 0 at once): the sequence
//                  takes 791 in phase 106 and the session stops in the rec view controller's divide (0x50bdb830)
//   node emu/test/test_take_ready.mjs [units|session|probe]
import { fileURLToPath } from 'node:url';

const h8 = (v) => '0x' + (v >>> 0).toString(16);
// TAKE_MAIN (test_take_release.mjs): its state, state table (20 bytes a state: +4 the name, +12 its TAKE_EXEC command
// table of [u16 command, handler] ended by 0xffff), pending bits and wait pattern; TAKE's queue count 0x502ce6ae
const MAIN_STATE = 0x62A3F018, MAIN_STATES = 0x605BFBC8, MAIN_PENDING = 0x62A3F03C, MAIN_PATTERN = 0x62A3F024;
const QUEUE_COUNT = 0x502CE6AE, TAKE_EXEC = 0x5A, PROBE_STEP = 200000;
// observed (none hooked by the lab; observe would replace a hook, so watch() refuses a hooked address):
//   the sequence's state-4 handler after the event id and the phase (0x50c5b2f2: d0 the phase, the id at (16,sp))
//   the take API (d0 the control); CapTak_Take's stop of the take-ready (0x50bc79e6) after its take API call
//   (0x50bc7a31, d0 the API's result: 0 builds 793 at once at 0x50bc7a4d; otherwise, with its argument d3 1, a
//   response and then 793 at 0x50bc7ad4, with d3 0 its response path 0x50bc7aec, with no 793)
//   Com_EvSenderManager's case for 0x04080032 (0x50d77e6a, its second table 0x60ef11d4) at the 794 build (0x50d77eaf)
//   isCtrlReleaseEnable's refusal (0x50ab5c26, the phase at (8,sp)); the power manager's 0x14 builder (0x500435b0)
const SEQ_EVENT = 0x50C5B2F2, TAKE_API = 0x50417CD9, STOP_RETURN = 0x50BC7A31, STOP_793 = 0x50BC7A4D;
const STOP_RESPONSE = 0x50BC7AEC, EVS_794 = 0x50D77EAF, UNRESPONSIVE = 0x50AB5C26, PWR_14 = 0x500435B0;
const HISTOGRAM = 944, SEQ_PHASE = 0x60364A1C, STOP_PHASE = 111;
// the tasks by entry (X: E143's tasks 164 and 10): the application's event task and the power manager's
const EVENT_TASK = 0x50ABBF0C, PWR_TASK = 0x50043CDB;
// phase 111's dispatcher 0x50c611d5 (the phases' pointers to member at 0x6036449c: 111's at 0x603644e4; d0 the id):
// its table (run-time 0x60e9aeb0, 64 slots {id - 281, case}) and its default case 0x50c615e4 for an id not in it (a
// virtual call, vt +5220, of the object at +2784, not read), which the histogram's 944 reaches too
const PHASE111_TABLE = 0x60E9AEB0, PHASE111_BASE = 281, PHASE111 = 0x50C611D5, PHASE111_DEFAULT = 0x50C615E4;
// the stop's request as the API sender posts it (OlyQeWr's return 0x503eba07): {reply queue 6, token, command 7}
const OLYQEWR = 0x5002C151, API_SEND_RETURN = 0x503EBA07, STOP_COMMAND = 7, STOP_TOKEN = 0xF0070000;
// S-SCPUDEV's stop and the frame the power manager sends (its state-change notice 0x500444b3, from 0x50044533)
const SCPU_STOP = /S-SCPUDEV: command 0x14 \(data 0001000300\): not modelled/, PWR_14_FROM = 0x50044533;
const LINK_14 = '07140001000300000000';

export async function secondShotSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash, loadScpuImage } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm, runtime } = await import('../src/lab/hle.mjs');
  const { S1_EXP, canon2 } = await import('./test_take_release.mjs');
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, take: 'probe', cpu2: 'native' };
  for (const native of [false, true]) {
    const tag = native ? 'the sub-CPU\'s firmware' : 'S-SCPUDEV';
    let env = { ...base, scpu: 'off' };
    if (native) {
      try { env = { ...base, scpu: 'native', scpuImage: loadScpuImage() }; } catch (e) { bad.push(`${tag}: no SCPU image: ${e.message.slice(0, 200)}`); continue; }
    }
    const pl = new Player(args, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, take = s.camapp.take;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const key = (k, d) => { s.key(k, d); s.camapp.pump(); };
      const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
      const str = (a) => { let t = ''; for (let c; (c = lab.sim.read(a + t.length, 1)[0]) && t.length < 32;) t += String.fromCharCode(c); return t; };
      const stateName = (n) => str(lab.sim.u32(MAIN_STATES + 20 * n + 4) >>> 0);
      const main = () => [stateName(u16(MAIN_STATE)), h8(lab.sim.u32(MAIN_PENDING)), h8(lab.sim.u32(MAIN_PATTERN))].join(' ');
      const held = () => lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, PROBE_STEP).d0;
      const task = () => { const c = lab.lt.current(); for (const [t] of lab.nk.tasks()) if (lab.nk.tcb(t) === c) return t; return null; };
      const seen = [];
      const watch = (at, fn, name) => {
        if (lab.hooks.has(runtime(at))) throw new Error(`${h8(at)} carries the lab's hook ${lab.hooks.get(runtime(at))[1]}`);
        lab.observe(at, fn, name);
      };
      watch(SEQ_EVENT, (l, r) => {
        const id = u16((r.sp >>> 0) + 16);
        if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`);
      }, 'test sequence');
      watch(TAKE_API, (l, r) => seen.push(`take API ${h8(r.d0)}`), 'test take API');
      watch(STOP_RETURN, (l, r) => seen.push(`stop returns ${h8(r.d0)}`), 'test stop');
      watch(STOP_793, () => seen.push('793 built'), 'test stop 793');
      watch(STOP_RESPONSE, () => seen.push('stop response'), 'test stop response');
      watch(EVS_794, () => seen.push(`794 built by Com_EvSenderManager in ${lab.nk.entry(task()) === EVENT_TASK ? 'the event task' : `task ${task()}`}`), 'test 794');
      let p111 = null;
      watch(PHASE111, (l, r) => { p111 = r.d0 & 0xFFFF; }, 'test phase 111');
      watch(PHASE111_DEFAULT, () => { if (p111 !== HISTOGRAM) seen.push(`phase 111's default case for ${p111}`); }, 'test phase 111 default');
      const refused = [], pwr = [];
      watch(UNRESPONSIVE, (l, r) => refused.push(l.sim.u32((r.sp >>> 0) + 8)), 'test refusal');
      watch(PWR_14, (l, r) => pwr.push({ task: lab.nk.entry(task()), from: disasm(r.mdr), t: lab.lab_time() }), 'test power 0x14');
      const posts = [];
      lab.wrap(OLYQEWR, (prev) => (h, r) => {
        if ((r.d0 & 0xFFFF) === TAKE_EXEC && disasm(r.mdr) === API_SEND_RETURN) {
          const m = lab.sim.u32(r.a0 >>> 0) >>> 0;
          posts.push([0, 1, 2].map((k) => lab.sim.u32(m + 4 * k) >>> 0));
        }
        return prev(h, r);
      }, 'test TAKE_EXEC posts');
      idle(1000);
      let n = take.requests.length;
      const since = () => { const out = take.requests.slice(n).map((r) => canon2(r, stateName)); n = take.requests.length; return out; };
      seen.length = 0;
      const t0 = lab.lab_time(), x0 = lab.scpu_link.transfers.length;
      // the first S1: 794 from TAKE_MAIN's module event, through Com_EvSenderManager
      key('s1', 'down'); idle(600);
      const s1 = since(), seen1 = seen.splice(0);
      ok(JSON.stringify(s1) === JSON.stringify(S1_EXP) && s1.indexOf('TAKE_MAIN -> event 0x4080032') >= 0,
        `${tag}: the first S1's record is focusSession's (${JSON.stringify(s1.slice(-6))}), TAKE_MAIN's event 0x04080032 among it`);
      ok(JSON.stringify(seen1) === JSON.stringify(['event 826 in phase 101', 'take API 0x20', '794 built by Com_EvSenderManager in the event task', 'event 794 in phase 102']),
        `${tag}: S1 in phase 101, the take request, 794 built in Com_EvSenderManager's case for 0x04080032 and taken in phase 102: ${JSON.stringify(seen1)}`);
      ok(main() === 'RdyFcsRdy3 0x200 0x5' && held() === 0 && (lab.nk.state(take.exp_tid) & 0xF) === 4,
        `${tag}: TAKE_MAIN waits in ${main()} (want RdyFcsRdy3, pending 0x200, pattern 0x5), TAKE_EXEC holds ${held()}, EXP_MOVIE's state ${lab.nk.state(take.exp_tid)}`);
      // S1's release: the stop, command 7, left in TAKE_EXEC; the sequence in phase 111
      posts.length = 0;
      key('s1', 'up');
      const seen2 = seen.splice(0), phase = lab.sim.u32(SEQ_PHASE);
      ok(JSON.stringify(seen2) === JSON.stringify(['event 827 in phase 103', 'take API 0x0', `stop returns ${h8(STOP_TOKEN)}`, 'stop response'])
        && posts.length === 1 && posts[0][0] === 6 && posts[0][1] === STOP_TOKEN && posts[0][2] === STOP_COMMAND && phase === STOP_PHASE,
        `${tag}: S1's release in phase 103 stops the take-ready: ${JSON.stringify(seen2)}, TAKE_EXEC posts ${JSON.stringify(posts.map((p) => p.map(h8)))}, the sequence in phase ${phase}`);
      const table = [];
      for (let k = 0; k < 64; k++) { const id = lab.sim.u32(PHASE111_TABLE + 8 * k); if (id) table.push(id + PHASE111_BASE); }
      const cmds = (() => { const out = [], t = lab.sim.u32(MAIN_STATES + 20 * u16(MAIN_STATE) + 12) >>> 0; for (let a = t; t && u16(a) !== 0xFFFF && out.length < 64; a += 8) out.push(u16(a)); return out; })();
      ok(table.includes(793) && ![824, 826, 827, 828].some((x) => table.includes(x)) && cmds.length === 0,
        `${tag}: phase 111's table takes 793 and not S1, S2 or their releases (${table.length} ids, 793 ${table.includes(793)}); ${stateName(u16(MAIN_STATE))}'s command table ${JSON.stringify(cmds)}`);
      if (!native) {
        let stop = null;
        try { idle(800); } catch (e) { stop = e.message; }
        const p = pwr.at(-1), ms = p ? (p.t - t0) / 1e6 : null;
        ok(stop !== null && SCPU_STOP.test(stop) && pwr.length === 1 && p.task === PWR_TASK && p.from === PWR_14_FROM && ms > 1100 && ms < 1200,
          `${tag}: the power manager's 0x14 stops the session (its task ${h8(p?.task)}, from ${h8(p?.from)}, ${ms?.toFixed(1)} ms after S1): ${stop?.slice(0, 200)}`);
      } else {
        idle(800); idle(1000);
        const link = lab.scpu_link.transfers.slice(x0).map((x) => x.tx);
        ok(JSON.stringify(link) === JSON.stringify([LINK_14]) && pwr.length === 1 && pwr[0].task === PWR_TASK,
          `${tag}: the power manager's 0x14 is the link's one transfer since S1, the sub-CPU sends nothing back: ${JSON.stringify(link)}`);
        ok(main() === 'RdyFcsRdy3 0x200 0x5' && held() === 1 && lab.sim.u32(SEQ_PHASE) === STOP_PHASE && !since().length,
          `${tag}: 1.8 s after the release TAKE_MAIN still waits in ${main()}, TAKE_EXEC holds ${held()}, the sequence in phase ${lab.sim.u32(SEQ_PHASE)}`);
        // the second S1: phase 111's default case takes it and its release; no take request, no 794
        seen.length = 0;
        key('s1', 'down'); idle(600);
        const seen3 = seen.splice(0), s3 = since();
        key('s1', 'up'); idle(800);
        const seen4 = seen.splice(0), s4 = since();
        ok(JSON.stringify(seen3) === JSON.stringify(['event 826 in phase 111', 'phase 111\'s default case for 826'])
          && JSON.stringify(seen4) === JSON.stringify(['event 827 in phase 111', 'phase 111\'s default case for 827'])
          && !s3.length && !s4.length && held() === 1 && lab.sim.u32(SEQ_PHASE) === STOP_PHASE,
          `${tag}: the second S1 and its release in phase 111 go to its default case, make no take request and get no 794 (${JSON.stringify([...seen3, ...seen4])}), TAKE takes nothing (${JSON.stringify([...s3, ...s4])}), TAKE_EXEC holds ${held()}`);
        // and the keys: MENU reaches UI_IN and sets no GUI event; nothing reaches the sequence and isCtrlReleaseEnable
        // is not asked (in phase 102 it refuses MENU, docs/hle-gaps.md 4.3.2)
        refused.length = 0;
        const rec = s.key('menu', 'down'); s.camapp.pump(); idle(100); s.key('menu', 'up'); s.camapp.pump(); idle(800);
        const seen5 = seen.splice(0);
        ok(rec.events.length === 0 && rec.uiin?.[0]?.ev === 'EV_PRESS_MENU_KEY' && !refused.length && !seen5.length && s.status().gui === '0x0108',
          `${tag}: MENU's ${rec.uiin?.[0]?.ev} sets no GUI event (${rec.events.length}), the sequence takes ${JSON.stringify(seen5)}, isCtrlReleaseEnable's refusals ${refused}, GUI ${s.status().gui}`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  }
  return { checks, bad };
}

// S-TAKERDY (docs/hle-gaps.md 4.1.12). Observed besides the above (none hooked by the lab):
//   the sequence parts' phase setter (0x50cc6121, d0 the phase); the take capability's TakeReadyEndDone observer
//   (0x50bcb823, CapTak_NotifyTakeReadyEndDoneObserver.cpp, which builds event 143) and CapTak_Take's case for that
//   event (0x50bca7ea), which builds 793; the returns of the two module-9 reads of the sequence parts (the STANDBY
//   entry's 0x50c8a335 and the through start's 0x50ca4a37, d0 the state)
const PHASE_SET = 0x50CC6121, TAKE_READY_END = 0x50BCB823, TAKE_EVENT_143 = 0x50BCA7EA;
const STANDBY_MODULE9 = 0x50C8A335, THROUGH_MODULE9 = 0x50CA4A37;
const TAKE_READY_EVENT = 0x04080032, KIND_AT = 8, API_EVENT = 6, READY_COMMAND = 0, TAKE_COMMAND = 11;
const GUI_SHOOTING = '0x0108', GUI_MENU = '0x0b02', GUI_NO_PICTURE = '0x0505', GUI_SCP_ITEM = '0x0418';
// the rec view controller's divide by the picture record's zero (0x50bdb01a, called from
// CmpCtp_RecViewControllerParts 0x50c849d0), where the session stops when the take-picture request is answered at once
const RECVIEW_DIVIDE = /stopped at \S+ \(disasm 0x50bdb830\) fault=6/;

export async function takeReadyUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { take_ready_rule, TAKERDY_E143 } = await import('../src/lab/camapp.mjs');
  const Q = { TAKE_EXEC: 0x5A, TAKE_FUNC: 0x5E }, rule = (q, c, k, queues = Q, lab = true) => take_ready_rule(q, c, k, queues, lab);
  ok(TAKERDY_E143.event === TAKE_READY_EVENT && TAKERDY_E143.kind_at === KIND_AT && TAKERDY_E143.take === TAKE_COMMAND,
    `S-TAKERDY's event ${h8(TAKERDY_E143.event)}, the kind at +${TAKERDY_E143.kind_at}, the take-picture command ${TAKERDY_E143.take}`);
  ok(rule(0x5A, 0, 0) === 'ready', `TAKE_EXEC command 0 of kind 0 is the take-ready: ${rule(0x5A, 0, 0)}`);
  const kinds = [1, 2, 3, 4, 0x2000, 0x4000].map((k) => rule(0x5A, 0, k));
  ok(kinds.every((x) => x === 'other-kind'), `command 0 of the take API's other kinds keeps S-MODACK's status: ${kinds}`);
  ok(rule(0x5A, 11, 0) === 'take' && rule(0x5A, 11, 5) === 'take', `command 11 is the take-picture request: ${rule(0x5A, 11, 0)}`);
  const others = [5, 6, 7, 8, 9, 12, 14, 20].map((c) => rule(0x5A, c, 0));
  ok(others.every((x) => x === null), `the stop (7) and the other commands are not S-TAKERDY's: ${others}`);
  ok(rule(0x5E, 0, 0) === null && rule(0x5E, 11, 0) === null && rule(0x5A, 0, 0, { TAKE_EXEC: 0x80 }) === null && rule(0x80, 0, 0, { TAKE_EXEC: 0x80 }) === 'ready',
    `only the body's TAKE_EXEC: TAKE_FUNC ${rule(0x5E, 0, 0)}, a table with TAKE_EXEC elsewhere ${rule(0x5A, 0, 0, { TAKE_EXEC: 0x80 })} / ${rule(0x80, 0, 0, { TAKE_EXEC: 0x80 })}`);
  ok(rule(0x5A, 0, 0, Q, false) === null && rule(0x5A, 11, 0, Q, false) === null, `none off E143: ${rule(0x5A, 0, 0, Q, false)}`);
  return { checks, bad };
}

export async function takeReadySession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { disasm, runtime } = await import('../src/lab/hle.mjs');
  const { TAKERDY_E143 } = await import('../src/lab/camapp.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  // one session: opened, the observers set, run(t) inside a try, closed
  const session = (tag, run) => {
    const pl = new Player(args, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, ca = s.camapp;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const key = (k, d) => { const rec = s.key(k, d); s.camapp.pump(); return rec; };
      const tap = (k) => { const rec = key(k, 'down'); idle(100); key(k, 'up'); idle(800); return rec; };
      const u16 = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
      const task = () => { const c = lab.lt.current(); for (const [t] of lab.nk.tasks()) if (lab.nk.tcb(t) === c) return t; return null; };
      const inEvent = () => (lab.nk.entry(task()) === EVENT_TASK ? 'the event task' : `task ${task()}`);
      const seen = [], refused = [], posts = [], replies = [];
      const watch = (at, fn, name) => {
        if (lab.hooks.has(runtime(at))) throw new Error(`${h8(at)} carries the lab's hook ${lab.hooks.get(runtime(at))[1]}`);
        lab.observe(at, fn, name);
      };
      watch(SEQ_EVENT, (l, r) => { const id = u16((r.sp >>> 0) + 16); if (id !== HISTOGRAM) seen.push(`event ${id} in phase ${r.d0}`); }, 'test sequence');
      watch(PHASE_SET, (l, r) => seen.push(`phase ${r.d0}`), 'test phase');
      watch(TAKE_API, (l, r) => seen.push(`take API ${h8(r.d0)}`), 'test take API');
      watch(EVS_794, () => seen.push(`794 built by Com_EvSenderManager in ${inEvent()}`), 'test 794');
      watch(STOP_RESPONSE, () => seen.push('stop response'), 'test stop response');
      watch(TAKE_READY_END, () => seen.push(`TakeReadyEndDone observer in ${inEvent()}`), 'test observer');
      watch(TAKE_EVENT_143, () => seen.push('793 built by CapTak_Take\'s case for event 143'), 'test 143');
      watch(STANDBY_MODULE9, (l, r) => seen.push(`STANDBY reads module 9: ${r.d0}`), 'test STANDBY module 9');
      watch(THROUGH_MODULE9, (l, r) => seen.push(`the through start reads module 9: ${r.d0}`), 'test through module 9');
      watch(UNRESPONSIVE, (l, r) => refused.push(l.sim.u32((r.sp >>> 0) + 8)), 'test refusal');
      // the API sender's posts to TAKE_EXEC {reply queue, token, command, the packet's kind} and what reaches the
      // application's queue with one of their tokens or TAKE's event
      lab.wrap(OLYQEWR, (prev) => (h, r) => {
        const q = r.d0 & 0xFFFF, m = lab.sim.u32(r.a0 >>> 0) >>> 0, w = [0, 1, 2, 3].map((k) => lab.sim.u32(m + 4 * k) >>> 0);
        if (q === TAKE_EXEC && disasm(r.mdr) === API_SEND_RETURN) posts.push({ reply: w[0], token: w[1], command: w[2], kind: lab.sim.u32(w[3] + KIND_AT) >>> 0 });
        else if (q === API_EVENT && (w[1] === TAKE_READY_EVENT || posts.some((x) => x.token === w[1]))) replies.push(w[1] === TAKE_READY_EVENT ? 'event' : `reply to command ${posts.find((x) => x.token === w[1]).command}`);
        return prev(h, r);
      }, 'test TAKE_EXEC posts and replies');
      const phase = () => lab.sim.u32(SEQ_PHASE);
      const log = () => [...s.steps.flatMap((x) => x.camapp ?? []), ...ca.log].filter(([k]) => k === 'takerdy').map(([, d]) => d);
      const pictures = () => ca.card_images();
      run({ pl, s, lab, ca, idle, key, tap, seen, refused, posts, replies, phase, log, pictures });
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const S1_DOWN = ['event 826 in phase 101', 'phase 102', 'take API 0x20', '794 built by Com_EvSenderManager in the event task', 'event 794 in phase 102', 'phase 103'];
  const S1_UP = ['event 827 in phase 103', 'phase 111', 'take API 0x0', 'stop response', 'TakeReadyEndDone observer in the event task',
    '793 built by CapTak_Take\'s case for event 143', 'event 793 in phase 111', 'event 1078 in phase 111', 'phase 101', 'STANDBY reads module 9: 0'];
  // S-TAKERDY: three half-press shots with the menu and playback between them, then a full shot
  session('S-TAKERDY', (t) => {
    const { pl, ca, idle, key, tap, seen, refused, posts, replies, phase, log, pictures } = t;
    idle(2000);
    tap('menu'); tap('menu');                                  // the menu's close restarts the through image
    ok(t.s.status().gui === GUI_SHOOTING && ca.takerdy_on === true && ca.module_queues.has(TAKE_EXEC) && !ca.take,
      `S-TAKERDY: the shooting screen after the menu (${t.s.status().gui}), S-TAKERDY on (${ca.takerdy_on}), TAKE_EXEC S-MODACK's (${ca.module_queues.has(TAKE_EXEC)}), no probe`);
    seen.length = 0;
    const between = [() => [tap('menu'), t.s.status().gui, tap('menu')], () => [tap('play'), t.s.status().gui, tap('play')], () => [tap('menu'), t.s.status().gui, tap('menu')]];
    const shown = [GUI_MENU, GUI_NO_PICTURE, GUI_MENU];
    for (let n = 0; n < 3; n++) {
      const p0 = posts.length, r0 = replies.length;
      key('s1', 'down'); idle(600);
      const down = seen.splice(0), rq = posts.slice(p0);
      ok(same(down, S1_DOWN) && phase() === 103 && rq.length === 1 && rq[0].reply === API_EVENT && rq[0].command === READY_COMMAND && rq[0].kind === 0
        && same(replies.slice(r0), ['reply to command 0', 'event']) && ca.takerdy_events === n + 1,
        `S-TAKERDY: shot ${n + 1}'s S1: ${JSON.stringify(down)}, the take request ${JSON.stringify(rq)}, answered ${JSON.stringify(replies.slice(r0))}, events ${ca.takerdy_events}, phase ${phase()}`);
      const p1 = posts.length, r1 = replies.length;
      key('s1', 'up'); idle(1000);
      const up = seen.splice(0), stop = posts.slice(p1);
      ok(same(up, S1_UP) && phase() === 101 && stop.length === 1 && stop[0].reply === API_EVENT && stop[0].command === STOP_COMMAND
        && same(replies.slice(r1), ['reply to command 7']),
        `S-TAKERDY: shot ${n + 1}'s release: ${JSON.stringify(up)}, the stop ${JSON.stringify(stop)}, answered ${JSON.stringify(replies.slice(r1))}, phase ${phase()}`);
      const [open, gui, close] = between[n]();
      ok(open.events.length > 0 && gui === shown[n] && close.events.length > 0 && t.s.status().gui === GUI_SHOOTING && !refused.length && phase() === 101,
        `S-TAKERDY: after shot ${n + 1} the key is taken: ${open.events.length} GUI events, ${gui} (want ${shown[n]}), back ${t.s.status().gui}, isCtrlReleaseEnable's refusals ${refused}, phase ${phase()}`);
      seen.length = 0;
    }
    const used = pl.stand_ins_in_use(), lg = log();
    ok(used.includes('S-TAKERDY') && used.includes('S-MODACK') && lg.length === 3 && lg.every((x) => /^TAKE's event 0x04080032 -> queue 6 /.test(x)) && !pictures(),
      `S-TAKERDY: the player lists it (${used.includes('S-TAKERDY')}), its log ${JSON.stringify(lg.slice(-1))} (${lg.length}), pictures ${pictures()}`);
    // the full shot: S2 in phase 103 goes to phase 106 and asks TAKE for the picture, which nothing answers
    key('s1', 'down'); idle(600);
    const down = seen.splice(0), p2 = posts.length, r2 = replies.length;
    key('s2', 'down'); idle(700);
    const s2 = seen.splice(0), rq = posts.slice(p2);
    const held = t.lab.call(QUEUE_COUNT, { d0: TAKE_EXEC }, null, null, PROBE_STEP).d0;
    ok(same(down, S1_DOWN) && same(s2, ['event 824 in phase 103', 'phase 104', 'phase 106']) && rq.length === 1 && rq[0].reply === API_EVENT && rq[0].command === TAKE_COMMAND
      && !replies.slice(r2).length && ca.takerdy_takes.length === 1 && ca.takerdy_takes[0][1] === rq[0].token && held === 0 && pictures() === 1,
      `S-TAKERDY: the full shot's S2: ${JSON.stringify(s2)}, the take-picture request ${JSON.stringify(rq)} taken (TAKE_EXEC holds ${held}) and not answered (${JSON.stringify(replies.slice(r2))}; ${JSON.stringify(ca.takerdy_takes)}), S-RELSEQ's picture ${pictures()}`);
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const ups = seen.splice(0);
    const rec = key('menu', 'down'); idle(100); key('menu', 'up'); idle(800);
    ok(same(ups, ['event 828 in phase 106', 'event 827 in phase 106']) && phase() === 106 && rec.events.length === 0 && rec.uiin?.[0]?.ev === 'EV_PRESS_MENU_KEY'
      && !refused.length && t.s.status().gui === GUI_SHOOTING && /\(take picture\): taken, not answered/.test(log().at(-1)),
      `S-TAKERDY: the releases ${JSON.stringify(ups)} leave the sequence in phase ${phase()}; MENU's ${rec.uiin?.[0]?.ev} sets no GUI event (${rec.events.length}), isCtrlReleaseEnable not asked (refusals ${refused}), the GUI ${t.s.status().gui}; ${log().at(-1)}`);
  });
  // control 1: S-TAKERDY off, the session as before 2026-11-11 (and the through start's module-9 read)
  session('control (S-TAKERDY off)', (t) => {
    const { ca, idle, key, tap, seen, refused, posts, replies, phase } = t;
    ca.takerdy_on = false;
    idle(2000);
    tap('ok'); tap('ok');
    const item = t.s.status().gui;
    seen.length = 0;
    key('s1', 'down'); idle(600); key('s1', 'up'); idle(600);
    const panel = seen.splice(0);
    ok(item === GUI_SCP_ITEM && t.s.status().gui === GUI_SHOOTING && panel.includes('the through start reads module 9: 0') && !panel.some((x) => /^take API/.test(x)) && phase() === 101,
      `control: S1 on the Super Control Panel's item (${item}) returns to ${t.s.status().gui}, the through start's read under S-TAKEOVER's scope: ${JSON.stringify(panel)}`);
    tap('menu'); tap('menu');
    seen.length = 0;
    key('s1', 'down'); idle(600);
    const down = seen.splice(0);
    key('s2', 'down'); idle(700);
    const s2 = seen.splice(0);
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    seen.length = 0;
    const rec = key('menu', 'down'); idle(100); key('menu', 'up'); idle(800);
    ok(same(down, S1_DOWN.slice(0, 3)) && same(s2, ['event 824 in phase 102', 'take API 0x40']) && phase() === 102 && same(replies, ['reply to command 0'])
      && posts.length === 1 && ca.takerdy_events === 0 && rec.events.length === 0 && refused.length >= 1 && refused.every((p) => p === 102),
      `control: with S-TAKERDY off S1 ${JSON.stringify(down)} gets ${JSON.stringify(replies)} and no 794, S2 ${JSON.stringify(s2)}, the sequence in phase ${phase()}, MENU refused in phases ${refused}`);
  });
  // control 2: the take-picture request answered as S-MODACK answers: 791, then the rec view's divide
  const take = TAKERDY_E143.take;
  TAKERDY_E143.take = null;                                    // (until the session closes)
  session('control (take picture answered)', (t) => {
    const { idle, key, tap, seen, replies, phase } = t;
    idle(2000);
    tap('menu'); tap('menu');
    key('s1', 'down'); idle(600);
    seen.length = 0;
    let stop = null;
    try { key('s2', 'down'); idle(700); } catch (e) { stop = e.message; }
    ok(stop !== null && RECVIEW_DIVIDE.test(stop) && seen.includes('event 791 in phase 106') && replies.at(-1) === 'reply to command 11' && phase() === 106,
      `control: with the take-picture request answered at once (${replies.at(-1)}) the sequence takes ${JSON.stringify(seen.filter((x) => /791/.test(x)))} and the session stops in the rec view's divide: ${stop?.slice(0, 160)}`);
  });
  TAKERDY_E143.take = take;
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const which = process.argv[2] ?? 'all';
  let failed = 0;
  const report = (name, r) => {
    console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    failed += r.bad.length;
  };
  if (which === 'all' || which === 'units') report('S-TAKERDY\'s rule', await takeReadyUnits());
  if (which === 'all' || which === 'session') report('S-TAKERDY in play (camapp 3): three shots, the keys after each, the full shot', await takeReadySession());
  if (which === 'all' || which === 'probe') report('TAKE\'s take-ready on the second shot (--take probe)', await secondShotSession());
  process.exit(failed ? 1 : 0);
}
