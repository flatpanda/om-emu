// PER_SIO's serial controller in the lab for the channels a body's devices sit on (S-SIOIIC; docs/hle-gaps.md 4.7.5,
// docs/model-survey.md finding 24, which gives E132's addresses for what is read here). The controller's register
// blocks (lab-stub pages on the E144 family's board), its interrupts and its driver's per-mode starts are not
// modelled; PER_SIO's channel API and its IIC layer run natively above it, and so does the driver's completion
// dispatch. The seam is the driver's two transfer starts (src/fw/facts.mjs sioDriver, fact 'sio'), which PER_SIO's
// IIC layer starts its transfers through: its write calls the transfer start, its write-read the receive start and
// then the transfer start (D). For a controller index whose PER_SIO channel has a device (src/fw/models.mjs
// sio_devices; the index from PER_SIO's channel map, fact 'sio.channels'):
// - the receive start (d0 the index, a0 the buffer, a1 the count, d1 the transfer's length) keeps the receive for the
//   transfer that follows; another receive before it stops the session;
// - the transfer start (d0 the index, a0 the bytes, d1 their count, a1 0: ended by the controller's interrupt; 1, the
//   start's polled path, stops the session) hands the bytes to the device as IIC segments: the transfer's restart
//   list (fact 'sio.restart', {count, positions}, which the IIC layer's write-read sets through the driver's control,
//   D) splits them before each position (the start's byte loop restarts there, D), each segment opens with its
//   address byte (the 7-bit address and the read bit, as the IIC layer's callers write them, D), a write segment's
//   other bytes go to the device's write, and a read segment, which must be the last and carry its address alone,
//   takes the kept receive's count from the device's read;
// - the transfer's end is delivered at the MN's next idle point (A-SIOIIC-1), in interrupt context as the controller's
//   interrupts deliver it (the transfer's end, then the receive's, D): the index's restart list cleared, the
//   transfer's completion dispatched with status 0 (fact 'sio.dispatch', d0 the index, d1 the status, a0 the transfer
//   table), then the received bytes written and the receive's completion dispatched so.
// A device's read or write it does not model stops the session in the device (src/lab/charger.mjs); the other
// indices' starts run natively (the TG-5's panel, channel 2: its bytes reach the lab-stub page and S-PANELDONE).
import { MODEL_INFO, fact, refuseUnmapped } from '../fw/model.mjs';
import { SIO_E143 } from '../fw/facts.mjs';
import { FirmwareError, where } from './hle.mjs';
import * as K from './kernel.mjs';
import { bytesHex } from '../util/bytes.mjs';
import { IntCharger } from './charger.mjs';

export class SioError extends FirmwareError {}

// the devices a body's PER_SIO channels can have (src/fw/models.mjs sio_devices: [{channel, device}])
const DEVICES = { charger: () => new IntCharger() };
const RESTART_MAX = 8;                    // positions a restart list may give (the charger's has 1, D)

// A transfer's bytes as IIC segments: split before each restart position (cuts, ascending, inside the transfer), each
// segment's first byte its address byte: [{addr (7 bits), read, data (the write's bytes)}]. Only what the IIC layer's
// callers send is taken: a read segment last, its address alone, and present exactly when a receive is kept (rx)
export function iicSegments(tx, cuts, rx) {
  const n = tx.length;
  if (cuts.some((c, i) => c <= (cuts[i - 1] ?? 0) || c >= n)) throw new SioError(`restarts at ${cuts.join(', ')} in a transfer of ${n} bytes`);
  const out = [0, ...cuts].map((from, i) => {
    const seg = tx.subarray(from, cuts[i] ?? n);
    return { addr: seg[0] >> 1, read: (seg[0] & 1) === 1, data: seg.subarray(1) };
  });
  out.forEach((s, i) => {
    if (s.read && (i !== out.length - 1 || s.data.length || !rx)) throw new SioError(`a read segment at ${i} of ${bytesHex(tx)}: only a last read segment of its address alone, with a receive kept, is modelled`);
  });
  if (rx && !out.at(-1).read) throw new SioError(`a receive kept and a transfer ${bytesHex(tx)} with no read segment`);
  return out;
}

export class SioBus {
  // lab: the PlayLab
  constructor(lab) {
    this.lab = lab;
    this.f = fact('sio', SIO_E143);
    this.devices = new Map();             // PER_SIO channel -> device
    for (const { channel, device } of MODEL_INFO.sio_devices ?? []) {
      if (!DEVICES[device]) throw new SioError(`S-SIOIIC: ${device} on channel ${channel} is not a device the lab has (${Object.keys(DEVICES).join(', ')})`);
      if (this.devices.has(channel)) throw new SioError(`S-SIOIIC: two devices on channel ${channel}`);
      this.devices.set(channel, DEVICES[device]());
    }
    this.rx = new Map();                  // controller index -> the kept receive {buf, count}
    this.ends = [];                       // transfers ended, not delivered yet: {index, rx: {buf, bytes} | null}
    this.transfers = [];                  // every transfer served: {channel, segments}
  }
  sim() { return this.lab.sim; }
  get labels() { return [...new Set([...this.devices.values()].map((d) => d.label))]; }
  // H-SIOMAP: PER_SIO's channel map set by the firmware's own setter (fact 'sio.map_init'), the end of PER_SIO's
  // channel init, which the boot runs and the lab does not: without it the map word is 0 and a channel's index is read
  // from low memory (X: E132's charger transfer went to index 0). Then S-SIOIIC's hooks and its idle step
  bring_up() {
    const lab = this.lab, sim = this.sim();
    for (const a of [this.f.tx_start, this.f.rx_start, this.f.dispatch, this.f.map_init]) refuseUnmapped(a, 'S-SIOIIC');
    if (sim.u32(this.f.channels)) throw new SioError(`H-SIOMAP: PER_SIO's channel map word ${where(this.f.channels)} is set before its setter runs`);
    lab.step('H-SIOMAP PER_SIO\'s channel map', () => lab.call(this.f.map_init, null, null, null, 20000));
    const map = sim.u32(this.f.channels);
    if (!map) throw new SioError(`H-SIOMAP: the setter left the channel map word ${where(this.f.channels)} at 0`);
    this.indices = Object.fromEntries([...this.devices.keys()].map((ch) => [ch, sim.read(map + 2 * ch, 1)[0]]));
    lab.hook(this.f.rx_start, (h, r) => this._rx_start(h, r), 'S-SIOIIC receive start');
    lab.hook(this.f.tx_start, (h, r) => this._tx_start(h, r), 'S-SIOIIC transfer start');
    lab.lt.idle_steps.push(() => this.idle_step());
  }
  fail(r, what) { throw new SioError(`S-SIOIIC: ${what} from ${where(r.mdr)}`); }
  // the PER_SIO channel served at a controller index, or null (the channel map H-SIOMAP set)
  channel(index) {
    for (const [ch, i] of Object.entries(this.indices)) if (i === index) return Number(ch);
    return null;
  }
  _rx_start(h, r) {
    const index = r.d0 & 0xFF, ch = this.channel(index);
    if (ch === null) return this.lab.passthrough(r);
    const count = r.a1 & 0xFFFF;
    if (this.rx.has(index)) this.fail(r, `a second receive on channel ${ch} before its transfer`);
    if (!count || !r.a0) this.fail(r, `a receive of ${count} bytes into ${where(r.a0)} on channel ${ch}`);
    this.rx.set(index, { buf: r.a0 >>> 0, count });
    h.finish(r, { d0: 0 });               // the IIC layer does not read it (D)
  }
  _tx_start(h, r) {
    const index = r.d0 & 0xFF, ch = this.channel(index);
    if (ch === null) return this.lab.passthrough(r);
    const sim = this.sim(), n = r.d1 & 0xFFFF, dev = this.devices.get(ch);
    if ((r.a1 & 0xFF) !== 0) this.fail(r, `a polled transfer (a1 ${r.a1 & 0xFF}) on channel ${ch}: only the start the controller's interrupt ends is modelled`);
    if (!n || !r.a0) this.fail(r, `a transfer of ${n} bytes from ${where(r.a0)} on channel ${ch}`);
    const tx = sim.read(r.a0 >>> 0, n).slice(), list = sim.u32(this.f.restart + 4 * index), cuts = [];
    if (list) {
      const count = sim.u32(list), at = sim.u32(list + 4);
      if (count > RESTART_MAX) this.fail(r, `a restart list of ${count} positions`);
      for (let i = 0; i < count; i++) cuts.push(sim.u32(at + 4 * i));
    }
    const rx = this.rx.get(index) ?? null, segments = [];
    this.rx.delete(index);
    let parts, got = null;
    try { parts = iicSegments(tx, cuts, rx !== null); } catch (e) { if (e instanceof SioError) this.fail(r, `${e.message} on channel ${ch}`); throw e; }
    for (const { addr, read, data } of parts) {
      if (!read) { dev.write(addr, data); segments.push({ addr, write: bytesHex(data) }); continue; }
      got = Uint8Array.from(dev.read(addr, rx.count));
      if (got.length !== rx.count) throw new SioError(`S-SIOIIC: the device on channel ${ch} answered ${got.length} bytes for a read of ${rx.count}`);
      segments.push({ addr, read: bytesHex(got) });
    }
    this.transfers.push({ channel: ch, segments });
    this.ends.push({ index, rx: got && { buf: rx.buf, bytes: got } });
    h.finish(r, { d0: 0 });               // the IIC layer does not read it (D)
  }
  // the lab task's idle point (src/lab/kernel.mjs LabTask idle_steps): one transfer's end, as the controller's
  // interrupt delivers it
  idle_step() {
    if (!this.ends.length) return false;
    const e = this.ends.shift(), lab = this.lab, sim = this.sim(), [txDone, rxDone] = this.f.done;
    K.in_interrupt(lab.lt, () => {
      sim.write(this.f.restart + 4 * e.index, new Uint8Array(4));
      K.isr_call(lab.lt, this.f.dispatch, { d0: e.index, d1: 0, a0: txDone });
      if (e.rx) {
        sim.write(e.rx.buf, e.rx.bytes);
        K.isr_call(lab.lt, this.f.dispatch, { d0: e.index, d1: 0, a0: rxDone });
      }
    });
    return 'ready';
  }
  status() { return { transfers: this.transfers.length, last: this.transfers.at(-1) ?? null, devices: Object.fromEntries([...this.devices].map(([ch, d]) => [ch, d.status()])) }; }
}
