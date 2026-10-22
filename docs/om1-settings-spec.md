> Status (2026-10): implemented by `emu/src/lab/menu.mjs` (store phase, `store='native'`), `emu/refs/settings.mjs`
> (offline decoder and reference) and `emu/src/dev/scpu.mjs` (`om1.scpu`); checked by `emu/checks/check_nav.mjs`
> (groups 0-2b, 4) and `emu/checks/check_menu.mjs`. Consolidated from three analysis reports
> that are not part of this repository (settings store, event path, page 6 / EVF layout) and what the M6
> implementation read or executed (marked "M6"). Corrections to those reports are listed in section 9.

# OM-1 settings store and the SCPU interface

Firmware = E143 v1.9 main block. Code addresses are disassembly notation (body offset + 0x50000000); data
addresses run-time (body offset + 0x60021020). Tags: **X** executed in the lab, **D** read from the code at the
cited address, **I** inference that a check tests, **?** unknown.

## 1. Result

The lab builds the camera's settings store the way a camera with blank backup memory and blank flash does: the
data-object registry bootstrap `0x50040aeb` and the settings-DB init `0x503c5473` run natively on K-native, after
DISPLAY OPEN and before the GUI task exists (X). The DB init takes its blank-store path, which resets every id to
the firmware's default table. Every settings read afterwards (the GUI's 0x50b7b618 included) is the firmware getter
on that store; the harness answers no settings read except S-PROP's property 4513 at its listed return sites
(section 4), two of which are in the store itself. Menu writes go through the user-setting manager natively
(section 5).

`check_nav` group 2b: the native getter equals the settings reference's (`emu/refs/settings.mjs`) prediction for all 27 ids the Setup pages read
(X, blank camera). Store init costs about 14 s per session (registry 0.4 s, DB init 13-14 s, with the GUI path's
property observer active; measured on the check runs).

## 2. Layers (D; STORE investigation, unchanged)

- Property store `0x503ee3bf(id)` / `0x503ee412(id, value)`: each id maps through a static table to an element of a
  data object: ids 0..2128 `{u16 kind, u16 index}` at `0x606217e4 + 4 * id`; 3000..3035 at `0x60623928 - 12000 +
  4 * id`; 4000..4022 kind at `0x606239e4 - 8000 + 2 * id` (`0x503ee5a9..0x503ee60c`, object cache `0xa31f426c -
  16000 + 4 * id`); 4500..4521 kind at `0x606239b8 - 9000 + 2 * id`; 10000..10111 at `0x60623a12 - 40000 + 4 * id`;
  15000..15287 at `0x60623bd2 - 60000 + 4 * id`. The index table `0x503ee740` covers only 0..2128, 3000..3035,
  10000..10111 and 15000..15287 and returns 0 otherwise, so 4000..4022 and 4500..4521 use index 0. Id 6000 has its
  own u16 cell `0xa31f2094`, checked before the slot map by the read `0x503ee3cd..df` (`movhu`) and the set
  `0x503ee430..44` (`movhu`). No default table or region row covers 4000..4022 or 6000.
- Element access `0x50041e7a`: width `kind & 3` (0 -> 4, `0x5003f78d`); `(kind & 7) == 4` u32, `== 2` u16, else u8;
  `btst 8,d3` at `0x50041e84` (mask 8, bit 3 of the kind) selects the sign-extending loads (`exth` `0x50041e9a`,
  `extb` `0x50041ea0`). Kind 0 = no slot, value 0.
- Data-object registry `0x5004092d(kind)`: 8-byte entries at `0xa32a990c + 8 * (kind >> 4)`; a missing object logs
  errlog `0x1c005002`. Objects are created by `0x50040990` from lists `{u16 kind, u16 count, data}`: the image list
  `0x600979e0`, then the stores F/B/E/M (layouts `0x600bcac4` / `0x60097964` / `0x600bef28` / `0x600e6034`, lists at
  layout + 8) and `0x628cc700` (`0x5004077c..0x500407da`).
- Descriptor DB `0x60615de4`, 1607 x 20 bytes, hashed by `0x503dad83` (lookup `0x503da999` -> `0x503dadda`):
  `{u16 id, u16 key, u32 *allowed, u32 *values or 0, u16 bytes, u16 element size, u8, u8 type}`. The hash appends each
  record at the tail of its bucket chain (id & 127, `0x503dadb9..ca`) in table order and the lookup compares the id
  only (`0x503dadef..f4`), so an id resolves to its first record in table order. 28 ids have two or three records;
  for 25 of them the u16 at +2 is 85, 128, 256 and the first record is the key-85 one (e.g. 3415: 61 allowed values,
  not the 41 of its key-128 record; 6, 1671, 1672 have no key-128 record). `0x503da999` does not read +2; a second
  lookup `0x503da9a2` -> `0x503dae04` walks the same chain and matches the id (`0x503dae1b..1d`) and +2 == d1
  (`0x503dae20..24`). It has 10 callers, among them the value mappings of custom objects with a key selector at +20:
  the getter (`0x503c5c91 calls (a3)`, key -> d1, `0x503c5c98` -> `0x503da8b8`) and the setter (`0x503c5cd7`,
  `0x503c5cde` -> `0x503da8e6`). The 18 ids with a key selector (2, 3, 4, 6, 17, 86, 140, 475, 490, 491, 1667..1672,
  2089, 2090) all have several records; the selector is `0x503c589b` (raw property 64, allowed 85/128/256, default 85)
  or `0x503c58b9` (raw property 141, 85/256, default 85) (D). That the keys are step sizes in 1/256 (85 = 1/3,
  128 = 1/2, 256 = 1; the key-85 list of id 3 is 0, 85, 170, 256, 341, 426, ..., that of id 2 the same steps from
  64256 = -1280 as s16) is I, not decoded. Who passes keys for the other 10
  multi-record ids (529, 612, 639, 894, 895, 1205, 1206, 3415, 3429, 3430) is ?. `check_nav` group 2b compares the lab
  lookup with `Settings.descriptor` (`emu/refs/settings.mjs`) for ids 0..16383 and the lab's key-selector ids (custom-object lookup
  `0x503c681f`, +20) with the settings reference; harness writes (SET, S-PERSIST, seeds) refuse key-selected ids. Those writes are raw
  (`0x503c49f7`, `0x503ee412`) and do not map through a key, but which raw values are allowed and what the getter
  returns for them depend on the keyed record. The type is
  the byte at +17 (`movbu (17,a0)` at `0x503da6a5`/`0x503da622`; 6 = group). The allowed list has bytes / element
  size entries, searched as u8 (size 1) or u16 (size 2) by `0x503da696`; other sizes are not searched.
- Getter `0x503c49ab` -> `0x503c5c26`: custom object (`0x605c4680`, 262 x 60, key selector at +20, see above) first;
  then by class
  (0 no descriptor: raw property; 1 group; 2 descriptor). For class 2 `0x503da5dc(id, raw)`: index of raw in the
  allowed list (`0x503da64c` -> `0x503da724`; not found or out of range -> 0, `0x503da736`), then the value table
  `[index]` if the descriptor has one (+8), else raw.
- Setter `0x503c6511(id, value)`: custom setter (+52), group, or `0x503c5c09` (`0x503ee8d7` copy, `0x503ee412`), then
  the notifications `0x503c693f`, the custom object's +24 callback and `0x503c71c0` (observers `(0x60357288)`,
  `(0x6035728c)`).
- User-setting manager (GUI side): singleton `0x50b7b5c3` (`(0x60361c10)`), get `0x50b7b618`, and two set paths (D):
  - raw: `0x50ac4afe(id, value)` -> `0x50ab51d5` (lock `0x50b7df71`, `0x503c49f7` -> `0x503c6511`, unlock
    `0x50b7df91`); the value goes to `0x503c6511` as given. The harness SET uses it (section 5).
  - value: `0x50ab51a1(id, value, flag)` (lock, `0x503c49b4` -> `0x503c5ca7`, `0x50b7dfd3` when flag != 0
    (`0x50ab51bd..c3`), unlock). `0x503c5ca7` maps the value to raw before `0x503c6511`: unchanged for an id
    without a descriptor (`0x503da932` == 0); through the keyed record `0x503da8e6` for an id with a key selector
    (`0x503c5cc2..de`); otherwise through the inverse map `0x503da603`, which returns the value unchanged when the
    descriptor has no value table (`0x503da60d..19`). The menu's vt+4 writes take this path (section 5).

## 3. The SCPU interface `0x98e00000` (`om1.scpu`)

`0x98e00000..0x98e000ff` is the firmware's register window to the sub-CPU that keeps the clock and the backup words:
debug strings `"[SCPU] Set time complete."` (body `0xf95a8`), `"ScpuBkupW"`/`"ScpuBkupR"` (`0xf9428`/`0xf9432`);
driver `0x5004dc55..0x5004e520`, a second copy `0x51a7029f..` in the standby code (D). The store investigation called
the same block "retained registers"; both views are one device. Every firmware access is a 32-bit `mov`.

| offset | model | firmware evidence (D) | lab evidence (X) |
|---|---|---|---|
| 0x00 | 32-bit storage, reset 0 | bits 7..2 a signature: `0x5004e384` reads `(v >> 2) & 63`, `0x5005a5a7` wants 42; written by `0x5004e36d` (42 at `0x5005a72c` after a set read back within 5 s, 0 at `0x5005a737`). Other bits stored as written, meaning ?: bit 10 (`0x5004e394`, `0x500027ce`), bit 9 (`0x5004e3e3`), bits 31..24 (`0x5004e3b1/ca`), bit 1 (`btst 2` = mask 2 at `0x5004ddc4`) | DB init reads it, writes 0xa8 (42 << 2); page 6 reads it |
| 0x08..0x3c | 14 x 32-bit storage, reset 0 | store B (layout `0x60097964`, 56 bytes): reader `0x5004e4de` (`mov (d0,a0),d0`, a0 = `0x98e00008`, index clamped to 13), writer `0x5004e4c9` | the registry bootstrap reads all 14 |
| 0xe8 | 32-bit storage, reset 0, does not tick | seconds since 1970: `0x5012bf86` (86400, 1461-day cycles, `add 1970`); written at `0x5004e347`, read back at `0x5005a71f` | DB init writes 0 and reads it back; page 6 reads it |
| 0xec | 32-bit storage, reset 0 | bits 14..5 = 1/1024 s (`0x5005a5dd..f0`); written at `0x5004e355` (d1 == 1 only) | DB init writes 0; page 6 reads it |
| 0xf4 | command: a write is stored, counted and printed (`om-emu: scpu command 0x... pc ... #n`); a read returns 0 | 0x20041001 written, then polled until 0 (`0x5004e31d..27`, `0x5004e35f..69`, `0x5004de49..62`, `0x500027c0..ca`) | DB init: read, write 0x20041001 (pc `0x5004e35f`), read; one command per session |
| any other offset, width or alignment | UNKNOWN: bus error, `om-emu: scpu UNKNOWN ...` | 0x04 (`0x5004e4f3`, callers `0x5014e4f4`/`0x5014e864`), 0x58, 0x80..0xdc, 0xe0, 0xe4, 0xf0, 0xf8: driver init, TX/RX `0x5004e000..0x5004e2ff`, boot `0x50002770..d8`, standby | never reached |

Lab assumptions: **A-SCPU-1** a command completes before the first poll (the poll loop's exit value, like the
panel-stub presets); **A-SCPU-2** reset 0 everywhere = a camera whose backup memory is blank, matching the zero flash
copy the registry reads. What a command does in the sub-CPU is ?; the model only stores. Debugger reads return the
storage of any aligned offset; the harness writes MMIO with a CPU store from harness code
(`DisplayLab.cpu_store`, `emu/src/lab/display.mjs`), because the debugger's writes do not reach MMIO (X: a debugger
write of 0xe8 left it 0).
The image addresses 35 distinct offsets with `0x98e000xx` immediates (`check_nav` group 0 lists them as modelled or UNKNOWN; the per-offset counts are pinned by the `SCPU-IMMEDIATES` line of `check_nav_notes.txt`, group 6); 0x00, 0x08,
0xe8, 0xec and 0xf4 are among them, 0x0c..0x3c are reached only through the indexed reader/writer.

## 4. Init path and its stand-ins (M6, X)

Order of a session (`MenuLab.bring_up` in `emu/src/lab/menu.mjs` with `store='native'`): K-native boot and lab task, routing, CTORS, CHANGE task, DISPLAY OPEN; store init; S-PERSIST inputs; dial-table init; GUI creation. The store init runs before the GUI because the GUI's bring-up reads settings (3009 for the language load); on the camera the order between the init task's `0x501eac42` and GUI creation is ? (store-init order). Running it before DISPLAY OPEN would be closer to boot (the registry bootstrap follows the flash read at `0x500093ec`); M8 adds that order as an option (`MenuLab(store_first=True)`, `emu/bin/nav.mjs --store-first`): the store init runs after display task init and before the first OPEN. check_nav N8 and the player's EVF starts (H-STOREFIRST, PLAYFIX: the EVF OPEN's eye-callback registration then reads property 1947's default 1 and arms no burn-in timer, vsc spec section 9 item 10) use it. With it the TFT OPEN reads the store: the display message handler `0x501d8e24` (after the state read `0x500417da(0x7701)` at `0x501d7e0b`) gets mode 1/2 instead of 0 and ORs bit 6 into CTRL3 and CTRL2 through `0x501e04b7` (returns `0x501d8e6f`, `0x501d8e8a`, executed), so that first TFT composite rests on A15 (vsc spec section 7); in the default order it logs `0x37005208` instead. After a switch to the EVF and back the TFT is not at CTRL3 `0x41` (check_nav N8); why the second OPEN leaves no bit 6 is not traced.

The display path reads four kinds through the camera-state read `0x500417da`; the data-object table `0x606217e4` (`{u16 kind, u16 index}` per id, section 2) gives their ids (D): `0xe831` = 587, `0x4671` = 1947, `0xd7f9` = 449, `0x8279` = 31. On the native store they read 1, 1, 0, 0, the settings reference's defaults (check_nav N8); in the kernel-less labs the store is empty and they read 0 with `0x1c005002`. Kind `0xe831` decides the EVF switch's PLANC path (vsc spec section 9.3). Which menu rows write them is ?.

1. Registry bootstrap `0x50040aeb`: prints `FlD.` `BlD.` `ElD.` `MlD.` (every store built from its image template,
   "l D"), no errlog.
2. Settings-DB init `0x503c5473` returns (blank path, `0x503eefdf` != 0): steps 1-3 as in the STORE report (reset
   `0x503d9cdd` -> `0x503d9bf3`, region overrides); step 4 `0x504205d2` -> `0x5012b78c` fills a date struct
   (status 10501, `0x5012b91f`), sends it to the SCPU task (`0x5012c7d9` -> request `0x5005cd17`, wait flag 0xf7)
   and calls `0x5005a57c` = `0x5005a6fa(0, 1)`, which sets the clock to 0: register sequence R f4, W e8 = 0,
   W ec = 0, W f4 = 0x20041001, R f4, R e8, R 0x00, W 0x00 = 0xa8; the last call `0x503eee94` is skipped
   (S-FLASHSAVE: it would save the freshly reset stores E and M to flash, see the table).

| stand-in | what | evidence |
|---|---|---|
| K-CFLUSH | `0x5004e68a` returns at once; only from the call at `0x50040863` (return `0x5004086a`), others raise; 4 calls per session (check_nav group 2) | cache maintenance with a cross-core handshake: clears bit 1 (mask 2) of low-RAM `(0x8070)` (`0x5004e693..9a`), then loops while bit 3 (`btst 8` = mask 8) of it is set (`0x5004e69d..ac`); reads 1024 words each at `0x28a00000`/`0x28a80000`; sets bit 4 (mask 16) of a per-core register picked by `(0x8050)`: `0x98100000` for 0, `+ 0x400` for 1, `+ 0x800` for 2, `+ 0x1000` for any other value (`0x5004e6ce..0x5004e70e`, unmapped), and polls until that bit is clear again (`0x5004e716..27` for 0). Who clears bit 3 of `(0x8070)` and the register bit is not shown by this code (?) |
| K-CRT-134D | `0x3ffe134d` returns the board's SCPU counter (`menu.mjs` `SCPU_CLOCK`: `0x98e000e8`; `0x98e00098` on the E144 family, whose window reads it: E144 `0x516824a1`, E137 `0x51462486`, D), as the window code does; from any caller | `call 0x3ffe134d; mov d0,(0x62965138)`; no other abs32 reference to `0x62965138`; per-core C-runtime window (lands mid-instruction at `0x5000236d`); the window code at `0x51a7034d` is `mov (0x98e000e8),d0; retf`, so the real call returns SCPU register `0xe8` (D, cores spec 8). E137 also reads it in an operating-time count that E143 and E144 stub out with a `retf` (E143 `0x5005a6db`, E144 `0x50050dc9`): `0x5004d531` adds the time since the start (`0x61f275f4`, kept by `0x5004d521`) to a NAND record at `0x40680000` through `0x50039157` when the counter has advanced, logs `0x19001003` when it went back and does nothing when it is equal; the lab's counter does not advance without S-SCPU-CLOCK or S-NVRAM, so the start's count writes nothing (D; X, a probe of `0x50039157`); with an advancing counter the NAND update would run natively, which is open |
| S-SCPU-MSG | OlyEvWt `0x5002bdd8` on the four SCPU flags `(0x6004315a/5c/5e/60)` returns E_OK with the waited pattern; only from the call at `0x5005a7f2` (0xf5), `0x5005a858` (0xf6), `0x5012c876` (0xf7), `0x5012c8cc` (0xf8), others raise. One wait each on 0xf5, 0xf7, 0xf6 per session | requests to the SCPU task (`0x5005cd17` posts to `(0x600431bc)`), which does not run. The request bytes are recorded; the reply bytes consumed after the 0xf6 wait (`0x5005a86c` reads `0xa32c6502..05`, boot-zero `00000000`) are pinned as SCPU_REPLY_UNMODELLED, never written |
| S-FLASHSAVE | `0x503eee94` returns, d0 unchanged; only from the call at `0x503c5530` (return `0x503c5537`), others raise | a save of stores E and M to flash: it builds the request {mode 1, B 0, F 0, E 1, M 1, 0} (`0x503eeec3..d5`) for `0x50041f56`, whose mode 1 (`0x50041f7a..0x500420b6`) is the save path (success prints `FS.` `F1S.` `BS.` `ES.` `MS.`, strings `0x601151a4..b9`; loads print `lD`/`lR`). Per flagged store `0x5003f5dd` returns 0 if the RAM object equals the current flash slot (`0x50003881`), else picks the next slot (`0x5003f4ba`), copies, calls K-CFLUSH and programs the flash controller `0x98d01800` (unmapped; `0x5003d9da`/`0x5003d95c`). The DB init's last call on the blank path, its d0 discarded (`0x503c5537 mov a2,d0; ret`); skipping it loses nothing while persistence is not modelled |
| S-PROP (extended) | property 4513 answered with the display device at return sites `0x503d72c5` and `0x503d2551` too, reached once the descriptor hash exists; the native value after init is 0 (pinned in `check_nav_notes.txt`) | `0x503d72c5` is a bit-4 test (`and 16,d0; cmp 16` at `0x503d72c5..cd`). `0x503d2551` is the raw property read in the setting-rule evaluator `0x503d23e7..0x503d25a6`: it compares exth(value) with the rule entry's s16 at (2,a2) (`0x503d2568..72`) and ANDs the entries of a group. All 11 rule entries for 4513 (`0x605c9e84`, `0x605c9eac`, `0x605c9ed4`, `0x605c9fdc`, `0x605c9ffc`, `0x605ca01c`, `0x605cce70..0x605ccee8`) require 4513 == 8, next to terms on 44, 1417, 453 (finder style) and 451. TFT (1) gives the same outcome as the native 0; EVF (8) makes the term true: in a 13-step EVF navigation run 2 of the 10 groups that read 4513 there evaluated true (TFT: 0 of 10; X, rule result a2 at `0x503d2585`). Which rules those are and what they change is ? |
| S-PERSIST | experiment inputs written raw with `0x503ee412(id, value)` after the DB init and before GUI creation; each read back through the getter | stands in for a persisted store M (the store S-FLASHSAVE would save) that the lab cannot load: every listed id and every seed id checked has its data object in the M list (layout `0x600e6034`): 3009 kind 0x85e1, 1881 0x3e91, 1882 0x3ef1, 1883..1924 0x3f01..0x44a1, seeds 32 0x81d2, 21 0x8211, 115 0x9502 (`Settings.slot`); ids 3009 (one of the 18 language setting values), 1881, 1882, the cursor memories (the union of the tab table's +8 lists, 1883..1924, My Menu's 1920..1924 included; `persist_ids` in `menu.mjs`) and validated seeds; scalar descriptor ids only (the firmware's own lookup `0x503da999`, type != 6, value in the allowed list, no key selector at custom object +20, section 2); a raw set sends no notifications |
| S-DIAL | `NavSession`: before a dial event the u16 counter at `0xa32daab4 + 16 * slot + 8` (+) or `+ 10` (-) is set to 1 | the reader `0x5014ba55..78` returns `(+10) - (+8)` and clears both; who increments them on a camera (the UI_IN scan) is ? |
| S-SCPU-CLOCK | the nav token `CLOCK:epoch`: one CPU store of 0xe8 | the counter does not tick in the lab |

The dial-table init `0x5014b7c7` runs natively (`(0xa32daab0) = 0x60223e3c[8 * movbu (0x97f00254)]`). Its input,
the board byte `0x97f00254`, is S-BOARD: at boot the board-ID routine sets it (`0x50002b93..dc` reads bit 4 of GPIO
`0x9b881200`/`0x9b8811c0`/`0x9b881180` into a 3-bit value, `0x50002f97` maps it through the pairs at `0x600297a8`
(0,0)(1,1)(2,2)(3,4)(4,3)(5,5)(6,6)(7,7), terminator 0xff: it stores 0xff first (`0x50002fa0`), on a match stores the
pair's second byte (`0x50002fbe`) and loops at `0x50002fc7` only if that byte is 0xff; without a match it returns with
0xff (`0x50002fcf`); no pair maps to 0xff and the input is masked to 3 bits (`0x50002fb2`), so neither happens). The lab does not run that
routine, so the byte is the lab's zeroed SRAM: board 0, which board the OM-1 is is ?. The 8 entries of `0x60223e3c`
{id table, channel-config table} hold two distinct pairs: board 0 -> (`0x60223dbc`, `0x60223e0c`), boards 1..7 ->
(`0x60223d9c`, `0x60223ddc`). Both id tables list the same ids in the same slots, and the GUI read `0x5014bb88`
compares ids only, so the slot a dial reads does not depend on the board. The second word of each entry does: main
dial 0x102 (board 0) vs 0x2, sub dial 0x3 vs 0x103 (the byte at +5 swaps between the dials), and the encoder init
`0x5014b7fd..0x5014b86b` (`0x50059f57`) gets channel configs 0x00133004/0x300 vs 0x00033004/0x310. Both are leads for
the dial direction (ROADMAP). The flash controller stays unmapped: any other path to it (the flush `0x500421cd`, the language post-set
path) stops the run.

Not needed in this order (X): the store investigation saw DB-init step `0x503c7469` write `0x9b880cc0` at
`0x5005221d`; with the store init before the GUI and `om1.scpu` that write is not reached, so no lab-stub page is
opened for it (it would be DENIED).

Lab cost (X, PERF): most of the lab's guest instructions run in one loop of the store init's call tree, the 13-instruction search loop `0x503da0e1..0x503da10c` (`setlb` at `0x503da0e0`, `llt` at `0x503da10c`) inside the per-id loop `0x503da0ca..0x503da131` of the function `0x503da052` (frame `[d2,d3,a2,a3],44`). A profiling run in the PERF investigation counted 139,417,088 `llt` in check_menu and 67,042,280 in check_nav; at 13 instructions per iteration that is 75.7% of check_menu's 2,394,927,214 instructions and 70.2% of check_nav's 1,241,465,591. `0x503da052` is called from `0x503d4042`, `0x503d40cd` and `0x519c900b` (CALL sites, D); which of them the store init reaches is ?. `emu/checks/check_perf.mjs --bench` runs this loop copied from the image.

## 5. Writes

- Harness (the nav token `SET:id=v`): the manager's raw path `0x50ac4afe(id, v)` (section 2), scalar ids without a key
  selector and listed values only (X: 32 = 180 reads back 180, page 5 then paints "3min").
- Menu: API vt+4 `0x50b4f28b` writes through the manager's value path, not the raw path SET uses (D): its default
  dispatch `0x50b4f3f4` calls `0x50b7be74`, which reads the current value (`0x503c4ba8`), computes the value to write
  with `0x50ab68e9` (`0x50b7bed0`), writes it with `0x50ab51a1(id, v, 1)` (`0x50b7bf0d`) and then calls `0x50b7d3c6`,
  `0x50b693b0` and `0x50b698ad`. What `0x50ab68e9` and those calls do is ?. For the ids SET accepts (no value table,
  no key selector) the value-to-raw step of `0x503c5ca7` returns the value unchanged; SET still skips `0x50ab68e9`,
  `0x50b7dfd3` and the calls after the write. X: every vt+4 write of a blank `RIGHT MENU OPEN` run logs `0x50b7be74`,
  `0x50ab68e9`, `0x50ab51a1`, `0x503c49b4`; `SET:32=180` logs `0x50ab51d5`, `0x503c49f7`. `0x50ab95a4` only writes a trace record (a slot
  from `0x50ab9884`, tag | 0xe2000000, four u16 arguments, a timer read `0x50002bf2`, `get_tid`); `0x50ab4bf2` is a
  general "may this setting change now" check: it compares the id with 15258, 284, 42, 29, 15273, 4, 1445
  (`0x50ab4bf6..0x50ab4c27`, setting 1444 at `0x50ab4c3b`) and 892, 894, 266, 15267 (`0x50ab4c7d..b2`,
  `0x50ab4cd9..0x50ab4d07`). Id 15258 is refused with reason 6 when `0x50ab3e20()` != 0 (`0x50ab4bfc..0c`); ids 4
  and 1445 with reason 6 when setting 1444 == 1 and `0x50ab3e20()` == 1 (`0x50ab4c3b..59`). Ids 284, 42, 29 and 15273
  branch to `0x50ab4c2f`, which clears the caller's (a0) = (40,sp) (vt+4 then skips `0x50ab42cb(1)`,
  `0x50b4f39a..a2`) and jumps to the id-32 test `0x50ab4d41`, so none of the following tests run for them. Every other
  id (15258, 4 and 1445 when not refused) tests bits of setting 477 through `0x50ab5716` (reasons 1, 2), calls
  `0x50ab4d66` and `0x50ab4daf` (reason 3) and `0x50ab5780(5)` (reason 4). For id 32 (Sleep) it calls
  `0x50ab5092(32, 2, 3200, 0)` and refuses with reason 7 when that returns nonzero (`0x50ab4d41..5d`). The reason goes
  to (a3) = (44,sp) and on to `0x50ab2572` (`0x50b4f30f..11`); a refusal makes vt+4 return 0xf0000058
  (`0x50b4f30b..38`). What each test means is ?; every observed write passed it (X). The write `0x50b4f3b3..0x50b4f3f4` dispatches on the caller's d1: 1/2/3 -> manager
  methods `0x50b7c012`/`0x50b7bfc2`/`0x50b7bf72`, any other -> `0x50b7be74(id, a1, kind)` (D). Every menu write seen
  has d1 = 0 and returns 0 (X): the memories on MENU (1881, 1882, the page's cursor memory), 1446..1449 = 3200 on
  each OPEN, and the value popups (32, 21, 115 with their list values). a1 is a value for all of them.
- After a value-popup OK the GUI starts Genifa timer 522 (`0x5124f980(522, 100)`, e.g. `0x51162e33`) and sets its awaited event `(0x603710f8)` = 0x9ac6 EVT_10MS_WIZARD_MENU (`0x5115c64e`); until that event arrives GuiCallerImp re-posts every other event (`0x5115c4fd..0x5115c5f6`). The Genifa timer task `0x510c1d01` waits in OSAL `0x50b81c5c(-1)`; 1500 K-TICK ticks did not wake it (X), so its time source is not the kernel tick (blocker B7). The value is in the store (getter reads it back). With lab time (M9, `emu/bin/nav.mjs --time`) the 2 ms software tick drives the Genifa timers and the event arrives: the popup closes with the written value shown (menu spec 13.7, check_nav N3T).

## 6. Defaults (`emu/refs/settings.mjs`)

Value after the blank-store init = getter(raw), raw = element(default table entry), the element stored with the
slot's width and read with its sign rule (section 2):

- default tables `0x605f9200` (ids 0..2128), `0x605fb344` (10000..10111), `0x605fb504` (15000..15287) (`0x503da453`),
  written by `0x503d9bf3` (D);
- region overrides `0x605fe664`: rows `{u16 region, u16 n, u16 *ids, u32 *values}`, regions 1, 2, 3, 10, 8, 9 and the
  terminator 0; the walk `0x503d9c69..86` stops at the matching row or at the terminator, whose entries are applied
  too. Every row, the terminator included, sets 3010 = 0 and 3009 = 1, so 3009 = 1 (English) whatever property 4508
  holds (D; the lab's 4508 comes from the F layout list, value 0);
- not modelled, each raises in the settings reference: ids with a key selector (`0x605c4680` +20, section 2), group descriptors, the
  mode-dependent defaults `0x605e9198` and the per-mode steps of `0x503d9cdd`, ids whose data object is in no image
  list. None of them is read by a Setup row that `check_nav` compares.

The reference's self-test (`self_test`, run by check_nav group 0): the 2529-id default table is pinned by a digest that equals the store investigation's
independent dump, plus the investigation's executed spot values.

## 7. Persistence

None: the store is RAM. Values survive leaving and reopening the menu within a session; a new session starts from
the blank-store defaults plus its S-PERSIST inputs. Blockers: the flash controller `0x98d01800/04` (`0x500014e6`)
and the per-unit flash contents (store F at flash `0x400a0000`, 128 KiB). The blank path saves stores E and M to flash
at once (S-FLASHSAVE); when the camera saves otherwise is ?.

## 8. Page 6 clock

The clock row's handler `0x511bf7a2` asks the API (`(0x60361294)` vt+0 `0x50b402c3` -> `0x50b57259` -> property
1468 == 0 -> `0x50b57337` -> `0x5041fb85` -> `0x5012b7cd` -> `0x5005a59e`) for the date; `0x5005a59e` converts
(0xe8, 0xec) and `0x5012b9ab` accepts only 2000..2099 with valid month, day and time, else the date becomes
2022-01-01 with status 10501 and the row shows dashes (D, X). The handler writes the strings into variable 226 at
+1644 + 20 r (date) and +1784 + 18 r (time); they are not drawn through DrawText `0x510ab0f9`. With the firmware's own
e8 = 0 (1970) the row reads `'--.--.-- --:--:--`; with S-SCPU-CLOCK 1791369000 it reads `'26.10.07 10:30:00`
(X, `check_nav` N4: the string equals the epoch formatted as UTC in this format, and a second epoch changes only
the clock cell).

## 9. Corrections to the investigation reports

| id | report claim | what the code says |
|---|---|---|
| C1 | API vt+4 is a request to a camera-side server (EVENTS 4.2) | a write through the user-setting manager's value path `0x50ab51a1` (section 2); `0x50ab95a4` is a trace record (section 5) |
| C2 | DB-init step 4 reads the retained block back (STORE 2) | it fills a date struct, sends it to the SCPU task and resets the clock to 0 (section 4) |
| C3 | step 5 reloads store F, the run's stop (STORE 2) | it saves stores E and M to flash (mode 1 of `0x50041f56`, the "S" prints); it is the blank path's last call and its result is unused: skipped (S-FLASHSAVE, named S-FLASHRELOAD in the design), the init returns |
| C4 | the dial table is a harness assumption (EVENTS 4.3) | `0x5014b7c7` is self-contained and runs natively |
| C5 | the SCPU model needs presets (B1B2) | the firmware writes reg0 = 0xa8 and e8 = 0 itself; a preset is only the clock input |
| C6 | +4 is a retained flags register (STORE 3) | `0x5004e4f3` touches it, never reached in the lab: UNKNOWN |
| C7 | element sign extension by kind bit 8 (STORE 1.3) | `btst 8,d3` tests mask 8 = kind bit 3 (`0x50041e84`); with bit 8, 161 (default 255, kind 0x9991) would read -1 |
| C8 | S-FLASHRELOAD (now S-FLASHSAVE) return address `0x503c5534` (design) | the call at `0x503c5530` is 7 bytes: return `0x503c5537` |
| C9 | descriptor type at +19 (design) | +17 (`0x503da6a5`) |
| C10 | K-CFLUSH 4 + 1 calls (design) | 4, all from `0x5004086a` (X) |
| C11 | INFO has no effect in the menu (EVENTS) | with the native store INFO shows the row's help (variable 226 +2421 = 1) |
| C12 | the "File Name" write passes a pointer (EVENTS s5) | natively OK opens a value popup and the popup's OK writes 21 = 1 ("Auto"), a value; why the EVENTS run (empty store, S-STORE/S-WRITE) saw a greyed row and a pointer is not established; its MENU loop has the B7 deferral's shape |
