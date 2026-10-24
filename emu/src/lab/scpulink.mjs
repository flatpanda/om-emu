// The MN's side of the sub-CPU link in the lab (docs/hle-gaps.md 4.7.1, docs/om1-scpu-spec.md 3 and 8): the firmware's
// PER_SCPU runs natively (its start with the reset pulse and the 0x85 {2} handshake, every request through its state
// machine; its watchdog and poll path are native too but not reached: the model answers at once and posts no message),
// and the sub-CPU is at the far end of the wires PER_SCPU uses: the three GIO pins (src/dev/linkpins.mjs, register
// level, the GIO driver and its interrupt native), PER_SIO's channel (S-SIO2, below) and the window's port 3
// (src/dev/scpu.mjs, the message line). The sub-CPU is S-SCPUDEV (src/lab/scpudev.mjs), or anything with its seam
// (connect, pin, exchange, step).
//
// H-SCPUSTART, at the store init (src/lab/menu.mjs, where the boot chain would have started the task long before): the
// GIO init's slot reset (H-GIOSLOTS: the GIO init does not run, and PER_SCPU's registration of pin 102 needs a free
// slot, D: 0x500525c7), the sub-CPU wired, act_tsk of PER_SCPU's static task (the boot chain's 0x50024072, its entry
// allowed), and a settle, in which the task pulses the reset pin, waits for pin 102 and sends 0x85 {2} (X); the start is
// checked: the task waiting for its next message, the sub-CPU's gate open, 0x85 {2} the only frame.
//
// S-SIO2: PER_SIO's channel API, served for the one channel PER_SCPU's task opens (PER_SIO's register blocks, its init
// 0x5005f464 and its interrupt handlers are not modelled): open (0x5005f0f7: the channel taken, the caller's callback
// called with its argument, 0 returned, D), the configuration (0x5005f4ae: the channel byte and the clock word kept,
// 6,000,000 on E143, D), a transfer (0x5005f587: its descriptor {+0 channel, +1 directions, +2 tx count, +3 rx count,
// +4 tx buffer or 0 for zeros, +8 rx buffer, +12 tx callback, +16 its argument, +20 rx callback}, D from 0x5005f619;
// PER_SCPU's are full duplex with equal counts) and close (0x5005f25f). A transfer's bytes go to the sub-CPU at once
// (exchange) and the reply bytes into the rx buffer; its end is delivered at the MN's next idle point (A-SCPUDEV-1)
// as the driver's interrupt delivers it: in interrupt context, the rx callback with a0 = the descriptor, then the tx
// callback with a0 = its argument (the glue 0x5005f7e9 / 0x5005f831 calls them in that order when both directions
// end, D). Another channel's calls run natively, as without the link (the EVF panel's channel 0, whose transfers
// reach the lab stub's pages and S-PANELDONE); on PER_SCPU's channel another task, direction, count or a blocking
// transfer (a tx callback of -1) stops the session.
import { A, MODEL, refuseUnmapped } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import { FirmwareError, ISR_CALLER, ISR_SP, disasm, where } from './hle.mjs';
import * as K from './kernel.mjs';
import { bytesHex } from '../util/bytes.mjs';

export class LinkError extends FirmwareError {}

// PER_SCPU's task entry (its static task, act_tsk at 0x50024079); PER_SIO's channel API; the GIO init's slot reset
export const PER_SCPU_TASK = A(0x5005B424);
export const SIO_OPEN = A(0x5005F0F7), SIO_CONFIG = A(0x5005F4AE), SIO_TRANSFER = A(0x5005F587), SIO_CLOSE = A(0x5005F25F);
export const GIO_SLOTS = A(0x50002B5D);
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const DESC_BYTES = 28, CONFIG_BYTES = 16;

export class ScpuLink {
  // lab: the MenuLab; dev: the sub-CPU (S-SCPUDEV)
  constructor(lab, dev) {
    this.lab = lab;
    this.dev = dev;
    this.tid = null;
    this.channel = null;               // the PER_SIO channel PER_SCPU's task opens
    this.config = null;                // its configuration {channel, clock}
    this.open = false;
    this.ends = [];                    // transfers ended, their callbacks not yet run: {rx, tx, desc, arg}
    this.transfers = [];               // every transfer: {tx, rx} (hex)
    this.prints = [];                  // the kernel prints of PER_SCPU's start
  }
  sim() { return this.lab.sim; }
  // H-SCPUSTART
  bring_up() {
    const lab = this.lab, devs = lab.sim.m.devices;
    if (!devs.linkpins) throw new LinkError(`H-SCPUSTART: ${MODEL}'s board gives no pins for the sub-CPU link (src/fw/board.mjs scpu_link): its PER_SCPU cannot run, and the lab has no other path for its SCPU requests`);
    if (BOARD.scpu.events?.message === undefined) throw new LinkError('H-SCPUSTART: the board gives no message port (scpu.events.message)');
    if (!lab.nk?.intc) throw new LinkError('H-SCPUSTART: the link needs K-native with native interrupts');
    this.pins = devs.linkpins;
    this.window = devs.scpu;
    for (const a of [PER_SCPU_TASK, SIO_OPEN, SIO_CONFIG, SIO_TRANSFER, SIO_CLOSE, GIO_SLOTS]) refuseUnmapped(a, 'H-SCPUSTART');
    const tids = [...lab.nk.tasks()].filter(([, [e]]) => e === PER_SCPU_TASK).map(([t]) => t);
    if (tids.length !== 1 || lab.nk.state(tids[0]) !== 0x10) throw new LinkError(`H-SCPUSTART: static tasks with PER_SCPU's entry ${h8(PER_SCPU_TASK)}: ${JSON.stringify(tids.map((t) => [t, lab.nk.state(t)]))}, not one dormant`);
    this.tid = tids[0];
    this.dev.connect({ ready: (v) => this.pins.setReady(v), message: (v) => this.window.setMessage(v) }, { request: this.pins.level.request, reset: this.pins.level.reset });
    this.pins.setReady(this.dev.out.ready);
    this.window.setMessage(this.dev.out.message);
    this.pins.connect({ output: (name, v) => this.dev.pin(name, v) });
    lab.hook(SIO_OPEN, (h, r) => this._open(h, r), 'S-SIO2 open');
    lab.hook(SIO_CONFIG, (h, r) => this._config(h, r), 'S-SIO2 configure');
    lab.hook(SIO_TRANSFER, (h, r) => this._transfer(h, r), 'S-SIO2 transfer');
    lab.hook(SIO_CLOSE, (h, r) => this._close(h, r), 'S-SIO2 close');
    if (lab.lt.idle_step) throw new LinkError('H-SCPUSTART: the lab task already steps a device at its idle point');
    lab.lt.idle_step = () => this.idle_step();
    if (!lab.hdmi) lab.step('H-GIOSLOTS (the sub-CPU link)', () => lab.call(GIO_SLOTS, null, null, null, 20000));
    lab.lt.allow.add(PER_SCPU_TASK);
    const ev0 = lab.kernel.events.length;
    const [rc] = lab.nk.svc('act_tsk', { d0: this.tid });
    if (rc !== K.E_OK) throw new LinkError(`H-SCPUSTART: act_tsk(${this.tid}) = ${rc}`);
    lab.settle('H-SCPUSTART');
    this.prints = lab.kernel.events.slice(ev0).filter((e) => e[0] === 'print').map((e) => e[2].trim());   // the task start's "SCPU RST!"
    const frames = this.dev.frames.map((f) => [f.cmd, f.data]);
    if (lab.nk.state(this.tid) !== 0x4 || !this.dev.powered || JSON.stringify(frames) !== JSON.stringify([['0x85', '020000']]) || this.open || this.ends.length || this.dev.pending()) {
      throw new LinkError(`H-SCPUSTART: after PER_SCPU's start: task ${this.tid} state 0x${lab.nk.state(this.tid).toString(16)}, the sub-CPU's gate ${this.dev.powered ? 'open' : 'closed'} in state ${this.dev.state}, frames ${JSON.stringify(frames)}, channel ${this.open ? 'open' : 'closed'}, ${this.ends.length} transfer ends pending: not waiting after 0x85 {2}`);
    }
  }
  // the lab task's idle point (src/lab/kernel.mjs LabTask idle_step): a transfer's end first (the MN's driver
  // interrupts as the last byte is clocked), then the sub-CPU's next action
  idle_step() {
    if (this.ends.length) {
      const e = this.ends.shift(), lab = this.lab;
      K.in_interrupt(lab.lt, () => {
        if (e.rx) lab.calls(disasm(e.rx), { a0: e.desc }, ISR_SP, ISR_CALLER, 5000);
        if (e.tx) lab.calls(disasm(e.tx), { a0: e.arg }, ISR_SP, ISR_CALLER, 5000);
      });
      return 'ready';
    }
    return this.dev.step() ? 'again' : false;
  }
  // ---- S-SIO2
  fail(r, what) { throw new LinkError(`S-SIO2: ${what} from ${where(r.mdr)}`); }
  // PER_SCPU's task runs now (not an interrupt)
  inTask() { const lt = this.lab.lt; return lt.current() === lt.tcb(this.tid) && !K.non_task_context(this.lab); }
  _open(h, r) {
    const ch = r.d0 & 0xFF;
    if (this.channel === null && this.inTask()) this.channel = ch;
    if (ch !== this.channel) return this.lab.passthrough(r);
    if (!this.inTask()) this.fail(r, `open of PER_SCPU's channel ${ch} outside PER_SCPU's task (${this.tid})`);
    if (this.open) this.fail(r, `open of channel ${ch}, open already`);
    this.open = true;
    if (r.a0) h.finish_after(r, disasm(r.a0), { a0: r.a1 }); else h.finish(r, { d0: 0 });
  }
  _config(h, r) {
    const b = this.sim().read(r.a0 >>> 0, CONFIG_BYTES), dv = new DataView(b.buffer, b.byteOffset, CONFIG_BYTES);
    if (b[0] !== this.channel) return this.lab.passthrough(r);
    if (!this.open) this.fail(r, `configuration of channel ${b[0]} while it is closed`);
    const cfg = { channel: b[0], clock: dv.getUint32(12, true), bytes: bytesHex(b) };
    if (this.config && this.config.bytes !== cfg.bytes) this.fail(r, `configuration ${cfg.bytes} after ${this.config.bytes}`);
    this.config = cfg;
    h.finish(r, { d0: 0 });
  }
  _transfer(h, r) {
    const sim = this.sim(), d = sim.read(r.a0 >>> 0, DESC_BYTES), dv = new DataView(d.buffer, d.byteOffset, DESC_BYTES);
    const [ch, dirs, txN, rxN] = d, [txBuf, rxBuf, txCb, txArg, rxCb] = [4, 8, 12, 16, 20].map((o) => dv.getUint32(o, true));
    if (ch !== this.channel) return this.lab.passthrough(r);
    if (!this.open || !this.config) this.fail(r, `transfer on channel ${ch} before its open and configuration`);
    if (dirs !== 3 || txN !== rxN || !txN || !rxBuf || txCb === 0xFFFFFFFF) this.fail(r, `transfer ${bytesHex(d)}: only a full-duplex transfer of equal counts into a buffer, ended by interrupt, is modelled`);
    const out = txBuf ? sim.read(txBuf, txN).slice() : new Uint8Array(txN);
    const back = this.dev.exchange(out);
    sim.write(rxBuf, back);
    this.transfers.push({ tx: bytesHex(out), rx: bytesHex(back) });
    this.ends.push({ rx: rxCb, tx: txCb, desc: r.a0 >>> 0, arg: txArg });
    h.finish(r, { d0: 0 });
  }
  _close(h, r) {
    if ((r.d0 & 0xFF) !== this.channel) return this.lab.passthrough(r);
    if (!this.open) this.fail(r, `close of channel ${r.d0 & 0xFF} while it is closed`);
    this.open = false;
    h.finish(r, { d0: 0 });
  }
}
