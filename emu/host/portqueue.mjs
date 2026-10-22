// The node host's input queue, as the Player in the worker thread sees it (put, get_nowait, get(timeout), qsize, items).
// The main thread posts every input on a MessagePort, then increments word F_INPUT of the shared flags and notifies;
// the worker pulls whatever is already posted with receiveMessageOnPort before each queue call, and get(timeout)
// blocks in Atomics.wait on that word, so the synchronous loop waits up to its timeout and an
// input that arrives during the wait ends it. Node-only (host/).
import { receiveMessageOnPort } from 'node:worker_threads';

// The shared flags (one Int32Array on a SharedArrayBuffer): the input counter, Player.stop, Player.signalled (the
// signal handler's flag) and the lab kill of --debug-api's SIGUSR2 (a count: src/lab/sim.mjs env.labKills).
export const F_INPUT = 0, F_STOP = 1, F_SIGNAL = 2, F_KILL = 3, F_WORDS = 4;
export const newFlags = () => new Int32Array(new SharedArrayBuffer(4 * F_WORDS));
// The main thread's half: post, then count and wake the worker.
export function postInput(port, flags, msg) {
  port.postMessage(msg);
  Atomics.add(flags, F_INPUT, 1);
  Atomics.notify(flags, F_INPUT);
}

export class PortQueue {
  // decode(message) -> the input dict the Player takes.
  constructor(port, flags, decode) {
    this.port = port;
    this.flags = flags;
    this.decode = decode;
    this.buf = [];
  }
  get canBlock() { return true; }
  pump() {
    for (let m; (m = receiveMessageOnPort(this.port)) !== undefined;) this.buf.push(this.decode(m.message));
  }
  put() { throw new Error('PortQueue.put: inputs come from the main thread (host/proxy.mjs)'); }
  get_nowait() {
    this.pump();
    return this.buf.length ? this.buf.shift() : null;     // null: empty
  }
  // get(t): an input, or null after t seconds.
  get(timeout) {
    const end = performance.now() + timeout * 1000;
    for (;;) {
      const v = Atomics.load(this.flags, F_INPUT);
      this.pump();
      if (this.buf.length) return this.buf.shift();
      const left = end - performance.now();
      if (left <= 0) return null;
      Atomics.wait(this.flags, F_INPUT, v, left);
    }
  }
  qsize() { this.pump(); return this.buf.length; }
  items() { this.pump(); return [...this.buf]; }
}
