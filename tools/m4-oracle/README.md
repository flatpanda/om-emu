# Cortex-M4 oracle

A development-only check of emu's pure-JS Cortex-M4 core (`emu/src/core/m4/`, the SCPU's CPU,
`docs/om1-scpu-spec.md` section 8 steps 3-4) against QEMU's Cortex-M4. QEMU runs inside the throwaway `om-emu` VM
only, and only on code this directory generates: never the SCPU firmware. Nothing here ships in `emu/`, and no QEMU
code is copied: the gdbstub client is written from GDB's protocol documentation.

| File | What it does |
|---|---|
| `rsp.mjs` | a minimal GDB remote-protocol client (packets, no-ack mode, continue with a timeout, memory and registers) |
| `gen.mjs` | the case generator: random Thumb / Thumb-2 sequences of 1-5 instructions that the JS decoder accepts, half of them drawn per encoding so every encoding gets cases, branch offsets fixed up to land inside the sequence, IT-block placement rules kept |
| `oracle.mjs` | runs each case on the JS core and on `qemu-system-arm -M mps2-an386` through its gdbstub and compares the end states; `--record FILE` writes QEMU's results as `emu/test/fixtures/m4_vectors.json` |
| `objcheck.mjs` | the decoder against GNU objdump on an image's code: lengths and mnemonics of every instruction the census reaches |

The case layout, the initial state (a function of the case's seed) and the JS side are `emu/test/m4cases.mjs`, shared
with `emu/test/test_m4.mjs`, which replays the recorded vectors without QEMU.

## Running (inside the VM)

```sh
orb -m om-emu sudo pacman -S --needed qemu-system-arm          # once
orb -m om-emu node tools/m4-oracle/oracle.mjs --cases 20000 --seed 1
orb -m om-emu node tools/m4-oracle/oracle.mjs --case 4711      # one case's two end states in full
orb -m om-emu node tools/m4-oracle/oracle.mjs --cases 3000 --seed 900001 --record emu/test/fixtures/m4_vectors.json
orb -m om-emu node tools/m4-oracle/objcheck.mjs unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk0e560000.OE.0107.bin --scratch DIR
```

Per case, QEMU is reset (`system_reset` over the stub), the case's code and the 8 KiB data window are written, a small
MSR prologue sets MSP, PSP, BASEPRI, PRIMASK and CONTROL (QEMU 11.1's stub accepts writes to those registers but
ignores them), the registers, S0..S31 and FPSCR are written, and the case runs to its end or to an exception's stub.
Compared: r0..r15, xPSR, MSP, PSP, PRIMASK, BASEPRI, FAULTMASK, CONTROL, S0..S31, FPSCR, CFSR, HFSR and the window's
bytes (exception frames included). A case the JS core runs outside the layout (an access outside the window, a
branch out of the sequence, more than 64 steps) is dropped before QEMU sees it.

## What the generator leaves out, and why

- UNPREDICTABLE encodings and placements (the decoder's `unp`; an IT block's rules): the two engines may differ
  legitimately. Should-be-one / should-be-zero bits count: QEMU raises UNDEFINED for most of them.
- WFI / WFE (QEMU would wait), BKPT (a debug stop in the stub), FP data processing (not implemented in the core), LDR
  into pc (UNPREDICTABLE on an unaligned address, which the generator cannot see).
- Six places where QEMU 11.1.2 departs from the ARMv7-M ARM and the core follows the manual: a coprocessor other
  than cp10 / cp11 (QEMU: UsageFault UNDEFINSTR; the manual and the Cortex-M4 user guide: NOCP), the UNDEFINED
  encodings of the coprocessor space (QEMU answers NOCP or UNDEFINSTR by coprocessor and CPACR), the exclusive space's
  op3 values ARMv7-M leaves UNDEFINED (QEMU runs them as the A profile's STREXD / LDREXD), SETEND (likewise
  UNDEFINED on ARMv7-M; QEMU runs it), BX pc from a halfword-aligned address (QEMU: UsageFault UNALIGNED; the
  manual's BXWritePC clears T and the next fetch raises INVSTATE), and LDRH / LDRSH
  with Rt = pc (the manual: an unallocated memory hint, a NOP; QEMU loads into pc). STREX comes first in its case, with an
  aligned address: with the monitor clear QEMU skips the alignment check of the manual's ExclusiveMonitorsPass.
