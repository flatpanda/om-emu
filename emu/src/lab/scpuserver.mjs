// S-SCPU: the sub-CPU's side of the firmware's SCPU requests, served where the request API takes them (menu.mjs
// SCPU_REQUEST), and the memory the sub-CPU keeps across power-off (ScpuMemory: its date and backed-up words). The
// addresses and the evidence are in docs/hle-gaps.md 4.7.1.
//
// The API posts its 28-byte request {+0 u8 command, +4 tx size, +8 tx, +12 rx size, +16 rx, +20 completion, +24
// argument} to the task PER_SCPU, which carries it to the sub-CPU as a frame on a serial channel, copies rx-size bytes
// of the reply to rx when rx is not 0 and then calls the completion (a run-time code address) with a0 = the
// argument, in its own task; a write (command bit 7 clear) completes once its frame is sent, with no reply (D). The
// lab runs neither PER_SCPU nor the sub-CPU, so the server stands for both at the API: it answers the command, writes
// the reply and calls the completion natively before the API returns. The requester's completion sets its flag
// (OlyEvSt in a task, D), and its wait for the flag then runs natively and returns at once: the flag latches, as on
// the camera when the reply comes before the wait. Not run: the API's own trace record, the message it allocates and
// posts, the queue's slot pool and PER_SCPU's start (its first request 0x85, the reset pulse, the watchdog).
//
// The commands the lab's sessions send, each with its senders and the layouts they build and read (D):
//   0x01  set the date: 9 tx bytes {u16 year, month, day, hour, minute, second, u16 status}
//   0x81  get the date: the same 9 bytes as the reply
//   0x06  write a backed-up word: 6 tx bytes {index, u32 value, byte}
//   0x86  read it: 2 tx bytes {index, byte}, a 4-byte reply (u32)
// The words a body uses are its fact scpu.words, [index, byte] (E143: index 2, byte 0, the packed time-zone record:
// its one writer and its one reader, D; E134 keeps the same record at index 23); another index or byte has no caller
// and is refused. A body's fact scpu.quiet lists the writes it sends with no data, no completion and no wait (E143:
// none; E134's dial init sends 0x21): the server takes them without an effect, since whatever the sub-CPU does in
// answer would reach the firmware as an inbound message, which the lab does not model (what they mean is ?).
// Any other command, a size its senders do not use, or a request made outside a task's context (where the API posts
// with isnd_dtq and PER_SCPU would complete it later in its own task) stops the session naming it. (The firmware's
// own refusal, for a request its start-up gate holds back, calls the completion with rx unwritten; nothing here
// imitates it.)
import { FirmwareError, disasm, where } from './hle.mjs';
import { non_task_context } from './kernel.mjs';
import { bytesHex } from '../util/bytes.mjs';

export class ScpuError extends FirmwareError {}

export const REQUEST_BYTES = 28, DATE_BYTES = 9;
export const SET_DATE = 0x01, GET_DATE = 0x81, WRITE_WORD = 0x06, READ_WORD = 0x86;
const hx = (v, n = 2) => '0x' + (v >>> 0).toString(16).padStart(n, '0');

// The sub-CPU's battery-backed memory. What it keeps is I (the commands' names and layouts, D): the date as the last
// 0x01 wrote it, status included, advancing with time, and one word per index. A blank memory has no date (a get
// before any set stops the session: what a blank sub-CPU answers is not known) and reads 0 for every word (A-SCPU-2:
// blank backup memory reads 0; a word of 0 is "no time-zone record", D). now(): the clock the date advances with, in
// whole seconds (lab time in a hermetic session, the host's local time under S-NVRAM); saved: a host's kept state
// {clock_offset, clock_status, words} or null; persist(state): called with the state after each change (S-NVRAM) or
// null.
export class ScpuMemory {
  constructor(now, saved = null, persist = null) {
    this.now = now;
    this.offset = saved?.clock_offset ?? null;          // the date in seconds since 1970 less now(), or null
    this.status = saved?.clock_status ?? 0;
    this.words = new Map(Object.entries(saved?.words ?? {}).map(([i, v]) => [Number(i), v >>> 0]));
    this.persist = persist;
  }
  // the date now in seconds since 1970 (local time, as the window clock counts it), or null before any set
  seconds() { return this.offset === null ? null : this.now() + this.offset; }
  date() {
    const t = this.seconds();
    if (t === null) throw new ScpuError('S-SCPU: get date (0x81) from a sub-CPU no date was set on: what a blank sub-CPU answers is not known');
    return dateBytes(t, this.status);
  }
  setDate(b) {
    const [t, status] = dateOf(b);
    this.offset = t - this.now();
    this.status = status;
    this.save();
  }
  word(index) { return this.words.get(index) ?? 0; }
  setWord(index, value) { this.words.set(index, value >>> 0); this.save(); }
  state() { return { clock_offset: this.offset, clock_status: this.status, words: Object.fromEntries(this.words) }; }
  save() { if (this.persist) this.persist(this.state()); }
}

// The 9 date bytes {u16 year, month, day, hour, minute, second, u16 status} <-> seconds since 1970 (calendar arithmetic
// in UTC: the counts are local time, with no zone in them). A date that is not a calendar date is refused.
export function dateBytes(t, status) {
  const d = new Date(t * 1000), b = new Uint8Array(DATE_BYTES), dv = new DataView(b.buffer);
  dv.setUint16(0, d.getUTCFullYear(), true);
  b.set([d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()], 2);
  dv.setUint16(7, status, true);
  return b;
}
export function dateOf(b) {
  const dv = new DataView(b.buffer, b.byteOffset, DATE_BYTES), year = dv.getUint16(0, true);
  const t = Date.UTC(year, b[2] - 1, b[3], b[4], b[5], b[6]) / 1000;
  if (Number.isNaN(t) || bytesHex(dateBytes(t, 0).subarray(0, 7)) !== bytesHex(b.subarray(0, 7))) {
    throw new ScpuError(`S-SCPU: set date (0x01) ${bytesHex(b)}: not a calendar date`);
  }
  return [t, dv.getUint16(7, true)];
}

// [name, tx bytes, reply bytes (0: a write, no reply), serve(memory, tx) -> the reply or null]
const COMMANDS = new Map([
  [SET_DATE, ['set date', DATE_BYTES, 0, (m, tx) => { m.setDate(tx); return null; }]],
  [GET_DATE, ['get date', 0, DATE_BYTES, (m) => m.date()]],
  [WRITE_WORD, ['write backed-up word', 6, 0, (m, tx, s) => { m.setWord(s.word(tx), new DataView(tx.buffer, tx.byteOffset + 1, 4).getUint32(0, true)); return null; }]],
  [READ_WORD, ['read backed-up word', 2, 4, (m, tx, s) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, m.word(s.word(tx)), true); return b; }]],
]);

export class ScpuServer {
  // lab: the MenuLab (sim, nk, store_log); memory: an ScpuMemory; body: {words: the backed-up words the body uses,
  // [index, byte]; quiet: its writes without data or an answer} (facts scpu.words and scpu.quiet)
  constructor(lab, memory, { words, quiet }) {
    this.lab = lab;
    this.memory = memory;
    this.words = words;
    for (const c of quiet) if (c & 0x80 || COMMANDS.has(c)) throw new ScpuError(`S-SCPU: quiet command ${hx(c)}: not a write of its own`);
    this.commands = new Map([...COMMANDS, ...quiet.map((c) => [c, ['write without an answer', 0, 0, () => null]])]);
    this.served = [];                      // [command, caller] of every request served
  }
  // the index of a word request {index, ..., byte}, refused unless the body uses it
  word(tx) {
    const index = tx[0], byte = tx[tx.length - 1];
    if (!this.words.some(([i, b]) => i === index && b === byte)) throw new ScpuError(`S-SCPU: backed-up word index ${index} byte ${byte}: no caller uses it (only ${this.words.map(([i, b]) => `index ${i} byte ${b}`).join(', ')})`);
    return index;
  }
  // the hook at the request API: a0 the request
  serve(hle, r) {
    const sim = this.lab.sim, at = where(r.mdr);
    const req = sim.read(r.a0 >>> 0, REQUEST_BYTES), dv = new DataView(req.buffer, req.byteOffset, REQUEST_BYTES);
    const cmd = req[0], [txSize, tx, rxSize, rx, done, arg] = [4, 8, 12, 16, 20, 24].map((o) => dv.getUint32(o, true));
    this.lab.store_log.scpu_requests.push({ caller: at, request: bytesHex(req) });
    const spec = this.commands.get(cmd);
    if (!spec) throw new ScpuError(`S-SCPU: command ${hx(cmd)} from ${at}: not modelled (only ${[...this.commands].map(([c, [n]]) => `${hx(c)} ${n}`).join(', ')} have the firmware's evidence)`);
    const [name, txWant, replyBytes, answer] = spec;
    if (non_task_context(this.lab)) throw new ScpuError(`S-SCPU: ${name} (${hx(cmd)}) from ${at} outside a task's context: PER_SCPU would complete it later in its own task`);
    // a write has no reply and its senders pass no rx; a read's senders ask for the whole reply
    if (txSize !== txWant || (replyBytes ? rxSize !== replyBytes : rx !== 0)) {
      throw new ScpuError(`S-SCPU: ${name} (${hx(cmd)}) from ${at} with tx ${txSize} bytes, rx ${rxSize} bytes at ${hx(rx, 8)}: its senders send ${txWant} and ${replyBytes ? `read ${replyBytes}` : 'no rx'}`);
    }
    const reply = answer(this.memory, txSize ? sim.read(tx, txSize).slice() : new Uint8Array(0), this);
    if (reply && rx) sim.write(rx, reply);
    this.served.push([cmd, at]);
    if (done) hle.finish_after(r, disasm(done), { a0: arg }); else hle.finish(r, { d0: 0 });
  }
}
