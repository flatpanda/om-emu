// The audio hardware in a play session (--audio auto, the default, or on; E143; docs/hle-gaps.md 4.5, where the
// firmware addresses cited here are listed): the machine's audio serial port and SCA page (src/dev/audio.mjs), the
// sound IC on PER_SIO's channel 14 (S-WM8946, src/lab/wm8946.mjs), the CPU 2 side of AUD_MAIN's start (S-AUDCPU2),
// AUD_MAIN's start (H-AUDSTART) and the sink that hands the port's PCM to the session's audio output
// (src/lab/audio.mjs). With --audio off, and on a body without MODELS audio, the machine has no port and nothing here
// runs.
//
// H-AUDSTART: AUD_MAIN (task 0x52, entry 0x50a62a05), which the boot's USTART2 starts with OlyTaSt at 0x501e950b and
// the lab, ending the init task, does not, is started natively at the play bring-up (act_tsk of its static task). Its
// entry runs its own init (0x50a628ac, 0x50a62ddc), starts AUD_WAKEUP (0x2017) on CPU 2 and waits for flag 0xf9, waits
// for the image's stage 6 (0x50024de8(6): 2 ms sleeps until bit 5 of the stages' ready word (0xa32df1f4) is set, which
// the boot's per-segment step 0x50024eda sets once CPU 2's overlay loader has read the segment), then the driver's init
// (0x50aabe14: the SCA's 0x50aaee3c, the port's 0x50aa8ce9, which attaches IRQ 43; 0x50aab67e attaches IRQ 45), starts
// AUD_COPY_DATA (0x51), AUD_LEVEL_MONITOR (0x200e, CPU 2) and AUD_WATCH_DOG (0x07) and waits on its queue AUD_EXEC
// (0x08) (D: 0x50a62a05..0x50a62aca). The lab allows the two CPU 0 tasks' starts (their id words
// MODEL_INFO.audio.starts) and checks after the start that AUD_MAIN and AUD_COPY_DATA wait. USTART2 calls 0x501553fa
// just before (0x501e94fd): that is the still-image and power modules' step (0x50167b3a, 0x50858656), not the audio
// module's, and the lab does not run it (D). The lab's image holds every stage's code (as for S-BOOTSTAGE's stage 1,
// src/lab/menu.mjs), so H-AUDSTART sets stage 6's bit before AUD_MAIN's start, for the whole session (any other code
// that reads stage 6 sees it set too); the later stages stay unset.
//
// S-AUDCPU2: CPU 2 is not in the lab. AUD_MAIN's starts of its CPU 2 tasks go through OlyTaSt to OlyTaStCpu
// 0x5002d325 (cpu_conn kind 9, docs/om1-cores-spec.md); the stand-in answers that call, from AUD_MAIN's task and for
// the two ids AUD_MAIN starts there (their id words MODEL_INFO.audio.cpu2: AUD_WAKEUP 0x2017, AUD_LEVEL_MONITOR
// 0x200e), with E_OK, as the remote act_tsk's result (I), and for AUD_WAKEUP posts what that task posts when it ends
// (0x50a62d5a: the sound IC's power-on list 0x50a62e27, then 0x50035afd(0, 0x60a83d95, 0)): the call of 0x50a62d75
// (set_flg 0xf9) on ring [0][2] with bank-0's bit, as S-CPU2 posts CPU 2's reply. CPU 0 then takes IRQ 324 natively
// and the drain sets flag 0xf9, which AUD_MAIN waits for. The power-on list does not run (its codec writes are CPU
// 2's). Any other OlyTaStCpu call runs natively; a second start of the same id is an error.
//
// H-AUDTIME (time_steps below): while the port plays, the lab's one-jump time moves go from clock event to clock event
// and deliver IRQ 43 at each slot's end. The debug API's advance and run-to-frame ring the VSC's doorbell directly
// (src/debug/debugger.mjs) and are not stepped: one of them past several slot ends while the port plays underruns it.
// run_to_frame's boundary is computed from the published VSC window (frame_start + length x line_ns), a second copy of
// src/dev/vsc.mjs nextBoundary's arithmetic; a channel that becomes runnable only at the native command's chanSync takes
// the one-jump path.
//
// The sink: after each step and idle slice the session hands the port's played slots (src/dev/audio.mjs take()) to its
// audio output as events of source 'native', consecutive slots merged into one event (at most AUDIO_MAX_S each), at the
// lab time each slot started playing; with no audio output (a host that plays no sound) they are counted and dropped.
import { MODEL_INFO, refuseUnmapped } from '../fw/model.mjs';
import { FirmwareError, runtime, where } from './hle.mjs';
import * as K from './kernel.mjs';
import { pack } from '../util/bytes.mjs';
import { show } from '../util/show.mjs';
import { hexDigits as fx } from '../util/hex.mjs';
import { AUDIO_MAX_S } from './audio.mjs';
import { CodecLink } from './wm8946.mjs';
import { bootFacts } from './menu.mjs';

export class AudioHwError extends FirmwareError {}

export const NATIVE_SOURCE = 'native';
const CPU2 = 2, TIME_STEPS_MAX = 100000;
const h8 = (v) => '0x' + fx(v >>> 0, 8);

export class AudioHw {
  // session: the PlaySession, whose machine has the audio option on
  constructor(session) {
    this.s = session; this.lab = session.lab;
    this.f = MODEL_INFO.audio;
    this.port = this.lab.sim.m.devices.audio;
    if (!this.f || !this.port) throw new AudioHwError('--audio on: the model has no audio facts (src/fw/models.mjs audio) or the machine no audio port');
    this.main_tid = null;
    this.cpu2 = new Map();         // CPU 2 id -> {name, lab_ns, reply}
    this.events = 0; this.frames = 0; this.unplayed = 0;   // the sink's: events emitted, frames, frames with no output
    this.blocks = 0;
    this.steps = 0;                // H-AUDTIME: the time jumps taken event by event
    this.log = [];
  }
  id(word) { const b = this.lab.sim.read(word, 2); return b[0] | b[1] << 8; }
  // AUD_EXEC, AUD_MAIN's queue (S-MODACK leaves it to AUD_MAIN, src/lab/camapp.mjs)
  exec_queue() { return this.id(this.f.exec_queue); }
  // H-AUDSTART, with S-AUDCPU2 installed first
  bring_up() {
    const lab = this.lab, f = this.f;
    for (const a of [f.main, f.task_start_cpu, f.reply]) refuseUnmapped(a, 'H-AUDSTART');
    const tasks = new Map([...lab.nk.tasks()].map(([t, [e]]) => [t, e]));
    const main = this.id(f.main_id);
    if (tasks.get(main) !== f.main || lab.nk.state(main) !== 0x10) throw new AudioHwError(`H-AUDSTART: AUD_MAIN's static task ${main} (the id word ${h8(f.main_id)}): entry ${h8(tasks.get(main) ?? 0)}, state 0x${lab.nk.state(main).toString(16)}: not ${h8(f.main)}, dormant`);
    this.main_tid = main;
    this.starts = f.starts.map((w) => { const t = this.id(w); if (!tasks.has(t)) throw new AudioHwError(`H-AUDSTART: no static task ${t} (the id word ${h8(w)})`); return [t, tasks.get(t)]; });
    this.cpu2_ids = new Map(f.cpu2.map(([w, name]) => [this.id(w), name]));
    for (const id of this.cpu2_ids.keys()) if ((id >> 12) !== CPU2) throw new AudioHwError(`S-AUDCPU2: the id 0x${id.toString(16)} is not a CPU 2 task`);
    // the stage AUD_MAIN waits for (0x50024de8(stage) at 0x50a62a48: 2 ms sleeps until the stage's bit is set)
    const word = bootFacts().stage, b = lab.sim.read(word, 1)[0], bit = 1 << (f.stage - 1);
    if (b & bit) throw new AudioHwError(`H-AUDSTART: the stage word ${h8(word)} has stage ${f.stage}'s bit before AUD_MAIN's start`);
    lab.sim.write(word, Uint8Array.of(b | bit));
    this.codec = new CodecLink(lab);                // S-WM8946
    this.codec.bring_up();
    lab.hook(f.task_start_cpu, (h, r) => this._start_cpu(h, r), 'S-AUDCPU2');
    this.time_steps();
    lab.lt.allow.add(f.main);
    for (const [, e] of this.starts) lab.lt.allow.add(e);
    const [rc] = lab.nk.svc('act_tsk', { d0: main });
    if (rc !== K.E_OK) throw new AudioHwError(`H-AUDSTART: act_tsk(${main}) = ${rc}`);
    this.s.settle('H-AUDSTART');
    const waiting = [main, this.starts[0][0]].filter((t) => (lab.nk.state(t) & 0xF) !== 4);
    const missing = [...this.cpu2_ids.keys()].filter((id) => !this.cpu2.has(id));
    if (waiting.length || missing.length) {
      throw new AudioHwError(`H-AUDSTART: after AUD_MAIN's start: tasks ${show(waiting)} not waiting, CPU 2 starts ${show(missing.map((x) => '0x' + x.toString(16)))} not made; tasks ${show(lab.task_states())}`);
    }
    this.log.push(['H-AUDSTART', `AUD_MAIN ${main} and the tasks it starts (${this.starts.map(([t]) => t).join(', ')}) wait; port ${show(this.port.status())}`]);
  }
  // H-AUDTIME: the lab's stand-ins that move lab time in one jump while a task holds the CPU (the vsync wait's
  // run_to_frame and the sleeps' advance, src/lab/display.mjs) go from clock event to clock event while the port plays,
  // and after each run the kernel's deliveries, IRQ 43 among them (its handler the firmware attached, run as the
  // kernel's lab-delivered sources run, in interrupt context): its re-arm then keeps pace, where one jump past several
  // slot ends left the port to underrun (X: the vsync wait's 16.7 ms jumps, two slot ends with no interrupt between)
  time_steps() {
    const lab = this.lab, port = this.port, irq = lab.sim.m.devices.audio.cfg.irq;
    lab.kernel.add_source(irq, () => port.pending());
    const step = (target) => {
      for (let n = 0; lab.lab_time() < target; n++) {
        if (n > TIME_STEPS_MAX) throw new AudioHwError(`H-AUDTIME: more than ${TIME_STEPS_MAX} clock events before ${target} ns`);
        lab.run_to_event(target);
        if (port.pending()) lab.kernel.deliver();
      }
    };
    const advance = lab.advance.bind(lab), runToFrame = lab.run_to_frame.bind(lab);
    lab.advance = (ns, cause) => {
      if (!port.playing) return advance(ns, cause);
      step(lab.lab_time() + ns);
      lab.time_log.push([cause, lab.vsc.time()]);
      lab.kernel.deliver();
      this.steps += 1;
    };
    lab.run_to_frame = (c, cause) => {
      const ch = lab.vsc.channel(c);
      if (!port.playing || !ch.running || !ch.line_ns) return runToFrame(c, cause);
      step(ch.frame_start + ch.length * ch.line_ns);
      lab.vsync_frames.set(c, (lab.vsync_frames.get(c) ?? 0) + 1);
      lab.time_log.push([cause, lab.vsc.time()]);
      this.steps += 1;
    };
  }
  // S-AUDCPU2: OlyTaStCpu(d0 = the id)
  _start_cpu(h, r) {
    const lab = this.lab, id = r.d0 & 0xFFFF, name = this.cpu2_ids.get(id);
    if (name === undefined) return lab.passthrough(r);
    const cur = lab.lt.current();
    if (cur !== lab.nk.tcb(this.main_tid)) throw new AudioHwError(`S-AUDCPU2: the start of 0x${id.toString(16)} (${name}) from ${where(r.mdr)} outside AUD_MAIN's task`);
    if (this.cpu2.has(id)) throw new AudioHwError(`S-AUDCPU2: a second start of 0x${id.toString(16)} (${name})`);
    const rec = { name, lab_ns: lab.lab_time(), reply: null };
    if (id === this.id(this.f.cpu2[0][0])) rec.reply = this._post_reply();
    this.cpu2.set(id, rec);
    this.log.push(['S-AUDCPU2', `${name} 0x${id.toString(16)} started on CPU 2${rec.reply ? `; its reply ${rec.reply.func} on ring ${rec.reply.ring} [${rec.reply.index}]` : ''}`]);
    h.finish(r, { d0: K.E_OK });
  }
  // AUD_WAKEUP's 0x50035afd(0, reply, 0): the call on ring [0][2] and bank 0's bit (as PlayLab._s_cpu2's reply)
  _post_reply() {
    const lab = this.lab, intc = lab.nk.intc, func = runtime(this.f.reply);
    const [wp0, rp0, ring0, bit0] = lab.ipi_desc(0, CPU2);
    const w0 = lab.sim.read(wp0, 1)[0], r0 = lab.sim.read(rp0, 1)[0];
    if ((w0 + 1) % 32 === r0) throw new AudioHwError('S-AUDCPU2: ring [0][2] is full (0x50035afd would log 0x43006002 and return -1)');
    lab.sim.write(ring0 + 8 * w0, pack('<II', func, 0));
    lab.sim.write(wp0, new Uint8Array([(w0 + 1) % 32]));
    intc.ipi_request(0, bit0);
    return { func: h8(func), ring: h8(ring0), index: w0, bit: bit0 };
  }
  // the port's played slots to the session's audio output
  drain() {
    const blocks = this.port.take();
    if (!blocks.length) return 0;
    this.blocks += blocks.length;
    const out = this.s.audio;
    let run = null;
    const flush = () => {
      if (run === null) return;
      const samples = new Int16Array(run.frames * run.channels);
      let at = 0;
      for (const b of run.parts) { samples.set(new Int16Array(b.buffer, b.byteOffset, b.length >> 1), at); at += b.length >> 1; }
      this.frames += run.frames;
      if (out) { out.emit({ t_lab_ns: run.t_ns, rate: run.rate, channels: run.channels, samples, source: NATIVE_SOURCE }); this.events += 1; } else this.unplayed += run.frames;
      run = null;
    };
    for (const b of blocks) {
      const frames = b.bytes.length / (2 * b.channels);
      const end = run && run.t_ns + Math.round(run.frames * 1e9 / run.rate);
      if (run && (b.t_ns !== end || b.rate !== run.rate || b.channels !== run.channels || run.frames + frames > run.rate * AUDIO_MAX_S)) flush();
      if (run === null) run = { t_ns: b.t_ns, rate: b.rate, channels: b.channels, frames: 0, parts: [] };
      run.parts.push(b.bytes); run.frames += frames;
    }
    flush();
    return blocks.length;
  }
  take_log() { return this.log.splice(0); }
  status() {
    return { main_tid: this.main_tid, codec: this.codec?.status() ?? null, cpu2: Object.fromEntries([...this.cpu2].map(([id, r]) => ['0x' + id.toString(16), r.name])), port: this.port.status(),
      sink: { blocks: this.blocks, events: this.events, frames: this.frames, unplayed: this.unplayed }, time_steps: this.steps };
  }
}
