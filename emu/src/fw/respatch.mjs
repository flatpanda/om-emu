// Resource-block (OE 0x0101) verification and override helper: extracts a descrambled 0x0101 resource block from
// either a raw unpacked block or an Olympus .BIN firmware container, diffs it against the stock resource block, and
// produces a structured summary for resource-only patches (such as E148 English menu overrides).
// Worker-safe: no node API; the hash comes in as an argument.
import { TYPES, walkBytes, decodeBlock, ContainerRefused } from './olyfw.mjs';
import { PatchRefused } from './patch.mjs';

export { PatchRefused };

const RES_FLAGS = 0x0101;
const hex = (v, n) => v.toString(16).padStart(n, '0');
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const isHead = (u8) => u8.length >= 2 && TYPES.includes(String.fromCharCode(u8[0], u8[1]));

// Extracts the descrambled 0x0101 resource block from either a raw unpacked resource block or an Olympus .BIN
// container. Returns a fresh Uint8Array, or throws PatchRefused if the input is invalid or the container is malformed
// or lacks a single valid OE 0x0101 block.
export function extractResourceBlock(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) {
    throw new PatchRefused('resource override: expected a non-empty Uint8Array');
  }
  if (!isHead(bytes)) return bytes.slice();
  const { blocks } = walkBytes(bytes);
  if (!blocks.length) {
    throw new PatchRefused(`resource container: truncated or malformed container (${bytes.length} bytes, no valid block header)`);
  }
  const cut = blocks.find((b) => b.error);
  if (cut) {
    throw new PatchRefused(`resource container: cut inside block at 0x${hex(cut.off, 8)} (${cut.error}: head gives ${cut.len} bytes)`);
  }
  const resBlocks = blocks.filter((b) => b.typ === 'OE' && b.flags === RES_FLAGS);
  if (resBlocks.length !== 1) {
    throw new PatchRefused(`resource container: expected 1 OE 0x${hex(RES_FLAGS, 4)} resource block, found ${resBlocks.length} (in ${plural(blocks.length, 'block')})`);
  }
  const rb = resBlocks[0];
  let decoded;
  try {
    decoded = decodeBlock(bytes.subarray(rb.off, rb.off + 64 + rb.len), rb);
  } catch (e) {
    if (e instanceof ContainerRefused) throw new PatchRefused(`resource container: ${e.message}`);
    throw e;
  }
  if (!decoded.data.length) {
    throw new PatchRefused(`resource container: OE 0x${hex(RES_FLAGS, 4)} block at 0x${hex(rb.off, 8)} is empty`);
  }
  return decoded.data;
}

// Diffs a modified resource block against the stock resource block of the same length. Returns
// { stock_size, mod_size, stock_sha256, mod_sha256, changed_bytes, ranges, same }, where ranges is a sorted list of
// [offset, length] runs of differing bytes.
export function diffResourceBlock(stockRes, modRes, createHash) {
  if (!(stockRes instanceof Uint8Array) || !stockRes.length) {
    throw new PatchRefused('stock resource block: expected a non-empty Uint8Array');
  }
  if (!(modRes instanceof Uint8Array) || !modRes.length) {
    throw new PatchRefused('modified resource block: expected a non-empty Uint8Array');
  }
  if (typeof createHash !== 'function') {
    throw new PatchRefused('diffResourceBlock: createHash function is required');
  }
  if (modRes.length !== stockRes.length) {
    throw new PatchRefused(`resource block size mismatch: override has ${modRes.length} bytes, stock has ${stockRes.length} bytes`);
  }
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const stock_sha256 = sha(stockRes);
  const mod_sha256 = sha(modRes);
  const ranges = [];
  let changed_bytes = 0;
  for (let i = 0; i < stockRes.length; i++) {
    if (modRes[i] === stockRes[i]) continue;
    let j = i + 1;
    while (j < stockRes.length && modRes[j] !== stockRes[j]) j++;
    const len = j - i;
    ranges.push([i, len]);
    changed_bytes += len;
    i = j;
  }
  return {
    stock_size: stockRes.length,
    mod_size: modRes.length,
    stock_sha256,
    mod_sha256,
    changed_bytes,
    ranges,
    same: changed_bytes === 0,
  };
}

// Extracts the override resource block (raw or .BIN container) and diffs it against stockRes.
// Returns { resBlock, summary }.
export function applyResourceOverride(stockRes, overrideBytes, createHash) {
  const resBlock = extractResourceBlock(overrideBytes);
  const summary = diffResourceBlock(stockRes, resBlock, createHash);
  return { resBlock, summary };
}

// One-line human-readable summary matching patchLine style.
export function resPatchLine(summary) {
  if (summary.same) {
    return `resource block unchanged (${summary.stock_size} bytes); resource block sha256 ${summary.stock_sha256.slice(0, 16)}`;
  }
  return `resource block override (${plural(summary.ranges.length, 'range')}, ${plural(summary.changed_bytes, 'byte')} changed); resource block sha256 ${summary.mod_sha256.slice(0, 16)} (stock ${summary.stock_sha256.slice(0, 16)})`;
}
