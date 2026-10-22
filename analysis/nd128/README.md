# OM-1 ND128: an offline experiment (2026-10-06)

This is an **experimental firmware candidate for the OM-1 v1.9**. It has not been tried on a camera, so the unlock is
unverified. The candidate maps the existing ND64 menu slot to step 7 in the exposure adapter and adds the matching
exposure conversion. The menu still shows ND64, and the original ND64 setting is replaced; no seventh menu entry is
added.

The firmware, `artifacts/nd128/OM1_v1.9_ND128_ND64-slot_EXPERIMENTAL.BIN` (240,779,264 bytes), is not committed;
`tools/om1_nd128.py` builds it (see [Reproduce](#reproduce)). [manifest.json](../../artifacts/nd128/manifest.json)
records the full patch, the input and output SHA-256 digests and the checksum results.

Related notes: [feature gap OM-1 vs OM-1 Mark II](../feature-gap/README.md),
[lens-gated features](../lens-gates/README.md), [the .BIN container](../../docs/firmware-container.md).

## Confirmed local evidence

All offsets are **file offsets in the descrambled main code block**, not offsets in the packed firmware.

| Item | OM-1 v1.9 | Finding |
|---|---|---|
| ND parameter read | `0x2d1650` | reads `0x1e51` and at `0x2d165d` writes offset 35 of the parameter struct |
| ND step exposure conversion | `0x2d00f1` | the original code accepts only 1-6; its output is the step times the exposure-index units per EV (1, 2 or 3) |
| ND composition info | `0x2d0302` | when enabled, the code from `0x2d0336` computes `1 << step` and writes the frame count as a halfword; 7 gives 128 |
| Tv table selection | `0x2cf4e3` | the 8 normal and special exposure tables and their lengths are byte-identical to the OM-1 Mark II's |
| Tv and frame-count tables | from `0x6cc078` | Tv and frame-count arrays of 37, 25 and 13 entries, 300 bytes in all, identical to the Mark II's |
| Bayer buffer names | both builds | both have the same six ND Bayer buffer names; their number is not the frame count and says nothing about memory safety |

An earlier conclusion, that all data is position-independent and absolute cross-references are useless, does not hold.
The read-only data used here maps as `body_offset + 0x60021020`: for example `digital_nd_info` is at `0x2d3e96` and the
immediate that refers to it is `0x602f4eb6`. The mapping was checked against the actual strings and the eight exposure
tables; other segments need their own check. The earlier notes read `f9 02 06` / `f9 02 07` directly as a multiply,
which was an inference from context: the disassembler decodes them as the custom `udf00`. The patch therefore uses
plain instructions (repeated addition) and does not depend on that assumption.

## The patch

1. Overwrite the 58-byte switch at `0x2d00f1..0x2d012a`: check 1-7, compute `step * exposure_index_unit` and jump to
   the original `0x2d012b`, which writes the result. 0 and 8-255 still take the original error path, which keeps its
   return through the 84-byte stack frame.
2. In the space the switch frees, put the parameter mapping at `0x2d0104`: 6 becomes 7, any other value is unchanged;
   then run the original parameter write and the return through the 28-byte stack frame.
3. Replace the three-byte parameter write at `0x2d165d` with a three-byte relative jump. The parameter read API, the
   initialisation and the persisted settings keep their original code.
4. Re-encode the main block and recompute only its tail sum32 checksum. The firmware's length, version, model, all
   resources and the other five blocks keep their original contents.

The new selector uses D0 and D1 for scratch. The two direct callers checked consume the output pointer, not the
selector's register return value; D2, D3, A2 and A3 are still restored by the original return instruction. The
replacement runs no custom UDF instruction and does not change MDR.

No relative CALL in the original file targets the overwritten range. The only four-byte match that looks like
`0x502d0108` is at `0x1240eb4`, spanning the two instructions `mov 264,d0` / `mov 1872,d1`: an immediate-byte
coincidence. This is not a full control-flow proof over every handler and every indirect jump.

## Verification and its limits

- All six blocks of the original firmware pass the checksum; descrambled and re-encoded, each is byte-identical to the
  original.
- The new machine code was run through a restricted instruction interpreter: 256 parameter-mapping inputs and
  256 x 3 selector inputs, 1,024 cases, all pass, covering the relative jumps, the results for valid values and the
  branch for invalid ones. That interpreter is local to the script, not camera hardware or a full MN10300 emulation.
- Against the OM-1 Mark II main block (pinned by SHA-256), the 8 Tv tables and the 300 bytes of frame-count arrays
  match.
- All six blocks of the new firmware pass the checksum, and the last five are byte-identical to the original. The
  packed main block changes in 58 bytes, plus the 4-byte tail checksum field.
- Later, emu ran the 1,024 parameter paths and checked the memory writes and the stack restore at RET, together with 184
  CPU, memory and debug checks and 18 comparisons against the original selector. Run directly, the frame-count code
  writes 64 in the original and 128 in the patched version. The parameter getter's return value is injected by the test
  and the function slices are called separately; neither the RTOS nor the image composition is emulated. The original
  step 6 multiplies with `udf00 6,d2`; the UDF semantics were settled from firmware evidence when the instruction set
  was completed ([UDF spec](../../docs/om1-udf-spec.md)), before which it trapped. The check is
  `node emu/checks/check_nd128.mjs`, which needs the candidate's main code block in `artifacts/nd128/`.

**Not yet confirmed:** whether the later image composition has its own ND64 limit, whether 128 frames complete safely,
whether Live View and EXIF are right, and whether the camera's updater accepts the modified firmware. Other paths that
read the original parameter directly, and the menus, may still see 6, which leaves a consistency problem. A passing
checksum only shows the container is well formed locally; it does not show that the updater accepts the file or that
the camera shoots normally. No camera write was done. The candidate carries a risk of bricking the camera and must not
be treated as a finished image to flash until these questions are answered.

## Reproduce

Run from the repository root. The output directory must not already hold a firmware of the same name; the script
refuses to overwrite.

```bash
python3 tools/om1_nd128.py fw/OLY_E_143_1900_0000_0000.BIN --out-dir /tmp/om1-nd128-rebuild
```

It also reads the OM-1 Mark II main block from `unpacked/E146/` (`--donor`; `node emu/bin/fetch-fw.mjs --model E146`
writes it). The script accepts only the pinned SHA-256 of the source firmware and of the Mark II reference block, and writes the
candidate, the descrambled main block and the verification manifest. It does no flashing.

The excerpts in this directory, each a short objdump slice with main block file offsets as addresses:

- `E143-selector-original.dis`, `E143-selector-patched.dis`: the ND step conversion at `0x2d00ee..0x2d014e` before and
  after patch steps 1 and 2.
- `E146-selector-original.dis`: the same function in the OM-1 Mark II, for comparison.
- `E143-provider-patched.dis`: `0x2d163b..0x2d1662`, around the ND parameter read at `0x2d1650`, with the jump of
  patch step 3 at `0x2d165d`.
- `E143-tv-table-select.dis`: the Tv table selection at `0x2cf4e3`.
- `nd-strings.txt`: the `digital_nd_info` format string and the six ND Bayer buffer names, in both builds.

The next step is to trace how the image engine consumes the composition info that `0x553f48` outputs, to establish its
limits, the preview and EXIF; only then is there a basis for discussing a test on a camera.
