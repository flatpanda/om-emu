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
//                  REC with LLPSW pressed starts nothing; LLPSW released and the mode dial at 7, REC starts a recording
//                  (the screen changes, and a second later again: the REC mark's time) and REC again ends it, its time off S-CARD's movie time left;
//                  --replay of the session log ends on the same frame;
//                  control camapp 2 starts the HLS components as well (S-BOOTDONE, S-CPU3); OK opens the Super Control
//                  Panel, MENU opens and closes the menu (S-SETSAVE), PLAY shows playback and returns, the menu stops the
//                  through image (S-THROUGH), LV switches to the EVF and back with the application re-entering (S-OUTDISP)
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
      ok(['S-CAMAPP', 'S-MODACK', 'S-TRAACK', 'S-RELSEQ', 'S-CARD', 'S-LENS', 'S-LONGTIMER', 'S-DISPFRAME', 'S-TAKEFRAME', 'S-AFOSD', 'S-CPU3', 'S-RECVIEW'].every((x) => s.stand_ins.includes(x)) && !s.stand_ins.includes('S-CAMSEQ') && !s.stand_ins.includes('S-KEYMAP'),
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
      // REC: refused while LLPSW reads pressed (the idle image), RECORDING_MOVIE at mode-dial position 7 once released
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      ok((await pl.status()).camapp?.recording_s === null, 'REC with LLPSW pressed starts no recording');
      await pl.key('fw_121c', 'down');
      await pl.input({ type: 'switch', id: 'mode_dial', value: 7 });
      await pl.input({ type: 'token', token: 'WAIT:100' });
      const [f4] = await pl.frame();
      await pl.key('rec', 'down'); await pl.key('rec', 'up');
      await pl.input({ type: 'token', token: 'WAIT:1500' });
      s = await pl.status();
      const [f5] = await pl.frame();
      ok(s.camapp?.recording_s >= 1.5 && sha(f5) !== sha(f4), `REC starts a recording, the screen changes: ${s.camapp?.recording_s} s`);
      await pl.input({ type: 'token', token: 'WAIT:1000' });
      const [f5b] = await pl.frame();
      ok(sha(f5b) !== sha(f5), 'the recording screen counts on (the REC mark\'s time)');
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await camappSession();
  console.log(`camapp session: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
