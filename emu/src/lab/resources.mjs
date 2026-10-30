// GUI bitmap resources and the language tables: the parts the lab runs (the resource
// block's index and record layout, the two image records (olycompress blobs decoded with the LZ4 block format, or
// stored plain), raw string and font records, StringTable's header checks, languages(), load()). The block (E143:
// blk02000000.OE.0101.bin) is passed in by the caller (env.resBlock), as the image is (env.rom); nothing here reads
// files.
import { ValueError, IndexError, UnicodeDecodeError } from './errors.mjs';
import { show } from '../util/show.mjs';
import { unpackFrom } from '../util/bytes.mjs';
import { A, MODEL, ON_LAB_MODEL, IMAGE_BASE, fact, refuseUnmapped } from '../fw/model.mjs';
import { imageView } from '../fw/image.mjs';
import { INDEX_READ } from '../fw/facts.mjs';

// where the loader copies the image records layout(block).images (icons, bitmaps): E143 0x501a8fe2, 0x501a8fec (D)
export const BLOB_LOADS = [A(0xA403D000), A(0xA45FD000)];
// [slot address, size limit] of a language's font and string records (E143 0x501a8f1c/0x501a8f35 and
// 0x501a917e/0x501a9197, D); another model's limits are its MODELS res facts
export const FONT_SLOT = [A(0xA4F63680), fact('res.font_limit', 0xC7C00)];
export const STRING_SLOT = [A(0xA502B680), fact('res.string_limit', 0x5FC00)];
export const STRING_RECORD_MAP = A(0x615A16A0), FONT_RECORD_MAP = A(0x615A1740);
// the strings per language in E143's tables, checked on the lab's model only; another model's count is not listed, its
// tables are checked for agreement with each other (layout)
export const STRING_COUNT = 4702, FONT_RECORD_SIZE = 74;
export const WIN_TAGS = { chs: 'zh-CN', cht: 'zh-TW', csy: 'cs', deu: 'de', enu: 'en', esp: 'es', fin: 'fi', fra: 'fr',
  ita: 'it', jpn: 'ja', nld: 'nl', nor: 'no', plk: 'pl', ptg: 'pt', rus: 'ru', sky: 'sk', sve: 'sv', tha: 'th' };
// the tags later bodies' firmware adds (OM-3: Turkish; the 34-language bodies the rest). A table's tag must be one of
// the two; the lab's model has WIN_TAGS' set exactly (languages), another model's set is not listed (unknown)
const LATER_TAGS = { trk: 'tr', bgr: 'bg', dan: 'da', ell: 'el', eti: 'et', hrv: 'hr', hun: 'hu', ind: 'id', kor: 'ko',
  lth: 'lt', lvi: 'lv', msl: 'ms', rom: 'ro', slv: 'sl', srb: 'sr', ukr: 'uk', vit: 'vi' };
const TAGS = { ...WIN_TAGS, ...LATER_TAGS };
const tagOf = (t) => (Object.hasOwn(TAGS, t) ? TAGS[t] : null);
// Strict UTF-16LE text (a leading U+FEFF kept): an odd length or an unpaired surrogate is a UnicodeDecodeError.
const UTF16 = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });
export function utf16Text(bytes) {
  try { return UTF16.decode(bytes); } catch { throw new UnicodeDecodeError(`not UTF-16LE text: ${show(bytes.slice(0, 64))}`); }
}


// One LZ4 block; decoding stops when the input ends or at least `size` bytes are out. The
// output is not cut at `size` (a run or match past it is kept and the caller checks the length), and reading
// past the input's end is IndexError.
export function lz4Block(src, size) {
  let out = new Uint8Array(size), o = 0;
  const room = (k) => {
    if (o + k <= out.length) return;
    const b = new Uint8Array(Math.max(2 * out.length, o + k));
    b.set(out.subarray(0, o)); out = b;
  };
  const n = src.length;
  const byte = (i) => { if (i >= n) throw new IndexError('index out of range'); return src[i]; };
  let i = 0;
  while (i < n) {
    const token = src[i++];
    let length = token >> 4;
    if (length === 15) { let b; do { b = byte(i++); length += b; } while (b === 255); }
    const lit = src.subarray(i, i + length);
    room(lit.length); out.set(lit, o); o += lit.length; i += length;
    if (i >= n || o >= size) break;
    const offset = byte(i) | byte(i + 1) << 8;
    i += 2;
    let match = token & 15;
    if (match === 15) { let b; do { b = byte(i++); match += b; } while (b === 255); }
    match += 4;
    if (!(offset > 0 && offset <= o)) throw new ValueError(`bad LZ4 offset ${offset} at input ${i}`);
    room(match);
    let s = o - offset;
    if (offset >= match) { out.copyWithin(o, s, s + match); o += match; }
    else { const end = o + match; while (o < end) out[o++] = out[s++]; }
  }
  return o === out.length ? out : out.slice(0, o);
}

const MAGIC = new TextEncoder().encode('olycompress');
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

// The block's index area: the firmware reads the block's 32-byte head and the index together, INDEX_READ bytes from
// the block's load address (E143 0x501a8dc7: mov <load>,a0; mov 2048,d0; D; the same read on every body,
// src/fw/facts.mjs resLoader), and record 0 follows the area (index entry 0 = load + INDEX_READ on all 32 bodies the
// update server serves, X). Byte 0 of the unpacked block is the first byte after the head (src/fw/olyfw.mjs).
const HEAD = 0x20;
export const INDEX_AREA = INDEX_READ - HEAD;
// [[address, size], ...] of the block's index, at most the area's 126 entries
export function index(block) {
  const entries = [];
  for (let i = 0; i < INDEX_AREA / 16; i++) {
    const [address, size, z1, z2] = unpackFrom('<IIII', block, 16 * i);
    if (!address || z1 || z2) break;
    entries.push([address, size]);
  }
  return entries;
}
const INDEX = new WeakMap();
function indexOf(block) {
  let o = INDEX.get(block);
  if (o === undefined) INDEX.set(block, o = { entries: index(block) });
  return o;
}
// Index entry `entry` [address, size]; a negative entry counts from the end. IndexError past either end.
function indexEntry(block, entry) {
  const e = Number.isInteger(entry) ? indexOf(block).entries.at(entry) : undefined;
  if (e === undefined) throw new IndexError(`index entry ${entry}: the index has ${indexOf(block).entries.length}`);
  return e;
}
// The address of block byte 0: index entry 0's address minus INDEX_AREA (IndexError when the index is empty).
export function origin(block) {
  const o = indexOf(block);
  return o.origin ??= indexEntry(block, 0)[0] - INDEX_AREA;
}
// The block's load address, where its head starts: the address the loader reads the index area from (src/fw/facts.mjs
// resLoader) and the head's own (src/fw/resprefix.mjs).
export const loadAddress = (block) => (origin(block) - HEAD) >>> 0;
// The stored bytes of index entry `entry` (a negative entry counts from the end).
export function raw_record(entry, block) {
  const org = origin(block), [address, size] = indexEntry(block, entry);
  return block.subarray(address - org, address - org + size);
}
// Entry `entry`'s data: LZ4-decoded when the stored record is an olycompress one (head: magic, u32 packed and raw
// sizes at +16, data at +0x20), otherwise the stored bytes (a plain block's).
export function record(entry, block) {
  const stored = raw_record(entry, block);
  if (!MAGIC.every((c, k) => stored[k] === c)) return stored;
  const [packed, raw] = unpackFrom('<II', stored, 16);
  const data = lz4Block(stored.subarray(0x20, 0x20 + packed), raw);
  if (data.length !== raw) throw new ValueError(`index entry ${entry}: ${data.length} bytes decoded, header says ${raw}`);
  return data;
}

// The records of an index of 2n + 2 entries {n, strings: [1, n], fonts: [n + 1, 2n], images: [0, 2n + 1]} (n
// languages; images: icons, bitmaps), as the loader's last-record test reads it (E143 `cmp 37,d2` at 0x501a9005, E134
// `cmp 69,d2` at block offset 0x151428, D). Refused unless records 1..n are string tables: a header {first, end} whose
// (end - first) / 4 strings are the same count in every language (they are on the 38-, 70- and 80-entry indexes of
// all 32 bodies the update server serves, X).
export function layout(block) {
  const o = indexOf(block);
  if (o.layout) return o.layout;
  const len = o.entries.length, n = (len - 2) / 2;
  if (!(Number.isInteger(n) && n > 0)) throw new ValueError(`resource index: ${len} entries, not 2n + 2`);
  const count = (e) => { const d = raw_record(e, block); return d.length >= 8 ? (u32(d, 4) - u32(d, 0)) / 4 : NaN; };
  const c1 = count(1);
  for (let e = 1; e <= n; e++) {
    const c = count(e);
    if (!(Number.isInteger(c) && c > 0 && c === c1)) throw new ValueError(`resource index: record ${e} of ${len} is not a string table like record 1 (${c} strings, record 1 ${c1})`);
  }
  return o.layout = { n, strings: [1, n], fonts: [n + 1, 2 * n], images: [0, 2 * n + 1] };
}

const BLOB_CACHE = new WeakMap();
// [[load address, data], ...] of the image records layout(block).images at BLOB_LOADS, read
// once per block. The icons record's word 0 is a pointer into itself (E143's: its base + 8; E144's: its icon table at
// record offset 0x5b1860, X, which E144's loader stores as such, D: src/fw/overrides-E144.mjs).
export function blobs(block) {
  let out = BLOB_CACHE.get(block);
  if (out) return out;
  out = layout(block).images.map((entry, i) => {
    const load = BLOB_LOADS[i];
    refuseUnmapped(load, `resource record ${entry}'s load address`);
    return [load, record(entry, block)];
  });
  const [load, data] = out[0], w0 = unpackFrom('<I', data)[0];
  if (!(w0 >= load && w0 < load + data.length)) throw new ValueError(`icons record: word 0 0x${w0.toString(16)} does not point into it (0x${load.toString(16)}+0x${data.length.toString(16)})`);
  BLOB_CACHE.set(block, out);
  return out;
}

// The string table's header checks (the lab needs the language tag only).
export class StringTable {
  constructor(entry, data) {
    const link = STRING_SLOT[0];
    this.entry = entry; this.data = data;
    const [first, end] = unpackFrom('<II', data, 0);
    this.count = Math.floor((end - first) / 4);
    if ((end - first) % 4 || (ON_LAB_MODEL && this.count !== STRING_COUNT)) {
      throw new ValueError(`string record ${entry}: index 0x${first.toString(16).padStart(8, '0')}..0x${end.toString(16).padStart(8, '0')}`);
    }
    this.pointers = unpackFrom(`<${this.count}I`, data, first - link);
    this.fonts = end;
    const name = data.subarray(end - link + FONT_RECORD_SIZE, end - link + 2 * FONT_RECORD_SIZE);
    // the tag is three word characters, and one of TAGS
    const m = /^OlympusLanguage_(\w{3})tft$/.exec(utf16Text(name.subarray(0, 66)).split('\0')[0]);
    if (!m || tagOf(m[1]) === null) throw new ValueError(`string record ${entry}: font record 1 name ${show(name.slice(0, 66))}`);
    this.tag = m[1]; this.lang = tagOf(m[1]);
    if (name.length <= 66) throw new IndexError(`string record ${entry}: font record 1 has ${name.length} bytes`);
    this.font_size = name[66];
  }
  // the UTF-16LE bytes of string sid, without the NUL unit, and its text
  raw(sid) {
    const o = this.pointers[sid] - STRING_SLOT[0];
    let end = o;
    while (!(this.data[end] === 0 && this.data[end + 1] === 0)) end += 2;
    return this.data.subarray(o, end);
  }
  text(sid) { return utf16Text(this.raw(sid)); }
}

// _map(image, address, '<IHH'): rows up to the key 0xFFFF0000 (ImageRangeError past the image's end).
function map(image, address) {
  const v = imageView(image, IMAGE_BASE, MODEL), out = [];
  for (let a = address; ; a += 8) {
    const key = v.u32(a);
    if (key === 0xFFFF0000) return out;
    out.push([key, v.u16(a + 4), v.u16(a + 6)]);
  }
}
const LANG_CACHE = new WeakMap();
// [{setting, strings_record, font_record, win, lang}] in table order: one row per language of
// layout(block), each font record n after its strings.
export function languages(image, block) {
  let per = LANG_CACHE.get(image);
  if (!per) LANG_CACHE.set(image, per = new WeakMap());
  let out = per.get(block);
  if (out) return out;
  const strings = new Map(), fonts = new Map();
  for (const [k, r] of map(image, STRING_RECORD_MAP)) strings.set(k, r);
  for (const [k, kind, r] of map(image, FONT_RECORD_MAP)) if (kind === 1) fonts.set(k, r);
  const { n } = layout(block);
  if (strings.size !== n) throw new ValueError(`languages: ${strings.size} rows in the string map, the resource index has ${n}`);
  out = [];
  for (const [setting, record] of strings) {
    const table = new StringTable(record, raw_record(record, block));
    if (fonts.get(setting) !== record + n) throw new ValueError(`setting ${setting}: font record ${show(fonts.get(setting))} != strings ${record} + ${n}`);
    out.push({ setting, strings_record: record, font_record: fonts.get(setting), win: table.tag, lang: table.lang });
  }
  const got = out.map((o) => o.lang).sort(), want = Object.values(WIN_TAGS).sort();
  if (new Set(got).size !== got.length || (ON_LAB_MODEL && JSON.stringify(got) !== JSON.stringify(want))) throw new ValueError(`languages: ${show(out.map((o) => o.lang))}`);
  per.set(block, out);
  return out;
}

// Write both blobs into guest DRAM (cached view), one Simulator.write each.
export function load(sim, block) {
  for (const [address, data] of blobs(block)) sim.write(((address & 0x3FFFFFFF) | 0x40000000) >>> 0, data);
}
// Whether the two image records overlap where the loader puts them (src/fw/facts.mjs resLoader, D; the sizes from the
// records' heads, X): E118's icons record ends 0x400 bytes past the bitmaps record's load address, over the end of
// its font table, whose records the GUI's start searches (docs/model-survey.md finding 44 has the addresses). The
// firmware loads each record when it is asked for, the icons record at the GUI's start and the bitmaps record later
// (X: the lab's requests), so what it reads after a request is that record's; on such a body the lab writes a record
// again at its request (rewrite), after load()'s write of both. No other body's records overlap (X: the 17 others'
// bitmaps loads lie past their icons record's end).
export function overlap(block) {
  const [[a0, d0], [a1, d1]] = blobs(block);
  return a0 < a1 + d1.length && a1 < a0 + d0.length;
}
export function rewrite(sim, block, i) {
  const [address, data] = blobs(block)[i];
  sim.write(((address & 0x3FFFFFFF) | 0x40000000) >>> 0, data);
}
