> Status (2026-10): rows marked IMPLEMENT are implemented in `emu/src/core/cpu.mjs` (`step()`; the float unit in `udfFloat`, `udfFloatToInt` and `udfCompare`); every other UDF form faults with code 1. One addition to this spec: the UDF integer and float operations keep the PSW value but mark V/C/N/Z undefined (udf06 excepted; udf13 defines V and udf20 leaves PSW alone, section 2a), so a flag consumer that reads them faults with code 6. The analysis scripts are not published; `emu/checks/check_isa.mjs` replays the regression vectors and firmware functions of section 5. M9 (2026-10): rows 6, 15 and 16 are IMPLEMENT under the labels A-HI and A-UNIT (section 2a): udf15 reads HI at any site, and udf12/13/20/21 are a closed round trip of unit state, which the kernel's interrupt context save/restore and its self-test run natively. Independent tests: `emu/checks/check_irq.mjs` I5, the check_isa vectors.

# OM-1 UDF semantics: final spec

A reconciliation of two independent investigations, one from firmware context and one from
documentation and tools, plus a re-check by separate scripts (not published). Firmware = E143
v1.9 main block, disasm base 0x50000000. "Reachable" = statically reachable in that block (the
reachable set, ISA spec section 0, source F).

Rule: a row marked IMPLEMENT has strong evidence: execution against independently known
answers, or several independent sources that agree. Everything else faults with code 1
(MN_FAULT_OPCODE). Where a row leaves a hardware detail unknown,
the spec says either "fault" or why that detail cannot be observed by any reachable
consumer.

## 0. Decoding and lengths (documented, HIGH)

From the ISA manual's opcode maps. Every second byte under prefixes
F5, F6, F9, FB and FD is a UDF; no other base instruction uses these prefixes.

| Prefix | Form | Length | Fields of byte 2 |
|---|---|---|---|
| F6 | udfNN Dm,Dn (NN=00-15) | 2 | NN=b>>4, m=(b>>2)&3, n=b&3 |
| F5 | udf(20+NN) Dm,Dn | 2 | same |
| F9 | imm8 | 3 | NN=b>>4, tt=(b>>2)&3, n=b&3 |
| FB | imm16 (little endian) | 4 | same |
| FD | imm32 | 6 | same |

For immediate forms, tt=00 is udfNN (imm8/imm16 sign-extended), tt=01 is udfuNN
(imm8/imm16 zero-extended), tt=10 is udf(20+NN) and tt=11 is udfu(20+NN). Sign versus zero
extension follows the manual's summary table (the p.99 prose says "zero-extended" for
UDFnn, which is wrong) and binutils m10300-opc.c (SIMM for udf, IMM for udfu). GDB 15.2's
simulator sign-extends udfu01 imm8/imm16; that is a simulator bug.

**Length table** (`insnLength`): F5 and F6 = 2, F9 = 3, FB = 4, FD = 6 for all second
bytes, including forms that fault, so that code invalidation (ISA spec 10.2) covers every byte.

## 1. Spec table

| # | Form (encoding) | Reachable sites | Verdict | Semantics |
|---|---|---|---|---|
| 1 | udf00 Dm,Dn (F6 0x) | 4734 (93 with Dm==Dn) | **IMPLEMENT** | p = (int64)(int32)Dn * (int64)(int32)Dm; Dn = (uint32)p; HI = (uint32)(p>>32) (before M9 also HI_READY = true). Dm unchanged. PSW unchanged. MDR unchanged. |
| 2 | udf00 imm8 (F9 0[00nn] i8), imm16 (FB 0[00nn] i16) | 1516 / 870 | **IMPLEMENT** | Dn = (uint32)(Dn * sext(imm)). PSW and MDR unchanged. HI not written (A-HI: whether the hardware writes it is unknown and unobservable). |
| 3 | udf00 imm32 (FD 0[00nn] i32) | 44 | **IMPLEMENT** | Dn = (uint32)(Dn * imm32). Same as row 2. |
| 4 | udf01 Dm,Dn (F6 1x) | 1038 | **IMPLEMENT** | Dn = (uint32)(Dn * Dm). PSW and MDR unchanged. HI not written. |
| 5 | udfu01 imm8/16/32 (F9/FB/FD 1[01nn]) | 3166 / 798 / 37 | **IMPLEMENT** | Dn = (uint32)(Dn * zext(imm)). PSW and MDR unchanged. HI not written. |
| 6 | udf15 Dn,Dn (F6 F[nn nn]) | 3 | **IMPLEMENT** (M9, A-HI) | If m==n: Dn = HI at any site (before M9 only right after udf00 Dm,Dn). m != n faults. Flags marked undefined. MDR unchanged. |
| 7 | udf02 Dm,Dn (F6 2x) | 1 (fadd stub 0x5002b168) | **IMPLEMENT** | Dn = f32(Dn + Dm), binary32 round-to-nearest-even. Fault conditions in section 3. PSW and MDR unchanged. |
| 8 | udf03 Dm,Dn (F6 3x) | 1 (fsub stub 0x5002b161) | **IMPLEMENT** | Dn = f32(Dn - Dm). Same rules. |
| 9 | udf04 Dm,Dn (F6 4x) | 1 (fmul stub 0x5002b18d) | **IMPLEMENT** | Dn = f32(Dn * Dm). Same rules. |
| 10 | udf05 Dm,Dn (F6 5x) | 1 (fdiv stub 0x5002b17b) | **IMPLEMENT** | Dn = f32(Dn / Dm). Same rules, and fault when Dm is ±0. |
| 11 | udf06 Dm,Dn (F6 6x) | 7 (compare stubs 0x5002b16f-0x5002b31e) | **IMPLEMENT** | Float compare of Dm against Dn: PSW = (PSW & ~0xF) \| (Dm == Dn ? Z : 0) \| (Dm < Dn ? N : 0); V = 0, C = 0. Dn and MDR unchanged. Fault on NaN, ±Inf or subnormal operands. ±0 compare equal. |
| 12 | udf14 imm8 64 (F9 E0+n, 0x40 exactly) | 4 | **IMPLEMENT** | Dn = f32((int32)Dn), round-to-nearest-even. PSW and MDR unchanged. |
| 13 | udf14 imm16 128 (FB E0+n, 0x80 0x00 exactly) | 4 | **IMPLEMENT** | Dn = (int32)trunc(float Dn), toward zero. ±0 and subnormal give 0. A finite x ≥ 2^31 gives 0x7fffffff. Fault on NaN, ±Inf, or finite x < -2^31. PSW and MDR unchanged. |
| 14 | udf07 Dm,Dn (F6 7x) | 1 (0x5050a089) | DO-NOT-IMPLEMENT | Some kind of bit search with C as the found/not-found flag. Direction and Dn semantics unknown. |
| 15 | udf12, udf13 (F6 Cx, F6 Dx, m == n) | 1 each (context save 0x5000f25c, 0x5000f264; self-test 0x50012691) | **IMPLEMENT** (M9, A-UNIT) | udf12 Dn,Dn: Dn = unit C, flags undefined. udf13 Dn,Dn: Dn = unit D, V = unit bit (defined), C/N/Z undefined. m != n faults. |
| 16 | udf20 (F5 0x, m == n), udf21 (F5 1x) | restore 0x5000f282 / 0x5000f27e; self-test | **IMPLEMENT** (M9, A-UNIT, A-HI) | udf20 Dn,Dn: HI = Dn. udf21 Dm,Dn: reads V as a flag consumer (fault 6 inside the PSW window or when V is undefined), then unit C = Dm, unit D = Dn, unit bit = V. Neither writes a register. udf20 leaves PSW alone (the GDB 15.2 sim's `putx`, the AM30 name of F500, only sets MDRQ); udf21's flag effect is unknown (no AM30 form of F5 1x in the sim or binutils), so its flags keep their values and are marked undefined. |
| 17 | Everything else | 0 | DO-NOT-IMPLEMENT | udf08-11; udf12/13/15/20 with m != n; udf14 in register form or with any other immediate or width; udf00/udf01 in any other tt; udfu00; udfu02-15; every other F5 form; tt=10/11. |

Before M9 "HI_READY" (a CPU-state boolean, not architectural) restricted row 6; see section 2, row 6, and section 2a.

## 2. Evidence and resolved conflicts

### Rows 1-5: integer multiply, low 32 bits

- **Execution.** Real firmware was run on an emulator copy in which the host computed the UDFs.
  The re-check ran every test again and all pass. Expected values come from outside the
  firmware.
  - timegm 0x5012bf16 (udfu01 imm8/16/32): 9/9, including 2^31 and 2099-12-31.
  - atoi 0x51010a1f / 0x5101a2d0 (udf00 imm8 10 and -1): 20/20. The control that
    zero-extends the udf00 immediate fails exactly the 6 negative cases.
  - UTF-16 decimal and hex parsers 0x510c265b / 0x510c26af (udf00 Dm,Dn): 18/18.
  - roundup 0x516ca634 and alpha premultiply 0x5178074b (udf01 Dm,Dn): 18/18.
  - Date-string fragment 0x5180f24b (udf00 imm16 1000, imm8 100/10): 4/4.
  - The add and 16x16 controls fail.
- **Documentation.** The binutils AM30 "extended instructions" (1996) name exactly these
  encodings: mulq = F60x / F90x / FB0x / FD0x, and mulqu = F61x / F914 / FB14 / FD14.
  The firmware uses exactly that encoding split. Signed immediates appear only in the
  udf00 slot and unsigned only in the udfu01 slot.
- **Immediate extension.** Minimal encoding follows the extension rule exactly:
  - udf00 values 128..255 always use imm16 (217 sites); 32768..65535 always use imm32 (35).
  - udfu01 values 128..255 use imm8 (210); 32768..65535 use imm16 (16).
- **Signedness of the low word.** It does not matter: the low 32 bits of the product are
  the same for a signed and an unsigned multiply. Signedness only affects HI and how the
  immediate is extended.
- **MDR unchanged: HIGH, re-checked.**
  - 0x5012c217: `ext d0` → `add -2,d2` → `udf00 3059,d2` (0x5012c21b) → `div d1,d0`
    consumes MDR.
  - 0x50168823: `mov d0,mdr` → `udf00 d0,d1` → `divu d1,d2`.
  - The firmware investigation counted 73 such places. The GDB simulator writes MDRQ, a register
    separate from MDR.
- **PSW unchanged.** The manual says the flags are "user defined"; the GDB simulator sets
  Z and N and clears C and V. That flag behaviour is not adopted, for two reasons:
  - This unit is not the AM30 unit. udf04 and udf05 are float operations here, where the
    AM30 set has sat16 and sat24, and udf07's flag polarity contradicts AM30/AM33 bsch.
  - It cannot be observed. A path walk from all 12,198 reached udf00/udf01/udfu01 sites
    always reaches a full flag setter, or a call/ret, before any flag reader.

  Leaving PSW unchanged follows the base ISA's precedent (ISA spec 2.3: an undefined flag
  keeps its previous value). A flag-poison mechanism is not required.

### Row 6: udf15 / HI

- **Execution.** X5 runs FixMul16 0x5048367b (`udf00 d1,d0; udf15 d1,d1; lsr; asl; or`)
  and MulDiv 0x5048368a (`udf00 d1,d0; udf15 d1,d1; mov d1,mdr; div`).
  - Signed high word: 10/10, including negative operands and products ≥ 2^32.
  - Unsigned high word: 7/10.
- **Documentation.** binutils getx = F6Fx with a DN01 operand (Dm field == Dn field).
  The simulator does Dn = MDRQ.
- **Conflict.** The documentation investigation says every mulq/mulqu form writes MDRQ
  (simulator); the firmware investigation verified only udf00 Dm,Dn.
- **Resolution.** Reachable udf15 sites are only:
  - the two above, each **immediately** after udf00 Dm,Dn;
  - the interrupt context save 0x5000f268, which runs right after udf13/udf12 and therefore faulted first before M9 (M9 implements both, section 2a).

  So the pre-M9 model held only what was verified (M9 replaced the adjacency rule with A-HI, section 2a):
  - udf00 Dm,Dn set HI to the high word and set a ready bit, which every other
    instruction cleared;
  - udf15 faulted unless m == n and the ready bit was set;
  - HI is not written by the immediate forms or by udf01; it is unknown whether the
    hardware writes it there;
  - reset cleared the ready bit.
- **Flags after udf15.** Unknown, and unobservable: lsr and div follow.

### 2a. M9: the unit state (A-UNIT, A-HI)

The kernel's interrupt context save `0x5000f259` and restore `0x5000f26e` are the only reachable users of rows 15 and 16, plus the boot self-test `0x50012691`:

```
save    add -16,sp; udf13 d0,d0; mov psw,d1; mov d1,(sp); mov d0,(4,sp); udf12 d0,d0; mov d0,(8,sp);
        udf15 d0,d0; mov d0,(12,sp); jmp (a3)
restore mov (sp),d0; and 8,d0; nop; mov psw,d1; or d0,d1; mov d1,psw; mov (4,sp),d1; mov (8,sp),d0;
        udf21 d0,d1; mov (12,sp),d0; udf20 d0,d0; add 16,sp; jmp (a3)
```

The save stores {PSW after udf13, udf13's word, udf12's word, udf15's word}; the restore ORs the saved V back into PSW, then hands udf21 the udf12 word as Dm and the udf13 word as Dn, and udf20 the udf15 word. udf21 is the third instruction after `mov d1,psw` (`0x5000f278`), just outside the two-instruction window. The self-test sets d2/d3/a2/a3 sentinels, runs save then restore and compares (`break(-112)` on a mismatch).

| Label | Statement | Evidence |
|---|---|---|
| A-UNIT | the unit holds two words C, D and a bit V: udf21 Dm,Dn writes C = Dm, D = Dn, V = PSW.V and leaves every flag undefined (values kept); udf12 reads C, udf13 reads D and sets PSW.V; reset 0 | D: the save/restore round trip above, which these are the only definitions to close (names from binutils getchx/getclx and the sim); X: the self-test passes (95 instructions) and every native interrupt round trip in the lab restores the interrupted registers (check_irq I3/I4); the hardware meaning of C, D and V is ?; udf21's flag effect is ? and unobservable on the firmware (the restore's next flag-relevant instruction is `rti` at `0x50017e83`, after `udf20`, `add 16,sp`, `jmp (a3)`, `add -4,sp`, `movm`; the self-test returns to `cmp` at `0x500126ea` and to `mov sp,a0; cmp a2,a0` at `0x5001274f`) |
| A-HI | udf15 Dn,Dn reads HI at every site; udf20 Dn,Dn writes HI and nothing else | D: udf20 is binutils `putx` (F500, DN01, AM30), whose GDB 15.2 sim body (`mn10300.igen`, "putx") is `State.regs[REG_MDRQ] = State.regs[REG_D0 + DN0];` and touches no flag; the three reachable udf15 sites are `0x5048367d` and `0x5048368c` (each right after udf00 Dm,Dn, unchanged results) and `0x5000f268` (its word only feeds udf20); whether udf00 imm, udf01 and udfu01 write HI stays unknown and no reachable udf15 can observe it (a udf15 after them reads the last udf00 Dm,Dn or udf20 value) |

Tests (check_irq I5, `emu/checks/check_irq.mjs`, written from the udf investigation): T1 round trip udf21/udf20 -> udf13/udf12/udf15 with V both ways and the flag values after udf21/udf20 unchanged; T1b udf21 at distance 0, 1, 2 after `mov d3,psw` (fault 6 inside the window); T1c udf21 after udf01 (V undefined, fault 6); T1d `bvc` after udf21 faults 6 (flags undefined) and after udf20 does not; T2 HI across the firmware's own save/restore with HI and the unit clobbered in between, 16 products against the exact signed 64-bit product; T3 the self-test natively. check_isa: 39 vectors changed from must-fault to these values (udf12/13/20/21 encodings and the udf15 cases, each with a random input unit state set through the lab registers 16..19) plus 11 unit sequences.

### Rows 7-13: single-precision float unit

The documentation investigation found no documentation and recommended faulting. The
re-check overrules that on execution evidence.

- **Structure.**
  - 0x5002b0c4-0x5002b330 is the compiler's soft-float runtime with the UDF unit as the
    fast path. Each of fsub, fadd, fdiv and fmul is
    `udfNN d1,d0; mov d0,d1; add d1,d1; retf`.
  - Conversions are udf14 64 / 128 with exth/exthu wrappers. The compare stubs are
    `udf06 d0,d1` followed by retf or bcs.
  - The stubs end in `retf`, which jumps to MDR. Every float op therefore preserves MDR.
    This is proven by execution: thousands of these ops returned correctly.
- **Execution, re-check.** A function probe identified the firmware's
  libm entry points:

  | Function | Address |
  |---|---|
  | sqrtf | 0x50028104 |
  | logf | 0x50027b89 |
  | expf | 0x50027ef7 |
  | powf | 0x50027d8a |
  | sinf | 0x50027fdc |
  | cosf | 0x50027b2a |
  | tanf | 0x5002816a |
  | atanf | 0x500279df |
  | atan2f | 0x50027a93 |

  With the float UDFs computed per rows 7-13, all nine match double-precision reference
  functions on 60 random inputs each. Max error with round-to-nearest-even:

  | Function | Max error (ulp) |
  |---|---|
  | sqrtf | 0.74 |
  | logf | 1.10 |
  | expf (\|x\| ≤ 0.5) | 1.14 |
  | atanf | 1.33 |
  | atan2f | 1.40 |
  | tanf | 1.88 |
  | powf | 5.3 |
  | sinf and cosf | larger, only near their zeros |

  The firmware investigation's controls produce garbage: swapped operands for fsub/fdiv,
  fmul↔fdiv, fadd↔fsub, and a reversed compare.
- **Rounding mode, re-check.** The re-check runs the same inputs under RNE, RNA, RZ,
  RU and RD.
  - Directed modes give a systematic bias of about ±0.5 ulp: sqrtf -0.48/+0.52, logf
    -0.71/+0.84, expf -0.44/+0.45.
  - RNE gives bias ≤ 0.09 and the lowest max error.
  - Ties-away biases sqrtf and logf by +0.25/+0.29.
  - The firmware's own software path for (float)uint (0x5002b289-0x5002b2fb) rounds
    half-to-even explicitly (`add d1,d1; bcc; bne; btst 1,d0; inc`).

  Conclusion: RNE.
- **f2i truncation, re-check.** On tanf over ±1.2:
  - trunc: max 1.50 ulp
  - floor: 3345 ulp
  - round-to-nearest: 295 ulp

  The C `(int)` cast stub 0x5002b105 is a bare `udf14 128`.
- **f2i positive overflow → 0x7fffffff.** (uint)f at 0x5002b114 runs `udf14 128`, then
  takes its software path only when the result == 0x7fffffff. That path converts
  [2^31, 2^32) correctly and saturates above. It only works if the hardware returns
  0x7fffffff for finite x ≥ 2^31. No in-range result can equal 0x7fffffff, because the
  largest float below 2^31 is 2147483520.

  NaN, Inf and negative overflow are not established, so they fault.
- **i2f source is signed int32.** (float)uint at 0x5002b27e sends top-bit-set inputs to
  software (`or d0,d0; bns`) and uses `udf14 64` only for non-negative values. The
  (short) and (ushort) wrappers exth/exthu first.
- **udf06 operand order and flags.**
  - The stub `udf06 d0,d1` implements fcmp(a=d0, b=d1), and callers then test a<b with
    blt. So N^V = (Dm < Dn) and Z = (Dm == Dn).
  - Every one of the 276 reachable call sites of the 7 compare stubs branches with
    blt/bgt/ble/bge/beq/bne, so only Z and N^V are consumed.
  - The individual N and V values, and C for ordered inputs, cannot be observed. The
    spec fixes V = 0 and C = 0. C is otherwise used only by `bcs` in the >/>= stubs
    0x5002b308 and 0x5002b31c, where forcing "less" flags is harmless for ordered
    inputs.
  - The unordered (NaN) result is unknown, so NaN faults.
  - Dn after udf06 is dead: all 7 sites are inside stubs reached by call, and d1 is
    caller-clobbered.
  - ±0 equal is the C semantics, and the runtime's own zero test (`add d1,d1` → Z)
    treats -0 as zero.
- **PSW after udf02-05 and udf14.** Unchanged. Every site is followed immediately by a
  full flag setter (`add d1,d1`) or a retf whose callers do not read flags. Only the
  udf06 stubs return flags.

### Rows 14-17: keep faulting

- **udf07.**
  - The docs map it to AM30/AM33 bsch. But the only site, 0x5050a086
    (`not d0; clr d1; udf07 d0,d1; bcc +; not d1; + mov d1,d0; extbu d0; rets`), would
    return 255-idx when found and 0 when not found under AM33 semantics (C=1 = found).
  - Its callers do "if r < 32 set bit r", so AM33 polarity makes the allocator
    nonsensical. The plausible reading is C=0 = found with Dn = index.
  - Bit order (LSB- or MSB-first) cannot be fixed without ground truth.
- **udf12, udf13, udf21.** Names only (AM33 getchx/getclx; udf21 is the re-check's inference). There is a PSW interaction: the save reads PSW right after udf13, and the restore ORs back only V. Implemented in M9 as a round trip (section 2a); their hardware meaning stays unknown.
- **udf20.** See row 16 and section 2a.

## 3. Float implementation rules (rows 7-13)

`udfFloat` computes each operation of two binary32 operands in binary64 and rounds the
result once to binary32 with round-to-nearest-even (for +, -, * and / of binary32 operands
this equals a single binary32 rounding of the exact result). There is no flush to zero.

**Input check** for udf02-06 (both operands) and udf14 128: fault if the biased exponent
is 0xFF (Inf/NaN), or if the exponent is 0 and the mantissa is nonzero (subnormal), with
one exception: udf14 128 maps a subnormal input to 0. Whether the hardware flushes is
unknown, but the integer result is 0 either way.

**Result check** for udf02-05: fault on a divisor of ±0 (udf05), when the result is ±Inf
(overflow) or subnormal, and when the binary64 value before rounding is nonzero and below
the smallest normal (underflow). Inexact is normal and does not fault. Zero signs follow
IEEE (x + (-x) = +0 under RNE; the sign of a product or quotient is the XOR of the operand
signs).

**udf14 128** (`udfFloatToInt`):

```
if (x is ±0 or subnormal) Dn = 0;
else if (!finite) fault;
else if (x >= 2^31) Dn = 0x7fffffff;
else if (x < -2^31) fault;              /* -2147483648.0f itself is fine */
else Dn = (int32)trunc(x);
```

**udf14 64:** Dn = the binary32 nearest to (int32)Dn (RNE); always succeeds.

**Exact encodings only:** `F9 E0..E3 40` and `FB E0..E3 80 00`. Any other udf14 shape
faults, including F9 Ex 80 and FB Ex 40 00.

## 4. State and decoding in the CPU

The unit's state (HI, and C, D and the bit V of section 2a) sits beside the registers in
`cpu.mjs` and is cleared at reset; it is not part of the 16 debugger registers (the lab
reads and writes it as registers 16..19). `step()` decodes F6 as udfNN Dm,Dn (NN = byte 2 >> 4),
F5 as udf(20+NN) Dm,Dn, and F9/FB/FD as NN, tt and n with a 1-, 2- or 4-byte immediate:
udf00 imm (tt 0) multiplies by the sign-extended immediate, udfu01 imm (NN 1, tt 1) by the
zero-extended one, udf14 accepts only the two exact encodings below, and everything else
faults with code 1.

A fault leaves PC at the instruction, so a faulting udf15 must not have changed anything
first.

## 5. Regression vectors

check_isa (`emu/checks/check_isa.mjs`) runs these firmware functions natively, with the UDF
unit as specified, against expected values computed independently of the firmware
(`emu/refs/isafw.mjs`):

| Cases | Function(s) | UDF forms |
|---|---|---|
| timegm, 8 dates | 0x5012bf16 | udfu01 imm8/16/32 |
| atoi, 10 texts each | 0x51010a1f, 0x5101a2d0 | udf00 imm8 incl. -1 |
| roundup, alpha premultiply | 0x516ca634, 0x5178074b | udf01 Dm,Dn |
| FixMul16, MulDiv | 0x5048367b, 0x5048368a | udf00 Dm,Dn + udf15 |
| 72 libm vectors: sqrtf, sinf, cosf, tanf, atanf, logf, expf, powf, atan2f | section 2, rows 7-13 | udf02-06, udf14 |

No check in this repository runs the UTF-16 parsers 0x510c265b / 0x510c26af or the
date-string fragment 0x5180f24b of section 2.

The libm vectors (the `firmware` list of `emu/test/fixtures/isa_vectors.json`) give the
input registers and the result **bit pattern** produced under this spec (RNE, exact
rational arithmetic). A correct implementation must reproduce every result exactly.
Against the libm values the worst relative error is 9.7e-7.
