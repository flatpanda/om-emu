// The power manager and the camera's power-off natively (docs/hle-gaps.md 4.7.4), on a body whose src/fw/models.mjs
// entry gives power_native (E143, E146, E147), at the addresses src/fw/facts.mjs powerOff reads from its firmware (fact
// 'power.off'; E143's POWER_OFF_E143 there, with the evidence for every address). At the play bring-up the power
// manager's task, PWR_MAIN, starts as the boot starter would start it, with the IO expanders it talks to (where the
// body has them) stood in at their tasks' seam; at the power lever's off
// (decoded natively: UI_IN through IRQ 320, H-SCPUPORT; the application takes its code) the lab runs the power-off the
// firmware's own code makes of it and ends the session at its last write, instead of closing at once (H-POWER).
//
//   H-PWRSTART  the boot starter's start of the power manager (its init, then act_tsk of PWR_MAIN's static task, its
//               entry allowed) at the play bring-up, after PER_SCPU's start and UI_IN's port scan, where the boot
//               would have run it long before (it runs before UI_IN's module init there); then a settle. The init runs
//               its start-up message through the task's handler on the lab task: a GIO read of the sub-CPU's PC13
//               (0x82 {45}), the power manager's handshake with the sub-CPU (0x12 {5}, answered by the sub-CPU's own
//               message 0x12 {5}, which the MN polls), and on E143 and E146 two writes of the PBH expander's GIO
//               extension (X);
//               PWR_MAIN then waits on its flag for its queue's messages. Checked: the task waiting, every frame of the
//               start answered, no errlog. The task is the static task whose id the starter's id word holds
//   S-IOEXP     the IO expanders' tasks, PER_IOEXP and PER_IOEXP_PBH, do not run (their PER_SIO channels, their chips
//               and their interrupt lines are not modelled; the boot's inits that start them do not run): each request
//               their APIs post is taken off at the post and completed at the next idle point as the task completes it,
//               in interrupt context: a request without data by its completion flag's bit 1, which its caller waits
//               for; the GIO extension's write (the PBH's request 1 with the pins' mask, its word, a callback and its
//               argument) by the callback with the argument, which the API calls itself while the PBH is in its state 5
//               (I: that the task's completion calls it alike). What the expanders' pins do is not modelled; any other
//               request stops the session. A body whose power-off sends no expander a command (E147) has none in the
//               lab
//   S-SHUTDOWN  the HLS component that turns EV_POWER_SW_OFF into the shutdown, the camera-common component
//               (CmpCCom_CameraCommonComponent), is not created in the lab (no HLS component in camapp 1, and camapp
//               2's bring-up does not create it: X, it never ran). In its place the lab calls the HFW's CameraCommon
//               object's shutDown(mode, reason) through the object's own vtable slot, as the shell's "sdk api
//               shutdown" does, with API_SHUTDOWN_NORMAL and API_SHUTDOWN_REASON_BUTTON (the values its usage text
//               gives; I: the lever's reason), on the lab task and in lab time: while the call waits, lab time runs to
//               the next event, as an idle slice does. From there the firmware runs: OlyHfwPower's startShutDown, the
//               settings' save, the RAM log's save, the file module's power-off, api_system's power-off sequence with
//               the IO expanders' power-off commands (and the GIO extension's pins, where the body has them), the
//               window's ports and wake word, the sub-CPU's 0x85 power-off over the link
//               (PER_SCPU natively, to S-SCPUDEV or the sub-CPU's own firmware) and, last, 127 into the window's
//               request word. The session ends at the instruction after that write's call (power.off end)
//   S-PWRLOG    the RAM log's save to the NAND (2 MiB to its own area): the NAND access is answered done, nothing kept
//               (the controller is not modelled; S-FSNAND keeps the file system's area only)
//   S-FLASHSAVE the settings' save of startShutDown is listed with the DB init's (without S-NVRAM: skipped, as the
//               menu's close is skipped by S-SETSAVE; with it the save runs natively down to the NAND write)
//   H-SCPUPOLL  after its 0x85 the MN polls pin 102 in a loop until the sub-CPU drops it, without an idle point (D):
//               at each poll the sub-CPU acts as at an idle point (A-SCPUDEV-1, A-SCPUM4-1), until the pin is low.
//               On the camera it runs beside the MN; the lab gives it the MN's poll as its point to act (I)
import { MODEL, MODEL_INFO, fact } from '../fw/model.mjs';
import { POWER_OFF_E143, POWER_OFF_LIB } from '../fw/facts.mjs';
import { FirmwareError, ISR_CALLER, ISR_SP, disasm, runtime, where } from './hle.mjs';
import * as K from './kernel.mjs';
import { STEP_HOOKS, STORM, WAIT_HOOKS_PER_MS, WAIT_STORM_PER_MS } from './nav.mjs';
import { STORAGE } from './storage.mjs';
import { FLASH_SAVE } from './menu.mjs';
import { EXPECTED_ERRLOG } from './display.mjs';

export class PowerError extends FirmwareError {}
class SequenceEnd extends Error {}    // control flow: the firmware reached the power-off's last write

// This body's power-off facts (src/fw/facts.mjs powerOff, in the model's disassembly notation), or null where its
// MODELS entry does not run the power-off natively (power_native)
export function powerFacts() {
  if (!MODEL_INFO.power_native) return null;
  const f = fact('power.off', POWER_OFF_E143);
  if (!f) throw new PowerError(`${MODEL}: src/fw/models.mjs gives power_native, but src/fw/facts.mjs powerOff found no power-off in its firmware`);
  return f;
}
export const POWER_OFF = powerFacts();
// the PBH expander's request the GIO extension's write sends (src/fw/facts.mjs POWER_OFF_LIB, with its evidence)
const IOEXP_WRITE = POWER_OFF_LIB.ioexp_write;

// the lab time the power-off may take, from the shutdown's call to its last write: the run in the lab takes about
// 0.1 s (X); the firmware's own waits on the way end in 1 to 5 s (the IO expanders', PER_SCPU's), so a stuck path
// shows as one of them or as this deadline
export const POWER_OFF_MS = 10000;
// the sub-CPU's steps per poll of pin 102 (H-SCPUPOLL), and the polls before the lab gives up on the pin
const POLL_STEPS = 64, POLL_LIMIT = 1000;
// the SCPU window's request word (src/fw/board.mjs scpu.storage), which the power-off's last write sets to 127
const REQUEST_WORD = 0x9c;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

// S-IOEXP: the IO expanders' requests, from the bring-up on
export class IoExpanders {
  // lab: the PlayLab; f: power.off ioexp
  constructor(lab, f) {
    this.lab = lab; this.f = f;
    this.taken = [];               // every request taken {expander, cmd, from}
    this.pending = [];             // completions due at the next idle point
    this.log = [];                 // [kind, detail] of every completion, until taken
  }
  install() {
    const lab = this.lab;
    for (const name of ['body', 'pbh']) lab.hook(this.f[name].post, (h, r) => this.request(name, h, r), `S-IOEXP (${name})`);
    lab.lt.idle_steps.push(() => this.idle_step());
  }
  // a request posted to an expander's task (d0 the command, a0 its data or 0), completed at the next idle point
  request(name, h, r) {
    const lab = this.lab, f = this.f, cmd = r.d0 & 0xFFFF, data = r.a0 >>> 0;
    this.taken.push({ expander: name, cmd, from: where(r.mdr) });
    if (data === 0) {
      const flag = lab.sim.read(f[name].flag, 2), id = flag[0] | flag[1] << 8;
      this.pending.push(() => {
        const rc = K.isr_call(lab.lt, K.SVC.iset_flg, { d0: id, d1: 1 });
        if (rc !== K.E_OK) throw new PowerError(`S-IOEXP: iset_flg(${id}, 1) = ${rc}`);
      });
      this.log.push(['ioexp', `${name} request ${cmd} from ${where(r.mdr)}: completed (flag ${id} bit 1)`]);
    } else if (name === 'pbh' && cmd === IOEXP_WRITE) {
      // the GIO extension's write: {+0 the pins' mask, +4 a byte, +8 the request's first word, +16 its callback, +20
      // the callback's argument} (IOEXP_WRITE)
      const pins = lab.sim.u32(data) >>> 0, word = lab.sim.u32(data + 8) >>> 0, cb = lab.sim.u32(data + 16) >>> 0, arg = lab.sim.u32(data + 20) >>> 0;
      if (!cb) throw new PowerError(`S-IOEXP: the GIO extension's write from ${where(r.mdr)} has no callback`);
      this.pending.push(() => lab.calls(disasm(cb), { a0: arg }, ISR_SP, ISR_CALLER, 5000));
      this.log.push(['ioexp', `${name} request ${cmd} (the GIO extension's write, pins ${h8(pins)}, word ${word}) from ${where(r.mdr)}: its callback ${h8(disasm(cb))}`]);
    } else throw new PowerError(`S-IOEXP: ${name} request ${cmd} with data ${h8(data)} from ${where(r.mdr)}: not modelled (the expanders' tasks do not run)`);
    h.finish(r, { d0: 0 });
  }
  // the lab task's idle point (kernel.mjs LabTask idle_steps): the completions due, in interrupt context
  idle_step() {
    if (!this.pending.length) return false;
    K.in_interrupt(this.lab.lt, () => { for (const done of this.pending.splice(0)) done(); });
    return 'ready';
  }
  take_log() { const out = this.log; this.log = []; return out; }
}

// H-PWRSTART (f: power.off pwr)
export function startPowerManager(session, f) {
  const lab = session.lab, dev = lab.scpu_dev, { init } = f, w = lab.sim.read(f.id_word, 2), tid = w[0] | w[1] << 8;
  const entry = [...lab.nk.tasks()].find(([t]) => t === tid)?.[1][0];
  if (entry === undefined || lab.nk.state(tid) !== 0x10) throw new PowerError(`H-PWRSTART: PWR_MAIN's static task ${tid} (the id word ${h8(f.id_word)}): ${entry === undefined ? 'none' : `state 0x${lab.nk.state(tid).toString(16)}`}, not dormant`);
  const f0 = dev.frames.length, e0 = lab.kernel.errors.length;
  lab.step(`H-PWRSTART the power manager's init ${h8(init)} (the boot starter's, before its task)`, () => lab.call(init, null, null, null, 2000000));
  lab.lt.allow.add(entry);
  const [rc] = lab.nk.svc('act_tsk', { d0: tid });
  if (rc !== K.E_OK) throw new PowerError(`H-PWRSTART: act_tsk(${tid}) = ${rc}`);
  session.settle('H-PWRSTART');
  const frames = dev.frames.slice(f0), errlog = lab.kernel.errors.slice(e0).filter(([c]) => !EXPECTED_ERRLOG.has(c)).map(([c, , , w]) => `${h8(c)} from ${w}`);
  const unanswered = frames.filter((x) => (Number(x.cmd) & 0x80) && !x.reply);
  if (lab.nk.state(tid) !== 0x4 || unanswered.length || errlog.length) {
    throw new PowerError(`H-PWRSTART: after the power manager's start: task ${tid} state 0x${lab.nk.state(tid).toString(16)}, frames ${JSON.stringify(frames)}, errlog ${JSON.stringify(errlog)}: not waiting with its requests answered`);
  }
  return { tid, frames };
}

// H-POWER after the lever's off: S-SHUTDOWN to the power-off's last write
export class PowerOff {
  // session: the PlaySession, whose lab runs PER_SCPU over the link, the power manager (H-PWRSTART) and, on a body with
  // IO expanders, S-IOEXP; f: the body's power.off facts
  constructor(session, f) {
    this.s = session; this.lab = session.lab; this.f = f;
    this.link = this.lab.scpu_link;
    this.ioexp = session.ioexp;
    if (!this.link || !session.power_manager || !this.ioexp !== !f.ioexp) throw new PowerError('S-SHUTDOWN: the power-off needs PER_SCPU over the link (H-SCPUSTART), the power manager (H-PWRSTART) and, with IO expanders, their stand-in (S-IOEXP)');
    this.polls = 0;                // H-SCPUPOLL: pin 102 polls
    this.log = [];                 // [kind, detail] of every stand-in action, in order
  }
  run() {
    const lab = this.lab, f = this.f, sd = f.shutdown, ioexp = this.ioexp;
    const at = { object: sd.object, entry: sd.entry, save: f.flash_save, log: f.log.ret, end: f.end, poll: f.poll.at };
    const dev = this.link.dev, f0 = dev.frames.length, t0 = lab.lab_time(), e0 = lab.kernel.errors.length, x0 = ioexp?.taken.length ?? 0;
    const pins = lab.sim.m.devices.linkpins, p0 = pins.log.length;
    ioexp?.take_log();
    this.install(at);
    const obj = lab.call(at.object, null, null, null, 200000).a0 >>> 0;
    const fn = disasm(lab.sim.u32(lab.sim.u32(obj) + 4 * sd.slot));
    if (fn !== at.entry) throw new PowerError(`S-SHUTDOWN: the CameraCommon object ${h8(obj)}'s slot ${sd.slot} is ${h8(fn)}, not shutDown ${h8(at.entry)}`);
    const deadline = t0 + POWER_OFF_MS * 1e6, lt = lab.lt, previous = lt.on_idle, settling = lt.settling;
    lab.step_storm = STORM + Math.ceil(POWER_OFF_MS * WAIT_STORM_PER_MS);
    // not a lab step: a step is a display run, where a sleep is the lab clock's (menu.mjs in_display_run), and here the
    // firmware's tasks sleep natively while the lab task waits, as in an idle slice (kernel.mjs elapse_until); the
    // firmware's error log is checked as a step's is
    let ended = false;
    lt.on_idle = () => this.idle(deadline); lt.settling = true;
    try {
      lab.calls(fn, { a0: obj, d0: sd.mode, d1: sd.reason }, undefined, undefined, STEP_HOOKS * 4 + POWER_OFF_MS * WAIT_HOOKS_PER_MS);
    } catch (e) {
      if (!(e instanceof SequenceEnd)) throw e;
      ended = true;
    } finally { lt.on_idle = previous; lt.settling = settling; }
    const errlog = lab.kernel.errors.slice(e0), unexpected = errlog.filter(([c]) => !EXPECTED_ERRLOG.has(c));
    if (unexpected.length) throw new PowerError(`S-SHUTDOWN: firmware error log: ${unexpected.map(([c, , , caller]) => `${h8(c)} from ${caller}`).join('; ')}`);
    if (!ended) throw new PowerError(`S-SHUTDOWN: shutDown returned without the power-off's last write (${h8(at.end)})`);
    if (ioexp?.pending.length) throw new PowerError(`S-IOEXP: ${ioexp.pending.length} completion(s) still due at the power-off's end`);
    return {
      lab_ns: [t0, lab.lab_time()], frames: dev.frames.slice(f0), pins: pins.log.slice(p0).map(([n, v]) => `${n} ${v}`), ready: pins.level.ready,
      scpu: { state: dev.state, power: dev.power ?? null }, request_word: lab.sim.m.devices.scpu.reg[REQUEST_WORD >> 2],
      ioexp: ioexp?.taken.slice(x0) ?? [], polls: this.polls, errlog: errlog.map(([c]) => h8(c)), log: [...this.log, ...(ioexp?.take_log() ?? [])],
    };
  }
  // the lab task's idle point while shutDown waits (after the idle steps, the sub-CPU's and S-IOEXP's): lab time to the
  // next event
  idle(deadline) {
    const lab = this.lab;
    if (lab.lab_time() < deadline) { lab.run_to_event(deadline); return 'again'; }
    throw new PowerError(`S-SHUTDOWN: the power-off had not reached its last write after ${POWER_OFF_MS} ms of lab time; tasks ${JSON.stringify([...lab.task_states()])}`);
  }
  install(at) {
    const lab = this.lab, f = this.f;
    // S-FLASHSAVE: the settings' save of startShutDown listed (with S-NVRAM, menu.mjs, it runs natively)
    (lab.flash_save_listed ??= new Set()).add(at.save);
    if (lab.hooks.has(runtime(FLASH_SAVE))) lab.wrap(FLASH_SAVE, (prev) => (h, r) => {
      if (disasm(r.mdr) === at.save) this.log.push(['flashsave', `the settings' save from ${where(r.mdr)} skipped`]);
      return prev(h, r);
    });
    // S-PWRLOG: the RAM log's NAND write
    const nand = STORAGE?.nand.access ?? null;
    if (nand === null) throw new PowerError('S-PWRLOG: the body gives no NAND access (src/fw/facts.mjs fileSystem storage.nand)');
    const [area, size] = f.log.nand;
    const log = (prev) => (h, r) => {
      if (disasm(r.mdr) !== at.log) return prev(h, r);
      if ((r.a1 >>> 0) !== area || (r.d0 >>> 0) !== size || (r.d1 >>> 0) !== STORAGE.nand.write) throw new PowerError(`S-PWRLOG: NAND access 0x${(r.d1 >>> 0).toString(16)} of ${r.d0 >>> 0} bytes at ${h8(r.a1)} from ${where(r.mdr)}: not the RAM log's write of ${size} bytes at ${h8(area)}`);
      this.log.push(['pwrlog', `the RAM log's ${size} bytes from ${h8(r.a0)} to the NAND at ${h8(area)}: answered, not kept`]);
      return h.finish(r, { d0: 0 });
    };
    if (lab.hooks.has(runtime(nand))) lab.wrap(nand, log, 'S-PWRLOG');
    else lab.hook(nand, log((h, r) => lab.passthrough(r)), 'S-PWRLOG');
    // H-SCPUPOLL
    const pins = lab.sim.m.devices.linkpins, dev = this.link.dev;
    lab.hook(at.poll, (h, r) => {
      this.polls += 1;
      for (let k = 0; k < POLL_STEPS && pins.level.ready; k++) if (!dev.step()) break;
      if (pins.level.ready && this.polls >= POLL_LIMIT) throw new PowerError(`H-SCPUPOLL: pin ${f.poll.pin} still high after ${this.polls} polls: the sub-CPU did not stop its link after the power-off's 0x85 (${dev.state}, ${dev.power ?? '?'})`);
      lab.passthrough(r);
    }, 'H-SCPUPOLL');
    // the end: past the call of the window's last write
    lab.hook(at.end, () => { this.log.push(['end', `${h8(at.end)}: the window's request word ${h8(lab.sim.m.devices.scpu.reg[REQUEST_WORD >> 2])}`]); throw new SequenceEnd(); }, 'H-POWER (the power-off\'s end)');
  }
}
