// The hot shoe's serial channel with nothing on the shoe (S-HOTSHOE; --take probe, E143; docs/hle-gaps.md 4.12.1).
// Addresses are E143's (D unless tagged).
//
// STB_EXTERNAL talks to the shoe over PER_SIO channel 11. PER_SIO's channel map (0x6011be1c, which the map setter
// 0x5005f0b2 picks for every board id, its table 0x6011be0c) gives channel 11 the controller index 6, whose registers
// are 0x98580000..0x985800a0 (the driver's register-address table 0x6011b614, 136 bytes an index). STB_EXTERNAL's
// configuration (0x5006480b, its record 0x62a296b4 from 0x501b6be7) sets the index's mode 0 at 20833 per second (the
// divider 0x5005efe9 divides the clock by 32 x the rate in mode 0, by 4 in mode 1, the clocked serial PER_SCPU's
// channel uses, and by 16 in mode 2, the IIC layer's; I: mode 0 the controller's own oversampled bit timing, an
// asynchronous serial line) and registers 0x50064985 as the index's transmit completion and 0x500649ae as its
// receive completion (0x5005e684 types 1 and 2), which call STB's 0x501b6810 and 0x501b6860. A transfer goes through
// PER_SIO's transmit 0x50064933 to the driver's transfer start 0x5005dc03, which takes mode 0's start 0x5005dc2c from
// its table 0x6011bdb0; a receive through 0x50064949 to the receive start 0x5005def6 and mode 0's 0x5005df40 (table
// 0x6011bdc4). Mode 0's start fills the transmit FIFO (byte register +0x18 while +0x1c reads nonzero, 0x5005de3f) and
// enables the transmit interrupt; the index's interrupt handler 0x5005e8db (IRQs 205 and 206 on the camera, both to
// it, and 207 to a per-direction table, attached at level 5 by the driver's init 0x5005d5c7 -> 0x5005d66f from the
// tables 0x6011bc18 / 0x6011bc9c / 0x6011bd20 when the index's byte 0 of the board configuration 0x6011be3c is 1,
// with its byte 1 as the attach's CPU: 0 for index 6, whose bytes are {1, 0, 1}, so CPU 0, the strobe's and the lab's)
// takes the transmit status (+0x28 bit 16) to mode 0's transmit
// handler 0x5005e9ab, which refills the FIFO and, the count done, calls the index's transmit completion
// (0x5005ea80..0x5005ea99, the table 0xa32c9658), and the receive status (+0x14 bit 16) to mode 0's receive handler
// 0x5005ed8a, which reads the FIFO and at the count's end sets the flag a first-byte event registered (0x5005e311:
// STB's ID exchange registers its flag bit 16 for the first byte) and receives the rest, or calls the index's receive
// completion. The driver's init does not run in the lab, so none of those IRQs is attached.
//
// The seam is mode 0's two starts for index 6; everything above them runs natively (PER_SIO's channel API, its
// configuration, the completions, STB's code), and so does the close (0x5005e628, which polls +0x44 bit 15 for the
// transmitter, 0x5005e5ac). H-SIOMAP: the channel map set by its own setter (fact 'sio'), as on the TG-5s
// (src/lab/sio.mjs), if nothing set it; index 6's register page is allowed in the lab stub (it keeps what is written,
// as for the TG-5s' controllers): the configuration and the close write and read back its control words, and the
// close's poll reads +0x44 as 0, the transmitter idle (I: so it is once the transfer has ended).
// - The transfer start (d0 the index, a0 the bytes, d1 their count, a1 0: ended by the interrupt; 1, the start's polled
//   path, stops the session) records the bytes, which go nowhere (the shoe is empty, A-HOTSHOE-2), and the transfer
//   ends at the MN's next idle point (A-HOTSHOE-1) in interrupt context, as mode 0's transmit handler ends it: the
//   index's transmit completion called with d0 the index (none called when none is registered, as the handler skips
//   it). An index of kind 1 (its record's byte 0), for which the handler turns the line round first
//   (0x5005e9e5..0x5005ea72), stops the session.
// - The receive start (d0 the index, a0 the buffer, d1 the count) keeps the receive: nothing arrives (A-HOTSHOE-2), so
//   it never ends, nor does the first-byte event fire; the index's close drops it. A second receive while one is kept
//   stops the session.
// What a flash would answer is not modelled: no byte is ever received.
import { fact } from '../fw/model.mjs';
import { SIO_E143 } from '../fw/facts.mjs';
import { FirmwareError, ISR_CALLER, ISR_SP, disasm, where } from './hle.mjs';
import { STUB } from './display.mjs';
import * as K from './kernel.mjs';
import * as N from './nav.mjs';
import { pack, bytesHex } from '../util/bytes.mjs';

export class ShoeError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const SHOE_E143 = {
  channel: 11, index: 6,     // PER_SIO's channel and the controller index its map gives it (map 0x6011be1c + 22, D)
  regs: 0x6011B614,          // the driver's register-address table, 136 bytes (34 words) an index
  records: 0xA32C957C,       // the driver's index records, 20 bytes an index: +0 kind, +1 mode, +2 direction, +3 open
  tx: 0x5005DC2C,            // mode 0's transfer start (0x6011bdb0[0], called by 0x5005dc03)
  rx: 0x5005DF40,            // mode 0's receive start (0x6011bdc4[0], called by 0x5005def6)
  tx_done: 0xA32C9658,       // the index's transmit completion, a word an index (0x5005e684 type 1)
  close: 0x5005E628,         // the index's close (the channel close 0x5005f25f's)
};
const REG_WORDS = 34, REG_STRIDE = 136, RECORD = 20, MODE = 1, KIND = 0;
const ALLOW = 0x100, NALLOW = 32;           // the lab stub's allow table (src/dev/stub.mjs)
const LIMIT = 200000;

export class HotShoe {
  // lab: the PlayLab
  constructor(lab) {
    this.lab = lab;
    this.f = fact('sio', SIO_E143);
    this.transfers = [];       // {t_ns, tx (hex), rx: the receive kept with it (its count) or null, ended, closed}
    this.ends = [];            // transfers ended, not delivered yet (their index)
    this.kept = null;          // the receive kept {count, buf, t_ns}
    this.closes = 0;
    this.mapped = false;       // H-SIOMAP ran here
    this.page = null;          // the register page allowed
  }
  // H-SIOMAP (if the map word is still 0), index 6's register page in the stub's allow table, the hooks, the idle step
  bring_up() {
    const lab = this.lab, sim = lab.sim, S = SHOE_E143;
    if (!sim.u32(this.f.channels)) {
      lab.call(this.f.map_init, null, null, null, 20000);
      this.mapped = true;
    }
    const map = sim.u32(this.f.channels) >>> 0, index = map ? sim.read(map + 2 * S.channel, 1)[0] : null;
    if (index !== S.index) throw new ShoeError(`H-SIOMAP: PER_SIO's channel ${S.channel} has the controller index ${index} (map ${h8(map)}), not ${S.index}`);
    const regs = [...Array(REG_WORDS).keys()].map((k) => sim.u32(S.regs + REG_STRIDE * S.index + 4 * k) >>> 0).filter((a) => a);
    const pageOf = (a) => (a & ~0xFFF) >>> 0, page = regs.length ? pageOf(regs[0]) : null;
    if (!regs.length || regs.some((a) => pageOf(a) !== page)) throw new ShoeError(`S-HOTSHOE: index ${S.index}'s registers ${regs.map(h8).join(' ')} are not one page`);
    let slot = -1;
    for (let i = 0; i < NALLOW && slot < 0; i++) if (!(sim.u32(STUB + ALLOW + 12 * i + 8) & 1)) slot = i;
    if (slot < 0) throw new ShoeError('S-HOTSHOE: the lab stub\'s allow table is full');
    sim.write(STUB + ALLOW + 12 * slot, pack('<III', page, 0x1000, 1));
    this.page = page;
    lab.hook(S.tx, (h, r) => this._tx(h, r), 'S-HOTSHOE transfer');
    lab.hook(S.rx, (h, r) => this._rx(h, r), 'S-HOTSHOE receive');
    lab.observe(S.close, (l, r) => { if ((r.d0 & 0xFF) === S.index) this._close(); }, 'S-HOTSHOE close');
    lab.lt.idle_steps.push(() => this.idle_step());
  }
  fail(r, what) { throw new ShoeError(`S-HOTSHOE: ${what} from ${where(r.mdr)}`); }
  record_byte(index, at) { return this.lab.sim.read(SHOE_E143.records + RECORD * index + at, 1)[0]; }
  _tx(h, r) {
    const S = SHOE_E143, index = r.d0 & 0xFF;
    if (index !== S.index) return this.lab.passthrough(r);
    const n = r.d1 & 0xFFFF, kind = this.record_byte(index, KIND);
    if ((r.a1 & 0xFF) !== 0) this.fail(r, `a polled transfer (a1 ${r.a1 & 0xFF}) on index ${index}: only the start the interrupt ends is modelled`);
    if (!n || !r.a0) this.fail(r, `a transfer of ${n} bytes from ${h8(r.a0)} on index ${index}`);
    if (kind === 1) this.fail(r, `a transfer on index ${index} of kind 1, whose end turns the line round (0x5005e9e5..0x5005ea72): not modelled`);
    if (this.record_byte(index, MODE) !== 0) this.fail(r, `mode 0's start on index ${index} in mode ${this.record_byte(index, MODE)}`);
    const tx = bytesHex(this.lab.sim.read(r.a0 >>> 0, n));
    this.transfers.push({ t_ns: this.lab.lab_time(), tx, rx: this.kept && !this.kept.taken ? this.kept.count : null, ended: false, closed: false });
    if (this.kept) this.kept.taken = true;
    this.ends.push(this.transfers.length - 1);
    h.finish_calls(r, {});
  }
  _rx(h, r) {
    const S = SHOE_E143, index = r.d0 & 0xFF;
    if (index !== S.index) return this.lab.passthrough(r);
    const count = r.d1 & 0xFFFF;
    if (this.kept) this.fail(r, `a second receive on index ${index} while one of ${this.kept.count} bytes is kept`);
    if (!count || !r.a0) this.fail(r, `a receive of ${count} bytes into ${h8(r.a0)} on index ${index}`);
    this.kept = { count, buf: r.a0 >>> 0, t_ns: this.lab.lab_time(), taken: false };
    h.finish_calls(r, {});
  }
  // the index's close: the kept receive dropped (the close resets the controller's directions, 0x5005e56e /
  // 0x5005e5ac)
  _close() {
    this.kept = null;
    this.closes += 1;
    const last = this.transfers.at(-1);
    if (last) last.closed = true;
  }
  // the lab task's idle point (src/lab/kernel.mjs LabTask idle_steps): one transfer's end, as mode 0's transmit handler
  // ends it (0x5005ea80..0x5005ea99: the index's transmit completion, d0 the index, when one is registered)
  idle_step() {
    if (!this.ends.length) return false;
    const lab = this.lab, S = SHOE_E143, t = this.transfers[this.ends.shift()];
    t.ended = true;
    const fn = lab.sim.u32(S.tx_done + 4 * S.index) >>> 0;
    if (fn) K.in_interrupt(lab.lt, () => lab.calls(disasm(fn), { d0: S.index }, ISR_SP, ISR_CALLER, LIMIT));
    return 'ready';
  }
  // lab time, ms of it, inside a step (as the lens's start runs it, src/lab/lens.mjs run)
  run(ms) {
    const lab = this.lab;
    lab.step_storm += Math.ceil(ms * N.WAIT_STORM_PER_MS);
    lab.lt.elapse_until(lab.lab_time() + ms * 1e6, () => lab.lab_time(), (x) => lab.run_to_event(x), N.STEP_HOOKS * 4 + ms * N.WAIT_HOOKS_PER_MS);
  }
  status() { return { transfers: this.transfers.length, last: this.transfers.at(-1) ?? null, kept: this.kept && this.kept.count, closes: this.closes, page: this.page && h8(this.page) }; }
}
