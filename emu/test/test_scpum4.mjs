// The sub-CPU's own firmware behind S-SCPUDEV's seam (src/lab/scpum4.mjs; docs/om1-scpu-spec.md section 8 step 6).
//   scpuM4Units    (pure) A-SCPUM4-1's clock: the due and limit times from the link's anchor; the frame log from the
//                  wire: a scripted MN drives S-SCPUDEV through PER_SCPU's handshake (the power-on, a write, a read, a
//                  frame longer than 10 bytes, a poll carrying a message, a long write, a long read) with the wire
//                  tapped, and WireFrames rebuilds S-SCPUDEV's own frame log from the tap exactly; the byte mover: an
//                  MN frame clocked into SPI2 at the link's clock with the image's DMA set-up (DMA1 channel 4 on
//                  request 1, peripheral to memory) lands whole in memory with no overrun, a reply channel 5 feeds
//                  goes out in order, and without the bit times between the bytes the receive FIFO overruns and
//                  nothing reaches memory (the time is what lets the DMA move)
//   scpuM4Session  (firmware; the model of OM_EMU_MODEL, E143 or E146, the bodies with scpu_lle) a play session's start
//                  twice, with S-SCPUDEV and with the sub-CPU's own firmware (env.scpu 'native'): the stand-ins name
//                  the latter's labels and not S-SCPUDEV; its frame log (PER_SCPU's 0x85 {2}, the store init's
//                  requests, H-UIINSCAN's 0x88) equals S-SCPUDEV's, and so do the transfers' bytes both ways and the
//                  pins' levels from the first request on; the gate open in the sub-CPU's SRAM; PER_SCPU waiting with
//                  no errlog of its own; the sub-CPU's time no further ahead of lab time than A-SCPUM4-1's answer windows
//   node emu/test/test_scpum4.mjs [--session]      (OM_EMU_MODEL=E146 node emu/test/test_scpum4.mjs --session)
import { MemoryBus } from '../src/core/m4/bus.mjs';
import { Scheduler } from '../src/core/m4/periph/sched.mjs';
import { Spi } from '../src/core/m4/periph/spi.mjs';
import { Dma, ccr } from '../src/core/m4/periph/dma.mjs';
import { ScpuDev, ScpuMemory } from '../src/lab/scpudev.mjs';
import { LeadClock, WireFrames, clockBytes, LEAD_S, BOOT_S, LINK_HZ } from '../src/lab/scpum4.mjs';
import { bytesHex } from '../src/util/bytes.mjs';

// ---- A-SCPUM4-1's clock
function clockTests(ok) {
  const c = new LeadClock(5e9, 0.25);
  ok(c.due(5e9) === 0.25 && c.limit(5e9) === 0.25, `at the anchor, no window open: due ${c.due(5e9)}, limit ${c.limit(5e9)}`);
  c.open(0.25, BOOT_S);
  ok(c.limit(5e9) === 0.75, `a window opened: the sub-CPU may run to its end while lab time stands still: ${c.limit(5e9)}`);
  c.open(0.3, LEAD_S);
  ok(c.answerBy === 0.75, `a shorter window opened later does not cut an open one: ${c.answerBy}`);
  c.open(0.74, LEAD_S);
  ok(Math.abs(c.limit(5e9) - 0.79) < 1e-12, `a window opened near the end of another extends it: ${c.limit(5e9)}`);
  ok(c.due(6.5e9) === 1.75 && c.limit(6.5e9) === 1.75, `lab time past the windows: the lab's now: due ${c.due(6.5e9)}, limit ${c.limit(6.5e9)}`);
  ok(LEAD_S === 0.05 && BOOT_S === 0.5, `the windows: ${LEAD_S} s after an input, ${BOOT_S} s after a power-on or reset`);
}

// ---- the frame log from the wire against S-SCPUDEV's own
// A scripted MN on the link (PER_SCPU's handshake, docs/hle-gaps.md 4.7.1), every request edge and transfer also given
// to a WireFrames: request low, wait for ready to drop, clock the 10-byte frame, wait for it to rise; for a read, wait
// for it to drop, clock the length byte and the rest, wait for it to rise; release. Long writes and reads by chunks.
function tappedMn(dev, wire) {
  const st = { ready: null };
  dev.connect({ ready: (v) => { st.ready = v; }, message: () => {} }, { request: 0, reset: 0 });
  wire.request(0);
  st.ready = dev.out.ready;
  const pin = (n, v) => { dev.pin(n, v); if (n === 'request') wire.request(v); };
  const xfer = (b) => { const r = dev.exchange(b, LINK_HZ); wire.transfer(b, r); return r; };
  const until = (want) => { let n = 0; while (st.ready !== want) { if (!dev.step()) throw new Error(`the sub-CPU stalled waiting for ready ${want}`); if (++n > 100) throw new Error('no progress'); } };
  const drain = () => { while (dev.step()); };
  const frame = (cmd, data) => { const f = new Uint8Array(10); f[0] = data.length + 2; f[1] = cmd; f.set(data.slice(0, 8), 2); return f; };
  return {
    drain,
    boot() { pin('request', 1); pin('reset', 1); pin('reset', 0); until(1); drain(); },
    send(cmd, data) {
      until(1); pin('request', 0); until(0);
      xfer(frame(cmd, data)); until(1);
      if (cmd & 0x80) { until(0); const l = xfer(new Uint8Array(1)); xfer(new Uint8Array(l[0] - 1)); until(1); }
      pin('request', 1); drain();
    },
    longWrite(cmd, data) {
      until(1); pin('request', 0); until(0);
      const n = data.length;
      xfer(new Uint8Array([7, 0x0f, n & 255, (n >> 8) & 255, 0, 0, cmd, 0, 0, 0])); until(1);
      for (let o = 0; o < n; o += 255) { until(0); xfer(data.subarray(o, Math.min(n, o + 255))); until(1); }
      pin('request', 1); drain();
    },
    longRead(cmd, n) {
      until(1); pin('request', 0); until(0);
      xfer(frame(cmd, [])); until(1);
      let left = n + 2;
      until(0); xfer(new Uint8Array(255)); left -= 255; until(1);
      while (left > 0) { const k = Math.min(255, left); until(0); xfer(new Uint8Array(Math.max(4, k))); left -= k; until(1); }
      pin('request', 1); drain();
    },
  };
}
function wireTests(ok) {
  const dev = new ScpuDev(new ScpuMemory(() => 1000), { words: [[2, 0]], quiet: [0x21] }), wire = new WireFrames(), mn = tappedMn(dev, wire);
  mn.boot();
  mn.send(0x85, [2, 0, 0]);
  mn.send(0x06, [2, 0x1c, 0x02, 0x00, 0x80, 0]);
  mn.send(0x86, [2, 0]);
  mn.send(0x01, [0xe6, 0x07, 1, 1, 0, 0, 0, 0x05, 0x29]);          // 11 frame bytes: cut to 10
  dev.post(0x08, [1]); mn.drain();
  mn.send(0x8f, []);                                                 // the poll carries the message
  mn.send(0x8f, []);                                                 // and then answers empty
  mn.longWrite(0x21, new Uint8Array(600).map((_, i) => i & 255));
  const orig = dev.read.bind(dev), big = new Uint8Array(400).map((_, i) => (i * 7) & 255);
  dev.read = (cmd, data) => (cmd === 0x84 ? big : orig(cmd, data));
  mn.longRead(0x84, 400);
  dev.read = orig;
  const want = JSON.stringify(dev.frames), got = JSON.stringify(wire.frames);
  ok(dev.frames.length === 8 && got === want, `WireFrames rebuilds S-SCPUDEV's frame log from the wire: ${dev.frames.length} frames, ${got === want ? 'equal' : `${got.slice(0, 400)} != ${want.slice(0, 400)}`}`);
  ok(wire.frames[3].data === 'e60701010000000500' && wire.frames[4].reply === '04080100' && wire.frames[5].reply === '04000000' && wire.frames[6].long === true && wire.frames[7].reply.length === 510,
    `the cut frame, the poll's message, the empty poll, the long write and the long read's header: ${JSON.stringify(wire.frames.slice(3).map((f) => [f.cmd, f.data.slice(0, 20), f.reply?.slice(0, 12)]))}`);
  ok(wire.transfer(new Uint8Array(2), new Uint8Array(2)) === false && wire.request(1) === null && wire.frames.length === 8, 'a transfer with the request line high and a second release log nothing');
}

// ---- the byte mover: SPI2 as the image sets it up (8-bit, FRXTH, DMA requests) with DMA1 channels 4 / 5 on request 1
const SPI2 = 0x40003800, DR = SPI2 + 0x0c, RAM = 0x20000000;
function fixture() {
  const cpu = { cycles: 0 }, sched = new Scheduler(cpu);
  // let n cycles pass, firing every event due on the way
  const pass = (n) => { const end = cpu.cycles + n; for (;;) { const t = sched.next(); if (t > end) break; cpu.cycles = t; sched.fire(); } cpu.cycles = end; };
  const bus = new MemoryBus(), ram = bus.ram(RAM, 0x100);
  const spi = new Spi({ name: 'SPI2', irq: () => {}, irqn: 36 });
  bus.device(SPI2, 0x400, spi);
  const dma = new Dma({ name: 'DMA1', bus, sched, irq: () => {}, irqs: [11, 12, 13, 14, 15, 16, 17] });
  spi.dmaRx = dma.wire(4, 1); spi.dmaTx = dma.wire(5, 1);
  dma.write(0xa8, 4, (1 << 12) | (1 << 16));                         // CSELR: channels 4 and 5 on request 1 (SPI2)
  // a channel: CPAR, CMAR, CNDTR, then CCR with EN (8-bit items)
  const chan = (ch, par, mar, n, flags) => { dma.write(ccr(ch) + 8, 4, par); dma.write(ccr(ch) + 12, 4, mar); dma.write(ccr(ch) + 4, 4, n); dma.write(ccr(ch), 4, flags | 1); };
  spi.write(0x04, 4, 0x1701);                                        // 8-bit, FRXTH, RXDMAEN
  spi.write(0x00, 4, 0x40);                                          // SPE, slave
  chan(4, DR, RAM, 10, 0x80);                                        // peripheral to memory, MINC: the 10-byte receive
  return { pass, ram, spi, dma, chan };
}
function moverTests(ok) {
  const per = Math.ceil(8 * 16e6 / LINK_HZ);                         // a byte at 6 MHz on a 16 MHz HCLK
  ok(per === 22, `a byte's eight bit times: ${per} cycles`);
  const frame = Uint8Array.from([5, 0x85, 2, 0, 0, 0, 0, 0, 0, 0]);
  const f = fixture();
  const back = clockBytes(f.spi, frame, per, f.pass);
  const ovr = () => (f.spi.read(0x08, 4) >>> 6) & 1;
  ok(bytesHex(f.ram.subarray(0, 10)) === bytesHex(frame) && f.dma.read(ccr(4) + 4, 4) === 0 && ((f.dma.read(0, 4) >>> 12) & 2) === 2 && !ovr(),
    `the frame in memory, channel 4 done (TCIF4), no overrun: ${bytesHex(f.ram.subarray(0, 10))}`);
  ok(bytesHex(back) === '00'.repeat(10), `the slave shifts zeros out while it receives (its transmit FIFO empty, I): ${bytesHex(back)}`);
  f.ram.set([5, 0x85, 2, 0x85, 1], 0x40);
  f.spi.write(0x04, 4, 0x1703);                                      // TXDMAEN too
  f.chan(5, DR, RAM + 0x40, 5, 0x80 | 0x10);                         // memory to peripheral: the reply
  f.pass(per);                                                       // the channel fills the transmit FIFO
  const reply = clockBytes(f.spi, new Uint8Array(5), per, f.pass);
  ok(bytesHex(reply) === '0585028501' && f.dma.read(ccr(5) + 4, 4) === 0, `the reply goes out in order: ${bytesHex(reply)}`);
  ok(ovr() === 1, 'the master\'s bytes during the reply, not taken by a receive, overrun the receive FIFO (the HAL clears it, I)');
  const g = fixture();
  clockBytes(g.spi, frame, per, () => {});
  ok((g.spi.read(0x08, 4) >>> 6) & 1 && bytesHex(g.ram.subarray(0, 10)) === '00'.repeat(10), 'without the bit times the receive FIFO overruns and nothing reaches memory');
}

export function scpuM4Units() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  clockTests(ok);
  wireTests(ok);
  moverTests(ok);
  return { checks, bad };
}

// (firmware) A play session's start twice: S-SCPUDEV, then the sub-CPU's own firmware; what the link carried in each
const PLAY_ARGS = { no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true };
function linkRecord(pl) {
  const lab = pl.session.lab, link = lab.scpu_link;
  const pins = lab.sim.m.devices.linkpins.log.map(([n, v]) => `${({ ready: 'r', reset: 's', request: 'q' })[n]}${v}`);
  return { frames: JSON.stringify(lab.store_log.scpu_frames), transfers: JSON.stringify(link.transfers), pins, used: pl.stand_ins_in_use() };
}
export async function scpuM4Session() {
  const bad = [], skipped = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { loadImage, loadBlock, createHash, loadScpuImage } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { MODEL, MODEL_INFO } = await import('../src/fw/model.mjs');
  const { EXPECTED_ERRLOG } = await import('../src/lab/display.mjs');
  if (!MODEL_INFO.scpu_lle) { skipped.push(`${MODEL} gives no SCPU image (src/fw/models.mjs scpu_lle)`); return { checks, bad, skipped }; }
  let scpuImage = null;
  try { scpuImage = loadScpuImage(); } catch (e) {
    if (/no SCPU block/.test(e.message)) skipped.push(`${MODEL}: ${e.message}`); else ok(false, `${MODEL}: ${e.message}`);
    return { checks, bad, skipped };
  }
  const base = { rom: loadImage(), resBlock: loadBlock(), createHash, wallClock: () => performance.now() / 1000 };
  // S-SCPUDEV, whatever OM_EMU_SCPU says
  const p0 = new Player({ ...PLAYER_PARSER, ...PLAY_ARGS }, { ...base, scpu: 'off' });
  p0.open_session();
  const ref = linkRecord(p0);
  p0.close_session();
  const p1 = new Player({ ...PLAYER_PARSER, ...PLAY_ARGS }, { ...base, scpu: 'native', scpuImage });
  try { p1.open_session(); } catch (e) {
    ok(false, `${MODEL}: the start with the sub-CPU's own firmware: ${e.message.split('\n')[0]}`);
    const dev = p1.session?.lab?.scpu_dev;
    if (dev?.consoleText) bad.push(`${MODEL}: the sub-CPU's console: ${JSON.stringify(dev.consoleText().slice(-1500))}`);
    try { p1.close_session(); } catch { /* the session never opened */ }
    return { checks, bad, skipped };
  }
  const got = linkRecord(p1), lab = p1.session.lab, dev = lab.scpu_dev, link = lab.scpu_link;
  ok(['S-SCPUBOARD', 'A-SCPUM4-1', 'A-SCPUM4-2', 'A-SCPUM4-3', 'H-SCPUSTART', 'S-SIO2', 'A-LINKPINS-1'].every((x) => got.used.includes(x)) && !got.used.includes('S-SCPUDEV') && !got.used.includes('A-SCPUDEV-1'),
    `${MODEL}: the stand-ins name the sub-CPU's own firmware: ${got.used.filter((x) => /SCPU|SIO|LINK/.test(x))}`);
  ok(JSON.parse(ref.frames)[0]?.cmd === '0x85', `${MODEL}: S-SCPUDEV's log starts with PER_SCPU's 0x85: ${ref.frames.slice(0, 200)}`);
  ok(got.frames === ref.frames, `${MODEL}: the frame log through the sub-CPU's own firmware equals S-SCPUDEV's: ${got.frames} vs ${ref.frames}`);
  ok(got.transfers === ref.transfers, `${MODEL}: the transfers' bytes both ways equal S-SCPUDEV's: ${got.transfers.slice(0, 600)} vs ${ref.transfers.slice(0, 600)}`);
  const fromRequest = (log) => log.slice(log.indexOf('q0')).join(' ');
  ok(got.pins.includes('q0') && fromRequest(got.pins) === fromRequest(ref.pins), `${MODEL}: the pins from the first request on as with S-SCPUDEV: ${got.pins.join(' ')} vs ${ref.pins.join(' ')}`);
  ok(dev.powered && lab.nk.state(link.tid) === 4 && !link.open, `${MODEL}: the gate open in the sub-CPU's SRAM, PER_SCPU waiting, the channel closed (sub-CPU ${dev.state}, task state ${lab.nk.state(link.tid)})`);
  const own = lab.kernel.errors.filter(([c]) => (c >>> 16) === 0x1900 && !EXPECTED_ERRLOG.has(c >>> 0)).map(([c]) => '0x' + c.toString(16));
  ok(own.length === 0, `${MODEL}: no errlog of PER_SCPU's or PER_SIO's: ${own}`);
  // (a run stops at most a SysTick period, 1 ms, past its target while the sub-CPU sleeps, or LOOK_EVERY instructions)
  const t = dev.m.seconds(), now = lab.lab_time(), ahead = t - dev.clock.due(now);
  ok(t > 0 && t <= dev.clock.limit(now) + 0.002, `${MODEL}: the sub-CPU ran ${t.toFixed(4)} s, ${ahead.toFixed(4)} s ahead of lab time, within its answer windows (to ${dev.clock.limit(now).toFixed(4)} s)`);
  if (bad.length) bad.push(`${MODEL}: the sub-CPU's console: ${JSON.stringify(dev.consoleText().slice(-1500))}`);
  p1.close_session();
  return { checks, bad, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scpuM4Units();
  console.log(`the sub-CPU's own firmware behind the link: clock, frame log and byte mover ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  let n = r.bad.length;
  if (process.argv.includes('--session')) {
    const s = await scpuM4Session();
    console.log(`the sub-CPU's own firmware in play against S-SCPUDEV: ${s.checks - s.bad.length}/${s.checks}${s.skipped.length ? `, SKIPPED: ${s.skipped.join('; ')}` : ''}`);
    s.bad.forEach((x) => console.log('  ', x));
    n += s.bad.length;
  }
  process.exitCode = n ? 1 : 0;
}
