// A still under control camapp 3 on the body of OM_EMU_MODEL (E143, E146, E147; docs/hle-gaps.md 4.1.11, 4.1.12,
// 4.1.13):
//   stillSession  the session of test_take_ready.mjs takeReadySession on any of the three bodies, read through the
//                  body's own shooting phase query (OlyHfwOpeShoot's 0x50ab57e9, the sequence controller's phase, or
//                  100 with none; the port places it). TAKE's protocol is the body's (src/fw/facts.mjs takeRequests:
//                  E143's own, E146's and E147's read from their code), so S-TAKERDY and S-MODPOST are on. After the
//                  menu has restarted the through image S1 takes the sequence out of STANDBY (101) through READY (102)
//                  to 103 on S-TAKERDY's one event; S1 released alone returns it to 101 through END_WAIT and MENU
//                  opens the menu; a full shot goes to 106 with the take-picture request taken and not answered, and
//                  MENU sets no GUI event after it. TAKE_FUNC 29 is taken once, and no direct post is left in
//                  TAKE_EXEC or TAKE_FUNC (on E146 and E147 the start's AUD_EXEC command 2 stays in its queue, as
//                  before: not TAKE's). The control (S-TAKERDY off before the first take request): S1 stops in READY
//                  (102) with no event and a full shot leaves the sequence there; S2's direct post (the take API's
//                  control 0x40) is S-MODPOST's then.
//                  On E147 the still / movie switch 0x1909 starts at its third position (src/fw/models.mjs
//                  switch_idle), where the application reads stills: at the first two it reads its movie mode, gives
//                  the sequence no release keys, and S1 left the phase at 101 (X: the session before 2026-11-13)
//   node emu/test/test_c3take.mjs            (OM_EMU_MODEL=E146 / E147 for the other bodies)
import { fileURLToPath } from 'node:url';

const GUI_SHOOTING = '0x0108', GUI_MENU = '0x0b02';
const STANDBY = 101, READY = 102, READY_DONE = 103, TAKE_PICTURE = 106;
// E147's still / movie switch: UI_IN's 0x1909 at its third position, [group, byte, bit, polarity] (its tables, X)
const STILL_SWITCH_E147 = [4, 0, 2, 1];

export async function stillSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { A, MODEL, fact } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { POSITION_SWITCHES } = await import('../src/lab/play.mjs');
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
      const logged = (re) => [...s.steps.flatMap((x) => x.camapp ?? []), ...ca.log].filter(([k, d]) => k === 'modpost' && re.test(d)).length;
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
    key('s1', 'down'); idle(600);
    const p1 = phase(), e1 = ca.takerdy_events;
    ok(p1 === READY_DONE && e1 === 1, `${MODEL}: S1 takes the sequence to ${READY_DONE} on S-TAKERDY's event: phase ${p1}, events ${e1}`);
    key('s1', 'up'); idle(1000);
    const p2 = phase();
    const open = tap('menu'), gui = s.status().gui, close = tap('menu');
    ok(p2 === STANDBY && open.events.length > 0 && gui === GUI_MENU && close.events.length > 0 && s.status().gui === GUI_SHOOTING,
      `${MODEL}: S1 released alone returns to ${p2} (want ${STANDBY}), MENU after it: ${open.events.length} GUI events, ${gui} (want ${GUI_MENU}), back ${s.status().gui}`);
    key('s1', 'down'); idle(600);
    key('s2', 'down'); idle(700);
    const p3 = phase();
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const p4 = phase(), rec = tap('menu');
    ok(p3 === TAKE_PICTURE && p4 === TAKE_PICTURE && ca.takerdy_events === 2 && ca.takerdy_takes.length === 1 && rec.events.length === 0
      && s.status().gui === GUI_SHOOTING && ca.card_images() === 1,
      `${MODEL}: a full shot goes to ${TAKE_PICTURE}: after S2 ${p3}, after the releases ${p4}; events ${ca.takerdy_events}, take-picture requests taken ${ca.takerdy_takes.length}; MENU sets ${rec.events.length} GUI events (${s.status().gui}); S-RELSEQ's picture ${ca.card_images()}`);
    const used = pl.stand_ins_in_use(), f29 = logged(/^TAKE_FUNC \(\d+\) cmd 29 .*: taken as TAKE_FUNC would take it/);
    ok(used.includes('S-TAKERDY') && used.includes('S-MODPOST') && f29 === 1 && left().length === 0,
      `${MODEL}: the player lists S-TAKERDY (${used.includes('S-TAKERDY')}) and S-MODPOST (${used.includes('S-MODPOST')}); TAKE_FUNC 29 taken ${f29} times; direct posts left in TAKE's queues: ${JSON.stringify(left())}`);
  });
  // the control: S-TAKERDY off, so the take-ready never ends; S2's direct post is the take API's control 0x40
  session('control (S-TAKERDY off)', ({ s, ca, idle, key, tap, phase, left }) => {
    ca.takerdy_on = false;
    idle(2000);
    tap('menu'); tap('menu');
    const m0 = ca.modpost_taken;
    key('s1', 'down'); idle(600);
    const p1 = phase();
    key('s2', 'down'); idle(700);
    key('s2', 'up'); key('s1', 'up'); idle(2000);
    const p2 = phase(), rec = tap('menu');
    ok(p1 === READY && p2 === READY && ca.takerdy_events === 0 && ca.modpost_taken === m0 + 1 && left().length === 0 && rec.events.length === 0 && s.status().gui === GUI_SHOOTING,
      `${MODEL} control: S1 stops in ${p1} with no event (${ca.takerdy_events}), the full shot leaves ${p2}, S2's direct post taken (${ca.modpost_taken - m0}), MENU sets ${rec.events.length} GUI events`);
  });
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const r = await stillSession();
  console.log(`a still under control camapp 3 (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
