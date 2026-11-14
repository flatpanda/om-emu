// A Caduceus film's development hooks checked on their outputs, without pixels (analysis/caduceus-om3/README.md 4.6):
// on E147 with a caduceus-om3 release, the stock stage that each hook sits in is run by the debug call op through the
// supported scripting API (host/session.mjs input()) on a job written into the call's scratch, stopped where the hook
// jumps back into the stock code, and its output is compared with what the release's LOOKS.BIN defines for the film
// selected in the Picture Mode list. No Caduceus byte is in this file: patch.json, LOOKS.BIN and their source's tables
// are read from a checkout at run time.
//   lookhooksUnits    (firmware-free) the reader of their source's two tables (hl_lut, st_k) on a text the test
//                     writes, with its refusals; the three expectations (hlRecords, toneLut, splitTables) on made-up
//                     inputs: a neutral film leaves the stock output, the ends and the clamps, a field swapped in the
//                     film gives another output
//   lookhooksSession  (E147; needs OM_CADUCEUS, else not run and not counted) the release releases/$OM_CADUCEUS_RELEASE
//                     (v0.29 by default) as --patch with its LOOKS.BIN on a card the firmware formatted, a blank camera,
//                     S1 (their films loaded); then, on the blank camera and after FILM 20, 1, 2 and 3 are selected
//                     (S1, OK, OK, LEFT, OK; OK, OK, RIGHT x5, OK; OK, OK, RIGHT, OK twice):
//                     hue and lightness: the COLOR stage run from its entry, stopped where hl_pp jumps back; the 12
//                       records against the HSL builder's own output (the builder called alone with the registers the
//                       stage hands it) with hue and lightness replaced as their source defines for the film's record
//                     the RGB gamma stage run alone: its three tables, the job's input to st_run
//                     Blacks and Whites, split toning: the stage list entered at the luminance-LUT builder's call with
//                       the gamma stage's tables in the job, stopped before the tone call (the stock LUT) and at the
//                       stock tone step, where st_run jumps on (the LUT their tone hook remapped, the tables st_run bent)
//                     On the blank camera every output is the stock one; a film's outputs equal the expectations, and
//                     the expectation with a field swapped (hue / lightness, Blacks / Whites, the shadow / highlight
//                     colours) must not match where the film's values differ. Pokes: only the calls' writes into their
//                     own scratch, put back.
//   node emu/test/test_lookhooks.mjs [--units] [--session]   (OM_EMU_MODEL=E147 OM_CADUCEUS=CHECKOUT for the session)
//
// E147 facts used (D, the stock block; notation): the stage list 0x504f8694 (a0 = the job context C; ret [d2,d3,a2,a3],
// 48) calls the COLOR stage 0x504f7553 (frame 28), the luminance-LUT builder 0x504f7d92 at 0x504f87b0 and the stock tone
// step 0x504f7f84 at 0x504f87b7 (`mov d3,a0` then the call: the 7 bytes their tone hook replaces); the RGB gamma stage
// 0x504f5ab9 (frame 16) is called at 0x504f86dd. C+4 = the request R, C+12 = the output O, C+48 = the gamma stage's key,
// C+60 = flags the LUT builder tests with 0x4134063e (any set: build the LUT at O+3832, its pointer at O+3828; the
// default LUT where the build gives none). The COLOR stage reaches the HSL builder 0x504f7361 (frame 96) at 0x504f75f5
// when R+1568 = 0, R+12 != 61453 and R's key (R+8 << 24 | R+9 << 16 | R+10 u16) = 11, with d1 = O and a1 = R + 1739;
// the builder writes 12 records of 24 bytes from O+836, whose u16 at +18 and +22 it takes from its table (0 in every
// record, X). Their source (firmware/src/editor.s at the release's tag, D): hl_pp replaces that call and jumps back to
// 0x504f75fa; it writes record r's +18 = hue_lut[hue[perm[r]] + 7] and +22 = light_lut[light[perm[r]] + 7] (hl_lut)
// from the selected COLOR's slot when its H/L flag is set and all 24 values are -7..7; tone and st_run run in place of
// the call at 0x504f87b7 and end with a jump to 0x504f7f84. A film pick copies the LOOKS.BIN record's hue and
// lightness (+0..+23), Blacks (+39), Whites (+40), split toning (+53..+56) and Tone Balance (+58) into the slot of
// COLOR j / 5 and sets its H/L flag (pf_put, pf_bt). The tone remap and the split toning curve are their source's
// (tone; st_run, st_k), so those two checks are their code against their own definition.
import fs from 'node:fs';
import path from 'node:path';
import { readLooks } from './test_looks.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };

// ---- their source's tables ------------------------------------------------------------------------------------------
// editor.s text -> {hue: [15], light: [15], perm: [12], stk: [[r, g, b] x 12]}; throws when a table is not where and
// as their source has it (hl_lut: two .hword lines of 15 and a .byte line of 12; st_k: 12 .byte lines of 3)
export function theirTables(src) {
  const after = (label) => {
    const lines = String(src).split('\n'), i = lines.findIndex((l) => l.startsWith(`${label}:`));
    if (i < 0) throw new Error(`their source: no ${label}:`);
    return lines.slice(i + 1).filter((l) => !/^\s*(?:\*.*)?$/.test(l));      // a label's comment may go on below it
  };
  const nums = (line, dir) => {
    const m = new RegExp(`^\\s*\\.${dir}\\s+([-0-9, ]+?)\\s*(?:/\\*.*)?$`).exec(line ?? '');
    if (!m) throw new Error(`their source: ${JSON.stringify(line)} is not a .${dir} line`);
    return m[1].split(',').map((x) => Number(x.trim()));
  };
  const hl = after('hl_lut');
  const hue = nums(hl[0], 'hword'), light = nums(hl[1], 'hword'), perm = nums(hl[2], 'byte');
  if (hue.length !== 15 || light.length !== 15 || perm.length !== 12) throw new Error(`their source: hl_lut has ${hue.length}, ${light.length} and ${perm.length} values, not 15, 15 and 12`);
  if ([...perm].sort((a, b) => a - b).join() !== '0,1,2,3,4,5,6,7,8,9,10,11') throw new Error(`their source: hl_lut's perm ${perm} is not a permutation of 0..11`);
  const sk = after('st_k').slice(0, 12).map((l) => nums(l, 'byte'));
  if (sk.some((k) => k.length !== 3)) throw new Error('their source: st_k is not 12 lines of 3 bytes');
  return { hue, light, perm, stk: sk };
}

// ---- the expectations ------------------------------------------------------------------------------------------------
const u16 = (hex, i) => parseInt(hex.slice(4 * i + 2, 4 * i + 4) + hex.slice(4 * i, 4 * i + 2), 16);
const h16 = (v) => { const x = v & 0xffff; return (x & 0xff).toString(16).padStart(2, '0') + (x >>> 8).toString(16).padStart(2, '0'); };
const s16 = (v) => (v > 32767 ? v - 65536 : v);
export const halves = (hex) => Array.from({ length: hex.length / 4 }, (_, i) => u16(hex, i));
export const hexOf = (vals) => vals.map(h16).join('');
// the 12 HSL records (288 bytes as hex) hl_pp leaves: the builder's own records with +18 and +22 from the slot's hue
// and lightness (record +0..+23 of the film), or the builder's records when the H/L flag is off or a value is outside
// -7..7 (their gate)
export function hlRecords(stock, film, T) {
  if (!film || film.slice(0, 24).some((v) => v < -7 || v > 7)) return stock;
  const v = halves(stock);
  for (let r = 0; r < 12; r++) {
    const w = T.perm[r];
    v[12 * r + 9] = T.hue[film[w] + 7];
    v[12 * r + 11] = T.light[film[12 + w] + 7];
  }
  return hexOf(v);
}
// their tone remap of a 256-entry 10-bit LUT for Blacks B and Whites W (s8; outside -7..7 counts as 0); null: no
// remap (B = W = 0, the LUT stays as the stock stage left it)
export function toneLut(lut, B, W) {
  const b = B >= -7 && B <= 7 ? B : 0, w = W >= -7 && W <= 7 ? W : 0;
  if (b === 0 && w === 0) return null;
  const lo = b > 0 ? 8 * b : 0, cB = b < 0 ? -12 * b : 0, hi = 1023 + (w < 0 ? 10 * w : 0), cW = w > 0 ? 12 * w : 0;
  const K = (hi - lo) * 1025;
  let max = 0;
  return lut.map((y0) => {
    let y = Math.min(y0, 1023);
    const t = 1023 - y;
    y -= Math.floor(Math.floor(Math.floor(t * t / 1024) * t / 1024) * cB / 1024);
    if (y < 0) y = 0;
    y += Math.floor(Math.floor(Math.floor(y * y / 1024) * y / 1024) * cW / 1024);
    y = Math.min(y, 1023);
    y = lo + Math.floor((y * K + 0xfffff) / 2 ** 20);
    max = y < max ? max : y;
    return max;
  });
}
// st_run's tables: tabs [R, G, B] of 320 u16 each (256 entries and the 64 fine ones); split {sc, sv, hc, hv, bal}: the
// shadow colour and strength code, the highlight's, the Tone Balance (record +53..+56, +58); null: left as they are
// (no strength, or the three tables not one curve)
export function splitTables(tabs, split, T) {
  const str = (c, v) => (c >= 12 ? 0 : Math.min(10, v >= 0 ? 2 * v : -2 * v - 1));
  const ss = str(split.sc, split.sv), sh = str(split.hc, split.hv);
  if ((ss | sh) === 0) return null;
  if (tabs[0].some((x, i) => x !== tabs[1][i] || x !== tabs[2][i])) return null;
  const Ks = [0, 1, 2].map((ch) => (split.sc < 12 ? T.stk[split.sc][ch] : 0) * ss), Kh = [0, 1, 2].map((ch) => (split.hc < 12 ? T.stk[split.hc][ch] : 0) * sh);
  const bal = Math.max(-5, Math.min(5, split.bal)), c = 2048 - 256 * bal;
  const f1 = Math.trunc(134217728 / c), f2 = Math.trunc(134152192 / (4095 - c));
  return tabs.map((tab, ch) => {
    const out = [];
    for (const [a, n] of [[0, 256], [256, 64]]) {
      let max = 0;
      for (let i = a; i < a + n; i++) {
        const t = tab[i], u = t < c ? Math.floor(t * f1 / 65536) : Math.floor((t - c) * f2 / 65536) + 2048, s = 4095 - u;
        const ws = Math.floor(Math.floor(u * s / 4096) * s / 4096), wh = Math.floor(Math.floor(u * u / 4096) * s / 4096);
        let y = t + ((Ks[ch] * ws + Kh[ch] * wh) >> 9);
        y = Math.min(4095, Math.max(0, y));
        max = y < max ? max : y;
        out.push(max);
      }
    }
    return out;
  });
}
// a film's slot values the hooks read (their pf_bt: record +39, +40 -> slot +47, +48; +53..+56 -> +55..+58; +58 -> +33)
export const filmTone = (r) => ({ B: r[39], W: r[40], split: { sc: r[53] & 0xff, sv: r[54], hc: r[55] & 0xff, hv: r[56], bal: r[58] } });

// ---- firmware-free ---------------------------------------------------------------------------------------------------
const FAKE_SRC = [
  'x:', 'hl_lut:      /* comment */',
  ' .hword 70,60,50,40,30,20,10,0,-10,-20,-30,-40,-50,-60,-70',
  ' .hword -3,-2,-2,-1,-1,0,0,0,1,1,1,2,2,3,3',
  ' .byte 0,2,4,6,8,10,1,3,5,7,9,11',
  'st_k:                             /* K',
  '                                   * per step */',
  ...Array.from({ length: 12 }, (_, i) => ` .byte ${i},${-i},${i % 3}          /* colour ${i} */`),
  ' .align 2'].join('\n');
export function lookhooksUnits() {
  const t = tester(), { ok } = t;
  const T = theirTables(FAKE_SRC);
  ok(T.hue[0] === 70 && T.hue[14] === -70 && T.light[8] === 1 && T.perm[6] === 1 && T.stk[5].join() === '5,-5,2', `theirTables: ${JSON.stringify(T)}`);
  const refused = (src, re, what) => { const e = thrown(() => theirTables(src)); ok(e && re.test(e.message), `${what}: ${e?.message ?? 'taken'}`); };
  refused(FAKE_SRC.replace('hl_lut:', 'hl_lux:'), /no hl_lut/, 'a source without hl_lut refused');
  refused(FAKE_SRC.replace(',-70\n', '\n'), /14, 15 and 12/, 'a short hue table refused');
  refused(FAKE_SRC.replace('0,2,4,6,8,10,1', '0,2,4,6,8,10,10'), /permutation/, 'a perm that repeats a record refused');
  refused(FAKE_SRC.replace(' .byte 11,-11,2', ' .byte 11,-11'), /12 lines of 3/, 'a short st_k line refused');
  // hl_pp: a stock output of 12 records with a marker in every other field
  const stock = hexOf(Array.from({ length: 144 }, (_, i) => ([9, 11].includes(i % 12) ? 0 : 1000 + i)));
  const film = Array.from({ length: 64 }, (_, i) => (i < 12 ? (i % 5) - 2 : i < 24 ? 2 - ((i - 12) % 5) : 0));
  const got = halves(hlRecords(stock, film, T));
  ok(got[9] === T.hue[film[0] + 7] && got[12 * 6 + 9] === T.hue[film[1] + 7] && got[12 * 6 + 11] === T.light[film[13] + 7] && got[12 * 11 + 11] === T.light[film[23] + 7],
    `hlRecords: records 0, 6 and 11 from hue[0], hue[1], light[1] and light[11]: ${got.filter((_, i) => [9, 11].includes(i % 12))}`);
  ok(got.every((v, i) => [9, 11].includes(i % 12) || v === 1000 + i), 'hlRecords: the other 20 bytes of each record as the builder left them');
  ok(hlRecords(stock, new Array(64).fill(0), T) === stock && hlRecords(stock, null, T) === stock, 'hlRecords: a neutral film (and no film) leaves the builder\'s records (their table: 0 at the middle)');
  ok(hlRecords(stock, film.map((v, i) => (i === 3 ? 8 : v)), T) === stock, 'hlRecords: a value outside -7..7 leaves the builder\'s records (their gate)');
  const swapped = [...film.slice(12, 24), ...film.slice(0, 12), ...film.slice(24)];
  ok(hlRecords(stock, swapped, T) !== hlRecords(stock, film, T), 'hlRecords: hue and lightness swapped give other records');
  // tone
  const lut = Array.from({ length: 256 }, (_, i) => Math.round((i * 1023) / 255));
  ok(toneLut(lut, 0, 0) === null && toneLut(lut, 9, 0) === null, 'toneLut: B = W = 0 (or B outside -7..7) is no remap');
  const b1 = toneLut(lut, 1, 0);
  ok(b1[0] === 8 && b1[255] === 1023 && b1.every((v, i) => i === 0 || v >= b1[i - 1]), `toneLut: Blacks +1 lifts black to 8, keeps white and the LUT rising: ${b1.slice(0, 4)} .. ${b1[255]}`);
  const w1 = toneLut(lut, 0, -1), bm = toneLut(lut, -3, 2);
  ok(w1[255] === 1013 && w1[0] === 0 && bm[0] === 0 && bm[255] === 1023 && bm[64] < lut[64], `toneLut: Whites -1 caps white at 1013; Blacks -3 crushes the toe: ${w1[255]} ${bm[64]}`);
  ok(JSON.stringify(toneLut(lut, 2, 0)) !== JSON.stringify(toneLut(lut, 0, 2)), 'toneLut: Blacks and Whites swapped give another LUT');
  // st_run
  const curve = Array.from({ length: 320 }, (_, i) => (i < 256 ? 16 * i + (i > 200 ? 15 : 0) : 4 * (i - 256)));
  const tabs = [curve, curve.slice(), curve.slice()];
  ok(splitTables(tabs, { sc: 3, sv: 0, hc: 7, hv: 0, bal: 0 }, T) === null && splitTables(tabs, { sc: 12, sv: 3, hc: 0, hv: 0, bal: 0 }, T) === null, 'splitTables: no strength, or a colour past 11, is no change');
  ok(splitTables([curve, curve.map((x) => x + 1), curve], { sc: 3, sv: 1, hc: 0, hv: 0, bal: 0 }, T) === null, 'splitTables: R, G and B not one curve is no change');
  const sp = splitTables(tabs, { sc: 5, sv: 2, hc: 0, hv: 0, bal: 0 }, T);
  ok(sp[0][0] === 0 && sp[0][255] === curve[255] && sp[0][128] > curve[128] && sp[1][128] < curve[128] && sp[2][128] === curve[128] + ((T.stk[5][2] * 4 * Math.floor(Math.floor(2048 * 2047 / 4096) * 2047 / 4096)) >> 9),
    `splitTables: shadows on colour 5 (K ${T.stk[5]} x 4) bend the middle and keep the ends: R ${sp[0][128]} G ${sp[1][128]} B ${sp[2][128]}, stock ${curve[128]}`);
  ok(sp.every((tab) => tab.slice(0, 256).every((v, i) => i === 0 || v >= tab[i - 1]) && tab.slice(256).every((v, i) => i === 0 || v >= tab[255 + i])), 'splitTables: each part kept rising');
  ok(JSON.stringify(splitTables(tabs, { sc: 5, sv: 2, hc: 9, hv: -1, bal: 0 }, T)) !== JSON.stringify(splitTables(tabs, { sc: 9, sv: -1, hc: 5, hv: 2, bal: 0 }, T)), 'splitTables: shadow and highlight swapped give other tables');
  ok(JSON.stringify(splitTables(tabs, { sc: 5, sv: 2, hc: 9, hv: 1, bal: 3 }, T)) !== JSON.stringify(splitTables(tabs, { sc: 5, sv: 2, hc: 9, hv: 1, bal: 0 }, T)), 'splitTables: the Tone Balance moves the hand-over');
  const ft = filmTone(Object.assign(new Array(64).fill(0), { 39: 2, 40: -1, 53: 7, 54: 1, 55: 0, 56: -2, 58: 3 }));
  ok(ft.B === 2 && ft.W === -1 && JSON.stringify(ft.split) === '{"sc":7,"sv":1,"hc":0,"hv":-2,"bal":3}', `filmTone: ${JSON.stringify(ft)}`);
  return t;
}

// ---- E147 with a caduceus-om3 release --------------------------------------------------------------------------------
const STAGES = 0x504f8694, COLOR = 0x504f7553, HSL_CALL = 0x504f75f5, HSL_BACK = 0x504f75fa, HSL = 0x504f7361;
const GAMMA = 0x504f5ab9, LUT_CALL = 0x504f87b0, TONE_CALL = 0x504f87b7, TONE_STEP = 0x504f7f84, CGET = 0x50042360, RT = 0x10021020;
const FRAME = { [STAGES]: [0xf0, 48], [COLOR]: [0xf0, 28], [HSL]: [0xf0, 96], [GAMMA]: [0xf0, 16] };
// the job in the call's scratch: C at +0, R at +RQ, O at +O (O+4380 is the last word the HSL builder writes)
const RQ = 0x100, O = 0x1000, SIZE = 0x2200, OLEN = 4400;
const JOB = [['scratch+4', `=scratch+${RQ}`], ['scratch+12', `=scratch+${O}`], ['scratch+48', '=11'], ['scratch+60', '=0x4134063e'],
  [`scratch+${RQ + 8}`, '00000b00'],             // R's key 11 (COLOR), as the COLOR stage, tone and st_run test it
  [`scratch+${RQ + 14}`, '0010'],                // R+14 0x1000: the gamma stage's column for a still (their notes)
  [`scratch+${RQ + 1660}`, '4014301840143018']]; // an image size: the gamma stage divides by it (their stage test's)
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const le32 = (hex, off) => parseInt(hex.slice(2 * off, 2 * off + 8).match(/../g).reverse().join(''), 16) >>> 0;

// their editor.s for release rel: the tag's (git show) when the checkout has it, else the working tree's
async function theirSource(root, rel) {
  const { spawnSync } = await import('node:child_process');
  const g = spawnSync('git', ['-C', root, 'show', `${rel}:firmware/src/editor.s`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (g.status === 0) return { text: g.stdout, from: `tag ${rel}` };
  const f = path.join(root, 'firmware/src/editor.s');
  return { text: fs.readFileSync(f, 'utf8'), from: 'the working tree (no tag)' };
}

export async function lookhooksSession() {
  const t = tester(), { ok } = t;
  const root = process.env.OM_CADUCEUS;
  if (!root) return Object.assign(t, { notRun: 'OM_CADUCEUS is not set (a caduceus-om3 checkout)' });
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_lookhooks: the session needs OM_EMU_MODEL=E147, not ${MODEL}`); return t; }
  const rel = process.env.OM_CADUCEUS_RELEASE || 'v0.29';
  t.release = rel;
  const R = path.join(root, 'releases', rel);
  const patchFile = path.join(R, 'patch.json'), looksFile = path.join(R, 'LOOKS.BIN');
  if (!fs.existsSync(patchFile) || !fs.existsSync(looksFile)) { ok(false, `test_lookhooks: ${R} has no patch.json and LOOKS.BIN`); return t; }
  const looks = readLooks(fs.readFileSync(looksFile));
  const src = await theirSource(root, rel);
  t.source = src.from;
  let T;
  try { T = theirTables(src.text); } catch (e) { ok(false, `${e.message} (${src.from})`); return t; }
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-lookhooks-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const P = (...p) => path.join(tmp, ...p);
  const { spawnSync } = await import('node:child_process');
  const nc = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', P('card.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
  ok(nc.status === 0, `card.mjs new: rc ${nc.status} ${nc.stderr.slice(0, 300)}`);
  const { openSession } = await import('../host/session.mjs');
  const said = [];
  const s = await openSession({ model: 'E147', patch: [patchFile], card: P('card.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${looksFile}`], nvram: P('nv.json'), out: P('out'), say: (l) => said.push(l) });
  t.values = {};
  try {
    let failed = null;
    const st = (tok) => { if (failed) return {}; const r = s.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `step ${r.step} ${failed}`); } return r; };
    const run = (text) => text.split(' ').forEach(st);
    // one call through input(): the op's answer, or a failed check (and null) when it refuses or fails
    const call = (what, q) => {
      if (failed) return null;
      const r = s.input({ type: 'debug', op: 'call', ...q });
      const d = r.debug ?? r;
      if (!d.ok) { failed = `${what}: ${d.error ?? JSON.stringify(d).slice(0, 300)}`; ok(false, failed); return null; }
      return d;
    };
    const job = (more = []) => ({ scratch: SIZE, restore: true, mem: [...JOB, ...more], limit: 5000000 });
    const stopped = (what, d, pc) => { ok(d?.end === 'stop' && d.stop?.notation === h8(pc), `${what}: ends at ${h8(pc)}: ${d?.end} ${d?.stop?.notation}`); return d?.end === 'stop'; };
    // the hooked sites hold their jumps (not the stock call / mov at the call's first byte)
    run('wait:1500');
    const at = (pc, n) => st(`read:${h8(pc + RT)}:${n}`).hex ?? '';
    ok(!at(HSL_CALL, 1).startsWith('cd') && !at(TONE_CALL, 1).startsWith('f1'), `the hook sites are patched: ${h8(HSL_CALL)} ${at(HSL_CALL, 5)}, ${h8(TONE_CALL)} ${at(TONE_CALL, 7)}`);
    run('s1 wait:1200');
    // the hooks' outputs on the camera as it stands: {stock, hooked} records, LUTs and tables
    const outputs = (tag) => {
      const out = { tag };
      // hue and lightness: the registers the COLOR stage hands the HSL builder, the builder alone, the stage with hl_pp
      const a = call(`${tag}: the COLOR stage to the HSL call`, { fn: COLOR, frame: FRAME[COLOR], regs: { a0: 'scratch' }, stops: [HSL_CALL], ...job() });
      if (!a || !stopped(`${tag}: the COLOR stage`, a, HSL_CALL)) return null;
      const base = parseInt(a.regs.a2, 16), rel = (v) => `scratch+${parseInt(v, 16) - base}`;
      ok(a.regs.d1 === h8(base + O) && a.regs.a1 === h8(base + RQ + 1739), `${tag}: the HSL builder gets d1 = O, a1 = R + 1739: ${a.regs.d1} ${a.regs.a1} (C ${a.regs.a2})`);
      const b = call(`${tag}: the HSL builder alone`, { fn: HSL, frame: FRAME[HSL], regs: { d0: a.regs.d0, d1: rel(a.regs.d1), a0: a.regs.a0, a1: rel(a.regs.a1) }, read: [[`scratch+${O + 836}`, 288]], ...job() });
      const c = call(`${tag}: the COLOR stage with hl_pp`, { fn: COLOR, frame: FRAME[COLOR], regs: { a0: 'scratch' }, stops: [HSL_BACK], read: [[`scratch+${O + 836}`, 288]], ...job() });
      if (!b || !c || b.end !== 'return' || !stopped(`${tag}: the COLOR stage with hl_pp`, c, HSL_BACK)) return null;
      out.hl = { stock: b.reads[0].hex, hooked: c.reads[0].hex };
      // the gamma stage alone: its three tables and their pointers
      const g = call(`${tag}: the RGB gamma stage`, { fn: GAMMA, frame: FRAME[GAMMA], regs: { a0: 'scratch' }, read: [[`scratch+${O + 1252}`, 1932]], ...job() });
      if (!g || g.end !== 'return') return null;
      const gb = parseInt(g.scratch, 16), gh = g.reads[0].hex;
      ok([0, 1, 2].every((ch) => le32(gh, 1920 + 4 * ch) === gb + O + 1252 + 640 * ch), `${tag}: the gamma stage points O+3172.. at its own three tables: ${[0, 1, 2].map((ch) => h8(le32(gh, 1920 + 4 * ch)))} (O ${h8(gb + O)})`);
      const tabs = [0, 1, 2].map((ch) => halves(gh.slice(1280 * ch, 1280 * ch + 1280)));
      // the stage list from the LUT builder's call: stopped before the tone call (the stock LUT) and at the stock tone step
      const more = [[`scratch+${O + 1252}`, gh.slice(0, 3840)], ...[0, 1, 2].map((ch) => [`scratch+${O + 3172 + 4 * ch}`, `=scratch+${O + 1252 + 640 * ch}`])];
      const q = { fn: STAGES, frame: FRAME[STAGES], entry: LUT_CALL, regs: { d3: 'scratch' }, read: [[`scratch+${O}`, OLEN]], ...job(more) };
      const l0 = call(`${tag}: the stage list to the tone call`, { ...q, stops: [TONE_CALL] });
      const l1 = call(`${tag}: the stage list to the stock tone step`, { ...q, stops: [TONE_STEP] });
      if (!l0 || !l1 || !stopped(`${tag}: the LUT builder`, l0, TONE_CALL) || !stopped(`${tag}: tone and st_run`, l1, TONE_STEP)) return null;
      const o0 = l0.reads[0].hex, o1 = l1.reads[0].hex, b0 = parseInt(l0.scratch, 16), b1 = parseInt(l1.scratch, 16);
      const lp = le32(o0, 3828);
      ok(lp !== 0, `${tag}: the LUT builder leaves a LUT pointer at O+3828: ${h8(lp)}`);
      const lutHex = lp === b0 + O + 3832 ? o0.slice(2 * 3832, 2 * 3832 + 1024) : st(`read:${h8(lp)}:512`).hex;
      out.tone = { ptr0: lp, ptr1: le32(o1, 3828), own: b1 + O + 3832, stock: halves(lutHex), hooked: halves(o1.slice(2 * 3832, 2 * 3832 + 1024)) };
      out.split = { stock: tabs, before: [0, 1, 2].map((ch) => halves(o0.slice(2 * (1252 + 640 * ch), 2 * (1252 + 640 * ch) + 1280))), hooked: [0, 1, 2].map((ch) => halves(o1.slice(2 * (1252 + 640 * ch), 2 * (1252 + 640 * ch) + 1280))) };
      out.profile = Number(call(`${tag}: the effective COLOR profile`, { fn: CGET, regs: { d0: 63153, d1: 0, a0: 0 } })?.regs.d0);
      return out;
    };
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    // the blank camera: no film selected, every output the stock one
    const blank = outputs('the blank camera');
    if (blank) {
      ok(blank.hl.hooked === blank.hl.stock, 'the blank camera: hl_pp leaves the HSL builder\'s records');
      ok(blank.tone.ptr1 === blank.tone.ptr0 && same(blank.split.hooked, blank.split.stock), `the blank camera: tone leaves the LUT pointer (${h8(blank.tone.ptr1)}) and st_run the tables`);
      ok(same(blank.split.before, blank.split.stock), 'the LUT builder leaves the gamma stage\'s tables');
      t.values.blank = { lut0: blank.tone.stock.slice(0, 4), curve0: blank.split.stock[0].slice(0, 4) };
    }
    const seen = [];
    for (const [j, keys] of [[19, 'ok ok left ok'], [0, 'ok ok right right right right right ok'], [1, 'ok ok right ok'], [2, 'ok ok right ok']]) {
      run(keys);
      const { record, name } = looks.films[j], tag = `FILM ${j + 1} (${name})`, k = Math.floor(j / 5);
      const o = outputs(tag);
      if (!o) break;
      ok(o.profile === k + 1, `${tag}: the effective COLOR profile is ${o.profile}, want COLOR ${k + 1}`);
      // hue and lightness
      const want = hlRecords(o.hl.stock, record, T), swapped = hlRecords(o.hl.stock, [...record.slice(12, 24), ...record.slice(0, 12), ...record.slice(24)], T);
      const diff = halves(o.hl.hooked).map((v, i) => [i, v, halves(want)[i]]).filter(([, v, w]) => v !== w).map(([i, v, w]) => `record ${Math.floor(i / 12)} +${2 * (i % 12)}: ${s16(v)} want ${s16(w)}`);
      ok(diff.length === 0, `${tag}: hl_pp's records against LOOKS.BIN's hue and lightness: ${diff.slice(0, 6).join('; ')}`);
      if (swapped !== want) ok(o.hl.hooked !== swapped, `${tag}: control: the records do not match the film's hue and lightness swapped`);
      // Blacks and Whites
      const { B, W, split } = filmTone(record), lut = toneLut(o.tone.stock, B, W);
      if (lut === null) ok(o.tone.ptr1 === o.tone.ptr0, `${tag}: Blacks = Whites = 0: tone leaves the LUT pointer: ${h8(o.tone.ptr1)} want ${h8(o.tone.ptr0)}`);
      else {
        const bad = lut.map((v, i) => [i, o.tone.hooked[i], v]).filter(([, g, w]) => g !== w);
        ok(o.tone.ptr1 === o.tone.own && bad.length === 0, `${tag}: tone's LUT (Blacks ${B}, Whites ${W}) at O+3832 (pointer ${h8(o.tone.ptr1)}, want ${h8(o.tone.own)}): [index, lab, want] ${JSON.stringify(bad.slice(0, 6))}`);
        const sw = toneLut(o.tone.stock, W, B);
        if (sw !== null && !same(sw, lut)) ok(!same(o.tone.hooked, sw), `${tag}: control: the LUT does not match Blacks and Whites swapped`);
      }
      // split toning
      const tabs = splitTables(o.split.stock, split, T);
      if (tabs === null) ok(same(o.split.hooked, o.split.stock), `${tag}: no split toning: st_run leaves the tables`);
      else {
        const bad = [];
        tabs.forEach((tab, ch) => tab.forEach((v, i) => { if (o.split.hooked[ch][i] !== v) bad.push(['RGB'[ch], i, o.split.hooked[ch][i], v]); }));
        ok(bad.length === 0, `${tag}: st_run's tables (shadows ${split.sc}/${split.sv}, highlights ${split.hc}/${split.hv}, balance ${split.bal}): [channel, index, lab, want] ${JSON.stringify(bad.slice(0, 6))}`);
        const sw = splitTables(o.split.stock, { ...split, sc: split.hc, sv: split.hv, hc: split.sc, hv: split.sv }, T);
        if (sw !== null && !same(sw, tabs)) ok(!same(o.split.hooked, sw), `${tag}: control: the tables do not match shadows and highlights swapped`);
      }
      seen.push({ j, hl: o.hl.hooked !== o.hl.stock, tone: o.tone.ptr1 !== o.tone.ptr0, split: !same(o.split.hooked, o.split.stock) });
      t.values[`FILM ${j + 1}`] = { name, hue: record.slice(0, 12), light: record.slice(12, 24), B, W, split,
        records: halves(o.hl.hooked).filter((_, i) => [9, 11].includes(i % 12)).map(s16),
        lut: [0, 16, 64, 128, 192, 255].map((i) => [i, o.tone.stock[i], o.tone.hooked[i]]),
        curve: [0, 32, 64, 128, 192, 255].map((i) => [i, o.split.stock[0][i], ...o.split.hooked.map((tab) => tab[i])]) };
    }
    ok(seen.length === 4 && seen.every((x) => x.hl && x.tone) && seen.some((x) => x.split) && seen.some((x) => !x.split),
      `control: every film moved the HSL records and the LUT, and among them one moved the gamma tables and one did not: ${JSON.stringify(seen)}`);
  } finally {
    const sum = s.close();
    const own = (p) => p.token === 'input' && p.input?.op === 'call' && p.input.restore === true && p.input.mem.every(([a, v]) => /^scratch/.test(a) && (!String(v).startsWith('=') || /^=(?:scratch|0x|\d)/.test(v)));
    ok(sum.pokes.every(own) && sum.harness_inputs.length === 0 && (sum.patch_audit?.hooks ?? []).length === 0,
      `pokes only the calls' writes into their own scratch, put back; no harness input, no lab hook on patched bytes: ${JSON.stringify({ pokes: sum.pokes.filter((p) => !own(p)).length, harness: sum.harness_inputs, audit: sum.patch_audit?.hooks })}`);
    ok(said.some((l) => /patched firmware: \d+ patches/.test(l)), `the release taken as --patch: ${said[0]}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = lookhooksUnits();
    console.log(`Caduceus look hooks on their outputs, units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await lookhooksSession();
    if (s.notRun) console.log(`Caduceus look hooks on their outputs, E147: not run (${s.notRun})`);
    else console.log(`Caduceus look hooks on their outputs, E147 (${s.release}${s.source ? `, their tables from ${s.source}` : ''}):${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    if (process.env.OM_LOOKHOOKS_VALUES) console.log(JSON.stringify(s.values));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
