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
> reports them; LAF then fills the frame table's inputs natively. Its third part (section 5.5): DISP_FRAME draws the
> frame table MDET's own code writes, with the aspect pair LAF derives from the offer and MDET's UP_FACE; S-SUBJECT no
> longer writes on E143, and the frame mode's subject bit (S-TAKEFRAME) is the one stand-in left at the display seam.
> The double DISP_FRAME turn of 5.3 is explained there.
>
> Update (2026-11-07, later): several subjects and parts run through MDET natively (section 5.6): S-SCENE's race preset
> has two motorcycles, each with its helmet as a part; S-DML writes each body and each helmet; MDET's own combination
> pairs every helmet with its own body (judge_comb's rule read), and LAF writes one list record per body, so DISP_FRAME
> draws two frames. U9 is located: the main and part records need LAF's frame trace and the AF library's area, neither
> of which the lab runs; it stays open.
>
> Update (2026-11-08): section 5.7. The trap after a change of tracking status was TAKE's status-change callback never
> registered (a deferred call of address 0); S-TAKEMDET registers it as TAKE's start does. LAF's AF area comes from the
> camera's AF target setting through the AF library's init, three steps of which now run natively (H-FCSAF): the area of
> 5.6 was read through the AF library's null record pointer. A subject under the AF target becomes LAF's candidate and
> gets a tracking status natively. MDET_CALC_MAIN_CPU3 and MDET_E_SEND_CPU3 run natively when the firmware posts to
> them; the end-frame event that would set the main and part records comes only from LAF's chase cycle on the PDT / TRC
> unit, so U9 stays open, narrowed to that.

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
| S1 display | DISP_FRAME's inputs: MDET's frame table + UP_FACE, UP_LOCKON | what exists now (S-DISPFRAME runs DISP_FRAME on the lab CPU) | synthetic frames from the scene: S-SUBJECT (5.1); on E143 MDET's own table since 5.5, TAKE's subject bit S-TAKEFRAME's |
| S2 MDET result | `mdet_laf_*` getters FCS calls; the subject record (4.3) | native FCS (AF module) | S-SUBJECT returns scene-derived records; the AF target record and LAF's FCS info record from three AF library init steps (H-FCSAF, 5.7) |
| S3 DML device | `0x9c180000`, IRQ 285, the output buffer | CPU 3 natively; the `0x800f` read path; the output head layout | S-DML: on start, write heads that decode to the scene's boxes (its register file since 2026-11-07, 5.3; the scene's boxes as its records, 5.4; several subjects and their parts, 5.6) |
| S4 the network | the engine's arithmetic | layer schedule, numerics | a reproduced DML (5, step D) |

## 5. Feasibility and plan (I)

| Step | Content | Depends on | Size | Retires / adds |
|---|---|---|---|---|
| A | S-SUBJECT at seam S1: S-SCENE's layers report screen boxes (the rider, the ball) with a kind; when the camera's subject-detection setting is on, write MDET's frame table and post UP_FACE (and UP_LOCKON for the tracked one) so DISP_FRAME draws subject frames natively, as S-AFOSD does for the AF frame | static: the frame table's record layout and how DISP_FRAME reads it (U1); the setting's property and its value per kind (U2) | about 1 week; done 2026-10-27 (5.1: UP_FACE only, UP_LOCKON is the AF module's) | adds S-SUBJECT; nothing retires |
| B | S-SUBJECT moves to seam S2: the subject records answered to the AF module, which then chooses the AF point and uploads frames itself | native AF module (hle-gaps 4.4: TakeReady, CPU 1 and 3; months) | 2-3 weeks after that | S-AFOSD's frame part and step A's display writes |
| C | MDET natively on CPU 3 with S-DML: a register-file model at `0x9c180000` (start `+0x010`, status `+0x004` bit 14 W1C, IRQ 285, the gates and clock 50), the `0x800f` load through the flash-read path, and on each start output heads synthesised so that MDET's own `get_dml_result` / `judge_dml_result` / stabilisation produce the scene's boxes | ROADMAP HLE step 4 (CPU 3); a flash read model or a resource reader at `0x501a921f`; the output head layout read from the post-processing code (U4); PDT / TRC and, on E143, the face engines as models or stand-ins | 4-6 weeks after CPU 3; part 1 (MDET_DL native at single call sites, S-DML with an empty output, the load stubbed), part 2 (S-DML's records from the scene) and part 3 (the frames from MDET's table) done 2026-11-07 (5.3, 5.4, 5.5); several subjects and parts the same day (5.6); the trap fixed, the AF area from the AF target and MDET_CALC_MAIN native on the firmware's posts 2026-11-08 (5.7); the main and part records wait for LAF's chase cycle on PDT / TRC (U9) | S-SUBJECT retires (on E143 in part 3, 5.5); adds S-DML (and S-FACE on E143) |
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

**MDET's frame table (U1, D).** The writer (`0x5082ac64..0x5082af98`, which ends in UP_FACE) and the getter `0x5083a299`
(trace id 227) agree on this layout (the writer that runs in the lab is another, `0x5083a761`, with the same layout:
5.5):

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
   the scaled score, dtct = 1}. It keeps reporting for up to 8 starts after the box stops. (Corrected in 5.6: the track
   survives that long, but a subject is reported only in a pass that detects it, X.)
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
writes the table natively (X: count 0, from no records) and posts UP_FACE. (Superseded in 5.5: S-SUBJECT writes nothing
on E143, and S-TAKEMDET drains as each call returns.)

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
explained in 5.5: DISP_FRAME's double buffer, the composite taken in the one display frame between the two buffers'
latches.

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

In this step S-SUBJECT kept writing the table and the frame mode's subject bit; 5.5 retires its writes on E143, and
DISP_FRAME draws LAF's own table with the bit set. Open: the other groups and the part classes (judge_comb's pairing),
several subjects in one class, the AIRPLANE class swap and the movie remap with real records, the subjects' scores (one
value for all), and the power saver with records (its byte stayed 0).

### 5.5 Step C, part 3: the frames from MDET's own table (2026-11-07)

On E143, where MDET_DL runs natively, S-SUBJECT writes nothing: the frame table, the getter's aspect pair, MDET's active
byte and UP_FACE are MDET's own, and DISP_FRAME draws the table LAF writes. One stand-in is left at the display seam:
the frame mode's subject bit, TAKE's request 1, now part of S-TAKEFRAME. Code: `emu/src/lab/mdet.mjs` (S-TAKEMDET, the
status of MDET's table), `emu/src/lab/camapp.mjs` (`take_subject_frames`), `emu/src/lab/subject.mjs` (S-SUBJECT for a
body without the mdet facts; its placement serves S-DML), the facts in `emu/src/fw/models.mjs` `mdet`; tests
`emu/test/test_subject.mjs`, `emu/test/test_mdet.mjs`.

**The aspect pair (D, X).** LAF's setter copies its offer state (`0xa337b4e4..` to `0xa337b5f4..`, 272 bytes,
`0x5083998d..0x508399a0`) and maps the byte `0xa337b702` to the getter's pair (`0x50839cb8..0x50839d34`): 1 -> (4, 3), 2
-> (3, 2), 3 -> (16, 9), 4 -> (6, 6), 9 -> (3, 4), 10 -> (17, 9), any other value logged and (4, 3): the inverse of the
getter's map (5.1). It writes `0xa3378116` from `0xa337b6fc` (100 in the lab, the offer's zoom, I), `0xa3378118` from
`0xa337b700` and `0xa337811b` = 1 beside it (`0x50839c32..0x50839c58`). X: offers with the aspect codes 1, 2, 3, 4 and 9
(the still aspect, settings id 269) gave the same values at `0xa337b702` and the pairs (4, 3), (3, 2), (16, 9), (6, 6)
and (3, 4); with S-SUBJECT's writes switched off, a debug-API watch put the pair's writes at `0x50839d2c` / `0x50839d34`
after each offer. S-TAKEMDET's record already carries what LAF needs: DISP_FRAME's own aspect code at +34, as TAKE would
hand it (I). Nothing in the lab writes the pair now.

**The writer and UP_FACE (D, X).** After the pair, unless the bytes `0xa337f087` and `0xa337d948` take the branch that
calls `0x506e6ac8` instead (`0x50839d79..0x50839da4`; mdet_laf_dl_set_tracking_status, read in 5.6), LAF's setter calls
`0x5083a761` (entered at `0x5083a766` by its call at `0x50839db5`) and posts UP_FACE (`0x50839dba`). `0x5083a761` runs
`mdet_laf_calc_not_tr_dl` (`0x50837b05`), writes the main and part flags 0 and the count 0 (`0x5083a843..0x5083a850`)
and then, for each box n whose byte `0xa337d53c + n` is 1, a list record of the box at `0xa33790b2 + 8 n`
(`0x5083a858..0x5083a90c`), in 5.1's layout. X: it ran once per offer (the lab observes its entry; the status's
`writes`), and so did UP_FACE; the count stores of 5.1's writer (`0x5082af2a`, `0x5082af55`) never executed, also while
the table held the rider. So "the writer" of 5.4's probe was this one, and 5.1's `0x5082ac64..0x5082af98`, the one that
fills the main and part records, belongs with the state `0xa337f082` = 1 (I; U9).

**What is left (I).** The frame mode's subject bit: UP_FACE (`0x50025747`) acts only when the frame mode has it (D,
4.3). S-TAKEFRAME's mode is 4 plus 1 while S-TAKEMDET has MDET started and the live scene is shown, 4 otherwise (TAKE's
live-view request `0x506d8dea` sets the bit unless its conditions clear it, U10). S-TAKEMDET sets it after its start or
change of kind and before its offer, so the offer's UP_FACE finds it. Taking it away (OFF, the menu, a rec view,
playback) makes DISP_FRAME draw without the subject frames (X: none at OFF and in the menu).

**A lab fix: S-CPU3's drain after each MDET call (X).** MDET posts UP_FACE during the offer, inside the poster's return
path, where S-CPU3's nested drain only keeps DISP_FRAME's bits (a DISP_FRAME turn there would reuse the harness call's
stack). S-SUBJECT's own post in the same tick used to drain them; without it they waited for the next tick, and the
frame drawn lagged MDET's table by one offer (X: after a change to 16:9 the IMG3 plane held the previous offer's frame).
S-TAKEMDET now drains as each call returns: one DISP_FRAME turn per offer, at once.

**The double turn of 5.3, explained (X).** Symptom: in one tick a DISP_FRAME turn drew LAF's table (count 0) and a
second one S-SUBJECT's frames (count 1), and the composite showed no frame. Cause: DISP_FRAME double buffers its plane.
Its draw (`0x5100d99e`) alternates the buffer index `0x62f4fe56` (0, 1) between the records `0x62f46c6c + 12788 i`, and
before it draws, `0x5100d34b` sleeps 1 ms at a time (`0x5100d3bc..`, on the display clock in the lab, A10) while the
channel has an address written and not yet latched and the buffer to draw is the shown or the pending one. The first
turn drew the empty table into one buffer and wrote its address; the second waited 5 to 12 ms of lab time for that
address to latch at the next display boundary, then drew the frame into the other buffer, whose address latches only at
the boundary after. A composite taken between those two boundaries shows the empty buffer. Measured with S-SUBJECT's
post back in a turn of its own: at lab time 3623.5 ms the composite showed IMG3 at `0xb52a1f80` (the empty table's
buffer, latched at the boundary 3622.17 ms) while the frame's buffer `0xb5175f80` waited for 3638.86 ms; 20 ms later the
frame was shown. The shot fell there because the frame request's step to its boundary ran a tick whose offer took the
engine's 10 ms (A-DML-1) past that boundary. So DISP_FRAME drew both tables as the firmware would; the empty display
frame came from the lab's two writers of one table, S-SUBJECT and LAF, and lasted one display frame each time. With MDET
the only writer it cannot occur, and the merged turn of 5.3 is no longer needed for it (S-CPU3 still defers the bits out
of the nested drain).

**The delay before the first frame (X; the firmware's).** MDET reports a new track from its seventh run (5.4), so the
first six offers draw no frame and the seventh does. S-TAKEMDET offers at most one frame per tick and per 1/15 s of lab
time: in a session whose lab time moves only with its inputs (`--idle off`), seven offers take seven WAITs of a frame
step, and a long WAIT is one offer (the tests step with WAIT:67). Back at MOTOR_SPORTS after BIRD the rider was reported
at the first offer: the track outlived the change of kind (X; how is not read). A rider that wraps across the panel
jumps by more than MDET's association distance and is a new track, six hits again.

**Evidence (X, E143).** `test_subject.mjs`: at OFF no frame; at MOTOR_SPORTS none after three offers, then after five
more DISP_FRAME's colour 3 on at least 70% of each edge of the rider's panel box, the status's frames from MDET's table
(source `mdet`, the writer's runs counted) and S-SUBJECT not listed; at 16:9 and 3:4 the frame on the rider within the
letterbox's clip, the status's aspect code following; on the EVF (a session started there) the frame on the rider; at
BIRD none; the rider moving at 3 m/s, three frames on the rider at the scene time of the newest offer or the one before
(the published status can follow an offer made in the tick at the frame's boundary, whose buffer awaits the next one),
each at another place; OFF again none; `--replay` ending on the same frame. With the mdet facts taken away, S-SUBJECT's
frame is drawn on the still rider at once and goes at OFF. `test_mdet.mjs`: MDET's table holds S-DML's box as its one
list record (main and part flags 0), its writer ran once per offer, the pair is (4, 3) for the offers' code 1, the frame
mode has the subject bit and S-SUBJECT made no write; at OFF the table is empty and the bit gone. With the rider moving,
MDET's box followed S-DML's placed box offer by offer within 1 px (the records' even size, the centre's clamp at 639;
X).

**S-SUBJECT elsewhere.** The subject facts and the mdet facts are both E143's only (`emu/src/fw/models.mjs`), so no body
runs S-SUBJECT's writes today. It stays for a body that would give the first without the second, and the stand-in
session of `test_subject.mjs` runs it with the mdet facts removed before the session opens.

**Open.** After a display switch (`lv`) from the TFT the EVF composite has no IMG3 plane at all, so no subject frame is
shown there; a session started on the EVF shows it (X, the same before and after this step; located in 5.6). Part
records and several subjects per class need S-SCENE subjects with parts or a second subject (it has one, the rider): not
done. The state `0xa337f082` = 1 and its main and part records (U9), the branch to `0x506e6ac8`, and when TAKE clears
request 1 (U10) are not read.

### 5.6 Several subjects and parts through MDET; U9 located (2026-11-07)

S-SCENE gains a scene with two subjects of one kind, each with a part; S-DML writes every body and every part as the
engine's records; MDET's own combination pairs them and LAF and DISP_FRAME draw one frame per body, all natively. U9 is
read as far as the lab can follow it. Code: `emu/src/lab/scene.mjs` (the race preset), `emu/src/lab/subject.mjs`
(`frames()` places the parts too), `emu/src/lab/mdet.mjs` (S-DML's records); tests `emu/test/test_mdet.mjs`,
`emu/test/test_subject.mjs`.

**S-SCENE (the harness's, not firmware evidence).** A layer may carry an offset `x_m` (m on its plane at lab time 0);
the preset `race` has the sky and two layers of the new pattern `racer`, a motorcycle with its rider side on: `far` at
14 m, 2.4 m to the left, 3 m/s, and `near` at 8 m, 1.2 m to the right, 4 m/s. `SUBJECTS.racer` is a motorsport subject
(tyres to helmet top) with one part, `helmet`; `subjectsAt` reports each subject's parts, clipped like its box. The
other presets render, focus and report as before (no offset, the rider has no part), and the defaults are unchanged.

**Which part is which (D, I, ?).** No string names a group or a part: the code says parts1 / parts2, `parts[0]` /
`parts[1]`, `dl_target_part`, `dl_cp_part2_to_body_flg` (D). What the code orders (D): combination pairs part 1 into
part 2 as well as into the body (the (2, 1) call below); calc_offer_data offers bodies, then a lone part 2, then a lone
part 1 (5.2); and LAF tries subject 0's parts as a target in the order of object 0x79a2's words 159..161, which read
1, 2, 0 (X, through the property read; mdet_laf_init_param `0x508215df..0x5082162a` copies them to `0xa337ed18..1a`,
and mdet_laf_dl_internal_start walks them, below). So part 2 is the larger part that holds part 1, part 1 the most
specific (I: a head around an eye). S-DML writes the racer's helmet as part 2, class 3g + 2 (I), in group 0 (the
scene's subjects carry no sub-kind). Which object each part is per kind (helmet, eye, cockpit) is ?. For AIRPLANE
S-DML writes MDET's classes 7 and 8 the other way round, as the network does (change_parts_data, 5.2); no AIRPLANE
subject has a part yet.

**The pairing rule (D, read in the VM's objdump; the trace ids are the logger table's at `0x509bec34 + 36 id`).**
combination (`0x50814eb7`, trace id 648) runs, for each group g of classes 3g..3g + 2 (`0x50815050..0x50815100`):
regist_comb_list (649, `0x50815211`), judge_comb (body, part 1), judge_comb (body, part 2), judge_parts_comb (654,
`0x50815d20`) for part 2, judge_comb (part 2, part 1), judge_parts_comb for part 1. judge_comb (650, `0x508153b1`) takes
each stabilised entry of the first class (18 bytes: +2 cx, +4 cy, +6 w, +8 h) as the box cx +- w / p0, cy +- h / p0,
widened by p1 % of w and h on each side and clamped to 639 / 479 (`0x50815592..0x5081565b`); for each entry of the
second class not yet taken (its +14 is 0), the part's box cx +- w / 2 must intersect that box
(`0x50815716..0x50815739`); of those, the one with the smallest calc_correlation (652, `0x50815a0f`) wins, the earlier
on a tie:

    corr = a * (|dcx| * 100 / 640) / 100 + b * (|dcy| * 100 / 480) / 100
         + c * ((|dw| * 100 / 640) * (|dh| * 100 / 480) * 100 / 10000) / 100

(for the body with part 1 and for part 2 with part 1, a part whose halfword +12, an id (I), matches the one this entry
was paired with before is taken at once: `0x50815797..0x508157e4`). judge_cor_min_thr (651, `0x508158a5`) pairs it when
corr is below the threshold, copying the part into the body's entry (`0x5081594b..0x508159bb`). The parameters per kind
are at `0x62f240de + 40 item` (`0x508154a1..0x50815507`: +0 p0, +1 p1, +2 a, +4 b, +6 c, +8 the threshold, +10..+19 the
same for part 2 with part 1, +20..+39 a byte per class). X, read at run time, the same for all five kinds: p0 2, p1 0,
a = b = c = 100, threshold 10000, the class bytes 0; so the rule that a body of a class whose byte is 1 does not pair
when more than one part overlaps it (`0x50815804..0x50815822`) never applies, and since corr cannot reach 300 a part
pairs with the body whose box it overlaps, the nearest in centre and size when several do (I from the arithmetic).
S-DML places each part at its own box; nothing is placed for the rule.

**MDET with several subjects and parts (X).** Scratch probes with records written by hand (not committed): two bodies
in class 0 gave two subject records of sbj_kind 6 and two list records; a body with part 1 and part 2 inside it one
record with both parts; a part 2 at (600, 50), outside the body, two records, the body alone and a lone part 2 (body
empty); classes 3..5 sbj_kind 7. With the race held still (`test_mdet.mjs`): S-DML's class 0 holds the two bodies, class
2 the two helmets, class 1 nothing; MDET reports nothing for [915] = 6 runs, then two records, far {142, 298, 150, 120,
223, 1} with part 2 {159, 249, 22, 22, 223, 1}, near {475, 341, 264, 210, 223, 1} with {503, 255, 38, 38, 223, 1}, part
1 empty, each helmet with its own body. LAF keeps its subjects as [3][8] arrays, body, part 1, part 2 by 8 subjects:
the valid bytes at `0xa337d53c`, cx, cy, w, h as halfwords at `0xa337d554`, `0xa337d584`, `0xa337d5b4`, `0xa337d5e4`
(the bodies in row 0, the helmets in row 2), and its list writer `0x5083a761` writes row 0 alone: two list records,
the bodies'. A lone part gets no LAF entry and no frame. DISP_FRAME draws the two list frames, each on its racer
(`test_subject.mjs`); main and part flags stay 0.

**Tracks across a change of scene (X).** MDET's stabilisation keeps a registered track through passes without a
detection and through mdet_dl_end and start; a detection inside its gate takes it over at once. Switched straight from
the rider to the race, the far racer (centre 178 px from the rider's, area 32 % of it) became the rider's track and was
reported at once; through OFF and ON the near racer was reported at once with the rider's size (232 x 244), not its own;
once a pass gave a box that matched no racer (x 528, the far racer's y and size).
A subject is reported only in a pass that detects it (the rider was gone at the first pass without it), which corrects
5.2.1 item 5: the track survives [905] = 8 passes unreported. The test shows a scene without subjects for 10 passes
before the race, so both racers start as new tracks.

**U9: what sets `0xa337f082` (D; X where marked).**

1. Its one store of 1 is in mdet_laf_dl_internal_start (187, `0x50834ffd`): with `0xa337ed1c` not 1 it walks the
   target parts `0xa337ed18..1a` and takes the first part p of subject 0 that is valid (`0xa337d53c + 8 p`) with a
   reliability (`0xa337d614 + 8 p`) above its halfword threshold (`0xa337ed1e + 2 k`), part 0 always, another only when
   `0xa337f083` is 2 and `0xa3378122` is 1; it stores p at `0xa337f080`, copies 4 bytes from `0xa337ed24 + 4 (k + 1)` to
   `0xa337ed04`, and then sets `0xa337f081` and `0xa337f082` to 1 and calls mdet_laf_dl_set_tracking_status_force(1)
   (229, `0x506e6bc6`) (`0x508350b7..0x50835161`). Object 0x79a2's thresholds (words 164..166) read 65535, 65535, 0
   (X), so with them the target is the body; mdet_laf_init_param, which copies them, has not run in the lab, where
   `0xa337ed18..` stay 0 (X).
2. It is called only from mdet_laf_exec_trace (96, `0x50825e4f`) and mdet_laf_start_set_prm (71, `0x50820197`), each
   when `0xa337d948`, subject 0's candidate byte, is 1. exec_trace runs in mdet_laf_end_frame_calc_cpu_func (242), an
   event handler of MDET_CALC_MAIN_CPU3 (its dispatch, `0x50800c38`). The main and part writer of 5.1 is part of
   mdet_laf_calc_offer_data (124, `0x50829b59`), called from exec_trace (`0x50825ed4`), start_set_prm (`0x50820844`)
   and `0x50823425`. None of these runs in the lab (X: a probe's count on `0x50835002` stayed 0; 5.5: the writer's count
   stores never executed). MDET_CALC_MAIN_CPU3 does not run, and what posts its end-frame event is not read (LAF's frame
   trace with EMS1 and EMS2 and take_mov's LAF callbacks, I from the names of trace ids 905-939).
3. The candidate bytes `0xa337d948 + n` are written by mdet_laf_dl_main_subject_select_candidate (185, `0x50834992`)
   (mdet_laf_dl_subject_update, 186, swaps the nearest candidate into slot 0), which mdet_laf_dl_main_subject_detect
   (184, `0x5083465f`) calls; LAF's setter calls that on every offer (`0x50839d74`), so it runs in the lab (X).
   select_candidate clears the bytes and stops when the result's byte +262 (`0xa337b6fa`) is not 0 and `0xa337f060` is
   not 1; that byte is the offer record's +12, which MDET's print names `mag` (`0x5081745b..0x50817476`) and take_mov
   packs from the YC buffer descriptor's byte +18 (`0x503a4ea5`); what sets it is not read. Otherwise a subject (LAF's
   row 0) is a candidate when its box overlaps the area `0xa337f050..56` (x0, y0, x1, y1) and, with `0xa337f060` = 1 and
   no main subject (or the caller's flag), lies within `0xa337ee94` / `0xa337ee96` of the caller's point; it is marked
   when its cx and cy are at least `0xa337ee8c` and `0xa337ee90` (100 and 100 in the lab, X; their meaning is ?)
   (`0x50834a90..0x50834d0d`). The area is `0xa337f06a..70` or `0xa337f072..78` by `0xa337f060`, `0xa337f068`, the
   candidate byte and `0xa337a271` (`0x508346b2..0x5083473e`), all from the 17 halfwords LAF's setter copies to
   `0xa337f05a..` (`0x50839aee..0x50839b03`, under the conditions at `0x50839abe..0x50839aec`) from the record the AF
   library's CPU 3 call `0x508c00a3` fills (`0x508399c8`). In the lab that call runs natively but nothing drives the AF
   library's state: the area is (0, 0)..(33, 36) and `0xa337f060` is 0 (X), so only a subject reaching the top left
   corner could be a candidate; the rider and the racers never do. (Corrected in 5.7: that area was read through the AF
   library's null record pointer; it now comes from the AF target, and the rider is a candidate.)
4. With a candidate, LAF's setter takes the branch of 5.5 (`0x50839d79..0x50839da4`): with `0xa337f087` = 0 and the
   candidate byte 1 it calls mdet_laf_dl_set_tracking_status(1) (228, `0x506e6ac8`: unless `0xa337bbdc & 0xc0` is 0x40
   and `0xa337bbdc & 6` is 4, the force variant writes `0xa337f085`), with `0xa337f087` = 1 and no candidate it calls it
   with 0, and in either case it writes no table and posts no UP_FACE that offer. mdet_laf_dl_status_change_callback
   (217, `0x508393dd`), after each offer, copies the tracking status (`0x506e6a2c`: `0xa337f085`) to `0xa337f087` and
   posts a change (`0x508026a1` -> `0x50801a5b`). X, a scratch probe with a body record at (110, 110, 220, 220), which
   overlaps that area: at its seventh run the candidate was marked (`0xa337d948` = 1, `0xa337f058` = 1), the tracking
   status set (`0xa337f085` = 1, then `0xa337f087` = 1), and the session stopped inside the callback's post with a trap
   at pc 0x16; why is not read (read in 5.7: TAKE's callback never registered). `0x50835002` was not entered.

So the main and part records, and the kind 7 / kind 8 frames DISP_FRAME draws from them, need the AF library's area
and mode (FCS: the AF module of step B, CPU 1 and CPU 3) and LAF's frame trace on MDET_CALC_MAIN_CPU3. Neither is one
input a minimal stand-in could give as the camera would (I), so U9 stays open with its inputs named. Nothing in the lab
writes `0xa337f082` or the candidate bytes.

**What the lab does (changed stand-ins).** S-DML writes every subject of the kind S-SCENE shows (up to the table's 8)
as a body record in class 0 and each part it names at the part's own box in its class of the group (the helmet in class
2), all with the score 0x0e00; S-TAKEMDET is unchanged. S-SCENE has the race preset.

**Evidence (X, E143).** `test_mdet.mjs`: after 10 passes without a subject, the race held still: S-DML's class 0
holds the two bodies and class 2 the two helmets ({cx, cy, w, h, score} from the placed boxes); after [915] = 6 runs no
subject and no frame; after the seventh two subject records of sbj_kind 6, each body with its own helmet as part 2 and
part 1 empty; MDET's table holds the two bodies as list records, main and part flags 0; OFF empties it and takes the
subject bit away. `test_subject.mjs`: the racers' boxes and helmets against the pixels S-SCENE renders; in play, no
frame after six offers, two frames after the eighth, each on its racer's panel box (at least 70 % of each edge), and
none at OFF.

**The EVF after `lv` (5.5's open bug), located, not fixed (X; D where marked).** Symptom: in a session started on the
TFT, after `lv` to the EVF MDET's table keeps its frame (status `frames` 1, device `evf`, its writer running each
offer), but the EVF composite has no IMG3 plane at all; a session started on the EVF shows it. The EVF channel's IMG3
registers after the switch are its generic set-up (format 0, PLANC 0x100, DMALD 0x2b8, DMABN 0xc8, no address, DMAEN
0x27 without bit 3), where an EVF start has the face plane (format 2, PLANC 0x1000, DMALD 0x40, DMABN 0x38, DISP_FRAME's
buffer, DMAEN 0x2f). Candidates were (a) DISP_FRAME keeping the TFT as its output, (b) the A19 opt-in not set on the EVF
channel, (c) the face plane's set-up not running for the EVF. (b) is out: both channels carry the A19 bit. (a) is out:
DISP_FRAME's own loop sees the new display state (`0x5100dfbc`: 1 -> 2), closes the TFT (`0x5100d19e`, its FD control
with mask 1 and command 4) and reopens for the EVF (`0x5100d1db`). (c) holds: DISP_FRAME's draw for state 2 stops at
`0x5100da41` because `0x501c441d` -> `0x501dccfc` returns the EVF's frame-state byte (`0xa32ddaf4 + channel`), which is
1, so it never sends the FD control (`0x501c42be`, command 2) whose handler configures the output's face plane
(`0x501dcb1a`) (D for the branches, X for the values). The byte is 1 from the channel's init (`0x501d92bc`, which the
switch's OPEN runs again) and becomes 0 only through the display set-up `0x501da840`, whose 0xFACE entry calls
`0x501dcd0c(output, 0)` (`0x501daab9`); that set-up runs in DISPLAY cmd 18 for the shown output
(`0x501c3324..0x501c339c`), and cmd 18 is the display manager's asynchronous request (S-DISPQ) of a shooting-screen
transition (posted from `0x503e8b31` -> `0x503eb960`). At session start cmd 18 came three times for the TFT; the lab's
switch made only cmd 17 for the EVF, never cmd 18. A menu opened and closed after the switch posts it: the EVF's byte
goes to 0 and the EVF's IMG3 gets the face plane natively, but with PLANC 0x1100 (the 0x100 bit written at
`0x501dfb8e`), which the VSC model's A19 does not define, so the composite stops with PLANC_UNOBSERVED. So the missing
frame is the lab's: its live switch (DISPLAY OPEN, H-RESEND, H-EYESTATE, H-CONNECT 131 and the application's re-entry)
produces no shooting-screen transition that posts cmd 18, which the camera's switch presumably does (I: not read); and a
face plane set up after a switch carries a PLANC value the model does not know (?). Neither is fixed: which of the GUI's
or the display manager's steps posts cmd 18 at a real switch, and what PLANC 0x1100 does, are not read; a write of the
EVF's byte by the lab would hide the first, and accepting 0x1100 would guess the second.

**Open.** U9 (above); which object each part is per kind; subjects of other groups and kinds with parts; the AIRPLANE
swap with real part records; one score for every record; the tracking frame (UP_LOCKON, step B); the trap after a
change of tracking status; the EVF after `lv` (above).

### 5.7 MDET_CALC_MAIN, the trap and the AF area; U9 narrowed (2026-11-08)

The trap of 5.6 is an unregistered callback, now registered as TAKE registers it; LAF's AF area comes from the camera's
AF target setting through three steps of the AF library's init, which now run natively; MDET_CALC_MAIN_CPU3 and
MDET_E_SEND_CPU3 run natively when the firmware posts to them. A subject under the AF target becomes LAF's main-subject
candidate and gets a tracking status natively. The main and part records still do not come: their state is set at LAF's
end-frame event, which only LAF's chase cycle on the PDT / TRC unit posts. Code: `emu/src/lab/mdet.mjs`,
`emu/src/lab/camapp.mjs` (`drain_cpu3`), the facts in `emu/src/fw/models.mjs` `mdet`; tests `emu/test/test_mdet.mjs`,
`emu/test/test_subject.mjs`. The trace ids are the logger table's (5.6).

**The trap at pc 0x16 (D, X).** Symptom (5.6, X): with a subject overlapping the AF area, the offer that marked it set
the tracking status, and the status callback's post was followed by a trap at pc 0x16 with address 1. Candidates: (a) a
post to ring [3][0] that S-CPU3 does not serve (its error would name the function, not trap); (b) the callback record
the post uses never filled; (c) a fault on TAKE's side. Checked (b) first: mdet_laf_dl_status_change_callback_cpun (22,
`0x508026a1`) posts the record `0xa33458cc` through `0x50801a5b`, which calls `0x50035afd` (sys_callrequest) to the
record's core byte +12 when that differs from `(0x8050)`, and otherwise `0x50801974`, a deferred call (`0x500503d4`, IRQ
53's ring) of the record's +4 with its +8 (D). In the lab the record was 16 zero bytes, so the deferred call was of
address 0 from `0x50801a15`, and IRQ 53's runner `0x5005062d` `calls (a2)` with a2 = 0 (`0x50050655`) ran from address 0
to the trap at 0x16 (X). The record's words occur in the image only there and in mdet_laf_dl_set_status_change_callback
(21, `0x506e68b4`), which writes {0, `0x60823720` (mdet_laf_dl_status_change_callback_exec, 24, `0x50802700`), 0,
`(0x8050)`} and the callback at `0xa33458dc` (`0x506e691b..0x506e693e`; byte scan, D); its only caller is TAKE's start
at `0x506d8109`, the function that reads the setting into TAKE's context +206 (`0x506d8017`), with TAKE's callback
`0x506d98ed`, beside three other registrations (`0x506eac15`, `0x506eac34`, `0x506e64a4`) (D). TAKE does not run in the
lab, so nothing registered it. Fix: S-TAKEMDET makes that registration natively at MDET's first request, before
mdet_dl_start; the status callback then runs `_exec` and TAKE's callback, which posts TAKE's message 81 (handler
`0x506d993e`) to TAKE's queue 0x5e through OlyQeWr and sets `0xa32df204`, its guard, until TAKE's handler clears it
(`0x506d98f0..0x506d9966`, D; X: one message, the guard 1). TAKE's handler would rebuild TAKE's live-view request
(`0x5039c864` -> `0x5039bb7e`); TAKE does not run, so the message stays in its queue (U10). Siblings (D): `0x50801a5b`
posts three more records, each filled by its own registrar: `0xa3345618` (`0x50801dba..`), `0xa33457e4` (`0x50802503..`)
and `0xa33458b0`, which mdet_laf_chase_object (25, `0x508027c8`, take_mov's request from `0x503a4c66` and `0x503a4cd7`)
fills with take_mov's callback (`0x5080287a..0x50802895`). The last is posted at every end frame, unconditionally:
mdet_laf_end_frame_calc_cpu_func calls mdet_laf_chase_object_cb_after_endframe (52, `0x50803df6`) at `0x50825bb0`. A
scratch run that posted end frames without a chase request trapped the same way (X: the deferred call of address 0 from
`0x50801a15`, stack through `0x50803e45`). It is not registered by the lab: no lab session runs an end frame (below).

**MDET_CALC_MAIN_CPU3 and MDET_E_SEND_CPU3 (D).** MDET_CALC_MAIN_CPU3 (`0x50800b03`) reads 16-byte messages from its
queue `(0x600436f8)` = 0x3005 (OlyQeRd, timeout -1, `0x508015c6`), takes the word +8 as the event, subtracts 0x10000000
and finds its handler in the table `0x609d9b54` (slot `event & 31`, the slot's event compared): 0x30000008 the end frame
(`0x50800c38` -> mdet_laf_end_frame_calc_cpu_func, 242, `0x50825b54`), 0x30000005 LAF's start request (`0x50800f4e` ->
mdet_laf_start_request_exec, 64), 0x30000001 LAF's start with its parameters (`0x50800c0e` -> mdet_laf_mode_change's
handler `0x5082e4f0`), 0x31000003 the chase cycle (`0x50800c59`), and the still, end, iauto and moving-object events.
Its messages come from MDET_E_SEND_CPU3 (`0x50800fe2`), which waits on its flag `(0x600436d8)` = 0x3007 for any of
0xfe77003e and sends one event per bit (mdet_laf_q_send, 40, `0x5080362d`, or mdet_iauto_q_send, 15): bit 29 the end
frame (0x40000008), bit 4 the start request (0x40000005), bit 21 the chase cycle (0x41000003), and so on
(`0x5080105e..0x50801336`). The bits are set by LAF's event setters (mdet_set_event_laf_*, trace ids 27..33, 39, 56, 59,
60), which the CPU 0 and CPU 3 callers post to CPU 3 through `0x508017b4(3, setter, argument)`, always by
sys_callrequest; `0x508017b4`'s own name table lists the eleven (`0x50801800..0x508018b9`).

**Who posts the end frame (D; the cadence I).** mdet_laf_end_frame_notify (55, `0x50803f9c`) posts
mdet_set_event_laf_end_frame (56); it is called only by mdet_laf_end_frame (95, `0x50825aae`) when `(0xa3379450) & 13`
is 13 (`0x50825af6..0x50825b03`). That word collects one LAF cycle: bit 1 from mdet_laf_exec_ems1 (86, `0x50824aad`), 2
from mdet_laf_exec_ems2 (87), 4 from mdet_laf_trc_tracking_color_callback (91, which calls mdet_laf_end_frame at
`0x508256f0` after setting 9), 8 from mdet_laf_trc_judge_color_callback (94); end_frame_calc clears it (`0x50825c64`).
The TRC callbacks are function pointers handed to the TRC driver (`0x508250b8`). A cycle starts with take_mov's
mdet_laf_chase_object, which copies its 272-byte request to `0xa33458e0`, registers its callback (above), locks the YC
buffer it names (`0x50802949`) and posts mdet_set_event_laf_chase_object_trc_e1 (33, `0x508029fd`). So the end frame is
the end of the chase cycle take_mov asks for, through EMS1 / EMS2 (the ISP front end's motion engines) and TRC (the
colour tracker of 2.2); that take_mov asks once per live-view frame is I. TAKE_MOV's start also calls mdet_laf_start
(63, `0x5081ee9d` from `0x506da292`, when its record's +2 has one of the bits 2, 4, 8, 16, whose meaning is ?), which
posts the start request; mdet_laf_start_request_exec then starts LAF's PDT / TRC side (X below).

**How the lab runs them (X).** S-MDETDL now runs four tasks: a task is due when its flag has a bit it waits for or its
queue a message; the queue 0x3005 is kept by the lab like the flags (OlyQeWr / OlyQeRd on its id: 16-byte messages in
order, waits without limit only; an empty read ends the queue task's turn and is an error anywhere else); flag 0x3007
joins 0x3003..0x3006. S-CPU3 serves the eleven setters (and `0x508251d2`, below) in interrupt context, as CPU 3's IRQ
324 drainer would, and then the due tasks' turns. Evidence: TAKE_MOV's call mdet_laf_start, made by the test, gave one
MDET_E_SEND turn and one MDET_CALC_MAIN turn for the start request, whose handler posted MDET_PDT_CPU3's dispatch
(mdet_laf_pdt_dispatch, 395, `0x50841edd`), which S-CPU3 does not serve, and the session stopped there, naming it. A
scratch run that posted mdet_laf_end_frame_notify after each offer ran end_frame_calc, mdet_laf_exec_trace (96) and
mdet_laf_calc_offer_data (124) natively once each before the chase callback's empty record trapped (above). CPU 3's code
runs with the core register `(0x8050)` at 0 (as for MDET_DL and DISP_FRAME since 5.3):
mdet_laf_ems2_img_fmt_and_id_clear_wrapper (89) calls mdet_laf_ems2_img_info_clear_delayint (88, `0x508251d2`) directly
when `(0x8050)` is 3 and posts it to CPU 3 otherwise (`0x50825324..0x5082538f`, D), so in the lab it comes through ring
[3][0] and runs after the turn (I). No stand-in posts an end frame. One that called the notify per offer would make a
state the camera does not reach (an end frame without the chase request whose callback end_frame_calc posts, D), and a
native chase cycle needs take_mov's 272-byte request (not read), EMS1 / EMS2 and the PDT / TRC unit at `0x9be00000` with
IRQs 278 / 279, which the lab does not model. So MDET_CALC_MAIN runs only when the firmware posts, and no lab session
posts yet.

**The AF area (D; X where marked).** The AF library's CPU 3 call `0x508c00a3` runs `0x5099d7d5`, sets +12 and +32 of its
info record and copies the record's 17 halfwords to LAF's buffer (`0x508c011f..0x508c012c`); the record is
`(0xa33d951c)` (`0x5099d714`). `0x5099d7d5` takes the AF target record `0xa33b015c` (`0x508c3ac8`): +0 the AF point, +4
its height, +6 its width, in the AF library's grid of 39 x 27 points (1053: `0x508c3fca`); column = point % 39, row =
point / 39 (`0x5099d7f6..0x5099d813`); the columns from c - w / 2 - 1 to c + w / 2 + 2 (clamped to 0..39) and the rows
likewise from r and h (clamped to 0..27), through the tables `0x60a63a48` (x: 0, 16, 33, .. 624, 639) and `0x60a63ae8`
(y: 0, 18, 36, .. 462, 479) into the record's +24 x0, +26 x1, +28 y0, +30 y1 (`0x5099d865..0x5099d8a5`), which LAF reads
as the area `0xa337f072..78` (5.6). The AF target record is copied by `0x508c51fa` from `0xa33d8be0` (`0x50974f61`),
which `0x5097500a` builds from the camera's settings through the property read when the flag `0xa33d8bea` is 1: +0
object 0x88b2 (the point; target mode 2 forces 526, the grid's centre, column 19 row 13), +2 0x84d1 (the target mode),
+3 0x9a41, +4 / +6 0x1dd1 [0] / [1], +8 0x1df1 (0 in modes 0, 2 and in mode 3 with height 3), +9 0x1e01. Writers: the AF
library's init `0x508bede6` (called by the boot chain at `0x501e9533`) sets the flag (`0x509748d7`), copies the target
(`0x508c70c0` -> `0x508c33c0`) and points `0xa33d9518` / `0xa33d951c` at `0xa33d8c5c` and `0xa33d9520` at `0xa33d8c80`
(`0x5099cbd9`); its settings step `0x508c388f` copies the target again when its mask has bit 1 (callers `0x508bf84c`,
`0x508c1821`, `0x508c37f4`, `0x508d0169`, `0x5091e707`, not traced). Before this round the lab ran none of it:
`(0xa33d951c)` was 0, so the FCS call wrote its record at addresses 0..0x22 and LAF copied the area from there (X).
Correction to 5.6: the (0, 0)..(33, 36) area was that, the zero target's columns 0..2 and rows 0..2, not an undriven
area of the AF library. The lab now runs those three init steps natively, in the init's order, at MDET's first request
(H-FCSAF); they log no error (X), where the whole init logs errors 0x1c005002 in the lab (X) and stays out. The lab's
settings are the firmware's defaults (X, through the property read): mode 3, point 526, 3 x 3; the record reads {526, 3,
0, 3, 3, 0, 0} and LAF's area x 279..361, y 196..284 (X), centred on MDET's frame (320, 240). What a running camera has
at live view is the user's AF target setting (I); S-AFOSD's frame at (400, 300) in DISP_FRAME's coordinates is the lab's
(I) and is not derived from this record. A later change of the AF target is not followed: the settings step does not
run.

**What runs now (X, E143).** `test_mdet.mjs`: at the offer that first reports the still rider (box {204, 203, 436, 447},
which overlaps the area) LAF marks it candidate 0, sets the tracking status (`0xa337f085` = 1) and its seen copy
(`0xa337f087` = 1), TAKE's callback runs (guard 1), and that offer writes no table (0x50839d79..0x50839da4, 5.6 item 4);
from the next offer the writer runs again, so it runs once per offer but that one, and the frame is the rider's list
record as before. `0xa337f082` stays 0 and mdet_laf_dl_internal_start is not entered. In the race (5.6) the near racer,
the one body in the area, is the candidate (LAF's slot 0, its centre), the far one is not, and both stay list frames.
`test_subject.mjs`: the rider moving at 3 m/s enters and leaves the area; at each change the table holds the offer
before for one offer (X: writes stop for one offer at the change, 5.6 item 4's branch with no candidate), and DISP_FRAME
still draws grey list frames. A main frame (kind 7 colour 4 per 5.1) and a part frame are not drawn: their state is not
reached, so their colours and what main against list means on screen are not verified here (5.1's D stands). U10 (when
TAKE clears request 1) is not on this path: TAKE's handler of message 81 is (I), and it does not run.

**Stand-ins (changed and new).** S-TAKEMDET: TAKE's registration of its status-change callback first. S-MDETDL: also
MDET_E_SEND_CPU3 and MDET_CALC_MAIN_CPU3, with flag 0x3007 and queue 0x3005 kept by the lab. S-CPU3: LAF's event setters
and the EMS2 clear. H-FCSAF (new): the three AF library init steps.

**Open.** The main and part records (U9): an end frame needs take_mov's chase cycle (its request, EMS1 / EMS2, PDT /
TRC). The other registrations TAKE's start makes (`0x506eac15`, `0x506eac34`, `0x506e64a4`) and what TAKE does with
message 81. The AF library's settings step at a change of the AF target. The EVF after `lv` (5.6) was not worked on.

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
  need. LAF's step from `0xa337b1e4` to the frame table (with U9): measured in 5.4 for one body, which LAF writes as
  the list record of its box (X), through the writer `0x5083a761` (5.5), and in 5.6 for two bodies with parts (a list
  record per body; the parts in LAF's rows 1 and 2, not drawn). judge_comb's pairing rule is read (5.6: a part pairs
  with the body whose box it overlaps, the nearest in centre and size); which object each part is per kind is ?.
- **U5** The engine's numerics (operand widths, rounding, activations); not decidable statically.
- **U6** What the `0x95xxxxxx` window is.
- **U7** What PDT stands for and what it computes; which face IRQ is which engine; the face engines' clock name.
- **U8** E134's detection lineage (blocks `0x010f` and `0x0111`) and E139's.
- **U9** MDET's state `0xa337f082 = 1`, in which its writer fills the main record (drawn as kind 7, colour 4) and the
  part record (kind 8, under frame mode bit `0x10`). Located in 5.6 (D, X): mdet_laf_dl_internal_start sets it, for a
  target part of subject 0, from LAF's frame trace on MDET_CALC_MAIN_CPU3 (exec_trace, which also runs the main and
  part writer) when subject 0 is a main-subject candidate; candidates are the subjects that overlap the AF area, which
  the setter copies from the CPU 3 FCS call `0x508c00a3`. Narrowed in 5.7 (D, X): the trap was TAKE's status-change
  callback never registered (fixed); the AF area is the AF target's cells in the AF library's grid, from the camera's
  AF target setting (H-FCSAF), and a subject under it is the candidate with its tracking status set natively;
  MDET_CALC_MAIN runs natively on the firmware's posts. The end-frame event comes only at the end of LAF's chase
  cycle (take_mov's mdet_laf_chase_object, EMS1 / EMS2 and the PDT / TRC unit, whose completions mdet_laf_end_frame
  collects), which the lab does not run, so the byte stays 0. Open: that cycle (take_mov's 272-byte request, the PDT /
  TRC unit), what the offer's `mag` byte is, the thresholds `0xa337ee8c` / `0xa337ee90`, and which of TAKE's
  conditions sets request 32.
- **U10** When TAKE's live-view request clears the subject-frame bit (`0x506d8dea`'s conditions in a running camera),
  and how `mdet_dl_start` is given the first kind. A lead (5.7, I): at a change of LAF's tracking status TAKE's
  callback posts TAKE message 81, whose handler `0x506d993e` rebuilds TAKE's live-view request; TAKE does not run.
  The lab's S-TAKEFRAME sets the bit while MDET runs on the live scene (5.5, I).
