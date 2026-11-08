// CPU 3's MDET_DL, the subject network's control code, run natively on the lab CPU with S-DML for the engine
// (docs/om1-subject-spec.md 5.3 to 5.5, step C's parts; src/fw/models.mjs mdet has the firmware's side with its
// evidence, src/dev/dml.mjs the engine's model).
//
// On the camera, TAKE (CPU 0) starts subject detection with mdet_dl_start(kind), changes the kind with
// mdet_dl_change_mode and take_mov offers each live-view YC frame with mdet_dl_offer_yc_data; each call posts a
// request to CPU 3 (sys_callrequest, ring [3][0]), whose MDET_DL_REQ task takes it: START and CHANGE_MODE wake
// MDET_DL_LDL to load the kind's learning data, OFFER_YC_DATA builds the DML's register images, starts the engine,
// waits for its IRQ 285 (dml_start_callback sets the flag the wait is on), reads the engine's records back, filters and
// stabilises them into up to 8 subjects and hands those to LAF. The lab has one CPU (ARCHITECTURE.md C02); here that
// code runs on it, natively, at the seams below.
//
//   S-TAKEMDET  TAKE's and take_mov's requests, which do not run in the lab (TAKE_MOV is dormant): while the camera's
//               subject-detection setting names a kind (1..5) and S-SCENE's live view shows the live scene (subject.mjs
//               live(), the conditions S-SUBJECT had), mdet_dl_start(kind) once, mdet_dl_change_mode(kind) at a change
//               of kind, and one mdet_dl_offer_yc_data per 1/15 s of lab time (S-SCENE's frame step) with the record
//               {frame number, buffer id, 640, 480, still (movie flag 0), no digital zoom (100 %), DISP_FRAME's aspect
//               code}, its other fields 0; at OFF, mdet_dl_end. Each runs natively on the lab task. LAF derives the
//               frame getter's aspect pair from the offer's aspect code (src/fw/models.mjs mdet), so the frames
//               DISP_FRAME draws follow the aspect TAKE offers (X). With MDET started and the live scene shown,
//               S-TAKEFRAME's frame mode has the subject bit (camapp.mjs take_subject_frames). The buffer id names a
//               640 x 480 YC buffer (Y plane, then C plane: 614,400 bytes) the stand-in takes from S-HEAP once; the YC
//               buffer manager's calls for that id (lock, address, release) are answered for it (the id's bank is one
//               the manager refuses natively, so it names no buffer of the firmware's), others run natively. The buffer
//               is not written: nothing reads its pixels (S-DML does not run the network). That TAKE offers every frame
//               step and the frame's size are I (take_mov's YC frame is not read, spec 4.2)
//   S-MDETDL    CPU 3's MDET_DL tasks on the lab CPU. The poster's return path (its interrupt mask restored) serves
//               ring [3][0] at once, through S-CPU3 (camapp.mjs drain_cpu3), as CPU 3's IRQ 324 would take the post:
//               MDET's function runs natively in interrupt context with the request slot, then each MDET_DL task whose
//               flag it set runs a turn: its body, natively, from its entry on a harness stack of its own, until it
//               waits for its flag with the flag clear, where the turn ends (as the task would block there). CPU 3's
//               event flags MDET_DL uses (the four flag words of mdet.flags, 0x3003..0x3006) are kept by the lab: the
//               kernel's object calls (OlyEvSt, iOlyEvSt, OlyEvWt, OlyEvCl) on their ids set, wait for and clear them
//               (uITRON's semantics: OR in, wait OR / AND, clear ANDs); CPU 3's kernel does not run, and natively each
//               would be a cross-core call (the ids' core bits differ from the lab task's; mdet's comment). A wait that
//               the flag does not satisfy is an error unless it ends a turn or is the offer's wait for the engine
//               (dml_done): there the deferred call dml_start posted (mdet.deferred, IRQ 53) is taken first, which
//               starts the engine through the driver, then the lab clock runs to S-DML's completion and its IRQ 285 is
//               delivered (a lab-delivered source, as the VSC's: the handler the firmware attached runs in interrupt
//               context), whose callback sets the flag. Requests then complete before the CPU 0 call returns: CPU 3
//               works in zero lab time apart from the engine's run (I). DISP_FRAME's posts made meanwhile (UP_FACE from
//               MDET's own code, after it writes the frame table) wait for S-CPU3's next drain outside the call: a
//               DISP_FRAME turn is a harness call of its own, which inside the poster's return path would reuse that
//               call's stack (camapp.mjs drain_cpu3, nested). S-TAKEMDET drains them as each call returns, so an offer
//               makes one DISP_FRAME turn at once (as CPU 3's DISP_FRAME task would take its flag, I); left to the next
//               tick's drain, the frame drawn lagged the table by an offer (X)
//   S-DML       (src/dev/dml.mjs; here its output) the records each run of the engine writes: S-SCENE's subjects of the
//               offer's kind at the offer's scene time, in MDET's 640 x 480 frame (subject.mjs frames(), S-SUBJECT's
//               placement: S-SCENE's box on the panel taken back through DISP_FRAME's transform), each a body record of
//               class 0 (group g = 0 of classes 3g, 3g + 1, 3g + 2: the scene's subjects carry no sub-kind, and no
//               string names the groups, I) with the score 0x0e00 (223 after MDET's scaling, above the stabilisation's
//               thresholds), its centre and its size made even (spec 5.2.1). MDET's own stabilisation then reports a
//               box from its seventh run on (6 hits to register; X, spec 5.4) and for up to 8 runs after it goes while
//               the kind stays (D, spec 5.2)
//   S-LEARNDATA the learning data's copy: learning_data_load's read of the kind's item of group 0x800f to its
//               destination (mdet.learning: 9,383,936 bytes) is answered with the record {address, size} the reader
//               returns, and nothing is copied: the large-data block is not in the lab, the destination's 0x9xxxxxxx
//               window is not mapped (spec 5 U6), and S-DML does not read the weights. Other groups' reads run
//               natively
// What follows the engine's records runs natively: get_dml_result, judge_dml_result, the stabilisation, the
// combination, set_subject_detect_result (mdet.result) and LAF, which fills the frame table's inputs with MDET's
// subject (X, spec 5.4), writes the getter's aspect pair, writes the frame table (mdet.table_writer) and posts UP_FACE
// after each offer; DISP_FRAME draws that table (X, spec 5.5). S-SUBJECT does not run on such a body: its writes are
// for one where MDET_DL does not run natively (subject.mjs).
import { FirmwareError, disasm, where, ISR_SP, ISR_CALLER, HEAP_END } from './hle.mjs';
import * as K from './kernel.mjs';
import { RTOS } from './rtos.mjs';
import { HANDLER_TABLE } from './irq.mjs';
import { TASK_STACKS, TASK_CALLERS, EXPECTED_ERRLOG } from './display.mjs';
import { packRegs } from './sim.mjs';
import { pack } from '../util/bytes.mjs';
import { KINDS } from './subject.mjs';

export class MdetError extends FirmwareError {}
class TurnDone extends Error {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const rtosAt = (name) => [...RTOS].find(([, n]) => n === name)[0];
const OLY = { set: rtosAt('OlyEvSt'), iset: rtosAt('iOlyEvSt'), wait: rtosAt('OlyEvWt'), clear: rtosAt('OlyEvCl') };
// uITRON's wait modes (OlyEvWt's a1): TWF_ANDW, TWF_ORW
const TWF_ANDW = 0, TWF_ORW = 1;
// S-MDETDL's task stack and trampoline: the lab's scratch below the display runs' third stack (each 0x30000 bytes), and
// the slot after their trampolines (display.mjs TASK_STACKS, TASK_CALLERS)
const STACK_SIZE = 0x30000, CPU3_STACK = TASK_STACKS[2] - STACK_SIZE, CPU3_CALLER = TASK_CALLERS[2] + 0x40;
// the stub calls a request, a turn or a serve may take
const LIMIT = 2000000;
// S-TAKEMDET's YC frame: 640 x 480, a Y plane then a C plane (dml_set_control_reg's +307200, spec 5.2), 128-byte
// aligned (the engine's input address registers hold (address >> 7) << 3); its buffer id: bank 0x77, element 1 (the
// manager refuses banks of 119 and up)
const YC_W = 640, YC_H = 480, YC_BYTES = 2 * YC_W * YC_H, YC_ALIGN = 128, YC_ID = 0x7701;
const STILL = 0, NO_ZOOM = 100;
// S-TAKEMDET's pace: an offer per 1/15 s of lab time, S-SCENE's frame step (play.mjs SCENE_STEP_NS), still scene or
// moving (I: take_mov offers each live-view frame; the lab's live view moves at that step)
const OFFER_NS = 1e9 / 15;
// S-DML's records: the body class of group 0 and the score (Q12; spec 5.2.1 asks 0x0d00..0x1000); the 10-bit centre's
// bounds (the clamp at 639 / 479, spec 5.2)
const BODY_CLASS = 0, SCORE = 0x0E00, MAX_X = 639, MAX_Y = 479;

export class MdetDl {
  // session: the PlaySession; camapp: its CamApp (S-CPU3's drain, S-SUBJECT's setting and conditions); f: the model's
  // mdet facts (src/fw/models.mjs)
  constructor(session, camapp, f) {
    this.s = session; this.camapp = camapp; this.f = f;
    this.installed = false;
    this.kind = null;          // S-TAKEMDET: the kind MDET was started with or changed to, null before a start / after END
    this.step = null;          // the offer step (OFFER_NS) last offered
    this.requests = [];        // [api name, kind or frame] of every request made
    this.offers = 0;
    this.flags = new Map();    // S-MDETDL: CPU 3's flags by id -> pattern
    this.tasks = [];           // [{name, entry, id, bit}]
    this.turns = new Map();    // task name -> turns run
    this.turn = null;          // the task whose turn runs
    this.serves = 0;           // ring [3][0] posts served
    this.irqs = 0;             // IRQ 285 deliveries (the handler's entries)
    this.callbacks = 0;        // dml_start_callback's entries
    this.deferred = 0;         // the deferred call's IRQ taken in the engine waits
    this.loads = [];           // S-LEARNDATA: the items answered
    this.yc = null;            // S-TAKEMDET's YC buffer address
    this.boxes = [];           // S-DML: the boxes of the last offer's records (MDET's frame)
    this.offer_t = null;       // the scene time (s) of the last offer's records
    this.table_writes = 0;     // runs of MDET's frame table writer (mdet.table_writer), observed
  }
  get used() { return this.requests.length > 0; }
  lab() { return this.s.lab; }
  u16(a) { const b = this.lab().sim.read(a, 2); return b[0] | b[1] << 8; }
  log(kind, what) { this.camapp.log.push([kind, what]); }
  // The hooks, at MDET's first request (a session that never turns subject detection on runs as before)
  install() {
    const lab = this.lab(), f = this.f;
    this.ids = new Set(f.flags.map((w) => this.u16(w)));
    for (const id of this.ids) if ((id & 0x3000) !== 0x3000) throw new MdetError(`S-MDETDL: flag id ${h8(id)} is not a CPU 3 object`);
    for (const id of this.ids) this.flags.set(id, 0);
    this.tasks = f.tasks.map((t) => ({ name: t.name, entry: t.entry, id: this.u16(t.flag), bit: t.bit }));
    this.dml_done = [this.u16(f.dml_done[0]), f.dml_done[1]];
    this.dml = lab.sim.m.devices.dml;
    if (!this.dml) throw new MdetError('S-MDETDL: the machine has no DML engine (src/fw/board.mjs dml)');
    // S-MDETDL: the kernel's flag calls on CPU 3's flags
    const mine = (r) => this.ids.has(r.d0 & 0xFFFF);
    lab.wrap(OLY.set, (prev) => (h, r) => (mine(r) ? this.set_flag(h, r) : prev(h, r)));
    lab.wrap(OLY.iset, (prev) => (h, r) => (mine(r) ? this.set_flag(h, r) : prev(h, r)));
    lab.wrap(OLY.clear, (prev) => (h, r) => (mine(r) ? this.clear_flag(h, r) : prev(h, r)));
    lab.wrap(OLY.wait, (prev) => (h, r) => (mine(r) ? this.wait_flag(h, r) : prev(h, r)));
    // S-MDETDL: the poster's return path serves the ring (S-CPU3)
    lab.hook(f.post.done, (h, r) => {
      const saved = { ...r };
      this.camapp.drain_cpu3(true);
      if (lab.sim.packet('G' + packRegs(saved)) !== 'OK') throw new MdetError('S-MDETDL: registers not restored after the post');
      lab.passthrough(saved);
    }, 'S-MDETDL post');
    lab.hook(f.post.busy, (h, r) => { throw new MdetError(`S-MDETDL: MDET's request slot is busy at a post from ${where(r.mdr)}: its retry timer is not modelled`); }, 'S-MDETDL busy');
    // S-DML: IRQ 285 as a lab-delivered source; the handler and the callback observed (counts)
    lab.kernel.add_source(this.dml.cfg.irq, () => this.dml.pending());
    lab.observe(f.dml.irq_handler, () => { this.irqs += 1; }, 'obs-dml-irq');
    lab.observe(f.dml.callback, () => { this.callbacks += 1; }, 'obs-dml-callback');
    lab.observe(f.table_writer, () => { this.table_writes += 1; }, 'obs-mdet-table');
    // S-LEARNDATA
    lab.hook(f.learning.read, (h, r) => this.learning_read(h, r), 'S-LEARNDATA');
    // S-TAKEMDET: the YC buffer
    this.yc = this.heap_block(YC_BYTES, YC_ALIGN);
    const yc = (answer) => (h, r) => ((r.d0 & 0xFFFF) === YC_ID ? h.finish(r, { d0: answer() }) : lab.passthrough(r));
    lab.hook(f.yc.lock, yc(() => 0), 'S-TAKEMDET lock');
    lab.hook(f.yc.address, yc(() => this.yc), 'S-TAKEMDET address');
    lab.hook(f.yc.release, yc(() => 0), 'S-TAKEMDET release');
    this.installed = true;
    this.log('mdet', `installed: CPU 3 flags ${[...this.ids].map(h8).join(', ')}, the YC buffer ${h8(this.yc)}`);
  }
  // A block from S-HEAP's memory, kept for the session (aligned up; S-HEAP's bump, as its malloc takes new blocks)
  heap_block(size, align) {
    const lab = this.lab(), a = Math.ceil(lab.heap / align) * align;
    if (a + size > HEAP_END) throw new MdetError(`S-TAKEMDET: S-HEAP has no ${size} bytes left for the YC buffer (at ${h8(lab.heap)})`);
    lab.heap = a + size;
    lab.heap_sizes.set(a, size);
    return a;
  }
  // ---- S-MDETDL: CPU 3's flags
  set_flag(h, r) {
    const id = r.d0 & 0xFFFF;
    this.flags.set(id, (this.flags.get(id) | r.d1) >>> 0);
    h.finish(r, { d0: 0 });
  }
  clear_flag(h, r) {
    const id = r.d0 & 0xFFFF;
    this.flags.set(id, (this.flags.get(id) & r.d1) >>> 0);
    h.finish(r, { d0: 0 });
  }
  satisfied(id, want, mode) {
    const p = this.flags.get(id);
    if (mode === TWF_ORW) return (p & want) !== 0;
    if (mode === TWF_ANDW) return (p & want) === want;
    throw new MdetError(`S-MDETDL: wait mode ${mode} on flag ${h8(id)}`);
  }
  wait_flag(h, r) {
    const lab = this.lab(), id = r.d0 & 0xFFFF, want = r.d1 >>> 0, mode = r.a1 & 0xFF, saved = { ...r };
    if (!this.satisfied(id, want, mode)) {
      if (this.turn && id === this.turn.id) throw new TurnDone();
      if (id === this.dml_done[0] && (want & this.dml_done[1])) this.engine_wait(saved);
      if (lab.sim.packet('G' + packRegs(saved)) !== 'OK') throw new MdetError('S-MDETDL: registers not restored after the engine wait');
      if (!this.satisfied(id, want, mode)) {
        throw new MdetError(`S-MDETDL: wait for CPU 3 flag ${h8(id)} pattern ${h8(want)} (mode ${mode}) from ${where(saved.mdr)} would block: the flag is ${h8(this.flags.get(id))}${this.turn ? ` in ${this.turn.name}'s turn` : ''}`);
      }
    }
    if (saved.a0) lab.sim.write(saved.a0, pack('<I', this.flags.get(id)));
    h.finish(saved, { d0: 0 });
  }
  // The offer's wait for the engine: the driver's deferred start taken, then the lab clock to the run's completion,
  // whose IRQ the lab delivers
  engine_wait(saved) {
    const lab = this.lab(), irq = this.f.deferred, intc = lab.nk.intc;
    if ([...intc.present_now().values()].includes(irq)) {
      const handler = lab.sim.u32(HANDLER_TABLE + 4 * irq);
      if (!handler) throw new MdetError(`S-MDETDL: IRQ ${irq} presented with no handler attached`);
      K.in_interrupt(lab.lt, () => lab.calls(disasm(handler), null, ISR_SP, ISR_CALLER, LIMIT));
      this.deferred += 1;
    }
    if (!this.dml.busy() && !this.dml.pending()) {
      throw new MdetError(`S-MDETDL: the wait for the engine from ${where(saved.mdr)}: no run in progress (the driver's start did not come)`);
    }
    if (this.dml.busy()) lab.advance(this.dml.due - lab.lab_time(), `S-DML run ${this.dml.runs}`);
    if (this.dml.pending()) lab.kernel.deliver();
  }
  // ---- S-CPU3's MDET posts (camapp.mjs drain_cpu3): the function in interrupt context, then the tasks' turns
  serve(arg) {
    const lab = this.lab();
    this.serves += 1;
    K.in_interrupt(lab.lt, () => lab.calls(this.f.post.fn, { a0: arg }, ISR_SP, ISR_CALLER, LIMIT));
    for (let n = 0; ; n++) {
      const t = this.tasks.find((x) => this.flags.get(x.id) & x.bit);
      if (!t) break;
      if (n >= 64) throw new MdetError(`S-MDETDL: ${n} turns after one post and ${t.name}'s flag still set`);
      this.run_turn(t);
    }
  }
  run_turn(t) {
    const lab = this.lab();
    this.turn = t;
    this.turns.set(t.name, (this.turns.get(t.name) ?? 0) + 1);
    try {
      lab.calls(t.entry, null, CPU3_STACK, CPU3_CALLER, LIMIT);
      throw new MdetError(`S-MDETDL: ${t.name}'s body returned`);
    } catch (e) {
      if (!(e instanceof TurnDone)) throw e;
    } finally { this.turn = null; }
  }
  // ---- S-LEARNDATA
  learning_read(h, r) {
    const lab = this.lab(), L = this.f.learning;
    if ((r.d0 & 0xFFFF) !== L.group) { lab.passthrough(r); return; }
    const item = r.d1 & 0xFFFF;
    if ((r.a0 >>> 0) !== L.dest || item >= Object.keys(KINDS).length) {
      throw new MdetError(`S-LEARNDATA: read of group ${h8(L.group)} item ${item} to ${h8(r.a0)} from ${where(r.mdr)}: not learning_data_load's`);
    }
    const rec = lab.alloc(pack('<II', L.dest, L.size), 4);
    this.loads.push(item);
    this.log('learndata', `item ${item} (${KINDS[item + 1]}): ${L.size} bytes to ${h8(L.dest)} answered, not copied`);
    h.finish(r, { a0: rec });
  }
  // ---- S-TAKEMDET
  // After lab time passed (camapp.mjs tick): the requests, then S-TAKEFRAME's subject bit (on while MDET runs and the
  // live scene is shown), then the offer, so that the offer's UP_FACE finds the bit
  tick() {
    const s = this.s, sub = this.camapp.subject;
    if (!this.camapp.started || !sub) return;
    const live = sub.live(), kind = live ? sub.kind() : null, run = kind !== null && Object.hasOwn(KINDS, kind);
    if (run) {
      if (this.kind === null) this.request('start', kind);
      else if (kind !== this.kind) this.request('change_mode', kind);
      this.kind = kind;
    } else if (kind === 0 && this.kind !== null) {
      this.request('end', 0);
      this.kind = null; this.step = null;
    }
    this.camapp.take_subject_frames(live && this.kind !== null);                     // S-TAKEFRAME
    if (!run) return;
    const step = Math.floor(s.lab.lab_time() / OFFER_NS);
    if (step !== this.step) { this.step = step; this.offer(); }
  }
  request(name, kind) {
    if (!this.installed) this.install();
    const lab = this.lab();
    if (lab.sim.read(this.f.post.slot, 1)[0]) throw new MdetError(`S-TAKEMDET: MDET's request slot is busy before ${name}`);
    this.requests.push([name, kind]);
    const e0 = lab.kernel.errors.length;
    const rc = lab.call(this.f.api[name], { d0: kind }, null, null, LIMIT).d0 & 0xFFFF;
    this.errlog_check(e0, name);
    this.s.settle(`S-TAKEMDET ${name}`);
    if (rc !== 0) throw new MdetError(`S-TAKEMDET: mdet_dl_${name}(${kind}) returned ${rc}`);
    this.log('takemdet', `${name}(${kind}${kind ? `, ${KINDS[kind]}` : ''})`);
    this.camapp.drain_cpu3();                                                       // S-CPU3: DISP_FRAME's posts
  }
  offer() {
    const lab = this.lab(), R = this.f.record, sub = this.camapp.subject;
    const rec = new Uint8Array(R.size), dv = new DataView(rec.buffer);
    this.offers += 1;
    dv.setUint32(0, this.offers, true);
    dv.setUint16(R.buff_id, YC_ID, true);
    dv.setUint16(R.w, YC_W, true);
    dv.setUint16(R.h, YC_H, true);
    rec[R.movie] = STILL;
    dv.setUint16(R.zoom, NO_ZOOM, true);
    rec[R.aspect] = sub.call(sub.f.aspect_code).d0 & 0xFF;
    this.requests.push(['offer', this.offers]);
    const records = this.records(), e0 = lab.kernel.errors.length;
    this.dml.source = () => records;                                               // S-DML's output, this run
    let rc;
    try { rc = lab.call(this.f.api.offer, { a0: lab.alloc(rec, 4) }, null, null, LIMIT).d0 & 0xFFFF; } finally { this.dml.source = null; }
    this.errlog_check(e0, 'offer_yc_data');
    this.s.settle('S-TAKEMDET offer');
    if (rc !== 0) throw new MdetError(`S-TAKEMDET: mdet_dl_offer_yc_data(frame ${this.offers}) returned ${rc}`);
    this.camapp.drain_cpu3();                                                       // S-CPU3: MDET's UP_FACE, one turn
  }
  // S-DML's records for an offer: S-SCENE's subjects of the kind now, placed in MDET's frame (subject.mjs frames())
  records() {
    const sub = this.camapp.subject, { t } = this.s.scene_step(), even = (v) => v & ~1;
    this.boxes = sub.frames(this.kind, t).boxes;
    this.offer_t = t;
    return this.boxes.map(([x0, y0, x1, y1]) => ({ cls: BODY_CLASS, score: SCORE, h: even(y1 - y0), w: even(x1 - x0),
      cy: Math.min((y0 + y1) >> 1, MAX_Y), cx: Math.min((x0 + x1) >> 1, MAX_X) }));
  }
  // A request (its CPU 3 side included) that made the firmware log an error stops the session: MDET logs each refusal
  // it makes (a bad state, kind, record or read), and none is expected of the path the lab runs (X)
  errlog_check(e0, what) {
    const bad = this.lab().kernel.errors.slice(e0).filter(([code]) => !EXPECTED_ERRLOG.has(code));
    if (bad.length) throw new MdetError(`S-TAKEMDET: mdet_dl_${what}: the firmware logged ${bad.map(([c, , , w]) => `${h8(c)} from ${w}`).join('; ')}`);
  }
  // MDET's subject records (set_subject_detect_result's, mdet.result): [{sbj_kind, body: [cx, cy, w, h, rel, dtct]}]
  // of the slots whose kind is not 0
  subjects() {
    const lab = this.lab(), R = this.f.result, out = [];
    for (let i = 0; i < R.count; i++) {
      const b = lab.sim.read(R.records + R.size * i, R.size), dv = new DataView(b.buffer, b.byteOffset, b.length);
      const kind = dv.getUint16(0, true);
      if (kind) out.push({ sbj_kind: kind, body: [dv.getUint16(2, true), dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint16(8, true), b[10], b[11]] });
    }
    return out;
  }
  // The subject frames MDET's table holds as the getter would give them to DISP_FRAME (src/fw/models.mjs subject): the
  // kind, the device, the aspect code of the getter's pair, the scene time of the last offer, the list records as
  // [x0, y0, x1, y1] (the first and last corners), the main and part records' flags (0 in the lab's sessions, where the
  // list is all of it, X; the state that fills them is spec U9) and the runs of MDET's writer
  frames_status() {
    const lab = this.lab(), F = this.camapp.subject.f, tb = F.table, rd = (a) => lab.sim.read(a, 1)[0];
    const n = rd(F.active) === 1 ? rd(tb.count) : 0, boxes = [];
    for (let i = 0; i < n; i++) { const w = [...new Uint16Array(lab.sim.read(tb.list + 16 * i, 16).slice().buffer)]; boxes.push([w[0], w[1], w[6], w[7]]); }
    const pair = [rd(F.aspect[0]), rd(F.aspect[1])];
    const aspect = Number(Object.keys(F.aspect_pairs).find((k) => F.aspect_pairs[k][0] === pair[0] && F.aspect_pairs[k][1] === pair[1]) ?? 0);
    return { source: 'mdet', kind: this.kind, device: this.s.device, aspect, t: this.offer_t, frames: boxes.length, boxes, main: rd(tb.main[0]), part: rd(tb.part[0]), writes: this.table_writes };
  }
  status() {
    const d = this.dml;
    return { kind: this.kind, requests: this.requests.length, offers: this.offers, serves: this.serves, turns: Object.fromEntries(this.turns),
      deferred: this.deferred, dml_runs: d ? d.runs : 0, irqs: this.irqs, callbacks: this.callbacks, loads: this.loads.length,
      records: this.boxes.length, subjects: this.installed ? this.subjects().length : 0 };
  }
}
