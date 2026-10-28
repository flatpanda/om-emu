// Interactive play mode's session: the firmware tables, CONTROLS, idle_images,
// PlayLab (observers and stand-ins: S-HEAP, S-DISPQ, blocked sends, S-BGDRAW, S-CAFWD, S-TPREG and the touch observers,
// the A15 bracket recorder, S-CPU2) and PlaySession (bring-up, every input: keys, the shutter
// sequence, H-G4SET and H-JSINJECT, switches, the mode dial, dials, touch, the live display switch, the camera
// application (S-CAMAPP, camapp.mjs), idle slices and frames, trim, status, the debug tokens). The Player (queue, lab time, replay) is in
// player.mjs. The mutants (opts.mutant, the Player's --x-mutant: negative controls) sit at the sites they break.
// Addresses are disassembly notation unless marked run-time.
import { A, MODEL, ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, refuseUnmapped, isUnmapped, fact } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import { SCPU_DOORBELL, HDMI_WINDOW, HDMI_DOORBELL } from '../machine.mjs';
import { SET_INPUTS } from '../dev/scpu.mjs';
import { PLUG, EDID, W_EDID_LEN, W_CABLE, W_DDC_READS } from '../dev/hdmi.mjs';
import { sinkEdid } from './edid.mjs';
import { Accelerometer } from './acc.mjs';
import { Storage, STORAGE } from './storage.mjs';
import { imageView } from '../fw/image.mjs';
import { IIC_WAITS_E143, TOUCH_TASK_QUEUE_E143 } from '../fw/facts.mjs';
import * as D from './display.mjs';
import * as IRQ from './irq.mjs';
import * as K from './kernel.mjs';
import * as MM from './menu.mjs';
import * as N from './nav.mjs';
import * as HLE from './hle.mjs';
import { FirmwareError, disasm, runtime, where } from './hle.mjs';
import { ValueError, KeyError, AssertionError, lookup } from './errors.mjs';
import { packRegs } from './sim.mjs';
import { Unported } from '../core/mem.mjs';
import { show } from '../util/show.mjs';
import { decimalInt } from '../util/parse.mjs';
import { pack, unpack, bytesHex } from '../util/bytes.mjs';
import { hex, hexDigits as fx } from '../util/hex.mjs';
import { spacedJson } from '../util/tracejson.mjs';
import { Tally } from '../util/tally.mjs';
import { displayed_windows } from './windows.mjs';
import { SettingsIds } from './settings_ids.mjs';
import * as SC from './scene.mjs';
import { CamApp, CA_MODULE9_READERS } from './camapp.mjs';

// base64.b64encode(bytes).decode()
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(b) {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = b[i] << 16 | (b[i + 1] ?? 0) << 8 | (b[i + 2] ?? 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < b.length ? B64[n >> 6 & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

export const UIIN_VARIANT = A(0xA32DAB38), XLAT = A(0x60E48E60), XLAT_SWITCH = A(0x60E49560), SWITCH_STATE = A(0x50424F9A);
export const EV_NAMES = A(0x60DD3150), MSG_NAMES = A(0x6159A3A4), EV_MAP = MM.EV_MAP;
export const UI_IN = A(0x5014B736), UI_IN_PUSH = A(0x5014CB74), UI_IN_RING_INIT = A(0x5014CB5F);
export const UI_IN_RING = [A(0xA32DAB9C), A(0xA32DABA0), A(0xA32DAB54)], UI_IN_FLAG = A(0x60043010);
// the DISPLAY queue's id word and its static id (src/fw/facts.mjs displayQueue; given by hand before the rule, which
// gives them back: E143 0x88, E146 and E147 0x89, E144 0x8c from the queue name table and 0x60514cb8, D)
export const displayQueue = () => [fact('display.queue_word', 0x600432D4), fact('display.queue_id', 0x88)];
export const UI_IN_POST = A(0x5014C956), UI_IN_FWD = A(0x5014C3EB), UI_IN_SINK = A(0xA32DABA4), UI_IN_POST_EXT = A(0x50025095);
export const UI_IN_DIRECT = new Map([[A(0x5014BC0C), 'dial step'], [A(0x5014E374), 'joystick']]);
export const G4_IMAGE = A(0x629887E4), JS_DIR_CODE = 0x1234, JS_QUERY = A(0x50425355);
// H-G4SET: whether group 4 (E143: HDMI, CEC, lens) goes through the firmware's own group-4 producer G4_SET, read when
// a session is brought up: E143's does (X); a model's MODELS g4set gives its own with its evidence, and a model
// without one is refused there
const g4set = () => fact('g4set', true);
// UI_IN's group 0 (the power lever, the Fn lever, S1, 0x1229 and three of the SCPU's request lines) through the SCPU
// interface's port and event words (src/dev/scpu.mjs, board scpu.events) on a body that gives the firmware's part
// (src/fw/models.mjs scpu_port; docs/hle-gaps.md 4.7.2), null elsewhere: the bring-up attaches IRQ 320 and registers
// UI_IN's callback (H-SCPUIRQ, H-UIINPORT) and a group-0 input sets the ports' levels (H-SCPUPORT), so the IRQ's
// handler, UI_IN's callback, its push and its flag run natively; a body without it pushes group 0 with S-KEYBITS
const scpuPort = () => (BOARD.scpu.events && MODEL_INFO.scpu_port) || null;
export const SCPU_PORT_GROUP = 0;
// H-UIINSCAN: UI_IN's module init (not run) asks the sub-CPU for its port scan, 0x5005d36a at 0x5014bfb2: the request
// 0x88 over the link (retried while the reply's busy byte is set, errlog 0x19002710 after 5000), and the reply's bit 0
// into group 4's switch 0x0400 through the group-4 producer (0x5005d44c -> 0x5014d537), D. The lab runs it in the
// init's place on a body whose sub-CPU link runs and whose UI_IN has the request (fact scpu.port_scan): the sub-CPU
// (S-SCPUDEV) answers from its scan's levels and enables its report, so later changes of the switch come as the
// sub-CPU's message 0x08, which PER_SCPU's poll takes and its handler 0x5005d43e gives the same producer (D)
export const UIIN_PORT_SCAN = A(0x5005D36A);
const uiinScan = () => fact('scpu.port_scan', true);
// The HDMI port (--hdmi on, a body with src/fw/models.mjs hdmi; src/dev/hdmi.mjs, docs/hle-gaps.md 4.9): the machine
// gets the transmitter, the hot-plug pin and the sink, the lab runs H-GIOSLOTS, and the input hdmi plug puts the sink
// (S-HDMISINK, src/lab/edid.mjs) on the port and lets HDMI_PLUG_MS of lab time run, in which the firmware takes the
// pin's interrupt, starts the transmitter, reads and parses the sink's EDID over the DDC and reports the connection to
// UI_IN natively (X: 1.4 ms of lab time on E143). The port's switch 0x0501 is then the firmware's, so the fw_0501
// input is refused
export const HDMI_PLUG_MS = 100, HDMI_SWITCH = 0x0501;
// a tilt input's wait (src/lab/acc.mjs): ACC_MAIN's next 80 ms cycle and PER_SLOPE's 20 ms (X: the gauge's getter
// reads the new tilt at the end of it; the GUI's redraw of the gauge follows up to about 50 ms later)
export const TILT_MS = 250;
// a card input's wait (src/lab/media.mjs S-MEDIA, src/lab/storage.mjs): the card's change runs in the step (the
// insertion's requests take about 0.8 s of lab time, logsec's 740 ms wait after the card switch's change included,
// X), then CARD_MS more for the application's redraw
export const CARD_MS = 300;
export const JS_EV = [369, 370, 371, 372, 373, 374, 375, 376, 377];
export const OLYQEWR = A(0x5002C151), TSND_DTQ = A(0x50016578);
// every call of tsnd_dtq, which the guard on blocked sends observes: E143's 11 (a byte scan, D); a ported model's read by
// a rule at the place of tsnd_dtq (fact rtos.tsnd_sites, src/fw/facts.mjs tsndSites: E145 has 9)
export const TSND_SITES = fact('rtos.tsnd_sites', [0x5002C187, 0x5002C1F1, 0x5002D516, 0x50031662, 0x509B242A, 0x509B2473, 0x5100B7EC,
  0x5100B880, 0x518013FA, 0x5180A529, 0x518919FA]);
export const DISPQ_SEND_RETURN = A(0x503EBA07), DISPQ_REPLY_RETURNS = [A(0x501C4913), A(0x501C4974)], APP_QUEUE = 6;
// S-DISPQ's sends: E143's, the display manager's request (its lab list); a ported model's, every asynchronous DISPLAY
// request of its build too (fact dispq.sends, src/fw/facts.mjs displaySends: E137's cmd 19 after about 5 s of idle)
export const DISPQ_SEND_RETURNS = [DISPQ_SEND_RETURN, ...fact('dispq.sends', [])];
export const TOUCH_INIT = A(0x501E3DCA), TOUCH_TASK = A(0x501E3EAC), TOUCH_TASK_ID = A(0x60042DCC), TP_OPEN = A(0x501E40DA), TP_MASK = A(0x501E41D1);
// S-TPSEND's touch task queue: its flag and queue words and the queue's bit in the flag (src/fw/facts.mjs
// touchQueue, which also places TP_FLAG), none on a build without a touch task
export const TOUCH_QUEUE = isUnmapped(TOUCH_TASK) ? null : fact('touch_task', TOUCH_TASK_QUEUE_E143);
export const HFW_CALLBACK = A(0x50B76E60), TP_MASK_ALL = 0x11F1, TP_MASK_WORD = A(0x62A3EBC0), TP_FLAG = A(0x6004306C), OLYEVST = A(0x5002BD01);
export const HFW_STATUS = [[A(0x50B76FE3), [16, 225]], [A(0x50B7706B), [128, 226]], [A(0x50B770F3), [1, 227]], [A(0x50B7717C), [32, 228]],
  [A(0x50B77205), [256, 229]], [A(0x50B77297), [64, 230]], [A(0x50B77320), [4096, 300]]];
export const TP_SLAVE = 0x70, TP_REG = 0x02;
export const GPIO_TP = [[48, 0x9B880E00], [49, 0x9B880E40], [108, 0x9B883E80]], GPIO_TP_PAGE = 0x9B880000;
export const GESTURES = new Map([[1, 'LIFTOFF'], [16, 'PRESS'], [32, 'CLICK'], [64, 'DCLICK'], [128, 'LONGPRESS'], [256, 'SLIDE'], [4096, 'FLICK']]);
export const BGDRAW = A(0x50B3DCCA), BGDRAW_CALLERS = [A(0x510C9A07), A(0x510C9CF5)];
export const CA_CALL = A(0x51084994), CA_TOUCH_EVENT = 35, CAFWD_CALLERS = [A(0x5124F6AE), A(0x5124F5CC)];
export const B7_GATE = A(0x603710F8), STATE_SHOOTING = 0x0108, SHOOT_PANEL = 10;
export const CONNECT_INDEX = MM.CONNECT_EVENT;
export const LOUTPUT = { tft: 2, evf: 7 }, CONNECT_STATE = { tft: 2, evf: 5 };
export const CTRL_OR = A(0x501E04B7);
export const XCPU_POST_RETURN = A(0x50AA9D55), XCPU_WAIT_RETURN = A(0x50AA9D6E), XCPU_FUNC = A(0x50AAA173);
export const XCPU_REPLY_SITE = A(0x50AAAD56), XCPU_REPLY_FUNC = A(0x50AAAF97);
export const XCPU_SWAP_FLAG = A(0x62EE93E8), XCPU_SRC = A(0x62EE9408), XCPU_DST = A(0xA33DA484), XCPU_N = 28;
export const XCPU_WORD_SRC = A(0xA33DA778), XCPU_WORD_DST = A(0xA33DA49C), XCPU_FLAG = A(0x600430E4), CPU2 = 2;
// H-AEINIT: the AE interpolation's init (bin/port.mjs places it by src/fw/facts.mjs aeInit), the regions its opening
// memsets clear, and whether the interpolation divides by a step table the init fills (fact 'ae'), read when a
// session is brought up; E143's step table, step and base are AE_TABLE, AE_STEP and AE_BASE
export const AE_INIT = A(0x50560B29), AE_REGIONS = [[A(0x62A919DC), 80], [A(0x62A91A2C), 88], [A(0x62A91A84), 16], [A(0x62A91ABA), 104]];
export const AE_STEP = A(0x62A91ABA), AE_BASE = A(0x62A91ABC), AE_TABLE = A(0x62A91ABE);
const aeLayout = () => [fact('ae.regions', AE_REGIONS), fact('ae.table', true)];
export const DIAL_WRITE = A(0x5014BAE6), UIIN_INJECT = A(0x5014C12E), MODE_DIAL_INDEX = A(0xA32DABA8), G4_SET = A(0x5014D537);
// the mode dial's UI_IN code: UI_IN's dispatcher sends it (`cmp 6401,d0` at 0x5014c074) to the dial-index reader
// 0x5014c0de, which loops over its group's entries with `cmp 6401,d2` (D); on each of the 18 bodies the multi-model
// survey read, the dial is one group of 0x1901 entries (X)
export const MODE_DIAL_CODE = 0x1901;
export const SCP_STATES = [0x0401, 0x0403, 0x0404], CONTROL_SETTINGS_ID = 330;
// S-TOUCHMAP: HFW status -> GUI touch kind, by name (I)
export const TOUCHMAP = new Map([[225, [1, 'TOUCH']], [226, [2, 'LONG TOUCH']], [227, [3, 'RELEASE']], [228, [4, 'TAP']],
  [230, [5, 'DOUBLE TAP']], [229, [6, 'SLIDE']], [300, [7, 'FLICK -> 7 (unnamed)']]]);
export const TOUCH_INDEX = 109;
// M10B display switches: the GUI-busy note, H-EYESTATE / H-STOREFIRST addresses
export const GUI_BUSY_NOTE = 'e.g. Level Adjust -> Adjust: 0x5004ad13 sleeps for about 1 s while it takes 12 sensor samples';
export const EYE_SET = A(0x50050EFD), EYE_STATE = { evf: 2, tft: 1 }, EYE_WORD = A(0xA32C1F44), EYE_CALLBACK = A(0xA32C1F48), EYE_TIMER = A(0xA32C1F4C);

// The status line while a frame rests on A15 under the bracket guard.
export function a15_text(verdict) {
  const last = (verdict ?? {}).closed_last ?? null;
  const w = last ? `last ${last[0]}..${last[1]}` : 'none recorded';
  return `A15 assumed: CTRL3 0x41 after ${(verdict ?? {}).pairs ?? 0} closed 0x501e04b7 bracket(s) since the channel's OPEN (${w}); CTRL3 bit 6 meaning unknown`;
}

const h8 = (v) => '0x' + fx(v >>> 0, 8);
// v (a finite number) truncated to an integer and clamped to 0..hi.
const clampInt = (v, hi) => Math.max(0, Math.min(hi, Math.trunc(v)));
const h4 = (v) => '0x' + fx(v >>> 0, 4);

// ---- CONTROLS (the rows the inputs pair with; notes omitted)
const row = (id, name, kind, uiin, gui, more = {}) => ({ id, name, kind, uiin, gui, ...more });
export const CONTROLS = [
  row('s1', 'Shutter half press (S1)', 'key', [0, 0, 2, 0x0100, 2, 0], [4, null, 5]),
  row('s2', 'Shutter full press (S1 + S2)', 'shutter', [1, 0, 1, 0x0101, 2, 0], [6, null, 7]),
  row('rec', 'REC (movie)', 'key', [3, 0, 0, 0x120A, 2, 0], [28, 29, 30]),
  row('menu', 'MENU', 'key', [3, 0, 1, 0x0089, 2, 0], [23, 24, 25]),
  row('info', 'INFO', 'key', [3, 0, 3, 0x1205, 2, 0], [37, null, 38]),
  row('ok', 'OK', 'key', [1, 0, 0, 0x0004, 2, 0], [20, 21, 22]),
  row('up', 'Arrow up', 'key', [3, 3, 2, 0x0005, 2, 0], [8, 9, 10]),
  row('down', 'Arrow down', 'key', [3, 1, 2, 0x0006, 2, 0], [11, 12, 13]),
  row('left', 'Arrow left', 'key', [3, 2, 2, 0x0007, 2, 0], [14, 15, 16]),
  row('right', 'Arrow right', 'key', [3, 0, 2, 0x0008, 2, 0], [17, 18, 19]),
  row('play', 'PLAY', 'key', [3, 1, 3, 0x0087, 2, 0], [26, null, 27]),
  row('delete', 'Delete', 'key', [3, 2, 3, 0x0084, 2, 0], [39, 40, 41]),
  row('js_up', 'Multi-selector up', 'inject', null, [288, 245, 305], { inject: [JS_DIR_CODE, 0, 8], js_ev: 'EV_JOYSTICK_UP_KEY' }),
  row('js_down', 'Multi-selector down', 'inject', null, [289, 246, 307], { inject: [JS_DIR_CODE, 1, 8], js_ev: 'EV_JOYSTICK_DOWN_KEY' }),
  row('js_left', 'Multi-selector left', 'inject', null, [290, 247, 308], { inject: [JS_DIR_CODE, 2, 8], js_ev: 'EV_JOYSTICK_LEFT_KEY' }),
  row('js_right', 'Multi-selector right', 'inject', null, [291, 248, 306], { inject: [JS_DIR_CODE, 3, 8], js_ev: 'EV_JOYSTICK_RIGHT_KEY' }),
  row('js_ul', 'Multi-selector up-left', 'inject', null, [238, 249, 255], { inject: [JS_DIR_CODE, 4, 8], js_ev: 'EV_JOYSTICK_LEFTUP_KEY' }),
  row('js_ur', 'Multi-selector up-right', 'inject', null, [239, 251, 256], { inject: [JS_DIR_CODE, 5, 8], js_ev: 'EV_JOYSTICK_RIGHTUP_KEY' }),
  row('js_dl', 'Multi-selector down-left', 'inject', null, [236, 250, 253], { inject: [JS_DIR_CODE, 6, 8], js_ev: 'EV_JOYSTICK_LEFTDOWN_KEY' }),
  row('js_dr', 'Multi-selector down-right', 'inject', null, [237, 252, 254], { inject: [JS_DIR_CODE, 7, 8], js_ev: 'EV_JOYSTICK_RIGHTDOWN_KEY' }),
  row('js_press', 'Multi-selector press', 'inject', null, [244, null, 257], { inject: [0x1235, 0, 1] }),
  row('main_dial', 'Main dial (EVT_ST_CHANGE_MAIN_DIAL)', 'dial', null, [59, null, null], { dial: [0x02031902, 2] }),
  row('sub_dial', 'Sub dial (EVT_ST_CHANGE_SUB_DIAL)', 'dial', null, [60, null, null], { dial: [0x02031903, 3] }),
  row('mode_dial', 'Mode dial', 'modedial', [2, 0, 0, MODE_DIAL_CODE, 1, 1], [58, null, null]),
  row('lever', 'Fn lever', 'switch', [0, 0, 1, 0x1223, 1, 0], [206, null, null]),
  row('power', 'Power lever', 'power', [0, 0, 0, 0x000C, 1, 0], [null, null, null]),
  row('monitor', 'Monitor open / closed', 'switch', [1, 0, 4, 0x2402, 1, 1], [207, null, null]),
  row('rotate', 'Monitor rotate', 'switch', [1, 0, 5, 0x2401, 1, 1], [65, null, null]),
  row('lv', 'LV / EVF button', 'display', null, [null, null, null]),
  row('eye', 'Eye sensor', 'display', null, [null, null, null]),
];
// The body's Fn-type buttons: UI_IN keys the camera application maps through its button settings (0x5104d084 ->
// 0x5104bd2b, table 0x612c36bc -> getter 0x5104e12d -> 0x5104be42, table 0x612c388c -> 0x5104bc84); the default
// function of each is in its note.
CONTROLS.push(
  row('iso', 'ISO', 'key', [3, 2, 1, 0x1230, 2, 0], [null, null, null]),
  row('exp', 'Exposure compensation (+/-)', 'key', [3, 2, 0, 0x1209, 2, 0], [null, null, null]),
  row('drive', 'Drive / flash', 'key', [3, 3, 0, 0x1231, 2, 0], [null, null, null]),
  row('afmeter', 'AF / metering', 'key', [3, 4, 0, 0x1225, 2, 0], [null, null, null]),
  row('afon', 'AF-ON', 'key', [1, 0, 2, 0x000B, 2, 0], [null, null, null]),
  row('lvkey', '|o| button', 'key', [3, 1, 1, 0x2302, 2, 0], [null, null, null]),
  row('front1', 'Front upper button', 'key', [3, 3, 1, 0x1226, 2, 0], [null, null, null]),
  row('front2', 'Front lower button', 'key', [3, 4, 1, 0x1227, 2, 0], [null, null, null]),
  row('ael', 'AEL/AFL', 'none', null, [null, null, null], { status: 'not-wired',
    reason: "0x120b is only in UI_IN's key matrix variant 1 (boards 1..7 by the board map 0x60224082); the lab's board 0 reads variant 0" }),
  row('bkt', 'BKT', 'none', null, [null, null, null], { status: 'not-wired',
    reason: "the key matrix (0x60224774) has no BKT key; BKT is a function a button can be given (button settings)" }),
);
CONTROLS.push(row('lock', 'Lock lever', 'none', null, [null, null, null], { status: 'not-wired', reason: 'the producer of 0x0202123d/0x0202123e is ?' }));
export const FW_KEYS = [
  [0, 0, 6, 0x1229, 1, 0], [1, 0, 2, 0x000B, 2, 0], [1, 0, 3, 0x2403, 1, 0], [1, 0, 6, 0x200D, 2, 0],
  [1, 0, 7, 0x2007, 1, 1], [1, 1, 0, 0x1506, 1, 0], [1, 1, 1, 0x1518, 1, 0], [1, 1, 2, 0x1712, 1, 0],
  [1, 1, 3, 0x1711, 1, 0], [1, 1, 4, 0x121C, 1, 0], [1, 1, 5, 0x2004, 2, 0], [1, 1, 6, 0x2006, 1, 0],
  [1, 1, 7, 0x2005, 2, 0], [3, 1, 1, 0x2302, 2, 0], [3, 2, 0, 0x1209, 2, 0], [3, 2, 1, 0x1230, 2, 0],
  [3, 3, 0, 0x1231, 2, 0], [3, 3, 1, 0x1226, 2, 0], [3, 4, 0, 0x1225, 2, 0], [3, 4, 1, 0x1227, 2, 0],
  [4, 0, 0, 0x0501, 1, 1], [4, 0, 1, 0x3001, 2, 1], [4, 0, 2, 0x3002, 2, 1], [4, 0, 3, 0x3003, 2, 1],
  [4, 0, 4, 0x3004, 2, 1], [4, 0, 5, 0x3005, 2, 1], [4, 0, 6, 0x3006, 2, 1], [4, 0, 7, 0x3007, 2, 1],
  [4, 1, 0, 0x3008, 2, 1], [4, 1, 1, 0x3009, 2, 1], [4, 1, 2, 0x300A, 1, 1], [4, 1, 3, 0x2202, 2, 1],
  [4, 1, 4, 0x1519, 1, 1], [4, 1, 5, 0x0400, 1, 0], [4, 1, 6, 0x2003, 1, 0],
];
export const FW_GUI = new Map([[0x3001, 118], [0x3002, 114], [0x3003, 115], [0x3004, 116], [0x3005, 117], [0x3006, 111], [0x3007, 113], [0x3008, 112], [0x3009, 110]]);
export const FW_SWITCH_GUI = new Map([[0x2403, 208], [0x1711, 209]]);
export const SWITCH_PICK = new Map([[0x121C, { EV_PRESS_LLPSW: 66, EV_RELEASE_LLPSW: 67 }], [0x0501, { EV_HDMI_CONNECTED: 121, EV_HDMI_DISCONNECTED: 121 }]]);
export const SWITCH_PICK_GUI = new Map([[0x121C, [66, null, 67]], [0x0501, [121, null, null]]]);
export const NO_EV = new Set([0x1229, 0x2007, 0x1506, 0x1518, 0x1712, 0x2006, 0x0400]);
for (const [g, b, bit, code, t, p] of FW_KEYS) {
  if (CONTROLS.some((c) => c.uiin?.[3] === code)) continue;          // a named button above
  const gui = SWITCH_PICK_GUI.get(code) ?? [FW_GUI.get(code) ?? FW_SWITCH_GUI.get(code) ?? null, null, null];
  CONTROLS.push(row(`fw_${fx(code, 4)}`, `raw key 0x${fx(code, 4)}`, t === 2 ? 'fwkey' : 'fwswitch', [g, b, bit, code, t, p], gui, {
    status: gui[0] ? 'wired' : 'decoded',
    reason: gui[0] ? null : NO_EV.has(code) ? 'UI_IN decodes it natively; the code has no EV name (no row in 0x60e48e60 or the switch table), so nothing pairs with it'
      : 'UI_IN decodes it natively; its EV name has no GUI message by the pairing rule and no explicit row is chosen (which GUI input the camera application makes of it is ?)' }));
}
for (const c of CONTROLS) { c.status ??= 'wired'; c.reason ??= null; }
export const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));
export const GROUP_BYTES = [1, 2, 2, 5, 2];
// the groups with entries, the ones bring-up pushes (the firmware skips a group whose list is null: 0x5014cd3d, D)
export const GROUP_LIVE = GROUP_BYTES.map(() => true);
export const UIIN_ENTRIES = new Map();
for (const c of CONTROLS) if (c.uiin && c.uiin[3] !== MODE_DIAL_CODE) UIIN_ENTRIES.set(c.uiin.slice(0, 3).join(','), c.uiin);
export const CODE0_KEYS = [[0, 0, 3], [0, 0, 4], [0, 0, 5]];
export const MONITOR_OPEN = [1, 0, 4];

// Tables: the firmware's EV names, code -> EV translations, switch table, GUI message names (cached per image)
const TABLES = new WeakMap();
export class Tables {
  static of(image) { let t = TABLES.get(image); if (!t) TABLES.set(image, t = new Tables(image)); return t; }
  constructor(image) {
    this.v = imageView(image, IMAGE_BASE, MODEL);
    this.ev = new Map();
    for (let a = EV_NAMES; ; a += 8) {
      const i = this.u32(a), p = this.u32(a + 4);
      if (!this.v.has(p)) break;
      this.ev.set(i, this.cstr(p));
    }
    this.xlat = new Map();
    for (let a = XLAT; this.u32(a); a += 8) if (!this.xlat.has(this.u32(a))) this.xlat.set(this.u32(a), this.u32(a + 4));
    this.switch = new Map();
    for (let a = XLAT_SWITCH; this.u32(a); a += 12) if (!this.switch.has(this.u32(a))) this.switch.set(this.u32(a), [this.u32(a + 4), this.u32(a + 8)]);
    this.msg = new Map();
    for (let i = 0; i < 530; i++) {
      const a = MSG_NAMES + 8 * i;
      try { const k = this.u16(a); if (!this.msg.has(k)) this.msg.set(k, this.cstr(this.u32(a + 4))); } catch (e) { if (!(e instanceof ValueError)) throw e; }
    }
    this.index_msg = new Map();
    for (let i = 1; i < 335; i++) this.index_msg.set(i, this.u16(EV_MAP + 8 * i + 4));
  }
  // reads by run-time address (src/fw/image.mjs: an ImageRangeError, a ValueError, outside the image)
  u16(a) { return this.v.u16(a); }
  u32(a) { return this.v.u32(a); }
  cstr(a) { return this.v.cstr(a); }
  index_name(index) {
    if (index === null || index === undefined) return null;
    const m = this.msg.get(this.index_msg.get(index));
    return m === undefined ? '?' : m;
  }
  // The EV name of a code, or for a switch-table code its two names 'a/b'.
  ev_name(code) {
    const e = this.xlat.get(code);
    if (e !== undefined) return this.ev.get(e) ?? null;
    if (this.switch.has(code)) return this.switch.get(code).map((x) => (this.ev.has(x) ? this.ev.get(x) : '?')).join('/');
    return null;
  }
}

export function set_bit(img, b, bit, v) {
  if (v) img[b] |= 1 << bit;
  else img[b] &= ~(1 << bit) & 0xFF;
}
// the mode dial: its group and its positions [byte, bit, polarity] in entry order (E143: group 2, ten positions at bits
// 0..9, polarity 1; a ported model's are its own, apply_uiin_layout)
export const MODE_DIAL = { group: 2, positions: Array.from({ length: 10 }, (_, k) => [k >> 3, k % 8, 1]) };
// a ported model's other position switches (one code on several bits, one bit at its polarity per position, like
// E147's creative dial 0x1909): [[group, byte, bit, polarity] of the idle position], set in the idle image. The idle
// position is the second: on E147 the first makes S2 ask for the dial to be turned (X); which position is which
// profile is not known
export const SWITCH_IDLE_POSITION = 1;
export const POSITION_SWITCHES = [];
// a ported model's switches the idle image sets by state, not by bit: [code, state], a switch's state 0 being its bit
// at the entry's polarity (UI_IN's reading; H-G4SET's producer sets the bit so for value 0, docs/om1-input-spec.md
// "Group 4"). E143's idle bit 0 gives a body whose polarity differs the other state. The power lever 0x000c on, the
// state E143's idle image gives it: E144 and E137 read their lever at polarity 1, where bit 0 left it off and the
// start was a USB start or, with no cable, a power-off (X, E144). The USB connection 0x0400 with no cable (state 1):
// with state 0 the E144 family's shooting service start publishes the switch's "on" as a module event, which the
// application's module-event broker gives CA_MAIN as event 8 OLY_USB_CONNECTED, and the shooting state's command is
// then PC_START_PC_USB_SELECT: the application ends its shooting service and S1 and S2 release nothing (D, X: E144,
// E139, E137, E142, E140, E125, E130; E134's polarity 1 gave it state 1, and only E134 took S2; the addresses are in
// docs/model-survey.md, E144). Not in the group of the HDMI report 0x0501, which the firmware's group-4 producer
// pushes from its own image (H-G4SET; the HDMI plug's report, a lens or grip input): there the USB connection is the
// SCPU port scan's, reported through that producer (docs/hle-gaps.md 4.7, the 0x88 reply), which does not run, and the
// lab's level would be undone by the producer's next push (X: E146, E147). So the E143 family keeps 0x0400 at state
// 0, as E143's own idle image above does; its starts publish no USB connection (X; what state 0 is there is I)
export const IDLE_SWITCH_STATES = [[0x000C, 0], [0x0400, 1]], PRODUCER_CODE = 0x0501;
export const STATE_SWITCHES = [];             // [[group, byte, bit, level]] of IDLE_SWITCH_STATES, apply_uiin_layout
// the dial group's image at position k: k's bit at its polarity, every other position's at the other value
export function mode_image(k) {
  const img = new Uint8Array(GROUP_BYTES[MODE_DIAL.group]);
  MODE_DIAL.positions.forEach(([b, bit, pol], i) => set_bit(img, b, bit, i === k ? pol : 1 - pol));
  return img;
}
// S-KEYBITS idle image.
export function idle_images() {
  const imgs = GROUP_BYTES.map((n) => new Uint8Array(n));
  for (const [key, [, , , , typ, pol]] of UIIN_ENTRIES) {
    const [g, b, bit] = key.split(',').map(Number);
    if (typ === 2) set_bit(imgs[g], b, bit, 1 - pol);
  }
  for (const [g, b, bit] of CODE0_KEYS) set_bit(imgs[g], b, bit, 1);
  set_bit(imgs[MONITOR_OPEN[0]], MONITOR_OPEN[1], MONITOR_OPEN[2], 1);
  imgs[MODE_DIAL.group].set(mode_image(0));
  for (const [g, b, bit, pol] of POSITION_SWITCHES) set_bit(imgs[g], b, bit, pol);
  for (const [g, b, bit, level] of STATE_SWITCHES) set_bit(imgs[g], b, bit, level);
  return imgs;
}
// The image's UI_IN key matrix (docs/om1-input-spec.md "Groups"): N records of 12 bytes at UIIN_GROUPS, {u32
// variant list, u32 old-state address, u8 bytes, u8 bits per byte, u8 entries, u8}; variant 0's entry table, 8 bytes per
// entry {u32 code, u8 type, u8 polarity, u16}, entry i at byte i / bits, bit i mod bits. N is the firmware's own: its
// group search 0x5014cd0b loads it with `mov 5,d3` (8f 05) at UIIN_COUNT_LOAD (D; the same instruction gives 5 on E144
// and 7 on E147, X). Every record must have the shape {list, old, bytes 1..8, bits 1..8, entries <= bytes * bits, 0},
// with a null list exactly when it has no entries (X: on the survey's 18 bodies). The reads go through the run-time
// image (src/fw/image.mjs): a list in RAM the image does not hold throws instead of reading zeros. {groups: [{bytes,
// bits, entries: [[byte, bit, code, type, polarity]]}]}, empty groups kept.
export const UIIN_GROUPS = A(0x60224774), UIIN_COUNT_LOAD = A(0x5014CD1E);
export function uiin_layout(image) {
  refuseUnmapped(UIIN_COUNT_LOAD, 'UI_IN record count');
  const v = imageView(image, IMAGE_BASE, MODEL), load = runtime(UIIN_COUNT_LOAD);
  if (v.u8(load) !== 0x8F) throw new PlayError(`UI_IN record count: ${h8(UIIN_COUNT_LOAD)} starts with ${fx(v.u8(load), 2)}, not mov imm8,d3 (8f)`);
  const N = v.u8(load + 1), groups = [];
  for (let g = 0; g < N; g++) {
    const rec = UIIN_GROUPS + 12 * g, list = v.u32(rec), bytes = v.u8(rec + 8), bits = v.u8(rec + 9), n = v.u8(rec + 10);
    if (!(bytes >= 1 && bytes <= 8 && bits >= 1 && bits <= 8 && n <= bytes * bits && v.u8(rec + 11) === 0 && (n === 0) === (list === 0))) {
      throw new PlayError(`UI_IN record ${g} of ${N} (${h8(rec)}): list ${h8(list)}, ${bytes} bytes of ${bits} bits, ${n} entries, ${v.u8(rec + 11)}: not a key group`);
    }
    const entries = [];
    if (n) { const table = v.u32(list); for (let i = 0; i < n; i++) entries.push([Math.floor(i / bits), i % bits, v.u32(table + 8 * i), v.u8(table + 8 * i + 4), v.u8(table + 8 * i + 5)]); }
    groups.push({ bytes, bits, entries, old: v.u32(rec + 4) });
  }
  return { groups };
}
// A ported model's key matrix replaces E143's in CONTROLS (by code), GROUP_BYTES, GROUP_LIVE, MODE_DIAL, UIIN_ENTRIES,
// CODE0_KEYS and MONITOR_OPEN; a control whose code the model's tables lack is not wired. The mode dial is the one group
// of several entries that are all MODE_DIAL_CODE. On E143 the image's matrix must be the tables above (an error
// otherwise).
let LAYOUT_APPLIED = false;
export function apply_uiin_layout(image) {
  if (LAYOUT_APPLIED) return;
  const { groups } = uiin_layout(image);
  const at = new Map(), code0 = [];
  let monitor = null;
  groups.forEach(({ entries }, g) => entries.forEach(([b, bit, code, typ, pol]) => {
    if (code === 0) { if (typ === 2) code0.push([g, b, bit]); return; }
    if (code === 0x2402) monitor = [g, b, bit];
    if (code !== MODE_DIAL_CODE && !at.has(code)) at.set(code, [g, b, bit, code, typ, pol]);
  }));
  const dials = groups.flatMap(({ entries }, g) => (entries.length > 1 && entries.every((e) => e[2] === MODE_DIAL_CODE) ? [g] : []));
  if (dials.length !== 1) throw new PlayError(`UI_IN tables: ${dials.length} groups of 0x${fx(MODE_DIAL_CODE, 4)} entries (groups ${dials.join(', ') || 'none'}): no single mode dial`);
  const dial = { group: dials[0], positions: groups[dials[0]].entries.map(([b, bit, , , pol]) => [b, bit, pol]) };
  const live = groups.map((x) => x.entries.length > 0);
  if (ON_LAB_MODEL) {
    const same = groups.length === GROUP_BYTES.length && groups.map((x) => x.bytes).join() === GROUP_BYTES.join() && live.join() === GROUP_LIVE.join() &&
      dial.group === MODE_DIAL.group && dial.positions.join() === MODE_DIAL.positions.join() &&
      code0.join() === CODE0_KEYS.join() && monitor.join() === MONITOR_OPEN.join() &&
      CONTROLS.every((c) => !c.uiin || c.uiin[3] === MODE_DIAL_CODE || c.uiin[3] === 0 || (at.get(c.uiin[3]) ?? []).join() === c.uiin.join());
    if (!same) throw new PlayError('UI_IN tables: the E143 image is not the key matrix of CONTROLS');
    LAYOUT_APPLIED = true;
    return;
  }
  GROUP_BYTES.splice(0, GROUP_BYTES.length, ...groups.map((x) => x.bytes));
  GROUP_LIVE.splice(0, GROUP_LIVE.length, ...live);
  Object.assign(MODE_DIAL, dial);
  const byCode = new Map();
  groups.forEach(({ entries }, g) => entries.forEach(([b, bit, code, typ, pol]) => { if (code && code !== MODE_DIAL_CODE && typ === 1) { if (!byCode.has(code)) byCode.set(code, []); byCode.get(code).push([g, b, bit, pol]); } }));
  POSITION_SWITCHES.splice(0, POSITION_SWITCHES.length, ...[...byCode.values()].filter((l) => l.length > 1).map((l) => l[SWITCH_IDLE_POSITION]));
  const states = new Map(IDLE_SWITCH_STATES);
  STATE_SWITCHES.splice(0, STATE_SWITCHES.length, ...groups.flatMap(({ entries }, g) => (entries.some((e) => e[2] === PRODUCER_CODE) ? [] : entries
    .filter(([, , code, typ]) => typ === 1 && states.has(code)).map(([b, bit, code, , pol]) => [g, b, bit, states.get(code) === 0 ? pol : 1 - pol]))));
  CODE0_KEYS.splice(0, CODE0_KEYS.length, ...code0);
  if (monitor) MONITOR_OPEN.splice(0, 3, ...monitor);
  UIIN_ENTRIES.clear();
  for (const c of CONTROLS) {
    if (!c.uiin) continue;
    if (c.uiin[3] === MODE_DIAL_CODE) { c.uiin = [MODE_DIAL.group, ...groups[MODE_DIAL.group].entries[0]]; continue; }
    const e = at.get(c.uiin[3]);
    if (e) c.uiin = e;
    else { c.status = 'not-wired'; c.reason = `0x${c.uiin[3].toString(16)} is not in ${MODEL}'s UI_IN tables`; c.uiin = null; }
  }
  for (const c of CONTROLS) if (c.uiin && c.uiin[3] !== MODE_DIAL_CODE) UIIN_ENTRIES.set(c.uiin.slice(0, 3).join(','), c.uiin);
  LAYOUT_APPLIED = true;
}
// True when the code at site (disassembly address) is a 7-byte `call d32` (0xdd) of target.
export function is_call_to(image, site, target) {
  const o = site - 0x50000000;
  return image[o] === 0xDD && ((site + (image[o + 1] | image[o + 2] << 8 | image[o + 3] << 16 | image[o + 4] << 24)) >>> 0) === target;
}

export class PlayError extends FirmwareError {}

const bracketState = () => ({ calls: 0, pairs: 0, open: null, bad: null, closed_last: null, last: [] });

// NavLab + the play observers and stand-ins (installed by PlaySession.play_bring_up, not in the constructor).
export class PlayLab extends N.NavLab {
  // H-GUIBYAPP: in a play session the camera application creates the GUI at its start, as on the camera; the lab's
  // bring-up does not (two GUIs, the lab's idle one holding a root of output 0 and one of OSD layer 1's two buffers).
  preinit(opts) { super.preinit(opts); this.gui_by_app = true; }
  play_init(opts) {
    this.opts = opts;
    this.uiin_codes = []; this.uiin_decoded = []; this.gestures = []; this.tp_status = []; this.cafwd = [];
    this.bgdraw = new Tally();
    this.tp_image = new Uint8Array(11);
    this.tp_reads = [];
    this.status_gesture = new Map();
    this.observe(UI_IN_POST, (lab, r) => lab.uiin_decoded.push([lab.step_tag, r.d0]), 'obs-uiin-post');
    this.observe(UI_IN_FWD, (lab, r) => lab.uiin_codes.push([lab.step_tag, r.d0]), 'obs-uiin-fwd');
    this.uiin_direct = new Tally();
    this.observe(UI_IN_POST_EXT, (lab, r) => this._uiin_post_ext(lab, r), 'obs-uiin-post-ext');
    this.heap_sizes = new Map();
    this.heap_free = new Map();
    this.heap_stats = new Tally();
    this.hook(HLE.MALLOC, (h, r) => this._s_malloc(h, r), 'S-HEAP malloc');
    this.hook(HLE.FREE, (h, r) => this._s_free(h, r), 'S-HEAP free');
    // the heap's block get and release of one pool, which code calls without malloc (Level Adjust's sampling loop,
    // MODEL_INFO.heap_pool): from S-HEAP as well, since the pool's memory is S-HEAP's (X: natively the get hands out the
    // pool's first block, which S-HEAP has already given out)
    const pool = MODEL_INFO.heap_pool;
    if (pool) {
      this.hook(pool.get, (h, r) => this._s_malloc(h, { ...r, d0: pool.bytes }, r), 'S-HEAP pool get');
      this.hook(pool.put, (h, r) => this._s_free(h, r), 'S-HEAP pool release');
    }
    if (opts.bgdraw ?? true) this.hook(BGDRAW, (h, r) => this._s_bgdraw(h, r), 'S-BGDRAW');
    // a later model's drivers of peripherals the lab does not have, answered with the value of their success path
    // (MODEL_INFO.return_stubs: [function, d0, name, why])
    for (const [fn, d0, name] of MODEL_INFO.return_stubs ?? []) this.hook(fn, (h, r) => h.finish(r, { d0 }), name);
    // and the calls it steps over (MODEL_INFO.call_skips: [call site, or the fact path that a rule reads it at, name,
    // why])
    for (const [at, name] of MODEL_INFO.call_skips ?? []) this.hook(typeof at === 'string' ? fact(at) : at, (h, r) => h.skip_call(r), name);
    // S-IICWAIT: the IIC bus driver's completion waits (fact 'iic.waits', src/fw/facts.mjs iicWaits) return E_OK at
    // once, as on a bus with no device. The lab has no IIC controller (on the E144 family its block is a stub page,
    // src/fw/board.mjs stub_pages), so the completion callback never runs and the wait, which has no timeout, would
    // hold its task for good: E145's compass init in the camera application's start, whose GUI was then never
    // created (H-GUIBYAPP, X). Nothing is received, so a read's buffer keeps what it held: E145's WHOAMI check fails,
    // the init prints "COMPASS: I2C Error, Failed WHOAMI" and goes on (X). A stand-in for the controller, whose
    // registers and interrupt are not read
    this.iic_answered = 0;
    for (const w of fact('iic.waits', IIC_WAITS_E143)) this.hook(w, (h, r) => { this.iic_answered += 1; h.finish(r, { d0: 0 }); }, 'S-IICWAIT');
    this.dispq = [];
    this.dispq_replies = [];
    this.display_queue = this._queue(D.DISPLAY_QUEUE);
    const [word, want] = displayQueue();             // the static queue table's DISPLAY entry
    if (word !== D.DISPLAY_QUEUE || this.display_queue !== want) throw new PlayError(`DISPLAY queue id (${h8(D.DISPLAY_QUEUE)}) = ${this.display_queue}, not 0x${want.toString(16)} (the display init names the queue of ${h8(word)})`);
    const image = this.image;
    this.dispq_returns = DISPQ_REPLY_RETURNS;
    if (opts.mutant === 'dispq-mid-call') this.dispq_returns = [A(0x501C4913), A(0x501C4971)];   // the second call's return: no reply to queue 6 for status 4
    for (const ra of [...this.dispq_returns, ...DISPQ_SEND_RETURNS]) {
      if (!is_call_to(image, ra - 7, OLYQEWR) && opts.mutant !== 'dispq-mid-call') throw new PlayError(`S-DISPQ: ${h8(ra)} does not follow a 7-byte call of OlyQeWr ${h8(OLYQEWR)}`);   // :892
    }
    if (opts.mutant !== 'no-dispq') {                // :894, without it the queue fills and the guard reports it
      this._qewr_prev = this.hooks.get(runtime(OLYQEWR));
      this.hook(OLYQEWR, (h, r) => this._s_dispq(h, r), 'S-DISPQ');
    }
    this.tsnd_pending = new Map();
    this.tsnd_info = new Map();
    for (const site of TSND_SITES) {
      if (!is_call_to(image, site, TSND_DTQ)) throw new PlayError(`${h8(site)} is not a call of tsnd_dtq ${h8(TSND_DTQ)}`);
      if (this.hooks.has(runtime(site + 7))) throw new PlayError(`${h8(site + 7)} is hooked already (${this.hooks.get(runtime(site + 7))[1]})`);
      this.observe(site + 7, (lab, r) => this._tsnd_return(lab, r), `obs-tsnd-return-${fx(site + 7, 8)}`);
    }
    if (this.hooks.has(runtime(TSND_DTQ))) throw new PlayError(`tsnd_dtq is hooked already (${this.hooks.get(runtime(TSND_DTQ))[1]})`);
    this.observe(TSND_DTQ, (lab, r) => this._tsnd_entry(lab, r), 'obs-tsnd');
  }
  // S-DISPQ
  _s_dispq(hle, r) {
    const q = r.d0 & 0xFFFF, ra = disasm(r.mdr);
    if (q === this.display_queue && DISPQ_SEND_RETURNS.includes(ra) && this.depth === 0) {
      const [p, n] = unpack('<II', this.sim.read(r.a0, 8));
      const msg = this.sim.read(p, n);
      if (n !== 16) throw new PlayError(`S-DISPQ: a ${n}-byte DISPLAY message from ${where(r.mdr)}`);
      const words = unpack('<4I', msg);
      const rec = { step: this.step_tag, cmd: words[2], words: words.map((w) => '0x' + w.toString(16)), replies: [] };
      this.dispq.push(rec);
      const r0 = this.dispq_replies.length;
      this.task_message(D.DISPLAY_LOOP, D.DISPLAY_QUEUE, msg, `S-DISPQ DISPLAY cmd ${words[2]}`);
      rec.replies = this.dispq_replies.slice(r0);
      hle.finish(r, { d0: 0 });
      return;
    }
    if (q === APP_QUEUE && this.dispq_returns.includes(ra) && this.depth > 0) {
      const [p, n] = unpack('<II', this.sim.read(r.a0, 8));
      this.dispq_replies.push({ step: this.step_tag, queue: q, msg: bytesHex(this.sim.read(p, n)), caller: h8(ra) });
      hle.finish(r, { d0: 0 });
      return;
    }
    if (q === this.display_queue) {
      throw new PlayError(`OlyQeWr to the DISPLAY queue from ${where(r.mdr)} (depth ${this.depth}): not the asynchronous request S-DISPQ stands in for`);
    }
    this._qewr_prev[0](hle, r);
  }
  // blocked sends
  _tsnd_entry(lab, r) {
    if (r.a1 !== 0xFFFFFFFF) return;
    const ra = r.mdr;
    if (!TSND_SITES.includes(disasm(ra) - 7)) throw new PlayError(`tsnd_dtq(queue ${r.d0 & 0xFFFF}, timeout -1) from ${where(ra)}: not a known call site`);
    this.tsnd_pending.set(ra, (this.tsnd_pending.get(ra) ?? 0) + 1);
    this.tsnd_info.set(ra, [r.d0 & 0xFFFF, this.step_tag]);
  }
  _tsnd_return(lab, r) {
    if (this.tsnd_pending.get(r.pc)) this.tsnd_pending.set(r.pc, this.tsnd_pending.get(r.pc) - 1);
  }
  blocked_sends() {
    const out = [];
    for (const [ra, n] of this.tsnd_pending) if (n > 0) out.push([this.tsnd_info.get(ra)[0], where(ra), this.tsnd_info.get(ra)[1]]);
    return out;
  }
  _uiin_post_ext(lab, r) {
    const who = UI_IN_DIRECT.get(disasm(r.mdr));
    if (who !== undefined) {
      this.uiin_direct.add(who);
      this.uiin_codes.push([this.step_tag, r.d0]);
    }
  }
  // S-HEAP
  _s_malloc(hle, r, regs = r) {
    const size = Math.max(16, Math.floor((r.d0 + 15) / 16) * 16);   // unbounded: malloc(-1) exhausts the heap
    const free = this.heap_free.get(size);
    let a;
    if (free && free.length) {
      a = free.pop();
      this.heap_stats.add('reused');
    } else {
      a = this.heap;
      if (a + size > HLE.HEAP_END) throw new PlayError(`S-HEAP: heap exhausted (${size} bytes from ${where(r.mdr)})`);
      this.heap += size;
      this.heap_stats.add('new');
    }
    this.heap_sizes.set(a, size);
    hle.finish(regs, { a0: a });
  }
  _s_free(hle, r) {
    const a = r.a0;
    const size = this.heap_sizes.get(a);
    if (size !== undefined) {
      this.heap_sizes.delete(a);
      if (!this.heap_free.has(size)) this.heap_free.set(size, []);
      this.heap_free.get(size).push(a);
      this.heap_stats.add('freed');
    } else if ([...this.heap_free.values()].some((v) => v.includes(a))) {
      throw new PlayError(`S-HEAP: double free of ${h8(a)} from ${where(r.mdr)}`);
    } else {
      this.heap_stats.add(a ? 'free of a block from before play (kept)' : 'free(NULL)');
    }
    hle.finish(r);
  }
  // S-BGDRAW
  _s_bgdraw(hle, r) {
    const ra = disasm(r.mdr);
    if (!BGDRAW_CALLERS.includes(ra)) {
      this.bgdraw.add(`native ${h8(ra)}`);
      this.passthrough(r);
      return;
    }
    this.bgdraw.add(h8(ra));
    hle.finish_calls(r, { d0: 0 });
  }
  // S-CAFWD
  _s_cafwd(hle, r) {
    const [ev, ...params] = unpack('<5I', this.sim.read(r.a1, 20));
    if (ev !== CA_TOUCH_EVENT) { this.passthrough(r); return; }
    if (!CAFWD_CALLERS.includes(disasm(r.mdr))) throw new PlayError(`S-CAFWD: touch forward (event 35) from ${where(r.mdr)}, not a pinned caller`);
    this.cafwd.push({ step: this.step_tag, event: ev, param: params[0], params, caller: h8(disasm(r.mdr)) });
    try { hle.finish(r, { d0: 0 }); } catch (e) { if (!(e instanceof FirmwareError)) throw e; hle.finish_calls(r, { d0: 0 }); }
  }
  // S-TPSEND: a synchronous send to the touch task's queue from a display run runs the touch task's loop for that
  // message on a lab stack, as a DISPLAY send runs the DISPLAY loop: its wait on its flag returns the queue's bit, its
  // receive gets the message with word 0, the reply queue, at 0, so it replies to no one and waits again, which ends
  // the run; the send returns 0. Natively the display task would wait for the reply while the touch task ran; in the
  // lab a display run cannot wait, and the start's display open runs before the touch task starts (H-TPINIT, in the
  // play bring-up). E134's and E130's first EVF open sends cmd 5 after its change task (docs/model-survey.md finding
  // 11). The camera application's synchronous requests to the touch task (E143's cmd 8 through its API sender) are
  // not display runs and stay S-MODACK's (camapp.mjs)
  _sync_send(hle, r) {
    if (TOUCH_QUEUE === null || !this.in_display_run() || (r.d0 & 0xFFFF) !== this._queue(TOUCH_QUEUE.queue)) return super._sync_send(hle, r);
    const saved = { ...r };
    this.kernel.events.push(['send', `queue ${r.d0 & 0xFFFF} cmd ${r.d1}`, `param 0x${r.a0.toString(16)}`, where(r.mdr)]);
    (this.tp_sends ??= []).push([r.d1, h8(disasm(r.mdr))]);
    this.task_message(TOUCH_TASK, TOUCH_QUEUE.queue, pack('<IIII', 0, 0, r.d1, r.a0), `touch cmd ${r.d1}`, undefined,
      { flag: TOUCH_QUEUE.flag, bit: TOUCH_QUEUE.bit });
    if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    hle.finish(saved, { d0: 0 });
  }
  // S-TPREG
  _s_tpreg(hle, r) {
    const n = D.tpLength(this, r, 'read'), slave = r.d0 & 0xFF, reg = r.d1 & 0xFF;
    const data = slave === TP_SLAVE && reg === TP_REG && n <= 11 ? this.tp_image.slice(0, n) : new Uint8Array(n);
    this.sim.write(r.a0, data);
    this.tp_reads.push([slave, reg, n, bytesHex(data), h8(disasm(r.mdr))]);
    this.i2c.push(['R', slave, reg, n]);
    hle.finish(r, { d0: 0 });
  }
  _hfw(lab, r) {
    const a = r.a0, code = this.sim.u32(a), p = this.sim.u32(a + 4);
    const [x, y] = p ? unpack('<HH', this.sim.read(p, 4)) : [null, null];
    this.gestures.push({ step: this.step_tag, code, name: GESTURES.get(code) ?? hex(code), x, y, lab_ns: this.lab_time() });
  }
  _hfw_status(st) {
    return (lab) => {
      lab.tp_status.push([lab.step_tag, st, lab.lab_time()]);
      lab.status_gesture.set(lab.tp_status.length - 1, lab.gestures.length ? lab.gestures[lab.gestures.length - 1] : null);
    };
  }
  // ---- M10B: the A15 bracket recorder, chained behind the B2 observer that already hooks 0x501e04b7
  install_brackets() {
    this.brackets = new Map();
    const prev = this.hooks.get(runtime(CTRL_OR));
    const rec = (hle, r) => {
      const ch = r.d0 & 0xFF, en = r.d1 & 0xFF, t = this.lab_time(), ra = disasm(r.mdr);
      if (!this.brackets.has(ch)) this.brackets.set(ch, this.constructor._bracket_state());
      const b = this.brackets.get(ch);
      b.calls += 1;
      b.last.push([en, t, h8(ra)]);
      if (b.last.length > 16) b.last.shift();
      if (en === 0) {
        if (b.open !== null && b.bad === null) b.bad = `(ch ${ch}, 0) from ${h8(ra)} inside the open bracket from ${b.open[1]}`;
        b.open = [t, h8(ra)];
      } else if (b.open !== null) {
        if (t !== b.open[0] && b.bad === null) b.bad = `bracket ${b.open[1]}..${h8(ra)} spans ${t - b.open[0]} ns of lab time`;
        b.closed_last = [b.open[1], h8(ra)];
        b.open = null;
        b.pairs += 1;
      }
      return prev[0](hle, r);
    };
    this.hooks.set(runtime(CTRL_OR), [rec, prev[1]]);
  }
  open(device) {
    if (this.brackets !== undefined && this.brackets !== null) this.brackets.set(lookup(D.DEVICE, device).channel, this.constructor._bracket_state());
    super.open(device);
  }
  // The bracket guard's verdict for the shown channel: 'closed' (A15 may be assumed), or why not.
  a15_verdict(device) {
    const ch = lookup(D.DEVICE, device).channel;
    const ctrl3 = this.vsc.bank(ch, true).get('CTRL3') ?? null;
    const b = this.brackets?.get(ch) || this.constructor._bracket_state();
    const out = { channel: ch, ctrl3: ctrl3 === null ? null : '0x' + ctrl3.toString(16), calls: b.calls, pairs: b.pairs,
      closed_last: b.closed_last, last: b.last.slice(-4) };
    if (ctrl3 !== 0x41) return { ...out, verdict: 'ctrl3', why: `latched CTRL3 is ${out.ctrl3}, not 0x41` };
    if (b.bad) return { ...out, verdict: 'unpaired', why: b.bad };
    if (b.open !== null) return { ...out, verdict: 'open', why: `(ch ${ch}, 0) from ${b.open[1]} not closed` };
    if (!b.pairs) return { ...out, verdict: 'no-bracket', why: 'CTRL3 0x41 with no bracket recorded since the channel\'s OPEN' };
    return { ...out, verdict: 'closed', why: `${b.pairs} closed bracket(s) since the channel's OPEN` };
  }
  // ---- M10B: S-CPU2
  install_xcpu(image) {
    const intc = this.nk.intc;
    if (intc === null || intc.version() < 2) throw new PlayError('S-CPU2: the interrupt controller window has no +0x808 model');
    const o = XCPU_REPLY_SITE - 0x50000000;
    if (image[o] !== 0xFC || image[o + 1] !== 0xDC || !is_call_to(image, A(0x50AAAD5F), IRQ.IPI_POST) || !is_call_to(image, A(0x50AA9D4E), IRQ.IPI_POST)) {
      throw new PlayError('S-CPU2: the post sites 0x50aa9d4e / 0x50aaad5f or the immediate at 0x50aaad56 are not as read');
    }
    this.xcpu_reply = (image[o + 2] | image[o + 3] << 8 | image[o + 4] << 16 | image[o + 5] << 24) >>> 0;
    if (this.xcpu_reply !== runtime(XCPU_REPLY_FUNC)) throw new PlayError(`S-CPU2: reply immediate ${h8(this.xcpu_reply)}, not run-time ${h8(XCPU_REPLY_FUNC)}`);
    this.xcpu_log = [];
    this.xcpu_waiting = 0;
    this.xcpu_seen = intc.xcpu()[0];
    this.xcpu_served = new Set();                    // banks another stand-in serves (S-CPU3 in camapp mode)
    this.observe(XCPU_POST_RETURN, (lab, r) => this._s_cpu2(lab, r), 'S-CPU2');
    this.ipi_handler_runs = 0;
    this.observe(IRQ.IPI_HANDLER0, (lab) => { lab.ipi_handler_runs += 1; }, 'obs-ipi-handler');
    this.observe(XCPU_WAIT_RETURN, (lab, r) => this._xcpu_wait_return(lab, r), 'obs-xcpu-wait');
  }
  static _bracket_state() { return bracketState(); }
  // (write index *, read index *, ring, bit) of ring [target][core] from the image's table 0x60092cd4 (D).
  ipi_desc(target, core) {
    const b = this.sim.read(IRQ.IPI_DESC + 64 * target + 16 * core, 13);
    return [...unpack('<III', b.subarray(0, 12)), b[12]];
  }
  // S-CPU2: at the return of the GUI's post to CPU 2, serve exactly the allow-listed post as CPU 2's task 0x200e would
  // (ack, drain, command 3, reply through ring [0][2] and bank-0 bit 0x20); anything else is an error.
  _s_cpu2(lab, r) {
    const intc = this.nk.intc;
    this.xcpu_waiting += 1;
    const mut = this.opts.mutant;
    if (mut === 'no-xcpu') return;                  // the doorbell is left unserviced
    const core = this.sim.u32(0x8050);
    const [wp, rp, ring, bit] = this.ipi_desc(CPU2, core);
    const w = this.sim.read(wp, 1)[0], rd = this.sim.read(rp, 1)[0];
    const pend = [0, 1, 2, 3].map((b) => (this.xcpu_served.has(b) ? 0 : intc.ipi_pending(b)));
    const [total, all] = intc.xcpu(this.xcpu_seen), rows = all.filter(([b]) => !this.xcpu_served.has(b));
    this.xcpu_seen = total;
    const entries = [];
    for (let k = rd; k < rd + (((w - rd) % 32) + 32) % 32; k++) entries.push(unpack('<II', this.sim.read(ring + 8 * (k % 32), 8)));
    const desc = `bank pending ${show(pend.map(hex))}, ring [2][${core}] read ${rd} write ${w} entries ${show(entries.map(([a, b]) => [hex(a), hex(b)]))}, ` +
      `xcpu sets ${show(rows.map(([b, v, pc]) => [b, hex(v), hex(pc)]))}, post d0 ${r.d0}, caller ${where(r.pc)}`;
    if (core !== 0 || pend.join() !== [0, 0, bit, 0].join() || entries.length !== 1 || entries[0][0] !== runtime(XCPU_FUNC) || entries[0][1] !== 0 ||
        r.d0 !== 0 || rows.length !== 1 || rows[0][0] !== CPU2 || rows[0][1] !== bit) {
      throw new PlayError(`S-CPU2: not the allow-listed post (0x60acb193, 0) from core 0 with bank-2 bit ${bit}: ${desc}`);
    }
    intc.ipi_request(CPU2, 0, bit);                                       // ack
    this.sim.write(rp, new Uint8Array([w]));                              // drain
    if (this.sim.u32(XCPU_SWAP_FLAG) !== 0) {                             // command 3
      throw new PlayError(`S-CPU2 command 3: (${h8(XCPU_SWAP_FLAG)}) = 0x${this.sim.u32(XCPU_SWAP_FLAG).toString(16)}: the swap path 0x50aaad0e is not modelled`);
    }
    const snap = this.sim.read(XCPU_SRC, XCPU_N);
    this.sim.write(XCPU_DST, snap);
    this.sim.word(XCPU_WORD_DST, this.sim.u32(XCPU_WORD_SRC));
    const rec = { step: this.step_tag, lab_ns: this.lab_time(), func: h8(runtime(XCPU_FUNC)), arg: 0, snapshot: bytesHex(snap),
      word: this.sim.u32(XCPU_WORD_DST), reply: null };
    if (mut !== 'xcpu-no-reply') {                  // :1152, xcpu-no-reply: no reply
      const [wp0, rp0, ring0, bit0] = this.ipi_desc(0, CPU2);            // ring [0][2]: 0x60092cf4
      const w0 = this.sim.read(wp0, 1)[0], r0 = this.sim.read(rp0, 1)[0];
      if ((w0 + 1) % 32 === r0) throw new PlayError('S-CPU2: ring [0][2] is full (0x50035afd would log 0x43006002 and return -1)');
      this.sim.write(ring0 + 8 * w0, pack('<II', this.xcpu_reply, 0));
      this.sim.write(wp0, new Uint8Array([(w0 + 1) % 32]));
      intc.ipi_request(0, bit0);
      rec.reply = { func: h8(this.xcpu_reply), ring: h8(ring0), index: w0, bit: bit0 };
    }
    this.xcpu_log.push(rec);
  }
  _xcpu_wait_return(lab, r) { this.xcpu_waiting = Math.max(0, this.xcpu_waiting - 1); }
  // Stuck-reply detection.
  xcpu_problems() {
    const intc = this.nk.intc;
    if (intc === null || this.xcpu_log === undefined || this.xcpu_log === null) return null;
    const pend = [0, 1, 2, 3].map((b) => intc.ipi_pending(b));
    if (pend.slice(1).some((x) => x)) {
      const [, rows] = intc.xcpu(Math.max(0, this.xcpu_seen - 4));
      return `unserviced inter-CPU doorbell: pending ${show(pend.map(hex))} (banks 1..3 have no CPU; S-CPU2 serves only its allow-listed post), xcpu sets ${show(rows.map(([b, v, pc]) => [b, hex(v), hex(pc)]))}`;
    }
    if (this.xcpu_waiting && !pend[0]) {
      return `the GUI waits for CPU 2's reply (flag (${h8(XCPU_FLAG)}) pattern 1, wait returning to ${h8(XCPU_WAIT_RETURN)}) and no bank-0 bit is pending`;
    }
    return null;
  }
}

// S-SCENE's live-view bank (display.mjs LV_BANKS: 0x0A, the bank check_liveview's M7 runs use)
const SCENE_BANK = 0x0A;
// S-SCENE's frame step for a moving scene: 1/15 s of lab time (player.mjs scene_moved publishes a frame per step)
const SCENE_STEP_NS = 1e9 / 15;

// A time-mode NavSession with play inputs. kw: the keyword arguments (opts, lang, device, start, tag, a15, ...).
export class PlaySession extends N.NavSession {
  static lab_class = PlayLab;
  constructor(env, kw = {}) {
    const opts = { ...(kw.opts ?? {}) };
    const k = { ...kw };
    delete k.opts;
    const hdmi = opts.hdmi ?? 'off';
    if (!['off', 'on'].includes(hdmi)) throw new ValueError(`hdmi ${show(hdmi)}: off or on`);
    if (hdmi === 'on') {
      if (!MODEL_INFO.hdmi) throw new ValueError(`--hdmi on: ${MODEL} has no HDMI port in the lab (src/fw/models.mjs hdmi)`);
      env = { ...env, machine: { ...(env.machine ?? {}), hdmi: true } };
      k.hdmi = true;
    }
    // defaults for the keys kw does not give (a key given as null keeps it)
    const setdefault = (key, v) => { if (!Object.hasOwn(k, key)) k[key] = v; };
    setdefault('time', true);
    setdefault('open_menu', false);
    setdefault('png', 'none');
    if (k.device === 'evf' && opts.mutant !== 'evf-store-after-open') setdefault('store_first', true);
    super(env, k);
    this.opts = opts;
    // S-CAMAPP: the application's own work in a step (a mode change reloads its settings) is ten times the GUI's budget
    this.settle_hooks = 10 * N.STEP_HOOKS;
    this.tables = Tables.of(env.rom);
    apply_uiin_layout(env.rom);                    // the model's key matrix (E143: checked against CONTROLS)
    this.images = idle_images();
    this.scpu_port = scpuPort();
    this.hdmi_port = hdmi === 'on';
    this.hdmi_plugged = false;
    if (opts.mutant === 'monitor-inverted') set_bit(this.images[MONITOR_OPEN[0]], MONITOR_OPEN[1], MONITOR_OPEN[2], 0);   // the monitor reads closed: touches rejected
    this.pressed = new Set();
    this.shutter_held = new Set();
    this.mode_index = 0;
    this.js_held = null; this.js_posted = null;
    this.play_log = [];
    this.notes = [];
    // a model whose touch driver is not modelled (MODEL_INFO.touch === false) or that has none (D.HAS_TOUCH) runs as
    // --touch off
    this.touch_on = (opts.touch ?? 'gui') !== 'off' && MODEL_INFO.touch !== false && D.HAS_TOUCH;
    this.touch_mapped = 0;
    this.gesture_reported = this.status_reported = 0;
    this.exec_trimmed = 0;
    this.step_no = 0;
    this.dispq_total = 0;
    this.a15_mode = opts.a15 ?? 'auto';
    if (!['auto', 'off', 'on'].includes(this.a15_mode)) throw new ValueError(`a15 ${show(this.a15_mode)}: auto, off or on`);
    this.a15_frames = 0;
    this.a15_last = null;
    this.switches = 0;
    this.scene = null;             // S-SCENE, once a scene input turns the live view on
    this.lv = null;                // the live view's attach: { device, address, key }
    this.through_off = false;      // S-THROUGH: the application stopped its through image (the menu)
    this.capture_frame = null; this.recview_hold = false;   // S-RECVIEW: the last capture's frame, held during the rec view
    this.playview_hold = false;    // S-PLAYVIEW: a card image's frame shown
    this.camapp = null;            // S-CAMAPP (camapp.mjs), from the bring-up on
    this.acc = null;               // the accelerometer (acc.mjs) on a body that gives it (models.mjs acc)
    this.storage = null;           // the card and the file system (storage.mjs) on a body that runs them (models.mjs card_fs)
  }
  close() {
    if (this.storage) { const st = this.storage; this.storage = null; st.close(); }
    super.close();
  }
  // Steps are renumbered with a counter that trim() does not cut.
  begin(tag) {
    const i = tag.indexOf('-');
    if (i >= 0 && /^[0-9]+$/.test(tag.slice(0, i))) tag = `${String(this.step_no).padStart(2, '0')}-${tag.slice(i + 1)}`;
    super.begin(tag);
  }
  end(token, kind, indices, hooks, extra = null) {
    if (this.camapp !== null && this.camapp.started) this.camapp.tick();   // S-MODACK replies, a due END_RECVIEW
    const rec = super.end(token, kind, indices, hooks, extra);
    if (this.camapp !== null) rec.camapp = this.camapp.take_log();
    rec.n = this.step_no;
    this.step_no += 1;
    const lab = this.lab;
    if (lab.dispq && lab.dispq.length) {
      rec.dispq = lab.dispq.map((d) => ({ cmd: d.cmd, words: d.words, replies: d.replies.length }));
      this.dispq_total += lab.dispq.length;
      lab.dispq.length = 0;
      lab.dispq_replies.length = 0;
    }
    this.check_sends(`step ${token}`);
    this.check_xcpu(`step ${token}`);
    return rec;
  }
  check_xcpu(w) {
    const p = typeof this.lab.xcpu_problems === 'function' ? this.lab.xcpu_problems() : null;
    if (p) throw new PlayError(`after ${w}: ${p}`);
  }
  check_sends(w) {
    const lab = this.lab;
    if (lab.tsnd_pending === undefined || lab.tsnd_pending === null) return;
    const blocked = lab.blocked_sends();
    if (blocked.length) {
      throw new PlayError(`after ${w}: tsnd_dtq with timeout -1 waits on a full queue: ` +
        blocked.map(([q, ra, st]) => `queue ${q} from ${ra} (since step ${st})`).join('; ') + `; tasks ${show(lab.task_states())}`);
    }
  }
  // ---- bring-up
  enter() {
    super.enter();
    try { this.play_bring_up(); } catch (e) { this.close(); throw e; }
    return this;
  }
  play_bring_up() {
    const lab = this.lab, o = this.opts;
    lab.play_init(o);
    this.begin('play-bring-up');
    const tid = [];
    for (const [t, [e]] of lab.nk.tasks()) if (e === UI_IN) tid.push(t);
    if (tid.length !== 1) throw new PlayError(`UI_IN: static tasks with entry ${h8(UI_IN)}: ${show(tid)}`);
    this.uiin_tid = tid[0];
    const [wp, rp, start] = UI_IN_RING;
    if (lab.sim.u32(wp) || lab.sim.u32(rp)) throw new PlayError(`UI_IN ring pointers already set: ${h8(lab.sim.u32(wp))} ${h8(lab.sim.u32(rp))}`);
    lab.call(UI_IN_RING_INIT, null, null, null, 10);
    if (lab.sim.u32(wp) !== start || lab.sim.u32(rp) !== start) throw new PlayError('H-UIINRING: the ring init did not set the ring pointers');
    lab.lt.allow.add(UI_IN);
    const [rc] = lab.nk.svc('act_tsk', { d0: this.uiin_tid });
    if (rc !== K.E_OK) throw new PlayError(`H-UIIN: act_tsk(${this.uiin_tid}) = ${rc}`);
    this.settle('H-UIIN start');
    if (lab.sim.u32(UIIN_VARIANT) !== 0) throw new PlayError(`UI_IN variant (${h8(UIIN_VARIANT)}) = ${lab.sim.u32(UIIN_VARIANT)}: CONTROLS are variant 0`);
    if (lab.sim.u32(UI_IN_SINK) !== 0) throw new PlayError(`(${h8(UI_IN_SINK)}) = 0x${lab.sim.u32(UI_IN_SINK).toString(16)}: UI_IN would post somewhere`);
    const g4 = lab.sim.read(G4_IMAGE, 2);
    if (g4set() && (g4[0] !== this.images[4][0] || g4[1] !== this.images[4][1])) {
      throw new PlayError(`UI_IN's group-4 image (${h8(G4_IMAGE)}) ${bytesHex(g4)} is not the idle image ${bytesHex(this.images[4])}`);
    }
    if (this.scpu_port) this.scpu_port_bring_up();
    for (let g = 0; g < GROUP_BYTES.length; g++) if (GROUP_LIVE[g] && !(this.scpu_port && g === SCPU_PORT_GROUP)) this.push_group(g);
    if (lab.scpu_link && uiinScan()) this.uiin_scan_bring_up();
    this.idle_codes = lab.uiin_codes.map(([, c]) => c);
    if (this.touch_on) this.touch_bring_up();
    if ((o.us_clock ?? 'lab') === 'lab') lab.sim.write(IRQ.TIMER_DEBUG + IRQ.T_USMODE, pack('<I', 1));
    this.takeover_bring_up();
    this.ipi_bring_up();
    if (o.mutant !== 'no-aeinit') this.aeinit_bring_up();   // without it the interpolation's div fault comes back
    if (MODEL_INFO.acc) this.acc_bring_up();
    if (STORAGE && !globalThis.process?.env?.OM_NO_STORAGE) this.storage_bring_up();
    this.end('play-bring-up', 'bring-up', [], [], { idle_codes: this.idle_codes.map(h8), ...(this.storage && { storage: { ...this.storage.status(), log: this.storage.take_log() } }) });
    // S-CAMAPP: the application starts, creates the GUI (H-GUIBYAPP) and takes it to its screen, on the EVF for an EVF
    // start (S-OUTDISP: its own 131 with lOutput 7); start 'menu' then presses MENU
    this.begin(`${String(this.steps.length).padStart(2, '0')}-S-CAMAPP start`);
    this.camapp = new CamApp(this);
    this.camapp.start();
    lab.gui_adopt();                                 // H-GUIBYAPP
    this.end('S-CAMAPP start', 'camapp', [], [], { camapp: this.camapp.status() });
    if ((o.start ?? 'shooting') === 'menu') { this.key('menu', 'down'); this.key('menu', 'up'); }
  }
  // H-SCPUIRQ: what the SCPU init (not run) does for the event word: the ports at the idle image's levels, their
  // events cleared as the init clears them (127 to the event word), IRQ 320 attached to its handler at the init's level
  // through the firmware's attach (checked as H-IPIINIT's). H-UIINPORT: UI_IN's callback registered through the
  // firmware's registration, as UI_IN's port init (not run) registers it, and group 0's old state set from the port
  // byte by the firmware's own init, which UI_IN's start stage (not run) calls first: group 0 then decodes no code at
  // bring-up. A later registration of another callback is refused (none has the firmware's evidence); PER_SCPU's own
  // callback is registered natively before, at its task's start (H-SCPUSTART, src/lab/scpulink.mjs), and acts on the
  // message port's events (docs/hle-gaps.md 4.7.2)
  scpu_port_bring_up() {
    const lab = this.lab, ev = BOARD.scpu.events, { irq: [handler, level], register, callback, old_state } = this.scpu_port;
    const g0 = uiin_layout(lab.image).groups[SCPU_PORT_GROUP];
    if (g0.bytes !== 1 || g0.bits !== ev.count) throw new PlayError(`H-UIINPORT: UI_IN's group ${SCPU_PORT_GROUP} is ${g0.bytes} bytes of ${g0.bits} bits, not the port byte's ${ev.count} bits`);
    const port = this.images[SCPU_PORT_GROUP][0];
    this.port_levels(port);
    lab.cpu_store(MM.SCPU + ev.pending, (1 << ev.count) - 1);
    const r = lab.call(IRQ.ATTACH_WRAPPER, { d0: ev.irq, d1: level, a0: runtime(handler) }, null, null, 20000);
    const lv = lab.nk.intc.level(ev.irq), table = lab.sim.u32(IRQ.HANDLER_TABLE + 4 * ev.irq);
    if (r.d0 !== 0 || lv !== 1 << level || table !== runtime(handler)) {
      throw new PlayError(`H-SCPUIRQ: attach(${ev.irq}, ${level}, ${h8(handler)}) = ${r.d0}, level register 0x${lv.toString(16)}, handler ${h8(table)}`);
    }
    lab.observe(register, (l, r2) => {
      if (r2.a0 !== runtime(callback)) throw new PlayError(`IRQ ${ev.irq} callback ${h8(disasm(r2.a0))} registered from ${where(r2.mdr)}: only UI_IN's (${h8(callback)}) is modelled`);
    }, 'obs-scpu-callback');
    lab.call(register, { a0: runtime(callback) }, null, null, 20000);
    lab.call(old_state, null, null, null, 2000);
    const old = lab.sim.read(g0.old, 1)[0];
    if (old !== port) throw new PlayError(`H-UIINPORT: group ${SCPU_PORT_GROUP}'s old state (${h8(g0.old)}) is 0x${fx(old, 2)} after ${h8(old_state)}, not the port byte 0x${fx(port, 2)}`);
  }
  // H-UIINSCAN (UIIN_PORT_SCAN): the request natively from the lab task, then a settle; checked: one 0x88 frame, its
  // reply's busy byte 0, no errlog of PER_SCPU's, group 4's image (UI_IN's, through the producer) still the idle image,
  // so no code decoded
  uiin_scan_bring_up() {
    const lab = this.lab, dev = lab.scpu_dev, f0 = dev.frames.length, c0 = lab.uiin_decoded.length, e0 = lab.kernel.errors.length;
    refuseUnmapped(UIIN_PORT_SCAN, 'H-UIINSCAN');
    lab.call(UIIN_PORT_SCAN, null, null, null, 200000);
    this.settle('H-UIINSCAN');
    const frames = dev.frames.slice(f0), g4 = lab.sim.read(G4_IMAGE, 2), decoded = lab.uiin_decoded.slice(c0).map(([, c]) => c);
    const own = lab.kernel.errors.slice(e0).filter(([c]) => (c >>> 16) === 0x1900).map(([c]) => h8(c));
    if (frames.length !== 1 || frames[0].cmd !== '0x88' || frames[0].reply?.slice(6, 8) !== '00' || own.length || decoded.length
      || (g4set() && (g4[0] !== this.images[4][0] || g4[1] !== this.images[4][1]))) {
      throw new PlayError(`H-UIINSCAN: after the port scan ${h8(UIIN_PORT_SCAN)}: frames ${show(frames)}, errlog ${show(own)}, codes decoded ${show(decoded.map(hex))}, group 4 ${bytesHex(g4)} (idle ${bytesHex(this.images[4])}): not one 0x88 answered with the idle image kept`);
    }
    this.uiin_scan = { reply: frames[0].reply, report: dev.scanReport };
  }
  // H-ACCINIT, S-ACCREG, S-ACCSAMPLE and H-SLOPEINIT (acc.mjs): the ACC module init and PER_SLOPE's init natively in
  // the boot's place, before the application starts, since its GUI starts PER_SLOPE for the gauge (startLevel at the
  // application's start, X); the settle runs ACC_MAIN's probe, whose accesses are then checked
  acc_bring_up() {
    this.acc = new Accelerometer(this.lab, MODEL_INFO.acc, this.opts.mutant);
    this.acc.bring_up();
    this.settle('H-ACCINIT');
    const why = this.acc.probe_problem();
    if (why) throw new PlayError(`H-ACCINIT: ${why}`);
    this.acc.prime();
  }
  // H-FILEINIT, H-FILECLBK, S-SDHOST, S-SDCARD, S-FSNAND, S-ALBM and the card's insertion (storage.mjs): the file
  // system's bring-up natively in the boot's place and the card mounted by the firmware's own path, before the
  // application starts, which asks for the card's state at its start
  storage_bring_up() {
    this.storage = new Storage(this, STORAGE);
    this.storage.bring_up();
  }
  // the SCPU interface's port levels (bit k port k), through the lab's doorbell (src/dev/scpu.mjs)
  port_levels(levels) { this.lab.cpu_store(SCPU_DOORBELL, (SET_INPUTS << 24 | levels) >>> 0); }
  takeover_bring_up() {
    const lab = this.lab;
    if (lab.b2_trace === undefined) lab.install_b2_observers();
    lab.install_brackets();
    const before = lab.b2_snapshot();
    lab.call(MM.MODULE_STATE_SET, { d0: MM.TAKEOVER_MODULE, d1: MM.TAKEOVER_STATE }, null, null, 200);
    lab.takeover_log = { before, connect: null, takeover: { module: MM.TAKEOVER_MODULE, state: MM.TAKEOVER_STATE,
      label: 'S-TAKEOVER 0x50ab6299(9, 2) at play bring-up: the value API 70405 writes on the boot take-over path (0x501e6adb); no live switch writes it' } };
  }
  ipi_bring_up() {
    const lab = this.lab;
    const pool = lab.sim.read(IRQ.IPI_POOL, IRQ.IPI_POOL_SIZE);
    if (pool.some((b) => b)) throw new PlayError(`H-IPIINIT: the pool ${h8(IRQ.IPI_POOL)} was written before the init`);
    const r = lab.call(IRQ.IPI_INIT, null, null, null, 20000);
    const lv = lab.nk.intc.level(IRQ.IRQ_IPI);
    if (r.d0 !== 0 || lv !== 1 << 2 || lab.sim.u32(IRQ.HANDLER_TABLE + 4 * IRQ.IRQ_IPI) !== runtime(IRQ.IPI_HANDLER0)) {
      throw new PlayError(`H-IPIINIT: ${h8(IRQ.IPI_INIT)} = ${r.d0}, IRQ 324 bank-0 level 0x${lv.toString(16)}, handler ${h8(lab.sim.u32(IRQ.HANDLER_TABLE + 4 * IRQ.IRQ_IPI))}`);
    }
    lab.install_xcpu(lab.image);
  }
  aeinit_bring_up() {
    const lab = this.lab, [regions, hasTable] = aeLayout();
    for (const [a, n] of regions) if (lab.sim.read(a, n).some((b) => b)) throw new PlayError(`H-AEINIT: ${h8(a)} (${n} bytes) was written before the init`);
    const r = lab.call(AE_INIT, null, null, null, 200000);
    // an interpolation that divides by no table the init fills (facts.mjs aeInit's other form, aeRows' row form) cannot
    // divide by zero: the init runs as the boot runs it, and returns 0
    if (!hasTable) {
      if (r.d0 !== 0) throw new PlayError(`H-AEINIT: ${h8(AE_INIT)} = ${r.d0}`);
      this.aeinit = { step: null, base: null, table: null };
      return;
    }
    const table = unpack('<25H', lab.sim.read(AE_TABLE, 50));
    if (r.d0 !== 0 || table.some((b, i) => i > 0 && b <= table[i - 1])) throw new PlayError(`H-AEINIT: ${h8(AE_INIT)} = ${r.d0}, table ${h8(AE_TABLE)} ${show(table)}`);
    this.aeinit = { step: unpack('<H', lab.sim.read(AE_STEP, 2))[0], base: unpack('<h', lab.sim.read(AE_BASE, 2))[0], table: [table[0], table[table.length - 1]] };
  }
  touch_bring_up() {
    const lab = this.lab;
    const allow = [...D.STUB_PAGES.map((p) => [p, 0x1000]), [GPIO_TP_PAGE, 0x1000]];
    const a = new Uint8Array(12 * allow.length);
    allow.forEach(([p, n], i) => a.set(pack('<III', p, n, 1), 12 * i));
    lab.sim.write(D.STUB + 0x100, a);
    const presets = [...D.STUB_PRESETS, ...GPIO_TP.map(([, addr]) => [addr, 0x10])];
    const pr = new Uint8Array(16 * presets.length);
    presets.forEach(([ad, v], i) => pr.set(pack('<IIII', ad, v, 0, 1), 16 * i));
    lab.sim.write(D.STUB + 0x400, pr);
    lab.hooks.set(runtime(D.TP_I2C_READ), [(h, r) => lab._s_tpreg(h, r), 'S-TPREG']);
    lab.observe(HFW_CALLBACK, (l, r) => lab._hfw(l, r), 'obs-hfw-touch');
    for (const [addr, [, st]] of HFW_STATUS) lab.observe(addr, lab._hfw_status(st), `obs-hfw-${st}`);
    if ((this.opts.touch ?? 'gui') === 'gui' && this.opts.mutant !== 'no-cafwd') lab.hook(CA_CALL, (h, r) => lab._s_cafwd(h, r), 'S-CAFWD');
    lab.step('H-TPINIT touch init 0x501e3dca (boot call from 0x50024ca6) from the lab task', () => lab.call(TOUCH_INIT, null, null, null, 20000));
    const tid = unpack('<h', lab.sim.read(TOUCH_TASK_ID, 2))[0];
    lab.lt.allow.add(TOUCH_TASK);
    const [rc] = lab.nk.svc('act_tsk', { d0: tid });
    if (rc !== K.E_OK) throw new PlayError(`H-TPINIT: act_tsk(${tid}) = ${rc}`);
    this.touch_tid = tid;
    this.settle('H-TPINIT touch task start');
    const r = lab.call(TP_OPEN, { a0: runtime(HFW_CALLBACK), a1: 0 }, null, null, 5000);
    if (r.d0 !== 0) throw new PlayError(`H-TPSTART: TP_OPEN ${h8(TP_OPEN)} = 0x${r.d0.toString(16)}`);
    const mask = lab.alloc(pack('<I', TP_MASK_ALL), 4);
    lab.call(TP_MASK, { a0: mask }, null, null, 5000);
    this.settle('H-TPSTART');
  }
  // ---- primitives
  // Group g's image to UI_IN: S-KEYBITS, or for group 0 on a body with the SCPU's port path H-SCPUPORT (below); returns
  // [codes forwarded, codes decoded].
  push_group(g) {
    if (this.scpu_port && g === SCPU_PORT_GROUP) return this.port_group();
    const lab = this.lab;
    const n0 = lab.uiin_codes.length, d0 = lab.uiin_decoded.length;
    const data = this.images[g].slice();
    const buf = new Uint8Array(data.length + 8);
    buf.set(data);
    const gg = this.opts.mutant !== 'wrong-group' ? g : (g + 1) % GROUP_BYTES.length;   // pushes the next group
    const addr = lab.alloc(buf, 4);
    lab.call(UI_IN_PUSH, { d0: data.length, d1: gg, a0: addr }, null, null, 2000);
    const fb = lab.sim.read(UI_IN_FLAG, 2), flag = fb[0] | fb[1] << 8;
    const [rc] = lab.nk.svc('set_flg', { d0: flag, d1: 1 }, null, 200000);
    if (rc !== K.E_OK) throw new PlayError(`S-KEYBITS: set_flg(${flag}, 1) = ${rc}`);
    this.settle(`UI_IN group ${g}`);
    this.sync_group4();
    return [lab.uiin_codes.slice(n0).map(([, c]) => c), lab.uiin_decoded.slice(d0).map(([, c]) => c)];
  }
  // H-SCPUPORT: group 0's image as the SCPU interface's port levels; the port events raise IRQ 320, which the CPU takes
  // natively at the idle point, and its handler runs UI_IN's callback, which pushes the port byte and sets UI_IN's flag
  port_group() {
    const lab = this.lab;
    const n0 = lab.uiin_codes.length, d0 = lab.uiin_decoded.length;
    this.port_levels(this.images[SCPU_PORT_GROUP][0]);
    this.settle(`UI_IN group ${SCPU_PORT_GROUP} (SCPU port)`);
    const pending = lab.sim.u32(MM.SCPU + BOARD.scpu.events.pending);
    if (pending) throw new PlayError(`H-SCPUPORT: the SCPU's events 0x${fx(pending, 2)} are still pending after the settle: IRQ ${BOARD.scpu.events.irq} was not taken`);
    return [lab.uiin_codes.slice(n0).map(([, c]) => c), lab.uiin_decoded.slice(d0).map(([, c]) => c)];
  }
  sync_group4() {
    if (this.opts.mutant === 'no-g4set' || !g4set()) return;
    const img = this.lab.sim.read(G4_IMAGE, 2);
    this.images[4].set(img);
    for (const c of CONTROLS) {
      if (c.uiin && c.uiin[0] === 4 && c.uiin[4] === 2) {
        const [, b, bit, , , pol] = c.uiin;
        if (((img[b] >> bit) & 1) === pol) this.pressed.add(c.id); else this.pressed.delete(c.id);
      }
    }
  }
  // [null, EV name] of a code UI_IN passes on: the camera application maps its codes itself (S-KEYMAP is gone).
  keymap(code) { return [null, this.tables.ev_name(code)]; }
  gate_open() { return this.lab.sim.u32(B7_GATE) === 0; }
  // ---- inputs (each one step)
  key(cid, action) {
    const c = BY_ID.get(cid);
    if (c === undefined) throw new KeyError(show(cid));
    if (!['down', 'up', 'long'].includes(action)) throw new ValueError(`key ${cid}: action ${show(action)} (down, up, long)`);
    if (c.status === 'not-wired') throw new PlayError(`${c.name}: not wired (${c.reason})`);
    this.begin(`${String(this.steps.length).padStart(2, '0')}-key ${cid} ${action}`);
    const state0 = this.lab.state(), pressed0 = new Set(this.pressed);
    const shooting0 = this.camapp !== null && this.camapp.shooting;   // S-RELSEQ: the shooting service at the press
    let codes = [], decoded = [];
    const posted = [], mapped = [];
    if (action === 'long') {
      throw new ValueError(`key ${cid}: long: hold the key (down, then up later); the camera application decides a long press`);
    } else if (['key', 'shutter', 'fwkey'].includes(c.kind)) {
      const seq = cid === 's1' || cid === 's2' ? this.shutter_seq(cid, action) : [[cid, action]];
      for (const [kid, act] of seq) {
        const k = BY_ID.get(kid);
        const [g, b, bit, code, , pol] = k.uiin;
        if ((act === 'down') === this.pressed.has(kid)) continue;          // already in that state
        let got, dec;
        if (g === 4 && g4set() && this.opts.mutant !== 'no-g4set') [got, dec] = this.g4_set(code, act === 'down' ? 0 : 1);   // H-G4SET (no-g4set: off)
        else {
          set_bit(this.images[g], b, bit, act === 'down' ? pol : 1 - pol);
          if (act === 'down') this.pressed.add(kid); else this.pressed.delete(kid);
          [got, dec] = this.push_group(g);
        }
        codes = codes.concat(got);
        decoded = decoded.concat(dec);
        for (const code_ of got) {
          const [idx] = this.keymap(code_);
          if (idx !== null) { this.event(idx); posted.push(idx); }
        }
      }
    } else if (c.kind === 'inject') {                  // H-JSINJECT
      const [code, v_on, v_off] = c.inject;
      const values = [];
      if (code === JS_DIR_CODE) {
        // one direction at a time: a second direction pressed while one is held goes through the centre (8) first
        if (action === 'down' && this.js_held !== cid) {
          if (this.js_held !== null) { values.push(v_off); this.pressed.delete(this.js_held); }
          values.push(v_on);
          this.js_held = cid;
          this.pressed.add(cid);
        } else if (action === 'up' && this.js_held === cid) {
          values.push(v_off);
          this.js_held = null;
          this.pressed.delete(cid);
        }
      } else if ((action === 'down') !== this.pressed.has(cid)) {
        if (action === 'down') this.pressed.add(cid); else this.pressed.delete(cid);
        values.push(action === 'down' ? v_on : v_off);
      }
      for (const v of values) {
        const got = this.inject(code, v);
        codes = codes.concat(got);
        for (const code_ of got) {
          const [idx, ev] = this.keymap(code_);
          mapped.push({ code: h8(code_), value: v, ev, index: idx });
          if (idx !== null) { this.event(idx); posted.push(idx); }
        }
      }
    } else throw new PlayError(`${c.name}: kind ${c.kind} is not a key`);
    if (this.camapp !== null) {                      // S-MODACK, S-RELSEQ for the shutter stages that went down or up
      this.camapp.pump();
      this.camapp.key(['s1', 's2'].filter((k) => this.pressed.has(k) && !pressed0.has(k)), cid === 'rec' && action === 'down',
        ['s1', 's2'].filter((k) => !this.pressed.has(k) && pressed0.has(k)), shooting0);
    }
    const extra = this.extra(c, action, codes, decoded);
    if (mapped.length) extra.keymap = mapped;
    return this.end(`key ${cid} ${action}`, 'key', posted, [], extra);
  }
  // H-CONNECT: sendEvent(131, lOutput of device), then settle; checked through the B2 observers.
  connect(device) {
    const lab = this.lab;
    const n0 = lab.b2_trace.length, r0 = lab.rpc_log.length;
    const before = lab.b2_snapshot();
    let lout = lookup(LOUTPUT, device);
    const mut = this.opts.mutant;
    if (mut === 'tft-loutput-1' && device === 'tft') lout = 1;    // the TFT sent as lOutput 1
    if (mut !== 'no-connect') this.event(CONNECT_INDEX, lout);     // :1790
    const trace = lab.b2_trace.slice(n0);
    const names = trace.map((t) => t[1]);
    const vt20 = trace.filter((t) => t[1] === 'vt+20 ret').map((t) => t[2]);
    const states = trace.filter((t) => t[1] === 'SetConnectState').map((t) => t[2]);
    const info = { device, loutput: lout, before, after: lab.b2_snapshot(), rpc: lab.rpc_log.length - r0,
      trace: trace.map((t) => [t[1], '0x' + t[2].toString(16), typeof t[3] === 'number' ? '0x' + t[3].toString(16) : t[3]]).slice(0, 24) };
    const problems = [];
    if (!names.includes('ConnectChangePlay')) problems.push('ConnectChangePlay did not run');
    if (vt20.length && vt20[vt20.length - 1] !== 0) problems.push(`ChangeOutline vt+20 returned ${show(vt20)}`);
    if (info.rpc) {
      const rpcs = lab.rpc_log.slice(r0).map((x) => `${x.entry} from ${x.caller}` + (x.origin ? ` (${x.origin})` : ''));
      problems.push(`${info.rpc} RPC request(s) during the 131 (vt+20 returned ${show(vt20)}): ${show(rpcs.slice(0, 6))}`);
    }
    if (!states.length || states[states.length - 1] !== lookup(CONNECT_STATE, device)) problems.push(`SetConnectState ${show(states)}, expected ${lookup(CONNECT_STATE, device)}`);
    if (info.after.connect !== lookup(CONNECT_STATE, device)) problems.push(`connect state ${show(info.after.connect)}, expected ${lookup(CONNECT_STATE, device)}`);
    if (problems.length && mut !== 'no-connect') throw new PlayError(`H-CONNECT 131:${lout} on ${device}: ` + problems.join('; ') + `; trace ${show(info.trace)}`);   // :1811
    info.problems = problems;
    return info;
  }
  // ---- records
  extra(c, action, codes, decoded = []) {
    return { control: c.id, action, uiin: codes.map((x) => ({ code: h8(x), ev: this.tables.ev_name(x) })),
      uiin_decoded: decoded.map(h8) };
  }
  // ---- lab time and frames (H-IDLE)
  // One ELAPSE slice to target (ns) between inputs: the budgets of a WAIT of that length, no step record.
  idle_slice(target) {
    const lab = this.lab;
    const now = lab.lab_time();
    if (target <= now) return [];
    const ms = Math.ceil((target - now) / 1000000);
    lab.step_tag = 'idle';
    lab.step_sets = 0;
    lab.step_storm = N.STORM + Math.ceil(ms * N.WAIT_STORM_PER_MS);
    lab.set_callers = new Tally();
    this.marks = { log: lab.log.length, events: lab.events.length };
    let out;
    try {
      out = lab.lt.elapse_until(target, () => lab.lab_time(), (t) => lab.run_to_event(t), (this.settle_hooks ?? N.STEP_HOOKS) + ms * N.WAIT_HOOKS_PER_MS);
    } catch (e) {
      if (e instanceof FirmwareError) throw new N.NavError(`idle slice to ${target} ns: ${e.message.slice(0, 600)}\n` + this.diagnose());
      throw e;
    }
    if (this.camapp !== null && this.camapp.started) this.camapp.tick();
    this.check_sends(`an idle slice to ${target} ns`);
    this.check_xcpu(`an idle slice to ${target} ns`);
    return out;
  }
  // The lab time (ns) of the shown device's next frame boundary, or null when its channel does not run.
  next_boundary() {
    const ch = this.lab.vsc.channel(lookup(D.DEVICE, this.device).channel);
    if (!ch.running) return null;
    return ch.frame_start + ch.length * ch.line_ns;
  }
  to_boundary() {
    const nb = this.next_boundary();
    if (nb !== null && nb > this.lab.lab_time()) this.idle_slice(nb);
  }
  // Composite of the shown device: [width, height, words or raw bytes] or raises.
  frame(policy = 'boundary', raw = false) {
    let dev = this.device;
    if (this.opts.mutant === 'wrong-channel') dev = dev === 'tft' ? 'evf' : 'tft';   // composes the other channel
    let a15, comp;
    if (policy === 'boundary') {
      this.to_boundary();
      this.scene_frame();
      a15 = this.a15_apply(dev);
      comp = this.lab.compose(dev, false, raw);
    } else {
      this.scene_frame();
      a15 = this.a15_apply(dev);
      comp = this.lab.compose(dev, true, raw);
    }
    const assumed = !!((comp.header.assumed ?? 0) & 1);
    this.a15_last = { ...a15, assumed, status: comp.status };
    this.last_planes = { device: dev, planes: comp.planes };
    if (assumed) { this.a15_frames += 1; this.lab.assumptions_in_use.add('A15'); }
    const bad = comp.errors.filter((e) => e.name !== 'PAL_UNWRITTEN').map(D.format_vsc_error);
    if (comp.status !== 'NONE' || bad.length) throw new PlayError(`composite ${comp.status}: ${show(bad.slice(0, 3))}`);
    const h = comp.header;
    return [h.width, h.height, comp[raw ? 'raw' : 'words']];
  }
  a15_apply(dev) {
    const lab = this.lab, ch = lookup(D.DEVICE, dev).channel;
    if (this.a15_mode === 'on') return { mode: 'on', verdict: 'assumed (--a15 on)' };
    const v = this.a15_mode === 'auto' ? lab.a15_verdict(dev) : { verdict: 'off' };
    const on = this.a15_mode === 'auto' && (v.verdict === 'closed' || this.opts.mutant === 'a15-no-guard');   // a15-no-guard: an open bracket assumed closed
    lab.vsc.set_assume(ch, (lab.vsc.assumed(ch) & ~1) | (on ? 1 : 0));
    return { ...v, mode: this.a15_mode, applied: on };
  }
  // ---- inputs beyond keys (each one step)
  // H-G4SET: a group-4 input through the firmware's own producer 0x5014d537(code, value) (value 0: the entry's bit at
  // its polarity, 1: the other level); returns [codes forwarded, codes decoded].
  g4_set(code, value) {
    const lab = this.lab;
    const n0 = lab.uiin_codes.length, d0 = lab.uiin_decoded.length;
    const r = lab.call(G4_SET, { d0: code, d1: value }, null, null, 200000);
    if (r.d0 & 0xFFFF) throw new PlayError(`H-G4SET: ${h8(G4_SET)}(0x${fx(code, 4)}, ${value}) = ${r.d0 & 0xFFFF} (not a group-4 code)`);
    this.settle(`UI_IN group 4 0x${fx(code, 4)} = ${value}`);
    this.sync_group4();
    return [lab.uiin_codes.slice(n0).map(([, c]) => c), lab.uiin_decoded.slice(d0).map(([, c]) => c)];
  }
  // H-JSINJECT: UI_IN's code entry 0x5014c12e(code, value) from the lab task, then settle; returns the codes passed on.
  inject(code, value) {
    const lab = this.lab;
    const n0 = lab.uiin_codes.length;
    lab.call(UIIN_INJECT, { d0: code, d1: value }, null, null, 200000);
    this.settle(`UI_IN code 0x${fx(code, 4)} value ${value}`);
    return lab.uiin_codes.slice(n0).map(([, c]) => c);
  }
  // NavSession's SET with play's hook budget (SET_HOOKS: the native setter of an id the setting rules evaluate reads up
  // to ~370 properties); POST_HOOKS is raised for the call (NavSession.post_hooks).
  set(sid, value, tag = null) {
    const saved = this._post_hooks;
    this._post_hooks = PlaySession.SET_HOOKS;
    try { return super.set(sid, value, tag); } finally { this._post_hooks = saved; }
  }
  post_touch(kind, x, y) {
    const lab = this.lab;
    lab.harvest();
    const msg = lab.alloc(pack('<8I', TOUCH_INDEX, 0, kind, x, y, 0, 0, 0), 4);
    lab.posting = true;
    try { lab.calls(MM.SEND_EVENT, { a0: 0, a1: msg }, undefined, undefined, this.post_hooks()); } finally { lab.posting = false; }
    this.settle(`touch kind ${kind}`);
  }
  // The shutter button stands at the furthest stage a held key asks for (s1 half, s2 full); its bits change in the
  // button's order, S1 before S2 on the way down, S2 before S1 on the way up.
  shutter_seq(cid, action) {
    if (action === 'down') this.shutter_held.add(cid); else this.shutter_held.delete(cid);
    const want = { s1: this.shutter_held.size > 0, s2: this.shutter_held.has('s2') };
    return [...['s1', 's2'].filter((k) => want[k] && !this.pressed.has(k)).map((k) => [k, 'down']),
      ...['s2', 's1'].filter((k) => !want[k] && this.pressed.has(k)).map((k) => [k, 'up'])];
  }
  // Fn lever, monitor, rotate, power, fw switches (value 0 or 1 = the bit), mode dial (value = a position, from 0).
  switch_input(cid, value) {
    const c = BY_ID.get(cid);
    if (c === undefined) throw new KeyError(show(cid));
    if (c.status === 'not-wired') throw new PlayError(`${c.name}: not wired (${c.reason})`);
    if (!['switch', 'fwswitch', 'modedial', 'power'].includes(c.kind)) {
      throw new ValueError(`${c.name}: not a switch (kind ${c.kind}); keys take {type: key}, dials {type: dial}, LV and the eye sensor {type: key}`);
    }
    const positions = MODE_DIAL.positions.length;
    if (c.kind === 'modedial' && !(value >= 0 && value < positions)) throw new ValueError(`mode dial position ${value}: 0..${positions - 1}`);
    if (c.kind !== 'modedial' && value !== 0 && value !== 1) throw new ValueError(`${c.name}: value ${show(value).slice(0, 40)} is not 0 or 1`);
    if (this.hdmi_port && c.uiin[3] === HDMI_SWITCH) throw new ValueError(`${c.name}: with --hdmi on the HDMI switch is the firmware's own (input hdmi)`);
    this.begin(`${String(this.steps.length).padStart(2, '0')}-switch ${cid} ${value}`);
    const state0 = this.lab.state();
    const [g, b, bit, code, , pol] = c.uiin;
    const viaG4 = g === 4 && g4set() && this.opts.mutant !== 'no-g4set';
    if (c.kind === 'modedial') { this.images[MODE_DIAL.group].set(mode_image(value)); this.mode_index = value; }
    else if (!viaG4) set_bit(this.images[g], b, bit, value);
    const [codes, decoded] = viaG4 ? this.g4_set(code, value === pol ? 0 : 1) : this.push_group(g);   // H-G4SET: 0 = bit at its polarity
    const posted = [];
    for (const code_ of codes) {
      const [idx] = this.keymap(code_);
      if (idx !== null) { this.event(idx); posted.push(idx); }
    }
    const extra = this.extra(c, value, codes, decoded);
    if (c.kind === 'modedial') extra.mode_dial_index = this.lab.sim.u32(MODE_DIAL_INDEX);
    return this.end(`switch ${cid} ${value}`, 'switch', posted, [], extra);
  }
  // The HDMI cable (see HDMI_PLUG_MS): plug only. An unplug is refused (A-HDMI-1: what the transmitter and the pin
  // show when the cable comes out is not read), and so is a second plug.
  hdmi_input(action) {
    if (!this.hdmi_port) throw new ValueError('hdmi: the session has no HDMI port (--hdmi on)');
    if (action === 'unplug') throw new ValueError('hdmi unplug: not modelled (A-HDMI-1: what the transmitter and the hot-plug pin show when the cable comes out is not read)');
    if (action !== 'plug') throw new ValueError(`hdmi: action ${show(action)} (plug)`);
    if (this.hdmi_plugged) throw new ValueError('hdmi plug: the cable is in already');
    const lab = this.lab, tag = 'hdmi plug', edid = sinkEdid();
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    lab.sim.write(HDMI_WINDOW + EDID, edid);
    lab.sim.write(HDMI_WINDOW + W_EDID_LEN, pack('<I', edid.length));
    const c0 = lab.uiin_codes.length;
    lab.cpu_store(HDMI_DOORBELL, (PLUG << 24) >>> 0);
    this.hdmi_plugged = true;
    return this.wait_until(lab.lab_time() + HDMI_PLUG_MS * 1000000, tag, true,
      { kind: 'hdmi', extra: () => ({ hdmi: this.hdmi_status(), uiin_codes: lab.uiin_codes.slice(c0).map(([, x]) => h8(x)) }) });
  }
  // The camera's tilt (acc.mjs): roll and pitch in degrees, level (0, 0) at the start. ACC_MAIN takes the new sample at
  // its next cycle; the step waits TILT_MS of lab time and records the sample and what the gauge's getter reads then
  tilt_input(roll, pitch) {
    if (this.acc === null) throw new ValueError(`tilt: ${MODEL} has no accelerometer in the lab (src/fw/models.mjs acc)`);
    this.acc.set(roll, pitch);
    const lab = this.lab, tag = `tilt ${roll} ${pitch}`;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    return this.wait_until(lab.lab_time() + TILT_MS * 1000000, tag, true, { kind: 'tilt', extra: () => ({ acc: this.acc.status(), gauge: this.acc.gauge() }) });
  }
  // The card in the first slot (a body with the file system native and its HLS side, src/fw/models.mjs card_fs.hls):
  // 'remove' takes it out (S-SDCARD's card answers no command), 'insert' puts the same card back. The slot's card
  // switch changes as a body's does (S-KEYBITS' bit of UI_IN's group, which UI_IN decodes natively and the file
  // layer's callback takes), and S-MEDIA (media.mjs) runs the media manager's part of the change in the step; then
  // CARD_MS of lab time
  card_input(action) {
    const st = this.storage, media = this.camapp?.media ?? null;
    if (!st || !media) throw new ValueError(`card: ${MODEL} has no card in the lab with its file system and its HLS media side (src/fw/models.mjs card_fs)`);
    if (action !== 'remove' && action !== 'insert') throw new ValueError(`card: action ${show(action)} (remove, insert)`);
    if ((action === 'remove') !== st.card.present) throw new ValueError(`card ${action}: the card is ${st.card.present ? 'in' : 'out of'} the slot already`);
    if (media.busy()) throw new ValueError(`card ${action}: the media layer is busy (a format or a card change runs)`);
    const sw = media.f.slots[0].switch, c = CONTROLS.find((x) => x.kind === 'fwswitch' && x.uiin[3] === sw);
    if (!c) throw new ValueError(`card: no UI_IN switch control for the card switch 0x${fx(sw, 4)}`);
    const lab = this.lab, tag = `card ${action}`, [g, b, bit, , , pol] = c.uiin;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    if (action === 'remove') st.card.remove(); else st.card.insert();          // S-SDCARD
    set_bit(this.images[g], b, bit, action === 'remove' ? 1 - pol : pol);         // the card switch, S-KEYBITS
    const [codes] = this.push_group(g);
    this.camapp.pump();                                                            // S-MEDIA's change, in the step
    return this.wait_until(lab.lab_time() + CARD_MS * 1000000, tag, true,
      { kind: 'card', extra: () => ({ card: st.status(), slot: st.slot(), media: media.status(), uiin_codes: codes.map(h8) }) });
  }
  // the port as the lab sees it: the cable, the E-DDC reads the sink answered and the driver's EDID state
  hdmi_status() {
    if (!this.hdmi_port) return null;
    const lab = this.lab, [address, bytes] = MODEL_INFO.hdmi.state, b = lab.sim.read(address, bytes);
    let state = 0;
    for (let i = bytes - 1; i >= 0; i--) state = state * 256 + b[i];
    return { cable: lab.sim.u32(HDMI_WINDOW + W_CABLE) ? 'in' : 'out', ddc_reads: lab.sim.u32(HDMI_WINDOW + W_DDC_READS), edid_state: `0x${state.toString(16)}` };
  }
  bit_of(cid) {
    const c = BY_ID.get(cid);
    if (c === undefined) throw new KeyError(show(cid));
    if (c.status === 'not-wired') throw new PlayError(`${c.name}: not wired (${c.reason})`);
    const [g, b, bit] = c.uiin;
    return (this.images[g][b] >> bit) & 1;
  }
  // H-DIALSTEP: per detent the firmware's counter writer 0x5014bae6(dial id, +1 / -1), UI_IN's dial step posts the dial id
  // natively, and the camera application turns it into the GUI's input. A detent whose counter word the GUI does not read ends the input (dial_unread).
  dial_input(which, detents) {
    if (typeof which !== 'string' || !Object.hasOwn(N.DIALS, which.toUpperCase())) throw new ValueError(`dial ${show(which)}: main or sub`);
    if (!detents) throw new ValueError('dial: detents != 0');
    const tag = `${which.toUpperCase()}${detents > 0 ? '+' : ''}${detents}`;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    const lab = this.lab;
    const state0 = lab.state();
    const c = BY_ID.get(`${which.toLowerCase()}_dial`);
    if (c === undefined) throw new KeyError(show(`${which.toLowerCase()}_dial`));
    const [dial_id, slot] = c.dial;
    const base = N.dial_counters(slot);
    const word = base + (detents > 0 ? 8 : 10);
    const posted = [];
    let codes = [], unread = null;
    const nabs = Math.abs(detents);
    for (let k = 0; k < nabs; k++) {
      const n0 = lab.uiin_codes.length;
      lab.call(DIAL_WRITE, { d0: dial_id, d1: (detents > 0 ? 1 : -1) >>> 0 }, null, null, 200000);
      this.settle(`dial ${which} detent`);
      const got = lab.uiin_codes.slice(n0).map(([, x]) => x);
      codes = codes.concat(got);
      for (const code_ of got) {
        const [idx] = this.keymap(code_);
        if (idx !== null && this.opts.mutant !== 'dial-unread') { this.event(idx); posted.push(idx); }
      }
      const left = lab.sim.read(base + 8, 4);
      if (left.some((x) => x)) {
        lab.sim.write(base + 8, new Uint8Array(4));
        unread = `dial ${which}: the GUI did not read the counter word ${h8(base + 8)} (${bytesHex(left)}) after detent ${k + 1} of ${nabs} ` +
          `(UI_IN posted ${show(got.map(h8))}); the words are cleared, the input not taken`;
        break;
      }
    }
    return this.end(tag, 'dial', posted, [], { dial: { slot, word: h8(word), count: 1 },
      uiin: codes.map((x) => ({ code: h8(x), ev: this.tables.ev_name(x) })), dial_unread: unread });
  }
  // LV button / eye sensor (M10B): a live switch with the GUI told. The eye sensor's state is the shown device: with no
  // value it changes it, value 1 / 0 asks for the EVF / the TFT; LV switches to the other device.
  display_input(cid, value = null) {
    let want;
    if (cid === 'eye') {
      const v = typeof value === 'boolean' ? +value : value;       // a boolean counts as 0 or 1
      if (v !== null && v !== 0 && v !== 1) throw new ValueError(`eye: value ${show(value).slice(0, 40)} (0 or 1)`);
      const near = v === null ? this.device !== 'evf' : v === 1;
      want = near ? 'evf' : 'tft';
    } else {
      if (value !== null) throw new ValueError('lv: a button, it takes no value');
      want = this.device === 'tft' ? 'evf' : 'tft';
    }
    if (want === this.device) {
      this.begin(`${String(this.steps.length).padStart(2, '0')}-${cid} (no change)`);
      return this.end(`${cid}: already ${want}`, 'display', [], [], { device: want });
    }
    return this.live_switch(want, cid);
  }
  // ---- M10B: live display switches
  // null when the GUI task waits at its message receive, else why it does not.
  gui_busy() {
    if (this.opts.mutant === 'gui-busy-unchecked') return null;    // a busy GUI task not refused
    const lab = this.lab, tid = lab.gui_tid;
    if (lab.nk.timed_waiters().includes(tid)) {
      return `the GUI task ${tid} is in the kernel's timeout queue (dly_tsk or a timed wait), not at its message receive, so it would not take 131; ${GUI_BUSY_NOTE}`;
    }
    return null;
  }
  // SWITCH (M10B): DISPLAY cmd 2 OPEN of want, H-RESEND, H-EYESTATE, H-CONNECT 131 with the sender's lOutput, then the
  // post-conditions; the camera application ends and re-enters the screen itself (with S-OUTDISP).
  live_switch(want, cause) {
    const lab = this.lab;
    if (!this.gate_open()) throw new PlayError(`display switch while the GUI awaits event 0x${lab.sim.u32(B7_GATE).toString(16)} (B7)`);
    const busy = this.gui_busy();
    if (busy) throw new ValueError(`display switch refused: ${busy}`);
    const state0 = lab.state();
    const panel0 = lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-SWITCH:${want}`);
    lab.harvest();
    const e0 = lab.exec_history.length, m9 = lab.module9_reads.length;
    const layout0 = lab.b2_snapshot();
    lab.open(want);
    const sends = lab.resend_palettes(want);
    let eye = null;
    // H-EYESTATE on every switch (fix3; LV too): the eye state follows the shown device (lv-no-eyestate
    // skips it for LV; eye-inverted swaps the states)
    if (cause === 'eye' || this.opts.mutant !== 'lv-no-eyestate') {
      const state = this.opts.mutant !== 'eye-inverted' ? lookup(EYE_STATE, want) : 3 - lookup(EYE_STATE, want);
      lab.call(EYE_SET, { d0: state }, null, null, 20000);
      eye = lab.sim.read(EYE_WORD, 1)[0];
      if (eye !== state) throw new PlayError(`H-EYESTATE: ${h8(EYE_SET)}(${state}) left ${h8(EYE_WORD)} = ${eye}`);
    }
    this.device = want;
    const np0 = lab.panels.length;
    const info = this.connect(want);
    const on_connect = lab.panels.slice(np0).map(([, p]) => p);
    lab.harvest();
    const engine = lab.exec_history.length - e0;
    const layout = lab.b2_snapshot();
    const reads = lab.module9_reads.slice(m9).map(([, site]) => site);
    const problems = [];
    const panel1 = lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null;
    const same = state0 === 0x0401 ? SCP_STATES.includes(lab.state()) : lab.state() === state0 && panel1 === panel0;
    if (!same) problems.push(`the re-entry landed on GUI state ${h4(lab.state())} panel ${panel1}, not the screen the switch left (${h4(state0)} panel ${panel0})`);
    if (reads.some((x) => x !== MM.TAKEOVER_READERS[0] && !CA_MODULE9_READERS.includes(x))) problems.push(`module 9 read from ${show(reads.map(hex))}`);
    if (this.touch_on && want === 'tft' && state0 === STATE_SHOOTING && lab.sim.u32(TP_MASK_WORD) !== TP_MASK_ALL) {
      problems.push(`TFT shooting screen rebuilt with gesture mask 0x${lab.sim.u32(TP_MASK_WORD).toString(16)}`);
    }
    if (problems.length && !['no-connect', 'tft-loutput-1'].includes(this.opts.mutant)) throw new PlayError(`SWITCH:${want}: ` + problems.join('; '));
    this.switches += 1;
    if (this.scene !== null && this.scene.liveview) this.scene_attach();
    const ctrl3 = {};
    for (const d of Object.keys(D.DEVICE)) ctrl3[d] = lab.vsc.bank(D.DEVICE[d].channel, true).get('CTRL3') ?? null;
    const rec = { cause, connect: info, layout_before: layout0, layout_after: layout, module9_reads: reads.map(h8), eye, engine, problems,
      panels_on_connect: on_connect, ctrl3, resend: sends.map(([c, d, r]) => [c, bytesHex(d), h8(r)]) };
    const indices = [CONNECT_INDEX];
    return this.end(`${cause} -> SWITCH:${want}`, 'display', indices, [], { device: want, switch: rec, state_from: h4(state0) });
  }
  // ---- touch
  // down / move / up at display (x, y) of the TFT (0..899, 0..599).
  touch(action, x, y) {
    if (!this.touch_on) throw new PlayError('touch is off (--touch off)');
    if (!['down', 'move', 'up'].includes(action)) throw new ValueError(`touch: action ${show(action)} (down, move, up)`);
    this.begin(`${String(this.steps.length).padStart(2, '0')}-touch ${action} ${x},${y}`);
    const lab = this.lab;
    const state0 = lab.state();
    x = clampInt(x, 899);
    y = clampInt(y, 599);
    const ry = this.opts.mutant !== 'no-flip' ? 599 - y : y;      // no-flip: raw y served unflipped
    const ev = { down: 0, move: 2, up: 1 }[action];
    const count = action === 'up' ? 0 : 1;
    lab.tp_image = new Uint8Array([count, (ev << 6) | (x >> 8), x & 0xFF, (0 << 4) | (ry >> 8), ry & 0xFF, 0, 0, 0xC0 | 0x0F, 0xFF, 0xFF, 0xFF]);
    const g0 = lab.gestures.length, s0 = lab.tp_status.length, r0 = lab.tp_reads.length;
    const flag = unpack('<h', lab.sim.read(TP_FLAG, 2))[0];
    lab.call(OLYEVST, { d0: flag, d1: 1 }, null, null, 5000);
    this.settle(`touch ${action}`);
    const extra = this.touch_extra(g0, s0, r0);            // posts the GUI touches (S-TOUCHMAP)
    const rec = this.end(`touch ${action} ${x},${y}`, 'touch', [], [], extra);
    this.status_reported = lab.tp_status.length;
    return rec;
  }
  touch_extra(g0, s0, r0) {
    const lab = this.lab;
    const posted = this.touch_to_gui();
    this.gesture_reported = lab.gestures.length;
    return { gestures: lab.gestures.slice(g0), tp_status: lab.tp_status.slice(s0).map(([, st]) => st), touch_posted: posted,
      cafwd: lab.cafwd.filter((c) => c.step === lab.step_tag), tp_image: bytesHex(lab.tp_image), tp_reads: lab.tp_reads.slice(r0) };
  }
  // S-TOUCHMAP: post index 109 for every HFW status not yet posted; returns the posts.
  touch_to_gui() {
    const lab = this.lab;
    const posted = [];
    while (this.touch_mapped < lab.tp_status.length) {
      const [, st] = lab.tp_status[this.touch_mapped];
      const gs = lab.status_gesture.get(this.touch_mapped) ?? null;
      this.touch_mapped += 1;
      const km = TOUCHMAP.get(st);
      if ((this.opts.touch ?? 'gui') !== 'gui' || !km || gs === null) continue;
      this.post_touch(km[0], gs.x, gs.y);
      posted.push({ status: st, kind: km[0], name: km[1], x: gs.x, y: gs.y });
    }
    return posted;
  }
  pending_touch() { return this.touch_on && (this.touch_mapped < this.lab.tp_status.length || this.gesture_reported < this.lab.gestures.length); }
  // After lab time that produced gestures (the driver's timers): one step with the gestures and their GUI posts.
  touch_gui_step() {
    const lab = this.lab;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-touch gesture`);
    const state0 = lab.state();
    const g0 = this.gesture_reported, s0 = this.status_reported;
    const posted = this.touch_to_gui();
    this.gesture_reported = lab.gestures.length;
    this.status_reported = lab.tp_status.length;
    return this.end('touch gesture', 'touch-gui', posted.map(() => TOUCH_INDEX), [], { gestures: lab.gestures.slice(g0),
      tp_status: lab.tp_status.slice(s0).map(([, st]) => st), touch_posted: posted, cafwd: lab.cafwd.filter((c) => c.step === lab.step_tag) });
  }
  screen() {
    const s = this.lab.state(), st = this.lab.state_names.get(s) ?? '?';
    if (s === STATE_SHOOTING) return 'shooting';
    if (SCP_STATES.includes(s)) return 'scp';
    if (s >> 8 === 0x05) return 'playback';
    if (st.includes('MENU_LV')) return 'direct';
    if (s === N.STATE_CLOSED) return 'closed';
    if (s === MM.STATE_MENU) return 'menu';
    if (s === MM.STATE_POWER_ON) return 'power-on';
    return 'other';
  }
  // The harness logs trim() bounds: [object, name] (test_lab's trim-growth check: every array that grows while the
  // session idles must be one of them).
  trim_lists() {
    const lab = this.lab;
    let lists = [[lab, 'log'], [lab, 'time_log'], [lab, 'events'], [lab, 'draw_log'], [lab, 'exec_history'], [lab.kernel, 'events'],
      [lab.kernel, 'errors'], [lab, 'settings_log'], [lab, 'rpc_log'], [lab, 'panels'], [lab, 'var226_steps'], [lab, 'native_calls'],
      [lab, 'i2c'], [lab, 'notes'], [lab, 'steps'], [lab, 'dropped_sends'], [lab, 'gui_log'], [lab.lt, 'idle_events'],
      [lab.lt, 'settle_log'], [lab.lt, 'elapse_log'], [lab, 'uiin_codes'], [lab, 'uiin_decoded'], [lab, 'tp_reads'], [lab, 'cafwd'],
      [lab, 'b2_trace'], [lab, 'module9_reads'], [lab, 'xcpu_log'], [this, 'steps'], [lab.kernel, '_delivered'],
      [lab, 'display_sends'], [lab.lt, 'started']];
    if (lab.nk.intc !== null) lists.push([lab.nk.intc, 'log']);
    if (!lab.write_sites.size) lists.push([lab, 'writes']);
    if (lab.value_sites.size) lists = lists.filter((x) => x[1] !== 'settings_log');
    return lists;
  }
  // Bounded memory: keep the last `keep` entries of the harness logs (begin() re-marks every step).
  trim(keep = 2000) {
    const lab = this.lab;
    if (this.opts.mutant === 'no-trim') return;
    const small = new Set(['idle_events', 'settle_log', 'elapse_log']);
    // the kernel's native deliveries index the controller's log: take them in before that log is cut, re-index after
    if (lab.nk.intc !== null) lab.kernel._sync_native();
    for (const [obj, name] of this.trim_lists()) {
      const v = obj[name];
      const k = obj === lab.lt && small.has(name) ? 50 : keep;
      if (Array.isArray(v) && v.length > k) {
        const cut = v.length - k;
        v.splice(0, cut);
        if (obj === lab && name === 'exec_history') { lab.menu_first = Math.max(0, lab.menu_first - cut); this.exec_trimmed += cut; }
        if (obj === lab && name === 'draw_log') lab.menu_draw_first = Math.max(0, lab.menu_draw_first - cut);
      }
    }
    if (lab.nk.intc !== null) lab.kernel._native_seen = lab.nk.intc.log.length;
    if (lab.tp_status.length > keep) {                     // tp_status indices are kept in step with status_gesture
      const cut = lab.tp_status.length - keep;
      if (this.touch_mapped >= cut && this.status_reported >= cut) {
        lab.tp_status.splice(0, cut);
        const sg = new Map();
        for (const [k, v] of lab.status_gesture) if (k >= cut) sg.set(k - cut, v);
        lab.status_gesture = sg;
        this.touch_mapped -= cut;
        this.status_reported -= cut;
      }
    }
    if (lab.gestures.length > keep && this.gesture_reported >= lab.gestures.length - keep) {
      const cut = lab.gestures.length - keep;
      lab.gestures.splice(0, cut);
      this.gesture_reported -= cut;
    }
    this.marks = null;
  }
  // --debug-api tokens: WINDOWS[:width] (the shown device's displayed GUI windows, zlib + base64; the deflate is
  // env.deflate, node's zlib on the node side), STORE (every scalar store id without a key selector through the
  // firmware's getter, as a digest; src/lab/settings_ids.mjs), INTC, VSC, B2, EYE and XCALL:ctrl_or:ch:en.
  debug_token(tok) {
    const lab = this.lab;
    const isWindows = tok === 'WINDOWS' || tok.startsWith('WINDOWS:');
    // a host without zlib (the browser player) refuses WINDOWS before anything runs (player.mjs env.refuseUnported)
    if (isWindows && !this.env.deflate) throw new Unported('the WINDOWS token without env.deflate (zlib level 6)');
    let planes = {}, err = null;
    if (isWindows) {
      // lab time to the next boundary and the composite first; a token's composite is not a shown frame (a15_frames kept)
      try {
        const n = this.a15_frames;
        this.frame();
        this.a15_frames = n;
        planes = this.last_planes.planes;
      } catch (e) {
        if (!(e instanceof PlayError)) throw e;
        err = e.message.slice(0, 200);
      }
    }
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tok}`);
    let info = {};
    const ctrl3 = (d) => lab.vsc.bank(D.DEVICE[d].channel, true).get('CTRL3') ?? null;
    if (isWindows) {
      let win;
      if (tok.includes(':')) {
        const width = decimalInt(tok.split(':')[1]);
        if (width !== 800 && width !== 900) throw new ValueError(`token ${show(tok)}: width 800 or 900`);
        const full = displayed_windows(lab, this.device, width);
        win = new Map([0, 1, 2].map((k) => [k, [width, 600, full.get(k)]]));
      } else {
        // each GUI layer as the VSC samples it in the latched bank (A6, the model's rule)
        if (!Object.keys(planes).length) throw new PlayError(`WINDOWS: no composite to take the plane geometry from (${err})`);
        const bank = lab.vsc.bank(D.DEVICE[this.device].channel, true);
        // bank[name]: KeyError for a name the bank does not list, PlayError for one never latched
        const bk = (name) => { if (!bank.has(name)) throw new KeyError(show(name)); const v = bank.get(name); if (v === null) throw new PlayError(`WINDOWS: ${name} is not latched`); return v; };
        win = new Map();
        for (let k = 0; k < 3; k++) {
          const n = `OSD${k + 1}`;
          const pr = planes[n] || {};
          let [w, h] = pr.result === 'drawn' ? [pr.w || 0, pr.h || 0] : [0, 0];
          const rsz1 = bank.get(`${n}RSZ1`) || 0;
          if (w && rsz1 & 1) w = Math.floor(((w - 1) * bk(`${n}RSZ2`) + 2048) / 4096) + 1;
          if (h && rsz1 & 0x10) h = Math.floor((h - 1) * bk(`${n}RSZ4`) / 4096) + 1;
          const stride = (bk(`${n}DMALD`) >> 3) * 128;
          const base = bk(`${n}DMASADR`) * 16;
          w = Math.min(w, stride);
          const buf = new Uint8Array(w * h);
          if (w) for (let y = 0; y < h; y++) buf.set(lab.sim.read(base + y * stride, w), y * w);
          win.set(k, [w, h, buf]);
        }
      }
      const sha16 = (b) => this.env.createHash('sha256').update(b).digest('hex').slice(0, 16);
      const sizes = {}, layers = {}, pl = {};
      for (const [k, v] of win) {
        sizes[k] = [v[0], v[1]];
        layers[k] = { w: v[0], h: v[1], sha: sha16(v[2]), z: base64(this.env.deflate(v[2], 6)) };
      }
      for (const [k, v] of Object.entries(planes)) pl[k] = Object.fromEntries(['result', 'x0', 'y0', 'w', 'h'].map((f) => [f, v[f] ?? null]));
      info = { device: this.device, sizes, planes: pl, layers };
    } else if (tok === 'STORE') {
      const ids = new SettingsIds(this.env.rom).store_ids();
      const vals = ids.map((i) => [i, lab.get(i)]);
      info = { ids: ids.length, sha: this.env.createHash('sha256').update(new TextEncoder().encode(spacedJson(vals))).digest('hex').slice(0, 16) };
    } else if (tok === 'INTC') {
      const intc = lab.nk.intc;
      const [total, rows] = intc.xcpu();
      const [acc_total, acc] = intc.accepted();
      info = { pending: [0, 1, 2, 3].map((b) => intc.ipi_pending(b)), xcpu_total: total,
        xcpu: rows.map(([b, v, pc]) => [b, v, h8(pc)]).slice(-8), level2_accepted: acc.filter(([lv]) => lv === 2).length,
        accepted_total: acc_total, irq324_level: intc.level(IRQ.IRQ_IPI), line324: intc.line(IRQ.IRQ_IPI)[0],
        services: lab.xcpu_log.slice(-8).map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'snapshot'))),
        snapshots: lab.xcpu_log.slice(-8).map((x) => x.snapshot), waiting: lab.xcpu_waiting, handler_runs: lab.ipi_handler_runs };
    } else if (tok === 'VSC') {
      const c3 = {}, verdict = {}, bits = {};
      for (const d of Object.keys(D.DEVICE)) c3[d] = ctrl3(d);
      for (const d of Object.keys(D.DEVICE)) verdict[d] = lab.a15_verdict(d);
      for (const d of Object.keys(D.DEVICE)) bits[d] = lab.vsc.assumed(D.DEVICE[d].channel);
      info = { ctrl3: c3, verdict, last: this.a15_last, frames: this.a15_frames, assumed_bits: bits };
    } else if (tok === 'B2') {
      info = { trace: lab.b2_trace.slice(-40).map((t) => t.slice(0, 5)), module9_reads: lab.module9_reads.slice(-20), snapshot: lab.b2_snapshot() };
    } else if (tok === 'EYE') {
      const bank = lab.vsc.bank(D.DEVICE.evf.channel, true);
      const tb = lab.sim.read(EYE_TIMER, 2);
      info = { eye: lab.sim.read(EYE_WORD, 1)[0], word: h8(EYE_WORD), timer: tb[0] | tb[1] << 8, callback: h8(lab.sim.u32(EYE_CALLBACK)),
        evf_osd_planc: [1, 2, 3].map((n) => bank.get(`OSD${n}PLANC`) ?? null), store_first: lab.store_first };
    } else {
      const parts = tok.split(':');
      if (parts.length !== 4 || parts[1] !== 'ctrl_or' || !parts.slice(2).every((x) => /^[0-9]+$/.test(x))) throw new ValueError(`token ${show(tok)}: XCALL:ctrl_or:<ch>:<en>`);
      const ch = Number(parts[2]), en = Number(parts[3]);
      if (!(ch === 1 || ch === 2) || !(en === 0 || en === 1)) throw new ValueError(`token ${show(tok)}: channel 1 (EVF) or 2 (TFT), en 0 or 1`);
      lab.call(CTRL_OR, { d0: ch, d1: en }, null, null, 2000);
      info = { called: `${h8(CTRL_OR)}(${ch}, ${en})`, verdict: lab.a15_verdict(Object.keys(D.DEVICE).find((d) => D.DEVICE[d].channel === ch)) };
    }
    return this.end(tok, 'debug', [], [], { info });
  }
  // ---- S-SCENE: a stand-in for the image sensor (scene.mjs) feeding the live view through the firmware's own
  // through-image path (M7: the through permit 0x501c40d0, the bank element written through the bus window, the TH API
  // 0x501c3f4d with the harness-chosen scaled request, H-REQ). Off until a scene input turns it on; the composite then
  // shows IMG1, which needs A15 (the TH path sets CTRL3 0x41). S1, S2 and REC also act on the scene: S1 focuses on the
  // layer under the AF point, S2 records a capture with the exposure in use, REC starts and ends a clip. That is the
  // harness's, not the firmware's: the camera application that would run AF, the release and the movie recording
  // does not run (docs/om1-shutter-spec.md).
  scene_input(change) {
    const lab = this.lab;
    const on0 = this.scene !== null && this.scene.liveview;
    let c = change;
    let want = null;
    if (c !== null && typeof c === 'object' && !Array.isArray(c) && Object.hasOwn(c, 'liveview')) {
      want = c.liveview;
      if (typeof want !== 'boolean') throw new ValueError(`scene: liveview ${show(want)}: true or false`);
      c = { ...c }; delete c.liveview;
    }
    const base = this.scene ?? { ...SC.defaultScene(), liveview: false, captures: [], clips: [], frame_no: 0 };
    const next = { ...SC.applySceneChange(base, c), liveview: base.liveview, captures: base.captures, clips: base.clips, frame_no: base.frame_no };
    if (want !== null) next.liveview = want;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-S-SCENE`);
    this.scene = next;
    if (next.liveview && !on0) this.scene_attach();
    else if (!next.liveview && on0) this.scene_blank();
    lab.harvest();
    return this.end('S-SCENE', 'scene', [], [], { scene: SC.sceneReport(next), liveview: next.liveview });
  }
  // S1 down: focus on the layer under the AF point (AF OK), or AF NG; S2 down: a capture with the exposure in use; REC
  // down: a clip starts or ends.
  scene_key(cid, action) {
    const sc = this.scene;
    if (sc === null || !sc.liveview || action !== 'down') return null;
    const t = this.lab.lab_time() / 1e9;
    if (cid === 's1') {
      const z = SC.focusAt(sc, t);
      if (z === null) sc.af = 'ng';
      else { sc.lens.focus_m = z; sc.af = 'ok'; }
      return { af: sc.af, focus_m: sc.lens.focus_m };
    }
    if (cid === 's2') {
      const e = SC.exposureOf(sc);
      const cap = { n: sc.captures.length + 1, lab_ns: this.lab.lab_time(), shutter_s: e.shutter_s, aperture: e.aperture, iso: e.iso, ev_offset: +e.ev_offset.toFixed(2), focus_m: sc.lens.focus_m, af: sc.af };
      sc.captures.push(cap);
      const view = { scene: structuredClone({ ...sc, captures: [], clips: [] }), t: this.lab.lab_time() / 1e9, frame_no: sc.frame_no + 1, capture: cap };
      this.capture_frame = this.scene_render();    // S-RECVIEW: the frame the capture holds, for the rec view
      this.camapp?.card_view(view);                // S-CARD: the scene the image keeps, for S-PLAYVIEW
      return { capture: cap };
    }
    if (cid === 'rec') {                 // REC down starts a clip, the next REC down ends it
      const now = this.lab.lab_time(), open = sc.clips.at(-1);
      if (open && open.end_ns === null) { open.end_ns = now; open.seconds = +((now - open.start_ns) / 1e9).toFixed(3); return { clip: open }; }
      const clip = { n: sc.clips.length + 1, start_ns: now, end_ns: null, seconds: null };
      sc.clips.push(clip);
      return { clip };
    }
    return null;
  }
  scene_render(t_s = this.lab.lab_time() / 1e9) {
    const sc = this.scene, [src] = D.LV_SCALED[this.device];
    sc.frame_no += 1;
    return SC.renderFrame(sc, src[0], src[1], t_s, sc.frame_no);
  }
  // The live view's step and its time (s): a moving scene is rendered once per 1/15 s of lab time, at the step's
  // start (so S-SUBJECT's subjects, subject.mjs, are where the shown frame has them); a still one at step 0, now.
  scene_step() {
    const sc = this.scene, now = this.lab.lab_time();
    if (!sc.layers.some((l) => l.speed)) return { step: 0, t: now / 1e9 };
    const step = Math.floor(now / SCENE_STEP_NS);
    return { step, t: (step * SCENE_STEP_NS) / 1e9 };
  }
  // The scene's frame for the next composite: rendered again when the scene changed or one of its layers moves (then
  // at most every 1/15 s of lab time).
  scene_frame() {
    const sc = this.scene, lv = this.lv;
    if (sc === null || !sc.liveview || lv === null) return;
    if (this.recview_hold || this.playview_hold) return;   // S-RECVIEW / S-PLAYVIEW: the shown capture stays
    if (this.through_off) {                        // S-THROUGH: black until the application starts the through image
      if (lv.key !== 'through off') { lv.key = 'through off'; this.lab.load_lv_frame(this.black_frame(), SCENE_BANK, 1, D.LV_SCALED_CROP); }
      return;
    }
    const { step, t } = this.scene_step();
    const key = JSON.stringify([sc.preset, sc.layers, sc.ev, sc.lens, sc.exposure, step]);
    if (key === lv.key) return;
    lv.key = key;
    this.lab.load_lv_frame(this.scene_render(t), SCENE_BANK, 1, D.LV_SCALED_CROP);
  }
  // S-RECVIEW (camapp mode, at the application's START_RECVIEW / END_RECVIEW callbacks): while the GUI shows its rec
  // view, the live-view plane holds the frame of the last capture instead of the live scene. The camera would show the
  // developed image through its playback path, which the lab does not run (I: same plane, same scaling).
  scene_recview(on) {
    const sc = this.scene, lv = this.lv;
    if (!on) { if (this.recview_hold) { this.recview_hold = false; if (lv) lv.key = null; } return; }
    if (sc === null || !sc.liveview || lv === null || !this.capture_frame) return;
    this.lab.load_lv_frame(this.capture_frame, SCENE_BANK, 1, D.LV_SCALED_CROP);
    this.recview_hold = true;
  }
  // S-PLAYVIEW (at S-PLAYSEQ's startSingleFrame finish and endPlayService): while the GUI shows a card image, the
  // live-view plane holds the frame rendered again from the scene the image kept (view: S-CARD's, false for an image
  // taken without the live view: black; null: the play service ended). The camera decodes the file onto its image
  // plane (I: same plane, same scaling as S-RECVIEW).
  scene_playview(view) {
    const sc = this.scene, lv = this.lv;
    if (view === null) { if (this.playview_hold) { this.playview_hold = false; if (lv) lv.key = null; } return; }
    if (sc === null || !sc.liveview || lv === null) return;
    const [src] = D.LV_SCALED[this.device];
    this.lab.load_lv_frame(view ? SC.renderFrame(view.scene, src[0], src[1], view.t, view.frame_no) : this.black_frame(), SCENE_BANK, 1, D.LV_SCALED_CROP);
    this.playview_hold = true;
  }
  // S-THROUGH (camapp mode, at the application's ctrlAutoThrough 0x50abd373(ctrl)): ctrl 0 (the menu opens) stops the
  // through image, and the live-view plane shows black until ctrl 1 (I: what the camera's plane shows meanwhile). Called
  // while the firmware runs: the frame changes at the next composite (scene_frame).
  scene_through(on) { this.through_off = !on; }
  // S-RECFILE (storage.mjs): the frame of a picture's file, S-SCENE's frame rendered again from the scene kept with the
  // capture (camapp.mjs S-CARD's view), or black for a capture without the live view
  picture_frame(view) {
    const [src] = D.LV_SCALED[this.device];
    return view ? SC.renderFrame(view.scene, src[0], src[1], view.t, view.frame_no) : this.black_frame();
  }
  black_frame() {
    const [src] = D.LV_SCALED[this.device];
    const row = new Uint8Array(2 * src[0]);
    for (let x = 0; x < row.length; x += 2) row[x + 1] = 128;
    return [src[0], src[1], Array.from({ length: src[1] }, () => row)];
  }
  scene_attach() {
    const lab = this.lab, dev = this.device;
    lab.through_permit(dev, 1);
    const address = lab.load_lv_frame(this.through_off ? this.black_frame() : this.scene_render(), SCENE_BANK, 1, D.LV_SCALED_CROP);
    const [src, dst, at] = D.LV_SCALED[dev];
    const th = lab.live_view(dev, D.ThRequest.scaled(D.DEVICE[dev].mask, address, D.LV_SCALED_CROP, src, dst, at));
    if (th.img0 !== th.start) throw new PlayError(`S-SCENE: the TH API left img[0] = ${h8(th.img0)}, not the request's start ${h8(th.start)}`);
    this.lv = { device: dev, address, key: this.through_off ? 'through off' : null };
  }
  scene_blank() {
    this.lab.load_lv_frame(this.black_frame(), SCENE_BANK, 1, D.LV_SCALED_CROP);
    this.lv = null;
  }
  status() {
    const lab = this.lab, s = lab.state();
    let menu = null;
    if (s === MM.STATE_MENU && lab.var226 !== null) {
      const st = this.state();
      const m = st.menu ?? {};
      menu = { screen: st.screen, tab_id: m.tab_id ?? null, page: m.page ?? null, pages: m.pages ?? null, row: m.cursor_row ?? null, f: m.f ?? null };
    }
    const lists = [lab.log, lab.time_log, lab.events, lab.draw_log, lab.exec_history, lab.kernel.events, lab.settings_log, lab.native_calls,
      lab.i2c, lab.lt.idle_events, lab.lt.elapse_log, lab.lt.settle_log, this.steps].reduce((n, v) => n + v.length, 0);
    const mask = this.touch_on ? lab.sim.u32(TP_MASK_WORD) : null;
    const heap = {};
    for (const [k, v] of lab.heap_stats.entries()) heap[k] = v;
    heap.top = lab.heap - HLE.HEAP;
    const bits = {};
    // (null for a switch the model's UI_IN does not read: E142 has no Fn lever or monitor switch, apply_uiin_layout)
    for (const c of ['lever', 'monitor', 'rotate']) bits[c] = BY_ID.get(c).status === 'not-wired' ? null : this.bit_of(c);
    return { gui: h4(s), gui_name: lab.state_names.get(s) ?? '?', panel: lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null,
      screen: this.screen(), device: this.device, tp_mask: mask,
      tp_gestures: [...GESTURES].sort((a, b) => a[0] - b[0]).filter(([b]) => mask && (mask & b)).map(([, n]) => n),
      lab_ns: lab.lab_time(), gate: lab.sim.u32(B7_GATE), pressed: [...this.pressed].sort(), mode_dial: this.mode_index, bits,
      dispq: this.dispq_total + (lab.dispq ? lab.dispq.length : 0), menu, engine_total: lab.exec_history.length + this.exec_trimmed,
      harness_entries: lists, heap, layout: lab.b2_snapshot(), a15: this.a15_status(), a15_frames: this.a15_frames, switches: this.switches,
      eye: lab.sim.read(EYE_WORD, 1)[0], xcpu: lab.xcpu_log ? lab.xcpu_log.length : 0, xcpu_waiting: lab.xcpu_waiting ?? 0,
      ...(this.camapp !== null ? { camapp: this.camapp.status() } : {}),
      ...(this.scene !== null ? { scene: { ...SC.sceneReport(this.scene), liveview: this.scene.liveview, captures: this.scene.captures.slice(-5), clips: this.scene.clips.slice(-5) } } : {}) };
  }
  // The page's A15 line: the text while the shown frame rests on A15, else the guard's verdict.
  a15_status() {
    const a = this.a15_last ?? {};
    return { mode: this.a15_mode, assumed: !!a.assumed, verdict: a.verdict ?? null, why: a.why ?? null,
      text: a.assumed && this.a15_mode === 'auto' ? a15_text(a) : (a.assumed ? 'A15 assumed (--a15 on): CTRL3 bit 6 meaning unknown' : null) };
  }
}
PlaySession.SET_HOOKS = 2000;

