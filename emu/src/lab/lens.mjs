// The lens on the mount, natively (models.mjs lens_native: E143, E146 and E147; the default, play.mjs lens_option:
// env.lens 'stand-in', node's OM_EMU_LENS=stand-in, takes S-LENS instead; docs/hle-gaps.md 4.4.2, 4.4.3): the firmware's
// lens tasks, its lens driver, its serial driver LENS_SSC and its interrupt run natively against the lens serial
// controller (src/dev/lensssc.mjs) with the lens's microcontroller at the far end (S-LENSMCU, src/lab/lensmcu.mjs). The
// driver's entry points, queue, flags and cache area are the body's, read by src/fw/facts.mjs lensDriver (fact
// lens_driver; E143's addresses below, LENS_DRIVER_E143 there); the deferred-call init is fact dpc's, the NAND read
// operation the card's (fact storage) and LLPSW's bit the body's UI_IN tables' (play.mjs CONTROLS). What the lab does in
// the boot's and the other modules' place:
//   H-DPCINIT   the deferred-call init (pre-kernel, 0x50050279: the rings cleared, IRQs 53..58 attached), run before
//               the lens init, as the boot head runs it before the kernel: the lens's power and detect paths post
//               their continuations as deferred calls (0x5005043f, 0x500503d4), which the triggers' IRQs run at the
//               MN's next idle point (src/dev/dpc.mjs)
//   H-LENSINIT  the boot chain's lens module init (0x502a5d10, boot call 0x50024ab6), then USTART_L's lens data cache
//               load (0x502a6371, boot call 0x5002420e) and lens task variables (0x502a5dff, 0x50024222), in that
//               order (I: the module init clears the cache's ready byte 0x6296d206 that the load sets and the lens
//               start waits on, 0x501263b1, so the load comes after it), and the three lens tasks (LENS_MAIN,
//               LENS_COMMAND, LENS_ASKDATA) started, as the boot's task start would
//   S-LENSNAND  the lens data caches' NAND (0x416e0000, 7 areas of 256 KiB, the area table 0x602a4a24 the flash area
//               driver 0x501a921f reads for area 6) behind the NAND access the card's S-FSNAND serves
//               (src/lab/storage.mjs): erased on a camera that never saved it, the firmware's writes kept for the
//               session; the cache load then finds no lens cached (0x50125e24 checks the block's sum, X)
//   H-LENSON    TAKE_FUNC's lens request at the camera's start (0x502cd9c7..0x502cd9f2: to LENS_EXEC, word 2 the
//               command 1, word 3 a 12-byte buffer), posted by the lab with no reply queue (word 0 is 0: LENS_MAIN
//               replies only to a queue it is given, 0x502a5ec0, and TAKE_FUNC, which would take the reply, does not run)
//   the mount   a lens on it: the detect pin low (the controller's, src/dev/lensssc.mjs) and the lens lock pin switch
//               LLPSW (UI_IN 0x121c, group 1) released in the idle image, the state of a lens locked on the mount
//               (D: the lens power-on path 0x502c091e powers the lens when 0x5014c015(0x121c) answers 1, which the
//               released bit gives, X)
// The lens's start then runs natively in lab time: LENS_MAIN's camera-on (0x502a6051) arms the lens detect and the
// power-on sequence (0x501240b8: the power pin 125, a 10 ms settle, the wake-up frame, the connection request), the
// init chain (0x50122689 on: the frames of src/lab/lensmcu.mjs) and the state poll. The bring-up runs lab time until
// the driver's lens-0 data-valid and attach flags are set and the chain has reached the state poll, and checks it.
import { fact } from '../fw/model.mjs';
import { LENS_DRIVER_E143, DPC_E143, STORAGE_E143 } from '../fw/facts.mjs';
import { FirmwareError, where } from './hle.mjs';
import { OLYQEWR } from './display.mjs';
import * as K from './kernel.mjs';
import * as N from './nav.mjs';
import { LensMcu, LENS_1240, LensError, frameName } from './lensmcu.mjs';

export class NativeLensError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const pack32 = (...w) => { const b = new Uint8Array(4 * w.length); const dv = new DataView(b.buffer); w.forEach((v, i) => dv.setUint32(4 * i, v >>> 0, true)); return b; };

// the lab time the bring-up gives the lens's start, at most, and the step it runs it in
export const LENS_START_MS = 1000, LENS_STEP_MS = 10;
// H-LENSON's command, TAKE_FUNC's camera-on: word 2 of its request to LENS_EXEC, `mov 1,d0; mov d0,(24,sp)` before
// the post (0x502cd9c7..0x502cd9f2, D; E146's and E147's TAKE_FUNC the same, D)
export const LENS_CAMERA_ON = 1;

export class NativeLens {
  // session: the PlaySession; llpsw: LLPSW's entry of the body's UI_IN tables [group, byte, bit, code, type, polarity]
  // (play.mjs CONTROLS)
  constructor(session, llpsw) {
    this.s = session;
    this.f = fact('lens_driver', LENS_DRIVER_E143);
    this.dpc_init = fact('dpc', DPC_E143).init;
    this.nand_read = fact('storage', STORAGE_E143).nand.read;
    this.llpsw = llpsw;
    this.mcu = new LensMcu(LENS_1240);
    this.ssc = null;
    this.nand = new Map();               // S-LENSNAND: written blocks, flash address -> bytes
    this.log = [];                       // [kind, detail] of every stand-in action
    this.started = false;
  }
  // the idle image's LLPSW released, its bit at the other level than the entry's polarity (E143's bit 0 reads as
  // EV_PRESS_LLPSW): a lens locked on the mount (before UI_IN's groups are pushed)
  lock(images) {
    if (!this.llpsw) throw new NativeLensError('the mount: LLPSW (0x121c) is not in the body\'s UI_IN tables');
    const [g, b, bit, , , pol] = this.llpsw;
    if (pol) images[g][b] &= ~(1 << bit) & 0xFF; else images[g][b] |= 1 << bit;
  }
  bring_up() {
    const s = this.s, lab = s.lab, f = this.f, devs = lab.sim.m.devices;
    if (!devs.lens || !devs.dpc) throw new NativeLensError('H-LENSINIT: the board gives no lens controller or deferred-call triggers (src/fw/board.mjs lens, dpc)');
    this.ssc = devs.lens;
    this.ssc.connect({ frame: (fr) => this.frame(fr) });
    this.ssc.mount(true);
    if (!s.storage) throw new NativeLensError('S-LENSNAND: the lens data cache needs the NAND access the card\'s file system serves (src/lab/storage.mjs S-FSNAND)');
    const access = s.storage.f.nand.access;
    lab.wrap(access, (prev) => (h, r) => this._nand(h, r, prev), 'S-FSNAND, S-LENSNAND');
    lab.step('H-DPCINIT the deferred-call init 0x50050279 (pre-kernel)', () => lab.call(this.dpc_init, null, null, null, 200000));
    lab.step('H-LENSINIT the lens module init 0x502a5d10 (boot call 0x50024ab6)', () => lab.call(f.module_init, null, null, null, 2000000));
    lab.step('H-LENSINIT the lens data cache load 0x502a6371 (USTART_L)', () => lab.call(f.cache_init, null, null, null, 2000000));
    lab.step('H-LENSINIT the lens task variables 0x502a5dff (USTART_L)', () => lab.call(f.task_vars, null, null, null, 200000));
    this.tids = [];
    for (const e of f.tasks) {
      const t = [...lab.nk.tasks()].filter(([, [en]]) => en === e).map(([id]) => id);
      if (t.length !== 1 || lab.nk.state(t[0]) !== 0x10) throw new NativeLensError(`H-LENSINIT: static tasks with entry ${h8(e)}: ${JSON.stringify(t)}, not one dormant`);
      lab.lt.allow.add(e);
      const [rc] = lab.nk.svc('act_tsk', { d0: t[0] });
      if (rc !== K.E_OK) throw new NativeLensError(`H-LENSINIT: act_tsk(${t[0]}) = ${rc}`);
      this.tids.push(t[0]);
    }
    s.settle('H-LENSINIT lens tasks');
    // H-LENSON
    const q = lab.sim.read(f.exec_queue, 2), queue = q[0] | q[1] << 8;
    const buf = lab.alloc(new Uint8Array(12), 4);
    const payload = lab.alloc(pack32(0, 1, LENS_CAMERA_ON, buf), 4), desc = lab.alloc(pack32(payload, 16), 4);
    const r = lab.call(OLYQEWR, { d0: queue, d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000);
    if (r.d0 !== 0) throw new NativeLensError(`H-LENSON: the request to LENS_EXEC (queue ${queue}) = ${h8(r.d0)}`);
    this.log.push(['lens-on', `queue ${queue}, command ${LENS_CAMERA_ON}`]);
    s.settle('H-LENSON');
    const t0 = lab.lab_time();
    while (!this.ready() && lab.lab_time() - t0 < LENS_START_MS * 1e6) this.run(LENS_STEP_MS);
    if (!this.ready()) throw new NativeLensError(`the lens's start: after ${LENS_START_MS} ms flags ${JSON.stringify(this.flags())}, frames ${JSON.stringify(this.mcu.frames.slice(-12))}`);
    this.started = true;
    this.log.push(['lens-start', `${(lab.lab_time() - t0) / 1e6} ms, ${this.mcu.frames.length} frames`]);
  }
  // lab time, ms of it, inside the bring-up's step (as a wait's slices run it, src/lab/nav.mjs wait_until)
  run(ms) {
    const lab = this.s.lab;
    lab.step_storm += Math.ceil(ms * N.WAIT_STORM_PER_MS);
    lab.lt.elapse_until(lab.lab_time() + ms * 1e6, () => lab.lab_time(), (x) => lab.run_to_event(x), N.STEP_HOOKS * 4 + ms * N.WAIT_HOOKS_PER_MS);
  }
  flags() {
    const sim = this.s.lab.sim, { valid, attach, ready } = this.f.flags;
    return { valid: sim.read(valid, 1)[0], attach: sim.read(attach, 1)[0], ready: sim.read(ready, 1)[0] };
  }
  // the driver's lens 0 attached with its data valid, and the chain at its state poll
  ready() {
    const fl = this.flags();
    return fl.valid === 1 && fl.attach === 1 && this.mcu.counts.has('c1 80');
  }
  // the controller's far end: S-LENSMCU (an unknown frame throws a LensError, which the controller reports on its
  // line and turns into a bus error: the session stops there, naming the frame)
  frame(fr) {
    try { return this.mcu.frame(fr); } catch (e) {
      if (e instanceof LensError) this.error = e.message;
      throw e;
    }
  }
  // S-LENSNAND (and S-FSNAND below it): the lens caches' area erased, the firmware's writes kept
  _nand(h, r, prev) {
    const [base, size] = this.f.cache_area, flash = r.a1 >>> 0, n = r.d0 >>> 0, op = r.d1 >>> 0;
    const lab = this.s.lab;
    // a read of no bytes reads nothing: the lens tables' flash area (area 2, 0x501a9322) has no extent in the lab,
    // whose flash area init does not run (its table 0xa32db32c is 0), so the lens data lookup 0x502ae5d9 reads 0
    // bytes at 0 and logs the lens as not found (X)
    if (n === 0 && op === this.nand_read) { this.log.push(['nand', `read 0 bytes at ${h8(flash)} from ${where(r.mdr)}`]); return h.finish(r, { d0: 0 }); }
    if (flash < base || flash + n > base + size) return prev(h, r);
    if (op !== this.nand_read) throw new NativeLensError(`S-LENSNAND: NAND access 0x${op.toString(16)} of ${n} bytes at flash ${h8(flash)} from ${where(r.mdr)}: only reads are modelled`);
    const out = new Uint8Array(n).fill(0xFF);
    for (const [at, bytes] of this.nand) {
      const lo = Math.max(at, flash), hi = Math.min(at + bytes.length, flash + n);
      if (lo < hi) out.set(bytes.subarray(lo - at, hi - at), lo - flash);
    }
    lab.sim.write(r.a0 >>> 0, out);
    this.log.push(['nand', `read ${n} bytes at ${h8(flash)}`]);
    h.finish(r, { d0: 0 });
  }
  // the zoom ring to the step nearest focal_mm (S-SCENE's focal length): the lens reports it at the driver's next
  // state poll (X: every 100 ms)
  zoom(focal_mm) {
    if (this.mcu.setFocal(focal_mm)) this.log.push(['zoom', `${this.mcu.focal()} mm`]);
  }
  status() { return { started: this.started, flags: this.flags(), frames: this.mcu.frames.length, counts: Object.fromEntries(this.mcu.counts), zoom: this.mcu.focal() }; }
  take_log() { return this.log.splice(0); }
}
export { frameName };
