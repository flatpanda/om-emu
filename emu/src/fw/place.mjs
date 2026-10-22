// Placement of one build's addresses in another through their cross-build map (src/fw/xmap.mjs): bin/port.mjs's seeds
// and rules, as pure functions of the two builds (a, the build the addresses are written against; b, the one they are
// placed in), so that one port can place E143's addresses in a model (bin/port.mjs) and a reference model's addresses
// in another (a chained port, MODELS port_via). The images are Buffers: a as the map reads it (E143's raw block, or a
// model's run-time image), b as the model's run-time image (its preload rows at their run-time addresses).
import { dataBest, callBest, CODE_BASE } from './xmap.mjs';
import { insnLength } from '../core/cpu.mjs';
import { cached, alias, callAt, valueAt } from './facts.mjs';

// a block's used length: its bytes up to the 0xff fill at the end
export const usedLength = (img) => { let n = img.length; while (n > 0 && img[n - 1] === 0xff) n--; return n; };
// a target of a's paired calls that the pairs send to b at least twice in all (map.calls, map.ext entries)
export const pairedTwice = (m) => { let n = 0; for (const k of m.values()) n += k; return n >= 2; };
export const inDram = (v) => (v >= 0x60000000 && v < 0x78000000) || (v >= 0xa0000000 && v < 0xb8000000);   // 384 MiB, both views

// The map's seeds in a for a set of a's addresses (bin/port.mjs: the lab's literals; a chained port: the reference's
// own placements), and the entries of a's called functions (alignPlace): {seeds, entries}.
export function seedsFor(a, baseA, addrs) {
  const aUsed = usedLength(a);
  // an address in its disassembly notation (CODE_BASE + offset) or in its run-time copy (baseA + offset)
  const inCode = (v) => v > CODE_BASE && v < CODE_BASE + aUsed, inCopy = (v) => v > baseA && v < baseA + aUsed;
  const seeds = [0];
  for (const v of addrs) { if (inCode(v)) seeds.push(v - CODE_BASE); else if (inCopy(v)) seeds.push(v - baseA); }
  // the instructions that load a data literal (mov imm32): anchoring them gives the literal's vote
  for (const v of addrs) {
    if (inCode(v) || !(inCopy(v) || inDram(v))) continue;
    const pat = new Uint8Array([v & 0xff, v >>> 8 & 0xff, v >>> 16 & 0xff, v >>> 24]);
    for (let i = a.indexOf(pat), n = 0; i >= 2 && n < 32; i = a.indexOf(pat, i + 1), n++) if ((a[i - 2] === 0xfc || a[i - 2] === 0xfd) && i - 2 < aUsed) seeds.push(i - 2);
  }
  // every function a's code calls at least twice: anchoring them widens the paired code, which places the addresses
  // inside functions (return addresses, observation points)
  const n = calledOffsets(a);
  for (const [t, k] of n) if (k >= 2) seeds.push(t);
  return { seeds, entries: [...n.keys()].sort((x, y) => x - y) };
}
// the functions an image's code calls (call / calls d16 / d32 targets, by byte scan with src/fw/facts.mjs callAt):
// offset -> number of calls; found once per image (the Map is shared, not to be changed)
const calledOf = new WeakMap();
export function calledOffsets(img) {
  if (calledOf.has(img)) return calledOf.get(img);
  const used = usedLength(img), n = new Map();
  calledOf.set(img, n);
  for (let o = 0; o + 7 < used; o++) {
    const c = callAt(img, o);
    if (c && c.to > 0 && c.to < used) n.set(c.to, (n.get(c.to) ?? 0) + 1);
  }
  return n;
}

// the first eight offsets (any alignment) of a little-endian word in an image, found once per image and word (the
// arrays are shared, not to be changed)
const wordsOf = new WeakMap();
function wordAt(img, w) {
  let m = wordsOf.get(img); if (!m) wordsOf.set(img, m = new Map());
  let at = m.get(w);
  if (!at) {
    const pat = new Uint8Array([w & 0xff, w >>> 8 & 0xff, w >>> 16 & 0xff, w >>> 24]);
    at = [];
    for (let i = img.indexOf(pat); i >= 0 && at.length < 8; i = img.indexOf(pat, i + 1)) at.push(i);
    m.set(w, at);
  }
  return at;
}
const ilen = (b, o) => { const op = b[o]; return insnLength(op, op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? b[o + 1] : 0); };
const skel = (b, o) => { const op = b[o]; return (op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? op << 8 | b[o + 1] : op) | ilen(b, o) << 16; };

// The other build's value of an address of a: place(v) / mapPlace(v) give {to, how} or null (not an address of the
// image or the DRAM), or {to: null} (an address that could not be placed). place: a hand override (overrides: address
// -> {to: hex or null}), then the rules (the resource loader's pairs, loaderPairs: address -> address; the other
// rules' pairs, rulePairs: address -> {to, how}, bin/port.mjs; the lab's scratch, scratch: src/fw/board.mjs scratch or
// null), then a reference's override carried over (carried: address -> {to: number or null, how}, carryOverrides'),
// then mapPlace, what the map answers. entries: seedsFor's.
// What the map answers outside the scratch is a function of the two images, their bases, the map and the entries: each
// answer is found once for every placer of that map with the same images, bases and entries (bin/port.mjs places
// through the direct map in the chained port and in the body's own placement, and several bodies in one process
// through a reference's map again); the answers are shared, not to be changed.
const answers = new WeakMap();                     // map -> [{a, b, baseA, baseB, entries, known: address -> answer}]
function answersOf({ a, b, baseA, baseB, map, entries }) {
  let l = answers.get(map); if (!l) answers.set(map, l = []);
  let m = l.find((x) => x.a === a && x.b === b && x.baseA === baseA && x.baseB === baseB && x.entries === entries);
  if (!m) l.push(m = { a, b, baseA, baseB, entries, known: new Map() });
  return m.known;
}
export function placer({ a, b, baseA, baseB, map, entries, scratch = null, loaderPairs = new Map(), rulePairs = new Map(), overrides = new Map(), carried = new Map() }) {
  const aUsed = usedLength(a);
  const inCode = (v) => v > CODE_BASE && v < CODE_BASE + aUsed, inCopy = (v) => v > baseA && v < baseA + aUsed;
  // The flash library (memcpy, memset, the core-id getter, ...) is outside the image: E143 runs it from flash
  // 0x5000xxxx, E144 from RAM 0x4700xxxx (src/fw/board.mjs library). The lab names it in the disassembly notation
  // extended below the image, run-time address - baseA + CODE_BASE (E143's memcpy 0x5000290a is 0x3ffe18ea), and only
  // the paired calls to it place it (map.ext). An address below CODE_BASE is the library's when its 64 KiB page holds a
  // target of a's out-of-image calls paired at least twice.
  const extPages = new Set([...map.ext].filter(([, m]) => pairedTwice(m)).map(([t]) => ((t - baseA + CODE_BASE) >>> 0) >>> 16));
  const inExt = (v) => v < CODE_BASE && extPages.has(v >>> 16);

  const voted = (v) => { const d = dataBest(map.data, v); return d && d.votes * 2 > d.total ? d.to >>> 0 : null; };
  // Data the map has no vote for moves with its section: the delta of the nearest voted addresses on both sides
  // (within 64 KB) when they agree, or of one within 4 KB.
  const votedKeys = [...map.data.keys()].filter((k) => voted(k) !== null && inDram(k)).sort((x, y) => x - y);
  function nearDelta(v) {
    let lo = 0, hi = votedKeys.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (votedKeys[m] < v) lo = m + 1; else hi = m; }
    const below = lo > 0 ? votedKeys[lo - 1] : null, above = lo < votedKeys.length ? votedKeys[lo] : null;
    const d = (k) => ((voted(k) - k) | 0);
    if (below !== null && above !== null && v - below < 0x10000 && above - v < 0x10000 && d(below) === d(above)) return { delta: d(below), how: 'near' };
    for (const k of [below, above]) if (k !== null && Math.abs(v - k) < 0x1000) return { delta: d(k), how: 'near1' };
    return null;
  }
  // Data in a's image copy with no vote and no agreeing neighbours: its bytes looked for in b, every word that looks
  // like an address masked (the pointers a table holds move), near where the nearest vote puts it.
  const isAddr = (w) => (w >= 0x50000000 && w < 0x52000000) || inDram(w);
  function contentPlace(v) {
    const o = v - baseA; if (o < 0 || o + 16 > aUsed) return null;
    let lo = 0, hi = votedKeys.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (votedKeys[m] < v) lo = m + 1; else hi = m; }
    const k = lo > 0 ? votedKeys[lo - 1] : votedKeys[0], guess = v + ((voted(k) - k) | 0) - baseB;   // an offset in b
    for (const L of [32, 64, 128, 256]) {
      if (o + L > aUsed) break;
      const mask = new Uint8Array(L);
      for (let i = (4 - (v & 3)) & 3; i + 4 <= L; i += 4) if (isAddr(a.readUInt32LE(o + i))) mask.fill(1, i, i + 4);
      if (mask.reduce((s, x) => s + x, 0) > L * 0.75) continue;
      // the first two offsets q in [from, to] where b holds a's unmasked bytes: the longest unmasked run is looked for
      // with Buffer.indexOf (in order, in a view that ends where a hit past to would start), each hit checked on the
      // other unmasked bytes
      let run = 0, at = 0;
      for (let i = 0, s = 0; i <= L; i++) {
        if (i < L && !mask[i]) continue;
        if (i - s > run) { run = i - s; at = s; }
        s = i + 1;
      }
      const anchor = a.subarray(o + at, o + at + run);
      const find = (from, to) => {
        const hits = [], last = Math.min(b.length - L, to);
        if (last < Math.max(0, from)) return hits;
        const view = b.subarray(0, last + at + run);
        for (let p = view.indexOf(anchor, Math.max(0, from) + at); p >= 0 && hits.length < 2; p = view.indexOf(anchor, p + 1)) {
          const q = p - at;
          let ok = true;
          for (let i = 0; i < L; i++) if (!mask[i] && a[o + i] !== b[q + i]) { ok = false; break; }
          if (ok) hits.push(q);
        }
        return hits;
      };
      // near the guess, else anywhere else
      const near = guess - 0x400000, far = guess + 0x400000;
      let hits = find(near, far);
      if (hits.length === 0) { hits = find(0, near - 1); if (hits.length < 2) hits = [...hits, ...find(far + 1, b.length)].slice(0, 2); }
      if (hits.length === 1) return (baseB + hits[0]) >>> 0;
      if (hits.length === 0) return null;
    }
    return null;
  }
  // A function the firmware reaches through a table of pointers (a static constructor list, a handler table): the slot
  // that holds it in a, and the slot at the same index in b's copy of that table, found by the table's other entries
  // that are placed (at least three agreeing).
  function tablePlace(v, base) {
    const off = v - base, rt = (baseA + off) >>> 0;
    // a pointer of a's table (a run-time address in a) -> the run-time address in b its function is placed at
    const placedRt = (w) => {
      const o = w - baseA; if (o < 0 || o >= aUsed) return null;
      const c = callBest(map.calls, o); if (c) return (baseB + c.to) >>> 0;
      return map.code[o] >= 0 ? (baseB + map.code[o]) >>> 0 : null;
    };
    const score = new Map();
    for (const i of wordAt(a, rt)) {
      for (let k = -8; k <= 8; k++) {
        if (k === 0 || i + 4 * k < 0 || i + 4 * k + 4 > a.length) continue;
        const want = placedRt(a.readUInt32LE(i + 4 * k)); if (want === null) continue;
        for (const j of wordAt(b, want)) {
          const slot = j - 4 * k; if (slot < 0 || slot + 4 > b.length) continue;
          score.set(slot, (score.get(slot) ?? 0) + 1);
        }
      }
    }
    let best = null;
    for (const [slot, s] of score) if (!best || s > best.s) best = { slot, s };
    if (!best || best.s < 3) return null;
    const w = b.readUInt32LE(best.slot), o = w - baseB;
    return o >= 0 && o < b.length ? { to: (base + o) >>> 0, how: 'table' } : null;
  }
  // An address inside a function whose own bytes changed: the function's entry (the nearest called offset before it)
  // placed by its callers or its walk, then the two bodies aligned instruction by instruction on their skeletons
  // (opcode and length; a longest common subsequence), and the address's instruction taken through the alignment.
  // A function's own entry whose first instruction changed (an argument moved to another register: E143's state log
  // 0x5124ba59 on E139, D) is aligned from the function before it: the entry is b's instruction after the return the
  // alignment pairs with the one before it, when b's code calls that instruction.
  const isReturn = (img, o) => img[o] === 0xdf || img[o] === 0xde || (img[o] === 0xf0 && img[o + 1] === 0xfc);   // ret, retf, rets
  let calledB = null;
  const calledInB = (o) => (calledB ??= calledOffsets(b)).has(o);
  function alignPlace(v, base) {
    const x = v - base, E = entries;
    let lo = 0, hi = E.length; while (lo < hi) { const m = (lo + hi) >> 1; if (E[m] <= x) lo = m + 1; else hi = m; }
    for (let back = 1; back <= 3 && lo - back >= 0; back++) {
      const fa = E[lo - back]; if (x - fa > 0x4000) break;
      const c = callBest(map.calls, fa), fb = c ? c.to : map.code[fa];
      if (fb === undefined || fb < 0) continue;
      // decode a from fa past x, b from fb over a span 1.5 times as long
      const ia = [], ib = [];
      for (let o = fa; o <= x + 32 && ia.length < 4000; o += ilen(a, o)) ia.push(o);
      if (!ia.includes(x)) continue;                  // x is not an instruction start from this entry
      const span = (x + 32 - fa) * 1.5 + 64;
      for (let o = fb; o < fb + span && ib.length < 6000; o += ilen(b, o)) ib.push(o);
      const n = ia.length, m = ib.length, L = new Uint16Array((n + 1) * (m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        L[i * (m + 1) + j] = skel(a, ia[i]) === skel(b, ib[j]) ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
      }
      if (L[0] < n * 0.7) continue;                   // the bodies are not the same function
      for (let i = 0, j = 0; i < n && j < m;) {
        if (skel(a, ia[i]) === skel(b, ib[j]) && L[i * (m + 1) + j] === L[(i + 1) * (m + 1) + j + 1] + 1) {
          if (ia[i] === x) return { to: (base + ib[j]) >>> 0, how: 'align' };
          if (ia[i + 1] === x && E[lo - 1] === x && isReturn(a, ia[i]) && j + 1 < m && calledInB(ib[j + 1])) return { to: (base + ib[j + 1]) >>> 0, how: 'align' };
          i++; j++;
        }
        else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) i++; else j++;
      }
    }
    return null;
  }
  const ENTRY_SNAP = 8;
  // A called function's entry the walks pair with an instruction of b that nothing calls: b's entry is the called
  // offset at most ENTRY_SNAP bytes before it, from which b's instructions run straight to it (no call, branch or
  // return between), when there is one. b's function opens with one more instruction there: E143's shots query
  // 0x50419164 opens `movhu d0,(32,sp)`, E134's 0x50313e2d `mov d1,(32,sp); movhu d0,(36,sp)` (its three calls
  // 0x50837644, 0x508376bc, 0x51406360 go there), and the walks paired E143's first instruction with 0x50313e2f (D).
  const isEntry = (x) => { let lo = 0, hi = entries.length; while (lo < hi) { const m = (lo + hi) >> 1; if (entries[m] < x) lo = m + 1; else hi = m; } return entries[lo] === x; };
  const straight = (o) => !callAt(b, o) && !isReturn(b, o) && !(b[o] >= 0xc0 && b[o] <= 0xcc) && b[o] !== 0xdc && !(b[o] === 0xf0 && b[o + 1] >= 0xf0);
  function entryOf(x, o) {
    if (!isEntry(x) || calledInB(o)) return null;
    for (let q = o - 1; q >= o - ENTRY_SNAP; q--) {
      if (!calledInB(q)) continue;
      let p = q;
      while (p < o && straight(p)) p += ilen(b, p);
      return p === o ? { to: (CODE_BASE + q) >>> 0, how: 'code-entry' } : null;
    }
    return null;
  }
  // A function's entry that one paired call alone places (callBest's answer from a single pairing) yields to the walks
  // where the walks pair the entry elsewhere and pair that call's target with the entry of another of a's called
  // functions: the one call was paired with a call to that other function. E125's boot chain lacks a call E143's
  // makes after the HighLevel init (0x501e9dd8), so E143's one call of the init 0x50ab22bc was paired with a call of
  // the trace print 0x50002d3f, which the walks pair with E143's trace print 0x500039f7, while they pair the init
  // with 0x507882e3, `mov (0x61f9c038),a0; call` after the create 0x50788251 as E143's (D); it also places E144's
  // inter-CPU init 0x5002ce4d at 0x500327ff, which a hand override had given while the calls hit the same print (X)
  let entryRev = null;                                   // offset in b -> the entry of a the walks pair with it
  function callContested(o, c) {
    if (c.total !== 1 || map.code[o] < 0 || map.code[o] === c.to) return false;
    if (entryRev === null) { entryRev = new Map(); for (const e of entries) if (map.code[e] >= 0 && !entryRev.has(map.code[e])) entryRev.set(map.code[e], e); }
    const e = entryRev.get(c.to);
    return e !== undefined && e !== o;
  }
  const inScratch = (v) => scratch !== null && v >= scratch.from && v < scratch.from + scratch.size;
  const known = answersOf({ a, b, baseA, baseB, map, entries });
  function place(v) {
    if (overrides.has(v)) { const o = overrides.get(v); return { to: o.to === null ? null : parseInt(o.to, 16) >>> 0, how: 'override' }; }
    if (loaderPairs.has(v)) return { to: loaderPairs.get(v), how: 'res-loader' };
    if (rulePairs.has(v)) return rulePairs.get(v);
    if (carried.has(v) && !inScratch(v)) { const c = carried.get(v); return { to: c.to, how: c.how }; }
    return mapPlace(v);
  }
  // what the map answers
  function mapPlace(v) {
    // the lab's scratch RAM, moved to the model's lab region when its firmware uses E143's (src/fw/board.mjs scratch)
    if (inScratch(v)) return { to: (v - scratch.from + scratch.base) >>> 0, how: 'scratch' };
    let r = known.get(v);
    if (r === undefined) known.set(v, r = mapAnswer(v));
    return r;
  }
  function mapAnswer(v) {
    // a function's entry: where the paired calls to it go, before the walks' pairing (a function rewritten in place
    // of an old one keeps its callers, not its bytes)
    // the flash library (inExt): only the calls to it place it, it is not in the image
    if (inExt(v)) { const c = callBest(map.ext, (v - CODE_BASE + baseA) >>> 0); return c ? { to: (c.to - baseB + CODE_BASE) >>> 0, how: 'ext-calls' } : { to: null }; }
    for (const [lo, bA, bB] of [[inCode(v), CODE_BASE, CODE_BASE], [inCopy(v), baseA, baseB]]) {
      if (!lo) continue;
      const c = callBest(map.calls, v - bA);
      if (c && !callContested(v - bA, c)) return { to: (bB + c.to) >>> 0, how: map.code[v - bA] === c.to ? 'code' : 'calls' };
    }
    // then the walks' pairing, and a table's slot only for code no walk paired: where both answered and differed, the
    // walks' was the right one (D): E143's dispatchEvent functions 0x50d744fc and 0x50d97281, which the table gave one
    // address on 16 bodies (the walks give two, each with E143's first 20 bytes), and the text callback 0x510bc7d8 on
    // 11 E144-family bodies (the walks give E143's frame of about 200 bytes, the table a 28-byte one)
    if (inCode(v)) {
      const o = map.code[v - CODE_BASE]; if (o >= 0) return entryOf(v - CODE_BASE, o) ?? { to: (CODE_BASE + o) >>> 0, how: 'code' };
      const tp = tablePlace(v, CODE_BASE); if (tp) return tp;
      const d = voted(v); if (d !== null) return { to: d, how: 'vote' };
      return alignPlace(v, CODE_BASE) ?? { to: null };
    }
    // in the copy, data first: an address the code loads is the votes' (the walks also pair data bytes as instructions)
    if (inCopy(v)) { const d = voted(v); if (d !== null) return { to: d, how: 'vote' }; const o = map.code[v - baseA]; if (o >= 0) return { to: (baseB + o) >>> 0, how: 'code' }; }
    if (inCopy(v) || inDram(v)) {
      let d = voted(v);
      if (d !== null) return { to: d, how: 'vote' };
      d = voted(alias(v));
      if (d !== null) return { to: alias(d), how: 'alias' };
      if (inCopy(v)) { const c = contentPlace(v); if (c !== null) return { to: c, how: 'content' }; }
      const n = nearDelta(cached(v));
      if (n !== null) return { to: (v + n.delta) >>> 0, how: n.how };
      // a's own address is the model's only where nothing moved it: never in a's image copy, which is another
      // build's layout even at a's base (E139, E134, E137, E125 and E145 hold unrelated bytes at E143's menu tables,
      // X), so an address there that nothing places is unplaced
      if (inCopy(v)) return { to: null };
      return { to: v, how: 'kept' };                 // a DRAM address the map has no vote for: the harness's own
    }                                                  // scratch, or firmware data to check (port.json kept)
    return null;
  }
  return { place, mapPlace };
}

// A chained port's carried overrides (MODELS port_via): a reference body's hand overrides (overrides: E143 address ->
// {to: the reference's address or null, fact?}) taken to the target through the map from the reference to the target
// (leg: that map's mapPlace), with the direct map from E143 (direct: its mapPlace) as the check. Returns {carried:
// E143 address -> {to, how, fact?}, report: {carried, carry_failed, ref_null_gated}}.
// - An address carries as leg 2 places it when the map answers by code (a walk pairing, or its entry snapped to the
//   called one, code-entry), calls, vote, alias, ext-calls, align or content. A table's slot, a section's delta
//   (near, near1) or a kept DRAM address carries only when the direct map gives the same, a table's slot also when
//   the direct map answers by another slot of a table: the slot is voted by its placed neighbours, and the
//   reference's table is laid out as the target's where E143's may not be (E144's API table lacks a slot of E143's,
//   src/fw/overrides-E144.mjs 0x50b4f28b; the one such case met, E145's API settings write through E142: leg 2 gives
//   0x50731534, whose table's API ids are E142's less one slot by slot, 0x10201 for E142's 0x10202, and the direct
//   map the next slot, 0x50731877, D); otherwise the address is unplaced (to null). When leg 2 places nothing, the direct answer stands if the walks (code, code-entry), the
//   calls, the votes or an alignment gave it (no carried entry: place() falls through to mapPlace),
//   otherwise unplaced (E139's EVF vtotal getter: leg 2 pairs none of E144's device-geometry code, the direct map
//   aligns E143's getter to 0x50021641, which E139's device switch calls for mask 2 at 0x50023448, D). Each such case
//   is in carry_failed.
// - A null carries, unless it names a fact (src/fw/facts.mjs, a path of readFacts' result) whose value differs between
//   the target and the reference: the reference lacks what the null stood for, the target may not, and the direct
//   map answers (ref_null_gated). A fact the rules do not read throws.
const LEG_SURE = new Set(['code', 'code-entry', 'calls', 'vote', 'alias', 'ext-calls', 'align', 'content']);
const DIRECT_SURE = new Set(['code', 'code-entry', 'calls', 'vote', 'align']);
export function carryOverrides({ overrides, leg, direct, factsRef, factsTgt }) {
  const carried = new Map(), report = { carried: [], carry_failed: [], ref_null_gated: [] };
  for (const [v, o] of overrides) {
    if (o.to === null) {
      if (o.fact) {
        const r = valueAt(factsRef, o.fact), t = valueAt(factsTgt, o.fact);
        if (r === undefined || t === undefined) throw new Error(`carryOverrides: no fact ${o.fact} (src/fw/facts.mjs readFacts) for the null of ${v.toString(16)}`);
        if (JSON.stringify(r) !== JSON.stringify(t)) { report.ref_null_gated.push({ v, fact: o.fact, ref: r, target: t, direct: direct(v) }); continue; }
      }
      carried.set(v, { to: null, how: 'carried', fact: o.fact });
      report.carried.push({ v, ref: null, to: null, how: 'null' });
      continue;
    }
    const p = leg(o.to), d = direct(v);
    const differs = d && d.to !== null && d.to !== p?.to ? d : undefined;
    if (p && p.to !== null && (LEG_SURE.has(p.how) || d?.to === p.to || (p.how === 'table' && d?.how === 'table'))) {
      carried.set(v, { to: p.to, how: 'carried' });
      report.carried.push({ v, ref: o.to, to: p.to, how: p.how, direct: differs });
    } else if ((!p || p.to === null) && d && d.to !== null && DIRECT_SURE.has(d.how)) {
      report.carry_failed.push({ v, ref: o.to, leg: p, direct: d, to: d.to });
    } else {
      carried.set(v, { to: null, how: 'carried' });
      report.carry_failed.push({ v, ref: o.to, leg: p, direct: d, to: null });
    }
  }
  return { carried, report };
}

// A chained port's fills (MODELS port_via): an E143 address the direct map leaves unplaced on the target (direct:
// {to: null}) and the reference has no override for takes the reference's own direct-map answer (refDirect: its
// mapPlace) through the map from the reference (leg), where the reference's map placed it by code, calls, votes or an
// alignment and leg 2 places that by LEG_SURE. The reference's map answers are found once per reference, so a second
// body of its kind meets them placed (E137's touch-panel mask set 0x50176905: the map from E143 leaves E143's
// 0x501e41d1 unplaced, E144's map places it at 0x5018a1ab, whose opening E137 repeats after a retf, D). Nothing the
// direct map places changes. addrs: the E143 addresses to fill (the lab's literals); skip: those the overrides or the
// carry answer. Returns {filled: E143 address -> {to, how: 'filled'}, report: [{v, ref, to, how}]}.
export function fillUnplaced({ addrs, skip, leg, direct, refDirect }) {
  const filled = new Map(), report = [];
  for (const v of addrs) {
    if (skip.has(v) || direct(v)?.to !== null) continue;
    const r = refDirect(v);
    if (!r || r.to === null || !DIRECT_SURE.has(r.how)) continue;
    const p = leg(r.to);
    if (!p || p.to === null || !LEG_SURE.has(p.how)) continue;
    filled.set(v, { to: p.to, how: 'filled' });
    report.push({ v, ref: r.to, to: p.to, how: p.how });
  }
  return { filled, report };
}
