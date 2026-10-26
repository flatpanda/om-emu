> Status (2026-10-25): a static survey. The firmware was read on the host (byte scans, string and pointer tables,
> byte statistics and hashes of the model items, computed in place by scratch scripts that are not committed) and
> disassembled with the MN10300 objdump inside the om-emu VM; nothing was executed and no model data was extracted.
> Nothing here is wired into `emu/` yet; section 5 is the plan.

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
  evaluation" guess; it fills register images, I), stores a DRAM work address `0xb64e7c80` and two more words in the
  request at `0x62f404da..0x62f404e4`, and starts the engine through `0x507f9099` -> `0x500503d4` -> `0x507f69cb`
  (`0x5080cb91`). Names without a function placed yet: `dml_open`, `dml_close`, `dml_start_callback`,
  `dml_set_control_reg_work`, `dml_set_control_reg_study`, `get_dml_result`, `get_dml_data_set`, `judge_dml_result`,
  `get_index_yc_aspect`, `change_parts_data`. Whether one start runs the whole network or one part of it, and what
  "study" configures, are ?.

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
  flag 1, no data), `0x50025764` (UP_LOCKON, 5 halfwords to `0xa3208c14`, flag 2), `0x500257ce` (UP_AF, the upload
  S-AFOSD uses) and `0x50025799` (UP_ASSIST, 4 halfwords to `0xa320ad08`, flag 8), all waking DISP_FRAME through
  `0x5002588e` (the type numbers 1, 2, 4 by table order, with UP_AF = 3 the anchor: I). MDET posts UP_FACE
  (`0x5082afee`, `0x50839dba`) after writing its frame table: a flag `0xa337efb2`, a rectangle's four corners as eight
  halfwords at `0xa337efb4..0xa337efc2`, a count `0xa337efc4` and up to eight 16-byte records from `0xa337efc6`
  (`0x5082aeb2..0x5082af98`, D); FACE posts it too (`0x5051c6e9`, `0x5051c9ee`). How DISP_FRAME reads that table (all
  the readers found are MDET's own code) and the records' field meanings are ?.
- **Other (D, names).** EXIF (`mdet_laf_deeplearning_info_exif`, `mdet_laf_detectiontarget_info_exif`); a power
  saver that stops the network while nothing is detected (`mdet_power_manager_judge_dl_power_saving`, the print at
  `0x509c85ef`); a card logger (`MDETDATA`, gap@0x50816fed).

### 4.4 Seams

| Seam | Where | Needs | Stand-in |
|---|---|---|---|
| S1 display | DISP_FRAME's inputs: MDET's frame table + UP_FACE, UP_LOCKON | what exists now (S-DISPFRAME runs DISP_FRAME on the lab CPU) | synthetic frames from the scene |
| S2 MDET result | `mdet_laf_*` getters FCS calls; the subject record (4.3) | native FCS (AF module) | S-SUBJECT returns scene-derived records |
| S3 DML device | `0x9c180000`, IRQ 285, the output buffer | CPU 3 natively; the `0x800f` read path; the output head layout | S-DML: on start, write heads that decode to the scene's boxes |
| S4 the network | the engine's arithmetic | layer schedule, numerics | a reproduced DML (5.4) |

## 5. Feasibility and plan (I)

| Step | Content | Depends on | Size | Retires / adds |
|---|---|---|---|---|
| A | S-SUBJECT at seam S1: S-SCENE's layers report screen boxes (the rider, the ball) with a kind; when the camera's subject-detection setting is on, write MDET's frame table and post UP_FACE (and UP_LOCKON for the tracked one) so DISP_FRAME draws subject frames natively, as S-AFOSD does for the AF frame | static: the frame table's record layout and how DISP_FRAME reads it (U1); the setting's property and its value per kind (U2) | about 1 week | adds S-SUBJECT; nothing retires |
| B | S-SUBJECT moves to seam S2: the subject records answered to the AF module, which then chooses the AF point and uploads frames itself | native AF module (hle-gaps 4.4: TakeReady, CPU 1 and 3; months) | 2-3 weeks after that | S-AFOSD's frame part and step A's display writes |
| C | MDET natively on CPU 3 with S-DML: a register-file model at `0x9c180000` (start `+0x010`, status `+0x004` bit 14 W1C, IRQ 285, the gates and clock 50), the `0x800f` load through the flash-read path, and on each start output heads synthesised so that MDET's own `get_dml_result` / `judge_dml_result` / stabilisation produce the scene's boxes | ROADMAP HLE step 4 (CPU 3); a flash read model or a resource reader at `0x501a921f`; the output head layout read from the post-processing code (U4); PDT / TRC and, on E143, the face engines as models or stand-ins | 4-6 weeks after CPU 3 | S-SUBJECT retires; adds S-DML (and S-FACE on E143) |
| D | A reproduced DML: run the real network on the frame | the layer schedule from the register builders (U3); the engine's arithmetic (U5); a reference to check against | months; bit-exactness ? | S-DML's synthetic heads |

Notes on D, against the e7-bird-network work: there the model resource carried its own command stream, and the
accelerator's numerics were fitted to outputs captured on a real camera. Here the item carries only parameters; the
schedule must be recovered from the register-image builders (`dml_set_common_reg` alone is 5,413 instructions, section 2.1), and the engine's
rounding, accumulation and activations are unknown. Without an OM-1 to capture DML outputs, a float approximation
could at best give plausible boxes, never a checked equivalence. The weights stay in the user's firmware file: an
emulator would read them at run time like the rest of the image, and none enter the repository.

Risks: the DML window `0x95xxxxxx` and the work buffer `0xb64e7c80` may need memory the lab does not map (U6);
which core owns IRQ 285 (2.1); each kind change reloads 9.4 MB, which matters for the time model only.

## 6. Corrections to other documents

- `emu/fwmap/E143.labels.json`, gap@0x507f66d5: "DISP_SYNC device driver: 0x9c180000 ..." should read DISP_SYNC
  helpers to `0x507f68a5`, then the DML driver `0x507f68a8..0x507f906b` (clock 50, IRQ 285) (D, 2.1). Not changed in
  this survey (docs only).
- `docs/om1-cores-spec.md` §4 lists IRQs 278 / 279 / 286 / 287 for detection; IRQ 285 (DML) and its core belong
  beside them.

## 7. Open questions

- **U1** The 16-byte records of MDET's frame table (`0xa337efc6..`) and the path by which DISP_FRAME reads them on
  UP_FACE; the five halfwords of UP_LOCKON.
- **U2** The subject-detection setting: its property id and how its value reaches `mdet_dl_change_mode`.
- **U3** The layer schedule: what the eight register groups and the thirteen `+0x400` blocks hold, and the tables
  `dml_set_*` read.
- **U4** The output heads: their buffer, shapes and encoding, from `get_dml_result` / `get_dml_data_set`.
- **U5** The engine's numerics (operand widths, rounding, activations); not decidable statically.
- **U6** What the `0x95xxxxxx` window is.
- **U7** What PDT stands for and what it computes; which face IRQ is which engine; the face engines' clock name.
- **U8** E134's detection lineage (blocks `0x010f` and `0x0111`) and E139's.
