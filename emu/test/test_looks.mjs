// A Caduceus film checked below the pixels (analysis/caduceus-om3/README.md 4.6): the values a film of a caduceus-om3
// release hands to the OM-3's own image pipeline, read on E147 through the supported scripting API (host/session.mjs)
// and compared with what the release's LOOKS.BIN defines for that film. No Caduceus byte is in this file: the release's
// patch.json and LOOKS.BIN are read from a checkout at run time, and the hook targets from the running image.
//   looksUnits    (firmware-free) the LOOKS.BIN reader (their docs/FORMATS.md: 1632 bytes, 'OM3P', the CRC-32 of bytes
//                 12.., version 1, 20 records of 64 bytes, 20 names of 16) on files the test writes, with its refusals
//                 (size, magic, CRC, version, count); the values a film gives (filmSettings: the 18 settings of its
//                 COLOR; filmHooks: the WB fine-tune and Sharpness reads) on a made-up record, against the record of
//                 another film (they must differ), the WB shift off and its clamp to -7..7, Sharp's ends
//   looksSession  (E147; needs OM_CADUCEUS, a caduceus-om3 checkout, else not run and not counted) the release
//                 releases/$OM_CADUCEUS_RELEASE (v0.29 by default) as --patch with its LOOKS.BIN put on a card the
//                 firmware formatted, a blank camera: FILM 1, 2 and 3 selected in the Picture Mode list as a user does
//                 (S1, OK, OK, RIGHT x4, OK; then OK, OK, RIGHT, OK twice); after each, the 18 settings of COLOR 1
//                 read by the camera's settings getter equal the film's record; the capture's WB fine-tune reads
//                 (the EXIF set's call site, keys 34041 and 38521) and Sharpness read (key 33049), whose call targets
//                 are read from the patched image, answer the camera's own getter plus the film's shift, or the film's
//                 Sharp; S2 on FILM 3 writes 'FILM 3 <its name>' into the picture's ImageDescription; no poke and no
//                 harness input. Controls: each film's values against the previous film's record (they must differ:
//                 a selection that changed nothing fails), the WB reads equal the camera's own getter on a film whose
//                 WB shift is off and differ on one whose shift is on, the call sites are hooked (their targets are not
//                 the stock getter), and the films are the ones the UI shows (the Exif name)
//   node emu/test/test_looks.mjs [--units] [--session]     (OM_EMU_MODEL=E147 OM_CADUCEUS=CHECKOUT for the session)
//
// E147 facts used (D, the stock block; run-time = notation + 0x10021020): the settings getter 0x503cf0f1 (d0 id ->
// value), the capture-safe getter 0x50042360 (d0 key -> value), the EXIF set's WB fine-tune read `call 0x50042360,[d2,d3],12`
// at 0x50436962 (key 34041 A-B, stored at the shot's +37734; its G-M twin at 0x5043697c), the stills Sharpness read at
// 0x503c665f (key 33049). The 18 settings a film writes for COLOR k (their firmware/src/editor.s pf_put / pf_ids, D):
// Saturation 928 + 12k + s <- record +24 + s (s = 0..11), Contrast 908 + k <- +41, Sharpness 904 + k <- +42, Shading
// 912 + k <- +43, Shadows 978 + 3k <- +44, Midtones 977 + 3k <- +45, Highlights 976 + 3k <- +46. Their WB read hook
// (wb_get, D) adds the record's A-B (+37) or G-M (+38) to the camera's value, clamped to -7..7, when the record's WB
// shift is on (+36 = 1); their Sharpness hook (xb_nr, D) answers the record's Sharp (+52), above 2 as 2 and -5 or below
// as -7. Film j (0..19) is COLOR j / 5's look j % 5 + 1.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const s8 = (x) => (x > 127 ? x - 256 : x);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const LOOKS_SIZE = 1632, RECORDS = 20;
// LOOKS.BIN -> {selection, films: [{record: [64 signed bytes], name}]}; throws on a file the camera would ignore
export function readLooks(bytes) {
  const b = Uint8Array.from(bytes);
  if (b.length !== LOOKS_SIZE) throw new Error(`LOOKS.BIN: ${b.length} bytes, not ${LOOKS_SIZE}`);
  const dv = new DataView(b.buffer);
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'OM3P') throw new Error('LOOKS.BIN: no OM3P magic');
  if (dv.getUint32(4, true) !== LOOKS_SIZE) throw new Error(`LOOKS.BIN: length word ${dv.getUint32(4, true)}`);
  const crc = zlib.crc32(b.subarray(12)) >>> 0;
  if (dv.getUint32(8, true) !== crc) throw new Error(`LOOKS.BIN: CRC-32 ${dv.getUint32(8, true).toString(16)}, the bytes give ${crc.toString(16)}`);
  if (dv.getUint16(12, true) !== 1 || dv.getUint16(14, true) !== RECORDS) throw new Error(`LOOKS.BIN: version ${dv.getUint16(12, true)}, count ${dv.getUint16(14, true)}`);
  const films = [];
  for (let j = 0; j < RECORDS; j++) {
    const record = [...b.subarray(32 + 64 * j, 96 + 64 * j)].map(s8);
    const raw = b.subarray(1312 + 16 * j, 1328 + 16 * j);
    const name = String.fromCharCode(...raw.subarray(0, raw.indexOf(0) < 0 ? 16 : raw.indexOf(0)));
    films.push({ record, name });
  }
  return { selection: [...b.subarray(16, 20)], films };
}
// the 18 settings film record r writes for COLOR k: [[id, value], ...]
export function filmSettings(r, k) {
  const out = [];
  for (let s = 0; s < 12; s++) out.push([928 + 12 * k + s, r[24 + s]]);
  out.push([908 + k, r[41]], [904 + k, r[42]], [912 + k, r[43]], [978 + 3 * k, r[44]], [977 + 3 * k, r[45]], [976 + 3 * k, r[46]]);
  return out;
}
// what the hooked capture reads answer for film record r, given the camera's own values {ab, gm}
export function filmHooks(r, stock) {
  const wb = (v, d) => (r[36] === 1 && d >= -7 && d <= 7 ? clamp(s8(v & 0xff) + d, -7, 7) : v);
  return { ab: wb(stock.ab, r[37]), gm: wb(stock.gm, r[38]), sharp: r[52] > 2 ? 2 : r[52] <= -5 ? -7 : r[52] };
}
// the ids whose values differ: [[id, got, want], ...]
export const settingDiff = (got, want) => want.filter(([id, v]) => got[id] !== v).map(([id, v]) => [id, got[id], v]);

// a LOOKS.BIN of the test's own: record j's bytes from rec(j), names 'T<j>'
export function makeLooks(rec) {
  const b = new Uint8Array(LOOKS_SIZE), dv = new DataView(b.buffer);
  b.set([0x4f, 0x4d, 0x33, 0x50]);
  dv.setUint32(4, LOOKS_SIZE, true);
  dv.setUint16(12, 1, true);
  dv.setUint16(14, RECORDS, true);
  for (let j = 0; j < RECORDS; j++) {
    rec(j).forEach((v, i) => { b[32 + 64 * j + i] = v & 0xff; });
    [...`T${j}`].forEach((c, i) => { b[1312 + 16 * j + i] = c.charCodeAt(0); });
  }
  dv.setUint32(8, zlib.crc32(b.subarray(12)) >>> 0, true);
  return b;
}

// ---- firmware-free ---------------------------------------------------------------------------------------------
export function looksUnits() {
  const t = tester(), { ok } = t;
  const rec = (j) => { const r = new Array(64).fill(0); for (let s = 0; s < 12; s++) r[24 + s] = ((j + s) % 11) - 5; r[36] = j % 2; r[37] = 3; r[38] = -6; r[41] = 1; r[44] = -j % 8; r[52] = j === 3 ? 4 : j === 4 ? -5 : -1; return r; };
  const file = makeLooks(rec);
  const lk = readLooks(file);
  ok(lk.films.length === 20 && lk.films[7].name === 'T7' && JSON.stringify(lk.films[7].record) === JSON.stringify(rec(7)) && JSON.stringify(lk.selection) === '[0,0,0,0]',
    `readLooks: ${lk.films[7]?.name} ${JSON.stringify(lk.films[7]?.record)}`);
  const refused = (f, re, what) => { const e = thrown(() => readLooks(f)); ok(e && re.test(e.message), `${what}: ${e?.message ?? 'taken'}`); };
  refused(file.subarray(0, 1631), /1631 bytes/, 'a short file refused');
  const m = Uint8Array.from(file); m[0] = 0x58; refused(m, /magic/, 'a bad magic refused');
  const c = Uint8Array.from(file); c[32 + 64 * 5 + 24] ^= 1; refused(c, /CRC-32/, 'a changed record without its CRC refused');
  const v = Uint8Array.from(file); new DataView(v.buffer).setUint16(14, 19, true); new DataView(v.buffer).setUint32(8, zlib.crc32(v.subarray(12)) >>> 0, true); refused(v, /count 19/, 'a count of 19 refused');
  // the 18 settings: COLOR 2 (k = 1) of record 6
  const s6 = filmSettings(rec(6), 1);
  ok(s6.length === 18 && s6[0][0] === 940 && s6[0][1] === rec(6)[24] && s6[11][0] === 951 && JSON.stringify(s6.slice(12)) === JSON.stringify([[909, 1], [905, 0], [913, 0], [981, rec(6)[44]], [980, 0], [979, 0]]),
    `filmSettings: ${JSON.stringify(s6)}`);
  const got = Object.fromEntries(s6);
  ok(settingDiff(got, s6).length === 0 && settingDiff(got, filmSettings(rec(7), 1)).length > 0, `settingDiff: its own record matches, the next film's does not: ${JSON.stringify(settingDiff(got, filmSettings(rec(7), 1)))}`);
  // the hooked reads
  const h1 = filmHooks(rec(1), { ab: 0, gm: 0 }), h2 = filmHooks(rec(2), { ab: 0, gm: 0 });
  ok(h1.ab === 3 && h1.gm === -6 && h1.sharp === -1, `filmHooks, WB shift on: ${JSON.stringify(h1)}`);
  ok(h2.ab === 0 && h2.gm === 0, `filmHooks, WB shift off: the camera's own values: ${JSON.stringify(h2)}`);
  const h1c = filmHooks(rec(1), { ab: 6, gm: -3 });
  ok(h1c.ab === 7 && h1c.gm === -7, `filmHooks: the sum clamped to -7..7: ${JSON.stringify(h1c)}`);
  ok(filmHooks(rec(3), { ab: 0, gm: 0 }).sharp === 2 && filmHooks(rec(4), { ab: 0, gm: 0 }).sharp === -7, 'filmHooks: Sharp above 2 as 2, -5 as -7');
  return t;
}

// ---- E147 with a caduceus-om3 release --------------------------------------------------------------------------
const GETTER = 0x503cf0f1, CGET = 0x50042360, RT = 0x10021020;
const WB_SITE = 0x50436962, SHARP_SITE = 0x503c665f;
const KEY_AB = 34041, KEY_GM = 38521, KEY_SHARP = 33049;
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

export async function looksSession() {
  const t = tester(), { ok } = t;
  const root = process.env.OM_CADUCEUS;
  if (!root) return Object.assign(t, { notRun: 'OM_CADUCEUS is not set (a caduceus-om3 checkout)' });
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E147') { ok(false, `test_looks: the session needs OM_EMU_MODEL=E147, not ${MODEL}`); return t; }
  const rel = process.env.OM_CADUCEUS_RELEASE || 'v0.29';
  t.release = rel;
  const R = path.join(root, 'releases', rel);
  const patchFile = path.join(R, 'patch.json'), looksFile = path.join(R, 'LOOKS.BIN');
  if (!fs.existsSync(patchFile) || !fs.existsSync(looksFile)) { ok(false, `test_looks: ${R} has no patch.json and LOOKS.BIN`); return t; }
  const looks = readLooks(fs.readFileSync(looksFile));
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-looks-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const T = (...p) => path.join(tmp, ...p);
  const { spawnSync } = await import('node:child_process');
  const nc = spawnSync(process.execPath, [path.join(EMU, 'bin/card.mjs'), 'new', T('card.omsd'), '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
  ok(nc.status === 0, `card.mjs new: rc ${nc.status} ${nc.stderr.slice(0, 300)}`);
  const { openSession } = await import('../host/session.mjs');
  const said = [];
  const s = await openSession({ model: 'E147', patch: [patchFile], card: T('card.omsd'), cardPut: [`OM3MOD/LOOKS.BIN=${looksFile}`], nvram: T('nv.json'), out: T('out'), say: (l) => said.push(l) });
  try {
    let failed = null;
    const st = (tok) => { if (failed) return {}; const r = s.step(tok); if (!r.ok) { failed = `${tok}: ${r.error}`; ok(false, `step ${r.step} ${failed}`); } return r; };
    const run = (text) => text.split(' ').forEach(st);
    const word = (hex) => (hex ? parseInt(hex.match(/../g).reverse().join(''), 16) | 0 : NaN);
    const call = (fn, d0) => { const r = st(`call:${h8(fn)}:d0=${d0},d1=0,a0=0`); return r.d0 === undefined ? NaN : Number(r.d0) | 0; };
    // the two call sites' targets in the patched image (`call rel32,[d2,d3],12`: dd, rel32, c0 0c)
    const target = (site) => { const r = st(`read:${h8(site + RT)}:7`); const b = r.hex ?? ''; return b.startsWith('dd') && b.endsWith('c00c') ? ((site + word(b.slice(2, 10))) >>> 0) : NaN; };
    run('wait:1500');
    const wbT = target(WB_SITE), shT = target(SHARP_SITE);
    ok(wbT === wbT && wbT !== CGET && shT === shT && shT !== CGET, `the WB and Sharpness reads are hooked: targets ${h8(wbT)} ${h8(shT)} (the camera's getter ${h8(CGET)})`);
    run('s1 wait:1200');
    const k = 0;                                       // FILM 1..3 are COLOR 1's looks 1..3
    const ids = filmSettings(looks.films[0].record, k).map(([id]) => id);
    const read = () => Object.fromEntries(ids.map((id) => [id, call(GETTER, id)]));
    const hooks = () => ({ stock: { ab: call(CGET, KEY_AB), gm: call(CGET, KEY_GM) }, ab: call(wbT, KEY_AB), gm: call(wbT, KEY_GM), sharp: call(shT, KEY_SHARP) });
    let prev = read();
    const seen = [];
    for (const [j, keys] of [[0, 'ok ok right right right right'], [1, 'ok ok right'], [2, 'ok ok right']]) {
      run(keys);
      const g = st('wait:10').gui;
      ok(g === 'SS_MENU_LV/ID_ST_DIRECT_PICTUREMODE_ART', `FILM ${j + 1}: the Picture Mode list is open: ${g}`);
      run('ok');
      const { record, name } = looks.films[j];
      const got = read(), want = filmSettings(record, k);
      const d = settingDiff(got, want);
      ok(d.length === 0, `FILM ${j + 1} (${name}): COLOR 1's settings [id, lab, LOOKS.BIN]: ${JSON.stringify(d)}`);
      const stale = settingDiff(prev, want);
      ok(stale.length > 0, `FILM ${j + 1} control: its record differs from the values before it was selected (else the check cannot see a selection that changed nothing)`);
      prev = got;
      const h = hooks(), w = filmHooks(record, h.stock);
      ok(h.ab === w.ab && h.gm === w.gm && h.sharp === w.sharp, `FILM ${j + 1} (${name}): the hooked reads [A-B, G-M, Sharp] ${[h.ab, h.gm, h.sharp]}, LOOKS.BIN gives ${[w.ab, w.gm, w.sharp]} (the camera's getter ${[h.stock.ab, h.stock.gm]})`);
      seen.push({ j, on: record[36] === 1 && (record[37] !== 0 || record[38] !== 0), same: h.ab === h.stock.ab && h.gm === h.stock.gm });
    }
    ok(seen.some((x) => x.on && !x.same) && seen.some((x) => !x.on && x.same),
      `control: among FILM 1..3 a film with its WB shift on moves the WB reads and one with it off leaves the camera's values: ${JSON.stringify(seen)}`);
    run('s1:down s2:down wait:300 s2:up s1:up wait:5000');
    const want3 = `FILM 3 ${looks.films[2].name}`;
    const ex = st('exif:DCIM/100OMSYS/*.JPG').exif?.ImageDescription ?? '';
    ok(ex.includes(want3), `S2 on FILM 3: ImageDescription ${JSON.stringify(ex)}, want ${JSON.stringify(want3)}`);
  } finally {
    const sum = s.close();
    ok(sum.pokes.length === 0 && sum.harness_inputs.length === 0 && (sum.patch_audit?.hooks ?? []).length === 0,
      `no poke, no harness input, no lab hook on patched bytes: ${JSON.stringify({ pokes: sum.pokes, harness: sum.harness_inputs, audit: sum.patch_audit })}`);
    ok(said.some((l) => /patched firmware: \d+ patches/.test(l)), `the release taken as --patch: ${said[0]}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = looksUnits();
    console.log(`Caduceus films below the pixels, units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await looksSession();
    if (s.notRun) console.log(`Caduceus films below the pixels, E147: not run (${s.notRun})`);
    else console.log(`Caduceus films below the pixels, E147 (${s.release}): ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
