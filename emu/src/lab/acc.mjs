// The accelerometer (src/fw/models.mjs acc; docs/hle-gaps.md 4.7.3), stood in at its sample cache: what the firmware
// runs natively and what the lab stands in for.
//
// Natively: the ACC module init (H-ACCINIT runs it in the boot's place, its device part stepped over), ACC_MAIN (task
// 121: the probe once, then every 80 ms the cache copy and the correction), PER_SLOPE (task 78: while the GUI has
// started it, every 20 ms the remap, the conversion to mg, the asin table and the stability test, its results for the
// gauge's getter and its event 0x4125000 to the application) and every reader: the GUI's gauge and Level Adjust's
// sampling loop. Stood in: the sensor's register file at the register API (S-ACCREG: the probe's WHO_AM_I read and its
// two set-up writes), and the sensor with its data-ready pin, the sampler task ACC_SENS_MAIN and its transfer
// (S-ACCSAMPLE: before each of ACC_MAIN's cache copies, one new sample as the read's completion stores it, the packed
// halfwords and the counter + 1). The lab runs neither the data-ready pin (a GIO interrupt) nor PER_SIO's transfer
// layer, which ACC_SENS_MAIN would need; the probe's and the completion's effects are D, the cadence is A-ACC-2.
//
// The sample: a camera at rest reads gravity's reaction, 1 g along the body's up axis. The level camera's sample is the
// firmware's own pose-0 reference (the init computes the six pose references, +-16384 on one axis each, from the axis
// order and polarity 1, -2, 3 that the remap's table also holds; pose 0, "rotate 0", is the level camera, the sign
// PER_ROTATE's orientation 0 wants, D), and a tilt turns it: in the body's axes (the remap's output, in which the level
// camera's 1 g is on y; which way x and z point on the body is not read) the reading is G (-sin roll cos pitch, cos
// roll cos pitch, -sin pitch), G the reference's length (16384, the firmware's 1 g), mapped back to the sensor's axes
// through the inverse of the axis table. So the gauge's getter reads roll back as its horizon (-asin x) and pitch / 3
// as its vertical (-asin z / 3, D); which physical direction is positive is A-ACC-3. The temperature word is 0, 25.0
// degC by the firmware's conversion (raw / 256 + 25, D; A-ACC-1). The gyroscope's words have no reader and are not
// written.
import { FirmwareError, runtime, where } from './hle.mjs';
import { ValueError } from './errors.mjs';

export class AccError extends FirmwareError {}

// A-ACC-2: the tilts the lab takes keep the body's y axis the dominant one, the orientation PER_ROTATE (not run) would
// keep at 0 (it compares the axes' magnitudes, D); a larger tilt would turn the camera's orientation, which is not
// modelled
export const TILT_MAX_DEG = 45;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const s16 = (v) => (v << 16) >> 16;

// The body's reading of a camera turned by roll and pitch (degrees) with 1 g = g, in the remap's output axes
export function bodyReading(roll, pitch, g) {
  const r = (roll * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  return [-Math.sin(r) * Math.cos(p) * g, Math.cos(r) * Math.cos(p) * g, -Math.sin(p) * g];
}
// The remap's inverse: the firmware's remap gives body[i] = sign(axes[i]) * sensor[|axes[i]| - 1] (D), so
// sensor[|axes[i]| - 1] = sign(axes[i]) * body[i]; the halfwords are rounded and must fit a 16-bit sample
export function sensorOf(body, axes) {
  const out = [0, 0, 0], seen = new Set();
  axes.forEach((a, i) => {
    const k = Math.abs(a) - 1;
    if (!(k >= 0 && k < 3) || seen.has(k)) throw new AccError(`the axis table ${JSON.stringify(axes)} is not a permutation with signs`);
    seen.add(k);
    out[k] = Math.round(Math.sign(a) * body[i]);
  });
  for (const v of out) if (v < -32768 || v > 32767) throw new AccError(`sample ${JSON.stringify(out)} does not fit 16 bits`);
  return out;
}
export function bodyOf(sensor, axes) { return axes.map((a) => Math.sign(a) * sensor[Math.abs(a) - 1]); }
// A-ACC-2's range check: [roll, pitch] or a reason
export function tiltRefusal(roll, pitch) {
  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) return `roll ${roll}, pitch ${pitch}: numbers of degrees`;
  if (Math.abs(roll) > TILT_MAX_DEG || Math.abs(pitch) > TILT_MAX_DEG) return `roll ${roll}, pitch ${pitch}: at most ${TILT_MAX_DEG} degrees either way (A-ACC-2: PER_ROTATE, which would turn the camera's orientation, does not run)`;
  const [x, y, z] = bodyReading(roll, pitch, 1);
  if (y < Math.abs(x) || y < Math.abs(z)) return `roll ${roll}, pitch ${pitch}: the body's y axis would not be the dominant one (A-ACC-2)`;
  return null;
}

export class Accelerometer {
  // lab: the PlayLab; f: the model's fact acc; mutant: the session's mutant (acc-still: no sample is delivered, the
  // counter stays; tilt-ignored: the tilt is not applied)
  constructor(lab, f, mutant = null) {
    this.lab = lab; this.f = f; this.mutant = mutant;
    this.regs = new Map([[f.who_am_i[0], f.who_am_i[1]]]);     // the register file: WHO_AM_I and what the probe writes
    this.reg_log = [];                                         // [op, register, value or count] of every access
    this.tilt = [0, 0];
    this.level = null; this.axes = null; this.g = null;
    this.sample = null;                                        // the sensor's halfwords [x, y, z]
    this.samples = 0;
  }
  // H-ACCINIT and H-SLOPEINIT, before the application starts (it starts PER_SLOPE through the GUI's startLevel)
  bring_up() {
    const lab = this.lab, f = this.f, sim = lab.sim, { open, read, write, close } = f.reg;
    lab.hook(open, (h, r) => this._open(h, r), 'S-ACCREG open');
    lab.hook(read, (h, r) => this._read(h, r), 'S-ACCREG read');
    lab.hook(write, (h, r) => this._write(h, r), 'S-ACCREG write');
    lab.hook(close, (h, r) => { this.reg_log.push(['close', r.d0 & 0xFF]); h.finish(r, { d0: 0 }); }, 'S-ACCREG close');
    lab.hook(f.device, (h, r) => h.skip_call(r), 'H-ACCINIT device part');
    lab.observe(f.copy, () => this._deliver(), 'S-ACCSAMPLE');
    lab.lt.allow.add(f.main);
    lab.lt.allow.add(f.slope.main);
    lab.call(f.init, null, null, null, 20000);
    const [counterSlot, copySlot] = f.ptrs;
    if (sim.u32(counterSlot) !== f.counter || sim.u32(copySlot) !== runtime(f.copy)) {
      throw new AccError(`H-ACCINIT: the init stored ${h8(sim.u32(counterSlot))} and ${h8(sim.u32(copySlot))}, not the counter ${h8(f.counter)} and the copy ${h8(runtime(f.copy))}`);
    }
    this.main_tid = this._ready(f.main, 'H-ACCINIT', 'ACC_MAIN');
    // the pose-0 reference and the axis table, as the init left them
    const ref = [0, 2, 4].map((o) => s16(sim.u32(f.refs + o) & 0xFFFF));
    this.axes = [0, 4, 8].map((o) => sim.u32(f.axes + o) | 0);
    const body = bodyOf(ref, this.axes);
    this.g = Math.hypot(...ref);
    if (!(body[0] === 0 && body[2] === 0 && body[1] > 0)) {
      throw new AccError(`H-ACCINIT: the pose-0 reference ${JSON.stringify(ref)} is ${JSON.stringify(body)} in the body's axes (axes ${JSON.stringify(this.axes)}), not 1 g up`);
    }
    this.level = ref;
    this.sample = this._compute();
    lab.call(f.slope.init, null, null, null, 20000);
    this.slope_tid = this._ready(f.slope.main, 'H-SLOPEINIT', 'PER_SLOPE');
  }
  // the static task with this entry, which its init has just made ready (it runs once the lab task waits)
  _ready(entry, who, name) {
    const nk = this.lab.nk, tids = [...nk.tasks()].filter(([, [e]]) => e === entry).map(([t]) => t);
    if (tids.length !== 1 || (nk.state(tids[0]) & 0xF) !== 2) {
      throw new AccError(`${who}: the init left ${tids.length} task(s) at ${name}'s entry ${h8(entry)}${tids.length === 1 ? ` in state 0x${nk.state(tids[0]).toString(16)}` : ''}, not one ready`);
    }
    return tids[0];
  }
  // After the bring-up's settle: the probe's accesses as the firmware made them (D: open, the WHO_AM_I read, the two
  // set-up writes, close), its success flag set, and ACC_MAIN in its 80 ms wait; a reason, or null
  probe_problem() {
    const f = this.f, want = [['open', ...f.dev], ['read', ...f.who_am_i], ...f.setup.map(([k, v]) => ['write', k, v]), ['close', f.dev[0]]];
    if (JSON.stringify(this.reg_log) !== JSON.stringify(want)) return `S-ACCREG: the probe's accesses ${JSON.stringify(this.reg_log)}, not ${JSON.stringify(want)}`;
    if (!this.lab.nk.timed_waiters().includes(this.main_tid)) return `ACC_MAIN (task ${this.main_tid}) is not in its timed wait after the probe: ${this.lab.nk.state(this.main_tid).toString(16)}`;
    const ok = this.lab.sim.read(f.probed, 2);
    return ok[0] === 1 && ok[1] === 0 ? null : `the probe's success halfword ${h8(f.probed)} reads ${ok[0] | ok[1] << 8}, not 1`;
  }
  // H-ACCINIT's last part, after the probe: the cycles ACC_MAIN has run since the boot on the camera, before the
  // application starts, as one: S-ACCSAMPLE's sample, the cache copy and the correction natively from the lab task (the
  // lab's bring-up starts ACC_MAIN less than one 80 ms cycle before the GUI first reads the gauge, and PER_SLOPE reports
  // the gauge invalid until it has seen a new sample, D)
  prime() {
    const lab = this.lab, r = lab.calls(this.f.copy, null, undefined, undefined, 2000);   // ACC_MAIN calls it by `calls`, D
    if ((r.d0 & 0xFFFF) !== 0) throw new AccError(`H-ACCINIT: the cache copy returned 0x${(r.d0 & 0xFFFF).toString(16)} after the first sample`);
    lab.call(this.f.correct, null, null, null, 20000);
  }
  // the sample for the tilt: the level reference itself at [0, 0] (no rounding), else the turned reading
  _compute() {
    const [roll, pitch] = this.mutant === 'tilt-ignored' ? [0, 0] : this.tilt;
    if (roll === 0 && pitch === 0) return this.level.slice();
    return sensorOf(bodyReading(roll, pitch, this.g), this.axes);
  }
  set(roll, pitch) {
    const why = tiltRefusal(roll, pitch);
    if (why) throw new ValueError(`tilt ${why}`);
    this.tilt = [roll, pitch];
    this.sample = this._compute();
  }
  // S-ACCSAMPLE: the completion's stores (D: the halfwords and counter + 1), before ACC_MAIN's copy reads them
  _deliver() {
    if (this.mutant === 'acc-still') return;
    const sim = this.lab.sim, [xyz, temp] = this.f.words, b = new Uint8Array(6), dv = new DataView(b.buffer);
    this.sample.forEach((v, i) => dv.setInt16(2 * i, v, true));
    sim.write(xyz, b);
    sim.write(temp, new Uint8Array(2));
    const n = (sim.u32(this.f.counter) + 1) >>> 0;
    sim.write(this.f.counter, new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]));
    this.samples += 1;
  }
  // S-ACCREG: the register API's calls answered from the register file: open (d0 channel, d1 device), read (d1
  // register, a0 buffer, a1 count), write (d1 register, a0 value, a1 count), close (d0 channel); each returns 0 (its
  // callers ignore it, D). Only the probe's accesses have the firmware's evidence; any other stops the session
  _open(h, r) {
    const [ch, dev] = this.f.dev;
    if ((r.d0 & 0xFF) !== ch || (r.d1 & 0xFF) !== dev) throw new AccError(`S-ACCREG: open channel ${r.d0 & 0xFF} device ${r.d1 & 0xFF} from ${where(r.mdr)}: only the accelerometer's (${ch}, ${dev}) is modelled`);
    this.reg_log.push(['open', ch, dev]);
    h.finish(r, { d0: 0 });
  }
  _read(h, r) {
    const reg = r.d1 & 0xFF, n = r.a1 >>> 0;
    if (reg !== this.f.who_am_i[0] || n !== 1) throw new AccError(`S-ACCREG: read of ${n} byte(s) at register 0x${reg.toString(16)} from ${where(r.mdr)}: only WHO_AM_I (0x${this.f.who_am_i[0].toString(16)}, one byte) is modelled`);
    this.lab.sim.write(r.a0 >>> 0, new Uint8Array([this.regs.get(reg)]));
    this.reg_log.push(['read', reg, this.regs.get(reg)]);
    h.finish(r, { d0: 0 });
  }
  _write(h, r) {
    const reg = r.d1 & 0xFF, n = r.a1 >>> 0, v = r.a0 & 0xFF;
    if (!this.f.setup.some(([k]) => k === reg) || n !== 1) throw new AccError(`S-ACCREG: write of ${n} byte(s) at register 0x${reg.toString(16)} from ${where(r.mdr)}: only the probe's set-up writes are modelled`);
    this.regs.set(reg, v);
    this.reg_log.push(['write', reg, v]);
    h.finish(r, { d0: 0 });
  }
  // The gauge's getter natively, as the GUI's getSlope calls it (D: its 12-byte record +2 the horizon in 0.1 degree, +4
  // its validity, +6 the vertical, +8 its validity, +10 the body orientation; a caller's +11 = 11 clears both
  // validities, so the record starts zeroed); the lab task's packet area holds it
  gauge() {
    const lab = this.lab, a = lab.nk.packet(new Uint8Array(12));
    lab.call(this.f.slope.get, { a0: a }, null, null, 20000);
    const b = lab.sim.read(a, 12), dv = new DataView(b.buffer, b.byteOffset, 12);
    return { horizon: dv.getInt16(2, true), horizon_ok: dv.getUint16(4, true), vertical: dv.getInt16(6, true), vertical_ok: dv.getUint16(8, true), body: b[10] };
  }
  status() {
    return { tilt: this.tilt.slice(), sample: this.sample.slice(), samples: this.samples, counter: this.lab.sim.u32(this.f.counter), registers: Object.fromEntries([...this.regs].map(([k, v]) => [`0x${k.toString(16)}`, v])) };
  }
}
