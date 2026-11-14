// The OM-3's still / movie switch as a player input (src/lab/play.mjs still_movie: UI_IN's position switch 0x1909), in
// play on the process's model:
//   smswitchSession  E147 (bin/test.mjs runs it in a child with OM_EMU_MODEL=E147): the switch wired with three
//                    positions and its labels (src/fw/models.mjs still_movie), /api/controls' row; the session starts
//                    at position 2 (switch_idle), where the application's movie mode, setting 44, reads 0; moved by the
//                    Player's inputs ({type: switch, value}) 44 reads 1 at positions 1 and 0 and 0 again at 2; a step
//                    and a key press move it on, wrapping; a position past the last is refused; moved to 1 on the kept
//                    state (S-NVRAM), the power lever off and the camera powered on again, the new session starts at 1
//                    (44 reads 1) with the
//                    position carried, a Player opened on the positions that off left starts there too and logs them,
//                    and a restart is a fresh start at 2 with nothing carried; a carried record with still_movie is taken by
//                    --replay's reader; through bin/session.mjs, 'switch:still_movie=1', power:off and restart: the
//                    restart's record carries position 1. E143 (bin/test.mjs's process): the switch is not wired, and
//                    an input for it is refused with the reason. Controls: without the control (before 2026-11-14) the
//                    input was refused as an unknown id and every E147 check here failed (X, by hand)
//   node emu/test/test_smswitch.mjs              (OM_EMU_MODEL=E147 for the OM-3)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EMU = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MOVIE = 44;                                // the application's movie mode (src/fw/models.mjs switch_idle)

export async function smswitchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player, replayCarried } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { BY_ID, Tables } = await import('../src/lab/play.mjs');
  const { PlayApi } = await import('../src/lab/playapi.mjs');
  const rom = loadImage();
  const env = { rom, resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const open = (more = {}, envMore = {}) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...more }, { ...env, ...envMore });
    pl.open_session();
    pl.session.idle_slice(pl.session.lab.lab_time() + 1500e6);
    return pl;
  };
  const throwsLike = (f, re) => { try { f(); return null; } catch (e) { return re.test(e.message) ? true : e.message; } };
  if (MODEL === 'E143') {
    const pl = open(), c = BY_ID.get('still_movie');
    ok(c.status === 'not-wired' && /0x1909 is not in E143's UI_IN tables/.test(c.reason), `E143: the switch is not wired: ${c.status} ${c.reason}`);
    ok(throwsLike(() => pl.run_input({ type: 'switch', id: 'still_movie', value: 0 }), /Still \/ movie switch: not wired/) === true, 'E143: an input refused with the reason');
    ok(!('still_movie' in pl.session.status()) && !('still_movie' in pl.session.positions()), 'E143: neither the status nor the carried positions name it');
    pl.close_session();
    return { checks, bad };
  }
  let pl = open();
  const s = () => pl.session;
  const c = BY_ID.get('still_movie');
  ok(c.status === 'wired' && c.positions?.length === 3 && c.labels.join() === 'movie (level 3),movie (level 2),stills', `${MODEL}: the switch wired with three positions: ${c.status} ${JSON.stringify(c.positions)} ${c.labels}`);
  const doc = new PlayApi(pl, { tables: Tables.of(rom) }).get({ headers: {} }, '/api/controls', {});
  const row = JSON.parse(new TextDecoder().decode(doc.body)).find((r) => r.id === 'still_movie');
  ok(row?.status === 'wired' && row.uiin?.code === '0x1909' && row.labels?.length === 3, `/api/controls' row: ${JSON.stringify(row).slice(0, 300)}`);
  let st = s().status();
  ok(st.still_movie === 2 && st.still_movie_positions?.[2] === 'stills' && s().get(MOVIE) === 0, `the start: position ${st.still_movie}, setting 44 ${s().get(MOVIE)}`);
  const turn = (inp) => {
    const rec = pl.run_input(inp);
    s().camapp.pump(); s().idle_slice(s().lab.lab_time() + 1000e6);
    return rec;
  };
  for (const [k, want] of [[1, 1], [0, 1], [2, 0]]) {
    const rec = turn({ type: 'switch', id: 'still_movie', value: k });
    st = s().status();
    ok(s().get(MOVIE) === want && st.still_movie === k && rec?.position?.label === c.labels[k] && rec?.uiin?.some((x) => x.code === '0x02021909'),
      `position ${k} (${c.labels[k]}): setting 44 ${s().get(MOVIE)}, want ${want}; status ${st.still_movie}; record ${JSON.stringify(rec?.position)} ${JSON.stringify(rec?.uiin)}`);
  }
  turn({ type: 'switch', id: 'still_movie', step: -1 });
  ok(s().posswitch_at.get('still_movie') === 1 && s().get(MOVIE) === 1, `a step of -1 from 2: position ${s().posswitch_at.get('still_movie')}, 44 ${s().get(MOVIE)}`);
  turn({ type: 'key', id: 'still_movie', action: 'down' }); turn({ type: 'key', id: 'still_movie', action: 'up' });
  ok(s().posswitch_at.get('still_movie') === 2 && s().get(MOVIE) === 0 && s().cdial_index === 1, `a key press (1 -> 2), the creative dial left at 1: position ${s().posswitch_at.get('still_movie')}, 44 ${s().get(MOVIE)}, dial ${s().cdial_index}`);
  ok(throwsLike(() => pl.run_input({ type: 'switch', id: 'still_movie', value: 3 }), /Still \/ movie switch position 3: 0\.\.2/) === true, 'control: position 3 refused');
  pl.close_session();
  // the power lever off and on, on the kept state (S-NVRAM, as the camera): the switch stays at 1 while the camera is
  // off, so the next start is in movie mode. (On a blank store, the lab's default, the start leaves 44 at 0 with the
  // switch at 1: the application sets 44 when the switch moves, not at the start; X 2026-11-14)
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-smswitch-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const { fileNvram } = await import('../host/nvram.mjs');
  const kept = { nvram: fileNvram(path.join(tmp, 'nv.json')) };
  pl = open({}, kept);
  turn({ type: 'switch', id: 'still_movie', value: 1 });
  pl.power('off');
  const left = pl.off_positions;
  pl.control({ type: 'control', op: 'power', value: 1 });
  s().idle_slice(s().lab.lab_time() + 1500e6);
  st = s().status();
  ok(left?.still_movie === 1 && st.still_movie === 1 && s().get(MOVIE) === 1 && st.carried?.still_movie === 1,
    `moved to 1, power off and on: left ${JSON.stringify(left)}, position ${st.still_movie}, 44 ${s().get(MOVIE)}, carried ${JSON.stringify(st.carried)}`);
  // control: a restart is a fresh start, the switch at position 2 and nothing carried. (44 is not checked: the kept
  // store restores the 1 the off saved, and the start does not set it from the switch, X 2026-11-14; a restart moving
  // the switch back is the lab's, a camera's battery pull does not)
  pl.power('off');
  pl.control({ type: 'control', op: 'restart' });
  s().idle_slice(s().lab.lab_time() + 1500e6);
  ok(s().status().still_movie === 2 && !('carried' in s().status()), `control: a restart after the off: position ${s().status().still_movie}, carried ${JSON.stringify(s().status().carried)}`);
  pl.close_session();
  // a Player per power-on (bin/session.mjs's restart): the next one opened on the positions the off left, its log
  // recording them; --replay's reader takes a carried record that names the switch
  const files = new Map();
  const sink = (name, text) => files.set(name, (name.endsWith('.jsonl') ? files.get(name) ?? '' : '') + text);
  const p2 = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...env, ...kept, logSink: sink });
  p2.off_positions = left;
  p2.open_session();
  p2.session.idle_slice(p2.session.lab.lab_time() + 1500e6);
  const second = [p2.session.status().still_movie, p2.session.get(MOVIE)];
  p2.close_session();
  p2.write_log();
  const logged = JSON.parse(files.get('session.json') ?? '{}');
  ok(second.join() === '1,1' && logged.carried?.still_movie === 1, `the second Player: position ${second[0]}, 44 ${second[1]}; session.json carried ${JSON.stringify(logged.carried)}`);
  const rc = replayCarried('s.json', JSON.stringify({ carried: { mode_dial: 2, creative_dial: 1, still_movie: 1 } }), null);
  ok(rc?.still_movie === 1 && throwsLike(() => replayCarried('s.json', JSON.stringify({ carried: { mode_dial: 2, still_movie: '1' } }), null), /integers/) === true,
    `--replay's reader: ${JSON.stringify(rc)}; a malformed one refused`);
  // through bin/session.mjs: the switch token, the power lever off and the restart's carried positions
  const r = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--model', 'E147', '--nvram', path.join(tmp, 'nv2.json'), 'wait:1500', 'switch:still_movie=1', 'power:off', 'restart', 'wait:500'], { encoding: 'utf8', timeout: 600000 });
  const recs = (r.stdout ?? '').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const restart = recs.find((x) => x.token === 'restart') ?? {};
  ok(r.status === 0 && restart.carried?.still_movie === 1, `bin/session.mjs switch:still_movie=1, power:off, restart: rc ${r.status}, carried ${JSON.stringify(restart.carried)} ${(r.stderr ?? '').slice(-300)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(EMU, 'out'), { recursive: true });
  const r = await smswitchSession();
  const { MODEL } = await import('../src/fw/model.mjs');
  console.log(`still / movie switch (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
