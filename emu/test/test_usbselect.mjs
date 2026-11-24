// The USB plug under control camapp 3 toward the PC select screen (E143; docs/hle-gaps/4.10.md 4.10.2, 4.10.4):
//   usbSelectSession(host)  (firmware, E143) a control camapp 3 session started with the cable out (the Player's
//               usb_start 'out': PC13 high before UI_IN's module init, so the start decodes nothing); usb plug drops
//               PC13, UI_IN decodes 0x02020400, CA_MAIN looks up OLY_USB_CONNECTED (0x01060000, 0x51049f69) and the
//               shooting state's handler 0x51065a27 runs. Control (host false): the USB driver's state query
//               0x5102b555 is S-MODACK's, nothing is written, the handler ends without command 38 and the GUI stays
//               at 0x0108. With S-USBHOST (host true): the state query reads 1, the handler issues command 38
//               PC_START_PC_USB_SELECT (CA's parameter trace, case 38 at 0x5105d4e4), the GUI goes to 0x0105
//               ID_ST_WARNING ("One Moment"), the PC application's sub-app SubAppStatePc starts and runs startPc
//               (0x51061b50: setUsbControlType, connect), and then waits: 2 s on the GUI is still at 0x0105 (the
//               open: what the sub-app waits for there, 4.10.4)
//   node emu/test/test_usbselect.mjs [control|host]
const h8 = (v) => '0x' + (v >>> 0).toString(16);
// CA_MAIN's event name lookup (d0 the code), OLY_USB_CONNECTED; the shooting state's handler for it; the case of
// command 38 in CA's parameter trace 0x5105d291; SubAppStatePc's startPc (D; docs/hle-gaps/4.10.md 4.10.2, 4.10.4)
const CA_LOOKUP = 0x51049F69, USB_CONNECTED = 0x01060000, USB_HANDLER = 0x51065A27, PARAM_38 = 0x5105D4E4, START_PC = 0x51061B50;
const GUI_SHOOTING = 0x0108, GUI_WARNING = 0x0105;

export async function usbSelectSession(host) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { USB_STATE_WORD } = await import('../src/lab/play.mjs');
  if (MODEL !== 'E143') return { checks, bad: [`the USB select path is E143's here, not ${MODEL}'s`] };
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.camapp_components = true; pl.camapp_native_tra = true;
  pl.usb_start = 'out'; pl.usb_host = host;
  pl.open_session();
  const s = pl.session, lab = s.lab, tag = host ? 'S-USBHOST' : 'control';
  const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
  const hits = new Map([[USB_HANDLER, 0], [PARAM_38, 0], [START_PC, 0]]);
  for (const a of hits.keys()) lab.observe(a, () => hits.set(a, hits.get(a) + 1), `test: ${h8(a)}`);
  let connected = 0;
  lab.observe(CA_LOOKUP, (l, r) => { if ((r.d0 >>> 0) === USB_CONNECTED) connected++; }, 'test: CA_MAIN lookup');
  ok(lab.scpu_dev.scan.PC13 === 1 && lab.state() === GUI_SHOOTING, `${tag}: the session starts with the cable out (PC13 high) on the shooting screen: PC13 ${lab.scpu_dev.scan.PC13}, GUI ${h8(lab.state())}`);
  const r = pl.run_input({ type: 'usb', action: 'plug' });
  console.log(tag, 'plug', JSON.stringify(r.usb), r.error ?? '', [...hits].map(([a, n]) => `${h8(a)}:${n}`).join(' '));
  ok(!r.error && r.usb?.uiin_codes.includes('0x2020400') && lab.scpu_dev.scan.PC13 === 0, `${tag}: the plug drops PC13 and UI_IN decodes 0x02020400: ${JSON.stringify(r.usb)} ${r.error ?? ''}`);
  ok(connected >= 1 && hits.get(USB_HANDLER) >= 1, `${tag}: CA_MAIN takes OLY_USB_CONNECTED and its handler ${h8(USB_HANDLER)} runs: ${connected}, ${hits.get(USB_HANDLER)}`);
  const state = lab.sim.read(USB_STATE_WORD, 2), used = pl.stand_ins_in_use();
  if (!host) {
    ok(hits.get(PARAM_38) === 0 && lab.state() === GUI_SHOOTING, `control: no command 38, the GUI stays at 0x0108: ${hits.get(PARAM_38)}, ${h8(lab.state())}`);
    ok(!used.includes('S-USBHOST') && used.includes('S-USBCABLE'), `control: S-USBCABLE listed, S-USBHOST not: ${used.filter((x) => x.startsWith('S-USB'))}`);
    return { checks, bad };
  }
  ok((state[0] | state[1] << 8) === 1 && s.usb_host?.answers.length >= 1, `S-USBHOST: the driver's state ${h8(USB_STATE_WORD)} reads 1 after its answers: ${state[0] | state[1] << 8}, ${s.usb_host?.answers.length}`);
  ok(hits.get(PARAM_38) >= 1 && lab.state() === GUI_WARNING, `S-USBHOST: command 38 PC_START_PC_USB_SELECT is issued and the GUI goes to 0x0105 ("One Moment"): ${hits.get(PARAM_38)}, ${h8(lab.state())}`);
  ok(hits.get(START_PC) === 1, `S-USBHOST: the PC application's SubAppStatePc runs startPc once: ${hits.get(START_PC)}`);
  ok(used.includes('S-USBHOST') && used.includes('S-USBCABLE'), `S-USBHOST and S-USBCABLE listed: ${used.filter((x) => x.startsWith('S-USB'))}`);
  // X 2026-11-24: nothing the lab runs answers what the sub-app waits for after startPc (docs/hle-gaps/4.10.md 4.10.4)
  idle(2000);
  ok(lab.state() === GUI_WARNING, `S-USBHOST: 2 s on the GUI is still at 0x0105 (what the PC application waits for is open): ${h8(lab.state())}`);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  let checks = 0, bad = [];
  for (const host of [false, true]) {
    if (which && which !== (host ? 'host' : 'control')) continue;
    const r = await usbSelectSession(host);
    checks += r.checks; bad = bad.concat(r.bad);
  }
  for (const b of bad) console.log('FAIL', b);
  console.log(`${checks - bad.length}/${checks} ok`);
  process.exit(bad.length ? 1 : 0);
}
