// Cross-build address map: where the code and data addresses of one build of the firmware (E143, the build the lab's
// tables are written against) are in another build of the same family (E146, E147, ...). Pure and Worker-safe: the two
// main code blocks come in as byte arrays, each with its run-time base (MODELS image_base: byte 0 of the block runs
// there; E143 0x60021020, E129 0x60400020).
//
// Instructions are compared normalized: the opcode bytes, registers and 8-bit fields are kept, 16- and 32-bit
// immediates and displacements are masked, since they are what a rebuild moves. A window of K normalized instructions
// that occurs exactly once in each build is an anchor; from an anchor both builds are walked forward instruction by
// instruction while they stay equal (across function ends too, since the linker keeps the order), and every walked
// pair is a code pair. The masked operands of an equal pair give more: a call's or jump's two targets are a code pair
// that seeds a new walk, and two 32-bit immediates are a data vote (a global, a table, a string, a function pointer).
import { insnLength } from '../core/cpu.mjs';

// the disassembly notation of either build: block offset + CODE_BASE (src/fw/model.mjs)
export const CODE_BASE = 0x50000000;

const opLen = (b, o) => { const op = b[o]; return insnLength(op, op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? b[o + 1] : 0); };
// whether byte i of an instruction of length L with opcode op (and second byte p) is masked
function masked(op, L, i) {
  if (i === 0) return false;
  if (op >= 0xf0 && op <= 0xfe && op !== 0xf7) {
    if (i === 1 || op === 0xf8 || op === 0xf9) return false;
    if (op === 0xfe) return i >= 3;
    return L >= 4;                                     // fa/fb imm16 or d16, fc/fd imm32 or d32
  }
  if (op === 0xcd) return i <= 2;                      // call d16, regs, sp adjustment
  if (op === 0xdd) return i <= 4;                      // call d32, regs, sp adjustment
  if (op === 0xde || op === 0xdf) return false;        // ret / retf regs, sp adjustment
  return L >= 3;                                       // abs16 / imm16 / d16 forms, jmp d16 / d32
}
// the normalized token of the instruction at o (FNV-1a over its kept bytes and its length)
function token(b, o, L) {
  let h = 0x811c9dc5 ^ L;
  const op = b[o];
  for (let i = 0; i < L; i++) { h = Math.imul(h ^ (masked(op, L, i) ? 0x100 : b[o + i]), 0x01000193); }
  return h >>> 0;
}
// the loose token: the opcode (and the second opcode byte of the f0..fe forms) and the length only, every operand
// masked: a rebuild that changes a frame size or an 8-bit constant keeps it
function looseToken(b, o, L) {
  const op = b[o];
  let h = Math.imul(0x811c9dc5 ^ L, 0x01000193) ^ op;
  if (op >= 0xf0 && op <= 0xfe && op !== 0xf7) h = Math.imul(h, 0x01000193) ^ b[o + 1];
  return Math.imul(h, 0x01000193) >>> 0;
}
// the used length of a block (trailing 0xff erased flash cut off)
function usedLength(b) { let n = b.length; while (n > 0 && b[n - 1] === 0xff) n--; return n; }

// Per-offset tokens and lengths of a whole block (every byte offset, since instruction starts are not known).
function tokenize(b) {
  const n = usedLength(b), tok = new Uint32Array(n), ltok = new Uint32Array(n), len = new Uint8Array(n);
  for (let o = 0; o < n; o++) { const L = opLen(b, o); len[o] = L; if (o + L <= n) { tok[o] = token(b, o, L); ltok[o] = looseToken(b, o, L); } }
  return { n, tok, ltok, len };
}
function windowHash(t, o, K, loose = false) {
  const tk = loose ? t.ltok : t.tok;
  let h = 0x9e3779b9;
  for (let k = 0; k < K; k++) { if (o >= t.n) return null; h = Math.imul(h ^ tk[o], 0x01000193) ^ (h >>> 15); o += t.len[o]; }
  return h >>> 0;
}
const s16 = (b, o) => (b[o] | b[o + 1] << 8) << 16 >> 16, u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
// The target of a control transfer with a masked displacement at o (an offset in the block), or null. The code runs in
// its run-time copy (base + o) and the displacement is relative, so a target inside the image is the offset o + d
// whatever the base; a target outside it is returned as {abs: its run-time address}, base + o + d: the flash library
// the code calls there (memcpy, memset, ...; not in this block) sits at an absolute address of its own (E143 flash
// 0x5000xxxx, E129 RAM 0x4700xxxx, X), which only the base gives.
function transferTarget(b, o, base) {
  const op = b[o], p = b[o + 1];
  let d;
  if (op === 0xcc || op === 0xcd) d = s16(b, o + 1);
  else if (op === 0xdc || op === 0xdd) d = u32(b, o + 1) | 0;
  else if (op === 0xfa && p === 0xff) d = s16(b, o + 2);
  else if (op === 0xfc && p === 0xff) d = u32(b, o + 2) | 0;
  else return null;
  const t = o + d;
  return t >= 0 && t < b.length ? t : { abs: (base + t) >>> 0 };
}

// Builds the map. a, b: the two main code blocks; baseA, baseB: their run-time bases. seeds: offsets in a to anchor
// first (the lab's addresses). Returns {code: Int32Array (offset in a -> offset in b, -1 unknown), data: Map(value in a
// -> Map(value in b -> votes)), calls: Map(offset in a -> Map(offset in b -> paired transfers)), ext: Map(run-time
// address in a -> Map(run-time address in b -> paired transfers)) for the targets outside the images, stats}.
export function buildMap(a, b, { baseA, baseB, seeds = [], K = 12, Kmax = 48, log = () => {} } = {}) {
  if (!Number.isInteger(baseA) || !Number.isInteger(baseB)) throw new Error('buildMap: baseA and baseB (the run-time bases) are required');
  const ta = tokenize(a), tb = tokenize(b);
  log(`tokenized ${ta.n} and ${tb.n} bytes`);
  const code = new Int32Array(a.length).fill(-1), data = new Map(), calls = new Map(), ext = new Map();
  let walked = 0, walks = 0, conflicts = 0;
  const queue = [];
  // a vote from an instruction pair that is equal but for its operands counts 4, from a loose pair 1
  const vote = (va, vb, w) => { let m = data.get(va); if (!m) data.set(va, m = new Map()); m.set(vb, (m.get(vb) ?? 0) + w); };
  const pair = (map, ka, kb) => { let m = map.get(ka); if (!m) map.set(ka, m = new Map()); m.set(kb, (m.get(kb) ?? 0) + 1); };
  // A walk pairs instructions while they are equal, or equal but for operands (a loose pair) for at most LOOSE in a row.
  const LOOSE = 48;
  function walk(oa, ob) {
    walks++;
    let looseRun = 0;
    for (let steps = 0; steps < 1 << 20; steps++) {
      if (oa >= ta.n || ob >= tb.n || ta.len[oa] !== tb.len[ob] || ta.ltok[oa] !== tb.ltok[ob]) return;
      if (ta.tok[oa] === tb.tok[ob]) looseRun = 0; else if (++looseRun > LOOSE) return;
      if (code[oa] !== -1) { if (code[oa] !== ob) conflicts++; return; }
      code[oa] = ob; walked++;
      const op = a[oa], L = ta.len[oa];
      const xa = transferTarget(a, oa, baseA);
      if (xa !== null) {
        const xb = transferTarget(b, ob, baseB);
        if (typeof xa === 'object' && typeof xb === 'object') pair(ext, xa.abs, xb.abs);
        else if (typeof xa === 'number' && typeof xb === 'number' && xa < ta.n && xb < tb.n) {
          queue.push([xa, xb]);
          if (ta.tok[oa] === tb.tok[ob] || op === 0xcd || op === 0xdd) pair(calls, xa, xb);
        }
      }
      else if ((op === 0xfc || op === 0xfd) && L === 6) vote(u32(a, oa + 2), u32(b, ob + 2), ta.tok[oa] === tb.tok[ob] ? 4 : 1);
      else if (op === 0xdc || op === 0xdd) { /* handled above */ }
      oa += L; ob += L;
    }
  }
  function drain() { while (queue.length) { const [x, y] = queue.pop(); if (code[x] === -1) walk(x, y); } }

  // anchors: windows of K..Kmax instructions from each seed that occur exactly once in b
  const want = new Map();                                  // window hash (at K) -> seeds
  for (const s of seeds) { if (s < 0 || s >= ta.n) continue; const h = windowHash(ta, s, K); if (h === null) continue; let l = want.get(h); if (!l) want.set(h, l = []); l.push(s); }
  const hits = new Map();                                  // seed -> offsets in b with the same K window
  for (let o = 0; o < tb.n; o++) {
    const h = windowHash(tb, o, K);
    const l = h === null ? undefined : want.get(h);
    if (l) for (const s of l) { let m = hits.get(s); if (!m) hits.set(s, m = []); if (m.length < 64) m.push(o); }
  }
  let anchored = 0, ambiguous = 0;
  for (const s of seeds) {
    let cand = hits.get(s) ?? [];
    for (let k = K; cand.length > 1 && k <= Kmax; k += 12) { const h = windowHash(ta, s, k); cand = cand.filter((o) => windowHash(tb, o, k) === h); }
    if (cand.length === 1) { anchored++; if (code[s] === -1) { walk(s, cand[0]); drain(); } }
    else if (cand.length > 1) ambiguous++;
  }
  // loose anchors for the seeds still unplaced: longer windows of loose tokens, unique in b
  let looseAnchored = 0;
  {
    const KL = 20, wantL = new Map();
    for (const s of seeds) { if (s < 0 || s >= ta.n || code[s] >= 0) continue; const h = windowHash(ta, s, KL, true); if (h === null) continue; let l = wantL.get(h); if (!l) wantL.set(h, l = []); l.push(s); }
    const hitsL = new Map();
    if (wantL.size) for (let o = 0; o < tb.n; o++) {
      const h = windowHash(tb, o, KL, true);
      const l = h === null ? undefined : wantL.get(h);
      if (l) for (const s of l) { let m = hitsL.get(s); if (!m) hitsL.set(s, m = []); if (m.length < 64) m.push(o); }
    }
    for (const s of seeds) {
      if (s < 0 || s >= ta.n || code[s] >= 0) continue;
      let cand = hitsL.get(s) ?? [];
      for (let k = KL + 12; cand.length > 1 && k <= 80; k += 12) { const h = windowHash(ta, s, k, true); cand = cand.filter((o) => windowHash(tb, o, k, true) === h); }
      if (cand.length === 1) { looseAnchored++; walk(s, cand[0]); drain(); }
    }
  }
  // gap fill: a seed still unplaced lies between two placed instructions; its window is looked for only between their
  // places in b, where a short window is already unique
  let filled = 0;
  const near = (x, dir) => { for (let o = x, k = 0; k < 0x10000 && o >= 0 && o < ta.n; o += dir, k++) if (code[o] >= 0) return o; return -1; };
  for (const s of seeds) {
    if (s < 0 || s >= ta.n || code[s] >= 0) continue;
    const lo = near(s, -1), hi = near(s, 1);
    if (lo < 0 || hi < 0 || code[hi] <= code[lo]) continue;
    const from = code[lo], to = code[hi];
    let placed = false;
    for (const loose of [false, true]) {
      for (let k = loose ? 6 : 3; k <= (loose ? 32 : 16) && !placed; k++) {
        const h = windowHash(ta, s, k, loose); if (h === null) break;
        const cand = [];
        for (let o = from; o <= to && cand.length < 2; o++) if (windowHash(tb, o, k, loose) === h) cand.push(o);
        if (cand.length === 1) { walk(s, cand[0]); drain(); if (code[s] === -1) code[s] = cand[0]; filled++; placed = true; }
        if (cand.length === 0) break;
      }
      if (placed) break;
    }
  }
  log(`seeds ${seeds.length}: anchored ${anchored}, ambiguous ${ambiguous}, loosely anchored ${looseAnchored}, gap-filled ${filled}; walks ${walks}, instructions paired ${walked}, conflicts ${conflicts}`);
  return { code, data, calls, ext, stats: { seeds: seeds.length, anchored, ambiguous, looseAnchored, filled, walks, walked, conflicts } };
}

// The data map's best answer for a value: {to, votes, total} or null.
export function dataBest(data, va) {
  const m = data.get(va >>> 0); if (!m) return null;
  let best = null, total = 0;
  for (const [vb, n] of m) { total += n; if (!best || n > best.votes) best = { to: vb, votes: n }; }
  return { ...best, total };
}

// The call sites' answer for a code offset in a: the offset in b the paired calls and jumps to it target, when they
// all agree or one target has a strict majority of at least two of them ({to, votes, total}), else null. Over the map's
// ext, the same for a run-time address outside a's image.
export function callBest(calls, oa) {
  const m = calls.get(oa); if (!m) return null;
  let best = null, total = 0;
  for (const [ob, n] of m) { total += n; if (!best || n > best.votes) best = { to: ob, votes: n }; }
  return (best.votes >= 2 && best.votes * 2 > total) || best.votes === total ? { ...best, total } : null;
}
