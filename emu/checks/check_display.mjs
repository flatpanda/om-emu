#!/usr/bin/env node
// The display checks: the om1-vsc model, the lab stub and the display harness checked on the JS lab
// (src/lab/display.mjs over the VSC port) against the register formulas and the independent reference compositor of
// refs/display.mjs, group by group, each with its report lines. Every assert is a predicate of checks/lib/pred.mjs
// (check()); an assert that fails raises AssertionError (uncaught: its stack, exit 1). The inputs besides the
// firmware are the fixtures under checks/fixtures/: om1-vsc-tables.c, the class tables of the C VSC model the JS device
// mirrors (group 12a parses them; test_dev vsc-classes pins the JS device to the same parse), om1-vsc-regs.h (group 13,
// whose call-site probes decode the image with the core's instruction lengths) and the pinned notes
// check_display_notes.txt. Output files go to OM_CHECK_OUT (default emu/out/checks/js/manual/); --write-notes writes
// the notes to OM_NOTES_DIR (a test compares them with the pinned fixture) and is refused without it.
//   node emu/checks/check_display.mjs [--seed N] [--kernel native|none]
// Exported for check_text and (part B) check_menu / check_nav: compare, reference, Skip, ERRLOG, errlog_counts,
// check_palettes, note_set, stub_unwritten, OSD_BUFFER_W, drawn_planes, Dram, test_card, ASPECTS, cpu, STORE, LOAD.
import fs from 'node:fs';
import path from 'node:path';
import { REPO, FIXTURES, labEnv, loadImage, runMain, SystemExit } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { newRandom } from './lib/rngtape.mjs';
import { pred, fault } from './lib/pred.mjs';
import * as RES from './lib/resources_scan.mjs';
import { write_outputs, read_png } from './lib/png.mjs';
import { render as renderVscRegs } from './gen_vsc_regs.mjs';
import * as D from '../src/lab/display.mjs';
import { OSD_DEFAULTS } from '../src/lab/osd.mjs';
import { gui_palette } from '../src/lab/osdfmt.mjs';
import { FirmwareError, disasm, runtime, where } from '../src/lab/hle.mjs';
import { AssertionError, LabError, ValueError } from '../src/lab/errors.mjs';
import { reg, regValue } from './lib/errors.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show, asText } from '../src/util/show.mjs';
import { pack, unpack } from '../src/util/bytes.mjs';
import { hex } from '../src/util/hex.mjs';
import * as REF from '../refs/display.mjs';
import { insnLength } from '../src/core/cpu.mjs';

export const { Skip, reference, osd_cols, bt601, REG_MODEL, REG_STORED, FEATURES, PANEL } = REF;
const { CMD_ADVANCE, CMD_CLEAR, CMD_COMPOSE, CMD_RUN_TO_FRAME, DEBUG, DEVICE, DOORBELL, EVF_TIMER_HANDLE, HW_TIMER_SLOTS,
  HW_TIMER_TABLE, TICK_CALLBACK, TIMER_DELETE, TIMER_SLOTS, IMG_BASE, IMG_FIT, IMG_FORMAT, IMG_STRIDE, OUTPUT, PLANES, STUB,
  VSC, VSC_CHANNEL, ASPECTS, DisplayLab, demo_gui, format_vsc_error, test_card, ycc_to_rgb } = D;
export { test_card, ASPECTS };

const SCRATCH = 0xA2030000;
export const STORE = '60', LOAD = '70', STORE_BYTE = 'f0 50';
const OUT = process.env.OM_CHECK_OUT ? path.resolve(process.env.OM_CHECK_OUT) : path.join(REPO, 'emu/out/checks/js/manual');
const NOTES_FILE = path.join(FIXTURES, 'check_display_notes.txt');
// The flows' error logs. Since S-DISPSTART (src/lab/display.mjs) the DISPLAY task's start-up runs in the first DISPLAY
// run only, as the task's entry runs it once before its receive loop (D, src/fw/facts.mjs displayStart); each later run
// had repeated it and logged one more 0x1c005002 from the store getter (0x5004098b): the earlier 22, 22, 37 and 34
// (X: the same flows with the hook off).
export const ERRLOG = { tft: new Map([[0x1C005002, 20], [0x37005208, 1]]), evf: new Map([[0x1C005002, 20]]),
  'tft-to-evf': new Map([[0x1C005002, 32], [0x37005208, 1]]), 'evf-to-tft': new Map([[0x1C005002, 29]]) };
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const hx = (v) => (regValue(v) >>> 0).toString(16);           // f'{v:x}'
const h = (s) => new Uint8Array(Buffer.from(s.replaceAll(' ', ''), 'hex'));
let ENV = null;
const env = () => (ENV ??= labEnv());
const newLab = (opts = {}) => new DisplayLab(env(), opts);
const withLab = (lab, fn) => { try { return fn(lab); } finally { lab.close(); } };
// An assert through the predicate seam: AssertionError with `what` (a value or a thunk) as its text
function check(cond, what = null) {
  if (!pred(!!cond, 2)) { const w = typeof what === 'function' ? what() : what; throw new AssertionError(w === null ? '' : asText(w)); }
}
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const sortStr = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const head3 = (e, a, b, c) => e[0] === a && e[1] === b && e[2] === c;
const wordsEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

// ------------------------------------------------------------------------- reference helpers
export const unwritten_class = REF.unwritten_class;
// The classes as checks/fixtures/om1-vsc-tables.c defines them, by name
export function model_classes(names) {
  return REF.model_classes(names, fs.readFileSync(path.join(FIXTURES, 'om1-vsc-tables.c'), 'utf8'));
}
function class_partition(lab) {
  const names = new Set(lab.vsc.offsets.keys());
  check([...REG_MODEL].every((n) => names.has(n)) && [...REG_STORED].every((n) => names.has(n)) && [...FEATURES.keys()].every((n) => names.has(n)));
  check(![...REG_MODEL].some((n) => REG_STORED.has(n)) && ![...FEATURES.keys()].some((n) => REG_MODEL.has(n) || REG_STORED.has(n)));
  const here = new Map();
  for (const n of names) here.set(n, REG_MODEL.has(n) ? ['MODEL', null] : REG_STORED.has(n) ? ['STORED', null] : FEATURES.has(n) ? ['FEATURES', FEATURES.get(n)] : ['UNWRITTEN', null]);
  const model = model_classes(lab.vsc.names);
  const bad = new Map();
  for (const n of names) if (!pred(JSON.stringify(here.get(n)) === JSON.stringify(model.get(n)))) bad.set(n, [here.get(n), model.get(n)]);
  check(!bad.size, () => `om1-vsc.c classes differ from check_display (here, model): ${show(bad)}`);
  const counts = new Map();
  for (const [c] of here.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

// Cached bus reads (row-sized): bus DRAM 0xA0000000.. through the debugger at the same address; with a lab, any other bus
// address through the firmware's own window (0x50036da4 maps the segment, 0x50036d95 restores it in close()).
export class Dram {
  constructor(sim, lab = null) { this.sim = sim; this.cache = new Map(); this.lab = lab; this.segment = null; }
  fetch(address, n) {
    const key = `${address},${n}`;
    if (!this.cache.has(key)) {
      if (this.lab === null || (address >= 0xA0000000 && address + n <= 0xB8000000)) this.cache.set(key, this.sim.read(address, n));
      else {
        const segment = Math.floor(address / 2 ** 27);
        if (Math.floor((address + n - 1) / 2 ** 27) !== segment) throw new LabError(`bus read 0x${hx(address).padStart(8, '0')}+${n} crosses a 128 MiB segment`);
        if (this.segment !== segment) { this.lab.bus_map(address); this.segment = segment; }
        this.cache.set(key, this.sim.read((0xB8000000 | (address & 0x07FFFFFF)) >>> 0, n));
      }
    }
    return this.cache.get(key);
  }
  get fn() { return (a, n) => this.fetch(a, n); }
  close() { if (this.segment !== null) { this.lab.bus_unmap(); this.segment = null; } }
}

// Model composite == reference composite, word for word. Returns a short summary.
export function compare(lab, device, comp, label, nonvacuous = false, assume = []) {
  const fetch = new Dram(lab.sim, lab);
  try { return _compare(lab, device, comp, label, nonvacuous, assume, fetch); } finally { fetch.close(); }
}
function _compare(lab, device, comp, label, nonvacuous, assume, fetch) {
  const c = DEVICE[device].channel;
  const dump = lab.dump(device);
  const order = lab.vsc.channel(c).order;
  const pal = dump.palette, flags = dump.palette_written;
  const seen = new REF.Recording(dump.mirror);
  const [width, height, ref, drawn, skipped] = reference(c, seen, pal, flags, fetch.fn, order, null, assume);
  const unw = new Set(unwritten_class(seen.keys()));
  const extra = sortStr([...seen.read].filter((n) => dump.mirror.has(n) && !REG_MODEL.has(n) && !FEATURES.has(n) && !unw.has(n)));
  check(!extra.length, () => `${label}: reference read registers outside REG_MODEL: ${show(extra)}`);
  const hd = comp.header;
  check(hd.width === width && hd.height === height, () => [hd, width, height]);
  const modelDrawn = PLANES.filter((p, i) => (hd.drawn >>> i) & 1);
  check(deepEqual(sortStr(modelDrawn), sortStr(drawn)), () => [label, modelDrawn, drawn, skipped]);
  const words = comp.words;
  if (!pred(wordsEq(words, ref))) {
    const first = ref.findIndex((v, i) => words[i] !== v);
    throw new AssertionError(`${label}: model and reference differ at x=${first % width} y=${Math.floor(first / width)}: model 0x${(words[first] >>> 0).toString(16).padStart(6, '0')} reference 0x${ref[first].toString(16).padStart(6, '0')}`);
  }
  let note = '';
  if (nonvacuous) {
    // 1. OSD1 source moved by 16 bytes must change the result.
    const moved = new Map(dump.mirror); moved.set('OSD1DMASADR', reg(dump.mirror, 'OSD1DMASADR') + 1);
    check(!wordsEq(reference(c, moved, pal, flags, fetch.fn, order, null, assume)[2], ref), () => `${label}: OSD1DMASADR+16 changed nothing`);
    // 2. One palette word of OSD1 changed: differences exactly at pixels where OSD1 sampled that index
    const osdcp2 = dump.mirror.get('OSDCP2'), bank = 256 * (0 + (osdcp2 & 1));
    const counts = new Map();
    const base = reg(dump.mirror, 'OSD1DMASADR') * 16;
    for (let row = 0; row < 600; row += 7) for (const b of fetch.fetch(base + row * 1664, 800)) counts.set(b, (counts.get(b) ?? 0) + 1);
    // the indices by count, ties in first-seen order
    const common = [...counts].sort((a, b) => b[1] - a[1]).map(([i]) => i);
    const index = common.find((i) => i > 0 && i < 128 && ((pal[bank + i] >>> 24) & 31));
    const changed = [...pal]; changed[bank + index] = (changed[bank + index] ^ 0x00404040) >>> 0;
    const [, , alt, , , traced] = reference(c, dump.mirror, changed, flags, fetch.fn, order, ['OSD1', index], assume);
    let n = 0, inside = true;
    for (let i = 0; i < ref.length; i++) if (alt[i] !== ref[i]) { n++; if (!traced.has(i)) inside = false; }
    check(n && inside, () => `${label}: palette change at index ${index}: ${n} pixels changed`);
    note = `; non-vacuous (OSD1+16 B differs; palette index ${index}: ${n} px, all at that index)`;
  }
  return `${label}: ${width}x${height} == reference, drawn ${show(drawn)}` + (skipped.size ? `, skipped ${show(skipped)}` : '') + note;
}

// ------------------------------------------------------------------------- firmware flows
// Seeded GUI content with the real gpiDraw* into the three layers (resource bitmaps, rectangles over all alpha levels of
// palettes 62/63/61, one 3 x 2 marker at canvas (700, 300) in GUI layer 1).
function random_gui(lab, rng) {
  const image = lab.image;
  const recs = RES.records().filter((r) => r.width <= 120 && r.lines <= 100);
  const byFmt = new Map([0x0B, 0x0A, 0x02].map((f) => [f, recs.filter((r) => r.fmt === f)]));
  const sample = [...rng.sample(byFmt.get(0x0B), 4), ...rng.sample(byFmt.get(0x0A), 2), ...rng.sample(byFmt.get(0x02), 2)];
  RES.load(lab.sim, RES.blobs(), sample);
  const layers = [[2, 62], [4, 63], [0, 61]];
  for (const [buffer] of layers) lab.clear(buffer);
  lab.draw(() => {
    sample.forEach((r, k) => {
      const buffer = layers[k % 3][0], size = r.fmt === 0x02 || r.fmt === 0x0A ? 16 : 256;
      const lut = [0];
      for (let i = 0; i < size - 1; i++) lut.push(rng.randrange(1, 128));
      lab.bitmap(130 * (k % 4) + 10, 140 * Math.floor(k / 4) + 330, r.address, lut, 1, buffer);
    });
    for (const [buffer, pid] of layers) {
      const colours = gui_palette(image, pid).slice(0, pid !== 61 ? 128 : 32);
      const byAlpha = new Map();
      colours.forEach((colour, i) => { const k = colour >>> 27; if (!byAlpha.has(k)) byAlpha.set(k, []); byAlpha.get(k).push(i); });
      for (const tra of sortNum(byAlpha.keys())) {
        const x = rng.randrange(0, 560), y = rng.randrange(0, 280);
        lab.rectangle(x, y, rng.randrange(8, 600 - x), rng.randrange(8, 300 - y + 1), rng.choice(byAlpha.get(tra)), 1, buffer);
      }
    }
    lab.rectangle(700, 300, 3, 2, 13, 1, 4);
  });
  return sample.length;
}

// Firmware-written registers against the spec formulas and the device-table inputs.
function check_registers(lab, device, attached) {
  const c = DEVICE[device].channel, w = lab.vsc.bank(c);
  const sources = { OSD1: lab.surfaces[2].base, OSD2: lab.surfaces[4].base, OSD3: lab.surfaces[0].base };
  const want = REF.registers_want(device, c, sources, attached, IMG_BASE);
  const bad = new Map();
  for (const [k, v] of want) if (!pred(w.get(k) === v)) bad.set(k, [w.get(k) === null ? null : hex(w.get(k)), v === null ? null : hex(v)]);
  check(!bad.size, () => `${device}: register (written, expected): ${show(bad)}`);
  return want.size;
}

// Displayed palette banks == the firmware formula on the osddraw arrays the upload reads and those arrays == GUI
// palettes pids (128 entries for sel 0/1, 64 for sel 2).
export function check_palettes(lab, device, pids = [62, 63, 61]) {
  const c = DEVICE[device].channel;
  const [pal, flags] = lab.vsc.palette(c);
  const osdcp2 = lab.vsc.bank(c, true).get('OSDCP2');
  const arrays = [[0, 0x62B26DE1, pids[0], 128], [1, 0x62B265E1, pids[1], 128], [2, 0x62B275E1, pids[2], 64]];
  let count = 0;
  for (const [sel, address, pid, n] of arrays) {
    const raw = lab.sim.read(address, 4 * 128), gui = gui_palette(lab.image, pid);
    const bank = 256 * (2 * sel + ((regValue(osdcp2, 'OSDCP2') >>> (4 * sel)) & 1));
    for (let i = 0; i < 128; i++) {
      const [r, g, b, tra] = raw.subarray(4 * i, 4 * i + 4);
      const word = REF.palette_word(r, g, b, tra), k = bank + i;
      check(flags[k] && pal[k] === word, () => [device, sel, i, hex(pal[k]), hex(word)]);
      if (i < n) check(deepEqual([r, g, b, tra], REF.gui_entry(gui[i])), () => [pid, i]);
      count += 1;
    }
    check(!flags.subarray(bank + 128, bank + 256).some((x) => x), 'entries >= 128 written');
  }
  return count;
}

export function errlog_counts(lab) {
  const out = new Map();
  for (const s of lab.steps) for (const [code] of s.errlog) { const k = parseInt(code, 16); out.set(k, (out.get(k) ?? 0) + 1); }
  return out;
}
// The session's notes as a list of unique [kind, channel, name] (its order never reaches output: every user sorts
// it)
export function note_set(lab) {
  const names = lab.vsc.names, out = new Map();
  for (const n of lab.notes) {
    const name = n.channel < 3 ? names.get(n.offset - (n.kind === 'MIRROR_RESET_READ' ? 0x2000 : 0)) : lab.vsc.out_names.get(n.offset) ?? `+0x${n.offset.toString(16)}`;
    const t = [n.kind, n.channel, name || `+0x${n.offset.toString(16)}`];
    out.set(JSON.stringify(t), t);
  }
  return [...out.values()];
}
export function stub_unwritten(lab) {
  const s = new Set();
  for (const step of lab.steps) for (const x of step.stub) if (x.unwritten) s.add(x.addr);
  return sortNum(s);
}

// Display switch (group 6)
const SWITCH_STATE_RETURN = 0x501C73AD, LEVEL_STEP = 0x501C67AA, LEVEL_APPLY = 0x501C69E5;
const SWITCH_INDEX_OFFSET = REF.SWITCH_INDEX_OFFSET, TIMER_ERRLOG = 0x19001807;
// Kernel-less observer: fn(regs) records, then the instruction runs (one step).
export function observe(lab, address, fn) {
  lab.hook(address, (hle, r) => { fn(r); lab.sim.run([], true); }, `obs 0x${hx(address).padStart(8, '0')}`);
}
const level_table = REF.level_table, switch_planc = REF.switch_planc;

// One fresh session: start, OPEN device, palettes, GUI, update, IMG attach, composite; then optionally the switch.
// Returns [lab, record].
export function flow(device, seed, { switch_to = null, gui = 'random', out = OUT, timer_init = true } = {}) {
  const lab = newLab({ timer_init });
  const obs = new Map(['p587', 'level_step', 'level_apply', 'timer_delete'].map((k) => [k, []]));
  const push = (k, v) => obs.get(k).push(v);
  observe(lab, SWITCH_STATE_RETURN, (r) => push('p587', r.d0));
  observe(lab, LEVEL_STEP, (r) => push('level_step', [r.d0 & 0xFF, disasm(r.mdr)]));
  observe(lab, LEVEL_APPLY, (r) => push('level_apply', r.d0 & 0xFF));
  observe(lab, TIMER_DELETE, (r) => push('timer_delete', [r.d0 & 0xFFFF, r.d1 & 0xFFFF]));
  try {
    const rng = newRandom(seed);
    lab.start();
    const record = { device, obs, timer_after_init: lab.timer_slots(), hw_timer_after_init: lab.timer_slots(HW_TIMER_TABLE, HW_TIMER_SLOTS), timer_log: lab.timer_log };
    lab.set_gui_buffers();
    lab.open(device);
    record.handle_after_open = unpack('<H', lab.sim.read(EVF_TIMER_HANDLE, 2))[0];
    lab.palettes();
    if (gui === 'random') random_gui(lab, rng); else demo_gui(lab);
    lab.update();
    record.regs_before = check_registers(lab, device, false);
    record.m_equals_w = mirror_equals_written(lab, DEVICE[device].channel);
    lab.load_img(test_card());
    lab.attach_img(device, ASPECTS.get('3,2'));
    const comp = lab.compose(device);
    check(comp.status === 'NONE' && !comp.errors.length && !comp.error_total, () => [device, comp.status, comp.error_total, comp.errors.map(format_vsc_error)]);
    record.regs_after = check_registers(lab, device, true);
    record.palette = check_palettes(lab, device);
    record.errlog = errlog_counts(lab);
    record.comp = comp;
    record.compare = compare(lab, device, comp, device, true);
    write_outputs(lab, device, device, comp, lab.dump(device), out);
    if (switch_to) {
      const nObs = new Map([...obs].map(([k, v]) => [k, v.length]));
      lab.open(switch_to);
      record.switch_obs = new Map([...obs].map(([k, v]) => [k, v.slice(nObs.get(k) ?? 0)]));
      record.timer_after_switch = lab.timer_slots();
      const [pal, flags] = lab.vsc.palette(DEVICE[switch_to].channel);
      const written = pal.filter((_, i) => flags[i]);
      record.zero_palettes = [written.length, written.filter((wd) => wd === 0).length];
      record.resend = lab.resend_palettes(switch_to);
      lab.update();
      lab.attach_img(switch_to, ASPECTS.get('3,2'));
      const comp2 = lab.compose(switch_to);
      const name = `${device}-to-${switch_to}`;
      record.switch = comp2;
      record.switch_compare = compare(lab, switch_to, comp2, name);
      record.switch_errlog = errlog_counts(lab);
      record.switch_palette = check_palettes(lab, switch_to);
      record.switch_planc = new Map([1, 2, 3].map((n) => [n, lab.vsc.bank(DEVICE[switch_to].channel).get(`OSD${n}PLANC`)]));
      write_outputs(lab, name, switch_to, comp2, lab.dump(switch_to), out);
    }
    record.notes = note_set(lab); record.stub_unwritten = stub_unwritten(lab); record.time = lab.vsc.time();
    record.waits = new Map(lab.vsync_waits); record.frames = new Map(lab.vsync_frames);
    record.delivered = new Map();
    for (const irq of lab.kernel.delivered) record.delivered.set(irq, (record.delivered.get(irq) ?? 0) + 1);
    record.chgwait = [...lab.chgwait];
    record.banks = new Map([1, 2].map((c) => [c, [lab.vsc.bank(c), lab.vsc.bank(c, true)]]));
    record.written = new Set();
    for (const c of [1, 2]) for (const [n, v] of record.banks.get(c)[0]) if (v !== null) record.written.add(n);
    return [lab, record];
  } catch (e) {
    lab.close();
    throw e;
  }
}

// Group 6d: without the boot step 0x50058959 the EVF open's timer handle is 0x0100 and the TFT open's delete logs
// 0x19001807 (4, 1255, 0x0100) at 0x5005920a; the OPEN step stops on it.
function timer_negative_control() {
  return withLab(newLab({ timer_init: false }), (lab) => {
    lab.start();
    lab.set_gui_buffers();
    lab.open('evf');
    const handle = unpack('<H', lab.sim.read(EVF_TIMER_HANDLE, 2))[0];
    const err0 = lab.kernel.errors.length;
    let text;
    try {
      lab.open('tft');
      throw new AssertionError('EVF -> TFT without the software-timer init completed');
    } catch (e) {
      if (!(e instanceof FirmwareError)) throw e;
      text = e.message;
    }
    const logged = lab.kernel.errors.slice(err0).filter(([code]) => code === TIMER_ERRLOG).map(([code, , args, caller]) => [code, args.slice(0, 3), caller]);
    check(text.includes(h8(TIMER_ERRLOG)), text);
    check(deepEqual(logged, [[TIMER_ERRLOG, [4, 1255, 0x0100], where(runtime(0x5005920A))]]) && handle === 0x0100, () => [logged, hex(handle)]);
    return [handle, logged];
  });
}
function mirror_equals_written(lab, c) {
  const w = lab.vsc.bank(c), m = lab.vsc.bank(c, true);
  const diff = new Map();
  for (const [k, v] of m) if (!pred(w.get(k) === v)) diff.set(k, [w.get(k), v]);
  check(!diff.size, () => `mirror differs from the written bank after the update: ${show(diff)}`);
  return m.size;
}

// ------------------------------------------------------------------------- groups
function environment(lab) {
  let n = 0;
  check(lab.sim.u32(DEBUG) === 0x4D435356 && lab.sim.u32(STUB) === 0x42555453);
  n += 1;
  const header = fs.readFileSync(path.join(FIXTURES, 'om1-vsc-regs.h'), 'utf8');
  check(header === renderVscRegs(loadImage()), 'om1-vsc-regs.h differs from the image name tables');
  n += 1;
  const live = lab.check_img_region();
  const banks = new Set(live.map((b) => b.bank));
  check([0x0A, 0x0E, 0x18].every((b) => banks.has(b)) && live.every((b) => !((b.base >= 0xA0000000 && b.base < 0xB8000000) || (b.base >= 0x60000000 && b.base < 0x78000000))), () => live);
  n += 1;
  return n;
}
export function cpu(lab, code, address, value = 0) {
  lab.sim.write(SCRATCH, h(code));
  lab.sim.reset({ pc: SCRATCH, a0: address, d0: value });
  return lab.sim.run([], true);
}
function expect(lab, names) {
  const [total, errors] = lab.vsc.errors();
  const got = errors.map((e) => e.name);
  check(deepEqual(got, names) && total === names.length, () => [got, names]);
  lab.doorbell(CMD_CLEAR);
}
// om1-vsc driven by guest stores and loads on channel 0 (unused by the TFT/EVF flows).
function register_level(lab) {
  let n = 0;
  const ch0 = VSC_CHANNEL[0], line = 1000;
  lab.stub_log();
  lab.sim.write(STUB + 0x100, new Uint8Array(12 * 32));
  lab.sim.write(STUB + 0x400, new Uint8Array(16 * 128));
  check(cpu(lab, STORE, 0x9A900474, 1).fault === 2);
  let log = lab.stub_log();
  check(deepEqual(log.map((s) => [s.addr, s.denied, s.write]), [[0x9A900474, true, true]]), () => log);
  try {
    lab.sim.read(0x9A900474, 4);
    throw new AssertionError('debugger read outside the allow table succeeded');
  } catch (e) {
    if (e?.name !== 'RuntimeError') throw e;
    check(e.message.endsWith('E14'), e.message);
  }
  n += 1;
  lab.install_stub();
  if (fault('display-stub-preset')) lab.sim.write(STUB + 0x400 + 4, pack('<I', 0x16));   // JS-only fault point (pred.mjs)
  check(cpu(lab, LOAD, 0x9A900474).d0 === 0x15);
  cpu(lab, STORE, 0x9A900010, 0x1234);
  check(cpu(lab, LOAD, 0x9A900010).d0 === 0x1234 && cpu(lab, LOAD, 0x9A900020).d0 === 0);
  log = lab.stub_log();
  check(deepEqual(log.map((s) => [s.preset, s.write, s.unwritten]), [[true, false, false], [false, true, false], [false, false, false], [false, false, true]]), () => log);
  n += 1;
  check(cpu(lab, STORE_BYTE, ch0 + 0x60, 1).fault === 2); expect(lab, ['WIDTH']);
  check(cpu(lab, STORE, ch0 + 0x24, 1).fault === 2); expect(lab, ['REG_UNKNOWN']);
  check(cpu(lab, LOAD, ch0 + 0x7000).fault === 2); expect(lab, ['REG_UNKNOWN']);
  check(cpu(lab, STORE, ch0 + 0x2060, 1).fault === 2); expect(lab, ['MIRROR_WRITE']);
  check(cpu(lab, LOAD, ch0 + 0x2010).fault === 2); expect(lab, ['MIRROR_LIVE']);
  check(cpu(lab, STORE, ch0 + 0xE80, 1).fault === 2); expect(lab, ['RO_WRITE']);
  check(cpu(lab, STORE, DEBUG + 0x40, 1).fault === 2); expect(lab, ['DEBUG_CPU_WRITE']);
  n += 7;
  const notes0 = lab.vsc.notes()[0];
  check(cpu(lab, LOAD, ch0 + 0x63C).d0 === 0 && cpu(lab, LOAD, ch0 + 0x63C).d0 === 0);
  const [total, notes] = lab.vsc.notes();
  check(total === notes0 + 1 && notes.at(-1).kind === 'RESET_READ' && notes.at(-1).offset === 0x63C);
  n += 1;
  check(cpu(lab, STORE, DOORBELL, 9).fault === 2); expect(lab, ['DOORBELL']);
  check(cpu(lab, STORE, DOORBELL, CMD_COMPOSE | 3 << 8).fault === 2); expect(lab, ['DOORBELL']);
  check(cpu(lab, LOAD, DOORBELL).fault === 2); expect(lab, ['DOORBELL']);
  check(lab.doorbell(CMD_RUN_TO_FRAME, 0)); expect(lab, ['NOT_RUNNING']);
  n += 4;
  lab.doorbell(CMD_COMPOSE, 0); expect(lab, ['NOT_LATCHED']);
  n += 1;
  lab.vsc.set_line_ns(0, line);
  cpu(lab, STORE, ch0 + 0x0C, 0);
  cpu(lab, STORE, ch0 + 0x60, 0x15);
  check(cpu(lab, LOAD, ch0 + 0xE80).d0 === 0);
  cpu(lab, STORE, ch0 + 0x728, 100);
  const state = lab.vsc.channel(0);
  check(state.running && state.frame_start === lab.vsc.time());
  lab.doorbell(CMD_ADVANCE, 0, 37 * line + 5);
  check(cpu(lab, LOAD, ch0 + 0xE80).d0 === (0x10000 | 37));
  check(lab.sim.u32(ch0 + 0x2060) === 0 && cpu(lab, LOAD, ch0 + 0x10).d0 === 0);
  n += 1;
  lab.doorbell(CMD_ADVANCE, 0, 63 * line);
  check(cpu(lab, LOAD, ch0 + 0x2060).d0 === 0x15 && cpu(lab, LOAD, ch0 + 0xE80).d0 === (0x10000 | 0));
  check(cpu(lab, LOAD, ch0 + 0x10).d0 === 1 && lab.vsc.irq_line(0) === 0);
  cpu(lab, STORE, ch0 + 0x0C, 1);
  check(lab.vsc.irq_line(0) === 1);
  cpu(lab, STORE, ch0 + 0x10, 2);
  check(cpu(lab, LOAD, ch0 + 0x10).d0 === 1);
  cpu(lab, STORE, ch0 + 0x10, 1);
  check(cpu(lab, LOAD, ch0 + 0x10).d0 === 0 && lab.vsc.irq_line(0) === 0);
  n += 1;
  cpu(lab, STORE, ch0 + 0x60, 0x16);
  check(lab.sim.u32(ch0 + 0x60) === 0x16 && lab.sim.u32(ch0 + 0x2060) === 0x15);
  lab.doorbell(CMD_RUN_TO_FRAME, 0);
  check(lab.sim.u32(ch0 + 0x2060) === 0x16 && lab.vsc.channel(0).frames === 2);
  n += 1;
  cpu(lab, STORE, ch0 + 0x730, 50);
  lab.doorbell(CMD_RUN_TO_FRAME, 0);
  check(lab.vsc.channel(0).field === 1 && cpu(lab, LOAD, ch0 + 0xE80).d0 === 0);
  lab.doorbell(CMD_ADVANCE, 0, 20 * line);
  check(cpu(lab, LOAD, ch0 + 0xE80).d0 === 20);
  lab.doorbell(CMD_RUN_TO_FRAME, 0);
  check(lab.vsc.channel(0).field === 0 && cpu(lab, LOAD, ch0 + 0xE80).d0 === 0x10000);
  n += 1;
  cpu(lab, STORE, ch0 + 0x4404, 0x1F7F07D5);
  const [pal, flags] = lab.vsc.palette(0);
  check(pal[1] === 0x1F7F07D5 && flags[1] === 1 && flags.reduce((a, b) => a + b, 0) === 1);
  cpu(lab, STORE, VSC + 0x18400, 2);
  check(cpu(lab, LOAD, VSC + 0x18400).d0 === 2);
  cpu(lab, STORE, VSC + 0x1C010, 0x77);
  check(cpu(lab, LOAD, VSC + 0x1C010).d0 === 0x77);
  check(cpu(lab, STORE, VSC + 0x18024, 1).fault === 2); expect(lab, ['REG_UNKNOWN']);
  n += 1;
  lab.vsc.set_line_ns(0, 0);
  return n;
}

export const drawn_planes = (comp) => PLANES.filter((p, i) => (comp.header.drawn >>> i) & 1);

// COMPOSE reads the mirror bank: a store into a consumed register after a boundary changes the written bank only.
function latched_bank(lab) {
  const dmaen = VSC_CHANNEL[2] + 0x060;
  const before = lab.compose('tft');
  check(!before.errors.length && drawn_planes(before).includes('IMG1'), () => before.errors);
  lab.step('guest store TFT DMAEN = 0x07 (IMG1 off) after the boundary', () => lab.cpu_store(dmaen, 0x07));
  check(lab.vsc.bank(2).get('DMAEN') === 0x07 && lab.vsc.bank(2, true).get('DMAEN') === 0x27);
  const same = lab.compose('tft', false);
  check(!same.errors.length && deepEqual(drawn_planes(same), drawn_planes(before)), () => drawn_planes(same));
  check(wordsEq(same.words, before.words), 'composite changed before the boundary: reads the written bank');
  compare(lab, 'tft', same, 'same frame');
  const after = lab.compose('tft');
  check(!after.errors.length && !drawn_planes(after).includes('IMG1') && !wordsEq(after.words, before.words));
  compare(lab, 'tft', after, 'next frame');
  lab.step('guest store TFT DMAEN = 0x27 (restore)', () => lab.cpu_store(dmaen, 0x27));
  const again = lab.compose('tft');
  check(wordsEq(again.words, before.words));
  return `DMAEN 0x27 -> 0x07 stored after the boundary: same-frame composite unchanged ${show(drawn_planes(same))}, next frame ${show(drawn_planes(after))}, both == reference; restored`;
}

// Firmware code produces each case the model refuses. Also runs latched_bank() in this session.
function out_of_domain(lab) {
  const found = [];
  const compose_expect = (device, names, skipped = []) => {
    const comp = lab.compose(device);
    const got = comp.errors.map((e) => e.name);
    check(deepEqual(got, names), () => [got, names]);
    const hd = comp.header;
    check(deepEqual(PLANES.filter((p, i) => (hd.skipped >>> i) & 1), skipped), () => hd);
    found.push(...names);
    return comp;
  };
  lab.start(); lab.set_gui_buffers(); lab.open('tft'); lab.palettes(); lab.update();
  lab.load_img(test_card());
  lab.attach_img('tft', ASPECTS.get('3,2'));
  compose_expect('tft', []);
  const latched = latched_bank(lab);
  lab.draw(() => lab.rectangle(10, 100, 1, 1, 200, 1, 2));
  let comp = compose_expect('tft', ['PAL_UNWRITTEN']);
  check(comp.errors[0].value === 1 && comp.header.pal_unwritten === 1, () => comp.errors);
  lab.clear(2);
  lab.step('IMG1 format 4', () => lab.call(IMG_FORMAT, { d0: 2, d1: 4, a0: 0 }));
  compose_expect('tft', ['FMT_UNMODELLED'], ['IMG1']);
  lab.step('IMG1 format 3', () => lab.call(IMG_FORMAT, { d0: 2, d1: 3, a0: 0 }));
  compose_expect('tft', ['PLANC_UNOBSERVED'], ['IMG1']);
  lab.step('IMG1 format 0', () => lab.call(IMG_FORMAT, { d0: 2, d1: 0, a0: 0 }));
  compose_expect('tft', []);
  const strideW = lab.alloc(pack('<6H', 1664, 0, 900, 0, 5, 0), 4);
  const setup = lab.alloc(pack('<6I', strideW, strideW + 4, strideW + 8, 0, 0, lab.surfaces[2].base), 4);
  lab.step('OSD1 plane setup x = 5 (0x501e0e4c)', () => lab.call(0x501E0E4C, { d0: 2, d1: 0, a0: setup }));
  let w = lab.vsc.bank(2);
  const sadr16 = reg(w, 'OSD1DMASADR') * 16, spos8 = reg(w, 'OSDDMASPOS') & 0xFF;      // both read before the check
  check(sadr16 === ((lab.surfaces[2].base & ~15) >>> 0) && spos8 === 5, () => [hex(w.get('OSD1DMASADR')), hex(w.get('OSDDMASPOS'))]);
  lab.draw(() => [11, 16, 21].forEach((colour, i) => lab.rectangle(100 + 40 * i, 100, 9, 20, colour, 1, 2)));
  let n0 = lab.notes.length;
  comp = compose_expect('tft', []);
  const a18 = lab.notes.slice(n0).filter((x) => x.kind === 'SPOS_A18').map((x) => x.value);
  check(deepEqual(a18, [3 << 8 | 5]), () => a18);
  const spos_summary = [compare(lab, 'tft', comp, 'OSD1 x = 5 (A18)')];
  let dump = lab.dump('tft');
  let fetch = new Dram(lab.sim, lab);
  let alt;
  try {
    const moved = new Map(dump.mirror); moved.set('OSDDMASPOS', reg(dump.mirror, 'OSDDMASPOS') & ~0xFF);
    alt = reference(2, moved, dump.palette, dump.palette_written, fetch.fn, lab.vsc.channel(2).order)[2];
  } finally { fetch.close(); }
  let shifted = 0;
  for (let i = 0; i < Math.min(alt.length, comp.words.length); i++) if (alt[i] !== comp.words[i]) shifted++;
  check(shifted, 'SPOS 5 and SPOS 0 give the same composite: the A18 comparison is vacuous');
  spos_summary[0] += ` (with SPOS 0 instead ${shifted} px differ)`;
  lab.clear(2);
  lab.sim.write(strideW + 8, pack('<HH', 125, 0));
  lab.sim.write(setup + 20, pack('<I', lab.surfaces[2].base));
  lab.step('OSD1 plane setup x = 125', () => lab.call(0x501E0E4C, { d0: 2, d1: 0, a0: setup }));
  w = lab.vsc.bank(2);
  check((reg(w, 'OSD1DMABN') & 7) === 1 && (reg(w, 'OSDDMASPOS') & 0xFF) === 125, () => [hex(w.get('OSD1DMABN')), hex(w.get('OSDDMASPOS'))]);
  comp = compose_expect('tft', ['DMA_FIELD'], ['OSD1']);
  check(comp.errors[0].offset === 0x3B4, () => comp.errors);
  spos_summary.push(`x = 125: DMABN 0x${hx(w.get('OSD1DMABN'))} (+1 from 0x501e01b9) -> DMA_FIELD`);
  lab.sim.write(strideW + 4, pack('<HH', 896, 0));
  lab.sim.write(strideW + 8, pack('<HH', 5, 0));
  lab.sim.write(setup + 20, pack('<I', lab.surfaces[2].base));
  lab.step('OSD1 plane setup x = 5, width 896', () => lab.call(0x501E0E4C, { d0: 2, d1: 0, a0: setup }));
  const area1 = VSC_CHANNEL[2] + 0x450, oldArea1 = lab.vsc.bank(2).get('OSD1AREA1');
  lab.step('guest store OSD1AREA1 width 896', () => lab.cpu_store(area1, ((oldArea1 & ~0xFFFF) | 896) >>> 0));
  w = lab.vsc.bank(2);
  check(deepEqual([w.get('OSD1DMABN'), reg(w, 'OSDDMASPOS') & 0xFF, reg(w, 'OSD1AREA1') & 0xFFFF, reg(w, 'OSD1RSZ1') & 1], [0x38, 5, 896, 0]),
    () => [hex(w.get('OSD1DMABN')), hex(w.get('OSDDMASPOS')), hex(w.get('OSD1AREA1')), hex(w.get('OSD1RSZ1'))]);
  comp = compose_expect('tft', ['DMABN_SHORT'], ['OSD1']);
  const e = comp.errors[0];
  check(deepEqual([e.offset, e.value, e.args.slice(0, 2)], [0x3CC, 0x38, [5 + 896, 896]]), () => e);
  dump = lab.dump('tft');
  fetch = new Dram(lab.sim, lab);
  let skippedRef;
  try { skippedRef = reference(2, dump.mirror, dump.palette, dump.palette_written, fetch.fn, lab.vsc.channel(2).order)[4]; } finally { fetch.close(); }
  check(skippedRef.get('OSD1') === 'DMABN', () => skippedRef);
  spos_summary.push(`width 896 at x = 5 (AREA1 width by guest store): DMABN 0x${hx(w.get('OSD1DMABN'))} (0x501e01b9 adds nothing) -> DMABN_SHORT (${5 + 896} > 896 bytes; the reference skips OSD1 too)`);
  lab.step('guest store OSD1AREA1 (restore)', () => lab.cpu_store(area1, oldArea1));
  lab.sim.write(strideW + 4, pack('<HH', 900, 0));
  lab.sim.write(strideW + 8, pack('<HH', 0, 0));
  lab.sim.write(setup + 20, pack('<I', lab.surfaces[2].base));
  lab.step('OSD1 plane setup x = 0', () => lab.call(0x501E0E4C, { d0: 2, d1: 0, a0: setup }));
  compose_expect('tft', []);
  const spos = VSC_CHANNEL[2] + 0x3DC, oldSpos = lab.vsc.bank(2).get('OSDDMASPOS');
  lab.step('guest store OSDDMASPOS byte 0 = 0x15 (address 128-aligned)', () => lab.cpu_store(spos, (oldSpos | 0x15) >>> 0));
  compose_expect('tft', ['SPOS_UNMODELLED'], ['OSD1']);
  lab.step('guest store OSDDMASPOS (restore)', () => lab.cpu_store(spos, oldSpos));
  compose_expect('tft', []);
  spos_summary.push('guest SPOS 0x15 with a 128-aligned address -> SPOS_UNMODELLED');
  // A6 harness guard: the generic IMG scaler setters with an exact 2x upscale 450x300 -> 900x600
  const src = lab.alloc(pack('<HH', 450, 300), 4), dst = lab.alloc(pack('<HH', 900, 600), 4);
  const scaler = lab.alloc(pack('<6I', 0, src, 0, dst, 0, 0), 4);
  lab.step('generic IMG1 scaler 450x300 -> 900x600 (0x501e0ef5, 0x501e1013)', () => {
    lab.call(0x501E0EF5, { d0: 2, d1: 0, a0: scaler });
    lab.call(0x501E1013, { d0: 2, d1: 0, a0: src, a1: dst });
  });
  w = lab.vsc.bank(2);
  check(deepEqual([w.get('IMG1RSZ1'), w.get('IMG1RSZ2'), w.get('IMG1RSZ4')], [0x11, 0x800, 0x1000]), () => w);
  comp = compose_expect('tft', ['IMG_EDGE_UNKNOWN']);
  check(comp.errors[0].value === 2 && drawn_planes(comp).includes('IMG1'), () => comp.errors);
  lab.attach_img('tft', ASPECTS.get('3,2'));
  compose_expect('tft', []);
  const fit = lab.img_attach.get(2);
  lab.img_attach.set(2, { ...fit, src: [fit.src[0] - 1, fit.src[1]] });
  comp = compose_expect('tft', ['IMG_EDGE_UNKNOWN']);
  check(comp.errors[0].value === 3, () => comp.errors);
  lab.img_attach.set(2, fit);
  for (const [label, fn, regs] of [['IMG1DMALD 11136 px (0x501dffae)', 0x501DFFAE, { d0: 2, d1: 11136, a0: 0, a1: 0 }],
    ['IMG1DMASADR 600 rows down (0x501e20c6)', 0x501E20C6, { d0: 2, d1: IMG_BASE + 600 * IMG_STRIDE, a0: 0, a1: 0 }]]) {
    lab.step(label, () => lab.call(fn, regs));
    comp = compose_expect('tft', ['IMG_EDGE_UNKNOWN']);
    check(comp.errors[0].value === 2 && drawn_planes(comp).includes('IMG1'), () => [label, comp.errors]);
    lab.attach_img('tft', ASPECTS.get('3,2'));
    compose_expect('tft', []);
  }
  check(lab.vsc.bank(2).get('IMG1DMALD') === (Math.floor(5568 / 64) << 3) && lab.vsc.bank(2).get('IMG1DMASADR') === IMG_BASE / 16);
  lab.img_attach.set(2, { ...fit, base: fit.base - 600 * IMG_STRIDE });
  comp = compose_expect('tft', ['IMG_EDGE_UNKNOWN']);
  check(comp.errors[0].value === 3, () => comp.errors);
  lab.img_attach.set(2, { ...fit, stride: 2 * fit.stride });
  comp = compose_expect('tft', ['IMG_EDGE_UNKNOWN']);
  check(comp.errors[0].value === 4, () => comp.errors);
  lab.img_attach.set(2, fit);
  compose_expect('tft', []);
  const hdly = VSC_CHANNEL[2] + 0x580, sadr = VSC_CHANNEL[2] + 0x39C;
  lab.step('guest store IMG1HDLY = 0x30', () => lab.cpu_store(hdly, 0x30));
  comp = compose_expect('tft', ['FEATURE_UNOBSERVED']);
  check(comp.status === 'FEATURE_UNOBSERVED' && !comp.words.length, () => comp.header);
  lab.step('guest store IMG1HDLY = 0x2e (restore)', () => lab.cpu_store(hdly, 0x2E));
  compose_expect('tft', []);
  const osd1 = lab.vsc.bank(2).get('OSD1DMASADR');
  lab.step('guest store OSD1DMASADR | 0xF0000000', () => lab.cpu_store(sadr, (osd1 | 0xF0000000) >>> 0));
  compose_expect('tft', ['DMA_FIELD'], ['OSD1']);
  lab.step('guest store OSD1DMASADR (restore)', () => lab.cpu_store(sadr, osd1));
  compose_expect('tft', []);
  lab.step('0x501e04e7(ch 2, 0)', () => lab.call(0x501E04E7, { d0: 2, d1: 0 }));
  comp = compose_expect('tft', ['FMT_UNMODELLED'], ['OSD1', 'OSD2', 'OSD3']);
  check(comp.errors[0].offset === 0x40C && comp.errors[0].value === 0, () => comp.errors);
  check(deepEqual(drawn_planes(comp), ['IMG1']) && comp.status === 'NONE', () => comp.header);
  lab.step('guest store MIXODR1 = 0', () => lab.cpu_store(VSC_CHANNEL[2] + 0x618, 0));
  comp = compose_expect('tft', ['MIX_UNOBSERVED', 'FMT_UNMODELLED'], ['OSD1', 'OSD2', 'OSD3']);
  check(comp.header.mix_flags === 8 && deepEqual(drawn_planes(comp), ['IMG1']), () => comp.header);
  for (const en of [1, 0]) {
    const arg = lab.alloc(pack('<IIBxxx', 0, 0, en), 4);
    lab.step(`0x501e1dd2(2, en ${en})`, () => lab.call(0x501E1DD2, { d0: 2, a0: arg }));
    comp = compose_expect('tft', ['MIX_UNOBSERVED', 'FEATURE_UNOBSERVED']);
    check(comp.errors[1].offset === 0x5D0 && comp.errors[1].value === en, () => comp.errors);
  }
  const size = lab.alloc(pack('<HH', 900, 600), 4);
  lab.step('0x501e375f(2, 4)', () => lab.call(0x501E375F, { d0: 2, d1: 4, a0: size }));
  comp = compose_expect('tft', ['MIX_UNOBSERVED', 'FEATURE_UNOBSERVED', 'FEATURE_UNOBSERVED']);
  check(comp.errors[2].offset === 0x640 && comp.errors[2].value === 1, () => comp.errors);
  lab.open('evf'); lab.resend_palettes('evf'); lab.update();
  lab.attach_img('evf', ASPECTS.get('3,2'));
  comp = compose_expect('evf', ['PLANC_UNOBSERVED', 'PLANC_UNOBSERVED', 'PLANC_UNOBSERVED'], ['OSD1', 'OSD2', 'OSD3']);
  check(comp.errors.every((x) => x.value === 0xCA));
  lab.step('EVF two-field timing 0x501e298b(1, 1)', () => lab.call(0x501E298B, { d0: 1, d1: 1 }));
  comp = compose_expect('evf', ['FIELD_MODE']);
  check(comp.status === 'FIELD_MODE');
  return [found, latched, spos_summary];
}

// Fresh TFT session, IMG attached, clean composite; REG_STORED stores, CTRL2 = 6, the CMM enable, every other
// never-written register in chunks of 32.
function register_classes(lab) {
  lab.start(); lab.set_gui_buffers(); lab.open('tft'); lab.palettes(); demo_gui(lab); lab.update();
  lab.load_img(test_card());
  lab.attach_img('tft', ASPECTS.get('3,2'));
  const off = lab.vsc.offsets, base = VSC_CHANNEL[2];
  const clean = () => {
    const comp = lab.compose('tft');
    check(comp.status === 'NONE' && !comp.errors.length && !comp.error_total, () => comp.errors);
    return comp;
  };
  const before = clean();
  const w = lab.vsc.bank(2);
  lab.step(`guest stores into the ${REG_STORED.size} REG_STORED registers (value ^ 1)`, () => {
    for (const n of [...REG_STORED].sort((a, b) => off.get(a) - off.get(b))) lab.cpu_store(base + off.get(n), w.get(n) !== null ? (w.get(n) ^ 1) >>> 0 : 1);
  });
  const after = clean();
  check(wordsEq(after.words, before.words), 'a REG_STORED register changed the composite');
  compare(lab, 'tft', after, 'stored-only changed');
  lab.step('guest store CTRL2 = 6', () => lab.cpu_store(base + off.get('CTRL2'), 6));
  let comp = lab.compose('tft');
  check(deepEqual(comp.errors.map((x) => [x.name, x.offset, x.value]), [['FEATURE_UNOBSERVED', 0x004, 6]]));
  lab.step('guest store CTRL2 = 0x1c0 (restore)', () => lab.cpu_store(base + off.get('CTRL2'), 0x1C0));
  clean();
  const arg = lab.alloc(new Uint8Array([1, 0]), 4);
  lab.step('CMM enable 0x501e0e1f(2, &{1, 0})', () => lab.call(0x501E0E1F, { d0: 2, a0: arg }));
  check(lab.vsc.bank(2).get('CMMSET1') === 0x80000010, () => hex(lab.vsc.bank(2).get('CMMSET1') ?? 0));
  const written = new Set([off.get('CMMSET1')]);
  const rest = sortNum(unwritten_class(w.keys()).filter((n) => n !== 'CMMSET1').map((n) => off.get(n)));
  const chunks = [[]];
  for (let i = 0; i < rest.length; i += 32) chunks.push(rest.slice(i, i + 32));
  for (const chunk of chunks) {
    if (chunk.length) lab.step(`guest stores of 0 into 0x${hx(chunk[0]).padStart(3, '0')}..0x${hx(chunk.at(-1)).padStart(3, '0')}`, () => chunk.forEach((o) => lab.cpu_store(base + o, 0)));
    for (const o of chunk) written.add(o);
    comp = lab.compose('tft');
    const want = sortNum(written), got = comp.errors.map((x) => x.offset);
    check(comp.status === 'FEATURE_UNOBSERVED' && comp.error_total === want.length && deepEqual(got, want.slice(-64)) && comp.errors.every((x) => x.name === 'FEATURE_UNOBSERVED'),
      () => [comp.status, comp.error_total, want.length]);
  }
  return `${REG_STORED.size} REG_STORED stores: composite clean and unchanged; CTRL2 = 6 flagged; firmware CMM enable (CMMSET1 0x80000010) flagged; ${written.size} never-written registers each flagged (${chunks.length - 1} chunks)`;
}

// ------------------------------------------------------------------------- group 13: code facts
const PALETTE_WRITER = 0x501E055B;
const PALETTE_LOOP_ENDS = new Set([0x501DC54B, 0x501DC651, 0x501DC753, 0x501D91EA, 0x501D921A, 0x501D924C]);
const OSDFMT_WRITER = 0x501E04E7, OSDFMT_CALL = 0x501D9942, MIXODR2_WRITER = 0x501E1945, MIXODR2_CALL = 0x501D98E8;
const PPB_GETTER = 0x501E2D3B;
const PPB = new Map([[0, 64], [1, 128], [2, 128], [3, 32], [4, 32], [5, 64], [6, 64], [7, 64], [8, 64], [9, 64], [10, 32], [11, 48], [12, 96], [13, 32], [14, 64], [15, 0]]);
const GPI_SET_OSD_ORDER = 0x510BD77E, OSD_ORDER_CODE = 0x62AFCD80, ORDER_ERRLOG = 0x37001406;
const HDMI_ERRLOG = 0x37008201, HDMI_FLAG = 0x62A3C8EC;
const OSD_EDGE_PAD = 0x501DB6D5, OSD_EDGE_POS = 0x501DB824;
export const OSD_BUFFER_W = 0x62A3EB34;
const OSD_EDGE_COPY = 0x501DB7D8, OSD_OPEN_WIDTH = 0x501D99E4, OSD_UPDATE_WIDTH = 0x501DC1BA, CHANGE_POST = 0x501C7403;
const TASK_ENTRIES = [0x5001868C, 0x50019048];
const OSD_EDGE_PAD_CALLERS = [0x501DA548, 0x501DA58C, 0x501DA5D0, 0x501DA71A, 0x501DA75C, 0x501DA79E, 0x501DB34A,
  0x501DB40F, 0x501DB4D4, 0x501DBDC3, 0x501DBE8F, 0x501DBF58];

// The instructions of [address, address + length) as a linear disassembler walks them from address, each [address,
// bytes], by the core's instruction lengths (src/core/cpu.mjs insnLength); one that runs past the end is left out.
function decode(image, address, length) {
  const out = [];
  for (let a = address; ;) {
    const o = a - 0x50000000, n = insnLength(image[o], image[o + 1]);
    if (a + n > address + length) return out;
    out.push([a, image.subarray(o, o + n)]);
    a += n;
  }
}
const s8 = (x) => (x << 24) >> 24, s16 = (x) => (x << 16) >> 16, le = (b, i, n) => { let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + b[i + k]; return v; };
// CALL d16 / d32: the target (PC-relative to the instruction), else null
const callTarget = ([a, b]) => (b[0] === 0xCD ? a + s16(le(b, 1, 2)) : b[0] === 0xDD ? a + (le(b, 1, 4) | 0) : null) >>> 0 || null;
// CMP: the immediate of CMP imm,Dn (sign-extended) and CMP imm,An (zero-extended) in their imm8, imm16 and imm32 forms,
// NaN for the register form CMP Dm,Dn / Am,An, undefined for any other instruction
function cmpImm([, b]) {
  const op = b[0];
  if (op >= 0xA0 && op <= 0xBF) return ((op >> 2) & 3) !== (op & 3) ? NaN : op < 0xB0 ? s8(b[1]) : b[1];
  if ((op === 0xFA || op === 0xFC) && (b[1] & 0xEC) === 0xC8) {
    const v = op === 0xFA ? le(b, 2, 2) : le(b, 2, 4);
    return (b[1] & 0x10) ? v : op === 0xFA ? s16(v) : v | 0;
  }
  return undefined;
}
// Bcc d8 (BRA among them), BVC/BVS/BNC/BNS d8, JMP d16 / d32: the target, else null
function branchTarget([a, b]) {
  const op = b[0];
  if (op >= 0xC0 && op <= 0xCA) return (a + s8(b[1])) >>> 0;
  if (op === 0xF8 && b[1] >= 0xE8 && b[1] <= 0xEB) return (a + s8(b[2])) >>> 0;
  if (op === 0xCC) return (a + s16(le(b, 1, 2))) >>> 0;
  if (op === 0xDC) return (a + (le(b, 1, 4) | 0)) >>> 0;
  return null;
}
// MOV imm,D1 (imm8, imm16 sign-extended, imm32): the value, else undefined
function movD1([, b]) {
  if (b[0] === 0x85) return s8(b[1]);
  if (b[0] === 0x2D) return s16(le(b, 1, 2));
  if (b[0] === 0xFC && b[1] === 0xCD) return le(b, 2, 4) | 0;
  return undefined;
}
const insnText = ([a, b]) => `${hx(a).padStart(8, '0')}: ${[...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`;

// CALL d16 (cd) / d32 (dd) sites whose relative target is target, each confirmed by decoding from 48 bytes before
function direct_calls(image, target) {
  const t = target - 0x50000000, hits = [];
  for (const [op, n] of [[0xCD, 2], [0xDD, 4]]) {
    for (let pos = image.indexOf(op); pos >= 0; pos = image.indexOf(op, pos + 1)) {
      if (pos + 1 + n > image.length) continue;
      let rel = 0;
      for (let k = n - 1; k >= 0; k--) rel = rel * 256 + image[pos + 1 + k];
      if (rel >= 2 ** (8 * n - 1)) rel -= 2 ** (8 * n);
      if (pos + rel === t) hits.push(0x50000000 + pos);
    }
  }
  const out = [];
  for (const site of sortNum(hits)) {
    const ins = decode(image, site - 48, 64).find(([a]) => a === site);
    if (ins && callTarget(ins) === target) out.push(site);
  }
  return out;
}
// The first compare after a call site and the backward branch that closes its loop: [cmp address, immediate, target]
function loop_bound(image, site) {
  const ins = decode(image, site, 0x30);
  const k = ins.findIndex((x) => cmpImm(x) !== undefined);
  const [addr] = ins[k], imm = cmpImm(ins[k]);
  const targets = ins.slice(k + 1, k + 4).map(branchTarget).filter((x) => x !== null);
  const back = targets.find((x) => x < site) ?? null;
  return [addr, imm, back];
}

function code_facts() {
  const image = loadImage(), out = [];
  let sites = direct_calls(image, PALETTE_WRITER);
  const bounds = new Map(sites.map((s) => [s, loop_bound(image, s)]));
  const ends = new Set([...bounds.values()].map(([a]) => a));
  check(sites.length === 6 && ends.size === PALETTE_LOOP_ENDS.size && [...ends].every((a) => PALETTE_LOOP_ENDS.has(a))
    && [...bounds.values()].every(([, imm, back]) => imm === 128 && back !== null), () => bounds);
  out.push(`palette writer 0x${hx(PALETTE_WRITER).padStart(8, '0')}: ${sites.length} direct calls (${sites.map(hex).join(', ')}), each in a loop closed by cmp 128 at `
    + `${[...bounds.values()].sort((x, y) => x[0] - y[0]).map(([a]) => hex(a)).join(', ')}: entries 0..127 only`);
  for (const [writer, call, value] of [[OSDFMT_WRITER, OSDFMT_CALL, 128], [MIXODR2_WRITER, MIXODR2_CALL, 8]]) {
    sites = direct_calls(image, writer);
    const before = decode(image, call - 8, 8);
    const sets = before.filter((x) => movD1(x) === value);
    check(deepEqual(sites, [call]) && sets.length, () => [hex(writer), sites.map(hex), before.map(insnText)]);
    out.push(`0x${hx(writer).padStart(8, '0')}: one caller 0x${hx(call).padStart(8, '0')}, d1 = ${value} (${hx(sets.at(-1)[0]).padStart(8, '0')})`);
  }
  withLab(newLab(), (lab) => {
    lab.start(); lab.set_gui_buffers(); lab.open('tft'); lab.palettes(); lab.update();
    const got = new Map();
    for (let f = 0; f < 16; f++) got.set(f, lab.call(PPB_GETTER, { d0: 2, d1: f }).d0 & 0xFF);
    check(deepEqual(got, PPB), () => got);
    out.push(`pixels per burst 0x${hx(PPB_GETTER).padStart(8, '0')}(2, format 0..15) == the jump-table reading ${show(PPB)}`);
    const codes = [];
    for (const [a, b] of [[2, 1], [0, 1], [1, 2]]) {
      lab.step(`GPISetOsdOrder(${a}, ${b})`, () => lab.call(GPI_SET_OSD_ORDER, { d0: a, d1: b }));
      codes.push(lab.sim.read(OSD_ORDER_CODE, 1)[0]);
    }
    check(deepEqual(codes, [5, 0, 3]), () => codes);
    const before = lab.vsc.bank(2), e0 = lab.kernel.errors.length;
    lab.step('gpiUpdateDisplay after GPISetOsdOrder', () => lab.call(0x510BD4EE, { d0: 0 }, null, null, 300000), [], [ORDER_ERRLOG]);
    const logged = lab.kernel.errors.slice(e0).filter(([c]) => c === ORDER_ERRLOG).map(([c, lvl, args, caller]) => [c, lvl, args.slice(0, 3), caller]);
    const after = lab.vsc.bank(2), diff = new Map();
    for (const [k, v] of after) if (before.get(k) !== v) diff.set(k, [before.get(k), v]);
    const sends = lab.steps.at(-1).events.filter((e) => e[0] === 'send');
    check(deepEqual(sends.map((x) => x[1]), ['queue 136 cmd 6', 'queue 136 cmd 17']) && deepEqual(logged, [[ORDER_ERRLOG, 2, [2, 3160, 3], where(runtime(0x501DB501))]])
      && deepEqual(diff, new Map([['CTRL3', [1, 0x41]]])), () => [sends, logged, diff]);
    out.push(`GPISetOsdOrder (2,1)/(0,1)/(1,2) -> codes ${show(codes)}; gpiUpdateDisplay sends cmd 6, whose handler logs 0x${hx(ORDER_ERRLOG).padStart(8, '0')} (2, 3160, 3) and changes only CTRL3 1 -> 0x41: the plane order stays fixed`);
  });
  sites = direct_calls(image, OSD_EDGE_PAD);
  check(deepEqual(sites, OSD_EDGE_PAD_CALLERS), () => sites.map(hex));
  const padCalls = [], order = [];
  let got = [], widths, events, e0, opened;
  withLab(newLab(), (lab) => {
    const mark = (...a) => order.push([...a, lab.kernel.events.length]);
    observe(lab, OSD_EDGE_PAD, () => padCalls.push('entry'));
    observe(lab, OSD_EDGE_COPY, () => padCalls.push('copy'));
    observe(lab, OSD_OPEN_WIDTH, (r) => { padCalls.push(r.d0 & 0xFFFF); mark('w', r.d0 & 0xFFFF); });
    observe(lab, CHANGE_POST, () => mark('post'));
    const drain = lab.drain_display_change.bind(lab);
    lab.drain_display_change = () => { mark('drain'); drain(); };
    lab.start(); lab.set_gui_buffers();
    e0 = lab.kernel.events.length;
    lab.open('evf');
    events = lab.kernel.events;
    lab.palettes(); lab.update();
    const b = lab.vsc.bank(1);
    for (const n of [1, 2, 3]) {
      const w = reg(b, `OSD${n}AREA1`) & 0x1FFF, sh = b.get(`OSD${n}RSZ2`);
      check((reg(b, `OSD${n}RSZ1`) & 1) && (regValue(sh) & 3) === 0, () => [n, hex(b.get(`OSD${n}RSZ1`)), sh]);
      const pos = lab.call(OSD_EDGE_POS, { d0: sh >>> 2, d1: w }).d0 & 0xFFFF;
      check(pos === osd_cols(w, sh).at(-1) && osd_cols(w, sh).at(-1) !== Math.floor((w - 1) * sh / 4096), () => [n, w, sh, pos]);
      got.push([w, sh, pos]);
    }
    widths = [0, 1, 2].map((p) => unpack('<H', lab.sim.read(OSD_BUFFER_W + 4 * p, 2))[0]);
  });
  opened = padCalls.filter((x) => typeof x === 'number');
  check(deepEqual(opened, [800, 800, 800, 900, 900, 900]) && deepEqual(widths, [900, 900, 900]) && padCalls.includes('entry') && !padCalls.includes('copy'), () => [padCalls, widths]);
  const kinds = order.map((x) => x.slice(0, -1));
  check(deepEqual(kinds, [['post'], ['w', 800], ['w', 800], ['w', 800], ['drain'], ['w', 900], ['w', 900], ['w', 900]]), () => order);
  const sleep = range(order[0].at(-1), order[1].at(-1)).filter((i) => head3(events[i], 'rtos', 'OlyTaSS', 'd0=1') && events[i][3] === where(runtime(0x501C7581)));
  const quiet = range(order[4].at(-1), order[5].at(-1)).map((i) => events[i]).filter((ev) => ev[0] === 'rtos');
  check(e0 <= order[0].at(-1) && sleep.length && !quiet.length, () => [sleep, quiet]);
  const u32i = (a) => image[a] | image[a + 1] << 8 | image[a + 2] << 16 | image[a + 3] * 2 ** 24;
  const pri = new Map(TASK_ENTRIES.map((a) => [a, [0, 1, 2, 3].map((k) => u32i(a - 0x50000000 + 12 + 4 * k))]));
  check(deepEqual(new Map([...pri].map(([a, v]) => [a, [u32i(a - 0x50000000), v[0], v[1]]])), new Map([[0x5001868C, [0x36, 0x601E4055, 26]], [0x50019048, [0x8F, 0x601E7DAC, 54]]])), () => pri);
  const pads2 = [], upd = [];
  let widths2;
  withLab(newLab(), (lab) => {
    observe(lab, OSD_EDGE_COPY, (r) => pads2.push(r.d3));
    observe(lab, OSD_UPDATE_WIDTH, (r) => upd.push(r.d0 & 0xFFFF));
    lab.start(); lab.set_gui_buffers(); lab.open('evf');
    for (let p = 0; p < 3; p++) lab.sim.write(OSD_BUFFER_W + 4 * p, pack('<H', 800));
    lab.palettes(); lab.update();
    widths2 = [0, 1, 2].map((p) => unpack('<H', lab.sim.read(OSD_BUFFER_W + 4 * p, 2))[0]);
  });
  check(deepEqual(sortNum(pads2), [0, 1, 2]) && !upd.length && deepEqual(widths2, [800, 800, 800]), () => [pads2, upd, widths2]);
  const showSorted = (xs) => show(xs.sort((a, b) => (Array.isArray(a) ? a[0] - b[0] || a[1] - b[1] : a - b)));
  const posSet = [...new Set(got.map(([, , p]) => p))], whSet = [...new Map(got.map(([w, sh]) => [`${w},${sh}`, [w, sh]])).values()];
  const floorSet = [...new Set(got.map(([w, sh]) => Math.floor((w - 1) * sh / 4096)))];
  out.push(`A6 OSD edge pad 0x${hx(OSD_EDGE_PAD).padStart(8, '0')}: ${sites.length} callers; on the EVF 0x${hx(OSD_EDGE_POS).padStart(8, '0')}(RSZ2 >> 2, `
    + `width) = ${showSorted(posSet)} for (width, RSZ2) ${showSorted(whSet)} `
    + `== osd_cols (round half up; floor would give ${showSorted(floorSet)}); `
    + `width words ${show(widths)} after the EVF OPEN (0x501d99e4 stores ${show(opened)}; the DISPLAY task's 800 after `
    + 'its OlyTaSS(1) at 0x501c7581, the 900 from the synchronous DISPLAY_CHANGE stand-in): the pad runs '
    + `${padCalls.filter((x) => x === 'entry').length} times and copies nothing (it copies column w - 1 of row 0 into column w `
    + 'only when the word is <= that column: check_nav groups 7 and 8); DISPLAY priority 26, DISPLAY_CHANGE '
    + '54 (0x5001868c, 0x50019048), so on the camera 800 most likely lands last: with the words set to 800 '
    + `after the OPEN the update stores no width (0x501dc1ba) and the pad copies in planes ${show(sortNum(pads2))}`);
  const tra = new Map([61, 62, 63, 85, 86, 87].map((pid) => [pid, [127, 255].map((i) => (gui_palette(image, pid)[i] >>> 24) >>> 3)]));
  check([...tra.values()].every((v) => deepEqual(v, [0, 0])), () => tra);
  out.push('U16 palette data: palettes 61/62/63/85/86/87 entries 127 and 255 have tra 0 (index 255 transparent '
    + 'whether bit 7 selects entry 255 or is ignored; the SRAM half 128..255 is never written: PAL_UNWRITTEN)');
  withLab(newLab(), (lab) => {
    lab.start(); lab.set_gui_buffers();
    lab.props.set(4513, 4);
    const e1 = lab.kernel.errors.length, ev0 = lab.kernel.events.length;
    lab.step('DISPLAY cmd 2 OPEN HDMI (mask 4)', () => { lab.display_cmd(2, pack('<I', 4)); lab.drain_display_change(); }, [], [HDMI_ERRLOG]);
    const logged = lab.kernel.errors.slice(e1).filter(([c]) => c === HDMI_ERRLOG).map(([c, lvl, args, caller]) => [c, lvl, args.slice(0, 2), caller]);
    const polls = lab.kernel.events.slice(ev0).filter((e) => head3(e, 'rtos', 'OlyTaSS', 'd0=20') && e[3] === where(runtime(0x501D5C47))).length;
    const flag = lab.sim.read(HDMI_FLAG, 1)[0], opn = lab.sim.u32(0xA32DB39C);
    check(deepEqual(logged, [[HDMI_ERRLOG, 2, [1, 259], where(runtime(0x501D5C7C))]]) && polls === 50 && flag !== 0xF0 && opn === 4, () => [logged, polls, hex(flag), hex(opn)]);
    out.push(`HDMI OPEN (mask 4): 50 polls (OlyTaSS 20 each) of 0x${hx(HDMI_FLAG).padStart(8, '0')} for 0xf0 (lab 0x${flag.toString(16).padStart(2, '0')}: `
      + `0x501d30f6 returns 2), then 0x${hx(HDMI_ERRLOG).padStart(8, '0')} (level 2, 1, 259) at 0x501d5c75 and a jump past the `
      + 'rest of the open (0x501d5c7c -> 0x501d5e94); the opened mask 0xa32db39c already holds 4');
  });
  return out;
}

// Group 7b: the face-frame IMG3 setup 0x501dcb1a(mask 1) runs to completion
function face_overlay() {
  return withLab(newLab(), (lab) => {
    lab.start(); lab.set_gui_buffers(); lab.open('tft'); lab.palettes(); demo_gui(lab); lab.update();
    lab.load_img(test_card());
    lab.attach_img('tft', ASPECTS.get('3,2'));
    const before = lab.vsc.bank(2);
    const face = range(0, 8).map((i) => VSC_CHANNEL[2] + 0xD00 + 4 * i);
    lab.step('face IMG3 setup 0x501dcb1a(mask 1)', () => lab.call(0x501DCB1A, { d0: 1 }, null, null, 300000));
    const after = lab.vsc.bank(2), diff = new Map();
    for (const [k, v] of after) if (before.get(k) !== v) diff.set(k, v);      // not a predicate: the changed registers, compared whole below
    const stored = face.map((a) => lab.sim.u32(a));
    check(deepEqual(diff, new Map([['CTRL3', 0x41], ['DMAEN', 0x07], ['IMG3FMT', 2], ['IMG3PLANC', 0x1000], ['IMG3DMALD', 0x40], ['IMG3DMABN', 0x40]])), () => diff);
    const written = lab.vsc.flags(2, 'w').subarray(0xD00 / 4, 0xD20 / 4);
    check(written.every((x) => x), () => [...written]);
    const comp = lab.compose('tft');
    const got = comp.errors.map((e) => [e.name, e.offset, e.value]);
    return [diff, stored, comp.status, got];
  });
}

// Group 8b: the lab view CH_VIEW: each single-plane composite equals reference(order=[p]), mask 0 gives the BG only
function plane_views() {
  const out = [];
  withLab(newLab(), (lab) => {
    lab.start(); lab.set_gui_buffers(); lab.open('tft'); lab.palettes(); demo_gui(lab); lab.update();
    lab.load_img(test_card());
    lab.attach_img('tft', ASPECTS.get('3,2'));
    const full = lab.compose('tft');
    const planes = drawn_planes(full);
    const fetch = new Dram(lab.sim, lab);
    try {
      for (const [mask, order] of [...planes.map((p) => [1 << PLANES.indexOf(p), [p]]), [0, []]]) {
        lab.vsc.set_view(2, mask);
        const n0 = lab.notes.length;
        const comp = lab.compose('tft', false);
        const dump = lab.dump('tft');
        const [, , ref, drawn, skipped] = reference(2, dump.mirror, dump.palette, dump.palette_written, fetch.fn, order);
        const views = lab.notes.slice(n0).filter((n) => n.kind === 'VIEW').map((n) => n.value);
        check(comp.status === 'NONE' && !comp.errors.length && deepEqual(drawn_planes(comp), drawn) && deepEqual(drawn, order) && wordsEq(comp.words, ref)
          && comp.header.view === mask && deepEqual(views, [mask]), () => [order, comp.status, comp.errors, drawn_planes(comp), drawn, skipped, views]);
        if (!order.length) {
          const bg = dump.mirror.get('BG') & 0xFFFFFF;
          check(comp.words.every((x) => x === bg) && comp.words.length, 'mask 0 is not the BG alone');
        }
        out.push(`${order.join('+') || 'none (BG only)'} == reference(order=${show(order)})`);
      }
    } finally { fetch.close(); }
    lab.vsc.set_view(2, 0x3F);
    const again = lab.compose('tft', false);
    check(wordsEq(again.words, full.words) && again.header.view === 0x3F);
  });
  return out;
}

// On the written PNGs (A9 conversion)
function geometry(record, out) {
  const [tw, th, trows] = read_png(path.join(out, 'tft.png'));
  const [ew, eh, erows] = read_png(path.join(out, 'evf.png'));
  check(tw === 900 && th === 600 && ew === 1600 && eh === 1200);
  const px = (rows, x, y) => [rows[y][3 * x], rows[y][3 * x + 1], rows[y][3 * x + 2]];
  const [Y, CB, CR] = bt601(255, 255, 255), white = ycc_to_rgb(Y | CB << 8 | CR << 16);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  for (let x = 700; x < 703; x++) {
    for (const y of [300, 301]) {
      check(same(px(trows, x, y), white), () => [x, y, px(trows, x, y)]);
      for (const dx of [-1, 0]) for (const dy of [0, 1]) check(same(px(erows, 2 * x + dx, 2 * y + dy), white), () => [x, y, dx, dy]);
    }
  }
  check(!same(px(trows, 703, 300), white) && !same(px(trows, 699, 300), white));
  check(!same(px(erows, 1405, 600), white) && !same(px(erows, 1398, 600), white));
  const bg = ycc_to_rgb(0x0080800B);
  check(bg.every((v) => Math.abs(v - 11) <= 1), () => bg);
  for (const y of [...range(0, 67), ...range(1133, 1200)]) {
    let ok = true;
    for (let x = 1210; x < 1600; x += 13) if (!same(px(erows, x, y), bg)) ok = false;
    check(ok, y);
  }
  check(!same(px(erows, 1300, 67), bg) && !same(px(erows, 1300, 1132), bg));
  return 4;
}

const fmt_counts = (counts) => [...counts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `0x${hx(k).padStart(8, '0')} x${v}`).join(', ');
const KERNEL_NONE_NOTES = new Map(['0014', '0028', '0040', '0044'].map((x) => [`tft STUB_UNWRITTEN 0x9820${x}`, `tft STUB_UNWRITTEN 0x9848${x}`]));

// The compositor's own notes reach the session's notes (DisplayLab.compose reads them before CLEAR).
function compose_reset(record, c) {
  const got = new Set(record.notes.filter(([kind, ch]) => kind === 'COMPOSE_RESET' && ch === c).map(([, , name]) => name));
  check(got.has('PEAK1') && got.has('OSDDMASPOS'), () => `channel ${c}: COMPOSE_RESET notes ${show(sortStr(got))}`);
}
export function check_notes(device, record) {
  // want, got: the values of each 'flow kind' (neither has a space)
  const want = new Map(), got = new Map();
  const add = (m, flow, kind, v) => { const k = `${flow} ${kind}`; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  if (fs.existsSync(NOTES_FILE)) {
    for (let line of fs.readFileSync(NOTES_FILE, 'utf8').split(/\r\n|\r|\n/)) {
      if (line && !line.startsWith('#')) {
        if (OSD_DEFAULTS.kernel === 'none') line = KERNEL_NONE_NOTES.get(line) ?? line;
        const parts = line.split(' ');                  // line.split(' ', 2) unpacked into three names
        if (parts.length < 3) throw new ValueError(`${NOTES_FILE}: ${line}: FLOW KIND VALUE`);
        add(want, parts[0], parts[1], parts.slice(2).join(' '));
      }
    }
  }
  for (const [kind, channel, name] of record.notes) add(got, device, kind, `${channel} ${name}`);
  for (const address of record.stub_unwritten) add(got, device, 'STUB_UNWRITTEN', h8(address));
  const keys = sortStr(new Set([...want.keys(), ...got.keys()].filter((k) => k.split(' ')[0] === device)));
  const bad = new Map();
  for (const k of keys) {
    const g = got.get(k) ?? new Set(), w = want.get(k) ?? new Set();
    if (!pred(g.size === w.size && [...g].every((x) => w.has(x)))) bad.set(k, [sortStr([...g].filter((x) => !w.has(x))), sortStr([...w].filter((x) => !g.has(x)))]);
  }
  check(!bad.size, () => `${device}: notes differ from check_display_notes.txt (new, missing): ${show(bad)}`);
}

export function check_display(seed = 1) {
  const start = performance.now();
  fs.mkdirSync(OUT, { recursive: true });
  withLab(newLab(), (lab) => {
    console.log(`1 environment: ${environment(lab)} checks passed (debug/stub windows, register table == image tables 0x331da0/0x332d60, IMG region outside every MM bank based in the uncached DRAM view, live-view banks outside both DRAM views)`);
    console.log(`2 register level (channel 0, guest stores/loads): ${register_level(lab)} checks passed`);
    const counts = class_partition(lab);
    console.log(`12a register classes: ${counts.get('MODEL') ?? 0} read by the model, ${counts.get('STORED') ?? 0} stored only, ${counts.get('FEATURES') ?? 0} A13 values, ${counts.get('UNWRITTEN') ?? 0} never written; om1-vsc.c tables agree`);
  });
  withLab(newLab(), (lab) => console.log(`12b register classes on a TFT composite: ${register_classes(lab)}`));
  for (const line of code_facts()) console.log(`13 ${line}`);
  const [diff, stored, status, errs] = face_overlay();
  console.log(`7b face overlay 0x501dcb1a(mask 1): runs to completion; registers changed ${show(new Map([...diff].map(([k, v]) => [k, hex(v)])))} (IMG3 format 2 with PLANC bit 12, IMG3 not enabled in DMAEN); `
    + `+0xd00..+0xd1c = ${show(stored.map(hex))} (0x501e061a, stored only); composite ${status}: ${show(errs.map(([n, o, v]) => [n, hex(o), hex(v)]))}`);
  check(status === 'FEATURE_UNOBSERVED' && deepEqual(errs, [['FEATURE_UNOBSERVED', 0x008, 0x41], ...stored.map((v, i) => ['FEATURE_UNOBSERVED', 0xD00 + 4 * i, v])]), () => errs);
  console.log(`8b plane views (CH_VIEW, lab only): ${plane_views().join('; ')}`);
  withLab(newLab(), (lab) => {
    const [found, latched, sposSummary] = out_of_domain(lab);
    console.log(`7 out of domain, produced by firmware code: ${sortStr(new Set(found)).join(', ')} `
      + '(PAL_UNWRITTEN count 1, FMT 3 -> PLANC bit 12, OSD x = 5, generic IMG scaler 2x, IMG1 stride '
      + '0x501dffae and address 0x501e20c6 moved -> harness IMG_EDGE_UNKNOWN (and guard arithmetic, reasons '
      + '3/4), IMG1HDLY 0x30, OSD1DMASADR bits 31..28, OSDFMT1 0 from '
      + '0x501e04e7(2, 0) -> OSD1-3 skipped, MIXODR1 = 0, HILIGHT1 en 1/0 via 0x501e1dd2, test pattern '
      + '0x501e375f, EVF trans 0xca, two-field EVF)');
    console.log(`7 A18 (SPOS != 0): ${sposSummary.join('; ')}`);
    console.log(`10 composite reads the latched bank: ${latched}`);
  });
  let [lab, tft] = flow('tft', seed, { switch_to: 'evf' });
  lab.close();
  console.log(`3 TFT flow: ${tft.regs_before} + ${tft.regs_after} registers == spec formulas, ${tft.palette} palette words == firmware formula, mirror == written (${tft.m_equals_w}), error log ${fmt_counts(tft.errlog)}; S-CHGWAIT once per OPEN`);
  check(deepEqual(tft.errlog, ERRLOG.tft), () => tft.errlog);
  const chg = where(runtime(0x501C74AA));
  check(deepEqual(tft.chgwait, [chg, chg]), () => tft.chgwait);
  compose_reset(tft, 2);
  check_notes('tft', tft);
  let evf;
  [lab, evf] = flow('evf', seed);
  lab.close();
  console.log(`4 EVF flow: ${evf.regs_before} + ${evf.regs_after} registers == spec formulas, ${evf.palette} palette words, mirror == written (${evf.m_equals_w}), error log ${fmt_counts(evf.errlog)}`);
  check(deepEqual(evf.errlog, ERRLOG.evf), () => evf.errlog);
  check(deepEqual(evf.chgwait, [chg]), () => evf.chgwait);
  compose_reset(evf, 1);
  check_notes('evf', evf);
  console.log(`5 composite == independent reference: ${tft.compare}`);
  console.log(`  ${evf.compare}`);
  const image = loadImage();
  const planc = switch_planc(image, 0);
  let sw = tft.switch, so = tft.switch_obs;
  check(deepEqual(tft.switch_errlog, ERRLOG['tft-to-evf']), () => tft.switch_errlog);
  check(deepEqual(sw.errors.map((e) => [e.name, e.value]), [0, 1, 2].map(() => ['PLANC_UNOBSERVED', planc])), () => sw.errors);
  check(deepEqual(tft.switch_planc, new Map([[1, planc], [2, planc], [3, planc]])) && deepEqual(so.get('p587'), [0]), () => [tft.switch_planc, so]);
  check(deepEqual(so.get('level_step').map(([i]) => i), [SWITCH_INDEX_OFFSET]) && deepEqual(so.get('level_apply'), [planc >> 1]), () => so);
  check(deepEqual(tft.zero_palettes, [384, 384]), () => tft.zero_palettes);
  console.log(`6a switch TFT -> EVF (empty store): property 587 read as 0 at 0x501c73ad (error log ${fmt_counts(tft.switch_errlog)}), 0x501c67aa(7) -> 0x501c69e5(${planc >> 1}): OSD1-3 PLANC 0x${hx(planc)} `
    + `== (table 0x602ae4b4 entry 7 level * 2) -> 3 x PLANC_UNOBSERVED, OSD planes skipped; EVF palettes zero after the switch (${tft.zero_palettes[0]} written words, all 0) until H-RESEND 0x503e52c7, then `
    + `${tft.switch_palette} words == formula; ${tft.switch_compare}`);
  let e2t;
  [lab, e2t] = flow('evf', seed, { switch_to: 'tft' });
  lab.close();
  sw = e2t.switch; so = e2t.switch_obs;
  check(sw.status === 'NONE' && !sw.errors.length && !sw.error_total && deepEqual(drawn_planes(sw), ['IMG1', 'OSD1', 'OSD2', 'OSD3']), () => [sw.status, sw.errors, drawn_planes(sw)]);
  check(wordsEq(sw.words, tft.comp.words), 'EVF -> TFT composite differs from the direct TFT composite');
  check(deepEqual(e2t.switch_errlog, ERRLOG['evf-to-tft']) && deepEqual(e2t.chgwait, [chg, chg]), () => [e2t.switch_errlog, e2t.chgwait]);
  check(deepEqual(so.get('level_step'), [[16, 0x501C4F54]]) && !so.get('level_apply').length, () => so);
  console.log(`6b switch EVF -> TFT: status NONE, drawn ${show(drawn_planes(sw))}, 0 errors; == the direct TFT composite word for word; ${e2t.switch_palette} palette words == formula after H-RESEND; S-CHGWAIT once per OPEN; `
    + `0x501c67aa(16) from 0x501c4f4f (special branch, no level table, PLANC 0x100); error log ${fmt_counts(e2t.switch_errlog)}; ${e2t.switch_compare}`);
  check(deepEqual(e2t.timer_after_init, range(0, TIMER_SLOTS).map((i) => [i + 1, 0, 0, 0, 0, 0])), () => e2t.timer_after_init);
  const tick = e2t.hw_timer_after_init;
  check(deepEqual(tick[0].slice(0, 5), [0x0101, 1, 128, 2, TICK_CALLBACK]) && tick.every((t, i) => !i || deepEqual(t, [i + 1, 0, 0, 0, 0, 0])), () => tick);
  check(e2t.handle_after_open === 0x0101 && deepEqual(so.get('timer_delete'), [[2, 0x0101]]) && e2t.timer_after_switch[0][1] === 0, () => [hex(e2t.handle_after_open), so, e2t.timer_after_switch[0]]);
  const guards = new Map();
  for (const [f, , rv] of e2t.timer_log) { const k = JSON.stringify([f, rv]); guards.set(k, [[f, rv], (guards.get(k)?.[1] ?? 0) + 1]); }
  const want = [...range(20, 32).map((ch) => ['0x50064323', ch]), ['0x50064352', 20], ['0x5006437d', 20], ...range(16, 20).map((ch) => ['0x50064323', ch])];
  check(deepEqual(e2t.timer_log.map(([f, ch]) => [f, ch]), want), () => e2t.timer_log);
  console.log(`6c software timers: 0x50058959 leaves slots 1..32 of 0xa32c5620 = handles 1..32 (idle) and the tick timer in hardware slot 1 (handle 0x0101, mode 128, period 2, callback 0x${hx(TICK_CALLBACK).padStart(8, '0')}); H-TIMER `
    + `calls ${show(new Map([...guards.values()]))} on ch 20..31, 20, 20, 16..19; the EVF OPEN stores handle 0x0101 at 0x${hx(EVF_TIMER_HANDLE).padStart(8, '0')}, the TFT OPEN's `
    + 'delete 0x500589d7(2, 0x0101) frees slot 1 without an error log');
  const [handle] = timer_negative_control();
  console.log(`6d negative control (timer_init=False): EVF OPEN stores handle 0x${hx(handle).padStart(4, '0')}; the TFT OPEN stops with 0x${hx(TIMER_ERRLOG).padStart(8, '0')} (4, 1255, 0x${hx(handle).padStart(4, '0')}) from 0x5005920a`);
  const observed = new Set([...tft.written, ...evf.written, ...e2t.written].filter((n) => !REG_MODEL.has(n)));
  const classified = new Set([...REG_STORED, ...FEATURES.keys()]);
  check(observed.size === classified.size && [...observed].every((n) => classified.has(n)), () => ['written, not read, unclassified', sortStr([...observed].filter((n) => !classified.has(n))),
    'classified, never written', sortStr([...classified].filter((n) => !observed.has(n)))]);
  console.log(`3-6 classes == observation: registers written on channels 1/2 by the TFT, TFT -> EVF, EVF and EVF -> TFT flows and not read == REG_STORED + FEATURES (${observed.size}); main TFT/EVF composites clean (status NONE, 0 errors)`);
  console.log(`8 PNG geometry: ${geometry(evf, OUT)} checks (900x600 / 1600x1200, 2x2 OSD scaling on EVF at columns 2x-1/2x (A6), BG rows 0..66 and 1133..1199, BG -> RGB 11 +-1)`);
  let again;
  [lab, again] = flow('tft', seed, { switch_to: 'evf' });
  lab.close();
  const same = ['time', 'waits', 'frames', 'delivered', 'notes', 'stub_unwritten', 'errlog', 'banks'];
  const dif = same.filter((k) => !deepEqual(again[k], tft[k]) && !(k === 'notes' && deepEqual(sortStr(again.notes.map((x) => JSON.stringify(x))), sortStr(tft.notes.map((x) => JSON.stringify(x))))));
  check(!dif.length && wordsEq(again.comp.words, tft.comp.words) && wordsEq(again.switch.words, tft.switch.words), () => dif);
  console.log(`9 determinism: second TFT -> EVF session identical (outputs, both banks, notes, lab time ${tft.time} ns, vsync waits ${show(tft.waits)}, frames ${show(tft.frames)})`);
  console.log(`11 run check_nd128.py, check_isa.py and check_osd.py separately; ${((performance.now() - start) / 1000).toFixed(1)} s`);
}

// --write-notes: the notes of the TFT -> EVF and EVF flows, into OM_NOTES_DIR
function write_notes(seed = 1) {
  const dir = process.env.OM_NOTES_DIR;
  const lines = ['# check_display pinned lists: <flow> <kind> <channel> <register> | <flow> STUB_UNWRITTEN <addr>',
    '# RESET_READ: CPU read of a never-written VSC register (channel 3 = output block);',
    '# MIRROR_RESET_READ: of a mirror word latched from a never-written register; SRAM_RESET_READ: of a',
    '# never-written palette/LUT/output SRAM word; OUT_READ: CPU read of a written output-block register',
    '# or output SRAM word; COMPOSE_RESET: compositor took a never-written',
    '# register as 0; STUB_UNWRITTEN: lab-stub read of a never-written, non-preset address.'];
  for (const [device, switchTo] of [['tft', 'evf'], ['evf', null]]) {
    const [lab, record] = flow(device, seed, { switch_to: switchTo });
    lab.close();
    const cmp = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
    for (const [kind, channel, name] of [...record.notes].sort(cmp)) lines.push(`${device} ${kind} ${channel} ${name}`);
    for (const address of record.stub_unwritten) lines.push(`${device} STUB_UNWRITTEN ${h8(address)}`);
  }
  const file = path.join(dir, 'check_display_notes.txt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`wrote ${file}`);
}

export function main(argv) {
  const a = parseArgs('check_display.mjs', argv, [
    { opt: '--seed', type: 'int' },
    { opt: '--write-notes', type: 'flag' },
    { opt: '--kernel', type: 'str', choices: ['native', 'none'] },
  ]);
  OSD_DEFAULTS.kernel = a.kernel ?? 'native';
  if (a.write_notes && OSD_DEFAULTS.kernel !== 'native') a.error('--write-notes pins the default (K-native) lab');
  if (a.write_notes && !process.env.OM_NOTES_DIR) a.error('--write-notes: needs OM_NOTES_DIR (the directory to write check_display_notes.txt in)');
  try {
    if (a.write_notes) write_notes(a.seed ?? 1);
    else check_display(a.seed ?? 1);
  } catch (e) {
    if (e instanceof FirmwareError) throw new SystemExit(`FAILED: ${e.message}`);
    throw e;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_display.mjs', main);
