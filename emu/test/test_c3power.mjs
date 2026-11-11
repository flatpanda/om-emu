// control camapp 3's two stops that keep it from being the player's default (docs/hle-gaps.md 4.3.6; E143):
//   powerOffSession  the lever's off: S-SHUTDOWN's shutDown sends TRA 586 (startShutDown 0x50af6865, a 10 s wait),
//                  which the camera base takes by tearing the shoot mode down; the shooting component's state 20 sends
//                  the flash capability (its +908) event 422 and waits for the flash's stop notification (event 25
//                  through its observer at +468, which CapFls_Flash's +228 list holds), which CapFls sends only for a
//                  422 taken in its stopped state 3; CapFls is running (state 4), so 586 is never answered and the
//                  power-off ends at S-SHUTDOWN's deadline. Control: with the flash stopped first by its own 422 (as
//                  TRA 987's path at PLAY stops it) the component reaches its state 3 and CmpSdw_ShutdownComponent,
//                  created by the teardown in both runs, is started (state 5 at the deadline, not 3), and 586 is still
//                  unanswered (the next stop)
//   evfSwitchSession  LV (the lab's SWITCH): its DISPLAY cmd 2 OPEN of the EVF closes the TFT while the VSC histogram
//                  runs on it, and the run's end logs 0x37001418 from the ISR (0x501deccc); the application's own
//                  histogram stop, TRA 937 (stopHistogram, 0x51057525), comes in camapp 1 from task 165 after the
//                  GUI's output change (camera API vt+20, device 16), so after the lab's open. The firmware's own
//                  output change (vt+20 with device 16 from the lab task: TRA 588, CapIod's DISPLAY cmd 45 with code
//                  2) also opens the EVF under the running histogram and logs 0x37001418 once. From the Super Control
//                  Panel, whose open stops the histogram, LV and the eye switch run: ChangeOutline reads module 9's
//                  state, which the components set to 0, at both its sites (0x50abcfd7, 0x50abcfe2), which the switch's
//                  post-condition allows under camapp 3 since 2026-11-10 (it refused the second)
//   node emu/test/test_c3power.mjs [power|evf]
const h8 = (v) => '0x' + (v >>> 0).toString(16);

// the objects, by their vtables (run-time addresses; D): the shooting component CmpSht_ShootingComponent_NEW, the
// flash capability CapFls_Flash, the shutdown component CmpSdw_ShutdownComponent; the shooting component's flash
// pointer (+908) and its flash-stop observer (+468, vtable OBSERVER_VT); CapFls's stop observers (+228: +12 count, +20
// array); a reactive's state word (+256); the HLS heap they live in (camapp.mjs HLS_HEAP)
const CMP_SHT_VT = 0x60EF0754, CAP_FLS_VT = 0x60E7985C, CMP_SDW_VT = 0x60EEE834, OBSERVER_VT = 0x60EF230C;
const CMP_FLASH = 908, CMP_OBSERVER = 468, FLS_STOPPED = 228, RX_STATE = 256;
const HLS_HEAP = [0x62A00000, 0x62C00000];
// the shooting component's state waiting for the flash (0x50d73976 enters it, 0x50d73a64 handles it), its end state;
// CapFls's running and stopped states (0x50be870c's dispatch)
const CMP_WAIT_FLASH = 20, CMP_ENDED = 3, FLS_RUNNING = 4, FLS_STOPPED_STATE = 3;
// CmpSdw_ShutdownComponent, which does not exist at the start: its state before its start (event 415) and at the
// deadline after it (X: 415 taken in state 3, then 285 in state 8)
const SDW_IDLE = 3, SDW_STARTED = 5;
// event 422's constructor and the post to a reactive (D: 0x50d719fe builds and posts it the same way)
const EV422_NEW = 0x50AB6EF9, EV422_BYTES = 28, POST = 0x50D7F97E;
// the histogram's run word (vsc spec section 13), the TFT and EVF bits of the opened word (display.mjs OPENED_WORD)
const HIST_RUN = 0x62A3EAF8, OPENED = 0xA32DB39C, OPEN_EVF = 2;
const HIST_ERRLOG = 0x37001418, HIST_ISR_LOG = '0x501deccc';
// the TRA exec's two entries (camapp.mjs TRA_EXEC_CALLS / CALL), a request's id at +4 and 588's device at +32; the
// camera API's getter and its output change, vt+20 (0x50afcd3a), with the GUI's EVF device (X: ConnectChangePlay)
const TRA_EXEC = [0x50AF7CB9, 0x50AF7CBE], CAM_API = 0x50AFCCD5, OUTPUT_CHANGE = 0x50AFCD3A, EVF_DEVICE = 16;
const TRA_SHUTDOWN = 586, TRA_HIST_STOP = 937, TRA_OUTPUT = 588, APP_KEY_TASK = 165;
// ChangeOutline's two module-9 reads (menu.mjs TAKEOVER_READERS: the returns after 0x50ab5780) and the Super Control
// Panel's GUI state
const CHANGE_OUTLINE_READS = [0x50ABCFD7, 0x50ABCFE2], GUI_SCP = '0x0403';

async function setup() {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { runtime, disasm } = await import('../src/lab/hle.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const player = (camapp3, a15) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15, out: '<out>', no_wait_on_error: true }, env);
    if (camapp3) { pl.camapp_components = true; pl.camapp_native_tra = true; }
    pl.open_session();
    return pl;
  };
  // an observer that keeps the hook already there
  const watch = (lab, a, f, name) => {
    if (lab.hooks.has(runtime(a))) lab.wrap(a, (prev) => (hh, r) => { f(lab, r); return prev(hh, r); });
    else lab.observe(a, f, name);
  };
  // the objects of a vtable in the HLS heap (word-aligned)
  const objects = (lab, vt) => {
    const [a, b] = HLS_HEAP, bytes = lab.sim.read(a, b - a), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), out = [];
    for (let o = 0; o < bytes.length; o += 4) if (dv.getUint32(o, true) === vt) out.push(a + o);
    return out;
  };
  const tid = (lab) => { const b = lab.sim.read(lab.lt.current() + 16, 2); return b[0] | b[1] << 8; };
  const tra = (lab, r) => { const b = lab.sim.read((r.a1 >>> 0) + 4, 2); return b[0] | b[1] << 8; };
  return { player, watch, objects, tid, tra, disasm };
}

export async function powerOffSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, objects } = await setup();
  for (const control of [false, true]) {
    const tag = control ? 'control (the flash stopped first)' : 'camapp 3';
    const pl = player(true, 'off'), s = pl.session, lab = s.lab, ca = s.camapp;
    try {
      const [cmp] = objects(lab, CMP_SHT_VT), [fls] = objects(lab, CAP_FLS_VT), sdw0 = objects(lab, CMP_SDW_VT);
      const flsList = lab.sim.u32(fls + FLS_STOPPED + 20), n = lab.sim.u32(fls + FLS_STOPPED + 12);
      const observers = Array.from({ length: n }, (_, k) => lab.sim.u32(flsList + 4 * k) >>> 0);
      ok(cmp && fls && lab.sim.u32(cmp + CMP_FLASH) === fls && lab.sim.u32(fls + RX_STATE) === FLS_RUNNING
        && observers.length === 1 && observers[0] === cmp + CMP_OBSERVER && lab.sim.u32(observers[0]) === OBSERVER_VT,
        `${tag}: the shooting component ${h8(cmp)}'s flash +${CMP_FLASH} is CapFls ${h8(fls)} in state ${lab.sim.u32(fls + RX_STATE)}, whose stop observers are ${observers.map(h8)}`);
      if (control) {
        const ev = lab.alloc(new Uint8Array(EV422_BYTES), 4);
        lab.call(EV422_NEW, { a0: ev }, null, [0, 4], 20000);
        lab.call(POST, { a0: fls, a1: ev }, null, [0x30, 16], 200000);
        s.settle('test: event 422 to CapFls_Flash');
        ok(lab.sim.u32(fls + RX_STATE) === FLS_STOPPED_STATE, `${tag}: CapFls takes its 422 to state ${lab.sim.u32(fls + RX_STATE)}`);
      }
      let err = null;
      try { pl.power('down'); } catch (e) { err = e; }
      const pending = ca.tra_native.filter(([id, , res]) => id === TRA_SHUTDOWN && res === null);
      const state = lab.sim.u32(cmp + RX_STATE), sdw = objects(lab, CMP_SDW_VT), sdw1 = sdw.map((o) => lab.sim.u32(o + RX_STATE));
      ok(err?.constructor.name === 'PowerError' && /had not reached its last write after 10000 ms/.test(err.message) && pending.length === 1
        && pending[0][1].includes('0x50af6865'),
        `${tag}: the power-off ends at S-SHUTDOWN's deadline with TRA 586 unanswered: ${err?.constructor.name} ${err?.message.slice(0, 120)}; ${JSON.stringify(pending)}`);
      if (!control) {
        ok(state === CMP_WAIT_FLASH && lab.sim.u32(fls + RX_STATE) === FLS_STOPPED_STATE && !sdw0.length && sdw1.join() === String(SDW_IDLE),
          `${tag}: the shooting component waits in state ${state} (want ${CMP_WAIT_FLASH}) after its 422 moved CapFls from 4 to ${lab.sim.u32(fls + RX_STATE)}; CmpSdw_ShutdownComponent: ${sdw0.length} at the start, then ${sdw.map(h8)} in state(s) ${sdw1}`);
      } else {
        ok(state === CMP_ENDED && !sdw0.length && sdw1.join() === String(SDW_STARTED),
          `${tag}: the shooting component ends in state ${state} (want ${CMP_ENDED}); CmpSdw_ShutdownComponent: ${sdw0.length} at the start, then ${sdw.map(h8)} in state(s) ${sdw1} (want ${SDW_STARTED})`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

export async function evfSwitchSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, watch, tid, tra, disasm } = await setup();
  // camapp 3: LV's open under the running histogram
  {
    const pl = player(true, 'auto'), lab = pl.session.lab;
    try {
      const run = lab.sim.u32(HIST_RUN);
      let err = null;
      try { pl.run_input({ type: 'key', id: 'lv', action: 'down' }); } catch (e) { err = e; }
      const re = new RegExp(`DISPLAY cmd 2 OPEN evf.*firmware error log: ${h8(HIST_ERRLOG)} from \\S+ \\(disasm ${HIST_ISR_LOG}\\)`);
      ok(run === 1 && err && re.test(err.message), `camapp 3: LV's DISPLAY cmd 2 OPEN of the EVF with the histogram running (${run}) stops at the ISR's ${h8(HIST_ERRLOG)}: ${err?.message.slice(0, 200)}`);
    } catch (e) { bad.push(`camapp 3: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  // camapp 1: the GUI's output change and the application's TRA 937 come after the lab's open
  {
    const pl = player(false, 'auto'), lab = pl.session.lab, seen = [];
    try {
      watch(lab, OUTPUT_CHANGE, (l, r) => seen.push(['vt+20', r.d0, tid(l)]), 'test: the output change');
      for (const a of TRA_EXEC) watch(lab, a, (l, r) => { const id = tra(l, r); if (id === TRA_HIST_STOP) seen.push(['tra', id, tid(l)]); }, 'test: TRA');
      const o0 = lab.sim.u32(OPENED);
      pl.run_input({ type: 'key', id: 'lv', action: 'down' });
      const change = seen.findIndex(([k, d]) => k === 'vt+20' && d === EVF_DEVICE), stop = seen.findIndex(([k, , t]) => k === 'tra' && t === APP_KEY_TASK);
      ok(o0 !== OPEN_EVF && lab.sim.u32(OPENED) === OPEN_EVF && change >= 0 && stop > change,
        `camapp 1: after the lab's open (opened ${h8(o0)} -> ${h8(lab.sim.u32(OPENED))}) the GUI's vt+20(${EVF_DEVICE}) then task ${APP_KEY_TASK}'s TRA ${TRA_HIST_STOP}: ${JSON.stringify(seen)}`);
    } catch (e) { bad.push(`camapp 1: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  // camapp 3 from the Super Control Panel (switch-scp's inputs): the histogram stopped, both switches run
  {
    const pl = player(true, 'auto'), s = pl.session, lab = s.lab, reads = [];
    try {
      for (const a of CHANGE_OUTLINE_READS) watch(lab, a, (l, r) => reads.push([h8(a), r.d0 | 0]), 'test: ChangeOutline\'s module-9 read');
      for (const [id, action] of [['ok', 'down'], ['ok', 'up']]) pl.run_input({ type: 'key', id, action });
      const run = lab.sim.u32(HIST_RUN), gui0 = s.status().gui, got = [];
      for (const id of ['lv', 'eye']) for (const action of ['down', 'up']) { pl.run_input({ type: 'key', id, action }); got.push(s.status().gui); }
      ok(gui0 === GUI_SCP && run === 0 && got.every((g) => g === GUI_SCP) && lab.sim.u32(OPENED) === 1
        && JSON.stringify(reads) === JSON.stringify(CHANGE_OUTLINE_READS.map((a) => [h8(a), 0]).flatMap((x, i, all) => i ? [] : [...all, ...all])),
        `camapp 3 from the Super Control Panel (${gui0}, the histogram's run word ${run}): LV and the eye switch keep ${got}, the TFT open again (${h8(lab.sim.u32(OPENED))}), ChangeOutline's reads ${JSON.stringify(reads)}`);
    } catch (e) { bad.push(`camapp 3 from the SCP: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  // camapp 3: the firmware's own output change to the EVF, from the lab task in lab time (as S-SHUTDOWN runs shutDown)
  {
    const pl = player(true, 'on'), s = pl.session, lab = s.lab, sent = [];
    try {
      const { STEP_HOOKS, WAIT_HOOKS_PER_MS } = await import('../src/lab/nav.mjs');
      s.idle_slice(lab.lab_time() + 1000e6);
      for (const a of TRA_EXEC) watch(lab, a, (l, r) => { const id = tra(l, r); if (id === TRA_OUTPUT) sent.push([id, l.sim.u32((r.a1 >>> 0) + 32)]); }, 'test: TRA 588');
      const run = lab.sim.u32(HIST_RUN), o0 = lab.sim.u32(OPENED), e0 = lab.kernel.errors.length;
      const obj = lab.call(CAM_API, null, null, null, 200000).a0 >>> 0, fn = disasm(lab.sim.u32(lab.sim.u32(obj) + 20));
      const lt = lab.lt, prev = lt.on_idle, settling = lt.settling, deadline = lab.lab_time() + 3000e6;
      lt.on_idle = () => { if (lab.lab_time() < deadline) { lab.run_to_event(deadline); return 'again'; } throw new Error('test: the output change did not return in 3 s of lab time'); };
      lt.settling = true;
      let rc;
      try { rc = lab.calls(fn, { a0: obj, d0: EVF_DEVICE, d1: 0, a1: 0 }, undefined, undefined, STEP_HOOKS * 4 + 3000 * WAIT_HOOKS_PER_MS).d0 >>> 0; }
      finally { lt.on_idle = prev; lt.settling = settling; }
      s.idle_slice(lab.lab_time() + 500e6);
      const logged = lab.kernel.errors.slice(e0).filter(([c, , , w]) => c === HIST_ERRLOG && w.includes(HIST_ISR_LOG));
      ok(fn === OUTPUT_CHANGE && rc === 0 && run === 1 && o0 !== OPEN_EVF && lab.sim.u32(OPENED) === OPEN_EVF && JSON.stringify(sent) === JSON.stringify([[TRA_OUTPUT, EVF_DEVICE]]) && logged.length === 1,
        `camapp 3: vt+20 ${h8(fn)}(${EVF_DEVICE}) returns ${h8(rc)}, TRA 588 ${JSON.stringify(sent)}, opened ${h8(o0)} -> ${h8(lab.sim.u32(OPENED))} with the histogram running (${run}), ${h8(HIST_ERRLOG)} logged ${logged.length} time(s)`);
    } catch (e) { bad.push(`camapp 3 output change: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  const run = async (name, fn) => (!only || only === name ? fn() : { checks: 0, bad: [] });
  const p = await run('power', powerOffSession), e = await run('evf', evfSwitchSession);
  console.log(`camapp 3's power-off: ${p.checks - p.bad.length}/${p.checks}; camapp 3's EVF switch: ${e.checks - e.bad.length}/${e.checks}`);
  [...p.bad, ...e.bad].forEach((x) => console.log('  ', x));
  process.exit(p.bad.length || e.bad.length ? 1 : 0);
}
