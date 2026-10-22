// check_menu.displayed_windows: a reader of lab state that the play runtime (the WINDOWS:800 / :900 debug tokens) and
// the checks (check_menu, check_nav) both use, kept in src/ so that the lab side does not import checks/.
import { DEVICE } from './display.mjs';
import { MenuError } from './menu.mjs';
import { show } from '../util/show.mjs';

// width x 600 windows of the GUI buffers the VSC shows (latched OSD1/2/3 DMASADR << 4 = GUI layers 0/1/2): 900 for the
// layout-1 panel, 800 for the layout-0 (EVF layout) panel. Returns Map layer -> bytes (width * 600).
export function displayed_windows(lab, device, width = 900) {
  const mirror = lab.vsc.bank(DEVICE[device].channel, true);
  const out = new Map();
  for (let layer = 0; layer < 3; layer++) {
    const v = mirror.get(`OSD${layer + 1}DMASADR`) ?? null;
    if (v === null) {
      throw new MenuError(`${device}: OSD${layer + 1}DMASADR never latched: the GUI did not reach the display (sends ${show(lab.kernel.events.filter((e) => e[0] === 'send').map((e) => e[1]))})`);
    }
    const base = v * 16, buf = new Uint8Array(width * 600);
    for (let y = 0; y < 600; y++) buf.set(lab.sim.read(base + y * 1664, width), y * width);
    out.set(layer, buf);
  }
  return out;
}
