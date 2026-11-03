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
    layer(SIO_OPEN, byD0((h, r) => this._open(h, r)), 'S-WM8946 open');
    layer(SIO_CONFIG, byA0((h, r) => this._config(h, r)), 'S-WM8946 configure');
    layer(SIO_TRANSFER, byA0((h, r) => this._transfer(h, r)), 'S-WM8946 transfer');
    layer(SIO_CLOSE, byD0((h, r) => this._close(h, r)), 'S-WM8946 close');
    lab.lt.idle_steps.push(() => this.idle_step());
  }
  fail(r, what) { throw new Wm8946Error(`S-WM8946: ${what} from ${where(r.mdr)}`); }
  _open(h, r) {
    if (this.open) this.fail(r, `open of channel ${WM8946_CHANNEL}, open already`);
    this.open = true;
    if (r.a0) h.finish_after(r, disasm(r.a0), { a0: r.a1 }); else h.finish(r, { d0: 0 });
  }
  _config(h, r) {
    const b = this.sim().read(r.a0 >>> 0, CONFIG_BYTES), dv = new DataView(b.buffer, b.byteOffset, CONFIG_BYTES);
    if (!this.open) this.fail(r, `configuration of channel ${WM8946_CHANNEL} while it is closed`);
    this.config = { clock: dv.getUint32(12, true), bytes: bytesHex(b) };
    h.finish(r, { d0: 0 });
  }
  _transfer(h, r) {
    const sim = this.sim(), d = sim.read(r.a0 >>> 0, DESC_BYTES), dv = new DataView(d.buffer, d.byteOffset, DESC_BYTES);
    const [, dirs, txN, rxN] = d, [txBuf, rxBuf, txCb, txArg, rxCb] = [4, 8, 12, 16, 20].map((o) => dv.getUint32(o, true));
    if (!this.open || !this.config) this.fail(r, `transfer on channel ${WM8946_CHANNEL} before its open and configuration`);
    const write = dirs === 1 && txN === 4 && txBuf && txCb && txCb !== 0xFFFFFFFF;
    const read = dirs === 3 && txN === 2 && rxN === 2 && txBuf && rxBuf && rxCb && rxCb !== 0xFFFFFFFF && txCb !== 0xFFFFFFFF;
    if (!write && !read) this.fail(r, `transfer ${bytesHex(d)}: only the register access's write (4 bytes) and read (2 + 2 bytes), ended by interrupt, are modelled`);
    const back = this.chip.transfer(sim.read(txBuf, txN).slice(), read ? rxN : 0);
    if (read) sim.write(rxBuf, back);
    this.transfers += 1;
    this.ends.push({ rx: read ? rxCb : 0, tx: txCb, desc: r.a0 >>> 0, arg: txArg });
    h.finish(r, { d0: 0 });
  }
  _close(h, r) {
    if (!this.open) this.fail(r, `close of channel ${WM8946_CHANNEL} while it is closed`);
    this.open = false;
    h.finish(r, { d0: 0 });
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
  status() { return { open: this.open, transfers: this.transfers, clock: this.config?.clock ?? null, ...this.chip.status() }; }
}
