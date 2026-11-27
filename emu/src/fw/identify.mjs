// What a firmware file is, answered and never thrown: a vendor .BIN container or a main code block as unpacked,
// against the bodies of src/fw/models.mjs MODELS (it imports MODELS only, not src/fw/model.mjs: it answers for every
// body, whatever the run's model). The gates that refuse a file (src/fw/labfw.mjs, the browser player's and
// bin/fetch-fw.mjs's; checks/lib/env.mjs readMainFile, the node tools' --main) say what it is with this.
//
//   identifyBytes(u8, createHash)              a file held whole
//   identifyFirmware(read, size, createHash)   a reader, read(offset, length) -> Uint8Array | Promise (File.slice)
//   -> { status, kind, model, version, head, blocks, candidates, rom_sha256, checksum_ok, reason, main }
// (a last argument, models, replaces MODELS: the units' made-up bodies)
//
// status 'stock'          the main code block's sha256 is a MODELS body's rom_sha256; of a container, its head also
//                         names that body and its release's version, its blocks lie where the release's do and none
//                         is cut; the bodies of a container's other blocks (the resource block's) are not read, so a
//                         change there is not seen (the reason says so)
//        'other-version'  a container whose main block's head names a MODELS body with another version field, and
//                         whose block is no MODELS body's (another release, or a modified one with the field rewritten:
//                         the head does not tell them apart, so neither is taken)
//        'modified'       a container whose head names a MODELS body and its release's version, the main block at the
//                         release's place and length (and the resource block's head where the release has it, no block
//                         cut), with another sha256; a container laid out so whose main block is that body's stock
//                         block under another version field (the release rebuilt with the field rewritten, as
//                         E-M1-Miii's builder writes its test builds' numbers); or a bare block of the length of one or
//                         more bodies' main code block whose sha256 is none of theirs
//        'unknown'        anything else
// kind 'container' | 'block' | null; model: the body's code ('stock': the digest's; else the head's; a bare modified
// block: the one candidate, or null when several bodies share the length); version: that body's MODELS version;
// head: the container's main block head {model, ver, len, flags, off} or null; blocks: the number of blocks a
// container's walk found (0 for a bare block); candidates: the bodies a bare modified block could be of; rom_sha256: the main block's, where it was read; checksum_ok: a container's main block checksum
// (null for a bare block); reason: what the file is, a noun phrase for a message; main: a container's main code
// block, descrambled, where it was read (the caller's to patch against, --main).
//
// The rules and their evidence:
// - a container's body is its main block head's model field, not a length: E143, E146 and E147 share the main
//   block's length, as do E118, E120 and E122 and three more groups (MODELS rom_len), so a length names no body.
//   The head's model field is the body code's three digits and a zero, its version field the four digits of the
//   .BIN's name read as hex (OLY_E_<body>_<version>_...): X, the 19 MODELS bodies' .BINs (test_identify.mjs
//   identifyFiles, firmware-optional);
// - a main code block is a body's exactly when its sha256 is that body's rom_sha256;
// - a bare block has no head: one of a shared length with an unknown digest is 'modified' with every body of that
//   length as a candidate. That it is one of theirs is not shown (another program's block of that length would
//   answer the same), so a caller that patches against a stock block (mainPatches) still compares bytes.
// Worker-safe: no node API; the hash comes in as an argument.
import { walk, walkBytes, decodeBlock, TYPES } from './olyfw.mjs';
import { patchLayout } from './patch.mjs';
import { MODELS } from './models.mjs';

const MAIN_FLAGS = 0x0100, RES_FLAGS = 0x0101;
const hex = (v, n) => v.toString(16).padStart(n, '0');
const list = (codes) => codes.map((c) => `${c}'s`).join(codes.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');

// The body whose stock main code block has this sha256, or null
export const bodyOfDigest = (sha256, models = MODELS) => Object.keys(models).find((k) => models[k].rom_sha256 === sha256) ?? null;
// A body's release as its container's main block head names it: {model, ver} (the rule above)
export function releaseHead(code, models = MODELS) {
  const m = /^OLY_E_(\d{3})_([0-9A-F]{4})_/.exec(models[code].bin);
  if (!m || `E${m[1]}` !== code) throw new Error(`releaseHead: ${code}'s .BIN name ${models[code].bin} does not name the body and a version`);
  return { model: `${m[1]}0`, ver: parseInt(m[2], 16) };
}
// The body a head's model field names, or null
export const bodyOfHead = (model, models = MODELS) => Object.keys(models).find((k) => releaseHead(k, models).model === model) ?? null;

const answer = (status, kind, reason, more = {}) => ({ status, kind, model: null, version: null, head: null, blocks: 0, candidates: [], rom_sha256: null, checksum_ok: null, main: null, ...more, reason });

// A container from its walked blocks: null when its main block is to be read (then classifyMain), else the answer
function containerShape(blocks, MODELS) {
  const mains = blocks.filter((b) => b.typ === 'OE' && b.flags === MAIN_FLAGS);
  if (mains.length !== 1) return answer('unknown', 'container', `a container of ${blocks.length} block(s) with ${mains.length} main code blocks (OE, flags 0x${hex(MAIN_FLAGS, 4)}), not one`, { blocks: blocks.length });
  const b = mains[0], head = { model: b.model, ver: b.ver, len: b.len, flags: b.flags, off: b.off };
  if (b.error) return answer('unknown', 'container', `a container cut inside its main code block (${b.error}: the head gives ${b.len} bytes)`, { head, blocks: blocks.length, model: bodyOfHead(b.model, MODELS) });
  return null;
}
function classifyMain(blocks, b, r, sha256, MODELS) {
  const label = (code) => `${code} (${MODELS[code].name})`;
  const head = { model: b.model, ver: b.ver, len: b.len, flags: b.flags, off: b.off };
  const named = bodyOfHead(b.model, MODELS), owner = bodyOfDigest(sha256, MODELS);
  const cks = r.cksum_ok ? '' : `; its main block's checksum total is 0x${hex(r.cksum_tot, 8)}, not 0`;
  const base = { head, blocks: blocks.length, rom_sha256: sha256, checksum_ok: r.cksum_ok, main: r.data };
  const headText = `model field ${b.model}, version field 0x${hex(b.ver, 4)}`;
  // the release's block placement (the main code block at 0 with the release's length, the resource block's head
  // where the release has it) and a walk that reached the file's end: what a 'stock' or 'modified' container needs
  // besides its head, or the reason it is 'unknown'
  const notRelease = (M) => {
    const cut = blocks.find((x) => x.error);
    if (cut) return { cut: `a container cut inside its block at 0x${hex(cut.off, 8)} (${cut.error}: the head gives ${cut.len} bytes)` };
    const resOff = patchLayout(M).resource.off;
    if (b.off === 0 && b.len === M.rom_len && blocks.some((x) => x.typ === 'OE' && x.flags === RES_FLAGS && x.off === resOff)) return null;
    return { placed: `the main code block at 0x${hex(b.off, 8)}, ${b.len} bytes; the release's at 0, ${M.rom_len} bytes, the resource block at 0x${hex(resOff, 8)}` };
  };
  if (owner !== null) {
    const rel = releaseHead(owner, MODELS);
    if (named === owner && b.ver === rel.ver) {
      const not = notRelease(MODELS[owner]);
      if (not) return answer('unknown', 'container', `${not.cut ?? `a container whose blocks are not the release's (${not.placed})`}; its head and main code block are ${label(owner)}'s v${MODELS[owner].version} release's${cks}`, { ...base, model: owner });
      return answer('stock', 'container', `a container with ${label(owner)}'s v${MODELS[owner].version} release head and stock main code block (${MODELS[owner].bin}); the bodies of its ${blocks.length - 1} other block(s) are not read${cks}`,
        { ...base, model: owner, version: MODELS[owner].version });
    }
    // the release's main code block, in its place, under another version field: the release's container rebuilt with
    // the field rewritten (E-M1-Miii's builder writes a test build's number there, head and tail), so 'modified'
    if (named === owner && !notRelease(MODELS[owner])) {
      return answer('modified', 'container', `a container of ${label(owner)} v${MODELS[owner].version} whose only change to the main code block is its version field 0x${hex(b.ver, 4)} (the release's 0x${hex(rel.ver, 4)}; the stock main code block, in the release's place): modified firmware${cks}`,
        { ...base, model: owner, version: MODELS[owner].version });
    }
    return answer('unknown', 'container', `a container whose head (${headText}) is not the release's around ${label(owner)}'s v${MODELS[owner].version} stock main code block${cks}`, { ...base, model: named });
  }
  if (named === null) return answer('unknown', 'container', `a container of a body MODELS does not hold (${headText})${cks}`, base);
  const M = MODELS[named], rel = releaseHead(named, MODELS);
  if (b.ver !== rel.ver) {
    return answer('other-version', 'container', `a container of ${label(named)} at version field 0x${hex(b.ver, 4)}, not the 0x${hex(rel.ver, 4)} of the v${M.version} release MODELS holds${cks}`,
      { ...base, model: named, version: M.version });
  }
  const not = notRelease(M);
  if (not) {
    return answer('unknown', 'container', `${not.cut ? `${not.cut}; its head names ${label(named)} v${M.version}` : `a container whose head names ${label(named)} v${M.version} but whose blocks are not the release's (${not.placed})`}${cks}`,
      { ...base, model: named });
  }
  return answer('modified', 'container', `a container of ${label(named)} v${M.version} with another main code block (the release's place and length, sha256 ${sha256.slice(0, 16)}..., the release's ${M.rom_sha256.slice(0, 16)}...): modified firmware${cks}`,
    { ...base, model: named, version: M.version });
}
const lengthBodies = (size, MODELS) => Object.keys(MODELS).filter((k) => MODELS[k].rom_len === size);
const noBlock = (size) => answer('unknown', null, `${size} bytes that start with no container head (${TYPES.join(', ')}) and are not the length of a main code block MODELS holds`);
function classifyBlock(size, sha256, candidates, MODELS) {
  const owner = bodyOfDigest(sha256, MODELS);
  if (owner !== null) return answer('stock', 'block', `${owner} (${MODELS[owner].name})'s v${MODELS[owner].version} main code block as unpacked`, { model: owner, version: MODELS[owner].version, rom_sha256: sha256 });
  const one = candidates.length === 1 ? candidates[0] : null;
  return answer('modified', 'block', `a block of the length of ${list(candidates)} main code block (${size} bytes) whose sha256 (${sha256.slice(0, 16)}...) is ${one ? 'not its' : 'none of theirs'}: ` +
    `a modified main code block${one ? '' : ' of one of them'}, as far as a bare block shows (it names no body)`, { model: one, version: one ? MODELS[one].version : null, candidates, rom_sha256: sha256 });
}
const isHead = (u8) => u8.length >= 2 && TYPES.includes(String.fromCharCode(u8[0], u8[1]));
const failed = (e) => answer('unknown', null, `a file that could not be read (${e?.message ?? e})`);

export function identifyBytes(u8, createHash, models = MODELS) {
  try {
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    if (isHead(u8)) {
      const { blocks } = walkBytes(u8), shape = containerShape(blocks, models);
      if (shape) return shape;
      const b = blocks.find((x) => x.typ === 'OE' && x.flags === MAIN_FLAGS), r = decodeBlock(u8.subarray(b.off, b.off + 64 + b.len), b);
      return classifyMain(blocks, b, r, sha(r.data), models);
    }
    const candidates = lengthBodies(u8.length, models);
    return candidates.length ? classifyBlock(u8.length, sha(u8), candidates, models) : noBlock(u8.length);
  } catch (e) { return failed(e); }
}
export async function identifyFirmware(read, size, createHash, models = MODELS) {
  try {
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    if (size >= 2 && isHead(await read(0, 2))) {
      const { blocks } = await walk(read, size), shape = containerShape(blocks, models);
      if (shape) return shape;
      const b = blocks.find((x) => x.typ === 'OE' && x.flags === MAIN_FLAGS), r = decodeBlock(await read(b.off, 64 + b.len), b);
      return classifyMain(blocks, b, r, sha(r.data), models);
    }
    const candidates = lengthBodies(size, models);
    return candidates.length ? classifyBlock(size, sha(await read(0, size)), candidates, models) : noBlock(size);
  } catch (e) { return failed(e); }
}
