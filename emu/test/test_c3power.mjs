// control camapp 3 against what keeps it from being the player's default (docs/hle-gaps.md 4.3.6, 4.3.10; E143):
//   powerOffSession  the lever's off: S-SHUTDOWN's shutDown sends TRA 586 (startShutDown 0x50af6865, a 10 s wait),
//                  which the camera base takes by tearing the shoot mode down; the shooting component's state 20 sends
//                  the flash capability (its +908) event 422 and waits for the flash's stop notification (event 25
//                  through its observer at +468, which CapFls_Flash's +228 list holds), which CapFls sends only for a
//                  422 taken in its stopped state 3; CapFls is running (state 4), so 586 is never answered and the
//                  power-off ends at S-SHUTDOWN's deadline. Control: with the flash stopped first by its own 422 (as
//                  TRA 987's path at PLAY stops it) the component reaches its state 3 and CmpSdw_ShutdownComponent,
//                  created by the teardown in both runs, is started (state 5 at the deadline, not 3), and 586 is still
//                  unanswered (the next stop)
//   leverSession   the lever's off without S-SHUTDOWN: under camapp 3 CmpSqp_SequencePartsBase's APPEVENT_CAMST_POWER
//                  handler (0x50c94612) takes the switch's code, and in standby starts nothing: its method at +4980
//                  takes the branch of the sequence word 0x60364980 = 0, where the power code asks the method at +4736
//                  (the byte 0x60364950), which returns 0, and the error sequence's step (0x50cbd6a1) returns at its
//                  +216 test (0x50cbd6c9: no error sequence set). Nothing follows in 1.5 s: no transaction 586, no
//                  CameraCommon::shutDown, the sequence still in its standby phase 101. Camapp 1 has no sequence parts
//   evfSwitchSession  LV and the eye sensor under camapp 3 are the firmware's own output change (play.mjs
//                  native_switch, 4.3.10): the lab sets the eye sensor's state and S-OUTDISP's answer, the application
//                  stops the VSC histogram (TRA 937) before it sends the GUI 131, the GUI's output change sends TRA
//                  588, CapIod opens the EVF and writes the output-device property, which S-PROP follows; no errlog
//                  0x37001418. The EVF's composite then stops at the three OSD planes' PLANC 0xca, the level 101 that
//                  DISPLAY cmd 7 from the OXF main thread sets after the open, from the EVF level table (A7 knows only
//                  128 and 0). Back to the TFT the application starts the histogram again (TRA 938) and the TFT
//                  composes. With property 1947 at 0 the application's eye handler asks for no output: the step
//                  records the switch as not made and the device stays; with 1947 back at 1 and the eye state unchanged
//                  nothing changes either, which stops the step. From the Super Control Panel the application's change
//                  goes to the shooting screen.
//                  Camapp 1 keeps the lab's own switch: its OPEN, then the GUI's vt+20 with device 16, then task
//                  165's TRA 937. The firmware's output change called without the application's stop (vt+20 with
//                  device 16 from the lab task: TRA 588, CapIod's DISPLAY cmd 45 with code 2) opens the EVF under the
//                  running histogram and logs 0x37001418 once: what the lab's own OPEN did before the native switch
//   standbySession  the sequence parts' standby entry (0x50c89da1) reads module 9's state at 0x50c8a335 once its word
//                  0x60364954 is set: at a lens attach (LLPSW) after a shot it reads the components' own 0, which the
//                  session's S-TAKEOVER scope allows under camapp 3 (CMP_MODULE9_READERS); without the entry the same
//                  step stops at the scope guard
//   node emu/test/test_c3power.mjs [power|lever|evf|standby]
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
// the application's two-read test in 0x50abb032 (camapp.mjs CA_MODULE9_READERS, CMP_MODULE9_READERS), which the
// switch back to the TFT makes four times (X); none of the components' own readers is read at a switch
const APP_TEST_READS = [0x50ABB039, 0x50ABB044];
// the output-device property (S-PROP, display.mjs prop_device) and the panels' values CapIod writes (display.mjs
// DEVICE); the opened word's TFT bit; the transactions of the application's histogram start and the GUI state of the
// shooting screen
const PROP_TFT = 1, PROP_EVF = 8, OPEN_TFT = 1, TRA_HIST_START = 938, GUI_SHOOTING = '0x0108';
// the OSD planes' level after the firmware's own open of the EVF: PLANC = level 101 << 1, entry 7 of the EVF level
// table 0x602ae4b4 (docs/om1-vsc-spec.md section 9 items 3 and 12), which DISPLAY cmd 7's index 7 selects (X; sent by
// the OXF main thread after the open, docs/hle-gaps.md 4.3.10); the compositor refuses it (A7)
const EVF_PLANC = 0xCA;
// the property at whose 0 the application's eye handler asks for no output (play.mjs EYE_SWITCH_PROPERTY)
const EYE_SWITCH_PROPERTY = 1947;
// the lever's off in the components: CmpSqp_SequencePartsBase's APPEVENT_CAMST_POWER handler; in its method at +4980
// (0x50cbf5c3) the branch of a sequence word other than 1 and 6 and the power code's return after the method at +4736
// (0x50cbc194) answered 0; the error sequence step's return at its +216 test (D); the sequence word (D: 0x50c8cea2);
// CameraCommon::shutDown (power.mjs's shutdown entry); the sequence's phase word and its standby
const SQP_POWER_EVENT = 0x50C94612, SQP_STANDBY_BRANCH = 0x50CBF7CE, SQP_POWER_NOTHING = 0x50CBFB91;
const SQP_ERRSEQ_UNSET = 0x50CBD6C9, SQP_WORD = 0x60364980, SHUT_DOWN = 0x50AFD2D7;
const SEQ_CONTROLLER = 0x6035F024, SEQ_PHASE = 0x60364A1C, PHASE_STANDBY = 101;
// the sequence parts' standby entry's module-9 read (camapp.mjs CMP_MODULE9_READERS) and the word that gates it
const STANDBY_READ = 0x50C8A335, STANDBY_WORD = 0x60364954;

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
  // camapp 3 at the shooting screen: the firmware's own output change, both ways, and the eye sensor with 1947 at 0
  {
    const pl = player(true, 'auto'), s = pl.session, lab = s.lab;
    try {
      const tras = (rec) => rec.camapp.filter(([k]) => k === 'tra').map(([, d]) => Number(d.split(' ')[0]));
      const hist = (e0) => lab.kernel.errors.slice(e0).filter(([c]) => c === HIST_ERRLOG).length;
      const run0 = lab.sim.u32(HIST_RUN), e0 = lab.kernel.errors.length;
      const to = pl.run_input({ type: 'key', id: 'lv', action: 'down' });
      const t = tras(to), sw = to.switch;
      ok(run0 === 1 && sw.native && sw.changed && t.includes(TRA_HIST_STOP) && t.indexOf(TRA_HIST_STOP) < t.indexOf(TRA_OUTPUT)
        && lab.sim.u32(OPENED) === OPEN_EVF && lab.props.get(lab.prop_device) === PROP_EVF && lab.sim.u32(HIST_RUN) === 0 && !hist(e0) && s.device === 'evf',
        `camapp 3: LV with the histogram running (${run0}) is the firmware's own change: TRA ${TRA_HIST_STOP} before TRA ${TRA_OUTPUT} (${t.filter((x) => x !== 944)}), opened ${h8(lab.sim.u32(OPENED))}, property ${lab.props.get(lab.prop_device)}, run word ${lab.sim.u32(HIST_RUN)}, ${h8(HIST_ERRLOG)} logged ${hist(e0)} time(s), device ${s.device}`);
      const a15 = s.a15_apply('evf'), c = lab.compose('evf', true, false), errs = c.errors.filter((e) => e.name !== 'PAL_UNWRITTEN');
      ok(a15.verdict === 'closed' && errs.length === 3 && errs.every((e) => e.name === 'PLANC_UNOBSERVED' && e.value === EVF_PLANC),
        `camapp 3: the EVF's composite (A15 ${a15.verdict}) stops at the three OSD planes' PLANC ${h8(EVF_PLANC)}: ${JSON.stringify(errs.map((e) => [e.name, h8(e.value)]))}`);
      const back = pl.run_input({ type: 'key', id: 'lv', action: 'down' }), tb = tras(back);
      let frame = null;
      try { frame = s.frame(); } catch (e) { frame = e.message.slice(0, 200); }
      ok(back.switch.changed && tb.includes(TRA_OUTPUT) && tb.indexOf(TRA_OUTPUT) < tb.indexOf(TRA_HIST_START) && lab.sim.u32(OPENED) === OPEN_TFT
        && lab.props.get(lab.prop_device) === PROP_TFT && lab.sim.u32(HIST_RUN) === 1 && !hist(e0) && Array.isArray(frame),
        `camapp 3: LV back: TRA ${TRA_OUTPUT} before TRA ${TRA_HIST_START} (${tb.filter((x) => x !== 944)}), opened ${h8(lab.sim.u32(OPENED))}, property ${lab.props.get(lab.prop_device)}, run word ${lab.sim.u32(HIST_RUN)}, the TFT's frame ${Array.isArray(frame) ? `${frame[0]} x ${frame[1]}` : frame}`);
      s.set(EYE_SWITCH_PROPERTY, 0);
      const eye = pl.run_input({ type: 'key', id: 'eye', action: 'down' });
      ok(eye.switch.native && eye.switch.changed === false && /property 1947 reads 0/.test(eye.switch_unmade ?? '') && s.device === 'tft'
        && lab.sim.u32(OPENED) === OPEN_TFT && !tras(eye).includes(TRA_OUTPUT),
        `camapp 3: the eye sensor with property ${EYE_SWITCH_PROPERTY} at 0 makes no output change: ${JSON.stringify(eye.switch_unmade)}, device ${s.device}, opened ${h8(lab.sim.u32(OPENED))}, TRAs ${tras(eye).filter((x) => x !== 944)}`);
      // 1947 back at 1: the eye state is still the EVF's, the setter publishes nothing and nothing changes, which has
      // no reason read and stops the step (not recorded as not made)
      s.set(EYE_SWITCH_PROPERTY, 1);
      let stop = null;
      try { pl.run_input({ type: 'key', id: 'lv', action: 'down' }); } catch (e) { stop = e; }
      ok(stop?.constructor.name === 'PlayError' && /state 2 -> 2\) with property 1947 at 1: no reason read/.test(stop.message),
        `camapp 3: LV with property ${EYE_SWITCH_PROPERTY} back at 1 after the eye sensor's unmade switch stops: ${stop?.constructor.name} ${stop?.message.slice(0, 240)}`);
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
  // camapp 3 from the Super Control Panel (switch-scp's inputs): the application's change goes to the shooting screen
  {
    const pl = player(true, 'auto'), s = pl.session, lab = s.lab, reads = [];
    try {
      for (const a of CHANGE_OUTLINE_READS) watch(lab, a, (l, r) => reads.push([h8(a), r.d0 | 0]), 'test: ChangeOutline\'s module-9 read');
      for (const [id, action] of [['ok', 'down'], ['ok', 'up']]) pl.run_input({ type: 'key', id, action });
      const run = lab.sim.u32(HIST_RUN), gui0 = s.status().gui, got = [], m9 = [], opened = [];
      for (const id of ['lv', 'eye']) {
        const m0 = lab.module9_reads.length;
        const rec = pl.run_input({ type: 'key', id, action: 'down' });
        got.push(rec.switch.screen.to[0]);
        opened.push(lab.sim.u32(OPENED));
        m9.push(lab.module9_reads.slice(m0).map(([, site]) => h8(site)));
      }
      // every module-9 read of the switches: to the EVF ChangeOutline's pair; back, the application's pair twice
      // before it and twice after
      const want = [CHANGE_OUTLINE_READS, [...APP_TEST_READS, ...APP_TEST_READS, ...CHANGE_OUTLINE_READS, ...APP_TEST_READS, ...APP_TEST_READS]].map((l) => l.map(h8));
      ok(JSON.stringify(m9) === JSON.stringify(want), `camapp 3 from the Super Control Panel: the switches' module-9 reads ${JSON.stringify(m9)}, want ${JSON.stringify(want)}`);
      ok(gui0 === GUI_SCP && run === 0 && got.every((g) => g === GUI_SHOOTING) && opened.join() === [OPEN_EVF, OPEN_TFT].join()
        && JSON.stringify(reads) === JSON.stringify(CHANGE_OUTLINE_READS.map((a) => [h8(a), 0]).flatMap((x, i, all) => i ? [] : [...all, ...all])),
        `camapp 3 from the Super Control Panel (${gui0}, the histogram's run word ${run}): LV and the eye switch land on ${got} (want the shooting screen ${GUI_SHOOTING}), opened ${opened.map(h8)}, ChangeOutline's reads ${JSON.stringify(reads)}`);
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

export async function leverSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, watch } = await setup();
  for (const camapp3 of [true, false]) {
    const tag = camapp3 ? 'camapp 3' : 'camapp 1';
    const pl = player(camapp3, 'off'), s = pl.session, lab = s.lab, ca = s.camapp;
    const hits = { power: 0, standby: 0, nothing: 0, unset: 0, shut: 0 };
    try {
      s.idle_slice(lab.lab_time() + 500e6);
      watch(lab, SQP_POWER_EVENT, () => { hits.power += 1; }, 'test: APPEVENT_CAMST_POWER');
      watch(lab, SQP_STANDBY_BRANCH, () => { hits.standby += 1; }, 'test: the sequence word\'s other branch');
      watch(lab, SQP_POWER_NOTHING, () => { hits.nothing += 1; }, 'test: the power code\'s return');
      watch(lab, SQP_ERRSEQ_UNSET, () => { hits.unset += 1; }, 'test: no error sequence set');
      watch(lab, SHUT_DOWN, () => { hits.shut += 1; }, 'test: CameraCommon::shutDown');
      const phase = () => (lab.sim.u32(SEQ_CONTROLLER) ? lab.sim.u32(SEQ_PHASE) : null);
      const p0 = phase(), w0 = lab.sim.u32(SQP_WORD);
      const rec = s.switch_input('power', 1 - s.bit_of('power'));
      ca.pump();
      for (let k = 0; k < 30; k++) s.idle_slice(lab.lab_time() + 50e6);
      const sent = ca.tra_native.filter(([id]) => id === TRA_SHUTDOWN).length, codes = rec.uiin.map((u) => u.code);
      const all = Object.values(hits).join();
      if (camapp3) {
        ok(codes.join() === '0x0202000c' && all === '1,1,1,1,0' && w0 === 0 && sent === 0 && p0 === PHASE_STANDBY && phase() === PHASE_STANDBY,
          `${tag}: the lever's off (${codes}) with the sequence word ${w0}: the sequence parts' handler, the standby branch, the power code's return and no error sequence ${all} time(s) (want 1,1,1,1 and shutDown 0); 1.5 s on: TRA ${TRA_SHUTDOWN} sent ${sent} time(s), the phase ${p0} -> ${phase()}`);
      } else {
        ok(codes.join() === '0x0202000c' && all === '0,0,0,0,0' && p0 === null,
          `${tag}: the lever's off (${codes}) with no sequence parts (phase ${p0}): handler, branches and shutDown ${all}`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

export async function standbySession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { player, watch } = await setup();
  for (const control of [false, true]) {
    const tag = control ? 'control (the reader not listed)' : 'camapp 3';
    const pl = player(true, 'off'), s = pl.session, lab = s.lab, read = [];
    try {
      watch(lab, STANDBY_READ, (l, r) => read.push([r.d0 | 0, l.sim.u32(STANDBY_WORD)]), 'test: the standby entry\'s module-9 read');
      if (control && !lab.takeover_allowed.delete(STANDBY_READ)) throw new Error('the standby entry\'s read is not in the S-TAKEOVER scope');
      for (const [id, action] of [['s1', 'down'], ['s2', 'down'], ['s2', 'up'], ['s1', 'up']]) pl.run_input({ type: 'key', id, action });
      const before = read.length;
      let err = null;
      try { for (const value of [1, 0]) pl.run_input({ type: 'switch', id: 'fw_121c', value }); } catch (e) { err = e; }
      if (!control) {
        ok(!err && before === 0 && JSON.stringify(read) === JSON.stringify([[0, 1]]) && s.status().gui === GUI_SHOOTING,
          `${tag}: a lens attach after a shot: the standby entry reads module 9's state ${JSON.stringify(read)} (want [[0, 1]]: the components' 0 with its word set), ${before} read(s) before it; ${err ? err.message.slice(0, 200) : `GUI ${s.status().gui}`}`);
      } else {
        ok(err && new RegExp(`S-TAKEOVER scope: module 9 state read from \\S+ \\(disasm 0x${STANDBY_READ.toString(16)}\\)`).test(err.message),
          `${tag}: the same step stops at the scope guard: ${err?.message.slice(0, 200)}`);
      }
    } catch (e) { bad.push(`${tag}: ${e.message.slice(0, 600)}`); }
    try { pl.close_session(); } catch { /* the session stopped */ }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  const run = async (name, fn) => (!only || only === name ? fn() : { checks: 0, bad: [] });
  const p = await run('power', powerOffSession), l = await run('lever', leverSession), e = await run('evf', evfSwitchSession), b = await run('standby', standbySession);
  console.log(`camapp 3's power-off: ${p.checks - p.bad.length}/${p.checks}; the lever's off in the components: ${l.checks - l.bad.length}/${l.checks}; camapp 3's display switch: ${e.checks - e.bad.length}/${e.checks}; the standby entry's module-9 read: ${b.checks - b.bad.length}/${b.checks}`);
  [...p.bad, ...l.bad, ...e.bad, ...b.bad].forEach((x) => console.log('  ', x));
  process.exit(p.bad.length || l.bad.length || e.bad.length || b.bad.length ? 1 : 0);
}
