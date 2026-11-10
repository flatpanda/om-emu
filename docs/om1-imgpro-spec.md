# OM-1 imgpro unit at 0x9c600000

The image library's unit 7 on E143 (v1.9): what its driver writes, what its interrupt handler reads, which request
kinds drive it, and what the lab's model (`emu/src/dev/imgpro.mjs`, S-IMGPRO) computes. Addresses are E143's, in the
disassembly notation (body offset + `0x50000000`). Evidence tags: D (disassembly read), X (executed or measured in the
lab), I (inference), ? (unknown). The round that read it: `docs/hle-gaps.md` 4.3.1 (2026-11-09).

## 1. Where it sits

- **The unit's index is 7 (D).** The library keeps a record per unit and CPU (`0x50481790(unit)`: the table
  `0x6065ff68`[core] + 52 x unit); the starts register the request's callback in unit 7's record through
  `0x50483474(7, ...)` and the interrupt handler reads unit 7's record. The only pointer to the unit's end function
  (below) is the word at run-time `0x6065ff90` (D).
- **Request kinds (D).** The request's kind is the byte at its +16; the dispatch `0x5046d814` calls the handler the
  table `0x6065a834` gives: kinds 13, 14, 16 and 17 go to `0x5046daa2`, kind 6 to `0x5046dc32` (the others to
  `0x5046d994` and handlers of their own, not read). Each start below has one call site and the go two, all in these
  two handlers (D: a scan of every `call` in the block). `0x5046daa2` allocates the request's id (`0x5048ba51`, the
  bitmap `0xa32edfcc`, udf07 at `0x5048ba86`), calls the request's callback with phases 1 and 4, starts the kind (13
  `0x5050a73c`, 14 `0x5050a797`, 16 `0x5050a7f2`, 17 `0x5050a85d`), calls phase 5, the go `0x5050a8ba` and phase 6,
  and returns 0 (`0x9e01` when a phase refuses, `0x9e02` without an id). Kind 6's handler starts it with `0x5050a6dd`
  and the same go (`0x5046dc62`, `0x5046dc89`).
- **The issue and its wait (D, X).** A request is issued through `0x50493824` (59 call sites in the library); its
  wait `0x50493617` waits up to 1000 ms (`0x5049362a`: `0x5048e410(1000)`) and then runs the kind's end through
  `0x5046d7cb`. X: with no end raised the end ran 999.3 ms of lab time after the go; with the end raised it ran at once.
- **The init (D).** The library's init `0x5046d7ab`, which USTART2's boot stage calls (`0x501e91d8`), runs the IRQ
  attach `0x5048c3a0`, the id bitmap's clear `0x5048ba3a`, the units' init `0x50481211` (which calls this unit's own
  init `0x5050a6b2` at `0x50481322`, among the inits of the unit at `0x9c200000` and others) and `0x5048d57f`.
- **The interrupt (D).** `0x5048c3a0` attaches the library's 15 IRQs (282, 283, 288..292, 296..302), each on CPUs 0..3
  through `0x50053fcd` and then disabled there through `0x5005401d`; IRQ 300 with the handler `0x5048bfe3` at level 4
  (`0x5048c728..0x5048c799`). The go enables IRQ 300 on the calling core (`0x50053ff6(300)`); the end disables it
  (`0x50054004(300)`, `0x5050a92e`). The attach is exclusive and the enable writes back the attach's shadow level
  (`docs/om1-cores-spec.md` 4), so without the attach the enable writes level 0 (X: the end was never taken).

## 2. The driver's sequence (D)

| Step | Function | Writes (in order), reads |
|---|---|---|
| init | `0x5050a6b2` | `+0x004` = 1, `+0x030` = 1, (`0x500640d4`), `+0x070` = 1, (`0x500640de`), `+0x000` = 1 |
| a kind's start | `0x5050a6dd`, `0x5050a73c`, `0x5050a797`, `0x5050a7f2`, `0x5050a85d` | lock 258 (`0x50507399`), clock gate `0x98800344` = `0x4000` (`0x5048022b`), `+0x004` = 1, gate `0x98800364` = `0x20` (`0x50480243`), `+0x040` = 1, `+0x048` = 1, `+0x074` = 1; then the kind's set-up (section 4); then `0x50483474(7, ...)` |
| go | `0x5050a8ba` | enable IRQ 300; `+0x028` = 1, `+0x020` = 1, `+0x00c` = 1, `+0x018` = 1 |
| interrupt | `0x5048bfe3` | reads `+0x020` and `+0x028`, writes their and back to `+0x020`; reads `+0x108` and `+0x380`: for op 3 with mode 0 and a chained segment left (the context `0xa32f12e0`, `0x5050b547`) writes `+0x008` = 1, `+0x080`, `+0x084`, `+0x384`, `+0x390` from the context, `+0x00c` = 1, `+0x018` = 1; else `+0x028` = 0 and, when the and was not 0, reads `+0x3b0` into the request's result word if one is set (kind 16) and calls unit 7's callback with phase 12 |
| end | `0x5050a8e1` | `+0x028` = 1, `+0x008` = 1, `+0x070` = 1, `+0x04c` = 1, `+0x044` = 1, gate `0x988003b4` = `0x20`, `+0x000` = 1 and reads it back, gate `0x98800394` = `0x4000`, disables IRQ 300, frees lock 258 |

## 3. Register map

| Offset | Written by | Read by | Meaning |
|---|---|---|---|
| `+0x000` | init (last), end | end (read back) | I: power-down / reset, the pair of `+0x004` |
| `+0x004` | init (first), every start | - | I: power-up / reset release |
| `+0x008` | end, the chained restart | - | I: stop |
| `+0x00c`, `+0x018` | go, the chained restart (1, in this order) | - | I: the start |
| `+0x020` | go (1), handler (the status and enable) | handler | status: bit 0 a run's end (I: write 1 to clear, from the handler's write-back) |
| `+0x028` | go (1), handler (0), end (1) | handler | interrupt enable, bit 0 |
| `+0x030`, `+0x040`, `+0x044`, `+0x048`, `+0x04c`, `+0x070`, `+0x074` | init, starts, end (1) | - | I: set and clear pairs (`+0x040` / `+0x044`, `+0x048` / `+0x04c`, `+0x074` / `+0x070`) of clock or power controls |
| `+0x080..+0x094` | set-ups | - | addresses >> 4: `+0x080` source, `+0x084` destination, `+0x088`, `+0x08c` a second plane's (kind 17), `+0x090`, `+0x094` (kind 6) |
| `+0x0b4..+0x0c8` | set-ups | - | pitches >> 4, by the same planes |
| `+0x0fc` | kind 6 | - | ? |
| `+0x108` | set-ups (kind 6: 0..3; 13, 14, 16, 17: 3) | handler | the operation |
| `+0x380` | set-ups | handler | the mode: 0 kind 13's linear copy, 1..3 its other copies, 4 and 5 kind 14's fills, 8 kind 16 |
| `+0x384` | set-ups | - | a count in bytes (linear copy and fill, kind 16) |
| `+0x388`, `+0x38c` | kind 13 (modes 2, 3) | - | ? |
| `+0x390` | set-ups | - | the low 7 bits of the address(es) (linear modes), or the column in bytes (rectangle modes) |
| `+0x394` | set-ups | - | width in bytes \| rows << 16 |
| `+0x398` | kind 14 | - | the fill's 32-bit value |
| `+0x39c` | kind 14, mode 5 | - | 0 |
| `+0x3a0..+0x3a8` | kind 17 | - | the scale factors (source size << 12 / destination size, per axis) and phase offsets |
| `+0x3ac` | kind 16 | - | kind 16's parameter (the request's +32) |
| `+0x3b0` | - | handler | kind 16's result |

Every operand of the driver (`0x5050a6b2..0x5050b547`) and the handler lies in `+0x000..+0x3b0` (the firmware map's
MMIO list, D); no base-register access to the unit was found in them.

## 4. The set-ups

- **Kind 14, the fill (`0x5050b118`, D).** `+0x108` = 3, `+0x398` = the request's +28 (the value). With an image at the
  request's +32 (mode 5, the rectangle): `+0x084` = (image +0) >> 4 + (pitch * y * 2) >> 4, `+0x0b8` = (pitch * 2) >> 4,
  `+0x380` = 5, `+0x390` = x * 2, `+0x394` = w * 2 | h << 16, `+0x39c` = 0, where pitch, w, h, x and y are the image's
  halfwords +10, +12, +14, +16 and +18 (pixels of 2 bytes). Without one (mode 4, linear): `+0x084` = (+20) >> 4,
  `+0x380` = 4, `+0x384` = the request's +24, `+0x390` = (+20) & 127.
- **Who fills (D, X).** `0x5048ee61(count, value, dst)` is a memset on the unit: for a start less than 64 into its
  128-byte line one linear request; otherwise a linear request for the 128-aligned rest and a one-row rectangle for the
  head (pitch 64 pixels, x and w from the start's offset, halved). `0x5048ef28(R, G, B, image)` converts the colour
  (Y = (19595 R + 38470 G + 7471 B) >> 16 and the two colour differences around 128) and calls `0x5048ef01`, which for
  the image formats 3074 and 3330 (the image's halfword +8) builds kind 14 with the value Y | Cb << 8 | Y << 16 |
  Cr << 24 for 3074 (`0x50490c89..a4`). The menu's fill (X) comes from api_tft's `0x504223a4` (call `0x504225c5`) with
  R = G = B = 11: the value `0x800b800b`, the through image's bank at bus `0x98d4d800`, 600 rows of 1800 bytes at a
  pitch of 11136.
- **Kind 13, the copy (`0x5050af26`, D, not modelled).** `+0x108` = 3; by the request's byte +32: 0 a linear copy
  (`+0x080` source, `+0x084` destination, `+0x380` = 0, `+0x390` = both low 7 bits, `+0x384` the count; under a
  condition on the ends' low bits, `0x5050af85..afec`, not read in detail, split into two segments, the second kept in
  the context `0xa32f12e0` and started by the handler), 1 a rectangle copy (`+0x380` = 1), 2 and 3 modes 2 and 3
  with `+0x384..+0x38c`.
- **Kind 16 (`0x5050b1b8`, D, not modelled).** `+0x108` = 3, `+0x080` = (+20) >> 4, `+0x380` = 8, `+0x384` = +28,
  `+0x390` = (+20) & 127, `+0x3ac` = +32; the start sets unit 7's record +40 to the request's +24, where the handler
  stores `+0x3b0`. What mode 8 computes is ?.
- **Kind 17 (`0x5050b1f5`, D, not modelled).** Two images: the source's and destination's addresses, pitches, sizes, the
  scale factors in 12-bit fixed point and the source's phase; for the source format 3079 also the second planes
  (`+0x084`, `+0x08c`, their pitches `+0x0b8`, `+0x0c0`). A scaler (I, from the factors); its filter is ?.
- **Kind 6 (`0x5050b328`, D, not modelled).** `+0x108` = 0..3 with up to three planes' addresses and pitches and two
  register blocks of 776 and 940 bytes (not read further).

## 5. The lab's model (S-IMGPRO, A-IMGPRO-1)

The register file above, with the behaviour the driver relies on: storage for the words the driver writes, a bus error
for any other address, a width other than 4, an unaligned access and a debugger write; the status write 1 to clear;
IRQ 300 high while status bit 0 and the enable are set; a run started by `+0x00c` then `+0x018` written 1 while the
unit is powered up (`+0x004` written after `+0x000`). Of the runs only op 3's modes 4 and 5 are computed, from the words
written since the last start (each word kind 14's set-up writes for the mode must have been written): the destination
range as section 4 gives it, on the bus's memory (`emu/src/dev/bus.mjs`: the DRAM at `0xa0000000` and the live-view
banks), the value as a little-endian 32-bit word at 4-byte aligned addresses (I; the firmware composes it per pixel
pair). A range off a 4-byte boundary is refused unless the value's four bytes are equal (where the word's phase starts
is not read), and so are every other op or mode, `+0x39c` other than 0, inconsistent `+0x084` / `+0x390` of a linear
fill, rows longer than their pitch, a start while one runs and a read of `+0x3b0`. A-IMGPRO-1: the bytes are written
and the end raised 1 ms of lab time after the start (the unit's real time is ?; the wait allows 1000 ms).

## 6. Open

- The meaning of `+0x000` / `+0x004`, `+0x008` and the set and clear pairs (I); whether the start is `+0x00c`, `+0x018`
  or the pair (I: the pair, both always written together).
- The fill value's phase at an address off a 4-byte boundary, and whether the unit fills by words or pixels (?).
- Kinds 13, 16, 17 and 6: their pixel operations (copy modes 1..3, mode 8, the scaler's filter) are not modelled; the
  chained linear copy's second segment is read (D) but not modelled.
- The unit's time per run (A-IMGPRO-1).
