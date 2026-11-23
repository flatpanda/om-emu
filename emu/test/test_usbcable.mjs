// The USB cable at the event level (S-USBCABLE; play.mjs usb_input; docs/hle-gaps.md 4.10.1):
//   usbSession  (firmware; OM_EMU_MODEL, E143 by default) a play session: usb plug sets the sub-CPU model's PC13, which
//               posts 0x08 {1}; UI_IN decodes the switch 0x0400 (0x02020400); the step records the GUI state after
//               it (E143: unchanged, the select screen is not reached); S-USBCABLE is listed; usb unplug leaves the GUI in the state before the plug; a second unplug is
//               refused
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
  const plug = pl.run_input({ type: 'usb', action: 'plug' });
  console.log(MODEL, 'plug', JSON.stringify(plug.usb), plug.error ?? '');
  ok(plug.usb?.frames.includes('0x8f') || plug.usb?.uiin_codes.length > 0, `${MODEL}: the plug reached UI_IN: ${JSON.stringify(plug.usb)}`);
  // X 2026-11-22 (E143): the GUI stays in its state; the USB select screen is not reached (docs/hle-gaps.md 4.10.1)
  ok(plug.usb?.uiin_codes.includes("0x2020400"), `${MODEL}: UI_IN decoded the switch 0x0400 on the plug: ${JSON.stringify(plug.usb)}`);
  ok(pl.stand_ins_in_use().includes('S-USBCABLE'), `${MODEL}: S-USBCABLE listed`);
  const un = pl.run_input({ type: 'usb', action: 'unplug' });
  console.log(MODEL, 'unplug', JSON.stringify(un.usb), un.error ?? '');
  ok(lab.state() === state0, `${MODEL}: the unplug returns to GUI state 0x${state0.toString(16)}: 0x${lab.state().toString(16)}`);
  ok(throwsAs(() => s.usb_input('unplug'), ValueError), `${MODEL}: a second unplug is refused`);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await usbSession();
  for (const b of r.bad) console.log('FAIL', b);
  console.log(`${r.checks - r.bad.length}/${r.checks} ok`);
  process.exit(r.bad.length ? 1 : 0);
}
