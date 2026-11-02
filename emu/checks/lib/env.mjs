// The node side of a check: repository paths, the firmware image and resource block, sha256, the lab env the
// harness modules take (as bin/run.mjs builds it, without tracing: no session, so no Stats or harness digest), and the
// process conventions of a check (an exit with a message, a usage error, an uncaught error).
import { expandImage } from '../../src/fw/expand.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UsageError } from './args.mjs';
import { stackOf } from './errors.mjs';
import { WrongFirmware, checkNand } from '../../src/fw/labfw.mjs';
import { MODEL, MODEL_INFO } from '../../src/fw/model.mjs';
import { romPath, resPath, scpuPath, nandPath } from '../../src/fw/models.mjs';
import { resPrefix } from '../../src/fw/resprefix.mjs';
import { coverageOption } from './coverage.mjs';
import { PatchRefused, readPatchText, applyPatches, patchLayout } from '../../src/fw/patch.mjs';
import { extractSource, decodeExtract } from '../../src/fw/nand.mjs';

export const REPO = path.resolve(new URL('../../../', import.meta.url).pathname);
// the checks' own fixtures: their pinned notes, the VSC register header and class tables, check_perf's P7 address list
// and P10a cases
export const FIXTURES = path.join(REPO, 'emu/checks/fixtures');
// the recorded single-instruction vectors (check_isa, check_perf P1 and test_vectors read them)
export const ISA_VECTORS = path.join(REPO, 'emu/test/fixtures/isa_vectors.json');
// ORIGINAL / PATCHED / BLOCK: absolute paths under REPO.
export const ORIGINAL = path.join(REPO, romPath(MODEL_INFO));
export const PATCHED = path.join(REPO, 'artifacts/nd128/OM1_v1.9_ND128.main-code.bin');
export const ND128_MANIFEST = path.join(REPO, 'artifacts/nd128/manifest.json');
// The ND128 candidate's main code: the original main code block with the patches artifacts/nd128/manifest.json lists,
// applied as a patch overlay (src/fw/patch.mjs: each patch's before bytes must be the original's), the block as
// unpacked (tools/om1_nd128.py writes the same bytes to PATCHED; nothing here reads that file). The caller checks its
// sha256.
export function readPatched() {
  const patches = readPatchText(fs.readFileSync(ND128_MANIFEST, 'utf8'), path.relative(REPO, ND128_MANIFEST));
  return applyPatches({ main: readBytes(ORIGINAL) }, patches, { layout: patchLayout(MODEL_INFO), createHash }).blocks.main;
}
// --patch FILE (bin/play.mjs, bin/nav.mjs, bin/debug.mjs): the patches of the files, in order (src/fw/patch.mjs
// readPatchText; a file that cannot be read is refused as its patches are, PatchRefused).
export function readPatchFiles(files) {
  return files.flatMap((f) => {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { throw new PatchRefused(`${f}: cannot read it (${e.code ?? e.message})`); }
    return readPatchText(text, f);
  });
}
// The run's firmware with a patch overlay: the stock main code block and resource block, each checked against its
// MODELS digest, then the patches applied to copies (src/fw/patch.mjs applyPatches, which refuses a patch whose old
// bytes are not the stock block's, or that overlaps another). {raw (the patched main code block as unpacked), rom (its
// run-time image, src/fw/expand.mjs), resBlock, summary}. Nothing is cached: loadImage and loadBlock stay the stock
// blocks'. resource: false for a tool that loads the main code block alone (bin/debug.mjs): the resource block is not
// read and a patch to it is refused ('the resource block is not loaded here'), not counted as applied.
export function patchedFirmware(patches, { resource = true } = {}) {
  const blocks = { main: checkImage(readBytes(ORIGINAL)), ...(resource ? { resource: loadBlock() } : {}) };
  const r = applyPatches(blocks, patches, { layout: patchLayout(MODEL_INFO), createHash });
  return { raw: r.blocks.main, rom: expandImage(r.blocks.main), resBlock: r.blocks.resource, summary: r.summary };
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
// The NAND the play bring-up loads the resource tables from (env.nand; src/lab/resnand.mjs H-RESINIT, S-RESNAND), on a
// body whose MODELS entry gives res_nand (else null): the model's NAND extract in unpacked/<code> (src/fw/models.mjs
// nandPath), which provisioning makes from the .BIN (host/firmware.mjs; the browser's, src/fw/labfw.mjs labNand: the
// blocks' heads and tails, their indexes and the records of at most 64 KiB), checked against MODELS
// res_nand.extract_sha256; a missing or different file throws. A read outside the extract stops the session.
let nand;
export const NAND = nandPath(MODEL_INFO) && path.join(REPO, nandPath(MODEL_INFO));
export function loadNand() {
  if (nand !== undefined) return nand;
  if (!NAND) return (nand = null);
  if (!fs.existsSync(NAND)) throw new Error(`${NAND}: no NAND extract, which the play bring-up reads the resource tables from (src/lab/resnand.mjs): node emu/bin/fetch-fw.mjs --model ${MODEL} makes it from the .BIN (downloading the .BIN when it is not in fw/)`);
  const b = readBytes(NAND);
  try { checkNand(sha256(b)); } catch (e) { throw new Error(`${NAND}: ${e.message}`); }
  return (nand = extractSource(decodeExtract(b)));
}
// The sub-CPU's own image for OM_EMU_SCPU=native (src/lab/scpum4.mjs; src/fw/models.mjs scpu_lle): the body's SCPU
// block from unpacked/<code>, refused when it is not the one scpu_lle pins; null on a body without one (its lab keeps
// S-SCPUDEV). bin/fetch-fw.mjs makes only the main and resource blocks; a full unpack makes this one (BLOBS.md).
let scpuImage;
export function loadScpuImage() {
  if (scpuImage !== undefined) return scpuImage;
  const lle = MODEL_INFO.scpu_lle;
  if (!lle) return (scpuImage = null);
  const file = path.join(REPO, scpuPath(MODEL_INFO));
  if (!fs.existsSync(file)) throw new Error(`${file}: no SCPU block (bin/fetch-fw.mjs unpacks the main and resource blocks only; every block: BLOBS.md, tools/olyfw.py --dump)`);
  const b = readBytes(file), h = sha256(b);
  if (h !== lle.sha256) throw new Error(`${file}: sha256 ${h.slice(0, 16)}..., src/fw/models.mjs scpu_lle pins ${lle.sha256.slice(0, 16)}...`);
  return (scpuImage = b);
}
// A lab env's sub-CPU: with OM_EMU_SCPU=native, on a body that gives scpu_lle, its own firmware (env.scpu, scpuImage)
export const scpuEnv = () => (process.env.OM_EMU_SCPU === 'native' && MODEL_INFO.scpu_lle ? { scpu: 'native', scpuImage: loadScpuImage() } : {});

// The env of src/lab (HLE, OsdLab, Simulator): the image, sha256, and no session (beginSession absent) unless a tracer
// installed one with traceLabs (bin/checktrace.mjs: beginSession(lab), slice), so every lab a check creates is traced.
let TRACE = null;
export function traceLabs(fields) { TRACE = fields; }
// A check's session function returned a value (check_menu's run_lab and g2_session, check_nav's
// run_script, run_long_wait and run_language): bin/checktrace.mjs appends it as a 'result' event to the current lab's
// trace; nothing happens unless a tracer installed onResult.
export function resultHook(fn, value) { if (TRACE && TRACE.onResult) TRACE.onResult(fn, value); }
// extra.machine adds to the run's machine options (envMachine()); extra.rom replaces the run-time image. With
// OM_EMU_SCPU=native the sub-CPU's image too (scpuEnv).
export function labEnv(extra = {}) {
  const { machine = {}, ...rest } = extra;
  return { createHash, ...(TRACE ?? {}), ...scpuEnv(), ...rest, rom: rest.rom ?? loadImage(), machine: { ...envMachine(), ...machine } };
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
