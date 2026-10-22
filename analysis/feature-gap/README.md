# OM-1 to OM-1 Mark II: the feature gap and what could be unlocked

An analysis of the **descrambled** main code blocks (`blk00000000`, load address `0x50000000`) of the OM-1 v1.9 (E143)
and the OM-1 Mark II v1.3 (E146). The CPU is MN10300 / AM33 (`docs/firmware-container.md`). A first pass compared
strings and symbols; a second took the open questions down to disassembly with a `mn10300-objdump` built for the
purpose. Verdicts marked *(disasm-confirmed)* are ones where the function's control flow was actually read.

Related notes: [lens-gated features](../lens-gates/README.md), [ND128 experiment](../nd128/README.md),
[the .BIN container](../../docs/firmware-container.md).

## Headline verdict

**No feature exclusive to the OM-1 Mark II can be unlocked by flipping a bit** *(disasm-confirmed)*. E143 and E146 are
two separate, complete builds. The run-time mode gate `ModeCheck` / `getReasonCanExecute` allows or denies purely from
camera state: its reason enum (55 codes in E143, 62 in E146) has **no** `*MODEL*` / `*PRODUCT*` / `*CAPABILITY*`
input. Model handling is a construction-time factory plus a hard-coded single-model identity (E143 contains only
"OM-1"; "OM-1MarkII" appears 0 times). The only flag-like tables (`PRM_*`) live in each unit's camera FLASH and hold
calibration, serial, region and factory-adjustment status; no feature-enable field, capability bitmap or licence field
exists in FLASH or in the image (the API_ERROR table is byte-identical, 90 codes each). Enabling an exclusive feature
means **porting MN10300 code**, not editing a byte.

The gap is narrower than the marketing suggests, though, and two items turned out to be **small, concrete edits**
rather than full ports (see the candidates below).

String-level leads that started the search: the Mark II has, and the OM-1 lacks, Live GND / graduated ND
(`current GND tag`, `Half ND`, `ag_gnd_coef_a/b/c`, `ag_gnd_gain_min`, `ag_gnd_width`) and the expanded AF
(`SUBJECT SELECT`, `CAF_1ST2ND`, `CAF_HANDSHAKE`); both builds have the gating hooks `API_ERROR_NO_SUPPORT`,
`API_ERROR_DISABLE_FUNCTION` and `CAM_ENABLE_ALWAYS`. The two OE code blocks have the same size and load address but
differ in about 66% of their raw bytes, mostly address-shift noise, so the builds are compared at the string and symbol
level.

## How this binary has to be read

Do not treat the whole code block as one address mapping, and do not infer position-independent code from missing
`0x50xxxxxx` string references. In the ND helpers, relative code disassembly uses the `0x50000000` base, but the
strings and exposure tables they refer to resolve as **data_address = body_offset + 0x60021020**. For example, the
immediate `0x602f4eb6` at body offset `0x2d0372` refers to `digital_nd_info` at `0x2d3e96`, and eight Tv-table pointers
resolve with the same mapping. This is confirmed for these data, not as a mapping for every segment. Absolute
references work once the right mapping is used. (The emulator finds this run-time base for every body:
`node emu/bin/fw-survey.mjs survey`, `docs/model-survey.md`.)

Linear disassembly can still lose alignment on this variable-length ISA. Use known call boundaries, compare the two
builds' instruction idioms, and check data references against the actual contents. `tools/mn10300dis.sh` stays useful
for spot disassembly.

## Feature matrix

Gating: **none** = already in the OM-1; **build-absent** = compiled out of the OM-1; **build-partial** = the base is in
the OM-1, the extension is compiled out; **switch-case** = the pipeline is there, one code path is bounded lower.

| Feature | In OM-1 | Gating | Feasibility | Evidence |
|---|---|---|---|---|
| **Live ND ceiling ND64 -> ND128** | ND64 (step <= 6) | switch-case | **small patch** *(disasm-confirmed)* | step selector: E143 @0x502d00f1 handles cases 1-6; E146 @0x502e7ef3 adds case 7 (`f9 02 07` = x7, absent in E143). ND = 2^step. Needs the downstream pipeline to accept step 7 (both have six `..9BIT_BAYER` buffers; to verify) |
| **GPS location state + "Record GPS Location"** | state tracked, no API | build-partial | **easy, additive** *(dependencies disasm-confirmed)* | `getGpsLocationState` is a thin 5 -> 3 state remap; the `GPS_STATE_*` enum and the BLE receive path are already in the OM-1. Delta: 1 method, a 3-value enum, 1 menu / SDK entry. Low value (UX) |
| **Configurable burst fps (CFPS)** | engine yes, configuration no | build-partial | **small, localised** *(disasm-confirmed)* | 3 more struct fields (`continue_fps`, `continue_fps_general`, `anti_flicker_continue_interval`); the SP2 path gains CFPS, the SP3 profile is dropped; one drive handler differs (E146 0x503b95a6 vs E143 0x503b8e73: a two-flag gate against one). About 1 struct and 2 functions |
| **Live GND / digital graduated ND** (headline) | no | build-absent | hard port | the whole subsystem is absent: `g_stLiveGndInfo` 0 vs 1, `ag_gnd_coef_a` 0 vs 2, `isGndFilterAdjustment` 0 in E143; new reason code `CHECK_IS_NOT_DIGITAL_GND_FILTER`. Distinct from Live ND above |
| **Human subject detection (AI)** | no | build-absent, plus model data | hard port | `DL_CPU0_COMPLETE_HUMAN_DETECT_DATA_SET` only in E146; needs the neural model blob too |
| **Subject Select / Subject Lock** | no | build-absent | hard port | `selectSubject` / `changeLockSubject` / `BLK_SUBJECT_SELECT` 0 in E143 |
| **C-AF rework / CAF_SH2** (C-AF in SH2 burst) | core yes, rework no | build-partial | hard port | 5 new CAF debug channels (slots 14-18: CAF_SH2, RECURSION_INFO, CROSS_SEQ, CROSS_PARAM_ALL, CAF_1ST2ND); the AF measurement core is byte-identical, so these are **new code paths with embedded tuning, not a retune** (moderate confidence) |
| **USB UVC / UAC webcam** | no | build-absent (USB class) | hard port | `LINK_PROTOCOL_WEB_CAMERA` only in E146; the OM-1 enum lacks the member |
| **Blackmagic RAW over HDMI** | no | build-absent, plus external hardware | hard port | `ctrlHdmiBlackMagic` / `VSDB Info BlackMagic` only in E146 |
| **Wi-Fi Camera Control / Suspend / DeviceLink REMOTE** | no | build-absent | hard port | `startWifiCameraControlMode`, `LINK_PROTOCOL_REMOTE` only in E146; the base Wi-Fi / DeviceLink is in the OM-1 |
| **HDMI HDR output (EOTF HDR10 / HLG)** | partial | build-partial | medium port | `set_hdr_ctrl[EotfPrm]` only in E146; the base `set_hdr_ctrl` is in both |
| **Focus-stacking lens gate** | yes | numeric (lens gate) | **menu: 1-site patch; function: untested** *(disasm-confirmed)* | gate `0x508c2863` needs lens byte `+0x1D133` == 1, set by a 12-ID OM body whitelist (tables at file `0x1f3d94`) **or** a lens-reported capability bit (FuncFlag[2] & 0x800). The whitelist is byte-identical across E143 / E144 / E146 / E147 (the 2 IDs the Mark II adds to the lens *recognition* list, 2138 and 15292, are not in this gate). Forcing the gate un-greys the menu for all lenses and no second gate was found, but the MAG_CNG magnification correction re-reads the flag itself, so a non-listed lens stacks with zero correction (result untested). See [lens gates](../lens-gates/README.md) |
| **50 fps SH2 / Pro Capture SH2 lens gate** | yes (per lens) | numeric (lens gate) | **menu: 1-site patch; function: untested** *(disasm-confirmed)* | gate `0x506ea4b1` sets property 15282 (0/1/2) from a 5-ID body whitelist (table at file `0x6f3955`) or lens bits (FuncFlag[2] & 0x2 plus `L_PRIVATE_ID_DATA` & 0x100). Present in E143 / E146 / E147, absent from E142 / E144. Forcing the gate lifts the 25 fps cap in the menu and no second gate was found; the per-lens AF focus-drive tuning (`0x50919617`) falls back to generic values for a non-listed lens that reports no 50 fps data (AF result untested). See [lens gates](../lens-gates/README.md) |
| **Anti-flicker during continuous shooting** | no | build-partial | hard port | the `anti_flicker_continue_interval` field is absent from the E143 struct |
| AF 1053-point grid, base subject categories, High Res, Live ND (base), Live Composite / Bulb, Focus Stacking, HDR still, Multiple Exposure, Keystone, Fisheye, all video specs, ProCapture SH1 / SH2, blackout-free, interval, custom modes | yes | none | already present | identical symbol and string counts |

## Unlock candidates, ranked by effort and value

1. **Live ND -> ND128**, the single most actionable finding. The difference is one extra `switch` case (step 7 = x7) in
   the digital-ND step processor (E143 @0x502d00f1). A patch adds the case-7 path and points it at an ND128 Tv entry.
   **To verify first:** that the downstream digital-ND pipeline accepts step 7. The eight Tv tables and the six
   Tv / frame-count arrays are byte-identical in the two builds; they are indexed by exposure, not one entry per ND
   strength. An offline candidate that maps the ND64 slot to ND128 exists, with the image engine's behaviour still
   unverified: see the [ND128 experiment](../nd128/README.md).
2. **Configurable burst fps**: small and localised (1 struct, 2 functions). Not blocked by hardware (same sensor and
   TruePic X). Medium value.
3. **GPS location state**: the easiest by dependencies (a thin accessor on existing state) but low value (UX only).

Everything else (Live GND, human detection, Subject Select, the C-AF rework, webcam, Blackmagic RAW, Wi-Fi control,
HDMI HDR) is a real port of an absent subsystem: hard, and human detection also needs a neural model blob. The
focus-stacking and 50 fps SH2 lens gates are fully mapped: each is one decision function plus a small body whitelist
and a lens-reported capability bit. A one-site patch un-greys either menu for every lens; a non-listed lens then runs on
generic per-lens tuning (zero MAG_CNG correction, default 50 fps focus-drive values), and whether that works is
untested; see [lens gates](../lens-gates/README.md).

## Next reverse-engineering steps

Tools: `tools/mn10300-objdump` and `tools/mn10300dis.sh` for spot disassembly, and the MN10300 ISA manual and the IDA
mn103 module (`BLOBS.md` says where to get them). For call-graph work, load each `blk00000000` into IDA (mn103 module)
as a flat little-endian image at base `0x50000000`.

1. **The ND128 patch (highest priority):** the version-locked offline candidate and a no-op repack check are done, and
   the exposure tables match the Mark II's. Trace the ND info consumer behind body offset `0x553f48` to verify the
   remaining composition limits, the preview and EXIF before any test on a camera. The candidate remaps the ND64 slot
   instead of adding a seventh menu entry.
2. **Scoping the burst-fps port:** finish mapping the drive-handler delta (E146 0x503b95a6 vs E143 0x503b8e73), the
   two-flag gate and the dropped bit-set block, to know exactly what to write.
3. **GPS proof of concept:** trace `getGpsLocationState` from the menu / SDK actuator through the call graph to
   recover its exact body before writing the additive accessor.
4. **Before any flashing:** prove the whole unpack, patch, repack and checksum loop on a no-op change (patch a byte,
   rescramble, check the tail sum32 is 0, confirm the camera accepts it) before a real feature patch. Flashing can
   brick the camera.

## Reproduce

```
node emu/bin/fetch-fw.mjs --model E143    # downloads, verifies and unpacks the main code block into unpacked/E143
# for every block instead: mkdir -p unpacked/E143 && cd unpacked/E143 && python3 ../../tools/olyfw.py ../../fw/OLY_E_143_1900_0000_0000.BIN --dump
tools/mn10300dis.sh unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin 0x2d00f1 0x60   # for example the ND step switch
```
