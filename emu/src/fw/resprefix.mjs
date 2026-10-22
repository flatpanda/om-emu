// The part of the resource block (E143: blk02000000.OE.0101.bin, 60.8 MB) the lab can read: up to the end of the
// last entry of the block's own index. The lab reads the block only through resources.mjs's index (raw_record, record,
// blobs, languages), so every byte it can reach lies inside an index entry; the browser player keeps that prefix (about
// 10 MB at E143) instead of the whole block. The extent is computed from the index with resources.mjs's own parser and
// origin rule (entry 0's address minus INDEX_AREA), never hard-coded, and a prefix that would cut an entry is refused.
import { index, origin, loadAddress } from '../lab/resources.mjs';

// {end, entries, origin}: end = max(address - origin + size) over the index's entries. With the block's load address
// (its head's, src/fw/olyfw.mjs labBlocks), the index's load address (resources.mjs loadAddress) is checked against it.
export function resExtent(block, load = null) {
  const entries = index(block);
  if (!entries.length) throw new Error('resource block: empty index');
  const org = origin(block);
  if (load !== null && loadAddress(block) !== load) throw new Error(`resource block: the index gives the load address 0x${loadAddress(block).toString(16)}, the head 0x${load.toString(16)}`);
  let end = 0;
  for (const [address, size] of entries) {
    const lo = address - org, hi = lo + size;
    if (lo < 0 || hi > block.length) throw new Error(`resource block: index entry 0x${address.toString(16)}+0x${size.toString(16)} outside the block (${block.length} bytes)`);
    end = Math.max(end, hi);
  }
  return { end, entries, origin: org };
}

// A copy of the block's prefix up to the extent (the whole block's buffer can then be dropped). A prefix shorter than
// the extent (cut, the negative control) is refused, so a lab never reads past it.
export function resPrefix(block, { cut = null, load = null } = {}) {
  const { end } = resExtent(block, load);
  const n = cut ?? end;
  if (n < end) throw new Error(`resource prefix: ${n} bytes would cut the index's last entry (it ends at ${end})`);
  return block.slice(0, n);
}
