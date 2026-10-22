// OM_HOST_MEM=FILE (a memory-growth measurement of a long session): the main isolate's memory, which
// holds the HTTP front and the proxy only: the harness (PlaySession, the Player, the lab's lists) runs in the lab
// worker beside the emulator. Harness growth in the worker
// shows only in the harness_entries count (status()). Once a second the main isolate is collected in
// full (a forced GC) and one JSON line appended to FILE: {t (process.hrtime in seconds, monotonic), heap
// (heapUsed: the measured figure), ext (external, which holds the frames' ArrayBuffers in flight: logged only)} in bytes. The
// lab worker's isolate, its memory images and V8's committed space are not in it. Off (no variable): nothing runs. The
// variable is a gate's (refenv LEAKY): an inherited one is refused by the check runners. Node-only (host/).
import fs from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';

export function installMemProbe(file = process.env.OM_HOST_MEM, wall = () => Number(process.hrtime.bigint()) / 1e9) {
  if (!file) return null;
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const sample = () => {
    gc();
    const m = process.memoryUsage();
    try { fs.appendFileSync(file, JSON.stringify({ t: wall(), heap: m.heapUsed, ext: m.external }) + '\n'); } catch { /* the check is gone */ }
  };
  sample();
  return setInterval(sample, 1000).unref();
}
