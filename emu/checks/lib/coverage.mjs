// The execution-coverage collector behind OM_COVERAGE=DIR (bin/fwmap.mjs cover): with it set, every lab a node entry
// point makes through labEnv (checks/lib/env.mjs envMachine), bin/run.mjs or bin/playperf.mjs gets the machine option
// coverage (src/machine.mjs createMachine), and the realm's collector records the pcs the CPU runs and the stand-ins
// that fire. Unset, nothing is collected and the labs' env is what it was. One collector per realm (each worker thread
// its own), over the running model's main block: a byte per body offset, bit 0 for a pc in the run-time copy (the
// image base), bit 1 in the flash view (0x50000000: check_nd128 runs its patched block there), bit 2 in the run-time
// copy's uncached alias (+0x40000000); any other pc (lab trampolines, the local window) is counted by address. Each realm writes DIR/<pid>-<threadId>.bin (u32 LE per executed body offset: offset | bits << 25, in
// offset order) and DIR/<pid>-<threadId>.json (argv, model, the OM_* environment, the other pcs, the stand-ins: [pc
// hex, name, fires]) at process exit, and in full again at every flushCoverage(). A worker thread that its parent may
// terminate() (the --jobs pools of check_menu and check_nav) never sees its exit, so it calls flushCoverage() before it
// posts each result. OM_COVERAGE is inherited by every child process and worker thread (refenv childEnv keeps it).
import fs from 'node:fs';
import path from 'node:path';
import { threadId, isMainThread } from 'node:worker_threads';
import { MODEL, MODEL_INFO, IMAGE_BASE } from '../../src/fw/model.mjs';

const UNCACHED = 0x40000000;          // the uncached DRAM alias of the run-time copy (0x6xxxxxxx -> 0xAxxxxxxx)
const FLASH = 0x50000000;             // the main block's flash view (src/machine.mjs om1.code)
let collector;                        // undefined: not looked at yet; null: OM_COVERAGE unset

function create(dir) {
  const len = MODEL_INFO.rom_len, base = IMAGE_BASE, alias = (IMAGE_BASE + UNCACHED) >>> 0;
  if (len > 1 << 25) throw new Error(`OM_COVERAGE: ${MODEL}'s main block is ${len} bytes; the coverage files hold 25-bit offsets`);
  const marks = new Uint8Array(len), other = new Map(), stubs = new Map();
  let dirty = false;
  const c = {
    mark(pc) {
      dirty = true;
      let o = (pc - base) >>> 0;
      if (o < len) { marks[o] |= 1; return; }
      o = (pc - alias) >>> 0;
      if (o < len) { marks[o] |= 4; return; }
      o = (pc - FLASH) >>> 0;
      if (o < len) { marks[o] |= 2; return; }
      other.set(pc >>> 0, (other.get(pc >>> 0) ?? 0) + 1);
    },
    stub(pc, name) {
      dirty = true;
      const k = `${(pc >>> 0).toString(16)}|${name}`;
      stubs.set(k, (stubs.get(k) ?? 0) + 1);
    },
    write() {
      if (!dirty) return;
      let n = 0;
      for (let o = 0; o < len; o++) if (marks[o]) n++;
      const out = new Uint32Array(n);
      for (let o = 0, k = 0; o < len; o++) if (marks[o]) out[k++] = (o | marks[o] << 25) >>> 0;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${process.pid}-${threadId}`);
      fs.writeFileSync(`${file}.bin`, out);
      fs.writeFileSync(`${file}.json`, JSON.stringify({
        pid: process.pid, ppid: process.ppid, threadId, main: isMainThread, argv: process.argv, model: MODEL, executed: n,
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('OM_'))),
        other: [...other].map(([pc, count]) => [pc.toString(16), count]),
        stubs: [...stubs].map(([k, fires]) => [...k.split('|'), fires]),
      }));
      dirty = false;
    },
  };
  process.on('exit', () => c.write());
  return c;
}

// The realm's collector, or null when OM_COVERAGE is unset (read at the first call).
export function envCoverage() {
  if (collector === undefined) collector = process.env.OM_COVERAGE ? create(path.resolve(process.env.OM_COVERAGE)) : null;
  return collector;
}
// The machine options it adds (env.machine.coverage), or none.
export function coverageOption() { const c = envCoverage(); return c ? { coverage: c } : {}; }
// For an env built without machine options: { machine: { coverage } }, or nothing at all when OM_COVERAGE is unset.
export function coverageEnv() { const c = envCoverage(); return c ? { machine: { coverage: c } } : {}; }
// Write the realm's coverage now (a pool worker before it posts a result); nothing when OM_COVERAGE is unset.
export function flushCoverage() { if (collector) collector.write(); }
