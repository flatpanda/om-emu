// The decoded-instruction-cache interpreter over the CPU's step (cpu.mjs): common forms are decoded once per
// pc into a direct-mapped cache and run inline with step()'s flag rules; every other form runs through
// step(). Cache slots are dropped per 256-byte physical chunk when that chunk is written (CPU store, debugger write,
// engine DMA): precise self-modifying code.
//
// Main-loop visits: a pending interrupt is looked at only when control returns to the main loop: at the start of a
// continue, after a helper RTI or PSW write (transfer kind 3), and after an instruction run as a one-instruction TB
// (PSW write window, irq_wait, near insn-limit). An arrival at a breakpoint pc by a lookup stops there without a visit.
// run() returns RUN_VISIT after such an instruction when an interrupt is requested, and the machine's continue loop
// makes the visit.
//
// The extra look (gate mode 2 above all): every set_irq(true) kicks the CPU, which makes the next TB start leave to
// the main loop. A device access that raises the request is an MMIO access, and an MMIO access from an instruction
// that is not its TB's last ends the TB there, so the raising instruction always ends its TB; the next TB start
// looks, unless the next pc is a breakpoint: a TB never chains into a breakpoint, and the debug stop comes before
// any look. So S.kick (set by the machine's
// set_irq(true) callback) makes run() return RUN_VISIT after the instruction unless the new pc is a breakpoint; a
// one-instruction TB's visit consumes it. Five looks depend on a TB layout emu does not model and throw TbUndecidable
// (an Unported) instead (refusals a-e, below and in kickRefusal).
// A bus window remap (an asynchronous kick) makes the next TB start look (S.exitReq); an instruction
// fetched from the lab stub's MMIO is a one-shot TB, looked at before it runs (when a request is pending) and after;
// and a pc whose fetch faults never has a TB, so an arrival there passes the main loop, which looks before the fetch.
import { Fault, TbUndecidable, CODEPG, TOTAL, IO, CST, MmioFetch, FETCH, codePhys, cb, setSmcHook, ld8, ld16, ld32, st8, st16, st32, WHIT } from './mem.mjs';
import { R, S, D0, A0, SP, PC, PSW, LIR, LAR, FAULT, UNDEF, HAZ, Z, N, C, V, CC_USES, ccEval, cv, s8, s16, insnLength,
  step } from './cpu.mjs';

export const RUN_BP = 1, RUN_FAULT = 2, RUN_LIMIT = 3, RUN_VISIT = 4;
const NEAR_LIMIT = 64;   // the TB instruction cap: within it of insn-limit every instruction is its own TB
const TB_MIN = 16;      // refusal (c): a TB has at least this many instructions unless something surely ends it

// Machine options read once per machine (createMachine -> configureInterp): the mutants of check_perf's
// translator controls (1 carry with <=, 2 Bcc/Lcc without the undefined-flag test, 3 the instruction count lost at
// TB exits, 4 no near-limit zone, 5 the one-instruction TB flag ignored, 6 the window pcs' slots kept at a remap,
// 7 asl2 defines V and C, 8 a later instruction crossing a page fetched at the decode of the run's first instruction
// (crossFault), 9 the window pcs' slots kept at a remap back to a segment shown before) and the forced
// one-instruction mode (oneInsn: every instruction its own TB, a visit after each).
let MUT = 0, ONE = false;
export function configureInterp({ mutant = 0, oneInsn = false } = {}) { MUT = mutant | 0; ONE = !!oneInsn; }
// The debugger's native-timing exec trace: every decoded form runs through step() (K.FB; K.FBM keeps its main-loop
// exit), so every instruction reaches the exec hook while the interrupt looks stay those of the inline run.
let FORCE_FB = false;
export function setForceHelper(on) { if (FORCE_FB !== !!on) { FORCE_FB = !!on; flushDecode(); } }
// Drop every decoded slot (snapshot restore, setForceHelper): the next lookup of any pc decodes it again from memory.
export function flushDecode() {
  cslots.clear(); ctag.fill(-1); ckind.fill(K.FB); cch0.fill(-1); cch1.fill(-1); CODECH.fill(0);
}
// The run loop's TB-start record (refusal c), for a snapshot.
export function interpState() { return { TB_PC, TB_AT, TB_START, SEGS: [...SEGS] }; }
export function setInterpState(s) { TB_PC = s.TB_PC; TB_AT = s.TB_AT; TB_START = s.TB_START; SEGS = new Set(s.SEGS); }

// Breakpoints: a stop before any instruction at these pcs (the Z0 set). BPH is a hash filter over BP and
// the watched pcs (refusal c: a gate-1 pc that is not a breakpoint), so a watch costs no per-instruction test.
export const BP = new Set(), BPH = new Uint8Array(65536);
let WATCH = -1;                                      // the watched gate pc, or -1
let BUILTIN = new Set();                             // the PERF2 builtin pcs of the current HLE loop (refusal d)
// The last TB start the run loop knows of (refusal c): its pc and the insns count of its first instruction, kept
// across a budgeted continue's slices.
let TB_PC = 0, TB_AT = 0;
export function setBreakpoints(list) {
  BP.clear(); BPH.fill(0);
  for (const pc of list) { BP.add(pc | 0); BPH[pc & 0xffff] = 1; }
  if (WATCH !== -1) BPH[WATCH & 0xffff] = 1;
}
// At the start of every continue: the gate-1 pc to watch (-1: none) and the builtin pcs.
export function setWatch(pc, builtins) {
  pc = pc === -1 || BP.has(pc | 0) ? -1 : pc | 0;
  if (builtins !== undefined) BUILTIN = builtins;
  if (pc === WATCH) return;
  WATCH = pc;
  BPH.fill(0);
  for (const b of BP) BPH[b & 0xffff] = 1;
  if (WATCH !== -1) BPH[WATCH & 0xffff] = 1;
}
const isBP = (pc) => BPH[pc & 0xffff] !== 0 && BP.has(pc);
// The TB-layout refusals. The look after these depends on where a TB begins, which emu does not model:
// (a) in the near-limit zone (the last 64 instructions, one instruction per TB only from the first TB start inside
//     it) an instruction raised the request, the next pc is a breakpoint and the request is admitted;
// (b) gate mode 1: a near-limit-zone visit at the gate pc with the request admitted;
// (c) gate mode 1: a plain arrival (no JS visit) at the gate pc, not a breakpoint, while a request is pending that
//     only the gate refuses, where a TB may start. Whether a TB start looks depends on a TB cache emu does not model
//     (the first use of a chained edge, or a lookup that finds no TB, returns to the main loop, which looks; a patched
//     edge or a found TB does not), so every possible TB start is refused. A TB surely starts after a control-transfer
//     form (taken or not), after an I/O access (when it is not the TB's last), after an instruction
//     on another page or at a page offset above 0xff9 (the 7-byte rule) and before a breakpoint or
//     builtin pc. Between such starts a TB also ends at its 64-instruction cap or, earlier, where the
//     translation runs out of temporaries (it is then retried with half the instructions): measured,
//     TBs of 30 INC Dn and of 27 ADD imm32,Dn, of 64 NOP or MOV. That depends on each form's temporaries and constants,
//     which emu does not model, so an arrival TB_MIN or more instructions after the last sure start is refused
//     too (I: the lowered forms take at most about 10 temporaries each, so a split TB keeps about 24 or more). A
//     sequential arrival closer than that takes no look (gate-pc-pass). run() keeps the last sure TB start
//     it saw (a continue's start, a visit, a transfer taken, a one-instruction TB), mem.mjs the last I/O access, and
//     tbPosition() walks from there to the gate pc. An arrival after a CPU store since the walk's last sure start
//     into the rest of that start's page (mem.mjs CST) is refused too: precise SMC ends the running TB when a store
//     hits it (the store is replayed as a one-instruction TB, whose exit looks at the next pc), and the TB's extent
//     is not modelled. The TB may hold bytes the JS machine has not decoded yet, so the decode cache's chunks do not
//     tell it. Every TB that runs between that start and the gate pc lies in that page: a TB that begins with a
//     page-crossing instruction ends there, and the 7-byte rule keeps the others on their page;
// (d) an instruction raised the request and the next pc is a PERF2 builtin pc (the builtin's TB looks first).
function refuse(what) {
  throw new TbUndecidable(`interrupt look after ${what} depends on a translation-block layout emu does not model`);
}
// After an instruction of a multi-instruction TB raised the request: true when the next TB start looks (RUN_VISIT).
function kickLook() {
  S.kick = false;
  if (WHIT !== null) return true;            // a debugger watchpoint stopped the continue (machine.mjs: no visit)
  const pc = R[PC];
  if (S.exitReq) {                // a bus window remap: the next TB start exits to the main loop (windowRemapped)
    S.exitReq = false;
    if (isBP(pc) && S.irqReq && S.intc.admitted(pc, false)) refuse(`a bus window remap right before the breakpoint 0x${hex(pc)} with an admitted request pending (refusal e)`);
    return true;
  }
  if (!isBP(pc)) return true;
  if (BUILTIN.has(pc) && S.irqReq && S.intc.admitted(pc, false)) refuse(`a request raised before the PERF2 builtin pc 0x${hex(pc)} (refusal d)`);
  return false;
}
function nearZone(kicked) {
  if (!S.irqReq) return;
  const pc = R[PC];
  if (kicked && isBP(pc) && S.intc.admitted(pc, false)) refuse(`a request raised in the near-limit zone before the breakpoint 0x${hex(pc)} (refusal a)`);
  if (S.intc.gateMode() === 1 && S.intc.admitted(pc, false)) refuse(`a near-limit-zone visit at the gate pc 0x${hex(pc)} (refusal b)`);
}
function watchArrival(pc, tbPc, tbAt) {
  if (!S.irqReq || !S.intc.admitted(pc, true)) return;
  try { cb(pc); } catch (e) { if (e instanceof MmioFetch || e instanceof Fault) return; throw e; }   // MMIO or a fetch fault: run() looks first
  let first = tbPc, at = tbAt;
  if (IO.n >= tbAt) { first = (IO.pc + lengthAt(IO.pc)) | 0; at = IO.n + 1; }   // the instruction after an I/O access
  const n = tbPosition(first, pc);
  if (n === 0) refuse(`an arrival at the gate pc 0x${hex(pc)} where a TB starts, with a request pending (refusal c)`);
  if (storeHit(S.insns - n, TB_START)) refuse(`an arrival at the gate pc 0x${hex(pc)} after a CPU store into code a TB running since 0x${hex(TB_START)} may hold (precise SMC ends that TB at the store), with a request pending (refusal c)`);
  if (n >= TB_MIN) refuse(`an arrival at the gate pc 0x${hex(pc)} ${n} instructions after the last sure TB start, where a TB may start (TCG temps, the 64-instruction cap), with a request pending (refusal c)`);
}
function lengthAt(pc) { const op = cb(pc); return insnLength(op, op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? cb(pc + 1) : 0); }
// Transfer kind 1 or 2, or a lowered Bcc/BRA/Lcc: the instruction ends its TB, taken or not (one taken to
// its own next pc too). Kind 3 (RTI, the PSW writes) is K.FBM, after which run() records the TB start itself.
export function transfers(op, p) {
  return (op >= 0xc0 && op <= 0xca) || op === 0xcc || op === 0xcd || op === 0xdc || op === 0xdd ||
    (op >= 0xd0 && op <= 0xda) || op === 0xde || op === 0xdf || (op === 0xf0 && (p & 0xf0) === 0xf0) ||
    (op === 0xf8 && p >= 0xe8 && p <= 0xeb) || ((op === 0xfa || op === 0xfc) && p === 0xff);
}
// The instructions run since the last sure TB start before g (0: a TB surely starts at g), when one starts at first
// and the instructions from first to g ran in sequence. TB_START: the pc of that last sure start.
let TB_START = 0;
function tbPosition(first, g) {
  let pc = first, n = 0;
  TB_START = first;
  while (pc !== g) {
    if (((g - pc) >>> 0) > 0x1000000) throw new Error(`refusal c: 0x${hex(g)} does not follow 0x${hex(first)} in sequence`);
    const op = cb(pc), p = op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? cb(pc + 1) : 0, next = (pc + insnLength(op, p)) | 0;
    n++;
    if (transfers(op, p) || ((pc ^ next) >>> 12) !== 0 || (next & 0xfff) > 0xff9 || BP.has(next) || BUILTIN.has(next)) { n = 0; TB_START = next; }
    pc = next;
  }
  return n;
}
// A CPU store by an instruction counted at or after at (the sure start's insns count) into start's page from start on
// (stores are aligned, so one at o covers at most o..o+3). A ring that lost stores since at counts as a hit. The
// instruction at start ran, so its page is mapped.
function storeHit(at, start) {
  const lo = codePhys(start), hi = lo + 0x1000 - (start & 0xfff), m = Math.min(CST.k, 32);
  for (let k = 0; k < m; k++) {
    const j = (CST.k - 1 - k) & 31;
    if (CST.n[j] < at) return false;
    if (CST.o[j] + 3 >= lo && CST.o[j] < hi) return true;
  }
  return CST.k > 32;
}
// analog 4 (no near-limit fallback): past the limit, inline forms run on; the next helper form stops
function inlineAt(pc) {
  const i = (pc ^ (pc >>> 13)) & CMASK;
  if (ctag[i] !== pc) { decode(pc, i); if (MMIO) { MMIO = false; return false; } }
  return ckind[i] !== K.FB && ckind[i] !== K.FBM;
}
const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
const CHUNK = 8;                                   // 256-byte physical chunks
let CODECH = new Uint8Array(1);
// chunk -> list of the decode-cache slots that hold an instruction byte there. Each valid slot is in the lists of the
// (at most two) chunks its instruction spans, side 0 and side 1 (cch0/cch1, at index cpos0/cpos1), and in no other:
// re-tagging a slot for another pc (a direct-mapped conflict) removes it from its old lists first (swap-remove), so
// the lists stay bounded by the live slots. A list entry is slot * 2 + side.
const cslots = new Map();
export function resetInterp() {
  CODECH = new Uint8Array((TOTAL >>> CHUNK) + 1);
  cslots.clear(); ctag.fill(-1); ckind.fill(K.FB); cch0.fill(-1); cch1.fill(-1); BP.clear(); BPH.fill(0);
  WATCH = -1; BUILTIN = new Set(); MUT = 0; ONE = false; TB_PC = 0; TB_AT = 0; SEGS = new Set([0x17]); FORCE_FB = false;
  setSmcHook(invalidateChunk);
}
// The bus window remap (bus.mjs onRemap, a valid CPU store to 0x98100058): the decode-cache slots of window pcs hold
// the old segment's bytes and go (a slot is found by pc alone, not by physical page; breakpoints need nothing, as
// this interpreter checks them per instruction). The next TB start returns to the main loop and looks: S.kick with
// S.exitReq. check_perf's mutants: 6 keeps the slots at every remap, 9 when the window maps
// back to a segment it showed before (the reset segment 0x17 included).
let SEGS = new Set([0x17]);
export function windowRemapped(seg) {
  const back = SEGS.has(seg);
  SEGS.add(seg);
  if (!(MUT === 6 || (MUT === 9 && back))) {
    for (let i = 0; i < ctag.length; i++) { const pc = ctag[i] >>> 0; if (pc >= 0xB8000000 && pc < 0xC0000000) dropSlot(i); }
  }
  S.kick = true; S.exitReq = true;
}
function joinChunk(ch, i, side) {
  let l = cslots.get(ch);
  if (l === undefined) cslots.set(ch, l = []);
  if (side === 0) { cch0[i] = ch; cpos0[i] = l.length; } else { cch1[i] = ch; cpos1[i] = l.length; }
  l.push(i * 2 + side);
}
function leaveChunk(ch, pos) {
  const l = cslots.get(ch), last = l.pop();
  if (pos < l.length) { l[pos] = last; if (last & 1) cpos1[last >> 1] = pos; else cpos0[last >> 1] = pos; }
  else if (l.length === 0) cslots.delete(ch);
}
// Empty a slot. ctag -1 is also the int32 form of pc 0xFFFFFFFF (slot 0), so an empty slot must also be K.FB: a
// lookup of that pc then runs step(), which takes the code-fetch fault, instead of a stale inline form.
function dropSlot(i) {
  if (cch0[i] >= 0) leaveChunk(cch0[i], cpos0[i]);
  if (cch1[i] >= 0) leaveChunk(cch1[i], cpos1[i]);
  ctag[i] = -1; ckind[i] = K.FB; cch0[i] = -1; cch1[i] = -1;
}
function invalidateChunk(o) {
  const ch = o >>> CHUNK;
  if (!CODECH[ch]) return;
  CODECH[ch] = 0;
  const l = cslots.get(ch);
  if (l === undefined) return;
  cslots.delete(ch);
  for (const e of l) { const i = e >> 1; if (e & 1) cch1[i] = -1; else cch0[i] = -1; dropSlot(i); }
}
export function cacheStats() {     // test aid: live slots and the sizes of the per-chunk lists
  let live = 0, refs = 0, maxSet = 0;
  for (let i = 0; i < ctag.length; i++) if (cch0[i] >= 0) live++;
  for (const l of cslots.values()) { refs += l.length; if (l.length > maxSet) maxSet = l.length; }
  return { live, chunks: cslots.size, refs, maxList: maxSet };
}

const CBITS = 16, CMASK = (1 << CBITS) - 1;
const ctag = new Int32Array(1 << CBITS).fill(-1);
const ckind = new Uint8Array(1 << CBITS), cx = new Uint8Array(1 << CBITS), cy = new Uint8Array(1 << CBITS);
const cimm = new Int32Array(1 << CBITS), clen = new Uint8Array(1 << CBITS);
const cch0 = new Int32Array(1 << CBITS).fill(-1), cch1 = new Int32Array(1 << CBITS).fill(-1);
const cpos0 = new Int32Array(1 << CBITS), cpos1 = new Int32Array(1 << CBITS);
const K = { FB: 0, CLR: 1, EXTB: 2, EXTBU: 3, EXTH: 4, EXTHU: 5, ADDI_A: 6, ADDI_D: 7, MOVI_A: 8, MOVI_D: 9,
  LDSP_D: 10, LDSP_A: 11, STSP_D: 12, STSP_A: 13, INC_D: 14, INC_A: 15, INC4: 16, ASL2: 17, ST_DA: 18, LD_DA: 19,
  MOV_DD: 20, MOV_AA: 21, CMP_DD: 22, CMP_AA: 23, CMPI_D: 24, CMPI_A: 25, BCC: 26, BRA: 27, NOP: 28, LCC: 29,
  SETLB: 30, ADD_DD: 31, LDW_AA: 32, LDBU_A: 33, LDHU_A: 34, STB_A: 35, STH_A: 36, STW_A: 37, LDA_A: 38, STA_A: 39,
  SUB_DD: 40, ADD_DA: 41, MOV_AD: 42, MOV_DA: 43, CMP_DA: 44, CMP_AD: 45, AND_DD: 46, OR_DD: 47, XOR_DD: 48,
  LDD_W: 49, LDD_B: 50, LDD_H: 51, STD_W: 52, STD_B: 53, STD_H: 54, LDDA: 55, STDA: 56, ADDI32_D: 57, ADDI32_A: 58,
  CMPI32_D: 59, ANDI_D: 60, ORI_D: 61, MOVI32_D: 62, MOVI32_A: 63, ADD_SP: 64, MOVI_AA: 65, MOVI8_A: 66,
  UDFMULI: 67, ADD_AD: 68, ADD_AA: 69, SUB_AD: 70, LDSP16: 71, STSP16: 72, CMPI_A32: 73, BTSTI: 74, XORI_D: 75,
  FBM: 76, SUB_DA: 77, SUB_AA: 78, SUBI32_D: 79, SUBI32_A: 80 };
// FBM: helper form that returns to the main loop (transfer kind 3). The inline SUB/CMP forms are F1 0x-3x, 9x, Ax;
// Ax-Bx CMP; FA/FC C8, D8; FC C4, D4: the forms check_perf's mutant 1 changes (P1).
function setFlags(x, c, v) { R[PSW] = (R[PSW] & ~15) | (x === 0 ? Z : 0) | (x < 0 ? N : 0) | (c ? C : 0) | (v ? V : 0); R[UNDEF] &= ~15; }
function addf(l, r) { const x = (l + r) | 0; setFlags(x, (l >>> 0) + (r >>> 0) > 0xffffffff, (~(l ^ r) & (l ^ x)) < 0); return x; }
function subf(l, r) { const x = (l - r) | 0; setFlags(x, MUT === 1 ? (l >>> 0) <= (r >>> 0) : (l >>> 0) < (r >>> 0), ((l ^ r) & (l ^ x)) < 0); return x; }
function cond(cc, pc) { if ((R[UNDEF] & CC_USES[cc]) && MUT !== 2) throw new Fault(6, pc); return ccEval(cc, R[PSW]); }
function markCode(pc, len) {
  for (let i = 0; i < len; i++) { const o = codePhys(pc + i); if (o >= 0) { CODECH[o >>> CHUNK] = 1; CODEPG[o >>> 12] = 1; } }
}
function decode(pc, i) {
  let op, p = 0, len;
  try {
    op = cb(pc);
    if (op >= 0xf0 && op <= 0xfe && op !== 0xf7) p = cb(pc + 1);
    len = insnLength(op, p);
    for (let j = 2; j < len; j++) cb(pc + j);
  } catch (e) {
    if (e instanceof MmioFetch) { MMIO = true; return; }      // a byte on readable MMIO: no slot (run() runs it)
    if (e instanceof Fault) { R[FAULT] = e.code; e.done = true; }
    throw e;                                                    // fetch fault: not counted
  }
  const src = (op >> 2) & 3, dst = op & 3;
  let k = K.FB, x = 0, y = 0, imm = 0;
  if (op <= 0x0f) { if ((op & 3) === 0) { k = K.CLR; x = src; } }
  else if (op <= 0x1f) { k = [K.EXTB, K.EXTBU, K.EXTH, K.EXTHU][(op - 0x10) >> 2]; x = dst; }
  else if (op <= 0x23) { k = K.ADDI_A; x = dst; imm = s8(cb(pc + 1)); }
  else if (op <= 0x27) { k = K.MOVI_A; x = dst; imm = cv(pc + 1, 2) & 0xffff; }
  else if (op <= 0x2b) { k = K.ADDI_D; x = dst; imm = s8(cb(pc + 1)); }
  else if (op <= 0x2f) { k = K.MOVI_D; x = dst; imm = s16(cv(pc + 1, 2)); }
  else if (op <= 0x3b) { /* abs16 loads: fallback */ }
  else if (op <= 0x3f) { k = K.MOV_AA; x = dst; y = 8 - 4; /* a[dst] = sp */ k = K.MOVI_AA; }
  else if (op <= 0x4f) {
    if (dst === 0) { k = K.INC_D; x = src; } else if (dst === 1) { k = K.INC_A; x = src; }
    else { k = dst === 2 ? K.STSP_D : K.STSP_A; x = src; imm = cb(pc + 1); }
  } else if (op <= 0x53) { k = K.INC4; x = dst; }
  else if (op <= 0x57) { k = K.ASL2; x = dst; }
  else if (op <= 0x5f) { k = op < 0x5c ? K.LDSP_D : K.LDSP_A; x = dst; imm = cb(pc + 1); }
  else if (op <= 0x6f) { k = K.ST_DA; x = src; y = dst; }
  else if (op <= 0x7f) { k = K.LD_DA; x = src; y = dst; }
  else if (op <= 0x8f) { if (src === dst) { k = K.MOVI_D; x = dst; imm = s8(cb(pc + 1)); } else { k = K.MOV_DD; x = dst; y = src; } }
  else if (op <= 0x9f) { if (src === dst) { k = K.MOVI8_A; x = dst; imm = cb(pc + 1); } else { k = K.MOV_AA; x = dst; y = src; } }
  else if (op <= 0xbf) {
    const data = op < 0xb0;
    if (src === dst) { k = data ? K.CMPI_D : K.CMPI_A; x = dst; imm = data ? s8(cb(pc + 1)) : cb(pc + 1); }
    else { k = data ? K.CMP_DD : K.CMP_AA; x = dst; y = src; }
  } else if (op <= 0xc9) { k = K.BCC; x = op & 15; imm = s8(cb(pc + 1)); }
  else if (op === 0xca) { k = K.BRA; imm = s8(cb(pc + 1)); }
  else if (op === 0xcb) k = K.NOP;
  else if (op >= 0xd0 && op <= 0xd9) { k = K.LCC; x = op & 15; }
  else if (op === 0xdb) { k = K.SETLB; }
  else if (op >= 0xe0 && op <= 0xef) { k = K.ADD_DD; x = dst; y = src; }
  else if (op === 0xf0) {
    const s = (p >> 2) & 3, d = p & 3;
    switch (p & 0xf0) {
      case 0x00: k = K.LDA_A; x = s; y = d; break; case 0x10: k = K.STA_A; x = s; y = d; break;
      case 0x40: k = K.LDBU_A; x = s; y = d; break; case 0x50: k = K.STB_A; x = s; y = d; break;
      case 0x60: k = K.LDHU_A; x = s; y = d; break; case 0x70: k = K.STH_A; x = s; y = d; break;
    }
  } else if (op === 0xf1) {
    const s = (p >> 2) & 3, d = p & 3; x = d; y = s;
    switch (p & 0xf0) {
      case 0x00: k = K.SUB_DD; break; case 0x10: k = K.SUB_DA; break; case 0x20: k = K.SUB_AD; break;
      case 0x30: k = K.SUB_AA; break; case 0x50: k = K.ADD_DA; break;
      case 0x60: k = K.ADD_AD; break; case 0x70: k = K.ADD_AA; break;
      case 0x90: k = K.CMP_DA; break; case 0xa0: k = K.CMP_AD; break;
      case 0xd0: k = K.MOV_DA; break; case 0xe0: k = K.MOV_AD; break;
    }
  } else if (op === 0xf2) {
    const s = (p >> 2) & 3, d = p & 3; x = d; y = s;
    switch (p >> 4) { case 0: k = K.AND_DD; break; case 1: k = K.OR_DD; break; case 2: k = K.XOR_DD; break; }
  } else if (op === 0xf9 || op === 0xfb || op === 0xfd) {
    const w = op === 0xf9 ? 1 : op === 0xfb ? 2 : 4, nn = p >> 4, tt = (p >> 2) & 3;
    let v = cv(pc + 2, w);
    if (nn === 0 && tt === 0) { k = K.UDFMULI; x = p & 3; imm = w === 1 ? s8(v) : w === 2 ? s16(v) : v; }
    else if (nn === 1 && tt === 1) { k = K.UDFMULI; x = p & 3; imm = v; }
  } else if (op === 0xf8 || op === 0xfa || op === 0xfc) {
    const w = op === 0xf8 ? 1 : op === 0xfa ? 2 : 4, s = (p >> 2) & 3, d = p & 3;
    if (!(op === 0xfa && p >= 0xf0 && p <= 0xfb)) {
      const v = cv(pc + 2, w), simm = w === 1 ? s8(v) : w === 2 ? s16(v) : v;
      if (p < 0x80) {
        const mw = p < 0x40 ? 4 : p < 0x60 ? 1 : 2, isA = (p & 0xe0) === 0x20;
        x = s; y = d; imm = simm;
        if (p & 0x10) k = isA ? K.STDA : mw === 4 ? K.STD_W : mw === 1 ? K.STD_B : K.STD_H;
        else k = isA ? K.LDDA : mw === 4 ? K.LDD_W : mw === 1 ? K.LDD_B : K.LDD_H;
      } else if (p >= 0x90 && p < 0xa0 && !(op === 0xf8 && (p & 3) < 2)) { k = K.STSP16; x = s; y = p & 3; imm = v; }
      else if (p >= 0xb0 && p < 0xc0 && !(op === 0xf8 && p < 0xb8)) { k = K.LDSP16; x = d; y = p; imm = v; }
      else if (op !== 0xf8 && p >= 0xc0) {
        x = d;
        switch (p & 0xfc) {
          case 0xc0: k = K.ADDI32_D; imm = simm; break; case 0xc8: k = K.CMPI32_D; imm = simm; break;
          case 0xd0: k = K.ADDI32_A; imm = simm; break; case 0xd8: k = K.CMPI_A32; imm = v; break;
          case 0xe0: k = K.ANDI_D; imm = v; break; case 0xe4: k = K.ORI_D; imm = v; break; case 0xe8: k = K.XORI_D; imm = v; break;
          case 0xcc: if (op === 0xfc) { k = K.MOVI32_D; imm = v; } break;
          case 0xc4: if (op === 0xfc) { k = K.SUBI32_D; imm = v; } break;
          case 0xd4: if (op === 0xfc) { k = K.SUBI32_A; imm = v; } break;
          case 0xdc: if (op === 0xfc) { k = K.MOVI32_A; imm = v; } break;
          case 0xfc: if (p === 0xfe) { k = K.ADD_SP; imm = simm; } break;
        }
      } else if (op === 0xf8 && p === 0xfe) { k = K.ADD_SP; imm = simm; }
      else if (op === 0xf8 && p >= 0xe0 && p <= 0xe7) { x = d; imm = v; k = p < 0xe4 ? K.ANDI_D : K.ORI_D; }
      else if (op === 0xf8 && p >= 0xec && p <= 0xef) { x = d; imm = v; k = K.BTSTI; }
    }
  }
  if ((op === 0xf0 && p === 0xfd) || (op === 0xf2 && (p & 0xf3) === 0xf3) || (op === 0xfa && (p === 0xfc || p === 0xfd))) k = K.FBM;
  if (FORCE_FB && k !== K.FBM) k = K.FB;
  if (cch0[i] >= 0) dropSlot(i);                   // re-tag: leave the old instruction's chunk lists
  ctag[i] = pc; ckind[i] = k; cx[i] = x; cy[i] = y; cimm[i] = imm; clen[i] = len;
  markCode(pc, len);
  for (let j = 0; j < len; j++) {
    const o = codePhys(pc + j);
    if (o < 0) continue;
    const ch = o >>> CHUNK;
    if (ch === cch0[i] || ch === cch1[i]) continue;
    joinChunk(ch, i, cch0[i] < 0 ? 0 : 1);
  }
}

// mutant 8 (a later instruction of a TB may cross a page, so its second page is fetched when the TB
// is translated, before the instructions ahead of it run): at a decode miss, the instructions that follow in sequence
// on pc's page (up to a transfer, a BREAK or 64) are fetched, and a fetch fault on the next page of one that crosses it
// is a fault at pc (not counted)
function crossFault(pc) {
  let q = pc;
  for (let k = 0; k < 64; k++) {
    let op, p = 0, len;
    try { op = cb(q); if (op >= 0xf0 && op <= 0xfe && op !== 0xf7) p = cb(q + 1); len = insnLength(op, p); } catch { return false; }
    if (((q ^ (q + len - 1)) >>> 12) !== 0) {
      if (q === pc) return false;
      try { cb(q + len - 1); } catch (e) { if (e instanceof Fault) return true; return false; }
      return false;
    }
    if (op === 0xff || transfers(op, p)) return false;
    q = (q + len) | 0;
  }
  return false;
}

// An instruction with a byte on readable MMIO (the lab stub's allow ranges; mem.mjs cbIo): it runs as
// a one-shot one-instruction TB (never cached, so its arrival and its exit both pass the main loop) whose bytes the
// translator and the helper read through the device. decode() sets MMIO instead of filling a slot; run() and stepAny()
// run it with FETCH.io set. Its arrival comes from the main loop (a lookup never finds a one-shot TB), so with a request
// pending run() first returns RUN_VISIT once for that pc and instruction count (LOOKED; a continue's start is a look
// too), then runs it; its exit looks again.
let MMIO = false, LOOKED_PC = -1, LOOKED_N = -1;
function stepIo() {
  FETCH.io = true;
  try { step(true); } finally { FETCH.io = false; }
}
export function stepAny() {
  try { step(); } catch (e) { if (!(e instanceof MmioFetch)) throw e; stepIo(); }
}

// Run from R[PC] until a breakpoint, a fault, the instruction limit (or the optional budget of instructions, a test
// aid: RUN_LIMIT with insns below the limit) or a needed main-loop visit. resumed: this call goes on with a budgeted
// continue paused by the previous call's budget return (no main-loop visit between: the TB start it knew still holds).
export function run(budget = Infinity, resumed = false) {
  const limit = S.limit ? S.limit : Infinity, i0 = S.insns, bud = S.insns + budget, lim = Math.min(limit, bud);
  // forced one-instruction mode: every instruction is its own TB; analog 4: no near-limit zone
  const nearLimit = MUT === 4 ? Infinity : limit - NEAR_LIMIT, near = ONE ? -1 : nearLimit;
  S.kick = false; S.exitReq = false;
  let tbPc = R[PC], tbAt = S.insns;                   // the last known TB start (refusal c)
  if (resumed) { tbPc = TB_PC; tbAt = TB_AT; } else { IO.n = -1; CST.k = 0; LOOKED_PC = R[PC]; LOOKED_N = S.insns; }
  try {
    for (;;) {
      const pc = R[PC];
      if (BPH[pc & 0xffff] !== 0) {
        if (BP.has(pc)) return RUN_BP;
        if (pc === WATCH && S.insns !== i0) watchArrival(pc, tbPc, tbAt);  // refusal (c): a plain arrival
      }
      if (S.insns >= lim && !(MUT === 4 && S.insns < bud && inlineAt(pc))) { TB_PC = tbPc; TB_AT = tbAt; return RUN_LIMIT; }
      if (((R[HAZ] !== 0 || S.irqWait) && MUT !== 5) || S.insns > near) {    // one-instruction TB
        const zone = R[HAZ] === 0 && !S.irqWait && !ONE;      // one instruction per TB only for the near-limit zone
        stepAny();
        const kicked = S.kick && !S.exitReq;
        S.kick = false; S.exitReq = false;                    // this TB's own exit to the main loop looks
        if (WHIT !== null) return RUN_VISIT;                  // a debugger watchpoint (machine.mjs: a stop, no visit)
        if (zone) nearZone(kicked);
        if (S.irqReq) return RUN_VISIT;
        tbPc = R[PC]; tbAt = S.insns;                         // its exit: the next TB starts here
        continue;
      }
      const i = (pc ^ (pc >>> 13)) & CMASK;
      if (ctag[i] !== pc) {
        if (MUT === 8 && crossFault(pc)) { const f = new Fault(2, pc); f.done = true; R[FAULT] = 2; S.fault = f; return RUN_FAULT; }
        const fault0 = R[FAULT];
        try { decode(pc, i); } catch (e) {
          // a fetch fault: there is never a TB at pc, so every arrival passes the main loop, which looks first
          if (e instanceof Fault && S.irqReq && !(LOOKED_PC === pc && LOOKED_N === S.insns)) { R[FAULT] = fault0; LOOKED_PC = pc; LOOKED_N = S.insns; return RUN_VISIT; }
          throw e;
        }
        if (MMIO) {                                           // a one-shot TB of one instruction fetched from MMIO
          MMIO = false;
          if (S.irqReq && !(LOOKED_PC === pc && LOOKED_N === S.insns)) { LOOKED_PC = pc; LOOKED_N = S.insns; return RUN_VISIT; }
          stepIo();
          S.kick = false; S.exitReq = false;                  // its exit to the main loop looks
          if (S.irqReq || WHIT !== null) return RUN_VISIT;
          tbPc = R[PC]; tbAt = S.insns;
          continue;
        }
      }
      const x = cx[i], y = cy[i], imm = cimm[i];
      let next = (pc + clen[i]) | 0;
      switch (ckind[i]) {
        case K.FB:                                    // step() counts its own instruction
          step();
          if (R[PC] !== next) { tbPc = R[PC]; tbAt = S.insns; }   // a transfer taken (one not taken: tbStarts)
          if (S.kick && kickLook()) return RUN_VISIT;
          continue;
        case K.FBM: step(); S.kick = false; S.exitReq = false; if (S.irqReq || WHIT !== null) return RUN_VISIT; tbPc = R[PC]; tbAt = S.insns; continue;   // RTI, PSW write: main loop
        case K.CLR: R[D0 + x] = 0; setFlags(0, false, false); break;
        case K.EXTB: R[D0 + x] = s8(R[D0 + x]); break;
        case K.EXTBU: R[D0 + x] &= 0xff; break;
        case K.EXTH: R[D0 + x] = s16(R[D0 + x]); break;
        case K.EXTHU: R[D0 + x] &= 0xffff; break;
        case K.ADDI_A: case K.ADDI32_A: R[A0 + x] = addf(R[A0 + x], imm); break;
        case K.ADDI_D: case K.ADDI32_D: R[D0 + x] = addf(R[D0 + x], imm); break;
        case K.MOVI_A: case K.MOVI8_A: case K.MOVI32_A: R[A0 + x] = imm; break;
        case K.MOVI_D: case K.MOVI32_D: R[D0 + x] = imm; break;
        case K.MOVI_AA: R[A0 + x] = R[SP]; break;
        case K.LDSP_D: R[D0 + x] = ld32((R[SP] + imm) | 0); break;
        case K.LDSP_A: R[A0 + x] = ld32((R[SP] + imm) | 0); break;
        case K.STSP_D: st32((R[SP] + imm) | 0, R[D0 + x]); break;
        case K.STSP_A: st32((R[SP] + imm) | 0, R[A0 + x]); break;
        case K.INC_D: R[D0 + x] = addf(R[D0 + x], 1); break;
        case K.INC_A: R[A0 + x] = (R[A0 + x] + 1) | 0; break;
        case K.INC4: R[A0 + x] = (R[A0 + x] + 4) | 0; break;
        case K.ASL2: {
          const r = R[D0 + x] << 2;
          if (MUT === 7) setFlags(r, false, false);
          else { R[PSW] = (R[PSW] & ~3) | (r === 0 ? Z : 0) | (r < 0 ? N : 0); R[UNDEF] = (R[UNDEF] & ~15) | 12; }
          R[D0 + x] = r; break;
        }
        case K.ST_DA: st32(R[A0 + y], R[D0 + x]); break;
        case K.LD_DA: R[D0 + x] = ld32(R[A0 + y]); break;
        case K.MOV_DD: R[D0 + x] = R[D0 + y]; break;
        case K.MOV_AA: R[A0 + x] = R[A0 + y]; break;
        case K.CMP_DD: subf(R[D0 + x], R[D0 + y]); break;
        case K.CMP_AA: subf(R[A0 + x], R[A0 + y]); break;
        case K.CMPI_D: subf(R[D0 + x], imm); break;
        case K.CMPI_A: case K.CMPI_A32: subf(R[A0 + x], imm); break;
        case K.BCC: if (cond(x, pc)) next = (pc + imm) | 0; tbPc = next; if (MUT === 3) { tbAt = S.insns; R[PC] = next; continue; } tbAt = S.insns + 1; break;
        case K.BRA: next = (pc + imm) | 0; tbPc = next; if (MUT === 3) { tbAt = S.insns; R[PC] = next; continue; } tbAt = S.insns + 1; break;
        case K.NOP: break;
        case K.LCC: if (cond(x, pc)) next = (R[LAR] - 4) | 0; tbPc = next; if (MUT === 3) { tbAt = S.insns; R[PC] = next; continue; } tbAt = S.insns + 1; break;
        case K.SETLB: R[LIR] = cv(pc + 1, 4); R[LAR] = (pc + 5) | 0; break;
        case K.ADD_DD: R[D0 + x] = addf(R[D0 + x], R[D0 + y]); break;
        case K.LDA_A: R[A0 + x] = ld32(R[A0 + y]); break;
        case K.STA_A: st32(R[A0 + y], R[A0 + x]); break;
        case K.LDBU_A: R[D0 + x] = ld8(R[A0 + y]); break;
        case K.STB_A: st8(R[A0 + y], R[D0 + x]); break;
        case K.LDHU_A: R[D0 + x] = ld16(R[A0 + y]); break;
        case K.STH_A: st16(R[A0 + y], R[D0 + x]); break;
        case K.SUB_DD: R[D0 + x] = subf(R[D0 + x], R[D0 + y]); break;
        case K.SUB_AD: R[A0 + x] = subf(R[A0 + x], R[D0 + y]); break;
        case K.SUB_DA: R[D0 + x] = subf(R[D0 + x], R[A0 + y]); break;
        case K.SUB_AA: R[A0 + x] = subf(R[A0 + x], R[A0 + y]); break;
        case K.SUBI32_D: R[D0 + x] = subf(R[D0 + x], imm); break;
        case K.SUBI32_A: R[A0 + x] = subf(R[A0 + x], imm); break;
        case K.ADD_DA: R[D0 + x] = addf(R[D0 + x], R[A0 + y]); break;
        case K.ADD_AD: R[A0 + x] = addf(R[A0 + x], R[D0 + y]); break;
        case K.ADD_AA: R[A0 + x] = addf(R[A0 + x], R[A0 + y]); break;
        case K.CMP_DA: subf(R[D0 + x], R[A0 + y]); break;
        case K.CMP_AD: subf(R[A0 + x], R[D0 + y]); break;
        case K.MOV_DA: R[D0 + x] = R[A0 + y]; break;
        case K.MOV_AD: R[A0 + x] = R[D0 + y]; break;
        case K.AND_DD: { const r = R[D0 + x] & R[D0 + y]; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.OR_DD: { const r = R[D0 + x] | R[D0 + y]; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.XOR_DD: { const r = R[D0 + x] ^ R[D0 + y]; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.LDD_W: R[D0 + x] = ld32((R[A0 + y] + imm) | 0); break;
        case K.LDD_B: R[D0 + x] = ld8((R[A0 + y] + imm) | 0); break;
        case K.LDD_H: R[D0 + x] = ld16((R[A0 + y] + imm) | 0); break;
        case K.STD_W: st32((R[A0 + y] + imm) | 0, R[D0 + x]); break;
        case K.STD_B: st8((R[A0 + y] + imm) | 0, R[D0 + x]); break;
        case K.STD_H: st16((R[A0 + y] + imm) | 0, R[D0 + x]); break;
        case K.LDDA: R[A0 + x] = ld32((R[A0 + y] + imm) | 0); break;
        case K.STDA: st32((R[A0 + y] + imm) | 0, R[A0 + x]); break;
        case K.CMPI32_D: subf(R[D0 + x], imm); break;
        case K.ANDI_D: { const r = R[D0 + x] & imm; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.ORI_D: { const r = R[D0 + x] | imm; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.XORI_D: { const r = R[D0 + x] ^ imm; setFlags(r, false, false); R[D0 + x] = r; break; }
        case K.BTSTI: setFlags(R[D0 + x] & imm, false, false); break;
        case K.ADD_SP: R[SP] = (R[SP] + imm) | 0; break;
        case K.UDFMULI: R[D0 + x] = Math.imul(R[D0 + x], imm); R[UNDEF] |= 15; break;
        case K.STSP16: { const a = (R[SP] + imm) | 0, v = y === 0 ? R[A0 + x] : R[D0 + x]; if (y < 2) st32(a, v); else if (y === 2) st8(a, v); else st16(a, v); break; }
        case K.LDSP16: { const p = y, a = (R[SP] + imm) | 0, v = p < 0xb8 ? ld32(a) : p < 0xbc ? ld8(a) : ld16(a); if (p < 0xb4) R[A0 + x] = v; else R[D0 + x] = v; break; }
        default:
          step();
          if (R[PC] !== next) { tbPc = R[PC]; tbAt = S.insns; }
          if (S.kick && kickLook()) return RUN_VISIT;
          continue;
      }
      R[PC] = next; S.insns++;
      if (S.kick && kickLook()) return RUN_VISIT;
    }
  } catch (e) {
    if (!(e instanceof Fault)) throw e;
    if (!e.done) { R[FAULT] = e.code; S.insns++; }            // a fault of an inline form: it counts
    S.fault = e;
    return RUN_FAULT;
  }
}
