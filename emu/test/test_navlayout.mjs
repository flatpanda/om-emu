// The TFT layout of a nav session (src/lab/nav.mjs gui_connect, docs/hle-gaps/4.7.md 4.7.22) on the body of
// OM_EMU_MODEL:
//   navLayout  (firmware) a nav session in time mode on the TFT: on every ported body the session posted the connect
//              message 0x9601 with lOutput 2 after the bring-up (H-GUICONNECT), the layout byte LAYOUT_BYTE 1 before
//              it (WinMain's SetLayoutMode(1)); after it 0 on the TG-5s (E129, E132: CCommon::resetCoordinate's
//              handler `clr d0`) and 1 on the others; E143's session posts none. On the TG-5s Shooting Menu 2 (OPEN,
//              DOWN) shows its value column ("Off" right of the rows, the band VALUE_BAND of the frame) and the
//              footer's "Set" whole (text in the footer's right part, none in its last EDGE columns). Controls: without
//              the connect the TG-5s' frame has no value column and "Set" reaches the frame's right edge (the
//              2026-11-23 defect); on the other bodies the OPEN and DOWN frames are the same with it and without it
//   node emu/test/test_navlayout.mjs   (with OM_EMU_MODEL=E129 etc.; exit 1 on a failure)
import { createHash } from 'node:crypto';

// the bodies besides E143 the test covers (test_nav.mjs NAV_BODIES), and those whose TFT connect resets the layout to 0
export { NAV_BODIES, LAYOUT0_BODIES } from './test_nav.mjs';
import { LAYOUT0_BODIES } from './test_nav.mjs';
// the frame's bands as fractions of its width and height (X, E129's 960 x 480 frame of Shooting Menu 2 in play: the
// rows' values "Off" at x 873..935, y 78..152; "Set" and the OK badge at x 795..921, y 440..470)
const VALUE_BAND = { x: [0.86, 0.99], y: [0.15, 0.33] }, FOOTER = { x: [0.80, 1], y: [0.9, 0.99] }, EDGE = 8;

async function labEnv() {
  const { loadImage, loadBlock } = await import('../checks/lib/env.mjs');
  return { rom: loadImage(), resBlock: loadBlock(), createHash, loaded: 'auto' };
}

// The frame's pixels that differ from its background (its most common colour) in the box x0..x1, y0..y1 (pixels)
function inked(f, x0, x1, y0, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (f.rgb[y * f.w + x] !== f.bg) n++;
  return n;
}

export async function navLayout() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  const { show } = await import('../src/util/show.mjs');
  const N = await import('../src/lab/nav.mjs');
  const MM = await import('../src/lab/menu.mjs');
  const { CONNECT_BODIES } = await import('./test_nav.mjs');
  const { words_to_rgb } = await import('../src/lab/display.mjs');
  const env = await labEnv();
  class Unconnected extends N.NavSession { gui_connect() { this.gui_connected = null; } }
  const open = (cls) => new cls(env, { open_menu: false, png: 'none', time: true, device: 'tft' }).enter();
  const frame = (nav) => {
    const c = nav.lab.compose('tft'), w = c.header.width, h = c.header.height, rgb8 = words_to_rgb(c.words);
    const rgb = new Uint32Array(w * h), count = new Map();
    for (let i = 0; i < w * h; i++) {
      rgb[i] = rgb8[3 * i] << 16 | rgb8[3 * i + 1] << 8 | rgb8[3 * i + 2];
      count.set(rgb[i], (count.get(rgb[i]) ?? 0) + 1);
    }
    const bg = [...count].sort((a, b) => b[1] - a[1])[0][0];
    return { w, h, rgb, bg, digest: createHash('sha256').update(rgb8).digest('hex') };
  };
  // OPEN (and WAIT:1000 where the open sleeps first), DOWN: the two frames
  const menu = (nav) => {
    nav.step('OPEN');
    if (nav.lab.state() !== MM.STATE_MENU) nav.step('WAIT:1000');
    const f1 = frame(nav);
    nav.step('DOWN');
    return [f1, frame(nav)];
  };
  // value column and footer of a frame (pixels inked)
  const parts = (f) => {
    const at = (b, k, n) => Math.round(b[k] * n);
    return { value: inked(f, at(VALUE_BAND.x, 0, f.w), at(VALUE_BAND.x, 1, f.w), at(VALUE_BAND.y, 0, f.h), at(VALUE_BAND.y, 1, f.h)),
      set: inked(f, at(FOOTER.x, 0, f.w), f.w - EDGE, at(FOOTER.y, 0, f.h), at(FOOTER.y, 1, f.h)),
      edge: inked(f, f.w - EDGE, f.w, at(FOOTER.y, 0, f.h), at(FOOTER.y, 1, f.h)) };
  };
  const tg5 = LAYOUT0_BODIES.includes(MODEL), labModel = MODEL === 'E143';
  let frames = null;
  try {
    const nav = open(N.NavSession);
    try {
      const gc = nav.gui_connected;
      ok(labModel ? gc === null : gc?.message === '0x9601' && gc.loutput === 2 && gc.layout?.[0] === 1 && gc.layout[1] === (tg5 ? 0 : 1),
        `${MODEL}: H-GUICONNECT ${labModel ? 'did not run' : `posted 0x9601 with lOutput 2, the layout 1 -> ${tg5 ? 0 : 1}`} (${show(gc)})`);
      frames = menu(nav);
    } finally { nav.close(); }
  } catch (e) {
    ok(false, `${MODEL}: the session: ${e.message.slice(0, 600)}`);
    return { checks, bad };
  }
  // E143 posts none; on E118 and E120 the GUI's gate drops OPEN without it (test_nav.mjs's control)
  if (labModel || CONNECT_BODIES.includes(MODEL)) return { checks, bad };
  let control = null;
  try {
    const c = open(Unconnected);
    try { control = menu(c); } finally { c.close(); }
  } catch (e) {
    ok(false, `${MODEL}: control (no connect): ${e.message.slice(0, 600)}`);
    return { checks, bad };
  }
  if (tg5) {
    const p = parts(frames[1]), q = parts(control[1]);
    ok(frames[1].w === 960 && p.value > 50, `${MODEL}: Shooting Menu 2 shows its value column (${p.value} pixels inked in ${show(VALUE_BAND)} of ${frames[1].w} x ${frames[1].h})`);
    ok(p.set > 50 && p.edge === 0, `${MODEL}: the footer's "Set" is whole (${p.set} pixels inked in its right part, ${p.edge} in the last ${EDGE} columns)`);
    ok(q.value === 0 && q.edge > 0, `${MODEL}: control: without the connect no value column (${q.value}) and "Set" at the right edge (${q.edge})`);
  } else {
    ok(frames.every((f, k) => f.digest === control[k].digest), `${MODEL}: the OPEN and DOWN frames are the same with the connect and without it (${frames.map((f) => f.digest.slice(0, 12))} / ${control.map((f) => f.digest.slice(0, 12))})`);
  }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await navLayout();
  console.log(`nav layout: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
