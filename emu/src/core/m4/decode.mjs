// Cortex-M4 (ARMv7E-M) Thumb / Thumb-2 decoder: one instruction's halfwords to a record of its form and operands. The
// executor (cpu.mjs) dispatches on the record's op; the census (bin/m4census.mjs) counts op + encoding. Encodings follow
// the ARMv7-M Architecture Reference Manual (DDI 0403E), chapter A5 (the instruction set encoding) and A7 (the
// instructions); names below are the manual's, the encoding numbers (T1..T4) too.
//
// The record (fields a form does not use keep their defaults):
//   op     the operation the executor runs (a few encodings share one: 'dp' is every data-processing form)
//   enc    the manual's encoding name, e.g. 'ADD (immediate) T3', what the census counts
//   len    2 or 4 bytes
//   rd rn rm ra   registers (ra: the accumulator, the second transfer register, RdHi); -1 when absent
//   imm    an immediate, already expanded (ThumbExpandImm, sign extension, scaling)
//   ic     ThumbExpandImm's carry: -1 unchanged, else 0 or 1
//   sh sa  a shift type (0 LSL, 1 LSR, 2 ASR, 3 ROR, 4 RRX) and amount; for a shift by register, sa = -1
//   s      setflags: 0 no, 1 yes, 2 yes outside an IT block (the 16-bit forms)
//   alu    the data-processing operation (ALU_* below)
//   cond   the condition of B T1 / T3, and IT's firstcond; 14 otherwise
//   list   a register list (LDM / STM / PUSH / POP), or IT's mask, or VFP's register count
//   add idx wb    a load / store's U, P and W
//   sz     an access size in bytes, sg a sign-extending load, t an unprivileged (LDRT / STRT) form
//   unp    the encoding is UNPREDICTABLE per the manual (the executor runs it the plain way; the oracle avoids it)
// An UNDEFINED encoding decodes to op 'udf' (UsageFault UNDEFINSTR when executed); a coprocessor encoding other than
// the VFP's is 'nocp' (UsageFault NOCP, the M4 has no other coprocessor).

export const ALU_AND = 0, ALU_EOR = 1, ALU_ORR = 2, ALU_ORN = 3, ALU_BIC = 4, ALU_MOV = 5, ALU_MVN = 6, ALU_ADD = 7,
  ALU_ADC = 8, ALU_SUB = 9, ALU_SBC = 10, ALU_RSB = 11, ALU_TST = 12, ALU_TEQ = 13, ALU_CMP = 14, ALU_CMN = 15;
export const ALU_NAMES = ['AND', 'EOR', 'ORR', 'ORN', 'BIC', 'MOV', 'MVN', 'ADD', 'ADC', 'SUB', 'SBC', 'RSB', 'TST', 'TEQ', 'CMP', 'CMN'];
const SHIFT_NAMES = ['LSL', 'LSR', 'ASR', 'ROR'];

function rec(op, enc, len) {
  return { op, enc, len, rd: -1, rn: -1, rm: -1, ra: -1, imm: 0, ic: -1, sh: 0, sa: 0, s: 0, alu: 0, cond: 14, list: 0,
    add: 1, idx: 1, wb: 0, sz: 4, sg: 0, t: 0, unp: false };
}
const udf = (len, why) => { const r = rec('udf', why, len); return r; };

// the length of the instruction whose first halfword is hw1
export const thumbLength = (hw1) => ((hw1 >>> 11) >= 0x1d ? 4 : 2);

const bad = (r) => r === 13 || r === 15;
// the special registers MRS / MSR name (B5.1.1): APSR .. IEPSR, MSP, PSP, PRIMASK, BASEPRI, BASEPRI_MAX, FAULTMASK, CONTROL
const SYSM = [0, 1, 2, 3, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20];
const sx = (v, bits) => (v << (32 - bits)) >> (32 - bits);

// ThumbExpandImm_C: the 12-bit modified immediate to {imm32, carry}; returns null for the UNPREDICTABLE zero byte forms
function expandImm(imm12) {
  const imm8 = imm12 & 0xff;
  if ((imm12 >>> 10) === 0) {
    switch ((imm12 >>> 8) & 3) {
      case 0: return { v: imm8, c: -1, unp: false };
      case 1: return { v: (imm8 << 16) | imm8, c: -1, unp: imm8 === 0 };
      case 2: return { v: ((imm8 << 24) | (imm8 << 8)) | 0, c: -1, unp: imm8 === 0 };
      default: return { v: ((imm8 << 24) | (imm8 << 16) | (imm8 << 8) | imm8) | 0, c: -1, unp: imm8 === 0 };
    }
  }
  const unrot = 0x80 | (imm12 & 0x7f), rot = imm12 >>> 7;
  const v = ((unrot >>> rot) | (unrot << (32 - rot))) | 0;
  return { v, c: v >>> 31, unp: false };
}
// DecodeImmShift
function immShift(type, imm5) {
  switch (type) {
    case 0: return [0, imm5];
    case 1: return [1, imm5 === 0 ? 32 : imm5];
    case 2: return [2, imm5 === 0 ? 32 : imm5];
    default: return imm5 === 0 ? [4, 1] : [3, imm5];
  }
}

function dp(enc, len, alu, rd, rn, s) {
  const r = rec('dp', enc, len);
  r.alu = alu; r.rd = rd; r.rn = rn; r.s = s;
  return r;
}

// ---- 16-bit
function decode16(hw) {
  const top = hw >>> 10;
  if (top < 0x10) {                                   // 00xxxx: shift (immediate), add, subtract, move, compare
    const opc = (hw >>> 9) & 0x1f, rd = hw & 7, rn = (hw >>> 3) & 7;
    if (opc < 0x0c) {                                 // LSL / LSR / ASR (immediate), MOV (register) T2
      const type = opc >>> 2, imm5 = (hw >>> 6) & 0x1f;
      if (type === 0 && imm5 === 0) { const r = dp('MOV (register) T2', 2, ALU_MOV, rd, -1, 1); r.rm = rn; return r; }
      const r = dp(`${SHIFT_NAMES[type]} (immediate) T1`, 2, ALU_MOV, rd, -1, 2);
      r.rm = rn; [r.sh, r.sa] = immShift(type, imm5);
      return r;
    }
    if (opc === 0x0c || opc === 0x0d) {               // ADD / SUB (register) T1
      const r = dp(opc === 0x0c ? 'ADD (register) T1' : 'SUB (register) T1', 2, opc === 0x0c ? ALU_ADD : ALU_SUB, rd, rn, 2);
      r.rm = (hw >>> 6) & 7;
      return r;
    }
    if (opc === 0x0e || opc === 0x0f) {               // ADD / SUB (immediate) T1
      const r = dp(opc === 0x0e ? 'ADD (immediate) T1' : 'SUB (immediate) T1', 2, opc === 0x0e ? ALU_ADD : ALU_SUB, rd, rn, 2);
      r.rm = -1; r.imm = (hw >>> 6) & 7;
      return r;
    }
    const rdn = (hw >>> 8) & 7, imm8 = hw & 0xff, k = (opc >>> 2) & 3;
    const r = k === 0 ? dp('MOV (immediate) T1', 2, ALU_MOV, rdn, -1, 2)
      : k === 1 ? dp('CMP (immediate) T1', 2, ALU_CMP, -1, rdn, 1)
        : dp(k === 2 ? 'ADD (immediate) T2' : 'SUB (immediate) T2', 2, k === 2 ? ALU_ADD : ALU_SUB, rdn, rdn, 2);
    r.imm = imm8;
    return r;
  }
  if (top === 0x10) {                                 // 010000: data processing
    const opc = (hw >>> 6) & 15, rdn = hw & 7, rm = (hw >>> 3) & 7;
    switch (opc) {
      case 2: case 3: case 4: case 7: {               // LSL / LSR / ASR / ROR (register): MOV with a register shift
        const t = opc === 2 ? 0 : opc === 3 ? 1 : opc === 4 ? 2 : 3;
        const r = dp(`${SHIFT_NAMES[t]} (register) T1`, 2, ALU_MOV, rdn, -1, 2);
        r.rm = rdn; r.ra = rm; r.sh = t; r.sa = -1;
        return r;
      }
      case 9: { const r = dp('RSB (immediate) T1', 2, ALU_RSB, rdn, rm, 2); r.imm = 0; return r; }
      case 13: { const r = rec('mul', 'MUL T1', 2); r.rd = rdn; r.rn = rm; r.rm = rdn; r.s = 2; return r; }
      default: {
        const map = [[ALU_AND, 'AND'], [ALU_EOR, 'EOR'], null, null, null, [ALU_ADC, 'ADC'], [ALU_SBC, 'SBC'], null,
          [ALU_TST, 'TST'], null, [ALU_CMP, 'CMP'], [ALU_CMN, 'CMN'], [ALU_ORR, 'ORR'], null, [ALU_BIC, 'BIC'], [ALU_MVN, 'MVN']][opc];
        const [alu, name] = map;
        const test = alu >= ALU_TST;
        const r = dp(`${name} (register) T1`, 2, alu, test ? -1 : rdn, alu === ALU_MVN ? -1 : rdn, test ? 1 : 2);
        r.rm = rm;
        return r;
      }
    }
  }
  if (top === 0x11) {                                 // 010001: special data processing, branch and exchange
    const opc = (hw >>> 6) & 15, rm = (hw >>> 3) & 15, rdn = ((hw >>> 4) & 8) | (hw & 7);
    if (opc < 4) {
      const r = dp('ADD (register) T2', 2, ALU_ADD, rdn, rdn, 0); r.rm = rm;
      r.unp = rdn === 15 && rm === 15;
      if (rm === 13 || rdn === 13) r.enc = 'ADD (SP plus register) T1/T2';
      return r;
    }
    if (opc < 8) { const r = dp('CMP (register) T2', 2, ALU_CMP, -1, rdn, 1); r.rm = rm; r.unp = (rdn < 8 && rm < 8) || rdn === 15 || rm === 15; return r; }   // 0100: both low, UNPREDICTABLE
    if (opc < 12) { const r = dp('MOV (register) T1', 2, ALU_MOV, rdn, -1, 0); r.rm = rm; return r; }
    const r = rec(opc < 14 ? 'bx' : 'blx', opc < 14 ? 'BX T1' : 'BLX (register) T1', 2);
    r.rm = rm; r.unp = (hw & 7) !== 0 || (opc >= 14 && rm === 15);
    return r;
  }
  if (top === 0x12 || top === 0x13) {                 // 01001x: LDR (literal) T1
    const r = rec('ldr', 'LDR (literal) T1', 2); r.rd = (hw >>> 8) & 7; r.rn = 15; r.imm = (hw & 0xff) << 2;
    return r;
  }
  if (top < 0x18) {                                   // 0101xx: load / store (register offset)
    const o = (hw >>> 9) & 7;
    const k = [['str', 4, 0, 'STR'], ['str', 2, 0, 'STRH'], ['str', 1, 0, 'STRB'], ['ldr', 1, 1, 'LDRSB'],
      ['ldr', 4, 0, 'LDR'], ['ldr', 2, 0, 'LDRH'], ['ldr', 1, 0, 'LDRB'], ['ldr', 2, 1, 'LDRSH']][o];
    const r = rec(k[0], `${k[3]} (register) T1`, 2);
    r.sz = k[1]; r.sg = k[2]; r.rd = hw & 7; r.rn = (hw >>> 3) & 7; r.rm = (hw >>> 6) & 7;
    return r;
  }
  if (top < 0x28) {                                   // 011xxx, 100xxx: load / store (immediate)
    const g = (hw >>> 11) & 0x1f;                     // 01100 .. 10011
    const rt = hw & 7, rn = (hw >>> 3) & 7, imm5 = (hw >>> 6) & 0x1f;
    const k = { 0x0c: ['str', 4, 'STR (immediate) T1'], 0x0d: ['ldr', 4, 'LDR (immediate) T1'], 0x0e: ['str', 1, 'STRB (immediate) T1'],
      0x0f: ['ldr', 1, 'LDRB (immediate) T1'], 0x10: ['str', 2, 'STRH (immediate) T1'], 0x11: ['ldr', 2, 'LDRH (immediate) T1'] }[g];
    if (k) {
      const r = rec(k[0], k[2], 2); r.sz = k[1]; r.rd = rt; r.rn = rn; r.imm = imm5 * k[1];
      return r;
    }
    const r = rec(g === 0x12 ? 'str' : 'ldr', g === 0x12 ? 'STR (immediate) T2' : 'LDR (immediate) T2', 2);
    r.rd = (hw >>> 8) & 7; r.rn = 13; r.imm = (hw & 0xff) << 2;
    return r;
  }
  if (top < 0x2c) {                                   // 1010xx: ADR T1, ADD (SP plus immediate) T1
    const sp = (hw >>> 11) & 1;
    const r = dp(sp ? 'ADD (SP plus immediate) T1' : 'ADR T1', 2, ALU_ADD, (hw >>> 8) & 7, sp ? 13 : 15, 0);
    r.imm = (hw & 0xff) << 2;
    if (!sp) { r.op = 'adr'; }
    return r;
  }
  if (top < 0x30) return misc16(hw);                  // 1011xx
  if (top < 0x34) {                                   // 1100xx: STM T1, LDM T1
    const load = (hw >>> 11) & 1, rn = (hw >>> 8) & 7, list = hw & 0xff;
    const r = rec(load ? 'ldm' : 'stm', load ? 'LDM T1' : 'STM T1', 2);
    r.rn = rn; r.list = list; r.wb = load ? ((list >>> rn) & 1 ? 0 : 1) : 1; r.add = 1;
    r.unp = list === 0 || (!load && ((list >>> rn) & 1) && (list & ((1 << rn) - 1)) !== 0);
    return r;
  }
  if (top < 0x38) {                                   // 1101xx: conditional branch, UDF, SVC
    const cond = (hw >>> 8) & 15;
    if (cond === 14) { const r = udf(2, 'UDF T1'); r.imm = hw & 0xff; return r; }
    if (cond === 15) { const r = rec('svc', 'SVC T1', 2); r.imm = hw & 0xff; return r; }
    const r = rec('b', 'B T1', 2); r.cond = cond; r.imm = sx(hw & 0xff, 8) * 2;
    return r;
  }
  if (top < 0x3a) {                                   // 11100x: B T2
    const r = rec('b', 'B T2', 2); r.imm = sx(hw & 0x7ff, 11) * 2;
    return r;
  }
  return udf(2, 'UNDEFINED 16-bit');
}

function misc16(hw) {
  const opc = (hw >>> 5) & 0x7f;
  if (opc < 4) { const r = dp('ADD (SP plus immediate) T2', 2, ALU_ADD, 13, 13, 0); r.imm = (hw & 0x7f) << 2; return r; }
  if (opc < 8) { const r = dp('SUB (SP minus immediate) T1', 2, ALU_SUB, 13, 13, 0); r.imm = (hw & 0x7f) << 2; return r; }
  if ((hw & 0x0500) === 0x0100) {                     // CB{N}Z: 1011 o0i1
    const r = rec('cbz', (hw & 0x0800) ? 'CBNZ T1' : 'CBZ T1', 2);
    r.rn = hw & 7; r.imm = (((hw >>> 9) & 1) << 6) | (((hw >>> 3) & 0x1f) << 1); r.add = (hw >>> 11) & 1;   // add: nonzero
    return r;
  }
  if (opc >= 0x10 && opc < 0x18) {                    // SXTH / SXTB / UXTH / UXTB T1
    const k = (opc >>> 1) & 3;
    const r = rec('ext', ['SXTH T1', 'SXTB T1', 'UXTH T1', 'UXTB T1'][k], 2);
    r.rd = hw & 7; r.rm = (hw >>> 3) & 7; r.sz = k & 1 ? 1 : 2; r.sg = k < 2 ? 1 : 0; r.imm = 0; r.rn = -1;
    return r;
  }
  if ((opc & 0x70) === 0x20) {                        // PUSH T1
    const r = rec('stm', 'PUSH T1', 2); r.rn = 13; r.add = 0; r.wb = 1; r.list = (hw & 0xff) | ((hw & 0x100) << 6);
    r.unp = r.list === 0;
    return r;
  }
  if ((opc & 0x70) === 0x60) {                        // POP T1
    const r = rec('ldm', 'POP T1', 2); r.rn = 13; r.add = 1; r.wb = 1; r.list = (hw & 0xff) | ((hw & 0x100) << 7);
    r.unp = r.list === 0;
    return r;
  }
  if ((hw & 0xffe0) === 0xb660) {                     // CPS: 1011 0110 011 im (0) (0) I F
    const r = rec('cps', 'CPS T1', 2); r.imm = hw & 3; r.add = (hw >>> 4) & 1;   // add: im (1 = disable)
    r.unp = (hw & 3) === 0 || (hw & 0xc) !== 0;
    return r;
  }
  if ((hw & 0xff00) === 0xba00) {                     // REV / REV16 / REVSH
    const k = (hw >>> 6) & 3;
    if (k === 2) return udf(2, 'UNDEFINED 0xba8x');
    const r = rec('rev', ['REV T1', 'REV16 T1', '', 'REVSH T1'][k], 2); r.rd = hw & 7; r.rm = (hw >>> 3) & 7; r.sh = k;
    return r;
  }
  if ((hw & 0xfff7) === 0xb650) return udf(2, 'UNDEFINED SETEND (an A-profile instruction)');
  if ((hw & 0xff00) === 0xbe00) { const r = rec('bkpt', 'BKPT T1', 2); r.imm = hw & 0xff; return r; }
  if ((hw & 0xff00) === 0xbf00) {
    if (hw & 15) {
      const r = rec('it', 'IT T1', 2); r.cond = (hw >>> 4) & 15; r.list = hw & 15;
      r.unp = r.cond === 15 || (r.cond === 14 && (hw & 15) !== 8);
      return r;
    }
    return hint((hw >>> 4) & 15, 2, 'T1');
  }
  return udf(2, 'UNDEFINED misc 16-bit');
}

function hint(h, len, t) {
  const names = { 0: 'NOP', 1: 'YIELD', 2: 'WFE', 3: 'WFI', 4: 'SEV' };
  const r = rec('hint', `${names[h] || (h >= 0xf0 ? 'DBG' : 'NOP (hint)')} ${t}`, len);
  r.imm = h;
  return r;
}

// ---- 32-bit
function decode32(hw1, hw2) {
  const op1 = (hw1 >>> 11) & 3, op2 = (hw1 >>> 4) & 0x7f;
  if (op1 === 1) {
    if ((op2 & 0x64) === 0x00) return ldmStm32(hw1, hw2);
    if ((op2 & 0x64) === 0x04) return dualExcl(hw1, hw2);
    if ((op2 & 0x60) === 0x20) return dpShiftedReg(hw1, hw2);
    return coproc(hw1, hw2);
  }
  if (op1 === 2) {
    if (hw2 & 0x8000) return branchMisc(hw1, hw2);
    return (op2 & 0x20) ? dpPlainImm(hw1, hw2) : dpModImm(hw1, hw2);
  }
  // op1 === 3
  if ((op2 & 0x71) === 0x00) return storeSingle(hw1, hw2);
  if ((op2 & 0x67) === 0x01) return loadNarrow(hw1, hw2, 1);
  if ((op2 & 0x67) === 0x03) return loadNarrow(hw1, hw2, 2);
  if ((op2 & 0x67) === 0x05) return loadWord(hw1, hw2);
  if ((op2 & 0x67) === 0x07) return udf(4, 'UNDEFINED load 0xf8x7');
  if ((op2 & 0x70) === 0x20) return dpReg(hw1, hw2);
  if ((op2 & 0x78) === 0x30) return mulAcc(hw1, hw2);
  if ((op2 & 0x78) === 0x38) return longMul(hw1, hw2);
  if (op2 & 0x40) return coproc(hw1, hw2);
  return udf(4, 'UNDEFINED 32-bit');
}

function ldmStm32(hw1, hw2) {
  const opc = (hw1 >>> 7) & 3, load = (hw1 >>> 4) & 1, w = (hw1 >>> 5) & 1, rn = hw1 & 15;
  if (opc === 0 || opc === 3) return udf(4, 'UNDEFINED SRS / RFE');
  const ia = opc === 1;
  let enc;
  if (ia) enc = load ? (w && rn === 13 ? 'POP T2' : 'LDM T2') : 'STM T2';
  else enc = load ? 'LDMDB T1' : (w && rn === 13 ? 'PUSH T2' : 'STMDB T1');
  const r = rec(load ? 'ldm' : 'stm', enc, 4);
  r.rn = rn; r.add = ia ? 1 : 0; r.wb = w; r.list = hw2;
  const n = popcount(hw2);
  if (load) r.unp = rn === 15 || n < 2 || (hw2 & 0x2000) !== 0 || (hw2 & 0xc000) === 0xc000 || (w && ((hw2 >>> rn) & 1) === 1);
  else r.unp = rn === 15 || n < 2 || (hw2 & 0xa000) !== 0 || (w && ((hw2 >>> rn) & 1) === 1);
  if ((enc === 'POP T2' || enc === 'PUSH T2') && n === 1) r.unp = true;   // the single-register forms are LDR / STR T4
  return r;
}

function dualExcl(hw1, hw2) {
  const p = (hw1 >>> 8) & 1, u = (hw1 >>> 7) & 1, w = (hw1 >>> 5) & 1, load = (hw1 >>> 4) & 1, rn = hw1 & 15;
  const rt = hw2 >>> 12, rt2 = (hw2 >>> 8) & 15;
  if (p === 0 && w === 0) {
    if (u === 0) {                                    // STREX / LDREX
      const r = rec(load ? 'ldrex' : 'strex', load ? 'LDREX T1' : 'STREX T1', 4);
      r.rn = rn; r.imm = (hw2 & 0xff) << 2; r.sz = 4;
      if (load) { r.rd = rt; r.unp = bad(rt) || rn === 15 || rt2 !== 15; }
      else { r.rm = rt; r.rd = rt2; r.unp = bad(rt2) || bad(rt) || rn === 15 || rt2 === rn || rt2 === rt; }
      return r;
    }
    const op3 = (hw2 >>> 4) & 15;
    if (!load) {
      if (op3 === 4 || op3 === 5) {
        const r = rec('strex', op3 === 4 ? 'STREXB T1' : 'STREXH T1', 4);
        r.rn = rn; r.rm = rt; r.rd = hw2 & 15; r.sz = op3 === 4 ? 1 : 2; r.imm = 0;
        r.unp = bad(r.rd) || bad(rt) || rn === 15 || r.rd === rn || r.rd === rt || rt2 !== 15;
        return r;
      }
      return udf(4, 'UNDEFINED 0xe8cx');
    }
    if (op3 === 0 || op3 === 1) {
      const r = rec('tb', op3 ? 'TBH T1' : 'TBB T1', 4); r.rn = rn; r.rm = hw2 & 15; r.sz = op3 ? 2 : 1;
      r.unp = rn === 13 || bad(r.rm) || (hw2 & 0xff00) !== 0xf000;
      return r;
    }
    if (op3 === 4 || op3 === 5) {
      const r = rec('ldrex', op3 === 4 ? 'LDREXB T1' : 'LDREXH T1', 4); r.rn = rn; r.rd = rt; r.sz = op3 === 4 ? 1 : 2; r.imm = 0;
      r.unp = bad(rt) || rn === 15 || (hw2 & 0x0f0f) !== 0x0f0f;
      return r;
    }
    return udf(4, 'UNDEFINED 0xe8dx');
  }
  const r = rec(load ? 'ldrd' : 'strd', load ? (rn === 15 ? 'LDRD (literal) T1' : 'LDRD (immediate) T1') : 'STRD (immediate) T1', 4);
  r.rn = rn; r.rd = rt; r.ra = rt2; r.imm = (hw2 & 0xff) << 2; r.add = u; r.idx = p; r.wb = w;
  if (load) r.unp = (w && (rn === rt || rn === rt2)) || bad(rt) || bad(rt2) || rt === rt2 || (rn === 15 && w);
  else r.unp = (w && (rn === rt || rn === rt2)) || rn === 15 || bad(rt) || bad(rt2);
  return r;
}

function dpShiftedReg(hw1, hw2) {
  const opc = (hw1 >>> 5) & 15, s = (hw1 >>> 4) & 1, rn = hw1 & 15, rd = (hw2 >>> 8) & 15, rm = hw2 & 15;
  const imm5 = (((hw2 >>> 12) & 7) << 2) | ((hw2 >>> 6) & 3), type = (hw2 >>> 4) & 3;
  if (opc === 6) {                                    // PKHBT / PKHTB
    if (s || (type & 1)) return udf(4, 'UNDEFINED PKH');
    const r = rec('pkh', type & 2 ? 'PKHTB T1' : 'PKHBT T1', 4);
    r.rd = rd; r.rn = rn; r.rm = rm; [r.sh, r.sa] = immShift(type, imm5);
    r.unp = bad(rd) || bad(rn) || bad(rm) || (hw2 & 0x8000) !== 0;
    return r;
  }
  let alu, name, d = rd, n = rn;
  switch (opc) {
    case 0: if (rd === 15 && s) { alu = ALU_TST; d = -1; } else alu = ALU_AND; break;
    case 1: alu = ALU_BIC; break;
    case 2: if (rn === 15) { alu = ALU_MOV; n = -1; } else alu = ALU_ORR; break;
    case 3: if (rn === 15) { alu = ALU_MVN; n = -1; } else alu = ALU_ORN; break;
    case 4: if (rd === 15 && s) { alu = ALU_TEQ; d = -1; } else alu = ALU_EOR; break;
    case 8: if (rd === 15 && s) { alu = ALU_CMN; d = -1; } else alu = ALU_ADD; break;
    case 10: alu = ALU_ADC; break;
    case 11: alu = ALU_SBC; break;
    case 13: if (rd === 15 && s) { alu = ALU_CMP; d = -1; } else alu = ALU_SUB; break;
    case 14: alu = ALU_RSB; break;
    default: return udf(4, 'UNDEFINED dp shifted');
  }
  const [sh, sa] = immShift(type, imm5);
  if (alu === ALU_MOV) name = sh === 0 && sa === 0 ? 'MOV (register) T3' : sh === 4 ? 'RRX T1' : `${SHIFT_NAMES[sh]} (immediate) T2`;
  else name = `${ALU_NAMES[alu]} (register) ${REG_ENC[alu]}`;
  if ((alu === ALU_ADD || alu === ALU_SUB) && rn === 13) name = alu === ALU_ADD ? 'ADD (SP plus register) T3' : 'SUB (SP minus register) T1';
  const r = dp(name, 4, alu, d, n, s);
  r.rm = rm; r.sh = sh; r.sa = sa;
  r.unp = dpUnp(alu, d, n, rm, s, sh, sa, false) || (hw2 & 0x8000) !== 0;   // bit 15 is (0)
  return r;
}

const REG_ENC = ['T2', 'T2', 'T2', 'T1', 'T2', 'T3', 'T2', 'T3', 'T2', 'T2', 'T2', 'T1', 'T2', 'T1', 'T3', 'T2'];

// the UNPREDICTABLE register choices of the 32-bit data-processing forms (A7.7: each instruction's encoding notes)
function dpUnp(alu, d, n, m, s, sh, sa, imm) {
  const mBad = !imm && bad(m);
  switch (alu) {
    case ALU_TST: case ALU_TEQ: return bad(n) || mBad;
    case ALU_CMP: case ALU_CMN: return n === 15 || mBad;
    case ALU_MOV:
      if (imm) return bad(d);
      if (s) return bad(d) || bad(m);
      return d === 15 || m === 15 || (d === 13 && m === 13) || ((d === 13 || m === 13) && !(sh === 0 && sa === 0));
    case ALU_MVN: return bad(d) || mBad;
    case ALU_ADD: case ALU_SUB:
      if (n === 13) {
        if (imm) return d === 15;
        return d === 15 || mBad || (d === 13 && (sh !== 0 || sa > 3));
      }
      return bad(d) || n === 15 || mBad;
    default: return bad(d) || bad(n) || mBad;
  }
}

function dpModImm(hw1, hw2) {
  const opc = (hw1 >>> 5) & 15, s = (hw1 >>> 4) & 1, rn = hw1 & 15, rd = (hw2 >>> 8) & 15;
  const imm12 = (((hw1 >>> 10) & 1) << 11) | (((hw2 >>> 12) & 7) << 8) | (hw2 & 0xff);
  let alu, d = rd, n = rn;
  switch (opc) {
    case 0: if (rd === 15 && s) { alu = ALU_TST; d = -1; } else alu = ALU_AND; break;
    case 1: alu = ALU_BIC; break;
    case 2: if (rn === 15) { alu = ALU_MOV; n = -1; } else alu = ALU_ORR; break;
    case 3: if (rn === 15) { alu = ALU_MVN; n = -1; } else alu = ALU_ORN; break;
    case 4: if (rd === 15 && s) { alu = ALU_TEQ; d = -1; } else alu = ALU_EOR; break;
    case 8: if (rd === 15 && s) { alu = ALU_CMN; d = -1; } else alu = ALU_ADD; break;
    case 10: alu = ALU_ADC; break;
    case 11: alu = ALU_SBC; break;
    case 13: if (rd === 15 && s) { alu = ALU_CMP; d = -1; } else alu = ALU_SUB; break;
    case 14: alu = ALU_RSB; break;
    default: return udf(4, 'UNDEFINED dp modified immediate');
  }
  const e = expandImm(imm12);
  const t = { [ALU_AND]: 'T1', [ALU_TST]: 'T1', [ALU_BIC]: 'T1', [ALU_ORR]: 'T1', [ALU_MOV]: 'T2', [ALU_ORN]: 'T1', [ALU_MVN]: 'T1',
    [ALU_EOR]: 'T1', [ALU_TEQ]: 'T1', [ALU_ADD]: 'T3', [ALU_CMN]: 'T1', [ALU_ADC]: 'T1', [ALU_SBC]: 'T1', [ALU_SUB]: 'T3', [ALU_CMP]: 'T2', [ALU_RSB]: 'T2' }[alu];
  let name = `${ALU_NAMES[alu]} (immediate) ${t}`;
  if ((alu === ALU_ADD || alu === ALU_SUB) && rn === 13) name = alu === ALU_ADD ? 'ADD (SP plus immediate) T3' : 'SUB (SP minus immediate) T2';
  const r = dp(name, 4, alu, d, n, s);
  r.imm = e.v; r.ic = e.c;
  r.unp = e.unp || dpUnp(alu, d, n, -1, s, 0, 0, true);
  return r;
}

function dpPlainImm(hw1, hw2) {
  const opc = (hw1 >>> 4) & 0x1f, rn = hw1 & 15, rd = (hw2 >>> 8) & 15;
  const i = (hw1 >>> 10) & 1, imm3 = (hw2 >>> 12) & 7, imm8 = hw2 & 0xff, imm2 = (hw2 >>> 6) & 3;
  const imm12 = (i << 11) | (imm3 << 8) | imm8;
  if (hw2 & 0x8000) return udf(4, 'UNDEFINED plain immediate bit 15');
  switch (opc) {
    case 0x00: case 0x0a: {
      const sub = opc === 0x0a;
      if (rn === 15) {
        const r = rec('adr', sub ? 'ADR T2' : 'ADR T3', 4); r.rd = rd; r.rn = 15; r.imm = sub ? -imm12 : imm12; r.alu = ALU_ADD;
        r.unp = bad(rd);
        return r;
      }
      const r = dp(rn === 13 ? (sub ? 'SUB (SP minus immediate) T3' : 'ADD (SP plus immediate) T4') : (sub ? 'SUB (immediate) T4' : 'ADD (immediate) T4'), 4, sub ? ALU_SUB : ALU_ADD, rd, rn, 0);
      r.imm = imm12; r.unp = rn === 13 ? rd === 15 : bad(rd);
      return r;
    }
    case 0x04: case 0x0c: {
      const r = rec(opc === 4 ? 'movw' : 'movt', opc === 4 ? 'MOV (immediate) T3' : 'MOVT T1', 4);
      r.rd = rd; r.imm = ((hw1 & 15) << 12) | imm12; r.unp = bad(rd);
      return r;
    }
    case 0x10: case 0x12: case 0x18: case 0x1a: {     // SSAT / USAT (and the 16-bit forms)
      const u = opc >= 0x18, shf = (opc >>> 1) & 1, amt = (imm3 << 2) | imm2;
      if (shf && amt === 0) {
        const r = rec('sat16', u ? 'USAT16 T1' : 'SSAT16 T1', 4); r.rd = rd; r.rn = rn; r.imm = (hw2 & 15) + (u ? 0 : 1); r.sg = u ? 0 : 1;
        r.unp = bad(rd) || bad(rn) || (hw2 & 0x30) !== 0 || (hw1 & 0x0400) !== 0;
        return r;
      }
      const r = rec('sat', u ? 'USAT T1' : 'SSAT T1', 4); r.rd = rd; r.rn = rn; r.imm = (hw2 & 31) + (u ? 0 : 1); r.sg = u ? 0 : 1;
      r.sh = shf ? 2 : 0; r.sa = amt; r.unp = bad(rd) || bad(rn) || (hw2 & 0x20) !== 0 || (hw1 & 0x0400) !== 0;
      return r;
    }
    case 0x14: case 0x1c: {
      const r = rec('bfx', opc === 0x14 ? 'SBFX T1' : 'UBFX T1', 4); r.rd = rd; r.rn = rn; r.sa = (imm3 << 2) | imm2; r.imm = (hw2 & 31) + 1; r.sg = opc === 0x14 ? 1 : 0;
      r.unp = bad(rd) || bad(rn) || r.sa + r.imm > 32 || (hw2 & 0x20) !== 0 || (hw1 & 0x0400) !== 0;
      return r;
    }
    case 0x16: {
      const r = rec('bfi', rn === 15 ? 'BFC T1' : 'BFI T1', 4); r.rd = rd; r.rn = rn; r.sa = (imm3 << 2) | imm2; r.imm = hw2 & 31;   // imm: msb
      r.unp = bad(rd) || rn === 13 || r.imm < r.sa || (hw2 & 0x20) !== 0 || (hw1 & 0x0400) !== 0;
      return r;
    }
    default: return udf(4, 'UNDEFINED plain immediate');
  }
}

function branchMisc(hw1, hw2) {
  const op = (hw1 >>> 4) & 0x7f, op1 = (hw2 >>> 12) & 7;
  const s = (hw1 >>> 10) & 1, j1 = (hw2 >>> 13) & 1, j2 = (hw2 >>> 11) & 1;
  if ((op1 & 5) === 0) {                              // 0x0
    if ((op & 0x38) !== 0x38) {                       // B T3
      const r = rec('b', 'B T3', 4); r.cond = (hw1 >>> 6) & 15;
      r.imm = sx((s << 20) | (j2 << 19) | (j1 << 18) | ((hw1 & 0x3f) << 12) | ((hw2 & 0x7ff) << 1), 21);
      return r;
    }
    if ((op & 0x7e) === 0x38) {                       // MSR
      const r = rec('msr', 'MSR T1', 4); r.rn = hw1 & 15; r.imm = hw2 & 0xff; r.list = (hw2 >>> 10) & 3;
      r.unp = bad(r.rn) || (hw2 & 0x2300) !== 0 || (hw1 & 0x10) !== 0 || !SYSM.includes(r.imm) ||
        (r.imm < 8 ? r.list === 0 : r.list !== 2);
      return r;
    }
    if (op === 0x3a) {                                // hints
      if (hw2 & 0x0700) return udf(4, 'UNDEFINED hint');
      const r = hint(hw2 & 0xff, 4, 'T2');
      r.unp = (hw1 & 15) !== 15 || (hw2 & 0x2800) !== 0;
      return r;
    }
    if (op === 0x3b) {                                // misc control
      const o = (hw2 >>> 4) & 15;
      const name = { 2: 'CLREX T1', 4: 'DSB T1', 5: 'DMB T1', 6: 'ISB T1' }[o];
      if (!name) return udf(4, 'UNDEFINED misc control');
      const r = rec(o === 2 ? 'clrex' : 'barrier', name, 4);
      r.unp = (hw1 & 15) !== 15 || (hw2 & 0x2f00) !== 0x0f00 || (o === 2 && (hw2 & 15) !== 15);
      return r;
    }
    if ((op & 0x7e) === 0x3e) {                       // MRS
      const r = rec('mrs', 'MRS T1', 4); r.rd = (hw2 >>> 8) & 15; r.imm = hw2 & 0xff;
      r.unp = bad(r.rd) || (hw1 & 0x1f) !== 0x0f || (hw2 & 0x2000) !== 0 || !SYSM.includes(r.imm);
      return r;
    }
    return udf(4, 'UNDEFINED branch / misc');
  }
  if (op1 === 2) return op === 0x7f ? udf(4, 'UDF T2') : udf(4, 'UNDEFINED 0xf7xx a');
  const i1 = (~(j1 ^ s)) & 1, i2 = (~(j2 ^ s)) & 1;
  const imm = sx((s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7ff) << 1), 25);
  if ((op1 & 5) === 1) { const r = rec('b', 'B T4', 4); r.imm = imm; return r; }
  if ((op1 & 5) === 5) { const r = rec('bl', 'BL T1', 4); r.imm = imm; return r; }
  return udf(4, 'BLX (immediate)');                   // op1 = 1x0: no ARM state on the M profile
}

// the T3 / T4 / T forms' PUW byte: [enc suffix, add, idx, wb, t, undefined]
function puw(hw2) {
  const p = (hw2 >>> 10) & 1, u = (hw2 >>> 9) & 1, w = (hw2 >>> 8) & 1;
  if ((hw2 & 0x0f00) === 0x0e00) return { t: 1, add: 1, idx: 1, wb: 0, undef: false };
  return { t: 0, add: u, idx: p, wb: w, undef: p === 0 && w === 0 };
}

function storeSingle(hw1, hw2) {
  const op1 = (hw1 >>> 5) & 7, rn = hw1 & 15, rt = hw2 >>> 12;
  const sz = [1, 2, 4][op1 & 3], name = ['STRB', 'STRH', 'STR'][op1 & 3];
  if ((op1 & 3) === 3 || op1 > 6) return udf(4, 'UNDEFINED store');
  if (rn === 15) return udf(4, 'UNDEFINED store to pc-relative');
  const r = rec('str', '', 4); r.sz = sz; r.rn = rn; r.rd = rt;
  if (op1 & 4) {                                      // imm12
    r.enc = `${name} (immediate) ${sz === 4 ? 'T3' : 'T2'}`; r.imm = hw2 & 0xfff;
    r.unp = sz === 4 ? rt === 15 : bad(rt);
    return r;
  }
  if (hw2 & 0x0800) {
    const x = puw(hw2);
    if (x.undef) return udf(4, 'UNDEFINED store P=0 W=0');
    r.enc = x.t ? `${name}T T1` : `${name} (immediate) ${sz === 4 ? 'T4' : 'T3'}`;
    if (sz === 4 && rn === 13 && x.idx && !x.add && x.wb && (hw2 & 0xff) === 4 && !x.t) r.enc = 'PUSH T3';
    r.imm = hw2 & 0xff; r.add = x.add; r.idx = x.idx; r.wb = x.wb; r.t = x.t;
    r.unp = (sz === 4 ? rt === 15 : bad(rt)) || (x.wb && rn === rt);
    return r;
  }
  if ((hw2 & 0x0fc0) !== 0) return udf(4, 'UNDEFINED store register');
  r.enc = `${name} (register) T2`; r.rm = hw2 & 15; r.sh = 0; r.sa = (hw2 >>> 4) & 3;
  r.unp = (sz === 4 ? rt === 15 : bad(rt)) || bad(r.rm);
  return r;
}

// LDRB / LDRSB / LDRH / LDRSH and the preload hints in their space (sz 1 or 2)
function loadNarrow(hw1, hw2, sz) {
  const sg = (hw1 >>> 8) & 1, u12 = (hw1 >>> 7) & 1, rn = hw1 & 15, rt = hw2 >>> 12;
  const name = (sg ? 'LDRS' : 'LDR') + (sz === 1 ? 'B' : 'H');
  const hintName = sz === 1 ? (sg ? 'PLI' : 'PLD') : 'NOP (unallocated hint)';
  const r = rec('ldr', '', 4); r.sz = sz; r.sg = sg; r.rn = rn; r.rd = rt;
  if (rn === 15) {
    if (rt === 15) { const h = rec('pld', `${hintName} (literal)`, 4); return h; }
    r.enc = `${name} (literal) T1`; r.imm = hw2 & 0xfff; r.add = u12;
    r.unp = rt === 13;
    return r;
  }
  if (u12) {
    if (rt === 15) { const h = rec('pld', `${hintName} (immediate) T1`, 4); return h; }
    r.enc = `${name} (immediate) ${sg ? 'T1' : 'T2'}`; r.imm = hw2 & 0xfff;
    r.unp = rt === 13;
    return r;
  }
  if (hw2 & 0x0800) {
    const x = puw(hw2);
    if (rt === 15) {
      if (x.idx && !x.add && !x.wb && !x.t) return rec('pld', `${hintName} (immediate) T2`, 4);
      const h = rec('pld', `${name} to pc (UNPREDICTABLE)`, 4); h.unp = true; return h;
    }
    if (x.undef) return udf(4, 'UNDEFINED load P=0 W=0');
    r.enc = x.t ? `${name}T T1` : `${name} (immediate) ${sg ? 'T2' : 'T3'}`;
    r.imm = hw2 & 0xff; r.add = x.add; r.idx = x.idx; r.wb = x.wb; r.t = x.t;
    r.unp = rt === 13 || (x.wb && rn === rt);
    return r;
  }
  if ((hw2 & 0x0fc0) !== 0) return udf(4, 'UNDEFINED load register');
  if (rt === 15) { const h = rec('pld', `${hintName} (register) T1`, 4); h.unp = bad(hw2 & 15); return h; }
  r.enc = `${name} (register) ${sg ? 'T2' : 'T2'}`; r.rm = hw2 & 15; r.sa = (hw2 >>> 4) & 3;
  r.unp = rt === 13 || bad(r.rm);
  return r;
}

function loadWord(hw1, hw2) {
  const op1 = (hw1 >>> 7) & 3, rn = hw1 & 15, rt = hw2 >>> 12;
  if (op1 >= 2) return udf(4, 'UNDEFINED load word');
  const r = rec('ldr', '', 4); r.sz = 4; r.rn = rn; r.rd = rt;
  if (rn === 15) { r.enc = 'LDR (literal) T2'; r.imm = hw2 & 0xfff; r.add = op1; return r; }
  if (op1 === 1) { r.enc = 'LDR (immediate) T3'; r.imm = hw2 & 0xfff; return r; }
  if (hw2 & 0x0800) {
    const x = puw(hw2);
    if (x.undef) return udf(4, 'UNDEFINED load word P=0 W=0');
    r.enc = x.t ? 'LDRT T1' : 'LDR (immediate) T4';
    if (rn === 13 && !x.idx && x.add && x.wb && (hw2 & 0xff) === 4 && !x.t) r.enc = 'POP T3';
    r.imm = hw2 & 0xff; r.add = x.add; r.idx = x.idx; r.wb = x.wb; r.t = x.t;
    r.unp = (x.wb && rn === rt) || (x.t && bad(rt));
    return r;
  }
  if ((hw2 & 0x0fc0) !== 0) return udf(4, 'UNDEFINED load word register');
  r.enc = 'LDR (register) T2'; r.rm = hw2 & 15; r.sa = (hw2 >>> 4) & 3;
  r.unp = bad(r.rm);
  return r;
}

function dpReg(hw1, hw2) {
  const op1 = (hw1 >>> 4) & 15, op2 = (hw2 >>> 4) & 15, rn = hw1 & 15, rd = (hw2 >>> 8) & 15, rm = hw2 & 15;
  if ((hw2 & 0xf000) !== 0xf000) return udf(4, 'UNDEFINED dp register');
  if (op1 < 8 && op2 === 0 && (hw2 & 0xf0) === 0) {     // LSL / LSR / ASR / ROR (register) T2
    const t = op1 >>> 1;
    const r = dp(`${SHIFT_NAMES[t]} (register) T2`, 4, ALU_MOV, rd, -1, op1 & 1);
    r.rm = rn; r.ra = rm; r.sh = t; r.sa = -1; r.unp = bad(rd) || bad(rn) || bad(rm);
    return r;
  }
  if (op1 < 8 && (op2 & 8)) {                         // extends
    if (op1 > 5) return udf(4, 'UNDEFINED extend');
    const names = ['SXTAH', 'UXTAH', 'SXTAB16', 'UXTAB16', 'SXTAB', 'UXTAB'];
    const base = names[op1];
    const r = rec(op1 === 2 || op1 === 3 ? 'ext16' : 'ext', rn === 15 ? `${base.replace('A', '')} T${op1 === 2 || op1 === 3 ? 1 : 2}` : `${base} T1`, 4);
    r.rd = rd; r.rn = rn === 15 ? -1 : rn; r.rm = rm; r.imm = ((hw2 >>> 4) & 3) * 8;
    r.sz = op1 >= 4 ? 1 : 2; r.sg = (op1 & 1) ? 0 : 1;
    r.unp = bad(rd) || rn === 13 || bad(rm) || (hw2 & 0x40) !== 0;
    return r;
  }
  if (op1 >= 8 && op2 < 8) {                          // parallel addition and subtraction
    const o1 = op1 & 7, o2 = op2 & 3, u = (op2 >>> 2) & 1;
    const kind = { 1: 'ADD16', 2: 'ASX', 6: 'SAX', 5: 'SUB16', 0: 'ADD8', 4: 'SUB8' }[o1];
    if (!kind || o2 === 3) return udf(4, 'UNDEFINED parallel');
    const pre = u ? ['U', 'UQ', 'UH'][o2] : ['S', 'Q', 'SH'][o2];
    const r = rec('par', `${pre}${kind} T1`, 4); r.rd = rd; r.rn = rn; r.rm = rm; r.sg = u ? 0 : 1; r.sh = o2; r.alu = o1;
    r.unp = bad(rd) || bad(rn) || bad(rm);
    return r;
  }
  if ((op1 & 12) === 8 && (op2 & 12) === 8) {         // miscellaneous operations
    const a = op1 & 3, b = op2 & 3;
    let r;
    if (a === 0) { r = rec('qadd', ['QADD T1', 'QDADD T1', 'QSUB T1', 'QDSUB T1'][b], 4); r.sh = b; }
    else if (a === 1) { r = rec(b === 2 ? 'rbit' : 'rev', ['REV T2', 'REV16 T2', 'RBIT T1', 'REVSH T2'][b], 4); r.sh = b; }
    else if (a === 2 && b === 0) r = rec('sel', 'SEL T1', 4);
    else if (a === 3 && b === 0) r = rec('clz', 'CLZ T1', 4);
    else return udf(4, 'UNDEFINED misc operations');
    r.rd = rd; r.rn = rn; r.rm = rm;
    r.unp = bad(rd) || bad(rn) || bad(rm) || ((a === 1 || a === 3) && rn !== rm);
    if (a === 1 || a === 3) r.rn = -1;
    return r;
  }
  return udf(4, 'UNDEFINED dp register op');
}

function mulAcc(hw1, hw2) {
  const op1 = (hw1 >>> 4) & 7, op2 = (hw2 >>> 4) & 3, rn = hw1 & 15, ra = hw2 >>> 12, rd = (hw2 >>> 8) & 15, rm = hw2 & 15;
  if (hw2 & 0xc0) return udf(4, 'UNDEFINED multiply bits 7:6');
  const acc = ra !== 15;
  let r;
  switch (op1) {
    case 0:
      if (op2 === 0) { r = rec(acc ? 'mla' : 'mul', acc ? 'MLA T1' : 'MUL T2', 4); }
      else if (op2 === 1) { r = rec('mls', 'MLS T1', 4); if (!acc) r.unp = true; }
      else return udf(4, 'UNDEFINED multiply');
      break;
    case 1: r = rec('smulxy', `${acc ? 'SMLA' : 'SMUL'}${op2 & 2 ? 'T' : 'B'}${op2 & 1 ? 'T' : 'B'} T1`, 4); r.sh = op2; break;
    case 2: if (op2 & 2) return udf(4, 'UNDEFINED SMUAD'); r = rec('smuad', `${acc ? 'SMLAD' : 'SMUAD'}${op2 & 1 ? 'X' : ''} T1`, 4); r.sh = op2 & 1; r.sg = 0; break;
    case 3: if (op2 & 2) return udf(4, 'UNDEFINED SMULW'); r = rec('smulw', `${acc ? 'SMLAW' : 'SMULW'}${op2 & 1 ? 'T' : 'B'} T1`, 4); r.sh = op2 & 1; break;
    case 4: if (op2 & 2) return udf(4, 'UNDEFINED SMUSD'); r = rec('smuad', `${acc ? 'SMLSD' : 'SMUSD'}${op2 & 1 ? 'X' : ''} T1`, 4); r.sh = op2 & 1; r.sg = 1; break;
    case 5: if (op2 & 2) return udf(4, 'UNDEFINED SMMUL'); r = rec('smmul', `${acc ? 'SMMLA' : 'SMMUL'}${op2 & 1 ? 'R' : ''} T1`, 4); r.sh = op2 & 1; r.sg = 0; break;
    case 6: if (op2 & 2) return udf(4, 'UNDEFINED SMMLS'); r = rec('smmul', `SMMLS${op2 & 1 ? 'R' : ''} T1`, 4); r.sh = op2 & 1; r.sg = 1; if (!acc) r.unp = true; break;
    case 7: if (op2 !== 0) return udf(4, 'UNDEFINED USAD8'); r = rec('usad8', acc ? 'USADA8 T1' : 'USAD8 T1', 4); break;
    default: return udf(4, 'UNDEFINED multiply');
  }
  r.rd = rd; r.rn = rn; r.rm = rm; r.ra = acc ? ra : -1;
  r.unp = r.unp || bad(rd) || bad(rn) || bad(rm) || ra === 13;
  return r;
}

function longMul(hw1, hw2) {
  const op1 = (hw1 >>> 4) & 7, op2 = (hw2 >>> 4) & 15, rn = hw1 & 15, lo = hw2 >>> 12, hi = (hw2 >>> 8) & 15, rm = hw2 & 15;
  let r;
  if ((op1 === 1 || op1 === 3) && op2 === 15) {
    r = rec('div', op1 === 1 ? 'SDIV T1' : 'UDIV T1', 4); r.rd = hi; r.rn = rn; r.rm = rm; r.sg = op1 === 1 ? 1 : 0;
    r.unp = bad(hi) || bad(rn) || bad(rm) || lo !== 15;
    return r;
  }
  if (op2 === 0 && (op1 === 0 || op1 === 2 || op1 === 4 || op1 === 6)) {
    const name = { 0: 'SMULL', 2: 'UMULL', 4: 'SMLAL', 6: 'UMLAL' }[op1];
    r = rec('mull', `${name} T1`, 4); r.sg = op1 === 0 || op1 === 4 ? 1 : 0; r.alu = op1 >= 4 ? 1 : 0;   // alu: accumulate
  } else if (op1 === 6 && op2 === 6) {
    r = rec('umaal', 'UMAAL T1', 4);
  } else if (op1 === 4 && (op2 & 12) === 8) {
    r = rec('smlalxy', `SMLAL${op2 & 2 ? 'T' : 'B'}${op2 & 1 ? 'T' : 'B'} T1`, 4); r.sh = op2 & 3;
  } else if ((op1 === 4 || op1 === 5) && (op2 & 14) === 12) {
    r = rec('smlald', `${op1 === 4 ? 'SMLALD' : 'SMLSLD'}${op2 & 1 ? 'X' : ''} T1`, 4); r.sh = op2 & 1; r.sg = op1 === 5 ? 1 : 0;
  } else return udf(4, 'UNDEFINED long multiply');
  r.rd = lo; r.ra = hi; r.rn = rn; r.rm = rm;
  r.unp = bad(lo) || bad(hi) || bad(rn) || bad(rm) || lo === hi;
  return r;
}

// Coprocessor space: the FPU's (cp10 / cp11) load / store, register transfer and system register forms; every FP data
// processing form decodes as 'vfp' (executed as Unimplemented: the image has none, docs/om1-scpu-spec.md section 1).
function coproc(hw1, hw2) {
  const cp = (hw2 >>> 8) & 15, op1 = (hw1 >>> 4) & 0x3f, rn = hw1 & 15;
  if ((op1 & 0x3e) === 0 || (op1 & 0x30) === 0x30) return udf(4, 'UNDEFINED coprocessor op1 00000x / 11xxxx');
  if ((cp & 14) !== 10) return rec('nocp', `coprocessor ${cp}`, 4);
  if (hw1 & 0x1000) return udf(4, 'UNDEFINED coprocessor T2 space for cp10 / cp11');
  const dbl = cp === 11;
  if ((op1 & 0x20) === 0) {                           // extension register load / store, 64-bit transfers
    if ((op1 & 0x3e) === 0x00) return udf(4, 'UNDEFINED VFP load / store');
    if ((op1 & 0x3e) === 0x04) {                      // VMOV two core registers <-> two singles / a double
      const r = rec('vmov2', dbl ? 'VMOV (two core registers and a doubleword register) T1' : 'VMOV (two core registers and two single registers) T1', 4);
      r.rd = hw2 >>> 12; r.ra = rn; r.add = (hw1 >>> 4) & 1;    // add: to core
      r.rm = dbl ? 2 * ((((hw2 >>> 5) & 1) << 4) | (hw2 & 15)) : ((hw2 & 15) << 1) | ((hw2 >>> 5) & 1);
      r.unp = bad(r.rd) || bad(r.ra) || (r.add && r.rd === r.ra) || (!dbl && r.rm === 31) || (hw2 & 0xd0) !== 0x10;
      if (dbl && (hw2 & 0x20)) return udf(4, 'UNDEFINED VMOV D16-D31 (single-precision FPU)');
      return r;
    }
    const p = (hw1 >>> 8) & 1, u = (hw1 >>> 7) & 1, w = (hw1 >>> 5) & 1, load = (hw1 >>> 4) & 1;
    const D = (hw1 >>> 6) & 1, vd = hw2 >>> 12, imm8 = hw2 & 0xff;
    if (dbl && D) return udf(4, 'UNDEFINED D16-D31 (single-precision FPU)');   // FPv4-SP: D0..D15 only
    const first = dbl ? 2 * vd : (vd << 1) | D;
    if (p === 1 && w === 0) {                         // VLDR / VSTR
      const r = rec(load ? 'vldr' : 'vstr', `${load ? 'VLDR' : 'VSTR'} ${dbl ? 'T1' : 'T2'}`, 4);
      r.rn = rn; r.rd = first; r.imm = imm8 << 2; r.add = u; r.sz = dbl ? 8 : 4;
      r.unp = !load && rn === 15;
      return r;
    }
    if ((p === u && w === 1) || (p === 0 && u === 0)) return udf(4, 'UNDEFINED VLDM / VSTM');
    const count = dbl ? 2 * (imm8 >>> 1) : imm8;      // in single registers
    let enc = `${load ? 'VLDM' : 'VSTM'} ${dbl ? 'T1' : 'T2'}`;
    if (rn === 13 && w && load && !p && u) enc = `VPOP ${dbl ? 'T1' : 'T2'}`;
    if (rn === 13 && w && !load && p && !u) enc = `VPUSH ${dbl ? 'T1' : 'T2'}`;
    const r = rec(load ? 'vldm' : 'vstm', enc, 4);
    r.rn = rn; r.rd = first; r.list = count; r.add = u; r.wb = w; r.idx = p;
    r.unp = count === 0 || first + count > 32 || (dbl && (imm8 & 1) !== 0) || rn === 15 || (dbl && imm8 > 32);
    return r;
  }
  if (hw2 & 0x10) {                                   // register transfers: VMOV core <-> single, VMRS, VMSR
    const l = (hw1 >>> 4) & 1, opc1 = (hw1 >>> 5) & 7, rt = hw2 >>> 12;
    if (!dbl && opc1 === 0) {
      const r = rec('vmov1', 'VMOV (between ARM core register and single-precision register) T1', 4);
      r.rd = rt; r.rm = ((hw1 & 15) << 1) | ((hw2 >>> 7) & 1); r.add = l;
      r.unp = bad(rt) || (hw2 & 0x7f) !== 0x10;
      return r;
    }
    if (!dbl && opc1 === 7 && (hw1 & 15) === 1) {
      const r = rec(l ? 'vmrs' : 'vmsr', l ? 'VMRS T1' : 'VMSR T1', 4); r.rd = rt;
      r.unp = (!l && bad(rt)) || (l && rt === 13) || (hw2 & 0xff) !== 0x10;
      return r;
    }
    if (!dbl && opc1 === 7) {                         // other system registers: FPEXC etc. are not on the M profile
      return rec('vfp', `${l ? 'VMRS' : 'VMSR'} (other register)`, 4);
    }
    return rec('vfp', 'VMOV (scalar)', 4);
  }
  return rec('vfp', 'VFP data processing', 4);
}

function popcount(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
export { popcount };

// decode(hw1, hw2): hw2 is read only for a 32-bit form
export function decode(hw1, hw2) {
  hw1 &= 0xffff;
  const r = (hw1 >>> 11) >= 0x1d ? decode32(hw1, hw2 & 0xffff) : decode16(hw1);
  r.unp = !!r.unp;
  return r;
}
