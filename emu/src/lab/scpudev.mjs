// S-SCPUDEV: the sub-CPU at the far end of the MN's link (docs/om1-scpu-spec.md section 3, the evidence; section 8
// step 2), a high-level model of its side of the transport: its two output lines, its SPI slave, its command manager
// and the handlers of the commands the lab's sessions send. The MN side (PER_SIO's channel and the three GIO pins) is
// src/lab/scpulink.mjs and src/dev/linkpins.mjs; this module needs neither and runs without firmware (the tests).
//
// The seam (what the sub-CPU's own firmware on the Cortex-M4 and STM32L4 machine, src/lab/scpum4.mjs, puts in this
// model's place with OM_EMU_SCPU=native):
//   connect({ready(level), message(level)}, {request, reset})
//                                            the sub-CPU's two outputs: PC3, MN pin 102 (ready), and PC2, the line
//                                            the MN reads as port 3 of its SCPU window (message); and the MN's two
//                                            lines' levels when the link is made
//   pin(name, level)                         the MN's outputs: 'request' (MN pin 103, the sub-CPU's PB12) and
//                                            'reset' (MN pin 107, its reset)
//   exchange(bytes, hz) -> bytes             one SPI transfer the MN clocks as master at hz (its configured clock;
//                                            this model takes it at once): the bytes the sub-CPU shifts out, as many
//                                            as it shifted in
//   step() -> boolean                        the sub-CPU moves on to its next action seen on the link (one level
//                                            change, or the handling of one event); false when it has none
// A-SCPUDEV-1 (I): the sub-CPU acts only when the link steps it, which the lab does at the MN's idle points
// (src/lab/scpulink.mjs), one action per step, in zero lab time: the sub-CPU answers within microseconds while the MN
// arms each wait on pin 102 before it blocks (D), so the order of the actions, not their timing, is what the MN sees.
//
// The transport (D unless tagged; the sub-CPU's code is at its own addresses, 0x08xxxxxx):
//   - the command manager 0x8004ea8: idle; request (PB12 falls) arms a 10-byte receive into the 20-byte context
//     0x20007f38 and drops PC3 (0x8012bc9); the frame received is checked by the power-on gate (0x8012d72) and run
//     by its class (0x8012fa0: 0x8f poll, other bit-7 reads, 0x0f a long write's header, other writes): a write's
//     handler runs, PC3 rises (0x8012f74); a read's reply is built, PC3 rises, the transmit is armed and PC3 drops
//     (0x8012e84), and when the MN has clocked it out PC3 rises (0x8012fbd); the MN's release of PB12 ends the
//     transaction (0x801305d). A reply is [length, command, data] with length = data + 2, at least 4, zeros after
//     the data (0x8018af8..0x8018b20); a reply of 254 data bytes or more goes out as a long read, a header chunk
//     [0xff, command, 253 data bytes] and then raw chunks of up to 255 bytes, the last padded to 4 (0x8012ed4,
//     0x8012fbd; the padding's bytes are zeros, I: the reply buffer is cleared, 0x8018b24, and the handlers' data
//     lie in it). A long write's header [7, 0x0f, u32 size, command] is followed by raw chunks of up to 255 bytes,
//     PC3 rising and dropping between them, and the handler runs on the whole (0x8012f1a, 0x8013181).
//   - the gate: before the release of a 0x85 {2} transaction (0x801305d sets the flag) only 0x85 and 0x02 are
//     taken; 0x85 with mode 1 always, mode 2 only once; anything else, the poll included, stops the sub-CPU in a
//     loop (0x8012e04): here the session stops, naming the frame.
//   - a frame longer than 10 bytes is cut by the transfer: its bytes past the tenth are the context's, 0 (the comm
//     init clears the 20 bytes, 0x8012ac4; the receive writes 10, 0x8012bd6; I: no other store to +10..+19 was found).
//     The MN's 0x01 is such a frame: its status's high byte reaches the sub-CPU as 0.
//   - the bytes the sub-CPU shifts out while it receives are 0 (I: the MN ignores them, D).
//   - reset: PC3 low while held (I: the pins are inputs then; the MN's start waits for a high level after its pulse,
//     D); released, the sub-CPU boots and is idle with PC3 high (I: where its code first raises PC3 is not found) and
//     the gate closed (its flag is RAM, 0x20008390); its RTC and backup registers keep their contents (I: the backup
//     domain, which a reset of the core leaves alone).
// The inbound direction (docs/om1-scpu-spec.md 3.4, D unless tagged): a task of the sub-CPU hands the command manager
// a message for the MN (0x80133dc: a 28-byte request {+0 command, +4 length, +8 data, +20 completion, +24 argument},
// the MN's own request layout, as event 9 of the manager's queue). The manager's loop takes it before its table
// (0x8012912..0x8012944): while the power-off flag is set (context +22) the message is dropped and its completion
// called; in any state but idle it joins the waiting queue (context +40) and PC2 drops; idle (0x8012c0b) with PB12 high
// it becomes the current message (context +116) and PC2 drops (state 1, a message waiting), with PB12 low it joins the
// queue. The MN's poll [2, 0x8f] is answered with the current message's frame [length, command, data], padded to 4,
// or [4, 0, 0, 0] without one, PC2 rising first (0x8012e84, 0x8012e1a); at the poll's release its completion runs
// and the message is gone (0x8018c54, 0x801315c). Every release then drops PC2 again for a current message or the
// queue's next one (state 1), else the manager is idle (0x8013122..0x8013156; the idle release 0x8012bef the same).
// post(command, data) hands the model such a message; port(name, level) moves an input of the port scan (below).
// The handlers (the sub-CPU's, docs/om1-scpu-spec.md 3.3; ScpuMemory below): 0x85 system control (a read, 3 bytes: the
// mode, for mode 1 its second byte and else the context's command byte, then 1: 0x8016217 reads its second byte
// through the caller's r4, the context, D; for mode 1 the handler also keeps that byte for the system-control task;
// at the release, 0x801305c..0x8013112: modes 1..5 drop every waiting message with its completion, then mode 1 sets
// the power-off flag and closes the gate, 2 clears the flag and opens the gate, 3 sets the flag and closes the gate,
// 4 sets the flag, 5 clears it, and each posts the system-control task its message, 6, 5, 9, 7 and 5; mode 6 does
// nothing), 0x01 / 0x81 the date, 0x06 / 0x86 a backup register, 0x88 the port scan. The words a body uses are its
// fact scpu.words, [index, byte], and a request for another is refused (no caller sends one); a body's fact
// scpu.quiet lists writes taken without an effect (E134's 0x21: what it means is ?). Every other command stops the
// session naming it and its handler: the MN's sessions send none, and an answer the sub-CPU makes from its hardware
// (0x82, 0x80, ...) is not known.
// The power states (the system-control task, sys_ctrl_task.c: its table 0x8008804, 6 states x 14 events, the state
// names it prints at 0x16d40..0x16db0, D): 0 steady (after a reset), 1 steady_wait, 2 bkground, 3 pwr_save,
// 4 hibernation, 5 standby. The messages 0x85 posts move it so (D): from steady, 5 (modes 2, 5) stays steady; 6 (mode
// 1) goes to bkground when PC13 reads low (0x80166d0), else to pwr_save when mode 1's second byte was 1, else to
// standby (0x80163a3); 9 (mode 3) to pwr_save (0x801648d); 7 (mode 4) to hibernation (0x80163ed). From steady_wait and
// bkground, 5 goes to steady; every other pair of these is the task's illegal message (0x8016373: logged, the state
// kept). Its other messages (the sub-CPU's own wake and charge events) are not modelled, and nor is the wake from a
// power-off: with the flag set the manager ignores PB12's request (0x8012922) until the system-control task clears it
// (0x8013572), so a request then stops the session.
// The port scan (per_port_scan.c, D): its task samples GIO ports 45 and 37, PC13 and PC5 (the table 0x80128e0), with
// a debounce of 3 samples (0x8012828, thresholds set at 0x80127da) into a result byte, bit 0 PC13 and bit 1 PC5
// (0x8012866..0x801289a). The 0x88 handler (0x80126d7) answers {result, busy}, the result only while the scan is not
// busy, and then enables the scan's report (its flag, set by 0x801289e). A change of the result goes to the power
// manager (0x80126a2 -> message 10, the levels inverted), whose handler (0x801a436) posts the MN the message 0x08
// {PC13's level} when PC13's level changed, through the port scan's sender (0x801271c), which sends only while the
// report is enabled. The MN takes bit 0 of the reply and of the message alike (its 0x5005d44c): UI_IN's group-4
// switch 0x0400. In the model the result follows the levels at once (I: the 3-sample debounce on the scan's cyclic
// timer is not timed), the scan is never busy (I: busy is set by 0x8012664, whose caller is not read), the report is
// disabled by a reset, and PC5's other effects in the power manager (0x801a49a -> 0x801acb0) are not modelled.
import { FirmwareError } from './hle.mjs';
import { bytesHex } from '../util/bytes.mjs';

export class ScpuError extends FirmwareError {}

export const DATE_BYTES = 9, RX_BYTES = 10, CONTEXT_BYTES = 20;
export const SET_DATE = 0x01, GET_DATE = 0x81, WRITE_WORD = 0x06, READ_WORD = 0x86, SYSCTRL = 0x85, POLL = 0x8f, CHUNK = 0x0f, GIO_WRITE = 0x02;
export const PORT_SCAN = 0x88, SCAN_REPORT = 0x08;
// the port scan's inputs, by the GIO port the scan reads (0x80128e0) and the result bit it gives (D)
export const SCAN_PORTS = { PC13: { gio: 45, bit: 0 }, PC5: { gio: 37, bit: 1 } };
// The levels the model starts with (a model choice): PC13 low gives the result bit 0, which the MN turns into UI_IN's
// switch 0x0400 at state 0, the state the lab's idle image of the E143 family keeps it in (src/lab/play.mjs
// IDLE_SWITCH_STATES); PC5's level is ? (the MN masks its bit off)
export const SCAN_IDLE = { PC13: 0, PC5: 0 };
// the power states (the system-control task's, by number) and the message each 0x85 mode posts it (0x80130c0..)
export const POWER_STATES = ['steady', 'steady_wait', 'bkground', 'pwr_save', 'hibernation', 'standby'];
const SYSCTRL_MESSAGE = { 1: 6, 2: 5, 3: 9, 4: 7, 5: 5 };
// the longest message the poll's reply carries: its length byte is length + 2 (0x8012e40..0x8012e54)
export const MESSAGE_MAX = 253;
// the date a get answers while the RTC is not valid, and its status (0x80114ec, 0x8011540: 2019-01-01 00:00:00, 10501)
export const RTC_DEFAULT = [2019, 1, 1, 0, 0, 0], RTC_INVALID = 10501, RTC_VALID_REG = 1;
const hx = (v, n = 2) => '0x' + (v >>> 0).toString(16).padStart(n, '0');

// The 9 date bytes {u16 year, month, day, hour, minute, second, u16 status} <-> seconds since 1970 (calendar arithmetic
// in UTC: the counts are local time, with no zone in them)
export function dateBytes(t, status) {
  const d = new Date(t * 1000), b = new Uint8Array(DATE_BYTES), dv = new DataView(b.buffer);
  dv.setUint16(0, d.getUTCFullYear(), true);
  b.set([d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()], 2);
  dv.setUint16(7, status, true);
  return b;
}
const fields = (b) => [b[0] | b[1] << 8, b[2], b[3], b[4], b[5], b[6]];
// The sub-CPU's check of a date (0x801155a, D): 0 not a date (year 2000..2099, month 1..12, a day of the month, hour
// < 24, minute and second < 60), 1 a date from 2019 on, 2 one before
export function dateClass(b) {
  const [y, mo, d, h, mi, s] = fields(b);
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || h >= 24 || mi >= 60 || s >= 60) return 0;
  return y >= 2019 ? 1 : 2;
}
const secondsOf = (b) => { const [y, mo, d, h, mi, s] = fields(b); return Date.UTC(y, mo - 1, d, h, mi, s) / 1000; };

// The sub-CPU's battery-backed state (D unless tagged, its RTC driver and backup-register handlers): the backup
// registers (HAL_RTCEx_BKUPWrite / Read, 0x800b414 / 0x800b41e; a request {index, byte} names register index + byte,
// 0x8017af8 / 0x8017afe) and the RTC's calendar. Register 1 says whether the RTC holds a date the MN set: 0 not, 1 a
// date from 2019 on, 2 one before (0x80114ae, 0x80114b8). A set (0x80116ab): with a status other than 0 it clears
// register 1; with status 0 and a date, it sets register 1 by the date's class and the RTC to the date; a status-0
// non-date changes nothing. A get (0x8011709 -> 0x80114ec): with register 1 at 0, RTC_DEFAULT with status RTC_INVALID;
// else the RTC's date with status 0, but a date before 2019 under register 1 = 1 clears register 1 and answers the
// default (the RTC read's own error path, which needs the hardware, is not modelled). A blank sub-CPU's registers read
// 0 (A-SCPU-2). The RTC advances with now(), whole seconds (lab time in a hermetic session, the host's local time under
// S-NVRAM). saved: a host's kept state {clock_offset, clock_status, words} or null (S-NVRAM's file: words the registers
// by number; a file from before the registers were kept whole, without register 1, takes it from clock_status: 0 a
// valid RTC, I); persist(state): called with the state after each change, or null.
export class ScpuMemory {
  constructor(now, saved = null, persist = null) {
    this.now = now;
    this.offset = saved?.clock_offset ?? null;            // the RTC's date in seconds since 1970 less now(), or null
    this.regs = new Map(Object.entries(saved?.words ?? {}).map(([i, v]) => [Number(i), v >>> 0]));
    if (saved && !this.regs.has(RTC_VALID_REG) && this.offset !== null && (saved.clock_status ?? 0) === 0) {
      this.regs.set(RTC_VALID_REG, dateClass(dateBytes(this.now() + this.offset, 0)));
    }
    this.persist = persist;
  }
  // the RTC's date now in seconds since 1970 (local time), or null before any set
  seconds() { return this.offset === null ? null : this.now() + this.offset; }
  reg(n) { return this.regs.get(n) ?? 0; }
  setReg(n, v) { this.regs.set(n, v >>> 0); this.save(); }
  setDate(b) {
    const status = b[7] | b[8] << 8;
    if (status !== 0) { this.setReg(RTC_VALID_REG, 0); return; }
    const c = dateClass(b);
    if (!c) return;
    this.offset = secondsOf(b) - this.now();
    this.setReg(RTC_VALID_REG, c);
  }
  date() {
    const fallback = () => { const b = new Uint8Array(DATE_BYTES), dv = new DataView(b.buffer); dv.setUint16(0, RTC_DEFAULT[0], true); b.set(RTC_DEFAULT.slice(1), 2); dv.setUint16(7, RTC_INVALID, true); return b; };
    const valid = this.reg(RTC_VALID_REG);
    if (valid === 0) return fallback();
    const t = this.seconds();
    if (t === null) throw new ScpuError(`S-SCPUDEV: get date (0x81) with backup register ${RTC_VALID_REG} = ${valid} and an RTC no date was set on: what the RTC reads then is not known`);
    const b = dateBytes(t, 0);
    if (dateClass(b) === 2 && valid === 1) { this.setReg(RTC_VALID_REG, 0); return fallback(); }
    return b;
  }
  state() { return { clock_offset: this.offset, clock_status: this.reg(RTC_VALID_REG) ? 0 : RTC_INVALID, words: Object.fromEntries(this.regs) }; }
  save() { if (this.persist) this.persist(this.state()); }
}

// the command manager's states (the sub-CPU's table 0x8004ea8 has six: 0 idle, 1 a message waiting, 2 receiving, 3
// transmitting, 4 waiting for the release, 5 a long write); RESET is the model's, while the reset line is held
const S = { IDLE: 'idle', MESSAGE: 'message waiting', RX: 'receive', TX: 'transmit', RELEASE: 'release', LONG: 'long write', RESET: 'reset' };
// the sub-CPU's handlers of the MN's commands (docs/om1-scpu-spec.md 3.3), named in a refusal
const HANDLERS = new Map([[0x01, 0x80116ab], [0x81, 0x8011709], [0x02, 0x800cfe7], [0x82, 0x800cfef], [0x04, 0x8018b2f], [0x84, 0x8018b67],
  [0x06, 0x8017b05], [0x86, 0x8017b27], [0x07, 0x80125a1], [0x87, 0x80125a7], [0x80, 0x8015ec3], [0x85, 0x8016217], [0x88, 0x80126d7],
  [0x11, 0x80150a5], [0x12, 0x801570b], [0x13, 0x801535f], [0x14, 0x8015345], [0x40, 0x8015b81], [0x90, 0x8021aed]]);

export class ScpuDev {
  // memory: an ScpuMemory; body: {words: the backup words the body uses, [index, byte]; quiet: its writes without
  // an effect} (facts scpu.words, scpu.quiet)
  constructor(memory, { words, quiet }) {
    this.memory = memory;
    this.words = words;
    for (const c of quiet) if (c & 0x80 || c === CHUNK || [SET_DATE, WRITE_WORD, SYSCTRL, GIO_WRITE].includes(c)) throw new ScpuError(`S-SCPUDEV: quiet command ${hx(c)}: not a write of its own`);
    this.quiet = new Set(quiet);
    this.labels = ['S-SCPUDEV', 'A-SCPUDEV-1'];   // what the session's stand-ins name (player.mjs)
    this.lines = null;
    this.state = S.IDLE;
    this.out = { ready: 1, message: 1 };     // the levels of PC3 and PC2: running, idle, no message
    this.input = { request: 1, reset: 0 };   // the MN's lines as the sub-CPU last saw them
    this.powered = false;                    // the gate's flag (0x20008390 +0)
    this.ctx = new Uint8Array(CONTEXT_BYTES);
    this.rx = null;                          // the armed receive {buf, count, got}
    this.tx = null;                          // the armed transmit {bytes, pos}
    this.long = null;                        // a long write {cmd, size, buf, got} or a long read {left}
    this.events = [];                        // the command manager's queue: request, release, rx, tx, boot, message
    this.actions = [];                       // level changes not yet made: [line, level]
    this.frames = [];                        // every frame taken: {cmd, data, reply} (hex), the link's oracle
    // the inbound direction: messages posted and not yet taken by the manager, the current message (context +116),
    // the waiting queue (context +40), the power-off flag (context +22); each message {cmd, data, fate}, fate null
    // until it is 'sent' (its poll released), 'dropped' (its completion called unsent) or 'lost' (a reset)
    this.inbox = [];
    this.slot = null;
    this.queue = [];
    this.dropping = false;
    this.power = POWER_STATES[0];            // the system-control task's state
    this.offArg = 0;                         // mode 1's second byte, kept by the 0x85 handler (the task's +21)
    this.scan = { ...SCAN_IDLE };            // the port scan's input levels
    this.scanReport = false;                 // the scan's report enabled (by a 0x88 read)
    this.log = [];                           // the sub-CPU's own events: messages, power states (text)
  }
  // ---- the model's inputs on the sub-CPU's side (an LLE's own tasks make these)
  // A message for the MN (0x80133dc's request): command (bit 7 clear, not 0 or 0x0f) and data bytes; returns the
  // message, whose fate says what became of it
  post(cmd, data = []) {
    const bytes = Uint8Array.from(data);
    if (!Number.isInteger(cmd) || cmd <= 0 || cmd > 0x7f || cmd === CHUNK) this.fail(`post ${cmd}: not a message command (1..0x7f, not 0x0f)`);
    if (bytes.length > MESSAGE_MAX) this.fail(`post ${hx(cmd)} with ${bytes.length} bytes: the poll's reply carries ${MESSAGE_MAX} at most`);
    if (this.state === S.RESET) this.fail(`post ${hx(cmd)} while the reset is held: the sub-CPU does not run`);
    const m = { cmd, data: bytes, fate: null };
    this.inbox.push(m);
    this.events.push('message');
    return m;
  }
  // A level of the port scan's inputs (SCAN_PORTS): the result follows it, and a change of PC13's level posts the
  // report 0x08 {level} once a 0x88 read has enabled it (the power manager's 0x801a436 through 0x801271c)
  port(name, level) {
    if (!Object.hasOwn(SCAN_PORTS, name)) this.fail(`no scan port ${name} (${Object.keys(SCAN_PORTS).join(', ')})`);
    const v = level ? 1 : 0;
    if (this.scan[name] === v) return null;
    this.scan[name] = v;
    return name === 'PC13' && this.scanReport ? this.post(SCAN_REPORT, [v]) : null;
  }
  scanResult() { return Object.entries(SCAN_PORTS).reduce((r, [n, p]) => r | this.scan[n] << p.bit, 0); }
  // lines: {ready(level), message(level)}; inputs: the MN's lines' levels now {request, reset}, taken without an event
  // (the sub-CPU has been running before the MN's code looks at it: idle, as the reset pulse would leave it)
  connect(lines, inputs) {
    this.lines = lines;
    this.input = { request: inputs.request ? 1 : 0, reset: inputs.reset ? 1 : 0 };
    if (this.input.reset) this.hold();
  }
  fail(what) { throw new ScpuError(`S-SCPUDEV: ${what}`); }
  // ---- the MN's side
  pin(name, level) {
    const v = level ? 1 : 0;
    if (name === 'reset') {
      if (v === this.input.reset) return;
      this.input.reset = v;
      if (v) this.hold();
      else this.events.push('boot');
      return;
    }
    if (name !== 'request') this.fail(`no input ${name}`);
    if (v === this.input.request) return;
    this.input.request = v;
    if (this.state !== S.RESET) this.events.push(v ? 'release' : 'request');
  }
  exchange(bytes) {
    const n = bytes.length;
    if (this.rx) {
      const r = this.rx;
      if (r.got + n > r.count) this.fail(`the MN clocks ${n} bytes into a receive of ${r.count} with ${r.got} taken`);
      r.buf.set(bytes, r.got);
      r.got += n;
      if (r.got === r.count) { this.rx = null; this.events.push('rx'); }
      return new Uint8Array(n);
    }
    if (this.tx) {
      const t = this.tx;
      if (t.pos + n > t.bytes.length) this.fail(`the MN clocks ${n} bytes out of a transmit of ${t.bytes.length} with ${t.pos} sent`);
      const outBytes = t.bytes.slice(t.pos, t.pos + n);
      t.pos += n;
      if (t.pos === t.bytes.length) { this.tx = null; this.events.push('tx'); }
      return outBytes;
    }
    return this.fail(`the MN clocks ${n} bytes (${bytesHex(bytes)}) while the sub-CPU's SPI is not armed (state ${this.state})`);
  }
  pending() { return this.actions.length > 0 || this.events.length > 0; }
  step() {
    if (this.actions.length) { const [line, v] = this.actions.shift(); this.drive(line, v); return true; }
    if (this.events.length) { this.handle(this.events.shift()); return true; }
    return false;
  }
  // ---- the sub-CPU's side
  drive(line, v) {
    if (this.out[line] === v) return;
    this.out[line] = v;
    if (this.lines) this.lines[line](v);
  }
  later(line, v) { this.actions.push([line, v]); }
  hold() {
    this.state = S.RESET;
    this.events.length = 0; this.actions.length = 0;
    this.rx = null; this.tx = null; this.long = null;
    this.powered = false;
    for (const m of [...this.inbox, ...(this.slot ? [this.slot] : []), ...this.queue]) m.fate = 'lost';
    this.inbox = []; this.slot = null; this.queue = [];
    this.dropping = false; this.power = POWER_STATES[0]; this.offArg = 0; this.scanReport = false;
    this.drive('ready', 0);
    this.drive('message', 1);                // I: an input while the reset is held, as PC3
  }
  // a message dropped: its completion called without a send (0x8012962)
  drop(m, why) { m.fate = 'dropped'; this.log.push(`dropped ${hx(m.cmd)} ${bytesHex(m.data)}: ${why}`); }
  // the manager's loop takes a posted message before its table (0x8012912..0x8012944) and idle's handler (0x8012c0b)
  message() {
    const m = this.inbox.shift();
    if (this.dropping) return this.drop(m, 'the power-off flag');
    if (this.state === S.IDLE && this.input.request) { this.slot = m; this.later('message', 0); this.state = S.MESSAGE; return; }
    this.queue.push(m);
    if (this.state !== S.IDLE) this.later('message', 0);
  }
  // after a release: the current message or the queue's next drops PC2 (state 1), else idle (0x8013122..0x8013156)
  next() {
    if (!this.slot && this.queue.length) this.slot = this.queue.shift();
    if (this.slot) { this.later('message', 0); this.state = S.MESSAGE; } else this.state = S.IDLE;
  }
  armRx(buf, count) { this.rx = { buf, count, got: 0 }; }
  armTx(bytes) { this.tx = { bytes, pos: 0 }; }
  handle(ev) {
    const bad = () => this.fail(`event ${ev} in state ${this.state}: the command manager has no transition (its invalid handler 0x80132f1)`);
    if (this.state !== S.RESET) {
      if (ev === 'message') return this.message();
      if (ev === 'request' && this.dropping) return this.fail(`a request after a power-off (0x85 mode ${this.ctx[2]}, the sub-CPU ${this.power}): the command manager ignores it while its power-off flag is set (0x8012922), and the system-control task's wake that clears the flag (0x8013572) is not modelled`);
    }
    switch (this.state) {
      case S.RESET:
        if (ev !== 'boot') return bad();
        this.state = S.IDLE; this.ctx.fill(0);
        this.later('ready', 1);
        if (!this.input.request) this.events.push('request');   // PB12 already low when its interrupt is armed (as 0x8013358)
        return;
      case S.IDLE:
        if (ev === 'request') { this.armRx(this.ctx, RX_BYTES); this.later('ready', 0); this.state = S.RX; return; }
        if (ev === 'release') { this.later('ready', 1); return this.next(); }   // 0x8012bef
        return bad();
      case S.MESSAGE:                                                           // the receive, the message kept (0x8012d11)
        if (ev === 'request') { this.armRx(this.ctx, RX_BYTES); this.later('ready', 0); this.state = S.RX; return; }
        return bad();
      case S.RX:
        if (ev === 'request') return;                                         // 0x8012d2d
        if (ev === 'rx') return this.frame();
        return bad();
      case S.TX:
        if (ev === 'tx') return this.sent();
        return bad();
      case S.RELEASE:
        if (ev === 'release') return this.release();
        return bad();
      case S.LONG:
        if (ev === 'rx') return this.chunk();
        return bad();
      default: return bad();
    }
  }
  // the gate (0x8012d72): null to take the frame, else why the sub-CPU stops
  gate(cmd, mode) {
    if (cmd === SYSCTRL) {
      if (mode === 2) return this.powered ? 'a second power-on (0x85 {2})' : null;
      if (mode === 1 || this.powered) return null;
      return `0x85 mode ${mode} before the power-on`;
    }
    if (cmd === GIO_WRITE || this.powered) return null;
    return `${hx(cmd)} before the power-on (0x85 {2})`;
  }
  frame() {
    const c = this.ctx, len = c[0], cmd = c[1];
    const why = this.gate(cmd, c[2]);
    if (why) this.fail(`frame ${bytesHex(c.subarray(0, RX_BYTES))}: ${why}: the sub-CPU's gate stops it in a loop (0x8012e04) and the MN's watchdog would end the session`);
    if (len < 2 || len - 2 > CONTEXT_BYTES - 2) this.fail(`frame ${bytesHex(c.subarray(0, RX_BYTES))}: length ${len} outside its context`);
    if (cmd === CHUNK) return this.longStart();
    const data = c.slice(2, len);
    if (cmd === POLL) {
      // PC2 released (0x8012e9e), the current message's frame or the empty one (0x8012e1a, 0x8012e60..0x8012e7c)
      this.later('message', 1);
      return this.reply(cmd, data, this.slot ? this.replyFrame(this.slot.cmd, this.slot.data) : new Uint8Array([4, 0, 0, 0]));
    }
    if (cmd & 0x80) return this.reply(cmd, data, this.replyFrame(cmd, this.read(cmd, data)));
    this.write(cmd, data);
    this.frames.push({ cmd: hx(cmd), data: bytesHex(data), reply: null });
    this.later('ready', 1);
    this.state = S.RELEASE;
  }
  // [length, command, data] padded to 4 (0x8018af8); a long read past 253 data bytes (0x8012ed4)
  replyFrame(cmd, data) {
    const n = data.length;
    if (n + 2 >= 256) {
      this.long = { left: data.slice(253) };
      const b = new Uint8Array(255); b[0] = 0xff; b[1] = cmd; b.set(data.subarray(0, 253), 2);
      return b;
    }
    const b = new Uint8Array(Math.max(4, n + 2)); b[0] = b.length; b[1] = cmd; b.set(data, 2);
    return b;
  }
  reply(cmd, data, bytes) {
    this.frames.push({ cmd: hx(cmd), data: bytesHex(data), reply: bytesHex(bytes) });
    this.later('ready', 1);
    this.armTx(bytes);
    this.later('ready', 0);
    this.state = S.TX;
  }
  // a transmit done (0x8012fbd): the next chunk of a long read, else wait for the release with PC3 high
  sent() {
    const left = this.long?.left;
    if (left && left.length) {
      const n = Math.min(255, left.length), b = new Uint8Array(Math.max(4, n));
      b.set(left.subarray(0, n));
      this.long.left = left.slice(n);
      this.later('ready', 1); this.armTx(b); this.later('ready', 0);
      return;
    }
    this.long = null;
    this.later('ready', 1);
    this.state = S.RELEASE;
  }
  // the release (0x801305d): a poll's message delivered, 0x85's effects, then the next message or idle
  release() {
    const cmd = this.ctx[1], mode = this.ctx[2];
    if (cmd === POLL && this.slot) {
      this.slot.fate = 'sent';
      this.log.push(`sent ${hx(this.slot.cmd)} ${bytesHex(this.slot.data)}`);
      this.slot = null;
    }
    if (cmd === SYSCTRL && mode !== 6) {
      const id = SYSCTRL_MESSAGE[mode];
      if (id === undefined) this.fail(`0x85 mode ${mode}: the message its release posts the system-control task is not known (modes 1..6 are read)`);
      for (const m of this.queue.splice(0)) this.drop(m, `the release of 0x85 mode ${mode}`);
      if (mode === 1 || mode === 3) this.powered = false;
      if (mode === 2) this.powered = true;
      this.dropping = mode === 1 || mode === 3 || mode === 4;
      this.sysctrl(id);
    }
    this.next();
  }
  // the system-control task takes a message from 0x85 (its table 0x8008804, the messages 5, 6, 7 and 9 only)
  sysctrl(id) {
    const from = this.power;
    let to = null;
    if (from === 'steady') {
      if (id === 5) to = 'steady';
      else if (id === 6) to = !this.scan.PC13 ? 'bkground' : this.offArg === 1 ? 'pwr_save' : 'standby';
      else if (id === 7) to = 'hibernation';
      else if (id === 9) to = 'pwr_save';
    } else if ((from === 'steady_wait' || from === 'bkground') && id === 5) to = 'steady';
    if (to === null) { this.log.push(`system control: message ${id} illegal in state ${from}`); return; }
    if (to !== from) this.log.push(`system control: message ${id}, ${from} -> ${to}`);
    this.power = to;
  }
  // a long write's header [7, 0x0f, u32 size, command] (0x8012f1a) and its chunks (0x8013181)
  longStart() {
    const c = this.ctx, size = (c[2] | c[3] << 8 | c[4] << 16 | c[5] << 24) >>> 0, cmd = c[6];
    if (!size || size > 0x10000) this.fail(`long write ${bytesHex(c.subarray(0, RX_BYTES))}: size ${size}`);
    this.long = { cmd, size, buf: new Uint8Array(size), got: 0 };
    this.later('ready', 1);
    this.armRx(this.long.buf.subarray(0, Math.min(255, size)), Math.min(255, size));
    this.later('ready', 0);
    this.state = S.LONG;
  }
  chunk() {
    const l = this.long;
    l.got += Math.min(255, l.size - l.got);
    if (l.got < l.size) {
      const n = Math.min(255, l.size - l.got);
      this.later('ready', 1); this.armRx(l.buf.subarray(l.got, l.got + n), n); this.later('ready', 0);
      return;
    }
    this.long = null;
    if (l.cmd & 0x80) this.fail(`long write of read command ${hx(l.cmd)}: the sub-CPU sends no reply to it`);
    this.write(l.cmd, l.buf);
    this.frames.push({ cmd: hx(l.cmd), data: bytesHex(l.buf), reply: null, long: true });
    this.later('ready', 1);
    this.state = S.RELEASE;
  }
  // ---- the handlers
  size(cmd, data, n, name) { if (data.length !== n) this.fail(`${name} (${hx(cmd)}) with ${data.length} data bytes: its senders send ${n}`); }
  unknown(cmd, data) {
    const h = HANDLERS.get(cmd);
    return this.fail(`command ${hx(cmd)} (data ${bytesHex(data)}): not modelled (${h ? `the sub-CPU's handler ${hx(h, 7)}; ` : 'no handler in the sub-CPU\'s table; '}only 0x85, 0x01 / 0x81, 0x06 / 0x86 and 0x88${this.quiet.size ? ` and the body's quiet ${[...this.quiet].map((c) => hx(c)).join(', ')}` : ''} are)`);
  }
  // the register a word request {index, ..., byte} names, refused unless the body uses it
  word(data) {
    const index = data[0], byte = data[data.length - 1];
    if (!this.words.some(([i, b]) => i === index && b === byte)) this.fail(`backup word index ${index} byte ${byte}: no caller uses it (only ${this.words.map(([i, b]) => `index ${i} byte ${b}`).join(', ')})`);
    return index + byte;
  }
  write(cmd, data) {
    if (cmd === SET_DATE) { this.size(cmd, data, DATE_BYTES, 'set date'); this.memory.setDate(data); return; }
    if (cmd === WRITE_WORD) { this.size(cmd, data, 6, 'write backup word'); this.memory.setReg(this.word(data), new DataView(data.buffer, data.byteOffset + 1, 4).getUint32(0, true)); return; }
    if (this.quiet.has(cmd)) return;
    this.unknown(cmd, data);
  }
  read(cmd, data) {
    if (cmd === GET_DATE) { this.size(cmd, data, 0, 'get date'); return this.memory.date(); }
    if (cmd === READ_WORD) {
      this.size(cmd, data, 2, 'read backup word');
      const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, this.memory.reg(this.word(data)), true);
      return b;
    }
    if (cmd === SYSCTRL) {
      this.size(cmd, data, 3, 'system control');
      if (data[0] === 1) this.offArg = data[1];                             // kept for the system-control task (0x8016248..4e)
      return new Uint8Array([data[0], data[0] === 1 ? data[1] : SYSCTRL, 1]);
    }
    if (cmd === PORT_SCAN) {                                                // {result, busy}, the report enabled (0x80126d7)
      this.size(cmd, data, 0, 'port scan');
      this.scanReport = true;
      return new Uint8Array([this.scanResult(), 0]);
    }
    return this.unknown(cmd, data);
  }
}
