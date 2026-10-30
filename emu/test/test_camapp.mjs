// S-CAMAPP, the camera application running natively in the player (src/lab/camapp.mjs, the control op camapp):
//   camappSession  bin/play.mjs with --a15 on: every session runs the application, which takes the GUI
//                  to its screen (the date prompt); the status lists S-CAMAPP, S-MODACK, S-TRAACK and S-RELSEQ and not
//                  S-CAMSEQ or S-KEYMAP, the HLS components are not started, a request input is refused; S1 down changes the
//                  frame (the prompt goes, the shooting information comes) and 600 ms later the green AF frame and focus
//                  indicator CPU 3's DISP_FRAME draws are on it, S2 down changes it again (the rec view),
//                  and 600 ms later END_RECVIEW brings the information back; with a moving scene the rec view holds
//                  the captured frame (S-RECVIEW) and the live view moves on after it; PLAY shows the newer of the
//                  two pictures taken (S-CARD, S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW), right and left move between them
//                  and wrap around, PLAY returns;
//                  REC with LLPSW pressed starts nothing; LLPSW released (from the start with the native lens: S-LENSMCU
//                  in place of S-LENS) and the mode dial at 7, REC starts a recording
//                  (the screen changes, and settles: the 'ISO Auto' and 'L0' items go) and REC again ends it, its time off S-CARD's movie time left;
//                  --replay of the session log ends on the same frame;
//                  control camapp 2 starts the HLS components as well (S-BOOTDONE, S-CPU3); OK opens the Super Control
//                  Panel, MENU opens and closes the menu (S-SETSAVE), PLAY shows playback and returns, the menu stops the
//                  through image (S-THROUGH), LV switches to the EVF and back with the application re-entering (S-OUTDISP)
//   heapSession    S-HEAP's live blocks over a long idle on the shooting screen, with the native lens and with S-LENS:
//                  from HEAP_FROM_S to HEAP_TO_S of lab time no block allocated stays allocated, and S-TRAACK has
//                  deleted its requests (the histogram's events, about 5 a second); before S-TRAACK deleted them the
//                  live blocks grew by about 5 a second (docs/hle-gaps.md 4.4.2)
//   modeDialSession  the mode dial in play (E143): it starts at P, the start's mode; each position's change sets its
//                  mode (MODE_EXPOSE, the custom banks' MODE_RAW, B's MODE_DIAL_B_ONOFF) and keeps the other settings,
//                  each position shows a screen of its own, and away from P OK opens the Super Control Panel and MENU
//                  the menu; with the mode store's object words cleared (no H-STOREINIT) a change zeroes the settings
//   node emu/test/test_camapp.mjs
import fs from 'node:fs';
import path from 'node:path';

const J = path.resolve(new URL('..', import.meta.url).pathname);

export async function camappSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const out = path.join(J, 'out/test-camapp');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  process.env.OM_CHECK_OUT = out;
  const { withPlay } = await import('../checks/lib/playhttp.mjs');
  const { read_png } = await import('../checks/lib/png.mjs');
  const sha = (b) => Buffer.from(b).toString('base64').length + ':' + Buffer.from(b).subarray(-64).toString('hex');
  let last = null, dir = null;
  try {
    await withPlay('camapp', ['--idle', 'off', '--a15', 'on', '--debug-api'], async (pl) => {
      dir = pl.out;
      let s = await pl.status();
      ok(s.camapp?.started === true, `the application runs from the start: ${JSON.stringify(s.camapp ?? null)}`);
      // the lens: S-LENS's values, or the native lens on the mount (src/lab/lens.mjs, S-LENSMCU) on a body that has it
      const native_lens = s.stand_ins.includes('S-LENSMCU');
      ok(['S-CAMAPP', 'S-MODACK', 'S-TRAACK', 'S-RELSEQ', 'S-CARD', native_lens ? 'S-LENSMCU' : 'S-LENS', 'S-LONGTIMER', 'S-DISPFRAME', 'S-TAKEFRAME', 'S-AFOSD', 'S-CPU3', 'S-RECVIEW'].every((x) => s.stand_ins.includes(x)) && !s.stand_ins.includes('S-CAMSEQ') && !s.stand_ins.includes('S-KEYMAP'),
        `the stand-ins: ${s.stand_ins}`);
      ok(s.gui === '0x0108', `the application takes the GUI to its screen: ${s.gui} ${s.gui_name}`);
      ok(s.camapp?.components === false && !s.stand_ins.includes('S-BOOTDONE'), `the HLS components are not started (${s.camapp?.components})`);
      const rq = await pl.input({ type: 'request', id: 'shoot' }, true);
      ok(/the camera application sends the GUI its own requests/.test(rq.error ?? ''), `a request input is refused: ${rq.error}`);
      await pl.input({ type: 'scene', change: { liveview: true } });
      await pl.input({ type: 'token', token: 'WAIT:100' });
      const [f0] = await pl.frame();
      await pl.key('s1', 'down');
      const [f1] = await pl.frame();
      ok(sha(f1) !== sha(f0), 'S1: the date prompt goes, the shooting information comes');
      await pl.input({ type: 'token', token: 'WAIT:600' });
      const [f1b] = await pl.frame();
      const green = (png) => { const f = path.join(out, 'f.png'); fs.writeFileSync(f, png); const [, , rows] = read_png(f); let n = 0;
        for (const row of rows) for (let i = 0; i + 2 < row.length; i += 3) if (row[i] < 40 && row[i + 1] > 200 && row[i + 2] < 40) n++; return n; };
      ok(green(f1b) > 200 && green(f0) === 0, `S1: CPU 3's DISP_FRAME draws the green AF frame and focus indicator (S-DISPFRAME, S-AFOSD): ${green(f1b)} green pixels`);
      await pl.key('s2', 'down');
      s = await pl.status();
      const [f2] = await pl.frame();
      ok(sha(f2) !== sha(f1) && s.camapp?.recview_pending === true, `S2: the rec view (pending end ${s.camapp?.recview_pending})`);
      await pl.input({ type: 'token', token: 'WAIT:600' });
      s = await pl.status();
      const [f3] = await pl.frame();
      ok(sha(f3) !== sha(f2) && s.camapp?.recview_pending === false, `END_RECVIEW after 500 ms: the information is back (pending ${s.camapp?.recview_pending})`);
      await pl.key('s2', 'up');
      await pl.key('s1', 'up');
      ok((await pl.status()).phase === 'running', 'the session runs on after the release');
      // S-RECVIEW: with a moving scene, the rec view holds the captured frame, then the live view moves on
      await pl.input({ type: 'scene', change: { preset: 'moving' } });
      await pl.key('s2', 'down');
      await pl.input({ type: 'token', token: 'WAIT:100' });
      const [r1] = await pl.frame();
      await pl.input({ type: 'token', token: 'WAIT:250' });
      const [r2] = await pl.frame();
      await pl.input({ type: 'token', token: 'WAIT:500' });
      const [r3] = await pl.frame();
      await pl.key('s2', 'up');
      ok(sha(r1) === sha(r2) && sha(r3) !== sha(r2), 'S2: the rec view holds the captured frame, then the live view moves on (S-RECVIEW)');
      await pl.input({ type: 'scene', change: { preset: 'static' } });
      // S-CARD, S-PLAYSEQ, S-PLAYCOMP, S-PLAYVIEW: the two pictures taken play back, the newest first, and wrap around
      s = await pl.status();
      ok(s.camapp?.card_images === 2 && ['S-PLAYSEQ', 'S-PLAYCOMP', 'S-PLAYVIEW'].every((x) => s.stand_ins.includes(x)), `S-CARD keeps the two pictures: ${s.camapp?.card_images}`);
      const view = async (k) => { await pl.key(k, 'down'); await pl.key(k, 'up'); await pl.input({ type: 'token', token: 'WAIT:500' }); const [f] = await pl.frame(); return [await pl.status(), f]; };
      const [p0, pf0] = await view('play');
      ok(p0.gui === '0x0508' && sha(pf0) !== sha(r3), `PLAY shows the newest picture (ID_ST_DISP_SIMPLE): ${p0.gui} ${p0.gui_name}`);
      const [p1, pf1] = await view('right');
      ok(p1.gui === '0x0508' && sha(pf1) !== sha(pf0), `right shows the other picture: ${p1.gui}`);
      const [p2, pf2] = await view('right');
      ok(p2.gui === '0x0508' && sha(pf2) === sha(pf0), `right again wraps around to the newest: ${p2.gui}`);
      const [, pf3] = await view('left');
      ok(sha(pf3) === sha(pf1), 'left goes back');
      const [p4] = await view('play');
      ok(p4.gui === '0x0108', `PLAY returns to shooting: ${p4.gui}`);
      // REC: refused while LLPSW reads pressed (the idle image), RECORDING_MOVIE at mode-dial position 7 once released;
      // with the native lens LLPSW reads released from the start (the lens is locked on the mount, src/lab/lens.mjs
      // lock), so the switch stays and REC is refused at the mode dial's position only
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      ok((await pl.status()).camapp?.recording_s === null, 'REC with LLPSW pressed (or the mode dial off 7) starts no recording');
      if (!native_lens) await pl.key('fw_121c', 'down');
      // since the mode change runs (H-STOREINIT) the application takes REC from between 300 and 600 ms of lab time after
      // the change to Movie, not 100 ms (X; what it waits for is not traced): 1 s
      await pl.input({ type: 'switch', id: 'mode_dial', value: 7 });
      await pl.input({ type: 'token', token: 'WAIT:1000' });
      const [f4] = await pl.frame();
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      await pl.input({ type: 'token', token: 'WAIT:1500' });
      s = await pl.status();
      const [f5] = await pl.frame();
      ok(s.camapp?.recording_s >= 1.5 && sha(f5) !== sha(f4), `REC starts a recording, the screen changes: ${s.camapp?.recording_s} s`);
      await pl.input({ type: 'token', token: 'WAIT:1000' });
      const [f5b] = await pl.frame();
      // the recording screen drops the 'ISO Auto' and 'L0' items: with S-LENS between 1.5 and 2.5 s after
      // REC, with the native lens before 1.5 s (I: the frames). The REC mark's time stays 00:00 in the lab either way
      // (X: master 93016b8's frames), so the change checked here is not the time.
      ok(sha(f5b) !== sha(f4) && (native_lens || sha(f5b) !== sha(f5)), 'the recording screen settles (the ISO Auto and L0 items go)');
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      await pl.input({ type: 'token', token: 'WAIT:100' });
      s = await pl.status();
      const [f6] = await pl.frame();
      ok(s.camapp?.recording_s === null && sha(f6) !== sha(f5), `REC again ends it: ${s.camapp?.recording_s}`);
      ok(s.camapp?.card_used_s >= 1.5, `S-CARD: the recording comes off the movie time left (${s.camapp?.card_used_s} s used)`);
      [last] = await pl.frame();
    });
    const log = path.join(dir, 'session.json');
    await withPlay('camapp-replay', ['--a15', 'on', '--debug-api', '--replay', log], async (pl) => {
      await pl.wait_phase((st) => st.phase === 'stopped' || st.phase === 'running', 120);
      const [f] = await pl.frame();
      ok(sha(f) === sha(last), 'the replay ends on the same frame');
    });
    await withPlay('camapp-keys', ['--idle', 'off', '--a15', 'on', '--debug-api'], async (pl) => {
      const step = async (k) => { await pl.key(k); await pl.input({ type: 'token', token: 'WAIT:400' }); return pl.status(); };
      let s = await step('ok');
      ok(s.phase === 'running' && s.gui === '0x0403', `OK opens the Super Control Panel (S-CPU2 leaves CPU 3's doorbell to S-CPU3): ${s.phase} ${s.gui}`);
      s = await step('menu');
      ok(s.phase === 'running' && s.gui === '0x0b02', `MENU opens the menu: ${s.phase} ${s.gui}`);
      s = await step('menu');
      ok(s.phase === 'running' && s.gui === '0x0108', `MENU closes it, the settings save skipped (S-SETSAVE): ${s.phase} ${s.gui}`);
      const [f0] = await pl.frame();
      s = await step('play');
      const [f1] = await pl.frame();
      ok(s.phase === 'running' && s.gui === '0x0505' && sha(f1) !== sha(f0), `PLAY shows playback's No Picture (HILIGHT1 written 0 composites): ${s.phase} ${s.gui}`);
      s = await step('play');
      const [f2] = await pl.frame();
      ok(s.phase === 'running' && s.gui === '0x0108' && sha(f2) !== sha(f1), `PLAY again returns to shooting: ${s.phase} ${s.gui}`);
      await pl.input({ type: 'scene', change: { liveview: true } });
      s = await step('menu');
      const [m0] = await pl.frame();
      const black = (png) => { const f = path.join(out, 'm.png'); fs.writeFileSync(f, png); const [, , rows] = read_png(f); const row = rows[20]; let n = 0;
        for (let i = 0; i + 2 < row.length; i += 3) if (row[i] < 16 && row[i + 1] < 16 && row[i + 2] < 16) n++; return n; };
      ok(s.gui === '0x0b02' && black(m0) > 600, `the menu stops the through image: black behind it (S-THROUGH), ${black(m0)} black pixels in row 20`);
      s = await step('lv');
      ok(s.phase === 'running' && s.device === 'evf' && s.gui === '0x0b02', `LV in the menu: the EVF, the application re-enters the menu itself (S-OUTDISP): ${s.phase} ${s.device} ${s.gui}`);
      s = await step('menu');
      ok(s.phase === 'running' && s.gui === '0x0108', `MENU closes it on the EVF: ${s.phase} ${s.gui}`);
      s = await step('lv');
      ok(s.phase === 'running' && s.device === 'tft' && s.gui === '0x0108', `LV back to the TFT on the shooting screen: ${s.phase} ${s.device} ${s.gui}`);
    });
    await withPlay('camapp-components', ['--idle', 'off', '--a15', 'on', '--debug-api'], async (pl) => {
      await pl.input({ type: 'control', op: 'camapp', value: 2 });
      const s = await pl.status();
      ok(s.camapp_components === true && s.camapp?.components === true && ['S-BOOTDONE', 'S-CPU3'].every((x) => s.stand_ins.includes(x)),
        `camapp 2: the shoot mode, the still-shooting category and its components run on the OXF main thread (${s.camapp?.components}, ${s.stand_ins})`);
    });
  } catch (e) { bad.push(`session: ${e.message.slice(0, 600)}`); }
  fs.rmSync(out, { recursive: true, force: true });
  return { checks, bad };
}

// the idle's window (lab seconds from the session's start): past the start's one-off allocations (S-LENS's session
// keeps five blocks it allocates in its first 10 s, X: none of them later)
const HEAP_FROM_S = 10, HEAP_TO_S = 25;
export async function heapSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 };
  for (const lens of [null, 'stand-in']) {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...env, ...(lens && { lens }) });
    pl.open_session();
    const s = pl.session, lab = s.lab, name = lens ?? 'the native lens';
    const idle = (to) => { while (lab.lab_time() < to * 1e9) { s.idle_slice(Math.min(to * 1e9, lab.lab_time() + 50e6)); s.frame(); } };
    idle(HEAP_FROM_S);
    const live = new Set(lab.heap_sizes.keys()), d0 = s.camapp.tra_deleted;
    idle(HEAP_TO_S);
    const kept = [...lab.heap_sizes.keys()].filter((a) => !live.has(a)), deleted = s.camapp.tra_deleted - d0;
    ok(kept.length === 0 && deleted >= 4 * (HEAP_TO_S - HEAP_FROM_S),
      `${name}: from ${HEAP_FROM_S} s to ${HEAP_TO_S} s of idle ${kept.length} blocks allocated stay allocated (${kept.slice(0, 8).map((a) => `${lab.heap_sizes.get(a)} bytes`).join(', ')}), S-TRAACK deleted ${deleted} requests; live ${live.size} -> ${lab.heap_sizes.size}`);
    pl.close_session();
  }
  return { checks, bad };
}

// The mode dial's positions as the application takes them (E143; docs/om1-input-spec.md section 2): the setting each
// position's mode change sets on the blank store, by the position's name (X, 2026-10-30): MODE_EXPOSE (24) P 3, A 4,
// S 5, M 6, Movie 76, and 3 (P) in the custom banks C1..C4, which also set MODE_RAW (22); B sets MODE_DIAL_B_ONOFF
// (1444). Without H-STOREINIT the first change away from P set 612 settings to 0, MODE_HQ_Q (12) and MODE_HDMI_INFO
// (820) among them, and every screen after it was the same, with no mode letter
const DIAL_EXPOSE = { P: 3, A: 4, S: 5, M: 6, MOVIE: 76, MY_MODE1: 3, MY_MODE2: 3, MY_MODE3: 3, MY_MODE4: 3 };
const MODE_EXPOSE = 24, MODE_RAW = 22, MODE_DIAL_B = 1444, KEPT = [[12, 1], [820, 1]];
export async function modeDialSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { createHash } = await import('node:crypto');
  const { loadImage, loadBlock, createHash: envHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { propStoreInit } = await import('../src/lab/menu.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash: envHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab;
  try {
    const idle = (ms) => s.idle_slice(lab.lab_time() + ms * 1e6);
    const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(500); };
    const shot = () => createHash('sha256').update(Uint32Array.from(s.frame()[2])).digest('hex');
    const names = s.status().mode_dial_positions.map((p) => p.name), n = names.length, p0 = s.mode_index;
    ok(names[p0] === 'P' && lab.get(MODE_EXPOSE) === DIAL_EXPOSE.P, `the dial starts at P, where the start's mode is: position ${p0} (${names[p0]}), MODE_EXPOSE ${lab.get(MODE_EXPOSE)}`);
    idle(1000);
    key('s1');
    const frames = new Map();
    // every position once, round from P and back to it
    for (let i = 1; i <= n; i++) {
      const k = (p0 + i) % n, name = names[k];
      s.switch_input('mode_dial', k); s.camapp.pump(); idle(2000);
      const got = { expose: lab.get(MODE_EXPOSE), raw: lab.get(MODE_RAW), b: lab.get(MODE_DIAL_B), gui: s.status().gui };
      const want = { expose: DIAL_EXPOSE[name] ?? got.expose, raw: name.startsWith('MY_MODE') ? 1 : 0, b: name === 'B' ? 1 : 0, gui: '0x0108' };
      ok(JSON.stringify(got) === JSON.stringify(want), `position ${k} (${name}): ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      const kept = KEPT.map(([id]) => lab.get(id));
      ok(JSON.stringify(kept) === JSON.stringify(KEPT.map(([, v]) => v)), `position ${k} (${name}): settings ${KEPT.map(([id]) => id).join(', ')} read ${kept}, want ${KEPT.map(([, v]) => v)}`);
      frames.set(k, shot());
    }
    ok(new Set(frames.values()).size === n, `each position shows a screen of its own: ${new Set(frames.values()).size} distinct of ${n}`);
    // OK and MENU away from P (OK did nothing there before)
    const S = names.indexOf('S');
    s.switch_input('mode_dial', S); s.camapp.pump(); idle(2000);
    key('ok');
    ok(s.status().gui === '0x0403', `at S, OK opens the Super Control Panel: ${s.status().gui}`);
    key('ok'); key('menu');
    ok(s.status().gui === '0x0b02', `at S, MENU opens the menu: ${s.status().gui}`);
    key('menu');
    // negative control: the mode store's object words cleared, as before H-STOREINIT: the next change zeroes the kept settings
    const { objects } = propStoreInit();
    lab.sim.write(objects, new Uint8Array(12));
    s.switch_input('mode_dial', names.indexOf('A')); s.camapp.pump(); idle(2000);
    const lost = KEPT.map(([id]) => lab.get(id));
    ok(lost.every((v) => v === 0), `control: with the object words cleared a change reads settings ${KEPT.map(([id]) => id).join(', ')} as ${lost}, want 0`);
  } catch (e) { bad.push(`session: ${e.message.slice(0, 600)}`); }
  pl.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await camappSession(), h = await heapSession(), m = await modeDialSession();
  console.log(`camapp session: ${r.checks - r.bad.length}/${r.checks}; the heap over an idle: ${h.checks - h.bad.length}/${h.checks}; the mode dial: ${m.checks - m.bad.length}/${m.checks}`);
  [...r.bad, ...h.bad, ...m.bad].forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || h.bad.length || m.bad.length ? 1 : 0);
}
