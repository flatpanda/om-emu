// A real menu page: the firmware's own GUI task on K-native with the display stack
// (MenuLab: K-native boot, RTOS routing, CTORS, the native and the empty (S-STORE) settings store
// and its stand-ins, S-PERSIST, the dial-table init, GUI creation and settle, the observers, B2's S-TAKEOVER and
// H-CONNECT; persist_ids, state_names, inputs_for). Addresses are disassembly notation unless marked run-time.
import { A, isUnmapped, refuseUnmapped, MODEL_INFO, IMAGE_BASE, ON_LAB_MODEL, fact, knob } from '../fw/model.mjs';
import { BOARD } from '../fw/board.mjs';
import * as D from './display.mjs';
import * as K from './kernel.mjs';
import * as M from './menudata.mjs';
import * as F from './osdfmt.mjs';
import * as R from './resources.mjs';
import * as T from './text.mjs';
import { FirmwareError, disasm, runtime, where } from './hle.mjs';
import { EXEC_SLOTS, EXPECTED_RECORDS, KIND3_RECORD, KIND3_AREA, NRECORDS, REGISTRY, STRIDE, HEIGHT, EngineError } from './osd.mjs';
import { RTOS } from './rtos.mjs';
import { ScpuDev, ScpuMemory } from './scpudev.mjs';
import { ScpuLink, PER_SCPU_TASK } from './scpulink.mjs';
import { ScpuM4 } from './scpum4.mjs';
import { ValueError, RuntimeError, AssertionError } from './errors.mjs';
import { packRegs } from './sim.mjs';
import { show } from '../util/show.mjs';
import { pack, unpack, unpackFrom, bytesHex } from '../util/bytes.mjs';
import { hex, hexDigits as fx } from '../util/hex.mjs';
import { Tally } from '../util/tally.mjs';
import { BOOT_E143, PROP_STORE_E143, CTORS_E143 } from '../fw/facts.mjs';
// an om1.scpu command line on stderr (src/dev/scpu.mjs): its value, pc and count
const SCPU_COMMAND = /^om-emu: scpu command 0x([0-9a-f]+) pc 0x([0-9a-f]+) #([0-9]+)(?: |$)/;

export const GUI_CREATOR = A(0x5108BC37), GUI_TASK = A(0x5115BA0C), GENIFA_TIMER_TASK = A(0x510C1D01), EMPTY_TASK = A(0x50023A0C);
export const EYEFI_TASK = A(0x50ABA579), CHANGE_TASK = D.CHANGE_LOOP;
export const SEND_EVENT = A(0x5115B286), MENU_EVENT = 0x87, EV_MAP = A(0x614B5A14), SET_EVENT = A(0x510BA2C2), DISPATCH = A(0x510C2A2E);
export const STATE_LOG = A(0x5124BA59), GUICALLER = A(0x60368B88), STATE_TABLE = A(0x61596FB8);
// the registers STATE_LOG takes the old and the new GUI state in: E143's caller passes them as its third and fourth
// arguments, a0 and a1 (D); a build whose log takes one argument fewer passes them in d1 and a0 (src/fw/facts.mjs
// stateLog, fact 'state_log.regs')
const stateLogRegs = () => fact('state_log.regs', ['a0', 'a1']);
export const STATE_POWER_ON = 0x0102, STATE_MENU = 0x0B02;
export const MODULE_STATE_SET = A(0x50AB6299), MODULE_STATE_GET = A(0x50AB5780), TAKEOVER_MODULE = 9, TAKEOVER_STATE = 2;
export const TAKEOVER_READERS = [A(0x50ABCFD7), A(0x50ABCFE2)];
export const CONNECT_EVENT = 0x83, CONNECT_LOUTPUT = 7, LAYOUT_BYTE = A(0x60368BA4), CCOMMON = A(0x60368BAC);
export const B2_OBSERVED = [[A(0x510C412A), 'ConnectChangePlay'], [A(0x50AFCD3A), 'vt+20'], [A(0x510C4946), 'SetConnectState'],
  [A(0x510C812D), 'ChangeFinderStyle'], [A(0x510C2DB4), 'SetLayoutMode'], [A(0x501E04B7), 'ctrl_or']];
export const B2_RETURNS = new Set([A(0x50AFCD3A)]);
export const GATE_WORD = A(0x60375A9C);
export const B2_POINTS = [[A(0x510C9232), ['vt+56', 'a1']], [A(0x510C9234), ['vt+56 ret', 'd0']], [A(0x510C4235), ['0x510c91eb ret', 'd0']]];
export const DRAW_TEXT = A(0x510AB0F9);
export const GPI_DRAW_BITMAP = A(0x510BD223), GPI_DRAW_RECT = A(0x510BCEBA), GPI_DRAW_COPY = A(0x510BD0B7);
export const GPI_DRAW_CHAR = A(0x510BD32F), GPI_SET_PALETTE = A(0x510BCB4F), GPI_UPDATE = A(0x510BD4EE);
export const SET_PALETTE_KIND = A(0x51241FD5), PALETTE_PENDING = A(0x510BCC16), EXEC_START = A(0x5101393F), EXEC_END = A(0x5101395B);
export const GPIFONT_FILE = new TextEncoder().encode('gpifont.c\0');
export const SETUP_TAB = 7;
export const PROP_GUI_SITES = [A(0x503EFF61)];
export const DROPPED_SENDS = [[A(0x600431D8), 10, A(0x50045474)]];
export const LAB_PRI = 60, GUI_START_MS = 2000, GUI_START_SLICE_MS = 100;
export const EV_WRAPPERS = new Set(['OlyEvSt', 'iOlyEvSt', 'OlyEvWt', 'OlyEvCl', 'OlyEvDl']);
// the boot's state the lab's start leaves unset (src/fw/facts.mjs bootState): UI_IN's boot key (S-BOOTKEY,
// src/lab/play.mjs) and the stages' ready word (S-BOOTSTAGE); read where used
export const bootFacts = () => fact('boot', BOOT_E143);
export const REGISTRY_INIT = A(0x50040AEB), SETTINGS_DB_INIT = A(0x503C5473), GETTER = A(0x503C49AB), PROP_SET = A(0x503EE412);
// the property store's module init and its three object words (src/fw/facts.mjs propStore; H-STOREINIT): read where the
// store starts
export const propStoreInit = () => fact('prop_store', PROP_STORE_E143);
export const API_SET = A(0x50AC4AFE), API_WRITE = A(0x50B4F28B), DESC_LOOKUP = A(0x503DA999), CUSTOM_LOOKUP = A(0x503C681F);
export const KEY_SELECTORS = new Map([[A(0x503C589B), 64], [A(0x503C58B9), 141]]);
export const DIAL_INIT = A(0x5014B7C7), DIAL_TABLE_PTR = A(0xA32DAAB0), DIAL_BOARD = BOARD.core_byte;
// the dial-table select (src/fw/facts.mjs dialSelect, or dialStore for the forms it does not read; read when the
// dial init runs): E143's is DIAL_INIT itself, its pointer store 0x1a bytes in, board 0's id table 0x60223DBC
export const dialSelect = () => fact('dial', { select: 0x5014B7C7, select_end: 0x1A, table_ptr: 0xA32DAAB0, table0: 0x60223DBC });
export const DIAL_COUNTERS = A(0xA32DAAB4), SCPU = 0x98E00000;
// the SCPU's clock counter word (src/fw/board.mjs scpu.clock: E143's 0xe8, the E144 family's 0x98)
export const SCPU_CLOCK = SCPU + BOARD.scpu.clock[0];
export const K_CFLUSH = A(0x5004E68A), K_CFLUSH_RETURN = A(0x5004086A), K_CRT_134D = A(0x3FFE134D);
// K-CRT-134D: the C-runtime window call K_CRT_134D, which the lab does not map, is `mov (SCPU_CLOCK),d0; retf`
// (docs/om1-cores-spec.md 8; the E144 family's window reads its own clock word, src/fw/board.mjs scpu): it reads
// the SCPU counter, and the hook reads the same word. E143 calls it once,
// to keep the counter at a start (return 0x5005a6d2, after its 7-byte call); a later body also reads it to count the
// time since that start (E137, docs/om1-settings-spec.md K-CRT-134D)
// SCPU_REQUEST: the firmware's SCPU request API, which posts each request to PER_SCPU (observed; src/lab/scpulink.mjs)
export const FLASH_SAVE = A(0x503EEE94), FLASH_SAVE_RETURN = A(0x503C5537), SCPU_REQUEST = A(0x5005CD17);
// the requesters' waits for their completion flags, {flag id word -> the wait's return}: the backed-up word write
// (0xf5) and read (0xf6), the date set (0xf7) and get (0xf8); they run natively, observed as they return
export const SCPU_WAITS = new Map([[A(0x6004315A), A(0x5005A7F9)], [A(0x6004315C), A(0x5005A85F)], [A(0x6004315E), A(0x5012C87D)], [A(0x60043160), A(0x5012C8D3)]]);
// whether the SCPU keeps the camera's backup words and clock, which the store init requests through SCPU_REQUEST
// (src/fw/facts.mjs scpuBackup, its request names; E143's do, D); the request API, its senders and PER_SCPU's
// completion call are E143's on E146, E147, E139 and E134, the bodies with them (X: their disassembly)
export const SCPU_BACKUP = fact('scpu.backup', true);
// the readers of the replies (the backed-up word, the date), observed
export const SCPU_REPLY_READERS = new Map([[A(0x5005A86C), [A(0xA32C6502), 4]], [A(0x5012C8E0), [A(0xA32D7290), 8]]]);
export const STORE_PROP_SITES = [A(0x503D72C5), A(0x503D2551)];
export const REGISTRY_PRINTS = ['FlD.', 'BlD.', 'ElD.', 'MlD.'];
// S-NVRAM (opt-in, env.nvram: a host that keeps the camera's non-volatile state between sessions). The stores' flash
// images: the registry bootstrap 0x50040aeb validates each store's mirror (format byte at +0, the u16 sum 0, 0x5003f7d4)
// and copies it into the store (print 'xlR.') or builds the store from its template ('xlD.'); the boot loads the
// mirrors from NAND before it (0x5000941f -> 0x5003e0a1), which the lab does not run. A save (0x5003f5dd) writes the
// store through 0x5003d9da(d0 size, d1 0x10100, a0 source, a1 mirror), or posts it to the flash task (0x5003d95c, the
// callback a stack argument, which the task calls with the write's result: 0x5003d8eb); 0x5003d9da programs the NAND
// (controller 0x98d01800) and reads the page back into the mirror (D)
export const NAND_WRITE = A(0x5003D9DA), NAND_POST = A(0x5003D95C), STORE_SAVE_CFLUSH_RETURN = A(0x5003F67E), NAND_WRITE_OP = 0x10100;
export const STORE_MIRRORS = { M: [A(0xA36FD280), 0x40000], E: [A(0xA377D280), 0x30000] };
// the replace-info state 0x5003e4da leaves for a NAND whose M log has no replaced area (the pointer pair and the
// empty page it points to, D)
export const REPLACE_INFO = [[A(0xA32A9788), A(0xA3212700)], [A(0xA32A978C), A(0xA3212704)], [A(0xA3212700), 0]];
// the SCPU words the camera keeps across power-off: the clock signature 0x00 (bits 7..2 = 42 once a clock set was
// verified, 0x5005a59e) and the B store 0x08..0x3c
export const SCPU_BACKED = [0x00, ...Array.from({ length: 14 }, (_, i) => 0x08 + 4 * i)];
// the SCPU's date requests (Sctime, through 0x5005cd17): 0x01 sets it (0x5012c7d9), 0x81 gets it (0x5012c88d), in
// 9 bytes {u16 year, month, day, hour, minute, second, u16 status} (D); the sub-CPU's RTC keeps it (src/lab/scpudev.mjs
// ScpuMemory), in S-NVRAM's file when there is one
export const PANEL_FLAG = A(0x60043188);                                   // the panel driver's serial completion flag id (E143's EVF panel; S-PANELDONE)
export const NATIVE_HOOK_LIMIT = 2000000;
// the static constructor tables the lab runs after the memory managers' (src/lab/osd.mjs mm_ctors), as [table, count]
// (src/fw/facts.mjs ctorTables): the modules' tables after the first and before the last, E143's modules 6 and 7 (the
// last, E143's module 8, the lab's start does not load). The counts are the loader's: E143 48 and 64, E122 39 and 63,
// E146 49 and 69, E144 47 and 69 (X; before 2026-10-30 the lab ran E143's counts on every build, which called past
// the end of shorter tables and left the rest of longer ones unrun)
export const CTOR_TABLES = fact('ctors', CTORS_E143).slice(1, -1);
if (ON_LAB_MODEL && CTOR_TABLES.map(([t]) => t).join() !== [A(0x60EF9AD0), A(0x615C71D4)].join()) throw new Error('CTOR_TABLES: not E143\'s tables of modules 6 and 7');
export const RPC_ENTRIES = [[A(0x50AF8487), A(0x50AF848C)], [A(0x50AC7347), A(0x50AC734C)]];
export const RPC_ORIGINS = [['finder-style', [A(0x5120CC98), A(0x5120CC9A)]], ['background-jpeg', [A(0x512504F1), A(0x512504F8)]]];
export const RES_BITMAPS_CALLERS = [A(0x51251C22), A(0x51251C53)];   // the bitmaps record's loads (E143 record 37)

const h8 = (v) => '0x' + fx(v >>> 0, 8);
const h4 = (v) => '0x' + fx(v >>> 0, 4);
const RT = IMAGE_BASE;
const u16i = (img, a) => img[a - RT] | img[a - RT + 1] << 8;
const u32i = (img, a) => { const o = a - RT; return (img[o] | img[o + 1] << 8 | img[o + 2] << 16 | img[o + 3] << 24) >>> 0; };
const latin1 = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
const cstrBytes = (b) => { const z = b.indexOf(0); return z < 0 ? b : b.subarray(0, z); };
export const s16 = (v) => { v &= 0xFFFF; return v & 0x8000 ? v - 0x10000 : v; };

// Whether the menus are the ListMenu framework whose tab and page tables menudata.mjs decodes (src/fw/facts.mjs
// listMenu; E143: its tab menu's class strings, 0x68 bytes past the tab table, D). A build on the older Menu_Viewer /
// Cursor_2CNL framework has no such tables: no tab entries to persist, no experiment inputs.
export const LIST_MENU = fact('menu.list_menu', true);
// [tab, page]: the store ids of the tab and page the ListMenu open starts at, which the experiment inputs set
// (src/fw/facts.mjs menuMemory; E143's 1881 and 1882, D); null without ListMenu (not identified there)
export const MENU_MEMORY = LIST_MENU ? [fact('menu.tab_memory', 1881), fact('menu.page_memory', 1882)] : null;
// the ids S-PERSIST takes besides the tab entries' cursor memories: the language and the menu memory
export const PERSIST_FIXED = [T.LANG_SETTING, ...(MENU_MEMORY ?? [])];
// S-PERSIST's listed ids: PERSIST_FIXED and every tab entry's cursor-memory list.
export function persist_ids(img) {
  const out = new Set(PERSIST_FIXED);
  if (!LIST_MENU) return out;
  for (const t of M.tabs(img)) for (const sid of t.aux) out.add(sid);
  return out;
}
const NAMES = new WeakMap();
// GUI state number (parent << 8 | child) -> 'PARENT/CHILD', from the firmware's name tables.
export function state_names(image) {
  let out = NAMES.get(image);
  if (out) return out;
  const cstr = (a) => { const o = a - RT; return latin1(image.subarray(o, image.indexOf(0, o))); };
  out = new Map();
  for (let i = 0; i < 12; i++) {
    const a = STATE_TABLE + 12 * i;
    const parent = u16i(image, a), name = u32i(image, a + 4), sub = u32i(image, a + 8);
    for (let j = 0; u16i(image, sub + 8 * j) !== 0xFFFF; j++) {
      out.set((parent << 8 | u16i(image, sub + 8 * j)) >>> 0, cstr(name) + '/' + cstr(u32i(image, sub + 8 * j + 4)));
    }
  }
  NAMES.set(image, out);
  return out;
}
// Experiment inputs: the tab and page memories (MENU_MEMORY) and the page's cursor memory unless cursor is 0. [page
// id, cursor id, Map].
export function inputs_for(img, tab, page, cursor) {
  if (!LIST_MENU) return [null, null, new Map()];
  const [pageId, cursorId] = M.page_of(img, tab, page);
  const inputs = new Map([[MENU_MEMORY[0], tab], [MENU_MEMORY[1], page]]);
  if (cursor) inputs.set(cursorId, cursor);
  return [pageId, cursorId, inputs];
}

export class MenuError extends FirmwareError {}

// GUI task on K-native + display stack. Construct, then bring_up(device). opts: lang, inputs (Map), seed (Map),
// key_mode, store, store_first, evf_layout, time.
export class MenuLab extends T.TextDisplayLab {
  static INSN_LIMIT = 200000000;
  static own_kernel = true;
  constructor(env, opts = {}) {
    super(env, { ...opts, kernel: 'native' });
  }
  preinit(opts) {
    const store = opts.store ?? 'native';
    if (store !== 'native' && store !== 'empty') throw new ValueError(`store ${show(store)}: native or empty`);
    if (opts.store_first && store !== 'native') throw new ValueError('store_first needs the native store');
    this.store = store;
    this.store_first = !!opts.store_first;
    this.evf_layout = !!opts.evf_layout;
    this.b2_options = {};
    this.takeover_log = null;
    this.inputs = new Map(opts.inputs ?? []);
    this.seed = new Map(opts.seed ?? []);
    this.prop_sites = [...PROP_GUI_SITES, ...(store === 'native' ? STORE_PROP_SITES : []), ...(MODEL_INFO.prop_sites ?? [])];
    this.store_log = { phases: [], persist: [], scpu_waits: [], scpu_requests: [], scpu_replies: [], scpu_frames: [], cflush: new Map(), crt134d: [], flash_save: [], dial: null };
    this.key_mode_wanted = opts.key_mode ?? 'refuse';
    this.settings_log = [];
    this.language_changes = [];
    this.gui_log = [];
    this.rpc_log = [];
    this.events = [];
    this.draw_log = [];
    this.exec_history = [];
    this.exec_lost = 0;
    this.key_hits = 0;
    this.markers = [];
    this.display_runs = 0;
    this.route_log = new Tally();
    this.native_calls = [];
    this.ctor_results = [];
    this.dropped_sends = [];
    this.gui_props = new Tally();
    this.value_sites = new Map();
    this.phase = 'init';
    this.stub_hits = new Tally();
    this.persist_ids = persist_ids(new M.Image(this.image));
    super.preinit({ ...opts, kernel: 'native' });
  }
  // ---- hook helpers
  on_stub(name) {
    super.on_stub(name);
    if (!name.startsWith('obs-')) this.stub_hits.add([this.phase, name, this.in_display_run() ? 'display' : 'gui']);
  }
  // Let the hooked instruction at r.pc run natively once (a step ignores breakpoints).
  passthrough(r) { this.sim.run([], true); }
  observe(address, fn, name) { this.hook(address, (hle, r) => { fn(this, r); this.passthrough(r); }, name); }
  stack_args(r, n) {
    const call = this.sim.read(r.mdr - 7, 7);
    let size;
    if (call[0] === 0xDD) size = call[6];
    else {
      const short = this.sim.read(r.mdr - 5, 5);
      if (short[0] !== 0xCD) throw new MenuError(`stack arguments at ${where(r.pc)}: not reached by CALL (mdr ${where(r.mdr)})`);
      size = short[4];
    }
    return unpack(`<${n}I`, this.sim.read(r.sp + size + 4, 4 * n));
  }
  // ---- bring-up, step 1 (inside OsdLab's init): K-native
  native_init() {
    this.state_names = state_names(this.image);
    this.nk = new K.NativeKernel(this);
    this.nk.boot();
    this.kernel.go_native(this.nk.intc);
    this.lt = new K.LabTask(this.nk, LAB_PRI, null, 0x60000, [GUI_TASK, GENIFA_TIMER_TASK, EMPTY_TASK, EYEFI_TASK, ...(D.HAS_CHANGE ? [CHANGE_TASK] : []),
      ...(D.CHANGE_ENTRY !== null ? [D.CHANGE_ENTRY] : [])]);
    this.lt.start();
    this.lt.make_settle_sem();
    R.load(this.sim, this.block);
    this.hook(T.SETTINGS_READ, (h, r) => this._s_set(h, r), this.store === 'empty' ? 'S-STORE' : 'obs-setting');
    this.hook(T.RES_GET, (h, r) => this._s_res(h, r), 'S-RES');
    this.hook(T.GPIFONT_LOG, (h, r) => this._s_log(h, r), 'S-LOG');
    const guards = [...EXPECTED_RECORDS.map(([b]) => [b, HEIGHT]), KIND3_AREA];
    guards.forEach(([base, height], slot) => this.engine.set_guard(slot, base, STRIDE, height));
    this.engine.set_key_mode(this.key_mode_wanted);
    for (const [callsEntry, callEntry] of RPC_ENTRIES) {
      this.hook(callEntry, (h, r) => this._s_rpc(h, r), 'S-RPC');
      this.hook(callsEntry, (h, r) => this._s_rpc(h, r), 'S-RPC');
    }
    this.install_observers();
    this.records = [];
    for (let i = 0; i < NRECORDS; i++) this.records.push(this.sim.u32(REGISTRY + 8 * i));
    this.records.push(KIND3_RECORD);
    this.surfaces = [];
  }
  // ---- RTOS routing on K-native
  in_display_run() { return (this.depth ?? 0) > 0 || this.display_runs > 0; }
  // S-LABSLEEP: the lab task runs a harness call of its own (not a settle, where it waits for the firmware's tasks):
  // a sleep there (OlyTaSS) is the lab clock's, as in a display run. Natively the lab task would wait for kernel ticks
  // that no lab time brings inside the call, and the idle would find every task blocked (E145's HighLevel create
  // reaches the measurement on the block src/fw/board.mjs stub_pages names through API 0xa0004, which sleeps 1 to
  // 50 ms between its register writes, X; the addresses are in docs/model-survey.md)
  lab_task_call() { return (this.call_depth ?? 0) > 0 && !this.lt.settling && this.lt.current() === this.lt.tcb(this.lt.tid); }
  route_rtos() {
    const vsync = new Set([...D.VSYNC_FLAG_IDS, ...D.VSYNC_ALIAS_IDS].map((a) => { const b = this.sim.read(a, 2); return b[0] | b[1] << 8; }));
    const change = D.HAS_CHANGE ? this._queue(D.CHANGE_QUEUE) : null;
    const panel = this._queue(PANEL_FLAG);
    this.panel_answered = 0;                       // S-PANELDONE: the waits answered so far (the player lists it once one was)
    // S-FRAMEWAIT's flag (src/fw/facts.mjs frameWait, the word the device open waits on per frame); E143's null: the
    // lab leaves its open's wait native, as before (its start does not reach it, X); null too on a build with no such
    // wait (E120, X; fact() gives a read null as undefined, hence the ?? null)
    // the display waits' stand-ins, on a board that takes them (src/fw/board.mjs display_wait_stand_ins)
    const standIns = BOARD.display_wait_stand_ins;
    const frameWord = standIns ? fact('display.frame_wait', null) ?? null : null, frameFlag = frameWord === null ? null : this._queue(frameWord);
    this.vsync_ids = vsync;
    const scoped = (name, stub, useStub) => (hle, r) => {
      if (useStub(r)) { this.route_log.add([name, 'stand-in']); return stub(hle, r); }
      this.route_log.add([name, 'native']);
      this.passthrough(r);
    };
    for (const [address, name] of RTOS) {
      if (name === 'OlyEvWt') this.wrap(address, (stub) => {
        const inner = scoped(name, stub, (r) => vsync.has(r.d0 & 0xFFFF));
        // S-PANELDONE (with S-MODACK, camapp.mjs): the wait for the EVF panel command's completion (flag id at
        // PANEL_FLAG; DISPLAY cmd 7's 0x501c64b9 on the EVF, after the request 0x50047313), made by a display run nested
        // in another harness call, is answered at once: S-MODACK answers module requests only after the step, and
        // natively the wait would dispatch away from the outer call, which then returns into a trampoline no loop is
        // watching (E143's EVF playback, X). A display run of its own waits natively, as before, except on a board with
        // the display waits' stand-ins (BOARD.display_wait_stand_ins): there every display run's wait for the flag is
        // answered at once, because the lab models no serial channel. The flag is the one the panel driver's serial
        // transfers complete with, and natively only the channel's completion interrupt sets it after a send (the
        // TG-5 bodies' TFT open: their panel driver sends its command list over a serial channel and waits for the
        // flag its completion callback sets, D; the port's place of PANEL_FLAG there is that flag, X; the addresses
        // are in docs/model-survey.md). Their wait for the channel's grant, on the same flag, which the request's own
        // callback sets before the request returns (D), is answered too
        return (hle, r) => {
          // S-FRAMEWAIT (a later model): the display code's wait for frames through a flag its VSC frame callback sets
          // (E144: the callback 0x5018220c, registered by 0x50185044, sets 0x600416ac; the open waits at 0x50181d17):
          // the lab clock runs to the channel's next frame boundary and the wait runs natively, so the frame IRQ's
          // native ISR sets the flag. The callback is registered on the channel of the device opened (D), which the
          // lab knows where the TFT and the EVF share one (VSC kind 2, D.DEVICE); elsewhere it refuses
          if ((r.d0 & 0xFFFF) === frameFlag && this.in_display_run()) {
            const c = D.DEVICE.tft.channel, from = `OlyEvWt 0x${frameFlag.toString(16)} from ${where(r.mdr)}`;
            if (D.DEVICE.evf.channel !== c) throw new FirmwareError(`S-FRAMEWAIT ${from}: the TFT and the EVF are on two VSC channels, and the device opened is not known`);
            this.route_log.add([name, 'S-FRAMEWAIT']);
            this.run_to_frame(c, `S-FRAMEWAIT ${from}`);
            inner(hle, r);
            return;
          }
          if ((r.d0 & 0xFFFF) === panel && this.in_display_run() && (standIns || (this.panel_done && this.call_depth >= 2))) {
            this.route_log.add([name, 'S-PANELDONE']);
            this.panel_answered += 1;
            if (r.a0) this.sim.write(r.a0, pack('<I', r.d1 >>> 0));
            hle.finish(r, { d0: 0 });
            return;
          }
          // S-IRQFIRST: a wait in a display run takes the interrupts the lab's devices present before it runs natively.
          // The lab accepts a native interrupt only at the idle point (the gate at IDLE_DONE), where the camera takes it
          // when presented: a device modelled as done at once (the VSC serial engine, src/dev/vsc.mjs) presents its
          // completion before the wait for the flag its ISR sets, so on the camera the flag is set first (I). Natively
          // the wait would dispatch to a ready task first (E142's DISPLAY cmd 26 waits for the serial engine's flag,
          // which the VSC ISR's INTST1 bit-15 branch sets, D; the application task the sender had made ready then read
          // its reply inside the display run, X; the addresses are in docs/model-survey.md)
          if (this.in_display_run() && this.pending_irq()) {
            this.route_log.add([name, 'S-IRQFIRST']);
            const saved = { ...r };
            this.kernel.deliver();
            if (this.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
            r = saved;
          }
          inner(hle, r);
        };
      }, name + '(scoped)');
      else if (EV_WRAPPERS.has(name)) this.wrap(address, (stub) => scoped(name, stub, (r) => vsync.has(r.d0 & 0xFFFF)), name + '(scoped)');
      else if (name === 'OlyQeWr') this.wrap(address, (stub) => scoped(name, stub, (r) => (r.d0 & 0xFFFF) === change), name + '(scoped)');
      else if (name === 'OlyTaSS') this.wrap(address, (stub) => scoped(name, stub, () => this.in_display_run() || this.lab_task_call()), name + '(scoped)');
      else this.observe(address, (lab, r) => lab._native_call(name, r), name + '(native)');
    }
    // S-TIMERSLEEP (a later model): the display code's sleep on the software timer (src/fw/facts.mjs timerSleep), d0
    // ms (I) on a one-shot timer slot whose callback sets the flag it then waits for without timeout. Outside time
    // mode the lab's software timer does not run (H-TIMER leaves its tick's hardware unprogrammed; E134's TFT open
    // blocked in it, X), so in a display run, called with no callback (a0 null), it is OlyTaSS's stand-in: the lab
    // clock moves d0 ms and it returns 0; otherwise it runs natively. None on a board without the stand-ins
    const timerSleep = standIns ? fact('display.timer_sleep', null) : null;
    if (timerSleep !== null) this.hook(timerSleep, (hle, r) => {
      if (r.a0 !== 0 || !this.in_display_run()) { this.passthrough(r); return; }
      this.route_log.add(['timer sleep', 'S-TIMERSLEEP']);
      this._sleep(hle, { ...r, d0: r.d0 & 0xFFFF }, 'S-TIMERSLEEP');
    }, 'S-TIMERSLEEP');
    this.wrap(D.GET_TID, (tidStub) => scoped('get_tid', tidStub, () => this.in_display_run()), 'get_tid(scoped)');
    const orig = this.kernel.deliver;
    this.kernel.deliver = (bound = 8) => K.in_interrupt(this.lt, () => orig(bound));
    this._deliver_raw = orig;
  }
  _native_call(name, r) {
    this.route_log.add([name, 'native']);
    this.native_calls.push([name, r.d0 & 0xFFFF, where(r.mdr)]);
  }
  step(name, action, allow_errors = [], allow_errlog = []) {
    this.display_runs += 1;
    try { return super.step(name, action, allow_errors, allow_errlog); } finally { this.display_runs -= 1; }
  }
  pending_irq() { return this.kernel.sources.some(([, check]) => check()); }
  // kernel.mjs's settle with this session's interrupt sources; the GUI must not be left mid-paint.
  settle(label) {
    try { return this.lt.settle(this._deliver_raw, () => this.pending_irq()); } catch (e) {
      if (e instanceof FirmwareError) e.addNote(`during ${label}; GUI state ${this.state_name(this.state())}; tasks ${show(this.task_states())}`);
      throw e;
    }
  }
  // Time mode: lab time runs ms milliseconds forward with the lab task waiting (ELAPSE); returns the idle log.
  elapse(ms, label = 'elapse', limit = 2000000) {
    if (!this.time_mode) throw new MenuError('elapse needs time mode (a MenuLab with time: true)');
    const target = this.lab_time() + Math.trunc(ms * 1000000);
    try { return this.lt.elapse_until(target, () => this.lab_time(), (x) => this.run_to_event(x), limit); } catch (e) {
      if (e instanceof FirmwareError) e.addNote(`during ${label}; GUI state ${this.state_name(this.state())}; tasks ${show(this.task_states())}`);
      throw e;
    }
  }
  task_states() {
    const out = new Map();
    for (const [tid, [entry, state]] of this.nk.tasks()) if (state !== 'DMT' && entry !== null) out.set(tid, `${h8(entry)} ${state}`);
    return out;
  }
  // ---- bring-up, step 2
  kernel_display(device = 'tft', ctors = true, before_open = null) {
    this.route_rtos();
    if (ctors) this.run_static_ctors();
    if (D.HAS_CHANGE) {
      this.hooks.delete(runtime(D.CHANGE_WAIT_POLL));
      refuseUnmapped(CHANGE_TASK, 'CHANGE task');
      const ids = [];
      for (const [t, [e]] of this.nk.tasks()) if (e === CHANGE_TASK) ids.push(t);
      if (ids.length !== 1) throw new MenuError(`CHANGE task: static tasks with entry ${h8(CHANGE_TASK)}: ${show(ids)}`);
      this.change_tid = ids[0];
      const [rc] = this.nk.svc('act_tsk', { d0: this.change_tid });
      if (rc !== K.E_OK || this.nk.state(this.change_tid) !== 4 || this.nk.timed_waiters().length) {
        throw new MenuError(`act_tsk(CHANGE task ${this.change_tid}) = ${rc}, state ${show(this.task_states())}`);
      }
    }
    this.start();
    if (before_open) before_open();
    this.open(device);
  }
  bring_up(device = 'tft') {
    if (this.evf_layout && device !== 'evf') throw new ValueError('evf_layout: the EVF layout inputs apply to the EVF only');
    this.phase = 'display';
    if (this.store_first) {
      this.kernel_display(device, true, () => { this.store_init(); this.phase = 'display'; });
    } else {
      this.kernel_display(device);
      if (this.store === 'native') this.store_init();
    }
    if (this.store === 'native') { this.persist_inputs(); this.dial_init(); }
    this.phase = 'bring-up';
    if (this.gui_by_app) {                         // H-GUIBYAPP: the application creates the GUI (gui_adopt after it)
      this.records = []; this.surfaces = []; this.gui_tid = null; this.timer_tid = null;
      this.init_log = [...this.exec_history]; this.init_commands = this.init_log.length + this.exec_lost;
      this.init_loaded = []; this.bringup_prints = []; this.init_prints_seen = [];
      return [];
    }
    const out = this.alloc(new Uint8Array(16), 4);
    const prints0 = this.kernel.events.filter((e) => e[0] === 'print').length;
    this.call(GUI_CREATOR, { a0: out }, null, null, 200000);
    this.creator_out = [this.sim.u32(out), this.sim.u32(out + 4)];
    this.bringup_settle = this.settle('GUI bring-up');
    this.harvest();
    this.harvest_gui_records();
    const bitmaps = R.layout(this.block).images[1];
    this.init_loaded = this.loaded.filter((x) => !(x[0] === bitmaps && x[1] === 1));
    this.init_log = [...this.exec_history];
    this.init_commands = this.init_log.length + this.exec_lost;
    const problems = this.check_init();
    const tasks = this.nk.tasks();
    const gui = [], timer = [];
    for (const [t, [e]] of tasks) { if (e === GUI_TASK) gui.push(t); if (e === GENIFA_TIMER_TASK) timer.push(t); }
    const started = this.lt.started.slice(1).map(K.disasm_of);
    const wantStarted = [...(D.HAS_CHANGE ? [CHANGE_TASK] : []), EMPTY_TASK, GUI_TASK, GENIFA_TIMER_TASK, ...(this.time_mode && !this.skip_defer ? [D.DEFER_TASK] : []), ...(this.scpu_link ? [PER_SCPU_TASK] : [])];
    const sortNum = (xs) => [...xs].sort((a, b) => a - b);
    if (JSON.stringify(sortNum(started)) !== JSON.stringify(sortNum(wantStarted))) problems.push(`tasks started: ${show(started.map(hex))}`);
    if (gui.length !== 1 || timer.length !== 1 || tasks.get(gui[0])[1] !== 'WAI' || tasks.get(timer[0])[1] !== 'WAI') {
      problems.push(`GUI/timer tasks: ${show(this.task_states())}`);
    }
    this.gui_tid = gui.length ? gui[0] : null;
    this.timer_tid = timer.length ? timer[0] : null;
    if (this.state() !== STATE_POWER_ON) problems.push(`GUI state ${this.state_name(this.state())}, not 0x0102 POWER_ON`);
    const prints = this.kernel.events.filter((e) => e[0] === 'print').slice(prints0);
    this.bringup_prints = prints.map((e) => [e[1], e[2]]);
    if (this.bringup_prints.length) problems.push(`kernel prints: ${show(this.bringup_prints.slice(0, 4))}`);
    const bad = this.ctor_results.filter((c) => c.status !== 'ok');
    if (bad.length) problems.push(`${bad.length} static constructors failed: ${show(bad.slice(0, 2))}`);
    this.check_engine(this.init_log, 'bring-up');
    if (this.store === 'native') {
      const langReads = this.settings_log.filter(([sid, , k]) => sid === T.LANG_SETTING && k === 'native').map(([, v]) => v);
      if (!langReads.length || new Set(langReads).size !== 1 || langReads[0] !== this.setting) {
        problems.push(`native reads of ${T.LANG_SETTING} during bring-up ${show(langReads)}, the session language ${this.lang} is ${this.setting}`);
      }
    }
    if (problems.length) throw new MenuError('bring-up: ' + problems.join('; '));
    this.init_prints_seen = prints;
    if (this.evf_layout) this.evf_layout_inputs(this.b2_options);
    return problems;
  }
  // The OSD drawing records the GUI's creation registers (REGISTRY) and their surfaces.
  harvest_gui_records() {
    this.records = [];
    for (let i = 0; i < NRECORDS; i++) this.records.push(this.sim.u32(REGISTRY + 8 * i));
    this.records.push(KIND3_RECORD);
    this.surfaces = [];
    for (let i = 0; i <= NRECORDS; i++) this.surfaces.push(this.record(i));
  }
  // H-GUIBYAPP: the application's start can wait in lab time before it creates the GUI. E139's first reads a source
  // state (the charge source, I) through a measurement in 50 ms steps on the block src/fw/board.mjs stub_pages names
  // (D), where E143's query answers 0 at once (`clr d0; retf`, D); its CA_MAIN waits there after its settle and the GUI
  // exists 100 ms on (X).
  // Lab time runs in GUI_START_SLICE_MS slices until the GUI task exists, at most GUI_START_MS: a start that creates
  // the GUI within its settle (E143, E144) runs none.
  gui_await() {
    const created = () => [...this.nk.tasks()].some(([, [e]]) => e === GUI_TASK);
    for (let ms = 0; !created() && ms < GUI_START_MS; ms += GUI_START_SLICE_MS) this.elapse(GUI_START_SLICE_MS, 'H-GUIBYAPP start');
  }
  // H-GUIBYAPP: after the application's start has created the GUI (its own call of the creator, 0x510609ce ->
  // GUI_CREATOR, from CA_MAIN's code): its records, its GUI task and timer task, one of each.
  gui_adopt() {
    this.harvest_gui_records();
    const gui = [], timer = [];
    for (const [t, [e]] of this.nk.tasks()) { if (e === GUI_TASK) gui.push(t); if (e === GENIFA_TIMER_TASK) timer.push(t); }
    if (gui.length !== 1 || timer.length !== 1) throw new MenuError(`H-GUIBYAPP: GUI tasks ${show(gui)}, timer tasks ${show(timer)} after the application's start, not one each`);
    this.gui_tid = gui[0];
    this.timer_tid = timer[0];
  }
  // ---- B2 inputs
  b2_snapshot() {
    const cc = this.sim.u32(CCOMMON);
    return { layout: this.sim.read(LAYOUT_BYTE, 1)[0], connect: cc ? this.sim.u32(cc + 16) : null };
  }
  install_b2_observers(extraReaders = []) {
    this.b2_trace = [];
    this.module9_reads = [];
    const allowed = this.takeover_allowed = new Set([...TAKEOVER_READERS, ...extraReaders]);   // S-CAMAPP adds its own
    const tag = () => this.step_tag ?? this.phase;
    const entry = (name, address) => (lab, r) => {
      const ra = r.mdr;
      this.b2_trace.push([tag(), name, r.d0 >>> 0, r.d1 >>> 0, disasm(ra)]);
      if (B2_RETURNS.has(address)) {
        if (this.hooks.has(ra)) throw new MenuError(`${name} returns to ${where(ra)}, already hooked: return value not observable`);
        const back = (hle, r2) => {
          this.b2_trace.push([tag(), name + ' ret', r2.d0 >>> 0, null, null]);
          this.hooks.delete(ra);
          this.passthrough(r2);
        };
        this.hook_rt(ra, back, 'obs-b2-return');
      }
    };
    // (ctrl_or, the VSC's CTRL3 read-modify-write, only where the port places it: the kind-3 VSC's builds, the E118
    // family's, have no counterpart the map finds, X; src/lab/play.mjs install_brackets)
    for (const [address, name] of B2_OBSERVED) if (name !== 'ctrl_or' || !isUnmapped(address)) this.observe(address, entry(name, address), `obs-${name}`);
    const point = (name, reg) => (lab, r) => {
      const v = r[reg] >>> 0;
      let extra = null;
      if (name === 'vt+56 ret') extra = unpack('<4I', this.sim.read(r.sp + 12, 16));
      else if (name === '0x510c91eb ret') extra = unpack('<I', this.sim.read(GATE_WORD, 4))[0];
      this.b2_trace.push([tag(), name, reg === 'a1' ? disasm(v) : v, extra, null]);
    };
    for (const [address, [name, reg]] of B2_POINTS) if (!isUnmapped(address)) this.observe(address, point(name, reg), `obs-${name}`);
    const moduleRead = (lab, r) => {
      if ((r.d0 & 0xFFFF) !== TAKEOVER_MODULE || this.takeover_log === null) return;
      const site = disasm(r.mdr);
      this.module9_reads.push([tag(), site]);
      if (!allowed.has(site)) {
        throw new MenuError(`S-TAKEOVER scope: module ${TAKEOVER_MODULE} state read from ${where(r.mdr)}, not one of the listed readers ${show([...allowed].sort((a, b) => a - b).map(hex))}`);
      }
    };
    this.observe(MODULE_STATE_GET, moduleRead, 'obs-module-state');
  }
  // S-TAKEOVER then H-CONNECT; records takeover_log.
  evf_layout_inputs({ takeover = true, loutput = CONNECT_LOUTPUT, extra_readers = [] } = {}) {
    if (this.b2_trace === undefined) this.install_b2_observers(extra_readers);
    const before = this.b2_snapshot();
    const log = { before, takeover: null, connect: null };
    this.phase = 'b2';
    if (takeover) {
      this.call(MODULE_STATE_SET, { d0: TAKEOVER_MODULE, d1: TAKEOVER_STATE }, null, null, 200);
      log.takeover = { module: TAKEOVER_MODULE, state: TAKEOVER_STATE,
        label: 'S-TAKEOVER 0x50ab6299(9, 2): the value API 70405 writes at 0x50ae0048 (boot take-over 0x501e6adb); the camera\'s state at menu time is not known' };
    }
    this.takeover_log = log;
    const n0 = this.b2_trace.length, r0 = this.rpc_log.length, e0 = this.kernel.errors.length;
    const msg = this.alloc(pack('<8I', CONNECT_EVENT, loutput, 0, 0, 0, 0, 0, 0), 4);
    this.calls(SEND_EVENT, { a0: 0, a1: msg }, undefined, undefined, 20000);
    this.settle('H-CONNECT');
    log.connect = { index: CONNECT_EVENT, loutput, message: h4(this.message_for(CONNECT_EVENT)), trace: this.b2_trace.slice(n0),
      rpc: this.rpc_log.slice(r0), errlog: this.kernel.errors.slice(e0).map(([c]) => h8(c)), after: this.b2_snapshot(),
      label: 'H-CONNECT sendEvent(0x83, 7): lOutput 7, the sender 0x5105053c\'s INTERNAL_EVF row (its EVF row is lOutput 3); which row the camera takes is not traced' };
    if (this.state() !== STATE_POWER_ON) throw new MenuError(`H-CONNECT: GUI state ${this.state_name(this.state())}, not POWER_ON`);
    return log;
  }
  run_static_ctors() {
    for (const [m, [table, n]] of CTOR_TABLES.entries()) {
      for (let i = 0; i < n; i++) {
        const fn = disasm(this.sim.u32(table + 4 * i));
        const ev0 = this.kernel.events.length;
        let status;
        try {
          this.calls(fn, null, A(0xA2200000) - 32, undefined, 100000);
          status = 'ok';
        } catch (e) {
          if (!(e instanceof FirmwareError)) throw e;
          status = `FAIL ${e.message}`.slice(0, 300);
        }
        const prints = this.kernel.events.slice(ev0).filter((e) => e[0] === 'print').map((e) => e[2].trim());
        this.ctor_results.push({ module: m, index: i, fn: h8(fn), status, prints });
      }
    }
  }
  // Engine results must be clean, except BMP_TRANSPARENCY in the default (refuse) U1 mode.
  check_engine(log, label) {
    const allowed = this.key_mode_wanted === 'refuse' ? new Set([F.ERROR_CODE.BMP_TRANSPARENCY]) : new Set();
    const bad = new Map();
    for (const e of log) if (e.result && !allowed.has(e.result)) bad.set(F.ERRORS[e.result], (bad.get(F.ERRORS[e.result]) ?? 0) + 1);
    if (bad.size) throw new EngineError(`${label}: engine errors ${show(bad)}`);
  }
  // ---- settings store (M6)
  stub_pages() {
    const out = [];
    for (let i = 0; i < 32; i++) {
      const [page, size, enabled] = unpack('<III', this.sim.read(D.STUB + 0x100 + 12 * i, 12));
      if (enabled) out.push([page, size]);
    }
    return out;
  }
  // CALL fn natively in the lab task; record prints and errlog.
  native(fn, regs = null, label = '', limit = NATIVE_HOOK_LIMIT) {
    const ev0 = this.kernel.events.length, err0 = this.kernel.errors.length, t0 = performance.now();
    const rec = { label, fn: h8(fn) };
    try {
      const r = this.call(fn, regs, null, null, limit);
      Object.assign(rec, { ok: true, d0: r.d0 });
    } catch (e) {
      if (!(e instanceof FirmwareError)) throw e;
      Object.assign(rec, { ok: false, error: e.message.slice(0, 1500) });
      const err = new MenuError(`${label}: ${e.message}`);
      throw err;
    } finally {
      rec.prints = this.kernel.events.slice(ev0).filter((e) => e[0] === 'print').map((e) => e[2].trim());
      rec.errlog = this.kernel.errors.slice(err0).map(([c, , , caller]) => [h8(c), caller]);
      rec.seconds = Math.round((performance.now() - t0) / 100) / 10;
      this.store_log.phases.push(rec);
    }
    return rec;
  }
  // The firmware's own blank-store path: registry bootstrap, then settings-DB init, natively, with the stand-ins.
  store_init() {
    this.phase = 'store';
    const cover = this.stub_pages().filter(([p, n]) => p <= SCPU && SCPU < p + n);
    if (cover.length) throw new MenuError(`lab stub page ${show(cover)} covers the SCPU block ${h8(SCPU)}`);
    this.hook(K_CFLUSH, (h, r) => this._k_cflush(h, r), 'K-CFLUSH');
    this.hook(K_CRT_134D, (h, r) => this._k_crt_134d(h, r), 'K-CRT-134D');
    const nvram = this.env.nvram ?? null, saved = nvram ? nvram.load() : null, loaded = nvram ? this.nvram_load(saved) : null;
    if (nvram) {                                      // S-NVRAM: the stores' saves run natively down to the NAND write
      this.hook(NAND_WRITE, (h, r) => this._s_nand_write(h, r, false), 'S-NVRAM');
      this.hook(NAND_POST, (h, r) => this._s_nand_write(h, r, true), 'S-NVRAM (flash task)');
    } else this.hook(FLASH_SAVE, (h, r) => this._s_flash_save(h, r), 'S-FLASHSAVE');
    // the sub-CPU's memory: S-NVRAM's, kept in its file and advancing with the host's local time, else a blank one whose
    // date advances with lab time (a session stays hermetic)
    this.scpu_memory = nvram ? new ScpuMemory(() => nvram.now(), { clock_offset: saved?.clock_offset ?? 0, clock_status: saved?.clock_status ?? 0, words: saved?.scpu_words ?? {} }, (st) => nvram.saveScpuMemory(st))
      : new ScpuMemory(() => Math.floor(this.lab_time() / 1e9));
    // H-SCPUSTART, S-SIO2, S-SCPUDEV: PER_SCPU started natively with the sub-CPU at the far end of its link
    // (src/lab/scpulink.mjs, src/lab/scpudev.mjs); the requests (the API's entry), the requesters' waits (OlyEvWt
    // 0x5002bdd8 on their flags) and the replies' readers run natively and are observed. A model whose SCPU keeps no
    // backup words or clock (SCPU_BACKUP; E144: no Sctime/ScpuBkup requests, D) has none of these sites, and the lab
    // does not start its PER_SCPU. The sub-CPU is S-SCPUDEV, or its own firmware (scpu_native)
    if (SCPU_BACKUP) {
      this.scpu_dev = this.scpu_native() ? this.scpu_m4(nvram)
        : new ScpuDev(this.scpu_memory, { words: fact('scpu.words', [[2, 0]]), quiet: fact('scpu.quiet', []) });
      this.store_log.scpu_frames = this.scpu_dev.frames;
      this.scpu_link = new ScpuLink(this, this.scpu_dev);
      this.scpu_link.bring_up();
      this.observe(SCPU_REQUEST, (lab, r) => lab.store_log.scpu_requests.push({ caller: where(r.mdr), request: bytesHex(lab.sim.read(r.a0 >>> 0, 28)) }), 'obs-scpu-request');
      for (const [reader, [address, size]] of SCPU_REPLY_READERS) {
        this.observe(reader, (lab) => lab.store_log.scpu_replies.push({ reader: h8(reader), address: h8(address), bytes: bytesHex(lab.sim.read(address, size)) }), 'obs-scpu-reply');
      }
      for (const [a, ra] of SCPU_WAITS) {
        refuseUnmapped(a, 'SCPU wait flag id word'); refuseUnmapped(ra, 'SCPU wait site');
        const b = this.sim.read(a, 2), flag = '0x' + (b[0] | b[1] << 8).toString(16);
        this.observe(ra, (lab, r) => lab.store_log.scpu_waits.push({ flag, site: h8(ra), rc: r.d0 | 0 }), 'obs-scpu-wait');
      }
    }
    this.boot_stage();
    const reg = this.native(REGISTRY_INIT, null, 'registry bootstrap 0x50040aeb');
    // with saved images the bootstrap restores those stores ('xlR.'); one it rejects is a broken save, not a blank camera
    const wantPrints = REGISTRY_PRINTS.map((p) => (loaded?.has(p[0]) ? p.replace('lD.', 'lR.') : p));
    if (JSON.stringify(reg.prints) !== JSON.stringify(wantPrints) || reg.errlog.length) {
      throw new MenuError(`registry bootstrap: prints ${show(reg.prints)}, errlog ${show(reg.errlog)}; expected ${show(wantPrints)} and none`);
    }
    // H-STOREINIT: the property store's own module init, the settings init chain's fifth (src/fw/facts.mjs propStore),
    // which the boot runs after the registry bootstrap and before the DB init (E143: the chain 0x503dae30 at 0x501e9060,
    // the DB init through 0x501eac35 at 0x501e907b, D); the lab runs none of the chain's other inits. It keeps the mode
    // store's three data pointers (the banks, the recalled rows, the working copy); without them a mode change staged
    // the working copy from address 0 and wrote zeros into every setting it holds (X: 612 settings read 0 once the
    // dial had left P, docs/om1-settings-spec.md section 2.2)
    const ps = propStoreInit(), si = this.native(ps.init, null, `property store init ${h8(ps.init)}`);
    const objects = [0, 4, 8].map((k) => this.sim.u32(ps.objects + k));
    if (si.d0 !== 0 || si.prints.length || si.errlog.length || objects.includes(0)) {
      throw new MenuError(`H-STOREINIT ${h8(ps.init)}: d0 ${si.d0}, prints ${show(si.prints)}, errlog ${show(si.errlog)}, object words ${h8(ps.objects)}: ${objects.map(h8).join(' ')}`);
    }
    const db = this.native(SETTINGS_DB_INIT, null, 'settings-DB init 0x503c5473');
    if (nvram) this.nvram_clock();
    else if (this.store_log.flash_save.length !== 1) {
      throw new MenuError(`settings-DB init returned with S-FLASHSAVE hit ${this.store_log.flash_save.length} times, expected once`);
    }
    // S-NVRAM: the blank path's saves of E and M run natively and print their marks; the flash save calls the damage
    // check 0x50003d04, which prints and returns while the boot's init 0x50003cf9 (not run by the lab) has not set
    // (0x97f00264) (D)
    const dbPrints = nvram ? (loaded.has('M') ? [] : ['ES.', 'MS.', 'damage_info uninitialized!']) : [];
    // A model whose SCPU keeps no backup words (SCPU_BACKUP false) keeps its backup store B in flash: where its DB
    // reset writes a setting B holds, the write saves B natively and the store save prints its mark "BS." (E144 and
    // E145, through their resets' clock-settings write, X; E143 sends the same write to the SCPU, silently). Whether a
    // reset makes that write is the body's (E142's reset calls a bare retf in its place, D; E137 and E140 print
    // nothing, X), so that one mark is allowed besides the expected prints.
    const backupSave = !nvram && !SCPU_BACKUP && JSON.stringify(db.prints) === JSON.stringify(['BS.']);
    // the logs a step expects (display.mjs EXPECTED_ERRLOG) are expected here too: a body whose settings getter reads a
    // device state logs that slot's fill on first read (E140)
    const dbErrlog = db.errlog.filter(([c]) => !D.EXPECTED_ERRLOG.has(parseInt(c, 16)));
    if ((JSON.stringify(db.prints) !== JSON.stringify(dbPrints) && !backupSave) || dbErrlog.length) throw new MenuError(`settings-DB init: prints ${show(db.prints)}, errlog ${show(dbErrlog.slice(0, 4))}`);
    this.store_log.scpu = this.scpu_registers();
  }
  // S-BOOTSTAGE: the boot's first stage readied, its bit (bit 0) set in the stages' ready word (fact 'boot.stage',
  // src/fw/facts.mjs bootState) before the store's start, as the boot's stage step would have set it (E129: the stage
  // step for stage 1 in the init task's chain; E143: the per-segment step for segment 1, D), which the lab, ending the
  // init task (src/lab/kernel.mjs), does not run. The lab's image holds every stage's code, so the stage is in place;
  // the step's other work is not done (E129: the stage's loaded mark, the current stage, the region set-up of a block
  // the lab does not model and the stage's hook list, empty for stage 1, D). E129's settings flash read waits for the
  // bit (2 ms sleeps, no timeout, D), and without it the store's registry bootstrap blocked (X); E143's and the other
  // bodies' starts test it at most and run as before with it (X: E143's screens, bin/modelcheck.mjs). The later stages
  // stay unset (?: which of their tests the lab's sessions reach). The addresses are in docs/model-survey.md (E129)
  boot_stage() {
    if (bootFacts().stage === null) return;          // a build without the stage test (the E118 family's)
    const word = bootFacts().stage, b = this.sim.read(word, 1)[0];
    if (b & 1) throw new MenuError(`S-BOOTSTAGE: the stage word ${h8(word)} has stage 1's bit before the store's start`);
    this.sim.write(word, Uint8Array.of(b | 1));
    this.boot_staged = true;
  }
  // The sub-CPU's own firmware at the far end of the link (src/lab/scpum4.mjs; docs/om1-scpu-spec.md section 8 step 6),
  // opt-in (env.scpu 'native', node's OM_EMU_SCPU=native) on a body whose SCPU image the STM32L4 machine is known to
  // boot (src/fw/models.mjs scpu_lle: E143, and E146 with the same image); the host passes the image (env.scpuImage,
  // node: checks/lib/env.mjs scpuEnv). Elsewhere, and by default, S-SCPUDEV
  scpu_native() { return !!MODEL_INFO.scpu_lle && (this.env.scpu ?? globalThis.process?.env?.OM_EMU_SCPU) === 'native'; }
  scpu_m4(nvram) {
    if (nvram) throw new MenuError('OM_EMU_SCPU=native with S-NVRAM: the sub-CPU\'s own backup domain (its RTC and backup registers) is not kept between sessions; use one or the other');
    const image = this.env.scpuImage;
    if (!image) throw new MenuError(`OM_EMU_SCPU=native: the host passed no SCPU image (env.scpuImage: ${MODEL_INFO.name}'s ${MODEL_INFO.scpu_lle.block}; node: checks/lib/env.mjs scpuEnv)`);
    return new ScpuM4(image, { now: () => this.lab_time(), lle: MODEL_INFO.scpu_lle });
  }
  // S-NVRAM's boot: the saved images (nvram.load()) into their mirrors (the NAND read the lab does not run), the
  // replace-info state, the SCPU window's backed-up words. Returns the set of restored store letters.
  nvram_load(saved) {
    const out = new Set();
    this.store_log.nvram = { loaded: [], saves: [] };
    if (!saved) return out;
    for (const [name, [mirror, size]] of Object.entries(STORE_MIRRORS)) {
      const img = saved[name];
      if (!img) continue;
      if (img.length !== size) throw new MenuError(`S-NVRAM: saved store ${name} is ${img.length} bytes, not ${size}`);
      this.sim.write(mirror, img);
      out.add(name);
    }
    if (out.size) for (const [a, v] of REPLACE_INFO) this.sim.word(a, v);
    // (SCPU words through CPU stores: the debugger's writes do not reach a device)
    if (saved.scpu) for (const off of SCPU_BACKED) if (saved.scpu[off] !== undefined) this.cpu_store(SCPU + off, saved.scpu[off] >>> 0);
    this.store_log.nvram.loaded = [...out];
    return out;
  }
  // S-NVRAM's clock: the SCPU counter (SCPU_CLOCK) at the sub-CPU's date (seconds since 1970-01-01, 0x5012bf86): the
  // host's local time plus the offset the camera's last clock setting left, as the camera's backed-up clock would read
  // after power-off (the boot's date read, which the lab does not run, would set it from the sub-CPU's date when its
  // status is 0; S-NVRAM sets it whatever the status, so a kept camera starts without the date prompt)
  nvram_clock() {
    const t = this.scpu_memory.seconds() >>> 0;
    this.cpu_store(SCPU_CLOCK, t);
    this.store_log.nvram.clock = t;
  }
  // S-NVRAM's save: the store image goes to its mirror (the NAND write's read-back) and to the host; a posted save
  // calls its callback with the write's result as the flash task does. Only a write of a listed store is modelled.
  _s_nand_write(hle, r, posted) {
    const size = r.d0 >>> 0, dst = r.a1 >>> 0;
    const name = Object.keys(STORE_MIRRORS).find((k) => STORE_MIRRORS[k][0] === dst);
    if (!name || (r.d1 >>> 0) !== NAND_WRITE_OP || size !== STORE_MIRRORS[name][1]) {
      throw new MenuError(`S-NVRAM: NAND write d0 0x${size.toString(16)} d1 0x${(r.d1 >>> 0).toString(16)} to ${h8(dst)} from ${where(r.mdr)}: not a store save`);
    }
    const cb = posted ? this.stack_args(r, 1)[0] : 0;
    const img = this.sim.read(r.a0 >>> 0, size).slice();
    this.sim.write(dst, img);
    const nvram = this.env.nvram, scpu = {};
    nvram.save(name, img);
    for (const off of SCPU_BACKED) scpu[off] = this.sim.u32(SCPU + off);
    nvram.saveScpu(scpu);
    this.store_log.nvram.saves.push({ store: name, from: where(r.mdr), posted });
    if (cb) hle.finish_after(r, disasm(cb), { d0: 0 }); else hle.finish(r, { d0: 0 });
  }
  scpu_registers() {
    const out = {};
    for (const o of [...SCPU_BACKED, ...BOARD.scpu.clock, BOARD.scpu.command]) out['0x' + fx(o, 2)] = this.sim.u32(SCPU + o);
    return out;
  }
  // om1.scpu command lines on stderr (all of it, read whole): [value, pc, count].
  scpu_commands() {
    const out = [];
    for (const line of this.sim.stderrLines()) {
      if (!line.startsWith('om-emu: scpu command ')) continue;
      const m = SCPU_COMMAND.exec(line);
      if (!m) throw new ValueError(`not an scpu command line: ${show(line)}`);
      out.push([Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number(m[3])]);
    }
    return out;
  }
  _k_cflush(hle, r) {
    if (disasm(r.mdr) !== K_CFLUSH_RETURN && !knob('cflush_returns', []).includes(disasm(r.mdr))
      && !(this.env.nvram && disasm(r.mdr) === STORE_SAVE_CFLUSH_RETURN)) throw new MenuError(`K-CFLUSH: 0x5004e68a called from ${where(r.mdr)}; only 0x50040863 (return ${h8(K_CFLUSH_RETURN)}) is listed`);
    const k = disasm(r.mdr);
    this.store_log.cflush.set(k, (this.store_log.cflush.get(k) ?? 0) + 1);
    hle.finish(r);
  }
  _k_crt_134d(hle, r) {
    // (any caller: E143's one call is at 0x5005a6cb, E137's count calls it too)
    this.store_log.crt134d.push(h8(disasm(r.mdr)));
    hle.finish(r, { d0: this.sim.u32(SCPU_CLOCK) });
  }
  _s_flash_save(hle, r) {
    // (a later model's application saves at more places, read by a rule: src/fw/facts.mjs appSaves; E143's lab takes
    // the DB init's only, as before, and the returns a stand-in lists for the path it runs: flash_save_listed, the
    // power-off's settings save, src/lab/power.mjs)
    if (disasm(r.mdr) !== FLASH_SAVE_RETURN && !fact('store.app_saves', []).includes(disasm(r.mdr)) && !this.flash_save_listed?.has(disasm(r.mdr))) {
      throw new MenuError(`S-FLASHSAVE: 0x503eee94 called from ${where(r.mdr)}; only the DB init's last call (return 0x503c5537) is listed: the flash controller is not modelled`);
    }
    this.store_log.flash_save.push(h8(disasm(r.mdr)));
    hle.finish(r, { d0: r.d0 });
  }
  // The firmware's own descriptor lookup 0x503da999 (after the DB init built the hash).
  descriptor(sid) {
    const a = this.call(DESC_LOOKUP, { d0: sid }, null, null, 1000).a0;
    if (!a) return null;
    const [sid_, key, allowed, values, nbytes, elem, , dtype] = unpack('<HHIIHHBB', this.sim.read(a, 18));
    const c = this.call(CUSTOM_LOOKUP, { d0: sid }, null, [0, 0], 1000).a0;
    const keyFn = c && this.sim.u32(c + 20) ? disasm(this.sim.u32(c + 20)) : 0;
    let keys = null;
    if (elem === 1 || elem === 2) {
      const raw = nbytes ? this.sim.read(allowed, nbytes) : new Uint8Array(0);
      keys = elem === 1 ? Array.from(raw) : unpack(`<${nbytes >> 1}H`, raw);
    }
    return { address: a, id: sid_, key, key_fn: keyFn, type: dtype, keys, values };
  }
  scalar_keys(sid, what) {
    const d = this.descriptor(sid);
    if (d === null || d.type === 6 || d.keys === null || d.values) throw new MenuError(`${what} ${sid}: descriptor ${show(d)}: not a scalar id with an allowed list`);
    if (d.key_fn) {
      const prop = KEY_SELECTORS.get(d.key_fn) ?? null;
      throw new MenuError(`${what} ${sid}: key selector ${h8(d.key_fn)} (property ${show(prop)}) picks the descriptor record by its +2 key (0x503da9a2): the allowed list depends on that key, not modelled`);
    }
    return d.keys;
  }
  get(sid) { return this.call(GETTER, { d0: sid }, null, null, 20000).d0; }
  // S-PERSIST: raw property write 0x503ee412(id, value) before the GUI exists.
  persist(sid, value, why) {
    if (this.phase !== 'store' && this.phase !== 'persist') throw new MenuError(`S-PERSIST ${sid}=${value} in phase ${this.phase}: only before GUI creation`);
    if (!this.persist_ids.has(sid) && why !== 'seed') throw new MenuError(`S-PERSIST ${sid}: not a listed input id`);
    const keys = sid === T.LANG_SETTING ? [...this.langs.values()].map((e) => e.setting).sort((a, b) => a - b) : this.scalar_keys(sid, 'S-PERSIST');
    if (!keys.includes(value)) throw new MenuError(`S-PERSIST ${sid}=${value}: not in the allowed list ${show(keys)}`);
    const before = this.get(sid);
    this.call(PROP_SET, { d0: sid, d1: value }, null, null, 20000);
    const after = this.get(sid);
    this.store_log.persist.push({ id: sid, value, why, before, after });
    if (after !== value) throw new MenuError(`S-PERSIST ${sid}=${value}: the getter reads ${after}`);
  }
  persist_inputs() {
    this.phase = 'persist';
    if (this.get(T.LANG_SETTING) !== this.setting) this.persist(T.LANG_SETTING, this.setting, `language ${this.lang}`);
    for (const [sid, value] of this.inputs) this.persist(sid, value, 'input');
    for (const [sid, value] of this.seed) this.persist(sid, value, 'seed');
  }
  // The dial init, natively: DIAL_INIT clears the dial slots (and on E143 selects the table). Where the select is
  // another function, E139's encoder init (src/fw/facts.mjs dialSelect), that function runs through its pointer store
  // and returns there: the rest drives the encoder's registers, and no E143 session runs E143's encoder init (X, a
  // passthrough hook on it never fired through a tft start).
  // A build whose dial init takes one fixed table (MODELS dial table_ptr null, with the table as table0: E118, E120)
  // runs DIAL_INIT alone; there is no pointer to read back.
  dial_init() {
    const board = this.sim.read(DIAL_BOARD, 1)[0], sel = dialSelect();
    if (sel.table_ptr === null) {
      this.call(DIAL_INIT, null, null, null, 1000);
      this.store_log.dial = { board, table: h8(sel.table0) };
      return;
    }
    if (sel.table_ptr !== DIAL_TABLE_PTR) throw new MenuError(`dial-table init: the select stores ${h8(sel.table_ptr)}, the map's pointer is ${h8(DIAL_TABLE_PTR)}`);
    this.call(DIAL_INIT, null, null, null, 1000);
    if (sel.select !== DIAL_INIT) {
      const end = sel.select + sel.select_end, frame = this.frame(sel.select);
      this.hook(end, (h, r) => { this.hooks.delete(runtime(end)); h.return_here(r, frame); }, 'dial-table select end');
      this.call(sel.select, null, null, frame, 1000);
    }
    const table = this.sim.u32(DIAL_TABLE_PTR);
    this.store_log.dial = { board, table: h8(table) };
    // the board byte is 0 but where the lab's start decodes the board's strap pins (sel.board, MODELS dial)
    if (board !== (sel.board ?? 0) || table !== sel.table0) throw new MenuError(`dial-table init: board byte ${board}, table ${h8(table)} (expected ${sel.board ?? 0}, ${h8(sel.table0)})`);
  }
  // ---- the menu
  // EVENT: sendEvent(0x87) from the lab task, then settle; the GUI must reach 0x0b02.
  open_menu() {
    this.harvest();
    this.phase = 'menu';
    this.menu_first = this.exec_history.length;
    this.menu_draw_first = this.draw_log.length;
    const msg = this.alloc(pack('<8I', MENU_EVENT, 0, 0, 0, 0, 0, 0, 0), 4);
    this.calls(SEND_EVENT, { a0: 0, a1: msg }, undefined, undefined, 20000);
    this.menu_settle = this.settle('menu paint');
    this.harvest();
    if (this.exec_lost) throw new MenuError(`${this.exec_lost} engine commands fell out of the execution-log ring between harvests`);
    if (this.state() !== STATE_MENU) throw new MenuError(`menu event: GUI state ${this.state_name(this.state())}, not 0x0b02 SS_MENU/ID_ST_MENU`);
    this.check_engine(this.exec_history.slice(this.menu_first), 'menu paint');
    return this.message_for(MENU_EVENT);
  }
  state() {
    const gc = this.sim.u32(GUICALLER);
    return gc ? (this.sim.read(gc, 1)[0] << 8 | this.sim.read(gc + 1, 1)[0]) : 0;
  }
  state_name(s) { return `${h4(s)} ` + (this.state_names.get(s) ?? '?'); }
  message_for(index) { return u16i(this.image, EV_MAP + 8 * index + 4); }
  // ---- settings reads
  // The settings read behind API vtable +12: with the native store every read runs the firmware getter; with the empty
  // store (S-STORE) inputs and seeds are answered here, every other read runs the getter on the empty store.
  _s_set(hle, r) {
    const sid = r.d0 & 0xFFFF;
    if (this.store === 'native') return this._native_read(sid, r);
    if (sid === T.LANG_SETTING || this.inputs.has(sid)) {
      const value = sid === T.LANG_SETTING ? this.setting : this.inputs.get(sid);
      this.setting_reads.push(sid);
      this.settings_log.push([sid, value, 'input', where(r.mdr)]);
      hle.finish(r, { d0: value });
      return;
    }
    if (this.seed.has(sid)) {
      this.settings_log.push([sid, this.seed.get(sid), 'seed', where(r.mdr)]);
      hle.finish(r, { d0: this.seed.get(sid) });
      return;
    }
    this._native_read(sid, r);
  }
  _native_read(sid, r) {
    this.settings_log.push([sid, null, 'native', where(r.mdr)]);
    const ra = r.mdr;
    if (!this.value_sites.has(ra)) {
      if (this.hooks.has(ra)) throw new MenuError(`S-STORE read ${sid} returns to ${where(ra)}, which is already hooked: value not observable`);
      this.value_sites.set(ra, []);
      this.hook_rt(ra, (h, r2) => this._on_setting_value(h, r2), 'obs-setting-value');
    }
    this.value_sites.get(ra).push(this.settings_log.length - 1);
    this.passthrough(r);
  }
  // One-shot observer at a native read's return address: d0 is the value of the latest pending read returning there.
  _on_setting_value(hle, r) {
    const pending = this.value_sites.get(r.pc);
    const i = pending.pop();
    const [sid, , kind, caller] = this.settings_log[i];
    this.settings_log[i] = [sid, r.d0, kind, caller];
    if (!pending.length) { this.value_sites.delete(r.pc); this.hooks.delete(r.pc); }
    this.passthrough(r);
  }
  _prop(hle, r) {
    const pid = r.d0 & 0xFFFF;
    if (this.props.has(pid) && this.in_display_run()) {
      this.prop_reads.set(pid, (this.prop_reads.get(pid) ?? 0) + 1);
      hle.finish(r, { d0: this.props.get(pid) });
      return;
    }
    if (pid === this.prop_device) {
      const site = disasm(r.mdr);
      if (!this.prop_sites.includes(site)) {
        throw new MenuError(`property ${pid} read from ${where(r.mdr)} outside the display stack: not an S-PROP site ${show(this.prop_sites.map(hex))}`);
      }
      this.gui_props.add([pid, h8(site)]);
      hle.finish(r, { d0: this.props.get(pid) });
      return;
    }
    this.settings_log.push([pid, null, 'prop-native', where(r.mdr)]);
    this.passthrough(r);
  }
  _sync_send(hle, r) {
    const q = r.d0 & 0xFFFF, cmd = r.d1, site = disasm(r.mdr);
    if (q === this._queue(D.DISPLAY_QUEUE)) return super._sync_send(hle, r);
    for (const [qa, c, ra] of DROPPED_SENDS) {
      if (q === this._queue(qa) && cmd === c && site === ra) {
        this.kernel.events.push(['send', `queue ${q} cmd ${cmd}`, `param 0x${r.a0.toString(16)}`, where(r.mdr)]);
        this.dropped_sends.push([q, cmd, h8(site)]);
        hle.finish(r, { d0: 0 });
        return;
      }
    }
    throw new MenuError(`synchronous send to queue ${q} cmd ${cmd} (param 0x${r.a0.toString(16)}) from ${where(r.mdr)}: not a DISPLAY message and not an S-SEND drop; its receiver does not run in the lab`);
  }
  _s_res(hle, r) {
    if (RES_BITMAPS_CALLERS.map(runtime).includes(r.mdr)) {
      const bitmaps = R.layout(this.block).images[1];
      if ((r.d0 & 0xFFFF) !== bitmaps || (r.d1 & 0xFFFF) !== 1) throw new MenuError(`S-RES from ${where(r.mdr)}: (${r.d0 & 0xFFFF}, ${r.d1 & 0xFFFF})`);
      this.loaded.push([bitmaps, 1]);
      hle.finish_calls(r, { d0: R.BLOB_LOADS[1] });
      return;
    }
    if (this.store === 'native' && !['init', 'display', 'bring-up', 'b2', 'store', 'persist'].includes(this.phase)) this._follow_language(r);
    super._s_res(hle, r);
  }
  // A language change made in the GUI: the session language follows the latest native read of 3009.
  _follow_language(r) {
    const record = r.d0 & 0xFFFF, kind = r.d1 & 0xFFFF;
    if (kind !== 0 && kind !== 2) return;
    const reads = this.settings_log.filter(([sid, v, k]) => sid === T.LANG_SETTING && k === 'native' && v !== null).map(([, v]) => v);
    if (!reads.length) return;
    let lang = null;
    for (const [n, e] of this.langs) if (e.setting === reads[reads.length - 1]) { lang = n; break; }
    if (lang === null || lang === this.lang) return;
    const entry = this.langs.get(lang);
    if (record !== (kind === 0 ? entry.font_record : entry.strings_record)) return;
    this.language_changes.push([this.lang, lang, record, kind, where(r.mdr)]);
    this.lang = lang;
    this.setting = entry.setting;
  }
  // The generic GUI logger 0x5124b173: record the format string and return; gpifont's call keeps text.mjs's S-LOG
  // record.
  _s_log(hle, r) {
    let text, a1;
    try {
      const call = this.sim.read(r.mdr - 7, 7);
      const size = call[0] === 0xDD ? call[6] : this.sim.read(r.mdr - 5, 5)[4];
      let fmt;
      [fmt, a1] = unpack('<II', this.sim.read(r.sp + size + 4, 8));
      text = latin1(cstrBytes(this.sim.read(fmt, 100)));
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      text = '?'; a1 = 0;
    }
    try {
      const b = this.sim.read(a1, 10);
      if (b.every((x, i) => x === GPIFONT_FILE[i])) return super._s_log(hle, r);
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
    }
    this.gui_log.push([text, where(r.mdr)]);
    hle.finish(r);
  }
  _s_rpc(hle, r) {
    const req = r.a1;
    const vt = req ? this.sim.u32(req) : 0;
    this.rpc_log.push({ entry: h8(disasm(r.pc)), request: h8(req), vtable: h8(vt), caller: where(r.mdr),
      origin: this.markers.length ? this.markers[this.markers.length - 1] : null });
    if (RPC_ENTRIES.some(([e]) => e === disasm(r.pc))) this.finish_calls(r, { d0: 0 });
    else this.finish(r, { d0: 0 });
  }
  // ---- observers
  install_observers() {
    for (const [label, [site, ret]] of RPC_ORIGINS) {
      if (isUnmapped(site) || isUnmapped(ret)) continue;      // a diagnostic marker a ported model may not have
      this.observe(site, (lab) => lab.markers.push(label), `obs-${label}`);
      this.observe(ret, (lab) => lab._pop_marker(label), `obs-${label}-return`);
    }
    const onSet = (lab, r) => { const w = unpack('<7I', lab.sim.read(r.sp + 28, 28)); lab.events.push(['set', h4(w[0])]); };
    const onTake = (lab, r) => {
      const w = unpack('<7I', lab.sim.read(r.sp + 396, 28));
      lab.events.push(['take', h4(w[0])]);
      lab.draw_log.push({ op: 'message', id: w[0] });
    };
    const [from, to] = stateLogRegs();
    const onState = (lab, r) => lab.events.push(['state', h4(r.d0), lab.state_name(r[from]), lab.state_name(r[to])]);
    this.observe(SET_EVENT, onSet, 'obs-GESetEvent');
    this.observe(DISPATCH, onTake, 'obs-dispatch');
    this.observe(STATE_LOG, onState, 'obs-state');
    const rect = (lab, r) => {
      const [h, colour, layer] = lab.stack_args(r, 3);
      lab.draw_log.push({ op: 'rect', x: s16(r.d0), y: s16(r.d1), w: s16(r.a1), h: s16(h), colour, layer: layer & 0xFFFF, record: r.a0 });
    };
    const bitmap = (lab, r) => {
      const [w, h, , table, layer] = lab.stack_args(r, 5);
      const header = lab.sim.read(r.a1, 4);
      const [width, lines, fmt] = F.bitmap_header(header);
      const lut = table ? lab.sim.read(table, fmt === 0x02 || fmt === 0x0A ? 16 : 256) : null;
      lab.draw_log.push({ op: 'bitmap', x: s16(r.d0), y: s16(r.d1), record: r.a0, data: r.a1, width, lines, fmt, scale: [w, h], lut, layer: layer & 0xFFFF });
    };
    const char = (lab, r) => lab.draw_log.push({ op: 'char', x: s16(r.d0), y: s16(r.d1) });
    const copy = (lab, r) => {
      const args = lab.stack_args(r, 5);
      lab.draw_log.push({ op: 'copy', x: s16(r.d0), y: s16(r.d1), src: r.a0, dst: r.a1, args: args.map(s16) });
    };
    const text = (lab, r) => {
      const style = lab.sim.read(r.d0, 24);
      const [colour, s4, s8, ha, va] = unpackFrom('<IIIBB', style);
      const margins = unpackFrom('<4H', style, 14);
      const box = unpack('<4h', lab.sim.read(r.a1, 8));
      let t;
      try { t = lab.read_utf16(r.d1, 400); } catch (e) { if (!(e instanceof FirmwareError)) throw e; t = null; }
      const gc = r.a0;
      lab.draw_log.push({ op: 'text', text: t, colour, style4: s4, style8: s8, align: [ha, va], margins, edge: style[22], box,
        draw_offset: unpack('<2h', lab.sim.read(T.DRAW_OFFSET, 4)), gc, gc_id: lab.sim.u32(gc),
        origin: unpack('<2h', lab.sim.read(gc + 12, 4)), clip: unpack('<4h', lab.sim.read(gc + 24, 8)),
        device: lab.sim.u32(gc + 72), mode684: lab.sim.read(gc + 684, 1)[0], attr_gc: lab.attr_gc(gc) });
    };
    const setpal = (lab, r) => {
      const lb = lab.sim.read(lab.sim.u32(r.a0 + 72), 2), layer = lb[0] | lb[1] << 8;
      const n = r.d1 & 0xFFFF;
      const raw = n ? lab.sim.read(r.a1, 4 * n) : new Uint8Array(0);
      lab.draw_log.push({ op: 'GPISetPalette', layer, start: r.d0 & 0xFFFF, count: n, sha: lab.env.createHash('sha256').update(raw).digest('hex').slice(0, 16) });
    };
    const palkind = (lab, r) => lab.draw_log.push({ op: 'palette kind', kind: r.d0 });
    const palpend = (lab, r) => {
      const colours = unpack('<256I', lab.sim.read(r.a0, 1024));
      lab.draw_log.push({ op: 'palette pending', layer: r.d0 & 0xFFFF, palette: lab.palette_id(colours) });
    };
    const upd = (lab, r) => lab.draw_log.push({ op: 'gpiUpdateDisplay', d0: r.d0, caller: disasm(r.mdr) });
    const ex = (name) => (lab) => {
      if (name === 'exec_start') lab.harvest();
      lab.draw_log.push({ op: name, seq: lab.exec_history.length });
    };
    for (const [addr, fn, nm] of [[GPI_DRAW_RECT, rect, 'rect'], [GPI_DRAW_BITMAP, bitmap, 'bitmap'], [GPI_DRAW_CHAR, char, 'char'],
      [GPI_DRAW_COPY, copy, 'copy'], [DRAW_TEXT, text, 'text'], [GPI_SET_PALETTE, setpal, 'GPISetPalette'],
      [SET_PALETTE_KIND, palkind, 'palette kind'], [PALETTE_PENDING, palpend, 'palette pending'], [GPI_UPDATE, upd, 'gpiUpdateDisplay'],
      [EXEC_START, ex('exec_start'), 'exec_start'], [EXEC_END, ex('exec_end'), 'exec_end']]) {
      this.observe(addr, fn, 'obs-' + nm);
    }
  }
  _pop_marker(label) {
    if (!this.markers.length || this.markers[this.markers.length - 1] !== label) throw new MenuError(`call-site marker ${label}: stack ${show(this.markers)}`);
    this.markers.pop();
  }
  // Move the engine's execution log into exec_history and clear it.
  harvest() {
    const total = this.engine.exec_total();
    this.key_hits += this.engine.key_hits();
    if (!total) { this.engine.clear(); return; }
    const log = T.execEntries(this.engine, F.decode_command);
    this.exec_lost += Math.max(0, total - EXEC_SLOTS);
    const base = this.exec_history.length;
    for (const e of log) this.exec_history.push({ ...e, seq: base + e.seq });
    this.engine.clear();
  }
  // ---- results
  menu_draws() { return this.draw_log.slice(this.menu_draw_first); }
  menu_commands() { return this.exec_history.slice(this.menu_first); }
  // GUI palette ids (1..130) whose colours equal these.
  palette_id(colours) {
    const out = [];
    for (let pid = 1; pid < 131; pid++) {
      let pal;
      try { pal = F.gui_palette(this.image, pid); } catch (e) { if (!(e instanceof ValueError)) throw e; continue; }
      if (pal.length < colours.length) continue;
      let same = true;
      for (let i = 0; same && i < colours.length; i++) if (pal[i] !== colours[i]) same = false;
      if (same) out.push(pid);
    }
    return out;
  }
}

// scpu_commands reads stderr whole, so the machine keeps every stderr line of a MenuLab.
MenuLab.KEEP_STDERR = true;

// A seed value is accepted only for a store mode a row of this page reads through the getter (M.store_reads) and only
// if it is a key of that row's decoded value list; anything else raises. seed: Map (or [[mode, value]]); returns a Map.
export function validate_seed(img, pageId, seed) {
  const reads = M.store_reads(img, pageId);
  const out = new Map();
  for (const [mode, value] of seed) {
    if (!Number.isSafeInteger(mode) || !Number.isSafeInteger(value)) throw new ValueError(`seed ${show(mode)} = ${show(value)}: not integers`);
    if (!reads.has(mode)) throw new ValueError(`seed ${mode}: not read through the getter by a row of page 0x${pageId.toString(16)} (readable: ${show([...reads.keys()].sort((a, b) => a - b))})`);
    const rd = reads.get(mode);
    if (!rd.keys.includes(value)) throw new ValueError(`seed ${mode} = ${value}: not a key of row ${rd.row}'s value list ${show(rd.keys)}`);
    out.set(mode, value);
  }
  return out;
}

// Fresh MenuLab: bring-up, menu event, composite. Returns [lab, result]; the caller closes lab. kw: tab, page, cursor,
// lang, device, u1, seed (Map or null), lab_hook, store, evf_layout, a15 (the image is in the
// env).
export function run_session(env, kw = {}) {
  const k = { tab: SETUP_TAB, page: 1, cursor: 1, lang: 'en', device: 'tft', u1: 'refuse', seed: null, lab_hook: null, store: 'native',
    evf_layout: false, a15: false, ...kw };
  const img = new M.Image(env.rom);
  const [pageId, cursorId, inputs] = inputs_for(img, k.tab, k.page, k.cursor);
  const seed = validate_seed(img, pageId, k.seed ?? new Map());
  const t0 = performance.now();
  const lab = new MenuLab(env, { lang: k.lang, inputs, seed, key_mode: k.u1, store: k.store, evf_layout: k.evf_layout });
  try {
    if (k.lab_hook) k.lab_hook(lab);
    if (k.a15) lab.assume('A15', true);
    lab.bring_up(k.device);
    const msg = lab.open_menu();
    const comp = lab.compose(k.device);
    const result = { tab: k.tab, page: k.page, page_id: pageId, cursor: k.cursor, cursor_id: cursorId, lang: k.lang, device: k.device,
      u1: k.u1, seed, inputs, message: msg, comp, evf_layout: k.evf_layout, layout_byte: lab.sim.read(LAYOUT_BYTE, 1)[0],
      takeover: lab.takeover_log, seconds: Math.round((performance.now() - t0) / 100) / 10 };
    return [lab, result];
  } catch (e) {
    try {
      const r = lab.sim.registers();
      if (e && typeof e.addNote === 'function') e.addNote(`pc ${where(r.pc)} mdr ${where(r.mdr)}; GUI state ${lab.state_name(lab.state())}`);
    } catch { /* the note is best effort */ }
    lab.close();
    throw e;
  }
}
