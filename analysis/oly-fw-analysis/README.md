# fishcu/oly_fw_analysis: a study for om-emu (2026-10-29)

[fishcu/oly_fw_analysis](https://github.com/fishcu/oly_fw_analysis) (read at commit `539fcf1`, 2026-10-18) is an
analysis of Olympus / OM System firmware centred on the PEN-F build 3101 (om-emu's E122, the E118 family). Its two
alpha releases (2026-10-13, 2026-10-17) are patched PEN-F firmware that adds Hue and Lightness to the camera's
twelve-sector COLOR saturation editor. This note answers what om-emu can take from it: their boot, container,
colour, settings and protocol findings against ours; their patching and safety method against the firmware-patch
track; whether an HSL-style unlock has an analogue on the OM-1 (E143); their emulator against ours; and where the
two disagree. It ends with ranked follow-ups.

How it was read: the repository was cloned read-only outside the tree and its documents, patch manifest
(`patches/hsl/pen-f/patch.json`), assembly sources and analysis JSON were read; none of its code (Python tools,
camera client, builder) was run. The 2026-10-17 release archive was then downloaded with the user's consent, its
sha256 checked against the release's, and its two images diffed statically against our stock E122 (3.1 below); it was
never run. Every cross-check below was made on om-emu's own pinned images with small pure-JS scans and the VM's
`mn10300-objdump`; no excerpt of either is committed.

**Licence.** Its `RIGHTS-AND-PROVENANCE.md` says the analysis tools and writing carry **no repository-wide licence**;
only the GNU MN103 runner and simulator changes are GPL-3.0-or-later. So nothing here is copied or closely
paraphrased: ideas only, attributed to fishcu/oly_fw_analysis where used.

Related notes: [ND128 experiment](../nd128/README.md), [lens-gated features](../lens-gates/README.md),
[feature gap OM-1 vs OM-1 Mark II](../feature-gap/README.md), [the .BIN container](../../docs/firmware-container.md).

**Addresses.** Their PEN-F addresses are run-time addresses for code and data alike (block offset + `0x60021020`);
om-emu writes code as block offset + `0x50000000` (`docs/README.md` "Addresses"), so om-emu's E122 code address =
theirs - `0x10021020` (their USTART1 `0x601a70cc` is om-emu's `0x501860ac`). E122 addresses below are in their
run-time form unless marked "om"; E143 code addresses are in om-emu's notation, data run-time. Tags as in the specs:
**X** executed or measured here (the scan or command is named), **D** read from the firmware at the cited address,
**I** inference, **?** unknown. "Their N / C / physical" reports their own evidence class (native slice, connected
replay, a camera).

## Short answer

1. **Reliability.** Eighteen of their PEN-F claims checked against our stock E122 (same SHA-256) all hold, none is
   contradicted (section 1). Their addresses can be used as leads with a quick check each.
2. **What om-emu lacks.** For the E118 family's board port they supply the inter-CPU doorbell block, its IRQ and the
   kernel kick (verified here: 4 of the 18 unknown board facts), the meaning of the head's one copy from outside the
   `.BIN` (the persistent-parameter flash), and a boot order to aim at; they say nothing about the VSC, the OSD
   engine, the timer or the SCPU, which is most of what blocks the import. Their container decoding matches
   `olyfw.mjs` and adds one check we lack (head and tail agree). Their colour, settings, Wi-Fi and USB maps have no
   counterpart in om-emu.
3. **HSL on the OM-1.** E143 holds the identical 3,028-byte COLOR table and a COLOR builder call of the same shape
   (`0x504f4cfa`), and its Color Creator 2 settings are saturation-only, as stock PEN-F. The structures for an
   HSL-style unlock are there; porting their design is weeks of mapping, and the lab cannot yet run the builder in a
   session (it can as a function slice).
4. **Emulators.** Theirs is a strict GNU-simulator harness for function slices and a partial three-core boot; ours is
   a full-system emulator. Their largest known CPU gap, unaligned access, is a fault in om-emu, and their camera
   restart from a misaligned structure is physical support for that choice.
5. **Disagreements.** No factual one found; two of framing (licence, where the head runs) in section 6.

## 1. Their claims against our E122 image

Stock identity: their pinned main payload `a2eb1d1f...13f4` is om-emu's `rom_sha256` for E122 and the container
digest `77398610...9f2c` is `BLOBS.sha256`'s (X).

| # | Their claim (PEN-F 3101) | om-emu evidence | Tag |
|---|---|---|---|
| 1 | Four OE components; resource directories at logical `0x41800000` (OSD), `0x42e00000` (common), `0x46160000` (pictures) | `tools/olyfw.py`: blocks at load `0x403a0000`, `0x41800000` (`0x0101`), `0x42e00000` (`0x0106`), `0x46160000` (`0x0102`), all checksums pass | X |
| 2 | Main payload's container address `0x403a0020` | `resetHead` (`src/fw/facts.mjs`) `flash_base` `0x403a0020` | X |
| 3 | Startup copies `0x648` bytes from `0x6002f020` to `0x61170fe0` | `resetHead` preload row 0: file `0xe000`, `0x648` bytes, to `0x61170fe0` | X |
| 4 | 6 KiB of helper code relocated to `0x47000800..0x47002000` | `resetHead` library: window `0x47000000`, page offset `0x800`, `0x1800` bytes | X |
| 5 | Logical flash read routine `0x600224c2` | the head's flash copies all call it (head offsets `0x1ab`, `0x1d0`, `0x2ff`) | D |
| 6 | Eight section descriptors at `0x60026d7c` (section 3: flash `0x407b1800` -> `0x60432800`) | the 12-byte records `{dst, flash, dst}` hold exactly their eight; every section lands at base + its file offset | D |
| 7 | CPU 0 initial task `0x6006ad97` | port fact `rtos.init_task` `0x50049d77` (om) | X |
| 8 | UI_IN task `0x60197dbe` | port fact `ui_in.task` `0x50176d9e` (om) | X |
| 9 | Three cores; board revision byte `0x8ff00188` | port facts `kernel.cpus` 3, `board.core_byte` `0x8ff00188` | X |
| 10 | Inter-CPU doorbells `0x99200308` / `0x99300308` (set) and `+0x30c` (clear), IRQ 120 | stores to `+0x308` of all three banks at `0x6006c569..0x6006c735`, a per-CPU table of the three at `0x60094540`; IRQ 120 attached three times at level 2 at `0x6006bea9..0x6006bedb` with handlers `0x6006c73f`, `0x6006c840`, `0x6006c944` (one per CPU), which clear `+0x30c` | D |
| 11 | Early kernel notification writes `+0x310` per CPU | three routines `0x60030091`, `0x600300b3`, `0x600300d5`, one per sending CPU, each write 1 to `+0x310` of the target CPU's bank (one of the other two, chosen by `d0`) | D |
| 12 | Cross-core request slots of 52 bytes, 31 per CPU, stride `0x64c`; operations 3 set flag, 7 signal, 8 wait semaphore | the same layout and kind numbers as E143's cpu_conn (`docs/om1-cores-spec.md`, pool `0xa3258364 + 0x64c * core`) | D (E143), their C (E122) |
| 13 | Type/value conversion descriptors `0x603dffcc`, 968 x 20 bytes | the records parse in exactly E143's descriptor form (`emu/refs/settings.mjs`: id, key 128, allowed and values pointers, bytes, element 64, type 6) | D |
| 14 | COLOR table `0x60622d74`, 3,028 bytes; HSL hook at `0x604f7506`, rejoin `0x604f750b` | the table's one absolute reference is `mov 0x60622d74,a0` at `0x604f7500`; `0x604f7506` is the 5-byte call of the builder `0x604f7272` right after it | D |
| 15 | SD updater task 95, descriptor `0x6003a128`, entry `0x60b1cbb5` | the entry word is at `0x6003a134` = descriptor + 12, in the static task table with the other entries they name | D |
| 16 | Stale main checksum rejected with error `0x3211` | `0x60b1cae7..0x60b1cb13` maps a block type letter `A`/`E`/`L`/`F` to `0x3210..0x3213`, default `0x3203` | D |
| 17 | The HSL build's stock inputs (153 main ranges with a before-hash each, 99 byte edits with their before-bytes) | all 153 hashes and all 99 before-byte strings match our stock main block | X |
| 18 | Job size 14,920 bytes grown to 14,944 | the manifest's edit at `0x604c1c0f` turns `mov 14920,d0` into `mov 14944,d0` (before-bytes matched in 17) | D |

## 2. What they have that om-emu does not

### 2.1 PEN-F boot, and what it gives the E118 family's board port

om-emu's E118 family stops at import: `FAMILIES.E118` (`emu/src/fw/board.mjs`) leaves 18 board facts unknown (the
interrupt controller's presented, IPI, kick and control registers and its IPI, OSD-engine and VSC lines; seven timer
facts; the VSC, the OSD engine and the SCPU), and `src/dev/intc.mjs` reads `intc.irq_osd_engine` at import
(`docs/model-survey.md`). Their connected replay starts at the image entry with the image in RAM and runs native
allocation, scheduling, section copies and peripheral setup on three cooperative cores up to USTART1's camera
controller initialisation, stopping at a read of `0x9b000000` at `0x602a6500` (their C). Concretely, for the port:

- **Doorbells and kick (D, rows 10-11).** `ipi_set` = bank `+0x308`, `ipi_clear` = `+0x30c`, `kick` = `+0x310`,
  `irq_ipi` = 120, per bank `0x99200000` / `0x99300000` / `0x99b00000` for CPU 0 / 1 / 2. It is the block E144 has at
  `+0x408..+0x414` and E143 at `+0x808..` (`docs/hle-gaps.md` 4.6: kick `+0x810`), one step lower on this
  generation. `ctl`: `+0x314` is written at `0x6006ad66` and `0x601a8ac4`, its role is ?. `presented`: ?. The board
  comment "none of +0x408..+0x414: no IPI set/clear, kick or control register" was right about those offsets; the
  registers are at `+0x308..`.
- **The copy from outside the `.BIN` (I).** The head's last flash copy reads `0x80000` bytes from flash `0x40060000`
  to `0x61e72c00` (`resetHead` kind `outside`, "the lab cannot load it"). Their storage model treats
  `0x40060000..0x400e0000` and `0x400e0000..0x40160000` as the persistent-parameter areas and runs an erased case
  (their C), with the lens directory at `0x40240000` and saved-lens data at `0x40160000` falling back to native
  defaults when erased. A board port can therefore serve that copy as erased flash, the blank-camera choice om-emu
  already makes for E143's store.
- **Sections (D, row 6).** All eight sections are in place, so a flat image at `0x60021020` already holds them; the
  loader (USTART1's request at `0x601a72f0`, carried to CPU 1, read at `0x600421e1` / `0x600720e1`) needs only its
  completion, the shortcut `docs/hle-gaps.md` 4.6 describes for E143's overlay loader.
- **Other boundaries their replay had to model** (their C, not checked here): three NAND bad-block table copies of
  8 KiB at `0x47ec0000`, `0x47ee0000`, `0x47f00000` (read at `0x60021c4f`); the ADC block `0x98c00000` (completion
  `+0x14`, channel 6 `+0x54`, channel 7 `+0x58`, IRQ 114); the input controller's level, event and wake words
  `0x98e00068` / `0x98e00050` / `0x98e00048`; PLL readback `0x98800050`, `0x98800100`; a CPU halt by writing 8 to
  `0x8040`; and an auxiliary serial peer the firmware calls "Alex", to which three code blocks are uploaded (97,472
  bytes from `0x60042c00` and two of 2,048) with checksum-half commands `0x66` / `0x67` (its physical identity is ?).
- **Not covered by them:** the VSC, the OSD engine and its IRQ (the fact that stops the import), the timer's tick
  channels and status layout, the SCPU, the display waits and the SD host (their SD mount stops at the media
  controller, `0x98800044` read in `0x605a1ec3`).

So their work is worth a day on the port (the four doorbell facts with this evidence, the erased-parameter source)
and a target boot order (USTART1 -> USTART3 -> USTART4 -> USTART5 -> TPC and FIRMUP_SRV), not the port itself.

### 2.2 Container and update format

Their decoder is an independent implementation of the scheme in `docs/firmware-container.md` (same permutation, XOR
`0xff` and u32 sum; theirs credits Altsoph's mx3 analysis on the CHDK forum). Differences and additions:

- They require the first 28 bytes of a block's head and tail to agree; `olyfw.mjs` does not check that. All 150
  blocks of om-emu's 32 pinned `.BIN`s agree (X, a scan of the packed files), and E143's own updater compares the
  first five words of head and tail before its checksum (`0x510348eb..0x510348f8`, error `0x3202`; D for the loop,
  I that the second pointer is the tail). Their reason is a mirrored E-M1 III 1.2 file whose fifth block has kind
  `ccd8` instead of `0107` while every checksum passes, which they reproduce as a bug of the historical packer.
- The PEN-F updater accepts component-selective files: main only (21,364,736 bytes) or main plus OSD (44,433,408)
  instead of the full 87,031,808, under the name `DCOLYMP/E1229999.BIN` (the suffix selects the file; the build field
  is unchanged), same-version installs included; a combined file programs OSD before main (their N and physical).
- E143's updater maps block type letters to the same errors as E122's (`0x51034936..0x5103496a`: `A`/`E`/`L`/`F` ->
  `0x3210..0x3213`, default `0x3203`; D). Whether E143's validation checks anything beyond the head/tail words and the
  sum is ? (not read).
- USB update (their N with a desktop trace): GetFirmwareUpdateMode `0x911c`, metadata `0x9125` (else `0x100c`),
  split transfer `0x9119` in chunks of at most `0xf800`, FirmwareCheck `0x9121`, CheckStatus `0x9122`,
  UpdateInitiate `0x9123`, carried as Olympus SCSI commands `C0`/`C1`/`C3`. This extends the jove reference in
  `docs/firmware-container.md`. SD and USB end in the same service (FIRMUP_SRV, task 19) in modes 0 (validate and
  write), 2 (check) and 1 (commit).
- Recovery: they found no immutable OK-button boot ROM and no independent USB rescue on the PEN-F, and a separate
  `S122????BIN` BOOT update path (logical `0x80000000`, an alias of `0x40000000`) that shows the boot storage is
  writable (their S and N).

### 2.3 Colour pipeline

- **The COLOR table** (their `docs/color/pen-f/HSL_TABLES.md`): 12 sector records of 28 bytes, ten LUTs and a
  4-byte trailer; the wheel's sector order differs from the record order; Hue's coefficient is -1000 per slider step,
  Lightness a fixed 15-entry table, Saturation sector-dependent gains. The table reaches the ISP as coefficients, so
  no CPU code computes pixels from it.
- **The table across bodies (X, a byte compare).** The 3,028 bytes are identical in 16 of the 17 other ported bodies,
  E143 at `0x606b3d58` (file `0x692d38`) included; E120 (E-M10 II) has no byte-identical part of it. Each of the 16
  but E118 holds exactly one absolute reference to it. E143's is `mov 0x606b3d58,a0` at `0x504f4cf4`, followed by the builder call at `0x504f4cfa` ->
  `0x504f4a81`, after the same picture-mode test (`cmp 11`), the same load of the table's trailer halfword and the
  packed saturation bytes at request + 1479 where E122 has + 1076 (D).
- **Processing jobs** (their `CREATIVE_PROCESSING_JOBS.md`, N): a job owns an embedded 1,132-byte request (kind 0;
  kind 3 is 624 bytes) and sixteen 52-byte operation records; COLOR is one development request, creative MONO three
  outer entries and four requests; a list of the per-unit builders (matrix, six-axis hue/saturation, gamma, chroma,
  twelve-sector HSL, tone, sharpening, grain). This is the kind of parameter-block map `docs/hle-gaps.md` 4.3's seam
  C2 step needs; the E143 counterparts are not located (?).
- **ORF metadata:** their CMIO P (tag `0x0635`, 5,764 bytes) and T (`0x0636`, 119,360 bytes) blocks carry the HSL
  coefficients and a 3,028-byte base table; the lab writes no firmware-developed ORF, so this is reference only.

### 2.4 Settings storage and backup

- PEN-F's setting manager has three registries (callbacks 460 x 60 bytes, consistency rules 275 x 20, type/value
  conversion 968 x 20) over a "Mode store" of type `0x54`, `0x20000` bytes, kept by a halfword-sum validator and
  writer, with nine banks of two 1,274-word parts (their N). om-emu's E143 store (`docs/om1-settings-spec.md`) is a
  data-object registry with a 1,607 x 20-byte descriptor DB; row 13 shows the descriptor records share one form, so
  `emu/refs/settings.mjs` should read E122's with its own table addresses (I).
- Setting ids differ by generation. On E143 (D: the 52-byte name records of `blk05a00000`, placed by ids 1319 / 1320
  of the lens-gates note; X: the descriptors through `emu/refs/settings.mjs`): 111 `MODE_COLORTONE`; 902
  `MODE_COLOR_CREATOR_2_SELECT`; 903-908 sharpness and contrast per set; 909-920 the twelve effective `VIVID` values
  (no descriptor); 921-932, 933-944, 945-956 the stored `VIVID_SET1..3` values, each -5..+5 (defaults 0, nonzero at
  933 / 944 = 1 and 945 / 956 = 4); 957-965 tone control per set, -7..+7. No hue or lightness property exists
  (D). PEN-F's equivalents are 919-930 and 931-966.
- Their H/L storage reuses the second part of each stored saturation setting (a part the COLOR mode filters never
  select), as tagged words that decode to neutral when invalid; it rides the stock bank save, recall and checksum.
  E143's store has the same two rows per id: `0x503ee85c(id, k)` reads `(0x62a65e10)[k * 2129 + id]`, `0x503ee885`
  writes, `0x503ee82b` handles the banks, paired with E122's `0x602f06e7` / `0x602f0710` by the cross-build map (X),
  and its mode-recall lists (`0x605f9134`) select only row 0 for ids 921-956 (X), as E122's do for 931-966 (3.1).
- OM Workspace settings backup: the camera exports named records per bank and Workspace keeps unknown names, so
  extending the exporter and importer adds a record without touching Workspace (their physical test).

### 2.5 Wi-Fi and USB

- PEN-F's HTTP service (OI.Share CGI) has three unadvertised commands, `get_mcon.cgi`, `get_mcon_list.cgi` and
  `set_mcon.cgi`, which read and write setting records by id; the raw setter changes stored records without refreshing
  the live copies, so their extension goes through the application setter instead (their N and physical). E143 holds
  the same three names in its main block (D: strings). For the "virtual smartphone over the firmware's own OI.Share
  API" of `docs/hle-gaps.md` 4.11 this is the command set to target; their PEN-F parser addresses do not carry over,
  as the OM-1's wireless side runs on CPU 1 and the A53.
- USB: section 2.2.

## 3. Their HSL patch and its method, against om-emu's firmware-patch track

**What is patched** (X: the manifest against our stock image; their README for the rest). Seven source groups
(image parameters, editor and storage, RAW development, ORF metadata, settings backup, extended range, Wi-Fi) are
assembled with GNU `as` / `ld` for `mn10300-elf` at fixed addresses. The manifest's 153 main ranges are 681 bytes of
in-place edits (hooks such as the 5-byte builder call at `0x604f7506`, operands) and 4,816 bytes of added code in 22
all-`0xff` ranges inside the loaded tails of sections 1 to 5; 99 small data edits change sizes and constants (row 18);
one OSD bitmap ("Vivid", 52 x 26) is replaced in place by "Value", 725 bytes. The H/L values ride the stock data path:
setting cells (2.4), the capture and compact snapshots (45 rows of 12 bytes), a 24-byte extension of the processing
job, and a hook after the stock builder that rewrites the H and L coefficients and returns at `0x604f750b`.

**Checksums and container.** Only the main and OSD components ship; lengths, headers and the build field stay as they
were, so the camera still shows 3.1. Each component's tail checksum is recomputed; every stock range is hash-checked
before editing, every assembled span after, and the final file must hash to the release's.

**Safety and validation practice.** Code space is qualified, not assumed from an FF run: section descriptor and loaded
end, neighbouring table bounds, references, a native load and reload with the bytes changed, then run-time ownership
(their `CODE_SPACE.md`; the OM-3 tethering patch's three section tails as precedent). Function slices run under
negative controls (inaccessible unselected objects, poisoned memory, all sixteen operation records exercised, nonzero
effects). The camera tests: install, restore to stock, reinstall, persistence, custom-bank recall, backup and
restore; one UI-related restart was recovered by restoring an earlier main. They state the limits plainly: the
OK + power path to the SD updater is not traced, so recovery is shown only for the states tested.

| | fishcu PEN-F HSL | om-emu (ND128, lens gates) |
|---|---|---|
| Size | about 5.5 KB of code and edits, a bitmap | 58 bytes in place plus one 3-byte jump (ND128); gate sites identified only (lens gates) |
| Placement | qualified FF tails of loaded sections, linked by `ld` | inside the space the rewritten switch frees, hand-encoded in `tools/om1_nd128.py` |
| Stock pinning | per-range before / after hashes | input and output file digests, block checksums (`artifacts/nd128/manifest.json`) |
| Verification | native slices in a strict GNU simulator, then a camera | a restricted interpreter, then emu slices (`check_nd128`); no camera |
| Container | main + OSD only, checksums recomputed | full file, main block's tail sum recomputed |
| Acceptance by the updater | shown on a PEN-F (their N on the validator, physical install) | open: "whether the camera accepts a no-op image" (ROADMAP) |

What transfers: running the firmware's **own** update validator on a candidate before any camera (follow-up 1), the
head/tail check (follow-up 2), per-range before-hashes in the ND128 manifest, and code-space qualification for any
patch larger than an in-place rewrite. What does not: their acceptance result is the PEN-F's updater; E143's shares
the error map (2.2) but its full validation is unread.

### 3.1 The released image, diffed against our stock E122

`PEN-F-HSL-alpha-20261017.zip` (sha256 `75bbaf52...`, as the release states) holds two 44,433,408-byte update files,
`install-alpha/DCOLYMP/E1229999.BIN` and `restore-stock/DCOLYMP/E1229999.BIN`, and the authors' manifest and range
list. Diffed with small scripts outside the tree, disassembly in the VM only (X unless tagged):

- **The update file is a prefix of the vendor file.** It is the ordinary container holding only the first two blocks,
  `0x0100` main (load `0x403a0000`, version `0x3101`) and `0x0101` resources (load `0x41800000`); `src/fw/olyfw.mjs`
  reads it unchanged. `restore-stock` is byte for byte the first 44,433,408 bytes of our
  `OLY_E_122_3101_0000_0000.BIN`, and its main block is `unpacked/E122`'s (`MODELS.E122.rom_sha256`): the patch's base
  is stock 3101. Each block's tail checksum (sum32 over head, descrambled body and tail = 0, as `olyfw.mjs` models it)
  is the only header change: main `0xbb5c812e` -> `0x8b071a9a`, OSD `0xf4e5b95d` -> `0x6c02e1e2`. The camera's SD
  updater lives in the main block (the pattern `E122????BIN` at `0x60d84070`, D) and is not touched; the version stays
  3101, so a patched camera reports stock firmware (D).
- **The diff equals their map.** 5,145 changed bytes in the main block and 725 in the OSD block, plus 4 checksum bytes
  each, 5,878 in all, as a plain compare of the files; every changed byte lies in one of the range list's 154 payload
  rows, each row's count and offset agreeing. Merged at a 16-byte gap: 60 runs in the main block, of which 7 (4,682
  bytes) are new code and data in `0xff` padding and 53 (463 bytes) in-place edits (24 hook sites: a 5-byte `jmp` or a
  re-targeted call, the displaced instructions replayed), and one in the OSD block (the 52 x 26 "Value" bitmap).
- **Placement in the overlay segments (D).** E122 loads its main block in segments, as E143 does: the table at
  `0x60026d7c`, each segment's copy end from `0x600420c1` (`0x601cb000`, `0x60428000`, `0x6069b800`, `0x60a50000`,
  `0x60fdc800`, ...), the loader `0x600421e1` setting bit n-1 of the loaded mask `0xa1c58404`. The five new areas end
  just below their segments' copy ends, so the loader brings them in. The patch keeps writable state there through
  the uncached alias (the H/L table at `0x60427e24`, the editor's axis byte at `0x6069b7b8`, 45 capture rows at
  `0x6069b590`), and code that touches segment 3's state first tests bit 2 of the mask, but for one jump from segment
  2 into segment 3 (`0x60253c7f` -> `0x6069b38c`), safe only if segment 3 is always loaded before a capture (I); one
  test reads the mask through the cached alias (`0x61c58404` at `0x60fdc75b`) where the others use `0xa1c58404` (D).
- **The mechanism (D unless tagged).** No hidden feature is switched on: the twelve-colour saturation editor (ids
  931-966) gains H and L. The 36 descriptors point from the -5..+5 lists to the stock -7..+7 list ids 967, 970 and
  973 use (`0x603dfde6`). H and L live in row 1 of those ids (the store's two rows, `0x602f06e7` / `0x602f0710`), as a
  word tagged `H1` with its complement as a check (decoder `0x60427c70`, setter `0x60427cb4`); the stock recall lists
  never select row 1 for 931-966 (X). In screens 5042-5044 a key event (`0x9016`; that it is the Delete key is I)
  cycles the axis S, L, H; the wheel builder `0x6081b83a..0x6081b8e2` is rewritten in place, two settings-class
  vtable entries (`0x609a4640`, slots 10 and 43) and the setter call `0x6073659d` are redirected, and a title painter
  adds "Saturation" / "Hue" / "Lightness". After the stock call `0x604f7272` the hook at `0x604f7506` writes each
  colour's hue (+0, from 7000..-7000) and lightness (+4, from -300..300) into its 24-byte record (that these fields
  exist in the stock engine is I). Captures snapshot H/L per job (the processing object grows by 24 bytes at the
  `malloc` `0x600233bd`), and for ORFs two 3,028-byte processing blocks are rewritten through a small XOR-chain coder
  (`0x601caa50`; what the blocks are in the ORF is ?). The settings backup gains an 88-byte line
  `2,PENF_HSL_V1,` + 72 hex digits, with its import.
- **The Wi-Fi property path.** The camera's Wi-Fi HTTP property get and set (`0x60aa23c7`, `0x60aa26f0`) and the
  message receiver `0x607ab916` are hooked: id `0xffff` answers `1LSH`, and tagged values `0x4850..0x4852` write S, H
  or L for ids 931-966, and 967-975 and 916-918, gated by `0x60fdc704`. It is the manifest's Wi-Fi group, for their
  camera client; their README does not describe what it lets an associated Wi-Fi client write.
- **Risks the diff shows** beyond those their README states: the version unchanged (patched and stock look alike); the
  unguarded jump above; the cached-alias mask read; other stock readers of row 1 for the saturation ids not
  enumerated (?); engine indexes 11-14 reaching the consumers of `0x602fc3a7` (?).

For om-emu's patch track this adds two points to the table above: a candidate may ship as a prefix holding only the
changed blocks (a two-block stock prefix is the smallest no-op probe of the "does the camera accept it" question on
E143, ?), and added code belongs in `0xff` padding inside a segment's copy range with the loaded mask tested before
its state is touched (E143 has 152 to 1,940 such bytes at the end of each of its 10 segments, X; that om-emu's
`OVERLAY_SEGMENTS` ends are the loader's copy ends is I; state in code segments is riskier on E143's non-coherent
cores, I). On E143 the patch's hook sites have counterparts by the cross-build map (the GUI dispatch `0x510bb971`,
the commit's end `0x503eedc9`, the refresh `0x503d9727`, the processing object's constructor `0x50491699`, which
allocates 9,312 bytes against E122's 14,920; the boot near `0x503c4b0a`, the backup lookup near `0x519c8d16` and the
Wi-Fi receiver near `0x50bd95d2`, I), and the wheel builder `0x50c92aea` reads id 1084 and then 921.. through the
getter `0x503c4ba8` (E122's `0x602b9f84`, D / X); E143's colour-engine writer (E122's `0x604f7272`), the wheel's
geometry and the editor's screen ids were not found.

## 4. An HSL-style unlock on the OM-1 (E143)

| Piece | E143 | Tag |
|---|---|---|
| COLOR table | identical 3,028 bytes at `0x606b3d58` | X |
| Builder call (their hook's analogue) | `0x504f4cfa` -> `0x504f4a81`, same picture-mode test and argument set-up as E122's `0x604f7506` | D |
| Which record fields hold H and L | the stock records have zeros in eight of their fourteen halfwords; which two are H and L is not decoded | ? |
| Colour profile settings | Color Creator 2, three sets of twelve saturation values -5..+5, plus tone, contrast, sharpness (2.4) | D / X |
| Hue / lightness settings | none | D |
| Picture-bracketing names for the three sets | `MODE_BRACKET_PICT_COLOR_CREATOR_2_SET1..3` | D |
| Whether the OM-1's UI offers Color Creator 2 | not checked | ? |
| Code space for added code | not qualified; E143 loads overlay segments, so their section tails do not carry | ? |

The structures their patch uses exist on E143 and the builder call has the same form, so the design would port;
none of their PEN-F addresses do, and the OM-1 version is their whole map (editor, cells, snapshots, job, ORF)
redone on E143 before any code is written.

**What the lab could verify.** The settings store and the user-setting manager run natively, the Super Control Panel
opens on Picture Mode (cell 111) and direct Picture Mode (`0x0418`, panel 500) paints natively
(`docs/om1-menu-spec.md`), so the lab can show whether Color Creator 2 is offered, step its values through the store
(ids 909-956), and, if its editor opens, screen-test a patched editor frame by frame. The COLOR builder does not run
in a session: the 2026-10-23 coverage union (`bin/fwmap.mjs cover`) has no executed offset in
`0x504f4c00..0x504f4e00` (X), as the capture stops at seam C (`docs/hle-gaps.md` 4.3). It can be driven as a function
slice with `bin/debug.mjs`, as `check_nd128` drives the ND selector, to read the coefficient records a patched builder
writes; pixels stay out of reach.

## 5. Their emulator against om-emu's

| | fishcu (`docs/tooling/EMULATOR.md`) | om-emu |
|---|---|---|
| Engine | GNU binutils-gdb `sim` for MN10300, a strict-access patch, a C runner, Python harness | pure JS (`emu/src/core`), the ISA spec `docs/mn10300-isa-spec.md` |
| Scope | function slices with synthetic callers; a cooperative three-core boot to USTART1's controller init | full system: four cores on E143, devices, kernel, GUI; E143 and the 12 bodies `bin/modelcheck.mjs` passes (E146 and E147 among them) shoot and play back |
| Unknown hardware | explicit regions only; the first unmodelled access stops the run | devices and named HLE stand-ins (S-/H-/A-); unknown board facts throw (`mergeBoard`) |
| Alignment | not enforced (GNU helpers accept unaligned word loads) | `MN_FAULT_ALIGN` on misaligned 16/32-bit access |
| Custom instructions | three MAC context transfers added, undefined flags deterministic | UDF semantics from firmware evidence (`docs/om1-udf-spec.md`), undefined flags tracked |
| Evidence output | each modelled response logged with its assumption and evidence | stand-ins listed per session; golden digests |

Worth adopting: negative controls in function-slice checks (make unselected memory inaccessible, poison the rest,
use nonzero inputs; `check_nd128` uses neither), and using the firmware's own validator as a preflight. Worth citing:
their PEN-F report that a misaligned u32 structure passed their simulator but restarted the camera, fixed by 4-byte
alignment, is physical evidence for om-emu's alignment fault (`docs/mn10300-isa-spec.md` section 2). Their
event-per-assumption trace is close to what om-emu's stand-in lists already give.

## 6. Where the two disagree

- **Licence.** The task's framing (GPL-3.0) is narrower than their statement: no licence for the tools and writing,
  GPL-3.0-or-later for the GNU runner only. Treated as all rights reserved: ideas only.
- **Where the head runs.** Their entry is `0x60021020` with the head handing off at `0x600210dc -> 0x600210f9`, which
  they call an internal handoff and not evidence of a reset vector; om-emu's E122 entry comment reads "the reset head's
  jump into the run-time copy at 0x500000b6". Both name the same jump (block offsets `0xb6` / `0xbc`); from which
  alias the first `0xdc` bytes execute is ? on both sides, and theirs is the more careful wording.
- **Notation, not fact:** run-time code addresses against `0x50000000` disassembly notation; their "container
  address" `0x403a0020` is om-emu's `flash_base` (head field `0x08` is `0x403a0000`).
- No factual contradiction among the checks of section 1, nor between their OM-1-era remarks (E-M1 II's stacking
  allow-list bypass of two bytes, the OM-3 tethering patch said to come from an OM-1 Mark II port) and om-emu's
  lens-gates single-site result.

## 7. Follow-ups, ranked

1. **Run E143's own update validation in emu** on a no-op repack and on the ND128 candidate: first read the chain
   around `0x510348e0..0x5103496a` and its checksum call `0x5012a6a0` for anything beyond head/tail and sum, then drive
   it as a slice. Size: 2-4 days. Payoff: the firmware's own verdict on our container, the first step of the patch
   track's open "does the camera accept it" (not the write or the boot).
2. **Head/tail agreement in the unpackers**: the first 28 bytes in `emu/src/fw/olyfw.mjs`, `tools/olyfw.py` and
   `tools/om1_nd128.py`'s verification. Size: an hour with a test. Payoff: catches a malformed repack that still
   checksums; all 150 pinned blocks pass.
3. **E118 board facts from section 2.1**: `ipi_set` `+0x308`, `ipi_clear` `+0x30c`, `kick` `+0x310`, `irq_ipi` 120
   into `FAMILIES.E118` with this evidence, and the outside copy served as erased flash. Size: a day. Payoff: small
   alone (the import still stops at `irq_osd_engine`); a step of the board port, which stays weeks.
4. **Ask the lab whether the OM-1 offers Color Creator 2**: step Picture Mode in the Super Control Panel through its
   values and try its editor. Size: a day. Payoff: settles whether an HSL patch has a UI to extend.
5. **E143 HSL map**: decode the record fields by driving `0x504f4a81` as a slice with marked inputs, then locate the
   editor, the capture snapshot copies and the job constructor on E143. Size: 1-2 weeks for the map, weeks more for a
   candidate. Payoff: the largest user value here, at the largest cost.
6. **Negative controls in `check_nd128`** (inaccessible and poisoned memory around the slice). Size: half a day.
   Payoff: small, a stronger check.
7. **Their OM-5 burst note for feature-gap step 2** (configurable burst fps): the rate list is the first of several
   limits (a run-time copy, the frame-handle ring and the image pools); check E143's pools before scoping that edit.
   Size: reading. Payoff: avoids a menu-only edit.
8. **E143's code space and row 1** (from 3.1): confirm that `OVERLAY_SEGMENTS`' ends are the loader's copy ends, so
   the `0xff` tails are known to be loaded, and list every stock reader of row 1 for ids 921-956 on E143 (and 931-966
   on E122). Size: 1-2 days. Payoff: the two preconditions of any added-code patch on the OM-1.

**The release archive.** It was diffed after all (3.1): the diff confirms the manifest byte for byte and adds what
the manifest does not say in prose (the update file's shape, the segment-loaded checks and their one gap, the Wi-Fi
property path's reach). Running the patched image waits for E122 to run in the lab, when it would also be a test of
the board port.
