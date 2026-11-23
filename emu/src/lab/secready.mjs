// Staged section availability for patched code (--sec-ready, env.secReady; off by default): the lab holds every
// section of the image from the reset (emu/FIDELITY-NOTES.md 7.18), while on the camera CPU 2's USTART_L2 copies
// section n and only then posts its per-section step, which ORs bit n - 1 into the stages' ready word (fact
// boot.stage: E143 0xa32df1f4, E146 0xa32df2cc, E147 0xa32de58c; docs/hle-gaps/4.6.md 4.6.4, D). A patch hook in an
// early section that reaches a later section before that section is in RAM boots in the lab and loops on the camera
// (caduceus-om3's crop round 7: their section-2 hook at 0x6057fb1b ran into their code in section 6 before section
// 6 was loaded, their report). Two checks, on the bodies whose section loader src/fw/facts.mjs sectionLoader reads
// (E143, E146, E147: the stage word, the copied mask and the sections are read from the image in use, a patched end
// word's value included):
//   secOrder         the static pass (patchAudit's sec_ready.static, which the hosts run at the start against the
//                    stock image): from each hook (a changed run over stock code; a run over fill is a cave) it
//                    follows the patched code it reaches, and reports a direct branch or call, or a `jmp (An)` /
//                    `calls (An)` whose An the code loaded with an immediate, into a later load tier than the
//                    hook's own section and the branch's (tier: sections 1 to 5 and the reset head's copies, 6 and
//                    7, 8 to 10, by the start tasks' stage waits, D; see tier) that no gate precedes on the path: an
//                    instruction naming the stage word or the copied mask (either DRAM view), a call of the
//                    firmware's stage test or wait, or a call of patched code that does. caduceus-om3's
//                    static:section-order rule is the model (their hooks in sections 1-5, their report). A
//                    heuristic (I): a linear decode can misread data inside a run, a gate is taken to protect all
//                    that follows it on the path, and code reached through a pointer the patch stores is not followed
//   SecReadyAudit    the run-time watch (the machine's fetch guard, src/core/cpu.mjs FG, which the interpreter calls
//                    when it decodes a pc into its cache, so at the first run of each pc; the stage bits only grow,
//                    so the first run is the earliest): an instruction on bytes the overlay changed, inside section n,
//                    run while bit n - 1 of the stage word is clear, is recorded once per section and kind: the
//                    first such pc, the word, the copied mask, the caller (MDR, the last call's return address) and
//                    the bits S-BOOTSTAGE had set by then (null: before it), with the count of instructions and of
//                    changed pieces (a changed range cut at the sections' bounds) so run and each piece's first pc
//                    (up to 8); kind 'before-bootstage', 'never-readied' (a bit S-BOOTSTAGE does not set) or
//                    'cleared'. The lab's stage word is S-BOOTSTAGE's (src/lab/menu.mjs): clear
//                    until the settings store's start, then sections 1 to 7; bits 7 to 9 stay clear, as the lab runs
//                    no CPU 1 (4.6.4). So a record before S-BOOTSTAGE is code the lab runs ahead of its stage steps
//                    (its start's order is not the camera's), and a record in sections 8 to 10 after it is code in a
//                    section whose step the lab never stands in for; neither is a camera failure by itself
// Nothing is refused: the findings are the audit's. Without the flag no guard is installed (zero cost).
import { R, MDR, insnLength } from '../core/cpu.mjs';
import { dbgRead } from '../core/mem.mjs';
import { cached } from '../fw/facts.mjs';
import { bootLoads } from '../fw/sections.mjs';

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const s32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) | 0;
const s16 = (b, o) => ((b[o] | b[o + 1] << 8) << 16) >> 16;
const s8 = (x) => (x << 24) >> 24;
const DIS = 0x50000000;
const PCS = 8;          // the run-time watch's first pcs kept per record

// The stage test (`mov (W),d1; add -1,d0; mov 1,d2; asl d0,d2; mov d2,d0; and d1,d0; beq; mov 1,d0; bra; clr d0;
// retf [d2],4`, src/fw/facts.mjs bootState's form; E147 0x50024e19) and the wait that follows it (E147 0x50024e32,
// `mov d0,d2; mov d2,d0; call TEST`, sleeps between): their image offsets, or null where the image holds no test of
// the word (test/test_bootstage.mjs reads the same pair)
const TEST_TAIL = [0x28, 0xff, 0x8a, 0x01, 0xf2, 0x92, 0x88, 0xf2, 0x04, 0xc8, 0x06, 0x80, 0x01, 0xca, 0x03, 0x00, 0xde, 0x80, 0x04];
export function stageGates(img, stage) {
  let test = null;
  for (let o = img.indexOf(0xfc); o >= 0 && o + 6 + TEST_TAIL.length <= img.length; o = img.indexOf(0xfc, o + 1)) {
    if (img[o + 1] !== 0xa5 || u32(img, o + 2) !== stage) continue;
    if (TEST_TAIL.every((b, i) => img[o + 6 + i] === b)) { test = o; break; }
  }
  return test === null ? null : { test, wait: test + 6 + TEST_TAIL.length };
}

// What the checks read of an image (img: the run-time image in use, base its run-time address, f the build's fact
// 'sections', stage the stage word's address): {base, stage, copied, sections: [{n, start, end}], head: [{start,
// end}], gates: {test, wait} run-time or null}
export function secLayout(img, base, f, stage) {
  const L = bootLoads(img, base, f), g = stageGates(img, stage);
  return { base: base >>> 0, stage: stage >>> 0, copied: f.copied >>> 0, sections: L.sections.map(({ n, start, end }) => ({ n, start, end })),
    head: L.head.map(({ start, end }) => ({ start, end })), gates: g && { test: base + g.test >>> 0, wait: base + g.wait >>> 0 } };
}

// The section that holds run-time address a (either DRAM view) in a layout: n for section n's loaded range, 0 for the
// reset head's copies, null elsewhere (a gap, outside the image)
export function sectionOf(layout, a) {
  const c = cached(a >>> 0);
  for (const s of layout.sections) if (c >= s.start && c < s.end) return s.n;
  for (const h of layout.head) if (c >= h.start && c < h.end) return 0;
  return null;
}

// The changed ranges (sorted [offset, length] of the main block) cut at the sections' bounds: [{lo, hi, n}],
// run-time, only the pieces inside a section's loaded range (the head's copies are in place from the reset, and a
// gap is S-STALERAM's)
export function patchedPieces(layout, changed) {
  const out = [];
  for (const [off, len] of changed) {
    const lo = layout.base + off, hi = lo + len;
    for (const s of layout.sections) {
      const a = Math.max(lo, s.start), b = Math.min(hi, s.end);
      if (a < b) out.push({ lo: a, hi: b, n: s.n });
    }
  }
  return out.sort((x, y) => x.lo - y.lo);
}

// One instruction's control flow for the static pass: {len, kind, target?, reg?} with kind 'call', 'jmp', 'cond',
// 'icall' (calls (An)), 'ijmp' (jmp (An)) or 'seq'; target an image offset; and a constant load into An (mov imm32 or
// imm16) as {an, v}
function flowAt(b, o) {
  const op = b[o], p = b[o + 1];
  const len = insnLength(op, op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? p : 0);
  const r = (kind, target) => ({ len, kind, target });
  if (op >= 0xc0 && op <= 0xc9) return r('cond', o + s8(p));
  if (op === 0xca) return r('jmp', o + s8(p));
  if (op === 0xcc) return r('jmp', o + s16(b, o + 1));
  if (op === 0xdc) return r('jmp', o + s32(b, o + 1));
  if (op === 0xcd) return r('call', o + s16(b, o + 1));
  if (op === 0xdd) return r('call', o + s32(b, o + 1));
  if (op === 0xf8 && p >= 0xe8 && p <= 0xeb) return r('cond', o + s8(b[o + 2]));
  if (op === 0xfa && p === 0xff) return r('call', o + s16(b, o + 2));
  if (op === 0xfc && p === 0xff) return r('call', o + s32(b, o + 2));
  if (op === 0xf0 && p >= 0xf0 && p <= 0xf3) return { len, kind: 'icall', reg: p & 3 };
  if (op === 0xf0 && p >= 0xf4 && p <= 0xf7) return { len, kind: 'ijmp', reg: p & 3 };
  if (op === 0xfc && p >= 0xdc && p <= 0xdf) return { len, kind: 'seq', an: p & 3, v: u32(b, o + 2) };
  if (op >= 0x24 && op <= 0x27) return { len, kind: 'seq', an: op & 3, v: b[o + 1] | b[o + 2] << 8 };
  return { len, kind: 'seq' };
}
// The 32-bit operands of an instruction that may name a word (an absolute load or store, a d32, an imm32 load)
function wordsAt(b, o) {
  const op = b[o], p = b[o + 1];
  if (op === 0xfc && (p <= 0x7f || (p & 0xf0) === 0x80 || (p & 0xf0) === 0xa0 || (p >= 0xcc && p <= 0xcf) || (p >= 0xdc && p <= 0xdf))) return [u32(b, o + 2)];
  if (op === 0xfe && p <= 0x02) return [u32(b, o + 2)];
  return [];
}
// a decoded run's first instruction: the changed run's start when a branch or call begins there (a hook written over
// whole instructions, a cave), else a direct branch of the stock code up to 2 bytes before it whose operand the change
// rewrote (a hook that changes a stock call's displacement alone: its opcode the stock one), else the run's start
const isBranch = (f) => f.target !== undefined || f.kind === 'icall' || f.kind === 'ijmp';
function runStart(img, stock, lo) {
  if (isBranch(flowAt(img, lo))) return lo;
  for (const k of [1, 2]) {
    const o = lo - k;
    if (o < 0) continue;
    const f = flowAt(img, o), g = flowAt(stock, o);
    if (f.target !== undefined && g.target !== undefined && f.len === g.len && o + f.len > lo) return o;
  }
  return lo;
}
const ENDS = new Set(['jmp', 'ijmp', 'ret']);
const JOIN = 8;         // the longest instruction is 7 bytes
// The load tiers the start tasks' waits give (docs/hle-gaps/4.6.md 4.6.4, D): USTART_L, USTART2 and USTART3 wait for
// stages 2, 3 and 4 at most, USTART4 first for 6 and 7, USTART5 for 8, 9 and 10 (9 is copied after stage 7, 10 after
// stage 8). So the reset head's copies and sections 1 to 5 are early (section 5, 14 KiB copied right after section 4,
// has no reader: early by caduceus-om3's convention, their hooks in sections 1-5, I), 6 and 7 the middle, 8 to 10
// late; a crossing is a branch into a later tier
export const tier = (n) => (n <= 5 ? 0 : n <= 7 ? 1 : 2);
const isRet = (b, o) => b[o] === 0xde || b[o] === 0xdf || (b[o] === 0xf0 && (b[o + 1] === 0xfc || b[o + 1] === 0xfd));

// The static pass: img the patched run-time image, stock the stock one (the same length), layout secLayout's of img,
// changed the main block's changed ranges. A changed run whose stock bytes are not all one fill (0xff or 0x00) is a
// hook: it rewrote stock code, which runs no earlier than its section is in RAM; any other is a cave, code the patch
// placed, which runs only when something branches there. From each hook the pass follows the patched code: the
// instructions from the hook on, and every branch or call into a changed run, linearly, until an unconditional jump,
// a return or the run's end (stock code past it, and a call into stock code, are leaves). A branch or call reached
// from a hook in section n into section m > n (the reset head's copies are 0, in place from the reset) is a crossing,
// gated when the path to it passed an instruction that names the stage word or the copied mask (either DRAM view), a
// call of the firmware's stage test or wait, or a call of patched code that does. Returns {hooks, crossings, gated,
// ungated: [{at, disasm, from, kind, target, to, hook}]}: at the branch (run-time), hook the hook it was reached
// from, from its section, to the target's; each branch once, from the first hook that reaches it ungated
export function secOrder(img, stock, layout, changed) {
  const base = layout.base, words = new Set([layout.stage, layout.copied].flatMap((w) => [cached(w), cached(w) + 0x40000000 >>> 0]));
  const gateCalls = new Set(layout.gates ? [layout.gates.test, layout.gates.wait] : []);
  // the changed ranges joined across gaps shorter than an instruction (new bytes that happen to equal the stock ones,
  // the 0xff of a negative displacement over fill)
  const runs = [];
  for (const [off, len] of changed) {
    const last = runs[runs.length - 1];
    if (last && off - last.hi < JOIN) last.hi = Math.max(last.hi, off + len); else runs.push({ lo: off, hi: off + len });
  }
  const runAt = (o) => {
    let lo = 0, hi = runs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (runs[m].hi <= o) lo = m + 1; else hi = m; }
    return lo < runs.length && runs[lo].lo <= o ? runs[lo] : null;
  };
  const names = (o) => wordsAt(img, o).some((v) => words.has(v));
  // a run (from o) gates by itself: it names a word or calls a stage test / wait before its end
  const gatesMemo = new Map();
  const selfGates = (o) => {
    if (gatesMemo.has(o)) return gatesMemo.get(o);
    gatesMemo.set(o, false);
    const r = runAt(o);
    let g = false;
    for (let q = o; r && q < r.hi && !g; ) {
      const f = flowAt(img, q);
      if (names(q) || (f.kind === 'call' && gateCalls.has(base + f.target >>> 0))) g = true;
      if (ENDS.has(f.kind) || isRet(img, q)) break;
      q += f.len;
    }
    gatesMemo.set(o, g);
    return g;
  };
  const hooks = runs.filter((r) => {
    const s = stock.subarray(r.lo, r.hi);
    return !(s.every((v) => v === 0xff) || s.every((v) => v === 0));
  });
  const out = { hooks: hooks.length, crossings: 0, gated: 0, ungated: [] };
  const reported = new Set(), counted = new Set();
  for (const h of hooks) {
    const start = runStart(img, stock, h.lo), from = sectionOf(layout, base + start);
    if (from === null) continue;
    const seen = new Set(), work = [[start, false]];
    while (work.length) {
      let [o, gated] = work.pop();
      const key = o * 2 + (gated ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = runAt(o) ?? (o === start ? h : null);
      if (!r) continue;
      const an = [null, null, null, null];
      while (o < img.length) {
        const f = flowAt(img, o);
        if (names(o)) gated = true;
        if (f.kind === 'call') {
          const t = base + f.target >>> 0;
          if (gateCalls.has(t) || (runAt(f.target) && selfGates(f.target))) gated = true;
        }
        const t = f.target !== undefined ? base + f.target >>> 0 : (f.kind === 'icall' || f.kind === 'ijmp') ? an[f.reg] : null;
        if (f.an !== undefined) an[f.an] = f.v;
        else if (f.kind !== 'seq') an.fill(null);
        if (t !== null) {
          const to = sectionOf(layout, t), at = base + o >>> 0;
          const here = sectionOf(layout, at);
          if (to !== null && tier(to) > tier(from) && (here === null || tier(to) > tier(here))) {
            if (!counted.has(at)) { counted.add(at); out.crossings++; if (gated) out.gated++; }
            if (!gated && !reported.has(at)) {
              reported.add(at);
              out.ungated.push({ at: h8(at), disasm: h8(DIS + o), from, kind: f.kind, target: h8(t), to, hook: h8(base + start) });
            }
          }
          const off = (cached(t) - base) | 0;
          if (runAt(off)) work.push([off, gated]);          // into patched code: followed
        }
        if (ENDS.has(f.kind) || isRet(img, o)) break;
        o += f.len;
        if (o >= r.hi) break;                              // past the run: stock code, a leaf
      }
    }
  }
  out.ungated.sort((a, b) => (a.at < b.at ? -1 : 1));
  return out;
}

// The run-time watch (see the head). layout secLayout's, changed the overlay's ranges; read(address, n) a side-effect
// free read (the lab: src/core/mem.mjs dbgRead). guard(pc, len) is the machine's fetch audit; findings the records,
// [{pc, disasm, section, kind, word, copied, caller, staged, insns, pieces, pcs}], in the order they first ran;
// staged(bits) is S-BOOTSTAGE's call
export class SecReadyAudit {
  constructor(layout, changed, { read = dbgRead } = {}) {
    this.layout = layout; this.pieces = patchedPieces(layout, changed); this.read = read;
    this.findings = []; this.bits = null; this.seen = new Set(); this.byKey = new Map();
    const p = this.pieces;
    this.lo = p.length ? p[0].lo : 0; this.hi = p.length ? Math.max(...p.map((x) => x.hi)) : 0;
    this.guard = (pc, len) => this.check(pc, len);
  }
  staged(bits) { this.bits = bits >>> 0; }
  piece(a) {
    const p = this.pieces;
    let lo = 0, hi = p.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p[m].hi <= a) lo = m + 1; else hi = m; }
    return lo < p.length && p[lo].lo <= a ? p[lo] : null;
  }
  check(pc, len) {
    const c = cached(pc >>> 0);
    if (c + len <= this.lo || c >= this.hi || this.seen.has(c)) return;
    let piece = null;
    for (let k = 0; k < len && piece === null; k++) piece = this.piece(c + k);
    if (piece === null) return;
    this.seen.add(c);
    const word = u32(this.read(this.layout.stage, 4), 0), bit = 1 << (piece.n - 1);
    if (word & bit) return;
    // one record per section and kind, counting its instructions and pieces; the first pc of each piece (up to PCS)
    const kind = this.bits === null ? 'before-bootstage' : this.bits & bit ? 'cleared' : 'never-readied';
    const key = `${piece.n}:${kind}`, had = this.byKey.get(key);
    if (had) {
      had.insns++;
      if (!had.seenPieces.has(piece.lo)) { had.seenPieces.add(piece.lo); had.pieces++; if (had.pcs.length < PCS) had.pcs.push(h8(c)); }
      return;
    }
    const rec = { pc: h8(c), disasm: h8(c - this.layout.base + DIS), section: piece.n, kind, word: h8(word),
      copied: h8(u32(this.read(this.layout.copied, 4), 0)), caller: h8(R[MDR]), staged: this.bits === null ? null : h8(this.bits), insns: 1, pieces: 1, pcs: [h8(c)] };
    Object.defineProperty(rec, 'seenPieces', { value: new Set([piece.lo]) });     // not in the record's JSON
    this.byKey.set(key, rec);
    this.findings.push(rec);
  }
}

// The audit's sec_ready part (patchAudit's, the status's and session.json's) from the static pass's result (or null:
// not run) and the watch's records (or null: not watching), in the report shape the strict mode's log shares
// (src/lab/strict.mjs StrictLog.doc): {static: {hooks, crossings, gated} | null, watched, findings: [{class, site
// (run-time), disasm (code notation), ...}]}. class 'ungated-branch' (a static entry: addr its target, branch its
// kind, from, to, hook) or 'unready-run' (a watch record: section, phase its kind, word, copied, caller, staged,
// insns, pieces, pcs)
export const SEC_READY_CLASSES = ['ungated-branch', 'unready-run'];
export function secReadyReport(st, runs) {
  const findings = [
    ...(st?.ungated ?? []).map(({ at, disasm, kind, target, ...x }) => ({ class: 'ungated-branch', site: at, disasm, addr: target, branch: kind, ...x })),
    ...(runs ?? []).map(({ pc, disasm, kind, ...x }) => ({ class: 'unready-run', site: pc, disasm, phase: kind, ...x })),
  ];
  return { static: st ? { hooks: st.hooks, crossings: st.crossings, gated: st.gated } : null, watched: runs != null, findings };
}

// secReadyReport's report as one line (the hosts' patch audit line, and their closing line)
export function secReadyLine(s) {
  const st = s.static, ungated = s.findings.filter((x) => x.class === 'ungated-branch'), runs = s.findings.filter((x) => x.class === 'unready-run');
  const stat = st == null ? 'the static section-order pass not run (the host gave none)'
    : ungated.length ? `${ungated.length} ungated branch(es) of patched code into a later section (of ${st.crossings} crossing(s), ${st.gated} gated): ` +
      ungated.slice(0, 8).map((x) => `${x.site} ${x.branch} -> ${x.addr} (section ${x.from} -> ${x.to})`).join(', ') + (ungated.length > 8 ? `, and ${ungated.length - 8} more` : '')
      : `no ungated branch of patched code into a later section (${st.crossings} crossing(s), all gated)`;
  const run = !s.watched ? '' : !runs.length ? '; no patched instruction ran in a section whose stage bit was clear'
    : `; patched code ran in ${runs.length} section(s) and phase(s) whose stage bit was clear: ` +
      runs.slice(0, 8).map((x) => `${x.site} (section ${x.section}, ${x.insns} instruction(s) in ${x.pieces} piece(s), word ${x.word}, caller ${x.caller}, ${x.phase === 'before-bootstage' ? 'before S-BOOTSTAGE' : x.phase === 'never-readied' ? 'a stage the lab never readies' : 'its bit cleared since S-BOOTSTAGE'})`).join(', ') + (runs.length > 8 ? `, and ${runs.length - 8} more` : '');
  return `sec-ready: ${stat}${run}`;
}
