// The power manager's later inits at the play bring-up (src/lab/power.mjs laterInits, H-PWRLATER, opt-in with
// OM_POWER_LATER=on; docs/hle-gaps/4.7.md 4.7.16), E143:
//   pwrLaterSession  (firmware; the sub-CPU's own firmware, OM_EMU_SCPU=native's) a play session's start with the
//                  opt-in: both inits (fact power.later: 0x50044ed7, 0x50044f7d) return with PWR_MAIN waiting and no
//                  errlog, the first sends the start's 0x14 {0, 1, 0, 3, 0} and the second the battery check's 0x11
//                  {0, 0, 0, 0}, A and C read 1, the player reports H-PWRLATER, and the start reaches the shooting
//                  screen (GUI 0x0108), as the same start without the opt-in does (no H-PWRLATER there); then with
//                  S-SCPUDEV the opt-in stops at the second init on S-SCPUDEV's refusal of 0x11
//   node emu/test/test_pwrlater.mjs   (exit 1 on a failure)
import { createHash } from 'node:crypto';

const GUI_SHOOTING = '0x0108';
const START_14 = '0001000300', CHECK_11 = '00000000';   // the frames' data (4.7.6: {0, inserted 0, inserted 1, recommend 0, recommend 1}; {0, slot, kind, 0})

export async function pwrLaterSession() {
  const bad = [], skipped = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, loadScpuImage } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, MODEL_INFO, fact } = await import('../src/fw/model.mjs');
  const { POWER_LATER_E143 } = await import('../src/fw/facts.mjs');
  if (MODEL !== 'E143') { skipped.push(`${MODEL}: H-PWRLATER is run on E143 only (the other bodies' sessions are not run)`); return { checks, bad, skipped }; }
  if (!MODEL_INFO.scpu_lle) { skipped.push(`${MODEL} gives no SCPU image`); return { checks, bad, skipped }; }
  let scpuImage;
  try { scpuImage = loadScpuImage(); } catch (e) { skipped.push(`${MODEL}: ${e.message}`); return { checks, bad, skipped }; }
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const args = { ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
  const f = fact('power.later', POWER_LATER_E143), was = process.env.OM_POWER_LATER;
  const open = (later, scpu) => {
    if (later) process.env.OM_POWER_LATER = 'on'; else delete process.env.OM_POWER_LATER;
    const pl = new Player(args, { ...base, ...(scpu === 'native' ? { scpu: 'native', scpuImage } : { scpu: 'off' }) });
    try { pl.open_session(); return { pl }; } catch (e) { try { pl.close_session(); } catch { /* never opened */ } return { pl, error: e }; }
  };
  try {
    // the control: the start without the opt-in
    const c = open(false, 'native');
    ok(!c.error, `${MODEL}: the start without the opt-in: ${c.error?.message.split('\n')[0]}`);
    const control = c.error ? null : { gui: c.pl.session.status().gui, used: c.pl.stand_ins_in_use() };
    if (!c.error) c.pl.close_session();
    ok(control?.gui === GUI_SHOOTING && !control.used.includes('H-PWRLATER'), `${MODEL}: the control reaches the shooting screen without H-PWRLATER: GUI ${control?.gui}`);
    // the opt-in with the sub-CPU's own firmware
    const r = open(true, 'native');
    ok(!r.error, `${MODEL}: the start with H-PWRLATER: ${r.error?.message.split('\n')[0]}`);
    if (!r.error) {
      const s = r.pl.session, lab = s.lab, later = s.power_manager?.later ?? [];
      const hex = (v) => '0x' + (v >>> 0).toString(16);
      ok(later.length === 2 && later[0].init === hex(f.early) && later[1].init === hex(f.late), `${MODEL}: both later inits ran, ${hex(f.early)} then ${hex(f.late)}: ${JSON.stringify(later.map((x) => x.init))}`);
      ok(later.every((x) => x.state === 4 && !x.errlog.length), `${MODEL}: PWR_MAIN waiting after each, no errlog: ${JSON.stringify(later.map((x) => [x.state, x.errlog]))}`);
      const frames = later.map((x) => x.frames.map((y) => `${y.cmd} ${y.data}`).join(','));
      ok(frames[0] === `0x14 ${START_14}` && frames[1] === `0x11 ${CHECK_11}`, `${MODEL}: the first sends 0x14 ${START_14}, the second 0x11 ${CHECK_11}: ${JSON.stringify(frames)}`);
      ok(lab.sim.read(f.a, 1)[0] === 1 && lab.sim.read(f.c, 1)[0] === 1, `${MODEL}: A and C set by ${hex(f.late)}`);
      ok(r.pl.stand_ins_in_use().includes('H-PWRLATER'), `${MODEL}: H-PWRLATER reported`);
      ok(s.status().gui === GUI_SHOOTING, `${MODEL}: the start reaches the shooting screen with H-PWRLATER: GUI ${s.status().gui}`);
      r.pl.close_session();
    }
    // the opt-in with S-SCPUDEV: its refusal of the battery check's 0x11, at the second init
    const d = open(true, 'off');
    ok(d.error && /H-PWRLATER: 0x50044f7d: .*S-SCPUDEV: command 0x11/.test(d.error.message), `${MODEL}: with S-SCPUDEV the opt-in stops on 0x11 at ${hex8(f.late)}: ${d.error ? d.error.message.split('\n')[0] : 'it opened'}`);
  } finally {
    if (was === undefined) delete process.env.OM_POWER_LATER; else process.env.OM_POWER_LATER = was;
  }
  return { checks, bad, skipped };
}
const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad, skipped } = await pwrLaterSession();
  for (const b of bad) console.log(`FAIL ${b}`);
  for (const x of skipped) console.log(`SKIPPED ${x}`);
  console.log(`the power manager's later inits: ${checks - bad.length}/${checks} checks`);
  process.exit(bad.length || skipped.length ? 1 : 0);
}
