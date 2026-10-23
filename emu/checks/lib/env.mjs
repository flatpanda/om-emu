// The node side of a check: repository paths, the firmware image and resource block, sha256, the lab env the
// harness modules take (as bin/run.mjs builds it, without tracing: no session, so no Stats or harness digest), and the
// process conventions of a check (an exit with a message, a usage error, an uncaught error).
import { expandImage } from '../../src/fw/expand.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UsageError } from './args.mjs';
import { stackOf } from './errors.mjs';
import { WrongFirmware } from '../../src/fw/labfw.mjs';
import { MODEL_INFO } from '../../src/fw/model.mjs';
import { romPath, resPath } from '../../src/fw/models.mjs';
import { resPrefix } from '../../src/fw/resprefix.mjs';
import { coverageOption } from './coverage.mjs';

export const REPO = path.resolve(new URL('../../../', import.meta.url).pathname);
// the checks' own fixtures: their pinned notes, the VSC register header and class tables, check_perf's P7 address list
// and P10a cases
export const FIXTURES = path.join(REPO, 'emu/checks/fixtures');
// the recorded single-instruction vectors (check_isa, check_perf P1 and test_vectors read them)
export const ISA_VECTORS = path.join(REPO, 'emu/test/fixtures/isa_vectors.json');
// ORIGINAL / PATCHED / BLOCK: absolute paths under REPO.
export const ORIGINAL = path.join(REPO, romPath(MODEL_INFO));
export const PATCHED = path.join(REPO, 'artifacts/nd128/OM1_v1.9_ND128.main-code.bin');
// The ND128 candidate's main code: the original main code block with the patches artifacts/nd128/manifest.json lists
// (tools/om1_nd128.py writes the same bytes to PATCHED; nothing here reads that file). The caller checks its sha256.
export function readPatched() {
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'artifacts/nd128/manifest.json'), 'utf8'));
  const b = readBytes(ORIGINAL);
  for (const p of m.patches) b.set(Buffer.from(p.after, 'hex'), parseInt(p.decoded_body_offset, 16));
  return b;
}
export const BLOCK = path.join(REPO, resPath(MODEL_INFO));
export { createHash };
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const readBytes = (p) => new Uint8Array(fs.readFileSync(p));
// The node entry points load the firmware from fixed paths; like the browser's labFirmware, they refuse an image or
// resource block that is not the model's at load time, not deep inside a hook.
export function checkImage(b, file = ORIGINAL) {
  const h = sha256(b);
  if (h !== MODEL_INFO.rom_sha256) throw new Error(`${file}: ${new WrongFirmware('the main code block', h).message}`);
  return b;
}
export function checkBlock(b, file = BLOCK) {
  const h = sha256(resPrefix(b));
  if (h !== MODEL_INFO.res_sha256) throw new Error(`${file}: ${new WrongFirmware('the resource prefix', h).message}`);
  return b;
}
let image = null, block = null;
export function loadImage() { return image ??= expandImage(checkImage(readBytes(ORIGINAL))); }   // the run-time image (src/fw/expand.mjs)
export function loadBlock() { return block ??= checkBlock(readBytes(BLOCK)); }

// The env of src/lab (HLE, OsdLab, Simulator): the image, sha256, and no session (beginSession absent) unless a tracer
// installed one with traceLabs (bin/checktrace.mjs: beginSession(lab), slice), so every lab a check creates is traced.
let TRACE = null;
export function traceLabs(fields) { TRACE = fields; }
// A check's session function returned a value (check_menu's run_lab and g2_session, check_nav's
// run_script, run_long_wait and run_language): bin/checktrace.mjs appends it as a 'result' event to the current lab's
// trace; nothing happens unless a tracer installed onResult.
export function resultHook(fn, value) { if (TRACE && TRACE.onResult) TRACE.onResult(fn, value); }
// extra.machine adds to the run's machine options (envMachine()); extra.rom replaces the run-time image.
export function labEnv(extra = {}) {
  const { machine = {}, ...rest } = extra;
  return { createHash, ...(TRACE ?? {}), ...rest, rom: rest.rom ?? loadImage(), machine: { ...envMachine(), ...machine } };
}

// The machine options of a run (src/lab/sim.mjs env.machine): OM_MACHINE, white-space separated NAME=VALUE pairs,
// mutant=N (a negative control, a non-negative integer) and oneInsn=0|1 (the one-instruction mode). Parsed and checked
// at the first use; formatMachine writes the same form for a child's environment. With OM_COVERAGE set, also the
// realm's coverage collector (checks/lib/coverage.mjs).
let MACHINE = null;
export function envMachine() { return MACHINE ??= { ...parseMachine(process.env.OM_MACHINE ?? ''), ...coverageOption() }; }
export function parseMachine(text) {
  const out = {};
  for (const item of text.split(/\s+/).filter(Boolean)) {
    const m = /^(mutant|oneInsn)=(.*)$/.exec(item);
    if (m && m[1] === 'mutant' && /^\d+$/.test(m[2])) out.mutant = Number(m[2]);
    else if (m && m[1] === 'oneInsn' && (m[2] === '0' || m[2] === '1')) out.oneInsn = m[2] === '1';
    else throw new UsageError(`OM_MACHINE: ${item}: mutant=N or oneInsn=0|1`);
  }
  return out;
}
export const formatMachine = ({ mutant, oneInsn }) => [...(mutant !== undefined ? [`mutant=${mutant}`] : []),
  ...(oneInsn !== undefined ? [`oneInsn=${oneInsn ? 1 : 0}`] : [])].join(' ');

// A check's exit: SystemExit(code) exits with code, SystemExit(message) prints the message on stderr and exits 1.
export class SystemExit extends Error {
  constructor(code) { super(typeof code === 'string' ? code : `exit ${code}`); this.code = code; }
}

// Run a check's main(): its return value is the exit status. A SystemExit exits as above; a UsageError (checks/lib/
// args.mjs) prints 'name: message' and the usage line, exit 2; any other uncaught error prints its stack and notes,
// exit 1.
export function runMain(name, main) {
  let rc;
  try {
    rc = main(process.argv.slice(2));
    if (rc instanceof Promise) {                 // an async main (a check that imports its reference late)
      rc.then((v) => { process.exitCode = v ?? 0; }, (e) => { process.exitCode = exitFor(name, e); });
      return;
    }
  } catch (e) {
    rc = exitFor(name, e);
  }
  process.exitCode = rc ?? 0;
}
export function exitFor(name, e) {
  if (e instanceof SystemExit) {
    if (typeof e.code !== 'string') return e.code ?? 0;
    process.stderr.write(e.code + '\n');
    return 1;
  }
  if (e instanceof UsageError) {
    process.stderr.write(`${name}: ${e.message}\n${e.usage ? `${e.usage}\n` : ''}`);
    return 2;
  }
  process.stderr.write(`${stackOf(e)}\n`);
  return 1;
}
