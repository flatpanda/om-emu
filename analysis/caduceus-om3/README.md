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
listed in 4.1, and where it changed a result the text says so. A third round on 2026-11-14, on base `a68dca3` and the
same checkout, took up the second round's follow-ups in the same way, and a fourth later that day, on base `b36e3e5`,
took up the third's. A fifth on 2026-11-17, on base `19befb74`, read upstream's eight releases since (v0.29.2 to
v0.30.3, checkout `78a809e`), pinned them and judged what in them is useful here (section 8). A sixth on 2026-11-22,
on base `6b111c6b`, pinned the eight after that (v0.30.4-alpha to v0.40.2) from their release assets (section 9). No
excerpt of Caduceus' code, no byte of its patch and no picture it draws is committed.

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
   breakpoints in scripted sessions, and a check of a film's values below the pixels (4.1, 4.2, 4.6). The third adds
   their driver's remaining tools (stack captures, dumps, the display options, a call at a breakpoint's stop), the
   still / movie switch as an input, a power-on without a card, the boot-stage bits the lab can justify, the camera's
   pipeline constructor for a still (their still set-up hook runs at S2), TAKE's exposure in the picture's EXIF and a
   check of three look hooks on what they write (4.1, 4.6). The fourth adds a built `.BIN` as `--main`, a patch's own
   cache flush answered, the OM-3's display switch, the picture's shot in TAKE's own table, the stock stage builders
   pinned on a job the test writes, and their Grain route and halation pass checked by calls (4.1, 4.6).
   **Corrections to om-emu's docs:** four (section 5), all made.
7. **Since (2026-11-17, section 8).** Eight more releases, v0.29.2 to v0.30.3 (custom modes, Delete remap, per-mode
   settings, Color Mix and RGB curves, films at switch-on), run in the lab as published and pinned with no poke; their
   films load before any half press from v0.30 on and their `CURVES.BIN` is kept in store M (X). Of use here: the
   firmware's own setting names in container block 2 (X on E143, E146 and E147), the mode codes and the still / movie
   switch's byte (X), the stage list's colour-matrix call and a shot's job types (D), and three camera-vs-lab
   differences around the mode change, unexplained. One correction (2.7's family 898).
8. **Since (2026-11-22, section 9).** Eight more, v0.30.4-alpha to v0.40.2 (crop modes, borders, their own grain,
   screen-info rows), all pass v0.30.3's flow as pinned; the one new observation is the audit naming the settings
   store's save, which their patch now enters. Two lab limits their `research/TESTING.md` still states (`fopen`
   truncation, no still / movie switch in `bin/session.mjs`) no longer hold.

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
per-section step's `or` at `0x5002503e..0x50025046` (X, the same scan). Bit n - 1 is set by section n's step after
its static constructors; CPU 0 runs the steps of every section but 8, whose step CPU 1 runs, and the steps of 9 and 10
are posted only after stage 8's bit (D, `docs/hle-gaps.md` 4.6.4). S-BOOTSTAGE sets the bits of sections 1 to 7, whose
constructors the lab runs (or which have none), and the word reads `0x7f` at open (X, 2026-11-14; it read 1, bit 0
alone, before). Their gate does not test it; only the card-load worker of v0.25..v0.27 waited for bits `0x2e9` (D,
their source), which include bits 7 and 9. Of those releases the patch audit lists a task in patched bytes for v0.26.2
and v0.27 only (X, the regression run of 4.2), and there the worker never gets past that wait: setting bits 7 and 9
would need CPU 1 to run section 8's six constructors.

### 2.3 The media word and its setter

The media status setter `0x50adf011(kind, value)` (E143's `0x50aca703`, port pair X) stores kind 4 at `0x60369308`,
kind 8 at `0x60369300` and kind 1 at `0x603692f8` (D, `0x50adf011..0x50adf034`), om-emu's SD, SD2 and IN status words
(`src/lab/camapp.mjs`, at E143's `0x60360bec`, `0x60360be4`, `0x60360bdc`). The mount path passes `0xF000` at
`0x50bd33fd` when its checks pass (D). S-CARD writes SD's word `0xF000` (`camapp.mjs`, since `2d10425`, 2026-11-12), and
a stock session reads `0xF000` there at open (X), so their write of that word is redundant now. At a card's removal the
slot's card-switch case of the sequence parts writes NOT_PRESENT `0x1001`, at an insertion NO_MOUNT 0, and the media
manager's status update then rewrites each slot's word from its device (D, `docs/hle-gaps.md` 4.8.3). Since 2026-11-14
S-MEDIA writes the same for the first slot at a removal and an insertion, and S-CARD writes NOT_PRESENT at a start with
the slot empty (X: a stock session started with `--no-card` reads `01100000` at `0x60369308`).

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
and v0.29 (X, second round). Of the exposure fields beside them, ExposureTime is the session's exposure plan since
2026-11-14 (1/200 s in 4.2's picture, X); FNumber and ISO are not (section 4.4).

### 2.7 The Creative Dial and the settings getters

- **Creative Dial (D, `0x501f58a5`, theirs `0x602168c5`).** The power-on routine reads UI code `0x1906` through
  `0x501570c5` and, for values 1, 2, 3, 4, 5, prints a `picd_00n!` string and sets setting 897 (the Picture Mode
  family) to 900, 899, 898, 901, 988 through `0x503cf304` (theirs `0x603f0324`; E143's `0x503c4b2f`, port pair X). That
  the four physical positions are CRT = 900, ART = 899, COLOR = 901 and MONO = 988 is their report. 898 is not "none",
  as this note said until 2026-11-17: the firmware names it `MODE_COLORTONE_DIAL_NEUTRAL`, the standard picture modes'
  family, and their #65 notes log it at the dial's standard position (X for the name, their report for the position;
  8.3). At
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
on E147" no longer holds: the card's removal and insertion run there, and since 2026-11-14 a power-on with the slot
empty too (X, the regression run of 4.2).

**Where the lab misled them or could not answer.**

| Case (their name) | On the camera (their report) | In the lab (their notebook) | Why (om-emu side) | Closed by |
|---|---|---|---|---|
| Slider code at `0x60133000`, in the `0xff` run below section 1 | not flashed: it would not have been loaded | ran | the whole block is mapped (2.1) | closed: the loaded-ranges mode stops code there as not shown to load (?) and lists patched bytes there at the start (4.1) |
| v0.20-t1: stage code in section 2 calling section-8 code | boot loop, recovered by flashing v0.19 | booted | every section is present from the start; the lab runs no boot order (their cause is a static reading, I) | follow-up 8 |
| Capture-path crashes: v0.24's getter during capture, lk6's WB read from the heap at S1, ft5 / ft7 / ft8, rc2b's broken file, grain with RAW+JPEG | reboot, hang, a file with EXIF and thumbnail only | not reached ("the emulator cannot capture") | TAKE, development and encode are stood in (S-RELSEQ, S-EXPOSE, S-EXIFPRM, S-JPEGENC) | the photo code: closed, the per-shot EXIF fill runs (4.1); the still set-up (`.hook_su`): runs at S2 since 2026-11-14, what it builds not checked (4.1, follow-up 1); development: follow-up 9 |
| `fb`-prefixed `movbu (d8,An),Am` (gt1) | misread | "worked" | om-emu faults on `fb` with nn = 2 (`src/core/cpu.mjs`, D); the instruction sat in the capture path the lab never ran (I) | nothing in the CPU |
| lk7 / lk9: block code in the uncached heap on the COLOR switch | 1 s hang, restart | fine | no fetch cost, watchdog or stack-depth model | not taken (4.4) |
| The colour wheel's plane | drawn | `PLANC_UNOBSERVED`, on stock too | the OpenVG / K3000 stack on CPU 1 is dormant (`docs/hle-gaps.md` 4.12) | follow-up 10 |
| Their guide pictures (Test 11) | drawn | `BMP_TOKEN`, not drawn | the OSD engine refused every run across a row end; stock has none (X, 4.1) | closed: format 0x0B's runs go on in the next row (A-BMPWRAP, 4.1) |
| v0.27's sporadic start-up hang with the dial moved while off | hang | not shown | one deterministic schedule; no dial position | the position: closed, the dial is an input a power cycle keeps (4.1); the race is not taken |
| Stills-mode arrow keys and the front dial (`research/BUTTONS.md`) | differ | other setting ids read | until 2026-11-13 the lab's movie mode on E147: its still / movie switch started at a movie position, and the button-function lookup then takes its movie column (`docs/hle-gaps.md` 4.1.13, D) | the arrows and the front dial: closed, at the stills position the arrows read setting ids 50..53 and the dials work, agreeing with their camera results (X, 2026-11-14, 4.1; the camera's side their report); OK on their custom Picture Mode row (their test 12) and the ISO and Fn keys still differ (section 6) |

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

The third round (base `a68dca3`, 2026-11-14) adds:

- **Their driver's other tools** in `bin/session.mjs` (`emu/README.md` "Scripted sessions", 4.3): `trace:PC:stack=N` (N
  words from `sp` up at each hit, 1 to 256), `dump:ADDR:LEN:FILE` (up to 64 MiB, the ranges the boot does not load named
  with S-STALERAM's fill), `--a15 auto|off|on` and `--device tft|evf`, a `break:` at a pc a lab hook holds (the stop
  comes before the hook answers), and `call:` at a breakpoint's stop (the CPU's whole context and the harness stack put
  back; a lab hook other than memset, memcpy and `prop_get` ends the call as `CallHooked`; refused at a watchpoint's
  stop). A step whose OSD picture the engine refused now fails on E143, E146 and E147 (`--osd-errors report` only lists
  it): no stock flow measured there has one (X: flows on E143, E146 and E147, `emu/README.md` "Scripted sessions"); on
  the other bodies, where stock sessions meet such refusals, `report` stays the default; the tools are checked by
  `emu/test/test_tools.mjs`.
- **Waits in the idle player's slices.** The camera application's stand-ins (the DISPLAY and module replies, the timed
  callbacks) deliver at the end of each Player input, so a session's single long `WAIT` held back what the firmware did
  after a reply until the wait ended, and a result could depend on how a script split its waits. Every wait of a step
  now goes as inputs of at most 50 ms toward the wait's end, as the interactive player's idle runs (`host/session.mjs`
  WAIT_SLICE_MS; X: `wait:2000` and `wait:1500 wait:500` end on the same screen, and a wait ends within one input's
  overrun of its lab time, where fixed 50 ms slices first added the overruns up: E143's `wait:1500` 1634.8 ms then,
  1534.8 ms now). The 2026-11-13 runs of this note used one-input waits; the recipe and every release's pins pass on the
  sliced waits (4.2).
- **The still / movie switch** (`still_movie`, the page's key U, `switch:still_movie=K` with K 0..2; `docs/hle-gaps.md`
  4.1.13): positions 0 and 1 give the application's movie mode (setting 44 = 1) once moved, 2 the stills mode
  sessions start in; a power cycle on the kept state carries it (X, `emu/test/test_smswitch.mjs`).
- **A power-on without a card** (`--no-card`, the tokens `card:out` and `card:in`, `:2` for the second slot): the
  boot mounts nothing and the shooting screen shows "No Card"; a restart keeps the slot as the last session left it.
  S-MEDIA and S-CARD write the first slot's media word as the firmware does (2.3), so v0.29.1's films with no card need
  no poke (4.2; `docs/hle-gaps.md` 4.8.3, `emu/test/test_nocard.mjs`).
- **The boot-stage bits** (S-BOOTSTAGE, `emu/FIDELITY-NOTES.md` 7.19): bits 0 to 6, the sections whose static
  constructors the lab runs or which have none (2.2). Their v0.26.2 / v0.27 worker still waits, for bits 7 and 9.
- **The camera's pipeline constructor for a still** (`docs/hle-gaps.md` 4.3.12): S-RECREQ's packet carries the
  requester's still Command 16 and S-EXIFPRM writes the picture mode as TAKE's fill does, so on E147 at COLOR, MONO and
  ART the image library's create takes the constructor `0x504966f7` and the second step's stub `0x50496710`, after
  CreateParam's extension allocates its two buffers through MM natively. The 2026-11-13 hang at that allocation was
  the lab's: with Command 0 the buffer's size was 0, and MM's retry loop never ends for that request. On v0.29 at
  COLOR their `.hook_su` runs once per S2 and calls the stock set-up `0x504987bb` once, and the picture carries the
  film's ImageDescription (X, `emu/test/test_stillsetup.mjs --caduceus`). What their set-up code builds is not checked.
- **TAKE's exposure in the shot's record** (S-EXIFPRM, `docs/hle-gaps.md` 4.3.13): StlRdy1's exposure-record fill run
  natively on the settings the exposure plan publishes, TAKE_EXPOSE's shutter range and takepic's copy into the block,
  so the picture's ExposureTime is the session's plan (4.2's: 1/200 s, X). On E146 and E147 the plan then existed only
  once S1 had left the start screen; since the fourth round it exists from the start (below).
- **Their look hooks on their outputs** (`emu/test/test_lookhooks.mjs`; 4.6): hue and lightness, Blacks and Whites
  and split toning checked on the records, LUT and tables the stages write.

The fourth round (base `b36e3e5`, 2026-11-14) adds:

- **A built `.BIN` as `--main`** (`emu/README.md` "Patch overlays"): the container whose head names E147 at 1.1 is
  walked, its main code block descrambled and taken as a bare block is; its other blocks are not read and its
  checksum is not checked, which the summary's `not_applied` says, so a run checks the main block's changes, not the
  file the updater takes. What a file is (stock, another version, modified, unknown, with a reason) comes from
  `src/fw/identify.mjs`, by the head's model field and the digest, never a length.
- **A patch's own cache flush** (H-PATCHFLUSH, `emu/FIDELITY-NOTES.md` 7.16): a call of the kernel's flush whose calling
  instruction and return address lie on patched bytes is answered as the stock callers the lab lists are; a stock routine the patch calls
  that flushes on its own stays refused. Their halation pass needed it (4.6).
- **The OM-3's display switch and TFT start** (H-CHAINREST, `docs/hle-gaps.md` 4.4.4): the switch failed the lab's
  re-entry check in either direction, and a TFT start published no frame before the first wait. Both were the lab's:
  the touch task did not run, and a settle ended inside the touch driver's 1 ms sleeps. With the touch task running
  and lab time run on through those sleeps, `eye`, `lv` and `switch:eye=V` switch both ways and a `shot:` right after
  the open has a frame (X, `emu/test/test_dispswitch.mjs`); a shot straight after the start has the exposure plan
  (1/200 s).
- **The picture's shot in TAKE's table** (H-SHOTALLOC, `docs/hle-gaps.md` 4.3.13): api_rec's allocation and free run
  natively around each picture, as the application's take buffer does; the EXIF parameters are that shot's record,
  and ImageParam's sources find its buffers, which hold no sensor image.
- **The stock stage builders** (`emu/test/test_stages.mjs`, A-STAGEJOB, `docs/hle-gaps.md` 4.3.12): the stages their
  hooks sit in (the COLOR stage and its HSL builder, the LUT builder, the tone step, the gamma stage, the YC packing,
  the grain builder, the register writer) called standalone on stock E147 (and E122, E143) with outputs and read sets
  pinned. Without `OM_CADUCEUS`, this is the stock side a hook's output is compared with (4.6).
- **Their Grain route and halation pass by calls**, and their still set-up code traced at S2
  (`emu/test/test_lookcode.mjs`, `emu/test/test_stillsetup.mjs --caduceus`; 4.6).

### 4.2 Verifying a caduceus build

From om-emu's root, with `R` a release folder of theirs (or a build's folder) and `W` a work folder:

```sh
node emu/bin/card.mjs new $W/card.omsd --model E147                     # a blank card E147's firmware formats
node emu/bin/card.mjs put $W/card.omsd $R/LOOKS.BIN OM3MOD/LOOKS.BIN
node emu/bin/session.mjs --model E147 --patch $R/patch.json --card $W/card.omsd \
  --nvram $W/nv.json --out $W/run --script $W/flow.txt; echo "exit $?"
```

`--main $W/main.bin` takes a local build's block in place of `--patch`, and `--main` a built `.BIN` too (its main code
block alone, 4.1). `$W/flow.txt`:

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

On v0.29 (X, 2026-11-13, again on `d38ceff` and on `ea57fac` on 2026-11-14) this exits 0 with `session.mjs: passed; 26
step(s) on E147, patched; no poke`, and no step's record has `osd_errors` (an OSD picture the engine refused, which
fails the step; 4.1). `film1.png` is the Picture Mode page with FILM 1 "Portra 400" highlighted, and the JPEG's
ImageDescription is `FILM 1 Portra 400` (on `ea57fac` its ExposureTime 1/200 s, the session's exposure plan). The
start lines name the patched build (158 patches, 321,613 bytes changed, `frames` and `card_files` not applied) and give
the audit's loaded ranges: `patch audit: no patched byte where the boot does not load or is not shown to load`. The
`power:off` saves the camera's state to `nv.json`; a `restart` after it powers on again on that state with the dials
and the still / movie switch where they were, and a `restart` without it is a battery pull.

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
blank card), S1, S2 and the title again: the film kept; for v0.29-beta, v0.29 and v0.29.1 the no-card part below. Frames
are not pinned. Measured (X, 2026-11-13, on `d38ceff`): all 19 folders from v0.16 to v0.29.1 as pinned, 24 to 35 s
each, 3 min 20 s with three at once; again on `ea57fac` (2026-11-14, the waits sliced), 35 to 50 s each, 6 min 31 s
with two at once on a machine other jobs loaded. That round moved two pins: the no-card part of the three releases
(below), and the notes of v0.26.2 and v0.27, whose outcome did not change. The pins' controls are
in the test: v0.29 with section 6's end word put back to stock stops at the open naming section 6 (651 ranges in the
audit's `unloaded`), and a pin with one digest character changed fails; with S-SECLOADED left out of the lab the flows
of v0.16, v0.25, v0.29 and v0.29.1 fail (X, by hand). What it cannot show, pinned as such: v0.16 to v0.22 keep their
looks on the colour wheel's page, whose plane the lab does not compose; v0.26.2's and v0.27's load at power-on never
runs, as their worker (H-PATCHTASK) waits for boot-stage bits `0x2e9` at `0xa32de58c`, of which S-BOOTSTAGE sets the
bits of sections 1 to 7 and not bits 7 and 9, which follow section 8's step on CPU 1 (2.2; D, their source; X: the
state word is still 0 after 4.5 s), so the half press loads the films.

**Below the pixels, per release** (4.6; each reads `$C/releases/$OM_CADUCEUS_RELEASE`, `v0.29` by default, and runs
about 20 to 30 s):

```sh
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_looks.mjs --session        # a film's values (settings, reads)
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_lookhooks.mjs --session    # three hooks on their outputs
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_lookcode.mjs --session     # Grain's route and halation, by calls
OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_stillsetup.mjs --caduceus  # their set-up code at S2
```

The calls of `test_lookcode` leave their code's own state bytes pointing into a scratch the call gave back (4.6), so
a session that makes such calls takes no shot after them.

**v0.29.1's films with no card** (their #38, camera-tested). Their gate loads the films from the card only where the SD
medium word `0x60369308` is OK (D). The flow takes the card out while the camera runs (`card:out`) and later powers on
with the slot still empty (`power:off`, `restart`); S-MEDIA and S-CARD leave the word NOT_PRESENT (`01100000`) both
times (2.3). v0.29 and v0.29-beta then load nothing at S1 (state word 0, the page's title `Color Profile 1`), and
v0.29.1 loads the films from the camera's memory both times (the title `Portra 160`, the film kept from the first
session), as their camera test reports (X, the regression run on `ea57fac`, no poke). Until 2026-11-14 the lab kept
OK in that word after a removal and could not start without a card, so this check needed a poke of the word.

**A film picked without a half press** (X on v0.29 and v0.29.1, 2026-11-14; a finding for their firmware, I for the
camera). Pick FILM 2 and power off without a half press (`wait:1500 s1 wait:1200 ok ok right right right right right
ok menu power:off`), then power on with a blank card: their block's selection bytes `0x6295a768` read `00000000`, and
after S1 the page's title is `Color Profile 1` (COLOR 1 with the film's settings), not `Portra 160`. With `s1
wait:1200` after the pick their editor saves the block at that half press (`02000000`) and the film comes back. The
camera's own settings hold the film's values; their selection is restored only when the power-on's Picture Mode set
(setting 897 from 901, through their set hook into `fl_set`) arrives after the half press's load publishes their state,
and in the lab it arrives about 1.16 s after power-on, before any half press (X, a trace of their set and of their
state word's writes). Before the waits were sliced (4.1) the same order could pass or fail depending on how the script
split its waits; that was the lab's defect, not theirs.

### 4.3 Their driver's features in the session tool

Their main driver (`tools/emulator/session_ed1.mjs`, D) against `bin/session.mjs`:

| Their driver | `bin/session.mjs` |
|---|---|
| a whole `main.bin` as the image | `--main FILE`, through the overlay, the audit and the loaded-ranges mode (`--loaded off` is their whole-block load) |
| the card file; a saved copy | `--card FILE`, written back in place (copy it first); `card-get` / `--card-get` take files off |
| the settings file | `--nvram FILE` (off, a blank camera, by default) |
| key clicks and holds, the dials, waits; 1200 ms after each token | `KEY` (down, 150 ms, up, then the settle), `hold:KEY[:MS]`, `wait:MS`, every wait sent in 50 ms slices (4.1); `--settle 1200` for presses and switches. `main_dial:+N` / `sub_dial:-N` turn the dials N detents (X: `emu/test/test_session.mjs` turns both in a session and each changes the frame; on `d38ceff` and before, the token sent the control's id where the player takes `main` or `sub`, and a session refused it; fixed in the second round's final pass) |
| the GUI state and their state word after each step | each record's `gui`; `read:ADDR:LEN`, `expect:mem` |
| their editor's fields at an address read from memory | the module API: `s.step('read:...')` returns the bytes and the client computes the next address |
| shots | `shot:FILE.png`, the last published frame (`/api/frame`'s pixels), not their own composite |
| the mask and media-word writes | not needed; a `write:` is still taken and reported as a poke |
| power-off | `power:off`; `restart` then powers on again on the kept state |
| card injection; the card out | `restart:card=FILE`; `card:out` and `card:in` while the camera runs, `--no-card` for a start with the slot empty (4.1) |
| the still / movie switch, eye and mode | `switch:still_movie=K`, `switch:mode_dial=K`, `eye`, `switch:eye=0\|1` |
| calls of whole functions (getters, setters, malloc) | `call:FN:d0=..`, every register returned; the lab's hooks answer as for its own calls, where their stepping ran past them |
| calls from a spec with memory, sp or pc and stop pcs (`ncall`, `tonecall`) | `call:FN:entry=PC,stop=PC,frame=MASK/SIZE`, or `call:@FILE` with the op's whole request (memory, reads, scratch, restore); `sp` and `mdr` are the frame the harness's CALL builds, a larger frame for code that moved `sp` before the entry (their two drivers give their values so, 4.1) |
| exec-trace watches (`WATCH`, `WSTACK`, ...) | `trace:PC`, `trace:mem:ADDR:LEN[:r\|w\|rw]`: each step's hits with the 16 registers and counts; `break:` with `read:` and the other tokens at the stop, then `resume`; `trace:PC:stack=N` is `WSTACK`, the N words from `sp` up at every hit |
| a dump of RAM (`0x60000000..0x63000000`, `0xa2000000..0xa6000000`) | `dump:ADDR:LEN:FILE`, at most 64 MiB a token, so one token per range here; ranges the boot does not load are named in the record with S-STALERAM's fill |
| the player's `a15` and EVF options (`a15: 'on'`, the TFT) | `--a15 auto\|off\|on`, `--device tft\|evf`; `eye`, `lv` and `switch:eye=V` switch the display live, both ways on E147 since the fourth round (4.1) |

### 4.4 What the lab cannot verify today

- **Looks on pixels.** Their looks act as data handed to the development (settings, parameter records, LUTs and
  tables) and, for halation and the CPU grain, as code on the developed image (4.6). The S2 picture is S-SCENE's frame
  encoded by S-JPEGENC, so no film changes it. What the lab checks today is a film's values where the camera takes
  them (its settings and the hooked capture reads) and, by calls, what their hue and lightness, Blacks and Whites and
  split-toning hooks write (4.6). Below the EXIF fill, where their reboots and hangs happened, the lab runs natively
  rec_ImgPro_CreateParam and its helpers (`.hook_fx` among them), the image library's create with the constructor the
  picture mode selects and its second step (on E147 at COLOR, MONO and ART the stub `0x50496710`, where their
  `.hook_su` runs, X at COLOR),
  ImageParam's body and the release, on a shot TAKE's own table holds (H-SHOTALLOC); the parameter set, the run, its
  stages and kinds do not run (S-JPEGENC), nor do TAKE's shot-record fill and takepic, of which S-EXIFPRM stands in for
  the exposure copy (`docs/hle-gaps.md` 4.3.12, 4.3.13; X, pinned per body in `emu/test/test_storage.mjs`). The stages
  their hooks sit in are reached only by calls, on a job the test writes (4.6).
- **A film with Grain at S2**: their work-list hook asks the stock texture builder, whose build is a request to the
  pipeline unit, and the lab has no model of the page it writes: the session stops there (4.6, X). So such a film is
  checked by calls, not by a shot.
- **The bus window inside a call**: a buffer that the window maps (where the camera keeps its images) is not reached
  by a call: the mapper's own flush, the window's second register and its cached view stop it (4.6), so `hl_run` is
  checked on a buffer in main DRAM only.
- **The colour wheel's plane**: the GPU plane is not composed (`PLANC_UNOBSERVED`, stock too), so on the wheel's pages
  the published frame stays the one before them and `shot:` cannot show the wheel or its guides (X).
- **The boot order** of sections against the tasks that call into them (FIDELITY 7.18).
- **Timing, the watchdog and the cache**: no fetch cost, no cache or watchdog model (their lk7 / lk9 hang). The
  kernel's flush is answered at once, for a patch's own call too (H-PATCHFLUSH), so a patch that leaves out a flush
  the camera needs runs in the lab as if it had one.
- **Component 2's frames**: the lab loads only the main and resource blocks, and `om3-patch-2`'s `frames` are
  reported as not applied.
- **The EXIF FNumber and ISO**: `0/10` and 25 are not filled in the lab. Their sources are read: FNumber from TAKE's
  lens fill and the lens step, ISO from setting 50522 handed back by the strobe sequence; both need TAKE's fills run
  natively in order and the strobe sequence's init (`docs/hle-gaps.md` 4.3.13). ExposureTime is the session's exposure
  plan (X, 4.2).
- **Picture runs across a row end in formats other than 0x0B**, and a run past a picture's last row: the OSD engine
  refuses them (`BMP_TOKEN`, in the step's `osd_errors`, which fails the step); A-BMPWRAP covers format 0x0B only, the
  one their pictures use.
- **The second slot's media word** where no media manager runs (camapp 1): S-MEDIA and S-CARD write the first slot's
  only (`docs/hle-gaps.md` 4.8.3). The OM-3 has one slot.
- **Their power-on film load (v0.26.2, v0.27)**: its worker waits for boot-stage bits 7 and 9, which need CPU 1 to run
  section 8's constructors (2.2, 4.2); the half press loads the films instead.
- **Some of E147's keys**: OK on their custom Picture Mode row, which the camera takes as another event than the lab
  (their test 12; section 6), the ISO key and the other Fn-type keys (not wired on E147), and what tells the still /
  movie switch's two movie positions apart (`docs/hle-gaps.md` 4.1.13).
- **A call at a debug stop** reaching a lab hook other than memset, memcpy and `prop_get` ends as `CallHooked`, and a
  call at a watchpoint's stop is refused (`emu/README.md` "The debug API"). A stop is a main-loop visit an untraced run
  need not make, so the interrupt taken after it may differ; logging traces and a break at a hooked pc do not change the
  run (X).
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
| Hue and Lightness per colour (+0..+23) | `jmp hl_pp` at `0x504f75f5`, the COLOR stage's (`0x504f7553`) call of the HSL builder `0x504f7361`; it rewrites hue (+18) and lightness (+22) of the builder's 12 output records (24 bytes each from the output's +836) through a table of theirs | data: the stage's parameter records | no; checked on its outputs by a call (below) |
| Blacks, Whites (+39, +40) | `call tone` at `0x504f87b7` in the stage list, in place of `call 0x504f7f84`: the job's 256-entry 10-bit luminance LUT copied to its +3832 and remapped (a toe and a shoulder) | data: a LUT | no (I, below); checked on its outputs by a call (below) |
| Split toning, Tone Balance (+53..+56, +58) | `st_run`, the tone hook's exit: the job's R, G and B gamma tables (+1252, +1892, +2532; 256 + 64 entries, 12-bit) bent in place | data: tables | no (I, below); checked on its outputs by a call (below) |
| WB shift A-B, G-M (+36..+38) | `wb_get` at the 21 call sites of the capture-safe getter `0x50042360` with the WB fine-tune keys (34041, 38521 and the Auto WB ones): 14 in the EXIF set's body `0x50435773..0x50436ffd`, `0x50442192` / `0x504421a5`, `0x504666a3` / `0x504666b8` and three at `0x518c5610..0x518c563c`; the camera's value plus the shift, clamped to -7..7 | data: a setting's value | the EXIF set's: yes, twice at S2 (the A-B and G-M reads it stores at the shot's +37734 and +37736, D); the others: no |
| Sharp, NR, VigFix (+52, +49, +50) | `s_nr` -> `xb_nr` at `0x503c665f` (Sharpness, key 33049), `0x503a7018` and `0x503c6871` (Noise Filter, 38681) and seven Shading Comp. reads (`0x8c21`) | data: a setting's value | the EXIF set's Shading Comp. read (`0x50436e63`): once at S2; the others: no |
| Grain (+51) | the camera route: Grainy Film's texture and combiner 1's gains on a COLOR job, at `0x50496710` (still set-up), `0x50497d71` (work list), `0x504745d1` (request configuration), `0x504e3b3d` and `0x504e43ac` (combiner set-up); the CPU route (`xb_gs`, a luma pass row by row) with Glow or an Art Effect | data; the CPU route code on pixels | a film without Grain: the work-list site and the still set-up's (`.hook_su`) once per S2 at COLOR, no texture asked for (X, `emu/test/test_stillsetup.mjs`); a film with Grain: the work-list hook asks the stock texture builder, whose build stops the session at the pipeline unit (X, below); the request configuration: once, for the texture's own build request, and the combiner set-up: no; the camera route checked at its sites by calls, down to the texture's gain (below); the CPU route: no |
| Glow / Clarity (+47), Halation (+57) | `jmp s_cap` at `0x50534e30` in the Art Effect converter `0x50534e27` (Soft Focus job flags), `s_wt` at `0x504e38a1` (the blend weight); halation: `hl_run`, a CPU pass on the YCbCr image after the Soft Focus blend | data, then the pipeline unit's passes; halation code on pixels | the converter: once at S2, and their code took its stock exit before reading the film (which of its two tests sent it there is not read, ?); the weight and `hl_run`: no; `hl_run` checked on pixels by a call (below) |
| White frames (Art Effect Frame) | job flag `0x8000` and the frame layers of container component 2 | data | no: the Art Effect reads 0 in v0.29 (`XB_ART 0`, D) and the lab does not load component 2 |
| Live view | `s_lv` at `0x5044a89b` (the live view's development request) | data | no: the live view is S-SCENE's |

The film WB mode (+59..+62, v0.28) is not traced here. The last column is X where not tagged: log watchpoints on reads
of their state word `0x62b4dd16`, their heap block and their code block, during S1 and then S2 after FILM 1 was picked;
every hook above reads the state word at its entry or right after its stock call (`hl_pp`, `wb_get` after its picture
mode tests, `xp` for the stubs), and each hit's pc names its function by the build's symbols. At S1 no look code ran
(their editor's save, film list and photo code did). At S2: `wb_get` twice (the slot's WB-on, A-B and G-M bytes read),
`xb_nr` once (the VigFix byte), the converter's stub once and their photo code once; nothing else. So the only look code
the lab ran then was in the EXIF set (metadata) and in the converter, which a static call scan reaches from
rec_jpeg_make_image (`0x50536e37`) through `0x5052e69f` (D). Since 2026-11-14 the still set-up's hook runs too (X at
COLOR; MONO and ART take the same stub on stock, X, so I for their hook there; 4.1). `tone` and `st_run` read the job
before the state word, so their absence is I: no chain of direct calls reaches the stage list from rec_jpeg_make_image
(the same scan; its callers' chains end in indirect calls, D), and the stages sit in the image library's run, which
S-JPEGENC stands in (`emu/src/lab/rec.mjs`).

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
reads with the film's values. It does not show what the development does with them.

**The hooks on their outputs (X, 2026-11-14).** `emu/test/test_lookhooks.mjs` (with `OM_CADUCEUS`; about 30 s)
checks hue and lightness (`hl_pp`), Blacks and Whites (`tone`) and split toning with Tone Balance (`st_run`) on what
they write, without pixels. The job layout is read from the stages (`docs/hle-gaps.md` 4.3.12, D) and agrees with
their notes: C+4 the request R, C+12 the output O, C+48 the gamma stage's key, C+60 the LUT builder's flags. The test
writes a minimal still job into a call's scratch: R's key 11 (COLOR), R+14 `0x1000`, an image size at R+1660 (their
stage test's; the gamma stage divides by it) and C+60 = `0x4134063e`, the LUT builder's test mask (their `tonecall`'s;
which bits the camera sets is ?). It runs, through `host/session.mjs` `input()` only:

- the COLOR stage `0x504f7553` from its entry, stopped where `hl_pp` jumps back (`0x504f75fa`). The 12 records are
  compared with the HSL builder `0x504f7361` called alone, with the registers the stage hands it;
- the RGB gamma stage `0x504f5ab9` alone, whose three equal tables are st_run's input;
- the stage list `0x504f8694`, entered at the LUT builder's call `0x504f87b0` with those tables in the job. It is
  stopped before the tone call `0x504f87b7` (the stock LUT) and at the stock tone step `0x504f7f84`, where `st_run`
  jumps on.

It does this on the blank camera and after FILM 20, 1, 2 and 3 are picked in the Picture Mode list. FILM 20 is
COLOR 4's, so the slot index is exercised. The expectations come from the film's LOOKS.BIN record (pf_put's and
pf_bt's mapping into the slot). The formulas are their source's, read from `firmware/src/editor.s` at the release's
tag at run time: `hl_lut` (hue 7000 - 1000 i, a lightness table and the record order), the tone remap, and `st_run`
with `st_k`. So for tone and split toning the check is their code against their own definition: what a release
regression needs. On v0.29 and v0.29.1 all 69 checks pass.

The blank camera gives every stock output. Every film moves the records and the LUT. FILM 20 and FILM 3 move the
tables; FILM 1 and 2 (no split tone) leave them. FILM 1 (Portra 400, Blacks 1, Whites 0) gives these records'
(hue +18, lightness +22): 0/0, 0/25, 0/0, 1000/0, 1000/25, 1000/-25, -1000/0, 0/0, -1000/-25, -1000/0, -1000/0,
0/0. Its LUT runs from the default `0x6068cd08`'s 0, 64, 256, 512, 1023 (indexes 0, 16, 64, 128, 255) to 8, 72, 262,
516, 1023. FILM 3 (shadows colour 7 at code 1, highlights colour 0 at code 1) moves the curve's 3308 at index 128 to R
3306, G 3326, B 3212.

The test also checks the expectation with hue and lightness, Blacks and Whites, or the shadow and highlight colours
swapped: it must not match. Mutants of the test (X, by hand): those three swaps fail 4, 4 and 2 films; record r's
colour taken as r instead of their order fails all 4. A wrong look in a future release shows as a named record,
LUT index or channel entry with the lab's value and LOOKS.BIN's. A hook that is not reached shows as a stock output
where the film has values.

**The stock side (X, 2026-11-14).** `emu/test/test_stages.mjs` (no `OM_CADUCEUS`; `bin/test.mjs` runs it on E122,
E143 and E147) calls the same stages on stock E147 standalone, each builder on a job of its own, and pins their
outputs and every job byte each reads (`docs/hle-gaps.md` 4.3.12). The hook test's job is the same kind of
assumption, named there A-STAGEJOB (`emu/FIDELITY-NOTES.md` 8.2): the values are the stages' answers to that job, and
a camera's job may hold other bytes where both leave 0 (on E147, 37 of the 117 bytes the stage list reads while they
are 0 change an output when set, X).

Not checked there: halation, Grain and glow. Their data goes to the combiner and the Art Effect job, or acts as code on
pixels, not on a stage output read there. Grain's camera route and halation are checked by calls of their own (next);
glow (the Soft Focus job flags and the blend weight) is not checked.

**Grain's camera route and the halation pass, by calls (X, 2026-11-14).** No film of v0.29 or v0.29.1 sets Grain
(record +51) or Halation (+57): both are 0 in all 20 records of both releases (X). So a check driven by a shipped film
shows only "off", and the films used here are the release's with those bytes set by the test, a `LOOKS.BIN` their
format defines (the CRC recomputed), put on the card as any other.

*What their set-up code does at S2* (`emu/test/test_stillsetup.mjs --caduceus`, 15 checks on v0.29 and v0.29.1;
traces and one breakpoint through `host/session.mjs`; the same seen with `trace:`, `trace:mem:`, `break:` and `read:`
through `bin/session.mjs` on both releases, by hand). With the shipped FILM 3 (no Grain) the S2 press runs their
work-list hook's site `0x50497d71` once, the `.hook_su` site and the stock set-up `0x504987bb` once each, their set-up
entry (the code block's +112, the block's address read from their heap block) once, called from their stub after the
stock set-up returns, and the stock texture builder `0x504ac901` and attach `0x5049b0af` never. A watch on job+8324
over the press sees three accesses (by hand): a stock store of 0 (`0x50492868`, among the job's other fields), one
read by their code (0) and one by the stock clean-up `0x50498cb9` (at `0x50498cc1`). So **without Grain their set-up
code writes nothing into the job**; the one stock function it calls is the settings getter, for the effective COLOR
profile (D, their `xb_slot`). With FILM 3's Grain set to Med the press stops at a breakpoint on the builder: reached
from their code block, after the work-list site and before the set-up, with a0 the still's resource manager (the
word at S+10280) and the 6-byte key `00 10 00 01 00 00`, which is the block the stock set-up makes for Grainy Film at
`0x504989a6` (the still parameters' u16 at +40 and byte at +44, the stock helper `0x504967db`'s answer, the byte at
+55, 0; D on both sides; their code calls the helper itself, X); the job's key is 11 and job+8324 still 0. This
agrees with their `xblock.s` (`xb_wl`, `xb_tex`, `xb_su`): since their ft8b the texture is asked for when the work
list is built, and the set-up's entry only marks a texture made earlier. Two places of their `research/NOTES.md`
differ from it and from the stock code: the ft1 paragraph, which has the set-up make the texture, describes the
earlier build; and "Grainy Film's grain path" gives the builder a 7-byte block with the byte at (20,sp), which is the
block of the three other builders the set-up calls (at `0x5049883a`, `0x5049889c` and `0x50498916`), where the block
made at `0x504989a6` has 6 bytes and no such byte (D), as their `xb_tex` makes it. Let go, the builder does not come
back in the lab: nothing is cached, so it builds (`0x504ae099`, the place their notes leave open), and the build is a
kind-3 request with stage `0xf002` to the pipeline unit, which stops the session at the page that takes the stages'
output block (`om1.imgpipe UNKNOWN write 0x9c201014`, at `0x50482e5c`; `docs/hle-gaps.md` 4.3.12). So in the lab **a
film with Grain does not finish S2**, at any level (X, Low and Med), the test pins that as the lab's limit, and the
store of the texture at job+8324 is not reached.

*The route at its sites, by calls* (`emu/test/test_lookcode.mjs`, with `OM_CADUCEUS`; 68 checks on v0.29 and v0.29.1,
about 30 s). The job is written into each call's scratch from the stock code's reads (`docs/hle-gaps.md` 4.3.12, D):
the still's context S with its parameters' key 11 and flags `0x1000` (as the lab's COLOR still has them, X), the job
with key 11, the request R (key 11, output `0x1000`, kind 0, no effect) with its context C and register image,
and, where a film asked for one, a texture object of the test's (19 patterned words) at job+8324. Everything else in
the job is 0: these are the hooks on that job, not the camera's values. Five calls a film, on the blank camera and
after FILM 20, 1, 2, 3 and 4 are picked, FILM 1, 2 and 3 with Grain Low, Med and High:

- the work-list builder `0x50497cd7` entered at their hook, stopped where it jumps back (`0x50497d79`) or at the
  texture builder: without Grain the job's key 11 is kept and no texture asked for; with Grain the builder is reached
  with the job's resource manager and the key block above. The same site on a job that already holds a texture
  object: with Grain the list is picked by Grainy Film II's key `0x01020068` (the job's own key stays 11) and no
  texture is asked for again; without Grain the pick stays 11;
- their set-up entry (as their stub calls it), which takes the texture object as made, then the request
  configuration `0x504745cd` entered at its selector call `0x504745d1`, their hook: with Grain the answer is combiner
  1, the request's stage is `0x0100` and its +780 holds the object's 19 words (the stock attach `0x5049b0af`, run by
  their code); without it the stock selector's answer (0) and an untouched request;
- the combiner set-up `0x504e3b0b` whole. Without Grain its register image is the default case's, as on the blank
  camera (+4 `0x00200000`, +96 `0x04000400`, +100 1024, +148 `0x04000400`). With Grain it is combiner 1's (+4
  `0x00200001`, +8 3822, +152 0) with COLOR's chroma gains put back (+96 `0x04000400`, +100 1024) and the texture's
  gain at +148 and the Y offset in the low half of +180, each the film's Grain level's entry (Low, Med, High) of the
  two tables of their `xblock.s` (`xb_tgain`, `xb_tbias`, read at the release's tag at run time; their values are
  not copied here): three rising gains and three falling offsets.

Controls: the three levels give three rising gains and FILM 4, without Grain, the default image again; the stock
combiner 1, reached with Grainy Film II's key on a job of no film, has gain 1024 and chroma gains 1024 and 0, which no
level's image has; the four sites hold the release's instructions. Mutants (X, by hand): the gain taken from the
next level's entry fails all three films; the card's file without the Grain bytes fails the control; the second
work-list call made on a job without the texture fails the three films' list key; the still set-up test with the
film left as shipped fails 5 of 15, and with the first session's film given Grain it stops at the unit. What this
shows: a film's Grain reaches the register image's gain where their hooks sit, through the stock selector, attach
and set-up. What it does not show: the texture itself, the request the camera builds, or the pixels. The calls leave
their state bytes in the code block (the texture flag, the request and the context they remember) as the last call
set them, pointing into a scratch that is given back, so no shot is taken in that session. The stock grain (key 12's
requests with stage `0x0901` or `0x0902`: the level byte +1751, the gain tables behind combiners 31 and 32, the seed
at +188) is read in `docs/hle-gaps.md` 4.3.12 and not run here.

*Halation on pixels.* `hl_run` (`0x50f6d3fc` in v0.29 and v0.29.1, found at run time as the one call with its frame
in their code block) is called on YCbYCr 4:2:2 frames the test draws into the call's scratch, with a buffer record
of their layout (the bus address, the format `0x0c02`, the row pitch, width and height) and the level in d0. The
expectation is their pass's definition, `research/halation/model.py`'s steps written anew in the test with the
numbers of `firmware/halation.py` at the release's tag: their code against their own model. The lab's frame equals
it byte for byte on a frame with a bright spot at levels 1 and 5 (1984 x 64 pixels: 27,902 and 45,687 of 253,952 bytes
changed), with rows wider than the frame at level 3, on a frame of four cell rows with a spot in its corner at level
5 (448 x 256: 88,491 bytes changed, the glow fading from cell row to cell row), on a frame too bright (their coverage
rule leaves it alone) and a dark one (no glow), and levels 0 and 6 return at once. The same definition equals their
Python model on 40 frame and level pairs (X, by hand, their `model.py` under numpy). Controls: the frame is not the
definition's at another level; level 5 changes more than level 1; mutants (X, by hand): Cb's and Cr's tints swapped
in the expectation fail the four glowing frames, the call made at another level than the expectation fails its
frame, and the definition taking the nearer cell row instead of interpolating between two fails the frame of four
cell rows alone.

What the call needed, and what it does not reach (X unless tagged). The image sits in main DRAM (the scratch), which
their `hl_open` uses directly (bus `0xa0000000..0xb7ffffff`). The allocations work inside a call: the pass takes
three blocks (their source; its header comment still says two) from the firmware's allocator for the uncached pools
(`0x50003048`, freed by `0x5000307a`), which the lab does not stand in for (S-HEAP is the other allocator's,
`0x50002fc6`) and which runs as it is on the pools as the session left them; a call stopped at each shows the pass
reaches these two and never the other. The firmware's lock and unlock (`0x50054f53`, `0x50054f9c`) run as they are
too; in the lab the lock takes only its interrupt-mask half: its other half (the call of `0x50010501`; "no task
switch" in their source's words) runs when the word at `0x97f006fc` is `0x77777777` (D), and that word is 0 in the
lab. The pass begins with the firmware's cache flush, which the
lab answers at once for the stock callers it lists and refused for theirs; the lab now answers a flush called from
patched bytes too (H-PATCHFLUSH, `emu/FIDELITY-NOTES.md` 7.16: no stock caller's code is there, and the lab has no
caches), without which the call on the first frame ended at that flush, 766 instructions in.

The bus window does not work inside a call, in three places. (1) A buffer outside main DRAM and outside the window's
present segment, as the camera's image buffers are (their notes give a still's texture at bus `0x4dfd4400`), goes
through the firmware's window mapper `0x5004fff8`, which flushes the cache itself (return `0x50050030`), a stock
caller the lab does not list: the call is refused there, which the test keeps as a control. (2) With that flush
answered (a trial change, not kept), the mapper's next step reads the window's second register `0x9810004c` (at
`0x5005003e`), which the lab's window device does not have (it models `0x98100058` alone): a bus error. What that
register is has not been read (?), so the mapper's caller is not listed. (3) A buffer in the window's present
segment (`0xb8000000..0xbfffffff` after the boot) needs no mapper, but their pass reads its rows through the
window's cached view, `0x40000000` below the window (their source: `0x78000000..0x7fffffff`), which the lab does not
map: an access fault, the test's second control. So the pass's arithmetic and its direct branch are checked; the
window branch (the mapper, the window's cached view and the flush after each row) is not.

**What stands between the hook sites and the JPEG**, in the camera's order (I for the order):

1. **TAKE's shot** (S-RELSEQ, S-EXPOSE, S-TAKEFRAME): no take request and no RAW frame. Since 2026-11-14 the shot
   exists in TAKE's own table with its record and buffers (H-SHOTALLOC: api_rec's allocation and free natively, as the
   application's take buffer; X on E143, E146 and E147), ImageParam's four sources find its buffers, and TAKE's
   exposure record reaches the shot's record (S-EXIFPRM runs its fill natively; `docs/hle-gaps.md` 4.3.13). The
   buffers hold no sensor image. Next (4.3.13's revised plan, I for the sizes): TAKE's own fills natively on that shot
   and TAKE's context, in the still states' order (days: FNumber, the lens fields, the WB mode and key), the strobe
   sequence's init (Sv, so ISO), then a declared S-RAWFRAME for the Bayer and thumbnail buffers, as the lab has no
   sensor readout; TAKE_EXPOSE's still request and TAKE's still states with their neighbours stood in, 1-2 weeks.
2. **The white balance gains** (S-RECREQ in place of REC_PREPRO's step; REC_RAWNR's on E147): the shot record's four
   gains stay 0 and the library's parameter set divides by them (X, an E143 probe on H-SHOTALLOC's shot: fault 6 at
   `0x505099e0`); on the camera a computation over TAKE's shot fields gives them (`docs/hle-gaps.md` 4.3.4, D on E143).
   Each of its inputs is now read to its writer (4.3.13, D on E143): six settings TAKE's fills read, two that exist
   (the preset gains, the thumbnail's handle), the key and the frame count from the still states' own code, two from
   the strobe sequence's answer, eight fields no fill of TAKE's writes (their writers ?), and the thumbnail's pixels,
   the one input a capture gives. There is no shortcut, and no invented value is needed once TAKE's fills run in order
   (1), with S-RAWFRAME's thumbnail and the eight fields' writers read. Days after 1 (I). Whether the development's
   own WB reads (`0x50442192`, `0x504666a3`) belong to this step is not read (?).
3. **The image library's parameter set, the run and Jpeg_Result** (S-JPEGENC's three steps, on E147 as on E143 since
   2026-11-11, `emu/src/lab/rec.mjs`, D): the stage table, the work pool (a probe's allocator walk did not end on E143,
   `docs/hle-gaps.md` 4.3.4, X) and the development stages whose builders their hooks patch (I; the work-list hook is
   reached from rec_jpeg_make_image through `0x5049272b` in a static call scan, D, and did not run, X). Size: the
   library is about 275k instructions, 162k of them straight-line parameter packing (`docs/hle-gaps.md` 4.3, D); the
   set and the run's set-up natively up to the pipeline unit's request: weeks after 1 and 2 (I). With 1 to 3 every data
   hook in the table runs where the camera runs it, and its records, LUTs and tables can be checked against LOOKS.BIN
   on the camera's job, not only on the job the call test writes.
4. **The pipeline unit at `0x9c200000`**: one kind 0 request makes the developed image and the primary JPEG. Its
   protocol (the unit masks, the set-up, the go, the end's IRQ 288) is read and modelled for the play module's decode
   only (S-IMGPIPE, `docs/hle-gaps.md` 4.8.13; D and X on E143, whose board E147 shares). The development's pages are
   read as far as the writers that copy the stages' blocks to them (4.8.13 "The development's pages", D on E143 and
   E147: the stages' output O goes to the page `+0x1000` at its `+0x80`, the RGB gamma tables and the luminance LUT
   it points at to `+0xc800`), so a hook's records and tables can be followed to a page and an offset. The lab keeps
   no page for them: a development request's first write there is a bus error. Which unit-mask bits such a request
   sets and what the pages' words mean are not known (?), and the firmware gives no evidence of the pixel processing
   (`docs/hle-gaps.md` 4.3, D), so a model of it is a declared stand-in, and a data look checked on its pixels would
   check that stand-in, not the camera. Size: months (I). Grainy Film's texture, which their Grain route asks the
   stock builder for, is built on this unit too (a kind-3 request): a film with Grain stops the lab's S2 at that
   page's first write (X, above). (Corrected 2026-11-14: this said the unit's registers and interrupts were not
   read.)
5. **The JPEG codec at `0x99901000`**: driver and registers read (`docs/hle-gaps.md` 4.3.9, D on E143), fed by the
   unit, no buffer address of its own. Size: days after 4 (I).
6. **S-IMGPRO's other request kinds**: only kind 14's fills are computed; Jpeg_Result's kind 13 copy is not. Size: days
   (I).
7. **The CPU passes on pixels** (`hl_run`, `xb_gs`): they would run on the lab's CPU once a developed image is in
   memory after the Soft Focus blend, so they wait on 3 and 4 (I). Before that, `hl_run` called on a frame in a call's
   scratch gives their definition's frame byte for byte (X, above); a buffer where the camera keeps the image goes
   through the bus window, which a call does not get through (the mapper's own cache flush and second register, the
   window's cached view; above), and the CPU grain (`xb_gs`'s luma pass) is not tried.
8. **Container component 2** (the white frames' layers): not loaded (`frames` not applied, 4.1). Size: days (I); the
   blend itself is the unit's.

The E147 capture path at E143's level removes none of these: E143 stops at the same three steps of S-JPEGENC (3), and
E147's rec_jpeg_make_image already runs natively up to them (D, `emu/src/lab/rec.mjs`). Only running 1 to 3 natively
reaches a development stage's hook where the camera reaches it; the still set-up's hook runs before them (4.1).

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

The first round's question about the SD medium word at a removal is answered (2.3, D, with the second slot's word
observed under the firmware's own manager, X); the question about stills-mode keys is answered for the arrows and the
front dial (section 3's table).

- Which of the Art Effect converter stub's two tests sent their code to its stock exit at S2: the capture's Art Effect
  byte or the parameters' key (4.6, ?).
- What the boot stage before the main block's loads: whether it covers the ranges the lab treats as not shown loaded
  (E147 `0x60129000..0x60134000` and `0x603a2bd4..0x603a3804`, 2.1). A camera probe of those ranges in the way of their
  GX probes would settle it. Who reads the end the head stores to `0x629607a0` is not read either (?).
- What the camera's unloaded RAM holds at power-on (their gap sums vary between runs), so which poison the lab's
  loaded-ranges mode should use is a model choice, not a fact.
- When the tasks that call into sections 9 and 10 run relative to their copies, the order behind their v0.20-t1 boot
  loop. The copies' own order is read: sections 1 to 8 at once, section 9 after stage 7's bit, section 10 after stage
  8's, which CPU 1 sets (D, `docs/hle-gaps.md` 4.6.4).
- What the per-section step's region set-up in the block `0x99700000` does (`docs/hle-gaps.md` 4.6.4; the string
  "[DbgSup-" follows its pointer table, D). The lab has no device there and does not do it (?).
- Why the camera sends their custom Picture Mode row's OK as another event than the lab's (their test 12), and the
  ISO and other Fn-type keys, which are not wired on E147 in the lab. Their test 12 and 13 builds are not in
  `releases/`, so neither was re-run as built.
- What tells the still / movie switch's positions 0 and 1 apart (setting 2188, `MODE_ACTION_DIAL`, is written 2 at 0
  and 1 at 1, X; its reader is not read; their notes call 0 S&Q, 8.3), and whether the camera's start sets setting 44
  from the switch, which the lab's does not (`docs/hle-gaps.md` 4.1.13).
- Whether the camera, too, brings a film picked without a later half press back as `Color Profile k` after a power
  cycle (4.2; the lab's order, I for the camera).
- Which bits of the stage list's flags (the job's +60) the camera sets on a still, and what its request holds where
  the tests' jobs leave 0; the hook test takes their `tonecall`'s mask, the stage test all ones (4.6, ?). One
  development job dumped from a camera would answer both (`docs/hle-gaps.md` section 8).
- What the bus window's second register `0x9810004c` is, which E147's window mapper reads after its flush, and how the
  window's cached view (`0x78000000..0x7fffffff` by their source) maps (4.6, `docs/om1-vsc-spec.md`); both stand
  between a call and `hl_run`'s window branch.
- Who sets the stages `0x0901` and `0x0902` and the level byte +1751 on a key-12 request (the stock grain's combiners 31
  and 32, `docs/hle-gaps.md` 4.3.12), and what the texture's build `0x504ae099` writes on the pipeline unit's pages.
- Why the firmware's `fopen` found `DEBUG.TXT` but not `DEBUG.ON` in the lab (their notebook; not tried on a camera).
- Whether E143's SD updater accepts a modified main block as E147's does.

## 7. Follow-ups, ranked

Done: the first round's 1 (a regression run of each release), 2 (row-crossing OSD runs) and 4 (mid-function calls and
exec traces in scripted sessions) in the second round (4.1, 4.2); the second round's 1 (the session's dial tokens), 2
(E147's stills-mode keys: re-run, the arrows and dials agree), 3 (hue and lightness, Blacks and Whites and split toning
on their outputs), 4 (a power-on without a card), 5 (E147's still at COLOR, MONO and ART: the cause was S-RECREQ's
Command 0, not MM) and 6 (the boot-stage bits, as far as the lab runs the steps) in the third (4.1, 4.6); the third
round's 1 (their still set-up code traced at S2: without Grain it writes nothing into the job, with Grain the
texture's build stops at the pipeline unit), 2 (the shot's buffers as TAKE's, H-SHOTALLOC), 4 (E147's display switch:
the lab's, fixed; E143's own failure right after S2's rec view stays open, `docs/ROADMAP.md` "Debug API follow-ups" 7)
and 6 (halation by a call, on a buffer in main DRAM) in the fourth (4.1, 4.6). What they left is below.

1. **TAKE's fills natively on the allocated shot** (`docs/hle-gaps.md` 4.3.13's 1b and 1c): the mode bytes, StlRdy1's
   exposure request, the shot-record fill (with E147's settings 63153 at COLOR and 63281 at MONO), the key, takepic,
   the lens fill and the third fill, in the still states' order on TAKE's own context, in place of S-EXIFPRM's copies;
   then the strobe sequence's init. Size: days each (I; read on E143, E146's and E147's Rdy builder and lens fill not
   yet). Payoff: FNumber, ISO and the lens fields in their pictures' EXIF, and the white balance's inputs (4.6 list 1
   and 2).
2. **A camera's development job** (`docs/hle-gaps.md` section 8): one COLOR shot and one other mode dumped at the
   stage wrapper by a patched build. Their project builds such patches and runs them on an OM-3. Size: minutes to ask,
   a day to digest; it depends on a third party, and nothing has been asked. Payoff: the hook and stage checks on a
   camera's job instead of the tests' (4.6).
3. **E147's remaining key differences**: OK on their custom Picture Mode row, the ISO and Fn-type keys (not in board
   0's tables), the Fn lever and setting 534, and the still / movie switch's two movie positions (6). Size: days (I).
   Payoff: the Button Function paths users run.
4. **The second slot's media word** where no media manager runs: a rule for the setter's second-slot store, then
   S-MEDIA and S-CARD writing it (`docs/hle-gaps.md` 4.8.3). Size: a few days (I). Payoff: E143 and E146 only; the
   OM-3 has one slot.
5. **The bus window inside a call**, for `hl_run`'s window branch: what the register `0x9810004c` is, the mapper's
   flush listed once its caller is read, and the window's cached view (6). Size: days to a week, if the register's
   role can be read (I). Payoff: low until a film sets halation.
6. **CPU 1 for section 8's constructors**: the six constructors and the step that sets stage 8's bit, run on a CPU 1
   of the lab's (`docs/hle-gaps.md` 4.6, 4.6.4), not by setting the bits. Size: weeks (I: the lab runs no CPU 1).
   Payoff: v0.26.2's and v0.27's power-on load; S-STAGE9 and S-SECLOADED's bits 8 and 9 in the camera's order.
7. **The boot order of sections** on E147: copy sections as the loader does, at its point in the boot, so code that
   calls a later section early faults; sections 9 and 10 absent until stages 7 and 8 (2.2, `docs/hle-gaps.md` 4.6.4,
   FIDELITY 7.18). Size: weeks (it is CPU 2's boot job, and section 10's copy waits on 7). Payoff: the v0.20-t1 class of
   boot loop.
8. **The still capture through development** to a recording image processor, compared with their camera logs. Size:
   months. Payoff: the largest: their looks on the camera's job, grain and halation, and every capture-path crash in
   section 3. It splits (4.6, `docs/hle-gaps.md` 4.3.13's revised plan): TAKE's fills (1 above), S-RAWFRAME,
   TAKE_EXPOSE's still request and TAKE's still states (1-2 weeks), the white balance gains (days after them) and the
   image library's parameter set and run natively up to the pipeline unit's request (weeks), which runs every data hook
   on the camera's job; then a model of the pipeline unit, which the firmware gives no evidence for and which would be a
   declared stand-in (months).
9. **The K3000 wheel plane** (`docs/hle-gaps.md` 4.12). Size: weeks. Payoff: the OM-3's colour wheel, theirs and
   stock.

Leads for upstream, not sent (nothing has been posted to them): two places of their `research/NOTES.md`
differ from their source and from the stock code (the ft1 paragraph and the 7-byte block, 4.6), and `hl_run`'s header
comment says two allocations where the code makes three.

## 8. Upstream since `0b1d5cb`: v0.29.2 to v0.30.3 (2026-11-17)

How it was read: the read-only clone was fast-forwarded to `78a809e` (main, 2026-11-17), 204 commits after `0b1d5cb`,
with eight new release folders (v0.29.2 to v0.30.3; the tag `v0.30.4-alpha` has none). Read as data: the release
folders and their `NOTES.md`, `docs/DEVELOPER_NOTES.md`, `docs/FORMATS.md`, `research/NOTES.md` (2,026 lines added),
the new `research/TESTING.md`, `research/BUTTONS.md`, `firmware/build.py` and their new test suite (`tools/test/`).
Their firmware facts were checked on our pinned E147 block with `tools/mn10300dis.sh` and small read-only scripts, and
in lab sessions on base `19befb74` (stock, and their releases' `patch.json`, through `bin/session.mjs`). Their
addresses are given in E147 notation (theirs - `0x10021020`, "Addresses" above). Nothing of theirs is committed: the
pins are digests and observations, and the scripts that read their `build.py` and our container stayed outside the
tree.

### 8.1 What changed upstream

| Release | What (their notes) | Runs / bytes changed | New hook sites (E147) |
|---|---|---|---|
| v0.29.2 | custom modes C1..C5 keep their own films (#41): a record `OM3C` at store M + `0x3B000`; the switch runs at the settings manager's write of setting 1440; Assign and Recall through the settings facade's entries 18 and 20 | 159 / 324,781 | none (two facade words) |
| v0.29.3 | the Delete button takes any Fn function (#37): copies of the key table and the full-button list one entry longer | 175 / 327,667 | `0x51098ff5` (their `0x610ba015`), the state block walk's end |
| v0.29.4 | Picture Mode stars and a save on leaving it (#45, #46), a film's Custom WB Kelvin written to setting 1632 too (#48) | 175 / 327,352 | none |
| v0.29.5 | per-mode settings: record `OM3S` at M + `0x3D000`; Assign > Reset through the facade's entry 19 | 175 / 342,144 | none (one facade word) |
| v0.30 | Color Mix (a 3 x 3 matrix per film at the camera's colour-matrix call) and RGB curves (record `OM3R` at M + `0x3B100`, the engine in their tone hook), both photos only; `CURVES.BIN` kept at M + `0x3BE20`; the films loaded from M at the GUI's first state change, before any half press (their PR #56); the live mode-dial turn fix (#54); a new Picture Mode row order; a code tail `.ext13` at `0x60fac000..0x60fbc000` and section 6's end word raised to `0x60fb5000` (v0.29's `0x60fa3000`) | 189 / 391,637 | `0x504f383a` (`0x6051485a`, the matrix's row scaling), `0x511a19a2` and `0x511a194f` (`0x611c29c2`, `0x611c296f`: INFO and the held-OK reset in Picture Mode) |
| v0.30.1 | the bottom bar's one-frame flash on leaving a grid row (#66) | 190 / 391,675 | `0x511af57c` (`0x611d059c`), the Picture Mode update's end |
| v0.30.2 | no Glow / Halation on a shot's small extra developments, such as the review picture (#65) | 190 / 391,738 | none |
| v0.30.3 | a faster halation pass with a longer fade; the debug log written at releases only | 190 / 394,968 | none |

So v0.30.3 has 44 hook sites (v0.29.1: 39). The stock bytes at all 44, and the `0xff` of all 13 code tails including
`.ext13`, match our block (X, read from their `build.py` as text, as 2.8 did), and the five facade words these
releases add to their re-pointed words (entries 18, 19 and 20 and two of the RGB page's) hold the stock targets they
assert (X). Their test suite now drives the public om-emu at a pinned commit
(`tools/emulator/om-emu.pin`: `0819080`, 2026-11-14, with a weekly check that reruns the suite at the pin and at
upstream's newest): `bin/card.mjs` for its cards, `bin/session.mjs --main ... --loaded auto` for the patch audit, and
their own driver `session_ed1.mjs` for the other tests, which pokes memory where the lab cannot reach a camera state
and says so per test (`research/TESTING.md`). Their notebook's camera results are their report; its emulator results
came from om-emu at `0819080` or from their driver.

### 8.2 The new releases in the lab (X)

Each release was pinned with `--pin` and the v0.29.1 flow (films, the second session on a blank card, the no-card
part), plus two observations added to the flow for these releases: `early`, their state word `0x62b4dd16` 1.5 s after
the restart, before any half press; and `curves`, the 8 bytes at M + `0x3BE20` (`0x6295c520`; M's RAM image
`0x62920700`, 2.5) after the first S1. All eight open under the loaded-ranges mode with v0.29.1's audit (`hooks` none,
`ported` GET_STRING and the end word `sections.ends[5]`, `unloaded` 0, `tasks` none), read the copied mask `0x3ff`,
load the films at the first half press, name FILM 1, 2 and 20 `Portra 400`, `Portra 160` and `Natura 1600`, write
`FILM 2 Portra 160` and the photo code prefix `Caduceus FILM 2 Portra 160 om3.1.` into the S2 picture, keep the film
over a power cycle on a blank card and load it with no card, with no poke. v0.29.2 to v0.29.5 read 0 at `early` and
zeros at `curves`. v0.30 to v0.30.3 read their state word set at `early` (the films loaded from M before any half
press, and no task started: their load runs in the GUI task) and `4f4d334b 0100 b001` at `curves` (`OM3K`, version 1,
length 432: the card's `CURVES.BIN` kept in M, as their `docs/FORMATS.md` says). The card keeps only the files put on
it. 52 to 59 s each, three at once.

What the flow cannot show for these releases: the custom-mode, Delete, Color Mix and RGB-curve features (no flow turns
the mode dial, presses Delete or sets a mix or a curve, and a mix or a curve changes only the development the lab
stands in for, 4.4), the #65 fix (the lab makes one development a shot), and the faster halation (`hl_run` is checked
by calls on v0.29 and v0.29.1, 4.6; v0.30.3's output differs from theirs before on purpose, their h8).

Three of their statements about om-emu were re-checked here (stock E147 or v0.30.3, `bin/session.mjs`, X):

- "The emulator's stand-in card truncates a file the camera's `fopen` with `w` does not" (`research/TESTING.md`): not
  so here. With a 20,000-byte `OM3MOD/CADLOG.TXT` and `DEBUG.TXT` on the card, three half presses on v0.30.3 leave
  the file at 20,000 bytes, its first 9,216 bytes their report and the rest the old bytes, as on their camera. The lab
  runs the firmware's own file system on the card (S-SDCARD).
- "The debugger's getter call times out for 134 ids (111, 901, 1578 among them)": not reproduced.
  `call:0x503cf0f1:d0=ID` returns at once for 111, 901, 1578, 6, 1632, 1699 and 4000 (`0x36`, `0x36`, 0, 0, 5400,
  `0x800`, `0x800` on a blank camera).
- "300 quick presses of right in the film list kill the node process at about 1.4 GB": not with `bin/session.mjs`.
  300 `right` tokens in v0.30.3's Picture Mode list run in 185 s with a peak of 1.1 GB and exit 0, the page still
  open. Their run used their own driver; their camera's reboot on that scroll (#72) is not reproduced in either.

Their notebook's "om-emu takes no photo (`s2` and `hold:s2` change nothing)" does not hold for `bin/session.mjs`:
every pin above takes the S2 picture off the card with their photo code in it.

### 8.3 What in their recent work is useful to om-emu

"Theirs" marks a fact read from their notes and not checked here.

| Item | Their source | Our doc | Tag here |
|---|---|---|---|
| **The firmware's setting names.** Container block 2 (the large-data block, load `0x458c0000`, which the lab does not load) holds 52-byte names at body offset `0x28803f0` whose index is the setting id: 2,343 `MODE_*` names on E147 (ids 0 to 2342, `MODE_DRIVE` to `MODE_LABEL_PLAT_END`), then other name groups whose ids are not checked. E146's block 2 has the table at the same offset (2,226 names), E143's at `0x28c03f0` (2,205), with other ids (E143's 897 is `MODE_COLORTONE_DIAL_NEUTRAL`), so a name is per body. Names that settle or check our docs: 9 `MODE_WB`, 24 `MODE_EXPOSE`, 44 `MODE_MOVIE` (the application's movie mode, `docs/hle-gaps.md` 4.1.13, I until now), 50..53 `MODE_CUSTOM_SW_7..10` (the arrows, section 3), 111 `MODE_COLORTONE`, 534 `MODE_LEVER_SWITCH_TYPE`, 1578 `MODE_WB_STILL`, 1632 `MODE_CUSTOM_WB_KELVIN_1_STILL`, 2188 `MODE_ACTION_DIAL` | NOTES "Film WB: Custom WB Kelvin lost" ("decoded block 02, 52-byte names from 0x28803f0") | `docs/om1-settings-spec.md` section 10 (since 2026-11-17: the table found by its form on nine of the 19 bodies, the ids the docs cite named); the tools read it from the user's firmware at run time: the debug API's `setting` op, `bin/session.mjs`'s `setting:NAME` and `expect:setting:` (`emu/README.md` "The debug API", "Scripted sessions") | X (read from our `.BIN` files: E143, E146, E147; the rule on all 19) |
| **The Creative Dial's families by name** (2.7): 897 `MODE_COLORTONE_DIAL`, 898 `..._NEUTRAL`, 899 `..._ART`, 900 `..._COLOR_CREATOR`, 901 `..._COLOR_CREATOR_2`, 902 `..._NON`, 988 `..._MONOCHROME_CREATOR`. So 898, which the power-on routine sets for dial value 3, is the standard picture modes' family, not "none" (their #65 notes log 898 at "the standard position (Vivid)", their report). COLOR's 18 film settings are `MODE_COLOR_CREATOR_2_*` (908 `..._CONTRAST_SET1`, 976..978 `..._TONE_CONTROL_HIGH / MIDDLE / LOW_SET1`, 928 `..._VIVID_SET1_1`) | NOTES "Issue #65"; the table above | 2.7 (corrected there) | X (names); their report (positions) |
| **The mode dial and the shooting-mode code.** E147's positions in the lab are 0 S, 1 A, 2 P, 3..7 C5..C1, 8 B, 9 M. The settings object every manager call passes (a0; its byte +24 at `0x6242c3e8` in the lab, the address their notes give) holds the code of the firmware's mode-dial table: S 3, A 2, P 1, C5 `0x3f`, C4 `0x38`, C3 `0x37`, C2 `0x36`, C1 `0x35`, B `0x3e`, M 4, and 10 at the still / movie switch's positions 0 and 1. Setting 24 reads S 5, A 4, P 3, M 6, B 6 and 3 at each custom position of a blank camera; the dial's position index is the byte `0xa32d9d0c`. Their "C1..C5 = 53..57" holds for C1 to C4; C5 is `0x3f`, which the firmware's table names `MY_MODE5` (`src/fw/ports.mjs` E147 `mode_dial`, D): a lead for their mode grouping | NOTES "Custom modes and films", k2..k5, "Debug log dl8" | `src/fw/ports.mjs` mode dial names; `docs/hle-gaps.md` 4.1.13 | X (lab, stock E147) |
| **The still / movie switch's positions.** The byte `0xa32d9d0d` is the position (0, 1, 2), 0 and 1 both give mode code 10, and setting 2188, `MODE_ACTION_DIAL`, is written 2 at 0 and 1 at 1. Their notes take 0 as S&Q and 1 as movie, which answers section 6's question by name; what the firmware does differently at 0 is still not read | NOTES "Custom modes ... k2", "Per-mode settings p1" | `docs/hle-gaps.md` 4.1.13; section 6 | X (byte, code, 2188); theirs (S&Q) |
| **Setting ids by role** (their debug log dl9, found by walking the Super Control Panel, whose cursor setting 261 `MODE_SUPER_CONTROL_PANEL_CURSOR` takes the item's id): 24 mode, 1699 shutter and 1697 aperture as set (APEX x 256), 6 ISO (0 Auto, else Sv x 256), 2 exposure compensation, 85 AF target, 289 AF mode, 1712 subject detection, 16 / 17 flash and its compensation, 1 metering, 269 aspect, 157 stabiliser, 861 still quality, 2236 movie quality, 3265 drive; 1880..1883 Save Settings of C1..C4 (`MODE_AUTO_SET_MYSET1..4`), where their 1884 for C5 is `MODE_LOCK_SHOULDER_BUTTON` and C5's is 2176 `MODE_AUTO_SET_MYSET5` (E147's table, X); 570 and 1276 Button Function settings of a button the OM-3 lacks (`MODE_CUSTOM_SW_5`, `MODE_MOVIE_CUSTOM_SW_5`); 4000 / 4001 the exposure the AE worked out (their reading; past the table's `MODE_*` range, and 4000 reads `0x800` as 1699 does on a blank lab camera) | NOTES "Debug log dl9"; `research/BUTTONS.md` | `docs/om1-settings-spec.md` | X (the names given); theirs (the roles) |
| **The GUI state word** `0x62ce5864` (u16, child << 8 \| parent; parents 1 COMMON, 2 REC, 3 / 11 menus, 4 MENU_LV with child 0x18 Picture Mode, 5..7 playback, 12 edit), whose address the firmware loads at `0x510dbf61` (`0x610fcf81`) and keeps in `0x603713a4`, our `menu.caller` fact | NOTES "Debug log dl9" | `src/fw/ports.mjs` E147 `menu` | X (the load is the block's only reference to the word, a scan); theirs (the codes) |
| **The key path for a key with no record** (Delete, keycode 14, `API_DEL_KEY`, events `0x01000026..29`): the event-to-keycode table `0x512d20e0`; the 28-record key table `0x512d0ec8`, whose only references are the imm32 at `0x510620b4`, `0x5106212f` and `0x510621a6`; the dispatcher `0x51062002` (E143's `0x5104bc84`, already ported); the state machine's walk `0x51098fbb` and lookup `0x5109dcc0` (the current state's block, its parent's, then the global block `0x51318060`); the states 0x5100 stills live view, 0x5300 movie live view, 0x57xx playback, 0x5900..0x593e bracketing, 0x5a02 AF-ON held | NOTES "Delete button remap (#37)", steps 1 to 3 | section 7's follow-up 3 (E147's ISO and Fn-type keys) | X (the three references, a scan); theirs (the rest) |
| **The colour-matrix stage.** The stage list `0x504f8694` calls `0x504f3782` (frame 84) at `0x504f86d6`, before its call of the RGB gamma stage at `0x504f86dd`; a second caller is at `0x504f96db`, and the function's row scaling is its call of `0x504f34cf` at `0x504f383a` (their Color Mix hook). Theirs: `0x504f3270` multiplies two 3 x 3 matrices (A x B, A acting after B); a COLOR request takes the default branch with R+1587 and R+1923 zero; R+1587 1 or 2 multiplies the table at run-time `0x606ad348`; the camera's live view and movie jobs go through the same caller (their camera result) | NOTES "Colour mix per film: engine and probe m1", "Colour mix: the Mix row" | `docs/hle-gaps.md` 4.3.12 "E147's stage list and its job", which names the second call and not the first | D (the calls); theirs (the matrices) |
| **A shot's developments by job type.** `0x50534b38` (`0x60555b58`) maps the request's capture kind (u16 at +186): `0x2001` and `0x2006` give type `0x110` or `0x120` unless `0x50538ca2` answers 1 (then `0x1000`), `0x1008` and `0x1006` give 0, any other kind `0x1000`, the saved photo (D). Whether `0x10` or `0x20` comes from the request's u16 at +198 (2 gives `0x20`), not from the kind as their note has it (D). Theirs, through Caduceus for the E-P7: the camera clears an Art Filter job's multi-pass flags `0x40` and `0x80` for types `0x1xx` and `0x4x`, the shot's small extra developments (the review picture and the embedded preview among them), and their #65 freeze came from those developments carrying the Soft Focus flag. The lab makes one development a shot (S-JPEGENC) | NOTES "Reboot when resetting many films ...", DEVELOPER_NOTES "v0.30.2 release" | `docs/hle-gaps.md` 4.3.12, 4.3.13; 4.6 here | D (the mapper); theirs (which development each type is) |
| **The settings manager's path** (theirs): the manager `0x50b9426f` (`0x60bb528f`), its writer tail `0x50ac91be`, the change notifier `0x500424f9`, which only a real change reaches, and the picture-mode message `0x503f9ff9` with 111, sent for ids 111, 897..901 and 988 whatever the value. The facade's vtable entries 18, 19 and 20 are a custom mode's Assign, Reset and Recall (their trace): the words at `0x50e3649c`, `0x50e364a0` and `0x50e364a4` hold `0x50b6662c`, `0x50b65a8f` and `0x50b661d3` | NOTES "RGB curves: live view refresh", "Custom modes ... k2", "k6", "Per-mode settings p1" | `docs/om1-settings-spec.md` | X (the words); theirs (the roles) |
| **Interrupts masked, counted.** The firmware's lock `0x50054f53` with d0 = 0 sets the PSW's interrupt mask to 0 (4.6). Counting the instructions run between lock and unlock found a save running 212,851 instructions masked, their likeliest cause of one camera freeze; packing before the lock cut it to 10,062, and the camera test then passed | NOTES "Per-film R / G / B tone curves", tests 3 and 2b | 4.4 here ("Timing, the watchdog and the cache") | theirs (I for the cause) |
| **Pictures where the OSD engine reads them** (their report): a picture descriptor of theirs pointing into a code tail (`0x60f9....`, cached) blanked the rest of the camera's menu, while every picture the camera has shown points into the heap (`0xa2......`); the lab drew both | NOTES "Issue #64 ... Pictures live in the heap" | 4.4 here ("Timing, the watchdog and the cache") | theirs; I (a cache or bus path the lab does not model) |

Where the lab and the camera differ by their camera logs (their report; the lab side X where tagged), none of which
this round explains:

- **A live mode-dial turn** closes twice on the camera, setting 1440 written each time: first with the mode code 0
  (their log shows `0xC0` plus the raw dial position) and only then with the mode's code. The lab writes the final
  code at once. **At the first GUI look after a power-on** the camera's code reads 0, the lab's the mode's (P 1).
  **At B** the camera reads 0 (their logs, a power-on in B among them), the lab `0x3e` (X), the firmware's own
  table's code for B. Who writes the settings object's +24, and when, is not read here (?). Their #54 fix and its
  test poke the camera's in-between state into the lab (`research/emulator/issue54_sim.py`, `research/TESTING.md`).
- **The GUI's idle events**: their k3 log has the camera's GUI task get no event after a power-on until a key, where
  the lab's gets one about every 200 ms (their reading, I).
- **A frame between a hook and the update's publish** (#66): the camera showed one frame with the old row's bar; the
  lab composes the screen after the update returns, so it never shows it (their MMIO trace; I for the camera).
- **The camera's start writes** (their bp1 probe on the camera): task 167 writes 15258, 15319 twice, 15313, 897 and
  2188 before the GUI's first state change, and 897 twice more before any key. Their notes give other task ids for
  the same roles in the lab (165, 168); not compared here (?).
- **Setting 1440, `MODE_PLAY_MEDIA_SLOT_TRANSITION`**, is what their custom-mode switch takes as the end of every
  mode-dial change (written then and not at a half press, their lab trace). Its name says something else; what it
  means is not read (?).

Contradictions with om-emu's docs: one. Section 2.7 called the Creative Dial family 898 "none"; the firmware names it
`MODE_COLORTONE_DIAL_NEUTRAL`, the standard picture modes (corrected there). Nothing else read contradicts this note,
`docs/hle-gaps.md` or the FIDELITY notes; three of their statements about the lab do not hold today (8.2).

### 8.4 What om-emu should adopt or verify, ranked

1. **The setting names** (8.3's first row): read container block 2's table on E143, E146 and E147 (the offset found
   by its first names, never assumed from a length) and give a name beside each id in the debug API, in `call:`
   results on the settings getter and in the docs. Size: a day (I). Payoff: every settings-level finding in
   `docs/hle-gaps.md` and `docs/om1-settings-spec.md` checkable by name; 44's role is settled by it already.
2. **The mode change's order** (8.3, the first difference): read the writer of the settings object's mode byte and the
   writes around setting 1440 on E147, to say whether the camera's code 0 at a live turn, at the first look and at B
   is a step the lab skips (a lab defect) or a state the lab cannot reach without an input it lacks. Size: days (I).
   Payoff: their #54 class of bug shown by the lab, and their test's poke dropped.
3. **A count of instructions run with interrupts masked**, per step in the session record (the lock's PSW write to
   the unlock), with the longest window named. Size: a day (I). Payoff: their test-3 freeze class flagged before the
   camera; a stock baseline first, since the lab cannot say how long is too long.
4. **The shot's extra developments** (job types `0x110` / `0x120`) in `docs/hle-gaps.md` 4.3.12's map of the still
   path: where E147 requests them and which is the review picture and which the embedded preview (D). Size: days (I).
   Payoff: their #65 class (an effect reaching the small developments) visible once the image library runs (4.6,
   list 3).
5. **The key path for a key with no record** (8.3) feeds section 7's follow-up 3: the same walk decides E147's ISO and
   Fn-type keys in the lab. No work beyond that follow-up.

Not taken: their RGB-curve, Color Mix and halation models (their code against their model, as 4.6 already does for
three hooks), their spektrafilm analysis (nothing of it reaches the camera), LookLab, and their camera-only results as
evidence beyond saying they exist.

### 8.5 The regression run on this round

`OM_CADUCEUS=$C OM_EMU_MODEL=E147 node emu/test/test_caduceus.mjs` on `78a809e`, three at once (X, 2026-11-17): the
pin units 7 of 7, the releases 60 of 60, all 27 folders from v0.16 to v0.30.3 as pinned, 35 to 39 s each to v0.28
and 52 to 54 s each from v0.29-beta on (the no-card part), the section-6 control and the bent-pin control as before.
The flow's two new observations (`early`, `curves`) are taken only where a pin's flow asks for them, so the 19 older
pins stand as they were. To pin the next release: `--pin vX --flow` with v0.30.3's flow (its row in
`emu/test/fixtures/caduceus-releases.json`).

## 9. Upstream since `78a809e`: v0.30.4-alpha to v0.40.2 (2026-11-22)

How it was read: no checkout. The eight releases' assets (`patch.json`, `LOOKS.BIN`, `CURVES.BIN`) were fetched with
`gh release download` into `~/.om-emu/thirdparty/caduceus-om3/<tag>/`, outside the tree, each checked against the
sha256 GitHub lists for the asset, and run with `OM_CADUCEUS` pointing at a folder whose `releases/<tag>` link to
them (the layout `test_caduceus.mjs` reads). The same files in upstream's `releases/` folders on main at `f3b84dc`
(2026-11-22) have the same sha256, except that the five pre-release folders (v0.30.4-alpha, v0.40-alpha, -beta,
-beta2, -beta3) hold no `CURVES.BIN`, while their release assets do, byte for byte v0.30.3's. Their pins therefore put
v0.30.3's `CURVES.BIN` on the card, so a checkout and the asset folder give the same run. Their release notes (the
GitHub release text, the same as the folder's `NOTES.md`) were read as data. Nothing of theirs is committed.

| Release | What (their notes) | Runs / bytes changed |
|---|---|---|
| v0.30.4-alpha | the fast film switch reboot fixed (#72: which film each COLOR holds written once on leaving the list, not at every step), the colour wheel's page labels (#64, #70), looks kept out of video and S&Q (#68, #73) | 190 / 404,172 |
| v0.40-alpha | crop modes (Image Aspect 5:4, XPan 65:24, 21:9), a white Border row, their own film grain with a Grain Size row, start-up safety checks, Picture Mode open 30 s (#75, #76) | 305 / 427,348 |
| v0.40-beta | crops kept at switch-on (#83), frame lines at the crop, looks in live view per dial click, black borders, 14 screen-info rows | 317 / 442,187 |
| v0.40-beta2 | three more screen-info rows; the Firmware Version screen's Caduceus line | 317 / 442,444 |
| v0.40-beta3 | the debug log saved in the background (#85), Halation's shorter fade paused at the half press, a new `LOOKS.BIN` in custom modes (#86) | 317 / 445,440 |
| v0.40 | v0.40-beta3's firmware under its release name | 317 / 445,441 |
| v0.40.1 | round film grain; a film's WB Compensation set as the camera's own (#88) | 317 / 446,991 |
| v0.40.2 | colour grain made on every row, less red-green, faster | 317 / 447,415 |

**In the lab (X, base `6b111c6b`).** Each was pinned with `--pin` and v0.30.3's flow, and every one passes it as
v0.30.3 does: the open under the loaded-ranges mode with no unloaded patched range, the copied mask `0x3ff`, the films
loaded before any half press (`early`) and at the first S1, `OM3K` version 1 length 432 kept in store M (`curves`),
FILM 1, 2 and 20 named `Portra 400`, `Portra 160` and `Natura 1600`, `FILM 2 Portra 160` and the photo code prefix
in S2's picture, the film kept over a power cycle on a blank card and with no card, no poke. One observation changes,
from v0.40-alpha on: the audit's `ported` gains `0x50040163` (E143 `0x5003f5dd`, the settings store's save,
`src/lab/menu.mjs` S-NVRAM), whose first 8 bytes their patch turns into a jump to their own code. Which of their
features that hook serves is not read here. 53 to 65 s each, three at once. So nothing breaks in this range: the flow
sees no regression in their builds and hits no lab limit.

What the flow cannot show for these releases: every feature this range adds (no flow sets an Image Aspect, a Border,
a grain level, a screen-info row or a WB Compensation, or opens the Firmware Version page), and the two camera faults
it fixes: #72's reboot (not reproduced by the lab, 8.2) and #85's wait behind the card (the lab has no card timing,
4.4). The v0.40.3-beta pre-releases (one of them, beta2, boot-looped on the camera and was withdrawn) have no folder
on main at `f3b84dc` and are not pinned.

**Their `research/TESTING.md` at `f3b84dc`, against om-emu today.** Two of its statements about the lab are out of
date. They are noted here and not sent upstream:

- "The camera's `fopen` with `"w"` does not truncate a file. The emulator's stand-in card does." (its card file
  system limit): not so since 8.2. The lab runs the firmware's own file system on the card (S-SDCARD), and a longer
  `CADLOG.TXT` keeps its old tail as on their camera (X, 2026-11-17).
- Their boots run through their own `session_ed1.mjs` "because it can set the photo/video switch", and moving them to
  `session.mjs` waits "once it can set the photo/video switch". `bin/session.mjs` has had the switch since 2026-11-14
  (`f054851b`; their pin `0819080` already has it in `bin/session.mjs` and `src/lab/play.mjs`): `switch:still_movie=K` moves it to position K (0..2) during a run, and
  the position is carried over the power lever's off (S-NVRAM). `test_smswitch.mjs` checks both (E147, 14 of 14, X
  on this base).

To pin the next release: `--pin vX --flow` with v0.40.2's flow (its row in `emu/test/fixtures/caduceus-releases.json`).
