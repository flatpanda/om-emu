#!/usr/bin/env node
// The live-view checks: M7's live view through the firmware's own API (the TH API 0x501c3f4d, the
// bus window 0x50036da4, the live-view banks) on the JS lab, checked against the register formulas and the CMM table
// readers of refs/liveview.mjs and, for composites, check_display's reference(). Groups G1..G8 with their report lines;
// every assert is a predicate of checks/lib/pred.mjs. Pinned observations compare with checks/fixtures/check_liveview_notes.txt;
// --write-notes writes them to OM_NOTES_DIR (refused without it). PNGs go to OM_CHECK_OUT.
//   node emu/checks/check_liveview.mjs [--seed N] [--write-notes | --only G3,G5] [--kernel native|none]
import fs from 'node:fs';
import path from 'node:path';
import { REPO, FIXTURES, labEnv, loadImage, runMain, SystemExit } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { newRandom } from './lib/rngtape.mjs';
import { pred, fault } from './lib/pred.mjs';
import { write_png } from './lib/png.mjs';
import * as CD from './check_display.mjs';
import * as D from '../src/lab/display.mjs';
import { OSD_DEFAULTS } from '../src/lab/osd.mjs';
import { FirmwareError } from '../src/lab/errors.mjs';
import { reg, regValue } from './lib/errors.mjs';
import { AssertionError } from '../src/lab/errors.mjs';
import { deepEqual } from '../src/util/equal.mjs';
import { show, asText } from '../src/util/show.mjs';
import { pack } from '../src/util/bytes.mjs';
import { hex } from '../src/util/hex.mjs';
import * as LV from '../refs/liveview.mjs';

const NOTES_FILE = path.join(FIXTURES, 'check_liveview_notes.txt');
const OUT = process.env.OM_CHECK_OUT ? path.resolve(process.env.OM_CHECK_OUT) : path.join(REPO, 'emu/out/checks/js/manual');
const RUNTIME = LV.RUNTIME, STORE = CD.STORE, LOAD = CD.LOAD, PANEL = CD.PANEL, LV_W = LV.LV_W, LV_H = LV.LV_H;
const FORMULA_REGS = new Set(['CTRL2', 'CTRL3', 'DMAEN', 'IMG1DMASADR', 'IMG1DMALD', 'IMG1DMABN', 'IMGDMASPOS', 'IMG1FMT',
  'IMG1AREA1', 'IMG1AREA2', 'IMG1RSZ1', 'IMG1RSZ2', 'IMG1RSZ4']);
const NOTES = [];
const EVF_GATE = 0xA32DB3B0, DRAW_NORA_WORD = 0xA32DB3F0, GEN_WRITE = 0x501E2CE6, CTRL_OR = 0x501E04B7;
const OPEN_CTRL = [[1, 0x400, 0x501D9E8F], [1, 0x140, 0x501D9E9C], [1, 0xC00, 0x501D9EC3], [1, 0x20, 0x501D9ECF],
  [2, 0x20, 0x501D9EDB], [1, 0x1C0, 0x501D9EE8], [2, 6, 0x501D9F3D], [2, 8, 0x501D9F49], [2, 1, 0x501D9F55]];
const CLOSE_CTRL3 = [2, 0x400, 0x501DA0D4];
const CMD5_IMG1 = LV.CMD5_IMG1;
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const hx = (v) => (regValue(v) >>> 0).toString(16);           // f'{v:x}'
const env = () => labEnv();
const withLab = (lab, fn) => { try { return fn(lab); } finally { lab.close(); } };
function check(cond, what = null) {
  if (!pred(!!cond, 2)) { const w = typeof what === 'function' ? what() : what; throw new AssertionError(w === null ? '' : asText(w)); }
}
const note = (key, value) => NOTES.push([key, asText(value)]);
const sortStr = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const wordsEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

// ----------------------------------------------------------------------------------- helpers
const bank_names = (lab, c, mirror = false) => new Map([...lab.vsc.bank(c, mirror)].map(([k, v]) => [k.trim(), v]));
const img0 = (lab, c) => lab.sim.u32(D.IMG_STATE + 3112 * c);
const errnames = (comp) => comp.errors.map((e) => e.name);
function session(device, gui = true) {
  const lab = new D.DisplayLab(env());
  try {
    lab.verify_lv_banks();
    lab.start(); lab.set_gui_buffers(); lab.open(device); lab.palettes();
    if (gui) D.demo_gui(lab);
    lab.update();
    return lab;
  } catch (e) { lab.close(); throw e; }
}
function scaled_request(device, address, crop = D.LV_SCALED_CROP) {
  const [src, dst, at] = D.LV_SCALED[device];
  return D.ThRequest.scaled(D.DEVICE[device].mask, address, crop, src, dst, at);
}
const mapDiff = (a, b) => { const out = new Map(); for (const [k, v] of b) if (a.get(k) !== v) out.set(k, [a.get(k), v]); return out; };

// ----------------------------------------------------------------------------------- G1
function g1_bus(lab) {
  let n = 0;
  const rows = lab.verify_lv_banks();
  n += 1;
  const probes = [];
  for (const [, [base, size, count]] of D.LV_BANKS) probes.push(base, base + count * size - 2);
  probes.push(0x98000000, 0xEFFFFFFF, 0xF0000000);
  for (const a of probes) {
    const cpu = lab.call(D.BUS_WINDOW, { d0: a }).d0 >>> 0;
    const reg = lab.sim.u32(D.BUS_WINDOW_REG);
    check(cpu === ((0xB8000000 | (a & 0x07FFFFFF)) >>> 0), () => [hex(a), hex(cpu)]);
    check(reg === ((0x00161514 | Math.floor(a / 2 ** 27) << 24) >>> 0), () => [hex(a), hex(reg)]);
    lab.call(D.BUS_RESTORE, null, null, [0, 0]);
    check(lab.sim.u32(D.BUS_WINDOW_REG) === 0x17161514);
    n += 3;
  }
  for (const view of [0xA0000000, 0xA8000000, 0xB0000000]) {
    const a = view + 0x00321000;
    const saved = lab.sim.read(a, 64);
    const pattern = Uint8Array.from({ length: 64 }, (_, i) => Math.floor((i * 37 + view) / 2 ** 24) & 255);   // i * 37 + view >> 24, + binding first
    lab.sim.write(a, pattern);
    const cpu = lab.bus_map(a);
    check((lab.sim.u32(D.BUS_WINDOW_REG) >>> 24) === Math.floor(a / 2 ** 27) && wordsEq(lab.sim.read(cpu, 64), pattern), () => hex(a));
    lab.bus_unmap();
    lab.sim.write(a, saved);
    n += 1;
  }
  const alias = (0xA0000000 | (0x98D4D800 & 0x07FFFFFF)) >>> 0;
  const before = lab.sim.read(alias, 256);
  const pattern = Uint8Array.from({ length: 256 }, (_, i) => i);
  lab.bus_write(0x98D4D800, pattern);
  check(wordsEq(lab.bus_read(0x98D4D800, 256), pattern) && wordsEq(lab.sim.read(alias, 256), before));
  lab.bus_write(0x98D4D800, new Uint8Array(256));
  n += 1;
  check(lab.sim.u32(D.BUS_WINDOW_REG) === 0x17161514);
  check(CD.cpu(lab, LOAD, 0xB8000000).fault === 2);
  try {
    lab.sim.read(0xB8000000, 4);
    throw new AssertionError('debugger read of an unbacked window segment succeeded');
  } catch (e) { if (e?.name !== 'RuntimeError') throw e; }
  check(CD.cpu(lab, STORE, 0x9810005C, 0x17161514).fault === 2);
  check(CD.cpu(lab, STORE, D.BUS_WINDOW_REG, 0x13161515).fault === 2);
  check(lab.sim.u32(D.BUS_WINDOW_REG) === 0x17161514);
  check(CD.cpu(lab, STORE, 0x9810004C, 0).fault === 2);
  if (fault('liveview-winreg')) CD.cpu(lab, STORE, D.BUS_WINDOW_REG, 0x14161514);   // JS-only fault point (pred.mjs)
  check(CD.cpu(lab, LOAD, 0x98100058).d0 === 0x17161514);
  n += 6;
  return [n, rows];
}

// ----------------------------------------------------------------------------------- G2
function g2_dma_map(seed) {
  const [lab, record] = CD.flow('tft', seed, { gui: 'random', out: OUT });
  return withLab(lab, () => {
    const out = ['M3 TFT flow (check_display.flow, level-3 attach in bus DRAM): ' + record.compare];
    for (const [bus, why] of [[0x90000000, 'unbacked bus'], [0x6D300000, 'cached alias of the IMG region']]) {
      lab.step(`IMG1DMASADR -> ${h8(bus)} (0x501e20c6)`, () => lab.call(D.IMG_ADDRESS, { d0: 2, d1: bus, a0: 0, a1: 0 }));
      const comp = lab.compose('tft');
      check(deepEqual(errnames(comp), ['DMA_RANGE']) && !CD.drawn_planes(comp).includes('IMG1'), () => [why, errnames(comp)]);
      out.push(`${h8(bus)} (${why}) -> DMA_RANGE, IMG1 skipped`);
    }
    const address = lab.load_lv_frame(D.test_card(), 0x0A, 1, [0, 0]);
    lab.attach_img('tft', D.ASPECTS.get('3,2'));
    check(lab.vsc.bank(2).get('IMG1DMASADR') === Math.floor(address / 16));
    const comp = lab.compose('tft');
    check(comp.status === 'NONE' && !comp.errors.length, () => errnames(comp));
    out.push(`bank 0x0a element 1 (bus ${h8(address)}), level-3 geometry: ` + CD.compare(lab, 'tft', comp, 'bus frame', true));
    out.push(img1_traced(lab, 'tft', comp, lab.img));
    return out;
  });
}

// IMG1 pixels come from the injected frame: flipping bytes inside the frame rows changes the reference output only
// inside IMG1's area; flipping bytes of the rows just past the frame's last fetched row changes nothing.
function img1_traced(lab, device, comp, frame, assume = []) {
  const c = D.DEVICE[device].channel, dump = lab.dump(device), order = lab.vsc.channel(c).order, m = dump.mirror;
  const fetch = new CD.Dram(lab.sim, lab);
  try {
    const lo = frame.base, hi = frame.base + frame.height * frame.stride;
    const flipped = (start, end) => (address, n) => {
      const data = fetch.fetch(address, n);
      if (address < end && address + n > start) return Uint8Array.from(data, (b, i) => (start <= address + i && address + i < end ? b ^ 0x40 : b));
      return data;
    };
    const ref = CD.reference(c, m, dump.palette, dump.palette_written, fetch.fn, order, null, assume)[2];
    const [width, , alt] = CD.reference(c, m, dump.palette, dump.palette_written, flipped(lo, hi), order, null, assume);
    const past = CD.reference(c, m, dump.palette, dump.palette_written, flipped(hi, hi + 8 * frame.stride), order, null, assume)[2];
    check(wordsEq(past, ref), 'IMG1 fetched bytes past the frame');
    const a1 = m.get('IMG1AREA1'), a2 = m.get('IMG1AREA2'), va1 = m.get('VIDEOAREA1'), va2 = m.get('VIDEOAREA2');
    const x0 = (a1 >>> 16) - (va1 >>> 16), y0 = (a2 >>> 16) - (va2 >>> 16), x1 = x0 + (a1 & 0xFFFF), y1 = y0 + (a2 & 0xFFFF);
    let n = 0, inside = true;
    for (let i = 0; i < ref.length; i++) {
      if (alt[i] !== ref[i]) {
        n++;
        const x = i % width, y = Math.floor(i / width);
        if (!(x0 <= x && x < x1 && y0 <= y && y < y1)) inside = false;
      }
    }
    check(n && inside, n);
    check(wordsEq(ref, comp.words));
    return `IMG1 traced to the frame: ${n} px change when the frame bytes change, all inside IMG1; flipping the 8 rows past the frame changes nothing`;
  } finally { fetch.close(); }
}

// ----------------------------------------------------------------------------------- G3
function random_requests(rng, device, address, count, kinds) {
  const [pw, ph] = PANEL[device].active, mask = D.DEVICE[device].mask, out = [];
  const axis = (nMax, srcMax, kind) => {
    if (kind === '1:1') { const d = rng.randrange(16, nMax + 1); return [d, d]; }
    if (kind === 'down') {
      let d = rng.randrange(16, nMax + 1);
      while (d >= srcMax) d = rng.randrange(16, nMax + 1);   // no source larger than d within srcMax: draw again
      let s = rng.randrange(d + 1, Math.min(srcMax, 4 * d) + 1);
      if (rng.random() < 0.4) {
        s = Math.max(64, Math.floor(s / 64) * 64);
        if (s <= d) s = d + 64 - (d % 64);
      }
      return [d, s];
    }
    if (kind === 'up-exact') {
      const k = rng.choice([2, 4, 8]);
      const d = k * rng.randrange(8, Math.floor(nMax / k) + 1);
      return [d, d / k];
    }
    let d = rng.randrange(17, nMax + 1);                      // non-exact upscale
    while (4096 % d === 0) d = rng.randrange(17, nMax + 1);   // (s << 12) % d == 0 for every s: no non-exact source
    for (;;) { const s = rng.randrange(8, d); if ((s * 4096) % d) return [d, s]; }
  };
  for (let i = 0; i < count; i++) {
    const hk = rng.choice(kinds), vk = rng.choice(kinds);
    const [dw, tw] = axis(pw, 1700, hk);
    const [dh, th] = axis(ph, 1200, vk);
    const x = 64 * rng.randrange(0, Math.floor((LV_W - tw) / 64) + 1);
    const y = rng.randrange(0, LV_H - th + 1);
    const tx = rng.randrange(0, pw - dw + 1), ty = rng.randrange(0, ph - dh + 1);
    out.push(['domain', new D.ThRequest(mask, address, { from_coordinate: [x, y], from_target: [tw, th], to_target: [dw, dh], to_coordinate: [tx, ty] })]);
  }
  return out;
}
function outside_requests(rng, device, address, count) {
  const [pw, ph] = PANEL[device].active, mask = D.DEVICE[device].mask, out = [];
  const cats = ['crop-x', 'from-area-0', 'device-bits', 'area-w', 'address-unaligned'];
  for (let i = 0; i < count; i++) {
    const cat = cats[i % cats.length];
    const dw = rng.randrange(64, pw + 1), dh = rng.randrange(64, ph + 1);
    const tw = rng.randrange(Math.floor(dw / 2), 2 * dw);
    let th = rng.randrange(Math.floor(dh / 2), 2 * dh);
    while (th >= LV_H) th = rng.randrange(Math.floor(dh / 2), 2 * dh);   // the source rows must start inside the frame
    const x = 64 * rng.randrange(0, Math.floor((LV_W - tw) / 64)), y = rng.randrange(0, LV_H - th);
    const r = new D.ThRequest(mask, address, { from_coordinate: [x, y], from_target: [tw, th], to_target: [dw, dh],
      to_coordinate: [rng.randrange(0, pw - dw + 1), rng.randrange(0, ph - dh + 1)] });
    if (cat === 'crop-x') r.from_coordinate = [x + rng.randrange(1, 64), y];
    else if (cat === 'from-area-0') r.from_area = [0, 0];
    else if (cat === 'device-bits') r.device_type = mask | rng.choice([0x100, 0x8000, 0x10000, 0x200000]);
    else if (cat === 'area-w') r.from_area = [rng.randrange(Math.max(x + tw, 4000), LV_W) | 1, LV_H];
    else r.address = address + 32 * rng.randrange(1, 4);
    out.push([cat, r]);
  }
  return out;
}
const ERRLOG_OF = { 'from-area-0': [0x3700140F], 'device-bits': [0x3700310B] };

function g3_registers(lab, device, rng, nDomain = 60, nOutside = 20) {
  const d = D.DEVICE[device], c = d.channel;
  const address = lab.bus_address(0x0A, 1);
  lab.through_permit(device, 1);
  const kinds = ['1:1', 'down', 'up-exact', 'up'];
  const cases = [...random_requests(rng, device, address, nDomain, kinds), ...outside_requests(rng, device, address, nOutside)];
  const recorded = [];
  let lastArea = null;
  cases.forEach(([cat, req], k) => {
    const w0 = bank_names(lab, c), m0 = bank_names(lab, c, true);
    const e0 = lab.kernel.errors.length;
    lab.live_view(device, req, [], [0x3700140F, 0x3700310B]);
    const w1 = bank_names(lab, c), m1 = bank_names(lab, c, true);
    const errlog = lab.kernel.errors.slice(e0).map(([code]) => code);
    check(deepEqual(errlog, ERRLOG_OF[cat] ?? []), () => [k, cat, errlog.map(hex)]);
    const [want, start] = LV.th_formula(c, req, w0, { last_area: lastArea });
    const expect = new Map(w0);
    for (const [kk, v] of want) expect.set(kk, v);
    const bad = new Map();
    for (const [n, v] of w1) if (!pred(v === expect.get(n))) bad.set(n, [v !== null ? hex(v) : null, expect.get(n) !== null ? hex(expect.get(n)) : null]);
    check(!bad.size, () => `${device} case ${k} (${cat}) ${show(req)}: register (written, formula) ${show(bad)}`);
    check(img0(lab, c) === start, () => [k, hex(img0(lab, c)), hex(start)]);
    const latched = [...m1.keys()].filter((n) => m1.get(n) !== m0.get(n) && m1.get(n) !== w1.get(n));
    check(!latched.length, () => [k, latched]);
    recorded.push([cat, req, w0, w1, lastArea]);
    if (!(req.from_area[0] === 0 && req.from_area[1] === 0)) lastArea = req.from_area;
  });
  const killed = new Map();
  const applicable = LV.MUTANTS.filter((m) => !(m === 'no-a12' && c !== 2));
  for (const mutant of applicable) {
    for (let k = 0; k < recorded.length; k++) {
      const [, req, w0, w1, la] = recorded[k];
      const [want] = LV.th_formula(c, req, w0, { last_area: la, mutant });
      if (pred([...want].some(([n, v]) => w1.get(n) !== v))) { killed.set(mutant, k); break; }
    }
  }
  check(applicable.every((m) => killed.has(m)) && killed.size === applicable.length, () => ['mutants not detected', applicable.filter((m) => !killed.has(m))]);
  lab.step('IMG1 format 3 (0x501e1e95)', () => lab.call(D.IMG_FORMAT, { d0: c, d1: 3, a0: 0 }));
  let w0 = bank_names(lab, c);
  check((reg(w0, 'IMG1FMT') & 0xF) === 3, () => hex(w0.get('IMG1FMT')));
  const rec = D.ThRequest.rec_view(d.mask, address, [2000, 600], [900, 600], 1);
  lab.live_view(device, rec);
  let w1 = bank_names(lab, c);
  const kept = ['IMG1FMT', 'IMG1PLANC', 'IMG1DMASADR2'];
  check(kept.every((n) => w1.get(n) === w0.get(n)), () => new Map(kept.map((n) => [n, [w0.get(n), w1.get(n)]])));
  const req = rec.replace({ layer_format: 1 });
  w0 = w1;
  lab.live_view(device, req);
  const [want, start] = LV.th_formula(c, req, w0);
  w1 = bank_names(lab, c);
  const exp = new Map(w0);
  for (const [k, v] of want) exp.set(k, v);
  const bad = new Map();
  for (const [n, v] of exp) if (!pred(w1.get(n) === v || n === 'IMG1PLANC')) bad.set(n, [w1.get(n), v]);
  check(!bad.size && img0(lab, c) === start, () => bad);
  check(((w1.get('IMG1PLANC') ^ w0.get('IMG1PLANC')) & ~0x3000) === 0);
  const fmtLine = `layer_format 0 after IMG1FMT format 3: IMG1FMT 0x${hx(w0.get('IMG1FMT'))}, IMG1PLANC and IMG1DMASADR2 kept; layer_format 1 then == formulas (format 0)`;
  lab.through_permit(device, 0);
  let wa = bank_names(lab, c), s0 = img0(lab, c);
  lab.live_view(device, cases[0][1]);
  check(deepEqual(bank_names(lab, c), wa) && img0(lab, c) === s0, 'TH call without the permit changed state');
  lab.through_permit(device, 1);
  wa = bank_names(lab, c); s0 = img0(lab, c);
  const e0 = lab.kernel.errors.length;
  lab.live_view(device, cases[0][1].replace({ device_type: 0 }), [], [0x3700310B]);
  check(deepEqual(lab.kernel.errors.slice(e0).map(([code]) => code), [0x3700310B]));
  check(deepEqual(bank_names(lab, c), wa) && img0(lab, c) === s0, 'TH call with device_type 0 changed state');
  const cats = new Map();
  for (const [cat] of cases) cats.set(cat, (cats.get(cat) ?? 0) + 1);
  return `${device}: ${cases.length} TH calls (${sortStr(cats.keys()).map((k) => `${k} ${cats.get(k)}`).join(', ')}): written bank == `
    + 'spec formulas register by register, nothing else changed, img[0] == start; error log exactly '
    + '0x3700140f per from_area 0 and 0x3700310b per device_type bit 8..31; mirror only latched copies; '
    + `${applicable.length} reference mutants each fail (${[...killed].map(([m, k]) => `${m} at case ${k}`).join(', ')}); `
    + `${fmtLine}; permit off: no change; device_type 0: error log 0x3700310b, no change`;
}

// ----------------------------------------------------------------------------------- G4
function g4_composites(device) {
  const c = D.DEVICE[device].channel, out = [];
  withLab(session(device), (lab) => {
    lab.through_permit(device, 1);
    let negativeDone = false;
    for (const form of ['rec', 'scaled']) {
      for (const bank of [0x0A, 0x75]) {
        let frame, crop;
        if (form === 'rec') { const size = PANEL[device].active; frame = D.test_card(...size); crop = [0, 0]; }
        else { frame = D.test_card(...D.LV_SCALED[device][0]); crop = D.LV_SCALED_CROP; }
        const address = lab.load_lv_frame(frame, bank, 1, crop);
        let req;
        if (form === 'rec') {
          req = D.ThRequest.rec_view(D.DEVICE[device].mask, address, [crop[0] + Math.floor(frame[0] / 2), crop[1] + Math.floor(frame[1] / 2)], frame.slice(0, 2), D.aspect_code(frame[0], frame[1]));
          check(req.layer_format === 0);
        } else req = scaled_request(device, address, crop);
        lab.assume('A15', false);
        const th = lab.live_view(device, req);
        const sadr = lab.vsc.bank(c).get('IMG1DMASADR'), s0 = img0(lab, c);
        check(s0 === th.start && sadr === Math.floor(th.start / 16));
        lab.update();
        check(lab.vsc.bank(c).get('IMG1DMASADR') === sadr && img0(lab, c) === s0, 'the update moved IMG1');
        let comp = lab.compose(device);
        check(comp.status === 'FEATURE_UNOBSERVED' && deepEqual(comp.errors.map((e) => [e.name, e.offset, e.value]), [['FEATURE_UNOBSERVED', 8, 0x41]]), () => [form, bank, errnames(comp)]);
        lab.assume('A15', true);
        const n0 = lab.notes.length;
        comp = lab.compose(device);
        const assumed = lab.notes.slice(n0).filter((n) => n.kind === 'ASSUMED');
        check(comp.status === 'NONE' && !comp.errors.length && comp.header.assumed === 1 && assumed.length === 1 && assumed[0].offset === 8 && assumed[0].value === 0x41,
          () => [form, bank, errnames(comp), assumed]);
        let summary = CD.compare(lab, device, comp, `${device} ${form} bank 0x${bank.toString(16).padStart(2, '0')}`, true, ['A15']);
        if (form === 'scaled' && bank === 0x75) summary += '; ' + img1_traced(lab, device, comp, lab.img, ['A15']);
        out.push(`${summary} (A15 off: FEATURE_UNOBSERVED CTRL3 0x41 only; A15 on: one ASSUMED note)`);
        fs.mkdirSync(OUT, { recursive: true });
        write_png(path.join(OUT, `${device}-${form}-${bank.toString(16).padStart(2, '0')}.png`), comp.header.width, comp.header.height, D.words_to_rgb(comp.words));
        if (!negativeDone) {
          const one = lab.img.base + 5 * lab.img.stride + 7;
          const byte = lab.bus_read(one, 1);
          lab.bus_write(one, new Uint8Array([byte[0] ^ 1]));
          try {
            lab.check_img_unchanged();
            throw new AssertionError('frame byte changed through the bus window, hash check passed');
          } catch (e) { if (!(e instanceof FirmwareError)) throw e; }
          lab.bus_write(one, byte);
          lab.check_img_unchanged();
          negativeDone = true;
        }
      }
    }
  });
  return out;
}

// ----------------------------------------------------------------------------------- G5
function g5_out_of_domain() {
  const out = [];
  withLab(session('tft'), (lab) => {
    lab.through_permit('tft', 1);
    lab.assume('A15', true);
    let address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    const run = (label, req, names, reason = null) => {
      lab.live_view('tft', req);
      const comp = lab.compose('tft');
      const got = errnames(comp);
      check(deepEqual(got, names), () => [label, got, comp.errors.map(D.format_vsc_error)]);
      if (reason !== null) check(comp.errors.at(-1).value === reason, () => [label, comp.errors.at(-1)]);
      out.push(`${label} -> ${got.join(', ') || 'clean'}` + (reason ? ` reason ${reason}` : ''));
      return comp;
    };
    const [cx, cy] = D.LV_SCALED_CROP;
    const cropped = (dx) => D.ThRequest.scaled(1, address, [cx + dx, cy], [1600, 1080], [900, 600], [0, 0]);
    const n0 = lab.notes.length;
    const comp10 = run('crop x 10', cropped(10), []);
    const w10 = lab.vsc.bank(2);
    const a18 = lab.notes.slice(n0).filter((n) => n.kind === 'SPOS_A18').map((n) => n.value);
    check((reg(w10, 'IMGDMASPOS') & 0xFF) === 10 && deepEqual(a18, [10]), () => [hex(w10.get('IMGDMASPOS')), a18]);
    out[out.length - 1] += ' (A18, SPOS 10); ' + CD.compare(lab, 'tft', comp10, 'crop x 10', false, ['A15']) + '; ' + img1_traced(lab, 'tft', comp10, lab.img, ['A15']);
    const base = run('crop x 0 (control)', cropped(0), []);
    check(!wordsEq(base.words, comp10.words), 'crop x 10 and x 0 give the same composite');
    const comp11 = run('crop x 11', cropped(11), []);
    const w11 = lab.vsc.bank(2);
    check(w11.get('IMG1DMASADR') === w10.get('IMG1DMASADR') && w11.get('IMGDMASPOS') === w10.get('IMGDMASPOS') && wordsEq(comp11.words, comp10.words), () => [hex(w11.get('IMG1DMASADR')), hex(w11.get('IMGDMASPOS'))]);
    out[out.length - 1] += ': the firmware rounds to the pixel pair, registers and composite == crop x 10';
    const sposReg = D.VSC_CHANNEL[2] + 0x3D8;
    lab.step('guest store IMGDMASPOS byte 0 = 11 (odd)', () => lab.cpu_store(sposReg, ((reg(w10, 'IMGDMASPOS') & ~0xFF) | 11) >>> 0));
    let comp = lab.compose('tft');
    check(deepEqual(errnames(comp), ['SPOS_UNMODELLED']) && !CD.drawn_planes(comp).includes('IMG1'), () => errnames(comp));
    out.push('IMG SPOS 11 (odd, guest store) -> SPOS_UNMODELLED, IMG1 skipped');
    let r = scaled_request('tft', address);
    r.input_color_space = 2; r.output_color_space = 1;
    run('BT709 -> BT601 (IMG1FMT 0x10)', r, ['FMT_UNMODELLED']);
    check(lab.vsc.bank(2).get('IMG1FMT') === 0x10);
    const up = D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [450, 300], [900, 600], [0, 0]);
    run('exact 2x upscale 450x300 -> 900x600', up, ['IMG_EDGE_UNKNOWN'], 3);
    const found = new Map();
    outer: for (let hh = 40; hh < 600; hh++) {
      for (let dh = hh + 1; dh < 601; dh++) {
        if ((hh * 4096) % dh === 0) continue;
        const step = -Math.floor(-((hh - 1) * 4096) / dh);
        const last = Math.floor(((dh - 1) * step) / 4096) + (((dh - 1) * step) % 4096 ? 1 : 0);
        const key = last >= hh;
        if (!found.has(key)) found.set(key, [hh, dh]);
      }
      if (found.size === 2) break outer;
    }
    for (const escapes of [false, true]) {
      const [hh, dh] = found.get(escapes);
      const req = D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [900, hh], [900, dh], [0, 0]);
      run(`vertical ${hh} -> ${dh} (non-exact, second tap ${escapes ? 'past' : 'inside'} from_target)`, req, escapes ? ['IMG_EDGE_UNKNOWN'] : [], escapes ? 3 : null);
    }
    run('scaled form again', scaled_request('tft', address), []);
    lab.attach_img('tft', D.ASPECTS.get('3,2'));
    comp = lab.compose('tft');
    check(!comp.errors.length, () => errnames(comp));
    out.push('level-3 attach after the TH attach -> clean (both attaches recorded)');
    lab.live_view('tft', scaled_request('tft', address));
    lab.step('IMG1DMALD 11136 px (0x501dffae)', () => lab.call(0x501DFFAE, { d0: 2, d1: 11136, a0: 0, a1: 0 }));
    comp = lab.compose('tft');
    check(deepEqual(errnames(comp), ['IMG_EDGE_UNKNOWN']) && comp.errors[0].value === 2, () => errnames(comp));
    out.push('0x501dffae stride change after the TH attach -> IMG_EDGE_UNKNOWN reason 2');
    const small = D.test_card(900, 600);
    lab.load_lv_frame(small, 0x0A, 1, D.LV_SCALED_CROP);
    run('frame 900x600, from_target 1620x1080 -> 900x600 (source past the frame)',
      D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [1620, 1080], [900, 600], [0, 0]), ['IMG_EDGE_UNKNOWN'], 3);
    run('frame 900x600, from_target 900x600 1:1 (control)', D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [900, 600], [900, 600], [0, 0]), []);
    run('crop origin 64 px before the frame', D.ThRequest.scaled(1, address, [cx - 64, cy], [900, 600], [900, 600], [0, 0]), ['IMG_EDGE_UNKNOWN'], 4);
    run('crop origin one row above the frame', D.ThRequest.scaled(1, address, [cx, cy - 1], [900, 600], [900, 600], [0, 0]), ['IMG_EDGE_UNKNOWN'], 4);
    run('crop origin past the frame (x + 1664)', D.ThRequest.scaled(1, address, [cx + 1664, cy], [900, 600], [900, 600], [0, 0]), ['IMG_EDGE_UNKNOWN'], 4);
    r = D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [900, 600], [900, 600], [0, 0], [5504, 2160]);
    run('from_area 5504 wide (stride 11008, frame stride 11136)', r, ['IMG_EDGE_UNKNOWN'], 4);
    lab.live_view('tft', D.ThRequest.scaled(1, address, D.LV_SCALED_CROP, [900, 600], [900, 600], [0, 0]));
    lab.load_lv_frame(small, 0x0A, 1, [0, 0]);
    comp = lab.compose('tft');
    check(deepEqual(errnames(comp), ['IMG_EDGE_UNKNOWN']) && comp.errors[0].value === 4, () => errnames(comp));
    out.push('frame reloaded at another crop after the TH attach -> IMG_EDGE_UNKNOWN reason 4');
    address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    const zebra = lab.alloc(new Uint8Array([1, 200, 100, 0]), 4);
    r = scaled_request('tft', address);
    r.zebra_prm = zebra;
    const before = bank_names(lab, 2);
    lab.live_view('tft', r);
    const written = sortStr([...bank_names(lab, 2)].filter(([n, v]) => v !== before.get(n) && !FORMULA_REGS.has(n)).map(([n]) => n));
    comp = lab.compose('tft');
    const feats = sortStr(comp.errors.filter((e) => e.name === 'FEATURE_UNOBSERVED').map((e) => lab.vsc.names.get(e.offset).trim()));
    note('G5 zebra_written', written.join(' '));
    note('G5 zebra_feature_unobserved', feats.join(' '));
    out.push(`zebra_prm {1, 200, 100} -> writes ${written.join(', ')}; composite ${comp.status} (${comp.errors.length} FEATURE_UNOBSERVED)`);
  });
  return out;
}

// ----------------------------------------------------------------------------------- G6
function g6_cmm(labImage) {
  const out = [];
  withLab(session('tft'), (lab) => {
    const R = lab.alloc(new Uint8Array(D.TH_REQUEST_SIZE), 16);
    let n = 0;
    for (const drange of [0, 1, 2]) for (const lut of [0, 1]) for (const mode of [0, 253, 254, 255]) for (const inp of [1, 2, 3]) for (const outp of [1, 2, 3]) {
      lab.sim.write(R + 21, new Uint8Array([lut, mode, inp, outp]));
      lab.sim.write(R + 220, new Uint8Array([drange]));
      const got = lab.call(0x501DE269, { a0: R }).d0 & 0xFF;
      check(got === LV.cmm_selector(lut, mode, inp, outp, drange), () => [drange, lut, mode, inp, outp, got]);
      n += 1;
    }
    out.push(`(a) selector 0x501de269: ${n} combinations == spec table`);
    lab.through_permit('tft', 1);
    lab.assume('A15', true);
    const address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    lab.live_view('tft', scaled_request('tft', address));
    let comp = lab.compose('tft');
    check(comp.status === 'NONE' && !comp.errors.length, () => errnames(comp));
    const modes = new Map([[1, [0, 253, 1, 1]], [2, [1, 254, 2, 1]], [3, [1, 254, 2, 2]], [4, [1, 255, 2, 1]], [5, [1, 255, 2, 2]], [6, [1, 255, 3, 1]], [7, [1, 255, 3, 2]]]);
    const runs = [...[1, 2].flatMap((dr) => [1, 2, 3, 4, 5, 6, 7].map((st) => [dr, st])), [3, 1]];
    const coef = ['CMM_COEF1', 'CMM_COEF2', 'CMM_COEF3', 'CMM_COEF4', 'CMM_COEF5'];
    for (const [dr, st] of runs) {
      const r = scaled_request('tft', address);
      [r.lut_onoff, r.prm_pic_mode, r.input_color_space, r.output_color_space] = modes.get(st);
      r.drange_ptn = dr;
      check(LV.cmm_selector(...modes.get(st), dr) === st);
      const before = bank_names(lab, 2);
      const e0 = lab.kernel.errors.length;
      lab.live_view('tft', r, [], [0x37001415]);
      const errlog = lab.kernel.errors.slice(e0).map(([code]) => code);
      check(deepEqual(errlog, dr === 3 ? [0x37001415] : []), () => [dr, st, errlog]);
      const half = dr === 2 ? 1 : 0;
      const [want, b] = LV.cmm_formula(labImage, before.get('CMMSET1') ?? 0, half, st);
      const after = bank_names(lab, 2);
      const bad = [...want].filter(([k, v]) => after.get(k) !== v);
      check(!bad.length, () => [dr, st, bad]);
      check(coef.every((k) => after.get(k) === null) && b[5] !== 5, () => [dr, st]);
      check(lab.sim.read(D.CMM_STATE_BYTE + 2, 1)[0] === st);
    }
    for (const half of [0, 1]) check([0, 1, 2, 3, 4, 5, 6, 7].every((s) => LV.cmm_entry(labImage, half, s)[1][5] !== 5));
    out.push('(b) CMM ON for states 1..7 x drange 1/2 and drange 3 (error log 0x37001415, half 0): CMMSET1, '
      + 'CMMSET2 and CMM1/2_KNEE1-32 == formulas on table 0x602c20b0 from the image file; CMM_COEF1-5 '
      + 'unwritten (b33 != 5 in all 16 entries); state byte 0xa32ddb81[2] == state');
    comp = lab.compose('tft');
    const cmmRegs = new Set(['CMMSET1', 'CMMSET2', ...[1, 2].flatMap((k) => Array.from({ length: 32 }, (_, i) => `CMM${k}_KNEE${i + 1}`))]);
    const names = new Set(comp.errors.map((e) => lab.vsc.names.get(e.offset).trim()));
    check(comp.status === 'FEATURE_UNOBSERVED' && comp.error_total === cmmRegs.size && [...names].every((x) => cmmRegs.has(x)), () => [comp.status, comp.error_total]);
    const onTotal = comp.error_total;
    const before = bank_names(lab, 2);
    lab.live_view('tft', scaled_request('tft', address));
    const after = bank_names(lab, 2);
    check(after.get('CMMSET1') === ((before.get('CMMSET1') & 0x7FFFFEEF) >>> 0) && lab.sim.read(D.CMM_STATE_BYTE + 2, 1)[0] === 0);
    check([...cmmRegs].filter((k) => k !== 'CMMSET1').every((k) => after.get(k) === before.get(k)));
    comp = lab.compose('tft');
    note('G6 composite_errors_after_on', onTotal);
    note('G6 composite_errors_after_off', comp.error_total);
    out.push(`(c) OFF (STILL request): CMMSET1 & 0x7ffffeef, other CMM registers kept, state byte 0; (d) composite under A15: FEATURE_UNOBSERVED, ${onTotal} errors after ON (one per written CMM `
      + `register), ${comp.error_total} after OFF; no CMM image is claimed`);
  });
  return out;
}

// ----------------------------------------------------------------------------------- G7
// DISPLAY cmd 5 parameter (spec section 10.6)
function cmd5(mask, { img = [-1, -1, -1], osd = [-1, -1, -1], planc = [0xFFFF, 0xFFFF, 0xFFFF], permit = 2, bg = 0, fmt = [0, 0, 0] } = {}) {
  const p = new Uint8Array(52);
  p.set(pack('<7I', mask, ...img.map((v) => v >>> 0), ...osd.map((v) => v >>> 0)), 0);
  p.set(pack('<3H', ...planc), 28);
  p[34] = permit;
  p.set(pack('<I', bg), 36);
  p.set(pack('<3I', ...fmt), 40);
  return p;
}
// Hook 0x501da1b3 and the functions it calls; returns the list the hooks fill with (function, d0, d1, return address).
function cmd5_img1_trace(lab) {
  const log = [];
  for (const [fn] of CMD5_IMG1) {
    lab.hook(fn, (hle, r) => { log.push([fn, r.d0, r.d1, ((r.mdr - RUNTIME + 0x50000000) % 4294967296 + 4294967296) % 4294967296]); lab.sim.run([], true); }, `trace 0x${hx(fn).padStart(8, '0')}`);
  }
  return log;
}
function match_trace(log, want) {
  const got = log.map(([fn, d0, d1, ret], i) => [fn, d0, want[i] && want[i][2] === null ? null : d1, ret]);
  check(log.length === want.length && deepEqual(got, want), () => [log, want]);
}

function g7_cmd5() {
  const out = [];
  withLab(session('tft'), (lab) => {
    lab.assume('A15', true);
    const c = 2;
    lab.through_permit('tft', 0);
    let w0 = bank_names(lab, c);
    const s0 = img0(lab, c);
    lab.step('DISPLAY cmd 5 keep-all', () => lab.display_cmd(5, cmd5(1)));
    check(deepEqual(bank_names(lab, c), w0) && img0(lab, c) === s0 && (lab.sim.u32(D.PERMIT_WORD) & 1) === 0);
    out.push('keep-all {mask 1, -1 x6, PLANC 0xffff x3, permit 2}: no register, img[0] or permit change');
    lab.step('DISPLAY cmd 5 permit 1', () => lab.display_cmd(5, cmd5(1, { permit: 1 })));
    check(lab.sim.u32(D.PERMIT_WORD) & 1);
    const address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    const th = lab.live_view('tft', scaled_request('tft', address));
    check(img0(lab, c) === th.start);
    out.push('+34 = 1 sets the permit word; a TH call then works without 0x501c40d0');
    lab.step('DISPLAY cmd 5 {IMG1 handle 0x0a01, permit 1}', () => lab.display_cmd(5, cmd5(1, { img: [0x0A01, -1, -1], permit: 1 })));
    check(img0(lab, c) === th.start, 'cmd 5 with the permit set changed img[0]');
    out.push('{IMG1 handle 0x0a01, permit 1}: img[0] untouched (TH-owned)');
    const e0 = lab.kernel.errors.length;
    w0 = bank_names(lab, c);
    const log = cmd5_img1_trace(lab);
    lab.step('DISPLAY cmd 5 {IMG1 handle 0x0a01, permit 0}', () => lab.display_cmd(5, cmd5(1, { img: [0x0A01, -1, -1], permit: 0 })), [], [...D.MM_UNALLOCATED.keys()]);
    const errlog = lab.kernel.errors.slice(e0).map(([code]) => h8(code));
    const base = D.LV_BANKS.get(0x0A)[0];
    check(img0(lab, c) === base && (lab.sim.u32(D.PERMIT_WORD) & 1) === 0, () => hex(img0(lab, c)));
    const sadr = lab.vsc.bank(c).get('IMG1DMASADR');
    const w1 = bank_names(lab, c);
    const [want, width] = LV.cmd5_img1_want('tft', 0x0A01);
    match_trace(log, want);
    const dmabn = -Math.floor(-width / 64) << 3;
    check(w1.get('IMG1DMABN') === dmabn && (reg(w1, 'IMG1DMALD') & 0x7FFF) === (Math.floor(LV_W / 64) << 3) && (reg(w1, 'IMG1FMT') & 0x3F) === 0 && (reg(w1, 'IMGDMASPOS') & 0x7F) === 0, () => w1);
    const steps = ['IMG1RSZ1', 'IMG1RSZ2', 'IMG1RSZ4', 'IMG1AREA1', 'IMG1AREA2'];
    check(steps.every((k) => w1.get(k) === w0.get(k)) && w0.get('IMG1DMABN') > dmabn, () => [w0, w1]);
    out.push(`{IMG1 handle 0x0a01, permit 0}: 0x501c41a5 == 0 -> 0x501da1b3(1, 0x0a01) at 0x501da62f -> 0x501df27a, 0x501e1e95(2, 0) FMT, 0x501dffae(2, ${LV_W}) stride, 0x501e0137(2, 0) SPOS, `
      + `0x501e0045(2, ${width}) IMG1DMABN 0x${hx(dmabn)} = ceil(panel width / 64) << 3; RSZ and AREA keep the scaled TH call's values, whose DMABN was 0x${hx(w0.get('IMG1DMABN'))}`);
    note('G7 handle_changed', sortStr([...w1.keys()]).filter((k) => w1.get(k) !== w0.get(k)).map((k) => `${k}=${hex(w1.get(k))}`).join(' '));
    note('G7 handle_errlog', errlog.join(' '));
    note('G7 handle_IMG1DMASADR', hex(sadr));
    lab.update();
    let comp = lab.compose('tft');
    note('G7 handle_composite', comp.errors.map((e) => `${e.name}:${e.value}`).join(' ') || 'clean');
    check(deepEqual(comp.errors.map((e) => [e.name, e.value]), [['DMABN_SHORT', dmabn]]), () => errnames(comp));
    out.push(`{IMG1 handle 0x0a01, permit 0}: img[0] = ${h8(base)} (0x50534dd1), error log ${show(errlog)}, IMG1DMASADR 0x${hx(sadr)}; composite ${comp.status} ${show(comp.errors.map((e) => [e.name, e.value]))}`);
    w0 = bank_names(lab, c);
    lab.step('DISPLAY cmd 5 DispBlack (all 0)', () => lab.display_cmd(5, cmd5(1, { img: [0, 0, 0], osd: [0, 0, 0], planc: [0, 0, 0], permit: 0 })));
    const w2 = bank_names(lab, c);
    note('G7 dispblack_changed', sortStr([...w2.keys()]).filter((k) => w2.get(k) !== w0.get(k)).map((k) => `${k}=${hex(w2.get(k))}`).join(' '));
    comp = lab.compose('tft');
    note('G7 dispblack_drawn', CD.drawn_planes(comp).join(' ') || 'none');
    check(comp.status === 'NONE' && !comp.errors.length, () => errnames(comp));
    out.push(`DispBlack {img 0, osd 0, PLANC 0, permit 0} (no update after it): drawn ${show(CD.drawn_planes(comp))}; ` + CD.compare(lab, 'tft', comp, 'DispBlack', false, ['A15']));
  });
  withLab(session('tft'), (lab) => {
    lab.assume('A15', true);
    lab.through_permit('tft', 1);
    const address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    lab.live_view('tft', scaled_request('tft', address));
    lab.update();
    const full = lab.compose('tft');
    check(!full.errors.length && CD.drawn_planes(full).includes('IMG1'), () => errnames(full));
    lab.step('DISPLAY cmd 5 {mask 1, IMG1 trans 128, permit 0}', () => lab.display_cmd(5, cmd5(1, { planc: [128, 0xFFFF, 0xFFFF], permit: 0 })));
    lab.update();
    const planc = lab.vsc.bank(2).get('IMG1PLANC');
    const n0 = lab.notes.length;
    const comp = lab.compose('tft');
    const zero = lab.notes.slice(n0).filter((n) => n.kind === 'PLANC_ZERO').map((n) => [n.offset, n.value]);
    check(planc === 0 && comp.status === 'NONE' && !comp.errors.length && deepEqual(zero, [[0x620, 0]]) && deepEqual(CD.drawn_planes(comp), ['OSD1', 'OSD2', 'OSD3'])
      && comp.planes.IMG1.result === 'not drawn (PLANC 0)', () => [hex(planc ?? 0), comp.status, errnames(comp), zero, CD.drawn_planes(comp)]);
    check(!wordsEq(comp.words, full.words));
    out.push(`{IMG1 trans 128, permit 0}: IMG1PLANC 0x${hx(planc)} after the update; IMG1 not drawn (PLANC_ZERO record), ` + CD.compare(lab, 'tft', comp, 'IMG1 PLANC 0', false, ['A15']));
  });
  for (const device of ['tft', 'evf']) {
    withLab(session(device, false), (lab) => {
      const c = D.DEVICE[device].channel;
      lab.through_permit(device, 0);
      const w0 = bank_names(lab, c);
      const log = cmd5_img1_trace(lab);
      lab.step('DISPLAY cmd 5 {IMG1 handle 0x0a01, permit 0}', () => lab.display_cmd(5, cmd5(D.DEVICE[device].mask, { img: [0x0A01, -1, -1], permit: 0 })), [], [...D.MM_UNALLOCATED.keys()]);
      const [want, width] = LV.cmd5_img1_want(device, 0x0A01);
      match_trace(log, want);
      const w1 = bank_names(lab, c);
      const changed = new Set([...w1.keys()].filter((k) => w1.get(k) !== w0.get(k)));
      check(w0.get('IMG1DMABN') === (-Math.floor(-width / 64) << 3) && changed.size === 2 && changed.has('DMAEN') && changed.has('IMG1DMASADR'), () => changed);
      check(img0(lab, c) === D.LV_BANKS.get(0x0A)[0] && w1.get('CTRL3') === 1);
      lab.update();
      const comp = lab.compose(device);
      check(comp.status === 'NONE', comp.status);
      note(`G7 fresh_${device}_composite`, comp.errors.map((e) => `${e.name}:${e.value}`).join(' ') || 'clean');
      out.push(`fresh ${device}: cmd 5 {IMG1 handle 0x0a01, permit 0} after OPEN runs the same 0x501da1b3 calls (width ${width}); the setters rewrite the OPEN values (DMABN `
        + `0x${hx(w1.get('IMG1DMABN'))}), only ${show(sortStr(changed))} change; CTRL3 1, model status NONE, errors ${show(comp.errors.map((e) => [e.name, e.value]))} (no recorded attach)`);
    });
  }
  return out;
}

// ----------------------------------------------------------------------------------- G8
function open_ctrl_trace(device) {
  const log = [], ors = [];
  let banks;
  withLab(new D.DisplayLab(env()), (lab) => {
    lab.hook(GEN_WRITE, (hle, r) => {
      if (r.d1 === 1 || r.d1 === 2) log.push([r.d0, r.d1, r.a0, ((r.mdr - RUNTIME + 0x50000000 - 7) % 4294967296 + 4294967296) % 4294967296]);
      lab.sim.run([], true);
    }, 'trace 0x501e2ce6');
    lab.hook(CTRL_OR, (hle, r) => { ors.push([r.d0, r.d1]); lab.sim.run([], true); }, 'trace 0x501e04b7');
    lab.start(); lab.set_gui_buffers();
    log.length = 0; ors.length = 0;
    lab.open(device);
    banks = new Map([1, 2].map((c) => [c, bank_names(lab, c)]));
  });
  return [log, ors, banks];
}

function g8_field_mode() {
  const out = [];
  for (const device of ['tft', 'evf']) {
    const opened = D.DEVICE[device].channel, other = 3 - opened;
    const [log, ors, banks] = open_ctrl_trace(device);
    const want = [...[opened, other].flatMap((c) => OPEN_CTRL.map(([i, v, site]) => [c, i, v, site])), [other, ...CLOSE_CTRL3]];
    check(deepEqual(log, want), () => [device, log.map(([c, i, v, a]) => [c, i, hex(v), hex(a)])]);
    check(!ors.length, () => [device, ors]);
    check(banks.get(opened).get('CTRL2') === 0x1C0 && banks.get(opened).get('CTRL3') === 1, () => banks.get(opened));
    check(banks.get(other).get('CTRL2') === 1 && banks.get(other).get('CTRL3') === 0x400, () => banks.get(other));
  }
  out.push('OPEN (tft, evf): CTRL2/CTRL3 stores through 0x501e2ce6 = the 9 of 0x501d9e8a..0x501d9f55 on the opened '
    + 'channel, then on the other, then CTRL3 0x400 on the channel not opened (0x501da0d4); no 0x501e04b7 call; opened channel '
    + 'CTRL2 0x1c0 CTRL3 1 (A13), the other CTRL2 1 CTRL3 0x400');
  out.push(LV.reg_dump_reads(loadImage()));
  withLab(session('evf'), (lab) => {
    const c = 1;
    lab.through_permit('evf', 1);
    const address = lab.load_lv_frame(D.test_card(), 0x0A, 1, D.LV_SCALED_CROP);
    let before = bank_names(lab, c);
    lab.live_view('evf', scaled_request('evf', address));
    check(bank_names(lab, c).get('CTRL3') === (reg(before, 'CTRL3') | 0x40));
    check(lab.sim.read(D.CTRL_FIELD_BYTE + c, 1)[0] === 1);
    out.push(`progressive TH call: CTRL3 0x${hx(before.get('CTRL3'))} -> 0x${hx(before.get('CTRL3') | 0x40)}, 0xa32ddd3c[1] = 1`);
    let w0 = bank_names(lab, c);
    let e0 = lab.kernel.errors.length, result;
    try {
      lab.step('DISPLAY cmd 32 (EVF frame rate)', () => lab.display_cmd(32, null));
      result = 'ran';
    } catch (e) {
      if (!(e instanceof FirmwareError)) throw e;
      result = `stopped: ${e.message.slice(0, 160)}`;
    }
    let w1 = bank_names(lab, c);
    const changed = new Map([...w1].filter(([k, v]) => v !== w0.get(k)).map(([k, v]) => [k, [w0.get(k), v]]));
    const errlog = lab.kernel.errors.slice(e0).map(([code]) => h8(code));
    note('G8 cmd32', result);
    note('G8 cmd32_errlog', errlog.join(' '));
    note('G8 cmd32_changed', sortStr(changed.keys()).filter((k) => changed.get(k)[1] !== null).map((k) => `${k}=${hex(changed.get(k)[1])}`).join(' '));
    e0 = lab.kernel.errors.length;
    const idx = lab.step('EVF frame-rate index getter 0x50023b4c', () => lab.call(0x50023B4C).d0 & 0xFF);
    const idxErrlog = lab.kernel.errors.slice(e0).map(([code]) => h8(code));
    note('G8 idx_getter', `${idx} errlog ${idxErrlog.join(' ')}`);
    out.push(`DISPLAY cmd 32 natively: ${result}; error log ${show(errlog)}; changed ${show(sortStr(changed.keys()))}; the index `
      + `getter 0x50023b4c returns ${idx} in the lab (error log ${show(idxErrlog)}), so cmd 32 keeps the progressive timing`);
    lab.step('EVF two-field timing 0x501e298b(1, 1)', () => lab.call(0x501E298B, { d0: 1, d1: 1 }));
    check(lab.sim.read(D.CTRL_FIELD_BYTE + c, 1)[0] === 0);
    let comp = lab.compose('evf');
    check(comp.status === 'FIELD_MODE', comp.status);
    const prev = bank_names(lab, c).get('CTRL3');
    let req = scaled_request('evf', address);
    lab.live_view('evf', req);
    let w = bank_names(lab, c);
    const ctrl3 = w.get('CTRL3');
    check(ctrl3 === (prev | 0xC0), () => [hex(prev), hex(ctrl3)]);
    note('G8 field_CTRL3', hex(ctrl3));
    const ty = req.to_coordinate[1], dh = req.to_target[1], vs = PANEL.evf.porch[1];
    const area2 = (Math.floor(ty / 2) + vs) << 16 | Math.floor(dh / 2), area3 = Math.floor(ty / 2) + vs;
    check(w.get('IMG1AREA2') === area2 && w.get('IMG1AREA3') === area3, () => [hex(w.get('IMG1AREA2')), w.get('IMG1AREA3')]);
    out.push(`0x501e298b(1, 1): FIELD_MODE, 0xa32ddd3c[1] = 0; TH call ORs 0xc0: CTRL3 0x${hx(prev)} -> 0x${hx(ctrl3)}; `
      + `IMG1AREA2 0x${hx(area2)} = (ty/2 + vs) << 16 | dh/2, IMG1AREA3 ${area3} = ty/2 + vs (ty ${ty}, dh ${dh}, vs ${vs})`);
    lab.step('EVF progressive timing 0x501e298b(0, 1)', () => lab.call(0x501E298B, { d0: 0, d1: 1 }));
    lab.assume('A15', true);
    comp = lab.compose('evf');
    const feats = comp.errors.map((e) => [lab.vsc.names.get(e.offset).trim(), e.value]);
    note('G8 back_errors', feats.map(([n, v]) => `${n}=${hex(v)}`).join(' '));
    w = bank_names(lab, c);
    out.push(`back to progressive 0x501e298b(0, 1): CTRL2 0x${hx(w.get('CTRL2'))}, CTRL3 0x${hx(w.get('CTRL3'))} -> ${comp.status} ${show(feats.map(([n, v]) => [n, v]))}`);
    e0 = lab.kernel.errors.length;
    lab.step('DISPLAY cmd 30 {1}', () => lab.display_cmd(30, pack('<I', 1)));
    const gate = lab.sim.u32(EVF_GATE);
    check(gate === 1, gate);
    check(lab.sim.u32(DRAW_NORA_WORD) === 0);
    const cmd30Errlog = lab.kernel.errors.slice(e0).map(([code]) => h8(code));
    const hexb = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const bytesBefore = hexb(lab.sim.read(EVF_GATE + 0x34, 4));
    req = scaled_request('evf', address);
    w0 = bank_names(lab, c); e0 = lab.kernel.errors.length;
    lab.live_view('evf', req);
    const [want, start] = LV.th_formula(c, req, w0);
    w1 = bank_names(lab, c);
    const exp = new Map(w0);
    for (const [k, v] of want) exp.set(k, v);
    const bad = [...exp].filter(([n, v]) => w1.get(n) !== v);
    check(!bad.length && img0(lab, c) === start, () => bad);
    const thErrlog = lab.kernel.errors.slice(e0).map(([code]) => h8(code));
    const bytesAfter = hexb(lab.sim.read(EVF_GATE + 0x34, 4));
    note('G8 cmd30_errlog', cmd30Errlog.join(' '));
    note('G8 cmd30_th_errlog', thErrlog.join(' '));
    note('G8 cmd30_a32db3e4', `${bytesBefore} -> ${bytesAfter}`);
    out.push(`DISPLAY cmd 30 {1}: 0xa32db3b0 = 1 (error log ${show(cmd30Errlog)}); the next TH call (side call `
      + `0x501c5604(1), 0xa32db3f0 = 0 so no flag set, error log ${show(thErrlog)}, bytes 0xa32db3e4..e7 `
      + `${bytesBefore} -> ${bytesAfter}) writes the section 10.4 registers, img[0] == start`);
  });
  return out;
}

// ----------------------------------------------------------------------------------- main
function check_notes(write) {
  const lines = NOTES.map(([k, v]) => `${k} ${v}`);
  if (write) {
    const dir = process.env.OM_NOTES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'check_liveview_notes.txt');
    fs.writeFileSync(file, '# check_liveview observations pinned without a formula (--write-notes regenerates)\n' + lines.join('\n') + '\n');
    return `wrote ${file}`;
  }
  const want = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8').split(/\r\n|\r|\n/).filter((x) => x && !x.startsWith('#')) : [];
  check(deepEqual(lines, want), () => ['notes differ from check_liveview_notes.txt', lines.filter((x) => !want.includes(x)), want.filter((x) => !lines.includes(x))]);
  return `notes equal check_liveview_notes.txt (${lines.length} lines)`;
}

export function main(argv) {
  const a = parseArgs('check_liveview.mjs', argv, [
    { opt: '--seed', type: 'int' },
    { opt: '--write-notes', type: 'flag' },
    { opt: '--only', type: 'str' },
    { opt: '--kernel', type: 'str', choices: ['native', 'none'] },
  ]);
  OSD_DEFAULTS.kernel = a.kernel ?? 'native';
  if (a.write_notes && OSD_DEFAULTS.kernel !== 'native') a.error('--write-notes pins the default (K-native) lab');
  if (a.only && a.write_notes) a.error('--write-notes needs a full run (the notes come from every group); drop --only');
  let only = null;
  if (a.only) {
    only = new Set(a.only.split(',').map((g) => g.trim().toUpperCase()));
    const unknown = sortStr([...only].filter((g) => !['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'].includes(g)));
    if (unknown.length) a.error(`--only: unknown group(s) ${unknown.join(', ')} (G1..G8)`);
  }
  if (a.write_notes && !process.env.OM_NOTES_DIR) a.error('--write-notes: needs OM_NOTES_DIR (the directory to write check_liveview_notes.txt in)');
  const seed = a.seed ?? 1;
  const run = (g) => only === null || only.has(g);
  try {
    const start = performance.now();
    fs.mkdirSync(OUT, { recursive: true });
    const image = loadImage();
    if (run('G1')) {
      let n, rows;
      withLab(new D.DisplayLab(env()), (lab) => { [n, rows] = g1_bus(lab); check(lab.image === image || wordsEq(lab.image, image)); });
      const text = rows.map(([k, b, s]) => `${k} x 0x${hx(s)} at ${h8(b)}`).join(', ');
      console.log(`G1 bus map and window: ${n} checks (table 0x602c2d61 = ${text}; 0x50036da4 return and 0x98100058 by `
        + 'the spec formulas, restore 0x17161514; segments 0x14/0x15/0x16 = CPU 0xa0/0xa8/0xb0 DRAM; bus-only '
        + 'RAM at 0x98d4d800 not aliased to DRAM; unbacked segment 0x17, offset 0x5c, byte 0 changed, '
        + '0x9810004c all fault)');
    }
    if (run('G2')) console.log('G2 VSC DMA map: ' + g2_dma_map(seed).join('; '));
    if (run('G3')) {
      const rng = newRandom(seed);
      for (const device of ['tft', 'evf']) withLab(session(device), (lab) => console.log('G3 TH register path: ' + g3_registers(lab, device, rng)));
    }
    const groups = [['G4', () => [...g4_composites('tft'), ...g4_composites('evf')]], ['G5', g5_out_of_domain],
      ['G6', () => g6_cmm(image)], ['G7', g7_cmd5], ['G8', g8_field_mode]];
    for (const [g, fn] of groups) if (run(g)) for (const line of fn()) console.log(`${g} ${line}`);
    if (only === null) console.log(check_notes(a.write_notes));
    else console.log('partial run: notes not checked: ' + NOTES.map(([k, v]) => `${k} ${v}`).join('; '));
    console.log(`all groups passed (${((performance.now() - start) / 1000).toFixed(1)} s)`);
  } catch (e) {
    if (e instanceof FirmwareError) throw new SystemExit(`FAILED: ${e.message}`);
    throw e;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) runMain('check_liveview.mjs', main);
