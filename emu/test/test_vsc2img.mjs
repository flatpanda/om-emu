// Kind 2's IMG planes (src/dev/vsccompose2.mjs drawImg2, the E144 family) without firmware: a machine on a blank image on
// E137's board, its channel 0's latched bank set word by word (the register file's tables are read from the firmware
// image, so the writes go straight into the latched copy: the TFT's 720 x 480 area, the GUI's OSD words, no OSD plane
// enabled) and IMG2 (plane 1) at 16 x 8 near the area's corner, composited by compose2:
//   format 3 with per-pixel alpha (bit 12): an opaque pixel drawn through the firmware's BT.601 (R, G, B each), alpha 0
//     not drawn, alpha 128 blended over the background; without bit 12 every pixel opaque, its alpha byte ignored
//   the refusals: format 0 (YC, live view; FMT_UNMODELLED), a scaled plane (RSZ_UNMODELLED), a level other than 0 and
//     0x100 (PLANC_UNOBSERVED), each skipping the plane; a level 0 not drawn (PLANC_ZERO noted); a window off the area
//     (WINDOW); an unwritten control word (UNWRITTEN)
// The model is fixed when src/ is imported, so the cases run in a child: OM_EMU_MODEL=E137.
//   node emu/test/test_vsc2img.mjs          (a child: OM_EMU_MODEL=E137 node emu/test/test_vsc2img.mjs --child)
import { spawnSync } from 'node:child_process';

const SELF = new URL(import.meta.url).pathname;

export function vsc2ImgUnits() {
  const r = spawnSync(process.execPath, [SELF, '--child'], { env: { ...process.env, OM_EMU_MODEL: 'E137' }, encoding: 'utf8' });
  const last = r.stdout.trim().split('\n').pop() ?? '';
  let res = null;
  try { res = JSON.parse(last); } catch { /* reported below */ }
  if (r.status === 0 && Number.isInteger(res?.checks)) return { checks: res.checks, bad: res.bad.map((b) => `E137: ${b}`) };
  return { checks: 1, bad: [`the E137 child exited ${r.status}: ${(r.stdout + r.stderr).trim().slice(-600)}`] };
}

async function child() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { createMachine } = await import('../src/machine.mjs');
  const { BOARD } = await import('../src/fw/board.mjs');
  const V = await import('../src/dev/vsc.mjs');
  const { compose2 } = await import('../src/dev/vsccompose2.mjs');
  if (BOARD.vsc.kind !== 2) throw new Error(`OM_EMU_MODEL ${process.env.OM_EMU_MODEL}: VSC kind ${BOARD.vsc.kind}, not 2`);
  const BG = 0x80800B, BUF = 0xA1000000, STRIDE = 1024, PW = 16, PH = 8;
  const hex = (x) => '0x' + (x >>> 0).toString(16);
  // the firmware's integer BT.601 (vsccompose2.mjs drawImg2), as a reference
  const ycc = (r, g, b) => {
    const y = ((19595 * r + 38470 * g + 7471 * b) >> 16) & 0xFF;
    const cb = (((-11056 * r - 21712 * g + (b << 15)) >> 16) + 128) & 0xFF;
    const cr = ((((r << 15) - 27440 * g - 5328 * b) >> 16) + 128) & 0xFF;
    return cr << 16 | cb << 8 | y;
  };
  const mix = (s, d, a) => [16, 8, 0].reduce((x, sh) => x | ((((s >>> sh & 0xFF) * a + (d >>> sh & 0xFF) * (255 - a) + 127) / 255) | 0) << sh, 0);
  // a TFT open as E137's leaves channel 0 (X, the lab's E137 runs; the GUI's words), IMG2 enabled with ctl, its window
  // at (ox + 10, oy + 6); the buffer's pixels [a, b, g, r] (row 0 holds the cases, the rest opaque blue)
  const run = (ctl, { rsz = 0, at = [10, 6], writeCtl = true } = {}) => {
    const m = createMachine({ rom: new Uint8Array(0x1000) }), v = m.devices.vsc, ch = v.ch[0], mf = v.mFlags(0);
    // the latched bank as a frame boundary leaves it (the register file's tables are read from the firmware image, so
    // the words go straight into the latched copy with their written flags)
    const reg = (off, value) => { ch.m[off / 4] = value >>> 0; v.dbg[mf + off / 4] = 1; };
    reg(0x0F8, 0x1E02D0); reg(0x0FC, 0x80008); reg(0x100, 0x1E0); reg(0x190, BG); reg(0x1B0, 0x111111); reg(0x1A4, 3); reg(0x030, 0);
    ch.latched = true;
    compose2(v, 0);
    const xs = v.dget(V.D.HDR + 4 * 8) + at[0], ys = v.dget(V.D.HDR + 4 * 9) + at[1];
    const px = new Uint8Array(STRIDE * PH);
    for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) px.set([255, 255, 0, 0], j * STRIDE + 4 * i);
    px.set([255, 0, 0, 255], 0); px.set([0, 0, 255, 0], 4); px.set([128, 0, 255, 0], 8); px.set([255, 0, 255, 0], 12);
    m.dbgWrite(BUF, px);
    reg(0x030, 0x10); reg(0x03C, BUF); reg(0x054, STRIDE / 64);
    reg(0x0B0, xs << 16 | PW); reg(0x0B4, ys << 16 | ys); reg(0x0B8, PH);
    if (writeCtl) reg(0x198, ctl);
    if (rsz) reg(0x118, rsz);
    const e0 = v.dget(V.D.ERR_TOTAL), n0 = v.dget(V.D.NOTE_TOTAL);
    const status = compose2(v, 0), h = (i) => v.dget(V.D.HDR + 4 * i), w = h(1), ox = h(8), oy = h(9);
    const n = v.dget(V.D.ERR_TOTAL), errors = [];
    for (let k = Math.max(e0, n - V.D.ERR_SLOTS); k < n; k++) {
      const e = V.D.ERR_RING + 32 * (k % V.D.ERR_SLOTS);
      errors.push({ code: v.dget(e), off: v.dget(e + 12), value: v.dget(e + 16) });
    }
    const notes = [];
    for (let k = n0; k < v.dget(V.D.NOTE_TOTAL); k++) notes.push({ kind: v.dget(V.D.NOTE_RING + 16 * k), off: v.dget(V.D.NOTE_RING + 16 * k + 8) & 0xFFFF });
    return { status, drawn: h(7), skipped: h(6), errors, notes, pix: (i, j = 0) => v.out[(ys - oy + j) * w + (xs - ox + i)], bg: v.out[0] };
  };
  const BLUE = ycc(0, 0, 255), RED = ycc(255, 0, 0), GREEN = ycc(0, 255, 0);
  {
    const r = run(0x301100);
    ok(r.status === 0 && r.drawn === 1 << 1 && !r.skipped && !r.errors.length, `format 3, alpha per pixel: status ${r.status} drawn ${hex(r.drawn)} skipped ${hex(r.skipped)} ${JSON.stringify(r.errors)}`);
    ok(r.pix(0) === RED && r.pix(3) === GREEN && r.pix(5, 3) === BLUE, `opaque pixels through BT.601: ${hex(r.pix(0))} ${hex(r.pix(3))} ${hex(r.pix(5, 3))}`);
    ok(r.pix(1) === BG && r.bg === BG, `alpha 0 not drawn: ${hex(r.pix(1))}`);
    ok(r.pix(2) === mix(GREEN, BG, 128), `alpha 128 blended over the background: ${hex(r.pix(2))}, want ${hex(mix(GREEN, BG, 128))}`);
  }
  {
    const r = run(0x300100);
    ok(r.drawn === 1 << 1 && r.pix(1) === GREEN && r.pix(2) === GREEN, `without bit 12 alpha ignored: ${hex(r.pix(1))} ${hex(r.pix(2))}`);
  }
  const refused = (what, r, code, off) => ok(r.skipped === 1 << 1 && !r.drawn && r.errors.some((e) => e.code === code && e.off === off) && r.pix(0) === BG,
    `${what}: skipped ${hex(r.skipped)} drawn ${hex(r.drawn)} ${JSON.stringify(r.errors)} ${hex(r.pix(0))}`);
  refused('format 0 (YC)', run(0x001100), V.E.FMT_UNMODELLED, 0x198);
  refused('a scaled plane', run(0x301100, { rsz: 0x11 }), V.E.RSZ_UNMODELLED, 0x118);
  refused('level 0xcc', run(0x3011CC), V.E.PLANC_UNOBSERVED, 0x198);
  refused('level 0x1ff', run(0x3011FF), V.E.PLANC_UNOBSERVED, 0x198);
  refused('a window off the area', run(0x301100, { at: [710, 6] }), V.E.WINDOW, 0x0B0);
  refused('the control word unwritten', run(0, { writeCtl: false }), V.E.UNWRITTEN, 0x198);
  {
    const r = run(0x301000);
    ok(!r.drawn && !r.errors.length && r.notes.some((n) => n.kind === V.NOTE.PLANC_ZERO && n.off === 0x198) && r.pix(0) === BG, `level 0 not drawn, noted: ${JSON.stringify(r.notes)} ${JSON.stringify(r.errors)}`);
  }
  return { checks, bad };
}

if (process.argv.includes('--child')) {
  console.log(JSON.stringify(await child()));
} else if (process.argv[1] === SELF) {
  const u = vsc2ImgUnits();
  console.log(`kind-2 IMG planes on E137's board: ${u.checks - u.bad.length}/${u.checks}`);
  u.bad.forEach((x) => console.log('  ', x));
  process.exit(u.bad.length ? 1 : 0);
}
