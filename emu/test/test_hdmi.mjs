// The HDMI port (src/dev/hdmi.mjs, src/lab/edid.mjs, the play option --hdmi on and its input hdmi; docs/hle-gaps/4.9.md
// 4.9):
//   hdmiUnits    without firmware: no port without the machine's option; the sink's EDID blocks sum to 0; the plug
//                raises the sink's lines (0x08 bits 3, 4), the pin's level and its status bit, IRQ 109 follows status &
//                enable and a write clears the status bits it names; the lane word keeps the lanes it names; an E-DDC
//                read (command 130) fills the DDC buffer from the sink's EDID at 256 x segment + offset, sets 0x94 bits
//                7 and 5 at once, and IRQ 239 follows 0x90 & 0x98, the summary's bit 4 0x94 & 0x9c; the buffer reads by
//                bytes and words; refused: a plug without an EDID, a second plug, another doorbell store or a read of
//                it, another DDC command, a read past the EDID, a write to 0x08 or 0x90, an unknown word, a halfword,
//                another lane word, a write to the pin's level word; the open's registers: command 128 to the SCDC's
//                TMDS configuration not acknowledged (0x94 bits 7, 6) and counted, another DDC write refused, UPDCTRL
//                bit 7 sets 0x96 bit 7, the PHY words beside the lane word are storage and the page's other words
//                refused; the unplug drops the lines and the pin and sets 0x92 bits 0..3, an unplug without the cable
//                is refused
//   hdmiSession  (firmware; the model of OM_EMU_MODEL, E143 by default) a play session with --hdmi on lists H-GIOSLOTS,
//                S-HDMISINK and A-HDMI-1, has the pin's IRQ 109 attached at level 5 by the display init and IRQ 239
//                not yet; hdmi plug: the CPU takes IRQ 109 and then IRQ 239 for each of the two E-DDC reads, IRQ 239 is
//                attached at level 5 (the HDMI init ran), the driver's EDID state reads 0xf0, UI_IN forwards the
//                connect report 0x02020501 and the camera application sends DISPLAY cmd 18; on E143 the parse's fields
//                as decoded (manufacturer, product, serial, date, version, the name, the extension count, the CTA-861
//                header bits and the VIC list); on E143, E146 and E147 the output switch (S-OUTDEV): TRA 588 for the
//                HDMI output, DISPLAY cmd 45, the HDMI device alone open in format 13 with its timing, IRQ 239 a third
//                time for the open's update, one SCDC write, S-PROP's property 16, VSC channel 0 latched for 1080p and
//                its composite (the window, no plane drawn), on E146 and E147 with S-HDMIAUD and A-HDMICAL listed; a
//                second plug and fw_0501 are refused; the unplug: IRQ 239 alone, the disconnect report, no errlog, no
//                output change (HDMI stays open), a second unplug refused; a negative control with the base block's
//                checksum off by one: six reads of block 0, the errlog 0x37009108 and 0x37008206, EDID state 0xff, the
//                connect report still sent and (E143, E146, E147) CapIod opening nothing
//   hdmiCamapp3Session  (firmware, E143) control camapp 3 with --hdmi on: the plug's two TRA 588 (the HDMI output,
//                then HDMI and the TFT) answered by the component, S-PROP following CapIod's 16 and 17, the first DISPLAY
//                cmd 45 setting channel 0's line time at its end, the HDMI device and the TFT open, setOutputType's
//                HDMI 1920 x 1080 layout twice, the errlog the palette set's three warnings alone; channel 0 refused
//                without A15 (CTRL3 0x41) and, with it, the GUI's three OSD planes at 1920 x 1080 and its pixels; the
//                unplug back to the TFT (TRA 588, property 1, cmd 45, no errlog) and the TFT's GUI; control: with
//                S-PROP held at the panel's value setOutputType takes its other branch and channel 0 has no plane
//   node emu/test/test_hdmi.mjs [--session] [--camapp3]   (OM_EMU_MODEL=E146 node emu/test/test_hdmi.mjs --session: another body)
import { createMachine, HDMI_WINDOW, HDMI_DOORBELL } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { PLUG, UNPLUG, EDID, W_EDID_LEN, W_DDC_READS, W_SCDC_WRITES } from '../src/dev/hdmi.mjs';
import { sinkEdid, SINK_NAME, SINK_VICS } from '../src/lab/edid.mjs';
import { EXPECTED_ERRLOG, OPENED_WORD } from '../src/lab/display.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const le32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);

function deviceTests(ok) {
  const { irq, hpd } = BOARD.hdmi;
  {
    const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
    ok(m.devices.hdmi === undefined, 'no HDMI port without the machine\'s hdmi option');
  }
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0, hdmi: true });
  const { hdmi, intc } = m.devices, edid = sinkEdid();
  const rd = (o, w = 4) => hdmi.read(o, w, false), wr = (o, v) => hdmi.write(o, v, 4, false);
  // a register byte through the lane word, as the driver's writer does
  const set = (r, b) => { hdmi.laneWrite((((15 & ~(1 << (r & 3))) << 16) | 1) >>> 0, 4, false); wr(r & ~3, (b << (8 * (r & 3))) >>> 0); };
  const bell = (v) => hdmi.doorbell(HDMI_DOORBELL, v, 4, false);
  const sum = (b) => b.reduce((s, x) => s + x, 0) & 255;
  ok(edid.length === 256 && sum(edid.subarray(0, 128)) === 0 && sum(edid.subarray(128)) === 0 && edid[126] === 1, 'the sink\'s two EDID blocks sum to 0 and the base block names one extension');
  ok(sum(sinkEdid({ checksum: false }).subarray(0, 128)) !== 0, 'checksum: false breaks the base block\'s sum');
  ok(rd(0x08) === 0 && hdmi.hpdRead('level', 4, false) === 0 && intc.line[irq] === 0 && intc.line[hpd.irq] === 0, 'with the cable out the sink\'s lines, the pin and both IRQs are low');
  ok(throwsAs(() => bell((PLUG << 24) >>> 0), BUS), 'a plug without the sink\'s EDID in the window is a bus error');
  m.dbgWrite(HDMI_WINDOW + EDID, edid);
  m.dbgWrite(HDMI_WINDOW + W_EDID_LEN, le32(edid.length));
  bell((PLUG << 24) >>> 0);
  ok(rd(0x08) === 0x18 && hdmi.hpdRead('level', 4, false) === hpd.level_bit && hdmi.hpdRead('status', 4, false) === hpd.bit, `the plug raises the sink's lines (0x${rd(0x08).toString(16)}), the pin and its status bit`);
  ok(intc.line[hpd.irq] === 0, 'IRQ 109 stays low while the pin\'s bit is not enabled');
  hdmi.hpdWrite('enable', hpd.bit, 4, false);
  ok(intc.line[hpd.irq] === 1 && hdmi.hpdRead('enable', 4, false) === hpd.bit, 'IRQ 109 is high while status & enable');
  hdmi.hpdWrite('status', hpd.bit, 4, false);
  ok(intc.line[hpd.irq] === 0 && hdmi.hpdRead('status', 4, false) === 0 && hdmi.hpdRead('level', 4, false) === hpd.level_bit, 'a write clears the status bit it names, the IRQ drops, the level stays');
  ok(throwsAs(() => hdmi.hpdWrite('level', 0, 4, false), BUS) && throwsAs(() => hdmi.hpdRead('status', 2, false), BUS), 'a write to the level word and a halfword read are bus errors');
  ok(throwsAs(() => bell((PLUG << 24) >>> 0), BUS) && throwsAs(() => hdmi.doorbell(HDMI_DOORBELL, 3 << 24, 4, false), BUS), 'a second plug and another doorbell store are bus errors');
  set(0x99, 0x57);
  ok(hdmi.reg[0x98] === 0 && hdmi.reg[0x99] === 0x57, 'the lane word keeps the lanes it names: only 0x99 is written');
  set(0x9c, 0xe0); set(0xa80, 0); set(0xa81, 128); set(0xa82, 127);
  set(0xa83, 130);
  ok([...hdmi.reg.subarray(0xc00, 0xc80)].every((b, i) => b === edid[128 + i]) && hdmi.reg[0x94] === 0xa0, 'command 130 copies 128 bytes at 256 x segment + offset into the buffer and sets 0x94 bits 7 and 5');
  ok(m.dbgRead(HDMI_WINDOW + W_DDC_READS, 4)[0] === 1, 'the window counts the read');
  ok((rd(0x90) & 0xff) === 0x10 && intc.line[irq] === 0, 'the summary\'s bit 4 is up; IRQ 239 is low with 0x98 clear');
  set(0x98, 0x57);
  ok(intc.line[irq] === 1, 'IRQ 239 is high while 0x90 & 0x98');
  set(0x94, 0xa0);
  ok(hdmi.reg[0x94] === 0 && (rd(0x90) & 0xff) === 0 && intc.line[irq] === 0, 'a write of 1s clears 0x94 and the IRQ drops');
  ok(rd(0xc00, 1) === edid[128] && rd(0xc04) === (edid[132] | edid[133] << 8 | edid[134] << 16 | edid[135] << 24) >>> 0, 'the buffer reads by bytes and words');
  set(0xa80, 1); set(0xa81, 0);
  ok(throwsAs(() => set(0xa83, 130), BUS), 'a read past the sink\'s EDID is a bus error');
  ok(throwsAs(() => set(0xa83, 128), BUS), 'another DDC command is a bus error');
  ok(throwsAs(() => set(0x08, 1), BUS) && throwsAs(() => set(0x90, 1), BUS), 'a write to 0x08 or 0x90 is a bus error');
  ok(throwsAs(() => rd(0x100), BUS) && throwsAs(() => rd(0x08, 2), BUS) && throwsAs(() => rd(0x09, 1), BUS), 'an unknown word, a halfword and a byte outside the buffer are bus errors');
  ok(throwsAs(() => hdmi.laneWrite(2, 4, false), BUS) && throwsAs(() => hdmi.laneWrite((1 << 20) | 1, 4, false), BUS), 'another lane word is a bus error');
  ok(throwsAs(() => hdmi.doorbell(HDMI_DOORBELL, 0, 4, true), BUS), 'a debugger store to the doorbell is a bus error');
  // the HDMI open's registers: the SCDC write, UPDCTRL's update, the PHY words beside the lane word
  set(0x94, 0xff); set(0xc00, 0); set(0xa80, 0xa8); set(0xa81, 0x20); set(0xa82, 0);
  set(0xa83, 128);
  ok(hdmi.reg[0x94] === 0xc0 && m.dbgRead(HDMI_WINDOW + W_SCDC_WRITES, 4)[0] === 1, `command 128 to the SCDC's TMDS configuration is not acknowledged: 0x94 bits 7 and 6 (0x${hdmi.reg[0x94].toString(16)}), counted`);
  set(0xa81, 0x21);
  ok(throwsAs(() => set(0xa83, 128), BUS), 'another DDC write is a bus error');
  set(0x9e, 0x80);
  set(0x11, 0x17);
  ok(hdmi.reg[0x96] === 0, 'UPDCTRL without bit 7 requests nothing');
  set(0x11, 0x97);
  ok(hdmi.reg[0x96] === 0x80 && (rd(0x90) & 0x40), 'UPDCTRL with bit 7: the update is done at once, 0x96 bit 7 and the summary\'s bit 6');
  const lanes = BOARD.hdmi.lanes, phy = (o) => m.devices.hdmi.phyRead(o, 4, false);
  m.devices.hdmi.phyWrite(0x40, 0x405, 4, false);
  ok(phy(0x40) === 0x405 && phy(0x04) === 0, `the PHY words beside the lane word are storage (0x${lanes.toString(16)} + 0x40)`);
  ok(throwsAs(() => m.devices.hdmi.phyRead(0x08, 4, false), BUS) && throwsAs(() => m.devices.hdmi.phyWrite(0x40, 1, 2, false), BUS), 'another word of the lane page, and a halfword, are bus errors');
  // the unplug: the sink's lines and the pin fall, 0x92 bits 0..3 (A-HDMI-1)
  set(0x9a, 0x0f);
  bell((UNPLUG << 24) >>> 0);
  ok(rd(0x08) === 0 && hdmi.hpdRead('level', 4, false) === 0 && hdmi.reg[0x92] === 0x0f && (rd(0x90) & 0x04), `the unplug drops the sink's lines and the pin and sets 0x92 bits 0..3 (0x${hdmi.reg[0x92].toString(16)})`);
  ok(throwsAs(() => bell((UNPLUG << 24) >>> 0), BUS), 'an unplug without the cable is a bus error');
}

export function hdmiUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  try { deviceTests(ok); } catch (e) { bad.push(`threw: ${e.stack}`); }
  return { checks, bad };
}

// E143's parse of the sink's EDID (D: the base block's parse 0x501d35dc, the CTA-861 parse 0x501d36e4; the state
// byte's getter 0x501d30f6)
const E143_PARSE = { mfg: 0x62a3c7f8, product: 0x62a3c7fa, serial: 0x62a3c7f4, date: 0x62a3c7fc, name: 0x62a3c800,
  ext: 0x62a3c8ed, cea: 0x62a3c810, vics: 0x62a3c818 };

export async function hdmiSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { HANDLER_TABLE } = await import('../src/lab/irq.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const open = () => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, hdmi: 'on' }, env);
    pl.open_session();
    return pl;
  };
  const { irq, hpd } = BOARD.hdmi;
  let pl = open(), s = pl.session, lab = s.lab;
  const intc = lab.nk.intc, attached = (n) => [intc.level(n), lab.sim.u32(HANDLER_TABLE + 4 * n)];
  const used = pl.stand_ins_in_use();
  ok(['H-GIOSLOTS', 'S-HDMISINK', 'A-HDMI-1'].every((x) => used.includes(x)), `${MODEL}: the stand-ins name the port: ${used.filter((x) => /HDMI|GIO/.test(x))}`);
  ok(attached(hpd.irq)[0] === 1 << 5 && attached(hpd.irq)[1] !== 0, `${MODEL}: the display init attached the pin's IRQ ${hpd.irq} at level 5: ${attached(hpd.irq)}`);
  ok(attached(irq)[0] === 0, `${MODEL}: IRQ ${irq} is not attached before the plug`);
  ok(s.hdmi_status().edid_state === '0x0' && s.hdmi_status().cable === 'out', `${MODEL}: before the plug ${JSON.stringify(s.hdmi_status())}`);
  const taken0 = intc.sync().length;
  const rec = pl.run_input({ type: 'hdmi', action: 'plug' });
  const taken = intc.sync().slice(taken0).map((x) => x[0] ?? x).filter((n) => n === irq || n === hpd.irq);
  ok(rec.kind === 'hdmi' && rec.hdmi?.edid_state === '0xf0' && rec.hdmi?.ddc_reads === 2 && rec.hdmi?.cable === 'in', `${MODEL}: the plug ends with the EDID read and parsed: ${JSON.stringify(rec.hdmi)}`);
  // E143, E146, E147 (S-OUTDEV): IRQ 239 a third time for the HDMI open's update (UPDCTRL, "Update Done"); E146 and
  // E147 with the calibration word taken as set (A-HDMICAL) and AUD_EXEC's reply answered (S-HDMIAUD)
  const opens = ['E143', 'E146', 'E147'].includes(MODEL), calib = MODEL !== 'E143';
  ok(JSON.stringify(taken) === JSON.stringify([hpd.irq, irq, irq, ...(opens ? [irq] : [])]), `${MODEL}: the CPU takes IRQ ${hpd.irq}, then IRQ ${irq} for each E-DDC read${opens ? ' and for the open\'s update' : ''}: ${JSON.stringify(taken)}`);
  ok(attached(irq)[0] === 1 << 5 && attached(irq)[1] !== 0, `${MODEL}: the HDMI init attached IRQ ${irq} at level 5: ${attached(irq)}`);
  ok(JSON.stringify(rec.uiin_codes) === '["0x02020501"]', `${MODEL}: UI_IN forwards the connect report: ${JSON.stringify(rec.uiin_codes)}`);
  ok((rec.dispq ?? []).some((d) => d.cmd === 18), `${MODEL}: the camera application sends DISPLAY cmd 18: ${JSON.stringify(rec.dispq ?? [])}`);
  // the logs the lab expects (display.mjs EXPECTED_ERRLOG: E143's movie time query with the card native) aside
  const own = Object.keys(rec.errlog ?? {}).filter((c) => !EXPECTED_ERRLOG.has(parseInt(c, 16)));
  ok(own.length === 0, `${MODEL}: no errlog: ${JSON.stringify(rec.errlog)}`);
  if (MODEL === 'E143') {
    const rd = (a, n) => [...lab.sim.read(a, n)], P = E143_PARSE, edid = sinkEdid();
    ok(JSON.stringify(rd(P.mfg, 2)) === JSON.stringify([edid[8], edid[9]]) && JSON.stringify(rd(P.product, 2)) === JSON.stringify([edid[10], edid[11]]),
      `E143: manufacturer and product as the EDID's bytes 8..11: ${rd(P.mfg, 4)}`);
    ok(JSON.stringify(rd(P.serial, 4)) === JSON.stringify([...edid.subarray(12, 16)]) && JSON.stringify(rd(P.date, 4)) === JSON.stringify([...edid.subarray(16, 20)]),
      `E143: the serial, week, year, version and revision: ${rd(P.serial, 8)}`);
    ok(String.fromCharCode(...rd(P.name, 13)) === `${SINK_NAME}\n`.padEnd(13, ' '), `E143: the 13 bytes of the third descriptor's text: ${JSON.stringify(String.fromCharCode(...rd(P.name, 13)))}`);
    ok(rd(P.ext, 1)[0] === 1, `E143: one extension: ${rd(P.ext, 1)}`);
    ok(JSON.stringify(rd(P.cea, 8)) === JSON.stringify([2, 3, 20, 0, 1, 1, 1, 1]), `E143: the CTA-861 tag, revision, timing offset, underscan, basic audio, YCbCr 4:4:4 and 4:2:2, native timings: ${rd(P.cea, 8)}`);
    ok(JSON.stringify(rd(P.vics, 6)) === JSON.stringify([SINK_VICS.length, 0x80 | SINK_VICS[0], ...SINK_VICS.slice(1)]), `E143: the VIC count and list: ${rd(P.vics, 6)}`);
  }
  if (opens) {
    // the output switch (S-OUTDEV): TRA 588 for the HDMI output, CapIod's open natively (DISPLAY cmd 45), the HDMI
    // device alone open in format 13 (VIC 16, 1080p at 59.94 Hz), the SCDC write, S-PROP following CapIod's 16
    const outdev = (rec.camapp ?? []).filter(([k]) => k === 'outdev').map(([, x]) => x);
    ok(outdev.some((x) => /^TRA 588: event 224 \{8, 0, 0\}/.test(x)) && outdev.some((x) => /property 4513 = 16/.test(x)), `${MODEL}: S-OUTDEV took TRA 588 for the HDMI output: ${JSON.stringify(outdev)}`);
    ok((rec.dispq ?? []).some((d) => d.cmd === 45) && lab.sim.u32(OPENED_WORD) === 0x0d000004, `${MODEL}: DISPLAY cmd 45 opened the HDMI device alone: ${JSON.stringify(rec.dispq)}, opened 0x${lab.sim.u32(OPENED_WORD).toString(16)}`);
    // (S-OUTDEV runs at the step's end, after the step's record took the port's status)
    const st = s.hdmi_status();
    ok(JSON.stringify(st.open) === JSON.stringify({ period_us: 16683, vtotal: 1125, line_ns: 14829, format: 13 }) && st.scdc_writes === 1, `${MODEL}: the open's format and timing, one SCDC write: ${JSON.stringify(st)}`);
    ok(lab.props.get(lab.prop_device) === 16, `${MODEL}: S-PROP's output-device property follows CapIod's write: ${lab.props.get(lab.prop_device)}`);
    ok(['S-OUTDEV', ...(calib ? ['S-HDMIAUD', 'A-HDMICAL'] : [])].every((x) => pl.stand_ins_in_use().includes(x)), `${MODEL}: the stand-ins list S-OUTDEV${calib ? ', S-HDMIAUD and A-HDMICAL' : ''}: ${pl.stand_ins_in_use().filter((x) => /OUTDEV|HDMI/.test(x))}`);
    s.idle_slice(lab.lab_time() + 100e6);
    const b = lab.vsc.bank(0, true), x = (n) => b.get(n) >>> 0;
    ok(x('SYNC1') === 0x1000001 && x('SYNC2') === 1125 && x('SYNC3') === 5 && x('SYNC6') === ((44 << 16) | 2200) && x('VIDEOAREA1') === ((192 << 16) | 1920) && x('VIDEOAREA2') === ((41 << 16) | 1080) && x('DMAEN') === 0,
      `${MODEL}: VSC channel 0 latched for 1080p: ${JSON.stringify(Object.fromEntries(['SYNC1', 'SYNC2', 'SYNC3', 'SYNC6', 'VIDEOAREA1', 'VIDEOAREA2', 'DMAEN'].map((n) => [n, '0x' + x(n).toString(16)])))}`);
    const c = lab.compose('hdmi', true, true), hd = c.header;
    ok(c.status === 'NONE' && hd.width === 1920 && hd.height === 1080 && hd.ox === 192 && hd.oy === 41 && hd.drawn === 0 && c.errors.length === 1 && c.errors[0].name === 'UNWRITTEN' && c.errors[0].offset === 0x4e0,
      `${MODEL}: channel 0 composes its 1920 x 1080 window at (192, 41), no plane drawn (OSDCP2 unwritten): ${c.status} ${JSON.stringify(hd)} ${JSON.stringify(c.errors)}`);
  }
  for (const [inp, want] of [[{ type: 'hdmi', action: 'plug' }, /in already/], [{ type: 'switch', id: 'fw_0501', value: 1 }, /firmware's own/]]) {
    let e = null;
    try { pl.run_input(inp); } catch (x) { e = x; }
    ok(e?.name === 'ValueError' && want.test(e.message), `${MODEL}: ${JSON.stringify(inp)} is refused: ${e?.message ?? 'accepted'}`);
  }
  // the unplug (A-HDMI-1): IRQ 239 (the pin's interrupt is off since the plug), both pairs' callbacks, the hot-plug
  // handler finds detect low and sends the disconnect report; the HDMI device stays open (D/X: nothing switches back)
  const t1 = intc.sync().length, e1 = lab.kernel.errors.length;
  const un = pl.run_input({ type: 'hdmi', action: 'unplug' });
  const taken1 = intc.sync().slice(t1).map((x) => x[0] ?? x).filter((n) => n === irq || n === hpd.irq);
  ok(un.kind === 'hdmi' && un.hdmi?.cable === 'out' && JSON.stringify(un.uiin_codes) === '["0x02020501"]', `${MODEL}: the unplug ends with the disconnect report: ${JSON.stringify(un.hdmi)} ${JSON.stringify(un.uiin_codes)}`);
  ok(JSON.stringify(taken1) === JSON.stringify([irq]), `${MODEL}: the unplug's interrupt is IRQ ${irq} alone: ${JSON.stringify(taken1)}`);
  const own1 = lab.kernel.errors.slice(e1).filter(([c]) => !EXPECTED_ERRLOG.has(c)).map(([c]) => '0x' + c.toString(16));
  ok(own1.length === 0 && !(un.camapp ?? []).some(([k]) => k === 'outdev'), `${MODEL}: no errlog and no output change after the unplug: ${JSON.stringify(own1)}`);
  if (opens) ok(lab.sim.u32(OPENED_WORD) === 0x0d000004, `${MODEL}: the HDMI device stays open: 0x${lab.sim.u32(OPENED_WORD).toString(16)}`);
  {
    let e = null;
    try { pl.run_input({ type: 'hdmi', action: 'unplug' }); } catch (x) { e = x; }
    ok(e?.name === 'ValueError' && /out already/.test(e.message), `${MODEL}: a second unplug is refused: ${e?.message ?? 'accepted'}`);
  }
  pl.close_session();
  // the negative control: the base block's checksum off by one, the plug made the input's way by hand
  pl = open(); s = pl.session; lab = s.lab;
  const edid = sinkEdid({ checksum: false }), e0 = lab.kernel.errors.length, c0 = lab.uiin_codes.length;
  lab.sim.write(HDMI_WINDOW + EDID, edid);
  lab.sim.write(HDMI_WINDOW + W_EDID_LEN, le32(edid.length));
  lab.cpu_store(HDMI_DOORBELL, (PLUG << 24) >>> 0);
  s.idle_slice(lab.lab_time() + 100e6);
  const errs = lab.kernel.errors.slice(e0).filter(([c]) => !EXPECTED_ERRLOG.has(c)).map(([c]) => '0x' + c.toString(16));
  ok(s.hdmi_status().ddc_reads === 6 && s.hdmi_status().edid_state === '0xff', `${MODEL}: a bad checksum: six reads of block 0, EDID state 0xff: ${JSON.stringify(s.hdmi_status())}`);
  ok(JSON.stringify(errs) === JSON.stringify(['0x37009108', '0x37008206']), `${MODEL}: the errlog of the read and of the hot-plug handler: ${JSON.stringify(errs)}`);
  ok(lab.uiin_codes.slice(c0).some(([, c]) => c === 0x02020501), `${MODEL}: the connect report is still sent: ${JSON.stringify(lab.uiin_codes.slice(c0))}`);
  // the application still asks for the HDMI output (S-OUTDEV), and CapIod opens nothing (X)
  if (opens) ok(s.camapp.outdev_done.length === 1 && lab.sim.u32(OPENED_WORD) === 1, `${MODEL}: after a failed EDID read CapIod opens nothing: ${JSON.stringify(s.camapp.outdev_done)}, opened 0x${lab.sim.u32(OPENED_WORD).toString(16)}`);
  pl.close_session();
  return { checks, bad };
}

// Control camapp 3 (E143; docs/hle-gaps/4.9.md 4.9.3): setOutputType's branch for the device state 12, "HDMI&ANOTHER
// HDMI_SIZE_HDMI_1920X1080" (D: the print's string 0x6132a9b0 at run time, loaded at this site), and the palette
// set's warning for a palette already set (0x501dc789..0x501dc7a0: errlog 0x3700140c (3, 4171, device code, palette))
const SET_OUTPUT_HDMI = 0x510C4F1D, PALETTE_AGAIN = 0x3700140C, HDMI_CODE = 0x0D000004;
const nonBackground = (raw, bg) => {
  const px = new Uint32Array(raw.buffer, raw.byteOffset, raw.length >> 2);
  let n = 0;
  for (const p of px) if ((p & 0xFFFFFF) !== bg) n++;
  return [n, px.length];
};
export async function hdmiCamapp3Session() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad: [`control camapp 3's HDMI output is E143's here, not ${MODEL}'s`] };
  const env = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, hdmi: 'on' }, env);
  pl.camapp_components = true; pl.camapp_native_tra = true;
  pl.open_session();
  const s = pl.session, lab = s.lab, ca = s.camapp;
  const idle = (ms) => { const to = lab.lab_time() + ms * 1e6; while (lab.lab_time() < to) s.idle_slice(Math.min(to, lab.lab_time() + 50e6)); };
  const own = (e0) => lab.kernel.errors.slice(e0).filter(([c]) => !EXPECTED_ERRLOG.has(c));
  let layouts = 0;
  lab.observe(SET_OUTPUT_HDMI, () => { layouts++; }, 'test: setOutputType\'s HDMI layout');
  ca.tra_native.splice(0);
  const e0 = lab.kernel.errors.length;
  // the plug; then 2 s, past the display's 1 s guard between two device changes (0x62a3541c, set by the open at
  // 0x501c3d17, cleared by its 1000 ms timer's handler 0x501c5075, X), which a DISPLAY run in the lab waits out in
  // vain (errlog 0x37003119, 0x501c3cc1)
  const rec = pl.run_input({ type: 'hdmi', action: 'plug' });
  idle(2000);
  const tra = ca.tra_native.splice(0).filter(([id]) => id === 588);
  ok(tra.length === 2 && tra.every(([, , res]) => res === 0) && !ca.outdev_done.length && !pl.stand_ins_in_use().includes('S-OUTDEV'),
    `the plug's two TRA 588 (the HDMI output, then HDMI and the TFT) answered 0 by the component, no S-OUTDEV: ${JSON.stringify(tra)}`);
  const follow = (rec.camapp ?? []).filter(([k, x]) => k === 'outdev' && /^S-PROP: property \d+ = /.test(x)).map(([, x]) => +x.match(/= (\d+)/)[1]);
  ok(JSON.stringify(follow) === '[16,17]' && lab.props.get(lab.prop_device) === 17, `S-PROP follows CapIod's writes 16, 17: ${JSON.stringify(follow)}, now ${lab.props.get(lab.prop_device)}`);
  const opens = (rec.dispq ?? []).filter((d) => d.cmd === 45);
  ok(opens.length === 2 && JSON.stringify(opens[0].hdmi_line) === JSON.stringify({ period_us: 16683, vtotal: 1125, line_ns: 14829, format: 13 }) && !opens[1].hdmi_line,
    `two DISPLAY cmd 45, the first opening the HDMI device and setting channel 0's line time at its end: ${JSON.stringify(opens.map((d) => d.hdmi_line ?? null))}`);
  ok(lab.sim.u32(OPENED_WORD) === (HDMI_CODE | 1) >>> 0, `the HDMI device and the TFT open: 0x${lab.sim.u32(OPENED_WORD).toString(16)}`);
  ok(layouts === 2, `setOutputType lays the GUI out for HDMI 1920 x 1080 at each change (${SET_OUTPUT_HDMI.toString(16)}): ${layouts}`);
  // the second open re-sends the HDMI device's palettes while they are still marked set (X; whether the camera logs
  // them too is open: docs/hle-gaps/4.9.md 4.9.3)
  const errs = own(e0).map(([c, , a]) => [c, ...a.slice(0, 4)]);
  ok(JSON.stringify(errs) === JSON.stringify([0, 1, 2].map((i) => [PALETTE_AGAIN, 3, 4171, HDMI_CODE, i])),
    `the errlog: the palette set's warning for the HDMI device's palettes 0..2 alone: ${JSON.stringify(errs.map((x) => x.map((v) => '0x' + (v >>> 0).toString(16))))}`);
  // channel 0: latched CTRL3 0x41, which A13 refuses; with A15 (the session's --a15 on) the GUI's three planes
  const b = lab.vsc.bank(0, true), bg = b.get('BG') >>> 0;
  const c0 = lab.compose('hdmi', true, true);
  ok(c0.status === 'FEATURE_UNOBSERVED' && c0.errors.length === 1 && c0.errors[0].offset === 8 && c0.errors[0].value === 0x41,
    `without A15 channel 0's CTRL3 0x41 is refused: ${c0.status} ${JSON.stringify(c0.errors)}`);
  lab.vsc.set_assume(0, lab.vsc.assumed(0) | 1);
  const c = lab.compose('hdmi', true, true), hd = c.header;
  const planes = ['OSD1', 'OSD2', 'OSD3'].map((p) => c.planes[p]);
  const [n, total] = c.raw.length ? nonBackground(c.raw, bg) : [0, 0];
  ok(c.status === 'NONE' && hd.width === 1920 && hd.height === 1080 && hd.ox === 192 && hd.oy === 41 && (hd.assumed & 1) && hd.drawn > 0
    && c.errors.every((e) => e.name === 'PAL_UNWRITTEN'),
    `channel 0 composes its 1920 x 1080 window at (192, 41) under A15 with planes drawn: ${c.status} ${JSON.stringify(hd)} ${JSON.stringify(c.errors)}`);
  ok(planes.every((p) => p?.result === 'drawn' && p.w === 1920 && p.h === 1080), `the GUI's three OSD planes at 1920 x 1080: ${JSON.stringify(c.planes)}`);
  ok(n > total / 100 && n < total / 2, `the GUI's pixels on channel 0 (background 0x${bg.toString(16)}): ${n} of ${total}`);
  // the unplug: the application's own change back to the TFT (TRA 588, CapIod's property 1, DISPLAY cmd 45)
  const e1 = lab.kernel.errors.length;
  const un = pl.run_input({ type: 'hdmi', action: 'unplug' });
  idle(1000);
  const tra1 = ca.tra_native.splice(0).filter(([id]) => id === 588);
  const follow1 = (un.camapp ?? []).filter(([k, x]) => k === 'outdev' && /^S-PROP: property \d+ = /.test(x)).map(([, x]) => +x.match(/= (\d+)/)[1]);
  ok(tra1.length === 1 && tra1[0][2] === 0 && JSON.stringify(follow1) === '[1]' && lab.sim.u32(OPENED_WORD) === 1 && (un.dispq ?? []).filter((d) => d.cmd === 45).length === 1,
    `the unplug returns to the TFT: TRA 588 ${JSON.stringify(tra1)}, property ${JSON.stringify(follow1)}, opened 0x${lab.sim.u32(OPENED_WORD).toString(16)}, ${JSON.stringify((un.dispq ?? []).map((d) => d.cmd))}`);
  ok(own(e1).length === 0, `no errlog at the unplug: ${JSON.stringify(own(e1).map(([x]) => '0x' + x.toString(16)))}`);
  let tft = null;
  try { tft = s.frame('next', true); } catch (e) { bad.push(`the TFT's frame after the unplug: ${e.message}`); }
  if (tft) {
    const [m, all] = nonBackground(tft[2], lab.vsc.bank(2, true).get('BG') >>> 0);
    ok(tft[0] === 900 && tft[1] === 600 && m > all / 100, `the TFT shows the GUI again: ${tft[0]} x ${tft[1]}, ${m} of ${all} pixels not background`);
  }
  pl.close_session();
  // the control: S-PROP held at the panel's value through the plug (its follow refused): getDisplayDeviceState reads
  // 1, setOutputType takes the branch 0x510c5531 and lays nothing out on channel 0
  const cl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true, hdmi: 'on' }, env);
  cl.camapp_components = true; cl.camapp_native_tra = true;
  cl.open_session();
  {
    const s2 = cl.session, lab2 = s2.lab;
    Object.defineProperty(s2.camapp, 'prop_follow', { get: () => false, set: () => {} });
    let hdmi2 = 0, other2 = 0;
    lab2.observe(SET_OUTPUT_HDMI, () => { hdmi2++; }, 'test: setOutputType\'s HDMI layout');
    lab2.observe(0x510C5531, () => { other2++; }, 'test: setOutputType\'s other branch');
    cl.run_input({ type: 'hdmi', action: 'plug' });
    const c2 = lab2.compose('hdmi', true, true);
    ok(hdmi2 === 0 && other2 === 1 && c2.status === 'NONE' && c2.header.drawn === 0,
      `control, S-PROP not following: no HDMI layout (${hdmi2}, other branch ${other2}), channel 0 without planes: ${c2.status} ${JSON.stringify(c2.header)}`);
  }
  cl.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = hdmiUnits();
  console.log(`HDMI port units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const r = await hdmiSession();
    console.log(`HDMI plug in play: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  if (process.argv.includes('--camapp3')) {
    const r = await hdmiCamapp3Session();
    console.log(`HDMI under control camapp 3: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
