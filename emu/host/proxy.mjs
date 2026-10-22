// The node host's main-thread view of the Player: what the HTTP handlers read and call on
// the Player, for src/lab/playapi.mjs's router: a, status_seq and status_doc, frame_seq and frame (with the composite
// for /api/frame), log (the in-memory session log), stop, submit, enqueue, wait_result (ResultBox: the 500 results
// popped on read), wall. The worker posts each document as JSON text, parsed here. Inputs get their seq and t_wall
// here on arrival, as Player.submit does, and go to the worker as JSON text. The stop
// the router and the waiters see is the loop's, in the order of the worker's messages, from the result of the input
// that set it (3d, get stop). Node-only (host/).
import { ResultBox, jsonType } from '../src/lab/player.mjs';
import { ValueError } from '../src/lab/errors.mjs';
import { F_STOP, postInput } from './portqueue.mjs';

const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const wallClock = () => Number(process.hrtime.bigint()) / 1e9;      // monotonic seconds

export class PlayerProxy {
  constructor(a, flags, inPort, { wall = wallClock } = {}) {
    this.a = a;
    this.flags = flags;
    this.inPort = inPort;
    this.wall = wall;
    this.status_seq = 0;
    this.status_doc = {};
    this.frame_seq = 0;
    this.frame = null;               // [null, device, lab_ns, sha16]
    this.log = [];                   // the session log's entries (each with its idx)
    this.input_seq = 0;
    this.box = new ResultBox(() => this.stop);
    this.results = this.box.results;
    this.api = null;                 // the router (notify, onFrame)
    this.ended = null;               // the worker's last message: done or crash
    this.stopSeen = false;           // the stop in message order (get stop)
    this.stopPending = false;        // a 'stop' message whose input's result has not come yet
  }
  // Player.stop as the request handlers see it (3d). Not the shared F_STOP word, which the worker sets before its earlier
  // messages reach this thread: a waiter woken by one of those would see the stop before its own result and answer null
  // where the record is the answer (G-host's stops case, 1 of 3 runs). The loop's own stop (a quit control: its
  // 'stop' message, then its status, then its result) takes effect with that control's result: the recorded ?sync=1
  // quit control answers its own record (gate 2's v-api) and a long poll in flight answers the quit's status (G-host's
  // stopped case), so the status's notify in between wakes nobody to a stop.
  // The host's own stop (stopped()) takes effect at once.
  get stop() { return this.stopSeen; }
  // Player.submit on the main thread: seq and t_wall now, the input to the worker's queue.
  submit(inp) {
    if (!isDict(inp)) throw new ValueError(`an input is a JSON object, not ${jsonType(inp)}`);
    this.input_seq += 1;
    const seq = this.input_seq;
    postInput(this.inPort, this.flags, { text: JSON.stringify(inp), seq, t_wall: this.wall() });
    return seq;
  }
  // Queue an input that has its seq and t_wall (the /api/quit control).
  enqueue({ seq, t_wall, ...body }) {
    postInput(this.inPort, this.flags, { text: JSON.stringify(body), seq, t_wall });
  }
  wait_result(seq, timeout = 120) { return this.box.wait(seq, timeout); }
  // A message from the worker, in the Player's order.
  onMessage(m) {
    const api = this.api;
    switch (m.type) {
      case 'status':
        this.status_seq = m.seq;
        this.status_doc = JSON.parse(m.text);
        this.notifyAll();
        break;
      case 'frame': {
        const raw = new Uint8Array(m.raw);
        this.frame_seq = m.seq;
        this.frame = [null, m.device, m.lab_ns, m.sha16];
        if (api) api.raw = { w: m.w, h: m.h, raw, meta: { seq: m.seq, device: m.device, lab_ns: m.lab_ns, sha16: m.sha16 } };
        this.notifyAll();
        break;
      }
      case 'result':
        if (this.stopPending) this.stopSeen = true;      // the quit control's result: its stop takes effect with it
        this.box.put(m.seq, JSON.parse(m.text));         // wakes the ?sync=1 waiters
        api?.notify();
        break;
      case 'log':
        this.log.push(JSON.parse(m.text));
        break;
      case 'logfix':
        for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].idx === m.idx) { this.log[i] = JSON.parse(m.text); break; }
        break;
      case 'logtrim':
        this.log.splice(0, m.n);
        break;
      case 'stop':                                       // the loop stopped: no notify (its status and result follow)
        this.stopPending = true;
        break;
      case 'done': case 'crash':
        this.ended = m;
        break;
      default:
        throw new Error(`proxy: worker message ${m.type}`);
    }
  }
  // The host's own stop: the 'stopped' status (the last status with phase 'stopped' and the next seq), every waiter
  // and long poll answered.
  stopped() {
    Atomics.store(this.flags, F_STOP, 1);
    this.stopSeen = true;
    this.status_seq += 1;
    this.status_doc = { ...this.status_doc, phase: 'stopped', seq: this.status_seq };
    this.notifyAll();
  }
  // The ?sync=1 waiters (ResultBox) and the router's long polls re-check their predicates.
  notifyAll() {
    this.box.notifyAll();
    this.api?.notify();
  }
}
