// The sub-CPU's own firmware at the far end of the MN's link (docs/om1-scpu-spec.md section 8 step 6): the SCPU image
// (src/fw/models.mjs scpu_lle, the body's block, which the host passes as env.scpuImage) on the Cortex-M4 and STM32L4
// machine of steps 3-5 (src/core/m4/periph/stm32l4.mjs), behind S-SCPUDEV's seam (src/lab/scpudev.mjs; connect, pin,
// exchange, step), so that src/lab/scpulink.mjs and the MN side (PER_SCPU, S-SIO2, the pins, the window's port 3) run
// unchanged. Opt-in (src/lab/menu.mjs scpu_native: env.scpu 'native', node's OM_EMU_SCPU=native) on a body whose image
// the machine is known to boot (E143, and E146 with the same image); elsewhere and by default S-SCPUDEV.
//
// The wiring (the image's pins, scpu_lle.pins, D: scpu spec 3.1; the MN's ends are its board's, src/fw/board.mjs
// scpu_link and scpu.events / scpu.message, so no body has code of its own here):
//   request  MN pin 103 -> the level the board drives on PB12, the EXTI input whose edges start and end a transaction
//   reset    MN pin 107 -> the NRST pin (Stm32l4 nrst): high holds the sub-CPU in reset (A-SCPUM4-3)
//   ready    PC3 -> MN pin 102; message  PC2 -> the MN's message line (the window's port 3); a line the sub-CPU does
//            not drive (its pin not an output, the reset held) reads as S-SCPUDEV's lines while its reset is held
//            (A-SCPUM4-2)
//   bytes    each byte the MN clocks as master goes through SPI2's shift register (Spi exchange: the slave's transmit
//            FIFO's head out, the MN's byte into its receive FIFO), whose FIFOs the image's DMA1 channels 4 / 5 empty and
//            fill (clockBytes)
// The rest of the board is S-SCPUBOARD: the step 5 machine's (src/core/m4/periph/board.mjs: nothing attached, no I2C
// device acknowledging, no battery pack answering, every ADC channel 0, the hardware-phase straps on their pull-ups)
// with the port scan's inputs PC13 and PC5 held low, S-SCPUDEV's levels (scpudev.mjs SCAN_IDLE): PC13 low gives the
// port scan's result bit 0 that keeps UI_IN's switch 0x0400 at the lab's idle image (H-UIINSCAN checks it), and it
// selects bkground at a power-off (scpu spec 3.4) where the machine's default, PC13 on its pull-up, leads the sub-CPU
// into standby 3 s after reset (X, step 5); PC5's level is ? (I for both: the camera's levels are not known).
//
// Time, A-SCPUM4-1 (I): the sub-CPU's clock (its core cycles at HCLK, the machine's seconds()) runs in step with lab
// time from the lab time the link is made at (LeadClock): before it takes an input of the MN's (a pin, a transfer, a
// board level) it runs up to that input's lab time, so it has lived through the time the MN has, and at the MN's idle
// points (step) it runs up to the lab's now. Each input also opens an answer window: up to LEAD_S of the sub-CPU's
// own time past the input (BOOT_S after its power-on and after its reset is released) it may run on at the idle
// points even while lab time stands still, stopping as soon as one of its link lines changes; the changes reach the
// MN one per idle point, as S-SCPUDEV's actions do (A-SCPUDEV-1's order). The windows are what let the sub-CPU boot
// and answer while the MN waits on it in zero lab time (PER_SCPU's start and its transactions run in settles, which
// move no lab time); a window an input opens is not used up by an earlier one, so every transaction of a settle is
// answered, and the sub-CPU gets ahead of lab time only by what it ran in its windows (at most a window per input
// while lab time stands still; lab time then catches up before the sub-CPU runs again). BOOT_S, 0.5 s, is meant to be
// long beyond its boot to its link (the console's prompt comes 16.8 ms after reset, X; when PC3 first rises is ?);
// LEAD_S, 50 ms, long beyond its answer to a request (an interrupt and its command manager's task, I); both short of
// the manager's 1000-tick master monitor (1 s at the 1 ms SysTick the image sets, X), which the MN's zero-lab-time
// handling must not trip. A transfer is one call of the MN's at one lab time; on the sub-CPU each of its bytes takes
// eight bit times at the link's clock (S-SIO2's configuration, 6 MHz on E143), in which its DMA moves the byte.
//
// The frame log (WireFrames): S-SCPUDEV's store_log.scpu_frames, the link's oracle, rebuilt from the wire in the same
// form, so the two sub-CPUs' logs compare as they are. Not modelled: post() (the sub-CPU's own tasks post its
// messages), the port scan's report flag (scanReport: it lives in the image's RAM, whose address is not read), S-NVRAM
// (the sub-CPU's backup domain is blank each session), the MN's debug snapshots (they do not cover this machine).
import { Stm32l4 } from '../core/m4/periph/stm32l4.mjs';
import { PORT_NAMES } from '../core/m4/periph/gpio.mjs';
import { SRAM, SRAM_SIZE } from '../core/m4/boot.mjs';
import { ScpuError, SCAN_PORTS, SCAN_IDLE, CONTEXT_BYTES, RX_BYTES, CHUNK } from './scpudev.mjs';
import { bytesHex } from '../util/bytes.mjs';

// A-SCPUM4-1: the answer windows, in seconds of the sub-CPU's own time: after an input of the MN's, and after its
// power-on or the release of its reset
export const LEAD_S = 0.05, BOOT_S = 0.5;
// the link's clock when the MN's transfer gives none (E143's PER_SIO channel 2, clock word 6,000,000, X)
export const LINK_HZ = 6e6;
// A-SCPUM4-2: the level the MN reads on a line the sub-CPU does not drive (S-SCPUDEV's while its reset is held)
export const UNDRIVEN = { ready: 0, message: 1 };
export const LINES = ['ready', 'message'];
// how many instructions a run goes between looks at the link lines (a change stops it within that many)
const LOOK_EVERY = 64;
const hx = (v) => '0x' + (v >>> 0).toString(16).padStart(2, '0');
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// A-SCPUM4-1's clock: lab time (ns) against the sub-CPU's (seconds), from the pair at which the link was made, and the
// end of the answer windows opened so far
export class LeadClock {
  constructor(labNs, scpuS) { this.lab0 = labNs; this.scpu0 = scpuS; this.answerBy = scpuS; }
  // the sub-CPU's time that lab time `ns` stands for: it has run to there before it takes an input of that time
  due(ns) { return this.scpu0 + (ns - this.lab0) / 1e9; }
  // an input taken at the sub-CPU's time s opens a window of `len` seconds to answer it in
  open(s, len) { this.answerBy = Math.max(this.answerBy, s + len); }
  // the furthest it may run at an idle point of lab time `ns`: the lab's now, or the end of the windows if later
  limit(ns) { return Math.max(this.due(ns), this.answerBy); }
}

// The frame log from the wire, in S-SCPUDEV's form ({cmd, data, reply} in hex, a long write's with long: true). A
// transaction is the MN's request line low, from its fall to its rise, with the transfers the MN clocks in it. The
// first transfer is the command frame [length, command, data], of which the MN clocks 10 bytes (D: its descriptor's
// counts, hle-gaps 4.7.1): the data are the frame's bytes 2 .. length, those past the tenth written as zeros (as
// S-SCPUDEV's log has them: the sub-CPU's 20-byte context reads 0 there, I). A long write's header [7, 0x0f, u32 size,
// command] is followed by its chunks, whose bytes are the data. A read's reply is what the sub-CPU shifted out in the
// transfers after the command frame, up to the length its first byte gives (the whole frame, or a long read's 255-byte
// header chunk, as S-SCPUDEV logs it); a write has none.
export class WireFrames {
  constructor() { this.frames = []; this.open = null; }
  // the request line's level; returns the frame a rise ends, or null
  request(level) {
    if (!level && this.open === null) { this.open = []; return null; }
    if (level && this.open !== null) { const t = this.open; this.open = null; return this.close(t); }
    return null;
  }
  // a transfer the MN clocked: its bytes out and back; false outside a transaction (not logged)
  transfer(tx, rx) {
    if (this.open === null) return false;
    this.open.push([Uint8Array.from(tx), Uint8Array.from(rx)]);
    return true;
  }
  close(t) {
    if (!t.length) return null;
    const [first] = t[0], len = first[0], cmd = first[1];
    let f;
    if (cmd === CHUNK) f = { cmd: hx(first[6]), data: bytesHex(concat(t.slice(1).map(([tx]) => tx))), reply: null, long: true };
    else {
      const ctx = new Uint8Array(CONTEXT_BYTES);
      ctx.set(first.subarray(0, Math.min(first.length, RX_BYTES)));
      const back = concat(t.slice(1).map(([, rx]) => rx));
      f = { cmd: hx(cmd), data: bytesHex(ctx.slice(2, Math.max(2, Math.min(len, CONTEXT_BYTES)))), reply: back.length ? bytesHex(back.subarray(0, back[0])) : null };
    }
    this.frames.push(f);
    return f;
  }
}

// The MN clocks `bytes` into the sub-CPU's SPI slave: per byte one frame through the shift register (spi.exchange),
// then the byte's time on the sub-CPU (pass(cyclesPerByte)), in which its DMA takes the byte out of the receive FIFO
// and puts the next one to send into the transmit FIFO. Returns the bytes the slave shifted out.
export function clockBytes(spi, bytes, cyclesPerByte, pass) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) { out[i] = spi.exchange(bytes[i]); pass(cyclesPerByte); }
  return out;
}

// a pin name of the image's ('PC3') -> [port index, pin]
function pinOf(name) {
  const m = /^P([A-H])(\d{1,2})$/.exec(name), port = m ? PORT_NAMES.indexOf(m[1]) : -1;
  if (port < 0 || Number(m[2]) > 15) throw new ScpuError(`SCPU-M4: no pin ${name}`);
  return [port, Number(m[2])];
}

export class ScpuM4 {
  // image: the SCPU block; now(): lab time in ns; lle: the body's scpu_lle {pins, gate}; lead, boot: A-SCPUM4-1's
  // answer windows (seconds); board: overrides of S-SCPUBOARD's (src/core/m4/periph/board.mjs keys)
  constructor(image, { now, lle, lead = LEAD_S, boot = BOOT_S, board = {} }) {
    this.now = now;
    this.lead = lead;
    this.boot = boot;
    this.pins = lle.pins;
    this.gate = lle.gate;
    if (!(this.gate >= SRAM && this.gate < SRAM + SRAM_SIZE)) throw new ScpuError(`SCPU-M4: the gate byte 0x${(this.gate >>> 0).toString(16)} is not in the sub-CPU's SRAM`);
    this.labels = ['S-SCPUBOARD', 'A-SCPUM4-1', 'A-SCPUM4-2', 'A-SCPUM4-3'];   // what the session's stand-ins name (player.mjs)
    this.m = new Stm32l4(image, { ...board, drive: { ...SCAN_IDLE, ...(board.drive ?? {}) } });
    this.spi = this.m.spi2;
    this.lineAt = new Map(LINES.map((line) => [pinOf(this.pins[line]).join(':'), line]));
    pinOf(this.pins.request);
    // the lines' levels on the sub-CPU's side, as of its own time, and as the MN was last told; the changes not yet
    // told, in order: [line, level]
    this.level = Object.fromEntries(LINES.map((line) => [line, this.lineLevel(this.m.gpio.driven(this.pins[line]), line)]));
    this.out = { ...this.level };
    this.actions = [];
    this.m.gpio.onOutput((port, pin, v) => this.output(port, pin, v));
    this.input = { request: 1, reset: 0 };   // the MN's lines as the sub-CPU last saw them
    this.lines = null;
    this.clock = null;
    this.wire = new WireFrames();
    this.frames = this.wire.frames;          // the link's oracle (src/lab/menu.mjs store_log.scpu_frames)
    this.log = [];                           // what the wire did that has no frame
  }
  fail(what) { throw new ScpuError(`SCPU-M4: ${what}`); }
  lineLevel(driven, line) { return driven < 0 ? UNDRIVEN[line] : driven; }
  // a change of what the chip drives on a pin: a link line's new level joins the changes not yet told
  output(port, pin, driven) {
    const line = this.lineAt.get(`${port}:${pin}`);
    if (line === undefined) return;
    const v = this.lineLevel(driven, line);
    if (v === this.level[line]) return;
    this.level[line] = v;
    this.actions.push([line, v]);
  }
  // ---- S-SCPUDEV's seam
  // lines: {ready(level), message(level)}; inputs: the MN's lines' levels now {request, reset}. The sub-CPU is powered on
  // here, at this lab time (A-SCPUM4-3), and has not run yet
  connect(lines, inputs) {
    this.lines = lines;
    this.clock = new LeadClock(this.now(), this.m.seconds());
    this.input = { request: inputs.request ? 1 : 0, reset: inputs.reset ? 1 : 0 };
    this.m.gpio.drive(this.pins.request, this.input.request);
    this.m.nrst(this.input.reset === 1);
    if (!this.input.request) this.wire.request(0);
    this.clock.open(this.m.seconds(), this.boot);
  }
  pin(name, level) {
    if (name !== 'request' && name !== 'reset') this.fail(`no input ${name}`);
    const v = level ? 1 : 0;
    if (v === this.input[name]) return;
    this.catchUp();
    this.input[name] = v;
    if (name === 'reset') this.m.nrst(v === 1);
    else { this.m.gpio.drive(this.pins.request, v); this.wire.request(v); }
    this.clock.open(this.m.seconds(), name === 'reset' && !v ? this.boot : this.lead);
  }
  // one transfer the MN clocks as master at hz (S-SIO2's configured clock): the bytes the sub-CPU shifts out
  exchange(bytes, hz = LINK_HZ) {
    if (!(hz > 0)) this.fail(`a transfer at a link clock of ${hz} Hz`);
    this.catchUp();
    const hclk = this.hclk(), per = Math.max(1, Math.ceil(8 * hclk / hz));
    const back = clockBytes(this.spi, bytes, per, (k) => this.check(this.m.run({ cycles: k })));
    if (!this.wire.transfer(bytes, back)) this.log.push(`${bytes.length} bytes clocked with the request line high: ${bytesHex(bytes)}`);
    this.clock.open(this.m.seconds(), this.lead);
    return back;
  }
  pending() { return this.actions.length > 0; }
  // at the MN's idle point: a change not yet told, else the sub-CPU runs on (to the lab's now, or to the end of its
  // answer windows) until one of its lines changes; false when none did
  step() {
    if (!this.actions.length) this.advance(this.clock.limit(this.now()), true);
    if (!this.actions.length) return false;
    const [line, v] = this.actions.shift();
    if (this.out[line] !== v) { this.out[line] = v; if (this.lines) this.lines[line](v); }
    return true;
  }
  // ---- what the lab reads of it besides the seam (S-SCPUDEV's fields of the same names)
  // the power-on gate's flag, read from the sub-CPU's SRAM (scpu_lle.gate)
  get powered() { return this.m.sram[this.gate - SRAM] !== 0; }
  get state() { return this.m.resetHeld ? 'reset' : this.m.standby ? 'standby' : this.m.cpu.sleeping ? 'asleep' : 'running'; }
  get scanReport() { return null; }
  // the port scan's inputs (SCAN_PORTS: board pins PC13, PC5) at the board's level; the firmware's scan reports a change
  port(name, level) {
    if (!Object.hasOwn(SCAN_PORTS, name)) this.fail(`no scan port ${name} (${Object.keys(SCAN_PORTS).join(', ')})`);
    this.catchUp();
    this.m.gpio.drive(name, level ? 1 : 0);
    this.clock.open(this.m.seconds(), this.lead);
    return null;
  }
  post(cmd) { return this.fail(`post ${hx(cmd)}: the sub-CPU's own tasks post its messages, not the lab`); }
  // the debug console's output so far (LPUART1)
  consoleText(from = 0) { return this.m.consoleText(from); }
  // ---- time (A-SCPUM4-1)
  hclk() {
    const hz = this.m.rcc.hclkHz();
    if (!(hz > 0)) this.fail(`HCLK is ${hz} Hz: the sub-CPU's clock tree selects a source its board lacks`);
    return hz;
  }
  // run until the sub-CPU's time reaches the lab's now
  catchUp() { this.advance(this.clock.due(this.now()), false); }
  // run until the sub-CPU's time reaches t (seconds) or, with stop, one of its link lines changes. A run is bounded in
  // cycles at the HCLK it starts at, so a clock change inside it is met by the next run (and a sub-CPU asleep, in standby
  // or held in reset still lets the time pass)
  advance(t, stop) {
    const m = this.m, n0 = this.actions.length, changed = () => this.actions.length > n0;
    for (let s = m.seconds(); s < t; s = m.seconds()) {
      if (stop && changed()) return;
      this.check(m.run({ cycles: Math.max(1, Math.ceil((t - s) * this.hclk())), until: stop ? changed : null, check: LOOK_EVERY }));
    }
  }
  check(r) {
    if (r.reason !== 'stop') return;
    this.fail(`the sub-CPU's firmware stopped at ${r.error.message} (pc 0x${(this.m.cpu.pc >>> 0).toString(16)}, SCPU time ${this.m.seconds().toFixed(6)} s)`);
  }
}
