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
//   heapWorkloadSession  S-HEAP's live blocks over passes of S1, S2, the menu and playback, without and with the HLS
//                  components: after two passes they grow by the decoded kinds alone (the events the OXF main thread
//                  frees with the components, S-RPC's requests), and with S-DISPQ's replies recorded only (the control)
//                  the display manager's 192-byte buffers stay (docs/hle-gaps.md 4.4.2)
//   traRoutingSession  control camapp 3 (E143): the HLS components with their transaction path native (S-TRAACK
//                  and S-RPC out of it): the application's own TRA 415 and the mode change's 420 bring the camera base
//                  to its state 13 and the still category to its state 11 (no S-BOOTDONE), the start's transactions
//                  are each answered by the exec natively (992 with 0xf0000058, the others 0), the idle's 944 and
//                  S2's 1030 too; over passes of S1 and S2 the OXF main thread's events (event 294, 0x60dcb42c) do not
//                  stay; the VSC histogram on the TFT channel runs about every 50 ms (A-VSCHIST-1), its end taken
//                  natively (the ISR, task 16's done callback, DISPLAY cmd 16 through S-DISPQ, which reads the bins
//                  under A-VSCHIST-2 and starts the next run); the menu's DISPLAY cmd 15 waits for a run's end, which
//                  the lab clock reaches within two frames (S-HISTEND), and its wait returns E_OK; the imgpro
//                  library's request id comes from udf07 0x5050a089 (docs/om1-udf-spec.md row 14), the imgpro unit
//                  0x9c600000 (S-IMGPRO, H-IMGPROINIT) fills the through image's bank (kind 14's rectangle fill, its
//                  end taken natively through IRQ 300) and the image player's stage 9 is readied (S-STAGE9): the menu
//                  opens and closes, the through image running again after it; PLAY shows playback's No Picture with
//                  the card's pictures (the play module's header getter finds the picture not loaded), right (which
//                  fills the other bank) and left are taken, PLAY returns; then a pass of S1 and S2 records its
//                  picture and MENU is not taken (no GUI event, the sequence waiting in phase 102 for a take-ready
//                  nothing finishes, as TAKE_EXEC is S-MODACK's and no 794 is built: the furthest point,
//                  docs/hle-gaps.md 4.3.2, 4.1.10); control: S-MODACK's requests left
//                  in PLAY_EXEC's queue, right's blocks the OXF main thread there; with --hdmi on the plug's TRA 588
//                  is the component's (no S-OUTDEV), the HDMI device opens and channel 0 composes its window with no
//                  plane drawn, and the plug's cmd 15 waits as the menu's does; in both, the native lens's LENS_EXEC
//                  and LENS_COMMAND, whose tasks wait on them, are left out of S-MODACK (which takes what it answers)
//   camapp3FramesSession  control camapp 3's frames (E143): the TFT composes with the histogram's registers under
//                  A-VSCHIST-3 at the shooting screen, the menu (the through image's bank as IMG2, the background's
//                  colour) and its close, PLAY and its return; with --cpu2 native the histogram's bin 5 column is the
//                  one change (docs/hle-gaps.md 4.2.4)
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
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
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

// A workload's passes (E143; docs/hle-gaps.md 4.4.2): S1 and S2 (a shot and its rec view), the menu opened and
// closed, playback shown and left, then 2 s of idle. After two passes (the one-off allocations, and the event task's
// parked replies, which it ages out after 10 later replies, 0x50abc2e7..f4, X: 10 from the second pass on) the live
// blocks grow by the decoded kinds alone, by size and vtable word, the same number every pass:
//   event 294 (28 bytes, vtable 0x60ef3504, built at 0x50d7e10b) and the 32-byte event of vtable 0x60dcb42c, sent to
//     reactives whose OXF main thread (task 57, entry 0x50ab2293) is dormant without the HLS components: with them
//     (camapp 2) it frees them and they are gone
//   the 72-byte request object (vtable 0x60de54e8, 0x50ac722a) S-RPC answers at its method's entry 0x50ac734c,
//     whose freeing after a reply no code of its class shows (D)
// (S-HEAP rounds to 16 bytes) and nothing else: before S-DISPQ's replies went to the application's queue, its display manager's 192-byte
// request buffers (0x503eb91b) stayed as well, 6 a pass (the control below)
const HEAP_KINDS = [['event 294', 32, 0x60EF3504], ['event 0x60dcb42c', 32, 0x60DCB42C], ['S-RPC request', 80, 0x60DE54E8]];
const HEAP_PASS_KEPT = { default: { 'event 294': 21, 'event 0x60dcb42c': 1, 'S-RPC request': 5 }, components: { 'S-RPC request': 5 } };
const DISPQ_BUFFER = 0x503EB922, DISPQ_BUFFERS_A_PASS = 6;
export async function heapWorkloadSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  for (const mode of ['default', 'components']) {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
    pl.camapp_components = mode === 'components';
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) { s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); s.frame(); } };
      const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); };
      // the live blocks by kind: a decoded kind by size and vtable word, any other by size and malloc caller
      const buckets = () => {
        const out = new Map();
        for (const [a, size] of lab.heap_sizes) {
          const vt = lab.sim.u32(a) >>> 0, k = HEAP_KINDS.find(([, n, v]) => n === size && v === vt);
          const name = k ? k[0] : `${size} bytes from 0x${lab.heap_owner.get(a)[0].toString(16)}`;
          out.set(name, (out.get(name) ?? 0) + 1);
        }
        return out;
      };
      const pass = () => {
        const b0 = buckets();
        s.key('s1', 'down'); s.camapp.pump(); idle(600);
        s.key('s2', 'down'); s.camapp.pump(); idle(700);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(500);
        key('menu'); key('menu'); key('play'); key('play');
        idle(2000);
        const b1 = buckets(), grew = {};
        for (const k of new Set([...b0.keys(), ...b1.keys()])) { const d = (b1.get(k) ?? 0) - (b0.get(k) ?? 0); if (d) grew[k] = d; }
        return { grew, gui: s.status().gui };
      };
      idle(10000);
      pass(); pass();                  // the one-offs, and the event task's parked replies up to their 10
      for (let i = 2; i <= 3; i++) {
        const p = pass(), want = HEAP_PASS_KEPT[mode], canon = (o) => JSON.stringify(Object.entries(o).sort());
        ok(p.gui === '0x0108' && canon(p.grew) === canon(want),
          `${mode}, pass ${i}: the live blocks grew by ${JSON.stringify(p.grew)}, want ${JSON.stringify(want)}; GUI ${p.gui}`);
      }
      // control: S-DISPQ's replies recorded only, as before: the display manager's request buffers stay
      if (mode === 'default') {
        lab.dispq_deliver = null;
        const p = pass(), n = p.grew[`192 bytes from 0x${DISPQ_BUFFER.toString(16)}`];
        ok(n === DISPQ_BUFFERS_A_PASS, `control: with S-DISPQ's replies not delivered a pass keeps ${n} (${JSON.stringify(p.grew)}) of the display manager's 192-byte buffers, want ${DISPQ_BUFFERS_A_PASS}`);
      }
    } catch (e) { bad.push(`${mode}: ${e.message.slice(0, 600)}`); }
    pl.close_session();
  }
  return { checks, bad };
}

// control camapp 3 (docs/hle-gaps.md 4.1.5; E143). The sessions take no frames (camapp3FramesSession takes them: the
// histogram's registers HIST1, HISTAREA1..3, HIST2 and HIST3 compose under A-VSCHIST-3, docs/hle-gaps.md 4.2.4)
const START_TRAS = [415, 598, 614, 990, 958, 1515, 994, 955, 1001, 1061, 992, 1503, 1065, 1045, 938, 974];
const NATIVE_RESULT = { 992: 0xF0000058 };
// the imgpro unit's run as the menu opens (docs/hle-gaps.md 4.3.1; X): kind 14's rectangle fill (op 3, mode 5) of the
// through image's bank, 600 rows of 1800 bytes (900 pixels) at a pitch of 11136 bytes, with the YCbCr pair 0x800b800b
// (Y 0x0b, Cb and Cr 0x80); the GUI states the menu, playback and their returns reach
const MENU_FILL = { op: 3, mode: 5, dst: 0x98D4D800, bytes: 1800, rows: 600, pitch: 11136, value: 0x800B800B };
const GUI_MENU = '0x0b02', GUI_SHOOTING = '0x0108', GUI_NO_PICTURE = '0x0505';
// the next stops (docs/hle-gaps.md 4.3.2; D unless tagged):
//   CapThr's state word (getter 0x50bcccc9), whose top byte 1 the sequence parts' S1 guard 0x50bcdef7 asks for (X: 2
//   before the menu, the static 0x02010202; 1 after it closes)
//   playback: Play_Get_Picture_Header_Info's getter in the play module (0x518b629e) has its code in d2 at
//   0x518b62dc: 6152 where the picture's record (0x518bfc7e returns it) is not marked loaded (+12 not 1); the play
//   capability then sets its state word 0x62b0dc8c to 4 (0x50bb20dd), from which playOneFrameStart answers 0xf0000001
//   (0x50c5007b); right fills the other bank (X)
//   the sequence parts' phase (0x60364a1c, getter 0x50cc60fa): 102 after an S1 whose take-ready nothing finishes;
//   isCtrlReleaseEnable (0x50ab5c04) logs "UNRESPONSIVE(Seq=%d)" at 0x50ab5c26, the phase at (8,sp), and refuses
//   the key for any phase but 100 and 101
//   the control: PLAY_EXEC's queue (0x3f), which holds two messages (X: 40 bytes, 20 a message)
const THR_STATE = 0x60362B38, THR_RUNNING = 1, THR_NOT_RUNNING = 2;
const HEADER_INFO_CODE = 0x518B62DC, HEADER_NOT_LOADED = 6152, PLAY_CAP_STATE = 0x62B0DC8C, PLAY_CAP_FAILED = 4;
const RIGHT_BANK = 0x9A43E000, SEQ_PHASE = 0x60364A1C, PHASE_TAKE_READY = 102, RELEASE_UNRESPONSIVE = 0x50AB5C26;
const PLAY_EXEC = 0x3F, API_SEND_RETURN = 0x503EBA07, OLYQEWR = 0x5002C151, OXF_MAIN_TASK = 57;
const hx = (v) => (v === undefined || v === null ? String(v) : '0x' + (v >>> 0).toString(16));
// LENS_EXEC and LENS_COMMAND, and the native lens's tasks that wait on them (LENS_MAIN 92, LENS_COMMAND 91); a data
// queue's first waiting receiver: its control block from the kernel's table at kcb +232, the receive-wait list at +12,
// a waiting TCB's id at +16 (ref_dtq 0x50013ca7, D)
const LENS_QUEUES = [0x2E, 0x31], LENS_TASKS = [92, 91];
const recvWaiter = (lab, q) => {
  const cb = lab.sim.u32(lab.nk.kcb(232) + 4 * (q - 1)), first = lab.sim.u32(cb + 12), id = lab.sim.read(first + 16, 2);
  return first === cb + 12 ? 0 : id[0] | id[1] << 8;
};
// the histogram (docs/hle-gaps.md 4.2.1): at least HIST_RUNS_MIN runs in the start and 2 s of idle (X: a run every 50
// ms), HIST_BIN_WORDS bin words a read (128 bins, 0x501d6aa6..cb's clamp, D); cmd 15's wait returns within two frames
// and the key's own step (the TFT's 16.68 ms frame, X)
const HIST_RUNS_MIN = 30, HIST_BIN_WORDS = 64, HIST_WAIT_MAX_NS = 3 * 16683000;
export async function traRoutingSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  for (const hdmi of [false, true]) {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...(hdmi ? { hdmi: 'on' } : {}) }, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    const tag = hdmi ? '--hdmi on' : 'camapp 3';
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab, ca = s.camapp;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const taken = () => ca.tra_native.splice(0);
      // S-MODACK takes the message of each request it answers, so the queues a task the lab runs reads leave it: the
      // native lens's LENS_EXEC and LENS_COMMAND, whose tasks wait in their receive-wait lists
      const lensWait = LENS_QUEUES.map((q) => recvWaiter(lab, q));
      ok(s.lens && LENS_QUEUES.every((q) => !ca.module_queues.has(q)) && lensWait.join() === LENS_TASKS.join(),
        `${tag}: the native lens's queues ${LENS_QUEUES.map(hx)} left out of S-MODACK (${LENS_QUEUES.map((q) => ca.module_queues.has(q))}), their receivers ${lensWait}`);
      const used = pl.stand_ins_in_use(), st = ca.status();
      const states = Object.fromEntries(ca.boot_objects().map(([[name], o]) => [name, lab.sim.u32(o + 256)]));
      ok(st.components === true && st.native_tra === true && !used.includes('S-BOOTDONE') && !used.includes('S-TRAACK') && states.Cab_CameraBase === 13 && states.CtgStl_StillImageShooting === 11,
        `${tag}: the camera base and the still category booted by the firmware's own 415 and 420: ${JSON.stringify(states)}, stand-ins ${used.filter((x) => /BOOTDONE|TRAACK/.test(x))}`);
      const start = taken(), ids = [...new Set(start.map(([id]) => id))];
      ok(JSON.stringify(ids) === JSON.stringify(START_TRAS), `${tag}: the start's transactions handed to the exec in order: ${ids}`);
      const wrong = start.filter(([id, , res]) => res !== (NATIVE_RESULT[id] ?? 0));
      ok(start.length && !wrong.length, `${tag}: each answered natively (992 0xf0000058, the others 0): ${JSON.stringify(wrong)}`);
      idle(2000);
      const quiet = taken();
      ok(quiet.some(([id]) => id === 944) && quiet.every(([, , res]) => res === 0), `${tag}: the idle's getHistogramData (944) answered natively: ${JSON.stringify(quiet.slice(0, 4))}`);
      // the VSC histogram (docs/hle-gaps.md 4.2.1): runs on the TFT channel only, each ended natively and its DISPLAY
      // cmd 16 run by S-DISPQ, whose bin reads are answered under A-VSCHIST-2 (HIST_BIN_WORDS words a read)
      const hist = [0, 1, 2].map((c) => lab.vsc.hist(c).runs), reads = lab.vsc.hist_zero_reads();
      const cmd16 = [...s.steps.flatMap((x) => x.dispq ?? []), ...lab.dispq].filter((x) => x.cmd === 16).length;
      const refused = lab.vsc.errors()[1].filter((e) => e.name === 'HIST_UNMODELLED').length;
      ok(hist[0] === 0 && hist[1] === 0 && hist[2] >= HIST_RUNS_MIN && [hist[2] - 1, hist[2]].includes(cmd16)
        && reads === HIST_BIN_WORDS * cmd16 && !refused,
        `${tag}: the histogram's runs per channel ${hist} (want the TFT's >= ${HIST_RUNS_MIN}), DISPLAY cmd 16 through S-DISPQ ${cmd16}, bin reads under A-VSCHIST-2 ${reads}, HIST_UNMODELLED ${refused}`);
      if (hdmi) {
        const rec = pl.run_input({ type: 'hdmi', action: 'plug' });
        idle(500);
        const plug = taken(), tra588 = plug.filter(([id]) => id === 588);
        ok(tra588.length === 1 && tra588[0][2] === 0 && !ca.outdev_done.length && rec.hdmi?.scdc_writes === 1,
          `${tag}: the plug's TRA 588 answered 0 by the component, no S-OUTDEV (${ca.outdev_done.length}), the open's SCDC write ${rec.hdmi?.scdc_writes}`);
        ok(ca.hist_ends >= 1 && ca.hist_waited.length >= 1 && ca.hist_waited.every(([d0]) => d0 === 0),
          `${tag}: the plug's DISPLAY cmd 15 waited for the histogram's end natively (S-HISTEND ${ca.hist_ends}; ${JSON.stringify(ca.hist_waited)})`);
        const c = lab.compose('hdmi', true, true), hd = c.header;
        ok(c.status === 'NONE' && hd.width === 1920 && hd.height === 1080 && hd.drawn === 0,
          `${tag}: channel 0 composes its 1920 x 1080 window, no plane drawn (the GUI's HDMI layout is not drawn): ${c.status} ${JSON.stringify(hd)}`);
        continue;
      }
      // the take API (0x50417cd9, d0 the control) and Com_EvSenderManager's 794 build (0x50d77eaf) from here on, read
      // after the last pass (docs/hle-gaps.md 4.1.10)
      const takeApi = [], built794 = [];
      lab.observe(0x50417CD9, (l, r) => takeApi.push(r.d0 >>> 0), 'test: the take API');
      lab.observe(0x50D77EAF, () => built794.push(lab.lab_time()), 'test: the 794 build');
      // passes of S1 and S2: the OXF main thread's events do not stay (docs/hle-gaps.md 4.4.2)
      const oxf = () => [...lab.heap_sizes].filter(([a, size]) => size === 32 && [0x60EF3504, 0x60DCB42C].includes(lab.sim.u32(a) >>> 0)).length;
      const pass = () => {
        s.key('s1', 'down'); s.camapp.pump(); idle(600);
        s.key('s2', 'down'); s.camapp.pump(); idle(700);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(2000);
      };
      pass();
      const n0 = oxf();
      pass(); pass();
      const shots = taken();
      ok(oxf() === n0 && shots.some(([id]) => id === 1030) && shots.every(([, , res]) => res === 0),
        `${tag}: over two passes of S1 and S2 the OXF events kept ${n0} -> ${oxf()}, S2's 1030 answered natively (${JSON.stringify([...new Set(shots.map(([id]) => id))])})`);
      ok(s.status().gui === '0x0108', `${tag}: the shooting screen after the passes: ${s.status().gui}`);
      // the menu: DISPLAY cmd 15 waits for the run's end (S-HISTEND), E_OK within two frames; then udf07, the imgpro
      // unit's fill and the image player's stage 9 (docs/hle-gaps.md 4.3.1): the menu opens
      const unit = lab.sim.m.devices.imgpro, runs0 = unit.runs;
      const key = (k) => { const rec = s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); return [s.status().gui, rec]; };
      const t15 = lab.lab_time();
      const [menu] = key('menu');
      const now = pl.stand_ins_in_use(), waited = ca.hist_waited;
      ok(ca.hist_ends >= 1 && waited.length >= ca.hist_ends && waited.every(([d0, t]) => d0 === 0 && t > t15 && t - t15 <= HIST_WAIT_MAX_NS)
        && ['S-HISTEND', 'A-VSCHIST-1', 'A-VSCHIST-2'].every((x) => now.includes(x)) && !now.includes('S-HISTWAIT'),
        `${tag}: the menu's DISPLAY cmd 15 waited for the histogram's end natively (S-HISTEND ${ca.hist_ends}; [d0, lab ns] ${JSON.stringify(waited)} from ${t15}; ${now.filter((x) => /HIST/.test(x))})`);
      const fill = unit.last(), want = Object.entries(MENU_FILL).every(([k, v]) => fill?.[k] === v);
      const bus = lab.sim.m.devices.bus, edge = new Uint8Array(4), tail = new Uint8Array(4);
      if (fill) { bus.read(fill.dst, edge); bus.read(fill.dst + (fill.rows - 1) * fill.pitch + fill.bytes - 4, tail); }
      const pair = [0x0b, 0x80, 0x0b, 0x80], filled = [...edge, ...tail].every((b, i) => b === pair[i % 4]);
      ok(menu === GUI_MENU && unit.runs - runs0 === 1 && want && filled && !unit.powered && unit.status === 0
        && ['H-IMGPROINIT', 'S-STAGE9', 'S-IMGPRO', 'A-IMGPRO-1'].every((x) => now.includes(x)),
        `${tag}: the menu opens (${menu}) after the imgpro unit's fill of the through image's bank (runs ${unit.runs - runs0}, ${JSON.stringify(fill)}, its first and last words ${[...edge, ...tail]}; powered ${unit.powered}, status ${unit.status}; ${now.filter((x) => /IMGPRO|STAGE9/.test(x))})`);
      // the menu closes, and the components have restarted the through image (CapThr's state word's top byte 1, where
      // the passes before had it 2, the static value S-TAKEOVER leaves: docs/hle-gaps.md 4.1.7)
      const thr = () => lab.sim.u32(THR_STATE) >>> 24, thr0 = thr();
      const [closed] = key('menu'), thr1 = thr();
      ok(closed === GUI_SHOOTING && thr0 === THR_NOT_RUNNING && thr1 === THR_RUNNING,
        `${tag}: MENU closes the menu (${closed}); CapThr's state word's top byte ${thr0} before the menu, ${thr1} after`);
      // playback shows No Picture although the card holds the passes' pictures: the play module does not run, S-MODACK
      // answers its Play_Picture request, and Play_Get_Picture_Header_Info's getter finds the picture not loaded, so
      // the play capability's state goes to 4 (docs/hle-gaps.md 4.3.2)
      const codes = [];
      lab.observe(HEADER_INFO_CODE, (l, r) => codes.push(r.d2 & 0xFFFF), 'test: the header info getter\'s code');
      const [play] = key('play'), cap = lab.sim.read(PLAY_CAP_STATE, 2), capState = cap[0] | cap[1] << 8;
      ok(play === GUI_NO_PICTURE && ca.card_images() === 3 && codes.includes(HEADER_NOT_LOADED) && capState === PLAY_CAP_FAILED,
        `${tag}: PLAY shows ${play} with ${ca.card_images()} pictures on the card: the header info getter's codes ${codes}, the play capability's state ${capState}`);
      // right and left are taken in playback (right fills the other bank) and PLAY returns: S-MODACK takes the play
      // requests off PLAY_EXEC's queue, which holds two (until 2026-11-10 right's blocked the OXF main thread there)
      const runs1 = unit.runs, [right] = key('right'), fillR = unit.last(), [left] = key('left'), [back] = key('play');
      ok(right === GUI_NO_PICTURE && unit.runs - runs1 === 1 && fillR?.dst === RIGHT_BANK && left === GUI_NO_PICTURE && back === GUI_SHOOTING,
        `${tag}: right (${right}) fills ${hx(fillR?.dst)} (runs ${unit.runs - runs1}), left (${left}), PLAY returns (${back})`);
      // the furthest point: a pass of S1 and S2 after them records its picture, and MENU is then not taken (its key
      // code reaches UI_IN, the GUI gets no event): with the through image running, S1 passes the sequence parts' guard
      // and the sequence waits in phase 102 for TAKE's take-ready, which no module answers; isCtrlReleaseEnable then
      // refuses every key (docs/hle-gaps.md 4.3.2). The session's first take request, not a second (the passes before
      // the menu make none): TAKE does not run (TAKE_EXEC is S-MODACK's), so no TAKE_MAIN posts the event 0x04080032
      // from which Com_EvSenderManager builds 794 (docs/hle-gaps.md 4.1.10)
      pass();
      ok(ca.module_queues.has(0x5A) && JSON.stringify(takeApi) === '[32,64]' && !built794.length,
        `${tag}: the session's take requests (controls ${takeApi.map(hx)}) are this pass's, to S-MODACK's TAKE_EXEC (${ca.module_queues.has(0x5A)}), no 794 built (${built794.length})`);
      const phase = lab.sim.u32(SEQ_PHASE), unresponsive = [];
      lab.observe(RELEASE_UNRESPONSIVE, (l, r) => unresponsive.push(l.sim.u32((r.sp >>> 0) + 8)), 'test: isCtrlReleaseEnable\'s refusal');
      const [after, rec] = key('menu');
      ok(ca.card_images() === 4 && after === GUI_SHOOTING && rec.events.length === 0 && rec.uiin?.[0]?.ev === 'EV_PRESS_MENU_KEY'
        && phase === PHASE_TAKE_READY && unresponsive.length >= 1 && unresponsive.every((p) => p === PHASE_TAKE_READY),
        `${tag}: after a further pass (${ca.card_images()} pictures, the sequence in phase ${phase}) MENU's ${rec.uiin?.[0]?.ev} sets no GUI event (${rec.events.length}), isCtrlReleaseEnable refusing it in phases ${unresponsive}, the GUI stays ${after}`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    pl.close_session();
  }
  // control: PLAY_EXEC's requests answered as S-MODACK answered them before 2026-11-10, their messages left in the
  // kernel's queue: right's request finds it full and the OXF main thread waits for good, which the blocked-send guard
  // reports as a send to PLAY_EXEC by that task (it named queue 6 before, the queue of a later send through the site)
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.camapp_components = true; pl.camapp_native_tra = true;
  try {
    pl.open_session();
    const s = pl.session, lab = s.lab, ca = s.camapp, { disasm } = await import('../src/lab/hle.mjs');
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); };
    ca.module_queues.delete(PLAY_EXEC);
    lab.wrap(OLYQEWR, (prev) => (h, r) => {
      if (disasm(r.mdr) === API_SEND_RETURN && (r.d0 & 0xFFFF) === PLAY_EXEC) {
        const p = lab.sim.u32(r.a0 >>> 0);
        ca.acks.push({ q: PLAY_EXEC, w: [0, 1, 2, 3].map((k) => lab.sim.u32(p + 4 * k)) });
      }
      return prev(h, r);
    }, 'test: S-MODACK as before for PLAY_EXEC');
    let stop = null;
    try {
      for (let i = 0; i < 2; i++) {                                                  // two pictures, so right moves
        s.key('s1', 'down'); s.camapp.pump(); idle(600); s.key('s2', 'down'); s.camapp.pump(); idle(700);
        s.key('s2', 'up'); s.camapp.pump(); s.key('s1', 'up'); s.camapp.pump(); idle(2000);
      }
      for (const k of ['menu', 'menu', 'play', 'right']) key(k);
    } catch (e) { stop = e.message; }
    const want = new RegExp(`waits on a full queue: queue ${PLAY_EXEC} from \\S+ \\(disasm 0x5002c1f8\\) in task ${OXF_MAIN_TASK} `);
    ok(stop !== null && want.test(stop), `control: with PLAY_EXEC's messages left in its queue right's request blocks the OXF main thread there: ${stop?.slice(0, 240)}`);
  } catch (e) { bad.push(`control: ${e.message.slice(0, 600)}`); }
  pl.close_session();
  return { checks, bad };
}

// control camapp 3's frames (docs/hle-gaps.md 4.2.4; E143): with the histogram's registers in a composite under
// A-VSCHIST-3 (src/dev/vsccompose.mjs histForm) the TFT composes at the shooting screen, in the menu and its close,
// in playback and its return; the menu shows the through image's bank as IMG2 (DISPLAY cmd 5, unscaled, the imgpro
// fill's rectangle), which the harness's IMG edge guard lets pass (src/lab/display.mjs unscaled), and whose pixels are
// the background's (the fill's Y 11, Cb and Cr 128: the composite without IMG2 is the same, X); with --cpu2 native
// OSD_DRAW_CPU2's histogram adds bin 5's column (the firmware's 64 in bin 5 for an IMG1 that is off, A-VSCHIST-2)
// and nothing else: two columns of the histogram box (FRAMES_HIST_COLUMN)
const FRAMES_LV_BANK = 0x98D4D800, FRAMES_LV_STRIDE = 11136, FRAMES_IMG2 = 1;
const FRAMES_HIST_COLUMN = { pixels: 126, box: [14, 110, 15, 172] };
export async function camapp3FramesSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const shooting = {};
  for (const cpu2 of [false, true]) {
    const tag = `camapp 3${cpu2 ? ' --cpu2 native' : ''}`;
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, ...(cpu2 ? { cpu2: 'native' } : {}) }, env);
    pl.camapp_components = true; pl.camapp_native_tra = true;
    try {
      pl.open_session();
      const s = pl.session, lab = s.lab;
      const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
      const key = (k) => { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); return s.status().gui; };
      // a frame of the shown state, or the composite's refusal
      const frame = () => { try { return s.frame()[2]; } catch (e) { return e.message.slice(0, 300); } };
      idle(2000);
      const f0 = frame(), used = pl.stand_ins_in_use();
      ok(Array.isArray(f0) && used.includes('A-VSCHIST-3') && lab.vsc.hist_assumed() > 0,
        `${tag}: the shooting screen composes with the histogram's registers (A-VSCHIST-3 in ${used.filter((x) => /HIST/.test(x))}, composites ${lab.vsc.hist_assumed()}): ${Array.isArray(f0) ? 'a frame' : f0}`);
      shooting[cpu2] = f0;
      if (cpu2) break;
      const menu = key('menu'), f1 = frame(), img2 = s.last_planes?.planes?.IMG2;
      ok(menu === GUI_MENU && Array.isArray(f1) && img2?.result === 'drawn' && img2.base === FRAMES_LV_BANK && img2.stride === FRAMES_LV_STRIDE
        && img2.w === 900 && img2.h === 600, `${tag}: the menu (${menu}) composes, IMG2 the through image's bank: ${JSON.stringify(img2 ?? null)} ${Array.isArray(f1) ? '' : f1}`);
      // IMG2's pixels are the background's: the same composite with the lab's view mask leaving IMG2 out
      lab.vsc.set_view(2, 0x3F & ~(1 << FRAMES_IMG2));
      const nv = lab.compose('tft', false, false);
      lab.vsc.set_view(2, 0x3F);
      ok(Array.isArray(f1) && nv.status === 'NONE' && !((nv.header.drawn >>> FRAMES_IMG2) & 1) && nv.words.length === f1.length
        && nv.words.every((x, i) => x === f1[i]), `${tag}: the menu without IMG2 is the same picture (the fill's value is the background's; drawn 0x${nv.header.drawn.toString(16)})`);
      const closed = key('menu'), f2 = frame(), play = key('play'), f3 = frame(), back = key('play'), f4 = frame();
      ok(closed === GUI_SHOOTING && play === GUI_NO_PICTURE && back === GUI_SHOOTING && [f2, f3, f4].every(Array.isArray),
        `${tag}: the menu's close (${closed}), PLAY (${play}) and its return (${back}) compose: ${[f2, f3, f4].filter((f) => !Array.isArray(f))}`);
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    finally { pl.close_session(); }                                   // the --cpu2 pass's break too
  }
  // CPU 2's histogram: bin 5's column in the box, nothing else changed
  const [a, b] = [shooting[false], shooting[true]];
  if (Array.isArray(a) && Array.isArray(b)) {
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push([i % 900, Math.floor(i / 900)]);
    const box = diff.reduce((r, [x, y]) => [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)], [1e9, 1e9, -1, -1]);
    ok(diff.length === FRAMES_HIST_COLUMN.pixels && JSON.stringify(box) === JSON.stringify(FRAMES_HIST_COLUMN.box),
      `--cpu2 native: OSD_DRAW_CPU2's histogram changes ${diff.length} pixels in ${JSON.stringify(box)}, want ${FRAMES_HIST_COLUMN.pixels} in ${JSON.stringify(FRAMES_HIST_COLUMN.box)}`);
  } else ok(false, 'the two shooting frames for the histogram comparison');
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
  const { loadImage, loadBlock, loadNand, createHash: envHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { propStoreInit } = await import('../src/lab/menu.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash: envHash, wallClock: () => performance.now() / 1000 };
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
  const only = process.argv[2];
  const run = async (name, fn) => (!only || only === name ? fn() : { checks: 0, bad: [] });
  const r = await run('camapp', camappSession), h = await run('heap', heapSession), w = await run('workload', heapWorkloadSession), m = await run('dial', modeDialSession);
  const t = await run('tra', traRoutingSession);
  const f = await run('frames', camapp3FramesSession);
  console.log(`camapp session: ${r.checks - r.bad.length}/${r.checks}; the heap over an idle: ${h.checks - h.bad.length}/${h.checks}; the heap over a workload: ${w.checks - w.bad.length}/${w.checks}; the mode dial: ${m.checks - m.bad.length}/${m.checks}; camapp 3's transactions: ${t.checks - t.bad.length}/${t.checks}; camapp 3's frames: ${f.checks - f.bad.length}/${f.checks}`);
  [...r.bad, ...h.bad, ...w.bad, ...m.bad, ...t.bad, ...f.bad].forEach((x) => console.log('  ', x));
  process.exit(r.bad.length || h.bad.length || w.bad.length || m.bad.length || t.bad.length || f.bad.length ? 1 : 0);
}
