// MN10300 CPU of OM-Emu: the one-instruction step (flags, UDF unit), interrupt acceptance, debugger register access
// and instruction lengths. Every instruction does all of its
// memory accesses before it writes a register, so a fault leaves the registers as they were; a faulting
// instruction counts in insns, a code-fetch fault does not.
import { Fault, cb, ld8, ld16, ld32, st8, st16, st32 } from './mem.mjs';
export { Fault };

export const Z = 1, N = 2, C = 4, V = 8;
export const D0 = 0, A0 = 4, SP = 8, PC = 9, PSW = 10, MDR = 11, LIR = 12, LAR = 13, FAULT = 14,
  UNDEF = 16, HAZ = 17, HI = 18, UC = 19, UD = 20, UV = 21;
export const R = new Int32Array(24);
// insns: the 64-bit instruction counter (a Number); irqReq: the hard interrupt request; irqWait: the irq_wait flag;
// limit: the insn-limit property (0 = none); intc: { level(), accepted(level, pc, insns) } (src/dev/intc.mjs).
// fault: the Fault that ended the last interp run() (RUN_FAULT), for the machine's stderr line.
// vectorPage: the high half of an accepted interrupt's vector (execInterrupt; resetCpu sets VECTOR_PAGE, the machine
// the board's).
export const S = { insns: 0, irqReq: false, irqWait: false, kick: false, exitReq: false, limit: 1000000, intc: null, fault: null, mutant: 0, vectorPage: 0 };

export function resetCpu(limit) {
  R.fill(0);
  R[PC] = 0x50000000; R[SP] = 0xA33FF000 | 0;           // reset
  S.insns = 0; S.irqReq = false; S.irqWait = false; S.kick = false; S.exitReq = false; S.limit = limit; S.intc = null; S.fault = null; S.mutant = 0;
  S.vectorPage = VECTOR_PAGE;
  XT = null;
}
export function cv(a, w) {
  let v = 0;
  for (let i = 0; i < w; i++) v |= cb(a + i) << (8 * i);
  return v | 0;
}

export const s8 = (x) => (x << 24) >> 24, s16 = (x) => (x << 16) >> 16;

export function insnLength(op, p) {
  if (op <= 0x0f) return (op & 3) ? 3 : 1;
  if (op <= 0x1f) return 1;
  if (op <= 0x23 || (op >= 0x28 && op <= 0x2b)) return 2;
  if (op <= 0x3b) return 3;
  if (op <= 0x3f) return 1;
  if (op <= 0x4f) return (op & 3) >= 2 ? 2 : 1;
  if (op <= 0x57) return 1;
  if (op <= 0x5f) return 2;
  if (op <= 0x7f) return 1;
  if (op <= 0xbf) return ((op >> 2) & 3) === (op & 3) ? 2 : 1;
  if (op <= 0xca) return 2;
  switch (op) {
    case 0xcb: return 1; case 0xcc: return 3; case 0xcd: return 5; case 0xce: case 0xcf: return 2;
    case 0xdc: return 5; case 0xdd: return 7; case 0xde: case 0xdf: return 3; case 0xf7: return 1;
    case 0xf8: case 0xf9: return 3; case 0xfa: case 0xfb: return 4; case 0xfc: case 0xfd: return 6;
    case 0xfe: return (p & 0x80) ? 5 : 7; case 0xff: return 1;
  }
  if (op <= 0xef) return 1;
  return 2;
}

// ---- flags (PSW flags, add / sub / logic / condition / shift)
export function pswFlags(value, written, undef) {
  R[PSW] = (R[PSW] & ~written) | (value & written);
  R[UNDEF] = (R[UNDEF] & ~(written | undef)) | undef;
}
export function nz(v) { return (v === 0 ? Z : 0) | (v < 0 ? N : 0); }
function flags(v, c, o) { R[PSW] = (R[PSW] & ~15) | (v === 0 ? Z : 0) | (v < 0 ? N : 0) | (c ? C : 0) | (o ? V : 0); R[UNDEF] &= ~15; }
function readFlags(bits, hazard, pc) { if (hazard || (R[UNDEF] & bits)) throw new Fault(6, pc); }
function add(l, r) { const x = (l + r) | 0; flags(x, (l >>> 0) + (r >>> 0) > 0xffffffff, (~(l ^ r) & (l ^ x)) < 0); return x; }
function sub(l, r) { const x = (l - r) | 0; flags(x, (l >>> 0) < (r >>> 0), ((l ^ r) & (l ^ x)) < 0); return x; }
function logic(x) { flags(x, false, false); return x; }
export const CC_USES = [N | V, Z | N | V, N | V, Z | N | V, C, C | Z, C, C | Z, Z, Z, V, V, N, N];
export function ccEval(cc, psw) {
  const z = psw & Z, c = psw & C, n = (psw & N) !== 0, v = (psw & V) !== 0, lt = n !== v;
  switch (cc) {
    case 0: return lt; case 1: return !lt && !z; case 2: return !lt; case 3: return lt || z !== 0;
    case 4: return c !== 0; case 5: return !c && !z; case 6: return !c; case 7: return c !== 0 || z !== 0;
    case 8: return z !== 0; case 9: return !z; case 10: return !v; case 11: return v;
    case 12: return !n; case 13: return n;
  }
}
function condition(cc, hazard, pc) { readFlags(CC_USES[cc], hazard, pc); return ccEval(cc, R[PSW]); }
function shift(value, count, kind) {
  let result = value, undef = V, carry = 0;
  count &= 31;
  if (count === 0 || kind === 0) undef |= C; else carry = (value & 1) ? C : 0;
  if (count) result = kind === 0 ? value << count : kind === 1 ? (value >>> count) | 0 : value >> count;
  pswFlags(nz(result) | carry, 15 & ~undef, undef);
  return result;
}
function bitOp(addr, bits, kind) {   // 0 tst 1 set 2 clr
  const old = ld8(addr);
  if (kind === 1) st8(addr, old | bits);
  if (kind === 2) st8(addr, old & ~bits);
  pswFlags((old & bits & 0xff) ? 0 : Z, 15, 0);
}
export function savedRegs(mask) {
  if (mask & 7) throw new Fault(4, mask);
  const r = [];
  if (mask & 0x80) r.push(D0 + 2);
  if (mask & 0x40) r.push(D0 + 3);
  if (mask & 0x20) r.push(A0 + 2);
  if (mask & 0x10) r.push(A0 + 3);
  if (mask & 0x08) r.push(D0, D0 + 1, A0, A0 + 1, MDR, LIR, LAR);
  return r;
}
function save(mask, top) { const r = savedRegs(mask); for (let i = 0; i < r.length; i++) st32(top - 4 * (i + 1), R[r[i]]); }
function restore(mask, top) {
  const r = savedRegs(mask), v = [];
  for (let i = 0; i < r.length; i++) v.push(ld32(top - 4 * (i + 1)));
  for (let i = 0; i < r.length; i++) R[r[i]] = v[i];
}
// 64-bit multiply high words without BigInt
export function mulhu(a, b) {
  a >>>= 0; b >>>= 0;
  const al = a & 0xffff, ah = a >>> 16, bl = b & 0xffff, bh = b >>> 16;
  const lo = al * bl, m1 = ah * bl, m2 = al * bh, hi = ah * bh;
  const mid = (lo >>> 16) + (m1 & 0xffff) + (m2 & 0xffff);
  return (hi + (m1 >>> 16) + (m2 >>> 16) + Math.floor(mid / 65536)) | 0;
}
export function mulhs(a, b) { let h = mulhu(a, b); if (a < 0) h = (h - b) | 0; if (b < 0) h = (h - a) | 0; return h; }

// ---- UDF float unit (binary32 RNE, faults on NaN/Inf/subnormal in or out, invalid/overflow/underflow)
const FB = new Float32Array(2), FBI = new Int32Array(FB.buffer);
const MIN_NORMAL = 1.1754943508222875e-38;
export function normalOrZero(v) { const e = (v >>> 23) & 0xff; return e !== 0xff && !(e === 0 && (v & 0x7fffff)); }
export function udfFloat(nn, dn, dm, pc) {
  if (!normalOrZero(dn) || !normalOrZero(dm) || (nn === 5 && !(dm & 0x7fffffff))) throw new Fault(1, pc);
  FBI[0] = dn; FBI[1] = dm;
  const x = FB[0], y = FB[1];
  const d = nn === 2 ? x + y : nn === 3 ? x - y : nn === 4 ? x * y : x / y;   // double; exact for +,-,* of f32
  FB[0] = d;                                   // round to binary32 (RNE)
  const r = FBI[0];
  // overflow -> Inf; underflow (tiny before rounding) or subnormal result -> fault
  if (!normalOrZero(r) || (d !== 0 && Math.abs(d) < MIN_NORMAL)) throw new Fault(1, pc);
  return r;
}
function udfFloatToInt(x, pc) {
  const e = (x >>> 23) & 0xff;
  if (e === 0) return 0;
  if (e === 0xff) throw new Fault(1, pc);
  if (x >= 0 && x >= 0x4f000000) return 0x7fffffff;
  if (x < 0 && (x & 0x7fffffff) > 0x4f000000) throw new Fault(1, pc);
  FBI[0] = x; return Math.trunc(FB[0]) | 0;
}
function udfCompare(dn, dm, pc) {
  if (!normalOrZero(dm) || !normalOrZero(dn)) throw new Fault(1, pc);
  FBI[0] = dm; FBI[1] = dn;
  pswFlags((FB[0] === FB[1] ? Z : 0) | (FB[0] < FB[1] ? N : 0), 15, 0);
}

// The exec trace hook (src/debug/): XT(pc, op) once per instruction that reaches step(), after its code fetch, before it
// executes: where the -d exec line is written (after the insn-limit check and the opcode and prefix fetch).
// Inline forms of the interpreter never reach it; the debugger routes them here (interp.mjs setForceHelper, or the
// one-instruction mode, in which every instruction is a one-instruction TB run by step()).
let XT = null;
export function setExecTrace(f) { XT = f; }

// ---- step: one instruction, all memory accesses before register writes
// refetch: an instruction fetched from MMIO (interp.mjs, mem.mjs cbIo): after the translator's reads of every byte the
// helper reads op and the prefix byte again (code_value) and decodes those values.
export function step(refetch = false) {
  const pc = R[PC];
  let next = (pc + 1) | 0, target = 0, jump = false, addr, imm, value, mask;
  let op, p = 0;
  try {   // code fetch (all bytes, as the translator does): fault 2, not counted
    op = cb(pc);
    if (op >= 0xf0 && op <= 0xfe && op !== 0xf7) p = cb(pc + 1);
    if (refetch) {            // the translator's reads: every byte once, in order (byte 1 of a non-prefix form too)
      for (let i = p || (op >= 0xf0 && op <= 0xfe && op !== 0xf7) ? 2 : 1, ln = insnLength(op, p); i < ln; i++) cb(pc + i);
      op = cb(pc);            // the helper's: op, the prefix byte, then its operands as it decodes
      p = op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? cb(pc + 1) : 0;
    } else for (let i = 2, ln = insnLength(op, p); i < ln; i++) cb(pc + i);
  } catch (e) { if (e instanceof Fault) { R[FAULT] = e.code; e.done = true; } throw e; }   // code fetch: not counted
  if (XT !== null) XT(pc, op);
  let src = (op >> 2) & 3, dst = op & 3;
  const hazard = R[HAZ];
  let newHazard = hazard ? hazard - 1 : 0;
  try {
    if (op <= 0x0f) {
      if ((op & 3) === 0) { R[D0 + src] = 0; flags(0, false, false); }
      else {
        addr = cv(next, 2) & 0xffff; next += 2;
        const w = [0, 4, 1, 2][op & 3];
        (w === 4 ? st32 : w === 1 ? st8 : st16)(addr, R[D0 + src]);
      }
    } else if (op <= 0x1f) {
      const x = R[D0 + dst];
      switch ((op - 0x10) >> 2) { case 0: R[D0 + dst] = s8(x); break; case 1: R[D0 + dst] = x & 0xff; break;
        case 2: R[D0 + dst] = s16(x); break; case 3: R[D0 + dst] = x & 0xffff; break; }
    } else if (op <= 0x23) { R[A0 + dst] = add(R[A0 + dst], s8(cb(next++))); }
    else if (op <= 0x27) { R[A0 + dst] = cv(next, 2) & 0xffff; next += 2; }
    else if (op <= 0x2b) { R[D0 + dst] = add(R[D0 + dst], s8(cb(next++))); }
    else if (op <= 0x2f) { R[D0 + dst] = s16(cv(next, 2)); next += 2; }
    else if (op <= 0x3b) {
      addr = cv(next, 2) & 0xffff; next += 2;
      R[D0 + dst] = op < 0x34 ? ld32(addr) : op < 0x38 ? ld8(addr) : ld16(addr);
    } else if (op <= 0x3f) { R[A0 + dst] = R[SP]; }
    else if (op <= 0x4f) {
      if (dst === 0) R[D0 + src] = add(R[D0 + src], 1);
      else if (dst === 1) R[A0 + src] = (R[A0 + src] + 1) | 0;
      else { addr = (R[SP] + cb(next++)) | 0; st32(addr, dst === 2 ? R[D0 + src] : R[A0 + src]); }
    } else if (op <= 0x53) { R[A0 + dst] = (R[A0 + dst] + 4) | 0; }
    else if (op <= 0x57) { R[D0 + dst] = shift(R[D0 + dst], 2, 0); }
    else if (op <= 0x5f) {
      value = ld32((R[SP] + cb(next++)) | 0);
      if (op < 0x5c) R[D0 + dst] = value; else R[A0 + dst] = value;
    } else if (op <= 0x6f) { st32(R[A0 + dst], R[D0 + src]); }
    else if (op <= 0x7f) { R[D0 + src] = ld32(R[A0 + dst]); }
    else if (op <= 0x8f) { R[D0 + dst] = src === dst ? s8(cb(next++)) : R[D0 + src]; }
    else if (op <= 0x9f) { R[A0 + dst] = src === dst ? cb(next++) : R[A0 + src]; }
    else if (op <= 0xbf) {
      const data = op < 0xb0;
      value = data ? R[D0 + dst] : R[A0 + dst];
      if (src === dst) { imm = cb(next++); if (data) imm = s8(imm); }
      else imm = data ? R[D0 + src] : R[A0 + src];
      sub(value, imm);
    } else if (op <= 0xca) {
      const disp = s8(cb(next++));
      if (op === 0xca || condition(op & 15, hazard, pc)) { jump = true; target = (pc + disp) | 0; }
    } else if (op === 0xcb) { /* nop */ }
    else if (op === 0xcc) { jump = true; target = (pc + s16(cv(next, 2))) | 0; next += 2; }
    else if (op === 0xcd || op === 0xdd) {
      const w = op === 0xcd ? 2 : 4;
      imm = cv(next, w); if (w === 2) imm = s16(imm);
      mask = cb(next + w); value = cb(next + w + 1);
      next += w + 2;
      savedRegs(mask);
      st32(R[SP], next);
      save(mask, R[SP]);
      R[SP] = (R[SP] - value) | 0;
      R[MDR] = next;
      jump = true; target = (pc + imm) | 0;
    } else if (op === 0xce || op === 0xcf) {
      mask = cb(next++);
      const n = savedRegs(mask).length;
      value = 4 * (n + ((mask & 8) !== 0 ? 1 : 0));
      if (op === 0xcf) { save(mask, R[SP]); R[SP] = (R[SP] - value) | 0; }
      else { restore(mask, (R[SP] + value) | 0); R[SP] = (R[SP] + value) | 0; }
    } else if (op <= 0xd9) { if (condition(op & 15, hazard, pc)) { jump = true; target = (R[LAR] - 4) | 0; } }
    else if (op === 0xda) { jump = true; target = (R[LAR] - 4) | 0; }
    else if (op === 0xdb) { R[LIR] = cv(next, 4); R[LAR] = (pc + 5) | 0; }
    else if (op === 0xdc) { jump = true; target = (pc + cv(next, 4)) | 0; next += 4; }
    else if (op === 0xde || op === 0xdf) {
      mask = cb(next);
      const sp = (R[SP] + cb(next + 1)) | 0;
      next += 2;
      target = op === 0xde ? R[MDR] : ld32(sp);
      restore(mask, sp);
      R[SP] = sp; jump = true;
    } else if (op <= 0xef) { R[D0 + dst] = add(R[D0 + dst], R[D0 + src]); }
    else if (op === 0xf0) {
      next++; src = (p >> 2) & 3; dst = p & 3;
      switch (p & 0xf0) {
        case 0x00: R[A0 + src] = ld32(R[A0 + dst]); break;
        case 0x10: st32(R[A0 + dst], R[A0 + src]); break;
        case 0x40: R[D0 + src] = ld8(R[A0 + dst]); break;
        case 0x50: st8(R[A0 + dst], R[D0 + src]); break;
        case 0x60: R[D0 + src] = ld16(R[A0 + dst]); break;
        case 0x70: st16(R[A0 + dst], R[D0 + src]); break;
        case 0x80: bitOp(R[A0 + dst], R[D0 + src], 1); break;
        case 0x90: bitOp(R[A0 + dst], R[D0 + src], 2); break;
        case 0xf0:
          if (p < 0xf4) { st32(R[SP], next); R[MDR] = next; jump = true; target = R[A0 + dst]; }
          else if (p < 0xf8) { jump = true; target = R[A0 + dst]; }
          else if (p === 0xfc) { jump = true; target = ld32(R[SP]); }
          else if (p === 0xfd) {
            const swap = S.mutant === MUT_RTI_SWAP;    // check_irq negative control
            value = (swap ? ld32((R[SP] + 4) | 0) : ld16(R[SP])) & 0xffff; target = ld32(swap ? R[SP] : (R[SP] + 4) | 0);
            if (value & 0xc0f0) throw new Fault(6, pc);
            R[SP] = (R[SP] + 8) | 0; R[PSW] = value; R[UNDEF] = 0; newHazard = S.mutant === MUT_RTI_WINDOW ? 2 : 0; jump = true;
          } else throw new Fault(1, pc);
          break;
        default: throw new Fault(1, pc);
      }
    } else if (op === 0xf1) {
      next++; src = (p >> 2) & 3; dst = p & 3;
      switch (p & 0xf0) {
        case 0x00: R[D0 + dst] = sub(R[D0 + dst], R[D0 + src]); break;
        case 0x10: R[D0 + dst] = sub(R[D0 + dst], R[A0 + src]); break;
        case 0x20: R[A0 + dst] = sub(R[A0 + dst], R[D0 + src]); break;
        case 0x30: R[A0 + dst] = sub(R[A0 + dst], R[A0 + src]); break;
        case 0x40: case 0x80: {
          const l = R[D0 + dst], r = R[D0 + src];
          readFlags(C, hazard, pc);
          const c = (R[PSW] & C) ? 1 : 0;
          let x;
          if (p < 0x80) { x = (l + r + c) | 0; flags(x, (l >>> 0) + (r >>> 0) + c > 0xffffffff, (~(l ^ r) & (l ^ x)) < 0); }
          else { x = (l - r - c) | 0; flags(x, (r >>> 0) + c > (l >>> 0), ((l ^ r) & (l ^ x)) < 0); }
          R[D0 + dst] = x; break;
        }
        case 0x50: R[D0 + dst] = add(R[D0 + dst], R[A0 + src]); break;
        case 0x60: R[A0 + dst] = add(R[A0 + dst], R[D0 + src]); break;
        case 0x70: R[A0 + dst] = add(R[A0 + dst], R[A0 + src]); break;
        case 0x90: sub(R[D0 + dst], R[A0 + src]); break;
        case 0xa0: sub(R[A0 + dst], R[D0 + src]); break;
        case 0xd0: R[D0 + dst] = R[A0 + src]; break;
        case 0xe0: R[A0 + dst] = R[D0 + src]; break;
        default: throw new Fault(1, pc);
      }
    } else if (op === 0xf2) {
      next++; src = (p >> 2) & 3; dst = p & 3;
      switch (p >> 4) {
        case 0: R[D0 + dst] = logic(R[D0 + dst] & R[D0 + src]); break;
        case 1: R[D0 + dst] = logic(R[D0 + dst] | R[D0 + src]); break;
        case 2: R[D0 + dst] = logic(R[D0 + dst] ^ R[D0 + src]); break;
        case 3: if (p > 0x33) throw new Fault(1, pc); R[D0 + dst] = logic(~R[D0 + dst]); break;
        case 4: case 5: {
          const a = R[D0 + dst], b = R[D0 + src];
          const lo = Math.imul(a, b), hi = p < 0x50 ? mulhs(a, b) : mulhu(a, b);
          R[D0 + dst] = lo; R[MDR] = hi;
          pswFlags(nz(lo), Z | N, V | C); break;
        }
        case 6: {
          const dividend = (BigInt(R[MDR]) << 32n) | BigInt(R[D0 + dst] >>> 0);
          const divisor = BigInt(R[D0 + src]);
          if (divisor === 0n || (dividend === -(1n << 63n) && divisor === -1n)) throw new Fault(6, pc);
          const q = dividend / divisor, r = dividend % divisor;
          if (q < -(1n << 31n) || q > (1n << 31n) - 1n) throw new Fault(6, pc);
          R[D0 + dst] = Number(q); R[MDR] = Number(BigInt.asIntN(32, r));
          pswFlags(nz(R[D0 + dst]), Z | N | V, C); break;
        }
        case 7: {
          const dividend = (BigInt(R[MDR] >>> 0) << 32n) | BigInt(R[D0 + dst] >>> 0);
          const divisor = BigInt(R[D0 + src] >>> 0);
          if (divisor === 0n) throw new Fault(6, pc);
          const q = dividend / divisor;
          if (q > 0xffffffffn) throw new Fault(6, pc);
          R[D0 + dst] = Number(BigInt.asIntN(32, q)); R[MDR] = Number(BigInt.asIntN(32, dividend % divisor));
          if (q <= 0x7fffffffn) pswFlags(nz(R[D0 + dst]), Z | N | V, C); else pswFlags(nz(R[D0 + dst]), Z | N, C | V);
          break;
        }
        case 8: {
          if (p > 0x87) throw new Fault(1, pc);
          readFlags(C, hazard, pc);
          const c = (R[PSW] & C) ? 1 : 0, x = R[D0 + dst];
          let out, res;
          if (p < 0x84) { out = x >>> 31; res = (x << 1) | c; } else { out = x & 1; res = (x >>> 1) | (c << 31); }
          flags(res, out, false); R[D0 + dst] = res; break;
        }
        case 9: case 10: case 11: R[D0 + dst] = shift(R[D0 + dst], R[D0 + src], (p >> 4) - 9); break;
        case 13: if (p > 0xd3) throw new Fault(1, pc); R[MDR] = R[D0 + dst] < 0 ? -1 : 0; break;
        case 14:
          if (p < 0xe4) R[D0 + dst] = R[MDR];
          else if (p < 0xe8) { if (hazard) throw new Fault(6, pc); R[D0 + dst] = R[PSW] & 0xffff; }
          else throw new Fault(1, pc);
          break;
        case 15:
          switch (p & 3) {
            case 0: if (R[A0 + src] & 3) throw new Fault(3, R[A0 + src]); R[SP] = R[A0 + src]; break;
            case 2: R[MDR] = R[D0 + src]; break;
            case 3: value = R[D0 + src] & 0xffff; if (value & 0xc0f0) throw new Fault(6, pc);
              R[PSW] = value; R[UNDEF] = 0; newHazard = 2; break;
            default: throw new Fault(1, pc);
          }
          break;
        default: throw new Fault(1, pc);
      }
    } else if (op === 0xf3 || op === 0xf4) {
      next++;
      addr = (R[A0 + (p & 3)] + R[D0 + ((p >> 2) & 3)]) | 0;
      src = (p >> 4) & 3;
      if (op === 0xf3) {
        if (p < 0x40) R[D0 + src] = ld32(addr);
        else if (p < 0x80) st32(addr, R[D0 + src]);
        else if (p < 0xc0) R[A0 + src] = ld32(addr);
        else st32(addr, R[A0 + src]);
      } else {
        const w = p < 0x80 ? 1 : 2;
        if (!(p & 0x40)) R[D0 + src] = w === 1 ? ld8(addr) : ld16(addr);
        else (w === 1 ? st8 : st16)(addr, R[D0 + src]);
      }
    } else if (op === 0xf6) {
      const nn = p >> 4, m = (p >> 2) & 3, n = p & 3;
      next++;
      switch (nn) {
        case 0: { const a = R[D0 + n], b = R[D0 + m]; R[D0 + n] = Math.imul(a, b); R[HI] = mulhs(a, b); break; }
        case 1: R[D0 + n] = Math.imul(R[D0 + n], R[D0 + m]); break;
        case 2: case 3: case 4: case 5: R[D0 + n] = udfFloat(nn, R[D0 + n], R[D0 + m], pc); break;
        case 6: udfCompare(R[D0 + n], R[D0 + m], pc); break;
        case 12: if (m !== n) throw new Fault(1, pc); R[D0 + n] = R[UC]; break;
        case 13: if (m !== n) throw new Fault(1, pc); R[D0 + n] = R[UD]; break;
        case 15: if (m !== n) throw new Fault(1, pc); R[D0 + n] = R[HI]; break;
        default: throw new Fault(1, pc);
      }
      if (nn === 13 && S.mutant !== MUT_UDF13_V) pswFlags(R[UV] ? V : 0, V, Z | N | C);
      else if (nn !== 6) pswFlags(0, 0, 15);
    } else if (op === 0xf9 || op === 0xfb || op === 0xfd) {
      const w = op === 0xf9 ? 1 : op === 0xfb ? 2 : 4;
      const nn = p >> 4, tt = (p >> 2) & 3, n = p & 3;
      next++;
      imm = cv(next, w); next += w;
      if (nn === 0 && tt === 0) R[D0 + n] = Math.imul(R[D0 + n], w === 1 ? s8(imm) : w === 2 ? s16(imm) : imm);
      else if (nn === 1 && tt === 1) R[D0 + n] = Math.imul(R[D0 + n], imm);
      else if (nn === 14 && tt === 0 && w === 1 && imm === 0x40) { FB[0] = R[D0 + n]; R[D0 + n] = FBI[0]; }
      else if (nn === 14 && tt === 0 && w === 2 && imm === 0x80) R[D0 + n] = udfFloatToInt(R[D0 + n], pc);
      else throw new Fault(1, pc);
      pswFlags(0, 0, 15);
    } else if (op === 0xf8 || op === 0xfa || op === 0xfc) {
      const w = op === 0xf8 ? 1 : op === 0xfa ? 2 : 4;
      next++;
      src = (p >> 2) & 3; dst = p & 3;
      if (op === 0xfa && p >= 0xf0 && p <= 0xfb) {
        addr = (R[A0 + dst] + s8(cb(next))) | 0;
        imm = cb(next + 1); next += 2;
        bitOp(addr, imm, p < 0xf4 ? 1 : p < 0xf8 ? 2 : 0);
      } else {
        imm = cv(next, w); next += w;
        const simm = w === 1 ? s8(imm) : w === 2 ? s16(imm) : imm;
        if (w < 4) imm = imm & (w === 1 ? 0xff : 0xffff);
        if (p < 0x80) {
          addr = (R[A0 + dst] + simm) | 0;
          const mw = p < 0x40 ? 4 : p < 0x60 ? 1 : 2;
          if (p & 0x10) {
            const v = (p & 0xe0) === 0x20 ? R[A0 + src] : R[D0 + src];
            (mw === 4 ? st32 : mw === 1 ? st8 : st16)(addr, v);
          } else {
            value = mw === 4 ? ld32(addr) : mw === 1 ? ld8(addr) : ld16(addr);
            if ((p & 0xe0) === 0x20) R[A0 + src] = value; else R[D0 + src] = value;
          }
        } else if (p < 0x90) {
          if (op === 0xfc) { const k = p & 3; const v = k === 0 ? R[A0 + src] : R[D0 + src]; (k < 2 ? st32 : k === 2 ? st8 : st16)(imm, v); }
          else if (op === 0xfa && (p & 3) === 0) st32(imm, R[A0 + src]);
          else throw new Fault(1, pc);
        } else if (p < 0xa0) {
          const k = p & 3;
          if (op === 0xf8 && k < 2) throw new Fault(1, pc);
          const v = k === 0 ? R[A0 + src] : R[D0 + src];
          (k < 2 ? st32 : k === 2 ? st8 : st16)((R[SP] + imm) | 0, v);
        } else if (p < 0xb0) {
          if (op === 0xfc) { value = p < 0xa8 ? ld32(imm) : p < 0xac ? ld8(imm) : ld16(imm); if (p < 0xa4) R[A0 + dst] = value; else R[D0 + dst] = value; }
          else if (op === 0xfa && p <= 0xa3) R[A0 + dst] = ld32(imm);
          else throw new Fault(1, pc);
        } else if (p < 0xc0) {
          if (op === 0xf8 && p < 0xb8) throw new Fault(1, pc);
          const a = (R[SP] + imm) | 0;
          value = p < 0xb8 ? ld32(a) : p < 0xbc ? ld8(a) : ld16(a);
          if (p < 0xb4) R[A0 + dst] = value; else R[D0 + dst] = value;
        } else if (op === 0xf8) {
          if (p <= 0xcb) R[D0 + dst] = shift(R[D0 + dst], imm, (p - 0xc0) >> 2);
          else if (p >= 0xe0 && p <= 0xe3) R[D0 + dst] = logic(R[D0 + dst] & imm);
          else if (p >= 0xe4 && p <= 0xe7) R[D0 + dst] = logic(R[D0 + dst] | imm);
          else if (p >= 0xe8 && p <= 0xeb) { if (condition(10 + (p - 0xe8), hazard, pc)) { jump = true; target = (pc + simm) | 0; } }
          else if (p >= 0xec && p <= 0xef) logic(R[D0 + dst] & imm);
          else if (p >= 0xf0 && p <= 0xf3) { value = ld32((R[A0 + dst] + simm) | 0); if (value & 3) throw new Fault(3, value); R[SP] = value; }
          else if (p >= 0xf4 && p <= 0xf7) st32((R[A0 + dst] + simm) | 0, R[SP]);
          else if (p === 0xfe) R[SP] = (R[SP] + simm) | 0;
          else throw new Fault(1, pc);
        } else {
          const wide = op === 0xfc;
          switch (p & 0xfc) {
            case 0xc0: R[D0 + dst] = add(R[D0 + dst], simm); break;
            case 0xc8: sub(R[D0 + dst], simm); break;
            case 0xd0: R[A0 + dst] = add(R[A0 + dst], simm); break;
            case 0xd8: sub(R[A0 + dst], imm); break;
            case 0xe0: R[D0 + dst] = logic(R[D0 + dst] & imm); break;
            case 0xe4: R[D0 + dst] = logic(R[D0 + dst] | imm); break;
            case 0xe8: R[D0 + dst] = logic(R[D0 + dst] ^ imm); break;
            case 0xec: logic(R[D0 + dst] & imm); break;
            case 0xc4: case 0xcc: case 0xd4: case 0xdc:
              if (!wide) throw new Fault(1, pc);
              switch (p & 0xfc) {
                case 0xc4: R[D0 + dst] = sub(R[D0 + dst], imm); break;
                case 0xcc: R[D0 + dst] = imm; break;
                case 0xd4: R[A0 + dst] = sub(R[A0 + dst], imm); break;
                case 0xdc: R[A0 + dst] = imm; break;
              }
              break;
            case 0xfc:
              if (p === 0xfe) R[SP] = (R[SP] + simm) | 0;
              else if (p === 0xff) { st32(R[SP], next); R[MDR] = next; jump = true; target = (pc + simm) | 0; }
              else if (!wide) {
                if (hazard) throw new Fault(6, pc);
                value = p === 0xfc ? R[PSW] & imm : R[PSW] | imm;
                if (value & 0xc0f0) throw new Fault(6, pc);
                R[PSW] = value; R[UNDEF] &= p === 0xfc ? imm : ~imm; newHazard = 2;
              } else throw new Fault(1, pc);
              break;
            default: throw new Fault(1, pc);
          }
        }
      }
    } else if (op === 0xfe) {
      const w = p & 0x80 ? 2 : 4;
      next++;
      if ((p & 0x7f) > 2) throw new Fault(1, pc);
      addr = cv(next, w); if (w === 2) addr &= 0xffff;
      imm = cb(next + w); next += w + 1;
      bitOp(addr, imm, (p & 3) === 0 ? 1 : (p & 3) === 1 ? 2 : 0);
    } else if (op === 0xf5 && (p >> 4) <= 1) {
      const nn = p >> 4, m = (p >> 2) & 3, n = p & 3;
      next++;
      if (nn === 0) { if (m !== n) throw new Fault(1, pc); R[HI] = R[D0 + n]; }
      else {
        const swap = S.mutant === MUT_UDF21_SWAP;    // check_irq negative control
        readFlags(V, hazard, pc); R[UC] = R[D0 + (swap ? n : m)]; R[UD] = R[D0 + (swap ? m : n)]; R[UV] = (R[PSW] & V) ? 1 : 0; pswFlags(0, 0, 15);
      }
    } else {
      throw new Fault(op === 0xff ? 5 : 1, pc);
    }
  } catch (e) {
    if (e instanceof Fault) { R[FAULT] = e.code; S.insns++; e.done = true; }   // the faulting instruction counts
    throw e;
  }
  R[PC] = jump ? target : next;
  R[HAZ] = newHazard;
  S.insns++;
}

export function udfCmpFlags(dn, dm, pc) {
  if (!normalOrZero(dm) || !normalOrZero(dn)) throw new Fault(1, pc);
  FBI[0] = dm; FBI[1] = dn;
  return (FB[0] === FB[1] ? Z : 0) | (FB[0] < FB[1] ? N : 0);
}
export function i2f(x) { FB[0] = x; return FBI[0]; }
export function f2i(x, pc) { return udfFloatToInt(x, pc); }

// ---- execInterrupt: maskable interrupt acceptance at a main-loop visit -------------------------------------------
// mutant values of the interrupt/UDF negative controls (check_irq), read from S.mutant (the machine's
// mutant option).
export const MUT_RTI_SWAP = 20, MUT_ACCEPT_IM = 21, MUT_VECTOR = 22, MUT_RTI_WINDOW = 24, MUT_UDF21_SWAP = 25, MUT_UDF13_V = 26;
// The high half of an accepted interrupt's vector, which is S.vectorPage | IVARn. VECTOR_PAGE is the default,
// which resetCpu sets: every body at the run-time bases 0x60021020 and 0x60020020 keeps its level slots in this page
// (E142, base 0x60020020, has them at 0x50010000, E143's 0x5000f000 moved by the base difference, and its reset head
// writes the same IVARs, D). The machine sets the board's (src/fw/board.mjs vector_page, read from the vector init's
// stores): the 0x60400020 bodies' reset heads write slots at 0x6041xxxx (E133 0x5000006c, D). Which register holds
// the high half on the chip is not known (docs/om1-intc-timer-spec.md A-VEC).
export const VECTOR_PAGE = 0x60030000;
// exec_interrupt's tests after the controller named the level, except psw_undef (the irq_wait case): would a look
// now take or wait for this level? (The kick refusals use it.)
export function admits(level) {
  const psw = R[PSW];
  if (level < 0 || !(psw & 0x800) || R[HAZ] !== 0) return false;
  return S.mutant === MUT_ACCEPT_IM || level < ((psw & 0x700) >> 8);
}
// Returns true when accepted. Not an instruction: insns and insn-limit are unaffected. A fault here (misaligned SP:
// 3, IVAR 0: 1) is thrown with done set (not counted) and stops the continue.
export function execInterrupt() {
  const level = S.intc.level();
  S.irqWait = false;
  const psw = R[PSW];
  if (level < 0 || !(psw & 0x800) || R[HAZ] !== 0) return false;
  if (S.mutant !== MUT_ACCEPT_IM && level >= ((psw & 0x700) >> 8)) return false;
  if (R[UNDEF] !== 0) { S.irqWait = true; return false; }
  const sp = R[SP], pc = R[PC];
  if (sp & 3) { R[FAULT] = 3; const f = new Fault(3, sp); f.done = true; throw f; }
  let ivar;
  try { ivar = ld16(0x8000 + 4 * level) & 0xffff; } catch (e) { if (e instanceof Fault) { R[FAULT] = e.code; e.done = true; } throw e; }
  if (S.mutant === MUT_VECTOR) ivar = 0x0080;              // check_irq negative control: one fixed slot
  if (!ivar) {   // this note line is written before the trap line of the fault
    R[FAULT] = 1; const f = new Fault(1, pc); f.done = true;
    f.note = `MN10300 interrupt level ${level} accepted at pc=${hx(pc)}: IVAR${level} (0x${(0x8000 + 4 * level).toString(16).padStart(4, '0')}) is 0, vector not initialised`;
    throw f;
  }
  // the entry stores are not step()'s stores, so no flash-view fault: the flash view is a ROM region and a store to
  // it is discarded.
  const entrySt32 = (a, v) => { if ((a >>> 0) < 0x50000000 || (a >>> 0) >= 0x52000000) st32(a, v); };
  try {
    entrySt32((sp - 8) | 0, psw & 0xffff);
    entrySt32((sp - 4) | 0, pc);
    st16(0x8a00, (16 + level) * 4);
  } catch (e) { if (e instanceof Fault) { R[FAULT] = e.code; e.done = true; } throw e; }
  R[SP] = (sp - 8) | 0;
  R[PSW] = (psw & ~0xf00) | (level << 8);
  R[UNDEF] = 15;
  R[PC] = S.vectorPage | ivar;
  S.intc.accepted(level, pc >>> 0, S.insns);
  return true;
}

// ---- debugger register access (registers 0..15; 'g' / 'G') ---------------------------------------------------------
export function getRegs() {
  const out = new Uint32Array(16);
  for (let k = 0; k < 15; k++) out[k] = R[k];
  out[15] = S.insns % 4294967296;
  return out;
}
export function setRegs(r16) {
  for (let k = 0; k < 15; k++) R[k] = r16[k] | 0;
  S.insns = r16[15] >>> 0;
  R[PSW] &= 0xffff; R[UNDEF] = 0; R[HAZ] = 0;            // a debugger-written PSW is defined and takes effect
}
// insns + 1 > insn-limit faults 7 after the code fetch (a fetch fault comes first and is not counted);
// the limit fault counts. Returns the Fault (for the machine's stderr line).
export function limitFault() {
  const pc = R[PC];
  try {
    const op = cb(pc);
    const p = op >= 0xf0 && op <= 0xfe && op !== 0xf7 ? cb(pc + 1) : 0;
    for (let i = 2, n = insnLength(op, p); i < n; i++) cb(pc + i);
  } catch (e) { if (!(e instanceof Fault)) throw e; R[FAULT] = e.code; return e; }
  R[FAULT] = 7; S.insns++;
  return new Fault(7, pc);
}
// The lines written on every CPU fault (the note, if any, then the trap line), each prefixed with the program name.
const hx = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
export const trapLines = (f, pc) => [...(f.note ? [`om-emu: ${f.note}`] : []),
  `om-emu: MN10300 trap reason=${f.code} pc=${hx(pc)} address=${hx(f.addr)}`];
