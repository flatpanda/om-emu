// The Fn lever and the AF mode in the default session (docs/hle-gaps.md 4.3.8; E143, control camapp 1):
//   fnLeverSession  the idle image has the lever at API_LEVER_SW_1 (the lever read 0), the factory lever function
//                  (MODE_LEVER_SWITCH_TYPE 4) and MODE_AF_CHANGE 0, the S-AF bank; S-SEQSTANDBY answers
//                  OlyHfwOpeShoot's standby gate from the start, and only the gate (the lab's own call of the phase
//                  query reads 100).
//                  S1 in S-AF posts START_FOCUS, END_FOCUS(1) and the AF lock, and S-SCENE's lens focuses; the lever
//                  to API_LEVER_SW_2 writes MODE_AF_CHANGE 1 and the property MODE_FOCUS reads 1, MF; S1 then posts no
//                  focus callback, sets READY's and READY_FINISH's bits with no isFocus, uploads no AF OSD and leaves
//                  the lens where it is, and S2 takes its picture; with S1 held the gate refuses the lever (the
//                  sequence is not in standby) and after the release the next change is taken; back in S-AF with the
//                  half-press AF off (MODE_HALF_RELEASE_AF_SAF 0) S1 posts none either; with the mode dial at M the
//                  gate's third caller, getShutterSpeedLimit, gets the standby answer
//   fnLeverSequenceSession  the evidence S-RELSEQ's rule rests on, in the firmware's own sequence (control camapp 3,
//                  after a menu pass, where S1 reaches READY): at API_LEVER_SW_2 READY's entry runs the StartFocus
//                  sender, which builds no evTraResShtStartFocus (TRA 1323); at API_LEVER_SW_1 it builds one; the
//                  lever's change to API_LEVER_SW_2 sends the focus mode change's transactions, the ones camapp 1's
//                  lever sends to S-TRAACK
//   node emu/test/test_fnlever.mjs [lever|sequence]
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// The lever read (OlyHfwOpeCamCom 0x50abdd4b: 0 API_LEVER_SW_1, 1 API_LEVER_SW_2), the property getter and the
// shooting phase query; the returns of the standby gate's three calls (d0 the gate's answer): the two forms of
// Shooting::setFocusModeChange and OlyHfwLowApiWrap::getShutterSpeedLimit (D)
const LEVER_READ = 0x50ABDD4B, PROP_GET = 0x503EE3BF, SHOOT_PHASE = 0x50AB57E9;
const GATE_FOCUS = 0x50ADFBE1, GATE_FOCUS_2 = 0x50ADFB53, GATE_SHUTTER = 0x50AC4799;
// the settings (the names are the resource block's): the lever's function and the AF bank it selects, the two banks'
// still focus modes, the focus mode in use (the property reads the store's 0 as 0, S-AF, and its 2 as 1, MF: X), the
// half-press AF of S-AF
const LEVER_TYPE = 534, AF_CHANGE = 535, FOCUS_STILL = 289, FOCUS_CHANGE_STILL = 536, FOCUS = 25, HALF_AF_SAF = 1933;
const LEVER_MODE2 = 4, STORE_SAF = 0, STORE_MF = 2, PROP_SAF = 0, PROP_MF = 1;
// the shared take status's word 0 (getter 0x50ab5716) and the take information's isFocus (camapp.mjs TAKE_STATUS_SET)
const TAKE_STATUS_GET = 0x50AB5716, TAKE_IS_FOCUS = 0x62AF6E28, SEQ_READY = 2, SEQ_READY_FINISH = 4;
// S-SCENE's AF point on the signpost at 1.5 m (test_scene.mjs), and a distance set by hand
const AF_POINT = [0.72, 0.35], SIGNPOST_M = 1.5, HAND_M = 5;
// the sequence parts' StartFocus sender, the builder of TRA 1323 it calls where its test passes, READY's phase
const START_FOCUS_SENDER = 0x50CAD835, BUILD_1323 = 0x50AF2775, PHASE_READY = 102;
// The transaction exec's two entries (camapp.mjs TRA_EXEC_CALLS / CALL: a1 the request, its id at +4) and what a
// change of the focus mode sends through them (X): 974, then OlyHfwOpeShoot::setAelState's 958 and 1515 (returns
// 0x50adf18c, 0x50adf209), endMfAssist's 955 (0x50ad7c3b) and 974 again; 944 is the histogram's, about five a second,
// and 994 OlyHfwUserSettingManager's own from task 162, which only the HLS components' sessions send
const TRA_EXEC = [0x50AF7CB9, 0x50AF7CBE], TRA_HIST = 944, TRA_USER_SETTING = 994, FOCUS_CHANGE_TRAS = [974, 958, 1515, 955, 974];

async function setup() {
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  return (camapp3) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
    pl.camapp_components = camapp3; pl.camapp_native_tra = camapp3;
    pl.open_session();
    const s = pl.session, lab = s.lab;
    const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
    const call = (fn, regs = {}) => lab.call(fn, regs, null, null, 2000000).d0;
    // a key action as the player runs it: the session's step, then S-SCENE's; [the step's camapp log, the scene's
    // record]
    const key = (id, action) => { const rec = s.key(id, action); const sc = s.scene_key(id, action); s.camapp.pump(); return [rec.camapp.map(([k, d]) => `${k}: ${d}`), sc]; };
    const lever = (v) => { s.switch_input('lever', v); s.camapp.pump(); idle(1000); };
    // the transactions handed to the exec, but the histogram's and the user setting manager's own
    const tras = [];
    for (const pc of TRA_EXEC) lab.wrap(pc, (prev) => (h, r) => { tras.push(lab.sim.u32((r.a1 >>> 0) + 4) & 0xFFFF); prev(h, r); });
    const sent = () => tras.splice(0).filter((id) => id !== TRA_HIST && id !== TRA_USER_SETTING);
    return { pl, s, lab, idle, call, key, lever, sent };
  };
}

export async function fnLeverSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return { checks, bad };                       // the lever's idle state and the stand-in are E143's
  const open = await setup(), { pl, s, lab, idle, call, key, lever, sent } = open(false);
  try {
    const gates = [];
    for (const [pc, name] of [[GATE_FOCUS, 'focus'], [GATE_FOCUS_2, 'focus2'], [GATE_SHUTTER, 'shutter']]) lab.observe(pc, (l, r) => gates.push(`${name} ${r.d0}`), `obs-gate-${name}`);
    const focus = () => [lab.get(AF_CHANGE), lab.get(FOCUS), call(PROP_GET, { d0: FOCUS })];
    const take = () => [call(TAKE_STATUS_GET, { d0: 0 }) & (SEQ_READY | SEQ_READY_FINISH), lab.sim.u32(TAKE_IS_FOCUS)];
    const cbs = (log) => log.filter((l) => /^(cbs|afosd): /.test(l));
    idle(2000);
    // the start
    const st = s.status(), used0 = pl.stand_ins_in_use();
    ok(st.bits.lever === 1 && call(LEVER_READ) === 0 && lab.get(LEVER_TYPE) === LEVER_MODE2 && lab.get(FOCUS_STILL) === STORE_SAF && lab.get(FOCUS_CHANGE_STILL) === STORE_MF,
      `the start: the lever's bit ${st.bits.lever}, read as ${call(LEVER_READ)} (want 0, API_LEVER_SW_1), the lever function ${lab.get(LEVER_TYPE)}, the banks' still focus modes ${lab.get(FOCUS_STILL)} and ${lab.get(FOCUS_CHANGE_STILL)} (want ${STORE_SAF}, ${STORE_MF})`);
    ok(focus().join() === `0,${STORE_SAF},${PROP_SAF}` && used0.includes('S-SEQSTANDBY') && s.camapp.standby_answers >= 1 && call(SHOOT_PHASE) === 100,
      `the start: MODE_AF_CHANGE, MODE_FOCUS and its property ${focus()} (S-AF); S-SEQSTANDBY listed ${used0.includes('S-SEQSTANDBY')} after ${s.camapp.standby_answers} answer(s) at the gate; the lab's own phase query ${call(SHOOT_PHASE)} (want 100: not the gate's call)`);
    // S1 in S-AF, S-SCENE's live view on
    s.scene_input({ liveview: true });
    s.scene_input({ af_point: AF_POINT, aperture: 1.2, mode: 'manual', focus_m: HAND_M });
    idle(100);
    let [log, sc] = key('s1', 'down');
    ok(cbs(log).join('|') === 'cbs: START_FOCUS(0)|cbs: END_FOCUS(1)|cbs: AF_LOCK(1)|afosd: indicator 1, 1 frame(s)' && take().join() === '6,1'
      && sc?.af === 'ok' && s.scene.lens.focus_m === SIGNPOST_M && s.camapp.s1_af === true,
      `S-AF, S1 down: ${JSON.stringify(cbs(log))}; READY | READY_FINISH and isFocus ${take()} (want 6,1); S-SCENE ${JSON.stringify(sc)}, the lens at ${s.scene.lens.focus_m} m (want ${SIGNPOST_M})`);
    [log] = key('s1', 'up');
    ok(cbs(log).join('|') === 'cbs: AF_LOCK(0)|afosd: indicator 0, 0 frame(s)' && take().join() === '0,0', `S-AF, S1 up: ${JSON.stringify(cbs(log))}, the bits and isFocus ${take()}`);
    idle(300);
    // the lever to API_LEVER_SW_2: MF
    let n = gates.length;
    sent();
    lever(0);
    const tras2 = sent();
    ok(call(LEVER_READ) === 1 && focus().join() === `1,${STORE_MF},${PROP_MF}` && gates.slice(n).join() === 'focus 1' && tras2.join() === FOCUS_CHANGE_TRAS.join(),
      `the lever to input 0: read as ${call(LEVER_READ)} (API_LEVER_SW_2), MODE_AF_CHANGE, MODE_FOCUS and its property ${focus()} (want 1,${STORE_MF},${PROP_MF}: MF), the gate's calls ${gates.slice(n)}, the transactions ${tras2} (want ${FOCUS_CHANGE_TRAS})`);
    // S1 and S2 in MF: the lens was set by hand
    s.scene_input({ focus_m: HAND_M });
    const images = s.camapp.images.length;
    [log, sc] = key('s1', 'down');
    ok(cbs(log).join('|') === 'cbs: S1 with no half-press AF (the focus mode): no START_FOCUS, no END_FOCUS' && take().join() === '6,0'
      && sc?.half_af === false && s.scene.lens.focus_m === HAND_M && s.camapp.s1_af === false && s.camapp.af_stage === 'finish',
      `MF, S1 down: ${JSON.stringify(cbs(log))}; READY | READY_FINISH and isFocus ${take()} (want 6,0); S-SCENE ${JSON.stringify(sc)}, the lens at ${s.scene.lens.focus_m} m (want ${HAND_M}, as set)`);
    idle(300);
    // the lever while S1 is held: the sequence is not in standby, the gate refuses and MODE_AF_CHANGE stays
    n = gates.length;
    lever(1);
    ok(call(LEVER_READ) === 0 && lab.get(AF_CHANGE) === 1 && gates.slice(n).join() === 'focus 0', `the lever back with S1 held: read as ${call(LEVER_READ)}, MODE_AF_CHANGE ${lab.get(AF_CHANGE)} (want 1, refused), the gate ${gates.slice(n)}`);
    lever(0);
    [log] = key('s2', 'down');
    const shot = cbs(log).join('|');
    idle(100);
    key('s2', 'up');
    [log] = key('s1', 'up');
    idle(1200);
    const cap = s.scene.captures.at(-1);
    ok(/START_SHOOTING_PICTURE\(0\).*START_EXPOSE\(0\)/.test(shot) && s.camapp.images.length === images + 1 && cap?.focus_m === HAND_M && cbs(log).length === 0 && take().join() === '0,0'
      && s.camapp.s1_af === null && s.status().gui === st.gui,
      `MF, S2: ${shot}; ${s.camapp.images.length - images} picture(s), the capture's focus ${cap?.focus_m} m; S1 up: ${JSON.stringify(cbs(log))} (want none), the bits and isFocus ${take()}; the GUI back at ${s.status().gui}`);
    // after the release the lever is taken again
    n = gates.length;
    lever(1);
    ok(focus().join() === `0,${STORE_SAF},${PROP_SAF}` && gates.slice(n).join() === 'focus 1', `the lever to input 1 after the release: ${focus()} (want 0,${STORE_SAF},${PROP_SAF}: S-AF), the gate ${gates.slice(n)}`);
    // S-AF with the half-press AF off: the sequence's test asks MODE_HALF_RELEASE_AF_SAF
    s.set(HALF_AF_SAF, 0); s.camapp.pump();
    s.scene_input({ focus_m: HAND_M });
    [log, sc] = key('s1', 'down');
    ok(lab.get(HALF_AF_SAF) === 0 && cbs(log).join('|') === 'cbs: S1 with no half-press AF (the focus mode): no START_FOCUS, no END_FOCUS' && s.scene.lens.focus_m === HAND_M,
      `S-AF with MODE_HALF_RELEASE_AF_SAF ${lab.get(HALF_AF_SAF)}, S1 down: ${JSON.stringify(cbs(log))}, the lens at ${s.scene.lens.focus_m} m`);
    key('s1', 'up');
    s.set(HALF_AF_SAF, 1); s.camapp.pump();
    [log] = key('s1', 'down');
    ok(/START_FOCUS\(0\).*END_FOCUS\(1\)/.test(cbs(log).join('|')) && s.scene.lens.focus_m === SIGNPOST_M, `with it 1 again, S1 down: ${JSON.stringify(cbs(log))}, the lens at ${s.scene.lens.focus_m} m`);
    key('s1', 'up');
    idle(300);
    // mode M: getShutterSpeedLimit asks the gate; no form of setFocusModeChange but the first ran in the session
    n = gates.length;
    s.switch_input('mode_dial', st.mode_dial_positions.findIndex((p) => p.label === 'M')); s.camapp.pump(); idle(800);
    const m = gates.slice(n);
    ok(m.length > 0 && m.every((g) => g === 'shutter 1') && !gates.includes('focus2 0') && !gates.includes('focus2 1'),
      `mode M: the gate's calls ${JSON.stringify(m)} (want getShutterSpeedLimit's, answered 1); setFocusModeChange's second form ran ${gates.filter((g) => g.startsWith('focus2')).length} times`);
  } catch (e) { bad.push(`session: ${e.message.slice(0, 800)}`); }
  finally { pl.close_session(); }
  return { checks, bad };
}

export async function fnLeverSequenceSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { ON_LAB_MODEL } = await import('../src/fw/model.mjs');
  if (!ON_LAB_MODEL) return { checks, bad };
  const open = await setup();
  for (const [input, name, built] of [[0, 'API_LEVER_SW_2', 0], [1, 'API_LEVER_SW_1', 1]]) {
    const { pl, s, lab, idle, call, lever, sent } = open(true);
    try {
      let senders = 0, builds = 0;
      lab.observe(START_FOCUS_SENDER, () => { senders += 1; }, 'obs-start-focus');
      lab.observe(BUILD_1323, () => { builds += 1; }, 'obs-1323');
      idle(2000);
      for (const k of ['menu', 'menu']) { s.key(k, 'down'); s.camapp.pump(); idle(100); s.key(k, 'up'); s.camapp.pump(); idle(800); }
      sent();
      if (input === 0) lever(0);
      const tras = sent(), want = input === 0 ? FOCUS_CHANGE_TRAS : [];
      const prop = call(PROP_GET, { d0: FOCUS });
      s.key('s1', 'down'); s.camapp.pump();
      const phase = call(SHOOT_PHASE);
      ok(lab.get(AF_CHANGE) === 1 - input && prop === (input ? PROP_SAF : PROP_MF) && tras.join() === want.join(),
        `camapp 3 at ${name}: MODE_AF_CHANGE ${lab.get(AF_CHANGE)}, the property MODE_FOCUS ${prop}, the lever's transactions ${tras} (want ${want})`);
      ok(phase === PHASE_READY && senders === 1 && builds === built,
        `camapp 3 at ${name}, S1 down: phase ${phase} (want ${PHASE_READY}), the StartFocus sender ran ${senders} time(s) and built ${builds} TRA 1323 (want ${built})`);
    } catch (e) { bad.push(`camapp 3 at ${name}: ${e.message.slice(0, 600)}`); }
    finally { pl.close_session(); }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  const run = async (name, fn) => (!only || only === name ? fn() : { checks: 0, bad: [] });
  const l = await run('lever', fnLeverSession), q = await run('sequence', fnLeverSequenceSession);
  console.log(`the Fn lever and the AF mode: ${l.checks - l.bad.length}/${l.checks}; the sequence's StartFocus by the focus mode: ${q.checks - q.bad.length}/${q.checks}`);
  [...l.bad, ...q.bad].forEach((x) => console.log('  ', x));
  process.exit(l.bad.length || q.bad.length ? 1 : 0);
}
