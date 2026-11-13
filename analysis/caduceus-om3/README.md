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
`tools/mn10300dis.sh`, small node scripts that only read bytes, and probe sessions of the E147 lab at `f2b326b`. No
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
   Eighteen release folders, v0.16 to v0.29 with test versions, in a history from 2026-11-05 to 2026-11-13.
3. **How it uses om-emu.** Builds run in an E147 lab session before the camera (their notebook), through scripts
   that import 11 of om-emu's internal modules, write memory the lab leaves unset and call firmware functions with
   hand-made stubs (section 3). One write is still needed on today's om-emu: the section loader's copied mask
   `0xa32de590`, without which their card and film load never runs (X). The media word they also write is set by the
   lab since 2026-11-12 (X).
4. **Where the lab misled or could not answer.** The flat image (code in an unloaded gap, a boot loop from load order),
   the capture path (reboots and hangs the lab never reaches), timing (an uncached-heap hang) and the colour wheel plane
   (section 3, table). The lab caught more than a dozen of their bugs, most of which the camera would have shown as
   restarts.
5. **New to om-emu** (all checked on E147): the copied mask's single writer and the end-word switch, the
   inter-section gaps the camera does not load (their report) with their exact sizes, the reset head's five copies, the
   media status setter's three kinds, the per-shot EXIF fill site and the EXIF writer table, the Creative Dial's
   power-on mapping, and that a native power-off save carries store M's unused tail (section 2).
6. **What om-emu takes:** this round's modules for verifying modified firmware, each answering one of their workarounds
   (section 4). **Corrections to om-emu's docs:** four (section 5).

## 1. What it is, and how it is built and delivered

- **Repository (D).** 449 commits from 2026-11-05 to 2026-11-13, 627 tracked files: the firmware sources
  (`firmware/src/editor.s` 13,734 lines, `xblock.s` 2,855, the linker script `editor.ld` 203), the build and patch
  scripts (`firmware/build.py`, `patch.py`), card-file generators (`card/`), a web app for making films (LookLab,
  `webapp/`), user docs (`docs/`), the per-release folders (`releases/v0.16` .. `v0.29`, with alphas and betas), the
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
`0xa03a4000` from `0x50383000` (lengths: words at `0x62960794`, `0x62960798`, `0x6296079c`, `0x629607a4` less the
destination) and `0xa1aad000` from `0x51a8c000` (`0x1000` bytes). The last covers section 10's trailing data; the
middle three lie in section 1's tail past its loader end, so they plausibly lay out the rest of it (I; who writes the
length words is ?).

**On the camera the gaps are not loaded (their report).** Their gap probes (GX1..GX4) summed every gap on the camera: no
sum is that of an all-`0xff` run and one changed between runs, so the gaps hold leftover RAM; raising section 6's end by
4 KiB, then 64 KiB, then 256 KiB more brought the probe code and patterns placed there into the load intact. om-emu maps
the whole block at the image base (`src/machine.mjs:179-184`, D), so the gaps hold the file's `0xff` in the lab.

### 2.2 The copied mask and its single writer

`load_section(n)` at `0x50024eb5` (theirs `0x60045ed5`) reads the end through `0x50024e4c`, the row at
`0x60029b28 + 12 * (n - 1)`, copies end - start bytes through the flash driver `0x500022b1` with mode `0x10200` (the
port's `storage.nand.access` and its read mode), logs a non-zero result and then, whatever the result,
`mov (0xa32de590),d1; or d1,d0; mov d0,(0xa32de590)` with `d0 = 1 << (n - 1)` at `0x50024f13..0x50024f1b` (D). Those
two are the block's only absolute references to `0xa32de590` (X, a scan of every aligned and unaligned word), so the
word has no reader in stock code. Its E143 twin is `0xa32df1f8`, set by `0x50024e6b` in USTART_L2 `0x50024572`
(`docs/hle-gaps.md` 4.6); the port pairs that loader with E147's `0x500245a5` (X, `PORTS.E147`). In a stock E147
session it reads 0 at open and after S2 (X), as the lab runs no loader.

The phase mask beside it, `0xa32de58c` (`FACTS.E147.boot.stage`), has three references: the wait `0x50024e1b` and the
per-section step's `or` at `0x5002503e..0x50025046` (X, the same scan); S-BOOTSTAGE sets bit 0 and it reads 1 (X).
Their gate does not test it; only the card-load worker of v0.25..v0.27 waited for bits `0x2e9` (D, their source).

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

In the lab (X, v0.29's main block from its `patch.json`, blank card, probe session): the HLS task id word reads `0xa4`
(their 164), the call site runs at the shutter events, SD's word is `0xF000`, and the state word stays 0 after S1. With
`0xa32de590 = 0x3ff` written after open it is `0x8801` after the next S1: the gate opened and the block was published.
So the copied mask is the one lab gap between their gate and a native run.

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
`FACTS.E147.rec_file.exif.tags`' offsets, an independent check. In the lab the site never runs (X, stock and v0.29,
S1 then S2): the set-up's UserComment loop `0x50434fd7` (theirs `0x60455ff7`) runs once, the per-shot fill does not,
as S-EXIFPRM stands in for TAKE's EXIF set (`src/lab/rec.mjs`). So the photo code cannot be checked in today's lab.

### 2.7 The Creative Dial and the settings getters

- **Creative Dial (D, `0x501f58a5`, theirs `0x602168c5`).** The power-on routine reads UI code `0x1906` through
  `0x501570c5` and, for values 1, 2, 3, 4, 5, prints a `picd_00n!` string and sets setting 897 (the Picture Mode
  family) to 900, 899, 898, 901, 988 through `0x503cf304` (theirs `0x603f0324`; E143's `0x503c4b2f`, port pair X). That
  the four physical positions are CRT = 900, ART = 899, COLOR = 901 and MONO = 988 (898 none) is their report. The lab
  does not run the power-on path that calls this routine (X: not reached once a session is open) and fixes the dial
  at one idle position (`src/lab/play.mjs` POSITION_SWITCHES).
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
the gap. One run covers a site the lab uses: their string-getter hook at `0x510d4686` is E143's GET_STRING
`0x510bb079` (port pair X), which the lab calls natively (`src/lab/text.mjs`) and does not hook, so the lab runs the
patched getter (I: benign).

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

Two of their workarounds are stale on today's om-emu: the media word (2.3), and their note that om-emu has no
`PlaySession.lab_created` hook (it has had one since `fe4c205`, 2026-10-31). The allow-list still refuses a task the
patch creates (`src/lab/kernel.mjs`, D); v0.29 creates none (its two worker hook sites hold stock bytes, X).

**Where the lab misled them or could not answer.**

| Case (their name) | On the camera (their report) | In the lab (their notebook) | Why (om-emu side) | Closed by |
|---|---|---|---|---|
| Slider code at `0x60133000`, in the `0xff` run below section 1 | not flashed: it would not have been loaded | ran | the whole block is mapped (2.1) | the loaded-ranges mode (4) |
| v0.20-t1: stage code in section 2 calling section-8 code | boot loop, recovered by flashing v0.19 | booted | every section is present from the start; the lab runs no boot order (their cause is a static reading, I) | follow-up 7 |
| Capture-path crashes: v0.24's getter during capture, lk6's WB read from the heap at S1, ft5 / ft7 / ft8, rc2b's broken file, grain with RAW+JPEG | reboot, hang, a file with EXIF and thumbnail only | not reached ("the emulator cannot capture") | TAKE, development and encode are stood in (S-RELSEQ, S-EXPOSE, S-EXIFPRM, S-JPEGENC) | the per-shot EXIF (4) for the photo code; development is not taken |
| `fb`-prefixed `movbu (d8,An),Am` (gt1) | misread | "worked" | om-emu faults on `fb` with nn = 2 (`src/core/cpu.mjs`, D); the instruction sat in the capture path the lab never ran (I) | nothing in the CPU |
| lk7 / lk9: block code in the uncached heap on the COLOR switch | 1 s hang, restart | fine | no fetch cost, watchdog or stack-depth model | not taken |
| The colour wheel's plane | drawn | `PLANC_UNOBSERVED`, on stock too | the OpenVG / K3000 stack on CPU 1 is dormant (`docs/hle-gaps.md` 4.12) | follow-up 9 |
| v0.27's sporadic start-up hang with the dial moved while off | hang | not shown | one deterministic schedule; no dial position | the Creative Dial input (4) for the position; the race is not taken |
| Stills-mode arrow keys and the front dial (`research/BUTTONS.md`) | differ | other setting ids read | the lab's key routing; their stills-mode lab results declared void | follow-up 6 |

**Where the lab answered.** Their notebook credits the lab with a frame bug that overwrote a saved register (`gd_set`),
a cached-alias relocation landing at a wild address, an assembler-made wild call that stopped the session (the lab was
right, though its stop message did not say "wild call"), an `mdr` clobbered before a `retf`, the drive-mode restart
(a fault in their `gr_is`, reproduced in the lab and then on the released v0.25), the WB grid's restart on a half-press
and edits that never reached their memory; and with a camera fact: the camera saves store M at power-off as the lab
does (their notebook, later consistent with the camera).

| | Caduceus | om-emu |
|---|---|---|
| Stock pinning | input and main-block sha256; every hook's stock bytes asserted at build | `BLOBS.sha256`, `rom_sha256`, golden digests; overlays check old bytes |
| Release | runs of new bytes anchored by before / after / package digests | overlays with old bytes; theirs too (section 4) |
| Lab use | whole sessions through internals, harness writes, stub calls on synthetic structures | the whole camera on its cores, stand-ins named |
| On the camera | every release labelled camera-tested or test; on-card log and gap probes | none |

## 4. What om-emu takes and what it does not

**This round adds** (2026-11-13; each option, its stand-in and its status are in `emu/README.md`):

- **Digest-anchored patch files.** `--patch` reads the `om3-patch-2` shape: the runs at `addr - main_base`, the old
  bytes taken from the verified stock block, refused unless `main_sha256_before` is the model's `rom_sha256` and the
  result is `main_sha256_after`; `frames` and `card_files` are reported, not applied. **`--main FILE`** takes a
  patched decoded main block and turns it into the same overlay against stock, so every digest pin stays. Replaces
  their direct `Player` bring-up.
- **The section loader's copied mask** (2.2), set as the loader would leave it, placed by a rule that reads
  `load_section`; and a **loaded-ranges mode** that gives DRAM only what the reset head and the loader copy, by the
  (patched) image's own end words, so code or data in a gap faults in the lab as it would misbehave on the camera.
  Replaces their mask write and answers their gap question for the lab.
- **Card file tools**: make, list, put and get files on an `.omsd` card. Replaces their mtools and FAT rewriter.
- **The power-off restart fix**: a second session after a native power-off on a kept state (their workaround: drop
  `scpu` from the file; section 5 item 2).
- **The Creative Dial** (2.7) as an input on E147. Replaces their local om-emu change and code injection.
- **A firmware call op** on the debug route, run through the lab's own call path with its hooks. Replaces their stubs.
- **The per-shot EXIF fill** (2.6) run natively, so their photo code can be read back from the card's JPEG.
- **A scripted session tool**: a headless play session from a token script with per-step snapshots, shots, reads and
  calls. Replaces their drivers' use of internals.

**Takes as facts** (attributed, for the specs): the E147 section table, end switch, copied and phase masks, reset head
copies and gap sizes (2.1, 2.2); the media setter's kinds (2.3); the EXIF writer table and fill site (2.6); the
Creative Dial's mapping (2.7); and as leads, unchecked here (?), their maps of the OM-3 still pipeline (work lists,
request and combiner fields, the tone stage), the Button Function tables and the GUI's Picture Mode structures.

**Does not take:**

- **Code, patch bytes and assets.** No assembly, no `patch.json` or built image, no card files, LookLab, film data or
  pictures. Tests use synthetic patches written by the tests (`emu/README.md` "Patch overlays").
- **Image development and looks on pixels.** Their looks act in the colour, tone, grain and halation stages of the
  still and live-view development, which the lab stands in (S-SCENE, S-IMGPRO, S-JPEGENC); a film's look cannot be
  verified on a picture in om-emu.
- **The GPU wheel plane**, **the boot order** of sections against tasks, **timing, cache and watchdog** effects, and
  **component 2's frames** (the lab loads only the main and resource blocks, `src/fw/olyfw.mjs`).
- **Their camera claims as evidence**, beyond saying they exist.

## 5. Where it corrects om-emu's docs

1. `docs/hle-gaps.md` 4.6 ("CPU 2's code and loader") says the lab's image already holds every segment and the copies
   matter only to a cold boot (I). On the camera the bytes past each loader end are not loaded (their report, 2.1), so
   the copies and their order matter to any image whose code or data lies past an end or runs before its section is
   copied; on E147 the same structure is `load_section` `0x50024eb5`, the end switch `0x50024e4c` and the copied mask
   `0xa32de590` (D).
2. `emu/README.md` "The camera's kept state" says two sessions on a fresh file restore M and E on each (X). That holds
   after a menu close; after a native power-off the next E147 session stops at the registry bootstrap, `prints ["FlD.",
   "BlR.", "ElR.", "MlR."]` where `"BlD."` is expected (X, stock), because the kept SCPU words restore the B store that
   `src/lab/menu.mjs`'s expectation does not count (D). Section 4 lists the fix.
3. `src/lab/play.mjs` says of E147's Creative Dial that which position is which profile is not known: the firmware's
   value-to-family mapping is in 2.7 (D); which value each physical position gives is their report.
4. `docs/ROADMAP.md`'s firmware-patch track names whether the camera accepts a no-op image as what remains before
   flashing. For E147 the SD updater accepts a main block their releases change (321,613 bytes in v0.29), with
   recomputed block checksums and the version unchanged, in every release since v0.16 (their report); E143 stays open.

## 6. Open questions

- Who writes the reset head's length words `0x62960794..0x629607a4`, and so how far section 1's tail is laid out (2.1);
  an exact loaded-ranges map of the image's first part needs it.
- What the camera's unloaded RAM holds at power-on (their gap sums vary between runs), so which poison the lab's
  loaded-ranges mode should use is a model choice, not a fact.
- When sections 6..10 are copied relative to the tasks that call into them, the order behind their v0.20-t1 boot loop.
- Why the camera sends their custom Picture Mode row's OK as another event than the lab's (their test 12), and the
  stills-mode key and front-dial routing on E147 (`research/BUTTONS.md`).
- Why the firmware's `fopen` found `DEBUG.TXT` but not `DEBUG.ON` in the lab (their notebook; not tried on a camera).
- Whether E143's SD updater accepts a modified main block as E147's does.

## 7. Follow-ups, ranked

1. **The four doc corrections of section 5.** Size: an hour. Payoff: removes three wrong or incomplete statements and
   a stale code comment.
2. **A local regression run of each Caduceus release** through `--patch`, the copied mask and the loaded-ranges mode,
   pinned by the release's digests in `BLOBS.md` and never fetched by the tests. Size: a day. Payoff: an om-emu change
   that breaks a camera-tested downstream build is seen before it is published.
3. **A patch audit** in the overlay summary: patched ranges against the model's ports, facts and the lab's hook sites,
   call frames that become ambiguous, runs outside the loaded ranges. v0.29 touches one lab-called site (2.8). Size:
   1-2 days. Payoff: names the lab assumptions a patch breaks.
4. **Tasks a patch creates**: allow an entry that lies in patched bytes and name it in the summary. Size: a day.
   Payoff: v0.25..v0.27-style builds run without editing the allow-list.
5. **Row-crossing OSD runs**: om-emu's engine refuses a picture run that crosses a row end (`BMP_TOKEN`,
   `src/dev/engine.mjs`), while their `GUIDES.BIN` pictures do so and draw on the camera (their report). Size: a day
   to read the engine's decoder. Payoff: their pictures, and any firmware stream that does this, draw in the lab.
6. **E147 stills-mode key dispatch** (their `research/BUTTONS.md`: the arrow keys and front dial in P / A / M read other
   setting ids in the lab). Size: days. Payoff: the Button Function and dial paths users run.
7. **The boot order of sections** on E147: copy sections as the loader does, at its point in the boot, so code that
   calls a later section early faults. Size: weeks (it is CPU 2's boot job). Payoff: the v0.20-t1 class of boot loop.
8. **The still capture through development** to a recording image processor, compared with their camera logs. Size:
   months. Payoff: the largest: their looks, grain and halation, and every capture-path crash in section 3.
9. **The K3000 wheel plane** (`docs/hle-gaps.md` 4.12). Size: weeks. Payoff: the OM-3's colour wheel, theirs and stock.
