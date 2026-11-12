# OM-5 (E144 v1.2) vs OM-5 Mark II (E148 v1.1): byte-grounded difference inventory (2026-11-12)

Raw facts for a port specification (porting E148 features/menu to the OM-5 body). No port plan here, no patched
images, no hardware claims beyond what the bytes show: everything below is reproducible with `reproduce.py`
(static analysis only; nothing was executed on a camera, no updater was run). Tags: **X** produced/measured here
(the command is in `reproduce.py`), **D** read from the firmware at the cited offset, **I** inference, **?** unknown.
"Block offset" means the offset in the DESCRAMBLED block body; run-time addresses are `block offset + 0x60021020`
in the main code block of either build (both assume the same base, `docs/model-survey.md`).

Inputs (pinned; `reproduce.py` refuses to run on any other bytes):

| File | Bytes | SHA-256 |
|---|---|---|
| `fw/OLY_E_144_1200_0000_0000.BIN` (OM-5 v1.2) | 92,274,688 | `a0c91f3ac7caaf0925b2af609e711183cf3b5982b3333224bcef26c0c5943d11` |
| `fw/OLY_E_148_1100_0000_0000.BIN` (OM-5 II v1.1) | 90,832,896 | `9de5d77e1d290fa2ed4ebc7d75cee0ed490befbc89566722467d1d421d66d637` |

Both digests match `BLOBS.sha256`. Method: block walk/descramble/sum32 via the repo's `tools/olyfw.py`; the main
blocks' `olycompress` spans are expanded by this package's own LZ4 block decoder (`tools/om5diff.py`), whose output
was cross-checked byte for byte against the repo's own `emu/src/fw/expand.mjs` `expandImage()` (identical SHA-256,
X); everything else is this package's Python reading bytes. One full `reproduce.py` run regenerates every evidence
file; a second run produced a byte-identical `evidence/evidence.sha256` (X).

## 1. Container and blocks

All five blocks of each file pass the u32 sum32 checksum and the head[:28] == tail[:28] agreement
(the rule the E143 updater checks per `analysis/oly-fw-analysis/README.md` 2.2). Container head fields
(`docs/firmware-container.md`): type `OE`, **model nibble pair `1440` (E144) vs `1480` (E148)**, version BCD
**`0x1200` vs `0x1100`** on the main block.

| # | flags | role | E144 file off | E144 load | E144 len | E148 file off | E148 load | E148 len | delta |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0x0100 | main code | 0x00000000 | 0x40780000 | 24,903,616 | 0x00000000 | 0x40780000 | 24,903,616 | 0 |
| 1 | 0x0101 | resources (18 languages) | 0x017c0000 | 0x42140000 | 14,024,640 | 0x017c0000 | 0x42140000 | 12,582,848 | **E148 −1,441,792** |
| 2 | 0x0106 | large data (Linux payload, NN models) | 0x02520000 | 0x42ea0000 | 45,744,064 | 0x023c0000 | 0x42d40000 | 42,598,336 | E148 −3,145,728 |
| 3 | 0x010e | misc/secondary loader | 0x050c0000 | 0x00000000 | 262,080 | 0x04c60000 | 0x00000000 | 262,080 | 0 (but 115,500 bytes differ) |
| 4 | 0x0102 | images (updater bitmaps) | 0x05100000 | 0x45cc0000 | 7,339,968 | 0x04ca0000 | 0x45c20000 | 10,485,696 | **E148 +3,145,728** |

Block body digests (all 10 equal the `BLOBS.sha256` pins, X) are in `evidence/evidence.sha256`'s source commands;
the per-file list is in `reproduce.py BLOCK_SHA`. The two 0x010e blocks have a 995-byte identical prefix, first
difference at 0x3e3, 115,500 differing bytes of 262,080 (`evidence/misc_block_diff.csv`).

**Main-block internal layout is isomorphic (D).** Both main blocks carry a `BCS\0` boot-section table with 10
12-byte rows `{dst, src, flag}` — byte-identical content, at offset 0x6fd8 (E144) / 0x74d8 (E148, +0x500); the
uncompressed head below the first span is 0x500 bytes shorter in E144. flag=1 marks the two `olycompress` spans,
at the SAME offsets in both builds:

| span | block offset | raw size | E144 packed | E148 packed |
|---|---|---|---|---|
| A | 0x825fe0 (dst 0x60847000) | 0x477800 | 0x22656d | 0x22556f |
| B | 0xc9d7e0 (dst 0x60cbe800) | 0x685000 | 0x292a5d | 0x262bf4 |

Raw span sizes are equal; only the packed payloads differ (E148 compresses ~200 KB smaller — compression input
still differs, X). Expanded images: 24,903,616 bytes each; SHA-256 E144 `692f1b9e…`, E148 `7ae7d4c6…` (pinned in
`reproduce.py`). Whole-image byte equality: expanded 5,491,417/24,903,616 = 22.05 % (1,243 differing regions after
merging gaps <= 64 B, `evidence/expanded_main_diff_regions.csv`); the uncompressed head region 0x00..0x825fe0 alone
is 21.94 % equal. These are full rebuilds, not patched builds.

## 2. Hardware-facing differences

- **USB (D).** Both builds name the same USB IP registers (`USBIP_GUSB2PHYCFG0`, `USBIP_GUSB3PIPECTL0` — a DWC3-class
  gadget IP) and both carry a cluster of 8 descriptor-template rows with **bcdUSB 0x0300** (12 01 00 03 …) at block
  offsets 0x15bae53 (E144) / 0x15bf68f (E148), nearly identical bytes (164/224 equal in the surrounding window).
  No xhci/dwc3/ehcd/SuperSpeed strings in either main block. New E148 *menu* strings (not drivers): "USB Webcam"
  (sid 4748), "USB Settings" (4570), "Power Supply from USB" (4569), "USB @A087@ Control" (`evidence/res_enu_diff_added.tsv`;
  text list `res_enu_textnew_in_E148.tsv`).
- **Wi-Fi (D, with an unresolved half).** E148's 0x0106 block contains readable `cyw43439-brcmfmac-v5.15.58-2023_1128`,
  `brcmfmac43439-sdio.clm_blob`, CYW43439 firmware name fragments (`43439a0-roml/sdio-g-pool-p2p-pktfilter-keepalive-aoe-lpc`)
  and kernel refs 5.10.197 / v5.15.58-2023_1128-0-g4dfc3616ef88 (offsets in the command log; fragments because the
  payload is lightly compressed). E144's 0x0106 carries the same class of stack (`mn-sdio.ko`, `cyw…softap`, `brcm_p…`,
  buildroot path `…S0101_20220714/PF20/src/buildroot`, `GLIBC_2.7`) but **no visible chip number and no 5.10/5.15
  version strings**: its payload is compressed differently (one squashfs 4.0 at block off 0x216cfe0, bytes_used
  0x435929; E148 has one valid squashfs at 0x1b6ffe0, bytes_used 0x8bc0de, plus one stray magic inside it).
  So E148 = CYW43439/brcmfmac is byte-evidenced; **E144's radio chip is UNRESOLVED here** (consistent with the
  om-c study §7.3, which lists chips only for E146/E147/E148).
- **Bluetooth (D).** Both main blocks hold 184 "bluetooth" strings; E148 adds the user-visible rows "…/Bluetooth
  Settings", "Bluetooth power-off standby so images can be imported while power is off", "Reset all … and Bluetooth
  settings" — 17 new enu texts matching /Bluetooth/ (text-keyed; on 11 new sids 4019/4020/4225/4226/4322/4323/4324/
  4429/4435/4547/4580), i.e. BT settings surface in the menu, and BLE rows grow 69 → 102.
- **Display (D, repo).** Same panels per `emu/src/fw/models.mjs` (TFT 720x480, EVF 1024x768) and both modelcheck on
  them (`docs/model-survey.md` finding 65). No panel-name strings differ.
- **RAM (D, repo + X census).** Board family identical (`board: { family: 'E144' }` for E148 in `models.mjs`; MMIO
  ISC 0x8fe00000, VSC 0x9c000000). `board.mjs` gives the family DRAM end 0xb0000000 (256 MiB). Literal census over
  the expanded images (`evidence/ram_literal_census.csv`): scratch 0xa2xxxxxx literals 8,576 (E144) vs 8,537 (E148);
  image-range literals 654,000 vs 604,424. No SDRAM-init table difference found at string level (20 'SDRAM' strings
  each side, 20/20; count corrected in review 2026-11-12).
- **Sensor/ISP: nothing byte-visible** (?). No sensor part-number strings in either expanded main block (1 'IMX'
  hit each, in unrelated data). Sensor differences would live behind the ISC driver; not further resolved.
- **Extras (D).** No GPS diff (both carry the shared GPS module code, TG-family: 341/352 'GPS' strings). The E148-only
  menu work names new hardware-facing features: **Fn Lever** power assignment strings ("Assign power to Fn Lever as
  follows: Position 1 … Position 2 … Power Lever is disabled"; main-block 'lever' strings 74 → 96), and **Airplane
  Mode** rows. The misc 0x010e secondary loader is rewritten between builds (same head `00 04 00 00 00 5a 03 00`,
  same strings shifted internally).
- **Images block (D).** E148's 0x0102 updater-graphics block is 3 MiB larger with its own index (126 entries, first
  records 0x2600 B each in E144 vs 0x1a00 B in E148); no JPEG/RIFF containers found by magic scan (one PNG magic
  each side; custom bitmap form).

## 3. Menu and settings

**GUI framework (D).** E144 has **zero** `Menu_ListMenu_*` strings — its menus are the Menu_Viewer/Cursor framework
(`Custom_Menu_Viewer::…` at block offsets 0x12271xx, `Menu_Viewer::…`). E148 adds the ListMenu class family:
`Menu_ListMenu_Group_Level_VM_Actuator::Initialize this->kind =%d` (0x11bcc8c), `Menu_ListMenu_Group_Level_Viewer
not supprt 2ND_TYPE : %d` (0x11bfa24), `Menu_ListMenu_Tab_Menu_VM_Actuator::Initialize …` (0x11c3798),
`Menu_ListMenu_Tab_Menu_Viewer not supprt 2ND_TYPE : %d` (0x11ca476), plus `Menu_Viewer` still present (0x11ded9f).
This matches `docs/model-survey.md` finding 65 (E148's ListMenu tab/page memories 1909/1910 read at vtable slot 8,
E147's ids; 0x50e77adb/0x50e77afb there).

**String tables (X, D).** Both resource blocks have 38 index entries = 18 language tables + fonts/icons. Per language:
**4,013 strings (E144, sids 0..4012) vs 4,909 (E148, sids 0..4908)** — E148 appends sids 4013..4908 with **zero
removals**. For `enu` (record 5 in both): 896 sids added, 0 removed, 621 same-sid texts changed in place; text-keyed:
**1,196 texts new in E148, 436 texts gone** (rewordings). Evidence: `res_lang_table.csv` (every record's tag and
count), `res_strings_E1xx_enu.tsv` (full enu tables by sid), `res_enu_diff_added/removed/changed.*`,
`res_enu_textnew_in_E148.tsv` / `res_enu_textgone_from_E144.tsv`. Parsing mirrors the repo's `StringTable`
(`emu/src/lab/resources.mjs`): header {first,end}, pointer array, `OlympusLanguage_XXXtft` tag; the per-record slot
base is derived from the tag position (0xA502B680 does not hold on these bodies). CJK text decodes with the same
parser but was not separately diffed (bounded below).

**Representative new-feature rows in E148's enu table** (sid = string id, from `res_enu_diff_added.tsv`):

| sid(s) | text (abridged) | reading |
|---|---|---|
| 4014 | "Press button to select a face close to the selected AF target point. Press down button and turn dial to select manually." | AF-target by face |
| 4018 | "The focus direction and position will appear when the focus ring is rotated in MF mode." | MF focus helper |
| 4019/4020 | "Activates Bluetooth…" | BT on/off rows |
| 4023..4030 | "@A02C@/@A02D@Card Error", "@A02C@/@A02D@Write Protect" | per-slot card errors |
| 4031/4032 | "Focus stacking error. Image composite failed." / "High res shot error…" | composite error paths |
| 4037..4042 | "Live ND Shooting : ND2(1EV)" … "ND64(6EV)" | Live ND value rows |
| 4044..4046 | "Brighten/Shadow/Midtone Area Adjust" | area adjustments |
| 4053..4055 | "Starry Sky AF is Running" / "Starry Sky AF" / "Starry Sky AF + MF" | Starry Sky AF rows |
| 4062..4065 | "Blur Effect: Left and Right" / "Shade Effect: …" | blur/shade effects |
| 4067 | "Playback Frame Rate" | new playback row |
| 4072/4073 | "AF Focus Adjustment" / "Fine-tuning Value" | **AF fine-tuning** |
| 4080 | "Airplane Mode" | radio row |
| 4088 | "BULB/TIME/COMP Settings" | bulb/comp settings |
| 4365 | "Fn Lever Settings" | Fn Lever rows (see also 4366.. "Assign power to Fn Lever…") |
| 4569/4570/4748 | "Power Supply from USB" / "USB Settings" / "USB Webcam" | USB rows |
| 4706..4718 | "Live GND : GND2(1EV)" … "Live GND Shooting", "GND Number" | **Live GND (gradated ND)** rows |

Feature census (keyword → row counts, `evidence/feature_census_enu.tsv` and `..._ascii.tsv`): GND **0 → 15** enu rows
(main-block strings 3 → 52), High Res 3 → 12, Focus Stacking 2 → 6, Live ND 7 → 14, Bluetooth 16 → 23, USB 11 → 18,
BLE 69 → 102, AF Focus Adjustment 0 → 2, Webcam 1 → 2, Starry 5 → 9, Airplane 2 → 4, Lever 24 → 30. GPS 9 → 9.

**Registries (partial).** The `app_check_mode`-style row-disable registry (12-byte rows `{u16 mode, u16, u32 ptr,
u8 n}`, om-c study §3.6):

- **E144 (D):** base literal `mov 0x60bcc594,d0` at expanded offset 0x8fe0c8 (literal @0x8fe0ca; offset corrected
  in review 2026-11-12) followed by the bound `cmp 667,d3` (`CB 9B 02`) at 0x8fe0da → **667 rows** at block offset
  0xbab574 (E143 has 637, for scale). A bridged shape scan passes 652 of them (`evidence/scan_appcheck_E144.tsv`);
  650 distinct mode ids.
- **E148 (D, partial):** a parallel region exists (strict run of 357 rows at 0xbab084 first mode 3356; a row with
  mode 23 anchors 336 more at 0xbab4e0) but **no count-compare was located and the row scan truncates — the E148
  registry's row count is UNRESOLVED in this pass**.
- A second parallel mode table: E144 at 0x477b78 (461 rows bridged) vs E148 at 0x475110 (440 rows, first modes
  `24, 15205, 3010, 15258, 1482, …` vs E144's `24, 15205, 3008, 15258, 1446, …`). Their mode-id sets differ
  substantially (~190 ids each side) but both scans are truncation-prone, so the set diff is NOT reliable raw
  material. Provenance note (review 2026-11-12): these two scans are session-derived — the committed
  `scan_descriptors_E1xx.tsv` files are 0 bytes, so the 461/440 numbers above are not in committed evidence; the
  content was independently re-verified in that review.
- The E143-style 20-byte settings-descriptor table (`emu/refs/settings.mjs DESCRIPTORS` shape) was **not found** by
  this package's shape rule (runs >= 200 rows) on either build — the rule or the layout differs; UNRESOLVED.

## 4. Code-base kinship

- Repo cross-build maps (X, `bin/port.mjs`, cited from `docs/model-survey.md` finding 65 and `models.mjs`): the E148
  map from **E144 pairs 9,503,564 instructions** (41 conflicts), from E143 only 2,471,331 — E148's hardware layer and
  most of its application are E144's build.
- Own byte probes (X, `evidence/kinship_samples.csv`), window = 96 bytes before / 128 after the first code reference
  of each anchor string:

| anchor (log string) | str block off E144/E148 | code ref E144/E148 | prefix= / suffix= | equal/224 |
|---|---|---|---|---|
| `[FLSH]Flash Access Guard Error!!!` | 0x3ed4 / 0x43d4 | **0x819 / 0x819** | 20 / 55 | 212 |
| `OlyTaSS` | 0x56b00 / 0x57414 | **0x30a15 / 0x30a15** | 20 / 3 | 211 |
| `USBIP_GUSB3PIPECTL0  :` | 0xf545ce / 0xf3b425 | 0xcb91c4 / 0xcb8f18 | 1 / 7 | 164 |
| `ch illegal range (0-13):` | 0x15105ef / 0x15144b9 | 0x1408457 / 0x140a55e | 18 / 3 | 184 |
| `- uITRON Error Code  -` | 0x1640842 / 0x1641360 | 0x15f24d2 / 0x15f296a | 1 / 1 | 156 |
| `app_check_mode():mode=%d,check=%d,status=%d` | 0xbad61c / 0xbac4bc | 0x8fe04a / 0x8fdf29 | 0 / 0 | 17 |

  Low-level kernel/flash-guard code is byte-stable at the same offsets; Wi-Fi and the app_check_mode checker are
  heavily reworked (E144's string `app_check_mode_card_setup` at 0xbadb88 has no E148 counterpart).

## 5. Updater acceptance

- The E148 container identifies itself as model `1480`, version BCD 0x1100, five blocks each passing the sum32
  checksum and the head/tail 28-byte agreement (X, section 1). In the expanded images the Exif model-name string
  follows the body: UTF-16LE `OM-5` at block offset 0x68390 (E144) vs `OM-5MarkII` at 0x698f8 (E148).
- **What the OM-5's own updater checks is UNRESOLVED here** — its validation code was not read. Prior repo facts,
  other bodies only: E143's updater compares the first five head/tail words (error `0x3202`) before the checksum and
  maps block-type letters to `0x3210..0x3213` (`analysis/oly-fw-analysis/README.md` 2.2); `analysis/nd128/README.md`
  notes passing checksums prove only local well-formedness. Nothing in the repo states the E144 updater's
  model/version rules; extrapolating them from E143/E122 is not done.

## 6. Bounded absence / UNRESOLVED (explicit)

1. **E144's Wi-Fi chip number** — not byte-visible (compressed 0x0106 payload); only E148's CYW43439 is evidenced.
2. **E148's app_check_mode row count** — registry region found, count-compare not located.
3. **Settings-descriptor table** (20-byte row shape) — not located on either build by this rule.
4. **Sensor/ISP differences** — no byte-visible strings; not resolved further.
5. **Mode-id set diff of the second table (0x477b78/0x475110)** — scanned but truncation-prone; treat as raw data.
6. **CJK/jpn resource strings** — decoded but not diffed as text (only sid counts; identical 4,013/4,909 structure).
7. **E144-family updater acceptance rules** — not read; see section 5.
8. **Block 0x0106 contents beyond the samples above** (NN models, rootfs detail) — not inventoried record by record.

## Evidence index (all under `evidence/`, digests in `evidence.sha256`)

`ascii_strings_E1xx.tsv`, `utf16_strings_E1xx.tsv` (every string with its block offset); `strdiff_ascii_E1xx_only.tsv`,
`strdiff_utf16_E1xx_only.tsv` (content-keyed one-sided strings); `res_lang_table.csv`, `res_strings_E1xx_recNNN.tsv`,
`res_strings_E1xx_enu.tsv`, `res_enu_diff_added.tsv`, `res_enu_diff_removed.tsv`, `res_enu_diff_changed.csv`,
`res_enu_textnew_in_E148.tsv`, `res_enu_textgone_from_E144.tsv`; `scan_descriptors_E1xx.tsv`,
`scan_appcheck_E1xx.tsv`; `kinship_samples.csv`; `feature_census_ascii.tsv`, `feature_census_enu.tsv`,
`ram_literal_census.csv`; `misc_block_diff.csv`, `expanded_main_diff_regions.csv`. The dumps under `blocks/` are
regenerated by `reproduce.py` and are not committed.

Run everything with: `py -3.11 analysis/om5_port_inventory/reproduce.py` (needs only `fw/` and the repo checkout).
