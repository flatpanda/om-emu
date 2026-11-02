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
// applyPatches refuses (PatchRefused) unless every patch is well formed, old and new have one non-zero length, the
// range lies inside the part of its block the lab loads (the whole main code block; the resource block's prefix,
// src/fw/resprefix.mjs, MODEL_INFO.res_len), no two patches of a block overlap (across files too), and every old
// matches the stock block's bytes there. The caller verifies the stock blocks first (their MODELS digests); the result
// carries a summary for the player's status and the logs: the files, the count, the bytes changed, and per patched
// block its sha256 after the patches.
// Worker-safe: no node API; the hash comes in as an argument.
import { base64Bytes, hexBytes } from '../util/bytes.mjs';

export class PatchRefused extends Error { get name() { return 'PatchRefused'; } }

const hex8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const BLK = /blk([0-9a-f]{8})/i;

// The blocks a patch may target on a model (src/fw/models.mjs entry): key, file name, container offset and the length
// the lab loads of it.
export function patchLayout(info) {
  const resOff = parseInt(BLK.exec(info.res_block)[1], 16);
  return {
    main: { key: 'main', name: 'blk00000000.OE.0100.bin', off: 0, len: info.rom_len },
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

// A patch file's text as patches: [{source, n, label, block (as given), offset, old, new}], or throws PatchRefused.
// source names the file in the messages.
export function readPatchText(text, source) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new PatchRefused(`${source}: not JSON (${e.message})`); }
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
// applied, bytes, blocks: [{block, name, patches, sha256, stock_sha256}]}}, or throws PatchRefused, before anything
// is copied, for the first patch that fails a rule (a block absent from blocks takes no patch).
export function applyPatches(blocks, patches, { layout, createHash, files = [...new Set(patches.map((p) => p.source))] }) {
  if (!patches.length) throw new PatchRefused('no patches');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const by = { main: [], resource: [] };
  for (const p of patches) {
    const key = resolveBlock(p.block, layout);
    if (!blocks[key]) throw new PatchRefused(`${name(p)}: the ${key} block is not loaded here`);
    const lim = Math.min(layout[key].len, blocks[key].length);
    if (p.offset + p.old.length > lim) {
      throw new PatchRefused(`${name(p)}: ${hex8(p.offset)}+${p.old.length} lies outside the ${key === 'main' ? 'main code block' : "resource block's part the lab reads"} (${lim} bytes)`);
    }
    by[key].push(p);
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
  const out = { ...blocks }, summary = { files, applied: patches.length, bytes: 0, blocks: [] };
  for (const [key, list] of Object.entries(by)) {
    if (!list.length) continue;
    const b = blocks[key].slice(), stock_sha256 = sha(blocks[key].subarray(0, layout[key].len));
    for (const p of list) {
      for (let k = 0; k < p.new.length; k++) if (b[p.offset + k] !== p.new[k]) summary.bytes++;
      b.set(p.new, p.offset);
    }
    out[key] = b;
    summary.blocks.push({ block: key, name: layout[key].name, patches: list.length, sha256: sha(b.subarray(0, layout[key].len)), stock_sha256 });
  }
  return { blocks: out, summary };
}

// One line for a summary: 'N patches (B bytes changed) from FILES; main blk... sha256 X (stock Y)'.
export function patchLine(s) {
  const blocks = s.blocks.map((b) => `${b.block} block sha256 ${b.sha256.slice(0, 16)} (stock ${b.stock_sha256.slice(0, 16)})`).join(', ');
  return `${s.applied} patch${s.applied === 1 ? '' : 'es'} (${s.bytes} bytes changed) from ${s.files.join(', ')}; ${blocks}`;
}
