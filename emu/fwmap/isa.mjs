// The static view of an MN10300 (AM33 base ISA plus the OM-1 UDF space) instruction that bin/fwmap.mjs's code
// discovery needs: its length (emu's own insnLength, src/core/cpu.mjs), whether the encoding is defined, its
// control-flow kind and target, and the 32-bit / 16-bit operands that can name an address.
//
// Validity follows docs/mn10300-isa-spec.md section 3 (forms the spec marks FAULT are invalid), not emu's step():
// step() faults (opcode) on 1,112 (op, prefix) pairs the spec defines, the forms emu does not implement (most F5 forms,
// F6 from 0x70, the F9 / FB / FD UDF forms but 00-03 and 14-17), and code that uses them is still code (13
// instructions of the E143 map). break (FF), trap (F0 FE) and rtm (F0 FF) count as invalid for discovery: the firmware
// does not reach them. test/test_fwmap.mjs checks the length against emu's step() and the
// control-flow kinds against the interpreter's transfer forms (src/core/interp.mjs transfers()).
import { insnLength } from '../src/core/cpu.mjs';

export const CODE_BASE = 0x50000000;      // disassembly notation: body offset + CODE_BASE (src/fw/xmap.mjs CODE_BASE)

export const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
export const s32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) | 0;
export const s16 = (b, o) => ((b[o] | b[o + 1] << 8) << 16) >> 16;
export const u16 = (b, o) => b[o] | b[o + 1] << 8;
const s8 = (x) => (x << 24) >> 24;
export const prefixed = (op) => op >= 0xf0 && op <= 0xfe && op !== 0xf7;

export const lengthAt = (b, o) => { const op = b[o]; return insnLength(op, prefixed(op) ? b[o + 1] : 0); };

// Whether (op, p) is a defined encoding (p: the second byte, read for the prefix forms F0..FE but F7).
export function valid(op, p) {
  if (op === 0xf7 || op === 0xff) return false;
  switch (op) {
    case 0xf0: {
      const h = p & 0xf0;
      if (h === 0x20 || h === 0x30) return false;
      if (p >= 0xa0 && p <= 0xef) return false;
      if (p >= 0xf8 && p <= 0xfb) return false;
      if (p === 0xfe || p === 0xff) return false;          // trap, rtm
      return true;
    }
    case 0xf1: { const h = p & 0xf0; return !(h === 0xb0 || h === 0xc0 || h === 0xf0); }
    case 0xf2: {
      if (p >= 0x34 && p <= 0x3f) return false;
      if (p >= 0x88 && p <= 0x8f) return false;
      if ((p & 0xf0) === 0xc0) return false;
      if (p >= 0xd4 && p <= 0xdf) return false;
      if (p >= 0xe8 && p <= 0xef) return false;
      if (p >= 0xf0 && (p & 3) === 1) return false;
      return true;
    }
    case 0xf8: {
      const h = p & 0xf0;
      if (h === 0x80 || h === 0xa0) return false;
      if (h === 0x90 && (p & 3) < 2) return false;
      if (p >= 0xb0 && p <= 0xb7) return false;
      if (p >= 0xcc && p <= 0xdf) return false;
      if (p >= 0xf8 && p <= 0xfd) return false;
      if (p === 0xff) return false;
      return true;
    }
    case 0xfa: {
      if ((p & 0xf0) === 0x80 && (p & 3) !== 0) return false;
      if (p >= 0xa4 && p <= 0xaf) return false;
      if ((p >= 0xc4 && p <= 0xc7) || (p >= 0xcc && p <= 0xcf) || (p >= 0xd4 && p <= 0xd7) || (p >= 0xdc && p <= 0xdf)) return false;
      return true;
    }
    case 0xfc: return !(p >= 0xf0 && p <= 0xfd);
    case 0xfe: return p === 0x00 || p === 0x01 || p === 0x02 || p === 0x80 || p === 0x81 || p === 0x82;
    default: return true;
  }
}

// The instruction at body offset o: {len, kind, target (a body offset, may lie outside the image), valid}. kind:
//   'seq'   falls through only
//   'cond'  conditional branch: falls through and may go to target
//   'jmp'   unconditional direct jump to target
//   'call'  direct call (CALL d16/d32, CALLS d16/d32) to target, then falls through
//   'icall' CALLS (An): indirect call, then falls through
//   'ijmp'  JMP (An): indirect jump (reg: n), no fall-through
//   'ret'   RET / RETF / RETS / RTI: no fall-through
//   'loop'  Lcc: conditional loop back (to LAR - 4, not known statically) and fall-through
//   'lra'   LRA: unconditional loop back, no fall-through
//   'stop'  an undefined encoding (no fall-through)
export function decode(b, o) {
  const op = b[o], p = b[o + 1];
  const len = insnLength(op, prefixed(op) ? p : 0);
  if (!valid(op, p)) return { len, kind: 'stop', valid: false };
  const d = (kind, target) => ({ len, kind, target, valid: true });
  if (op >= 0xc0 && op <= 0xc9) return d('cond', o + s8(p));
  if (op === 0xca) return d('jmp', o + s8(p));
  if (op === 0xcc) return d('jmp', o + s16(b, o + 1));
  if (op === 0xdc) return d('jmp', o + s32(b, o + 1));
  if (op === 0xcd) return d('call', o + s16(b, o + 1));
  if (op === 0xdd) return d('call', o + s32(b, o + 1));
  if (op >= 0xd0 && op <= 0xd9) return d('loop');
  if (op === 0xda) return d('lra');
  if (op === 0xde || op === 0xdf) return d('ret');
  if (op === 0xf0) {
    if (p >= 0xf0 && p <= 0xf3) return d('icall');
    if (p >= 0xf4 && p <= 0xf7) return { len, kind: 'ijmp', reg: p & 3, valid: true };
    if (p === 0xfc || p === 0xfd) return d('ret');
  }
  if (op === 0xf8 && p >= 0xe8 && p <= 0xeb) return d('cond', o + s8(b[o + 2]));
  if (op === 0xfa && p === 0xff) return d('call', o + s16(b, o + 2));
  if (op === 0xfc && p === 0xff) return d('call', o + s32(b, o + 2));
  return d('seq');
}

// Operands that may name an address: [] or a list of {v, how}:
//   'abs32'  load / store / bit op on an absolute 32-bit address (FC 8x/Ax, FE 00-02)
//   'imm32a' MOV imm32,An      'imm32d' MOV imm32,Dn     'd32' the displacement of (d32,An)
//   'add32' / 'cmp32' ADD / CMP imm32 (not addresses; named so a caller can drop them)
//   'abs16'  load / store on an absolute 16-bit address (the 0x0000..0xffff system page)
//   'imm16a' / 'imm16d' MOV imm16,An / Dn
export function operands(b, o) {
  const op = b[o], p = b[o + 1];
  if (op === 0xfc) {
    const v = u32(b, o + 2);
    if (p <= 0x7f) return [{ v, how: 'd32' }];
    if ((p & 0xf0) === 0x80 || (p & 0xf0) === 0xa0) return [{ v, how: 'abs32' }];
    if (p >= 0xcc && p <= 0xcf) return [{ v, how: 'imm32d' }];
    if (p >= 0xdc && p <= 0xdf) return [{ v, how: 'imm32a' }];
    if ((p >= 0xd0 && p <= 0xd3) || (p >= 0xc0 && p <= 0xc3)) return [{ v, how: 'add32' }];
    if ((p >= 0xc8 && p <= 0xcb) || (p >= 0xd8 && p <= 0xdb)) return [{ v, how: 'cmp32' }];
    return [];
  }
  if (op === 0xfe && p <= 0x02) return [{ v: u32(b, o + 2), how: 'abs32' }];
  if (op === 0xfe && p >= 0x80 && p <= 0x82) return [{ v: u16(b, o + 2), how: 'abs16' }];
  if ((op <= 0x0f && (op & 3)) || (op >= 0x30 && op <= 0x3b)) return [{ v: u16(b, o + 1), how: 'abs16' }];
  if (op === 0xfa && (((p & 0xf0) === 0x80 && (p & 3) === 0) || (p >= 0xa0 && p <= 0xa3))) return [{ v: u16(b, o + 2), how: 'abs16' }];
  if (op >= 0x24 && op <= 0x27) return [{ v: u16(b, o + 1), how: 'imm16a' }];
  if (op >= 0x2c && op <= 0x2f) return [{ v: s16(b, o + 1) >>> 0, how: 'imm16d' }];
  return [];
}

// A constant load: MOV imm32 / imm16 / imm8 into Dn or An, or CLR Dn: {reg: 'd0'..'a3', v}, else null (the kernel
// calls' id argument in d0).
export function constLoad(b, o) {
  const op = b[o], p = b[o + 1];
  if (op === 0xfc && p >= 0xcc && p <= 0xcf) return { reg: 'd' + (p & 3), v: s32(b, o + 2) };
  if (op === 0xfc && p >= 0xdc && p <= 0xdf) return { reg: 'a' + (p & 3), v: s32(b, o + 2) };
  if (op >= 0x2c && op <= 0x2f) return { reg: 'd' + (op & 3), v: s16(b, o + 1) };
  if (op >= 0x24 && op <= 0x27) return { reg: 'a' + (op & 3), v: u16(b, o + 1) };
  if (op >= 0x80 && op <= 0x8f && ((op >> 2) & 3) === (op & 3)) return { reg: 'd' + (op & 3), v: s8(p) };
  if (op >= 0x90 && op <= 0x9f && ((op >> 2) & 3) === (op & 3)) return { reg: 'a' + (op & 3), v: p };
  if (op <= 0x0c && (op & 3) === 0) return { reg: 'd' + (op >> 2), v: 0 };
  return null;
}
