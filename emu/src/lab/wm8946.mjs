// The sound IC at the far end of PER_SIO's channel 14 (S-WM8946; with the audio hardware, --audio auto or on, E143;
// docs/hle-gaps.md 4.5). The firmware names the chip a Wolfson WM8946 (the string
// "dev_ctrl_wm8946_sub_adj_calc_adcvol", D). Its register access exec_data 0x50a632c5 opens the channel with a callback
// (0x5005f0f7(14, 0x50a63385, the frame word); 1 back means busy, and it retries), and the callback 0x50a63385
// configures it (0x5005f4ae: 4 MHz, configuration 0xa33dac60) and sends one frame from the buffer 0xa33dcd60
// (0x5005f587, descriptor 0xa33dac70): a write is four bytes {address high, address low, data high, data low}
// (directions 1, 4 bytes, the end callback 0x50a634eb); a read sends the two address bytes with bit 7 of the first set
// and receives two data bytes into 0xa33dcd64 (directions 3, 2 + 2 bytes, the receive's callback 0x50a63521, which
// keeps them at 0xa33dcd68; no transmit callback). Chip select is GPIO 139 / 140 (0x50a62d89, 0x50a62dc8, native).
// exec_data waits for flag (0x60042f76) bit 24, which the end callbacks set, with a timeout of 3000, then closes the
// channel (0x5005f25f) (D). The register lists the driver runs (executor 0x50a63ecc) keep a shadow of what they write
// at 0xa33dcd6c (D), so reads are rare (I).
//
// The seam is PER_SIO's channel API, as S-SIO2's for PER_SCPU's channel (src/lab/scpulink.mjs), on top of whose hooks
// this one sits: open, configure, transfer and close of channel 14 are served, the other channels' calls go on to
// S-SIO2 and natively. (Not the driver's transfer starts S-SIOIIC serves, src/lab/sio.mjs: on E143 PER_SIO's own
// configure already writes the channel's controller registers, which the lab does not model, X: a lab-stub denial of
// 0x9a100028 from 0x5005d7cf at the codec's first configure.) The open calls the callback with its argument and
// answers 0; a transfer's bytes go to the chip at once, and its end is delivered at the MN's next idle point
// (A-SIOIIC-1's rule), in interrupt context: the receive's callback with a0 the descriptor, then the transmit's with a0
// its argument (descriptor +16), as PER_SIO's glue calls them (S-SIO2's order). Another form of call on channel 14 (a
// transfer of other directions or counts, a blocking one, a configure or transfer while closed) stops the session.
//
// The chip: a 16-bit register file. A write keeps its value; a read answers the value last written; a read of a
// register not written in the session stops the session (its value on the camera, the chip's reset value or what the
// power-on list CPU 2 runs would have written, is not known here, ?). The lab does not apply the codec's volume to the
// PCM it takes from the audio port: its DAC volume registers (output_vol_list 0x60dc5298: 0x0a, 0x0b, 0x28, 0x29, 0x47,
// D) are kept and shown, not used.
//
// With --cpu2 native (docs/hle-gaps.md 4.6.7) AUD_WAKEUP's power-on list runs on core 2 and calls the same four entries
// there; core 2's stops serve channel 14 with the same channel and chip (serve_cpu2), and a transfer's end is delivered
// on CPU 0 at its next idle point like any other (A-WM8946-1): the end callbacks set the waiter's flag through
// 0x50a6435b (iset_flg 0x5002bd77 in interrupt context, else set_flg 0x5002bd01; D), whose id names its core (the list
// executor's (0x60043664) is CPU 2's 0x2013, exec_data's (0x60042f76) CPU 0's 3, X), and the set reaches core 2
// natively (X: every wait of AUD_WAKEUP's list ends). Which core PER_SIO's end interrupt reaches is ?.
import { refuseUnmapped } from '../fw/model.mjs';
import { FirmwareError, ISR_CALLER, ISR_SP, disasm, runtime, where } from './hle.mjs';
import * as K from './kernel.mjs';
import { bytesHex } from '../util/bytes.mjs';
import { SIO_OPEN, SIO_CONFIG, SIO_TRANSFER, SIO_CLOSE } from './scpulink.mjs';

export class Wm8946Error extends FirmwareError {}

export const WM8946_CHANNEL = 14;
export const VOLUME_REGS = [0x0a, 0x0b, 0x28, 0x29, 0x47];
const READ = 0x80, DESC_BYTES = 28, CONFIG_BYTES = 16, LOG_KEPT = 64;

// the chip's register file: transfer(tx, rx count) -> the bytes received
export class Wm8946 {
  constructor() {
    this.regs = new Map();                // register -> the 16-bit value last written
    this.writes = 0; this.reads = 0;
    this.log = [];                        // the newest operations: [op, register, value]
  }
  note(op, reg, v) { this.log.push([op, reg, v]); if (this.log.length > LOG_KEPT) this.log.shift(); }
  transfer(tx, rx) {
    if (tx.length === 4 && rx === 0 && !(tx[0] & READ)) {
      const reg = tx[0] << 8 | tx[1], v = tx[2] << 8 | tx[3];
      this.regs.set(reg, v);
      this.writes += 1;
      this.note('write', reg, v);
      return new Uint8Array(0);
    }
    if (tx.length === 2 && rx === 2 && (tx[0] & READ)) {
      const reg = (tx[0] & ~READ) << 8 | tx[1];
      if (!this.regs.has(reg)) throw new Wm8946Error(`S-WM8946: a read of register 0x${reg.toString(16)}, which was not written in this session: its value on the camera is not known (?)`);
      const v = this.regs.get(reg);
      this.reads += 1;
      this.note('read', reg, v);
      return Uint8Array.of(v >> 8, v & 0xff);
    }
    throw new Wm8946Error(`S-WM8946: a transfer of ${bytesHex(tx)} receiving ${rx} bytes: not a frame of the firmware's register access (src/lab/wm8946.mjs)`);
  }
  volume() { return Object.fromEntries(VOLUME_REGS.filter((r) => this.regs.has(r)).map((r) => [`0x${r.toString(16).padStart(2, '0')}`, this.regs.get(r)])); }
  status() { return { writes: this.writes, reads: this.reads, registers: this.regs.size, volume: this.volume(), last: this.log.at(-1) ?? null }; }
}

// S-WM8946's channel: PER_SIO's channel API for channel 14, on top of S-SIO2's hooks
export class CodecLink {
  constructor(lab, chip = new Wm8946()) {
    this.lab = lab; this.chip = chip;
    this.open = false; this.config = null;
    this.ends = [];                       // transfers ended, their callbacks not yet run: {rx, tx, desc, arg}
    this.transfers = 0;
    this.transfers2 = 0;                  // of them, core 2's (--cpu2 native)
    this.cpu2_calls = null;               // core 2's calls of channel 14, by kind (--cpu2 native)
  }
  sim() { return this.lab.sim; }
  bring_up() {
    const lab = this.lab;
    for (const a of [SIO_OPEN, SIO_CONFIG, SIO_TRANSFER, SIO_CLOSE]) refuseUnmapped(a, 'S-WM8946');
    // over S-SIO2's hook where it has one (a body whose PER_SCPU runs over the link), else over the native call
    const layer = (at, mine, name) => {
      const below = lab.hooks.has(runtime(at)) ? null : (h, r) => lab.passthrough(r);
      if (below) lab.hook(at, (h, r) => (mine(r) ? mine(r)(h, r) : below(h, r)), name);
      else lab.wrap(at, (prev) => (h, r) => (mine(r) ? mine(r)(h, r) : prev(h, r)), name);
    };
    const byD0 = (fn) => (r) => ((r.d0 & 0xFF) === WM8946_CHANNEL ? fn : null);
    const byA0 = (fn) => (r) => (this.sim().read(r.a0 >>> 0, 1)[0] === WM8946_CHANNEL ? fn : null);
    // CPU 0's returns: d0, or the open's callback through calls and then 0
    const ret0 = (h, r) => ({ finish: (d0) => h.finish(r, { d0 }), after: (fn, a0) => h.finish_after(r, disasm(fn), { a0 }) });
    layer(SIO_OPEN, byD0((h, r) => this._open(r, ret0(h, r))), 'S-WM8946 open');
    layer(SIO_CONFIG, byA0((h, r) => this._config(r, ret0(h, r))), 'S-WM8946 configure');
    layer(SIO_TRANSFER, byA0((h, r) => this._transfer(r, ret0(h, r))), 'S-WM8946 transfer');
    layer(SIO_CLOSE, byD0((h, r) => this._close(r, ret0(h, r))), 'S-WM8946 close');
    lab.lt.idle_steps.push(() => this.idle_step());
  }
  // --cpu2 native (src/lab/cpu2.mjs): the same four calls of channel 14 from core 2 (AUD_WAKEUP's power-on list,
  // 0x50a62e27), at core 2's stops on PER_SIO's entries; the other channels' calls run natively there. One channel
  // and one chip for both cores, as PER_SIO keeps one channel state for every core (its open records the opener's
  // core, 0x5005f1ff, and its close calls a queued opener's callback on that core, 0x5005f396..0x5005f3ab, D).
  serve_cpu2(cpu2) {
    const R = (api) => ({ d0: api.R[0] >>> 0, a0: api.R[4] >>> 0, a1: api.R[5] >>> 0, mdr: api.R[11] >>> 0 });
    const ret2 = (api) => ({ finish: (d0) => cpu2.finish(api, d0), after: (fn, a0) => cpu2.finish_after(api, fn, { 4: a0 }) });
    const ch = (api, r, byD0) => (byD0 ? r.d0 & 0xFF : api.read(r.a0, 1)[0]) === WM8946_CHANNEL;
    const stop = (name, byD0, op) => (api) => {
      const r = R(api);
      if (!ch(api, r, byD0)) return 'step';
      this.cpu2_calls[name] += 1;
      op(r, ret2(api));
      return 'go';
    };
    this.cpu2_calls = { open: 0, configure: 0, transfer: 0, close: 0 };
    cpu2.add_stops([
      [runtime(SIO_OPEN), 'S-WM8946 open (core 2)', stop('open', true, (r, ret) => this._open(r, ret))],
      [runtime(SIO_CONFIG), 'S-WM8946 configure (core 2)', stop('configure', false, (r, ret) => this._config(r, ret))],
      [runtime(SIO_TRANSFER), 'S-WM8946 transfer (core 2)', stop('transfer', false, (r, ret) => this._transfer(r, ret, 2))],
      [runtime(SIO_CLOSE), 'S-WM8946 close (core 2)', stop('close', true, (r, ret) => this._close(r, ret))]]);
  }
  fail(r, what) { throw new Wm8946Error(`S-WM8946: ${what} from ${where(r.mdr)}`); }
  // r: the call's {d0, a0, a1, mdr}; ret: the calling core's returns; core: the calling core
  _open(r, ret) {
    if (this.open) this.fail(r, `open of channel ${WM8946_CHANNEL}, open already`);
    this.open = true;
    if (r.a0) ret.after(r.a0 >>> 0, r.a1); else ret.finish(0);
  }
  _config(r, ret) {
    const b = this.sim().read(r.a0 >>> 0, CONFIG_BYTES), dv = new DataView(b.buffer, b.byteOffset, CONFIG_BYTES);
    if (!this.open) this.fail(r, `configuration of channel ${WM8946_CHANNEL} while it is closed`);
    this.config = { clock: dv.getUint32(12, true), bytes: bytesHex(b) };
    ret.finish(0);
  }
  _transfer(r, ret, core = 0) {
    const sim = this.sim(), d = sim.read(r.a0 >>> 0, DESC_BYTES), dv = new DataView(d.buffer, d.byteOffset, DESC_BYTES);
    const [, dirs, txN, rxN] = d, [txBuf, rxBuf, txCb, txArg, rxCb] = [4, 8, 12, 16, 20].map((o) => dv.getUint32(o, true));
    if (!this.open || !this.config) this.fail(r, `transfer on channel ${WM8946_CHANNEL} before its open and configuration`);
    const write = dirs === 1 && txN === 4 && txBuf && txCb && txCb !== 0xFFFFFFFF;
    const read = dirs === 3 && txN === 2 && rxN === 2 && txBuf && rxBuf && rxCb && rxCb !== 0xFFFFFFFF && txCb !== 0xFFFFFFFF;
    if (!write && !read) this.fail(r, `transfer ${bytesHex(d)}: only the register access's write (4 bytes) and read (2 + 2 bytes), ended by interrupt, are modelled`);
    const back = this.chip.transfer(sim.read(txBuf, txN).slice(), read ? rxN : 0);
    if (read) sim.write(rxBuf, back);
    this.transfers += 1;
    if (core) this.transfers2 += 1;
    this.ends.push({ rx: read ? rxCb : 0, tx: txCb, desc: r.a0 >>> 0, arg: txArg, core });
    ret.finish(0);
  }
  _close(r, ret) {
    if (!this.open) this.fail(r, `close of channel ${WM8946_CHANNEL} while it is closed`);
    this.open = false;
    ret.finish(0);
  }
  // the lab task's idle point: a transfer's end
  idle_step() {
    if (!this.ends.length) return false;
    const e = this.ends.shift(), lab = this.lab;
    K.in_interrupt(lab.lt, () => {
      if (e.rx) lab.calls(disasm(e.rx), { a0: e.desc }, ISR_SP, ISR_CALLER, 5000);
      if (e.tx) lab.calls(disasm(e.tx), { a0: e.arg }, ISR_SP, ISR_CALLER, 5000);
    });
    return 'ready';
  }
  status() { return { open: this.open, transfers: this.transfers, ...(this.cpu2_calls && { cpu2: { ...this.cpu2_calls, transfers: this.transfers2 } }), clock: this.config?.clock ?? null, ...this.chip.status() }; }
}
