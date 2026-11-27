// A still under control camapp 3 on the body of OM_EMU_MODEL (E143, E146, E147; docs/hle-gaps/4.1.md 4.1.11, 4.1.12,
// 4.1.13):
//   c3takeUnits   (no firmware) pure unit checks for S-RELSEQ native callback deduplication across repeated S1/S1-up
//                  cycles and full shots, S-MODPOST and S-TAKERDY parity across E143/E146/E147, and take_ready's
//                  non-TAKE_EXEC guard
//   stillSession  the session of test_take_ready.mjs takeReadySession on any of the three bodies, read through the
//                  body's own shooting phase query (OlyHfwOpeShoot's 0x50ab57e9, the sequence controller's phase, or
//                  100 with none; the port places it). TAKE's protocol is the body's (src/fw/facts.mjs takeRequests:
//                  E143's own, E146's and E147's read from their code), so S-TAKERDY and S-MODPOST are on. After the
//                  menu has restarted the through image, repeated S1 down -> S1 up cycles take the sequence out of
//                  STANDBY (101) through READY (102) to 103 on S-TAKERDY's event and back to 101 through END_WAIT;
//                  MENU open -> DOWN -> MENU close navigates the menu cleanly and returns to shooting in phase 101,
//                  followed by another S1/S1-up cycle; a full shot goes to 106 with the take-picture request taken and
//                  not answered, and MENU sets no GUI event after it. TAKE_FUNC 29 is taken once, and no direct post
//                  is left in TAKE_EXEC or TAKE_FUNC (on E146 and E147 the start's AUD_EXEC command 2 stays in its
//                  queue, as before: not TAKE's). The control (S-TAKERDY off before the first take request): S1 stops
//                  in READY (102) with no event and a full shot leaves the sequence there; S2's direct post (the take
//                  API's control 0x40) is S-MODPOST's then.
//                  On E147 the still / movie switch 0x1909 starts at its third position (src/fw/models.mjs
//                  switch_idle), where the application reads stills: at the first two it reads its movie mode, gives
//                  the sequence no release keys, and S1 left the phase at 101 (X: the session before 2026-11-13)
//   node emu/test/test_c3take.mjs [all|units|session]  (OM_EMU_MODEL=E146 / E147 for the other bodies)
import { fileURLToPath } from 'node:url';

const GUI_SHOOTING = '0x0108', GUI_MENU = '0x0b02';
const STANDBY = 101, READY = 102, READY_DONE = 103, TAKE_PICTURE = 106;
// E147's still / movie switch: UI_IN's 0x1909 at its third position, [group, byte, bit, polarity] (its tables, X)
const STILL_SWITCH_E147 = [4, 0, 2, 1];

export async function c3takeUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { CBS, CamApp, MODPOST_E143, TAKERDY_E143, modpost_entries, modpost_entry, relseq_skip_native, take_ready_rule } = await import('../src/lab/camapp.mjs');
  const { TAKE_REQUESTS_E143 } = await import('../src/fw/facts.mjs');
  const { FACTS } = await import('../src/fw/ports.mjs');
  // 1. S-RELSEQ native callback deduplication across repeated S1/S1-up cycles and full shots
  ok(!relseq_skip_native(new Set(), false, 'START_FOCUS', CBS)
    && !relseq_skip_native(new Set(), false, 'START_SHOOTING_PICTURE', CBS)
    && !relseq_skip_native(new Set(), false, 'START_EXPOSE', CBS)
    && !relseq_skip_native(new Set([CBS.END_FOCUS, CBS.END_SHOOTING_PICTURE]), true, 'END_FOCUS', CBS)
    && !relseq_skip_native(new Set([CBS.END_SHOOTING_PICTURE]), true, 'END_SHOOTING_PICTURE', CBS),
    'relseq_skip_native: fresh state skips nothing and never skips END_FOCUS / END_SHOOTING_PICTURE');
  // Cycle 1: S1 down posts START_FOCUS + START_SHOOTING_PICTURE natively
  const s1Step = new Set([CBS.START_SHOOTING_PICTURE, CBS.START_FOCUS]);
  ok(relseq_skip_native(s1Step, true, 'START_FOCUS', CBS)
    && relseq_skip_native(s1Step, true, 'START_SHOOTING_PICTURE', CBS)
    && !relseq_skip_native(s1Step, true, 'START_EXPOSE', CBS),
    'relseq_skip_native: S1 down step skips native START_FOCUS and START_SHOOTING_PICTURE, not START_EXPOSE');
  // After step clear while S1 is held (native_shot_started = true): S2 with S-TAKERDY off skips START_SHOOTING_PICTURE only
  ok(relseq_skip_native(new Set(), true, 'START_SHOOTING_PICTURE', CBS)
    && !relseq_skip_native(new Set(), true, 'START_FOCUS', CBS)
    && !relseq_skip_native(new Set(), true, 'START_EXPOSE', CBS),
    'relseq_skip_native: with native_shot_started and cleared step, only START_SHOOTING_PICTURE is skipped');
  // Full shot S2 down: native START_EXPOSE in step + native_shot_started = true
  const s2Step = new Set([CBS.START_EXPOSE]);
  ok(relseq_skip_native(s2Step, true, 'START_SHOOTING_PICTURE', CBS)
    && relseq_skip_native(s2Step, true, 'START_EXPOSE', CBS)
    && !relseq_skip_native(s2Step, true, 'START_FOCUS', CBS),
    'relseq_skip_native: S2 down step skips START_SHOOTING_PICTURE and native START_EXPOSE');
  // After S1 up / END_SHOOTING_PICTURE clears native_shot_started and step: next cycle starts clean
  ok(!relseq_skip_native(new Set(), false, 'START_SHOOTING_PICTURE', CBS)
    && !relseq_skip_native(new Set(), false, 'START_FOCUS', CBS)
    && !relseq_skip_native(new Set(), false, 'START_EXPOSE', CBS),
    'relseq_skip_native: after END_SHOOTING_PICTURE resets native_shot_started, next cycle starts clean');
  // 2. S-MODPOST and S-TAKERDY parity across E143, E146 and E147
  const q143 = { TAKE_EXEC: 0x5A, TAKE_FUNC: 0x5E, TFT_EXEC: 0x64 };
  const e143 = modpost_entries(TAKE_REQUESTS_E143, true);
  ok(e143 === MODPOST_E143
    && modpost_entry(q143.TAKE_EXEC, TAKE_REQUESTS_E143.api_post, [0, 0, TAKE_REQUESTS_E143.control_post, 0], q143, e143) !== null
    && modpost_entry(q143.TAKE_FUNC, TAKE_REQUESTS_E143.take_send, [0, 0, TAKE_REQUESTS_E143.func29.command, TAKE_REQUESTS_E143.func29.param], q143, e143) !== null
    && modpost_entry(q143.TAKE_EXEC, TAKE_REQUESTS_E143.api_post, null, q143, e143) === null
    && modpost_entry(q143.TFT_EXEC, TAKE_REQUESTS_E143.api_post, [0, 0, TAKE_REQUESTS_E143.control_post, 0], q143, e143) === null
    && modpost_entries(null, false).length === 0,
    'modpost_entries / modpost_entry: E143 matches control 0x40 and TAKE_FUNC 29, rejects wrong queue / null words / missing fact');
  for (const code of ['E146', 'E147']) {
    const f = FACTS[code], q = f?.api?.queues ?? {}, tr = f?.take_requests ?? null;
    const entries = modpost_entries(tr, false);
    ok(tr !== null && entries.length === 2
      && modpost_entry(q.TAKE_EXEC, tr.api_post, [0, 0, tr.control_post, 0], q, entries) !== null
      && modpost_entry(q.TAKE_FUNC, tr.take_send, [0, 0, tr.func29.command, tr.func29.param], q, entries) !== null
      && modpost_entry(q143.TAKE_EXEC, TAKE_REQUESTS_E143.api_post, [0, 0, TAKE_REQUESTS_E143.control_post, 0], q, entries) === null
      && take_ready_rule(q.TAKE_EXEC, 0, 0, q, tr) === 'ready'
      && take_ready_rule(q.TAKE_EXEC, 0, 1, q, tr) === 'other-kind'
      && take_ready_rule(q.TAKE_EXEC, 11, 0, q, tr) === 'take'
      && take_ready_rule(q.TAKE_EXEC, 7, 0, q, tr) === null
      && take_ready_rule(q.TAKE_FUNC, 0, 0, q, tr) === null
      && take_ready_rule(q.TAKE_EXEC, 0, 0, q, null) === null,
      `${code}: S-MODPOST and S-TAKERDY match body's own TAKE_EXEC/TAKE_FUNC and reject E143's / null fact`);
  }
  // 3. CamApp.prototype.take_ready must not dereference w[3] for non-TAKE_EXEC module queues with cmd 0
  let u32Reads = 0;
  const stub = {
    takerdy_on: true,
    take_requests: TAKE_REQUESTS_E143,
    s: { lab: { sim: { u32: () => { u32Reads++; throw new Error('unexpected u32 read on non-TAKE_EXEC queue'); } } } },
    queue_name: (q) => `queue ${q}`,
    log: [],
    takerdy_takes: [],
  };
  const nonTake = CamApp.prototype.take_ready.call(stub, 0xFFFF, [6, 1, TAKERDY_E143.ready, 0]);
  ok(nonTake === null && u32Reads === 0,
    `take_ready: non-TAKE_EXEC cmd 0 returns null without reading w[3] (got ${nonTake}, u32Reads=${u32Reads})`);
  return { checks, bad };
}

export async function stillSession() {
  const u = await c3takeUnits();
  const bad = [...u.bad];
  let checks = u.checks;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { A, MODEL, fact } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { POSITION_SWITCHES } = await import('../src/lab/play.mjs');
  const { CBS } = await import('../src/lab/camapp.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const PHASE_QUERY = A(0x50AB57E9), Q = fact('api.queues', { TAKE_EXEC: 0x5A, TAKE_FUNC: 0x5E }), TAKE_QUEUES = [Q.TAKE_EXEC, Q.TAKE_FUNC];
  if (MODEL === 'E147') {
    ok(POSITION_SWITCHES.length === 0 || POSITION_SWITCHES.some((p) => p.join() === STILL_SWITCH_E147.join()),
      `E147: the still / movie switch 0x1909 starts at its third position ${JSON.stringify(STILL_SWITCH_E147)}: ${JSON.stringify(POSITION_SWITCHES)}`);
  }
  const session = (tag, run) => {
    const pl = new Player(args, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, ca = s.camapp;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const key = (k, d) => { const rec = s.key(k, d); ca.pump(); return rec; };
      const tap = (k) => { const rec = key(k, 'down'); idle(100); key(k, 'up'); idle(800); return rec; };
      const phase = () => lab.call(PHASE_QUERY, {}, null, null, 200000).d0;
      const logged = (re, kind = 'modpost') => [...s.steps.flatMap((x) => x.camapp ?? []), ...ca.log].filter(([k, d]) => k === kind && re.test(d)).length;
      const left = () => TAKE_QUEUES.flatMap((q) => ca.modpost_left.get(q) ?? []).map((x) => x.what);
      run({ pl, s, ca, idle, key, tap, phase, logged, left });
    } catch (e) { bad.push(`${MODEL} ${tag}: ${e.message.slice(0, 800)}`); }
    pl.close_session();
  };
  session('S-TAKERDY', ({ pl, s, ca, idle, key, tap, phase, logged, left }) => {
    ok(ca.takerdy_on === true, `${MODEL}: S-TAKERDY on (${ca.takerdy_on})`);
    if (MODEL === 'E147') ok(POSITION_SWITCHES.some((p) => p.join() === STILL_SWITCH_E147.join()), `E147: the switch's idle position in play: ${JSON.stringify(POSITION_SWITCHES)}`);
    idle(2000);
    tap('menu'); tap('menu');                                  // the menu's close restarts the through image
    const p0 = phase();
    ok(s.status().gui === GUI_SHOOTING && p0 === STANDBY, `${MODEL}: the shooting screen after the menu (${s.status().gui}), phase ${p0}`);
    const halfPress = (n, label) => {
      const nat0 = ca.native_cbs.length;
      key('s1', 'down'); idle(600);
      const pDown = phase(), eDown = ca.takerdy_events, startedDown = ca.native_shot_started, stepDown = ca.native_cbs_step.size;
      const natStart = ca.native_cbs.slice(nat0).some(([id]) => id === CBS.START_SHOOTING_PICTURE);
      ok(pDown === READY_DONE && eDown === n && startedDown === true && natStart && stepDown === 0,
        `${MODEL}: ${label} S1 down -> ${READY_DONE}: phase ${pDown}, events ${eDown} (want ${n}), native START_SHOOTING_PICTURE ${natStart}, shot_started ${startedDown}, step_cbs ${stepDown}`);
      const nat1 = ca.native_cbs.length;
      key('s1', 'up'); idle(1000);
      const pUp = phase(), startedUp = ca.native_shot_started, stepUp = ca.native_cbs_step.size;
      const natEnd = ca.native_cbs.slice(nat1).some(([id]) => id === CBS.END_SHOOTING_PICTURE);
      ok(pUp === STANDBY && startedUp === false && natEnd && stepUp === 0 && ca.card_images() === 0 && left().length === 0,
        `${MODEL}: ${label} S1 up -> ${STANDBY}: phase ${pUp}, native END_SHOOTING_PICTURE ${natEnd}, shot_started ${startedUp}, step_cbs ${stepUp}, images ${ca.card_images()}, left ${JSON.stringify(left())}`);
    };
    // repeated S1 down -> S1 up cycles before menu navigation
    halfPress(1, 'cycle 1');
    halfPress(2, 'cycle 2');
    // MENU open -> DOWN -> MENU close -> return to shooting screen cleanly
    const open = tap('menu'), guiOpen = s.status().gui;
    const nav = tap('down'), guiDown = s.status().gui;
    const close = tap('menu'), guiBack = s.status().gui, pMenu = phase();
    ok(open.events.length > 0 && guiOpen === GUI_MENU
      && nav.events.length > 0 && guiDown === GUI_MENU
      && close.events.length > 0 && guiBack === GUI_SHOOTING
      && pMenu === STANDBY && ca.native_shot_started === false && ca.native_cbs_step.size === 0 && left().length === 0,
      `${MODEL}: MENU open -> DOWN -> MENU close: open ${open.events.length}/${guiOpen}, down ${nav.events.length}/${guiDown}, close ${close.events.length}/${guiBack}, phase ${pMenu}, shot_started ${ca.native_shot_started}, step_cbs ${ca.native_cbs_step.size}, left ${JSON.stringify(left())}`);
    // half-press cycle after menu navigation verifies clean state recovery
    halfPress(3, 'post-menu');
    // full shot: S1 down -> S2 down -> S2 up -> S1 up
    const nat0 = ca.native_cbs.length;
    key('s1', 'down'); idle(600);
    key('s2', 'down'); idle(700);
    const p3 = phase();
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const p4 = phase(), rec = tap('menu');
    const shotNat = ca.native_cbs.slice(nat0).map(([id]) => id);
    const dupStartPic = logged(/^START_SHOOTING_PICTURE\(/, 'cbs'), dupExpose = logged(/^START_EXPOSE\(/, 'cbs');
    const skipStartPic = logged(/^START_SHOOTING_PICTURE skipped:/, 'cbs'), skipExpose = logged(/^START_EXPOSE skipped:/, 'cbs');
    const natFocus = ca.native_cbs.filter(([id]) => id === CBS.START_FOCUS).length;
    const dupFocus = logged(/^START_FOCUS\(/, 'cbs'), skipFocus = logged(/^START_FOCUS skipped:/, 'cbs');
    ok(p3 === TAKE_PICTURE && p4 === TAKE_PICTURE && ca.takerdy_events === 4 && ca.takerdy_takes.length === 1 && rec.events.length === 0
      && s.status().gui === GUI_SHOOTING && ca.card_images() === 1 && ca.native_shot_started === false,
      `${MODEL}: a full shot goes to ${TAKE_PICTURE}: after S2 ${p3}, after the releases ${p4}; events ${ca.takerdy_events}, take-picture requests taken ${ca.takerdy_takes.length}; MENU sets ${rec.events.length} GUI events (${s.status().gui}); S-RELSEQ's picture ${ca.card_images()}, shot_started ${ca.native_shot_started}`);
    ok(shotNat.includes(CBS.START_SHOOTING_PICTURE) && shotNat.includes(CBS.START_EXPOSE)
      && dupStartPic === 0 && dupExpose === 0 && skipStartPic === 1 && skipExpose === 1
      && (natFocus === 0 || (dupFocus === 0 && skipFocus === natFocus)),
      `${MODEL}: native sequence callbacks deduplicated in S-RELSEQ: shot native ${JSON.stringify(shotNat)}, dup [pic=${dupStartPic}, exp=${dupExpose}, foc=${dupFocus}], skipped [pic=${skipStartPic}, exp=${skipExpose}, foc=${skipFocus}/${natFocus}]`);
    const used = pl.stand_ins_in_use(), f29 = logged(/^TAKE_FUNC \(\d+\) cmd 29 .*: taken as TAKE_FUNC would take it/);
    ok(used.includes('S-TAKERDY') && used.includes('S-MODPOST') && f29 === 1 && left().length === 0,
      `${MODEL}: the player lists S-TAKERDY (${used.includes('S-TAKERDY')}) and S-MODPOST (${used.includes('S-MODPOST')}); TAKE_FUNC 29 taken ${f29} times; direct posts left in TAKE's queues: ${JSON.stringify(left())}`);
  });
  // the control: S-TAKERDY off, so the take-ready never ends; S2's direct post is the take API's control 0x40
  session('control (S-TAKERDY off)', ({ s, ca, idle, key, tap, phase, logged, left }) => {
    ca.takerdy_on = false;
    idle(2000);
    tap('menu'); tap('menu');
    const m0 = ca.modpost_taken;
    key('s1', 'down'); idle(600);
    const p1 = phase();
    key('s2', 'down'); idle(700);
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const p2 = phase(), rec = tap('menu');
    const natExpose = ca.native_cbs.some(([id]) => id === CBS.START_EXPOSE);
    const postExpose = logged(/^START_EXPOSE\(/, 'cbs'), skipStartPic = logged(/^START_SHOOTING_PICTURE skipped:/, 'cbs');
    ok(p1 === READY && p2 === READY && ca.takerdy_events === 0 && ca.modpost_taken === m0 + 1 && left().length === 0 && rec.events.length === 0 && s.status().gui === GUI_SHOOTING
      && !natExpose && postExpose === 1 && skipStartPic === 1,
      `${MODEL} control: S1 stops in ${p1} with no event (${ca.takerdy_events}), the full shot leaves ${p2}, S2's direct post taken (${ca.modpost_taken - m0}), MENU sets ${rec.events.length} GUI events, native START_EXPOSE ${natExpose}, S-RELSEQ START_EXPOSE ${postExpose}, skipped START_SHOOTING_PICTURE ${skipStartPic}`);
  });
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const which = process.argv[2] ?? 'all';
  const r = which === 'units' ? await c3takeUnits() : await stillSession();
  const label = which === 'units' ? 'camapp 3 units' : `a still under control camapp 3 (${MODEL})`;
  console.log(`${label}: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
