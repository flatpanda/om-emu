// The still's stage builders on stock firmware, called standalone (docs/hle-gaps.md 4.3.12, "The still's stage
// builders"): on E122, E143 and E147 each builder of the family the image library's stage list calls for a still
// (the RGB gamma stage, the six-axis colour builder, the COLOR stage and its HSL builder, the luminance-LUT builder and
// its tone selector's wrapper, the tone step, the chroma control, and beside the list the YC packing builder with the
// sharpness index rule, the grain builder and the register writer that copies the output block to the pipeline unit's
// page) is run by the debug call op through the supported scripting API (host/session.mjs input()) on a job the test
// writes into the call's scratch, and its outputs are compared with the pins of test/fixtures/stages.json. Nothing
// here needs a downstream checkout: the bodies' firmware is all it reads.
//
// A-STAGEJOB (emu/FIDELITY-NOTES.md 8.2): the job is the test's, not a camera's. It is zero but for the fields each
// row lists (the pointers between its blocks, the picture-mode key, the flags word all ones, an image size, and the
// row's own inputs); what a camera's job holds in the other bytes is unknown, and the builders read some of them. So a
// pinned value is the builder's answer to this job, never "the camera's value". The read set is part of the check:
// every call runs with trace:mem armed on the scratch and on everything outside it but the harness's own two megabytes
// and the image's reads, and the test asserts that
//   - every job byte a call read before writing it was written by the test, or is on the pinned list of bytes that
//     builder reads while they are zero on that body (the list is exact: a byte no row reads any more fails too);
//   - no call touches memory outside the job, its stack and the image, and none writes into the image, except the
//     accesses pinned for a row (the grain builder's null read without its sample pointer, its counter);
//   - no hit was dropped: the hits are taken through the debug route's hits op after each call (10,000 a take, not
//     the 100 a step's record keeps), each take's dropped count must be 0, and the largest take is reported.
// Controls: sharpness -2 moves the gain and +1 does not (the index rule); the picture modes give different six-axis
// sets and chroma words; one saturation step moves one record's word and nothing else; one byte the job leaves zero
// (the pinned sensitive byte) changes the YC block when set, and it is on the read-while-zero list; the grain builder
// without its sample pointer reads address 0 and says so; its counter outside the job survives the call's restore.
// Pokes: only the calls' writes into their own scratch, put back.
//   stagesUnits     (firmware-free) the read-set bookkeeping and the pin comparison on made-up hits and rows, with
//                   their refusals; the three bodies' tables and pins: the same builders, each pinned; the pins that
//                   must agree between bodies (the HSL records on all three; the stages E143 and E147 share)
//   stagesSession   (OM_EMU_MODEL=E122, E143 or E147; bin/test.mjs runs each in a child) the rows above
//   node emu/test/test_stages.mjs [--units] [--session] [--json] [--pin]
//     --json  the session's rows as one JSON document on stdout: per row the builder, its entry and frame, the job
//             fields written (block offset, bytes, value), the outputs (block offset, bytes, value or digest), the
//             instruction count, the job bytes read, those read while zero, the bytes written, the accesses outside the
//             job and the evidence tag; for a project that wants om-emu's values without vendoring a harness
//             (emu/README.md, The still's stage builders)
//     --pin   rewrite this body's section of test/fixtures/stages.json from the run (a pin changes only with its
//             reason in the commit message; never to make a failure pass)
//
// Facts used (D, the stock blocks, each entry a CALL target with the one frame its call sites give; notation). The
// job context C (a0 of every stage): C+4 the request R, C+8 the register image G (docs/hle-gaps.md 4.8.13; a block of
// its own in this job), C+12 the output block O, C+48 the picture-mode key, C+56 (E147 C+60) a flags word the stages
// test. R+8..+11 is the request's format word (byte, byte, halfword: the key again, 4.3.12). The PEN-F entries and
// the fields' meanings (mode, sensitivity, sharpness, grain level) are leads from olyom-isp-bench (src/native.js),
// which takes them from fishcu/oly_fw_analysis' probes; every address and offset here was read again in the three
// bodies' blocks, and the names stay I.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
export const PINS = path.join(EMU, 'test/fixtures/stages.json');
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha16 = (hex) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 16);

// ---- the job's blocks in the call's scratch ----------------------------------------------------------------------
// C the context, R the request, G and O the two blocks the builders fill, M the test's own bytes (the grain's seed
// sample, PEN-F's tone flag), P a stand-in for the unit's page the register writer fills
export const SIZE = 0x9000;
export const BLOCKS = { C: [0, 0x1000], R: [0x1000, 0x1000], G: [0x2000, 0x3000], O: [0x5000, 0x2000], M: [0x7000, 0x1000], P: [0x8000, 0x1000] };
const at = (b, o) => BLOCKS[b][0] + o;
const sc = (b, o = 0) => `scratch+${at(b, o)}`;
const blockOf = (off) => Object.keys(BLOCKS).find((b) => off >= BLOCKS[b][0] && off < BLOCKS[b][0] + BLOCKS[b][1]);

// ---- the three bodies (D) ----------------------------------------------------------------------------------------
// fn: entry, the frame its call sites give ([mask, size]) and the call sites; job: the request's and context's
// offsets; out: the output blocks' offsets (pageTail, PEN-F's: [the first O offset the register writer copies apart,
// its distance from the page offset it goes to], 0x504941a1..0x504941b4: O+1044 and +1048 at the page's +1100 and
// +1104, O+1040 not copied, D)
const fn = (entry, mask, size, ...sites) => ({ entry, frame: [mask, size], sites });
export const BODIES = {
  E122: {
    fn: { stages: fn(0x504d7523, 0xf0, 40, 0x504d78d6, 0x504d78f2), gamma: fn(0x504d5063, 0xf0, 216, 0x504d7568), six: fn(0x504d45be, 0xf0, 100, 0x504d75b5),
      color: fn(0x504d645f, 0xf0, 20, 0x504d75c3), hsl: fn(0x504d6252, 0xf0, 96, 0x504d64e6), lut: fn(0x504d6c56, 0xf0, 28, 0x504d75ca),
      tone: fn(0x504d6bf8, 0xb0, 20, 0x504c6402, 0x504d6c92), tonestep: fn(0x504d6d30, 0xf0, 76, 0x504d75d1), chroma: fn(0x504d73d1, 0xb0, 20, 0x504d75d8),
      yc: fn(0x504d2b81, 0xf0, 24, 0x504d78ca), grain: fn(0x504c929a, 0xf0, 20, 0x504c8f63), writer: fn(0x50493fe6, 0xf0, 24, 0x504939ab, 0x504939cd) },
    job: { flags: 56, size: 996, sat: 1076, sv: 1038, sharp: 1058, alt: 1073, level: 1088, seedp: 212, toneFlag: true },
    out: { ycw: 12, gainBits: 8, lim: 16, pairs: 20, six: 108, chroma: [76, 4], recs: 676, hslTail: [5172, 40], lutp: 4656, lut: 4660, cfg: 6056, gain: 112, seed: 148, cfgLen: 160,
      gamPtr: 4644, curveTop: 1023, step: [68, 8], page: 0x34, pageTail: [1044, 56] },
  },
  E143: {
    fn: { stages: fn(0x504f5cb0, 0xf0, 48, 0x504f643b, 0x504f6456), gamma: fn(0x504f32a8, 0xf0, 16, 0x504f5cf9), six: fn(0x504f26e6, 0xf0, 128, 0x504f5d00),
      color: fn(0x504f4c73, 0xf0, 20, 0x504f5dc7), hsl: fn(0x504f4a81, 0xf0, 96, 0x504f4cfa), lut: fn(0x504f5414, 0xf0, 176, 0x504f5dce),
      tone: fn(0x504f530e, 0x00, 4, 0x504db589, 0x504f5454), tonestep: fn(0x504f5606, 0xf0, 56, 0x504f5dd5), chroma: fn(0x504f5b88, 0xb0, 20, 0x504f5ddc),
      yc: fn(0x504f064b, 0xf0, 32, 0x504f642f), grain: fn(0x504e1981, 0xf0, 20, 0x504e15cf), writer: fn(0x50482623, 0xf0, 24, 0x50481d8d, 0x50481fd5) },
    job: { flags: 56, size: 1400, sat: 1479, sv: 1442, sharp: 1464, alt: 1665, level: 1491, seedp: 532 },
    out: { ycw: 8, gainBits: 10, lim: 12, pairs: 16, six: 132, chroma: [72, 16], recs: 836, hslTail: [4344, 40], lutp: 3828, lut: 3832, cfg: 7988, gain: 148, seed: 188, cfgLen: 200,
      gamPtr: 3172, curveTop: 4095, step: [64, 8], page: 0x80 },
  },
  E147: {
    fn: { stages: fn(0x504f8694, 0xf0, 48, 0x504f8e29, 0x504f8e44), gamma: fn(0x504f5ab9, 0xf0, 16, 0x504f86dd), six: fn(0x504f4e44, 0xf0, 128, 0x504f86e4),
      color: fn(0x504f7553, 0xf0, 28, 0x504f87ab), hsl: fn(0x504f7361, 0xf0, 96, 0x504f75f5), lut: fn(0x504f7d92, 0xf0, 176, 0x504f87b2),
      tone: fn(0x504f7c8c, 0x00, 4, 0x504dd519, 0x504f7dd2), tonestep: fn(0x504f7f84, 0xf0, 56, 0x504f87b9), chroma: fn(0x504f856c, 0xb0, 20, 0x504f87c0),
      yc: fn(0x504f2d9d, 0xf0, 32, 0x504f8e1d), grain: fn(0x504e3b0b, 0xf0, 28, 0x504e3759), writer: fn(0x50482e53, 0xf0, 24, 0x504825bd, 0x50482805) },
    job: { flags: 60, size: 1660, sat: 1739, sv: 1702, sharp: 1724, alt: 1925, level: 1751, seedp: 628 },
    out: { ycw: 8, gainBits: 10, lim: 12, pairs: 16, six: 132, chroma: [72, 16], recs: 836, hslTail: [4344, 40], lutp: 3828, lut: 3832, cfg: 7988, gain: 148, seed: 188, cfgLen: 200,
      gamPtr: 3172, curveTop: 4095, step: [64, 8], page: 0x80 },
  },
};
export const BUILDERS = ['stages', 'gamma', 'six', 'color', 'hsl', 'lut', 'tone', 'tonestep', 'chroma', 'yc', 'grain', 'writer'];
// the picture-mode keys the rows use (4.3.12: 11 and 12 are E147's COLOR and MONO positions, 2 the mode E143 shoots
// in; which mode 1, 3 and 4 name is I)
const KEYS = [11, 12, 1, 2, 3, 4];
const SAT = { zero: new Array(12).fill(0), first5: [5, ...new Array(11).fill(0)], first7: [7, ...new Array(11).fill(0)], all3: new Array(12).fill(3) };
const IMAGE_W = 5184, IMAGE_H = 3888;       // a 20 MP frame (I): the gamma stage divides by the size's halfwords

// ---- firmware-free: fields, read sets, pins ------------------------------------------------------------------------
const le = (v, n) => Array.from({ length: n }, (_, i) => ((v >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')).join('');
// a job field: n bytes of a value, a pointer to another block, or raw bytes
export const num = (b, o, n, v, what) => ({ b, o, n, hex: le(v, n), value: v, what });
export const ptr = (b, o, tb, to, what) => ({ b, o, n: 4, ref: [tb, to], value: `${tb}${to ? `+${to}` : ''}`, what });
export const raw = (b, o, hex, what) => ({ b, o, n: hex.length / 2, hex, value: hex, what });
// fields -> {mem (the call op's), written (the scratch offsets the test writes)}
export function fieldMem(fields) {
  const written = new Set();
  const mem = fields.map((f) => {
    for (let i = 0; i < f.n; i++) written.add(at(f.b, f.o) + i);
    return [sc(f.b, f.o), f.ref ? `=${sc(f.ref[0], f.ref[1])}` : f.hex];
  });
  return { mem, written };
}
// a set of scratch offsets as text ("C 4-7 48; R 8-11 1038-1039") and back
export function setText(set) {
  const per = {};
  for (const off of [...set].sort((a, b) => a - b)) {
    const b = blockOf(off), o = off - BLOCKS[b][0], l = (per[b] ??= []);
    if (l.length && l.at(-1)[1] === o - 1) l.at(-1)[1] = o; else l.push([o, o]);
  }
  return Object.keys(BLOCKS).filter((b) => per[b]).map((b) => `${b} ${per[b].map(([a, z]) => (a === z ? `${a}` : `${a}-${z}`)).join(' ')}`).join('; ');
}
export function textSet(text) {
  const set = new Set();
  for (const part of String(text).split(';').map((x) => x.trim()).filter(Boolean)) {
    const [b, ...ranges] = part.split(/\s+/);
    if (!Object.hasOwn(BLOCKS, b)) throw new Error(`${JSON.stringify(part)}: no block ${b}`);
    for (const r of ranges) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(r);
      if (!m) throw new Error(`${JSON.stringify(part)}: ${r} is not N or N-M`);
      for (let o = Number(m[1]); o <= Number(m[2] ?? m[1]); o++) set.add(at(b, o));
    }
  }
  return set;
}
// One call's hits (the debug route's hits, in order) against the scratch at base: read, the job bytes read before the
// call wrote them; zero, those of them the test did not write; wrote, the bytes the call wrote; outside, the accesses
// outside the scratch as 'ADDR r|w SIZE' in order
export function accessSets(hits, base, written) {
  const own = new Set(), read = new Set(), zero = new Set(), outside = [];
  for (const h of hits) {
    if (h.kind !== 'mem') continue;
    const a = parseInt(h.addr, 16) >>> 0, off = a - base;
    if (off < 0 || off >= SIZE) { outside.push(`${h8(a)} ${h.dir} ${h.size}`); continue; }
    for (let i = 0; i < h.size; i++) {
      if (h.dir === 'w') own.add(off + i);
      else if (!own.has(off + i)) { read.add(off + i); if (!written.has(off + i)) zero.add(off + i); }
    }
  }
  return { read, zero, wrote: own, outside };
}
// the rows' read sets against a builder's pinned list: [finding...]. rows: [{case, zero: Set}]
export function readFindings(builder, rows, pinnedText) {
  const pinned = textSet(pinnedText ?? ''), seen = new Set(), out = [];
  for (const r of rows) {
    const extra = [...r.zero].filter((o) => !pinned.has(o));
    if (extra.length) out.push(`${builder}, ${r.case}: read while zero and not on the pinned list: ${setText(new Set(extra))}`);
    for (const o of r.zero) seen.add(o);
  }
  const gone = [...pinned].filter((o) => !seen.has(o));
  if (gone.length) out.push(`${builder}: pinned as read while zero, read by no row: ${setText(new Set(gone))}`);
  return out;
}
// a row against its pin: [finding...]
export function pinFindings(row, pin) {
  if (!pin) return [`${row.case}: no pin (test/fixtures/stages.json; --pin writes this body's section)`];
  const out = [];
  for (const k of ['end', 'steps', 'outside']) if (!same(row[k], pin[k])) out.push(`${row.case}: ${k} ${JSON.stringify(row[k])}, pinned ${JSON.stringify(pin[k])}`);
  const got = Object.fromEntries(row.out.map((o) => [o.name, o.value]));
  for (const k of new Set([...Object.keys(got), ...Object.keys(pin.out ?? {})])) if (!same(got[k], pin.out?.[k])) out.push(`${row.case}: ${k} ${JSON.stringify(got[k])}, pinned ${JSON.stringify(pin.out?.[k])}`);
  return out;
}
// a block's bytes with every aligned word that points into the scratch made relative to it (a digest of a block that
// holds the job's own addresses must not depend on where the lab put the scratch)
export function relocated(hex, base) {
  let out = '';
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    const v = parseInt(hex.slice(i, i + 8).match(/../g).reverse().join(''), 16) >>> 0;
    out += v >= base && v < base + SIZE ? le(v - base, 4) : hex.slice(i, i + 8);
  }
  return out + hex.slice(hex.length - (hex.length % 8));
}
const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (x) => parseInt(x, 16));
const u = (b, o, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + b[o + i]; return v; };
const s16 = (v) => (v > 32767 ? v - 65536 : v);
// an output's value from its bytes: as 'u' an unsigned number, 's16s' / 'u16s' / 'u32s' a list, 'sha' the first 16
// digits of the bytes' sha256, 'rsha' the same of the relocated bytes, 'ptr' a block offset or an address
export function decode(hex, as, base) {
  const b = bytesOf(hex);
  if (as === 'u') return u(b, 0, b.length);
  if (as === 's16s') return Array.from({ length: b.length / 2 }, (_, i) => s16(u(b, 2 * i, 2)));
  if (as === 'u16s') return Array.from({ length: b.length / 2 }, (_, i) => u(b, 2 * i, 2));
  if (as === 'u32s') return Array.from({ length: b.length / 4 }, (_, i) => u(b, 4 * i, 4));
  if (as === 'sha') return sha16(hex);
  if (as === 'rsha') return sha16(relocated(hex, base));
  if (as === 'ptr') { const v = u(b, 0, 4), off = v - base; return off >= 0 && off < SIZE ? `${blockOf(off)}+${off - BLOCKS[blockOf(off)][0]}` : h8(v); }
  throw new Error(`decode: ${as}`);
}
const readPins = () => JSON.parse(fs.readFileSync(PINS, 'utf8'));
// the pins that must agree between bodies: [case, output name, bodies]. The HSL builder's records are the same on the
// three (E143's and E147's builders are instruction for instruction the same but for one table address, D; PEN-F's
// X); E143's and E147's YC packing, chroma control and register writer differ in field offsets only (D), and their
// six-axis sets, grain block and tone curves are equal (X); the tone step's two words are the same on the three (X)
export const SAME = [
  ...Object.keys(SAT).flatMap((k) => [[`hsl alone ${k}`, 'records', ['E122', 'E143', 'E147']], [`hsl alone ${k}`, 'S', ['E122', 'E143', 'E147']], [`color ${k}`, 'records', ['E122', 'E143', 'E147']]]),
  ...[3, 4].map((k) => [`tone key ${k}`, 'lut', ['E122', 'E143', 'E147']]),
  ...KEYS.flatMap((k) => [[`six key ${k}`, 'coefficients', ['E143', 'E147']], [`chroma key ${k}`, 'words', ['E143', 'E147']], [`tone key ${k}`, 'lut', ['E143', 'E147']]]),
  ...[1280, 2560, 3840].flatMap((sv) => [-2, -1, 0, 1, 2].map((s) => [`yc key 11 sv ${sv} sharpness ${s}`, 'packed', ['E143', 'E147']])),
  ...[1, 2, 3].map((l) => [`grain level ${l}`, 'block', ['E143', 'E147']]),
  ...[1, 2, 3].map((l) => [`grain level ${l}`, 'gain', ['E122', 'E143', 'E147']]),
  ['chain: the register writer', 'page', ['E143', 'E147']], ['tonestep key 11', 'words', ['E122', 'E143', 'E147']],
];

export function stagesUnits() {
  const t = tester(), { ok } = t;
  const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
  // the text form of a read set
  const set = new Set([at('C', 4), at('C', 5), at('C', 6), at('C', 7), at('C', 48), at('R', 8), at('R', 1038), at('R', 1039)]);
  ok(setText(set) === 'C 4-7 48; R 8 1038-1039', `setText: ${setText(set)}`);
  ok(same([...textSet('C 4-7 48; R 8 1038-1039')].sort((a, b) => a - b), [...set].sort((a, b) => a - b)) && textSet('').size === 0, 'textSet reads setText\'s form back');
  ok(/no block Q/.test(thrown(() => textSet('Q 1'))?.message) && /not N or N-M/.test(thrown(() => textSet('C 1..2'))?.message), 'textSet refuses an unknown block and a malformed range');
  // fields
  const f = fieldMem([ptr('C', 4, 'R', 0, 'R'), num('R', 1038, 2, 1280, 'Sv'), num('R', 1058, 1, -2 & 0xff, 'sharpness'), raw('M', 0, '3412', 'sample')]);
  ok(same(f.mem, [['scratch+4', '=scratch+4096'], ['scratch+5134', '0005'], ['scratch+5154', 'fe'], ['scratch+28672', '3412']]) && f.written.size === 9, `fieldMem: ${JSON.stringify(f.mem)} ${f.written.size}`);
  // one call's hits: a written field's read is not a zero read; a byte read before the call's own write is, after it is
  // not; an access outside the scratch is listed in order
  const base = 0xa2201000, hit = (off, size, dir, abs = null) => ({ kind: 'mem', addr: h8(abs ?? base + off), size, dir, value: '0x00000000', pc: '0x50000000' });
  const hits = [hit(at('C', 4), 4, 'r'), hit(at('R', 1038), 2, 'r'), hit(at('R', 1073), 1, 'r'), hit(at('O', 8), 4, 'r'), hit(at('O', 8), 4, 'w'), hit(at('O', 8), 4, 'r'), hit(at('O', 12), 4, 'w'), hit(at('O', 12), 2, 'r'),
    hit(0, 2, 'r', 0), hit(0, 4, 'w', 0xa1c63108), { kind: 'pc', pc: '0x50000000' }];
  const a = accessSets(hits, base, f.written);
  ok(setText(a.read) === 'C 4-7; R 1038-1039 1073; O 8-11' && setText(a.zero) === 'R 1073; O 8-11' && setText(a.wrote) === 'O 8-15' && same(a.outside, ['0x00000000 r 2', '0xa1c63108 w 4']),
    `accessSets: ${setText(a.read)} | ${setText(a.zero)} | ${setText(a.wrote)} | ${a.outside}`);
  // the pinned list is exact both ways
  const rows = [{ case: 'one', zero: textSet('R 1073; O 8-11') }, { case: 'two', zero: textSet('R 1073') }];
  ok(readFindings('yc', rows, 'R 1073; O 8-11').length === 0, 'readFindings: the pinned list, read');
  const r1 = readFindings('yc', rows, 'O 8-11');
  ok(r1.length === 2 && r1.every((x) => /not on the pinned list: R 1073/.test(x)), `readFindings: a read the list does not have fails each row that makes it: ${JSON.stringify(r1)}`);
  const r2 = readFindings('yc', rows, 'R 1072-1073; O 8-11');
  ok(r2.length === 1 && /read by no row: R 1072/.test(r2[0]), `readFindings: a pinned byte no row reads fails: ${JSON.stringify(r2)}`);
  // a row against its pin
  const row = { case: 'yc', end: 'return', steps: 544, outside: [], out: [{ name: 'gain', value: 37 }, { name: 'limits', value: [144, 384] }] };
  const pin = { end: 'return', steps: 544, outside: [], out: { gain: 37, limits: [144, 384] } };
  ok(pinFindings(row, pin).length === 0 && /no pin/.test(pinFindings(row, undefined)[0]), 'pinFindings: the pinned row; a row without a pin');
  const p1 = pinFindings(row, { ...pin, out: { gain: 30, limits: [144, 384] } }), p2 = pinFindings(row, { ...pin, steps: 545 }), p3 = pinFindings(row, { ...pin, out: { ...pin.out, coring: 7 } }), p4 = pinFindings(row, { ...pin, outside: ['0x00000000 r 2'] });
  ok(p1.length === 1 && p1[0] === 'yc: gain 37, pinned 30' && p2.length === 1 && /steps 544, pinned 545/.test(p2[0]) && p3.length === 1 && /coring undefined, pinned 7/.test(p3[0]) && p4.length === 1 && /outside/.test(p4[0]),
    `pinFindings: one value, the instruction count, a pinned output the row lacks, an access outside the job: ${JSON.stringify([p1, p2, p3, p4])}`);
  // outputs
  ok(decode('2a000000', 'u') === 42 && same(decode('0a00fbff', 's16s'), [10, -5]) && same(decode('90008001', 'u16s'), [144, 384]) && decode(le(base + at('O', 3832), 4), 'ptr', base) === 'O+3832'
    && decode('08cd6860', 'ptr', base) === '0x6068cd08', 'decode: a number, signed and unsigned halfwords, a pointer into the scratch and one outside it');
  const blk = le(base + at('O', 1252), 4) + '11223344' + le(base + SIZE, 4) + 'aabb';
  ok(relocated(blk, base) === le(at('O', 1252), 4) + '11223344' + le(base + SIZE, 4) + 'aabb' && relocated(blk, base) === relocated(le(0x8a201000 + at('O', 1252), 4) + '11223344' + le(base + SIZE, 4) + 'aabb', 0x8a201000)
    && decode(blk, 'rsha', base) !== decode(blk, 'sha'), 'relocated: a word that points into the scratch is its offset, wherever the scratch is; the others stay');
  // the bodies' tables and the pins
  const pins = readPins();
  for (const [m, B] of Object.entries(BODIES)) {
    ok(same(Object.keys(B.fn).sort(), [...BUILDERS].sort()) && Object.values(B.fn).every((x) => x.entry >= 0x50000000 && x.entry < 0x52000000 && x.sites.length >= 1 && x.frame.every((v) => v >= 0 && v < 256)),
      `${m}: every builder of the family has an entry, a frame and a call site`);
    const P = pins[m];
    ok(P && same(Object.keys(P.zero ?? {}).sort(), [...BUILDERS].sort()) && Object.keys(P.cases ?? {}).length > 60, `${m}: pinned (a read-while-zero list per builder, ${Object.keys(P?.cases ?? {}).length} rows)`);
    ok(P && Object.keys(P.cases).every((id) => BUILDERS.some((b) => P.cases[id].builder === b)) && BUILDERS.every((b) => Object.values(P.cases).some((c) => c.builder === b)), `${m}: every builder has a pinned row`);
    ok(P && P.sensitive && textSet(P.zero.yc).has(at('R', B.job.alt)), `${m}: the pinned sensitive byte R+${B.job.alt} is on the YC packing builder's read-while-zero list`);
  }
  ok(same(Object.keys(pins.E122?.cases ?? {}), Object.keys(pins.E143?.cases ?? {})) && same(Object.keys(pins.E143?.cases ?? {}), Object.keys(pins.E147?.cases ?? {})), 'the three bodies have the same rows');
  for (const [id, name, bodies] of SAME) {
    const vals = bodies.map((m) => pins[m]?.cases?.[id]?.out?.[name]);
    ok(vals.every((v) => v !== undefined && same(v, vals[0])), `${id}, ${name}: equal on ${bodies.join(', ')}: ${JSON.stringify(vals).slice(0, 200)}`);
  }
  // and the ones that differ in kind: PEN-F's chroma word for key 12, its six-axis presets, the default LUT's curve
  const d = (id, name) => ['E122', 'E147'].map((m) => pins[m]?.cases?.[id]?.out?.[name]);
  ok(!same(...d('chroma key 12', 'words')) && !same(...d('six key 1', 'coefficients')) && !same(...d('yc key 11 sv 1280 sharpness -2', 'packed')),
    `PEN-F's chroma word for key 12, its six-axis set for key 1 and its gain at sharpness -2 are not E147's: ${JSON.stringify([d('chroma key 12', 'words'), d('six key 1', 'coefficients'), d('yc key 11 sv 1280 sharpness -2', 'packed')])}`);
  return t;
}

// ---- the session ---------------------------------------------------------------------------------------------------
export async function stagesSession({ pin = false } = {}) {
  const t = tester(), { ok } = t;
  const { MODEL, IMAGE_BASE, IMAGE_END } = await import('../src/fw/model.mjs');
  const B = BODIES[MODEL];
  t.model = MODEL; t.rows = [];
  if (!B) { ok(false, `test_stages: the session needs OM_EMU_MODEL=E122, E143 or E147, not ${MODEL}`); return t; }
  const P = pin ? { read: {}, zero: {}, wrote: {}, cases: {} } : readPins()[MODEL];
  if (!P) { ok(false, `test_stages: ${PINS} has no section for ${MODEL}`); return t; }
  const J = B.job, Q = B.out;
  const { openSession } = await import('../host/session.mjs');
  const s = await openSession({ model: MODEL, say: () => {} });
  const rows = t.rows, perBuilder = {}, wroteBy = {}, readBy = {};
  let maxHits = 0, failed = null;
  try {
    ok(s.first.ok, `the session opens: ${s.first.error ?? ''}`);
    if (!s.first.ok) return t;
    const dbg = (q) => { const r = s.input({ type: 'debug', ...q }); return r.debug ?? r; };
    // the job every row starts from: the blocks' pointers, the key in the context and in the request's format word, the
    // flags word all ones (which bits a camera sets is not read), an image size, the zero saturation set
    const job = (key, ...more) => [ptr('C', 4, 'R', 0, 'the request'), ptr('C', 8, 'G', 0, 'the second output block'), ptr('C', 12, 'O', 0, 'the output block'),
      num('C', 48, 4, key, 'the picture-mode key'), num('C', J.flags, 4, 0xffffffff, 'the flags word, every bit'), raw('R', 8, `0000${le(key, 2)}`, 'the format word: 0, 0, the key'),
      raw('R', J.size, le(IMAGE_W, 2) + le(IMAGE_H, 2) + le(IMAGE_W, 2) + le(IMAGE_H, 2), 'an image size, twice'), ...more];
    // the scratch's address and the harness's own memory, from a first call that is not traced
    const first = dbg({ op: 'call', fn: B.fn.chroma.entry, regs: { a0: sc('C') }, scratch: SIZE, restore: true, mem: fieldMem(job(11)).mem });
    ok(first.ok === true && first.end === 'return', `a first call returns: ${JSON.stringify(first.error ?? first.end)}`);
    if (!first.ok) return t;
    const base = parseInt(first.scratch, 16) >>> 0, harness = (parseInt(first.regs.pc, 16) - 7) >>> 0, hEnd = harness + 0x200000, sp = parseInt(first.regs.sp, 16) >>> 0;
    ok(base >= harness && base + SIZE <= hEnd && sp > harness && sp <= hEnd && harness >= IMAGE_END, `the scratch (${h8(base)}) and the call's stack (${h8(sp)}) are in the harness's two megabytes from its trampoline ${h8(harness)}`);
    // traces: the scratch (reads and writes); everything below the image, between it and the harness and above the
    // harness (reads and writes); the image (writes). Not traced: the harness's stack and trampolines, the image's reads
    for (const [lo, len, kind] of [[base, SIZE, 'rw'], [0, IMAGE_BASE, 'rw'], [IMAGE_BASE, IMAGE_END - IMAGE_BASE, 'w'], [IMAGE_END, harness - IMAGE_END, 'rw'], [hEnd, 2 ** 32 - hEnd, 'rw']]) {
      const r = s.step(`trace:mem:${h8(lo)}:${len}:${kind}`);
      ok(r.ok, `trace:mem:${h8(lo)}:${len}:${kind}: ${r.error ?? 'armed'}`);
    }
    // one row: the builder called on the fields, its outputs read; outs [{name, b, o, n, as}]
    const row = (builder, id, q, fields, outs, { memExtra = [], more = null, control = false } = {}) => {
      if (failed) return null;
      const f = B.fn[builder], { mem, written } = fieldMem(fields);
      const d = dbg({ op: 'call', fn: f.entry, regs: q.regs, ...(q.stops ? { stops: q.stops } : {}), scratch: SIZE, restore: true, limit: 2000000, mem: [...mem, ...memExtra], read: outs.map((o) => [sc(o.b, o.o), o.n]) });
      const h = dbg({ op: 'hits', limit: 10000 });
      if (!d.ok || !h.ok) { failed = `${id}: ${d.error?.type ?? ''} ${d.error?.message ?? JSON.stringify(h.error ?? d).slice(0, 300)}`; ok(false, failed); return null; }
      maxHits = Math.max(maxHits, h.hits.length);
      ok(h.dropped === 0, `${id}: no hit dropped (${h.hits.length} taken, ${h.dropped} dropped)`);
      ok(parseInt(d.scratch, 16) >>> 0 === base, `${id}: the scratch is where the traces are armed: ${d.scratch}`);
      ok(same(d.frame, f.frame), `${id}: the frame the call op takes from ${h8(f.entry)}'s call sites, [${d.frame}], is the table's [${f.frame}]`);
      ok(d.stubs.length === 0 && (d.errlog ?? []).length === 0, `${id}: no lab hook answered and nothing went to the error log: ${JSON.stringify([d.stubs, d.errlog])}`);
      for (const [a, v] of memExtra) for (let i = 0; i < v.length / 2; i++) written.add(Number(/\+(\d+)/.exec(a)[1]) + i);
      const acc = accessSets(h.hits, base, written);
      const r = { builder, case: id, fn: d.fn.notation, frame: d.frame, end: d.end, ...(d.stop ? { stop: d.stop.notation } : {}), steps: d.steps,
        in: fields.map((x) => ({ at: `${x.b}+${x.o}`, bytes: x.n, value: x.value, what: x.what })),
        out: outs.map((o, i) => ({ name: o.name, at: `${o.b}+${o.o}`, bytes: o.n, value: (o.f ?? ((x) => x))(decode(d.reads[i].hex, o.as, base)) })),
        read: setText(acc.read), read_zero: setText(acc.zero), wrote: setText(acc.wrote), outside: acc.outside, tag: 'X', assumption: 'A-STAGEJOB' };
      Object.defineProperty(r, 'd', { value: d });
      if (more) r.out.push(...more(r, d));          // outputs the row works out from the call's answer
      Object.defineProperty(r, 'zero', { value: acc.zero });
      Object.defineProperty(r, 'hits', { value: h.hits });
      if (control) return r;                        // a control's call: not a row, not pinned
      rows.push(r);
      (perBuilder[builder] ??= []).push(r);
      for (const o of acc.wrote) (wroteBy[builder] ??= new Set()).add(o);
      for (const o of acc.read) (readBy[builder] ??= new Set()).add(o);
      if (pin) P.cases[id] = { builder, end: r.end, steps: r.steps, outside: r.outside, out: Object.fromEntries(r.out.map((o) => [o.name, o.value])) };
      else for (const x of pinFindings(r, P.cases[id])) ok(false, x);
      if (!pin) ok(true, id);
      return r;
    };
    const val = (r, name) => r?.out.find((o) => o.name === name)?.value;
    const C0 = { regs: { a0: sc('C') } };

    // ---- the YC packing builder: sharpening by picture mode, sensitivity and sharpness
    const unpack = (w) => ({ control: w & 0xff, coring: (w >>> 8) & 0xff, gain: (w >>> 16) & ((1 << Q.gainBits) - 1) });
    const ycOut = [{ name: 'packed', b: 'O', o: Q.ycw, n: 4, as: 'u', f: unpack }, { name: 'limits', b: 'O', o: Q.lim, n: 4, as: 'u16s' }, { name: 'pairs', b: 'O', o: Q.pairs, n: 48, as: 'u16s' }];
    const yc = (key, sv, sharp, ...more) => [...job(key), num('R', J.sv, 2, sv, 'the sensitivity word'), num('R', J.sharp, 1, sharp & 0xff, 'sharpness'), ...more];
    const ycRows = {};
    for (const sv of [1280, 2560, 3840]) for (const sh of [-2, -1, 0, 1, 2]) ycRows[`${sv} ${sh}`] = row('yc', `yc key 11 sv ${sv} sharpness ${sh}`, C0, yc(11, sv, sh), ycOut);
    for (const sh of [-2, 0]) row('yc', `yc key 2 sv 1280 sharpness ${sh}`, C0, yc(2, 1280, sh), ycOut);
    const alt = row('yc', `yc key 11 sv 1280 sharpness 0, the sensitive byte set`, C0, yc(11, 1280, 0, num('R', J.alt, 1, 1, 'a byte the other rows leave 0')), ycOut);
    if (!failed) {
      const g = (k) => val(ycRows[k], 'packed');
      ok(g('1280 -2').gain !== g('1280 0').gain && g('1280 -1').gain !== g('1280 0').gain, `control: sharpness -2 and -1 move the gain: ${g('1280 -2').gain}, ${g('1280 -1').gain}, ${g('1280 0').gain}`);
      ok(same(ycRows['1280 1'].out, ycRows['1280 0'].out) && same(ycRows['1280 2'].out, ycRows['1280 0'].out), 'control: sharpness +1 and +2 leave the block as sharpness 0 does (the index rule: the table is flat from the base index up)');
      ok(g('1280 0').coring !== g('3840 0').coring, `control: the sensitivity word moves the coring: ${g('1280 0').coring}, ${g('3840 0').coring}`);
      ok(!same(val(alt, 'packed'), g('1280 0')) && ycRows['1280 0'].zero.has(at('R', J.alt)), `control: R+${J.alt}, read while zero by the other rows, changes the block when set: ${JSON.stringify(val(alt, 'packed'))} for ${JSON.stringify(g('1280 0'))}`);
      ok(same(val(ycRows['1280 0'], 'limits'), [144, 384]), `the default limit pair: ${val(ycRows['1280 0'], 'limits')}`);
      if (pin) P.sensitive = { at: `R+${J.alt}`, row: alt.case };
    }

    // ---- the grain builder: the gain by level; the null read without its sample pointer; the counter
    const cfg = [{ name: 'gain', b: 'G', o: Q.cfg + Q.gain, n: 4, as: 'u' }, { name: 'seed', b: 'G', o: Q.cfg + Q.seed, n: 4, as: 'u' }, { name: 'block', b: 'G', o: Q.cfg, n: Q.cfgLen, as: 'sha' }];
    const grain = (word, level, seed = true) => [...job(12), num('R', 12, 2, word, 'the request word the builder compares'), num('R', J.level, 1, level, 'the grain level'),
      ...(seed ? [ptr('R', J.seedp, 'M', 0, 'a sample\'s address'), raw('M', 0, '3412', 'the sample')] : [])];
    const gr = [1, 2, 3].map((l) => row('grain', `grain level ${l}`, C0, grain(0x901, l), cfg));
    const g0 = row('grain', 'grain level 2, no sample pointer', C0, grain(0x901, 2, false), cfg);
    const c1 = row('grain', 'grain level 2, request word 0x902', C0, grain(0x902, 2, false), cfg), c2 = row('grain', 'grain level 2, request word 0x902, again', C0, grain(0x902, 2, false), cfg);
    if (!failed) {
      ok(same(gr.map((r) => val(r, 'gain')), [110, 300, 600]) && gr.every((r) => val(r, 'seed') === 0x80001234), `the gain by level and the sample in the seed word: ${gr.map((r) => `${val(r, 'gain')} ${h8(val(r, 'seed'))}`)}`);
      ok(same(g0.outside, ['0x00000000 r 2']) && val(g0, 'seed') === 0x80000000, `control: without its sample pointer the builder reads address 0 and the trace says so: ${g0.outside}, seed ${h8(val(g0, 'seed'))}`);
      // the counter is outside the job: the call's restore puts the scratch back, not this word
      const cnt = (r) => r.hits.filter((h) => h.kind === 'mem' && (parseInt(h.addr, 16) >>> 0) - base >= SIZE).map((h) => [h.addr, h.dir, parseInt(h.value, 16)]);
      const k1 = cnt(c1), k2 = cnt(c2);
      ok(k1.length === 2 && k2.length === 2 && k1[0][1] === 'r' && k1[1][1] === 'w' && k1[1][2] === k1[0][2] + 1 && k2[0][2] === k1[1][2] && k2[1][2] === k2[0][2] + 1 && val(c2, 'seed') === ((val(c1, 'seed') + 1) >>> 0),
        `the request word 0x902 counts in a word outside the job, and the count survives the call's restore: ${JSON.stringify([k1, k2])}, seeds ${h8(val(c1, 'seed'))} ${h8(val(c2, 'seed'))}`);
      t.counter = k1[0]?.[0] ?? null;
    }

    // ---- the six-axis colour builder and the chroma control, by picture mode
    const six = Object.fromEntries(KEYS.map((k) => [k, row('six', `six key ${k}`, C0, job(k), [{ name: 'coefficients', b: 'O', o: Q.six, n: 24, as: 's16s' }])]));
    const chroma = Object.fromEntries(KEYS.map((k) => [k, row('chroma', `chroma key ${k}`, C0, job(k), [{ name: 'words', b: 'O', o: Q.chroma[0], n: Q.chroma[1], as: 'u32s' }])]));
    if (!failed) {
      ok(new Set([1, 3, 4, 11].map((k) => JSON.stringify(val(six[k], 'coefficients')))).size === 4, 'control: keys 1, 3, 4 and 11 give four six-axis sets');
      ok(val(chroma[12], 'words').some((w) => w !== 0) && KEYS.filter((k) => k !== 12).every((k) => val(chroma[k], 'words').every((w) => w === 0)), `control: the chroma words are set for key 12 alone: ${KEYS.map((k) => val(chroma[k], 'words').map(h8))}`);
    }

    // ---- the tone selector through its wrapper: the LUT's address by picture mode, the LUT read there
    const tone = {};
    for (const k of KEYS) {
      const regs = { a0: sc('R'), a1: sc('O', Q.lut), ...(J.toneFlag ? { d0: sc('M', 16) } : {}) };
      // a0 at the return: the LUT's address (in the image, or the buffer a1 names when the selector built one)
      tone[k] = row('tone', `tone key ${k}`, { regs }, job(k), [{ name: 'buffer', b: 'O', o: Q.lut, n: 512, as: 'sha' }], { more: (r, d) => {
        const p = parseInt(d.regs.a0, 16) >>> 0, off = p - base;
        const lutHex = off >= 0 && off < SIZE ? d.reads[0].hex : dbg({ op: 'read', addr: p, size: 512 }).hex ?? '', lut = decode(lutHex, 'u16s');
        return [{ name: 'pointer', at: 'a0', bytes: 4, value: decode(le(p, 4), 'ptr', base) }, { name: 'lut', at: '(a0)', bytes: 512, value: sha16(lutHex) },
          { name: 'samples', at: '(a0)', bytes: 512, value: [0, 1, 64, 128, 192, 255].map((i) => lut[i]) }];
      } });
    }
    if (!failed) ok(new Set([11, 3, 4].map((k) => val(tone[k], 'lut'))).size === 3 && val(tone[11], 'lut') === val(tone[12], 'lut'), `control: keys 3 and 4 select other curves than key 11, key 12 the same: ${KEYS.map((k) => val(tone[k], 'pointer'))}`);

    // ---- the COLOR stage and its HSL builder: the builder alone with the registers the stage hands it, and through
    // the stage, by saturation set
    const hslOut = [{ name: 'records', b: 'O', o: Q.recs, n: 288, as: 'sha' }, { name: 'S', b: 'O', o: Q.recs, n: 288, as: 'u32s', f: (w) => w.filter((_, i) => i % 6 === 5) },
      { name: 'enable', b: 'O', o: Q.recs + 288, n: 4, as: 'u' }, { name: 'tail', b: 'O', o: Q.hslTail[0], n: Q.hslTail[1], as: 'sha' }];
    const sat = (k) => raw('R', J.sat, SAT[k].map((v) => le(v, 1)).join(''), 'the saturation set');
    const stop = row('color', 'color to the HSL call', { ...C0, stops: [B.fn.hsl.sites[0]] }, job(11, sat('zero')), []);
    const hsl = {}, col = {};
    if (stop) {
      const rg = stop.d.regs, rel = (v) => { const o = (parseInt(v, 16) >>> 0) - base; return o >= 0 && o < SIZE ? `scratch+${o}` : v; };
      ok(stop.end === 'stop' && rel(rg.d1) === sc('O') && rel(rg.a1) === sc('R', J.sat), `the COLOR stage reaches the HSL call for key 11 with d1 = O and a1 = R+${J.sat}: ${stop.end}, ${rel(rg.d1)}, ${rel(rg.a1)}`);
      t.hslRegs = { d0: rg.d0, a0: rg.a0 };
      for (const k of Object.keys(SAT)) {
        hsl[k] = row('hsl', `hsl alone ${k}`, { regs: { d0: rg.d0, d1: rel(rg.d1), a0: rg.a0, a1: rel(rg.a1) } }, job(11, sat(k)), [...hslOut, { name: 'all', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }]);
        col[k] = row('color', `color ${k}`, C0, job(11, sat(k)), [...hslOut, { name: 'all', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }]);
      }
    }
    if (!failed) {
      ok(Object.keys(SAT).every((k) => val(hsl[k], 'records') === val(col[k], 'records')), 'the COLOR stage leaves the HSL builder\'s records');
      ok(same(val(hsl.zero, 'S'), new Array(12).fill(0)) && same(val(hsl.first5, 'S'), [225, ...new Array(11).fill(0)]) && same(val(hsl.first7, 'S'), [315, ...new Array(11).fill(0)]) && val(hsl.all3, 'S')[0] === 135 && val(hsl.all3, 'S').every((v) => v > 0),
        `record 0's S word is 45 a step of the first value, and a set of all 3 sets every record's: ${JSON.stringify(Object.keys(SAT).map((k) => val(hsl[k], 'S')))}`);
      // one step moves record 0's S word and nothing else of the whole output block
      const a = hsl.zero.d.reads[4].hex, b = hsl.first5.d.reads[4].hex, diff = [];
      for (let i = 0; i < a.length; i += 2) if (a.slice(i, i + 2) !== b.slice(i, i + 2)) diff.push(i / 2);
      ok(same(diff, [Q.recs + 20]), `control: a saturation step in the first value moves O+${Q.recs + 20} (record 0's S word) and no other byte of the block: ${diff}`);
      ok(val(col.first5, 'all') !== val(col.zero, 'all') && val(hsl.zero, 'enable') === 4095, `the 12 records enabled: ${val(hsl.zero, 'enable')}`);
    }

    // ---- the RGB gamma stage, the luminance-LUT builder and the tone step, for keys 11 and 12
    // the gamma stage's three curve pointers, and the curve the first names (256 halfwords and 64 fine ones), read
    // where it is: in O on E143 and E147, which copy it there, in the image on PEN-F
    const curve = (i) => (r, d) => {
      const whole = d.reads[i].hex, p = parseInt(whole.slice(2 * Q.gamPtr, 2 * Q.gamPtr + 8).match(/../g).reverse().join(''), 16) >>> 0, off = p - base - BLOCKS.O[0];
      const hex = off >= 0 && off + 640 <= BLOCKS.O[1] ? whole.slice(2 * off, 2 * off + 1280) : dbg({ op: 'read', addr: p, size: 640 }).hex ?? '', v = decode(hex, 'u16s');
      return [{ name: 'curve', at: `(O+${Q.gamPtr})`, bytes: 640, value: sha16(hex) }, { name: 'curve samples', at: `(O+${Q.gamPtr})`, bytes: 640, value: [0, 1, 64, 128, 255, 256, 319].map((i) => v[i]) }];
    };
    const gammaOut = [...[0, 1, 2].map((i) => ({ name: `pointer ${i}`, b: 'O', o: Q.gamPtr + 4 * i, n: 4, as: 'ptr' })), { name: 'all', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }];
    const lutOut = [{ name: 'pointer', b: 'O', o: Q.lutp, n: 4, as: 'ptr' }, { name: 'all', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }];
    const stepOut = [{ name: 'words', b: 'O', o: Q.step[0], n: Q.step[1], as: 'u32s' }, { name: 'all', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }];
    const gam = {}, lutR = {}, stepR = {};
    for (const k of [11, 12]) {
      gam[k] = row('gamma', `gamma key ${k}`, C0, job(k), gammaOut, { more: curve(3) });
      lutR[k] = row('lut', `lut key ${k}`, C0, job(k), lutOut);
      stepR[k] = row('tonestep', `tonestep key ${k}`, C0, job(k), stepOut);
    }
    if (!failed) {
      const cs = val(gam[11], 'curve samples');
      ok(cs[0] === 0 && cs.slice(0, 5).every((v, i) => i === 0 || v > cs[i - 1]) && cs[4] === Q.curveTop, `the gamma stage's first pointer names a curve that rises to ${Q.curveTop}: ${[0, 1, 2].map((i) => val(gam[11], `pointer ${i}`))}, ${cs}`);
      ok(val(lutR[11], 'pointer') === val(tone[11], 'pointer'), `the LUT builder leaves the tone selector's address for key 11 at O+${Q.lutp}: ${val(lutR[11], 'pointer')}, ${val(tone[11], 'pointer')}`);
    }

    // ---- the stage list from its entry, and its builders' outputs in it
    const listOut = [{ name: 'O', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }, { name: 'six', b: 'O', o: Q.six, n: 24, as: 's16s' }, { name: 'chroma', b: 'O', o: Q.chroma[0], n: Q.chroma[1], as: 'u32s' },
      { name: 'records', b: 'O', o: Q.recs, n: 288, as: 'sha' }, { name: 'gamma pointer', b: 'O', o: Q.gamPtr, n: 4, as: 'ptr' }, { name: 'lut pointer', b: 'O', o: Q.lutp, n: 4, as: 'ptr' }, { name: 'step', b: 'O', o: Q.step[0], n: Q.step[1], as: 'u32s' }];
    const list = {};
    for (const k of [11, 12]) list[k] = row('stages', `stages key ${k}`, C0, job(k, sat('first5')), listOut, { more: curve(0) });
    if (!failed) {
      ok(list[11].end === 'return' && val(list[11], 'records') === val(hsl.first5, 'records') && same(val(list[11], 'six'), val(six[11], 'coefficients')) && same(val(list[11], 'chroma'), val(chroma[11], 'words'))
        && val(list[11], 'curve') === val(gam[11], 'curve') && val(list[11], 'gamma pointer') === val(gam[11], 'pointer 0') && val(list[11], 'lut pointer') === val(lutR[11], 'pointer') && same(val(list[12], 'chroma'), val(chroma[12], 'words')) && same(val(list[12], 'six'), val(six[12], 'coefficients')),
        `the stage list returns, and for key 11 its HSL records, six-axis set, chroma word, gamma curve and LUT address are the builders' own: ${JSON.stringify(list[11].out.slice(1).map((o) => [o.name, o.value])).slice(0, 400)}`);
      ok(val(list[11], 'O') !== val(list[12], 'O'), 'control: key 12 gives another output block than key 11');
    }

    // ---- the register writer: the block the YC packing builder and the stage list fill (in the caller's order: the
    // packing first), copied to a page the test stands in for
    const chainOut = [{ name: 'O', b: 'O', o: 0, n: BLOCKS.O[1], as: 'rsha' }];
    const y = row('yc', 'chain: yc key 11 sv 1280 sharpness 0', C0, yc(11, 1280, 0), chainOut);
    const l2 = y && row('stages', 'chain: stages key 11 on the packed block', C0, job(11, sat('first5')), chainOut, { memExtra: [[sc('O'), y.d.reads[0].hex]] });
    // PEN-F's writer copies its last two words apart (Q.pageTail): the block gets three distinct words that are not 0
    // at O+1040..+1051 so the comparison cannot pass on zeros and O+1040's absence shows
    let copied = [];
    const tail = Q.pageTail ?? null, SENT = ['aa', '11', '22'].map((x) => x.repeat(4)).join('');
    const oHex = l2 && (tail ? l2.d.reads[0].hex.slice(0, 2 * (tail[0] - 4)) + SENT + l2.d.reads[0].hex.slice(2 * (tail[0] + 8)) : l2.d.reads[0].hex);
    const srcOf = (w) => (tail && w >= tail[0] + tail[1] ? w - tail[1] : w - Q.page);
    let tailOk = true;
    const wr = l2 && row('writer', 'chain: the register writer', { regs: { a0: sc('P'), a1: sc('O') } }, [], [{ name: 'page', b: 'P', o: 0, n: BLOCKS.P[1], as: 'rsha' }], { memExtra: [[sc('O'), oHex]], more: (r, d) => {
      const o = bytesOf(oHex), p = bytesOf(d.reads[0].hex), words = [...textSet(r.wrote)].map((x) => x - BLOCKS.P[0]).filter((x) => x % 4 === 0).sort((a, b) => a - b);
      copied = words.filter((w) => w >= Q.page && u(p, w, 4) === u(o, srcOf(w), 4));
      if (tail) tailOk = u(p, tail[0] + tail[1], 4) === 0x11111111 && u(p, tail[0] + tail[1] + 4, 4) === 0x22222222 && !words.includes(tail[0] - 4 + Q.page) && !words.includes(tail[0] - 4 + tail[1]);
      return [{ name: 'words', at: 'P', bytes: 4 * words.length, value: words.length }, { name: 'not copied', at: 'P', bytes: 4 * (words.length - copied.length), value: words.filter((w) => !copied.includes(w)).map((w) => [w, u(p, w, 4)]) },
        { name: 'packed at', at: `P+${Q.page + Q.ycw}`, bytes: 4, value: unpack(u(p, Q.page + Q.ycw, 4)) }, { name: 'S at', at: `P+${Q.page + Q.recs + 20}`, bytes: 4, value: u(p, Q.page + Q.recs + 20, 4) }];
    } });
    if (wr) {
      const other = val(wr, 'not copied');
      ok(other.length === 2 && other.every(([w, v]) => w < Q.page && v === 0) && copied.length > 100 && tailOk && same(val(wr, 'packed at'), val(ycRows['1280 0'], 'packed')) && val(wr, 'S at') === 225,
        `the writer copies ${copied.length} words of O to the page at +${Q.page}${tail ? ` (O+${tail[0]} and +${tail[0] + 4} at +${tail[0] + tail[1]} and +${tail[0] + tail[1] + 4}, O+${tail[0] - 4} not copied: ${tailOk})` : ''} (the packed word to +${Q.page + Q.ycw}, record 0's S word to +${Q.page + Q.recs + 20}) and clears two words below: ${JSON.stringify(other)}`);
    }

    // ---- the read sets and the write sets, per builder
    if (!failed) {
      for (const b of BUILDERS) {
        const z = new Set((perBuilder[b] ?? []).flatMap((r) => [...r.zero]));
        const rd = setText(readBy[b] ?? new Set()), wr = setText(wroteBy[b] ?? new Set());
        if (pin) { P.read[b] = rd; P.zero[b] = setText(z); P.wrote[b] = wr; continue; }
        for (const x of readFindings(b, (perBuilder[b] ?? []).map((r) => ({ case: r.case, zero: r.zero })), P.zero[b])) ok(false, x);
        ok(rd === P.read[b] && wr === P.wrote[b], `${b}: the job bytes its rows read and write: ${rd} | ${wr}, pinned ${P.read[b]} | ${P.wrote[b]}`);
      }
      // control: the same check on a call whose job leaves two of its fields out names them
      const bare = row('yc', 'control: yc without its sensitivity word and sharpness', C0, job(11), ycOut, { control: true });
      const found = bare ? readFindings('yc', [{ case: bare.case, zero: bare.zero }], P.zero.yc).filter((x) => /not on the pinned list/.test(x)) : [];
      ok(found.length === 1 && found[0].endsWith(`: R ${J.sv}-${J.sv + 1} ${J.sharp}`), `control: a job field left out is a read the pinned list does not have: ${JSON.stringify(found)}`);
      const out = rows.filter((r) => r.outside.length);
      ok(out.every((r) => r.builder === 'grain') && out.length === 3, `only the grain builder's three pinned rows touch memory outside the job, its stack and the image: ${out.map((r) => `${r.case}: ${r.outside}`).join('; ')}`);
    }
    t.maxHits = maxHits;
    if (pin && !failed) {
      const all = fs.existsSync(PINS) ? readPins() : {};
      all[MODEL] = P;
      const text = `{\n${Object.keys(all).sort().map((m) => `"${m}": {\n "sensitive": ${JSON.stringify(all[m].sensitive)},\n "read": {\n${Object.entries(all[m].read).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n },\n "zero": {\n${Object.entries(all[m].zero).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n },\n "wrote": {\n${Object.entries(all[m].wrote).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n },\n "cases": {\n${Object.entries(all[m].cases).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n }\n}`).join(',\n')}\n}\n`;
      fs.writeFileSync(PINS, text);
    }
  } finally {
    const sum = s.close();
    const own = (p) => p.token === 'input' && p.input?.op === 'call' && p.input.restore === true && p.input.mem.every(([a]) => /^scratch/.test(a));
    ok(sum.pokes.every(own) && sum.harness_inputs.length === 0 && (sum.traces?.hits_dropped ?? 0) === 0 && sum.errors.length === 0,
      `pokes only the calls' writes into their own scratch, put back; no harness input; no hit dropped by a step: ${JSON.stringify({ pokes: sum.pokes.filter((p) => !own(p)).length, harness: sum.harness_inputs, dropped: sum.traces?.hits_dropped, errors: sum.errors })}`);
  }
  return t;
}

// the session's rows as the --json document
export function stagesDocument(t) {
  const B = BODIES[t.model];
  return { model: t.model, assumption: 'A-STAGEJOB: the job is the test\'s, zero but for the fields each row lists; a camera\'s job is unknown, so a value is the builder\'s answer to this job, not a camera\'s value (emu/FIDELITY-NOTES.md 8.2)',
    tags: 'X ran (om-emu\'s call op on the stock block); every fn is a CALL target read in the block (D); the fields\' and outputs\' names are I',
    blocks: { C: 'the job context (a0)', R: 'the request (C+4)', G: 'the second output block (C+8)', O: 'the output block (C+12)', M: 'the test\'s own bytes', P: 'the test\'s stand-in for the unit\'s page' },
    builders: Object.fromEntries(Object.entries(B.fn).map(([k, f]) => [k, { fn: h8(f.entry), frame: f.frame, call_sites: f.sites.map(h8) }])),
    max_hits_per_call: t.maxHits, rows: t.rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const has = (x) => process.argv.includes(x), json = has('--json'), pin = has('--pin');
  const all = !has('--units') && !has('--session') && !json && !pin;
  let fail = 0;
  if (all || has('--units')) {
    const un = stagesUnits();
    console.log(`the still's stage builders, units: ${un.checks - un.bad.length}/${un.checks}`);
    un.bad.forEach((x) => console.log('  ', x));
    fail += un.bad.length;
  }
  if (all || has('--session') || json || pin) {
    const s = await stagesSession({ pin });
    const line = `the still's stage builders, ${s.model}: ${s.checks - s.bad.length}/${s.checks} (${s.rows.length} rows; at most ${s.maxHits ?? '?'} hits a call, none dropped)${pin ? `; pinned in ${path.relative(process.cwd(), PINS)}` : ''}`;
    if (json) {                 // one JSON document, a row a line
      const { rows, ...head } = stagesDocument(s);
      console.log(`${JSON.stringify(head).slice(0, -1)},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}`);
      console.error(line);
    } else console.log(line);
    s.bad.forEach((x) => (json ? console.error : console.log)('  ', x));
    fail += s.bad.length;
  }
  process.exitCode = fail ? 1 : 0;       // not exit(): --json's document may still be on its way to a pipe
}
