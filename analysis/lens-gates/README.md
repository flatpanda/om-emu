# OM-1 lens gates: 50 fps SH2 and focus stacking (2026-10-13)

Two OM-1 features are gated per lens: 50 fps SH2 / Pro Capture SH2, and focus stacking. This note answers one question, *can a single change open each feature to all lenses?*, and keeps "un-greys the menu" separate from "actually works".

Short answer, both features: **one site (the gate's function body, plus the block checksum refix) un-greys the menu for every lens, and no second gate was found behind it. Whether the feature then works on a lens the body does not support is untested.** Each feature also uses per-lens tuning that comes from the body table or from the lens itself: focus-drive values for 50 fps, the MAG_CNG magnification correction for stacking. A non-listed lens that does not report that data runs on a generic default (50 fps) or on zero correction (stacking). No lens was tested.

All addresses are in `unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin` (OM-1 v1.9). Code addresses are `0x50000000 + file offset`; run-time data addresses are `0x60021020 + file offset`. Tags on load-bearing claims: **X** executed/measured, **D** read from code or data, **I** inference.

Related notes: [feature gap OM-1 vs OM-1 Mark II](../feature-gap/README.md), [ND128 experiment](../nd128/README.md), [the .BIN container](../../docs/firmware-container.md).

## Verdict per feature

| Feature | Decision function | Menu unlock for all lenses | Feature functional on a non-supported lens |
|---|---|---|---|
| 50 fps SH2 / Pro Capture SH2 | `0x506ea4b1` → property 15282 | **Yes**, one site (plus checksum refix) | **Untested** — no second gate; outside the 5 ids the AF focus-drive path uses the lens's own 50 fps value if it reports one, else a generic default |
| Focus stacking | `0x508c2863` → lens byte `+0x1D133` | **Yes**, one site (plus checksum refix) | **Untested** — no second gate; the MAG_CNG correction re-reads the flag itself, so a non-listed lens gets zero magnification correction |

"One site" in both rows means the gate's own function body, not a call site, and it is one site only in the logical sense: repacking the image also needs the block tail checksum refixed (see §7).

## 1. Evidence chain, 50 fps SH2

The menu never tests a lens directly. It reads property 15282 `MODE_LENS_DRIVE_E_CONTINUE_SH2`, a three-state value: 0 = SH2 not offered (drive remapped to SH1), 1 = offered but capped at 25 fps, 2 = 50 fps allowed (D, property-name table in `blk05a00000` at `0x28e1d00`; the three values confirmed against the gate's returns and the rule engine).

The rule engine drives the user-visible behaviour off 15282 (D, decoded from the record table at `0x605e1004` with the interpreter at `0x503d30ea..31df`): settings 2035 and 2037 (SH2 / Pro Capture SH2, each allowing `{250, 500}` = 25/50 fps) each have one rule — if `15282 == 1`, map `500 → 250`; and drive 15226 rules map codes 41/43 (SH2 / Pro Capture SH2) to 40/42 (SH1) when `15282 == 0`. The reason table `0x60e4e784` maps 15282 to string 4152 "Lens not supported" (D); that this is the exact box shown for 50 fps is **I**.

Property 15282 has two writers, both carrying the same gate result (D, re-checked independently): the start-up writer `0x501e7905 → 0x5041cdfd → 0x503c4b2f(15282, ·)`, and the GUI `getLensCondition` path `0x51055b30` → vtable `+1032` mask 8 → server `0x50ae4468` → thunk `0x50ac53ea` → `0x5041cdfd`. `0x5041cdfd` is only trace logging around `call 0x506ea4b1; extbu`, and `0x506ea4b1` has exactly one caller.

The gate `0x506ea4b1` (D, re-read independently):

```
506ea4b1  copy 24-byte id table 0x60714975 to stack
506ea4ca  a2 = lens record (0x502a96b9 -> *(0xa32caa8c)); null -> return 0
506ea4d7  0x502a9b0f -> 0x502af723: L_FT_VERSION != 0x0b0a && (raw & 0x0a); else return 0
506ea4e3  add 1096,a2; btst 0x10,(a2)  -> L_REF_M bit 4 set: return 0
506ea4ed  result = 1
506ea4f3  key = b1<<24|b0<<16|b3<<8|b2  from L_ID at lens+1100
506ea516  scan table to -1 terminator; hit -> result = 2
506ea52b  else 0x502b39fa()==1 && 0x502b3e30()==1 -> result = 2
```

So an attached lens gets 2 if its ID is in the table, else 2 if it reports both capability bits, else 1 (25 fps cap). Value 0 (no lens / protocol not ready / `L_REF_M` bit 4) removes SH2 entirely. "Other lenses are capped at 25 fps" is therefore only true for lenses that clear those three return-0 conditions (D).

## 2. Evidence chain, focus stacking

The GUI greys Focus Stacking through property 1319 `MODE_FOCUS_STACKING_ENABLED_LENS`, with 1320 `MODE_FOCUS_STACKING_ONOFF` locked under it (D: reason table `0x60e4e784` row 93 maps 1319 → 4152 "Lens not supported"; constraint record #204 at `0x605e1004` holds `{1319 == 0}` for 1320). The exact engine semantics of `0x503d2cf0` ("lock" vs "force 0") are **I**.

The 1319 writer `0x5105593e` reaches the gate through vtable `0x60e38314` slot `+772` → `0x50b545e1` → `0x50ae3556` → `0x50417ba5` → (at `0x50417bc7`) wrapper `0x508c1596` → gate `0x508c2863` (D). A second, independent consumer confirms the gate is the real decision point: the property-1320 set/execute switch at `0x50ab4b49` (`cmp 1320,d0`) also reaches `0x50417ba5` (D).

The gate `0x508c2863` (D):

```
508c2863  clr d2
508c2864  call 0x502a9af9      ; exclusion list; must return 0
508c286f  call 0x502b3d83      ; must return 1  (flag reader)
508c287b  mov 1,d2             ; enabled
```

`0x502b3d83` returns 1 iff a lens record exists and `movbu (119091,a0)` = lens byte `+0x1D133` (`ENABLE.mag_cng`) == 1 (D; `0x502b3d8e` is the load instruction inside that function). The `btst 512` / `0x5099e64b` tail of the gate is debug logging and does not affect the return (D).

The flag byte `+0x1D133` is written only through setter `0x502af879` (D). Its four callers: reset to 0 (`0x502ac57e`), whitelist entry sets 1 (`0x502b0c69`), whitelist no-match sets 0 (`0x502b10a1`), lens-table parser sets 1 (`0x502b2606`). An image-wide scan for the displacement finds four independent **readers** (`0x5011b0be` dump, `0x502b3d8e` gate, `0x50120a4c` copier, `0x506ec9a6` consumer) plus that one setter write and one misaligned byte coincidence (X; there is no hidden second consumer).

The path that sets the flag is chosen at lens-init step `0x50122e1b`: if the lens reports FuncFlag[2] & 0x800 (`0x502afbac` = `0x502af9ce(2, 0x800)`), the body requests the lens's own 274-byte MAG_CNG table (cmd 0x50, page 2 item 11, parsed by `0x502b2566` into `+0x1E890`) and skips the whitelist; otherwise it runs the body whitelist `0x502b0c4d` (D).

## 3. Lens tables vs OM System's published lists

**50 fps SH2 body whitelist** — 5 entries at file `0x6f3955` (run-time `0x60714975`), `0x1019 0x1026 0x1020 0x1024 0x1033 0xffffffff` (X, bytes dumped). Names via exiftool `Olympus.pm` LensType "0 TT 10" (D for bytes, I for names):

| id | lens | published 50 fps list |
|---|---|---|
| 0x1019 | 12-40mm F2.8 PRO | yes |
| 0x1026 | 12-100mm F4 IS PRO | yes |
| 0x1020 | 40-150mm F2.8 PRO | yes |
| 0x1024 | 300mm F4 IS PRO | yes |
| 0x1033 | 150-400mm F4.5 TC1.25x IS PRO | yes |

No extra entries. The published list also names the 12-40 PRO II, which has no separate exiftool id — it either reports 0x1019 or qualifies through the lens bit (unresolved, **I**). Lenses OM added later are **not** in the table and can only qualify through the lens bit (**I**, strong): 50-200 F2.8 (0x1041, added by body firmware 1.8), and 40-150 F4 (0x1037), 100-400 II (0x1035), 150-600 (0x1040) added by lens firmware 1.1. There is no `0x1041`/`0x1037`/`0x1035`/`0x1040` compare anywhere in the image (D, search), which is why these can only be the lens-bit path.

**Focus stacking body whitelist** — 12 ids (subtype 0x10), with per-teleconverter variants, each pointing to a built-in 274-byte table in the blob at file `0x1f3d94..0x1f5632` (D):

| id | lens | tables |
|---|---|---|
| 0x12 | 60mm F2.8 Macro | 1 |
| 0x19 | 12-40mm F2.8 PRO | 1 |
| 0x20 | 40-150mm F2.8 PRO | 3 |
| 0x23 | 7-14mm F2.8 PRO | 1 |
| 0x24 | 300mm F4 IS PRO | 3 |
| 0x25 | 8mm F1.8 Fisheye PRO | 1 |
| 0x26 | 12-100mm F4 IS PRO | 1 |
| 0x27 | 30mm F3.5 Macro | 1 |
| 0x33 | 150-400mm F4.5 TC1.25x IS PRO | 6 |
| 0x34 | 12-45mm F4 PRO | 1 |
| 0x35 | 100-400mm F5-6.3 IS | 3 |
| 0x36 | 8-25mm F4 PRO | 1 |

The variant codes (5/6 = MC-14/MC-20; 8/9/10 = the 150-400's built-in TC alone or with MC-14/MC-20) are **I**. All 12 ids plus MC-14/MC-20 are on OM Digital's official list; no extra entries (X, web). Officially supported but absent from the body list — hence lens-bit path only (**I**, strong): 90mm F3.5 Macro IS PRO (0x39), 40-150 F4 PRO (0x37), 150-600 (0x40), 50-200 F2.8 (0x41). The F1.2 primes (0x28/0x29/0x30) are absent, consistent with them not being stacking lenses. An earlier note took the fcs list for position-independent or RAM data that could not be read; it was found and read.

## 4. Lens-reported capability bits

Both features have a second path keyed on bits the lens reports over the Four Thirds link, so a lens outside the body table can still qualify (D for storage, I that the bits mean what their single use implies):

- **50 fps SH2:** FuncFlag[2] & 0x2 (via `0x502b39fa`) **and** `L_PRIVATE_ID_DATA` & 0x100 at `+0x1D314`/`+119572` (via `0x502b3e30`). The body only requests `L_PRIVATE_ID_DATA` (cmd 0x50 page 2 item 1) for an Olympus/OM lens on protocol ≥ 0x120a that already set FuncFlag[2] & 0x2.
- **Focus stacking:** FuncFlag[2] & 0x800. The body then fetches and copies the lens's own MAG_CNG table.

No lens firmware version (`L_VERSION` at `+0x488`) is read on either path (D). Which real lenses actually set these bits is lens-side data and cannot be settled from the body images; the inference that the later lenses use this path is strong but untested.

## 5. Preconditions and the exclusion list

Focus stacking requires the maker bytes of `L_ID` to be 0/0 (Olympus/OM) and `L_FT_VERSION` ≥ 0x110A (lens-init step `0x50122cac`); third-party µ4/3 lenses never reach either path (D). For 50 fps the whitelist key includes the maker bytes and the bit path needs `L_PRIVATE_ID_DATA`, which is only requested for an Olympus/OM lens, so a third-party lens gets at most value 1, SH2 capped at 25 fps (D). The focus-stacking whitelist path additionally needs raw `L_FT_VERSION & 0x0A` — the `!= 0x0B0A` clause is redundant because `0x502af742` maps raw 0x0B0A to 0x1000, which already fails the ≥ 0x110A test (D).

The focus-stacking gate also calls a shared exclusion list `0x502a9af9` → `0x50127949` (D): it blocks no-lens, the MF-clutch state, the ZD 70-300, most Four Thirds Sigma lenses (maker 1 except types 1/2/4/5/0x13 sub 0), and two Lumix ids (6/0/01/10 and the 12.5mm 3D). It is an AF-incapable list shared with the AF code and with focus **bracketing** — not a stacking-specific restriction. Focus bracketing itself (gate `0x508c21a0`) has no maker check, no id table and no MAG_CNG check, so the focus drive is offered to third-party µ4/3 lenses that are not on this exclusion list; the drive hardware is not OM-only (**I**, from code; no lens tested).

## 6. Cross-body comparison

| body | 50 fps SH2 | focus stacking |
|---|---|---|
| E142 E-P7 | absent | present, older pure body-whitelist design (9-id u32 list at `0x6f6971`, no MAG_CNG / no capability path) |
| E144 OM-5 | absent | present, identical 12-id chain + byte-identical tables |
| E143 OM-1 | gate `0x506ea4b1`, table `0x6f3955` | gate `0x508c2863`, tables `0x1f3d94` |
| E146 OM-1 II | gate `0x506ceafc`, table `0x6d5a71` | same chain; flag reader `0x502cb388`/`0x502cb445` at the same `+0x1D133` |
| E147 OM-3 | gate `0x506f02d8`, table `0x6f724d` | same chain |

The 50 fps whitelist contents and gate logic are byte-identical across E143/E146/E147 (X, re-diffed; the gates differ only in PC-relative displacements); the focus-stacking 23-table blob and 12-id chain are byte-identical across E143/E144/E146/E147 (X). No lens ids were added to any body table between 2022 and 2025, so all later lens support rides the lens-reported bit. The E146/E147 gate addresses above are located; the single-site bypass was not re-derived for them.

## 7. Bypass analysis

**50 fps SH2 — menu (D).** The decision is computed only in `0x506ea4b1`, which returns 0/1/2 in `d0`, and both property-15282 writers funnel through it (§1). Forcing that function to its enabled return (the `result`/`d0` value 2, at the point the body sets its verdict) un-greys 50 fps for every lens in one edit and lifts the 25 fps cap, because every consumer reads the single property the gate feeds. This is one site in the logical sense.

**50 fps SH2 — functional (D/I).** No second gate was found, so the body would attempt 50 fps on any lens, but the AF focus-drive tuning is per lens. The path at `0x509195e7`/`0x50919617` is not a gate: it switches on the same five ids and takes a 25/50 fps pair of body constants from table `0x60a430a0`. For any other lens it calls `0x5094f071(11)` = lens-reported `L_FOC_MOV_MAX_ANNEX[10]`; if that is non-zero and the rate field is 500 it uses the lens's value and sets the flag at `(12,sp)`, otherwise it uses the generic value from `0x5094d703` (`(26,sp)`) with the flag clear, the same value that lens gets at 25 fps (D, `0x5091967e..0x50919698`). So a non-listed lens that does not report the annex runs 50 fps on generic focus-drive values. Whether AF keeps up during the burst, and whether a given lens can physically sustain the 50 fps drive cadence, is untested (**I**).

**Focus stacking — menu (D).** The enable decision is computed only in `0x508c2863`, which has the single wrapper `0x508c1596`; both UI consumers (the 1319 lock and the 1320 set/execute path) reach it through the one funnel `0x50417ba5`, and no caller recomputes the decision. Forcing the gate's own body to return enabled (its `d2` verdict) un-greys stacking for every lens in one edit, and because the forced body never runs the gate's own exclusion-list check (`0x508c2864`) or flag check (`0x502b3d83`), it opens the menu even for excluded and third-party lenses. It must be the function body: patching a single downstream consumer would miss the other path.

**Focus stacking — functional (D/I).** A gate-body patch does not give a non-listed lens a magnification correction. The magnification-correction path is independent of the gate: the copier `0x50120a4c` and the consumer `0x506ec998` each re-read `+0x1D133` themselves on the lens-init path (`0x50120b00`, result stored at lens-working-struct `+38516` by `0x50120b68`), never through the gate. The copier skips the copy unless the flag is 1; the consumer returns 0 unless the flag is non-zero (`0x506ec9a6..af`), so with only the gate patched a non-listed lens gets `+38516` = 0. Overriding both guards is two more sites, and even then a non-listed lens never delivers the 274-byte table (only the lens parser at setter `0x502af87f` or the body whitelist populates it), so the consumer computes over an all-zero or stale-from-previous-lens table and the `+38516` correction comes out zero or wrong. There is no divide-by-zero: the consumer only reaches `div` after guarding FC_DIV > 1 and n ≥ 2 (D). No other reader of the flag exists (§2), so nothing else blocks the shot. The focus-drive and bracketing side would run, but the composite would get no per-lens scale correction; lenses whose image scale shifts with focus would likely show scale misalignment in the stack, and what the compositor does with a zero correction is not traced (**I**). The forced gate also skips the exclusion list, but whether bracketing's own gate `0x508c21a0`, which keeps that list, still blocks stacking for excluded lenses was not checked.

**What remains.** For the menu, forcing either gate body is sufficient and bypasses the gate's own maker/version and exclusion checks. For results: a non-listed lens gets generic 50 fps focus-drive values and zero stacking magnification correction. The correct per-lens values come from the body table or the lens, and a body patch cannot know them for an arbitrary lens, so the practical outcome is untested rather than known to fail.

**Checksum and repack (D, no image built here).** Any patched main block has to be re-scrambled with its tail checksum recomputed (`sum32 == 0`), per the project's checksum model; a gate edit is therefore one logical site but not literally one byte site. This is the same repack discipline as the ND128 candidate — see [the ND128 experiment](../nd128/README.md) and [docs/firmware-container.md](../../docs/firmware-container.md) "Repacking, patching and flashing". As with ND128, any such candidate would be an offline, version/hash-locked artifact with camera acceptance untested, and none is built here. This note identifies the gate instructions only; it gives no replacement bytes and no flashable image.

## 8. Open questions

- Which real lenses set FuncFlag[2] & 0x2 + `L_PRIVATE_ID_DATA` & 0x100 (50 fps) or FuncFlag[2] & 0x800 (stacking). Lens-side data; needs a lens bus capture or a lens firmware image.
- What `L_REF_M` bit 0x10 means (forces 50 fps gate to 0), and which real lenses hit gate result 0 (e.g. Four Thirds lenses on an adapter).
- Whether the 12-40 PRO II reports 0x1019 or uses the bit path.
- What OM-1 firmware 1.8 changed for the 50-200 — no older E143 image is available to diff.
- The exact engine semantics of `0x503d2cf0` (stacking: lock vs force-0) and the compositing-side reader of the `+38516` correction.
- Whether forcing the stacking gate is enough for lenses on the exclusion list, given that bracketing's gate `0x508c21a0` keeps that list.
- The single-site bypass for E146/E147 was not re-derived; only the equivalent gate addresses are located.

## 9. Method and tags

Static reading of the E143 v1.9 main block with `tools/mn10300dis.sh` / `tools/mn10300-objdump` and call-site scanners; cross-body work unpacked E142/E144/E146/E147 into a scratch directory outside the tree. No lens is connected in the lab, so every claim about what a real lens reports is **I**. **X** = executed/measured (byte dumps, image-wide scans, cross-body diffs), **D** = read from code or data with the address shown, **I** = inference. Claims corrected along the way (the "four readers, nothing else" overcount; "all other lenses capped at 25 fps"; an earlier "not functional" verdict that overstated the focus-drive and MAG_CNG fallbacks) are folded in above in their corrected form. The firmware-derived scratch disassembly stays out of the tracked tree.
