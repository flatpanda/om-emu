// The USB cable at the event level (S-USBCABLE; play.mjs usb_input; docs/hle-gaps/4.10.md 4.10.1, 4.10.2):
//   usbSession  (firmware; OM_EMU_MODEL, E143 by default) a play session: the cable starts in (S-SCPUDEV's PC13 low,
//               active low), so a plug is refused first; usb unplug raises PC13, which posts 0x08 {1}; UI_IN decodes
//               the switch 0x0400 (0x02020400) and the code's two consumers, the application's code filter
//               (0x50abb01d) and 0x50b7a2c4's test (0x50b7a2de), each read module 9 once, where S-TAKEOVER's state 2
//               ends them (E143: the GUI stays in its state, no USB select screen); usb plug
//               drops PC13 again (0x08 {0}), decoded and dropped alike; S-USBCABLE is listed; a second plug is refused
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await usbSession();
  for (const b of r.bad) console.log('FAIL', b);
  console.log(`${r.checks - r.bad.length}/${r.checks} ok`);
  process.exit(r.bad.length ? 1 : 0);
}
