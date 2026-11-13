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
// applyPatches refuses (PatchRefused) unless every patch is well formed, old and new have one non-zero length, the
// range lies inside the part of its block the lab loads (the whole main code block; the resource block's prefix,
// src/fw/resprefix.mjs, MODEL_INFO.res_len), no two patches of a block overlap (across files too), and every old
// matches the stock block's bytes there. The caller verifies the stock blocks first (their MODELS digests); the result
// carries a summary for the player's status and the logs: the files, the count, the bytes changed, and per patched
// block its sha256 after the patches; and the main block's changed bytes as ranges (the lab's patch rules, src/lab/
// patchaudit.mjs). mainPatches makes the patches of a whole patched main code block (--main FILE): its runs of bytes
// that differ from the stock block's.
// Worker-safe: no node API; the hash comes in as an argument.
import { base64Bytes, hexBytes } from '../util/bytes.mjs';

export class PatchRefused extends Error { get name() { return 'PatchRefused'; } }

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const BLK = /blk([0-9a-f]{8})/i;

// The blocks a patch may target on a model (src/fw/models.mjs entry): key, file name, container offset and the length
// the lab loads of it; the main block's base, the run-time address of its byte 0 (image_base).
export function patchLayout(info) {
  const resOff = parseInt(BLK.exec(info.res_block)[1], 16);
  return {
    main: { key: 'main', name: 'blk00000000.OE.0100.bin', off: 0, len: info.rom_len, base: info.image_base },
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
  const keys = ANCHORED[doc.format];
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

// A patch file's text as patches: [{source, n, label, block (as given), offset, old, new, anchor?}], or throws
// PatchRefused. source names the file in the messages. A digest-anchored file's patches have old null and its anchor.
export function readPatchText(text, source) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new PatchRefused(`${source}: not JSON (${e.message})`); }
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && 'format' in doc && !('patches' in doc)) return readAnchored(doc, source);
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

const name = (p) => `${p.source} patch ${p.n}${p.label ? ` (${p.label})` : ''}`;

// Applies patches (readPatchText's, of one or more files) to the stock blocks: blocks {main, resource} (Uint8Arrays,
// verified by the caller; the resource block whole or its prefix), layout patchLayout's, files the sources' names.
// Returns {blocks: {main, resource} (a patched block a new copy, the other the caller's own), summary: {files,
// applied, bytes, blocks: [{block, name, patches, sha256, stock_sha256}], not_applied? (a digest-anchored file's
// content the lab does not apply: [{file, field, why}])}, changed: the main block's changed bytes as sorted [offset,
// length] ranges}, or throws PatchRefused for the first patch that fails a rule (a block absent from blocks takes no
// patch); nothing the caller gave is changed.
export function applyPatches(blocks, patches, { layout, createHash, files = [...new Set(patches.map((p) => p.source))] }) {
  if (!patches.length) throw new PatchRefused('no patches');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const by = { main: [], resource: [] }, anchors = [...new Set(patches.map((p) => p.anchor).filter(Boolean))];
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
  for (const p0 of patches) {
    const key = resolveBlock(p0.block, layout);
    if (!blocks[key]) throw new PatchRefused(`${name(p0)}: the ${key} block is not loaded here`);
    const lim = Math.min(layout[key].len, blocks[key].length), len = p0.old?.length ?? p0.new.length;
    if (p0.offset + len > lim) {
      throw new PatchRefused(`${name(p0)}: ${hex8(p0.offset)}+${len} lies outside the ${key === 'main' ? 'main code block' : "resource block's part the lab reads"} (${lim} bytes)`);
    }
    // a run's old bytes: the stock block's (its file's before digest is the stock block's)
    by[key].push(p0.old === null ? { ...p0, old: blocks[key].slice(p0.offset, p0.offset + len) } : p0);
  }
  for (const [key, list] of Object.entries(by)) {
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (a.offset + a.old.length > b.offset) throw new PatchRefused(`${name(a)} (${hex8(a.offset)}+${a.old.length}) and ${name(b)} (${hex8(b.offset)}+${b.old.length}) overlap in the ${key} block`);
    }
    const stock = blocks[key];
    for (const p of list) {
      for (let k = 0; k < p.old.length; k++) {
        if (stock[p.offset + k] !== p.old[k]) {
          throw new PatchRefused(`${name(p)}: old bytes differ from the stock ${key} block at ${hex8(p.offset + k)} (0x${stock[p.offset + k].toString(16).padStart(2, '0')}, the patch expects 0x${p.old[k].toString(16).padStart(2, '0')}): not a patch for this model's stock block`);
        }
      }
    }
  }
  const out = { ...blocks }, summary = { files, applied: patches.length, bytes: 0, blocks: [] }, changed = [];
  for (const [key, list] of Object.entries(by)) {
    if (!list.length) continue;
    const b = blocks[key].slice(), stock_sha256 = key === 'main' && stockMain || sha(blocks[key].subarray(0, layout[key].len));
    for (const p of list) {
      for (let k = 0; k < p.new.length; k++) {
        if (b[p.offset + k] === p.new[k]) continue;
        summary.bytes++;
        if (key !== 'main') continue;
        const last = changed[changed.length - 1], at = p.offset + k;
        if (last && last[0] + last[1] === at) last[1]++; else changed.push([at, 1]);
      }
      b.set(p.new, p.offset);
    }
    out[key] = b;
    const sha256 = sha(b.subarray(0, layout[key].len));
    for (const an of key === 'main' ? anchors : []) {
      if (sha256 !== an.after) throw new PatchRefused(`${an.source}: the patched main block's sha256 ${sha256.slice(0, 16)}... is not its main_sha256_after ${an.after.slice(0, 16)}...`);
    }
    summary.blocks.push({ block: key, name: layout[key].name, patches: list.length, sha256, stock_sha256 });
  }
  const not_applied = anchors.flatMap((an) => an.not_applied);
  if (not_applied.length) summary.not_applied = not_applied;
  return { blocks: out, summary, changed };
}

// The patches of a whole patched main code block (--main FILE): block (Uint8Array) against the stock block (verified
// by the caller), one patch per run of bytes that differ, source naming the file; refused (PatchRefused) when the two
// differ in length or not at all.
export function mainPatches(stock, block, source) {
  if (block.length !== stock.length) throw new PatchRefused(`${source}: ${block.length} bytes, the stock main code block ${stock.length}: not a patched main code block of this model`);
  const out = [];
  for (let i = 0; i < block.length; i++) {
    if (block[i] === stock[i]) continue;
    let j = i + 1;
    while (j < block.length && block[j] !== stock[j]) j++;
    out.push({ source, n: out.length, label: null, block: 'main', offset: i, old: stock.slice(i, j), new: block.slice(i, j) });
    i = j;
  }
  if (!out.length) throw new PatchRefused(`${source}: the stock main code block itself (nothing to patch)`);
  return out;
}

// One line for a summary: 'N patches (B bytes changed) from FILES; main blk... sha256 X (stock Y)', and what a
// digest-anchored file holds that is not applied.
export function patchLine(s) {
  const blocks = s.blocks.map((b) => `${b.block} block sha256 ${b.sha256.slice(0, 16)} (stock ${b.stock_sha256.slice(0, 16)})`).join(', ');
  const not = (s.not_applied ?? []).map((x) => `${x.field} (${x.why})`).join(', ');
  return `${s.applied} patch${s.applied === 1 ? '' : 'es'} (${s.bytes} bytes changed) from ${s.files.join(', ')}; ${blocks}${not ? `; not applied: ${not}` : ''}`;
}
