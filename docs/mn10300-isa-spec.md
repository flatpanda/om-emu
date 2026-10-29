> Status (2026-10): implemented in `emu/src/core/cpu.mjs` (`step()`, the instruction semantics, and
> `insnLength`, the length table), including the section 2.3 undefined-flag poison and the optional
> 2.4 PSW-write delay detector; `emu/src/core/interp.mjs` runs the same semantics (section 10).
> Checked by `emu/checks/check_isa.mjs` (the vectors of `emu/test/fixtures/isa_vectors.json`),
> `emu/checks/check_perf.mjs` and `emu/checks/check_irq.mjs` (section 11). Bugs B1-B4 in section 5
> are fixed. UDF forms are no longer out of scope: see `om1-udf-spec.md`.
>
> The implementation differs from the original text in four places; the body below has been edited
> to match, and each edited line says so:
> 1. Fault codes. A poisoned-flag read (2.3), a flag read inside the PSW-write window (2.4), a divide
>    by zero or quotient overflow (4.6) and a reserved PSW bit (4.11) raise `MN_FAULT_UNDEF` (6), not
>    `MN_FAULT_OPCODE` (1). Code 1 stays reserved for encodings whose semantics are unknown.
> 2. `and/or imm16,PSW` clear in `psw_undef` only the bits the immediate forces (AND: bits where the
>    immediate is 0; OR: bits where it is 1). The original text cleared all of `psw_undef`.
> 3. The 2.4 window also faults `and/or imm16,PSW` (they read PSW). `mov Dm,PSW` inside the window
>    does not fault: it reads no flags.
> 4. Section 9 expectations follow from 1: `f2 61` with d0=0 and `fa fd 10 00` give fault 6.
>
> Status columns. The section 3 opcode map has been relabelled to the implemented state: every row
> that read `MISSING (n)` now reads `OK (n)`, B1-B3 rows read `OK (Bx fixed)` and B4 rows read
> `FAULT (B4 fixed)`; `n` stays the reachable static count of a form that was missing at M1 (the CPU as it stood at
> milestone M1, before the ISA was completed; ROADMAP "Done").
> Sections 5 (bugs), 6 (missing forms ranked) and 7 (length table gaps) describe M1's CPU and are
> kept as the record of what was changed; each now says so in its heading. Section 9 lists checks
> proposed before the implementation; the check_isa vectors now cover every form in it.

# MN10300 base ISA: implementation spec

Sections 0-9 specify the instruction semantics (`cpu.mjs` `step()`); section 10 specifies how the interpreter (`interp.mjs`, PERF) runs them without changing any result and where it looks at interrupts; section 11 (M9) specifies RTI and interrupt acceptance.

Scope: every non-AM33 MN10300 instruction form (Panasonic AM30/AM31/AM32 "MN1030/MN103S"), as needed to
complete the CPU's `step()`. UDF/UDFU semantics are out of scope here; they are in `om1-udf-spec.md`
(originally: they must keep faulting until a separate UDF spec exists). Their encodings and lengths are
listed only so the length table can be complete.

## 0. Sources and precedence

| tag | source | used for |
|---|---|---|
| M | the Panasonic MN103 instruction manual (13250-040E). Ch.1 p.3-22, Ch.2 p.26-100, Ch.3 p.113-115, Appendix instruction set p.160-182, opcode map p.183-190 | authoritative semantics, flags, encodings |
| B | binutils 2.43 `opcodes/m10300-opc.c` (base entries = machine 0 or AM30) | encodings, operand fields |
| S | GDB 15.2's `sim/mn10300` simulator (`sim/mn10300/mn10300.igen`) | secondary only; it models AM33 quirks and invents results for undefined cases |
| F | OM-1 E143 main block: its statically reachable instructions (the reachable set) | usage counts, consistency evidence |

Precedence: M > B for encodings; M > S for semantics. Where M is internally inconsistent the resolution
and its evidence are stated explicitly. Anything still unresolved is listed in section 8 and must FAULT.

Firmware addresses below are disassembly addresses (0x50000000 + file offset).

## 1. Register / PSW model

- D0-D3, A0-A3, SP, PC, MDR, LIR, LAR: 32 bit. PSW: 16 bit.
- PSW layout (M p.5): bit0 Z, bit1 N, bit2 C, bit3 V, bits4-7 reserved "0", bits8-10 IM0-IM2,
  bit11 IE, bits12-13 S0/S1 (OS software bits), bits14-15 reserved "0".
  `PSW_FLAGS=0x000F`, `PSW_DEFINED=0x3F0F`, `PSW_RESERVED=0xC0F0`.
- IE and IM decide interrupt acceptance (section 11, M9); the S bits are stored and have no effect.
- SP: "the lowest two bits of any value loaded into this register must be 00" (M p.4).
- MDR: after mul = high 32 bits of product; before div = high 32 bits of dividend; after div = remainder (M p.4).
- LIR/LAR: loaded only by SETLB; read by Lcc/LRA; saved/restored by MOVM/CALL/RET/RETF "other" group.

## 2. Global rules

### 2.1 Operand extension (M p.15-18, confirmed per-form in Appendix)

| operand | extension |
|---|---|
| d8/d16 with An/Am base, d8/d16 PC-relative | sign |
| d8/d16 with SP base | **zero** |
| abs16 | **zero** (address 0x0000-0xFFFF) |
| imm8/imm16 into or compared with Dn (`mov`, `add`, `cmp`, `add imm,SP`, `add imm,An`) | sign |
| imm8/imm16 into or compared with An (`mov imm,An`, `cmp imm,An`) | **zero** (exception: `add imm8/imm16,An` is sign) |
| imm8/imm16 of logical ops (`and/or/xor/btst imm,Dn`, `and/or imm16,PSW`), bit-op imm8 | zero |
| CALL/RET/RETF imm8 (frame size) | zero |
| d32/imm32/abs32 | as is, wrap mod 2^32 |

### 2.2 Flag rules used below

- ADDF(a,b,r): Z=(r==0), N=r>>31, C=carry out of bit 31, V=(~(a^b)&(a^r))>>31.
- SUBF(a,b,r) for r=a-b: Z, N as above, C=borrow (a<b unsigned), V=((a^b)&(a^r))>>31.
- LOGF(r): V=0, C=0, N=r>>31, Z=(r==0).
- `-` = unchanged; `?` = architecturally undefined ("Undefined"/"Not specified" in M).

### 2.3 Undefined flags policy (recommended change)

Keep the current deterministic choice (an undefined flag keeps its previous value), and add a poison mask
so that firmware never silently consumes a guessed bit:

- a mask `psw_undef` beside PSW (internal, not one of the debugger's registers; `cpu.mjs` `R[UNDEF]`).
- every flag-writing instruction: `psw_undef = (psw_undef & ~written_or_undefined) | undefined_bits`.
- consumers FAULT (MN_FAULT_UNDEF, code 6; originally written as MN_FAULT_OPCODE) if any bit they read
  is in `psw_undef`:
  Bcc/Lcc (only the bits of their condition: EQ/NE Z; LT/GE N,V; GT/LE Z,N,V; CS/CC C; HI/LS C,Z;
  VC/VS V; NC/NS N), ADDC/SUBC/ROL/ROR (C).
- `mov PSW,Dn` does not fault (firmware saves/restores PSW around IE manipulation, 0x50017cxx); it copies
  the flag values as they are, undefined ones included, and logs nothing.
- `mov Dm,PSW`, a debugger write of PSW (register 10) and reset clear `psw_undef`.
  `and/or imm16,PSW` clear only the bits their immediate forces (implementation change, see header).

Producers of undefined bits: ASL/ASL2 (V,C), ASR/LSR (V; and C when count==0), shifts with count 0 (C),
MUL/MULU (V,C), DIV/DIVU (C; and V for DIVU 2^31<=q<2^32, see 4.6).
Check against firmware (a scan of the reachable set): no reachable site consumes an undefined flag, e.g. all
11 div/divu-then-branch sites test Z of the quotient, and the one asl->beq (0x5002aaf5) reads Z.

### 2.4 Pipeline delays (M Ch.3 2.3/2.4): model sequential semantics, plus one optional detector

- Normal flag updates: M says flags reach PSW one instruction late, except for Bcc/Lcc, and gives
  `add d0,d1; addc d2,d3` as an example where ADDC sees the old carry. **Do not model this.** In the
  firmware, 20 ADDC, 9 ROL, 11 ROR and 4 SUBC sites directly follow a flag-setting instruction (mostly
  add/sub/lsr/asr/rol in the 64-bit arithmetic helpers at 0x5002ab00-0x5002b9ff, e.g. `add a0,d0; addc`
  at 0x5002b3e8, `add d0,d0; rol` at 0x5002ab65, `asr 1,d1; ror` at 0x5002ab54). Those helpers only give
  correct results if the consumer sees the producer's carry, so sequential semantics are what the shipped
  code relies on.
- Explicit PSW writes (`mov Dm,PSW`, `and/or imm16,PSW`): M says "delayed for two instructions at most",
  so a flag read within that window is nondeterministic on hardware. Optional detector: count executed
  instructions since the last explicit PSW write and FAULT (code 6) if a flag consumer (2.3 list plus
  `mov PSW,Dn`, and as implemented also `and/or imm16,PSW`) executes within the next 2 instructions.
  No reachable site trips it. (Originally written as "the firmware always pads"; that is not true.)
  Most of the 39 reachable writes are followed by NOPs (`mov d0,psw; nop; retf` at 0x5002ac18, nop;nop
  elsewhere), but six are followed directly by a control transfer, so the second instruction of the
  window is somewhere else: `mov d0,psw; retf` at 0x50017ccf and 0x50017ce9, `or 0x800,psw; retf` at
  0x5002e610, `or 0x800,psw; rets` at 0x5003b308 and 0x505074b8, and `mov d1,psw; call` at 0x50017c86.
  Following each through its direct callers (return sites) or call target, the second instruction is
  always `clr`, `ret`, `call`, `mov (d8,sp),An`, `mov Dm,Dn` or `mov imm32,Dn`, none of which reads
  flags. None of these functions has its address stored as a literal in the image, so no indirect
  caller was found; one built at run time would not be seen by this scan.

### 2.5 Faults and commit order

- Misaligned 16/32-bit data access: M "operation ... not guaranteed" -> keep MN_FAULT_ALIGN.
- New multi-step instructions must do all loads, range checks and stores before writing registers or
  PSW (BSET/BCLR: load, compute, store, then flags; DIV/DIVU: check divisor/overflow before touching Dn/MDR),
  so that a fault leaves architectural state unchanged.
- Any encoding not listed as defined in section 3 -> MN_FAULT_OPCODE. 0xFF -> MN_FAULT_BREAK (unchanged).

## 3. Complete base opcode map with status

Field names: for 1-byte opcodes `m=(op>>2)&3`, `n=op&3`. For prefixed forms `p` = 2nd byte,
`m=(p>>2)&3`, `n=p&3`. F3/F4 indexed: `i=(p>>2)&3` (Di), `a=p&3` (An base), `r=(p>>4)&3` (data reg).
"len" = total bytes. The number in `OK (n)` = static count in reachable firmware for a form that was
missing at M1 (all are implemented now).
Status: OK = implemented and matches M; FAULT = must fault. At M1 the column also had BUG
(implemented, disagrees with M; section 5) and MISSING; those rows were relabelled when implemented.

### 3.1 One-byte opcode space

| encoding | len | form | semantics | V C N Z | status |
|---|---|---|---|---|---|
| 00,04,08,0C | 1 | CLR Dm' (Dm'=op>>2) | Dm'=0 | 0 0 0 1 | OK |
| 01,05,09,0D abs16 | 3 | MOV Dm,(abs16) | mem32[zx abs16]=Dm | - - - - | OK (1) |
| 02,06,0A,0E abs16 | 3 | MOVBU Dm,(abs16) | mem8[zx abs16]=Dm[7:0] | - - - - | OK (0) |
| 03,07,0B,0F abs16 | 3 | MOVHU Dm,(abs16) | mem16[zx abs16]=Dm[15:0] | - - - - | OK (19) |
| 10-13 | 1 | EXTB Dn | Dn=sx8(Dn) | - - - - | OK |
| 14-17 | 1 | EXTBU Dn | Dn&=0xFF | - - - - | OK |
| 18-1B | 1 | EXTH Dn | Dn=sx16(Dn) | - - - - | OK |
| 1C-1F | 1 | EXTHU Dn | Dn&=0xFFFF | - - - - | OK |
| 20-23 imm8 | 2 | ADD imm8,An | An+=sx(imm8) | ADDF | OK |
| 24-27 imm16 | 3 | MOV imm16,An | An=zx(imm16) | - | OK |
| 28-2B imm8 | 2 | ADD imm8,Dn | Dn+=sx(imm8) | ADDF | OK |
| 2C-2F imm16 | 3 | MOV imm16,Dn | Dn=sx(imm16) | - | OK |
| 30-33 abs16 | 3 | MOV (abs16),Dn | Dn=mem32[zx] | - | OK |
| 34-37 abs16 | 3 | MOVBU (abs16),Dn | Dn=mem8[zx] | - | OK |
| 38-3B abs16 | 3 | MOVHU (abs16),Dn | Dn=mem16[zx] | - | OK |
| 3C-3F | 1 | MOV SP,An | An=SP | - | OK |
| 40,44,48,4C | 1 | INC Dm' | Dm'+=1 | ADDF | OK |
| 41,45,49,4D | 1 | INC Am' | Am'+=1 | **- - - -** | OK (B1 fixed) |
| 42,46,4A,4E d8 | 2 | MOV Dm,(d8,SP) | mem32[SP+zx d8]=Dm | - | OK |
| 43,47,4B,4F d8 | 2 | MOV Am,(d8,SP) | mem32[SP+zx d8]=Am | - | OK |
| 50-53 | 1 | INC4 An | An+=4 | **- - - -** | OK (B2 fixed) |
| 54-57 | 1 | ASL2 Dn | Dn<<=2 | ? ? N Z | OK |
| 58-5B d8 | 2 | MOV (d8,SP),Dn | Dn=mem32[SP+zx d8] | - | OK |
| 5C-5F d8 | 2 | MOV (d8,SP),An | An=mem32[SP+zx d8] | - | OK |
| 6x | 1 | MOV Dm,(An) | mem32[An]=Dm | - | OK |
| 7x | 1 | MOV (Am),Dn' | D[m]=mem32[A[n]] (Dn in bits 3-2, Am in bits 1-0) | - | OK |
| 8x m!=n / m==n imm8 | 1/2 | MOV Dm,Dn / MOV imm8,Dn | Dn=Dm / Dn=sx(imm8) | - | OK |
| 9x m!=n / m==n imm8 | 1/2 | MOV Am,An / MOV imm8,An | An=Am / An=zx(imm8) | - | OK |
| Ax m!=n / m==n imm8 | 1/2 | CMP Dm,Dn / CMP imm8,Dn | Dn-Dm / Dn-sx(imm8) | SUBF | OK |
| Bx m!=n / m==n imm8 | 1/2 | CMP Am,An / CMP imm8,An | An-Am / An-zx(imm8) | SUBF | OK |
| C0-C9 d8 | 2 | Bcc (LT GT GE LE CS HI CC LS EQ NE) | if cc: PC=PC+sx(d8) | - | OK |
| CA d8 | 2 | BRA | PC+=sx(d8) | - | OK |
| CB | 1 | NOP | | - | OK |
| CC d16 | 3 | JMP (d16,PC) | PC+=sx(d16) | - | OK |
| CD d16 regs imm8 | 5 | CALL (d16,PC),regs,imm8 | see 4.10 | - | OK |
| CE regs | 2 | MOVM (SP),regs | see 4.10 | - | OK |
| CF regs | 2 | MOVM regs,(SP) | see 4.10 | - | OK |
| D0-D9 | 1 | Lcc (LLT LGT LGE LLE LCS LHI LCC LLS LEQ LNE) | if cc: PC=LAR-4 else PC+1 | - | OK (B3 fixed) |
| DA | 1 | LRA | PC=LAR-4 | - | OK (86) |
| DB | 1 | SETLB | LIR=mem32code[PC+1]; LAR=PC+5 | - | OK (B3 fixed) |
| DC d32 | 5 | JMP (d32,PC) | PC+=d32 | - | OK (0) |
| DD d32 regs imm8 | 7 | CALL (d32,PC),regs,imm8 | see 4.10 | - | OK |
| DE regs imm8 | 3 | RETF regs,imm8 | see 4.10 | - | OK |
| DF regs imm8 | 3 | RET regs,imm8 | see 4.10 | - | OK |
| Ex | 1 | ADD Dm,Dn | Dn+=Dm | ADDF | OK |
| F0-F6, F8-FE | 2-7 | prefixes | 3.2 | | |
| F7 | - | not in base map (AM33) | | | FAULT |
| FF | 1 | (GNU "break", not in M) | | | FAULT (BREAK), OK |

Bcc condition coding (low nibble) is shared by C0-C9 and D0-D9:
0 LT N^V; 1 GT !(Z|(N^V)); 2 GE !(N^V); 3 LE Z|(N^V); 4 CS C; 5 HI !(C|Z); 6 CC !C; 7 LS C|Z; 8 EQ Z; 9 NE !Z.
(M's Appendix lists LCS as `1101 1001`; that is a typo, the opcode map p.183 puts LCS at D4.)

### 3.2 Prefix F0 (len 2)

| p | form | semantics | V C N Z | status |
|---|---|---|---|---|
| 0x | MOV (Am),An' | A[m]=mem32[A[n]] (dest bits 3-2, base bits 1-0) | - | OK |
| 1x | MOV Am,(An) | mem32[A[n]]=A[m] | - | OK |
| 2x,3x | AM33 (usp/ssp/msp/pc moves) | | | FAULT |
| 4x | MOVBU (Am),Dn' | D[m]=mem8[A[n]] | - | OK |
| 5x | MOVBU Dm,(An) | mem8[A[n]]=D[m] | - | OK |
| 6x | MOVHU (Am),Dn' | D[m]=mem16[A[n]] | - | OK |
| 7x | MOVHU Dm,(An) | mem16[A[n]]=D[m] | - | OK |
| 8x | BSET Dm,(An) | 4.8 | 0 0 0 Z | OK (13) |
| 9x | BCLR Dm,(An) | 4.8 | 0 0 0 Z | OK (13) |
| A0-EF | undefined in M (F0C0 is a GNU-simulator "syscall", F0Ex AM33) | | | FAULT |
| F0-F3 | CALLS (An) | mem32[SP]=PC+2; MDR=PC+2; PC=An | - | OK |
| F4-F7 | JMP (An) | PC=An | - | OK |
| F8-FB | undefined | | | FAULT |
| FC | RETS | PC=mem32[SP] (SP unchanged) | - | OK |
| FD | RTI (system) | PSW=mem16[SP]; PC=mem32[SP+4]; SP+=8 | from stack | OK (M9, 11.1; site `0x50017e83`) |
| FE | TRAP (system) | mem32[SP]=PC+2; PC=0x40000010 | - | FAULT (recommended, 4.12) |
| FF | (GNU "rtm", not in M) | | | FAULT |

### 3.3 Prefix F1 (len 2)

| p | form | semantics | flags | status |
|---|---|---|---|---|
| 0x | SUB Dm,Dn | Dn-=Dm | SUBF | OK |
| 1x | SUB Am,Dn | Dn-=Am | SUBF | OK |
| 2x | SUB Dm,An | An-=Dm | SUBF | OK |
| 3x | SUB Am,An | An-=Am | SUBF | OK |
| 4x | ADDC Dm,Dn | 4.4 | V C N Z | OK (24) |
| 5x | ADD Am,Dn | Dn+=Am | ADDF | OK |
| 6x | ADD Dm,An | An+=Dm | ADDF | OK |
| 7x | ADD Am,An | An+=Am | ADDF | OK |
| 8x | SUBC Dm,Dn | 4.4 | V C N Z | OK (8) |
| 9x | CMP Am,Dn | Dn-Am | SUBF | OK |
| Ax | CMP Dm,An | An-Dm | SUBF | OK |
| Bx,Cx | undefined | | | FAULT |
| Dx | MOV Am,Dn | Dn=Am | - | OK |
| Ex | MOV Dm,An | An=Dm | - | OK |
| Fx | undefined | | | FAULT |

### 3.4 Prefix F2 (len 2)

| p | form | semantics | V C N Z | status / cnt |
|---|---|---|---|---|
| 0x | AND Dm,Dn | Dn&=Dm | LOGF | OK (4082) |
| 1x | OR Dm,Dn | Dn\|=Dm | LOGF | OK (4699) |
| 2x | XOR Dm,Dn | Dn^=Dm | LOGF | OK (120) |
| 30-33 | NOT Dn | Dn=~Dn | LOGF | OK (617) |
| 34-3F | undefined | | | FAULT |
| 4x | MUL Dm,Dn | 4.5 | ? ? N Z | OK (7) |
| 5x | MULU Dm,Dn | 4.5 | ? ? N Z | OK (41) |
| 6x | DIV Dm,Dn | 4.6 | 0 ? N Z (V=1 -> FAULT) | OK (6220) |
| 7x | DIVU Dm,Dn | 4.6 | 0 ? N Z (V=1 -> FAULT) | OK (1610) |
| 80-83 | ROL Dn | 4.7 | 0 C N Z | OK (9) |
| 84-87 | ROR Dn | 4.7 | 0 C N Z | OK (13) |
| 88-8F | undefined | | | FAULT |
| 9x | ASL Dm,Dn | 4.9 | ? ? N Z | OK |
| Ax | LSR Dm,Dn | 4.9 | ? C N Z | OK |
| Bx | ASR Dm,Dn | 4.9 | ? C N Z | OK |
| Cx | undefined | | | FAULT |
| D0-D3 | EXT Dn | MDR = (Dn>>31) ? 0xFFFFFFFF : 0; Dn unchanged | - | OK (6266) |
| D4-DF | undefined | | | FAULT |
| E0-E3 | MOV MDR,Dn | Dn=MDR | - | OK (908) |
| E4-E7 | MOV PSW,Dn | Dn=PSW (zero-extended 16->32) | - | OK (15) |
| E8-EF | undefined / AM33 EPSW (F2EC) | | | FAULT |
| F0,F4,F8,FC | MOV Am,SP | SP=Am (m=(p>>2)&3) | - | OK (3) |
| F1,F5,F9,FD | AM33 mov Dm,EPSW | | | FAULT |
| F2,F6,FA,FE | MOV Dm,MDR | MDR=Dm | - | OK (1614) |
| F3,F7,FB,FF | MOV Dm,PSW | 4.11 | from Dm | OK (16) |

### 3.5 Prefixes F3, F4 (len 2), all 256 values defined

| op p | form | status |
|---|---|---|
| F3 00-3F | MOV (Di,Aa),Dr: Dr=mem32[Aa+Di] | OK |
| F3 40-7F | MOV Dr,(Di,Aa) | OK |
| F3 80-BF | MOV (Di,Aa),Ar | OK |
| F3 C0-FF | MOV Ar,(Di,Aa) | OK |
| F4 00-3F | MOVBU (Di,Aa),Dr | OK |
| F4 40-7F | MOVBU Dr,(Di,Aa) | OK |
| F4 80-BF | MOVHU (Di,Aa),Dr | OK |
| F4 C0-FF | MOVHU Dr,(Di,Aa) | OK |

### 3.6 UDF space (encodings only; semantics and which forms run are in `om1-udf-spec.md`)

| op | len | forms |
|---|---|---|
| F5 p | 2 | UDF20-35 Dm,Dn (p>>4 = nn-20), no write-back, flags unchanged per M |
| F6 p | 2 | UDF00-15 Dm,Dn |
| F9 p imm8 | 3 | p&0xC0: 00 UDFnn sx imm8; 04 UDFUnn zx; 08 UDF2x; 0C UDFU2x (nn = p>>4) |
| FB p imm16 | 4 | same layout with imm16 |
| FD p imm32 | 6 | same layout with imm32 |

The analysis's instruction-shape table labels F9E0/FBE0 as "fadd" (FPU) and FE0x as "am33_ext"; both are wrong. F9/FB E0-E3 is
UDF14 imm8/imm16, and FE00/01/02 are base BSET/BCLR/BTST imm8,(abs32).

### 3.7 Prefix F8 (len 3: F8 p d8/imm8)

| p | form | semantics | flags | status |
|---|---|---|---|---|
| 0x | MOV (d8,Aa),Dm | D[m]=mem32[A[n]+sx d8] | - | OK |
| 1x | MOV Dm,(d8,An) | | - | OK |
| 2x | MOV (d8,Aa),Am | | - | OK |
| 3x | MOV Am,(d8,An) | | - | OK |
| 4x/5x | MOVBU load/store (d8,An) | | - | OK |
| 6x/7x | MOVHU load/store (d8,An) | | - | OK |
| 8x | undefined | | | FAULT (OK) |
| 92,96,9A,9E | MOVBU Dm,(d8,SP) | mem8[SP+zx d8]=Dm | - | OK |
| 93,97,9B,9F | MOVHU Dm,(d8,SP) | mem16[SP+zx d8]=Dm | - | OK |
| 90,91,94,95,98,99,9C,9D | undefined (word forms are 1-byte 42/43) | | | FAULT (B4 fixed; M1 executed them) |
| Ax | undefined | | | FAULT (OK) |
| B0-B7 | undefined (word forms are 1-byte 58/5C) | | | FAULT (B4 fixed; M1 executed them) |
| B8-BB | MOVBU (d8,SP),Dn | | - | OK |
| BC-BF | MOVHU (d8,SP),Dn | | - | OK |
| C0-C3 | ASL imm8,Dn | 4.9 | ? ? N Z | OK |
| C4-C7 | LSR imm8,Dn | 4.9 | ? C N Z | OK |
| C8-CB | ASR imm8,Dn | 4.9 | ? C N Z | OK |
| CC-DF | undefined | | | FAULT |
| E0-E3 | AND imm8,Dn | Dn&=zx imm8 | LOGF | OK |
| E4-E7 | OR imm8,Dn | Dn\|=zx imm8 | LOGF | OK (1407) |
| E8 | BVC (d8,PC) | if !V: PC=PC+sx d8 (PC = address of the F8 byte) | - | OK (0) |
| E9 | BVS | if V | - | OK (0) |
| EA | BNC | if !N | - | OK (8) |
| EB | BNS | if N | - | OK (7) |
| EC-EF | BTST imm8,Dn | zx imm8 & Dn | LOGF (N always 0) | OK |
| F0-F3 | MOV (d8,An),SP | SP=mem32[A[n]+sx d8] | - | OK (2) |
| F4-F7 | MOV SP,(d8,An) | mem32[A[n]+sx d8]=SP | - | OK (1) |
| F8-FD | undefined | | | FAULT |
| FE | ADD imm8,SP | SP+=sx imm8 | - | OK |
| FF | undefined | | | FAULT (OK) |

Branch target check: `f8 ea 11` at 0x5002a933 disassembles (B) to 0x5002a944 = PC+0x11, so the base is
the instruction's own address, same as Bcc.

### 3.8 Prefix FA (len 4: FA p d16/imm16/abs16, or FA p d8 imm8)

| p | form | semantics | flags | status |
|---|---|---|---|---|
| 0x-7x | MOV/MOVBU/MOVHU (d16,An) loads and stores (same layout as F8 0x-7x, sx d16) | | - | OK |
| 80,84,88,8C | MOV Am,(abs16) | mem32[zx abs16]=A[m] | - | OK (0) |
| other 8x | undefined | | | FAULT (OK) |
| 9x (all 16) | MOV An/Dn, MOVBU, MOVHU ->(d16,SP); kind=p&3: 0 A[m] word, 1 D[m] word, 2 byte, 3 half | zx d16 | - | OK |
| A0-A3 | MOV (abs16),An | A[n]=mem32[zx abs16] | - | OK (15) |
| A4-AF | undefined | | | FAULT (OK) |
| B0-B3/B4-B7/B8-BB/BC-BF | MOV (d16,SP),An / Dn / MOVBU / MOVHU | zx d16 | - | OK |
| C0-C3 | ADD imm16,Dn | sx | ADDF | OK |
| C8-CB | CMP imm16,Dn | sx | SUBF | OK |
| D0-D3 | ADD imm16,An | sx | ADDF | OK |
| D8-DB | CMP imm16,An | **zx** | SUBF | OK |
| C4-C7,CC-CF,D4-D7,DC-DF | undefined | | | FAULT (OK) |
| E0-E3 | AND imm16,Dn | zx | LOGF | OK |
| E4-E7 | OR imm16,Dn | zx | LOGF | OK (529) |
| E8-EB | XOR imm16,Dn | zx | LOGF | OK (111) |
| EC-EF | BTST imm16,Dn | zx | LOGF | OK |
| F0-F3 d8 imm8 | BSET imm8,(d8,An) | 4.8, sx d8 | 0 0 0 Z | OK (0) |
| F4-F7 d8 imm8 | BCLR imm8,(d8,An) | 4.8 | 0 0 0 Z | OK (0) |
| F8-FB d8 imm8 | BTST imm8,(d8,An) | 4.8 | 0 0 0 Z | OK (0) |
| FC | AND imm16,PSW | 4.11 | from result | OK (18) |
| FD | OR imm16,PSW | 4.11 | from result | OK (5) |
| FE | ADD imm16,SP | sx | - | OK |
| FF | CALLS (d16,PC) | mem32[SP]=PC+4; MDR=PC+4; PC+=sx d16 | - | OK |

### 3.9 Prefix FC (len 6: FC p d32/imm32/abs32)

| p | form | flags | status |
|---|---|---|---|
| 0x-7x | (d32,An) loads/stores | - | OK |
| 8x (all 16) | stores to (abs32): kind 0 A[m] word, 1 D[m] word, 2 byte, 3 half | - | OK |
| 9x | stores to (d32,SP) | - | OK |
| A0-A3/A4-A7/A8-AB/AC-AF | MOV (abs32),An / Dn / MOVBU / MOVHU | - | OK |
| Bx | loads from (d32,SP) | - | OK |
| C0-C3 | ADD imm32,Dn | ADDF | OK |
| C4-C7 | SUB imm32,Dn: Dn-=imm32 | SUBF | OK (9) |
| C8-CB | CMP imm32,Dn | SUBF | OK |
| CC-CF | MOV imm32,Dn | - | OK |
| D0-D3 | ADD imm32,An | ADDF | OK |
| D4-D7 | SUB imm32,An: An-=imm32 | SUBF | OK (10) |
| D8-DB | CMP imm32,An | SUBF | OK |
| DC-DF | MOV imm32,An | - | OK |
| E0-E3 | AND imm32,Dn | LOGF | OK |
| E4-E7 | OR imm32,Dn | LOGF | OK (564) |
| E8-EB | XOR imm32,Dn | LOGF | OK (12) |
| EC-EF | BTST imm32,Dn | LOGF | OK |
| F0-FD | undefined | | FAULT (OK) |
| FE | ADD imm32,SP | - | OK |
| FF | CALLS (d32,PC): ret=PC+6 | - | OK |

### 3.10 Prefix FE (bit ops on absolute addresses)

| bytes | len | form | status |
|---|---|---|---|
| FE 00 abs32 imm8 | 7 | BSET imm8,(abs32) | OK (30) |
| FE 01 abs32 imm8 | 7 | BCLR imm8,(abs32) | OK (19) |
| FE 02 abs32 imm8 | 7 | BTST imm8,(abs32) | OK (92) |
| FE 80 abs16 imm8 | 5 | BSET imm8,(abs16), zx abs16 | OK (0); M: AM32 only |
| FE 81 abs16 imm8 | 5 | BCLR imm8,(abs16) | OK (0); AM32 only |
| FE 82 abs16 imm8 | 5 | BTST imm8,(abs16) | OK (0); AM32 only |
| FE other | - | undefined | FAULT |

Operand byte order (M p.21-22): the opcode bytes, then the little-endian address, then imm8 as the last byte.

## 4. Semantics of the forms that were missing or changed at M1 (pseudo-C, all arithmetic uint32_t mod 2^32)

### 4.1 Absolute-16 stores/loads

```
abs = zx16(fetch16(pc+1 or pc+2));   // zero-extended: 0x0000..0xFFFF
01|m<<2: store(abs, D[m], 4)   02|m<<2: store(abs, D[m], 1)   03|m<<2: store(abs, D[m], 2)
FA 80|m<<2: store(abs, A[m], 4)          FA A0|n: A[n] = load(abs, 4)
```
No flags. Alignment fault for word/half as for every other access.

### 4.2 Logic: AND/OR/XOR/NOT (register and immediate)

`r = op(Dn, src); Dn = r; V=0; C=0; N=r>>31; Z=(r==0)`. Immediate imm8/imm16 is zero-extended.
The existing AND Dm,Dn is missing but the AND imm path already shows the right flag rule.

### 4.3 SUB imm32 (FC C4/D4)

`R = R - imm32`, SUBF, same helper as `sub()`.

### 4.4 ADDC / SUBC

```
ADDC: c=C; r=Dn+Dm+c; C = ((uint64)Dn+Dm+c) >> 32; V=(~(Dn^Dm)&(Dn^r))>>31; N=r>>31; Z=(r==0); Dn=r
SUBC: c=C; r=Dn-Dm-c; C = ((uint64)Dm + c) > Dn;   V=((Dn^Dm)&(Dn^r))>>31;  N=r>>31; Z=(r==0); Dn=r
```
Z is plain (`r==0`) per M p.48/51 and Appendix. GNU sim (S) implements sticky Z (`Z = oldZ && r==0`),
which is AM33 behaviour; do not copy it. The firmware's 64-bit compare helper at 0x5002ac05-0x5002ac0d
(`sub a0,d0; beq; subc d3,d1; bne; inc d1`) gives the same final flags under either rule, so it does not
settle the question, but its `inc d1` is only reachable under plain Z, which fits the manual.

### 4.5 MUL / MULU

```
MUL:  p = (int64)(int32)Dn * (int64)(int32)Dm;  MULU: p = (uint64)Dn * (uint64)Dm;
Dn = (uint32)p; MDR = (uint32)(p >> 32); N = Dn>>31; Z = (Dn==0); V,C undefined (preserve + poison)
```
M p.52-53. The AM30-only rule "no write to A0 in the two preceding instructions" is a pipeline
constraint, not a semantic one; ignore it. (S clears V and C instead of leaving them undefined.)

### 4.6 DIV / DIVU

```
DIV:  dd = (int64)(((uint64)MDR << 32) | Dn); dv = (int32)Dm;
      if (dv == 0) FAULT;                         // M: V=1, Dn/MDR/N/Z undefined
      if (dd == INT64_MIN && dv == -1) FAULT;     // C UB; quotient overflow anyway
      q = dd / dv; r = dd % dv;                   // C99: truncate toward zero, r has sign of dd
      if (q < INT32_MIN || q > INT32_MAX) FAULT;  // M: V=1, results undefined
      Dn = (uint32)q; MDR = (uint32)r; V=0; N=Dn>>31; Z=(Dn==0); C undefined (poison)
DIVU: dd = ((uint64)MDR << 32) | Dn; dv = Dm;
      if (dv == 0) FAULT;
      q = dd / dv; r = dd % dv;
      if (q > 0xFFFFFFFF) FAULT;
      Dn = q; MDR = r; N=Dn>>31; Z=(Dn==0); C undefined;
      V = 0 if q <= 0x7FFFFFFF, else poison V (see below)
```
Every FAULT above is MN_FAULT_UNDEF (code 6) in the implementation.
The usual compiler pairs are present in the firmware: `ext Dn; div` (signed) and `clr dX; mov dX,mdr; divu` (unsigned).

Resolutions and residual doubt:
- N/Z: M says "1 if MSB of the **divisor**" / "1 if the **divisor** is 0". That is a translation error for
  the quotient: (a) Z=1 for divisor 0 contradicts the zero-divide row (V=1, Z undefined);
  (b) S uses the quotient; (c) firmware 0x510e0242 `mov 10,d2; div d2,d3; ...; bne` branches on the flags
  of a division by the constant 10, which would be a constant branch if Z described the divisor.
- Rounding for negative operands: M is silent. Truncation toward zero comes from S (C `/`,`%` on int64)
  and is what a C compiler needs from `ext; div` for C `/` and `%`. Treat it as established by secondary
  sources, not by M.
- DIVU overflow: M's DIVU page is a copy of the DIV page (it says "signed 64-bit" and "signed 32-bit value").
  Read literally, a quotient in [2^31, 2^32) would be an overflow with undefined results, which would
  break ordinary unsigned 32/32 division (`0xFFFFFFFF/1` with MDR=0). Recommended: results are defined
  for q < 2^32, V is poisoned for 2^31 <= q < 2^32, and q >= 2^32 faults.
- Zero divide and overflow: S writes invented values (Dn=0xff, MDR=dividend); never copy those.

### 4.7 ROL / ROR (1-bit rotate through carry)

```
ROL: c=C; C=Dn>>31;  Dn=(Dn<<1)|c;        V=0; N=Dn>>31; Z=(Dn==0)
ROR: c=C; C=Dn&1;    Dn=(Dn>>1)|(c<<31);  V=0; N=Dn>>31; Z=(Dn==0)
```
M's flag table (p.79-80) and the Appendix give V=0 and C changed. The prose says "VF/CF: Not specified",
which contradicts the operation line `Dn.lsb -> CF`. Follow the operation and the tables (S agrees).
Firmware uses this for 64-bit shifts (`add d0,d0; rol d1`, `lsr 1,d1; ror d0`).

### 4.8 BTST / BSET / BCLR on memory

```
addr: F0 8x/9x: A[n]; FA Fx: A[n]+sx(d8); FE 0x: abs32; FE 8x: zx(abs16)
x:    F0 8x/9x: D[m] (32-bit, only low 8 bits can matter); others: zx(imm8)
t = mem8[addr]   (zero-extended)
BTST: (no store)
BSET: store8(addr, t | x)
BCLR: store8(addr, t & ~x)
then  V=0; C=0; N=0; Z=((t & x)==0)     // Z tests the OLD byte, before the set/clear
```
Byte access, so no alignment check. The hardware bus lock and interrupt disable (M p.7) do not matter in a
single-CPU emulator. Do the store before writing PSW (2.5) so a ROM-write fault leaves the flags untouched.
FAF0 byte layout is `FA, F0|n, d8, imm8`; FE00 is `FE, 00, abs32 (LE), imm8`.

### 4.9 Shifts (existing, verified)

ASR/LSR: count = (Dm or imm8) & 31. If count != 0: C = **Dn bit 0** ("Dn.lsb -> CF", "the bit value
firstly shifted out"), N and Z from the result, V undefined. If count == 0: no shift, N/Z from Dn, V and C
undefined. ASL/ASL2: N/Z from the result, V and C undefined. The current `shift()` matches this
(C = value&1, which looks unusual but is what M states; S agrees). With 2.3, add C to `psw_undef` when
count==0 and for ASL, and V always.

### 4.10 CALL / RET / RETF / MOVM (existing, verified against the Appendix)

Save order D2, D3, A2, A3, then "other" = D0, D1, A0, A1, MDR, LIR, LAR, at SP-4, SP-8, ... with unselected
registers skipped. "other" adds a 4-byte dummy at the lowest address (MOVM size = 4*(n+1)). CALL:
mem32[SP]=ret; regs saved below SP; SP-=zx(imm8); MDR=ret; PC+=disp, where ret = PC+5 (d16) or PC+7 (d32).
RET: SP+=zx(imm8); regs restored from new SP-4...; PC=mem32[SP]. RETF: same but PC=MDR, read before the
restore. regs bits 2-0 are reserved "0", so the existing MN_FAULT_REGMASK is correct.

### 4.11 PSW access

```
MOV PSW,Dn  (F2 E4|n):   Dn = PSW & 0xFFFF
MOV Dm,PSW  (F2 F3|m<<2): v = Dm & 0xFFFF;            if (v & 0xC0F0) FAULT; PSW = v; psw_undef = 0
AND imm16,PSW (FA FC):    PSW = PSW & imm16;                                        psw_undef &= imm16
OR  imm16,PSW (FA FD):    v = PSW | imm16;           if (v & 0xC0F0) FAULT; PSW = v; psw_undef &= ~imm16
```
As implemented: the reserved-bit FAULT is code 6 (MN_FAULT_UNDEF), and the psw_undef updates of AND/OR
replace the original `psw_undef = 0` (see header).
V, C, N, Z come from bits 3..0 of the result (M p.26, 60, 62). Bits that matter: flags (0-3); IE (11),
IM (8-10) and S0/S1 (12-13) are stored only, since there are no interrupts. The FAULT on reserved bits is
recommended because M draws them as 0 without saying whether they are writable. Firmware values:
`and 0xF7FF,psw` (clear IE), `and 0xF0FF,psw` (clear IE and IM, at reset 0x50000000),
`or 0x0800,psw` (set IE), and `mov dX,psw` restoring a value previously read with `mov psw,dX`.

### 4.12 Loop and other control flow

```
SETLB (DB):    LIR = code32(PC+1); LAR = PC+5; PC += 1
Lcc (D0-D9):   if cc: PC = LAR-4 else PC += 1
LRA (DA):      PC = LAR-4
JMP d32 (DC):  PC = PC + d32
MOV Am,SP (F2 F0|m<<2):    SP = A[m]
MOV (d8,An),SP (F8 F0|n):  SP = load32(A[n]+sx d8)
MOV SP,(d8,An) (F8 F4|n):  store32(A[n]+sx d8, SP)
```
- Lcc not taken: M p.82 prose says "LAR+1 -> PC". That is a typo: the Appendix gives PC+1, and the prose
  itself says "executes the following instructions".
- LIR byte order: AM30 stores the bytes little-endian (the current code_value(…,4) gives the same value).
  AM31/AM32 rotate them by (PC+1)&3 (M p.83). Which core the OM-1 has is unknown, so the LIR value is only
  known when PC+1 is 4-aligned. Nothing in the emulator executes from LIR: Lcc refetches from LAR-4, which
  matches unless the loop body was modified. LIR is visible only through MOVM/CALL "other" saves.
- Writing SP: M requires the low 2 bits to be 0, so FAULT (MN_FAULT_ALIGN) on a misaligned value for
  MOV Am,SP and MOV (d8,An),SP. Leave `add imm,SP` as is.
- RTI and TRAP are system instructions (interrupt return, OS call to the fixed vector 0x40000010). Their semantics are given in 3.2. Before M9 the lab had no exception model, so both faulted. Since M9 RTI is implemented (section 11.1): its site `0x50017e83`, the kernel's interrupt exit, is reachable and runs in every K-native lab. TRAP still faults (no reachable site; `0x40000010` is unmapped). `syscall` (F0C0) and `rtm` (F0FF) are GNU-tool inventions and are not in M.

## 5. Bugs in the M1 CPU (all fixed; historical record)

| id | form | defect | evidence | impact |
|---|---|---|---|---|
| B1 | INC An (`41`, `45`, ...) | INC An updated V/C/N/Z; M p.56 and the Appendix give "- - - -" for INC An | M | 2546 reachable sites. At least 3 sit directly before Bcc/Lcc (0x5012b55a, 0x5012b654, 0x5177d95e), where the branch reads INC's flags instead of the earlier compare |
| B2 | INC4 An (`50`-`53`) | INC4 An updated flags; M p.57 "No changes" | M | 9560 sites. At least 10 directly before Lcc/Bcc, e.g. 0x5002349a `cmp 7,d1; mov d0,(a0); inc4 a0; llt`: the loop exits wrongly. Both B1 and B2 are plain `+= 1` / `+= 4` |
| B3 | SETLB / Lcc | SETLB set LAR=PC+1 (M: PC+5) and Lcc jumped to LAR (M: LAR-4) | M p.82-83, Appendix | Control flow was right because the two errors cancel, but the LAR value was wrong wherever it is observable: MOVM/CALL "other" saves, the debugger, and any LRA added on top of that convention (86 reachable LRA sites). Both were fixed together with LRA |
| B4 | F8 9x / Bx (the 2nd-byte ranges `90`-`9F` and `B0`-`BF` shared by F8/FA/FC) | For F8 it also accepted the undefined 2nd bytes 90,91,94,95,98,99,9C,9D (executed as word stores to (d8,SP)) and B0-B7 (executed as word loads) | M map p.187, B (only f892/f893/f8b8/f8bc masks) | Strictness only: none of these is reachable. For op==0xF8, `(p & 3) >= 2` in 9x and `p >= 0xB8` in Bx are required |

No other flag, extension or length disagreements were found. Every existing form in section 3 marked OK
was checked against the M Appendix row and the B mask/operand fields: sign/zero extension of d8/d16/imm
(SP-relative zero, An-relative sign, CMP/MOV imm,An zero, ADD imm,An sign), CALL/CALLS return addresses,
MOVM layout including the dummy word, RET/RETF order, shift C = bit 0, Bcc conditions, and CLR flags.

Test fallout: check_nd128's CPU checks (`cpu_checks`) used `f9 02 06` (UDF00 imm8) as their "unimplemented
opcode" probe (fault 1); since UDF00 is implemented they use the still-undefined base encoding `f2 c0`
(`emu/checks/check_nd128.mjs`). None of the current checks depends on B1-B4 behaviour.

## 6. Base forms missing at M1, ranked by reachable static count (all implemented now)

(counts of each form's sites in the reachable set; base forms with 0 reachable sites follow)

| rank | form | encoding | count |
|---|---|---|---|
| 1 | EXT Dn | F2 D0-D3 | 6266 |
| 2 | DIV Dm,Dn | F2 6x | 6220 |
| 3 | OR Dm,Dn | F2 1x | 4699 |
| 4 | AND Dm,Dn | F2 0x | 4082 |
| 5 | MOV Dm,MDR | F2 F2/F6/FA/FE | 1614 |
| 6 | DIVU Dm,Dn | F2 7x | 1610 |
| 7 | OR imm8,Dn | F8 E4-E7 | 1407 |
| 8 | MOV MDR,Dn | F2 E0-E3 | 908 |
| 9 | NOT Dn | F2 30-33 | 617 |
| 10 | OR imm32,Dn | FC E4-E7 | 564 |
| 11 | OR imm16,Dn | FA E4-E7 | 529 |
| 12 | XOR Dm,Dn | F2 2x | 120 |
| 13 | XOR imm16,Dn | FA E8-EB | 111 |
| 14 | BTST imm8,(abs32) | FE 02 | 92 |
| 15 | LRA | DA | 86 |
| 16 | MULU Dm,Dn | F2 5x | 41 |
| 17 | BSET imm8,(abs32) | FE 00 | 30 |
| 18 | ADDC Dm,Dn | F1 4x | 24 |
| 19 | MOVHU Dm,(abs16) | 03/07/0B/0F | 19 |
| 20 | BCLR imm8,(abs32) | FE 01 | 19 |
| 21 | AND imm16,PSW | FA FC | 18 |
| 22 | MOV Dm,PSW | F2 F3/F7/FB/FF | 16 |
| 23 | MOV (abs16),An | FA A0-A3 | 15 |
| 24 | MOV PSW,Dn | F2 E4-E7 | 15 |
| 25 | BSET Dm,(An) | F0 8x | 13 |
| 26 | BCLR Dm,(An) | F0 9x | 13 |
| 27 | ROR Dn | F2 84-87 | 13 |
| 28 | XOR imm32,Dn | FC E8-EB | 12 |
| 29 | SUB imm32,An | FC D4-D7 | 10 |
| 30 | SUB imm32,Dn | FC C4-C7 | 9 |
| 31 | ROL Dn | F2 80-83 | 9 |
| 32 | BNC | F8 EA | 8 |
| 33 | SUBC Dm,Dn | F1 8x | 8 |
| 34 | MUL Dm,Dn | F2 4x | 7 |
| 35 | BNS | F8 EB | 7 |
| 36 | OR imm16,PSW | FA FD | 5 |
| 37 | MOV Am,SP | F2 F0/F4/F8/FC | 3 |
| 38 | MOV (d8,An),SP | F8 F0-F3 | 2 |
| 39 | MOV Dm,(abs16) | 01/05/09/0D | 1 |
| 40 | MOV SP,(d8,An) | F8 F4-F7 | 1 |
| - | MOVBU Dm,(abs16) | 02/06/0A/0E | 0 |
| - | MOV Am,(abs16) | FA 80/84/88/8C | 0 |
| - | BVC / BVS | F8 E8 / E9 | 0 |
| - | BSET/BCLR/BTST imm8,(d8,An) | FA F0-FB | 0 |
| - | BSET/BCLR/BTST imm8,(abs16) | FE 80-82 | 0 |
| - | JMP (d32,PC) | DC | 0 |
| - | RTI, TRAP | F0 FD, F0 FE | 0 (TRAP keeps FAULT; RTI implemented in M9, section 11.1: its site `0x50017e83` in the interrupt exit was not in this static count) |

`break` (FF, 1 site at 0x50017b86) already faults with MN_FAULT_BREAK. A scan of reachable code
(the reachable set and a hex-prefix check) found no undefined base encoding.

## 7. Length table gaps at M1 (fixed)

The length table at M1 gave length 1 to the following, which should have:

| opcodes | correct length | note |
|---|---|---|
| 01-03, 05-07, 09-0B, 0D-0F | 3 | abs16 stores (00/04/08/0C stay 1) |
| DC | 5 | JMP d32 |
| F5, F6 (F7 harmless) | 2 | UDF Dm,Dn |
| F9 | 3 | UDF imm8 |
| FB | 4 | UDF imm16 |
| FD | 6 | UDF imm32 |
| FE | 7 if 2nd byte < 0x80, else 5 | needs a 2nd-byte read |

DA (LRA) was correctly 1 already. The table now is `insnLength(op, p)` in `emu/src/core/cpu.mjs` (`p` is the 2nd
byte, read for F0-FE except F7; F7 keeps length 1 there).

## 8. Unknowns (the emulator must FAULT rather than guess)

1. DIV/DIVU with divisor 0 or quotient overflow: M leaves Dn, MDR, N, Z undefined.
2. Reserved PSW bits (0xC0F0) set by `mov Dm,PSW` / `or imm16,PSW`: whether they are writable is not stated.
3. A flag consumer reading a bit that the last producer left undefined (2.3 poison).
4. A flag consumer within 2 instructions of an explicit PSW write, if the optional detector (2.4) is added.
5. LIR contents after SETLB at a non-4-aligned PC+1 on AM31/AM32: unknown core. No fault needed because
   nothing consumes LIR, but do not assert on its value in tests.
6. TRAP, F0C0 "syscall", F0FF "rtm", FF "break", F7 xx, the UDF/UDFU forms `om1-udf-spec.md` does not define, and every encoding marked undefined in section 3. (RTI is defined since M9, section 11.)
7. Misaligned values written to SP (MOV Am,SP / MOV (d8,An),SP).

## 9. Checks proposed before the implementation (each form is now covered by the check_isa vectors)

- `41` (inc a0) with psw=15 -> psw stays 15. `50` (inc4 a0) likewise.
- `db cb cb cb cb da` from PROGRAM: after SETLB, LAR=PROGRAM+5; LRA lands on PROGRAM+1.
- `f2 d0` with d0=0x80000000 -> mdr=0xffffffff, psw unchanged.
- `f2 61` (div d0,d1) with mdr=0xffffffff, d1=-7, d0=2 -> d1=-3, mdr=-1, V=0, N=1.
- `f2 61` with d0=0 -> fault 6 (originally written as fault 1).
- `f2 71` (divu) with mdr=0, d1=0xffffffff, d0=1 -> d1=0xffffffff, mdr=0.
- `f1 41` (addc d0,d1) with C=1, d0=0xffffffff, d1=0 -> d1=0, C=1, Z=1 (plain Z).
- `f2 84` (ror d0) with C=1, d0=1 -> d0=0x80000000, C=1, V=0, N=1.
- `fe 02 <abs32> 01` / `fe 00 ...` on a RAM byte: Z from the old byte, byte updated.
- `f8 90 04` -> fault 1 (B4).
- `fa fd 00 01` (or 0x0100,psw) works; `fa fd 10 00` (reserved bit 4) -> fault 6 (originally written as fault 1).

## 10. The interpreter (PERF)

Status: `emu/src/core/interp.mjs` (`run()`: the decoded-instruction cache, the inline forms and the interrupt looks) over `emu/src/core/cpu.mjs` (`step()`); `emu/src/core/mem.mjs` (code invalidation, the I/O and code-store records); `emu/src/machine.mjs` (the continue loop and its visits, breakpoints, the machine options of 10.7). Every rule below is checked by `emu/checks/check_perf.mjs`; the group that checks it is named in brackets. The reference is the same program run one instruction at a time (`step()`, the debugger's single step) or in the forced one-instruction mode (10.7).

### 10.1 Decoded forms

`run()` decodes an instruction once per pc into a direct-mapped cache (65536 slots tagged by pc). The length comes only from `insnLength`: decoding fetches exactly that many bytes, each once and in order, and a code-fetch fault there is fault 2 at the instruction's pc and does not count.

These forms run inline from their slot, each following its case in `step()`: CLR; EXTB/EXTBU/EXTH/EXTHU; ADD imm8,An/Dn; MOV imm16,An/Dn; MOV SP,An; INC Dn/An; INC4; ASL2; MOV Rm,(d8,SP) and (d8,SP),Rn; MOV Dm,(An) and (An),Dm; MOV Dm,Dn/Am,An and imm8; CMP (all register and imm8 forms); Bcc and BRA (C0-CA); NOP; Lcc (D0-D9); SETLB; ADD Dm,Dn; F0 loads and stores through (An); F1 SUB/ADD/CMP/MOV between D and A registers (not ADDC/SUBC); F2 AND/OR/XOR Dm,Dn; F8/FA/FC (d,An) loads and stores, (d,SP) loads and stores, AND/OR/XOR/BTST imm, ADD/CMP imm to Dn/An, FC SUB imm32 and MOV imm32, ADD imm,SP; the UDF multiplies by an immediate (udf00 and udfu01 imm). Everything else runs `step()` from the slot: ADDC/SUBC, ROL/ROR, MUL/MULU/DIV/DIVU, shifts other than ASL2, bit operations, MOVM, CALL/CALLS/RET/RETF/RETS, JMP, LRA, the other UDF forms, every PSW and MDR access, the F8 BVC/BVS/BNC/BNS branches and every faulting encoding.

Inline forms write `psw` and `psw_undef` exactly as `step()`: ADD/SUB/CMP set all four flags, logic forms set C = V = 0, ASL2 writes Z and N and marks V and C undefined (2.3). Bcc and Lcc read their flags through the same table as `step()` (`CC_USES`) and fault 6 on an undefined one. Memory accesses keep `step()`'s order: alignment (fault 3), then the flash-view store check (fault 2), then the access; the pc register holds the instruction's own pc during its accesses, because the lab devices log the accessing pc. A fault of an inline form counts, as in `step()`. [P1, P2, P4; analogs 1, 2, 7]

### 10.2 Code writes, the bus window and MMIO code

A slot is dropped when a byte of the 256-byte physical chunk its instruction lies in is written: a CPU store, a debugger write or engine DMA. The next arrival decodes again, so a store into code is seen by the next instruction that runs there (a profiling run over the check_menu and check_nav runs, 3.6 G instructions, counted no guest store into executed code, but `step()` re-reads code bytes, so the inline forms must see such a store too). The bus window `0xB8000000` (`emu/src/dev/bus.mjs`, A17) is an alias the guest remaps (`0x98100058`), and slots are tagged by pc alone, so every remap drops the slots of all window pcs (`windowRemapped`). [P5; analogs 6, 9]

An instruction with a byte on readable MMIO (a lab-stub allow range) gets no slot: it runs through `step()` each time, its bytes read through the device (P5 runs F0-FE prefix forms on the last byte of RAM before a readable lab-stub range). Only the lab stub's access log, its read presets and the debug API's MMIO trace can see code fetches: a `memory_region_ops_read` line of size 1 per byte read, the translator's reads of every byte in order, then the helper's of op, the prefix byte and the operands it decodes; at the insn limit (10.3) the translator's reads only. No check and no firmware path executes from MMIO; the debug API's trace-rule units do (`emu/test/test_debug.mjs` traceRuleUnits, 2026-10-29). [P5; analog 8]

### 10.3 insns and insn-limit

With limit N, N instructions complete, then instruction N+1 faults with code 7 at its own pc, and `insns` reads N+1; every instruction that faults after its bytes were fetched counts. A code-fetch fault does not count and comes before the limit test, as fault 2 at the instruction's pc: with limit 1000 and `insns` preset to 998, `mov 0x40000,a0; jmp (a0)` stops with fault 2 at pc 0x40000 and `insns` 1000, in the default and the forced one-instruction mode alike. The fetch reads every byte of the instruction once, in order, byte 1 of a non-prefix form too, and a fault there names the first byte it cannot read (until 2026-10-29 byte 1 of a non-prefix form was left to the execution, `emu/FIDELITY-NOTES.md` 3.3); an instruction with a byte on readable MMIO is fetched through the device, as the translator fetches it (until 2026-10-29 that fetch stopped the machine with a host error). The debug API reports a stop at the limit whose fetch faults as that fault, not as the limit. `step()` counts its instruction when it completes or faults, never twice. The last 64 instructions before the limit (the near-limit zone) run in one-instruction mode (10.4). [P3, P6; analogs 3, 4]

### 10.4 Interrupt looks

The CPU looks at a pending interrupt (11.2) only at a visit: the machine's continue loop makes one before `run()` starts and whenever `run()` returns for one. `run()` returns for a visit, when a request is pending:

- after RTI and the PSW writes (`mov Dm,psw` F2 F3/F7/FB/FF, `and/or imm16,psw` FA FC/FD);
- after every instruction it runs in one-instruction mode: while the PSW write window is open (`psw_hazard`, 2.4), while `irq_wait` is set (an admitted interrupt waits for undefined flags, 11.3), in the near-limit zone (10.3), and always in the forced one-instruction mode (10.7); so the window counts executed instructions and a waiting interrupt is seen at the first boundary where it becomes acceptable;
- after an instruction that raised the request (the device access that sets the line), unless the next pc is a breakpoint;
- after an instruction that remaps the bus window (10.2);
- before and after an instruction fetched from MMIO (10.2);
- at a pc whose fetch faults, before the fault.

An arrival at a breakpoint stops without a visit; the next continue makes it, before the breakpoint check (10.6). In five cases (refusals a-e, listed in `interp.mjs`) these rules do not fix the instruction at which the look happens, and `run()` throws `TbUndecidable` instead of choosing one. A debugger write of PSW closes the PSW write window. Before M9 one-instruction mode also covered the `udf15` adjacency (`hi_ready`), removed with A-HI (`om1-udf-spec.md` row 6). [P4, P9; analog 5]

### 10.5 Restartability and bus faults

Nothing writes state before its last possible memory access: inline loads assign their register only after the load returns, and `step()` does all memory accesses of an instruction before it writes any register, PSW, MDR, HI or PC; the paths with several accesses (CALL, CALLS, MOVM, RET, RETF, the bit operations) access memory in an order that does not depend on what they wrote. So a fault leaves the registers as they were. A bus fault stops at the faulting instruction with fault 2, and that instruction counts. [P2, P5]

### 10.6 Breakpoints and debug stops

`run()` tests every pc against the breakpoint set (through a 64 K hash filter), so no run passes a breakpoint, including the pcs in the bus window under any segment. A continue at a breakpoint pc stops before any instruction, after the continue's visit; a single step ignores breakpoints and takes no interrupt. Debugger memory writes go to RAM, ROM and ROM-device RAM (MMIO is skipped) and drop the slots they overlap (10.2); debugger register writes take effect at once, and a written PSW is fully defined. [P5]

### 10.7 Machine options

- `oneInsn` (`createMachine`; the Simulator's `env.machine.oneInsn`, `emu/src/lab/sim.mjs`, from a check's `OM_MACHINE=oneInsn=1`): every instruction runs in one-instruction mode, with a visit after each. P6 runs the fixed run (check_menu `--quick`) with it as the reference (stdout, register digest, and the sha256 of every session's composite as check_menu drew it, `OM_COMPOSITES`); P9 and P10b compare with it too.
- `mutant` (`createMachine`; the Simulator's `env.machine.mutant`, from a check's `OM_MACHINE=mutant=N`): deliberate faults for the negative controls, never set outside the checks. check_perf P8 checks that each of the interpreter's analogs makes its groups fail: 1 SUB/CMP carry with unsigned `<=`; 2 Bcc/Lcc inline without the undefined-flag test; 3 an inline branch not counted; 4 no near-limit zone; 5 one-instruction mode ignored for the PSW window and `irq_wait`; 6 window slots kept at every remap; 7 ASL2 defines V and C; 8 a later instruction's crossing into the next page fetched at the decode of the run's first instruction; 9 window slots kept at a remap back to a segment shown before. 20..31 are check_irq's (section 11.5, `om1-intc-timer-spec.md`).

### 10.8 HLE stubs (PERF2)

The memset and memcpy stubs run on the harness's stub path (`emu/src/lab/hle.mjs`): a breakpoint at the stub's run-time pc stops the CPU and the harness applies the stub's effect and returns. emu has no builtins that fold them into the CPU; the machine maps the window `om1.lab-hle` at `0x89A30000` (16 KiB, romd: the debugger reads and writes it, a CPU write is an error) with the magic `HLE1` at `+0` and nothing else. check_perf P10a pins the outcome of the 22 PERF2 cases on the stub path (`emu/checks/fixtures/perf-p10a.json`), P10b runs a shortened play workload in the default, the forced one-instruction and a sliced run, which must agree, and P10c checks that the stub path's own negative controls make P10a or P10b fail.

## 11. Exceptions and interrupts (M9)

Status: `emu/src/core/cpu.mjs` (`execInterrupt`, `admits`, RTI in `step()`), `emu/src/core/interp.mjs` (the visits, 10.4), `emu/src/machine.mjs` (the continue loop; the controller's request line); the controller and its gate in `emu/src/dev/intc.mjs` (`om1-intc-timer-spec.md`). Checked by `emu/checks/check_irq.mjs` I1-I4, `check_perf.mjs` P9, `check_isa.mjs` (RTI vectors).

### 11.1 RTI (`F0 FD`)

Manual p.95: PSW = mem16[SP], PC = mem32[SP+4], SP += 8. Both loads come first (restartable, 10.5; a misaligned word faults 3 in that order: the PSW halfword needs SP even, the PC word SP + 4 aligned). A popped PSW with a reserved bit (`0xC0F0`) faults 6, as `mov Dm,PSW` does. The popped PSW is fully defined (`psw_undef` = 0) and opens no PSW write window (A-RTI-WINDOW, I: the interrupted code may sit between a flag producer and its consumer, and an interrupt must be transparent to it). The frame layout is the one the CPU pushes (11.2) and the firmware pops at `0x50017e83` (X). TRAP (`F0 FE`), `F0 C0`, `F0 FF` and the other `F0 F8..FF` encodings keep faulting 1: TRAP has no reachable site and the manual's TRAP target `0x40000010` is unmapped in the lab.

### 11.2 Acceptance (A-ACCEPT, A-ENTRY)

The CPU looks at a visit (10.4), between instructions, before the breakpoint check, and never during a debugger single step. The controller names the level L (its highest-priority presented level that its gate admits, `irq_level`). The CPU accepts iff PSW.IE = 1 and L < PSW.IM (manual p.5), no PSW write window is open (manual ch.3 2.2: IE/IM take effect late; the lab refuses inside the window rather than modelling which setting applies), and every flag is defined (a lab limit: undefinedness cannot travel through a memory frame). Entry:

1. SP must be word aligned, else fault 3 at the interrupted pc.
2. mem32[SP - 8] = PSW zero-extended, mem32[SP - 4] = PC, SP -= 8. The PSW halfword at SP - 8, the PC word and SP -= 8 agree with the manual's pop (RTI, p.95) and with the GDB 15.2 sim; the zero upper half of the PSW word is a lab choice (part of A-ENTRY): the manual defines only the pop, mem16, and the sim stores a halfword and leaves the upper half untouched (`store_half (SP - 8, PSW)` in `sim/mn10300/dv-mn103cpu.c` lines 237 (NMI) and 250 (level interrupt) at tag `gdb-15.2-release`). The upper half is never read on a modelled path: the kernel exit reads the saved PSW with `movhu (56,..)` (`0x50017df5..fa` `mov (4,sp),a0; movhu (56,a0),d0; mov d0,psw` in the tick loop, and `0x50017e64` `movhu (56,sp),d1` before `0x500136aa`; kernel spec 9.1), and RTI reads mem16. The unmodelled level-0 slot and the NMI path read the whole word (`mov (sp),d0` at `0x5000f00c` and `0x5000f16e`, stored to ROM `0x50000008`); they also read PC at `(4,sp)` (`0x5000f014`, `0x5000f176`), more evidence for the frame layout {PSW at (sp), PC at (4,sp)}.
3. PSW: IE 0, IM L, S bits and flag values kept; every flag marked undefined (the manual does not state them). One PSW read on the entry path does see undefined flags: from acceptance to `0x5000f25e` the path is the slot's `jmp`, `movm` at `0x50017d41`, `add 4,sp` at `0x50017d43` (ADD to SP leaves PSW alone), `mov imm32,a3`, `jmp`, `add -16,sp` at `0x5000f259` and `udf13 d0,d0` at `0x5000f25c`, which defines V and marks Z/N/C undefined (A-UNIT, udf spec 2a). So `mov psw,d1` at `0x5000f25e` copies Z/N/C undefined into the frame word it stores at `0x5000f260`; the restore reads back only V from that word (`0x5000f26e` `mov (sp),d0; and 8,d0`, then ORed into PSW at `0x5000f274..78`), so the undefined bits never reach a result. The model allows that copy (MOV PSW,Dn, 2.3). The other PSW reads on the entry path follow a flag producer (`cmp 0,d0` at `0x50017d67` and `0x50017d7e`).
4. u16 (0x8a00) = (16 + L) * 4 (A-IAGR).
5. PC = `0x60030000 | mem16[0x8000 + 4L]` (A-VEC); an IVAR of 0 faults 1 ("vector not initialised") with nothing pushed.

Acceptance is not an instruction: `insns` and insn-limit are unaffected. A bus fault while pushing stops with fault 2 at the interrupted pc. The accepted ring of the controller's lab window logs {level, pc, insns}.

### 11.3 Waiting requests

A request the CPU refuses stays raised, and the CPU sees it again only at a visit (10.4). Therefore the PSW writes and RTI end with a visit, the PSW write window runs in one-instruction mode, and when a request is refused only because a flag is undefined the CPU sets `irq_wait`, which keeps one-instruction mode, with a visit after every instruction, until the request is accepted or dropped (the controller dropping its line clears it). The default and the forced one-instruction mode then accept at the same instruction boundary (P9). A refusal by the gate (pc not the gate pc) or by IE/IM sets nothing, so the lab's normal runs with a line held high pay only the controller's check at each visit.

### 11.4 The gate (H-IRQGATE)

The lab accepts interrupts only where its gate admits them: mode 0 never (kernel-less labs), mode 1 only while pc is the gate pc, mode 2 anywhere (check_irq, check_perf P9). K-native labs set mode 1 at `IDLE_DONE`, the point where the idle context returns to the harness; that address always carries a harness breakpoint. An RTI returning there ends with a visit (11.3), so a further presented IRQ is accepted at once; any other arrival stops at the breakpoint, and the harness continues from it with the idle PSW (IE 1, IM 7), which accepts before the breakpoint check (`emu/src/lab/kernel.mjs` `LabTask._idle`). The reason for the gate is that CPU execution takes no lab time, so the lab does not define the instruction at which a device line is seen; on a menu session with mode 2 the OSD engine's interrupts are taken inside the GUI task at `0x5101141d` instead of at the idle point (X, check_irq harness mutant).

### 11.5 Negative controls (mutant)

20 RTI pops PC and PSW swapped (I1); 21 acceptance ignores IM (I2); 22 the vector ignores IVAR (I2); 23 the controller picks the highest level number (I3); 24 RTI opens a PSW write window (I3); 25 udf21 swaps Dm and Dn (I5); 26 udf13 leaves V undefined (I5); 27 the controller presents the highest IRQ first (I6); 28 timer period = reload (I7); 29 timer status writes ignored (I7).
