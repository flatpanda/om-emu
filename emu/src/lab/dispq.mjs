// S-DISPQ's queue discipline (src/lab/play.mjs; docs/hle-gaps.md 4.1.9), firmware-free so its order is unit-tested
// (test/test_dispq.mjs). The DISPLAY task (E143: static id 54, priority 26, entry 0x501c3035) takes one message at a
// time: its receive (OlyQeRd at 0x501c308b, timeout -1), the command's handler, the reply (0x501c48bf from
// 0x501c38a3), and back to the receive (jmp at 0x501c38b6), D. A message posted while it handles one waits in the
// kernel's queue, which copies it at the post (OlyQeWr's tsnd_dtq: into a waiting receiver's buffer at 0x50016667,
// else into the queue's ring, D), and is taken after the reply, in the order of the posts. The lab runs the task's
// loop per message on the sender's task (DisplayLab.task_message); a run is open from its start to its loop's next
// receive. post() keeps a message posted while a run is open, and the end of the outermost run hands each kept message
// to the drain, in order: what a kept message's own run posts is kept behind the ones before it.
export class DisplayQueue {
  constructor() {
    this.runs = [];        // the runs open, outermost first: each its task (whatever the caller names it by)
    this.pending = [];     // the messages posted while a run was open, in their order
    this.draining = false;
  }
  get open() { return this.runs.length > 0; }
  // whether task runs one of the open runs (a send of its own inside its run is a handler's, not another task's)
  runs_on(task) { return this.runs.includes(task); }
  post(message) {
    if (!this.open) throw new Error('DisplayQueue: a message kept while no DISPLAY run is open');
    this.pending.push(message);
  }
  // body() is one run on task; at the end of the outermost run, drain(message) runs each kept message (each a run of
  // its own, through run() again). A throw ends the session: what is kept is dropped with it, nothing drained after
  run(task, body, drain) {
    const outermost = !this.open && !this.draining;
    this.runs.push(task);
    let result;
    try {
      try { result = body(); } finally { this.runs.pop(); }
      if (outermost) {
        this.draining = true;
        while (this.pending.length) drain(this.pending.shift());
      }
    } catch (e) {
      if (outermost) this.pending.length = 0;
      throw e;
    } finally {
      if (outermost) this.draining = false;
    }
    return result;
  }
}
