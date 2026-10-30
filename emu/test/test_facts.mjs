// The firmware rules of src/fw/facts.mjs, the board merge of src/fw/board.mjs and the image reader of
// src/fw/image.mjs (firmware-optional; about a second with the four committed models' blocks unpacked):
//   factsTests  imageBase on synthetic reset heads (the jump decoded, none or two refused) and, for every model of
//               src/fw/models.mjs whose main block is unpacked, imageBase(block) === its image_base; mergeBoard's
//               one-level merge, its refusal of a fact given both ways and its UNKNOWN getters, boardOf on every model;
//               on every model with both blocks unpacked: resetHead and coreByte (through readFacts) and resLoader
//               against the values found without them (BOARD_FOUND, LOADER_FOUND), the vectors' page against the port's
//               level slots, readFacts against the model's src/fw/ports.mjs FACTS (E143: its own facts; a model not
//               ported yet: the rules run), the kernel, SCPU, change-task and timer-reload rules against TRAITS_FOUND,
//               the dial select against A() and DIAL_FOUND, the DISPLAY queue against A() and DISPLAY_QUEUE_FOUND, the
//               display task init against TASK_INIT_FOUND and A(), the face colour setter against FACE_COLOUR_FOUND and
//               A(), readPlacedFacts (at the places of src/fw/ports.mjs PORTS) with readFacts against FACTS, its
//               DISPLAY sends against DISPQ_FOUND, the DISPLAY task loop against LOOP_FOUND and A(), its start-up
//               against START_FOUND, its replies against REPLIES_FOUND and A(), the UI_IN task against UI_IN_FOUND
//               and A(), its forward sites against UI_IN_FWD_FOUND and A(), the touch task's start against
//               TOUCH_START_FOUND and A(), the calls of tsnd_dtq against TSND_COUNT and A(), the display sync against
//               SYNC_FOUND, its module-9 readers against MODULE9_FOUND and E143's lab lists, its language setting
//               against LANG_FOUND, the menu memories against MEMORY_FOUND, the touch-panel driver against
//               NO_TOUCH_DRIVER, the lens mount against NO_LENS_MOUNT, the lens driver against LENS_DRIVER_FOUND and
//               A() of its flags and queue word, the IIC driver's wait against IIC_FOUND, the
//               touch panel's traced I2C functions against TOUCH_FOUND, the device open's frame wait and the
//               software-timer sleep against FRAME_WAIT_FOUND and TIMER_SLEEP_FOUND, the shooting service's traces
//               against SHOOTING_FOUND, the AE init against AE_FOUND and A(), the GUI task's take against TAKE_FOUND,
//               its caller word against CALLER_FOUND and A(), the kernel's interrupt handler tables against HANDLERS_FOUND, the frame period words against PERIOD_FOUND and A(), the function direct start against DIRECT_FOUND and
//               A(), the event broker init against BROKER_FOUND and A(), the error log against ERRLOG_FOUND and A(),
//               the touch panel's open against TP_OPEN_FOUND and A(), the play component's wrappers against
//               WRAPPERS_FOUND and A(), the USB-disconnect power-off against POWER_OFF_FOUND, the power manager's
//               start and the power-off sequence against POWER_SEQ_FOUND, the serial controller's driver against
//               SIO_FOUND, the GUI canvas, OSD banks
//               and kind-3 area against GUI_FOUND, the rec view component's state word against RECVIEW_FOUND, CPU 0's
//               init task and OlyTaWu against RTOS_FOUND and A(), the DB init's and the application's flash saves
//               against STORE_FOUND, APP_SAVES_FOUND and APP_SAVES_COUNT, the touch I2C length arguments against
//               TOUCH_ARGS_FOUND, the frame display mode set against FRAME_MODE_FOUND and A(), the frame plane's
//               uploads against PLANE_FOUND and A() of the AF upload, the output-device
//               property against PROP_DEVICE_FOUND, the mode dial's table and names against MODE_DIAL_FOUND, the
//               constructor tables against CTORS_FOUND, A() and their 0xFFFFFFFF ends, and the
//               loader's slots and image-record destinations against A() (src/fw/ports.mjs PORTS); imageView's reads
//               and its refusal outside the image
//   node emu/test/test_facts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { imageBase, resLoader, readFacts, readPlacedFacts, callAt, INDEX_READ, TOUCH_ARGS_E143, DISPLAY_START_E143,
  TOUCH_TASK_QUEUE_E143, TP_FLAG_E143, CBS_E143, LENS_ZOOM_TABLE_E143, STORAGE_E143, SIO_E143, LENS_DRIVER_E143, POWER_OFF_E143, MODE_DIAL_E143,
  PROP_STORE_E143, CTORS_E143 } from '../src/fw/facts.mjs';
import { loadAddress } from '../src/lab/resources.mjs';
import { imageView, ImageRangeError } from '../src/fw/image.mjs';
import { expandImage } from '../src/fw/expand.mjs';
import { FAMILIES, UNKNOWN, mergeBoard, boardOf } from '../src/fw/board.mjs';
import { MODELS, romPath, resPath } from '../src/fw/models.mjs';
import { PORTS, FACTS } from '../src/fw/ports.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const head = (file, n = 0x400) => {
  const b = new Uint8Array(n), fd = fs.openSync(file, 'r');
  try { return b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)); } finally { fs.closeSync(fd); }
};
const jump = (b, at, target) => b.set([0xfc, 0xdc, target & 0xff, target >>> 8 & 0xff, target >>> 16 & 0xff, target >>> 24, 0xf0, 0xf4], at);
const throws = (f, cls = Error) => { try { f(); return false; } catch (e) { return e instanceof cls; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
// whether a 7-byte call to `to` is at `at` (disassembly notation) of a run-time image
const is7call = (img, at, to) => { const c = callAt(img, at - 0x50000000); return c?.len === 7 && 0x50000000 + c.to === to; };
const hx = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? '0x' + x.toString(16) : x));
// Values found without the rules of src/fw/facts.mjs, which the rules must give back. bin/port.mjs writes FACTS and
// the loader's PORTS entries with these same rules, so comparing a rule with them only shows the tables are current.
// The boards: E144's core byte, library and preload as src/fw/models.mjs gave them by hand before its port (D: the
// getter 0x5000276d, the library copy 0x5000027d..0x5000028e, the reset head's copies 0x500000f7..0x50000117 and
// 0x5000018b..0x500001c5); the tier A-C bodies' as the step-1 board survey read them (X: its own head walk and getter
// scan, the getter's address given where it named one).
const lib = (image) => ({ base: 0x47000000, size: 0x2000, image });
const BOARD_FOUND = {
  E144: { core_byte: 0x8FF00198, library: lib([0x1681FE0, 0x1800, 0x800]), preload: [[0xE000, 0x984, 0x619E1FE0], [0x2367E0, 0x30BF4, 0x61E32AC0], [0x26E7E0, 0x48C4, 0x61E6AAC0], [0x2767E0, 4, 0x61E72AC0], [0x27A7E0, 0x2D2C, 0x61E76AC0]] },
  E139: { core_byte: 0x8FF0019C, library: lib([0x1627FE0, 0x1800, 0x800]), preload: [[0xE000, 0xD08, 0x61A21FE0], [0x2317E0, 0x331A0, 0x61E72AC0], [0x2697E0, 0x48C4, 0x61EAAAC0], [0x2717E0, 4, 0x61EB2AC0], [0x2757E0, 0x2D2C, 0x61EB6AC0]] },   // getter 0x50002794
  E134: { core_byte: 0x8FF001A0, library: lib([0x167F7E0, 0x1800, 0x800]), preload: [[0xE000, 0xD3C, 0x61C21FE0], [0x24A7E0, 0x324B8, 0x620AB540], [0x2827E0, 0x48C4, 0x620E3540], [0x28A7E0, 4, 0x620EB540], [0x28E7E0, 0x2D2C, 0x620EF540]] },   // getter 0x500021a5
  E137: { core_byte: 0x8FF0019C, library: lib([0x1461FE0, 0x1800, 0x800]), preload: [[0xE000, 0x84C, 0x61A01FE0], [0x22EFE0, 0x32D10, 0x61E8B540], [0x266FE0, 0x48C4, 0x61EC3540], [0x26EFE0, 4, 0x61ECB540], [0x272FE0, 0x2D2C, 0x61ECF540]] },   // getter 0x5000221a
  E142: { core_byte: 0x8FF00198, library: lib([0x141C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x8C8, 0x61B20FE0], [0x2107E0, 0x2E350, 0x61F98540], [0x2507E0, 0x48C4, 0x61FD8540], [0x2587E0, 4, 0x61FE0540], [0x25C7E0, 4, 0x61FE4540]] },   // getter 0x500026d7
  E140: { core_byte: 0x8FF00198, library: lib([0x141C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x8A4, 0x61B20FE0], [0x21F7E0, 0x2D60C, 0x61F98540], [0x25F7E0, 0x48C4, 0x61FD8540], [0x2677E0, 4, 0x61FE0540], [0x26B7E0, 4, 0x61FE4540]] },   // getter 0x500026d7
  E125: { core_byte: 0x8FF00198, library: lib([0x144EFE0, 0x1800, 0x800]), preload: [[0xE000, 0xC70, 0x61B01FE0], [0x244FE0, 0x3569C, 0x61F8B540], [0x27CFE0, 0x4B50, 0x61FC3540], [0x284FE0, 4, 0x61FCB540], [0x288FE0, 0x2D2C, 0x61FCF540]] },   // getter 0x500021d5
  E145: { core_byte: 0x8FF00198, library: lib([0x136B9E0, 0x1800, 0x800]), preload: [[0xE000, 0xC80, 0x615A1FE0], [0x2237E0, 0x287E4, 0x61A2B540], [0x2537E0, 0x48C4, 0x61A5B540], [0x25B7E0, 4, 0x61A63540], [0x25F7E0, 4, 0x61A67540]] },   // getter 0x50002662
  E133: { core_byte: 0x8FF00198, library: lib([0x13BC9E0, 0x1800, 0x800]), preload: [[0xE000, 0x5EC, 0x61F00FE0], [0x21F7E0, 0x2EF18, 0x6238A540], [0x25F7E0, 0x4B50, 0x623BA540], [0x2677E0, 4, 0x623C2540], [0x26B7E0, 4, 0x623C6540]] },   // getter 0x5000234a
  E130: { core_byte: 0x8FF00198, library: lib([0x133C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x608, 0x61F00FE0], [0x2317E0, 0x2D754, 0x6238A540], [0x2717E0, 0x4B50, 0x623BA540], [0x2797E0, 4, 0x623C2540], [0x27D7E0, 4, 0x623C6540]] },   // getter 0x500022d0
  E129: { core_byte: 0x8FF00198, library: lib([0x133C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x6CC, 0x61F00FE0], [0x2147E0, 0x286AC, 0x6238A540], [0x2447E0, 0x4B50, 0x623BA540], [0x24C7E0, 4, 0x623C2540], [0x2507E0, 4, 0x623C6540]] },   // getter 0x500022cb
  E132: { core_byte: 0x8FF00198, library: lib([0x133C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x6CC, 0x61F00FE0], [0x2147E0, 0x29FDC, 0x6238A540], [0x2447E0, 0x4B50, 0x623BA540], [0x24C7E0, 4, 0x623C2540], [0x2507E0, 4, 0x623C6540]] },
  E118: { core_byte: 0x8FF00188, library: lib([0x111D7E0, 0x1000, 0x1000]), preload: [[0xE000, 0x660, 0x61150FE0], [0x1B6FE0, 0x1DAAC, 0x615DC540], [0x1EAFE0, 0x436C, 0x61610540], [0x1F2FE0, 4, 0x61618540]] },
  E122: { core_byte: 0x8FF00188, library: lib([0x113C9E0, 0x1800, 0x800]), preload: [[0xE000, 0x648, 0x61170FE0], [0x1C97E0, 0x20A20, 0x615FC540], [0x1FD7E0, 0x436C, 0x61630540], [0x2057E0, 4, 0x61638540]] },
  E120: { core_byte: 0x8FF00188, library: lib([0x111D7E0, 0x1000, 0x1000]), preload: [[0xE000, 0x638, 0x61150FE0], [0x1AEFE0, 0x1F4CC, 0x615DC540], [0x1E2FE0, 0x436C, 0x61610540], [0x1EAFE0, 4, 0x61618540]] },
};
// The resource loaders, {font: [slot, limit], images: [record 0, last record], string: [slot, limit]} (null: not
// found that way). E143's (D): font 0x501a8f1c, limit at 0x501a8f35; the image records 0x501a8fe2, 0x501a8fec; string
// 0x501a917e, limit at 0x501a9197. E146's, E147's and E144's addresses as the cross-build map placed them before the
// loader rule existed (src/fw/ports.mjs as the survey left it; E146's all E143's), their limits as src/fw/models.mjs gave them by
// hand (D: the cmp at E146 0x501adcfa/0x501adf5c, E147 0x501b5cee/0x501b5f50, E144 0x5015775c/0x501579be). The tier
// A-C bodies' as the step-1 resource survey read them (D: its own slot scan from the index read at the address given;
// E118/E120's last record and E122's font and image records it did not find).
const E143_LOADER = { font: [0xA4F63680, 0xC7C00], images: [0xA403D000, 0xA45FD000], string: [0xA502B680, 0x5FC00] };
const LOADER_FOUND = {
  E143: E143_LOADER, E146: E143_LOADER,
  E147: { font: [0xA505D600, 0xC7C00], images: [0xA403D000, 0xA46DD000], string: [0xA5125600, 0x5FC00] },
  E144: { font: [0xA3FDF540, 0x9FC00], images: [0xA3091000, 0xA3791000], string: [0xA407F540, 0x5FC00] },
  E139: { font: [0xA3F63540, 0xC7C00], images: [0xA303D000, 0xA373D000], string: [0xA402B540, null] },       // 0x501589df
  E134: { font: [0xA402F540, 0xC7C00], images: [0xA3109000, 0xA3809000], string: [0xA40F7540, 0x5FC00] },    // 0x501511cd
  E137: { font: [0xA3FDF540, 0x9FC00], images: [0xA3091000, 0xA3801000], string: [0xA407F540, 0x5FC00] },    // 0x50145bf9
  E142: { font: [0xA3FB7540, 0xC7C00], images: [0xA3091000, 0xA3611000], string: [0xA407F540, 0x5FC00] },    // 0x5013ab69
  E140: { font: [0xA3FB7540, 0xC7C00], images: [0xA3091000, 0xA3611000], string: [0xA407F540, 0x5FC00] },    // 0x5013abe6
  E125: { font: [0xA3BB7540, 0xC7C00], images: [0xA2C91000, 0xA3691000], string: [0xA3C7F540, 0x5FC00] },    // 0x501571f1
  E145: { font: [0xA3EB7540, 0x1C7C00], images: [0xA3091000, 0xA3491000], string: [0xA407F540, 0x5FC00] },   // 0x50150b1d
  E129: { font: [0xA3FB7540, 0xC7C00], images: [0xA3091000, 0xA3991000], string: [0xA407F540, 0x5FC00] },    // 0x5013f12b
  E130: { font: [0xA3FB7540, 0xC7C00], images: [0xA3091000, 0xA3611000], string: [0xA407F540, 0x5FC00] },    // 0x50145c26
  E132: { font: [0xA3EB7540, 0x1C7C00], images: [0xA3091000, 0xA3991000], string: [0xA407F540, 0x5FC00] },   // 0x5013f193
  E133: { font: [0xA3FB7540, 0xC7C00], images: [0xA3091000, 0xA3611000], string: [0xA407F540, 0x5FC00] },    // 0x5013f9d6
  E118: { font: [0xA3122C00, 0x7FC00], images: [0xA24E2C00, null], string: [0xA31A2C00, 0x3FC00] },          // 0x50280327
  E120: { font: [0xA3122C00, 0x7FC00], images: [0xA24E2C00, null], string: [0xA31A2C00, 0x3FC00] },          // 0x502768cd
  E122: { font: [null, null], images: [null, null], string: [0xA2CE3C00, null] },                            // 0x5029770a
};
// The kernel's CPUs, the SCPU's backup requests, the display's change task and the timer start's reload,
// [kernel.cpus, scpu.backup, display.change_task, timer.reload_less_one]: the kernel-entry stubs (24 00 02 fc d0 imm32
// f2 f0) counted over each expanded image, whether it holds "ScpuBkupW" and "[CHG] CHG MAIN S" (X, a byte scan and a
// string count; the stubs' runs D on E143 0x5001184c and E144 0x50011676), and whether the timer start takes one off
// the period after its errlog 0x19000401 (D on E143 0x500644bb, E139 0x50058c47 and E144 0x50055f4d, X elsewhere by a
// byte scan; null: the E118 family has no such errlog). E143's change task is DISPLAY_CHANGE, static task 143 (D);
// E144 has none, its DISPLAY task logs the changes (D 0x501711a4); nor has E125, whose static tasks hold none of its
// priority and stack (D)
const TRAITS_FOUND = {
  E143: [4, true, true, false], E146: [4, true, true, true], E147: [4, true, true, true], E144: [3, false, false, true],
  E139: [3, true, false, false], E134: [3, true, false, false], E137: [3, false, false, false], E142: [3, false, false, false],
  E140: [3, false, false, false], E125: [3, false, false, false], E145: [3, false, false, true], E133: [3, false, false, false],
  E130: [3, false, false, false], E129: [3, false, false, false], E132: [3, false, false, false],
  E118: [3, false, false, null], E122: [3, false, false, null], E120: [3, false, false, null],
};
// The dial-table select where it is not the map's pairing of E143's dial init 0x5014b7c7, and board 0's id table
// where it was found without the rule: E143's (D: 0x5014b7d2 indexes 0x60223e3c, whose first word it is), E144's and
// E147's as src/fw/models.mjs overrides of E143's 0x60223dbc gave them by hand before the rule (E144: D, 0x5010f0e2
// indexes 0x601ca2e4 by the board, whose first word it is, 3 slot ids 0x2032103, 0x2031903, 0x2031902 follow, the map
// alone placed 0x601ca2d0; E147: X, the dial init stores it), E139's (D: the select 0x5010f9a1, its encoder init,
// indexes 0x601cbf10, whose first word it is; its 4 slot ids 0x2032105, 0x2031902, 0x2031903, 0x2032104 follow at
// 0x601cbee4), and E134's and E125's, read by dialStore (E134: D, its hand dial before the rule, the first word of the
// board table 0x601bcbac; E125: D, the word table 0x61f8c914's first, for board 0's pair index 0 at 0x601c521a)
const DIAL_FOUND = {
  E143: { table0: 0x60223DBC }, E144: { table0: 0x601CA2A8 }, E147: { table0: 0x602405D8 },
  E139: { select: 0x5010F9A1, table0: 0x601CBEE4 },
  E134: { table0: 0x601BCB8C }, E125: { table0: 0x601C523C },
};
// The display task init (display.task_init; src/fw/facts.mjs displayTaskInit): E143's (D: its boot calls it at
// 0x50024a6c), E144's and E134's as src/fw/models.mjs gave them by hand before the rule (D: E144 called at 0x50024ef2;
// E134 after the ret at 0x5020eab2, called at 0x5002248c), and E145's (D: its one call 0x50022054, its trace call
// first, then E143's opening `clr d0` at 0x501eb18c)
const TASK_INIT_FOUND = { E143: 0x501C2F13, E144: 0x50021444, E134: 0x5020EAB5, E145: 0x501EB17F };
// The face plane's colour setter (display.face_colour; src/fw/facts.mjs faceColourSet), where it is traced: E137's
// as its port placed it and E145's (D: 0x50023161 and 0x5016dc26, each `mov d1,d2; mov a0,a2; call`, then the trace)
const FACE_COLOUR_FOUND = { E137: 0x50023161, E145: 0x5016DC26 };
// The DISPLAY queue's static id as src/lab/play.mjs gave it by hand before the rule (E143, E146, E147: X, the run-time
// word; E144: D, the queue name table)
const DISPLAY_QUEUE_FOUND = { E143: 0x88, E146: 0x89, E147: 0x89, E144: 0x8C };
// The asynchronous DISPLAY sends (dispq.sends) the lab knew before the rule: E144's knob dispq_send_returns, as
// src/fw/models.mjs gave it (D), and E139's, carried from it (src/fw/ports.mjs KNOBS before the rule, X)
const DISPQ_FOUND = { E144: [0x50172492], E139: [0x5017388D] };
// The DISPLAY task loop (dispq.loop; src/fw/facts.mjs displayLoop): E143's as the lab gives it (src/lab/display.mjs
// DISPLAY_LOOP, its task 54, D), E144's as its hand override gave it before the rule (task 59, D), and E145's, which no
// port placed before the rule (task 58: its entry after a `ret [],4`, the trace call first, the receive at 0x501eb289,
// D)
const LOOP_FOUND = { E143: 0x501C3035, E144: 0x50170FFF, E145: 0x501EB256 };
// The DISPLAY task's start-up calls (dispq.start; src/fw/facts.mjs displayStart): E143's as the lab gives it
// (src/lab/display.mjs S-DISPSTART, the call of 0x500239c9, D), E125's (its trace, then the TFT open 0x50229c1a, D) and
// E137's (its trace, then 0x50020d81, D)
const START_FOUND = { E143: DISPLAY_START_E143, E125: [0x50228B02, 0x50228B15], E137: [0x5015E8F1, 0x5015E908] };
// The UI_IN task (ui_in.task; src/fw/facts.mjs uiInTask): E143's as the lab gives it (src/lab/play.mjs UI_IN, its task
// 0x54, D) and E125's, which no port placed before the rule (task 0x5e: a 16 ms poll first, the flag word's load
// 0x32 bytes in, D)
const UI_IN_FOUND = { E143: 0x5014B736, E125: 0x500FEBDE };
// UI_IN's forward sites (ui_in.forward; src/fw/facts.mjs uiInForward): E143's forward as the lab gives it
// (src/lab/play.mjs UI_IN_FWD, D) and E122's three inline tests of the sink in its post (D)
const UI_IN_FWD_FOUND = { E143: [{ at: 0x5014C3EB, reg: 'd0' }],
  E122: [{ at: 0x5017919F, reg: 'd2' }, { at: 0x50179230, reg: 'a2' }, { at: 0x501792BA, reg: 'a2' }] };
// The DISPLAY loop's replies (dispq.replies; src/fw/facts.mjs displayReplies): E143's as the lab gives them
// (src/lab/play.mjs DISPQ_REPLY_RETURNS, D) and E122's in its loop (D)
const REPLIES_FOUND = { E143: [0x501C4913, 0x501C4974], E122: [0x502F5AC7, 0x502F5B26] };
// The modules' constructor tables (ctors; src/fw/facts.mjs ctorTables): E143's and E122's as their runners' blocks
// give them (D: E143 0x501e60ae.., 0x501e6124; E122 0x5004ca97..0x5004cad6)
const CTORS_FOUND = { E143: CTORS_E143, E122: [[0x6069B240, 11], [0x60A4FDD0, 39], [0x60FDC1A0, 63], [0x610F1E1C, 14]] };
// The touch task's start in the boot (touch_start; src/fw/facts.mjs touchStart): E143's as the lab gives it
// (src/lab/play.mjs TOUCH_INIT and TOUCH_TASK_ID, the boot's call at 0x50024ca6, D), and E134's and E125's, where the
// maps placed the init at another start's (D)
const TOUCH_START_FOUND = {
  E143: { init: 0x501E3DCA, id_word: 0x60042DCC }, E134: { init: 0x50217D43, id_word: 0x6004145E },
  E125: { init: 0x5022D065, id_word: 0x60040CAA },
};
// The power manager's start and the power-off (power.off; src/fw/facts.mjs powerOff): E143's as src/fw/models.mjs gave
// them by hand before the rule (POWER_OFF_E143, D; the task by its static id word now, not its entry), E146's and
// E147's as read by hand (D, 2026-10-29: E146 the starter's call 0x500241a1 and id word 0x60042d62, the sequence's
// expander commands 0x50057a66 / 0x50055c5b with their waits 0x50058715 / 0x50056b76, the 0x85 sender 0x5005e87f's
// poll 0x5005e931, the last write 0x5004fa52 at 0x500459ee, the RAM log's write 0x5190a062, shutDown 0x50b08199
// loading 0x10102 at +0x10; E147 the starter's 0x50024120 with 0x60042ce2, the sequence 0x50045807 calling no
// expander, the sender 0x500599f7's poll 0x50059aa9, the last write 0x5004f78f at 0x50045923, the RAM log's write
// 0x519123a8), and none on the bodies whose firmware holds no start of PWR_MAIN (X)
const POWER_SEQ_FOUND = {
  E143: POWER_OFF_E143,
  E146: {
    pwr: { init: 0x50045ABD, id_word: 0x60042D62 },
    shutdown: { object: 0x50B07B86, slot: 2, entry: 0x50B08199, mode: 1, reason: 1 },
    flash_save: 0x50B017E1, log: { nand: [0x4E820000, 0x200000], ret: 0x5190A069 }, end: 0x500459F5,
    ioexp: { body: { post: 0x50058507, flag: 0x6004319E }, pbh: { post: 0x50056960, flag: 0x600431AE } },
    poll: { at: 0x5005E931, pin: 102 },
  },
  E147: {
    pwr: { init: 0x500459F2, id_word: 0x60042CE2 },
    shutdown: { object: 0x50B124FA, slot: 2, entry: 0x50B12B11, mode: 1, reason: 1 },
    flash_save: 0x50B0C09E, log: { nand: [0x4E820000, 0x200000], ret: 0x519123AF }, end: 0x5004592A,
    ioexp: null, poll: { at: 0x50059AA9, pin: 102 },
  },
  E144: null, E139: null, E134: null, E137: null, E142: null, E140: null,
};
// The touch task's command queue (touch_task; src/fw/facts.mjs touchQueue): E143's as the lab gives it
// (src/fw/facts.mjs TOUCH_TASK_QUEUE_E143: the flag its loop waits on at 0x501e3ef2, the queue it receives from at
// 0x501e4053, bit 8 tested at 0x501e4038, D), E134's (0x50217e68, 0x50217eb2, D) and E130's, whose flag is not the
// map's place of E143's (0x50207909, 0x50207953, D)
const TOUCH_QUEUE_FOUND = {
  E143: TOUCH_TASK_QUEUE_E143, E134: { flag: 0x60041710, queue: 0x60041972, bit: 8 },
  E130: { flag: 0x60420D54, queue: 0x60420F48, bit: 8 },
};
// The shooting callbacks' ids (cbs; src/fw/facts.mjs cbsIds): E143's as the lab gave them (src/lab/camapp.mjs, D:
// docs/om1-shutter-spec.md item 20), and E142's, E140's and E133's, whose CBS_END_SHOOTING_PICTURE is 369 in their CBS
// name tables (E142 0x60a6c7f4, D)
const CBS_FOUND = { E143: CBS_E143, ...Object.fromEntries(['E142', 'E140', 'E133'].map((m) => [m, { ...CBS_E143, END_SHOOTING_PICTURE: 369 }])) };
// The lens record's zoom table (lens_record.zoom_table; src/fw/facts.mjs lensZoomTable): E143's as the lab gave it
// (src/lab/camapp.mjs S-LENS, the focal-length read's `add 1164,a0` at 0x5012998f, D), E140's and E130's (their
// interpolations' index, E140 0x500d9660 `add 1156,a2`, D)
const LENS_TABLE_FOUND = { E143: LENS_ZOOM_TABLE_E143, E140: 1156, E130: 644 };
// The display sync's functions as read at the code (display.sync; D: E137's request 0x502bd2d2 and image sync
// 0x502bd5bc by their API ids, the setter 0x507a2fa4 its release calls at 0x509797ee, released with kind 1 for both
// panels; E122's request 0x502c9c6c by its name, its image sync 0x502c9f95 by its id, the setter 0x50695318 stopRecView
// calls per panel at 0x5081199e and 0x508119c2, released with kind 0)
const SYNC_FOUND = { E137: { request: 0x502BD2D2, image_sync: 0x502BD5BC, sync_set: 0x507A2FA4, kind: 1, panels: [2] },
  E122: { request: 0x502C9C6C, image_sync: 0x502C9F95, sync_set: 0x50695318, kind: 0, panels: [0, 1] } };
// The module-9 state readers (app.module9_readers) as src/fw/models.mjs gave them by hand before the rule (E144, E139:
// D, each call checked), and E143's lab lists, which E143's readers must hold (src/lab/camapp.mjs CA_MODULE9_READERS,
// src/lab/menu.mjs TAKEOVER_READERS)
const MODULE9_FOUND = {
  E144: [0x50839A80, 0x5083BF85, 0x5083BF90, 0x5083BFFF, 0x5083CB8F, 0x5083CD3C, 0x5083CF7C, 0x5083D03D, 0x5083D055,
    0x5083D848, 0x5084B32D, 0x5084B33A, 0x50860D47, 0x5086112B, 0x508612CA, 0x508612D7, 0x50861313, 0x508760CE,
    0x5094CD79, 0x509F90AB, 0x50A0B092, 0x50A2640C],
  E139: [0x507F52AF, 0x507F789A, 0x507F78A5, 0x507F7914, 0x507F849C, 0x507F8649, 0x507F8876, 0x507F8935, 0x507F894D,
    0x507F908B, 0x508069BD, 0x508069CA, 0x5081C015, 0x5081C3F9, 0x5081C58A, 0x5081C597, 0x5081C5D3, 0x50830B0F,
    0x509058CC, 0x509B0D94, 0x509C2B18, 0x509DD08E],
};
const E143_MODULE9_LISTED = [0x50ABE026, 0x50AF63F3, 0x50ABB039, 0x50ABA912, 0x50AE0FA3, 0x50AE138C, 0x50AE1559, 0x50AE1566,
  0x50AE15A2, 0x50ABCFD7, 0x50ABCFE2];
// The language's settings-store id (text.lang_setting): E143's (D: mov 3009,d0 at 0x51257c0b in its language
// loader), E147's and E144's as src/lab/text.mjs gave them by hand before the rule (E147: X, the paired loads of the id
// read 3011 at 6 of 9 sites; E144: D, its language getter), E129's and E118's as read at the load (D: 0x50db2655,
// 0x50cd5a8b) and the others' as a walk of each expanded image from the port's place of the loader found them (X)
const LANG_FOUND = {
  E143: 3009, E146: 3009, E147: 3011, E144: 3009, E139: 3009, E134: 3009, E137: 3009, E142: 3009, E140: 3009,
  E145: 3009, E125: 1709, E129: 1709, E130: 1709, E132: 1709, E133: 1709, E118: 1509, E120: 1509, E122: 1509,
};
// The ListMenu open's tab and page memories (menu.tab_memory, menu.page_memory) as read at the loads (D: E143
// 0x511bd163/0x511bd183, E146 0x511cbf5e/0x511cbf7e, E147 0x511ddac2/0x511ddae2); the other 15 bodies have none (X)
const MEMORY_FOUND = { E143: [1881, 1882], E146: [1881, 1882], E147: [1909, 1910] };
// The bodies without a touch-panel driver (touch_panel.driver false; src/fw/facts.mjs touchDriver): E145, whose image
// holds no "tp_drv_" string and whose boot calls no touch init where E142's does (X, a string count; D, E142
// 0x5002562d), and E129 and E132 (TG-5), which hold the driver's debug callback's trace but load it nowhere; the
// other 15 load it once (X, a load count)
const NO_TOUCH_DRIVER = ['E145', 'E129', 'E132'];
// The bodies without a lens mount's lens record (lens.mount false; src/fw/facts.mjs lensMount): E145 (TG-7), E129 and
// E132 (TG-5), the built-in-lens bodies, whose application loads no API id 0x20041 (getLensConnection on E143, D:
// 0x504106fc; X, a byte scan); the other 15 hold its one lens record test (X)
const NO_LENS_MOUNT = ['E145', 'E129', 'E132'];
// The lens driver's entry points, LENS_EXEC's queue, the lens-0 flags and the lens caches' NAND (lens_driver;
// src/fw/facts.mjs lensDriver) at the port's places: E143's as src/fw/models.mjs gave them by hand before the rule
// (lens_native, D), E146's and E147's as read in their code (D: the boot's starts of LENS_MAIN and LENS_ASKDATA at
// E146 0x50024b7e / 0x50024b9d and E147 0x50024afd / 0x50024b1c, after the module init's call; LENS_COMMAND's receive
// at E146 0x50115a2a and E147 0x5011f84f; the flags' accessors from E146 0x50126cbf and E147 0x50130ae4; the ready
// byte's store after the state poll at E146 0x502db176 and E147 0x502eca36; the lens-cache tables E146 0x602b9f84 and
// E147 0x602cb290, E143's rows), none on the other 15 bodies (X: the rule's E143 shapes are not all there)
const LENS_DRIVER_FOUND = {
  E143: LENS_DRIVER_E143,
  E146: { module_init: 0x502BCFA8, cache_init: 0x502BD609, task_vars: 0x502BD097, tasks: [0x502BD0CF, 0x50115A08, 0x502BF42B],
    exec_queue: 0x6004325E, flags: { valid: 0xA32D4B98, attach: 0xA32D4B9A, ready: 0xA32D4B94 }, cache_area: [0x416E0000, 0x1C0000] },
  E147: { module_init: 0x502CE868, cache_init: 0x502CEEC9, task_vars: 0x502CE957, tasks: [0x502CE98F, 0x5011F82D, 0x502D0CEB],
    exec_queue: 0x600431D0, flags: { valid: 0xA32D3D30, attach: 0xA32D3D32, ready: 0xA32D3D2C }, cache_area: [0x416E0000, 0x1C0000] },
};
// The IIC bus driver's completion wait (iic.waits; src/fw/facts.mjs iicWaits), as read (D: E143's at 0x5004cbf6,
// waiting on (0x60043086), which its callback 0x5004cb95 sets; E145's at 0x50044d60, the compass WHOAMI read's at
// 0x50044c97, callback 0x50044cff, flag (0x60041508)); E134 has another driver and none (D: 0x50042df1); the other
// 15 bodies have one each (X, the rule)
const IIC_FOUND = { E143: [0x5004CBF6], E145: [0x50044D60], E134: [] };
// The touch panel's traced I2C functions (touch, [i2c_write, i2c_read]; src/fw/facts.mjs touchI2c): E134's as read at
// their traces (D: 0x5021843d, 0x5017ca38, each its function's first call after a return), the others' as a byte
// scan of each expanded image found the traces and their functions (X); E137's write is traced inside a larger
// function (0x50177445, D), not read; the other 11 bodies trace neither
const TOUCH_FOUND = {
  E134: [0x5021842D, 0x5017CA2A], E137: [undefined, 0x5017771A], E125: [0x5022D6AB, 0x50185997],
  E133: [0x501F8C5C, 0x50166970], E130: [0x50207E86, 0x5016CAD6], E129: [0x501F08F6, 0x501630F0],
  E132: [0x501F09AE, 0x501630DE],
};
// The device open's per-frame wait flag (display.frame_wait; src/fw/facts.mjs frameWait) as found before the rule:
// E144's as src/fw/models.mjs gave it by hand (D: the open waits at 0x50181d17, the callback 0x5018220c sets it), E139's
// as carried from it then (D: its open waits at 0x5018264c), E134's at its wait (D: 0x50211247, the callback's sets
// 0x50211701, 0x50211713), E143's at its open (D: 0x501d7e78), E129's at its `mov a3,a0` form (D: 0x501ee0ea); and the
// software-timer sleep (display.timer_sleep; timerSleep) read at its opening (D: E143, E144, E139, E134)
const FRAME_WAIT_FOUND = { E143: 0x60043088, E144: 0x600416AC, E139: 0x600414B6, E134: 0x6004172E, E129: 0x604211F4 };
const TIMER_SLEEP_FOUND = { E143: 0x501C2E94, E144: 0x50170F80, E139: 0x50172271, E134: 0x5020EA33 };
// The touch panel's open (touch_api.open; src/fw/facts.mjs touchOpen) at its trace: E143's as src/lab/play.mjs gives it
// (TP_OPEN; D: 0x501e40da loads "[TP]open" at 0x501e40de), E125's, E134's and E137's as their maps placed it before the
// rule (D: 0x5018504a, 0x5017c073 and 0x5017677c load "[TP]OPEN \n" before their first call)
const TP_OPEN_FOUND = { E143: 0x501E40DA, E125: 0x5018504A, E134: 0x5017C073, E137: 0x5017677C };
// The AE interpolation's init and form (ae; src/fw/facts.mjs aeInit): E143's as src/lab/play.mjs gives it by hand
// (AE_INIT, AE_REGIONS; D: 0x50560b29's memsets, the div at 0x5056319c), E139's and E134's as read at their inits and
// interpolations (D: 0x50411e84 and 0x50414400's div at 0x50414464; 0x50427066, three memsets then 0x50429171, and
// 0x50429386, which divides nowhere), and E125's and E137's inits, which their maps place elsewhere (D: 0x50415967 and
// 0x503f97c3 open with the memsets of 76, 84 and 16 bytes), and E145's row form (D: 0x503e4fce, which fills the y
// column of the rows at 0x61a31714 and opens with no memset)
const AE_FOUND = {
  E143: { init: 0x50560B29, regions: [[0x62A919DC, 80], [0x62A91A2C, 88], [0x62A91A84, 16], [0x62A91ABA, 104]], table: true },
  E139: { init: 0x50411E84, regions: [[0x62167D90, 76], [0x62167DDC, 84], [0x62167E30, 16], [0x62167E66, 104]], table: true },
  E134: { init: 0x50427066, regions: [[0x6237CE98, 76], [0x6237CEE4, 84], [0x6237CF38, 16]], table: false },
  E125: { init: 0x50415967 }, E137: { init: 0x503F97C3 },
  E145: { init: 0x503E4FCE, regions: [], table: false, rows: 0x61A31714 },
};
// The shooting service's start and end trace loads and its through-image control's entry (shooting; src/fw/facts.mjs
// shootingService): E139's and E134's as read at the loads (D: 0x5081c17b / 0x5081271b; 0x5084050b, after the
// API_ERROR_FAIL return path, / 0x50836b06) and entries (D: 0x507f7c2c and 0x5081c396 after a `ret [a2],60`, each
// opening `mov a0,a3; mov d1,a2; mov d0,d2` as E143's), and E145's (D: the loads 0x506cd5f7 / 0x506c409a; the entry
// 0x506aad24, which prints its d0)
const SHOOTING_FOUND = { E139: { start: 0x5081C17B, end: 0x5081271B, auto_through: 0x507F7C2C },
  E134: { start: 0x5084050B, end: 0x50836B06, auto_through: 0x5081C396 }, E145: { start: 0x506CD5F7, end: 0x506C409A, auto_through: 0x506AAD24 } };
// The GUI task's take (menu.take; src/fw/facts.mjs guiTake) as read after its receive loops (D: E143's call
// 0x510c2a2e, the lab's DISPATCH; E144 0x50d1c54d and E139 0x50cc49a6, the calls their maps placed; E134 0x50d04704,
// the compare after the load, where its hand override had the load 0x50d04700; E137 0x50c5ee9a; E118 0x50b93379 and
// E120 0x509140e2, the compares after the loads of their second loops, whose a3 is set before the first)
const TAKE_FOUND = { E143: 0x510C2A2E, E144: 0x50D1C54D, E139: 0x50CC49A6, E134: 0x50D04704, E137: 0x50C5EE9A, E118: 0x50B93379, E120: 0x509140E2 };
// The GUI caller's word (menu.caller; src/fw/facts.mjs guiCaller): E143's as the lab gives it (src/lab/menu.mjs
// GUICALLER), E122's as its port placed it, and E118's and E120's as their GUI tasks load it after the take (D: E118
// 0x50b933d4, E120 0x5091413d), where their ports had placed none of their code's words
const CALLER_FOUND = { E143: 0x60368B88, E122: 0x6160C04C, E118: 0x615E9970, E120: 0x615E81D4 };
// The kernel's interrupt handler tables (kernel.handlers; src/fw/facts.mjs handlerTables): E143's as the lab gives it
// (src/lab/irq.mjs HANDLER_TABLE), the others' where their ports placed E143's before the rule (E146 and E147 at E143's
// own address, kept), each the first of the attach's stores (D: E144 0x5003408b, E122 0x5004c82e); E118's and E120's,
// which their ports had kept at E143's address, at their attach's stores (D: E118 0x5004c80f, E120 0x5004c7bf)
const HANDLERS_FOUND = { E143: 0xA32600C0, E146: 0xA32600C0, E147: 0xA32600C0, E144: 0xA262EAD8, E139: 0xA266EAD8,
  E134: 0xA2853C1C, E137: 0xA25F08B8, E142: 0xA26CA7BC, E140: 0xA26CA7BC, E125: 0xA2701C0C, E145: 0xA216ADD8,
  E133: 0xA2A8770C, E130: 0xA2ADEF0C, E129: 0xA2ACAF0C, E132: 0xA2ACAF0C, E122: 0xA1BF3984, E118: 0xA1BB3994, E120: 0xA1BB3994 };
// The frame period words (frame_period; src/fw/facts.mjs framePeriod) as found before the rule: E143's as the lab
// gives them (src/lab/display.mjs DEVICE), E144's and E139's as their maps placed them (D: their getters 0x50021935 /
// 0x50022011 and 0x50021740 / 0x5002201a), E134's EVF word as its hand override gave it (D: getter 0x50210666, setter
// 0x5021066f), E137's EVF word at its getter 0x5002106f (D: the setter at 0x50021078 is E144's), E145's at its
// setters (D: TFT 0x501ed5ee, EVF 0x501ec907, which follows a getter of another word), E125's at its setters, which
// store d0 at once (D: TFT 0x5022abad, EVF 0x50172b10, after the getters 0x5022ab9b and 0x50172b07); E122's vtotal
// functions return constants (D: TFT 0x50302e5f 495, EVF 0x502fa8eb 825) with no getter within 4 KiB (X), so none
const PERIOD_FOUND = {
  E122: { tft: null, evf: null },
  E143: { tft: 0xA32DB47C, evf: 0xA32DB428 }, E144: { tft: 0x620C62E8, evf: 0x620BFB98 },
  E139: { tft: 0x621057DC, evf: 0x620FF098 }, E134: { tft: 0x6231C74C, evf: 0x6231682C },
  E137: { tft: 0x62105B8C, evf: 0x620FF45C }, E145: { tft: 0x61CD28D4, evf: 0x61CCC97C },
  E125: { tft: 0x62240D68, evf: 0x6223AB20 },
};
// The hardware-timer table (hw_timer; src/fw/facts.mjs hwTimer) as read at the inits: E143's and E144's pointer words
// (D: stored at 0x500642f4 and 0x50055de4, the lab's HW_TIMER_PTR and E144's map place), E125's fixed table (D:
// `add 0x600cd6d0,a0` at 0x50057695, no pointer word), E122's fixed table of 8-byte entries (D: `asl 3,d2; mov
// d2,a0; add 0x6012fa78,a0` at 0x5006eda3, the enable `movhu (4,a0),d0; cmp 1,d0` at 0x5006edb4)
const HW_TIMER_FOUND = { E143: { ptr: 0xA32CA47C }, E144: { ptr: 0xA2681E2C }, E125: { table: 0x600CD6D0 }, E122: { table: 0x6012FA78, entry: 8, enable: 4 } };
// The display init's second part (display.init_2nd; src/fw/facts.mjs displayInit2nd): E125's (D: the guarded call
// 0x50228cd8 in its DISPLAY loop's OPEN case, guard word 0x61f8f0c4)
const INIT_2ND_FOUND = { E143: null, E144: null, E125: { entry: 0x50170A21, once: 0x61F8F0C4 } };
// The C-runtime clock read (crt.clock_read; src/fw/facts.mjs crtClockRead): the lab's K_CRT_134D on E143, E144's as
// its map placed it, E125's (D: the targets of the calls 0x5005a6cb, 0x50050db9 and 0x50052444)
const CRT_FOUND = { E143: 0x3FFE134D, E144: 0x36FDFCA1, E125: 0x36FDFD0B };
// The frame display mode set (frame_mode.set; src/fw/facts.mjs frameModeSet) as the TAKE requests call it: none on
// E143, whose request maps bits to a mask (D: 0x5039f583..0x5039f622), E144's hand override's (D: the call at
// 0x5028dd90), E125's (D: the call at 0x5029ae3b, after the clamp to 0..3)
const FRAME_MODE_FOUND = { E143: undefined, E144: 0x500257D4, E125: 0x50021E55 };
// The frame plane's uploads on the clamp form (frame_plane; src/fw/facts.mjs framePlane): none read on E143 (the mask
// form); E142's mode byte and its three uploads, E130's AF upload as its hand override gave it before the rule, E145's
// two uploads and no third (D: E142 0x50025ca1, 0x50025ce4, 0x50025d21; E130 0x50022dd8; E145 0x500226e9, 0x5002272c
// and the plane's end after them, 0x50022769 posting flag 256)
const PLANE_FOUND = {
  E143: undefined, E142: { mode: 0xA26A367C, uploads: [0x50025CA1, 0x50025CE4, 0x50025D21] },
  E130: { mode: 0xA2AB74C0, uploads: [0x50022D69, 0x50022DA4, 0x50022DD8] },
  E145: { mode: 0xA213A48C, uploads: [0x500226E9, 0x5002272C, null] },
};
// The output-device property's id (prop.device; src/fw/facts.mjs propDevice), the `mov imm16,d0` before the reads
// S-PROP answers (D: E143 0x503eff59, E134 0x502ebabc, E125 0x502dc5fb, E145 0x502af089)
const PROP_DEVICE_FOUND = { E143: 4513, E134: 4513, E125: 4013, E145: 4013 };
// The EVF's device code (prop.evf_code; src/fw/facts.mjs evfCode), the `cmp imm8,d0` before the property writer's
// `mov prop,d0; mov 8,d1` (D: E143 0x501e8ad4 `cmp 2`, E125 2 before 0x50188f34, E122 0x5018494d `cmp 6`, E118 6
// before 0x50174b39), and its place in the build's device-name switch (E122 0x502fbf76: 6 BI_EVF, D)
const EVF_CODE_FOUND = { E143: 2, E125: 2, E122: 6, E118: 6 };
// The function direct start past its checks and its id's place (func_direct; src/fw/facts.mjs funcDirect) as read at
// the functions (D: E143's lab FUNC_DIRECT_RUN, the id at (28,sp); E146 0x51076f24, E147 0x51081609, E144 0x50cf85ca
// and E134 0x50ce448f, their maps' places, E139 0x50ca35f0, its hand override's; E137 0x50c4413f and E125
// 0x50d29229, which their maps left unplaced; E146, E144, E137 and E125 keep the id in d3), E142 0x50cc0285 (the id
// in d2; it holds no start trace, D), and none on E118, which has no function of this shape (X)
const DIRECT_FOUND = {
  E146: { run: 0x51076F24, id: { reg: 'd3' } }, E147: { run: 0x51081609, id: { sp: 28 } },
  E144: { run: 0x50CF85CA, id: { reg: 'd3' } }, E139: { run: 0x50CA35F0, id: { sp: 28 } },
  E134: { run: 0x50CE448F, id: { sp: 28 } }, E137: { run: 0x50C4413F, id: { reg: 'd3' } },
  E125: { run: 0x50D29229, id: { reg: 'd3' } }, E142: { run: 0x50CC0285, id: { reg: 'd2' } }, E118: undefined,
};
// The event broker init (broker.init; src/fw/facts.mjs brokerInit) as read at the functions (D: E143's lab
// BROKER_INIT, E139's hand override's place before the rule, E137's, called by its wrapper 0x501dbcc5), and the
// places of E143's the maps gave (E146, E147, E144, E134, E145), which the rule's agree with (X)
// E122's init opens with two calls on the queue's id and is called by its wrapper 0x501a825a (D)
const BROKER_FOUND = {
  E143: 0x502A48B6, E139: 0x501EE6F6, E137: 0x501DBCDB, E146: 0x502BBB36, E147: 0x502CD3BA, E144: 0x501ECFE6,
  E134: 0x501E3E93, E145: 0x501E44E1, E122: 0x501A8270,
};
// The error log (errlog.entry; src/fw/facts.mjs errlogEntry): E143's as the lab gives it (src/lab/rtos.mjs ERRLOG,
// D), the places of E143's the maps gave (E146, E147, E144, E139, E134, E137, E142, E140, E125, E145), and on the
// bodies whose maps place none the callee of the hardware-timer start's errlog `mov 0x19000401,d0; call` (E133
// 0x5005175b, E130 0x500517dd, E129 0x500562ca, E132 0x500562a6) or, on the E118 family, which has no such call, the
// callee most often called right after `mov imm32,d0` (X, a byte scan; each tests the id's module, D)
const ERRLOG_FOUND = {
  E143: 0x50047313, E146: 0x50047F1A, E147: 0x50047A34, E144: 0x50041D51, E139: 0x50043A9F, E134: 0x500453BD,
  E137: 0x5003E9A9, E142: 0x500417E8, E140: 0x50041672, E125: 0x50041A17, E145: 0x500407F2, E133: 0x50040112,
  E130: 0x5003FDA7, E129: 0x50040967, E132: 0x50040943, E118: 0x5000318E, E122: 0x50003195, E120: 0x500031B7,
};
// The remaining-shots query (card.shots_query; src/fw/facts.mjs shotsQuery): E143's as the lab gives it
// (src/lab/camapp.mjs SHOTS_QUERY, D), the places of E143's the maps gave (E146, E147, E144, E139, E134, E137, E125),
// and on the other bodies the function their application's getAvailableShootCount calls for the count (D: E142's,
// E140's and E145's module-0x2800c wrapper, which S-CARD answers in their sessions, X; E133's, E130's, E129's and
// E132's wrapper of that module; the E118 family's with no trace)
// The card slots' detect states (card.detect; src/fw/facts.mjs cardDetect): the table the drive status's card-present
// test reads and its drive bound, as a separate byte scan for that test found them (X; E143's D at 0x5087bc22)
const DETECT_FOUND = {
  E143: [0xA33AF3D4, 2], E146: [0xA33E2088, 2], E147: [0xA33C9C50, 1], E144: [0xA27018B8, 1], E139: [0xA27487C0, 2],
  E134: [0xA290FE74, 2], E137: [0xA2680C10, 1], E142: [0xA2787684, 1], E140: [0xA2785998, 1], E125: [0xA27A10F8, 2],
  E145: [0xA2219288, 1], E133: [0xA2B16D0C, 1], E130: [0xA2B6A660, 1], E129: [0xA2B747D8, 1], E132: [0xA2B74D4C, 1],
  E118: [0xA1C47794, 1], E122: [0xA1C878DC, 1], E120: [0xA1C46B78, 1],
};
// The card's file system seams (storage; src/fw/facts.mjs fileSystem): E143's as src/fw/models.mjs gave them by hand
// before the rule (D, its storage entry; the tasks then by their entries 0x50894e37 and 0x5087cda8, whose starts read
// the id words), and of a body of each lineage the bring-up, FILECLBK's entry and busy word, the NAND access and the
// drive status as read in their code (D: E146 0x508a9a6d / 0x508a9adc, the busy store at 0x508a9ad3; E144 0x50685108 /
// 0x50685177, its area read 0x5068251a; E134 0x50659a4e / 0x50659ac4, whose FILECLBK sets no byte first; E125's drive
// status after its `clr d2`, 0x5061cb03); none on the E118 family (X: its SD command layer has another form)
const STORAGE_FOUND = {
  E143: { init: 0x5088FC8D, tasks: [0x60042D42, 0x60042D2A], fileclbk: { entry: 0x5088FCFC, queue: 0x1F, busy: 0x62AE4CD0 },
    nand: { access: 0x500022C2, area: [0x41A00000, 0x80000], read: 0x10200, write: 0x10100 }, command: 0x508AD03C,
    album_init: 0x508B67E8, status: 0x508A8327 },
  E146: { init: 0x508A9A6D, fileclbk: { entry: 0x508A9ADC, queue: 0x1F, busy: 0x62B3CDC8 } },
  E144: { init: 0x50685108, fileclbk: { entry: 0x50685177, queue: 0x22, busy: 0x6214F900 }, nand: { access: 0x5003B76C, area: [0x406A0000, 0x60000], read: 0x102, write: 0 } },
  E134: { init: 0x50659A4E, fileclbk: { entry: 0x50659AC4, queue: 0x22, busy: 0x623A935C } },
  E125: { status: 0x5061CB03 },
  E118: null, E122: null, E120: null,
};
const SHOTS_FOUND = {
  E143: 0x50419164, E146: 0x50414A5F, E147: 0x50422B7E, E144: 0x502FAB48, E139: 0x502F7CEB, E134: 0x50313E2D,
  E137: 0x502EC70F, E142: 0x502C79DB, E140: 0x502D63A0, E125: 0x50307376, E145: 0x502CEB73, E133: 0x502DAB10,
  E130: 0x502E943F, E129: 0x502BB7E3, E132: 0x502BD1C7, E118: 0x502C2877, E122: 0x502E3440, E120: 0x502BD9A9,
};
// CPU 0's init task and OlyTaWu (rtos.init_task, rtos.ta_wu; src/fw/facts.mjs initTask, taWu) at the port's places of
// the kcb and wup_tsk: E143's as the lab gives them (src/lab/kernel.mjs INIT_TASK_ENTRY, src/lab/rtos.mjs; D: the
// cores spec's BOOT_CPU0), E144's as its hand overrides gave them before the rules (D: task 1 at 0x60038b78, the
// wrapper's call 0x5003099e), the places the maps or the carry gave on E146, E147, E139, E134, E137 and (OlyTaWu)
// E142, E140 and E145 (X), and the others as a separate read of each table's rows and of each wup_tsk caller's
// opening found them (X)
const rt = (init_task, ta_wu) => ({ init_task, ta_wu });
const RTOS_FOUND = {
  E143: rt(0x5002CCA5, 0x5002C6A7), E146: rt(0x5002CD1F, 0x5002C721), E147: rt(0x5002CCA5, 0x5002C6A7),
  E144: rt(0x5003112E, 0x5003099B), E139: rt(0x5003112E, 0x5003099B), E134: rt(0x50031155, 0x50030903),
  E137: rt(0x50031127, 0x50030994), E142: rt(0x50032138, 0x500319A5), E140: rt(0x50032138, 0x500319A5),
  E125: rt(0x500311BA, 0x500309BE), E145: rt(0x50031198, 0x5003099B), E133: rt(0x50032177, 0x50031992),
  E130: rt(0x500321A3, 0x500319BE), E129: rt(0x500321A6, 0x500319BE), E132: rt(0x500321A3, 0x500319BE),
  E118: rt(0x50049D7F, 0x500488B7), E122: rt(0x50049D77, 0x500488AF), E120: rt(0x50049D7F, 0x500488B7),
};
// The calls of tsnd_dtq (rtos.tsnd_sites; src/fw/facts.mjs tsndSites): how many each body has (X, a byte scan at the
// port's place of tsnd_dtq); E143's are the lab's list (src/lab/play.mjs TSND_SITES, D)
const TSND_COUNT = {
  E143: 11, E146: 11, E147: 11, E144: 11, E139: 11, E134: 11, E137: 11, E142: 11, E140: 11, E125: 11, E145: 9, E133: 8,
  E130: 8, E129: 8, E132: 8, E118: 8, E122: 8, E120: 8,
};
const E143_TSND = [0x5002C187, 0x5002C1F1, 0x5002D516, 0x50031662, 0x509B242A, 0x509B2473, 0x5100B7EC, 0x5100B880, 0x518013FA,
  0x5180A529, 0x518919FA];
// The settings-DB init's flash save return (store.db_save; src/fw/facts.mjs dbSave) at the port's places of the DB init
// and the flash save: E143's as the lab gives it (src/lab/menu.mjs FLASH_SAVE_RETURN, D), the places the maps or the
// carry gave on E147, E144, E146, E139, E134, E125 and E137 (X), and E142's, the return of the save at 0x5029039c that
// S-FLASHSAVE met in its DB init (D, X)
const STORE_FOUND = {
  E143: 0x503C5537, E147: 0x503CFE53, E144: 0x502AF908, E146: 0x503C5EE2, E139: 0x502AA1A9, E134: 0x502C4E8B,
  E125: 0x502B9F83, E137: 0x502A4891, E142: 0x502903A3,
};
// The application's flash saves (store.app_saves; src/fw/facts.mjs appSaves): the returns found without the rule,
// which each body's list must hold (E144's and E139's hand flash_save_returns before the rule, D; E142's two that
// S-FLASHSAVE met in its start, X), and how many each body has (X, a byte scan of the flash save's calls)
const APP_SAVES_FOUND = {
  E144: [0x508766E8], E139: [0x50831128], E142: [0x5078949F, 0x5078995F],
};
const APP_SAVES_COUNT = {
  E143: 3, E147: 3, E146: 3, E144: 3, E139: 3, E134: 3, E125: 5, E137: 5, E142: 5, E140: 5, E145: 5, E133: 5, E130: 5,
  E129: 5, E132: 5, E118: 5, E122: 5, E120: 5,
};
// The touch I2C functions' length arguments (touch_args; src/fw/facts.mjs touchArgs) at the port's places: E143's as the
// lab read them before the rule (src/lab/display.mjs: the write's u16 at sp+20, the read's a1; D, 0x501e4e10 and
// 0x501e4f2e), E144's and E142's driver's (D: E142's write `movhu (292,sp),d2` after `add -268,sp`, its read
// `movhu (40,sp),d0` at 0x5016cc87; E144's the same at 0x5018aab3 and 0x5018ae92) and E134's (X, a walk of each)
const ta = (w, r) => ({ write_len: { sp: w }, read_len: r === 'a1' ? { reg: 'a1' } : { sp: r } });
const TOUCH_ARGS_FOUND = { E143: TOUCH_ARGS_E143, E147: ta(20, 'a1'), E144: ta(24, 40), E142: ta(24, 40), E134: ta(152, 36) };
// The PC state's USB-disconnect power-off post (power_off.usb_disconnect; src/fw/facts.mjs usbPowerOff) as read at
// the calls (D: E143's after its trace load 0x5106174a; E144's and E139's S-NOPOWEROFF call_skips as src/fw/models.mjs
// gave them by hand before the rule; E137's `mov 7,d0; mov a2,a0; call 0x50c3b781`, which E137's start reaches, X),
// none on E118, which holds no "startPowerOff"
// The change task the EVF's first open creates (display.change_entry; src/fw/facts.mjs displayChangeEntry), the entry
// as the creation loads it (D: E144 0x501747f4, E142 0x50157e7b, E139's packet store 0x50175bde) and as the EVF starts
// of E144, E139, E134, E137, E140 and E130 ask the kernel to start (X); none where the change task is static or the
// name is not held
const CHANGE_ENTRY_FOUND = {
  E143: null, E146: null, E147: null, E144: 0x50173B55, E139: 0x50174F55, E134: 0x5021007A, E137: 0x5016187E,
  E142: 0x50157137, E140: 0x5015713E, E125: null, E145: null, E130: 0x50200556, E133: 0x501F123F, E129: null, E132: null,
};
const POWER_OFF_FOUND = {
  E143: 0x510617BD, E144: 0x50CF0E21, E139: 0x50C9BDCC, E137: 0x50C3EF76, E118: undefined,
};
// The play component's wrappers (play.wrappers; src/fw/facts.mjs componentWrappers) at the port's place of the getter:
// E143's the lab's PLAY_COMPONENT (D, in its order), E137's ten as read at their getter calls (D), and how many the
// others have (X); where the map placed all sixteen of E143's (E146, E147, E144, E139, E134, E125) the port's places
// are among the rule's (X)
const WRAPPERS_FOUND = {
  E143: [0x50ACF156, 0x50ACF174, 0x50ACF18E, 0x50ACF1A8, 0x50ACF1E0, 0x50ACF1FA, 0x50ACF217, 0x50ACF233, 0x50ACF251,
    0x50ACF2AF, 0x50ACF2CB, 0x50ACF2E7, 0x50ACF303, 0x50ACF31F, 0x50ACF33C, 0x50ACF356],
  E137: [0x507BC059, 0x507BC077, 0x507BC091, 0x507BC0AB, 0x507BC0C7, 0x507BC0FF, 0x507BC119, 0x507BC13F, 0x507BC15C,
    0x507BC178],
  E146: 16, E147: 16, E144: 16, E139: 16, E134: 18, E125: 17, E142: 10, E140: 10, E132: 9, E133: 9, E129: 8, E130: 8,
  E145: 8,
};
// The GUI canvas, its OSD banks and the kind-3 area (gui; src/fw/facts.mjs guiCanvas): E144's and E139's as
// src/fw/models.mjs gave them by hand before the rule (D: E144 the record creator 0x50ca4d4d..84 and 0x50ca4dd8..e1,
// the bank setup 0x503ebfe3..0x503ec03d; E139 0x50c52548..5d, 0x503e9128..0x503e9176), and E143's as src/lab/osd.mjs
// gives them (D: the creator 0x5101146b..0x51011503, the bank setup 0x50533df2..0x50533e5f), on which E147 ran
// before the rule (X: bin/modelcheck.mjs)
const E143_GUI = { stride: 1664, height: 1200, banks: [[0xB7C31000, 0x1E7800, 2], [0xB7862000, 0x1E7800, 2], [0xB7493000, 0x1E7800, 2]], kind3: [0xB6ECC800, 2400] };
const E144_BANKS = [[0xAFCA0000, 0xD8000, 4], [0xAF940000, 0xD8000, 4], [0xAF5E0000, 0xD8000, 4]];
const GUI_FOUND = {
  E143: E143_GUI, E147: E143_GUI,
  E144: { stride: 1152, height: 768, banks: E144_BANKS, kind3: [0xAF3C3000, 1536] },
  E139: { stride: 1152, height: 768, banks: E144_BANKS, kind3: [0xAF270000, 1536] },
};
// The rec view component's state word and standby value (recview; D: E143 entryStandby 0x50c65ff2 -> 0x50c66a25 ->
// 0x50ab5fe7, E142 0x508f1cee -> 0x508f2721 -> 0x5074b31c, whose word E142's getRecViewState gate 0x5074b283 reads)
// The mode dial's code table and the names of its codes (mode_dial; src/fw/facts.mjs modeDial): E143's as the lab gives
// them (D: the table 0x602243a0 its dial-index reader 0x5014c0de reads, the MODEDIAL_ pairs 0x51a389fb), and E147's, whose
// table 0x60240b00 holds MY_MODE5 63 where E143's has MOVIE, named by its modedial_to_code table 0x5034c894 (D)
const MODE_DIAL_FOUND = { E143: MODE_DIAL_E143, E147: { table: 0x60240B00, names: [[1, 'P'], [2, 'A'], [3, 'S'], [4, 'M'], [53, 'MY_MODE1'],
  [54, 'MY_MODE2'], [55, 'MY_MODE3'], [56, 'MY_MODE4'], [62, 'B'], [63, 'MY_MODE5']] } };
const RECVIEW_FOUND = { E143: { word: 0x6035E9C8, standby: 1 }, E142: { word: 0x61FA73A0, standby: 1 } };
// The property store's module init and its object words (prop_store; src/fw/facts.mjs propStore): E143's (D: the
// settings init chain 0x503dae30 calls 0x503ee2d6 at 0x503dae75; its pointer stores 0x503ee375..0x503ee39b) and E122's
// (D: 0x502cf141, its pointer stores from 0x502cf1d3); the rule finds one on each of the 18 unpacked bodies (X)
const PROP_STORE_FOUND = { E143: PROP_STORE_E143, E122: { init: 0x502CF141, objects: 0x61896ED4 } };
// The boot's state words (bootState; D: E133's UI_IN init stores its boot key at 0x500f5e95 and its getter 0x500f45ce
// reads it, E129's stage test 0x50022e30 reads its ready word, which the stage step 0x50022f51 sets at 0x5002302e)
// and the deferred calls' init (deferredCalls; D: E132's boot head calls 0x5004a115 at 0x500002ea, which zeroes the
// words 0x9b800030..0x9b800044 and attaches IRQs 29..34); E122 has neither word (X: no stage test or boot key store of
// the forms; its UI_IN keeps its key state elsewhere, D: 0x50176d9e..)
const BOOT_FOUND = { E133: { key: 0xA2AE718C }, E129: { stage: 0xA2B4D2CC }, E122: { key: null, stage: null } };
const DPC_FOUND = { E132: { init: 0x5004A115, board: { triggers: 0x9B800030, irqs: [29, 30, 31, 32, 33, 34] } } };
// The serial controller's driver (sioDriver; D: E132's IIC write 0x5004ba70 calls the transfer start 0x500506cb, its
// write-read the receive start 0x500509be; the registration 0x50051145 its IIC configuration calls fills 0xa2b19ea8 and
// 0xa2b19ec8, which the interrupt's ends dispatch through 0x50051814; the control 0x500505e1's mode 2 stores the restart
// list at 0xa2b19f28; the channel map word 0xa2b1c84c, set by 0x50052089 at the end of PER_SIO's channel init 0x50052016;
// E143's are E132's places in E143, D: its channel init 0x5005f03f ends in 0x5005f0b2)
const SIO_FOUND = { E132: { tx_start: 0x500506CB, rx_start: 0x500509BE, done: [0xA2B19EA8, 0xA2B19EC8], dispatch: 0x50051814, restart: 0xA2B19F28, channels: 0xA2B1C84C, map_init: 0x50052089 } };
// E143's own facts: its loader's limits, its menus are ListMenu (src/lab/menu.mjs LIST_MENU) with their memories, its
// traits and its dial select (src/lab/menu.mjs dialSelect)
const E143_FACTS = {
  board: { vector_page: 0x60030000, dpc: { triggers: 0x9B880044, irqs: [53, 54, 55, 56, 57, 58] }, dram_size: 384 << 20 },
  res: { font_limit: E143_LOADER.font[1], string_limit: E143_LOADER.string[1] },
  menu: { list_menu: true, tab_memory: 1881, page_memory: 1882, take: 0x510C2A2E, caller: CALLER_FOUND.E143 },
  kernel: { cpus: 4, handlers: HANDLERS_FOUND.E143 }, errlog: { entry: ERRLOG_FOUND.E143 }, scpu: { backup: true },
  display: { change_task: true, change_entry: null, queue_word: 0x600432D4, queue_id: 0x88, task_init: 0x501C2F13, init_2nd: null, frame_wait: 0x60043088, timer_sleep: 0x501C2E94,
    sync: { request: 0x503E4DD5, image_sync: 0x503E50EC, sync_set: 0x50AB43CD, kind: 1, panels: [2] } },
  timer: { reload_less_one: false }, dial: { select: 0x5014B7C7, select_end: 0x1A, table_ptr: 0xA32DAAB0, table0: 0x60223DBC },
  touch_panel: { driver: true }, lens: { mount: true }, iic: { waits: IIC_FOUND.E143 }, touch_api: { open: TP_OPEN_FOUND.E143 }, shooting: { start: 0x50AE1124, end: 0x50AD7E8A, auto_through: 0x50ABD373 },
  func_direct: { run: 0x51068E37, id: { sp: 28 } },
  broker: { init: 0x502A48B6 }, card: { shots_query: SHOTS_FOUND.E143, detect: { table: DETECT_FOUND.E143[0], drives: DETECT_FOUND.E143[1] } },
  boot: { key: 0xA32DAB30, stage: 0xA32DF1F4 }, dpc: { init: 0x50050279 }, sio: SIO_E143, storage: STORAGE_E143, power_off: { usb_disconnect: 0x510617BD }, gui: E143_GUI, recview: RECVIEW_FOUND.E143,
  cbs: CBS_FOUND.E143, mode_dial: MODE_DIAL_FOUND.E143, prop_store: PROP_STORE_FOUND.E143, ctors: CTORS_E143,
};

export function factsTests() {
  const bad = [];
  let checks = 0, models = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  // imageBase on synthetic heads
  const b = new Uint8Array(0x400).fill(0xff);
  ok(throws(() => imageBase(b)), 'imageBase: a head without the jump is refused');
  jump(b, 0xb6, 0x604000f9);
  const r = imageBase(b);
  ok(r.base === 0x60400020 && r.at === 0xb6 && r.target === 0x604000f9, `imageBase: jump at 0xb6 to 0x604000f9 gives ${JSON.stringify(r)}`);
  jump(b, 0x200, 0x600210c5);
  ok(throws(() => imageBase(b)), 'imageBase: two jumps are refused');
  // every model whose main block is unpacked: the rule gives its MODELS image_base
  for (const [code, m] of Object.entries(MODELS)) {
    const file = path.join(REPO, romPath(m));
    if (!fs.existsSync(file)) continue;
    models++;
    let got;
    try { got = imageBase(head(file)).base; } catch (e) { got = e.message; }
    ok(got === m.image_base, `${code}: imageBase 0x${got.toString(16)}, MODELS image_base 0x${m.image_base.toString(16)}`);
  }
  // mergeBoard: one level deep, hand over family, a fact given both ways refused, UNKNOWN reads throw
  const fam = { a: 1, t: { x: 1, y: 2 }, u: UNKNOWN, v: { w: UNKNOWN, z: 3 } };
  const mb = mergeBoard(fam, { a: 5 }, { t: { y: 4 }, u: 6 }, 'test');
  ok(mb.a === 5 && same(mb.t, { x: 1, y: 4 }) && mb.u === 6 && mb.v.z === 3 && throws(() => mb.v.w) && fam.t.y === 2, 'mergeBoard: one-level merge over the family');
  ok(throws(() => mergeBoard(fam, { a: 5 }, { a: 7 }, 'test')) && throws(() => mergeBoard(fam, { t: { x: 0 } }, { t: { x: 9 } }, 'test')), 'mergeBoard: a fact both read and given by hand is refused');
  ok(!throws(() => mergeBoard(fam, { t: { x: 0 } }, { t: { y: 9 } }, 'test')), 'mergeBoard: read and hand fields of one sub-object merge');
  for (const code of Object.keys(MODELS)) {
    let b;
    try { b = boardOf(code); } catch (e) { b = e.message; }
    ok(b?.family === MODELS[code].board?.family, `boardOf(${code}): ${typeof b === 'string' ? b : b.family}`);
  }
  // the rules on every model with both blocks unpacked
  for (const [code, m] of Object.entries(MODELS)) {
    const file = path.join(REPO, romPath(m)), resFile = path.join(REPO, resPath(m));
    if (!fs.existsSync(file) || !fs.existsSync(resFile)) continue;
    const raw = new Uint8Array(fs.readFileSync(file)), img = expandImage(raw, { base: m.image_base, preload: [] });
    // the block's load address, from its index area (src/lab/resources.mjs)
    const resLoad = loadAddress(head(resFile, INDEX_READ));
    let got;
    try { got = readFacts({ img, family: FAMILIES[m.board.family], resLoad }); } catch (e) { got = e.message; }
    // the placed rules at the port's places (E143: its own; a model not ported yet: none), on the run-time image with
    // the preload rows read, as bin/port.mjs runs them (dialStore reads E125's word table there)
    const at = (v) => (code === 'E143' ? v : !PORTS[code] ? null : PORTS[code][v] === undefined ? v : PORTS[code][v]);
    const preload = typeof got === 'object' ? got.board?.preload ?? [] : [];
    const run = preload.length ? expandImage(raw, { base: m.image_base, preload }) : img;
    let placed;
    try { placed = readPlacedFacts({ img: run, at }); } catch (e) { placed = e.message; }
    const facts = code === 'E143' ? E143_FACTS : FACTS[code];
    if (code === 'E143') ok(same(got, facts), `${code}: readFacts ${hx(got)}, its facts ${hx(facts)}`);
    else if (facts) ok(typeof got === 'object' && same({ ...got, ...placed }, facts), `${code}: readFacts and readPlacedFacts ${hx(typeof got === 'object' ? { ...got, ...placed } : got)}, its facts ${hx(facts)}`);
    else ok(typeof got === 'object', `${code} (not ported yet): readFacts ${got}`);
    const bf = BOARD_FOUND[code];
    if (bf) for (const k of Object.keys(bf)) ok(same(got.board?.[k], bf[k]), `${code}: board.${k} read ${hx(got.board?.[k] ?? got)}, found ${hx(bf[k])}`);
    // the vectors' page holds the level slots (src/lab/irq.mjs LEVEL_SLOTS, E143's 0x5000f000) where the port places
    // them, at the body's run-time base
    const slot = at(0x5000F000);
    if (typeof slot === 'number') ok(got.board?.vector_page === ((slot - 0x50000000 + m.image_base) & 0xffff0000) >>> 0, `${code}: board.vector_page ${hx(got.board?.vector_page ?? got)}, the level slot 0 at ${hx(slot)}`);
    const tf = TRAITS_FOUND[code];
    const traits = [got.kernel?.cpus, got.scpu?.backup, got.display?.change_task, got.timer?.reload_less_one ?? null];
    if (tf) ok(same(traits, tf), `${code}: kernel.cpus, scpu.backup, display.change_task, timer.reload_less_one read ${hx(traits)}, found ${hx(tf)}`);
    // the dial select is the map's dial init and stores the map's pointer (where the map places them), or as found
    const df = DIAL_FOUND[code], d = got.dial ?? placed?.dial;
    if (d && (code === 'E143' || PORTS[code])) {
      const a = (v) => (PORTS[code]?.[v] === undefined ? v : PORTS[code][v]);
      ok(d.select === (df?.select ?? a(0x5014B7C7)) && (a(0xA32DAAB0) === null || d.table_ptr === a(0xA32DAAB0)), `${code}: dialSelect ${hx(d)}, A() init ${hx(a(0x5014B7C7))} pointer ${hx(a(0xA32DAAB0))}`);
    }
    // the DISPLAY queue word is the map's DISPLAY_QUEUE, its id as found
    if (code === 'E143' || PORTS[code]) {
      const q = PORTS[code]?.[0x600432D4] ?? 0x600432D4;
      ok(got.display?.queue_word === q, `${code}: display.queue_word ${hx(got.display ?? got)}, A() ${hx(q)}`);
    }
    if (TASK_INIT_FOUND[code]) ok(got.display?.task_init === TASK_INIT_FOUND[code], `${code}: display.task_init ${hx(got.display ?? got)}, found ${hx(TASK_INIT_FOUND[code])}`);
    // the port places E143's display task init at the rule's (bin/port.mjs, how 'queue-init')
    if (got.display?.task_init !== undefined && PORTS[code]) ok(PORTS[code][0x501C2F13] === got.display.task_init, `${code}: A() of the display task init ${hx(PORTS[code][0x501C2F13])}, the rule's ${hx(got.display.task_init)}`);
    if (FACE_COLOUR_FOUND[code]) ok(got.display?.face_colour === FACE_COLOUR_FOUND[code], `${code}: display.face_colour ${hx(got.display ?? got)}, found ${hx(FACE_COLOUR_FOUND[code])}`);
    // the port places E143's face colour setter at the rule's (bin/port.mjs, how 'cpdata-trace')
    if (got.display?.face_colour !== undefined && PORTS[code]) ok(PORTS[code][0x501E061A] === got.display.face_colour, `${code}: A() of the face colour setter ${hx(PORTS[code][0x501E061A])}, the rule's ${hx(got.display.face_colour)}`);
    if (DISPLAY_QUEUE_FOUND[code]) ok(got.display?.queue_id === DISPLAY_QUEUE_FOUND[code], `${code}: display.queue_id ${hx(got.display ?? got)}, found ${hx(DISPLAY_QUEUE_FOUND[code])}`);
    if (FRAME_WAIT_FOUND[code]) ok(got.display?.frame_wait === FRAME_WAIT_FOUND[code], `${code}: display.frame_wait ${hx(got.display ?? got)}, found ${hx(FRAME_WAIT_FOUND[code])}`);
    if (TIMER_SLEEP_FOUND[code]) ok(got.display?.timer_sleep === TIMER_SLEEP_FOUND[code], `${code}: display.timer_sleep ${hx(got.display ?? got)}, found ${hx(TIMER_SLEEP_FOUND[code])}`);
    if (df) ok(d?.table0 === df.table0, `${code}: dial table0 ${hx(d ?? got)}, found ${hx(df.table0)}`);
    const m9 = placed?.app?.module9_readers;
    if (MODULE9_FOUND[code]) ok(same(m9, MODULE9_FOUND[code]), `${code}: app.module9_readers ${hx(m9 ?? placed)}, found ${hx(MODULE9_FOUND[code])}`);
    if (code === 'E143') ok(Array.isArray(m9) && E143_MODULE9_LISTED.every((x) => m9.includes(x)), `E143: app.module9_readers ${hx(m9 ?? placed)} lacks one of its lab lists' ${hx(E143_MODULE9_LISTED)}`);
    const dq = placed?.dispq?.sends;
    if (DISPQ_FOUND[code]) ok(Array.isArray(dq) && DISPQ_FOUND[code].every((x) => dq.includes(x)), `${code}: dispq.sends ${hx(dq ?? placed)} lacks one of ${hx(DISPQ_FOUND[code])}`);
    // the DISPLAY task loop, and the port's place of E143's at the rule's (bin/port.mjs, how 'queue-receive')
    if (LOOP_FOUND[code] && (code === 'E143' || PORTS[code])) ok(placed?.dispq?.loop === LOOP_FOUND[code], `${code}: dispq.loop ${hx(placed?.dispq ?? placed)}, found ${hx(LOOP_FOUND[code])}`);
    if (START_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(placed?.dispq?.start, START_FOUND[code]), `${code}: dispq.start ${hx(placed?.dispq ?? placed)}, found ${hx(START_FOUND[code])}`);
    if (placed?.dispq?.loop !== undefined && PORTS[code]) ok((PORTS[code][0x501C3035] === undefined ? 0x501C3035 : PORTS[code][0x501C3035]) === placed.dispq.loop, `${code}: A() of the DISPLAY loop ${hx(PORTS[code][0x501C3035])}, the rule's ${hx(placed.dispq.loop)}`);
    // the UI_IN task, and the port's place of E143's at the rule's (bin/port.mjs, how 'flag-wait')
    if (UI_IN_FOUND[code] && (code === 'E143' || PORTS[code])) ok(placed?.ui_in?.task === UI_IN_FOUND[code], `${code}: ui_in.task ${hx(placed?.ui_in ?? placed)}, found ${hx(UI_IN_FOUND[code])}`);
    if (placed?.ui_in?.task !== undefined && PORTS[code]) ok((PORTS[code][0x5014B736] === undefined ? 0x5014B736 : PORTS[code][0x5014B736]) === placed.ui_in.task, `${code}: A() of the UI_IN task ${hx(PORTS[code][0x5014B736])}, the rule's ${hx(placed.ui_in.task)}`);
    // UI_IN's forward sites, and where the port places E143's forward, the rule's one site at it
    if (UI_IN_FWD_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(placed?.ui_in?.forward, UI_IN_FWD_FOUND[code]), `${code}: ui_in.forward ${hx(placed?.ui_in ?? placed)}, found ${hx(UI_IN_FWD_FOUND[code])}`);
    const fwd = PORTS[code]?.[0x5014C3EB];
    if (typeof fwd === 'number') ok(same(placed?.ui_in?.forward, [{ at: fwd, reg: 'd0' }]), `${code}: ui_in.forward ${hx(placed?.ui_in ?? placed)}, A() of the forward ${hx(fwd)}`);
    // the DISPLAY loop's replies, and the port's places of E143's at the rule's (bin/port.mjs, how 'reply-pair')
    if (REPLIES_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(placed?.dispq?.replies, REPLIES_FOUND[code]), `${code}: dispq.replies ${hx(placed?.dispq ?? placed)}, found ${hx(REPLIES_FOUND[code])}`);
    if (placed?.dispq?.replies !== undefined && PORTS[code]) ok(same([0x501C4913, 0x501C4974].map((v) => PORTS[code][v]), placed.dispq.replies), `${code}: A() of the DISPLAY replies ${hx([0x501C4913, 0x501C4974].map((v) => PORTS[code][v]))}, the rule's ${hx(placed.dispq.replies)}`);
    // the touch task's start, and the port's places of E143's touch init and id word at the rule's (how 'task-start')
    const tps = placed?.touch_start;
    if (TOUCH_START_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(tps, TOUCH_START_FOUND[code]), `${code}: touch_start ${hx(tps ?? placed)}, found ${hx(TOUCH_START_FOUND[code])}`);
    if (tps !== undefined && PORTS[code]) ok((PORTS[code][0x501E3DCA] ?? 0x501E3DCA) === tps.init && (PORTS[code][0x60042DCC] ?? 0x60042DCC) === tps.id_word, `${code}: A() of the touch init and id word ${hx([PORTS[code][0x501E3DCA], PORTS[code][0x60042DCC]])}, the rule's ${hx(tps)}`);
    // the touch task's queue, and the port's place of E143's touch flag word at the rule's flag (how 'touch-wait')
    const tq = placed?.touch_task;
    if (TOUCH_QUEUE_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(tq, TOUCH_QUEUE_FOUND[code]), `${code}: touch_task ${hx(tq ?? placed)}, found ${hx(TOUCH_QUEUE_FOUND[code])}`);
    if (tq !== undefined && PORTS[code]) ok((PORTS[code][TP_FLAG_E143] ?? TP_FLAG_E143) === tq.flag, `${code}: A() of the touch flag word ${hx(PORTS[code][TP_FLAG_E143])}, the rule's ${hx(tq)}`);
    // the power-off's facts, where the rule reads them
    if (code in POWER_SEQ_FOUND && (code === 'E143' || PORTS[code])) ok(same(placed?.power?.off, POWER_SEQ_FOUND[code]), `${code}: power.off ${hx(placed?.power ?? placed)}, found ${hx(POWER_SEQ_FOUND[code])}`);
    if (LENS_TABLE_FOUND[code] && (code === 'E143' || PORTS[code])) ok(placed?.lens_record?.zoom_table === LENS_TABLE_FOUND[code], `${code}: lens_record ${hx(placed?.lens_record ?? placed)}, found ${LENS_TABLE_FOUND[code]}`);
    // the lens driver, and the port's places of E143's lens flags and LENS_EXEC's queue word (the map's, which S-LENS and
    // the camera application's module queues use) at the rule's
    if (code === 'E143' || PORTS[code]) ok(same(placed?.lens_driver, LENS_DRIVER_FOUND[code]), `${code}: lens_driver ${hx(placed?.lens_driver ?? placed)}, found ${hx(LENS_DRIVER_FOUND[code] ?? 'none')}`);
    const ld = placed?.lens_driver;
    if (ld && PORTS[code]) {
      const a = (v) => (PORTS[code][v] === undefined ? v : PORTS[code][v]), e = LENS_DRIVER_E143;
      const got = [e.flags.valid, e.flags.attach, e.flags.ready, e.exec_queue].map(a), want = [ld.flags.valid, ld.flags.attach, ld.flags.ready, ld.exec_queue];
      ok(same(got, want), `${code}: A() of the lens flags and LENS_EXEC's queue word ${hx(got)}, the rule's ${hx(want)}`);
    }
    if (MODE_DIAL_FOUND[code]) ok(same(got.mode_dial, MODE_DIAL_FOUND[code]), `${code}: mode_dial ${hx(got.mode_dial ?? got)}, found ${hx(MODE_DIAL_FOUND[code])}`);
    ok(typeof got.prop_store?.init === 'number' && (!PROP_STORE_FOUND[code] || same(got.prop_store, PROP_STORE_FOUND[code])), `${code}: prop_store ${hx(got.prop_store ?? got)}, found ${hx(PROP_STORE_FOUND[code] ?? 'one')}`);
    // the constructor tables as found, and where the port places E143's three the lab runs (the memory managers' and
    // modules 6 and 7), the rule's first three; every table ended by 0xFFFFFFFF after its count
    if (CTORS_FOUND[code]) ok(same(got.ctors, CTORS_FOUND[code]), `${code}: ctors ${hx(got.ctors ?? got)}, found ${hx(CTORS_FOUND[code])}`);
    const tables = [0x60714E78, 0x60EF9AD0, 0x615C71D4].map((v) => (code === 'E143' ? v : PORTS[code]?.[v]));
    if (code === 'E143' || (PORTS[code] && got.ctors?.length === 4 && !['E118', 'E122'].includes(code))) ok(same(tables, got.ctors?.slice(0, 3).map(([t]) => t)), `${code}: A() of the constructor tables ${hx(tables)}, the rule's ${hx(got.ctors ?? got)}`);
    for (const [t, n] of got.ctors ?? []) ok(u32(run, t - m.image_base + 4 * n) === 0xFFFFFFFF, `${code}: the constructor table ${hx(t)} is not ended after its ${n} pointers`);
    if (CBS_FOUND[code]) ok(same(got.cbs, CBS_FOUND[code]), `${code}: cbs ${hx(got.cbs ?? got)}, found ${hx(CBS_FOUND[code])}`);
    if (SYNC_FOUND[code]) ok(same(got.display?.sync, SYNC_FOUND[code]), `${code}: display.sync ${hx(got.display ?? got)}, found ${hx(SYNC_FOUND[code])}`);
    ok(got.touch_panel?.driver === !NO_TOUCH_DRIVER.includes(code), `${code}: touch_panel ${hx(got.touch_panel ?? got)}, found ${NO_TOUCH_DRIVER.includes(code) ? 'no driver' : 'a driver'}`);
    ok(got.lens?.mount === !NO_LENS_MOUNT.includes(code), `${code}: lens ${hx(got.lens ?? got)}, found ${NO_LENS_MOUNT.includes(code) ? 'no mount' : 'a mount'}`);
    if (IIC_FOUND[code]) ok(same(got.iic?.waits, IIC_FOUND[code]), `${code}: iic ${hx(got.iic ?? got)}, found ${hx(IIC_FOUND[code])}`);
    const tp = got.touch && [got.touch.i2c_write, got.touch.i2c_read];
    ok(same(tp, TOUCH_FOUND[code]), `${code}: touch ${hx(tp ?? got)}, found ${hx(TOUCH_FOUND[code] ?? 'none')}`);
    const mem = got.menu && [got.menu.tab_memory, got.menu.page_memory];
    ok(same(mem, MEMORY_FOUND[code] ?? [undefined, undefined]), `${code}: menu memories ${hx(mem ?? got)}, found ${hx(MEMORY_FOUND[code] ?? 'none')}`);
    if (SHOOTING_FOUND[code]) ok(same(got.shooting, SHOOTING_FOUND[code]), `${code}: shooting ${hx(got.shooting ?? got)}, found ${hx(SHOOTING_FOUND[code])}`);
    if (Object.hasOwn(DIRECT_FOUND, code)) ok(same(got.func_direct, DIRECT_FOUND[code]), `${code}: func_direct ${hx(got.func_direct ?? got)}, found ${hx(DIRECT_FOUND[code] ?? 'none')}`);
    // the port places E143's function direct start at the rule's (bin/port.mjs, how 'direct-checks')
    if (got.func_direct && PORTS[code]) ok(PORTS[code][0x51068E37] === got.func_direct.run, `${code}: A() of the function direct start ${hx(PORTS[code][0x51068E37])}, the rule's ${hx(got.func_direct.run)}`);
    // the event broker init, and the port's place of E143's at the rule's (bin/port.mjs, how 'broker-slots')
    if (BROKER_FOUND[code]) ok(got.broker?.init === BROKER_FOUND[code], `${code}: broker ${hx(got.broker ?? got)}, found ${hx(BROKER_FOUND[code])}`);
    if (got.broker && PORTS[code]) ok(PORTS[code][0x502A48B6] === got.broker.init, `${code}: A() of the broker init ${hx(PORTS[code][0x502A48B6])}, the rule's ${hx(got.broker.init)}`);
    // the touch panel's open, and the port's place of E143's at the rule's (bin/port.mjs, how 'open-trace')
    if (TP_OPEN_FOUND[code]) ok(got.touch_api?.open === TP_OPEN_FOUND[code], `${code}: touch_api ${hx(got.touch_api ?? got)}, found ${hx(TP_OPEN_FOUND[code])}`);
    if (got.touch_api && PORTS[code]) ok(PORTS[code][0x501E40DA] === got.touch_api.open, `${code}: A() of the touch open ${hx(PORTS[code][0x501E40DA])}, the rule's ${hx(got.touch_api.open)}`);
    // the error log, and the port's place of E143's at the rule's (bin/port.mjs, how 'module-test')
    ok(got.errlog?.entry === ERRLOG_FOUND[code], `${code}: errlog ${hx(got.errlog ?? got)}, found ${hx(ERRLOG_FOUND[code])}`);
    if (got.errlog && PORTS[code]) ok(PORTS[code][0x50047313] === got.errlog.entry, `${code}: A() of errlog ${hx(PORTS[code][0x50047313])}, the rule's ${hx(got.errlog.entry)}`);
    // the remaining-shots query, and the port's place of E143's at the rule's (bin/port.mjs, how 'shots-method')
    ok(got.card?.shots_query === SHOTS_FOUND[code], `${code}: card ${hx(got.card ?? got)}, found ${hx(SHOTS_FOUND[code])}`);
    // the card slots' detect states (cardDetect)
    ok(same([got.card?.detect?.table, got.card?.detect?.drives], DETECT_FOUND[code]), `${code}: card detect ${hx(got.card?.detect)}, found ${hx(DETECT_FOUND[code])}`);
    // the card's file system seams (fileSystem): the fields found by reading each body's code
    const sf = STORAGE_FOUND[code];
    if (sf === null) ok(got.storage === undefined, `${code}: storage ${hx(got.storage)}, found none`);
    else if (sf) ok(Object.keys(sf).every((k) => same(got.storage?.[k], sf[k])), `${code}: storage ${hx(got.storage ?? got)}, found ${hx(sf)}`);
    if (got.card && PORTS[code]) ok(PORTS[code][0x50419164] === got.card.shots_query, `${code}: A() of the shots query ${hx(PORTS[code][0x50419164])}, the rule's ${hx(got.card.shots_query)}`);
    // CPU 0's init task and OlyTaWu, and the port's places of E143's at the rules' (bin/port.mjs, how 'task-table',
    // 'wup-opening')
    if (RTOS_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(placed?.rtos && rt(placed.rtos.init_task, placed.rtos.ta_wu), RTOS_FOUND[code]), `${code}: rtos ${hx(placed?.rtos ?? placed)}, found ${hx(RTOS_FOUND[code])}`);
    if (placed?.rtos && PORTS[code]) {
      const a = [0x5002CCA5, 0x5002C6A7].map((v) => (PORTS[code][v] === undefined ? v : PORTS[code][v]));
      ok(same(a, [placed.rtos.init_task, placed.rtos.ta_wu]), `${code}: A() of the init task and OlyTaWu ${hx(a)}, the rules' ${hx(placed.rtos)}`);
    }
    // the calls of tsnd_dtq: E143's the lab's, and on a port as many as found, among them every place the port gives
    // one of E143's at a call of it
    const ts = placed?.rtos?.tsnd_sites;
    if (TSND_COUNT[code] && (code === 'E143' || PORTS[code])) ok(ts?.length === TSND_COUNT[code] && (code !== 'E143' || same(ts, E143_TSND)), `${code}: rtos.tsnd_sites ${hx(ts ?? placed)}, found ${TSND_COUNT[code]}`);
    if (ts && PORTS[code]) {
      const t = PORTS[code][0x50016578] === undefined ? 0x50016578 : PORTS[code][0x50016578], calls = E143_TSND.map((v) => (PORTS[code][v] === undefined ? v : PORTS[code][v])).filter((v) => v !== null && is7call(img, v, t));
      ok(calls.every((v) => ts.includes(v)), `${code}: rtos.tsnd_sites ${hx(ts)} lacks a call A() gives (${hx(calls)})`);
    }
    // the DB init's flash save return, and the port's place of E143's at the rule's (bin/port.mjs, how 'db-save')
    if (STORE_FOUND[code] && (code === 'E143' || PORTS[code])) ok(placed?.store?.db_save === STORE_FOUND[code], `${code}: store ${hx(placed?.store ?? placed)}, found ${hx(STORE_FOUND[code])}`);
    if (APP_SAVES_COUNT[code] && (code === 'E143' || PORTS[code])) ok(placed?.store?.app_saves?.length === APP_SAVES_COUNT[code] && (APP_SAVES_FOUND[code] ?? []).every((ra) => placed.store.app_saves.includes(ra)), `${code}: app saves ${hx(placed?.store?.app_saves ?? placed)}, found ${APP_SAVES_COUNT[code]} with ${hx(APP_SAVES_FOUND[code] ?? [])}`);
    if (placed?.store?.db_save !== undefined && PORTS[code]) ok(PORTS[code][0x503C5537] === placed.store.db_save, `${code}: A() of the DB init's flash save return ${hx(PORTS[code][0x503C5537])}, the rule's ${hx(placed.store.db_save)}`);
    if (TOUCH_ARGS_FOUND[code] && (code === 'E143' || PORTS[code])) ok(same(placed?.touch_args, TOUCH_ARGS_FOUND[code]), `${code}: touch_args ${hx(placed?.touch_args ?? placed)}, found ${hx(TOUCH_ARGS_FOUND[code])}`);
    if (GUI_FOUND[code]) ok(same(got.gui, GUI_FOUND[code]), `${code}: gui ${hx(got.gui ?? got)}, found ${hx(GUI_FOUND[code])}`);
    if (RECVIEW_FOUND[code]) ok(same(got.recview, RECVIEW_FOUND[code]), `${code}: recview ${hx(got.recview ?? got)}, found ${hx(RECVIEW_FOUND[code])}`);
    for (const [k, v] of Object.entries(BOOT_FOUND[code] ?? {})) ok(got.boot?.[k] === v, `${code}: boot.${k} ${hx(got.boot ?? got)}, found ${hx(v)}`);
    const dpcf = DPC_FOUND[code];
    if (dpcf) ok(got.dpc?.init === dpcf.init && same(got.board?.dpc, dpcf.board), `${code}: dpc ${hx(got.dpc ?? got)} board.dpc ${hx(got.board?.dpc)}, found ${hx(dpcf)}`);
    if (SIO_FOUND[code]) ok(same(got.sio, SIO_FOUND[code]), `${code}: sio ${hx(got.sio ?? got)}, found ${hx(SIO_FOUND[code])}`);
    if (Object.hasOwn(CHANGE_ENTRY_FOUND, code)) ok(got.display?.change_entry === CHANGE_ENTRY_FOUND[code], `${code}: display.change_entry ${hx(got.display?.change_entry)}, found ${hx(CHANGE_ENTRY_FOUND[code])}`);
    if (Object.hasOwn(POWER_OFF_FOUND, code)) ok(got.power_off?.usb_disconnect === POWER_OFF_FOUND[code], `${code}: power_off ${hx(got.power_off ?? got)}, found ${hx(POWER_OFF_FOUND[code] ?? 'none')}`);
    // the play component's wrappers, and every place the port gave one of E143's among them (bin/port.mjs, how
    // 'component-method')
    const wf = WRAPPERS_FOUND[code], pw = placed?.play?.wrappers?.map((w) => w.entry);
    if (wf !== undefined && (code === 'E143' || PORTS[code])) ok(typeof wf === 'number' ? pw?.length === wf : same(pw, wf), `${code}: play.wrappers ${hx(pw ?? placed)}, found ${hx(wf)}`);
    if (pw && PORTS[code]) {
      const off = WRAPPERS_FOUND.E143.map((v) => PORTS[code][v]).filter((t) => t !== null && !pw.includes(t));
      ok(!off.length, `${code}: A() of E143's play component wrappers ${hx(off)}, not among the rule's`);
    }
    if (Object.hasOwn(TAKE_FOUND, code)) ok(got.menu?.take === TAKE_FOUND[code], `${code}: menu.take ${hx(got.menu ?? got)}, found ${hx(TAKE_FOUND[code] ?? 'none')}`);
    if (Object.hasOwn(CALLER_FOUND, code)) ok(got.menu?.caller === CALLER_FOUND[code], `${code}: menu.caller ${hx(got.menu ?? got)}, found ${hx(CALLER_FOUND[code])}`);
    // every body with a take has its caller where its port places E143's (the rule's place)
    if (got.menu?.take !== undefined && PORTS[code]) ok(PORTS[code][0x60368B88] === got.menu.caller, `${code}: A(GUICALLER) ${hx(PORTS[code][0x60368B88])}, the rule's ${hx(got.menu.caller)}`);
    if (Object.hasOwn(HANDLERS_FOUND, code)) ok(got.kernel?.handlers === HANDLERS_FOUND[code], `${code}: kernel.handlers ${hx(got.kernel ?? got)}, found ${hx(HANDLERS_FOUND[code])}`);
    // the frame period words at the port's places of the vtotal functions, and the port's A() of E143's words
    const pf = PERIOD_FOUND[code];
    if (pf && (code === 'E143' || PORTS[code])) {
      ok(same(placed?.frame_period, pf), `${code}: frame_period ${hx(placed?.frame_period ?? placed)}, found ${hx(pf)}`);
      if (PORTS[code]) ok(PORTS[code][0xA32DB47C] === pf.tft && PORTS[code][0xA32DB428] === pf.evf, `${code}: A() of the frame period words ${hx([PORTS[code][0xA32DB47C], PORTS[code][0xA32DB428]])}, the rule's ${hx(pf)}`);
    }
    // the hardware-timer table at the port's place of the init, and the port's A() of E143's pointer word
    const hf = HW_TIMER_FOUND[code];
    if (hf && (code === 'E143' || PORTS[code])) {
      ok(same(placed?.hw_timer, hf), `${code}: hw_timer ${hx(placed?.hw_timer ?? placed)}, found ${hx(hf)}`);
      if (PORTS[code]) ok(PORTS[code][0xA32CA47C] === (hf.ptr ?? null), `${code}: A() of the hardware-timer pointer ${hx(PORTS[code][0xA32CA47C])}, the rule's ${hx(hf)}`);
    }
    const cf = CRT_FOUND[code];
    if (cf && (code === 'E143' || PORTS[code])) {
      ok(placed?.crt?.clock_read === cf, `${code}: crt.clock_read ${hx(placed?.crt ?? placed)}, found ${hx(cf)}`);
      if (PORTS[code]) ok(PORTS[code][0x3FFE134D] === cf, `${code}: A() of the C-runtime clock read ${hx(PORTS[code][0x3FFE134D])}, the rule's ${hx(cf)}`);
    }
    // the frame display mode set at the port's place of the TAKE request, and the port's A() of E143's set
    if (Object.hasOwn(FRAME_MODE_FOUND, code) && (code === 'E143' || PORTS[code])) {
      const fm = FRAME_MODE_FOUND[code];
      ok(placed?.frame_mode?.set === fm, `${code}: frame_mode ${hx(placed?.frame_mode ?? placed)}, found ${hx(fm)}`);
      if (PORTS[code]) ok(PORTS[code][0x500256D9] === fm, `${code}: A() of the frame display mode set ${hx(PORTS[code][0x500256D9])}, the rule's ${hx(fm)}`);
    }
    // the frame plane's uploads, and the port's A() of E143's AF upload at the mode-3 one (null: unplaced)
    if (Object.hasOwn(PLANE_FOUND, code) && (code === 'E143' || PORTS[code])) {
      const fp = PLANE_FOUND[code];
      ok(same(placed?.frame_plane, fp), `${code}: frame_plane ${hx(placed?.frame_plane ?? placed)}, found ${hx(fp)}`);
      if (PORTS[code]) ok(PORTS[code][0x500257CE] === fp.uploads[2], `${code}: A() of the AF upload ${hx(PORTS[code][0x500257CE])}, the rule's ${hx(fp.uploads[2])}`);
    }
    const pd = PROP_DEVICE_FOUND[code];
    if (pd && (code === 'E143' || PORTS[code])) ok(placed?.prop?.device === pd, `${code}: prop.device ${hx(placed?.prop ?? placed)}, found ${pd}`);
    const ec = EVF_CODE_FOUND[code];
    if (ec && (code === 'E143' || PORTS[code])) ok(placed?.prop?.evf_code === ec, `${code}: prop.evf_code ${hx(placed?.prop ?? placed)}, found ${ec}`);
    if (Object.hasOwn(INIT_2ND_FOUND, code)) ok(same(got.display?.init_2nd, INIT_2ND_FOUND[code]), `${code}: display.init_2nd ${hx(got.display ?? got)}, found ${hx(INIT_2ND_FOUND[code])}`);
    const ae = placed?.ae, af = AE_FOUND[code];
    if (af && (code === 'E143' || PORTS[code])) ok(ae && Object.keys(af).every((k) => same(ae[k], af[k])), `${code}: ae ${hx(ae ?? placed)}, found ${hx(af)}`);
    // the port places E143's AE init at the rule's (bin/port.mjs, how 'ae-wrapper')
    if (ae && PORTS[code]) ok(PORTS[code][0x50560B29] === ae.init, `${code}: A() of the AE init ${hx(PORTS[code][0x50560B29])}, the rule's ${hx(ae.init)}`);
    if (LANG_FOUND[code] && (code === 'E143' || PORTS[code])) ok(placed?.text?.lang_setting === LANG_FOUND[code], `${code}: text.lang_setting ${hx(placed?.text ?? placed)}, found ${LANG_FOUND[code]}`);
    let r;
    try { r = resLoader(img, resLoad); } catch (e) { r = e.message; }
    const read = typeof r === 'object' && { font: [r.font.slot, r.font.limit], images: [r.images.first, r.images.last], string: [r.string.slot, r.string.limit] };
    const lf = LOADER_FOUND[code];
    if (lf) for (const k of Object.keys(lf)) lf[k].forEach((v, i) => { if (v !== null) ok(read && read[k][i] === v, `${code}: resLoader ${k}[${i}] ${hx(read ? read[k][i] : r)}, found ${hx(v)}`); });
    // the lab's A() of E143's loader addresses is this model's loader (E143: no PORTS, A() is the identity)
    if (code === 'E143' || PORTS[code]) {
      const a = (v) => (PORTS[code]?.[v] === undefined ? v : PORTS[code][v]);
      const want = [a(E143_LOADER.font[0]), ...E143_LOADER.images.map(a), a(E143_LOADER.string[0])];
      ok(read && same([read.font[0], ...read.images, read.string[0]], want), `${code}: resLoader ${hx(read || r)}, A() ${hx(want)}`);
    }
  }
  // imageView over a small image at a base
  const v = imageView(new Uint8Array([1, 2, 3, 4, 0x41, 0]), 0x60400020, 'test');
  ok(v.u32(0x60400020) === 0x04030201 && v.u16(0x60400022) === 0x0403 && v.cstr(0x60400024) === 'A' && v.has(0x60400025) && !v.has(0x60400026), 'imageView: reads at its base');
  ok(throws(() => v.u32(0x60400024), ImageRangeError) && throws(() => v.u8(0x6040001f), ImageRangeError), 'imageView: a read outside the image is refused');
  return { checks, bad, models };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = factsTests();
  console.log(`facts: ${r.checks - r.bad.length}/${r.checks} (${r.models} unpacked main blocks)`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
