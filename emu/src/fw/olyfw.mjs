// The Olympus .BIN firmware container, as tools/olyfw.py reads it: walk the blocks, descramble a body, verify the
// checksum. A file is a run of blocks <head:32><body:len><tail:32> (head and tail: u16 type 'OE'/'OM'/'OA'/'OL', u16
// model, u32 pad, u32 load address, u32 body length, u16 version, u16 pad, u16 flags, 6 pad bytes, u32 checksum). A body
// with flags != 0 is scrambled: per aligned 16 bytes decoded[k] = encoded[PERM[k]] ^ 0xFF; an unaligned tail is kept as
// it is. The checksum: the u32 sum over head, descrambled body and tail is 0. The walk stops at the first head of
// another type and, like olyfw.py, at a block whose body overruns the file (recorded with its error).
// Worker-safe: the reader is read(offset, length) -> Uint8Array | Promise<Uint8Array> (a whole buffer, File.slice), so
// the browser player reads the E143 .BIN (240,779,264 bytes) block by block. Gate B1 (test/test_unpack.mjs) checks it
// byte for byte against the blocks in unpacked/E143.
export const PERM = [1, 3, 0, 2, 6, 4, 7, 5, 11, 10, 9, 8, 13, 14, 12, 15];
export const TYPES = ['OE', 'OM', 'OA', 'OL'];
const hex = (v, n) => v.toString(16).padStart(n, '0');

export function parseHead(u8, off = 0) {
  const dv = new DataView(u8.buffer, u8.byteOffset + off, 32);
  return { typ: String.fromCharCode(u8[off], u8[off + 1]), model: hex(u8[off + 2], 2) + hex(u8[off + 3], 2), load: dv.getUint32(8, true),
    len: dv.getUint32(12, true), ver: dv.getUint16(16, true), flags: dv.getUint16(20, true), cks: dv.getUint32(28, true) };
}

// olyfw.descramble: a new Uint8Array (or `out`, same length).
export function descramble(src, out = new Uint8Array(src.length)) {
  const n = src.length - (src.length % 16);
  if ((src.byteOffset & 3) === 0 && (out.byteOffset & 3) === 0) {
    const s = new Uint32Array(src.buffer, src.byteOffset, n >> 2), d = new Uint32Array(out.buffer, out.byteOffset, n >> 2);
    for (let i = 0; i < s.length; i += 4) {
      // little-endian byte k of a group is word k >> 2, bits 8 * (k & 3); out word 0 = bytes [1, 3, 0, 2], 1 = [6, 4, 7, 5],
      // 2 = [11, 10, 9, 8], 3 = [13, 14, 12, 15], each inverted
      const a = s[i], b = s[i + 1], c = s[i + 2], e = s[i + 3];
      d[i] = ~(((a >>> 8) & 0xff) | ((a >>> 24) << 8) | ((a & 0xff) << 16) | (((a >>> 16) & 0xff) << 24));
      d[i + 1] = ~(((b >>> 16) & 0xff) | ((b & 0xff) << 8) | ((b >>> 24) << 16) | (((b >>> 8) & 0xff) << 24));
      d[i + 2] = ~((c >>> 24) | (((c >>> 16) & 0xff) << 8) | (((c >>> 8) & 0xff) << 16) | ((c & 0xff) << 24));
      d[i + 3] = ~(((e >>> 8) & 0xff) | (((e >>> 16) & 0xff) << 8) | ((e & 0xff) << 16) | ((e >>> 24) << 24));
    }
  } else {
    for (let g = 0; g < n; g += 16) for (let k = 0; k < 16; k++) out[g + k] = src[g + PERM[k]] ^ 0xff;
  }
  for (let i = n; i < src.length; i++) out[i] = src[i];
  return out;
}

// olyfw.sum32: the u32 little-endian sum of the whole words (a trailing partial word is left out).
export function sum32(u8) {
  const n = u8.length >> 2;
  let s = 0;
  if ((u8.byteOffset & 3) === 0) {
    const w = new Uint32Array(u8.buffer, u8.byteOffset, n);
    for (let i = 0; i < n; i++) s = (s + w[i]) >>> 0;
  } else {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    for (let i = 0; i < n; i++) s = (s + dv.getUint32(4 * i, true)) >>> 0;
  }
  return s;
}

// olyfw.walk's block list from the heads only: [{off, ...head}] (an overrunning block last, with error), and the
// offset the walk stopped at.
export async function walk(read, size) {
  const blocks = [];
  let off = 0;
  while (off + 32 <= size) {
    const h = await read(off, 32);
    const typ = String.fromCharCode(h[0], h[1]);
    if (!TYPES.includes(typ)) break;
    const b = { off, ...parseHead(h, 0) };
    blocks.push(b);
    if (off + 32 + b.len + 32 > size) { b.error = 'body overruns file'; break; }
    off += 64 + b.len;
  }
  return { blocks, end: off };
}

// One walked block: the body as stored and descrambled, the checksum total and whether it is 0 (olyfw.walk's fields).
export async function readBlock(read, b) {
  if (b.error) throw new Error(`block at 0x${hex(b.off, 8)}: ${b.error}`);
  const all = await read(b.off, 64 + b.len);
  const head = all.subarray(0, 32), body = all.subarray(32, 32 + b.len), tail = all.subarray(32 + b.len, 64 + b.len);
  const scrambled = b.flags !== 0;
  const data = scrambled ? descramble(body) : body.slice();
  const total = (sum32(head) + sum32(data) + sum32(tail)) >>> 0;
  return { data, scrambled, cksum_tot: total, cksum_ok: total === 0, tail_cks: parseHead(tail, 0).cks };
}

// The file name olyfw.py --dump writes a block's body to.
export function blockName(base, b) {
  return `${base}.blk${hex(b.off, 8)}.${b.typ}.${hex(b.flags, 4)}.bin`;
}

// The two blocks the lab reads (the main code, flags 0x0100, and the resources, 0x0101), each verified: a checksum
// that is not 0 throws. onBlock(name, ms) reports progress.
export async function labBlocks(read, size, { onBlock = null } = {}) {
  const { blocks } = await walk(read, size);
  const get = async (flags) => {
    const b = blocks.find((x) => x.typ === 'OE' && x.flags === flags);
    if (!b) throw new Error(`no OE block with flags 0x${hex(flags, 4)} in the .BIN (${blocks.length} blocks)`);
    const t0 = performance.now();
    const r = await readBlock(read, b);
    if (!r.cksum_ok) throw new Error(`OE block 0x${hex(flags, 4)} at 0x${hex(b.off, 8)}: checksum total 0x${hex(r.cksum_tot, 8)}, not 0 (a damaged or altered .BIN)`);
    if (onBlock) onBlock(flags, performance.now() - t0);
    return { block: b, data: r.data };
  };
  const rom = await get(0x0100), res = await get(0x0101);
  return { blocks, rom, res };
}
