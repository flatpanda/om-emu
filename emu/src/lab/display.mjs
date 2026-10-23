// Rear-TFT and EVF output of OM-Emu (VscDebug, DisplayLab: the display
// stand-ins, the lab clock rules, steps, H-TIMER, H-BOOTTIME, start / open, compose, H-RESEND and qewr_posts;
// also the K-native display routing (native_display), the GUI buffers and palettes, the IMG test frame and its
// level-3 attach, the bus window helpers and the live view (ThRequest, the through permit, the TH API), the A6 edge
// guard's IMG branch, dump; the module functions test_card, aspect_code, demo_gui and the colour conversions).
// write_png / write_outputs need zlib and a file system: checks/lib/png.mjs (node), handed to src as env.writeOutputs.
// Addresses are disassembly notation (0x50000000 + body offset) unless marked run-time.
import { A, MODEL, MODEL_INFO, IMAGE_BASE, fact, refuseUnmapped } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import * as IRQ from './irq.mjs';
import { OsdLab, OSD_DEFAULTS } from './osd.mjs';
import { RTOS as RTOS_NAMES } from './rtos.mjs';
import { FirmwareError, disasm, runtime, where } from './hle.mjs';
import { packRegs, REGS } from './sim.mjs';
import { ValueError, IndexError, AssertionError, lookup } from './errors.mjs';
import { vscTables } from '../dev/vscregs.mjs';
import { Unported } from '../core/mem.mjs';
import { show } from '../util/show.mjs';
import { deepEqual } from '../util/equal.mjs';
import { pack, unpack, unpackFrom, bytesHex } from '../util/bytes.mjs';
import { hex, hexDigits as fx } from '../util/hex.mjs';
import { gui_palette } from './osdfmt.mjs';
import { TOUCH_ARGS_E143, DISPLAY_START_E143 } from '../fw/facts.mjs';

// the model's VSC (src/fw/board.mjs; E143: 0x9bb80000, channels of 0x8000, the output block 0x9bb98000)
const BV = BOARD.vsc, GEN2 = BV.kind === 2;
export const VSC = BV.base, VSC_CHANNEL = Array.from({ length: BV.channels }, (_, c) => BV.base + BV.stride * c);
export const VSC_OUTBLOCK = GEN2 ? null : 0x9BB98000;
export const OUTPUT = 0x89000000, DEBUG = 0x89800000, DOORBELL = 0x89810000, STUB = 0x89900000, DOORBELL_STUB = A(0xA2100400);
export const CMD_ADVANCE = 1, CMD_RUN_TO_FRAME = 2, CMD_COMPOSE = 3, CMD_CLEAR = 4, CMD_RUN_TO_EVENT = 5;
export const DBG_ERR_TOTAL = 0x08, DBG_NOTE_TOTAL = 0x0C, DBG_T = 0x10, DBG_LAST_RESULT = 0x1C, DBG_ARG0 = 0x20;
export const DBG_EVENT_SOURCES = 0x30, DBG_CHAN = 0x40, DBG_HDR = 0x100, DBG_PLANE = 0x180, DBG_ERR_RING = 0x400, DBG_NOTE_RING = 0x1000;
export const CH_ASSUME = 0x38, CH_VIEW = 0x39, DBG_FLAGS = 0x4000, DBG_FLAGS_SIZE = 0x1400, ERR_SLOTS = 64, NOTE_SLOTS = 512;
export const ERRORS = ['NONE', 'REG_UNKNOWN', 'WIDTH', 'MIRROR_WRITE', 'MIRROR_LIVE', 'RO_WRITE', 'DEBUG_CPU_WRITE',
  'DOORBELL', 'NOT_LATCHED', 'FIELD_MODE', 'WINDOW', 'MIX_UNOBSERVED', 'PLANC_UNOBSERVED', 'FMT_UNMODELLED',
  'SPOS_UNMODELLED', 'DMA_FIELD', 'DMABN_SHORT', 'DMA_RANGE', 'RSZ_UNMODELLED', 'PEAK_BC', 'BG_FIELD', 'OSDCP2_FIELD',
  'PAL_UNWRITTEN', 'PAL_FIELD', 'UNWRITTEN', 'NOT_RUNNING', 'ORDER', 'FEATURE_UNOBSERVED'];
export const NOTES = ['NONE', 'RESET_READ', 'MIRROR_RESET_READ', 'SRAM_RESET_READ', 'OUT_READ', 'MONI3_IDLE',
  'COMPOSE_RESET', 'ASSUMED', 'SPOS_A18', 'PLANC_ZERO', 'VIEW'];
export const PLANES = ['IMG1', 'IMG2', 'IMG3', 'OSD1', 'OSD2', 'OSD3'];
export const HDR = ['channel', 'width', 'height', 'frame', 'errors', 'pal_unwritten', 'skipped', 'drawn', 'ox', 'oy',
  'mix_flags', 't_lo', 't_hi', 'status', 'assumed', 'view'];
export const PAL_BASE = 0x4400;

// channel: the VSC channel of the device (E143 TFT 2, EVF 1, HDMI 0; kind 2: TFT and EVF on 0, HDMI 1, D 0x5002361c)
export const DEVICE = {
  tft: { mask: 1, channel: GEN2 ? 0 : 2, prop: 1, vtotal_fn: A(0x501D8ABA), period: A(0xA32DB47C) },
  evf: { mask: 2, channel: GEN2 ? 0 : 1, prop: 8, vtotal_fn: A(0x50023BAB), period: A(0xA32DB428) },
};
export const PERIODS_US = [16683, 20000, 10000, 8341];
export const VSC_IRQ = VSC_CHANNEL.map((_, c) => BOARD.intc.irq_vsc0 + 2 * c);
// the vsync event flag id word of each channel (E143 ch0 HDMI, ch1 EVF, ch2 TFT; kind 2 ch0 TFT and EVF, ch1 HDMI)
const VSYNC_E143 = [A(0x6004305E), A(0x600430DE), A(0x60043178)];
export const VSYNC_FLAG_IDS = GEN2 ? [VSYNC_E143[1], VSYNC_E143[0]] : VSYNC_E143;
// flags a channel's ISR sets besides its own (E144's ch0 also sets 0x600417b2, waited by another task: MODEL_INFO)
export const VSYNC_ALIAS_IDS = MODEL_INFO.vsync_alias_flags ?? [];
export const OLYEVCL = A(0x5002BEDD), OLYQERD = A(0x5002C067), OLYQEWR = A(0x5002C151), OLYTASS = A(0x5002C6E5);
export const GET_TID = A(0x5001091E), SYNC_SEND = A(0x5002E39D), PROP_GET = A(0x503EE3BF);
export const OLYEVWT = [...RTOS_NAMES].find(([, name]) => name === 'OlyEvWt')[0];
export const TP_I2C_WRITE = A(0x501E4DFD), TP_I2C_READ = A(0x501E4F2A);
// a build without a touch-panel driver (E145, src/fw/facts.mjs touchDriver) has no touch I2C functions to hook and
// runs as --touch off (src/lab/play.mjs touch_on)
export const HAS_TOUCH = fact('touch_panel.driver', true);
// a touch I2C call's length (which 'write' or 'read'; fact 'touch_args', src/fw/facts.mjs touchArgs: E143's write
// takes it at sp+20 and its read in a1, the E144 driver's at sp+24 and sp+40), looked up when the hook runs; the
// data or buffer is a0 on both
export function tpLength(lab, r, which) {
  const at = fact(`touch_args.${which}_len`, TOUCH_ARGS_E143[`${which}_len`]);
  return at.reg ? r[at.reg] & 0xFFFF : u16(lab.sim.read(r.sp + at.sp, 2), 0);
}
export const DISPLAY_TASK_INIT = A(0x501C2F13), DISP_SYNC_INIT = A(0x507F2FE0);
// its call frame is its one call site's (hle frame(): E143 [0, 4]; E144's boot calls it `call 0x50021444,[],16` at
// 0x50024ef2, D; E139's with [d2], 20, X)
// the DISPLAY task's loop, on a port the static task that runs to the DISPLAY queue's receive (fact 'dispq.loop',
// src/fw/facts.mjs displayLoop)
export const DISPLAY_LOOP = A(0x501C3035), DISPLAY_QUEUE = A(0x600432D4), DISPLAY_TID = A(0x60042D92);
export const CHANGE_LOOP = A(0x501C6D8C), CHANGE_QUEUE = A(0x60043378), CHANGE_WAIT_POLL = A(0x501C74E3);
// a model whose DISPLAY task runs the device changes itself has no DISPLAY_CHANGE task (E144: "[CHG] START" .. "[CHG]
// END" at 0x501711a4..0x50171cc6, D): no CHANGE stand-ins (fact display.change_task, src/fw/facts.mjs displayChangeTask).
// Its EVF's first open creates a task of that name, which the kernel starts and runs natively (CHANGE_ENTRY, fact
// display.change_entry, src/fw/facts.mjs displayChangeEntry; null where the build creates none)
export const HAS_CHANGE = fact('display.change_task', true), CHANGE_ENTRY = fact('display.change_entry', null);
export const GPI_UPDATE_DISPLAY = A(0x510BD4EE);
export const PALETTE_RESEND = A(0x503E52C7), RESEND_KIND = { tft: 1, evf: 32 }, RESEND_SEND_RETURN = A(0x503EC117), DISPIF_ASYNC = A(0x60357648);
export const EXPECTED_ERRLOG = new Map([[0x1C005002, 'camera state store 0x500417da empty in the lab (id read 0)'],
  [0x37005208, '0x501d8e24: mode from the state store is 0, not 1/2'],
  // the device-state table (8-byte slots: a registry key and its entry) is filled by its module's init in the boot,
  // which the lab does not run; a slot read first fills itself with the same lookup of its key and logs this code
  // (docs/model-survey.md, E140: D on E140 and E142; the same fill on E143, E144 and E137, X)
  [0x24000615, 'device-state slot filled on first read (the boot\'s fill of the table is not run)'],
  // the device open calls a wait that attaches an interrupt the lab does not model and polls its flag for 150 ms
  // (`mov 150,d1; call W`), and on its timeout logs this code; held on E144, E139, E142 and E140 only (X, a scan of
  // the 18 expanded images for its `mov imm32,d0`; each body's site and IRQ in its src/fw/models.mjs entry, D)
  [0x37005206, 'device open: its 150 ms interrupt wait times out (the interrupt is not modelled)']]);
export const TASK_STACKS = [A(0xA20F0000), A(0xA20C0000), A(0xA2090000)];
export const TASK_CALLERS = [A(0xA2100300), A(0xA2100340), A(0xA2100380)];
export const TIMER_INIT = A(0x50058959);
export const HW_TIMER_PTR = A(0xA32CA47C);
// the table the hardware-timer init walks: the one it keeps in HW_TIMER_PTR, or its fixed table where the build has
// one (fact hw_timer, src/fw/facts.mjs hwTimer)
const hwTimerTable = (sim) => { const t = fact('hw_timer', { ptr: HW_TIMER_PTR }); return t.table ?? sim.u32(t.ptr); };
export const HW_TIMER_GUARD_RETURNS = new Map([[A(0x50064323), 0x5201], [A(0x50064352), 0x5202], [A(0x5006437D), 0]]);
export const HW_TIMER_PROGRAM = [A(0x50064478), A(0x5006449B), A(0x500644FA)];
export const HW_TIMER_CHANNELS = BOARD.timer.hw_channels;   // range(16, 32) (src/fw/board.mjs)
// the software tick's period in lab ns as the boot step programs it: the tick asks for 2000, its reload (E143: 2.001
// ms, X), or 1999 where the timer start takes one off (2.000 ms; E144/E146/E147: reload 1999, 0x50055f4d, D; E147 X;
// fact timer.reload_less_one, src/fw/facts.mjs timerReloadLessOne)
export const softTickPeriod = () => (fact('timer.reload_less_one', false) ? 2000000 : 2001000);
export const TICK_INIT = A(0x5003121C), HW_TIMER_INIT = A(0x500642DD), TICK_ISR = A(0x50031198);
export const KERNEL_TICK_CHANNELS = BOARD.timer.kernel_ticks, SOFT_TICK_CHANNEL = BOARD.timer.soft_tick;   // src/fw/board.mjs
export const DEFER_INIT = A(0x5005304D), DEFER_TASK = A(0x500530F7);
export const TIMER_TABLE = A(0xA32C5620), TIMER_SLOTS = 32, HW_TIMER_TABLE = A(0xA32C5500), HW_TIMER_SLOTS = 12;
export const TICK_HANDLE = A(0xA32C5930), TICK_CALLBACK = A(0x50058FFC), EVF_TIMER_HANDLE = A(0xA32C1F4C), TIMER_DELETE = A(0x500589D7);
export const GUI_BUFFER_TABLES = [A(0x62B3DFDC), A(0x62B3DFE4), A(0x62B3DFEC)];
export const IMG_FIT = A(0x501DF31A), IMG_FORMAT = A(0x501E1E95), IMG_ADDRESS = A(0x501E20C6);
export const GUI_PALETTES = [[0, 62], [1, 63], [2, 61]];
export const MM_BANK_TABLE = A(0x606DC498), MM_BANKS = 0x77;
// ---- live view through the firmware's own API (M7)
export const TH_API = A(0x501C3F4D), THROUGH_PERMIT = A(0x501C40D0), PERMIT_WORD = A(0xA32DB3A8), OPENED_WORD = A(0xA32DB39C);
export const IMG_STATE = A(0xA32DB480), CTRL_FIELD_BYTE = A(0xA32DDD3C), CMM_STATE_BYTE = A(0xA32DDB81), MM_ADDRESS = A(0x50534DD1);
export const BUS_WINDOW = A(0x50036DA4), BUS_RESTORE = A(0x50036D95), BUS_WINDOW_REG = 0x98100058, BUS_SEGMENT = 0x08000000;
export const LV_BANK_TABLE = A(0x602C2D61);
export const LV_BANKS = new Map([[0x0A, [0x98D4D800, 0x16F0800, 5]], [0x18, [0x98D4D800, 0x16F0800, 5]],
  [0x0E, [0x95F6C800, 0x16F0800, 2]], [0x75, [0xEE087500, 0x16F0800, 5]]]);   // table order 0a, 18, 0e, 75
export const LV_FROM_AREA = [5568, 2160];
export const LV_STRIDE = 2 * LV_FROM_AREA[0];
export const TH_REQUEST_SIZE = 224;
export const MM_UNALLOCATED = new Map([[0x08010004, 'MM handle -> address: bank element not allocated in the lab (observed, not decoded)'],
  [0x08010005, 'MM handle -> address: bank element not allocated in the lab (observed, not decoded)']]);
export const A19_BIT = 4, A20_BIT = 8;
export const OPT_IN = { A15: 'CTRL3 = 0x41, as left by the live-view setup (0x501e04b7(ch, 0) ORs 0x40 into the v1.9 value 1 in progressive scan), does not change the composite of the latched bank',
  A19: 'IMG3 with format 2 and PLANC 0x1000 (the face/AF frame plane CPU 3\'s DISP_FRAME draws, A(0x501dcb1a) setup) is rows of 8-bit indices, nearest-neighbour scaled by its resize steps (output pixel i of row j takes source column floor(i * sh / 4096) of source row floor(j * sv / uv): one per pixel on the TFT, each twice on the EVF, sh = sv = 2048); index 0 leaves the pixel below, 1..7 replace it with the YCbCr word at +0xD00 + 4 * index (Cr << 16 | Cb << 8 | Y, as the channel setup A(0x501db1b4) converts the frame colours of A(0x51016e3e)); +0xD00..+0xD1C then do not change the composite otherwise',
  A20: 'HILIGHT1 (+0x5D0) written 0 shows what HILIGHT1 unwritten shows (A13): highlight and zebra off; its setters only read-modify-write bit 0 and bits 0x330 (D)' };
// ASSUMPTIONS and STAND_INS_M8: the texts write_outputs records (checks/lib/png.mjs)
export const ASSUMPTIONS = {
  "A1": "OSDCP2 bit 4n = 1 displays palette sel n at +0x400 (0x4800 + 0x800n), 0 the other bank",
  "A2": "the whole written bank latches into the mirror at the frame boundary, before INTST bit 0",
  "A3": "MONI3[14:0] counts lines up from 0 at the boundary",
  "A4": "MONI3 bit 16 = 1 in field 1, always in progressive scan",
  "A5": "plane order bottom->top as configured (default IMG1, IMG2, IMG3, OSD1, OSD2, OSD3)",
  "A6": "OSD nearest: column round_half_up(i*step/4096) (the edge pad 0x501db6d5 / 0x501db824 computes the last column so for a step that is a multiple of 4, as the firmware writes), row floor(j*step/4096); IMG two-tap linear, trusted only for the IMG1 steps, area and DMA geometry 0x501df31a wrote for the attached frame, with the fetched span inside that frame (harness IMG_EDGE_UNKNOWN otherwise); behaviour at the last column/row with a second tap past the source is unknown",
  "A7": "OSD blend (src*tra + dst*(31-tra) + 15) // 31; PLANC 0x100 = plane fully applied; PLANC 0 = plane not drawn (record PLANC_ZERO); IMG fmt 0 opaque",
  "A8": "IMG format 0 bytes Y0 Cb Y1 Cr, full-range BT.601, chroma per pixel pair",
  "A9": "PNG = inverse full-range BT.601 of the mixer output (JFIF integers), no gamma",
  "A10": "frame period from the firmware period word; OlyTaSS argument in ms",
  "A11": "O1BC..O3BC/IMG2BC/IMG3BC = 0x10F (the TFT/EVF open value) does not change the mixer output",
  "A12": "channel 2 IMG1 vertical step RSZ4 is in 1/8192 (all other planes and channels 1/4096)",
  "A13": "registers the model does not read do not change the mixer output in the state the v1.9 TFT/EVF paths leave them in: CTRL2/CTRL3, SRAM1/SRAM3, VIDEOAREA3, HDLY, LPF at their v1.9 values, and the 245 registers those paths never write (AREA3, HIST/PEAK/HIAREA, HIBC, COLMAT, HILIGHT, PEAK2-14, TEST1, CMM, ZEBRA, 8MSK, NV*, YCEXT, OSDTAEN, MONDMA, CTRL1, ...) unwritten (FEATURE_UNOBSERVED otherwise); the 142 registers they write with values not checked are listed in spec section 7",
  "A14": "the composite is the mixer output before YGAIN/KNEE/ROT/RGBCNV/CRM/GAM/YCCNV/SETUP/YCCLIP/YCLPF (placed after the mixer by register order only); EVF programs non-identity KNEE/ROT",
  "A16": "VSC and OSD-engine DMA addresses are bus addresses in one flat space (om1.bus): bus 0xa0000000 + n = DRAM offset n (the CPU uncached view), the live-view bank ranges of table 0x602c2d61 are memory, any other bus address is DMA_RANGE",
  "A17": "CPU 0xb8000000..0xbfffffff shows bus segment (byte 3 of 0x98100058) << 27; bytes 0..2 only 14 15 16; reset 0x17161514 (the value 0x50036d95 restores)",
  "A18": "a plane fetches from ((DMASADR << 4) & ~127) + SPOS * Bpp (Bpp 2 IMG format 0, 1 OSD) when the pair is consistent (address bits 6..4 == SPOS * Bpp bits 6..4, SPOS * Bpp < 128, SPOS even for IMG format 0); DMABN counts from the burst start (SPOS_UNMODELLED otherwise; record SPOS_A18); the OSD count of 0x501e00d0/0x501e01b9 does not fit this for a width that is a multiple of 128 (DMABN_SHORT)",
};
export const STAND_INS_M8 = {
  "H-TIMER": "the software-timer boot step 0x50058959 (called at 0x5002cd82) runs natively; the hardware-timer init 0x500642dd (0x5002cd7b) does not, guarded by 0xa32ca47c = 0 and the low-RAM u16 at 6 * ch + 2 = 0 (ch 16..31): 0x50064323/0x50064352/0x5006437d return 0x5201/0x5202/0, returns no caller uses (h_timer: function, channel, return)",
  "H-RESEND": "0x503e52c7(kind, {1, 1, 1}) after a switch, the request openDevice 0x50d83338 makes after its open (0x50d8350d..0x50d83535); openDevice's caller is not traced",
};
export const IMG_BASE = A(0xAD300000), IMG_SIZE = 0xC00000, IMG_STRIDE = 11136;
export const ASPECTS = new Map([['4,3', 0], ['3,2', 1], ['16,9', 2], ['1,1', 3], ['3,4', 4], ['256,135', 5]]);   // 0x501df59e
export const IMG_EDGE_REASONS = new Map([[1, 'plane not attached by a recorded attach (0x501df31a level 3 or the TH API 0x501c3f4d) in this session'],
  [2, 'steps, area, DMA address/stride/bursts, start position or format changed since the attach'],
  [3, 'a fetched column/row (second tap at the last column/row included) lies past the loaded frame'],
  [4, 'latched address/stride do not map onto the loaded frame']]);
export const IMG_STEP_REGS = ['IMG1RSZ1', 'IMG1RSZ2', 'IMG1RSZ4', 'IMG1AREA1', 'IMG1AREA2', 'IMG1DMASADR', 'IMG1DMALD', 'IMG1DMABN', 'IMGDMASPOS', 'IMG1FMT'];
export const LV_SCALED = { tft: [[1620, 1080], [900, 600], [0, 0]], evf: [[1620, 1080], [1600, 1066], [0, 67]] };
export const LV_SCALED_CROP = [1984, 540];

// The 224-byte request of the through-image API 0x501c3f4d (ThRequest: fields in this order,
// pack, rec_view, scaled, replace(); shown as its fields in this order).
const TH_FIELDS = ['device_type', 'address', 'c_address', 'layer_format', 'resize', 'lut_onoff', 'prm_pic_mode',
  'input_color_space', 'output_color_space', 'output_bit_width', 'from_coordinate', 'from_area', 'from_target', 'to_target',
  'to_coordinate', 'fit_coordinate', 'fit_size', 'egpk_exec', 'egpk_sv', 'zebra_prm', 'drange_ptn'];
export class ThRequest {
  constructor(device_type, address, f = {}) {
    Object.assign(this, { device_type, address, c_address: 0, layer_format: 1, resize: 0, lut_onoff: 0, prm_pic_mode: 0,
      input_color_space: 0, output_color_space: 0, output_bit_width: 0, from_coordinate: [0, 0], from_area: [...LV_FROM_AREA],
      from_target: [0, 0], to_target: [0, 0], to_coordinate: [0, 0], fit_coordinate: [0, 0],
      fit_size: [0, 0, 0], egpk_exec: 0, egpk_sv: 0, zebra_prm: 0, drange_ptn: 0 });
    for (const [k, v] of Object.entries(f)) {
      if (!TH_FIELDS.includes(k)) throw new TypeError(`ThRequest: unknown field ${k}`);
      this[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  replace(f) { const r = new ThRequest(this.device_type, this.address); for (const k of TH_FIELDS) r[k] = this[k]; for (const [k, v] of Object.entries(f)) r[k] = Array.isArray(v) ? [...v] : v; return r; }
  toJSON() { return Object.fromEntries(TH_FIELDS.map((k) => [k, this[k]])); }
  pack() {
    const r = new Uint8Array(TH_REQUEST_SIZE);
    r.set(pack('<IIIII', this.device_type >>> 0, this.address, this.c_address, this.layer_format, this.resize), 0);
    r.set([this.lut_onoff, this.prm_pic_mode, this.input_color_space, this.output_color_space, this.output_bit_width], 21);
    r.set(pack('<10H', ...this.from_coordinate, ...this.from_area, ...this.from_target, ...this.to_target, ...this.to_coordinate), 40);
    r.set(pack('<5H', ...this.fit_coordinate, ...this.fit_size), 60);
    r.set(pack('<Ih', this.egpk_exec, this.egpk_sv), 72);
    r.set(pack('<IB', this.zebra_prm, this.drange_ptn), 216);
    return r;
  }
  // rec_misc 0x5054c1ad's request (centre, size, aspect code; E = 0xFFFE)
  static rec_view(mask, address, centre, size, aspect, area = LV_FROM_AREA) {
    const E = 0xFFFE, [cx, cy] = centre, [w, h] = size;
    const at = [(cx - Math.floor(w / 2)) & E, (cy - Math.floor(h / 2)) & 0xFFFF];
    return new ThRequest(mask, address, { layer_format: 0, from_coordinate: at, from_area: area, from_target: [w & E, h],
      to_target: [w & E, h], to_coordinate: at, fit_coordinate: [cx & E, cy & E], fit_size: [w, h, aspect] });
  }
  // H-REQ: harness-chosen geometry, layer_format 1 (YC422), STILL, colour fields 0
  static scaled(mask, address, crop, src, dst, at, area = LV_FROM_AREA) {
    return new ThRequest(mask, address, { from_coordinate: crop, from_area: area, from_target: src, to_target: dst, to_coordinate: at });
  }
}

// A9: inverse full-range BT.601 (JFIF integer form). Returns [r, g, b].
export function ycc_to_rgb(word) {
  const y = word & 0xFF, cb = (word >>> 8) & 0xFF, cr = (word >>> 16) & 0xFF;
  const r = y + ((91881 * (cr - 128) + 32768) >> 16);
  const g = y + ((-22554 * (cb - 128) - 46802 * (cr - 128) + 32768) >> 16);
  const b = y + ((116130 * (cb - 128) + 32768) >> 16);
  return [r, g, b].map((v) => Math.max(0, Math.min(255, v)));
}
// The firmware's integer BT.601 (BG 0x501de385..d8, palette 0x501e053f, library 0x5048ef33..76)
export function rgb_to_ycc(r, g, b) {
  const y = ((19595 * r + 38470 * g + 7471 * b) >> 16) & 0xFF;
  const cb = ((((-11056 * r - 21712 * g + (b << 15)) >> 16) + 128) & 0xFF);
  const cr = (((((r << 15) - 27440 * g - 5328 * b) >> 16) + 128) & 0xFF);
  return [y, cb, cr];
}
export function words_to_rgb(words) {
  const out = new Uint8Array(3 * words.length), cache = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let v = cache.get(w);
    if (v === undefined) cache.set(w, v = ycc_to_rgb(w));
    out[3 * i] = v[0]; out[3 * i + 1] = v[1]; out[3 * i + 2] = v[2];
  }
  return out;
}
// The rows of words_to_rgb for raw little-endian composite bytes, one RGB Uint8Array per row.
export function ycc_rows_to_rgb(raw, width) {
  const words = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)), rows = [];
  for (let o = 0; o < words.length; o += width) rows.push(words_to_rgb(words.subarray(o, o + width)));
  return rows;
}
// Deterministic YC 4:2:2 card: [width, height, rows] (75% bars, luma ramp, Cb ramp, Cr ramp, 16-step grey, 1-px white
// border, 40-px corner markers); rows that are equal share one Uint8Array.
export function test_card(width = 1620, height = 1080) {
  const packRow = (pixels) => {
    const row = new Uint8Array(2 * width);
    for (let x = 0; x < width; x += 2) {
      const [y0, cb0, cr0] = pixels[x], [y1, cb1, cr1] = pixels[x + 1];
      row.set([y0, (cb0 + cb1) >> 1, y1, (cr0 + cr1) >> 1], 2 * x);
    }
    return row;
  };
  const bars = [[191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191], [0, 0, 0]];
  const ramp = (x) => Math.floor(x * 255 / (width - 1));
  const range = (f) => Array.from({ length: width }, (_, x) => f(x));
  const bands = [[0.6, range((x) => rgb_to_ycc(...bars[Math.floor(x * 8 / width)]))],
    [0.7, range((x) => rgb_to_ycc(ramp(x), ramp(x), ramp(x)))],
    [0.8, range((x) => [128, ramp(x), 128])],
    [0.9, range((x) => [128, 128, ramp(x)])],
    [1.0, range((x) => { const v = Math.floor(x * 16 / width) * 17; return rgb_to_ycc(v, v, v); })]];
  const white = rgb_to_ycc(255, 255, 255), markers = [rgb_to_ycc(255, 0, 0), rgb_to_ycc(0, 255, 0), rgb_to_ycc(0, 0, 255), rgb_to_ycc(255, 255, 255)];
  const rows = [], cache = new Map();
  for (let y = 0; y < height; y++) {
    const k = bands.findIndex(([limit]) => y < limit * height), band = bands[k][1];
    const top = y < 41, bottom = y >= height - 41;
    const key = `${k},${y === 0 || y === height - 1},${top && y > 0},${bottom && y < height - 1}`;
    if (!cache.has(key)) {
      let px = [...band];
      if (y === 0 || y === height - 1) px = Array(width).fill(white);
      else {
        if (top || bottom) {
          for (let i = 1; i < 41; i++) px[i] = markers[top ? 0 : 2];
          for (let i = width - 41; i < width - 1; i++) px[i] = markers[top ? 1 : 3];
        }
        px[0] = px[width - 1] = white;
      }
      cache.set(key, packRow(px));
    }
    rows.push(cache.get(key));
  }
  return [width, height, rows];
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function aspect_code(width, height) {
  const g = gcd(width, height), ratio = `${width / g},${height / g}`;
  if (!ASPECTS.has(ratio)) {
    throw new ValueError(`${width}x${height}: aspect ${width / g}:${height / g} has no firmware code (0x501df59e: ` + [...ASPECTS.keys()].map((k) => k.replace(',', ':')).join(', ') + ')');
  }
  return ASPECTS.get(ratio);
}

// the stub's pages and presets: the board's (src/fw/board.mjs stub_pages, stub_presets)
export const STUB_PAGES = BOARD.stub_pages, STUB_PRESETS = BOARD.stub_presets;

const h8 = (v) => '0x' + fx(v >>> 0, 8);
const inRange = (v, [a, b]) => v >= a && v < b;
export class TaskDone extends Error {}          // _TaskDone: the task body reached its second OlyQeRd
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const u16 = (b, o) => b[o] | b[o + 1] << 8;
const words = (b, n) => { const out = []; for (let i = 0; i < n; i++) out.push(u32(b, 4 * i)); return out; };
const counter = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
export { counter };

// Debugger view of om1-vsc: no side effects (GDB requester id).
export class VscDebug {
  constructor(sim, image) {
    this.sim = sim;
    let magic;
    try { magic = sim.u32(DEBUG); } catch (e) {
      if (e?.name === 'RuntimeError') throw new FirmwareError(`the machine has no VSC debug window (${e.message})`);
      throw e;
    }
    if (magic !== 0x4D435356) throw new FirmwareError(`VSC debug window magic ${h8(magic)}: not emu's VSC model`);
    const t = vscTables(image);
    this.names = new Map(t.chan);
    this.offsets = new Map(t.chan.map(([off, name]) => [name, off]));
    this.out_names = new Map(t.out);
  }
  u32(offset) { return this.sim.u32(DEBUG + offset); }
  channel(c) {
    const w = words(this.sim.read(DEBUG + DBG_CHAN + 0x40 * c, 48), 12);
    const order = Array.from(this.sim.read(DEBUG + DBG_CHAN + 0x40 * c + 0x30, 6), (i) => (i < 6 ? PLANES[i] : i));
    return { running: w[0], frames: w[1], field: w[2], moni3: w[3], irq: w[4], line_ns: w[5],
      frame_start: w[6] + w[7] * 4294967296, length: w[8], latched: w[9], compose: w[10], order };
  }
  irq_line(c) { return this.u32(DBG_CHAN + 0x40 * c + 0x10); }
  set_line_ns(c, value) { this.sim.word(DEBUG + DBG_CHAN + 0x40 * c + 0x14, value); }
  // kind 2: the line time of the channel's EVF bank (SYNC8; set_line_ns gives the SYNC2 bank's); the channel runs from
  // the bank whose vertical total the firmware wrote last (src/dev/vsc.mjs)
  set_line_ns_evf(c, value) { this.sim.word(DEBUG + DBG_CHAN + 0x40 * c + 0x2C, value); }
  set_order(c, order) {
    this.sim.write(DEBUG + DBG_CHAN + 0x40 * c + 0x30, new Uint8Array(order.map((p) => { const i = PLANES.indexOf(p); if (i < 0) throw new ValueError(`${show(p)} is not in list`); return i; })));
  }
  // Lab plane view (not a hardware claim): only the planes of mask (bit p = PLANES[p]) are composited.
  set_view(c, mask) { this.sim.write(DEBUG + DBG_CHAN + 0x40 * c + CH_VIEW, new Uint8Array([mask & 0x3F])); }
  set_assume(c, bits) { this.sim.write(DEBUG + DBG_CHAN + 0x40 * c + CH_ASSUME, new Uint8Array([bits])); }
  assumed(c) { return this.sim.read(DEBUG + DBG_CHAN + 0x40 * c + CH_ASSUME, 1)[0]; }
  time() { const b = this.sim.read(DEBUG + DBG_T, 8); return u32(b, 0) + u32(b, 4) * 4294967296; }
  _ring(totalOffset, base, slots, size) {
    const total = this.u32(totalOffset), recs = [];
    for (let n = Math.max(0, total - slots); n < total; n++) recs.push(words(this.sim.read(DEBUG + base + size * (n % slots), size), size / 4));
    return [total, recs];
  }
  errors() {
    const [total, recs] = this._ring(DBG_ERR_TOTAL, DBG_ERR_RING, ERR_SLOTS, 32);
    return [total, recs.map((r) => ({ code: r[0], name: r[0] < ERRORS.length ? ERRORS[r[0]] : String(r[0]), pc: r[1],
      channel: r[2], offset: r[3], value: r[4], args: r.slice(5, 8) }))];
  }
  notes() {
    const [total, recs] = this._ring(DBG_NOTE_TOTAL, DBG_NOTE_RING, NOTE_SLOTS, 16);
    return [total, recs.map((r) => ({ kind: r[0] < NOTES.length ? NOTES[r[0]] : String(r[0]), pc: r[1], channel: r[2] >>> 16,
      offset: r[2] & 0xFFFF, value: r[3] }))];
  }
  flags(c, which) {
    return this.sim.read(DEBUG + DBG_FLAGS + DBG_FLAGS_SIZE * c + { w: 0, m: 0x400, pal: 0x800 }[which], which !== 'pal' ? 0x3A1 : 0x600);
  }
  // Map {name: value or null}: one read per run of consecutive named, flagged offsets.
  // Kind 2's latched values are the *_VL words (+0x400): its mirror bank lists the registers that have one.
  bank(c, mirror = false) {
    const base = VSC_CHANNEL[c] + (mirror ? (GEN2 ? 0x400 : 0x2000) : 0);
    const flags = this.flags(c, mirror ? 'm' : 'w');
    const listed = [...this.names].filter(([, name]) => !(mirror && (name === 'INTEN1' || name === 'INTST1' || name === 'MONI3'))
      && !(GEN2 && (name.endsWith('_VL') || (mirror && !this.offsets.has(name + '_VL')))));
    const wanted = listed.filter(([off]) => flags[off >> 2]).map(([off]) => off).sort((a, b) => a - b);
    const values = new Map();
    let run = [];
    for (const off of [...wanted, null]) {
      if (run.length && (off === null || off !== run[run.length - 1] + 4)) {
        const ws = words(this.sim.read(base + run[0], 4 * run.length), run.length);
        run.forEach((o, i) => values.set(o, ws[i]));
        run = [];
      }
      if (off !== null) run.push(off);
    }
    return new Map(listed.map(([off, name]) => [name, values.has(off) ? values.get(off) : null]));
  }
  // 6 banks x 256 words (sel 0..2, bank 0..1) and their written flags: [words, flags]
  palette(c) {
    const data = this.sim.read(VSC_CHANNEL[c] + PAL_BASE, 0x1800);
    return [words(data, 1536), this.flags(c, 'pal')];
  }
  header() {
    const w = words(this.sim.read(DEBUG + DBG_HDR, 64), 16), out = {};
    HDR.forEach((k, i) => { out[k] = w[i]; });
    return out;
  }
  planes() {
    const out = {};
    PLANES.forEach((name, i) => {
      const w = words(this.sim.read(DEBUG + DBG_PLANE + 32 * i, 32), 8);
      if (w[0]) {
        out[name] = { result: w[0] === 0x100 ? 'drawn' : w[0] === 0x101 ? 'not drawn (PLANC 0)' : ERRORS[w[0]],
          x0: w[1], y0: w[2], w: w[3], h: w[4], base: w[5], stride: w[6], palette: w[7] };
      }
    });
    return out;
  }
  output(width, height) { const raw = this.output_raw(width, height); return Array.from(new Uint32Array(raw.buffer, raw.byteOffset, raw.length >> 2)); }
  // The last composite as raw little-endian words (Cr << 16 | Cb << 8 | Y): one debugger read (no side effects).
  output_raw(width, height) { return this.sim.m.dbgRead(OUTPUT, 4 * width * height).slice(); }
}

export function format_vsc_error(e) {
  if (e.source === 'harness') return `${e.name} (harness) ch ${e.channel} off 0x${fx(e.offset, 4)} reason ${e.value}: ${e.why}`;
  return `${e.name} pc ${h8(e.pc)} ch ${e.channel} off 0x${fx(e.offset, 4)} value ${h8(e.value)} args ${show(e.args.map(hex))}`;
}

// OsdLab + the display stack. Model errors and unexpected firmware error-log calls raise
// unless a step says otherwise; notes are collected. opts: { props, timer_init, time } (keyword arguments of
// DisplayLab.__init__), applied in preinit (before OsdLab's init runs the subclass's native_init).
export class DisplayLab extends OsdLab {
  constructor(env, opts = {}) {
    super(env, 0, opts.kernel ?? OSD_DEFAULTS.kernel, opts);
    this.vsc = new VscDebug(this.sim, this.image);
    if (this.sim.u32(STUB) !== 0x42555453) throw new FirmwareError("lab stub window missing: not emu's lab stub model");
    this.install_stub();
    // S-PROP's output-device property: E143's id 4513, `mov 4513,d0` before the GUI's read whose return is S-PROP's site
    // (src/lab/menu.mjs PROP_GUI_SITES, D); another build's is read there (src/fw/facts.mjs propDevice: 4013 on E125
    // and E145)
    this.prop_device = fact('prop.device', 4513);
    this.props = new Map(opts.props ? Object.entries(opts.props).map(([k, v]) => [+k, v]) : [[this.prop_device, 1]]);
    this.prop_reads = new Map();
    this.i2c = []; this.change_msgs = []; this.depth = 0;
    this.steps = [];
    this.notes = [];
    this.time_log = [];
    this.vsync_waits = new Map(); this.vsync_frames = new Map();
    this.stub_seen = 0;
    for (let c = 0; c < VSC_CHANNEL.length; c++) this.kernel.add_source(VSC_IRQ[c], () => this.vsc.irq_line(c) !== 0);
    this.hook(OLYEVCL, (h, r) => this._evcl(h, r), 'OlyEvCl');
    this.hook(GET_TID, (h, r) => this._get_tid(h, r), 'get_tid');
    if (HAS_TOUCH) {
      this.hook(TP_I2C_WRITE, (h, r) => this._i2c_write(h, r), 'tp_i2c_write');
      this.hook(TP_I2C_READ, (h, r) => this._i2c_read(h, r), 'tp_i2c_read');
    }
    this.hook(SYNC_SEND, (h, r) => this._sync_send(h, r), 'sync_send');
    this.hook(PROP_GET, (h, r) => this._prop(h, r), 'prop_get');
    this.hook(OLYTASS, (h, r) => this._sleep(h, r), 'OlyTaSS');
    // S-DISPSTART: the DISPLAY task makes the calls of its start-up (its entry's, before its receive) once, when it
    // starts, and then loops on the receive; the lab runs the task from its entry for each command (task_message), so
    // each such call runs the first time and is stepped over after (fact dispq.start, src/fw/facts.mjs displayStart,
    // which has the evidence). Run in every command, E125's start-up powered the TFT on again, whose open posts to the
    // touch task, which then read its queue inside the display run (X).
    const started = new Set();
    for (const at of fact('dispq.start', DISPLAY_START_E143)) {
      this.hook(at, (h, r) => { if (started.has(at)) h.skip_call(r); else { started.add(at); this.sim.run([], true); } }, 'S-DISPSTART');
    }
    this.chgwait = [];
    this.display_sends = [];
    if (HAS_CHANGE) this.hook(CHANGE_WAIT_POLL, (h, r) => this._chgwait(h, r), 'S-CHGWAIT');
    this._qewr = this.hooks.get(runtime(OLYQEWR));
    this.hook(OLYQEWR, (h, r) => this._olyqewr(h, r), 'OlyQeWr');
    const kernel = this.kernel;
    this._orig_wait = (h, r) => Object.getPrototypeOf(kernel)._wait.call(kernel, h, r);
    kernel._wait = (h, r) => this._wait(h, r);
    this.line_ns = new Map();
    this.img = null;
    this.img_attach = new Map();
    this.img_path = null;
    this.assumptions_in_use = new Set();
    this.chgwait_native = [];
    if (this.kernel_mode === 'native' && !this.own_kernel) this.native_display();
  }
  preinit(opts) {
    super.preinit(opts);
    this.timer_init = opts.timer_init ?? true;
    this.timer_log = null;
    this.time_mode = opts.time ?? false;
    this.time_log_boot = null;
    this.hdmi = opts.hdmi ?? false;                  // the HDMI port (the machine's hdmi option): H-GIOSLOTS in start()
  }
  static skip_defer = false;
  get skip_defer() { return this.constructor.skip_defer; }
  // K-native display stand-ins (M9 default; MenuLab routes its own): OlyEv* on the three VSC vsync flags keep
  // the host-side flags and clock rules (the rtos.mjs stand-ins, OlyEvCl = _evcl), every other flag runs natively;
  // OlyQeWr to the CHANGE queue stays the synchronous DISPLAY_CHANGE stand-in, OlyTaSS the display clock (A10), get_tid
  // and the synchronous DISPLAY send stay; S-CHGWAIT becomes an observer of the native poll 0x501c74e3 (its return value
  // must be 1); K-CHANGE: the CHANGE task is activated (act_tsk) and must wait at its first receive.
  native_display() {
    const vsync = new Set([...VSYNC_FLAG_IDS, ...VSYNC_ALIAS_IDS].map((a) => u16(this.sim.read(a, 2), 0)));
    this.vsync_ids = vsync;
    const scoped = (name, stub, native) => (hle, r) => ((vsync.has(r.d0 & 0xFFFF) ? stub : native)(hle, r));
    for (const [address, name] of RTOS_NAMES) {
      if (['OlyEvSt', 'iOlyEvSt', 'OlyEvWt', 'OlyEvCl', 'OlyEvDl'].includes(name)) {
        const stub = name === 'OlyEvCl' ? (h, r) => this._evcl(h, r) : this.rtos_stubs.get(address)[0];
        this.hook(address, scoped(name, stub, this.rtos_observer(name)), name + '(scoped)');
      }
    }
    if (!HAS_CHANGE) return;
    const retSites = [runtime(A(0x501C74AA)), runtime(A(0x501C74DB))];       // the two calls of the poll in 0x501c74a4
    const poll = (hle, r) => {
      const ra = r.mdr;
      if (!retSites.includes(ra)) throw new FirmwareError(`CHANGE poll ${h8(CHANGE_WAIT_POLL)} from ${where(ra)}`);
      this.chgwait.push(where(ra));
      const back = (hle2, r2) => {
        this.hooks.delete(ra);
        this.chgwait_native.push(r2.d0 & 0xFF);
        if ((r2.d0 & 0xFF) !== 1) throw new FirmwareError(`native CHANGE poll ${h8(CHANGE_WAIT_POLL)} returned ${r2.d0 & 0xFF}: the DISPLAY_CHANGE task is not waiting to receive`);
        this.sim.run([], true);
      };
      this.hook_rt(ra, back, 'obs-chgwait return');
      this.sim.run([], true);
    };
    this.hook(CHANGE_WAIT_POLL, poll, 'obs-chgwait');
    refuseUnmapped(CHANGE_LOOP, 'K-CHANGE');
    const ids = [];
    for (const [tid, [entry]] of this.nk.tasks()) if (entry === CHANGE_LOOP) ids.push(tid);
    if (ids.length !== 1) throw new FirmwareError(`K-CHANGE: static tasks with entry ${h8(CHANGE_LOOP)}: ${show(ids)}`);
    this.change_tid = ids[0];
    const [rc] = this.nk.svc('act_tsk', { d0: this.change_tid });
    if (rc !== 0 || this.nk.state(this.change_tid) !== 4) {
      throw new FirmwareError(`K-CHANGE: act_tsk(CHANGE task ${this.change_tid}) = ${rc}, state ${this.nk.state(this.change_tid)}`);
    }
  }

  // ---- lab stub and doorbell
  install_stub() {
    const allow = new Uint8Array(12 * 32), presets = new Uint8Array(16 * 128);
    STUB_PAGES.forEach((page, i) => allow.set(pack('<III', page, 0x1000, 1), 12 * i));
    STUB_PRESETS.forEach(([a, v], i) => presets.set(pack('<IIII', a, v, 0, 1), 16 * i));
    this.sim.write(STUB + 0x100, allow);
    this.sim.write(STUB + 0x400, presets);
  }
  stub_log() {
    const total = this.sim.u32(STUB + 8), cap = this.sim.u32(STUB + 16);
    const out = [];
    for (let n = Math.max(this.stub_seen, total - cap); n < total; n++) {
      const [pc, addr, value, info] = unpack('<4I', this.sim.read(STUB + 0x10000 + 16 * (n % cap), 16));
      out.push({ pc, addr, value, size: info & 15, write: !!(info & 16), denied: !!(info & 32), preset: !!(info & 64), unwritten: !!(info & 128) });
    }
    this.stub_seen = total;
    return out;
  }
  cpu_store(address, value) {
    const after = this.sim.cpu_store(address, value, DOORBELL_STUB);
    if (after.fault || after.pc !== DOORBELL_STUB + 1) throw new FirmwareError(`store 0x${(value >>> 0).toString(16)} to ${h8(address)}: fault ${after.fault} at ${h8(after.pc)}`);
  }
  doorbell(cmd, channel = 0, arg = 0) {
    this.sim.write(DEBUG + DBG_ARG0, pack('<II', arg % 4294967296, Math.floor(arg / 4294967296)));
    this.cpu_store(DOORBELL, cmd | channel << 8);
    return this.vsc.u32(DBG_LAST_RESULT);
  }
  advance(ns, cause) {
    this.doorbell(CMD_ADVANCE, 0, ns);
    this.time_log.push([cause, this.vsc.time()]);
    this.kernel.deliver();
  }
  run_to_frame(c, cause) {
    if (this.doorbell(CMD_RUN_TO_FRAME, c)) {
      throw new FirmwareError(`${cause}: VSC channel ${c} is not running (line_ns ${this.vsc.channel(c).line_ns}, SYNC2 not written?)`);
    }
    counter(this.vsync_frames, c);
    this.time_log.push([cause, this.vsc.time()]);
  }
  // ---- stand-ins
  _wait(hle, r) {
    const ids = VSYNC_FLAG_IDS.map((a) => u16(this.sim.read(a, 2), 0));
    const flag = r.d0 & 0xFFFF;
    if (ids.includes(flag)) {
      const c = ids.indexOf(flag);
      counter(this.vsync_waits, c);
      const saved = { ...r };
      this.kernel.deliver();
      if (!(((this.kernel.flags.get(flag) ?? 0) & saved.d1) >>> 0)) this.run_to_frame(c, `OlyEvWt vsync ch${c} from ${where(saved.mdr)}`);
      if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
      r = saved;
    }
    return this._orig_wait(hle, r);
  }
  _sleep(hle, r, name = 'OlyTaSS') {
    const ms = r.d0;
    this.kernel.events.push(['rtos', name, `d0=${ms}`, where(r.mdr)]);
    const saved = { ...r };
    this.advance(ms * 1000000, `${name}(${ms}) from ${where(saved.mdr)}`);
    if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
    hle.finish(saved, { d0: 0 });
  }
  _evcl(hle, r) {
    const flag = r.d0 & 0xFFFF;
    this.kernel.flags.set(flag, ((this.kernel.flags.get(flag) ?? 0) & r.d1) >>> 0);
    this.kernel.events.push(['rtos', 'OlyEvCl', `d0=0x${r.d0.toString(16)} d1=0x${r.d1.toString(16)}`, where(r.mdr)]);
    hle.finish(r, { d0: 0 });
  }
  _chgwait(hle, r) {
    this.chgwait.push(where(r.mdr));
    hle.finish(r, { d0: 1 });
  }
  _get_tid(hle, r) {
    this.sim.write(r.a0, this.sim.read(DISPLAY_TID, 2));
    hle.finish(r, { d0: 0 });
  }
  _prop(hle, r) {
    const pid = r.d0 & 0xFFFF;
    if (!this.props.has(pid)) throw new FirmwareError(`property ${pid} read from ${where(r.mdr)}: no value given`);
    counter(this.prop_reads, pid);
    hle.finish(r, { d0: this.props.get(pid) });
  }
  _i2c_write(hle, r) {
    const n = tpLength(this, r, 'write');
    const data = n ? this.sim.read(r.a0, n) : new Uint8Array(0);
    this.i2c.push(['W', r.d0 & 0xFF, r.d1 & 0xFF, bytesHex(data)]);
    hle.finish(r, { d0: 0 });
  }
  _i2c_read(hle, r) {
    const n = tpLength(this, r, 'read');
    this.sim.write(r.a0, new Uint8Array(n));
    this.i2c.push(['R', r.d0 & 0xFF, r.d1 & 0xFF, n]);
    hle.finish(r, { d0: 0 });
  }
  _queue(address) { return u16(this.sim.read(address, 2), 0); }
  _sync_send(hle, r) {
    const q = r.d0 & 0xFFFF;
    this.kernel.events.push(['send', `queue ${q} cmd ${r.d1}`, `param 0x${r.a0.toString(16)}`, where(r.mdr)]);
    if (q === this._queue(DISPLAY_QUEUE)) {
      const saved = { ...r };
      this.display_sends.push([r.d1, r.a0 ? this.sim.read(r.a0, 16) : new Uint8Array(0), disasm(r.mdr)]);
      this.task_message(DISPLAY_LOOP, DISPLAY_QUEUE, pack('<IIII', 0, 0, r.d1, r.a0), `DISPLAY cmd ${r.d1}`);
      if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
      r = saved;
    }
    hle.finish(r, { d0: 0 });
  }
  _olyqewr(hle, r) {
    if (HAS_CHANGE && (r.d0 & 0xFFFF) === this._queue(CHANGE_QUEUE)) {
      const [ptr, size] = unpack('<II', this.sim.read(r.a0, 8));
      this.change_msgs.push(this.sim.read(ptr, size));
      hle.finish(r, { d0: 0 });
      return;
    }
    this._qewr[0](hle, r);
  }
  // Run a real task body for one message: its first OlyQeRd gets msg, its second ends the run. Nested runs (a
  // handler sending to DISPLAY) get their own stack. wait {flag, bit} (the flag's id word and a mask) is for a task
  // that waits on an event flag before it receives (the touch task, src/fw/facts.mjs touchQueue): its first OlyEvWt
  // on that flag returns bit as the flag's pattern and its second ends the run; its waits on other flags run as
  // before.
  task_message(loop, queueAddress, msg, label, limit = 300000, wait = null) {
    const queue = this._queue(queueAddress);
    let n = 0;
    const level = this.depth;
    const qerd = (hle, r) => {
      if ((r.d0 & 0xFFFF) !== queue) throw new FirmwareError(`OlyQeRd on queue ${r.d0 & 0xFFFF} from ${where(r.mdr)}`);
      n += 1;
      if (n > 1) throw new TaskDone();
      this.sim.write(this.sim.u32(r.a0), msg);
      hle.finish(r, { d0: 0 });
    };
    const key = runtime(OLYQERD), saved = this.hooks.get(key);
    const evKey = runtime(OLYEVWT), evSaved = this.hooks.get(evKey);
    this.hook(OLYQERD, qerd, `OlyQeRd(${label})`);
    if (wait !== null) {
      const flag = this._queue(wait.flag);
      if (!evSaved) throw new FirmwareError(`${label}: OlyEvWt is not hooked, so a wait on another flag has no stand-in to run`);
      let waits = 0;
      this.hook(OLYEVWT, (hle, r) => {
        if ((r.d0 & 0xFFFF) !== flag) { evSaved[0](hle, r); return; }
        waits += 1;
        if (waits > 1) throw new TaskDone();
        if (r.a0) this.sim.write(r.a0, pack('<I', wait.bit));
        hle.finish(r, { d0: 0 });
      }, `OlyEvWt(${label})`);
    }
    this.depth += 1;
    try {
      // a fourth nested run raises IndexError (TASK_STACKS has three levels); undefined here would fall back to
      // calls()'s defaults and reuse the outermost call's stack and trampoline
      if (level >= TASK_STACKS.length) throw new IndexError('list index out of range');
      this.calls(loop, null, TASK_STACKS[level], TASK_CALLERS[level], limit);
      throw new FirmwareError(`${label}: task body returned`);
    } catch (e) {
      if (!(e instanceof TaskDone)) throw e;
    } finally {
      this.depth -= 1;
      this.hooks.set(key, saved);
      if (wait !== null) this.hooks.set(evKey, evSaved);
    }
  }
  display_cmd(cmd, param) {
    const address = param !== null ? this.alloc(param, 16) : 0;
    this.task_message(DISPLAY_LOOP, DISPLAY_QUEUE, pack('<IIII', 0, 0, cmd, address), `DISPLAY cmd ${cmd}`);
  }
  drain_display_change() {
    while (this.change_msgs.length) {
      const msg = this.change_msgs.shift();
      this.task_message(CHANGE_LOOP, CHANGE_QUEUE, msg, `DISPLAY_CHANGE cmd ${msg[8]}`);
    }
  }
  // ---- steps: run one step; collect firmware error-log calls, model errors and notes, stub accesses.
  step(name, action, allow_errors = [], allow_errlog = []) {
    const ev0 = this.kernel.events.length, err0 = this.kernel.errors.length;
    const result = action();
    const errlog = this.kernel.errors.slice(err0);
    const [total, errors] = this.vsc.errors();
    const [ntotal, notes] = this.vsc.notes();
    this.doorbell(CMD_CLEAR);
    const stub = this.stub_log();
    this.notes.push(...notes);
    if (notes.length) this.labObserver?.dnote(notes);          // the tracer (format /4)
    const unexpected = errlog.filter((e) => !EXPECTED_ERRLOG.has(e[0]) && !allow_errlog.includes(e[0]));
    const bad = errors.filter((e) => !allow_errors.includes(e.name));
    const denied = stub.filter((s) => s.denied);
    const record = { name, errlog: errlog.map(([c, , , caller]) => [h8(c), caller]), vsc_errors: errors,
      vsc_error_total: total, note_total: ntotal, stub, events: this.kernel.events.slice(ev0) };
    this.steps.push(record);
    this.labObserver?.dstep(record);
    const problems = [];
    if (unexpected.length) problems.push('firmware error log: ' + unexpected.map(([c, , , caller]) => `${h8(c)} from ${caller}`).join('; '));
    if (bad.length || total > errors.length) problems.push(`${total} VSC model error(s): ` + errors.map(format_vsc_error).join('; '));
    if (denied.length) {
      problems.push(`${denied.length} lab-stub access(es) denied: ` + denied.slice(0, 5).map((s) => `${s.write ? 'W' : 'R'} ${h8(s.addr)} pc ${where(s.pc)}`).join('; '));
    }
    if (ntotal > NOTE_SLOTS) problems.push(`${ntotal} notes overflowed the ring`);
    if (problems.length) throw new FirmwareError(`step "${name}": ` + problems.join(' | '));
    return result;
  }
  // Boot step 0x50058959 natively under the H-TIMER guard; returns the guard log [(function, channel, return)].
  software_timer_init() {
    refuseUnmapped(HW_TIMER_PTR, 'H-TIMER');
    const ptr = this.sim.u32(HW_TIMER_PTR);
    const low = new Map();
    for (let ch = HW_TIMER_CHANNELS[0]; ch < HW_TIMER_CHANNELS[1]; ch++) low.set(ch, u16(this.sim.read(6 * ch + 2, 2), 0));
    if (ptr || [...low.values()].some((v) => v)) {
      throw new FirmwareError(`H-TIMER: hardware timer table pointer ${h8(HW_TIMER_PTR)} = 0x${ptr.toString(16)}, low-RAM u16 at 6 * ch + 2 = ${show(low)}: the guard needs 0 and 0`);
    }
    const log = [], saved = new Map();
    const guard = (fn) => (hle, r) => {
      const ra = r.mdr;
      if (this.hooks.has(ra)) throw new FirmwareError(`H-TIMER: ${h8(fn)} returns to ${where(ra)}, already hooked`);
      const rec = [fn, r.d0 & 0xFFFF, null];
      log.push(rec);
      const back = (hle2, r2) => {
        rec[2] = r2.d0 & 0xFFFF;
        this.hooks.delete(ra);
        this.sim.run([], true);
      };
      this.hook_rt(ra, back, 'H-TIMER return');
      this.sim.run([], true);
    };
    const program = (fn) => (hle, r) => {
      throw new FirmwareError(`H-TIMER: ${h8(fn)} reached from ${where(r.mdr)}: the software-timer init would program timer hardware`);
    };
    for (const fn of HW_TIMER_GUARD_RETURNS.keys()) {
      saved.set(runtime(fn), this.hooks.get(runtime(fn)) ?? null);
      this.hook(fn, guard(fn), 'H-TIMER guard');
    }
    for (const fn of HW_TIMER_PROGRAM) {
      saved.set(runtime(fn), this.hooks.get(runtime(fn)) ?? null);
      this.hook(fn, program(fn), 'H-TIMER stop');
    }
    const err0 = this.kernel.errors.length;
    try {
      this.step('software timer init 0x50058959 (boot step, called at 0x5002cd82; H-TIMER: the hardware timer init 0x500642dd is not run)',
        () => this.call(TIMER_INIT, null, null, null, 20000));
    } finally {
      for (const [address, old] of saved) {
        if (old === null) this.hooks.delete(address);
        else this.hooks.set(address, old);
      }
    }
    const rec = this.steps[this.steps.length - 1];
    const problems = [];
    if (rec.stub.length) problems.push(`lab-stub accesses ${show(rec.stub.slice(0, 4).map((x) => [hex(x.addr), where(x.pc)]))}`);
    if (this.kernel.errors.length > err0) problems.push(`error log ${show(this.kernel.errors.slice(err0).map((e) => hex(e[0])))}`);
    const bad = log.filter(([fn, ch, rv]) => rv !== HW_TIMER_GUARD_RETURNS.get(fn) || !inRange(ch, HW_TIMER_CHANNELS))
      .map(([fn, ch, rv]) => [h8(fn), ch, rv]);
    if (bad.length || !log.length) {
      const want = [...HW_TIMER_GUARD_RETURNS].map(([k, v]) => `${show(hex(k))}: ${show(hex(v))}`).join(', ');
      problems.push(`hardware-timer calls (function, channel, return) ${bad.length ? show(bad) : 'none'}, expected {${want}}`);
    }
    if (problems.length) throw new FirmwareError('H-TIMER: ' + problems.join('; '));
    this.timer_log = log.map(([fn, ch, rv]) => [h8(fn), ch, rv]);
    return this.timer_log;
  }
  // ---- lab time (M9)
  lab_time() { return this.vsc.time(); }
  run_to_event(limit) {
    if (this.doorbell(CMD_RUN_TO_EVENT, 0, limit)) throw new FirmwareError(`RUN_TO_EVENT(${limit}) refused at lab time ${this.vsc.time()}`);
    const sources = this.vsc.u32(DBG_EVENT_SOURCES);
    this.time_log.push([`RUN_TO_EVENT ${limit}`, this.vsc.time()]);
    return sources;
  }
  // H-BOOTTIME: the timer boot steps natively in boot order, then H-DEFER.
  boot_time() {
    const nk = this.nk;
    if (!nk || nk.intc === null) throw new FirmwareError('time mode needs K-native with native interrupts (NativeKernel irq native)');
    const timer = this.timer = new IRQ.TimerDebug(this.sim);
    const intc = nk.intc;
    this.lt.strict_levels = false;
    this.lt.time_mode = true;
    const problems = [], log = [];
    // status: whether the call's d0 is a status to check (0 for success)
    const run = (label, fn, limit = 20000, status = true) => {
      const r = this.step(label, () => this.call(fn, null, null, null, limit));
      if (status && (r.d0 & 0xFFFF)) problems.push(`${label}: returned 0x${r.d0.toString(16)}`);
      log.push([h8(fn), r.d0 & 0xFFFF]);
    };
    // the tick init's d0 is no status: the boot does not read it (`mov 3,d0` after the call 0x5002ccd7, D), and builds
    // whose init ends without setting it return the last register value (E130's ends `or 1,d0; mov d0,(a0); ret`, the
    // timer block's IE word, where E143's and E133's clear d0 first, D); its channels are checked below instead
    run('H-BOOTTIME kernel tick timers 0x5003121c (boot call 0x5002ccd7)', TICK_INIT, 20000, false);
    const bad = new Map();
    for (const n of KERNEL_TICK_CHANNELS) {
      const c = timer.channel(n);
      if (!(c.running === 1 && c.period === 1000000 && c.reload === 999)) bad.set(n, c);
    }
    const tickMask = KERNEL_TICK_CHANNELS.reduce((m, n) => m | 1 << (n - 1), 0);
    if (bad.size || (timer.ie() & tickMask) !== tickMask) problems.push(`kernel tick channels ${bad.size ? show(bad) : 'ok'}, IE 0x${timer.ie().toString(16)}`);
    if (intc.level(IRQ.irq_timer(1)) !== 1 << 5 || this.sim.u32(IRQ.HANDLER_TABLE + 4 * IRQ.irq_timer(1)) !== runtime(TICK_ISR)) {
      problems.push(`IRQ ${IRQ.irq_timer(1)}: level register 0x${intc.level(IRQ.irq_timer(1)).toString(16)}, handler ${h8(this.sim.u32(IRQ.HANDLER_TABLE + 4 * IRQ.irq_timer(1)))}`);
    }
    run('H-BOOTTIME hardware timer init 0x500642dd (boot call 0x5002cd7b)', HW_TIMER_INIT);
    const table = hwTimerTable(this.sim);
    const enabled = [];
    for (let ch = 0; ch < BOARD.timer.hw_entries; ch++) if (table && u16(this.sim.read(table + 6 * ch + 2, 2), 0) === 1) enabled.push(ch);
    const attached = [];
    for (let ch = 1; ch < 33; ch++) {
      if (IRQ.irq_timer(ch) < 0) continue;                   // no such channel on the model's board
      for (let b = 0; b < IRQ.BANKS.length; b++) if (intc.bank_level(b, IRQ.irq_timer(ch))) { attached.push(ch); break; }
    }
    run('H-BOOTTIME software timer init 0x50058959 (boot call 0x5002cd82)', TIMER_INIT);
    const soft = timer.channel(SOFT_TICK_CHANNEL);
    if (!soft.running || soft.period !== softTickPeriod() || !((timer.ie() >>> (SOFT_TICK_CHANNEL - 1)) & 1)) {
      problems.push(`software tick channel ${SOFT_TICK_CHANNEL}: ${show(soft)}, IE 0x${timer.ie().toString(16)}`);
    }
    const level = intc.level(IRQ.irq_timer(SOFT_TICK_CHANNEL));
    if (level !== 1 << 3) problems.push(`IRQ ${IRQ.irq_timer(SOFT_TICK_CHANNEL)} level register 0x${level.toString(16)}, want 1 << 3`);
    if (!this.skip_defer) {
      this.lt.allow.add(DEFER_TASK);
      run('H-DEFER task 16 init 0x5005304d', DEFER_INIT, 200000);
    }
    const terr = timer.errors()[0];
    if (terr || intc.errors()[0]) problems.push(`timer errors ${show(timer.errors())}, controller errors ${show(intc.errors())}`);
    if (problems.length) throw new FirmwareError('H-BOOTTIME: ' + problems.join('; '));
    const running = new Map();
    for (const [n, c] of timer.running()) running.set(n, [c.period, c.t0]);
    this.time_log_boot = { steps: log, table: h8(table), enabled, attached, running, ie: h8(timer.ie()) };
    return this.time_log_boot;
  }
  // H-GIOSLOTS (the HDMI port, src/dev/hdmi.mjs; docs/hle-gaps.md 4.9): the reset of the GIO interrupt slots that the
  // GIO init ends with (src/fw/models.mjs hdmi.gio_slots), natively and before the display init. The GIO init does not
  // run in the lab, so without the reset the display init's registration of the hot-plug pin finds no free slot and
  // gives up without a word (X); after it the registration takes slot and handler and attaches the pin's group IRQ
  // natively (hpd_attached checks the IRQ). The init's other two steps, the board's pin configuration, are not run: they
  // write the pin block, whose pages are the lab stub's
  gio_slots() {
    const port = MODEL_INFO.hdmi;
    if (!port) throw new FirmwareError(`H-GIOSLOTS: ${MODEL} has no HDMI port in the lab (src/fw/models.mjs hdmi)`);
    if (!this.sim.m.devices.hdmi) throw new FirmwareError('H-GIOSLOTS: the machine has no HDMI port (its hdmi option is off)');
    if (!this.nk?.intc) throw new FirmwareError('H-GIOSLOTS: the HDMI port needs K-native with native interrupts');
    this.step('H-GIOSLOTS', () => this.call(port.gio_slots, null, null, null, 20000));
  }
  hpd_attached() {
    const { irq } = BOARD.hdmi.hpd, level = this.nk.intc.level(irq), handler = this.sim.u32(IRQ.HANDLER_TABLE + 4 * irq);
    if (level !== 1 << 5 || !handler) throw new FirmwareError(`H-GIOSLOTS: after the display init the hot-plug pin's IRQ ${irq} has level register 0x${level.toString(16)}, handler ${h8(handler)}: its registration did not take`);
  }
  // Software-timer init (or, in time mode, H-BOOTTIME), display task init + disp_sync init, then the lab clock of
  // channels 1 and 2.
  start() {
    if (this.time_mode) this.boot_time();
    else if (this.timer_init) this.software_timer_init();
    if (this.hdmi) this.gio_slots();
    this.step('display task init 0x501c2f13', () => this.call(DISPLAY_TASK_INIT));
    if (this.hdmi) this.hpd_attached();
    this.step('disp_sync init 0x507f2fe0', () => this.call(DISP_SYNC_INIT));
    // H-DISPINIT2: where the display init leaves the devices' setup (their frame period words among it) to the first
    // DISPLAY OPEN, which runs it once behind a guard word, the lab runs it here, between the init and the OPEN as
    // natively, but on the lab task, and sets the guard as the OPEN does, so that the OPEN skips it (fact
    // display.init_2nd, src/fw/facts.mjs displayInit2nd; E143's display task init does that setup itself)
    const init2 = fact('display.init_2nd', null);
    if (init2) this.step('H-DISPINIT2 display init, second part', () => { this.sim.word(init2.once, 1); this.call(init2.entry); });
    for (const [dev, d] of Object.entries(DEVICE)) {
      const period = this.sim.u32(d.period);
      if (!PERIODS_US.includes(period)) {
        throw new FirmwareError(`${dev}: frame period word ${h8(d.period)} = ${period}, not one of (${PERIODS_US.join(', ')}): no line time (no default)`);
      }
      const vtotal = this.call(d.vtotal_fn, { d0: 1 }).d0;
      const line = Math.floor(period * 1000 / vtotal);
      this.line_ns.set(dev, { period_us: period, vtotal, line_ns: line });
      // kind 2's TFT and EVF share channel 0, each with its own bank of timing registers: the channel runs at the
      // line time of the bank whose vertical total the firmware wrote last (src/dev/vsc.mjs), so a switch keeps the
      // shown device's timing until the firmware programs the other's (E144's EVF open first waits for a TFT frame
      // as it powers the TFT down, X)
      if (GEN2 && dev === 'evf') this.vsc.set_line_ns_evf(d.channel, line);
      else this.vsc.set_line_ns(d.channel, line);
    }
  }
  open(device) {
    this.props.set(this.prop_device, lookup(DEVICE, device).prop);
    this.step(`DISPLAY cmd 2 OPEN ${device} (mask ${lookup(DEVICE, device).mask})`, () => {
      this.display_cmd(2, pack('<I', lookup(DEVICE, device).mask));
      this.drain_display_change();
    });
    this.device = device;
  }
  // [(handle, active, mode, period, callback (disassembly), arg)] of a timer table (slot layout of 0x50058a62/0x50058edf)
  timer_slots(table = TIMER_TABLE, n = TIMER_SLOTS) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = this.sim.read(table + 24 * i, 24);
      const [handle, active, mode] = unpackFrom('<HHH', b, 0), [period, cb, arg] = unpackFrom('<III', b, 8);
      out.push([handle, active, mode, period, cb ? disasm(cb) : 0, arg]);
    }
    return out;
  }
  // GUI layer L -> (front, back) VRAM records in the tables gpiUpdateDisplay reads; GUI init is not run.
  set_gui_buffers() {
    const recs = this.records, pairs = [[recs[2], recs[3]], [recs[4], recs[5]], [recs[0], recs[1]]];
    GUI_BUFFER_TABLES.forEach((table, i) => this.sim.write(table, pack('<II', ...pairs[i])));
  }
  palettes(label = 'GPISetPalette layers 0/1/2 = palettes 62/63/61') {
    this.step(label, () => { for (const [layer, pid] of GUI_PALETTES) this.set_palette(layer, gui_palette(this.image, pid)); });
  }
  update(label = 'gpiUpdateDisplay(0) 0x510bd4ee') {
    this.step(label, () => this.call(GPI_UPDATE_DISPLAY, { d0: 0 }, null, null, 300000));
  }
  // Draw with the real osddraw path; errors of earlier display steps are not drawing errors.
  draw(body) {
    this.kernel.deliver();
    this.errlog_seen = this.kernel.errors.length;
    const st = this.drawing_enter();
    try { body(); } catch (e) { this.drawing_exit(st, e); }
    return this.drawing_exit(st);
  }
  // ---- IMG plane
  // The IMG region must not meet any memory-manager bank based in the uncached DRAM view 0xA0000000..0xB7FFFFFF.
  check_img_region() {
    const live = [];
    for (let bank = 0; bank < MM_BANKS; bank++) {
      const [, obj] = unpack('<II', this.sim.read(MM_BANK_TABLE + 8 * bank, 8));
      if (!obj) continue;
      const w = words(this.sim.read(obj, 32), 8);
      const base = w[2], size = w[3], count = w[5] & 0xFFFFFF;
      if (size && w[6] >>> 16 === 5568) live.push({ bank, base, size, count, width: w[6] >>> 16, height: w[7] });
      if (base >= 0xA0000000 && base < 0xB8000000 && size) {
        const end = base + size * Math.max(count, 1);
        if (base < IMG_BASE + IMG_SIZE && IMG_BASE < end) throw new FirmwareError(`IMG region meets MM bank 0x${fx(bank, 2)} ${h8(base)}..${h8(end)}`);
      }
    }
    return live;
  }
  _sha(rows) {
    const h = this.env.createHash('sha256');
    for (const r of rows) h.update(r);
    return h.digest('hex');
  }
  load_img(frame) {
    const [width, height, rows] = frame;
    if (rows[0].length > IMG_STRIDE || height * IMG_STRIDE > IMG_SIZE) {
      throw new ValueError(`${width}x${height} does not fit the IMG region (${IMG_STRIDE} B x ${Math.floor(IMG_SIZE / IMG_STRIDE)} rows)`);
    }
    rows.forEach((row, y) => this.sim.write(IMG_BASE + y * IMG_STRIDE, row));
    this.img = { width, height, base: IMG_BASE, stride: IMG_STRIDE, sha256: this._sha(rows) };
  }
  // The test frame rows still hold what load_img / load_lv_frame wrote (run before every composite); a frame in a
  // live-view bank is re-read through the firmware's bus window.
  check_img_unchanged() {
    const n = 2 * this.img.width;
    let rows;
    if (this.img.bus) rows = this.bus_rows(this.img.base, this.img.stride, n, this.img.height);
    else { rows = []; for (let y = 0; y < this.img.height; y++) rows.push(this.sim.read(IMG_BASE + y * IMG_STRIDE, n)); }
    if (this._sha(rows) !== this.img.sha256) {
      const where_ = this.img.bus ? `live-view bank 0x${fx(this.img.bank, 2)} element ${this.img.element}` : `IMG region ${h8(IMG_BASE)}`;
      throw new FirmwareError(`${where_}: test frame rows changed since they were loaded`);
    }
  }
  // ---- bus (A16/A17): the firmware's live-view buffers
  // LV_BANKS against the static table 0x602c2d61 in the image (run time address)
  verify_lv_banks() {
    const off = LV_BANK_TABLE - IMAGE_BASE, rows = [];
    for (let i = 0; i < 4; i++) rows.push(unpackFrom('<III', this.image, off + 12 * i));
    const want = [0x0A, 0x18, 0x0E, 0x75].map((b) => [LV_BANKS.get(b)[2], LV_BANKS.get(b)[0], LV_BANKS.get(b)[1]]);
    if (!deepEqual(rows, want)) throw new FirmwareError(`live-view bank table ${h8(LV_BANK_TABLE)} = ${show(rows)}, expected ${show(want)}`);
    return rows;
  }
  // Native 0x50036da4(bus): stores the segment into 0x98100058 and returns the CPU address.
  bus_map(bus) {
    const cpu = this.call(BUS_WINDOW, { d0: bus }).d0 >>> 0;
    if (cpu !== ((0xB8000000 | (bus & (BUS_SEGMENT - 1))) >>> 0)) throw new FirmwareError(`0x50036da4(${h8(bus)}) returned ${h8(cpu)}`);
    return cpu;
  }
  // Native 0x50036d95: restores 0x17161514.
  bus_unmap() { this.call(BUS_RESTORE, null, null, [0, 0]); }
  _bus_pieces(bus, n) {
    const out = [];
    while (n) {
      const k = Math.min(n, BUS_SEGMENT - (bus & (BUS_SEGMENT - 1)));
      out.push([bus, k]);
      bus = (bus + k) >>> 0; n -= k;
    }
    return out;
  }
  bus_read(bus, n) {
    const out = new Uint8Array(n);
    let pos = 0;
    for (const [start, k] of this._bus_pieces(bus, n)) {
      const cpu = this.bus_map(start);
      try { for (let o = 0; o < k; o += 0x10000) out.set(this.sim.read(cpu + o, Math.min(0x10000, k - o)), pos + o); } finally { this.bus_unmap(); }
      pos += k;
    }
    return out;
  }
  bus_write(bus, data) {
    let pos = 0;
    for (const [start, k] of this._bus_pieces(bus, data.length)) {
      const cpu = this.bus_map(start);
      try { for (let o = 0; o < k; o += 0x10000) this.sim.write(cpu + o, data.subarray(pos + o, pos + Math.min(k, o + 0x10000))); } finally { this.bus_unmap(); }
      pos += k;
    }
  }
  // Read (data null) or write `rows` rows of n bytes at bus base + r * stride, mapping the window once per 128 MiB
  // segment with the firmware's own functions.
  bus_rows(base, stride, n, rows, data = null) {
    const out = [], segMask = ~(BUS_SEGMENT - 1) >>> 0;
    let r = 0;
    while (r < rows) {
      const a = base + r * stride, seg = (a & segMask) >>> 0;
      if ((((a + n - 1) & segMask) >>> 0) !== seg) {               // this row crosses a segment end
        if (data === null) out.push(this.bus_read(a, n)); else this.bus_write(a, data[r]);
        r += 1;
        continue;
      }
      this.bus_map(a);
      try {
        while (r < rows) {
          const a2 = base + r * stride;
          if (((a2 & segMask) >>> 0) !== seg || (((a2 + n - 1) & segMask) >>> 0) !== seg) break;
          const cpu = (0xB8000000 | (a2 & (BUS_SEGMENT - 1))) >>> 0;
          if (data === null) out.push(this.sim.read(cpu, n)); else this.sim.write(cpu, data[r]);
          r += 1;
        }
      } finally { this.bus_unmap(); }
    }
    return out;
  }
  // Native MM handle -> address 0x50534dd1(bank << 8 | element), cross-checked with the table.
  bus_address(bank, element) {
    const handle = bank << 8 | element;
    const address = this.step(`MM handle 0x${fx(handle, 4)} -> address (0x50534dd1)`, () => this.call(MM_ADDRESS, { d0: handle }).d0 >>> 0, [], [...MM_UNALLOCATED.keys()]);
    const [base, size, count] = LV_BANKS.get(bank);
    if (!(element >= 1 && element <= count) || address !== base + (element - 1) * size) {
      throw new FirmwareError(`0x50534dd1(0x${fx(handle, 4)}) = ${h8(address)}, table ${h8(LV_BANK_TABLE)} gives ${h8(base + (element - 1) * size)}`);
    }
    return address;
  }
  // Write a test frame into live-view bank `bank` element `element` at buffer pixel `crop`, through the bus window.
  load_lv_frame(frame, bank = 0x0A, element = 1, crop = [0, 0]) {
    const [width, height, rows] = frame, [x, y] = crop;
    if (x % 2 || x + width > LV_FROM_AREA[0] || y + height > LV_FROM_AREA[1]) {
      throw new ValueError(`${width}x${height} at ${show(crop)} does not fit the ${show(LV_FROM_AREA)} live-view buffer`);
    }
    const address = this.bus_address(bank, element);
    const base = address + y * LV_STRIDE + 2 * x;
    this.bus_rows(base, LV_STRIDE, 2 * width, height, rows);
    this.img = { width, height, base, stride: LV_STRIDE, sha256: this._sha(rows), bus: true, bank, element, crop: [x, y], address };
    return address;
  }
  // Native 0x501c40d0(d0 = mask, d1 = on): the through permit the TH API checks (0x501c41a5).
  through_permit(device, on) {
    const mask = lookup(DEVICE, device).mask;
    this.step(`through permit 0x501c40d0(mask ${mask}, ${on})`, () => this.call(THROUGH_PERMIT, { d0: mask, d1: on }));
    const word = this.sim.u32(PERMIT_WORD);
    if (!!(word & mask) !== !!on) throw new FirmwareError(`through permit ${h8(PERMIT_WORD)} = 0x${word.toString(16)} after 0x501c40d0(${mask}, ${on})`);
    return word;
  }
  // Native call of the through-image API 0x501c3f4d with `request` (ThRequest) in harness memory; records the attach
  // for the A6 guard when the firmware stored this request's start address as the channel's img[0]. Returns the
  // registers it changed in both banks.
  live_view(device, request, allow_errors = [], allow_errlog = []) {
    const c = lookup(DEVICE, device).channel;
    const before = [this.vsc.bank(c), this.vsc.bank(c, true)];
    const address = this.alloc(request.pack(), 16);
    this.step(`live-view API 0x501c3f4d (TH) on ${device}`, () => this.call(TH_API, { a0: address }, null, null, 20000), allow_errors, allow_errlog);
    const after = [this.vsc.bank(c), this.vsc.bank(c, true)];
    const changed = before.map((b, i) => {
      const out = new Map();
      for (const [k, v] of after[i]) if (v !== b.get(k)) out.set(k, [b.get(k), v]);
      return out;
    });
    const [x, y] = request.from_coordinate;
    const start = (request.address + y * 2 * request.from_area[0] + 2 * (x & ~1)) >>> 0;
    const img0 = this.sim.u32(IMG_STATE + 3112 * c);
    if (img0 === start && request.address) {
      this.img_attach.set(c, { regs: this.img_steps(c), src: [...request.from_target], base: start, stride: 2 * request.from_area[0], path: 'TH', frame: this._frame_rect() });
      this.img_path = 'level 4: live-view API 0x501c3f4d';
    }
    return { written: changed[0], mirror: changed[1], img0, request: address, start };
  }
  _frame_rect() {
    if (!this.img) return null;
    if (this.img.bus) return [this.img.address, ...this.img.crop, this.img.width, this.img.height];
    return [this.img.base, 0, 0, this.img.width, this.img.height];
  }
  // Level 3 (the function-level attach): the firmware's own IMG1 setters, called directly (0x501df31a fit, 0x501e1e95 format,
  // 0x501e20c6 address).
  attach_img(device, aspect) {
    const d = lookup(DEVICE, device);
    const slot = this.alloc(pack('<I', this.img.base), 4);
    const address = this.step(`IMG1 attach on ${device}: 0x501df31a, 0x501e1e95, 0x501e20c6`, () => {
      this.call(IMG_FIT, { d0: d.mask, d1: 0, a0: slot }, pack('<HHBxxxHH', this.img.width, this.img.height, aspect, 0, 0));
      const a = this.sim.u32(slot);
      this.call(IMG_FORMAT, { d0: d.channel, d1: 0, a0: 0 });
      this.call(IMG_ADDRESS, { d0: d.channel, d1: a, a0: 0, a1: 0 });
      return a;
    });
    this.img_path = 'level 3: 0x501df31a + 0x501e1e95 + 0x501e20c6 (direct calls)';
    this.img_attach.set(d.channel, { regs: this.img_steps(d.channel), src: [this.img.width, this.img.height],
      base: this.img.base, stride: this.img.stride, path: 'L3', frame: this._frame_rect() });
    return address;
  }
  // Everything the model's IMG1 fetch depends on (the VSC model's plane setup), recorded at the attach.
  img_steps(c, mirror = false) {
    const flags = this.vsc.flags(c, mirror ? 'm' : 'w'), base = VSC_CHANNEL[c] + (mirror ? 0x2000 : 0);
    return IMG_STEP_REGS.map((n) => { const off = this.vsc.offsets.get(n); return flags[off >> 2] ? this.sim.u32(base + off) : null; });
  }
  // The TH attach's source = from_target at the crop origin, clipped to the loaded frame; null when the crop origin
  // or the request's stride does not map onto the loaded frame.
  _th_source(fit) {
    const frame = this._frame_rect();
    if (!frame || !deepEqual(frame, fit.frame) || fit.stride !== this.img.stride) return null;
    const [address, fx_, fy, fw, fh] = frame;
    const offset = fit.base - (address + fy * fit.stride + 2 * fx_);
    if (offset < 0 || offset % fit.stride % 2) return null;
    const y = Math.floor(offset / fit.stride), x = Math.floor((offset % fit.stride) / 2);
    if (x >= fw || y >= fh) return null;
    return [Math.min(fit.src[0], fw - x), Math.min(fit.src[1], fh - y)];
  }
  // Registers (both banks), palette in use, routing: what the composite was made from.
  dump(device) {
    const c = lookup(DEVICE, device).channel;
    const written = this.vsc.bank(c), mirror = this.vsc.bank(c, true);
    const [pal, palFlags] = this.vsc.palette(c);
    const osdcp2 = mirror.get('OSDCP2') ?? 0;
    const displayed = {};
    for (let n = 0; n < 3; n++) displayed[`OSD${n + 1}`] = PAL_BASE + 0x800 * n + (((osdcp2 >>> (4 * n)) & 1) ? 0x400 : 0);
    const out_ctrl = {};
    for (const [off, name] of this.vsc.out_names) if (name.startsWith('OUT_CTRL')) out_ctrl[name] = this.sim.u32(VSC_OUTBLOCK + off);
    return { written, mirror, palette: pal, palette_written: Array.from(palFlags), displayed_palette: displayed, out_ctrl, channel: this.vsc.channel(c) };
  }
  // OlyQeWr calls outside the CHANGE-queue stand-in so far: stand-in events (kernel-less) plus native calls (K-native
  // routing, menu.mjs).
  qewr_posts() {
    return this.kernel.events.filter((e) => e[0] === 'rtos' && e[1] === 'OlyQeWr').length + (this.route_log ? this.route_log.get(['OlyQeWr', 'native']) : 0);
  }
  // H-RESEND: the display manager's own palette request after the switch, natively (the switch writes zeros into the
  // new channel's palettes, and GPISetPalette with unchanged colours sets no dirty byte).
  resend_palettes(device) {
    const mask = lookup(DEVICE, device).mask, kind = lookup(RESEND_KIND, device);
    const param = this.alloc(pack('<III', 1, 1, 1), 16);
    const async0 = this.sim.read(DISPIF_ASYNC, 1)[0];
    const n0 = this.display_sends.length, q0 = this.qewr_posts();
    this.step(`H-RESEND 0x503e52c7(kind ${kind}, {1, 1, 1}) for ${device} (the request openDevice 0x50d83338 makes after its open; openDevice's caller is not traced)`,
      () => this.call(PALETTE_RESEND, { d0: kind, a0: param }, null, null, 300000));
    const sends = this.display_sends.slice(n0);
    const want = pack('<IBBB', mask, 1, 1, 1);
    const got = sends.map(([cmd, data, ret]) => [cmd, data.subarray(0, 7), ret]);
    const same = got.length === 1 && got[0][0] === 4 && got[0][2] === RESEND_SEND_RETURN && got[0][1].length === want.length && got[0][1].every((b, i) => b === want[i]);
    const problems = [];
    if (!same) problems.push(`DISPLAY sends ${show(got.map(([c, d, r]) => [c, bytesHex(d), hex(r)]))}, expected cmd 4 ${bytesHex(want)} returning to ${h8(RESEND_SEND_RETURN)}`);
    if (this.qewr_posts() !== q0) problems.push(`${this.qewr_posts() - q0} OlyQeWr post(s): the asynchronous branch ran`);
    if (async0 !== 1 || this.sim.read(DISPIF_ASYNC, 1)[0] !== async0) problems.push(`dispif async byte ${h8(DISPIF_ASYNC)} ${async0} -> ${this.sim.read(DISPIF_ASYNC, 1)[0]} (the image holds 1)`);
    if (problems.length) throw new FirmwareError(`H-RESEND on ${device}: ` + problems.join('; '));
    return sends;
  }
  // Opt-in assumptions in the VSC model's debug window: A15, A19 and A20.
  assume(name, on, channels = [1, 2]) {
    const bit = { A15: 1, A19: A19_BIT, A20: A20_BIT }[name];
    if (bit === undefined) throw new ValueError(`unknown opt-in assumption ${name}`);
    for (const c of channels) this.vsc.set_assume(c, (this.vsc.assumed(c) & ~bit) | (on ? bit : 0));
    if (on) this.assumptions_in_use.add(name);
    else this.assumptions_in_use.delete(name);
  }
  // A6 harness guard: every drawn IMG plane must carry exactly the IMG_STEP_REGS the attach left, and the span the model
  // fetches, measured from the latched address and stride, must lie inside the attached source.
  img_edge(c, header) {
    const errors = [];
    for (let p = 0; p < 3; p++) {
      const name = PLANES[p];
      if (!((header.drawn >>> p) & 1)) continue;
      if (p === 2 && (header.assumed & A19_BIT)) continue;             // A19: the face/AF frame plane reads its own buffer
      let fit = name === 'IMG1' ? (this.img_attach.get(c) ?? null) : null;
      const source = fit && (fit.path === 'TH' ? this._th_source(fit) : fit.src);
      const regs = name === 'IMG1' ? this.img_steps(c, true) : null;
      let reason = fit === null ? 1 : !deepEqual(regs, fit.regs) ? 2 : source === null ? 4 : 0;
      let offset, stride, rsz1, rsz2, rsz4, area1, area2;
      if (!reason) fit = { ...fit, src: source };
      if (!reason) {
        let sadr, dmald;
        [rsz1, rsz2, rsz4, area1, area2, sadr, dmald] = regs;
        const spos = (regs[8] ?? 0) & 0xFF;                            // A18 start, as the model
        const start = spos || ((sadr * 16) % 128) ? Math.floor(sadr * 16 / 128) * 128 + 2 * spos : sadr * 16;
        offset = start - fit.base; stride = (dmald >>> 3) * 128;
        if (offset < 0 || stride !== fit.stride || (offset % stride) % 2) reason = 4;
      }
      if (!reason) {
        const row0 = Math.floor(offset / stride), col0 = Math.floor((offset % stride) / 2);
        const unit = c === 2 ? 8192 : 4096;                            // A12, as the model
        const sh = rsz1 & 1 ? rsz2 : 4096, sv = rsz1 & 0x10 ? rsz4 : unit;
        const hp = ((area1 & 0xFFFF) - 1) * sh, vp = ((area2 & 0xFFFF) - 1) * sv;
        const s_ = Math.floor(hp / 4096), f = hp % 4096, r = Math.floor(vp / unit), g = vp % unit;
        const lastCol = col0 + s_ + (f ? 1 : 0), lastRow = row0 + r + (g ? 1 : 0);
        if ((lastCol | 1) >= fit.src[0] || lastRow >= fit.src[1]) reason = 3;   // format 0 reads the pixel pair
      }
      if (reason) {
        errors.push({ code: 0, name: 'IMG_EDGE_UNKNOWN', source: 'harness', pc: 0, channel: c, offset: name === 'IMG1' ? 0x4F0 : 0x504 + 0x18 * (p - 1),
          value: reason, args: [p, ...(fit ? fit.src : [0, 0])], why: IMG_EDGE_REASONS.get(reason) });
      }
    }
    return errors;
  }
  // Harness rule: a composite shows the frame that starts at the channel's next boundary (RUN_TO_FRAME, the firmware
  // ISR runs, then COMPOSE of the latched mirror bank). next_frame=false composes the bank latched at the last
  // boundary. raw=true returns the composite bytes under 'raw' instead of the word list under 'words'.
  compose(device, next_frame = true, raw = false) {
    const n0 = this.notes.length;
    const result = this._compose(device, next_frame, raw);
    if (this.composeObserver) this.composeObserver(device, next_frame, result, n0, this.notes);     // the tracer (format /3)
    return result;
  }
  _compose(device, next_frame, raw) {
    const c = lookup(DEVICE, device).channel;
    if (next_frame) {
      this.step(`next frame on ${device} (harness: composite = frame after the next boundary)`, () => {
        this.run_to_frame(c, `compose ${device}`);
        this.kernel.deliver();
      });
    }
    if (this.img !== null) this.check_img_unchanged();
    const status = this.doorbell(CMD_COMPOSE, c);
    const header = this.vsc.header();
    const [total, errors] = this.vsc.errors();
    const [ntotal, notes] = this.vsc.notes();
    this.doorbell(CMD_CLEAR);
    if (ntotal > NOTE_SLOTS) throw new FirmwareError(`compose ${device}: ${ntotal} notes overflowed the ring`);
    this.notes.push(...notes);
    if (notes.length) this.labObserver?.dnote(notes);
    let pixels = header.width ? this.vsc.output_raw(header.width, header.height) : new Uint8Array(0);
    if (!raw) pixels = Array.from(new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length >> 2));
    const edge = !status ? this.img_edge(c, header) : [];
    const out = { status: ERRORS[status], header, planes: this.vsc.planes(), errors: [...errors, ...edge], error_total: total + edge.length };
    out[raw ? 'raw' : 'words'] = pixels;
    return out;
  }
}

// GUI-like content in the three layers through gpiDrawOsdRectangle (canvas coordinates: TFT shows 900 x 600, EVF the
// top-left 800 x 600 scaled 2x).
export function demo_gui(lab) {
  return lab.draw(() => {
    lab.rectangle(0, 0, 900, 56, 33, 1, 2);            // GUI layer 0 -> OSD1, palette 62 (registry 2): black bar
    lab.rectangle(0, 544, 900, 56, 35, 1, 2);          // 62[35] = bb282828, translucent
    [11, 16, 21, 3, 6].forEach((colour, i) => lab.rectangle(24 + 120 * i, 12, 100, 32, colour, 1, 2));
    lab.rectangle(300, 200, 300, 200, 8, 1, 4);        // GUI layer 1 -> OSD2, palette 63 (registry 4)
    lab.rectangle(320, 220, 260, 40, 2, 1, 4);
    lab.rectangle(320, 280, 260, 40, 6, 1, 4);
    lab.rectangle(320, 340, 260, 40, 5, 1, 4);
    lab.rectangle(440, 120, 20, 360, 13, 1, 4);        // white cross
    lab.rectangle(270, 290, 360, 20, 13, 1, 4);
    lab.rectangle(40, 470, 180, 50, 4, 1, 0);          // GUI layer 2 -> OSD3, palette 61 (registry 0)
    lab.rectangle(680, 470, 180, 50, 17, 1, 0);
    lab.rectangle(820, 80, 60, 360, 9, 1, 0);          // 61[9] green, TFT-only columns 820..879
  });
}
