// Interactive play mode's session: the firmware tables, CONTROLS, idle_images,
// PlayLab (observers and stand-ins: S-HEAP, S-DISPQ, blocked sends, S-BGDRAW, S-CAFWD, S-TPREG and the touch observers,
// the A15 bracket recorder, S-CPU2) and PlaySession (bring-up, every input: keys, the shutter
// sequence, H-G4SET and H-JSINJECT, switches, the mode dial, dials, touch, the live display switch, the camera
// application (S-CAMAPP, camapp.mjs), idle slices and frames, trim, status, the debug tokens). The Player (queue, lab time, replay) is in
// player.mjs. The mutants (opts.mutant, the Player's --x-mutant: negative controls) sit at the sites they break.
// Addresses are disassembly notation unless marked run-time.
import { A, MODEL, ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, refuseUnmapped, isUnmapped, fact } from '../fw/model.mjs';
import { BOARD, boardKnows } from '../fw/board.mjs';
import { SCPU_DOORBELL, HDMI_WINDOW, HDMI_DOORBELL } from '../machine.mjs';
import { SET_INPUTS } from '../dev/scpu.mjs';
import { PLUG, UNPLUG, EDID, W_EDID_LEN, W_CABLE, W_DDC_READS, W_SCDC_WRITES } from '../dev/hdmi.mjs';
import { sinkEdid } from './edid.mjs';
import { Accelerometer } from './acc.mjs';
import { Storage, STORAGE, SECOND } from './storage.mjs';
import { SdCard, cardSectors } from './sdcard.mjs';
import { NativeLens } from './lens.mjs';
import { ResNand } from './resnand.mjs';
import { IoExpanders, PowerOff, POWER_OFF, startPowerManager, laterInits } from './power.mjs';
import { SCAN_IDLE } from './scpudev.mjs';
import { dpcInit, sioStart, powerTaskStart } from './bodystart.mjs';
import { TOUCH_CONTROLLERS } from './touchpanel.mjs';
import { imageView } from '../fw/image.mjs';
import { IIC_WAITS_E143, TOUCH_TASK_QUEUE_E143, MODE_DIAL_E143, SIO_E143, AD_E143 } from '../fw/facts.mjs';
import { FACTS } from '../fw/ports.mjs';
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
import { CamApp, CA_MODULE9_READERS, pcPdQueue } from './camapp.mjs';
import { MecCount } from './mec.mjs';
import { AudioOut } from './audio.mjs';
import { AudioHw } from './audiohw.mjs';
import { Cpu2, CPU2_QUANTUM, initQueueFlagTables } from './cpu2.mjs';
import { labSoundArea, STAND_IN as SOUNDRES } from './soundres.mjs';
import { DisplayQueue } from './dispq.mjs';

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
// where the post passes a code on to the sink (src/fw/facts.mjs uiInForward): E143's forward, called at three places of
// its post with the code in d0 (D); a build that inlines the forward (the E118 family) has the sink's test at three
// places of its post, each with the code in a register of its own (D)
const uiInForward = () => fact('ui_in.forward', [{ at: UI_IN_FWD, reg: 'd0' }]);
export const UI_IN_DIRECT = new Map([[A(0x5014BC0C), 'dial step'], [A(0x5014E374), 'joystick']]);
export const G4_IMAGE = A(0x629887E4), JS_DIR_CODE = 0x1234, JS_QUERY = A(0x50425355);
// H-G4SET: whether group 4 (E143: HDMI, CEC, lens) goes through the firmware's own group-4 producer G4_SET, read when
// a session is brought up: E143's does (X); a model's MODELS g4set gives its own with its evidence, and a model
// without one is refused there
const g4set = () => fact('g4set', true);
// UI_IN's group 0 (the power lever, the Fn lever, S1, 0x1229 and three of the SCPU's request lines) through the SCPU
// interface's port and event words (src/dev/scpu.mjs, board scpu.events) on a body that gives the firmware's part
// (src/fw/models.mjs scpu_port; docs/hle-gaps/4.7.md 4.7.2), null elsewhere: the bring-up attaches IRQ 320 and registers
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
// Host environment lookup: prefer an explicit value from env, falling back to Node's process.env for CLI and tests.
export function envVar(env, key, name, fallback = undefined) {
  const fromEnv = env?.[key];
  if (fromEnv !== undefined) return fromEnv;
  return globalThis.process?.env?.[name] ?? fallback;
}
// USB_IDLE (docs/hle-gaps/4.10.md 4.10.2, 4.10.3): the USB cable at a session's start, as the sub-CPU's PC13 (active
// low, D): 'in' (PC13 low, the default) or 'out' (PC13 high, no cable), opts.usb_idle, env.usb_idle or OM_USB_IDLE. The sub-CPU's
// model (S-SCPUDEV, or its own firmware with OM_EMU_SCPU=native) starts its port scan at that level, so UI_IN's module
// init takes it from the scan's first report; S-USBCABLE's first step is then a plug. With 'out' the lever's off makes
// the application call startShutDown itself, and S-SHUTDOWN follows that call (src/lab/power.mjs)
export const USB_IDLE = { in: 0, out: 1 };
export function usbIdle(o, env = null) {
  const v = o?.usb_idle ?? envVar(env, 'usb_idle', 'OM_USB_IDLE', 'in');
  if (!Object.hasOwn(USB_IDLE, v)) throw new ValueError(`usb_idle ${show(v)}: in or out`);
  // (X, E146: H-UIINSCAN in UI_IN's init's place decodes the scan's 0x0400 at state 1 against the lab's idle image,
  // which keeps it at 0: the image's start with no cable is not read there)
  if (v === 'out' && (uiinInit() === null || o?.mutant === 'no-uiininit')) throw new ValueError(`usb_idle out: ${MODEL} does not run UI_IN's module init natively (H-UIININIT, src/fw/models.mjs uiin_init; E143), so its idle image holds the USB switch 0x0400 at a cable in`);
  return v;
}
// H-UIININIT (src/fw/models.mjs uiin_init; docs/hle-gaps/4.7.md 4.7.17): on a body that gives it, UI_IN's module init
// runs natively at the bring-up in place of H-UIINRING, S-BOOTKEY and H-UIINSCAN: its calls, read from its bytes, in its
// order, but for the ones the body's entry leaves out (E143: 0x5014d97a, 4.7.21). Its key
// step (E143 0x5014e3ab) stores the boot key from the key table at the wake factor, configures the SCPU's ports from
// its bit table (0x5004e3fc, A-SCPU-4), clears the SCPU interface's word 0x04 and registers UI_IN's IRQ 320 callback
// (H-UIINPORT's registration); 0x5014d49e sets group 4's image and old state; the port scan is H-UIINSCAN's request;
// the key init (E143 0x5014d62e) reads and arms group 1's GIO key pins (H-GIOKEYS, below uiinKeyPins).
// S-WAKEFACTOR: the SCPU init, which stores the wake factor, does not run (the halfword stays 0, the factor of a start
// with the interface's bit 1 of word 0x00 clear, E143 0x5004ddbe..ca, D), so the lab sets it to the power button's,
// 1: the factor the init stores for bit 0 of the interface's word 0x90 (0x5004ddda..e2, D), whose key table entry is
// the power switch's code (E143 0x60224094[1] = 0x000c, X), as S-BOOTKEY set the key. Set after PER_SCPU's start,
// which took the factor 0 and reset the sub-CPU ("SCPU RST!", 4.7.1): the lab's link start stays a cold start (I)
const uiinInit = () => MODEL_INFO.uiin_init ?? null;
export const WAKE_POWER_BUTTON = 1;
// H-ADINIT (src/fw/facts.mjs adDriver, fact 'adc'; src/dev/adc.mjs; docs/hle-gaps/4.7.md 4.7.20): the A/D driver's
// init (E143 0x5004d3c3), which the boot calls at stage 0_3..0_l (0x50023f55), after its head's deferred-call init
// and before UI_IN's module init (1_l, 0x50024b7d; 4.6.5's table, D), natively at the bring-up in that order: the
// channel table (0xa32bff10, count 0xa32bff14) filled from the record of the core byte, the request ring cleared and
// the converter's IRQ 319 attached. A request then finds its channel and runs through the converter (0x5004d831), and
// its end posts its completion as a deferred call (E143's table gives every channel completion kind 5, 0x5004d1ee ->
// 0x500503d4, D), so the deferred calls' init runs before it, also on a body whose native lens ran it in its own
// bring-up (H-DPCINIT, src/lab/lens.mjs). A body whose board gives the converter, whose facts give the init and which
// AD_BODIES lists runs it: E143 and E146. Static inspection of FACTS.E146.adc on the E146 image confirms its 6-channel
// table [[1,6,5],[2,0,5],[3,2,5],[4,1,5],[5,3,5],[12,7,5]] is identical to E143's (D). E147's FACTS.E147.adc table
// holds 8 channels [[1,3,5],[2,0,5],[4,1,5],[12,6,5],[13,7,5],[14,5,5],[15,8,5],[16,2,5]] (D): although om1.adc now
// models converter channels 0..9 (including 8 at +0x70 and 9 at +0x74), driver channels 13..16 on E147 are not yet
// D-identified, so E147 stays out of AD_BODIES for now; the mutant no-adinit keeps the path before, where every
// request takes the driver's 'no channel' path (a deferred completion with no samples; UI_IN's channel open logs
// 0x28001511, 4.7.17). The converter's channels' values (src/dev/adc.mjs values), by the driver's channel (the table
// gives each its converter channel, D):
// - UI_IN's channel (E143 12, converter channel 7; the request 0x62988790 its channel open 0x5014ce00 builds from
//   0x6034f998[variant] = 0x602243f4, D) is the mode dial's: UI_IN maps a sample v to position k where t[k] <= v <
//   t[k + 1] in the threshold table its open stores at (0x6298877c) (0x5014d1bc, eleven words, E143 0x602243c8: 0,
//   0xac, 0x1f9, 0x330, 0x467, 0x5b7, 0x710, 0x884, 0xa08, 0xb63, 0xe0b) and writes 1 << k as the mode dial's group-2
//   image (0x5014cf0a, 0x5014d078, D). The lab gives the midpoint of the lab's dial position's interval (A-ADC-5, I:
//   any value in it is the same position to the firmware)
// - the power manager's channels (E143 1..5; the readers of 0x50042366: 1 at 0x500427e0 and 0x50042ecd; 2 and 3,
//   BODY and PBH vb_ad, at 0x50045b75 and 0x50045b89, and 0x5004317e; 4 and 5, BODY and PBH TEMP AD, at 0x50045a5e and
//   0x50045a72, D): 0 (A-ADC-4, I), the result every read gave through the 'no channel' path before (4.7.16: the
//   deferred completion leaves the sum 0), so that the power manager decides as the lab's did (X: the same start with
//   OM_POWER_LATER=on). What a body reads there is ? (the temperature step's bands, 0x5004675c: above 3024,
//   2501..3024, 1663..2500, below; its 'inserted' test 0x500467e8: below 3766, D)
// Any other channel has no value: its conversion's start is UNKNOWN (src/dev/adc.mjs)
export const AD_DIAL_CHANNEL = 12, AD_POWER_CHANNELS = [1, 2, 3, 4, 5], AD_POWER_VALUE = 0;
export const AD_DIAL_THRESHOLDS = A(0x6298877C), AD_DIAL_POSITIONS = 10, AD_MAX_CHANNELS = 10;
export const AD_ERRLOG = 0x28001511;
export const AD_BODIES = new Set(['E143', 'E146']);
const adInit = () => {
  if (!boardKnows('adc') || !AD_BODIES.has(MODEL)) return null;
  if (!ON_LAB_MODEL && !FACTS[MODEL]?.adc) return null;
  return fact('adc', AD_E143);
};
// The module init's calls, from its bytes (E143 0x5014bf91..0x5014bfc5, D): `clr d0; movbu d0,(B); mov d0,(W)`, then
// calls, `cd rel16 regs size` or `dd rel32 regs size`, up to `ret [],4`. {stores: [B, W], calls: [disassembly
// notation]}; throws for any other shape
export function uiinInitCalls(image, init) {
  const v = imageView(image, IMAGE_BASE, MODEL), at = runtime(init);
  if (v.u8(at) !== 0x00 || v.u8(at + 1) !== 0xFC || v.u8(at + 2) !== 0x82 || v.u8(at + 7) !== 0xFC || v.u8(at + 8) !== 0x81) {
    throw new PlayError(`H-UIININIT: UI_IN's module init ${h8(init)} does not open with clr d0; movbu d0,(abs32); mov d0,(abs32)`);
  }
  const stores = [v.u32(at + 3), v.u32(at + 9)], calls = [];
  for (let p = at + 13; ; ) {
    const op = v.u8(p);
    if (op === 0xCD) { calls.push(disasm((p + ((v.u16(p + 1) << 16) >> 16)) >>> 0)); p += 5; }
    else if (op === 0xDD) { calls.push(disasm((p + v.u32(p + 1)) >>> 0)); p += 7; }
    else if (op === 0xDF && v.u8(p + 1) === 0x00 && v.u8(p + 2) === 0x04) break;
    else throw new PlayError(`H-UIININIT: UI_IN's module init ${h8(init)} has 0x${fx(op, 2)} at ${where(p)}, not a call or its ret [],4`);
    if (calls.length > 16) throw new PlayError(`H-UIININIT: UI_IN's module init ${h8(init)} makes more than 16 calls`);
  }
  return { stores, calls };
}
// H-GIOKEYS (src/fw/models.mjs uiin_init.keys; docs/hle-gaps/4.7.md 4.7.21): UI_IN's key init (E143 0x5014d62e)
// reads, for each of its 16 keys, the pin of its table's entry {u32 pin, ...} pair (24 bytes a key; the table
// (list)[UI_IN's variant], `mov (variant),d0` at +0x19 and `mov list,a0` at +0x1f) into bit i of the group whose
// old state it writes (`add old,a2` at +0x48), then arms each pin's interrupt for the level it is not at (D,
// 0x5014d62e..0x5014d768). {list, variant, old, group, table, keys: [{bit, pin}]}: the pins as the table names them
// (class 0 the MN's GIO pins, which the driver maps by core through `map`; classes 2 and 3 the IO expanders' pins,
// read from their drivers' RAM; 255 none); throws where the bytes differ or the group is not 16 bits wide
export function uiinKeyPins(image, keys, groups) {
  const [read, list] = keys, v = imageView(image, IMAGE_BASE, MODEL), at = runtime(read);
  const op = (k, b0, b1) => v.u8(at + k) === b0 && v.u8(at + k + 1) === b1;
  if (!op(0x19, 0xFC, 0xA4) || !op(0x1F, 0xFC, 0xDC) || !op(0x48, 0xFC, 0xD2) || v.u32(at + 0x21) !== list) {
    throw new PlayError(`H-GIOKEYS: UI_IN's key init ${h8(read)} does not load its variant, the list ${h8(list)} and its group's old state at +0x19, +0x1f and +0x48`);
  }
  const variant = v.u32(at + 0x1B), old = v.u32(at + 0x4A), group = groups.findIndex((g) => g.old === old);
  if (variant !== UIIN_VARIANT) throw new PlayError(`H-GIOKEYS: the key init reads the variant at ${h8(variant)}, not UI_IN's ${h8(UIIN_VARIANT)}`);
  if (group < 0 || groups[group].bytes * 8 !== 16) throw new PlayError(`H-GIOKEYS: the key init's old state ${h8(old)} is no UI_IN group of 16 bits (group ${group})`);
  const table = v.u32(list), out = [];                     // variant 0 (the bring-up checks UI_IN's variant word)
  for (let i = 0; i < 16; i++) out.push({ bit: i, pin: v.u32(table + 24 * i) });
  return { list, variant, old, group, table, keys: out };
}
// The HDMI port (--hdmi on, a body with src/fw/models.mjs hdmi; src/dev/hdmi.mjs, docs/hle-gaps/4.9.md 4.9): the machine
// gets the transmitter, the hot-plug pin and the sink, the lab runs H-GIOSLOTS, and the input hdmi plug puts the sink
// (S-HDMISINK, src/lab/edid.mjs) on the port and lets HDMI_PLUG_MS of lab time run, in which the firmware takes the
// pin's interrupt, starts the transmitter, reads and parses the sink's EDID over the DDC and reports the connection to
// UI_IN natively (X: 1.4 ms of lab time on E143). The port's switch 0x0501 is then the firmware's, so the fw_0501
// input is refused
export const HDMI_PLUG_MS = 100, HDMI_SWITCH = 0x0501;
// a tilt input's wait (src/lab/acc.mjs): ACC_MAIN's next 80 ms cycle and PER_SLOPE's 20 ms (X: the gauge's getter
// reads the new tilt at the end of it; the GUI's redraw of the gauge follows up to about 50 ms later)
export const TILT_MS = 250;
// with --rotate on: also PER_ROTATE's next 100 ms pass after that sample and PER_SLOPE's following samples (X: over 13
// turns the orientation changed 40 to 160 ms after the input and the gauge's body followed 50 to 230 ms after it; a
// 250 ms wait once read the old body)
export const ROTATE_TILT_MS = 500;
// --rotate's value (off, on, auto; absent: auto) as whether PER_ROTATE runs: auto on a body whose fact acc gives rotate
export const rotateOn = (v) => { const r = v ?? 'auto'; return r === 'on' || (r === 'auto' && !!MODEL_INFO.acc?.rotate); };
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
// S-DISPQ's queue (src/lab/dispq.mjs, docs/hle-gaps/4.1.md 4.1.9): the synchronous send's own post, OlyQeWr(target,
// {msg, 16}, -1) at 0x5002e40c (a 5-byte call) with msg {its reply queue, get_tid's id, cmd, param}, after which it
// waits for the reply on that queue (OlyQeRd(queue, -1) at 0x5002e422) and deletes it (0x5002bfec), D: the send's own
// task waits while the DISPLAY task runs the command
export const SYNC_SEND_POST_RETURN = A(0x5002E411);
// H-TPINIT's step (the boot's call of the touch init, E143's from 0x50024ca6)
const H_TPINIT = 'H-TPINIT touch init 0x501e3dca (boot call from 0x50024ca6) from the lab task';
export const TOUCH_INIT = A(0x501E3DCA), TOUCH_TASK = A(0x501E3EAC), TOUCH_TASK_ID = A(0x60042DCC), TP_OPEN = A(0x501E40DA), TP_MASK = A(0x501E41D1);
// S-TPSEND's touch task queue: its flag and queue words and the queue's bit in the flag (src/fw/facts.mjs
// touchQueue, which also places TP_FLAG), none on a build without a touch task
export const TOUCH_QUEUE = isUnmapped(TOUCH_TASK) ? null : fact('touch_task', TOUCH_TASK_QUEUE_E143);
export const HFW_CALLBACK = A(0x50B76E60), TP_MASK_ALL = 0x11F1, TP_MASK_WORD = A(0x62A3EBC0), TP_FLAG = A(0x6004306C), OLYEVST = A(0x5002BD01);
export const HFW_STATUS = [[A(0x50B76FE3), [16, 225]], [A(0x50B7706B), [128, 226]], [A(0x50B770F3), [1, 227]], [A(0x50B7717C), [32, 228]],
  [A(0x50B77205), [256, 229]], [A(0x50B77297), [64, 230]], [A(0x50B77320), [4096, 300]]];
export const GPIO_TP = [[48, 0x9B880E00], [49, 0x9B880E40], [108, 0x9B883E80]], GPIO_TP_PAGE = 0x9B880000;
// S-GPIO-TP where the board's GIO key pins model 48, 49 and 108 (gio_keys, E143; src/dev/gio.mjs): there the pins
// hold UI_IN's levels (H-GIOKEYS: the idle image's 0, 1, 0 for 0x2403, 0x2402, 0x2401), at which the touch driver
// accepts no touch, and the stub's presets would not be read. The driver's four reads of them, the pin read
// 0x5000297f called at 0x501e485a, 0x501e4864, 0x501e486e (`mov 48 / 49 / 108,d0` before each) and 0x501e4bbd (49),
// the only calls of it with these pins in the image (D: a byte scan), are answered 1 at the call instead
export const GPIO_TP_READS = [[A(0x501E485A), 48], [A(0x501E4864), 49], [A(0x501E486E), 108], [A(0x501E4BBD), 49]], PIN_READ = A(0x5000297F);
export const GESTURES = new Map([[1, 'LIFTOFF'], [16, 'PRESS'], [32, 'CLICK'], [64, 'DCLICK'], [128, 'LONGPRESS'], [256, 'SLIDE'], [4096, 'FLICK']]);
export const BGDRAW = A(0x50B3DCCA), BGDRAW_CALLERS = [A(0x510C9A07), A(0x510C9CF5)];
export const CA_CALL = A(0x51084994), CA_TOUCH_EVENT = 35, CAFWD_CALLERS = [A(0x5124F6AE), A(0x5124F5CC)];
export const B7_GATE = A(0x603710F8), STATE_SHOOTING = 0x0108, SHOOT_PANEL = 10, DATE_PROMPT_PANEL = 324;
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
// the second reads of the module-9 tests that read the state twice, a 2 first and then a 3 or a 1 (D): ChangeOutline's
// at 0x50abcfe2 (menu.mjs TAKEOVER_READERS) and the application's in 0x50abb032 at 0x50abb044. S-TAKEOVER's 2 ends
// each test at its first read; the components' 0 (control camapp 3, 0x50ca4ae1) reaches the second (X: switch-scp's
// LV and eye switch; docs/hle-gaps/4.3.md 4.3.6)
const MODULE9_SECOND_READS = [MM.TAKEOVER_READERS[1], A(0x50ABB044)];
// S-USBCABLE: the module-9 readers the USB switch's code reaches (X, E143 2026-10-25: docs/hle-gaps/4.7.md 4.7, the
// inbound path in play) and the lab time a cable step runs
export const USB_MODULE9_READERS = [A(0x50ABB01D), A(0x50B7A2DE)], USB_SETTLE_MS = 1500;
// the further module-9 readers a plug reaches under control camapp 3, where module 9 is the components' 0 and the
// code goes past the first read (X, E143 2026-11-23/24: docs/hle-gaps/4.10.md 4.10.2, 4.10.4): the code filter's
// second read 0x50abb028, 0x50b7a2c4's second 0x50b7a2ee, the two of 0x50d78440.. (0x50d78459, 0x50d78469) and, once
// CA_MAIN's OLY_USB_CONNECTED handler issues PC_START_PC_USB_SELECT (S-USBHOST), 0x50abe6f0
export const USB_CMP_MODULE9_READERS = [A(0x50ABB028), A(0x50B7A2EE), A(0x50D78459), A(0x50D78469), A(0x50ABE6F0)];
// S-USBHOST (docs/hle-gaps/4.10.md 4.10.4, D unless tagged): the USB driver's state query 0x5102b555
// (isCommunicateUsbDevice's end, API 68118) builds {u8 cmd 8, u8 seq, u16 state} on its stack (`mov 8,d0; movbu
// d0,(4,sp)` at 0x5102b56d), sends it synchronously (0x5002e39d, the call at 0x5102b585) to the queue whose id is the
// halfword 0x60043362 (PC_PD_CMD_EXEC, 207 = fact api.pc_pd, S-MODACK's queue) and stores the request's +2 halfword
// into the state 0x62b2d9f4 (`movhu (6,sp),d1` at the return 0x5102b58c, `movhu d1,(0x62b2d9f4)` at 0x5102b590), 0
// where the send's status is not 0. The receiver, task 127 (entry 0x5102b2a4, the strings "PCPDC" and "USB
// SCPU_CONN"), dispatches command 8 to 0x5102b7fa, which passes the request to the sub-CPU (PER_SCPU command 0x40 from
// 0x5102b8f7, waiting on the flag 0x60043134 for the answer written into the request) and clears +2 when that fails
export const USB_STATE_CALL = A(0x5102B585), USB_STATE_RETURN = A(0x5102B58C), USB_STATE_CMD = 8;
export const USB_STATE_QUEUE_WORD = A(0x60043362), USB_STATE_WORD = A(0x62B2D9F4), USB_STATE_HOST = 1;
// S-TOUCHMAP: HFW status -> GUI touch kind, by name (I)
export const TOUCHMAP = new Map([[225, [1, 'TOUCH']], [226, [2, 'LONG TOUCH']], [227, [3, 'RELEASE']], [228, [4, 'TAP']],
  [230, [5, 'DOUBLE TAP']], [229, [6, 'SLIDE']], [300, [7, 'FLICK -> 7 (unnamed)']]]);
// S-TOUCHMAP's post: sendEvent's index of the GUI's touch message 0x9100, E143's 109 (D: its event map EV_MAP). The
// map's indices are per build: E137's, E142's, E140's, E125's, E130's and E133's lack E143's 107 and 108 (messages
// 0xf839, 0xf83a), so 0x9100 is their 107 and their 109 is 0x9201, which their GUI took without drawing anything
// (X). The session posts at the first index whose message is 0x9100 in the build's map (PlaySession.touch_index)
export const TOUCH_MESSAGE = 0x9100;
// M10B display switches: the GUI-busy note, H-EYESTATE / H-STOREFIRST addresses
export const GUI_BUSY_NOTE = 'e.g. Level Adjust -> Adjust: 0x5004ad13 sleeps for about 1 s while it takes 12 sensor samples';
// H-CHAINREST's slice and bound of lab time (PlaySession.chain_rest)
export const CHAIN_SLICE_NS = 1000000, CHAIN_LIMIT_NS = 200000000;
export const EYE_SET = A(0x50050EFD), EYE_STATE = { evf: 2, tft: 1 }, EYE_WORD = A(0xA32C1F44), EYE_CALLBACK = A(0xA32C1F48), EYE_TIMER = A(0xA32C1F4C);
// the property the eye callback's registration reads for the EVF's burn-in timer (docs/om1-vsc-spec.md section 9 item
// 10: armed only at 0) and, under control camapp 3, the one at whose 0 the application's eye handler asks for no
// output (X, native_switch; I: the EVF auto switch)
const EYE_SWITCH_PROPERTY = 1947;

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
// UI_IN key 0x120b (AEL/AFL): absent from E143's variant-0 matrix (only in variant 1), but present as a type-2 key in
// ported bodies' variant-0 tables (E147 group 1 byte 0 bit 3 polarity 0, EV_PRESS_CUSTOM6_KEY, D; also E144, E137, E148,
// E125, E139, E134). Wired by apply_uiin_layout on bodies whose tables hold it, staying not-wired on E143.
export const AEL_CODE = 0x120B;
CONTROLS.push(
  row('iso', 'ISO', 'key', [3, 2, 1, 0x1230, 2, 0], [null, null, null]),
  row('exp', 'Exposure compensation (+/-)', 'key', [3, 2, 0, 0x1209, 2, 0], [null, null, null]),
  row('drive', 'Drive / flash', 'key', [3, 3, 0, 0x1231, 2, 0], [null, null, null]),
  row('afmeter', 'AF / metering', 'key', [3, 4, 0, 0x1225, 2, 0], [null, null, null]),
  row('afon', 'AF-ON', 'key', [1, 0, 2, 0x000B, 2, 0], [null, null, null]),
  row('lvkey', '|o| button', 'key', [3, 1, 1, 0x2302, 2, 0], [null, null, null]),
  row('front1', 'Front upper button', 'key', [3, 3, 1, 0x1226, 2, 0], [null, null, null]),
  row('front2', 'Front lower button', 'key', [3, 4, 1, 0x1227, 2, 0], [null, null, null]),
  row('ael', 'AEL/AFL', 'key', null, [null, null, null], { bodykey: AEL_CODE, status: 'not-wired',
    reason: "0x120b is only in UI_IN's key matrix variant 1 (boards 1..7 by the board map 0x60224082); the lab's board 0 reads variant 0" }),
  row('bkt', 'BKT', 'none', null, [null, null, null], { status: 'not-wired',
    reason: "the key matrix (0x60224774) has no BKT key; BKT is a function a button can be given (button settings)" }),
);
CONTROLS.push(row('lock', 'Lock lever', 'none', null, [null, null, null], { status: 'not-wired', reason: 'the producer of 0x0202123d/0x0202123e is ?' }));
// The creative dial (the OM-3's front dial): UI_IN's position switch 0x1906, one code on several bits of a group of
// its own, one bit at its polarity per position, which E143's tables lack. A ported model whose tables hold it gets its
// positions (apply_uiin_layout: uiin is the first entry's, positions every entry's [group, byte, bit, polarity]); the
// value of an input is a position, from 0, in entry order. What each position selects is the body's own reading
// (MODELS creative_dial, with its evidence: E147's, a setting each turn sets natively); a body whose tables hold the
// code and whose MODELS entry names nothing has the dial decoded only (E122)
export const CREATIVE_DIAL_CODE = 0x1906;
CONTROLS.push(row('creative_dial', 'Creative dial', 'posswitch', null, [null, null, null], { posswitch: CREATIVE_DIAL_CODE, positions: null, labels: null,
  status: 'not-wired', reason: "0x1906 is not in E143's UI_IN tables" }));
// The OM-3's still / movie switch: UI_IN's position switch 0x1909, wired as the creative dial is, its positions named
// by the body's MODELS still_movie (E147's, with its evidence); a session starts it at the body's switch_idle position
export const STILL_MOVIE_CODE = 0x1909;
CONTROLS.push(row('still_movie', 'Still / movie switch', 'posswitch', null, [null, null, null], { posswitch: STILL_MOVIE_CODE, positions: null, labels: null,
  status: 'not-wired', reason: "0x1909 is not in E143's UI_IN tables" }));
// The PEN-F's two picture-function inputs (E122): UI_IN keys 0x122b and 0x122c, type 2 at polarity 0 in its group 1
// (byte 1 bits 2 and 3), whose EV names are EV_PRESS_ / EV_RELEASE_PICFUNCTION_LEFT and _RIGHT (D: the E122 image's
// tables, Tables.ev_name; analysis/oly-fw-analysis/README.md 8.4). E143's and E147's builds name the same events, and
// no table of theirs holds either code (X). A row of bodykey is wired by apply_uiin_layout where the body's tables hold
// the code, a key as any other (the camera application maps the code itself); what the camera does with the press is
// the body's own (not read here)
export const PICFUNCTION_CODES = [0x122B, 0x122C];
CONTROLS.push(
  row('picfn_left', 'Picture function left', 'key', null, [null, null, null], { bodykey: 0x122B, status: 'not-wired', reason: "0x122b is not in E143's UI_IN tables" }),
  row('picfn_right', 'Picture function right', 'key', null, [null, null, null], { bodykey: 0x122C, status: 'not-wired', reason: "0x122c is not in E143's UI_IN tables" }),
);
// The E-P7's Shortcut button (E142, top plate beside REC): UI_IN key 0x1224, type 2 at polarity 0 in its group 1 (byte
// 0 bit 6; REC 0x120a is bit 4), EV_PRESS_ / EV_RELEASE_CUSTOM7_KEY (D: the E142 image's tables, Tables.ev_name). A
// press from the shooting screen takes the GUI to SS_MENU_LV/ID_ST_PROFILE_SELECT_MENU, the Colour Profile page
// Caduceus E-P7's FILM_DOWN_CRASH.md names the Shortcut button's (X, test_shortcut.mjs). E144, E130, E140, E137,
// E148, E134, E125, E118 and E120 hold 0x1224 as a key too (EV_PRESS_CUSTOM7_KEY on each, X), wired there as here;
// which physical button it is on those bodies is not read. E142's other unnamed key, 0x1208 (EV_PRESS_CUSTOM_KEY,
// bit 5), has no row: a press of it from the shooting screen changed neither the GUI state nor the frame (X)
export const SHORTCUT_CODE = 0x1224;
CONTROLS.push(row('shortcut', 'Shortcut button', 'key', null, [null, null, null], { bodykey: SHORTCUT_CODE, status: 'not-wired', reason: "0x1224 is not in E143's UI_IN tables" }));
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
// the lens lock pin switch, whose release lets the lens power on (src/lab/lens.mjs)
export const LLPSW = 0x121C;
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
// Every type-2 entry of the body's UI_IN tables as [group, byte, bit, polarity], named by a control row or not
// (apply_uiin_layout sets it from the image; before that, E143's CONTROLS and CODE0_KEYS, which are its tables' type-2
// entries, X: test_keyidle). idle_images releases each one (bit != polarity). Until 2026-11-22 only the entries a
// control row names were released, and an unnamed one kept bit 0, its pressed level at polarity 0, from the session's
// start (FIDELITY-NOTES 7.7: E122's 0x122b / 0x122c, E147's 0x120b, one to nine on twelve other ported bodies)
export const TYPE2_KEYS = [...UIIN_ENTRIES.values()].filter((e) => e[4] === 2).map(([g, b, bit, , , pol]) => [g, b, bit, pol])
  .concat(CODE0_KEYS.map(([g, b, bit]) => [g, b, bit, 0]));
export const MONITOR_OPEN = [1, 0, 4];

// Tables: the firmware's EV names, code -> EV translations, switch table, GUI message names (cached per image)
const TABLES = new WeakMap();
export class Tables {
  static of(image) { let t = TABLES.get(image); if (!t) TABLES.set(image, t = new Tables(image)); return t; }
  constructor(image) {
    this.image = image;                              // (the key matrix of /api/controls' position switches, playapi.mjs)
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
// 0..9, polarity 1; a ported model's are its own, apply_uiin_layout), and what each position is (names, below)
export const MODE_DIAL = { group: 2, positions: Array.from({ length: 10 }, (_, k) => [k >> 3, k % 8, 1]), names: [] };
// What a mode-dial position is: UI_IN's dial query answers position k with the k-th code of its dial table, the build
// names the codes (fact mode_dial, src/fw/facts.mjs modeDial, D) and the application takes the code as its mode (X).
// E143's ten positions are S, M, B, MY_MODE1..4, MOVIE, P, A. On the page: P, A, S, M and B as named, MY_MODEn as Cn
// (the dial's custom positions C1..C4: E143's shooting screen shows P with C1..C4 there, X), MOVIE as Movie and the
// other bodies' I_AUTO, ARTFILTER and SCENE_NAVIGATION as the dial labels iAUTO, ART and SCN (I); any other name as the
// build has it, and a code the build does not name (or a position past the table's run) as "position k". Which way
// round the positions lie on the body and whether the dial turns past its ends is not in the firmware (?): the page
// steps them in entry order, wrapping.
const MODE_LABELS = { MOVIE: 'Movie', I_AUTO: 'iAUTO', ARTFILTER: 'ART', SCENE_NAVIGATION: 'SCN' };
export const mode_label = (name) => MODE_LABELS[name] ?? name.replace(/^MY_MODE(\d)$/, 'C$1');
// [{code, name, label}] of each position, the codes read from the dial table in the run-time image v
export function mode_dial_names(v, n) {
  const dial = fact('mode_dial', MODE_DIAL_E143), names = new Map(dial.names);
  let run = dial.table !== null;                     // (none: no reader in the build) the table's run ends at its first 0
  return Array.from({ length: n }, (_, k) => {
    const code = run ? v.u32(dial.table + 4 * k) : null;
    if (code === 0) run = false;
    const name = run ? names.get(code) ?? null : null;
    return { code: run ? code : null, name, label: name === null ? `position ${k}` : mode_label(name) };
  });
}
// a ported model's other position switches (one code on several bits, one bit at its polarity per position, like
// E147's 0x1909 and its creative dial 0x1906): [[group, byte, bit, polarity] of the idle position], set in the idle
// image. The idle position is the second: on E147 the first makes S2 ask for the dial to be turned (X). The creative
// dial (CONTROLS creative_dial) starts there too unless the session asks for another position (opts.creative_dial);
// on E147 the second is COLOR (src/fw/models.mjs creative_dial). A body's MODELS entry can name another idle
// position for a code (switch_idle): E147's 0x1909 is its still / movie switch, whose first two positions the
// application takes for movie mode (src/fw/models.mjs switch_idle; docs/hle-gaps/4.1.md 4.1.13), so it starts at the
// third; its positions change neither the picture-mode family nor the screen (X)
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
// SCPU port scan's, reported through that producer (docs/hle-gaps/4.7.md 4.7, the 0x88 reply), which does not run, and the
// lab's level would be undone by the producer's next push (X: E146, E147). So the E143 family keeps 0x0400 at state
// 0, as E143's own idle image above does; its starts publish no USB connection (X). State 0 is a cable in there too
// (the sub-CPU's PC13 low, D: docs/hle-gaps/4.10.md 4.10.2), the default (USB_IDLE 'in'); E143's start with no cable
// takes the state from the port scan through UI_IN's own init (USB_IDLE 'out', 4.10.3). The
// composite video cable 0x0500 (the E118 family's; its switch-table names EV_CONPOSITE_CONNECTED for state 0 and
// _DISCONNECTED, D) with no cable (state 1): at state 0 E122's application took the composite output as connected
// (getCompositeState: the switch query on 0x0500, docs/model-survey.md finding 31, D), so its output choice answered
// VIDEO where the GUI had the TFT, and it asked the GUI for an output change after every panel refresh, for good (X)
export const IDLE_SWITCH_STATES = [[0x000C, 0], [0x0400, 1], [0x0500, 1]], PRODUCER_CODE = 0x0501;
export const STATE_SWITCHES = [];             // [[group, byte, bit, level]] of IDLE_SWITCH_STATES, apply_uiin_layout
// The dial's position at the session's start: P's (position 0 where the build names no P). The start takes its mode
// from the store, P on the blank store (setting 24 MODE_EXPOSE 3, the P screen; X), and no changeMode runs before the
// first input although the application polls the dial from the start (X); the GUI's dial handler calls the changeMode
// API (0x10216: 0x50b4e4cc -> the user-setting manager's 0x50b7b01c, whose other caller 0x50b7bc72 is not on the
// start's path; D). UI_IN's first scan decodes the dial at the bring-up, before the application exists. With the dial
// at position 0 (S) under the P screen the application acted on the mismatch at an Fn lever change: three changeMode
// calls to S, the menu closed (X, golden's inputs scenario). Whether the camera's start reads the dial (and a store
// saved at another mode, S-NVRAM's, then starts there) is ?
export function mode_start() {
  const k = MODE_DIAL.names.findIndex((p) => p.name === 'P');
  return k < 0 ? 0 : k;
}
// The Fn lever at the session's start (E143): UI_IN's state 1 of 0x1223, API_LEVER_SW_1, the first of the lever's two
// positions (docs/hle-gaps/4.3.md 4.3.8; D unless tagged). The lever read 0x50abdd4b answers 0 for that state and 1 for any
// other, and the shell's enum names 0 API_LEVER_SW_1 and 1 API_LEVER_SW_2; as a power switch (property 15260 at 1, the
// menu's "ON/OFF") the switch table gives SW_1 EV_POWER_SW_ON and SW_2 EV_POWER_SW_OFF. The firmware has no default
// for a lever, but its factory store reads as the store of a camera at SW_1 (I): with the factory lever function
// (534 = 4, the menu's mode2, "Switches AF mode/AF target mode/AF target point according to Fn lever position", X)
// the start's initLeverSwitch writes MODE_AF_CHANGE (535) from the lever, 0 at SW_1 and 1 at SW_2, and the store's
// default is 0, the S-AF bank (MODE_FOCUS_STILL 0; SW_2's bank MODE_FOCUS_AF_CHANGE_STILL is 2, MF, X). Until
// 2026-11-11 the idle image left the bit 0 with every other switch bit, the state of every lab before M10 and no
// decision about the lever: SW_2, where a camera with that store starts in MF (X: control camapp 3 did) while the
// default session showed S-AF (the gate's refusal, not the lever) and ran an AF at S1. A ported model's lever keeps
// bit 0: what its start makes of the lever is not read.
// The TAKE probe's sessions (--take probe) start at API_LEVER_SW_2 instead, the lever every result of the probe was
// measured at before its position was known to matter (docs/hle-gaps/4.1.md 4.1.10, docs/hle-gaps/4.2.md 4.2.3, docs/hle-gaps/4.2.md 4.2.5): MF under control
// camapp 3, where TAKE_MAIN's take-ready runs with no request to TAKE_FOCUS and ends (RdyFcsRdy3, event 794), while
// at API_LEVER_SW_1 it waits for an AF the lab's TAKE_FOCUS does not finish (RdyFcsRdy1, pending 0x5b, X: 4.3.8)
export const LEVER_IDLE_STATE = 1, LEVER_PROBE_STATE = 0;
// the lever's bit of group images at a state: state 0 is the bit at its polarity
function set_lever(imgs, state) {
  const [g, b, bit, , , pol] = BY_ID.get('lever').uiin;
  set_bit(imgs[g], b, bit, state === 0 ? pol : 1 - pol);
}
// the dial group's image at position k: k's bit at its polarity, every other position's at the other value
export function mode_image(k) {
  const img = new Uint8Array(GROUP_BYTES[MODE_DIAL.group]);
  MODE_DIAL.positions.forEach(([b, bit, pol], i) => set_bit(img, b, bit, i === k ? pol : 1 - pol));
  return img;
}
// H-STARTKEY's site in USTART5 (E143 0x501ea096): `mov code,d0` (2c lo hi), the call of UI_IN's key state read
// (dd rel32 ...), `extbu d0` (14), `mov d0,a1` (f1 e1), `mov 0,a0` (90 00), `clr d1` (04), `mov kind,d0` (2c lo hi),
// the call of the camera state write (dd rel32 ...): {code, key_state, kind, write, read}, or {why} where the port
// does not place the site or its bytes differ. read is the camera state read 0x500417da(kind, index)
export const START_KEY_SITE = A(0x501EA096), STATE_READ = A(0x500417DA);
export function startKeySite(v) {
  if (isUnmapped(START_KEY_SITE)) return { why: 'the port does not place USTART5\'s MENU state step (E143 0x501ea096)' };
  if (isUnmapped(STATE_READ)) return { why: 'the port does not place the camera state read (E143 0x500417da)' };
  const at = runtime(START_KEY_SITE), b = (k) => v.u8(at + k);
  const want = [[0, 0x2c], [3, 0xdd], [10, 0x14], [11, 0xf1], [12, 0xe1], [13, 0x90], [14, 0x00], [15, 0x04], [16, 0x2c], [19, 0xdd]];
  const bad = want.find(([k, x]) => b(k) !== x);
  if (bad) return { why: `USTART5's MENU state step at ${h8(START_KEY_SITE)}: byte +${bad[0]} is 0x${b(bad[0]).toString(16)}, not 0x${bad[1].toString(16)}` };
  const target = (k) => (START_KEY_SITE + k + (v.u32(at + k + 1) | 0)) >>> 0;
  return { code: v.u16(at + 1), key_state: target(3), kind: v.u16(at + 17), write: target(19), read: STATE_READ };
}
// S-KEYBITS idle image.
export function idle_images() {
  const imgs = GROUP_BYTES.map((n) => new Uint8Array(n));
  for (const [g, b, bit, pol] of TYPE2_KEYS) set_bit(imgs[g], b, bit, 1 - pol);
  for (const [g, b, bit] of CODE0_KEYS) set_bit(imgs[g], b, bit, 1);
  set_bit(imgs[MONITOR_OPEN[0]], MONITOR_OPEN[1], MONITOR_OPEN[2], 1);
  if (ON_LAB_MODEL) set_lever(imgs, LEVER_IDLE_STATE);
  imgs[MODE_DIAL.group].set(mode_image(mode_start()));
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
  TYPE2_KEYS.splice(0, TYPE2_KEYS.length, ...groups.flatMap(({ entries }, g) => entries.filter((e) => e[3] === 2).map(([b, bit, , , pol]) => [g, b, bit, pol])));
  if (ON_LAB_MODEL) {
    const same = groups.length === GROUP_BYTES.length && groups.map((x) => x.bytes).join() === GROUP_BYTES.join() && live.join() === GROUP_LIVE.join() &&
      dial.group === MODE_DIAL.group && dial.positions.join() === MODE_DIAL.positions.join() &&
      code0.join() === CODE0_KEYS.join() && monitor.join() === MONITOR_OPEN.join() &&
      CONTROLS.every((c) => !c.uiin || c.uiin[3] === MODE_DIAL_CODE || c.uiin[3] === 0 || (at.get(c.uiin[3]) ?? []).join() === c.uiin.join());
    if (!same) throw new PlayError('UI_IN tables: the E143 image is not the key matrix of CONTROLS');
    MODE_DIAL.names = mode_dial_names(imageView(image, IMAGE_BASE, MODEL), MODE_DIAL.positions.length);
    LAYOUT_APPLIED = true;
    return;
  }
  GROUP_BYTES.splice(0, GROUP_BYTES.length, ...groups.map((x) => x.bytes));
  GROUP_LIVE.splice(0, GROUP_LIVE.length, ...live);
  Object.assign(MODE_DIAL, dial);
  const byCode = new Map();
  groups.forEach(({ entries }, g) => entries.forEach(([b, bit, code, typ, pol]) => { if (code && code !== MODE_DIAL_CODE && typ === 1) { if (!byCode.has(code)) byCode.set(code, []); byCode.get(code).push([g, b, bit, pol]); } }));
  const idle = MODEL_INFO.switch_idle ?? {};
  for (const [code, k] of Object.entries(idle)) {
    const l = byCode.get(Number(code));
    if (!l || l.length < 2 || !(k >= 0 && k < l.length)) throw new PlayError(`UI_IN tables: src/fw/models.mjs switch_idle names position ${k} of 0x${fx(Number(code), 4)}, which ${MODEL}'s tables hold ${l?.length ?? 0} of`);
  }
  POSITION_SWITCHES.splice(0, POSITION_SWITCHES.length, ...[...byCode].filter(([, l]) => l.length > 1).map(([code, l]) => l[idle[code] ?? SWITCH_IDLE_POSITION]));
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
  for (const c of CONTROLS) {                      // the position switches (creative_dial, still_movie): wired where the body names them
    if (!c.posswitch) continue;
    const l = byCode.get(c.posswitch), named = MODEL_INFO[c.id]?.labels ?? null;
    if (!l || l.length < 2) { c.reason = `0x${fx(c.posswitch, 4)} is not in ${MODEL}'s UI_IN tables`; continue; }
    if (named && named.length !== l.length) throw new PlayError(`${c.name}: src/fw/models.mjs names ${named.length} positions, ${MODEL}'s UI_IN tables hold ${l.length}`);
    Object.assign(c, { uiin: at.get(c.posswitch), positions: l, labels: named ?? l.map((_, k) => `position ${k}`), status: named ? 'wired' : 'decoded',
      reason: named ? null : `UI_IN decodes it natively; what each position selects is not read on ${MODEL}` });
  }
  for (const c of CONTROLS) {                      // the keys only some bodies have (picfn_left, picfn_right)
    if (!c.bodykey) continue;
    const e = at.get(c.bodykey);
    if (e && e[4] === 2) Object.assign(c, { uiin: e, status: 'wired', reason: null });
    else c.reason = e ? `0x${fx(c.bodykey, 4)} is of type ${e[4]}, not a key (2), in ${MODEL}'s UI_IN tables` : `0x${fx(c.bodykey, 4)} is not in ${MODEL}'s UI_IN tables`;
  }
  for (const c of CONTROLS) if (c.uiin && c.uiin[3] !== MODE_DIAL_CODE) UIIN_ENTRIES.set(c.uiin.slice(0, 3).join(','), c.uiin);
  MODE_DIAL.names = mode_dial_names(imageView(image, IMAGE_BASE, MODEL), MODE_DIAL.positions.length);
  LAYOUT_APPLIED = true;
}
// True when the code at site (disassembly address) is a 7-byte `call d32` (0xdd) of target.
export function is_call_to(image, site, target) {
  const o = site - 0x50000000;
  return image[o] === 0xDD && ((site + (image[o + 1] | image[o + 2] << 8 | image[o + 3] << 16 | image[o + 4] << 24)) >>> 0) === target;
}
// the 5-byte form, `call d16,[regs],imm8` (0xcd)
export function is_call16_to(image, site, target) {
  const o = site - 0x50000000;
  return image[o] === 0xCD && ((site + ((image[o + 1] | image[o + 2] << 8) << 16 >> 16)) >>> 0) === target;
}

export class PlayError extends FirmwareError {}

const bracketState = () => ({ calls: 0, pairs: 0, open: null, bad: null, closed_last: null, last: [] });

// NavLab + the play observers and stand-ins (installed by PlaySession.play_bring_up, not in the constructor).
// S-HEAP's opt-in fill (OM_HEAP_FILL=HEX, opts.heap_fill; off by default): a word, written over every block S-HEAP hands
// out and every block it takes back. S-HEAP's new blocks come from memory nothing else used, so a field the code never
// set reads 0 in the lab, where the camera's heap hands out whatever the block held before (a freed block's old contents);
// code that reads such a field runs on in the lab and fails on the camera. With a fill like 0xdeadbeef (odd and in no
// mapped range) a pointer or a code address read from such a field faults at its first use, and a use after free reads
// the fill. The fill is the lab's, not the camera's: it shows that a read of unset memory happens, not what the camera
// reads there. Returns 64 KiB of the word (little-endian), or null when off
export function heapFill(v) {
  if (v === undefined || v === null || v === '' || v === 'off') return null;
  const t = String(v).replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,8}$/i.test(t)) throw new PlayError(`heap fill ${v}: a 32-bit word in hex (e.g. deadbeef) or off`);
  const w = parseInt(t, 16) >>> 0, buf = new Uint8Array(0x10000);
  for (let k = 0; k < buf.length; k += 4) { buf[k] = w & 0xFF; buf[k + 1] = (w >>> 8) & 0xFF; buf[k + 2] = (w >>> 16) & 0xFF; buf[k + 3] = w >>> 24; }
  return buf;
}

export class PlayLab extends N.NavLab {
  // H-GUIBYAPP: in a play session the camera application creates the GUI at its start, as on the camera; the lab's
  // bring-up does not (two GUIs, the lab's idle one holding a root of output 0 and one of OSD layer 1's two buffers).
  preinit(opts) { super.preinit(opts); this.gui_by_app = true; }
  // H-TPINIT: the boot calls the touch init before the display opens (E143 from 0x50024ca6, E144 from 0x500251a8, D);
  // the lab calls it in the play bring-up, after the start's open, except on a build whose touch driver waits for its
  // controller's INT (fact touch_int, src/fw/facts.mjs touchIntWait: the E144 and E118 families), where it runs before
  // the open (touch_init_early, a session with touch). There the order matters: the open's command list powers the
  // panel up, waits for the INT and arms the driver for the INT's data (E144 0x50181efb, the wait 0x5018a924, then
  // 0x5018a9a4 sets 0x620c6630), which the init's driver set-up clears (0x5018a7e7, 0x5018a81b..0x5018a826, D): called
  // after the open it left the driver dropping every report (the touch task's 0x5018af2b, X). On the E118 family the
  // open posts the touch task's power-up command (cmd 4, S-TPSEND below) to the queue the init joins to the task's
  // flag: on E118, whose list waits for the INT inline, the init after the open left the message unseen and the driver
  // unarmed (X, docs/model-survey.md finding 88). On E143 the open runs no touch
  // code and the order changes nothing the touch path reads; moved there too, it changed 28 golden sessions' stops and
  // replay outcomes (X), so E143 keeps the lab's order. The touch task's start stays in the play bring-up, and the
  // panel's open (H-TPSTART) there only where H-TPINIT keeps the lab's order (touch_bring_up)
  kernel_display(device = 'tft', ctors = true, before_open = null) {
    super.kernel_display(device, ctors, () => {
      if (before_open) before_open();
      if (this.touch_init_early) this.step(H_TPINIT, () => this.call(TOUCH_INIT, null, null, null, 20000));
    });
  }
  play_init(opts) {
    this.opts = opts;
    this.uiin_codes = []; this.uiin_decoded = []; this.gestures = []; this.tp_status = []; this.cafwd = [];
    this.bgdraw = new Tally();
    this.tp_image = new Uint8Array(11);
    this.tp_touch = { action: 'up', x: 0, y: 0 };      // the touch S-TPREG's controller answers from (PlaySession.touch)
    this.tp_flip = true;
    this.tp_slave = null;                              // the slave of the controller the driver last read
    this.tp_reads = [];
    this.status_gesture = new Map();
    this.observe(UI_IN_POST, (lab, r) => lab.uiin_decoded.push([lab.step_tag, r.d0]), 'obs-uiin-post');
    for (const { at, reg } of uiInForward()) this.observe(at, (lab, r) => lab.uiin_codes.push([lab.step_tag, r[reg]]), 'obs-uiin-fwd');
    this.uiin_direct = new Tally();
    this.observe(UI_IN_POST_EXT, (lab, r) => this._uiin_post_ext(lab, r), 'obs-uiin-post-ext');
    this.heap_sizes = new Map();
    this.heap_owner = new Map();                       // block -> [malloc's caller (disassembly), task id]
    this.heap_free = new Map();
    this.heap_stats = new Tally();
    this.heap_fill = heapFill(opts.heap_fill ?? globalThis.process?.env?.OM_HEAP_FILL);
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
    this.dispq_sends = [...DISPQ_SEND_RETURNS];      // dispq_accept adds to them
    // S-DISPQ's queue (dispq.mjs; task_message, _s_dispq, _sync_send): a post to the DISPLAY queue while a DISPLAY run
    // is open is kept for the run's end, and another task's synchronous send in that time runs natively, its post kept
    // and its task waiting for the reply; dispq_open is the S-DISPQ run whose record takes the replies. The
    // dispq-at-once mutant is the lab's discipline before it (another task's send run at once inside the open run, a
    // post there refused)
    if (!is_call16_to(image, SYNC_SEND_POST_RETURN - 5, OLYQEWR)) throw new PlayError(`S-DISPQ: ${h8(SYNC_SEND_POST_RETURN)} does not follow a 5-byte call of OlyQeWr ${h8(OLYQEWR)}`);
    this.dq = ['no-dispq', 'dispq-at-once'].includes(opts.mutant) ? null : new DisplayQueue();
    this.dispq_open = null;
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
  // one more asynchronous DISPLAY request S-DISPQ runs: the send that returns to ra (disassembly notation), a 7-byte
  // call of OlyQeWr (camapp.mjs: the histogram's end, DISPLAY cmd 16, under control camapp 3)
  dispq_accept(ra) {
    if (!is_call_to(this.image, ra - 7, OLYQEWR)) throw new PlayError(`S-DISPQ: ${h8(ra)} does not follow a 7-byte call of OlyQeWr ${h8(OLYQEWR)}`);
    if (!this.dispq_sends.includes(ra)) this.dispq_sends.push(ra);
  }
  // A DISPLAY run is open while the DISPLAY loop runs a message (dispq.mjs), on the task the run is on; at the end of
  // the outermost one S-DISPQ runs the messages kept in it, in their order (_dispq_run)
  task_message(loop, queueAddress, msg, label, ...rest) {
    if (loop !== D.DISPLAY_LOOP || !this.dq) return super.task_message(loop, queueAddress, msg, label, ...rest);
    const task = this.lt?.tid != null ? this.lt.current() : null;
    return this.dq.run(task, () => super.task_message(loop, queueAddress, msg, label, ...rest), (m) => this._dispq_run(m));
  }
  // one S-DISPQ run: the request posted with no DISPLAY run open, or a message kept (m.kept: the post's step, task and
  // return address)
  _dispq_run(m) {
    const rec = { step: this.step_tag, cmd: m.words[2], words: m.words.map((w) => '0x' + w.toString(16)), replies: [] };
    if (m.kept) rec.kept = m.kept;
    this.dispq.push(rec);
    const outer = this.dispq_open;
    this.dispq_open = rec;
    try { this.task_message(D.DISPLAY_LOOP, D.DISPLAY_QUEUE, m.msg, `S-DISPQ DISPLAY cmd ${m.words[2]}`); } finally { this.dispq_open = outer; }
    // the run opened the HDMI device (E143, cmd 45; the opened word's HDMI part): its channel runs from here on at the
    // format table's timing (DisplayLab.hdmi_line), before anything waits on its vsync (X: under control camapp 3 the
    // GUI's setOutputType waits on channel 0's vsync, 0x501de81d, in the step that opened it; docs/hle-gaps/4.9.md 4.9.3).
    // The run ends inside a lab call (S-MODACK's reply, S-OUTDEV's dispatch): hdmi_line's getters take the free
    // nested-run slot then
    if (this.hdmi && MODEL === 'E143' && !this.line_ns.has('hdmi') && (this.sim.u32(D.OPENED_WORD) & D.HDMI_MASK)) {
      rec.hdmi_line = this.hdmi_line(this.sim.u32(D.OPENED_WORD) & D.HDMI_MASK);
    }
  }
  _s_dispq(hle, r) {
    const q = r.d0 & 0xFFFF, ra = disasm(r.mdr);
    const open = this.dq?.open ?? false, request = this.dispq_sends.includes(ra), sync = ra === SYNC_SEND_POST_RETURN;
    if (q === this.display_queue && ((request && (this.depth === 0 || open)) || (sync && open))) {
      const [p, n] = unpack('<II', this.sim.read(r.a0, 8));
      if (n !== 16) throw new PlayError(`S-DISPQ: a ${n}-byte DISPLAY message from ${where(r.mdr)}`);
      const msg = Uint8Array.from(this.sim.read(p, n)), words = unpack('<4I', msg);
      // posted while a DISPLAY run is open: kept for the run's end, as the DISPLAY task's queue keeps it (dispq.mjs)
      if (open) this.dq.post({ msg, words, kept: { step: this.step_tag, task: this._tsnd_task(), from: h8(ra) } });
      else this._dispq_run({ msg, words });
      hle.finish(r, { d0: 0 });
      return;
    }
    if (q === APP_QUEUE && this.dispq_returns.includes(ra) && this.depth > 0) {
      const [p, n] = unpack('<II', this.sim.read(r.a0, 8));
      const msg = Uint8Array.from(this.sim.read(p, n));
      const reply = { step: this.step_tag, queue: q, msg: bytesHex(msg), caller: h8(ra) };
      this.dispq_replies.push(reply);
      if (this.dispq_open) this.dispq_open.replies.push(reply);
      // where the camera application runs its event task reads queue 6, and the reply goes there after the step
      // (camapp.mjs, S-DISPQ's replies)
      if (this.dispq_deliver) this.dispq_deliver.push({ q, msg });
      hle.finish(r, { d0: 0 });
      return;
    }
    if (q === this.display_queue) {
      throw new PlayError(`OlyQeWr to the DISPLAY queue from ${where(r.mdr)} (depth ${this.depth}): not the asynchronous request S-DISPQ stands in for`);
    }
    this._qewr_prev[0](hle, r);
  }
  // blocked sends, by the calling task and the call site: a task makes one such call at a time, and tasks share the
  // sites (OlyQeWr's). Keyed by the site alone, a later call from another task named its queue in the blocked call's
  // record: the OXF main thread's send to PLAY_EXEC was reported as one to queue 6, the queue of UI_IN's key posts
  // through the same site (X, docs/hle-gaps/4.3.md 4.3.2)
  _tsnd_task() { return unpack('<H', this.sim.read(this.sim.u32(this.nk.kcb(96)) + K.TCB_ID, 2))[0]; }
  _tsnd_entry(lab, r) {
    if (r.a1 !== 0xFFFFFFFF) return;
    const ra = r.mdr, task = this._tsnd_task(), key = `${task}:${ra}`;
    if (!TSND_SITES.includes(disasm(ra) - 7)) throw new PlayError(`tsnd_dtq(queue ${r.d0 & 0xFFFF}, timeout -1) from ${where(ra)}: not a known call site`);
    this.tsnd_pending.set(key, (this.tsnd_pending.get(key) ?? 0) + 1);
    this.tsnd_info.set(key, [r.d0 & 0xFFFF, this.step_tag, ra, task]);
  }
  _tsnd_return(lab, r) {
    const key = `${this._tsnd_task()}:${r.pc}`;
    if (this.tsnd_pending.get(key)) this.tsnd_pending.set(key, this.tsnd_pending.get(key) - 1);
  }
  blocked_sends() {
    const out = [];
    for (const [key, n] of this.tsnd_pending) {
      if (n > 0) { const [q, step, ra, task] = this.tsnd_info.get(key); out.push([q, where(ra), step, task]); }
    }
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
  // the opt-in fill (OM_HEAP_FILL, opts.heap_fill): the block's bytes, the word repeated, at malloc and at free
  _heap_fill(a, size) {
    const f = this.heap_fill;
    for (let k = 0; k < size; k += f.length) this.sim.write(a + k, size - k >= f.length ? f : f.subarray(0, size - k));
  }
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
    if (this.heap_fill) this._heap_fill(a, size);
    // who allocated it: malloc's caller and the running task's id (the kernel's current TCB, its id at +16)
    this.heap_owner.set(a, [disasm(r.mdr), this.nk ? unpack('<H', this.sim.read(this.sim.u32(this.nk.kcb(96)) + K.TCB_ID, 2))[0] : null]);
    hle.finish(regs, { a0: a });
  }
  _s_free(hle, r) {
    const a = r.a0;
    const size = this.heap_sizes.get(a);
    if (size !== undefined) {
      if (this.heap_fill) this._heap_fill(a, size);
      this.heap_sizes.delete(a);
      this.heap_owner.delete(a);
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
  // The GUI's touch answer to the camera application, natively (a session whose application forwards the touches
  // itself, PlaySession.app_touch): recorded as S-CAFWD records it, and passed on
  _obs_cafwd(lab, r) {
    const [ev, ...params] = unpack('<5I', this.sim.read(r.a1, 20));
    if (ev === CA_TOUCH_EVENT) this.cafwd.push({ step: this.step_tag, event: ev, param: params[0], params, caller: h8(disasm(r.mdr)) });
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
    // S-DISPQ's queue: another task's synchronous DISPLAY send while a DISPLAY run is open (task 168's cmd 4 or 17 in
    // the OXF main thread's cmd 15, docs/hle-gaps/4.1.md 4.1.9) runs natively, as on the camera: S-DISPQ keeps its post
    // and its task waits for the reply, which the kept message's run sends to the send's queue. Run at once (the
    // lab's synchronous send) it ran inside the other command's run and its task went on to post before that command
    // ended (X). The run's own task's sends (a handler's) stay the lab's
    const task = this.lt?.tid != null ? this.lt.current() : null;
    if (this.dq?.open && (r.d0 & 0xFFFF) === this.display_queue && task !== null && !this.dq.runs_on(task)) {
      this.kernel.events.push(['send', `queue ${r.d0 & 0xFFFF} cmd ${r.d1} (S-DISPQ, kept)`, `param 0x${r.a0.toString(16)}`, where(r.mdr)]);
      this.display_sends.push([r.d1, r.a0 ? this.sim.read(r.a0, 16) : new Uint8Array(0), disasm(r.mdr)]);
      this.passthrough(r);
      return;
    }
    if (TOUCH_QUEUE === null || !this.in_display_run() || (r.d0 & 0xFFFF) !== this._queue(TOUCH_QUEUE.queue)) return super._sync_send(hle, r);
    const saved = { ...r };
    this.kernel.events.push(['send', `queue ${r.d0 & 0xFFFF} cmd ${r.d1}`, `param 0x${r.a0.toString(16)}`, where(r.mdr)]);
    (this.tp_sends ??= []).push([r.d1, h8(disasm(r.mdr))]);
    this.task_message(TOUCH_TASK, TOUCH_QUEUE.queue, pack('<IIII', 0, 0, r.d1, r.a0), `touch cmd ${r.d1}`, undefined,
      { flag: TOUCH_QUEUE.flag, bit: TOUCH_QUEUE.bit });
    if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    hle.finish(saved, { d0: 0 });
  }
  // S-TPSEND, asynchronous: a message OlyQeWr puts on the touch task's queue from a task (not a display run) while the
  // touch task does not run in the lab (before H-TPINIT, or on a body whose touch panel is not modelled, MODELS touch
  // false) runs the touch task's loop for it on a lab stack in the same way, its own word 0 naming the reply queue;
  // OlyQeWr returns 0. Natively the touch task, which the boot chain starts before the display opens (E122
  // 0x50186200..0x5018620e, D), takes it. A display run's message is queued natively as before: E122's and E118's opens
  // put cmd 4 there (E122 0x50302973..), and the queue's one slot holds it; with the touch panel modelled (since
  // 2026-11-10 on the family) the touch task takes it natively, E118's power-up list with S-TPINTWAIT, the
  // controller's version (src/lab/touchpanel.mjs) and S-TPREGLIST (src/lab/display.mjs); run before through this
  // stand-in, E118's list downloaded the controller's firmware, logged "TP BOOTLOAD ERROR" and left the touch task
  // waiting for good (X, docs/model-survey.md findings 85 to 87). On E122's EVF the application's
  // Set_Touch_Panel_Ctrl_Area (API 0xd001f, 0x502f4c28 -> 0x5030bda9) then sends cmd 8, TP_SET_CTRL_AREA, which waited
  // for good on the full queue (X). It wraps OlyQeWr's routing (menu.mjs route_rtos), so it holds from the start on
  route_rtos() {
    super.route_rtos();
    if (TOUCH_QUEUE === null) return;
    this.wrap(OLYQEWR, (prev) => (hle, r) => (this.touch_native || this.in_display_run() || (r.d0 & 0xFFFF) !== this._queue(TOUCH_QUEUE.queue) ? prev(hle, r) : this._tpsend_async(hle, r)));
  }
  _tpsend_async(hle, r) {
    const saved = { ...r }, [p, n] = unpack('<II', this.sim.read(r.a0, 8));
    if (n !== 16) throw new PlayError(`S-TPSEND: a ${n}-byte message to the touch task's queue from ${where(r.mdr)}`);
    const msg = this.sim.read(p, n), cmd = unpack('<I', msg.subarray(8, 12))[0];
    this.kernel.events.push(['send', `queue ${r.d0 & 0xFFFF} cmd ${cmd} (asynchronous)`, `param 0x${unpack('<I', msg.subarray(12, 16))[0].toString(16)}`, where(r.mdr)]);
    (this.tp_sends ??= []).push([cmd, h8(disasm(r.mdr))]);
    this.task_message(TOUCH_TASK, TOUCH_QUEUE.queue, msg, `touch cmd ${cmd}`, undefined, { flag: TOUCH_QUEUE.flag, bit: TOUCH_QUEUE.bit });
    if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    hle.finish(saved, { d0: 0 });
  }
  // S-TPREG: the touch driver's I2C read answered by the controller at the slave it reads (src/lab/touchpanel.mjs:
  // E143's at 0x70, E144's lineage's at 0x48) from the session's touch; a register the model does not hold, or another
  // slave, reads 0
  _s_tpreg(hle, r) {
    const n = D.tpLength(this, r, 'read'), slave = r.d0 & 0xFF, addr = D.tpAddr(r), c = TOUCH_CONTROLLERS.get(slave);
    const data = c?.read(addr, n, this.tp_touch, MODEL_INFO.panels.tft[1], this.tp_flip) ?? new Uint8Array(n);
    if (c) this.tp_slave = slave;
    this.sim.write(r.a0, data);
    this.tp_reads.push([slave, addr, n, bytesHex(data), h8(disasm(r.mdr))]);
    this.i2c.push(['R', slave, addr, n]);
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
    if (isUnmapped(CTRL_OR)) { this.brackets = null; return; }   // no CTRL3 OR placed (src/lab/menu.mjs B2 observers): no brackets
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
  // Before the firmware opens the device itself (control camapp 3's display switch, PlaySession.native_switch): the
  // A15 bracket record of its channel starts again, as at the lab's own OPEN. No DISPLAY command of the lab's.
  native_open_begin(device) {
    if (this.brackets !== undefined && this.brackets !== null) this.brackets.set(lookup(D.DEVICE, device).channel, this.constructor._bracket_state());
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
  // (write index *, read index *, ring, bit) of ring [target][core] from the image's table (D): 16-byte descriptors,
  // one row per CPU, so its base moves 16 x the body's CPU count per target (E143's 4: 64; the E144 family's 3: 48,
  // E148's post 0x600563b2 `mul 48,d1` then `mov 0x6007b03c,a0`; E147's 4: 64).
  ipi_desc(target, core) {
    const b = this.sim.read(IRQ.IPI_DESC + 16 * fact('kernel.cpus', 4) * target + 16 * core, 13);
    return [...unpack('<III', b.subarray(0, 12)), b[12]];
  }
  // S-CPU2: at the return of the GUI's post to CPU 2, serve exactly the allow-listed post as CPU 2's task 0x200e would
  // (ack, drain, command 3, reply through ring [0][2] and bank-0 bit 0x20); anything else is an error.
  _s_cpu2(lab, r) {
    const intc = this.nk.intc;
    this.xcpu_waiting += 1;
    // --cpu2 native (cpu2.mjs): CPU 2 runs; the post is recorded and left to it (its IRQ 324 on bank 2)
    if (this.xcpu_native) { this.xcpu_log.push({ step: this.step_tag, lab_ns: this.lab_time(), native: true, post_d0: r.d0 }); return; }
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
    // the audio hardware (--audio on, a body with src/fw/models.mjs audio; src/lab/audiohw.mjs): the machine gets the
    // audio port and the SCA page (src/dev/audio.mjs), the bring-up the sound IC on PER_SIO (S-WM8946), S-AUDCPU2 and
    // H-AUDSTART, and the sound area S-SOUNDRES's lab-made sounds where the host gives none. auto, the default, is on
    // for a body that has it (E143) and off for the others
    const audio = opts.audio ?? 'auto';
    if (!['off', 'on', 'auto'].includes(audio)) throw new ValueError(`audio ${show(audio)}: off, on or auto`);
    if (audio === 'on' && !MODEL_INFO.audio) throw new ValueError(`--audio on: ${MODEL} has no audio hardware in the lab (src/fw/models.mjs audio)`);
    const audioOn = audio === 'on' || (audio === 'auto' && !!MODEL_INFO.audio);
    if (audioOn) env = { ...env, machine: { ...(env.machine ?? {}), audio: true } };
    // PER_ROTATE natively (a body whose fact acc gives rotate: E143, E146, E147; src/lab/acc.mjs H-ROTINIT). auto, the
    // default since 2026-11-23, is on for those bodies and off for the others; off keeps the orientation at 0
    // (A-ACC-2's range)
    const rotate = opts.rotate ?? 'auto';
    if (!['off', 'on', 'auto'].includes(rotate)) throw new ValueError(`rotate ${show(rotate)}: off, on or auto`);
    if (rotate === 'on' && !MODEL_INFO.acc?.rotate) throw new ValueError(`--rotate on: ${MODEL} has no PER_ROTATE in the lab (src/fw/models.mjs acc.rotate)`);
    // the TAKE probe (--take probe, E143 only; src/lab/take.mjs): TAKE_FUNC and TAKE_FUNC_CP natively with S-TAKEREQ;
    // off by default
    const take = opts.take ?? 'stand-in';
    if (!['stand-in', 'probe'].includes(take)) throw new ValueError(`take ${show(take)}: stand-in or probe`);
    if (take === 'probe' && !ON_LAB_MODEL) throw new ValueError(`--take probe: ${MODEL}'s TAKE addresses are not read (E143 only, src/lab/take.mjs)`);
    // CPU 2 natively (--cpu2 auto|stand-in|native, E143 only; src/lab/cpu2.mjs, src/core/cores.mjs): the machine gets
    // a second core; auto (the default) is native on E143 and stand-in elsewhere
    const cpu2 = opts.cpu2 ?? 'auto';
    if (!['auto', 'stand-in', 'native'].includes(cpu2)) throw new ValueError(`cpu2 ${show(cpu2)}: auto, stand-in or native`);
    if (cpu2 === 'native' && !ON_LAB_MODEL) throw new ValueError(`--cpu2 native: ${MODEL}'s CPU 2 addresses are not read (E143 only, src/lab/cpu2.mjs)`);
    const cpu2Native = cpu2 === 'native' || (cpu2 === 'auto' && ON_LAB_MODEL);
    if (cpu2Native) {
      env = { ...env, machine: { ...(env.machine ?? {}), cores: { second: 2, quantum: CPU2_QUANTUM } } };
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
    if (take === 'probe') set_lever(this.images, LEVER_PROBE_STATE);   // (E143 only, checked above)
    // keys held down at power-on (opts.held: control ids of kind 'key'), in the images before UI_IN starts, released
    // once the start is done (start_keys_release): the user's hold through the power-on, as MENU for the hidden menu
    this.held = [...new Set(opts.held ?? [])];
    for (const id of this.held) {
      const c = BY_ID.get(id);
      if (c === undefined || c.kind !== 'key') throw new ValueError(`--held ${show(id)}: a key (${CONTROLS.filter((k) => k.kind === 'key' && k.status !== 'not-wired').map((k) => k.id).join(', ')})`);
      if (c.status === 'not-wired') throw new ValueError(`--held ${id}: ${c.name} is not wired (${c.reason})`);
      const [g, b, bit, , , pol] = c.uiin;
      set_bit(this.images[g], b, bit, pol);
    }
    // the creative dial at the session's start: the idle image's position (SWITCH_IDLE_POSITION), or opts.creative_dial
    const cd = BY_ID.get('creative_dial');
    this.cdial_index = cd.positions ? SWITCH_IDLE_POSITION : null;
    // each wired position switch's position (posswitch_image keeps it): at the session's start the idle image's
    this.posswitch_at = new Map(CONTROLS.filter((c) => c.posswitch && c.positions).map((c) => [c.id, MODEL_INFO.switch_idle?.[c.posswitch] ?? SWITCH_IDLE_POSITION]));
    if ((opts.creative_dial ?? null) !== null) {
      if (!cd.positions) throw new ValueError(`--creative-dial: ${cd.reason}`);
      const k = opts.creative_dial;
      if (!Number.isInteger(k) || k < 0 || k >= cd.positions.length) throw new ValueError(`--creative-dial ${show(k)}: a position 0..${cd.positions.length - 1} (${cd.labels.join(', ')})`);
      this.posswitch_image(cd, k);
    }
    this.scpu_port = scpuPort();
    this.hdmi_port = hdmi === 'on';
    this.hdmi_plugged = false;
    this.audio_on = audioOn;
    this.audio_hw = null;          // the audio hardware (audiohw.mjs), from the bring-up on with --audio auto or on
    this.sound_area = null;        // the sound area S-RESNAND serves: 'host' (env.soundArea), S-SOUNDRES's or null (erased)
    if (opts.mutant === 'monitor-inverted') set_bit(this.images[MONITOR_OPEN[0]], MONITOR_OPEN[1], MONITOR_OPEN[2], 0);   // the monitor reads closed: touches rejected
    this.pressed = new Set(this.held);              // opts.held: down from the start
    this.shutter_held = new Set();
    this.mode_index = mode_start();
    // a power-on after the power lever's off (src/lab/player.mjs power): the physical controls where the closing
    // session left them (positions()), set in the images before the start reads them, as --creative-dial's position
    // is; a physical control keeps its position while the camera is off. Null for any other start
    this.carried = opts.carried ?? null;
    if (this.carried !== null) {
      const { mode_dial: md, creative_dial: k = null, still_movie: sm = null, lever = null } = this.carried;
      if (!(Number.isInteger(md) && md >= 0 && md < MODE_DIAL.positions.length)) throw new ValueError(`carried mode dial ${show(md)}: 0..${MODE_DIAL.positions.length - 1}`);
      this.images[MODE_DIAL.group].set(mode_image(md));
      this.mode_index = md;
      if (k !== null) {
        if (!cd.positions || !Number.isInteger(k) || k < 0 || k >= cd.positions.length) throw new ValueError(`carried creative dial ${show(k)}: not a position of this body's dial`);
        this.posswitch_image(cd, k);
      }
      if (sm !== null) {
        const sw = BY_ID.get('still_movie');
        if (!sw.positions || !Number.isInteger(sm) || sm < 0 || sm >= sw.positions.length) throw new ValueError(`carried still / movie switch ${show(sm)}: not a position of this body's switch`);
        this.posswitch_image(sw, sm);
      }
      if (lever !== null) {
        if (!ON_LAB_MODEL || (lever !== 0 && lever !== 1)) throw new ValueError(`carried Fn lever ${show(lever)}: a bit, on E143`);
        const [g, b, bit] = BY_ID.get('lever').uiin;
        set_bit(this.images[g], b, bit, lever);
      }
    }
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
    this.chain_rests = 0;          // the steps H-CHAINREST ran lab time in (chain_rest)
    this.scene = null;             // S-SCENE, once a scene input turns the live view on
    this.lv = null;                // the live view's attach: { device, address, key }
    this.through_off = false;      // S-THROUGH: the application stopped its through image (the menu)
    this.capture_frame = null; this.recview_hold = false;   // S-RECVIEW: the last capture's frame, held during the rec view
    this.playview_hold = false;    // S-PLAYVIEW: a card image's frame shown
    this.camapp = null;            // S-CAMAPP (camapp.mjs), from the bring-up on
    this.cpu2_native = cpu2Native;
    this.cpu2 = null;              // --cpu2 native (cpu2.mjs): CPU 2 on the machine's second core, from the bring-up on
    // the session's sound for the host (audio.mjs): only where the host plays it (env.onAudio, the players' pages)
    this.audio = typeof env.onAudio === 'function' ? new AudioOut() : null;
    this.acc = null;               // the accelerometer (acc.mjs) on a body that gives it (models.mjs acc)
    this.storage = null;           // the card and the file system (storage.mjs) on a body that runs them (models.mjs card_fs)
    this.resnand = null;           // H-RESINIT, S-RESNAND (resnand.mjs) on a body that gives res_nand, with the host's NAND
    this.ioexp = null;             // S-IOEXP and the power manager (power.mjs) on a body that gives power_native (IO
                                   // expanders: on a body whose power-off has them)
    this.power_manager = null;
    // the lens on the mount natively (lens.mjs), the default on a body that gives it (models.mjs lens_native) and runs
    // the card's file system, whose NAND access the lens data cache shares (S-LENSNAND); its lock pin switch released
    // in the idle image before the groups are pushed (its entry of the body's UI_IN tables, CONTROLS). Elsewhere, and
    // with the lens option 'stand-in', S-LENS (camapp.mjs)
    const native = this.lens_option() === 'native';
    const llpsw = CONTROLS.find((c) => c.uiin?.[3] === LLPSW)?.uiin ?? null;
    this.lens = MODEL_INFO.lens_native && native && this.storage_runs() ? new NativeLens(this, llpsw) : null;
    if (this.lens) this.lens.lock(this.images);
    // the second card slot (storage.mjs STORAGE.slots, a body with its facts): its card, the host's (env.card2) or
    // none; while the slot is empty its card switch is at the no-card level in the idle image, before the groups are
    // pushed (S-KEYBITS: the level the camera's switch has without a card, docs/hle-gaps/4.8.md 4.8.12)
    this.card2 = null;
    if (STORAGE?.slots && this.storage_runs()) {
      this.card2 = env.card2?.open() ?? null;
      if (!this.card2?.present) this.card_switch(STORAGE.slots.detect.switches[SECOND], false);
    }
    // the first slot empty at the start (the card holder's out: storage.mjs): its card switch at the no-card level too,
    // as a runtime removal leaves it (card_input); a body with no HLS side has no switch for it here, and refuses
    if (env.card?.out && this.storage_runs()) {
      if (!STORAGE.hls) throw new ValueError(`a start with no card: ${MODEL} runs no HLS media side in the lab (src/fw/models.mjs card_fs.hls), so its card switch is not modelled`);
      this.card_switch(STORAGE.hls.slots[0].switch, false);
    }
    // Whether the camera application forwards the touches to the GUI itself (docs/hle-gaps/4.4.md 4.4.2, D unless
    // tagged): its event task (entry 0x5108ba1b, task 165 in the lab) takes the touch events 0x03000072..78 and posts
    // each to the GUI as index 109 with its kind (0x5108ba30), then waits for the GUI's answer 0x0400001f, the GUI's
    // forward of event 35 through the CA caller (0x51084994); it skips this while its touch inhibit mask (0x603660b4,
    // 0x5104d642) is not 0. The mask's bit 20 is set while the application's condition 30 is false (the mask table
    // 0x612c4714), which follows the lens's attach: false with S-LENS (its record and flags do not turn it on) and
    // with the native lens detached by LLPSW, true with the native lens attached (X). Where the application forwards,
    // S-TOUCHMAP and S-CAFWD do not apply: a lab post besides the application's would be a second touch, and
    // S-CAFWD's answer of 0 kept the GUI's answer from the waiting task, which then forwarded no key (the stop of the
    // native lens until 2026-10-29)
    this.app_touch = this.lens !== null;
  }
  storage_runs() { return !!STORAGE && !envVar(this.env, 'no_storage', 'OM_NO_STORAGE'); }
  // the lens option (env.lens, node's OM_EMU_LENS): 'native' (the default) or 'stand-in' (S-LENS)
  lens_option() {
    const v = envVar(this.env, 'lens', 'OM_EMU_LENS', 'native');
    if (v !== 'native' && v !== 'stand-in') throw new ValueError(`the lens option ${show(v)}: native or stand-in`);
    return v;
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
    this.audio_hw?.drain();                                                 // the audio port's PCM to the host
    const rec = super.end(token, kind, indices, hooks, extra);
    if (this.camapp !== null) rec.camapp = this.camapp.take_log();
    rec.n = this.step_no;
    this.step_no += 1;
    const lab = this.lab;
    if (lab.dispq && lab.dispq.length) {
      rec.dispq = lab.dispq.map((d) => ({ cmd: d.cmd, words: d.words, replies: d.replies.length, ...(d.kept ? { kept: d.kept } : {}), ...(d.hdmi_line ? { hdmi_line: d.hdmi_line } : {}) }));
      this.dispq_total += lab.dispq.length;
      lab.dispq.length = 0;
      lab.dispq_replies.length = 0;
    }
    this.check_sends(`step ${token}`);
    this.check_xcpu(`step ${token}`);
    if (this.cpu2 !== null) {
      const p = this.cpu2.problem();
      if (p) throw new PlayError(`after step ${token}: ${p}`);
      const log = this.cpu2.take_log();
      if (log.length) rec.cpu2 = log;
    }
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
        blocked.map(([q, ra, st, task]) => `queue ${q} from ${ra} in task ${task} (since step ${st})${lab.queue_note?.(q) ?? ''}`).join('; ') + `; tasks ${show(lab.task_states())}`);
    }
  }
  // ---- bring-up
  // The us clock from the reset: on lab time (A-USLAB, the timer's default), or with --us-clock reads one count per CPU
  // read (H-USCOUNT, a comparison choice)
  lab_created(lab) {
    const us = this.opts.us_clock ?? 'lab';
    if (!['lab', 'reads'].includes(us)) throw new ValueError(`us_clock ${show(us)}: lab or reads`);
    if (us === 'reads') lab.sim.write(IRQ.TIMER_DEBUG + IRQ.T_USMODE, pack('<I', 0));
    lab.mutant = this.opts.mutant ?? null;           // (nvram-b-unread: menu.mjs nvram_load)
    this.usb_idle = usbIdle(this.opts, this.env);    // USB_IDLE: the sub-CPU's PC13 at the start (menu.mjs store_init)
    lab.scan_idle = { ...SCAN_IDLE, PC13: USB_IDLE[this.usb_idle] };
    // H-TPINIT before the start's display open (PlayLab.kernel_display) where the driver waits for the INT
    lab.touch_init_early = this.touch_on && (fact('touch_int', null) ?? null) !== null;
  }
  enter() {
    super.enter();
    try { this.play_bring_up(); } catch (e) { this.close(); throw e; }
    return this;
  }
  play_bring_up() {
    const lab = this.lab, o = this.opts;
    lab.play_init(o);
    this.begin('play-bring-up');
    const ad = o.mutant !== 'no-adinit' ? adInit() : null;
    // H-DPCINIT here, and with the native lens too where H-ADINIT runs: a request's completion is a deferred call
    if ((!this.lens || ad) && lab.sim.m.devices.dpc) this.dpc_bring_up();
    if (ad) this.ad_bring_up(ad);                     // H-ADINIT, before UI_IN's module init as in the boot
    if (!MODEL_INFO.sio_devices && o.mutant !== 'no-siomap') this.sio_map_bring_up();
    const tid = [];
    for (const [t, [e]] of lab.nk.tasks()) if (e === UI_IN) tid.push(t);
    if (tid.length !== 1) throw new PlayError(`UI_IN: static tasks with entry ${h8(UI_IN)}: ${show(tid)}`);
    this.uiin_tid = tid[0];
    const [wp, rp, start] = UI_IN_RING;
    if (lab.sim.u32(wp) || lab.sim.u32(rp)) throw new PlayError(`UI_IN ring pointers already set: ${h8(lab.sim.u32(wp))} ${h8(lab.sim.u32(rp))}`);
    const native = uiinInit() !== null && o.mutant !== 'no-uiininit';
    // S-USBCABLE's start with no cable (usb_start 'out'): the sub-CPU's PC13 high before UI_IN's module init, whose
    // port scan (0x88) then reads it, so group 4's image and old state hold 0x0400 at state 1 and nothing is decoded
    // (X, E143: docs/hle-gaps/4.10.md 4.10.2, 4.10.4); the lab's idle PC13 is low otherwise (S-SCPUDEV)
    if (o.usb_start !== undefined) {
      if (o.usb_start !== 'out') throw new ValueError(`usb_start ${show(o.usb_start)}: only 'out'`);
      if (!native || !lab.scpu_link || typeof lab.scpu_dev?.port !== 'function') throw new ValueError(`usb_start out: ${MODEL} has no sub-CPU model and UI_IN module init here (S-SCPUDEV, H-UIININIT)`);
      lab.scpu_dev.port('PC13', 1);
      this.usb_plugged = false;                     // the cable's state (usb_cable_in) follows PC13, as USB_IDLE 'out'
    }
    if (native) this.uiin_init_bring_up(uiinInit());   // H-UIININIT, S-WAKEFACTOR
    else {
      lab.call(UI_IN_RING_INIT, null, null, null, 10);
      if (lab.sim.u32(wp) !== start || lab.sim.u32(rp) !== start) throw new PlayError('H-UIINRING: the ring init did not set the ring pointers');
      this.boot_key_bring_up();
    }
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
    if (lab.scpu_link && uiinScan() && !this.uiin_init) this.uiin_scan_bring_up();
    if (this.cpu2_native) initQueueFlagTables(lab);
    if (lab.scpu_link && POWER_OFF) this.power_manager_bring_up();
    this.idle_codes = lab.uiin_codes.map(([, c]) => c);
    if (this.touch_on) this.touch_bring_up();
    this.takeover_bring_up();
    this.ipi_bring_up();
    if (this.cpu2_native) this.cpu2_bring_up();          // --cpu2 native: core 2 from its entry to its idle loop
    if (o.mutant !== 'no-aeinit') this.aeinit_bring_up();   // without it the interpolation's div fault comes back
    if (MODEL_INFO.acc) this.acc_bring_up();
    if (MODEL_INFO.ui_out) this.ui_out_bring_up();         // before the file layer (E134) and the application (E143)
    if (this.storage_runs()) this.storage_bring_up();
    if (MODEL_INFO.sio_devices) this.sio_bring_up();
    if (fact('power.task', null) != null) this.power_task_bring_up();     // (null or undefined: no power task)
    if (this.resnand_runs()) this.resnand_bring_up();      // USTART_L's loader, before its lens data cache load
    const resnandSkipped = MODEL_INFO.res_nand && !this.resnand ? 'H-RESINIT not run: the host gives no env.nand, the resource tables stay 0' : null;
    if (this.lens) this.lens.bring_up();
    // H-PWRLATER (opt-in): the power manager's later inits once the deferred calls' handlers are attached (H-DPCINIT,
    // with the native lens in its bring-up just above), as the boot runs them after the lens init (power.mjs)
    if (this.power_manager && (o.power_later ?? envVar(this.env, 'power_later', 'OM_POWER_LATER')) === 'on') this.power_manager.later = laterInits(this, this.power_manager.tid);
    if (this.audio_on) { this.audio_hw = new AudioHw(this); this.audio_hw.bring_up(); }
    this.end('play-bring-up', 'bring-up', [], [], { idle_codes: this.idle_codes.map(h8), ...(this.uiin_init && { uiin_init: this.uiin_init }), ...(this.storage && { storage: { ...this.storage.status(), log: this.storage.take_log() } }),
      ...(this.resnand && { resnand: { ...this.resnand.status(), log: this.resnand.take_log() } }), ...(resnandSkipped && { resnand: { skipped: resnandSkipped } }),
      ...(this.lens && { lens: { ...this.lens.status(), log: this.lens.take_log() } }),
      ...(this.audio_hw && { audio: { ...this.audio_hw.status(), log: this.audio_hw.take_log() } }) });
    // S-CAMAPP: the application starts, creates the GUI (H-GUIBYAPP) and takes it to its screen, on the EVF for an EVF
    // start (S-OUTDISP: its own 131 with lOutput 7); start 'menu' then presses MENU
    this.begin(`${String(this.steps.length).padStart(2, '0')}-S-CAMAPP start`);
    this.camapp = new CamApp(this);
    this.camapp.start();
    lab.gui_adopt();                                 // H-GUIBYAPP
    const chain = this.chain_rest('S-CAMAPP start');   // H-CHAINREST: the start's sleeps
    if (chain.slices) this.camapp.expose();            // S-EXPOSE: the plan on the screen the start reached
    this.end('S-CAMAPP start', 'camapp', [], [], { camapp: this.camapp.status(), ...(chain.slices ? { chain_rest: chain } : {}) });
    this.start_key_bring_up();
    this.mec = new MecCount(this);                     // H-MECCOUNT: the mechanism driver's count read (mec.mjs)
    this.mec.bring_up();
    for (const id of this.held) this.key(id, 'up');    // released once the start is done (opts.held)
    if ((o.start ?? 'shooting') === 'menu') { this.key('menu', 'down'); this.key('menu', 'up'); }
  }
  // H-STARTKEY: USTART5's step between its marks 5_a and 5_b (E143 0x501ea096..0x501ea0a9, docs/hle-gaps/4.6.md 4.6.5), which
  // the lab's start does not run (the 5_a..5_r row of USTART5's table), natively after S-CAMAPP's start as USTART5
  // runs after CA_MAIN's: UI_IN's state of MENU (its key state read 0x5014c015(0x0089): 1 released, 0 held, X) written
  // to the camera state kind 0x2751 index 0 (the write 0x5004188b), the store's property 4519, which Monitor Adjust's
  // OK reads: 0 takes the GUI to SS_MENU_MAIN/ID_ST_HIDE_MODE (0x5123c1ed..0x5123c21a). The site is read by its
  // instructions on each body (startKeySite); a body where they are not found does not run the step
  start_key_bring_up() {
    const site = startKeySite(this.tables.v);
    this.start_key = site.why ? { skipped: site.why } : null;
    if (site.why) return;
    const lab = this.lab;
    const state = lab.call(site.key_state, { d0: site.code }, null, null, 20000).d0 & 0xFF;
    lab.call(site.write, { d0: site.kind, d1: 0, a0: 0, a1: state }, null, null, 200000);
    const back = lab.call(site.read, { d0: site.kind, d1: 0 }, null, null, 200000).d0;
    if (back !== state) throw new PlayError(`H-STARTKEY: camera state 0x${site.kind.toString(16)} reads ${back} after its write of ${state}`);
    this.start_key = { code: site.code, kind: site.kind, state };
  }
  // H-DPCINIT (src/lab/bodystart.mjs dpcInit), at the bring-up on a board with the deferred-call triggers; with the
  // native lens the lens's bring-up runs it (src/lab/lens.mjs)
  dpc_bring_up() {
    this.dpc_init = dpcInit(this.lab, PlayError);
  }
  // H-ADINIT (above, adInit): the A/D driver's init natively, after H-DPCINIT. Checked: the converter's IRQ is the
  // board's and has no handler before; the table's words are 0 before (the BSS value; the init does not run); after it
  // the count is not 0, the table is the word +4 of the configuration record the core byte selects, every entry's
  // converter channel is below the converter's AD_MAX_CHANNELS (10) and the IRQ has a handler. The converter's values from then on are
  // the lab's (adValue)
  ad_bring_up(f) {
    const lab = this.lab, sim = lab.sim, adc = sim.m.devices.adc;
    if (f.irq !== BOARD.adc.irq) throw new PlayError(`H-ADINIT: the A/D init ${h8(f.init)} attaches IRQ ${f.irq}, the board's converter raises ${BOARD.adc.irq}`);
    if (!this.dpc_init) throw new PlayError('H-ADINIT: the deferred calls\' handlers are not attached (H-DPCINIT): a request\'s completion would be a deferred call nothing runs');
    refuseUnmapped(f.init, 'H-ADINIT');
    if (sim.u32(f.table) || sim.read(f.count, 1)[0] || sim.u32(IRQ.HANDLER_TABLE + 4 * f.irq)) {
      throw new PlayError(`H-ADINIT: before the init, the table ${where(f.table)} = ${h8(sim.u32(f.table))}, its count ${sim.read(f.count, 1)[0]}, IRQ ${f.irq}'s handler ${h8(sim.u32(IRQ.HANDLER_TABLE + 4 * f.irq))}`);
    }
    adc.values = (k) => this.ad_value(k);
    lab.lt.idle_steps.push(() => this.ad_idle_step());
    lab.call(f.init, null, null, null, 200000);
    const n = sim.read(f.count, 1)[0], table = sim.u32(f.table), core = sim.read(BOARD.core_byte, 1)[0];
    const record = f.configs + 16 * core;
    if (!n || table !== sim.u32(record + 4) || n !== sim.read(record + 8, 1)[0] || !sim.u32(IRQ.HANDLER_TABLE + 4 * f.irq)) {
      throw new PlayError(`H-ADINIT: after ${h8(f.init)}: ${n} channels at ${h8(table)} (the record ${h8(record)} of core byte ${core}), IRQ ${f.irq}'s handler ${h8(sim.u32(IRQ.HANDLER_TABLE + 4 * f.irq))}`);
    }
    const e = sim.read(table, 3 * n), channels = Array.from({ length: n }, (_, i) => [e[3 * i], e[3 * i + 1], e[3 * i + 2]]);
    const bad = channels.filter(([, k]) => k >= AD_MAX_CHANNELS);
    if (bad.length) throw new PlayError(`H-ADINIT: channels ${show(bad)} name a converter channel the converter (src/dev/adc.mjs) does not have`);
    if (new Set(channels.map(([, k]) => k)).size !== n) throw new PlayError(`H-ADINIT: channels ${show(channels)} share a converter channel`);
    this.ad_channels = new Map(channels.map(([c, k]) => [k, c]));
    this.ad_init = { init: h8(f.init), count: n, table: h8(table), channels };
  }
  // the lab task's idle point (src/lab/kernel.mjs idle_steps): while the converter converts and its IRQ is not presented,
  // lab time runs to its next event (a sample, or an earlier event of another source), as time passes for a CPU that
  // idles while the converter works
  ad_idle_step() {
    const adc = this.lab.sim.m.devices.adc;
    if (adc.next === Infinity || (adc.status && adc.ie)) return false;
    this.lab.run_to_event(adc.next);
    return 'again';
  }
  // the value of converter channel k (src/dev/adc.mjs values; H-ADINIT's list above): by the driver's channel the table
  // gives it; null where the lab has none
  ad_value(k) {
    const c = this.ad_channels?.get(k);
    if (AD_POWER_CHANNELS.includes(c)) return AD_POWER_VALUE;   // A-ADC-4
    if (c === AD_DIAL_CHANNEL) {                            // A-ADC-5: the dial's position k's interval's midpoint
      if (isUnmapped(AD_DIAL_THRESHOLDS)) return null;
      const sim = this.lab.sim, t = sim.u32(AD_DIAL_THRESHOLDS), pos = this.mode_index;
      if (!t || !(pos >= 0 && pos < AD_DIAL_POSITIONS)) return null;
      const lo = sim.u32(t + 4 * pos), hi = sim.u32(t + 4 * pos + 4);
      return lo < hi ? (lo + hi) >>> 1 : null;
    }
    return null;
  }
  // S-SIOIIC (src/lab/bodystart.mjs sioStart), before the power task's start configures the charger's channel
  sio_bring_up() {
    this.sio = sioStart(this.lab);
  }
  // H-SIOMAP on a body without PER_SIO devices: the channel map's setter (fact 'sio.map_init', E143 0x5005f0b2, the
  // end of PER_SIO's channel init 0x5005f03f, which the boot calls and the lab does not) run natively at the bring-up,
  // so each channel's controller index (the panel's channel 2 among them) is the board's, not a byte of low memory.
  // A body whose driver has no map (the E118 family, src/fw/facts.mjs sioDriver) has none to set. Returns the map
  // pointer, or null where there is none
  sio_map_bring_up() {
    const lab = this.lab, sim = lab.sim;
    if (!ON_LAB_MODEL && !FACTS[MODEL]?.sio && !MODEL_INFO.sio) return null;
    const f = fact('sio', SIO_E143);
    if (!f?.map_init || !f.channels) return null;
    refuseUnmapped(f.map_init, 'H-SIOMAP');
    if (A(SIO_E143.map_init) !== f.map_init) throw new PlayError(`H-SIOMAP: the port map places ${h8(SIO_E143.map_init)} at ${h8(A(SIO_E143.map_init))}, the rule read the setter at ${h8(f.map_init)}`);
    if (sim.u32(f.channels)) throw new PlayError(`H-SIOMAP: PER_SIO's channel map word ${where(f.channels)} is set before its setter runs`);
    lab.call(f.map_init, null, null, null, 20000);
    const map = sim.u32(f.channels) >>> 0;
    if (!map) throw new PlayError(`H-SIOMAP: the setter ${h8(f.map_init)} left the channel map word ${where(f.channels)} at 0`);
    this.sio_map = { word: f.channels, map };
    return map;
  }
  // H-PWRTASK (src/lab/bodystart.mjs powerTaskStart), at the bring-up on a body with the power task
  power_task_bring_up() {
    this.power_tid = powerTaskStart(this.lab, (label) => this.settle(label), PlayError);
  }
  // H-UIOUTSTART: UI_OUT, the module of the camera's lamps (MODELS ui_out: E134, E143), which the boot starts (its
  // init, then act_tsk of its static task) and the lab, ending the init task, did not: its init natively at the
  // bring-up, then its task started and settled to its wait on its queue, which takes the lamps' requests (a send
  // without a timeout). E134's file layer asks it for the card's access lamp at each access, so with nobody reading
  // the queue it filled and the file module's task blocked in a send (X: S-RECFILE's first fopen, 53 sends;
  // docs/hle-gaps/4.8.md 4.8.7). E143's UI_OUT also plays the operation sounds: the AF beep's request reaches it
  // (S-AFLOCK, camapp.mjs), and its second queue, UI_OUT_EXEC, which it answers itself, leaves S-MODACK's queues
  // (camapp.mjs install)
  ui_out_bring_up() {
    const lab = this.lab, { init, task } = MODEL_INFO.ui_out;
    const ids = [...lab.nk.tasks()].filter(([, [e]]) => e === task).map(([t]) => t);
    if (ids.length !== 1 || lab.nk.state(ids[0]) !== 0x10) throw new PlayError(`H-UIOUTSTART: static tasks with entry ${h8(task)}: ${show(ids)}, not one dormant`);
    lab.call(init, null, null, null, 2000000);
    lab.lt.allow.add(task);
    const [rc] = lab.nk.svc('act_tsk', { d0: ids[0] });
    if (rc !== K.E_OK) throw new PlayError(`H-UIOUTSTART: act_tsk(${ids[0]}) = ${rc}`);
    this.settle('H-UIOUTSTART');
    if (lab.nk.state(ids[0]) !== 4) throw new PlayError(`H-UIOUTSTART: UI_OUT's task ${ids[0]} is ${show(lab.task_states())} after its start, not waiting`);
    this.ui_out_tid = ids[0];
  }
  // S-BOOTKEY: UI_IN's boot key (fact 'boot.key', src/fw/facts.mjs bootState), the code of the key that started the
  // camera, which UI_IN's module init records from the sub-CPU's wake factor (its call of the recording init does not
  // run, H-UIINRING), set to the power switch's code (CONTROLS power, 0x000C): the session's camera is started by its
  // power lever or button. The camera application's wake-up judgement maps that code to API_WUI_POWER_BUTTON and
  // starts the shooting service from it (D). With the word at 0, the judgement's default is a battery insertion
  // (API_WUI_INSERT_BATTERY), and E133's start went to the boot service that creates no GUI (X); E130 and eight other
  // bodies map that default to the power button while module 9 is in state 2 (S-TAKEOVER, D). The addresses are in
  // docs/model-survey.md (E133)
  boot_key_bring_up() {
    if (MM.bootFacts().key === null) return;          // a build without UI_IN's boot key word (the E118 family's)
    const lab = this.lab, word = MM.bootFacts().key, key = BY_ID.get('power').uiin[3];
    if (lab.sim.u32(word) !== 0) throw new PlayError(`S-BOOTKEY: UI_IN's boot key ${h8(word)} is 0x${lab.sim.u32(word).toString(16)} before UI_IN's start`);
    lab.sim.write(word, pack('<I', key));
    this.boot_key = key;
  }
  // H-UIININIT and S-WAKEFACTOR (above, uiinInit): before UI_IN's start, as the boot runs the init before it starts the
  // task. Checked: the init's two stores find their words at 0 (the BSS value they store, not run), the wake factor
  // getter's bytes name the word, which is 0 before; then the ring set after the ring init, the boot key the power switch's
  // code (S-BOOTKEY's), one registration of an IRQ 320 callback, UI_IN's; one 0x88 frame, its reply not busy (H-UIINSCAN's
  // check); and the error log the A/D channel open's alone. Group 4's image is the firmware's from here on (the keys
  // held at power-on set on it); the codes UI_IN decodes at its start then come from that image and old state (X, E143:
  // the scan's 0x0400 at 0, the init's old state at 1)
  uiin_init_bring_up(f) {
    const lab = this.lab, sim = lab.sim, { stores, calls } = uiinInitCalls(lab.image, f.init), [wp, rp, start] = UI_IN_RING;
    const [code, adCall] = f.ad_errlog, scan = lab.scpu_link && uiinScan();
    if (calls[0] !== UI_IN_RING_INIT || !f.left.every((c) => calls.includes(c)) || !calls.includes(adCall) || calls.includes(UIIN_PORT_SCAN) !== !!scan) {
      throw new PlayError(`H-UIININIT: UI_IN's module init ${h8(f.init)} calls ${calls.map(h8).join(' ')}: not the ring init ${h8(UI_IN_RING_INIT)} first with ${f.left.map(h8).join(', ')}, ${h8(adCall)}${scan ? ` and the port scan ${h8(UIIN_PORT_SCAN)}` : ' and no port scan (no sub-CPU link)'}`);
    }
    if (sim.read(stores[0], 1)[0] !== 0 || sim.u32(stores[1]) !== 0) throw new PlayError(`H-UIININIT: the init's words ${h8(stores[0])} / ${h8(stores[1])} are not 0 before it`);
    // S-WAKEFACTOR
    const [word, getter] = f.wake, g = sim.read(runtime(getter), 9);
    if (g[0] !== 0xFC || g[1] !== 0xAC || unpack('<I', g.subarray(2, 6))[0] !== word || g[6] !== 0xDE || g[7] !== 0x00 || g[8] !== 0x00) {
      throw new PlayError(`S-WAKEFACTOR: ${h8(getter)} is ${bytesHex(g)}, not movhu (${h8(word)}),d0; retf`);
    }
    const w0 = unpack('<H', sim.read(word, 2))[0];
    if (w0 !== 0) throw new PlayError(`S-WAKEFACTOR: the wake factor ${h8(word)} is ${w0} before UI_IN's module init`);
    sim.write(word, pack('<H', WAKE_POWER_BUTTON));
    const { register, callback } = this.scpu_port ?? {}, regs = [];
    if (register) lab.observe(register, (l, r) => { regs.push(r.a0 >>> 0); this.scpu_callback_check(r); }, 'obs-scpu-callback');
    const keys = f.keys ? this.gio_keys_levels(f.keys, calls) : null;   // H-GIOKEYS
    const e0 = lab.kernel.errors.length, f0 = lab.scpu_dev?.frames.length ?? 0, errlog = [], run = [];
    for (const fn of calls) {
      if (f.left.includes(fn)) continue;
      if (keys && fn === f.keys[0] && sim.u32(UIIN_VARIANT) !== 0) throw new PlayError(`H-GIOKEYS: UI_IN's variant (${h8(UIIN_VARIANT)}) is ${sim.u32(UIIN_VARIANT)} before the key init: its table is variant 0's`);
      const k0 = lab.kernel.errors.length;
      lab.call(fn, null, null, null, 2000000);
      if (fn === UI_IN_RING_INIT && (sim.u32(wp) !== start || sim.u32(rp) !== start)) throw new PlayError('H-UIININIT: the ring init did not set the ring pointers');
      for (const [c] of lab.kernel.errors.slice(k0)) errlog.push([c, fn]);
      run.push(fn);
    }
    this.settle('H-UIININIT');
    for (const [c] of lab.kernel.errors.slice(e0 + errlog.length)) errlog.push([c, null]);
    const key = sim.u32(MM.bootFacts().key), power = BY_ID.get('power').uiin[3];
    if (key !== power) throw new PlayError(`H-UIININIT: UI_IN's boot key ${h8(MM.bootFacts().key)} is 0x${key.toString(16)} after its init with the wake factor ${WAKE_POWER_BUTTON}, not the power switch's 0x${power.toString(16)}`);
    if (register && (regs.length !== 1 || regs[0] !== runtime(callback))) throw new PlayError(`H-UIININIT: IRQ 320 callbacks registered ${regs.map(h8).join(' ') || 'none'}, not UI_IN's ${h8(callback)} once`);
    // with H-ADINIT the channel open finds its channel and logs nothing; without it, its 'no channel' error alone
    if (this.ad_init ? errlog.length : errlog.length !== 1 || errlog[0][0] !== code || errlog[0][1] !== adCall) {
      throw new PlayError(`H-UIININIT: error log ${errlog.map(([c, fn]) => `${h8(c)} in ${fn === null ? 'the settle' : h8(fn)}`).join('; ') || 'none'}, not ${this.ad_init ? 'none (H-ADINIT)' : `${h8(code)} in ${h8(adCall)} alone`}`);
    }
    const frames = lab.scpu_dev?.frames.slice(f0) ?? [];
    if (scan ? frames.length !== 1 || frames[0].cmd !== '0x88' || frames[0].reply?.slice(6, 8) !== '00' : frames.length) {
      throw new PlayError(`H-UIININIT: frames to the sub-CPU ${show(frames)}, not ${scan ? 'one 0x88 answered not busy' : 'none'}`);
    }
    const g4 = sim.read(G4_IMAGE, 2);
    this.images[4].set(g4);
    for (const id of this.held) {
      const [gg, b, bit, , , pol] = BY_ID.get(id).uiin;
      if (gg === 4) set_bit(this.images[4], b, bit, pol);
    }
    if (keys) this.gio_keys_check(keys);
    this.uiin_init = { calls: run.map(h8), left: f.left.map(h8), wake: WAKE_POWER_BUTTON, key: h8(key), group4: bytesHex(g4),
      errlog: errlog.map(([c, fn]) => [h8(c), h8(fn)]), ...(scan && { scan: { reply: frames[0].reply, report: lab.scpu_dev.scanReport } }),
      ...(keys && { keys: { group: keys.group, old: keys.old_state, pins: keys.pins.map(({ bit, pin, phys, level }) => [bit, pin, phys, level]), expanders: keys.expanders } }) };
  }
  // H-GIOKEYS (uiinKeyPins above): before UI_IN's key init, the board's GIO key pins (src/dev/gio.mjs) at the levels of
  // the lab's idle image of the init's group (S-KEYBITS' image: the keys released, the switches at its levels), each
  // table pin of class 0 mapped to the pin the driver drives by the firmware's own map (lab.call of keys' map, on the
  // lab task's core, as the init's read and arm calls map it). The init then reads them, writes them to the group's
  // old state and arms each pin for the level it is not at. The IO expanders' pins (classes 2 and 3) are read from
  // their drivers' RAM (E143 0x5005605b, 0x50054262, D), which the lab does not set: their bits are what that RAM
  // holds. Every class-0 pin must be one the board models
  gio_keys_levels(f, calls) {
    const lab = this.lab, gio = lab.sim.m.devices.gio_keys, [read, , map] = f;
    if (!calls.includes(read)) throw new PlayError(`H-GIOKEYS: UI_IN's module init does not call its key init ${h8(read)}`);
    if (!gio) throw new PlayError(`H-GIOKEYS: ${MODEL}'s board gives no GIO key pins (src/fw/board.mjs gio_keys) for its key init ${h8(read)}`);
    const k = uiinKeyPins(lab.image, f, uiin_layout(lab.image).groups), img = this.images[k.group], pins = [], expanders = [];
    for (const { bit, pin } of k.keys) {
      if (pin === 0xFF) continue;
      if ((pin >>> 24) & 15) { expanders.push([bit, h8(pin)]); continue; }
      const phys = lab.call(map, { d0: pin }, null, null, 2000).d0 >>> 0;
      if (!gio.has(phys)) throw new PlayError(`H-GIOKEYS: key ${bit}'s pin ${pin} maps to ${phys}, which the board's GIO key pins do not model`);
      const level = (img[bit >> 3] >> (bit & 7)) & 1;
      gio.setLevel(phys, level);
      pins.push({ bit, pin, phys, level });
    }
    return { ...k, pins, expanders, gio };
  }
  // H-GIOKEYS' check after the init: the group's old state holds each modelled pin's level at its bit, and each pin is
  // armed (its enable word set) with no interrupt pending (status & enable 0: armed for the level it is not at)
  gio_keys_check(k) {
    const sim = this.lab.sim, old = sim.read(k.old, 2), bad = [];
    for (const { bit, phys, level } of k.pins) {
      const i = k.gio.byPin.get(phys), got = (old[bit >> 3] >> (bit & 7)) & 1;
      if (got !== level) bad.push(`bit ${bit} (pin ${phys}) ${got} in the old state, its level ${level}`);
      if (!k.gio.enable[i] || (k.gio.status[i] & k.gio.enable[i])) bad.push(`pin ${phys} enable ${h8(k.gio.enable[i])} status ${h8(k.gio.status[i])}`);
    }
    if (bad.length) throw new PlayError(`H-GIOKEYS: after UI_IN's key init: ${bad.join('; ')}`);
    k.old_state = bytesHex(old);
  }
  // H-SCPUIRQ: what the SCPU init (not run) does for the event word: the ports at the idle image's levels, their
  // events cleared as the init clears them (127 to the event word), IRQ 320 attached to its handler at the init's level
  // through the firmware's attach (checked as H-IPIINIT's). H-UIINPORT: UI_IN's callback registered through the
  // firmware's registration, as UI_IN's port init (not run) registers it, and group 0's old state set from the port
  // byte by the firmware's own init, which UI_IN's start stage (not run) calls first: group 0 then decodes no code at
  // bring-up. A later registration of another callback is refused (none has the firmware's evidence); PER_SCPU's own
  // callback is registered natively before, at its task's start (H-SCPUSTART, src/lab/scpulink.mjs), and acts on the
  // message port's events (docs/hle-gaps/4.7.md 4.7.2)
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
    if (!this.uiin_init) {                          // (H-UIININIT: UI_IN's init registered it, its observer stays)
      lab.observe(register, (l, r2) => this.scpu_callback_check(r2), 'obs-scpu-callback');
      lab.call(register, { a0: runtime(callback) }, null, null, 20000);
    }
    lab.call(old_state, null, null, null, 2000);
    const old = lab.sim.read(g0.old, 1)[0];
    if (old !== port) throw new PlayError(`H-UIINPORT: group ${SCPU_PORT_GROUP}'s old state (${h8(g0.old)}) is 0x${fx(old, 2)} after ${h8(old_state)}, not the port byte 0x${fx(port, 2)}`);
  }
  // a registration of an IRQ 320 callback: only UI_IN's is modelled
  scpu_callback_check(r) {
    const { callback } = this.scpu_port;
    if (r.a0 !== runtime(callback)) throw new PlayError(`IRQ ${BOARD.scpu.events.irq} callback ${h8(disasm(r.a0))} registered from ${where(r.mdr)}: only UI_IN's (${h8(callback)}) is modelled`);
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
  // S-IOEXP and H-PWRSTART (power.mjs): the IO expanders' requests answered from here on, then the power manager
  // started natively, as the boot starter would have started it
  power_manager_bring_up() {
    if (POWER_OFF.ioexp) {
      this.ioexp = new IoExpanders(this.lab, POWER_OFF.ioexp);
      this.ioexp.install();
    }
    this.power_manager = startPowerManager(this, POWER_OFF.pwr);
  }
  // H-ACCINIT, S-ACCREG, S-ACCSAMPLE and H-SLOPEINIT (acc.mjs): the ACC module init and PER_SLOPE's init natively in
  // the boot's place, before the application starts, since its GUI starts PER_SLOPE for the gauge (startLevel at the
  // application's start, X); with PER_ROTATE (--rotate auto or on) also its init (H-ROTINIT); the settle runs ACC_MAIN's probe, whose
  // accesses are then checked
  acc_bring_up() {
    this.acc = new Accelerometer(this.lab, MODEL_INFO.acc, this.opts.mutant, rotateOn(this.opts.rotate));
    this.acc.bring_up();
    this.settle('H-ACCINIT');
    const why = this.acc.probe_problem();
    if (why) throw new PlayError(`H-ACCINIT: ${why}`);
    this.acc.prime();
  }
  // H-RESINIT and S-RESNAND (resnand.mjs): the resource tables loaded natively from the NAND the host gives (env.nand:
  // the update's blocks at their load addresses; env.soundArea: an image of the sound area), on a body whose MODELS
  // entry gives res_nand (E143). Without env.soundArea the sound area is the lab-made one where the audio hardware runs
  // (--audio auto or on: S-SOUNDRES, soundres.mjs, so the operation sounds have data to play), else erased. A host
  // without env.nand keeps the tables at 0, as the lab did before (the lens data lookup then reads nothing,
  // src/lab/lens.mjs), and the bring-up's record says so (resnand.skipped)
  resnand_runs() { return !!MODEL_INFO.res_nand && !!this.env.nand; }
  resnand_bring_up() {
    this.sound_area = this.env.soundArea ? 'host' : this.audio_on ? SOUNDRES : null;
    const image = this.env.soundArea ?? (this.audio_on ? labSoundArea({ load: MODEL_INFO.res_nand.sound.load }).image : null);
    this.resnand = new ResNand(this, MODEL_INFO.res_nand, this.env.nand, image);
    this.resnand.bring_up();
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
  // --cpu2 native (cpu2.mjs): H-CPU2RELEASE and core 2 from its entry to its idle loop, then beside CPU 0
  cpu2_bring_up() {
    const lab = this.lab;
    this.cpu2 = new Cpu2(this);
    this.cpu2.boot();
    lab.xcpu_native = true;                          // S-CPU2 lifted: the GUI's post goes to core 2
    lab.xcpu_served.add(2);
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
    this.touch_index = null;                          // S-TOUCHMAP's index: the first whose message is the touch message
    for (let i = 1; i <= 334 && this.touch_index === null; i++) if (lab.message_for(i) === TOUCH_MESSAGE) this.touch_index = i;
    if (this.touch_index === null) throw new PlayError(`S-TOUCHMAP: no sendEvent index for the touch message 0x${TOUCH_MESSAGE.toString(16)} in the event map`);
    const allow = [...D.STUB_PAGES.map((p) => [p, 0x1000]), [GPIO_TP_PAGE, 0x1000]];
    const a = new Uint8Array(12 * allow.length);
    allow.forEach(([p, n], i) => a.set(pack('<III', p, n, 1), 12 * i));
    lab.sim.write(D.STUB + 0x100, a);
    const gio = lab.sim.m.devices.gio_keys, modelled = GPIO_TP.filter(([pin]) => gio?.has(pin));
    if (modelled.length && modelled.length !== GPIO_TP.length) throw new PlayError(`S-GPIO-TP: the board's GIO key pins model ${modelled.map(([p]) => p).join(', ')} of the touch driver's ${GPIO_TP.map(([p]) => p).join(', ')}`);
    if (modelled.length) this.gpio_tp_reads();
    const presets = [...D.STUB_PRESETS, ...(modelled.length ? [] : GPIO_TP.map(([, addr]) => [addr, 0x10]))];
    const pr = new Uint8Array(16 * presets.length);
    presets.forEach(([ad, v], i) => pr.set(pack('<IIII', ad, v, 0, 1), 16 * i));
    lab.sim.write(D.STUB + 0x400, pr);
    lab.hooks.set(runtime(D.TP_I2C_READ), [(h, r) => lab._s_tpreg(h, r), 'S-TPREG']);
    lab.observe(HFW_CALLBACK, (l, r) => lab._hfw(l, r), 'obs-hfw-touch');
    for (const [addr, [, st]] of HFW_STATUS) lab.observe(addr, lab._hfw_status(st), `obs-hfw-${st}`);
    if (this.app_touch) lab.observe(CA_CALL, (l, r) => lab._obs_cafwd(l, r), 'obs-cafwd');
    else if ((this.opts.touch ?? 'gui') === 'gui' && this.opts.mutant !== 'no-cafwd') lab.hook(CA_CALL, (h, r) => lab._s_cafwd(h, r), 'S-CAFWD');
    if (!lab.touch_init_early) lab.step(H_TPINIT, () => lab.call(TOUCH_INIT, null, null, null, 20000));
    const tid = unpack('<h', lab.sim.read(TOUCH_TASK_ID, 2))[0];
    lab.lt.allow.add(TOUCH_TASK);
    lab.touch_native = true;                          // the touch task takes its queue's messages itself (S-TPSEND)
    const [rc] = lab.nk.svc('act_tsk', { d0: tid });
    if (rc !== K.E_OK) throw new PlayError(`H-TPINIT: act_tsk(${tid}) = ${rc}`);
    this.touch_tid = tid;
    this.settle('H-TPINIT touch task start');
    // H-TPSTART: the panel's open with HFW's callback and the gesture mask, from the lab task. The camera
    // application's start does both itself on every body (its touch module's end closes the panel, its action
    // starts it through HFW's touch init, which opens it with that callback, and the GUI sets the mask per screen:
    // E122 0x50b802d1, 0x50b80365, 0x5073a8a7; E143 0x5105e182, 0x5105e216, 0x50b76d47, D; X: the driver's close
    // and open in the start on the 13 bodies of the E144 and E118 families and on E143, docs/model-survey.md
    // finding 114). It is left out where H-TPINIT runs before the display open (touch_init_early, fact touch_int:
    // the E144 and E118 families), whose touch is the application's alone (X: test/test_touch.mjs on the 13 bodies
    // without it); E143's, E146's and E147's sessions keep it, which golden records on E143 (not tried without it)
    this.tp_start = !lab.touch_init_early;
    if (!this.tp_start) return;
    const r = lab.call(TP_OPEN, { a0: runtime(HFW_CALLBACK), a1: 0 }, null, null, 5000);
    if (r.d0 !== 0) throw new PlayError(`H-TPSTART: TP_OPEN ${h8(TP_OPEN)} = 0x${r.d0.toString(16)}`);
    const mask = lab.alloc(pack('<I', TP_MASK_ALL), 4);
    lab.call(TP_MASK, { a0: mask }, null, null, 5000);
    this.settle('H-TPSTART');
  }
  // S-GPIO-TP at the touch driver's pin reads (GPIO_TP_READS): each call's bytes checked (`mov pin,d0` (80 pin), then
  // the call of the pin read), then hooked to go on after it with d0 = 1
  gpio_tp_reads() {
    const lab = this.lab;
    this.gpio_tp_answered = 0;
    for (const [at, pin] of GPIO_TP_READS) {
      const rt = runtime(at), b = lab.sim.read(rt - 2, 7);
      if (b[0] !== 0x80 || b[1] !== pin || b[2] !== 0xDD || ((rt + unpack('<i', b.subarray(3, 7))[0]) >>> 0) !== runtime(PIN_READ)) {
        throw new PlayError(`S-GPIO-TP: the touch driver's read at ${h8(at)} is ${bytesHex(b)}, not mov ${pin},d0 and a call of the pin read ${h8(PIN_READ)}`);
      }
      lab.hook(at, (h, r) => { this.gpio_tp_answered++; h.skip_call({ ...r, d0: 1 }); }, 'S-GPIO-TP');
    }
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
    lab.step_queued = 0;
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
    this.audio_hw?.drain();
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
  // The OSD planes' scaler on the shown device's channel ([sh, sv] or null; display.mjs VscDebug osd_steps), where
  // the GUI's canvas lies on frame()'s composite
  osd_steps() { return this.lab.vsc.osd_steps(lookup(D.DEVICE, this.device).channel); }
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
  set_group(sid, values, tag = null) {
    const saved = this._post_hooks;
    this._post_hooks = PlaySession.SET_HOOKS;
    try { return super.set_group(sid, values, tag); } finally { this._post_hooks = saved; }
  }
  post_touch(kind, x, y) {
    const lab = this.lab;
    lab.harvest();
    const msg = lab.alloc(pack('<8I', this.touch_index, 0, kind, x, y, 0, 0, 0), 4);
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
  // A position switch's group images at position k: k's bit at its polarity, every other position's at the other value
  // (the mutant cdial-reversed takes the entries in reverse order: test_cdial.mjs's control)
  posswitch_image(c, k) {
    const at = this.opts.mutant === 'cdial-reversed' && c.id === 'creative_dial' ? c.positions.length - 1 - k : k;
    c.positions.forEach(([g, b, bit, pol], i) => set_bit(this.images[g], b, bit, i === at ? pol : 1 - pol));
    this.posswitch_at.set(c.id, k);
    if (c.id === 'creative_dial') this.cdial_index = k;
  }
  // The physical controls a power-on after the lever's off starts at (opts.carried): the mode dial's position, the
  // creative dial's and the still / movie switch's where the body has them, and the Fn lever's bit on E143, whose
  // start sets the lever (idle_images; a ported body's lever bit is left as the image has it and is not carried)
  positions() {
    return { mode_dial: this.mode_index, ...(this.cdial_index !== null ? { creative_dial: this.cdial_index } : {}),
      ...(this.posswitch_at.has('still_movie') ? { still_movie: this.posswitch_at.get('still_movie') } : {}), ...(ON_LAB_MODEL ? { lever: this.bit_of('lever') } : {}) };
  }
  // Fn lever, monitor, rotate, power, fw switches (value 0 or 1 = the bit), mode dial and creative dial (value = a
  // position, from 0).
  switch_input(cid, value) {
    const c = BY_ID.get(cid);
    if (c === undefined) throw new KeyError(show(cid));
    if (c.status === 'not-wired') throw new PlayError(`${c.name}: not wired (${c.reason})`);
    if (!['switch', 'fwswitch', 'modedial', 'posswitch', 'power'].includes(c.kind)) {
      throw new ValueError(`${c.name}: not a switch (kind ${c.kind}); keys take {type: key}, dials {type: dial}, LV and the eye sensor {type: key}`);
    }
    const positions = c.kind === 'posswitch' ? c.positions.length : MODE_DIAL.positions.length, dial = c.kind === 'modedial' || c.kind === 'posswitch';
    if (c.kind === 'modedial' && !(value >= 0 && value < positions)) throw new ValueError(`mode dial position ${value}: 0..${positions - 1}`);
    if (c.kind === 'posswitch' && !(Number.isInteger(value) && value >= 0 && value < positions)) throw new ValueError(`${c.name} position ${show(value).slice(0, 40)}: 0..${positions - 1} (${c.labels.join(', ')})`);
    if (!dial && value !== 0 && value !== 1) throw new ValueError(`${c.name}: value ${show(value).slice(0, 40)} is not 0 or 1`);
    if (this.hdmi_port && c.uiin[3] === HDMI_SWITCH) throw new ValueError(`${c.name}: with --hdmi on the HDMI switch is the firmware's own (input hdmi)`);
    const [g, b, bit, code, , pol] = c.uiin;
    const viaG4 = g === 4 && g4set() && this.opts.mutant !== 'no-g4set';
    // (H-G4SET sets one code's state; a position switch in the producer's group is not modelled)
    if (c.kind === 'posswitch' && viaG4) throw new PlayError(`${c.name}: in UI_IN's group 4, which H-G4SET's producer pushes on ${MODEL}; a position there is not modelled`);
    this.begin(`${String(this.steps.length).padStart(2, '0')}-switch ${cid} ${value}`);
    const state0 = this.lab.state();
    if (c.kind === 'modedial') { this.images[MODE_DIAL.group].set(mode_image(value)); this.mode_index = value; }
    else if (c.kind === 'posswitch') this.posswitch_image(c, value);
    else if (!viaG4) set_bit(this.images[g], b, bit, value);
    const [codes, decoded] = viaG4 ? this.g4_set(code, value === pol ? 0 : 1) : this.push_group(g);   // H-G4SET: 0 = bit at its polarity
    const posted = [];
    for (const code_ of codes) {
      const [idx] = this.keymap(code_);
      if (idx !== null) { this.event(idx); posted.push(idx); }
    }
    const extra = this.extra(c, value, codes, decoded);
    if (c.kind === 'modedial') extra.mode_dial_index = this.lab.sim.u32(MODE_DIAL_INDEX);
    if (c.kind === 'posswitch') extra.position = { index: value, label: c.labels[value] };
    return this.end(`switch ${cid} ${value}`, 'switch', posted, [], extra);
  }
  // H-POWER after the power lever's off (src/lab/power.mjs): on a body that gives power_native and runs PER_SCPU over
  // the link, the firmware's own power-off from the HFW's shutDown to its last write, as a step of its own; null
  // elsewhere (the player closes the session at once, as before). With the USB cable out (USB_IDLE 'out', or an
  // unplug) the application calls shutDown itself in the lever's step, and the lab follows that call (power_arm, before
  // the step) instead of making its own (docs/hle-gaps/4.10.md 4.10.3)
  power_runs() { return !!(POWER_OFF && this.lab.scpu_link && this.power_manager); }
  usb_cable_in() { return this.usb_plugged ?? this.usb_idle === 'in'; }   // USB_IDLE at the start, then S-USBCABLE's steps
  power_arm() {
    if (!this.power_runs() || this.usb_cable_in()) return null;
    this.power_off = new PowerOff(this, POWER_OFF, { follow: true });
    this.power_off.arm();
    return this.power_off;
  }
  power_down() {
    if (!this.power_runs()) return null;
    const lab = this.lab, n0 = lab.log.length;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-power off`);
    const off = (this.power_off ?? new PowerOff(this, POWER_OFF)).run();
    this.end('power off', 'power', [], [[0, lab.log.length - n0]], { power_off: off });
    return off;
  }
  // S-USBCABLE (docs/hle-gaps/4.10.md 4.10.1, 4.10.2): the USB cable at the event level. The producer of EV_USB_CONNECTED
  // is the sub-CPU's port scan: PC13 (GIO port 45) is active low, and its change posts the MN the message 0x08 {level}
  // (scpudev.mjs port, D), PER_SCPU's dispatch 0x5005d43e gives it to UI_IN's group-4 producer as the switch 0x0400
  // (H-UIINSCAN's path, X), whose state 0 the application's USB test 0x50abb032 takes as connected (D). The plug drops
  // PC13, the unplug raises it. The cable's state starts at the sub-CPU's PC13 level, USB_IDLE's: 'in' (S-SCPUDEV's
  // SCAN_IDLE, low) by default, so a session's first cable step is an unplug, a plug with 'out'. The application's code filter 0x50abafce reads module 9
  // (0x50abb01d) and drops the code at S-TAKEOVER's state 2 (X 2026-11-23); the readers USB_MODULE9_READERS are let
  // through S-TAKEOVER's guard from the first cable step on. Refused: a session without the sub-CPU's model, a scan
  // report not yet enabled (no 0x88 read), a plug with the cable in, an unplug with it out
  usb_input(action) {
    const lab = this.lab, dev = lab.scpu_dev;
    if (!lab.scpu_link || typeof dev?.port !== 'function') throw new ValueError(`usb: ${MODEL} has no sub-CPU model here (S-SCPUDEV)`);
    if (action !== 'plug' && action !== 'unplug') throw new ValueError(`usb: action ${show(action)} (plug, unplug)`);
    const plug = action === 'plug';
    const cable = this.usb_cable_in();                           // the sub-CPU's PC13 low: a cable in
    if (plug === cable) throw new ValueError(`usb ${action}: the cable is ${plug ? 'in' : 'out'} already (the sub-CPU's PC13 ${plug ? 'low' : 'high'})`);
    if (!dev.scanReport) throw new PlayError('usb: the port scan\'s report is not enabled (no 0x88 read, H-UIINSCAN)');
    const tag = `usb ${action}`;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    for (const x of USB_MODULE9_READERS) lab.takeover_allowed.add(x);   // the unplug's code reads 0x50abb01d too (X)
    if (this.camapp?.native_tra) for (const x of USB_CMP_MODULE9_READERS) lab.takeover_allowed.add(x);
    if (this.opts.usb_host && !this.usb_host) this.usb_host_install();   // S-USBHOST
    const c0 = lab.uiin_codes.length, f0 = dev.frames.length, m0 = lab.module9_reads?.length ?? 0, state0 = lab.state();
    dev.port('PC13', plug ? 0 : 1);
    this.usb_plugged = plug;
    this.usb_used = true;
    return this.wait_until(lab.lab_time() + USB_SETTLE_MS * 1000000, tag, true,
      { kind: 'usb', extra: () => ({ usb: { cable: plug ? 'in' : 'out', state_before: '0x' + state0.toString(16), state: '0x' + lab.state().toString(16),
        frames: dev.frames.slice(f0).map((f) => f.cmd), uiin_codes: lab.uiin_codes.slice(c0).map(([, x]) => '0x' + (x >>> 0).toString(16)),
        module9: (lab.module9_reads ?? []).slice(m0).map(([, x]) => h8(x)) } }) });
  }
  // S-USBHOST (USB_STATE_CALL's comment; docs/hle-gaps/4.10.md 4.10.4): the USB host behind the cable, at the USB
  // driver's state query. While S-USBCABLE's cable is in, the query's synchronous command 8 to PC_PD_CMD_EXEC (from
  // USB_STATE_CALL only) is answered E_OK with the request's state halfword +2 set to 1, the value
  // isCommunicateUsbDevice's caller 0x5105160c needs (D); that 1 means a host communicating is I (PCPDC passes the
  // request to the sub-CPU's USB PD side, not modelled). With the cable out, or from any other site, the send stays
  // S-MODACK's (E_OK, nothing written). Installed at the session's first cable step when opts.usb_host is set; the
  // site is checked by its bytes (the call of the synchronous send, the queue word's load, the state's store) and
  // the queue word must hold PC_PD_CMD_EXEC's id. E143 only (the sites are not ported)
  usb_host_install() {
    const lab = this.lab, image = lab.image, sim = lab.sim;
    for (const a of [USB_STATE_CALL, USB_STATE_QUEUE_WORD, USB_STATE_WORD]) if (isUnmapped(a)) throw new ValueError(`usb_host: ${MODEL} does not place ${h8(a)} (S-USBHOST is E143's)`);
    const at = (a, n) => [...image.subarray(a - 0x50000000, a - 0x50000000 + n)];
    const le = (v) => [v & 0xFF, v >>> 8 & 0xFF, v >>> 16 & 0xFF, v >>> 24];
    const want = [[USB_STATE_CALL - 11, [0xFC, 0xAC, ...le(USB_STATE_QUEUE_WORD)]], [USB_STATE_RETURN, [0xF8, 0xBD, 0x06]],
      [USB_STATE_RETURN + 4, [0xFC, 0x87, ...le(USB_STATE_WORD)]], [USB_STATE_CALL - 24, [0x80, USB_STATE_CMD, 0xF8]]];
    const bad = want.find(([a, b]) => at(a, b.length).join() !== b.join());
    if (!is_call_to(image, USB_STATE_CALL, D.SYNC_SEND) || bad) throw new PlayError(`S-USBHOST: the state query's site ${h8(USB_STATE_CALL)} is not the synchronous send of command ${USB_STATE_CMD} with the queue word ${h8(USB_STATE_QUEUE_WORD)} and the store to ${h8(USB_STATE_WORD)}${bad ? ` (${h8(bad[0])}: ${bytesHex(Uint8Array.from(at(bad[0], bad[1].length)))})` : ''}`);
    const q = unpack('<H', sim.read(USB_STATE_QUEUE_WORD, 2))[0], pd = pcPdQueue();
    if (q !== pd) throw new PlayError(`S-USBHOST: the queue word ${h8(USB_STATE_QUEUE_WORD)} holds ${q}, not PC_PD_CMD_EXEC's ${pd}`);
    const prev = lab._sync_send.bind(lab);
    this.usb_host = { queue: q, answers: [] };
    lab._sync_send = (h, r) => {
      if ((r.d0 & 0xFFFF) === q && r.d1 === USB_STATE_CMD && disasm(r.mdr) === USB_STATE_RETURN && this.usb_plugged === true) {
        sim.write((r.a0 >>> 0) + 2, pack('<H', USB_STATE_HOST));
        this.usb_host.answers.push([this.steps.length, lab.lab_time()]);
        h.finish(r, { d0: 0 });
        return;
      }
      return prev(h, r);
    };
  }
  // The HDMI cable (see HDMI_PLUG_MS): plug, and unplug once it is in (the transmitter's side A-HDMI-1, the device
  // model's header). A second plug and an unplug without the cable are refused.
  hdmi_input(action) {
    if (!this.hdmi_port) throw new ValueError('hdmi: the session has no HDMI port (--hdmi on)');
    if (action !== 'plug' && action !== 'unplug') throw new ValueError(`hdmi: action ${show(action)} (plug, unplug)`);
    if (action === 'unplug') {
      if (!this.hdmi_plugged) throw new ValueError('hdmi unplug: the cable is out already');
      const lab = this.lab, tag = 'hdmi unplug';
      this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
      const c0 = lab.uiin_codes.length;
      lab.cpu_store(HDMI_DOORBELL, (UNPLUG << 24) >>> 0);
      this.hdmi_plugged = false;
      const follow = !!this.camapp?.native_tra;                    // as at the plug (below)
      if (follow) this.camapp.prop_follow = true;
      try {
        return this.wait_until(lab.lab_time() + HDMI_PLUG_MS * 1000000, tag, true,
          { kind: 'hdmi', extra: () => ({ hdmi: this.hdmi_status(), uiin_codes: lab.uiin_codes.slice(c0).map(([, x]) => h8(x)) }) });
      } finally { if (follow) this.camapp.prop_follow = false; }
    }
    if (this.hdmi_plugged) throw new ValueError('hdmi plug: the cable is in already');
    const lab = this.lab, tag = 'hdmi plug', edid = sinkEdid();
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    lab.sim.write(HDMI_WINDOW + EDID, edid);
    lab.sim.write(HDMI_WINDOW + W_EDID_LEN, pack('<I', edid.length));
    const c0 = lab.uiin_codes.length;
    lab.cpu_store(HDMI_DOORBELL, (PLUG << 24) >>> 0);
    this.hdmi_plugged = true;
    // under control camapp 3 the component's TRA 588 opens the device and CapIod writes the output-device property
    // (16): S-PROP follows its write for the step, as in the display switch (native_switch), so that setOutputType's
    // read (0x50abd8aa through 0x50ab651a) sees the HDMI output and lays the GUI out for it (X: with the panel's value
    // it prints "not connected to HDMI"; docs/hle-gaps/4.9.md 4.9.3)
    const follow = !!this.camapp?.native_tra;
    if (follow) this.camapp.prop_follow = true;
    try {
      return this.wait_until(lab.lab_time() + HDMI_PLUG_MS * 1000000, tag, true,
        { kind: 'hdmi', extra: () => ({ hdmi: this.hdmi_status(), uiin_codes: lab.uiin_codes.slice(c0).map(([, x]) => h8(x)) }) });
    } finally { if (follow) this.camapp.prop_follow = false; }
  }
  // The camera's tilt (acc.mjs): roll and pitch in degrees, level (0, 0) at the start. ACC_MAIN takes the new sample at
  // its next cycle; the step waits TILT_MS of lab time (ROTATE_TILT_MS with --rotate on) and records the sample, the
  // orientation with --rotate on and what the gauge's getter reads then
  tilt_input(roll, pitch) {
    if (this.acc === null) throw new ValueError(`tilt: ${MODEL} has no accelerometer in the lab (src/fw/models.mjs acc)`);
    this.acc.set(roll, pitch);
    const lab = this.lab, tag = `tilt ${roll} ${pitch}`;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    return this.wait_until(lab.lab_time() + (this.acc.rotate ? ROTATE_TILT_MS : TILT_MS) * 1000000, tag, true, { kind: 'tilt', extra: () => ({ acc: this.acc.status(), gauge: this.acc.gauge() }) });
  }
  // The card in a slot (a body with the file system native and its HLS side, src/fw/models.mjs card_fs.hls): 'remove'
  // takes it out (S-SDCARD's card answers no command), 'insert' puts the same card back. The slot's card
  // switch changes as a body's does (S-KEYBITS' bit of UI_IN's group, which UI_IN decodes natively and the file
  // layer's callback takes), and S-MEDIA (media.mjs) runs the media manager's part of the change in the step; then
  // CARD_MS of lab time. slot: 1 (the default), or 2 on a body whose second slot the lab models (card_fs.second_slot):
  // 'insert' into the empty second slot puts a new blank card there (size: its capacity in GiB, the default card's
  // when null), which the host keeps for the player's next sessions where it can (env.card2's put); with the slot's
  // card the card-detect pin changes too (storage.mjs S-SDCARD)
  card_input(action, slot = 1, size = null) {
    const st = this.storage, media = this.camapp?.media ?? null;
    if (!st || !media) throw new ValueError(`card: ${MODEL} has no card in the lab with its file system and its HLS media side (src/fw/models.mjs card_fs)`);
    if (action !== 'remove' && action !== 'insert') throw new ValueError(`card: action ${show(action)} (remove, insert)`);
    if (slot !== 1 && !(slot === 2 && st.second)) throw new ValueError(`card: slot ${show(slot)} (${st.second ? '1, 2' : '1: the lab models one card slot on this body'})`);
    const drive = slot - 1, at = drive ? ' (slot 2)' : '';
    let card = st.card_of(drive);
    if (size !== null && !(action === 'insert' && card === null)) throw new ValueError(`card ${action}${at}: a size is a new card's, for an insert into the empty second slot`);
    if ((action === 'remove') !== !!card?.present) throw new ValueError(`card ${action}${at}: the card is ${card?.present ? 'in' : 'out of'} the slot already`);
    if (media.busy()) throw new ValueError(`card ${action}${at}: the media layer is busy (a format or a card change runs)`);
    // (E139, E134 and E125: the HLS side's facts read the first slot's switch and media kind alone, src/fw/facts.mjs
    // mediaHls, so the second slot's change at run time is not modelled there; docs/hle-gaps/4.8.md 4.8.17)
    if (!media.f.slots[drive]) throw new ValueError(`card ${action}${at}: ${MODEL}'s HLS media side has no second slot's switch and media kind read (src/fw/facts.mjs mediaHls): the second card goes in at the start only (OM_EMU_CARD2)`);
    const sw = media.f.slots[drive].switch, tag = `card ${action}${drive ? ' 2' : ''}`, lab = this.lab;
    if (card === null) {                                                           // a new card for the second slot
      card = new SdCard(size === null ? {} : { sectors: cardSectors(size) });
      card.remove();
      st.put_card(card);
      lab.env.card2?.put?.(card);
    }
    this.begin(`${String(this.steps.length).padStart(2, '0')}-${tag}`);
    if (action === 'remove') card.remove(); else card.insert();                 // S-SDCARD
    if (st.f.slots) st.detect_pins();                                              // its card-detect pin
    const g = this.card_switch(sw, action === 'insert');                           // the card switch, S-KEYBITS
    const [codes] = this.push_group(g);
    this.camapp.pump();                                                            // S-MEDIA's change, in the step
    return this.wait_until(lab.lab_time() + CARD_MS * 1000000, tag, true,
      { kind: 'card', extra: () => ({ card: st.status(), slot: st.slot(drive), media: media.status(), uiin_codes: codes.map(h8) }) });
  }
  // a card switch's bit in S-KEYBITS' image of its UI_IN group (the switch's entry of CONTROLS), at the level of a
  // card in the slot or of none; returns the group
  card_switch(sw, present) {
    const c = CONTROLS.find((x) => x.kind === 'fwswitch' && x.uiin?.[3] === sw);   // (a row not wired has none)
    if (!c) throw new ValueError(`card: no UI_IN switch control for the card switch 0x${fx(sw, 4)}`);
    const [g, b, bit, , , pol] = c.uiin;
    set_bit(this.images[g], b, bit, present ? pol : 1 - pol);
    return g;
  }
  // the port as the lab sees it: the cable, the E-DDC reads the sink answered, the driver's EDID state, the SCDC
  // writes the sink did not acknowledge and, once the firmware opened the HDMI device, the channel's timing
  // (DisplayLab.hdmi_line)
  hdmi_status() {
    if (!this.hdmi_port) return null;
    const lab = this.lab, [address, bytes] = MODEL_INFO.hdmi.state, b = lab.sim.read(address, bytes);
    let state = 0;
    for (let i = bytes - 1; i >= 0; i--) state = state * 256 + b[i];
    return { cable: lab.sim.u32(HDMI_WINDOW + W_CABLE) ? 'in' : 'out', ddc_reads: lab.sim.u32(HDMI_WINDOW + W_DDC_READS), edid_state: `0x${state.toString(16)}`,
      scdc_writes: lab.sim.u32(HDMI_WINDOW + W_SCDC_WRITES), ...(lab.line_ns.has('hdmi') ? { open: lab.line_ns.get('hdmi') } : {}) };
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
  // The GUI task and the camera application's event tasks that are in the kernel's timeout queue now (dly_tsk or a
  // timed wait): the tasks a display switch's re-entry and the application's start run on.
  chain_sleepers() {
    const lab = this.lab, timed = lab.nk.timed_waiters();
    return [lab.gui_tid, ...(this.camapp?.event_tids() ?? [])].filter((t) => t !== null && timed.includes(t));
  }
  // H-CHAINREST (a body of src/fw/models.mjs chain_sleeps: E146, E147): inside a step whose post-condition is the end
  // of a chain those tasks run (the display switch's re-entry, the application's start), lab time runs on in
  // CHAIN_SLICE_NS slices while one of them sleeps, the stand-ins' replies delivered after each slice as after an input
  // (camapp.pump: S-DISPQ's, S-MODACK's), at most CHAIN_LIMIT_NS. A settle runs the firmware at one lab time, so a
  // chain with a sleep in it is not at its end when the settle returns: E146's and E147's touch driver sleeps 1 ms
  // after it wakes the controller, at the end of the panel's open, of its close and of each set of the gesture mask
  // (D: the OlyTaSS after the write of the controller's power mode register, which E143's wake does not have; the
  // addresses are in src/fw/models.mjs and docs/hle-gaps/4.4.md 4.4.4), so their TFT start ended at the power-on state
  // with no frame and their switch to the TFT before the re-entry (X). Returns {ns, slices, asleep: the tasks still
  // asleep at the bound}; a body without chain_sleeps, and a chain none of the tasks sleeps in, gets no lab time
  // (slices 0). The mutant no-chain-rest leaves it out (test/test_dispswitch.mjs's control).
  chain_rest(label) {
    const lab = this.lab, t0 = lab.lab_time();
    let slices = 0;
    if (!MODEL_INFO.chain_sleeps || this.opts.mutant === 'no-chain-rest') return { ns: 0, slices, asleep: [] };
    while (this.chain_sleepers().length && lab.lab_time() - t0 < CHAIN_LIMIT_NS) {
      try {
        lab.lt.elapse_until(lab.lab_time() + CHAIN_SLICE_NS, () => lab.lab_time(), (t) => lab.run_to_event(t), (this.settle_hooks ?? N.STEP_HOOKS) + N.WAIT_HOOKS_PER_MS);
      } catch (e) {
        if (e instanceof FirmwareError) throw new N.NavError(`${label}: H-CHAINREST: ${e.message.slice(0, 600)}\n` + this.diagnose());
        throw e;
      }
      this.camapp?.pump();
      slices += 1;
    }
    if (slices) this.chain_rests += 1;
    return { ns: lab.lab_time() - t0, slices, asleep: this.chain_sleepers() };
  }
  // SWITCH (M10B): DISPLAY cmd 2 OPEN of want, H-RESEND, H-EYESTATE, H-CONNECT 131 with the sender's lOutput, then the
  // post-conditions; the camera application ends and re-enters the screen itself (with S-OUTDISP).
  live_switch(want, cause) {
    const lab = this.lab;
    if (!this.gate_open()) throw new PlayError(`display switch while the GUI awaits event 0x${lab.sim.u32(B7_GATE).toString(16)} (B7)`);
    const busy = this.gui_busy();
    if (busy) throw new ValueError(`display switch refused: ${busy}`);
    if (this.camapp?.native_tra) return this.native_switch(want, cause);
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
    const chain = this.chain_rest(`SWITCH:${want}`);              // H-CHAINREST: the re-entry's sleeps
    const on_connect = lab.panels.slice(np0).map(([, p]) => p);
    lab.harvest();
    const engine = lab.exec_history.length - e0;
    const layout = lab.b2_snapshot();
    const reads = lab.module9_reads.slice(m9).map(([, site]) => site);
    const problems = [];
    const panel1 = lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null;
    // From S2's rec view (S-RELSEQ's START_RECVIEW to END_RECVIEW) the GUI is in 0x0108 on its rec view screen (E143
    // 0x511f9fc1: its panel word 0x60371628 set to 475, 477 or 481 by 0x511fa2fb), which asks getRecViewState (API
    // 0x20146) and, with the rec view component in standby (S-RVSTANDBY: no rec view), shows no panel, ShowPanelEx(0)
    // at 0x511fa2e0 (D; X on E143, E146 and E147). The application's re-entry ends that screen (ShowPanelEx(0) at
    // 0x512054a6) and builds the shooting screen, panel 10 (0x511eb186), as it does from the shooting screen (X): the
    // switch holds it to the shooting screen, not the rec view. The mutant recview-unheld leaves the rule out
    // (test/test_dispswitch.mjs's control).
    const recview = state0 === STATE_SHOOTING && panel0 === 0 && this.camapp?.in_recview === true && this.opts.mutant !== 'recview-unheld';
    // From the start's date prompt (0x0108 panel 324, the unset clock's prompt over the shooting screen) the re-entry
    // builds the prompt again (ShowPanelEx(324) at 0x5124357f), and the prompt gives way to the shooting screen (panel
    // 10 by 0x511eb186) at the application's next event dispatched through 0x50ab8974. Within the switch's step that
    // event is the switch's own: the eye sensor's module event 0x02022301 (the lab sets the eye sensor's state for LV
    // and the eye sensor alike), which the application's event task (164) reads through its receive 0x503eaabd (called
    // at 0x503ea2b9), parks there in its event ring (push 0x503eb5a0 at 0x503eaba6) and takes from the ring
    // (0x503eb42f at 0x503ea2c3), posting EV_EYESENSOR_STATUS 198 (0x50b79aae). The ring's size, 300 at 0x62a5fc88, is written by
    // the settings init chain's step 10 (0x503ea27e -> 0x503eb3df); with the size 0 the push drops the event
    // (0x503eb5c9), so the narrow H-STOREINIT path, which leaves it 0, ended the prompt 78 ms later at the next
    // event, EV_CHANGE_ZOOM_RING 176, after the step. The chain is the boot's own init: the end within the step is the
    // firmware's (D; X on E143, E146 and E147: the ring's size zeroed after the start gives the narrow path's run,
    // test/test_promptend.mjs; docs/hle-gaps/4.6.md 4.6.10). The switch holds the re-entry to the prompt rebuilt and
    // the shooting screen after it.
    const prompt = state0 === STATE_SHOOTING && panel0 === DATE_PROMPT_PANEL && lab.state() === STATE_SHOOTING && panel1 === SHOOT_PANEL
      && on_connect.lastIndexOf(DATE_PROMPT_PANEL) === on_connect.length - 2 && on_connect.lastIndexOf(0) === on_connect.length - 3;
    const same = state0 === 0x0401 ? SCP_STATES.includes(lab.state())
      : recview ? lab.state() === STATE_SHOOTING && panel1 === SHOOT_PANEL
        : prompt || (lab.state() === state0 && panel1 === panel0);
    if (!same) {
      const left = recview ? `the shooting screen the application re-enters from S2's rec view (${h4(STATE_SHOOTING)} panel ${SHOOT_PANEL})` : `the screen the switch left (${h4(state0)} panel ${panel0})`;
      problems.push(`the re-entry landed on GUI state ${h4(lab.state())} panel ${panel1}, not ${left}` +
        (chain.asleep.length ? `; task(s) ${show(chain.asleep)} still sleep after ${Math.round(chain.ns / 1e6)} ms of lab time (H-CHAINREST's bound)` : '') +
        // E146's and E147's touch close waits for the touch task before its release (src/fw/models.mjs)
        (!this.touch_on && D.HAS_TOUCH ? '; the touch task does not run (touch off): where the touch driver\'s close waits for it (E146, E147), the application\'s event task stays in that close and the screen is not built again; run with the touch on' : ''));
    }
    // the module-9 reads a switch may make: ChangeOutline's first (S-TAKEOVER's state 2 ends it there, X) and the
    // application's; under control camapp 3, where the components write the state themselves (0x50ca4ae1), also
    // the second reads that state 0 reaches (MODULE9_SECOND_READS), not the other readers of the session's
    // S-TAKEOVER scope (camapp.mjs CMP_MODULE9_READERS: none is read at a switch, X; docs/hle-gaps/4.3.md 4.3.6)
    const may = new Set([MM.TAKEOVER_READERS[0], ...CA_MODULE9_READERS,
      ...(this.camapp?.native_tra ? MODULE9_SECOND_READS : [])]);
    if (reads.some((x) => !may.has(x))) problems.push(`module 9 read from ${show(reads.map(hex))}`);
    if (this.touch_on && want === 'tft' && state0 === STATE_SHOOTING && lab.sim.u32(TP_MASK_WORD) !== TP_MASK_ALL) {
      problems.push(`TFT shooting screen rebuilt with gesture mask 0x${lab.sim.u32(TP_MASK_WORD).toString(16)}`);
    }
    if (problems.length && !['no-connect', 'tft-loutput-1'].includes(this.opts.mutant)) throw new PlayError(`SWITCH:${want}: ` + problems.join('; '));
    this.switches += 1;
    if (this.scene !== null && this.scene.liveview) this.scene_attach();
    const ctrl3 = {};
    for (const d of Object.keys(D.DEVICE)) ctrl3[d] = lab.vsc.bank(D.DEVICE[d].channel, true).get('CTRL3') ?? null;
    const rec = { cause, connect: info, layout_before: layout0, layout_after: layout, module9_reads: reads.map(h8), eye, engine, problems,
      panels_on_connect: on_connect, ctrl3, resend: sends.map(([c, d, r]) => [c, bytesHex(d), h8(r)]),
      ...(chain.slices ? { chain_rest: chain } : {}), ...(recview ? { from_recview: true } : {}), ...(prompt ? { prompt_ended: true } : {}) };
    const indices = [CONNECT_INDEX];
    return this.end(`${cause} -> SWITCH:${want}`, 'display', indices, [], { device: want, switch: rec, state_from: h4(state0) });
  }
  // SWITCH under control camapp 3 (docs/hle-gaps/4.3.md 4.3.10): the firmware's own output change. The lab gives two
  // inputs: the eye sensor's state (H-EYESTATE, whose setter publishes EV_EYESENSOR_STATUS natively) and the
  // application's choice of output (S-OUTDISP answers INTERNAL_EVF while this.device is the EVF). From there the
  // firmware runs (X): the application's display change asks getOutputDisplay, on the way to the EVF stops the VSC
  // histogram (TRA 937, DISPLAY cmd 15) and sends the GUI request 131 itself (0x5105053c); the GUI's
  // ConnectChangePlay calls the camera API's output change, which sends TRA 588; CapIod_IODevice opens the device
  // (the opened word) and writes the output-device property, which S-PROP follows (camapp.mjs); on the way back to
  // the TFT the application starts the histogram again (TRA 938). The lab's own DISPLAY cmd 2 OPEN, H-RESEND and
  // H-CONNECT stand in for that chain in camapp 1 and 2 and are not made here: made here, the OPEN closed the TFT
  // under the running histogram before the application's stop (errlog 0x37001418, 4.3.6). Post-conditions: the
  // device the firmware opened, the property, the GUI's connect state, no error log, the module-9 readers. The screen
  // the GUI is on afterwards is recorded and not judged: the lab's switch re-enters the screen it left, the
  // application's own change picks its screen (X: from the Super Control Panel it goes to the shooting screen; the
  // step takes the chain's lab time, about 0.13 s to the EVF, in which the start's date prompt, panel 324, gives way
  // to the shooting screen's panel as in an idle slice).
  // The application's eye handler asks for its output only while property 1947 is not 0 (X: at 0 it sends no 131 and
  // nothing opens; I: the EVF auto switch off, where the camera switches by its EVF button, EV_PRESS_EVFSW, which
  // has no producer in the lab): the step then records that no change was made and the device stays (the eye state
  // stays the one set). No change with 1947 not 0 has no reason read and is an error.
  // A VSC kind 3 body is refused: the lab's OPEN sets such a channel's line time for the device it opens (display.mjs
  // open), the firmware's own open does not.
  native_switch(want, cause) {
    const lab = this.lab, d = lookup(D.DEVICE, want), from = this.device;
    if (this.opts.mutant) throw new ValueError(`display switch: the mutant ${show(this.opts.mutant)} is the lab's own switch's, which control camapp 3 does not make`);
    if (BOARD.vsc.kind === 3) throw new ValueError(`display switch under control camapp 3 on ${MODEL} (VSC kind 3): the channel's line time at the firmware's own open is not set`);
    const state0 = lab.state();
    const panel0 = lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null;
    this.begin(`${String(this.steps.length).padStart(2, '0')}-SWITCH:${want}`);
    lab.harvest();
    const e0 = lab.exec_history.length, m9 = lab.module9_reads.length, err0 = lab.kernel.errors.length;
    const b0 = lab.b2_trace.length, np0 = lab.panels.length;
    const layout0 = lab.b2_snapshot(), opened0 = lab.sim.u32(D.OPENED_WORD) >>> 0, prop0 = lab.props.get(lab.prop_device);
    lab.native_open_begin(want);
    this.device = want;                                            // S-OUTDISP's answer from here on
    const state = lookup(EYE_STATE, want), eye0 = lab.sim.read(EYE_WORD, 1)[0];
    lab.call(EYE_SET, { d0: state }, null, null, 20000);           // H-EYESTATE
    const eye = lab.sim.read(EYE_WORD, 1)[0];
    if (eye !== state) throw new PlayError(`H-EYESTATE: ${h8(EYE_SET)}(${state}) left ${h8(EYE_WORD)} = ${eye}`);
    this.camapp.prop_follow = true;                               // S-PROP follows CapIod's write (camapp.mjs)
    try {
      this.settle(`SWITCH:${want}`);
      this.camapp.pump();
    } finally { this.camapp.prop_follow = false; }
    lab.harvest();
    const trace = lab.b2_trace.slice(b0), names = trace.map((t) => t[1]);
    const vt20 = trace.filter((t) => t[1] === 'vt+20 ret').map((t) => t[2]);
    const states = trace.filter((t) => t[1] === 'SetConnectState').map((t) => t[2]);
    const layout = lab.b2_snapshot(), opened = lab.sim.u32(D.OPENED_WORD) >>> 0, prop = lab.props.get(lab.prop_device);
    const errlog = lab.kernel.errors.slice(err0).filter(([c]) => !D.EXPECTED_ERRLOG.has(c));
    const reads = lab.module9_reads.slice(m9).map(([, site]) => site);
    const shown = trace.map((t) => [t[1], '0x' + t[2].toString(16), typeof t[3] === 'number' ? '0x' + t[3].toString(16) : t[3]]).slice(0, 24);
    const problems = [];
    if (errlog.length) problems.push(`firmware error log: ${errlog.map(([c, , , caller]) => `${h8(c)} from ${caller}`).join('; ')}`);
    const may = new Set([MM.TAKEOVER_READERS[0], ...CA_MODULE9_READERS, ...MODULE9_SECOND_READS]);
    if (reads.some((x) => !may.has(x))) problems.push(`module 9 read from ${show(reads.map(hex))}`);
    // the screen after it is the firmware's (recorded, not a post-condition: the application's display change picks
    // it, e.g. it leaves the Super Control Panel for the shooting screen on the way to the EVF, X)
    const panel1 = lab.panels.length ? lab.panels[lab.panels.length - 1][1] : null;
    const base = { cause, native: true, opened: [h8(opened0), h8(opened)], property: prop, layout_before: layout0, layout_after: layout,
      screen: { from: [h4(state0), panel0], to: [h4(lab.state()), panel1] },
      connect_trace: shown, module9_reads: reads.map(h8), eye, engine: lab.exec_history.length - e0, panels_on_connect: lab.panels.slice(np0).map(([, p]) => p) };
    if (!names.includes('ConnectChangePlay') && opened === opened0 && prop === prop0 && layout.connect === layout0.connect) {
      // the application made no output change on the eye sensor's event
      if (problems.length) throw new PlayError(`SWITCH:${want} (the firmware's own, control camapp 3): ` + problems.join('; '));
      const auto = this.get(EYE_SWITCH_PROPERTY);
      if (auto !== 0) {
        throw new PlayError(`SWITCH:${want} (the firmware's own, control camapp 3): the application made no output change on the eye sensor's event (state ${eye0} -> ${state}) with property ${EYE_SWITCH_PROPERTY} at ${auto}: no reason read`);
      }
      this.device = from;
      const unmade = `${cause}: the application made no output change to the ${want} on the eye sensor's event (state ${state}); ` +
        `property ${EYE_SWITCH_PROPERTY} reads 0, and its eye handler asks for the output only while that is not 0`;
      return this.end(`${cause} -> SWITCH:${want} (not made)`, 'display', [], [], { device: from, switch: { ...base, changed: false, problems }, switch_unmade: unmade, state_from: h4(state0) });
    }
    if (opened !== d.mask) problems.push(`the firmware's output change left the opened word ${h8(opened)} (${h8(opened0)} before), not the ${want}'s ${h8(d.mask)}`);
    if (prop !== d.prop) problems.push(`the output-device property is ${show(prop)}, not the ${want}'s ${d.prop}`);
    if (!names.includes('ConnectChangePlay')) problems.push('ConnectChangePlay did not run (the application sent the GUI no 131)');
    if (vt20.length && vt20[vt20.length - 1] !== 0) problems.push(`ChangeOutline vt+20 returned ${show(vt20)}`);
    if (!states.length || states[states.length - 1] !== lookup(CONNECT_STATE, want)) problems.push(`SetConnectState ${show(states)}, expected ${lookup(CONNECT_STATE, want)}`);
    if (layout.connect !== lookup(CONNECT_STATE, want)) problems.push(`connect state ${show(layout.connect)}, expected ${lookup(CONNECT_STATE, want)}`);
    if (this.touch_on && want === 'tft' && state0 === STATE_SHOOTING && lab.sim.u32(TP_MASK_WORD) !== TP_MASK_ALL) {
      problems.push(`TFT shooting screen rebuilt with gesture mask 0x${lab.sim.u32(TP_MASK_WORD).toString(16)}`);
    }
    if (problems.length) throw new PlayError(`SWITCH:${want} (the firmware's own, control camapp 3): ` + problems.join('; ') + `; trace ${show(shown)}`);
    lab.device = want;
    this.switches += 1;
    if (this.scene !== null && this.scene.liveview) this.scene_attach();
    const ctrl3 = {};
    for (const dev of Object.keys(D.DEVICE)) ctrl3[dev] = lab.vsc.bank(D.DEVICE[dev].channel, true).get('CTRL3') ?? null;
    return this.end(`${cause} -> SWITCH:${want}`, 'display', [], [], { device: want, switch: { ...base, changed: true, problems, ctrl3 }, state_from: h4(state0) });
  }
  // ---- touch
  // down / move / up at pixel (x, y) of the TFT panel (MODEL_INFO.panels: E143's 0..899, 0..599)
  touch(action, x, y) {
    if (!this.touch_on) throw new PlayError('touch is off (--touch off)');
    if (!['down', 'move', 'up'].includes(action)) throw new ValueError(`touch: action ${show(action)} (down, move, up)`);
    this.begin(`${String(this.steps.length).padStart(2, '0')}-touch ${action} ${x},${y}`);
    const lab = this.lab;
    const state0 = lab.state();
    const [w, h] = MODEL_INFO.panels.tft;
    x = clampInt(x, w - 1);
    y = clampInt(y, h - 1);
    const now = lab.lab_time();
    if (action === 'down') lab.tp_down_ns = now;
    lab.tp_touch = { action, x, y, held_ns: now - (lab.tp_down_ns ?? now) };
    lab.tp_flip = this.opts.mutant !== 'no-flip';                    // no-flip: E143's raw y served unflipped
    const g0 = lab.gestures.length, s0 = lab.tp_status.length, r0 = lab.tp_reads.length;
    const flag = unpack('<h', lab.sim.read(TP_FLAG, 2))[0];
    lab.call(OLYEVST, { d0: flag, d1: 1 }, null, null, 5000);
    this.settle(`touch ${action}`);
    // the report of the controller the driver read (none read: none)
    lab.tp_image = lab.tp_slave === null ? new Uint8Array(0) : TOUCH_CONTROLLERS.get(lab.tp_slave).report(lab.tp_touch, h, lab.tp_flip);
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
  // S-TOUCHMAP: post index 109 for every HFW status not yet posted; returns the posts (none where the application
  // forwards the touches itself, app_touch).
  touch_to_gui() {
    const lab = this.lab;
    const posted = [];
    while (this.touch_mapped < lab.tp_status.length) {
      const [, st] = lab.tp_status[this.touch_mapped];
      const gs = lab.status_gesture.get(this.touch_mapped) ?? null;
      this.touch_mapped += 1;
      const km = TOUCHMAP.get(st);
      if ((this.opts.touch ?? 'gui') !== 'gui' || this.app_touch || !km || gs === null) continue;
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
    return this.end('touch gesture', 'touch-gui', posted.map(() => this.touch_index), [], { gestures: lab.gestures.slice(g0),
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
  // S1 down: focus on the layer under the AF point (AF OK), or AF NG, or, where the release's S1 runs no AF (the camera
  // application's focus mode, camapp.mjs HALF_AF), nothing: the lens stays where it is; S2 down: a capture with the
  // exposure in use; REC down: a clip starts or ends.
  scene_key(cid, action) {
    const sc = this.scene;
    if (sc === null || !sc.liveview || action !== 'down') return null;
    const t = this.lab.lab_time() / 1e9;
    if (cid === 's1' && this.camapp?.s1_af === false) return { af: sc.af, focus_m: sc.lens.focus_m, half_af: false };
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
  // start (so the subjects of subject.mjs are where the shown frame has them); a still one at step 0, now.
  scene_step() {
    const sc = this.scene, now = this.lab.lab_time();
    if (!sc.layers.some((l) => l.speed)) return { step: 0, t: now / 1e9 };
    const step = Math.floor(now / SCENE_STEP_NS);
    return { step, t: (step * SCENE_STEP_NS) / 1e9 };
  }
  // The scene's frame for the next composite: rendered again when the scene changed or one of its layers moves (then
  // at most every 1/15 s of lab time). The VSC's histogram unit asks for it too, at the end of the frame it measures
  // (src/dev/vsc.mjs histSource; in_event: inside a device event, so the rows go through the bus device): its bins
  // are then the scene's of that lab time, whether or not a composite was taken since (a --replay takes fewer).
  scene_frame(in_event = false) {
    const sc = this.scene, lv = this.lv;
    if (sc === null || !sc.liveview || lv === null) return;
    if (this.recview_hold || this.playview_hold) return;   // S-RECVIEW / S-PLAYVIEW: the shown capture stays
    const direct = in_event ? lv.address : null;
    if (this.through_off) {                        // S-THROUGH: black until the application starts the through image
      if (lv.key !== 'through off') { lv.key = 'through off'; this.lab.load_lv_frame(this.black_frame(), SCENE_BANK, 1, D.LV_SCALED_CROP, direct); }
      return;
    }
    const { step, t } = this.scene_step();
    const key = JSON.stringify([sc.preset, sc.layers, sc.ev, sc.lens, sc.exposure, step]);
    if (key === lv.key) return;
    lv.key = key;
    this.lab.load_lv_frame(this.scene_render(t), SCENE_BANK, 1, D.LV_SCALED_CROP, direct);
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
    const th = lab.live_view(dev, D.ThRequest.scaled(D.deviceMask(dev), address, D.LV_SCALED_CROP, src, dst, at));
    if (th.img0 !== th.start) throw new PlayError(`S-SCENE: the TH API left img[0] = ${h8(th.img0)}, not the request's start ${h8(th.start)}`);
    this.lv = { device: dev, address, key: this.through_off ? 'through off' : null };
    // the VSC's histogram unit reads the bank at the end of the frame it measures: the scene's frame of that time
    lab.sim.m.devices.vsc.histSource = () => this.scene_frame(true);
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
      lab_ns: lab.lab_time(), gate: lab.sim.u32(B7_GATE), pressed: [...this.pressed].sort(), mode_dial: this.mode_index,
      mode_dial_positions: MODE_DIAL.names, bits,
      ...(this.cdial_index !== null ? { creative_dial: this.cdial_index, creative_dial_positions: BY_ID.get('creative_dial').labels } : {}),
      ...(this.posswitch_at.has('still_movie') ? { still_movie: this.posswitch_at.get('still_movie'), still_movie_positions: BY_ID.get('still_movie').labels } : {}),
      ...(this.carried !== null ? { carried: this.carried } : {}),
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

