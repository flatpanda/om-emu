// The VSC device's tables, without firmware traces: the register tables read from the image equal the committed
// header checks/fixtures/om1-vsc-regs.h, the JS register classes equal check_display's parse of the class
// tables (checks/fixtures/om1-vsc-tables.c), and the blend table equals the blend() formula below on all
// 32 x 256 x 256 inputs.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = vscRegsHeader(), b = blendTable(), vc = vscClasses();
  console.log(`vsc register tables vs om1-vsc-regs.h: ${h.tables.join(' + ')} entries, ${h.bad.length ? 'DIFFERENT' : 'identical'}`);
  console.log(`blend table: ${b.inputs - b.bad.length}/${b.inputs}`);
  console.log(`vsc-classes (the JS register classes vs om1-vsc.c): ${vc.names - vc.bad.length}/${vc.names}`);
  [...h.bad, ...b.bad, ...vc.bad.slice(0, 10)].forEach((x) => console.log('  ', x));
  process.exit(h.bad.length + b.bad.length + vc.bad.length ? 1 : 0);
}
