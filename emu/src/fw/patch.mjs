// Patch overlays: byte patches from an external JSON file, verified against the stock blocks the lab loads and
// applied to copies of them in memory before a run (bin/play.mjs, bin/nav.mjs and bin/debug.mjs --patch FILE, the
// browser player's Patch start option; emu/README.md "Patch overlays"). Nothing is written to disk.
//
// A patch file is JSON: a list of patches, or an object whose `patches` is one. A patch is either
//   {block, offset, old, new, label?}         old and new base64 (RFC 4648, padded), as azqeurio/om-c-firmware's
//                                             templates give them; block a container index (0 the main code block,
//                                             1 the resource block where it follows the main block, as on every body
//                                             of MODELS) or a name: 'main', 'resource', or a block file's name
//                                             holding its blk<offset> ('blk00000000', 'blk02000000.OE.0101.bin', the
//                                             unpacked file's whole name); offset an integer, or a "0x..." string
//   {decoded_body_offset, before, after}      artifacts/nd128/manifest.json's patches: the main code block, the offset
//                                             a "0x..." string, the bytes hex
// The offset is into the block's body as unpacked (unpacked/<code>/, src/fw/olyfw.mjs), before src/fw/expand.mjs.
// Or the file is one object of digest-anchored runs, caduceus-om3's release patch.json (its firmware/patch.py reads
// it, tools/mkpatch.py writes it), format 'om3-patch-1' or 'om3-patch-2':
//   {format, main_base, main_sha256_before, main_sha256_after, runs: [[address, hex], ...], ...}
// each run the new bytes at a run-time address of the main code block (offset = address - main_base; main_base must
// be the model's image base). A run carries no old bytes: the anchor is the digest instead, so applyPatches takes the
// stock block's bytes as the old ones only once main_sha256_before is the stock block's sha256, and keeps the result
// only when the patched block's sha256 is main_sha256_after (so such a file is the whole change to the main block:
// another file's patch to it is refused). Its other fields: name, version, description, stock_file, stock_sha256,
// stock_size, result_sha256 and changed_bytes describe the release and are not read; om3-patch-2's frames (white
// Frame Art layers in a container component past the two the lab loads: 2, E147's blk05a00000) and card_files (files
// the release puts on the card, which are not in this file) are not applied and are listed in the summary's
// not_applied; a field of neither kind is refused.
// Or the file is one object of edits with stock bytes, caduceus-ep7's release edits.json (cakelesscoder/caduceus-ep7,
// Apache-2.0; their caduceus.py apply_edits reads it, for the E-P7 (E142) 1.1):
//   {components: ["0x100", "0x101", ...], edits: [{kind, addr, expect, new, why?, source?}, ...], ...}
// kind the container component an edit targets, as its block head's type (u16 at +20, the .OE.<type>. of an unpacked
// block's name: 0x100 the main code block, 0x101 E142's resource block, its OSD data); addr a run-time address of the
// main code block (offset = addr - the model's image base, read at apply time) or "off:0x..." (an offset into the
// component's body, any component); expect the stock bytes there and new the bytes put, hex of one non-zero length.
// Every edit's kind must be among components (as their apply_edits). The file's other top-level fields (their
// builder's record: sources, meta, labels, symbols, per-feature tables) are not read; an edit field besides the six is
// refused. The expect bytes are the patch's old bytes, so every one is checked against the stock block as any patch's.
// Or the file is an E-M1 III Mod Builder pack, dfeldt91-blip/E-M1-Miii's builder/mods.json (format 1; E139 1.6, the
// release the lab runs as E139; the repository has no LICENSE: only its format is read here, no byte of it is kept):
//   {format: 1, firmware: {name, sha256, size}, mods: [{id, title, description, camera, requires, stock_sha256,
//    edits: [[block, "0x<address>", hex], ...], generator?, options?}, ...]}
// a pack holds many mods and a run takes the ones named (readPatchText's mods; FILE#id,id on the node tools, checks/
// lib/env.mjs readPatchFiles): every mod a requires names must be named too; a generator mod (its bytes made by the
// builder's Python at build time, not in the file) is refused. A block 0 edit's address is a run-time address in the
// image with the main block's olycompress containers decoded in place (src/fw/expand.mjs expandBlobs; offset =
// address - the image base), so its patch targets that image (image: true) and applyPatches needs the caller's
// expand; a block 1 edit is an offset into the resource block. An edit carries no old bytes: the anchor is the mod's
// stock_sha256, the sha256 of the stock bytes under its edits in their order (block 0's from the expanded image), which
// applyPatches checks before it takes those bytes as the old ones; firmware.name must be the model's .BIN (its sha256
// is the whole .BIN's, which the lab does not hold: not read).
// applyPatches refuses (PatchRefused) unless every patch is well formed, old and new have one non-zero length, the
// range lies inside the part of its block the lab loads (the whole main code block; the resource block's prefix,
// src/fw/resprefix.mjs, MODEL_INFO.res_len), no two patches of a block overlap (across files too), and every old
// matches the stock block's bytes there. The caller verifies the stock blocks first (their MODELS digests); the result
// carries a summary for the player's status and the logs: the files, the count, the bytes changed, and per patched
// block its sha256 after the patches; and the main block's changed bytes as ranges (the lab's patch rules, src/lab/
// patchaudit.mjs). mainPatches makes the patches of a whole patched main code block (--main FILE): its runs of bytes
// that differ from the stock block's; mainFilePatches takes that block from a .BIN container too, with the runs of its
// resource block's prefix that differ from the stock one's.
// Worker-safe: no node API; the hash comes in as an argument.
import { base64Bytes, hexBytes } from '../util/bytes.mjs';
import { walkBytes, decodeBlock } from './olyfw.mjs';

export class PatchRefused extends Error { get name() { return 'PatchRefused'; } }

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const BLK = /blk([0-9a-f]{8})/i;

// The blocks a patch may target on a model (src/fw/models.mjs entry): key, file name, container offset and the length
// the lab loads of it; the main block's base, the run-time address of its byte 0 (image_base).
export function patchLayout(info) {
  const resOff = parseInt(BLK.exec(info.res_block)[1], 16);
  return {
    main: { key: 'main', name: 'blk00000000.OE.0100.bin', off: 0, len: info.rom_len, base: info.image_base, bin: info.bin },
    resource: { key: 'resource', name: info.res_block, off: resOff, len: info.res_len },
  };
}

// 'main' or 'resource' for a patch's block field, or throws PatchRefused.
export function resolveBlock(ref, layout) {
  if (Number.isInteger(ref)) {
    if (ref === 0) return 'main';
    // the container's blocks follow each other (src/fw/olyfw.mjs walk: head 32, body, tail 32), so block 1 is the
    // resource block exactly when it starts where the main block ends
    if (ref === 1 && layout.resource.off === layout.main.off + layout.main.len + 64) return 'resource';
    throw new PatchRefused(`block ${ref}: the lab loads only the main code block (block 0) and the resource block (${layout.resource.name})`);
  }
  if (typeof ref === 'string') {
    if (ref === 'main' || ref === 'resource') return ref;
    // a container component by its head's type (edits.json's kind): the .OE.<type>. of the block's file name
    const c = /^component 0x([0-9a-f]{4})$/i.exec(ref);
    if (c) {
      for (const b of Object.values(layout)) if (new RegExp(`\\.OE\\.${c[1]}\\.`, 'i').test(b.name)) return b.key;
      throw new PatchRefused(`component 0x${c[1]}: not a block the lab loads (${layout.main.name}, ${layout.resource.name})`);
    }
    const m = BLK.exec(ref);
    if (m) {
      const off = parseInt(m[1], 16);
      for (const b of Object.values(layout)) if (b.off === off) return b.key;
      throw new PatchRefused(`block ${JSON.stringify(ref)}: not a block the lab loads (${layout.main.name}, ${layout.resource.name})`);
    }
  }
  throw new PatchRefused(`block ${JSON.stringify(ref)}: an index (0, 1) or a name (main, resource, blk<offset>...)`);
}

function offsetOf(v, where) {
  if (Number.isSafeInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
  throw new PatchRefused(`${where}: offset ${JSON.stringify(v)}: a non-negative integer or "0x..."`);
}
function base64Of(v, key, where) {
  const b = base64Bytes(v);
  if (b === null) throw new PatchRefused(`${where}: ${key} is not base64`);
  return b;
}
function hexOf(v, key, where) {
  if (typeof v !== 'string' || !/^([0-9a-f]{2})*$/i.test(v)) throw new PatchRefused(`${where}: ${key} is not hex`);
  return hexBytes(v);
}

// The digest-anchored formats (caduceus-om3 releases): format -> the fields a file may have besides the anchor's
// (format, main_base, main_sha256_before, main_sha256_after, runs). DESCRIBE: about the release, not read;
// NOT_APPLIED: content the lab does not apply, with the reason the summary gives. om3-patch-1 (their v0.16..v0.19)
// has no frames or card_files; om3-patch-2 (v0.20 on) adds both (tools/mkpatch.py writes them every time)
const DESCRIBE = ['name', 'version', 'description', 'stock_file', 'stock_sha256', 'stock_size', 'result_sha256', 'changed_bytes'];
// field -> (its value, where) the reason it is not applied ('' when it holds nothing to apply), or throws PatchRefused
const NOT_APPLIED = {
  frames: (v, where) => {
    // the lab loads blocks 0 and 1 only (resolveBlock); mkpatch.py writes component 2, E147's blk05a00000
    if (!v || typeof v !== 'object' || !Number.isInteger(v.component) || v.component < 2) throw new PatchRefused(`${where}: frames: not {component: 2 or later, ...}`);
    return `white Frame Art layers in container component ${v.component}, a block the lab does not load`;
  },
  card_files: (v, where) => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new PatchRefused(`${where}: card_files: not a list of file names`);
    return v.length ? `${v.join(', ')}: files for the card, not in this file` : '';
  },
};
const ANCHORED = { 'om3-patch-1': DESCRIBE, 'om3-patch-2': [...DESCRIBE, ...Object.keys(NOT_APPLIED)] };
const SHA = /^[0-9a-f]{64}$/;

// A digest-anchored file's runs as patches (old null: the stock block's, taken by applyPatches), each with the file's
// anchor {source, format, main_base, before, after, not_applied}.
function readAnchored(doc, source) {
  // (the file's format is looked up as an own key of a string: 'constructor' or ['om3-patch-2'] is no format)
  const keys = typeof doc.format === 'string' && Object.hasOwn(ANCHORED, doc.format) ? ANCHORED[doc.format] : null;
  if (!keys) throw new PatchRefused(`${source}: format ${JSON.stringify(doc.format)}: not one this reader knows (${Object.keys(ANCHORED).join(', ')})`);
  for (const k of Object.keys(doc)) {
    if (!['format', 'main_base', 'main_sha256_before', 'main_sha256_after', 'runs', ...keys].includes(k)) {
      throw new PatchRefused(`${source}: ${doc.format} field ${JSON.stringify(k)}: not one this reader knows, refused rather than left out`);
    }
  }
  for (const k of ['main_base', 'main_sha256_before', 'main_sha256_after', 'runs']) if (!(k in doc)) throw new PatchRefused(`${source}: no ${k}`);
  const base = offsetOf(doc.main_base, `${source} main_base`);
  for (const k of ['main_sha256_before', 'main_sha256_after']) if (typeof doc[k] !== 'string' || !SHA.test(doc[k])) throw new PatchRefused(`${source}: ${k} is not a sha256 (64 hex digits, lower case)`);
  if (!Array.isArray(doc.runs) || !doc.runs.length) throw new PatchRefused(`${source}: runs is not a list of runs`);
  const not_applied = Object.keys(NOT_APPLIED).filter((k) => k in doc).map((field) => ({ file: source, field, why: NOT_APPLIED[field](doc[field], source) }))
    .filter((x) => x.why);
  const anchor = { source, format: doc.format, main_base: base, before: doc.main_sha256_before, after: doc.main_sha256_after, not_applied };
  return doc.runs.map((run, n) => {
    const where = `${source} run ${n}`;
    if (!Array.isArray(run) || run.length !== 2) throw new PatchRefused(`${where}: not [address, hex]`);
    const at = offsetOf(run[0], where), b = hexOf(run[1], 'its bytes', where);
    if (at < base) throw new PatchRefused(`${where}: address ${hex8(at)} lies below main_base ${hex8(base)}`);
    if (!b.length) throw new PatchRefused(`${where}: no bytes`);
    return { source, n, label: `run ${hex8(at)}`, block: 'main', offset: at - base, old: null, new: b, anchor };
  });
}

// caduceus-ep7's edits.json as patches: block 'component 0x...' (resolveBlock maps it to the block of that type), and
// for a run-time address addr in place of an offset (offset null: applyPatches takes it from the model's image base).
const EDIT_KEYS = ['kind', 'addr', 'expect', 'new', 'why', 'source'];
const COMPONENT = /^0x[0-9a-f]{1,4}$/i;
function readEdits(doc, source) {
  const comps = doc.components;
  if (!Array.isArray(comps) || !comps.length || !comps.every((c) => typeof c === 'string' && COMPONENT.test(c))) throw new PatchRefused(`${source}: components is not a list of component types ("0x100", ...)`);
  const kinds = comps.map((c) => parseInt(c, 16));
  if (new Set(kinds).size !== kinds.length) throw new PatchRefused(`${source}: components names a type twice`);
  if (!doc.edits.length) throw new PatchRefused(`${source}: no edits`);
  return doc.edits.map((e, n) => {
    const where = `${source} edit ${n}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new PatchRefused(`${where}: not an object`);
    for (const k of Object.keys(e)) if (!EDIT_KEYS.includes(k)) throw new PatchRefused(`${where}: field ${JSON.stringify(k)}: not one this reader knows, refused rather than left out`);
    for (const k of ['kind', 'addr', 'expect', 'new']) if (!(k in e)) throw new PatchRefused(`${where}: no ${k}`);
    if (typeof e.kind !== 'string' || !COMPONENT.test(e.kind)) throw new PatchRefused(`${where}: kind ${JSON.stringify(e.kind)} is not a component type ("0x100", ...)`);
    const kind = parseInt(e.kind, 16);
    if (!kinds.includes(kind)) throw new PatchRefused(`${where}: kind ${e.kind} is not among the file's components (${comps.join(', ')})`);
    if (e.why !== undefined && typeof e.why !== 'string') throw new PatchRefused(`${where}: why is not a string`);
    const old = hexOf(e.expect, 'expect', where), nw = hexOf(e.new, 'new', where);
    if (!old.length || old.length !== nw.length) throw new PatchRefused(`${where}: expect has ${old.length} bytes, new ${nw.length} (one non-zero length)`);
    const block = `component ${hex4(kind)}`;
    if (typeof e.addr === 'string' && e.addr.startsWith('off:')) {
      return { source, n, unit: 'edit', label: `${block} ${e.addr}`, block, offset: offsetOf(e.addr.slice(4), where), old, new: nw, why: e.why ?? null };
    }
    // a run-time address: of the main code block only (their apply_edits: 'CPU address on a non-main component')
    if (kind !== 0x100) throw new PatchRefused(`${where}: addr ${JSON.stringify(e.addr)}: a run-time address on component ${e.kind}, not the main code block (0x100); "off:0x..." there`);
    const addr = offsetOf(e.addr, where);
    return { source, n, unit: 'edit', label: hex8(addr), block, offset: null, addr, old, new: nw, why: e.why ?? null };
  });
}
const hex4 = (v) => '0x' + v.toString(16).padStart(4, '0');

const MOD_KEYS = ['id', 'title', 'description', 'camera', 'requires', 'stock_sha256', 'edits', 'generator', 'options'];

// An E-M1-Miii mods.json pack's named mods as patches (old null: the stock bytes, taken by applyPatches once the
// mod's stock_sha256 is theirs), each with its mod {source, id, stock_sha256, firmware, edits}. mods: the ids to take.
function readMods(doc, source, mods) {
  for (const k of Object.keys(doc)) if (!['format', 'firmware', 'mods'].includes(k)) throw new PatchRefused(`${source}: mods.json field ${JSON.stringify(k)}: not one this reader knows, refused rather than left out`);
  const fw = doc.firmware;
  if (!fw || typeof fw !== 'object' || typeof fw.name !== 'string') throw new PatchRefused(`${source}: mods.json firmware is not {name, sha256, size}`);
  if (!Array.isArray(doc.mods) || !doc.mods.length) throw new PatchRefused(`${source}: mods.json mods is not a list of mods`);
  const byId = new Map();
  for (const [n, m] of doc.mods.entries()) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id) throw new PatchRefused(`${source} mod ${n}: no id`);
    for (const k of Object.keys(m)) if (!MOD_KEYS.includes(k)) throw new PatchRefused(`${source} mod ${m.id}: field ${JSON.stringify(k)}: not one this reader knows, refused rather than left out`);
    if (byId.has(m.id)) throw new PatchRefused(`${source}: mod ${m.id} twice`);
    byId.set(m.id, m);
  }
  const ids = [...byId.keys()];
  if (!mods || !mods.length) throw new PatchRefused(`${source}: a mods.json pack: name the mods to apply (FILE#id,id...; its mods: ${ids.join(', ')})`);
  for (const id of mods) if (!byId.has(id)) throw new PatchRefused(`${source}: no mod ${JSON.stringify(id)} (its mods: ${ids.join(', ')})`);
  if (new Set(mods).size !== mods.length) throw new PatchRefused(`${source}: a mod named twice (${mods.join(', ')})`);
  return mods.flatMap((id) => {
    const m = byId.get(id), where = `${source} mod ${id}`;
    if (!Array.isArray(m.requires ?? []) || !(m.requires ?? []).every((r) => typeof r === 'string')) throw new PatchRefused(`${where}: requires is not a list of ids`);
    const missing = (m.requires ?? []).filter((r) => !mods.includes(r));
    if (missing.length) throw new PatchRefused(`${where}: it requires ${missing.join(', ')}, not named`);
    if (m.generator) throw new PatchRefused(`${where}: a generated mod (generator ${JSON.stringify(m.generator)}): its bytes are made by the builder at build time and are not in the file`);
    if (!Array.isArray(m.edits) || !m.edits.length) throw new PatchRefused(`${where}: no edits`);
    if (typeof m.stock_sha256 !== 'string' || !SHA.test(m.stock_sha256)) throw new PatchRefused(`${where}: stock_sha256 is not a sha256 (64 hex digits, lower case)`);
    const mod = { source, id, stock_sha256: m.stock_sha256, firmware: fw.name, edits: m.edits.length };
    return m.edits.map((e, n) => {
      const w = `${where} edit ${n}`;
      if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || e[0] < 0) throw new PatchRefused(`${w}: not [block, "0x<address>", hex]`);
      const at = offsetOf(e[1], w), b = hexOf(e[2], 'its bytes', w);
      if (!b.length) throw new PatchRefused(`${w}: no bytes`);
      const label = `${id} edit ${n}`;
      return e[0] === 0 ? { source, n, label, block: 0, image: true, address: at, offset: null, old: null, new: b, mod }
        : { source, n, label, block: e[0], offset: at, old: null, new: b, mod };
    });
  });
}

// A patch file's text as patches: [{source, n, label, block (as given), offset, old, new, anchor?, addr?, why?, mod?}],
// or throws PatchRefused. source names the file in the messages. A digest-anchored file's patches have old null and
// its anchor; an edits.json edit at a run-time address has offset null and its addr; a mods.json pack's (mods: the ids
// of the mods to take) old null and their mod.
export function readPatchText(text, source, { mods = null } = {}) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new PatchRefused(`${source}: not JSON (${e.message})`); }
  const obj = doc && typeof doc === 'object' && !Array.isArray(doc);
  if (obj && doc.format === 1 && 'mods' in doc) return readMods(doc, source, mods);
  if (mods?.length) throw new PatchRefused(`${source}: mods named (${mods.join(', ')}), but not a mods.json pack`);
  if (obj && Array.isArray(doc.edits) && 'components' in doc && !('patches' in doc)) return readEdits(doc, source);
  if (obj && 'format' in doc && !('patches' in doc)) return readAnchored(doc, source);
  const list = Array.isArray(doc) ? doc : doc && typeof doc === 'object' && Array.isArray(doc.patches) ? doc.patches : null;
  if (list === null) throw new PatchRefused(`${source}: a list of patches, or an object with a "patches" list`);
  if (!list.length) throw new PatchRefused(`${source}: no patches`);
  return list.map((p, n) => {
    const where = `${source} patch ${n}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new PatchRefused(`${where}: not an object`);
    if (p.label !== undefined && typeof p.label !== 'string') throw new PatchRefused(`${where}: label is not a string`);
    let r;
    if ('old' in p || 'new' in p) {
      for (const k of ['block', 'offset', 'old', 'new']) if (!(k in p)) throw new PatchRefused(`${where}: no ${k}`);
      r = { block: p.block, offset: offsetOf(p.offset, where), old: base64Of(p.old, 'old', where), new: base64Of(p.new, 'new', where) };
    } else if ('before' in p || 'after' in p) {
      for (const k of ['decoded_body_offset', 'before', 'after']) if (!(k in p)) throw new PatchRefused(`${where}: no ${k}`);
      r = { block: 'main', offset: offsetOf(p.decoded_body_offset, where), old: hexOf(p.before, 'before', where), new: hexOf(p.after, 'after', where) };
    } else throw new PatchRefused(`${where}: neither {block, offset, old, new} nor {decoded_body_offset, before, after}`);
    if (!r.old.length || r.old.length !== r.new.length) throw new PatchRefused(`${where}: old has ${r.old.length} bytes, new ${r.new.length} (one non-zero length)`);
    return { source, n, label: p.label ?? null, ...r };
  });
}

// (an edits.json edit is named as their file numbers it: 'edit N')
const name = (p) => `${p.source} ${p.unit ?? 'patch'} ${p.n}${p.label ? ` (${p.label})` : ''}`;

// Applies patches (readPatchText's, of one or more files) to the stock blocks: blocks {main, resource} (Uint8Arrays,
// verified by the caller; the resource block whole or its prefix), layout patchLayout's, files the sources' names;
// expand: src/fw/expand.mjs expandBlobs, which a patch to the run-time image (a mods.json block 0 edit) needs.
// Returns {blocks: {main, resource, image?} (a patched block a new copy, the other the caller's own; image: the main
// block's run-time image with its containers decoded and the image patches applied, present only when one was given,
// the main block then left stock), summary: {files, applied, bytes, blocks: [{block, name, patches, ranges (its count
// of changed runs), sha256, stock_sha256}], mods? ([{file, id, edits}]), not_applied? (a digest-anchored file's
// content the lab does not apply, and a patch's own not_applied list, which every patch of a source shares: [{file,
// field, why}])}, changed: the main block's (or its image's: the offsets are the same, decoding in place) changed
// bytes as sorted [offset, length] ranges, ranges: {main, resource, image} each block's so}, or throws PatchRefused for
// the first patch that fails a rule (a block absent from blocks takes no patch); nothing the caller gave is changed.
// Patches to the main block as stored and to its image do not mix (a change to a container's packed bytes and one to
// the bytes it decodes to are not comparable).
export function applyPatches(blocks, patches, { layout, createHash, expand = null, files = [...new Set(patches.map((p) => p.source))] }) {
  if (!patches.length) throw new PatchRefused('no patches');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const by = { main: [], resource: [], image: [] }, anchors = [...new Set(patches.map((p) => p.anchor).filter(Boolean))];
  const mods = [...new Set(patches.map((p) => p.mod).filter(Boolean))];
  // a digest-anchored file: its base the model's, the stock block the one its runs were made from, and its runs the
  // only patches of the main block
  let stockMain = null;
  for (const an of anchors) {
    if (!blocks.main) throw new PatchRefused(`${an.source}: the main block is not loaded here`);
    if (an.main_base !== layout.main.base) throw new PatchRefused(`${an.source}: main_base ${hex8(an.main_base)} is not this model's image base ${hex8(layout.main.base)}`);
    stockMain ??= sha(blocks.main.subarray(0, layout.main.len));
    if (an.before !== stockMain) {
      throw new PatchRefused(`${an.source}: main_sha256_before ${an.before.slice(0, 16)}... is not the stock main block's (${stockMain.slice(0, 16)}...): its runs carry no old bytes, so they apply only to the block they were made from`);
    }
    const other = patches.find((p) => p.anchor !== an && resolveBlock(p.block, layout) === 'main');
    if (other) throw new PatchRefused(`${an.source}: its runs are the whole change to the main block (main_sha256_after), and ${name(other)} patches it too`);
  }
  // a mods.json pack's mods: made for the model's release
  for (const m of mods) {
    if (layout.main.bin && m.firmware !== layout.main.bin) throw new PatchRefused(`${m.source} mod ${m.id}: made for ${m.firmware}, the lab runs ${layout.main.bin}`);
  }
  // the stock run-time image, when an image patch needs it
  let stockImage = null;
  const image = (p0) => {
    if (stockImage) return stockImage;
    if (!blocks.main) throw new PatchRefused(`${name(p0)}: the main block is not loaded here`);
    if (!expand) throw new PatchRefused(`${name(p0)}: an edit at a run-time address needs the main block's run-time image, not made here`);
    return (stockImage = expand(blocks.main.subarray(0, layout.main.len)));
  };
  const resolved = new Map();
  for (const p0 of patches) {
    const key = p0.image ? 'image' : resolveBlock(p0.block, layout);
    let p = p0;
    if (key === 'image') {
      if (p0.address < layout.main.base) throw new PatchRefused(`${name(p0)}: address ${hex8(p0.address)} lies below the image base ${hex8(layout.main.base)}`);
      p = { ...p0, offset: p0.address - layout.main.base };
    }
    const stock = key === 'image' ? image(p0) : blocks[key];
    if (!stock) throw new PatchRefused(`${name(p0)}: the ${key} block is not loaded here`);
    // an edits.json edit at a run-time address: its offset from the model's image base (the main code block's byte 0)
    if (key !== 'image' && p.offset === null) {
      if (key !== 'main' || p0.addr < layout.main.base) throw new PatchRefused(`${name(p0)}: address ${hex8(p0.addr)} lies below this model's image base ${hex8(layout.main.base)}`);
      p = { ...p, offset: p0.addr - layout.main.base };
    }
    const lim = key === 'image' ? stock.length : Math.min(layout[key].len, stock.length), len = p.old?.length ?? p.new.length;
    if (p.offset + len > lim) {
      const what = { main: 'main code block', image: 'main code block\'s run-time image', resource: 'resource block\'s part the lab reads' }[key];
      throw new PatchRefused(`${name(p)}: ${key === 'image' ? `${hex8(p.address)} (offset ${hex8(p.offset)})` : hex8(p.offset)}+${len} lies outside the ${what} (${lim} bytes)`);
    }
    // a run's or an edit's old bytes: the stock block's (its file's before digest, or its mod's stock_sha256, checked
    // below, is the stock bytes')
    if (p.old === null) p = { ...p, old: stock.slice(p.offset, p.offset + len) };
    resolved.set(p0, p);
    by[key].push(p);
  }
  if (by.main.length && by.image.length) {
    throw new PatchRefused(`${name(by.image[0])} patches the main block's run-time image and ${name(by.main[0])} the block as stored: the two do not mix`);
  }
  for (const m of mods) {
    const h = createHash('sha256');
    for (const p of patches) if (p.mod === m) h.update(resolved.get(p).old);
    const got = h.digest('hex');
    if (got !== m.stock_sha256) {
      throw new PatchRefused(`${m.source} mod ${m.id}: the stock bytes under its ${m.edits} edit(s) have sha256 ${got.slice(0, 16)}..., not its stock_sha256 ${m.stock_sha256.slice(0, 16)}...: not a mod for this model's stock firmware`);
    }
  }
  for (const [key, list] of Object.entries(by)) {
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (a.offset + a.old.length > b.offset) throw new PatchRefused(`${name(a)} (${hex8(a.offset)}+${a.old.length}) and ${name(b)} (${hex8(b.offset)}+${b.old.length}) overlap in the ${key} block`);
    }
    const stock = key === 'image' ? stockImage : blocks[key];
    for (const p of list) {
      for (let k = 0; k < p.old.length; k++) {
        if (stock[p.offset + k] !== p.old[k]) {
          throw new PatchRefused(`${name(p)}: old bytes differ from the stock ${key} block at ${hex8(p.offset + k)} (0x${stock[p.offset + k].toString(16).padStart(2, '0')}, the patch expects 0x${p.old[k].toString(16).padStart(2, '0')}): not a patch for this model's stock block`);
        }
      }
    }
  }
  const out = { ...blocks }, summary = { files, applied: patches.length, bytes: 0, blocks: [] }, ranges = { main: [], resource: [], image: [] };
  for (const [key, list] of Object.entries(by)) {
    if (!list.length) continue;
    const src = key === 'image' ? stockImage : blocks[key], len = key === 'image' ? src.length : layout[key].len;
    const b = src.slice(), stock_sha256 = key === 'main' && stockMain || sha(src.subarray(0, len));
    const changed = ranges[key];
    for (const p of list) {
      for (let k = 0; k < p.new.length; k++) {
        if (b[p.offset + k] === p.new[k]) continue;
        summary.bytes++;
        const last = changed[changed.length - 1], at = p.offset + k;
        if (last && last[0] + last[1] === at) last[1]++; else changed.push([at, 1]);
      }
      b.set(p.new, p.offset);
    }
    out[key] = b;
    const sha256 = sha(b.subarray(0, len));
    for (const an of key === 'main' ? anchors : []) {
      if (sha256 !== an.after) throw new PatchRefused(`${an.source}: the patched main block's sha256 ${sha256.slice(0, 16)}... is not its main_sha256_after ${an.after.slice(0, 16)}...`);
    }
    summary.blocks.push({ block: key, name: key === 'image' ? `${layout.main.name} run-time image` : layout[key].name, patches: list.length, ranges: changed.length, sha256, stock_sha256 });
  }
  if (mods.length) summary.mods = mods.map((m) => ({ file: m.source, id: m.id, edits: m.edits }));
  // and what a patch's source holds besides it (p.not_applied, one list per source: a container given as --main)
  const not_applied = [...anchors.flatMap((an) => an.not_applied), ...[...new Set(patches.map((p) => p.not_applied).filter(Boolean))].flat()];
  if (not_applied.length) summary.not_applied = not_applied;
  return { blocks: out, summary, changed: by.image.length ? ranges.image : ranges.main, ranges };
}

// The runs of bytes in which block differs from stock over [0, len), as patches of block key, source naming the file
function runsOf(stock, block, source, key, len = block.length) {
  const out = [];
  for (let i = 0; i < len; i++) {
    if (block[i] === stock[i]) continue;
    let j = i + 1;
    while (j < len && block[j] !== stock[j]) j++;
    out.push({ source, n: out.length, label: null, block: key, offset: i, old: stock.slice(i, j), new: block.slice(i, j) });
    i = j;
  }
  return out;
}

// The patches of a whole patched main code block (--main FILE): block (Uint8Array) against the stock block (verified
// by the caller), one patch per run of bytes that differ, source naming the file; refused (PatchRefused) when the two
// differ in length or not at all.
export function mainPatches(stock, block, source) {
  if (block.length !== stock.length) throw new PatchRefused(`${source}: ${block.length} bytes, the stock main code block ${stock.length}: not a patched main code block of this model`);
  const out = runsOf(stock, block, source, 'main');
  if (!out.length) throw new PatchRefused(`${source}: the stock main code block itself (nothing to patch)`);
  return out;
}

const RES_FLAGS = 0x0101;
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

// --main FILE's bytes as patches against the stock blocks: a main code block as unpacked, or the .BIN container that
// holds one. id: what the file is (src/fw/identify.mjs identifyBytes' answer); code: the run's model; res: the stock
// resource block (verified by the caller, whole or its prefix; null when the tool loads the main code block alone) and
// layout (patchLayout's) to read the container's resource block against.
// - a container: its head must name the run's model with the main code block at the release's place and length
//   (identify's 'stock' or 'modified': at the release's version, or the release's stock main code block under another
//   version field); its main block, descrambled, is compared, whatever its checksum, and so is its resource block's
//   (flags 0x0101, where the release has it) part the lab reads (layout.resource.len, the prefix src/fw/resprefix.mjs
//   keeps), each run of bytes that differ a patch of that block. Its other blocks are not read, a resource block
//   change past the prefix is counted but not applied, and a checksum total that is not 0 does not stop the run: each
//   patch carries a not_applied list that says so (applyPatches puts it in the summary), so a run on it checks the
//   changes to the two blocks the lab loads, not the file an updater would take. A container with nothing to patch in
//   either (the release's, or one whose only change is its version field) is refused;
// - a bare block that is another body's stock block (bodies share lengths) is refused by name; any other goes to
//   mainPatches as before.
export function mainFilePatches(stock, bytes, source, id, code, { res = null, layout = null } = {}) {
  if (id.kind !== 'container') {
    if (id.status === 'stock' && id.model !== code) throw new PatchRefused(`${source}: ${id.reason}, not a patched main code block of ${code}`);
    return mainPatches(stock, bytes, source);
  }
  if (id.model !== code || (id.status !== 'stock' && id.status !== 'modified')) throw new PatchRefused(`${source}: ${id.reason}: not a .BIN of ${code}'s firmware as the lab runs it, stock or modified`);
  // (a main block of another length: mainPatches' refusal; one equal to the stock block: no patch of it)
  const main = id.main.length === stock.length ? runsOf(stock, id.main, source, 'main') : mainPatches(stock, id.main, source);
  const not_applied = [], resNote = [];
  let resPatches = [], other = id.blocks - 1;
  if (res && layout) {
    const blocks = walkBytes(bytes).blocks, rb = blocks.find((x) => x.typ === 'OE' && x.flags === RES_FLAGS && x.off === layout.resource.off);
    if (!rb) throw new PatchRefused(`${source}: ${id.reason}: no resource block at 0x${layout.resource.off.toString(16).padStart(8, '0')}, where the release has it`);
    other--;
    const r = decodeBlock(bytes.subarray(rb.off, rb.off + 64 + rb.len), rb), n = Math.min(layout.resource.len, res.length);
    if (r.data.length < n) throw new PatchRefused(`${source}: its resource block has ${r.data.length} bytes, fewer than the ${n} the lab reads`);
    resPatches = runsOf(res, r.data, source, 'resource', n);
    // past the prefix: compared where the caller holds the stock bytes (the node tools load the whole block)
    let past = 0;
    for (let i = n; i < Math.min(res.length, r.data.length); i++) if (r.data[i] !== res[i]) past++;
    if (past) resNote.push({ file: source, field: 'resource', why: `${plural(past, 'byte')} of its resource block past the ${n} the lab reads differ from the stock block's: not applied` });
    if (!r.cksum_ok) resNote.push({ file: source, field: 'resource checksum', why: 'the resource block\'s checksum total is not 0; the lab does not check it' });
  }
  if (!main.length && !resPatches.length) {
    const past = resNote.find((x) => x.field === 'resource');
    throw new PatchRefused(`${source}: ${id.reason}: ${res && layout ? `nothing to patch in the main code block or the resource block's part the lab reads${past ? ` (${past.why.replace(/: not applied$/, '')})` : ''}; a change in another block is not seen here`
      : 'nothing to patch in the main code block; a change in another block is not seen here (give it as --patch on that block)'}`);
  }
  not_applied.push({ file: source, field: 'container', why: res && layout
    ? `only its main code block and its resource block's part the lab reads are taken: its ${other} other block(s) are not read`
    : `only its main code block is taken: its ${other} other block(s) are not read, the lab loads the stock resource block` });
  if (!id.checksum_ok) not_applied.push({ file: source, field: 'checksum', why: 'the main code block\'s checksum total is not 0 (not recomputed after the change); the lab does not check it' });
  not_applied.push(...resNote);
  return [...main, ...resPatches.map((p) => ({ ...p, n: main.length + p.n }))].map((p) => ({ ...p, not_applied }));
}

// One line for a summary: 'N patches (B bytes changed) from FILES; main blk... sha256 X (stock Y)', the mods taken
// from a mods.json pack, and what a digest-anchored file holds that is not applied.
export function patchLine(s) {
  const blocks = s.blocks.map((b) => `${b.block} block sha256 ${b.sha256.slice(0, 16)} (stock ${b.stock_sha256.slice(0, 16)})`).join(', ');
  const mods = (s.mods ?? []).map((m) => `${m.id} (${plural(m.edits, 'edit')})`).join(', ');
  const not = (s.not_applied ?? []).map((x) => `${x.field} (${x.why})`).join(', ');
  return `${s.applied} patch${s.applied === 1 ? '' : 'es'} (${s.bytes} bytes changed) from ${s.files.join(', ')}; ${blocks}${mods ? `; mods: ${mods}` : ''}${not ? `; not applied: ${not}` : ''}`;
}
