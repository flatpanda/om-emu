// The TAKE probe (docs/hle-gaps.md 4.1.4; E143 only, `--take probe`, off by default): TAKE_FUNC (task 0x69) and
// TAKE_FUNC_CP (task 0x6a) run natively in place of S-MODACK's answers to TAKE_FUNC's queue, under either camapp
// mode, and every request they make of a module or driver the lab does not run goes to a recording stand-in, which
// records it and answers only where TAKE waits. Addresses are E143's (D unless tagged).
//
//   H-TAKEINIT  before the application starts: USTART2's stage word 0xa32d6d58 set to 1, as USTART2 sets it after its
//               stage 2_1 (0x5012abef from 0x501e8eac; TAKE_FUNC_CP's start polls it through 0x5012abe6 at
//               0x502cda22..0x502cda3f, and TAKE_FUNC's first message starts take_mov's state 0x506d9a35 on it); then
//               TAKE_FUNC's module init (0x502ccff8, USTART's call at 0x50024c2d: the context 0x62a3f140.. cleared and
//               its constants set) natively, and TAKE_FUNC and TAKE_FUNC_CP started with act_tsk as USTART starts them
//               right after it (0x50024c3b, 0x50024c54; the tids from the words 0x60042df8 / 0x60042dfa); both then
//               wait on their queues (0x5e, 0x5f). The application's requests to TAKE_FUNC (its queue 0x5e, the
//               synchronous ones included) leave S-MODACK and go to it
//   S-TAKEREQ   the recording stand-in for each queue TAKE_FUNC and TAKE_FUNC_CP post to (OlyQeWr from their tasks)
//               whose reader the lab does not run (TAKE_REQ_QUEUES): every request is recorded (queue, command,
//               parameter, token, synchronous or not, the sender's return address) and the message dropped; it is
//               answered only where TAKE waits, with what the waiting code reads:
//                 - a synchronous request (TAKE_FUNC's own 0x502ce86d, which posts with the reply queue
//                   TAKE_FUNC_IMDFUNC 0xa7 and returns the reply's u16 status, 0x502ce8ba; or the kernel's sends
//                   0x5002e39d / 0x5002e56e from TAKE_FUNC_CP) returns the status 0;
//                 - an asynchronous request whose word 0 names TAKE_FUNC_CP_POST (0x61), where TAKE_FUNC_CP's start
//                   sequence waits (0x502cdad2), is answered after the step with {u16 status 0, token = word 1, 0}
//                   to 0x61: the sequence clears the token from its pending bits (0x502cdad7..0x502cdae3) and keeps
//                   the first nonzero status as its result (0x502cdb7b..0x502cdb81);
//                 - BC_EXEC's request from that sequence (0x502cd9a8) carries TAKE's completion callback in its
//                   parameter (+4: 0x502cdc0b, which posts token 0x80 to 0x61, the second of the two bits the sequence
//                   sets for BC, 0x502cd9b3): the stand-in calls it natively after the reply (I: that BC calls it when
//                   its start is done; how BC calls it is not read);
//                 - a request with word 0 = 0 is not answered (nothing waits for it).
//               Posts to TAKE's own queues, to LENS_EXEC with the native lens and TAKE's replies to its requesters
//               (TAKE's reply function 0x502ce619) go natively and are recorded too. A queue the probe does not know,
//               and a reply queue it has no reading of, throw
//   S-TAKECAM   the camera driver's request switch (cam.c, 0x502a4a46) from TAKE's tasks: TAKE_FUNC_CP's start makes
//               requests 148 and 6 (0x502cd411 -> 0x502cd41f: the 192-byte request on its stack, +0 the id, +3 the
//               argument, +72 TAKE's completion 0x502cd4d0, then a wait on flag TAKE_CAM_EVENT bit 1 under semaphore
//               0x19). The driver's own init does not run in the lab (its request pool 0x6299726c is empty: request
//               148's handler 0x502a4b74 failed its allocation and logged 0x0a103000, X), so the stand-in records the
//               request, returns 0 (accepted) and after the step calls the request's completion natively with d0 0
//               and a0 the request, as the driver does (0x502a4b92..0x502a4b96, 0x502a4c31..0x502a4c3f)
//   S-TAKEUSF   the dust filter's gate-on API (0x50064a69, "USF GATE CONTROL") from TAKE's tasks: TAKE_FUNC_CP's start
//               asks it (0x502cdb34) with its record {callback 0x502cdc97, 0} and waits on flag TAKE_FUNC_CP bit 1,
//               which the callback's deferred count sets (0x502cdcae); the API drives the filter through the timer
//               block at 0x9b880000, which the lab does not model. The stand-in records the call and after the step
//               calls the record's callback natively with d0 0 and a0 the record, as the filter's completion does
//               (0x50064d40..0x50064d5b; 0xffff there is its error)
// The probe keeps H-LENSON (lens.mjs): the lens's bring-up comes before the application starts TAKE, whose start then
// sends LENS_EXEC its own camera-on, which LENS_MAIN takes natively.
//
// Round 2, the release route to TAKE_EXEC (docs/hle-gaps.md 4.1.7): TAKE_MAIN and TAKE_MAIN_CP run natively too, and
// under control camapp 3 (the components with their transactions native) the shooting sequence's own take requests
// reach TAKE_MAIN:
//   H-TAKEMAIN  after H-TAKEINIT: TAKE_MAIN's module init (0x50399619, the boot stage 0x501e8e84's call at 0x501e8f7b,
//               after USTART2's stage word at 0x501e8eac: TAKE_EXEC 0x5a and TAKE_POST 0x63 bound to its flag
//               (0x60042ffe) bits 2 and 4, its context 0x62a3f018.. set) natively, then TAKE_MAIN (task 107) and
//               TAKE_MAIN_CP (task 114) started with act_tsk as the boot stage 0x501e94a5 starts them (0x501e9bbf,
//               0x501e9bcd; the tids from the words 0x60042dfc / 0x60042e0a; TAKE_PROXY, which it starts next at
//               0x501e9bdb, stays dormant). TAKE_EXEC leaves S-MODACK, so the take requests go to TAKE_MAIN natively;
//               what TAKE_MAIN and TAKE_MAIN_CP take joins the record (TAKE_MAIN's mailbox, TAKE_EXEC and TAKE_POST),
//               their requests go through S-TAKEREQ as TAKE_FUNC's do (a reply on TAKE_POST only where TAKE_MAIN's
//               handler for its token was read, MAIN_REPLIES; any other throws), and TAKE's synchronous request
//               0x502ce86d from TAKE_MAIN to a queue whose task runs natively (TAKE_FUNC; TAKE_MAIN's helper
//               0x5039a01c, reply queue TAKE_IMDFUNC 0xa8) runs natively
//   S-THRTAKEOVER (control camapp 3) the through image capability's state word (0x60362b38, CapThr_ThroughImage's
//               "entryState": a byte scan finds only its getter 0x50bcccc9 and its setter 0x50bcecb8 naming it) set to
//               0x01010202 through that setter, as the boot take-over (API 70405, 0x50adffda) sets it together with
//               module 9's state 2 (0x50ae0044..0x50ae0055), the state S-TAKEOVER writes alone (the rest of that
//               path, 0x50ae005c..0x50ae007b, runs in neither; what it does is not read). The sequence parts
//               take a half press only while the state's top byte is 1 (the S1 guard 0x50c8d4a4 -> 0x50bcdef7); with
//               the word's static 0x02010202 (which the take-over's kind 0 writes, 0x50ae000f) every S1 was refused (X)
import { FirmwareError, where, disasm } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { OLYQEWR } from './display.mjs';
import { HotShoe } from './shoe.mjs';

export class TakeError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const TAKE_E143 = {
  init: 0x502CCFF8,
  ustart2: 0xA32D6D58,        // USTART2's stage word (0x5012abe6 reads it, 0x5012abef sets it, H-TAKEINIT)
  // the tasks' tid words, entries and the return of their receive (a2 the message)
  func: { tid: 0x60042DF8, entry: 0x502CD1CA, received: 0x502CD1EC },
  cp: { tid: 0x60042DFA, entry: 0x502CD604, received: 0x502CD626 },
  send: 0x502CE57B,           // TAKE's send helper: OlyQeWr(d0 queue, a0 message, d1 size, a1 timeout)
  send_return: 0x502CE58C,    // its OlyQeWr call's return
  imd: 0x502CE86D,            // TAKE_FUNC's synchronous request (d0 queue, d1 command, a0 parameter, a1 reply queue)
  request: 0x506D9854,        // the synchronous request API (d0 queue, d1 command, a0 parameter)
  request_imd: 0x506D9897,    // its call of imd's return
  xcpu_send: 0x5002E56E,      // the kernel's synchronous send to another core's queue (queue ids 0x1000..0x3fff)
  bc_callback: 0x502CDC0B,    // TAKE_FUNC_CP's BC completion callback (BC_EXEC's parameter +4)
  // the helpers whose call of send (by its return address) names the request's real sender one level up
  helpers: { 0x502CE5D8: 0x502CE5B7, 0x502CE612: 0x502CE5E6, 0x502CE63B: 0x502CE619, 0x506EA982: 0x506EA965 },
  names: 0x51A220B2,          // the object-name table, {char name[24], u16 id} by id from 1 (ids 1..218)
  queue_words: 0x600431C6,    // the static queue-id table, id n at +2(n - 1)
};
// TAKE's own queues and the reply queues it waits on (read natively)
const TAKE_QUEUES = { 0x5E: 'TAKE_FUNC', 0x5F: 'TAKE_FUNC_CP', 0x60: 'TAKE_FUNC_CP_APPEVENT', 0x61: 'TAKE_FUNC_CP_POST', 0x62: 'TAKE_FUNC_POST', 0xA7: 'TAKE_FUNC_IMDFUNC' };
const CP_POST = 0x61;
// send's return in TAKE's reply function 0x502ce619 ({u16 status, token, word 3} to the request's word 0)
const T_REPLY = 0x502CE63B;
// S-TAKEREQ's queues: id -> name (the object-name table's, CPU 2's from its own table, docs/hle-gaps.md 4.1.1)
export const TAKE_REQ_QUEUES = {
  0x09: 'BC_EXEC', 0x57: 'STB_EXTERNAL', 0x5B: 'TAKE_EXPOSE', 0x5D: 'TAKE_FOCUS', 0xD7: 'TAKE_POWER_MANAGER_EXEC',
  0x2001: 'MOV_COMMAND', 0x2005: 'SDET_EXEC', 0x2006: 'WB_MOV',
};
const BC_EXEC = 0x09;
// Round 2 (docs/hle-gaps.md 4.1.6; H-TAKENBINIT): TAKE_EXPOSE and TAKE_POWER_MANAGER natively behind the same probe.
// USTART2's stage 0x501e8e84 runs TAKE_EXPOSE's module init (0x50591220, its call at 0x501e90bd) and starts it with
// act_tsk (tid word 0x60042df4, 0x501e90cb..0x501e90d8); it starts TAKE_POWER_MANAGER the same way (0x60042e2c,
// 0x501e9364..0x501e936b), whose init (0x502ce4d4: the flag pattern 0x62a48760 = 3, its two queues bound to the flag
// 0x60043140's bits 1 and 2, its two 24-byte slots 0x62a48764) is TAKE_FUNC's init's second call (0x502ccffd), which
// H-TAKEINIT already runs. Their queues then go natively: TAKE_EXPOSE 0x5b (its loop 0x5059145d receives 16 bytes and
// replies {u16 status, token, parameter} to word 0 at 0x50591717), TAKE_POWER_MANAGER_EXEC 0xd7 and _POST 0xd8 (its
// loop 0x503a9241 replies through TAKE's reply function 0x502ce619). What the two tasks post or ask synchronously goes
// through the same hooks as TAKE_FUNC's (task() names them): recorded, and a queue the probe does not know throws
const NB = {
  tasks: {
    expose: { name: 'TAKE_EXPOSE', tid: 0x60042DF4, entry: 0x5059145D, init: 0x50591220, queues: [0x5B] },
    power: { name: 'TAKE_POWER_MANAGER', tid: 0x60042E2C, entry: 0x503A9241, init: null, queues: [0xD7, 0xD8] },
  },
  imd_send_return: 0x502CE8A8,   // imd's (0x502ce86d) call of TAKE's send helper: the post a native neighbour takes
  replies: new Set([0x5059171E]),   // TAKE_EXPOSE's reply OlyQeWr's return (0x50591717)
  // TAKE_EXPOSE's AE result writer (S-EXPOSE's objects 0xc12a / 0xc0ba / 0xc0ca and eight more through the property
  // setter 0x5004188b), called from five callbacks (0x5059757f, 0x5059781d, 0x5059790f, 0x5059794c, 0x505979a5)
  // that the AE launchers (0x505964e7, 0x505943cb, 0x5059699d) put into the requests they build for EXP's 0x505536be
  // (the first and the last hand theirs to it; docs/hle-gaps.md 4.1.6); not one of TAKE_EXPOSE's command cases.
  // Observed, so that a run that reaches it shows (none does: S-EXPOSE stands in for it)
  ae_writer: 0x50596187,
};
// S-TAKECAM: the camera driver's (cam.c) request switch and the request's completion callback (+72, called with d0
// the status and a0 the request, 0x502a4b92..0x502a4b96, 0x502a4c31..0x502a4c3f); the requests TAKE makes, by id
const CAM = { request: 0x502A4A46, callback: 72 };
// S-TAKEUSF: the dust filter's (USF, "USF GATE CONTROL") gate-on API 0x50064a69 (a0 TAKE's record {callback, 0}),
// whose completion calls the record's callback with d0 0 (0xffff on an error) and a0 the record
// (0x50064d40..0x50064d5b)
const USF = { gate_on: 0x50064A69 };
// (5: TAKE_FUNC_CP's command 25, 0x506d99db, when its command 0 set 0x62a3f39a, 0x502cdbd8; not reached in the lab)
const CAM_REQUESTS = { 148: 'TAKE_FUNC_CP command 0, 0x502cd948', 6: 'TAKE_FUNC_CP command 0, 0x502cda61', 5: 'TAKE_FUNC_CP command 25, 0x506d99db' };
const LIMIT = 2000000;
// Round 2 (H-TAKEMAIN, S-THRTAKEOVER; the header's round-2 paragraph). TAKE_MAIN's loop (0x503996c3) waits on its flag
// and takes, by the bits, its internal mailbox (bit 1, 0x502ce7c8), TAKE_EXEC (bit 2, 16 bytes) and TAKE_POST (bit 4,
// 12 bytes), each through its state's command table (0x605bfbc8, 20 bytes a state; its state the u16 0x62a3f018)
export const TAKE_MAIN_E143 = {
  init: 0x50399619,
  main: { tid: 0x60042DFC, entry: 0x503996C3 },
  cp: { tid: 0x60042E0A, entry: 0x5039A09E, received: 0x5039A0BC },   // TAKE_MAIN_CP's receive's return, a2 the message
  exec_received: 0x5039985F,  // TAKE_MAIN's TAKE_EXEC receive's return: (32,sp) points to the 16-byte message
  post_received: 0x50399997,  // its TAKE_POST receive's return: (28,sp) points to the 12-byte message
  mbx_received: 0x50399725,   // its mailbox receive's (0x502ce7c8) return: d0 0 for a message, (28,sp) as TAKE_POST's
  handler: 0x503998D0,        // its call of a TAKE_EXEC command's handler (a1) in its state's table
  state: 0x62A3F018,
  imd_send_return: 0x502CE8A8, // TAKE's synchronous request 0x502ce86d's call of TAKE's send helper 0x502ce57b
};
const TAKE_EXEC = 0x5A, TAKE_POST = 0x63;
const TAKE_MAIN_QUEUES = { 0x5A: 'TAKE_EXEC', 0x63: 'TAKE_POST', 0xA8: 'TAKE_IMDFUNC', 0xB8: 'TAKE_MAIN_CP' };
// S-THRTAKEOVER: CapThr's state word, its setter and the value the boot take-over's kinds 1 and 2 write
export const THR_TAKEOVER = { set: 0x50BCECB8, word: 0x60362B38, value: 0x01010202 };
// S-TAKEREQ's queues for TAKE_MAIN's requests: CPU 3's FACE_FD (queue 2 of CPU 3's run in the object-name table,
// pointer at 0x6034d0d4 + 0x20 * 5 + 4 * 3)
Object.assign(TAKE_REQ_QUEUES, { 0x3002: 'FACE_FD' });
// S-TAKEREQ's replies on TAKE_POST, only where TAKE_MAIN's handler for the token was read (queue, command, token):
// TAKE_FOCUS's 0x300 with token 1, whose handler in RdyFcsRdy1 (0x503c2e8d) clears pending bit 0x01, asks TAKE_FUNC
// 80 and returns the reply's status, reading nothing else of it. Another request with TAKE_POST as its reply queue
// throws: TAKE_EXPOSE's 0x400 with token 11 (sent by 0x503c2c3a), whose handler 0x503c2ce6 frees the reply's word 2,
// would not be answered right by {0, token, 0}
const MAIN_REPLIES = [{ queue: 0x5D, command: 0x300, token: 1 }];

export class TakeProbe {
  // session: the PlaySession; camapp: its CamApp (S-MODACK's queues, its pump)
  constructor(session, camapp) {
    this.s = session; this.camapp = camapp; this.lab = session.lab;
    // the record, in order: {dir 'in', task, command, reply, token, parameter} for each message TAKE takes and {dir
    // 'out', task, queue (null for a driver call), name, command, parameter, token, sync, from, via, answer} for each
    // request it makes
    this.requests = [];
    this.pending = [];         // the answers due after the step: {what, run}
    this.log = [];             // [kind, detail]
    this.tids = null;
    this.callers = new Map();  // helper entry -> its caller's return address (the last call)
    this.native = new Set(Object.keys(TAKE_QUEUES).map(Number));
  }
  queue_word(n) { const b = this.lab.sim.read(TAKE_E143.queue_words + 2 * (n - 1), 2); return b[0] | b[1] << 8; }
  name(q) {
    if (TAKE_REQ_QUEUES[q]) return TAKE_REQ_QUEUES[q];
    if (q >= 1 && q <= 218) {
      const b = this.lab.image.subarray(TAKE_E143.names + 26 * (q - 1) - 0x50000000, TAKE_E143.names + 26 * q - 0x50000000);
      return String.fromCharCode(...b.subarray(0, 24)).replace(/\0[\s\S]*$/, '');
    }
    return `queue 0x${q.toString(16)}`;
  }
  task() {
    const cur = this.lab.lt.current();
    if (cur === this.lab.nk.tcb(this.tids.func)) return 'TAKE_FUNC';
    if (cur === this.lab.nk.tcb(this.tids.cp)) return 'TAKE_FUNC_CP';
    return this.neighbour_task(cur) ?? this.main_task();               // round 2: the neighbours, TAKE_MAIN
  }
  // before the application starts (CamApp.install): TAKE_FUNC's queue leaves S-MODACK, the stand-ins' hooks
  install() {
    const lab = this.lab, T = TAKE_E143, ca = this.camapp;
    const lens = this.s.lens ? this.queue_word(0x2E) : null;   // LENS_EXEC: LENS_MAIN's with the native lens
    if (lens !== null) this.native.add(lens);
    ca.module_queues.delete(0x5E);
    const sync = lab._sync_send.bind(lab);
    lab._sync_send = (h, r) => {
      const q = r.d0 & 0xFFFF;
      if (q === 0x5E) return lab.passthrough(r);                       // the application's to TAKE_FUNC: natively
      if (this.tids && this.task()) return this.sync_request(h, r, 'kernel 0x5002e39d');
      return sync(h, r);
    };
    lab.hook(T.xcpu_send, (h, r) => {
      if (this.tids && this.task()) return this.sync_request(h, r, 'kernel 0x5002e56e');
      return lab.passthrough(r);                                        // (another task's: as without the probe)
    }, 'S-TAKEREQ (other core)');
    for (const fn of [T.request, ...new Set(Object.values(T.helpers))]) lab.observe(fn, (l, r) => this.callers.set(fn, disasm(r.mdr)), 'S-TAKEREQ (sender)');
    lab.hook(T.imd, (h, r) => this.sync_request(h, r, 'TAKE_FUNC_IMDFUNC'), 'S-TAKEREQ (TAKE_FUNC sync)');
    lab.observe(T.send, (l, r) => { this.send_via = disasm(r.mdr); }, 'S-TAKEREQ (send)');
    // each message TAKE_FUNC and TAKE_FUNC_CP take, after their receive (a2 the 16-byte message), into the record
    for (const [at, task] of [[T.func.received, 'TAKE_FUNC'], [T.cp.received, 'TAKE_FUNC_CP']]) lab.observe(at, (l, r) => {
      const m = r.a2 >>> 0, w = [0, 1, 2, 3].map((k) => l.sim.u32(m + 4 * k) >>> 0);
      this.requests.push({ dir: 'in', task, command: w[2], reply: w[0], token: w[1], parameter: w[3] });
      this.log.push(['command', `${task} takes command ${w[2]} (reply queue ${w[0]}, token ${h8(w[1])}, parameter ${h8(w[3])})`]);
    }, 'S-TAKEREQ (command)');
    lab.hook(CAM.request, (h, r) => this.cam_request(h, r), 'S-TAKECAM');
    lab.hook(USF.gate_on, (h, r) => this.usf_gate(h, r), 'S-TAKEUSF');
    lab.wrap(OLYQEWR, (prev) => (h, r) => (this.tids && this.task() ? this.send(h, r, prev) : prev(h, r)), null);
    this.neighbours_install();                                          // round 2 (below)
    this.install_main();
    this.stb_install();                                                 // the strobe (below)
  }
  // H-TAKEINIT
  bring_up() {
    const lab = this.lab, T = TAKE_E143, s = this.s;
    lab.sim.write(T.ustart2, pack('<I', 1));            // (USTART2's stage word, as its 0x5012abef sets it)
    lab.call(T.init, null, null, null, LIMIT);
    const tid = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    this.tids = { func: tid(T.func.tid), cp: tid(T.cp.tid) };
    for (const [k, t] of Object.entries(this.tids)) {
      const e = lab.nk.entry(t);
      if (e !== T[k].entry || lab.nk.state(t) !== 0x10) throw new TakeError(`H-TAKEINIT: task ${t} has entry ${h8(e)} state ${lab.nk.state(t)}, not a dormant ${h8(T[k].entry)}`);
      lab.lt.allow.add(e);
      const [rc] = lab.nk.svc('act_tsk', { d0: t });
      if (rc !== 0) throw new TakeError(`H-TAKEINIT: act_tsk(${t}) = ${rc}`);
    }
    s.settle('H-TAKEINIT');
    for (const t of Object.values(this.tids)) if ((lab.nk.state(t) & 0xF) !== 4) throw new TakeError(`H-TAKEINIT: task ${t} is not waiting after its start (state ${lab.nk.state(t)})`);
    this.log.push(['init', `TAKE_FUNC task ${this.tids.func}, TAKE_FUNC_CP task ${this.tids.cp} waiting`]);
    this.neighbours_bring_up();                                         // round 2 (below)
    this.bring_up_main();
    this.stb_bring_up();                                                // the strobe (below)
  }
  // the request's sender: the caller of the send helper it went through (TAKE's 0x502ce57b and its wrappers, the
  // focus path's 0x506ea965), else the OlyQeWr call's own return
  sender(ra) {
    const T = TAKE_E143;
    let at = disasm(ra);
    if (at === T.send_return) at = this.send_via;
    if (at === NB.imd_send_return) {
      if (this.main_task() && this.imd_from) return this.imd_from;      // round 2: TAKE_MAIN's imd (install_main)
      at = this.imd_caller;                                             // round 2: imd's own post to a native neighbour
    }
    if (at === T.request_imd) return this.callers.get(T.request);
    if (T.helpers[at]) return this.callers.get(T.helpers[at]);
    return at;
  }
  record(rq) {
    rq.dir = 'out';
    this.requests.push(rq);
    this.log.push(['request', `${rq.task}: ${rq.name}${rq.queue === null ? '' : ` (0x${rq.queue.toString(16)})`} ${rq.command !== null ? `command ${rq.command}` : rq.status != null ? `status ${rq.status}` : ''} parameter ${h8(rq.parameter)}${rq.sync ? ' sync' : ''} from ${h8(rq.from)}: ${rq.answer}`]);
  }
  // OlyQeWr from TAKE's tasks (d0 queue, a0 {message, size}): natively to TAKE's own queues, the native modules' and a
  // requester's reply (TAKE's reply function); to S-TAKEREQ's queues recorded (the message dropped) and answered
  // where TAKE waits
  send(h, r, prev) {
    const lab = this.lab, task = this.task();
    const q = r.d0 & 0xFFFF, m = lab.sim.u32(r.a0 >>> 0) >>> 0, n = lab.sim.u32((r.a0 >>> 0) + 4) >>> 0;
    const via = disasm(r.mdr) === TAKE_E143.send_return ? this.send_via : disasm(r.mdr), from = this.sender(r.mdr);
    const w = [0, 1, 2, 3].map((k) => (4 * k < n ? lab.sim.u32(m + 4 * k) >>> 0 : 0));
    if (this.native.has(q) || via === T_REPLY) {                                 // natively, recorded
      const reply = via === T_REPLY || NB.replies.has(via);              // (round 2: TAKE_EXPOSE's own reply too)
      this.record({ task, queue: q, name: this.name(q), command: reply ? null : w[2], parameter: w[3], token: w[1], status: reply ? w[0] & 0xFFFF : null, sync: via === NB.imd_send_return, from, via, answer: reply ? 'native: TAKE\'s reply to the requester' : 'native' });
      return prev(h, r);
    }
    if (!TAKE_REQ_QUEUES[q]) throw new TakeError(`${task} sends to ${this.name(q)} (queue 0x${q.toString(16)}) [${w.map(h8).join(' ')}] from ${h8(from)} (via ${h8(via)}): not a queue the probe knows`);
    let answer = 'none: word 0 is 0, nothing waits';
    if (w[0] === CP_POST) {
      const then = q === BC_EXEC ? lab.sim.u32(w[3] + 4) >>> 0 : null;
      if (then !== null && disasm(then) !== TAKE_E143.bc_callback) throw new TakeError(`BC_EXEC's parameter ${h8(w[3])} holds the callback ${h8(then)}, not TAKE_FUNC_CP's ${h8(TAKE_E143.bc_callback)}`);
      this.pending.push({ what: `{0, 0x${w[1].toString(16)}, 0} -> TAKE_FUNC_CP_POST (${this.name(q)}'s reply)`, run: () => this.reply(CP_POST, [0, w[1], 0]) });
      // (BC's callback by calls: its own frame is add -16,sp ... ret [],16, D; how BC calls it is not read)
      if (then !== null) this.pending.push({ what: `BC's completion ${h8(disasm(then))}`, run: () => this.lab.calls(disasm(then), null, undefined, undefined, LIMIT) });
      answer = `reply {0, token 0x${w[1].toString(16)}, 0} to TAKE_FUNC_CP_POST${then === null ? '' : `, then BC's callback ${h8(disasm(then))}`}`;
    } else if (w[0] === TAKE_POST) {
      answer = this.main_reply(q, w);                                            // (round 2)
    } else if (w[0] !== 0) throw new TakeError(`${task} sends to ${this.name(q)} [${w.map(h8).join(' ')}] with reply queue ${w[0]} from ${h8(from)} (via ${h8(via)}): no reading of what waits there`);
    this.record({ task, queue: q, name: this.name(q), command: w[2], parameter: w[3], token: w[1], sync: false, from, via, answer });
    h.finish(r, { d0: 0 });
  }
  // a synchronous request from TAKE: recorded, status 0
  sync_request(h, r, path) {
    const task = this.tids ? this.task() : null;
    if (!task) throw new TakeError(`TAKE's synchronous request ${path} from ${where(r.mdr)} outside TAKE's tasks`);
    const q = r.d0 & 0xFFFF;
    if (path === 'TAKE_FUNC_IMDFUNC' && this.nb_queues.has(q)) return this.neighbour_sync(h, r);   // round 2
    if (this.native.has(q)) throw new TakeError(`${task}'s synchronous request to its own or a native queue ${q} from ${where(r.mdr)}: not read`);
    if (!TAKE_REQ_QUEUES[q]) throw new TakeError(`${task} asks ${this.name(q)} (queue 0x${q.toString(16)}) command ${r.d1 >>> 0} synchronously from ${h8(this.sender(r.mdr))} (${path}): not a queue the probe knows`);
    this.record({ task, queue: q, name: this.name(q), command: r.d1 >>> 0, parameter: r.a0 >>> 0, token: null, sync: true, from: this.sender(r.mdr), via: path, answer: 'status 0' });
    h.finish(r, { d0: 0 });
  }
  // after the step (CamApp.pump): the answers TAKE waits for, each followed by a settle
  deliver() {
    const a = this.pending.shift();
    a.run();
    this.log.push(['answer', a.what]);
    this.s.settle(`S-TAKEREQ ${a.what}`);
  }
  // a reply {u16 status, token, word} to one of TAKE's reply queues
  reply(queue, words) {
    const lab = this.lab;
    const payload = lab.alloc(pack('<HHII', words[0], 0, words[1], words[2]), 4);
    const desc = lab.alloc(pack('<II', payload, 12), 4);
    const rc = lab.call(OLYQEWR, { d0: queue, d1: 0xFFFFFFFF, a0: desc }, null, null, LIMIT).d0;
    if (rc !== 0) throw new TakeError(`S-TAKEREQ: the reply to queue ${queue} = ${rc}`);
  }
  // S-TAKECAM: the camera driver's request switch (0x502a4a46, a0 the 192-byte request) from TAKE's tasks
  cam_request(h, r) {
    const lab = this.lab, task = this.tids ? this.task() : null;
    if (!task) return lab.passthrough(r);
    const q = r.a0 >>> 0, b = lab.sim.read(q, 4), id = b[0] | b[1] << 8, cb = lab.sim.u32(q + CAM.callback) >>> 0;
    if (!CAM_REQUESTS[id]) throw new TakeError(`${task} makes the camera driver's request ${id} (bytes +2 ${b[2]}, +3 ${b[3]}) from ${where(r.mdr)}: not a request the probe knows`);
    let answer = 'none: no completion callback';
    if (cb) {
      const at = disasm(cb);
      this.pending.push({ what: `camera driver request ${id}: completion ${h8(at)}(0, request)`, run: () => lab.calls(at, { d0: 0, a0: q }, undefined, undefined, LIMIT) });
      answer = `accepted (0), then its completion ${h8(at)} with status 0`;
    }
    this.record({ task, queue: null, name: `camera driver request ${id} (${CAM_REQUESTS[id]})`, command: id, parameter: b[3], token: null, sync: false, from: disasm(r.mdr), via: 'camera driver 0x502a4a46', answer });
    h.finish(r, { d0: 0 });
  }
  // S-TAKEUSF
  usf_gate(h, r) {
    const lab = this.lab, task = this.tids ? this.task() : null;
    if (!task) return lab.passthrough(r);
    const rec = r.a0 >>> 0, cb = disasm(lab.sim.u32(rec) >>> 0);
    this.pending.push({ what: `the dust filter's completion: ${h8(cb)}(0, record)`, run: () => lab.calls(cb, { d0: 0, a0: rec }, undefined, undefined, LIMIT) });
    this.record({ task, queue: null, name: 'dust filter gate on (USF 0x50064a69)', command: null, status: null, parameter: rec, token: null, sync: false, from: disasm(r.mdr), via: 'USF 0x50064a69', answer: `its completion ${h8(cb)} with status 0` });
    h.finish(r, { d0: 0 });
  }
  take_log() { const l = this.log; this.log = []; return l; }

  // ---- round 2 (docs/hle-gaps.md 4.1.6): TAKE's neighbours natively ----
  // install(): the neighbours' queues join the native ones (S-TAKEREQ no longer takes them)
  neighbours_install() {
    this.nb_tids = null;
    this.nb_queues = new Set();
    this.imd_caller = null;                // the caller of imd (0x502ce86d) whose post a native neighbour takes
    for (const t of Object.values(NB.tasks)) for (const q of t.queues) { this.native.add(q); this.nb_queues.add(q); }
    this.ae_writes = 0;                    // the AE result writer's native runs (none in the lab's scenarios)
    this.lab.observe(NB.ae_writer, (l, r) => { this.ae_writes += 1; this.log.push(['ae', `TAKE_EXPOSE's AE result writer from ${where(r.mdr)} in ${(this.tids && this.task()) || 'another task'}`]); }, 'H-TAKENBINIT (AE result writer)');
  }
  // H-TAKENBINIT, after H-TAKEINIT: TAKE_EXPOSE's module init natively, then both tasks started as USTART2's stage
  // starts them; each then waits (TAKE_EXPOSE on its queue, TAKE_POWER_MANAGER on its flag)
  neighbours_bring_up() {
    const lab = this.lab;
    for (const t of Object.values(NB.tasks)) if (t.init !== null) lab.call(t.init, null, null, null, LIMIT);
    const tid = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    this.nb_tids = {};
    for (const [k, t] of Object.entries(NB.tasks)) {
      const n = tid(t.tid), e = lab.nk.entry(n);
      if (e !== t.entry || lab.nk.state(n) !== 0x10) throw new TakeError(`H-TAKENBINIT: ${t.name} task ${n} has entry ${h8(e)} state ${lab.nk.state(n)}, not a dormant ${h8(t.entry)}`);
      lab.lt.allow.add(e);
      const [rc] = lab.nk.svc('act_tsk', { d0: n });
      if (rc !== 0) throw new TakeError(`H-TAKENBINIT: act_tsk(${n}) = ${rc}`);
      this.nb_tids[k] = n;
    }
    this.s.settle('H-TAKENBINIT');
    for (const [k, n] of Object.entries(this.nb_tids)) if ((lab.nk.state(n) & 0xF) !== 4) throw new TakeError(`H-TAKENBINIT: ${NB.tasks[k].name} (task ${n}) is not waiting after its start (state ${lab.nk.state(n)})`);
    this.log.push(['init', Object.entries(this.nb_tids).map(([k, n]) => `${NB.tasks[k].name} task ${n}`).join(', ') + ' waiting']);
  }
  neighbour_task(cur) {
    if (!this.nb_tids) return null;
    for (const [k, n] of Object.entries(this.nb_tids)) if (cur === this.lab.nk.tcb(n)) return NB.tasks[k].name;
    return null;
  }
  // TAKE_FUNC's synchronous request (imd) to a native neighbour: natively (its post is recorded by send, its reply
  // comes on TAKE_FUNC_IMDFUNC from the neighbour's task)
  neighbour_sync(h, r) {
    this.imd_caller = disasm(r.mdr);
    this.lab.passthrough(r);
  }
  // Round 2 (H-TAKEMAIN, S-THRTAKEOVER): TAKE_MAIN's and TAKE_MAIN_CP's tasks once started (main_tids), else null
  main_task() {
    if (!this.main_tids) return null;
    const cur = this.lab.lt.current();
    if (cur === this.lab.nk.tcb(this.main_tids.main)) return 'TAKE_MAIN';
    if (cur === this.lab.nk.tcb(this.main_tids.cp)) return 'TAKE_MAIN_CP';
    return null;
  }
  // (from install) TAKE_EXEC leaves S-MODACK; TAKE_MAIN's queues are native; the record of what TAKE_MAIN and
  // TAKE_MAIN_CP take ({dir 'in', task, queue, command, reply, token, parameter, state} for a request; a TAKE_POST or
  // mailbox message has status and no command; handler, TAKE_MAIN's handler of a TAKE_EXEC command); S-THRTAKEOVER
  install_main() {
    const lab = this.lab, M = TAKE_MAIN_E143, ca = this.camapp;
    this.main_tids = null;
    this.thr_takeover_set = false;
    ca.module_queues.delete(TAKE_EXEC);
    for (const q of Object.keys(TAKE_MAIN_QUEUES)) this.native.add(Number(q));
    const words = (l, m, n) => [0, 1, 2, 3].slice(0, n).map((k) => l.sim.u32(m + 4 * k) >>> 0);
    const take = (rq) => {
      rq.state = lab.sim.read(M.state, 2).reduce((a, b, k) => a | b << 8 * k, 0);
      this.requests.push({ dir: 'in', ...rq });
      this.log.push(['command', `${rq.task} takes ${rq.queue} ${rq.command === null ? `status ${rq.status}` : `command ${rq.command}`} (reply queue ${rq.reply}, token ${h8(rq.token)}, parameter ${h8(rq.parameter)}) in state ${rq.state}`]);
    };
    lab.observe(M.exec_received, (l, r) => {
      const w = words(l, l.sim.u32((r.sp >>> 0) + 32) >>> 0, 4);
      take({ task: 'TAKE_MAIN', queue: 'TAKE_EXEC', command: w[2], reply: w[0], token: w[1], parameter: w[3] });
    }, 'H-TAKEMAIN (TAKE_EXEC)');
    lab.observe(M.post_received, (l, r) => {
      const w = words(l, l.sim.u32((r.sp >>> 0) + 28) >>> 0, 3);
      take({ task: 'TAKE_MAIN', queue: 'TAKE_POST', command: null, status: w[0] & 0xFFFF, reply: null, token: w[1], parameter: w[2] });
    }, 'H-TAKEMAIN (TAKE_POST)');
    // its mailbox (flag bit 1: the posts through 0x502ce7b7, a callback's token), 12 bytes as TAKE_POST's
    lab.observe(M.mbx_received, (l, r) => {
      if ((r.d0 >>> 0) !== 0) return;
      const w = words(l, l.sim.u32((r.sp >>> 0) + 28) >>> 0, 3);
      take({ task: 'TAKE_MAIN', queue: 'mailbox', command: null, status: w[0] & 0xFFFF, reply: null, token: w[1], parameter: w[2] });
    }, 'H-TAKEMAIN (mailbox)');
    lab.observe(M.cp.received, (l, r) => {
      const w = words(l, r.a2 >>> 0, 4);
      take({ task: 'TAKE_MAIN_CP', queue: 'TAKE_MAIN_CP', command: w[2], reply: w[0], token: w[1], parameter: w[3] });
    }, 'H-TAKEMAIN (TAKE_MAIN_CP)');
    lab.observe(M.handler, (l, r) => {
      const rq = this.requests.findLast((x) => x.dir === 'in' && x.task === 'TAKE_MAIN' && x.queue === 'TAKE_EXEC');
      if (rq) rq.handler = disasm(r.a1);
    }, 'H-TAKEMAIN (handler)');
    // TAKE's synchronous request from TAKE_MAIN to a queue whose task runs natively: natively (its post and the reply
    // are recorded by send); imd_from names its caller for the record
    lab.wrap(TAKE_E143.imd, (prev) => (h, r) => {
      if (!this.main_task() || !this.native.has(r.d0 & 0xFFFF)) return prev(h, r);
      this.imd_from = disasm(r.mdr);
      return lab.passthrough(r);
    }, null);
    if (ca.native_tra) this.thr_takeover();
  }
  // S-THRTAKEOVER (control camapp 3; the header's round-2 paragraph): before the application starts
  thr_takeover() {
    const lab = this.lab, T = THR_TAKEOVER, was = lab.sim.u32(T.word) >>> 0;
    lab.call(T.set, { d0: T.value }, null, null, LIMIT);
    if ((lab.sim.u32(T.word) >>> 0) !== T.value) throw new TakeError(`S-THRTAKEOVER: CapThr's state ${h8(lab.sim.u32(T.word))} after its setter, not ${h8(T.value)}`);
    this.thr_takeover_set = true;
    this.log.push(['init', `S-THRTAKEOVER: CapThr's state ${h8(was)} -> ${h8(T.value)}`]);
  }
  // S-TAKEREQ's answer to a request whose word 0 names TAKE_POST (0x63), where TAKE_MAIN takes 12-byte replies: after
  // the step {u16 status 0, token = word 1, 0} there. TAKE_MAIN's TAKE_POST branch (0x50399971..0x50399a86) looks the
  // token up in its state's reply table (row +16: [u16 token, handler], 0xffff ends it) and calls the handler with the
  // message, then its state step 0x50399acf; what a handler reads is its own, so only MAIN_REPLIES are answered
  main_reply(q, w) {
    if (!MAIN_REPLIES.some((x) => x.queue === q && x.command === w[2] && x.token === w[1])) throw new TakeError(`${this.task()} asks ${this.name(q)} command 0x${w[2].toString(16)} with reply token ${w[1]} on TAKE_POST: no reading of what TAKE_MAIN's handler for that token reads`);
    this.pending.push({ what: `{0, 0x${w[1].toString(16)}, 0} -> TAKE_POST (${this.name(q)}'s reply)`, run: () => this.reply(TAKE_POST, [0, w[1], 0]) });
    return `reply {0, token 0x${w[1].toString(16)}, 0} to TAKE_POST`;
  }
  // H-TAKEMAIN (from bring_up, after H-TAKEINIT)
  bring_up_main() {
    const lab = this.lab, M = TAKE_MAIN_E143;
    lab.call(M.init, null, null, null, LIMIT);
    const tid = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    const tids = { main: tid(M.main.tid), cp: tid(M.cp.tid) };
    for (const [k, t] of Object.entries(tids)) {
      const e = lab.nk.entry(t);
      if (e !== M[k].entry || lab.nk.state(t) !== 0x10) throw new TakeError(`H-TAKEMAIN: task ${t} has entry ${h8(e)} state ${lab.nk.state(t)}, not a dormant ${h8(M[k].entry)}`);
      lab.lt.allow.add(e);
      const [rc] = lab.nk.svc('act_tsk', { d0: t });
      if (rc !== 0) throw new TakeError(`H-TAKEMAIN: act_tsk(${t}) = ${rc}`);
    }
    this.main_tids = tids;
    this.s.settle('H-TAKEMAIN');
    for (const t of Object.values(tids)) if ((lab.nk.state(t) & 0xF) !== 4) throw new TakeError(`H-TAKEMAIN: task ${t} is not waiting after its start (state ${lab.nk.state(t)})`);
    this.log.push(['init', `TAKE_MAIN task ${tids.main}, TAKE_MAIN_CP task ${tids.cp} waiting`]);
  }

  // ---- the strobe natively (docs/hle-gaps.md 4.12.1; H-STBINIT, S-HOTSHOE; STB_E143 below the class) ----
  // install(): STB_EXTERNAL's queue joins the native ones (S-TAKEREQ no longer takes it); its reply to a requester is
  // recorded ({dir 'out', task 'STB_EXTERNAL', status, token}); the hot shoe's channel (shoe.mjs)
  stb_install() {
    const lab = this.lab, S = STB_E143;
    this.stb_tids = null;
    this.stb_taken = [];                   // the requests STB_EXTERNAL takes with a reply queue {t_ns, command, token}
    this.native.add(S.queue);
    this.shoe = new HotShoe(lab);
    lab.observe(S.reply, (l, r) => {
      const q = r.d0 & 0xFFFF, m = l.sim.u32(r.a0 >>> 0) >>> 0, w = [0, 1, 2].map((k) => l.sim.u32(m + 4 * k) >>> 0);
      this.record({ task: 'STB_EXTERNAL', queue: q, name: this.name(q), command: null, parameter: w[2], token: w[1], status: w[0] & 0xFFFF, sync: false, from: S.reply, via: 'OlyQeWr', answer: 'native: STB_EXTERNAL\'s reply to the requester', t_ns: l.lab_time() });
    }, 'H-STBINIT (reply)');
    // a request STB_EXTERNAL takes with a reply queue (its receive's return, the message at (44,sp)): after the step
    // lab time runs until it has replied (stb_wait), as the requester's own wait for the reply lets it run
    lab.observe(S.received, (l, r) => {
      if ((r.d0 | 0) !== 0) return;
      const w = [0, 1, 2].map((k) => l.sim.u32((r.sp >>> 0) + S.message + 4 * k) >>> 0), from = this.requests.length;
      if (w[0] === 0) return;
      this.stb_taken.push({ t_ns: l.lab_time(), command: w[2], token: w[1] });
      this.pending.push({ what: `STB_EXTERNAL's reply to command ${w[2]} (token ${w[1]})`, run: () => this.stb_wait(w[2], w[1], from) });
    }, 'H-STBINIT (request)');
  }
  // the requester waits for STB_EXTERNAL's reply: lab time runs in STB_STEP_MS slices until it is recorded, at most
  // STB_ANSWER_MS (a reply that takes longer stops the session: with nothing on the shoe the strobe's own timers make
  // it 1 + 64 + 20 ms after the request, D, docs/hle-gaps.md 4.12.1)
  stb_wait(command, token, from) {
    const lab = this.lab, t0 = lab.lab_time();
    const replied = () => this.requests.slice(from).some((r) => r.task === 'STB_EXTERNAL' && r.dir === 'out' && r.token === token);
    while (!replied() && lab.lab_time() - t0 < STB_ANSWER_MS * 1e6) this.shoe.run(STB_STEP_MS);
    if (!replied()) throw new TakeError(`H-STBINIT: STB_EXTERNAL has not replied to command ${command} (token ${token}) ${STB_ANSWER_MS} ms of lab time on (shoe ${JSON.stringify(this.shoe.status())})`);
  }
  // H-STBINIT, after H-TAKEMAIN: the hot shoe's channel brought up (H-SIOMAP, S-HOTSHOE), then STB_HANDLER_PROC and
  // STB_EXTERNAL started with act_tsk as USTART2's stage starts them, in its order; each then waits (STB_HANDLER_PROC
  // on its flag, STB_EXTERNAL on its queue)
  stb_bring_up() {
    const lab = this.lab, tid = (a) => { const b = lab.sim.read(a, 2); return b[0] | b[1] << 8; };
    this.shoe.bring_up();
    this.stb_tids = {};
    for (const [k, t] of Object.entries(STB_E143.tasks)) {
      const n = tid(t.tid), e = lab.nk.entry(n);
      if (e !== t.entry || lab.nk.state(n) !== 0x10) throw new TakeError(`H-STBINIT: ${t.name} task ${n} has entry ${h8(e)} state ${lab.nk.state(n)}, not a dormant ${h8(t.entry)}`);
      lab.lt.allow.add(e);
      const [rc] = lab.nk.svc('act_tsk', { d0: n });
      if (rc !== 0) throw new TakeError(`H-STBINIT: act_tsk(${n}) = ${rc}`);
      this.stb_tids[k] = n;
    }
    this.s.settle('H-STBINIT');
    for (const [k, n] of Object.entries(this.stb_tids)) if ((lab.nk.state(n) & 0xF) !== 4) throw new TakeError(`H-STBINIT: ${STB_E143.tasks[k].name} (task ${n}) is not waiting after its start (state ${lab.nk.state(n)})`);
    this.log.push(['init', Object.entries(this.stb_tids).map(([k, n]) => `${STB_E143.tasks[k].name} task ${n}`).join(', ') + ' waiting']);
  }
}

// The strobe (docs/hle-gaps.md 4.12.1). USTART2's stage 0x501e8e84 starts STB_HANDLER_PROC (task 139, tid word
// 0x60042e3c, 0x501e8fbd), STB_CHARGE (task 35, 0x60042d6c, 0x501e8fd8) and STB_EXTERNAL (task 101, 0x60042df0,
// 0x501e8ff3) through OlyTaSt 0x5002c546, with no strobe module init before them. STB_EXTERNAL (0x501b7465) is queue
// 0x57's one reader and replies {u16 status, token, parameter} to the request's word 0 with OlyQeWr at 0x501b76fb
// (d0 the queue, a0 the descriptor {message, 12}); STB_HANDLER_PROC (0x501bb24a) runs the functions the strobe's
// timer handlers queue (0x501bb29c: ten slots at 0x62a29b4c, flag (0x6004317c) bit 1), among them the end of a
// channel-11 transfer (0x501b69cd -> 0x501b69fc), so STB_EXTERNAL's waits need it. STB_CHARGE stays dormant: nothing
// on TAKE's requests asks it (X)
// (STB_EXTERNAL's loop receives 16 bytes {reply queue, token, command, parameter} into (44,sp) with OlyQeRd, its return
// at 0x501b759b with d0 0 for a message, 0x501b7585..0x501b7594)
export const STB_E143 = {
  tasks: {
    handler: { name: 'STB_HANDLER_PROC', tid: 0x60042E3C, entry: 0x501BB24A },
    external: { name: 'STB_EXTERNAL', tid: 0x60042DF0, entry: 0x501B7465 },
  },
  queue: 0x57,
  reply: 0x501B76FB,
  received: 0x501B759B, message: 44,
};
const STB_ANSWER_MS = 1000, STB_STEP_MS = 10;
