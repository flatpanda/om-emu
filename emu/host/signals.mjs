// The play tool's signal handler on node: SIGINT, SIGTERM and SIGHUP (the terminal closed) set
// the Player's signalled flag (word F_SIGNAL of the shared flags) and nothing else; the loop sees it after its current
// tick or within 20 ms (next_input's q.get). A second signal ends at once (exit 130): onSecond. Node-only.
import { F_SIGNAL, F_KILL } from './portqueue.mjs';

export const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
export function makeSignalHandler(flags, onSecond) {
  let count = 0;
  return (sig) => {
    count += 1;
    Atomics.store(flags, F_SIGNAL, 1);
    if (count > 1) onSecond(sig);
  };
}
export function installSignals(flags, onSecond) {
  const h = makeSignalHandler(flags, onSecond);
  for (const s of STOP_SIGNALS) process.on(s, h);
  return h;
}
// --debug-api: SIGUSR2 kills the lab from outside (a simulated lab crash; test/test_host.mjs): it counts the kills, and the
// lab that existed then raises RuntimeError at its next packet, read or write (src/lab/sim.mjs env.labKills); a lab
// made later (Restart) runs.
export function installLabKill(flags) {
  process.on('SIGUSR2', () => Atomics.add(flags, F_KILL, 1));
}
