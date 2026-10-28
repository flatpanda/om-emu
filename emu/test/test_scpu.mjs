// The SCPU without firmware: the interface's clock (src/dev/scpu.mjs) ticking with the lab clock, its ports and the
// sub-CPU's message line, the link's GIO pins (src/dev/linkpins.mjs) and S-SCPUDEV (src/lab/scpudev.mjs): the sub-CPU's
// memory and its side of the link, driven by a scripted MN that follows PER_SCPU's handshake.
//   scpuUnits  the clock counts whole seconds and the 1/1024 s phase from the lab clock, a seconds write keeps the
//              phase, a 0 to the phase word restarts it and another value is a bus error; ports: a port reads its
//              level in bit 31, the message port the sub-CPU's line (high at first), a level change either way sets
//              the port's event bit and raises IRQ 320, a write clears the bits it names, a doorbell store pulling the
//              message port low, a port write and an event bit past the ports are bus errors; the link's pins: the
//              ready pin's level in bit 4, the outputs' stores reach the far end once per change, the status holds the
//              bit of the level the pin has (A-LINKPINS-1), a write clears only a bit whose level has gone, IRQ 119
//              follows status & enable, a store to the input, an output store other than 0 or 1 and a status bit
//              outside the two are bus errors; the memory: a blank one answers the default date with status 10501
//              and reads 0, a status-0 date sets the RTC and register 1 by its class, and the RTC advances, a nonzero
//              status clears register 1, a date before 2019 under register 1 = 1 falls back, a kept state comes back
//              (an old file's clock_status too); the sub-CPU: the reset pulse and the boot's ready level, 0x85 {2}'s
//              reply and the gate it opens at the release, a write and a read, the 10-byte cut of a longer frame, a
//              poll's empty reply, a long write in chunks and a long read in chunks padded to 4, and the refusals
//              (the gate before the power-on, a second power-on, an unmodelled command, an unlisted word, a wrong
//              size, clocking an unarmed SPI, an event the command manager has no transition for, a quiet command
//              that is not a write of its own)
//   scpuSession  (firmware; the model of OM_EMU_MODEL) a play session's start through the link: the stand-ins, the
//              frames of PER_SCPU's start and the store init with their replies, IRQ 119 attached, the pins in
//              PER_SCPU's order, PER_SCPU waiting with no errlog of its own; a body without the link's pins stops at its start
//   node emu/test/test_scpu.mjs [--session]      (OM_EMU_MODEL=E146 node emu/test/test_scpu.mjs --session: another body)
import { createMachine, SCPU_DOORBELL } from '../src/machine.mjs';
import { SET_INPUTS } from '../src/dev/scpu.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { ScpuMemory, ScpuDev, ScpuError, dateBytes, dateClass, RTC_INVALID } from '../src/lab/scpudev.mjs';
import { bytesHex } from '../src/util/bytes.mjs';

const hexOf = (b) => bytesHex(b);
const date = (y, mo, d, h, mi, s, status = 0) => { const b = new Uint8Array(9), dv = new DataView(b.buffer); dv.setUint16(0, y, true); b.set([mo, d, h, mi, s], 2); dv.setUint16(7, status, true); return b; };
const throwsAs = (fn, cls) => { try { fn(); return false; } catch (e) { if (e === cls || e instanceof cls) return true; throw e; } };

function clockTests(ok) {
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { scpu, clock } = m.devices, [S, P] = BOARD.scpu.clock;
  const rd = (o) => scpu.read(o, 4, false), wr = (o, v) => scpu.write(o, v, 4, false);
  wr(S, 1000);
  ok(rd(S) === 1000 && rd(P) === 0, `a seconds write reads back at once: ${rd(S)} phase ${rd(P)}`);
  clock.advance(2.5e9);
  ok(rd(S) === 1002 && rd(P) === 512 << 5, `2.5 s on: ${rd(S)} phase 0x${rd(P).toString(16)}`);
  wr(P, 0);
  ok(rd(S) === 1002 && rd(P) === 0, `a 0 to the phase restarts it at the second: ${rd(S)} phase ${rd(P)}`);
  clock.advance(clock.t + 0.25e9);
  wr(S, 50);
  ok(rd(S) === 50 && rd(P) === 256 << 5, `a seconds write keeps the phase: ${rd(S)} phase 0x${rd(P).toString(16)}`);
  clock.advance(clock.t + 0.75e9);
  ok(rd(S) === 51 && rd(P) === 0, `the next second: ${rd(S)} phase ${rd(P)}`);
  ok(scpu.read(S, 4, true) === 51, 'a debugger read sees the clock as the CPU does');
  ok(throwsAs(() => wr(P, 1), BUS), 'a nonzero phase write is a bus error');
  ok(rd(S) === 51 && rd(P) === 0, 'the refused write changes nothing');
}

function portTests(ok) {
  const ev = BOARD.scpu.events;
  if (!ev) return;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { scpu, intc } = m.devices;
  const rd = (o) => scpu.read(o, 4, false), wr = (o, v) => scpu.write(o, v, 4, false), port = (k) => rd(ev.ports + 4 * k);
  const bell = (v) => scpu.doorbell(SCPU_DOORBELL, v, 4, false);
  const msg = 1 << ev.message;
  ok(rd(ev.pending) === 0 && port(2) === 0 && port(ev.message) === 0x80000000 && intc.line[ev.irq] === 0, 'the levels and the events start at 0, the message line high');
  bell((SET_INPUTS << 24 | 0x3c) >>> 0);
  ok(port(2) === 0x80000000 && port(1) === 0 && rd(ev.pending) === (0x3c & ~msg) && intc.line[ev.irq] === 1, `levels 0x3c: port 2 0x${port(2).toString(16)}, events 0x${rd(ev.pending).toString(16)}`);
  wr(ev.pending, 0x0c);
  ok(rd(ev.pending) === (0x30 & ~msg) && intc.line[ev.irq] === 1, 'a write clears the bits it names');
  wr(ev.pending, 0x7f);
  ok(rd(ev.pending) === 0 && intc.line[ev.irq] === 0, 'the line drops with the last pending bit');
  bell((SET_INPUTS << 24 | 0x38) >>> 0);
  ok(rd(ev.pending) === 0x04 && intc.line[ev.irq] === 1 && port(2) === 0, 'a falling level sets its event bit too');
  bell((SET_INPUTS << 24 | 0x38) >>> 0);
  ok(rd(ev.pending) === 0x04, 'the same levels set no bit');
  scpu.setMessage(0);
  ok(port(ev.message) === 0 && rd(ev.pending) === (0x04 | msg), 'the sub-CPU drops its message line: the port reads 0 and its event bit is set');
  scpu.setMessage(1);
  wr(ev.pending, 0x7f);
  ok(throwsAs(() => bell((SET_INPUTS << 24 | (0x38 & ~msg)) >>> 0), BUS), 'a doorbell store pulling the message port low is a bus error');
  ok(throwsAs(() => wr(ev.ports, 0x80000000), BUS), 'a port write is a bus error');
  ok(throwsAs(() => wr(ev.pending, 1 << ev.count), BUS), 'an event bit past the ports is a bus error');
  ok(throwsAs(() => bell(0x3c), BUS) && throwsAs(() => bell((SET_INPUTS << 24 | 1 << ev.count) >>> 0), BUS), 'a doorbell store other than the command is a bus error');
  ok(scpu.read(ev.pending, 4, true) === 0 && throwsAs(() => scpu.write(ev.pending, 4, 4, true), BUS), 'a debugger reads the events and cannot clear them');
}

function pinTests(ok) {
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const pins = m.devices.linkpins;
  if (!pins) return;
  const { intc } = m.devices, L = BOARD.scpu_link, [b0, b1] = L.ready.bits;
  const word = (name, off = 0) => pins.wordRead(name, off, 4, false);
  const outs = [];
  pins.connect({ output: (n, v) => outs.push([n, v]) });
  const st = () => pins.irqRead('status', 4, false), sw = (v) => pins.irqWrite('status', v, 4, false), en = (v) => pins.irqWrite('enable', v, 4, false);
  ok(word('ready') === 0 && st() === b1 && intc.line[L.ready.irq] === 0, `the ready pin low: level word ${word('ready')}, status ${st()}`);
  sw(b1);
  ok(st() === b1, 'a write does not clear the bit of the level the pin still has');
  en(b1);
  ok(intc.line[L.ready.irq] === 1, 'IRQ 119 follows status & enable');
  en(0);
  pins.setReady(1);
  ok(word('ready') === 0x10 && st() === (b0 | b1) && intc.line[L.ready.irq] === 0, `ready high: level 0x${word('ready').toString(16)}, status ${st()}`);
  sw(b1);
  ok(st() === b0, 'a write clears the bit whose level has gone');
  en(b0);
  ok(intc.line[L.ready.irq] === 1, 'the type-0 interrupt with the pin high');
  pins.wordWrite('request', 0, 1, 4, false);
  pins.wordWrite('reset', 0, 1, 4, false);
  pins.wordWrite('reset', 0, 1, 4, false);
  ok(JSON.stringify(outs) === JSON.stringify([['request', 1], ['reset', 1]]) && word('reset') === 0x11, `the outputs reach the far end once per change: ${JSON.stringify(outs)}`);
  pins.wordWrite('reset', 4, 0x123, 4, false);
  ok(word('reset', 4) === 0x123, 'the configuration word is storage');
  ok(throwsAs(() => pins.wordWrite('ready', 0, 1, 4, false), BUS), 'a store to the input pin is a bus error');
  ok(throwsAs(() => pins.wordWrite('request', 0, 2, 4, false), BUS), 'an output store other than 0 or 1 is a bus error');
  if (L.ready.shared) {
    en(b0 | 4); sw(4);
    ok(pins.irqRead('enable', 4, false) === (b0 | 4), 'a shared group\'s other enable bits are storage');
  } else ok(throwsAs(() => sw(4), BUS), 'a status bit outside the two is a bus error');
}

function memoryTests(ok) {
  let now = 100;
  const saves = [];
  const blank = new ScpuMemory(() => now);
  ok(blank.seconds() === null && blank.reg(2) === 0, 'a blank memory has no date and reads 0 for a register');
  ok(hexOf(blank.date()) === hexOf(date(2019, 1, 1, 0, 0, 0, RTC_INVALID)), `a blank RTC answers the default date: ${hexOf(blank.date())}`);
  const mem = new ScpuMemory(() => now, null, (st) => saves.push(st));
  mem.setDate(date(2022, 1, 1, 0, 0, 0, 0));
  now += 3725;
  ok(hexOf(mem.date()) === hexOf(date(2022, 1, 1, 1, 2, 5, 0)) && mem.reg(1) === 1, `a status-0 date sets the RTC, which advances, and register 1: ${hexOf(mem.date())}`);
  mem.setDate(date(2023, 5, 5, 0, 0, 0, 5));
  ok(mem.reg(1) === 0 && hexOf(mem.date()) === hexOf(date(2019, 1, 1, 0, 0, 0, RTC_INVALID)), 'a nonzero status clears register 1: the default date');
  mem.setDate(date(2022, 2, 30, 0, 0, 0, 0));
  ok(mem.reg(1) === 0, 'a status-0 non-date changes nothing');
  mem.setDate(date(2018, 6, 1, 0, 0, 0, 0));
  ok(mem.reg(1) === 2 && hexOf(mem.date()) === hexOf(date(2018, 6, 1, 0, 0, 0, 0)), 'a date before 2019: register 1 = 2, the RTC answers it');
  mem.setReg(1, 1);
  ok(hexOf(mem.date()) === hexOf(date(2019, 1, 1, 0, 0, 0, RTC_INVALID)) && mem.reg(1) === 0, 'a date before 2019 under register 1 = 1: register 1 cleared, the default date');
  mem.setDate(date(2022, 1, 1, 0, 0, 0, 0));
  mem.setReg(2, 0x8000021c);
  const last = saves.at(-1);
  ok(last.words[2] === 0x8000021c && last.words[1] === 1 && last.clock_status === 0, `each change reaches persist: ${JSON.stringify(last)}`);
  const back = new ScpuMemory(() => now + 10, last);
  ok(hexOf(back.date()) === hexOf(date(2022, 1, 1, 0, 0, 10, 0)) && back.reg(2) === 0x8000021c, 'a kept state comes back');
  const old = new ScpuMemory(() => now, { clock_offset: 1700000000 - now, clock_status: 0, words: { 2: 7 } });
  ok(old.reg(1) === 1 && old.reg(2) === 7, 'a file without register 1 takes it from clock_status 0');
  ok(dateClass(date(2099, 12, 31, 23, 59, 59)) === 1 && dateClass(date(2000, 1, 1, 0, 0, 0)) === 2 && dateClass(date(2100, 1, 1, 0, 0, 0)) === 0 && dateClass(date(2022, 13, 1, 0, 0, 0)) === 0, 'the date classes');
  ok(hexOf(dateBytes(Date.UTC(2099, 11, 31, 23, 59, 59) / 1000, 7)) === hexOf(date(2099, 12, 31, 23, 59, 59, 7)), 'the date bytes');
}

// A scripted MN on the link, as PER_SCPU drives it (docs/hle-gaps.md 4.7.1): request low, wait for the ready line to
// drop, clock the 10-byte frame, wait for it to rise; for a read, wait for it to drop, clock the length byte and the
// rest, wait for it to rise; release. Long writes and reads by their chunks.
function mnScript(dev) {
  const st = { ready: null, message: 1 }, log = [];
  dev.connect({ ready: (v) => { st.ready = v; log.push(['ready', v]); }, message: (v) => { st.message = v; log.push(['message', v]); } }, { request: 0, reset: 0 });
  st.ready = dev.out.ready;
  const until = (want) => { let n = 0; while (st.ready !== want) { if (!dev.step()) throw new Error(`the sub-CPU stalled waiting for ready ${want}`); if (++n > 100) throw new Error('no progress'); } };
  const drain = () => { while (dev.step()); };
  const frame = (cmd, data) => { const f = new Uint8Array(10); f[0] = data.length + 2; f[1] = cmd; f.set(data.slice(0, 8), 2); return f; };
  const read = () => { until(0); const l = dev.exchange(new Uint8Array(1)); const rest = dev.exchange(new Uint8Array(l[0] - 1)); until(1); return bytesHex(new Uint8Array([...l, ...rest])); };
  return {
    st, log, until, drain,
    boot() { dev.pin('request', 1); dev.pin('reset', 1); dev.pin('reset', 0); until(1); drain(); },
    send(cmd, data, isRead = (cmd & 0x80) !== 0) {
      until(1); dev.pin('request', 0); until(0);
      dev.exchange(frame(cmd, data)); until(1);
      const reply = isRead ? read() : null;
      dev.pin('request', 1); drain();
      return reply;
    },
    longWrite(cmd, data) {
      until(1); dev.pin('request', 0); until(0);
      const n = data.length;
      dev.exchange(new Uint8Array([7, 0x0f, n & 255, (n >> 8) & 255, 0, 0, cmd, 0, 0, 0])); until(1);
      for (let o = 0; o < n; o += 255) { until(0); dev.exchange(data.subarray(o, Math.min(n, o + 255))); until(1); }
      dev.pin('request', 1); drain();
    },
    longRead(cmd, n) {
      until(1); dev.pin('request', 0); until(0);
      dev.exchange(frame(cmd, [])); until(1);
      const parts = [];
      let left = n + 2;
      until(0); parts.push(dev.exchange(new Uint8Array(255))); left -= 255; until(1);
      while (left > 0) { const k = Math.min(255, left), c = Math.max(4, k); until(0); parts.push(dev.exchange(new Uint8Array(c))); left -= k; until(1); }
      dev.pin('request', 1); drain();
      return parts;
    },
  };
}
const booted = (now, quiet = [0x21]) => {
  const dev = new ScpuDev(new ScpuMemory(() => now.t), { words: [[2, 0]], quiet }), mn = mnScript(dev);
  mn.boot();
  return [dev, mn];
};
function devTests(ok) {
  const now = { t: 1000 };
  const [d1, m1] = booted(now);
  ok(m1.st.ready === 1 && JSON.stringify(m1.log) === JSON.stringify([['ready', 0], ['ready', 1]]) && !d1.powered, `the reset pulse: ready low while held, high after the boot: ${JSON.stringify(m1.log)}`);
  ok(throwsAs(() => m1.send(0x86, [2, 0]), ScpuError), 'a read before the power-on stops the sub-CPU (the gate)');
  const [d2, m2] = booted(now);
  ok(throwsAs(() => m2.send(0x8f, [], true), ScpuError), 'a poll before the power-on stops the sub-CPU');
  const [d3, m3] = booted(now);
  ok(m3.send(0x85, [2, 0, 0]) === '0585028501' && d3.powered, `0x85 {2}: its reply ${d3.frames[0].reply}, the gate open at the release`);
  ok(throwsAs(() => m3.send(0x85, [2, 0, 0]), ScpuError), 'a second power-on stops the sub-CPU');
  const [dev, mn] = booted(now);
  mn.send(0x85, [2, 0, 0]);
  mn.send(0x06, [2, 0x1c, 0x02, 0x00, 0x80, 0]);
  ok(mn.send(0x86, [2, 0]) === '06861c020080', 'a backup word written and read back');
  mn.send(0x01, [0xe6, 0x07, 1, 1, 0, 0, 0, 0x05, 0x29]);
  ok(dev.frames.at(-1).data === 'e60701010000000500', `a 9-byte date is cut to 10 frame bytes, its status's high byte 0: ${dev.frames.at(-1).data}`);
  ok(mn.send(0x81, []) === '0b81e30701010000000529', 'status 5 (nonzero) clears register 1: get answers the default date');
  mn.send(0x01, [0xe6, 0x07, 1, 1, 0, 0, 0, 0, 0]);
  now.t += 61;
  ok(mn.send(0x81, []) === '0b81e60701010001010000', 'a status-0 date: get answers it, advanced');
  ok(mn.send(0x8f, [], true) === '04000000' && mn.st.message === 1, 'a poll: the empty reply, the message line released');
  mn.send(0x21, []);
  ok(dev.frames.at(-1).cmd === '0x21', 'the body\'s quiet write is taken');
  mn.longWrite(0x21, new Uint8Array(600).map((_, i) => i & 255));
  ok(dev.frames.at(-1).long === true && dev.frames.at(-1).data.length === 1200, 'a long write in three chunks reaches the handler whole');
  const orig = dev.read.bind(dev), big = new Uint8Array(400).map((_, i) => (i * 7) & 255);
  dev.read = (cmd, data) => (cmd === 0x84 ? big : orig(cmd, data));
  const parts = mn.longRead(0x84, 400), head = parts[0];
  ok(head[0] === 0xff && head[1] === 0x84 && bytesHex(head.subarray(2)) === bytesHex(big.subarray(0, 253)) && parts.length === 2 && bytesHex(parts[1]) === bytesHex(big.subarray(253)),
    `a long read: a header chunk and ${parts.length - 1} more`);
  const tiny = new Uint8Array(256).fill(1);
  dev.read = (cmd, data) => (cmd === 0x84 ? tiny : orig(cmd, data));
  const p2 = mn.longRead(0x84, 256);
  ok(p2.length === 2 && bytesHex(p2[1]) === '01010100', `a long read's last chunk padded to 4: ${p2.map((x) => bytesHex(x).slice(0, 12))}`);
  dev.read = orig;
  ok(throwsAs(() => mn.send(0x88, []), ScpuError), 'an unmodelled read (the port scan) stops the session');
  const [, m4] = booted(now, []);
  m4.send(0x85, [2, 0, 0]);
  ok(throwsAs(() => m4.send(0x86, [3, 0]), ScpuError), 'an unlisted backup word is refused');
  const [d5, m5] = booted(now, []);
  m5.send(0x85, [2, 0, 0]);
  ok(throwsAs(() => m5.send(0x86, [2]), ScpuError), 'a size its senders do not use is refused');
  const [d6, m6] = booted(now, []);
  m6.send(0x85, [2, 0, 0]);
  ok(throwsAs(() => d6.exchange(new Uint8Array(10)), ScpuError), 'clocking the SPI while it is not armed stops the session');
  d6.pin('request', 0); d6.step(); d6.step();
  d6.pin('request', 1);
  d6.exchange(new Uint8Array([4, 0x86, 2, 0, 0, 0, 0, 0, 0, 0]));
  ok(throwsAs(() => { while (d6.step()); }, ScpuError), 'a release while the sub-CPU receives: no transition');
  ok(throwsAs(() => new ScpuDev(new ScpuMemory(() => 0), { words: [], quiet: [0x81] }), ScpuError), 'a quiet command must be a write of its own');
  void d2; void d5;
}

export function scpuUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  clockTests(ok);
  portTests(ok);
  pinTests(ok);
  memoryTests(ok);
  devTests(ok);
  return { checks, bad };
}

// (firmware; the model of OM_EMU_MODEL) A play session's start through the link: on a board with the link's pins
// the stand-ins name it, PER_SCPU's start and the store init's requests go over it as frames (0x85 {2} with its reply,
// then the store init's requests: E143's 0x06, 0x01, 0x86 with the word read back), pin 102's IRQ 119 is attached at level 5 by
// PER_SCPU's registration (E143 exactly; elsewhere the frames are the API's requests in order), the pins move in
// PER_SCPU's order (the reset pulse, the ready line, then per transaction
// request low, ready low, ready high, ...), PER_SCPU waits for its next message with no errlog of its own and the
// transfers are full duplex on its channel; on a board without the pins the session's start stops naming them.
export async function scpuSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  const { boardKnows } = await import('../src/fw/board.mjs');
  const { HANDLER_TABLE } = await import('../src/lab/irq.mjs');
  const { EXPECTED_ERRLOG } = await import('../src/lab/display.mjs');
  const env = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 };
  const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, env);
  if (!boardKnows('scpu_link')) {
    let e = null;
    try { pl.open_session(); } catch (x) { e = x; }
    ok(e !== null && /gives no pins for the sub-CPU link/.test(e.message), `${MODEL}: the start stops at the link: ${e?.message.split('\n')[0] ?? 'it started'}`);
    try { pl.close_session(); } catch { /* the session never opened */ }
    return { checks, bad };
  }
  pl.open_session();
  const s = pl.session, lab = s.lab, link = lab.scpu_link, used = pl.stand_ins_in_use();
  ok(['H-SCPUSTART', 'S-SIO2', 'S-SCPUDEV', 'A-SCPUDEV-1', 'A-LINKPINS-1', 'H-GIOSLOTS'].every((x) => used.includes(x)) && !used.includes('S-SCPU'), `${MODEL}: the stand-ins name the link: ${used.filter((x) => /SCPU|SIO|LINK|GIO/.test(x))}`);
  const sl = lab.store_log, frames = sl.scpu_frames, cmds = frames.map((f) => f.cmd);
  const posted = sl.scpu_requests.map((r) => '0x' + r.request.slice(0, 2));
  ok(frames[0]?.cmd === '0x85' && frames[0].data === '020000' && frames[0].reply === '0585028501', `${MODEL}: PER_SCPU's start sends 0x85 {2} first, answered [5, 0x85, 2, 0x85, 1]: ${JSON.stringify(frames[0])}`);
  ok(posted.length > 0 && JSON.stringify(cmds.slice(1)) === JSON.stringify(posted), `${MODEL}: every request the API posted reaches the sub-CPU as a frame, in order: ${JSON.stringify(cmds)} for ${JSON.stringify(posted)}`);
  const waited = sl.scpu_requests.filter((r) => r.request.slice(40, 48) !== '00000000').length;   // a completion at +20
  ok(sl.scpu_waits.length === waited && sl.scpu_waits.every((w) => w.rc === 0), `${MODEL}: the requesters' waits return E_OK: ${JSON.stringify(sl.scpu_waits)}`);
  if (MODEL === 'E143') {
    ok(JSON.stringify(cmds) === JSON.stringify(['0x85', '0x06', '0x01', '0x86']) && frames[3].reply === '06861c020080' && sl.scpu_replies[0]?.bytes === '1c020080', `E143: 0x06, 0x01, 0x86 with the word read back: ${JSON.stringify(frames)}`);
    ok(frames[2].data === 'e60701010000000500', `E143: the reset date's frame cut to 10 bytes, its status 10501 reaching the sub-CPU as 5: ${frames[2].data}`);
  }
  const irq = BOARD.scpu_link.ready.irq, intc = lab.nk.intc;
  ok(intc.level(irq) === 1 << 5 && lab.sim.u32(HANDLER_TABLE + 4 * irq) !== 0, `${MODEL}: PER_SCPU's registration attached pin 102's IRQ ${irq} at level 5: ${intc.level(irq)}`);
  const pins = lab.sim.m.devices.linkpins.log.map(([n, v]) => `${({ ready: 'r', reset: 's', request: 'q' })[n]}${v}`).join(' ');
  ok(pins.startsWith('r1 s1 r0 s0 q1 r1 q0 r0 r1 r0 r1 q1 '), `${MODEL}: the pins in PER_SCPU's order (r ready, s reset, q request): ${pins}`);
  ok(lab.nk.state(link.tid) === 4 && lab.scpu_dev.state === 'idle' && lab.scpu_dev.powered && !link.open, `${MODEL}: PER_SCPU waits, the sub-CPU idle with its gate open, the channel closed`);
  // (a log the body's entry expects is not PER_SCPU's: E147's card's file system asks the SCPU clock first, models.mjs)
  const own = lab.kernel.errors.filter(([c]) => (c >>> 16) === 0x1900 && !EXPECTED_ERRLOG.has(c >>> 0)).map(([c]) => '0x' + c.toString(16));
  ok(own.length === 0, `${MODEL}: no errlog of PER_SCPU's or PER_SIO's: ${own}`);
  ok(link.config.channel === link.channel && link.config.clock > 0 && link.transfers.every((t) => t.tx.length === t.rx.length), `${MODEL}: channel ${link.channel}, clock ${link.config.clock}, ${link.transfers.length} transfers`);
  if (MODEL === 'E143') ok(link.channel === 2 && link.config.clock === 6000000, `E143: channel 2 at 6 MHz: ${link.channel}, ${link.config.clock}`);
  pl.close_session();
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scpuUnits();
  console.log(`SCPU clock, ports, link pins and S-SCPUDEV: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  let n = r.bad.length;
  if (process.argv.includes('--session')) {
    const t = await scpuSession();
    console.log(`the sub-CPU link in play: ${t.checks - t.bad.length}/${t.checks}`);
    t.bad.forEach((x) => console.log('  ', x));
    n += t.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
