#!/usr/bin/env node
// The ISA check: every recorded vector of test/fixtures/isa_vectors.json replayed by single steps through the Simulator facade (the
// three RAM windows from random.Random(seed).randbytes, the UDF unit through the lab registers 16..19 with 'p'/'P'),
// compared with the committed outputs; the firmware functions that use the UDF unit against refs/isafw.mjs; the
// cross-page fetch and insn-limit checks. --vectors and --show are honoured; --seed and --golden parse and do nothing
// (the vectors are fixed data).
//   node emu/checks/check_isa.mjs [--vectors PATH] [--show N]
import { ISA_VECTORS, labEnv, runMain, SystemExit } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { Simulator } from '../src/lab/sim.mjs';
import { loadVectors, unpack, replay, compare, firmwareChecks, pageChecks, limitCheck } from './lib/isa.mjs';

function main(argv) {
  const a = parseArgs('check_isa.mjs', argv, [
    { opt: '--vectors', type: 'path' },
    { opt: '--seed', type: 'int' },
    { opt: '--golden', type: 'path' },
    { opt: '--show', type: 'int' },
  ]);
  const vectorsPath = a.vectors ?? ISA_VECTORS, show = Number(a.show ?? 20);
  const doc = loadVectors(vectorsPath);
  const cases = doc.cases.map((c, i) => unpack(c, i));
  const failures = [], forms = new Map(), sources = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const sim = new Simulator(labEnv());
  try {
    for (const c of cases) {
      const [result, memory] = replay(sim, c);
      const problems = compare(c, result, memory);
      bump(forms, c.form);
      bump(sources, c.out.src);
      if (problems.length) failures.push([c, problems]);
    }
  } finally { sim.close(); }
  const implemented = [...forms.keys()].filter((f) => !['undefined', 'break'].includes(f) && !f.includes(':'));
  let sequences = 0;
  for (const [f, n] of forms) if (f.includes(':')) sequences += n;
  console.log(`ISA vectors: ${cases.length - failures.length}/${cases.length} passed; ${implemented.length} instruction forms, ${forms.get('undefined') ?? 0} must-fault encodings, ${sequences} multi-instruction/fault-path cases`);
  console.log('  sources: ' + [...sources].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([k, v]) => `${k} ${v}`).join(', '));
  for (const [c, problems] of failures.slice(0, show)) console.log(`  FAIL #${c.id} ${c.form} code=${c.code}: ${problems.join('; ')}`);
  const firmware = doc.firmware ?? [];
  const [total, fw] = firmwareChecks(firmware);
  console.log(`firmware functions using the UDF unit: ${total - fw.length}/${total} passed (timegm, atoi, roundup, premultiply, fixmul16/muldiv, ${firmware.length} libm)`);
  for (const line of fw.slice(0, show)) console.log('  FAIL ' + line);
  const pages = pageChecks();
  console.log(`cross-page instruction fetch after patching page 2: ${pages} checks passed`);
  const limit = limitCheck();
  console.log(`insn-limit: ${limit} checks passed`);
  if (failures.length || fw.length) throw new SystemExit(1);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_isa.mjs', main);
