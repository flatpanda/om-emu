> Status (2026-10-25): a static survey. The firmware was read on the host (byte scans, string and pointer tables,
> byte statistics and hashes of the model items, computed in place by scratch scripts that are not committed) and
> disassembled with the MN10300 objdump inside the om-emu VM; nothing was executed and no model data was extracted.
> Nothing here is wired into `emu/` yet; section 5 is the plan.
>
> Update (2026-10-27): U1 and U2 are read (section 5.1: MDET's frame table, how DISP_FRAME reads it, the setting), and
> step A runs: S-SUBJECT (`emu/src/lab/subject.mjs`) writes S-SCENE's subjects into MDET's table and posts UP_FACE, and
> DISP_FRAME draws the frames natively. Corrections in section 4.3.
>
> Update (2026-11-07): the first part of step C runs (section 5.3): CPU 3's MDET_DL code natively on the lab CPU from
> TAKE's calls to dml_start_callback and MDET's subject records, with S-DML (`emu/src/dev/dml.mjs`) for the engine. Its
> second part (section 5.4): S-DML writes S-SCENE's subjects as the engine's records, and MDET's own stabilisation
> reports them; LAF then fills the frame table's inputs natively.

# OM-1 subject detection

What runs the OM-1's subject detection (the deep-learning "AI" detection of motorsport, aircraft, trains, birds and
animals, the tracking that follows a subject, and the face / eye detection beside it), where its models live in the
`.BIN`, how it connects to the rest of the camera, and what an emulator can do at each seam. Firmware: E143 v1.9;
the OM-1 Mark II (E146 v1.3), OM-3 (E147 v1.1) and a few older bodies are compared in section 3.5.

Evidence tags as in `docs/README.md`: **D** read from the code or data, with the address; **X** measured by a scratch
script (byte statistics, hashes, constant counts); **I** inference; **?** unknown. Code addresses are disassembly
notation (body offset + `0x50000000`), data addresses run-time (body offset + `0x60021020`, or `0xa3xxxxxx` DRAM
variables); offsets into the large-data block are body offsets of the descrambled `blk05a00000.OE.0106` block.
Trace ids are the numbers each MDET function passes to its logger `0x50804560` / `0x508047a7`; they run in the order
of the debug name tables at `0x509b8988..0x509bec00` (section 2.1).

## 1. In brief

1. **Hardware (D).** The network does not run on CPU 3's instructions: it runs on a dedicated engine, **DML**, at
   `0x9c180000` (clock 50, `CLKDML`; IRQ 285), which CPU 3's MDET_DL code programs with about 970 registers and starts
   with one write. Two more engines serve detection and tracking: the **PDT / TRC** unit at `0x9be00000` (clock 49
   `CLKSYS_F_DET`; IRQs 279 and 278 on CPU 3) and, on E143 only, two **face engines** at `0x99600000` and
   `0x99a00000` (IRQs 286 / 287 on CPU 3). The motion engine **EMS1** at `0x9bd80000` (clock 47 `CLKDETA`, IRQ 276)
   belongs to the ISP front end and feeds the tracker. CPU 3 runs the control, post-processing and tracking code
   (MDET, LAF, FACE: about 120k instructions); none of it is a CPU neural network.
2. **Models (D, X).** The learning data is resource group `0x800f` of the large-data block (`blk05a00000`): region 11
   at body offset `0x3dfffe0`, five items of 9,383,936 bytes, one per subject kind (motorsport, aircraft, train,
   bird, animal), loaded one at a time by MDET_DL_LDL. E146 and E147 carry the same five items byte for byte plus a
   sixth (HUMAN). The items have no header: the layer structure is not in them but in the MN code that builds the
   DML registers (I). E143's face dictionary is group `0x800b` (two items, 107,008 and 57,856 bytes), byte-identical
   on E144, E139 and E134 and absent on E146 / E147.
3. **Interface (D).** CPU 0's TAKE module drives detection through seven calls (`mdet_dl_start` .. `mdet_dl_save_exif`,
   `0x5080a5e2..0x5080ab02`); take_mov offers each live-view YC frame (`0x503a4e2d` -> `0x5080a912`). Results are
   per-subject records (kind; body box; two part boxes, each with reliability and a detected flag), consumed by the AF
   module's coordinate code (`fcs_coordinate_set_af_point_mdet_dl_body / parts1 / parts2`), by MDET's frame table
   for DISP_FRAME (UP_FACE, `0x50025747`) and by EXIF.
4. **Plan (I).** A display-level stand-in (synthetic subject frames from S-SCENE into DISP_FRAME) is about a week;
   a stand-in at MDET's result seam needs a native AF module; a native MDET needs CPU 3 and a DML device model whose
   output heads are synthesised from the scene; a reproduced network in the style of e7-bird-network needs the layer
   schedule decoded from the register builders and the engine's arithmetic, which without an OM-1 to measure cannot
   be validated (section 5).

## 2. Units, tasks, cores and MMIO

| Unit | Core | Tasks (id, entry) | MMIO | IRQ | Clock (`0x50061c3a` id, sub) |
|---|---|---|---|---|---|
| MDET_DL, the subject network's control | CPU 3 | MDET_DL_REQ `0x3004`, MDET_DL_LDL `0x3005` (D, cores spec §4); entries MDET_DL_CPU3_SUBJECT_DE `0x5080bae8` and MDET_DL_CPU3_LARNING_DA `0x5080c8a1` (D, trace ids 602 / 612); REQ = subject detect, LDL = learning-data load (I, by name) | DML `0x9c180000` | 285 | 50 `CLKDML`, sub 0 |
| MDET main and events | CPU 3 | MDET_CALC_MAIN_CPU3 `0x3006` `0x50800b03`, MDET_E_SEND_CPU3 `0x3007` `0x50800fe2` (D, labels) | none | - | - |
| LAF tracking: PDT and TRC | CPU 3 | MDET_PDT_CPU3 `0x300a` `0x50842033`, MDET_TRC_CPU3 `0x300b` `0x50848822` (D) | `0x9be00000` | 279 (PDT), 278 (TRC) | 49 `CLKSYS_F_DET`, sub 5 |
| Face (E143) | CPU 3; FACE_BEAUTY on CPU 1 | FACE_FD `0x3008` `0x505174e7`, FACE_MAIN `0x3009` `0x50510b2d`, FACE_BEAUTY `0x100a` `0x50512a46` (D) | `0x99600000`, `0x99a00000` | 286, 287 | `0x50061b49(12, 1)` (`0x50524fc5`; the id-0 path, its name ?) |
| Frame vectors | CPU 0 | MDET_CALC_FLAME_VECTOR `0x45` `0x507fc402` (D) | none; fed by the imgpro core (`0x5049d873`, `0x5049fdf3` -> `0x507fc3c4`) | - | - |
| EMS1 motion engine (ISP front end) | CPU 0 driver | (the sensor block's driver `0x501a5bd1..0x501a8dec`) | `0x9bd80000` | 276 | 47 `CLKDETA`, sub 0 |
| Frame plane | CPU 3 | DISP_FRAME `0x300d` `0x5100d05a` (shutter spec §7 items 49-50) | VSC IMG3 | - | - |
| Not detection | CPU 2; CPU 3 | SDET `0x2010` (scene detection for the movie path, `0x5050cc2a..0x50510b2d`, no MMIO); FCS_IMG_4THCPU_MAIN `0x300c` (the AF library's CPU 3 part) | - | - | - |

**Clocks (D).** The clock dump at `0x519d5e01..` prints each clock's state by id through `0x50062f0d` with its name
(`0x51a2b503..`): 47 `CLKDETA`, 48 `CLKDETB`, 49 `CLKSYS_F_DET`, 50 `CLKDML` (and 70 `CLKGPU`). The id space is the one
of the clock-gate helper `0x50061c3a(id, sub, on)`: its other known users match the dump's names (17 `CLKAF` for the
lens, 105 / 106 `CLKMECHA` / `CLKMECPWM` for the shutter mechanism). Clock 49 is shared: sub 5 the PDT / TRC unit
(`0x507fa2bf`), sub 1 the CIC unit `0x9be80000` (`0x51017244`), sub 4 at boot (`0x500255a2`). Clock 48 sub 1 goes
with the AF library's unit `0x9bf00000` (`0x5095769d`), not with detection.

### 2.1 DML, the network engine (`0x9c180000`)

- **Identification (D).** The power-up `0x507f68c7` writes the gate pair `0x98800348` (bit 28, then bit 27), sets
  `0x9c180000 = 2`, turns on clock 50 (`CLKDML`), writes `0x9c181408 / 0x9c181418 / 0x9c18140c / 0x9c18141c = 1` and
  `0x9c181420 / 0x9c181424 = 7` between the lock calls `0x500640d4` / `0x500640de`, then bit 27 to `0x98800398`. The
  power-down `0x507f6949` mirrors it (`0x9c181400 / 410 / 404 / 414 = 1`, `0x9c181428 / 42c = 7`, clock 50 off,
  `0x9c180000 = 3`). The `0x9c1814xx` writes look like SRAM power / retention controls (I). No string names this
  driver; the name comes from the clock, and from the MDET_DL code that calls it (below). The fwmap label of
  gap@0x507f66d5, "DISP_SYNC device driver: 0x9c180000", is wrong for this part: the DISP_SYNC functions end at
  `0x507f68a5`, and the DML driver is `0x507f68a8..0x507f906b` (section 6).
- **Init (D).** `0x507f68a8` attaches IRQ 285 at level 5 with handler `0x507f6abd` through `0x50053f76` (attach on the
  calling core, `(0x8050)`), then powers the unit up and down. It is called through `0x507f906b` from the display init
  chain (`0x501e9719`) and from `dl_init_boot` (`0x5080b229`, trace id 598); which core finally owns IRQ 285 is ?.
  Decided for the lab (2026-11-07, section 5.3): CPU 3. dl_init_boot runs lazily on CPU 3, at MDET_DL's first request
  (its callers are the ring function `0x5080b987` and MDET_DL_REQ's entry, `0x5080ba0a`, `0x5080baf7`, D), after the
  CPU 0 boot chain's call, and the attach is exclusive, the last caller's core taking the IRQ (cores spec section 4,
  D); that no later attach on CPU 0 follows is I.
- **Start (D, `0x507f69cb`).** Refuses when busy (`0xa33454f8`); keeps a completion callback and its argument (the
  request's `+36` / `+40` at `0xa33454f0` / `0xa33454f4`); opens gate bit 27 (`0x98800348`); then writes eight register
  groups from the eight pointers at the request's `+0..+28`, each by its own straight-line writer (`0x507f6b0e`:
  `+0x024..+0x050` and `+0x074..+0x248`; `0x507f7003`, `0x507f8318`, `0x507f76b0`, `0x507f7726`, `0x507f7f27`,
  `0x507f8eed`, `0x507f8ef7`), calls `0x507f8f64`, and starts: `+0x008 = 0xffff`, `+0x000 = 0`, `+0x010 = 1`, a read of
  `+0x004`, gate bit 27 to `0x98800398`.
- **Completion (D, `0x507f6abd`).** Reads `+0x004` and writes the value back (W1C, I); on bit 14 (`0x4000`) closes the
  gate, sets `+0x000 = 2` and calls the stored callback with 0. MDET's event `DL_CPU3_DML_COMPLETE` (names at
  `0x509c657f`) is the result (I).
- **Register map (D, from the constants the driver uses: 971 distinct addresses).** `+0x000..+0x248` control (136
  registers); thirteen blocks of the same shape at `+0x400 + 0x100 n`, n = 0..12 (53 registers each, `+0x00..+0xd8`,
  56 in the last); `+0x1100..+0x12bc` (112); `+0x1400..+0x142c` (12, the power writes above); `+0x1a08..+0x1aac` (19).
  What the thirteen blocks are (layers, DMA channels, tensor descriptors) is ?.
- **Code size.** The fwmap static pass finds only 88 instructions in 4 functions in `0x507f68a8..0x507f906b`; a linear
  disassembly finds about 2,150, mostly the eight writers (X). The writers are reached by plain calls from the start,
  so the static pass's miss is its own (I).
- **The MDET_DL side (D: trace ids 612-619 in function prologues, matched to the names at `0x509bdc0c..0x509bdd0a`).**
  `mdet_dl_cpu3_task_learning_data_load` `0x5080c8a1` (612); `learning_data_load` `0x5080c9b4` (613, section 3.2);
  `dml_start` (614), which calls `learning_data_select` `0x5080cbe9` (615), `dml_set_control_reg` `0x5080ccbe` (616),
  `dml_set_sp_reg` `0x5080dd8b` (617), `dml_set_sp_reg_norm` `0x5080e182` (618) and `dml_set_common_reg` `0x5080e2cc`
  (619: one function of 5,413 instructions, 3,737 of them `mov`s and 660 calls, the fwmap's "subject-detection network
  evaluation" guess; it fills register images, I), stores the output buffer's address `0xb64f5c80` in MDET's
  global `0x62f404e0` (beside `0x62f404da` and `0x62f404e4`; section 5.2), and starts the engine through `0x507f9099`
  -> `0x500503d4` -> `0x507f69cb` (`0x5080cb91`). The rest of the names (`dml_open` .. `change_parts_data`) are placed
  in section 5.2. Whether one start runs the whole network or one part of it, and what "study" configures, are ?.

### 2.2 PDT and TRC (`0x9be00000`)

- **Registers (D).** A common page `+0x000`, `+0x004`, `+0x010`, `+0x108..+0x16c` (the MDET clock and register control
  `0x507fa36d..`, "REG CLOCK ON/OFF": `+0x000`, `+0x2000`, `+0x3000` cleared, clock 49 sub 5 on, `+0x004` cleared); a
  page at `+0x2000..+0x225c` written by `0x507f91db..0x507f9b4d`; a page at `+0x3000..+0x362c` written by
  `0x507faa..0x507fbd64`. 558 distinct addresses in all (X).
- **Interrupts (D).** IRQ 279, handler `0x507f9b4d`, attached on CPU 3 at `0x507f9127`; IRQ 278, handler `0x507fbd0e`,
  attached on CPU 3 at `0x507fa992`. Each handler lies at the end of the code that writes one page, so 279 / `+0x2000`
  is PDT and 278 / `+0x3000` is TRC (I: by placement, and by the driver names' order, `pdt_drv_*` before `trc_drv_*`
  at `0x509be921..0x509beb6d`).
- **Roles (D from the names, I for the reading).** TRC is a colour tracker: `trc_tracking_color`, `get_most_color`,
  `calc_target_similar_color`, `set_initial_particle_pos`, `particle_pos_relocation` (a particle filter on colour, I).
  PDT feeds the face / body judgement (`mdet_laf_pdt_judge_face_body`, `_judge_face`, `_judge_body`,
  `mdet_laf_face_select_detect_result_fd / _bd / _pd`); what the letters stand for is ?. Requests `PDT:OFF / START /
  SET_INFO / END` (`0x50338118..`).

### 2.3 Face (E143)

- Two engines with one register shape (D): `0x99600000` (`0x505201bc..0x505202ed`: inputs at `+0x010..+0x040`,
  parameters at `+0x4004..+0x40c8`, start `+0x004` / `+0x00c`, a result address read at `+0x02c`) and `0x99a00000`
  (`0x50524fcf..0x505250d2`, the FACE OS layer with the FACE_PT queue: `+0x010..+0x040`, `+0x4004..+0x4020`, start
  `+0x004`). IRQ 287 is attached at `0x50524c61`, 286 at `0x50524d02`, both on CPU 3 (D); which IRQ belongs to which
  engine is ?. The first engine is the detector and the second the FACE_PT stage (I from the queue names FACE_FD /
  FACE_PT, `0x506b5fca..`).
- The dictionary is resource `0x800b` (section 3.4). The results MDET reads per face (D, the print at
  `0x50807b01..0x50807bcb`): validity, centre x / y, size, angle, confidence, pose; both eyes' centre and size, the
  gaze direction and the main eye.
- **E146 / E147 (X, D, I).** No constant of either face engine occurs in their main blocks (byte counts of
  `0x99600040`, `0x99a00040`: 0, against 1 on E143); there is no `0x800b`-shaped region in their `0106` blocks; their
  strings name `mdet_dl_detect_face`, `mdet_dl_face_get_data`, `mdet_dl_face_get_pt_data` and a request
  `FACE_STILL_START`. So on the Mark II and the OM-3 faces and eyes come from the DML network (I).

## 3. Where the models live

### 3.1 The large-data block's resource groups (D)

The body of `blk05a00000` (flags `0x0106`) starts with a region table, up to 64 entries of `{u32 flash address, u32
length, 8 bytes 0}` (E143: 12 regions); each region starts with its own 32-byte OE head (model, version `0x0100`, flags
6, checksum) followed by a directory of 16-byte entries `{u32 flash address, u32 length, 8 bytes}`. The flash
address of the block's head is its load field (`0x458c0000` on E143), so an item's body offset is its address minus
`0x458c0020`. The reader: `0x501a8d0b..0x501a8d9f` reads the 1024-byte table and then each region's directory (sizes
per slot at `0x502839d4`); `0x501a921f(group, item, dest, ...)` maps group `0x80NN` to a slot through the bytes at
`0x502839c3` (run-time `0x602a49e3`) and copies the item (`0x501a9633..0x501a96e5`, flash read `0x501a986a`).

| Group | Slot (E143 region) | Reader | Content |
|---|---|---|---|
| `0x8006` | 5 (`0xd00000`, 1 item of 2 MiB) | `0x5101cd90`, `0x518bca06` | ? |
| `0x8007` | 6 (18 items) | DSP service `0x50426241..` | DSP code (I) |
| `0x800b` | 7 (2 items) | FACE `0x505171d3`, `0x505171fa` | the face dictionary |
| `0x800d` | 8 (1 item) | `0x503f8cdb`, `0x519ed2af` | ? |
| `0x800e` | 9 | `0x5003b85c..` | the A53 bundle (consistent with `docs/a53-spec.md` §2: its items start at `0x29807e0`) |
| `0x800f` | 11 (5 items) | `learning_data_load` `0x5080ca1c` | the subject networks |

### 3.2 The learning data (`0x800f`)

- **Items (D, E143).** Region 11: flash `0x496c0000`, length `0x4b00000`, body offset `0x3dfffe0`; five items of
  `0x8f3000` = 9,383,936 bytes at flash `0x496c0800 + n * 0x8f3000` (body offsets `0x3e007e0 + n * 0x8f3000`),
  46,919,680 bytes in all.
- **Kinds (D).** The kind names at `0x50338100` (run-time `0x60359120`): 0 OFF, 1 MOTOR_SPORTS, 2 AIRPLANE, 3 TRAIN,
  4 BIRD, 5 ANIMAL; `0x50812dc9` maps kind 1..5 to item 0..4 and logs an error for any other.
- **Loading (D).** `learning_data_load` (`0x5080c9b4`) reads item `kind - 1` whole (size argument 0: the item's
  length) to `0x9511ca00` through `0x501a921f(0x800f, item, 0x9511ca00)` and checks the returned `{address, size}`.
  One destination, so one kind is resident at a time and a change of kind reloads 9.4 MB (I). What memory the
  `0x95xxxxxx` window is (DRAM alias, the engine's own memory) is ?.

### 3.3 What an item looks like (X, D; nothing extracted)

- No header or magic: the first bytes are already data (D).
- The first `0x2000` bytes are 256 rows of 32 bytes, each one 8-byte group repeated four times; a group is three
  16-bit values and a zero 16-bit word (D: byte pattern). A first layer over three input planes padded to four, laid
  out for a four-lane engine, would look like this (I).
- From `0x3000` to about `0x880000` the bytes have 6.0-6.8 bits of entropy per byte with 5-18% zero bytes, rising
  toward the end (X, per-256 KiB statistics); that fits 8-bit quantised weights better than 16-bit or float data (I).
- The last `0x3a000` bytes mix repeated-group rows (about 22% of rows) with other data, and the item ends in zero
  padding (X).
- So the layer schedule (shapes, strides, activations, the order of the passes) is not in the item. It is either in
  the register images MDET_DL builds (section 2.1) or in tables the builders read (I); decoding it is open (U3).

### 3.4 The face dictionary (`0x800b`, E143)

Region 7: two items, 107,008 bytes at flash `0x48140400` and 57,856 bytes at `0x4815a600` (D), read by FACE to DRAM
`0xa54b0b40` (item 0) and `0xa5431680` (item 1), each `res_size + 1024` bytes (`0x505171b4..0x505171fa`, D).

### 3.5 Across bodies (X: `0106` tables walked and items hashed in place; D: strings and constants)

| Body | Subject networks | Face dictionary | DML / PDT constants in the main block |
|---|---|---|---|
| E143 OM-1 v1.9 | region 11: 5 items, sha256 prefixes `3726ebaa`, `7d276839`, `43800f7e`, `7476ac5a`, `dff22d67` | region 7, `dc73bdff` / `5d70e52b` | yes |
| E146 OM-1 II v1.3 | region 10: the same 5 items plus a sixth, `80f84772`; kinds MOTOR_SPORTS .. ANIMAL, HUMAN (D, `0x509dce1c`) | none | yes (no face-engine constants) |
| E147 OM-3 v1.1 | as E146, the same six items | none | as E146 |
| E144 OM-5 v1.2 | none | the same two items | none (its SoC's map differs, I) |
| E139 E-M1 III v1.6 | none | the same two items | its main block is partly compressed, so the string test says nothing; ? |
| E134 E-M1X v2.4 | none in `0106`; a block of flags `0x010f` (load `0x523e0000`, 10 MB) whose table lists three items of 1,397,760 bytes and a small fourth, and a block `0x0111` loaded at `0x90000000` (4 MB) | the same two items | none; its own `mdet_dl_*` names (`start_tracking`, `stabilization`, `supplement`): an earlier lineage, not surveyed |

The OM-1's subject networks did not change from E143 v1.9 to E146 v1.3 and E147 v1.1 (X); the face dictionary is the
same file from the E-M1X to the OM-5 (X).

## 4. The interface to the rest of the camera

### 4.1 Requests into MDET (D)

The CPU 0 API, trace ids 588-594 in the order of the names at `0x509bd934..0x509bd9de`, each posting a request of the
kind in `0x503380e0` (OFF, START, END, CHANGE_MODE, NOTIFY_START_STILL, OFFER_YC_DATA, NOTIFY_1ST_AFL, SAVE_EXIF)
through `0x5080ad65` toward CPU 3 (`mdet_dl_cpu3_dispatch`, `0x5080aed5`, cores spec §5.2):

| Function | Entry | Caller (fwmap edges) |
|---|---|---|
| `mdet_dl_start` | `0x5080a5e2` | TAKE_MOV `0x506da276` |
| `mdet_dl_end` | `0x5080a6dc` | take_mov `0x503a4392` |
| `mdet_dl_change_mode` (the kind) | `0x5080a79a` | take_mov `0x503a48ac` |
| `mdet_dl_notify_start_still` | `0x5080a875` | take_mov `0x503a51b6` |
| `mdet_dl_offer_yc_data` | `0x5080a912` | take_mov `0x503a4e2d` |
| `mdet_dl_notify_1st_afl` | `0x5080aa6b` | TAKE_FUNC `0x5039cf71`, `0x5039deaf` |
| `mdet_dl_save_exif` | `0x5080ab02` | takepic `0x503bd1fa` |

The names-to-entries match rests on the consecutive trace ids (I, strong). Other entries into the block: the motion
vectors from the imgpro core (`0x507fc3c4`), SDET (`0x5081cb85`, `0x5081cd3e`), EXP (`0x5081e39b` from `0x5059925b`),
the lens driver (`0x50817e11` from `0x5013f077`) and the init chain `0x501e94a5` (DML, PDT and MDET inits).

### 4.2 The input image

- take_mov's frame handler `0x503a4eef` calls `0x503a4e2d` when `(0x62a41182)` bit 1 is set; it packs a record from
  its context (the frame counter `+1376`, a buffer descriptor at `+808` with halfwords at `+8..+14` and bytes at
  `+16..+18`, a 15-word block at `+852`, two flags from `+1362` / `+1363`) and offers it (D).
- MDET's print of the offer (`0x50809cd5`, `0x50809d1c`, D) names the fields: `free_run`, `buff_id`, `digi_tel`, `w`,
  `h`, then `ae`, `en`, `mag`, `movie`, `mis`, `qm`, `aspect`, `cap`. Which record field is which is I.
- The image is a YC (YCbCr) live-view buffer, kept in a queue (`get_last_yc_data_que`); coordinates are converted
  between it and the sensor's Bayer frame (`convert_yc_to_bayer_lv`, `mdet_laf_convert_bayer_to_dist`) (D, names).
  Its size, format and the imgpro stage that writes it are ?; S-SCENE renders YC 4:2:2, which is at least the right
  family (I).

### 4.3 Outputs

- **Subject records (D, the prints at `0x5080a11d..0x5080a193`).** Per subject `sbj[n]`: `sbj_kind`; `body` x, y, w,
  h, rel (reliability), dtct; `parts[0]` and `parts[1]` with the same six fields. The tracker's state record
  (`0x509bb1a1..0x509bb3f9`) adds `tracking_subject_type`, `dl_kind`, `dl_target_part`, `dl_detect[0..2]`,
  `dl_cp_part2_to_body_flg`, `power_saving_flg`, `face`, `eye`.
- **AF (D).** The AF module's coordinate code takes them as AF points: `fcs_coordinate_set_af_point_mdet_dl_body`,
  `_parts1`, `_parts2`, beside `_mdet_tracking`, `_eye`, `_touch_face` (names at `0x509fd108..`, table `0x508c4754`).
  LAF gives FCS its coordinates (`mdet_laf_get_fcs_coordinates`) and AF gives LAF its state back
  (`mdet_laf_set_fcs_af_info`, `mdet_laf_set_fcs_ip_info`).
- **Display (D).** DISP_FRAME's request types (`0x50344830..`): UP_FACE, UP_LOCKON, UP_AF, UP_ASSIST, with draws
  `draw_face`, `draw_lockon`, `draw_aftarget`, `draw_assist`, `draw_afmark`. On CPU 0 they are `0x50025747` (UP_FACE,
  flag 1, no data), `0x50025764` (UP_LOCKON, 5 halfwords to `0xa3209014`, flag 2), `0x500257ce` (UP_AF, the upload
  S-AFOSD uses) and `0x50025799` (UP_ASSIST, 4 halfwords to `0xa320b108`, flag 8), all waking DISP_FRAME through
  `0x5002588e`; each acts only when the frame mode `0xa3209010` has its bit (1, 2, 4, 8; D, the `btst` at the head of
  each). MDET posts UP_FACE (`0x5082afee`, `0x50839dba`) after writing its frame table at `0xa337efa1..` (section 5.1:
  its layout, and DISP_FRAME's read of it through FACE's `0x5052202c` and MDET's getter `0x5083a299`); FACE posts it
  too (`0x5051c6e9`, `0x5051c9ee`). Corrected 2026-10-27: the survey read the UP_LOCKON and UP_ASSIST destinations as
  `0xa3208c14` and `0xa320ad08` (the `mov imm32` values are `0xa3209014` and `0xa320b108`), and the table as starting at
  `0xa337efb2`, which is its second record's flag.
- **Other (D, names).** EXIF (`mdet_laf_deeplearning_info_exif`, `mdet_laf_detectiontarget_info_exif`); a power
  saver that stops the network while nothing is detected (`mdet_power_manager_judge_dl_power_saving`, the print at
  `0x509c85ef`); a card logger (`MDETDATA`, gap@0x50816fed).

### 4.4 Seams

| Seam | Where | Needs | Stand-in |
|---|---|---|---|
| S1 display | DISP_FRAME's inputs: MDET's frame table + UP_FACE, UP_LOCKON | what exists now (S-DISPFRAME runs DISP_FRAME on the lab CPU) | synthetic frames from the scene: S-SUBJECT (5.1) |
| S2 MDET result | `mdet_laf_*` getters FCS calls; the subject record (4.3) | native FCS (AF module) | S-SUBJECT returns scene-derived records |
| S3 DML device | `0x9c180000`, IRQ 285, the output buffer | CPU 3 natively; the `0x800f` read path; the output head layout | S-DML: on start, write heads that decode to the scene's boxes (its register file since 2026-11-07, 5.3; the scene's boxes as its records, 5.4) |
| S4 the network | the engine's arithmetic | layer schedule, numerics | a reproduced DML (5, step D) |

## 5. Feasibility and plan (I)

| Step | Content | Depends on | Size | Retires / adds |
|---|---|---|---|---|
| A | S-SUBJECT at seam S1: S-SCENE's layers report screen boxes (the rider, the ball) with a kind; when the camera's subject-detection setting is on, write MDET's frame table and post UP_FACE (and UP_LOCKON for the tracked one) so DISP_FRAME draws subject frames natively, as S-AFOSD does for the AF frame | static: the frame table's record layout and how DISP_FRAME reads it (U1); the setting's property and its value per kind (U2) | about 1 week; done 2026-10-27 (5.1: UP_FACE only, UP_LOCKON is the AF module's) | adds S-SUBJECT; nothing retires |
| B | S-SUBJECT moves to seam S2: the subject records answered to the AF module, which then chooses the AF point and uploads frames itself | native AF module (hle-gaps 4.4: TakeReady, CPU 1 and 3; months) | 2-3 weeks after that | S-AFOSD's frame part and step A's display writes |
| C | MDET natively on CPU 3 with S-DML: a register-file model at `0x9c180000` (start `+0x010`, status `+0x004` bit 14 W1C, IRQ 285, the gates and clock 50), the `0x800f` load through the flash-read path, and on each start output heads synthesised so that MDET's own `get_dml_result` / `judge_dml_result` / stabilisation produce the scene's boxes | ROADMAP HLE step 4 (CPU 3); a flash read model or a resource reader at `0x501a921f`; the output head layout read from the post-processing code (U4); PDT / TRC and, on E143, the face engines as models or stand-ins | 4-6 weeks after CPU 3; part 1 (MDET_DL native at single call sites, S-DML with an empty output, the load stubbed) and part 2 (S-DML's records from the scene) done 2026-11-07 (5.3, 5.4) | S-SUBJECT retires; adds S-DML (and S-FACE on E143) |
| D | A reproduced DML: run the real network on the frame | the layer schedule from the register builders (U3); the engine's arithmetic (U5); a reference to check against | months; bit-exactness ? | S-DML's synthetic heads |

Notes on D, against the e7-bird-network work: there the model resource carried its own command stream, and the
accelerator's numerics were fitted to outputs captured on a real camera. Here the item carries only parameters; the
schedule must be recovered from the register-image builders (`dml_set_common_reg` alone is 5,413 instructions, section 2.1), and the engine's
rounding, accumulation and activations are unknown. Without an OM-1 to capture DML outputs, a float approximation
could at best give plausible boxes, never a checked equivalence. The weights stay in the user's firmware file: an
emulator would read them at run time like the rest of the image, and none enter the repository.

Risks: the DML window `0x95xxxxxx` and the feature-map area `0x94a12a00` (section 5.2) may need memory the lab does
not map (U6); which core owns IRQ 285 (2.1); each kind change reloads 9.4 MB, which matters for the time model only.

### 5.1 Step A: the frame table, the setting and S-SUBJECT (2026-10-27)

Read statically in the VM's objdump, then checked by running the code in the lab (X where marked).

**MDET's frame table (U1, D).** The writer (`0x5082ac64..0x5082af98`, which ends in UP_FACE) and the getter
`0x5083a299` (trace id 227) agree on this layout:

| Address | Field |
|---|---|
| `0xa337efa1` | main record valid (byte) |
| `0xa337efa2..0xa337efb1` | main record |
| `0xa337efb2` | part record valid |
| `0xa337efb4..0xa337efc3` | part record |
| `0xa337efc4` | list count (byte) |
| `0xa337efc6 + 16 n` | list record n, n < 8 |

A record is four corners `(x, y)` as halfwords in the order top left, top right, bottom left, bottom right: the writer
builds each list record from a box `{x0, y0, x1, y1}` at `0xa33790b2 + 8 n` (valid when `0xa337d53c + n` is 1,
`0x5082af40..0x5082af91`), the main record from subject 0's box or from a centre and size at `0xa3379060..66`
(`0x5082ad59..0x5082ae6e`), the part record from `0xa33790f2..f8`. It fills the main and part records only while the
byte `0xa337f082` is 1 (`0x5082acb3`, `0x5082ad02`, `0x5082ae7d`), and the list then starts at subject 1; otherwise every
subject is a list record. What `0xa337f082 = 1` is (a selected or tracked subject, I) is open (U9).

The getter fills a 166-byte record for its caller: +0 an aspect code from the byte pair `0xa3378119` / `0xa337811a`
((4, 3) 1, (3, 2) 2, (16, 9) 3, (6, 6) 4, (3, 4) 9, (17, 9) 10; another pair is logged and gives 1,
`0x5083a368..0x5083a420`), +1 / +2 the main record, +18 / +20 the part, +36 the count, +38 the list. It gives code 1
and no records when the byte `0xa337f084` (`0x50839ed0`, MDET running, I) is not 1 or the pair and the halfword
`0xa3378116` are all zero, and a count of 0 when `0xa337f07a` is 0 and `0xa337813f` is 1, or `0xa337bbdc & 6` is 2 or 6.

**How DISP_FRAME reads it (U1, D).** DISP_FRAME's draw (`0x5100d99e`) runs draw_face (`0x5100d751`) when bit 1 of its
pending mode is set (`0x5100dc03`). draw_face asks FACE's `0x5052202c` for an 88-byte record: FACE's own double buffer
(`0xa32f3d54 + 88 x`, by `0xa32f3e04`) when FACE's mode byte `0xa32f3e06` is 1, else MDET's getter, each record turned
into a centre, width and height by `0x50523fe3` (`x0 + (x1 - x0) / 2`, `y0 + (y2 - y0) / 2`, `x1 - x0`, `y2 - y0`):
+0 / +2 main, +10 / +12 part, +20 count, +22 + 8 n the list, +86 the aspect code. draw_face takes the records only when
that code equals the draw buffer's +12781, DISP_FRAME's own aspect code (`0x5100d469`: in still shooting the value of
the settings object `0x3081`, settings id 269; in movie mode, `0x506e6475`, 1, 3 or 10 from the objects `0xf021` and
`0xf031`). `0x5100dfef` then makes the frames: each list record kind 1 colour 3, the main record kind 7 colour 4 (when
fewer than 8 frames), the part kind 8 colour 4 when the mode has bit `0x10` (TAKE's request 32); x is mirrored to
`640 - x` under mode bit `0x80`. `0x50025a8a` takes each to its top left (`centre - (size / 2 - 1)`) and through the
output's transform (`0x500259bd`: `v * num / den + offset` per axis, clipped by `0x50025963`), a 24-byte row
`{width, height, x num, x den, y num, y den, x offset, y offset, clip x0, y0, x1, y1}` of the table `0x60365754`: a
pointer per output, indexed by `0x500258e8(output state, object 0x8971's value, 0x500258d4())` (the draw buffer's
+12780, +12782, +12783), and a row per aspect code (`0x50025931`: 1, 3, 2, 4, 9, 10 -> rows 0..5). `0x510161c6` draws
them (I). The TFT's rows: 4:3 `{900 x 600, x 10/8 + 50, y 10/8, clip 50..850 x 0..600}`, 16:9 `{45/32, y - 37, clip y
47..553}`, 1:1 clip x 150..750, 3:4 clip x 225..675 (D, the table). So MDET's coordinates are a 640 x 480 frame for
every aspect with the image letterboxed in it (I; the mirror at 640 agrees). On the panel colour 3 is grey 170 and a
list frame a 2-pixel rectangle (X).

**The setting (U2, D).** Subject detection is settings id 1682, the data object `0x1e71` (six values, default 0).
TAKE reads it through the property read `0x500417da(0x1e71, 0, 0)` (`0x5039ac9b`, `0x5039bb08`, `0x506d8017`) into
its context +206 and hands it to take_mov (`0x503a4882` stores `0x62a411a3`), whose `0x503a48ac` calls
`mdet_dl_change_mode` when MDET runs and the kind changes from one kind to another; the values are MDET's kinds
(`0x50338100`): 0 OFF, 1 MOTOR_SPORTS, 2 AIRPLANE, 3 TRAIN, 4 BIRD, 5 ANIMAL. X: at 1 the shooting screen shows its
motorsport icon. How `mdet_dl_start` gets the first kind (TAKE_MOV `0x506da276`) is not read.

**The frame mode (D, I).** The subject frames' bit 1 is TAKE's request 1 (`0x5039f583`). TAKE's live-view request
`0x506d8dea` sets it unless one of its conditions clears it (`0x506d8e8f..0x506d8f3b`, among them the AF module's
answer through `0x506eab07` and fields of TAKE's records), adds request 2 (lockon) when the AF module's answer through
`0x506eac4f` has bit 0 and request 4 (AF frames) with its bit 1. The lab's S-TAKEFRAME sets mode 4 (shutter spec
section 7 item 50, I); without bit 1 no subject frame is drawn (X).

**UP_LOCKON (D).** take_mov's `0x503a4d99` posts it with the record MDET's `0x5082e2c0` fills (halfwords +4, +6,
+12, +14 and the byte +10, a state), when its record's +24 is 1 and the AF module's answer through `0x506eac4f` has
bit 0; draw_lockon (`0x5100d7e7`) draws one frame whose colours follow the state (1: 3 and 6, 2: 5 and 7, other: 0
and 1; 0: none). So the tracked subject's frame is the AF module's request (step B); step A does not post it.

**S-SUBJECT (step A).** `emu/src/lab/subject.mjs`, with the firmware's side in `emu/src/fw/models.mjs` `subject`
(E143). After lab time passes, with the application on its shooting screen and S-SCENE's live view showing the live
scene, it reads the setting through the property read as TAKE does; for a kind (1..5) it takes S-SCENE's subjects of
that class (`scene.mjs subjectsAt`: the rider stands for motorsports, the harness's choice), places each where the lab
shows S-SCENE's frame on the panel, takes it into DISP_FRAME's plane and back through the transform DISP_FRAME will use
(read with the firmware's own index and row functions), and writes them as list records, larger first; the main and
part flags 0; the aspect pair whose code equals DISP_FRAME's (`0x5100d469`, run natively); `0xa337f084` 1; the frame
mode with bit 1 added (I); then UP_FACE (`0x50025747`) natively. It writes again when the boxes, the kind or the output
change, at most once per S-SCENE frame step (1/15 s of lab time; S-SCENE now renders a moving scene at the step's start
so that both agree); at OFF, another kind with no subject, the menu, a rec view or playback it empties the table, posts
UP_FACE and takes the bit away. Labels: the record layout, the getter's conditions, the aspect map, the transforms and
the setting are D; the scene's subjects and their class are the harness's; list records rather than a main record, the
mode bit's timing and MDET's aspect pair are I.

Evidence (X, E143): on the TFT the firmware draws a grey 2-pixel frame on the rider (4:3: MDET box `204, 203, 436,
447`, drawn at x 306..596); with the rider moving at 3 m/s the frame moves with it frame step by frame step, clipped
at the 4:3 area's edge; at 16:9 and 3:4 the frame follows the letterbox's clip; on the EVF it lands on the rider too
(the plane drawn at twice its size); at BIRD or OFF there is none; S1 adds S-AFOSD's green AF frame beside it.
`emu/test/test_subject.mjs`: the subject box against the pixels S-SCENE renders, the transform taken back and forward,
and in play the drawn frame's four edges on the rider's panel box (at least 70% of each; the GUI's exposure scale
covers part of the bottom edge), absent at OFF and BIRD, moving with the rider, and a `--replay` ending on the same
frame. Without the mode bit, or with an aspect pair of another code, the same session draws nothing (X, the controls
run by hand).

### 5.2 U4: the output heads (2026-11-07)

Read statically in the host's objdump (`tools/mn10300dis.sh`) with scratch scripts that walk the register-image builders
and join them with the driver's writers; nothing was executed. E146 v1.3 was read beside it as a second witness.

**In brief.** The engine finishes the head itself: the anchor decode, the activations and a candidate list per class.
MDET reads back boxes, not tensors: 9 classes x 32 records x 16 bytes at `0xb64f5c80`, each `{score, h, w, cy, cx}` in
MDET's 640 x 480 frame with the score in Q12. A slot whose score is 0 is empty; there is no count or status register.
No sigmoid, exponential or anchor arithmetic runs in software (D for what MDET does, I for what the engine does inside).

**Functions (D, trace ids 600-630 against the name table at `0x509c08c0`).** dl_init_start `0x5080b8af` (600: it
clears the class lists), dml_open `0x5080c561`, dml_close `0x5080c62c`, dml_start_callback `0x50812052` (620),
dml_set_control_reg_work / _study `0x5080dc1d` / `0x5080dcd4`, get_dml_result `0x50812124`, get_dml_data_set
`0x50812435`, get_index_yc_aspect `0x5081255c`, change_parts_data `0x50812698`, judge_dml_result `0x508127db`,
delete_result / _ip_area / _detect_area `0x508128c3` / `0x50812990` / `0x50812b1d`.

**The buffer (D).** The engine's address registers hold byte address >> 4: the input Y and C planes go to
`0x9c180024` / `0x9c180030` as `yc >> 4` and `(yc + 640 x 480) >> 4`, with strides `0x9c180028` / `0x9c180034` = 40
(`0x5080cd6d..0x5080cd9a`). dml_set_control_reg stores the constant `0x0b64f5c8` to slot 1 +688 (`0x5080cdb3`), which
the slot-1 writer puts in **`0x9c181118`** (`0x507f7699`); dml_start stores `0xb64f5c80` to MDET's global `0x62f404e0`
(`0x5080cb66`), which get_dml_result reads. `0x9c18111c` = 32 (object 0x3be4 [2457]) matches MDET's per-class count
`(0x62f2395e)` = 32 (object 0x61a4 [1181], dl_prm_init `0x5080b3c2`); `0x62f404da` = 9 classes (`0x5080cb89`, for
every kind); `0x62f404e4` = 512 bytes per class is only logged. The buffer lies in the DRAM the lab maps
(`0xa0000000..0xb8000000`, `emu/src/fw/place.mjs`). E146: the same layout at `0xb64af780` (`0x50819c68`), 9 classes
for all six kinds.

| Record +k (u16, little-endian) | Mask | MDET's use (get_dml_data_set `0x508124de..0x5081250d`, get_dml_result) |
|---|---|---|
| +0 | `0x1fff` | score s; entry score = `s * 255 >> 12` (`0x508122b2`): 4096 -> 255; 0 = empty slot |
| +2 | `0x3ff` | h, made even (odd -> minus 1) |
| +4 | `0x3ff` | w, made even |
| +6 | `0x3ff` | cy; in movie mode remapped (below) |
| +8 | `0x3ff` | cx |
| +10..+15 | - | not read |

Record j of class c is at `base + 16 (32 c + j)` (D, the running index `0x50812296..0x508123cf`). get_dml_result writes
slot j's entry at slot j of class list c (`0x62f241ac + 1028 c + 4 + 32 j`) but counts only the non-zero ones, and the
area filters walk the first *count* slots (`0x50812a1c..0x50812ab4`), so the records must be packed from slot 0 (D;
that the engine packs them is I). cx / cy are the centre: they are tested against the x / y bounds of every area and
paired with w / h as centre +- size / 2 in calc_intersect `0x5081661b` and in the clamp at 639 / 479 (`0x50814972`) (D).

**The engine's head (X, the walked register images; I for meaning).** The thirteen `+0x400 + 0x100 n` blocks are stage
descriptors; nine are used, each with an input and an output in a work area at `0x94a12a00` (`_work`: obj +
`0x094a12a0`, `0x5080dc81`), weights at item +0, +0x2400, +0x4800, +0xd800, +0x31800, +0xc1800, +0x1e1800, +0x421800,
+0x8a1800 and per-stage parameters at item +0x8f1800..+0x8f2680 (`_study`: obj + `0x09511ca0`, the learning data at
`0x9511ca00`), the output of one being the input of the next (a lead for U3). The head stage takes stage 8's output
(`0x9c181104` = `0x94e7b600`, strides `0x9c181108` / `0x9c18110c`), writes the records (`0x9c181118`, `0x9c18111c`), and
is configured by dml_set_sp_reg and the kind block: `0x9c1811c4` = `(480 << 16) | 640`, the 20 per-kind "bias" words at
`0x9c1811c8..0x9c181214` (dml_set_sp_reg `0x5080df6c..0x5080e12d`: ten widths then ten heights in Q16, I; items 0, 1,
2 and 4 share one block, BIRD has its own; the heights are scaled by 360 / 480 and 340 / 480 for aspects 1 and 2), and
three breakpoint / slope tables at `0x9c181120..0x9c1812bc` whose slopes rise and fall symmetrically (0xae, 0x1334,
0x617c, 0x1334, 0xae), the shape of a piecewise-linear sigmoid (I). `0x9c181100` = 0x14, `0x9c181110` = 0xa and
`0x9c181114` = 0x08ca000f are ?.

**Aspects (D).** get_index_yc_aspect wants a 640-wide YC and gives 0, 1, 2 for heights 480, 360, 340, else 3
(`0x508125ad..0x5081262c`); dml_set_sp_reg returns early on 3. The resize words (`0x9c180074..`, `0x9c180100..`) give
640 x 480, 640 x 360, 640 x 340 with a vertical factor 0x1000, 0xc00, 0xb55 (I: the input stretched into a 480-row
frame). The record layout is the same for every aspect. In movie mode (the offered record's byte +25, which
calc_disp_area_lv `0x508131c5` reads as the movie flag, I) get_dml_result remaps `cy' = (cy - 240) * 360 / 480 + 240`
for aspect 1 and `* 340 / 480` otherwise (`0x508122d5..0x50812308`), and leaves h alone: the engine's cy is in the
480-row frame, its h already letterboxed (I, with the scaled anchor heights). Movie shapes are 16:9 and 17:9 (I).

**Completion (D).** dl_init_boot copies the request `0xa3375c78` from ROM `0x609e9bf8` (`0x5080b2e0`): seven image
pointers, slot 7 empty, +36 = `0x60833072`, the run-time address of dml_start_callback. The IRQ handler `0x507f6abd`
calls it with 0; it sets event flag `(0x600436d6)` bit 4 (`0x508120c5`), on which offer_yc_data waits with timeout -1
right after dml_start (`0x5080c20d..0x5080c224`; -1 read as "forever", I). One start, one wait, then the buffer:
MDET reads no engine register after IRQ 285, and the driver reads only `+0x004`.

**From records to subjects (D; the parameters are object 0x61a4's ROM image, identical for the five kinds, X).**

1. Post-processing runs only when the FCS flag `(0xa3376b54)` equals the record's byte +25 (`0x5080c304`). Order:
   get_dml_result, change_parts_data, judge_dml_result, stabilization, combination, calc_offer_data (`0x5080c33a..`).
2. change_parts_data: kind 2 only, swaps the entries and counts of classes 7 and 8 (`0x508126e5..0x50812788`).
3. judge_dml_result: a per-kind class mask (`0x62f2395f + 20 item`, all 0), then the IP area and the detect area from
   FCS (`0x508c0139` -> `0x5099d8ab`, `0x5099dbf2`: x 0..639, y 0..479, or y 36..443 when object 0x85b1 reads 5). No
   score threshold.
4. stabilization: per class up to 50 tracks; a detection matches a track when its centre is within w / 2 + 100 and
   h / 2 + 100 of it, the area ratio is 30..300 %, the mean area at least 100 px^2 (classes 0, 3, 6) or 10, the mean
   score at least 50 (`0x50813d79..0x50813eb2`). A new track needs 6 hits to register ([915]; 10 when the score is
   <= 100 and the area <= 37,200 px^2; `0x5081455a`), so a box first seen in one pass reports in the seventh (I from the
   order). A registered track survives 8 missed passes ([905]; 4 or 6 for small or weak boxes), an unregistered 4.
   The eight best registered tracks per class with the centre in the display area (calc_disp_area_lv `0x5081303c`:
   e.g. 4:3 {0, 0, 640, 480}, 16:9 still or movie {0, 60, 640, 420}, 17:9 {0, 70, 640, 410}) go on (`0x50814b5b`).
5. combination: classes 3g, 3g+1, 3g+2 are the body and two parts of group g = 0, 1, 2 (`0x50815041..0x508151bd`);
   a body alone makes an entry; parts pair with bodies through judge_comb / judge_parts_comb (not read in detail).
6. calc_offer_data: bodies, then lone part 2, then lone part 1, by score, at most 24; set_subject_detect_result
   `0x50816d37` writes 8 records of 32 bytes at `0xa3376b5c` (after a word at `0xa3376b58`): +0 sbj_kind, +2 body
   `{cx, cy, w, h, rel (score byte), dtct (1)}`, +12 part 1, +22 part 2. sbj_kind = `6 + 3 (kind - 1) + g`
   (get_subject_kind's table `0x609e9ce0`); no string names the fifteen sub-kinds. offer_yc_data then hands
   `0xa3376b58` to `mdet_laf_dl_set_subject_detect_result` `0x50839ede`, which copies 272 bytes to `0xa337b1e4` and runs
   LAF (`0x50839934`); LAF's step to the frame table of 5.1 is not read.

Corrections to 2.1: the word dml_start stores is `0xb64f5c80` (not `0xb64e7c80`, which occurs nowhere in the block),
the output buffer rather than a work area, and `0x62f404da..0x62f404e4` are MDET's globals, not the request; "study"
is the learning data's address and "work" the feature-map area; the names listed as unplaced are placed above.

#### 5.2.1 What S-DML must write

1. **When.** On `+0x010 = 1` (after the driver's writes): fill the buffer, then set `+0x004` bit 14 and raise IRQ 285.
   Without the interrupt MDET waits forever (its timeout argument is -1; I).
2. **Where.** `(0x9c181118) << 4` (E143 `0xb64f5c80`), `(0x9c18111c)` = 32 records per class, 16 bytes each, 512
   bytes per class, classes 0..8: 4,608 bytes. Zero all of it on every start.
3. **Layout per aspect.** The same for all aspects. Per class, records packed from slot 0; u16 little-endian: +0 score
   (13 bits; use 0x0d00..0x1000, i.e. 207..255 after scaling: above 100 the 6-hit rule applies, and at most 4096
   the byte `rel` does not wrap), +2 h, +4 w, +6 cy, +8 cx (10 bits each), +10..+15 zero.
4. **One box of kind K (1..5), sub-kind group g (0..2), at the 640 x 480 rectangle {x0, y0, x1, y1}.** Class 3g, slot
   0: cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0 and h = y1 - y0, both even. Still mode (record byte +25 = 0):
   as is. Movie (byte +25 = 1, YC 640 x 360 or 640 x 340): cy = (cy' - 240) * 480 / 360 + 240 (or 480 / 340), h as is.
   The centre must lie in the display area of the aspect code (`0x50813159`) and in x 0..639, y 0..479. Parts, if
   wanted: classes 3g + 1 and 3g + 2, and for AIRPLANE the network's 7 and 8 are MDET's 8 and 7.
5. **How long.** The same box (centre within w / 2 + 100 px, area within 30..300 %) on at least seven consecutive
   starts; MDET then reports at `0xa3376b5c` a record with sbj_kind `6 + 3 (K - 1) + g` and body {cx, cy, w, h, rel =
   the scaled score, dtct = 1}. It keeps reporting for up to 8 starts after the box stops.
6. **Still open, and what blocks a drawn frame.** (a) LAF from `0xa337b1e4` to the frame table
   (`mdet_laf_calc_not_tr_dl` `0x50837b05`, gate `0xa337f082`, U9): until it is read, S-DML can be checked at
   `0xa3376b5c`, not on the panel.
   (b) The FCS calls MDET makes on CPU 3 (`0x508c0139`, and `0x508c1de0` -> `0x509b1bc5` / `0x509b08b9` for the movie
   flag) must run or be answered, and the flag must equal the record's byte +25. (c) The power saver (`(0xa337f08b)`,
   `0x5085507a`) skips the engine after five passes of its idle condition; what feeds it is ?. (d) The weight load to
   `0x9511ca00` and the work area at `0x94a12a00` lie in the `0x9xxxxxxx` window the lab does not map (U6); S-DML
   needs neither, but learning_data_load's copy must land or be stubbed. (e) take_mov's offered record (w 640, h 480 /
   360 / 340, buff_id, byte +25) and the YC buffer calls (`0x50534dd1`, `0x50534bbd`) must be served.

### 5.3 Step C, part 1: MDET_DL native with S-DML (2026-11-07)

CPU 3's MDET_DL code runs natively on the lab CPU, from TAKE's calls through dml_start and IRQ 285 to MDET's subject
records and LAF, with S-DML standing for the engine. It is HLE step 4's CPU 3 at single call sites, as DISP_FRAME runs
(ARCHITECTURE.md C02): CPU 3's kernel does not run. In this part the engine wrote no detection, so MDET reported no
subject; 5.4 adds the scene's boxes as its records (5.2.1). Code: `emu/src/lab/mdet.mjs`, `emu/src/dev/dml.mjs`, the
firmware's side with its evidence in `emu/src/fw/models.mjs` `mdet` and the board's `dml`; test
`emu/test/test_mdet.mjs`.

**The request path (D).** Each of TAKE's calls goes through the poster `0x5080ad65`: it copies the request into MDET's
slot `0xa3375b98` (its kind byte the slot's busy mark) and posts `0x5080b987` with the slot to CPU 3 (sys_callrequest at
`0x5080aed5`, ring [3][0]); a busy slot arms a 50 ms software timer that posts later (`0x5080ade0..0x5080adfa`,
`0x5080af28`, `0x5080b017`). mdet_dl_start then waits for the CPU 0 flag `(0x60043184)` = 0x10a bit 8 without timeout
(`0x5080a658..0x5080a66a`), which START sets. On CPU 3 `0x5080b987` runs dl_init_boot (`0x5080b1c6`, once by the magic
`0x20202022` at `0xa3376c68`: the DML driver's init with the IRQ 285 attach, the request image, dl_prm_init), queues the
slot (`0x50817244`), sets MDET_DL_REQ's flag `(0x600436d0)` bit 1 and clears the mark. MDET_DL_REQ (entry `0x5080bae8`)
waits for that flag and takes the queue by kind: 1 START `0x5080bc34` (dl_init_start, LAF's start `0x50839498`, the CPU
0 flag, then MDET_DL_LDL's flag `(0x600436d2)` bit 2), 2 END `0x5080bd49`, 3 CHANGE_MODE `0x5080be27` (LAF's end and
start, MDET_DL_LDL's flag), 5 OFFER_YC_DATA `0x5080c033`. MDET_DL_LDL (`0x5080c8a1`) loads the kind's item when it is
not the one loaded (`0xa3375c74` against `0xa3375c75`). The four flag words at `0x600436d0..d6` hold 0x3003..0x3006, CPU
3 objects. The kernel's object calls compare an id's core bits (12..13) with the calling task's id, not with the core
register `(0x8050)` (`0x5002cfb0`), and the object calls index the object's own core's kcb (`0x50014ec7`).

**The offer (D).** The record take_mov packs (`0x503a4e2d`) carries, in the copy MDET keeps 12 bytes on, +16 the YC
buffer's id, +18 / +20 the frame's width and height, +25 the movie flag, +44 a percentage calc_disp_area_lv hands to
`0x50813294`, which returns at once for 100 and divides by it otherwise (a digital zoom, I; the buffer descriptor's
halfword +14, the print's `digi_tel` or `mag`), +46 the aspect code. dml_start reaches the driver's start through the
deferred call of IRQ 53 (`0x507f9099` -> `0x500503d4`; the run `0x507f90c1` -> `0x507f69cb`); the driver's start also
reads back `+0x1a08`, `+0x1a48`, `+0x1a88` and `+0x1aac` when the system clock's record changes (`0x507f8f64`). LAF's
start and end (`0x508395ce`, `0x508397d2`) write the byte `0xa337f084` (1 at `0x50839766`, 0 at `0x508398c8`), the byte
S-SUBJECT wrote before, and LAF's setter refuses an offer's result while it is 0 (`0x50839f29..0x50839f5b`).

**What the lab does (stand-ins; the player lists them).**

| Label | What |
|---|---|
| S-TAKEMDET | TAKE's and take_mov's requests (TAKE_MOV does not run): with S-SCENE's live view and the setting at a kind, mdet_dl_start once, mdet_dl_change_mode at a change of kind, mdet_dl_end at OFF, and one offer per S-SCENE frame step with {frame number, a buffer id, 640, 480, still, 100 %, DISP_FRAME's aspect code}; the buffer id names a 640 x 480 YC buffer from S-HEAP, whose lock, address and release are answered (a bank the manager refuses natively); its pixels are not written |
| S-MDETDL | the poster's return path serves ring [3][0] at once through S-CPU3 (which now dispatches by function and still fails on any other): `0x5080b987` in interrupt context, then a turn of each MDET_DL task whose flag is set, from its entry on a harness stack until it waits for its flag with the flag clear; CPU 3's flags 0x3003..0x3006 kept by the lab at OlyEvSt, iOlyEvSt, OlyEvWt and OlyEvCl; the offer's wait for the engine takes IRQ 53, runs the lab clock to S-DML's completion and delivers IRQ 285 (lab-delivered, its firmware-attached handler in interrupt context); a request that makes the firmware log an error stops the session |
| S-LEARNDATA | learning_data_load's read of group 0x800f to `0x9511ca00` answered with the reader's record {address, 9,383,936} and nothing copied |
| S-DML | the engine's registers as storage, the power words, a start that keeps the register image written since the last one (the debug API's `dml` op), zeroes 9 x (`0x9c18111c`) x 16 bytes at (`0x9c181118`) << 4, and completes after 10 ms of lab time (A-DML-1) with `+0x004` bit 14 (W1C) and IRQ 285 |

MDET's DISP_FRAME posts (UP_FACE after LAF writes the frame table) wait for S-CPU3's next drain, which makes one
DISP_FRAME turn with S-SUBJECT's post of the same tick; S-SUBJECT writes its frames again after each offer, because LAF
writes the table natively (X: count 0, from no records) and posts UP_FACE.

**Evidence (X, E143, `test_mdet.mjs`).** At each kind 1..5 the chain runs: start or change_mode, the kind's item to
MDET_DL_LDL, and per offer one engine run, one IRQ 285 and one dml_start_callback; the 8 subject records at `0xa3376b5c`
stay empty; no firmware error log during any request (the same distinct error logs as a session with the setting OFF).
The register image of every run matches the firmware's tables read at run time through the property read: `0x9c181118` =
MDET's global `(0x62f404e0)` >> 4 = `0x0b64f5c8`, `0x9c18111c` = object 0x3be4 [2457] = 32, `0x9c1811c4` = the kind
block's word 263 = `(480 << 16) | 640`; the kind block's words 17 m (m < 8) at `0x9c180498 + 0x100 m`, the 20 bias words
at `0x9c1811c8..0x9c181214` and the 12 resize words of a 640 x 480 frame at `0x9c180074..` and `0x9c180100..`; between
two kinds the images differ exactly where those table words do (BIRD's bias block and the kind words). 969 registers are
written before the first start (the power words with them), 938 before each later one; the YC planes' addresses go to
`0x9c180024` / `0x9c180030` as the buffer's >> 4. At OFF, END runs, LAF's byte returns to 0 and no engine run follows.
The FCS calls on CPU 3 (`0x508c0139`) run natively and give the flag 0, the record's, so the post-processing runs (5.2.1
(b)); the power saver's byte `(0xa337f08b)` stayed 0 over 25 offers at five kinds with no detection (5.2.1 (c), its
input still ?). S-SUBJECT's frames are drawn as before (`test_subject.mjs`). With a DISP_FRAME turn for LAF's empty
table and then one for S-SUBJECT's frames in the same tick, the second drawing its frame, the composite showed none (X);
why is ?.

**Open.** S-DML's records from S-SCENE's subjects: done in 5.4, with LAF's step to the frame table (5.2.1 (a)). Whether
CPU 3 really works in zero lab time around the engine's run (I) and the engine's run time (A-DML-1, ?). The YC frame's
content and size (4.2) and whether TAKE offers every frame. The weights stay outside the lab (U6).

### 5.4 Step C, part 2: the scene's boxes through MDET (2026-11-07)

S-DML no longer writes an empty output: each run writes the records the lab gives through the device's source, after the
area is zeroed, as the engine's records are laid out (5.2): u16 words +0 score, +2 h, +4 w, +6 cy, +8 cx, packed from
slot 0 of the record's class; a record that does not fit is the lab's error. For each offer S-TAKEMDET gives S-SCENE's
subjects of the offer's kind at the offer's scene time, placed in MDET's 640 x 480 frame as S-SUBJECT places them (its
`frames()`: the subject's box on the panel taken back through DISP_FRAME's transform, 5.1), each as a body record of
class 0 (group g = 0 of 5.2's classes 3g, 3g + 1, 3g + 2: S-SCENE's subjects carry no sub-kind, I) with the score
`0x0e00` (223 after MDET's scaling) and its centre and even size (5.2.1 items 3 and 4). No part records are written.

**Evidence (X, E143, `test_mdet.mjs`; the rider of the moving preset held still, MOTOR_SPORTS, the TFT at 4:3).**
S-DML's record in class 0, slot 0 is {score `0x0e00`, h 244, w 232, cy 325, cx 320} for S-SUBJECT's box `{204, 203, 436,
447}`. MDET reports nothing for six runs and from the seventh run with the record on writes the subject record at
`0xa3376b5c`: sbj_kind 6 (6 + 3 (kind - 1) + g, 5.2) and the body {cx 320, cy 325, w 232, h 244, rel 223, dtct 1}; the
seventh is the run after the hits object 0x61a4 [915] = 6 asks of a new track of a large box (5.2's reading of the
order, now measured). At BIRD the record goes at once (the change of kind restarts MDET's state; when exactly is not
read). No firmware error log comes with any of it. LAF takes the result natively and fills the frame table writer's
inputs: subject 0's box `{x0 204, x1 436, y0 203, y1 447}` at `0xa33790b2` and its valid byte `0xa337d53c` = 1 (the
test), and with S-SUBJECT's writes switched off by hand the writer gave the table count 1 and the list record (204, 203,
436, 203, 204, 447, 436, 447), S-SUBJECT's own record byte for byte, with `0xa337f082` at 0 (a scratch probe). So 5.2.1
(a) is answered for this case: LAF's step from MDET's subject record to the list record of 5.1 is the identity on the
box (X; when LAF fills the main and part records instead, U9, stays open).

S-SUBJECT keeps writing the table and the frame mode's subject bit (the bit is TAKE's request, which does not run, and
S-SUBJECT's writes are not retired in this step); that DISP_FRAME would draw LAF's own table with the bit set is not
tried. Open: the other groups and the part classes (judge_comb's pairing), several subjects in one class, the AIRPLANE
class swap and the movie remap with real records, the subjects' scores (one value for all), and the power saver with
records (its byte stayed 0).

## 6. Corrections to other documents

- `emu/fwmap/E143.labels.json`, gap@0x507f66d5: "DISP_SYNC device driver: 0x9c180000 ..." should read DISP_SYNC
  helpers to `0x507f68a5`, then the DML driver `0x507f68a8..0x507f906b` (clock 50, IRQ 285) (D, 2.1). Not changed in
  this survey (docs only).
- `docs/om1-cores-spec.md` §4 lists IRQs 278 / 279 / 286 / 287 for detection; IRQ 285 (DML) and its core belong
  beside them.
- The three "frame bitmaps" DISP_FRAME's start loads (12417, 61473, 35185; `emu/src/lab/camapp.mjs` S-DISPFRAME,
  `docs/om1-shutter-spec.md` section 7 items 49-50) are the data pointers of the settings objects `0x3081`, `0xf021`
  and `0x8971`: `0x500417b0` returns an object's data, and the draws read the values through the property read
  `0x500417da` with them (`0x5100d475..0x5100d4b5`, `0x5100da04..0x5100da12`; D). Changed with step A (2026-10-27).

## 7. Open questions

- **U1** Read (section 5.1): MDET's frame table, FACE's and MDET's getters and DISP_FRAME's draw_face; UP_LOCKON's
  record. What the fifth halfword's other byte and the lockon box's fields are beyond position and state is ?.
- **U2** Read (section 5.1): settings id 1682, object `0x1e71`, TAKE's context +206, take_mov, `mdet_dl_change_mode`.
- **U3** The layer schedule: what the eight register groups and the thirteen `+0x400` blocks hold, and the tables
  `dml_set_*` read.
- **U4** Read (section 5.2): the engine writes 9 x 32 records of `{score Q12, h, w, cy, cx}` at `(0x9c181118) << 4`
  = `0xb64f5c80`; MDET decodes no tensor, reads no engine register, and runs class swap, area filters, 6-hit
  stabilisation and body / part combination to 8 subject records at `0xa3376b5c`. Open: what the head's own words mean
  (`0x9c181100`, `0x9c181110`, `0x9c181114`, the piecewise tables, the anchors' unit, the grid), which S-DML does not
  need; judge_comb's pairing rules for parts; LAF's step from `0xa337b1e4` to the frame table (with U9): measured in
  5.4 for one body, which LAF writes as the list record of its box (X).
- **U5** The engine's numerics (operand widths, rounding, activations); not decidable statically.
- **U6** What the `0x95xxxxxx` window is.
- **U7** What PDT stands for and what it computes; which face IRQ is which engine; the face engines' clock name.
- **U8** E134's detection lineage (blocks `0x010f` and `0x0111`) and E139's.
- **U9** MDET's state `0xa337f082 = 1`, in which its writer fills the main record (drawn as kind 7, colour 4) and the
  part record (kind 8, under frame mode bit `0x10`): when MDET enters it (a selected or tracked subject, I) and which
  of TAKE's conditions sets request 32.
- **U10** When TAKE's live-view request clears the subject-frame bit (`0x506d8dea`'s conditions in a running camera),
  and how `mdet_dl_start` is given the first kind.
