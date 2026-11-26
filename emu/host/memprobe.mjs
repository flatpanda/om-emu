// OM_HOST_MEM=FILE (a memory-growth measurement of a long session): samples both V8 isolates — the main isolate
// (HTTP front and proxy, once a second on a timer via installMemProbe) and the lab worker isolate (PlaySession,
// Player and the lab's lists, rate-limited to once a second from the worker's loop tick via createMemSampler).
// Before each sample the isolate is collected in full (a forced GC) and one JSON line appended to FILE:
// {t (process.hrtime in seconds, monotonic), heap (heapUsed: the measured figure), ext (external, which holds
// ArrayBuffers / Buffers in flight), isolate ('main' or 'worker')} in bytes. Off (no variable): nothing runs
// (returns null, zero overhead). The variable is a gate's (refenv LEAKY): an inherited one is refused by the check
// runners. Node-only (host/).
import fs from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { isMainThread } from 'node:worker_threads';

const defaultWall = () => Number(process.hrtime.bigint()) / 1e9;

function exposeGc() {
  if (typeof globalThis.gc === 'function') return globalThis.gc;
  v8.setFlagsFromString('--expose-gc');
  return typeof globalThis.gc === 'function' ? globalThis.gc : vm.runInNewContext('gc');
}

export function createMemSampler(
  file = process.env.OM_HOST_MEM,
  wall = defaultWall,
  { isolate = isMainThread ? 'main' : 'worker', minIntervalS = 1 } = {},
) {
  if (!file) return null;
  const gc = exposeGc();
  let last = -Infinity;
  return (force = false) => {
    const now = wall();
    if (!force && now - last < minIntervalS) return false;
    gc();
    const m = process.memoryUsage();
    const t = wall();
    last = t;
    try { fs.appendFileSync(file, JSON.stringify({ t, heap: m.heapUsed, ext: m.external, isolate }) + '\n'); } catch { /* the check is gone */ }
    return true;
  };
}

export function installMemProbe(
  file = process.env.OM_HOST_MEM,
  wall = defaultWall,
  { isolate = isMainThread ? 'main' : 'worker', intervalMs = 1000 } = {},
) {
  const sample = createMemSampler(file, wall, { isolate, minIntervalS: 0 });
  if (!sample) return null;
  sample(true);
  return setInterval(() => sample(true), intervalMs).unref();
}
