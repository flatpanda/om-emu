// The USB cable at the event level (S-USBCABLE; play.mjs usb_input and USB_IDLE; docs/hle-gaps/4.10.md 4.10.1 to
// 4.10.3):
//   usbSession  (firmware; OM_EMU_MODEL, E143 by default) a play session: the cable starts in (S-SCPUDEV's PC13 low,
//               active low), so a plug is refused first; usb unplug raises PC13, which posts 0x08 {1}; UI_IN decodes
//               the switch 0x0400 (0x02020400) and the code's two consumers, the application's code filter
//               (0x50abb01d) and 0x50b7a2c4's test (0x50b7a2de), each read module 9 once, where S-TAKEOVER's state 2
//               ends them (E143: the GUI stays in its state, no USB select screen); usb plug
//               drops PC13 again (0x08 {0}), decoded and dropped alike; S-USBCABLE is listed; a second plug is refused
//   usbIdleSessions  (below) sessions started with no cable (USB_IDLE 'out'): the lever's off followed from the
//               application's own shutdown, plug and unplug from there, and the 'in' control
//   node emu/test/test_usbcable.mjs
const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e instanceof cls) return true; throw e; } };

export async function usbSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { ValueError } = await import('../src/lab/errors.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab, state0 = lab.state();
  ok(lab.scpu_dev.scan.PC13 === 0 && throwsAs(() => s.usb_input('plug'), ValueError), `${MODEL}: the cable starts in (PC13 low) and a plug is refused`);
  // X 2026-11-23 (E143): the filter 0x50abafce (0x50abb01d) and 0x50b7a2c4 (0x50b7a2de) read module 9, S-TAKEOVER's
  // 2 ends both; the GUI stays in its state and no USB select screen is reached (docs/hle-gaps/4.10.md 4.10.2)
  for (const [action, level, report] of [['unplug', 1, '0x8f'], ['plug', 0, '0x8f']]) {
    const r = pl.run_input({ type: 'usb', action });
    console.log(MODEL, action, JSON.stringify(r.usb), r.error ?? '');
    ok(!r.error && lab.scpu_dev.scan.PC13 === level && r.usb?.frames.includes(report), `${MODEL}: ${action}: PC13 ${level}, its report polled: ${JSON.stringify(r.usb)} ${r.error ?? ''}`);
    ok(r.usb?.uiin_codes.includes('0x2020400'), `${MODEL}: ${action}: UI_IN decoded the switch 0x0400: ${JSON.stringify(r.usb)}`);
    if (MODEL === 'E143') {
      ok(JSON.stringify(r.usb?.module9) === '["0x50abb01d","0x50b7a2de"]',
        `E143: ${action}: the code's two consumers read module 9 once each, 0x50abb01d and 0x50b7a2de (state 2 ends both before their second read): ${JSON.stringify(r.usb?.module9)}`);
      ok(lab.state() === state0, `E143: ${action}: the GUI stays at 0x${state0.toString(16)}: 0x${lab.state().toString(16)}`);
    }
  }
  ok(pl.stand_ins_in_use().includes('S-USBCABLE'), `${MODEL}: S-USBCABLE listed`);
  ok(throwsAs(() => s.usb_input('plug'), ValueError), `${MODEL}: a second plug is refused`);
  return { checks, bad };
}

// (firmware; a body that runs its power-off, E143 by default) USB_IDLE 'out' (play.mjs; docs/hle-gaps/4.10.md
// 4.10.3), three sessions:
//   the lever's off with no cable: the sub-CPU's PC13 high from the start, an unplug refused, S-SHUTDOWN not listed;
//     the application calls shutDown(1, 1) itself in the lever's step (E143 from 0x5107f160) and startShutDown once
//     (E143 from 0x50abe7e7), H-POWER follows it to the last write: 0x85 {1, 0, 0} answered, the request word 127,
//     S-SCPUDEV in standby (PC13 high at its 0x85 handler's message 6), the session closed
//   plug then unplug from 'out': PC13 low then high, each reported (0x8f) and decoded as 0x02020400; on E143 the two
//     module-9 reads 0x50abb01d and 0x50b7a2de each time and the GUI kept; a second unplug refused
//   the control, 'in': the lever's off through S-SHUTDOWN as before (no follow, the sub-CPU in bkground)
export async function usbIdleSessions() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { ValueError } = await import('../src/lab/errors.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  if (!MODEL_INFO.power_native) return { checks, bad, skipped: [`${MODEL}: no native power-off`] };
  // a Player whose sessions start at the USB level given (OM_USB_IDLE, read at each session's start)
  const open = (idle) => {
    const was = process.env.OM_USB_IDLE;
    process.env.OM_USB_IDLE = idle;
    try {
      const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
      pl.open_session();
      return pl;
    } finally { if (was === undefined) delete process.env.OM_USB_IDLE; else process.env.OM_USB_IDLE = was; }
  };
  const OFF_FRAMES = JSON.stringify([{ cmd: '0x85', data: '010000', reply: '0585010001' }]);
  // the lever's off with no cable
  {
    const pl = open('out'), s = pl.session, dev = s.lab.scpu_dev, used = pl.stand_ins_in_use();
    ok(s.usb_idle === 'out' && dev.scan.PC13 === 1 && throwsAs(() => s.usb_input('unplug'), ValueError) && !used.includes('S-SHUTDOWN') && used.includes('H-POWER'),
      `${MODEL} out: PC13 high at the start (${dev.scan.PC13}), an unplug refused, S-SHUTDOWN not listed: ${used.filter((x) => /POWER|SHUTDOWN/.test(x))}`);
    let rec = null, err = null;
    try { rec = pl.power('off'); } catch (e) { err = e; }
    const off = rec?.power_off, follow = off?.follow ?? [];
    console.log(MODEL, 'out: lever off', JSON.stringify(off), err?.message.split('\n')[0] ?? '');
    const sd = follow.filter((c) => c.fn === 'shutDown'), st = follow.filter((c) => c.fn === 'startShutDown');
    ok(!err && sd.length === 1 && st.length === 1 && sd[0].mode === 1 && sd[0].reason === 1,
      `${MODEL} out: the application's shutDown(1, 1) and startShutDown once each: ${JSON.stringify(follow)} ${err?.message.split('\n')[0] ?? ''}`);
    if (MODEL === 'E143') {
      ok(/disasm 0x5107f160/.test(sd[0]?.from) && /disasm 0x50abe7e7/.test(st[0]?.from),
        `E143 out: shutDown from 0x5107f160, startShutDown from 0x50abe7e7: ${JSON.stringify(follow)}`);
    }
    ok(JSON.stringify(off?.frames) === OFF_FRAMES && off?.request_word === 127 && off?.ready === 0 && off?.scpu.power === 'standby' && pl.session === null && pl.phase === 'off',
      `${MODEL} out: 0x85 {1, 0, 0} answered, the request word 127, pin 102 low, the sub-CPU in standby, the session closed (${pl.phase}): ${JSON.stringify(off)}`);
  }
  // plug, then unplug, from 'out'
  {
    const pl = open('out'), s = pl.session, lab = s.lab, state0 = lab.state();
    for (const [action, level] of [['plug', 0], ['unplug', 1]]) {
      const r = pl.run_input({ type: 'usb', action });
      console.log(MODEL, 'out:', action, JSON.stringify(r.usb), r.error ?? '');
      ok(!r.error && lab.scpu_dev.scan.PC13 === level && r.usb?.frames.includes('0x8f') && r.usb?.uiin_codes.includes('0x2020400'),
        `${MODEL} out: ${action}: PC13 ${level}, its report polled and decoded as 0x02020400: ${JSON.stringify(r.usb)} ${r.error ?? ''}`);
      if (MODEL === 'E143') {
        ok(JSON.stringify(r.usb?.module9) === '["0x50abb01d","0x50b7a2de"]' && lab.state() === state0,
          `E143 out: ${action}: module 9 read at 0x50abb01d and 0x50b7a2de, the GUI at 0x${state0.toString(16)}: ${JSON.stringify(r.usb?.module9)}, 0x${lab.state().toString(16)}`);
      }
    }
    ok(throwsAs(() => s.usb_input('unplug'), ValueError) && pl.stand_ins_in_use().includes('S-USBCABLE'), `${MODEL} out: a second unplug refused, S-USBCABLE listed`);
    pl.close_session();
  }
  // the control: 'in'
  {
    const pl = open('in'), s = pl.session, used = pl.stand_ins_in_use();
    let rec = null, err = null;
    try { rec = pl.power('off'); } catch (e) { err = e; }
    const off = rec?.power_off;
    ok(s.usb_idle === 'in' && used.includes('S-SHUTDOWN') && !err && off && !off.follow && JSON.stringify(off.frames) === OFF_FRAMES && off.scpu.power === 'bkground' && off.request_word === 127,
      `${MODEL} in: the lever's off through S-SHUTDOWN, the sub-CPU in bkground: ${JSON.stringify(off)} ${err?.message.split('\n')[0] ?? ''}`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const [name, fn] of [['USB cable', usbSession], ['USB idle out', usbIdleSessions]]) {
    const r = await fn();
    for (const b of r.bad) console.log('FAIL', b);
    console.log(`${name}: ${r.checks - r.bad.length}/${r.checks} ok${r.skipped?.length ? ` (skipped: ${r.skipped.join('; ')})` : ''}`);
    n += r.bad.length;
  }
  process.exit(n ? 1 : 0);
}
