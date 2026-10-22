// The camera models the lab knows: each one's firmware release (the .BIN the vendor's updater API serves for its code),
// the two blocks the lab reads (main code, resources) and their digests (BLOBS.sha256 and the resource prefix). E143 is
// the build every address in src/lab is written against; another model translates those addresses through A()
// (src/fw/model.mjs, backed by src/fw/ports.mjs from bin/port.mjs and the cross-build map src/fw/xmap.mjs). `overrides`
// places an E143 address the map cannot (hex E143 address -> {to: hex address or null, why}). `panels`: the TFT and EVF
// sizes the VSC model composes at (the firmware programs the channel; these are the panels the vendor's specifications give).
// `image_base`: the run-time address of the main block's byte 0 (src/fw/model.mjs IMAGE_BASE), which import-time
// constants need before any image is read; src/fw/facts.mjs imageBase reads it from the reset head, and
// test/test_facts.mjs checks every entry whose block is unpacked against that rule.
// `res`: the size limits of the font and string slots the resource loader copies a language's records to (the `cmp
// imm32` after each slot's mov in the loader that follows the index read; E143's are 0xC7C00 at 0x501a8f35 and 0x5FC00
// at 0x501a9197, D), read through src/fw/model.mjs fact(). bin/port.mjs reads them on every model it ports
// (src/fw/facts.mjs resLoader, into src/fw/ports.mjs FACTS), so an entry gives them only until its port does.
// `port_via`: a model ported before whose hand overrides this one takes over through the map between the two builds
// (bin/port.mjs, src/fw/place.mjs carryOverrides), where they pair better than either does with E143 (the evidence at
// the entry); the model's own overrides come first. `carry`: the reference's knobs that hold addresses (src/fw/knobs.mjs)
// this model takes through the same map, each checked by its kind (src/fw/ports.mjs KNOBS, read through knob() in
// src/fw/model.mjs); a knob is either carried or given here.
// `board`: the board family (src/fw/board.mjs FAMILIES) and the facts this model gives by hand where its firmware's
// differ from the family's or no rule of src/fw/facts.mjs reads them yet, each with its evidence; a fact the port
// reads (FACTS[code].board) is not given here too.
import { OVERRIDES_E144 } from './overrides-E144.mjs';

// The VSC register blocks the kind-1 compositor composes without (board vsc.unapplied; src/dev/vsccompose.mjs A21):
// the highlight block (HIAREA1..3, HIBC, HILIGHT1..4: 0x48c..0x494, 0x4cc, 0x5d0..0x5dc), which E147's playback detail
// turns on for its highlight and shadow warning, and the NV block (NVEN, NV11SET1..NV23SET6: 0x9a0..0xc54), which E147
// sets for its EVF (X). Open: what either does to the panel's picture; the composite shows the planes without them
const VSC_UNAPPLIED = [[0x48C, 0x494], [0x4CC, 0x4CC], [0x5D0, 0x5DC], [0x9A0, 0xC54]];

// H-G4SET not applied (src/lab/play.mjs g4set): UI_IN's group 4 is pushed like the other groups. A stand-in on the
// bodies that give it, while their group-4 producer (the port places E143's) is not checked: start and S1 run so (X)
const G4SET_UNCHECKED = false;

// S-NOPOWEROFF (src/lab/play.mjs call_skips, at a fact path): the power-off post in the PC sub-app state's
// USB-disconnect handler (its traces "UsbDisconnectSubAppStatePc" and "startPowerOff", read by src/fw/facts.mjs
// usbPowerOff, fact power_off.usb_disconnect) is stepped over. Run, the start leaves shooting (each body's entry gives
// what it saw); stepped over, the GUI stays in shooting (0x108) and takes S1 (X). A stand-in while the start state a
// power-switch start leaves is open (docs/model-survey.md, E144)
const NO_USB_POWER_OFF = ['power_off.usb_disconnect', 'S-NOPOWEROFF',
  'start power-off: the start state that avoids it is open'];

export const MODELS = {
  E143: {
    name: 'OM-1', bin: 'OLY_E_143_1900_0000_0000.BIN', version: '1.9', res_block: 'blk02000000.OE.0101.bin',
    rom_len: 33554368, rom_sha256: '7f791611580925f3550d394baa9e8cca4e8f4c38e427ccd498170e8d1feb67e9',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10031072, res_sha256: '03a18d68e950ab0f55df3f1379d26ace4ee654a6e4a276bc8872daa1e9ebfa6c',
    panels: { tft: [900, 600], evf: [1600, 1200] },
    board: { family: 'E143' },
  },
  E146: {
    name: 'OM-1 II', bin: 'OLY_E_146_1300_0000_0000.BIN', version: '1.3', res_block: 'blk02000000.OE.0101.bin', checked: true,
    rom_len: 33554368, rom_sha256: '125c9ff8f43396f48f55b9b3a62279a9fea29623038e02cb4b397f6a76c7c95c',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10176992, res_sha256: 'b05dac40db4a90d93476a46a705611f4653cfde224befd3bdbd46427d4c41a6b',
    panels: { tft: [900, 600], evf: [1600, 1200] },
    // E143's board; the compositor leaves the register blocks VSC_UNAPPLIED unapplied, as on E147 (I: which of them
    // E146's firmware writes was not read)
    board: { family: 'E143', vsc: { unapplied: VSC_UNAPPLIED } },
    vsc_extra: [0x6800, 0x1400],
    touch: false,
    g4set: G4SET_UNCHECKED,
    extra_tasks: [
      0x501DC568,   // started by the display task init (E143 0x501c2f13 starts no task; E147 starts 0x501e3eca)
    ],
  },
  E147: {
    name: 'OM-3', bin: 'OLY_E_147_1100_0000_0000.BIN', version: '1.1', res_block: 'blk02000000.OE.0101.bin', checked: true,
    rom_len: 33554368, rom_sha256: '5e8d376e9111a44ac0352f26030d7c1b17026d42c45f3600cfa02a0e8c5b7d59',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10197472, res_sha256: '119370d5dab0d5fc9b1e58357f3fd60595603076127ab60199a4c2bc5712d724',
    panels: { tft: [900, 600], evf: [1024, 768] },
    // the flash library's get-core-id (disassembly notation, flash 0x50002900): E143 has it in the image (0x50002fd3,
    // `mov (0x97f00254),d0; retf`); E147 calls the flash copy from the same 21 sites (paired, X)
    flash_core_id: 0x3FFE18E0,
    // task entries a later build starts where E143 starts none, run natively (each with what starts it)
    // the VSC's per-channel block 0x6800..0x7c00 (word indices 0x1a00..0x1eaf in ten runs of 0x30), which the
    // display init clears (0x501ed5bc, table 0x602eb7a8) and E143's VSC has not (X)
    vsc_extra: [0x6800, 0x1400],
    // the feature registers' values E147 writes for its EVF (1024 x 768 panel) where E143's differ (X: the EVF start)
    vsc_features: { 0x428: [0x22], 0x580: [0], 0x584: [0], 0x588: [0], 0x58c: [0], 0x598: [0] },
    // the touch init starts the touch task itself and both wait for the controller's I2C completion (X): not modelled
    touch: false,
    g4set: G4SET_UNCHECKED,
    // property 4513 (the output device) reads the play path makes from one more site than E143's GUI (X)
    prop_sites: [0x503DAF24],
    extra_tasks: [
      0x501E3ECA,   // started by the display task init (0x501cfd03, E143 0x501c2f13 starts no task), X
    ],
    // E143's board (src/fw/board.mjs) but for the flash library, which E147 runs from its image head linked at
    // 0x3FFDEFE0 (memcpy/memset, the core-id getter: d32 calls from flash into it, X); the compositor leaves the
    // register blocks VSC_UNAPPLIED unapplied
    board: {
      family: 'E143', library: { base: 0x3FFD0000, size: 0x30000, image: [0, 0x30000 - 0xEFE0, 0xEFE0] },
      vsc: { unapplied: VSC_UNAPPLIED },
    },
  },
  E144: {
    name: 'OM-5', bin: 'OLY_E_144_1200_0000_0000.BIN', version: '1.2', res_block: 'blk017c0000.OE.0101.bin',
    rom_len: 24903616, rom_sha256: 'cf4babeab5f516514e4a9b6032b0374e643830511e083b9cdd26bcb02980af88',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 7835616, res_sha256: '1bc282d99c073bee159fbffa85c27b48782a7c083cfcc55bd086410790960b36',
    panels: { tft: [720, 480], evf: [1024, 768] },
    overrides: OVERRIDES_E144,
    g4set: G4SET_UNCHECKED,
    // the menus are the older Menu_Viewer / Cursor_2CNL framework, not ListMenu (src/fw/ports.mjs FACTS menu.list_menu,
    // read by src/fw/facts.mjs listMenu): no tab/page tables, variable 226 a 382-byte publish (D, the menu-entry chain
    // 0x50301ef8)
    // the VSC ch0 ISR sets a second vsync flag besides 0x60041680, waited by the task whose id is in (0xa2693e80)
    // (0x5018595f..0x501859ba, D)
    vsync_alias_flags: [0x600417B2],
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5018a924: attach 120, poll (0x620c662c)), called at 0x50181efb, the code at
    // 0x50181f10 (D)
    // the cache flushes besides the DB init's (menu.mjs K-CFLUSH; return addresses): the driver at 0x50003a99 flushes
    // the data cache (0x5004821b: CHCTR 0x8070, the tag area 0x28a00000) before its DMA (X)
    cflush_returns: [0x50003AA0],
    // the save of the 1 MiB state block 0x62be0000 to flash 0x46c60000 (camapp.mjs S-SETSAVE): 0x50003a64 runs its
    // registered callbacks, flushes the cache, sums the block and writes it through the flash access 0x5003b76c,
    // which programs the flash controller 0x98d01800 the lab does not have (D); the application's RPC 0xc0036
    // handler calls it at power-on (0x503021b8, X)
    block_save: { fn: 0x50003A64, returns: [0x503021BF] },
    // drivers of peripherals the lab does not have (play.mjs; [function, d0, name, why]): the internal charger's
    // register write over IIC channel 6 (0x50041179: d0 1, d1 register, a0 value; its 3000 ms waits for the IIC
    // completion flag (0x600417aa) time out and log 0x1d003003 "INTCHA Eve W Err" without the charger, X), which the
    // GUI's power-state change 0x50041a4c makes about 4 s after power-on (X); 0 is its success value (0x5004135c, D)
    return_stubs: [[0x50041179, 0, 'S-INTCHA', 'internal charger IIC write: no charger in the lab']],
    // S-NOPOWEROFF at 0x50cf0e21 (`mov 8,d0; mov a2,a0; call 0x50ceb714`, D): run, the start ends in the power-off's
    // final loop 0x5004da5b (`call 0x5003a37f` with d0 1, `bra .`) before the first S1 (X)
    call_skips: [NO_USB_POWER_OFF],
    // its board family's (src/fw/board.mjs FAMILIES.E144); its core byte (the getter 0x5000276d `movbu
    // (0x8ff00198),d0`), library (flash 0x41e02000 -> 1536 words at 0x47000800, 0x5000027d..0x5000028e) and preload
    // (the reset head's copies 0x500000f7..0x50000117, 0x5000018b..0x500001c5) are read by bin/port.mjs
    // (src/fw/ports.mjs FACTS.E144)
    board: { family: 'E144' },
  },
  // The bodies at the run-time bases 0x60021020, 0x60020020 and 0x60400020 (docs/model-survey.md tiers A-C). Each
  // entry's .BIN is the one the updater API serves for its code (the name: its reply's model_name; the reply is not
  // committed), pinned in BLOBS.sha256; rom_* and res_* are the main block's and the resource prefix's
  // digests by the lab's own path (src/fw/olyfw.mjs labBlocks, src/fw/resprefix.mjs resPrefix with the block's load
  // address, X). panels: the vendor's specification's dot counts as RGB pixels, 1.037M dots 720 x 480 and 2.36M dots
  // 1024 x 768 (I: unchecked; nothing reads panels yet), null where it gives no geometry or the body has no EVF.
  // board.family: the family scan's (src/fw/board.mjs FAMILIES, whose comments name the bodies scanned, X); the
  // family's per-body facts are read by bin/port.mjs (src/fw/ports.mjs FACTS), none is given here.
  E139: {
    name: 'E-M1 III', bin: 'OLY_E_139_1600_0000_0000.BIN', version: '1.6', res_block: 'blk01a00000.OE.0101.bin',
    rom_len: 27262912, rom_sha256: '3f8bcc3248e63a823dd978607f019f2063ead83080b9c93cddc836d556ff42dd',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 11726816, res_sha256: '0d4c92407626a32ae4173fc2d6efc5360d75b5c271f088339830ffe1455e157e',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E144 pairs 7.29M instructions with 14 conflicts, the one from E143 2.18M with 110 (X: port.json
    // port_via.map and map, bin/port.mjs)
    port_via: 'E144',
    // E144's knobs this body takes through that map (src/fw/knobs.mjs; src/fw/ports.mjs KNOBS)
    carry: ['cflush_returns', 'block_save'],
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 88 (0x5018b4dc), called at 0x501827eb, the code at 0x50182800 (D)
    // the GUI state log (0x50eb0f4d, E143's STATE_LOG) takes three arguments, not E143's four: its one caller passes
    // the event in d0, the old state (0x61e8bedc) in d1 and the new one (0x61e8bee0, just stored) in a0 (D
    // 0x50cc4a41..51), where E143's passes the same two from the same offsets of its GUI block in a0, a1 (D)
    state_log_regs: ['d1', 'a0'],
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50c9bdcc (D): run, the GUI leaves shooting for 0x0104 ID_ST_BLACK_SCREEN after message
    // 0x9626 (X)
    call_skips: [NO_USB_POWER_OFF],
    overrides: {
      '0x5014e374': { to: '0x5011080a', why: 'the joystick decoder publish return, as the map from E143 places it (E144 has no joystick and gives null): the UI_IN code has E143\'s branch on 0x1235/0x1234 (D cmp at 0x50110999/0x501109a5 and 0x50110a59/0x50110a65, E143 0x5014c07a/0x5014c086 and 0x5014c13a/0x5014c146), and 0x501107fe..0x5011080a is E143\'s 0x5014e368..0x5014e374, the call of the publisher 0x500257d0 with d1 0, a0 0 (D; play)' },
    },
  },
  E134: {
    name: 'E-M1X', bin: 'OLY_E_134_2400_0000_0000.BIN', version: '2.4', res_block: 'blk01a00000.OE.0101.bin',
    rom_len: 27262912, rom_sha256: '7b0d72f88cfed079c6e3367a910856f9e4f69bc9e020f9c06d7ed0980bd66d3f',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 22175200, res_sha256: '1b390ea79011cf8a4946344c909078b320f8dc46000ab9f07018b8e0c76e9176',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E139 pairs 8.12M instructions with 34 conflicts, the one from E144 5.88M with 47; through E139, 106
    // of the overrides carry, 15 against the direct map's answer and 11 fail, through E144 102, 22 and 16 (X: port.json
    // port_via.map, carried, carry_failed, bin/port.mjs with each; since the frame-wait knob left the seeds and E144's
    // rule-placed overrides went, through E139 102, 13 and 10, X). None of E139's knobs carries: the block save's
    // function and the calls before the cache flush's and the DISPLAY send's returns are not paired (carryKnob, X; the
    // DISPLAY sends are read by a rule since, src/fw/facts.mjs displaySends)
    port_via: 'E139',
    g4set: G4SET_UNCHECKED,
    overrides: {
      '0x50023bab': { to: '0x5021050d', why: 'the EVF vtotal getter (display.mjs DEVICE.evf), which neither map places (E139\'s is the direct map\'s alignment 0x50021641): after the retf at 0x5021050a, `movbu (0x62316834),d1; mov 819,d2; cmp 1,d1` with 787 for mode 1 and 900 for a 20000 us period read through 0x50210666, as E139\'s 0x50021641 (D)' },
      '0x5014b7c7': { to: '0x501092da', why: 'the dial init (menu.mjs DIAL_INIT), which neither map places: like E143\'s it selects the board\'s dial table (src/fw/facts.mjs dialStore) and clears the dial counters, the 16-byte slots from 0xa28b9ecc, the map\'s DIAL_COUNTERS (0x501092f7..0x50109327), after a call of 0x501091eb, which clears ten bytes from 0xa28b9f10 and the three after them; then it posts a message through 0x50053de3 (0x50109342), which E143\'s does not; its one caller is 0x50108d5f (D)' },
    },
  },
  E137: {
    name: 'E-M5 III', bin: 'OLY_E_137_1700_0000_0000.BIN', version: '1.7', res_block: 'blk017e0000.OE.0101.bin',
    rom_len: 25034688, rom_sha256: '4097f57751ac30c24589448865b2824891a754744eae63ab14359fd46c1cf4be',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 24465888, res_sha256: '4d0643ac1b46c33c074f5fad669d197c80a62d9590586904e68a53379ff9712f',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E144 pairs 7.94M instructions with 107 conflicts, the one from E139 7.43M with 99; through E144, 119
    // of the overrides carry (66 not null), 14 against the direct map's answer and 12 fail, through E139 109 (64), 15
    // and 8 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each; through E144 116 (63), 13 and 12
    // since three of E144's overrides went to rules, X). E144 is taken: E137 has its board traits where E139's differ
    // (no SCPU backup, font limit 0x9fc00; src/fw/ports.mjs FACTS) and its EVF code (the vtotal getter `mov 825,d0;
    // retf` 0x50020f74 and the period setter 0x50021078, as E144's 0x5002183a and 0x5002193e, D). None of E144's knobs
    // carries: the calls before the DISPLAY send's and the cache flush's returns and the block save's function are not
    // paired (carryKnob, X; the DISPLAY sends are read by a rule since, src/fw/facts.mjs displaySends)
    port_via: 'E144',
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50c3ef76 (`mov 7,d0`: event 7, E144's 8, D): run, the GUI leaves shooting for 0x0104 after
    // message 0x9626 and the application's flash save 0x507e48bb stops the lab (S-FLASHSAVE, X)
    call_skips: [NO_USB_POWER_OFF],
  },
  E142: {
    name: 'E-P7', bin: 'OLY_E_142_1100_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: '5dd9af164b4590c7e82f6905c919b3cc450bb58f2d5742ab2a0e3a4eb2e26190',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600200f9,a0; jmp (a0) (D)
    image_base: 0x60020020,
    res_len: 22091232, res_sha256: '61d008779b2952a50936d58aa45390a7b1e918f4edcd49f20b3c82d235dac9da',
    // TFT 1.037M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    board: { family: 'E144' },
    // the map from E144 pairs 3.47M instructions with 116 conflicts, the one from E139 4.63M with 115, the one from
    // E137 3.92M with 141; through E144, 116 of the overrides carry (63 not null), 16 against the direct map's answer
    // and 10 fail, through E139 108 (63), 17 and 3, through E137 128 (65), 14 and 4 (X: port.json port_via.map,
    // carried, carry_failed, bin/port.mjs with each). E144 is taken: E142 has its board traits where E139's differ (no
    // SCPU backup: through E144 the four SCPU wait words stay null, through E139 they take the direct map's places,
    // src/fw/ports.mjs FACTS), and E144's get_still_info dump site carries to E142's createDate.year trace at
    // 0x50760ab2, where through E139 it lands on the WBMode trace 0x50760cc9 (D). Through any of the three the touch
    // panel's I2C write and read are E144's (0x5016c8bc, 0x5016cbe8: E144's 0x5018aab3 and 0x5018adf3 instruction for
    // instruction, D), which the map from E143 does not place (it gave the write 0x5016c69f, a reader of the
    // controller's register 0x1c14, D)
    port_via: 'E144',
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5016c6d5), called at 0x50164055, the code at 0x5016406a (D); reached, X
    // the shared stand-in (G4SET_UNCHECKED); start and S1 run with it (X)
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50cba3a5 (`mov 8,d0; mov a2,a0`, as E144's, D): run, the GUI leaves shooting for 0x0104 after
    // message 0x9626 (X); stepped over, it stays in 0x108 and takes S1 (X)
    call_skips: [NO_USB_POWER_OFF],
  },
  E140: {
    name: 'E-M10 IV', bin: 'OLY_E_140_1100_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: '5f2bfb367a7d65278fae1338bb10181ca8de8ebbd9a83f9e89bec4db9ade1fa5',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600200f9,a0; jmp (a0) (D)
    image_base: 0x60020020,
    res_len: 21919200, res_sha256: '483aa7d7b8b64f11d851f5e9083ceea479b22905f0b338ff9229600e5d315aa6',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E142 pairs 6.56M instructions with 81 conflicts, the one from E144 3.49M with 111; through E142, 134
    // of the overrides carry (60 nulls) and none fails, through E144 118 (53) and 8 fail (X: port.json port_via.map,
    // carried, carry_failed, bin/port.mjs with each). The two ports give the same places but for three E143 addresses
    // that through E142, which has no EVF, stay unplaced: the eye-state compare 0x501e806c, which through E144 lands on
    // E140's `cmp 2,d0` after its eye reader 0x5004847f, at 0x5016fe49 (D); the eye-state setter 0x50050efd, which
    // through E144 is filled at 0x500487de, a loop of `calls (a0)`, not a setter (D; E140's stores its eye word
    // (0xa2717360) at 0x5004869b in another shape than E144's 0x5004a521, D); and the YCbCr conversion 0x501db1c8
    // (through E144 0x50165945, not checked). E142 is taken; the eye state's two addresses are open on E140
    port_via: 'E142',
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5016c5a4), called at 0x50163fee, the code at 0x50164003 (D); reached, X
    // the shared stand-in (G4SET_UNCHECKED); start and S1 run with it (X)
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50cb6247 (`mov 8,d0; mov a2,a0`, as E142's, D): run, the GUI leaves shooting for 0x0104 after
    // message 0x9626 (X); stepped over, it stays in 0x108 and takes S1 (X)
    call_skips: [NO_USB_POWER_OFF],
  },
  E125: {
    name: 'E-M1 II', bin: 'OLY_E_125_3700_0000_0000.BIN', version: '3.7', res_block: 'blk01600000.OE.0101.bin',
    rom_len: 23068608, rom_sha256: '0a41fb8e1105751f7817e5664f2edf2a1bdf399f070e91b4e3c84e6943113803',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 23330784, res_sha256: 'bd25f933ce5572b799776b5eaadc11876cd096e78a4182c71cebc44649ad386e',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E134 pairs 4.22M instructions with 28 conflicts, the one from E139 3.85M (37), from E144 4.72M
    // (51); through E134 108 of the overrides carry (54 nulls) and 7 fail, 60 lab addresses stay unplaced, through
    // E139 96 (45), 13 and 60, through E144 104 (53), 20 and 68 (X: port.json port_via.map, carried, carry_failed,
    // unmapped, bin/port.mjs with each). All three place the kernel tick init (0x50034f34) and the TFT vtotal function
    // (0x5022aaa8); only through E134 is the EVF vtotal function placed at its entry, 0x501729ab `movbu (0x6223ab28),d1;
    // mov 787,d0; cmp 1,d1` as E139's 0x50021641 (through E139 0x501729a6, a `mov 1,d0; retf` before it, through E144
    // 0x501729e0, inside it, D). E134 is taken
    port_via: 'E134',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    extra_tasks: [
      0x5078D50B,   // OlyHfwBatteryManager's thread ("thread_entry()"), which its init creates (priority 54, stack 1792,
                    // 0x5078d2ba..d3) and starts in the camera application's start (S-CAMAPP, X); E143 has no battery
                    // manager (no "OlyHfwBatteryManager" string, X)
    ],
    // S-NOPOWEROFF at 0x50d2302c (`mov 7,d0; mov a2,a0`, as E145's, D): run, the GUI reaches 0x108 and the power-off
    // posts at once, the start ending in 0x0104 (X); stepped over, it stays in 0x108 and takes S1 (X)
    call_skips: [NO_USB_POWER_OFF],
    // S-CARD's mount test (src/lab/camapp.mjs): E125's DCF remain count 0x505f49ad tests the drive status 0x5061cb03
    // returns for its error bits only, `btst 63,d0; mov 1,d1; beq` at 0x505f49d0, where E143's (0x5087d7dc) goes on
    // only with the mount bit 0x1000 set too, `btst 4096,d1; bne` at 0x5087d80a, the status's bit 12 copied from the
    // device state's bit 16 (0x508a83e7; E125's 0x5061cbb5, D). The lab's drive status is 0x8600 on both (X), so
    // getMovieTimeInMedia's count (from 0x502de73d, E143's from 0x503f1bcd) returned on E143 and on E125 counted the
    // free clusters of drive 0's volume, null in the table 0x622907d4, and divided by its zero cluster field at
    // 0x505feaf0 (X). Of the 16 bodies scanned only E125's count lacks a second test (E129's tests bit 0x80, E145's
    // and E132's `and` the error mask before `btst 4096`; X, a byte scan of the expanded images for the count's
    // property reads 0xf021, 0xf051 and the tests before them). With it the count takes its own not-mounted return
    // (its type-4 call 0x5031a8d0, as E143's 0x5087e9f5, then 0) and the start goes on (X)
    dcf_mount_test: { at: 0x505F49D0, reg: 'd0' },
  },
  E145: {
    name: 'TG-7', bin: 'OLY_E_145_1103_0000_0000.BIN', version: '1.1', res_block: 'blk01380000.OE.0101.bin',
    rom_len: 20447168, rom_sha256: 'e52660cc0aad6057831d15f721c5d4bd159fc728cdbf78772a35ec11c33e8c47',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 13577184, res_sha256: '5404cb456e2f5cddb7fa1ace6fa3210b6b2ea3e55908d71c3140434880b7fd98',
    // TFT 1.04M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    board: { family: 'E144' },
    // the map from E142 pairs 2.01M instructions with 121 conflicts, the one from E140 2.17M (116), from E144 1.83M
    // (117); through E142 120 of the overrides carry (60 nulls) and 14 fail, 77 lab addresses stay unplaced, through
    // E140 120 (60), 15 and 79, through E144 106 (53), 20 and 80 (X: port.json port_via.map, carried, carry_failed,
    // unmapped, bin/port.mjs with each). Through E142 the DB init and its flash save return are placed (0x5028eb02,
    // 0x5028eb32), through E140 and E144 not; none of the three places the touch I2C functions, which E145 lacks
    // (src/fw/facts.mjs touchDriver). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50c0f63c (`mov 7,d0; mov a2,a0`, D): run, the start ends in 0x0104 ID_ST_BLACK_SCREEN and
    // S1 stops at K-CFLUSH from the state block save (return 0x5000392f, X); stepped over (once in the start, X), it
    // stays in 0x108 and takes S1 (X)
    call_skips: [NO_USB_POWER_OFF],
  },
  E133: {
    name: 'E-PL9', bin: 'OLY_E_133_1101_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: '8e39c335d54fd8ddea189db82fe708159f43f9995bba42c2cd47dd22b8814267',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 21456352, res_sha256: 'd777456e3c2e41db6a55458cb8ec37d1a6589391f8103b3ec38be7cae59aaa43',
    // TFT 1.037M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    board: { family: 'E144' },
    // the map from E143 pairs 1.04M instructions; from E142 2.24M with 122 conflicts, from E140 2.35M (120), from E125
    // 5.20M (84), from E145 2.04M (79); through E142 120 of the overrides carry (60 nulls) and 12 fail, through E140
    // 120 (60) and 13, through E125 131 (60) and 3, through E145 133 (72) and 6 (X: port.json port_via.map, carried,
    // carry_failed, bin/port.mjs with each). Through E142 and E140 the start runs to the session's touch start, through
    // E125 it stops at the settings store's unplaced init (E143 0x503c5473; X, the tft child with each). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
  },
  E130: {
    name: 'E-M10 III', bin: 'OLY_E_130_1200_0000_0000.BIN', version: '1.2', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: '8c3099214a3ec1aa29a9058997c4472072bdeddda8c8df93ec707d7a0bc31eb9',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 21476832, res_sha256: 'a21935005597087e0a43f0a99cee28376c142a4e55339d76ab2ed8286228cb15',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E144' },
    // the map from E143 pairs 1.02M instructions; from E142 2.11M with 45 conflicts, from E140 2.15M (47), from E145
    // 1.98M (71); through E142 118 of the overrides carry (60 nulls) and 14 fail, through E140 117 (60) and 16, through
    // E145 133 (72) and 6 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each). Through E142 and
    // E140 the start runs to the session's touch start, through E145 it stops before, at the settings store's unplaced
    // init (E143 0x503c5473; X, the tft child with each). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // S-NOPOWEROFF at 0x50c2f598 (`mov 7,d0; mov a2,a0`, as E145's, D): run, the start ends in 0x0104
    // ID_ST_BLACK_SCREEN (X); stepped over, it stays in 0x108 and takes S1 (X)
    call_skips: [NO_USB_POWER_OFF],
  },
  E129: {
    name: 'TG-5', bin: 'OLY_E_129_1101_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: 'a57f3d72282b2f923bcc38e53f1159f51af708c219e065986936064ca4cf93a5',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 17276384, res_sha256: '110a674b5dfe8d127eb241b24c4cb60a5675ce14a1d435687a53eb36c6663f1b',
    // the vendor's specification gives the TFT as 460K dots, not its pixel geometry (I: unchecked); no EVF
    panels: { tft: null, evf: null },
    board: { family: 'E144' },
    // the map from E143 pairs 0.94M instructions; from E145 2.61M with 33 conflicts, from E142 1.76M (129), from E140
    // 1.84M (117); through E145 137 of the overrides carry (72 nulls) and 2 fail, through E142 116 (60) and 16, through
    // E140 117 (60) and 16 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each). Through E142 and
    // E140 the display start stops at E143's EVF frame period word, which neither places (this TG-5 has no EVF),
    // through E145 (TG-7, no EVF either) it runs past it (X, the tft child with each). E145 is taken
    port_via: 'E145',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
  },
  E132: {
    name: 'TG-5 (KOUICHIRO)', bin: 'OLY_E_132_1300_0000_0000.BIN', version: '1.3', res_block: 'blk01900000.OE.0101.bin',
    rom_len: 26214336, rom_sha256: 'e3ecb52bb83d376ff97b2543293e7a20c44490671fae5c1ebad327c8584c09f7',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 18550240, res_sha256: 'd0fa5807f2e4fbbf384b464082c35a9a59355c12fb73830987d15d08d4b162bc',
    // a TG-5 (the reply's model_name TG-5(KOUICHIRO)): its TFT of 460K dots, no geometry given; no EVF
    panels: { tft: null, evf: null },
    board: { family: 'E144' },
    // as E129, a TG-5 whose main block has E129's size and base: E145 is taken; the map from E145 pairs 2.68M
    // instructions with 20 conflicts, 137 of the overrides carry (72 nulls) and 2 fail (X: port.json port_via.map,
    // carried, carry_failed); the other references were not measured
    port_via: 'E145',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
  },
  E118: {
    name: 'E-M5 II', bin: 'OLY_E_118_4100_0000_0000.BIN', version: '4.1', res_block: 'blk01460000.OE.0101.bin',
    rom_len: 21364672, rom_sha256: 'ecd9603c4a264a358d91ef110a05f9236055e6369399f7c7de5985b21a2fd96a',
    // the reset head's jump into the run-time copy at 0x500000d1: mov 0x60021114,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 19291104, res_sha256: 'b1e448561edfc9c56a08fd5fa5c3d6307fc4741149bb40d951940e82364ccc5f',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E118' },
  },
  E122: {
    name: 'PEN-F', bin: 'OLY_E_122_3101_0000_0000.BIN', version: '3.1', res_block: 'blk01460000.OE.0101.bin',
    rom_len: 21364672, rom_sha256: 'a2eb1d1f1afe47cce148e9aae0a04dfb82547d9de9437d342e012341140913f4',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 19767776, res_sha256: '8509050a3374abf6237254ad0a2627fa33aaccf7612e2dafae7e6ba481e77407',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E118' },
  },
  E120: {
    name: 'E-M10 II', bin: 'OLY_E_120_1400_0000_0000.BIN', version: '1.4', res_block: 'blk01460000.OE.0101.bin',
    rom_len: 21364672, rom_sha256: '309682c05a96d3079ebcae598169d487fea7f8b2531d8ae99445d63e80ea7a39',
    // the reset head's jump into the run-time copy at 0x500000d1: mov 0x60021114,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 18415584, res_sha256: 'f12ebf2598496f11bfdecff105f933a9f60c2cfff6a479258e9c6c34cb9236f0',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    board: { family: 'E118' },
  },
};
export const codeOf = (m) => 'E' + m.bin.slice(6, 9);
export const romPath = (m) => `unpacked/${codeOf(m)}/${m.bin}.blk00000000.OE.0100.bin`;
export const resPath = (m) => `unpacked/${codeOf(m)}/${m.bin}.${m.res_block}`;
