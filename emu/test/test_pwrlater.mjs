// The power manager's later inits at the play bring-up (src/lab/power.mjs laterInits, H-PWRLATER, opt-in with
// OM_POWER_LATER=on; docs/hle-gaps/4.7.md 4.7.16), E143:
//   pwrLaterSession  (firmware; the sub-CPU's own firmware, OM_EMU_SCPU=native's) a play session's start with the
//                  opt-in: both inits (fact power.later: 0x50044ed7, 0x50044f7d) return with PWR_MAIN waiting and no
//                  errlog, the first sends the start's 0x14 {0, 1, 0, 3, 0} and the second the battery check's 0x11
//                  {0, 0, 0, 0}, A and C read 1, the player reports H-PWRLATER, and the start reaches the shooting
//                  screen (GUI 0x0108) with the frame and lab time of the same start without the opt-in (no
//                  H-PWRLATER there); in the next second the sub-CPU answers 0x11 through the poll with its 57-byte
//                  message and the MN sends 0x14 {0, 1, 0, 1, 0}; then with S-SCPUDEV (4.7.19) the opt-in runs both
//                  inits, the second's frames being 0x11, the poll with the image's answer and that 0x14, and
//                  reaches the shooting screen with the same frame and lab time, as S-SCPUDEV's start without it
//   node emu/test/test_pwrlater.mjs   (exit 1 on a failure)
import { createHash } from 'node:crypto';

const GUI_SHOOTING = '0x0108';
const START_14 = '0001000300', CHECK_11 = '00000000';   // the frames' data (4.7.6: {0, inserted 0, inserted 1, recommend 0, recommend 1}; {0, slot, kind, 0})
// the sub-CPU's answer to CHECK_11 (4.7.19: its poll reply, the message 0x11 of 57 bytes, X) and the MN's 0x14 after it
const BAT_ANSWER = '3b11' + '000000013301' + '00'.repeat(51), RECOMMEND_14 = '0001000100';

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
  // the start's end: GUI, the published frame's sha16 and the lab time
  const end = (pl) => ({ gui: pl.session.status().gui, frame: pl.frame?.[3] ?? null, lab: pl.session.lab.lab_time(), used: pl.stand_ins_in_use() });
  const same = (a, b) => a && b && a.gui === b.gui && a.frame === b.frame && a.lab === b.lab;
  const show = (x) => (x ? `GUI ${x.gui} frame ${x.frame} lab ${x.lab}` : 'none');
  try {
    // the control: the start without the opt-in
    const c = open(false, 'native');
    ok(!c.error, `${MODEL}: the start without the opt-in: ${c.error?.message.split('\n')[0]}`);
    const control = c.error ? null : end(c.pl);
    if (!c.error) c.pl.close_session();
    ok(control?.gui === GUI_SHOOTING && control.frame && !control.used.includes('H-PWRLATER'), `${MODEL}: the control reaches the shooting screen without H-PWRLATER: ${show(control)}`);
    let answer = null;
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
      const e = end(r.pl);
      ok(same(e, control), `${MODEL}: the start reaches the shooting screen with H-PWRLATER, as the control: ${show(e)} (control ${show(control)})`);
      // the sub-CPU's answer: its poll and the MN's 0x14 that follows, within a second of lab time
      const n0 = lab.scpu_dev.frames.length;
      for (let t = lab.lab_time(), k = 1; k <= 20; k++) s.idle_slice(t + k * 50e6);
      const after = lab.scpu_dev.frames.slice(n0).map((y) => `${y.cmd} ${y.data} ${y.reply}`);
      answer = after[0]?.split(' ')[2] ?? null;
      ok(after.length === 2 && after[0] === `0x8f  ${BAT_ANSWER}` && after[1] === `0x14 ${RECOMMEND_14} null`,
        `${MODEL}: the sub-CPU answers 0x11 with {0, 0, 0, 1, 0x33, 1, 51 zeros} through the poll, then the MN sends 0x14 ${RECOMMEND_14}: ${JSON.stringify(after)}`);
      r.pl.close_session();
    }
    // S-SCPUDEV: its start without the opt-in, and with it both inits, the 0x11 answered as the image answers it
    const dc = open(false, 'off');
    ok(!dc.error, `${MODEL}: S-SCPUDEV's start without the opt-in: ${dc.error?.message.split('\n')[0]}`);
    const dcontrol = dc.error ? null : end(dc.pl);
    if (!dc.error) dc.pl.close_session();
    ok(same(dcontrol, control), `${MODEL}: S-SCPUDEV's start as the sub-CPU's own: ${show(dcontrol)}`);
    const d = open(true, 'off');
    ok(!d.error, `${MODEL}: S-SCPUDEV's start with H-PWRLATER: ${d.error?.message.split('\n')[0]}`);
    if (!d.error) {
      const s = d.pl.session, lab = s.lab, later = s.power_manager?.later ?? [];
      const frames = later.map((x) => x.frames.map((y) => `${y.cmd} ${y.data}${y.reply ? ` ${y.reply}` : ''}`));
      ok(later.length === 2 && later.every((x) => x.state === 4 && !x.errlog.length), `${MODEL}: S-SCPUDEV: both inits ran, PWR_MAIN waiting, no errlog: ${JSON.stringify(later.map((x) => [x.init, x.state, x.errlog]))}`);
      ok(JSON.stringify(frames) === JSON.stringify([[`0x14 ${START_14}`], [`0x11 ${CHECK_11}`, `0x8f  ${BAT_ANSWER}`, `0x14 ${RECOMMEND_14}`]]) && answer === BAT_ANSWER,
        `${MODEL}: S-SCPUDEV: the second init's 0x11, the poll with the image's answer, the 0x14 that follows: ${JSON.stringify(frames)}`);
      ok(lab.sim.read(f.a, 1)[0] === 1 && lab.sim.read(f.c, 1)[0] === 1 && d.pl.stand_ins_in_use().includes('H-PWRLATER'), `${MODEL}: S-SCPUDEV: A and C set, H-PWRLATER reported`);
      const e = end(d.pl);
      ok(same(e, control), `${MODEL}: S-SCPUDEV: the start with H-PWRLATER reaches the shooting screen as the control: ${show(e)}`);
      d.pl.close_session();
    }
  } finally {
    if (was === undefined) delete process.env.OM_POWER_LATER; else process.env.OM_POWER_LATER = was;
  }
  return { checks, bad, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad, skipped } = await pwrLaterSession();
  for (const b of bad) console.log(`FAIL ${b}`);
  for (const x of skipped) console.log(`SKIPPED ${x}`);
  console.log(`the power manager's later inits: ${checks - bad.length}/${checks} checks`);
  process.exit(bad.length || skipped.length ? 1 : 0);
}
