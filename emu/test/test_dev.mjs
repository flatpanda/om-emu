// The VSC device's tables, without firmware traces: the register tables read from the image equal the committed
// header checks/fixtures/om1-vsc-regs.h, the JS register classes equal check_display's parse of the class
// tables (checks/fixtures/om1-vsc-tables.c), and the blend table equals the blend() formula below on all
// 32 x 256 x 256 inputs. vscHistUnits: kind 1's histogram unit on a machine with E143's image, driven through the
// device's own register writes and doorbell (docs/om1-vsc-spec.md section 13): a start ends at the second boundary
// (A-VSCHIST-1) with INTST1 bit 8 and, with INTEN1 bit 8, the channel's IRQ; its bins read 0 only under A-VSCHIST-2,
// any other bin read and a start during a run are HIST_UNMODELLED and a bus error; its registers in a composite under
// the A-VSCHIST-3 opt-in (vscHistCompose).
//   node emu/test/test_dev.mjs
import fs from 'node:fs';
import path from 'node:path';
import { vscTables } from '../src/dev/vscregs.mjs';
import { blendLut, blend, registerClass } from '../src/dev/vsccompose.mjs';
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
    t.reg(R.DMAEN, 0x20);                                // IMG1 on at the read: the firmware would keep them
    ok(t.bin(0) === 'BUS', 'with the written DMAEN bit 5 set the bins are HIST_UNMODELLED');
    t.reg(R.DMAEN, 0); t.reg(R.HIST2, 0x00110112);       // source IMG2 at the read
    ok(t.bin(0) === 'BUS', 'with the written HIST2[17:16] not 0 the bins are HIST_UNMODELLED');
  }
  // INTEN1 bit 8: the end raises the channel's IRQ, a write-1 to INTST1 bit 8 lowers it
  {
    const t = fresh();
    t.reg(R.HIST2, 0x00100112); t.reg(R.INTEN1, 0x101); t.start(); t.frame(); t.frame();
    ok(t.hist().irq === 1, `the end with INTEN1 0x101 raises the IRQ: ${JSON.stringify(t.hist())}`);
    t.reg(R.INTST1, 0x101);
    ok(t.hist().irq === 0 && !(t.get(R.INTST1) & 0x100), 'INTST1 = 0x101 acknowledges it');
  }
  // the source plane on in the latched bank of the frame measured: the bins are HIST_UNMODELLED even if the read's
  // condition holds
  {
    const t = fresh();
    t.reg(R.HIST2, 0x00100112); t.reg(R.DMAEN, 0x20); t.start(); t.frame(); t.reg(R.DMAEN, 0); t.frame();
    ok(t.hist().runs === 1 && t.bin(0) === 'BUS', 'a run over a frame with IMG1 on leaves bins the model does not know');
  }
  const h3 = await vscHistCompose(createMachine, V);
  return { checks: checks + h3.checks, bad: [...bad, ...h3.bad] };
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
  // outside the forms, one register at a time (from the run's values)
  const outside = [['HIST1', 2], ['HIST2', 0x00000112], ['HIST2', 0x00130112], ['HIST2', 0x01100112], ['HIST2', 0x00101112],
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
