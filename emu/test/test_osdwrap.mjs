// The OSD engine's picture runs across a row end (src/dev/engine.mjs cmdBitmap, A-BMPWRAP):
//   osdWrapUnits    (firmware-free) the engine on a bare machine's board (the E143 family's command form): a format-0x0B
//                   picture whose runs cross two row ends draws as one stream of width x lines pixels, each row at the
//                   stride, with no error, and the engine counts the two crossings (wraps, the player's A-BMPWRAP);
//                   a picture without a crossing leaves the count at 0; refused with BMP_TOKEN, nothing drawn and
//                   nothing counted: a run that would leave the last row, a crossing run of format 0x02, set bits
//                   past a word's last token. Negative control: without A-BMPWRAP the first picture is refused with
//                   BMP_TOKEN, which its check names
//   osdWrapSession  (E147, OM_CADUCEUS: a checkout of Caduceus for OM-3 with releases/v0.29; skipped without it)
//                   their release's patch file as --patch and its LOOKS.BIN put on a card bin/card.mjs made, through
//                   host/session.mjs: Picture Mode, the HSL row, INFO through the wheel's pages; each of their four
//                   guide pictures (175 x 50, format 0x0B, runs across row ends) is drawn with no engine error (no
//                   step's osd_errors) and the summary lists A-BMPWRAP; the same session's stock pages draw no
//                   crossing (A-BMPWRAP not listed before the first INFO). Control: the 175 x 50 pictures the pages
//                   drew, each poked with bits past its first word's fifth token, are refused where the next round
//                   draws them, and those steps carry osd_errors {BMP_TOKEN: 1} (without osd_errors, or with the
//                   engine before A-BMPWRAP, this part fails). Their bytes are read from their checkout at run time,
//                   never copied here
//   node emu/test/test_osdwrap.mjs [--units] [--session]     (the session part: OM_EMU_MODEL=E147 OM_CADUCEUS=DIR)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMachine } from '../src/machine.mjs';
import { BOARD } from '../src/fw/board.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

// a picture's stream: the 4-byte header (lines - 1, width - 1, the format) and the tokens, five 12-bit tokens a 64-bit
// word (format 0x0B) or one byte each (format 0x02); pad: bits set past a full word's fifth token
function stream(fmt, width, lines, tokens, pad = 0n) {
  const out = [(lines - 1) & 0xff, ((lines - 1) >> 8 & 0xf) | ((width - 1) & 0xf) << 4, (width - 1) >> 4 & 0xff, fmt];
  if (fmt === 0x02) return Uint8Array.from([...out, ...tokens]);
  for (let k = 0; k < tokens.length; k += 5) {
    let word = 0n;
    tokens.slice(k, k + 5).forEach((t, s) => { word |= BigInt(t) << BigInt(12 * s); });
    if (tokens.length - k >= 5) word |= pad << 60n;
    for (let b = 0; b < 8; b++) out.push(Number((word >> BigInt(8 * b)) & 0xffn));
  }
  return Uint8Array.from(out);
}
const tok = (index, run) => index << 4 | (run - 1);          // format 0x0B: an 8-bit index over a 4-bit run

export function osdWrapUnits() {
  const t = tester(), { ok } = t;
  const m = createMachine({ rom: new Uint8Array(0x100), insnLimit: 0 });
  const { engine, bus } = m.devices;
  const lines = [];
  m.stderr = (l) => lines.push(l);
  ok(BOARD.engine.enc !== 2, 'the units build the E143 family\'s bitmap command (this process\'s board)');
  // the command (opcode 0x30, depth 3, no table: the indices are the colours) and a guard slot over the destination
  const SRC = 0xa2000000, DST = 0xa2100000, STRIDE = 128;
  engine.dset(0x40, DST); engine.dset(0x44, STRIDE); engine.dset(0x48, 16); engine.dset(0x4c, 1);
  // format 0x02's colour index goes through the command's inline table (here index i -> colour i)
  const cmd = (src, table = false) => [(0x30 | 3 << 8 | (table ? 0x1800 : 0) | (src >>> 31) << 26 | (DST >>> 29) << 28) >>> 0, src >>> 0, ((DST & 0x1fffffff) << 3) >>> 0,
    ((STRIDE >> 7) & 0x1ff) << 1, ...(table ? [0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c] : [])];
  const clear = () => { for (let y = 0; y < 8; y++) bus.write(DST + y * STRIDE, new Uint8Array(STRIDE).fill(0xee)); };
  const rows = (w, h) => { const r = []; for (let y = 0; y < h; y++) { const b = new Uint8Array(w + 1); bus.read(DST + y * STRIDE, b); r.push([...b]); } return r; };
  const draw = (data) => {
    bus.write(SRC, data);
    const f0 = { ...engine.failures }, w0 = engine.wraps;
    const w = cmd(SRC, data[3] === 0x02);
    engine.execute(0, w, w.length);
    const failed = Object.keys(engine.failures).filter((k) => engine.failures[k] !== f0[k]);
    return { failed, wraps: engine.wraps - w0 };
  };

  // 6 x 3: 1 x4, 2 x5 (row 0's end), 3 x9 (row 1's end, to the picture's last pixel)
  clear();
  let r = draw(stream(0x0B, 6, 3, [tok(1, 4), tok(2, 5), tok(3, 9)]));
  const want = [[1, 1, 1, 1, 2, 2, 0xee], [2, 2, 2, 3, 3, 3, 0xee], [3, 3, 3, 3, 3, 3, 0xee]];
  ok(r.failed.length === 0 && JSON.stringify(rows(6, 3)) === JSON.stringify(want),
    `A-BMPWRAP: runs across two row ends draw as one stream of 6 x 3, each row at the stride (got ${JSON.stringify(rows(6, 3))}, errors ${r.failed.join(', ') || 'none'})`);
  ok(r.wraps === 2, `the engine counts the two crossing runs it drew (${r.wraps})`);
  // the same picture with its runs cut at the row ends: nothing crosses, nothing counted
  clear();
  r = draw(stream(0x0B, 6, 3, [tok(1, 4), tok(2, 2), tok(2, 3), tok(3, 3), tok(3, 6)]));
  ok(r.failed.length === 0 && r.wraps === 0 && JSON.stringify(rows(6, 3)) === JSON.stringify(want), `a picture with no run across a row end: drawn, no crossing counted (${r.wraps}, ${r.failed.join(', ')})`);
  // refusals: nothing drawn, nothing counted
  const refused = (what, data) => {
    clear();
    const x = draw(data);
    ok(JSON.stringify(x.failed) === '["BMP_TOKEN"]' && x.wraps === 0 && rows(6, 3).every((row) => row.every((v) => v === 0xee)), `${what}: refused with BMP_TOKEN, nothing drawn or counted (${x.failed.join(', ')}; ${x.wraps})`);
  };
  refused('a run that would leave the picture\'s last row (6 x 2: 4, then 9)', stream(0x0B, 6, 2, [tok(1, 4), tok(2, 9)]));
  refused('a crossing run of format 0x02 (no evidence for it)', stream(0x02, 6, 2, [1 << 4 | 3, 2 << 4 | 4, 3 << 4 | 2]));
  refused('set bits past a full word\'s fifth token', stream(0x0B, 6, 2, [tok(1, 4), tok(2, 2), tok(3, 2), tok(4, 2), tok(5, 2)], 1n));
  ok(lines.length === 3 && lines.every((l) => l.includes('osd-engine ERROR BMP_TOKEN')), `each refusal is one stderr line: ${lines.join(' | ')}`);
  return t;
}

// E147 with their release (the patch and LOOKS.BIN read from OM_CADUCEUS at run time)
export async function osdWrapSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const REL = process.env.OM_CADUCEUS ? path.join(process.env.OM_CADUCEUS, 'releases/v0.29') : null;
  if (MODEL !== 'E147' || !REL || !fs.existsSync(path.join(REL, 'patch.json'))) return { ...t, skipped: `needs OM_EMU_MODEL=E147 and OM_CADUCEUS with releases/v0.29 (model ${MODEL}, OM_CADUCEUS ${process.env.OM_CADUCEUS ?? 'unset'})` };
  const tmp = path.join(process.env.HOME, '.cache/om-emu-tmp/test-osdwrap-' + process.pid);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const card = path.join(tmp, 'card.omsd'), CARD = path.join(EMU, 'bin/card.mjs');
    let c = spawnSync(process.execPath, [CARD, 'new', card, '--model', 'E147'], { encoding: 'utf8', timeout: 120000 });
    ok(c.status === 0, `card.mjs new: rc ${c.status} ${c.stderr.slice(0, 300)}`);
    c = spawnSync(process.execPath, [CARD, 'put', card, path.join(REL, 'LOOKS.BIN'), 'OM3MOD/LOOKS.BIN'], { encoding: 'utf8', timeout: 120000 });
    ok(c.status === 0, `card.mjs put LOOKS.BIN: rc ${c.status} ${c.stderr.slice(0, 300)}`);
    const { openSession } = await import('../host/session.mjs');
    const s = await openSession({ model: 'E147', patch: [path.join(REL, 'patch.json')], card, out: path.join(tmp, 'out'), say: () => {} });
    ok(s.first.ok, `the patched boot: ${JSON.stringify(s.first).slice(0, 300)}`);
    // Picture Mode at FILM 1 (their first film), the HSL row; their guides are the wheel's Hue, Luminance, Shadows and
    // Highlights pages (their docs/USING.md)
    const recs = s.run(['wait:1500', 's1', 'wait:1200', 'expect:card:OM3MOD/LOOKS.BIN', 'ok', 'ok', 'expect:gui=SS_MENU_LV/ID_ST_DIRECT_PICTUREMODE_ART', 'right', 'right', 'right', 'right', 'down', 'wait:800']);
    ok(recs.every((x) => x.ok), `to the HSL row: ${JSON.stringify(recs.find((x) => !x.ok) ?? null)}`);
    const before = s.player.stand_ins_in_use().includes('A-BMPWRAP');
    const lab = s.player.session.lab, eng = lab.sim.m.devices.engine, w0 = eng.wraps;
    lab.harvest();
    const e0 = lab.exec_history.length;
    const pages = s.run(Array.from({ length: 6 }, () => ['info', 'wait:500']).flat());
    ok(pages.length === 12 && pages.every((x) => x.ok), `INFO through the wheel's pages: ${JSON.stringify(pages.find((x) => !x.ok) ?? null)}`);
    const osd = [...recs, ...pages].filter((x) => x.osd_errors);
    ok(osd.length === 0, `no OSD engine error in any step: ${JSON.stringify(osd.map((x) => [x.step, x.token, x.osd_errors]))}`);
    // each of their four guides draws once with its runs across row ends (48, 13, 48 and 49: X, their streams decoded
    // apart)
    ok(eng.wraps - w0 === 48 + 13 + 48 + 49, `their four guides drawn with their crossing runs (${eng.wraps - w0})`);
    ok(!before && s.player.stand_ins_in_use().includes('A-BMPWRAP'), `A-BMPWRAP: not in use before the first INFO (${before}), in use after`);
    // control: the 175 x 50 format-0x0B pictures the pages drew (their guides and the camera's own "Color All" one),
    // each with bits set past its first word's fifth token (pokes: the GUI reads a picture's header, not its tokens),
    // are refused where the next round of the pages draws them as poked, and those steps say so in osd_errors
    lab.harvest();
    const GUIDE = '31e00a0b';                          // the header: 50 lines, 175 wide, format 0x0B
    const srcs = [...new Set(lab.exec_history.slice(e0).filter((e) => e.command?.name === 'BITMAP').map((e) => e.command.src >>> 0))];
    const guides = srcs.filter((a) => s.step(`read:0x${a.toString(16)}:4`).hex === GUIDE);
    ok(guides.length >= 1, `175 x 50 format-0x0B pictures among the pages' ${srcs.length} bitmaps: ${guides.length}`);
    for (const a of guides) {
      const top = parseInt(s.step(`read:0x${(a + 11).toString(16)}:1`).hex, 16);
      ok(s.step(`write:0x${(a + 11).toString(16)}=${(top | 0x10).toString(16).padStart(2, '0')}`).ok, `the poke at 0x${(a + 11).toString(16)}`);
    }
    const again = s.run(Array.from({ length: 6 }, () => ['info', 'wait:500']).flat()).filter((x) => x.osd_errors);
    ok(again.length >= 1 && again.every((x) => JSON.stringify(x.osd_errors) === '{"BMP_TOKEN":1}'),
      `the refused pictures in osd_errors: ${JSON.stringify(again.map((x) => [x.step, x.token, x.osd_errors]))}`);
    const sum = s.close();
    ok(sum.ok && sum.stand_ins.includes('A-BMPWRAP'), `A-BMPWRAP listed in the summary (${sum.stand_ins.filter((x) => x.startsWith('A-')).join(' ')})`);
    ok(sum.pokes.length === guides.length, `the control's pokes alone: ${JSON.stringify(sum.pokes)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let fail = 0;
  if (all || process.argv.includes('--units')) {
    const u = osdWrapUnits();
    console.log(`OSD runs across a row end (A-BMPWRAP) units: ${u.checks - u.bad.length}/${u.checks}`);
    u.bad.forEach((x) => console.log('  ', x));
    fail += u.bad.length;
  }
  if (all || process.argv.includes('--session')) {
    const s = await osdWrapSession();
    if (s.skipped) console.log(`OSD runs across a row end, their guides on E147: skipped (${s.skipped})`);
    else console.log(`OSD runs across a row end, their guides on E147: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length;
  }
  process.exit(fail ? 1 : 0);
}
