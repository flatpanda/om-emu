// The lens on the mount natively (src/dev/lensssc.mjs, src/dev/dpc.mjs, src/lab/lensmcu.mjs, src/lab/lens.mjs;
// docs/hle-gaps.md 4.4.2):
//   lensUnits    without firmware: the controller (a lens-less mount's detect pin reads high, a mounted one low; a
//                start with no lens, or of a mode the driver does not use, is a bus error; a frame's header, its data
//                for the data-carrying modes only, the reply into the receive FIFO or by DMA into memory, the count,
//                the status bits 7, 8, 11 and IRQ 14 following status & enable, write 1 to clear; the DMA abort's bit
//                9; an unknown word, a halfword, a write to the count and a debugger write refused; the FCS and
//                mechanism units' words), the deferred-call triggers (a word written 1 holds its IRQ high until written
//                0; another value is refused), and S-LENSMCU (the start's replies at the lengths their parsers read,
//                with the check byte of the classes 0x8x and 0xcx; the characteristics block's fields; the state's
//                zoom step and aperture; the zoom ring's nearest step; an unknown frame or state parameter refused,
//                named)
//   lensSession  (firmware: E143, or E146 / E147 with OM_EMU_MODEL) a play session with the native lens (env.lens
//                'native'): its stand-ins listed and S-LENS not, the lens's start
//                (the frames in the driver's order, then the state poll), IRQ 14 attached at level 3 by the lens open,
//                the driver's record filled from the replies (ID, name, zoom steps, wide and tele, the zoom entries,
//                the status word, the zoom step S-SCENE's default focal length gives, the aperture), the driver's
//                35 mm focal lengths derived natively from it (24, 80, 50 mm; E146 and E147 at S-SCENE's default
//                step, 12 mm: 24, 80, 24), the zoom ring at 40 mm (the state's last step, 80 mm), no error log; on a
//                body with the touch panel (E143) a touch on the shooting screen forwarded to the GUI by the application
//                itself, the GUI's two answers taken natively and no lab post (S-TOUCHMAP, S-CAFWD not in use), then OK
//                opening the Super Control Panel and S1 returning; the lens lock pin switch
//                pressed (fw_121c): the lens detached (the data-valid and attach flags 0, the aperture shown as none),
//                released: the lens's start again and the flags back
//   node emu/test/test_lens.mjs [--session]      (OM_EMU_MODEL=E146 node emu/test/test_lens.mjs --session: another body)
import { createMachine } from '../src/machine.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { LensMcu, LENS_1240, LensError } from '../src/lab/lensmcu.mjs';

const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };
const SSC = BOARD.lens.ssc;

function deviceTests(ok) {
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { lens, dpc, intc, bus } = m.devices, irq = BOARD.lens.irq;
  const rd = (o, w = 4) => lens.read(o, w, false), wr = (o, v, w = 4) => lens.write(o, v, w, false);
  ok(lens.pinRead(0, 4, false) === 0x10, 'a mount with no lens: the detect pin reads high');
  lens.mount(true);
  ok(lens.pinRead(0, 4, false) === 0, 'a lens on the mount: the detect pin reads low');
  ok(throwsAs(() => lens.pinWrite(0, 1, 4, false), BUS), 'a store to the detect pin\'s level word is a bus error');
  wr(0x34, 1057); wr(0x48, 0x0000f6c0);
  ok(throwsAs(() => wr(0x38, 1), BUS), 'a start with no lens connected is a bus error');
  const seen = [];
  lens.connect({ frame: (f) => { seen.push(f); return f.code === 0xf6 ? Uint8Array.of(1, 2, 3, 4, 5) : f.code === 0xee ? new Uint8Array(200) : null; } });
  wr(0x34, 99);
  ok(throwsAs(() => wr(0x38, 1), BUS), 'a frame of a mode the driver does not use is a bus error');
  // a FIFO frame of a data-less mode: the stale data count is not sent
  wr(0x34, 1057); wr(0x44, 5); wr(0x5c, 0x04030201); wr(0x60, 5); wr(0x0c, 959); wr(0x18, 0); wr(0x38, 1);
  ok(seen.length === 1 && seen[0].cls === 0xc0 && seen[0].code === 0xf6 && seen[0].tx.length === 0 && !seen[0].dma, `the frame's header and no data for mode 1057: ${JSON.stringify(seen[0])}`);
  ok(rd(0x40) === 5 && [0, 1, 2, 3, 4].every((i) => rd(0xe4 + i, 1) === i + 1), 'the reply in the receive FIFO, its count at +0x40');
  ok(rd(0x08) === 0x880 && intc.line[irq] === 1, `status bits 7 and 11, IRQ ${irq} high: ${rd(0x08).toString(16)}`);
  wr(0x08, 0x880);
  ok(rd(0x08) === 0 && intc.line[irq] === 0, 'a write of 1s clears the status and the IRQ drops');
  // a data frame (mode 9761) and its data
  wr(0x34, 9761); wr(0x48, 0x0000f060); wr(0x38, 1);
  ok(seen[1].cls === 0x60 && JSON.stringify([...seen[1].tx]) === '[1,2,3,4,5]' && rd(0x08) === 0x80, `mode 9761 sends its 5 data bytes, no reply: status 0x${rd(0x08).toString(16)}`);
  wr(0x08, 0xffff);
  // a DMA frame
  const at = 0xa31d18c0;
  wr(0x34, 1057); wr(0x48, 0x0000f6c0); wr(0x18, 1); wr(0x20, ((at >>> 6) << 2) >>> 0); wr(0x38, 1);
  const got = new Uint8Array(5); bus.read(at, got);
  ok(JSON.stringify([...got]) === '[1,2,3,4,5]' && rd(0x08) === 0x980 && seen[2].dma, `the reply DMA-ed to ${at.toString(16)}, status bits 7, 8, 11: 0x${rd(0x08).toString(16)}`);
  wr(0x08, 0xffff);
  wr(0x1c, 1);
  ok(rd(0x08) === 0x200 && intc.line[irq] === 1, 'the DMA abort raises bit 9');
  wr(0x08, 0x200);
  wr(0x18, 0); wr(0x48, 0x0000eec0);
  ok(throwsAs(() => wr(0x38, 1), BUS), 'a reply longer than the receive FIFO without DMA is a bus error');
  ok(throwsAs(() => rd(0x50), BUS) && throwsAs(() => rd(0x08, 2), BUS) && throwsAs(() => wr(0x40, 1), BUS) && throwsAs(() => lens.write(0x0c, 1, 4, true), BUS),
    'an unknown word, a halfword, a write to the count and a debugger write are bus errors');
  const units = Object.fromEntries(BOARD.lens.units.map((u, k) => [u.name, [u, k]]));
  const [fcs, kf] = units.fcs, [mec, km] = units.mec;
  lens.unitAccess(kf, 'write', fcs.base + 0x68, 0, 4, false);
  lens.unitAccess(km, 'write', mec.base + 0x20, 0x05040e0d, 4, false);
  ok(lens.unitAccess(km, 'read', mec.base + 0x20, 0, 4, true) === 0x05040e0d, 'the mechanism unit\'s word keeps its write (a debugger read)');
  ok(throwsAs(() => lens.unitAccess(km, 'read', mec.base + 0x20, 0, 4, false), BUS) && throwsAs(() => lens.unitAccess(kf, 'write', fcs.base + 4, 0, 4, false), BUS),
    'a CPU read of a unit\'s word and a write to another word are bus errors');
  // the deferred-call triggers
  const [i53, i54] = BOARD.dpc.irqs;
  dpc.write(4, 1, 4, false);
  ok(intc.line[i54] === 1 && intc.line[i53] === 0, 'a trigger word written 1 raises its IRQ');
  dpc.write(4, 0, 4, false);
  ok(intc.line[i54] === 0, 'written 0 it drops');
  ok(throwsAs(() => dpc.write(0, 2, 4, false), BUS) && throwsAs(() => dpc.write(0, 1, 4, true), BUS), 'another value and a debugger write are bus errors');
}

function mcuTests(ok) {
  const mcu = new LensMcu(LENS_1240);
  const f = (cls, code, p1 = 0, p2 = 0, tx = new Uint8Array(0), mode = 1057, dma = true) => mcu.frame({ cls, code, p1, p2, tx, mode, count: 0, dma });
  ok(f(0, 0, 0, 0, undefined, 7) === null, 'the wake-up: no reply');
  const v = f(0xc0, 0xf6);
  ok(JSON.stringify([...v]) === JSON.stringify([0x0a, 0x13, 0xf4, 0x01, 0]), `id 1: the version, the clock and the check byte: ${[...v]}`);
  const idn = f(0xc1, 0xf9);
  ok(idn.length === 21 && JSON.stringify([...idn.subarray(0, 6)]) === JSON.stringify(LENS_1240.id), `id 3: the ID first, 20 bytes and the check byte: ${idn.length}`);
  const n = LENS_1240.zoom.length, ch = f(0xc3, 0xf0, 0, 1);
  const u16 = (b, o) => b[o] | b[o + 1] << 8;
  const name = String.fromCharCode(...ch.subarray(10, 42)).replace(/\0+$/, '');
  ok(name === LENS_1240.name && ch[42] === n && u16(ch, 48) === 12 && u16(ch, 50) === 40, `id 64: the name, the steps, wide and tele: ${JSON.stringify([name, ch[42], u16(ch, 48), u16(ch, 50)])}`);
  ok(JSON.stringify(Array.from({ length: n }, (_, i) => u16(ch, 66 + 2 * i))) === JSON.stringify(LENS_1240.zoom) && u16(ch, 66 + 2 * n) === LENS_1240.ap[0], 'id 64: the zoom entries\' focal lengths, then their apertures');
  // the size the driver's check wants (0x502b0a2c): 66 + 16n + 72 + 4n + 4 + 720 + 44 (k = 0) + 72, plus the +1840 column's n bytes as u16, the check byte
  ok(ch.length === 66 + 16 * n + 72 + 5 * n + 4 + 720 + 44 + 72 + 1, `id 64: the block's length ${ch.length}`);
  ok(f(0xc1, 0xfe).length === n + 1 && f(0x81, 0xe4).length === 2 * n + 1 && f(0xc2, 0xf3).length === 34 * n + 1, 'ids 71, 76, 7: per zoom step');
  ok(f(0x60, 0xf0, 0, 0, new Uint8Array(5), 9761, false) === null, 'type 3 command 101: no reply');
  ok(mcu.setFocal(25) && mcu.focal() === 25 && !mcu.setFocal(26), 'the zoom ring takes the nearest step, and a change only once');
  const st = f(0xc1, 0x80, 0, 6);
  ok(st.length === 31 && (st[0] | st[1] << 8 | st[2] << 16) === 0x8000 && st[4] === 4 && u16(st, 8) === LENS_1240.ap[0], `id 69: the status, the zoom step 4, the aperture: ${[...st.subarray(0, 12)]}`);
  ok(throwsAs(() => f(0xc1, 0x80, 1, 6), LensError) && throwsAs(() => f(0xc1, 0x77), LensError), 'another state parameter and an unknown frame are refused');
  let msg = '';
  try { f(0xc1, 0x77, 2, 3); } catch (e) { msg = e.message; }
  ok(/c1 77 \[02 03\]/.test(msg), `the refusal names the frame: ${msg}`);
}

export function lensUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  try { deviceTests(ok); } catch (e) { bad.push(`device threw: ${e.stack}`); }
  try { mcuTests(ok); } catch (e) { bad.push(`S-LENSMCU threw: ${e.stack}`); }
  return { checks, bad };
}

// the driver's record (its pointer 0xa32caa8c, at the port's place; fields from the record dump 0x50118662,
// 0x50118ab7, 0x50118d20) and the 35 mm focal lengths it derives (0x50129a3e / 0x50129980 / 0x501299a2: wide, tele,
// now), by body: E146's at E143's words, E147's the words its derives store (D: E146 0x50129d8b, 0x50129d95,
// 0x50129ccc; E147 0x50133bb0, 0x50133bba, 0x50133af1), which the port does not place (no lab literal)
const RECORD_PTR = 0xA32CAA8C;
const FOCAL = { E143: [0xA32D4BB0, 0xA32D4BB4, 0xA32D4BB8], E146: [0xA32D4BB0, 0xA32D4BB4, 0xA32D4BB8], E147: [0xA32D3D48, 0xA32D3D4C, 0xA32D3D50] };
const START = ['00 00', 'b0 f2', 'c0 f6', 'c0 f4', 'a0 f5', 'c1 f9', 'c1 02', 'c3 f0', 'c2 f3', 'c1 fe', '81 e4', 'c1 01', 'c1 2f', '60 f0', 'c1 80'];

export async function lensSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { HANDLER_TABLE } = await import('../src/lab/irq.mjs');
  const { EXPECTED_ERRLOG } = await import('../src/lab/display.mjs');
  const { A, MODEL } = await import('../src/fw/model.mjs');
  const focal = FOCAL[MODEL];
  if (!focal) return { checks: 1, bad: [`${MODEL}: no native lens here (the bodies with one: ${Object.keys(FOCAL)})`] };
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000, lens: 'native' };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  pl.open_session();
  const s = pl.session, lab = s.lab, L = s.lens, used = pl.stand_ins_in_use();
  ok(L !== null && ['H-DPCINIT', 'H-LENSINIT', 'S-LENSNAND', 'H-LENSON', 'S-LENSMCU'].every((x) => used.includes(x)) && !used.includes('S-LENS'), `the stand-ins name the native lens, not S-LENS: ${used.filter((x) => /LENS|DPC/.test(x))}`);
  const names = L.mcu.frames.map(([n]) => n.slice(0, 5));
  ok(JSON.stringify(names.slice(0, START.length)) === JSON.stringify(START), `the lens's start, in the driver's order: ${JSON.stringify(names.slice(0, 16))}`);
  const intc = lab.nk.intc, irq = BOARD.lens.irq;
  ok(intc.level(irq) === 1 << 3 && lab.sim.u32(HANDLER_TABLE + 4 * irq) !== 0, `the lens open attached IRQ ${irq} at level 3: ${intc.level(irq)}`);
  s.idle_slice(lab.lab_time() + 1500e6);
  const rec = lab.sim.u32(A(RECORD_PTR)), rd = (o, n) => [...lab.sim.read(rec + o, n)], u16 = (o) => lab.sim.u32(rec + o) & 0xffff;
  const name = String.fromCharCode(...rd(1106, 32)).replace(/\0.*$/, '');
  ok(JSON.stringify(rd(1100, 6)) === JSON.stringify(LENS_1240.id) && name === LENS_1240.name && rd(1138, 1)[0] === LENS_1240.zoom.length && u16(1144) === 12 && u16(1146) === 40,
    `the record's identity: ID ${rd(1100, 6)}, name ${JSON.stringify(name)}, ${rd(1138, 1)} steps, ${u16(1144)}..${u16(1146)} mm`);
  ok(LENS_1240.zoom.every((fl, i) => u16(1164 + 16 * i) === fl && u16(1166 + 16 * i) === LENS_1240.ap[0] && u16(1168 + 16 * i) === LENS_1240.ap[1]), 'the zoom entries: focal length and apertures per step');
  // the zoom step S-SCENE's default focal length gives (25 mm, step 4), which S-EXPOSE turns the ring to on the shooting
  // screen; E146's and E147's starts end before it (their GUI at 0x102, X), so the lens stays at its first step there
  const step = lab.state() === 0x0108 ? 4 : 0;
  ok(lab.sim.u32(rec + 4) === 0x8000 && rd(8, 1)[0] === step && u16(16) === LENS_1240.ap[0], `the state: status 0x${lab.sim.u32(rec + 4).toString(16)}, zoom step ${rd(8, 1)} (want ${step}), aperture ${u16(16)}`);
  const fl = focal.map((a) => lab.sim.u32(a));
  ok(JSON.stringify(fl) === JSON.stringify([24, 80, 2 * LENS_1240.zoom[step]]), `the 35 mm focal lengths the driver derives: ${fl}`);
  // the bring-up's three 0x100000ff logs (0x5089d53e, 0x5089d853) are the session's without the native lens too (X:
  // master 93016b8's play session logs the same three)
  const unexpected = (from) => lab.kernel.errors.slice(from).filter(([c]) => !EXPECTED_ERRLOG.has(c) && !(from === 0 && c === 0x100000ff)).map(([c, , , w]) => `0x${c.toString(16)} at ${w}`);
  ok(unexpected(0).length === 0, `no error log: ${unexpected(0)}`);
  const e0 = lab.kernel.errors.length;
  // the zoom ring: the lens reports the step in its state, the driver derives the focal length from it
  s.camapp.lens_zoom(40);
  s.idle_slice(lab.lab_time() + 500e6);
  ok(rd(8, 1)[0] === LENS_1240.zoom.length - 1 && lab.sim.u32(focal[2]) === 80, `the zoom ring at 40 mm: step ${rd(8, 1)}, ${lab.sim.u32(focal[2])} mm (35 mm)`);
  s.camapp.lens_zoom(25);
  s.idle_slice(lab.lab_time() + 500e6);
  const polls = L.mcu.counts.get('c1 80');
  ok(polls >= 10, `the state poll runs on (about every 100 ms): ${polls} polls`);
  // a touch on the shooting screen: the application forwards it to the GUI itself and takes the GUI's answers (event
  // 35 from PostEventToCA, natively), the lab posts none (no S-TOUCHMAP, S-CAFWD); OK then opens the Super Control
  // Panel, as with S-LENS. A body whose touch driver the lab does not run (E146, E147: models.mjs touch) has no touch
  if (s.touch_on) touchChecks(ok, pl, s, lab, used);
  // the lock pin switch: pressed, the lens detaches; released, it starts again (its bit the body's: E147's group 1 byte
  // 0 bit 6, E143's byte 1 bit 4)
  pl.apply({ type: 'key', id: 'fw_121c', action: 'down', t_wall: pl.wall(), seq: 1 });
  s.idle_slice(lab.lab_time() + 500e6);
  ok(L.flags().valid === 0 && L.flags().attach === 0, `LLPSW pressed: the lens detached: ${JSON.stringify(L.flags())}`);
  const n0 = L.mcu.frames.length;
  pl.apply({ type: 'key', id: 'fw_121c', action: 'down', t_wall: pl.wall(), seq: 2 });
  s.idle_slice(lab.lab_time() + 800e6);
  const again = L.mcu.frames.slice(n0).map(([n]) => n.slice(0, 5));
  ok(L.flags().valid === 1 && L.flags().attach === 1 && JSON.stringify(again.slice(0, START.length)) === JSON.stringify(START), `LLPSW released: the lens's start again: ${JSON.stringify(L.flags())} ${JSON.stringify(again.slice(0, 16))}`);
  ok(unexpected(e0).length === 0, `no error log across the detach and the start again: ${unexpected(e0)}`);
  pl.close_session();
  return { checks, bad };
}
function touchChecks(ok, pl, s, lab, used) {
  ok(s.app_touch && !used.includes('S-TOUCHMAP') && !used.includes('S-CAFWD'), `the application forwards the touches: ${used.filter((x) => /TOUCH|CAFWD/.test(x))}`);
  let seq = 10;
  const input = (inp) => { const q = seq++; pl.apply({ ...inp, t_wall: pl.wall(), seq: q }); return pl.box.pop(q); };
  const gui = () => lab.state();
  ok(gui() === 0x0108, `the shooting screen before the touch: 0x${gui().toString(16)}`);
  const c0 = lab.cafwd.length;
  const down = input({ type: 'touch', action: 'down', x: 300, y: 200 }), up = input({ type: 'touch', action: 'up', x: 300, y: 200 });
  s.idle_slice(lab.lab_time() + 300e6);
  const answers = lab.cafwd.slice(c0);
  ok(answers.length === 2 && answers.every((c) => c.event === 35 && c.caller === '0x5124f6ae') && !down.record.touch_posted.length && !up.record.touch_posted.length,
    `the GUI answers the application's two forwards, the lab posts none: ${JSON.stringify(answers)} ${JSON.stringify([down.record.touch_posted, up.record.touch_posted])}`);
  input({ type: 'key', id: 'ok', action: 'down' });
  input({ type: 'key', id: 'ok', action: 'up' });
  ok(gui() === 0x0403, `after the touch OK opens the Super Control Panel: 0x${gui().toString(16)}`);
  input({ type: 'key', id: 's1', action: 'down' });
  input({ type: 'key', id: 's1', action: 'up' });
  s.idle_slice(lab.lab_time() + 300e6);
  ok(gui() === 0x0108, `and S1 returns to the shooting screen: 0x${gui().toString(16)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const u = lensUnits();
  console.log(`lens units: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  let n = u.bad.length;
  if (process.argv.includes('--session')) {
    const r = await lensSession();
    console.log(`the native lens in play: ${r.checks - r.bad.length}/${r.checks}`);
    r.bad.forEach((x) => console.log('  ', x));
    n += r.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
