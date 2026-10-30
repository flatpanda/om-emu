// Facts of a build read from its firmware by a rule, as pure functions of the bytes (no model state: this module
// imports nothing from model.mjs, so bin/port.mjs and the tests can run each rule on any body). readFacts runs them
// all for one body: bin/port.mjs writes its result as src/fw/ports.mjs FACTS[code], and test/test_facts.mjs checks the
// rules against values found without them. readPlacedFacts runs the rules that also need an E143 function's place in
// the build (the port's), which bin/port.mjs adds to FACTS[code].
import { insnLength } from '../core/cpu.mjs';

const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const s32 = (b, o) => u32(b, o) | 0;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// The call at offset o of img, in its four forms (call d16 / d32, calls d16 / d32): {len, to}, to the callee's offset
// (o + the displacement), or null. The rules here, src/fw/place.mjs and src/fw/knobs.mjs decode calls with it;
// src/fw/xmap.mjs transferTarget decodes the same forms and the jumps for the map, a copy of its own because its bytes
// are the map cache's key (bin/port.mjs cachedMap).
export function callAt(img, o) {
  const op = img[o], o2 = img[o + 1], s16 = (k) => (img[k] | img[k + 1] << 8) << 16 >> 16;
  if (op === 0xdd) return { len: 7, to: o + s32(img, o + 1) };
  if (op === 0xcd) return { len: 5, to: o + s16(o + 1) };
  if (op === 0xfc && o2 === 0xff) return { len: 6, to: o + s32(img, o + 2) };
  if (op === 0xfa && o2 === 0xff) return { len: 4, to: o + s16(o + 2) };
  return null;
}
// The value at a dotted path ('kernel.cpus') of an object (readFacts' result, a MODELS entry): undefined where a step
// is missing (src/fw/model.mjs fact(), src/fw/place.mjs carryOverrides).
export const valueAt = (o, path) => path.split('.').reduce((v, k) => (v != null && Object.hasOwn(v, k) ? v[k] : undefined), o);

// The run-time base of a main code block (MODELS image_base): {base, at, target}. The reset head runs in place from
// flash and leaves it with one absolute jump into its run-time copy, `mov imm32,a0; jmp (a0)` (fc dc imm32 f0 f4),
// exactly once in the block's first 0x400 bytes (X, all 32 unpacked bodies; D, e.g. E143 0x50000082 -> 0x600210c5,
// E144 0x500000b6 -> 0x600210f9, E129 0x500000b6 -> 0x604000f9). The target lies in the copy's first page and the
// copy starts at page offset 0x020: base = (target & ~0xfff) | 0x020, which gives bin/fw-survey.mjs's statistical
// base on all 32 (X). Why 0x020: the 32-byte container head before the body at a 64 KiB-aligned flash load (I).
// Throws when the head has no such jump, more than one, or a target below the page offset.
export const RESET_HEAD = 0x400, BASE_PAGE_OFFSET = 0x020;
export function imageBase(rom) {
  const hits = [];
  for (let o = 0; o + 8 <= Math.min(RESET_HEAD, rom.length); o++) {
    if (rom[o] === 0xfc && rom[o + 1] === 0xdc && rom[o + 6] === 0xf0 && rom[o + 7] === 0xf4) hits.push(o);
  }
  if (hits.length !== 1) throw new Error(`imageBase: ${hits.length} 'mov imm32,a0; jmp (a0)' in the reset head's first 0x${RESET_HEAD.toString(16)} bytes, want 1`);
  const at = hits[0], target = u32(rom, at + 2);
  if ((target & 0xfff) < BASE_PAGE_OFFSET) throw new Error(`imageBase: the reset jump at 0x${at.toString(16)} targets ${h8(target)}, below its page's offset 0x${BASE_PAGE_OFFSET.toString(16)}`);
  return { base: ((target & ~0xfff) | BASE_PAGE_OFFSET) >>> 0, at, target };
}

// DRAM's uncached view: 0xA0000000.. is the same RAM as 0x60000000.. (src/machine.mjs regions); a copy names its
// destination in either view, the image's rows use the cached one. cached(a): a DRAM address's cached view; alias(a):
// its other view (bin/port.mjs places an address by its alias's vote)
export const cached = (a) => (a >= 0xA0000000 && a < 0xC0000000 ? a - 0x40000000 : a) >>> 0;
export const alias = (a) => (a >= 0xA0000000 ? a - 0x40000000 : a + 0x40000000) >>> 0;
const bytesAt = (b, o, pat) => pat.every((x, k) => x === null || b[o + k] === x);
// a ret or a retf (df / de, three bytes: a rule's "after a return" looks three bytes back); rets (f0 fc), which no
// rule has met at a function's end, is not counted
const isRet = (img, o) => img[o] === 0xdf || img[o] === 0xde;
// the offsets of a string's bytes in an image: nul, also its terminating NUL; after, also a NUL before it (a string of
// its own, not the tail of another)
const findString = (img, str, { nul = false, after = false } = {}) => {
  const s = new TextEncoder().encode(nul ? str + '\0' : str), at = [];
  for (let o = img.indexOf(s[0]); o >= 0; o = img.indexOf(s[0], o + 1)) if (bytesAt(img, o, s) && (!after || img[o - 1] === 0)) at.push(o);
  return at;
};
const hasString = (img, str) => findString(img, str).length > 0;
// the value a `mov imm32,Rn` (fc cc..cf: Dn, fc dc..df: An) at p loads, or null; the offsets of the loads of v
const loadAt = (img, p) => (img[p] === 0xfc && (img[p + 1] & 0xec) === 0xcc ? u32(img, p + 2) : null);
const loadsOf = (img, v) => {
  const at = [];
  for (let p = img.indexOf(0xfc); p >= 0; p = img.indexOf(0xfc, p + 1)) if (loadAt(img, p) === v) at.push(p);
  return at;
};
// the offsets of the `movhu (abs32),Dn` loads (fc ac..af) of word (null: of any word): of d0 only, or with anyReg,
// of any Dn
const halfLoads = (img, word, anyReg = false) => {
  const at = [];
  for (let p = img.indexOf(0xfc); p >= 0 && p + 6 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    if ((anyReg ? img[p + 1] & 0xfc : img[p + 1]) === 0xac && (word === null || u32(img, p + 2) === word)) at.push(p);
  }
  return at;
};
// the calls (callAt) whose callee's offset want(to) accepts, as {at, len, to}, in the order of at; callsTo: the
// offsets of the calls of the offset to. An image's calls are found once (callScan; the rules do not change an image)
const callScans = new WeakMap();
function callScan(img) {
  if (callScans.has(img)) return callScans.get(img);
  const at = [], len = [], to = [];
  for (let p = 0; p + 7 <= img.length; p++) { const c = callAt(img, p); if (c) { at.push(p); len.push(c.len); to.push(c.to); } }
  const scan = { at: Int32Array.from(at), len: Uint8Array.from(len), to: Float64Array.from(to) };
  callScans.set(img, scan);
  return scan;
}
const callsWhere = (img, want) => {
  const { at, len, to } = callScan(img), out = [];
  for (let i = 0; i < at.length; i++) if (want(to[i])) out.push({ at: at[i], len: len[i], to: to[i] });
  return out;
};
const callsTo = (img, to) => callsWhere(img, (t) => t === to).map((c) => c.at);

// The reset head's copies out of the main block, for a board whose head copies with a flash-copy routine
// (src/fw/board.mjs reset_head 'flash-copy'): {entry, flash_base, copies, library, preload}. The rule (X, all 15
// E144- and E118-family bodies; test/test_facts.mjs checks it against E144's library and preload as given by hand
// before its port, D, and the board survey's rows of the 14 tier A-C bodies, X):
// - the init function is the reset jump's target (imageBase); it is walked straight through to its ret, tracking the
//   immediate register forms it uses (mov imm, mov to/from abs32, add imm, register moves) and every call's a0/a1/d0/d1;
// - each call with a0 in flash (0x40000000..0x48000000) and a1 in RAM is a flash copy [a0 -> a1], all to one routine;
//   its length is d0, or d1 when every such call passes d0 = 0 (E125, E129, E130, E132, E133, E118, E120, E122);
// - the first copy into the image's run-time span fixes the flash address of block byte 0, `flash_base`, which sits
//   at a 64 KiB boundary + 0x020 like the run-time base (X, all 15); a copy whose destination is base + its file offset
//   lands in place (E144 0x500001d9: flash 0x4078f000 -> 0x60030000); one whose source lies outside the block is
//   'outside' (E118/E120/E122's flash 0x40060000: no .BIN block holds it, the lab cannot load it);
// - the word loop `mov (a1),d2; inc4 a1; mov d2,(a2); inc4 a2; sub d1,d0; bgt` over d0 = a0 - a1 bytes (E144
//   0x50000111) copies image data to RAM: preload row 0; every other flash copy within the block is a further row;
// - the loop `setlb; mov (a1),d0; inc4 a1; mov d0,(a0); inc4 a0; inc d1; cmp N,d1; lcs` (E144 0x50000284, N 1536)
//   copies the RAM copy of one flash copy (the library's) into the flash library's window: library {base:
//   destination & ~0xFFFF (I: the window E144's early stack 0x470007fc shares), size: page offset + length, image:
//   [file offset, length, page offset]}.
// copies: [{at, flash, file, dst, len, kind: 'in-place' | 'preload' | 'library' | 'outside'}] (at: the call's block
// offset; flash null for the word loop); library null when the head has no setlb loop; preload [[file offset, length,
// run-time address]] (src/fw/expand.mjs relocate). Throws when the walk finds no ret, no flash copy into the image,
// copies to more than one routine, or a library copy it cannot pair.
const HEAD_WALK = 400;
const WORD_LOOP = [0x79, 0x51, 0x6a, 0x52, 0xf1, 0x04, 0xc1, 0xfa];
const SETLB_LOOP = [0xdb, 0x71, 0x51, 0x60, 0x50, 0x44, 0xfa, 0xc9, null, null, 0xd4];
export function resetHead(img) {
  const { base, target } = imageBase(img);
  const s16 = (o) => (img[o] | img[o + 1] << 8) << 16 >> 16;
  const R = { d0: null, d1: null, d2: null, d3: null, a0: null, a1: null, a2: null, a3: null };
  const D = ['d0', 'd1', 'd2', 'd3'], An = ['a0', 'a1', 'a2', 'a3'], mem = new Map();
  const kill = (...rs) => rs.forEach((r) => { R[r] = null; });
  const add = (r, k) => { R[r] = R[r] === null ? null : (R[r] + k) >>> 0; };
  const calls = [], words = [], setlb = [];
  let p = target - base, done = false;
  for (let n = 0; n < HEAD_WALK; n++) {
    const op = img[p], o2 = img[p + 1], call = callAt(img, p);
    let len;
    if (bytesAt(img, p, WORD_LOOP)) {
      words.push({ at: p, src: R.a1, end: R.a0, dst: R.a2 }); kill('d0', 'd1', 'd2'); len = WORD_LOOP.length;
    } else if (bytesAt(img, p, SETLB_LOOP)) {
      setlb.push({ at: p, src: R.a1, dst: R.a0, len: (img[p + 8] | img[p + 9] << 8) * 4 }); kill('d0', 'd1', 'a0', 'a1'); len = SETLB_LOOP.length;
    } else if (op === 0xfc && (o2 & 0xfc) === 0xcc) { R[D[o2 & 3]] = u32(img, p + 2); len = 6; }                  // mov imm32,Dn
    else if (op === 0xfc && (o2 & 0xfc) === 0xdc) { R[An[o2 & 3]] = u32(img, p + 2); len = 6; }                   // mov imm32,An
    else if (op === 0xfc && (o2 & 0xf3) === 0x81) { mem.set(u32(img, p + 2), R[D[o2 >> 2 & 3]]); len = 6; }       // mov Dm,(abs32)
    else if (op === 0xfc && (o2 & 0xf3) === 0x82) len = 6;                                                        // movbu Dm,(abs32)
    else if (op === 0xfc && (o2 & 0xfc) === 0xa4) { R[D[o2 & 3]] = mem.get(u32(img, p + 2)) ?? null; len = 6; }    // mov (abs32),Dn
    else if (op === 0xfc && (o2 & 0xfc) === 0xc0) { add(D[o2 & 3], u32(img, p + 2)); len = 6; }                   // add imm32,Dn
    else if (op === 0xfc && (o2 & 0xfc) === 0xd0) { add(An[o2 & 3], u32(img, p + 2)); len = 6; }                  // add imm32,An
    else if (op >= 0x2c && op <= 0x2f) { R[D[op & 3]] = s16(p + 1) >>> 0; len = 3; }                              // mov imm16,Dn
    else if (op >= 0x24 && op <= 0x27) { R[An[op & 3]] = img[p + 1] | img[p + 2] << 8; len = 3; }                 // mov imm16,An
    else if (op >= 0x80 && op <= 0x9f && (op >> 2 & 3) === (op & 3)) { R[(op < 0x90 ? D : An)[op & 3]] = (img[p + 1] << 24 >> 24) >>> 0; len = 2; }   // mov imm8
    else if (op >= 0x80 && op <= 0x9f) { const r = op < 0x90 ? D : An; R[r[op & 3]] = R[r[op >> 2 & 3]]; len = 1; } // mov Rm,Rn
    else if (op <= 0x0c && (op & 3) === 0) { R[D[op >> 2]] = 0; len = 1; }                                        // clr Dn
    else if (op === 0xf1 && o2 === 0xd0) { R.d0 = R.a0; len = 2; }                                                // mov a0,d0
    else if (op === 0xf1 && o2 === 0x14) { R.d0 = R.d0 === null || R.a1 === null ? null : (R.d0 - R.a1) >>> 0; len = 2; }   // sub a1,d0
    else if (call) {                                                                                              // call, calls
      calls.push({ at: p, to: call.to, a0: R.a0, a1: R.a1, d0: R.d0, d1: R.d1 });
      kill('d0', 'd1', 'a0', 'a1'); len = call.len;
    } else if ((op === 0xf0 && (o2 === 0xfc || o2 === 0xfd)) || op === 0xde || op === 0xdf) { done = true; break; }   // rets, retf, ret
    else if ((op >= 0x40 && op <= 0x4f && (op & 3) >= 2) || (op >= 0xc0 && op <= 0xca) || op === 0xce || op === 0xcf) len = 2;   // mov to (d8,sp), branches, movm
    else if (op === 0xcb) len = 1;
    else if (op === 0xf8 && o2 === 0xfe) len = 3;                                                                 // add imm8,sp
    else if (op === 0xfa && o2 === 0xfe) len = 4;                                                                 // add imm16,sp
    else { len = insnLength(op, o2); kill('d0', 'd1'); }
    p += len;
  }
  if (!done) throw new Error(`resetHead: no ret within ${HEAD_WALK} instructions of the init function at ${h8(target)}`);
  const flash = calls.filter((c) => c.a0 !== null && c.a1 !== null && c.a0 >= 0x40000000 && c.a0 < 0x48000000);
  if (!flash.length) throw new Error('resetHead: no flash copy');
  if (new Set(flash.map((c) => c.to)).size !== 1) throw new Error(`resetHead: flash copies to ${new Set(flash.map((c) => c.to)).size} routines, want 1`);
  const lenReg = flash.every((c) => c.d0 === 0) ? 'd1' : 'd0';
  const rows = flash.map((c) => ({ at: c.at, flash: c.a0, dst: cached(c.a1), len: c[lenReg] }));
  const first = rows.find((r) => r.dst >= base && r.dst < base + img.length);
  if (!first) throw new Error('resetHead: no flash copy into the run-time image, so no flash address for block byte 0');
  const flash_base = (first.flash - (first.dst - base)) >>> 0;
  if ((flash_base & 0xffff) !== BASE_PAGE_OFFSET) throw new Error(`resetHead: flash address of block byte 0 ${h8(flash_base)} is not at a 64 KiB boundary + 0x${BASE_PAGE_OFFSET.toString(16)}`);
  if (setlb.length > 1 || words.length > 1) throw new Error(`resetHead: ${words.length} word loops and ${setlb.length} setlb loops, want at most 1 each`);
  const lib = setlb[0] && rows.filter((r) => r.dst === cached(setlb[0].src));
  if (lib && lib.length !== 1) throw new Error(`resetHead: ${lib.length} flash copies to the library loop's source ${h8(setlb[0].src)}, want 1`);
  const copies = [], preload = [];
  for (const w of words) {
    if (w.src === null || w.end === null || w.dst === null || w.src < base || w.end > base + img.length) throw new Error(`resetHead: the word loop at ${h8(0x50000000 + w.at)} copies no image span`);
    const row = { at: w.at, flash: null, file: w.src - base, dst: cached(w.dst), len: w.end - w.src, kind: 'preload' };
    copies.push(row); preload.push([row.file, row.len, row.dst]);
  }
  for (const r of rows) {
    const file = (r.flash - flash_base) >>> 0;
    const kind = lib?.[0] === r ? 'library' : r.dst === base + file ? 'in-place' : file + r.len > img.length ? 'outside' : 'preload';
    copies.push({ ...r, file, kind });
    if (kind === 'preload') preload.push([file, r.len, r.dst]);
  }
  let library = null;
  if (lib) {
    const { dst, len } = setlb[0], at = dst & 0xffff, file = copies.find((c) => c.kind === 'library').file;
    library = { base: (dst - at) >>> 0, size: at + len, image: [file, len, at] };
  }
  return { entry: target, flash_base, copies, library, preload };
}

// The address of the board's core byte (src/fw/board.mjs core_byte, which the lab's core-id getter returns): the
// operand of the one getter `movbu (abs32),d0; retf` (fc a8 abs32 de 00 00) whose abs32 lies in the SRAM sram..sram +
// size (E144 0x5000276d: movbu (0x8ff00198),d0, D; one per body on the E144 and E118 families, X). Throws unless
// exactly one.
export function coreByte(img, sram, size) {
  const hits = [];
  for (let o = img.indexOf(0xfc); o >= 0 && o + 9 <= img.length; o = img.indexOf(0xfc, o + 1)) {
    if (img[o + 1] !== 0xa8 || img[o + 6] !== 0xde || img[o + 7] !== 0 || img[o + 8] !== 0) continue;
    const a = u32(img, o + 2);
    if (a >= sram && a < sram + size) hits.push({ at: o, a });
  }
  if (hits.length !== 1) throw new Error(`coreByte: ${hits.length} 'movbu (abs32),d0; retf' getters of the SRAM ${h8(sram)}+0x${size.toString(16)}, want 1${hits.length ? ': ' + hits.map((h) => `${h8(0x50000000 + h.at)} -> ${h8(h.a)}`).join(', ') : ''}`);
  return hits[0].a;
}

// The interrupt vectors' page (src/fw/board.mjs vector_page, the high half an accepted interrupt's vector takes over
// its IVAR's low half, src/core/cpu.mjs execInterrupt): the high half of the level slots' run-time addresses the
// vector init loads, seven `mov imm32,Dn; movhu Dn,(0x80LL)` (fc cc+n imm32 03+4n 4L 80) for levels 0..6 in a row,
// then the last one's whole word to `(0x801c)` (01+4n 1c 80). E143's vector init writes 0x60030020..0x60030080
// (0x5000f09b..0x5000f0da, called by reset at 0x500001ec, D); E144's and E133's reset heads write them inline at
// 0x5000006c..0x500000ab, E144's in page 0x6003, E133's in 0x6041 (D). One such run on the E143 family; three on the
// E144 and E118 families, the reset head's first, and two later ones in other pages (E133 0x6043, 0x604b) in code past
// the head that sets its own stack and interrupt registers (E133 0x50006067..0x5000609c, D) and that the lab does not
// run; which CPU runs it is not read. The first run's page holds the level slots the port places on every ported
// body (X). Which register gives the core the high half is not known (docs/om1-intc-timer-spec.md A-VEC). Returns the
// page; throws where no run is found or the run's seven words lie in more than one page.
const IVAR_RUN = 7, IVAR_PAIR = 9;
export function vectorPage(img) {
  const pairAt = (o, level) => {
    const n = img[o + 1] - 0xcc;
    return img[o] === 0xfc && n >= 0 && n < 4 && img[o + 6] === 0x03 + 4 * n && img[o + 7] === 4 * level && img[o + 8] === 0x80 ? n : -1;
  };
  for (let o = img.indexOf(0xfc); o >= 0 && o + IVAR_RUN * IVAR_PAIR + 3 <= img.length; o = img.indexOf(0xfc, o + 1)) {
    const regs = Array.from({ length: IVAR_RUN }, (_, level) => pairAt(o + level * IVAR_PAIR, level));
    const last = o + IVAR_RUN * IVAR_PAIR, n = regs[IVAR_RUN - 1];
    if (regs.includes(-1) || img[last] !== 0x01 + 4 * n || img[last + 1] !== 0x1c || img[last + 2] !== 0x80) continue;
    const pages = new Set(regs.map((_, level) => u32(img, o + level * IVAR_PAIR + 2) & 0xffff0000));
    if (pages.size !== 1) throw new Error(`vectorPage: the IVAR run at ${h8(0x50000000 + o)} loads the pages ${[...pages].map(h8).join(', ')}, want one`);
    return [...pages][0] >>> 0;
  }
  throw new Error('vectorPage: no run of the seven IVAR stores and the store to (0x801c)');
}

// The resource loader's slots: where it copies a language's font and string records and the two image records
// (src/lab/resources.mjs FONT_SLOT, STRING_SLOT, BLOB_LOADS) and the slots' size limits. The loader reads the
// block's 32-byte head and index as INDEX_READ bytes from the block's load address, `mov <load>,a0; ..; mov
// 2048,d0` (E143 0x501a8dc7, E134 0x501511cd, E118 0x50280327, D); the functions after it hold, in this order (E143:
// D; the same order and shapes on the 4 committed models, the 11 E144-family and the 3 E118-family bodies, X):
// - the font slot: `mov slot,d0; call F; mov d0,(abs32); mov (abs32),d0; cmp limit,d0` (fc cc slot dd .. fc 81 ..
//   fc a4 .. fc c8 limit; E143 0x501a8f1c, limit at 0x501a8f35);
// - the image records' destinations, chosen by the record number: `cmp 0,dK; bne L; ..; mov first,dR; bra M;
//   L: ..; mov last,dR` (E143 0x501a8fdd: 0xa403d000 for record 0, 0xa45fd000 for the last);
// - the string slot, the same shape as the font slot's with the same F (E143 0x501a917e, limit at 0x501a9197).
// resLoad: the block's load address (src/lab/resources.mjs loadAddress). Returns {at, font: {slot, limit, at},
// images: {first, last, at}, string: {slot, limit, at}} (at: block offsets). Throws unless the index read is found
// once and the span after it holds exactly these three shapes in this order.
export const INDEX_READ = 0x800, LOADER_SPAN = 0x800;   // the span: E143's string limit is 0x3d0 bytes after the index read
export function resLoader(img, resLoad) {
  const anchors = [];
  const mov = [0xfc, 0xdc, resLoad & 0xff, resLoad >>> 8 & 0xff, resLoad >>> 16 & 0xff, resLoad >>> 24];
  for (let o = img.indexOf(0xfc); o >= 0; o = img.indexOf(0xfc, o + 1)) {
    if (!bytesAt(img, o, mov)) continue;
    // the length within the next three instructions: mov 2048,d0 (2c 00 08)
    for (let q = o + 6, k = 0; k < 3; k++, q += insnLength(img[q], img[q + 1])) if (bytesAt(img, q, [0x2c, INDEX_READ & 0xff, INDEX_READ >> 8])) { anchors.push(o); break; }
  }
  if (anchors.length !== 1) throw new Error(`resLoader: ${anchors.length} index reads 'mov ${h8(resLoad)},a0; mov 2048,d0', want 1`);
  const at = anchors[0], end = Math.min(at + LOADER_SPAN, img.length - 32), slots = [], images = [];
  for (let o = at; o < end; o++) {
    if (img[o] === 0xfc && img[o + 1] === 0xcc && img[o + 6] === 0xdd && bytesAt(img, o + 13, [0xfc, 0x81]) && bytesAt(img, o + 19, [0xfc, 0xa4]) && bytesAt(img, o + 25, [0xfc, 0xc8])) {
      slots.push({ slot: u32(img, o + 2), limit: u32(img, o + 27), call: o + 6 + s32(img, o + 7), at: o });
    }
    const c = img[o];
    if (c >= 0xa0 && c <= 0xaf && (c >> 2 & 3) === (c & 3) && img[o + 1] === 0 && img[o + 2] === 0xc9 && img[o + 3] === 0x0b &&
        img[o + 5] === 0xfc && (img[o + 6] & 0xfc) === 0xcc && img[o + 11] === 0xca && img[o + 12] === 0x0a &&
        img[o + 15] === 0xfc && img[o + 16] === img[o + 6]) {
      images.push({ first: u32(img, o + 7), last: u32(img, o + 17), at: o });
    }
  }
  if (slots.length !== 2 || images.length !== 1 || !(slots[0].at < images[0].at && images[0].at < slots[1].at) || slots[0].call !== slots[1].call) {
    throw new Error(`resLoader: after the index read at ${h8(0x50000000 + at)}: ${slots.length} slot loads (want 2, one call) and ${images.length} image-record selects (want 1, between them)`);
  }
  const [font, string] = slots.map(({ slot, limit, at: o }) => ({ slot, limit, at: o }));
  return { at, font, images: images[0], string };
}

// Whether the build's menus are the ListMenu framework, whose tab and page tables src/lab/menudata.mjs decodes
// (src/lab/menu.mjs, fact 'menu.list_menu'): the image holds the trace strings of its tab menu's classes,
// "Menu_ListMenu_Tab_Menu_VM_Actuator::Initialize .." and "Menu_ListMenu_Tab_Menu_Viewer not supprt .." (E143 block
// offsets 0x1506274 and 0x150c7ca, D; the first lies 0x68 bytes past E143's tab table at 0x6152722c). E143, E146 and
// E147 hold both; the 12 E144-family and the 3 E118-family bodies hold no "ListMenu" string at all, their menus being
// the older Menu_Viewer / Cursor_2CNL classes (X, a string count over each expanded image).
export const listMenu = (img) => hasString(img, 'Menu_ListMenu_Tab_Menu_');

// The ListMenu open's tab and page memories (facts 'menu.tab_memory', 'menu.page_memory'; src/lab/menu.mjs
// MENU_MEMORY): opening at the remembered place, it reads the tab's store id, then the page's, each through the
// settings object's vtable +12 into a stack word and stores it less one, `mov sp,a1; mov (12,a2),a2; add 8,a1; mov
// tab,d0; calls (a2); mov (8,sp),d0; mov 1,d1; sub d1,d0`, and 0x20 bytes on the same with 12 and the page (E143
// 0x511bd15d: 1881, 1882, the tab index stored at (86,a3), D). Found once on E143 (1881, 1882), E146 (1881, 1882, at
// 0x511cbf58) and E147 (1909, 1910, at 0x511ddabc, D), the bodies with ListMenu, and on none of the 15 others (X, a
// byte scan of each expanded image). Returns {tab_memory, page_memory}, or undefined where no such pair is found;
// throws for two.
const memRead = (sp) => [0x3d, 0xf8, 0x2a, 0x0c, 0x21, sp, 0x2c, null, null, 0xf0, 0xf2, 0x58, sp, 0x85, 0x01, 0xf1, 0x04];
const MEM_TAB = memRead(0x08), MEM_PAGE = memRead(0x0c), MEM_GAP = 0x20;
export function menuMemory(img) {
  const found = [];
  for (let o = img.indexOf(0x3d); o >= 0; o = img.indexOf(0x3d, o + 1)) {
    if (bytesAt(img, o, MEM_TAB) && bytesAt(img, o + MEM_GAP, MEM_PAGE)) found.push(o);
  }
  if (!found.length) return undefined;
  if (found.length > 1) throw new Error(`menuMemory: tab and page memory reads at ${found.map((o) => h8(0x50000000 + o)).join(', ')}, want one`);
  const id = (o) => img[o + 7] | img[o + 8] << 8;
  return { tab_memory: id(found[0]), page_memory: id(found[0] + MEM_GAP) };
}

// The GUI task's take of a message (fact 'menu.take', and through bin/port.mjs the place of E143's take GUI_TAKE_E143
// 0x510c2a2e, src/lab/menu.mjs DISPATCH, whose observer reads the message at (396,sp)): the task receives into its
// frame in a loop, `mov sp,a3; add 396,a3; mov 32768,dN; mov a3,a0; mov -1,d0; call; exth d0; cmp 0,d0; beq` back to
// the `mov a3,a0`, and then loads the message, `mov (396,sp),d0`. The take is the instruction after that load: E143's
// call 0x510c2a2e (loop 0x510c2a1b..28), E144's call 0x50d1c54d, E139's 0x50cc49a6, E134's `cmp d3,d0` 0x50d04704,
// which has no call between the load and the compare (D). dN is d3, or d2 on E144, E145 and E122. One such loop on
// each of the 18 expanded images but E118 and E120, whose loops have no a3 = sp + 396 before them, and on E146, E147,
// E144 and E139 the take is where their maps placed E143's (X, a byte scan). Returns the take (disassembly notation),
// or undefined for none; throws for two.
const TAKE_LOOP = [0x3f, 0xfa, 0xd3, 0x8c, 0x01, 0xfc, null, 0x00, 0x80, 0x00, 0x00, 0x9c, 0x80, 0xff];
const TAKE_TEST = [0x18, 0xa0, 0x00, 0xc8, 0xf3], TAKE_LOAD = [0xfa, 0xb4, 0x8c, 0x01];
export const GUI_TAKE_E143 = 0x510C2A2E;
export function guiTake(img) {
  const found = [];
  for (let o = img.indexOf(0x3f); o >= 0; o = img.indexOf(0x3f, o + 1)) {
    if (!bytesAt(img, o, TAKE_LOOP) || (img[o + 6] & 0xfc) !== 0xcc) continue;
    const c = callAt(img, o + TAKE_LOOP.length), t = c && o + TAKE_LOOP.length + c.len;
    if (c && bytesAt(img, t, TAKE_TEST) && bytesAt(img, t + TAKE_TEST.length, TAKE_LOAD)) found.push(t + TAKE_TEST.length + TAKE_LOAD.length);
  }
  if (found.length > 1) throw new Error(`guiTake: message takes at ${found.map((o) => h8(0x50000000 + o)).join(', ')}, want one`);
  return found.length ? 0x50000000 + found[0] : undefined;
}

// Whether the SCPU keeps the camera's backup words and clock (fact 'scpu.backup'): the image holds the trace names of
// those requests, "ScpuBkupW" (with "ScpuBkupR", "SctimeWrite"; E143's poster 0x5005cd17 sends them, D). E143, E146,
// E147, E139 and E134 hold all three; E144 and the other 12 E144- and E118-family bodies none (X, a string count over
// each expanded image), E144's settings-DB init saving its backup store itself (D, src/fw/models.mjs E144).
export const scpuBackup = (img) => hasString(img, 'ScpuBkupW');

// Whether the display's device changes run in a task of their own, E143's DISPLAY_CHANGE (fact
// 'display.change_task'): the image holds that task's start trace "[CHG] CHG MAIN S", which its loop loads after
// each receive from the CHANGE queue (E143 0x501c6dc2, D). E143, E146 and E147 hold it, the 15 other bodies not (X,
// a string count over each expanded image), the same split as the ports' places of E143's change task 0x501c6d8c
// (placed on E146 and E147 only, X). A build whose DISPLAY task runs the changes itself logs them as "[CHG] START" ..
// "[CHG] END" (E144 0x501711a4..0x50171cc6, D); E125, E129, E132 and the E118 family hold no "[CHG]" string at all,
// and E125's static task table has no task of E143's change task's priority and stack (0x36, 0x400; D, kcb+124)
export const displayChangeTask = (img) => hasString(img, '[CHG] CHG MAIN S');

// The change task a build creates at run time (fact 'display.change_entry', src/lab/menu.mjs: the lab task lets the
// kernel start it): where the DISPLAY task runs the changes itself (no static change task, displayChangeTask), the
// EVF's first open powers the TFT down, the EVF up and then creates a task named "DISPLAY_CHANGE" (priority 26, stack
// 1024; X: E144, the create through 0x50185903 at 0x501747fd in the open's power-up 0x50174786). The creation loads the
// name, `mov <"DISPLAY_CHANGE">,a0` (fc dc), with the entry either loaded next, `mov <entry>,a1` (fc dd: E144
// 0x501747ee, entry 0x50173b55; E142, E140, D), or taken from the creation packet, `mov (d8,sp),a1` within
// CHANGE_SPAN bytes before the name's load and `mov <entry>,d0; mov d0,(d8,sp)` (fc cc .. 42 d8) within twice that
// (E139 0x50175c07, entry 0x50174f55 stored at 0x50175bde, slot 28; E137's slot 40; E134, E130, E133, D). The E143
// family loads the name for its static change task with no entry near; E125, E145, E129 and E132 hold no such name (X,
// a byte scan of the 15 expanded images; the entries are the ones the EVF starts of E144, E139, E134, E137, E140 and
// E130 ask the kernel for, X). Returns the entry (disassembly notation), or null; throws for two.
const CHANGE_NAME = 'DISPLAY_CHANGE', CHANGE_SPAN = 0x30;
export function displayChangeEntry(img) {
  const { base } = imageBase(img), found = new Set();
  for (const o of findString(img, CHANGE_NAME, { nul: true, after: true })) for (const p of loadsOf(img, base + o)) {
    if (img[p + 1] !== 0xdc) continue;
    if (img[p + 6] === 0xfc && img[p + 7] === 0xdd) { found.add(u32(img, p + 8)); continue; }
    let slot = null;
    for (let q = p - 2; q >= p - CHANGE_SPAN && slot === null; q--) if (img[q] === 0x5d) slot = img[q + 1];
    if (slot === null) continue;
    for (let q = p - 8; q >= p - 2 * CHANGE_SPAN; q--) {
      if (img[q] === 0xfc && img[q + 1] === 0xcc && img[q + 6] === 0x42 && img[q + 7] === slot) { found.add(u32(img, q + 2)); break; }
    }
  }
  if (found.size > 1) throw new Error(`displayChangeEntry: "${CHANGE_NAME}" created with entries ${[...found].map(h8).join(', ')}, want one`);
  return found.size ? (0x50000000 + [...found][0] - base) >>> 0 : null;
}

// The DISPLAY task's message queue (facts 'display.queue_word', 'display.queue_id'; src/lab/play.mjs play_init): the
// display init creates it under the name "DISPLAY" from its id word in the static queue-id table, `movhu (abs32),d0;
// exth d0; mov <"DISPLAY">,a0` (E143 0x501c3003, word 0x600432d4, D) or with the exth after the name (E139
// 0x500212b9, word 0x600416e0; E144 0x500214ad, D), then `mov 16,d1; mov 5,a1; call`. The id is the word's value in
// the image, the table holding id n at entry n - 1 (E143 0x600431c6: 1, 2, 3, .., D). One such site on each of the 18
// expanded images, its word the map's DISPLAY_QUEUE on all 18 and its id the one src/lab/play.mjs gave by hand on
// E143 (0x88), E146 and E147 (0x89) and E144 (0x8c) (X, a byte scan; the name matched as a whole string). Returns
// {queue_word, queue_id}. Throws unless exactly one site.
const DISPLAY_NAME = new TextEncoder().encode('DISPLAY\0');
const wordChar = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
function displayQueueSite(img) {
  const { base } = imageBase(img), names = new Set(), sites = [];
  for (let o = img.indexOf(DISPLAY_NAME[0]); o >= 0; o = img.indexOf(DISPLAY_NAME[0], o + 1)) {
    if (bytesAt(img, o, DISPLAY_NAME) && !wordChar(img[o - 1])) names.add(base + o);
  }
  for (let p = img.indexOf(0xfc); p >= 0 && p + 7 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    if (img[p + 1] !== 0xdc || !names.has(u32(img, p + 2))) continue;
    const k = bytesAt(img, p - 7, [0xfc, 0xac]) && img[p - 1] === 0x18 ? p - 7 : bytesAt(img, p - 6, [0xfc, 0xac]) && img[p + 6] === 0x18 ? p - 6 : -1;
    if (k >= 0) sites.push({ at: k, word: u32(img, k + 2) });
  }
  if (sites.length !== 1) throw new Error(`displayQueue: ${sites.length} 'movhu (abs32),d0; mov <"DISPLAY">,a0' sites${sites.length ? ': ' + sites.map((x) => h8(0x50000000 + x.at)).join(', ') : ''}, want 1`);
  return { ...sites[0], base };
}
export function displayQueue(img) {
  const { word, base } = displayQueueSite(img), w = word - base;
  return { queue_word: word, queue_id: img[w] | img[w + 1] << 8 };
}

// The display task init (fact 'display.task_init', and through bin/port.mjs the place of E143's DISPLAY_TASK_INIT
// 0x501c2f13, src/lab/display.mjs, which the lab calls and whose frame is its one call site's): the function that
// creates the DISPLAY queue (displayQueue's site). Its entry is the lowest called offset within TASK_INIT_SPAN bytes
// before the site that follows a ret or retf and from which the instructions run to the site with no return between.
// E143's 0x501c2f13, called from its boot at 0x50024a6c, and the places the ports gave on E146, E147, E144, E139, E137,
// E142 and E140, and E144's and E134's, which src/fw/models.mjs gave by hand before the rule (D), are the rule's (X, a
// byte scan of each expanded image). On E145, E125, E133, E130, E129 and E132 the maps had placed E143's first
// instruction 13 bytes past the entry, after a trace call these builds make first (`mov 1,d0; mov <name>,a0; call`,
// E130 0x501fef3d, D), as E134 does; E145's init 0x501eb17f is called once, from 0x50022054 (X). On the E118 family the
// entry found is not checked. Undefined where none.
export const DISPLAY_TASK_INIT_E143 = 0x501C2F13;
const TASK_INIT_SPAN = 0x400;
export function displayTaskInit(img) {
  const e = entryOf(img, displayQueueSite(img).at, TASK_INIT_SPAN);
  return e === undefined ? undefined : 0x50000000 + e;
}
// The entry of the function that holds offset `at`: the lowest called offset within `span` bytes before it that
// follows a ret or retf and from which the instructions run to it with no return between; undefined where none.
function entryOf(img, at, span) {
  const called = new Set(callsWhere(img, (t) => t < at && t >= at - span && isRet(img, t - 3)).map((c) => c.to));
  return [...called].sort((x, y) => x - y).find((e) => runsTo(img, e, at));
}
// Whether the instructions from offset `from` run to offset `to` with no ret or retf between (calls stepped over).
function runsTo(img, from, to) {
  let p = from;
  while (p < to && !isRet(img, p)) p += callAt(img, p)?.len ?? insnLength(img[p], img[p + 1]);
  return p === to;
}

// The display init's second part (fact 'display.init_2nd', src/lab/display.mjs H-DISPINIT2): a build whose display
// init leaves the devices' setup to the first DISPLAY OPEN calls it from the OPEN's case, once, behind a guard word,
// `mov (F),d0; cmp d2,d0; bne; mov 1,d0; mov d0,(F); call I` (d2 cleared in the DISPLAY loop: E125 0x50228cc7, F
// 0x61f8f0c4, I 0x50170a21, d2 cleared at 0x50228b6e, D). I opens with the trace "[DISP] <COM> :display_init_2nd"
// and sets the EVF's frame period word (its call 0x501724f4, the setter 0x50172b10 with 16683, D), which E143's
// display task init sets itself (0x501c2fd5 -> 0x50023ab6 -> 0x50023cec, D). E125, E129 and E132 hold the trace, the
// 15 other bodies not, and on those three one guarded call calls I (E129 I 0x5015137b, E132 0x50151369, both F
// 0x6238cc34; X, a byte scan). Returns {entry: I, once: F}, or null where the trace is not held; throws
// unless one function loads it and one guarded call calls it.
const INIT_2ND = '[DISP] <COM> :display_init_2nd', INIT_2ND_SPAN = 0x40, INIT_2ND_GUARD = 0x10;
export function displayInit2nd(img) {
  const at = findString(img, INIT_2ND, { nul: true, after: true });
  if (!at.length) return null;
  const { base } = imageBase(img), loads = at.flatMap((o) => loadsOf(img, base + o));
  const entries = [...new Set(loads.map((p) => entryOf(img, p, INIT_2ND_SPAN)))];
  if (entries.length !== 1 || entries[0] === undefined) throw new Error(`displayInit2nd: ${loads.length} loads of the trace in ${entries.length} functions, want one function`);
  const entry = entries[0], guarded = [];
  for (const p of callsTo(img, entry)) {
    if (!bytesAt(img, p - 8, [0x80, 0x01, 0xfc, 0x81])) continue;
    const once = u32(img, p - 4);
    for (let q = p - 8 - INIT_2ND_GUARD; q < p - 8; q++) if (bytesAt(img, q, [0xfc, 0xa4]) && u32(img, q + 2) === once) { guarded.push(once); break; }
  }
  if (guarded.length !== 1) throw new Error(`displayInit2nd: ${guarded.length} guarded calls of ${h8(0x50000000 + entry)}, want 1`);
  return { entry: 0x50000000 + entry, once: guarded[0] };
}

// The asynchronous DISPLAY requests (fact 'dispq.sends', src/lab/play.mjs S-DISPQ): every OlyQeWr (E143's 0x5002c151,
// at its place in the build) whose queue id is the DISPLAY queue word's (displayQueue): `movhu (word),d0` and, within
// DQ_WALK instructions after it, a call of OlyQeWr as the first call; its return address. Those read send a 16-byte
// DISPLAY message with timeout -1, the size at the descriptor's +4 (E137's loads at 0x5015ebe5, 0x5015fff8,
// 0x501690b2, 0x5017a39f, 0x505bd14b and 0x50c14748, E144's 0x5017247f, D). E137's 0x5016000b sends cmd 19 (`mov
// 19,d0; mov d0,(12,sp)`) after the trace "DISPLAY_STATIC_ELECTRICITY_CTRL2" (0x5015ffce, D), every 200 ms from about
// 5 s of idle on (X), as E144's 0x50172492 (src/fw/models.mjs gave it by hand before the rule, D: the same bytes) and
// E134's 0x5016b14e. 10 on E143 (its lab's own request, 0x503eba07, reads the queue id from the target table instead
// and is not among them, D), E146 and E147, 12 on E137, E139, E140, E142, E144 and E118, 13 to 15 on the other bodies
// (X, a byte scan of each expanded image at the port's place of OlyQeWr).
export const OLYQEWR_E143 = 0x5002C151;
const DQ_WALK = 8;
// The DISPLAY queue's calls of fn: each `movhu (word),d0` whose first call within DQ_WALK instructions is fn, as
// {at: the load's offset, ret: the call's return address}.
function queueCalls(img, fn) {
  const out = [];
  for (const p of halfLoads(img, displayQueue(img).queue_word)) {
    for (let q = p, k = 0; k < DQ_WALK; k++) {
      const c = callAt(img, q);
      if (c) { if (0x50000000 + c.to === fn) out.push({ at: p, ret: 0x50000000 + q + c.len }); break; }
      q += insnLength(img[q], img[q + 1]);
    }
  }
  return out;
}
const displaySends = (img, qewr) => queueCalls(img, qewr).map((c) => c.ret);

// The display sync (fact 'display.sync', src/lab/camapp.mjs S-DISPSYNC): two functions of the display manager's API,
// each found by the API id its first trace call loads, `mov id,Dn|An` (fc cc..cf / fc dc..df imm32) within API_HEAD
// bytes of its entry, the entry a call target after a return from which the code runs straight to the load, and the
// application's sync-word setter its release calls:
// - request (id 0x10035; E143 0x503e4dd5, E137 0x502bd2d2: `mov 4,d0; mov 1,d1; mov 0x10035,a0; call` after three
//   register moves, D): the GUI's display update (E137 0x507d5375 and 18 more calls of it) with d0 the request type
//   and d1 the device code (1 the TFT: mask 1 by the jump table after its trace, D). Type 3 is a synced update: the
//   request handler (0x505b98fa) puts the device's manager block in state 4, whose path (0x505ba446) only marks it
//   pending (0x505ba502: byte 3) and commits nothing (D). E137's GUI asks for it while the application's sync word
//   for the TFT (0x61e99838, read by getDispSync 0x507a28b6) is set: the GUI's mode for the device is then 4
//   (0x507d4ec8), whose update sends type 3 (0x507d5370, D). CameraCommon::setDispSync (0x507ebdff, API 0x1012d) sets
//   the word when the GUI's guiUtility::setDispSync (0x50dfd47d, 155 calls) asks, which it does at the start (X);
// - image sync (id 0x10037; E143 0x503e50ec, E137 0x502bd5bc, D): d0 the kind, d1 the device code, a0 1 for the
//   image events (handlers 0x505b9bac, 0x505b9c0d, 0x505b9c6e for kinds 1, 2, 0; a0 0 picks three others), which
//   pass the manager events 9, 10 and 11 (0x505b9c3a: `mov 10,d0; movhu d0,(4,a2)`). The manager takes an event
//   only where its table, 9 states a row from event 6 (E137 0x6071f064, read by 0x505bb140 from 0x505ba70f; E125
//   0x607182cc, 0x505b5829), admits the block's state: event 9 in states 1 and 3, 10 in 2 and 4, 11 in 1 to 4 (D),
//   and then commits as 0x505bb3ef(1) for states 1 and 3, (2) for 2 and 4 (0x505ba735, 0x505ba757). A type-3
//   request leaves the block in state 3 from 0 or 3 (E125 0x505b4c25; E137 0x505ba502, D; X on both), so kind 1
//   commits it and stopRecView's kind 2 does not (X: E137's block stays in state 3 and 0x505bb3ef is not called).
//   The table's 108 bytes from event 6 are the same on every body but the E118 and E120 ones (X, a byte scan of
//   each expanded image), and E125's image sync and manager have E137's form (D);
// - sync_set: the image sync has one caller, the shooting sequence's stopRecView (E137 0x5097983b, E143 0x50cb34be),
//   which first clears both panels' sync words, `clr d0; mov 2,d1; call` within RELEASE_SPAN bytes before it (E137
//   0x509797eb, D), and then sends kind 2 with a0 1. The setter (E137 0x507a2fa4, E143 0x50ab43cd) stores d0 into the
//   TFT's word for d1 0, the EVF's (0x61e9983c) for 1, both for 2 (D).
// One request, one image sync with one caller and that caller's setter on each of E143, E146, E147, E144, E139, E134,
// E137, E142, E140, E145, E125, E133, E130, E129 and E132; the E118 family has no request (X, a byte scan of each
// expanded image; a second candidate after a return inside the image sync, at +14, is no call target). Returns
// {request, image_sync, sync_set}, or undefined where the request or the image sync is missing; throws for two
// candidates of one id, an image sync without exactly one caller, or a caller without exactly one such clear.
export const DISPLAY_SYNC_E143 = { request: 0x503E4DD5, image_sync: 0x503E50EC, sync_set: 0x50AB43CD };
const DISPLAY_API = { request: 0x10035, image_sync: 0x10037 }, API_HEAD = 16, RELEASE_SPAN = 0x80;
const CLEAR_BOTH = [0x00, 0x85, 0x02];
export function displaySync(img) {
  const cand = new Map();
  for (const [k, id] of Object.entries(DISPLAY_API)) {
    const at = [];
    for (const p of loadsOf(img, id)) {
      for (let e = p - 1; e >= p - API_HEAD; e--) {
        if (!isRet(img, e - 3)) continue;
        let q = e;
        while (q < p) q += insnLength(img[q], img[q + 1]);
        if (q === p) at.push(e);
      }
    }
    cand.set(k, at);
  }
  const all = new Set([...cand.values()].flat()), callers = new Map();
  for (const c of callsWhere(img, (t) => all.has(t))) callers.set(c.to, [...(callers.get(c.to) ?? []), c.at]);
  const out = {};
  for (const [k, at] of cand) {
    const hits = at.filter((e) => callers.has(e));
    if (hits.length > 1) throw new Error(`displaySync: ${hits.length} ${k} entries (API id 0x${DISPLAY_API[k].toString(16)}): ${hits.map((e) => h8(0x50000000 + e)).join(', ')}, want 1`);
    if (hits.length) out[k] = 0x50000000 + hits[0];
  }
  if (out.request === undefined || out.image_sync === undefined) return undefined;
  const release = callers.get(out.image_sync - 0x50000000);
  if (release.length !== 1) throw new Error(`displaySync: the image sync ${h8(out.image_sync)} has ${release.length} callers, want 1`);
  const sets = [];
  for (let p = release[0] - RELEASE_SPAN; p < release[0]; p++) {
    const c = bytesAt(img, p, CLEAR_BOTH) && callAt(img, p + CLEAR_BOTH.length);
    if (c) sets.push(0x50000000 + c.to);
  }
  if (sets.length !== 1) throw new Error(`displaySync: ${sets.length} 'clr d0; mov 2,d1; call' within 0x${RELEASE_SPAN.toString(16)} bytes before the image sync's call at ${h8(0x50000000 + release[0])}, want 1`);
  return { ...out, sync_set: sets[0] };
}

// The rec view component's state word and its standby value (fact 'recview', src/lab/camapp.mjs S-RVSTANDBY): each
// state entry of the shooting components' RecView stores its state through `mov a0,a2; mov d0,d2; call S`, S the
// application's `mov d0,(W); retf`; entryStandby does so with `mov n,d0` after its trace, `mov "[RecView]
// entryStandby ",d0` (fc cc imm32) and the trace call (E142 0x508f1cee -> 0x508f2721 -> 0x5074b31c, W 0x61fa73a0;
// E143 0x50c65ff2 -> 0x50c66a25 -> 0x50ab5fe7, W 0x6035e9c8; n 1, D). The application's getRecViewState (E142
// 0x5076f065, API 0x20146) reports a rec view whenever W is not 1 (its gate 0x5074b283, D), and W starts at 0 (X, the
// expanded image). The name is held once, loaded once and the chain found on each of E143, E146, E147, E144, E139,
// E134, E137, E142, E140, E125, E145, E133, E130, E129 and E132, n 1 on all; the E118 family does not hold it (X, a
// byte scan of each expanded image). Returns {word, standby}, or undefined where the name is not held; throws for a
// name held or loaded twice, or a chain other than the above.
export const RECVIEW_E143 = { word: 0x6035E9C8, standby: 1 };
const RECVIEW_TRACE = '[RecView] entryStandby ', RECVIEW_WALK = 8, RECVIEW_STATE = [0x92, 0x82];
export function recViewStandby(img) {
  const { base } = imageBase(img), at = findString(img, RECVIEW_TRACE, { nul: true });
  if (!at.length) return undefined;
  const loads = loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xcc);              // mov <name>,d0
  if (at.length > 1 || loads.length !== 1) throw new Error(`recViewStandby: "${RECVIEW_TRACE}" ${at.length} times, loaded ${loads.length} times, want one each`);
  let q = loads[0], traced = false;
  for (let k = 0; k < RECVIEW_WALK; k++, q += insnLength(img[q], img[q + 1])) {
    if (!traced) { traced = !!callAt(img, q); continue; }
    const c = img[q] === 0x80 && callAt(img, q + 2);                                         // mov n,d0; call R
    if (!c) continue;
    const r = c.to, s = bytesAt(img, r, RECVIEW_STATE) && callAt(img, r + RECVIEW_STATE.length);
    const o = s ? s.to : -1;
    if (!s || img[o] !== 0xfc || img[o + 1] !== 0x81 || img[o + 6] !== 0xde) throw new Error(`recViewStandby: entryStandby's call at ${h8(0x50000000 + q + 2)} is not 'mov a0,a2; mov d0,d2; call' to 'mov d0,(abs32); retf'`);
    return { word: u32(img, o + 2), standby: img[q + 1] };
  }
  throw new Error(`recViewStandby: no 'mov n,d0; call' within ${RECVIEW_WALK} instructions after the trace at ${h8(0x50000000 + loads[0])}`);
}

// The ids of the shooting callbacks S-RELSEQ posts (fact 'cbs', src/lab/camapp.mjs CBS): each name's code in the
// build's CBS name table, the one run of CBS_TABLE_MIN or more 8-byte entries {u32 code, u32 address of "CBS_<name>"}
// (E143 0x60dcfb68, 289 entries, the names in alphabetical order, CBS_ABORT_ZOOM first; docs/om1-shutter-spec.md item
// 20, D). The application's callback handler takes the code: E142's (0x50cd6b5a) looks the code less 2 up in a hashed
// table of [code - 2, case] (0x60f6bd24) and posts nothing for a code it does not hold (D). On E142, E140 and E133
// CBS_END_SHOOTING_PICTURE is 369 where it is 211 on E143 and the 14 other bodies, and E142's handler table holds no
// 211: S2's END_SHOOTING_PICTURE reached no state, the still state stayed in 0x5101 and PLAY found no key to take (X).
// Every other name S-RELSEQ posts has E143's code on all 18 expanded images (X, a scan of each). Returns {NAME: code} for the names of CBS_E143, or undefined where the build holds no such table; throws for
// two tables or a name the table lacks.
export const CBS_E143 = { START_FOCUS: 213, END_FOCUS: 214, START_SHOOTING_PICTURE: 210, START_EXPOSE: 136, END_EXPOSE: 21,
  END_SHOOTING_PICTURE: 211, START_RECVIEW: 89, END_RECVIEW: 27, START_READY_MOVIE: 205, END_READY_MOVIE: 206,
  START_RECORDING_MOVIE: 216, END_RECORDING_MOVIE: 217, START_SHOOTING_MOVIE: 92, STOP_SHOOTING_MOVIE: 97,
  UPDATE_SHOOTING_TIME: 108 };
const CBS_TABLE_MIN = 200, CBS_PREFIX = [0x43, 0x42, 0x53, 0x5f];                          // "CBS_"
export function cbsIds(img) {
  const { base } = imageBase(img);
  const nameAt = (o) => { const a = u32(img, o + 4) - base; return a >= 0 && a + 4 < img.length && bytesAt(img, a, CBS_PREFIX) ? a : -1; };
  const tables = [];
  for (let o = 0; o + 8 <= img.length; o += 4) {
    if (nameAt(o) < 0 || (o >= 8 && nameAt(o - 8) >= 0)) continue;
    let n = 0;
    while (o + 8 * (n + 1) <= img.length && nameAt(o + 8 * n) >= 0) n++;
    if (n >= CBS_TABLE_MIN) tables.push({ o, n });
  }
  if (!tables.length) return undefined;
  if (tables.length > 1) throw new Error(`cbsIds: ${tables.length} CBS name tables (${tables.map((t) => h8(base + t.o)).join(', ')}), want one`);
  const codes = new Map(), { o, n } = tables[0];
  for (let k = 0; k < n; k++) {
    const a = nameAt(o + 8 * k), z = img.indexOf(0, a);
    let name = '';
    for (let p = a + CBS_PREFIX.length; p < z; p++) name += String.fromCharCode(img[p]);
    codes.set(name, u32(img, o + 8 * k));
  }
  const out = {};
  for (const name of Object.keys(CBS_E143)) {
    if (!codes.has(name)) throw new Error(`cbsIds: the CBS name table at ${h8(base + o)} holds no CBS_${name}`);
    out[name] = codes.get(name);
  }
  return out;
}

// The flag the display's device open waits on once per frame (fact 'display.frame_wait', src/lab/menu.mjs S-FRAMEWAIT):
// the open loops over its frame count, each pass a 28 ms wait on the flag, `mov 28,d0; mov d0,(4,sp); movhu (abs32),d0;
// mov (d8,sp),a0; exth d0; mov 1,d1; mov 1,a1; call OlyEvWt` (E143 0x501d7e74, word 0x60043088; E144 0x50181d06 and
// 0x50181dbb, word 0x600416ac; E139 0x50182648 and 0x501826fd, word 0x600414b6; E134 0x50211243, word 0x6004172e, D),
// or with `mov Am,a0` for the a0 (E129 0x501ee0ea: mov a3,a0, word 0x604211f4, D), and a frame callback sets it, `movhu
// (abs32),d0; mov 1,d1; exth d0; call` once for each of its two set calls (E144 0x5018220c: 0x5018221b, 0x5018222d,
// registered by 0x50185044 on the channel of the device opened, D; E143 0x501d8ee8, 0x501d8efa; E134 0x50211701,
// 0x50211713, D). Every load of the word is one of these. A wait on each of E143, E146, E147, E144, E139, E134, E137,
// E142, E140, E145, E125, E133, E130, E129, E132, E118 and E122, one word each (E144, E139 and E137 wait at two sites;
// E129 and E132 with `mov a3,a0`); E120 has no such wait (X, a byte scan of each expanded image). Returns the word (in
// the image), or undefined where no such wait is found. Throws for two words, or a load of the word that is neither a
// wait nor a set.
const FRAME_WAIT = [0x80, 0x1c, 0x42, 0x04, 0xfc, 0xac], FRAME_WAIT_TAIL = [0x18, 0x85, 0x01, 0x95, 0x01];
const FRAME_SET = [0x85, 0x01, 0x18];
// the wait's a0, `mov (d8,sp),a0` (5c d8) or `mov Am,a0` (90 + 4m), then its tail and the call: the call's offset or -1
const frameWaitCall = (img, o) => {
  const a0 = o + FRAME_WAIT.length + 4, len = img[a0] === 0x5c ? 2 : (img[a0] & 0xf3) === 0x90 ? 1 : 0;
  const call = a0 + len + FRAME_WAIT_TAIL.length;
  return len && bytesAt(img, a0 + len, FRAME_WAIT_TAIL) && callAt(img, call) ? call : -1;
};
export function frameWait(img) {
  const words = new Set();
  for (let o = img.indexOf(0x80); o >= 0; o = img.indexOf(0x80, o + 1)) {
    if (bytesAt(img, o, FRAME_WAIT) && frameWaitCall(img, o) >= 0) words.add(u32(img, o + 6));
  }
  if (!words.size) return undefined;
  if (words.size > 1) throw new Error(`frameWait: per-frame waits on the flags at ${[...words].map(h8).join(', ')}, want one`);
  const [word] = words, load = [0xfc, 0xac, word & 0xff, word >>> 8 & 0xff, word >>> 16 & 0xff, word >>> 24];
  for (let o = img.indexOf(0xfc); o >= 0; o = img.indexOf(0xfc, o + 1)) {
    if (!bytesAt(img, o, load)) continue;
    const wait = bytesAt(img, o - 4, FRAME_WAIT) && frameWaitCall(img, o - 4) >= 0, set = bytesAt(img, o + 6, FRAME_SET) && callAt(img, o + 6 + FRAME_SET.length);
    if (!wait && !set) throw new Error(`frameWait: the flag word ${h8(word)} is loaded at ${h8(0x50000000 + o)}, neither a per-frame wait nor a set`);
  }
  return word;
}

// The display code's sleep on the software timer (fact 'display.timer_sleep', src/lab/menu.mjs S-TIMERSLEEP): it
// opens `mov a0,a3; mov d0,d3; clr d2; exthu d3; mov 10,d0; mov d3,d1; ext d1; div d0,d1; mov mdr,d1; cmp d2,d1; bne;
// mov 1,d2` (the timer kind: whether d0 is a multiple of 10) and `mov imm32,a2`, its default callback, which a0
// replaces when not null; it starts a software-timer slot with d0 and the callback and, given no callback, waits on
// the flag the default callback sets with no timeout (E134 0x5020ea33: the start 0x5004f469 at 0x5020ea61, the slot
// written by 0x5004f54e in the table 0xa28a3f7c, OlyEvWt with timeout -1 at 0x5020ea87 on (0x60041700), which the
// callback 0x5020fee3 sets, D; E143 0x501c2e94, E144 0x50170f80, E139 0x50172271, D). E134's TFT open calls it with
// a0 null for its command list's wait (0x50211363, d0 the command's value + 1, D). Found once on each of the 18
// expanded images, after a ret or retf (X, a byte scan). Returns the entry (disassembly notation), or undefined for
// none; throws for two.
const TIMER_SLEEP = [0x93, 0x83, 0x08, 0x1f, 0x80, 0x0a, 0x8d, 0xf2, 0xd1, 0xf2, 0x61, 0xf2, 0xe1, 0xa9, 0xc9, 0x04, 0x8a, 0x01, 0xfc, 0xde];
export function timerSleep(img) {
  const found = [];
  for (let o = img.indexOf(0x93); o >= 0; o = img.indexOf(0x93, o + 1)) {
    if (bytesAt(img, o, TIMER_SLEEP) && isRet(img, o - 3)) found.push(o);
  }
  if (found.length > 1) throw new Error(`timerSleep: software-timer sleeps at ${found.map((o) => h8(0x50000000 + o)).join(', ')}, want one`);
  return found.length ? 0x50000000 + found[0] : undefined;
}

// Whether the hardware-timer start loads a channel's reload with the period it is given less one (fact
// 'timer.reload_less_one'; the software tick asks for 2000, so it runs 2000 us, or 2001 us with the period as the
// reload): after the start's errlog for a null callback, `mov 0x19000401,d0; call errlog` with a `mov n,d1` between
// on some bodies (the image's one load of that code), it either clamps the period to at least 1, `cmp 1,a2; bcc; mov
// 1,a2` (E143 0x500644bb, E139 0x50058c47, D), or takes one off, `cmp 1,a2; bcs; mov 1,d0; sub d0,a2` (E144
// 0x50055f4d, D). E144, E145, E146 and E147 take one off; E143, E139, E134, E137, E142, E140, E125, E129, E130, E132
// and E133 clamp (X, a byte scan of each expanded image). The E118 family has no such errlog: not read (undefined).
// Throws for two errlog sites or a tail that is neither.
const TIMER_NO_CALLBACK = [0xfc, 0xcc, 0x01, 0x04, 0x00, 0x19];
const RELOAD_CLAMP = [0xba, 0x01, 0xc6, 0x04, 0x9a, 0x01], RELOAD_LESS_ONE = [0xba, 0x01, 0xc4, 0x06, 0x80, 0x01, 0xf1, 0x22];
export function timerReloadLessOne(img) {
  const at = [];
  for (let o = img.indexOf(0xfc); o >= 0; o = img.indexOf(0xfc, o + 1)) if (bytesAt(img, o, TIMER_NO_CALLBACK)) at.push(o);
  if (!at.length) return undefined;
  const call = at[0] + 6 + (img[at[0] + 6] === 0x85 ? 2 : 0), t = call + 7;
  if (at.length > 1 || img[call] !== 0xdd || !(bytesAt(img, t, RELOAD_CLAMP) || bytesAt(img, t, RELOAD_LESS_ONE))) throw new Error(`timerReloadLessOne: the timer start's errlog at ${at.map((o) => h8(0x50000000 + o)).join(', ')}, want one followed by a reload clamp`);
  return bytesAt(img, t, RELOAD_LESS_ONE);
}

// The error log errlog(id, ...) (fact 'errlog.entry', and through bin/port.mjs the place of E143's ERRLOG_E143
// 0x50047313, src/lab/rtos.mjs ERRLOG, which the lab hooks while it builds the kernel): the callee of a call right
// after `mov imm32,d0` (fc cc, the id; a `mov imm8,d1`, 85, may come between) whose first ERRLOG_SPAN bytes take the
// id's module, `lsr 24,Dn` (f8 c4..c7 18), and compare it with the module count, `cmp imm8,Dn` (a0 + 5n), right after
// or one 2-byte instruction later. E143's prints "dbg_put() start\n" first and tests the module at 0x5004735c (`lsr
// 24,d0; mov d0,(36,sp); cmp 72,d0`, D); E125's prints the same and tests at 0x50041a2c (`lsr 24,d2; cmp 67,d2`, D);
// E133's holds no such print and tests at 0x5004012e (`lsr 24,d1; cmp 67,d1`, D), as E130's, E129's, E132's and the
// E118 family's (66) do. OlyTaWu's failure path does not lead to it on every body (taWu below). One such callee on
// each of the 18 expanded images, the port's place on the 11 bodies whose map placed one; on each it is also the
// callee most often called right after `mov imm32,d0` (E143 5067 such calls, the next callee 2230; E118 2929, the next
// 1834), and on the 15 bodies that have the hardware-timer start's errlog (0x19000401, above) it is that call's callee
// (X, a byte scan of each expanded image). Returns the entry (disassembly notation); throws unless exactly one.
export const ERRLOG_E143 = 0x50047313;
const ERRLOG_SPAN = 0x60;
const moduleTest = (img, e) => {
  for (let p = e; p < e + ERRLOG_SPAN; p++) {
    if (img[p] === 0xf8 && (img[p + 1] & 0xfc) === 0xc4 && img[p + 2] === 0x18 && [3, 5].some((k) => img[p + k] === 0xa0 + 5 * (img[p + 1] & 3))) return true;
  }
  return false;
};
export function errlogEntry(img) {
  const idCallees = new Set(callsWhere(img, () => true).filter(({ at }) => {
    const q = img[at - 2] === 0x85 ? at - 2 : at;
    return img[q - 6] === 0xfc && img[q - 5] === 0xcc;
  }).map((c) => c.to));
  const found = [...idCallees].filter((e) => moduleTest(img, e));
  if (found.length !== 1) throw new Error(`errlogEntry: ${found.length} callees after 'mov imm32,d0' test the id's module (${found.map((e) => h8(0x50000000 + e)).join(', ')}), want one`);
  return 0x50000000 + found[0];
}

// The kernel's CPU count (fact 'kernel.cpus'): its entry has one stub per CPU that sets the CPU's stack and goes on
// into the kernel, `mov 512,a0; add imm32,a0; mov a0,sp` (24 00 02 fc d0 imm32 f2 f0) then a bra or jmp, all in one
// run (E143 0x5001184c..0x50011875, 4 stubs, the last entering CPU 3's kernel at 0x500128d6; E144 0x50011676..
// 0x50011691, 3 stubs, D, with kcb[380] = 3). The E143 family has 4, the 12 E144-family and the 3 E118-family bodies 3
// (X, a byte scan of each expanded image). Throws unless the stubs found are one run.
const CPU_STUB = [0x24, 0x00, 0x02, 0xfc, 0xd0, null, null, null, null, 0xf2, 0xf0];
export function kernelCpus(img) {
  const at = [];
  for (let o = img.indexOf(0x24); o >= 0 && o + CPU_STUB.length <= img.length; o = img.indexOf(0x24, o + 1)) if (bytesAt(img, o, CPU_STUB)) at.push(o);
  // each stub is 11 bytes and its bra (2) or jmp (3)
  if (!at.length || at.some((o, i) => i > 0 && o - at[i - 1] > CPU_STUB.length + 3)) throw new Error(`kernelCpus: kernel-entry stubs at ${at.map((o) => h8(0x50000000 + o)).join(', ') || 'none'}, want one run`);
  return at.length;
}

// CPU 0's init task (fact 'rtos.init_task', and through bin/port.mjs the place of E143's INIT_TASK_E143 0x5002cca5,
// src/lab/kernel.mjs INIT_TASK_ENTRY, the task LabTask.start ends), read at the port's place of E143's CPU 0 kcb
// 0x6004381c: kcb+124 points to its static task table, 28-byte rows {id, atr, exinf, task, pri, stksz, stk} that end
// at a row of id 0, and kcb+128 past that row (docs/om1-cores-spec.md section 2; kernel spec kcb+124). The init task
// BOOT_CPU0 is task id 1 (atr 2, priority 1, stack 0x800), its entry the row's task, a run-time address (E143 row 6 at
// 0x600390e0 of the table 0x60039038, 159 rows; E144 row 1 at 0x60038b78 of 0x60038b5c, 157 rows, its hand override's
// place before the rule, D). One row of id 1 on each of the 18 expanded images, row 6 on the E143 family and row 1 on
// the others, each with E143's atr, priority and stack size and its entry after a retf (X, a read of each at the
// port's place of the kcb). Returns the entry (disassembly notation); throws for a table without its row of id 0
// before kcb+128, or without exactly one row of id 1.
export const KCB0_E143 = 0x6004381C, INIT_TASK_E143 = 0x5002CCA5;
const TASK_ROW = 28;
// CPU 0's static task table at the kcb, as {id, entry (disassembly notation)} rows up to the row of id 0; throws where
// that row does not come before kcb+128.
function taskRows(img, kcb, rule) {
  const { base } = imageBase(img), word = (a) => u32(img, a - base), table = word(kcb + 124), end = word(kcb + 128), rows = [];
  let p = table;
  for (; p < end && word(p) !== 0; p += TASK_ROW) rows.push({ id: word(p), entry: (word(p + 12) - base + 0x50000000) >>> 0 });
  if (p >= end) throw new Error(`${rule}: CPU 0's static task table ${h8(table)} (kcb ${h8(kcb)}) has no row of id 0 before kcb+128`);
  return rows;
}
function initTask(img, kcb) {
  const ones = taskRows(img, kcb, 'initTask').filter((r) => r.id === 1);
  if (ones.length !== 1) throw new Error(`initTask: CPU 0's static task table (kcb ${h8(kcb)}) has ${ones.length} rows of task 1, want one`);
  return ones[0].entry;
}

// The DISPLAY task's loop (fact 'dispq.loop', and through bin/port.mjs the place of E143's DISPLAY_LOOP_E143
// 0x501c3035, src/lab/display.mjs DISPLAY_LOOP, which the lab runs for each DISPLAY command), read at the port's places
// of E143's CPU 0 kcb (KCB0_E143) and OlyQeRd (0x5002c067, OLYQERD_E143): the entry of the static task (taskRows)
// whose instructions run, with no return between, to the DISPLAY queue's receive, a `movhu (word),d0` that OlyQeRd
// follows as the first call (queueCalls), within LOOP_SPAN bytes. Task entries are not called, so the entry is the
// task table's. E143's task 54 (priority 26, the receive at 0x501c3080, +0x4b, D), E144's 59 (0x50170fff, its hand
// override's place before the rule, the receive at 0x50171030), and the places the maps or the carry gave on E146,
// E147, E139, E134, E137, E142 and E140 are the rule's (X); one task on each of the 18 expanded images, priority 26 on
// all but the E118 family (55), the receive 0x31..0x5d bytes past its entry (E145's task 58 at 0x501eb256, the
// receive at 0x501eb289, X, a read of each at the port's places). Returns the entry (disassembly notation); throws
// unless exactly one.
export const OLYQERD_E143 = 0x5002C067, DISPLAY_LOOP_E143 = 0x501C3035;
const LOOP_SPAN = 0x100;
function displayLoop(img, kcb, qerd) {
  return taskRunningTo(img, kcb, queueCalls(img, qerd).map((c) => c.at), LOOP_SPAN, 'displayLoop', 'a receive on the DISPLAY queue');
}
// The DISPLAY task's start-up (fact 'dispq.start', src/lab/display.mjs S-DISPSTART): the calls its entry (displayLoop)
// makes before it first reaches its receive, which the task makes once, when it starts, and then loops on the
// receive. E143's entry calls 0x500239c9 at 0x501c3075, which starts the task in (0x60042db2) (OlyTaSt 0x5002c546 at
// 0x500239fb, D). E125's calls its trace (0x50228b02) and, at 0x50228b15, 0x50229c1a, which opens the TFT
// (0x50229c5c(1) -> 0x5022a2bf), the case of DISPLAY cmd 42 too (0x50228d5f, the jump table 0x60255828's entry 40,
// D): the open powers the panel on, which waits 150 ms for the touch panel's interrupt and, once the first open has
// set the touch word (0x61f9390c), posts cmd 4 to the touch task's queue (0x5022a568 -> 0x5022d4d4, 0x5022a5c6, D).
// One call on 15 of the 18 expanded images, two on E137 and E125 (each a trace call first), none on E118 (X, a walk
// from each entry at the port's places). Returns the call sites (disassembly notation), in order; throws where the
// entry does not run to a receive within LOOP_SPAN bytes.
export const DISPLAY_START_E143 = [0x501C3075];
function displayStart(img, entry, qerd) {
  const e = entry - 0x50000000, receives = queueCalls(img, qerd).map((c) => c.at).filter((at) => at > e && at - e <= LOOP_SPAN && runsTo(img, e, at));
  if (!receives.length) throw new Error(`displayStart: the DISPLAY task's entry ${h8(entry)} runs to no receive on the DISPLAY queue within ${LOOP_SPAN} bytes`);
  const end = Math.min(...receives), sites = [];
  for (let p = e; p < end;) {
    const c = callAt(img, p);
    if (c) sites.push(0x50000000 + p);
    p += c?.len ?? insnLength(img[p], img[p + 1]);
  }
  return sites;
}
// The entry of the one static task (taskRows) whose instructions run from its entry, with no return between, to one
// of the sites (image offsets) within span bytes; throws unless exactly one.
function taskRunningTo(img, kcb, sites, span, rule, what) {
  const found = taskRows(img, kcb, rule).filter(({ entry }) => {
    const e = entry - 0x50000000;
    return sites.some((at) => at > e && at - e <= span && runsTo(img, e, at));
  });
  if (found.length !== 1) throw new Error(`${rule}: ${found.length} static tasks (${found.map((r) => h8(r.entry)).join(', ')}) run to ${what} (${sites.map((at) => h8(0x50000000 + at)).join(', ')}), want one`);
  return found[0].entry;
}

// The UI_IN task (fact 'ui_in.task', and through bin/port.mjs the place of E143's UI_IN_E143 0x5014b736,
// src/lab/play.mjs UI_IN, the static task the lab starts in the play bring-up), read at the port's places of E143's
// CPU 0 kcb (KCB0_E143) and UI_IN's event flag word (UI_IN_FLAG_E143 0x60043010, play.mjs UI_IN_FLAG): the static task
// whose instructions run, with no return between, to a `movhu (word),Dn` of the flag word within UI_IN_SPAN bytes, the
// load of the flag id its wait loop waits on. E143's task 0x54 (priority 0x2c, stack 0x800) loads it at 0x5014b74a,
// 0x14 bytes in, then waits (0x5014b756) and runs its two steps, 0x5014c763 and 0x5014b895 (D); E125's task 0x5e,
// 0x500febde, the one of its static tasks with that priority and stack, first polls 0x50045f7f every 16 ms (`mov
// 16,d0; call 0x50030a16`) and loads the flag word (0x60040eb4) at 0x500fec10, 0x32 bytes in, then runs the same loop
// (its steps 0x5010007e and 0x500ff03d, D): no map placed its entry. Returns the entry (disassembly notation); throws
// unless exactly one.
export const UI_IN_E143 = 0x5014B736, UI_IN_FLAG_E143 = 0x60043010;
const UI_IN_SPAN = 0x80;
function uiInTask(img, kcb, flag) {
  return taskRunningTo(img, kcb, halfLoads(img, flag, true), UI_IN_SPAN, 'uiInTask', `a load of the flag word ${h8(flag)}`);
}

// The power task (fact 'power.task', src/lab/play.mjs H-PWRTASK), read at the port's place of E143's CPU 0 kcb
// (KCB0_E143): the static task whose entry first calls the power module's init, which calls the internal charger's
// init, the function that loads the name "PWR_INTCHA_IICWAIT" for the event flag its transfers complete with and sets
// the charger's IIC channel up (E132: task 11, entry 0x500400b7, its call of 0x5003f48d at 0x500400bc, which calls the
// charger init 0x5003fa04 at 0x5003f4dd; the init's channel 9 at 400 kHz with the completion callbacks 0x5003fe46
// and 0x5003fe5a in 0xa2b1610c.., D). The boot starts the task; the lab, ending the init task, does not. The name on
// E144, E142, E140, E137, E145, E129 and E132, not on the other 11 images (X, a byte scan). Returns the entry
// (disassembly notation), null where the name is not held; throws unless one load of it (of its copies: two on
// each, X) and one such task.
const PWR_NAME = 'PWR_INTCHA_IICWAIT', PWR_SPAN = 0x200, PWR_TASK_SPAN = 0x40;
function powerTask(img, kcb) {
  const names = findString(img, PWR_NAME, { nul: true, after: true });
  if (!names.length) return null;
  const { base } = imageBase(img), loads = names.flatMap((o) => loadsOf(img, (base + o) >>> 0));
  if (loads.length !== 1) throw new Error(`powerTask: ${loads.length} loads of the name ${PWR_NAME}, want one`);
  const init = entryOf(img, loads[0], PWR_SPAN);
  if (init === undefined) throw new Error(`powerTask: the load of ${PWR_NAME} at ${h8(0x50000000 + loads[0])} is in no called function`);
  const modules = new Set(callsTo(img, init).map((at) => entryOf(img, at, PWR_SPAN)).filter((e) => e !== undefined));
  return taskRunningTo(img, kcb, [...modules].flatMap((m) => callsTo(img, m)), PWR_TASK_SPAN, 'powerTask', `a call of the power init calling ${h8(0x50000000 + init)}`);
}

// The power manager and the power-off natively (fact 'power.off', src/lab/power.mjs; docs/hle-gaps.md 4.7.4), read
// at the port's place of E143's flash save (FLASH_SAVE_E143) and the file system's NAND access (fileSystem). E143's
// values (POWER_OFF_E143) with their evidence, D unless tagged; each part below is read by its shape, the same on E146
// and E147 (X: read on each, test/test_facts.mjs POWER_OFF_FOUND):
// - pwr: the boot starter 0x50023eca's start of the power manager, `call init; movhu (W),d0; exth d0; call OlyTaSt;
//   mov NAME,a0` with NAME the task's name "PWR_MAIN" (0x500240c4..0x500240d9): {init, id_word}, the init 0x50044eb6
//   (which runs the start-up message {0x100, 0x20} through the task's handler 0x5004408f) and W 0x60042d3a, which
//   holds PWR_MAIN's static task id (10; entry 0x50043cdb, which waits on its flag, the word 0x60042f86, for its
//   queue's messages, the word 0x600431d8)
// - end: the SCPU window's last write, `mov 127,d0; mov d0,(0x98e0009c)` (0x5004dfe0 in 0x5004dfd0), whose one call
//   right after another call is api_system's power-off sequence's (0x5041fa85 -> 0x50044ca8); that call sends the
//   sub-CPU its 0x85 (0x5005cdfd at 0x50044de0: `{1, 1, 0}` for setting 19, `{3}` for 9, else `{1, 0, 0}`), and end
//   is the address after the last write's call (0x50044de7, end 0x50044dee)
// - poll: in the 0x85 sender, up to its first return, the wait for the ready pin after the send, `mov pin,d0; call;
//   cmp 0,d0; bne` back to the mov (0x5005ceaf..ba, the GIO read 0x5000297f): {at, pin}, pin 102
// - ioexp: the IO expanders' power-off commands the sequence calls before the 0x85 sender (by setting 0xa011, 9: the
//   body's 5 and the PBH's 4, else 6 and 5; 0x50044da8..0x50044ddd), each `mov imm8,d0; mov 0,a0; call post; call
//   wait; ret`, the wait opening `mov imm16,d0; mov d0,(4,sp); movhu (flag),d0` (the timeout, then the completion
//   flag's id word, whose bit 1 the caller waits for): {body, pbh}: {post, flag} in the order the sequence first calls
//   them (the body's commands 0x50055fe4 / 0x50055fd3 send 6 or 5 through the post 0x50056a85, PER_IOEXP's data queue
//   0x600431be, and wait in 0x50056c93 on 0x60043170; the PBH's 0x500541d9 / 0x500541c8 send 5 or 4 through
//   0x50054ede, PER_IOEXP_PBH's 0x600431c0, and wait in 0x500550f4 on 0x60043180; I: that the order names them on
//   another body), or null where the sequence calls none (E147: no IO expander code, X)
// - shutdown: the shell's "sdk api shutdown mode reason", the function that loads the usage text
//   "API_SHUTDOWN_NORMAL ..." (0x50b05071), calls the HFW's CameraCommon getter and a slot of the object's vtable
//   within SHELL_SPAN bytes: `call getter; mov (a0),a1; mov (12,sp),d0; mov (16,sp),d1; mov (N,a1),a1; calls (a1);
//   mov d0,d2; mov ID,d0` (0x50b05169..0x50b0517c: the getter 0x50afccd5, its singleton 0x60361140 made by 0x50afd238
//   with the vtable 0x60e02ea4, slot 2, ID 0x10102,
//   the trace id "CameraCommon::shutDown" has in the name table 0x6035f100). entry: the one function whose opening
//   (after a return, with none before the load) loads ID within SHUTDOWN_HEAD bytes, CameraCommon::shutDown
//   0x50afd2d7 (the load at +0x10), whose run-time address the image holds as a word (the vtable 0x60e02ea4's slot 2);
//   mode and reason: the usage text's values of API_SHUTDOWN_NORMAL and API_SHUTDOWN_REASON_BUTTON (1 and 1; the
//   text 0x60e10b2c..0x60e10b6f; that the lever is BUTTON is I)
// - flash_save: the return address of the one call of the flash save in OlyHfwPower's startShutDown 0x50af654b
//   (reached from shutDown through 0x50abe7e0), the function that loads its trace "OlyHfwPower::startShutDown
//   nextShootTime = %d" (0x50af6c52): the call at 0x50af6a0e, return 0x50af6a15
// - log: the RAM log's save (api 0xc0036 0x50420fd4 -> 0x518f7381: the callbacks of the table 0x60379ef0, 50 ms,
//   0x50039def writing 0x100 to +0x800 of the four interrupt-controller banks, a checksum of 2 MiB from 0x63ae0000)
//   to the NAND: the one call of the NAND access after `mov area,a1; mov size,d0; mov op,d1` with the access's write
//   operation and an area other than the file system's whose function, before it, compares a sum's index with `cmp
//   size-64,Dn` (the area's words but its last 64 bytes; 0x518f73ec `cmp 0x1fffc0,d3`; the NAND's three other such
//   writes, two in 0x5180a8.. and the shell's 1 MiB at 0x518f7b2d, sum nothing, X): the call 0x518f7428, 0x4e820000,
//   0x200000: {nand: [area, size], ret}
// Returns null where no load of "PWR_MAIN" starts a task; throws where a part is missing or found twice.
export const POWER_OFF_E143 = {
  pwr: { init: 0x50044EB6, id_word: 0x60042D3A },
  shutdown: { object: 0x50AFCCD5, slot: 2, entry: 0x50AFD2D7, mode: 1, reason: 1 },
  flash_save: 0x50AF6A15, log: { nand: [0x4E820000, 0x200000], ret: 0x518F742F }, end: 0x50044DEE,
  ioexp: { body: { post: 0x50056A85, flag: 0x60043170 }, pbh: { post: 0x50054EDE, flag: 0x60043180 } },
  poll: { at: 0x5005CEAF, pin: 102 },
};
// The power-off's library numbers, the same on every body that runs it (src/lab/power.mjs): ioexp_write, the PBH
// expander's request the GIO extension's write sends (E143 0x500541f3: request 1 with {+0 the pins' mask, +4 a byte,
// +8 its request's first word, +16 the request's callback, +20 its argument}, 0x50054237..0x5005425a, D; E146's, X:
// its power manager's start sends it), whose callback the API calls itself while the PBH's state 0xa32c4915 is 5
// (0x5005421d..33, D)
export const POWER_OFF_LIB = { ioexp_write: 1 };
const PWR_MAIN_NAME = 'PWR_MAIN', SCPU_LAST_WRITE = [0x80, 0x7f, 0xfc, 0x81, 0x9c, 0x00, 0xe0, 0x98];   // 0x98e0009c: src/dev/scpu.mjs
const LAST_WRITE_HEAD = 0x40, LOG_SPAN = 0x100, SEQUENCE_SPAN = 0x200, SENDER_SPAN = 0x200, SHELL_SPAN = 0x200, SHUTDOWN_HEAD = 0x20, START_SPAN = 0x800;
const SHUTDOWN_USAGE = 'API_SHUTDOWN_NORMAL', SHUTDOWN_BUTTON = 'API_SHUTDOWN_REASON_BUTTON', START_SHUTDOWN = 'OlyHfwPower::startShutDown nextShootTime';
// `mov area,a1; mov size,d0; mov op,d1` before the NAND access's call (the RAM log's, E143 0x518f7416)
const LOG_LOADS = [0xfc, 0xdd, null, null, null, null, 0xfc, 0xcc, null, null, null, null, 0xfc, 0xcd, null, null, null, null];
const SLOT_CALL = [0xf0, 0x04, 0x58, null, 0x59, null, 0xf8, 0x25, null, 0xf0, 0xf1, 0x82, 0xfc, 0xcc];
function powerOff(img, save) {
  const rule = 'powerOff', { base } = imageBase(img), D = (o) => h8(0x50000000 + o);
  const callBefore = (p) => [callAt(img, p - 7), callAt(img, p - 5)].find((c, k) => c?.len === 7 - 2 * k);
  const walk = (from, to, each) => { for (let p = from; p < to && !isRet(img, p);) { const c = callAt(img, p); each(p, c); p += c?.len ?? insnLength(img[p], img[p + 1]); } };
  // pwr
  const starts = [];
  for (const o of findString(img, PWR_MAIN_NAME, { nul: true, after: true })) {
    for (const p of loadsOf(img, (base + o) >>> 0)) {
      const taSt = img[p + 1] === 0xdc ? callBefore(p) : undefined, s = taSt ? p - taSt.len : -1;
      if (!taSt || img[s - 1] !== 0x18 || img[s - 7] !== 0xfc || img[s - 6] !== 0xac) continue;
      const init = callBefore(s - 7);
      if (init) starts.push({ init: 0x50000000 + init.to, id_word: u32(img, s - 5) });
    }
  }
  if (!starts.length) return null;
  if (starts.length > 1) throw new Error(`${rule}: ${starts.length} starts of ${PWR_MAIN_NAME}, want one`);
  // end, and the 0x85 sender before it
  const hit = oneAt(img, SCPU_LAST_WRITE, rule, 'last writes of the SCPU window\'s request word');
  const last = hit === null ? undefined : entryOf(img, hit, LAST_WRITE_HEAD);
  if (last === undefined) throw new Error(`${rule}: no called function writes 127 to the SCPU window's request word`);
  const seqs = callsTo(img, last).map((at) => ({ at, len: callAt(img, at).len, sender: callBefore(at) })).filter((c) => c.sender);
  if (seqs.length !== 1) throw new Error(`${rule}: ${seqs.length} calls of the last write ${D(last)} right after a call, want one`);
  const [{ at: lastCall, len, sender }] = seqs, sendAt = lastCall - sender.len;
  // poll, in the sender
  const polls = [];
  walk(sender.to, sender.to + SENDER_SPAN, (p, c) => {
    if (img[p] !== 0x80 || !(c = callAt(img, p + 2)) || !bytesAt(img, p + 2 + c.len, [0xa0, 0x00, 0xc9])) return;
    const br = p + 2 + c.len + 2;
    if (br + (img[br + 1] << 24 >> 24) === p) polls.push({ at: 0x50000000 + p, pin: img[p + 1] });
  });
  if (polls.length !== 1) throw new Error(`${rule}: the 0x85 sender ${D(sender.to)} polls a pin ${polls.length} times, want once`);
  // ioexp, in the sequence before the sender
  const seq = entryOf(img, sendAt, SEQUENCE_SPAN), posts = new Map();
  if (seq === undefined) throw new Error(`${rule}: the 0x85 send at ${D(sendAt)} is in no called function`);
  walk(seq, sendAt, (p, c) => {
    const t = c?.to;
    if (!c || !bytesAt(img, t, [0x80, null, 0x90, 0x00])) return;
    const post = callAt(img, t + 4), wait = post && callAt(img, t + 4 + post.len);
    if (!wait || !isRet(img, t + 4 + post.len + wait.len) || !bytesAt(img, wait.to, [0x2c, null, null, 0x42, 0x04, 0xfc, 0xac])) return;
    const flag = u32(img, wait.to + 7), was = posts.get(post.to);
    if (was !== undefined && was !== flag) throw new Error(`${rule}: the expander post ${D(post.to)} waits on two flags`);
    posts.set(post.to, flag);
  });
  if (posts.size !== 0 && posts.size !== 2) throw new Error(`${rule}: the sequence ${D(seq)} sends ${posts.size} IO expanders their power-off commands, want none or two`);
  const ex = [...posts].map(([post, flag]) => ({ post: 0x50000000 + post, flag }));
  // shutdown
  const text = (o) => { let e = o; while (img[e]) e++; return String.fromCharCode(...img.subarray(o, e)); };
  const value = (name) => {
    const at = findString(img, name + ' ', { after: true }), m = at.length === 1 ? /= 0x([0-9a-f]+)$/i.exec(text(at[0])) : null;
    if (!m) throw new Error(`${rule}: ${at.length} usage lines of ${name} with a value, want one`);
    return { at: at[0], value: parseInt(m[1], 16) };
  };
  const usage = value(SHUTDOWN_USAGE), button = value(SHUTDOWN_BUTTON), shell = loadsOf(img, (base + usage.at) >>> 0);
  if (shell.length !== 1) throw new Error(`${rule}: ${shell.length} loads of the shutdown usage text, want one`);
  const slots = [];
  walk(shell[0], shell[0] + SHELL_SPAN, (p, c) => { if (c && bytesAt(img, p + c.len, SLOT_CALL)) slots.push({ getter: c.to, at: p + c.len }); });
  if (!slots.length) throw new Error(`${rule}: the shell's shutdown ${D(shell[0])} calls no getter's vtable slot within ${SHELL_SPAN} bytes`);
  const { getter, at: slotAt } = slots[0], id = u32(img, slotAt + SLOT_CALL.length);
  const entries = new Set();
  for (const l of loadsOf(img, id)) {
    for (let e = l - SHUTDOWN_HEAD; e < l; e++) if (isRet(img, e - 3) && runsTo(img, e, l)) { entries.add(e); break; }
  }
  const entry = [...entries][0], word = [0, 8, 16, 24].map((k) => (base + entry) >>> k & 0xff);
  if (entries.size !== 1 || oneAt(img, word, rule, 'words of the shutdown entry') === null) throw new Error(`${rule}: ${entries.size} functions open with the shutdown's trace id ${h8(id)}${entries.size === 1 ? ', none held as a word' : ''}, want one in a vtable`);
  // flash_save, in startShutDown
  const traces = findString(img, START_SHUTDOWN, { after: true }).flatMap((o) => loadsOf(img, (base + o) >>> 0));
  const start = traces.length === 1 ? entryOf(img, traces[0], START_SPAN) : undefined, saves = [];
  if (start === undefined) throw new Error(`${rule}: ${traces.length} loads of startShutDown's trace${traces.length === 1 ? ' in no called function' : ''}, want one`);
  walk(start, start + START_SPAN * 2, (p, c) => { if (c && c.to === save - 0x50000000) saves.push(0x50000000 + p + c.len); });
  if (saves.length !== 1) throw new Error(`${rule}: startShutDown ${D(start)} calls the flash save ${h8(save)} ${saves.length} times, want once`);
  // log
  const nand = fileSystem(img)?.nand, logs = [];
  if (!nand) throw new Error(`${rule}: fileSystem reads no NAND access`);
  for (const c of callsWhere(img, (t) => t === nand.access - 0x50000000)) {
    const at = c.at - LOG_LOADS.length, area = u32(img, at + 2);
    if (!bytesAt(img, at, LOG_LOADS) || u32(img, at + 14) !== nand.write || area === nand.area[0]) continue;
    // the save's checksum: `cmp size-64,Dn`, the area's words but its last 64 bytes, before the write
    const size = u32(img, at + 8), fn = entryOf(img, at, LOG_SPAN);
    let sums = false;
    if (fn !== undefined) walk(fn, at, (p) => { sums ||= img[p] === 0xfc && (img[p + 1] & 0xfc) === 0xc8 && u32(img, p + 2) === size - 64; });
    if (sums) logs.push({ nand: [area, size], ret: 0x50000000 + c.at + c.len });
  }
  if (logs.length !== 1) throw new Error(`${rule}: ${logs.length} NAND writes of an area its function sums, want one`);
  return {
    pwr: starts[0], shutdown: { object: 0x50000000 + getter, slot: img[slotAt + 8] / 4, entry: 0x50000000 + entry, mode: usage.value, reason: button.value },
    flash_save: saves[0], log: logs[0], end: 0x50000000 + lastCall + len,
    ioexp: ex.length ? { body: ex[0], pbh: ex[1] } : null, poll: polls[0],
  };
}

// The touch task's start in the boot (fact 'touch_start', and through bin/port.mjs the places of E143's touch init
// TOUCH_INIT_E143 0x501e3dca and the touch task's id word TOUCH_TASK_ID_E143 0x60042dcc, src/lab/play.mjs H-TPINIT,
// which calls the init and starts the task by the id it reads there), read at the port's places of E143's CPU 0 kcb
// (KCB0_E143), its touch task (TOUCH_TASK_E143 0x501e3eac) and OlyTaSt (OLYTAST_E143 0x5002c546): the boot calls the
// init and starts the task at once, `call init; movhu (word),d0; exth d0; call OlyTaSt`, where the word holds the id
// of the static task (taskRows) at the touch task's place. E143's boot does so at 0x50024ca6 (task 0x53, D). The
// boot starts most static tasks so, each after its init and with its own id word, the words one array in id order
// (E143's 0x60042dcc holds 0x53, the word after it 0x54, D); E125's map took the word before the touch task's, which
// holds the id of the task after its other init (0x60040ca8: task 0x5c, entry 0x5077f11c), and its map and E134's
// placed the init at the boot's call before that other start (E125 0x5022da65, its call at 0x5002190b starting task
// 0x75; E134 0x5021881b, at 0x500223eb, task 0x73), where the touch task's are 0x5022d065 with 0x60040caa (task 0x5d,
// at 0x5002198a) and 0x50217d43 with 0x6004145e (task 0x5b, at 0x5002246a, D). Returns {init, id_word} (disassembly
// notation and the word), undefined where no such start is; throws for two.
export const TOUCH_INIT_E143 = 0x501E3DCA, TOUCH_TASK_E143 = 0x501E3EAC, TOUCH_TASK_ID_E143 = 0x60042DCC, OLYTAST_E143 = 0x5002C546;
function touchStart(img, kcb, task, taSt) {
  const { base } = imageBase(img), row = taskRows(img, kcb, 'touchStart').filter((r) => r.entry === task), found = [];
  if (row.length !== 1) throw new Error(`touchStart: ${row.length} static tasks at the touch task's place ${h8(task)}, want one`);
  for (const p of halfLoads(img, null)) {
    if (img[p + 6] !== 0x18 || 0x50000000 + (callAt(img, p + 7)?.to ?? -1) !== taSt) continue;
    const word = u32(img, p + 2), at = word - base;
    if (at < 0 || at + 2 > img.length || (img[at] | img[at + 1] << 8) !== row[0].id) continue;
    const init = [callAt(img, p - 7), callAt(img, p - 5)].find((c, k) => c?.len === 7 - 2 * k);
    if (init) found.push({ init: 0x50000000 + init.to, id_word: word });
  }
  if (found.length > 1) throw new Error(`touchStart: ${found.length} starts of the touch task (${found.map((f) => h8(f.init)).join(', ')}), want one`);
  return found[0];
}

// The touch task's command queue (fact 'touch_task', src/lab/play.mjs S-TPSEND, and through bin/port.mjs the place of
// E143's touch flag word TP_FLAG_E143 0x6004306c, play.mjs TP_FLAG), read at the port's places of E143's touch task
// (TOUCH_TASK_E143), OlyEvWt (OLYEVWT_E143 0x5002bdd8) and OlyQeRd (OLYQERD_E143): the task's loop waits on its event
// flag, the `movhu (flag),d0` before its first OlyEvWt, and where the bit of the `btst bit,d0` before its first OlyQeRd
// is set it receives a 16-byte message from its queue, the `movhu (queue),d0` before that call, runs the command in
// word 2 and, where word 0 names a reply queue, replies there; with word 0 at 0 it waits again (E143: the flag
// 0x6004306c with mask 11 at 0x501e3ef2, bit 8 at 0x501e4038, the queue 0x600432e8 received at 0x501e4053, word 0
// tested at 0x501e4099, the reply 0x501e40bc; E134: 0x60041710 with mask 9 at 0x50217e68, the queue 0x60041972 at
// 0x50217eb2, its 13 commands through the jump table 0x602424f4, word 0 tested at 0x50217fd8, the reply 0x50217ffa,
// D). The walk from the entry runs straight, calls stepped over, with no return before the receive, which lies
// 0x71..0x230 bytes in, bit 8 on all twelve bodies with a touch task at the port's places (E143, E146, E147, E144,
// E139, E134, E137, E142, E140, E125, E130, E133, X). On E125, E130 and E133 the flag is not the map's place of
// TP_FLAG (E130: 0x60420d54, the map's 0x60420d46, X), so the rule places it. Returns {flag, queue, bit} (the words
// and the bit's mask); throws where the walk meets a return or TOUCH_TASK_SPAN bytes before the receive, or finds no
// wait, load or test before it, or the wait's mask (its `mov imm8,d1`) lacks the bit.
export const OLYEVWT_E143 = 0x5002BDD8, TP_FLAG_E143 = 0x6004306C;
export const TOUCH_TASK_QUEUE_E143 = { flag: 0x6004306C, queue: 0x600432E8, bit: 8 };
const TOUCH_TASK_SPAN = 0x300;
function touchQueue(img, task, evWt, qerd) {
  let flag, mask, load, d1, bit;
  for (let p = task - 0x50000000, end = p + TOUCH_TASK_SPAN; p < end && !isRet(img, p);) {
    const c = callAt(img, p), to = c ? 0x50000000 + c.to : null;
    if (to === evWt && flag === undefined) [flag, mask] = [load, d1];
    else if (to === qerd) {
      if (flag === undefined || load === undefined || bit === undefined || !(mask & bit)) {
        throw new Error(`touchQueue: the touch task ${h8(task)} receives at ${h8(0x50000000 + p)} after flag ${flag && h8(flag)} mask ${mask}, queue ${load && h8(load)}, bit ${bit}`);
      }
      return { flag, queue: load, bit };
    } else if (!c && bytesAt(img, p, [0xfc, 0xac])) load = u32(img, p + 2);
    else if (!c && bytesAt(img, p, [0xf8, 0xec])) bit = img[p + 2];
    else if (!c && img[p] === 0x85) d1 = img[p + 1];
    p += c?.len ?? insnLength(img[p], img[p + 1]);
  }
  throw new Error(`touchQueue: the touch task ${h8(task)} runs to no receive within ${TOUCH_TASK_SPAN} bytes`);
}

// The RTOS wrapper OlyTaWu (fact 'rtos.ta_wu', and through bin/port.mjs the place of E143's OLYTAWU_E143 0x5002c6a7,
// src/lab/rtos.mjs RTOS, which the lab hooks while it builds the kernel): the caller of wup_tsk (E143's 0x50016bf0, at
// its place in the build) that opens right after a return with `mov d0,Dn; clr Dm; exth d0` (81..83, 00/04/08/0c, 18:
// the task id kept, the result cleared, the id extended) and then calls it (E143 0x5002c6a7 `mov d0,d2; clr d3`; E144
// 0x5003099b `mov d0,d3; clr d2`, its hand override's place before the rule, D). On failure it logs the id with errlog
// 0x43005005 (E143 0x5002c6da, E144 0x500309c8) or, on E125 and E129, prints it (E125 0x500309df: `mov <format>,a0;
// mov d3,d0; call 0x50002137`, D). wup_tsk has 6 callers on the E143- and E144-family bodies and 13 on the E118
// family; one has this opening on each of the 18 expanded images (X, a byte scan at the port's place of wup_tsk); the
// other opening right after a return and calling it at once is `mov (a0),d0; clr d2; exth d0` (E143 0x51788936, D).
// Returns the entry (disassembly notation); throws unless exactly one.
export const WUP_TSK_E143 = 0x50016BF0, OLYTAWU_E143 = 0x5002C6A7;
function taWu(img, wup) {
  const found = [];
  for (const o of callsTo(img, wup - 0x50000000)) {
    const e = o - 3;
    if (isRet(img, e - 3) && img[e] >= 0x81 && img[e] <= 0x83 && (img[e + 1] & 0xf3) === 0 && img[e + 2] === 0x18) found.push(0x50000000 + e);
  }
  if (found.length !== 1) throw new Error(`taWu: ${found.length} callers of wup_tsk ${h8(wup)} open 'mov d0,Dn; clr Dm; exth d0' after a return (${found.map(h8).join(', ')}), want one`);
  return found[0];
}

// The calls of the RTOS service tsnd_dtq (fact 'rtos.tsnd_sites', src/lab/play.mjs TSND_SITES, the sites the guard on
// blocked sends observes), read at the port's place of E143's tsnd_dtq 0x50016578 (docs/om1-kernel-spec.md, the
// service under OlyQeWr): every call of it, as the call's address (disassembly notation). E143's 11, the lab's list (a
// byte scan, docs/om1-input-spec.md S-DISPQ), are the rule's, and so are the places the ports gave the 11 on E146,
// E147, E144, E139, E134, E137, E142, E140 and E125. E145 has 9: it has no counterpart of the two sends E143 makes at
// 0x5100b7ec and 0x5100b880 (E142's 0x50b887cc and 0x50b88860, with timeout 1000 to the queue in (0x60040e88) from a
// loop that copies a quoted string of up to 128 bytes, D), and its port had placed them on code that calls none; E133,
// E130, E129, E132 and the E118 family have 8 (X, a byte scan of each expanded image at the port's place). Every call
// there is a 7-byte `call`, the form the guard checks.
export const TSND_DTQ_E143 = 0x50016578;
function tsndSites(img, tsnd) {
  return callsTo(img, tsnd - 0x50000000).map((p) => 0x50000000 + p);
}

// The settings-DB init's flash save (fact 'store.db_save', and through bin/port.mjs the place of E143's
// DB_SAVE_RETURN_E143 0x503c5537, src/lab/menu.mjs FLASH_SAVE_RETURN, the one return S-FLASHSAVE takes from the DB
// init), read at the port's places of E143's DB init 0x503c5473 (menu.mjs SETTINGS_DB_INIT) and flash save 0x503eee94
// (FLASH_SAVE): the return address of the one call of the flash save among the DB init's instructions from its entry
// to its first ret or retf. E143's init ends with the save (`call 0x503eee94` before `mov a2,d0; ret` at 0x503c5539,
// D); E142's makes it early, after a check (`call 0x502ac7cc; exthu d0; cmp 0,d0; beq`, then `call 0x502ac6bd` at
// 0x5029039c, D), which the map does not pair with E143's. The rule gives the port's place on E147, E144, E146, E139,
// E134, E125 and E137, and E142's 0x502903a3, the save S-FLASHSAVE met there (X, a walk of each at the port's places;
// the other bodies' ports place no DB init or flash save). Returns the return address (disassembly notation); throws
// for no return within DB_INIT_SPAN bytes or not exactly one call of the flash save before it.
export const DB_INIT_E143 = 0x503C5473, FLASH_SAVE_E143 = 0x503EEE94, DB_SAVE_RETURN_E143 = 0x503C5537;
const DB_INIT_SPAN = 0x200;
function dbSave(img, init, save) {
  const saves = [];
  let p = init - 0x50000000;
  for (; p < init - 0x50000000 + DB_INIT_SPAN && !isRet(img, p); p += insnLength(img[p], img[p + 1])) {
    const c = callAt(img, p);
    if (c && c.to === save - 0x50000000) saves.push(0x50000000 + p + c.len);
  }
  if (!isRet(img, p) || saves.length !== 1) throw new Error(`dbSave: the DB init ${h8(init)} ${isRet(img, p) ? `calls the flash save ${h8(save)} ${saves.length} times` : `has no return within 0x${DB_INIT_SPAN.toString(16)} bytes`}, want once`);
  return saves[0];
}

// The application's flash saves besides the DB init's (fact 'store.app_saves', src/lab/menu.mjs S-FLASHSAVE), read at
// the port's place of E143's flash save 0x503eee94 (FLASH_SAVE): the return addresses of its calls that a trace call
// follows at once, `mov imm32,a0; mov -1,d1; call T` (fc dc imm32, 85 ff, dd). E144's power-on sequence saves the
// store so (the call at 0x508766e1, then the trace record 0x602f2270 through 0x508fdb51, D; its hand
// flash_save_returns before the rule), E139's (0x50831121, D) and E142's (0x50789498 and 0x50789958, record
// 0x602cc6d8 through 0x50808c4f, D; S-FLASHSAVE met their returns 0x5078949f and 0x5078995f in the application's
// start, X). The flash save has 14 to 18 callers on the 18 expanded images; 3 of them are followed so on E143, E147,
// E146, E144, E139 and E134 and 5 on the other twelve, each body's with one record and one T (X, a byte scan at the
// port's places); the others, the DB init's among them, are followed by no trace call. Returns the return addresses
// (disassembly notation), in image order; throws where the followers' records or trace functions differ.
function appSaves(img, save) {
  const out = [], traces = new Set();
  for (const c of callsWhere(img, (to) => to === save - 0x50000000)) {
    const t = c.at + c.len;
    if (img[t] !== 0xfc || img[t + 1] !== 0xdc || img[t + 6] !== 0x85 || img[t + 7] !== 0xff || callAt(img, t + 8)?.len !== 7) continue;
    out.push(0x50000000 + t);
    traces.add(`${h8(u32(img, t + 2))} ${h8(0x50000000 + callAt(img, t + 8).to)}`);
  }
  if (traces.size > 1) throw new Error(`appSaves: the flash save ${h8(save)}'s calls are followed by the trace calls ${[...traces].join(', ')}, want one record and function`);
  return out;
}

// The dial-table select (fact 'dial', src/lab/menu.mjs dial_init): the function that indexes the board table of
// {dial-id table, channel-config table} pairs by the core byte and stores the selected id table's address. It opens
// with the core-id getter, `call getter,[],0`, optionally keeps the byte (`movbu d0,(abs32)`), then `extbu d0; asl
// 3,d0`, names the board table in an imm32 (`mov imm32,a0`, `add imm32,a0` or `add imm32,d0`) and stores the word it
// loads, `mov Dn,(abs32)`, before any call or return. E143's 0x5014b7c7 also clears the dial slots after the store (D);
// E139 folds the select into its encoder init 0x5010f9a1 (store at 0x5010f9bc, D), whose rest writes the encoder's
// registers (0x50113c2b: mov d0,(0x9bd00000), which stops the lab, X), and its slot clear 0x5010f984 is a function of
// its own; E143's other opening of this shape, the encoder init 0x5014b7fd, reads the table's second word and stores
// nothing (D). The select is found once on E143, E146, E147, E144, E139, E137, E142, E140, E145, E133, E130, E129 and
// E132 (X, a byte scan of each expanded image; on each but E139 it is the function the map pairs with E143's dial init,
// and its pointer is the map's wherever the map places one); E125 (whose dial init 0x500fec8d searches a byte-pair
// table instead, D), E134 and the E118 family have none (X; dialStore reads E134's and E125's). Returns {select,
// select_end, table_ptr, table0}: the select's entry (disassembly notation; the opening must follow a ret or retf), the
// offset from it of the instruction after the store, the pointer it stores, and board 0's id table, the board table's
// first word (in the image); undefined where no opening indexes a table. Throws for two selects.
const DIAL_INDEX = [0x14, 0xf8, 0xc0, 0x03], DIAL_WALK = 6;
export function dialSelect(img) {
  const { base } = imageBase(img), found = [];
  for (let o = img.indexOf(0xdd); o >= 0 && o + 32 < img.length; o = img.indexOf(0xdd, o + 1)) {
    if (img[o + 5] !== 0 || img[o + 6] !== 0) continue;
    let q = o + 7;
    if (img[q] === 0xfc && img[q + 1] === 0x82) q += 6;
    if (!bytesAt(img, q, DIAL_INDEX)) continue;
    let table = null, store = null;
    for (let k = 0, p = q + DIAL_INDEX.length; k < DIAL_WALK; k++) {
      const op = img[p], o2 = img[p + 1];
      if (callAt(img, p) || isRet(img, p)) break;
      if (op === 0xfc && (o2 === 0xdc || o2 === 0xd0 || o2 === 0xc0)) table = u32(img, p + 2);
      if (op === 0xfc && (o2 & 0xf3) === 0x81) { store = { ptr: u32(img, p + 2), end: p + 6 }; break; }
      p += insnLength(op, o2);
    }
    if (table !== null && store !== null) found.push({ o, table, ...store });
  }
  if (!found.length) return undefined;
  if (found.length > 1) throw new Error(`dialSelect: table selects at ${found.map((f) => h8(0x50000000 + f.o)).join(', ')}, want one`);
  const [{ o, table, ptr, end }] = found;
  const at = table - base, table0 = at >= 0 && at + 4 <= img.length ? u32(img, at) : null;
  if (!isRet(img, o - 3) || table0 === null || table0 < base || table0 >= base + img.length) {
    throw new Error(`dialSelect: the select at ${h8(0x50000000 + o)} follows no return or its board table ${h8(table)} holds no image address`);
  }
  return { select: 0x50000000 + o, select_end: end - o, table_ptr: ptr, table0 };
}

// The dial-table select of the forms dialSelect does not read (fact 'dial' where it reads none), found by its store to
// the port's place of E143's dial table pointer DIAL_TABLE_PTR_E143 (src/lab/menu.mjs DIAL_TABLE_PTR): a function that
// opens as dialSelect's, `call getter,[],0`, after a ret or retf, and runs to a `mov Dn,(ptr)` within DIAL_STORE_SPAN
// bytes. Its board index is either the core byte itself, `extbu d0; asl2 d0`, a board table of one word per board
// (E134's 0x501092da: `mov 0x601bcbac,a0; mov (d0,a0),d1; clr d2; mov d1,(0xa28b9ec8)`, D; E134 has two other board
// selects of this opening, 0x5005a860 and 0x5010947e, which store elsewhere, D, so dialSelect's byte scan cannot take
// the form), or a byte the select looks up, DIAL_SEARCH: it clears an index word, walks N {board byte, index} pairs
// for the core byte and keeps the matching pair's index, then indexes a word table by it (E125's 0x500fec8d: 16 pairs
// at 0x601c521a, every one with index 0; `mov 0x61f8c914,a0; asl2 d0; mov (d0,a0),d1` into 0xa2764308, the table in
// its preloaded data, D). After the index, the walk takes the `mov imm32,a0` before the indexed load `mov (d0,a0),Dn`
// and the store of that Dn, within DIAL_WALK instructions and before any call or return. On both bodies the select is
// the dial init itself (E134's override of E143's 0x5014b7c7; E125's carried from it, D) and board 0's id table holds
// slot id and index pairs as E143's 0x60223dbc does (E134 0x601bcb8c, E125 0x601c523c: 0x2032105, 0; 0x2032104, 1, D).
// Returns {select, select_end, table_ptr, table0} as dialSelect does (table0 the word board 0 selects; img must hold
// the preloaded data, as bin/port.mjs's run-time image does), or undefined where no store has such an opening or its
// select has dialSelect's form (`asl 3,d0`, read there). Throws for two selects, or a table0 outside the image.
export const DIAL_TABLE_PTR_E143 = 0xA32DAAB0;
const DIAL_STORE_SPAN = 0x60;
const DIAL_SEARCH = [0x04, 0xfc, 0x85, null, null, null, null, 0x08, 0x14, 0xdb, 0x1d, 0xe5, 0xf1, 0xe4, 0xfc, 0xd0, null, null, null, null,
  0xf0, 0x44, 0xa1, 0xc9, 0x0d, 0xf8, 0x40, 0x01, 0xfc, 0x81, null, null, null, null, 0xca, 0x08, 0x48, 0x89, 0x1e, 0xaa, null, 0xd0,
  0xfc, 0xa4, null, null, null, null];
function dialOpening(img, base, e) {
  if (img[e] !== 0xdd || img[e + 5] !== 0 || img[e + 6] !== 0 || !isRet(img, e - 3)) return null;
  let q = e + 7;
  if (img[q] === 0xfc && img[q + 1] === 0x82) q += 6;
  if (bytesAt(img, q, DIAL_INDEX)) return { form: 'dialSelect' };
  if (img[q] === 0x14 && img[q + 1] === 0x54) return { p: q + 2, index: 0, scale: 4 };
  const index = u32(img, q + 3);
  if (!bytesAt(img, q, DIAL_SEARCH) || u32(img, q + 30) !== index || u32(img, q + 44) !== index) return null;
  const pairs = u32(img, q + 16) - base, pair = [...Array(img[q + 40]).keys()].find((k) => img[pairs + 2 * k] === 0);
  return { p: q + DIAL_SEARCH.length, index: pair === undefined ? 0 : img[pairs + 2 * pair + 1], scale: 1 };
}
export function dialStore(img, ptr) {
  const { base } = imageBase(img), found = new Map(), b = [ptr & 0xff, ptr >>> 8 & 0xff, ptr >>> 16 & 0xff, ptr >>> 24];
  for (let s = img.indexOf(b[0], 2); s >= 0; s = img.indexOf(b[0], s + 1)) {
    if (!bytesAt(img, s, b) || img[s - 2] !== 0xfc || (img[s - 1] & 0xf3) !== 0x81) continue;
    for (let e = s - 2 - 7; e >= s - 2 - DIAL_STORE_SPAN; e--) {
      const op = dialOpening(img, base, e);
      if (!op || !runsTo(img, e, s - 2)) continue;
      if (op.form === 'dialSelect') return undefined;
      let { p, scale } = op, a0 = null, load = null;
      for (let k = 0; k < DIAL_WALK && p < s - 2 && !callAt(img, p) && !isRet(img, p); k++) {
        if (img[p] === 0x54) scale *= 4;
        if (img[p] === 0xfc && img[p + 1] === 0xdc) a0 = u32(img, p + 2);
        if (img[p] === 0xf3 && (img[p + 1] & 0xcf) === 0 && a0 !== null) load = { table: a0, reg: img[p + 1] >> 4 & 3 };
        p += insnLength(img[p], img[p + 1]);
      }
      if (p !== s - 2 || load === null || load.reg !== (img[s - 1] >> 2 & 3)) continue;
      const at = load.table + scale * op.index - base, table0 = at >= 0 && at + 4 <= img.length ? u32(img, at) : null;
      if (table0 === null || table0 < base || table0 >= base + img.length) {
        throw new Error(`dialStore: the select at ${h8(0x50000000 + e)} indexes ${h8(load.table)}, whose board-0 word is not an image address`);
      }
      found.set(e, { select: 0x50000000 + e, select_end: s + 4 - e, table_ptr: ptr, table0 });
      break;
    }
  }
  if (found.size > 1) throw new Error(`dialStore: table selects at ${[...found.keys()].map((e) => h8(0x50000000 + e)).join(', ')} store ${h8(ptr)}, want one`);
  return found.values().next().value;
}

// The touch panel's I2C write and read on a build whose driver traces them (fact 'touch', and through bin/port.mjs
// the places of E143's TP_I2C_WRITE 0x501e4dfd and TP_I2C_READ 0x501e4f2a, src/lab/display.mjs, which trace nothing):
// a function that logs "[TP_I2C] write start" / "[TP_I2C] read start" as its first call, `mov <name>,a0; call` a few
// instructions after its entry, which follows a ret or retf (E134 0x5021842d, the trace at 0x5021843d, and 0x5017ca2a,
// at 0x5017ca38, D). The entry is the instruction after the last return within TOUCH_WALK bytes before the trace, from
// which the instructions run to it with no call between. E134 holds both names and both functions; E125, E129, E130,
// E132, E133 and E137 hold the names too, the other 11 bodies neither (X, a string count over each expanded image);
// E137 logs "write start" inside a loop of a larger function, not as its first call (0x50177445, D), and its write is
// not read. Returns {i2c_write, i2c_read} with the functions found (disassembly notation), or undefined for none;
// throws for a name found twice or traced twice.
const TOUCH_TRACE = { i2c_write: '[TP_I2C] write start', i2c_read: '[TP_I2C] read start' };
export const TOUCH_E143 = { i2c_write: 0x501E4DFD, i2c_read: 0x501E4F2A }, TOUCH_WALK = 0x20;
export function touchI2c(img) {
  const { base } = imageBase(img), out = {};
  for (const [k, name] of Object.entries(TOUCH_TRACE)) {
    const at = findString(img, name, { nul: true });
    if (!at.length) continue;
    const sites = loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xdc && callAt(img, o + 6));   // mov <name>,a0; call
    if (at.length > 1 || sites.length > 1) throw new Error(`touchI2c: "${name}" ${at.length} times, traced ${sites.length} times, want one each`);
    if (!sites.length) continue;
    const o = sites[0];
    for (let e = o - 1; e >= o - TOUCH_WALK; e--) {
      if (!isRet(img, e - 3)) continue;
      let p = e;
      while (p < o && !callAt(img, p)) p += insnLength(img[p], img[p + 1]);
      if (p === o) { out[k] = 0x50000000 + e; break; }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// The touch panel's open (fact 'touch_api.open', and through bin/port.mjs the place of E143's TP_OPEN 0x501e40da,
// src/lab/play.mjs H-TPSTART) on a build that traces it: the function that loads its trace's name, "[TP]open" or
// "[TP]OPEN \n", before its first call, from a called entry within TOUCH_WALK bytes before the load (E143 0x501e40da:
// `mov 4,d0; mov d0,d1; mov a1,a3; mov <name>,a1; mov a0,a2; mov <format>,a0; call`, D; E125 0x5018504a: `mov 3,d0;
// mov a1,a3; mov a0,a2; mov <name>,a0; call`, D; then both store the callback a0 when the driver's open flag is clear).
// "[TP]open" is held by the E143 family, "[TP]OPEN \n" by E125, E134, E137, E133, E130, E129 and E132, once each, and
// neither by E144, E139, E142, E140, E145 and the E118 family (X, a string count over each expanded image); E129 and
// E132 load theirs nowhere (X, a scan for its address); on E146, E147, E125, E134 and E137 the open found is where
// their cross-build maps place E143's, and E133's and E130's maps place none (X). Returns the entry (disassembly
// notation), or undefined where neither name is held or loaded; throws for a name held twice or loaded at other than
// one such opening.
const TP_OPEN_TRACES = ['[TP]open', '[TP]OPEN \n'];
export const TP_OPEN_E143 = 0x501E40DA;
export function touchOpen(img) {
  const { base } = imageBase(img), at = TP_OPEN_TRACES.flatMap((name) => findString(img, name, { nul: true }));
  if (!at.length) return undefined;
  const loads = at.length === 1 ? loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xdc || img[o + 1] === 0xdd) : [];
  if (at.length === 1 && !loads.length) return undefined;
  // the called offset within TOUCH_WALK bytes before the load whose instructions run to it with no call or return
  const opening = (o) => {
    const called = new Set(callsWhere(img, (t) => t <= o && t > o - TOUCH_WALK).map((c) => c.to));
    return [...called].sort((x, y) => x - y).find((e) => {
      let p = e;
      while (p < o && !callAt(img, p) && !isRet(img, p)) p += insnLength(img[p], img[p + 1]);
      return p === o;
    }) ?? null;
  };
  const entries = loads.map(opening);
  if (at.length !== 1 || entries.length !== 1 || entries[0] === null) throw new Error(`touchOpen: the open's trace name held ${at.length} times, loaded ${loads.length} times, ${entries.filter((e) => e !== null).length} at a function's opening, want one each`);
  return 0x50000000 + entries[0];
}

// Whether the build holds a touch-panel driver (fact 'touch_panel.driver'; src/lab/display.mjs HAS_TOUCH, which hooks
// the touch I2C functions only on such a build, and src/lab/play.mjs, which runs one without as --touch off): the
// driver's debug callback logs "--- tp_drv_dbg_callback ---", which its code loads (`mov imm32,Rn` of the string's
// run-time address). 17 of the 18 expanded images hold the string once; on 15 one load reads it, on E129 and E132
// (TG-5) none, and E145 (TG-7) holds no "tp_drv_" string at all (X, a string and load count over each image). E145's
// boot calls no touch init where E142's does (E142 0x5002562d `call 0x5016bc11`, the touch init; E145's boot at the
// paired place 0x50021bb4 calls 0x50003014, D), nor do its ports through E142, E140 or E144 place E143's touch I2C
// write and read (X); E129 and E132 hold the open's trace "[TP]OPEN \n" but load it nowhere either (X, touchOpen). A
// proxy (I) for the driver, as those three cameras have no touch panel (their specifications); what a load misses is
// not read.
export const touchDriver = (img) => {
  const { base } = imageBase(img);
  return findString(img, '--- tp_drv_dbg_callback ---').some((o) => loadsOf(img, base + o).length > 0);
};

// Whether the build has a lens mount whose lens the lens driver keeps a record of (fact 'lens.mount'; src/lab/camapp.mjs
// S-LENS, which mounts a lens through that record only on such a build): the camera application's getLensConnection
// (E143 0x504106f8, API 0x20041) answers whether lens 0's record is there, `clr d0; call F,[],4; clr d2; cmp 0,a0;
// beq; mov 1,d2`, through F = `exthu d0; call G,[d2],8; ret [],4`, G the driver's record getter (E143 0x502a96b9 ->
// 0x502ac58c, which reads the record pointer 0xa32caa8c, D). One such test on 15 of the 18 expanded images, none on
// E145 (TG-7), E129 and E132 (TG-5), the three bodies with a built-in lens (X, a byte scan of each image), whose
// application has no API 0x20041 (E145's API entries run 0x2003f, 0x20040, 0x20043, X) and whose images hold none of
// the record dump's field names (L_ZMENCdiv, L_FLwide, L_NAME, X). Throws where two tests are found.
export function lensMount(img) {
  return lensRecordGetter(img) !== undefined;
}
// The driver's record getter G of getLensConnection's test (lensMount's rule; image offset), undefined where no test
// is found; throws for two
function lensRecordGetter(img) {
  const test = [0x08, 0xb0, 0x00, 0xc8, 0x04, 0x8a, 0x01], sites = [];
  for (let o = img.indexOf(0xdd, 1); o >= 0 && o + 7 + test.length <= img.length; o = img.indexOf(0xdd, o + 1)) {
    if (img[o - 1] !== 0x00 || img[o + 5] !== 0x00 || img[o + 6] !== 0x04) continue;
    if (!test.every((b, k) => img[o + 7 + k] === b)) continue;
    const f = callAt(img, o).to;
    if (f >= 0 && img[f] === 0x1c && callAt(img, f + 1) && img[f + 1 + callAt(img, f + 1).len] === 0xdf) sites.push({ at: o - 1, getter: callAt(img, f + 1).to });
  }
  if (sites.length > 1) throw new Error(`lensMount: ${sites.length} lens record tests (${sites.map((s) => (0x50000000 + s.at).toString(16)).join(', ')})`);
  return sites[0]?.getter;
}

// The lens driver's entry points and flags that the native lens runs (fact 'lens_driver', src/lab/lens.mjs; docs/
// hle-gaps.md 4.4.2), read at the port's places of E143's CPU 0 kcb (KCB0_E143), OlyTaSt (OLYTAST_E143), OlyQeRd
// (OLYQERD_E143) and LENS_COMMAND's queue-id word (LENS_COMMAND_QUEUE_E143 0x60043226, the module queue 0x31 of the
// target table, src/lab/camapp.mjs MODULE_QUEUE_WORDS). D on E143, from its code:
// - tasks [LENS_MAIN, LENS_COMMAND, LENS_ASKDATA]: the boot starts LENS_MAIN and LENS_ASKDATA right after the lens
//   module init, each `movhu (W),d0; [mov imm32,a2;] exth d0; call OlyTaSt; mov <its name>,a0` (E143 0x50024aca and
//   0x50024ae9, the names "LENS_MAIN" and "LENS_ASKDATA" with their NUL, the trace's), W the task's id word: the entry
//   of the static task (taskRows) of the id W holds (0x5c 0x502a5e37 and 0x5a 0x502a8193, the table's rows at
//   0x50018ac0 and 0x50018a88). LENS_COMMAND, which another init starts by its id word alone (0x501e9b6e), is the
//   static task that runs, with no return between, to a receive on its queue, the queue-id word's `movhu (Q),d0` with
//   OlyQeRd its first call (task 0x5b, 0x50115a08, the row at 0x50018aa4: the load at 0x50115a2a); exec_queue:
//   LENS_MAIN's queue LENS_EXEC, its entry's first such receive (0x502a5e55)
// - module_init: the call before LENS_MAIN's start and the trace before it, `call I; mov T,a0; call; movhu (W),d0`
//   (0x50024ab6); cache_init, task_vars: USTART_L's lens data cache load and task variables, `call C; mov T,a0; call;
//   call V` (0x5002420e, 0x50024222), V the function whose instructions run to the return that ends right before
//   LENS_MAIN's entry (0x502a5dff, its `ret [],8` at 0x502a5e34)
// - flags {valid, attach, ready}: lens 0's data-valid and attach flags (byte arrays by lens), whose accessors lie four
//   in a row, valid's setter and getter, then attach's, `extbu d0; mov F,a0; movbu d1,(d0,a0)` to set and `movbu
//   (d0,a0),d0` to get, each then `retf` (0x501269fc..0x50126a2b); the attach getter is the first call of the record
//   getter that getLensConnection's test calls (lensRecordGetter, 0x502ac597). ready, the sync layer's lens-ready
//   byte: its getter and clearer, `movbu (R),d0; retf; clr d0; movbu d0,(R); retf` (0x502c41a7, 0x502c41b0), end
//   right before the predicate on the lens (0x502c41ba) that the state poll's completion calls before it writes 1 to
//   R, `mov 1,d0; movbu d0,(R)` within READY_SPAN bytes of the call (0x502c38ef, the store 0x502c3944)
// - cache_area [base, size]: the lens data caches' NAND, the rows {u32 base, u32 size, 0, 0} of the flash area
//   driver's lens-cache table that follow one another from its first, `asl 4,d2; mov d2,a1; add T,a1; mov a1,(abs32)`
//   (0x501a9597, T 0x602a4a24: 7 areas of 0x40000 from 0x416e0000; a string follows the table)
// On E146 and E147 every one of them reads (X: their code at the places, the boot starts and USTART_L's calls in
// E143's shapes; the same 15 frames of the lens's start, docs/hle-gaps.md 4.4.2). Returns {module_init, cache_init,
// task_vars, tasks, exec_queue, flags, cache_area} (disassembly notation, run-time words), or undefined where a part
// is not found in E143's shape; throws for a part found twice.
export const LENS_COMMAND_QUEUE_E143 = 0x60043226;
export const LENS_DRIVER_E143 = {
  module_init: 0x502A5D10, cache_init: 0x502A6371, task_vars: 0x502A5DFF,
  tasks: [0x502A5E37, 0x50115A08, 0x502A8193], exec_queue: 0x60043220,
  flags: { valid: 0xA32D4B98, attach: 0xA32D4B9A, ready: 0xA32D4B94 }, cache_area: [0x416E0000, 0x1C0000],
};
const LENS_FLAG_GET = [0x14, 0xfc, 0xdc, null, null, null, null, 0xf4, 0x00, 0xde, 0x00, 0x00];
const LENS_FLAG_SET = [0x14, 0xfc, 0xdc, null, null, null, null, 0xf4, 0x50, 0xde, 0x00, 0x00];
const LENS_READY_PAIR = [0xfc, 0xa8, null, null, null, null, 0xde, 0x00, 0x00, 0x00, 0xfc, 0x82, null, null, null, null, 0xde, 0x00, 0x00];
const LENS_CACHE_TABLE = [0xf8, 0xc2, 0x04, 0xf1, 0xe9, 0xfc, 0xd1, null, null, null, null, 0xfc, 0x84];
const LENS_TASK_SPAN = 0x80, LENS_VARS_SPAN = 0x100, READY_SPAN = 0x80, RECEIVE_WALK = 6;
// Whether the `movhu (Q),d0` at offset p is a receive: its first call within RECEIVE_WALK instructions is OlyQeRd
function isReceive(img, p, qerd) {
  if (!bytesAt(img, p, [0xfc, 0xac])) return false;
  for (let q = p, k = 0; k < RECEIVE_WALK; k++) {
    const c = callAt(img, q);
    if (c) return 0x50000000 + c.to === qerd;
    q += insnLength(img[q], img[q + 1]);
  }
  return false;
}
export function lensDriver(img, { kcb, taSt, qerd, commandQueue }) {
  const { base } = imageBase(img), rows = taskRows(img, kcb, 'lensDriver'), byId = new Map(rows.map((r) => [r.id, r.entry]));
  // the boot's starts: the name's load right after `movhu (W),d0; [mov imm32,a2;] exth d0; call OlyTaSt`
  const names = ['LENS_MAIN', 'LENS_ASKDATA'], addr = new Map(names.flatMap((n) => findString(img, n, { nul: true, after: true }).map((o) => [(base + o) >>> 0, n])));
  // one walk of the fc-prefixed instructions: the names' loads, LENS_COMMAND's queue word's loads and the getter-clearer
  // pairs of a byte (the ready byte's candidates)
  const loads = new Map(names.map((n) => [n, []])), commandLoads = [], pairs = [];
  for (let p = img.indexOf(0xfc); p >= 0 && p + 6 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    const v = loadAt(img, p), o2 = img[p + 1];
    if (v !== null && addr.has(v)) loads.get(addr.get(v)).push(p);
    else if (o2 === 0xac && u32(img, p + 2) === commandQueue) commandLoads.push(p);
    else if (o2 === 0xa8 && bytesAt(img, p, LENS_READY_PAIR) && u32(img, p + 2) === u32(img, p + 12)) pairs.push(p);
  }
  const start = (name) => {
    const found = [];
    for (const p of loads.get(name)) {
      const c = [5, 7].map((len) => [p - len, callAt(img, p - len)]).find(([at, x]) => x?.len === p - at && 0x50000000 + x.to === taSt);
      if (!c || img[c[0] - 1] !== 0x18) continue;
      const w = [c[0] - 7, c[0] - 13].find((q) => bytesAt(img, q, [0xfc, 0xac]) && (q === c[0] - 7 || bytesAt(img, q + 6, [0xfc, 0xde])));
      if (w !== undefined) found.push({ at: w, word: u32(img, w + 2) });
    }
    if (found.length > 1) throw new Error(`lensDriver: ${found.length} starts of ${name} (${found.map((f) => h8(0x50000000 + f.at)).join(', ')}), want one`);
    if (!found.length) return undefined;
    const { at, word } = found[0], id = img[word - base] | img[word - base + 1] << 8;
    return byId.has(id) ? { at, entry: byId.get(id) } : undefined;
  };
  const main = start('LENS_MAIN'), ask = start('LENS_ASKDATA');
  if (!main || !ask) return undefined;
  // the module init: `call I,[],8; mov T,a0; call` before LENS_MAIN's start
  const init = callAt(img, main.at - 20);
  if (init?.len !== 7 || !bytesAt(img, main.at - 13, [0xfc, 0xdc]) || callAt(img, main.at - 7)?.len !== 7) return undefined;
  // the receives: LENS_MAIN's queue (its entry's first receive), and the task that runs to LENS_COMMAND's
  const e = main.entry - 0x50000000;
  let q = e;
  while (q < e + LENS_TASK_SPAN && !isRet(img, q) && !isReceive(img, q, qerd)) q += callAt(img, q)?.len ?? insnLength(img[q], img[q + 1]);
  if (!isReceive(img, q, qerd)) return undefined;
  const exec = u32(img, q + 2), sites = commandLoads.filter((p) => isReceive(img, p, qerd));
  const command = rows.filter(({ entry }) => { const t = entry - 0x50000000; return sites.some((at) => at > t && at - t <= LENS_TASK_SPAN && runsTo(img, t, at)); });
  if (command.length > 1) throw new Error(`lensDriver: ${command.length} static tasks (${command.map((r) => h8(r.entry)).join(', ')}) run to a receive on LENS_COMMAND's queue ${h8(commandQueue)}, want one`);
  // USTART_L's calls: `call C; mov T,a0; call; call V`, V ending right before LENS_MAIN's entry
  const vars = !isRet(img, e - 3) ? [] : callsWhere(img, (t) => t < e && e - t <= LENS_VARS_SPAN && runsTo(img, t, e - 3))
    .filter((c) => c.len === 7 && callAt(img, c.at - 7)?.len === 7 && bytesAt(img, c.at - 13, [0xfc, 0xdc]) && callAt(img, c.at - 20)?.len === 7);
  if (vars.length > 1) throw new Error(`lensDriver: ${vars.length} calls of a function ending before LENS_MAIN's entry after a call and a trace (${vars.map((c) => h8(0x50000000 + c.at)).join(', ')}), want one`);
  // the flags: the attach getter is the record getter's first call, the other three accessors before it
  const g = lensRecordGetter(img);
  let p = g, att;
  for (let k = 0; g !== undefined && k < 16 && att === undefined; k++) { const c = callAt(img, p); if (c) att = c.to; else p += insnLength(img[p], img[p + 1]); }
  const flag = (o, pat) => (o !== undefined && bytesAt(img, o, pat) ? u32(img, o + 3) : null);
  const attach = flag(att, LENS_FLAG_GET), valid = flag(att - 24, LENS_FLAG_GET);
  const flagsHold = attach !== null && valid !== null && flag(att - 12, LENS_FLAG_SET) === attach && flag(att - 36, LENS_FLAG_SET) === valid;
  // the ready byte: the getter-clearer pair before the predicate whose caller then writes the byte 1
  const ready = [];
  for (const o of pairs) {
    const r = u32(img, o + 2), set = [0x80, 0x01, 0xfc, 0x82, ...le32(r)];
    if (callsTo(img, o + LENS_READY_PAIR.length).some((c) => { for (let k = c; k < c + READY_SPAN; k++) if (bytesAt(img, k, set)) return true; return false; })) ready.push(r);
  }
  if (ready.length > 1) throw new Error(`lensDriver: ${ready.length} lens-ready bytes (${ready.map(h8).join(', ')}), want one`);
  // the lens caches' NAND: the table's rows that follow one another
  const t = oneAt(img, LENS_CACHE_TABLE, 'lensDriver', 'lens-cache table reads');
  if (command.length !== 1 || vars.length !== 1 || !flagsHold || ready.length !== 1 || t === null) return undefined;
  const table = u32(img, t + 7) - base, area = [u32(img, table), 0];
  for (let k = table; u32(img, k) === area[0] + area[1] && u32(img, k + 4) > 0 && !u32(img, k + 8) && !u32(img, k + 12); k += 16) area[1] += u32(img, k + 4);
  return {
    module_init: 0x50000000 + init.to, cache_init: 0x50000000 + callAt(img, vars[0].at - 20).to, task_vars: 0x50000000 + vars[0].to,
    tasks: [main.entry, command[0].entry, ask.entry], exec_queue: exec, flags: { valid, attach, ready: ready[0] }, cache_area: area,
  };
}

// Where the lens record keeps its zoom table (fact 'lens_record.zoom_table', src/lab/camapp.mjs S-LENS, which writes
// the 12-40's zoom steps there), read at the port's place of E143's current-focal-length read (LENS_FOCAL_NOW_E143
// 0x50129980, camapp.mjs LENS_FOCAL_NOW): it takes the record from the driver's getter and reads the focal length of the
// current zoom step's 16-byte entry, `add T,a0; asl 4,d0; movhu (d0,a0),d0`, within LENS_READ_SPAN bytes of its entry
// (E143 0x5012998f, D). The focal-length interpolation beside it indexes the same table (E143 `add 1164,a2` at
// 0x501298de) and divides by the difference of two neighbouring entries' focal lengths (0x5012994f, D). T is 1164 on
// E143, E146 and E147, 1156 on E144, E139, E134, E137, E142, E140 and E125, 644 on E130 and E133, 640 on E118 and
// E122 and 628 on E120 (X, the read at each port's place; the interpolation's index agrees on the twelve E143- and
// E144-family bodies with a lens mount, X); none on the three bodies with a built-in lens. S-LENS wrote the steps at
// E143's 1164, so E140's interpolation at S1's END_FOCUS divided by zero (0x500d96d1, X). Returns T, or undefined where
// the place does not hold that sequence.
export const LENS_FOCAL_NOW_E143 = 0x50129980, LENS_ZOOM_TABLE_E143 = 1164;
const LENS_READ_SPAN = 0x20, LENS_INDEX = [0xfa, 0xd0, null, null, 0xf8, 0xc0, 0x04, 0xf4, 0x80];
export function lensZoomTable(img, fn) {
  const e = fn - 0x50000000;
  for (let p = e; p < e + LENS_READ_SPAN; p++) if (bytesAt(img, p, LENS_INDEX)) return img[p + 2] | img[p + 3] << 8;
  return undefined;
}

// The lens record's static buffer (fact 'lens_record.static', src/lab/camapp.mjs S-LENS, which points the record at it
// and fills it), read at the port's place of E143's record pointer (LENS_RECORD_E143 0xa32caa8c): on the E144 family
// the lens driver's init points the record at a static buffer aligned to 64 bytes, `mov -64,d1; mov S,d0; add 63,d0;
// and d1,d0; mov d0,(W); mov d0,(record)` (E140 0x501d2284, S 0xa2682cc8, D), once on each of the ten E144-family
// and the three E118-family bodies with a lens mount (E140 and E142 0xa2682d00, E144 0xa25988c0, E134 0xa27cf940, X, a
// byte scan at each port's place), on none of the E143 family. The lab does not run that init. S-LENS had put E143's buffer (0xa3193780; E143's driver picks one of two
// slots of a run-time area at the lens's attach, 0x502b3c5f and 0x502b3c9e, D) in the pointer on every body: on E140
// the bytes there held a nonzero flag (the record's +35366) that sent S1's focal-length interpolation down the path
// that divides by zero (X). Returns the buffer's address, or null where no such init stores the pointer (the E143
// family, whose S-LENS keeps E143's buffer); throws for two.
export const LENS_RECORD_E143 = 0xA32CAA8C;
const LENS_ALIGN = [0x85, 0xc0, 0xfc, 0xcc, null, null, null, null, 0x28, 0x3f, 0xf2, 0x04], LENS_ALIGN_SPAN = 24;
export function lensStatic(img, record) {
  const found = [];
  for (let p = img.indexOf(0xfc); p >= 0 && p + 6 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    if (img[p + 1] !== 0x81 || u32(img, p + 2) !== record) continue;
    for (let q = p - LENS_ALIGN_SPAN; q < p; q++) if (q >= 0 && bytesAt(img, q, LENS_ALIGN)) { found.push(((u32(img, q + 4) + 63) & ~63) >>> 0); break; }
  }
  if (found.length > 1) throw new Error(`lensStatic: ${found.length} aligned inits of the lens record pointer ${h8(record)}, want one`);
  return found[0] ?? null;
}

// The IIC bus driver's completion waits (fact 'iic.waits', src/lab/play.mjs S-IICWAIT, which answers them at once as a
// bus with no device would): a blocking transfer is `mov C,a1; call S; call W`, S the transfer's start, which keeps
// the run-time callback C for the controller's completion, and W the wait for C's flag F with no timeout, `mov -1,d0;
// mov d0,(4,sp); movhu (F),d0; mov sp,a0; exth d0; add 8,a0; mov 1,d1; mov 1,a1; call OlyEvWt`; C sets F, `movhu
// (F),d0; mov 1,d1; exth d0; call` within IIC_CALLBACK_SPAN bytes of its entry (E145: the WHOAMI read of the compass,
// bus channel 5, `mov 0x60065d1f,a1; call 0x50044ae8; call 0x50044d60` at 0x50044c8c, C 0x50044cff, F (0x60041508),
// D; its start writes the controller at 0x9a200080..0x9a200094, X; E143's W 0x5004cbf6, C 0x5004cb95, F (0x60043086),
// D). One W on each of the 18 bodies but E134, which has another driver (its transfers send a message and wait inline,
// 0x50042df1, D): reached from 4 transfers on E145, 3 on E129 and E132, 2 on the others (X, a byte scan of each
// expanded image). Returns the waits found (disassembly notation), [] for none.
export const IIC_WAITS_E143 = [0x5004CBF6];
const IIC_WAIT = [0x80, 0xff, 0x42, 0x04, 0xfc, 0xac, null, null, null, null, 0x3c, 0x18, 0x20, 0x08, 0x85, 0x01, 0x95, 0x01];
const IIC_SET = [0x85, 0x01, 0x18], IIC_CALLBACK_SPAN = 0x30;
export function iicWaits(img) {
  const { base } = imageBase(img), waits = new Set();
  for (let p = img.indexOf(0xfc); p >= 0 && p + 6 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    if (img[p + 1] !== 0xdd) continue;                                           // mov imm32,a1
    const c = u32(img, p + 2) - base, s = callAt(img, p + 6), w = s && callAt(img, p + 6 + s.len);
    if (c < 0 || c >= img.length || !w || !bytesAt(img, w.to, IIC_WAIT) || !callAt(img, w.to + IIC_WAIT.length)) continue;
    const f = u32(img, w.to + 6);
    let sets = false;
    for (let q = c; q < c + IIC_CALLBACK_SPAN && !sets; q++) sets = img[q] === 0xfc && img[q + 1] === 0xac && u32(img, q + 2) === f && bytesAt(img, q + 6, IIC_SET) && !!callAt(img, q + 6 + IIC_SET.length);
    if (sets) waits.add(0x50000000 + w.to);
  }
  return [...waits].sort((a, b) => a - b);
}

// Where the touch panel's I2C write and read take their length (fact 'touch_args', src/lab/display.mjs tp_i2c_write
// and tp_i2c_read, src/lab/play.mjs S-TPREG), read at the port's places of E143's TOUCH_E143 functions: {sp: k}, the
// u16 at the entry's sp + k, or {reg: 'a1'}. The rule walks a function from its entry to its first ret or retf
// (`ret [regs],F`: the call frame F, its return address at the entry's sp + F), past an opening `add -X,sp`: a
// `movhu (N,sp),Dn` (f8 bc..bf N / fa bc..bf N16) at N - X > F loads a stack argument, the length, and every such load
// must agree. E143's write loads it at 20 (`add -252,sp; ... movhu (272,sp),d2` at 0x501e4e10, F 16) and its read
// takes it in a1 (`mov a1,a2` at 0x501e4f2e, then `mov a2,d2; exthu d2; mov d2,(4,sp)`, the transfer's length, at
// 0x501e4f75, D); the E144 driver's write at 24 (E142 0x5016c8bc: `add -268,sp; ... movhu (292,sp),d2`, F 16, a byte
// argument at 20) and its read at 40 (E142 0x5016cbe8: `movhu (40,sp),d0` at 0x5016cc87, F 36; a1 is a register
// byte, stored at (12,sp), D). E142's player wrote a1 = 6 zero bytes for a 1-byte read into a 12-byte frame and
// returned through the clobbered address to 0x60180000 (X). Found on the 13 bodies whose ports place the functions:
// as E143's on E146 and E147, at 24 and 40 on E144, E139, E137 and E142, at 152 and 36 on E134, E125, E129, E130,
// E132 and E133 (X, a walk at each port's places). A part is missing where the function at the place loads no stack
// argument and (a read) keeps no a1 at its entry (E140's write place 0x5016c56e, not checked as its driver's);
// throws where loads disagree or no ret follows within TOUCH_ARGS_SPAN bytes.
export const TOUCH_ARGS_E143 = { write_len: { sp: 20 }, read_len: { reg: 'a1' } };
const TOUCH_ARGS_SPAN = 0x400, TOUCH_KEEP = 8;
function touchLength(img, fn, read) {
  const e = fn - 0x50000000;
  let p = e, x = 0;
  if (img[p] === 0xf8 && img[p + 1] === 0xfe) x = -((img[p + 2] << 24) >> 24);
  else if (img[p] === 0xfa && img[p + 1] === 0xfe) x = -((img[p + 2] | img[p + 3] << 8) << 16 >> 16);
  const loads = [];
  let keep = false;
  for (let k = 0; p < e + TOUCH_ARGS_SPAN && !isRet(img, p); k++) {
    const op = img[p], o2 = img[p + 1];
    if (op === 0xf8 && (o2 & 0xfc) === 0xbc) loads.push(img[p + 2] - x);
    if (op === 0xfa && (o2 & 0xfc) === 0xbc) loads.push((img[p + 2] | img[p + 3] << 8) - x);
    if (k < TOUCH_KEEP && (op & 0xfc) === 0x94 && (op & 3) !== 1) keep = true;   // mov a1,An (An != a1)
    p += callAt(img, p)?.len ?? insnLength(op, o2);
  }
  if (!isRet(img, p)) throw new Error(`touchArgs: no return within 0x${TOUCH_ARGS_SPAN.toString(16)} bytes of ${h8(fn)}`);
  const args = [...new Set(loads.filter((n) => n > img[p + 2]))];
  if (args.length > 1) throw new Error(`touchArgs: ${h8(fn)} loads the u16 stack arguments ${args.join(', ')} (frame ${img[p + 2]}), want one`);
  if (args.length) return { sp: args[0] };
  return read && keep ? { reg: 'a1' } : undefined;
}
function touchArgs(img, write, read) {
  const w = write === null ? undefined : touchLength(img, write, false), r = read === null ? undefined : touchLength(img, read, true);
  return { ...(w !== undefined && { write_len: w }), ...(r !== undefined && { read_len: r }) };
}

// The face plane's colour setter, display_vscdrv_extosd_cpdata_set(channel d0, index d1, word a0) (fact
// 'display.face_colour', and through bin/port.mjs the place of E143's FACE_COLOUR_SET_E143 0x501e061a, src/lab/camapp.mjs
// S-DISPFRAME, which the lab calls for each of the eight colours on both channels): where its trace "[DISP] <DRV>
// :display_vscdrv_extosd_cpdata_set CH=" is held, the entry of the function that loads it, `mov <name>,a0` (fc dc
// imm32) after `mov 3,d0` (entryOf, within FACE_COLOUR_SPAN bytes). Such a setter maps the channel first, prints the
// trace, then stores the word at 4 * index + 0x9c002e00 in the channel's bank (E137 0x50023161, its load 0x5002316b;
// E145 0x5016dc26, after a `ret`, its load 0x5016dc32, D), where E143's stores it untraced (0x501e061a, at 4 * index +
// 0x9bb80d00, D). The name is held once and loaded once on E134, E137, E125, E145, E133, E130, E129 and E132, and on
// none of the other ten (X, a byte scan of each expanded image); the entry is the port's place on E134, E137, E125,
// E129 and E132, and the maps placed none on E145, E133 and E130 (X). Returns the entry (disassembly notation), or
// undefined where the name is not held; throws for a name held or loaded twice, held and not loaded, or no entry.
const FACE_COLOUR_TRACE = '[DISP] <DRV> :display_vscdrv_extosd_cpdata_set CH=', FACE_COLOUR_SPAN = 0x20;
export const FACE_COLOUR_SET_E143 = 0x501E061A;
function faceColourSet(img) {
  const { base } = imageBase(img), at = findString(img, FACE_COLOUR_TRACE, { nul: true });
  if (!at.length) return undefined;
  const loads = loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xdc && img[o - 2] === 0x80 && img[o - 1] === 0x03);   // mov 3,d0; mov <name>,a0
  if (at.length > 1 || loads.length !== 1) throw new Error(`faceColourSet: "${FACE_COLOUR_TRACE}" ${at.length} times, loaded ${loads.length} times, want one each`);
  const e = entryOf(img, loads[0], FACE_COLOUR_SPAN);
  if (e === undefined) throw new Error(`faceColourSet: no function entry within 0x${FACE_COLOUR_SPAN.toString(16)} bytes before the load at ${h8(0x50000000 + loads[0])}`);
  return 0x50000000 + e;
}

// The application's shooting service, entered and left (fact 'shooting', and through bin/port.mjs the places of E143's
// SHOOTING_START 0x50ae1124 and SHOOTING_END 0x50ad7e8a, src/lab/camapp.mjs S-RELSEQ): the load of each one's opening
// trace, `mov <name>,d0` (fc cc imm32) of "OlyHfwOpeShoot::startShootingService start" / "...::endShooting Service
// start" before `mov d0,(4,sp); clr d0; call` (E143 0x50ae1124 / 0x50ad7e8a, E139 0x5081c17b / 0x5081271b, E134
// 0x5084050b / 0x50836b06, D). Each name is held once and loaded once on each of the 18 expanded images; the sites are
// the port's places wherever its map placed one, and the map placed no start on E134, E125, E129, E132 and the E118
// family (X, a byte scan). The same for the application's through-image control OlyHfwOpeShoot::ctrlAutoThrough(ctrl)
// (auto_through, the place of E143's 0x50abd373, src/lab/camapp.mjs S-THROUGH, which reads ctrl in d0 at the entry),
// the function that loads "OlyHfwOpeShoot::ctrlAutoThrough() s ctrl[%d]": the entry of the function holding the load
// (entryOf, within SHOOTING_SPAN bytes; E143 0x50abd373, its load 0x50abd384; E145 0x506aad24, `mov d1,d2; mov d0,d3`
// and the trace prints d3, its load 0x506aad33, called from 0x506ecc3f, D). The name is held once and loaded once on
// each of the 18 expanded images; the entry is the port's place on every body whose map placed one, and the maps placed
// none on E145, E129, E132 and the E118 family (X, a byte scan). Returns {start, end, auto_through} (disassembly
// notation; a part missing where its name is not held); throws for a name held or loaded twice, held and not loaded, or
// an auto_through load with no entry.
const SHOOTING_TRACE = { start: 'OlyHfwOpeShoot::startShootingService start', end: 'OlyHfwOpeShoot::endShootingService start',
  auto_through: 'OlyHfwOpeShoot::ctrlAutoThrough() s ctrl[%d]' };
const SHOOTING_ENTRY = new Set(['auto_through']), SHOOTING_SPAN = 0x40;
export const SHOOTING_E143 = { start: 0x50AE1124, end: 0x50AD7E8A, auto_through: 0x50ABD373 };
export function shootingService(img) {
  const { base } = imageBase(img), out = {};
  for (const [k, name] of Object.entries(SHOOTING_TRACE)) {
    const at = findString(img, name, { nul: true });
    if (!at.length) continue;
    const sites = loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xcc);                    // mov <name>,d0
    if (at.length > 1 || sites.length !== 1) throw new Error(`shootingService: "${name}" ${at.length} times, loaded ${sites.length} times, want one each`);
    const o = SHOOTING_ENTRY.has(k) ? entryOf(img, sites[0], SHOOTING_SPAN) : sites[0];
    if (o === undefined) throw new Error(`shootingService: no function entry within 0x${SHOOTING_SPAN.toString(16)} bytes before the load of "${name}" at ${h8(0x50000000 + sites[0])}`);
    out[k] = 0x50000000 + o;
  }
  return Object.keys(out).length ? out : undefined;
}

// The remaining-shots query (fact 'card.shots_query', and through bin/port.mjs the place of E143's SHOTS_QUERY_E143
// 0x50419164, src/lab/camapp.mjs S-CARD, which answers it in d0): the function the application's
// OlyHfwOpeShoot::getAvailableShootCount calls for the count, the callee of the call between the method's start and end
// traces ("OlyHfwOpeShoot::getAvailableShootCount start", "... end = available %d waitSave %d") that is followed by
// `movhu d0,(An)` (f0 70..73), the method's store of the count, but for a callee the method also calls right after a
// `mov imm,d0`: its settings read, through which the bodies with a gate read a kept count (E143 `mov 1436,d0; call
// 0x503c4ba8; movhu d0,(a3)` at 0x50ad89bf, taken where setting 477 is 1 and 484 is not 0, D; not taken in a session,
// X). The callee is a module request of one of three forms (D): the query proper on the E143 family and E144, E139,
// E134, E137 and E125 (E143 0x50419164, called at 0x50ad89d6 and 0x50ad8a51; it opens with the trace `mov 4,d0; mov
// 1,d1; mov 0x200f0,a0; call`, reads settings 1129 and 1134 and calls the count 0x50416d9a per slot); the module
// 0x2800c's three-argument wrapper of the count (`mov a0,a2; mov d1,d2; mov d0,d3; mov 4,d0; mov 1,d1; mov 0x2800c,a0`)
// on E142, E140 and E145 (E142 0x502c79db, called at 0x5076b263, calling the count 0x502d0a38) and on E133, E130, E129
// and E132 (E133 0x502dab10); a wrapper with no trace on the E118 family (E118 0x502c2877). Before this rule the place
// was the callee the store `mov d0,d2; mov -1,d0; call d16 [d2,d3],16; mov d2,(abs32)` follows: E143's 0x517fdb32
// stores the count to 0xa320c08c under the lock 0x517fddbc, a component whose init message is sent at 0x517ecc22,
// amid the Wi-Fi manager's app-protocol sequence (D), and which no session runs (X); on E142, E140 and E145 it calls
// the query proper (E142 0x502d2e89), which their application does not, so S-CARD answered nothing there, their count
// was the count function's own, 0, and the GUI's card-full test (E143 0x51055c38, through the HLS API 0x20116 whose
// handler calls the method) showed "Card Full" (X: S-CARD's hook counts per session; with this place E142, E140 and
// E145 ask it 27, 27 and 10 times and E142 and E140 show 999 shots). Each trace is held and loaded once on each of the
// 18 expanded images, and exactly one callee is left on each (X, a byte scan). Returns the entry (disassembly
// notation); throws for a trace not held or loaded once, or for none or two callees.
export const SHOTS_QUERY_E143 = 0x50419164;
const SHOTS_TRACE = ['OlyHfwOpeShoot::getAvailableShootCount start', 'OlyHfwOpeShoot::getAvailableShootCount end = available %d waitSave %d'];
// mov imm8,d0 (80 xx), mov imm16,d0 (2c xx xx), mov imm32,d0 (fc cc imm32)
const movImmD0 = (img, p) => img[p] === 0x80 || img[p] === 0x2c || (img[p] === 0xfc && img[p + 1] === 0xcc);
export function shotsQuery(img) {
  const { base } = imageBase(img);
  const [from, to] = SHOTS_TRACE.map((name) => {
    const at = findString(img, name, { nul: true }), sites = at.length === 1 ? loadsOf(img, base + at[0]).filter((o) => img[o + 1] === 0xcc) : [];
    if (sites.length !== 1) throw new Error(`shotsQuery: "${name}" held ${at.length} times, loaded ${sites.length} times, want one each`);
    return sites[0];
  });
  const stored = new Set(), settings = new Set();
  for (let p = from, prev = -1; p < to; prev = p, p += callAt(img, p)?.len ?? insnLength(img[p], img[p + 1])) {
    const c = callAt(img, p);
    if (!c) continue;
    if (prev >= 0 && movImmD0(img, prev)) settings.add(c.to);
    if (img[p + c.len] === 0xf0 && (img[p + c.len + 1] & 0xfc) === 0x70) stored.add(c.to);
  }
  const q = [...stored].filter((t) => !settings.has(t));
  if (q.length !== 1) throw new Error(`shotsQuery: ${q.length} callees whose result getAvailableShootCount stores (${q.map((t) => h8(0x50000000 + t)).join(', ')}), want one`);
  return 0x50000000 + q[0];
}

// The card slots' detect states (fact 'card.detect', src/lab/camapp.mjs S-CARD): the file layer's drive status (E143
// 0x508a8327) sets its card-present bit 0x80 where `call T; exthu d0; cmp 0,d0; beq; or 128,d2` (1c a0 00 c8 05 f8 e6
// 80, E143 at 0x508a83bb) finds the drive's state 2 or 3: T (E143 0x5087bc22) is `mov d0,d1; exthu d1; cmp N,d1; bge`,
// then the drive's halfword in the table T loads, `mov imm32,a0` (fc dc), `movhu (d0,a0),d0; cmp 2,d0; beq; cmp
// 3,d0` (D). The driver's init writes 1 to every drive (E143 0x5087bc5e) and its insertion handler 2 where it finds 1
// (0x5087bd4c), the card's init then 3 (0x5087be64, D); which event runs the handler is not read. On E143, E146, E139,
// E134 and E125 N is 2, on the other 13 images 1, the bodies with two card slots and with one (D; the number of slots
// is the bodies', not read from the firmware). The GUI's shooting-screen count asks for a slot's count only where the
// media control reports the slot present (E143's updater 0x511ff915 through 0x5120054d, getMediaStateInfo +4, which
// is the status bit 0x80, D), so with every drive at 1 the E143 and E144 families showed no count or an orange 0 (X).
// Exactly one such test on each of the 18 expanded images, T of the same form on all (X, a byte scan). Returns {table
// (the run-time address of drive 0's halfword), drives (N)}; throws unless one.
export const CARD_DETECT_E143 = { table: 0xA33AF3D4, drives: 2 };
const DETECT_TEST = [0x1c, 0xa0, 0x00, 0xc8, 0x05, 0xf8, 0xe6, 0x80];
const DETECT_FORM = [0x81, 0x1d, 0xa5, null, 0xc2, null, 0x1c, 0xe0, 0xfc, 0xdc, null, null, null, null, 0xf4, 0x80, 0xa0,
  0x02, 0xc8, null, 0xa0, 0x03];
export function cardDetect(img) {
  const tests = [];
  for (let o = img.indexOf(0xf8); o >= 0; o = img.indexOf(0xf8, o + 1)) {
    const at = o - 5;
    if (at < 7 || !bytesAt(img, at, DETECT_TEST)) continue;
    const c = [7, 5].map((n) => ({ n, c: callAt(img, at - n) })).find(({ n, c }) => c?.len === n);
    if (c) tests.push(c.c.to);
  }
  if (tests.length !== 1) throw new Error(`cardDetect: ${tests.length} card-present tests in the drive status, want one`);
  const t = tests[0];
  if (!bytesAt(img, t, DETECT_FORM)) throw new Error(`cardDetect: the test ${h8(0x50000000 + t)} is not the detect-state read`);
  return { table: u32(img, t + 10), drives: img[t + 3] };
}

// The deferred calls (board dpc, src/dev/dpc.mjs; fact 'dpc.init', src/lab/play.mjs H-DPCINIT): a post puts a call on
// its core's ring, enables the ring's IRQ for that core and writes 1 to the IRQ's trigger word, and the IRQ's handler
// runs the ring (E143 0x500503d4, IRQ 53; E132 0x5004a236: the ring 0x5004a34c, the enable 0x5004be41(29, core), the
// word 0x9b800030, D). The init, which the boot head calls before the kernel (E143 0x50050279 from 0x50000270, E132
// 0x5004a115 from 0x500002ea, D), clears the rings, writes 0 to the first two words, `mov d0,(W); mov d0,(W+4)`,
// attaches their IRQs on every core and disables them, then writes 0 to the other four, `mov d0,(W+8)` .. `(W+20)`,
// and attaches theirs on its own core, each IRQ loaded by `mov N,d0` before its attach (E143: W 0x9b880044, IRQs
// 53..58; E132: W 0x9b800030, IRQs 29..34, on three cores, D). One such init on each of the 15 expanded images but the
// E118 family's (X, a byte scan of the 18: W 0x9b880044 and IRQs 53..58 on the E143 family, W 0x9b800030 and IRQs
// 29..34 on the others). Returns {init (disassembly notation), triggers: W, irqs: the six IRQs in their words' order},
// or undefined where no init stores six words so and loads six consecutive IRQs; throws for two, or one that no call
// enters.
export const DPC_E143 = { init: 0x50050279 };
const DPC_WORDS = 6, DPC_SPAN = 0x180, MMIO = [0x90000000, 0xA0000000];
export function deferredCalls(img) {
  const store = (o, w) => img[o] === 0xfc && img[o + 1] === 0x81 && u32(img, o + 2) === w;
  const found = [];
  for (let p = img.indexOf(0xfc); p >= 0 && p + 12 <= img.length; p = img.indexOf(0xfc, p + 1)) {
    const w = u32(img, p + 2);
    if (img[p + 1] !== 0x81 || w < MMIO[0] || w >= MMIO[1] || !store(p + 6, w + 4) || store(p - 6, w - 4)) continue;
    let q = p + 12;
    while (q + 24 <= Math.min(img.length, p + DPC_SPAN) && ![0, 1, 2, 3].every((i) => store(q + 6 * i, w + 8 + 4 * i))) q++;
    if (q + 24 > Math.min(img.length, p + DPC_SPAN)) continue;
    // the IRQs: the operands of `mov imm8,d0` (80 NN) from the first store to the init's return, in first-load order
    const irqs = [];
    let r = p;
    for (; r - p <= DPC_SPAN && (r < q + 24 || !isRet(img, r)); r += callAt(img, r)?.len ?? insnLength(img[r], img[r + 1])) {
      if (img[r] === 0x80 && !irqs.includes(img[r + 1])) irqs.push(img[r + 1]);
    }
    // the six words' IRQs are six consecutive lines (E143 53..58, E132 29..34, D)
    if (r - p <= DPC_SPAN && irqs.length === DPC_WORDS && irqs.every((n, i) => n === irqs[0] + i)) found.push({ p, w, irqs });
  }
  if (!found.length) return undefined;
  if (found.length > 1) throw new Error(`deferredCalls: ${found.length} trigger inits (${found.map((f) => h8(0x50000000 + f.p)).join(', ')}), want one`);
  const { p, w, irqs } = found[0], init = entryOf(img, p, DPC_SPAN);
  if (init === undefined) throw new Error(`deferredCalls: the trigger init's stores at ${h8(0x50000000 + p)} have no entry a call reaches`);
  return { init: 0x50000000 + init, triggers: w, irqs };
}
// The serial controller's driver under PER_SIO's channels (fact 'sio', src/lab/sio.mjs S-SIOBUS), the layer that
// PER_SIO's IIC calls start their transfers through (E132: the IIC write 0x5004ba70 and write-read 0x5004bac8 call
// the transfer start 0x500506cb, the write-read the receive start 0x500509be before it, D):
// - tx_start and rx_start, the controller index's transfer and receive starts: the index's mode byte from its record
//   picks the start of that mode, `mov d0,d2; extbu d2; <scale> d2; mov a1,d3; mov d2,a1; add REC,a1; clr d2; movbu
//   d2,(2,a1); movbu (1,a1),d2; mov TX,a1; asl2 d2; mov (d2,a1),a2; extbu d0; exthu d1; extbu d3; mov d3,a1; calls
//   (a2)`, and the receive start the same with `mov 1,d2` and its own table (E132 0x500506cb and 0x500509be, records
//   of 8 bytes, `asl 3,d2`; E143 0x5005dc03 and 0x5005def6, of 20, `udfu01 20,d2`; D);
// - done, the two completion tables [transfer, receive], by the index, that the registration `extbu d1; cmp 1,d1;
//   bne; ... mov T1,a1; mov a0,(d2,a1); cmp 2,d1; bne; ... mov T2,a1; mov a0,(d0,a1); retf` fills (E132 0x50051145,
//   which PER_SIO's IIC configuration 0x5004b96e calls with its own completions; the other registration of that form
//   before it, 0x50051124, fills tables no dispatch reads so, D), and dispatch, the function the controller's
//   interrupt calls a completion through, `mov T1,a0; call D` with d0 the index and d1 the status, 0 or 0xffff (E132
//   0x50051814 from 0x5005176c and 0x5005166c; it reads the table's entry with interrupts locked and calls it with
//   d0 and d1, D);
// - restart, the table of each index's restart list {count, positions} (the control 0x500505e1's mode 2 stores it,
//   `extbu d0; asl2 d0; mov RS,a1; mov a0,(d0,a1); ret`, E132 0x50050644; a transfer's loop restarts before the
//   byte at each position, 0x50050866, and the interrupt clears the entry at the transfer's end, 0x5005171d, D);
// - channels, the word that points to the channel map, a byte per channel's halfword: PER_SIO's channel to its
//   controller index, `extbu d0; mov (M),a0; add d0,d0; movbu (d0,a0),d0; retf` (E132 0x5005238c, M 0xa2b1c84c, D),
//   and map_init, the function that sets the word, the one store `mov d0,(M)`: it picks the running core's map from
//   the board's table (E132 0x50052089, its store at 0x500520bc; the end of PER_SIO's channel init 0x50052016, which
//   the boot calls at 0x50022205; E143 0x5005f0b2 and 0x5005f03f, D).
// Each part exactly once on each of the 15 expanded images but the E118 family's, whose driver has the starts and
// registration but no such dispatch, restart store or map (X, a byte scan of the 18). Returns {tx_start, rx_start,
// done, dispatch, restart, channels, map_init} (code in disassembly notation, the tables and the word run-time
// addresses), or undefined where a part is missing; throws for two of one.
export const SIO_E143 = { tx_start: 0x5005DC03, rx_start: 0x5005DEF6, done: [0xA32C96B0, 0xA32C96DC], dispatch: 0x5005ED65, restart: 0xA32C9760, channels: 0xA32C9E48, map_init: 0x5005F0B2 };
const SIO_W = [null, null, null, null];
const SIO_REG = [0x15, 0xa5, 0x01, 0xc9, 0x0d, 0x82, 0x16, 0x56, 0xfc, 0xdd, ...SIO_W, 0xf3, 0xc9, 0xa5, 0x02, 0xc9, 0x0c, 0x14, 0x54, 0xfc, 0xdd, ...SIO_W, 0xf3, 0xc1, 0xde, 0x80, 0x04];
const SIO_TX = [0xf1, 0xd7, 0xf1, 0xe9, 0xfc, 0xd1, ...SIO_W, 0x08, 0xf8, 0x59, 0x02, 0xf8, 0x49, 0x01, 0xfc, 0xdd, ...SIO_W, 0x56, 0xf3, 0xa9, 0x14, 0x1d, 0x17, 0xf1, 0xed, 0xf0, 0xf2];
const SIO_RX = [0xf1, 0xea, 0xfc, 0xd2, ...SIO_W, 0x8a, 0x01, 0xf8, 0x5a, 0x02, 0xf8, 0x4a, 0x01, 0xfc, 0xde, ...SIO_W, 0x56, 0xf3, 0xaa, 0x14, 0x19, 0xf1, 0xd6, 0x1a, 0xf1, 0xe9, 0xf0, 0xf2];
const SIO_RESTART = [0x14, 0x54, 0xfc, 0xdd, ...SIO_W, 0xf3, 0xc1, 0xdf, 0x00, 0x04];
const SIO_MAP = [0x14, 0xfc, 0xa0, ...SIO_W, 0xe0, 0xf4, 0x00, 0xde, 0x00, 0x00];
const SIO_HEAD = [0x82, 0x16], SIO_SCALE = 3;          // a start's `mov d0,d2; extbu d2` and its 3-byte scale before the pattern
const SIO_MAP_SPAN = 0x80;
export function sioDriver(img) {
  const all = (pat) => { const at = []; for (let p = img.indexOf(pat[0]); p >= 0 && p + pat.length <= img.length; p = img.indexOf(pat[0], p + 1)) if (bytesAt(img, p, pat)) at.push(p); return at; };
  const one = (what, at) => { if (at.length > 1) throw new Error(`sioDriver: ${at.length} ${what} (${at.map((p) => h8(0x50000000 + p)).join(', ')}), want one`); return at[0]; };
  // the registrations whose first table a dispatch is called with: `mov T1,a0` (fc dc T1) then a call
  const dispatches = (t) => new Set(loadsOf(img, t).filter((p) => img[p + 1] === 0xdc).map((p) => callAt(img, p + 6)?.to).filter((to) => to !== undefined));
  const regs = all(SIO_REG).map((p) => ({ p, done: [u32(img, p + 10), u32(img, p + 24)] })).map((r) => ({ ...r, to: dispatches(r.done[0]) })).filter((r) => r.to.size);
  const reg = one('completion registrations with a dispatch', regs.map((r) => r.p));
  const tx = one('transfer starts', all(SIO_TX)), rx = one('receive starts', all(SIO_RX));
  const restart = one('restart-list stores', all(SIO_RESTART)), map = one('channel maps', all(SIO_MAP));
  if ([reg, tx, rx, restart, map].includes(undefined)) return undefined;
  const r = regs.find((x) => x.p === reg);
  if (r.to.size !== 1) throw new Error(`sioDriver: the completion table ${h8(r.done[0])} is dispatched through ${r.to.size} functions, want one`);
  const start = (p, what) => {
    const e = p - SIO_SCALE - SIO_HEAD.length;
    if (!bytesAt(img, e, SIO_HEAD)) throw new Error(`sioDriver: the ${what} at ${h8(0x50000000 + p)} does not open with mov d0,d2; extbu d2`);
    return 0x50000000 + e;
  };
  if (u32(img, tx + 6) !== u32(img, rx + 4)) throw new Error(`sioDriver: the transfer and receive starts index records ${h8(u32(img, tx + 6))} and ${h8(u32(img, rx + 4))}`);
  const channels = u32(img, map + 3), set = all([0xfc, 0x81, ...[0, 8, 16, 24].map((s) => (channels >>> s) & 0xff)]);   // mov d0,(M)
  if (set.length !== 1) throw new Error(`sioDriver: ${set.length} stores of d0 to the channel map's word ${h8(channels)}, want one`);
  const mapInit = entryOf(img, set[0], SIO_MAP_SPAN);
  if (mapInit === undefined) throw new Error(`sioDriver: the store of the channel map's word at ${h8(0x50000000 + set[0])} is in no called function`);
  return { tx_start: start(tx, 'transfer start'), rx_start: start(rx, 'receive start'), done: r.done, dispatch: 0x50000000 + [...r.to][0],
    restart: u32(img, restart + 4), channels, map_init: 0x50000000 + mapInit };
}
// The boot's state that the lab's start leaves unset because the boot steps that set it do not run (fact 'boot',
// src/lab/menu.mjs S-BOOTSTAGE, src/lab/play.mjs S-BOOTKEY):
// - stage, the ready word of the image's stages: the boot readies the run-time image in stages, and code that needs a
//   stage's part waits for or tests its bit, n - 1 for stage n, through the one test `mov (W),d1; add -1,d0; mov 1,d2;
//   asl d0,d2; mov d2,d0; and d1,d0; beq; mov 1,d0; bra; clr d0; retf [d2],4` (E143 0x50024dcf, W 0xa32df1f4, which
//   the per-segment step 0x50024eda sets after CPU 2's overlay loader has read the segment, docs/om1-cores-spec.md
//   3.6; E129 0x50022e30, W 0xa2b4d2cc, which the stage step 0x50022f51(n) sets once the loader 0x50022ec0 has marked
//   the stage's part read in 0xa2b4d2d0, D);
// - key, UI_IN's boot key, the code of the key that started the camera: UI_IN's init (E143 0x5014e3ab, from its start
//   stage) takes it from its key table at the sub-CPU's wake factor, `asl2 d0; mov (d0,a0),d0; mov d0,(W); cmp
//   0x1000003,d0`, or stores 0x1000001 for a factor past the table (E143 0x5014e4bb..d4, W 0xa32dab30; E133
//   0x500f5e8c..ba, W 0xa2ae718c, D), and UI_IN's getter answers it (E143 0x5014c3bf, E133 0x500f45ce: the camera
//   application's wake-up judgement, the display start and the power path read it, D).
// Each test and store exactly once on each of the 15 expanded images but the E118 family's, which hold neither (X, a
// byte scan of the 18). Returns {key, stage}, the two run-time words, or undefined where neither is held; throws for
// two of either, or one without the other.
export const BOOT_E143 = { key: 0xA32DAB30, stage: 0xA32DF1F4 };
const STAGE_TEST = [0xfc, 0xa5, null, null, null, null, 0x28, 0xff, 0x8a, 0x01, 0xf2, 0x92, 0x88, 0xf2, 0x04, 0xc8, 0x06,
  0x80, 0x01, 0xca, 0x03, 0x00, 0xde, 0x80, 0x04];
const BOOT_KEY_STORE = [0x54, 0xf3, 0x00, 0xfc, 0x81, null, null, null, null, 0xfc, 0xc8, 0x03, 0x00, 0x00, 0x01];
export function bootState(img) {
  const stage = oneAt(img, STAGE_TEST, 'bootState', 'stage-bit tests'), key = oneAt(img, BOOT_KEY_STORE, 'bootState', 'boot key stores');
  if (stage === null && key === null) return undefined;
  if (stage === null || key === null) throw new Error(`bootState: ${stage === null ? 'no stage-bit test' : 'no boot key store'}, but the other`);
  return { key: u32(img, key + 5), stage: u32(img, stage + 2) };
}

// The register immediates a straight run of code leaves at offset `to` (from `from`): {d0..d3, a0..a3}, a value or
// null. Tracked: mov imm32 / imm16 / imm8 to Dn or An, clr Dn, mov Rm,Rn within Dn or An, and the compares and
// branches, which change no register; any other instruction forgets every register, so a value is only one the run
// loads and keeps in plain sight (the storage rule's NAND access calls).
function immediatesAt(img, from, to) {
  const s16 = (o) => (img[o] | img[o + 1] << 8) << 16 >> 16;
  const R = { d0: null, d1: null, d2: null, d3: null, a0: null, a1: null, a2: null, a3: null };
  const D = ['d0', 'd1', 'd2', 'd3'], An = ['a0', 'a1', 'a2', 'a3'];
  for (let p = from; p < to;) {
    const op = img[p], o2 = img[p + 1], len = callAt(img, p)?.len ?? insnLength(op, o2);
    if (op === 0xfc && (o2 & 0xfc) === 0xcc) R[D[o2 & 3]] = u32(img, p + 2);                                  // mov imm32,Dn
    else if (op === 0xfc && (o2 & 0xfc) === 0xdc) R[An[o2 & 3]] = u32(img, p + 2);                             // mov imm32,An
    else if (op >= 0x2c && op <= 0x2f) R[D[op & 3]] = s16(p + 1) >>> 0;                                       // mov imm16,Dn
    else if (op >= 0x24 && op <= 0x27) R[An[op & 3]] = img[p + 1] | img[p + 2] << 8;                           // mov imm16,An
    else if (op >= 0x80 && op <= 0x9f && (op >> 2 & 3) === (op & 3)) R[(op < 0x90 ? D : An)[op & 3]] = (o2 << 24 >> 24) >>> 0;   // mov imm8
    else if (op >= 0x80 && op <= 0x9f) { const r = op < 0x90 ? D : An; R[r[op & 3]] = R[r[op >> 2 & 3]]; }   // mov Rm,Rn
    else if (op <= 0x0c && (op & 3) === 0) R[D[op >> 2]] = 0;                                                  // clr Dn
    else if (!((op >= 0xa0 && op <= 0xbf) || (op >= 0xc0 && op <= 0xca))) for (const k of Object.keys(R)) R[k] = null;   // cmp, branches: none
    p += len;
  }
  return R;
}
// The offset of the one hit of pat in img[from, to) (null bytes match any), or null for none; throws for two or more.
function oneAt(img, pat, rule, what, from = 0, to = img.length) {
  const at = [];
  for (let o = img.indexOf(pat[0], from); o >= 0 && o + pat.length <= to; o = img.indexOf(pat[0], o + 1)) if (bytesAt(img, o, pat)) at.push(o);
  if (at.length > 1) throw new Error(`${rule}: ${at.length} ${what} (${at.map((o) => h8(0x50000000 + o)).join(', ')}), want one`);
  return at.length ? at[0] : null;
}
const le32 = (v) => [v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24];

// The card's file system (fact 'storage', src/lab/storage.mjs; docs/hle-gaps.md 4.8.2): the seams the lab runs it at,
// in a library the bodies share instruction for instruction but for addresses, registers' allocation and a few
// immediate forms (X: every pattern below on each expanded image). D unless tagged, from E143's code:
// - FILECLBK, the file module's task, opens its loop with `clr d0; mov d0,(busy); movhu (Q),d0; mov a2,a0; exth d0;
//   mov 16,d1` (E143 0x5088fd0b; the receive of its queue, whose id is the halfword Q of the static queue-id table),
//   one per image; its entry is the `movm [a2],(sp); add -20,sp` (cf 20 f8 fe ec) within FCB_HEAD bytes before it
//   (E143 0x5088fcfc; on nine images a `mov 1,d0; movbu d0,(abs32)` follows it, not on E134, E125, E133, E130, E129,
//   E132 and the E118 family, X), and the file system's bring-up ends right before that entry with `clr d0; mov
//   d0,(busy); ret [],4` (E143 0x5088fcf2). The bring-up (init) opens with the queue's creation, `movhu (Q),d0; mov
//   imm32,a0; exth d0; mov 16,d1; mov 10,a1` (E143 0x5088fc8d, the boot task's call), within FS_INIT bytes before its
//   end. fileclbk {entry, queue (the id: 0x1f on the E143 family, E145, E129 and E132, 0x22 on the others, X), busy
//   (the word that holds the message FILECLBK handles)}
// - tasks: the tasks the bring-up's callees start, each callee ending `movhu (W),d0; exth d0; call OlyTaSt; clr d0;
//   ret` (E143 0x50894d42 FILEFGND's id word 0x60042d42, 0x5087cd68 DCFPROC_SUB's 0x60042d2a; a third, 0x44..0x47, on
//   E125, E133, E130, E129, E132 and the E118 family, X), all through one OlyTaSt: their id words (run-time addresses;
//   the static queue and task ids are data of the image)
// - nand: the file layer's NAND area read (E143 0x5088d075) opens `movbu (flag),d1; mov d0,d2; cmp 0,d1; bne` and
//   calls the NAND access with a1 the area, d0 its size and d1 the read operation, then sets the flag (`exthu d0; cmp
//   0,d0; bne; mov 1,d0; movbu d0,(flag)`); its writer is the next function, which adds the area to its offset (`add
//   imm32,d2`) and calls the same access with its write operation in d1. access, area [address, size], read, write:
//   E143 0x500022c2, [0x41a00000, 0x80000], 0x10200, 0x10100; the E144 family's flash access 0x5003b76c (E144),
//   [0x406a0000, 0x60000], 0x102, 0 (D; the others X: 384 or 256 KiB, read 0x102 or 0x103, write 0). The immediates
//   by a straight-line walk (immediatesAt): E143's `mov imm32` forms, E144's `mov imm16,d1` and `clr d1`
//   (0x50682537 `mov 258,d1`, 0x50682572 `clr d1`)
// - command: the SD command layer, `mov a0,a3; cmp 0,a3; bne; ret`, then the port's busy test, whose completion is
//   `mov (8,a3),a1; mov 0x1403,d0; movhu d0,(74,a3); mov a3,a0; calls (a1)` (E143 0x508ad03c, SD_COMMAND)
// - album_init: the album manager's per-drive init (E143 0x508b67e8), `mov d0,d3; mov d3,d2; extbu d2; mov d2,d0;
//   call; exthu d0; cmp 0,d0; beq; movhu (abs32),d0; cmp 1,d0; bge +5; ret`, which starts ALBM_MAIN once
//   (`movbu (F),d1; cmp 0,d1; bne; call; mov 1,d0; movbu d0,(F)`, E143 0x508b681e); null where none is found: on E145,
//   E129 and E132 (whose DCF numbering mount was not read: whether they have an album manager is ?), X
// - status: the file layer's drive status (E143 0x508a8327), `exthu d0; mov d0,a2; cmp 7,a2; beq; cmp 2,a2; beq; cmp
//   0,a2; beq; cmp 1,a2; beq`, the function that holds cardDetect's card-present test within STATUS_SPAN bytes; its
//   entry is after the return before it, whole instructions within STATUS_HEAD bytes (E125's `clr d2` first,
//   0x5061cb03, X)
// - card_power: the SD driver's request for the card's supply (E143 0x508b0301, E144 0x506a3fb5) builds an 8-byte
//   request `mov 8,d0; call (alloc); mov a0,a2; mov imm8,d0; movbu d0,(1,a2); exthu d2; cmp 0,d2; beq; mov 255,d0;
//   bra; clr d0; movbu d0,(2,a2)`, after a return; its calls are the alloc, on some a check, the send and the free
//   (`mov a2,a0` before it): {send: the send's callee, ret: its return address} (E143 0x50059656 / 0x508b033c, E144
//   0x5004fea9 / 0x506a3ff0, the send a synchronous one to a queue, 0x60041854; null on E145, E133, E129 and E132, X)
// - cflush: the return address of the file system's one call of the cache flush (K-CFLUSH, src/lab/menu.mjs), in
//   the FAT's free count: `mov 1,d0; call (lock); mov d0,d2; call (flush); mov d2,d0; call (unlock); mov (12,sp),a0;
//   mov -1,d0; mov d0,(8164,a0)` (E143 0x508881e9, return 0x508881fa; the flush is the place the port gives E143's
//   0x5004e68a on all 15 images that hold it, X)
// - names: the DCF module's initial folder and file names (E143 0x508749a2 / 0x508749ca: `mov 8,a0; add a3,a0; mov
//   imm32,a1; call` before `mov 100,d0; movhu d0,(22,a3)`, and `mov 12,a0; add a2,a0; mov imm32,a1; call` before
//   `mov 1,d0; mov d0,(40,a2)`): '100OMSYS' (the E143 family, E144 and E145) or '100OLYMP', and 'P1010001JPG' on all
//   18 (X), as {folder: the folder's name past its number, file: the file name's first four letters, ext}
// Found on 15 of the 18 expanded images; the E118 family's SD command layer has another form, so it has none (X).
// Returns undefined where FILECLBK's loop is not found or a seam is missing; throws for a seam found twice or a
// bring-up, a task start or a NAND call of another shape.
export const STORAGE_E143 = {
  init: 0x5088FC8D, tasks: [0x60042D42, 0x60042D2A], fileclbk: { entry: 0x5088FCFC, queue: 0x1F, busy: 0x62AE4CD0 },
  nand: { access: 0x500022C2, area: [0x41A00000, 0x80000], read: 0x10200, write: 0x10100 },
  command: 0x508AD03C, album_init: 0x508B67E8, status: 0x508A8327, cflush: 0x508881FA,
  card_power: { send: 0x50059656, ret: 0x508B033C },
  names: { folder: 'OMSYS', file: 'P101', ext: 'JPG' },
};
// The storage library's own numbers, which the seams above share on every body that has them (src/lab/storage.mjs;
// D on E143, from its code; the same on the others is X: their sessions mount, format, count and write with them).
// FILECLBK's message is {reply queue (0: none), word, code, parameter} (16 bytes, as the API's senders post it,
// 0x503f08fb), the code's class by code & 0xffff0000, then by code & 0xf0 through the table 0x60a10578 (0x5088fd8a).
// codes: 0x51 the FAT mount (dosfat op 0, 0x5088167d -> 0x50882ebd: sdmem command 2, the MBR and the boot sector),
// 0x55 the format (op 5, 0x508816ad -> 0x508848ba), the dosfat block's +4 op, +6 drive, +48 the error (0x5088fde0,
// 0x508812f2); unformatted, the mount's error on a card with no file system; 0xf0 a DCF process command {u16 command,
// u16 drive} (0x5089009d -> 0x5087bce9: 1 the card in, detect 1 -> 2; 3 the card's lists, 2 -> 3); card_out, its
// command 2 (0x5087bd75: for a drive in detect state 2, 3 or 4 it sets 1 and, from 2, unmounts, 0x5087c987,
// 0x508748f5, 0x5087c9dd; X: the drive status loses 0x80, 0x13780 -> 0x13700, the card-in after it mounts again);
// 0x31 the DCF numbering mount (dcfnum op 0, 0x5088ff40 -> 0x50877ea8 -> 0x5087825a; its block's +2 drive, +42 the
// next folder, +44 the next file), which sets the DCF state word's bit 16, the drive status's mount bit 0x1000
// (0x508a83e7; X). card_info: of the sdmem class (codes 0x10..0x1e, 0x50890114, the table 0x60a105f8; the block a
// 128-byte sdmem request sent through logsec's synchronous call 0x508ac1dd), 0x12 is sdmem command 1, which clears
// the port's card info (0x508b2b51); without it a mount after a removal reads the removed card's state and fails (X:
// CMD17, CMD13 four times and CMD0 unanswered by the card that came back, the FAT mount 0x1405); which component sends
// it on a body is not read (I). fileif, the file requests S-RECFILE makes (FILECLBK's codes 0x10000 + n through
// fileif's table 0x60a125dc, 0x50894eb3; the block +0 the result, +4.. the arguments): 1 fopen(path, mode) -> FILE
// (0x508a5da9; the mode letters through 0x60a16b20: r w a + b c d e h), 3 fwrite(buffer, size, count, FILE) -> count
// (0x508a6b87), 2 fclose(FILE) (0x508a63ce), as the FlashAir configuration writer calls them ('wb' / 'ab',
// 0x5101efe0); 12 mkdir(path) (0x508a7c61; X: it made C:\DCIM). drive: the letter of drive 0 (0x508a8149, X). The SD
// command the command layer takes: +8 the completion (by `calls`, a0 the command, d0 the status), +24 the command
// code, +28 the argument, +32..+44 the response, +48 the buffer, +52 the block count, +56 the block size, +74 the
// status (0x508b1a41, 0x508b1a7d, 0x508b23d1 build it; 0x508b3fcf completes)
export const STORAGE_LIB = {
  codes: { mount: 0x51, format: 0x55, dcf: 0xF0, number: 0x31 }, unformatted: 0xE08, card_out: 2, card_info: 0x12,
  fileif: { open: 0x10001, close: 0x10002, write: 0x10003, mkdir: 0x1000C }, drive: 'C',
};
const FCB_HEAD = 0x14, FS_INIT = 0x100, ALBM_SPAN = 0x60, STATUS_HEAD = 8, FS_WALK = 64, STATUS_SPAN = 0x100, NAND_SPAN = 0x40;
const FCB_LOOP = [0x00, 0xfc, 0x81, null, null, null, null, 0xfc, 0xac, null, null, null, null, 0x98, 0x18, 0x85, 0x10];
const FCB_ENTRY = [0xcf, 0x20, 0xf8, 0xfe, 0xec];
const SD_COMMAND = [0x93, 0xbf, 0x00, 0xc9, 0x05, 0xdf, null, null, 0x8a, 0x0c, 0xf1, 0x5e, 0xf1, 0xe8, 0xf0, 0x60, 0xfc, 0xcf,
  null, null, null, null, 0x54, 0xf1, 0xec, 0xf3, 0x00, 0xa0, 0x00, 0xc8, null, 0xf8, 0x27, 0x08, 0x2c, 0x03, 0x14, 0xf8, 0x73,
  0x4a, 0x9c, 0xf0, 0xf1];
const ALBM_INIT = [0x83, 0x8e, 0x16, 0x88, 0xdd, null, null, null, null, null, null, 0x1c, 0xa0, 0x00, 0xc8, null, 0xfc, 0xac,
  null, null, null, null, 0xa0, 0x01, 0xc2, 0x05, 0xdf];
const ALBM_ONCE = [0xfc, 0xa9, null, null, null, null, 0xa5, 0x00, 0xc9];
const DRIVE_STATUS = [0x1c, 0xf1, 0xe2, 0xba, 0x07, 0xc8, null, 0xba, 0x02, 0xc8, null, 0xba, 0x00, 0xc8, null, 0xba, 0x01, 0xc8];
const FS_FLUSH = [0x80, 0x01, 0xdd, null, null, null, null, null, null, 0x82, 0xdd, null, null, null, null, null, null, 0x88, 0xdd,
  null, null, null, null, null, null, 0x5c, 0x0c, 0x80, 0xff, 0xfa, 0x10, 0xe4, 0x1f];
const DCF_FOLDER = [0x90, 0x08, 0xf1, 0x7c, 0xfc, 0xdd, null, null, null, null, 0xdd, null, null, null, null, null, null, 0x80, 0x64, 0xf8, 0x73, 0x16];
const DCF_FILE = [0x90, 0x0c, 0xf1, 0x78, 0xfc, 0xdd, null, null, null, null, 0xdd, null, null, null, null, null, null, 0x80, 0x01, 0xf8, 0x12, 0x28];
const NAND_OPEN = [0x82, 0xa5, 0x00, 0xc9];
const FLUSH_RETURN = 17;                // FS_FLUSH's second call, the flush (at +10, 7 bytes), returns here
const SD_POWER = [0xdf, null, null, 0x82, 0x80, 0x08, 0xdd, null, null, null, null, null, null, 0x92, 0x80, null, 0xf8, 0x52, 0x01, 0x1e, 0xaa, 0x00, 0xc8,
  null, 0x2c, 0xff, 0x00, 0xca, null, 0x00, 0xf8, 0x52, 0x02];
export function fileSystem(img) {
  const rule = 'fileSystem', { base } = imageBase(img), D = (o) => h8(0x50000000 + o);
  const loop = oneAt(img, FCB_LOOP, rule, "FILECLBK loop tops");
  if (loop === null) return undefined;
  const busy = u32(img, loop + 3), qw = u32(img, loop + 9);
  let entry = -1;
  for (let o = loop - FCB_ENTRY.length; o >= loop - FCB_HEAD && entry < 0; o--) if (bytesAt(img, o, FCB_ENTRY)) entry = o;
  if (entry < 0 || !bytesAt(img, entry - 10, [0x00, 0xfc, 0x81, ...le32(busy), 0xdf, 0x00, 0x04])) throw new Error(`${rule}: FILECLBK's loop at ${D(loop)} has no entry after the bring-up's end`);
  const init = oneAt(img, [0xfc, 0xac, ...le32(qw), 0xfc, 0xdc, null, null, null, null, 0x18, 0x85, 0x10, 0x95, 0x0a], rule, 'bring-up openings', entry - FS_INIT, entry);
  if (init === null) throw new Error(`${rule}: no bring-up creating FILECLBK's queue (${h8(qw)}) before ${D(entry)}`);
  const fileclbk = { entry: 0x50000000 + entry, queue: img[qw - base] | img[qw - base + 1] << 8, busy };
  // the bring-up's callees that start a task
  const tasks = [], taSt = new Set();
  for (let p = init; p < entry;) {
    const c = callAt(img, p);
    if (c) {
      for (let q = c.to, n = 0; n < FS_WALK && !isRet(img, q); n++) {
        const t = img[q] === 0xfc && img[q + 1] === 0xac && img[q + 6] === 0x18 ? callAt(img, q + 7) : null;
        if (t && img[q + 7 + t.len] === 0x00 && isRet(img, q + 8 + t.len)) { tasks.push(u32(img, q + 2)); taSt.add(t.to); break; }
        q += callAt(img, q)?.len ?? insnLength(img[q], img[q + 1]);
      }
    }
    p += c?.len ?? insnLength(img[p], img[p + 1]);
  }
  if (tasks.length < 2 || taSt.size !== 1) throw new Error(`${rule}: the bring-up ${D(init)} starts ${tasks.length} tasks through ${taSt.size} functions, want two or more through one`);
  // the NAND area's read and its writer
  const reads = [];
  for (let o = img.indexOf(0xa9); o >= 0; o = img.indexOf(0xa9, o + 1)) {
    const at = o - 1;
    if (img[at] !== 0xfc || !bytesAt(img, at + 6, NAND_OPEN)) continue;
    const flag = u32(img, at + 2), set = [0x1c, 0xa0, 0x00, 0xc9, null, 0x80, 0x01, 0xfc, 0x82, ...le32(flag)];
    for (let p = at + 6 + NAND_OPEN.length + 1, n = 0; n < 12; n++) {
      const c = callAt(img, p);
      if (c && bytesAt(img, p + c.len, set)) { reads.push({ at, call: p, to: c.to }); break; }
      p += c?.len ?? insnLength(img[p], img[p + 1]);
    }
  }
  if (reads.length > 1) throw new Error(`${rule}: ${reads.length} NAND area reads (${reads.map((r) => D(r.at)).join(', ')}), want one`);
  const rd = reads[0];
  let nand;
  if (rd) {
    const R = immediatesAt(img, rd.at + 6 + NAND_OPEN.length + 1, rd.call), area = R.a1;
    if (area === null || R.d0 === null || R.d1 === null) throw new Error(`${rule}: the NAND area read ${D(rd.at)} calls ${D(rd.to)} with a1 ${R.a1}, d0 ${R.d0}, d1 ${R.d1}, not all immediates`);
    const add = [0xfc, 0xc2, ...le32(area)];
    let write = null, p = rd.call + callAt(img, rd.call).len;
    for (let c = callAt(img, p); p < rd.call + 2 * NAND_SPAN && c?.to !== rd.to; c = callAt(img, p)) p += c?.len ?? insnLength(img[p], img[p + 1]);
    const at = oneAt(img, add, rule, 'adds of the NAND area', rd.call, p);
    if (callAt(img, p)?.to === rd.to && at !== null) write = immediatesAt(img, at, p).d1;
    if (write === null) throw new Error(`${rule}: no writer of the NAND area ${h8(area)} after its read ${D(rd.at)}`);
    nand = { access: 0x50000000 + rd.to, area: [area, R.d0], read: R.d1, write };
  }
  const command = oneAt(img, SD_COMMAND, rule, 'SD command layers');
  const albm = oneAt(img, ALBM_INIT, rule, 'album manager inits');
  if (albm !== null && oneAt(img, ALBM_ONCE, rule, 'album manager start flags', albm, albm + ALBM_SPAN) === null) throw new Error(`${rule}: the album manager init ${D(albm)} has no start-once flag`);
  const status = [];
  const test = (() => { for (let o = img.indexOf(0xf8); o >= 0; o = img.indexOf(0xf8, o + 1)) if (o >= 5 && bytesAt(img, o - 5, DETECT_TEST)) return o - 5; return -1; })();
  for (let o = img.indexOf(0x1c); o >= 0; o = img.indexOf(0x1c, o + 1)) if (bytesAt(img, o, DRIVE_STATUS) && test > o && test - o <= STATUS_SPAN) status.push(o);
  // its entry: after the return before it, a few whole instructions before the test of the drive (E125's `clr d2`, X)
  if (status.length === 1) {
    const whole = (from, to) => { let p = from; while (p < to) p += insnLength(img[p], img[p + 1]); return p === to; };
    const at = status[0], k = [...Array(STATUS_HEAD).keys()].find((n) => isRet(img, at - n - 3) && whole(at - n, at));
    if (k === undefined) throw new Error(`${rule}: the drive status at ${D(at)} follows no return within ${STATUS_HEAD} bytes`);
    status[0] = at - k;
  }
  if (status.length > 1) throw new Error(`${rule}: ${status.length} drive status functions, want one`);
  const flush = oneAt(img, FS_FLUSH, rule, 'cache flushes in the free count');
  const power = oneAt(img, SD_POWER, rule, "SD card power requests");
  let card_power = null;
  if (power !== null) {                          // its calls: the request's alloc, a check (some bodies), the send, the free
    const calls = [];
    for (let p = power + 3, n = 0; n < FS_WALK && !isRet(img, p); n++) {
      const c = callAt(img, p);
      if (c) calls.push({ at: p, ...c });
      p += c?.len ?? insnLength(img[p], img[p + 1]);
    }
    const send = calls[calls.length - 2];
    if (calls.length < 3 || img[calls[calls.length - 1].at - 1] !== 0x98) throw new Error(`${rule}: the SD card power request ${D(power + 3)} makes ${calls.length} calls, the last not the request's free`);
    card_power = { send: 0x50000000 + send.to, ret: 0x50000000 + send.at + send.len };
  }
  const folder = oneAt(img, DCF_FOLDER, rule, "DCF folder names"), file = oneAt(img, DCF_FILE, rule, 'DCF file names');
  const str = (o) => { let e = o; while (img[e]) e++; return String.fromCharCode(...img.subarray(o, e)); };
  if ([nand, command, status[0], flush, folder, file].some((v) => v === undefined || v === null)) return undefined;
  const fname = str(u32(img, folder + 6) - base), name = str(u32(img, file + 6) - base);
  if (!/^\d{3}[A-Z_]{5} *$/.test(fname) || !/^[A-Z_][0-9A-Z]{3}\d{4}[A-Z]{3}$/.test(name)) throw new Error(`${rule}: the DCF names ${JSON.stringify([fname, name])} are not a folder's and a file's`);
  return {
    init: 0x50000000 + init, tasks, fileclbk, nand, command: 0x50000000 + command, album_init: albm === null ? null : 0x50000000 + albm,
    status: 0x50000000 + status[0], cflush: 0x50000000 + flush + FLUSH_RETURN, card_power,
    names: { folder: fname.slice(3).trimEnd(), file: name.slice(0, 4), ext: name.slice(8) },
  };
}

// The event broker's init (fact 'broker.init', and through bin/port.mjs the place of E143's BROKER_E143 0x502a48b6,
// src/lab/camapp.mjs BROKER_INIT, which the lab calls as the boot chain's wrapper does): it opens with its queue's id
// word, `movhu (W),d0; exth d0; call` (fc ac W 18, then call d16 or d32), and clears its slots in a loop that starts
// `clr d0; clr d1; setlb` right after the call and ends `cmp 100,d1; llt` (a5 64 d0) within BROKER_LOOP bytes (E143
// 0x502a48b6: W 0x600431d0, 20-byte slots, its wrapper 0x502a48a0; E139 0x501ee6f6, W 0x600415d4, 16 bytes, its hand
// override's place; E137 0x501dbcdb, W 0x60040f24, 12 bytes, its wrapper 0x501dbcc5 calling it, then 0x502b8a82 on 0
// as E143's calls 0x503e049a, D). Exactly one such opening on each of the 18 expanded images, the place the maps gave
// on E146, E147, E144, E134 and E145 (X, a byte scan; the maps place none on the other bodies but E139). Returns the
// entry (disassembly notation); throws for none or two.
export const BROKER_E143 = 0x502A48B6;
const BROKER_OPEN = [0xfc, 0xac, null, null, null, null, 0x18], BROKER_START = [0x00, 0x04, 0xdb], BROKER_END = [0xa5, 0x64, 0xd0];
const BROKER_LOOP = 0x40;
export function brokerInit(img) {
  const found = [];
  for (let o = img.indexOf(0xfc); o >= 0 && o + 0x60 < img.length; o = img.indexOf(0xfc, o + 1)) {
    if (!bytesAt(img, o, BROKER_OPEN)) continue;
    const c = callAt(img, o + BROKER_OPEN.length), p = c ? o + BROKER_OPEN.length + c.len : -1;
    if (!c || !bytesAt(img, p, BROKER_START)) continue;
    for (let k = p; k < p + BROKER_LOOP; k++) if (bytesAt(img, k, BROKER_END)) { found.push(0x50000000 + o); break; }
  }
  if (found.length !== 1) throw new Error(`brokerInit: ${found.length} event broker inits (${found.map(h8).join(', ')}), want one`);
  return found[0];
}

// The shooting state's function direct start, past its checks (fact 'func_direct', and through bin/port.mjs the place
// of E143's FUNC_DIRECT_E143 0x51068e37, src/lab/camapp.mjs S-RELSEQ, whose observer reads the function's id there):
// the function opens after a return with register moves, among them the one that keeps its id d0, and then copies
// its argument's six words onto its frame, `mov sp,a0; inc4 a0; mov -6,d1; setlb; mov (aN),d0; inc4 aN; mov d0,(a0);
// inc4 a0; inc d1; lne` (E143 0x51068e05; aN a1, or a2 on E147 0x510815dc, D). It keeps the id at `mov d0,(d8,sp)`
// (42 d8: id {sp: d8}) or in a register, `mov d0,dN` (id {reg: 'dN'}), once among the moves. Its checks
// each return on failure, `bne +5; ret` (c9 05 df/de ..); the start is the last check's branch target before the
// first return past the checks that is not a check's: E143 0x51068e37 (the id at (28,sp), entry 0x51068e01, trace
// "startFuncDirectSubAppStateShootingFuncDirect %d %d %d" loaded at 0x51068e46), E139 0x50ca35f0 (the id at (28,sp),
// its hand override's place), E144 0x50cf85ca (the id in d3, entry 0x50cf85a5; its map's place), E137 0x50c4413f (the
// id in d3, entry 0x50c440ef; its "..FuncDirect 1 " loaded at 0x50c4410c before the checks, "..FuncDirect 2 " at
// 0x50c44150 after the start), E142 0x50cc0285 (the id in d2, entry 0x50cc024a; no such trace, and its range checks
// after the start, `cmp 1,d2; bge +5; ret` and `cmp 90,d2`, index a jump table by d2 - 1), each then calling the
// start's function (E143 0x5104cd3c; E144 0x50cdeca7, E139 0x50c8b4ff, E137 0x50c31d39, E142 0x50ca93ee), D. One
// function has this shape on each of the 18 expanded images but E118's, which has none; on the eight that hold the
// trace (E143, E146, E147, E144, E139, E134, E137, E125) the start is the one the trace's load after it chose before
// (X, a byte scan of each image). That the id stays where the entry kept it until the start is read on E143, E139,
// E144, E137 and E142 (D: no write of it in between), not checked by the rule. Returns {run, id} (disassembly
// notation), or undefined where no function has this shape; throws for two.
const FD_COPY = [0x3c, 0x50, 0x85, 0xfa, 0xdb], FD_COPY_TAIL = [0x60, 0x50, 0x44, 0xd9], FD_MOVES = 4, FD_WALK = 64;
export const FUNC_DIRECT_E143 = 0x51068E37;
const isCopy = (img, p) => bytesAt(img, p, FD_COPY) && (img[p + 5] & 0xfc) === 0x70 && img[p + 6] === (0x50 | (img[p + 5] & 3))
  && bytesAt(img, p + 7, FD_COPY_TAIL);
export function funcDirect(img) {
  const found = [];
  for (let e = 3; e + 32 <= img.length; e++) {
    if (!isRet(img, e - 3)) continue;
    // the moves before the copy: Am -> An (9x), Dm -> Dn (8x, m != n), An <-> Dn (f1 dx / f1 ex); the id's keep
    let p = e, id = null, keeps = 0;
    for (let k = 0; k < FD_MOVES && !isCopy(img, p); k++) {
      const x = img[p];
      if (x === 0x42) { id = { sp: img[p + 1] }; keeps++; p += 2; } else if ((x & 0xf0) === 0x80 && (x >> 2 & 3) !== (x & 3)) {
        if ((x & 0xfc) === 0x80) { id = { reg: `d${x & 3}` }; keeps++; }
        p++;
      } else if ((x & 0xf0) === 0x90 && (x >> 2 & 3) !== (x & 3)) p++;
      else if (x === 0xf1 && img[p + 1] >= 0xd0 && img[p + 1] <= 0xef) p += 2;
      else break;
    }
    if (keeps !== 1 || !isCopy(img, p)) continue;
    let run = null;
    for (let k = 0; k < FD_WALK; k++) {
      if (img[p] === 0xc9 && img[p + 1] === 0x05 && isRet(img, p + 2)) { run = p + 5; p = run; continue; }
      if (isRet(img, p)) { if (run !== null) found.push({ run: 0x50000000 + run, id }); break; }
      const c = callAt(img, p);
      p += c ? c.len : insnLength(img[p], img[p + 1]);
    }
  }
  if (found.length > 1) throw new Error(`funcDirect: function direct starts at ${found.map((f) => h8(f.run)).join(', ')}, want one`);
  return found[0];
}

// The PC state's USB-disconnect power-off (fact 'power_off.usb_disconnect'; S-NOPOWEROFF stepped over it through
// MODEL_INFO.call_skips until the idle image's switch states kept the starts out of the PC state, src/fw/models.mjs,
// and no stand-in reads it now): the call that posts the power-off in the function traced "UsbDisconnectSubAppStatePc",
// the first call after its "startPowerOff" trace that `mov imm8,d0; mov a2,a0` (80 nn 98) directly precedes (E143
// 0x510617bd, its trace loaded at 0x5106174a, `mov 8,d0; mov a2,a0; call 0x5105cdf8`; E144 0x50cf0e21 and E139
// 0x50c9bdcc, their S-NOPOWEROFF sites by hand before the rule; E137 0x50c3ef76, its trace at 0x50c3ef0f, `mov 7,d0;
// call 0x50c3b781`; D). One on each of the 18 expanded images but E118's, which holds no "startPowerOff" (X, a byte
// scan); the event is 8 on E143, E146, E147, E144, E139, E140 and E142, 7 on the others (X). Returns the call's address
// (disassembly notation), or undefined where the traces are not held; throws for a trace held or loaded twice, or a
// walk that meets the return first.
const USB_OFF_TRACE = 'UsbDisconnectSubAppStatePc', POWER_OFF_TRACE = 'startPowerOff', POWER_OFF_WALK = 80;
export function usbPowerOff(img) {
  const { base } = imageBase(img), held = (s) => findString(img, s, { nul: true, after: true }).map((o) => base + o);
  const usb = held(USB_OFF_TRACE), off = held(POWER_OFF_TRACE);
  if (!usb.length || !off.length) return undefined;
  const loads = loadsOf(img, usb[0]);
  if (usb.length > 1 || off.length > 1 || loads.length !== 1) throw new Error(`usbPowerOff: "${USB_OFF_TRACE}" ${usb.length} times, loaded ${loads.length} times, "${POWER_OFF_TRACE}" ${off.length} times, want one each`);
  let p = loads[0], traced = false;
  for (let k = 0; k < POWER_OFF_WALK && !isRet(img, p); k++) {
    if (loadAt(img, p) === off[0]) traced = true;
    const c = callAt(img, p);
    if (traced && c && img[p - 3] === 0x80 && img[p - 1] === 0x98) return 0x50000000 + p;
    p += c ? c.len : insnLength(img[p], img[p + 1]);
  }
  throw new Error(`usbPowerOff: no power-off post after the trace at ${h8(0x50000000 + loads[0])}`);
}

// The GUI canvas, its OSD layer banks and the kind-3 record (fact 'gui', src/lab/osd.mjs STRIDE, HEIGHT,
// EXPECTED_RECORDS, KIND3_AREA): {stride, height, banks, kind3}, read from two places:
// - the layer record creator: its kind-3 branch fills the one static record, `movbu (4,sp),d0; mov d0,(K+4); mov
//   base,d0; mov d0,(K); mov stride,d0; movhu d0,(K+8); mov height,d0; movhu d0,(K+10)` (kind3: [base, height]), and
//   its other branch gives each record it takes from a bank its stride and height, `mov stride,d0; movhu d0,(8,a2);
//   mov height,d0; movhu d0,(10,a2)`, within GUI_RECORD_SPAN bytes after (E143 0x5101146b and 0x510114fa, {0xb6ecc800,
//   1664, 2400} and 1664 x 1200; E144 0x50ca4d4a and 0x50ca4dd8, {0xaf3c3000, 1152, 1536} and 1152 x 768; E139
//   0x50c5253f, {0xaf270000, 1152, 1536} and 1152 x 768; D);
// - the OSD bank setup: one block per bank 0x0b, 0x0c, 0x0d, `mov count,d0; mov d0,(4,sp); clr d0; mov d0,(8..20,sp);
//   mov imm32,a0; mov base,d0; mov size,d1; mov 0x0b00 (0x0c00, 0x0d00),a1; call` (banks: [base, size, count] in that
//   order; E143 0x50533df2.., two of 0x1e7800 each; E144 0x503ebfd0.. and E139 0x503e9115.., four of 0xd8000; D).
// Kind k's records are bank 0x0b + k's elements in order, base + element * size (X: E143's records, and E134's
// registry after its GUI's creation: 12 records, kind k's at 4k..4k+3, from 0xafca0000/0xaf940000/0xaf5e0000 by
// 0xd8000), each bank's element one stride x height canvas. One creator and one block per bank on each of the 18
// expanded images, the kind-3 stride the records' and each bank's size stride x height (X, a byte scan): 1664 x 1200,
// two per bank, on E143, E146 and E147 (E147's are E143's, which the lab ran it on before the rule); 1152 x 768, four,
// on E144, E139 and E134; 896 x 600, four on E137 and E125, two on the other ten (the E118 family's kind-3 area is
// 600 rows, every other 896-wide body's 1200). The GUI's 168-byte screen descriptor (E143 0x510bbd38: 1600 x 1200) is
// not the canvas: it gives E147 1024 x 768 and E137 800 x 1200 (X). Throws where the creator is not found once, a bank
// block is missing or doubled, or the sizes disagree.
const GUI_KIND3 = [0xf8, 0xb8, 0x04, 0xfc, 0x81, null, null, null, null, 0xfc, 0xcc, null, null, null, null, 0xfc, 0x81, null, null, null, null,
  0x2c, null, null, 0xfc, 0x83, null, null, null, null, 0x2c, null, null, 0xfc, 0x83];
const GUI_RECORD = [0x2c, null, null, 0xf8, 0x72, 0x08, 0x2c, null, null, 0xf8, 0x72, 0x0a], GUI_RECORD_SPAN = 0x100;
const GUI_BANK = [0x80, null, 0x42, 0x04, 0x00, 0x42, 0x08, 0x42, 0x0c, 0x42, 0x10, 0x42, 0x14, 0xfc, 0xdc, null, null, null, null,
  0xfc, 0xcc, null, null, null, null, 0xfc, 0xcd, null, null, null, null, 0x25, 0x00], GUI_BANK_IDS = [0x0b, 0x0c, 0x0d];
export function guiCanvas(img) {
  const u16 = (o) => img[o] | img[o + 1] << 8, creators = [], banks = GUI_BANK_IDS.map(() => []);
  for (let o = img.indexOf(0xf8); o >= 0 && o + GUI_KIND3.length <= img.length; o = img.indexOf(0xf8, o + 1)) {
    if (!bytesAt(img, o, GUI_KIND3)) continue;
    const k = u32(img, o + 17);
    if (u32(img, o + 5) === k + 4 && u32(img, o + 26) === k + 8 && u32(img, o + 35) === k + 10) creators.push(o);
  }
  if (creators.length !== 1) throw new Error(`guiCanvas: ${creators.length} kind-3 record branches${creators.length ? ': ' + creators.map((o) => h8(0x50000000 + o)).join(', ') : ''}, want 1`);
  const [c] = creators, kind3 = { base: u32(img, c + 11), stride: u16(c + 22), height: u16(c + 31) };
  let r = c + GUI_KIND3.length;
  while (r < c + GUI_RECORD_SPAN && !bytesAt(img, r, GUI_RECORD)) r++;
  if (r === c + GUI_RECORD_SPAN) throw new Error(`guiCanvas: no record stride and height within ${GUI_RECORD_SPAN} bytes after the kind-3 branch at ${h8(0x50000000 + c)}`);
  const stride = u16(r + 1), height = u16(r + 7);
  for (let o = img.indexOf(0x25); o >= 0; o = img.indexOf(0x25, o + 1)) {
    const b = o - (GUI_BANK.length - 2), k = GUI_BANK_IDS.indexOf(img[o + 2]);
    if (img[o + 1] === 0x00 && k >= 0 && b >= 0 && bytesAt(img, b, GUI_BANK)) banks[k].push([u32(img, b + 21), u32(img, b + 27), img[b + 1]]);
  }
  const bad = banks.findIndex((x) => x.length !== 1);
  if (bad >= 0) throw new Error(`guiCanvas: ${banks[bad].length} setups of bank 0x${GUI_BANK_IDS[bad].toString(16)}, want 1`);
  const sizes = banks.map(([[, size]]) => size);
  if (kind3.stride !== stride || sizes.some((s) => s !== stride * height)) throw new Error(`guiCanvas: records ${stride} x ${height}, kind-3 stride ${kind3.stride}, bank sizes ${sizes.map(h8).join(', ')}`);
  return { stride, height, banks: banks.map(([x]) => x), kind3: [kind3.base, kind3.height] };
}

// The DRAM's size (board fact 'dram_size', src/machine.mjs, the 0x60000000 and 0xa0000000 regions): the end of the
// GUI's first OSD bank (guiCanvas), taken as the DRAM's end (I: the bank is placed at the top). E143's ends at
// 0xb8000000 (D: 0x50533df2), the 384 MiB the lab has mapped for E143 since its first runs; the E144 family's at
// 0xb0000000 or, on E133, E130, E129, E132, E118 and E120, 0xc0000000 (X, the facts of the 17 ported bodies), whose
// GUIs use DRAM above 384 MiB (E130's application start, with 384 MiB mapped, faulted in a word copy at 0x50b0c026
// whose last destination was 0xbfc59440, and runs on with 512 MiB, X). The banks sit below it, the first one ending
// there, on all 18 expanded images (X). Returns the size in bytes.
export const dramSize = ({ banks: [[base, size, count]] }) => cached(base) + size * count - 0x60000000;

// The application's module-9 state reads (fact 'app.module9_readers', src/lab/camapp.mjs S-TAKEOVER): the return
// addresses of the calls of MODULE_STATE_GET (E143's 0x50ab5780, at its place in the build) that `mov 9,d0` (80 09)
// directly precedes, call or calls, d16 or d32. E144 22 and E139 22, each the list src/fw/models.mjs gave by hand (D,
// checked one by one); E143 33, all 11 of its lab lists among them (src/lab/camapp.mjs CA_MODULE9_READERS,
// src/lab/menu.mjs TAKEOVER_READERS); 20 to 32 on each other body (X, a byte scan of each expanded image).
const MODULE_STATE_GET = 0x50AB5780, MOV_9_D0 = [0x80, 0x09];
function moduleReaders(img, getter) {
  const out = [];
  for (let o = MOV_9_D0.length; o + 7 <= img.length; o++) {
    const c = callAt(img, o);
    if (c && 0x50000000 + c.to === getter && bytesAt(img, o - MOV_9_D0.length, MOV_9_D0)) out.push(0x50000000 + o + c.len);
  }
  return out;
}

// The play component's wrappers (fact 'play.wrappers', src/lab/camapp.mjs S-PLAYCOMP): every caller of the component
// getter (E143's 0x50d7570b, at its place in the build), each a function of its own that gets the component and calls
// one of its methods: {entry, method} for a `call`, {entry, slot} for a `calls (An)` through the vtable slot `mov
// (slot,Am),An` (d8 or d16) before it. The entry is the first instruction after a return, within COMPONENT_HEAD bytes
// before the getter's call, from which the code runs straight to that call with no return on the way (the first, not
// the nearest: a call's displacement can hold a return's byte, E147 0x50ae3acc in `call 0x50d91abd`, D); the callee
// is the first call or `calls` after it, before a return. E143 16, the lab's PLAY_COMPONENT one by one; E146, E147,
// E144, E139 and E134 16 or 18, among them each place their maps and E144's two former overrides gave E143's (D:
// E144 0x5084e75c, 0x5084e87d); E125 17, E142 and E140 10, E137 10, E132 and E133 9, E129, E130 and E145 8; the E118
// family places no getter (X, a byte scan of each expanded image at the port's place of the getter). E137's ten:
// 0x507bc059 .. 0x507bc178, each `mov 0,a0; call 0x50a4ee46; call 0x50a4eddb` then its method (D); of them
// 0x507bc0ab (method 0x50915d1a) has no E143 counterpart the port finds, and 0x507bc119 takes a1 and returns a u16
// where E143's isMovementAllowed, which the port pairs with it by its method's 'align' place, takes d0 (D; that they
// are the same is I). E125's 0x507a4581 calls 0x502ca3dd and tests the component for null before its method (D).
// Through bin/port.mjs also the places of E143's wrappers (how 'component-method'). Throws where a caller has no such
// entry or callee.
export const COMPONENT_GETTER_E143 = 0x50D7570B;
const COMPONENT_HEAD = 0x40, COMPONENT_TAIL = 12;
export function componentWrappers(img, getter) {
  const g = getter - 0x50000000, out = [], here = (o) => `componentWrappers: the getter call at ${h8(0x50000000 + o)}`;
  for (const c of callsWhere(img, (t) => t === g)) {
    const o = c.at;
    let entry = -1;
    for (let e = o; e >= o - COMPONENT_HEAD; e--) if (isRet(img, e - 3) && runsTo(img, e, o)) entry = e;
    if (entry < 0) throw new Error(`${here(o)} has no entry after a return within ${COMPONENT_HEAD} bytes`);
    let p = o + c.len, slot = null, w = null;
    for (let k = 0; k < COMPONENT_TAIL && w === null && !isRet(img, p); k++) {
      const op = img[p], o2 = img[p + 1], d = callAt(img, p);
      if (d) w = { entry: 0x50000000 + entry, method: 0x50000000 + d.to };
      else if (op === 0xf0 && (o2 & 0xfc) === 0xf0 && slot !== null) w = { entry: 0x50000000 + entry, slot };
      else if (op === 0xf8 && (o2 & 0xf0) === 0x20) slot = img[p + 2];
      else if (op === 0xfa && (o2 & 0xf0) === 0x20) slot = img[p + 2] | img[p + 3] << 8;
      p += d ? d.len : insnLength(op, o2);
    }
    if (w === null) throw new Error(`${here(o)}: no method call within ${COMPONENT_TAIL} instructions after it`);
    out.push(w);
  }
  return out;
}

// The language's settings-store id (fact 'text.lang_setting', src/lab/text.mjs LANG_SETTING): the language loader
// (E143's 0x51257bfb, at its place in the build) gets the settings object with a call and reads the language through
// the object's vtable, `mov imm16,d0` then `calls (An)` (E143: mov 3009,d0 at 0x51257c0b, mov (12,a2),a2, calls (a2)
// at 0x51257c13, the read S-SET answers, D). The id is the last `mov imm16,d0` (2c imm16) before the first `calls (An)`
// (f0 f0..f3) within LANG_WALK instructions of the loader's entry, with no call between. 3009 on E143, E146, E144,
// E139, E134, E137, E142, E140 and E145, 3011 on E147, 1709 on E125, E129, E130, E132 and E133, 1509 on the E118
// family, each 0x10 bytes past the loader's place (X, a walk of each expanded image; D on E143, E144 0x50f1e9d0, E129
// 0x50db2655 and E118 0x50cd5a8b, which read it through vtable +8 where E143 reads +12). Throws where the walk finds
// no such read.
const LANG_LOADER = 0x51257BFB, LANG_WALK = 16;
function langSetting(img, loader) {
  let p = loader - 0x50000000, id = null;
  for (let k = 0; k < LANG_WALK; k++) {
    const op = img[p], o2 = img[p + 1], call = callAt(img, p);
    if (op === 0xf0 && (o2 & 0xfc) === 0xf0) {
      if (id === null) break;
      return id;
    }
    if (op === 0x2c) id = img[p + 1] | img[p + 2] << 8;
    else if (call) id = null;
    p += call ? call.len : insnLength(op, o2);
  }
  throw new Error(`langSetting: no 'mov imm16,d0; ..; calls (An)' within ${LANG_WALK} instructions of the language loader at ${h8(loader)}`);
}

// The AE interpolation's init and form (fact 'ae', src/lab/play.mjs H-AEINIT; through bin/port.mjs also the place of
// E143's AE init AE_INIT_E143, how 'ae-wrapper'), read at the place of E143's interpolation 0x50563138:
// - table: whether the interpolation divides (`div`, f2 6x, before its first return), the table form: it reads a1 and
//   a2 from a u16 step table and divides by a2 - a1, which only the init fills (E143 0x50563138, div at 0x5056319c;
//   E139 0x50414400, div at 0x50414464, D). The other form clamps its input to 1116..3328 and reads F-store kinds
//   6458 and 6730 itself, with no table and no division (E134 0x50429386, D);
// - init: the AE init, the function the interpolation's one wrapper `exth d0; call interp; ...` follows (its entry is
//   the nearest call target before the wrapper, from which the instructions run straight to the return just before
//   it; E143 0x50560b29 and its wrapper 0x50560c3e, E139 0x50411e84 / 0x50411f99, E134 0x50427066 / 0x5042709f, D);
// - regions: [address, length] of the init's opening memsets, `mov imm32,a0; clr d0; mov imm,d1; call memset` in
//   either order, up to its first other call (E143 80 / 88 / 16 / 104 bytes; E139 76 / 84 / 16 / 104; E134 76 / 84 /
//   16, then 0x50429171, D).
// The table form on E143, E146, E147, E144, E139, E137, E142 and E140, the other on E134, E125, E130 and E133; the
// init found is the port's place of E143's on all but E134, E125 and E137, whose map answers are other functions (X,
// a walk of each expanded image at the port's place of the interpolation; E145, E129, E132 and the E118 family have
// none, aeRows reads the first three). Throws where the interpolation has no return within AE_INSNS instructions, not
// one wrapper, or no init.
export const AE_INTERP = 0x50563138, AE_INIT_E143 = 0x50560B29;
const AE_INSNS = 120, AE_WALK = 0x400;
function aeInit(img, interp) {
  const io = interp - 0x50000000, here = `aeInit: the interpolation at ${h8(interp)}`;
  let p = io, k = 0, table = false;
  for (; k < AE_INSNS && !isRet(img, p); k++) {
    const op = img[p], o2 = img[p + 1], c = callAt(img, p);
    if (op === 0xf2 && (o2 & 0xf0) === 0x60) table = true;
    p += c ? c.len : insnLength(op, o2);
  }
  if (k === AE_INSNS) throw new Error(`${here} has no return within ${AE_INSNS} instructions`);
  const wrappers = [];
  for (const o of callsTo(img, io)) if (img[o - 1] === 0x18 && isRet(img, o - 4)) wrappers.push(o - 1);
  if (wrappers.length !== 1) throw new Error(`${here} has ${wrappers.length} wrappers (${wrappers.map((o) => h8(0x50000000 + o)).join(', ')}), want one`);
  const [w] = wrappers;
  let init = -1;
  for (const { to: t } of callsWhere(img, (t) => t < w && w - t <= AE_WALK)) if (t > init) init = t;
  for (p = init; init >= 0 && p < w && !isRet(img, p);) { const c = callAt(img, p); p += c ? c.len : insnLength(img[p], img[p + 1]); }
  if (init < 0 || p !== w - 3) throw new Error(`${here}: no call target before its wrapper ${h8(0x50000000 + w)} runs straight to the return before it`);
  return { init: 0x50000000 + init, regions: aeRegions(img, init, w), table };
}
// The opening memsets of the AE init at offset init, up to offset end (aeInit's regions).
function aeRegions(img, init, end) {
  const regions = [];
  let a0 = null, d1 = null, zero = false, memset = null;
  for (let p = init; p < end;) {
    const op = img[p], o2 = img[p + 1], c = callAt(img, p);
    if (c) {
      if (memset !== null && c.to !== memset) break;
      if (a0 === null || d1 === null || !zero) break;
      memset = c.to;
      regions.push([a0, d1]);
      a0 = d1 = null; zero = false;
      p += c.len;
      continue;
    }
    if (op === 0xfc && o2 === 0xdc) a0 = u32(img, p + 2);
    else if (op === 0x85) d1 = img[p + 1] << 24 >> 24;
    else if (op === 0x2d) d1 = (img[p + 1] | img[p + 2] << 8) << 16 >> 16;
    else if (op === 0x00) zero = true;
    p += insnLength(op, o2);
  }
  return regions;
}

// The AE init of the row form (fact 'ae' where the port places no interpolation; through bin/port.mjs the place of
// E143's AE init AE_INIT_E143, how 'ae-rows'). Its interpolation is no function of its own but part of a larger one
// (E145 0x503e6914, called from 0x503e567b, X), and no port places E143's. It clamps its input to 1194..3072 and walks
// a table of eight u16 [x, y] rows, `mov <rows>,a0; .. movhu (d0,a0),d0` (E145 rows 0x61a31714 at 0x503e69c0), for the
// pair its input falls between; it divides by the difference of their x and skips the division where the two are equal
// (`cmp d2,d1; beq` at 0x503e6a19, before the `div` at 0x503e6a2b; E129 at 0x503be27c, D). The init fills only the y
// column: a run of AE_ROWS F-store kind 6458 reads, each `mov 6458,d0; mov 0,a0; clr d1 | mov k,d1; call R; movhu
// d0,(W)`, one after another with W 4 bytes apart (E145 0x503e4fce, its run at 0x503e4fee, indices 0, 1, 4, 7, 10, 13,
// 18 and 21; it is called from 0x503f0c84 in the boot path's place of E143's 0x50572574 and calls the place of E143's
// 0x50562f1b, 0x503e6829, as E143's init does, D). The x column is the image's preloaded data, 1195, 1280, 1536, 1792,
// 2048, 2304, 2731 and 2987 on all three bodies, and no store names its address (D: the reader's two loads are its only
// references, X). So the interpolation cannot divide by zero, whether the init ran or not: table false. The rule checks
// the guard: a `beq` past the first `div` within AE_ROWS_WALK instructions of each load of the rows' address (the div
// is 61 and 62 instructions after it on these, X). One run on E145, E129 and E132, none on the other fifteen bodies (X,
// a byte scan of each expanded image). Returns {init, regions, table: false, rows} (the entry, entryOf the run within
// AE_ROWS_SPAN bytes; its opening memsets, none on these; the rows' address), or undefined where no run is; throws
// where the run is not one, has no entry, no load of its rows, or a division after one with no such guard.
const AE_ROWS = 2, AE_ROWS_SPAN = 0x400, AE_ROWS_WALK = 80, AE_KIND_READ = [0x2c, 0x3a, 0x19, 0x90, 0x00];
function aeRows(img) {
  const read = (p) => {
    const index = img[p + 5] === 0x04 ? 1 : img[p + 5] === 0x85 ? 2 : 0;
    if (!index || !bytesAt(img, p, AE_KIND_READ)) return null;
    let q = p + 5 + index;
    const c = callAt(img, q);
    if (!c || !bytesAt(img, (q += c.len), [0xfc, 0x83])) return null;
    return { end: q + 6, to: c.to, word: u32(img, q + 2) };
  };
  const runs = [];
  for (let p = img.indexOf(0x2c); p >= 0 && p + 20 <= img.length; p = img.indexOf(0x2c, p + 1)) {
    const first = read(p);
    if (!first) continue;
    const run = [first];
    for (let r; (r = read(run[run.length - 1].end)) && r.to === first.to && r.word === run[run.length - 1].word + 4;) run.push(r);
    if (run.length >= AE_ROWS) runs.push({ at: p, run });
    p = run[run.length - 1].end - 1;
  }
  if (!runs.length) return undefined;
  if (runs.length !== 1) throw new Error(`aeRows: ${runs.length} runs of F-store kind 6458 reads (${runs.map((r) => h8(0x50000000 + r.at)).join(', ')}), want one`);
  const [{ at, run }] = runs, init = entryOf(img, at, AE_ROWS_SPAN);
  if (init === undefined) throw new Error(`aeRows: no call target within 0x${AE_ROWS_SPAN.toString(16)} bytes before the run at ${h8(0x50000000 + at)} runs to it`);
  const rows = run[0].word - 2, loads = loadsOf(img, rows).filter((p) => img[p + 1] === 0xdc);
  for (const l of loads) {
    let p = l, guard = false;
    for (let k = 0; k < AE_ROWS_WALK && !isRet(img, p) && !(img[p] === 0xf2 && (img[p + 1] & 0xf0) === 0x60); k++) p += callAt(img, p)?.len ?? insnLength(img[p], img[p + 1]);
    for (let q = l; q < p; q += callAt(img, q)?.len ?? insnLength(img[q], img[q + 1])) if (img[q] === 0xc8 && q + (img[q + 1] << 24 >> 24) > p) guard = true;
    if (img[p] === 0xf2 && !guard) throw new Error(`aeRows: the division at ${h8(0x50000000 + p)} after the rows' load at ${h8(0x50000000 + l)} has no beq past it`);
  }
  if (!loads.length) throw new Error(`aeRows: no 'mov ${h8(rows)},a0' loads the rows the run at ${h8(0x50000000 + at)} fills`);
  return { init: 0x50000000 + init, regions: aeRegions(img, init, at), table: false, rows };
}

// A display device's frame period word (fact 'frame_period', and through bin/port.mjs the places of E143's words
// FRAME_PERIOD_E143, src/lab/display.mjs DEVICE period, the period in us its line time is read from), read after the
// place of the device's vtotal function (DEVICE vtotal_fn): within PERIOD_SPAN bytes after it, the first run of
// getters `mov (W),d0; retf` that its setter follows at once (`mov d0,d2`, the period in d0, or the store of d0
// itself, `mov d0,(W)`: E125 0x5022abad after the run at 0x5022ab9b that its vtotal function 0x5022aaa8 calls, D), and
// of the run's words
// the first one a `mov dN,(W)` stores within PERIOD_STORE bytes after the setter's start (EVF: E143
// 0x50023ce3, W 0xa32db428, stored at 0x50023d18 by the setter that picks the vtotal by the period; E144 0x50021935,
// W 0x620bfb98, its setter `mov d0,d2; mov d2,(W); mov 825,d0; divu` 0x5002193e; E137 0x5002106f, W 0x620ff45c, the
// same setter as E144's at 0x50021078, D; TFT: E143 0x501d8c12, W 0xa32db47c, D). The getter lies 0xae..0x1bb bytes
// after the vtotal function, and the word is the one the maps (and E134's hand override, D) placed, for both devices
// on E143, E146, E147, E144, E139 and E134 and for the TFT on E137 and E133 (X, a scan at the port's places; the
// vtotal functions are not placed on the other bodies). An inference (I) that the first such pair is the device's:
// it is only checked there. E145's EVF getter run holds another word first, (0x61ccc980), which a store 0x39 bytes
// after its getter also writes, and its setter 0x501ec907 stores the second, (0x61ccc97c) (D); the rule had taken the
// first getter whose word is stored after it, and the display start read 150 there (X). Returns {tft, evf} (a device
// missing where its vtotal function is not placed); throws where a placed one has no such getter.
export const FRAME_PERIOD_E143 = { tft: { vtotal: 0x501D8ABA, word: 0xA32DB47C }, evf: { vtotal: 0x50023BAB, word: 0xA32DB428 } };
const PERIOD_SPAN = 0x200, PERIOD_STORE = 0x40;
const PERIOD_GETTER = [0xfc, 0xa4, null, null, null, null, 0xde, 0x00, 0x00];
function framePeriod(img, vtotal) {
  for (let o = vtotal - 0x50000000, end = o + PERIOD_SPAN; o < end; o++) {
    if (!bytesAt(img, o, PERIOD_GETTER)) continue;
    const run = [];
    let p = o;
    for (; bytesAt(img, p, PERIOD_GETTER); p += 9) run.push(u32(img, p + 2));
    if (img[p] === 0x82 || (img[p] === 0xfc && img[p + 1] === 0x81)) {
      for (let q = p; q < p + PERIOD_STORE; q++) if (img[q] === 0xfc && (img[q + 1] & 0xf3) === 0x81 && run.includes(u32(img, q + 2))) return u32(img, q + 2);
    }
    o = p - 1;
  }
  throw new Error(`framePeriod: no 'mov (W),d0; retf' run with its setter storing one W within ${PERIOD_SPAN} bytes after the vtotal function at ${h8(vtotal)}`);
}

// The hardware-timer table the hardware-timer init walks (fact 'hw_timer', and through bin/port.mjs the place of
// E143's pointer word HW_TIMER_PTR_E143, src/lab/display.mjs HW_TIMER_PTR), read at the place of the init (E143
// 0x500642dd). E143's picks the board's table from a list by the board byte and keeps it in a word it reads back,
// `mov d1,(W); clr d3; mov (W),a0` (E143 W 0xa32ca47c at 0x500642f4, E144 0xa2681e2c at 0x50055de4, D): {ptr: W}.
// E125's has one table and indexes it in place, `mov d2,a0; add T,a0` (T 0x600cd6d0 at 0x50057693, 26 entries of 6
// bytes, D): {table: T}, and no pointer word. The pointer form on E143, E146, E147, E144, E139, E134, E137, E142,
// E140, E145, E133 and E130, its W the map's place of E143's where the map places it, the table form on E125 (X, a
// scan of HW_TIMER_SPAN bytes at the port's places; the init is not placed on E129, E132 and the E118 family).
// Throws unless exactly one form.
export const HW_TIMER_INIT_E143 = 0x500642DD, HW_TIMER_PTR_E143 = 0xA32CA47C;
const HW_TIMER_SPAN = 0x30;
function hwTimer(img, init) {
  const found = [];
  for (let o = init - 0x50000000, end = o + HW_TIMER_SPAN; o < end; o++) {
    if (bytesAt(img, o, [0xfc, 0x85]) && bytesAt(img, o + 6, [0x0c, 0xfc, 0xa0]) && u32(img, o + 2) === u32(img, o + 9)) found.push({ ptr: u32(img, o + 2) });
    if (bytesAt(img, o, [0xf1, 0xe8, 0xfc, 0xd0])) found.push({ table: u32(img, o + 4) });
  }
  if (found.length !== 1) throw new Error(`hwTimer: ${found.length} table pointer or fixed table forms within ${HW_TIMER_SPAN} bytes after the hardware-timer init at ${h8(init)}, want 1`);
  return found[0];
}

// The C-runtime clock read (fact 'crt.clock_read', and through bin/port.mjs the place of E143's K_CRT_134D_E143,
// src/lab/menu.mjs K-CRT-134D): the flash library function the boot's one read of the SCPU counter calls, the target of
// the 7-byte call at the place of E143's call K_CRT_CALL_E143 (E143 0x3ffe134d, D). The library is outside the image
// and only the maps' paired calls into it place it, which the maps did not do for E125 (its call 0x50052444 to
// 0x36fdfd0b, D). The target is the map's place of E143's on E146, E147, E144, E139, E134, E137, E142, E140, E145,
// E133, E130, E129 and E132 (X, a call read at each port's place of the call); the call is not placed on the E118
// family. Throws where the place holds no call.
export const K_CRT_CALL_E143 = 0x5005A6CB, K_CRT_134D_E143 = 0x3FFE134D;
function crtClockRead(img, site) {
  const c = callAt(img, site - 0x50000000);
  if (!c || c.len !== 7) throw new Error(`crtClockRead: no 7-byte call at ${h8(site)}, the place of E143's ${h8(K_CRT_CALL_E143)}`);
  return (0x50000000 + c.to) >>> 0;
}

// The frame display mode set (fact 'frame_mode.set', and through bin/port.mjs the place of E143's FRAME_MODE_SET_E143,
// src/lab/camapp.mjs S-TAKEFRAME), read at the place of the TAKE module's frame-mode request TAKE_FRAME_E143. E143's
// request maps its request bits to the mode mask and calls the set last (0x5039f622, D). On the E144 family the
// request is a clamp to a mode number 0..3, `exthu d0`, then `cmp k,d0; beq` up to k = 3, `clr d0` and the call of
// the set (E144 0x5028dd7e -> 0x500257d4, E125 0x5029ae2b -> 0x50021e55, D; on E125 a `bra` to the next instruction
// before the clr; E133's place is the first cmp, 0x5027c52f, after the exthu, D). The set stores the number in the
// mode byte that the AF upload compares with 3 (E144 0x500257d4 / 0x50025902, E125 0x50021e87 / 0x50021f60, D).
// E125's set opens without the trace call the others' open with (E144 `clr d0; mov d3,d1; call 0x50025bd7`, D), and
// no map placed it. The clamp form on E144, E139, E134, E137, E142, E140, E133 and E125, its set the map's place of
// E143's on all but E125; the request is not placed on E145, E130, E129, E132 and the E118 family (X, a read of the
// clamp at each port's place of the request). S-TAKEFRAME's 4, E143's AF-frames bit, is no number this set knows: it
// stores 0 (E125 0x50021ea7, D), so on these bodies S-AFOSD's upload, which acts in mode 3 only, is dropped (open).
// Returns the set, or undefined where the request is not a clamp (the E143 family's).
export const TAKE_FRAME_E143 = 0x5039F583, FRAME_MODE_SET_E143 = 0x500256D9;
const FRAME_MODE_MAX = 3;
function frameModeSet(img, request) {
  let p = request - 0x50000000;
  if (img[p] === 0x1c) p++;
  const ks = [];
  for (; img[p] === 0xa0 && img[p + 2] === 0xc8; p += 4) ks.push(img[p + 1]);
  if (img[p] === 0xca) p += img[p + 1] << 24 >> 24;
  const c = img[p] === 0x00 ? callAt(img, p + 1) : null;
  if (!c || ks.at(-1) !== FRAME_MODE_MAX || ks.some((k) => k > FRAME_MODE_MAX)) return undefined;
  return (0x50000000 + c.to) >>> 0;
}

// The frame plane's uploads on the clamp form (fact 'frame_plane', and through bin/port.mjs the place of E143's
// AF_UPLOAD_E143, src/lab/camapp.mjs S-AFOSD), read after the frame display mode set (the TAKE clamp's, frameModeSet,
// else the port's place of E143's). The set compares the requested number with 1, 2 and 3 (`cmp k,d3`, E142
// 0x50025c1b..0x50025c45, E145 0x50022663..0x5002268d, D) and keeps it in the mode byte (E142 0xa26a367c, E145
// 0xa213a48c); each upload that follows it opens, after a return and at most two register moves, with `movbu
// (mode),Dn` and acts only while the byte is k, the first `cmp k,Dn` within TEST_SPAN bytes (after a trace call on
// E142, `mov k,d0; mov Dn,d1; call`; at once on E134; E142 mode 1 0x50025ca1, mode 2 0x50025ce4, mode 3 0x50025d21;
// E145 mode 1 0x500226e9, mode 2 0x5002272c; D). Mode 1 posts the plane's flag 16 and carries nothing (the place of E143's
// UP_FACE, 0x50025747), mode 2 copies five halfwords (E143's UP_LOCKON 0x50025764 has that copy and the same four
// callers' places, take_mov, the through-image helpers and the TAKE piece: E145 0x5027453c, 0x502749da, 0x50311913,
// 0x504e256c, D) and mode 3 is the AF upload (a frame count and frames of 8 bytes, the place of E143's UP_AF
// 0x500257ce; E130's 0x50022dd8, called only by its AF module's 0x50605bc1 with `mov 3,d0`, its body E142's without
// the opening trace call 0x50025e99, D). E145 (the TG-7) has modes 1 and 2 only: its set takes 3 (`mov 3,d0` at
// 0x5026da0d in its TAKE module) and CPU 3's DISP_FRAME reads the mode-3 count and frames (0xa213a860, 0xa213a498 at
// 0x50ae07ae, 0x50ae07da, D), but no code stores to either in either DRAM view (X, a byte scan of the image for the
// addresses), and its AF is TAKE_FOCUS's, with no FCS layer and no "osd:upload_af_info()" (X, a string scan). The
// mask form (the E143 family's set, a bit per request) is not read. Returns {mode, uploads: [mode 1, mode 2, mode 3]}
// (null for a mode with no upload), or undefined where set is not the clamp form; throws where a mode has two uploads.
export const AF_UPLOAD_E143 = 0x500257CE;
const PLANE_SPAN = 0x200, CLAMP_SPAN = 0x60, TEST_SPAN = 0x18, PLANE_PREFIX = new Set([0x86, 0x92]);   // mov d1,d2; mov a0,a2
// `movbu (abs32),Dn` (fc a8..ab) at o: n, else -1; `cmp imm8,Dn` (a0, a5, aa, af) at o: [n, imm8], else null
const byteLoad = (img, o) => (img[o] === 0xfc && (img[o + 1] & 0xfc) === 0xa8 ? img[o + 1] & 3 : -1);
const cmpImm = (img, o) => (img[o] >= 0xa0 && img[o] <= 0xaf && (img[o] - 0xa0) % 5 === 0 ? [(img[o] - 0xa0) / 5, img[o + 1]] : null);
function framePlane(img, set) {
  const p = set - 0x50000000;
  let mi = p;
  while (mi < p + CLAMP_SPAN && byteLoad(img, mi) < 0) mi++;
  const ks = new Set();
  for (let o = p; o < p + CLAMP_SPAN; o++) { const c = cmpImm(img, o); if (c) ks.add(c[1]); }
  if (mi === p + CLAMP_SPAN || ![1, 2, 3].every((k) => ks.has(k))) return undefined;
  const mode = u32(img, mi + 2), uploads = [null, null, null];
  for (let o = p; o < p + PLANE_SPAN; o++) {
    const n = byteLoad(img, o);
    if (n < 0 || u32(img, o + 2) !== mode) continue;
    let e = o;
    while (e > o - 2 && PLANE_PREFIX.has(img[e - 1]) && !isRet(img, e - 3)) e--;
    if (!isRet(img, e - 3)) continue;
    let k = null;
    for (let q = o + 6; q < o + TEST_SPAN && k === null; q++) { const c = cmpImm(img, q); if (c && c[0] === n) k = c[1]; }
    if (k === null || k < 1 || k > FRAME_MODE_MAX) continue;
    if (uploads[k - 1] !== null) throw new Error(`framePlane: two mode-${k} uploads after ${h8(set)}: ${h8(uploads[k - 1])}, ${h8(0x50000000 + e)}`);
    uploads[k - 1] = (0x50000000 + e) >>> 0;
  }
  return { mode, uploads };
}

// The id of the output-device property (fact 'prop.device', src/lab/display.mjs DisplayLab prop_device, S-PROP), the
// immediate of the `mov imm16,d0` just before each property read whose return the lab answers
// (PROP_DEVICE_SITES_E143, the GUI's and the application's; E143 4513 at 0x503eff59 and 0x50b76db4, D). E125 and E145
// read 4013 there (E125 0x502dc5fb and 0x5083e0d3, E145 0x502af089 and 0x50758962, D), so S-PROP did not answer them
// and the GUI read no output device (E145, docs/model-survey.md). 4513 on E143, E146, E147, E144, E139, E134, E137, E142
// and E140, 4013 on E125, E145, E133, E130, E129 and E132; the sites are not placed on the E118 family (X, a byte read
// before each port's place of the two sites). Throws where a placed site has no such read before it or the sites
// disagree.
export const PROP_DEVICE_SITES_E143 = [0x503EFF61, 0x50B76DBE];
function propDevice(img, sites) {
  const ids = sites.map((site) => {
    const o = site - 0x50000000, len = [5, 7].find((n) => callAt(img, o - n)?.len === n && img[o - n - 3] === 0x2c);
    if (len === undefined) throw new Error(`propDevice: no 'mov imm16,d0; call' returning to ${h8(site)}`);
    return img[o - len - 2] | img[o - len - 1] << 8;
  });
  if (new Set(ids).size !== 1) throw new Error(`propDevice: the reads returning to ${sites.map(h8).join(', ')} load ${ids.join(', ')}`);
  return ids[0];
}

// What the rules that read code relative to an E143 function read from one body (src/fw/ports.mjs FACTS[code], with
// readFacts'; bin/port.mjs): img its run-time image, at(address) the build's address of an E143 one (the port's
// placement; null: not placed). Returns {app: {module9_readers}}, {dispq: {sends, loop, start}}, {play: {wrappers}},
// {text: {lang_setting}}, {ae: {init, regions, table, rows (the row form's only)}}, {frame_period: {tft, evf}}, {rtos:
// {init_task, ta_wu, tsnd_sites}}, {store: {db_save, app_saves}}, {hw_timer: {ptr} or {table}}, {crt: {clock_read}},
// {touch_args: {write_len, read_len}}, {dial: {select, select_end, table_ptr, table0}}, {ui_in: {task}}, {touch_start:
// {init, id_word}}, {frame_mode: {set}}, {frame_plane: {mode, uploads}}, {prop: {device}} and {lens_driver: {module_init,
// cache_init, task_vars, tasks, exec_queue, flags, cache_area}} (no app, play, text or
// frame_period part where MODULE_STATE_GET, the component getter, the language loader or both vtotal functions are
// not placed, no ae part where AE_INTERP is not and aeRows finds no run; no sends where OlyQeWr is not, no loop or
// start where CPU 0's kcb or OlyQeRd is not, no dispq part without either; no init_task or ta_wu where CPU 0's kcb or wup_tsk is not, no
// tsnd_sites where tsnd_dtq is not; no store part where the flash save is not, no db_save where the DB init is not; no
// hw_timer part where the hardware-timer init is not, no crt part where the clock read's call is not; no touch_args
// part where touchArgs reads neither length; no dial part where the dial table pointer is not or dialStore reads none,
// as where readFacts' dialSelect reads the select; no touch_start part where CPU 0's kcb, the touch task or OlyTaSt is
// not or touchStart finds no start; no ui_in part where CPU 0's kcb or UI_IN's flag word is not; no frame_mode part
// where the TAKE frame-mode request is not placed or is not a clamp; no frame_plane part where neither it nor the port
// places the frame display mode set, or the set is not the clamp form; no prop part where a property read site is not;
// no lens_driver part where CPU 0's kcb, OlyTaSt, OlyQeRd or LENS_COMMAND's queue word is not or the boot starts no
// lens task). Throws where both AE forms are found.
export function readPlacedFacts({ img, at }) {
  const facts = {}, getter = at(MODULE_STATE_GET), loader = at(LANG_LOADER), interp = at(AE_INTERP), component = at(COMPONENT_GETTER_E143);
  const qewr = at(OLYQEWR_E143), qerd = at(OLYQERD_E143), kcb = at(KCB0_E143), wup = at(WUP_TSK_E143), tsnd = at(TSND_DTQ_E143);
  const dbInit = at(DB_INIT_E143), flashSave = at(FLASH_SAVE_E143);
  const tpWrite = at(TOUCH_E143.i2c_write), tpRead = at(TOUCH_E143.i2c_read), hwInit = at(HW_TIMER_INIT_E143), crtCall = at(K_CRT_CALL_E143);
  const dialPtr = at(DIAL_TABLE_PTR_E143), uiFlag = at(UI_IN_FLAG_E143), tpTask = at(TOUCH_TASK_E143), taSt = at(OLYTAST_E143);
  const takeFrame = at(TAKE_FRAME_E143), propSites = PROP_DEVICE_SITES_E143.map(at);
  if (getter !== null) facts.app = { module9_readers: moduleReaders(img, getter) };
  const loop = kcb !== null && qerd !== null ? displayLoop(img, kcb, qerd) : null;
  const dispq = { ...(qewr !== null && { sends: displaySends(img, qewr) }), ...(loop !== null && { loop, start: displayStart(img, loop, qerd) }) };
  if (Object.keys(dispq).length) facts.dispq = dispq;
  if (component !== null) facts.play = { wrappers: componentWrappers(img, component) };
  if (loader !== null) facts.text = { lang_setting: langSetting(img, loader) };
  const rows = aeRows(img);
  if (interp !== null && rows) throw new Error(`readPlacedFacts: the AE interpolation is placed at ${h8(interp)} and aeRows finds a row form at ${h8(rows.init)}`);
  if (interp !== null || rows) facts.ae = rows ?? aeInit(img, interp);
  const period = {};
  for (const [dev, { vtotal }] of Object.entries(FRAME_PERIOD_E143)) {
    const fn = at(vtotal);
    if (fn !== null) period[dev] = framePeriod(img, fn);
  }
  if (Object.keys(period).length) facts.frame_period = period;
  if (hwInit !== null) facts.hw_timer = hwTimer(img, hwInit);
  if (crtCall !== null) facts.crt = { clock_read: crtClockRead(img, crtCall) };
  const rtos = { ...(kcb !== null && { init_task: initTask(img, kcb) }), ...(wup !== null && { ta_wu: taWu(img, wup) }), ...(tsnd !== null && { tsnd_sites: tsndSites(img, tsnd) }) };
  if (Object.keys(rtos).length) facts.rtos = rtos;
  if (flashSave !== null) facts.store = { ...(dbInit !== null && { db_save: dbSave(img, dbInit, flashSave) }), app_saves: appSaves(img, flashSave) };
  const touchLen = touchArgs(img, tpWrite, tpRead);
  if (Object.keys(touchLen).length) facts.touch_args = touchLen;
  const dial = dialPtr !== null ? dialStore(img, dialPtr) : undefined;
  if (dial !== undefined) facts.dial = dial;
  if (kcb !== null && uiFlag !== null) facts.ui_in = { task: uiInTask(img, kcb, uiFlag) };
  if (kcb !== null) facts.power = { task: powerTask(img, kcb), ...(flashSave !== null && { off: powerOff(img, flashSave) }) };
  const tpStart = kcb !== null && tpTask !== null && taSt !== null ? touchStart(img, kcb, tpTask, taSt) : undefined;
  if (tpStart !== undefined) facts.touch_start = tpStart;
  const evWt = at(OLYEVWT_E143);
  if (tpTask !== null && evWt !== null && qerd !== null) facts.touch_task = touchQueue(img, tpTask, evWt, qerd);
  const modeSet = takeFrame !== null ? frameModeSet(img, takeFrame) : undefined;
  if (modeSet !== undefined) facts.frame_mode = { set: modeSet };
  const planeSet = modeSet ?? at(FRAME_MODE_SET_E143), plane = planeSet !== null ? framePlane(img, planeSet) : undefined;
  if (plane !== undefined) facts.frame_plane = plane;
  if (!propSites.includes(null)) facts.prop = { device: propDevice(img, propSites) };
  const focalNow = at(LENS_FOCAL_NOW_E143), zoomTable = focalNow !== null ? lensZoomTable(img, focalNow) : undefined;
  const lensRecord = at(LENS_RECORD_E143);
  if (zoomTable !== undefined && lensRecord !== null) facts.lens_record = { zoom_table: zoomTable, static: lensStatic(img, lensRecord) };
  const lensQueue = at(LENS_COMMAND_QUEUE_E143);
  const lens = kcb !== null && taSt !== null && qerd !== null && lensQueue !== null ? lensDriver(img, { kcb, taSt, qerd, commandQueue: lensQueue }) : undefined;
  if (lens !== undefined) facts.lens_driver = lens;
  return facts;
}

// What the rules read from one body (src/fw/ports.mjs FACTS[code], written by bin/port.mjs): img is its main block
// expanded in place (src/fw/expand.mjs with preload []), family its board family's facts (src/fw/board.mjs: reset_head,
// sram, sram_size), resLoad its resource block's load address (src/lab/resources.mjs loadAddress). Returns {board:
// {core_byte, library, preload, vector_page, dram_size}} for a family whose reset head copies with the flash-copy
// routine (only vector_page and dram_size for reset_head null, the E143 family's), {res: {font_limit, string_limit}},
// {menu: {list_menu, tab_memory, page_memory, take}}, {kernel: {cpus}}, {errlog: {entry}}, {scpu: {backup}}, {display:
// {change_task, change_entry, queue_word, queue_id, task_init, frame_wait, timer_sleep, sync, face_colour}}, {timer:
// {reload_less_one}}, {dial: {select, select_end, table_ptr, table0}}, {touch_panel: {driver}}, {lens: {mount}}, {iic:
// {waits}}, {touch: {i2c_write, i2c_read}}, {touch_api: {open}}, {shooting: {start, end, auto_through}}, {func_direct:
// {run, id}}, {broker: {init}}, {card: {shots_query, detect}}, {boot: {key, stage}}, {dpc: {init}} (with board.dpc), {sio: {tx_start, rx_start, done, dispatch, restart, channels}}, {storage: {init, tasks, fileclbk, nand, command, album_init, status, cflush, names}}, {power_off: {usb_disconnect}}, {gui: {stride, height,
// banks, kind3}}, {recview: {word, standby}} and {cbs: {NAME: code}} (no memories, take, task init, frame wait, timer sleep,
// sync, face colour, timer, dial, touch, touch_api, shooting, func_direct, boot, dpc, sio, power_off, recview or cbs part where its
// rule reads none). Throws for a reset_head with no rule here, and where a rule throws.
export function readFacts({ img, family, resLoad }) {
  const facts = {};
  if (family.reset_head === 'flash-copy') {
    const { library, preload } = resetHead(img);
    facts.board = { core_byte: coreByte(img, family.sram, family.sram_size), library, preload };
  } else if (family.reset_head !== null) throw new Error(`readFacts: board reset_head ${JSON.stringify(family.reset_head)} has no rule here`);
  facts.board = { ...facts.board, vector_page: vectorPage(img) };
  const { font, string } = resLoader(img, resLoad);
  facts.res = { font_limit: font.limit, string_limit: string.limit };
  const take = guiTake(img);
  facts.menu = { list_menu: listMenu(img), ...menuMemory(img), ...(take !== undefined && { take }) };
  facts.kernel = { cpus: kernelCpus(img) };
  facts.errlog = { entry: errlogEntry(img) };
  facts.scpu = { backup: scpuBackup(img) };
  const frame = frameWait(img), sleep = timerSleep(img), sync = displaySync(img);
  const taskInit = displayTaskInit(img), faceColour = faceColourSet(img);
  facts.display = {
    change_task: displayChangeTask(img), change_entry: displayChangeEntry(img), ...displayQueue(img),
    ...(taskInit !== undefined && { task_init: taskInit }),
    init_2nd: displayInit2nd(img),
    ...(frame !== undefined && { frame_wait: frame }), ...(sleep !== undefined && { timer_sleep: sleep }),
    ...(sync !== undefined && { sync }), ...(faceColour !== undefined && { face_colour: faceColour }),
  };
  const lessOne = timerReloadLessOne(img);
  if (lessOne !== undefined) facts.timer = { reload_less_one: lessOne };
  const dial = dialSelect(img);
  if (dial !== undefined) facts.dial = dial;
  facts.touch_panel = { driver: touchDriver(img) };
  facts.lens = { mount: lensMount(img) };
  facts.iic = { waits: iicWaits(img) };
  const touch = touchI2c(img);
  if (touch !== undefined) facts.touch = touch;
  const tpOpen = touchOpen(img);
  if (tpOpen !== undefined) facts.touch_api = { open: tpOpen };
  const shooting = shootingService(img);
  if (shooting !== undefined) facts.shooting = shooting;
  const direct = funcDirect(img);
  if (direct !== undefined) facts.func_direct = direct;
  facts.broker = { init: brokerInit(img) };
  facts.card = { shots_query: shotsQuery(img), detect: cardDetect(img) };
  const boot = bootState(img);
  if (boot !== undefined) facts.boot = boot;
  const dpc = deferredCalls(img);
  if (dpc !== undefined) { facts.board.dpc = { triggers: dpc.triggers, irqs: dpc.irqs }; facts.dpc = { init: dpc.init }; }
  const sio = sioDriver(img);
  if (sio !== undefined) facts.sio = sio;
  const storage = fileSystem(img);
  if (storage !== undefined) facts.storage = storage;
  const usbOff = usbPowerOff(img);
  if (usbOff !== undefined) facts.power_off = { usb_disconnect: usbOff };
  facts.gui = guiCanvas(img);
  facts.board.dram_size = dramSize(facts.gui);
  const recview = recViewStandby(img);
  if (recview !== undefined) facts.recview = recview;
  const cbs = cbsIds(img);
  if (cbs !== undefined) facts.cbs = cbs;
  return facts;
}

// The E143 addresses the rules place in a body (bin/port.mjs rulePairs, src/fw/place.mjs placer): E143 address -> {to,
// how}. rulePlaces(facts), from readFacts' result: E143's touch-panel I2C functions at the traced ones (touchI2c, how
// 'touch-trace'); the shooting service's start and end at their traces' loads (shootingService, 'service-trace'); the
// GUI task's take after its receive loop (guiTake, 'take-loop'); the function direct start after its checks
// (funcDirect, 'direct-checks'); the event broker init by its opening and slot loop (brokerInit, 'broker-slots'); the
// error log by its test of the id's module (errlogEntry, 'module-test'); the remaining-shots query at the callee whose
// result the application's getAvailableShootCount stores (shotsQuery, 'shots-method'); the touch panel's open by its
// trace (touchOpen, 'open-trace'); the display task init as the function that creates the DISPLAY queue
// (displayTaskInit, 'queue-init'); the face plane's colour setter at the one that loads its trace (faceColourSet,
// 'cpdata-trace').
export function rulePlaces(facts) {
  return new Map([
    ...Object.entries(facts.touch ?? {}).map(([k, to]) => [TOUCH_E143[k], { to, how: 'touch-trace' }]),
    ...Object.entries(facts.shooting ?? {}).map(([k, to]) => [SHOOTING_E143[k], { to, how: 'service-trace' }]),
    ...(facts.menu.take !== undefined ? [[GUI_TAKE_E143, { to: facts.menu.take, how: 'take-loop' }]] : []),
    ...(facts.func_direct ? [[FUNC_DIRECT_E143, { to: facts.func_direct.run, how: 'direct-checks' }]] : []),
    [BROKER_E143, { to: facts.broker.init, how: 'broker-slots' }],
    [ERRLOG_E143, { to: facts.errlog.entry, how: 'module-test' }],
    [SHOTS_QUERY_E143, { to: facts.card.shots_query, how: 'shots-method' }],
    ...(facts.touch_api ? [[TP_OPEN_E143, { to: facts.touch_api.open, how: 'open-trace' }]] : []),
    ...(facts.display.task_init !== undefined ? [[DISPLAY_TASK_INIT_E143, { to: facts.display.task_init, how: 'queue-init' }]] : []),
    ...(facts.display.face_colour !== undefined ? [[FACE_COLOUR_SET_E143, { to: facts.display.face_colour, how: 'cpdata-trace' }]] : []),
  ]);
}
// placedRulePlaces(facts, e143, place), from readPlacedFacts' result (e143: E143's main block; place: the port's
// place(), E143 address -> {to} or null): E143's AE init at the one the interpolation's wrapper follows (aeInit, how
// 'ae-wrapper') or at the row form's (aeRows, 'ae-rows'); E143's frame period words at the words the getters after the
// vtotal functions read (framePeriod, 'period-getter'); each of E143's play component wrappers (componentWrappers,
// 'component-method') at the wrapper here that calls the place of its method, or the same vtable slot; where its method
// is not placed, at the wrapper the map placed it on if no other took that one; else, or where two of E143's would
// share one, unplaced (E137's map put getSelectPicNumber on 0x507bc194, which gets another object, D); CPU 0's init
// task at its static task table's row of task 1 (initTask, 'task-table'); OlyTaWu at the wup_tsk caller with its
// opening (taWu, 'wup-opening'); the DISPLAY task loop at the static task that runs to the DISPLAY queue's receive
// (displayLoop, 'queue-receive'); the UI_IN task at the static task that runs to its flag word's load (uiInTask,
// 'flag-wait'); the touch init and the touch task's id word at the boot's start of the touch task (touchStart,
// 'task-start'); the touch task's flag word at the word its loop waits on (touchQueue, 'touch-wait'); the DB init's
// flash save return at the one call of the flash save in the DB init (dbSave, 'db-save'); the hardware-timer table
// pointer at the word the hardware-timer init keeps it in, unplaced where the init indexes a fixed table (hwTimer,
// 'timer-init'); the C-runtime clock read at the target of the call at the place of E143's
// (crtClockRead, 'call-target'); the frame display mode set at the one the TAKE request's clamp calls (frameModeSet,
// 'take-clamp'); the AF upload at the frame plane's mode-3 upload, unplaced where the plane has none (framePlane,
// 'plane-mode').
export function placedRulePlaces(facts, e143, place) {
  const out = new Map();
  if (facts.store?.db_save !== undefined) out.set(DB_SAVE_RETURN_E143, { to: facts.store.db_save, how: 'db-save' });
  if (facts.rtos?.init_task !== undefined) out.set(INIT_TASK_E143, { to: facts.rtos.init_task, how: 'task-table' });
  if (facts.rtos?.ta_wu !== undefined) out.set(OLYTAWU_E143, { to: facts.rtos.ta_wu, how: 'wup-opening' });
  if (facts.dispq?.loop !== undefined) out.set(DISPLAY_LOOP_E143, { to: facts.dispq.loop, how: 'queue-receive' });
  if (facts.ui_in) out.set(UI_IN_E143, { to: facts.ui_in.task, how: 'flag-wait' });
  if (facts.touch_start) {
    out.set(TOUCH_INIT_E143, { to: facts.touch_start.init, how: 'task-start' });
    out.set(TOUCH_TASK_ID_E143, { to: facts.touch_start.id_word, how: 'task-start' });
  }
  if (facts.touch_task) out.set(TP_FLAG_E143, { to: facts.touch_task.flag, how: 'touch-wait' });
  if (facts.ae) out.set(AE_INIT_E143, { to: facts.ae.init, how: facts.ae.rows === undefined ? 'ae-wrapper' : 'ae-rows' });
  for (const [dev, to] of Object.entries(facts.frame_period ?? {})) out.set(FRAME_PERIOD_E143[dev].word, { to, how: 'period-getter' });
  if (facts.hw_timer) out.set(HW_TIMER_PTR_E143, { to: facts.hw_timer.ptr ?? null, how: 'timer-init' });
  if (facts.crt) out.set(K_CRT_134D_E143, { to: facts.crt.clock_read, how: 'call-target' });
  if (facts.frame_mode) out.set(FRAME_MODE_SET_E143, { to: facts.frame_mode.set, how: 'take-clamp' });
  if (facts.frame_plane) out.set(AF_UPLOAD_E143, { to: facts.frame_plane.uploads[2], how: 'plane-mode' });
  if (facts.play) {
    const here = facts.play.wrappers, pairs = new Map();
    for (const w of componentWrappers(e143, COMPONENT_GETTER_E143)) {
      const m = w.method === undefined ? null : place(w.method)?.to ?? null;
      const hits = here.filter((x) => (w.method === undefined ? x.slot === w.slot : m !== null && x.method === m));
      pairs.set(w.entry, hits.length === 1 ? hits[0].entry : w.method !== undefined && m === null ? { map: place(w.entry)?.to ?? null } : null);
    }
    const taken = new Set([...pairs.values()].filter((t) => typeof t === 'number'));
    const to = new Map([...pairs].map(([v, t]) => [v, typeof t === 'number' || t === null ? t : here.some((x) => x.entry === t.map) && !taken.has(t.map) ? t.map : null]));
    const claims = [...to.values()].filter((t) => t !== null);
    for (const [v, t] of to) out.set(v, { to: claims.indexOf(t) === claims.lastIndexOf(t) ? t : null, how: 'component-method' });
  }
  return out;
}
