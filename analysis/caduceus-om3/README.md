# androidfanman/caduceus-om3: a study for om-emu (2026-11-13)

[androidfanman/caduceus-om3](https://github.com/androidfanman/caduceus-om3) ("Caduceus for OM-3") publishes firmware
patches for the OM SYSTEM OM-3 on firmware 1.1 (om-emu's E147): twenty named films in Picture Mode, an on-camera colour
editor (hue, saturation and lightness for twelve colours, split toning, Blacks and Whites, WB shift, sharpness, noise
filter, shading, Glow / Clarity, grain, halation), films kept in the camera's settings memory, all four arrow keys in
Button Function, Creative Dial modes and the film's recipe in each JPEG's EXIF. Its author runs its builds in om-emu
before the camera, which makes it om-emu's first heavy downstream user. This note answers what om-emu can take
from it: whether its claims about the E147 block hold against our image, how it uses om-emu and where the lab misled
it or could not answer, what this round of om-emu takes from that, and where it corrects om-emu's docs. It ends with
open questions and ranked follow-ups.

How it was read: the repository was cloned read-only outside the tree at `4e829b0` (main, 2026-11-13; tag `v0.29` is
`9928b0a`) and its documents, assembly sources, build and patch scripts, release files and research notebook were read
as data. Its patcher was run for this round on our stock `.BIN` outside the tree (the package's digest is the one the
release lists), and its emulator drivers were read, not changed; their effects were re-run here with small probe
scripts on om-emu itself. Every firmware fact below was checked on om-emu's pinned E147 block with
`tools/mn10300dis.sh`, small node scripts that only read bytes, and probe sessions of the E147 lab at `f2b326b`, the
round's base. Where this round's modules changed what the lab shows, the text marks the base's observation "at
`f2b326b`" and gives the result on the round's final tree beside it (X, 2026-11-13). A second round the same day, on
base `ae63e25`, took up section 7's follow-ups against the checkout at `0b1d5cb`, which adds v0.29.1; its modules are
listed in 4.1, and where it changed a result the text says so. No excerpt of Caduceus' code, no byte of its patch and
no picture it draws is committed.

**Licence.** The repository is Apache-2.0 (`LICENSE`) with a `NOTICE` that says the release patch files hold only the
bytes the project writes, that its tour screenshots were drawn by om-emu running its firmware, and that its developer
tools drive om-emu, which keeps its own licence (D). It builds on Caduceus for the PEN E-P7
([cakelesscoder/caduceus-ep7](https://github.com/cakelesscoder/caduceus-ep7), also Apache-2.0). om-emu takes no code,
data or assets from either, only facts and ideas, attributed to androidfanman/caduceus-om3 where used, as the earlier
studies do.

Related notes: [fishcu/oly_fw_analysis](../oly-fw-analysis/README.md),
[azqeurio/om-c-firmware](../om-c-firmware/README.md), [ND128](../nd128/README.md),
[the .BIN container](../../docs/firmware-container.md).

**Addresses.** Caduceus writes run-time addresses for code and data alike (decoded main block offset + `0x60021020`,
its `main_base`, which is E147's `image_base` in `emu/src/fw/models.mjs`); here E147 code addresses are in om-emu's
notation (body offset + `0x50000000`, `docs/README.md` "Addresses"), so theirs - `0x10021020`, with theirs in
parentheses where it helps a reader of their sources; data addresses are run-time. The flash addresses of their section
table (`0x50113000`, ...) are `0x50000020` + body offset (D). Their input is our image: the patch's `stock_sha256`
`8c133084...` is `BLOBS.sha256`'s E147 `.BIN` and its `main_sha256_before` `5e8d376e...` is `MODELS.E147.rom_sha256`
(X), so their addresses are ours. Tags as in the specs: **X** executed or measured here, **D** read from the firmware
(or from their sources, where said) at the cited address, **I** inference, **?** unknown. "Their report" marks a camera
result they state and om-emu cannot check; "their notebook" marks an emulator observation in their `research/NOTES.md`
made on an older om-emu (they name `147ca89` and `d24ff9d`, 2026-11-03 and 2026-11-09), not re-run here unless tagged X.

## Short answer

1. **Reliability.** Every stock expectation of their build holds on our E147 block: the two digests, the stock bytes
   at all 39 hook sites, the stock values of all 29 table words they re-point, and the twelve code tails they fill all
   `0xff` (X, section 2.8). Their section table, loader end words, copied mask, media word, half-press site, EXIF fill
   site and Creative Dial routine are where they say (D, section 2). No claim checked is contradicted.
2. **What it is.** About 16,600 lines of MN10300 assembly built with GNU binutils into hooks, code tails and a
   relocatable block, shipped per release as a digest-anchored `patch.json` of new bytes with no old ones, and turned
   into the camera's SD update file by a stdlib Python patcher from the user's own official `.BIN` (section 1).
   Nineteen release folders, v0.16 to v0.29.1 with test versions, in a history from 2026-11-05 to 2026-11-13.
3. **How it uses om-emu.** Builds run in an E147 lab session before the camera (their notebook), through scripts
   that import 11 of om-emu's internal modules, write memory the lab leaves unset and call firmware functions with
   hand-made stubs (section 3). At `f2b326b` one write was still needed: the section loader's copied mask
   `0xa32de590`, without which their card and film load never ran (X). On the round's final tree none is: v0.29 runs
   from its release `patch.json` through `bin/card.mjs` and `bin/session.mjs` with no write, to its film list, its card
   load at the half press and its film's name in the S2 picture's EXIF (X, section 4.2).
4. **Where the lab misled or could not answer.** The flat image (code in an unloaded gap, a boot loop from load order),
   the capture path (reboots and hangs the lab never reaches), timing (an uncached-heap hang) and the colour wheel plane
   (section 3, table). The lab caught more than a dozen of their bugs, most of which the camera would have shown as
   restarts. What the lab still cannot verify is listed in section 4.4.
5. **New to om-emu** (all checked on E147): the copied mask's single writer and the end-word switch, the
   inter-section gaps the camera does not load (their report) with their exact sizes, the reset head's five copies and
   the ends it stores itself, the media status setter's three kinds, the per-shot EXIF fill site and the EXIF writer
   table, the Creative Dial's power-on mapping, and that a native power-off save carries store M's unused tail
   (section 2).
6. **What om-emu takes:** this round's modules for verifying modified firmware, each answering one of their workarounds,
   and a recipe for verifying a build (section 4). The second round adds a regression run of every release against
   pinned digests and observations, their guide pictures drawn, calls into the middle of a function, traces and
   breakpoints in scripted sessions, and a check of a film's values below the pixels (4.1, 4.2, 4.6). **Corrections
   to om-emu's docs:** four (section 5), all made.

## 1. What it is, and how it is built and delivered

- **Repository (D).** 449 commits from 2026-11-05 to 2026-11-13, 627 tracked files: the firmware sources
  (`firmware/src/editor.s` 13,734 lines, `xblock.s` 2,855, the linker script `editor.ld` 203), the build and patch
  scripts (`firmware/build.py`, `patch.py`), card-file generators (`card/`), a web app for making films (LookLab,
  `webapp/`), user docs (`docs/`), the per-release folders (`releases/v0.16` .. `v0.29`, with alphas and betas;
  `v0.29.1` at `0b1d5cb`), the
  research notebook (`research/NOTES.md`, 3,763 lines, and `BUTTONS.md`) and the om-emu drivers (`tools/emulator/`,
  `research/emulator/`). The status words of the notebook are defined at its head: "camera" is seen on a real OM-3,
  "emulator" is om-emu only.
- **Build (D, `firmware/build.py`).** `editor.s` is assembled and linked with a GNU binutils build for `mn10300-elf`;
  `editor.ld` places one output section per hook at its stock address, the code tails `.ext1`..`.ext12` and about 150
  absolute stock symbols. Before writing, the script asserts the stock `.BIN` and main block digests, the stock bytes
  at every hook, each re-pointed word's stock value and each tail's `0xff` run. A second blob (`xblock.s`) is linked at
  two bases and the two images diffed to find its relocations; it rides in `GUIDES.BIN` (built into the firmware from
  v0.29), is copied into the heap and relocated by its own entry at run time. v0.29 raises section 6's loader end (2.1)
  by 358 KiB, to `0x60fa3000`, to bring part of the gap after it into the load. The white Frame Art layers in the
  large-data block (component 2, `blk05a00000`, load `0x458c0000`) are rebuilt too.
- **Release format (X, `releases/v0.29/patch.json`).** `format: "om3-patch-2"`: the stock file's name, size and
  sha256, `main_base`, `main_sha256_before` / `main_sha256_after`, `result_sha256`, `runs` (158 pairs of a run-time
  address and the new bytes in hex: 323,724 bytes, of which 321,613 differ from stock, the `changed_bytes` stated),
  `frames` (component 2's thirteen layer windows) and `card_files`. There are no old bytes: integrity rests on the
  three digests. Runs are merged across unchanged stretches of up to 16 bytes (`tools/mkpatch.py`, D), so 2,111 of the
  run bytes equal stock (X).
- **Delivery (D, `firmware/patch.py`).** A stdlib-only Python script takes the user's official `.BIN` (checked by size
  and sha256) or downloads it from OM's updater endpoint, the one `emu/src/fw/updater.mjs` uses; walks the container
  (requiring each block's first 28 head and tail bytes to agree, the check the fishcu note's follow-up 2 proposes);
  descrambles block 0, checks the before digest, writes the runs, checks the after digest, recomputes the tail
  checksum, re-scrambles, rebuilds component 2's frames and checks the package digest. The output is
  `DCOLYMP/E1479999.BIN`, flashed by holding OK at power-on, plus a copy of the stock file for going back. Run for
  this round on our stock `.BIN`, it made the package `cd99362c...` that `releases/v0.29/SHA256SUMS` lists (X, its
  digest).
- **Reproducibility.** A source build on another host is not byte-identical to a release: glyph rasterisation differs
  (their `docs/SD_LOADER.md` build note). A macOS build of `v0.29` made for this round differs from the release's main
  block in 25 bytes (X, a byte compare), so a release's `patch.json`, not a rebuild, is what reproduces a camera-tested
  build.
- **What they claim to have tested.** Each release folder carries a status, most "camera-tested"; v0.29's notes state
  two battery pulls, a card without films, a card with no `OM3MOD` folder and new films from a LookLab export, on the
  camera (their report).

## 2. Their claims checked against our image

### 2.1 The section table and the loader's end words

The table at `0x60029b28` holds ten 12-byte rows `{run-time start, flash source, flag}` (X, read from the block); the
end of each copy is the operand of one `mov imm32,d0` in a switch at `0x50024e4c` (their `0x60045e6c`), which takes
n = 1..10, jumps through `0x600477b0` and returns 0 out of range (D). Each gap below runs from a loader end to the next
section's start and is all `0xff` in the file (X):

| n | start | loader end | flash | flag | gap after (bytes) |
|---|---|---|---|---|---|
| 1 | `0x60134000` | `0x6031f000` | `0x50113000` | 0 | file data runs on to `0x603b76d4` (below) |
| 2 | `0x603ba800` | `0x60718800` | `0x50399800` | 0 | 270,336 |
| 3 | `0x6075a800` | `0x60820000` | `0x50739800` | 0 | 32,768 |
| 4 | `0x60828000` | `0x60a8f800` | `0x50807000` | 0 | 296,960 |
| 5 | `0x60ad8000` | `0x60adb800` | `0x50ab7000` | 0 | 2,048 |
| 6 | `0x60adc000` | `0x60f49800` | `0x50abb000` | 1 | 1,005,568 |
| 7 | `0x6103f000` | `0x6164b000` | `0x5101e000` | 1 | 342,016 |
| 8 | `0x6169e800` | `0x617e4800` | `0x5167d800` | 0 | 149,504 |
| 9 | `0x61809000` | `0x619a9800` | `0x517e8000` | 0 | 342,016 |
| 10 | `0x619fd000` | `0x61aa4800` | `0x519dc000` | 0 | file data at `0x61aad000..0x61aaddc0` |

The gaps of sections 2 to 9 total 2,441,216 bytes, their figure (X). Section 6's end is the operand of
`mov 0x60f49800,d0` at `0x50024e7a` (their `0x60045e9a`); v0.29's one run outside the sections, two bytes at
`0x60045e9d`, makes it `0x60fa3000` (X). Below section 1 the file ends in an `0xff` run from `0x60128e40` (X).

**The reset head copies too (D, `0x5000012c..0x500001cb`).** Five calls of the flash copy `0x5000230f` (mode
`0x10200`) fill `0xa0030000` from `0x5000f000`, `0xa0357000` from `0x50336000`, `0xa039b800` from `0x5037a800`,
`0xa03a4000` from `0x50383000` and `0xa1aad000` from `0x51a8c000` (`0x1000` bytes). The first four copy up to ends the
head itself stores as constants to the words `0x62960794..0x629607a4` (at `0x500000eb..0x5000011b`) and loads back
(`0x50000126..0x5000018f`), so their run-time ranges are `0x60030000..0x60129000`, `0x60357000..0x60387094`,
`0x6039b800..0x603a2bd4` and `0x603a4000..0x603b76d4` (D; X, `emu/src/fw/sections.mjs` `bootLoads` on our block). One
more end, `0x603a3804`, is stored to `0x629607a0` (at `0x50000103`) and never loaded (D). The first copy lays out the
image below section 1 from `0x60030000`, the middle three most of section 1's tail past its loader end, the last
section 10's trailing data. The head below `0x60030000`, which the reset jump enters (`0x600210c5`), is placed by a
boot stage before the main block's, whose extent is not read (?).

**On the camera the gaps are not loaded (their report).** Their gap probes (GX1..GX4) summed every gap on the camera: no
sum is that of an all-`0xff` run and one changed between runs, so the gaps hold leftover RAM; raising section 6's end by
4 KiB, then 64 KiB, then 256 KiB more brought the probe code and patterns placed there into the load intact. om-emu maps
the whole block at the image base (`src/machine.mjs` `createMachine`, D), so by default the gaps hold the file's `0xff`
in the lab; in the loaded-ranges mode, the default with a patch overlay on E147, they hold `0xA5` and code run there
stops the session (S-STALERAM, section 4.1).

### 2.2 The copied mask and its single writer

`load_section(n)` at `0x50024eb5` (theirs `0x60045ed5`) reads the end through `0x50024e4c`, the row at
`0x60029b28 + 12 * (n - 1)`, copies end - start bytes through the flash driver `0x500022b1` with mode `0x10200` (the
port's `storage.nand.access` and its read mode), logs a non-zero result and then, whatever the result,
`mov (0xa32de590),d1; or d1,d0; mov d0,(0xa32de590)` with `d0 = 1 << (n - 1)` at `0x50024f13..0x50024f1b` (D). Those
two are the block's only absolute references to `0xa32de590` (X, a scan of every aligned and unaligned word), so the
word has no reader in stock code. Its E143 twin is `0xa32df1f8`, set by `0x50024e6b` in USTART_L2 `0x50024572`
(`docs/hle-gaps.md` 4.6); the port pairs that loader with E147's `0x500245a5` (X, `PORTS.E147`). In a stock E147
session at `f2b326b` it read 0 at open and after S2 (X), as the lab runs no loader. S-SECLOADED now sets it as the
loader leaves it (`emu/FIDELITY-NOTES.md` 7.17): it reads `0x3ff` at open with no write, stock and under v0.29 (X).

The phase mask beside it, `0xa32de58c` (`FACTS.E147.boot.stage`), has three references: the wait `0x50024e1b` and the
per-section step's `or` at `0x5002503e..0x50025046` (X, the same scan); S-BOOTSTAGE sets bit 0 and it reads 1 (X).
Their gate does not test it; only the card-load worker of v0.25..v0.27 waited for bits `0x2e9` (D, their source). Of
those releases the patch audit lists a task in patched bytes for v0.26.2 and v0.27 only (X, the regression run of 4.2),
and there the worker never gets past that wait.

### 2.3 The media word and its setter

The media status setter `0x50adf011(kind, value)` (E143's `0x50aca703`, port pair X) stores kind 4 at `0x60369308`,
kind 8 at `0x60369300` and kind 1 at `0x603692f8` (D, `0x50adf011..0x50adf034`), om-emu's SD, SD2 and IN status words
(`src/lab/camapp.mjs`, at E143's `0x60360bec`, `0x60360be4`, `0x60360bdc`). The mount path passes `0xF000` at
`0x50bd33fd` when its checks pass (D). S-CARD writes SD's word `0xF000` (`camapp.mjs`, since `2d10425`, 2026-11-12), and
a stock session reads `0xF000` there at open (X), so their write of that word is redundant now.

### 2.4 Their card-load gate (`pr_gate`)

Their half-press hook replaces the call `0x503f41f6` (theirs `0x60415216`, `call 0x503f4323,[d2,d3,a2,a3],36` in the
HLS_EVENT shutter handler; D) and runs its gate at each shutter event until the load has been tried once. As read in
their source (D): the copied mask's low ten bits all set; a task context whose id equals the HLS_EVENT task id word
`0x62b4dd14` (non-zero, bit 15 clear); one of the three media words (2.3) at `0xF000`. It then marks its state word
`0x62b4dd16` and loads the card and the films.

In the lab at `f2b326b` (X, v0.29's main block from its `patch.json`, blank card, probe session): the HLS task id word
read `0xa4` (their 164), the call site ran at the shutter events, SD's word was `0xF000`, and the state word stayed 0
after S1. With `0xa32de590 = 0x3ff` written after open it was `0x8801` after the next S1: the gate opened and the block
was published. On the round's final tree no write is needed: the mask reads `0x3ff` at open and the state word is
non-zero after the first S1 (X, section 4.2). Its value differs between flows (`0x5d81`, `0x7f81`, `0x8801` were seen):
their source publishes a heap handle there (D), and S-HEAP's allocation order depends on the flow. A write trace on
the word (`trace:mem:`, second round, X) shows the first S1 writing `0xffff` there from `0x502fda3a` and then `0x5d81`
from `0x50a6e1a4`, both in patched section tails.

### 2.5 Store M's tail

v0.29 keeps films, edits and Extras in a 3,912-byte block at offset `0x3A000` of settings store M, whose RAM image is
`0x62920700` (`0x40000` bytes; referenced seven times in `0x500417f3..0x500422f7`, X), saved by `0x50042d53` (theirs
`0x60063d73`; E143's flush `0x500421cd`, port pair X) on the return to shooting and at power-off (their report). In the
lab (X, stock E147 with S-NVRAM on a fresh file): eight bytes written at `0x6295a700` before a native power-off are in
the kept M (262,144 bytes) at `0x3A000`; in a v0.29 session without edits the last byte of M below `0x3A000` that is
neither 0 nor `0xff` is at `0x3943e`. So the store's own save carries the tail, and the block lies past the stock items
(their "items end at `0x39465`"). That M survives battery pulls is their report.

### 2.6 The per-shot EXIF fill

Their photo-code hook replaces 8 bytes at `0x50436558` (theirs `0x60457578`): `mov (8,sp),a0; movhu (37666,a0),d0`,
right after the Artist (setting 24321) and Copyright (24337) strings are copied into the EXIF block through
`0x50437145` (D). The writer's table at `0x6062abc0` (12-byte rows `{u16 tag, u16 type, u32 count, u32 offset}`) gives
ImageDescription `0x010e` 32 bytes at `+0x5a8`, Make at `+0x5c8`, Model at `+0x5e0`, Artist at `+0x568`, Copyright at
`+0xf12`, XMP at `+0x612`, MakerNote at `+0xf78` and UserComment `0x9286` 125 bytes at `+0xf7c` (X); Make and Model are
`FACTS.E147.rec_file.exif.tags`' offsets, an independent check. In the lab at `f2b326b` the site never ran (X, stock
and v0.29, S1 then S2): the set-up's UserComment loop `0x50434fd7` (theirs `0x60455ff7`) ran once, the per-shot fill
did not, as S-EXIFPRM stood in for TAKE's EXIF set. Since H-RECPRECON the EXIF set runs natively at S2
(`docs/hle-gaps.md` 4.3.11), the fill site with it: under v0.29 the S2 picture on the card has ImageDescription
`FILM 1 Portra 400` and a UserComment that starts `Caduceus FILM 1 Portra 400` (X, `refs/exif.mjs` on the file
`bin/session.mjs` took off the card, section 4.2), and a `trace:` of the site records one arrival per S2 press, stock
and v0.29 (X, second round). The exposure fields beside them are S-EXIFPRM's, not the session's (section 4.4).

### 2.7 The Creative Dial and the settings getters

- **Creative Dial (D, `0x501f58a5`, theirs `0x602168c5`).** The power-on routine reads UI code `0x1906` through
  `0x501570c5` and, for values 1, 2, 3, 4, 5, prints a `picd_00n!` string and sets setting 897 (the Picture Mode
  family) to 900, 899, 898, 901, 988 through `0x503cf304` (theirs `0x603f0324`; E143's `0x503c4b2f`, port pair X). That
  the four physical positions are CRT = 900, ART = 899, COLOR = 901 and MONO = 988 (898 none) is their report. At
  `f2b326b` the lab fixed the dial at one idle position and did not reach this routine once a session was open (X).
  The dial is now a play control on E147 (`creative_dial`, `--creative-dial K`): a turn and the start position set
  setting 897 natively to the families above, and a power cycle keeps the position (X, `emu/test/test_cdial.mjs`).
  Whether that path goes through this routine is not read (?).
- **Settings getters (X, port pairs).** Their capture-safe getter `0x50042360` (theirs `0x60063380`) is om-emu's
  "settings read" of REC_IMAGE (`docs/hle-gaps.md`'s table; E143's camera-state read `0x500417da`,
  `FACTS.E147.rec_image.settings`); their setting getter `0x503cf0f1` (theirs `0x603f0111`) is E143's `0x503c49ab`
  (`docs/om1-settings-spec.md`). They report that calling the other getter (theirs `0x603f039d`) during a capture
  rebooted the camera (v0.24).

### 2.8 Their build's stock expectations

Read as text from `firmware/build.py` and compared with our block (X): the stock bytes of all 39 hooks match (from
3 bytes at `.hook_dmg` to 29 at `.hook_lv`); all 29 re-pointed table words hold the stock targets the script expects
(the settings facade's vtable, the wheel editor's four records, the Picture Mode column); and all twelve code tails
`.ext1`..`.ext12` are `0xff` in the stock file. Of v0.29's 158 runs, 157 lie inside the loader's ranges once section 6
ends at `0x60fa3000`, and the 158th is that end word (X); with the stock end four runs (from `0x60f49800`) would lie in
the gap. Two runs cover places the lab uses, and the patch audit (section 4.1) lists both: their string-getter hook at
`0x510d4686` is E143's GET_STRING `0x510bb079` (port pair X), which the lab calls natively (`src/lab/text.mjs`) and
does not hook, so the lab runs the patched getter (I: benign); and `0x60045e9c` is the fact `sections.ends[5]`, the
end word they raise, which the lab reads from the patched image. The audit lists these two for every release from
v0.24.1 to v0.29 and nothing for v0.16 to v0.22 (X, its tables over each release's overlay).

## 3. Their verification against om-emu's

**How they drive om-emu (D, their drivers).** `tools/emulator/session_ed1.mjs`, `sess7.mjs` and
`session_autoload.mjs`, and the research drivers under `research/emulator/` and `research/upkey/`, import `bin/run.mjs`,
`src/fw/expand.mjs`, `src/lab/player.mjs`, `scenarios/session_replay.mjs`, `src/lab/sdcard.mjs`,
`src/debug/debugger.mjs`, `src/lab/camapp.mjs`, `src/lab/play.mjs`, `src/lab/menu.mjs`, `host/nvram.mjs` and
`host/server.mjs` (X, a grep): they pass the patched main block to a `Player` as its image, bypassing every digest
pin, and step the session's own methods. On top they built:

- **A token script** per session: S1, key clicks and holds, dials, mode, eye, power-off, card injection; after each
  step a JSON snapshot of the GUI state and their editor's memory; shots composed from the lab's raw YCbCr frame.
- **Harness writes** after open: the copied mask `0x3ff` and SD's media word `0xF000` in every driver, the phase mask
  `0x2e9` for the v0.25..v0.27 worker, and the worker's task entry pushed onto the camera application's allow-list.
- **Native calls** of firmware functions (their getters and setters, the tone and gamma stages, the Art Effect
  converter, malloc) through call stubs written below the lab's stack pointer and stepped with the machine's `step`,
  outside the lab's own hooks, from a JSON spec of memory, registers and stops. Their split-toning, glow, tone and
  halation code was checked this way, bit for bit against their Python models, on synthetic requests (their notebook).
- **A gap probe**: a sentinel written over every gap before boot; boot, half-press, editor, playback and menus wrote
  none of it (their notebook), the lab's half of the camera's GX probes.
- **The camera's own log**: with `OM3MOD/DEBUG.TXT` on the card their firmware writes `OM3MOD/CADLOG.TXT` (build,
  card-file verdicts, the last 32 events), the same file in the lab and on the camera, and a capture logger (GLOG) on
  the camera for the image pipeline.

None of their workarounds is needed on the round's final tree. The media word (2.3) has been set by the lab since
2026-11-12, and `PlaySession.lab_created` has existed since 2026-10-31, against their note that it does not. Section 4.1
names the module that replaces each of the others: the mask write, the allow-list edit for a task the patch creates
(v0.25..v0.27; v0.29 creates none, its two worker hook sites hold stock bytes, X), the stubs, the card rewriter, the
kept file's edit and the local dial change. Their own driver still runs against om-emu's internals (X, second round:
`session_ed1.mjs` with `s1 tonecall ncall` on v0.29 exits 0), and their notebook's "om-emu cannot take the card out
on E147" no longer holds: the card's removal and insertion run there (X, the regression run of 4.2).

**Where the lab misled them or could not answer.**

| Case (their name) | On the camera (their report) | In the lab (their notebook) | Why (om-emu side) | Closed by |
|---|---|---|---|---|
| Slider code at `0x60133000`, in the `0xff` run below section 1 | not flashed: it would not have been loaded | ran | the whole block is mapped (2.1) | closed: the loaded-ranges mode stops code there as not shown to load (?) and lists patched bytes there at the start (4.1) |
| v0.20-t1: stage code in section 2 calling section-8 code | boot loop, recovered by flashing v0.19 | booted | every section is present from the start; the lab runs no boot order (their cause is a static reading, I) | follow-up 7 |
| Capture-path crashes: v0.24's getter during capture, lk6's WB read from the heap at S1, ft5 / ft7 / ft8, rc2b's broken file, grain with RAW+JPEG | reboot, hang, a file with EXIF and thumbnail only | not reached ("the emulator cannot capture") | TAKE, development and encode are stood in (S-RELSEQ, S-EXPOSE, S-EXIFPRM, S-JPEGENC) | the photo code: closed, the per-shot EXIF fill runs (4.1); development: follow-up 8 |
| `fb`-prefixed `movbu (d8,An),Am` (gt1) | misread | "worked" | om-emu faults on `fb` with nn = 2 (`src/core/cpu.mjs`, D); the instruction sat in the capture path the lab never ran (I) | nothing in the CPU |
| lk7 / lk9: block code in the uncached heap on the COLOR switch | 1 s hang, restart | fine | no fetch cost, watchdog or stack-depth model | not taken (4.4) |
| The colour wheel's plane | drawn | `PLANC_UNOBSERVED`, on stock too | the OpenVG / K3000 stack on CPU 1 is dormant (`docs/hle-gaps.md` 4.12) | follow-up 9 |
| Their guide pictures (Test 11) | drawn | `BMP_TOKEN`, not drawn | the OSD engine refused every run across a row end; stock has none (X, 4.1) | closed: format 0x0B's runs go on in the next row (A-BMPWRAP, 4.1) |
| v0.27's sporadic start-up hang with the dial moved while off | hang | not shown | one deterministic schedule; no dial position | the position: closed, the dial is an input a power cycle keeps (4.1); the race is not taken |
| Stills-mode arrow keys and the front dial (`research/BUTTONS.md`) | differ | other setting ids read | the lab's key routing; until 2026-11-13 also the lab's movie mode on E147: its still / movie switch started at a movie position, and the button-function lookup then takes its movie column (`docs/hle-gaps.md` 4.1.13, D); whether that is their case is not checked; their stills-mode lab results declared void | follow-up 2 |

**Where the lab answered.** Their notebook credits the lab with a frame bug that overwrote a saved register (`gd_set`),
a cached-alias relocation landing at a wild address, an assembler-made wild call that stopped the session (the lab was
right, though its stop message did not say "wild call"), an `mdr` clobbered before a `retf`, the drive-mode restart
(a fault in their `gr_is`, reproduced in the lab and then on the released v0.25), the WB grid's restart on a half-press
and edits that never reached their memory; and with a camera fact: the camera saves store M at power-off as the lab
does (their notebook, later consistent with the camera).

| | Caduceus | om-emu |
|---|---|---|
| Stock pinning | input and main-block sha256; every hook's stock bytes asserted at build | `BLOBS.sha256`, `rom_sha256`, golden digests; overlays check old bytes |
| Release | runs of new bytes anchored by before / after / package digests | overlays with old bytes, or theirs as published (section 4) |
| Lab use | whole sessions through internals, harness writes, stub calls on synthetic structures | the whole camera on its cores, stand-ins named; scripted sessions with expects (`bin/session.mjs`) |
| On the camera | every release labelled camera-tested or test; on-card log and gap probes | none |

## 4. What om-emu takes and what it does not

### 4.1 This round adds

Each option, its stand-in and its status are in `emu/README.md`; where the lab departs from the camera,
`emu/FIDELITY-NOTES.md` (2026-11-13):

- **Their release files as published.** `--patch FILE` reads the `om3-patch-1` and `om3-patch-2` shapes: the runs at
  `addr - main_base`, the old bytes taken from the stock block, refused unless `main_sha256_before` is the model's
  `rom_sha256` and the result is `main_sha256_after`; `frames` and `card_files` are reported as not applied. `--main
  FILE` takes a patched decoded main block and turns it into the same overlay against stock, so every digest pin stays.
  Both work on `bin/play.mjs`, `bin/nav.mjs`, `bin/debug.mjs`, `bin/session.mjs` and, with one model named,
  `bin/modelcheck.mjs`; the browser player's Patch option takes a file too. A patched build keeps its own settings
  file (`nvram-<model>-<8 hex>`). Every release from v0.16 to v0.29.1 is taken (X, `emu/README.md` "Patch overlays").
  Replaces their direct `Player` bring-up.
- **The patch audit** (`src/lab/patchaudit.mjs`, FIDELITY 7.16). A lab hook reached on patched bytes stops the session
  (`PatchHooked`); the pass-through observers, which only record and then run the instruction, are exempt. The status
  and the session's summary carry `patch_audit`: `hooks` (lab hooks on patched bytes), `ported` (ported addresses and
  facts on patched bytes, which the lab calls or reads as patched), `unloaded` (patched bytes the boot does not load,
  below) and `tasks`. H-PATCHTASK starts a task whose entry lies in patched bytes, where the kernel's guard refuses any
  other unmodelled entry (X, `emu/README.md`: v0.27's film loader at `0x50a6e603`). Replaces their allow-list edit.
- **S-SECLOADED** (FIDELITY 7.17): the copied mask (2.2) set as the loader leaves it, one bit per case of the image's
  own end switch. Replaces their mask write.
- **The loaded-ranges mode** (`--loaded auto|on|off`, S-STALERAM, FIDELITY 4.8; `auto`, the default, is on with a
  patch overlay on E143, E146 and E147). DRAM gets only what the reset head and the loader copy (2.1), by the patched
  image's own end words; the rest holds `0xA5`. What it does, checked on the round's final tree with made-up patches
  through `bin/debug.mjs` on E147 (X; a call at `0x60f49700`, in section 6's loaded tail, to a routine
  `mov 0x12345678,d0; ret` placed in the stock `0xff` padding):

  | The routine at | Result |
  |---|---|
  | `0x60f49810`, past section 6's end word | stops: `runs code the boot does not load`, naming the section, its loaded end and the end word `0x60045e9c`; listed on the start line |
  | `0x60133000`, where their slider build put its code (`0x60129000..0x60134000`, past the head's first copy, below section 1) | stops: `runs code the boot is not shown to load (?)`, naming the head copy that bounds the range; listed on the start line as its own class |
  | `0x603a3000` (`0x603a2bd4..0x603a3804`, up to the end the head stores and never loads) | the same, the stored end named |
  | `0x60128f00`, inside the head's first copy | runs (`d0` the routine's); the start line `no patched byte where the boot does not load or is not shown to load` |
  | `0x60133000` with `--loaded off` | runs; the start line says the ranges were not checked |
  | a word of data at `0x60f49810`, loaded by the caller | no stop: the load reads `0xa5a5a5a5`; the start line lists the word |

  So code in either kind of range stops the session, and data a patch places there is reported only at the start and
  in `unloaded`: reads and writes there are not watched. Whether the boot stage before the main block's loads the
  ranges not shown loaded is not read (section 6). Code in a section that loads later than its caller still runs: the
  load order is not modelled (FIDELITY 7.18). Answers their gap question for the lab.
- **Card file tools**: `bin/card.mjs` makes a blank card the firmware formats (`new`) and lists, gets, puts, makes
  directories on and removes files from an `.omsd` card (FAT32 with 8.3 names, exFAT); `--card-put DOS=LOCAL` on
  `bin/play.mjs` and `bin/session.mjs` puts files on before the first mount. Replaces their mtools and FAT rewriter.
- **The kept state across a power-off** (S-NVRAM): a second session after a native power-off restores stores M, E and
  B (their workaround: drop `scpu` from the file; section 5 item 2).
- **The Creative Dial** (2.7): the play control `creative_dial` on E147, `--creative-dial K` for the start, and the
  position a power cycle keeps, with the mode dial. Replaces their local om-emu change and code injection.
- **A firmware call op** on the debug route (`{"type": "debug", "op": "call", ...}`, the session's `call:` token): a
  function run to its return through the lab's own call path, its hooks answering as for the lab's own calls, every
  register returned. In the loaded-ranges mode a call into code the boot does not load or is not shown to load is
  refused before it runs. Replaces their stubs (4.3; for calls into the middle of a function, below).
- **The per-shot EXIF fill** (2.6), run with the EXIF set natively at S2 (H-RECPRECON, `docs/hle-gaps.md` 4.3.11):
  their photo code runs, and its fields are read back from the card's JPEG.
- **A scripted session tool**: `bin/session.mjs` and its module `host/session.mjs` (`openSession`), the supported
  scripting API. A headless play session runs from tokens: keys, dials, switches, waits, `power:off` and `restart`, shots,
  reads, calls, the card's files and a JPEG's EXIF, and expects that fail the run. One JSON record per step and a
  summary with the patch audit, the stand-ins in use and every poke (`emu/README.md` "Scripted sessions"). Replaces
  their drivers' use of internals.

The second round (base `ae63e25`) adds:

- **Their guide pictures** (A-BMPWRAP, `emu/FIDELITY-NOTES.md` 5.7, `src/dev/engine.mjs`). A format-0x0B picture run
  that crosses a row end goes on at the start of the next row. No stock picture has such a run (X: 136,474 resource
  pictures on 33 bodies); their encoder makes them and their notes report the guides drawn on the camera. Runs of
  other formats that cross, and a run past the last row, stay refused (`BMP_TOKEN`). Each session record now carries
  `osd_errors`, the engine's refusals in that step, which the firmware takes silently. On v0.29 the HSL wheel's four
  guide pictures are drawn with no `osd_errors` and A-BMPWRAP in the summary (X, `emu/test/test_osdwrap.mjs`).
- **Calls into the middle of a function** (`src/debug/call.mjs`): the call op's `entry` (a pc inside `fn`, whose frame
  the harness's CALL still builds) and `stops` (up to 64 pcs, the run ending before the first one reached); in
  `bin/session.mjs` `call:FN:entry=PC,stop=PC,frame=MASK/SIZE` and `call:@FILE`, the op's whole request as JSON
  (memory, reads, scratch, restore). `sp` and `mdr` are the frame's, not free values. Their tone hook's 6 cases
  (`tonecall`) and their stage test's 8 runs (`ncall`) give their drivers' values this way on v0.29 (X).
- **Traces, breakpoints and watchpoints in scripted sessions** (`host/session.mjs`; the debug route's `probe` and
  `hits`, `src/debug/live.mjs`; exec probes in the interpreter's breakpoint filter, `src/core/interp.mjs`):
  `trace:PC` and `trace:mem:ADDR:LEN[:r|w|rw]` record each hit with the 16 registers in the step's record, and
  `break:` stops the firmware, runs the next tokens at the stop and goes on at `resume`. A logging trace changes
  nothing the firmware does (X, `emu/test/test_trace.mjs` on E143 and E147: every step's lab time and frame equal).
- **The regression run of every release** (`emu/test/test_caduceus.mjs`, its pins in
  `emu/test/fixtures/caduceus-releases.json`; 4.2).
- **A film's values below the pixels** (`emu/test/test_looks.mjs`; 4.6).
- **The still path's coverage below S2, pinned per body** (`emu/test/test_storage.mjs` STILL_PATH, `docs/hle-gaps.md`
  4.3.12; 4.4).
- **E147 in stills mode** (`src/fw/models.mjs` switch_idle, `docs/hle-gaps.md` 4.1.13). The lab started the OM-3's
  still / movie switch (UI_IN's position switch `0x1909`) at a movie position, so every E147 session ran the camera
  application in its movie mode (setting 44 = 1, X); sessions now start at the stills position. v0.29's flows pass as
  before (X: 4.2's recipe, and a 63-step flow whose EXIF is the same but for the dates and whose frames are the same
  but the Super Control Panel's after the first OK). With the rule takeRequests, E146 and E147 also reach E143's level under `control camapp 3` (S-TAKERDY,
  S-MODPOST), which no flow here uses: their hook sites hit as under camapp 1 (X).

### 4.2 Verifying a caduceus build

From om-emu's root, with `R` a release folder of theirs (or a build's folder) and `W` a work folder:

```sh
node emu/bin/card.mjs new $W/card.omsd --model E147                     # a blank card E147's firmware formats
node emu/bin/card.mjs put $W/card.omsd $R/LOOKS.BIN OM3MOD/LOOKS.BIN
node emu/bin/session.mjs --model E147 --patch $R/patch.json --card $W/card.omsd \
  --nvram $W/nv.json --out $W/run --script $W/flow.txt; echo "exit $?"
```

`--main $W/main.bin` takes a local build's block in place of `--patch`. `$W/flow.txt`:

```
wait:1500
expect:card:OM3MOD/LOOKS.BIN
expect:mem:0xa32de590=ff030000          # all ten sections copied (S-SECLOADED); nothing written
expect:mem:0x62b4dd16=0000              # their state word: no card load yet
s1 wait:1200
expect:mem:0x62b4dd16!=0000             # the half press ran their card load
ok ok right right right right
expect:gui=SS_MENU_LV/ID_ST_DIRECT_PICTUREMODE_ART
shot:film1.png
ok
s1 s2:down wait:300 s2:up wait:5000
expect:exif:DCIM/100OMSYS/*.JPG:ImageDescription~FILM
expect:exif:DCIM/100OMSYS/*.JPG:UserComment~Caduceus
card-get:DCIM/100OMSYS/*.JPG=shot.jpg
power:off
```

On v0.29 (X, 2026-11-13, again on `d38ceff`) this exits 0 with `session.mjs: passed; 26 step(s) on E147, patched; no
poke`, and no step's record has `osd_errors` (an OSD picture the engine refused; 4.1). `film1.png` is
the Picture Mode page with FILM 1 "Portra 400" highlighted, and the JPEG's ImageDescription is `FILM 1 Portra 400`. The
start lines name the patched build (158 patches, 321,613 bytes changed, `frames` and `card_files` not applied) and give
the audit's loaded ranges: `patch audit: no patched byte where the boot does not load or is not shown to load`. The
`power:off` saves the camera's state to `nv.json`; a `restart` after it powers on again on that state with the dials
where they were, and a `restart` without it is a battery pull.

The summary's `patch_audit` for v0.29 is `hooks` none, `ported` two entries (2.8: GET_STRING, whose patched code the
lab runs as the camera does, and the end word `sections.ends[5]`, which the lab reads from the patched image), and
`unloaded` and `tasks` none. An entry in `hooks` would stop the session where the hook is reached. An entry in
`unloaded` is a patched byte the camera would not load. A `ported` entry other than these two marks lab knowledge the
patch rewrites, to be read before trusting the run.

Exit 1 means a firmware or lab error (a stop such as S-STALERAM's), an input the player refused or dropped, a failed
expect, or a refused option (a patch whose digests do not match); 2 a usage error. The last stderr line says `no poke`
or names every `write:`. The negative control is v0.29's block with section 6's end word put back to stock (2 bytes,
`--main`). The same flow then exits 1 at step 0: the start line lists 651 patched ranges past section 6's loaded end,
and CA_MAIN stops at `0x60f4aa48` in that gap. With `--loaded off` the same block passes all 26 steps (X, both).

**Every release, as a regression run.** `emu/test/test_caduceus.mjs` runs this recipe on each release folder of a
local checkout of theirs, adapted to what the release ships, and compares what it sees with pins kept in
`emu/test/fixtures/caduceus-releases.json` (digests and observations, no byte of theirs). With `C` the checkout (it
reads `$C/releases` and never fetches):

```sh
OM_CADUCEUS=$C node emu/bin/test.mjs                                   # with everything else
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_caduceus.mjs       # alone; OM_CADUCEUS_JOBS=N at once (3)
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_caduceus.mjs --pin v0.30 [--flow JSON]   # a new release's row
```

Each folder's `patch.json` and the card files the flow puts must have their pinned sha256 (a change fails: upstream
changed a published release), and the reader must give the pinned `main_sha256_before` and `_after`; a folder with no
pin is reported as unpinned and the others still run. The flow: the release's card files on a card `bin/card.mjs` made
(v0.29 on: `LOOKS.BIN` alone; v0.24.1, which ships none, gets v0.25's); the open under the loaded-ranges mode with the
pinned patch audit; the copied mask; their state word 0 at 4.5 s and set after S1; the Picture Mode page; from v0.24.1
the names of FILM 1, 2 and 20 as their string getter gives them for the list's title ids (`0x7f10` + j, their source),
right five times to FILM 2 and OK; S2 and the picture's ImageDescription and photo code prefix (`FILM 2 Gold 200`,
`Caduceus FILM 2 Gold 200 om3.1.` from v0.27; the films of v0.29 and v0.29.1 give `Portra 160`); the page's title by
the same getter (id 203, which their code answers with the selected film's name); the card's `OM3MOD` files (v0.24.1 to
v0.28 write `EDITS.BIN`, `BUNDLES.BIN` and `.NEW` copies, v0.29 on nothing); `power:off`, a restart (from v0.29 on a
blank card), S1, S2 and the title again: the film kept. Frames are not pinned. Measured (X, 2026-11-13, on `d38ceff`):
all 19 folders from v0.16 to v0.29.1 as pinned, 24 to 35 s each, 3 min 20 s with three at once. The pins' controls are
in the test: v0.29 with section 6's end word put back to stock stops at the open naming section 6 (651 ranges in the
audit's `unloaded`), and a pin with one digest character changed fails; with S-SECLOADED left out of the lab the flows
of v0.16, v0.25, v0.29 and v0.29.1 fail (X, by hand). What it cannot show, pinned as such: v0.16 to v0.22 keep their
looks on the colour wheel's page, whose plane the lab does not compose; v0.26.2's and v0.27's load at power-on never
runs, as their worker (H-PATCHTASK) waits for boot-stage bits `0x2e9` at `0xa32de58c` of which S-BOOTSTAGE sets bit 0
only (D, their source; X: the state word is still 0 after 4.5 s), so the half press loads the films.

**v0.29.1's films with no card** (their #38, camera-tested). A session cannot start without a card, and after the card
is taken out (`input({type: 'card', action: 'remove'})`) S-MEDIA leaves S-CARD's OK (`0xF000`) in the SD medium word
`0x60369308`, which their gate tests (X): v0.29 and v0.29.1 then both load the films at S1, so the lab does not tell
them apart. With that word set to NO_MOUNT by a poke (any value but OK takes the same branch of their gate, D), v0.29
loads nothing at S1 (state word 0, the page lists COLOR 1 to 4) and v0.29.1 loads the films from the camera's memory
(the title `Portra 160`, the film kept from the first session), as their camera test reports (X). The regression run
pins both, with the poke listed.

### 4.3 Their driver's features in the session tool

Their main driver (`tools/emulator/session_ed1.mjs`, D) against `bin/session.mjs`:

| Their driver | `bin/session.mjs` |
|---|---|
| a whole `main.bin` as the image | `--main FILE`, through the overlay, the audit and the loaded-ranges mode (`--loaded off` is their whole-block load) |
| the card file; a saved copy | `--card FILE`, written back in place (copy it first); `card-get` / `--card-get` take files off |
| the settings file | `--nvram FILE` (off, a blank camera, by default) |
| key clicks and holds, the dials, waits; 1200 ms after each token | `KEY` (down, 150 ms, up, then the settle), `hold:KEY[:MS]`, `wait:MS`; `--settle 1200` for presses and switches. `main_dial:+N` / `sub_dial:-N` turn the dials N detents (X: `emu/test/test_session.mjs` turns both in a session and each changes the frame; on `d38ceff` and before, the token sent the control's id where the player takes `main` or `sub`, and a session refused it; follow-up 1) |
| the GUI state and their state word after each step | each record's `gui`; `read:ADDR:LEN`, `expect:mem` |
| their editor's fields at an address read from memory | the module API: `s.step('read:...')` returns the bytes and the client computes the next address |
| shots | `shot:FILE.png`, the last published frame (`/api/frame`'s pixels), not their own composite |
| the mask and media-word writes | not needed; a `write:` is still taken and reported as a poke |
| power-off | `power:off`; `restart` then powers on again on the kept state |
| calls of whole functions (getters, setters, malloc) | `call:FN:d0=..`, every register returned; the lab's hooks answer as for its own calls, where their stepping ran past them |
| calls from a spec with memory, sp or pc and stop pcs (`ncall`, `tonecall`) | `call:FN:entry=PC,stop=PC,frame=MASK/SIZE`, or `call:@FILE` with the op's whole request (memory, reads, scratch, restore); `sp` and `mdr` are the frame the harness's CALL builds, a larger frame for code that moved `sp` before the entry (their two drivers give their values so, 4.1) |
| exec-trace watches (`WATCH`, `WSTACK`, ...) | `trace:PC`, `trace:mem:ADDR:LEN[:r\|w\|rw]`: each step's hits with the 16 registers and counts; `break:` with `read:` and the other tokens at the stop, then `resume`. `WSTACK`'s stack at every hit is not provided: `read:` it at a stop |
| a dump of RAM | no token; `read` takes at most 64 KiB, a module client can loop |
| the player's `a15` and EVF options | not exposed: play's defaults (the TFT) |

### 4.4 What the lab cannot verify today

- **Looks on pixels.** Their looks act as data handed to the development (settings, parameter records, LUTs and
  tables) and, for halation and the CPU grain, as code on the developed image (4.6). The S2 picture is S-SCENE's frame
  encoded by S-JPEGENC, so no film changes it, and none of the development's hook sites runs (X, 4.6). What the lab
  checks today is a film's values where the camera takes them: its settings and the hooked capture reads (4.6). Below
  the EXIF fill, where their reboots and hangs happened, the lab runs natively rec_ImgPro_CreateParam and its helpers
  (`.hook_fx` among them), the image library's create with the still constructor and its second step, ImageParam's
  body and the release; the parameter set, the run, its stages and kinds do not run (S-JPEGENC), nor do TAKE's
  shot-record fill and takepic, even with E143's native TAKE (`docs/hle-gaps.md` 4.3.12, X, pinned per body in
  `emu/test/test_storage.mjs`). The create's constructor follows setting 38017, which follows the creative dial (X; I:
  the picture mode): on the camera an E147 still at COLOR, MONO or ART takes `0x504966f7` and the create's second step
  the stub at `0x50496710`, their `.hook_su`, after CreateParam's extension allocates two buffers (D). The lab writes no
  picture mode into the shot's record, so its create takes the still constructor and `.hook_su` does not run: writing
  it stops the still at that allocation, which MM does not answer in the lab (X).
- **The colour wheel's plane**: the GPU plane is not composed (`PLANC_UNOBSERVED`, stock too), so on the wheel's pages
  the published frame stays the one before them and `shot:` cannot show the wheel or its guides (X).
- **The boot order** of sections against the tasks that call into them (FIDELITY 7.18).
- **Timing, the watchdog and the cache**: no fetch cost, no cache or watchdog model (their lk7 / lk9 hang).
- **Component 2's frames**: the lab loads only the main and resource blocks, and `om3-patch-2`'s `frames` are
  reported as not applied.
- **The EXIF exposure fields**: ExposureTime `10/10`, FNumber `0/10` and ISO 25 are S-EXIFPRM's, not the session's
  exposure (X, the picture of 4.2).
- **Picture runs across a row end in formats other than 0x0B**, and a run past a picture's last row: the OSD engine
  refuses them (`BMP_TOKEN`, in the step's `osd_errors`); A-BMPWRAP covers format 0x0B only, the one their pictures use.
- **A power-on without a card, and the medium word after a removal.** A session always starts with a card in the
  first slot (`src/lab/player.mjs`), and after a removal S-MEDIA leaves S-CARD's OK in the SD medium word their gate
  reads (2.3), so their card-less behaviour needs a poke (4.2, v0.29.1).
- **Their power-on film load (v0.26.2, v0.27)**: its worker waits for boot-stage bits S-BOOTSTAGE does not set (2.2,
  4.2); the half press loads the films instead.
- **The OM-3's movie mode**: the still / movie switch is not a player input, and every session runs in stills mode.
- **A call at a debug stop**: refused, as the stop is inside the lab's tick. A call between ticks runs with traces
  armed, and breakpoints do not stop it. A stop is a main-loop visit an untraced run need not make, so the interrupt
  taken after it may differ; logging traces do not change the run (X).
- **`bin/nav.mjs` on E147**: its bring-up check stops at start, stock too (X: `error: bring-up: tasks started: [...]`).
  Use `bin/session.mjs`.

### 4.5 Facts taken, and what is not taken

**Takes as facts** (attributed, for the specs): the E147 section table, end switch, copied and phase masks, reset head
copies and gap sizes (2.1, 2.2); the media setter's kinds (2.3); the EXIF writer table and fill site (2.6); the
Creative Dial's mapping (2.7); and as leads, unchecked here (?), their maps of the OM-3 still pipeline (work lists,
request and combiner fields, the tone stage), the Button Function tables and the GUI's Picture Mode structures.

**Does not take** code, patch bytes or assets (no assembly, no `patch.json` or built image, no card files, LookLab,
film data or pictures; the tests write synthetic patches, `emu/README.md` "Patch overlays"), nor their camera claims as
evidence beyond saying they exist.

### 4.6 Checking a look below the pixels

Before anyone builds a development pipeline: where a film acts, which of those places run in the lab, and what the lab
can check today. Read from their `v0.29` sources (`firmware/src/editor.s`, `xblock.s`, `firmware/build.py`,
`docs/FORMATS.md`, `docs/DEVELOPER_NOTES.md`; D, their source), with their symbols from a build of the tag outside the
tree (its main block differs from the release's in 25 bytes, its layout is the release's, X). Run on the second
round's base `ae63e25` with the v0.29 release's `patch.json` and `LOOKS.BIN`, through `host/session.mjs` only: reads,
calls and log watchpoints sent through `input()` (X, 2026-11-13; the `trace:` tokens of 4.1 now do the same from a
script). Addresses in E147 notation.

**How a film reaches the picture (D, their source).** Picking FILM j puts look j % 5 + 1 on COLOR k = j / 5 and does
two things (`pf_put`): it writes 18 of the camera's own settings of COLOR k through the camera's settings manager, as
the GUI's edits do (Saturation 928 + 12k + s from the record's +24 + s, Contrast 908 + k from +41, Sharpness 904 + k
from +42, Shading 912 + k from +43, Shadows, Midtones and Highlights 978, 977 and 976 + 3k from +44, +45 and +46), and
copies the record's other fields into its own slot in their heap block. The camera's development reads the settings;
their hooks read the slot.

| Film parameter (record) | Where it acts | Data or code | Runs in the lab at S1 / S2 |
|---|---|---|---|
| Saturation per colour, Contrast, Shading, Shadows / Midtones / Highlights (+24..+35, +41, +43..+46) | the camera's settings above, read by the stock development | data | written at the pick (X, the check below); the development's reads: no |
| Hue and Lightness per colour (+0..+23) | `jmp hl_pp` at `0x504f75f5`, the COLOR stage's (`0x504f7553`) call of the HSL builder `0x504f7361`; it rewrites hue (+18) and lightness (+22) of the builder's 12 output records (24 bytes each from the output's +836) through a table of theirs | data: the stage's parameter records | no |
| Blacks, Whites (+39, +40) | `call tone` at `0x504f87b7` in the stage list, in place of `call 0x504f7f84`: the job's 256-entry 10-bit luminance LUT copied to its +3832 and remapped (a toe and a shoulder) | data: a LUT | no (I, below) |
| Split toning, Tone Balance (+53..+56, +58) | `st_run`, the tone hook's exit: the job's R, G and B gamma tables (+1252, +1892, +2532; 256 + 64 entries, 12-bit) bent in place | data: tables | no (I, below) |
| WB shift A-B, G-M (+36..+38) | `wb_get` at the 21 call sites of the capture-safe getter `0x50042360` with the WB fine-tune keys (34041, 38521 and the Auto WB ones): 14 in the EXIF set's body `0x50435773..0x50436ffd`, `0x50442192` / `0x504421a5`, `0x504666a3` / `0x504666b8` and three at `0x518c5610..0x518c563c`; the camera's value plus the shift, clamped to -7..7 | data: a setting's value | the EXIF set's: yes, twice at S2 (the A-B and G-M reads it stores at the shot's +37734 and +37736, D); the others: no |
| Sharp, NR, VigFix (+52, +49, +50) | `s_nr` -> `xb_nr` at `0x503c665f` (Sharpness, key 33049), `0x503a7018` and `0x503c6871` (Noise Filter, 38681) and seven Shading Comp. reads (`0x8c21`) | data: a setting's value | the EXIF set's Shading Comp. read (`0x50436e63`): once at S2; the others: no |
| Grain (+51) | the camera route: Grainy Film's texture and combiner 1's gains on a COLOR job, at `0x50496710` (still set-up), `0x50497d71` (work list), `0x504745d1` (request configuration), `0x504e3b3d` and `0x504e43ac` (combiner set-up); the CPU route (`xb_gs`, a luma pass row by row) with Glow or an Art Effect | data; the CPU route code on pixels | no |
| Glow / Clarity (+47), Halation (+57) | `jmp s_cap` at `0x50534e30` in the Art Effect converter `0x50534e27` (Soft Focus job flags), `s_wt` at `0x504e38a1` (the blend weight); halation: `hl_run`, a CPU pass on the YCbCr image after the Soft Focus blend | data, then the pipeline unit's passes; halation code on pixels | the converter: once at S2, and their code took its stock exit before reading the film (which of its two tests sent it there is not read, ?); the weight and `hl_run`: no |
| White frames (Art Effect Frame) | job flag `0x8000` and the frame layers of container component 2 | data | no: the Art Effect reads 0 in v0.29 (`XB_ART 0`, D) and the lab does not load component 2 |
| Live view | `s_lv` at `0x5044a89b` (the live view's development request) | data | no: the live view is S-SCENE's |

The film WB mode (+59..+62, v0.28) is not traced here. The last column is X where not tagged: log watchpoints on reads
of their state word `0x62b4dd16`, their heap block and their code block, during S1 and then S2 after FILM 1 was picked;
every hook above reads the state word at its entry or right after its stock call (`hl_pp`, `wb_get` after its picture
mode tests, `xp` for the stubs), and each hit's pc names its function by the build's symbols. At S1 no look code ran
(their editor's save, film list and photo code did). At S2: `wb_get` twice (the slot's WB-on, A-B and G-M bytes
read), `xb_nr` once (the VigFix byte), the converter's stub once and their photo code once; nothing else. So the only
look code the lab runs today is in the EXIF set (metadata) and in the converter, which a static call scan reaches from
rec_jpeg_make_image (`0x50536e37`) through `0x5052e69f` (D). `tone` and `st_run` read the job before the state word,
so their absence is I: no chain of direct calls reaches the stage list from rec_jpeg_make_image (the same scan; its
callers' chains end in indirect calls, D), and the stages sit in the image library's run, which S-JPEGENC stands in
(`emu/src/lab/rec.mjs`).

**The check (X).** `emu/test/test_looks.mjs` (with `OM_CADUCEUS` set to a caduceus-om3 checkout; `bin/test.mjs` runs it
then, about 20 s) takes a release's `patch.json` as `--patch` and its `LOOKS.BIN` onto a card `bin/card.mjs` made, on a
blank camera, and picks FILM 1, 2 and 3 in the Picture Mode list as in 4.2. After each pick it reads COLOR 1's 18
settings with the settings getter (`0x503cf0f1`) and calls the hooked capture reads, their targets read from the patched
image at the EXIF set's two WB fine-tune pairs and at the Sharpness read `0x503c665f`: keys 7401 and 7417 (`0x50436d3f`,
`0x50436d72`), the pair the lab's S2 reads, and keys 34041 and 38521 (`0x50436962`, `0x5043697c`), the EXIF set's other
branch, which the lab's S2 does not run (X: a trace over the S2 press hits the first pair once each and the second not
at all, and `wb_get` is entered twice, D: both branches store at the shot's +37734 and +37736), and key 33049; it
expects the settings to equal the film's record, the WB reads the capture-safe getter's value plus the film's shift (or
the getter's value where the shift is off) and the Sharpness read the film's Sharp. S2 on FILM 3 must write `FILM 3` and
the film's name into ImageDescription, so the films checked are the ones the camera names; no poke and no harness input.
On v0.29 and on v0.29.1 all 23 checks pass. FILM 1 (Portra 400): Saturation `-1 0 0 0 0 0 -2 0 -1 1 1 -1`, Shadows 2,
Midtones 1, Highlights 0, the WB reads 1 and 1 on both pairs (the getter's 0 and 0), Sharp -1; FILM 2 (its shift off):
the WB reads 0 and 0; FILM 3: 1 and -1. Controls: each film's record must differ from the values read before its pick (a
pick that changed nothing would pass otherwise), and among the three a film with its shift on must move the WB reads and
one with it off must not. Mutants (X): the Shadows and Highlights ids swapped in the expectation fail all three films
(15 of 18); the WB read's target replaced by the camera's getter fails FILM 1, FILM 3, the hook check and the control
(14 of 18, before the S2 pair was added); the S2 pair's reads sent to the camera's getter fail FILM 1, FILM 3 and the
control (20 of 23).

It shows that a film's values reach the settings the development reads and that their hooks answer the capture's
reads with the film's values. It does not show what the development does with them, nor anything of the hue and
lightness, tone, split-toning, grain, glow or halation hooks. Those could be checked on their outputs without pixels
by a call into the COLOR stage with a stop after `hl_pp`'s jump back (it is entered by a jump inside the stage and
leaves by one) and by a call of the tone hook on a job context written into the call's scratch, stopped where it
jumps on to the stock `0x504f7f84`. The call op takes such an entry and stops since the second round (4.1; their
`tonecall` runs so on v0.29, X); what is missing is a job layout read from the stages: days (I, follow-up 3).

**What stands between the hook sites and the JPEG**, in the camera's order (I for the order):

1. **TAKE's shot** (S-RELSEQ, S-EXPOSE, S-TAKEFRAME): no take request, exposure record or RAW frame;
   rec_ImgPro_ImageParam's four sources find no buffer in TAKE's shot table (X on E143, E146 and E147: S-JPEGENC's
   text). Size: TAKE natively with its neighbours stood in, 1-2 weeks (`docs/hle-gaps.md` 4.3, I); the lab has no RAW
   image to give it (S-SCENE draws a view frame), so a RAW source would be a new stand-in.
2. **The white balance gains** (S-RECREQ in place of REC_PREPRO's step; REC_RAWNR's on E147): the shot record's four
   gains stay 0 and the library's parameter set divides by them; on the camera a computation over TAKE's shot fields
   gives them (`docs/hle-gaps.md` 4.3.4, D on E143). Size: weeks (I). Whether the development's own WB reads
   (`0x50442192`, `0x504666a3`) belong to this step is not read (?).
3. **The image library's parameter set, the run and Jpeg_Result** (S-JPEGENC's three steps, on E147 as on E143 since
   2026-11-11, `emu/src/lab/rec.mjs`, D): the stage table, the work pool (a probe's allocator walk did not end on E143,
   `docs/hle-gaps.md` 4.3.4, X) and the development stages whose builders their hooks patch (I; the work-list hook is
   reached from rec_jpeg_make_image through `0x5049272b` in a static call scan, D, and did not run, X). Size: the
   library is about 275k instructions, 162k of them straight-line parameter packing (`docs/hle-gaps.md` 4.3, D); the
   set and the run's set-up natively up to the pipeline unit's request: weeks after 1 and 2 (I). With 1 to 3 every data
   hook in the table runs and its records, LUTs and tables can be checked against LOOKS.BIN.
4. **The pipeline unit at `0x9c200000`**: one kind 0 request makes the developed image and the primary JPEG; its
   registers and interrupts are not read (?) and the lab refuses its first write (`docs/hle-gaps.md` 4.3.9, D). The
   firmware gives no evidence of its pixel processing (`docs/hle-gaps.md` 4.3, D), so a model of it is a declared
   stand-in, and a data look checked on its pixels would check that stand-in, not the camera. Size: months (I).
5. **The JPEG codec at `0x99901000`**: driver and registers read (`docs/hle-gaps.md` 4.3.9, D on E143), fed by the
   unit, no buffer address of its own. Size: days after 4 (I).
6. **S-IMGPRO's other request kinds**: only kind 14's fills are computed; Jpeg_Result's kind 13 copy is not. Size: days
   (I).
7. **The CPU passes on pixels** (`hl_run`, `xb_gs`): they would run on the lab's CPU once a developed image is in
   memory after the Soft Focus blend, so they wait on 3 and 4 (I). A call of `hl_run` on an image put in the call's
   scratch would test halation's code on pixels before that, at their address and with a buffer record and bus window
   of their layout; not tried.
8. **Container component 2** (the white frames' layers): not loaded (`frames` not applied, 4.1). Size: days (I); the
   blend itself is the unit's.

The E147 capture path at E143's level removes none of these: E143 stops at the same three steps of S-JPEGENC (3), and
E147's rec_jpeg_make_image already runs natively up to them (D, `emu/src/lab/rec.mjs`). Only running 1 to 3 natively
reaches a development hook.

## 5. Where it corrects om-emu's docs

All four are made (2026-11-13).

1. `docs/hle-gaps.md` 4.6 ("CPU 2's code and loader") said the lab's image already holds every segment and the copies
   matter only to a cold boot (I). On the camera the bytes past each loader end are not loaded (their report, 2.1), so
   the copies and their order matter to any image whose code or data lies past an end or runs before its section is
   copied; on E147 the same structure is `load_section` `0x50024eb5`, the end switch `0x50024e4c` and the copied mask
   `0xa32de590` (D). It now points at S-SECLOADED, S-STALERAM and the load order.
2. `emu/README.md` "The camera's kept state" said two sessions on a fresh file restore M and E on each (X). That held
   after a menu close; after a native power-off the next E147 session stopped at the registry bootstrap, `prints
   ["FlD.", "BlR.", "ElR.", "MlR."]` where `"BlD."` was expected (X, stock, at `f2b326b`), because the kept SCPU words
   restore the B store that `src/lab/menu.mjs`'s expectation did not count (D). S-NVRAM now counts it (4.1).
3. `src/lab/play.mjs` said of E147's Creative Dial that which position is which profile is not known: the firmware's
   value-to-family mapping is in 2.7 (D); which value each physical position gives is their report. The control now
   takes the families from `src/fw/models.mjs` `creative_dial` (4.1).
4. `docs/ROADMAP.md`'s firmware-patch track named whether the camera accepts a no-op image as what remains before
   flashing. For E147 the SD updater accepts a main block their releases change (321,613 bytes in v0.29), with
   recomputed block checksums and the version unchanged, in every release since v0.16 (their report); E143 stays open.

## 6. Open questions

- What the media manager stores in the SD medium word `0x60369308` when the card is taken out: S-MEDIA's notifications
  do not include it, and the lab keeps S-CARD's OK (4.2, 4.4).
- Which of the Art Effect converter stub's two tests sent their code to its stock exit at S2: the capture's Art Effect
  byte or the parameters' key (4.6, ?).
- What the boot stage before the main block's loads: whether it covers the ranges the lab treats as not shown loaded
  (E147 `0x60129000..0x60134000` and `0x603a2bd4..0x603a3804`, 2.1). A camera probe of those ranges in the way of their
  GX probes would settle it. Who reads the end the head stores to `0x629607a0` is not read either (?).
- What the camera's unloaded RAM holds at power-on (their gap sums vary between runs), so which poison the lab's
  loaded-ranges mode should use is a model choice, not a fact.
- When sections 6..10 are copied relative to the tasks that call into them, the order behind their v0.20-t1 boot loop.
- Why the camera sends their custom Picture Mode row's OK as another event than the lab's (their test 12), and the
  stills-mode key and front-dial routing on E147 (`research/BUTTONS.md`). The om-emu versions their notebook names
  start E147's still / movie switch at the movie position the lab used until 2026-11-13 (`SWITCH_IDLE_POSITION` 1 at
  `147ca89` and `d24ff9d`, D; 4.1); whether a re-run in stills mode agrees with the camera is open (follow-up 2).
- Why the firmware's `fopen` found `DEBUG.TXT` but not `DEBUG.ON` in the lab (their notebook; not tried on a camera).
- Whether E143's SD updater accepts a modified main block as E147's does.

## 7. Follow-ups, ranked

The first round's follow-ups 1 (a regression run of each release), 2 (row-crossing OSD runs) and 4 (mid-function
calls and exec traces in scripted sessions) are done (4.1, 4.2); what they left is below.

1. **The session's dial tokens**: done in the second round's final pass. The step sends the player's dial id (`main`,
   `sub`), and `emu/test/test_session.mjs` turns both dials in an E143 session (4.3). Their driver's dial steps now
   run through the supported API, as follow-up 2 needs.
2. **E147 stills-mode key dispatch** (their `research/BUTTONS.md`: the arrow keys and front dial in P / A / M read
   other setting ids in the lab). First re-run their cases on the stills position (4.1, `docs/hle-gaps.md` 4.1.13),
   then read what still differs; an input for the still / movie switch would let a session choose movie mode. Size:
   a day to re-run, days if a difference stays (I). Payoff: the Button Function and dial paths users run.
3. **Their look hooks on their outputs, without pixels**: the COLOR stage entered for `hl_pp`, the tone hook and
   `st_run` called on a job layout written into the call's scratch, with the call op's `entry` and `stops`, checked
   against LOOKS.BIN; `hl_run` on a synthetic YCbCr image (4.6). Size: days (I: the job layout is to be read from the
   stages). Payoff: hue and lightness, Blacks and Whites, split toning and halation checked on the firmware's own CPU
   path, as their notebook did with stubs.
4. **A power-on without a card, and the medium word after a removal**: a session whose first slot starts empty, and
   S-MEDIA writing what the media manager stores on a removal once that is read (6). Size: days (I); S-MEDIA's change
   reaches every body whose card runs its HLS side, and E143's golden sessions. Payoff: v0.29.1's films with no card
   (their #38) without a poke.
5. **E147's still at COLOR, MONO and ART** (`docs/hle-gaps.md` 4.3.12): S-EXIFPRM writing the picture mode, once MM
   answers CreateParam's extension allocation (`0x50521c4b`) and the second step's stub's failing allocation is read.
   Size: days to weeks (I: neither cause is read). Payoff: their still set-up code (`.hook_su`) runs at the create.
6. **The boot-stage bits** their v0.26.2 / v0.27 power-on worker waits for (`0x2e9` at `0xa32de58c`; 2.2): which boot
   steps set the bits past bit 0, so that S-BOOTSTAGE sets them where the camera does. Size: days (I). Payoff: those
   releases' power-on load runs; v0.29 does not use that worker.
7. **The boot order of sections** on E147: copy sections as the loader does, at its point in the boot, so code that
   calls a later section early faults. Size: weeks (it is CPU 2's boot job). Payoff: the v0.20-t1 class of boot loop.
8. **The still capture through development** to a recording image processor, compared with their camera logs. Size:
   months. Payoff: the largest: their looks, grain and halation, and every capture-path crash in section 3. It splits
   (4.6): first TAKE's shot, the white balance gains and the image library's parameter set and run natively up to the
   pipeline unit's request, which runs every data hook so that its records, LUTs and tables can be checked against
   LOOKS.BIN without pixels (weeks, I); then a model of the pipeline unit, which the firmware gives no evidence for
   and which would be a declared stand-in (months).
9. **The K3000 wheel plane** (`docs/hle-gaps.md` 4.12). Size: weeks. Payoff: the OM-3's colour wheel, theirs and stock.
