// The VSC device's tables, without firmware traces: the register tables read from the image equal the committed
// header checks/fixtures/om1-vsc-regs.h, the JS register classes equal check_display's parse of the class
// tables (checks/fixtures/om1-vsc-tables.c), and the blend table equals the blend() formula below on all
// 32 x 256 x 256 inputs. vscHistUnits: kind 1's histogram unit on a machine with E143's image, driven through the
// device's own register writes and doorbell (docs/om1-vsc-spec.md section 13): a start ends at the second boundary
// (A-VSCHIST-1) with INTST1 bit 8 and, with INTEN1 bit 8, the channel's IRQ; the bins of a run without a source plane
// read 0 (A-VSCHIST-2, and A-VSCHIST-5 where the firmware would keep them); a bin read with no run ended, a bin read
// of a run the model cannot count and a start during a run are HIST_UNMODELLED and a bus error; its registers in a
// composite under the A-VSCHIST-3 opt-in (vscHistCompose); its bins against histograms computed by hand
// (vscHistBins: A-VSCHIST-4 and A-VSCHIST-6).
//   node emu/test/test_dev.mjs
import fs from 'node:fs';
import path from 'node:path';
import { vscTables } from '../src/dev/vscregs.mjs';
import { blendLut, blend, registerClass, HIST_WHY, histComponent } from '../src/dev/vsccompose.mjs';
import { model_classes } from '../refs/display.mjs';

const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const IMAGE = path.join(REPO, 'unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin');
const HEADER = path.join(REPO, 'emu/checks/fixtures/om1-vsc-regs.h');

// vsc-classes: the JS compositor's register classes (vsccompose.mjs reg_class / features) equal
// check_display's parse of the same C tables (refs/display.mjs model_classes), name by name. check_display's
// group 12a reads the C tables (checks/fixtures/om1-vsc-tables.c); this pins the JS device to the same tables.
export function vscClasses() {
  const bad = [];
  const src = fs.readFileSync(path.join(REPO, 'emu/checks/fixtures/om1-vsc-tables.c'), 'utf8');
  const chan = vscTables(new Uint8Array(fs.readFileSync(IMAGE))).chan;
  const model = model_classes(new Map(chan), src);
  for (const [off, name] of chan) {
    const js = registerClass(off), c = model.get(name);
    if (JSON.stringify(js) !== JSON.stringify(c)) bad.push(`${name} (0x${off.toString(16)}): JS ${JSON.stringify(js)}, om1-vsc.c ${JSON.stringify(c)}`);
  }
  return { names: chan.length, bad };
}

// The tables read from the image equal the committed header's entries (offsets and names, in order).
export function vscRegsHeader() {
  const bad = [];
  const text = fs.readFileSync(HEADER, 'utf8'), t = vscTables(new Uint8Array(fs.readFileSync(IMAGE)));
  for (const [key, label] of [['chan', 'CHAN'], ['out', 'OUT']]) {
    const block = text.split(`om1_vsc_${key}_regs[OM1_VSC_${label}_REG_COUNT] = {`)[1].split('};')[0];
    const entries = [...block.matchAll(/\{ 0x([0-9a-f]+), "([^"]*)" \}/g)].map((m) => [parseInt(m[1], 16), m[2]]);
    const count = Number(text.match(new RegExp(`#define OM1_VSC_${label}_REG_COUNT (\\d+)`))[1]);
    if (entries.length !== count || JSON.stringify(entries) !== JSON.stringify(t[key])) {
      const k = entries.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(t[key][i]));
      bad.push(`${key}: header ${entries.length} entries (count ${count}), image ${t[key].length}; first difference at ${k}: ${JSON.stringify(entries[k])} vs ${JSON.stringify(t[key][k])}`);
    }
  }
  return { tables: [vscTables(new Uint8Array(fs.readFileSync(IMAGE))).chan.length, vscTables(new Uint8Array(fs.readFileSync(IMAGE))).out.length], bad };
}

// blend(): ((a * tra + b * (31 - tra) + 15) / 31) per component, unsigned C division, on every (tra, a, b).
export function blendTable() {
  const bad = [], L = blendLut();
  let n = 0;
  for (let t = 0; t < 32; t++) for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
    const x = a * t + b * (31 - t) + 15, want = (x - (x % 31)) / 31;
    if (L[(t << 16) | (a << 8) | b] !== want && bad.length < 5) bad.push(`blend t ${t} a ${a} b ${b}: ${L[(t << 16) | (a << 8) | b]} != ${want}`);
    n++;
  }
  // the packed form on a few words: component s = bits s..s+7, top byte 0
  for (const [s, d, t] of [[0x1F80FF40, 0x00108080, 31], [0x10208060, 0xFFFFFFFF, 7], [0x08F01020, 0x00ABCDEF, 0]]) {
    let want = 0;
    for (let k = 0; k < 24; k += 8) { const x = ((s >>> k) & 255) * t + ((d >>> k) & 255) * (31 - t) + 15; want |= ((x - x % 31) / 31) << k; }
    if (blend(s, d, t) !== want >>> 0) bad.push(`blend(0x${s.toString(16)}, 0x${d.toString(16)}, ${t}) = 0x${blend(s, d, t).toString(16)}, want 0x${want.toString(16)}`);
  }
  return { inputs: n, bad };
}

// kind 1's histogram unit (src/dev/vsc.mjs HIST1's comment) on channel 2 (the TFT's): registers by offset
export async function vscHistUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { createMachine } = await import('../src/machine.mjs');
  const { BUS } = await import('../src/core/mem.mjs');
  const V = await import('../src/dev/vsc.mjs');
  const C = 2, CH = C * V.CHAN_STRIDE;
  const R = { INTEN1: 0x00C, INTST1: 0x010, HIST1: 0x04C, DMAEN: 0x060, HIST2: 0x748, SYNC2: 0x728, BINS: 0x4000 };
  const fresh = () => {
    const v = createMachine({ rom: new Uint8Array(fs.readFileSync(IMAGE)) }).devices.vsc;
    v.dset(V.chanDbg(C, V.CH.LINE_NS), 1000);
    const reg = (off, value) => v.write(CH + off, value, 4, false), get = (off) => v.read(CH + off, 4, true);
    const frame = () => v.doorbell(0, 2 | C << 8, 4, false);
    const hist = () => ({ state: v.dbg[V.chanDbg(C, V.CH.HIST)], runs: v.dget(V.chanDbg(C, V.CH.HIST_RUNS)), irq: v.dget(V.chanDbg(C, V.CH.IRQ)) });
    const errs = () => { const n = v.dget(V.D.ERR_TOTAL), out = []; for (let k = 0; k < n; k++) out.push(v.dget(V.D.ERR_RING + 32 * k)); return out; };
    // a bin read: its value, or 'BUS' with the error code recorded
    const bin = (i) => { try { return v.read(CH + R.BINS + 4 * i, 4, false); } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
    const start = () => { try { reg(R.HIST1, 1); return 'ok'; } catch (e) { if (e === BUS) return 'BUS'; throw e; } };
    reg(R.SYNC2, 100);                                   // the channel runs: 100 lines of 1000 ns
    return { v, reg, get, frame, hist, errs, bin, start };
  };
  // a start: armed, running from the next boundary, ended (INTST1 bit 8) at the one after, also while masked
  {
    const t = fresh();
    t.reg(R.HIST2, 0x00100112);                          // the start's value (X): 128 bins, source field 0, DMAEN 0
    ok(t.start() === 'ok' && t.hist().state === 1 && !(t.get(R.INTST1) & 0x100), `armed: ${JSON.stringify(t.hist())}`);
    t.frame();
    ok(t.hist().state === 2 && !(t.get(R.INTST1) & 0x100) && t.hist().runs === 0, `running after one boundary: ${JSON.stringify(t.hist())}`);
    ok(t.bin(0) === 'BUS' && t.errs().includes(V.E.HIST_UNMODELLED), 'a bin read during a run is HIST_UNMODELLED');
    ok(t.start() === 'BUS', 'a start during a run is HIST_UNMODELLED');
    t.frame();
    ok(t.hist().state === 0 && t.hist().runs === 1 && (t.get(R.INTST1) & 0x100) && !t.hist().irq,
      `ended at the second boundary, INTST1 0x${t.get(R.INTST1).toString(16)}, no IRQ while INTEN1 bit 8 is clear: ${JSON.stringify(t.hist())}`);
    t.frame();
    ok(t.hist().runs === 1, 'one-shot: no second end without a start');
    // A-VSCHIST-2: the source plane (IMG1) was off, the written DMAEN bit 5 clear and HIST2[17:16] 0: bins read 0
    const words = Array.from({ length: 64 }, (_, i) => t.bin(i));
    ok(words.every((x) => x === 0) && t.v.dget(V.D.HIST_ZERO_READS) === 64, `the 64 bin words under A-VSCHIST-2: ${[...new Set(words)]}`);
    ok(t.bin(64) === 'BUS', 'a word past the 64 bin words is not the unit\'s');
    // A-VSCHIST-5: the same 0 where the firmware would keep them (its discard test false at the read), counted apart
    t.reg(R.DMAEN, 0x20);                                // IMG1 on at the read
    ok(t.bin(0) === 0 && t.v.dget(V.D.HIST_KEPT_READS) === 1 && t.v.dget(V.D.HIST_ZERO_READS) === 65,
      `with the written DMAEN bit 5 set the bins read 0 under A-VSCHIST-5 (kept ${t.v.dget(V.D.HIST_KEPT_READS)}, all ${t.v.dget(V.D.HIST_ZERO_READS)})`);
    t.reg(R.DMAEN, 0); t.reg(R.HIST2, 0x00110112);       // source IMG2 at the read
    ok(t.bin(0) === 0 && t.v.dget(V.D.HIST_KEPT_READS) === 2, 'with the written HIST2[17:16] not 0 too');
    ok(t.v.histRuns() === 1 && t.v.histMeasured() === 0 && t.v.histBins(C).source === false, `no run counted: ${JSON.stringify([t.v.histRuns(), t.v.histMeasured()])}`);
    // the next run: once it begins the ended run's bins are gone, and a read before its end is HIST_UNMODELLED
    t.start(); t.frame();
    ok(t.hist().state === 2 && t.v.histBins(C) === null && t.bin(0) === 'BUS',
      `a read in the next run, the last one's bins kept: ${JSON.stringify([t.hist().state, t.v.histBins(C)])}`);
  }
  // INTEN1 bit 8: the end raises the channel's IRQ, a write-1 to INTST1 bit 8 lowers it
  {
    const t = fresh();
    t.reg(R.HIST2, 0x00100112); t.reg(R.INTEN1, 0x101); t.start(); t.frame(); t.frame();
    ok(t.hist().irq === 1, `the end with INTEN1 0x101 raises the IRQ: ${JSON.stringify(t.hist())}`);
    t.reg(R.INTST1, 0x101);
    ok(t.hist().irq === 0 && !(t.get(R.INTST1) & 0x100), 'INTST1 = 0x101 acknowledges it');
  }
  // the source plane on in the latched bank of the frame measured, and nothing else of the unit or the plane
  // programmed: the bins are not known (HIST_UNMODELLED), also where the read's discard condition holds
  {
    const t = fresh();
    t.reg(R.HIST2, 0x00100112); t.reg(R.DMAEN, 0x20); t.start(); t.frame(); t.reg(R.DMAEN, 0); t.frame();
    ok(t.hist().runs === 1 && t.bin(0) === 'BUS' && t.v.histBins(C).why[0] === HIST_WHY.UNWRITTEN,
      `a run over a frame with IMG1 on and no area written leaves bins the model does not know: ${JSON.stringify(t.v.histBins(C))}`);
  }
  const h3 = await vscHistCompose(createMachine, V), hb = await vscHistBins(createMachine, V, BUS);
  return { checks: checks + h3.checks + hb.checks, bad: [...bad, ...h3.bad, ...hb.bad] };
}

// A-VSCHIST-3 (src/dev/vsccompose.mjs histForm; docs/om1-vsc-spec.md section 13): channel 2 programmed as the TFT's
// open leaves it (the window 900 x 600 at {98, 8}, the background, the A13 values, the mixing words) with one OSD1
// plane of 16 x 8 palette pixels over the background; the histogram registers at the start path's values (X, camapp
// 3: the spot area) leave the composite word for word as it is without them, with the opt-in (header ASSUMED bit 4,
// an ASSUMED note per register, the debug word HIST_ASSUMED counting the composite) and are FEATURE_UNOBSERVED
// without it; a value outside the writers' forms stays FEATURE_UNOBSERVED with the opt-in, one register at a time
async function vscHistCompose(createMachine, V) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(`A-VSCHIST-3: ${what}`); };
  const C = 2, CH = C * V.CHAN_STRIDE, A_HIST = 16, PLANE = 0xA0100000;
  const HIST = { HIST1: 0x04C, HISTAREA1: 0x474, HISTAREA2: 0x478, HISTAREA3: 0x47C, HIST2: 0x748, HIST3: 0x74C };
  // the start path's values (X: the spot area of the camapp 3 runs, docs/om1-vsc-spec.md section 13)
  const RUN = { HIST1: 1, HISTAREA1: 0x01F20064, HISTAREA2: 0x010F004B, HISTAREA3: 0x10F, HIST2: 0x00100112, HIST3: 0x004008BC };
  // the TFT open's A13 values (vsccompose.mjs FEATURES, the TFT's column) and the registers the model reads
  const OPEN = [[0x004, 0x1C0], [0x008, 1], [0x03C, 0x4000], [0x044, 0x4000], [0x428, 8], [0x580, 0x2E], [0x584, 0x2E],
    [0x588, 0x2E], [0x58C, 0x2E], [0x590, 0x30], [0x594, 0x32], [0x598, 0x2E], [0x5A0, 0x100], [0x5A8, 0x100],
    [0x5AC, 0x100], [0x5B0, 0x100], [0x5B4, 0x100], [0x720, 1 << 24], [0x728, 100], [0x420, 98 << 16 | 900],
    [0x424, 8 << 16 | 600], [0x63C, 0x0080800B], [0x61C, 8], [0x638, 0x111111], [0x4C0, 0], [0x40C, 0x111], [0x410, 0x11],
    [0x4E0, 0], [0x060, 0x04], [0x450, (98 + 8) << 16 | 16], [0x454, (8 + 4) << 16 | 8], [0x39C, PLANE >>> 4], [0x3B4, 8],
    [0x3CC, 8], [0x62C, 0x100], [0x534, 0], [0x4D0, 0x10F]];
  const fresh = () => {
    const v = createMachine({ rom: new Uint8Array(fs.readFileSync(IMAGE)) }).devices.vsc;
    v.dset(V.chanDbg(C, V.CH.LINE_NS), 1000);
    const reg = (off, value) => v.write(CH + off, value, 4, false);
    for (const [off, value] of OPEN) reg(off, value);
    reg(0x4400 + 4 * 5, 0x1F2A3B4C);                     // OSD1's palette (OSDCP2 bit 0 clear: +0x4400), entry 5 opaque
    v.bus.write(PLANE, new Uint8Array(128 * 8).fill(5));  // 8 rows of 16 pixels of index 5 at a stride of 128
    const bell = (cmd) => { v.doorbell(0, cmd | C << 8, 4, false); return v.dget(V.D.LAST_RESULT); };
    // the composite of the bank latched at the next boundary: status, errors' offsets, notes, header, pixels
    const compose = () => {
      bell(4); bell(2);
      const status = bell(3), h = (i) => v.dget(V.D.HDR + 4 * i), errs = [], notes = [];
      for (let k = 0; k < v.dget(V.D.ERR_TOTAL); k++) errs.push([v.dget(V.D.ERR_RING + 32 * k), v.dget(V.D.ERR_RING + 32 * k + 12)]);
      for (let k = 0; k < v.dget(V.D.NOTE_TOTAL); k++) notes.push([v.dget(V.D.NOTE_RING + 16 * k), v.dget(V.D.NOTE_RING + 16 * k + 8) & 0xFFFF]);
      const words = Array.from(v.out.subarray(0, h(1) * h(2)));
      return { status, errs, notes, assumed: h(14), drawn: h(7), words, counted: v.dget(V.D.HIST_ASSUMED) };
    };
    return { v, reg, compose, assume: (on) => { v.dbg[V.chanDbg(C, V.CH.ASSUME)] = on ? A_HIST : 0; } };
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const t = fresh();
  const base = t.compose();
  ok(base.status === 0 && base.drawn === 8 && base.words[(4 + 2) * 900 + 8 + 3] === 0x2A3B4C && base.words[0] === 0x0080800B,
    `the baseline composite: status ${base.status}, drawn ${base.drawn}, ${JSON.stringify(base.errs)}`);
  for (const [n, x] of Object.entries(RUN)) t.reg(HIST[n], x);
  const off = t.compose(), offs = off.errs.filter(([e]) => e === V.E.FEATURE_UNOBSERVED).map(([, o]) => o).sort((a, b) => a - b);
  ok(off.status === V.E.FEATURE_UNOBSERVED && same(offs, Object.values(HIST).sort((a, b) => a - b)) && off.counted === 0,
    `without the opt-in each of the six is FEATURE_UNOBSERVED: status ${off.status}, ${offs.map((o) => o.toString(16))}`);
  t.assume(true);
  const on = t.compose(), noted = on.notes.filter(([k]) => k === V.NOTE.ASSUMED).map(([, o]) => o).sort((a, b) => a - b);
  ok(on.status === 0 && !on.errs.length && same(on.words, base.words) && on.assumed === A_HIST && on.counted === 1
    && same(noted, Object.values(HIST).sort((a, b) => a - b)),
  `with it the composite equals the baseline (status ${on.status}, errors ${JSON.stringify(on.errs)}, ASSUMED 0x${on.assumed.toString(16)}, notes ${noted.map((o) => o.toString(16))}, counted ${on.counted})`);
  t.reg(HIST.HIST1, 0); t.reg(HIST.HIST3, 0xFFFFFFFF);  // the set-up's HIST1 & ~0xf; HIST3 any
  ok(t.compose().status === 0, 'HIST1 0 and HIST3 0xffffffff are inside the forms');
  t.reg(HIST.HIST2, 0x03100110);                        // playback's B run (X): component 3, 32 bins
  ok(t.compose().status === 0, 'HIST2 with the component field (0x501e1488) is inside the forms');
  // outside the forms, one register at a time (from the run's values)
  const outside = [['HIST1', 2], ['HIST2', 0x00000112], ['HIST2', 0x00130112], ['HIST2', 0x04100112], ['HIST2', 0x00101112],
    ['HIST2', 0x00100212], ['HISTAREA1', 0x03840064], ['HISTAREA1', 0x00500064], ['HISTAREA1', 0x01F20000],
    ['HISTAREA2', 0x0250004B], ['HISTAREA2', 0x010F0000], ['HISTAREA3', 0x110]];
  for (const [n, x] of outside) {
    const u = fresh();
    for (const [m, y] of Object.entries(RUN)) u.reg(HIST[m], m === n ? x : y);
    if (n === 'HISTAREA2') u.reg(HIST.HISTAREA3, x >>> 16);   // HISTAREA3 follows its y, as the set-up writes it
    u.assume(true);
    const c = u.compose(), e = c.errs.filter(([k]) => k === V.E.FEATURE_UNOBSERVED).map(([, o]) => o);
    ok(c.status === V.E.FEATURE_UNOBSERVED && same(e, [HIST[n]]), `${n} 0x${x.toString(16)} stays FEATURE_UNOBSERVED (${c.status}, ${e.map((o) => o.toString(16))})`);
  }
  // HISTAREA3 without HISTAREA2 written: not the set-up's form (it writes both)
  const u = fresh();
  u.reg(HIST.HISTAREA3, 0x10F); u.assume(true);
  ok(u.compose().status === V.E.FEATURE_UNOBSERVED, 'HISTAREA3 alone stays FEATURE_UNOBSERVED');
  return { checks, bad };
}

// The histogram unit's bins against histograms computed by hand (src/dev/vsccompose.mjs histMeasure, A-VSCHIST-4 and
// A-VSCHIST-6; docs/om1-vsc-spec.md section 13). Channel 2 with the TFT's window (900 x 600 at {98, 8}) and IMG1 a
// 16 x 8 plane at {4, 2} of the window, YC 4:2:2 at PLANE, one output pixel per source pixel; each case is a run
// (start, the boundary that begins it, the boundary that ends it) and a read of the bin words.
//   the picture: column x has Y PICTURE_Y[x] in rows 2..5 and 200 elsewhere, Cb 0x10 and Cr 0xF0 everywhere; the
//   area is columns 4..11 of rows 2..5 (32 pixels): Y 0, 1 (bin 0 of 128), 2, 3, 3 (bin 1), 255, 254 (bin 127) and
//   100 (bin 50), four rows each, and none of the 200s (bin 100)
const PICTURE_Y = [200, 200, 200, 200, 0, 1, 2, 3, 3, 255, 254, 100, 200, 200, 200, 200];
async function vscHistBins(createMachine, V, BUS) {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(`bins: ${what}`); };
  const C = 2, CH = C * V.CHAN_STRIDE, PLANE = 0xA0100000, PLANE2 = 0xA0110000, STRIDE = 128;
  const R = { HIST1: 0x04C, DMAEN: 0x060, HISTAREA1: 0x474, HISTAREA2: 0x478, HISTAREA3: 0x47C, HIST2: 0x748, HIST3: 0x74C,
    BINS: 0x4000, IMG1RSZ1: 0x4F0, IMG_FMT: 0x400 };
  // the window, progressive scan, and IMG1 (area, address >> 4, line and burst words of 128 bytes, format 0, PLANC
  // 0x100, no resize); IMG2 the same rectangle at PLANE2 (with its brightness word, which the compositor asks of it)
  const BASE = [[0x720, 1 << 24], [0x728, 100], [0x420, 98 << 16 | 900], [0x424, 8 << 16 | 600], [0x060, 0x20],
    [0x42C, (98 + 4) << 16 | 16], [0x430, (8 + 2) << 16 | 8], [0x390, PLANE >>> 4], [0x3A8, 8], [0x3C0, 8], [0x400, 0],
    [0x620, 0x100], [0x4F0, 0],
    [0x438, (98 + 4) << 16 | 16], [0x43C, (8 + 2) << 16 | 8], [0x394, PLANE2 >>> 4], [0x3AC, 8], [0x3C4, 8], [0x404, 0],
    [0x624, 0x100], [0x504, 0], [0x4C4, 0x10F]];
  const AREA = [[R.HISTAREA1, (98 + 4 + 4) << 16 | 8], [R.HISTAREA2, (8 + 2 + 2) << 16 | 4], [R.HISTAREA3, 8 + 2 + 2]];
  const WHOLE = [[R.HISTAREA1, (98 + 4) << 16 | 16], [R.HISTAREA2, (8 + 2) << 16 | 8], [R.HISTAREA3, 8 + 2]];
  // rows of YC 4:2:2 (Y0 Cb Y1 Cr) from a function of the pixel
  const picture = (v, at, rows, cols, y, cb = 0x10, cr = 0xF0) => {
    const b = new Uint8Array(STRIDE * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { b[STRIDE * j + 2 * i] = y(i, j); b[STRIDE * j + 2 * i + 1] = i & 1 ? cr : cb; }
    v.bus.write(at, b);
  };
  const pictureY = (i, j) => (j >= 2 && j <= 5 ? PICTURE_Y[i] : 200);
  const fresh = (regs = []) => {
    const v = createMachine({ rom: new Uint8Array(fs.readFileSync(IMAGE)) }).devices.vsc;
    v.dset(V.chanDbg(C, V.CH.LINE_NS), 1000);
    const reg = (off, value) => v.write(CH + off, value, 4, false);
    for (const [off, value] of [...BASE, ...regs]) reg(off, value);
    picture(v, PLANE, 8, 16, pictureY);
    const frame = () => v.doorbell(0, 2 | C << 8, 4, false);
    const run = () => { reg(R.HIST1, 0); reg(R.HIST1, 1); frame(); frame(); };
    // the bin words 0 .. n - 1, 'BUS' for a refused one; the bins they hold, the low half first
    const words = (n) => Array.from({ length: n }, (_, i) => { try { return v.read(CH + R.BINS + 4 * i, 4, false); } catch (e) { if (e === BUS) return 'BUS'; throw e; } });
    const bins = (n) => words(n / 2).flatMap((w) => [w & 0xFFFF, w >>> 16]);
    const lastError = () => { const k = v.dget(V.D.ERR_TOTAL) - 1, o = V.D.ERR_RING + 32 * (k % V.D.ERR_SLOTS); return [0, 3, 4, 5, 6, 7].map((i) => v.dget(o + 4 * i)); };
    return { v, reg, frame, run, words, bins, lastError };
  };
  // the bins that are not 0, as 'bin:value' in order
  const nz = (b) => b.map((x, i) => [i, x]).filter(([, x]) => x).map(([i, x]) => `${i}:${x}`).join(' ');
  // 128 bins, counts as they are (no scale, no clip): the area's 32 pixels by hand, two bins a word, low half first
  {
    const t = fresh([...AREA, [R.HIST2, 0x00100002]]);
    t.run();
    const w = t.words(64), b = t.bins(128);
    ok(nz(b) === '0:8 1:12 50:4 127:8' && w[0] === (12 << 16 | 8) && w[25] === 4 && w[63] === 8 << 16 >>> 0,
      `128 bins of the area: ${nz(b)} (want 0:8 1:12 50:4 127:8), words 0, 25, 63 ${[w[0], w[25], w[63]].map((x) => x.toString(16))}`);
    ok(t.v.histMeasured() === 1 && t.v.histColour() === 0 && t.v.dget(V.D.HIST_ZERO_READS) === 0 && t.v.dget(V.D.ERR_TOTAL) === 0,
      `one run counted, no error and no A-VSCHIST-2 read: ${[t.v.histMeasured(), t.v.dget(V.D.HIST_ZERO_READS), t.v.dget(V.D.ERR_TOTAL)]}`);
  }
  // 64 bins (code 1) and 32 (code 0): the same pixels in wider bins; a word past the run's bins is refused
  {
    const t = fresh([...AREA, [R.HIST2, 0x00100001]]);
    t.run();
    const w = t.words(33);
    ok(nz(t.bins(64)) === '0:20 25:4 63:8' && w[32] === 'BUS' && JSON.stringify(t.lastError()) === JSON.stringify([V.E.HIST_UNMODELLED, R.BINS + 4 * 32, 2, 32, 64, 0]),
      `64 bins: ${nz(t.bins(64))} (want 0:20 25:4 63:8); word 32 ${w[32]}, ${JSON.stringify(t.lastError())}`);
    const u = fresh([...AREA, [R.HIST2, 0x00100000]]);
    u.run();
    const x = u.words(17);
    ok(nz(u.bins(32)) === '0:20 12:4 31:8' && x[6] === 4 && x[15] === 8 << 16 >>> 0 && x[16] === 'BUS',
      `32 bins: ${nz(u.bins(32))} (want 0:20 12:4 31:8); words 6, 15, 16 ${[x[6], x[15], x[16]]}`);
  }
  // the scale and the clip over the whole plane (128 pixels: the area's 32 and 96 of Y 200, bin 100): each bin
  // count * HIST3[15:0] >> 17, here count / 8 rounded down, then at most HIST3[31:16]
  {
    const t = fresh([...WHOLE, [R.HIST2, 0x00100002]]);
    t.run();
    ok(nz(t.bins(128)) === '0:8 1:12 50:4 100:96 127:8', `the whole plane's counts: ${nz(t.bins(128))}`);
    const u = fresh([...WHOLE, [R.HIST2, 0x00100102], [R.HIST3, 0x4000]]);
    u.run();
    ok(nz(u.bins(128)) === '0:1 1:1 100:12 127:1', `scaled by 0x4000 / 2^17: ${nz(u.bins(128))} (want 0:1 1:1 100:12 127:1)`);
    const c = fresh([...WHOLE, [R.HIST2, 0x00100112], [R.HIST3, 5 << 16 | 0x4000]]);
    c.run();
    ok(nz(c.bins(128)) === '0:1 1:1 100:5 127:1', `and clipped to 5: ${nz(c.bins(128))} (want 0:1 1:1 100:5 127:1)`);
    const r = fresh([...WHOLE, [R.HIST2, 0x00100012], [R.HIST3, 10 << 16]]);
    r.run();
    ok(nz(r.bins(128)) === '0:8 1:10 50:4 100:10 127:8', `the clip alone, 10: ${nz(r.bins(128))}`);
  }
  // the firmware's scale for an area (0x501d6d24..4b: s = N << 16 / (w * h), HIST3[15:0] = 2 s): a 48 x 24 area of a
  // 64 x 32 plane, N 128 (playback's 256 << 15): s = 8388608 / 1152 = 7281, the left half Y 40 (bin 5 of 32), the
  // right half Y 200 (bin 25), 576 pixels each: 576 * 14562 >> 17 = 63 each, so the bins sum to 126 of N = 128
  {
    const s = Math.floor((128 * 65536) / (48 * 24));
    const t = fresh([[0x42C, (98 + 4) << 16 | 64], [0x430, (8 + 2) << 16 | 32], [R.HISTAREA1, (98 + 4 + 8) << 16 | 48],
      [R.HISTAREA2, (8 + 2 + 4) << 16 | 24], [R.HISTAREA3, 8 + 2 + 4], [R.HIST2, 0x00100100], [R.HIST3, 2 * s]]);
    picture(t.v, PLANE, 32, 64, (i) => (i < 32 ? 40 : 200));
    t.run();
    ok(s === 7281 && nz(t.bins(32)) === '5:63 25:63', `the firmware's scale ${s} for 48 x 24 and N 128: ${nz(t.bins(32))} (want 5:63 25:63)`);
    t.reg(R.HIST2, 0x00100110); t.reg(R.HIST3, (32 << 16 | 2 * s) >>> 0);
    t.run();
    ok(nz(t.bins(32)) === '5:32 25:32', `with playback's clip of 32: ${nz(t.bins(32))}`);
  }
  // the pixels counted are the plane's output pixels: IMG1 resized to twice its width (IMG1RSZ1 bit 0, the step
  // 2048 / 4096), source Y 16 k in column k: output column i has Y 8 i (the two-tap mean on odd i), bin 4 i, 8 rows
  // each
  {
    const t = fresh([...WHOLE, [R.HIST2, 0x00100002], [R.IMG1RSZ1, 1], [R.IMG1RSZ1 + 4, 2048]]);
    picture(t.v, PLANE, 8, 16, (i) => 16 * i);
    t.run();
    const want = Array.from({ length: 16 }, (_, i) => `${4 * i}:8`).join(' ');
    ok(nz(t.bins(128)) === want, `the resized plane's output pixels: ${nz(t.bins(128))} (want ${want})`);
  }
  // the component HIST2[25:24] (A-VSCHIST-6): a plane of Y 100, Cb 96, Cr 176 is R 167, G 77, B 43 by A9's integers
  // (100 + (91881 * 48 + 32768 >> 16), 100 + (-22554 * -32 - 46802 * 48 + 32768 >> 16), 100 + (116130 * -32 + 32768
  // >> 16)): bins 50, 83, 38 and 21 of 128; the conversion clamps, and equals the lab's PNG conversion
  {
    const got = [];
    for (let comp = 0; comp < 4; comp++) {
      const t = fresh([...AREA, [R.HIST2, (0x00100002 | comp << 24) >>> 0]]);
      picture(t.v, PLANE, 8, 16, () => 100, 96, 176);
      t.run();
      got.push(nz(t.bins(128)));
      if (comp === 3) ok(t.v.histColour() === 1, `the B run counts as a colour run: ${t.v.histColour()}`);
    }
    ok(got.join(', ') === '50:32, 83:32, 38:32, 21:32', `Y, R, G, B of {100, 96, 176}: ${got.join(', ')} (want 50:32, 83:32, 38:32, 21:32)`);
    const { ycc_to_rgb } = await import('../src/lab/display.mjs');
    let differ = 0;
    for (let w = 0; w < 1 << 24; w += 4099) { const rgb = ycc_to_rgb(w); for (let k = 0; k < 3; k++) if (histComponent(w, k + 1) !== rgb[k]) differ++; if (histComponent(w, 0) !== (w & 0xFF)) differ++; }
    ok(differ === 0 && histComponent(0xFF80FA, 1) === 255 && histComponent(0x800005, 3) === 0,
      `histComponent equals A9's ycc_to_rgb on 4,093 words (${differ} differ) and clamps (${histComponent(0xFF80FA, 1)}, ${histComponent(0x800005, 3)})`);
  }
  // the source plane HIST2[17:16]: IMG2 (1) with another picture, both planes on
  {
    const t = fresh([...AREA, [R.DMAEN, 0x30], [R.HIST2, 0x00110002]]);
    picture(t.v, PLANE2, 8, 16, () => 64);
    t.run();
    ok(nz(t.bins(128)) === '32:32', `source 1 counts IMG2's pixels: ${nz(t.bins(128))} (want 32:32)`);
    t.reg(R.HIST2, 0x00100002);
    t.run();
    ok(nz(t.bins(128)) === '0:8 1:12 50:4 127:8', `source 0 IMG1's: ${nz(t.bins(128))}`);
  }
  // the source's own DMAEN bit (5 - source): IMG2 off with IMG1 on is no source, its bins 0; IMG2 on alone counted
  {
    const t = fresh([...AREA, [R.HIST2, 0x00110002]]);
    picture(t.v, PLANE2, 8, 16, () => 64);
    t.run();
    const off = t.v.histBins(C), zero = t.words(64).every((x) => x === 0);
    t.reg(R.DMAEN, 0x10);
    t.run();
    ok(off?.source === false && zero && nz(t.bins(128)) === '32:32' && t.v.histMeasured() === 1,
      `IMG2 the source: with DMAEN 0x20 none (${JSON.stringify(off?.source)}, its bins 0 ${zero}), with 0x10 ${nz(t.bins(128))} (want 32:32)`);
  }
  // the frame measured: the bank latched when the run began and the rows memory holds at its end; a picture and an
  // area written after the end do not change the bins read
  {
    const t = fresh([...AREA, [R.HIST2, 0x00100002]]);
    t.reg(R.HIST1, 1); t.frame();
    t.reg(R.HISTAREA1, (98 + 4) << 16 | 16);              // written during the frame: latched at its end, too late
    picture(t.v, PLANE, 8, 16, (i, j) => (j >= 2 && j <= 5 ? 2 * PICTURE_Y[i] & 0xFF : 200));
    t.frame();
    picture(t.v, PLANE, 8, 16, () => 9);
    // 2 * {0, 1, 2, 3, 3, 255, 254, 100} & 0xff = {0, 2, 4, 6, 6, 254, 252, 200}: bins 0, 1, 2, 3, 3, 127, 126, 100
    ok(nz(t.bins(128)) === '0:4 1:4 2:4 3:8 100:4 126:4 127:4', `the rows at the run's end over the area latched at its start: ${nz(t.bins(128))}`);
  }
  // what the model cannot count stays unknown: the read is HIST_UNMODELLED (value 1) with the reason
  {
    const cases = [
      ['an area outside the plane', [[R.HISTAREA1, (98 + 4 + 12) << 16 | 8], [R.HISTAREA2, (8 + 2 + 2) << 16 | 4], [R.HISTAREA3, 12], [R.HIST2, 0x00100002]], HIST_WHY.AREA],
      ['HISTAREA3 not HISTAREA2\'s y', [...AREA, [R.HISTAREA3, 13], [R.HIST2, 0x00100002]], HIST_WHY.FORM],
      ['256 bins (code 3)', [...AREA, [R.HIST2, 0x00100003]], HIST_WHY.FORM],
      ['two-field scan (HIST2 bit 12)', [...AREA, [R.HIST2, 0x00101002]], HIST_WHY.FORM],
      ['HIST2 without bit 20', [...AREA, [R.HIST2, 0x00000002]], HIST_WHY.FORM],
      ['the scale bit with HIST3 never written', [...AREA, [R.HIST2, 0x00100102]], HIST_WHY.UNWRITTEN],
      ['a plane of format 2', [...AREA, [R.HIST2, 0x00100002], [R.IMG_FMT, 2]], HIST_WHY.PLANE],
      ['a count above 16 bits', [[0x42C, (98 + 4) << 16 | 512], [0x430, (8 + 2) << 16 | 256], [0x3C0, 0x48], [R.HISTAREA1, (98 + 4) << 16 | 512],
        [R.HISTAREA2, (8 + 2) << 16 | 256], [R.HISTAREA3, 10], [R.HIST2, 0x00100002]], HIST_WHY.OVERFLOW]];
    for (const [name, regs, why] of cases) {
      const t = fresh(regs);
      if (why === HIST_WHY.OVERFLOW) t.v.bus.write(PLANE, new Uint8Array(1024 * 256).fill(0x80));    // 512 x 256 of one value
      t.run();
      const w = t.words(1), e = t.lastError();
      ok(w[0] === 'BUS' && e[0] === V.E.HIST_UNMODELLED && e[2] === 1 && e[3] === why && t.v.histMeasured() === 0,
        `${name}: the bins are not known (${w[0]}, error ${JSON.stringify(e)}, want reason ${why})`);
    }
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hu = await vscHistUnits();
  console.log(`vsc histogram unit: ${hu.checks - hu.bad.length}/${hu.checks}`);
  hu.bad.forEach((x) => console.log('  ', x));
  const h = vscRegsHeader(), b = blendTable(), vc = vscClasses();
  console.log(`vsc register tables vs om1-vsc-regs.h: ${h.tables.join(' + ')} entries, ${h.bad.length ? 'DIFFERENT' : 'identical'}`);
  console.log(`blend table: ${b.inputs - b.bad.length}/${b.inputs}`);
  console.log(`vsc-classes (the JS register classes vs om1-vsc.c): ${vc.names - vc.bad.length}/${vc.names}`);
  [...h.bad, ...b.bad, ...vc.bad.slice(0, 10)].forEach((x) => console.log('  ', x));
  process.exit(h.bad.length + b.bad.length + vc.bad.length + hu.bad.length ? 1 : 0);
}
