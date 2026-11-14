// A still under control camapp 3 on the body of OM_EMU_MODEL (E143, E146, E147; docs/hle-gaps.md 4.1.12, 4.1.13):
//   stillSession  the session of test_take_ready.mjs takeReadySession on any of the three bodies, read through the
//                  body's own shooting phase query (OlyHfwOpeShoot's 0x50ab57e9, the sequence controller's phase, or
//                  100 with none; the port places it). After the menu has restarted the through image, S1 takes the
//                  sequence out of STANDBY (101) into READY (102), or on to 103 where S-TAKERDY follows S-MODACK's
//                  answer with TAKE's event; S1 released alone returns it to 101 through END_WAIT and MENU opens the
//                  menu. Then a full shot: with S-TAKERDY S2 goes to 106 and the take-picture request waits, without
//                  it the sequence stays in 102; either way MENU sets no GUI event after it.
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
  const { A, MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { POSITION_SWITCHES } = await import('../src/lab/play.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const PHASE_QUERY = A(0x50AB57E9);
  const pl = new Player(args, env);
  pl.camapp_components = true; pl.camapp_native_tra = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, ca = s.camapp;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const key = (k, d) => { const rec = s.key(k, d); ca.pump(); return rec; };
    const tap = (k) => { const rec = key(k, 'down'); idle(100); key(k, 'up'); idle(800); return rec; };
    const phase = () => lab.call(PHASE_QUERY, {}, null, null, 200000).d0;
    if (MODEL === 'E147') {
      ok(POSITION_SWITCHES.some((p) => p.join() === STILL_SWITCH_E147.join()),
        `E147: the still / movie switch 0x1909 starts at its third position ${JSON.stringify(STILL_SWITCH_E147)}: ${JSON.stringify(POSITION_SWITCHES)}`);
    }
    idle(2000);
    tap('menu'); tap('menu');                                  // the menu's close restarts the through image
    const p0 = phase(), takerdy = ca.takerdy_on;
    ok(s.status().gui === GUI_SHOOTING && p0 === STANDBY, `${MODEL}: the shooting screen after the menu (${s.status().gui}), phase ${p0}`);
    key('s1', 'down'); idle(600);
    const p1 = phase();
    ok(p1 === (takerdy ? READY_DONE : READY), `${MODEL}: S1 takes the sequence to ${takerdy ? READY_DONE : READY} (S-TAKERDY ${takerdy}): phase ${p1}`);
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
    const want = takerdy ? TAKE_PICTURE : READY;
    ok(p3 === want && p4 === want && rec.events.length === 0 && s.status().gui === GUI_SHOOTING && ca.card_images() === 1,
      `${MODEL}: a full shot leaves the sequence in ${want}: after S2 ${p3}, after the releases ${p4}; MENU sets ${rec.events.length} GUI events (${s.status().gui}); S-RELSEQ's picture ${ca.card_images()}`);
  } catch (e) { bad.push(`session: ${e.message.slice(0, 800)}`); }
  pl.close_session();
  return { checks, bad };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { MODEL } = await import('../src/fw/model.mjs');
  const r = await stillSession();
  console.log(`a still under control camapp 3 (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
