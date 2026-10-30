// The kind-3 VSC's COMPOSE (the E118 family, src/dev/vsccompose2.mjs) without firmware: a machine on a blank image on
// E122's board, its channel 0 programmed through the device's own register writes as E122's opens and commit leave it
// (the TFT's 720 x 480 area at {30, 8}, the EVF's 1024 x 768 at {48, 38} with the 640 x 480 canvas scaled; X: the
// lab's E122 runs), composited after a frame boundary:
//   the video area and the background, nothing else with no plane enabled (E122's starts now, black)
//   OSD1's palette in the bank 0x1b8 bit 16 selects (+0xa00 set, +0x800 clear), the pixel's low 7 bits, an unwritten
//     entry counted (PAL_UNWRITTEN), a stray bit of 0x1b8 refused (OSDCP2_FIELD)
//   OSD2's 32 entries at +0x680 and OSD3's at +0x600, a pixel of 32 or more not drawn (PAL_FIELD)
//   the EVF's scaler (0x11, 0x9fc, 0, 0x9fc): the canvas's corners at the area's, a scaler word +8 refused
//   the format words 0x1b0 / 0x111 and 0x1b4 / 0x11 (MIX_UNOBSERVED otherwise), a level 0 not drawn (PLANC_ZERO), the
//     EVF's level 0xb2 drawn, nothing composed before the first frame (NOT_LATCHED)
// The model is fixed when src/ is imported, so the cases run in a child with OM_EMU_MODEL=E122.
//   node emu/test/test_vsc3.mjs          (the child: OM_EMU_MODEL=E122 node emu/test/test_vsc3.mjs --child)
import { spawnSync } from 'node:child_process';

const SELF = new URL(import.meta.url).pathname;

export function vsc3Units() {
  const r = spawnSync(process.execPath, [SELF, '--child'], { env: { ...process.env, OM_EMU_MODEL: 'E122' }, encoding: 'utf8' });
  const last = r.stdout.trim().split('\n').pop() ?? '';
  try {
    const res = JSON.parse(last);
    if (r.status === 0 && Number.isInteger(res.checks)) return res;
  } catch { /* reported below */ }
  return { checks: 1, bad: [`the E122 child exited ${r.status}: ${(r.stdout + r.stderr).trim().slice(-600)}`] };
}

async function child() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { createMachine } = await import('../src/machine.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  const V = await import('../src/dev/vsc.mjs');
  if (BOARD.vsc.kind !== 3) throw new Error(`OM_EMU_MODEL ${process.env.OM_EMU_MODEL}: VSC kind ${BOARD.vsc.kind}, not 3`);
  const BG = 0x80800B, CANVAS = 0xA1000000, ROW = 896;
  const hex = (x) => '0x' + (x >>> 0).toString(16);
  const fresh = () => {
    const m = createMachine({ rom: new Uint8Array(0x1000) }), v = m.devices.vsc;
    const reg = (off, value) => v.write(off, value, 4, false);
    const bell = (cmd) => { v.doorbell(0, cmd, 4, false); return v.dget(V.D.LAST_RESULT); };
    v.dset(V.chanDbg(0, V.CH.LINE_NS), 1000);
    const errors = () => {
      const n = v.dget(V.D.ERR_TOTAL), out = [];
      for (let k = Math.max(0, n - V.D.ERR_SLOTS); k < n; k++) {
        const at = V.D.ERR_RING + 32 * (k % V.D.ERR_SLOTS), w = (i) => v.dget(at + 4 * i);
        out.push({ code: w(0), off: w(3), value: w(4), args: [w(5), w(6), w(7)] });
      }
      return out;
    };
    const notes = () => {
      const n = v.dget(V.D.NOTE_TOTAL), out = [];
      for (let k = 0; k < n; k++) { const at = V.D.NOTE_RING + 16 * k; out.push({ kind: v.dget(at), off: v.dget(at + 8) & 0xFFFF }); }
      return out;
    };
    // compose the latched bank after the next boundary: {status, header words, the pixel at (x, y), errors, notes}
    const compose = (frame = true) => {
      bell(4);
      if (frame) bell(2);
      const status = bell(3), h = (i) => v.dget(V.D.HDR + 4 * i);
      const w = h(1);
      return { status, w, h: h(2), ox: h(8), oy: h(9), drawn: h(7), skipped: h(6), mix: h(10), px: (x, y) => v.out[y * w + x], errors: errors(), notes: notes() };
    };
    const canvas = (w, h, fill, rects = []) => {
      const b = new Uint8Array(ROW * h).fill(fill);
      for (const [x0, y0, rw, rh, idx] of rects) for (let y = y0; y < y0 + rh; y++) b.fill(idx, y * ROW + x0, y * ROW + x0 + rw);
      m.dbgWrite(CANVAS, b);
    };
    return { m, v, reg, compose, canvas };
  };
  // the TFT's open (X, E122): area {30, 8} 720 x 480, BG1, the format words; the planes' areas, strides and levels
  const tft = (t) => {
    t.reg(0x0F8, 0x1E02D0); t.reg(0x0FC, 0x80008); t.reg(0x100, 0x1E0); t.reg(0x190, BG); t.reg(0x030, 0);
    t.reg(0x1B0, 0x111); t.reg(0x1B4, 0x11);
    for (let q = 0; q < 3; q++) {
      t.reg(0x0C8 + 12 * q, 0x1E02D0); t.reg(0x0CC + 12 * q, 0x80008); t.reg(0x0D0 + 12 * q, 0x1E0);
      t.reg(0x05C + 4 * q, ROW / 64); t.reg(0x2E0 + 4 * q, 0x100); t.reg(0x148 + 0x18 * q, 0);
    }
    t.reg(0x22C, 0x1EF);
  };
  const ycc = (tra, y, cb, cr) => (tra << 24 | cr << 16 | cb << 8 | y) >>> 0;
  const RED = ycc(31, 76, 85, 255), GREEN = ycc(31, 150, 44, 21), CLEAR = ycc(0, 16, 128, 128);
  const codes = (r) => r.errors.map((e) => e.code);

  // nothing composed before the first boundary; the start's state: the background only
  {
    const t = fresh();
    tft(t);
    const r0 = t.compose(false);
    ok(r0.status === V.E.NOT_LATCHED, `before a frame: status ${r0.status}, want NOT_LATCHED`);
    const r = t.compose();
    ok(r.status === 0 && r.w === 720 && r.h === 480 && r.ox === 30 && r.oy === 8, `TFT area: status ${r.status} ${r.w} x ${r.h} at {${r.ox}, ${r.oy}}`);
    ok(r.px(0, 0) === BG && r.px(719, 479) === BG && !r.drawn && !r.errors.length, `TFT background: ${hex(r.px(0, 0))} ${hex(r.px(719, 479))} drawn ${r.drawn} errors ${JSON.stringify(r.errors)}`);
  }
  // OSD1: the bank 0x1b8 bit 16 selects, the low 7 bits, an unwritten entry
  {
    const t = fresh();
    tft(t);
    t.canvas(720, 480, 0xFF, [[100, 50, 40, 20, 0x81], [300, 200, 10, 10, 5]]);
    t.reg(0x030, 4); t.reg(0x044, CANVAS);
    for (const [bank, word] of [[0xA00, CLEAR], [0x800, GREEN]]) { t.reg(bank + 4 * 127, word); t.reg(bank + 4 * 1, word === CLEAR ? RED : GREEN); }
    t.reg(0x1B8, 0x10000);
    let r = t.compose();
    ok(r.status === 0 && r.drawn === 1 << 3, `OSD1: status ${r.status} drawn ${hex(r.drawn)}`);
    ok(r.px(100, 50) === (RED & 0xFFFFFF) && r.px(139, 69) === (RED & 0xFFFFFF), `OSD1 bank +0xa00 (bit 16 set), pixel 0x81 -> entry 1: ${hex(r.px(100, 50))}`);
    ok(r.px(99, 50) === BG && r.px(0, 0) === BG, `OSD1 entry 127 (0xff) transparent: ${hex(r.px(99, 50))}`);
    const pu = r.errors.find((e) => e.code === V.E.PAL_UNWRITTEN);
    ok(pu && pu.off === 0xA00 && pu.value === 100 && pu.args[1] === 5 && r.px(300, 200) === BG, `OSD1 entry 5 unwritten: ${JSON.stringify(r.errors)}`);
    t.reg(0x1B8, 0);
    r = t.compose();
    ok(r.px(100, 50) === (GREEN & 0xFFFFFF) && r.px(0, 0) === (GREEN & 0xFFFFFF), `OSD1 bank +0x800 (bit 16 clear): ${hex(r.px(100, 50))} ${hex(r.px(0, 0))}`);
    t.reg(0x1B8, 0x10010);
    r = t.compose();
    ok(codes(r).includes(V.E.OSDCP2_FIELD) && r.skipped === 1 << 3 && r.px(100, 50) === BG, `0x1b8 0x10010: ${JSON.stringify(r.errors)} skipped ${hex(r.skipped)}`);
  }
  // OSD2 at +0x680 and OSD3 at +0x600, 32 entries each
  {
    const t = fresh();
    tft(t);
    t.canvas(720, 480, 31, [[10, 10, 20, 20, 3], [40, 10, 20, 20, 40]]);
    t.reg(0x030, 3); t.reg(0x048, CANVAS); t.reg(0x04C, CANVAS);
    t.reg(0x680 + 4 * 31, CLEAR); t.reg(0x680 + 4 * 3, RED);
    t.reg(0x600 + 4 * 31, CLEAR); t.reg(0x600 + 4 * 3, GREEN);
    t.m.devices.vsc.dbg[V.chanDbg(0, V.CH.VIEW)] = 1 << 4;                  // OSD2 alone
    let r = t.compose();
    ok(r.status === 0 && r.drawn === 1 << 4 && r.px(10, 10) === (RED & 0xFFFFFF) && r.px(0, 0) === BG, `OSD2 +0x680: drawn ${hex(r.drawn)} ${hex(r.px(10, 10))}`);
    const pf = r.errors.find((e) => e.code === V.E.PAL_FIELD);
    ok(pf && pf.off === 0x680 && pf.value === 400 && pf.args[1] === 40 && r.px(40, 10) === BG, `OSD2 pixel 40 not drawn: ${JSON.stringify(r.errors)}`);
    t.m.devices.vsc.dbg[V.chanDbg(0, V.CH.VIEW)] = 1 << 5;                  // OSD3 alone
    r = t.compose();
    ok(r.drawn === 1 << 5 && r.px(10, 10) === (GREEN & 0xFFFFFF), `OSD3 +0x600: drawn ${hex(r.drawn)} ${hex(r.px(10, 10))}`);
  }
  // the EVF: area {48, 38} 1024 x 768, the 640 x 480 canvas through the scaler; level 0xb2 drawn, 0 not
  {
    const t = fresh();
    t.reg(0x0F8, 0x300400); t.reg(0x0FC, 0x260026); t.reg(0x100, 0x300); t.reg(0x190, BG);
    t.reg(0x1B0, 0x111); t.reg(0x1B4, 0x11); t.reg(0x1B8, 0x10000);
    t.reg(0x0C8, 0x300400); t.reg(0x0CC, 0x260026); t.reg(0x0D0, 0x300); t.reg(0x05C, ROW / 64); t.reg(0x2E0, 0xB2);
    t.reg(0x148, 0x11); t.reg(0x14C, 0x9FC); t.reg(0x150, 0); t.reg(0x154, 0x9FC);
    t.reg(0x030, 4); t.reg(0x044, CANVAS); t.reg(0x22C, 0x339);
    // the last output column and row sample the source's 638 and 478 (osdCol(1023, 0x9fc), floor(767 0x9fc / 4096))
    t.canvas(640, 480, 127, [[0, 0, 1, 1, 1], [638, 478, 1, 1, 1]]);
    t.reg(0xA00 + 4 * 127, CLEAR); t.reg(0xA00 + 4, RED);
    let r = t.compose();
    ok(r.status === 0 && r.w === 1024 && r.h === 768 && r.ox === 48 && r.oy === 38 && r.drawn === 1 << 3, `EVF: status ${r.status} ${r.w} x ${r.h} at {${r.ox}, ${r.oy}} drawn ${hex(r.drawn)}`);
    ok(r.px(0, 0) === (RED & 0xFFFFFF) && r.px(1023, 767) === (RED & 0xFFFFFF) && r.px(512, 384) === BG, `EVF scaler: corners ${hex(r.px(0, 0))} ${hex(r.px(1023, 767))}, centre ${hex(r.px(512, 384))}`);
    ok(!r.errors.length, `EVF errors ${JSON.stringify(r.errors)}`);
    t.reg(0x150, 1);
    r = t.compose();
    ok(r.errors.some((e) => e.code === V.E.RSZ_UNMODELLED && e.off === 0x150) && r.skipped === 1 << 3, `scaler +8 set: ${JSON.stringify(r.errors)}`);
    t.reg(0x150, 0); t.reg(0x2E0, 0);
    r = t.compose();
    ok(!r.drawn && r.notes.some((n) => n.kind === V.NOTE.PLANC_ZERO && n.off === 0x2E0) && r.px(0, 0) === BG, `level 0: drawn ${hex(r.drawn)} notes ${JSON.stringify(r.notes)}`);
    t.reg(0x2E0, 0xB2); t.reg(0x1B0, 0x111111);
    r = t.compose();
    ok(r.mix === 1 && r.errors.some((e) => e.code === V.E.MIX_UNOBSERVED && e.off === 0x1B0 && e.value === 0x111111) && r.drawn === 1 << 3, `0x1b0 0x111111: mix ${r.mix} ${JSON.stringify(r.errors)}`);
  }
  return { checks, bad };
}

if (process.argv[2] === '--child') {
  try { console.log(JSON.stringify(await child())); } catch (e) { console.log(e.stack); process.exit(1); }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const r = vsc3Units();
  console.log(`kind-3 VSC compose: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
