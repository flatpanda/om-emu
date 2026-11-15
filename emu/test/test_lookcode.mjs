// Caduceus for OM-3's look code below the pixels, run by calls (analysis/caduceus-om3/README.md 4.6): the camera
// route of a film's Grain at its hook sites, down to combiner 1's gain, and the halation pass on pixels. On E147 with
// a caduceus-om3 release, through the supported scripting API (host/session.mjs input()) on jobs and images written
// into the calls' scratch. No Caduceus byte is in this file: patch.json, LOOKS.BIN and their source's numbers are read
// from a checkout at run time; the expectations' arithmetic is written here from their definitions. The unit
// fixtures' numbers (FAKE_BLOCK, FAKE_LD, FAKE_PY) are made up: they test the readers and the definition, not a
// release.
//   lookcodeUnits    (firmware-free) looksWith (a LOOKS.BIN with record bytes changed and its CRC-32 recomputed, read
//                    back by test_looks' reader); the readers of their source on texts the test writes, with their
//                    refusals: theirBlock (the code block's entry offsets, the texture gains and offsets by Grain, the
//                    halation call's frame), theirLayout (the state word, the pool and the two pointers in their heap
//                    block), halationNumbers; halate, their halation pass's definition, on frames the test draws: a
//                    dark frame and a frame of four cells are left alone, a bright spot glows, more at level 5 than
//                    at 1, luma never falls, Cb falls and Cr rises, and nothing outside the row's pixels changes
//   lookcodeSession  (E147; needs OM_CADUCEUS, else not run and not counted) the release releases/$OM_CADUCEUS_RELEASE
//                    (v0.29 by default) as --patch; no shipped film of v0.29 or v0.29.1 sets Grain (record +51) or
//                    Halation (+57), so the card's LOOKS.BIN is the release's with FILM 1, 2 and 3's Grain set to
//                    Low, Med and High by the test (looksWith), a file their format defines. On the blank camera and
//                    after FILM 20, 1, 2, 3 and 4 are picked in the Picture Mode list:
//                    the work-list site: the builder entered at their hook, stopped where it jumps back or at the
//                      stock texture builder: a film without Grain keeps the job's key 11 and asks for no texture; one
//                      with Grain reaches the builder with the still's resource manager and the key block the stock
//                      set-up makes for Grainy Film; the same site on a job that already holds a texture object: with
//                      Grain the list is picked by Grainy Film II's key and no texture asked for, without it by 11
//                    their set-up entry (the code block's, as their set-up hook calls it after the stock set-up) on a
//                      job that holds a texture object, then the request configuration's selector call at their hook:
//                      combiner 1, the stock attach's stage 0x0100 and the object's 19 words in the request; without
//                      Grain the stock selector's answer and an untouched request
//                    the combiner set-up whole: with Grain combiner 1's register image with COLOR's chroma gains kept
//                      and the texture's gain and Y offset their source's table gives for the film's Grain; without it
//                      the image of the blank camera; Grainy Film II's key on a job of no film gives the stock combiner
//                      1 (gain 1024, chroma gains 1024 and 0), which no Grain level's image equals
//                    halation: hl_run, found as the one call of its frame in their code block, called on frames in the
//                      scratch at their buffer-record layout: the bytes after the call against halate at the same
//                      level (their code against their own definition); a glowing frame at levels 1 and 5, one with a
//                      pitch wider than the row, one of four cell rows whose glow fades down the rows, a frame too
//                      bright (left alone), a dark one, levels 0 and 6 (refused); the cache flush hl_run makes is the
//                      patch's own (H-PATCHFLUSH). The lab's limits, as controls: a record whose bus address is outside
//                      main DRAM goes through the firmware's window mapper, whose own flush the lab does not list
//                      (that call is refused, naming the stock caller, and the session goes on); one in the bus
//                      window's present segment is read through the window's cached view, which the lab does not map
//                      (an access fault)
//                    Pokes: only the calls' writes into their own scratch, put back. What the called code wrote stays,
//                    as after any call: their state bytes in their code block (the texture flag, the request and the
//                    context they remember, which point into the scratch) are left as the last call set them, and the
//                    two controls end inside their pass, before it frees its three blocks. No shot follows them here.
//   node emu/test/test_lookcode.mjs [--units] [--session]   (OM_EMU_MODEL=E147 OM_CADUCEUS=CHECKOUT for the session)
//
// E147 facts used (D, the stock block; notation; run-time = notation + 0x10021020): the work-list builder 0x50497cd7
// keeps the still's context S at (4,sp) and the address of S+10276 (the job's pointer) in d3; at 0x50497d71 it reads
// the job's key (job+5352) into d2 (`mov d3,a0; mov (a0),a0; mov (5352,a0),d2`, the 8 bytes their hook replaces) and
// goes on at 0x50497d79 to pick the list by it. The cached texture builder 0x504ac901 (a0 = the resource manager, the
// word at S+10280; a1 = a 6-byte key: the still parameters' u16 at +40 and byte at +44, the answer of 0x504967db for
// that u16 and the byte at +55, that byte, 0) is what the stock set-up 0x504987bb calls at 0x504989d5 for Grainy Film;
// a miss builds through 0x504ae099. The request configuration 0x504745cd (frame [d2,a2],12; a2 = the address of the
// context's pointer) calls the combiner selector 0x5050bf19 at 0x504745d1 with a0 = the context C (C+4 the request R,
// C+8 the register image, C+48 the key). The stock attach 0x5049b0af (a0 = S, a1 = R) copies 19 words from the
// texture object (the word at job+8324) +8 to R+780 for a request of kind 0 (R+16), adds the object's +108 masked by
// job+8312 to the first two, and sets R+12 = 0x0100. The combiner set-up 0x504e3b0b (frame [d2,d3,a2,a3],28) calls the
// selector at 0x504e3b3d and fills the register image (C+8) from its +7988: its default case writes
// +4 = 0x00200000, +96 = 0x04000400, +100 = 1024, +148 = 0x04000400; combiner 1's +4 = 0x00200001, +8 = 3822,
// +96 = 1024, +100 = 0, +148 = 1024 and at 0x504e43ac +152 = 0 before its ret (the 7 bytes their last hook replaces).
// The stock firmware's own grain is elsewhere in the same set-up: the level is the request's byte +1751 (1..3), the gain
// a u16 table's entry stored at the image's +148, the seed a word with bit 31 set at +188. The window mapper
// 0x5004fff8 calls the cache flush 0x5004fe49 at 0x5005002b (return 0x50050030).
// Their source (firmware/src/xblock.s, editor.s, editor.ld, firmware/halation.py at the release's tag, D): xb_wl (the
// work-list hook's entry) and xb_su (the set-up's) share xb_tex: a COLOR job (key 11) whose slot has Grain (+53, the
// record's +51) and no texture yet asks the stock builder for one, stores it at job+8324 and sets their flag; with a
// texture already there it only sets the flag. xb_dev (the request configuration's hook) attaches the texture to the
// first kind-0 COLOR request with output 0x1000 (R+14) and no effect (R+1756) through the stock attach and answers
// combiner 1; xb_sel2 answers 1 again inside the set-up and xb_c1e, at its end, puts back +96 = 0x04000400 and
// +100 = 1024 and stores the texture's gain at +148 and the Y offset in the low half of +180, both by Grain from
// xb_tgain and xb_tbias. hl_run (a0 = a buffer record: +0 the bus address, +4 0, +16 the format 0x0c02, +18 the row
// pitch in pixels, +20 the width, +22 the height; d0 = the level 1..5) works on YCbYCr 4:2:2 rows; a bus address in
// 0xa0000000..0xb7ffffff is used as it is; any other through the bus window: as it stands when the window register's
// top byte (0x98100058 on CPU 0) is the address's segment, else after the firmware's window mapper, and in both cases
// by the window's cached view, 0x40000000 below it. Its three blocks come from the firmware's allocator for the
// uncached pools (0x50003048, freed by 0x5000307a), which runs as it is: the lab's S-HEAP stands in for the other
// one (0x50002fc6).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readLooks, LOOKS_SIZE } from './test_looks.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

// ---- a LOOKS.BIN of the test's ---------------------------------------------------------------------------------------
// bytes (a LOOKS.BIN) with record bytes changed: edits [[film j (0..19), record offset (0..63), value (s8)], ...]; the
// CRC-32 of bytes 12.. recomputed, as their docs/FORMATS.md defines the file
export function looksWith(bytes, edits) {
  const b = Uint8Array.from(bytes);
  if (b.length !== LOOKS_SIZE) throw new Error(`looksWith: ${b.length} bytes, not ${LOOKS_SIZE}`);
  for (const [j, off, v] of edits) {
    if (!(Number.isInteger(j) && j >= 0 && j < 20 && Number.isInteger(off) && off >= 0 && off < 64 && Number.isInteger(v) && v >= -128 && v <= 127)) throw new Error(`looksWith: no film ${j} byte +${off} value ${v}`);
    b[32 + 64 * j + off] = v & 0xff;
  }
  new DataView(b.buffer).setUint32(8, zlib.crc32(b.subarray(12)) >>> 0, true);
  return b;
}

// ---- their source's numbers -----------------------------------------------------------------------------------------
// xblock.s text -> {entries: {name: offset in the code block}, tgain: [3], tbias: [3] (u16), hlFrame: [mask, size]};
// throws when a part is not where and as their source has it
export function theirBlock(src) {
  const lines = String(src).split('\n'), at = (label) => { const i = lines.findIndex((l) => l.startsWith(`${label}:`)); if (i < 0) throw new Error(`their source: no ${label}:`); return i; };
  const entries = {};
  let n = 0;
  for (const l of lines.slice(at('xb_base') + 1, at('xb_nrel'))) { const m = /^\s*jmp\s+(\w+)/.exec(l); if (m) entries[m[1]] = 8 * n++; }
  for (const name of ['xb_su', 'xb_wl']) if (!(name in entries)) throw new Error(`their source: no entry ${name} between xb_base and xb_nrel`);
  const hwords = (label) => {
    const i = at(label), m = /^\s*\.hword\s+(.+?)\s*(?:\/\*.*)?$/.exec(lines.slice(i + 1, i + 6).find((l) => /^\s*\.hword\b/.test(l)) ?? '');   // a label's comment may go on below it
    const v = m ? m[1].split(',').map((x) => /^\s*(-?\d+)(?:\s*&\s*0xffff)?\s*$/.exec(x)) : [];
    if (v.length !== 3 || v.some((x) => !x)) throw new Error(`their source: ${label} is not three .hword values`);
    return v.map((x) => Number(x[1]) & 0xffff);
  };
  const h = /^\s*call\s+HL_RUN,\[d2,d3,a2,a3\],(\d+)/m.exec(src);
  if (!h) throw new Error('their source: no call HL_RUN,[d2,d3,a2,a3],N');
  return { entries, tgain: hwords('xb_tgain'), tbias: hwords('xb_tbias'), hlFrame: [0xf0, Number(h[1])] };
}
// editor.ld text -> {STATE, POOL, XPTR, GPTR}: their state word's address, their heap pool's base and the offsets of
// the code block's and the guide buffer's pointers in their heap block
export function theirLayout(ld) {
  const out = {};
  for (const name of ['STATE', 'POOL', 'XPTR', 'GPTR']) {
    const m = new RegExp(`^${name}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)\\s*;`, 'm').exec(ld);
    if (!m) throw new Error(`their source: no ${name} = N;`);
    out[name] = Number(m[1]);
  }
  return out;
}
// firmware/halation.py text -> their halation numbers
export function halationNumbers(py) {
  const one = (name) => { const m = new RegExp(`^${name}\\s*=\\s*(-?\\d+)\\b`, 'm').exec(py); if (!m) throw new Error(`their source: no ${name} = N`); return Number(m[1]); };
  const tuple = (names) => {
    const m = new RegExp(`^${names.join(',\\s*')}\\s*=\\s*([-0-9, ]+?)\\s*(?:#.*)?$`, 'm').exec(py);
    const v = m ? m[1].split(',').map((x) => Number(x.trim())) : [];
    if (v.length !== names.length || v.some((x) => !Number.isInteger(x))) throw new Error(`their source: no ${names.join(', ')} = ...`);
    return v;
  };
  const g = /^GMAX\s*=\s*\{([^}]*)\}/m.exec(py), GMAX = {};
  for (const part of g ? g[1].split(',') : []) { const [k, v] = part.split(':').map((x) => Number(x.trim())); GMAX[k] = v; }
  if ([1, 2, 3, 4, 5].some((k) => !Number.isInteger(GMAX[k]))) throw new Error('their source: GMAX is not levels 1..5');
  const [KY, KCB, KCR] = tuple(['KY', 'KCB', 'KCR']), [COV_U, COV_LO, COV_HI] = tuple(['COV_U', 'COV_LO', 'COV_HI']);
  return { T: one('T'), K: one('K'), BLUR: one('BLUR'), BLUR2: one('BLUR2'), MIX: one('MIX'), WMUL: one('WMUL'), GMAX, KY, KCB, KCR, COV_U, COV_LO, COV_HI };
}

// ---- their halation pass's definition --------------------------------------------------------------------------------
// (research/halation/model.py's steps, D: the threshold excess of every second row's first luma of a pair summed into
// 64 x 64 pixel cells with the cells' mean luma, a [1 2 1] / 4 blur BLUR and BLUR2 times across and down mixed by MIX,
// a soft curve by two tables, a coverage rule that fades the pass out when many cells glow, then per row the glow and
// the chroma weight interpolated between cell rows and cell centres and added to Y, Cb and Cr.) buf: YCbYCr 4:2:2
// (Y0 Cb Y1 Cr a pair), W pixels (a multiple of 4), H rows, pitch bytes from row to row, level 1..5, N their numbers
// -> {state: 'off' (too much of the frame glows) | 'none' (no glow) | 'done', out: the buffer after the pass, n: the
// glowing cells}
const blur1 = (a, GW, GH, down) => a.map((x, k) => {
  const r = Math.floor(k / GW), c = k % GW, lo = down ? Math.max(0, r - 1) * GW + c : r * GW + Math.max(0, c - 1), hi = down ? Math.min(GH - 1, r + 1) * GW + c : r * GW + Math.min(GW - 1, c + 1);
  return (a[lo] + 2 * x + a[hi] + 2) >> 2;
});
const blurN = (a, GW, GH, passes) => { let x = a; for (const down of [false, true]) for (let i = 0; i < passes; i++) x = blur1(x, GW, GH, down); return x; };
export function halate(buf, W, H, pitch, level, N) {
  const out = Uint8Array.from(buf), GW = (W + 63) >> 6, GH = (H + 63) >> 6, cells = GW * GH, pairs = W >> 1;
  const E = new Array(cells).fill(0), Q = new Array(cells).fill(0), S = new Array(cells).fill(0);
  for (let y = 0; y < H; y += 2) for (let p = 0; p < pairs; p++) {
    const v = buf[y * pitch + 4 * p], c = (y >> 6) * GW + (p >> 5);
    if (v > N.T) E[c] += v - N.T;
    Q[c] += v >> 2; S[c] += 1;
  }
  const tight = blurN(E, GW, GH, N.BLUR), broad = blurN(E, GW, GH, N.BLUR2);
  const curve = (v) => Math.floor((255 * v + ((v + N.K) >> 1)) / (v + N.K));
  const u = tight.map((t, i) => { const v = (t * (256 - N.MIX) + broad[i] * N.MIX + 128) >> 8; return v < 1024 ? curve(4 * Math.min(v >> 2, 255) + 2) : (v >> 8) >= 4 ? curve(256 * Math.min(v >> 8, 255) + 128) : 0; });
  const n = u.filter((x) => x >= N.COV_U).length, nLo = Math.floor(cells * N.COV_LO / 100), nHi = Math.floor(cells * N.COV_HI / 100);
  if (n >= nHi) return { state: 'off', out, n };
  const sc = n <= nLo ? 256 : Math.floor(((nHi - n) * 256) / (nHi - nLo));
  const G = u.map((x) => (((x * N.GMAX[level]) >> 8) * sc) >> 8), Wc = Q.map((q, i) => Math.min(255, N.WMUL * (255 - Math.floor((4 * q) / S[i]))));
  if (!G.some((x) => x)) return { state: 'none', out, n };
  const rows = (A, y) => {                       // a grid's line for row y: between the two nearest cell rows
    const f = y - 32, line = (r) => A.slice(r * GW, r * GW + GW);
    if (f < 0) return line(0);
    const r0 = f >> 6, wy = f & 63;
    if (r0 >= GH - 1) return line(GH - 1);
    const a = line(r0), b = line(r0 + 1);
    return a.map((x, i) => (x * (64 - wy) + b[i] * wy + 32) >> 6);
  };
  const across = (line, p) => {                  // a line's value for pair p: between the two nearest cell centres
    if (p < 16) return line[0];
    const k = Math.min((p - 16) >> 5, GW - 1), i = (p - 16) & 31;
    return k >= GW - 1 ? line[GW - 1] : (line[k] * (32 - i) + line[k + 1] * i + 16) >> 5;
  };
  const clip = (v) => Math.min(255, Math.max(0, v));
  for (let y = 0; y < H; y++) {
    const gl = rows(G, y);
    if (!gl.some((x) => x)) continue;
    const wl = rows(Wc, y);
    for (let p = 0; p < pairs; p++) {
      const g = across(gl, p), c = (g * across(wl, p)) >> 8, o = y * pitch + 4 * p;
      out[o] += ((255 - out[o]) * g * N.KY) >> 16;
      out[o + 2] += ((255 - out[o + 2]) * g * N.KY) >> 16;
      out[o + 1] = clip(out[o + 1] + ((c * N.KCB) >> 8));
      out[o + 3] = clip(out[o + 3] + ((c * N.KCR) >> 8));
    }
  }
  return { state: 'done', out, n };
}
// a frame of the test's: W x H pixels at pitch bytes a row (the bytes past a row's pixels 0x55), a dim textured ground
// with a chroma that varies, and bright boxes [[x, y, w, h, Y], ...]
export function frame(W, H, pitch, boxes) {
  const b = new Uint8Array(pitch * H).fill(0x55);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = boxes.find(([sx, sy, sw, sh]) => x >= sx && x < sx + sw && y >= sy && y < sy + sh);
    b[y * pitch + 2 * x] = s ? s[4] : 60 + ((x * 7 + y * 13) % 29);
    b[y * pitch + 2 * x + 1] = 118 + (((x >> 1) * 5 + y * 3) % 21);
  }
  return b;
}

// ---- firmware-free ---------------------------------------------------------------------------------------------------
const FAKE_BLOCK = ['_start:', 'xb_base:', ' jmp xb_reloc   /* +0 */', ' .balign 8', ' jmp xb_cap', ' .balign 8', ' jmp xb_su      /* +16 */', ' .balign 8', ' jmp xb_wl', ' .balign 8', 'xb_nrel:', ' .long 0',
  'xb_gs:', ' call HL_RUN,[d2,d3,a2,a3],100', 'xb_tgain:                 /* Low / Med / High', '                              (a comment line) */', ' .hword 400, 800, 1200', 'xb_tbias:', ' .hword -40 & 0xffff, -80 & 0xffff, -120 & 0xffff'].join('\n');
const FAKE_LD = 'SECTIONS { }\nSTATE         = 0x62000016;\nPOOL          = 0xa2800000;   /* the pool */\nGPTR          = 600;\nXPTR          = 596;\n';
const FAKE_PY = ['T = 190   # threshold', 'K = 800', 'BLUR = 2', 'BLUR2 = 8', 'MIX = 96', 'GMAX = {1: 40, 2: 80, 3: 120, 4: 160, 5: 200}   # strength', 'KY, KCB, KCR = 48, -32, 56   # the tint', 'WMUL = 3', 'COV_U, COV_LO, COV_HI = 30, 10, 25  # cover'].join('\n');
export function lookcodeUnits() {
  const t = tester(), { ok } = t;
  // looksWith
  const looks = new Uint8Array(LOOKS_SIZE), dv = new DataView(looks.buffer);
  looks.set([0x4f, 0x4d, 0x33, 0x50]); dv.setUint32(4, LOOKS_SIZE, true); dv.setUint16(12, 1, true); dv.setUint16(14, 20, true);
  for (let i = 32; i < 1312; i++) looks[i] = (i * 7) % 5;
  const plain = looksWith(looks, []), edited = looksWith(looks, [[2, 51, 3], [19, 57, -2]]);
  const L = readLooks(edited);
  ok(L.films[2].record[51] === 3 && L.films[19].record[57] === -2 && L.films[2].record[50] === readLooks(plain).films[2].record[50], `looksWith: the two bytes changed, the file read back by the reader (its CRC holds): ${L.films[2].record[51]} ${L.films[19].record[57]}`);
  ok(edited.filter((v, i) => v !== plain[i] && (i < 8 || i >= 12)).length === 2 && looks[8] === 0, 'looksWith: nothing else changed but the CRC word; the input left as it was');
  ok(thrown(() => looksWith(looks, [[20, 51, 1]])) && thrown(() => looksWith(looks, [[0, 64, 1]])) && thrown(() => looksWith(looks.subarray(1), [])), 'looksWith: a film or byte the file does not have, and a file of another size, refused');
  // their source's readers
  const B = theirBlock(FAKE_BLOCK);
  ok(B.entries.xb_su === 16 && B.entries.xb_wl === 24 && B.entries.xb_reloc === 0 && B.tgain.join() === '400,800,1200' && B.tbias.join() === [65496, 65456, 65416].join() && B.hlFrame.join() === '240,100', `theirBlock: ${JSON.stringify(B)}`);
  const refused = (f, re, what) => { const e = thrown(f); ok(e && re.test(e.message), `${what}: ${e?.message ?? 'taken'}`); };
  refused(() => theirBlock(FAKE_BLOCK.replace(' jmp xb_su ', ' jmp xb_sx ')), /no entry xb_su/, 'a block without the set-up entry refused');
  refused(() => theirBlock(FAKE_BLOCK.replace('400, 800, 1200', '400, 800')), /xb_tgain is not three/, 'a gain table of two refused');
  refused(() => theirBlock(FAKE_BLOCK.replace('HL_RUN,[d2,d3,a2,a3]', 'HL_RUN,[d2,d3]')), /no call HL_RUN/, 'a halation call of another shape refused');
  refused(() => theirBlock(FAKE_BLOCK.replace('xb_nrel:', 'xb_n:')), /no xb_nrel/, 'a block without the entry table\'s end refused');
  const Y = theirLayout(FAKE_LD);
  ok(Y.STATE === 0x62000016 && Y.POOL === 0xa2800000 && Y.XPTR === 596 && Y.GPTR === 600, `theirLayout: ${JSON.stringify(Y)}`);
  refused(() => theirLayout(FAKE_LD.replace('XPTR ', 'XPTQ ')), /no XPTR/, 'a layout without the code block\'s pointer refused');
  const N = halationNumbers(FAKE_PY);
  ok(N.T === 190 && N.K === 800 && N.GMAX[5] === 200 && N.KCB === -32 && N.COV_HI === 25 && N.BLUR2 === 8, `halationNumbers: ${JSON.stringify(N)}`);
  refused(() => halationNumbers(FAKE_PY.replace('5: 200', '6: 200')), /GMAX/, 'strengths other than 1..5 refused');
  refused(() => halationNumbers(FAKE_PY.replace('KY, KCB, KCR = 48, -32, 56', 'KY, KCB = 48, -32')), /no KY, KCB, KCR/, 'a tint of two numbers refused');
  // halate
  const W = 1984, H = 64, pitch = 2 * W + 16, same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const dark = frame(W, H, pitch, []), spot = frame(W, H, pitch, [[8, 20, 24, 24, 255]]);
  const d0 = halate(dark, W, H, pitch, 5, N), s1 = halate(spot, W, H, pitch, 1, N), s5 = halate(spot, W, H, pitch, 5, N);
  ok(d0.state === 'none' && same(d0.out, dark), `halate: a dark frame has no glow and stays as it is: ${d0.state}`);
  const changed = (a, b) => a.reduce((n, v, i) => n + (v !== b[i]), 0);
  ok(s1.state === 'done' && s5.state === 'done' && changed(s5.out, spot) > changed(s1.out, spot) && changed(s1.out, spot) > 0, `halate: a bright spot glows, more at level 5 than at 1: ${s1.state} ${changed(s1.out, spot)}, ${s5.state} ${changed(s5.out, spot)} bytes`);
  const dir = [0, 0, 0, 0];
  let stray = 0;
  for (let i = 0; i < spot.length; i++) {
    const col = i % pitch, k = col % 4, d = s5.out[i] - spot[i];
    if (col >= 2 * W) { stray += d !== 0; continue; }
    if (k === 0 || k === 2) dir[0] += d < 0; else if (k === 1) dir[1] += d > 0; else dir[2] += d < 0;
  }
  ok(dir[0] === 0 && dir[1] === 0 && dir[2] === 0 && stray === 0, `halate: luma never falls, Cb never rises, Cr never falls, and the bytes past a row's pixels stay: ${dir.slice(0, 3)} ${stray}`);
  const four = halate(frame(128, 128, 256, [[10, 10, 8, 8, 255]]), 128, 128, 256, 5, N), bright = halate(frame(W, H, pitch, [[0, 0, W, 32, 250]]), W, H, pitch, 5, N);
  ok(four.state === 'off' && bright.state === 'off' && same(bright.out, frame(W, H, pitch, [[0, 0, W, 32, 250]])), `halate: a frame of four cells and a frame half bright are left alone (the coverage rule): ${four.state} ${bright.state}`);
  ok(!same(halate(spot, W, H, pitch, 5, { ...N, KCB: N.KCR, KCR: N.KCB }).out, s5.out), 'halate: the Cb and Cr tints swapped give another frame');
  return t;
}

// ---- E147 with a caduceus-om3 release --------------------------------------------------------------------------------
const WLB = 0x50497cd7, WL = 0x50497d71, WL_BACK = 0x50497d79, TXGET = 0x504ac901, TXPF = 0x504967db, CGET = 0x50042360, RT = 0x10021020;
const WINREG = 0x98100058, CFG_FN = 0x504745cd, CL = 0x504745d1, CL_BACK = 0x504745d8, COMB = 0x504e3b0b, SEL2 = 0x504e3b3d, C1E = 0x504e43ac, WINMAP_FLUSH_RETURN = 0x50050030;
// the job in the calls' scratch: the still's context S, its job, the request R with its context C (PC holds C's
// address), the register image, a texture object and a word for the resource manager
const JOB = 0x3000, C = 0x5700, PC = 0x57f0, R = 0x5800, CFG = 0x6000, TEX = 0x8100, RES = 0x8200, SIZE = 0x8300, IMG = 7988;
const GF2 = 0x01020068;                            // Grainy Film II's key (the stock selector's and work list's)
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const le32 = (hex, off = 0) => parseInt(hex.slice(2 * off, 2 * off + 8).match(/../g).reverse().join(''), 16) >>> 0;
const le16 = (hex, off = 0) => parseInt(hex.slice(2 * off + 2, 2 * off + 4) + hex.slice(2 * off, 2 * off + 2), 16);
const hex = (bytes) => Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
const TEX_WORDS = hex(Array.from({ length: 76 }, (_, i) => 0x40 + i));   // the object's 19 words, a pattern
// the job's bytes: tex, a texture object already at job+8324; key and stage, the context's key and the request's +12
const job = ({ tex = false, key = 11, stage = 0 } = {}) => [
  ['scratch+12', '00000b00'], ['scratch+44', '0010'],                   // S+4, the still's parameters: +8 COLOR's key, +40 the flags a COLOR still has (X)
  ['scratch+10276', `=scratch+${JOB}`], ['scratch+10280', `=scratch+${RES}`],
  [`scratch+${JOB + 5352}`, '=11'], ...(tex ? [[`scratch+${JOB + 8324}`, `=scratch+${TEX}`]] : []),
  [`scratch+${TEX + 8}`, TEX_WORDS],
  [`scratch+${PC}`, `=scratch+${C}`], [`scratch+${C + 4}`, `=scratch+${R}`], [`scratch+${C + 8}`, `=scratch+${CFG}`], [`scratch+${C + 48}`, `=${key}`],
  [`scratch+${R + 8}`, '00000b00'], [`scratch+${R + 12}`, hex([stage & 0xff, stage >> 8])], [`scratch+${R + 14}`, '0010']];
// the register image's words the checks name
const image = (x) => ({ select: le32(x, 4), w8: le32(x, 8), chroma: [le32(x, 96), le32(x, 100)], gain: le32(x, 148), w152: le32(x, 152), bias: le16(x, 180), seed: le32(x, 188) });

// a file of their source for release rel: the tag's (git show) when the checkout has it, else the working tree's
async function theirSource(root, rel, file) {
  const { spawnSync } = await import('node:child_process');
  const g = spawnSync('git', ['-C', root, 'show', `${rel}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (g.status === 0) return { text: g.stdout, from: `tag ${rel}` };
  return { text: fs.readFileSync(path.join(root, file), 'utf8'), from: 'the working tree (no tag)' };
}

export async function lookcodeSession() {
  const t = tester(), { ok } = t;
  const root = process.env.OM_CADUCEUS;
  if (!root) return Object.assign(t, { notRun: 'OM_CADUCEUS is not set (a caduceus-om3 checkout)' });
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_lookcode: the session needs OM_EMU_MODEL=E147, not ${MODEL}`); return t; }
  const rel = process.env.OM_CADUCEUS_RELEASE || 'v0.29';
  t.release = rel;
  const Rdir = path.join(root, 'releases', rel), patchFile = path.join(Rdir, 'patch.json'), looksFile = path.join(Rdir, 'LOOKS.BIN');
  if (!fs.existsSync(patchFile) || !fs.existsSync(looksFile)) { ok(false, `test_lookcode: ${Rdir} has no patch.json and LOOKS.BIN`); return t; }
  let B, Y, N;
  try {
    const xs = await theirSource(root, rel, 'firmware/src/xblock.s');
    t.source = xs.from;
    B = theirBlock(xs.text);
    Y = theirLayout((await theirSource(root, rel, 'firmware/src/editor.ld')).text);
    N = halationNumbers((await theirSource(root, rel, 'firmware/halation.py')).text);
  } catch (e) { ok(false, `${e.message} (${t.source ?? rel})`); return t; }
  const shipped = readLooks(fs.readFileSync(looksFile));
  ok(shipped.films.every((f) => f.record[51] === 0 && f.record[57] === 0), `the release's films set no Grain and no Halation (the test sets them): ${JSON.stringify(shipped.films.map((f) => [f.record[51], f.record[57]]).filter(([g, h]) => g || h))}`);
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-lookcode-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const P = (...p) => path.join(tmp, ...p);
  // FILM 1, 2 and 3 with Grain Low, Med and High; the other films as the release has them
  fs.writeFileSync(P('LOOKS.BIN'), looksWith(fs.readFileSync(looksFile), [[0, 51, 1], [1, 51, 2], [2, 51, 3]]));
  const looks = readLooks(fs.readFileSync(P('LOOKS.BIN')));
  const { spawnSync } = await import('node:child_process');
  const nc = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', P('card.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
  ok(nc.status === 0, `card.mjs new: rc ${nc.status} ${nc.stderr.slice(0, 300)}`);
  const { loadImage } = await import('../checks/lib/env.mjs');
  const stock = loadImage();
  const { openSession } = await import('../host/session.mjs');
  const said = [];
  const s = await openSession({ model: 'E147', patch: [patchFile], card: P('card.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${P('LOOKS.BIN')}`], nvram: P('nv.json'), out: P('out'), say: (l) => said.push(l) });
  t.values = {};
  try {
    let failed = null;
    const st = (tok) => { if (failed) return {}; const r = s.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `step ${r.step} ${failed}`); } return r; };
    const run = (text) => text.split(' ').forEach(st);
    const rd = (a, n) => st(`read:${h8(a)}:${n}`).hex ?? '';
    // one call through input(): the op's answer; a refusal or failure is a failed check (and null) unless may is set
    const call = (what, q, may = false) => {
      if (failed) return null;
      const r = s.input({ type: 'debug', op: 'call', restore: true, limit: 5000000, ...q });
      const d = r.debug ?? r;
      if (!d.ok && !may) { failed = `${what}: ${d.error?.message ?? JSON.stringify(d).slice(0, 300)}`; ok(false, failed); return null; }
      return d;
    };
    run('wait:1500');
    // the four hook sites hold the release's instructions
    const sites = [['the work list', WL, 8], ['the request configuration', CL, 7], ['the set-up\'s selector call', SEL2, 7], ['combiner 1\'s end', C1E, 7]];
    const differ = sites.map(([, pc, n]) => rd(pc + RT, n) !== hex(stock.subarray(pc - 0x50000000, pc - 0x50000000 + n)));
    ok(differ.every(Boolean), `the hook sites are patched: ${sites.map(([w, pc], i) => `${w} ${h8(pc)} ${differ[i] ? 'theirs' : 'stock'}`).join(', ')}`);
    run('s1 wait:1200');
    // their heap block, the code block in it and the halation pass the block calls
    const state = le16(rd(Y.STATE, 2)), heap = (Y.POOL + state - 1) >>> 0, code = le32(rd(heap + Y.XPTR, 4)), guides = le32(rd(heap + Y.GPTR, 4));
    const end = (guides + le32(rd(guides + 4, 4))) >>> 0, foot = rd(end - 16, 16), codeLen = le32(foot, 8);
    ok(state !== 0 && code !== 0 && code === (end - le32(foot, 4)) >>> 0 && codeLen > 0 && codeLen < 0x10000, `their code block: ${h8(code)}, ${codeLen} bytes (the guide buffer's footer gives ${h8(end - le32(foot, 4))})`);
    const blk = Uint8Array.from((rd(code, codeLen).match(/../g) ?? []).map((x) => parseInt(x, 16))), dv = new DataView(blk.buffer), hl = [];
    for (let i = 0; i + 7 <= blk.length; i++) if (blk[i] === 0xdd && blk[i + 5] === B.hlFrame[0] && blk[i + 6] === B.hlFrame[1]) hl.push((code + i + dv.getInt32(i + 1, true)) >>> 0);
    ok(hl.length === 1, `one call with the frame [d2,d3,a2,a3],${B.hlFrame[1]} in their code block (hl_run's): ${hl.map(h8)}`);
    const HL = hl[0] ?? 0;
    t.values.hl_run = h8(HL - RT);

    // ---- Grain's camera route ----
    const txpf = call('the texture profile helper', { fn: TXPF, regs: { d0: 0x1000, d1: 0 } });
    const wantKey = `0010${'00'}${hex([Number(txpf?.regs.d0 ?? 0) & 0xff])}0000`;
    const route = (tag, grain) => {
      const o = { tag, grain };
      // the work-list builder entered at their hook: S at (4,sp), d3 the address of the job's pointer
      const a = call(`${tag}: the work-list site`, { fn: WLB, frame: [0, 0], entry: WL, regs: { d3: 'scratch+10276' }, stack: ['scratch'], stops: [WL_BACK, TXGET], scratch: SIZE, mem: job(), read: [[`scratch+${JOB + 8324}`, 4]] });
      if (!a) return null;
      const base = parseInt(a.scratch, 16);
      o.list = { stop: a.stop?.notation, key: Number(a.regs.d2), a0: Number(a.regs.a0), block: a.stop?.notation === h8(TXGET) ? rd(Number(a.regs.a1), 6) : null, res: base + RES, caller: Number(a.regs.mdr) };
      // the same site on a job that already holds a texture object: the key the builder picks its list by
      const a2 = call(`${tag}: the work-list site, a texture on the job`, { fn: WLB, frame: [0, 0], entry: WL, regs: { d3: 'scratch+10276' }, stack: ['scratch'], stops: [WL_BACK, TXGET], scratch: SIZE, mem: job({ tex: true }) });
      if (!a2) return null;
      o.list.withTexture = { stop: a2.stop?.notation, key: Number(a2.regs.d2) >>> 0 };
      // their set-up entry, on a job that holds a texture object when the film asked for one
      const tex = o.list.block !== null;
      const b = call(`${tag}: their set-up entry`, { fn: code + B.entries.xb_su, space: 'runtime', frame: [0, 0], regs: { a0: 'scratch' }, scratch: SIZE, mem: job({ tex }) });
      // the request configuration's selector call, at their hook
      const c = call(`${tag}: the request configuration site`, { fn: CFG_FN, frame: [0xa0, 12], entry: CL, regs: { a0: `scratch+${C}`, a2: `scratch+${PC}` }, stops: [CL_BACK], scratch: SIZE, mem: job({ tex }),
        read: [[`scratch+${R + 12}`, 2], [`scratch+${R + 780}`, 76]] });
      if (!b || !c) return null;
      ok(b.end === 'return' && c.end === 'stop' && c.stop?.notation === h8(CL_BACK), `${tag}: their set-up entry returns and the selector call comes back to ${h8(CL_BACK)}: ${b.end}, ${c.end} ${c.stop?.notation}`);
      o.config = { combiner: Number(c.regs.d0) & 0xff, stage: le16(c.reads[0].hex), attached: c.reads[1].hex };
      // the combiner set-up whole, on the request as the configuration left it
      const d = call(`${tag}: the combiner set-up`, { fn: COMB, regs: { a0: `scratch+${C}` }, scratch: SIZE, mem: [...job({ tex }), [`scratch+${R + 12}`, c.reads[0].hex]], read: [[`scratch+${CFG + IMG}`, 200]] });
      if (!d) return null;
      ok(d.end === 'return' && [a2, b, c, d].every((x) => x.scratch === a.scratch), `${tag}: the combiner set-up returns, and the five calls had one scratch (their state holds its addresses): ${d.end} ${[a, a2, b, c, d].map((x) => x.scratch)}`);
      o.image = image(d.reads[0].hex);
      o.raw = d.reads[0].hex;
      return o;
    };
    const DEFAULT = { select: 0x00200000, chroma: [0x04000400, 1024], gain: 0x04000400 };
    const seen = [];
    let blank = null;
    for (const [j, keys] of [[null, ''], [19, 'ok ok left ok'], [0, 'ok ok right right right right right ok'], [1, 'ok ok right ok'], [2, 'ok ok right ok'], [3, 'ok ok right ok']]) {
      if (keys) run(keys);
      const film = j === null ? null : looks.films[j], grain = film ? film.record[51] : 0, tag = j === null ? 'the blank camera' : `FILM ${j + 1} (${film.name}, Grain ${grain})`;
      if (film) {
        const k = Number(call(`${tag}: the effective COLOR profile`, { fn: CGET, regs: { d0: 63153, d1: 0, a0: 0 } })?.regs.d0), slot = parseInt(rd(heap + 32 + 64 * (k - 1) + 53, 1), 16);
        ok(k === Math.floor(j / 5) + 1 && slot === grain, `${tag}: COLOR ${k}'s slot holds the film's Grain: ${slot} (want COLOR ${Math.floor(j / 5) + 1}, ${grain})`);
      }
      const o = route(tag, grain);
      if (!o) break;
      if (j === null) blank = o;
      if (grain === 0) {
        ok(o.list.stop === h8(WL_BACK) && o.list.key === 11 && o.list.withTexture.stop === h8(WL_BACK) && o.list.withTexture.key === 11,
          `${tag}: the work-list site keeps the job's key 11 and asks for no texture, also with a texture on the job: ${o.list.stop} key ${o.list.key}; ${o.list.withTexture.stop} key ${h8(o.list.withTexture.key)}`);
        ok(o.config.stage === 0 && /^0+$/.test(o.config.attached) && o.config.combiner === blank.config.combiner, `${tag}: the request is left as it was and the selector's answer is the blank camera's: stage ${h8(o.config.stage)}, combiner ${o.config.combiner}`);
        ok(o.raw === blank.raw && o.image.select === DEFAULT.select && o.image.chroma.join() === DEFAULT.chroma.join() && o.image.gain === DEFAULT.gain,
          `${tag}: the combiner set-up's image is the default case's, as on the blank camera: ${JSON.stringify(o.image)}`);
      } else {
        ok(o.list.stop === h8(TXGET) && o.list.a0 === o.list.res && o.list.block === wantKey && o.list.caller >= code && o.list.caller < code + codeLen,
          `${tag}: the work-list site asks the stock texture builder ${h8(TXGET)}, from their code block, with the job's resource manager and Grainy Film's key block: ${o.list.stop} a0 ${h8(o.list.a0)} (want ${h8(o.list.res)}) block ${o.list.block} (want ${wantKey}) from ${h8(o.list.caller)}`);
        ok(o.list.withTexture.stop === h8(WL_BACK) && o.list.withTexture.key === GF2,
          `${tag}: with the texture on the job the work-list site picks the list by Grainy Film II's key ${h8(GF2)} and asks for none again: ${o.list.withTexture.stop} key ${h8(o.list.withTexture.key)}`);
        ok(o.config.combiner === 1 && o.config.stage === 0x0100 && o.config.attached === TEX_WORDS, `${tag}: the configuration attaches the texture (the object's 19 words at the request's +780, stage 0x0100) and answers combiner 1: combiner ${o.config.combiner}, stage ${h8(o.config.stage)}, ${o.config.attached.slice(0, 16)}..`);
        const want = { select: 0x00200001, w8: 3822, chroma: DEFAULT.chroma, gain: B.tgain[grain - 1], w152: 0, bias: B.tbias[grain - 1] };
        const got = { select: o.image.select, w8: o.image.w8, chroma: o.image.chroma, gain: o.image.gain, w152: o.image.w152, bias: o.image.bias };
        ok(JSON.stringify(got) === JSON.stringify(want), `${tag}: combiner 1's image with COLOR's chroma gains and the texture's gain and Y offset for Grain ${grain}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        const other = B.tgain[grain % 3];
        ok(o.image.gain !== other && other !== want.gain, `${tag}: control: the gain is not another Grain's (${other})`);
      }
      seen.push({ j, grain, gain: o.image.gain });
      t.values[tag] = { list: { stop: o.list.stop, key: o.list.key, block: o.list.block, with_texture: h8(o.list.withTexture.key) }, config: { combiner: o.config.combiner, stage: o.config.stage }, image: o.image };
    }
    const gains = seen.filter((x) => x.grain).map((x) => x.gain);
    ok(seen.length === 6 && gains.length === 3 && gains[0] < gains[1] && gains[1] < gains[2] && seen[5].grain === 0 && seen[5].gain === DEFAULT.gain,
      `control: the three Grain levels gave three rising gains, and the film without Grain after them the default again: ${JSON.stringify(seen)}`);
    // the stock combiner 1, by Grainy Film II's key on a job of no film
    const g = call('the combiner set-up under Grainy Film II\'s key', { fn: COMB, regs: { a0: `scratch+${C}` }, scratch: SIZE, mem: job({ key: GF2, stage: 0x0100 }), read: [[`scratch+${CFG + IMG}`, 200]] });
    if (g) {
      const im = image(g.reads[0].hex);
      ok(im.select === 0x00200001 && im.chroma.join() === '1024,0' && im.gain === 1024 && im.bias === 0 && !gains.includes(im.gain), `control: the stock combiner 1 (Grainy Film II's key, no texture state of theirs): gain 1024 and the chroma gains 1024 and 0, which no Grain level's image has: ${JSON.stringify(im)}`);
      t.values['stock combiner 1'] = im;
    }

    // ---- halation on pixels ----
    const record = (bus, memW, W, H) => { const b = new Uint8Array(24), v = new DataView(b.buffer); v.setUint16(16, 0x0c02, true); v.setUint16(18, memW, true); v.setUint16(20, W, true); v.setUint16(22, H, true); return [['scratch', hex(b)], ['scratch', bus]]; };
    const pass = (name, W, H, memW, boxes, level) => {
      const pitch = 2 * memW, img = frame(W, H, pitch, boxes);
      const d = call(`hl_run on ${name}`, { fn: HL, frame: B.hlFrame, regs: { a0: 'scratch', d0: level }, scratch: 64 + img.length, limit: 20000000, mem: [...record('=scratch+64', memW, W, H), ['scratch+64', hex(img)]], read: [['scratch+64', img.length]] });
      if (!d) return null;
      const out = Uint8Array.from(d.reads[0].hex.match(/../g).map((x) => parseInt(x, 16)));
      return { name, level, W, H, pitch, img, out, end: d.end, stubs: d.stubs, flushed: (d.stubs ?? []).filter(([n]) => n === 'K-CFLUSH').reduce((n, [, c]) => n + c, 0), changed: out.reduce((n, v, i) => n + (v !== img[i]), 0) };
    };
    const against = (p, level = p.level) => {
      const want = halate(p.img, p.W, p.H, p.pitch, level, N), i = p.out.findIndex((v, k) => v !== want.out[k]);
      return { state: want.state, n: want.n, first: i < 0 ? null : `row ${Math.floor(i / p.pitch)} byte ${i % p.pitch}: lab ${p.out[i]}, their definition ${want.out[i]}, before ${p.img[i]}` };
    };
    const SPOT = [[8, 20, 24, 24, 255]], runs = [];
    if (HL && !failed) {
      for (const [name, W, H, memW, boxes, level, state] of [['a bright spot, level 1', 1984, 64, 1984, SPOT, 1, 'done'], ['a bright spot, level 5', 1984, 64, 1984, SPOT, 5, 'done'],
        ['a bright spot in rows wider than the frame, level 3', 1920, 64, 1984, SPOT, 3, 'done'], ['a spot in the corner of a frame of four cell rows, level 5', 448, 256, 480, [[20, 8, 8, 8, 255]], 5, 'done'],
        ['a frame too bright, level 3', 1984, 64, 1984, [[900, 16, 40, 32, 250]], 3, 'off'], ['a dark frame, level 3', 512, 248, 512, [], 3, 'none']]) {
        const p = pass(name, W, H, memW, boxes, level);
        if (!p) break;
        const w = against(p);
        ok(p.end === 'return' && w.first === null && w.state === state && (state === 'done') === (p.changed > 0) && p.flushed === 1,
          `hl_run on ${name} (${W} x ${H}, pitch ${p.pitch}): the frame after the call is their definition's (${w.state}, ${w.n} cells glow; want ${state}), ${p.changed} bytes changed, one cache flush: ${p.end}, ${w.first ?? 'equal'}, flushes ${p.flushed}`);
        if (state === 'done') ok(against(p, level === 5 ? 4 : level + 1).first !== null, `hl_run on ${name}: control: the frame is not the definition's at another level`);
        runs.push(p);
        t.values[`hl_run on ${name}`] = { state: w.state, cells: w.n, changed: p.changed, stubs: p.stubs };
      }
      ok(runs.length === 6 && runs[1].changed > runs[0].changed, `control: level 5 changes more of the frame than level 1: ${runs.map((p) => p.changed)}`);
      // pair 50's Cr down the rows of the frame of four cell rows: the glow fades from cell row to cell row
      const tall = runs[3], fade = tall ? [...new Set(Array.from({ length: tall.H }, (_, y) => tall.out[y * tall.pitch + 203] - tall.img[y * tall.pitch + 203]))] : [];
      ok(fade.length > 4, `control: in the frame of four cell rows a column's Cr rises by more than four amounts down the rows (the pass interpolates between cell rows there): ${fade.sort((x, y) => y - x)}`);
      for (const level of [0, 6]) {
        const p = pass(`a bright spot, level ${level}`, 1984, 64, 1984, SPOT, level);
        if (p) ok(p.end === 'return' && p.changed === 0 && p.flushed === 0, `hl_run at level ${level} (their range is 1..5) returns at once: ${p.changed} bytes changed, flushes ${p.flushed}`);
      }
      // a buffer outside main DRAM: the firmware's window mapper flushes the cache itself, a stock caller the lab does not list
      const far = call('hl_run on a buffer outside main DRAM', { fn: HL, frame: B.hlFrame, regs: { a0: 'scratch', d0: 3 }, scratch: 64, limit: 20000000, mem: record('00000096', 64, 64, 64) }, true);
      ok(far && !far.ok && /K-CFLUSH/.test(far.error?.message ?? '') && (far.error.message.includes(h8(WINMAP_FLUSH_RETURN)) || far.error.message.includes(h8(WINMAP_FLUSH_RETURN + RT))),
        `control: a buffer through the bus window is refused at the window mapper's own cache flush (return ${h8(WINMAP_FLUSH_RETURN)}, stock code the lab does not list): ${JSON.stringify(far?.error?.message ?? far?.end)}`);
      const again = pass('a bright spot, level 5, after the refusal', 1984, 64, 1984, SPOT, 5);
      if (again) ok(again.changed === runs[1]?.changed && against(again).first === null, `the session goes on after the refused call: the same frame again, ${again.changed} bytes changed`);
      // a buffer in the bus window's present segment needs no mapper: their pass reads its rows through the window's
      // cached view, 0x40000000 below the window, which the lab does not map
      const seg = parseInt(rd(WINREG, 4).slice(6, 8), 16), bus = ((seg << 27) + 0x07000000) >>> 0, view = (bus - 0x40000000) >>> 0;
      const near = call('hl_run on a buffer in the bus window\'s segment', { fn: HL, frame: B.hlFrame, regs: { a0: 'scratch', d0: 3 }, scratch: 64, limit: 20000000, mem: record(hex([bus & 0xff, (bus >> 8) & 0xff, (bus >> 16) & 0xff, bus >>> 24]), 64, 64, 64) }, true);
      ok(seg === 0x17 && near && !near.ok && near.error?.type === 'CallFault' && near.error.detail?.fault === 2 && (near.error.detail.stderr ?? []).some((l) => l.includes(`address=${h8(view)}`)),
        `control: a buffer in the window's present segment (${h8(seg << 27)}, bus ${h8(bus)}) is read through the window's cached view, which the lab does not map: an access fault at ${h8(view)}: ${JSON.stringify(near?.error?.message ?? near?.end)} ${JSON.stringify(near?.error?.detail?.stderr)}`);
      // the cache flushes hl_run made are listed as the patch's own
      const e = failed ? null : s.step('expect:standin:H-PATCHFLUSH');
      if (e) ok(e.ok, `the stand-ins in use list H-PATCHFLUSH after their halation pass's flushes: ${e.error ?? 'listed'}`);
    }
  } finally {
    const sum = s.close();
    const own = (p) => p.token === 'input' && p.input?.op === 'call' && p.input.restore === true && p.input.mem.every(([a, v]) => /^scratch/.test(a) && (!String(v).startsWith('=') || /^=(?:scratch|0x|\d)/.test(v)));
    ok(sum.pokes.every(own) && sum.harness_inputs.length === 0 && (sum.patch_audit?.hooks ?? []).length === 0,
      `pokes only the calls' writes into their own scratch, put back; no harness input, no lab hook on patched bytes: ${JSON.stringify({ pokes: sum.pokes.filter((p) => !own(p)).length, harness: sum.harness_inputs, audit: sum.patch_audit?.hooks })}`);
    ok(said.some((l) => /patched firmware: \d+ patches/.test(l)), `the release taken as --patch: ${said[0]}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = lookcodeUnits();
    console.log(`Caduceus look code by calls, units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await lookcodeSession();
    if (s.notRun) console.log(`Caduceus look code by calls, E147: not run (${s.notRun})`);
    else console.log(`Caduceus look code by calls, E147 (${s.release}${s.source ? `, their numbers from ${s.source}` : ''}): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    if (process.env.OM_LOOKCODE_VALUES) console.log(JSON.stringify(s.values));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
