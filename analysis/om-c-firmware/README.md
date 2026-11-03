# azqeurio/om-c-firmware: a study for om-emu (2026-11-02)

[azqeurio/om-c-firmware](https://github.com/azqeurio/om-c-firmware) publishes "db firmware", a desktop patch tool for
Olympus / OM System camera firmware. Version 0.3.2 (release `dbv0.3.2`, 2026-10-31) takes a stock updater `.BIN` for
one of 23 body/version profiles and writes a patched one: a Korean menu, Panasonic aperture-ring support, two extra
SH2 rates on the OM-1, an electronic shutter sound, a 5 GHz Wi-Fi hotspot, and two body-specific edits (E-M1X ISO,
E-P7 controls). This note answers what om-emu can take from it: what each feature changes in the OM-1 (E143) firmware
and whether that holds against our image, what its sound feature shows about the camera's operation-sound engine,
where it corrects om-emu's docs, and what om-emu does not take. It ends with open questions and ranked follow-ups.

How it was read: the release metadata and the macOS archive of 0.3.2 were downloaded, the archive's sha256 checked
against the release's (`6c799a58...bd65`, X), and its Python source, JSON symbol tables and Korean notes were read as
data outside the tree. None of its code (Python, the bundled runtime, the Windows `.exe`) was run. Its patch tables
were compared with om-emu's pinned images by small scripts that only read bytes; the firmware facts were checked with
`tools/mn10300dis.sh`, the fwmap report and probe sessions of `emu/bin/play.mjs --debug-api`. No excerpt of om-c's
code, sounds, fonts, translations or encoded templates is committed.

**Licence.** The repository and the release archive carry no licence file (X: the repository holds one 15-byte
`README.md`; the archive's listing has none). So nothing here is copied or closely paraphrased: facts and addresses
only, attributed to azqeurio/om-c-firmware where used, as the [fishcu note](../oly-fw-analysis/README.md) does.

Related notes: [fishcu/oly_fw_analysis](../oly-fw-analysis/README.md), [lens-gated features](../lens-gates/README.md),
[feature gap OM-1 vs OM-1 Mark II](../feature-gap/README.md), [the .BIN container](../../docs/firmware-container.md).

**Addresses.** om-c writes run-time addresses for code and data alike (block offset + `0x60021020` on E143); here E143
code addresses are in om-emu's notation (body offset + `0x50000000`, `docs/README.md` "Addresses"), so theirs -
`0x10021020`; data addresses are run-time. om-c's OM-1 1.9 input is our image: its `source_sha256` `342954a4...` is
`BLOBS.sha256`'s E143 digest (X), so its addresses are ours. Tags as in the specs: **X** executed or measured here,
**D** read from the firmware (or from om-c's tables, where said) at the cited address, **I** inference, **?** unknown.
"Their report" marks a camera result om-c states and om-emu cannot check.

## Short answer

1. **Reliability.** Every stock byte om-c expects before patching E143 matches our image: all 82 static patch sites of
   the `om1-1.9` profile (10 ring, 67 SH2, 3 Wi-Fi, 2 Korean records; X, section 3). The static claims checked below
   hold; none is contradicted. Its addresses are good leads with a quick check each.
2. **What it is.** A PySide6 GUI over a Python patch engine, distributed only as release binaries (Windows `.exe`,
   macOS app bundle with the source inside) from an otherwise empty repository (section 1). Its 23 profiles are all in
   om-emu's survey with the same digests (X).
3. **The shutter sound.** Stock E143 plays nothing at the electronic shutter: in the lab the sound engine's play
   method is never called at S2 and the audio MMIO blocks are never touched (X). om-c adds a call to that engine's
   play method before the capture begin `0x50b8467c` and serves its own WAVs through the native sound-resource lookup;
   the stock sound table is never loaded in the lab and its flash index at `0x4e420000` lies outside every updater
   block (section 4).
4. **New to om-emu** (all checked on E143): the lens state request's ring extension (p2 bit 0, a u16 at reply +12,
   `0x8000` = A), the Panasonic start command `81 10` that today's S-LENSMCU refuses, the setting-rule engine's
   formats, `app_check_mode`'s row-disable registry, the SettingController API slot names, the OLNET_PRM Wi-Fi
   channel path, and the radios of the OM-1 family (sections 3, 7).
5. **Corrections to om-emu's docs:** three (section 7): flag `0x0107` is the SCPU image, not sounds; the lens-ready
   byte test of `0x502afe5a` wants ID byte 1 == 0; E146 and E147 run brcmfmac, not bcmdhd.
6. **What om-emu does not take:** any of its code or assets, its patched images, its download mirror and its feedback
   server (section 6).

## 1. The tool and how it is distributed

- **Repository (D).** `azqeurio/om-c-firmware` holds a single `README.md` reading `# om-c-firmware`. Everything is in
  its GitHub releases: nine between `dbv0.1beta` (2026-10-17) and `dbv0.3.2` (2026-10-31), each a Windows
  `db.firmware.<version>.exe`, most with a `DBFirmware-macOS-AppleSilicon-<version>.zip` (0.3.2: 162,739,250 and
  175,419,088 bytes). The release text is Korean and English.
- **What is inside (X, `unzip -l`).** The macOS archive is `db firmware.app` with a bundled Python runtime (1,929 files)
  and the tool's own source and data in `Contents/Resources/app` (226 files): the engine (`engine.py`, per-feature
  modules such as `om1_sound*.py`, `om1_sh2.py`, `om1_wifi5g.py`), the profile table `profiles.json` with every patch
  as block, offset and base64 before/after bytes, per-feature symbol tables under `assets/`, Korean guides
  (`*_KO.md`) and their validation JSONs. `requirements.txt` names PySide6, numpy, Pillow, fonttools and lz4;
  `DBFirmware.spec` is a PyInstaller spec, so the `.exe` is presumably the same source frozen (I; it was not opened).
  Its `release.json` says the macOS app is not signed or notarised and was not run-tested for 0.3.2 (D).
- **How it works (D, their source).** The user loads a stock `.BIN` or downloads one (section 6); the engine checks the
  file's sha256 against the profile, applies the chosen features' patches (checking the before-bytes), recomputes the
  block checksums and writes `DCOLYMP/E1xx9999.BIN` for the camera's SD updater. Some features are generated rather
  than static: the shutter sound converts user audio to 48 kHz stereo PCM16 WAVs and assembles its code from
  templates; the Korean feature can re-render the font.
- **What it claims to have tested.** The release lists camera results (their report): on the OM-1 the Korean menu,
  the aperture ring, SH2 12.5 / 16.7 fps, the shutter sound and the 5 GHz hotspot work; the ring works on the E-M1
  Mark III, OM-3, OM-5, OM-5 Mark II, E-M5 Mark II and III, E-M10 Mark I and PEN-F; the author owns an OM-1, an OM-5
  Mark II and a PEN. `release.json` marks the 0.3.2 build itself `physical_camera_verified: false`, and the shutter
  sound's volume and multi-sound changes as CPU- and container-tested only (D).

## 2. Features and bodies

| Feature (profile id) | Bodies (om-emu code) | E143 change |
|---|---|---|
| `korean` | OM-1 1.9 (E143), OM-1 II 1.3 (E146), OM-3 1.1 (E147), OM-5 1.2 (E144), OM-5 II 1.1 (E148) | two resource records replaced (3.3) |
| `ring-native` (Panasonic aperture ring) | all 23 profiles | 8 hooks, the loader end, a 1,460-byte code cave (3.1) |
| `sh2-four-rates` | OM-1 1.9 only | 58 table edits, 7 code hooks, a 242-byte payload, the loader end (3.2) |
| `shutter-sound` | OM-1 1.9, OM-1 II 1.3, OM-3 1.1 (removed from OM-5, OM-5 II, E-M1X, E-M1 III in 0.3.2) | generated, no static sites (4) |
| `wifi-5ghz` | OM-1 1.9, OM-1 II 1.3, OM-5 1.2, E-M1X 2.4 (E134), E-M1 III 1.6 (E139); withdrawn from OM-3 (CYW43439) | 2 code sites + the Linux rootfs (3.4) |
| `em1x-auto-iso-25600` | E-M1X 2.4 | not E143 (3.5) |
| `ep7-controls` | E-P7 1.1 (E142) | not E143 (3.5) |

The other profiles carry only the ring: E-M5 III 1.7 (E137), E-M10 IV 1.1 (E140), E-PL9 (E133), E-PL5 (E100), E-P5
(E108), E-M1 4.6 (E109), E-PL6 (E112), E-M10 1.4 (E113), E-PL7 (E115), E-M5 II 4.1 (E118), E-M10 II (E120), PEN-F 3.1
(E122), E-PL8 (E126), E-M1 II 3.7 (E125), E-M10 III (E130) (D, `profiles.json`). All 23 `source_sha256` values equal
`BLOBS.sha256` (X) and their run-time bases equal `docs/model-survey.md`'s (D), an independent check of the survey's
base column. om-c covers nothing om-emu's survey lacks; om-emu also holds TG and STYLUS bodies, A01 and E-PM2. Only the
OM-5 II is downloaded from the official catalogue (6).

## 3. What each feature changes on E143

The `om1-1.9` profile's before-bytes all match our blocks (X, a byte compare of every patch's `old` field against
`blk00000000`, `blk02000000`, `blk05a00000`).

### 3.1 Panasonic aperture ring (`native-descriptor-ring-table-gate-v5`)

Ten sites (D, om-c's bytes disassembled statically; the stock sites read at the cited addresses):

- **Loader end `0x50024e18`.** The overlay loader's segment-1 copy end `mov 0x602f5000,d0` becomes `0x602f5800`, so
  the loader copies the `0xff` run that starts at `0x502d3f48` (the run reaches body `0x32bfe0`, X). The cave at
  `0x502d3f48` holds om-c's 1,460 bytes. The shutter sound raises the same operand to `0x6034d000`, the end of that
  run (their `om1_sound_bank.py`, D).
- **Request `0x502ba96c`** (inside the type-6 frame builder `0x502ba920`): for command ids 69 / 75 / 84 / 90, the two
  lens state queries `c1 80` and `81 e3`, when the gate holds and the cached state is not 2, the second header
  parameter p2 gets bit 0: `c1 80 [00 06]` becomes `[00 07]`.
- **Parser `0x502b2719`** (in the state parser `0x502b263d`, after the record's +20 / +21 bytes and before the p2-bit-1
  block of eight u16): with p2 bit 0 set, a u16 is read through `0x5012b3e3`; `0x8000` means the ring is at A or has no
  value, `0..0x1000` is the ring value; the cursor advances 2 bytes either way. The reply layout is then +0 u32
  status, +4 zoom step, +5 u8, +6 u16, +8 u16 aperture, +10 u8, +11 u8, **+12 u16 ring**, then the p2-bit-1 block.
- **Reply length `0x502bad17` / `0x502bad8c` / `0x502badc8` / `0x502bae62`** (dispatcher `0x502bacaf`): the expected
  length is `2 * max(p1, 1) + 14` (+2 for ids 84 / 90), +16 for p2 bit 1, +4 bit 3, +1 bits 7 and 4, +5 bit 5; a reply
  exactly 2 short means the lens ignored bit 0: the frame's bit 0 is cleared, state 2 cached (never ask again), and the
  stock parser runs. Any other shortfall takes error `0x6507`.
- **Identity `0x502af597`** (the id-3 `c1 f9` parser): each new lens ID clears the cache's magic and valid flag.
- **Aperture input `0x5059a210`** (in the getter `0x5059a203` of parameter `0x80CA`, the selected aperture stored at
  `(0x62abdc74)`; it returns `0x500` at S1 in the lab, X): the ring value replaces the return only in A or M (mode
  `0x503c506f` = 2 / 4, or C1..C4 resolving to them), with FIX DATA LENS = 1, the gate, a valid value and
  `0x502ac58c(0)` non-null. At A (`0x8000`) the body's dial value stays.
- **Gate:** the lens record `(0xa32caa8c)` (`0xa3193780` in the lab, X) non-null and aligned; its +1096 flags byte
  bit 7; record +1100 / +1102 equal to the ID copy `0x6296cd2e` / `0x6296cd30`; FIX DATA LENS `(0xa32d4b9a)` == 1; the
  protocol word `(0xa32caa90)` != `0x0b0a` and `& 0x0a`, the same test as the stock `0x502af723`. The 16-byte cache
  (magic `GNIR`, ID, value, state, valid) sits at `0xa319376c`, in the 20-byte pad the stock code `0x502ac2ce` leaves
  when it aligns the record to 128 bytes (D; the pad reads zero in the lab, X).

**Stock E143 and such a lens.** The stock firmware never asks for the ring: every poll is sub-code `0x0600` (X, 81
polls), the state parser has no p2-bit-0 branch, and none of the 51 direct reads of record +1096 tests bit 7 (D). With
the flags byte set to `0x80` in a scratch S-LENSMCU the poll stays `[00 06]` and the start completes (X). So a stock
OM-1 ignores the ring and sets the aperture from the body (X for the poll, D for the parser). The difference a
Panasonic lens does make is the maker byte: an ID with byte 0 = 2 and byte 1 = 0 makes the start step `0x5012361e`
send command 83 `81 10 [00 00]` (mode 1057, DMA) through `0x502afea2`; its parser `0x502b0a98` stores the reply's u16
at +2 in record +119168 and its bits 0 / 1 in record +9444 (D). Today's S-LENSMCU refuses that frame and the session
stops at `0x502c125a`; with a scratch four-zero-byte answer the start completes with FIX DATA LENS = 1 (X). The state
parser's tail `0x502b2b03` also skips the status-bit-31 update of record +9444 bit 2 for that maker (D). That byte 0 is
the maker (2 = Panasonic) is I (table `0x60216758` holds six `02 00 0n 10` IDs; om-c's notes say so).

om-c's claims about real lenses (the Nocticron's flags byte `0x80`, the 8-18 mm's `0x40` with the field always
`0x8000`, DJI as maker 8) come from lens ROMs om-emu has not seen (?). That the ring value is AV x 256, the unit of
`0x80CA`, is I (om-c substitutes it directly).

### 3.2 SH2 and Pro Capture SH2 at 12.5 and 16.7 fps (`sh2-four-rates`)

The settings are 2035 (`MODE_ELECTRIC_SHUTTER_SPEED_SH2`) and 2037 (`MODE_ZERO_TIME_LAG_SPEED_SH2`), stock `{250,
500}` in 0.1 fps with default 500 (X, `emu/refs/settings.mjs`). om-c's table edits (D, its bytes against the stock
structures):

- **Descriptors** 1453 / 1455 (`0x6061cf68`, `0x6061cf90`): the +4 allowed pointer re-pointed to a new four-entry
  list `{125, 167, 250, 500}` at `0x61514178`, +12 bytes 4 -> 8.
- **Value items** at `0x61514148` (`{u32 key, u16 type, u16 string id, char *literal}`): rewritten to keys 125, 167,
  250, 500 with literals "12.5" and "16.7" for the new two. The stock items there have other keys (50, 100, 150, 200,
  600 among them); which other lists share them is ?.
- **Drive-detail lists** keyed by setting id (rows at `0x614e9908` / `0x614e9a04`, `0x615314a8..0x61531504`,
  `0x61534734..0x6153483c`, `0x615146ac..0x61514704`): each items pointer re-pointed to `0x61514148` and its count
  2 -> 4. Who reads these lists is not traced (?).
- **The lens rule.** The setting-rule engine `0x503d2cf0` (below) holds for 2035 / 2037 one rule: if 15282 == 1,
  `250 -> 250`, `500 -> 250` (D, data `0x605e09fc`, pairs `0x605e0a04`). 15282 is `MODE_LENS_DRIVE_E_CONTINUE_SH2`,
  1 = SH2 offered but capped at 25 fps ([lens gates](../lens-gates/README.md), D). om-c rewrites the pairs to `125 ->
  125, 167 -> 167, 250 -> 250, 500 -> 250` and re-points row 2035's rule pointer (`0x605e28cc`) to the rewritten rule,
  so a 25 fps lens can still pick the slow rates (their "R8 lens menu fix").
- **Code.** Seven hooks into a 242-byte payload at `0x502d4560` (in the same cave): in `takepic.c` functions
  `0x503ba40c` and `0x503b822e`, in `0x503ad1d6`, and in four functions of the module around `0x50918ae5..0x5091beaa`
  (D for the sites; om-c labels them integer, cadence, selector, budget, two limit and format guards and calls the
  design "OM-1 II donor native SH1 paths"). What each guard does was not read (?).

Their report: 12.5 and 16.7 fps SH2 shoot on an OM-1; Pro Capture SH2 and a non-50 fps lens untested (`profiles.json`
verification, D).

The rule engine is new to om-emu's specs beyond the lens-gates note's use of it (all D, and one X): rows of 20 bytes
`{u16 id, u16 alias (3200 = none), u32 *rules, u32 n, u32 fn, u32 fn}` (2035 at `0x605e28c8`), rules of 16 bytes
`{*conditions, u16 n, *pairs, u16 n}`, conditions `{u16 id, u16 value, u32 fn}` ANDed, pairs `{u16 from, u16 to}`;
the wrapper `0x503d351f` keeps a nesting byte at `(0x62a57914)`. In the lab, writing 15282 = 1 through the native
setter `0x50ac4afe` turns 2035 and 2037 from 500 into 250, while 15282 = 2 or a raw property write `0x503ee412` does
not (X); the rules fire on the condition's change.

### 3.3 Korean menu (`korean`)

Two records of the resource block `blk02000000` are replaced in place at their stock sizes (D): record 10 (Japanese
strings, offset `0x3421e0`, `0x2f200` bytes) and record 28 (the Japanese font, `0x7019e0`, `0x67800`). The
`OlympusLanguage_jpntft` tag stays, so Korean appears where Japanese was (setting 3009 = 0). om-emu's readers take
them unchanged (X, scratch run on om-c's records, not committed): `StringTable` reads 4,702 strings with no error,
`refs/font.mjs` reads 847 glyphs on 45 pages, 609 of them Hangul, with the stock header; and the lab draws the Setup
menu natively in Korean with nothing visibly wrong (engine BITMAP refusals not checked). om-c's packer puts all L2
pages first and the glyphs after them, which om-emu reads, so the per-page order in `docs/om1-text-spec.md` section 4
describes stock blobs, not a reader requirement (I).

The custom rows of the shutter sound use the descriptor literal path, and om-c hooks its widening `0x51188312` to draw
Hangul there: that routine sign-extends each byte (`extb`) into the record's UTF-16 at +12, cleared for 94 bytes, with
no bound (D), so stock literals are effectively 7-bit and longer than 47 units overrun.

### 3.4 5 GHz hotspot (`wifi-5ghz`)

- **RTOS side (D).** The AP channel function `0x517f04d6..0x517f05d1`, called once from `0x517ef956` in
  `wifi_mngr_set_apl_prm` `0x517ef5fa`, reads parameters 60577 ("PRM_WIFI_CHANNEL"), 625 and 497 through the getter
  `0x500417da`; in AP mode (`(0xa33eea9c)` == 2) a channel above 13 logs "ch illegal range (0-13)" and becomes 0, and
  channel 0 probes card files `C:\WFCL0%03d.BIN` for 1..13. The result goes to `(0xa33eeb68)` at `0x517f05b9`; the
  caller sets the band byte `(0xa33eeb6d)` = 1 for a channel of 35 or more. om-c forces 36 at `0x517f04ea` (12 bytes)
  and `0x517f0528` (6 bytes, past the range check).
- **The block (D).** Those cells are OLNET_PRM at `0xa33eea9c` (dump `0x517f0b52`): mode +0x00, country +0x1d
  (written by `0x517f067f` from region codes 0..10 to `XC` / `XD`, `JP` / `XB`, `XE` / `XF`), channel +0xcc, band
  +0xd1. The A53's stock `isc_olnet` reads the same offsets (band +0xd1 == 1 selects its `hw_mode=a` / `ieee80211ac=1`
  branch), so the dual-band path is stock and only the RTOS clamp keeps the AP at 2.4 GHz.
- **Linux side (D).** om-c rewrites the squashfs root in `blk05a00000` at `0x2f10fe0`; inside it, 233 bytes of
  `isc_olnet` change to add `country_code=` from +0x1d and a 36..48 channel check; `hostapd.conf` is unchanged.
- In the lab OLNET_PRM is all zero 15 s after boot and none of these functions run (X). Their report: an OM-1 user
  saw the AP created; `release.json` marks 5 GHz operation itself unverified (D).

### 3.5 Not E143

The E-M1X ISO Auto ceiling (keys 1676 / 1677 re-pointed to key 112's 22-entry list, 8 bytes on E134) and the E-P7's
control remapping (1,053 sites on E142) were not examined (?).

### 3.6 Menus: what a new row must be registered in

`app_check_mode` (named by its log string at `0x60e4dbb8`): the lookup `0x50b7e5d1` scans a registry at `0x60e4bdcc` of
exactly 637 rows of 12 bytes `{u16 mode, u16, u32 *u8 index list, u8 n}` (`cmp 637` at `0x50b7e5ee`); the checker
`0x50b7e4b8` / `0x50b7e5f7` calls one of 172 callbacks (`0x60e4ad9c`) per index, and any non-zero result blocks the
row and logs (D). om-c raises the bound to 639, relocates the registry and adds callback 172 for its rows (D, its
tables). The SettingController vtable `0x60e38124` gains names through the API-name table `0x60360b28`: +28
`0x50b4e88f` getSettingCount, +32 `0x50b4eab7` getSettingValue, +40 `0x50b4e487` canSettingValue (D); om-emu knew +4
and +12.

## 4. The operation-sound engine and the electronic shutter sound

**Stock behaviour.** The OM-1 offers no sound for the electronic shutter (the mechanical shutter's sound is physical),
which is why om-c's feature exists (I). In the lab, with S1 then S2 (X, probe sessions):

- The sound object's singleton getter `0x50b56569` (object `0x62afee0c`) is called only at S2, twice, from
  IOlyApiShooting `0x51059373` / `0x51059919` through `0x5108c19f`, which then call the object's vtable +68, a query.
- The play method `0x50b569a4` is never called; the audio driver's MMIO blocks `0x9bb00000..0x9bb003c0` and
  `0x9b700000..0x9b70011c` (`docs/hle-gaps.md` 4.5) are never accessed.
- The sound table pointers `(0xa32db180)`, `(0xa32db19c)`, `(0xa32db32c)`, `(0xa32db1bc)` are 0, and their loader
  `0x501a8ca0` never runs.
- om-c's hook site, the capture begin `0x50b8467c`, never runs either: the release path below it is stood in by
  S-RELSEQ.

**The engine as om-c uses it** (D for the stock code at each address; the call shape is from om-c's symbol table
`assets/shutter/bank-runtime.json` and om-c's templates as read for this note, I):

- **Play.** om-c's wrapper before the capture begin `0x50b8467c` (and one at `0x50b87d56` in `CapBuf_TakeBuff.cpp`,
  their "fast" path) gets the singleton and calls the play method with `a0` = object, `d0` = sound id (its own ids
  `0x7ffa..0x7ffe`), `d1` = 100, `a1` = 0 and two zero stack words. It enters at `0x50b569a9`, the first instruction
  after the method's 5-byte prologue (`movm [d2,d3,a2,a3]` and `add -20,sp` at `0x50b569a4`, D); the method then
  calls the API-name resolver `0x50abc82f` with id `0x10501` (D).
- **Resources.** The type switch `0x501a976d` maps resource type 2 to `(0xa32db180)`, 3 to `(0xa32db19c)`, 0 and 1 to
  `(0xa32db32c)`, 6 to a table at `0x602a4a24` and `0x8000` to `(0xa32db1bc)` (D). The stock code at
  `0x5014f927..0x5014f988` fetches a type-2 resource through `0x501a921f` and stores its address and size words in
  `(0xa32db098)` / `(0xa32db09c)` (D); for its own ids om-c writes its WAV's address and size there and jumps to
  `0x5014f98a`, the next instruction.
- **The stock sound data.** The loader `0x501a8ca0` stores `(0xa32db17c)` / `(0xa32db180)` after reading a 1,024-byte
  index from flash `0x4e420000` through `0x501a986a` (D). The code holds four references to `0x4e420000`: the
  loader's, two in the type-2 write path `0x501a98c8` and one in the flash access guard `0x50000735` at `0x50000766`
  (D). The guard, which the NAND access `0x500022c2` calls for each write and erase, accepts a range `[a0, a0 + d0]`
  (NAND address, length) only inside `[0x40090000, 0x41ec0000]`, `[0x4e420000, 0x4e460000]` (the window `0x50000766`
  opens) or `[0x4e820000, 0x50000000]`, or with op `0x10101`; anything else logs "[FLSH]Flash Access Guard Error!!!"
  and halts (D, `0x50000735..0x50000803`). So at run time the sound index may be rewritten and the firmware blocks may
  not. That address lies past every block the updater carries (the three data blocks, resources `blk02000000`, large
  data `blk05a00000` and images `blk0e360000`, tile `0x41ec0000..0x4e3e0000`; the main code block loads at
  `0x50000000`, the misc block at 0 and the SCPU image at `0x08000000`; D from the `.BIN` headers), and no RIFF/WAVE
  data is in any of the six E143 blocks beyond three 4-second header templates at `0x60dc7cdc`, `0x60dc7d68`,
  `0x60dc7e54` (X). So where the camera keeps its operation sounds is unknown (?); om-c never uses them and embeds its
  own.
- **Volume.** The audio driver copies 48 kHz stereo PCM16 sound data to its output buffer through the converter
  table's plain entry `0x50aa7439` (d0 the source, d1 the destination, a0 the length), a wrapper whose call at
  `0x50aa7445` goes to E143's memcpy (run-time `0x5000290a`, notation `0x3ffe18ea`, `emu/src/fw/place.mjs`; D). om-c
  redirects that copy for its sound range to a 126-byte routine that shifts the samples (0, 6.25, 12.5, 25, 50, 100 %;
  their statement, I).
- **Settings and menu.** The slot (Off / 1 / 2 / 3) and volume (0..5) live in stock settings 1021 (`MODE_ELECTRIC_BEEP`)
  and 827 (`MODE_SHUT_SOUND_VOL`), names from the stock name table (X; om-c's menu code compares keys with both, D),
  read and written through the property getter `0x503ee3bf` and the setter entry `0x503ee40d` (D: its `movm` prologue;
  om-emu's settings spec cites the body at `0x503ee412`). Whether the stock OM-1 uses either id is ?. The two camera
  rows (modes 6001 / 6002) sit on Setup page 2 below Copyright Info; adding them touches the page record, its row-order
  list `0x614da2f4` and six other per-mode tables (`0x614cc96c` caption, `0x614de710` handler, `0x614e092c`,
  `0x61518b7c`, `0x61566b00`, `0x614c294c`; the last four ?), `app_check_mode`'s registry (3.6) and SettingController
  API slots +4 / +12 / +28 / +32 / +40, which om-c redirects to serve its rows (D for the stock structures; om-emu's
  `menudata` decodes the patched page, X).
- **Placement.** om-c's code (six sections of 66 to 242 bytes) and the WAVs (a stated budget of 291,584 bytes for three
  slots) sit in the `0xff` tail of segment 1 that its loader edit brings in (3.1).

Their own limits (D, `release.json` and `SHUTTER_SOUND_KO.md`): at most 50 sound requests a second, none in SH1 and
Pro Capture SH1 (drive 4, submode 1), a sound restarted on each frame in a burst, the real capture rate unchanged; a
user heard the earlier single-sound build (R22) on an OM-1, while the volume, the three slots and the menu text are
unverified on a camera.

For om-emu this is a map of the operation-sound path from shooting to the play method and the resource tables, and it
says that the lab's silence at S2 is the stock behaviour, not a lab gap (I, strong: no play call, no audio MMIO).
Running the engine natively still needs the audio driver blocks and the sound data (`docs/hle-gaps.md` 4.5).

## 5. Their verification against om-emu's

om-c's "native" checks are partial runs of stock functions in the GNU MN10300 simulator over prepared memory, with
stubbed property and lens back ends; its notes state the limits plainly (no kernel, no real allocation or bus
completion, no camera boot) and keep hardware results separate (D, `VERIFICATION_KO.md`, the validation JSONs).
It ran the simulator with non-strict alignment "because of a known SETLB problem" (D). As far as can be recalled the
GNU simulator loads LIR with a data `load_word(PC+1)`, which traps under strict alignment when PC+1 is unaligned (I,
the source was not re-read). om-emu fills LIR with a code fetch, no alignment check (`emu/src/core/cpu.mjs:246`,
`interp.mjs:496`, D), and runs that case all the time: E143's hottest loop has SETLB at `0x503da0e0` (run
`0x603fb100`, PC+1 = 1 mod 4, D). No CPU change follows; the ISA vectors use an aligned base, so only the firmware
runs pin the unaligned case.

| | om-c | om-emu |
|---|---|---|
| Engine | GNU MN10300 sim, non-strict alignment | pure JS, misaligned data access faults |
| Scope | function slices with prepared memory and stubs | the whole camera on four cores, stand-ins named |
| Stock pinning | input sha256 and per-patch before-bytes | `BLOBS.sha256`, `rom_sha256`, golden digests |
| Camera | user reports per feature | none |

## 6. What om-emu takes and what it does not

**Takes** (facts and addresses, attributed): the checked addresses of section 3 and 4 as leads; the setting-rule
engine's formats, `app_check_mode`, the API slot names and the literal widening for the settings and menu specs; the
lens-protocol ring extension and the `81 10` start command for S-LENSMCU; the OLNET_PRM channel path and the radio
facts for `docs/a53-spec.md` and `docs/hle-gaps.md` 4.11; the sound path for 4.5; the independent digest check of the
survey.

**Does not take:**

- **Code and assets.** No Python, assembly templates, base64 blobs, patched images, WAVs (its default "meow" and a
  camera-shutter clip it cut from a freesound recording), fonts or Korean translations. om-c's Korean records were
  read only to test om-emu's readers and are not fixtures.
- **Running it.** Neither the tool nor its bundled runtime was executed; om-emu has no camera-write path and gains none.
- **Its download source.** For all bodies but the OM-5 II the tool fetches stock firmware from a third-party mirror,
  `ofu.infinityfreeapp.com`, which answers with an AES cookie challenge the tool solves; only the OM-5 II uses the
  official `fw01.om-digitalsolutions.net/ww_inform/fcache.do` that `tools/omfw_download.sh` uses (D, `engine.py`,
  `omds_catalog.py`). om-emu keeps the official endpoint and its digests.
- **Its feedback server** (`db-firmware-support.vercel.app`, `release.json`): no network service of the tool is used.
- **Its hardware claims as evidence**, beyond saying they exist.

## 7. Where it corrects om-emu's docs

1. `docs/firmware-container.md` names flag `0x0107` "sounds"; on E143 that block (`blk0e560000`, load `0x08000000`) is
   the SCPU image (`docs/om1-scpu-spec.md`; D).
2. `docs/hle-gaps.md` 4.4.2 says `0x502afe5a` returns 1 when ID byte 0 is 0 and byte 1 is not 0; the code returns 1
   when both are 0, and `0x502afea2` when byte 0 is 2 or 3 and byte 1 is 0 (D, `0x502afe5a..0x502afebb`).
3. `docs/a53-spec.md` section 1 (bcmdhd, CYW43455) holds for E143 only: E146 ships brcmfmac with `cyfmac43455-sdio`,
   E147 brcmfmac with `cyfmac43439-sdio` (2.4 GHz only) and no `bcmdhd.ko`, though both `isc_olnet`s keep the old
   insmod strings; E148 runs Linux 5.10.197, 32-bit ARM, brcmfmac with CYW43439 (D, the rootfs listings; which driver
   runs is I).

## 8. Open questions

- What the OM-1's own operation sounds are: the type-2 resource area at NAND `0x4e420000` is outside the updater, in a
  window the flash guard leaves writable (4), and the lab plays a lab-made area in its place (2026-11-02,
  `docs/hle-gaps.md` 4.5); what the play method's id `0x10501` lookup returns; what the vtable +68 query (isThroughSound,
  the fwmap labels) answers at S2 and why IOlyApiShooting asks it there.
- Whether stock E143 uses settings 1021 and 827 at all.
- A real ring lens's ID bytes, its flags byte and its answer to `81 10`; what record +119168 and +9444 bits mean;
  whether OM lenses ignore p2 bit 0 (om-c's 2-bytes-short path suggests so); the ring value's unit.
- The SH2 code guards' roles, the readers of the drive-detail lists and the other users of the items at `0x61514148`.
- What `app_check_mode`'s callbacks test row by row, and the four unnamed per-mode tables.
- OLNET_PRM mode 5, the `C:` device of `WFCL0%03d.BIN`, and whether brcmfmac accepts the Broadcom `X*` country codes.
- The E-M1X and E-P7 edits (not examined).

## 9. Follow-ups, ranked

1. **The three doc corrections of section 7.** Size: an hour. Payoff: removes three wrong statements.
2. **The setting-rule engine in `docs/om1-settings-spec.md`**, with a firmware test of the 15282 run (15282 = 1 through
   the native setter turns 2035 / 2037 to 250; 15282 = 2 and a raw write as controls). Size: a day. Payoff: a
   documented and pinned mechanism behind the SH2 lens cap.
3. **The operation-sound path in `docs/hle-gaps.md` 4.5** (section 4), and a search for the source of `0x4e420000`.
   Size: a day for the doc, open-ended for the data. Payoff: states that the silent S2 is stock and names what a native
   operation sound needs.
4. **A Panasonic lens profile for S-LENSMCU**, chosen by option, with the default lens unchanged: maker byte 2, an
   answer to `81 10`, and optionally the p2-bit-0 ring field at +12; a firmware-free unit test of the frame layouts and
   a firmware test that the start completes and the poll stays `[00 06]`. Size: 1-2 days. Payoff: a second lens path
   in the lab and a test that the stock firmware ignores the ring.
5. **`app_check_mode`, the API slot names and the literal widening in `docs/om1-menu-spec.md`**. Size: half a day.
6. **OLNET_PRM and the channel path** in `docs/hle-gaps.md` 4.11. Size: half a day. Payoff: the parameter block a
   virtual Wi-Fi client would meet.
7. **One line on SETLB in `docs/mn10300-isa-spec.md` 4.12** (section 5). Size: minutes.
