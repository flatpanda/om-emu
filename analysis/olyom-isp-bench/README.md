# SmilingChaosCloud/olyom-isp-bench: a study for om-emu (2026-11-14)

[SmilingChaosCloud/olyom-isp-bench](https://github.com/SmilingChaosCloud/olyom-isp-bench) is a single-page browser
bench: a software image pipeline of 15 stages with sliders, centred on sharpening, that can load a PEN-F 3.1 update
file (om-emu's E122) and run seven of the camera's own parameter functions on om-emu's MN103 core to fill some of its
values. It is the first project known here that embeds om-emu's code. This note answers what om-emu can take from
it: what it runs and on what, which of its layers rest on firmware and which do not, whether its claims hold, and
what its use of the core showed about om-emu's own notes. It ends with open questions and follow-ups.

How it was read: a read-only clone at its head `0e1cc37` (2026-11-14), outside the tree. Its sources were read as
data; its `test/realfw.mjs` was run on our stock files and its pipeline functions were called from a scratch script
on a copy, nothing of it changed. Every firmware fact below was read again on om-emu's own E122, E143 and E147 blocks
with `tools/mn10300dis.sh` and small node scripts, and the calls were made again through om-emu's own `call` op
(`emu/bin/session.mjs`). The first reading was a study of 2026-11-14 with five readers and three verifiers per
candidate; what this note reran itself is tagged "rerun", what it relays from that study "the study". No line of the
bench's code, no table and no byte of it is committed, and the desktop program it draws on was not obtained.

**Licence.** Its README declares the project as a whole GPL-3.0-or-later, because it includes a port of
RawTherapee's AMaZE demosaic, and says the parts derived from two Apache-2.0 research projects keep that licence
(`README.md:96-103`). It carries three om-emu files (below); om-emu is under the MIT License since 2026-11-14, the
day of the bench's head. These are facts as the two repositories state them, no more. om-emu takes facts and ideas
from the bench, attributed, and none of its code.

Related notes: [fishcu/oly_fw_analysis](../oly-fw-analysis/README.md), whose probes the bench's call fixtures come
from, [Caduceus for OM-3](../caduceus-om3/README.md), `docs/hle-gaps.md` 4.3.12 and 4.8.13.

**Addresses.** The bench writes PEN-F code addresses in run-time form (block offset + `0x60021020`); om-emu's
notation is block offset + `0x50000000` (`docs/README.md` "Addresses"), so theirs - `0x10021020`. Code addresses
below are om-emu's, data run-time. Its files are cited relative to its root. Tags as in the specs: **X** executed
here, **D** read in the firmware (or in their source, where said), **I** inference, **?** unknown.

## Short answer

1. **What the firmware part is.** Seven PEN-F functions called on a bare core with a job the bench writes itself: a
   zeroed job record, request and parameter block with eight fields set. Their outputs fill six stages' values. Every
   pixel operation of the bench is written by its author: none comes from firmware.
2. **om-emu can do the same on its supported surface.** All 55 rows the bench's real-firmware test prints were
   reproduced byte for byte, with equal instruction counts, through om-emu's own `call` op in an E122 session (X, the
   study; eight rows and three controls rerun), and the same function family was found by disassembly on E143 and
   E147. So the still's stages can be checked standalone, below the pixels, without the native shooting path.
3. **What such a number is.** "The function on an otherwise-zero job", never "the camera's value": bytes of the job
   that the fixture leaves 0 change the outputs (X). No camera-side job exists to say what a real request holds
   (`docs/hle-gaps.md` section 8, the row that needs code run on a camera).
4. **The pixel layer is outside om-emu's evidence rule.** 11 of its 15 pixel models are labelled assumed and 4
   documented, where "documented" means research notes, a static reading of a proprietary desktop program and fits
   to that program's exports. om-emu uses none of that as evidence.
5. **What it corrected.** Two stale sentences about the pipeline unit, the note on oly_fw_analysis, and one caption of
   the player (section 5).

## 1. What it is and how it uses om-emu

- **The page.** `src/pipeline.js:159-347` renders a 400 x 400 Bayer crop through levels, white balance, demosaic,
  colour matrix, six-axis colour, gamma, chroma gain, a twelve-sector colour profile, tone, tint, chroma edge,
  softening, sharpening, grain and shading (`src/params.js:10-43`). `dist/index.html` is the whole tool in one file.
- **The firmware gate.** `src/firmware.js:7-26` takes a `.BIN` container or a decoded main block, reads the main
  block with om-emu's container reader and accepts it by its length, 21,364,672 bytes; the digest only chooses
  between the labels "stock" and "modified", and the header's model is carried along and never compared.
- **The calls.** `src/native.js:16-36` maps the block read-only at `0x60021020` and a few RAM regions, and
  `:53-74` is its own harness on the core: a trampoline (`call` with a register mask and frame the caller gives, then
  a stop), a budget of 20,000 instructions, any fault reported as an error. It does not use om-emu's machine, lab,
  `call` op or sessions. The functions (`:84-136`), each a CALL target in the E122 block with the mask and frame the
  bench passes (D, a call-site scan):

  | The bench's name | om-emu notation | Call site, [mask, frame] | Output the bench reads |
  |---|---|---|---|
  | YC packing | `0x504d2b81` | `0x504d78ca`, [f0, 24] | the block's bytes 12..19: control, coring, gain, two limits |
  | YC register writer | `0x50493fe6` | `0x504939ab`, `0x504939cd`, [f0, 24] | two words of a bank it maps as RAM at `0x9e001800` |
  | six-axis | `0x504d45be` | `0x504d75b5`, [f0, 100] | twelve i16 at the block's +108 |
  | grain builder | `0x504c929a` | `0x504c8f63`, [f0, 20] | a gain and a seed |
  | tone selector | `0x504d65c5` | `0x504d6bfe`, [f0, 24] | a pointer to a 256-entry table in the image |
  | chroma control | `0x504d73d1` | `0x504d75d8`, [b0, 20] | one word at the block's +0x4c |
  | HSL builder | `0x504d6252` | `0x504d64e6`, [f0, 96] | twelve records of 24 bytes at +676, a word at +964 |

  "The block" is the one the job record's +12 points at; the HSL builder is given a block of its own. Six tables
  are read straight from the image (`:138-144`).
- **The job.** `src/native.js:76-82` zeroes a job record of 192 bytes, a request of 1,132 and a parameter block of
  8,192, and writes eight fields: the record's +4 (the request), +8 (the parameter block), +12 (that block's +524),
  +48 (the picture mode), +56 (`0xffffffff`), and the request's halfwords +10 (the mode), +12 (a stage word) and +28
  (`0x200`). The layout is the firmware's own (D, E122): the image library's record filler writes the record's +12
  as the register image's +524, its +16 as the image's +5736, +48 as the request's key and +56 as `0xffffffff`
  (`0x50492921..0x5049295d`; `docs/hle-gaps.md` 4.8.13). The README says the fixtures are those of oly_fw_analysis'
  probes (`README.md:53-54`).
- **The three om-emu files.** `vendor/om-emu/cpu.mjs`, `mem.mjs` and `olyfw.mjs`, imported by `src/native.js:3-4`
  and `src/firmware.js:2` and bundled into `dist/index.html`. They are byte for byte om-emu's `emu/src/core/cpu.mjs`,
  `emu/src/core/mem.mjs` and `emu/src/fw/olyfw.mjs` as the public release line held them together from `02553859`
  (2026-10-29) until the two core changes of 2026-11-09, `d24ff9dd` among those commits (X, rerun: `git hash-object`
  against the release line; nothing in the files names a commit). Against master the first two lack the extension
  unit's bit search (udf07), a fetch guard and the second core's page state (18 and 10 differing lines); the
  container reader is unchanged. Everything else, the harness included, is the bench's own. The README credits
  om-emu with a link (`README.md:15`, `:85`); the bundled page does not contain the name (X, a search).
- **Its tests.** `test/run.mjs` asserts on a synthetic firmware it builds (`test/make-fake-fw.mjs`) and holds three
  negative controls for the harness (an unmapped read, a write into the image, a runaway loop; `:57-67`). The
  browser scripts assert nothing. `test/realfw.mjs FILE` prints every function's output on a real file.

## 2. Its layers by evidence class

The page labels each stage twice, "Values" and "Pixels", in four classes: Firmware, Documented, Assumed, Yours
(`src/main.js:9`, `:116-127`; the legend `src/index.html:39`). In om-emu's terms:

| Layer | What the bench has | Class for om-emu |
|---|---|---|
| Values of six stages with firmware loaded (six-axis, colour profile, tone, tint, sharpening, grain; `src/params.js:94-176`), and shading's two tables | the outputs of the seven functions on the bench's job, and six tables from the image | X for "this function returns this on this job" (rerun through om-emu's own `call` op); the job is an assumption; nothing here is a camera's value |
| The same values without firmware | constants in `src/params.js:51-59`, measured from the functions or taken from the research notes; a failed call falls back to them (`:64`) | the notes' statements; om-emu shows no value it did not compute |
| Field meanings (which request byte is the mode, the sensitivity, the sharpness, the grain level) | oly_fw_analysis' probes' conclusions | their report; I until a camera's job or the callers are read |
| Register field names shown as ISP registers (KEDGE, ESVX, ESEL, DER, KEG, FCSLMT and others; `src/params.js:27-38`) | names the firmware does not hold | no firmware evidence: none of KEDGE, ESVX, FCSLMT, YC1_ESEL or EDGE_STRENGTH occurs in the E122, E143 or E147 main block (X, rerun: a byte search). A unit name "CCA1YC1" does occur, in E122's print formats and in E147's name table |
| Pixel operations, 11 stages (`pixels: 'model'`) | the author's models | assumed; not usable as a model of the camera's unit |
| Pixel operations, 4 stages (`pixels: 'doc'`: chroma edge, sharpening, grain, shading) | fits to a desktop program's exports and arithmetic read statically from that program's library (`README.md:61-70`, `src/pipeline.js:4-20`, `:78-157`) | other people's statements about a proprietary program, which om-emu does not use as evidence and did not obtain. oly_fw_analysis' own sharpening note says bit-exact camera and desktop equivalence is not established |

The page says of its register values that they "are captured, not applied by real hardware" (`src/index.html:52`),
and its README that the camera's ISP hardware is not emulated (`README.md:58-59`). That is om-emu's position too
(`docs/hle-gaps.md` 4.3): the firmware yields parameter values and, since this study, the page of the unit each is
copied to (4.8.13), not the operation.

## 3. Claims tested

| # | Their claim | Result | Tag |
|---|---|---|---|
| 1 | The functions run on "om-emu's unmodified MN103 core" (`README.md:53`) | Holds: the three files equal om-emu's blobs of the release line (section 1). With om-emu's files of 2026-11-14 in their place (`a68dca3`) the bench's tests pass and `test/realfw.mjs` prints the same | X, rerun (identity); X, the study (the swap) |
| 2 | "PEN-F firmware 3.1" (`README.md:31-33`; `src/firmware.js:21`) | Not a gate: any main block of 21,364,672 bytes is taken as "PEN-F 3.1 layout, modified". The E-M5 II 4.1 and E-M10 II 1.4 blocks have that length; the E-M5 II file is accepted, all 55 function rows fail and the tables read from fixed addresses are garbage, with no error | X, rerun (E118); X, the study (E120) |
| 3 | `test/realfw.mjs` prints every function's output for a real PEN-F 3.1 file (`README.md:79-80`) | Holds: 62 lines, 55 function rows, none failed | X, rerun |
| 4 | "stages marked Firmware show the values a real PEN-F 3.1 `.BIN` produces" (`README.md:31-33`) | The function outputs hold: all 55 rows byte for byte and step for step through om-emu's `call` op in an E122 session (the study); rerun here for eight (six-axis modes 1 and 3, the YC packing at three settings, chroma mode 12, grain level 2, tone mode 3: equal values, 187, 283, 544, 544, 619, 56, 144 and 98 instructions as the bench counts). "A camera produces these values" does not follow: section 4 | X |
| 5 | The fixture writes a job as the camera would see it (implied by 4) | Does not hold as stated. The study's sweep found 22 request and record bytes the fixture leaves 0 that change an output or make a call fault. Rerun for the YC packing at COLOR, sharpness 0, Sv 1280 (coring 7, gain 37, 544 instructions): the request's +0x431 = 1 gives coring 0 and gain 70 in 547; +0x430 = 1 gain 30; the record's +0x63 = 1 gain 0 and the first limit 0. Whether a camera's request has zeros there is ? | X |
| 6 | Only mapped regions exist and anything else is a reported fault (`src/native.js:1-2`) | Holds for unmapped accesses and unimplemented instructions. The mapped block's tail is `0xff` in the file though part of it is RAM the boot fills on the camera, and reads there return `0xff` without a fault; the seven functions do not read it | X, the study |
| 7 | Sharpness +1 and +2 give the gain of 0 | Reproduced, and explained (D, E122): the gain is (K0 x LUT[clamp(base + sharpness, 0, 10)]) >> 8 with COLOR's base 5 and the table 256 from index 5 up, so on this path a positive sharpness changes nothing. oly_fw_analysis documents the table and says it does not prove equal photographs | X, D, the study |
| 8 | "at the camera's register values both paths produce identical shaper output" and "`wsGain` reduces to `gain = KEDGE` exactly" (`README.md:65-66`) | Holds at the level of the two shaper functions, for ES 0, ESVX = ESVY = 64 and KEDGE up to 255 (851,105 cases, none differ); above 255 it clamps while the slider runs to 512. The rendered picture of the two paths differs by default (136,167 of 640,000 bytes, at most 16) because the bench path's brightness gain defaults to 1, and is identical at 0. It says nothing about the camera | X, rerun |
| 9 | "the measured 5x5 ... is the validated net form of the real ... 6-tap ... band-pass" (`README.md:67-68`) | Not true of this code: with the other kernel selected the picture changes in 215,629 of 640,000 bytes, at most 79 | X, rerun |
| 10 | "decoded verbatim" from the desktop program's library (`README.md:62-65`) | Not checkable here, by choice: the program was not obtained | - |
| 11 | oly_fw_analysis is Apache-2.0 (`README.md:86`) | Holds for original contributions since that project's `a61498e` (2026-11-09), with stated exceptions (`analysis/oly-fw-analysis/README.md` 8.1) | D, their files |
| 12 | Opens without a server or a build step (`README.md:23`) | Held in a headless Chrome from a file URL; a rebuild was byte-identical to the committed page | X, the study |

Not looked at: the E-P7 project its README also names (not read for this note; nothing under the bench's `src/` or
`test/` cites it), its AMaZE port and its browser scripts.

## 4. What om-emu takes and what it does not

**Facts**, each read or run again on om-emu's side and attributed to the bench and to oly_fw_analysis as the lead:

- The PEN-F's seven entry points with their call sites, masks and frames (section 1), and the family on E143 and
  E147 (`docs/hle-gaps.md` 4.3.12 and 4.8.13 for the stage list, the YC packing, the job record and the wrapper that
  calls them; the per-stage table, its read sets and values are 4.3.12's, pinned by `emu/test/test_stages.mjs`).
- The job record: what the generic handler writes into it on E122, E143 and E147, that the stages' output block lies
  inside the register image, and the pages its parts are copied to with their writers (4.8.13 "The development's
  pages"). The bench's own layout (the record's +12 = the parameter block's +524) is the PEN-F firmware's.
- The sharpness rule of claim 7 (E122).
- That a zero job is not a camera's job (claim 5), which shapes how om-emu states every stage check: the job is a
  named assumption and the bytes a stage reads are pinned.

**Ideas** (no code):

- A call harness in which anything outside the declared job faults, with negative controls. oly_fw_analysis has it,
  the bench kept it, and om-emu's earlier note already listed it as worth adopting. In a session the `call` op does
  not fault on a read outside the job (a null pointer reads page 0, X, the study); a stage check can instead pin the
  set of addresses a call reads with `trace:mem`.
- Two provenance marks at the output, one for the values and one for the pixels. For om-emu's still they would read
  "parameters" and "pixels": the lab's picture has the firmware's own EXIF set and the lab's pixels (S-JPEGENC).
- A table of what the firmware's own code returned for the current inputs, with instruction counts, and a plain line
  when it did not run.
- A firmware gate that answers stock, modified or other instead of throwing. Claim 2 shows what it must not do: a
  length is not an identity; the header's model and the digest are.

**Not taken:** `src/pipeline.js` as a model of the pipeline unit, any pixel formula, the measured kernel, the
register field names of the table in section 2, the desktop program's arithmetic, the bench's setting keys, and any
code or table. A stand-in development for the lab's JPEG is not planned: it would make the lab's picture look more
like a camera's development while every formula in it stayed an assumption (`docs/hle-gaps.md` 4.3.9, "Whether the
lab can run it").

## 5. Where it corrects om-emu's notes

1. `docs/hle-gaps.md` 4.3.9 and `analysis/caduceus-om3/README.md` 4.6 item 4 said the pipeline unit's registers and
   interrupts were not read and the lab refused its first write. 4.8.13 had read and modelled the block for the play
   module's decode. Both now say so, and 4.8.13 lists the development's pages (made 2026-11-14).
2. `analysis/oly-fw-analysis/README.md` recorded that project without a licence and called om-emu a full-system
   emulator; its section 8 has the state at that project's head (made 2026-11-14).
3. `docs/hle-gaps.md` section 8 had no row for the one thing the calls cannot show, a camera's job (made
   2026-11-14).
4. `emu/web/play.html`'s Card panel says a picture's file is S-RECFILE's. On E143, E146 and E147 REC_FILE runs
   natively and the stream is S-JPEGENC's (`emu/src/lab/playui.mjs` STAND_INS). Found by the study; not changed in
   this pass, which touched documents only; fixed since (the Card panel now takes its sentence from
   `emu/src/lab/sources.mjs`, which names S-JPEGENC on those bodies).

## 6. Open questions

- What a camera's request and job record hold where the fixture has zeros, on any body (`docs/hle-gaps.md` section
  8).
- The meaning of the request's +0x431 on the PEN-F, which the YC packing reads and which moves the gain from 37 to
  70 and the coring from 7 to 0 (X); and whether a positive sharpness acts elsewhere on a real shot.
- Which unit-mask bits a development request sets, and what the pages' words mean to the hardware (4.8.13).
- On E143 and E147 a zero job gives twelve six-axis values that are the PEN-F's plus a constant, and a chroma word
  for MONO that differs from the PEN-F's (X, the study): body values or artefacts of the zero job is ?.

## 7. Follow-ups, ranked

1. **Stock stage baselines through the `call` op** on E122, E143 and E147: the stage functions on a job the test
   writes, the job a named assumption with its read set pinned, expectations from om-emu's own runs. Size: days.
   Payoff: a patch's stage output has "what stock gives" beside it; a regression on the core and the `call` op.
   Made 2026-11-14: `emu/test/test_stages.mjs` (twelve builders, `docs/hle-gaps.md` 4.3.12).
2. **A camera's job** (`docs/hle-gaps.md` section 8). Size: minutes to ask, a day to digest; it depends on a third
   party. Payoff: the stage checks stop resting on an assumed job.
3. **Grain on E147 at the stage level**, for Caduceus for OM-3: read the grain builder's job fields first. Size:
   days; the path to its second hook point is not known. Payoff: one more look checked below the pixels. Partly made
   2026-11-14: the stock grain builder's fields and outputs are in 4.3.12's stage rows, and Caduceus' Grain route is
   checked by calls down to combiner 1's gain (`emu/test/test_lookcode.mjs`); a film with Grain still stops the lab's
   S2 at the texture's build on the unit (`analysis/caduceus-om3/README.md` 4.6).
4. **The picture's caption in the player** (section 5 item 4), and the firmware's own values beside the lab's pixels.
   Size: hours. The caption is made (2026-11-14, `emu/src/lab/sources.mjs`); the firmware's values beside it are not.
5. **The remaining page writers**, block offset to page offset, when a development device for the unit is planned.
   Size: days. Payoff: a write set for that device; for look checks it adds little, since the first writer copies
   words unchanged.
6. **A firmware gate that returns a verdict**, and a container `.BIN` as `--main`'s input. Size: hours each.
   Payoff: small today. Made 2026-11-14 (`emu/src/fw/identify.mjs`; `--main` takes a `.BIN`, Patch overlays in
   `emu/README.md`).
