// The OM-1's NAND as its resource loader reads it (docs/hle-gaps.md 4.5, "The resource tables"; src/lab/resnand.mjs
// S-RESNAND): every block of the update sits in the NAND's logical space at its container head's load address (field
// 0x08), stored as the head (32 bytes) + the descrambled body + the tail (32 bytes), the form the .BIN carries it in
// (src/fw/olyfw.mjs). D: the loader 0x501a8ca0 reads the resource block's index at 0x41ec0000, the large-data block's
// at 0x458c0000 and the images block's at 0x4e1e0000, their heads' load addresses, and takes the table 32 bytes past
// the buffer (past the head); X: res_version of those tables is the heads' version 0x0100, and the twelve sub-indexes
// the large-data index names begin with OE heads whose load address is their own address. The blocks served are those
// whose load range lies in NAND_WINDOW, the logical space of the loader's, the file system's (0x41a00000) and the lens
// caches' (0x416e0000) areas: E143's resources (0x0101), large data (0x0106) and images (0x0102). The code block
// (0x50000000), the miscellaneous block (load 0) and the SCPU's image (0x08000000) are not served: no read of them
// through the NAND access is known (?).
//
// The camera's own sound resources (RES_MODE_SOUND, type 2) are not in the update (D: no block's load range covers the
// loader's first read 0x4e420000 on E143). Their format is the one the TG-7's update ships in its block of flags
// 0x0103, which E145's loader reads as E143's reads 0x4e420000 (X; docs/firmware-container.md): an OE head with the
// area's load address and length, then 16-byte entries {u32 address, u32 size, 0, 0} from +32, the first entry's data
// at load + SOUND_INDEX (the 1024 bytes the loader reads), each a RIFF WAVE file at a 512-aligned address, its size a
// multiple of 512 (the TG-7's: PCM, 2 channels, 48 kHz, 16 bits, zero padded). soundArea() builds such an image from
// lab-made WAV files; parseSoundArea() reads one back by the firmware's rules (res_size 0x501a976d returns entry i's
// size, res_read 0x501a921f of type 2 reads from entry i's address, D).
// Worker-safe: the container reader read(offset, length) -> Uint8Array is synchronous for nandSource (fs.readSync, the
// tests) and may answer a Promise for nandSourceAsync (File.slice in the browser, provisioning).
import { descramble, sum32 } from './olyfw.mjs';

export const NAND_HEAD = 32;                          // a stored block's head before its body, its tail after
export const NAND_WINDOW = [0x40000000, 0x50000000];  // the logical space served from the container's blocks
export const INDEX_ENTRY = 16;                        // {u32 address, u32 size, u32 0, u32 0}
// the type-2 area (E143: MODELS res_nand.sound): its index read (1024 bytes, 0x501a8cc8, D), the alignment of its
// entries' data and the TG-7 block's flags
export const SOUND_INDEX = 1024, SOUND_ALIGN = 512, SOUND_FLAGS = 0x0103;
// E143's sound area: the loader's first read (0x501a8cc0: mov 0x4e420000,a0, D)
export const SOUND_LOAD_E143 = 0x4E420000;

export class NandError extends Error { get name() { return 'NandError'; } }

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// The NAND areas of a walked container (src/fw/olyfw.mjs walk's blocks): [{load, size (head + body + tail), len (the
// body's), off (the block's file offset), flags, ver}] in load order. Two areas that overlap are refused.
export function nandAreas(blocks) {
  const areas = [];
  for (const b of blocks) {
    if (b.error || b.typ !== 'OE') continue;
    const size = b.len + 2 * NAND_HEAD;
    if (b.load < NAND_WINDOW[0] || b.load + size > NAND_WINDOW[1]) continue;
    areas.push({ load: b.load, size, len: b.len, off: b.off, flags: b.flags, ver: b.ver });
  }
  areas.sort((x, y) => x.load - y.load);
  for (let i = 1; i < areas.length; i++) {
    const p = areas[i - 1];
    if (areas[i].load < p.load + p.size) throw new NandError(`NAND: the blocks of flags 0x${p.flags.toString(16)} (${h8(p.load)}, ${p.size} bytes) and 0x${areas[i].flags.toString(16)} (${h8(areas[i].load)}) overlap`);
  }
  return areas;
}
// The area that holds all of [addr, addr + n), or null.
export function areaOf(areas, addr, n) {
  for (const a of areas) if (addr >= a.load && addr + n <= a.load + a.size) return a;
  return null;
}
// Bytes [at, at + n) of an area's stored form, from the container (read(offset, length) -> Uint8Array): the head and
// the tail as the file has them, the body descrambled per aligned 16 bytes of the body (an unaligned tail of the body
// kept as it is, as olyfw.descramble does; flags 0 a plain body). areaBytes with a synchronous reader, areaBytesAsync
// with one that may answer a Promise (File.slice).
function areaPlan(area, at, n) {
  const o0 = at - area.load, o1 = o0 + n, body = [NAND_HEAD, NAND_HEAD + area.len], parts = [];
  if (o0 < 0 || o1 > area.size) throw new NandError(`NAND: ${h8(at)}+${n} is outside the area at ${h8(area.load)}`);
  const raw = (lo, hi) => { if (lo < hi) parts.push({ off: area.off + lo, len: hi - lo, to: lo - o0, from: 0, n: hi - lo, scrambled: false }); };
  raw(o0, Math.min(o1, body[0]));
  raw(Math.max(o0, body[1]), o1);
  const lo = Math.max(o0, body[0]), hi = Math.min(o1, body[1]);
  if (lo < hi) {
    const g0 = (lo - NAND_HEAD) & ~15, g1 = Math.min(area.len, (hi - NAND_HEAD + 15) & ~15);
    parts.push({ off: area.off + NAND_HEAD + g0, len: g1 - g0, to: lo - o0, from: lo - NAND_HEAD - g0, n: hi - lo, scrambled: area.flags !== 0 });
  }
  return parts;
}
function assemble(n, parts, raws) {
  const out = new Uint8Array(n);
  parts.forEach((p, i) => {
    const src = raws[i];
    if (src.length !== p.len) throw new NandError(`NAND: a read of ${p.len} bytes at file offset ${p.off} answered ${src.length}`);
    out.set((p.scrambled ? descramble(src) : src).subarray(p.from, p.from + p.n), p.to);
  });
  return out;
}
export function areaBytes(read, area, at, n) {
  const parts = areaPlan(area, at, n);
  return assemble(n, parts, parts.map((p) => read(p.off, p.len)));
}
export async function areaBytesAsync(read, area, at, n) {
  const parts = areaPlan(area, at, n), raws = [];
  for (const p of parts) raws.push(await read(p.off, p.len));
  return assemble(n, parts, raws);
}
// The NAND view of a container: {areas, read(addr, n)}, read answering the stored bytes of a range that lies inside
// one area, or null for a range that does not (a range across two areas or outside them all). read(offset, length) is
// the container's synchronous reader; blocks its walk (src/fw/olyfw.mjs).
export function nandSource(read, blocks) {
  const areas = nandAreas(blocks);
  return {
    areas,
    read(addr, n) {
      const a = areaOf(areas, addr >>> 0, n);
      return a ? areaBytes(read, a, addr >>> 0, n) : null;
    },
  };
}

// nandSource with a reader that may answer a Promise (File.slice): read(addr, n) answers a Promise.
export function nandSourceAsync(read, blocks) {
  const areas = nandAreas(blocks);
  return { areas, read: async (addr, n) => { const a = areaOf(areas, addr >>> 0, n); return a ? areaBytesAsync(read, a, addr >>> 0, n) : null; } };
}

// The view with the area at `load` taking its body from `body` (the lab's own copy of that block, env.resBlock: a
// patch overlay may have changed it, and the browser keeps a prefix of it), its head and tail from `source`. A read of
// the body past body's end is refused (NandError), as is a load no area has.
export function withBody(source, load, body) {
  const area = source.areas.find((a) => a.load === load);
  if (!area) throw new NandError(`NAND: no block is stored at ${h8(load)}`);
  if (body.length > area.len) throw new NandError(`NAND: a body of ${body.length} bytes for the block at ${h8(load)}, whose body has ${area.len}`);
  const end = load + area.size, b0 = load + NAND_HEAD, b1 = b0 + area.len;
  return {
    areas: source.areas,
    read(addr, n) {
      addr >>>= 0;
      if (addr < load || addr + n > end) return source.read(addr, n);
      const out = new Uint8Array(n), lo = Math.max(addr, b0), hi = Math.min(addr + n, b1);
      if (addr < b0) out.set(source.read(addr, Math.min(addr + n, b0) - addr), 0);
      if (addr + n > b1) { const t = Math.max(addr, b1); out.set(source.read(t, addr + n - t), t - addr); }
      if (lo < hi) {
        if (hi - b0 > body.length) throw new NandError(`NAND: ${h8(addr)}+${n} reads the block at ${h8(load)} past the ${body.length} bytes of it the lab holds`);
        out.set(body.subarray(lo - b0, hi - b0), lo - addr);
      }
      return out;
    },
  };
}

// ---- the extract the hosts keep in the container's place (the browser player's OPFS cache, node's unpacked/<code>:
// the blocks without the .BIN)

// The parts of the NAND a session reads: every area's head and tail; each indexed block's index area, its head and
// entries up to its first entry's data (X, E143: 2048 bytes at the resource block, 12288 at the images block, 1024 at
// the large-data block and 1024 to 3072 at its twelve sub-blocks, the loader's reads); each block an entry of an
// area's index names that begins with an OE head at its own address (the large-data block's twelve), walked the same
// way; and every record of at most RECORD_MAX bytes (X, E143: the lens data lookup 0x502ae5d9 reads one of 13824 bytes;
// 529 records, 3.1 MB, in the large-data block). A record above it (the large-data block's largest are megabytes) is
// not kept: a read of it from the extract throws. skip: the load addresses of areas whose body the lab holds itself
// (the resource block, env.resBlock), whose head and tail only are kept. read(addr, n): a NAND reader (nandSource's or
// nandSourceAsync's). {areas, spans: [[addr, bytes]]}, the spans in address order, merged where they overlap.
export const RECORD_MAX = 0x10000, INDEX_MAX = 0x10000;
export async function nandExtract(areas, read, { skip = [] } = {}) {
  const ranges = [];
  const add = (a, n) => { if (n > 0) ranges.push([a, a + n]); };
  const isBlock = async (address, size) => {
    if (size < NAND_HEAD) return false;
    const h = await read(address, NAND_HEAD);
    return !!h && h[0] === 0x4F && h[1] === 0x45 && u32(h, 8) === address;
  };
  const walkIndex = async (at, end, sub) => {
    const chunk = await read(at, Math.min(end - at, INDEX_MAX));
    const first = nandIndex(chunk.subarray(0, NAND_HEAD + INDEX_ENTRY)).entries[0];
    if (!first) { add(at, NAND_HEAD); return; }
    const len = first.address - at;
    if (len < NAND_HEAD + INDEX_ENTRY || len > chunk.length) throw new NandError(`NAND: the index at ${h8(at)}: its first entry's data at ${h8(first.address)}`);
    add(at, len);
    for (const { address, size } of nandIndex(chunk.subarray(0, len)).entries) {
      if (address < at + len || address + size > end) continue;
      if (sub && await isBlock(address, size)) await walkIndex(address, address + size, false);
      else if (size <= RECORD_MAX) add(address, size);
    }
  };
  for (const a of areas) {
    add(a.load, NAND_HEAD);
    add(a.load + a.size - NAND_HEAD, NAND_HEAD);
    if (!skip.includes(a.load)) await walkIndex(a.load, a.load + a.size, true);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [lo, hi] of ranges) {
    const last = merged.at(-1);
    if (last && lo < last[1]) last[1] = Math.max(last[1], hi); else merged.push([lo, hi]);
  }
  const spans = [];
  for (const [lo, hi] of merged) spans.push([lo, await read(lo, hi - lo)]);
  return { areas: areas.map(({ load, size, len, off, flags, ver }) => ({ load, size, len, off, flags, ver })), spans };
}
// An extract as bytes, and back: 'OMNX', u32 the JSON's length, the JSON ({version, areas, spans: [[addr, length]]}),
// then the spans' bytes in order.
export const EXTRACT_VERSION = 1;
export function encodeExtract(x) {
  const meta = new TextEncoder().encode(JSON.stringify({ version: EXTRACT_VERSION, areas: x.areas, spans: x.spans.map(([a, b]) => [a, b.length]) }));
  const total = 8 + meta.length + x.spans.reduce((t, [, b]) => t + b.length, 0), out = new Uint8Array(total);
  out.set([0x4F, 0x4D, 0x4E, 0x58]);
  new DataView(out.buffer).setUint32(4, meta.length, true);
  out.set(meta, 8);
  let o = 8 + meta.length;
  for (const [, b] of x.spans) { out.set(b, o); o += b.length; }
  return out;
}
export function decodeExtract(bytes) {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'OMNX') throw new NandError('not a NAND extract');
  const n = u32(bytes, 4), meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
  if (meta.version !== EXTRACT_VERSION) throw new NandError(`a NAND extract of version ${meta.version}, not ${EXTRACT_VERSION}`);
  let o = 8 + n;
  const spans = meta.spans.map(([a, len]) => { const b = bytes.subarray(o, o + len); o += len; return [a, b]; });
  if (o !== bytes.length) throw new NandError(`a NAND extract of ${bytes.length} bytes, its spans end at ${o}`);
  return { areas: meta.areas, spans };
}
// The NAND view of an extract: {areas, read(addr, n)}, as nandSource's, a read inside an area but outside the kept
// spans refused (NandError: the record is not in the extract).
export function extractSource(x) {
  const { areas, spans } = x;
  return {
    areas,
    read(addr, n) {
      addr >>>= 0;
      if (!areaOf(areas, addr, n)) return null;
      let lo = 0, hi = spans.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1, [a, b] = spans[m];
        if (addr < a) hi = m - 1;
        else if (addr >= a + b.length) lo = m + 1;
        else {
          if (addr + n > a + b.length) break;
          return b.slice(addr - a, addr - a + n);
        }
      }
      throw new NandError(`NAND: ${h8(addr)}+${n} is not in this host's extract of the NAND (src/fw/nand.mjs nandExtract: the heads, the indexes and the records of at most ${RECORD_MAX} bytes)`);
    },
  };
}

// An index the resource API reads (res_size 0x501a976d, res_version 0x501a971e, res_read 0x501a921f, D): the block's
// own 32-byte OE head, then 16-byte entries from +32. entries: those up to the first that is not {address, size, 0,
// 0} with an address other than 0 and 0xffffffff (an erased or empty slot ends the list); version: res_version's
// (head + 0x10) << 16.
export function nandIndex(bytes) {
  if (bytes.length < NAND_HEAD) throw new NandError(`an index of ${bytes.length} bytes has no head`);
  const entries = [];
  for (let o = NAND_HEAD; o + INDEX_ENTRY <= bytes.length; o += INDEX_ENTRY) {
    const address = u32(bytes, o), size = u32(bytes, o + 4);
    if (address === 0 || address === 0xFFFFFFFF || u32(bytes, o + 8) || u32(bytes, o + 12)) break;
    entries.push({ address, size });
  }
  return { typ: String.fromCharCode(bytes[0], bytes[1]), load: u32(bytes, 8), len: u32(bytes, 12),
    version: ((bytes[16] | bytes[17] << 8) << 16) >>> 0, flags: bytes[20] | bytes[21] << 8, entries };
}

// ---- the sound area

// A RIFF WAVE file's format and data (a fmt chunk, a data chunk), or a NandError naming what is missing.
export function wavInfo(wav) {
  const tag = (o) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  if (wav.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new NandError('not a RIFF WAVE file');
  const end = Math.min(wav.length, 8 + u32(wav, 4));
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= end;) {
    const id = tag(o), n = u32(wav, o + 4);
    if (o + 8 + n > end) throw new NandError(`the WAVE chunk ${JSON.stringify(id)} at ${o} runs past the file`);
    if (id === 'fmt ' && n >= 16) fmt = { format: wav[o + 8] | wav[o + 9] << 8, channels: wav[o + 10] | wav[o + 11] << 8, rate: u32(wav, o + 12), bits: wav[o + 22] | wav[o + 23] << 8 };
    if (id === 'data') data = { offset: o + 8, length: n };
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new NandError(`a WAVE file without ${fmt ? 'a data' : 'a fmt'} chunk`);
  return { ...fmt, data, riff: end };
}

// A lab-made WAVE file: PCM, 16-bit samples (an Int16Array, the channels interleaved), at rate frames per second.
export function pcmWav(samples, { rate = 48000, channels = 2 } = {}) {
  const n = samples.length * 2, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  const tag = (o, s) => { for (let k = 0; k < 4; k++) b[o + k] = s.charCodeAt(k); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * 2, true); dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + 2 * i, samples[i], true);
  return b;
}

// A sound-area image in the TG-7's format from sounds [{id, wav}] (ids 0..n-1, each once; wav a RIFF WAVE file's bytes,
// lab-made): the OE head (model, load, the body's length, version, flags SOUND_FLAGS), the entries from +32, entry 0's
// data at load + SOUND_INDEX and each next at the next SOUND_ALIGN boundary, sizes padded with zeros to SOUND_ALIGN,
// and the tail (the head with the checksum that makes the u32 sum of the whole image 0, as in the container). length:
// the image's whole length (head to tail; at least what the sounds need, a multiple of SOUND_ALIGN), the default just
// that. version: the head's (res_version answers it << 16); the OM-1's own area's is not known (?), 0x0100 is its other
// NAND blocks' (X).
export function soundArea(sounds, { load = SOUND_LOAD_E143, model = [0x14, 0x30], version = 0x0100, length = null } = {}) {
  const list = [...sounds].sort((x, y) => x.id - y.id);
  const max = (SOUND_INDEX - NAND_HEAD) / INDEX_ENTRY;
  if (!list.length || list.length > max) throw new NandError(`a sound area holds 1 to ${max} sounds, not ${list.length}`);
  list.forEach((s, i) => { if (s.id !== i) throw new NandError(`sound ids must be 0..${list.length - 1}, each once (got ${list.map((x) => x.id)})`); });
  const at = [];
  let end = SOUND_INDEX;
  for (const s of list) {
    wavInfo(s.wav);
    const size = Math.ceil(s.wav.length / SOUND_ALIGN) * SOUND_ALIGN;
    at.push([end, size]);
    end += size;
  }
  const need = Math.ceil((end + NAND_HEAD) / SOUND_ALIGN) * SOUND_ALIGN, total = length ?? need;
  if (total < need || total % SOUND_ALIGN) throw new NandError(`a sound area of ${total} bytes: the sounds need ${need}, a multiple of ${SOUND_ALIGN}`);
  const img = new Uint8Array(total), dv = new DataView(img.buffer), len = total - 2 * NAND_HEAD;
  const head = (o) => {
    img[o] = 0x4F; img[o + 1] = 0x45; img[o + 2] = model[0]; img[o + 3] = model[1];
    dv.setUint32(o + 8, load, true); dv.setUint32(o + 12, len, true); dv.setUint16(o + 16, version, true); dv.setUint16(o + 20, SOUND_FLAGS, true);
  };
  head(0);
  list.forEach((s, i) => {
    dv.setUint32(NAND_HEAD + INDEX_ENTRY * i, load + at[i][0], true);
    dv.setUint32(NAND_HEAD + INDEX_ENTRY * i + 4, at[i][1], true);
    img.set(s.wav, at[i][0]);
  });
  head(total - NAND_HEAD);
  dv.setUint32(total - 4, (-sum32(img)) >>> 0, true);
  return img;
}

// A sound area read back by the firmware's rules: its head (nandIndex) and, per entry, the bytes res_read of type 2
// reads from its address (entry size bytes; the firmware reads size + 1024, past the entry) and the WAVE file's format.
// A head that is not an OE head at its own load address, or an entry outside the image, is refused.
export function parseSoundArea(img, load = SOUND_LOAD_E143) {
  const ix = nandIndex(img.subarray(0, SOUND_INDEX));
  if (ix.typ !== 'OE' || ix.load !== load) throw new NandError(`the sound area's head: ${JSON.stringify(ix.typ)} at ${h8(ix.load)}, want OE at ${h8(load)}`);
  if (ix.len + 2 * NAND_HEAD > img.length) throw new NandError(`the sound area's head gives ${ix.len} bytes of body, the image has ${img.length}`);
  return {
    ...ix,
    sounds: ix.entries.map(({ address, size }, id) => {
      const o = address - load;
      if (o < SOUND_INDEX || o + size > img.length) throw new NandError(`sound ${id}: ${h8(address)}+${size} outside the area`);
      const bytes = img.subarray(o, o + size);
      return { id, address, size, bytes, wav: wavInfo(bytes) };
    }),
  };
}
