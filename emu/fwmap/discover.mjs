// Code discovery over a main block: recursive descent from the known entry points, extended to a fixpoint by validated
// code pointers (32-bit immediates in discovered code, aligned words outside it) and resolved jump tables.
//
// Evidence is taken in order of strength, each phase drained before the next, so weak evidence never claims bytes that
// strong evidence would:
//   1. roots: reset and the CPU 1..3 entries, the entries of the four static task tables, the seven interrupt vector
//      slots, and every direct CALL/CALLS target reached from them (trusted: no prologue required);
//   2. 'ptr-imm': `mov imm32,An/Dn` values in discovered code that point into the run-time image, accepted when the
//      target has a frame prologue (movm [..],(sp) or add -n,sp) or a function end right before it, or is the target
//      of a `mov imm32,An; calls/jmp (An)`, and a trial descent from it succeeds;
//   3. 'ptr-data': aligned words outside code that point into the run-time image (vtables, handler and command
//      tables, task bodies), under the same rule; jump tables in data tied to the nearest unresolved `jmp (An)` below
//      their targets; then the direct call targets with neither prologue nor function end before them that have two
//      or more call sites;
//   4. 'exec': seeds, instruction starts emu executed that phases 1-3 left out (bin/fwmap.mjs pins them, fwmap/
//      E143.seeds.json), each taken from the lowest offset up.
// A trial descent fails on an invalid opcode, a branch out of the image or an overlap with discovered instructions,
// and then nothing of it is kept, except that a trial from strong evidence (roots, tasks, vectors, seeds) prunes the
// failing path instead and any trial prunes the fall-through of a call that does not return.
import { decode, operands, u32, s16, s32 } from './isa.mjs';
import { ROOTS, TASK_TABLES } from './e143.mjs';

const TRIAL_LIMIT = 200000;

// A frame prologue at o: movm [regs],(sp) or add -n,sp.
export function prologue(img, o) {
  const op = img[o], p = img[o + 1];
  if (op === 0xcf) return true;
  if (op === 0xf8 && p === 0xfe) return (img[o + 2] << 24 >> 24) < 0;
  if (op === 0xfa && p === 0xfe) return s16(img, o + 2) < 0;
  if (op === 0xfc && p === 0xfe) return s32(img, o + 2) < 0;
  return false;
}

// The instruction ending right before o is a function end: ret/retf, rets/rti, jmp (An), bra, jmp d16/d32, or padding
// (nop, 0xff); its name or null (read from the bytes o - 5 .. o - 1 alone).
export function boundary(img, o) {
  const b = (k) => (o - k >= 0 ? img[o - k] : -1);
  if ((b(3) === 0xde || b(3) === 0xdf) && (b(2) & 7) === 0) return 'ret';
  if (b(2) === 0xf0 && (b(1) === 0xfc || b(1) === 0xfd)) return 'rets';
  if (b(2) === 0xf0 && b(1) >= 0xf4 && b(1) <= 0xf7) return 'ijmp';
  if (b(2) === 0xca) return 'bra';
  if (b(3) === 0xcc) return 'jmp16';
  if (b(5) === 0xdc) return 'jmp32';
  if (b(1) === 0xcb) return 'nop';
  if (b(1) === 0xff) return 'pad';
  return null;
}

// The static task entries: {cpu, id, entry (body offset), table, index}; base: the run-time image base.
export function taskEntries(img, base) {
  const out = [];
  for (const [rt, n, cpu] of TASK_TABLES) {
    for (let i = 0; i < n; i++) {
      const e = rt - base + 28 * i;
      out.push({ cpu, id: u32(img, e), entry: (u32(img, e + 12) - base) >>> 0, table: rt, index: i });
    }
  }
  return out;
}

// The interrupt vectors: the seven level slots the vector init loads into the IVARs (src/fw/facts.mjs vectorPage: the
// run of `mov imm32,Dn; movhu Dn,(0x80LL)`), as body offsets.
export function vectorEntries(img, base) {
  for (let o = img.indexOf(0xfc); o >= 0 && o + 66 <= img.length; o = img.indexOf(0xfc, o + 1)) {
    const out = [];
    for (let level = 0; level < 7; level++) {
      const q = o + 9 * level, n = img[q + 1] - 0xcc;
      if (!(img[q] === 0xfc && n >= 0 && n < 4 && img[q + 6] === 0x03 + 4 * n && img[q + 7] === 4 * level && img[q + 8] === 0x80)) break;
      out.push((u32(img, q + 2) - base) >>> 0);
    }
    if (out.length === 7) return out;
  }
  return [];
}

// A jump table read by `mov (Di,Aa),Ar; jmp (Ar)` with Aa from a mov imm32 (the table's body offset): u32 run-time
// code addresses. The count is the bound of the last `cmp imm,Di` in the run (+1) when it compares the index
// register, else at most 1024; a case label lies within 64 KiB of its jmp (An) (site), so the table ends at the first
// word that does not.
function switchTable(img, base, table, ireg, lastCmp, N, site) {
  if (table + 4 > N) return null;
  const bounded = lastCmp && lastCmp[0] === ireg && lastCmp[1] >= 0 && lastCmp[1] < 4096;
  const n = bounded ? lastCmp[1] + 1 : 1024, targets = [];
  for (let k = 0; k < n && table + 4 * k + 4 <= N; k++) {
    const t = (u32(img, table + 4 * k) - base) >>> 0;
    if (t >= N || Math.abs(t - site) > 0x10000) break;
    targets.push(t);
  }
  return targets.length ? { table, count: targets.length, bounded, targets } : null;
}

// Strong evidence: a trial from these prunes a failing path anywhere; any other prunes only the fall-through of a call.
const TOLERANT = new Set(['root', 'task', 'vector', 'exec']);

// img: the main block; base: its run-time image base; seeds: body offsets for phase 4. Returns the code map (state per
// byte: 0 not code, 1 instruction start, 2 interior; phaseOf per instruction start), the entries (offset -> Set of
// evidence kinds), pointer quality, the jump tables, the unresolved jmp (An) sites, labels, rejected candidates,
// external call targets, and seedsTaken (the seeds that were still undiscovered when phase 4 reached them).
export function discover(img, { base, log = () => {}, seeds = [] } = {}) {
  const N = img.length;
  const state = new Uint8Array(N);
  const phaseOf = new Uint8Array(N);
  let phase = 1;
  const gen = new Int32Array(N);           // trial stamps
  const tk = new Uint8Array(N);            // trial kinds (valid where gen === g): 1 start, 2 interior
  let g = 0;
  const entries = new Map();
  const addEntry = (o, kind) => { let s = entries.get(o); if (!s) entries.set(o, s = new Set()); s.add(kind); };
  const external = new Map();             // call targets outside the block (the local window, 0x3ffe1xxx in disassembly notation)
  const rejected = new Map();             // "kind: reason" -> count
  const switchSites = new Map();          // jmp (An) offset -> {table, count, bounded, targets}
  const unresolvedIjmp = new Set();
  const labels = new Set();               // pointer targets that are instruction starts inside a function (not entries)
  const constJumps = new Set();           // targets of mov imm32,An; calls/jmp (An)
  const callSites = new Map();            // call target -> Set of call instruction offsets (of any trial)
  const reject = (kind, reason) => { const k = `${kind}: ${reason}`; rejected.set(k, (rejected.get(k) ?? 0) + 1); };

  // A trial descent from entry: {ok, insns, calls, ptrs} or {ok: false, reason}. Tolerant: a path that meets an
  // invalid opcode, leaves the image or overlaps known code is pruned there (the fall-through of a call that does not
  // return, a branch on a condition that cannot hold); strict: only the fall-through right after a call is. The entry
  // itself must decode.
  let pruned = 0;
  function trial(entry, tolerant = false) {
    g++;
    const insns = [], calls = [], ptrs = [], stack = [entry];
    let n = 0, first = true;
    const fail = (reason, afterCall) => { if (!first && (tolerant || afterCall)) { pruned++; return null; } return { ok: false, reason }; };
    const mark = (o, len) => { gen[o] = g; tk[o] = 1; for (let k = 1; k < len; k++) { gen[o + k] = g; tk[o + k] = 2; } };
    const seen = (o) => state[o] === 1 || (gen[o] === g && tk[o] === 1);
    const interior = (o) => state[o] === 2 || (gen[o] === g && tk[o] === 2);
    while (stack.length) {
      let o = stack.pop();
      const areg = [null, null, null, null];           // mov imm32,An constants (for the next instruction only)
      const tload = [null, null, null, null];          // An loaded from (Di,Aa) with Aa a constant: [table, Di]
      let lastCmp = null;                              // the last cmp imm,Dn: [n, imm]
      let afterCall = false;                           // o is the fall-through of a call
      for (;;) {
        let f = null;
        if (o < 0 || o >= N) { f = fail('branch out of image', false); if (f) return f; break; }
        if (seen(o)) break;
        if (interior(o)) { f = fail('overlap (lands inside an instruction)', afterCall); if (f) return f; break; }
        const d = decode(img, o);
        if (!d.valid) { f = fail('invalid opcode', afterCall); if (f) return f; break; }
        if (o + d.len > N) { f = fail('runs off the image', afterCall); if (f) return f; break; }
        let cover = false;
        for (let k = 1; k < d.len; k++) if (state[o + k] !== 0 || gen[o + k] === g) cover = true;
        if (cover) { f = fail('overlap (covers an instruction)', afterCall); if (f) return f; break; }
        first = false;
        afterCall = d.kind === 'call' || d.kind === 'icall';
        mark(o, d.len); insns.push(o); n++;
        if (n > TRIAL_LIMIT) return { ok: false, reason: 'too long' };
        // register constants hold for the next instruction only (other writes to An are not tracked)
        const pa = areg.slice(), pt = tload.slice();
        areg.fill(null); tload.fill(null);
        {
          const op = img[o], p = img[o + 1];
          if (op === 0xf3 && p >= 0x80 && p <= 0xbf) {           // mov (Di,Aa),Ar
            const a = p & 3, i = (p >> 2) & 3, rr = (p >> 4) & 3;
            tload[rr] = pa[a] !== null ? [pa[a], i] : null;
          } else if (op >= 0xa0 && op <= 0xaf && ((op >> 2) & 3) === (op & 3)) lastCmp = [op & 3, img[o + 1] << 24 >> 24];
          else if (op === 0xfa && p >= 0xc8 && p <= 0xcb) lastCmp = [p & 3, s16(img, o + 2)];
          else if (op === 0xfc && p >= 0xc8 && p <= 0xcb) lastCmp = [p & 3, s32(img, o + 2)];
        }
        for (const x of operands(img, o)) {
          if (x.how === 'imm32a' || x.how === 'imm32d') {
            const t = (x.v - base) >>> 0;
            if (t < N) ptrs.push(t);
            if (x.how === 'imm32a') areg[img[o + 1] & 3] = t < N ? t : null;
          }
        }
        const k = d.kind;
        if (k === 'call') {
          if (d.target >= 0 && d.target < N) { calls.push(d.target); let cs = callSites.get(d.target); if (!cs) callSites.set(d.target, cs = new Set()); cs.add(o); }
          else external.set(d.target, (external.get(d.target) ?? 0) + 1);
        } else if (k === 'cond') stack.push(d.target);
        else if (k === 'icall') {
          const t = pa[img[o + 1] & 3];
          if (t !== null) { calls.push(t); constJumps.add(t); }
        }
        if (k === 'jmp') { o = d.target; continue; }
        if (k === 'ijmp') {
          const t = pa[d.reg];
          if (t !== null) { constJumps.add(t); o = t; continue; }   // mov imm32,An; jmp (An) (the reset head's jump)
          const sw = pt[d.reg] ? switchTable(img, base, pt[d.reg][0], pt[d.reg][1], lastCmp, N, o) : null;
          if (sw) { switchSites.set(o, sw); for (const c of sw.targets) stack.push(c); }
          else unresolvedIjmp.add(o);
          break;
        }
        if (k === 'ret' || k === 'lra' || k === 'stop') break;
        o += d.len;
      }
    }
    return { ok: true, insns, calls, ptrs };
  }
  function commit(t) {
    for (const o of t.insns) {
      const len = decode(img, o).len;
      state[o] = 1; phaseOf[o] = phase;
      for (let k = 1; k < len; k++) state[o + k] = 2;
    }
  }
  // the instruction that ends right before o and falls through into it (o is then a label inside a function)
  function fallsInto(o) {
    for (let s = Math.max(0, o - 7); s < o; s++) {
      if (state[s] !== 1) continue;
      const d = decode(img, s);
      if (s + d.len === o && (d.kind === 'seq' || d.kind === 'cond' || d.kind === 'call' || d.kind === 'icall' || d.kind === 'loop')) return true;
    }
    return false;
  }
  const weakCalls = new Set();
  const quality = new Map();             // pointer entry -> 'prologue+end' | 'prologue' | 'end'
  const deferred = [];                   // ptr-imm candidates found while draining
  const queue = [];
  function take(o, kind, entry = true) {
    if (o < 0 || o >= N) return;
    const ptr = kind === 'ptr-imm' || kind === 'ptr-data';
    // a direct call target in new territory with neither a frame prologue nor a function end before it waits until
    // the end of phase 3 and is then taken only with two or more call sites (a lone call into the middle of nowhere
    // is more often a misdecoded caller than a function that follows data)
    if (kind === 'call' && state[o] === 0 && !prologue(img, o) && boundary(img, o) === null) { weakCalls.add(o); return; }
    if (kind === 'ptr-data' && !prologue(img, o) && /^(bra|jmp16|jmp32|ijmp)$/.test(boundary(img, o) ?? '')) entry = false;
    if (state[o] === 1) {
      if (entry && (!ptr || !fallsInto(o))) addEntry(o, kind); else labels.add(o);
      return;
    }
    if (state[o] === 2) { reject(kind, 'inside an instruction'); return; }
    if (ptr && !constJumps.has(o)) {
      // a pointer target must look like a function start: a frame prologue or a function end before it
      const pro = prologue(img, o), bk = boundary(img, o), bnd = bk !== null;
      if (!(pro || bnd)) { reject(kind, 'no prologue, no function end before it'); return; }
      // after a jump (bra, jmp, jmp (An)) and without a prologue a data word's target is taken for a case label of a
      // jump table not tied to its jmp (An): code, but not a function entry (direct call targets follow a jump in
      // 0.4% of cases, a ret in 92%)
      if (kind === 'ptr-data' && !pro && (bk === 'bra' || bk === 'jmp16' || bk === 'jmp32' || bk === 'ijmp')) entry = false;
      else quality.set(o, pro && bnd ? 'prologue+end' : pro ? 'prologue' : 'end');
    }
    const t = trial(o, TOLERANT.has(kind));
    if (!t.ok) { reject(kind, t.reason); return; }
    commit(t);
    if (entry) addEntry(o, kind); else labels.add(o);
    for (const c of t.calls) queue.push([c, 'call']);
    for (const p of t.ptrs) deferred.push(p);
  }
  const drain = () => { for (let i = 0; i < queue.length; i++) take(queue[i][0], queue[i][1]); queue.length = 0; };
  const drainDeferred = () => { while (deferred.length) { const c = [...new Set(deferred)]; deferred.length = 0; for (const p of c) { queue.push([p, 'ptr-imm']); drain(); } } };
  const insnCount = () => count(state);

  for (const [o] of ROOTS) queue.push([o, 'root']);
  for (const t of taskEntries(img, base)) if (t.entry < N) queue.push([t.entry, 'task']);
  for (const v of vectorEntries(img, base)) queue.push([v, 'vector']);
  drain();
  log(`phase 1 (roots, task tables, vectors, direct calls): ${insnCount()} insns, ${entries.size} entries`);
  phase = 2;
  for (let round = 0; deferred.length && round < 50; round++) {
    const cands = [...new Set(deferred)]; deferred.length = 0;
    for (const p of cands) { queue.push([p, 'ptr-imm']); drain(); }
  }
  log(`phase 2 (mov imm32 pointers): ${insnCount()} insns, ${entries.size} entries`);
  phase = 3;
  // Jump tables whose base the descent could not track (`jmp (An)` with An not a mov imm32 right before): runs of
  // aligned words outside code, each a run-time address within 0x4000 bytes after the same unresolved jmp (An) site J
  // (the nearest one below it), at least two words, none with a prologue: J's case labels, not function entries.
  const tableWord = new Uint8Array(N >>> 2);
  const associate = () => {
    const U = [...unresolvedIjmp].sort((a, b) => a - b);
    const below = (t) => { let lo = 0, hi = U.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (U[m] < t) { r = m; lo = m + 1; } else hi = m - 1; } return r < 0 ? -1 : U[r]; };
    let found = 0;
    for (let o = 0; o + 4 <= N; o += 4) {
      if (tableWord[o >>> 2] || state[o] || state[o + 1] || state[o + 2] || state[o + 3]) continue;
      const t0 = (u32(img, o) - base) >>> 0;
      const J = t0 >= N ? -1 : (() => { const j = below(t0); return j >= 0 && t0 - j <= 0x4000 ? j : -1; })();
      if (J < 0) continue;
      let k = o;
      const targets = [];
      for (; k + 4 <= N && !state[k] && !state[k + 1] && !state[k + 2] && !state[k + 3]; k += 4) {
        const t = (u32(img, k) - base) >>> 0;
        if (t >= N || t <= J || t - J > 0x4000 || below(t) !== J) break;
        targets.push(t);
      }
      if (targets.length < 2 || targets.some((t) => prologue(img, t))) continue;
      for (let q = o; q < k; q += 4) tableWord[q >>> 2] = 1;
      unresolvedIjmp.delete(J);
      switchSites.set(J, { table: o, count: targets.length, bounded: false, associated: true, targets });
      found++;
      for (const t of targets) { queue.push([t, 'switch']); for (let i = 0; i < queue.length; i++) take(queue[i][0], queue[i][1], i > 0); queue.length = 0; }
      o = k - 4;
    }
    return found;
  };
  for (let round = 0; round < 10; round++) {
    const n = associate();
    log(`jump tables tied to an unresolved jmp (An), round ${round}: ${n}`);
    if (!n) break;
  }
  for (let round = 0; round < 8; round++) {
    const before = entries.size;
    for (let o = 0; o + 4 <= N; o += 4) {
      if (tableWord[o >>> 2] || state[o] || state[o + 1] || state[o + 2] || state[o + 3]) continue;
      const t = (u32(img, o) - base) >>> 0;
      if (t >= N) continue;
      queue.push([t, 'ptr-data']);
      drain();
      drainDeferred();
    }
    const sw = associate();
    log(`phase 3 round ${round} (data words): ${insnCount()} insns, ${entries.size} entries, ${sw} more jump tables`);
    if (entries.size === before) break;
  }
  {
    let taken = 0;
    for (let round = 0; round < 4; round++) {
      const list = [...weakCalls].filter((o) => state[o] === 0);
      weakCalls.clear();
      let n = 0;
      for (const o of list) {
        const sites = [...(callSites.get(o) ?? [])].filter((c) => state[c] === 1);
        if (sites.length >= 2) { queue.push([o, 'call-weak']); drain(); n++; } else weakCalls.add(o);
      }
      taken += n;
      if (!n) break;
    }
    const left = [...weakCalls].filter((o) => state[o] === 0);
    log(`call targets without prologue or function end: ${taken} taken (2+ call sites), ${left.length} left out (1 call site)`);
    for (const o of left) reject('call', 'lone call site, no prologue, no function end before it');
  }
  // case labels of the jump tables tied after their targets were taken for function pointers: demoted to labels when
  // the table's data words were their only evidence
  let demoted = 0;
  for (const sw of switchSites.values()) {
    for (const t of sw.targets) {
      const e = entries.get(t);
      if (e && [...e].every((k) => k === 'ptr-data' || k === 'switch')) { entries.delete(t); quality.delete(t); labels.add(t); demoted++; }
    }
  }
  log(`case labels demoted from entries: ${demoted}`);
  phase = 4;
  const seedsTaken = [];
  for (const o of [...new Set(seeds)].filter((x) => x < N).sort((a, b) => a - b)) {
    if (state[o] !== 0) continue;
    seedsTaken.push(o);
    const bnd = boundary(img, o) !== null;
    queue.push([o, 'exec']);
    for (let i = 0; i < queue.length; i++) take(queue[i][0], queue[i][1], i > 0 || bnd);
    queue.length = 0;
    drainDeferred();
  }
  log(`phase 4 (seeds: executed instructions phases 1-3 left out): ${seedsTaken.length} seeds taken, ${insnCount()} insns, ${entries.size} entries`);
  log(`paths pruned (invalid / out of image / overlap after a call, or anywhere in trusted code): ${pruned}`);
  return { state, phaseOf, quality, entries, external, rejected, switchSites, unresolvedIjmp, labels, constJumps, seedsTaken };
}
export function count(state) { let n = 0; for (let i = 0; i < state.length; i++) if (state[i] === 1) n++; return n; }
