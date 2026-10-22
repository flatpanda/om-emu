// records(), bitmap_bytes() and load(sim, blobs, only=...): the validated bitmap records of the
// two decoded resource blobs, found by scanning them (no cache). The blobs come from src/lab/resources.mjs
// (the LZ4 decoder the lab runs); the bitmap decoder is refs/osdfmt.mjs.
import { blobs as decodeBlobs } from '../../src/lab/resources.mjs';
import { bitmap_header, decode_bitmap } from '../../refs/osdfmt.mjs';
import { ValueError, IndexError } from '../../refs/errors.mjs';
import { KeyError } from '../../src/lab/errors.mjs';
import { loadBlock } from './env.mjs';

export const blobs = (block = loadBlock()) => decodeBlobs(block);
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
// _find(data, needle, align): the positions of needle in data that are multiples of align, in order (bytes.find).
function* find(data, needle, align) {
  const first = needle[0];
  for (let p = data.indexOf(first); p >= 0; p = data.indexOf(first, p + 1)) {
    if (p + needle.length > data.length) return;
    let k = 1;
    while (k < needle.length && data[p + k] === needle[k]) k++;
    if (k === needle.length && p % align === 0) yield p;
  }
}
// decode_bitmap's failures records() skips: (ValueError, IndexError); anything else propagates.
const skipped = (e) => e instanceof ValueError || e instanceof IndexError;
const CACHE = new WeakMap();

// Validated bitmap records {address, width, lines, fmt, size}, sorted by address.
export function records(blobList = blobs()) {
  if (CACHE.has(blobList)) return CACHE.get(blobList);
  const locate = (ptr, size) => {
    for (const [load, data] of blobList) {
      if (load <= ptr && ptr + size <= load + data.length) {
        const a = ptr - load, e = ptr - load + size;      // data[a:e]: a may pass the end (empty), e < a is empty
        return data.subarray(Math.min(a, data.length), Math.max(Math.min(e, data.length), Math.min(a, data.length)));
      }
    }
    return null;
  };
  const found = new Map();
  for (const [, data] of blobList) {
    for (const p of find(data, [0x0e, 0x00], 2)) {
      if (p + 20 > data.length) continue;
      const width = u16(data, p + 2), height = u16(data, p + 4), bpp = u16(data, p + 6), zero = u32(data, p + 8);
      const size = u32(data, p + 12), ptr = u32(data, p + 16);
      if (zero || (bpp !== 4 && bpp !== 8) || !(size > 0 && size < 0x400000) || !(width >= 1 && width <= 4096) || !(height >= 1 && height <= 4096)) continue;
      const body = locate(ptr, size);
      if (body === null) continue;
      let hdr;
      try { hdr = bitmap_header(body); } catch (e) { if (skipped(e)) throw new Error('records: bitmap_header of a located body raised'); throw e; }
      if (hdr[0] !== width || hdr[1] !== height) continue;
      let d;
      try { d = decode_bitmap(body); } catch (e) { if (skipped(e)) continue; throw e; }
      if (d[4] === size) found.set(ptr, { address: ptr, width: d[0], lines: d[1], fmt: d[2], size });
    }
  }
  const [load0, data0] = blobList[0];
  for (const p of find(data0, [0x02, 0x00, 0x00, 0x00], 4)) {
    if (p < 8) continue;
    const width = u16(data0, p - 8), height = u16(data0, p - 6), ptr = u32(data0, p - 4);
    if (!(width >= 1 && width <= 1024) || !(height >= 1 && height <= 1024) || found.has(ptr)) continue;
    const body = locate(ptr, 4);
    if (body === null) continue;
    let hdr;
    try { hdr = bitmap_header(body); } catch (e) { if (skipped(e)) throw new Error('records: bitmap_header of a 4-byte body raised'); throw e; }
    if (hdr[0] !== width || hdr[1] !== height || hdr[2] !== 2) continue;
    const whole = locate(ptr, Math.min(width * height + 4, load0 + data0.length - ptr));
    if (whole === null) throw new Error('records: the bitmap at a 4-byte body is outside the blob');
    let d;
    try { d = decode_bitmap(whole); } catch (e) { if (skipped(e)) continue; throw e; }
    found.set(ptr, { address: ptr, width: d[0], lines: d[1], fmt: d[2], size: d[4] });
  }
  const result = [...found.values()].sort((a, b) => a.address - b.address);
  CACHE.set(blobList, result);
  return result;
}

export function bitmap_bytes(record, blobList = blobs()) {
  for (const [load, data] of blobList) {
    if (load <= record.address && record.address < load + data.length) {
      const off = record.address - load;
      return data.subarray(off, off + record.size);
    }
  }
  throw new KeyError(String(record.address));
}

// Write the resources into guest DRAM (cached view); only: the records to copy instead of both blobs.
export function load(sim, blobList = blobs(), only = null) {
  if (only === null) {
    for (const [address, data] of blobList) sim.write(((address & 0x3FFFFFFF) | 0x40000000) >>> 0, data);
    return;
  }
  for (const record of only) sim.write(((record.address & 0x3FFFFFFF) | 0x40000000) >>> 0, bitmap_bytes(record, blobList));
}
