// The creative dial (src/lab/play.mjs creative_dial: UI_IN's position switch 0x1906), in play on the process's model:
//   cdialSession  E147 (bin/test.mjs runs it in a child with OM_EMU_MODEL=E147): the dial starts at position 1, where
//                 the picture-mode family (setting 897) reads 901; turned through its five positions by the Player's
//                 inputs ({type: switch, value}) the family reads 988, 901, 898, 899, 900 (src/fw/models.mjs
//                 creative_dial) and the application opens the Picture Mode page at every position but 2; a step and a
//                 key press move it on, wrapping; /api/controls and the status show it wired with its labels; a
//                 session started with creative_dial 3 reads 899 from the start. Controls: with the mutant cdial-reversed
//                 (the entries in reverse order) position 0 sets the last entry's family, and a position past the
//                 dial's last is refused. E143 (bin/test.mjs's process): the dial is not wired, and an input or a start
//                 position for it is refused with the reason
//   node emu/test/test_cdial.mjs              (OM_EMU_MODEL=E147 for the OM-3)

const FAMILY = 897;                              // the picture-mode family the dial sets (src/fw/models.mjs creative_dial)

export async function cdialSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { BY_ID, Tables } = await import('../src/lab/play.mjs');
  const { PlayApi } = await import('../src/lab/playapi.mjs');
  const rom = loadImage();
  const env = { rom, resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const open = (more = {}) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...more }, env);
    pl.open_session();
    pl.session.idle_slice(pl.session.lab.lab_time() + 1500e6);
    return pl;
  };
  const throwsLike = (f, re) => { try { f(); return null; } catch (e) { return re.test(e.message) ? true : e.message; } };
  if (MODEL === 'E143') {
    const pl = open(), c = BY_ID.get('creative_dial');
    ok(c.status === 'not-wired' && /0x1906 is not in E143's UI_IN tables/.test(c.reason), `E143: the dial is not wired: ${c.status} ${c.reason}`);
    ok(throwsLike(() => pl.run_input({ type: 'switch', id: 'creative_dial', value: 0 }), /Creative dial: not wired/) === true, 'E143: an input refused with the reason');
    ok(!('creative_dial' in pl.session.status()), 'E143: the status has no creative dial');
    pl.close_session();
    ok(throwsLike(() => open({ creative_dial: 0 }), /--creative-dial: 0x1906 is not in E143's UI_IN tables/) === true, 'E143: a start position refused with the reason');
    return { checks, bad };
  }
  let pl = open();
  const s = () => pl.session;
  const c = BY_ID.get('creative_dial');
  ok(c.status === 'wired' && c.positions?.length === 5 && c.labels.join() === 'MONO,COLOR,position 2,ART,CRT', `${MODEL}: the dial wired with five positions: ${c.status} ${JSON.stringify(c.positions)} ${c.labels}`);
  const doc = new PlayApi(pl, { tables: Tables.of(rom) }).get({ headers: {} }, '/api/controls', {});
  const row = JSON.parse(new TextDecoder().decode(doc.body)).find((r) => r.id === 'creative_dial');
  ok(row?.status === 'wired' && row.uiin?.code === '0x1906' && row.labels?.length === 5, `/api/controls' row: ${JSON.stringify(row).slice(0, 300)}`);
  let st = s().status();
  ok(st.creative_dial === 1 && st.creative_dial_positions?.[1] === 'COLOR' && s().get(FAMILY) === 901, `the start: position ${st.creative_dial}, family ${s().get(FAMILY)}`);
  const turn = (inp) => {
    const rec = pl.run_input(inp);
    s().camapp.pump(); s().idle_slice(s().lab.lab_time() + 1000e6);
    return rec;
  };
  const want = [988, 901, 898, 899, 900];
  for (const k of [0, 1, 2, 3, 4]) {
    const rec = turn({ type: 'switch', id: 'creative_dial', value: k });
    st = s().status();
    const page = /DIRECT_PICTUREMODE/.test(st.gui_name);
    ok(s().get(FAMILY) === want[k] && st.creative_dial === k && rec?.position?.label === c.labels[k] && page === (k !== 2),
      `position ${k} (${c.labels[k]}): family ${s().get(FAMILY)}, want ${want[k]}; status ${st.creative_dial}; record ${JSON.stringify(rec?.position)}; screen ${st.gui_name}`);
  }
  turn({ type: 'switch', id: 'creative_dial', step: -1 });
  ok(s().cdial_index === 3 && s().get(FAMILY) === 899, `a step of -1 from 4: position ${s().cdial_index}, family ${s().get(FAMILY)}`);
  turn({ type: 'key', id: 'creative_dial', action: 'down' }); turn({ type: 'key', id: 'creative_dial', action: 'up' });
  turn({ type: 'switch', id: 'creative_dial', step: 2 });
  ok(s().cdial_index === 1 && s().get(FAMILY) === 901, `a key press (3 -> 4), then a step of 2 (wrapping to 1): position ${s().cdial_index}, family ${s().get(FAMILY)}`);
  ok(throwsLike(() => pl.run_input({ type: 'switch', id: 'creative_dial', value: 5 }), /Creative dial position 5: 0\.\.4/) === true, 'control: position 5 refused');
  pl.close_session();
  // the start position: 3 (ART) from the start
  pl = open({ creative_dial: 3 });
  ok(s().status().creative_dial === 3 && s().get(FAMILY) === 899, `started at position 3: position ${s().status().creative_dial}, family ${s().get(FAMILY)}`);
  pl.close_session();
  ok(throwsLike(() => open({ creative_dial: 7 }), /--creative-dial 7: a position 0\.\.4/) === true, 'control: a start position past the last refused');
  // control: the dial's entries taken in reverse order (the mutant cdial-reversed): position 0 sets the last entry's
  // family, which the check above would refuse
  pl = open({ x_mutant: 'cdial-reversed' });
  turn({ type: 'switch', id: 'creative_dial', value: 0 });
  ok(s().get(FAMILY) === 900, `control: with cdial-reversed position 0 sets the family to ${s().get(FAMILY)}, want the last entry's 900 (not 988)`);
  pl.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await cdialSession();
  const { MODEL } = await import('../src/fw/model.mjs');
  console.log(`creative dial (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
