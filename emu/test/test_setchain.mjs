// The settings init chain run whole at the store's start (src/lab/menu.mjs settings_chain, src/fw/facts.mjs
// settingsChain; docs/hle-gaps/4.6.md 4.6.9):
//   setchainUnits    the rule on synthetic bodies (a chain read forward from the init's call; the init's call alone,
//                    a bne that does not skip its call, a tail of another form: none; two chains: refused) and on
//                    every unpacked body: E143's chain is SETTINGS_CHAIN_E143, E146's and E147's the ones found by
//                    their disassembly, E144's, E148's and E139's read in the same form, none on the other bodies
//   setchainSession  (the process's model, E143, E146 or E147; bin/test.mjs runs each in a process of its own) a
//                    session with the chain (the default) and one with OM_EMU_SETTINGS_CHAIN's off switch: the store's
//                    phases name the chain and the narrow init, H-STOREINIT reported in use only off; every setting of
//                    the body's name table by the getter, the frame and the lab time the same at the start and after the
//                    mode dial's change to C1 (which changes settings); a switch value other than 0 and 1 refused
//   node emu/test/test_setchain.mjs [--units] [--session]       (OM_EMU_MODEL=E146 or E147 for those bodies)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { settingsChain, propStore, SETTINGS_CHAIN_E143 } from '../src/fw/facts.mjs';
import { MODELS, romPath } from '../src/fw/models.mjs';
import { expandImage } from '../src/fw/expand.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname), REPO = path.dirname(EMU);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};
const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
const hx = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? '0x' + x.toString(16) : x));

// E146's and E147's chains (D: their disassembly at the one call of the store's init, E146 0x503d6f46 and E147 0x503e4c4d)
const FOUND = {
  E143: SETTINGS_CHAIN_E143,
  E146: { entry: 0x503D6F01, steps: [0x503E79E6, 0x5042043C, 0x5041D9F1, 0x5041B164, 0x503EA117, 0x503EA503, 0x503EC531, 0x50409FFA, 0x50420D24,
    0x503E63C3, 0x5041D227, 0x503DA606, 0x503E9444, 0x503F17F7], tail: [0x503E4FD4, 0x5041C8AD, 0x503E9682] },
  E147: { entry: 0x503E4C08, steps: [0x503F56EC, 0x5042E658, 0x5042BB46, 0x504292B9, 0x503F7E1D, 0x503F820C, 0x503FA2C8, 0x50418101, 0x5042EF9F,
    0x503F40C9, 0x5042B37C, 0x503E830C, 0x503F714A, 0x503FF5A3], tail: [0x503F2CDA, 0x5042AA02, 0x503F7388] },
};
// the bodies the rule reads a chain on besides those three (X: the rule on the 18 unpacked bodies), by their entries
const ENTRIES = { E144: 0x502BDB43, E148: 0x502C0F11, E139: 0x502BB7D1 };

// a synthetic body: a ret, then the chain at 0x100 with `n` steps (step k calls 0x1000 + 0x100 k; the init the third),
// the tail calling 0x3000, 0x3100, 0x3200; edit(img) changes it
const call7 = (img, at, to) => { img[at] = 0xdd; new DataView(img.buffer).setInt32(at + 1, to - at, true); img.set([0, 0], at + 5); return at + 7; };
function synth(n = 5, edit = null, at = 0x100, img = new Uint8Array(0x4000)) {
  img.set([0xdf, 0x80, 0x08], at - 3);
  let p = call7(img, at, 0x1000);
  img.set([0x82, 0x1c, 0xa0, 0x00, 0xc9, 0x0a], p); p += 6;
  for (let k = 1; k < n; k++) {
    p = call7(img, p, 0x1000 + 0x100 * k); img[p++] = 0x82;
    if (k < n - 1) { img.set([0x88, 0x1c, 0xa0, 0x00, 0xc9, 0x0a], p); p += 6; }
  }
  p = call7(img, p, 0x3000); img[p++] = 0x00; p = call7(img, p, 0x3100); p = call7(img, p, 0x3200);
  img.set([0x88, 0x1c, 0xdf, 0x80, 0x08], p);
  edit?.(img);
  return img;
}

export function setchainUnits() {
  const t = tester(), { ok } = t;
  const A = (o) => 0x50000000 + o, init = A(0x1200);
  const c = settingsChain(synth(), init);
  ok(c && c.entry === A(0x100) && hx(c.steps) === hx([0x1000, 0x1100, 0x1200, 0x1300, 0x1400].map(A)) && hx(c.tail) === hx([0x3000, 0x3100, 0x3200].map(A)),
    `synthetic: read forward from the init's call: ${hx(c)}`);
  ok(settingsChain(synth(), A(0x3100)) === undefined, 'synthetic: a tail call is not a step');
  // the init's call alone, with no chain around it
  const lone = new Uint8Array(0x4000); call7(lone, 0x200, 0x1200);
  ok(settingsChain(lone, init) === undefined, 'synthetic: a lone call of the init reads no chain');
  // a bne that does not skip its call and the mov after it (the first guard's displacement, 0x10c, one short)
  ok(settingsChain(synth(5, (img) => { img[0x10c] = 0x09; }), init) === undefined, 'synthetic: a bne that does not skip its call');
  // the tail's clr d0 (0x146 in this layout) another byte
  ok(settingsChain(synth(5, (img) => { img[0x146] = 0xff; }), init) === undefined, 'synthetic: a tail of another form');
  // two chains calling the init
  const two = synth(5, null, 0x100); synth(5, null, 0x800, two);
  const e = thrown(() => settingsChain(two, init));
  ok(e && /2 chains call the property store's init 0x50001200, at 0x50000100, 0x50000800; want one/.test(e.message), `synthetic: two chains refused: ${e?.message}`);
  // every unpacked body
  let seen = 0;
  for (const [code, m] of Object.entries(MODELS)) {
    const file = path.join(REPO, romPath(m));
    if (!fs.existsSync(file)) continue;
    seen++;
    const img = expandImage(new Uint8Array(fs.readFileSync(file)), { base: m.image_base, preload: [] });
    const ps = propStore(img), chain = ps && settingsChain(img, ps.init);
    if (FOUND[code]) ok(hx(chain) === hx(FOUND[code]), `${code}: ${hx(chain)}, found ${hx(FOUND[code])}`);
    else if (ENTRIES[code]) ok(chain?.entry === ENTRIES[code] && chain.steps.length === 14 && chain.steps[5] === ps.init, `${code}: ${hx(chain)}, its entry ${hx(ENTRIES[code])}`);
    else ok(chain === undefined, `${code}: no chain expected, read ${hx(chain)}`);
  }
  ok(seen > 0, 'no body unpacked (unpacked/)');
  return t;
}

// The process's model: a session with the chain and one with the off switch, through the Player
export async function setchainSession() {
  const t = tester(), { ok } = t;
  const { MODEL } = await import('../src/fw/model.mjs');
  const { loadImage, loadBlock, loadNand, createHash } = await import('../checks/lib/env.mjs');
  const { Player } = await import('../src/lab/player.mjs');
  const { PLAYER_PARSER } = await import('../scenarios/session_replay.mjs');
  const { settingNames } = await import('../host/setnames.mjs');
  const names = settingNames(MODEL);
  const base = { rom: loadImage(), resBlock: loadBlock(), nand: loadNand(), createHash, deflate: (b, l) => new Uint8Array(zlib.deflateSync(b, { level: l })), wallClock: () => performance.now() / 1000 };
  const C1 = 3;                                      // the mode dial's C1 (MY_MODE1) on E143, E146 and E147
  const run = (chain) => {
    const pl = new Player({ ...PLAYER_PARSER, no_browser: true, idle: 'off', a15: 'on', out: '<out>', no_wait_on_error: true }, { ...base, ...(chain === null ? {} : { settings_chain: chain }) });
    pl.open_session();
    const s = pl.session, out = { phases: s.lab.store_log.phases.map((p) => p.label), standins: pl.stand_ins_in_use() };
    const look = () => ({ t: s.lab.lab_time(), frame: Buffer.from(s.frame('boundary', true)[2]).toString('base64'), values: Array.from({ length: names.count }, (_, i) => s.get(i)) });
    s.idle_slice(s.lab.lab_time() + 1500e6);
    out.start = look();
    s.switch_input('mode_dial', C1); s.idle_slice(s.lab.lab_time() + 1500e6);
    out.dial = look();
    pl.close_session?.();
    return out;
  };
  const on = run(null), off = run('0');
  ok(on.phases[1]?.startsWith('settings init chain ') && off.phases[1]?.startsWith('property store init '), `${MODEL}: the store's phases: ${JSON.stringify(on.phases)} / ${JSON.stringify(off.phases)}`);
  ok(!on.standins.includes('H-STOREINIT') && off.standins.includes('H-STOREINIT'), `${MODEL}: H-STOREINIT in use with the chain ${on.standins.includes('H-STOREINIT')}, without ${off.standins.includes('H-STOREINIT')}`);
  for (const k of ['start', 'dial']) {
    const diff = on[k].values.map((v, i) => (v === off[k].values[i] ? null : `${i} ${names.name(i)}: ${v} / ${off[k].values[i]}`)).filter(Boolean);
    ok(!diff.length, `${MODEL} ${k}: ${diff.length} settings differ (chain / narrow): ${diff.slice(0, 6).join('; ')}`);
    ok(on[k].frame === off[k].frame && on[k].t === off[k].t, `${MODEL} ${k}: frame ${on[k].frame === off[k].frame ? 'same' : 'differs'}, lab time ${on[k].t} / ${off[k].t}`);
  }
  const moved = on.start.values.filter((v, i) => v !== on.dial.values[i]).length;
  ok(moved > 0, `${MODEL}: the change to C1 changed no setting (a mode change not exercised)`);
  const bad = thrown(() => run('2'));
  ok(bad && /OM_EMU_SETTINGS_CHAIN "2": '0' \(the narrow H-STOREINIT\) or '1' \(the chain whole\)/.test(bad.message), `${MODEL}: a switch value of 2 refused: ${bad?.message}`);
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = !process.argv.includes('--units') && !process.argv.includes('--session');
  let bad = 0;
  const report = (name, r) => { console.log(`${name}: ${r.checks - r.bad.length}/${r.checks}`); r.bad.forEach((x) => console.log('  ', x)); bad += r.bad.length; };
  if (all || process.argv.includes('--units')) report('settings init chain: the rule', setchainUnits());
  if (all || process.argv.includes('--session')) report(`settings init chain in a session (${process.env.OM_EMU_MODEL ?? 'E143'})`, await setchainSession());
  process.exit(bad ? 1 : 0);
}
