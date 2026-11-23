// CapMov_MovieRecorderSLR's observer lists and api_movie's start / stop under control camapp 2 (E143;
// docs/hle-gaps.md 4.5, 2026-11-22): a session with the HLS components, the mode dial at Movie and REC pressed twice.
// Watched (lab.observe at the disassembly address):
//   the recorder facade's seven add-observer methods 0x50bf27d4..0x50bf286a (each: the impl at +4, its list at
//     +536..+560 by the getters 0x50bf1c36..0x50bf1c8a, then the list add 0x50d7f472 with a1, the observer)
//   api_movie's movie start 0x503f1a00 (API 0x5000c) and movie stop 0x503f1af9 (API 0x5000d)
// The result is recorded, not asserted against an expectation the firmware has not shown: the checks are that the
// session runs through REC twice; the counts are printed for 4.5.
const ADDS = [0x50BF27D4, 0x50BF27ED, 0x50BF2806, 0x50BF281F, 0x50BF2838, 0x50BF2851, 0x50BF286A];
const MOVIE_START = 0x503F1A00, MOVIE_STOP = 0x503F1AF9;
export async function movieObserverSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.camapp_components = true;
  const seen = { adds: [], start: [], stop: [] };
  try {
    const watch = (lab) => {
      ADDS.forEach((a, i) => lab.observe(a, (l, r) => seen.adds.push([i, r.a1 >>> 0, l.sim.u32(r.a1 >>> 0) >>> 0]), `test: recorder add-observer ${i}`));
      lab.observe(MOVIE_START, (l, r) => seen.start.push(l.lab_time()), 'test: api_movie start');
      lab.observe(MOVIE_STOP, (l, r) => seen.stop.push(l.lab_time()), 'test: api_movie stop');
    };
    pl.open_session();
    const s = pl.session, lab = s.lab;
    // the player gives no hook before the boot: the watches start after open_session (an add made in the boot is
    // not seen)
    watch(lab);
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const press = (k) => { s.key(k, 'down'); s.camapp.pump(); s.key(k, 'up'); s.camapp.pump(); };
    idle(1000);
    if (!s.stand_ins?.includes?.('S-LENSMCU') && !pl.stand_ins_in_use().includes('S-LENSMCU')) { s.key('fw_121c', 'down'); s.camapp.pump(); }
    pl.run_input({ type: 'switch', id: 'mode_dial', value: 7 });
    idle(1000);
    press('rec'); idle(2500);
    const rec = s.camapp.status().recording_s;
    press('rec'); idle(500);
    const st = s.camapp.status();
    ok(st.components === true, `camapp 2: the HLS components run (${st.components})`);
    ok(rec >= 1.5 && st.recording_s === null, `REC starts a recording (${rec} s) and REC again ends it (${st.recording_s})`);
    console.log(`movie observers: add-observer calls ${JSON.stringify(seen.adds.map(([i, o, vt]) => [i, '0x' + o.toString(16), '0x' + vt.toString(16)]))}; api_movie start ${seen.start.length}, stop ${seen.stop.length}`);
  } catch (e) {
    bad.push(`movie observer session: ${e.stack ?? e}`);
  } finally {
    try { pl.close_session(); } catch { /* closed */ }
  }
  return { checks, bad, seen };
}
