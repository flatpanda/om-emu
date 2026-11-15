// The display switch and the frame at idle on the bodies whose touch driver's close waits for the touch task before its
// release and sleeps in its wake (E146, E147: src/fw/models.mjs chain_sleeps and their touch panel; src/lab/play.mjs
// H-CHAINREST; docs/hle-gaps.md 4.4.4), in play on the process's model:
//   dispswitchSession  E146, E147 (bin/test.mjs runs each in a child with OM_EMU_MODEL): through bin/session.mjs, a
//                      session started on the TFT whose open already ends on the shooting screen with a published
//                      frame (no key, no wait), one long play token WAIT:4000 that keeps it, then the eye sensor to
//                      the EVF, a shot there (S1, S2), the eye sensor back to the TFT, a shot there, and the LV button
//                      both ways: every step passes, each shot: has its device and panel size, the EVF's frame is not
//                      the TFT's, the card holds one picture per display, H-CHAINREST is listed and nothing is poked;
//                      the same from a start on the EVF (to the TFT, a shot, back, a shot). Controls, in this
//                      process: with the touch task not run (touch off, the bodies' state until 2026-11-14) the
//                      switch to the EVF fails its re-entry check, the application's event task waiting in the touch
//                      close; without H-CHAINREST (the mutant no-chain-rest) the open ends at the power-on state
//                      with no frame to compose, the switch to the EVF passes and the one back to the TFT fails its
//                      re-entry check. E143 (bin/test.mjs's process), which has neither difference: the switch both
//                      ways with a shot on each runs with no lab time of H-CHAINREST's and does not list it
//   node emu/test/test_dispswitch.mjs              (OM_EMU_MODEL=E147 or E146 for those bodies)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EMU = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOOTING = 'SS_COMMON/ID_ST_CA_REQ_DISP', POWER_ON = 'SS_COMMON/ID_ST_POWER_ON';

export async function dispswitchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const open = (more = {}) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...more }, env);
    pl.open_session();
    return pl;
  };
  // lab time as the scripted session runs it: 50 ms slices (host/session.mjs WAIT_SLICE_MS)
  const idle = (pl, ms) => { const s = pl.session, lab = s.lab; for (let t = lab.lab_time() + ms * 1e6; lab.lab_time() < t;) s.idle_slice(Math.min(t, lab.lab_time() + 50e6)); };
  const thrown = (f) => { try { f(); return null; } catch (e) { return e.message.split('\n')[0]; } };
  const press = (pl, k) => { const s = pl.session; s.key(k, 'down'); s.camapp.pump(); idle(pl, 150); s.key(k, 'up'); s.camapp.pump(); idle(pl, 600); };
  const frameOf = (pl) => { try { const [w, h] = pl.session.frame('boundary', true); return `${w}x${h}`; } catch (e) { return `error: ${e.message.split('\n')[0]}`; } };
  const size = (d) => MODEL_INFO.panels[d].join('x');

  if (!MODEL_INFO.chain_sleeps) {
    // a body with neither difference (E143): the switch both ways and a shot on each, no lab time of H-CHAINREST's
    const pl = open(), s = pl.session;
    idle(pl, 1500);
    const toEvf = s.display_input('eye', 1), evf = frameOf(pl);
    press(pl, 's1'); press(pl, 's2'); idle(pl, 1500);
    const toTft = s.display_input('eye', 0), tft = frameOf(pl);
    press(pl, 's1'); press(pl, 's2'); idle(pl, 1500);
    ok(toEvf.device === 'evf' && evf === size('evf') && toTft.device === 'tft' && tft === size('tft'), `${MODEL}: the switch both ways: ${toEvf.device} ${evf}, ${toTft.device} ${tft}`);
    ok(s.camapp.status().card_images === 2, `${MODEL}: a picture on each display: ${s.camapp.status().card_images} image(s)`);
    ok(s.chain_rests === 0 && !toEvf.switch.chain_rest && !toTft.switch.chain_rest && !pl.stand_ins_in_use().includes('H-CHAINREST'),
      `${MODEL}: no lab time of H-CHAINREST's: ${s.chain_rests} step(s), listed ${pl.stand_ins_in_use().includes('H-CHAINREST')}`);
    pl.close_session();
    return { checks, bad };
  }

  // ---- through bin/session.mjs --------------------------------------------------------------------------------
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-dispswitch-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const run = (name, args, tokens) => {
    const r = spawnSync(process.execPath, [path.join(EMU, 'bin/session.mjs'), '--model', MODEL, '--out', path.join(tmp, name), ...args, ...tokens], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 });
    const recs = (r.stdout ?? '').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    return { rc: r.status, recs, sum: recs.find((x) => x.summary) ?? {}, err: (r.stderr ?? '').trim().split('\n').slice(-1)[0] ?? '', of: (t) => recs.find((x) => x.token === t) ?? {} };
  };
  const shotIs = (rec, d) => rec.ok === true && rec.device === d && rec.size?.join('x') === size(d);
  // started on the TFT: the open's frame, one long WAIT, the eye sensor both ways with a shot on each, LV both ways
  const a = run('tft', [], ['WAIT:4000', `expect:gui=${SHOOTING}`, 'shot:t0.png', 'switch:eye=1', 'shot:e1.png', 's1', 's2', 'wait:1500',
    'switch:eye=0', 'shot:t1.png', 's1', 's2', 'wait:1500', 'lv', 'shot:e2.png', 'lv', 'shot:t2.png', 'card-ls']);
  ok(a.rc === 0 && a.sum.ok === true && a.sum.pokes?.length === 0, `${MODEL} from the TFT: rc ${a.rc}, ${a.err.slice(0, 400)}`);
  const first = a.of('open'), long = a.of('WAIT:4000');
  ok(first.gui === SHOOTING && typeof first.frame === 'string', `${MODEL}: the open ends on the shooting screen with a published TFT frame: gui ${first.gui}, frame ${first.frame}`);
  ok(long.ok === true && long.gui === SHOOTING && typeof long.frame === 'string' && !long.frame_error, `${MODEL}: one long WAIT:4000 keeps the TFT's frame: gui ${long.gui}, frame ${long.frame}, ${long.frame_error ?? 'no frame error'}`);
  ok(shotIs(a.of('shot:t0.png'), 'tft') && shotIs(a.of('shot:e1.png'), 'evf') && shotIs(a.of('shot:t1.png'), 'tft') && shotIs(a.of('shot:e2.png'), 'evf') && shotIs(a.of('shot:t2.png'), 'tft'),
    `${MODEL}: each shot: has its device and size: ${['t0', 'e1', 't1', 'e2', 't2'].map((n) => { const x = a.of(`shot:${n}.png`); return `${n} ${x.device} ${x.size?.join('x')}`; }).join(', ')}`);
  ok(a.of('shot:e1.png').frame !== a.of('shot:t0.png').frame && a.of('switch:eye=1').gui === SHOOTING && a.of('switch:eye=0').gui === SHOOTING,
    `${MODEL}: the EVF's frame is not the TFT's, both on the shooting screen: ${a.of('shot:t0.png').frame} ${a.of('shot:e1.png').frame} ${a.of('switch:eye=1').gui} ${a.of('switch:eye=0').gui}`);
  const pictures = (r) => (r.of('card-ls').card ?? []).filter((f) => /\.JPG$/.test(f.path)).length;
  ok(pictures(a) === 2, `${MODEL}: a picture on each display: ${JSON.stringify(a.of('card-ls').card)}`);
  ok(a.sum.stand_ins?.includes('H-CHAINREST') && a.sum.stand_ins?.includes('H-CONNECT'), `${MODEL}: H-CHAINREST and H-CONNECT listed: ${a.sum.stand_ins?.filter((x) => /CHAIN|CONNECT|SWITCH/.test(x))}`);
  // started on the EVF: to the TFT, a shot, back, a shot
  const b = run('evf', ['--device', 'evf'], ['wait:1500', 'switch:eye=0', 'shot:t1.png', 's1', 's2', 'wait:1500', 'switch:eye=1', 'shot:e1.png', 's1', 's2', 'wait:1500', 'card-ls']);
  ok(b.rc === 0 && b.sum.ok === true && shotIs(b.of('shot:t1.png'), 'tft') && shotIs(b.of('shot:e1.png'), 'evf') && pictures(b) === 2,
    `${MODEL} from the EVF: rc ${b.rc}, t1 ${b.of('shot:t1.png').device} ${b.of('shot:t1.png').size?.join('x')}, e1 ${b.of('shot:e1.png').device}, ${pictures(b)} picture(s), ${b.err.slice(0, 400)}`);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- controls -------------------------------------------------------------------------------------------------
  // the touch task not run (the bodies' state until 2026-11-14): the application's output change closes the panel, and
  // the close waits for the touch task
  {
    const pl = open({ touch: 'off' });
    idle(pl, 1500);
    const e = thrown(() => pl.session.display_input('eye', 1));
    ok(e !== null && /re-entry landed on GUI state/.test(e) && /touch task does not run/.test(e), `${MODEL} control, touch off: the switch to the EVF fails its re-entry check: ${e}`);
    try { pl.close_session(); } catch { /* the session ended on the control's error */ }
  }
  // H-CHAINREST not run: the start ends before the GUI's first screen, the switch to the TFT before the re-entry
  {
    const pl = open({ x_mutant: 'no-chain-rest' }), s = pl.session;
    const at = s.lab.state_names.get(s.lab.state()), f0 = frameOf(pl);
    ok(at === POWER_ON && /composite NONE/.test(f0), `${MODEL} control, no chain rest: the open ends at ${at} with ${f0.slice(0, 120)}`);
    idle(pl, 1500);
    const up = thrown(() => s.display_input('eye', 1));
    idle(pl, 600);
    const down = thrown(() => s.display_input('eye', 0));
    ok(up === null && down !== null && /re-entry landed on GUI state/.test(down), `${MODEL} control, no chain rest: to the EVF ${up ?? 'passes'}, back to the TFT: ${down}`);
    try { pl.close_session(); } catch { /* the session ended on the control's error */ }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(EMU, 'out'), { recursive: true });
  const r = await dispswitchSession();
  const { MODEL } = await import('../src/fw/model.mjs');
  console.log(`display switch and idle frame (${MODEL}): ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
