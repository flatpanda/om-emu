// The firmware's own OSD drawing stack on the lab (EngineDebug,
// Frame, OsdLab with the memory-manager constructors, kernel_native, native_init, the drawing bracket, the draw calls).
// EngineDebug.exec_log returns the raw execution-log rows (the seq check kept), without decoding
// the commands (the osd scenario compares the raw rows' digest).
import * as K from './kernel.mjs';
import { HLE, DATA, DATA_END, FirmwareError, disasm, install_core_index, runtime, where, cat } from './hle.mjs';
import { RTOS, Kernel } from './rtos.mjs';
import { EngineError, ValueError, LabError } from './errors.mjs';
import { show } from '../util/show.mjs';
import { pack, unpack } from '../util/bytes.mjs';
import { hexDigits as fx } from '../util/hex.mjs';
import { gui_palette } from './osdfmt.mjs';
import { A, ON_LAB_MODEL, IMAGE_BASE, fact } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';

export { EngineError };
export const MM_CTORS = [A(0x50533B80), A(0x50533D1E), A(0x50533EBF), A(0x5053405E), A(0x50534202), A(0x505343B8), A(0x5053454A),
  A(0x505346C1), A(0x50534883), A(0x50535769), A(0x50535D3B), A(0x50535D7F), A(0x50535EBA), A(0x50535FE7), A(0x50536482)];
// The image's static constructor list for the memory managers (run-time pointers, ended by 0xFFFFFFFF), which
// MM_CTORS lists for E143; a later model's list differs in length (E147 has 13), so the lab runs the image's own.
export const MM_CTOR_TABLE = A(0x60714E78);
export function mm_ctors(image) {
  const out = [];
  for (let o = MM_CTOR_TABLE - IMAGE_BASE; ; o += 4) {
    const w = (image[o] | image[o + 1] << 8 | image[o + 2] << 16 | image[o + 3] << 24) >>> 0;
    if (w === 0xFFFFFFFF) break;
    out.push(disasm(w));
    if (out.length > 64) throw new Error('mm_ctors: no end of the constructor list');
  }
  if (ON_LAB_MODEL && out.join() !== MM_CTORS.join()) throw new Error('mm_ctors: the E143 table is not MM_CTORS');
  return out;
}
export const OSDDRAW_INIT = A(0x510126F1), EXEC_START = A(0x5101393F), EXEC_END = A(0x5101395B), DISPATCH = A(0x5101121F);
export const EXEC_RECT = A(0x51012B5D), GPI_DRAW_OSD_RECTANGLE = A(0x510BCEBA), GPI_DRAW_OSD_LINE = A(0x510BCDAF);
export const GPI_DRAW_OSD_BLOCK_COPY = A(0x510BD0B7), GPI_DRAW_BITMAP = A(0x510BD223), GPI_SET_PALETTE = A(0x510BCB4F);
export const ENGINE_ISR = A(0x51011636);
export const DRV_OPEN = A(0x62B26500), DRV_BUSY = A(0x62B26502), DRV_MODE = A(0x62B26504), DRV_POINTER = A(0x62B2650C), DRV_COUNT = A(0x62B26510);
export const DRV_CMDBUF = A(0x62B265D0), REGISTRY = A(0x62B26528), KIND3_RECORD = A(0x62B265C0), LAYER_TABLE = A(0x613286C4);
export const PALETTE_ARRAYS = { 0: A(0x62B275E1), 1: A(0x62B26DE1), 2: A(0x62B265E1) };
export const ENGINE_SURFACE = A(0xB72AB800), CMDBUF = A(0xB729B800), CMDBUF_SIZE = 0x10000;
export const IRQ_ENGINE = BOARD.intc.irq_osd_engine;   // E143 310 (src/fw/board.mjs)
export const ENGINE = 0x9BC00000, DEBUG = 0x8E000000;
export const DBG_MAGIC = 0x00, DBG_ERR_TOTAL = 0x08, DBG_IRQ_LINE = 0x0C, DBG_STARTS = 0x18;
export const DBG_CMDS_EXECUTED = 0x1C, DBG_FIFO_WORDS = 0x20, DBG_LUT_ADDR = 0x24, DBG_EXEC_TOTAL = 0x2C;
export const DBG_VERSION = 0x04, DBG_KEY_MODE = 0x30, DBG_KEY_HITS = 0x34;
export const KEY_MODES = new Map([['refuse', 0], ['skip', 1], ['write', 2]]);
export const DBG_GUARD = 0x40, DBG_ERR_RING = 0x100, DBG_EXEC_LOG = 0x1000, ERR_SLOTS = 64, EXEC_SLOTS = 256;
// ERRORS: the engine model's error names (src/dev/engine.mjs)
export const ERRORS = ['NONE', 'REG_UNKNOWN', 'REG_READ_UNUSED', 'START_MODE', 'TRIGGER', 'FIFO_OVERFLOW', 'LIST_NO_END',
  'OPCODE_UNKNOWN', 'OPCODE_UNMODELED', 'WORD_BITS', 'DEPTH', 'COLOR_HIGH', 'SIZE_4096', 'DMA_RANGE', 'GUARD',
  'COPY_OVERLAP', 'BMP_FORMAT', 'BMP_SCALE', 'BMP_LUT', 'BMP_TOKEN', 'BMP_TRANSPARENCY', 'SEQUENCE', 'DEBUG_CPU_WRITE'];

export class EngineDebug {
  constructor(sim) {
    this.sim = sim;
    let magic;
    try { magic = sim.u32(DEBUG + DBG_MAGIC); } catch (e) {
      if (e?.name === 'RuntimeError') throw new FirmwareError(`the machine has no OSD engine debug window (${e.message})`);
      throw e;
    }
    if (magic !== 0x4544534F) throw new FirmwareError(`OSD engine debug window magic 0x${fx(magic, 8)}: not emu's OSD engine model`);
  }
  u32(offset) { return this.sim.u32(DEBUG + offset); }
  register(offset) { return this.sim.u32(ENGINE + offset); }
  irq_line() { return this.u32(DBG_IRQ_LINE); }
  set_guard(slot, base, stride, height) { this.sim.write(DEBUG + (slot < 8 ? DBG_GUARD + 16 * slot : 0x8000 + 16 * (slot - 8)), pack('<4I', base, stride, height, 1)); }
  clear() {
    this.sim.word(DEBUG + DBG_ERR_TOTAL, 0);
    this.sim.word(DEBUG + DBG_EXEC_TOTAL, 0);
    if (this.u32(DBG_VERSION) >= 2) this.sim.word(DEBUG + DBG_KEY_HITS, 0);
  }
  _need_key_register() {
    if (this.u32(DBG_VERSION) < 2) throw new FirmwareError(`OSD engine debug window version ${this.u32(DBG_VERSION)} has no U1 key register`);
  }
  set_key_mode(mode) {
    if (!KEY_MODES.has(mode)) throw new ValueError(`key mode ${show(mode)}: one of ${show([...KEY_MODES.keys()].sort())}`);
    this._need_key_register();
    this.sim.word(DEBUG + DBG_KEY_MODE, KEY_MODES.get(mode));
  }
  key_mode() {
    this._need_key_register();
    const value = this.u32(DBG_KEY_MODE);
    for (const [k, v] of KEY_MODES) if (v === value) return k;
    return value;
  }
  key_hits() { this._need_key_register(); return this.u32(DBG_KEY_HITS); }
  _ring(totalOffset, base, slots, size) {
    const total = this.u32(totalOffset), first = Math.max(0, total - slots), out = [];
    for (let n = first; n < total; n++) out.push(unpack(`<${size / 4}I`, this.sim.read(DEBUG + base + size * (n % slots), size)));
    return out;
  }
  error_total() { return this.u32(DBG_ERR_TOTAL); }
  exec_total() { return this.u32(DBG_EXEC_TOTAL); }
  errors() {
    return this._ring(DBG_ERR_TOTAL, DBG_ERR_RING, ERR_SLOTS, 32).map((r) => ({
      code: r[0], name: r[0] < ERRORS.length ? ERRORS[r[0]] : String(r[0]), pc: r[1], arg: r[2], value: r[3],
      words: r.slice(4, 8) }));
  }
  // The raw rows (seq, source, n, result, words...) of the newest EXEC_SLOTS executed commands, seq checked.
  exec_log() {
    const first = Math.max(0, this.exec_total() - EXEC_SLOTS);
    const rows = this._ring(DBG_EXEC_TOTAL, DBG_EXEC_LOG, EXEC_SLOTS, 64);
    rows.forEach((r, k) => { if (r[0] !== first + k) throw new FirmwareError(`engine execution log slot for command ${first + k} holds ${r[0]}`); });
    this.lastRaw = rows.map((r) => r.slice(0, 4 + r[2]));
    return this.lastRaw;
  }
}

export function format_error(e) {
  const code = disasm(e.pc);
  const w = code >= 0x50000000 && code < 0x52000000 ? ` (disasm 0x${fx(code, 8)})` : '';
  return `${e.name} at pc 0x${fx(e.pc, 8)}${w} arg 0x${fx(e.arg, 8)} value 0x${fx(e.value, 8)}`;
}

export class Frame {
  constructor() {
    this.commands = []; this.command_total = 0; this.errors = []; this.error_total = 0; this.errlog = [];
    this.expect_errlog = 0; this.key_hits = null; this.result = null;
  }
}

// The GUI canvas (STRIDE x HEIGHT), the layer records [base, kind] and the kind-3 area [base, height], from the model's
// fact 'gui' (src/fw/facts.mjs guiCanvas reads it from the layer record creator and the OSD bank setup; a model with
// neither it nor a MODELS gui by hand is refused here): kind k's records are its bank's elements in order, base +
// element * size (gui.banks, [base, size, count] for each kind). No rule reads a visible width: the GUI's screen
// descriptor gives E143's 1600 and E144's 1152 (0x50d30b1a..26, D) but not E147's canvas (guiCanvas). Before the rule
// E144's and E139's were given by hand (E144: the record creator's 1152 x 768 at 0x50ca4dd8..e1, D) and every other
// model took E143's, whose canvas and two records per kind made the OSD engine's guards refuse the GUI's first draw on
// E134 and E137 (X: a GUARD error, a one-colour TFT frame). E143's: 1664 x 1200, the records 0xB7C31000, 0xB7E18800
// (kind 0), 0xB7862000, 0xB7A49800 (kind 1), 0xB7493000, 0xB767A800 (kind 2), banks of two, and the kind-3 area
// 0xB6ECC800 of 2400 rows.
const GUI = fact('gui', {
  stride: 1664, height: 1200, banks: [[0xB7C31000, 0x1E7800, 2], [0xB7862000, 0x1E7800, 2], [0xB7493000, 0x1E7800, 2]],
  kind3: [0xB6ECC800, 2400],
});
export const STRIDE = GUI.stride, HEIGHT = GUI.height;
const bankRecords = (banks) => banks.flatMap(([base, size, count], kind) => Array.from({ length: count }, (_, e) => [(base + e * size) >>> 0, kind]));
export const EXPECTED_RECORDS = bankRecords(GUI.banks);
export const KIND3_AREA = GUI.kind3;
export const NRECORDS = EXPECTED_RECORDS.length;
export const KN_LAB_PRI = 60, KN_TASKS = [A(0x50023A0C), A(0x501C6D8C)];

// OSD_DEFAULTS.kernel: the kernel a lab built without one runs on (check_display, check_liveview and check_text set
// it from --kernel)
export const OSD_DEFAULTS = { kernel: 'native' };
export class OsdLab extends HLE {
  // opts: a subclass's options (DisplayLab, TextLab, MenuLab, NavLab, PlayLab), applied
  // by preinit() before OsdLab's own init runs native_init(), so they are set before the base's init runs.
  constructor(env, cpu = 0, kernel = 'native', opts = {}) {
    if (kernel !== 'native' && kernel !== 'none') throw new ValueError(`kernel ${show(kernel)}: native or none`);
    super(env);
    this.preinit(opts);
    this.kernel_mode = kernel;
    this.install_base_stubs();
    this.kernel = new Kernel(this);
    this.engine = new EngineDebug(this.sim);
    this.kernel.add_source(IRQ_ENGINE, () => this.engine.irq_line() !== 0);
    install_core_index(this.sim, cpu);
    this.data = DATA;
    for (const ctor of mm_ctors(this.image)) this.calls(ctor);
    if (kernel === 'native' && !this.own_kernel) this.kernel_native();
    this.native_init();
  }
  preinit(opts) {}
  // a subclass that boots and routes K-native itself (MenuLab) sets own_kernel
  static own_kernel = false;
  get own_kernel() { return this.constructor.own_kernel; }
  kernel_native() {
    this.rtos_stubs = new Map([...RTOS.keys()].map((a) => [a, this.hooks.get(runtime(a))]));
    this.nk = new K.NativeKernel(this);
    this.nk.boot();
    this.kernel.go_native(this.nk.intc);
    this.lt = new K.LabTask(this.nk, KN_LAB_PRI, null, 0x60000, KN_TASKS);
    this.lt.start();
    this.lt.make_settle_sem();
    for (const [address, name] of RTOS) this.hook(address, this.rtos_observer(name), name + '(native)');
    const orig = this.kernel.deliver;
    this.kernel.deliver = (bound = 8) => K.in_interrupt(this.lt, () => orig(bound));
    this._deliver_raw = orig;
  }
  rtos_observer(name) {
    return (hle, r) => {
      this.kernel.events.push(['rtos', name, `d0=0x${r.d0.toString(16)} d1=0x${r.d1.toString(16)} a0=0x${r.a0.toString(16)}`, where(r.mdr)]);
      this.sim.run([], true);
    };
  }
  native_init() {
    const result = this.call(OSDDRAW_INIT);
    if (result.d0 & 0xFFFF) throw new FirmwareError(`osddraw_init returned 0x${result.d0.toString(16)}`);
    this.records = [];
    for (let i = 0; i < NRECORDS; i++) this.records.push(this.sim.u32(REGISTRY + 8 * i));
    this.records.push(KIND3_RECORD);
    this.surfaces = [];
    for (let i = 0; i <= NRECORDS; i++) this.surfaces.push(this.record(i));
    this.surfaces.forEach((s, slot) => this.engine.set_guard(slot, s.base, s.stride, s.height));
    this.init_errors = this.engine.errors();
    if (this.init_errors.length || this.kernel.errors.length) {
      throw new EngineError('native init: ' + [...this.init_errors.map(format_error),
        ...this.kernel.errors.map(([code, , , caller]) => `error log 0x${fx(code, 8)} from ${caller}`)].join('; '));
    }
    this.engine.clear();
    this.errlog_seen = this.kernel.errors.length;
    this.isr_runs = 0;
  }
  record(buffer) {
    const address = this.records[buffer];
    const [base, kind, stride, height, x, y] = unpack('<IIHHHH', this.sim.read(address, 16));
    return { address, base, kind, stride, height, x, y };
  }
  driver() {
    const [opened, busy, mode] = unpack('<HHH', this.sim.read(DRV_OPEN, 6));
    return { open: opened, busy, mode, pointer: this.sim.u32(DRV_POINTER), count: this.sim.u32(DRV_COUNT) };
  }
  alloc(data, align = 64) {
    const up = (v) => Math.ceil(v / align) * align;
    let address = up(this.data);
    if (address + data.length > DATA_END) address = up(DATA);
    this.sim.write(address, data);
    this.data = address + data.length;
    return address;
  }
  clear(buffer) { const s = this.surfaces[buffer]; this.sim.write(s.base, new Uint8Array(s.stride * s.height)); }
  // ---- the drawing() bracket as two steps: enter (before the body) and exit(error | null) (after it).
  drawing_enter(expect = [], errlog = 0) {
    this.outside_brackets();
    const frame = new Frame();
    frame.expect_errlog = errlog;
    this.engine.clear();
    const st = { frame, expect, errors_before: this.kernel.errors.length, delivered: this.kernel.delivered.length };
    const result = this.call(EXEC_START);
    if (result.d0 & 0xFFFF) throw new FirmwareError(`exec_start returned 0x${result.d0.toString(16)}`);
    return st;
  }
  drawing_exit(st, error = null) {
    const { frame, expect, errors_before, delivered } = st;
    if (error !== null) { this._abandon(error, errors_before, delivered); throw error; }
    frame.result = this.call(EXEC_END).d0 & 0xFFFF;
    this.errlog_seen = this.kernel.errors.length;
    frame.commands = this.engine.exec_log();
    frame.command_total = this.engine.exec_total();
    frame.errors = this.engine.errors();
    frame.error_total = this.engine.error_total();
    frame.key_hits = this.engine.u32(DBG_VERSION) >= 2 ? this.engine.key_hits() : null;
    this.engine.clear();
    frame.errlog = this.kernel.errors.slice(errors_before);
    this.isr_runs += this.kernel.delivered.length - delivered;
    const state = this.driver();
    const problems = [];
    if (frame.result) problems.push(`exec_end returned 0x${frame.result.toString(16)}`);
    if (this.engine.irq_line()) problems.push('engine interrupt line still active');
    if (this.kernel.delivered.length - delivered !== 1) problems.push(`${this.kernel.delivered.length - delivered} engine interrupts serviced`);
    if (state.open || state.busy || state.pointer || state.count) problems.push(`driver state after close: ${show(state)}`);
    if (frame.errlog.length !== frame.expect_errlog) {
      problems.push(`firmware error log (${frame.expect_errlog} expected): ` + (frame.errlog.map(([code, , args, caller]) =>
        `0x${fx(code, 8)} args ${show(args.slice(0, 3).map((a) => '0x' + a.toString(16)))} from ${caller}`).join('; ') || 'none'));
    }
    const names = frame.errors.map((e) => e.name), want = [...expect].slice(expect.length - frame.errors.length);
    if (frame.error_total !== expect.length || JSON.stringify(names) !== JSON.stringify(want)) {
      problems.push(`engine errors (${expect.length ? show([...expect]) : 'none'} expected): ${frame.error_total}; `
        + (frame.error_total > frame.errors.length ? 'newest: ' : '')
        + (frame.errors.map(format_error).join('; ') || 'none'));
    }
    if (problems.length) throw new EngineError(problems.join('; '));
    return frame;
  }
  outside_brackets() {
    const total = this.engine.error_total(), errlog = this.kernel.errors.slice(this.errlog_seen);
    if (!total && !errlog.length) return;
    this.errlog_seen = this.kernel.errors.length;
    const errors = this.engine.errors();
    this.engine.clear();
    throw new EngineError('outside a drawing() bracket: ' + [
      ...(total ? [`${total} engine error(s)` + (total > errors.length ? ', newest: ' : ': ') + errors.map(format_error).join('; ')] : []),
      ...errlog.map(([code, , , caller]) => `error log 0x${fx(code, 8)} from ${caller}`)].join('; '));
  }
  _abandon(error, errors_before, delivered) {
    try {
      const result = this.call(EXEC_END).d0 & 0xFFFF;
      error.addNote(`drawing() body raised; exec_end returned 0x${result.toString(16)}, driver ${show(this.driver())}`);
    } catch (closeError) {
      if (!(closeError instanceof LabError)) throw closeError;
      error.addNote(`drawing() body raised; exec_end then failed too: ${closeError.message}`);
    }
    this.isr_runs += this.kernel.delivered.length - delivered;
    const errors = this.engine.errors(), total = this.engine.error_total();
    if (total) error.addNote(`engine errors in the abandoned frame (${total}): ` + errors.map(format_error).join('; '));
    const errlog = this.kernel.errors.slice(errors_before);
    if (errlog.length) error.addNote('firmware error log in the abandoned frame: ' + errlog.map(([code, , , caller]) => `0x${fx(code, 8)} from ${caller}`).join('; '));
    this.engine.clear();
    this.errlog_seen = this.kernel.errors.length;
  }
  // ---- drawing API (real firmware functions)
  rectangle(x, y, w, h, colour, layer = 1, buffer = 0) {
    return this.call(GPI_DRAW_OSD_RECTANGLE, { d0: x, d1: y, a0: this.records[buffer], a1: w }, pack('<III', h, colour, layer));
  }
  line(x, y, w, h, colour, layer = 1, buffer = 0) {
    return this.call(GPI_DRAW_OSD_LINE, { d0: x, d1: y, a0: this.records[buffer], a1: w }, pack('<III', h, colour, layer));
  }
  block_copy(sx, sy, w, h, dx, dy, layer = 1, buffer = 0, dst_buffer = null) {
    const destination = this.records[dst_buffer === null ? buffer : dst_buffer];
    return this.call(GPI_DRAW_OSD_BLOCK_COPY, { d0: sx, d1: sy, a0: this.records[buffer], a1: destination }, pack('<IIIII', w, h, dx, dy, layer));
  }
  bitmap(x, y, address, lut = null, layer = 1, buffer = 0, width = 0, height = 0) {
    const table = lut !== null ? this.alloc(new Uint8Array(lut)) : 0;
    return this.call(GPI_DRAW_BITMAP, { d0: x, d1: y, a0: this.records[buffer], a1: address }, pack('<IIIII', width, height, 0, table, layer));
  }
  outline(x, y, w, h, line, colour, plane = 0, buffer = 0) {
    const request = this.alloc(pack('<IBxHHHHHBB', this.records[buffer], plane, x, y, w, h, line, colour, 0));
    return this.call(EXEC_RECT, { a0: request });
  }
  set_fifo_mode(on) {
    const request = new Uint8Array(108), dv = new DataView(request.buffer);
    dv.setUint16(0, 7, true);
    dv.setUint32(84, ENGINE_SURFACE, true); dv.setUint32(88, STRIDE, true); dv.setUint32(92, on ? 0 : CMDBUF, true);
    dv.setUint32(96, CMDBUF_SIZE, true);
    return this.call(DISPATCH, { a0: this.alloc(request) });
  }
  set_palette(layer, colours, start = 0) {
    const number = this.alloc(pack('<H', layer), 4);
    const layer_object = this.alloc(cat(new Uint8Array(72), pack('<I', number)), 4);
    const array = this.alloc(pack(`<${colours.length}I`, ...colours), 4);
    return this.calls(GPI_SET_PALETTE, { d0: start, d1: colours.length, a0: layer_object, a1: array });
  }
}


// Shooting screen GUI layer palettes by osddraw plane (PaletteChange jump table
// 0x5124fe26; GUI layer index 0/1/2 -> osddraw plane 1/2/0, 0x613286c4).
export const SHOOTING_PALETTE_FOR_PLANE = new Map([[0, 61], [1, 62], [2, 63]]);
// choose_palette: the GUI palette for showing a record of this kind, [id, colours, how]. Without palette_id,
// kinds 0..2 take the shooting-screen palette of the osddraw plane with that number (an assumption, stated in `how`);
// for other kinds no palette is known and ValueError asks for one.
export function choose_palette(image, kind, palette_id = null) {
  if (palette_id !== null) return [palette_id, gui_palette(image, palette_id), 'given'];
  if (!SHOOTING_PALETTE_FOR_PLANE.has(kind)) throw new ValueError(`kind-${kind} record: which GUI palette displays it is unknown, give --palette-id`);
  const id = SHOOTING_PALETTE_FOR_PLANE.get(kind);
  return [id, gui_palette(image, id), `assumed: record kind ${kind} = osddraw plane, shooting-screen palette`];
}
