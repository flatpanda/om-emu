#!/usr/bin/env node
// The firmware-free tier of bin/test.mjs: the tests that need no firmware image and nothing under emu/out/, so they run
// on any checkout with node (npm run test:pure, a few seconds). The recorded ISA vectors
// (test/fixtures/isa_vectors.json) on both engines, the core's two tiers in lockstep and its length tables
// (test_core.mjs), the pure sha256, the router's request bodies, the browser player's driver, result box and page
// after a stop, the scene stand-in's model, the decode-cache checks, the command-line parser of the checks and tools
// (test_args.mjs), the worker purity rule (and no py-prefixed module or name) and the firmware rules of
// src/fw/facts.mjs (test_facts.mjs: firmware-optional, each unpacked main block checked against its MODELS entry).
// bin/test.mjs runs all of these too, with everything else.
//   node emu/bin/test-pure.mjs
import { vectors } from '../test/test_vectors.mjs';
import { coreTests } from '../test/test_core.mjs';
import { purity } from '../test/test_pure.mjs';
import { cache } from '../test/test_regress.mjs';
import { shaTests, bodyTests, driverTests, resultBoxTests, pageTests } from '../test/test_web.mjs';
import { sceneUnits } from '../test/test_scene.mjs';
import { factsTests } from '../test/test_facts.mjs';
import { argsTests } from '../test/test_args.mjs';

let bad = 0;
const report = (name, r, passed = r.checks - r.bad.length, total = r.checks) => {
  console.log(`${name}: ${passed}/${total}`);
  r.bad.slice(0, 20).forEach((x) => console.log('  ', x));
  bad += r.bad.length;
};
for (const engine of ['port', 'cached']) {
  const r = vectors(engine);
  console.log(`isa vectors (${engine}): ${r.pass}/${r.total}`);
  for (const [f, l] of Object.entries(r.fails)) console.log('  ', f, l.length, l.slice(0, 3));
  bad += r.total - r.pass;
}
const co = coreTests();
console.log(`core: lockstep step() vs run(1) ${co.lockstep.cases - co.lockstep.bad.length}/${co.lockstep.cases} (${co.lockstep.faults} faulting), mutant 7 caught: ${co.mutant.bad.length ? 'yes' : 'NO'}; lengths over ${co.lengths.pairs} (op, p) pairs`);
co.bad.forEach((x) => console.log('  ', x));
bad += co.bad.length;
const ca = cache();
report('decode-cache checks', { checks: ca.checks, bad: ca.bad });
report('sha256', shaTests());
report('request bodies', bodyTests());
report('driver', await driverTests());
report('wait_result', await resultBoxTests());
report('page after a stop', await pageTests());
report('scene stand-in (S-SCENE)', sceneUnits());
report('command-line parser', argsTests());
const fa = factsTests();
report(`firmware facts (${fa.models} unpacked main blocks)`, fa);
const pu = purity();
report('purity', { checks: pu.files, bad: pu.bad });
console.log(bad ? `FAILED (${bad})` : 'all passed');
process.exit(bad ? 1 : 0);
