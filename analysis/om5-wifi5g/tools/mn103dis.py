#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A minimal MN10300 (AM30/31/32 base) disassembler for the E144 wifi study.

Implements the complete base opcode map of docs/mn10300-isa-spec.md section 3
(one-byte space, prefixes F0-F4, F8, FA, FC, FE, and the UDF forms of 3.6).
Undefined encodings decode as `??` of length 1 (never silently mis-decoded).
AM33-only forms (F7, F0 2x/3x, F1 Fx ...) are marked `am33/undef`.

Annotations:
  * branch/jump/call targets -> absolute code VMA (0x50000000 + body offset);
  * imm32/abs32 pointers inside the data window (0x60021020 + body offset)
    -> `; -> 0x60xxxxxx` plus a quoted ASCII string when the target bytes are
       printable (which is how firmware log strings are referenced);
  * known immediate constants (Wi-Fi parameter ids) annotated in decimal.
"""

D = ("d0", "d1", "d2", "d3")
A = ("a0", "a1", "a2", "a3")

CC = ("lt", "gt", "ge", "le", "cs", "hi", "cc", "ls", "eq", "ne")

# parameter ids seen in the E143 wifi path, for annotation
NAMED_CONSTS = {
    60577: "PRM_WIFI_CHANNEL(60577)",
    625: "param625",
    497: "param497",
    13: "13",
    35: "35",
    36: "36",
}

CODE_BASE = 0x50000000
DATA_BASE = 0x60021020


def sx8(v):
    return v - 0x100 if v & 0x80 else v


def sx16(v):
    return v - 0x10000 if v & 0x8000 else v


def sx32(v):
    return v - 0x100000000 if v & 0x80000000 else v


def reglist(mask):
    """MOVM/CALL/RET register mask -> list. Bit order: d0,d1,a0,a1,d2,d3,a2,a3
    (the push order of the manual's save sequence, docs/mn10300-isa-spec.md 4.10)."""
    names = ("d0", "d1", "a0", "a1", "d2", "d3", "a2", "a3")
    return "[" + ",".join(names[i] for i in range(8) if mask & (1 << i)) + "]"


class Dis:
    """img: run-time image bytes; annotators may be None."""

    def __init__(self, img, code_base=CODE_BASE, data_base=DATA_BASE, strings=None):
        self.img = img
        self.code_base = code_base
        self.data_base = data_base
        self.strings = strings or {}   # body offset -> str

    # ---- helpers -------------------------------------------------------
    def b(self, o):
        return self.img[o] if 0 <= o < len(self.img) else 0

    def u16(self, o):
        return self.b(o) | (self.b(o + 1) << 8)

    def u32(self, o):
        return self.u16(o) | (self.u16(o + 2) << 16)

    def data_note(self, v):
        """Comment for an absolute value that points into the data window."""
        off = v - self.data_base
        if 0 <= off < len(self.img):
            note = "; -> 0x%08x (data off 0x%x)" % (v, off)
            s = self.strings.get(off)
            if s:
                q = s[:64].replace("\\", "\\\\").replace('"', '\\"')
                note += ' "%s"' % q
            return note
        if self.code_base <= v < self.code_base + len(self.img):
            return "; -> code 0x%08x" % v
        return ""

    def const_note(self, v):
        if v in NAMED_CONSTS:
            return "; %s" % NAMED_CONSTS[v]
        return ""

    # ---- the decoder ---------------------------------------------------
    def decode(self, off):
        """Return (length, mnemonic-with-operands, comment)."""
        img = self.img
        op = self.b(off)

        # ----- one-byte space, 0x00-0xCF -------------------------------
        if op < 0x10:
            m = (op >> 2) & 3
            q = op & 3
            if q == 0:
                return 1, "clr %s" % D[m], ""
            names = {1: ("mov", 4), 2: ("movbu", 1), 3: ("movhu", 2)}
            name, _sz = names[q]
            abs16 = self.u16(off + 1)
            return 3, "%s %s,(0x%04x)" % (name, D[m], abs16), self.data_note(abs16)

        if op < 0x20:
            n = op & 3
            name = ("extb", "extbu", "exth", "exthu")[op >> 4]
            return 1, "%s %s" % (name, D[n]), ""

        if op < 0x40:
            n = op & 3             # destination register, bits 1-0
            q = (op >> 2) & 3      # sub-form, bits 3-2
            if op < 0x30:
                if q == 0:   # 0x20-0x23 ADD imm8,An (sx)
                    return 2, "add %d,%s" % (sx8(self.b(off + 1)), A[n]), ""
                if q == 1:   # 0x24-0x27 MOV imm16,An (zx)
                    imm = self.u16(off + 1)
                    return 3, "mov 0x%04x,%s" % (imm, A[n]), self.const_note(imm)
                if q == 2:   # 0x28-0x2B ADD imm8,Dn (sx)
                    return 2, "add %d,%s" % (sx8(self.b(off + 1)), D[n]), ""
                # q == 3: 0x2C-0x2F MOV imm16,Dn (sx)
                imm = self.u16(off + 1)
                return 3, "mov 0x%04x,%s" % (imm, D[n]), self.const_note(imm)
            if q == 0:   # 0x30-0x33 MOV (abs16),Dn
                abs16 = self.u16(off + 1)
                return 3, "mov (0x%04x),%s" % (abs16, D[n]), self.data_note(abs16)
            if q == 1:   # 0x34-0x37 MOVBU (abs16),Dn
                abs16 = self.u16(off + 1)
                return 3, "movbu (0x%04x),%s" % (abs16, D[n]), self.data_note(abs16)
            if q == 2:   # 0x38-0x3B MOVHU (abs16),Dn
                abs16 = self.u16(off + 1)
                return 3, "movhu (0x%04x),%s" % (abs16, D[n]), self.data_note(abs16)
            # q == 3: 0x3C-0x3F MOV SP,An
            return 1, "mov sp,%s" % A[n], ""

        if op < 0x50:
            m = (op >> 2) & 3          # register in bits 3-2 (src position)
            q = op & 3                 # form in bits 1-0
            if q == 0:   # INC Dm
                return 1, "inc %s" % D[m], ""
            if q == 1:   # INC Am
                return 1, "inc %s" % A[m], ""
            if q == 2:   # MOV Dm,(d8,SP)  (d8 zx)
                return 2, "mov %s,(%u,sp)" % (D[m], self.b(off + 1)), ""
            # q == 3: MOV Am,(d8,SP)
            return 2, "mov %s,(%u,sp)" % (A[m], self.b(off + 1)), ""

        if op < 0x60:
            n = op & 3                 # destination in bits 1-0
            q = op & 3
            if q == 0:   # INC4 An
                return 1, "inc4 %s" % A[n], ""
            if q == 1:   # ASL2 Dn
                return 1, "asl2 %s" % D[n], ""
            if q == 2:   # MOV (d8,SP),Dn (d8 zx)
                return 2, "mov (%u,sp),%s" % (self.b(off + 1), D[n]), ""
            # q == 3: MOV (d8,SP),An
            return 2, "mov (%u,sp),%s" % (self.b(off + 1), A[n]), ""

        if op < 0x70:   # MOV Dm,(An): src bits 3-2, base bits 1-0
            m = (op >> 2) & 3
            n = op & 3
            return 1, "mov %s,(%s)" % (D[m], A[n]), ""

        if op < 0x80:   # MOV (Am),Dn: base bits 1-0, dest bits 3-2
            n = (op >> 2) & 3
            m = op & 3
            return 1, "mov (%s),%s" % (A[m], D[n]), ""

        if op < 0xC0:
            m = (op >> 2) & 3   # source
            n = op & 3          # destination
            fam = op >> 4   # 8 mov D, 9 mov A, a cmp D, b cmp A
            if m == n:
                if fam == 8:
                    return 2, "mov %d,%s" % (sx8(self.b(off + 1)), D[n]), ""
                if fam == 9:
                    return 2, "mov 0x%02x,%s" % (self.b(off + 1), A[n]), ""
                if fam == 0xa:
                    return 2, "cmp %d,%s" % (sx8(self.b(off + 1)), D[n]), ""
                return 2, "cmp 0x%02x,%s" % (self.b(off + 1), A[n]), ""
            if fam == 8:
                return 1, "mov %s,%s" % (D[m], D[n]), ""
            if fam == 9:
                return 1, "mov %s,%s" % (A[m], A[n]), ""
            if fam == 0xa:
                return 1, "cmp %s,%s" % (D[m], D[n]), ""
            return 1, "cmp %s,%s" % (A[m], A[n]), ""

        if op < 0xCB:   # Bcc d8 / BRA d8
            d8 = sx8(self.b(off + 1))
            if op == 0xCA:
                tgt = off + d8
                return 2, "bra 0x%08x" % (self.code_base + tgt), ""
            cc = CC[op - 0xC0]
            tgt = off + d8
            return 2, "b%s 0x%08x" % (cc, self.code_base + tgt), ""

        if op == 0xCB:
            return 1, "nop", ""
        if op == 0xCC:
            d16 = sx16(self.u16(off + 1))
            return 3, "jmp 0x%08x" % (self.code_base + off + d16), ""
        if op == 0xCD:
            d16 = sx16(self.u16(off + 1))
            regs = self.b(off + 3)
            imm8 = self.b(off + 4)
            return 5, "call 0x%08x,%s,%u" % (self.code_base + off + d16, reglist(regs), imm8), ""
        if op == 0xCE:
            return 2, "movm %s,(sp)" % reglist(self.b(off + 1)), ""
        if op == 0xCF:
            return 2, "movm (sp),%s" % reglist(self.b(off + 1)), ""

        if op < 0xDA:   # Lcc
            cc = CC[op - 0xD0]
            return 1, "l%s" % cc, ""
        if op == 0xDA:
            return 1, "lra", ""
        if op == 0xDB:
            return 1, "setlb", ""
        if op == 0xDC:
            d32 = sx32(self.u32(off + 1))
            return 5, "jmp 0x%08x" % (self.code_base + off + d32), ""
        if op == 0xDD:
            d32 = sx32(self.u32(off + 1))
            regs = self.b(off + 5)
            imm8 = self.b(off + 6)
            return 7, "call 0x%08x,%s,%u" % (self.code_base + off + d32, reglist(regs), imm8), ""
        if op == 0xDE:
            return 3, "retf %s,%u" % (reglist(self.b(off + 1)), self.b(off + 2)), ""
        if op == 0xDF:
            return 3, "ret %s,%u" % (reglist(self.b(off + 1)), self.b(off + 2)), ""

        if op < 0xF0:   # ADD Dm,Dn: src bits 3-2, dst bits 1-0
            m = (op >> 2) & 3
            n = op & 3
            return 1, "add %s,%s" % (D[m], D[n]), ""

        # ----- prefix space F0-FE ---------------------------------------
        if op == 0xF7:
            return 1, "?? (am33 f7)", ""
        if op == 0xFF:
            return 1, "?? (break)", ""

        p = self.b(off + 1)

        if op == 0xF0:
            if p < 0x20:
                m = (p >> 2) & 3
                n = p & 3
                if p < 0x10:
                    return 2, "mov (%s),%s" % (A[n], A[m]), ""
                return 2, "mov %s,(%s)" % (A[m], A[n]), ""
            if p < 0x80:
                m = (p >> 2) & 3
                n = p & 3
                q = p >> 4
                if q == 4:
                    return 2, "movbu (%s),%s" % (A[n], D[m]), ""
                if q == 5:
                    return 2, "movbu %s,(%s)" % (D[m], A[n]), ""
                if q == 6:
                    return 2, "movhu (%s),%s" % (A[n], D[m]), ""
                return 2, "movhu %s,(%s)" % (D[m], A[n]), ""
            if p < 0xA0:
                m = (p >> 2) & 3
                n = p & 3
                return 2, "%s %s,(%s)" % ("bset" if p < 0x90 else "bclr", D[m], A[n]), ""
            if 0xA0 <= p < 0xF0:
                return 2, "?? (am33/undef f0 %02x)" % p, ""
            if p <= 0xF3:
                return 2, "calls %s" % A[p & 3], ""
            if p <= 0xF7:
                return 2, "jmp (%s)" % A[p & 3], ""
            if p == 0xFC:
                return 2, "rets", ""
            if p == 0xFD:
                return 2, "rti", ""
            if p == 0xFE:
                return 2, "trap", ""
            return 2, "?? (undef f0 ff)", ""

        if op == 0xF1:
            m = (p >> 2) & 3
            n = p & 3
            q = p >> 4
            table = {
                0: ("sub", "D", "D"), 1: ("sub", "A", "D"), 2: ("sub", "D", "A"), 3: ("sub", "A", "A"),
                4: ("addc", "D", "D"), 5: ("add", "A", "D"), 6: ("add", "D", "A"), 7: ("add", "A", "A"),
                8: ("subc", "D", "D"), 9: ("cmp", "A", "D"), 0xA: ("cmp", "D", "A"),
                0xD: ("mov", "A", "D"), 0xE: ("mov", "D", "A"),
            }
            if q in table:
                name, srcc, dstc = table[q]
                src = (D if srcc == "D" else A)[m]
                dst = (D if dstc == "D" else A)[n]
                return 2, "%s %s,%s" % (name, src, dst), ""
            return 2, "?? (undef/am33 f1 %02x)" % p, ""

        if op == 0xF2:
            q = p >> 4
            m = (p >> 2) & 3
            n = p & 3
            if q in (0, 1, 2) and p < 0x30:
                return 2, "%s %s,%s" % (("and", "or", "xor")[q], D[m], D[n]), ""
            if 0x30 <= p <= 0x33:
                return 2, "not %s" % D[p & 3], ""
            if q == 4:
                return 2, "mul %s,%s" % (D[m], D[n]), ""
            if q == 5:
                return 2, "mulu %s,%s" % (D[m], D[n]), ""
            if q == 6:
                return 2, "div %s,%s" % (D[m], D[n]), ""
            if q == 7:
                return 2, "divu %s,%s" % (D[m], D[n]), ""
            if 0x80 <= p <= 0x83:
                return 2, "rol %s" % D[p & 3], ""
            if 0x84 <= p <= 0x87:
                return 2, "ror %s" % D[p & 3], ""
            if q == 9:
                return 2, "asl %s,%s" % (D[m], D[n]), ""
            if q == 0xA:
                return 2, "lsr %s,%s" % (D[m], D[n]), ""
            if q == 0xB:
                return 2, "asr %s,%s" % (D[m], D[n]), ""
            if 0xD0 <= p <= 0xD3:
                return 2, "ext %s" % D[p & 3], ""
            if 0xE0 <= p <= 0xE3:
                return 2, "mov mdr,%s" % D[p & 3], ""
            if 0xE4 <= p <= 0xE7:
                return 2, "mov psw,%s" % D[p & 3], ""
            if p in (0xF0, 0xF4, 0xF8, 0xFC):
                return 2, "mov %s,sp" % A[(p >> 2) & 3], ""
            if p in (0xF2, 0xF6, 0xFA, 0xFE):
                return 2, "mov %s,mdr" % D[(p >> 2) & 3], ""
            if p in (0xF3, 0xF7, 0xFB, 0xFF):
                return 2, "mov %s,psw" % D[(p >> 2) & 3], ""
            return 2, "?? (undef/am33 f2 %02x)" % p, ""

        if op in (0xF3, 0xF4):
            i = (p >> 2) & 3
            a = p & 3
            r = (p >> 4) & 3
            if op == 0xF3:
                if p < 0x40:
                    return 2, "mov (%s,%s),%s" % (D[i], A[a], D[r]), ""
                if p < 0x80:
                    return 2, "mov %s,(%s,%s)" % (D[r], D[i], A[a]), ""
                if p < 0xC0:
                    return 2, "mov (%s,%s),%s" % (D[i], A[a], A[r]), ""
                return 2, "mov %s,(%s,%s)" % (A[r], D[i], A[a]), ""
            if p < 0x40:
                return 2, "movbu (%s,%s),%s" % (D[i], A[a], D[r]), ""
            if p < 0x80:
                return 2, "movbu %s,(%s,%s)" % (D[r], D[i], A[a]), ""
            if p < 0xC0:
                return 2, "movhu (%s,%s),%s" % (D[i], A[a], D[r]), ""
            return 2, "movhu %s,(%s,%s)" % (D[r], D[i], A[a]), ""

        if op in (0xF5, 0xF6):
            n = (p >> 2) & 3
            m = p & 3
            nn = (p >> 4) + (20 if op == 0xF5 else 0)
            return 2, "udf%02d %s,%s" % (nn, D[m], D[n]), ""

        if op == 0xF8:
            q = p >> 4
            n = (p >> 2) & 3
            m = p & 3
            d8 = self.b(off + 2)
            if q <= 7:
                base = A[n]
                load = q in (0, 2, 4, 6)
                nm = ("mov", "mov", "mov", "mov", "movbu", "movbu", "movhu", "movhu")[q]
                if load:
                    reg = A[m] if q == 2 else D[m]
                    return 3, "%s (%d,%s),%s" % (nm, sx8(d8), base, reg), ""
                reg = A[m] if q in (3, 7) else D[m]
                return 3, "%s %s,(%d,%s)" % (nm, reg, sx8(d8), base), ""
            if p in (0x92, 0x96, 0x9A, 0x9E):
                return 3, "movbu %s,(%u,sp)" % (D[m], d8), ""
            if p in (0x93, 0x97, 0x9B, 0x9F):
                return 3, "movhu %s,(%u,sp)" % (D[m], d8), ""
            if 0xB8 <= p <= 0xBB:
                return 3, "movbu (%u,sp),%s" % (d8, D[p & 3]), ""
            if 0xBC <= p <= 0xBF:
                return 3, "movhu (%u,sp),%s" % (d8, D[p & 3]), ""
            if 0xC0 <= p <= 0xC3:
                return 3, "asl %u,%s" % (d8, D[p & 3]), ""
            if 0xC4 <= p <= 0xC7:
                return 3, "lsr %u,%s" % (d8, D[p & 3]), ""
            if 0xC8 <= p <= 0xCB:
                return 3, "asr %u,%s" % (d8, D[p & 3]), ""
            if 0xE0 <= p <= 0xE3:
                return 3, "and 0x%02x,%s" % (d8, D[p & 3]), ""
            if 0xE4 <= p <= 0xE7:
                return 3, "or 0x%02x,%s" % (d8, D[p & 3]), ""
            if p in (0xE8, 0xE9, 0xEA, 0xEB):
                cc = {0xE8: "vc", 0xE9: "vs", 0xEA: "nc", 0xEB: "ns"}[p]
                return 3, "b%s 0x%08x" % (cc, self.code_base + off + sx8(d8)), ""
            if 0xEC <= p <= 0xEF:
                return 3, "btst 0x%02x,%s" % (d8, D[p & 3]), ""
            if 0xF0 <= p <= 0xF3:
                return 3, "mov (%d,%s),sp" % (sx8(d8), A[p & 3]), ""
            if 0xF4 <= p <= 0xF7:
                return 3, "mov sp,(%d,%s)" % (sx8(d8), A[p & 3]), ""
            if p == 0xFE:
                return 3, "add %d,sp" % sx8(d8), ""
            return 3, "?? (undef f8 %02x)" % p, ""

        if op == 0xF9:
            return self._udf_imm(op, p, off, self.b(off + 2))

        if op == 0xFA:
            return self._fa(p, off)
        if op == 0xFB:
            return self._udf_imm(op, p, off, self.u16(off + 2))
        if op == 0xFC:
            return self._fc(p, off)
        if op == 0xFD:
            return self._udf_imm(op, p, off, self.u32(off + 2))
        if op == 0xFE:
            if p in (0x00, 0x01, 0x02):
                abs32 = self.u32(off + 2)
                imm8 = self.b(off + 6)
                nm = ("bset", "bclr", "btst")[p]
                return 7, "%s 0x%02x,(0x%08x)" % (nm, imm8, abs32), self.data_note(abs32)
            if p in (0x80, 0x81, 0x82):
                abs16 = self.u16(off + 2)
                imm8 = self.b(off + 4)
                nm = ("bset", "bclr", "btst")[p - 0x80]
                return 5, "%s 0x%02x,(0x%04x)" % (nm, imm8, abs16), self.data_note(abs16)
            return 2, "?? (undef fe %02x)" % p, ""

        return 1, "?? (op %02x)" % op, ""

    # ---- prefix FA -------------------------------------------------------
    def _fa(self, p, off):
        d16v = self.u16(off + 2)
        q = p >> 4
        n = (p >> 2) & 3
        m = p & 3
        if q <= 7:
            forms = {
                0: "mov (%d,%s),%s", 1: "mov %s,(%d,%s)",
                2: "mov (%d,%s),%s", 3: "mov %s,(%d,%s)",
                4: "movbu (%d,%s),%s", 5: "movbu %s,(%d,%s)",
                6: "movhu (%d,%s),%s", 7: "movhu %s,(%d,%s)",
            }[q]
            base = A[n]
            load = q in (0, 2, 4, 6)
            if load:
                reg = A[m] if q == 2 else D[m]
                return 4, forms % (sx16(d16v), base, reg), ""
            reg = A[m] if q in (3, 7) else D[m]
            return 4, forms % (reg, sx16(d16v), base), ""
        if p in (0x80, 0x84, 0x88, 0x8C):
            return 4, "mov %s,(0x%04x)" % (A[(p >> 2) & 3], d16v), ""
        if 0x90 <= p <= 0x9F:
            kind = p & 3
            r = (p >> 2) & 3
            reg = A[r] if kind == 0 else D[r]
            nm = ("mov", "mov", "movbu", "movhu")[kind]
            return 4, "%s %s,(%u,sp)" % (nm, reg, d16v), ""
        if 0xA0 <= p <= 0xA3:
            return 4, "mov (0x%04x),%s" % (d16v, A[p & 3]), ""
        if 0xB0 <= p <= 0xB3:
            return 4, "mov (%u,sp),%s" % (d16v, A[p & 3]), ""
        if 0xB4 <= p <= 0xB7:
            return 4, "mov (%u,sp),%s" % (d16v, D[p & 3]), ""
        if 0xB8 <= p <= 0xBB:
            return 4, "movbu (%u,sp),%s" % (d16v, D[p & 3]), ""
        if 0xBC <= p <= 0xBF:
            return 4, "movhu (%u,sp),%s" % (d16v, D[p & 3]), ""
        if 0xC0 <= p <= 0xC3:
            return 4, "add %d,%s" % (sx16(d16v), D[p & 3]), ""
        if 0xC8 <= p <= 0xCB:
            return 4, "cmp %d,%s" % (sx16(d16v), D[p & 3]), ""
        if 0xD0 <= p <= 0xD3:
            return 4, "add %d,%s" % (sx16(d16v), A[p & 3]), ""
        if 0xD8 <= p <= 0xDB:
            return 4, "cmp 0x%04x,%s" % (d16v, A[p & 3]), ""
        if 0xE0 <= p <= 0xE3:
            return 4, "and 0x%04x,%s" % (d16v, D[p & 3]), ""
        if 0xE4 <= p <= 0xE7:
            return 4, "or 0x%04x,%s" % (d16v, D[p & 3]), ""
        if 0xE8 <= p <= 0xEB:
            return 4, "xor 0x%04x,%s" % (d16v, D[p & 3]), ""
        if 0xEC <= p <= 0xEF:
            return 4, "btst 0x%04x,%s" % (d16v, D[p & 3]), ""
        if 0xF0 <= p <= 0xFB:
            d8 = self.b(off + 2)
            imm8 = self.b(off + 3)
            nm = ("bset", "bclr", "btst")[(p - 0xF0) >> 2]
            return 4, "%s 0x%02x,(%d,%s)" % (nm, imm8, sx8(d8), A[p & 3]), ""
        if p == 0xFC:
            return 4, "and 0x%04x,psw" % d16v, ""
        if p == 0xFD:
            return 4, "or 0x%04x,psw" % d16v, ""
        if p == 0xFE:
            return 4, "add %d,sp" % sx16(d16v), ""
        if p == 0xFF:
            d16s = sx16(d16v)
            return 4, "calls 0x%08x" % (self.code_base + off + d16s), ""
        return 4, "?? (undef fa %02x)" % p, ""

    # ---- prefix FC -------------------------------------------------------
    def _fc(self, p, off):
        d32v = self.u32(off + 2)
        q = p >> 4
        n = (p >> 2) & 3
        m = p & 3
        if q <= 7:
            forms = {
                0: "mov (%d,%s),%s", 1: "mov %s,(%d,%s)",
                2: "mov (%d,%s),%s", 3: "mov %s,(%d,%s)",
                4: "movbu (%d,%s),%s", 5: "movbu %s,(%d,%s)",
                6: "movhu (%d,%s),%s", 7: "movhu %s,(%d,%s)",
            }[q]
            base = A[n]
            load = q in (0, 2, 4, 6)
            if load:
                reg = A[m] if q == 2 else D[m]
                return 6, forms % (sx32(d32v), base, reg), ""
            reg = A[m] if q in (3, 7) else D[m]
            return 6, forms % (reg, sx32(d32v), base), ""
        if 0x80 <= p <= 0x8F:
            kind = p & 3
            r = (p >> 2) & 3
            reg = A[r] if kind == 0 else D[r]
            nm = ("mov", "mov", "movbu", "movhu")[kind]
            return 6, "%s %s,(0x%08x)" % (nm, reg, d32v), self.data_note(d32v)
        if 0x90 <= p <= 0x9F:
            kind = p & 3
            r = (p >> 2) & 3
            reg = A[r] if kind == 0 else D[r]
            nm = ("mov", "mov", "movbu", "movhu")[kind]
            return 6, "%s %s,(%d,sp)" % (nm, reg, sx32(d32v)), ""
        if 0xA0 <= p <= 0xA3:
            return 6, "mov (0x%08x),%s" % (d32v, A[p & 3]), self.data_note(d32v)
        if 0xA4 <= p <= 0xA7:
            return 6, "mov (0x%08x),%s" % (d32v, D[p & 3]), self.data_note(d32v)
        if 0xA8 <= p <= 0xAB:
            return 6, "movbu (0x%08x),%s" % (d32v, D[p & 3]), self.data_note(d32v)
        if 0xAC <= p <= 0xAF:
            return 6, "movhu (0x%08x),%s" % (d32v, D[p & 3]), self.data_note(d32v)
        if 0xB0 <= p <= 0xB3:
            return 6, "mov (%d,sp),%s" % (sx32(d32v), A[p & 3]), ""
        if 0xB4 <= p <= 0xB7:
            return 6, "mov (%d,sp),%s" % (sx32(d32v), D[p & 3]), ""
        if 0xB8 <= p <= 0xBB:
            return 6, "movbu (%d,sp),%s" % (sx32(d32v), D[p & 3]), ""
        if 0xBC <= p <= 0xBF:
            return 6, "movhu (%d,sp),%s" % (sx32(d32v), D[p & 3]), ""
        if 0xC0 <= p <= 0xC3:
            return 6, "add 0x%08x,%s" % (d32v, D[p & 3]), self.const_note(d32v)
        if 0xC4 <= p <= 0xC7:
            return 6, "sub 0x%08x,%s" % (d32v, D[p & 3]), ""
        if 0xC8 <= p <= 0xCB:
            return 6, "cmp 0x%08x,%s" % (d32v, D[p & 3]), self.const_note(d32v)
        if 0xCC <= p <= 0xCF:
            return 6, "mov 0x%08x,%s" % (d32v, D[p & 3]), self.data_note(d32v)
        if 0xD0 <= p <= 0xD3:
            return 6, "add 0x%08x,%s" % (d32v, A[p & 3]), self.data_note(d32v)
        if 0xD4 <= p <= 0xD7:
            return 6, "sub 0x%08x,%s" % (d32v, A[p & 3]), ""
        if 0xD8 <= p <= 0xDB:
            return 6, "cmp 0x%08x,%s" % (d32v, A[p & 3]), ""
        if 0xDC <= p <= 0xDF:
            return 6, "mov 0x%08x,%s" % (d32v, A[p & 3]), self.data_note(d32v)
        if 0xE0 <= p <= 0xE3:
            return 6, "and 0x%08x,%s" % (d32v, D[p & 3]), ""
        if 0xE4 <= p <= 0xE7:
            return 6, "or 0x%08x,%s" % (d32v, D[p & 3]), ""
        if 0xE8 <= p <= 0xEB:
            return 6, "xor 0x%08x,%s" % (d32v, D[p & 3]), ""
        if 0xEC <= p <= 0xEF:
            return 6, "btst 0x%08x,%s" % (d32v, D[p & 3]), ""
        if p == 0xFE:
            return 6, "add 0x%08x,sp" % d32v, ""
        if p == 0xFF:
            return 6, "calls 0x%08x" % (self.code_base + off + sx32(d32v)), ""
        return 6, "?? (undef fc %02x)" % p, ""

    # ---- UDF immediate forms (F9 p imm8 / FB p imm16 / FD p imm32) --------
    def _udf_imm(self, opc, p, off, imm):
        sub = p & 0xC0
        nn = (p >> 4) & 15
        n = p & 3
        m = (p >> 2) & 3
        if sub == 0x00:
            # UDFnn sx imm (register pair Dn,Dm per om1-udf-spec; operands Dm,Dn)
            size = {0xF9: 3, 0xFB: 4, 0xFD: 6}[opc]
            return size, "udf%02d 0x%x,d%s,d%s" % (nn, imm, n, m), ""
        if sub == 0x40:
            size = {0xF9: 3, 0xFB: 4, 0xFD: 6}[opc]
            return size, "udfu%02d 0x%x,d%s,d%s" % (nn, imm, n, m), ""
        if sub == 0x80:
            size = {0xF9: 3, 0xFB: 4, 0xFD: 6}[opc]
            return size, "udf2%x 0x%x,d%s,d%s" % (nn & 7, imm, n, m), ""
        size = {0xF9: 3, 0xFB: 4, 0xFD: 6}[opc]
        return size, "udfu2%x 0x%x,d%s,d%s" % (nn & 7, imm, n, m), ""

    # ---- listing ---------------------------------------------------------
    def listing(self, start, end):
        """Disassemble [start, end) linearly; return lines."""
        lines = []
        off = start
        while off < end:
            try:
                length, text, comment = self.decode(off)
            except Exception as e:   # never die on a decode bug
                length, text, comment = 1, "?? (%s)" % e, ""
            raw = self.img[off:off + length]
            vma = self.code_base + off
            line = "  %08x:  %-16s %s" % (vma, raw.hex(" "), text)
            if comment:
                line += "   " + comment
            lines.append(line)
            off += length
        return lines
