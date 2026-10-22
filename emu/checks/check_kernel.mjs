#!/usr/bin/env node
// The kernel check: the six HLE sessions of scenarios/kernel.mjs with one Check, then the report; stdout in the
// recorded format, the wall time as
// '(N.N s)' (masked by the runner).
//   node emu/checks/check_kernel.mjs
import { labEnv, runMain } from './lib/env.mjs';
import { main as kernelMain } from '../scenarios/kernel.mjs';

function main(argv) {
  // no argument parser: the check ignores its arguments
  const t0 = performance.now();
  const env = labEnv({
    sessionName() {}, mark() {}, check() {},
    print(line) {
      console.log(line.endsWith(' <wall>') ? `${line.slice(0, -7)} (${((performance.now() - t0) / 1000).toFixed(1)} s)` : line);
    },
  });
  return kernelMain(env);
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_kernel.mjs', main);
