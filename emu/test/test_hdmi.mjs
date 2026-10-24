// The HDMI port (src/dev/hdmi.mjs, src/lab/edid.mjs, the play option --hdmi on and its input hdmi; docs/hle-gaps.md
// 4.9):
//   hdmiUnits    without firmware: no port without the machine's option; the sink's EDID blocks sum to 0; the plug
//                raises the sink's lines (0x08 bits 3, 4), the pin's level and its status bit, IRQ 109 follows status &
//                enable and a write clears the status bits it names; the lane word keeps the lanes it names; an E-DDC
//                read (command 130) fills the DDC buffer from the sink's EDID at 256 x segment + offset, sets 0x94 bits
//                7 and 5 at once, and IRQ 239 follows 0x90 & 0x98, the summary's bit 4 0x94 & 0x9c; the buffer reads by
//                bytes and words; refused: a plug without an EDID, a second plug, another doorbell store or a read of
//                it, another DDC command, a read past the EDID, a write to 0x08 or 0x90, an unknown word, a halfword,
//                another lane word, a write to the pin's level word
//   hdmiSession  (firmware; the model of OM_EMU_MODEL, E143 by default) a play session with --hdmi on lists H-GIOSLOTS,
//                S-HDMISINK and A-HDMI-1, has the pin's IRQ 109 attached at level 5 by the display init and IRQ 239
//                not yet; hdmi plug: the CPU takes IRQ 109 and then IRQ 239 for each of the two E-DDC reads, IRQ 239 is
//                attached at level 5 (the HDMI init ran), the driver's EDID state reads 0xf0, UI_IN forwards the
//                connect report 0x02020501 and the camera application sends DISPLAY cmd 18; on E143 the parse's fields
//                as decoded (manufacturer, product, serial, date, version, the name, the extension count, the CTA-861
//                header bits and the VIC list); a second plug, an unplug and fw_0501 are refused; a negative control
//                with the base block's checksum off by one: six reads of block 0, the errlog 0x37009108 and 0x37008206,
//                EDID state 0xff, and the connect report still sent
//   node emu/test/test_hdmi.mjs [--session]      (OM_EMU_MODEL=E146 node emu/test/test_hdmi.mjs --session: another body)
import { createMachine, HDMI_WINDOW, HDMI_DOORBELL } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { PLUG, EDID, W_EDID_LEN, W_DDC_READS } from '../src/dev/hdmi.mjs';
import { sinkEdid, SINK_NAME, SINK_VICS } from '../src/lab/edid.mjs';
import { EXPECTED_ERRLOG } from '../src/lab/display.mjs';

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
  ok(throwsAs(() => bell((PLUG << 24) >>> 0), BUS) && throwsAs(() => hdmi.doorbell(HDMI_DOORBELL, 2 << 24, 4, false), BUS), 'a second plug and another doorbell store are bus errors');
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
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { HANDLER_TABLE } = await import('../src/lab/irq.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 };
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
  ok(JSON.stringify(taken) === JSON.stringify([hpd.irq, irq, irq]), `${MODEL}: the CPU takes IRQ ${hpd.irq}, then IRQ ${irq} for each E-DDC read: ${JSON.stringify(taken)}`);
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
  for (const [inp, want] of [[{ type: 'hdmi', action: 'plug' }, /in already/], [{ type: 'hdmi', action: 'unplug' }, /not modelled \(A-HDMI-1/], [{ type: 'switch', id: 'fw_0501', value: 1 }, /firmware's own/]]) {
    let e = null;
    try { pl.run_input(inp); } catch (x) { e = x; }
    ok(e?.name === 'ValueError' && want.test(e.message), `${MODEL}: ${JSON.stringify(inp)} is refused: ${e?.message ?? 'accepted'}`);
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
  pl.close_session();
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
  process.exitCode = n ? 1 : 0;
}
