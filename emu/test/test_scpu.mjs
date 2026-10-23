// The SCPU without firmware: the interface's clock (src/dev/scpu.mjs) ticking with the lab clock, and S-SCPU
// (src/lab/scpuserver.mjs): the sub-CPU's memory and the request server against a stand-in lab.
//   scpuUnits  the clock counts whole seconds and the 1/1024 s phase from the lab clock, a seconds write keeps the
//              phase, a 0 to the phase word restarts it and another value is a bus error; the blank memory has no
//              date and reads 0 for a word, a set date advances with now() and keeps its status, a change reaches
//              persist, a non-date is refused; the server answers 0x06 / 0x86 and 0x01 / 0x81 (the reply in rx, the
//              completion called with a0 = the argument, or a plain return without one) and a body's quiet write, and
//              refuses another command, a size its senders do not use, an unlisted word and a request outside a task's
//              context
//   portTests  (on a board with scpu.events) a port reads its level in bit 31; a level change, either way, sets the
//              port's event bit and raises IRQ 320; a write clears the bits it names and drops the line once none is
//              pending; a port write, an event bit past the ports and a doorbell store other than the command are
//              bus errors
//   node emu/test/test_scpu.mjs
import { createMachine, SCPU_DOORBELL } from '../src/machine.mjs';
import { SET_INPUTS } from '../src/dev/scpu.mjs';
import { BUS } from '../src/core/mem.mjs';
import { BOARD } from '../src/fw/board.mjs';
import { IMAGE_BASE } from '../src/fw/model.mjs';
import { ScpuMemory, ScpuServer, ScpuError, dateBytes, dateOf } from '../src/lab/scpuserver.mjs';
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
  ok(rd(ev.pending) === 0 && port(2) === 0 && intc.line[ev.irq] === 0, 'the levels and the events start at 0');
  bell((SET_INPUTS << 24 | 0x3c) >>> 0);
  ok(port(2) === 0x80000000 && port(1) === 0 && rd(ev.pending) === 0x3c && intc.line[ev.irq] === 1, `levels 0x3c: port 2 0x${port(2).toString(16)}, events 0x${rd(ev.pending).toString(16)}`);
  wr(ev.pending, 0x0c);
  ok(rd(ev.pending) === 0x30 && intc.line[ev.irq] === 1, 'a write clears the bits it names');
  wr(ev.pending, 0x7f);
  ok(rd(ev.pending) === 0 && intc.line[ev.irq] === 0, 'the line drops with the last pending bit');
  bell((SET_INPUTS << 24 | 0x38) >>> 0);
  ok(rd(ev.pending) === 0x04 && intc.line[ev.irq] === 1 && port(2) === 0, 'a falling level sets its event bit too');
  bell((SET_INPUTS << 24 | 0x38) >>> 0);
  ok(rd(ev.pending) === 0x04, 'the same levels set no bit');
  ok(throwsAs(() => wr(ev.ports, 0x80000000), BUS), 'a port write is a bus error');
  ok(throwsAs(() => wr(ev.pending, 1 << ev.count), BUS), 'an event bit past the ports is a bus error');
  ok(throwsAs(() => bell(0x3c), BUS) && throwsAs(() => bell((SET_INPUTS << 24 | 1 << ev.count) >>> 0), BUS), 'a doorbell store other than the command is a bus error');
  ok(scpu.read(ev.pending, 4, true) === 0x04 && throwsAs(() => scpu.write(ev.pending, 4, 4, true), BUS), 'a debugger reads the events and cannot clear them');
}

function memoryTests(ok) {
  let now = 100;
  const saves = [];
  const blank = new ScpuMemory(() => now);
  ok(blank.seconds() === null && blank.word(2) === 0, 'a blank memory has no date and reads 0 for a word');
  ok(throwsAs(() => blank.date(), ScpuError), 'a get before any set is refused');
  const mem = new ScpuMemory(() => now, null, (st) => saves.push(st));
  mem.setDate(date(2022, 1, 1, 0, 0, 0, 10501));
  now += 3725;
  ok(hexOf(mem.date()) === hexOf(date(2022, 1, 1, 1, 2, 5, 10501)), `the date advances with now() and keeps its status: ${hexOf(mem.date())}`);
  mem.setWord(2, 0x8000021c);
  ok(mem.word(2) === 0x8000021c && saves.length === 2 && saves[1].words[2] === 0x8000021c && saves[1].clock_status === 10501, `each change reaches persist: ${JSON.stringify(saves)}`);
  const back = new ScpuMemory(() => now + 10, saves[1]);
  ok(hexOf(back.date()) === hexOf(date(2022, 1, 1, 1, 2, 15, 10501)) && back.word(2) === 0x8000021c, 'a kept state comes back');
  ok(throwsAs(() => dateOf(date(2022, 2, 30, 0, 0, 0)), ScpuError) && throwsAs(() => dateOf(date(2022, 13, 1, 0, 0, 0)), ScpuError), 'a non-date is refused');
  ok(hexOf(dateBytes(dateOf(date(2099, 12, 31, 23, 59, 59, 7))[0], 7)) === hexOf(date(2099, 12, 31, 23, 59, 59, 7)), 'the date bytes round-trip');
}

// A stand-in lab: byte memory, the KCB's nesting byte, the store log; a stand-in harness recording how serve() ends.
function fakeLab() {
  const mem = new Map(), NEST = 0x1000;
  const sim = {
    read: (a, n) => Uint8Array.from({ length: n }, (_, i) => mem.get(a + i) ?? 0),
    write: (a, b) => b.forEach((v, i) => mem.set(a + i, v)),
  };
  return { sim, nk: { kcb: (o) => (o === 28 ? NEST : 0) }, store_log: { scpu_requests: [] }, NEST };
}
function serverTests(ok) {
  const lab = fakeLab(), now = { t: 0 }, server = new ScpuServer(lab, new ScpuMemory(() => now.t), { words: [[2, 0]], quiet: [0x21] });
  const ends = [];
  const hle = { finish: (r, kw) => ends.push(['finish', kw]), finish_after: (r, fn, kw) => ends.push(['after', fn, kw]) };
  const DONE = (IMAGE_BASE + 0x100) >>> 0, TX = 0x2000, RX = 0x3000;
  let next = 0x4000;
  const request = (cmd, txSize, tx, rxSize, rx, done = DONE, arg = 0x77) => {
    const b = new Uint8Array(28), dv = new DataView(b.buffer);
    b[0] = cmd;
    [[4, txSize], [8, tx], [12, rxSize], [16, rx], [20, done], [24, arg]].forEach(([o, v]) => dv.setUint32(o, v, true));
    lab.sim.write(next, b);
    return { a0: (next += 32) - 32, mdr: IMAGE_BASE };
  };
  const serve = (r) => { ends.length = 0; server.serve(hle, r); return ends[0]; };
  lab.sim.write(TX, [2, 0x1c, 0x02, 0x00, 0x80, 0]);
  let end = serve(request(0x06, 6, TX, 6, 0));
  ok(end[0] === 'after' && end[1] === 0x50000100 && end[2].a0 === 0x77, `0x06 calls its completion with a0 = the argument: ${JSON.stringify(end)}`);
  lab.sim.write(TX, [2, 0]);
  serve(request(0x86, 2, TX, 4, RX));
  ok(hexOf(lab.sim.read(RX, 4)) === '1c020080', `0x86 writes the word to rx: ${hexOf(lab.sim.read(RX, 4))}`);
  lab.sim.write(TX, date(2026, 10, 23, 12, 0, 0));
  serve(request(0x01, 9, TX, 9, 0));
  now.t += 61;
  end = serve(request(0x81, 0, 0, 9, RX, 0));
  ok(hexOf(lab.sim.read(RX, 9)) === hexOf(date(2026, 10, 23, 12, 1, 1)) && end[0] === 'finish' && end[1].d0 === 0, `0x81 answers the kept date, a request without a completion returns: ${hexOf(lab.sim.read(RX, 9))} ${JSON.stringify(end)}`);
  ok(server.served.map(([c]) => c).join() === '6,134,1,129' && lab.store_log.scpu_requests.length === 4, 'each request is logged');
  end = serve(request(0x21, 0, 0, 0, 0, 0));
  ok(end[0] === 'finish' && server.served.at(-1)[0] === 0x21, `a quiet write of the body is taken without an effect: ${JSON.stringify(end)}`);
  ok(throwsAs(() => new ScpuServer(lab, new ScpuMemory(() => 0), { words: [], quiet: [0x81] }), ScpuError), 'a quiet command must be a write of its own');
  const refused = (what, r) => ok(throwsAs(() => serve(r), ScpuError), `refused: ${what}`);
  refused('the port scan 0x88', request(0x88, 0, 0, 2, RX));
  refused('0x86 with a 2-byte reply', request(0x86, 2, TX, 2, RX));
  refused('0x01 with an rx buffer', request(0x01, 9, TX, 9, RX));
  lab.sim.write(TX, [3, 0]);
  refused('the backed-up word 3', request(0x86, 2, TX, 4, RX));
  lab.sim.write(TX, [2, 0]);
  lab.sim.write(lab.NEST, [1]);
  refused('a request outside a task\'s context', request(0x86, 2, TX, 4, RX));
}

export function scpuUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  clockTests(ok);
  portTests(ok);
  memoryTests(ok);
  serverTests(ok);
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scpuUnits();
  console.log(`SCPU clock, ports and S-SCPU: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
