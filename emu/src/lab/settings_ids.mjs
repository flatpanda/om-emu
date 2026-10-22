// The settings-store ids the play STORE token reads (refs/settings.mjs's Settings: the descriptor and custom-object
// tables, allowed, scalar, key_selector), for the lab side: src/ may not import refs/settings.mjs (test_pure.mjs).
import { A, IMAGE_BASE } from '../fw/model.mjs';
import { disasm } from './hle.mjs';
import { ValueError } from './errors.mjs';

const RT = IMAGE_BASE, DESCRIPTORS = A(0x60615DE4), N_DESCRIPTORS = 1607, CUSTOM = A(0x605C4680), N_CUSTOM = 262;
const KEY_SELECTORS = new Map([[A(0x603E68BB), 64], [A(0x603E68D9), 141]]);
const h8 = (v) => (v >>> 0).toString(16).padStart(8, '0');

export class SettingsIds {
  constructor(image) {
    const u16 = (a) => image[a - RT] | image[a - RT + 1] << 8;
    const u32 = (a) => (image[a - RT] | image[a - RT + 1] << 8 | image[a - RT + 2] << 16 | image[a - RT + 3] << 24) >>> 0;
    this.descriptors = new Map();          // id -> first record {type, bytes, elem} in table order (0x503da999)
    for (let i = 0; i < N_DESCRIPTORS; i++) {
      const a = DESCRIPTORS + 20 * i, sid = u16(a);
      if (!this.descriptors.has(sid)) this.descriptors.set(sid, { bytes: u16(a + 12), elem: u16(a + 14), type: image[a - RT + 17] });
    }
    this.getters = new Map();               // id -> custom object +20 (the last record of the id)
    for (let i = 0; i < N_CUSTOM; i++) this.getters.set(u16(CUSTOM + 60 * i), u32(CUSTOM + 60 * i + 20));
  }
  // Settings.key_selector: [function, property] or null; an unknown selector raises.
  key_selector(sid) {
    const g = this.getters.get(sid);
    if (!g) return null;
    if (!KEY_SELECTORS.has(g)) throw new ValueError(`${sid}: custom object +20 0x${h8(g)} is not a known key selector`);
    return [disasm(g), KEY_SELECTORS.get(g)];
  }
  // Settings.scalar: a descriptor, not type 6, element size 1 or 2.
  scalar(sid) {
    const d = this.descriptors.get(sid);
    return d !== undefined && d.type !== 6 && (d.elem === 1 || d.elem === 2);
  }
  // The STORE token's ids: sorted(i for i in st.descriptors if st.scalar(i) and not st.key_selector(i)).
  store_ids() {
    return [...this.descriptors.keys()].filter((i) => this.scalar(i) && !this.key_selector(i)).sort((a, b) => a - b);
  }
}
